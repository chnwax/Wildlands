// Reusable outdoor systems: heightfield terrain with painted splat shading, GPU grass (and rice, reeds, flowers),
// planar-reflection water, conifer forests (trees.js). Maps configure these and add their own content.
import { THREE, scene, renderer, S, Q, MAX_GRASS, clamp, lerp, smoothstep, mulberry32, tick, loadTex, phTex, NFLAT, maxAniso, Scatter, addCircle, scatters, noiseAt, onResize } from './core.js';
import { CLOUD_SHADE_GLSL } from './clouds.js';
import { buildConiferForest, buildFarForest, firColor, coniferColor, broadColor } from './trees.js';
import { perf } from './perf.js';
import { post } from './post.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
const P_REFL = perf.id('water reflection', 1);

// ---------------------------------------------------------------- heightfield
export class Heightfield {
  constructor({ world = 2048, grid = 1024, height }) {
    this.WORLD = world; this.GRID = grid; this.HN = grid + 1; this.CELL = world / grid; this.HALF = world / 2;
    this.fn = height;
    this.H = new Float32Array(this.HN * this.HN);
    this.mask = new Uint8Array(this.HN * this.HN * 4);   // R forest, G ambient occlusion, B canopy, A unused
    this.mask2 = new Uint8Array(this.HN * this.HN * 4);  // R urban ground, G paddy, B no-grass, A mowed lawn
    this.U = { tHeight: { value: null }, tMask: { value: null }, tMask2: { value: null }, uHalf: { value: this.HALF }, uCell: { value: this.CELL }, uHN: { value: this.HN },
      tPave: { value: null }, uPaveH: { value: 1 } };
    // pavement mask: a fine grid (PC m) over the central 2·PH m, allocated when a map paints into it. Grass and flowers
    // keep off paved ground exactly, so a lawn runs up to a kerb or a path edge instead of the 2 m mask cells leaving a
    // band of bare gravel along every footway
    this.PC = 0.5; this.PH = 800; this.PN = Math.round(2 * this.PH / this.PC); this.pave = null;
  }
  // rasterise fn (0..1, sampled at cell centres) over a world rectangle into the pavement mask (max-blend)
  paintPave(minX, minZ, maxX, maxZ, fn) {
    const { PC, PH, PN } = this; if (!this.pave) this.pave = new Uint8Array(PN * PN);
    const i0 = clamp(Math.floor((minX + PH) / PC), 0, PN - 1), i1 = clamp(Math.ceil((maxX + PH) / PC), 0, PN - 1);
    const j0 = clamp(Math.floor((minZ + PH) / PC), 0, PN - 1), j1 = clamp(Math.ceil((maxZ + PH) / PC), 0, PN - 1), P = this.pave;
    for (let j = j0; j <= j1; j++) { const z = -PH + (j + 0.5) * PC;
      for (let i = i0; i <= i1; i++) { const v = fn(-PH + (i + 0.5) * PC, z); if (v <= 0) continue; const o = j * PN + i; P[o] = Math.max(P[o], Math.min(255, v * 255)); } }
  }
  paveAt(x, z) {
    if (!this.pave) return 0; const { PC, PH, PN } = this, i = Math.floor((x + PH) / PC), j = Math.floor((z + PH) / PC);
    return i < 0 || j < 0 || i >= PN || j >= PN ? 0 : this.pave[j * PN + i] / 255;
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
      const R = t.cr || 0.22 * t.s * (t.sx || 1), rc = Math.ceil(R / CELL); // cr: crown radius, when the map knows it
      const ci = Math.round((t.x + HALF) / CELL), cj = Math.round((t.z + HALF) / CELL);
      for (let dj = -rc; dj <= rc; dj++) for (let di = -rc; di <= rc; di++) {
        const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i > GRID || j > GRID) continue;
        const d = Math.hypot(di * CELL, dj * CELL) / R; if (d > 1) continue;
        const o = (j * HN + i) * 4 + 2; mask[o] = Math.max(mask[o], (1 - d * d) * 255 * (t.shade ?? 1)); // shade: how much light the crown stops
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
    const N = this.pave ? this.PN : 1, pt = new THREE.DataTexture(this.pave || new Uint8Array(1), N, N, THREE.RedFormat, THREE.UnsignedByteType);
    pt.minFilter = pt.magFilter = THREE.LinearFilter; pt.generateMipmaps = false; pt.unpackAlignment = 1; pt.needsUpdate = true;
    if (this.U.tPave.value) this.U.tPave.value.dispose();
    this.U.tPave.value = pt; this.U.uPaveH.value = this.pave ? this.PH : 1;
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
// height at p and its central differences one cell either way (h(p+x) - h(p-x), h(p+z) - h(p-z)): the five bilinear
// lookups share their texels, twelve reads instead of twenty (p at least two cells inside the map)
void hAt5(vec2 p, out float h, out float hx, out float hz){
  vec2 g = (p + uHalf) / uCell; ivec2 i = ivec2(floor(g)); vec2 f = g - vec2(i);
  #define HT(a, b) texelFetch(tHeight, i + ivec2(a, b), 0).r
  float m0 = HT(-1, 0), a = HT(0, 0), b = HT(1, 0), p0 = HT(2, 0), m1 = HT(-1, 1), c = HT(0, 1), d = HT(1, 1), p1 = HT(2, 1);
  float s0 = HT(0, -1), s1 = HT(1, -1), n0 = HT(0, 2), n1 = HT(1, 2);
  #undef HT
  #define BIL(a, b, c, d) mix(mix(a, b, f.x), mix(c, d, f.x), f.y)
  h = BIL(a, b, c, d);
  hx = BIL(b, p0, d, p1) - BIL(m0, a, m1, c);
  hz = BIL(c, d, n0, n1) - BIL(s0, s1, a, b);
  #undef BIL
}
`;
// paved ground (roads, footways, paths, plazas) from the fine pavement mask: 1 on paving, 0 off it
export const GLSL_PAVE = /* glsl */`
uniform sampler2D tPave; uniform float uPaveH;
float paveAt(vec2 p){ vec2 uv = (p + uPaveH) / (2.0 * uPaveH); return uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0 ? textureLod(tPave, uv, 0.0).r : 0.0; }
`;
// ground height on the first outer terrain ring, exactly on its rendered triangles (quads split along the
// (i+1,j)-(i,j+1) diagonal), so grass past the map edge stands on the ground; gAt picks the right source
export const GLSL_OUTER_HEIGHT = /* glsl */`
uniform sampler2D tOuterH; uniform float uOuterE, uOuterS, uOuterN, uGrassE;
float hOut(vec2 p){
  vec2 g = clamp((p + uOuterE) / uOuterS, vec2(0.0), vec2(uOuterN - 1.001));
  ivec2 i = ivec2(floor(g)); vec2 f = g - vec2(i);
  float h00 = texelFetch(tOuterH, i, 0).r, h10 = texelFetch(tOuterH, i + ivec2(1,0), 0).r;
  float h01 = texelFetch(tOuterH, i + ivec2(0,1), 0).r, h11 = texelFetch(tOuterH, i + ivec2(1,1), 0).r;
  return f.x + f.y <= 1.0 ? h00 + (h10 - h00) * f.x + (h01 - h00) * f.y : h11 + (h01 - h11) * (1.0 - f.x) + (h10 - h11) * (1.0 - f.y);
}
float gAt(vec2 p){ return (abs(p.x) <= uHalf && abs(p.y) <= uHalf) ? hAt(p) : hOut(p); }
`;

// Everything about a blade that depends only on where it grows: ground, masks, noise, density, species, base colour.
// The blade rings bake it once per chunk placement into textures (buildGrass); the card rings compute it in place.
//   bA: ground height, ground normal      bB: base colour, height before the ring fade
//   bC: paving factor on the height, density, flower density, code: 0 = nothing grows here, else 1 + 2 rice + 4 reed
//       + 8 turf + 16 x species unless it turns out a flower (1 seed head, 2 dry blade, 3 broad leaf) + 64 x flower
//       colour (0-4) + 512 card flower
export const GLSL_BLADE_STATIC = /* glsl */`
void bladeStatic(vec2 wp2, vec4 iRand, out vec4 bA, out vec4 bB, out vec4 bC) {
  bA = vec4(0.0); bB = vec4(0.0); bC = vec4(0.0);
  bool inMap = abs(wp2.x) < uHalf - 1.0 && abs(wp2.y) < uHalf - 1.0;
  vec4 gm2 = inMap ? textureLod(tMask2, maskUV(wp2), 0.0) : vec4(0.0);
  bool rice = gm2.g > 0.6;
  if (rice) wp2 = (floor(wp2 / vec2(0.32, 0.26)) + 0.5) * vec2(0.32, 0.26) + (iRand.zx - 0.5) * 0.05; // transplanted rows
  // nothing grows on paving (below, every kind of blade's density is scaled to zero there): leave before the ground
  // and noise reads
  float pv = inMap ? paveAt(wp2) : 0.0;
  if (pv >= 0.3) return;
  float gh, ghx, ghz;
  if (abs(wp2.x) < uHalf - 3.0 * uCell && abs(wp2.y) < uHalf - 3.0 * uCell) hAt5(wp2, gh, ghx, ghz);
  else { gh = gAt(wp2); ghx = gAt(wp2 + vec2(uCell, 0.0)) - gAt(wp2 - vec2(uCell, 0.0)); ghz = gAt(wp2 + vec2(0.0, uCell)) - gAt(wp2 - vec2(0.0, uCell)); }
  vec3 gN = normalize(vec3(-ghx, 2.0 * uCell, -ghz));
  vec4 gz0 = textureLod(tNoise, wp2 * 0.00041 + 0.37, 0.0);
  vec4 gz1 = textureLod(tNoise, wp2 * 0.0021, 0.0);
  vec4 gz2 = textureLod(tNoise, wp2 * 0.013, 0.0);
  vec4 gz3 = textureLod(tNoise, wp2 * 0.06, 0.0);
  // outside the map the forests follow the far-forest mask (as the ground shader and the far trees do)
  vec4 gm = inMap ? textureLod(tMask, maskUV(wp2), 0.0)
    : vec4(smoothstep(0.47, 0.6, gz1.r + (gz2.g - 0.5) * 0.12 + (gz0.b - 0.5) * 0.2) * smoothstep(0.2, 0.12, 1.0 - gN.y)
        * (1.0 - smoothstep(uSnow - 45.0, uSnow + 5.0, gh)) * step(uWaterLv + 3.0, gh), 1.0, 0.0, 0.5);
  float dens = smoothstep(uShore * 0.35, uShore * 1.2, gh - uWaterLv + (gz2.r - 0.5) * 1.2)
    * (1.0 - smoothstep(0.26, 0.40, 1.0 - gN.y + (gz2.b - 0.5) * 0.14))
    * (1.0 - smoothstep(uSnow - 25.0, uSnow + 3.0, gh))
    * (1.0 - gm.b * 0.92)
    * (1.0 - smoothstep(0.2, 0.75, gm.r + (gz3.r - 0.5) * 0.35) * 0.88);
  dens *= smoothstep(0.1, 0.45, gz2.g + gz3.g * 0.35);
  dens *= (1.0 - gm2.b) * (1.0 - smoothstep(0.2, 0.7, gm2.r) * 0.85);
  dens *= 1.0 - 0.45 * gm2.a; // mowed town lawns are sparser...
  if (rice) dens = 1.0;
  // reed beds in clumps along the waterline (standing in the shallows and on the wet margin)
  float hw = gh - uWaterLv, reedN = gz3.b * 0.55 + gz2.g * 0.65 + gz1.r * 0.2;
  bool reed = !rice && uReeds > 0.5 && uLod < 0.9 && hw > -0.5 && hw < 0.55 && reedN > 0.66 && iRand.w < 0.7 && gN.y > 0.9;
  if (reed) dens = 1.0;
  // nothing grows on paving; along its edge the sward thins and stays low, so no blade stands through a kerb
  dens *= 1.0 - smoothstep(0.04, 0.3, pv);
  bool turf = (wp2.x > uTurf0.x && wp2.x < uTurf0.z && wp2.y > uTurf0.y && wp2.y < uTurf0.w) || (wp2.x > uTurf1.x && wp2.x < uTurf1.z && wp2.y > uTurf1.y && wp2.y < uTurf1.w);
  if (turf) dens = 0.92 * (1.0 - smoothstep(0.04, 0.3, pv));
  float keep = step(iRand.w + 0.002, dens); // strict: dens 0 keeps nothing
  if (keep < 0.5) return;
  // meadow zones: whole flower meadows in some valleys, short wiry alpine turf high up; woodland flowers along the
  // forest edges (flowerPatch, shared with life.js)
  float alpine = smoothstep(85.0, 150.0, gh - uWaterLv);
  float forestF = smoothstep(0.25, 0.8, gm.r);
  float fPatch = flowerPatch(gz1, gz2, gz3, gm.r);
  // flowers per square metre: one budget shared with the close-up blossom sprites (life.js FLOWER_GLSL), so a patch
  // keeps the same density from your feet to the far meadow; the per-blade chance divides it by this ring's blade
  // density (a finer random than the 8-bit iRand.w, so thin backgrounds stay thin)
  float flD = flowerDensity(clamp(fPatch, 0.0, 1.0), alpine) * dens * (1.0 - 0.6 * gm2.a);
  // species: most blades are meadow grass; a share are seed-head grasses (more in drier patches), sun-dried straw
  // blades, and broad low weed leaves (plantain / dock) in the unmown grass — under the trees mostly broad-leaved
  // woodland herbs (for a blade that is not a flower: whether it is one depends on the camera, decided per frame)
  float sp = fract(iRand.x * 7.13 + iRand.z * 3.71 + iRand.y * 1.37);
  float dryness = smoothstep(0.5, 0.85, gz1.b + (gz3.g - 0.5) * 0.3);
  bool plain = !rice && !reed && !turf;
  bool seedG = plain && sp < (0.05 + 0.07 * dryness) * (1.0 - forestF) && gm2.a < 0.5;
  bool dryB = plain && !seedG && sp < (0.12 + 0.2 * dryness) * (1.0 - forestF * 0.7);
  bool broadB = plain && !seedG && !dryB && sp > 0.91 - 0.5 * forestF && gm2.a < 0.5;
  #ifdef GRASS_CARD
    float Hs = uCard.y * (0.7 + 0.6 * iRand.y) * (0.55 + 0.65 * gz2.g) * keep * (1.0 - 0.6 * gm2.a) * (rice ? 0.75 : 1.0);
    float pick = fract(gz2.g * 5.3 + gz3.b * 0.6);
    float flR = iRand.w + fract(iRand.z * 61.7 + iRand.x * 13.1) / 255.0;
    float extra = step(flR, clamp(flD * 0.22, 0.0, 0.75)) * (rice ? 0.0 : 512.0);
  #else
    // tall-grass patches stand out of the shorter sward
    float tallP = smoothstep(0.55, 0.8, gz2.a * 0.7 + gz3.r * 0.5);
    float Hs = mix(0.18, 0.78, iRand.y * iRand.y) * (0.5 + 0.7 * gz2.g) * (1.0 + 0.45 * tallP) * keep;
    Hs *= 1.0 - 0.68 * gm2.a;   // ...and short
    Hs *= 1.0 - 0.5 * alpine;
    Hs *= 1.0 - 0.35 * forestF; // low woodland herbs under the trees
    float pick = fract(gz2.g * 5.3 + gz3.b * 0.6 + step(0.9, iRand.x) * 0.37);
    float extra = 0.0;
  #endif
  // the blade takes the painted colour of the ground it grows from (rice, mown turf and reeds have their own)
  vec3 c = meadowColor(gz0, gz1, gz2, gz3);
  c = mix(c, uP_forest * 1.25, smoothstep(0.2, 0.75, gm.r) * 0.6);
  c *= 0.9 + 0.22 * iRand.y;
  if (rice) c = mix(vec3(0.12, 0.36, 0.05), vec3(0.28, 0.5, 0.08), iRand.y) * (0.8 + 0.3 * gz3.r);
  if (turf) c = mix(vec3(0.16, 0.36, 0.08), vec3(0.2, 0.42, 0.1), iRand.y) * (step(0.5, fract((wp2.x - uTurfStripe.y) / uTurfStripe.z * 0.5)) > 0.5 ? 0.88 : 1.06);
  if (reed) c = mix(vec3(0.1, 0.3, 0.08), vec3(0.36, 0.42, 0.14), iRand.y * 0.75 + gz3.r * 0.25) * (0.8 + 0.3 * iRand.z);
  // each flower patch has its own colour: white daisies, buttercups, pink clover, violets, poppies
  float cat = pick < 0.26 ? 0.0 : pick < 0.5 ? 1.0 : pick < 0.7 ? 2.0 : pick < 0.88 ? 3.0 : 4.0;
  bA = vec4(gh, gN);
  bB = vec4(c, Hs);
  bC = vec4(1.0 - 0.75 * smoothstep(0.0, 0.3, pv), dens, flD,
    1.0 + (rice ? 2.0 : 0.0) + (reed ? 4.0 : 0.0) + (turf ? 8.0 : 0.0) + (seedG ? 16.0 : dryB ? 32.0 : broadB ? 48.0 : 0.0) + cat * 64.0 + extra);
}`;
// baked blade data layout: per ring, chunk k owns rows [k R, (k + 1) R) of BAKE_W texels
const BAKE_W = 1024;

// ---------------------------------------------------------------- painted palette (anime look)
// Terrain and grass share these colours and the meadow function, so every blade matches the ground it grows from.
export const PAINT = {
  gDeep: '#2a7a3e', gLush: '#4ea236', gLight: '#9ccd4c', gDry: '#c9c45c', forest: '#35592b', canopy: '#24503a',
  rockL: '#a3978d', rockD: '#5f5d72', sand: '#ead7a2', sandWet: '#a98f66', snow: '#f5f8ff', bed: '#2a6d66',
};
export const paintU = {};
// sports turf (up to two rectangles x0, z0, x1, z1): the grass there is a dense, short, even sward of one lush green
// with the mower's stripes, no flowers, seed heads or weeds (the ground under it is the pitch's own turf surface)
export const turfU = { uTurf0: { value: new THREE.Vector4(0, 0, 0, 0) }, uTurf1: { value: new THREE.Vector4(0, 0, 0, 0) }, uTurfStripe: { value: new THREE.Vector4(1, 0, 5.25, 0) } };
for (const k in PAINT) paintU['uP_' + k] = { value: new THREE.Color(PAINT[k]) };
// Flowers per square metre in a meadow, shared by the grass blades / clump cards and the close-up blossom sprites
// (life.js), so a patch looks equally rich at every distance. z1/z2/z3: tNoise at world * 0.0021 / 0.013 / 0.06;
// forest: forest mask (woodland flowers along the edges); h: height above water.
export const FLOWER_GLSL = /* glsl */`
  float flowerPatch(vec4 z1, vec4 z2, vec4 z3, float forest){
    float meadow = smoothstep(0.62, 0.8, z1.a + (z2.r - 0.5) * 0.2);
    float edge = smoothstep(0.1, 0.28, forest) * (1.0 - smoothstep(0.42, 0.65, forest));
    return clamp(max(smoothstep(0.58, 0.8, z3.g * 0.65 + z2.a * 0.6), meadow * smoothstep(0.35, 0.6, z3.g)) + edge * 0.35 * smoothstep(0.4, 0.7, z3.a), 0.0, 1.0);
  }
  float flowerDensity(float fPatch, float alpine){ return 0.03 + 3.0 * fPatch + 0.35 * alpine; }`;
export const MEADOW_GLSL = /* glsl */`
  uniform vec3 ${Object.keys(PAINT).map(k => 'uP_' + k).join(', ')};
  ${FLOWER_GLSL}
  // nz0/nz1/nz2/nz3: tNoise at world * 0.00041 + 0.37 / 0.0021 / 0.013 / 0.06
  vec3 meadowColor(vec4 nz0, vec4 nz1, vec4 nz2, vec4 nz3){
    vec3 c = mix(uP_gDeep, uP_gLush, smoothstep(0.28, 0.62, nz1.g + (nz2.b - 0.5) * 0.3));
    c = mix(c, uP_gLight, smoothstep(0.5, 0.8, nz2.r + (nz1.r - 0.5) * 0.4) * 0.75);
    c = mix(c, uP_gDry, smoothstep(0.62, 0.86, nz1.b + (nz3.g - 0.5) * 0.2) * 0.55);
    // regional shifts between lush valley green and drier, warmer uplands, deeper green in some hollows (km scale), and
    // lighter / darker swathes a few hundred metres across: blades, cards and the ground all share them
    float region = smoothstep(0.35, 0.75, nz0.r + (nz1.a - 0.5) * 0.3);
    c = mix(c, mix(c, uP_gDry, 0.35) * vec3(1.02, 0.98, 0.9), region * 0.55);
    c = mix(c, uP_gDeep * 1.08, smoothstep(0.62, 0.9, nz0.g) * 0.35);
    c *= mix(0.92, 1.07, smoothstep(0.3, 0.7, nz1.g * 0.5 + nz2.a * 0.5));
    return c;
  }`;

// ---------------------------------------------------------------- splat terrain
// layers: { grass, forest, rock, shore, urban } each { d: diffuse tex, n: normal tex, s: tile metres, tint: [r,g,b] }
// All five diffuse maps live in one texture array and all five normal maps in another, so every layer gets its own
// normal map while the whole ground shader uses 7 texture units (WebGL2 guarantees 16).
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
      uWaterLv: { value: opt.water ?? 0 }, uSnow: { value: opt.snow ?? 175 }, uShore: { value: opt.shore ?? 1.3 }, uFarTrees: terrainFarTrees, uGrassNear: grassU.uGrassNear, uGrassFar: grassU.uGrassFar, uGrassE: grassU.uGrassE,
    }, paintU);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNorm; varying float vCloudLit;\n' + CLOUD_SHADE_GLSL)
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWNorm = normalize(mat3(modelMatrix) * objectNormal); vCloudLit = cloudShade(vWPos);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying vec3 vWNorm;
        uniform sampler2D tNoise, tMask, tMask2;
        uniform float uHalf, uCell, uHN, uRockS, uWaterLv, uSnow, uShore, uGrassNear, uGrassFar, uGrassE, uFarTrees; uniform vec4 uScales; uniform vec3 uTintG, uTintF, uTintU, uTintS; uniform float uUrbanNorm;
        vec3 unpackN(vec4 t){ return t.xyz * 2.0 - 1.0; }
        // layers: 0 grass, 1 forest floor, 2 rock, 3 shore, 4 urban ground
        #ifdef TERRAIN_LITE
          vec4 layD(vec2 uv, float l){ return vec4(0.32); }
          vec4 layDL(vec2 uv, float l, float lod){ return vec4(0.32); }
          vec3 layN(vec2 uv, float l){ return vec3(0.0, 0.0, 1.0); }
          vec4 layDA(vec2 uv, float l, float b){ return vec4(0.32); }
          vec3 layNA(vec2 uv, float l, float b){ return vec3(0.0, 0.0, 1.0); }
          vec4 layDG(vec2 uv, float l, vec2 dx, vec2 dy){ return vec4(0.32); }
          vec3 layNG(vec2 uv, float l, vec2 dx, vec2 dy){ return vec3(0.0, 0.0, 1.0); }
          vec4 layDAG(vec2 uv, float l, float b, vec2 dx, vec2 dy){ return vec4(0.32); }
          vec3 layNAG(vec2 uv, float l, float b, vec2 dx, vec2 dy){ return vec3(0.0, 0.0, 1.0); }
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
          // the same lookups with explicit gradients (taken from the texture coordinates outside any branch): a layer
          // whose weight is zero at a pixel is then skipped without changing the mip level picked anywhere else
          vec4 layDG(vec2 uv, float l, vec2 dx, vec2 dy){ return textureGrad(tLayD, vec3(uv, l), dx, dy); }
          vec3 layNG(vec2 uv, float l, vec2 dx, vec2 dy){ return unpackN(textureGrad(tLayN, vec3(uv, l), dx, dy)); }
          vec4 layDAG(vec2 uv, float l, float b, vec2 dx, vec2 dy){ return mix(textureGrad(tLayD, vec3(uv, l), dx, dy), textureGrad(tLayD, vec3(uvB(uv), l), ROT * dx * 0.73, ROT * dy * 0.73), b); }
          vec3 layNAG(vec2 uv, float l, float b, vec2 dx, vec2 dy){
            vec3 n0 = unpackN(textureGrad(tLayN, vec3(uv, l), dx, dy)), n1 = unpackN(textureGrad(tLayN, vec3(uvB(uv), l), ROT * dx * 0.73, ROT * dy * 0.73));
            n1.xy = transpose(ROT) * n1.xy;
            return mix(n0, n1, b);
          }
        #endif
        vec2 maskUV(vec2 p){ return ((p + uHalf) / uCell + 0.5) / uHN; }
        float lum3(vec3 c){ return dot(c, vec3(0.3, 0.55, 0.15)); }
        #ifdef TERRAIN_ALL_LAYERS
          #define LAYER_ON(w) true
        #else
          #define LAYER_ON(w) (w > 0.0)
        #endif
        ${MEADOW_GLSL}`)
      .replace('#include <map_fragment>', /* glsl */`
        vec3 wN = normalize(vWNorm);
        vec2 wuv = vWPos.xz;
        vec2 wdx = dFdx(wuv), wdy = dFdy(wuv); vec3 pdx = dFdx(vWPos), pdy = dFdy(vWPos);
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
        vec3 cGrass = meadowColor(nz0, nz1, nz2, nz3);
        float region = smoothstep(0.35, 0.75, nz0.r + (nz1.a - 0.5) * 0.3);
        cGrass *= mix(1.0, clamp(lum3(layDAG(wuv / uScales.x, 0.0, tileB, wdx / uScales.x, wdy / uScales.x).rgb) * 3.6, 0.6, 1.4), 0.2 * nearT);
        vec3 nGrass = layNAG(wuv / uScales.x, 0.0, tileB, wdx / uScales.x, wdy / uScales.x) * 0.35;
        // the weights of the other layers first (noise and masks only); each layer's textures are then read only where
        // its weight is above zero — rock (tri-planar, fifteen lookups) on slopes and scree, sand on shores, urban ground
        // in the town, forest floor in the woods (a zero weight leaves the result exactly as if it had been read)
        float shoreN = (nz2.r - 0.5) * 1.1 + (nz3.b - 0.5) * 0.6;
        float wSand = max(1.0 - smoothstep(uShore * 0.2, uShore, h + shoreN * uShore * 0.9), msk2.g);
        float wRock = smoothstep(0.30, 0.46, slope + (nz2.b - 0.5) * 0.14);
        // scree: broken rock collects at the foot of cliffs and on steep upper slopes
        float scree = smoothstep(0.2, 0.3, slope) * (1.0 - wRock) * smoothstep(0.55, 0.8, nz3.a + nz2.b * 0.3);
        // the snow line climbs toward the distant ranges, so only their high peaks carry snow
        float snowL = uSnow + max(0.0, length(vWPos.xz) - 1500.0) * 0.06;
        float wSnow = smoothstep(snowL, snowL + 40.0, vWPos.y + (nz1.b - 0.5) * 70.0) * (1.0 - smoothstep(0.42, 0.62, slope));
        float wForest = smoothstep(0.2, 0.7, forest + (nz3.r - 0.5) * 0.35);
        wForest = mix(wForest, smoothstep(0.4, 0.54, forest), (1.0 - inside) * step(uHalf + 1024.0, max(abs(vWPos.x), abs(vWPos.z))));
        // where the map removed the grass (yards, verges, pitches) the ground is gravel / packed soil, never bare meadow
        // paint (a flat green patch with no blades on it)
        float wUrban = max(smoothstep(0.15, 0.6, msk2.r + (nz3.g - 0.5) * 0.25), smoothstep(0.35, 0.8, msk2.b));
        // forest floor: warm needle litter on the dry stands, deep green moss where it is damp, patches of bare dark soil
        // (mask A carries the ground moisture the map painted: 0 dry .. 1 wet)
        vec3 cForest = vec3(0.0), nForest = vec3(0.0);
        if (LAYER_ON(wForest)) {
          float moist = inside > 0.5 ? msk.a : 0.5;
          float mossW = smoothstep(0.38, 0.82, moist + (nz2.a - 0.5) * 0.45 + (nz3.g - 0.5) * 0.25);
          float soilW = smoothstep(0.68, 0.84, nz3.b * 0.65 + nz2.g * 0.45) * (1.0 - mossW * 0.7) * 0.7;
          cForest = mix(mix(uP_forest, uP_sandWet * 0.3, 0.5), uP_forest * vec3(0.8, 1.25, 0.74), mossW);
          cForest = mix(cForest, uP_sandWet * vec3(0.2, 0.19, 0.18), soilW);
          cForest *= mix(0.84, 1.1, nz2.r) * mix(1.0, clamp(lum3(layDAG(wuv / uScales.y, 1.0, tileB, wdx / uScales.y, wdy / uScales.y).rgb) * 3.2, 0.6, 1.4), 0.3 * nearT);
          nForest = layNAG(wuv / uScales.y, 1.0, tileB, wdx / uScales.y, wdy / uScales.y) * 0.55;
          // where no trees stand any more (past the outermost far-forest ring) the forest reads as a painted canopy with
          // soft crown relief; under drawn trees the floor stays the darker forest ground
          float noTrees = (1.0 - inside) * step(uFarTrees, max(abs(vWPos.x), abs(vWPos.z)));
          float crownW = noTrees * smoothstep(0.3, 0.8, forest);
          vec2 cuv = wuv * 0.0045;
          float cr0 = texture2D(tNoise, cuv).a, crx = texture2D(tNoise, cuv + vec2(0.0035, 0.0)).a, crz = texture2D(tNoise, cuv + vec2(0.0, 0.0035)).a;
          vec3 crownN = normalize(vec3(-(crx - cr0) * 3.0, 1.0, -(crz - cr0) * 3.0));
          // canopy tone sits between the forest shade and the lit far-tree cards, so distant woods read as one mass
          vec3 cCanopy = mix(uP_canopy, vec3(0.19, 0.44, 0.31), 0.45) * (0.78 + 0.4 * cr0) * mix(0.9, 1.1, nz2.r) * mix(vec3(1.0), vec3(1.08, 1.02, 0.86), region * 0.5);
          // outside the map the ground under the far trees takes the canopy colour too, so the gaps between distant tree
          // cards read as more forest rather than bright speckle
          float ringOut = step(uHalf + 1024.0, max(abs(vWPos.x), abs(vWPos.z)));
          // (by distance, not by map edge: near woods keep their floor on both sides of the boundary)
          cForest = mix(cForest, cCanopy, max(crownW, smoothstep(650.0, 1500.0, camDist) * mix(smoothstep(0.25, 0.6, forest), smoothstep(0.42, 0.52, forest), ringOut) * 0.9));
          nForest = mix(nForest, vec3(crownN.x, crownN.z, 0.0), crownW);
        }
        vec3 cSand = vec3(0.0), nSand = vec3(0.0);
        if (LAYER_ON(wSand) || LAYER_ON(scree)) {
          cSand = mix(uP_sand, uP_sand * vec3(0.92, 0.9, 0.84), nz3.r) * mix(1.0, clamp(lum3(layDAG(wuv / uScales.z, 3.0, tileB, wdx / uScales.z, wdy / uScales.z).rgb) * 2.2, 0.7, 1.3), 0.25 * nearT);
          nSand = layNAG(wuv / uScales.z, 3.0, tileB, wdx / uScales.z, wdy / uScales.z) * 0.5;
        }
        vec3 cUrban = vec3(0.0), nUrban = vec3(0.0);
        if (LAYER_ON(wUrban)) {
          vec3 uTex = layDAG(wuv / uScales.w, 4.0, tileB, wdx / uScales.w, wdy / uScales.w).rgb, uAvg = layDL(wuv / uScales.w, 4.0, 7.0).rgb;
          cUrban = mix(uAvg, uTex, 0.35) * uTintU * (uUrbanNorm > 0.0 ? uUrbanNorm / max(lum3(uAvg), 0.04) : 1.0); // optional painted brightness
          nUrban = layNAG(wuv / uScales.w, 4.0, tileB, wdx / uScales.w, wdy / uScales.w) * 0.6;
        }
        // rock: tri-planar, each axis with the rock layer's own normal map; the scale widens with distance
        vec3 cRock = vec3(0.0), nRock = wN, rny = vec3(0.0);
        if (LAYER_ON(wRock) || LAYER_ON(scree)) {
          vec3 bw = pow(max(abs(wN), vec3(1e-4)), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
          // two fixed scales cross-faded by distance (a scale that changed with distance would make the rock swim)
          float rs = 1.0 / uRockS, rs2 = 1.0 / (uRockS * 3.4), rw = farT * 0.7;
          vec3 cRockT = layDG(vWPos.zy * rs, 2.0, pdx.zy * rs, pdy.zy * rs).rgb * bw.x + layDG(vWPos.xz * rs, 2.0, pdx.xz * rs, pdy.xz * rs).rgb * bw.y + layDG(vWPos.xy * rs, 2.0, pdx.xy * rs, pdy.xy * rs).rgb * bw.z;
          vec3 cRockF = layDG(vWPos.zy * rs2, 2.0, pdx.zy * rs2, pdy.zy * rs2).rgb * bw.x + layDG(vWPos.xz * rs2, 2.0, pdx.xz * rs2, pdy.xz * rs2).rgb * bw.y + layDG(vWPos.xy * rs2, 2.0, pdx.xy * rs2, pdy.xy * rs2).rgb * bw.z;
          cRockT = mix(cRockT, cRockF, rw);
          vec3 rnx = layNG(vWPos.zy * rs, 2.0, pdx.zy * rs, pdy.zy * rs), rnz = layNG(vWPos.xy * rs, 2.0, pdx.xy * rs, pdy.xy * rs);
          rny = layNG(vWPos.xz * rs, 2.0, pdx.xz * rs, pdy.xz * rs);
          nRock = normalize(wN + (vec3(0.0, rnx.y, rnx.x) * bw.x + vec3(rny.x, 0.0, rny.y) * bw.y + vec3(rnz.x, rnz.y, 0.0) * bw.z) * (1.0 - rw * 0.6));
          // rock: two painted tones picked by the photo's light/dark strata, plus horizontal bedding bands on cliffs
          float strata = sin(vWPos.y * 0.9 + nz2.g * 6.0 + nz3.r * 2.0) * 0.5 + 0.5;
          cRock = mix(uP_rockD, uP_rockL, smoothstep(0.18, 0.42, lum3(cRockT) + (nz2.b - 0.5) * 0.12 + (strata - 0.5) * 0.08 * smoothstep(0.35, 0.7, slope)));
          cRock *= mix(0.92, 1.06, nz0.b);
        }
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
        // dense stands keep a darker, calmer floor under their crowns
        col *= mix(1.0, ao, 0.6) * (1.0 - canopy * 0.45) * mix(1.0, 0.86, smoothstep(0.6, 0.95, forest) * wForest * inside);
        // the meadow the grass rings leave to the ground: under the card rings it is the shade between the blades, so the
        // lit tips stand out; past them it is painted as grass seen from afar — tussocks, wind-combed streaks, darker
        // clumps, flower-tinted swathes, and a coverage that grows toward grazing views (from above you look into the
        // sward and its shadows, across it you only see the lit tips)
        float meadowW = (1.0 - wForest) * (1.0 - wUrban) * (1.0 - wRock) * (1.0 - wSand) * (1.0 - wSnow) * (1.0 - msk2.b);
        float gExt = step(max(abs(vWPos.x), abs(vWPos.z)), uGrassE);
        float cardsOn = gExt * (1.0 - smoothstep(uGrassFar * 0.55, uGrassFar, camDist));
        vec2 wl = vec2(dot(wuv, vec2(0.943, 0.330)), dot(wuv, vec2(-0.330, 0.943)));
        float comb = texture2D(tNoise, wl * vec2(0.0035, 0.028) + 0.19).g;
        float tuft = texture2D(tNoise, wuv * 0.07 + 0.53).r * 0.55 + texture2D(tNoise, wuv * 0.23 + 0.71).g * 0.45;
        float clump = smoothstep(0.6, 0.78, texture2D(tNoise, wuv * 0.017 + 0.3).b + (nz3.a - 0.5) * 0.2);
        float graze = 1.0 - clamp(dot(normalize(cameraPosition - vWPos), wN), 0.0, 1.0);
        float cover = clamp(mix(0.36, 0.95, pow(graze, 0.55)) + (tuft - 0.5) * 0.55 + (comb - 0.5) * 0.45, 0.0, 1.0);
        vec3 cTip = col * (0.62 + 0.26 * min(uP_gLight / max(cGrass, vec3(0.015)), vec3(3.0)));
        float fMeadow = smoothstep(0.62, 0.8, nz1.a + (nz2.r - 0.5) * 0.2);
        cTip = mix(cTip, cTip * vec3(1.22, 1.12, 0.96), fMeadow * 0.4);
        vec3 cMeadow = mix(col * 0.78, cTip, cover) * (1.0 - clump * 0.22 * (1.0 - cover * 0.3));
        col = mix(col, col * (0.8 + (tuft - 0.5) * 0.16), meadowW * smoothstep(uGrassNear * 0.6, uGrassNear * 1.4, camDist) * cardsOn);
        // where the sward thins out (the same noise the blades use) the ground is short, tufted turf rather than a bare
        // painted floor: fine clumps with lit tops and shaded gaps
        float sparse = (1.0 - smoothstep(0.1, 0.45, nz2.g + nz3.g * 0.35)) * cardsOn * (1.0 - msk2.a);
        float turfN = texture2D(tNoise, wuv * 0.55 + 0.21).g * 0.6 + texture2D(tNoise, wuv * 1.7 + 0.43).b * 0.4;
        col = mix(col, mix(col * 0.72, cTip * 1.04, clamp(0.45 + (turfN - 0.5) * 1.6 + (tuft - 0.5) * 0.4, 0.0, 1.0)), meadowW * sparse * 0.85);
        col = mix(col, cMeadow, meadowW * (1.0 - cardsOn));
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
  // drawn after everything standing on it (core.js draw order) with a strict depth test: it loses exact ties, as it did
  // when it was drawn first, so coplanar surfaces keep showing over it
  mat.userData.drawClass = 3; mat.depthFunc = THREE.LessDepth;
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
  // normals at the heightfield's border sample the height function past it (clamping would halve the slope there)
  const Hn = (i, j) => i < 0 || j < 0 || i > GRID || j > GRID ? hf.fn(-HALF + i * CELL, -HALF + j * CELL) : H[j * HN + i];
  for (let cj = 0; cj < NC; cj++) for (let ci = 0; ci < NC; ci++) {
    const pos = new Float32Array(n * n * 3), nor = new Float32Array(n * n * 3);
    for (let b = 0; b < n; b++) for (let a = 0; a < n; a++) {
      const i = ci * CH + a, j = cj * CH + b, k = (b * n + a) * 3;
      pos[k] = -HALF + i * CELL; pos[k + 1] = edgeH(i, j); pos[k + 2] = -HALF + j * CELL;
      const hx = Hn(i + 1, j) - Hn(i - 1, j), hz = Hn(i, j + 1) - Hn(i, j - 1), l = Math.hypot(hx, 2 * CELL, hz);
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
      // neighbours for normals: inside the ring's hole there are no stored heights, so ask the height function
      const HN2 = (i, j) => { const x = -E + i * S, z = -E + j * S; return Math.abs(x) < R.inner - 1e-3 && Math.abs(z) < R.inner - 1e-3 ? fn(x, z) : HT(i, j); };
      ringData.push({ ...R, N, E, HT, hts });
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
            if (S <= 4) { hx = HN2(i + 1, j) - HN2(i - 1, j); hz = HN2(i, j + 1) - HN2(i, j - 1); d = 2 * S; }
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
  // height on the rendered outer-ring triangles (quads split along the (i+1,j)-(i,j+1) diagonal)
  const groundOn = (R, x, z) => {
    const gx = (x + R.E) / R.step, gz = (z + R.E) / R.step, i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j;
    const h00 = R.HT(i, j), h10 = R.HT(i + 1, j), h01 = R.HT(i, j + 1), h11 = R.HT(i + 1, j + 1);
    return fx + fz <= 1 ? h00 + (h10 - h00) * fx + (h01 - h00) * fz : h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  };
  // the first outer ring's heights go to the GPU too, so the far grass rings can carry on past the map edge
  if (ringData.length) {
    const R0 = ringData[0], t = new THREE.DataTexture(R0.hts, R0.N, R0.N, THREE.RedFormat, THREE.FloatType);
    t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true;
    hf.outer = { E: R0.E, S: R0.step, N: R0.N, tex: t, data: R0.hts, at: (x, z) => groundOn(R0, x, z) };
  }
  // ---- far forest: F-rings of trees, sparser and larger with distance, cross-faded at their borders
  const FR = [{ inner: HALF, outer: HALF + 1024, sp: 8, sc: 1, ring: 0 }, { inner: HALF + 1024, outer: HALF + 3072, sp: 13, sc: 1.2, ring: 1 },
    { inner: HALF + 3072, outer: HALF + 5120, sp: 22, sc: 1.45, ring: 2 }, { inner: HALF + 5120, outer: HALF + 8192, sp: 34, sc: 1.75, ring: 2 }];
  const farExt = () => FR[clamp((Q.far || 1) - 1, 0, FR.length - 1)].outer;
  terrainFarTrees.value = outer && farForest ? farExt() : HALF;
  if (outer && farForest && ringData.length) {
    const o = mat.userData.opt || {}, water = o.water ?? 0, snow = o.snow ?? 175, conifer = o.conifer ?? 0.7;
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
          // closed stands with clean edges (sparse far trees only read as speckle); beyond the first ring the edge is crisp
          if (r2 > (fi ? smoothstep(0.42, 0.52, f) : smoothstep(0.25, 0.6, f))) continue;
          const alt = y - water, leafy = r3 > conifer + (alt - 60) * 0.004;
          // growth forms vary by stand (old growth, young regrowth) and altitude (pines and spires up high); colours
          // shift per stand, so distant slopes read as patchwork forest rather than one flat green
          const stand = noiseAt(x * 0.0023 + 0.61, z * 0.0023 + 0.17, 1), cl = noiseAt(x * 0.004 + 0.3, z * 0.004 + 0.8, 0), br = noiseAt(x * 0.009, z * 0.009 + 0.5, 2);
          let v, s;
          if (leafy) { v = r4 < 0.5 ? 0 : r4 < 0.8 ? 1 : 2; s = lerp(9, 15, rng()) * (v === 1 ? 1.15 : v === 2 ? 1.1 : 1); }
          else {
            const q = rng(), high = smoothstep(90, 160, alt);
            v = q < 0.18 * high + 0.05 ? 4 : q < 0.3 + 0.35 * (1 - stand) ? 1 : q < 0.55 + 0.25 * stand ? 0 : q < 0.8 + 0.1 * stand ? 2 : 3;
            s = [lerp(14, 24, rng()), lerp(7, 13, rng()), lerp(22, 32, rng()), lerp(18, 28, rng()), lerp(12, 20, rng())][v];
          }
          s *= F.sc * (0.8 + 0.2 * f);
          const form = ['spruce', 'young', 'old', 'tall', 'pine'][v];
          (leafy ? sets[fi].leaf : sets[fi].fir).push({ x, y: y - 0.3 - slope * 3, z, s, v, sx: 0.75 + 0.5 * rng(), r: rng() * 6.28, tilt: (rng() - 0.5) * 0.05,
            c: leafy ? broadColor(rng, ['leaf', 'oak', 'birch'][v], cl, br) : coniferColor(rng, form, cl, br) });
        }
        if ((b & 127) === 127) await tick();
      }
    }
    buildFarForest(sets);
  }
  group.userData.applyQuality = () => { if (outer && farForest) terrainFarTrees.value = farExt(); };
  scene.add(group);
  return group;
}

/// ---------------------------------------------------------------- grass + rice (GPU instanced, wraps around the camera)
// Grass is drawn in distance rings, each a K x K set of world-anchored cells: a cell always carries the same blade
// pattern (cell -> chunk by index mod K), so blades never swim as the camera moves. Every cell is its own draw with a real
// bounding sphere, so three's frustum culling and a per-cell distance test skip everything off-screen or out of range.
// The hierarchy (radii and densities per quality in core.js, Q.grassR):
//   0  full blades: 4 segments, every species, full wind and player push
//   1  simplified blades: 2 segments, wider, same colours and wind, so the meadow keeps its density at a third of the cost
//   2  clump cards: camera-facing painted strips of dozens of blades (dark bases, light tips, flower heads, seed heads)
//   3  meadow cards: wider, taller clumps that keep the far meadow's silhouette fuzzy against the light
//   4  wide meadow cards that carry on past the map edge onto the first outer terrain ring
// Rings cross-fade stochastically; past the last one the ground shader paints the same meadow (see terrainMaterial).
const GRASS_K = 8;
const GRASS_RINGS = [
  { seg: 4, tuft: 1.0, lod: 0 },
  { seg: 2, tuft: 1.75, lod: 0.5 },
  { card: [1.3, 0.62], tuft: 1, lod: 1 },            // card: [width, height] in metres
  { card: [3.4, 0.95], tuft: 1, lod: 2 },
  { card: [6.5, 1.3], tuft: 1, lod: 3 },
];
const GRASS_FALLBACK = [[28, 70], [0, 0], [126, 1.1], [560, 0.02], [0, 0]];
// terrain shader side of the hierarchy: near blade radius, radius where the last card ring ends, extent of drawn grass
const grassU = { uGrassNear: { value: 30 }, uGrassFar: { value: 600 }, uGrassE: { value: 1024 } };
function updateGrassU(hf) {
  const R = (Q.grassR || GRASS_FALLBACK).map(r => r[1] > 0 ? r[0] : 0);
  grassU.uGrassNear.value = R[0];
  grassU.uGrassFar.value = Math.max(...R);
  grassU.uGrassE.value = hf.outer ? hf.outer.E - 8 : hf.HALF - 2;
}
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
  // seed-head grasses standing above the sward (B channel marks the heads)
  for (let i = 0; i < 16; i++) { const x = rng() * W, top = H * (0.02 + rng() * 0.12), lean = (rng() - 0.5) * 20;
    blade(x, H - top, 3, lean, 0.85);
    for (const dx of [-W, 0, W]) { g.fillStyle = 'rgb(210,0,255)'; g.beginPath(); g.ellipse(x + dx + lean, top + H * 0.07, 3.2, H * 0.08, lean * 0.01, 0, 7); g.fill(); } }
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
  const group = new THREE.Group(), K2 = GRASS_K * GRASS_K, O = hf.outer;
  const gu = { uWaterLv: { value: opt.water ?? 0 }, uSnow: { value: opt.snow ?? 175 }, uShore: { value: opt.shore ?? 1.3 }, uReeds: { value: opt.reeds ? 1 : 0 },
    tOuterH: { value: O ? O.tex : null }, uOuterE: { value: O ? O.E : hf.HALF }, uOuterS: { value: O ? O.S : 1 }, uOuterN: { value: O ? O.N : 2 }, uGrassE: grassU.uGrassE,
    uGrassY: { value: new THREE.Vector2(-50, 3000) } };
  { let lo = Infinity, hi = -Infinity; for (const h of hf.H) { if (h < lo) lo = h; if (h > hi) hi = h; } if (O && O.data) for (const h of O.data) { if (h < lo) lo = h; if (h > hi) hi = h; } if (isFinite(lo)) gu.uGrassY.value.set(lo - 5, hi + 10); }
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
  // The blade rings keep each blade's static data (GLSL_BLADE_STATIC: ground, masks, noise, species, base colour) in
  // textures, baked when a chunk moves to a new cell: per frame a blade vertex then reads four texels instead of running
  // twenty texture reads and the species logic again for every vertex of every blade. The card rings (few vertices per
  // tuft, chunks hundreds of metres wide) compute it in place.
  const rings = GRASS_RINGS.map((R, ri) => {
    const base = R.card ? cardGeometry() : bladeGeometry(R.seg), baked = true;
    const ru = { uCellSize: { value: 1 }, uR: { value: 1 }, uIn: { value: new THREE.Vector2(0, 0) }, uLod: { value: R.lod }, uTuft: { value: R.tuft },
      uCard: { value: new THREE.Vector2(...(R.card || [0, 0])) }, tCard: { value: R.card ? grassCardTexture() : null }, uDens: { value: 1 } };
    if (baked) Object.assign(ru, { tBladeIn: { value: null }, tBladeA: { value: null }, tBladeB: { value: null }, tBladeC: { value: null }, uBladeRows: { value: 1 } });
    const mat = grassMaterial(hf, grassTex, gu, ru, !!R.card, baked);
    const chunks = [];
    for (let c = 0; c < K2; c++) {
      const g = new THREE.InstancedBufferGeometry();
      g.setAttribute('position', base.position); g.setAttribute('bladeUV', base.bladeUV); g.setIndex(base.index);
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
      g.instanceCount = 0;
      const m = new THREE.Mesh(g, mat);
      m.matrixAutoUpdate = false; m.receiveShadow = true; m.visible = false;
      group.add(m);
      chunks.push({ m, g, i: c % GRASS_K, j: Math.floor(c / GRASS_K), X: NaN, Z: NaN, y0: 0, y1: 0, cap: 0, seed: 5 + ri * 7919 + c * 977 });
    }
    return { R, ru, chunks, s: 1, rad: 0, inA: 0, on: false, bake: baked ? { mats: [0, 1, 2].map(o => bakeMaterial(hf, gu, ru, !!R.card, o)), rts: null, inTex: null, n: 0, R: 1, todo: [] } : null };
  });
  // the blades' fixed inputs (position in the cell, randoms: the same per-chunk seed and sequence as fill) and the
  // targets the bake writes, chunk k in rows [k R, (k + 1) R)
  const makeBake = (ring, n) => {
    const B = ring.bake, R = Math.ceil(n / BAKE_W), H = ring.chunks.length * R;
    if (B.rts) { B.rts.forEach(t => t.dispose()); B.inTex.dispose(); }
    const data = new Uint32Array(BAKE_W * H * 2);
    ring.chunks.forEach((c, k) => {
      const rng = mulberry32(c.seed), o = k * R * BAKE_W * 2;
      for (let i = 0; i < n; i++) {
        const ox = Math.floor(rng() * 65535), oz = Math.floor(rng() * 65535), r0 = Math.floor(rng() * 255), r1 = Math.floor(rng() * 255), r2 = Math.floor(rng() * 255), r3 = Math.floor(rng() * 255);
        data[o + i * 2] = ox + oz * 65536; data[o + i * 2 + 1] = r0 + r1 * 256 + r2 * 65536 + r3 * 16777216;
      }
    });
    const inTex = new THREE.DataTexture(data, BAKE_W, H, THREE.RGIntegerFormat, THREE.UnsignedIntType);
    inTex.internalFormat = 'RG32UI'; inTex.minFilter = inTex.magFilter = THREE.NearestFilter; inTex.generateMipmaps = false; inTex.needsUpdate = true;
    // one target per output (a single multiple-render-target pass lost writes to its second target on this D3D11 path);
    // the codes and densities fit half floats, ground and colour stay 32-bit (half floats moved blade tips)
    const rts = [THREE.FloatType, THREE.FloatType, THREE.HalfFloatType].map(type => new THREE.WebGLRenderTarget(BAKE_W, H, { type, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false }));
    Object.assign(B, { rts, inTex, n, R });
    const u = ring.ru; u.tBladeIn.value = inTex; u.tBladeA.value = rts[0].texture; u.tBladeB.value = rts[1].texture; u.tBladeC.value = rts[2].texture; u.uBladeRows.value = R;
    for (const m of B.mats) m.uniforms.uN.value = n;
  };
  const bakeQuad = new FullScreenQuad(null);
  const runBake = ring => {
    const B = ring.bake; if (!B || !B.todo.length) return;
    const prev = renderer.getRenderTarget();
    for (let o = 0; o < 3; o++) {
      const rt = B.rts[o], u = B.mats[o].uniforms;
      bakeQuad.material = B.mats[o];
      for (const k of B.todo) {
        const c = ring.chunks[k];
        rt.viewport.set(0, k * B.R, BAKE_W, B.R); rt.scissor.copy(rt.viewport); rt.scissorTest = true;
        u.uOrigin.value.set(c.X * ring.s, c.Z * ring.s); u.uChunk.value = k;
        renderer.setRenderTarget(rt); bakeQuad.render(renderer);
      }
    }
    B.todo.length = 0;
    renderer.setRenderTarget(prev);
  };
  const applyQuality = () => {
    const G = Q.grassR || GRASS_FALLBACK;
    let prev = 0;
    rings.forEach((ring, k) => {
      const [rad, dens] = G[k] || [0, 0];
      ring.on = rad > prev && dens > 0;
      if (!ring.on) { for (const c of ring.chunks) { c.g.instanceCount = 0; c.m.visible = false; } ring.rad = 0; return; }
      ring.rad = rad; ring.s = rad / ((GRASS_K - 1) / 2);   // the window always covers `rad` around the camera
      ring.inA = prev ? prev * 0.55 : 0;
      ring.ru.uCellSize.value = ring.s; ring.ru.uR.value = rad; ring.ru.uDens.value = dens;
      ring.ru.uIn.value.set(ring.inA, prev);
      const n = Math.max(1, Math.round(dens * ring.s * ring.s));
      if (ring.bake && ring.bake.n !== n) makeBake(ring, n);
      for (const c of ring.chunks) { if (!ring.bake && n > c.cap) fill(c, n); c.g.instanceCount = n; c.X = NaN; }
      prev = rad;
    });
    updateGrassU(hf);
  };
  applyQuality();
  const E = O ? O.E - 8 : hf.HALF;
  const ground = (x, z) => Math.abs(x) <= hf.HALF && Math.abs(z) <= hf.HALF ? hf.heightAt(x, z) : O ? O.at(x, z) : hf.heightAt(x, z);
  scatters.push({
    update(cx, cz) {
      for (const ring of rings) {
        if (!ring.on) continue;
        const s = ring.s, K = GRASS_K, fx = Math.floor(cx / s - K / 2 + 0.5), fz = Math.floor(cz / s - K / 2 + 0.5);
        for (const c of ring.chunks) {
          const X = fx + (((c.i - fx) % K) + K) % K, Z = fz + (((c.j - fz) % K) + K) % K;
          const x0 = X * s, z0 = Z * s;
          if (X !== c.X || Z !== c.Z) { // the chunk moved to a new cell: place it and fit its bounds to the terrain there
            c.X = X; c.Z = Z;
            let y0 = 1e9, y1 = -1e9;
            for (let a = 0; a <= 4; a++) for (let b = 0; b <= 4; b++) { const h = ground(clamp(x0 + a * s / 4, -E, E), clamp(z0 + b * s / 4, -E, E)); y0 = Math.min(y0, h); y1 = Math.max(y1, h); }
            c.y0 = y0 - 1; c.y1 = y1 + 2.5;
            c.m.matrix.makeTranslation(x0, 0, z0); c.m.matrixWorld.copy(c.m.matrix);
            c.g.boundingSphere.center.set(s / 2, (c.y0 + c.y1) / 2, s / 2);
            c.g.boundingSphere.radius = Math.hypot(s / 2, s / 2, (c.y1 - c.y0) / 2);
            if (ring.bake) ring.bake.todo.push(c.i + c.j * K);
          }
          const nx = Math.max(x0 - cx, 0, cx - x0 - s), nz = Math.max(z0 - cz, 0, cz - z0 - s);
          const farX = Math.max(Math.abs(x0 - cx), Math.abs(x0 + s - cx)), farZ = Math.max(Math.abs(z0 - cz), Math.abs(z0 + s - cz));
          c.m.visible = nx * nx + nz * nz < ring.rad * ring.rad && farX * farX + farZ * farZ > ring.inA * ring.inA && x0 < E && x0 + s > -E && z0 < E && z0 + s > -E;
        }
        runBake(ring);
      }
    },
  });
  group.userData.applyQuality = applyQuality;
  scene.add(group);
  return group;
}
// writes one of GLSL_BLADE_STATIC's outputs for every blade of one chunk (rows of the ring's bake target; uOrigin: the
// chunk's cell)
function bakeMaterial(hf, gu, ru, card, out) {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false, defines: Object.assign({ BAKE_OUT: out }, card ? { GRASS_CARD: '' } : {}),
    uniforms: { ...gu, ...ru, ...hf.U, ...paintU, ...turfU, tNoise: S.tNoise, uOrigin: { value: new THREE.Vector2() }, uChunk: { value: 0 }, uN: { value: 0 } },
    vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: /* glsl */`
      uniform highp usampler2D tBladeIn; uniform int uBladeRows, uChunk, uN; uniform vec2 uOrigin;
      uniform sampler2D tMask, tMask2, tNoise;
      uniform float uCellSize, uLod, uWaterLv, uSnow, uShore, uReeds; uniform vec2 uCard; uniform vec4 uTurf0, uTurf1, uTurfStripe;
      ${GLSL_HEIGHT}
      ${GLSL_PAVE}
      ${GLSL_OUTER_HEIGHT}
      ${MEADOW_GLSL}
      ${GLSL_BLADE_STATIC}
      layout(location = 0) out highp vec4 oV;
      void main() {
        ivec2 p = ivec2(gl_FragCoord.xy);
        int i = (p.y - uChunk * uBladeRows) * ${BAKE_W} + p.x;
        oV = vec4(0.0);
        if (i >= uN) return;
        uvec2 bIn = texelFetch(tBladeIn, p, 0).xy;
        vec2 iOffset = vec2(float(bIn.x & 65535u), float(bIn.x >> 16u)) / 65535.0;
        vec4 iRand = vec4(float(bIn.y & 255u), float((bIn.y >> 8u) & 255u), float((bIn.y >> 16u) & 255u), float(bIn.y >> 24u)) / 255.0;
        vec4 a, b, c;
        bladeStatic(uOrigin + iOffset * uCellSize, iRand, a, b, c);
        oV = BAKE_OUT == 0 ? a : BAKE_OUT == 1 ? b : c;
      }`,
  });
}
function grassMaterial(hf, grassTex, gu, ru, card, baked) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, side: THREE.DoubleSide, alphaTest: card ? 0.5 : 0, alphaToCoverage: card && Q.msaa > 0 });
  mat.defines = card ? { CLOUD_SHADE_VARYING: '', GRASS_CARD: '' } : { CLOUD_SHADE_VARYING: '' };
  if (baked) mat.defines.GRASS_BAKED = '';
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, gu, ru, hf.U, paintU, turfU, { uGrassY: gu.uGrassY, tNoise: S.tNoise, tGrassD: { value: grassTex },
      uCam: S.uCam, uPlayer: S.uPlayer, uTime: S.uTime, uWind: S.uWind, uSunDir: S.uSunDir, uSunCol: S.uSunCol });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 bladeUV;
        #ifdef GRASS_BAKED
          uniform highp usampler2D tBladeIn; uniform highp sampler2D tBladeA, tBladeB, tBladeC; uniform int uBladeRows;
        #else
          attribute vec2 iOffset; attribute vec4 iRand;
        #endif
        uniform sampler2D tMask, tMask2, tNoise, tGrassD;
        uniform vec3 uCam, uPlayer; uniform float uTime, uCellSize, uR, uLod, uTuft, uWind, uWaterLv, uSnow, uShore, uReeds, uDens; uniform vec2 uIn, uCard;
        uniform vec4 uTurf0, uTurf1, uTurfStripe; uniform vec2 uGrassY;
        varying vec3 vGCol; varying vec3 vGTip; varying float vT; varying vec3 vGW; varying float vCloudLit;
        varying vec2 vCardUv; varying vec3 vFlCol; varying float vFl;
        ${GLSL_HEIGHT}
        ${GLSL_PAVE}
        ${GLSL_OUTER_HEIGHT}
        ${CLOUD_SHADE_GLSL}
        ${MEADOW_GLSL}
        #ifndef GRASS_BAKED
          ${GLSL_BLADE_STATIC}
        #endif`)
      .replace('#include <beginnormal_vertex>', /* glsl */`
        #ifdef GRASS_BAKED
          // this blade's texels in the ring's baked data: the chunk follows from its cell (cell index mod K), the blade
          // from the instance
          ivec2 bTx;
          { vec2 cell = floor(modelMatrix[3].xz / uCellSize + 0.5), ij = cell - ${GRASS_K}.0 * floor(cell / ${GRASS_K}.0);
            int ch = int(ij.y) * ${GRASS_K} + int(ij.x);
            bTx = ivec2(gl_InstanceID % ${BAKE_W}, ch * uBladeRows + gl_InstanceID / ${BAKE_W}); }
          uvec2 bIn = texelFetch(tBladeIn, bTx, 0).xy;
          vec2 iOffset = vec2(float(bIn.x & 65535u), float(bIn.x >> 16u)) / 65535.0;
          vec4 iRand = vec4(float(bIn.y & 255u), float((bIn.y >> 8u) & 255u), float((bIn.y >> 16u) & 255u), float(bIn.y >> 24u)) / 255.0;
        #endif
        vec2 wp2 = modelMatrix[3].xz + iOffset * uCellSize;   // cell origin (the chunk's translation) + position in the cell
        float gdist = length(wp2 - uCam.xz);
        // ring cross-fade: blades thin out stochastically (so near and far rings keep the same blade height). Blades that
        // are faded out, or outside the grass area, leave before any texture is read
        float fade = (1.0 - smoothstep(uR * 0.55, uR, gdist)) * (uIn.y > 0.0 ? smoothstep(uIn.x, uIn.y, gdist) : 1.0);
        if (abs(wp2.x) > uGrassE || abs(wp2.y) > uGrassE || fract(iRand.y * 13.73 + iRand.x * 5.31) > fade * 1.02) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
        { // outside the view to the left or right (a chunk is culled whole, but the far rings' chunks are hundreds of metres
          // wide): leave before the texture reads. The tuft is tested as a vertical span from the lowest to the highest
          // ground in the map, padded by its reach (the widest card plus its lean), so nothing that could show is dropped.
          vec4 cA = projectionMatrix * viewMatrix * vec4(wp2.x, uGrassY.x, wp2.y, 1.0), cB = projectionMatrix * viewMatrix * vec4(wp2.x, uGrassY.y, wp2.y, 1.0);
          float pad = 12.0 * projectionMatrix[0][0];
          if ((cA.x - pad > cA.w && cB.x - pad > cB.w) || (cA.x + pad < -cA.w && cB.x + pad < -cB.w) || (cA.w < -12.0 && cB.w < -12.0)) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
        }
        vec4 bA, bB, bC;
        #ifdef GRASS_BAKED
          bC = texelFetch(tBladeC, bTx, 0);
          if (bC.w < 0.5) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
          bA = texelFetch(tBladeA, bTx, 0); bB = texelFetch(tBladeB, bTx, 0);
        #else
          bladeStatic(wp2, iRand, bA, bB, bC);
          if (bC.w < 0.5) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
        #endif
        float code = bC.w;
        bool rice = mod(code, 4.0) >= 2.0, reed = mod(code, 8.0) >= 4.0, turf = mod(code, 16.0) >= 8.0;
        float spc = mod(floor(code / 16.0), 4.0), fcat = mod(floor(code / 64.0), 8.0);
        if (rice) { wp2 = (floor(wp2 / vec2(0.32, 0.26)) + 0.5) * vec2(0.32, 0.26) + (iRand.zx - 0.5) * 0.05; gdist = length(wp2 - uCam.xz); } // transplanted rows
        float gh = bA.x; vec3 gN = bA.yzw;
        float dens = bC.y, flD = bC.z, keep = 1.0, gs = 1.0, hw = gh - uWaterLv;
        float flR = iRand.w + fract(iRand.z * 61.7 + iRand.x * 13.1) / 255.0;
        bool flower = !rice && !reed && dens > 0.35 && flR < flD / uDens * smoothstep(22.0, 30.0, gdist);
        if (turf) flower = false;
        bool plain = !rice && !reed && !flower && !turf;
        bool seedG = plain && spc == 1.0, dryB = plain && spc == 2.0, broadB = plain && spc == 3.0;
        float Hh = bB.w * mix(0.75, 1.0, fade);
        if (seedG) Hh = Hh * 1.3 + 0.22 * keep;
        if (broadB) Hh *= 0.42;
        if (flower) Hh = (0.28 + 0.32 * iRand.y) * mix(0.4, 1.0, fade);
        if (rice) Hh = (0.38 + 0.22 * iRand.y) * fade;
        if (reed) Hh = (1.0 + 1.1 * iRand.y * iRand.y + max(-hw, 0.0)) * mix(0.3, 1.0, fade);
        if (turf) Hh = (0.045 + 0.035 * iRand.y) * mix(0.6, 1.0, fade) * keep;
        float Wd = (0.02 + 0.022 * iRand.z) * (1.0 + gdist * 0.06) * uTuft * step(0.001, gs);   // far rings: wider tufts
        if (turf) Wd *= 0.6;
        if (rice) Wd *= 0.8;
        if (reed) Wd *= 0.75;
        if (seedG) Wd *= 0.75;
        if (broadB) Wd *= 2.8;
        float ang = iRand.x * 6.2831853;
        vec2 bdir = vec2(cos(ang), sin(ang)), bside = vec2(-bdir.y, bdir.x);
        #ifdef GRASS_CARD
          // clump cards turn to face the camera and grow a little toward the far edge of their ring
          vec2 toCam = uCam.xz - wp2; bdir = toCam / (length(toCam) + 1e-3); bside = vec2(-bdir.y, bdir.x);
          Wd = uCard.x * (0.75 + 0.5 * iRand.z) * (0.8 + 0.45 * smoothstep(uIn.y, uR, gdist)) * step(0.001, gs);
          Hh = bB.w * mix(0.75, 1.0, fade);
          flower = false;
        #endif
        Hh *= bC.x;
        float t = bladeUV.y;
        vec2 windDir = normalize(vec2(1.0, 0.35));
        float gust = textureLod(tNoise, wp2 * 0.012 - windDir * uTime * 0.05, 0.0).r;
        float flutter = sin(uTime * (2.2 + iRand.z * 2.5) + iRand.x * 40.0 + dot(wp2, windDir) * 0.8);
        // gusts travel across the meadow as rolling waves
        float roll = sin(dot(wp2, windDir) * 0.32 - uTime * 2.1 + gust * 4.0) * 0.5 + 0.5;
        vec2 lean = bdir * (rice ? 0.35 + iRand.z * 0.3 : reed ? 0.04 + iRand.z * 0.14 : broadB ? 0.7 + iRand.z * 0.4 : 0.12 + iRand.z * 0.4)
          + windDir * (gust * gust * 1.5 + 0.12) * (0.65 + 0.7 * roll) * uWind * (rice ? 0.6 : reed ? 0.35 : broadB ? 0.3 : seedG ? 1.25 : 1.0) + bside * flutter * 0.1 * uWind;
        #ifdef GRASS_CARD
          lean = windDir * (gust * gust * 1.2 + 0.1) * uWind * 0.45;
        #endif
        // turf: the blades lie the way the mower last passed, alternate bands in opposite directions
        float stripe = turf ? step(0.5, fract((wp2.x - uTurfStripe.y) / uTurfStripe.z * 0.5)) : 0.0;
        if (turf) lean = vec2(0.0, stripe > 0.5 ? 0.5 : -0.5) + bside * flutter * 0.03 * uWind;
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
          vFlCol = fcat < 0.5 ? vec3(1.0, 0.95, 0.86) : fcat < 1.5 ? vec3(1.0, 0.72, 0.06) : fcat < 2.5 ? vec3(1.0, 0.36, 0.55) : fcat < 3.5 ? vec3(0.42, 0.3, 1.0) : vec3(1.0, 0.3, 0.12);
          vFl = code >= 512.0 ? 1.0 : 0.0;
        #else
          float prof = flower ? 0.5 + smoothstep(0.55, 0.85, t) * 3.5      // flowers open into a blossom
            : seedG ? (t < 0.66 ? 0.6 - 0.25 * t : 0.35 + 1.5 * sin((t - 0.66) / 0.34 * 3.1416))   // thin stem, spindle seed head
            : broadB ? 0.7 + 0.6 * sin(t * 3.1416) - 0.3 * t                    // broad rounded leaf
            : 1.0 - t * 0.6;
          gp.xz += bside * bladeUV.x * Wd * 0.5 * prof;
        #endif
        vGW = gp; vT = t; vCloudLit = cloudShade(gp);
        vec3 bn = normalize(vec3(bdir.x, 0.0, bdir.y) + vec3(0.0, 0.4 + t, 0.0) - vec3(lean.x, 0.0, lean.y) * 0.3);
        vec3 objectNormal = normalize(mix(bn, gN, 0.82) + vec3(bside.x, 0.0, bside.y) * bladeUV.x * 0.08);
        // the blade takes the painted colour of the ground it grows from (baked); tips are lighter and warmer
        vec3 c = bB.rgb;
        vec3 tip = rice ? c * 1.2 : turf ? c * (stripe > 0.5 ? 1.12 : 1.3) : reed ? c * 1.15 : mix(c, uP_gLight, 0.45) * 1.12 + vec3(0.03, 0.03, 0.0);
        if (dryB) { c = mix(c, vec3(0.55, 0.5, 0.26), 0.65); tip = mix(tip, vec3(0.9, 0.8, 0.5), 0.75); }
        if (broadB) { c *= vec3(0.78, 0.86, 0.74); tip = c * 1.2; }
        if (seedG) { float head = smoothstep(0.62, 0.72, t); tip = mix(tip, mix(vec3(0.7, 0.58, 0.34), vec3(0.56, 0.4, 0.34), step(0.5, fract(iRand.z * 9.1))), head); c = mix(c, tip * 0.8, head); }
        // bright bands where the gusts roll across the meadow (the rolling wave lays the blades over and shows their
        // lighter undersides)
        float wave = smoothstep(0.52, 0.85, gust) * (0.6 + 0.5 * roll);
        if (!rice && !turf && !reed) tip += vec3(0.07, 0.09, 0.02) * wave;
        if (reed && iRand.x > 0.9 && t > 0.84) c = tip = vec3(0.22, 0.12, 0.06);   // bulrush heads
        if (flower) {
          vec3 fc = fcat < 0.5 ? vec3(1.0, 0.95, 0.86) : fcat < 1.5 ? vec3(1.0, 0.72, 0.06) : fcat < 2.5 ? vec3(1.0, 0.36, 0.55)
                  : fcat < 3.5 ? vec3(0.42, 0.3, 1.0) : vec3(1.0, 0.3, 0.12);
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
          if (tc.b > 0.5) diffuseColor.rgb = mix(vec3(0.7, 0.58, 0.34), vec3(0.56, 0.4, 0.34), step(0.5, fract(vCardUv.x * 3.1))) * (0.8 + 0.3 * tc.r);
        #else
          diffuseColor.rgb *= mix(vGCol * 0.62, vGTip, smoothstep(0.0, 1.0, vT));
        #endif`)
      .replace('#include <normal_fragment_begin>', 'float faceDirection = 1.0; vec3 normal = normalize(vNormal); vec3 nonPerturbedNormal = normal;')
      .replace('#include <emissivemap_fragment>', `
        vec3 gV = normalize(vGW - cameraPosition);
        float gTr = pow(max(dot(gV, uSunDir), 1e-4), 4.0) * vT;
        totalEmissiveRadiance += vGTip * uSunCol * (gTr * 0.22 + 0.02 * vT) * vCloudLit;`);
  };
  mat.customProgramCacheKey = () => card ? 'grassCard' : baked ? 'grassBaked' : 'grass';
  mat.userData.drawClass = 2;
  return mat;
}

// ---------------------------------------------------------------- water with planar reflection
// painted water: turquoise shallows deepening to blue, a soft sky sheen, crisp white foam lines at the shore, sun sparkles
export function buildWater(hf, { level = 0, normals, hide = [], deep = '#15508e', mid = '#2398be', shallow = '#52d6c4', waves = 4.0, strength = 0.4, active = () => true } = {}) {
  const mirrorCam = new THREE.PerspectiveCamera();
  mirrorCam.layers.set(0); // objects moved to layer 1 are not reflected (cheap reflection pass)
  const textureMatrix = new THREE.Matrix4();
  const reflDepth = new THREE.DepthTexture(512, 512); reflDepth.type = THREE.FloatType; // 32F: pairs with reversed-Z
  const reflRT = new THREE.WebGLRenderTarget(512, 512, { type: THREE.HalfFloatType, depthTexture: reflDepth });
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
  water.position.y = level; water.renderOrder = 2; water.userData.dynamic = true; // follows the camera
  const _vpm = new THREE.Matrix4(), _fr = new THREE.Frustum(), _cp = new THREE.Vector4(), _crop = new THREE.Matrix4(), hideVis = [];
  // occlusion queries round the draws of the water and of every pond surface linked to its reflection (watchVisibility)
  const occl = (() => {
    const gl = renderer.getContext(), Q = gl.ANY_SAMPLES_PASSED_CONSERVATIVE, pool = [], open = [], last = [];
    let active = null, fr = 0, lastFrame = -2, known = false, visible = true;
    const poll = () => { // results of earlier frames, oldest first; a frame's answer is known when all its queries are
      while (open.length && gl.getQueryParameter(open[0].q, gl.QUERY_RESULT_AVAILABLE)) {
        const e = open.shift(); if (e.f !== lastFrame) { if (lastFrame >= 0) { visible = last.some(Boolean); known = true; } last.length = 0; lastFrame = e.f; }
        last.push(gl.getQueryParameter(e.q, gl.QUERY_RESULT)); pool.push(e.q);
      }
    };
    return {
      skipped: 0, tick() { fr++; },
      hidden() { poll(); return known && !visible; },
      begin() { if (active) return; const q = pool.pop() || gl.createQuery(); gl.beginQuery(Q, q); active = { q, f: fr }; },
      end() { if (!active) return; gl.endQuery(Q); open.push(active); active = null; },
    };
  })();
  const watch = m => { const b0 = m.onBeforeRender, a0 = m.onAfterRender;
    m.onBeforeRender = function (r, s, c, g, mt, gr) { if (c.isPerspectiveCamera && c !== mirrorCam && r.getRenderTarget() !== reflRT) occl.begin(); b0.call(this, r, s, c, g, mt, gr); };
    m.onAfterRender = function (r, s, c, g, mt, gr) { a0.call(this, r, s, c, g, mt, gr); occl.end(); }; };
  const mirrorPlane = new THREE.Plane(), normal = new THREE.Vector3(0, 1, 0), mirrorPos = new THREE.Vector3(), camPos = new THREE.Vector3(),
    rot = new THREE.Matrix4(), look = new THREE.Vector3(), clipPlane = new THREE.Vector4(), view = new THREE.Vector3(), target = new THREE.Vector3(), q = new THREE.Vector4();
  // The mirror pass runs as its own top-level render just before the scene pass (post.beforeScene), not from inside the
  // scene render: a nested render has its own light state, and every material drawn in both passes would otherwise look
  // its shader program up again twice a frame
  const renderReflection = (r, sc, cam, force = false) => {
    if (!water.visible && !force) return;
    water.updateMatrixWorld();
    mirrorPos.setFromMatrixPosition(water.matrixWorld); camPos.setFromMatrixPosition(cam.matrixWorld);
    view.subVectors(mirrorPos, camPos);
    if (!force && (view.dot(normal) > 0 || !active(camPos))) return;
    // hidden water: every surface that samples the reflection carries an occlusion query in the scene pass; when none of
    // them drew a single sample last frame (behind buildings or the terrain), the mirror image is not needed. It is
    // still refreshed every few frames, so the frame a surface comes into view never shows an old image for long.
    occl.tick();
    if (!force && occl.hidden() && ++occl.skipped < 6) return;
    occl.skipped = 0;
    // no water surface in view: the mirror image would never be sampled (userData.regions: boxes round every surface
    // that samples this reflection — the river channel, ponds, fountains; unset = always render)
    // The mirror pass is also cropped to the part of the screen those surfaces cover, plus a margin for the ripple
    // distortion: it culls against that smaller frustum and draws only
    // that rectangle of the reflection target; the rest of the target is never sampled.
    const R = water.userData.regions;
    let x0 = -1, x1 = 1, y0 = -1, y1 = 1;
    if (!force && R) {
      _vpm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); _fr.setFromProjectionMatrix(_vpm);
      let any = false, full = false; x0 = y0 = 1e9; x1 = y1 = -1e9;
      for (const b of R) {
        if (!_fr.intersectsBox(b)) continue;
        any = true;
        for (let k = 0; k < 8 && !full; k++) { // (a pond's mirrored lookup lands on its own screen position: its box is enough)
          const cy = k & 2 ? b.max.y : b.min.y;
          _cp.set(k & 1 ? b.max.x : b.min.x, cy, k & 4 ? b.max.z : b.min.z, 1).applyMatrix4(_vpm);
          if (_cp.w < 0.05) { full = true; break; }
          const px = _cp.x / _cp.w, py = _cp.y / _cp.w;
          x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
        }
        if (full) break;
      }
      if (!any) return;
      if (full) { x0 = y0 = -1; x1 = y1 = 1; }
      else { x0 = Math.max(-1, x0 - 0.25); x1 = Math.min(1, x1 + 0.25); y0 = Math.max(-1, y0 - 0.25); y1 = Math.min(1, y1 + 0.25); }
      if (x1 <= x0 || y1 <= y0) return;
    }
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
    if (x0 > -1 || x1 < 1 || y0 > -1 || y1 < 1) { // crop: the rectangle's frustum drawn into the same rectangle of the target
      const sx = 2 / (x1 - x0), sy = 2 / (y1 - y0);
      _crop.set(sx, 0, 0, -(x0 + x1) / (x1 - x0), 0, sy, 0, -(y0 + y1) / (y1 - y0), 0, 0, 1, 0, 0, 0, 0, 1);
      mirrorCam.projectionMatrix.premultiply(_crop);
    }
    const W = reflRT.width, H = reflRT.height, vx = Math.floor((x0 + 1) / 2 * W), vy = Math.floor((y0 + 1) / 2 * H);
    reflRT.viewport.set(vx, vy, Math.ceil((x1 + 1) / 2 * W) - vx, Math.ceil((y1 + 1) / 2 * H) - vy); reflRT.scissor.copy(reflRT.viewport); reflRT.scissorTest = true;
    mirrorPlane.setFromNormalAndCoplanarPoint(normal, mirrorPos).applyMatrix4(mirrorCam.matrixWorldInverse);
    clipPlane.set(mirrorPlane.normal.x, mirrorPlane.normal.y, mirrorPlane.normal.z, mirrorPlane.constant);
    const pm = mirrorCam.projectionMatrix.elements;
    q.x = (Math.sign(clipPlane.x) + pm[8]) / pm[0]; q.y = (Math.sign(clipPlane.y) + pm[9]) / pm[5]; q.z = -1; q.w = (1 + pm[10]) / pm[14];
    clipPlane.multiplyScalar(2 / clipPlane.dot(q));
    pm[2] = clipPlane.x; pm[6] = clipPlane.y; pm[10] = clipPlane.z + 1 - 0.003; pm[14] = clipPlane.w;
    mirrorCam.projectionMatrixInverse.copy(mirrorCam.projectionMatrix).invert();
    const prevRT = r.getRenderTarget(), prevShadow = r.shadowMap.autoUpdate;
    for (let i = 0; i < hide.length; i++) { hideVis[i] = hide[i].visible; hide[i].visible = false; }
    water.visible = false;
    r.shadowMap.autoUpdate = false;
    perf.push(P_REFL);
    r.setRenderTarget(reflRT); r.state.buffers.depth.setMask(true); r.clear();
    r.render(sc, mirrorCam);
    perf.pop();
    water.visible = true; for (let i = 0; i < hide.length; i++) hide[i].visible = hideVis[i];
    r.shadowMap.autoUpdate = prevShadow; r.setRenderTarget(prevRT);
  };
  post.beforeScene.push(renderReflection);
  water.userData.renderReflection = renderReflection; // (forced once at load by the warm-up, main.js)
  watch(water); water.userData.watchVisibility = watch; // (maps add their ponds and fountains)
  water.userData.resize = () => { const rw = Math.max(256, Math.round(Math.min(innerWidth, 1920) * Q.refl)); reflRT.setSize(rw, Math.round(rw * innerHeight / innerWidth)); };
  water.userData.resize(); onResize(water.userData.resize);
  water.userData.hide = hide;
  scene.add(water);
  return water;
}

// ---------------------------------------------------------------- still water: ponds, the lake, fountain basins
// Water standing in a dug basin (or a built one). Its mirror image is the river's: that pass renders sky, clouds and
// hills for the plane y = 0 (buildWater), and a higher surface finds its reflection in the same texture at the point
// mirrored through that plane — right for everything far away, which is all that pass draws. Three drifting normal
// layers ripple it; Fresnel blends that image over a body whose colour, clarity and opacity follow the real depth to the
// ground under it (or a fixed depth for built basins, fixedDepth); the vertex colour tints the body; the sun or moon
// glitters on the ripples; a pale lapping line runs where it meets the bank.
export function pondWaterMaterial(hf, normals, { deep = '#173f49', mid = '#2b6a6a', shallow = '#7aa383', fixedDepth = 0 } = {}) {
  const mat = new THREE.ShaderMaterial({
    transparent: true, fog: true, depthWrite: true, vertexColors: true,
    defines: fixedDepth > 0 ? { FIXED_DEPTH: fixedDepth.toFixed(3) } : {},
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { tRefl: { value: null }, tNormal: { value: null }, textureMatrix: { value: new THREE.Matrix4() }, uReflOn: { value: 0 },
      uDeep: { value: new THREE.Color(deep) }, uMid: { value: new THREE.Color(mid) }, uShallow: { value: new THREE.Color(shallow) } }]),
    vertexShader: /* glsl */`
      uniform mat4 textureMatrix; varying vec4 vMirror; varying vec3 vW; varying vec3 vTint;
      #include <common>
      #include <fog_pars_vertex>
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; vTint = color;
        vMirror = textureMatrix * vec4(wp.x, -wp.y, wp.z, 1.0);
        vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tRefl, tNormal; uniform float uTime, uReflOn; uniform vec3 uLightDir, uSunCol, uAmb, uDeep, uMid, uShallow;
      varying vec4 vMirror; varying vec3 vW; varying vec3 vTint;
      #include <common>
      #include <fog_pars_fragment>
      ${GLSL_HEIGHT}
      void main(){
        vec3 eyeVec = cameraPosition - vW; float dist = length(eyeVec); vec3 eyeDir = eyeVec / dist;
        vec2 p = vW.xz;
        vec3 n1 = texture2D(tNormal, p * 0.19 + vec2(uTime * 0.011, uTime * 0.007)).rgb * 2.0 - 1.0;
        vec3 n2 = texture2D(tNormal, p * 0.47 - vec2(uTime * 0.017, -uTime * 0.013)).rgb * 2.0 - 1.0;
        vec3 n3 = texture2D(tNormal, p * 1.6 + vec2(-uTime * 0.031, uTime * 0.024)).rgb * 2.0 - 1.0;
        vec2 slope = (n1.xy * 0.5 + n2.xy * 0.35 + n3.xy * 0.22) * 0.2 * (1.0 - smoothstep(25.0, 260.0, dist) * 0.7);
        vec3 sn = normalize(vec3(slope.x, 1.0, slope.y));
      #ifdef FIXED_DEPTH
        float depth = FIXED_DEPTH;
      #else
        float depth = max(0.0, vW.y - hAt(p));
      #endif
        vec3 R = reflect(-eyeDir, sn);
        vec3 sky = mix(uAmb * 1.5 + 0.04, uAmb * 0.85 + vec3(0.02, 0.05, 0.12), clamp(R.y * 1.6, 0.0, 1.0));
        vec3 refl = sky;
        if (uReflOn > 0.5) { vec2 ruv = vMirror.xy / vMirror.w + sn.xz * 0.05;
          float inR = step(0.001, ruv.x) * step(ruv.x, 0.999) * step(0.001, ruv.y) * step(ruv.y, 0.999); refl = mix(sky, texture2D(tRefl, ruv).rgb, inR); }
        float cosT = max(dot(eyeDir, sn), 0.0), fres = 0.025 + 0.975 * pow(1.0 - cosT, 5.0);
        float dd = 1.0 - exp(-depth * 1.7);
        vec3 body = mix(uShallow, uMid, smoothstep(0.0, 0.55, dd)); body = mix(body, uDeep, smoothstep(0.45, 1.0, dd));
        body *= vTint * (uAmb * 0.85 + uSunCol * max(uLightDir.y, 0.0) * 0.32 + 0.03);
        vec3 hv = normalize(uLightDir + eyeDir); float sp = pow(max(dot(sn, hv), 0.0), 260.0);
        float glint = smoothstep(0.9975, 0.9992, max(dot(sn, hv), 0.0)) * (0.5 + 0.5 * sin(uTime * 6.0 + p.x * 4.1 + p.y * 3.3));
        vec3 spec = uSunCol * (sp * 2.2 + glint * 1.6) * step(0.0, uLightDir.y);
        vec3 col = mix(body, refl, clamp(fres * 0.9 + 0.1, 0.0, 1.0)) + spec;
        float alpha = clamp(0.12 + dd * 0.92, 0.0, 0.94); alpha = max(alpha, fres * 0.92);
      #ifndef FIXED_DEPTH
        float lap = 1.0 - smoothstep(0.0, 0.045 + 0.025 * sin(uTime * 0.9 + p.x * 1.3 + p.y * 0.7), depth);
        col = mix(col, vec3(0.92, 0.94, 0.9) * (uAmb * 0.9 + uSunCol * max(uLightDir.y, 0.0) * 0.3 + 0.05), lap * 0.4);
        alpha = mix(alpha, 0.55, lap * 0.5);
      #endif
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  Object.assign(mat.uniforms, hf.U, { uTime: S.uTime, uLightDir: S.uLightDir, uSunCol: S.uSunCol, uAmb: S.uAmb });
  mat.uniforms.tNormal.value = normals;
  // take the river's mirror image once it exists
  mat.userData.linkReflection = water => { mat.uniforms.tRefl.value = water.material.uniforms.tRefl.value; mat.uniforms.textureMatrix.value = water.material.uniforms.textureMatrix.value; mat.uniforms.uReflOn.value = 1; };
  return mat;
}

// running water on built features (a fountain's jets, spouts and falling sheets): streaks drift along the flow (uv.y
// runs with the water, uv.x across it), bright where the water breaks white, clear between; lit by the day and, at
// night, by the fixture lights under it (uGlow)
export function flowWaterMaterial() {
  const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uGlow: { value: 0 }, uSpeed: { value: 1.6 } }]),
    vertexShader: /* glsl */`varying vec2 vUv; varying vec3 vW;
      #include <common>
      #include <fog_pars_vertex>
      void main(){ vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`uniform sampler2D tNoise; uniform float uTime, uGlow, uSpeed; uniform vec3 uLightDir, uSunCol, uAmb;
      varying vec2 vUv; varying vec3 vW;
      #include <common>
      #include <fog_pars_fragment>
      void main(){
        float s1 = texture2D(tNoise, vec2(vUv.x * 2.3, vUv.y * 0.7 - uTime * uSpeed * 0.9)).g;
        float s2 = texture2D(tNoise, vec2(vUv.x * 5.1 + 0.37, vUv.y * 1.9 - uTime * uSpeed * 1.4)).b;
        float streak = smoothstep(0.38, 0.82, s1 * 0.6 + s2 * 0.55);
        vec3 eye = normalize(cameraPosition - vW);
        vec3 lit = uAmb * 1.05 + uSunCol * max(uLightDir.y, 0.0) * 0.5 + 0.05 + vec3(0.9, 0.95, 1.0) * uGlow;
        vec3 col = mix(vec3(0.6, 0.8, 0.88), vec3(0.97, 0.99, 1.0), streak) * lit;
        float alpha = 0.26 + streak * 0.5;
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }` });
  Object.assign(mat.uniforms, { tNoise: S.tNoise, uTime: S.uTime, uLightDir: S.uLightDir, uSunCol: S.uSunCol, uAmb: S.uAmb });
  return mat;
}
// white water where falling water hits a surface: a churning ring (uv 0..1 across the patch), flickering
export function foamMaterial() {
  const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, fog: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uGlow: { value: 0 } }]),
    vertexShader: /* glsl */`varying vec2 vUv; varying vec3 vW;
      #include <common>
      #include <fog_pars_vertex>
      void main(){ vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`uniform sampler2D tNoise; uniform float uTime, uGlow; uniform vec3 uLightDir, uSunCol, uAmb;
      varying vec2 vUv; varying vec3 vW;
      #include <common>
      #include <fog_pars_fragment>
      void main(){
        vec2 q = vUv * 2.0 - 1.0; float d = length(q), a = atan(q.y, q.x);
        float n = texture2D(tNoise, vec2(a * 0.5 + uTime * 0.07, d * 0.9 - uTime * 0.6) + vW.xz * 0.05).g;
        float n2 = texture2D(tNoise, vW.xz * 0.9 + vec2(uTime * 0.21, -uTime * 0.17)).b;
        float ring = smoothstep(1.0, 0.55, d) * smoothstep(0.0, 0.25, d + 0.1);
        float f = ring * smoothstep(0.35, 0.75, n * 0.7 + n2 * 0.5);
        vec3 lit = uAmb * 1.1 + uSunCol * max(uLightDir.y, 0.0) * 0.5 + 0.06 + vec3(0.9, 0.95, 1.0) * uGlow;
        gl_FragColor = vec4(vec3(0.96, 0.98, 1.0) * lit, f * 0.85);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }` });
  Object.assign(mat.uniforms, { tNoise: S.tNoise, uTime: S.uTime, uLightDir: S.uLightDir, uSunCol: S.uSunCol, uAmb: S.uAmb });
  return mat;
}

// ---------------------------------------------------------------- streams
// A flowing stream surface: a ribbon along the stream's centreline (pts: [{x, z, w: water level, W: width}]), with
// streaks drifting downstream, white water where it runs steep, and a sun glint. The terrain carries the channel.
export function buildStream(pts) {
  const P = [], UV = [], F = [], I = [];
  let v = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], p = pts[i];
    const tx = b.x - a.x, tz = b.z - a.z, L = Math.hypot(tx, tz) || 1, nx = -tz / L, nz = tx / L, hw = p.W / 2 + 0.8;
    if (i) v += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z);
    const steep = clamp((a.w - b.w) / Math.max(L, 1) * 6, 0, 1);
    P.push(p.x - nx * hw, p.w, p.z - nz * hw, p.x + nx * hw, p.w, p.z + nz * hw);
    UV.push(0, v, 1, v); F.push(steep, steep);
    if (i) { const k = (i - 1) * 2; I.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); } // counter-clockwise from above
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setAttribute('aSteep', new THREE.Float32BufferAttribute(F, 1));
  g.setIndex(I); g.computeBoundingSphere();
  const mat = new THREE.ShaderMaterial({
    transparent: true, fog: true, depthWrite: false,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
    vertexShader: /* glsl */`
      attribute float aSteep; varying vec2 vUv; varying float vSteep; varying vec3 vW;
      #include <common>
      #include <fog_pars_vertex>
      void main(){ vUv = uv; vSteep = aSteep; vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz;
        vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tNoise; uniform float uTime; uniform vec3 uLightDir, uSunCol, uAmb;
      varying vec2 vUv; varying float vSteep; varying vec3 vW;
      #include <common>
      #include <fog_pars_fragment>
      void main(){
        float edge = smoothstep(0.0, 0.16, vUv.x) * smoothstep(1.0, 0.84, vUv.x);
        float flow = uTime * (0.6 + 1.6 * vSteep);
        vec4 n1 = texture2D(tNoise, vec2(vUv.x * 0.35, vUv.y * 0.045 - flow * 0.05));
        vec4 n2 = texture2D(tNoise, vec2(vUv.x * 0.9 + 0.3, vUv.y * 0.11 - flow * 0.12));
        float streak = smoothstep(0.55, 0.8, n1.g * 0.6 + n2.b * 0.5);
        vec3 deep = vec3(0.05, 0.25, 0.31), shallow = vec3(0.18, 0.5, 0.5);
        vec3 col = mix(shallow, deep, edge * 0.8) * (uAmb * 0.8 + uSunCol * max(uLightDir.y, 0.0) * 0.3 + 0.05);
        col += vec3(0.85, 0.95, 1.0) * (uAmb * 0.25 + uSunCol * 0.12) * streak * (0.25 + 0.5 * vSteep);
        float foam = smoothstep(0.55, 0.85, n2.r * 0.6 + vSteep * 0.7 + (1.0 - edge) * 0.12) * (0.15 + vSteep);
        col = mix(col, vec3(0.95, 0.98, 1.0) * (uAmb * 0.8 + uSunCol * max(uLightDir.y, 0.0) * 0.35 + 0.06), clamp(foam, 0.0, 0.9));
        vec3 V = normalize(cameraPosition - vW), N = normalize(vec3((n2.g - 0.5) * 0.4, 1.0, (n1.b - 0.5) * 0.4));
        col += uSunCol * pow(max(dot(reflect(-uLightDir, N), V), 1e-4), 60.0) * 0.5 * step(0.0, uLightDir.y);
        col = mix(col, uAmb * 1.05, pow(1.0 - max(dot(V, N), 0.0), 3.0) * 0.45); // sky sheen at grazing angles
        gl_FragColor = vec4(col, (0.55 + 0.35 * edge) * smoothstep(0.0, 0.05, vUv.x) * smoothstep(1.0, 0.95, vUv.x));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  Object.assign(mat.uniforms, { tNoise: S.tNoise, uTime: S.uTime, uLightDir: S.uLightDir, uSunCol: S.uSunCol, uAmb: S.uAmb });
  const m = new THREE.Mesh(g, mat); m.renderOrder = 2;
  scene.add(m);
  return m;
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
