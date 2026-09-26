// Reusable outdoor systems: heightfield terrain with splat shading, GPU grass (and rice), planar-reflection water,
// scanned-branch conifer forests. Maps configure these and add their own content.
import { THREE, scene, S, Q, MAX_GRASS, clamp, lerp, smoothstep, mulberry32, tick, loadTex, phTex, NFLAT, maxAniso, Scatter, addCircle } from './core.js';

// ---------------------------------------------------------------- heightfield
export class Heightfield {
  constructor({ world = 2048, grid = 1024, height }) {
    this.WORLD = world; this.GRID = grid; this.HN = grid + 1; this.CELL = world / grid; this.HALF = world / 2;
    this.fn = height;
    this.H = new Float32Array(this.HN * this.HN);
    this.mask = new Uint8Array(this.HN * this.HN * 4);   // R forest, G ambient occlusion, B canopy, A unused
    this.mask2 = new Uint8Array(this.HN * this.HN * 4);  // R urban ground, G paddy, B no-grass, A mowed lawn
    this.U = { tHeight: { value: null }, tMask: { value: null }, tMask2: { value: null }, uHalf: { value: this.HALF }, uCell: { value: this.CELL }, uHN: { value: this.HN } };
  }
  async generate(progress, from = 0, to = 1) {
    const { HN, CELL, HALF, H } = this;
    for (let j = 0; j < HN; j++) {
      const z = -HALF + j * CELL;
      for (let i = 0; i < HN; i++) H[j * HN + i] = this.fn(-HALF + i * CELL, z);
      if ((j & 31) === 0) { progress(lerp(from, to, j / HN)); await tick(); }
    }
  }
  idx(x, z) { return clamp(Math.round((z + this.HALF) / this.CELL), 0, this.GRID) * this.HN + clamp(Math.round((x + this.HALF) / this.CELL), 0, this.GRID); }
  Hg(i, j) { return this.H[clamp(j, 0, this.GRID) * this.HN + clamp(i, 0, this.GRID)]; }
  heightAt(x, z) {
    const { CELL, HALF, GRID, HN, H } = this;
    const gx = clamp((x + HALF) / CELL, 0, GRID - 0.0001), gz = clamp((z + HALF) / CELL, 0, GRID - 0.0001);
    const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j;
    return lerp(lerp(H[j * HN + i], H[j * HN + i + 1], fx), lerp(H[(j + 1) * HN + i], H[(j + 1) * HN + i + 1], fx), fz);
  }
  inside(x, z) { return Math.abs(x) < this.HALF && Math.abs(z) < this.HALF; }
  groundAt(x, z) { return this.inside(x, z) ? this.heightAt(x, z) : this.fn(x, z); }
  normalAt(x, z, out) {
    const e = this.CELL, hx = this.heightAt(x + e, z) - this.heightAt(x - e, z), hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    const l = Math.hypot(hx, 2 * e, hz); return out.set(-hx / l, 2 * e / l, -hz / l);
  }
  gridNormalY(i, j) { const hx = this.Hg(i + 1, j) - this.Hg(i - 1, j), hz = this.Hg(i, j + 1) - this.Hg(i, j - 1); return 2 * this.CELL / Math.hypot(hx, 2 * this.CELL, hz); }
  // ambient occlusion from the height field (cheap horizon test)
  async bakeAO(progress) {
    const { HN, H, mask } = this, dirs = [];
    for (let k = 0; k < 8; k++) dirs.push([Math.cos(k / 8 * Math.PI * 2), Math.sin(k / 8 * Math.PI * 2)]);
    for (let j = 0; j < HN; j++) {
      for (let i = 0; i < HN; i++) {
        const h = H[j * HN + i]; let occ = 0;
        for (const [dx, dz] of dirs) for (const r of [3, 9]) occ += Math.max(0, (this.Hg(i + Math.round(dx * r), j + Math.round(dz * r)) - h) / (r * this.CELL));
        mask[(j * HN + i) * 4 + 1] = (1 - clamp(occ / 16 * 1.4, 0, 0.55)) * 255; mask[(j * HN + i) * 4 + 3] = 255;
      }
      if ((j & 63) === 0) { progress && progress(j / HN); await tick(); }
    }
  }
  paintCanopy(trees) {
    const { CELL, HALF, GRID, HN, mask } = this;
    for (const t of trees) {
      const R = 0.22 * t.s * (t.sx || 1), rc = Math.ceil(R / CELL);
      const ci = Math.round((t.x + HALF) / CELL), cj = Math.round((t.z + HALF) / CELL);
      for (let dj = -rc; dj <= rc; dj++) for (let di = -rc; di <= rc; di++) {
        const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i > GRID || j > GRID) continue;
        const d = Math.hypot(di * CELL, dj * CELL) / R; if (d > 1) continue;
        const o = (j * HN + i) * 4 + 2; mask[o] = Math.max(mask[o], (1 - d * d) * 255);
      }
    }
  }
  // rasterise a function over a world-space rectangle into mask2 channel c (max-blend)
  paint2(c, minX, minZ, maxX, maxZ, fn) {
    const { CELL, HALF, GRID, HN, mask2 } = this;
    const i0 = clamp(Math.floor((minX + HALF) / CELL), 0, GRID), i1 = clamp(Math.ceil((maxX + HALF) / CELL), 0, GRID);
    const j0 = clamp(Math.floor((minZ + HALF) / CELL), 0, GRID), j1 = clamp(Math.ceil((maxZ + HALF) / CELL), 0, GRID);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const v = fn(-HALF + i * CELL, -HALF + j * CELL); if (v <= 0) continue;
      const o = (j * HN + i) * 4 + c; mask2[o] = Math.max(mask2[o], Math.min(255, v * 255));
    }
  }
  uploadHeight() {
    const t = new THREE.DataTexture(this.H, this.HN, this.HN, THREE.RedFormat, THREE.FloatType);
    t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; this.U.tHeight.value = t;
  }
  uploadMasks() {
    for (const [arr, key] of [[this.mask, 'tMask'], [this.mask2, 'tMask2']]) {
      const t = new THREE.DataTexture(arr, this.HN, this.HN, THREE.RGBAFormat);
      t.minFilter = t.magFilter = THREE.LinearFilter; t.needsUpdate = true;
      if (this.U[key].value) this.U[key].value.dispose();
      this.U[key].value = t;
    }
  }
}

export const GLSL_HEIGHT = /* glsl */`
uniform sampler2D tHeight; uniform float uHalf; uniform float uCell; uniform float uHN;
float hAt(vec2 p){
  vec2 g = clamp((p + uHalf) / uCell, vec2(0.0), vec2(uHN - 1.001));
  ivec2 i = ivec2(floor(g)); vec2 f = g - vec2(i);
  float a = texelFetch(tHeight, i, 0).r, b = texelFetch(tHeight, i + ivec2(1,0), 0).r;
  float c = texelFetch(tHeight, i + ivec2(0,1), 0).r, d = texelFetch(tHeight, i + ivec2(1,1), 0).r;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
vec2 maskUV(vec2 p){ return ((p + uHalf) / uCell + 0.5) / uHN; }
`;

// ---------------------------------------------------------------- splat terrain
// layers: { grass, forest, rock, shore, urban } each { d: diffuse tex, n: normal tex, s: tile metres, tint: [r,g,b] }
export function terrainMaterial(hf, L, opt = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
  const tintV = a => new THREE.Vector3(...(a || [1, 1, 1]));
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, hf.U, {
      tGrassD: { value: L.grass.d }, tGrassN: { value: L.grass.n }, tForestD: { value: L.forest.d }, tForestN: { value: L.forest.n },
      tRockD: { value: L.rock.d }, tRockN: { value: L.rock.n }, tSandD: { value: L.shore.d }, tSandN: { value: L.shore.n },
      tUrbanD: { value: L.urban.d }, tUrbanN: { value: L.urban.n }, tNoise: S.tNoise,
      uScales: { value: new THREE.Vector4(L.grass.s, L.forest.s, L.shore.s, L.urban.s) }, uRockS: { value: L.rock.s },
      uTintG: { value: tintV(L.grass.tint) }, uTintF: { value: tintV(L.forest.tint) }, uTintU: { value: tintV(L.urban.tint) }, uTintS: { value: tintV(L.shore.tint) },
      uWaterLv: { value: opt.water ?? 0 }, uSnow: { value: opt.snow ?? 175 },
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNorm;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWNorm = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying vec3 vWNorm;
        uniform sampler2D tGrassD, tGrassN, tForestD, tForestN, tRockD, tRockN, tSandD, tSandN, tUrbanD, tUrbanN, tNoise, tMask, tMask2;
        uniform float uHalf, uCell, uHN, uRockS, uWaterLv, uSnow; uniform vec4 uScales; uniform vec3 uTintG, uTintF, uTintU, uTintS;
        vec3 unpackN(vec4 t){ return t.xyz * 2.0 - 1.0; }
        vec2 maskUV(vec2 p){ return ((p + uHalf) / uCell + 0.5) / uHN; }`)
      .replace('#include <map_fragment>', /* glsl */`
        vec3 wN = normalize(vWNorm);
        vec2 wuv = vWPos.xz;
        float camDist = length(vWPos - cameraPosition);
        vec4 nz1 = texture2D(tNoise, wuv * 0.0021);
        vec4 nz2 = texture2D(tNoise, wuv * 0.013);
        vec4 nz3 = texture2D(tNoise, wuv * 0.06);
        float inside = step(abs(vWPos.x), uHalf) * step(abs(vWPos.z), uHalf);
        vec4 msk = texture2D(tMask, maskUV(wuv));
        vec4 msk2 = texture2D(tMask2, maskUV(wuv)) * inside;
        float farForest = smoothstep(0.5, 0.64, nz1.r) * smoothstep(0.78, 0.86, wN.y) * (1.0 - smoothstep(uSnow - 45.0, uSnow + 5.0, vWPos.y)) * step(uWaterLv + 3.0, vWPos.y);
        float forest = mix(farForest, msk.r, inside);
        float ao = mix(1.0, msk.g, inside);
        float canopy = msk.b * inside;
        float slope = 1.0 - wN.y;
        float h = vWPos.y - uWaterLv;
        float mixS = smoothstep(0.3, 0.7, nz2.g);
        float farT = smoothstep(60.0, 400.0, camDist);
        vec3 cGrass = mix(texture2D(tGrassD, wuv / uScales.x).rgb, texture2D(tGrassD, wuv / (uScales.x * 4.8)).rgb, mix(0.25 + 0.35 * mixS, 0.8, farT));
        vec3 nGrass = unpackN(texture2D(tGrassN, wuv / uScales.x));
        cGrass *= mix(vec3(0.78, 0.92, 0.55), vec3(1.05, 1.02, 0.78), nz1.g) * uTintG;
        vec3 cForest = mix(texture2D(tForestD, wuv / uScales.y).rgb, texture2D(tForestD, wuv / (uScales.y * 4.6)).rgb, mix(0.35, 0.8, farT));
        vec3 nForest = unpackN(texture2D(tForestN, wuv / uScales.y));
        cForest *= mix(vec3(0.75, 0.72, 0.6), vec3(0.95), nz2.r) * uTintF;
        vec3 cSand = mix(texture2D(tSandD, wuv / uScales.z).rgb, texture2D(tSandD, wuv / (uScales.z * 4.7)).rgb, 0.45) * uTintS;
        vec3 nSand = unpackN(texture2D(tSandN, wuv / uScales.z));
        vec3 cUrban = mix(texture2D(tUrbanD, wuv / uScales.w).rgb, texture2D(tUrbanD, wuv / (uScales.w * 3.7)).rgb, 0.35) * uTintU;
        vec3 nUrban = unpackN(texture2D(tUrbanN, wuv / uScales.w));
        vec3 bw = pow(max(abs(wN), vec3(1e-4)), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
        float rs = mix(1.0 / uRockS, 1.0 / (uRockS * 3.4), farT * 0.7);
        vec3 cRock = texture2D(tRockD, vWPos.zy * rs).rgb * bw.x + texture2D(tRockD, vWPos.xz * rs).rgb * bw.y + texture2D(tRockD, vWPos.xy * rs).rgb * bw.z;
        vec3 rnx = unpackN(texture2D(tRockN, vWPos.zy * rs)), rny = unpackN(texture2D(tRockN, vWPos.xz * rs)), rnz = unpackN(texture2D(tRockN, vWPos.xy * rs));
        vec3 nRock = normalize(wN + vec3(0.0, rnx.y, rnx.x) * bw.x * 1.3 + vec3(rny.x, 0.0, rny.y) * bw.y * 1.3 + vec3(rnz.x, rnz.y, 0.0) * bw.z * 1.3);
        cRock = mix(cRock, vec3(dot(cRock, vec3(0.33))), 0.45) * mix(0.8, 1.1, nz2.b);
        float wSand = max(1.0 - smoothstep(0.25, 1.3, h + (nz2.r - 0.5) * 1.2), msk2.g);
        float wRock = smoothstep(0.30, 0.46, slope + (nz2.b - 0.5) * 0.14);
        float wSnow = smoothstep(uSnow, uSnow + 40.0, vWPos.y + (nz1.b - 0.5) * 70.0) * (1.0 - smoothstep(0.42, 0.62, slope));
        float wForest = smoothstep(0.2, 0.7, forest + (nz3.r - 0.5) * 0.35);
        float wUrban = smoothstep(0.15, 0.6, msk2.r + (nz3.g - 0.5) * 0.25);
        vec3 col = mix(cGrass, cForest, wForest);
        vec3 tn = mix(nGrass, nForest, wForest);
        col = mix(col, cSand, wSand); tn = mix(tn, nSand, wSand);
        col = mix(col, cUrban, wUrban); tn = mix(tn, nUrban, wUrban);
        vec3 nW = normalize(wN + vec3(tn.x, 0.0, tn.y) * 0.9);
        col = mix(col, cRock, wRock * (1.0 - wUrban)); nW = normalize(mix(nW, nRock, wRock * (1.0 - wUrban)));
        col = mix(col, vec3(0.9, 0.93, 0.97), wSnow); nW = normalize(mix(nW, wN, wSnow * 0.7));
        float wet = max(1.0 - smoothstep(0.0, 0.9, h), msk2.g * 0.8);
        col *= mix(1.0, 0.5, wet);
        col *= exp(-clamp(-h, 0.0, 30.0) * vec3(0.30, 0.09, 0.06));
        col *= ao * (1.0 - canopy * 0.5);
        diffuseColor.rgb *= col;
        float splatRough = mix(mix(0.97, 0.92, wForest), 0.82, wRock);
        splatRough = mix(splatRough, 0.9, wUrban);
        splatRough = mix(splatRough, 0.72, wSnow);
        splatRough = mix(splatRough, 0.35, wet);
        vec3 splatN = nW;
      `)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = splatRough;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(splatN, 0.0)).xyz);');
  };
  mat.customProgramCacheKey = () => 'terrain';
  return mat;
}

export function buildTerrainMeshes(hf, mat, { outer = true, outerDrop = 45 } = {}) {
  const { GRID, HN, CELL, HALF, H } = hf;
  const CH = 64, NC = GRID / CH, n = CH + 1;
  const idx = [];
  for (let b = 0; b < CH; b++) for (let a = 0; a < CH; a++) { const v = b * n + a; idx.push(v, v + n, v + 1, v + 1, v + n, v + n + 1); }
  const index = new THREE.Uint32BufferAttribute(idx, 1);
  const group = new THREE.Group();
  for (let cj = 0; cj < NC; cj++) for (let ci = 0; ci < NC; ci++) {
    const pos = new Float32Array(n * n * 3), nor = new Float32Array(n * n * 3);
    for (let b = 0; b < n; b++) for (let a = 0; a < n; a++) {
      const i = ci * CH + a, j = cj * CH + b, k = (b * n + a) * 3;
      pos[k] = -HALF + i * CELL; pos[k + 1] = H[j * HN + i]; pos[k + 2] = -HALF + j * CELL;
      const hx = hf.Hg(i + 1, j) - hf.Hg(i - 1, j), hz = hf.Hg(i, j + 1) - hf.Hg(i, j - 1), l = Math.hypot(hx, 2 * CELL, hz);
      nor[k] = -hx / l; nor[k + 1] = 2 * CELL / l; nor[k + 2] = -hz / l;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setIndex(index); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true; m.matrixAutoUpdate = false;
    group.add(m);
  }
  if (outer) {
    const OS = 32, EXT = HALF + OS * Math.ceil(5000 / OS), ON = Math.round(EXT * 2 / OS) + 1;
    const oh = new Float32Array(ON * ON);
    for (let j = 0; j < ON; j++) for (let i = 0; i < ON; i++) {
      const x = -EXT + i * OS, z = -EXT + j * OS;
      let h = hf.fn(x, z);
      if (Math.abs(x) < HALF - 1 && Math.abs(z) < HALF - 1) h -= outerDrop;
      oh[j * ON + i] = h;
    }
    const opos = new Float32Array(ON * ON * 3), onor = new Float32Array(ON * ON * 3), oidx = [];
    const OH = (i, j) => oh[clamp(j, 0, ON - 1) * ON + clamp(i, 0, ON - 1)];
    for (let j = 0; j < ON; j++) for (let i = 0; i < ON; i++) {
      const k = (j * ON + i) * 3;
      opos[k] = -EXT + i * OS; opos[k + 1] = OH(i, j); opos[k + 2] = -EXT + j * OS;
      const hx = OH(i + 1, j) - OH(i - 1, j), hz = OH(i, j + 1) - OH(i, j - 1), l = Math.hypot(hx, 2 * OS, hz);
      onor[k] = -hx / l; onor[k + 1] = 2 * OS / l; onor[k + 2] = -hz / l;
    }
    for (let j = 0; j < ON - 1; j++) for (let i = 0; i < ON - 1; i++) {
      if (Math.abs(-EXT + (i + 0.5) * OS) < HALF && Math.abs(-EXT + (j + 0.5) * OS) < HALF) continue;
      const v = j * ON + i; oidx.push(v, v + ON, v + 1, v + 1, v + ON, v + ON + 1);
    }
    const og = new THREE.BufferGeometry();
    og.setAttribute('position', new THREE.BufferAttribute(opos, 3));
    og.setAttribute('normal', new THREE.BufferAttribute(onor, 3));
    og.setIndex(oidx); og.computeBoundingSphere();
    const om = new THREE.Mesh(og, mat); om.receiveShadow = true; om.matrixAutoUpdate = false;
    group.add(om);
  }
  scene.add(group);
  return group;
}

// ---------------------------------------------------------------- grass + rice (GPU instanced, wraps around the camera)
export function buildGrass(hf, grassTex, opt = {}) {
  const SEG = 4, uv = [], idx = [];
  for (let i = 0; i < SEG; i++) { const t = i / SEG; uv.push(-1, t, 1, t); }
  uv.push(0, 1);
  for (let i = 0; i < SEG - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const l = (SEG - 1) * 2; idx.push(l, l + 1, SEG * 2);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array((SEG * 2 + 1) * 3), 3));
  g.setAttribute('bladeUV', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const off = new Float32Array(MAX_GRASS * 2), rnd = new Float32Array(MAX_GRASS * 4), rng = mulberry32(5);
  for (let i = 0; i < MAX_GRASS; i++) {
    off[i * 2] = rng() * 4096; off[i * 2 + 1] = rng() * 4096;
    rnd[i * 4] = rng(); rnd[i * 4 + 1] = rng(); rnd[i * 4 + 2] = rng(); rnd[i * 4 + 3] = rng();
  }
  g.setAttribute('iOffset', new THREE.InstancedBufferAttribute(off, 2));
  g.setAttribute('iRand', new THREE.InstancedBufferAttribute(rnd, 4));
  g.instanceCount = Q.grass;
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0, side: THREE.DoubleSide });
  const gu = { uTile: { value: Q.tile }, uRadius: { value: Q.tile * 0.5 }, uWaterLv: { value: opt.water ?? 0 }, uSnow: { value: opt.snow ?? 175 } };
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, gu, hf.U, { tNoise: S.tNoise, tGrassD: { value: grassTex },
      uCam: S.uCam, uPlayer: S.uPlayer, uTime: S.uTime, uWind: S.uWind, uSunDir: S.uSunDir, uSunCol: S.uSunCol });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 bladeUV; attribute vec2 iOffset; attribute vec4 iRand;
        uniform sampler2D tMask, tMask2, tNoise, tGrassD;
        uniform vec3 uCam, uPlayer; uniform float uTime, uTile, uRadius, uWind, uWaterLv, uSnow;
        varying vec3 vGCol; varying float vT; varying vec3 vGW;
        ${GLSL_HEIGHT}`)
      .replace('#include <beginnormal_vertex>', /* glsl */`
        vec2 wp2 = uCam.xz + mod(iOffset - uCam.xz + uTile * 0.5, uTile) - uTile * 0.5;
        vec4 gm2 = textureLod(tMask2, maskUV(wp2), 0.0);
        bool rice = gm2.g > 0.6;
        if (rice) wp2 = (floor(wp2 / vec2(0.32, 0.26)) + 0.5) * vec2(0.32, 0.26) + (iRand.zx - 0.5) * 0.05; // transplanted rows
        float gdist = length(wp2 - uCam.xz);
        float gh = hAt(wp2);
        float ghx = hAt(wp2 + vec2(uCell, 0.0)) - hAt(wp2 - vec2(uCell, 0.0));
        float ghz = hAt(wp2 + vec2(0.0, uCell)) - hAt(wp2 - vec2(0.0, uCell));
        vec3 gN = normalize(vec3(-ghx, 2.0 * uCell, -ghz));
        vec4 gm = textureLod(tMask, maskUV(wp2), 0.0);
        vec4 gz1 = textureLod(tNoise, wp2 * 0.0021, 0.0);
        vec4 gz2 = textureLod(tNoise, wp2 * 0.013, 0.0);
        vec4 gz3 = textureLod(tNoise, wp2 * 0.06, 0.0);
        float dens = smoothstep(0.5, 1.6, gh - uWaterLv + (gz2.r - 0.5) * 1.2)
          * (1.0 - smoothstep(0.26, 0.40, 1.0 - gN.y + (gz2.b - 0.5) * 0.14))
          * (1.0 - smoothstep(uSnow - 25.0, uSnow + 3.0, gh))
          * (1.0 - gm.b * 0.92)
          * (1.0 - smoothstep(0.2, 0.75, gm.r + (gz3.r - 0.5) * 0.35) * 0.82);
        dens *= smoothstep(0.1, 0.45, gz2.g + gz3.g * 0.35);
        dens *= (1.0 - gm2.b) * (1.0 - smoothstep(0.2, 0.7, gm2.r) * 0.85);
        dens *= 1.0 - 0.45 * gm2.a; // mowed town lawns are sparser...
        if (rice) dens = 1.0;
        float keep = step(iRand.w, dens);
        float fade = 1.0 - smoothstep(uRadius * 0.55, uRadius, gdist);
        float gs = keep * fade;
        bool flower = !rice && iRand.w < 0.014 && dens > 0.45;
        float Hh = mix(0.18, 0.78, iRand.y * iRand.y) * (0.5 + 0.7 * gz2.g) * mix(0.25, 1.0, fade) * keep;
        Hh *= 1.0 - 0.68 * gm2.a;   // ...and short
        if (flower) Hh = 0.25 + 0.3 * iRand.y;
        if (rice) Hh = (0.38 + 0.22 * iRand.y) * fade;
        float Wd = (0.02 + 0.022 * iRand.z) * (1.0 + gdist * 0.06) * step(0.001, gs);
        if (rice) Wd *= 0.8;
        float ang = iRand.x * 6.2831853;
        vec2 bdir = vec2(cos(ang), sin(ang)), bside = vec2(-bdir.y, bdir.x);
        float t = bladeUV.y;
        vec2 windDir = normalize(vec2(1.0, 0.35));
        float gust = textureLod(tNoise, wp2 * 0.012 - windDir * uTime * 0.05, 0.0).r;
        float flutter = sin(uTime * (2.2 + iRand.z * 2.5) + iRand.x * 40.0 + dot(wp2, windDir) * 0.8);
        vec2 lean = bdir * (rice ? 0.35 + iRand.z * 0.3 : 0.12 + iRand.z * 0.4) + windDir * (gust * gust * 1.5 + 0.12) * uWind * (rice ? 0.6 : 1.0) + bside * flutter * 0.1 * uWind;
        vec2 away = wp2 - uPlayer.xz; float pd = length(away);
        lean += away / (pd + 0.001) * (1.0 - smoothstep(0.25, 1.1, pd)) * 1.8 * step(abs(uPlayer.y - gh), 2.2);
        float ll = length(lean); if (ll > 1.3) { lean *= 1.3 / ll; ll = 1.3; }
        float bt = t * t;
        vec3 gp = vec3(wp2.x, gh - 0.03, wp2.y);
        gp.xz += lean * bt * Hh;
        gp.y += t * Hh * (1.0 - 0.35 * bt * ll / 1.3);
        gp.xz += bside * bladeUV.x * Wd * 0.5 * (1.0 - t * 0.6);
        vGW = gp; vT = t;
        vec3 bn = normalize(vec3(bdir.x, 0.0, bdir.y) + vec3(0.0, 0.4 + t, 0.0) - vec3(lean.x, 0.0, lean.y) * 0.3);
        vec3 objectNormal = normalize(mix(bn, gN, 0.5) + vec3(bside.x, 0.0, bside.y) * bladeUV.x * 0.3);
        vec3 texC = textureLod(tGrassD, wp2 / 29.0, 5.0).rgb;
        float dryness = smoothstep(0.3, 0.85, gz1.g * 0.6 + gz3.b * 0.3 + iRand.z * 0.35);
        vec3 c = mix(vec3(0.13, 0.22, 0.05), vec3(0.42, 0.38, 0.16), dryness * 0.8) * (0.6 + 0.6 * iRand.y);
        c = mix(c, texC * vec3(0.95, 1.1, 0.75), 0.45);
        if (iRand.z > 0.93) c = mix(c, vec3(0.45, 0.4, 0.25), 0.6);
        if (rice) c = mix(vec3(0.16, 0.34, 0.06), vec3(0.3, 0.46, 0.1), iRand.y) * (0.8 + 0.3 * gz3.r);
        if (flower && t > 0.6) {
          vec3 fc = iRand.x < 0.35 ? vec3(0.9, 0.88, 0.8) : iRand.x < 0.7 ? vec3(0.95, 0.72, 0.1) : vec3(0.45, 0.25, 0.75);
          c = mix(c, fc, smoothstep(0.6, 1.0, t));
        }
        vGCol = c;
      `)
      .replace('#include <begin_vertex>', 'vec3 transformed = gp;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vGCol; varying float vT; varying vec3 vGW; uniform vec3 uSunDir, uSunCol;`)
      .replace('#include <map_fragment>', 'diffuseColor.rgb *= vGCol * mix(0.3, 1.0, pow(max(vT, 1e-4), 0.75));')
      .replace('#include <normal_fragment_begin>', 'float faceDirection = 1.0; vec3 normal = normalize(vNormal); vec3 nonPerturbedNormal = normal;')
      .replace('#include <emissivemap_fragment>', `
        vec3 gV = normalize(vGW - cameraPosition);
        float gTr = pow(max(dot(gV, uSunDir), 1e-4), 4.0) * vT;
        totalEmissiveRadiance += vGCol * uSunCol * gTr * 0.28 + vGCol * uSunCol * 0.03 * vT;`);
  };
  mat.customProgramCacheKey = () => 'grass';
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false; mesh.receiveShadow = true;
  mesh.userData.applyQuality = () => { g.instanceCount = Q.grass; gu.uTile.value = Q.tile; gu.uRadius.value = Q.tile * 0.5; };
  scene.add(mesh);
  return mesh;
}

// ---------------------------------------------------------------- water with planar reflection
export function buildWater(hf, { level = 0, normals, hide = [], deep = [0.006, 0.03, 0.035], shallow = [0.04, 0.13, 0.11], waves = 4.0, strength = 0.55, active = () => true } = {}) {
  const mirrorCam = new THREE.PerspectiveCamera();
  mirrorCam.layers.set(0); // objects moved to layer 1 are not reflected (cheap reflection pass)
  const textureMatrix = new THREE.Matrix4();
  const reflRT = new THREE.WebGLRenderTarget(512, 512, { type: THREE.HalfFloatType });
  const mat = new THREE.ShaderMaterial({
    transparent: true, fog: true, depthWrite: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      tRefl: { value: null }, tNormal: { value: null }, textureMatrix: { value: null }, uLevel: { value: level },
      uDeep: { value: new THREE.Color(...deep) }, uShallow: { value: new THREE.Color(...shallow) }, uWaves: { value: waves }, uStrength: { value: strength },
    }]),
    vertexShader: /* glsl */`
      uniform mat4 textureMatrix; varying vec4 vMirror; varying vec3 vW;
      #include <common>
      #include <fog_pars_vertex>
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; vMirror = textureMatrix * wp;
        vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tRefl, tNormal, tNoise; uniform float uTime, uLevel, uWaves, uStrength; uniform vec3 uSunDir, uSunCol, uAmb, uDeep, uShallow;
      varying vec4 vMirror; varying vec3 vW;
      #include <common>
      #include <fog_pars_fragment>
      ${GLSL_HEIGHT}
      vec4 getNoise(vec2 uv){
        vec2 uv0 = uv / 103.0 + vec2(uTime / 17.0, uTime / 29.0);
        vec2 uv1 = uv / 107.0 - vec2(uTime / -19.0, uTime / 31.0);
        vec2 uv2 = uv / vec2(8907.0, 9803.0) + vec2(uTime / 101.0, uTime / 97.0);
        vec2 uv3 = uv / vec2(1091.0, 1027.0) - vec2(uTime / 109.0, uTime / -113.0);
        return texture2D(tNormal, uv0) + texture2D(tNormal, uv1) + texture2D(tNormal, uv2) + texture2D(tNormal, uv3);
      }
      void main(){
        vec3 eyeVec = cameraPosition - vW; float dist = length(eyeVec); vec3 eyeDir = eyeVec / dist;
        vec4 nz = getNoise(vW.xz * uWaves) * 0.5 - 1.0;
        vec3 sn = normalize(nz.xzy * vec3(uStrength, 1.0, uStrength));
        sn = normalize(mix(sn, vec3(0.0, 1.0, 0.0), smoothstep(40.0, 1800.0, dist) * 0.75));
        vec2 distortion = sn.xz * (0.001 + 1.0 / dist) * 2.0;
        vec3 refl = texture2D(tRefl, vMirror.xy / vMirror.w + distortion).rgb;
        float cosT = max(dot(eyeDir, sn), 0.0);
        float fres = 0.02 + 0.98 * pow(max(1.0 - cosT, 1e-4), 5.0);
        vec3 rd = reflect(-uSunDir, sn);
        float sd = max(dot(eyeDir, rd), 1e-4);
        vec3 spec = uSunCol * (pow(sd, 600.0) * 9.0 + pow(sd, 60.0) * 0.12);
        float inside = step(abs(vW.x), uHalf) * step(abs(vW.z), uHalf);
        float depth = mix(40.0, max(0.0, uLevel - hAt(vW.xz)), inside);
        vec3 body = mix(uShallow, uDeep, 1.0 - exp(-depth * 0.3)) * (uAmb * 1.4 + uSunCol * max(uSunDir.y, 0.0) * 0.12);
        vec3 col = mix(body, refl, fres) + spec;
        float alpha = clamp(1.0 - exp(-depth * 0.9), 0.0, 1.0);
        alpha = max(alpha, fres * smoothstep(0.0, 0.25, depth));
        float fn = texture2D(tNoise, vW.xz * 0.21 + uTime * 0.02).g * texture2D(tNoise, vW.xz * 0.53 - uTime * 0.015).b;
        float band = 0.5 + 0.5 * sin(uTime * 1.3 - depth * 9.0 + fn * 6.0);
        float foam = (1.0 - smoothstep(0.02, 0.55, depth)) * smoothstep(0.25, 0.55, fn * 1.6 * band + 0.15) * smoothstep(0.0, 0.04, depth);
        col = mix(col, (uAmb * 1.2 + uSunCol * max(uSunDir.y, 0.0) * 0.45) * 0.9, foam * 0.75);
        alpha = max(alpha, foam * 0.85);
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  Object.assign(mat.uniforms, hf.U, { tNoise: S.tNoise, uTime: S.uTime, uSunDir: S.uSunDir, uSunCol: S.uSunCol, uAmb: S.uAmb });
  mat.uniforms.tRefl.value = reflRT.texture; mat.uniforms.tNormal.value = normals; mat.uniforms.textureMatrix.value = textureMatrix;
  const water = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000).rotateX(-Math.PI / 2), mat);
  water.position.y = level; water.renderOrder = 2;
  const mirrorPlane = new THREE.Plane(), normal = new THREE.Vector3(0, 1, 0), mirrorPos = new THREE.Vector3(), camPos = new THREE.Vector3(),
    rot = new THREE.Matrix4(), look = new THREE.Vector3(), clipPlane = new THREE.Vector4(), view = new THREE.Vector3(), target = new THREE.Vector3(), q = new THREE.Vector4();
  water.onBeforeRender = (r, sc, cam) => {
    mirrorPos.setFromMatrixPosition(water.matrixWorld); camPos.setFromMatrixPosition(cam.matrixWorld);
    view.subVectors(mirrorPos, camPos);
    if (view.dot(normal) > 0 || !active(camPos)) return;
    view.reflect(normal).negate().add(mirrorPos);
    rot.extractRotation(cam.matrixWorld);
    look.set(0, 0, -1).applyMatrix4(rot).add(camPos);
    target.subVectors(mirrorPos, look).reflect(normal).negate().add(mirrorPos);
    mirrorCam.position.copy(view);
    mirrorCam.up.set(0, 1, 0).applyMatrix4(rot).reflect(normal);
    mirrorCam.lookAt(target);
    mirrorCam.far = cam.far; mirrorCam.updateMatrixWorld();
    mirrorCam.projectionMatrix.copy(cam.projectionMatrix);
    textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    textureMatrix.multiply(mirrorCam.projectionMatrix).multiply(mirrorCam.matrixWorldInverse);
    mirrorPlane.setFromNormalAndCoplanarPoint(normal, mirrorPos).applyMatrix4(mirrorCam.matrixWorldInverse);
    clipPlane.set(mirrorPlane.normal.x, mirrorPlane.normal.y, mirrorPlane.normal.z, mirrorPlane.constant);
    const pm = mirrorCam.projectionMatrix.elements;
    q.x = (Math.sign(clipPlane.x) + pm[8]) / pm[0]; q.y = (Math.sign(clipPlane.y) + pm[9]) / pm[5]; q.z = -1; q.w = (1 + pm[10]) / pm[14];
    clipPlane.multiplyScalar(2 / clipPlane.dot(q));
    pm[2] = clipPlane.x; pm[6] = clipPlane.y; pm[10] = clipPlane.z + 1 - 0.003; pm[14] = clipPlane.w;
    const prevRT = r.getRenderTarget(), prevShadow = r.shadowMap.autoUpdate;
    const vis = hide.map(o => o.visible);
    water.visible = false; hide.forEach(o => o.visible = false);
    r.shadowMap.autoUpdate = false;
    r.setRenderTarget(reflRT); r.state.buffers.depth.setMask(true); r.clear();
    r.render(sc, mirrorCam);
    water.visible = true; hide.forEach((o, i) => o.visible = vis[i]);
    r.shadowMap.autoUpdate = prevShadow; r.setRenderTarget(prevRT);
  };
  water.userData.resize = () => { const rw = Math.max(256, Math.round(Math.min(innerWidth, 1920) * Q.refl)); reflRT.setSize(rw, Math.round(rw * innerHeight / innerWidth)); };
  water.userData.resize();
  water.userData.hide = hide;
  scene.add(water);
  return water;
}

// ---------------------------------------------------------------- conifers with photographed branch cards
export function buildConifer(hi, seed) {
  const rng = mulberry32(seed || (hi ? 101 : 202));
  const P = [], N = [], UV = [], C = [], I = [];
  let vi = 0;
  const push = (x, y, z, u, v, ao) => {
    P.push(x, y, z);
    let nx = x, nz = z, ny = 0.25 + (y - 0.55) * 0.35;
    const r = Math.hypot(x, z); if (r < 1e-4) { nx = 0; nz = 0; ny = 1; }
    const l = Math.hypot(nx, ny, nz); N.push(nx / l, ny / l, nz / l);
    UV.push(u, v); C.push(ao, ao, ao); return vi++;
  };
  // variant 0 = long side branch (left half of atlas), 1 = dense crown branch (right half)
  const card = (bx, by, bz, dx, dy, dz, L, wx, wy, wz, droop, rMax, variant) => {
    const rows = hi ? 4 : 2, ids = [], u0 = variant * 0.5;
    for (let r = 0; r < rows; r++) {
      const t = r / (rows - 1);
      const cx = bx + dx * L * t, cy = by + dy * L * t - droop * t * t * L, cz = bz + dz * L * t;
      const ao = (0.35 + 0.65 * Math.min(1, Math.hypot(cx, cz) / (rMax + 1e-4))) * (0.55 + 0.45 * Math.min(1, cy));
      ids.push(push(cx - wx * 0.5, cy - wy * 0.5, cz - wz * 0.5, u0, t, ao), push(cx + wx * 0.5, cy + wy * 0.5, cz + wz * 0.5, u0 + 0.5, t, ao));
    }
    for (let r = 0; r < rows - 1; r++) { const a = ids[r * 2], b = ids[r * 2 + 1], c = ids[r * 2 + 2], d = ids[r * 2 + 3]; I.push(a, b, c, b, d, c); }
  };
  const K = hi ? 20 : 8, y0 = 0.12;
  for (let k = 0; k < K; k++) {
    const f = k / (K - 1);
    const y = y0 + (0.93 - y0) * Math.pow(f, 0.9);
    const rMax = 0.24 * Math.pow(1 - (y - y0) / (1 - y0), 0.95) + 0.03;
    const nb = hi ? 6 + Math.floor(rng() * 3) : 5;
    const a0 = rng() * 6.283;
    for (let b = 0; b < nb; b++) {
      const a = a0 + b / nb * 6.283 + (rng() - 0.5) * 0.5;
      const L = rMax * (0.9 + rng() * 0.3) * 1.15;
      const up = lerp(-0.28, 0.25, f) + (rng() - 0.5) * 0.15;
      let dx = Math.cos(a), dz = Math.sin(a), dy = up; const dl = Math.hypot(dx, dy, dz); dx /= dl; dy /= dl; dz /= dl;
      const W = L * (hi ? 0.95 : 1.3);
      let wx = -Math.sin(a), wy = (rng() - 0.5) * 0.5, wz = Math.cos(a); const wl = Math.hypot(wx, wy, wz); wx /= wl; wy /= wl; wz /= wl;
      const droop = lerp(0.3, 0.04, f) * (0.7 + rng() * 0.6);
      const by = y + (rng() - 0.5) * 0.02, variant = f > 0.72 ? 1 : 0;
      card(dx * 0.006, by, dz * 0.006, dx, dy, dz, L, wx * W, wy * W, wz * W, droop, rMax, variant);
      if (hi) {
        let vx = dy * wz - dz * wy, vy = dz * wx - dx * wz, vz = dx * wy - dy * wx; const vl = Math.hypot(vx, vy, vz);
        const V = W * 0.55 / vl;
        card(dx * 0.006, by, dz * 0.006, dx, dy, dz, L * 0.85, vx * V, vy * V, vz * V, droop, rMax, variant);
      }
    }
  }
  for (let s = 0; s < 3; s++) { const a = s * Math.PI / 3; card(0, 0.84, 0, 0, 1, 0, 0.17, Math.cos(a) * 0.09, 0, Math.sin(a) * 0.09, 0, 0.05, 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setIndex(I);
  const trunk = new THREE.CylinderGeometry(0.006, 0.028, 1, hi ? 10 : 5, hi ? 4 : 1, true);
  trunk.translate(0, 0.5, 0);
  const tuv = trunk.attributes.uv; for (let i = 0; i < tuv.count; i++) tuv.setXY(i, tuv.getX(i) * 3, tuv.getY(i) * 12);
  return { foliage: g, trunk };
}

export function windPatch(mat, key, amount = 1) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.uniforms.uTime = S.uTime; sh.uniforms.uWind = S.uWind;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uWind;')
      .replace('#include <begin_vertex>', `vec3 transformed = vec3(position);
        #ifdef USE_INSTANCING
          vec3 ip = instanceMatrix[3].xyz;
        #else
          vec3 ip = vec3(0.0);
        #endif
        float ph = ip.x * 0.071 + ip.z * 0.053;
        float sw = max(position.y, 0.0); sw *= sw * ${amount.toFixed(3)};
        transformed.x += (sin(uTime * 0.9 + ph) * 0.6 + sin(uTime * 2.3 + ph * 1.7) * 0.2) * 0.012 * uWind * sw;
        transformed.z += cos(uTime * 0.7 + ph * 1.3) * 0.006 * uWind * sw;`);
  };
  mat.customProgramCacheKey = () => key;
}

let branchTex = null;
export function coniferMaterials() {
  if (branchTex) return branchTex;
  const d = loadTex('gen/fir_branch_diff.png', true, [40, 60, 30]);
  const n = loadTex('gen/fir_branch_nor.png', false, NFLAT);
  d.wrapS = d.wrapT = n.wrapS = n.wrapT = THREE.ClampToEdgeWrapping;
  const foliage = new THREE.MeshStandardMaterial({ map: d, normalMap: n, normalScale: new THREE.Vector2(0.7, 0.7), vertexColors: true,
    alphaTest: 0.4, alphaToCoverage: Q.msaa > 0, side: THREE.DoubleSide, roughness: 0.88, metalness: 0, color: 0xd2dac4 });
  foliage.onBeforeCompile = sh => {
    sh.uniforms.uSunViewDir = S.uSunViewDir; sh.uniforms.uSunCol = S.uSunCol;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSunViewDir; uniform vec3 uSunCol;')
      .replace('#include <alphatest_fragment>', `
        { vec2 ts = vec2(textureSize(map, 0)); vec2 dx = dFdx(vMapUv * ts), dy = dFdy(vMapUv * ts);
          float lod = max(0.0, 0.5 * log2(max(max(dot(dx, dx), dot(dy, dy)), 1e-8)));
          diffuseColor.a = min(1.0, diffuseColor.a * (1.0 + lod * 0.3)); }
        #ifdef ALPHA_TO_COVERAGE
          diffuseColor.a = clamp((diffuseColor.a - alphaTest) / max(fwidth(diffuseColor.a), 1e-3) + 0.5, 0.0, 1.0);
          if (diffuseColor.a <= 0.0) discard;
        #else
          if (diffuseColor.a < alphaTest) discard;
        #endif`)
      .replace('#include <normal_fragment_begin>', `float faceDirection = 1.0; vec3 normal = normalize(vNormal);
        #ifdef USE_NORMALMAP_TANGENTSPACE
          mat3 tbn = getTangentFrame(-vViewPosition, normal, vNormalMapUv);
        #endif
        vec3 nonPerturbedNormal = normal;`)
      .replace('#include <emissivemap_fragment>', `
        float trl = pow(max(dot(normalize(-vViewPosition), uSunViewDir), 1e-4), 3.0);
        totalEmissiveRadiance += diffuseColor.rgb * uSunCol * (trl * 0.25 + 0.02);`);
  };
  windPatch(foliage, 'conifer');
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: d, alphaTest: 0.4 });
  windPatch(depth, 'coniferDepth');
  const trunk = new THREE.MeshStandardMaterial({ map: phTex('fir_tree_01', 'bark_diff', '1k', true), normalMap: phTex('fir_tree_01', 'bark_nor_gl', '1k', false, NFLAT), roughness: 0.95, color: 0xa89888 });
  windPatch(trunk, 'coniferTrunk');
  branchTex = { foliage, depth, trunk };
  return branchTex;
}

// trees: [{x,y,z,s,sx,r,tilt,tilt2,c}] — builds LOD'd, cell-culled instanced forest and trunk colliders
export function buildForest(trees, { hiDist = () => Q.treeHi, farDist = () => Q.trees } = {}) {
  const M = coniferMaterials();
  const hi = buildConifer(true), lo = buildConifer(false);
  new Scatter(trees, [
    { dist: hiDist, parts: [{ geometry: hi.foliage, material: M.foliage, tint: true, castShadow: true, depth: M.depth }, { geometry: hi.trunk, material: M.trunk, castShadow: true }] },
    { dist: farDist, parts: [{ geometry: lo.foliage, material: M.foliage, tint: true, castShadow: true, depth: M.depth }, { geometry: lo.trunk, material: M.trunk }] },
  ], 128);
  for (const t of trees) addCircle(t.x, t.z, 0.028 * t.s * (t.sx || 1) + 0.05);
  return M;
}
export function treeColor(rng) { return new THREE.Color().setHSL(0.24 + (rng() - 0.5) * 0.06, 0.1 + rng() * 0.2, 0.5 + rng() * 0.2); }
