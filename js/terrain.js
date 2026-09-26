// Reusable outdoor systems: heightfield terrain with painted splat shading, GPU grass (and rice, reeds, flowers),
// planar-reflection water, conifer forests (trees.js). Maps configure these and add their own content.
import { THREE, scene, S, Q, MAX_GRASS, clamp, lerp, smoothstep, mulberry32, tick, loadTex, phTex, NFLAT, maxAniso, Scatter, addCircle } from './core.js';
import { CLOUD_SHADE_GLSL } from './clouds.js';
import { buildConiferForest, firColor } from './trees.js';

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

// ---------------------------------------------------------------- painted palette (anime look)
// Terrain and grass share these colours and the meadow function, so every blade matches the ground it grows from.
export const PAINT = {
  gDeep: '#2a7a3e', gLush: '#4ea236', gLight: '#9ccd4c', gDry: '#c9c45c', forest: '#35592b', canopy: '#24503a',
  rockL: '#a3978d', rockD: '#5f5d72', sand: '#ead7a2', sandWet: '#a98f66', snow: '#f5f8ff', bed: '#2a6d66',
};
export const paintU = {};
for (const k in PAINT) paintU['uP_' + k] = { value: new THREE.Color(PAINT[k]) };
export const MEADOW_GLSL = /* glsl */`
  uniform vec3 ${Object.keys(PAINT).map(k => 'uP_' + k).join(', ')};
  // nz1/nz2/nz3: tNoise at world * 0.0021 / 0.013 / 0.06
  vec3 meadowColor(vec4 nz1, vec4 nz2, vec4 nz3){
    vec3 c = mix(uP_gDeep, uP_gLush, smoothstep(0.28, 0.62, nz1.g + (nz2.b - 0.5) * 0.3));
    c = mix(c, uP_gLight, smoothstep(0.5, 0.8, nz2.r + (nz1.r - 0.5) * 0.4) * 0.75);
    c = mix(c, uP_gDry, smoothstep(0.62, 0.86, nz1.b + (nz3.g - 0.5) * 0.2) * 0.55);
    return c;
  }`;

// ---------------------------------------------------------------- splat terrain
// layers: { grass, forest, rock, shore, urban } each { d: diffuse tex, n: normal tex, s: tile metres, tint: [r,g,b] }
const terrainTreeDist = { value: Q.trees }; // far-LOD tree cull distance (quality dependent)
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
      uWaterLv: { value: opt.water ?? 0 }, uSnow: { value: opt.snow ?? 175 }, uShore: { value: opt.shore ?? 1.3 }, uTreeDist: terrainTreeDist,
    }, paintU);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNorm;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWNorm = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying vec3 vWNorm;
        uniform sampler2D tGrassD, tGrassN, tForestD, tForestN, tRockD, tRockN, tSandD, tSandN, tUrbanD, tUrbanN, tNoise, tMask, tMask2;
        uniform float uHalf, uCell, uHN, uRockS, uWaterLv, uSnow, uShore, uTreeDist; uniform vec4 uScales; uniform vec3 uTintG, uTintF, uTintU, uTintS;
        vec3 unpackN(vec4 t){ return t.xyz * 2.0 - 1.0; }
        vec2 maskUV(vec2 p){ return ((p + uHalf) / uCell + 0.5) / uHN; }
        float lum3(vec3 c){ return dot(c, vec3(0.3, 0.55, 0.15)); }
        ${MEADOW_GLSL}`)
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
        float nearT = 1.0 - smoothstep(30.0, 220.0, camDist);
        // meadow: painted colour patches + a faint brush texture from the photo map's luminance
        vec3 cGrass = meadowColor(nz1, nz2, nz3);
        cGrass *= mix(1.0, clamp(lum3(texture2D(tGrassD, wuv / uScales.x).rgb) * 3.6, 0.6, 1.4), 0.2 * nearT);
        vec3 nGrass = unpackN(texture2D(tGrassN, wuv / uScales.x)) * 0.35;
        vec3 cForest = uP_forest * mix(0.8, 1.12, nz2.r) * mix(1.0, clamp(lum3(texture2D(tForestD, wuv / uScales.y).rgb) * 3.2, 0.6, 1.4), 0.3 * nearT);
        vec3 nForest = unpackN(texture2D(tForestN, wuv / uScales.y)) * 0.5;
        vec3 cSand = mix(uP_sand, uP_sand * vec3(0.92, 0.9, 0.84), nz3.r) * mix(1.0, clamp(lum3(texture2D(tSandD, wuv / uScales.z).rgb) * 2.2, 0.7, 1.3), 0.25 * nearT);
        vec3 nSand = unpackN(texture2D(tSandN, wuv / uScales.z)) * 0.5;
        vec3 uTex = texture2D(tUrbanD, wuv / uScales.w).rgb, uAvg = textureLod(tUrbanD, wuv / uScales.w, 7.0).rgb;
        vec3 cUrban = mix(uAvg, uTex, 0.35) * uTintU;
        vec3 nUrban = unpackN(texture2D(tUrbanN, wuv / uScales.w)) * 0.6;
        vec3 bw = pow(max(abs(wN), vec3(1e-4)), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
        float rs = mix(1.0 / uRockS, 1.0 / (uRockS * 3.4), farT * 0.7);
        vec3 cRockT = texture2D(tRockD, vWPos.zy * rs).rgb * bw.x + texture2D(tRockD, vWPos.xz * rs).rgb * bw.y + texture2D(tRockD, vWPos.xy * rs).rgb * bw.z;
        vec3 rnx = unpackN(texture2D(tRockN, vWPos.zy * rs)), rny = unpackN(texture2D(tRockN, vWPos.xz * rs)), rnz = unpackN(texture2D(tRockN, vWPos.xy * rs));
        vec3 nRock = normalize(wN + vec3(0.0, rnx.y, rnx.x) * bw.x + vec3(rny.x, 0.0, rny.y) * bw.y + vec3(rnz.x, rnz.y, 0.0) * bw.z);
        // rock: two painted tones picked by the photo's light/dark strata
        vec3 cRock = mix(uP_rockD, uP_rockL, smoothstep(0.18, 0.42, lum3(cRockT) + (nz2.b - 0.5) * 0.12));
        float shoreN = (nz2.r - 0.5) * 1.1 + (nz3.b - 0.5) * 0.6;
        float wSand = max(1.0 - smoothstep(uShore * 0.2, uShore, h + shoreN * uShore * 0.9), msk2.g);
        float wRock = smoothstep(0.30, 0.46, slope + (nz2.b - 0.5) * 0.14);
        float wSnow = smoothstep(uSnow, uSnow + 40.0, vWPos.y + (nz1.b - 0.5) * 70.0) * (1.0 - smoothstep(0.42, 0.62, slope));
        float wForest = smoothstep(0.2, 0.7, forest + (nz3.r - 0.5) * 0.35);
        float wUrban = smoothstep(0.15, 0.6, msk2.r + (nz3.g - 0.5) * 0.25);
        // where far trees are no longer drawn, the forest floor takes the canopy colour
        float treeGone = smoothstep(uTreeDist * 0.82, uTreeDist, camDist) * inside;
        cForest = mix(cForest, uP_canopy * (0.8 + 0.4 * nz3.r), max(treeGone, 1.0 - inside) * smoothstep(0.3, 0.8, forest));
        vec3 col = mix(cGrass, cForest, wForest);
        vec3 tn = mix(nGrass, nForest, wForest);
        col = mix(col, cSand, wSand); tn = mix(tn, nSand, wSand);
        col = mix(col, cUrban, wUrban); tn = mix(tn, nUrban, wUrban);
        vec3 nW = normalize(wN + vec3(tn.x, 0.0, tn.y));
        col = mix(col, cRock, wRock * (1.0 - wUrban)); nW = normalize(mix(nW, nRock, wRock * (1.0 - wUrban)));
        col = mix(col, uP_snow, wSnow); nW = normalize(mix(nW, wN, wSnow * 0.7));
        float wet = max(1.0 - smoothstep(0.0, 0.7, h), msk2.g * 0.8);
        col = mix(col, uP_sandWet, wet * wSand * 0.8);
        col = mix(col, uP_bed * (0.85 + 0.3 * nz3.g), smoothstep(0.0, 1.0, -h) * (1.0 - msk2.g)); // teal lake bed
        col *= mix(1.0, 0.7, smoothstep(1.0, 12.0, -h));
        col *= mix(1.0, ao, 0.6) * (1.0 - canopy * 0.35);
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
  group.userData.applyQuality = () => { terrainTreeDist.value = Q.trees; };
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
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  mat.defines = { CLOUD_SHADE_VARYING: '' };
  const gu = { uTile: { value: Q.tile }, uRadius: { value: Q.tile * 0.5 }, uWaterLv: { value: opt.water ?? 0 }, uSnow: { value: opt.snow ?? 175 },
    uShore: { value: opt.shore ?? 1.3 }, uReeds: { value: opt.reeds ? 1 : 0 } };
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, gu, hf.U, paintU, { tNoise: S.tNoise, tGrassD: { value: grassTex },
      uCam: S.uCam, uPlayer: S.uPlayer, uTime: S.uTime, uWind: S.uWind, uSunDir: S.uSunDir, uSunCol: S.uSunCol });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 bladeUV; attribute vec2 iOffset; attribute vec4 iRand;
        uniform sampler2D tMask, tMask2, tNoise, tGrassD;
        uniform vec3 uCam, uPlayer; uniform float uTime, uTile, uRadius, uWind, uWaterLv, uSnow, uShore, uReeds;
        varying vec3 vGCol; varying vec3 vGTip; varying float vT; varying vec3 vGW; varying float vCloudLit;
        ${GLSL_HEIGHT}
        ${CLOUD_SHADE_GLSL}
        ${MEADOW_GLSL}`)
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
        float dens = smoothstep(uShore * 0.35, uShore * 1.2, gh - uWaterLv + (gz2.r - 0.5) * 1.2)
          * (1.0 - smoothstep(0.26, 0.40, 1.0 - gN.y + (gz2.b - 0.5) * 0.14))
          * (1.0 - smoothstep(uSnow - 25.0, uSnow + 3.0, gh))
          * (1.0 - gm.b * 0.92)
          * (1.0 - smoothstep(0.2, 0.75, gm.r + (gz3.r - 0.5) * 0.35) * 0.82);
        dens *= smoothstep(0.1, 0.45, gz2.g + gz3.g * 0.35);
        dens *= (1.0 - gm2.b) * (1.0 - smoothstep(0.2, 0.7, gm2.r) * 0.85);
        dens *= 1.0 - 0.45 * gm2.a; // mowed town lawns are sparser...
        if (rice) dens = 1.0;
        // reed beds in clumps along the waterline (standing in the shallows and on the wet margin)
        float hw = gh - uWaterLv, reedN = gz3.b * 0.55 + gz2.g * 0.65 + gz1.r * 0.2;
        bool reed = !rice && uReeds > 0.5 && hw > -0.5 && hw < 0.55 && reedN > 0.66 && iRand.w < 0.7 && gN.y > 0.9;
        if (reed) dens = 1.0;
        float keep = step(iRand.w, dens);
        float fade = 1.0 - smoothstep(uRadius * 0.55, uRadius, gdist);
        float gs = keep * fade;
        float fPatch = smoothstep(0.58, 0.8, gz3.g * 0.65 + gz2.a * 0.6);
        bool flower = !rice && !reed && dens > 0.35 && iRand.w < (0.01 + 0.16 * fPatch * dens) * smoothstep(22.0, 30.0, gdist);
        float Hh = mix(0.18, 0.78, iRand.y * iRand.y) * (0.5 + 0.7 * gz2.g) * mix(0.25, 1.0, fade) * keep;
        Hh *= 1.0 - 0.68 * gm2.a;   // ...and short
        if (flower) Hh = (0.28 + 0.32 * iRand.y) * mix(0.4, 1.0, fade);
        if (rice) Hh = (0.38 + 0.22 * iRand.y) * fade;
        if (reed) Hh = (1.0 + 1.1 * iRand.y * iRand.y + max(-hw, 0.0)) * mix(0.3, 1.0, fade);
        float Wd = (0.02 + 0.022 * iRand.z) * (1.0 + gdist * 0.06) * step(0.001, gs);
        if (rice) Wd *= 0.8;
        if (reed) Wd *= 0.75;
        float ang = iRand.x * 6.2831853;
        vec2 bdir = vec2(cos(ang), sin(ang)), bside = vec2(-bdir.y, bdir.x);
        float t = bladeUV.y;
        vec2 windDir = normalize(vec2(1.0, 0.35));
        float gust = textureLod(tNoise, wp2 * 0.012 - windDir * uTime * 0.05, 0.0).r;
        float flutter = sin(uTime * (2.2 + iRand.z * 2.5) + iRand.x * 40.0 + dot(wp2, windDir) * 0.8);
        vec2 lean = bdir * (rice ? 0.35 + iRand.z * 0.3 : reed ? 0.04 + iRand.z * 0.14 : 0.12 + iRand.z * 0.4) + windDir * (gust * gust * 1.5 + 0.12) * uWind * (rice ? 0.6 : reed ? 0.35 : 1.0) + bside * flutter * 0.1 * uWind;
        vec2 away = wp2 - uPlayer.xz; float pd = length(away);
        lean += away / (pd + 0.001) * (1.0 - smoothstep(0.25, 1.1, pd)) * 1.8 * step(abs(uPlayer.y - gh), 2.2);
        float ll = length(lean); if (ll > 1.3) { lean *= 1.3 / ll; ll = 1.3; }
        float bt = t * t;
        vec3 gp = vec3(wp2.x, gh - 0.03, wp2.y);
        gp.xz += lean * bt * Hh;
        gp.y += t * Hh * (1.0 - 0.35 * bt * ll / 1.3);
        gp.xz += bside * bladeUV.x * Wd * 0.5 * (flower ? 0.5 + smoothstep(0.55, 0.85, t) * 3.5 : 1.0 - t * 0.6);  // flowers open into a blossom
        vGW = gp; vT = t; vCloudLit = cloudShade(gp);
        vec3 bn = normalize(vec3(bdir.x, 0.0, bdir.y) + vec3(0.0, 0.4 + t, 0.0) - vec3(lean.x, 0.0, lean.y) * 0.3);
        vec3 objectNormal = normalize(mix(bn, gN, 0.82) + vec3(bside.x, 0.0, bside.y) * bladeUV.x * 0.08);
        // the blade takes the painted colour of the ground it grows from; tips are lighter and warmer
        vec3 c = meadowColor(gz1, gz2, gz3);
        c = mix(c, uP_forest * 1.25, smoothstep(0.2, 0.75, gm.r) * 0.6);
        c *= 0.9 + 0.22 * iRand.y;
        vec3 tip = mix(c, uP_gLight, 0.45) * 1.12 + vec3(0.03, 0.03, 0.0);
        // bright bands where the gusts roll across the meadow
        float wave = smoothstep(0.52, 0.85, gust);
        tip += vec3(0.07, 0.09, 0.02) * wave;
        if (rice) { c = mix(vec3(0.12, 0.36, 0.05), vec3(0.28, 0.5, 0.08), iRand.y) * (0.8 + 0.3 * gz3.r); tip = c * 1.2; }
        if (reed) {
          c = mix(vec3(0.1, 0.3, 0.08), vec3(0.36, 0.42, 0.14), iRand.y * 0.75 + gz3.r * 0.25) * (0.8 + 0.3 * iRand.z);
          tip = c * 1.15;
          if (iRand.x > 0.9 && t > 0.84) c = tip = vec3(0.22, 0.12, 0.06);   // bulrush heads
        }
        if (flower) {
          // each patch has its own colour: white daisies, buttercups, pink clover, violets, poppies
          float pick = fract(gz2.g * 5.3 + gz3.b * 0.6 + step(0.9, iRand.x) * 0.37);
          vec3 fc = pick < 0.26 ? vec3(1.0, 0.95, 0.86) : pick < 0.5 ? vec3(1.0, 0.72, 0.06) : pick < 0.7 ? vec3(1.0, 0.36, 0.55)
                  : pick < 0.88 ? vec3(0.42, 0.3, 1.0) : vec3(1.0, 0.3, 0.12);
          float head = smoothstep(0.6, 0.72, t);
          c = mix(c, fc, head); tip = mix(tip, fc * 1.1, head);
        }
        vGCol = c; vGTip = tip;
      `)
      .replace('#include <begin_vertex>', 'vec3 transformed = gp;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vGCol; varying vec3 vGTip; varying float vT; varying vec3 vGW; uniform vec3 uSunDir, uSunCol;`)
      .replace('#include <map_fragment>', 'diffuseColor.rgb *= mix(vGCol * 0.62, vGTip, smoothstep(0.0, 1.0, vT));')
      .replace('#include <normal_fragment_begin>', 'float faceDirection = 1.0; vec3 normal = normalize(vNormal); vec3 nonPerturbedNormal = normal;')
      .replace('#include <emissivemap_fragment>', `
        vec3 gV = normalize(vGW - cameraPosition);
        float gTr = pow(max(dot(gV, uSunDir), 1e-4), 4.0) * vT;
        totalEmissiveRadiance += vGTip * uSunCol * (gTr * 0.22 + 0.02 * vT) * vCloudLit;`);
  };
  mat.customProgramCacheKey = () => 'grass';
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false; mesh.receiveShadow = true;
  mesh.userData.applyQuality = () => { g.instanceCount = Q.grass; gu.uTile.value = Q.tile; gu.uRadius.value = Q.tile * 0.5; };
  scene.add(mesh);
  return mesh;
}

// ---------------------------------------------------------------- water with planar reflection
// painted water: turquoise shallows deepening to blue, a soft sky sheen, crisp white foam lines at the shore, sun sparkles
export function buildWater(hf, { level = 0, normals, hide = [], deep = '#15508e', mid = '#2398be', shallow = '#52d6c4', waves = 4.0, strength = 0.4, active = () => true } = {}) {
  const mirrorCam = new THREE.PerspectiveCamera();
  mirrorCam.layers.set(0); // objects moved to layer 1 are not reflected (cheap reflection pass)
  const textureMatrix = new THREE.Matrix4();
  const reflRT = new THREE.WebGLRenderTarget(512, 512, { type: THREE.HalfFloatType });
  const mat = new THREE.ShaderMaterial({
    transparent: true, fog: true, depthWrite: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      tRefl: { value: null }, tNormal: { value: null }, textureMatrix: { value: null }, uLevel: { value: level },
      uDeep: { value: new THREE.Color(deep) }, uMid: { value: new THREE.Color(mid) }, uShallow: { value: new THREE.Color(shallow) }, uWaves: { value: waves }, uStrength: { value: strength },
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
      uniform sampler2D tRefl, tNormal, tNoise; uniform float uTime, uLevel, uWaves, uStrength; uniform vec3 uSunDir, uLightDir, uSunCol, uAmb, uDeep, uMid, uShallow;
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
        float fres = 0.06 + 0.62 * pow(max(1.0 - cosT, 1e-4), 4.0);
        vec3 rd = reflect(-uLightDir, sn);
        float sd = max(dot(eyeDir, rd), 1e-4);
        // sparkles: the sharpest ripple reflections of the sun become little star glints
        float glint = smoothstep(0.9982, 0.9993, sd) * (0.6 + 0.4 * sin(uTime * 7.0 + vW.x * 3.1 + vW.z * 2.3));
        vec3 spec = uSunCol * (glint * 2.2 + pow(sd, 90.0) * 0.12) * step(0.0, uLightDir.y);
        float inside = step(abs(vW.x), uHalf) * step(abs(vW.z), uHalf);
        float depth = mix(40.0, max(0.0, uLevel - hAt(vW.xz)), inside);
        float dd = 1.0 - exp(-depth * 0.32);
        vec3 body = mix(uShallow, uMid, smoothstep(0.0, 0.55, dd));
        body = mix(body, uDeep, smoothstep(0.5, 1.0, dd));
        body *= uAmb * 0.75 + uSunCol * max(uLightDir.y, 0.0) * 0.22 + 0.04;
        vec3 col = mix(body, refl * mix(vec3(1.0), uShallow * 1.6, 0.18), fres) + spec;
        float alpha = clamp(1.0 - exp(-depth * 2.2), 0.0, 1.0);
        alpha = max(alpha, fres * smoothstep(0.0, 0.2, depth));
        // foam: a solid wobbly line at the water's edge and a second one lapping in and out
        float fn = texture2D(tNoise, vW.xz * 0.19 + uTime * 0.015).g * 0.6 + texture2D(tNoise, vW.xz * 0.61 - uTime * 0.02).b * 0.4;
        float w = (fn - 0.45) * 0.09;
        float edge = 1.0 - smoothstep(0.045, 0.06, depth + w);
        float lap = 0.15 + 0.07 * sin(uTime * 0.8 + fn * 2.5);
        float line2 = (1.0 - smoothstep(0.01, 0.022, abs(depth + w * 0.5 - lap))) * 0.9;
        float foam = max(edge, line2) * smoothstep(0.0, 0.012, depth) * (1.0 - smoothstep(70.0, 220.0, dist));
        col = mix(col, vec3(1.0, 1.0, 0.98) * (uAmb * 0.8 + uSunCol * max(uLightDir.y, 0.0) * 0.3 + 0.08), foam);
        alpha = max(alpha, foam);
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  Object.assign(mat.uniforms, hf.U, { tNoise: S.tNoise, uTime: S.uTime, uSunDir: S.uSunDir, uLightDir: S.uLightDir, uSunCol: S.uSunCol, uAmb: S.uAmb });
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

// conifer forests (Ghibli-style trees live in trees.js; kept here so maps can keep importing it from terrain.js)
export function buildForest(trees, opt) { buildConiferForest(trees, opt); }
export function treeColor(rng) { return firColor(rng); }
