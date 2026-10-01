// Volumetric cumulus: ray-marched through a 3D Perlin-Worley noise volume, shaded anime style — light reaching each
// sample is banded into palette 'lit' and 'shade' colours, with glowing edges when backlit.
import { THREE, scene, S, mulberry32, lerp, clamp } from './core.js';

function makeCloudNoise(N = 64) {
  const rng = mulberry32(8123);
  const worleyGrid = cells => { const p = new Float32Array(cells ** 3 * 3); for (let i = 0; i < p.length; i++) p[i] = rng(); return { cells, p }; };
  const worley = (x, y, z, W) => { // periodic, returns distance to nearest feature point in cell units (≈0..1)
    const c = W.cells, fx = x * c, fy = y * c, fz = z * c, cx = Math.floor(fx), cy = Math.floor(fy), cz = Math.floor(fz);
    let best = 9;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const ix = cx + dx, iy = cy + dy, iz = cz + dz;
      const k = ((((iz % c) + c) % c) * c * c + (((iy % c) + c) % c) * c + (((ix % c) + c) % c)) * 3;
      const ex = ix + W.p[k] - fx, ey = iy + W.p[k + 1] - fy, ez = iz + W.p[k + 2] - fz, d = ex * ex + ey * ey + ez * ez;
      if (d < best) best = d;
    }
    return Math.min(1, Math.sqrt(best));
  };
  const lat = {};
  const lattice = P => { if (!lat[P]) { const a = new Float32Array(P ** 3); for (let i = 0; i < a.length; i++) a[i] = rng(); lat[P] = a; } return lat[P]; };
  const value = (x, y, z, P) => { // periodic smooth value noise
    const L = lattice(P), gx = x * P, gy = y * P, gz = z * P, ix = Math.floor(gx), iy = Math.floor(gy), iz = Math.floor(gz);
    const f = t => t * t * (3 - 2 * t), tx = f(gx - ix), ty = f(gy - iy), tz = f(gz - iz);
    const at = (a, b, c) => L[(((c % P) + P) % P) * P * P + (((b % P) + P) % P) * P + (((a % P) + P) % P)];
    const l = (a, b, t) => a + (b - a) * t;
    return l(l(l(at(ix, iy, iz), at(ix + 1, iy, iz), tx), l(at(ix, iy + 1, iz), at(ix + 1, iy + 1, iz), tx), ty),
             l(l(at(ix, iy, iz + 1), at(ix + 1, iy, iz + 1), tx), l(at(ix, iy + 1, iz + 1), at(ix + 1, iy + 1, iz + 1), tx), ty), tz);
  };
  const W4 = worleyGrid(4), W8 = worleyGrid(8), W16 = worleyGrid(16), W32 = worleyGrid(32);
  const data = new Uint8Array(N * N * N * 2);
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N, w = z / N;
    const perlin = (value(u, v, w, 4) * 0.5 + value(u, v, w, 8) * 0.3 + value(u, v, w, 16) * 0.2);
    const wf = (1 - worley(u, v, w, W4)) * 0.625 + (1 - worley(u, v, w, W8)) * 0.25 + (1 - worley(u, v, w, W16)) * 0.125;
    const base = clamp((perlin - (wf - 1)) / (1 - (wf - 1)) * 1.6 - 0.55, 0, 1);   // Perlin-Worley remap
    const detail = (1 - worley(u, v, w, W8)) * 0.5 + (1 - worley(u, v, w, W16)) * 0.3 + (1 - worley(u, v, w, W32)) * 0.2;
    const i = (z * N * N + y * N + x) * 2;
    data[i] = base * 255; data[i + 1] = detail * 255;
  }
  const t = new THREE.Data3DTexture(data, N, N, N);
  t.format = THREE.RGFormat; t.type = THREE.UnsignedByteType;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping; t.minFilter = t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

export const cloudU = { uCover: { value: 0.44 }, uBottom: { value: 1500 }, uTop: { value: 2700 } };
export const cloudPal = { lit: new THREE.Color(1, 1, 1), shade: new THREE.Color(0.6, 0.65, 0.85), dir: new THREE.Vector3(0, 1, 0) }; // set from the sky palette
const tCloud = makeCloudNoise();
// three clones texture uniforms per material; these are static, shared textures (and Texture.copy drops wrapR)
tCloud.clone = () => tCloud; S.tNoise.value.clone = () => S.tNoise.value;

// ---------------------------------------------------------------- cloud shadows on everything lit by the sun
// The sun (every directional light) is attenuated by the same cloud field the ray-marcher draws, sampled where the
// light ray crosses the middle of the cloud layer, so shadows drift across the land with the clouds above them.
// Uniforms go into three's lit ShaderLib entries; plain {x,y,z,w} objects survive per-material cloning by reference.
export const cloudShadow = { p: { x: 0, y: 0.5, z: 2050, w: 0.5 }, sun: { x: 0, y: 1, z: 0 } }; // p: time, cover, mid height, strength
for (const k in THREE.ShaderLib) {
  const u = THREE.ShaderLib[k].uniforms;
  if (u && u.directionalLights) Object.assign(u, { tCloudNoise: { value: S.tNoise.value }, tCloudShape: { value: tCloud }, cloudShadowP: { value: cloudShadow.p }, cloudSunDir: { value: cloudShadow.sun } });
}
// the shade function, for custom vertex shaders too (grass / foliage evaluate it per vertex: far cheaper under overdraw)
export const CLOUD_SHADE_GLSL = /* glsl */`
  uniform sampler2D tCloudNoise; uniform sampler3D tCloudShape; uniform vec4 cloudShadowP; uniform vec3 cloudSunDir;
  float cloudShade(vec3 wp){
    if (cloudShadowP.w <= 0.0 || cloudSunDir.y < 0.02) return 1.0;
    vec3 p = wp + cloudSunDir * ((cloudShadowP.z - wp.y) / cloudSunDir.y);
    float t = cloudShadowP.x;
    vec2 wx = (p.xz + vec2(t * 7.0, t * 2.5) * 0.6) * 0.000028;
    float weather = texture(tCloudNoise, wx).r * 0.75 + texture(tCloudNoise, wx * 3.3 + 0.2).g * 0.25;
    float cov = clamp(weather * 1.25 + cloudShadowP.y - 0.62, 0.0, 1.0);
    vec3 wind = vec3(t * 7.0, 0.0, t * 2.5);
    float shape = texture(tCloudShape, (p + wind) * 0.00016).r;
    float d = clamp((shape - (1.0 - cov)) / max(cov, 0.05), 0.0, 1.0);
    float det = texture(tCloudShape, (p + wind * 1.6) * 0.0012).g;
    d = clamp(d - det * 0.3 * (1.0 - d), 0.0, 1.0);
    return mix(1.0, 0.14, smoothstep(0.01, 0.12, d) * cloudShadowP.w);
  }`;
THREE.ShaderChunk.lights_pars_begin += /* glsl */`
  #ifdef CLOUD_SHADE_VARYING
    varying float vCloudLit;
  #else
    ${CLOUD_SHADE_GLSL}
  #endif
  vec3 cloudWorldPos(vec3 viewPos){ return cameraPosition + (vec4(viewPos, 0.0) * viewMatrix).xyz; }`;
THREE.ShaderChunk.lights_fragment_begin = THREE.ShaderChunk.lights_fragment_begin
  .replace('vec3 geometryPosition = - vViewPosition;', `vec3 geometryPosition = - vViewPosition;
#ifdef CLOUD_SHADE_VARYING
  float cloudLit = vCloudLit;
#else
  float cloudLit = cloudShade(cloudWorldPos(geometryPosition));
#endif`)
  .replace('getDirectionalLightInfo( directionalLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= cloudLit;');

export function buildClouds() {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: true, fog: false, side: THREE.BackSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    uniforms: Object.assign({ tCloud: { value: tCloud }, tNoise: S.tNoise, uTime: S.uTime, uSunDir: { value: cloudPal.dir }, uLit: { value: cloudPal.lit }, uShade: { value: cloudPal.shade }, uFogCol: S.uFogCol }, cloudU),
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      precision highp sampler3D;
      uniform sampler3D tCloud; uniform sampler2D tNoise; uniform float uTime, uCover, uBottom, uTop;
      uniform vec3 uSunDir, uLit, uShade, uFogCol;
      varying vec3 vW;
      float density(vec3 p, bool detail){
        vec3 wind = vec3(uTime * 7.0, 0.0, uTime * 2.5);
        float hf = clamp((p.y - uBottom) / (uTop - uBottom), 0.0, 1.0);
        vec2 wx = (p.xz + wind.xz * 0.6) * 0.000028;
        float weather = texture(tNoise, wx).r * 0.75 + texture(tNoise, wx * 3.3 + 0.2).g * 0.25;
        float cov = clamp(weather * 1.25 + uCover - 0.62, 0.0, 1.0);
        float shape = texture(tCloud, (p + wind) * 0.00016).r;
        float grad = smoothstep(0.0, 0.1, hf) * smoothstep(1.0, 0.35 + weather * 0.3, hf);
        float d = clamp((shape * grad - (1.0 - cov)) / max(cov, 0.05), 0.0, 1.0);
        if (detail && d > 0.0) {
          // billowy (inverted worley) erosion near the tops, wispy near the base; cores are left solid
          float det = texture(tCloud, (p + wind * 1.6) * 0.0012).g;
          det = mix(1.0 - det, det, smoothstep(0.1, 0.6, hf));
          d = clamp((d - det * 0.22 * (1.0 - d)) / (1.0 - det * 0.22 * (1.0 - d) + 1e-3), 0.0, 1.0);
        }
        return smoothstep(0.03, 0.4, d); // clean, cartoon-solid silhouettes
      }
      void main(){
        vec3 ro = cameraPosition, rd = normalize(vW - cameraPosition);
        if (rd.y < 0.015) discard;
        float t0 = max((uBottom - ro.y) / rd.y, 0.0), t1 = (uTop - ro.y) / rd.y;
        t1 = min(t1, t0 + 9000.0);
        if (t0 > 60000.0 || t1 <= t0) discard;
        const int STEPS = 48;
        float dt = (t1 - t0) / float(STEPS);
        // interleaved gradient noise, rotated each frame, only decides where the coarse search starts
        float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + fract(uTime * 60.0) * 0.618034);
        // 1) coarse search for the cloud surface, 2) binary refinement: crisp, stable anime silhouettes
        float t = t0 + dt * jit, hit = -1.0;
        for (int i = 0; i < STEPS; i++) {
          if (density(ro + rd * t, true) > 0.01) { hit = t; break; }
          t += dt;
        }
        if (hit < 0.0) discard;
        float lo = max(hit - dt, t0), hi = hit;
        for (int k = 0; k < 5; k++) { float m = 0.5 * (lo + hi); if (density(ro + rd * m, true) > 0.01) hi = m; else lo = m; }
        vec3 pe = ro + rd * hi;
        // 3) two-tone shading at the surface: light reaching it, banded; sunlit tops, flatter cooler base
        const float sigma = 0.06;
        vec3 lightDir = normalize(uSunDir + vec3(0.0, 0.05, 0.0));
        float od = 0.0, ls = (uTop - uBottom) * 0.08; vec3 lp = pe;
        for (int j = 0; j < 6; j++) { lp += lightDir * ls; od += density(lp, false) * ls; ls *= 1.35; }
        float hf = clamp((pe.y - uBottom) / (uTop - uBottom), 0.0, 1.0);
        float toon = smoothstep(0.3, 0.5, exp(-od * sigma * 0.3) + (hf - 0.45) * 0.3);
        vec3 col = mix(uShade, uLit * 1.22, toon) * mix(0.84, 1.0, smoothstep(0.0, 0.45, hf));
        // 4) opacity through the cloud behind the surface (thin wisps stay translucent)
        float OD = 0.0, tt = hi, sd = max(dt * 0.5, 25.0);
        for (int i = 0; i < 16; i++) { OD += density(ro + rd * tt, true) * sd * sigma; tt += sd; if (OD > 6.0 || tt > t1) break; }
        float alpha = 1.0 - exp(-OD);
        float back = pow(max(dot(rd, uSunDir), 0.0), 4.0);
        col += uLit * back * (1.0 - smoothstep(0.0, 3.0, OD)) * 0.9;   // backlit thin edges glow
        col = mix(col, uFogCol, 1.0 - exp(-t0 * 0.000055));
        alpha *= smoothstep(0.015, 0.06, rd.y);
        gl_FragColor = vec4(col * alpha, alpha);   // premultiplied
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(9000, 32, 16), mat);
  m.frustumCulled = false; m.renderOrder = 1;
  m.userData.dynamic = true; scene.add(m);
  return m;
}
