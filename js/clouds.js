// Volumetric cumulus: ray-marched through a 3D Perlin-Worley noise volume, lit with Beer-Lambert extinction,
// a dual-lobe Henyey-Greenstein phase function and a powder term; ambient from the sky probe.
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

export const cloudU = { uCover: { value: 0.5 }, uBottom: { value: 1500 }, uTop: { value: 2700 } };
export function buildClouds() {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: true, fog: false, side: THREE.BackSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    uniforms: Object.assign({ tCloud: { value: makeCloudNoise() }, tNoise: S.tNoise, uTime: S.uTime, uSunDir: S.uSunDir, uSunCol: S.uSunCol, uAmb: S.uAmb, uFogCol: S.uFogCol }, cloudU),
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      precision highp sampler3D;
      uniform sampler3D tCloud; uniform sampler2D tNoise; uniform float uTime, uCover, uBottom, uTop;
      uniform vec3 uSunDir, uSunCol, uAmb, uFogCol;
      varying vec3 vW;
      float hg(float c, float g){ float g2 = g * g; return (1.0 - g2) / (12.566 * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5)); }
      float density(vec3 p, bool detail){
        vec3 wind = vec3(uTime * 7.0, 0.0, uTime * 2.5);
        float hf = clamp((p.y - uBottom) / (uTop - uBottom), 0.0, 1.0);
        vec2 wx = (p.xz + wind.xz * 0.6) * 0.000028;
        float weather = texture(tNoise, wx).r * 0.75 + texture(tNoise, wx * 3.3 + 0.2).g * 0.25;
        float cov = clamp(weather * 1.25 + uCover - 0.62, 0.0, 1.0);
        float shape = texture(tCloud, (p + wind) * 0.00016).r;
        float grad = smoothstep(0.0, 0.1, hf) * smoothstep(1.0, 0.35 + weather * 0.3, hf);
        float d = clamp((shape * grad - (1.0 - cov)) / max(cov, 0.05), 0.0, 1.0);
        if (detail && d > 0.0) { float det = texture(tCloud, (p + wind * 1.6) * 0.0012).g; d = clamp(d - (1.0 - det) * 0.45 * (1.0 - d * 0.6), 0.0, 1.0); }
        return d;
      }
      void main(){
        vec3 ro = cameraPosition, rd = normalize(vW - cameraPosition);
        if (rd.y < 0.015) discard;
        float t0 = (uBottom - ro.y) / rd.y, t1 = (uTop - ro.y) / rd.y;
        t1 = min(t1, t0 + 9000.0);
        if (t0 > 60000.0) discard;
        const int STEPS = 44;
        float dt = (t1 - t0) / float(STEPS);
        float jit = fract(sin(dot(gl_FragCoord.xy + fract(uTime) * 17.0, vec2(12.9898, 78.233))) * 43758.5453);
        float t = t0 + dt * jit, T = 1.0;
        vec3 L = vec3(0.0);
        float cosT = dot(rd, uSunDir);
        float phase = mix(hg(cosT, 0.65), hg(cosT, -0.2), 0.35);
        float sunUp = smoothstep(-0.12, 0.08, uSunDir.y);
        vec3 lightDir = normalize(uSunDir + vec3(0.0, 0.05, 0.0));
        for (int i = 0; i < STEPS; i++) {
          vec3 p = ro + rd * t;
          float d = density(p, true);
          if (d > 0.003) {
            float od = 0.0, ls = (uTop - uBottom) * 0.1;
            vec3 lp = p;
            for (int j = 0; j < 5; j++) { lp += lightDir * ls; od += density(lp, false) * ls; ls *= 1.3; }
            float sigma = 0.02;
            float beer = exp(-od * sigma * 0.5) + 0.25 * exp(-od * sigma * 0.12);   // multi-scatter approximation
            float powder = 1.0 - exp(-d * 60.0 * sigma);
            float hf = (p.y - uBottom) / (uTop - uBottom);
            vec3 Sc = uSunCol * sunUp * beer * phase * 7.0 * mix(0.6, 1.0, powder) + uAmb * mix(0.55, 1.35, hf) * 1.3;
            float a = exp(-d * dt * sigma);
            L += T * (1.0 - a) * Sc;
            T *= a;
            if (T < 0.015) break;
          }
          t += dt;
        }
        float fogF = 1.0 - exp(-t0 * 0.000055);
        L = mix(L, uFogCol * (1.0 - T), fogF);
        float a = (1.0 - T) * smoothstep(0.015, 0.06, rd.y);
        gl_FragColor = vec4(L * smoothstep(0.015, 0.06, rd.y), a);
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(9000, 32, 16), mat);
  m.frustumCulled = false; m.renderOrder = 1;
  scene.add(m);
  return m;
}
