// Shared engine core: renderer, scene, camera, quality, noise, loaders, atmospheric fog, instancing helpers.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
export { THREE };

// ---------------------------------------------------------------- math / noise
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
// yield to the browser between build steps. A message-channel task, not setTimeout: timers in a background tab are
// throttled to once a minute, which would stall a load the player switched away from
// (one long-lived channel: a throwaway channel's ports can be garbage-collected before the message arrives)
const tickCh = new MessageChannel(), tickQ = [];
tickCh.port1.onmessage = () => { const r = tickQ.shift(); if (r) r(); };
export const tick = () => new Promise(r => { let done = false; const go = () => { if (!done) { done = true; r(); } }; tickQ.push(go); tickCh.port2.postMessage(0); setTimeout(go, 50); });

let SEED = 20260926;
export function setSeed(s) { SEED = s | 0; }
export function hash2(ix, iy) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + SEED) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const _n = [0, 0, 0];
// value noise in [-1,1] with analytic derivatives
export function noised(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const dux = 30 * fx * fx * (fx * (fx - 2) + 1), duy = 30 * fy * fy * (fy * (fy - 2) + 1);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  const k1 = b - a, k2 = c - a, k4 = a - b - c + d;
  _n[0] = 2 * (a + k1 * ux + k2 * uy + k4 * ux * uy) - 1;
  _n[1] = 2 * dux * (k1 + k4 * uy);
  _n[2] = 2 * duy * (k2 + k4 * ux);
  return _n;
}
export function fbm(x, y, oct) {
  let a = 0, b = 0.5, n = 0;
  for (let i = 0; i < oct; i++) {
    a += b * noised(x, y)[0]; n += b; b *= 0.5;
    const nx = 1.6 * x - 1.2 * y, ny = 1.2 * x + 1.6 * y; x = nx + 1.7; y = ny - 3.1;
  }
  return a / n;
}
// derivative-damped fbm: eroded-looking ridges and valleys
export function erosion(x, y, oct = 8) {
  let a = 0, b = 1, dx = 0, dy = 0, n = 0;
  for (let i = 0; i < oct; i++) {
    const r = noised(x, y);
    dx += r[1]; dy += r[2];
    a += b * r[0] / (1 + dx * dx + dy * dy);
    n += b; b *= 0.5;
    const nx = 1.6 * x - 1.2 * y, ny = 1.2 * x + 1.6 * y; x = nx; y = ny;
  }
  return a / n;
}

// ---------------------------------------------------------------- quality presets
export const QUALITY = {
  low:    { pr: 0.75, grass: 220000, tile: 56,  shadow: 2048, box: 90,  msaa: 0, ao: false, treeHi: 140, trees: 1100, rocks: 160, props: 120, ferns: 60,  bloom: false, refl: 0.3 },
  medium: { pr: 1.0,  grass: 380000, tile: 64,  shadow: 2048, box: 120, msaa: 4, ao: false, treeHi: 200, trees: 1600, rocks: 230, props: 180, ferns: 80,  bloom: true,  refl: 0.4 },
  high:   { pr: 1.0,  grass: 620000, tile: 76,  shadow: 4096, box: 190, msaa: 4, ao: true,  treeHi: 260, trees: 2400, rocks: 320, props: 260, ferns: 100, bloom: true,  refl: 0.5 },
  ultra:  { pr: 1.35, grass: 1100000, tile: 100, shadow: 4096, box: 260, msaa: 8, ao: true,  treeHi: 380, trees: 3600, rocks: 480, props: 400, ferns: 150, bloom: true,  refl: 0.7, far: 3 },
  // no compromises: supersampled, 8k shadows, the densest grass and every far-forest ring
  extreme: { pr: 1.5, grass: 1600000, tile: 124, shadow: 8192, box: 300, msaa: 8, ao: true,  treeHi: 520, trees: 5000, rocks: 700, props: 560, ferns: 220, bloom: true,  refl: 0.9, far: 4 },
};
QUALITY.low.far = 1; QUALITY.medium.far = 1; QUALITY.high.far = 2; // far: how many outer far-forest rings are drawn
// cascaded sun shadows: [half extent (m), map size] per cascade, finest first, and how often each re-renders (frames)
QUALITY.high.taa = QUALITY.ultra.taa = QUALITY.extreme.taa = true; // temporal anti-aliasing (post.js)
QUALITY.low.lodScale = 0.6; QUALITY.medium.lodScale = 0.8; QUALITY.high.lodScale = 1; QUALITY.ultra.lodScale = 1.3; QUALITY.extreme.lodScale = 1.7; // detail draw distance
Object.assign(QUALITY.low, { csm: [[40, 2048], [150, 2048]], csmRate: [1, 2] });
Object.assign(QUALITY.medium, { csm: [[26, 2048], [100, 2048], [340, 2048]], csmRate: [1, 1, 3] });
Object.assign(QUALITY.high, { csm: [[20, 2048], [70, 4096], [240, 4096], [640, 2048]], csmRate: [1, 1, 2, 4] });
Object.assign(QUALITY.ultra, { csm: [[16, 4096], [56, 4096], [200, 4096], [640, 2048]], csmRate: [1, 1, 2, 3] });
Object.assign(QUALITY.extreme, { csm: [[14, 4096], [50, 4096], [180, 4096], [640, 4096]], csmRate: [1, 1, 2, 3] });
// grass distance hierarchy, one entry per ring: [outer radius (m), density (per m²)]
//   ring 0: full animated blades, ring 1: simplified wide blades, ring 2: clump cards, ring 3: meadow cards,
//   ring 4: wide meadow cards reaching past the map edge. A radius of 0 switches the ring off. Beyond the last ring the
//   ground shader paints the meadow (tufts, wind-combed streaks, micro-shadowing), so grass never visibly ends.
QUALITY.low.grassR = [[28, 70], [0, 0], [126, 1.1], [560, 0.02], [0, 0]];
QUALITY.medium.grassR = [[32, 90], [0, 0], [150, 1.45], [720, 0.04], [0, 0]];
QUALITY.high.grassR = [[36, 100], [62, 34], [210, 1.6], [1000, 0.05], [0, 0]];
QUALITY.ultra.grassR = [[44, 105], [90, 40], [320, 1.75], [1350, 0.07], [2300, 0.018]];
QUALITY.extreme.grassR = [[50, 110], [115, 46], [460, 1.9], [1650, 0.085], [2900, 0.024]];
export const MAX_GRASS = 1600000;
// supersampling never goes past ~8.3 million pixels (4K), so a 4K screen on Extreme renders natively instead of at 6K
export const pixelRatio = () => { const d = Math.min(devicePixelRatio, 2) * Q.pr, px = innerWidth * innerHeight; return Math.max(Math.min(d, Math.sqrt(8.3e6 / Math.max(px, 1))), Math.min(devicePixelRatio, 1)); };
export const Q = { name: 'high' };
{
  let s = 'high';
  try { const v = localStorage.getItem('wl_quality'); if (QUALITY[v]) s = v; } catch (e) {}
  Object.assign(Q, QUALITY[s], { name: s });
}

// ---------------------------------------------------------------- renderer / scene / camera
// Reversed-Z: with a float depth buffer, depth precision stays nearly constant relative to distance, so layered
// geometry (road, markings, kerbs, terrain under them) stays stable from the street to 20 km out. Needs
// EXT_clip_control (desktop Chrome/Edge/Firefox have it); without it three silently keeps standard depth.
// ?revz=0 keeps standard depth (A/B testing of the depth path)
export const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false, reverseDepthBuffer: !/[?&]revz=0/.test(location.search) });
export const depthReversed = renderer.state.buffers.depth.getReversed();
function applyReversedDepth() {
  const clip = renderer.extensions.get('EXT_clip_control'), db = renderer.state.buffers.depth;
  db.reset(); db.setReversed(true);                                   // drops the stale cached clear value
  clip.clipControlEXT(clip.LOWER_LEFT_EXT, clip.ZERO_TO_ONE_EXT);
  db.setClear(1);                                                     // stored flipped: clears to 0
}
// run a render with standard depth (three's PMREM generator is not reversed-depth aware in r170)
export function withStandardDepth(fn) {
  if (!depthReversed) return fn();
  const clip = renderer.extensions.get('EXT_clip_control'), db = renderer.state.buffers.depth;
  db.reset(); clip.clipControlEXT(clip.LOWER_LEFT_EXT, clip.NEGATIVE_ONE_TO_ONE_EXT); db.setClear(1);
  try { return fn(); } finally { applyReversedDepth(); }
}
if (depthReversed) {
  // three r170 enables reversed depth with the wrong clip-control mode and keeps a cached depth-clear of 1: set the
  // [0,1] clip range (full float precision) and a depth clear of 0 (the far plane) ourselves
  applyReversedDepth();
  // polygon offsets are written for standard depth (negative = toward the camera): flip them for reversed depth
  const setPO = renderer.state.setPolygonOffset;
  renderer.state.setPolygonOffset = (on, factor, units) => setPO(on, -factor, -units);
}
// shadow maps store standard [0,1] depth even when the view is rendered reversed (the lookup side uses the unreversed
// shadow matrix)
THREE.ShaderLib.depth.fragmentShader = THREE.ShaderLib.depth.fragmentShader.replace(
  'float fragCoordZ = 0.5 * vHighPrecisionZW[0] / vHighPrecisionZW[1] + 0.5;',
  `#ifdef USE_REVERSEDEPTHBUF
	float fragCoordZ = 1.0 - vHighPrecisionZW[0] / vHighPrecisionZW[1];
#else
	float fragCoordZ = 0.5 * vHighPrecisionZW[0] / vHighPrecisionZW[1] + 0.5;
#endif`);
if (!THREE.ShaderLib.depth.fragmentShader.includes('USE_REVERSEDEPTHBUF')) console.warn('depth chunk patch failed');
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(pixelRatio());
renderer.toneMapping = THREE.NeutralToneMapping; // keeps hues and saturation intact (the look is painted, not filmic)
renderer.toneMappingExposure = 1.0; // the real exposure is applied when the scene is resolved (post.js)
// Opaque draw order: solid surfaces, then alpha-tested foliage, then grass, then the terrain (the sky comes after all, by
// its renderOrder). Drawn last, the terrain's layered shader is depth-rejected wherever something stands on it, and the
// foliage wherever a wall hides it; within a class three's order (by material, then front to back) keeps state changes
// few. Measured: 0.7-1 ms of GPU time where the ground is mostly covered (park, aerial view), the image unchanged.
// (the class is kept on the material: the sort runs a few hundred thousand comparisons a second)
const drawClass = m => { let c = m._drawClass; if (c === undefined) c = m._drawClass = m.userData.drawClass ?? (m.alphaTest > 0 ? 1 : 0); return c; };
renderer.setOpaqueSort((a, b) => {
  if (a.groupOrder !== b.groupOrder) return a.groupOrder - b.groupOrder;
  if (a.renderOrder !== b.renderOrder) return a.renderOrder - b.renderOrder;
  const ma = a.material, mb = b.material;
  if (ma !== mb) { const ca = drawClass(ma), cb = drawClass(mb); if (ca !== cb) return ca - cb; return ma.id - mb.id; }
  return a.z !== b.z ? a.z - b.z : a.id - b.id;
});
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
export const maxAniso = renderer.capabilities.getMaxAnisotropy();

export const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xa8b8c8, 0.00032);
export const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.2, 26000);
camera.rotation.order = 'YXZ';
camera.layers.enable(1); // layer 1: rendered normally but skipped by water reflections
camera.layers.enable(3); // layer 3: fine building detail — drawn, shadowed only by the near cascades, not reflected

export const sunDir = new THREE.Vector3(0, 1, 0);
// shared uniforms (objects are shared by reference between materials)
export const S = {
  uTime: { value: 0 }, uWind: { value: 0.6 },
  uSunDir: { value: sunDir }, uSunCol: { value: new THREE.Vector3() }, uSunViewDir: { value: new THREE.Vector3() },
  uLightDir: { value: new THREE.Vector3(0, 1, 0) }, // sun by day, moon by night
  uAmb: { value: new THREE.Vector3() }, uFogCol: { value: new THREE.Vector3() },
  uCam: { value: new THREE.Vector3() }, uPlayer: { value: new THREE.Vector3() },
  tNoise: { value: null },
  // the wind (see `wind` below): direction it blows toward, how far the air has travelled, the phase of its waves
  uWindDir: { value: new THREE.Vector2(0.94, 0.33) }, uWindOff: { value: new THREE.Vector2() }, uWindPhase: { value: 0 },
  uWindBase: { value: 0.6 },   // (the strength without its gusts: for what integrates the wind over a long flight)
};

// ---------------------------------------------------------------- the wind
// One wind state for everything that moves in it — grass, trees, bushes, hedges, flowers, petals, motes — kept on the
// CPU and handed to every shader as the shared uniforms above (uWind: the strength, 0 calm .. ~1.6 a strong gust):
//  - the direction drifts slowly and now and then swings round (sums of slow sines of time, so it never jumps)
//  - the strength runs through calm spells and windy spells over minutes, with gusts on top while it blows
//  - the air's travel (uWindOff) is integrated frame by frame along the current direction: the gust patches it carries
//    (windAt) drift downwind and keep drifting smoothly as the direction turns; the waves that run downwind through
//    grass and crowns (windRoll) advance by an integrated phase for the same reason
// Everything samples the field at its own position, so a gust is seen crossing a meadow and then reaching the trees.
export const wind = {
  angle: 0.34, strength: 0.6, base: 0.6, gust: 0,
  update(dt, t, still = false) {
    const T = 2 * Math.PI;
    this.angle = 0.34 + 0.55 * Math.sin(T * t / 900) + 0.3 * Math.sin(T * t / 370 + 1.1) + 0.12 * Math.sin(T * t / 97 + 2.3);
    this.base = clamp(0.5 + 0.42 * Math.sin(T * t / 640 + 0.7) + 0.2 * Math.sin(T * t / 230 + 2.1), 0.05, 1.1);
    const g1 = Math.max(0, Math.sin(T * t / 23 + 1.7 * Math.sin(t * 0.13))), g2 = Math.max(0, Math.sin(T * t / 7.3 + 1));
    this.gust = g1 * g1 * g1 * 0.6 + g2 * g2 * g2 * g2 * 0.25;
    this.strength = still ? 0 : this.base * (1 + this.gust * smoothstep(0.15, 0.4, this.base));
    const d = S.uWindDir.value.set(Math.cos(this.angle), Math.sin(this.angle));
    if (!still) { S.uWindOff.value.addScaledVector(d, (2 + 5 * this.strength) * dt); S.uWindPhase.value = (S.uWindPhase.value + dt * (1.2 + 1.6 * this.strength)) % (2 * Math.PI * 64); }
    S.uWind.value = this.strength; S.uWindBase.value = still ? 0 : this.base;
  },
};
// GLSL: declares the wind's uniforms (uWind and the noise sampler are the caller's) and
//   windAt(tex, p): the strength at p — the global strength carried in gust patches drifting downwind (0.3x .. 1.9x)
//   windRoll(p, k): a wave of wavenumber k running downwind, 0..1
export const GLSL_WIND = /* glsl */`
uniform vec2 uWindDir, uWindOff; uniform float uWindPhase;
float windAt(sampler2D tex, vec2 p) { float n = textureLod(tex, (p - uWindOff) * 0.012, 0.0).r; return uWind * (0.3 + 1.6 * n * n); }
float windRoll(vec2 p, float k) { return sin(dot(p, uWindDir) * k - uWindPhase) * 0.5 + 0.5; }
`;

// ---------------------------------------------------------------- atmospheric fog
// Replaces three's fog with height-attenuated exponential fog plus forward in-scattering toward the sun.
// Plain {x,y,z} objects survive UniformsUtils.clone by reference, so every material sees live values.
export const fogU = {
  fogSunDir: { value: { x: 0, y: 1, z: 0 } },
  fogSunColor: { value: { x: 0, y: 0, z: 0 } },
  fogParams: { value: { x: 0, y: 1 / 200, z: 0 } }, // x: camera height above fog base, y: height falloff
  fogMist: { value: { x: 0, y: 1 / 11 } },           // low ground mist layer: x density, y height falloff
  fogHaze: { value: { x: 600, y: 0 } },              // aerial haze toward the draw distance: x start (m), y density per metre
};
for (const k in THREE.ShaderLib) { const u = THREE.ShaderLib[k].uniforms; if (u && u.fogColor) Object.assign(u, fogU); }
Object.assign(THREE.UniformsLib.fog, fogU);
THREE.ShaderChunk.fog_pars_vertex = '#ifdef USE_FOG\n\tvarying float vFogDepth;\n\tvarying vec3 vFogDir;\n#endif';
THREE.ShaderChunk.fog_vertex = '#ifdef USE_FOG\n\tvFogDepth = - mvPosition.z;\n\tvFogDir = ( vec4( mvPosition.xyz, 0.0 ) * viewMatrix ).xyz;\n#endif';
THREE.ShaderChunk.fog_pars_fragment = /* glsl */`#ifdef USE_FOG
	uniform vec3 fogColor; uniform vec3 fogSunDir; uniform vec3 fogSunColor; uniform vec3 fogParams; uniform vec2 fogMist; uniform vec2 fogHaze;
	varying float vFogDepth; varying vec3 vFogDir;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear; uniform float fogFar;
	#endif
#endif`;
THREE.ShaderChunk.fog_fragment = /* glsl */`#ifdef USE_FOG
	float fDist = length( vFogDir );
	vec3 fDir = vFogDir / max( fDist, 1e-4 );
	#ifdef FOG_EXP2
		float fk = fogParams.y;
		float fdy = clamp( fDir.y * fDist * fk, -8.0, 60.0 );
		float fH = exp( - clamp( fk * fogParams.x, -8.0, 60.0 ) ) * ( abs( fdy ) > 1e-3 ? ( 1.0 - exp( - fdy ) ) / fdy : 1.0 );
		float fOD = fogDensity * fDist * fH;
		if ( fogMist.x > 0.0 ) {
			float mk = fogMist.y, mdy = clamp( fDir.y * fDist * mk, -8.0, 60.0 );
			fOD += fogMist.x * fDist * exp( - clamp( mk * fogParams.x, -8.0, 60.0 ) ) * ( abs( mdy ) > 1e-3 ? ( 1.0 - exp( - mdy ) ) / mdy : 1.0 );
		}
		fOD += fogHaze.y * max( fDist - fogHaze.x, 0.0 ); // distant scenery melts into the sky colour before the draw distance
		float fogFactor = 1.0 - exp( - fOD );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	float fSun = pow( max( dot( fDir, fogSunDir ), 1e-4 ), 10.0 );
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor + fogSunColor * fSun, fogFactor );
#endif`;

// ---------------------------------------------------------------- loading
export const manager = new THREE.LoadingManager();
export const loadState = { label: '', gen: 0, assets: 0 };
export const texLoader = new THREE.TextureLoader(manager);
export const gltfLoader = new GLTFLoader(manager);
manager.onProgress = (url, a, b) => { loadState.assets = a / b; };
const texCache = new Map();
export function loadTex(file, srgb, fallback = [128, 128, 128]) {
  const key = file + (srgb ? '|s' : '');
  if (texCache.has(key)) return texCache.get(key);
  const t = texLoader.load('assets/' + file, undefined, undefined, () => {
    const c = document.createElement('canvas'); c.width = c.height = 2;
    const g = c.getContext('2d'); g.fillStyle = `rgb(${fallback.join(',')})`; g.fillRect(0, 0, 2, 2);
    t.image = c; t.needsUpdate = true;
  });
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = maxAniso;
  if (file.startsWith('tex/')) t.userData.photo = true; // scanned: flattened by the toon look (toon.js)
  texCache.set(key, t);
  return t;
}
export const NFLAT = [128, 128, 255];
export const phTex = (name, kind, res, srgb, fb) => loadTex(`tex/${name}_${kind}_${res}.jpg`, srgb, fb);
const modelCache = new Map();
export function loadModel(name) {
  if (!modelCache.has(name)) modelCache.set(name, new Promise(res =>
    gltfLoader.load(`assets/models/${name}/${name}_1k.gltf`, g => { g.scene.traverse(o => { if (o.material && o.material.map) o.material.map.userData.photo = true; }); res(g.scene); }, undefined, () => res(null))));
  return modelCache.get(name);
}

// ---------------------------------------------------------------- procedural textures
export function makeNoiseTexture() {
  const N = 256, data = new Uint8Array(N * N * 4);
  const chan = (c, base, oct, seed) => {
    const vals = new Float32Array(N * N);
    let amp = 1, tot = 0;
    for (let o = 0; o < oct; o++) {
      const P = base << o, rng = mulberry32(seed + o * 131);
      const lat = new Float32Array(P * P); for (let k = 0; k < P * P; k++) lat[k] = rng();
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const gx = x / N * P, gy = y / N * P, ix = Math.floor(gx), iy = Math.floor(gy);
        let fx = gx - ix, fy = gy - iy; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
        const a = lat[(iy % P) * P + ix % P], b = lat[(iy % P) * P + (ix + 1) % P], cc = lat[((iy + 1) % P) * P + ix % P], d = lat[((iy + 1) % P) * P + (ix + 1) % P];
        vals[y * N + x] += amp * lerp(lerp(a, b, fx), lerp(cc, d, fx), fy);
      }
      tot += amp; amp *= 0.5;
    }
    for (let k = 0; k < N * N; k++) data[k * 4 + c] = clamp(((vals[k] / tot) - 0.5) * 1.8 + 0.5, 0, 1) * 255;
  };
  chan(0, 4, 5, 11); chan(1, 8, 4, 23); chan(2, 16, 3, 37); chan(3, 32, 2, 51);
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.needsUpdate = true;
  t.userData.data = data;
  return t;
}
S.tNoise.value = makeNoiseTexture();
// CPU copy of the GPU's bilinear, repeating tNoise lookup (channel c), so scattering on the CPU matches shader masks
export function noiseAt(u, v, c) {
  const N = 256, D = S.tNoise.value.userData.data, x = u * N - 0.5, y = v * N - 0.5, ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const at = (i, j) => D[((((j % N) + N) % N) * N + (((i % N) + N) % N)) * 4 + c];
  return lerp(lerp(at(ix, iy), at(ix + 1, iy), fx), lerp(at(ix, iy + 1), at(ix + 1, iy + 1), fx), fy) / 255;
}

// ---------------------------------------------------------------- collisions (circles + oriented boxes, spatial hash)
const COL_CELL = 16;
export const colliders = new Map();
function colKeys(minX, minZ, maxX, maxZ, fn) {
  for (let z = Math.floor(minZ / COL_CELL); z <= Math.floor(maxZ / COL_CELL); z++)
    for (let x = Math.floor(minX / COL_CELL); x <= Math.floor(maxX / COL_CELL); x++) fn(x + ',' + z);
}
function colAdd(c, minX, minZ, maxX, maxZ) {
  colKeys(minX, minZ, maxX, maxZ, k => { if (!colliders.has(k)) colliders.set(k, []); colliders.get(k).push(c); });
}
export function addCircle(x, z, r, y0 = -1e9, y1 = 1e9) { colAdd({ t: 0, x, z, r, y0, y1 }, x - r, z - r, x + r, z + r); }
// box centred at (x,z), half extents hx,hz, rotated by angle a around Y, spanning heights y0..y1
export function addBox(x, z, hx, hz, a = 0, y0 = -1e9, y1 = 1e9) {
  const R = Math.hypot(hx, hz);
  colAdd({ t: 1, x, z, hx, hz, c: Math.cos(a), s: Math.sin(a), y0, y1 }, x - R, z - R, x + R, z + R);
}
export function clearColliders(x, z, r) {
  for (const [k, list] of colliders) colliders.set(k, list.filter(c => c.t !== 0 || Math.hypot(c.x - x, c.z - z) >= r));
}
// push point p (x,z; feet y) out of colliders, player radius pr
export function collide(p, pr = 0.35, height = 1.7) {
  const seen = new Set();
  colKeys(p.x - 1, p.z - 1, p.x + 1, p.z + 1, k => {
    const list = colliders.get(k); if (!list) return;
    for (const c of list) {
      if (seen.has(c)) continue; seen.add(c);
      if (p.y + height < c.y0 || p.y > c.y1 - 0.35) continue; // can step onto low boxes
      if (c.t === 0) {
        const ex = p.x - c.x, ez = p.z - c.z, d = Math.hypot(ex, ez), m = c.r + pr;
        if (d < m && d > 1e-5) { p.x = c.x + ex / d * m; p.z = c.z + ez / d * m; }
      } else {
        const dx = p.x - c.x, dz = p.z - c.z;
        let lx = dx * c.c - dz * c.s, lz = dx * c.s + dz * c.c; // world -> box local (rotate by -a)
        const ox = c.hx + pr - Math.abs(lx), oz = c.hz + pr - Math.abs(lz);
        if (ox > 0 && oz > 0) {
          if (ox < oz) lx += Math.sign(lx || 1) * ox; else lz += Math.sign(lz || 1) * oz;
          p.x = c.x + lx * c.c + lz * c.s; p.z = c.z - lx * c.s + lz * c.c;
        }
      }
    }
  });
}
// highest walkable box top under a point (for platforms, steps)
export function standHeight(x, z, feetY) {
  let best = -1e9;
  colKeys(x, z, x, z, k => {
    const list = colliders.get(k); if (!list) return;
    for (const c of list) {
      if (c.t !== 1 || c.y1 > feetY + 0.45 || !c.walk) continue;
      const dx = x - c.x, dz = z - c.z, lx = dx * c.c - dz * c.s, lz = dx * c.s + dz * c.c;
      if (Math.abs(lx) <= c.hx && Math.abs(lz) <= c.hz) best = Math.max(best, c.y1);
    }
  });
  return best;
}
export function addPlatform(x, z, hx, hz, a, top) {
  const R = Math.hypot(hx, hz);
  colAdd({ t: 1, walk: true, x, z, hx, hz, c: Math.cos(a), s: Math.sin(a), y0: -1e9, y1: top }, x - R, z - R, x + R, z + R);
}

// ---------------------------------------------------------------- cell-based instancing with per-item LOD + culling
export const scatters = [];
const _white = new THREE.Color(1, 1, 1);
const _sm = new THREE.Matrix4(), _sq = new THREE.Quaternion(), _ss = new THREE.Vector3(), _sp = new THREE.Vector3(), _se = new THREE.Euler();
const SC_MOVE = 2, SC_BUDGET = 60000; // re-evaluate a straddling cell after the camera moved this far; items per frame
// Scenery repeated many times (trees, bushes, rocks, props, bicycles), drawn as instanced meshes per spatial cell.
// Every item keeps its index in scatter.items as its identity; its transform and colour live in scatter.mat / scatter.col
// and the renderer shows it wherever its level of detail currently puts it (locate(i), setItemMatrix(i, m)).
// With several levels of detail each item picks its level from its own distance to the camera (with a little hysteresis),
// so a level switches at the same distance for every item instead of a whole cell at once:
//   level 0 (full detail, near) is bounded tightly round the items currently at it, so what is behind the camera is
//   culled; the far levels keep their cell's bounds (cells widened for sparse or light far levels, see below).
// Each cell and level draws a compact list of the items at that level; an item changing level is appended to one list
// and swap-removed from the other, so only a couple of instance slots are rewritten and uploaded per change.
// A single-level scatter keeps whole-cell visibility (cells within the level's distance are drawn).
const cp16 = (d, dk, s, si) => { for (let j = 0; j < 16; j++) d[dk + j] = s[si + j]; }, cp3 = (d, dk, s, si) => { d[dk] = s[si]; d[dk + 1] = s[si + 1]; d[dk + 2] = s[si + 2]; };
export class Scatter {
  // items: {x,y,z,s,sx?,sy?,r?,tilt?,tilt2?,c?}; lods: [{dist: () => metres, parts: [{geometry, material, tint?, castShadow?, depth?, receiveShadow?}]}]
  constructor(items, lods, cellSize, origin = 4096) {
    this.items = items; this.lods = lods; this.id = scatters.length; this.multi = lods.length > 1;
    const N = items.length;
    this.mat = new Float32Array(N * 16); this.scale = new Float32Array(N);
    items.forEach((it, i) => {
      _se.set(it.tilt || 0, it.r || 0, it.tilt2 || 0); _sq.setFromEuler(_se);
      _ss.set(it.s * (it.sx || 1), it.s * (it.sy || 1), it.s * (it.sz || it.sx || 1)); _sp.set(it.x, it.y, it.z);
      _sm.compose(_sp, _sq, _ss).toArray(this.mat, i * 16);
      this.scale[i] = it.s * Math.max(it.sx || 1, it.sy || 1, it.sz || it.sx || 1);
    });
    // instance colours per tint key (tint: true = it.c, or another item key); a tinted part always carries them (white
    // where an item has none), so every mesh sharing a material has the same shader variant
    this.col = new Map();
    for (const lod of lods) for (const part of lod.parts) if (part.tint && !this.col.has(part.tint)) {
      const a = new Float32Array(N * 3);
      items.forEach((it, i) => { const c = (part.tint === true ? it.c : it[part.tint]) || _white; a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; });
      this.col.set(part.tint, a);
    }
    const group = size => { const m = new Map(); items.forEach((it, i) => { const k = Math.floor((it.x + origin) / size) + ',' + Math.floor((it.z + origin) / size); if (!m.has(k)) m.set(k, []); m.get(k).push(i); });
      return [...m].map(([k, list]) => { const [ci, cj] = k.split(',').map(Number); return { minX: -origin + ci * size, maxX: -origin + (ci + 1) * size, minZ: -origin + cj * size, maxZ: -origin + (cj + 1) * size, idx: Int32Array.from(list) }; }); };
    if (!this.multi) {
      this.cells = group(cellSize);
      for (const c of this.cells) { c.box = this._box(0, c.idx, true); c.cur = -2; }
      scatters.push(this);
      return;
    }
    this.fine = group(cellSize);
    // the far levels' cells are widened until a cell holds about 12k triangles: a draw call costs about as much GPU time
    // as that many off-screen triangles (measured), so sparse species and card levels share few wide cells while dense
    // stands keep the fine ones
    let farTris = 0; for (let l = 1; l < lods.length; l++) for (const p of lods[l].parts) farTris += (p.geometry.index ? p.geometry.index.count : p.geometry.attributes.position.count) / 3;
    const perCell = N * farTris / Math.max(1, this.fine.length), grow = Math.min(8, 2 ** Math.max(0, Math.floor(Math.log2(Math.sqrt(12000 / Math.max(perCell, 1))))));
    this.coarse = grow > 1 ? group(cellSize * grow) : this.fine.map(c => ({ ...c })); this.cells = this.coarse;
    this.lod = new Int8Array(N).fill(-2); this.slot = new Int32Array(N); this.fineOf = new Int32Array(N); this.coarseOf = new Int32Array(N);
    this.fine.forEach((c, ci) => { for (const i of c.idx) this.fineOf[i] = ci; c.box = this._box(0, c.idx, false); c.box.tight = true; });
    this.coarse.forEach((c, ci) => { for (const i of c.idx) this.coarseOf[i] = ci; c.boxes = lods.map((lod, l) => l === 0 ? null : this._box(l, c.idx, false)); c.uniform = -3; c.ex = c.ez = 1e9; });
    this.boxes = []; for (const c of this.fine) this.boxes.push(c.box); for (const c of this.coarse) for (const b of c.boxes) if (b) this.boxes.push(b);
    this.D = new Float64Array(lods.length); this.Dkey = ''; this.primed = false;
    scatters.push(this);
  }
  // a cell's draw list for one level: one instanced mesh per part over (at most) the items idx
  _box(l, idx, full) {
    const parts = this.lods[l].parts, n = idx.length;
    const box = { l, parts, list: full ? idx : new Int32Array(n), n: full ? n : 0, dirty: [], tight: false, meshes: [] };
    for (const part of parts) {
      const im = new THREE.InstancedMesh(part.geometry, part.material, n);
      if (part.tint) im.setColorAt(0, _white);
      im.castShadow = !!part.castShadow; im.receiveShadow = part.receiveShadow !== false; im.visible = false;
      // small things (crates, pots, weeds, bikes) cast shadows only into the near cascades (layer 3, see sky.js)
      if (!part.geometry.boundingSphere) part.geometry.computeBoundingSphere();
      let smax = 0; for (const i of idx) smax = Math.max(smax, this.scale[i]);
      if (part.geometry.boundingSphere.radius * smax < 1.2) im.layers.set(3);
      im.matrixAutoUpdate = false; im.matrixWorldAutoUpdate = false; // static at the origin: skip the per-frame matrix walk
      if (part.depth) im.customDepthMaterial = part.depth;
      im.userData.scatter = this; im.userData.sways = !!part.sway; im.boundingSphere = this._bounds(idx, n, part.geometry, new THREE.Sphere()); // (sways: its shadow moves, sky.js)
      im.count = box.n;
      scene.add(im); box.meshes.push(im);
    }
    if (full) for (let k = 0; k < n; k++) this._write(box, k, idx[k]);
    return box;
  }
  _write(box, k, i) {
    for (let p = 0; p < box.meshes.length; p++) {
      const m = box.meshes[p]; cp16(m.instanceMatrix.array, k * 16, this.mat, i * 16);
      if (m.instanceColor) cp3(m.instanceColor.array, k * 3, this.col.get(box.parts[p].tint), i * 3);
    }
  }
  _add(box, i) { const k = box.n++; box.list[k] = i; this.slot[i] = k; this._write(box, k, i); box.dirty.push(k); }
  _remove(box, i) {
    const k = this.slot[i], last = --box.n;
    if (k !== last) { const j = box.list[last]; box.list[k] = j; this.slot[j] = k; this._write(box, k, j); box.dirty.push(k); }
    box.dirty.push(-1); // (the count changed)
  }
  _flush(box) {
    const D = box.dirty; if (!D.length) return;
    D.sort((a, b) => a - b);
    for (const m of box.meshes) {
      m.count = box.n; m.visible = box.n > 0;
      const a = m.instanceMatrix, c = m.instanceColor; a.clearUpdateRanges(); if (c) c.clearUpdateRanges();
      let any = false;
      for (let j = 0; j < D.length;) {
        if (D[j] < 0 || D[j] >= box.n) { j++; continue; }
        let e = j; while (e + 1 < D.length && D[e + 1] - D[e] <= 24 && D[e + 1] < box.n) e++;
        a.addUpdateRange(D[j] * 16, (D[e] - D[j] + 1) * 16); if (c) c.addUpdateRange(D[j] * 3, (D[e] - D[j] + 1) * 3);
        any = true; j = e + 1;
      }
      if (any) { a.needsUpdate = true; if (c) c.needsUpdate = true; }
    }
    if (box.tight && box.n) for (let p = 0; p < box.meshes.length; p++) this._bounds(box.list, box.n, box.parts[p].geometry, box.meshes[p].boundingSphere);
    D.length = 0;
  }
  // bounds of the first n items of idx (positions, plus the part's reach at the largest scale)
  _bounds(idx, n, geo, sphere) {
    let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9, smax = 0;
    for (let k = 0; k < n; k++) { const i = idx[k], o = i * 16, x = this.mat[o + 12], y = this.mat[o + 13], z = this.mat[o + 14];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z; if (this.scale[i] > smax) smax = this.scale[i]; }
    const bs = geo.boundingSphere, reach = (bs.center.length() + bs.radius) * smax;
    sphere.center.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    sphere.radius = Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2 + (z1 - z0) ** 2) / 2 + reach;
    return sphere;
  }
  _lodOf(d) { const D = this.D; for (let l = 0; l < D.length; l++) if (d < D[l]) return l; return -1; }
  _boxOf(i, l) { return l === 0 ? this.fine[this.fineOf[i]].box : this.coarse[this.coarseOf[i]].boxes[l]; }
  update(x, z) {
    if (!this.multi) {
      for (const c of this.cells) {
        const dx = Math.max(c.minX - x, 0, x - c.maxX), dz = Math.max(c.minZ - z, 0, z - c.maxZ), d = Math.sqrt(dx * dx + dz * dz);
        const sel = d < this.lods[0].dist() ? 0 : -1;
        if (sel !== c.cur) { for (const m of c.box.meshes) m.visible = sel === 0; c.cur = sel; }
      }
      return;
    }
    let key = '';
    for (let l = 0; l < this.lods.length; l++) { this.D[l] = this.lods[l].dist(); key += this.D[l] + ','; }
    const force = key !== this.Dkey; this.Dkey = key;
    let budget = this.primed && !force ? SC_BUDGET : Infinity;
    for (const c of this.coarse) {
      const dx = Math.max(c.minX - x, 0, x - c.maxX), dz = Math.max(c.minZ - z, 0, z - c.maxZ);
      const fx = Math.max(Math.abs(c.minX - x), Math.abs(c.maxX - x)), fz = Math.max(Math.abs(c.minZ - z), Math.abs(c.maxZ - z));
      const l0 = this._lodOf(Math.sqrt(dx * dx + dz * dz)), l1 = this._lodOf(Math.sqrt(fx * fx + fz * fz)), uni = l0 === l1 ? l0 : -3;
      if (!force && uni !== -3 && c.uniform === uni) continue;
      if (!force && uni === -3 && c.uniform === -3 && (c.ex - x) ** 2 + (c.ez - z) ** 2 < SC_MOVE * SC_MOVE) continue;
      if (budget <= 0) break;
      budget -= c.idx.length;
      this._evaluate(c, x, z, uni);
    }
    this.primed = true;
    for (const b of this.boxes) if (b.dirty.length) this._flush(b);
  }
  _evaluate(c, x, z, uni) {
    const D = this.D, L = D.length;
    for (let k = 0; k < c.idx.length; k++) {
      const i = c.idx[k], lo = this.lod[i];
      let ln = uni;
      if (uni === -3) {
        const o = i * 16, dx = this.mat[o + 12] - x, dz = this.mat[o + 14] - z, d = Math.sqrt(dx * dx + dz * dz);
        ln = this._lodOf(d);
        if (ln !== lo && lo >= -1) { // hysteresis: stay at the old level within a metre or two of the boundary between them
          const b = D[Math.min(lo < 0 ? L - 1 : lo, ln < 0 ? L - 1 : ln)];
          if (Math.abs(d - b) < 1.5 + 0.004 * d) ln = lo;
        }
      }
      if (ln === lo) continue;
      if (lo >= 0 && this.lods[lo].parts.length) this._remove(this._boxOf(i, lo), i);
      if (ln >= 0 && this.lods[ln].parts.length) this._add(this._boxOf(i, ln), i);
      this.lod[i] = ln;
    }
    c.uniform = uni; c.ex = x; c.ez = z;
  }
  // where item i is drawn now: [{mesh, instance}] per part (empty when it is out of range)
  locate(i) {
    if (!this.multi) { for (const c of this.cells) { const k = c.idx.indexOf(i); if (k >= 0) return c.cur === 0 ? c.box.meshes.map(mesh => ({ mesh, instance: k })) : []; } return []; }
    const l = this.lod[i]; if (l < 0 || !this.lods[l].parts.length) return [];
    return this._boxOf(i, l).meshes.map(mesh => ({ mesh, instance: this.slot[i] }));
  }
  // move / rotate / scale item i (an editor's handle): its stored transform and wherever it is drawn (an item keeps the
  // cells it was built in; bounds of the coarse levels are fixed, so large moves belong in a rebuild)
  setItemMatrix(i, m) {
    m.toArray(this.mat, i * 16);
    if (!this.multi) { for (const c of this.cells) { const k = c.idx.indexOf(i); if (k >= 0) { this._write(c.box, k, i); c.box.dirty.push(k); this._flush(c.box); } } return; }
    const l = this.lod[i]; if (l < 0 || !this.lods[l].parts.length) return;
    const box = this._boxOf(i, l); this._write(box, this.slot[i], i); box.dirty.push(this.slot[i]);
  }
}

// ---------------------------------------------------------------- instanced props
// Small props that used to be a mesh (or several) each — curve mirrors, vending machine bodies, road sign plates, pole
// adverts — are collected while the map is built and drawn as one instanced mesh per part, material and 512 m cell
// (flushProps). Each placed prop keeps an id: props.items[id] = {kind, parts: [{mesh, instance}]} once flushed, with its
// world matrix per part, so it can still be picked and edited (setPropMatrix).
export const props = { groups: new Map(), items: [], flushed: false };
const PROP_CELL = 512;
export function addProp(kind, parts) { // parts: [{geometry, material, matrix (world), castShadow?, receiveShadow?}]
  const id = props.items.length, item = { id, kind, parts: [] };
  props.items.push(item);
  for (const p of parts) {
    const e = p.matrix.elements, cx = Math.floor((e[12] + 4096) / PROP_CELL), cz = Math.floor((e[14] + 4096) / PROP_CELL);
    const key = p.geometry.uuid + '|' + p.material.uuid + '|' + (p.castShadow ? 1 : 0) + (p.receiveShadow === false ? 0 : 1) + '|' + cx + ',' + cz;
    let g = props.groups.get(key);
    if (!g) props.groups.set(key, g = { geometry: p.geometry, material: p.material, castShadow: !!p.castShadow, receiveShadow: p.receiveShadow !== false, matrices: [], ids: [], mesh: null });
    item.parts.push({ group: g, instance: g.matrices.length, matrix: p.matrix.clone() });
    g.matrices.push(p.matrix.clone()); g.ids.push(id);
  }
  return id;
}
export function flushProps() {
  for (const g of props.groups.values()) {
    if (g.mesh) continue;
    const im = new THREE.InstancedMesh(g.geometry, g.material, g.matrices.length);
    g.matrices.forEach((m, i) => im.setMatrixAt(i, m));
    im.castShadow = g.castShadow; im.receiveShadow = g.receiveShadow; im.matrixAutoUpdate = false; im.matrixWorldAutoUpdate = false;
    im.computeBoundingSphere(); im.userData.props = g.ids;
    scene.add(im); g.mesh = im;
  }
  for (const it of props.items) for (const p of it.parts) p.mesh = p.group.mesh;
  props.flushed = true;
}
export function setPropMatrix(id, part, matrix) {
  const p = props.items[id].parts[part]; p.matrix.copy(matrix); p.group.matrices[p.instance].copy(matrix);
  if (p.mesh) { p.mesh.setMatrixAt(p.instance, matrix); p.mesh.instanceMatrix.needsUpdate = true; p.mesh.computeBoundingSphere(); }
}

// ---------------------------------------------------------------- shadow depth materials
// three renders every shadow caster without a depth material of its own with one shared MeshDepthMaterial. Plain meshes,
// instanced meshes and instanced meshes with colours need different shader variants of it, and the casters come in
// scene order, so that one material switched program on nearly every draw (a program lookup that allocates each time).
// One shared depth material per variant keeps each on its own program. Casters that need a depth material of their own
// (alpha-tested maps, displacement) keep three's per-material copies.
const depthShare = new Map();
export function shareShadowDepth(root) {
  root.traverse(o => {
    if (!o.isMesh || !o.castShadow || o.customDepthMaterial || !o.material || Array.isArray(o.material)) return;
    const m = o.material;
    if ((m.displacementMap && m.displacementScale !== 0) || ((m.alphaMap || m.map) && m.alphaTest > 0) || (m.clipShadows && m.clippingPlanes && m.clippingPlanes.length)) return;
    const side = m.shadowSide ?? (m.side === THREE.FrontSide ? THREE.BackSide : m.side === THREE.BackSide ? THREE.FrontSide : THREE.DoubleSide);
    const key = (o.isInstancedMesh ? 1 : 0) + (o.isInstancedMesh && o.instanceColor ? 2 : 0) + (m.map ? 4 : 0) + side * 8; // (three copies map and side onto it per draw)
    let d = depthShare.get(key);
    if (!d) { d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }); d.side = side; depthShare.set(key, d); }
    o.customDepthMaterial = d;
  });
}

// InstancedMeshes that share one geometry also share its vertex-array object in three (VAOs are keyed by geometry and
// program), so every draw of the next cell re-specified all vertex attributes of the last. A view of the geometry — the
// same attribute and index buffers, a geometry object of its own — gives each instanced mesh its own VAO.
export function geometryView(src) {
  const g = new THREE.BufferGeometry();
  g.index = src.index; for (const k in src.attributes) g.attributes[k] = src.attributes[k];
  g.morphAttributes = src.morphAttributes; g.morphTargetsRelative = src.morphTargetsRelative; g.groups = src.groups; g.drawRange = src.drawRange;
  g.boundingSphere = src.boundingSphere; g.boundingBox = src.boundingBox; g.userData = src.userData;
  return g;
}
export function ownInstanceGeometry(root) {
  const seen = new Set();
  root.traverse(o => { if (!o.isInstancedMesh || o.geometry.isInstancedBufferGeometry) return; if (seen.has(o.geometry)) o.geometry = geometryView(o.geometry); else seen.add(o.geometry); });
}
// Instanced geometry built non-indexed (merged crowns, cards, scanned props) runs the vertex shader three times per
// triangle; GPUs reuse a vertex shared by several triangles only through an index. Vertices whose every attribute is
// bit-identical are merged into one indexed vertex: the same triangles in the same order with the same values, drawn
// with a fraction of the vertex work.
export function indexInstanced(root) {
  const done = new Set(), f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
  root.traverse(o => {
    if (!o.isInstancedMesh) return;
    const g = o.geometry;
    if (done.has(g) || g.index || g.isInstancedBufferGeometry || Object.keys(g.morphAttributes).length) return;
    done.add(g);
    const names = Object.keys(g.attributes), attrs = names.map(k => g.attributes[k]), n = g.attributes.position.count;
    if (attrs.some(a => a.isInterleavedBufferAttribute || a.isInstancedBufferAttribute)) return; // (per-instance data, not per-vertex)
    const map = new Map(), remap = new Uint32Array(n), first = [];
    for (let i = 0; i < n; i++) {
      let key = '';
      for (const a of attrs) for (let c = 0; c < a.itemSize; c++) { const v = a.array[i * a.itemSize + c]; if (a.array instanceof Float32Array) { f32[0] = v; key += u32[0].toString(36) + ','; } else key += v + ','; }
      let id = map.get(key); if (id === undefined) { id = first.length; map.set(key, id); first.push(i); }
      remap[i] = id;
    }
    if (first.length > n * 0.75) return; // (little shared: leave it)
    for (let k = 0; k < names.length; k++) {
      const a = attrs[k], arr = new a.array.constructor(first.length * a.itemSize);
      for (let j = 0; j < first.length; j++) for (let c = 0; c < a.itemSize; c++) arr[j * a.itemSize + c] = a.array[first[j] * a.itemSize + c];
      const na = new THREE.BufferAttribute(arr, a.itemSize, a.normalized); na.name = a.name; na.usage = a.usage; g.attributes[names[k]] = na;
    }
    g.setIndex(new THREE.BufferAttribute(first.length > 65535 ? remap : new Uint16Array(remap), 1));
  });
}
// three draws a transparent double-sided material in two passes (back faces, then front faces) and flags the material
// for a program change before each, so every such draw also re-resolves its shader twice. A flat mesh can only show one
// side at any pixel, so one pass gives the same image: materials whose every user is planar draw in a single pass.
const _pn = new THREE.Vector3(), _pa = new THREE.Vector3(), _pb = new THREE.Vector3(), _pc = new THREE.Vector3();
function planar(g) {
  const p = g.attributes.position; if (!p || p.count < 3) return false;
  const idx = g.index, at = i => idx ? idx.getX(i) : i;
  _pa.fromBufferAttribute(p, at(0)); _pb.fromBufferAttribute(p, at(1)); _pc.fromBufferAttribute(p, at(2));
  _pn.subVectors(_pb, _pa).cross(_pc.sub(_pa)); const l = _pn.length(); if (l < 1e-12) return false; _pn.divideScalar(l);
  const d = _pn.dot(_pa), eps = 1e-4 * (g.boundingSphere || (g.computeBoundingSphere(), g.boundingSphere)).radius + 1e-6;
  for (let i = 0; i < p.count; i++) if (Math.abs(_pn.dot(_pb.fromBufferAttribute(p, i)) - d) > eps) return false;
  return true;
}
export function singlePassFlat(root) {
  const users = new Map();
  root.traverse(o => { const m = o.material; if (!o.isMesh || !m || Array.isArray(m) || !m.transparent || m.side !== THREE.DoubleSide || m.forceSinglePass) return; if (!users.has(m)) users.set(m, []); users.get(m).push(o); });
  for (const [m, list] of users) if (list.every(o => planar(o.geometry))) m.forceSinglePass = true;
}
// Scenery transforms never change after the build: the scene's matrices are brought up to date once a frame (main.js)
// instead of once per render call, and root-level scenery stops recomposing its matrix every frame. Objects that move
// by setting position/rotation carry userData.dynamic (or have children: groups such as trains keep updating).
export function freezeStatic(root) {
  root.matrixWorldAutoUpdate = false;
  root.updateMatrixWorld(true);
  for (const o of root.children) if (o.matrixAutoUpdate && !o.userData.dynamic && !o.isLight && !o.isCamera && o.children.length === 0 && (o.isMesh || o.isPoints || o.isLine)) o.matrixAutoUpdate = false;
}

// materials objects switch to at runtime (flashing crossing lamps, train head/tail lights): never on any object while
// the game loads, so the load-time warm-up (main.js) draws each of them once on a stand-in of the object that uses it
export const swapMaterials = [];
export function swapsTo(mesh, ...mats) { swapMaterials.push([mesh, mats]); }

// ---------------------------------------------------------------- glTF helpers
export function extractParts(root) {
  root.updateMatrixWorld(true);
  const parts = [];
  root.traverse(o => {
    if (!o.isMesh) return;
    const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld);
    parts.push({ geometry: g, material: o.material, name: o.name });
  });
  return parts;
}
// recentre on XZ, put base on y=0, scale so max dimension (or height) is 1
export function normalizeParts(parts, byHeight) {
  const box = new THREE.Box3();
  parts.forEach(p => { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox); });
  const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const sc = byHeight === 'none' ? 1 : 1 / (byHeight ? size.y : Math.max(size.x, size.y, size.z));
  parts.forEach(p => { p.geometry.translate(-c.x, -box.min.y, -c.z); p.geometry.scale(sc, sc, sc); p.geometry.computeBoundingSphere(); });
  return { w: Math.max(size.x, size.z) * sc, h: size.y * sc, x: size.x * sc, z: size.z * sc };
}

// Cheap far LOD for scanned meshes: vertex clustering on a res^3 grid over the bounding box (vertices in one cell merge
// into their average; triangles that collapse are dropped). Good enough for rocks, stumps and plants seen from afar,
// where the toon look flattens their textures anyway.
export function decimate(geo, res = 10) {
  const pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv, n = pos.count;
  geo.computeBoundingBox();
  const b = geo.boundingBox, sz = b.getSize(new THREE.Vector3()), cell = Math.max(sz.x, sz.y, sz.z) / res + 1e-6;
  const ids = new Map(), remap = new Uint32Array(n), P = [], N = [], U = [], C = [];
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = Math.floor((x - b.min.x) / cell) + ',' + Math.floor((y - b.min.y) / cell) + ',' + Math.floor((z - b.min.z) / cell);
    let id = ids.get(k);
    if (id === undefined) { id = C.length; ids.set(k, id); P.push(0, 0, 0); N.push(0, 0, 0); U.push(0, 0); C.push(0); }
    remap[i] = id; C[id]++;
    P[id * 3] += x; P[id * 3 + 1] += y; P[id * 3 + 2] += z;
    if (nor) { N[id * 3] += nor.getX(i); N[id * 3 + 1] += nor.getY(i); N[id * 3 + 2] += nor.getZ(i); }
    if (uv) { U[id * 2] += uv.getX(i); U[id * 2 + 1] += uv.getY(i); }
  }
  for (let id = 0; id < C.length; id++) {
    const c = C[id]; for (let k = 0; k < 3; k++) P[id * 3 + k] /= c;
    const l = Math.hypot(N[id * 3], N[id * 3 + 1], N[id * 3 + 2]) || 1; for (let k = 0; k < 3; k++) N[id * 3 + k] /= l;
    U[id * 2] /= c; U[id * 2 + 1] /= c;
  }
  const src = geo.index ? geo.index.array : null, tcount = (src ? src.length : n) / 3, I = [], seen = new Set();
  for (let t = 0; t < tcount; t++) {
    const a = remap[src ? src[t * 3] : t * 3], bb = remap[src ? src[t * 3 + 1] : t * 3 + 1], c = remap[src ? src[t * 3 + 2] : t * 3 + 2];
    if (a === bb || bb === c || a === c) continue;
    const key = a < bb ? (bb < c ? a + ',' + bb + ',' + c : a < c ? a + ',' + c + ',' + bb : c + ',' + a + ',' + bb) : (a < c ? bb + ',' + a + ',' + c : bb < c ? bb + ',' + c + ',' + a : c + ',' + bb + ',' + a);
    if (seen.has(key)) continue; seen.add(key);
    I.push(a, bb, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  if (nor) g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setIndex(I); g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------- misc shader helpers
// Makes pow() bases strictly positive (ANGLE/D3D returns NaN for pow(0,y)) — use when patching three chunks.
export function onResize(fn) { resizeFns.push(fn); }
const resizeFns = [];
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setPixelRatio(pixelRatio()); renderer.setSize(innerWidth, innerHeight);
  resizeFns.forEach(f => f());
});
