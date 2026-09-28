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
// Road-local data comes in per vertex (aRoad = [lateral offset u in metres, floor(10 hw) + age]); pads and parking
// lots without it read as fresh surface. Everything thin (cracks, seams, sealing tar) is filtered against the pixel
// footprint, so it fades to its average tone instead of sparkling at distance or at grazing angles.
const ROADFN = /* glsl */`
float aaLine(float d, float w, float fw) { float W = max(w, fw); return (1.0 - smoothstep(W - fw * 0.5, W + fw * 0.5, d)) * (w / W); }
float aaBand(float x, float a, float b, float fw) { return smoothstep(a - fw, a + fw, x) * (1.0 - smoothstep(b - fw, b + fw, x)); }`;
export function asphaltAge(mat, key) {
  return patch(mat, 'asp2' + key, sh => {
    worldVaryings(sh);
    sh.uniforms.tNoise = S.tNoise;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aRoad, aRoadS; varying vec2 vRoad; varying float vRoadS;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvRoad = aRoad; vRoadS = aRoadS.x;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tNoise; varying vec2 vRoad; varying float vRoadS; float aspRough = 0.0;' + HASH + ROADFN)
      .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
        {
          vec2 p = vSWPos.xz;
          float fp = length(fwidth(p));                          // metres per pixel
          float hw = max(floor(vRoad.y) * 0.1, 0.0), age = fract(vRoad.y), u = vRoad.x;
          bool strip = hw > 0.5;
          float s = strip ? vRoadS : dot(p, vec2(0.7071));
          vec4 a = texture2D(tNoise, p * 0.017), b = texture2D(tNoise, p * 0.09), c = texture2D(tNoise, p * 0.7), d = texture2D(tNoise, vec2(s * 0.031, u * 0.4 + 0.37));
          // binder colour: fresh asphalt is near black and even; with age it greys and the aggregate shows
          float tone = mix(0.9, 1.22, age) * mix(0.86, 1.14, a.r) * mix(1.0 - 0.1 * age, 1.0 + 0.1 * age, c.g);
          diffuseColor.rgb *= tone;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.33))) * vec3(1.0, 0.99, 0.96), 0.3 + 0.4 * age);
          float rough = mix(-0.12, 0.06, age);
          if (strip) {
            float au = abs(u);
            // wheel paths: two per lane, polished darker bands; a faint oil drip line between them
            float two = step(2.9, hw), lc = two * hw * 0.5;
            float du = abs(au - lc);
            float tq = (du - 0.85) / 0.32, track = exp(-tq * tq) * (0.6 + 0.4 * b.r);
            float dq = du / 0.35, drip = exp(-dq * dq) * smoothstep(0.35, 0.7, b.g) * (1.0 - 0.6 * age);
            diffuseColor.rgb *= 1.0 - track * mix(0.1, 0.2, age) - drip * 0.14;
            rough -= track * 0.14 + drip * 0.12;
            // ravelled, lighter edge strip where the asphalt meets the gutter, broken up by noise
            float edge = smoothstep(hw - 0.55 - 0.25 * c.r, hw - 0.05, au) * (0.35 + 0.65 * age);
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.18, 1.16, 1.12), edge * 0.7);
            rough += edge * 0.08;
            // utility-trench reinstatement patches across the lane, and long patches along a wheel path
            float cellS = floor(s / 11.0), hx = h31(vec3(cellS, hw, 3.1)), s0 = cellS * 11.0 + hx * 5.0;
            float wide = mix(0.7, 1.6, fract(hx * 17.0));
            float on = step(0.72 - age * 0.25, fract(hx * 7.3)), uM = aaBand(u, -hw - 1.0, mix(-0.2, hw + 1.0, step(0.5, fract(hx * 3.7))), fp);
            float across = aaBand(s, s0, s0 + wide, fp) * on * uM;
            float cellL = floor(s / 37.0), hl = h31(vec3(cellL, hw, 8.4)), l0 = cellL * 37.0 + hl * 12.0;
            float along = aaBand(s, l0, l0 + 6.0 + hl * 14.0, fp) * aaBand(u * sign(hl - 0.5), lc - 0.2, lc + 1.5, fp) * step(0.8 - age * 0.35, fract(hl * 5.1));
            float pm = max(across, along);
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * mix(0.62, 0.74, age), pm);
            rough -= pm * 0.1;
            // sealing tar along patch edges and along the centre joint of older roads
            float seam = aaLine(min(abs(s - s0), abs(s - s0 - wide)), 0.03, fp) * on * uM;
            float joint = aaLine(abs(u + (d.r - 0.5) * 0.3), 0.035, fp) * smoothstep(0.35, 0.6, age) * smoothstep(0.3, 0.5, d.g) * two;
            float tar = max(seam, joint);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.035, 0.035, 0.038), tar * 0.85);
            rough -= tar * 0.35;
          }
          // cracks: noise iso-lines, only where the surface is old enough; alligator cracking in the wheel paths
          float n1 = texture2D(tNoise, p * 0.11 + 0.3).b, n2 = texture2D(tNoise, p * 0.37 + 0.7).a;
          float crW = 0.012;
          float cr = aaLine(abs(n1 - 0.5), crW, fwidth(n1)) * smoothstep(0.52, 0.62, a.g) * smoothstep(0.25, 0.8, age);
          cr = max(cr, aaLine(abs(n2 - 0.5), crW * 0.8, fwidth(n2)) * smoothstep(0.55, 0.8, age) * smoothstep(0.45, 0.6, b.b));
          diffuseColor.rgb *= 1.0 - cr * 0.6;
          // oil and water stains
          diffuseColor.rgb *= 1.0 - smoothstep(0.62, 0.88, c.r) * 0.12 * (0.5 + age);
          aspRough = rough + cr * 0.25;
        }`)
      .replace('#include <metalnessmap_fragment>', 'roughnessFactor = clamp(roughnessFactor + aspRough, 0.3, 1.0);\n#include <metalnessmap_fragment>');
  });
}
// thermoplastic road paint: worn through in patches (and where tyres run), dissolved with alpha-to-coverage under MSAA
// so the worn edges never alias
export function wornPaint(mat, key) {
  mat.alphaToCoverage = true;
  return patch(mat, 'paint2' + key, sh => {
    worldVaryings(sh);
    sh.uniforms.tNoise = S.tNoise;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aRoad; varying vec2 vRoad;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvRoad = aRoad;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tNoise; varying vec2 vRoad;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        { vec2 p = vSWPos.xz; float wr = texture2D(tNoise, p * 1.6).r * 0.65 + texture2D(tNoise, p * 0.23).g * 0.55;
          float hw = floor(vRoad.y) * 0.1, age = fract(vRoad.y);
          if (hw > 0.5) { float lc = step(2.9, hw) * hw * 0.5, du = abs(abs(vRoad.x) - lc), tq = (du - 0.85) / 0.3; wr = wr * mix(0.72, 1.08, age) + exp(-tq * tq) * 0.22 * age; }
          float fw = max(fwidth(wr), 1e-3);
          diffuseColor.a *= 1.0 - smoothstep(0.86 - fw, 0.86 + fw, wr);
          diffuseColor.rgb *= mix(1.0, 0.74, smoothstep(0.55, 0.8, wr)); }`);
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
// Room archetypes (homes): living room, bedroom, kitchen, tatami room, study / kids' room, dining room, storage.
// Shops (picked by the sign above them, via vertex colour b): goods shelves, café, restaurant counter, salon / clinic,
// office, workshop, bookshop, bakery. Furniture stands on a "mid-plane" between the window and the back wall, so it
// shifts against the room with parallax; people sometimes pass in lit rooms at night; TVs flicker.
export function windowMaterial({ shop = false, night, base = 6.45, roomW = 3.4, roomH = 2.85, depth = 4.2 } = {}) {
  const m = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.03, metalness: 0.0, envMapIntensity: 1.25, vertexColors: true });
  return patch(m, shop ? 'winShop2' : 'winHome2', sh => {
    worldVaryings(sh);
    Object.assign(sh.uniforms, { uNightW: night, uAmbW: S.uAmb, uSunW: S.uSunCol, uTimeW: S.uTime, uRoom: { value: new THREE.Vector4(roomW, roomH, depth, base) } });
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNightW, uTimeW; uniform vec3 uAmbW, uSunW; uniform vec4 uRoom;' + HASH + SHOP_PAL + /* glsl */`
        // anti-aliased box mask in 2D (half extents h, centre c), e = pixel footprint
        float boxM(vec2 p, vec2 c, vec2 h, float e){ vec2 q = abs(p - c) - h; return 1.0 - smoothstep(-e, e, max(q.x, q.y)); }
        float discM(vec2 p, vec2 c, float r, float e){ return 1.0 - smoothstep(r - e, r + e, length(p - c)); }`)
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
        float r1 = h31(id), r2 = h31(id + 7.13), r3 = h31(id + 3.71), r4 = h31(id + 1.37), r5 = h31(id + 5.29), r6 = h31(id + 9.61);
        float D = uRoom.z * (0.75 + 0.5 * r2);
        vec3 p0 = vec3(f.x * RW, f.y * RH, 0.0);
        float tx = d.x > 0.0 ? (RW - p0.x) / max(d.x, 1e-5) : p0.x / max(-d.x, 1e-5);
        float ty = d.y > 0.0 ? (RH - p0.y) / max(d.y, 1e-5) : p0.y / max(-d.y, 1e-5);
        float tz = D / max(-d.z, 1e-5);
        float t = min(min(tx, ty), tz);
        vec3 hp = p0 + d * t;
        vec3 col;
        vec3 fwp = fwidth(hp);
        float e = max(max(fwp.x, fwp.y), fwp.z) + 0.004;
        float detail = 1.0 - smoothstep(0.025, 0.08, e);
        float back = clamp(-hp.z / D, 0.0, 1.0);
        // the furniture plane, part-way into the room
        float mz = D * (0.45 + 0.2 * r6), tm = mz / max(-d.z, 1e-5);
        vec3 mp = p0 + d * tm;
        bool midOk = tm < t && mp.x > 0.0 && mp.x < RW && mp.y > 0.0;
        float em = max(fwidth(mp.x), fwidth(mp.y)) + 0.004;
        float mid = 0.0; vec3 midC = vec3(0.0);
        #ifdef WIN_SHOP
          float kind = floor(fract(vColor.b) * 8.0 + 0.01);
          vec3 pa = shopPal(r1), pb = shopPal(fract(r1 + 0.41)), pc = shopPal(fract(r1 + 0.73));
          bool warm = kind == 1.0 || kind == 2.0 || kind == 7.0;
          vec3 wallC = kind == 2.0 ? vec3(0.62, 0.46, 0.32) : kind == 1.0 ? vec3(0.9, 0.82, 0.7) : kind == 3.0 ? vec3(0.96, 0.97, 0.98)
                     : kind == 4.0 ? vec3(0.9, 0.92, 0.93) : mix(vec3(0.97, 0.94, 0.88), pa * 0.3 + 0.68, 0.45);
          if (t == ty) {
            if (d.y < 0.0) {
              vec3 fl = warm ? vec3(0.55, 0.4, 0.28) : r3 < 0.5 ? vec3(0.82, 0.7, 0.55) : vec3(0.88, 0.87, 0.84);
              float seam = warm || r3 < 0.5 ? abs(fract(hp.x * 2.0) - 0.5) : max(abs(fract(hp.x * 1.5) - 0.5), abs(fract(hp.z * 1.5) - 0.5));
              col = fl * (1.0 - 0.07 * smoothstep(0.45, 0.49, seam) * detail);
            } else {
              vec2 q = vec2(abs(fract(hp.x / 1.8) - 0.5), abs(fract(hp.z / 1.6) - 0.5));
              float panel = warm ? 0.0 : (1.0 - smoothstep(0.17, 0.23, q.x)) * (1.0 - smoothstep(0.2, 0.26, q.y));
              col = (warm ? vec3(0.5, 0.38, 0.28) : vec3(0.95, 0.95, 0.93)) + panel * vec3(1.2, 1.15, 1.05) * (0.4 + 0.6 * uNightW);
              if (warm) for (int k = 0; k < 3; k++) col += vec3(1.3, 0.9, 0.5) * discM(hp.xz, vec2(RW * (0.25 + 0.25 * float(k)), -D * 0.4), 0.25, e) ; // pendant lamps
            }
          } else {
            float u = t == tz ? hp.x : hp.z, du = t == tz ? fwp.x : fwp.z;
            col = wallC;
            if (kind == 0.0 || kind == 6.0 || kind == 7.0 || kind == 5.0) {
              // shelves: packaged goods, book spines, bread trays or hanging tools
              float sh2 = kind == 6.0 ? 0.36 : 0.45, sy = (hp.y - 0.1) / sh2, row = floor(sy), fy = fract(sy);
              float sw = kind == 6.0 ? 0.07 : kind == 7.0 ? 0.5 : 0.36, slot = u / sw, si = floor(slot), fx = fract(slot);
              float k = h31(vec3(si, row, r1 * 17.0)), k2 = h31(vec3(si + 0.5, row, r2 * 11.0 + 3.0));
              vec3 prod = kind == 7.0 ? mix(vec3(0.86, 0.6, 0.3), vec3(0.95, 0.8, 0.5), k) : kind == 5.0 ? vec3(0.3, 0.32, 0.36) : k < 0.4 ? pa : k < 0.75 ? pb : pc;
              if (kind == 6.0) prod = shopPal(k) * mix(0.7, 1.0, k2);
              prod = mix(prod, vec3(0.97, 0.95, 0.9), step(0.82, k2) * 0.75 * float(kind == 0.0));
              float hgt = kind == 6.0 ? 0.7 + 0.25 * k2 : kind == 7.0 ? 0.3 + 0.1 * k2 : 0.52 + 0.36 * k2, ex = kind == 6.0 ? 0.04 : 0.06 + 0.06 * k;
              float ax = du / sw + 1e-3, ay = fwp.y / sh2 + 1e-3;
              float item = smoothstep(ex - ax, ex + ax, fx) * (1.0 - smoothstep(1.0 - ex - ax, 1.0 - ex + ax, fx))
                         * smoothstep(0.13 - ay, 0.13 + ay, fy) * (1.0 - smoothstep(hgt - ay, hgt + ay, fy));
              if (kind == 5.0) item *= step(0.55, k);                                   // tools hang sparsely on a pegboard
              vec3 goods = mix(prod * 0.9, prod * 1.06 + 0.06, smoothstep(0.13, hgt, fy));
              float board = 1.0 - smoothstep(0.09, 0.09 + ay, fy);
              vec3 shelf = mix(wallC * 0.8, goods, item);
              shelf = mix(shelf, kind == 5.0 ? vec3(0.62, 0.5, 0.36) : vec3(0.84, 0.76, 0.66), board * float(kind != 5.0)) * mix(0.8, 1.0, smoothstep(0.09, 0.42, fy));
              vec3 avg = mix(wallC * 0.8, (pa + pb + pc) / 3.0, 0.45) * 0.93;
              col = mix(col, mix(avg, shelf, detail), step(0.0, sy) * step(sy, kind == 7.0 ? 3.0 : 4.0));
            } else if (kind == 2.0) {
              // restaurant: bottle shelf behind the counter, a menu board of wooden tags
              float sy = (hp.y - 1.3) / 0.32, fy = fract(sy), fx = fract(u / 0.16), k = h31(vec3(floor(u / 0.16), floor(sy), r1));
              float bottle = step(0.0, sy) * step(sy, 2.0) * (1.0 - smoothstep(0.3, 0.36, abs(fx - 0.5))) * step(fy, 0.3 + 0.55 * step(fx, 0.62) * step(0.38, fx)) * step(0.35, k);
              col = mix(col, mix(vec3(0.25, 0.45, 0.3), vec3(0.55, 0.3, 0.2), k) * 1.2, bottle * detail);
              float tag = step(2.1, hp.y) * step(hp.y, 2.55) * (1.0 - smoothstep(0.08, 0.1, abs(fract(u / 0.3) - 0.5) - 0.3));
              col = mix(col, vec3(0.95, 0.9, 0.78), tag * detail);
            } else if (kind == 3.0) {
              // salon / clinic: mirrors and a pale wainscot
              float mir = boxM(vec2(u, hp.y), vec2(floor(u / 1.4) * 1.4 + 0.7, 1.45), vec2(0.4, 0.5), e);
              col = mix(col, vec3(0.75, 0.85, 0.92), mir);
              col *= mix(0.9, 1.0, step(1.0, hp.y));
            } else if (kind == 4.0) {
              // office: posters and a wall calendar
              float post = boxM(vec2(u, hp.y), vec2(floor(u / 1.2) * 1.2 + 0.6, 1.6), vec2(0.28, 0.38), e);
              col = mix(col, shopPal(h31(vec3(floor(u / 1.2), r1, 2.0))) * 0.9, post);
            } else {
              // café: warm wainscot, framed art, a chalk menu
              col = mix(col, vec3(0.55, 0.38, 0.26), 1.0 - smoothstep(0.95, 0.95 + fwp.y, hp.y));
              float art = boxM(vec2(u, hp.y), vec2(floor(u / 1.6) * 1.6 + 0.8, 1.7), vec2(0.3, 0.24), e);
              col = mix(col, shopPal(h31(vec3(floor(u / 1.6), r2, 5.0))) * 0.8, art);
            }
          }
          // mid-plane: counters, tables, chairs, racks, desks
          if (midOk) {
            vec2 q = mp.xy;
            if (kind == 2.0 || kind == 7.0 || kind == 1.0) {       // a long counter with stools (café / restaurant / bakery)
              float counter = boxM(q, vec2(RW * 0.5, 0.52), vec2(RW * 0.45, 0.52), em);
              midC = mix(vec3(0.62, 0.44, 0.3), vec3(0.8, 0.62, 0.42), smoothstep(0.9, 1.04, q.y)); mid = counter;
              if (kind == 1.0) { float tab = boxM(q, vec2(RW * 0.3, 0.72), vec2(0.45, 0.03), em) + boxM(q, vec2(RW * 0.3, 0.36), vec2(0.03, 0.36), em);
                mid = max(counter * step(RW * 0.55, q.x), min(tab, 1.0)); }
            } else if (kind == 3.0) {                               // salon / clinic chairs
              float ch = boxM(q, vec2(floor(q.x / 1.4) * 1.4 + 0.7, 0.55), vec2(0.28, 0.08), em) + boxM(q, vec2(floor(q.x / 1.4) * 1.4 + 0.7, 0.85), vec2(0.26, 0.32), em) * 0.95;
              mid = min(ch, 1.0); midC = mix(vec3(0.3, 0.3, 0.34), vec3(0.8, 0.5, 0.45), step(0.5, r2));
            } else if (kind == 4.0) {                               // desks with monitors
              float x0 = floor(q.x / 1.6) * 1.6 + 0.8;
              float desk = boxM(q, vec2(x0, 0.74), vec2(0.62, 0.03), em) + boxM(q, vec2(x0 - 0.55, 0.37), vec2(0.03, 0.37), em) + boxM(q, vec2(x0 + 0.55, 0.37), vec2(0.03, 0.37), em);
              float mon = boxM(q, vec2(x0, 1.0), vec2(0.24, 0.16), em);
              mid = min(desk + mon, 1.0); midC = mix(vec3(0.85, 0.85, 0.83), vec3(0.15, 0.18, 0.22) + vec3(0.25, 0.35, 0.5) * (0.4 + 0.6 * uNightW), mon);
            } else if (kind == 0.0 || kind == 6.0) {                // a low display gondola
              float gon = boxM(q, vec2(RW * (0.3 + 0.4 * r3), 0.65), vec2(0.9, 0.65), em);
              float rows = step(0.5, fract(q.y / 0.32));
              mid = gon; midC = mix(mix(pb, pc, step(0.5, fract(q.x * 3.0))) * 0.95, vec3(0.9, 0.88, 0.84), rows * 0.5);
            } else if (kind == 5.0) {                               // a bicycle on the stand
              float wh = max(1.0 - smoothstep(0.03, 0.03 + em, abs(length(q - vec2(RW * 0.35, 0.34)) - 0.32)), 1.0 - smoothstep(0.03, 0.03 + em, abs(length(q - vec2(RW * 0.35 + 1.05, 0.34)) - 0.32)));
              mid = wh; midC = vec3(0.12);
            }
            col = mix(col, midC, mid);
          }
          vec3 lampC = kind == 2.0 || kind == 7.0 ? vec3(1.0, 0.82, 0.58) : kind == 1.0 ? vec3(1.0, 0.88, 0.7) : kind == 4.0 ? vec3(0.9, 0.96, 1.0) : vec3(1.0, 0.97, 0.9);
          vec3 light = lampC * (0.55 + uNightW * 0.3) * vColor.r * mix(1.08, 0.78, back);
          col *= light + uAmbW * 0.12;
        #else
          // ---- homes
          float kind = floor(r5 * 7.0);                       // 0 living 1 bed 2 kitchen 3 tatami 4 study 5 dining 6 storage
          vec3 wallC = mix(vec3(0.96, 0.91, 0.8), vec3(0.86, 0.92, 0.9), r1) * mix(0.9, 1.02, r4);
          if (kind == 3.0) wallC = vec3(0.9, 0.84, 0.7);
          if (kind == 6.0) wallC *= 0.85;
          vec3 floorC = r2 < 0.55 ? vec3(0.62, 0.45, 0.31) : vec3(0.8, 0.76, 0.52);
          if (kind == 3.0) floorC = vec3(0.72, 0.72, 0.46);
          if (kind == 2.0) floorC = vec3(0.86, 0.84, 0.8);
          float lit = step(r3, mix(0.1, kind == 6.0 ? 0.15 : 0.68, uNightW));
          // warm incandescent or cool daylight LED; kitchens run cool fluorescent
          vec3 lamp = kind == 2.0 ? vec3(0.9, 0.97, 1.0) : mix(vec3(1.0, 0.8, 0.56), vec3(0.92, 0.96, 1.0), step(0.7, r1));
          if (t == tz) {
            col = wallC * 0.95;
            float u = hp.x, v = hp.y;
            if (kind == 0.0) {        // TV on a low cabinet, framed picture
              float cab = boxM(vec2(u, v), vec2(RW * 0.5, 0.25), vec2(0.8, 0.25), e), tv = boxM(vec2(u, v), vec2(RW * 0.5, 0.85), vec2(0.55, 0.32), e);
              col = mix(col, vec3(0.45, 0.33, 0.25), cab);
              float onTV = step(0.45, r2) * uNightW;
              col = mix(col, mix(vec3(0.05), vec3(0.3, 0.45, 0.7) * (0.8 + 0.4 * sin(uTimeW * 3.0 + r1 * 20.0)) * 2.2, onTV), tv);
            } else if (kind == 1.0) { // wardrobe and a poster
              col = mix(col, vec3(0.8, 0.7, 0.58), boxM(vec2(u, v), vec2(RW * (0.25 + 0.5 * r4), 1.0), vec2(0.5, 1.0), e));
              col = mix(col, shopPal(r2) * 0.9, boxM(vec2(u, v), vec2(RW * (0.75 - 0.5 * r4), 1.6), vec2(0.26, 0.36), e) * detail);
            } else if (kind == 2.0) { // counter, wall cabinets, fridge, tiled splashback
              float ctr = boxM(vec2(u, v), vec2(RW * 0.45, 0.45), vec2(RW * 0.4, 0.45), e), cabs = boxM(vec2(u, v), vec2(RW * 0.45, 1.9), vec2(RW * 0.4, 0.32), e);
              float tiles = step(0.9, v) * step(v, 1.58) * (1.0 - 0.12 * detail * max(step(0.45, abs(fract(u * 6.0) - 0.5)), step(0.45, abs(fract(v * 6.0) - 0.5))));
              col = mix(col, vec3(0.9, 0.92, 0.9) * mix(1.0, tiles, step(0.9, v) * step(v, 1.58)), step(0.9, v) * step(v, 1.58));
              col = mix(col, mix(vec3(0.95, 0.94, 0.9), vec3(0.62, 0.46, 0.34), step(0.5, r4)), max(ctr, cabs));
              col = mix(col, vec3(0.94, 0.95, 0.96), boxM(vec2(u, v), vec2(RW * 0.9, 0.9), vec2(0.32, 0.9), e));
            } else if (kind == 3.0) { // shoji grid, tokonoma alcove with a hanging scroll
              float gx = abs(fract(u / 0.45) - 0.5), gy = abs(fract(v / 0.5) - 0.5), grid = max(step(0.46, gx), step(0.46, gy)) * detail;
              col = mix(vec3(0.97, 0.95, 0.88), vec3(0.5, 0.36, 0.24), grid * step(u, RW * 0.55));
              col = mix(col, vec3(0.78, 0.7, 0.55) * 0.85, step(RW * 0.6, u));
              col = mix(col, vec3(0.94, 0.92, 0.84), boxM(vec2(u, v), vec2(RW * 0.8, 1.5), vec2(0.18, 0.55), e));
            } else if (kind == 4.0) { // bookshelf with coloured spines, a pin board
              float sy = v / 0.34, fx = fract(u / 0.06), bk = h31(vec3(floor(u / 0.06), floor(sy), r1));
              float shelfA = step(u, RW * 0.45) * step(v, 1.9);
              float book = shelfA * step(0.12, fract(sy)) * step(fract(sy), 0.62 + 0.3 * bk) * step(0.15, fx) * step(bk, 0.85);
              col = mix(col, vec3(0.55, 0.42, 0.3), shelfA);
              col = mix(col, shopPal(bk) * 0.85, book * detail);
              col = mix(col, vec3(0.72, 0.58, 0.42), boxM(vec2(u, v), vec2(RW * 0.75, 1.55), vec2(0.4, 0.3), e));
            } else if (kind == 5.0) { // sideboard and a clock
              col = mix(col, vec3(0.5, 0.36, 0.26), boxM(vec2(u, v), vec2(RW * 0.5, 0.45), vec2(0.9, 0.45), e));
              col = mix(col, vec3(0.95), discM(vec2(u, v), vec2(RW * 0.5, 2.0), 0.16, e));
            } else {                  // storage: stacked cardboard boxes
              float bx = floor(u / 0.55), by = floor(v / 0.42), k = h31(vec3(bx, by, r1));
              float boxes = step(v, 0.42 * (1.0 + floor(h31(vec3(bx, 0.0, r2)) * 4.0))) * step(0.08, fract(u / 0.55)) * step(0.06, fract(v / 0.42));
              col = mix(col, vec3(0.72, 0.56, 0.38) * mix(0.85, 1.05, k), boxes);
            }
          } else if (t == ty) {
            if (d.y < 0.0) {
              if (kind == 3.0) { // tatami mats with dark borders
                vec2 tq = vec2(hp.x / 0.9, -hp.z / 1.8), tf = abs(fract(tq) - 0.5);
                col = floorC * (1.0 - 0.3 * detail * max(step(0.47, tf.x), step(0.48, tf.y))) * (0.96 + 0.04 * sin(hp.x * 80.0) * detail);
              } else col = floorC * mix(1.0, 0.94, step(0.5, fract(hp.x * 2.2)) * detail);
              if (kind == 0.0 || kind == 1.0) col = mix(col, shopPal(r4) * 0.7 + 0.2, boxM(hp.xz, vec2(RW * 0.5, -D * 0.55), vec2(RW * 0.3, D * 0.2), e)); // rug
            } else {
              col = vec3(0.96, 0.95, 0.92);
              col += lit * lamp * 1.6 * (1.0 - smoothstep(0.18, 0.5, length(hp.xz - vec2(RW * 0.5, -D * 0.45))));
            }
          } else col = wallC * 0.86;
          // furniture on the mid-plane
          if (midOk) {
            vec2 q = mp.xy; float cx = RW * (0.3 + 0.4 * r4);
            if (kind == 0.0) { mid = min(boxM(q, vec2(cx, 0.25), vec2(0.95, 0.2), em) + boxM(q, vec2(cx, 0.55), vec2(0.95, 0.12), em) + boxM(q, vec2(cx - 0.95, 0.4), vec2(0.1, 0.22), em) + boxM(q, vec2(cx + 0.95, 0.4), vec2(0.1, 0.22), em), 1.0);
              midC = mix(vec3(0.42, 0.5, 0.62), vec3(0.7, 0.55, 0.42), step(0.5, r6)); }           // sofa
            else if (kind == 1.0) { mid = min(boxM(q, vec2(cx, 0.25), vec2(0.8, 0.25), em) + boxM(q, vec2(cx - 0.75, 0.55), vec2(0.06, 0.55), em), 1.0);
              midC = mix(shopPal(r6) * 0.6 + 0.35, vec3(0.95), smoothstep(0.44, 0.5, q.y)); }          // bed with a headboard
            else if (kind == 3.0) { mid = min(boxM(q, vec2(cx, 0.3), vec2(0.55, 0.04), em) + boxM(q, vec2(cx, 0.15), vec2(0.45, 0.14), em), 1.0); midC = vec3(0.38, 0.24, 0.16); } // chabudai
            else if (kind == 4.0) { mid = min(boxM(q, vec2(cx, 0.74), vec2(0.6, 0.03), em) + boxM(q, vec2(cx + 0.55, 0.37), vec2(0.04, 0.37), em) + boxM(q, vec2(cx - 0.3, 0.45), vec2(0.18, 0.45), em) + discM(q, vec2(cx + 0.35, 1.0), 0.07, em), 1.0);
              midC = mix(vec3(0.72, 0.58, 0.42), vec3(1.0, 0.95, 0.75) * (1.0 + 2.0 * uNightW * lit), step(0.95, q.y)); }  // desk, chair, lamp
            else if (kind == 5.0) { mid = min(boxM(q, vec2(cx, 0.72), vec2(0.7, 0.03), em) + boxM(q, vec2(cx - 0.6, 0.36), vec2(0.03, 0.36), em) + boxM(q, vec2(cx + 0.6, 0.36), vec2(0.03, 0.36), em)
                + boxM(q, vec2(cx - 0.95, 0.45), vec2(0.03, 0.45), em) + boxM(q, vec2(cx + 0.95, 0.45), vec2(0.03, 0.45), em), 1.0); midC = vec3(0.55, 0.4, 0.28); } // dining table and chairs
            else if (kind == 6.0) { mid = boxM(q, vec2(cx, 0.35), vec2(0.5, 0.35), em); midC = vec3(0.7, 0.55, 0.38); }
            // somebody at home: a figure crosses some lit rooms at night
            float who = step(0.82, r2) * lit * uNightW;
            if (who > 0.0) { float px = RW * (0.5 + 0.35 * sin(uTimeW * 0.15 + r1 * 30.0));
              float fig = min(discM(q, vec2(px, 1.52), 0.12, em) + boxM(q, vec2(px, 0.95), vec2(0.18, 0.42), em) + boxM(q, vec2(px, 0.3), vec2(0.13, 0.3), em), 1.0);
              mid = max(mid, fig); midC = mix(midC, vec3(0.2, 0.2, 0.25), fig); }
            col = mix(col, midC, mid);
          }
          // light: lamps when lit; by day the room is lit through the window (brightest near the glass)
          float nearCeil = mix(0.6, 1.15, hp.y / RH) * mix(1.1, 0.72, back);
          float dayW = 1.0 - uNightW;
          // daylight indoors is soft and nearly neutral (the sky's blue only tints it a little)
          vec3 dayC = mix(vec3(dot(uAmbW, vec3(0.3, 0.59, 0.11))), uAmbW, 0.25) * vec3(1.05, 1.0, 0.92);
          vec3 daylight = (dayC * 0.8 + uSunW * 0.04) * mix(1.15, 0.6, back) * dayW;
          vec3 light = uAmbW * 0.3 * uNightW + daylight + lit * lamp * (0.75 + 0.8 * uNightW) * nearCeil;
          if (kind == 0.0) light += vec3(0.25, 0.4, 0.8) * step(0.45, r2) * uNightW * (1.0 - lit) * 0.5 * (0.8 + 0.3 * sin(uTimeW * 3.0 + r1 * 20.0)); // TV glow in a dark room
          col *= light;
          // window dressing: curtains / lace, blinds, or shoji screens in tatami rooms
          vec2 fwu = fwidth(vSUv) + 1e-4;
          float blinds = kind == 2.0 || kind == 4.0 ? step(0.35, r6) : kind == 6.0 ? step(0.4, r6) : step(0.85, r6);
          // curtains and blinds catch the same soft daylight as the room (not the pure sky blue), or the lamp at night
          vec3 dressLight = dayC * 0.95 * dayW + uAmbW * 0.45 * uNightW + lit * lamp * (0.65 + 0.6 * uNightW);
          if (kind == 3.0) {
            float sh = step(1.0 - (0.3 + 0.6 * r4), vSUv.x);                                           // a slid-across shoji
            float gridS = max(step(0.46, abs(fract(vSUv.x * 4.0) - 0.5)), step(0.46, abs(fract(vSUv.y * 5.0) - 0.5))) * detail;
            col = mix(col, mix(vec3(0.97, 0.94, 0.86), vec3(0.45, 0.32, 0.22), gridS) * (dressLight + lit * lamp * 0.6), sh);
          } else if (blinds > 0.5) {
            float down = 0.35 + 0.6 * r4, slat = step(1.0 - down, vSUv.y) * (0.75 + 0.25 * smoothstep(0.2, 0.5, abs(fract(vSUv.y * 22.0) - 0.5)));
            col = mix(col, vec3(0.9, 0.9, 0.88) * dressLight * slat, step(1.0 - down, vSUv.y) * 0.97);
          } else {
            float cw = 0.08 + 0.3 * r4, cr = 1.0 - cw * (0.4 + r2);
            float curtain = max(1.0 - smoothstep(cw - fwu.x, cw + fwu.x, vSUv.x), smoothstep(cr - fwu.x, cr + fwu.x, vSUv.x));
            curtain = max(curtain, step(0.86, r2) * smoothstep(0.2 - fwu.y, 0.2 + fwu.y, vSUv.y));
            vec3 curtC = mix(vec3(0.95, 0.88, 0.74), shopPal(r1) * 0.8 + 0.1, step(0.5, r3)) * (1.0 - 0.1 * detail * (0.5 + 0.5 * sin(vSUv.x * 60.0)));
            col = mix(col, curtC * dressLight, clamp(curtain, 0.0, 1.0) * 0.96);
            col = mix(col, vec3(0.92) * dressLight, step(0.5, r4) * 0.4 * (1.0 - clamp(curtain, 0.0, 1.0)));
          }
        #endif
        totalEmissiveRadiance += col;
        // daylight: sky tint and two painted highlight streaks across the glass (kept light so the rooms show through)
        { float sk = vSUv.x + vSUv.y * 0.75, dayW = 1.0 - uNightW;
          float band = (1.0 - smoothstep(0.0, 0.06, abs(sk - 0.5))) * 0.55 + (1.0 - smoothstep(0.0, 0.025, abs(sk - 0.7))) * 0.4;
          #ifdef WIN_SHOP
            totalEmissiveRadiance += vec3(0.85, 0.92, 1.0) * band * dayW * 0.22;
          #else
            totalEmissiveRadiance += (vec3(0.08, 0.13, 0.22) + vec3(0.85, 0.92, 1.0) * band * 0.8) * dayW * 0.5;
          #endif
        }
      }`);
    if (shop) sh.fragmentShader = '#define WIN_SHOP\n' + sh.fragmentShader;
  });
}
