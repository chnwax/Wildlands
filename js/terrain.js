// Reusable outdoor systems: heightfield terrain with painted splat shading, GPU grass (and rice, reeds, flowers),
// planar-reflection water, conifer forests (trees.js). Maps configure these and add their own content.
import { THREE, scene, S, Q, MAX_GRASS, clamp, lerp, smoothstep, mulberry32, tick, loadTex, phTex, NFLAT, maxAniso, Scatter, addCircle, scatters, noiseAt } from './core.js';
import { CLOUD_SHADE_GLSL } from './clouds.js';
import { buildConiferForest, buildFarForest, firColor, leafColor } from './trees.js';

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
// All five diffuse maps live in one texture array and all five normal maps in another, so every layer gets its own
// normal map while the whole ground shader uses 7 texture units (WebGL2 guarantees 16).
const terrainTreeDist = { value: Q.trees }; // far-LOD tree cull distance (quality dependent)
const terrainGrassR = { value: Q.tile * 0.5 }; // where the near grass blades end and the clump cards take over
const terrainFarTrees = { value: 0 };           // half-extent of the outer far-forest (trees drawn up to there)
const LAYER_RES = 1024;
const arrayCache = new Map();
// copies loaded textures into the layers of a DataArrayTexture as they arrive (flipped like three's image upload)
function layerArray(texs, srgb, fill) {
  const key = texs.map(t => t.uuid).join() + srgb;
  if (arrayCache.has(key)) return arrayCache.get(key);
  const N = texs.length, R = LAYER_RES, data = new Uint8Array(R * R * 4 * N);
  for (let i = 0; i < data.length; i += 4) { data[i] = fill[0]; data[i + 1] = fill[1]; data[i + 2] = fill[2]; data[i + 3] = 255; }
  const arr = new THREE.DataArrayTexture(data, R, R, N);
  arr.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  arr.wrapS = arr.wrapT = THREE.RepeatWrapping; arr.magFilter = THREE.LinearFilter; arr.minFilter = THREE.LinearMipmapLinearFilter;
  arr.generateMipmaps = true; arr.anisotropy = maxAniso; arr.needsUpdate = true;
  const cv = document.createElement('canvas'); cv.width = cv.height = R;
  const g = cv.getContext('2d', { willReadFrequently: true }), done = new Array(N).fill(false);
  const poll = () => {
    let dirty = false;
    texs.forEach((t, li) => {
      const im = t.image; if (done[li] || !im || !(im.width > 0)) return;
      done[li] = true; dirty = true;
      g.setTransform(1, 0, 0, -1, 0, R); g.clearRect(0, 0, R, R); g.drawImage(im, 0, 0, R, R);
      data.set(g.getImageData(0, 0, R, R).data, li * R * R * 4);
    });
    if (dirty) arr.needsUpdate = true;
    if (done.includes(false)) setTimeout(poll, 150);
  };
  poll();
  arrayCache.set(key, arr);
  return arr;
}
export function terrainMaterial(hf, L, opt = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
  // cloud shadows are evaluated per vertex (keeps the fragment shader light)
  mat.defines = opt.lite ? { CLOUD_SHADE_VARYING: '', TERRAIN_LITE: '' } : { CLOUD_SHADE_VARYING: '' };
  // if this GPU cannot run the full splat shader, main.js swaps in the painted-colour version (no photo textures)
  if (!opt.lite) mat.userData.fallback = () => terrainMaterial(hf, L, Object.assign({}, opt, { lite: true }));
  mat.userData.opt = opt;
  const tintV = a => new THREE.Vector3(...(a || [1, 1, 1]));
  const order = [L.grass, L.forest, L.rock, L.shore, L.urban];
  const tLayD = opt.lite ? null : layerArray(order.map(l => l.d), true, [110, 110, 100]);
  const tLayN = opt.lite ? null : layerArray(order.map(l => l.n), false, [128, 128, 255]);
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, hf.U, {
      tLayD: { value: tLayD }, tLayN: { value: tLayN }, tNoise: S.tNoise,
      uScales: { value: new THREE.Vector4(L.grass.s, L.forest.s, L.shore.s, L.urban.s) }, uRockS: { value: L.rock.s },
      uTintG: { value: tintV(L.grass.tint) }, uTintF: { value: tintV(L.forest.tint) }, uTintU: { value: tintV(L.urban.tint) }, uUrbanNorm: { value: L.urban.norm || 0 }, uTintS: { value: tintV(L.shore.tint) },
      uWaterLv: { value: opt.water ?? 0 }, uSnow: { value: opt.snow ?? 175 }, uShore: { value: opt.shore ?? 1.3 }, uTreeDist: terrainTreeDist, uGrassR: terrainGrassR, uFarTrees: terrainFarTrees,
    }, paintU);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNorm; varying float vCloudLit;\n' + CLOUD_SHADE_GLSL)
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWNorm = normalize(mat3(modelMatrix) * objectNormal); vCloudLit = cloudShade(vWPos);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying vec3 vWNorm;
        uniform sampler2D tNoise, tMask, tMask2;
        uniform float uHalf, uCell, uHN, uRockS, uWaterLv, uSnow, uShore, uTreeDist, uGrassR, uFarTrees; uniform vec4 uScales; uniform vec3 uTintG, uTintF, uTintU, uTintS; uniform float uUrbanNorm;
        vec3 unpackN(vec4 t){ return t.xyz * 2.0 - 1.0; }
        // layers: 0 grass, 1 forest floor, 2 rock, 3 shore, 4 urban ground
        #ifdef TERRAIN_LITE
          vec4 layD(vec2 uv, float l){ return vec4(0.32); }
          vec4 layDL(vec2 uv, float l, float lod){ return vec4(0.32); }
          vec3 layN(vec2 uv, float l){ return vec3(0.0, 0.0, 1.0); }
          vec4 layDA(vec2 uv, float l, float b){ return vec4(0.32); }
          vec3 layNA(vec2 uv, float l, float b){ return vec3(0.0, 0.0, 1.0); }
        #else
          uniform highp sampler2DArray tLayD, tLayN;
          vec4 layD(vec2 uv, float l){ return texture(tLayD, vec3(uv, l)); }
          vec4 layDL(vec2 uv, float l, float lod){ return textureLod(tLayD, vec3(uv, l), lod); }
          vec3 layN(vec2 uv, float l){ return unpackN(texture(tLayN, vec3(uv, l))); }
          // anti-tiling: a second lookup, rotated ~37 degrees and rescaled, is blended in by a slow noise so the
          // repeats of a photo texture never line up into a visible grid
          const mat2 ROT = mat2(0.8, 0.6, -0.6, 0.8);
          vec2 uvB(vec2 uv){ return ROT * uv * 0.73 + vec2(0.31, 0.57); }
          vec4 layDA(vec2 uv, float l, float b){ return mix(texture(tLayD, vec3(uv, l)), texture(tLayD, vec3(uvB(uv), l)), b); }
          vec3 layNA(vec2 uv, float l, float b){
            vec3 n0 = unpackN(texture(tLayN, vec3(uv, l))), n1 = unpackN(texture(tLayN, vec3(uvB(uv), l)));
            n1.xy = transpose(ROT) * n1.xy; // back into the unrotated frame
            return mix(n0, n1, b);
          }
        #endif
        vec2 maskUV(vec2 p){ return ((p + uHalf) / uCell + 0.5) / uHN; }
        float lum3(vec3 c){ return dot(c, vec3(0.3, 0.55, 0.15)); }
        ${MEADOW_GLSL}`)
      .replace('#include <map_fragment>', /* glsl */`
        vec3 wN = normalize(vWNorm);
        vec2 wuv = vWPos.xz;
        float camDist = length(vWPos - cameraPosition);
        vec4 nz0 = texture2D(tNoise, wuv * 0.00041 + 0.37);   // regional (km scale) variation
        vec4 nz1 = texture2D(tNoise, wuv * 0.0021);
        vec4 nz2 = texture2D(tNoise, wuv * 0.013);
        vec4 nz3 = texture2D(tNoise, wuv * 0.06);
        float tileB = smoothstep(0.35, 0.65, texture2D(tNoise, wuv * 0.031 + 0.11).g);
        float inside = step(abs(vWPos.x), uHalf) * step(abs(vWPos.z), uHalf);
        vec4 msk = texture2D(tMask, maskUV(wuv));
        vec4 msk2 = texture2D(tMask2, maskUV(wuv)) * inside;
        float slope = 1.0 - wN.y;
        float h = vWPos.y - uWaterLv;
        // beyond the gameplay area, forests follow the same noise the far-forest trees are planted from
        float farForest = smoothstep(0.47, 0.6, nz1.r + (nz2.g - 0.5) * 0.12 + (nz0.b - 0.5) * 0.2) * smoothstep(0.2, 0.12, slope)
          * (1.0 - smoothstep(uSnow - 45.0, uSnow + 5.0, vWPos.y)) * step(uWaterLv + 3.0, vWPos.y);
        float forest = mix(farForest, msk.r, inside);
        float ao = mix(1.0, msk.g, inside);
        float canopy = msk.b * inside;
        float farT = smoothstep(60.0, 400.0, camDist);
        float nearT = 1.0 - smoothstep(40.0, 320.0, camDist);
        // meadow: painted colour patches + a faint brush texture from the photo map's luminance; regional shifts
        // between lush valley green and drier, warmer uplands keep large views from reading as one flat colour
        vec3 cGrass = meadowColor(nz1, nz2, nz3);
        float region = smoothstep(0.35, 0.75, nz0.r + (nz1.a - 0.5) * 0.3);
        cGrass = mix(cGrass, mix(cGrass, uP_gDry, 0.35) * vec3(1.02, 0.98, 0.9), region * 0.55);
        cGrass = mix(cGrass, uP_gDeep * 1.08, smoothstep(0.62, 0.9, nz0.g) * 0.35);
        cGrass *= mix(1.0, clamp(lum3(layDA(wuv / uScales.x, 0.0, tileB).rgb) * 3.6, 0.6, 1.4), 0.2 * nearT);
        vec3 nGrass = layNA(wuv / uScales.x, 0.0, tileB) * 0.35;
        vec3 cForest = uP_forest * mix(0.8, 1.12, nz2.r) * mix(1.0, clamp(lum3(layDA(wuv / uScales.y, 1.0, tileB).rgb) * 3.2, 0.6, 1.4), 0.3 * nearT);
        vec3 nForest = layNA(wuv / uScales.y, 1.0, tileB) * 0.55;
        vec3 cSand = mix(uP_sand, uP_sand * vec3(0.92, 0.9, 0.84), nz3.r) * mix(1.0, clamp(lum3(layDA(wuv / uScales.z, 3.0, tileB).rgb) * 2.2, 0.7, 1.3), 0.25 * nearT);
        vec3 nSand = layNA(wuv / uScales.z, 3.0, tileB) * 0.5;
        vec3 uTex = layDA(wuv / uScales.w, 4.0, tileB).rgb, uAvg = layDL(wuv / uScales.w, 4.0, 7.0).rgb;
        vec3 cUrban = mix(uAvg, uTex, 0.35) * uTintU * (uUrbanNorm > 0.0 ? uUrbanNorm / max(lum3(uAvg), 0.04) : 1.0); // optional painted brightness
        vec3 nUrban = layNA(wuv / uScales.w, 4.0, tileB) * 0.6;
        // rock: tri-planar, each axis with the rock layer's own normal map; the scale widens with distance
        vec3 bw = pow(max(abs(wN), vec3(1e-4)), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
        float rs = mix(1.0 / uRockS, 1.0 / (uRockS * 3.4), farT * 0.7);
        vec3 cRockT = layD(vWPos.zy * rs, 2.0).rgb * bw.x + layD(vWPos.xz * rs, 2.0).rgb * bw.y + layD(vWPos.xy * rs, 2.0).rgb * bw.z;
        vec3 rnx = layN(vWPos.zy * rs, 2.0), rny = layN(vWPos.xz * rs, 2.0), rnz = layN(vWPos.xy * rs, 2.0);
        vec3 nRock = normalize(wN + vec3(0.0, rnx.y, rnx.x) * bw.x + vec3(rny.x, 0.0, rny.y) * bw.y + vec3(rnz.x, rnz.y, 0.0) * bw.z);
        // rock: two painted tones picked by the photo's light/dark strata, plus horizontal bedding bands on cliffs
        float strata = sin(vWPos.y * 0.9 + nz2.g * 6.0 + nz3.r * 2.0) * 0.5 + 0.5;
        vec3 cRock = mix(uP_rockD, uP_rockL, smoothstep(0.18, 0.42, lum3(cRockT) + (nz2.b - 0.5) * 0.12 + (strata - 0.5) * 0.08 * smoothstep(0.35, 0.7, slope)));
        cRock *= mix(0.92, 1.06, nz0.b);
        float shoreN = (nz2.r - 0.5) * 1.1 + (nz3.b - 0.5) * 0.6;
        float wSand = max(1.0 - smoothstep(uShore * 0.2, uShore, h + shoreN * uShore * 0.9), msk2.g);
        float wRock = smoothstep(0.30, 0.46, slope + (nz2.b - 0.5) * 0.14);
        // scree: broken rock collects at the foot of cliffs and on steep upper slopes
        float scree = smoothstep(0.2, 0.3, slope) * (1.0 - wRock) * smoothstep(0.55, 0.8, nz3.a + nz2.b * 0.3);
        float wSnow = smoothstep(uSnow, uSnow + 40.0, vWPos.y + (nz1.b - 0.5) * 70.0) * (1.0 - smoothstep(0.42, 0.62, slope));
        float wForest = smoothstep(0.2, 0.7, forest + (nz3.r - 0.5) * 0.35);
        float wUrban = smoothstep(0.15, 0.6, msk2.r + (nz3.g - 0.5) * 0.25);
        // where no trees stand any more (past the outermost far-forest ring) the forest reads as a painted canopy with
        // soft crown relief; under drawn trees the floor stays the darker forest ground
        float noTrees = (1.0 - inside) * step(uFarTrees, max(abs(vWPos.x), abs(vWPos.z)));
        float crownW = noTrees * smoothstep(0.3, 0.8, forest);
        vec2 cuv = wuv * 0.0045;
        float cr0 = texture2D(tNoise, cuv).a, crx = texture2D(tNoise, cuv + vec2(0.0035, 0.0)).a, crz = texture2D(tNoise, cuv + vec2(0.0, 0.0035)).a;
        vec3 crownN = normalize(vec3(-(crx - cr0) * 3.0, 1.0, -(crz - cr0) * 3.0));
        vec3 cCanopy = uP_canopy * (0.72 + 0.5 * cr0) * mix(0.9, 1.12, nz2.r) * mix(vec3(1.0), vec3(1.08, 1.02, 0.86), region * 0.5);
        // outside the map the ground under the far trees takes the canopy colour too, so the gaps between distant tree
        // cards read as more forest rather than bright speckle
        cForest = mix(cForest, cCanopy, max(crownW, (1.0 - inside) * smoothstep(0.25, 0.6, forest) * 0.9));
        nForest = mix(nForest, vec3(crownN.x, crownN.z, 0.0), crownW);
        vec3 col = mix(cGrass, cForest, wForest);
        vec3 tn = mix(nGrass, nForest, wForest);
        col = mix(col, mix(cRock, cSand, 0.25) * 0.9, scree * 0.7); tn = mix(tn, vec3(rny.x, rny.y, 0.0) * 0.6, scree * 0.7);
        col = mix(col, cSand, wSand); tn = mix(tn, nSand, wSand);
        col = mix(col, cUrban, wUrban); tn = mix(tn, nUrban, wUrban);
        vec3 nW = normalize(wN + vec3(tn.x, 0.0, tn.y));
        // moss creeps over the flatter tops of rock in the forest and on shaded north faces
        float moss = wRock * smoothstep(0.55, 0.85, wN.y + (nz3.g - 0.5) * 0.3) * smoothstep(0.2, 0.6, forest + max(-wN.z, 0.0) * 0.4);
        cRock = mix(cRock, uP_forest * 1.1, moss * 0.6);
        col = mix(col, cRock, wRock * (1.0 - wUrban)); nW = normalize(mix(nW, nRock, wRock * (1.0 - wUrban)));
        col = mix(col, uP_snow, wSnow); nW = normalize(mix(nW, wN, wSnow * 0.7));
        float wet = max(1.0 - smoothstep(0.0, 0.7, h), msk2.g * 0.8);
        col = mix(col, uP_sandWet, wet * wSand * 0.8);
        col = mix(col, uP_bed * (0.85 + 0.3 * nz3.g), smoothstep(0.0, 1.0, -h) * (1.0 - msk2.g)); // teal lake bed
        col *= mix(1.0, 0.7, smoothstep(1.0, 12.0, -h));
        col *= mix(1.0, ao, 0.6) * (1.0 - canopy * 0.35);
        // under the far grass clumps the ground reads as the shade between blades, so the lit tips stand out
        float meadowW = (1.0 - wForest) * (1.0 - wUrban) * (1.0 - wRock) * (1.0 - wSand) * (1.0 - wSnow) * (1.0 - msk2.b) * inside;
        col *= mix(1.0, 0.8, meadowW * smoothstep(uGrassR * 0.6, uGrassR * 1.4, camDist) * (1.0 - smoothstep(uGrassR * 18.0, uGrassR * 26.0, camDist)));
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
  mat.customProgramCacheKey = () => opt.lite ? 'terrainLite' : 'terrain';
  return mat;
}

// JS twin of the shader's far-forest mask: forests beyond the gameplay area (and blended into each map's own forest mask
// near its edge, so woods continue across the boundary). slope = 1 - normal.y
export function farForestAt(x, z, y, slope, water = 0, snow = 175) {
  const v = noiseAt(x * 0.0021, z * 0.0021, 0) + (noiseAt(x * 0.013, z * 0.013, 1) - 0.5) * 0.12 + (noiseAt(x * 0.00041 + 0.37, z * 0.00041 + 0.37, 2) - 0.5) * 0.2;
  return smoothstep(0.47, 0.6, v) * smoothstep(0.2, 0.12, slope) * (1 - smoothstep(snow - 45, snow + 5, y)) * (y > water + 3 ? 1 : 0);
}

// Near: the gameplay heightfield (2 m cells). Beyond it, four rings of progressively coarser terrain (quality-dependent
// spacing) evaluate the same height function, so ridgelines and valleys continue unbroken to the horizon. Each ring's
// outer row is snapped onto the next ring's coarser edge (and the heightfield's edge onto the first ring), so there are
// no T-junction cracks; far rings take their normals from the height function at a fine step, so distant slopes keep
// their shading detail. Everything is tiled for frustum culling. The outer rings also carry the far forest: real (very
// low-poly) trees planted from the same mask the ground shader paints, sitting exactly on the rendered triangles.
export async function buildTerrainMeshes(hf, mat, { outer = true, farForest = true } = {}) {
  const { GRID, HN, CELL, HALF, H } = hf;
  const q = Q.name, steps = q === 'extreme' || q === 'ultra' ? [4, 16, 64, 256] : q === 'high' ? [8, 16, 64, 256] : [8, 32, 64, 256];
  const CH = 64, NC = GRID / CH, n = CH + 1;
  const idx = [];
  for (let b = 0; b < CH; b++) for (let a = 0; a < CH; a++) { const v = b * n + a; idx.push(v, v + n, v + 1, v + 1, v + n, v + n + 1); }
  const index = new THREE.Uint32BufferAttribute(idx, 1);
  const group = new THREE.Group();
  // heightfield edge vertices between the first ring's vertices sit on that ring's straight edge segments
  const kEdge = Math.max(1, Math.round(steps[0] / CELL));
  const edgeH = (i, j) => {
    const onX = i === 0 || i === GRID, onZ = j === 0 || j === GRID;
    if (!outer || !(onX || onZ)) return H[j * HN + i];
    if (onZ && i % kEdge) { const i0 = i - i % kEdge, t = (i % kEdge) / kEdge; return lerp(H[j * HN + i0], H[j * HN + i0 + kEdge], t); }
    if (onX && j % kEdge) { const j0 = j - j % kEdge, t = (j % kEdge) / kEdge; return lerp(H[j0 * HN + i], H[(j0 + kEdge) * HN + i], t); }
    return H[j * HN + i];
  };
  for (let cj = 0; cj < NC; cj++) for (let ci = 0; ci < NC; ci++) {
    const pos = new Float32Array(n * n * 3), nor = new Float32Array(n * n * 3);
    for (let b = 0; b < n; b++) for (let a = 0; a < n; a++) {
      const i = ci * CH + a, j = cj * CH + b, k = (b * n + a) * 3;
      pos[k] = -HALF + i * CELL; pos[k + 1] = edgeH(i, j); pos[k + 2] = -HALF + j * CELL;
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
  const ringData = [];
  if (outer) {
    const rings = [{ step: steps[0], inner: HALF, outer: HALF + 1024, tile: 256 }, { step: steps[1], inner: HALF + 1024, outer: HALF + 3072, tile: 1024 },
      { step: steps[2], inner: HALF + 3072, outer: HALF + 8192, tile: 2048 }, { step: steps[3], inner: HALF + 8192, outer: HALF + 20480, tile: 6144 }];
    for (let ri = 0; ri < rings.length; ri++) {
      const R = rings[ri], S = R.step, N = Math.round(R.outer * 2 / S) + 1, E = R.outer, next = rings[ri + 1];
      const hts = new Float32Array(N * N), fn = hf.fn;
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const x = -E + i * S, z = -E + j * S;
          if (Math.abs(x) < R.inner - 1e-3 && Math.abs(z) < R.inner - 1e-3) continue;
          hts[j * N + i] = fn(x, z);
        }
        if ((j & 63) === 63) await tick();
      }
      if (next) { // outer row onto the next ring's coarser edge
        const k = Math.round(next.step / S);
        for (let t = 0; t < N; t++) if (t % k) {
          const t0 = t - t % k, f = (t % k) / k;
          for (const e of [0, N - 1]) { hts[e * N + t] = lerp(hts[e * N + t0], hts[e * N + t0 + k], f); hts[t * N + e] = lerp(hts[t0 * N + e], hts[(t0 + k) * N + e], f); }
        }
      }
      const HT = (i, j) => hts[clamp(j, 0, N - 1) * N + clamp(i, 0, N - 1)];
      ringData.push({ ...R, N, E, HT });
      const eps = Math.min(S, 8);
      const TQ = Math.round(R.tile / S);
      for (let tz = -E; tz < E; tz += R.tile) {
        for (let tx = -E; tx < E; tx += R.tile) {
          if (tx >= -R.inner && tx + R.tile <= R.inner && tz >= -R.inner && tz + R.tile <= R.inner) continue;
          const i0 = Math.round((tx + E) / S), j0 = Math.round((tz + E) / S), tn = TQ + 1;
          const pos = new Float32Array(tn * tn * 3), nor = new Float32Array(tn * tn * 3), tidx = [];
          for (let b = 0; b < tn; b++) for (let a = 0; a < tn; a++) {
            const i = i0 + a, j = j0 + b, k = (b * tn + a) * 3, x = -E + i * S, z = -E + j * S;
            pos[k] = x; pos[k + 1] = HT(i, j); pos[k + 2] = z;
            let hx, hz, d;
            if (S <= 4) { hx = HT(i + 1, j) - HT(i - 1, j); hz = HT(i, j + 1) - HT(i, j - 1); d = 2 * S; }
            else { hx = fn(x + eps, z) - fn(x - eps, z); hz = fn(x, z + eps) - fn(x, z - eps); d = 2 * eps; }
            const l = Math.hypot(hx, d, hz); nor[k] = -hx / l; nor[k + 1] = d / l; nor[k + 2] = -hz / l;
          }
          for (let b = 0; b < TQ; b++) for (let a = 0; a < TQ; a++) {
            const cx = tx + (a + 0.5) * S, cz = tz + (b + 0.5) * S;
            if (Math.abs(cx) < R.inner && Math.abs(cz) < R.inner) continue;
            const v = b * tn + a; tidx.push(v, v + tn, v + 1, v + 1, v + tn, v + tn + 1);
          }
          if (!tidx.length) continue;
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
          g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
          g.setIndex(tidx); g.computeBoundingSphere();
          const m = new THREE.Mesh(g, mat); m.receiveShadow = true; m.castShadow = ri === 0; m.matrixAutoUpdate = false;
          group.add(m);
        }
        await tick();
      }
    }
  }
  // ---- far forest: F-rings of trees, sparser and larger with distance, cross-faded at their borders
  const FR = [{ inner: HALF, outer: HALF + 1024, sp: 8, sc: 1, ring: 0 }, { inner: HALF + 1024, outer: HALF + 3072, sp: 13, sc: 1.2, ring: 1 },
    { inner: HALF + 3072, outer: HALF + 5120, sp: 22, sc: 1.45, ring: 2 }, { inner: HALF + 5120, outer: HALF + 8192, sp: 34, sc: 1.75, ring: 2 }];
  const farExt = () => FR[clamp((Q.far || 1) - 1, 0, FR.length - 1)].outer;
  terrainFarTrees.value = outer && farForest ? farExt() : HALF;
  if (outer && farForest && ringData.length) {
    const o = mat.userData.opt || {}, water = o.water ?? 0, snow = o.snow ?? 175, conifer = o.conifer ?? 0.7;
    // height on the rendered triangles (quads split along the (i+1,j)-(i,j+1) diagonal)
    const groundOn = (R, x, z) => {
      const gx = (x + R.E) / R.step, gz = (z + R.E) / R.step, i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j;
      const h00 = R.HT(i, j), h10 = R.HT(i + 1, j), h01 = R.HT(i, j + 1), h11 = R.HT(i + 1, j + 1);
      return fx + fz <= 1 ? h00 + (h10 - h00) * fx + (h01 - h00) * fz : h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
    };
    const W = 160, rng = mulberry32(4711), sets = FR.map(() => ({ fir: [], leaf: [] }));
    for (let fi = 0; fi < FR.length; fi++) {
      const F = FR[fi], R = ringData[F.ring], sp = F.sp, lo = -(F.outer + W / 2), cnt = Math.ceil(2 * (F.outer + W / 2) / sp);
      for (let b = 0; b < cnt; b++) {
        for (let a = 0; a < cnt; a++) {
          const x = lo + (a + 0.5 + (rng() - 0.5) * 0.9) * sp, z = lo + (b + 0.5 + (rng() - 0.5) * 0.9) * sp, r1 = rng(), r2 = rng(), r3 = rng(), r4 = rng();
          const d = Math.max(Math.abs(x), Math.abs(z));
          if (d < F.inner - (fi ? W / 2 : 0) || d > F.outer + W / 2) continue;
          // stochastic cross-fade: this ring hands over to the next across a W-wide band
          const pin = fi ? smoothstep(F.inner - W / 2, F.inner + W / 2, d) : 1, pout = fi < FR.length - 1 ? 1 - smoothstep(F.outer - W / 2, F.outer + W / 2, d) : 1 - smoothstep(F.outer - W, F.outer, d);
          if (r1 > pin * pout) continue;
          const Rr = d < R.inner ? ringData[Math.max(0, F.ring - 1)] : d > R.outer ? ringData[Math.min(ringData.length - 1, F.ring + 1)] : R;
          const y = groundOn(Rr, x, z), e = Rr.step * 0.5;
          const sx = groundOn(Rr, x + e, z) - groundOn(Rr, x - e, z), sz = groundOn(Rr, x, z + e) - groundOn(Rr, x, z - e);
          const slope = 1 - 2 * e / Math.hypot(sx, 2 * e, sz);
          const f = farForestAt(x, z, y, slope, water, snow);
          if (r2 > smoothstep(0.25, 0.6, f)) continue; // closed stands with clean edges: sparse far trees read as speckle
          const leafy = r3 > conifer + (y - water - 60) * 0.004;
          const s = (leafy ? lerp(9, 15, r4) : lerp(13, 26, Math.pow(r4, 1.3))) * F.sc * (0.8 + 0.2 * f);
          (leafy ? sets[fi].leaf : sets[fi].fir).push({ x, y: y - 0.3 - slope * 3, z, s, sx: 0.8 + 0.4 * rng(), r: rng() * 6.28, tilt: (rng() - 0.5) * 0.05, c: leafy ? leafColor(rng) : firColor(rng) });
        }
        if ((b & 127) === 127) await tick();
      }
    }
    buildFarForest(sets, FR);
  }
  group.userData.applyQuality = () => { terrainTreeDist.value = Q.trees; terrainGrassR.value = Q.tile * 0.5; if (outer && farForest) terrainFarTrees.value = farExt(); };
  scene.add(group);
  return group;
}

// ---------------------------------------------------------------- grass + rice (GPU instanced, wraps around the camera)
// Grass is drawn in three distance rings, each a K x K set of world-anchored cells: a cell always carries the same blade
// pattern (cell -> chunk by index mod K), so blades never swim as the camera moves. Every cell is its own draw with a real
// bounding sphere, so three's frustum culling and a per-cell distance test skip everything off-screen or out of range.
// Near cells are dense, with full blades; far rings are sparser with wider, simpler tufts, fading into each other.
const GRASS_K = 8;
// near ring: single animated blades. Far rings: camera-facing clump cards, each a painted strip of dozens of blades (dark
// bases, light tips, a few flower heads), so distant meadows still read as grass rather than a flat floor
const GRASS_RINGS = [
  { seg: 4, r: 1, count: 1.3, tuft: 1.0, lod: 0 },                         // r: radius in units of the quality's near radius
  { card: [1.3, 0.62], r: 4.5, count: 0.42, tuft: 1, lod: 1 },            // card: [width, height] in metres
  { card: [3.4, 0.95], r: 24, count: 0.34, tuft: 1, lod: 2 },
];
let cardTex = null;
function grassCardTexture() { // R: blade brightness, G: flower head mask, A: coverage; tiles horizontally
  if (cardTex) return cardTex;
  const W = 512, H = 128, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d'), rng = mulberry32(77);
  const blade = (x0, h, w, lean, v) => {
    for (const dx of [-W, 0, W]) {
      const x = x0 + dx; g.fillStyle = `rgb(${Math.round(v * 255)},0,0)`;
      g.beginPath(); g.moveTo(x - w / 2, H); g.quadraticCurveTo(x - w * 0.3 + lean * 0.4, H - h * 0.55, x + lean, H - h);
      g.quadraticCurveTo(x + w * 0.3 + lean * 0.4, H - h * 0.55, x + w / 2, H); g.fill();
    }
  };
  for (let i = 0; i < 150; i++) blade(rng() * W, H * (0.35 + 0.65 * Math.pow(rng(), 0.7)), 7 + rng() * 9, (rng() - 0.5) * 34, 0.55 + 0.45 * rng());
  for (let i = 0; i < 12; i++) { const x = rng() * W, y = H * (0.12 + rng() * 0.3); for (const dx of [-W, 0, W]) { g.fillStyle = 'rgb(255,255,0)'; g.beginPath(); g.arc(x + dx, y, 5 + rng() * 3, 0, 7); g.fill(); } }
  cardTex = new THREE.CanvasTexture(cv);
  cardTex.colorSpace = THREE.NoColorSpace; cardTex.wrapS = THREE.RepeatWrapping; cardTex.wrapT = THREE.ClampToEdgeWrapping; cardTex.anisotropy = 4;
  return cardTex;
}
function cardGeometry() {
  return { position: new THREE.Float32BufferAttribute(new Float32Array(12), 3), bladeUV: new THREE.Float32BufferAttribute([-1, 0, 1, 0, -1, 1, 1, 1], 2), index: new THREE.Uint16BufferAttribute([0, 1, 3, 0, 3, 2], 1) };
}
function bladeGeometry(SEG) {
  const uv = [], idx = [];
  for (let i = 0; i < SEG; i++) { const t = i / SEG; uv.push(-1, t, 1, t); }
  uv.push(0, 1);
  for (let i = 0; i < SEG - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const l = (SEG - 1) * 2; idx.push(l, l + 1, SEG * 2);
  return { position: new THREE.Float32BufferAttribute(new Float32Array((SEG * 2 + 1) * 3), 3), bladeUV: new THREE.Float32BufferAttribute(uv, 2), index: new THREE.Uint16BufferAttribute(idx, 1) };
}
export function buildGrass(hf, grassTex, opt = {}) {
  const group = new THREE.Group(), K2 = GRASS_K * GRASS_K;
  const gu = { uWaterLv: { value: opt.water ?? 0 }, uSnow: { value: opt.snow ?? 175 }, uShore: { value: opt.shore ?? 1.3 }, uReeds: { value: opt.reeds ? 1 : 0 } };
  // per-blade data is packed (16-bit position in the cell, 8-bit randoms) and generated from a per-chunk seed, so a
  // chunk can grow its buffers when the quality goes up and still keep exactly the same blades
  const fill = (c, n) => {
    const rng = mulberry32(c.seed), off = new Uint16Array(n * 2), rnd = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) { off[i * 2] = rng() * 65535; off[i * 2 + 1] = rng() * 65535; for (let k = 0; k < 4; k++) rnd[i * 4 + k] = rng() * 255; }
    c.g.dispose();
    c.g.setAttribute('iOffset', new THREE.InstancedBufferAttribute(off, 2, true));
    c.g.setAttribute('iRand', new THREE.InstancedBufferAttribute(rnd, 4, true));
    c.cap = n;
  };
  const rings = GRASS_RINGS.map((R, ri) => {
    const base = R.card ? cardGeometry() : bladeGeometry(R.seg);
    const ru = { uCellSize: { value: 1 }, uR: { value: 1 }, uIn: { value: new THREE.Vector2(0, 0) }, uLod: { value: R.lod }, uTuft: { value: R.tuft },
      uCard: { value: new THREE.Vector2(...(R.card || [0, 0])) }, tCard: { value: R.card ? grassCardTexture() : null } };
    const mat = grassMaterial(hf, grassTex, gu, ru, !!R.card);
    const chunks = [];
    for (let c = 0; c < K2; c++) {
      const g = new THREE.InstancedBufferGeometry();
      g.setAttribute('position', base.position); g.setAttribute('bladeUV', base.bladeUV); g.setIndex(base.index);
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
      const m = new THREE.Mesh(g, mat);
      m.matrixAutoUpdate = false; m.receiveShadow = true; m.visible = false;
      group.add(m);
      chunks.push({ m, g, i: c % GRASS_K, j: Math.floor(c / GRASS_K), X: NaN, Z: NaN, y0: 0, y1: 0, cap: 0, seed: 5 + ri * 7919 + c * 977 });
    }
    return { R, ru, chunks, s: 1, rad: 1, inA: 0 };
  });
  const applyQuality = () => {
    const r0 = Q.tile * 0.5;
    rings.forEach((ring, k) => {
      ring.rad = r0 * ring.R.r; ring.s = ring.rad / ((GRASS_K - 1) / 2);   // the window always covers `rad` around the camera
      ring.inA = k ? r0 * GRASS_RINGS[k - 1].r * 0.55 : 0;
      ring.ru.uCellSize.value = ring.s; ring.ru.uR.value = ring.rad;
      ring.ru.uIn.value.set(ring.inA, k ? r0 * GRASS_RINGS[k - 1].r : 0);
      const n = Math.min(Math.ceil(MAX_GRASS * ring.R.count / K2), Math.round(Q.grass * ring.R.count / K2 * (k === 2 && Q.grass < 300000 ? 0.6 : 1)));
      for (const c of ring.chunks) { if (n > c.cap) fill(c, n); c.g.instanceCount = n; c.X = NaN; }
    });
  };
  applyQuality();
  const HALF = hf.HALF;
  scatters.push({
    update(cx, cz) {
      for (const ring of rings) {
        const s = ring.s, K = GRASS_K, fx = Math.floor(cx / s - K / 2 + 0.5), fz = Math.floor(cz / s - K / 2 + 0.5);
        for (const c of ring.chunks) {
          const X = fx + (((c.i - fx) % K) + K) % K, Z = fz + (((c.j - fz) % K) + K) % K;
          const x0 = X * s, z0 = Z * s;
          if (X !== c.X || Z !== c.Z) { // the chunk moved to a new cell: place it and fit its bounds to the terrain there
            c.X = X; c.Z = Z;
            let y0 = 1e9, y1 = -1e9;
            for (let a = 0; a <= 4; a++) for (let b = 0; b <= 4; b++) { const h = hf.heightAt(clamp(x0 + a * s / 4, -HALF, HALF), clamp(z0 + b * s / 4, -HALF, HALF)); y0 = Math.min(y0, h); y1 = Math.max(y1, h); }
            c.y0 = y0 - 1; c.y1 = y1 + 2.5;
            c.m.matrix.makeTranslation(x0, 0, z0); c.m.matrixWorld.copy(c.m.matrix);
            c.g.boundingSphere.center.set(s / 2, (c.y0 + c.y1) / 2, s / 2);
            c.g.boundingSphere.radius = Math.hypot(s / 2, s / 2, (c.y1 - c.y0) / 2);
          }
          const nx = Math.max(x0 - cx, 0, cx - x0 - s), nz = Math.max(z0 - cz, 0, cz - z0 - s);
          const farX = Math.max(Math.abs(x0 - cx), Math.abs(x0 + s - cx)), farZ = Math.max(Math.abs(z0 - cz), Math.abs(z0 + s - cz));
          c.m.visible = Math.hypot(nx, nz) < ring.rad && Math.hypot(farX, farZ) > ring.inA && x0 < HALF && x0 + s > -HALF && z0 < HALF && z0 + s > -HALF;
        }
      }
    },
  });
  group.userData.applyQuality = applyQuality;
  scene.add(group);
  return group;
}
function grassMaterial(hf, grassTex, gu, ru, card) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, side: THREE.DoubleSide, alphaTest: card ? 0.5 : 0, alphaToCoverage: card && Q.msaa > 0 });
  mat.defines = card ? { CLOUD_SHADE_VARYING: '', GRASS_CARD: '' } : { CLOUD_SHADE_VARYING: '' };
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, gu, ru, hf.U, paintU, { tNoise: S.tNoise, tGrassD: { value: grassTex },
      uCam: S.uCam, uPlayer: S.uPlayer, uTime: S.uTime, uWind: S.uWind, uSunDir: S.uSunDir, uSunCol: S.uSunCol });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 bladeUV; attribute vec2 iOffset; attribute vec4 iRand;
        uniform sampler2D tMask, tMask2, tNoise, tGrassD;
        uniform vec3 uCam, uPlayer; uniform float uTime, uCellSize, uR, uLod, uTuft, uWind, uWaterLv, uSnow, uShore, uReeds; uniform vec2 uIn, uCard;
        varying vec3 vGCol; varying vec3 vGTip; varying float vT; varying vec3 vGW; varying float vCloudLit;
        varying vec2 vCardUv; varying vec3 vFlCol; varying float vFl;
        ${GLSL_HEIGHT}
        ${CLOUD_SHADE_GLSL}
        ${MEADOW_GLSL}`)
      .replace('#include <beginnormal_vertex>', /* glsl */`
        vec2 wp2 = modelMatrix[3].xz + iOffset * uCellSize;   // cell origin (the chunk's translation) + position in the cell
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
        bool reed = !rice && uReeds > 0.5 && uLod < 0.5 && hw > -0.5 && hw < 0.55 && reedN > 0.66 && iRand.w < 0.7 && gN.y > 0.9;
        if (reed) dens = 1.0;
        dens *= step(abs(wp2.x), uHalf - 2.0) * step(abs(wp2.y), uHalf - 2.0);
        // ring cross-fade: blades thin out stochastically (so near and far rings keep the same blade height)
        float fade = (1.0 - smoothstep(uR * 0.55, uR, gdist)) * (uIn.y > 0.0 ? smoothstep(uIn.x, uIn.y, gdist) : 1.0);
        float keep = step(iRand.w, dens) * step(fract(iRand.y * 13.73 + iRand.x * 5.31), fade * 1.02);
        float gs = keep;
        float fPatch = smoothstep(0.58, 0.8, gz3.g * 0.65 + gz2.a * 0.6);
        bool flower = !rice && !reed && dens > 0.35 && iRand.w < (0.01 + 0.16 * fPatch * dens) * smoothstep(22.0, 30.0, gdist) * (uLod > 1.5 ? 0.5 : 1.0);
        float Hh = mix(0.18, 0.78, iRand.y * iRand.y) * (0.5 + 0.7 * gz2.g) * mix(0.75, 1.0, fade) * keep;
        Hh *= 1.0 - 0.68 * gm2.a;   // ...and short
        if (flower) Hh = (0.28 + 0.32 * iRand.y) * mix(0.4, 1.0, fade);
        if (rice) Hh = (0.38 + 0.22 * iRand.y) * fade;
        if (reed) Hh = (1.0 + 1.1 * iRand.y * iRand.y + max(-hw, 0.0)) * mix(0.3, 1.0, fade);
        float Wd = (0.02 + 0.022 * iRand.z) * (1.0 + gdist * 0.06) * uTuft * step(0.001, gs);   // far rings: wider tufts
        if (rice) Wd *= 0.8;
        if (reed) Wd *= 0.75;
        float ang = iRand.x * 6.2831853;
        vec2 bdir = vec2(cos(ang), sin(ang)), bside = vec2(-bdir.y, bdir.x);
        #ifdef GRASS_CARD
          // clump cards turn to face the camera and grow a little toward the far edge of their ring
          vec2 toCam = uCam.xz - wp2; bdir = toCam / (length(toCam) + 1e-3); bside = vec2(-bdir.y, bdir.x);
          Wd = uCard.x * (0.75 + 0.5 * iRand.z) * (0.8 + 0.45 * smoothstep(uIn.y, uR, gdist)) * step(0.001, gs);
          Hh = uCard.y * (0.7 + 0.6 * iRand.y) * (0.55 + 0.65 * gz2.g) * mix(0.75, 1.0, fade) * keep * (1.0 - 0.6 * gm2.a) * (rice ? 0.75 : 1.0);
          flower = false;
        #endif
        float t = bladeUV.y;
        vec2 windDir = normalize(vec2(1.0, 0.35));
        float gust = textureLod(tNoise, wp2 * 0.012 - windDir * uTime * 0.05, 0.0).r;
        float flutter = sin(uTime * (2.2 + iRand.z * 2.5) + iRand.x * 40.0 + dot(wp2, windDir) * 0.8);
        vec2 lean = bdir * (rice ? 0.35 + iRand.z * 0.3 : reed ? 0.04 + iRand.z * 0.14 : 0.12 + iRand.z * 0.4) + windDir * (gust * gust * 1.5 + 0.12) * uWind * (rice ? 0.6 : reed ? 0.35 : 1.0) + bside * flutter * 0.1 * uWind;
        #ifdef GRASS_CARD
          lean = windDir * (gust * gust * 1.2 + 0.1) * uWind * 0.45;
        #endif
        vec2 away = wp2 - uPlayer.xz; float pd = length(away);
        lean += away / (pd + 0.001) * (1.0 - smoothstep(0.25, 1.1, pd)) * 1.8 * step(abs(uPlayer.y - gh), 2.2);
        float ll = length(lean); if (ll > 1.3) { lean *= 1.3 / ll; ll = 1.3; }
        float bt = t * t;
        vec3 gp = vec3(wp2.x, gh - 0.03, wp2.y);
        gp.xz += lean * bt * Hh;
        gp.y += t * Hh * (1.0 - 0.35 * bt * ll / 1.3);
        #ifdef GRASS_CARD
          gp.xz += bside * bladeUV.x * Wd * 0.5;
          vCardUv = vec2((bladeUV.x * 0.5 + 0.5) * 0.33 * Wd / max(uCard.x, 0.01) + iRand.x * 7.0, t);   // same blade count on every card
          float pickF = fract(gz2.g * 5.3 + gz3.b * 0.6);
          vFlCol = pickF < 0.26 ? vec3(1.0, 0.95, 0.86) : pickF < 0.5 ? vec3(1.0, 0.72, 0.06) : pickF < 0.7 ? vec3(1.0, 0.36, 0.55) : pickF < 0.88 ? vec3(0.42, 0.3, 1.0) : vec3(1.0, 0.3, 0.12);
          vFl = step(0.35, fPatch) * step(iRand.w, 0.65) * (rice ? 0.0 : 1.0);
        #else
          gp.xz += bside * bladeUV.x * Wd * 0.5 * (flower ? 0.5 + smoothstep(0.55, 0.85, t) * 3.5 : 1.0 - t * 0.6);  // flowers open into a blossom
        #endif
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
      .replace('#include <begin_vertex>', 'vec3 transformed = gp - modelMatrix[3].xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vGCol; varying vec3 vGTip; varying float vT; varying vec3 vGW; uniform vec3 uSunDir, uSunCol;
        uniform sampler2D tCard; varying vec2 vCardUv; varying vec3 vFlCol; varying float vFl;`)
      .replace('#include <map_fragment>', /* glsl */`
        #ifdef GRASS_CARD
          vec4 tc = texture2D(tCard, vCardUv);
          vec2 tdx = dFdx(vCardUv * vec2(512.0, 128.0)), tdy = dFdy(vCardUv * vec2(512.0, 128.0));
          float tlod = 0.5 * log2(max(max(dot(tdx, tdx), dot(tdy, tdy)), 1e-6));
          diffuseColor.a = tc.a * (1.0 + max(tlod, 0.0) * 0.3);   // mip levels lose coverage: boost it so far clumps stay solid
          diffuseColor.rgb *= mix(vGCol * 0.55, vGTip, smoothstep(0.0, 1.0, vT)) * (0.7 + 0.4 * tc.r);
          if (tc.g > 0.5 && vFl > 0.5) diffuseColor.rgb = vFlCol * 0.9;
        #else
          diffuseColor.rgb *= mix(vGCol * 0.62, vGTip, smoothstep(0.0, 1.0, vT));
        #endif`)
      .replace('#include <normal_fragment_begin>', 'float faceDirection = 1.0; vec3 normal = normalize(vNormal); vec3 nonPerturbedNormal = normal;')
      .replace('#include <emissivemap_fragment>', `
        vec3 gV = normalize(vGW - cameraPosition);
        float gTr = pow(max(dot(gV, uSunDir), 1e-4), 4.0) * vT;
        totalEmissiveRadiance += vGTip * uSunCol * (gTr * 0.22 + 0.02 * vT) * vCloudLit;`);
  };
  mat.customProgramCacheKey = () => card ? 'grassCard' : 'grass';
  return mat;
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
