// Shared engine core: renderer, scene, camera, quality, noise, loaders, atmospheric fog, instancing helpers.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
export { THREE };

// ---------------------------------------------------------------- math / noise
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export const tick = () => new Promise(r => setTimeout(r, 0));

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
  ultra:  { pr: 1.35, grass: 900000, tile: 90,  shadow: 4096, box: 240, msaa: 8, ao: true,  treeHi: 340, trees: 3200, rocks: 420, props: 360, ferns: 130, bloom: true,  refl: 0.65 },
};
export const MAX_GRASS = 900000;
export const Q = { name: 'high' };
{
  let s = 'high';
  try { const v = localStorage.getItem('wl_quality'); if (QUALITY[v]) s = v; } catch (e) {}
  Object.assign(Q, QUALITY[s], { name: s });
}

// ---------------------------------------------------------------- renderer / scene / camera
export const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2) * Q.pr);
renderer.toneMapping = THREE.AgXToneMapping; // filmic, less saturated highlights than ACES — reads more photographic
renderer.toneMappingExposure = 0.55;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
export const maxAniso = renderer.capabilities.getMaxAnisotropy();

export const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xa8b8c8, 0.00032);
export const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.2, 26000);
camera.rotation.order = 'YXZ';
camera.layers.enable(1); // layer 1: rendered normally but skipped by water reflections

export const sunDir = new THREE.Vector3(0, 1, 0);
// shared uniforms (objects are shared by reference between materials)
export const S = {
  uTime: { value: 0 }, uWind: { value: 0.6 },
  uSunDir: { value: sunDir }, uSunCol: { value: new THREE.Vector3() }, uSunViewDir: { value: new THREE.Vector3() },
  uAmb: { value: new THREE.Vector3() }, uFogCol: { value: new THREE.Vector3() },
  uCam: { value: new THREE.Vector3() }, uPlayer: { value: new THREE.Vector3() },
  tNoise: { value: null },
};

// ---------------------------------------------------------------- atmospheric fog
// Replaces three's fog with height-attenuated exponential fog plus forward in-scattering toward the sun.
// Plain {x,y,z} objects survive UniformsUtils.clone by reference, so every material sees live values.
export const fogU = {
  fogSunDir: { value: { x: 0, y: 1, z: 0 } },
  fogSunColor: { value: { x: 0, y: 0, z: 0 } },
  fogParams: { value: { x: 0, y: 1 / 200, z: 0 } }, // x: camera height above fog base, y: height falloff
};
for (const k in THREE.ShaderLib) { const u = THREE.ShaderLib[k].uniforms; if (u && u.fogColor) Object.assign(u, fogU); }
Object.assign(THREE.UniformsLib.fog, fogU);
THREE.ShaderChunk.fog_pars_vertex = '#ifdef USE_FOG\n\tvarying float vFogDepth;\n\tvarying vec3 vFogDir;\n#endif';
THREE.ShaderChunk.fog_vertex = '#ifdef USE_FOG\n\tvFogDepth = - mvPosition.z;\n\tvFogDir = ( vec4( mvPosition.xyz, 0.0 ) * viewMatrix ).xyz;\n#endif';
THREE.ShaderChunk.fog_pars_fragment = /* glsl */`#ifdef USE_FOG
	uniform vec3 fogColor; uniform vec3 fogSunDir; uniform vec3 fogSunColor; uniform vec3 fogParams;
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
		float fogFactor = 1.0 - exp( - fogDensity * fDist * fH );
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
  texCache.set(key, t);
  return t;
}
export const NFLAT = [128, 128, 255];
export const phTex = (name, kind, res, srgb, fb) => loadTex(`tex/${name}_${kind}_${res}.jpg`, srgb, fb);
const modelCache = new Map();
export function loadModel(name) {
  if (!modelCache.has(name)) modelCache.set(name, new Promise(res =>
    gltfLoader.load(`assets/models/${name}/${name}_1k.gltf`, g => res(g.scene), undefined, () => res(null))));
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
  return t;
}
S.tNoise.value = makeNoiseTexture();

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

// ---------------------------------------------------------------- cell-based instancing with LOD + distance culling
export const scatters = [];
export class Scatter {
  // items: {x,y,z,s,sx?,sy?,r?,tilt?,tilt2?,c?}; lods: [{dist: () => metres, parts: [{geometry, material, tint?, castShadow?, depth?}]}]
  constructor(items, lods, cellSize, origin = 4096) {
    this.cells = []; this.lods = lods;
    const map = new Map();
    for (const it of items) {
      const k = Math.floor((it.x + origin) / cellSize) + ',' + Math.floor((it.z + origin) / cellSize);
      if (!map.has(k)) map.set(k, []); map.get(k).push(it);
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
    for (const [k, list] of map) {
      const [ci, cj] = k.split(',').map(Number);
      const cell = { minX: -origin + ci * cellSize, maxX: -origin + (ci + 1) * cellSize, minZ: -origin + cj * cellSize, maxZ: -origin + (cj + 1) * cellSize, lods: [], cur: -2 };
      for (const lod of lods) {
        const meshes = [];
        for (const part of lod.parts) {
          const im = new THREE.InstancedMesh(part.geometry, part.material, list.length);
          list.forEach((it, i) => {
            e.set(it.tilt || 0, it.r || 0, it.tilt2 || 0); q.setFromEuler(e);
            s.set(it.s * (it.sx || 1), it.s * (it.sy || 1), it.s * (it.sz || it.sx || 1)); p.set(it.x, it.y, it.z);
            im.setMatrixAt(i, m.compose(p, q, s));
            if (part.tint && it.c) im.setColorAt(i, it.c);
          });
          im.castShadow = !!part.castShadow; im.receiveShadow = part.receiveShadow !== false; im.visible = false;
          if (part.depth) im.customDepthMaterial = part.depth;
          im.computeBoundingSphere();
          meshes.push(im); scene.add(im);
        }
        cell.lods.push(meshes);
      }
      this.cells.push(cell);
    }
    scatters.push(this);
  }
  update(x, z) {
    for (const c of this.cells) {
      const dx = Math.max(c.minX - x, 0, x - c.maxX), dz = Math.max(c.minZ - z, 0, z - c.maxZ), d = Math.hypot(dx, dz);
      let sel = -1;
      for (let i = 0; i < this.lods.length; i++) if (d < this.lods[i].dist()) { sel = i; break; }
      if (sel !== c.cur) { c.lods.forEach((ms, i) => ms.forEach(mm => mm.visible = i === sel)); c.cur = sel; }
    }
  }
}

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

// ---------------------------------------------------------------- misc shader helpers
// Makes pow() bases strictly positive (ANGLE/D3D returns NaN for pow(0,y)) — use when patching three chunks.
export function onResize(fn) { resizeFns.push(fn); }
const resizeFns = [];
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  resizeFns.forEach(f => f());
});
