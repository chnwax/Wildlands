// Surface shading upgrades patched into MeshStandardMaterial:
//  - parallax occlusion mapping from real height maps (roof tiles, block/stone walls, gravel, facade tiles…)
//  - weathering: macro colour variation, rain streaks, ground-level grime & algae, dirt/moss on up-facing surfaces
//  - asphalt ageing (patches, cracks, stains) and worn road paint
//  - interior-mapped windows: rooms with depth, furniture, curtains/lace, lit rooms at night
import { THREE, S } from './core.js';

// several patches can be stacked on one material; each contributes to a unique program cache key
export function patch(mat, key, fn) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => { if (prev) prev.call(mat, sh, r); fn(sh); };
  mat.userData.pk = (mat.userData.pk || '') + '|' + key;
  mat.customProgramCacheKey = () => mat.userData.pk;
  mat.needsUpdate = true;
  return mat;
}
function worldVaryings(sh) {
  if (sh.vertexShader.includes('vSWPos')) return;
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vSWPos; varying vec3 vSWNrm; varying vec2 vSUv;')
    .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      vec4 swp = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        swp = instanceMatrix * swp;
      #endif
      vSWPos = (modelMatrix * swp).xyz; vSWNrm = normalize(mat3(modelMatrix) * objectNormal);
      #ifdef USE_UV
        vSUv = uv;
      #else
        vSUv = vec2(0.0);
      #endif`);
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vSWPos; varying vec3 vSWNrm; varying vec2 vSUv;');
}
const HASH = /* glsl */`
float h31(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }`;

// ---------------------------------------------------------------- relief (POM) + ARM maps
// depth: relief depth in UV units (UVs here are metres / tile size), so ~0.02–0.06
export function relief(mat, dispTex, depth, key) {
  mat.userData.relief = true;
  return patch(mat, 'pom' + key, sh => {
    sh.uniforms.tDisp = { value: dispTex }; sh.uniforms.uPom = { value: depth };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tDisp; uniform float uPom;')
      .replace('#include <map_fragment>', /* glsl */`
        vec2 pomUv = vMapUv;
        {
          vec3 q0 = dFdx(-vViewPosition), q1 = dFdy(-vViewPosition);
          vec2 st0 = dFdx(vMapUv), st1 = dFdy(vMapUv);
          vec3 Nn = normalize(vNormal);
          vec3 q1p = cross(q1, Nn), q0p = cross(Nn, q0);
          vec3 Tn = q1p * st0.x + q0p * st1.x, Bn = q1p * st0.y + q0p * st1.y;
          float det = max(dot(Tn, Tn), dot(Bn, Bn));
          float sc = det == 0.0 ? 0.0 : inversesqrt(det);
          Tn *= sc; Bn *= sc;
          vec3 Vv = normalize(vViewPosition);
          vec3 ts = vec3(dot(Vv, Tn), dot(Vv, Bn), dot(Vv, Nn));
          float fade = 1.0 - smoothstep(18.0, 45.0, length(vViewPosition));
          if (fade > 0.0 && ts.z > 0.05) {
            float layers = mix(28.0, 10.0, clamp(ts.z, 0.0, 1.0));
            float dl = 1.0 / layers;
            vec2 dUV = ts.xy / max(ts.z, 0.2) * uPom * fade * dl;
            float cl = 0.0; vec2 uvp = vMapUv; float dm = 1.0 - textureGrad(tDisp, uvp, st0, st1).r;
            for (int i = 0; i < 28; i++) { if (cl >= dm) break; uvp -= dUV; dm = 1.0 - textureGrad(tDisp, uvp, st0, st1).r; cl += dl; }
            vec2 prevUv = uvp + dUV;
            float after = dm - cl, before = (1.0 - textureGrad(tDisp, prevUv, st0, st1).r) - cl + dl;
            pomUv = mix(uvp, prevUv, clamp(after / (after - before + 1e-5), 0.0, 1.0));
          }
        }
        #ifdef USE_MAP
          diffuseColor *= texture2D(map, pomUv);
        #endif`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = roughness;
        #ifdef USE_ROUGHNESSMAP
          roughnessFactor *= texture2D(roughnessMap, pomUv).g;
        #endif`)
      .replace('#include <normal_fragment_maps>', `#ifdef USE_NORMALMAP_TANGENTSPACE
          vec3 mapN = texture2D(normalMap, pomUv).xyz * 2.0 - 1.0; mapN.xy *= normalScale; normal = normalize(tbn * mapN);
        #endif`)
      .replace('#include <aomap_fragment>', `#ifdef USE_AOMAP
          float ambientOcclusion = (texture2D(aoMap, pomUv).r - 1.0) * aoMapIntensity + 1.0;
          reflectedLight.indirectDiffuse *= ambientOcclusion;
          #if defined( USE_CLEARCOAT )
            clearcoatSpecularIndirect *= ambientOcclusion;
          #endif
          #if defined( USE_ENVMAP ) && defined( STANDARD )
            float dotNV = saturate(dot(geometryNormal, geometryViewDir));
            reflectedLight.indirectSpecular *= computeSpecularOcclusion(dotNV, ambientOcclusion, material.roughness);
          #endif
        #endif`);
  });
}

// ---------------------------------------------------------------- weathering
// w: { grime, streaks, moss, vary, ground } — all 0..1 strengths except ground (world y of the street level)
export function weather(mat, w, key) {
  return patch(mat, 'wx' + key, sh => {
    worldVaryings(sh);
    sh.uniforms.tNoise = S.tNoise;
    sh.uniforms.uWx = { value: new THREE.Vector4(w.grime ?? 0.6, w.streaks ?? 0.5, w.moss ?? 0.3, w.vary ?? 1) };
    sh.uniforms.uGround = { value: w.ground ?? 6 };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tNoise; uniform vec4 uWx; uniform float uGround; float wxRough = 0.0;')
      .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
        {
          vec3 wn = normalize(vSWNrm), wp = vSWPos;
          float vert = 1.0 - abs(wn.y);
          vec2 along = normalize(vec2(-wn.z, wn.x) + vec2(1e-4));
          vec2 wuv = vec2(dot(wp.xz, along), wp.y);
          vec4 nA = texture2D(tNoise, wp.xz * 0.045 + wp.y * 0.021);
          vec4 nB = texture2D(tNoise, vec2(wuv.x * 0.55, wuv.y * 0.035));
          vec4 nC = texture2D(tNoise, wuv * 0.45 + wp.xz * 0.01);
          float hg = wp.y - uGround;
          diffuseColor.rgb *= mix(vec3(1.0), mix(0.86, 1.1, nA.g) * mix(vec3(1.02, 1.0, 0.96), vec3(0.97, 1.0, 1.03), nA.r), uWx.w);
          float streak = smoothstep(0.42, 0.78, nB.r) * smoothstep(0.2, 0.7, nC.b) * vert * uWx.y;
          float gg = (1.0 - smoothstep(0.0, 0.5 + nC.r * 0.9, hg)) * vert * uWx.x;
          float up = smoothstep(0.55, 0.95, wn.y) * smoothstep(0.35, 0.75, nA.b + nC.g * 0.3) * uWx.z;
          vec3 dirt = diffuseColor.rgb * vec3(0.55, 0.52, 0.47);
          diffuseColor.rgb = mix(diffuseColor.rgb, dirt, clamp(streak * 0.45 + gg * 0.55, 0.0, 0.8));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.12, 0.14, 0.08), clamp(gg * nC.g * uWx.z * 1.2 + up * 0.55, 0.0, 0.75));
          wxRough = clamp(streak + gg + up, 0.0, 1.0);
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.97, wxRough * 0.6);');
    // relief() may already have replaced the roughness include; make sure wxRough is still applied
    if (!sh.fragmentShader.includes('wxRough * 0.6')) sh.fragmentShader = sh.fragmentShader.replace('#include <metalnessmap_fragment>', 'roughnessFactor = mix(roughnessFactor, 0.97, wxRough * 0.6);\n#include <metalnessmap_fragment>');
  });
}

// ---------------------------------------------------------------- roads
export function asphaltAge(mat, key) {
  return patch(mat, 'asp' + key, sh => {
    worldVaryings(sh);
    sh.uniforms.tNoise = S.tNoise;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tNoise; float aspRough = 0.0;' + HASH)
      .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
        {
          vec2 p = vSWPos.xz;
          vec4 a = texture2D(tNoise, p * 0.017), b = texture2D(tNoise, p * 0.09), c = texture2D(tNoise, p * 0.7);
          diffuseColor.rgb *= mix(0.8, 1.18, a.r) * mix(0.95, 1.05, c.g);
          vec2 cell = floor(p / vec2(3.2, 2.4));
          float pm = step(0.94, h31(vec3(cell, 1.7))) * step(0.35, b.g);            // cut-and-fill repair patches
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.68, pm);
          float cr = (1.0 - smoothstep(0.0, 0.012, abs(b.b - 0.5))) * step(0.52, a.g); // cracks
          diffuseColor.rgb *= 1.0 - cr * 0.55;
          diffuseColor.rgb *= 1.0 - smoothstep(0.62, 0.88, c.r) * 0.16;                   // stains
          aspRough = cr * 0.3 - pm * 0.1;
        }`)
      .replace('#include <metalnessmap_fragment>', 'roughnessFactor = clamp(roughnessFactor + aspRough, 0.3, 1.0);\n#include <metalnessmap_fragment>');
  });
}
export function wornPaint(mat, key) {
  return patch(mat, 'paint' + key, sh => {
    worldVaryings(sh);
    sh.uniforms.tNoise = S.tNoise;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tNoise;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        { vec2 p = vSWPos.xz; float wr = texture2D(tNoise, p * 1.6).r * 0.65 + texture2D(tNoise, p * 0.23).g * 0.55;
          if (wr > 0.8) discard;
          diffuseColor.rgb *= mix(1.0, 0.72, smoothstep(0.55, 0.8, wr)); }`);
  });
}

// ---------------------------------------------------------------- interior-mapped windows
// soft anime palette for shop goods, curtains and pictures
const SHOP_PAL = /* glsl */`
vec3 shopPal(float h) {
  float i = floor(h * 8.0);
  return i < 1.0 ? vec3(0.96, 0.62, 0.66) : i < 2.0 ? vec3(0.56, 0.84, 0.7) : i < 3.0 ? vec3(0.99, 0.84, 0.46) : i < 4.0 ? vec3(0.56, 0.74, 0.96)
       : i < 5.0 ? vec3(0.96, 0.58, 0.42) : i < 6.0 ? vec3(0.72, 0.62, 0.92) : i < 7.0 ? vec3(0.36, 0.68, 0.74) : vec3(0.95, 0.9, 0.78);
}`;
// Rooms are laid out on a world-space grid (floor height, room width) behind every window quad; UVs 0..1 across the pane
// drive curtains. Reflections come from the physically based glass (black diffuse, low roughness).
export function windowMaterial({ shop = false, night, base = 6.45, roomW = 3.4, roomH = 2.85, depth = 4.2 } = {}) {
  const m = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.03, metalness: 0.0, envMapIntensity: 1.25, vertexColors: true });
  return patch(m, shop ? 'winShop' : 'winHome', sh => {
    worldVaryings(sh);
    Object.assign(sh.uniforms, { uNightW: night, uAmbW: S.uAmb, uRoom: { value: new THREE.Vector4(roomW, roomH, depth, base) } });
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNightW; uniform vec3 uAmbW; uniform vec4 uRoom;' + HASH + SHOP_PAL)
      .replace('#include <emissivemap_fragment>', /* glsl */`#include <emissivemap_fragment>
      {
        vec3 N = normalize(vSWNrm);
        vec3 T = normalize(cross(vec3(0.0, 1.0, 0.0), N) + vec3(1e-5));
        vec3 V = normalize(vSWPos - cameraPosition);
        vec3 d = vec3(dot(V, T), V.y, dot(V, N));
        float RW = uRoom.x, RH = uRoom.y;
        vec2 cell = vec2(dot(vSWPos, T) / RW, (vSWPos.y - uRoom.w) / RH);
        vec2 ci = floor(cell), f = fract(cell);
        vec3 id = vec3(ci, floor(dot(vSWPos, N) * 0.5 + 0.5) + floor(dot(vSWPos.xz, vec2(0.013, 0.017))));
        float r1 = h31(id), r2 = h31(id + 7.13), r3 = h31(id + 3.71), r4 = h31(id + 1.37);
        float D = uRoom.z * (0.75 + 0.5 * r2);
        vec3 p0 = vec3(f.x * RW, f.y * RH, 0.0);
        float tx = d.x > 0.0 ? (RW - p0.x) / max(d.x, 1e-5) : p0.x / max(-d.x, 1e-5);
        float ty = d.y > 0.0 ? (RH - p0.y) / max(d.y, 1e-5) : p0.y / max(-d.y, 1e-5);
        float tz = D / max(-d.z, 1e-5);
        float t = min(min(tx, ty), tz);
        vec3 hp = p0 + d * t;
        vec3 col;
        // size of a pixel on the room surfaces (metres): fine detail fades to its average before it can shimmer
        vec3 fwp = fwidth(hp);
        float detail = 1.0 - smoothstep(0.025, 0.08, max(max(fwp.x, fwp.y), fwp.z));
        float back = clamp(-hp.z / D, 0.0, 1.0);
        #ifdef WIN_SHOP
          // anime shop: a three-colour pastel palette per shopfront, rounded goods on pale shelves, soft ceiling panels
          vec3 pa = shopPal(r1), pb = shopPal(fract(r1 + 0.41)), pc = shopPal(fract(r1 + 0.73));
          vec3 wallC = mix(vec3(0.97, 0.94, 0.88), pa * 0.3 + 0.68, 0.45);
          if (t == ty) {
            if (d.y < 0.0) {
              vec3 fl = r3 < 0.5 ? vec3(0.82, 0.7, 0.55) : vec3(0.88, 0.87, 0.84);
              float seam = r3 < 0.5 ? abs(fract(hp.x * 2.0) - 0.5) : max(abs(fract(hp.x * 1.5) - 0.5), abs(fract(hp.z * 1.5) - 0.5));
              col = fl * (1.0 - 0.07 * smoothstep(0.45, 0.49, seam) * detail);
            } else {
              vec2 q = vec2(abs(fract(hp.x / 1.8) - 0.5), abs(fract(hp.z / 1.6) - 0.5));
              float panel = (1.0 - smoothstep(0.17, 0.23, q.x)) * (1.0 - smoothstep(0.2, 0.26, q.y));
              col = vec3(0.95, 0.95, 0.93) + panel * vec3(1.2, 1.15, 1.05) * (0.4 + 0.6 * uNightW);
            }
          } else {
            float u = t == tz ? hp.x : hp.z, du = t == tz ? fwp.x : fwp.z;
            col = wallC;
            float sy = (hp.y - 0.1) / 0.45, row = floor(sy), fy = fract(sy);
            float slot = u / 0.36, si = floor(slot), fx = fract(slot);
            float k = h31(vec3(si, row, r1 * 17.0)), k2 = h31(vec3(si + 0.5, row, r2 * 11.0 + 3.0));
            vec3 prod = k < 0.4 ? pa : k < 0.75 ? pb : pc;
            prod = mix(prod, vec3(0.97, 0.95, 0.9), step(0.82, k2) * 0.75);           // some white packaging
            float hgt = 0.52 + 0.36 * k2, ex = 0.06 + 0.06 * k;
            float ax = du / 0.36 + 1e-3, ay = fwp.y / 0.45 + 1e-3;
            float item = smoothstep(ex - ax, ex + ax, fx) * (1.0 - smoothstep(1.0 - ex - ax, 1.0 - ex + ax, fx))
                       * smoothstep(0.13 - ay, 0.13 + ay, fy) * (1.0 - smoothstep(hgt - ay, hgt + ay, fy));
            vec3 goods = mix(prod * 0.9, prod * 1.06 + 0.06, smoothstep(0.13, hgt, fy)); // painted: lighter toward the top
            float board = 1.0 - smoothstep(0.09, 0.09 + ay, fy);
            vec3 shelf = mix(wallC * 0.8, goods, item);
            shelf = mix(shelf, vec3(0.84, 0.76, 0.66), board) * mix(0.8, 1.0, smoothstep(0.09, 0.42, fy));
            vec3 avg = mix(wallC * 0.8, (pa + pb + pc) / 3.0, 0.45) * 0.93;
            col = mix(col, mix(avg, shelf, detail), step(0.0, sy) * step(sy, 4.0));
            float band = smoothstep(2.18, 2.18 + ay, hp.y) * (1.0 - smoothstep(2.46, 2.46 + ay, hp.y)); // painted frieze above the shelves
            col = mix(col, pa * 0.75 + 0.2, band);
          }
          vec3 light = vec3(1.0, 0.97, 0.9) * (0.55 + uNightW * 0.3) * vColor.r * mix(1.08, 0.78, back);
          col *= light + uAmbW * 0.12;
        #else
          // homes: pastel walls, wood or tatami floors, one soft furniture shape, a ceiling lamp and curtains
          vec3 wallC = mix(vec3(0.96, 0.91, 0.8), vec3(0.86, 0.92, 0.9), r1) * mix(0.9, 1.02, r4);
          vec3 floorC = r2 < 0.55 ? vec3(0.62, 0.45, 0.31) : vec3(0.8, 0.76, 0.52);
          float lit = step(r3, mix(0.1, 0.62, uNightW));
          vec3 lamp = mix(vec3(1.0, 0.82, 0.6), vec3(0.9, 0.95, 1.0), step(0.72, r1));
          if (t == tz) {
            col = wallC * 0.95;
            float fx = RW * (0.2 + 0.6 * r1), fwid = 0.4 + 0.7 * r2, fh = 0.5 + 1.2 * r3, e = fwp.x + fwp.y + 0.01;
            float furn = (1.0 - smoothstep(fwid - e, fwid + e, abs(hp.x - fx))) * (1.0 - smoothstep(fh - e, fh + e, hp.y));
            col = mix(col, mix(vec3(0.5, 0.36, 0.28), vec3(0.64, 0.7, 0.78), r4) * mix(0.9, 1.05, hp.y / fh), furn);
            float px = RW * (0.75 - 0.5 * r1), pic = (1.0 - smoothstep(0.32 - e, 0.32 + e, abs(hp.x - px))) * (1.0 - smoothstep(0.24 - e, 0.24 + e, abs(hp.y - 1.75)));
            col = mix(col, shopPal(r2) * 0.85, pic * step(fh + 0.3, 1.5) * detail);    // a framed picture above low furniture
          } else if (t == ty) {
            col = d.y < 0.0 ? floorC * mix(1.0, 0.94, step(0.5, fract(hp.x * 2.2)) * detail) : vec3(0.96, 0.95, 0.92);
            if (d.y > 0.0) col += lit * lamp * 1.6 * (1.0 - smoothstep(0.18, 0.5, length(hp.xz - vec2(RW * 0.5, -D * 0.45))));
          } else col = wallC * 0.86;
          float nearCeil = mix(0.6, 1.15, hp.y / RH) * mix(1.1, 0.72, back);
          vec3 light = uAmbW * 0.34 + lit * lamp * (0.75 + 0.8 * uNightW) * nearCeil;
          col *= light;
          // curtains (side panels, soft folds) and lace
          vec2 fwu = fwidth(vSUv) + 1e-4;
          float cw = 0.08 + 0.3 * r4, cr = 1.0 - cw * (0.4 + r2);
          float curtain = max(1.0 - smoothstep(cw - fwu.x, cw + fwu.x, vSUv.x), smoothstep(cr - fwu.x, cr + fwu.x, vSUv.x));
          curtain = max(curtain, step(0.86, r2) * smoothstep(0.2 - fwu.y, 0.2 + fwu.y, vSUv.y));
          vec3 curtC = mix(vec3(0.95, 0.88, 0.74), shopPal(r1) * 0.8 + 0.1, step(0.5, r3)) * (1.0 - 0.1 * detail * (0.5 + 0.5 * sin(vSUv.x * 60.0)));
          vec3 curtLight = uAmbW * 0.6 + lit * lamp * (0.65 + 0.6 * uNightW);
          col = mix(col, curtC * curtLight, clamp(curtain, 0.0, 1.0) * 0.96);
          col = mix(col, vec3(0.92) * curtLight, step(0.5, r4) * 0.5 * (1.0 - clamp(curtain, 0.0, 1.0)));
        #endif
        totalEmissiveRadiance += col;
        // daylight: sky tint and two painted highlight streaks across the glass
        { float sk = vSUv.x + vSUv.y * 0.75, dayW = 1.0 - uNightW;
          float band = (1.0 - smoothstep(0.0, 0.06, abs(sk - 0.5))) * 0.55 + (1.0 - smoothstep(0.0, 0.025, abs(sk - 0.7))) * 0.4;
          #ifdef WIN_SHOP
            totalEmissiveRadiance += vec3(0.85, 0.92, 1.0) * band * dayW * 0.22;
          #else
            totalEmissiveRadiance += (vec3(0.18, 0.3, 0.5) + vec3(0.85, 0.92, 1.0) * band) * dayW * 0.6;
          #endif
        }
      }`);
    if (shop) sh.fragmentShader = '#define WIN_SHOP\n' + sh.fragmentShader;
  });
}
