// Forest ecology shared by both maps: where trees stand, which species and growth forms, how old, how close together,
// and what grows and lies on the forest floor. Everything is driven by the terrain and a few painted fields:
//   forest   0..1 forest cover (the map's own mask, with its glades and stream banks)
//   moist    0..1 ground moisture (lake shore, streams, hollows)
// plus altitude, slope, forest-edge distance (blurred cover), a slow "stand age" field and local clustering noise.
// That gives recognisable stands the player walks through: old conifer forest with long bare trunks and wide spacing,
// dense young regrowth, mixed woodland on the damp lowlands, ragged edges with birches and saplings, sparse rocky
// woodland of pines and dead snags up high — and a meadow fringe of lone trees and groves.
import { THREE, clamp, lerp, smoothstep, mulberry32, fbm } from './core.js';
import { coniferColor, broadColor, deadColor, barkColor, sakuraColor, bushColor } from './trees.js';

// crown radius per metre of height (the widest tier / blob), used for spacing and canopy shade
export const CROWN = { young: 0.36, spruce: 0.28, tall: 0.19, old: 0.3, pine: 0.19, jpine: 0.3, sapling: 0.34, snag: 0.06, broken: 0.07,
  leaf: 0.36, oak: 0.48, birch: 0.2, zelkova: 0.5, maple: 0.46, willow: 0.42, sakura: 0.52, bamboo: 0.16 };
export const crownR = t => (CROWN[t.kind] ?? 0.3) * t.s * (t.sx || 1);

// separable running-sum box blur on an N x N grid (radius r cells)
export function boxBlur(src, N, r) {
  const tmp = new Float32Array(N * N), out = new Float32Array(N * N), w = 2 * r + 1;
  for (let j = 0; j < N; j++) {
    const row = j * N; let acc = 0;
    for (let i = -r; i <= r; i++) acc += src[row + clamp(i, 0, N - 1)];
    for (let i = 0; i < N; i++) { tmp[row + i] = acc / w; acc += src[row + Math.min(i + r + 1, N - 1)] - src[row + Math.max(i - r, 0)]; }
  }
  for (let i = 0; i < N; i++) {
    let acc = 0;
    for (let j = -r; j <= r; j++) acc += tmp[clamp(j, 0, N - 1) * N + i];
    for (let j = 0; j < N; j++) { out[j * N + i] = acc / w; acc += tmp[Math.min(j + r + 1, N - 1) * N + i] - tmp[Math.max(j - r, 0) * N + i]; }
  }
  return out;
}

// spatial hash of placed trees (spacing tests)
export class TreeHash {
  constructor(cell = 10) { this.cell = cell; this.map = new Map(); }
  key(i, j) { return i * 73856093 ^ j * 19349663; }
  add(t) { const k = this.key(Math.floor(t.x / this.cell), Math.floor(t.z / this.cell)); let l = this.map.get(k); if (!l) this.map.set(k, l = []); l.push(t); }
  each(x, z, R, fn) {
    const c = this.cell, i0 = Math.floor((x - R) / c), i1 = Math.floor((x + R) / c), j0 = Math.floor((z - R) / c), j1 = Math.floor((z + R) / c);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const l = this.map.get(this.key(i, j)); if (l) for (const t of l) if (fn(t) === false) return false; }
    return true;
  }
  // true if a tree of crown radius cr fits at (x, z) with spacing factor k
  fits(x, z, cr, k, trunkMin = 0) {
    return this.each(x, z, cr + 14, o => { const d = Math.hypot(o.x - x, o.z - z); if (d < k * (cr + o.cr) || d < trunkMin + (o.tr || 0)) return false; });
  }
}

const pickW = (w, r) => { let tot = 0; for (const k in w) tot += w[k]; let a = r * tot; for (const k in w) { a -= w[k]; if (a <= 0) return k; } return Object.keys(w)[0]; };
const SIZE = { bamboo: [8, 14], zelkova: [9, 16], jpine: [3, 6], young: [5, 12], spruce: [13, 23], tall: [17, 28], old: [22, 34], pine: [11, 20], snag: [8, 22], broken: [10, 26], leaf: [8, 14], oak: [10, 16], birch: [9, 15], maple: [6, 10], sakura: [7, 10], willow: [8, 12] };
const WIDTH = { bamboo: [0.8, 1.3], zelkova: [0.85, 1.2], jpine: [0.85, 1.25], young: [0.85, 1.15], spruce: [0.8, 1.2], tall: [0.72, 1.0], old: [0.9, 1.3], pine: [0.8, 1.3], snag: [0.8, 1.2], broken: [0.9, 1.3], leaf: [0.85, 1.2], oak: [0.85, 1.25], birch: [0.8, 1.1], maple: [0.9, 1.2], sakura: [0.9, 1.15], willow: [0.9, 1.15] };

// one tree of a given kind at (x, y, z); a: 0..1 age within the species' size range; cl/br: stand colour noise
export function makeTree(kind, x, y, z, rng, { a = rng(), scale = 1, cl = 0.5, br = 0.5, red = 0 } = {}) {
  const [s0, s1] = SIZE[kind] || [8, 14], [w0, w1] = WIDTH[kind] || [0.85, 1.15];
  const t = { kind, v: Math.floor(rng() * 16), x, y, z, s: lerp(s0, s1, a) * scale, sx: lerp(w0, w1, rng()), r: rng() * Math.PI * 2,
    tilt: (rng() - 0.5) * (kind === 'old' || kind === 'snag' ? 0.07 : 0.045), tilt2: (rng() - 0.5) * (kind === 'old' || kind === 'snag' ? 0.07 : 0.045) };
  if (kind === 'snag' || kind === 'broken') t.c = deadColor(rng, kind === 'broken');
  else if (kind === 'sakura') t.c = sakuraColor(rng);
  else if (['young', 'spruce', 'tall', 'old', 'pine', 'jpine', 'sapling'].includes(kind)) t.c = coniferColor(rng, kind, cl, br * (0.85 + 0.3 * (1 - a)));
  else t.c = broadColor(rng, kind === 'maple' && rng() < red ? 'mapleRed' : kind, cl, br); // red-leaf maples: gardens only
  t.bc = barkColor(rng, kind === 'pine' ? 0.9 : 0.4);
  t.cr = crownR(t); t.tr = 0.05 * t.s * t.sx;
  return t;
}

// Plants the forests and their meadow fringe. Returns { trees, saplings, fields: { FB, FW } }.
//   blocked(x, z, pad): landmarks, paths, streams — nothing grows there
//   alpine: altitude band (above water) where the woods thin into rocky pine woodland; lowland: band below which damp
//   ground carries mixed broadleaf woodland; meadow: number of lone-tree / grove attempts out in the open
//   mix: multipliers on the conifer forms (e.g. more tall cedars in a plantation valley); bamboo: 0..1 share of bamboo
//   groves in the damp lowland woods; meadowOK(x, z): where the meadow fringe may plant (keeps it out of towns)
export function plantForest({ hf, forest, moist, seed = 99, water = 0, snow = 1e9, blocked = () => false, alpine = [115, 170], lowland = [25, 60],
  meadow = 900, meadowMaxH = 95, sakura = true, step = 4.5, conifer = 1, mix = {}, bamboo = 0, meadowOK = () => true, edgeBroad = 0, spacing = 1 }) {
  const { HN, HALF } = hf, rng = mulberry32(seed), nrm = new THREE.Vector3();
  const FB = boxBlur(forest, HN, 8), FW = boxBlur(forest, HN, 26);
  const at = (A, x, z) => A[hf.idx(x, z)];
  const hash = new TreeHash(10), trees = [], saplings = [];
  const zone = (x, z, h, ny) => {
    const f = at(forest, x, z), fb = at(FB, x, z), m = moist ? at(moist, x, z) : 0.5, alt = h - water;
    const age = smoothstep(-0.35, 0.45, fbm(x * 0.0032 + 11.3, z * 0.0032 - 4.1, 3));
    const interior = smoothstep(0.55, 0.92, fb);
    const rocky = clamp(smoothstep(alpine[0], alpine[1], alt) + smoothstep(0.9, 0.8, ny) * 0.6, 0, 1);
    const low = 1 - smoothstep(lowland[0], lowland[1], alt);
    const mixed = low * smoothstep(0.42, 0.72, m) * (1 - rocky);
    const cl = fbm(x * 0.006 + 7.7, z * 0.006 - 2.2, 2) * 0.5 + 0.5, br = fbm(x * 0.011 - 3.1, z * 0.011 + 5.3, 2) * 0.5 + 0.5;
    return { f, fb, m, alt, age, interior, rocky, low, mixed, edge: 1 - interior, cl, br };
  };
  const place = (t, k) => { if (!hash.fits(t.x, t.z, t.cr, k, 1.2)) return false; hash.add(t); trees.push(t); return true; };
  // ---- pass 1: the canopy, candidates in random order on a jittered grid, each kept apart from its neighbours by a
  // share of their crown radii (old stands: little overlap and open trunks; young regrowth: crowded)
  const n = Math.floor(2 * HALF / step), order = new Uint32Array(n * n);
  for (let i = 0; i < order.length; i++) order[i] = i;
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)), t = order[i]; order[i] = order[j]; order[j] = t; }
  for (const idx of order) {
    const gx = idx % n, gz = (idx - gx) / n;
    const x = -HALF + (gx + 0.5 + (rng() - 0.5) * 0.95) * step, z = -HALF + (gz + 0.5 + (rng() - 0.5) * 0.95) * step;
    if (Math.abs(x) > HALF - 3 || Math.abs(z) > HALF - 3) continue;
    const f = at(forest, x, z); if (f < 0.04) continue;
    const h = hf.heightAt(x, z); if (h < water + 2.2 || h > snow) continue;
    const ny = hf.normalAt(x, z, nrm).y; if (ny < 0.78) continue;
    const Z = zone(x, z, h, ny);
    // treefall gaps and a clumped, uneven density
    if (fbm(x * 0.03 + 5.1, z * 0.03 - 9.7, 2) > 0.34 + 0.12 * Z.edge) continue;
    const clump = smoothstep(-0.35, 0.35, fbm(x * 0.05 + 1.7, z * 0.05 + 3.3, 2));
    if (rng() > Math.pow(f, 0.85) * (0.4 + 0.6 * clump) * (1 - 0.55 * Z.rocky) * 1.3) continue;
    if (blocked(x, z, 2)) continue;
    const pSnag = 0.012 + 0.03 * Z.age * Z.interior + 0.06 * Z.rocky, pBroken = 0.008 + 0.018 * Z.age * Z.interior + 0.03 * Z.rocky;
    const bl = (Z.mixed * 0.5 + Z.edge * Z.low * (0.22 + edgeBroad) + Z.low * edgeBroad * 0.3 + Z.rocky * 0.05) * (1.15 - conifer * 0.15), r = rng();
    let kind;
    if (r < pSnag) kind = 'snag';
    else if (r < pSnag + pBroken) kind = 'broken';
    else if (rng() < bl) { const q = rng(); kind = q < 0.22 + 0.45 * Z.rocky + 0.2 * (1 - Z.low) ? 'birch' : q < 0.62 ? 'oak' : 'leaf'; }
    else if (bamboo > 0 && Z.low > 0.4 && fbm(x * 0.012 + 3.7, z * 0.012 - 8.2, 2) > 0.5 - bamboo * 0.35) kind = 'bamboo';
    else kind = pickW({ old: (0.04 + 0.62 * Z.age * Z.interior * (1 - Z.rocky)) * (mix.old ?? 1), spruce: 0.36 * (1 - 0.5 * Z.rocky) * (mix.spruce ?? 1), tall: (0.08 + 0.18 * Z.m * (1 - Z.rocky)) * (mix.tall ?? 1),
      young: (0.05 + 0.5 * (1 - Z.age) * (1 - Z.rocky) + 0.22 * Z.edge) * (mix.young ?? 1), pine: (0.02 + 0.85 * Z.rocky + 0.1 * (1 - Z.m)) * (mix.pine ?? 1) }, rng());
    const stunt = 1 - 0.4 * smoothstep(alpine[0] + 20, alpine[1] + 40, Z.alt);
    const a = kind === 'young' ? rng() : clamp(rng() * 0.75 + Z.age * 0.35, 0, 1);
    const t = makeTree(kind, x, h - 0.25, z, rng, { a, scale: stunt * (0.86 + 0.14 * Z.interior), cl: Z.cl, br: Z.br });
    const k = (kind === 'young' ? 0.6 : kind === 'bamboo' ? 0.9 : lerp(0.72, 0.98, Z.age * Z.interior) + 0.45 * Z.rocky) * spacing;
    if (!place(t, k) && Z.rocky < 0.5 && rng() < 0.5 * (0.3 + Z.interior)) {
      // no room for a canopy tree: a younger one grows up between the big crowns
      const u = makeTree(Z.mixed > 0.4 && rng() < 0.4 ? 'leaf' : 'young', x, h - 0.2, z, rng, { a: rng() * 0.5, scale: 0.75, cl: Z.cl, br: Z.br });
      place(u, 0.42);
    }
  }
  // ---- pass 2: saplings where light reaches the floor (gaps, glades, the forest edge)
  for (let k = 0; k < 90000 && saplings.length < 9000; k++) {
    const x = (rng() * 2 - 1) * (HALF - 6), z = (rng() * 2 - 1) * (HALF - 6), f = at(forest, x, z);
    if (f < 0.08 || rng() > f + 0.1) continue;
    const h = hf.heightAt(x, z); if (h < water + 2.5 || h > snow) continue;
    const ny = hf.normalAt(x, z, nrm).y; if (ny < 0.8 || blocked(x, z, 1)) continue;
    let shade = 0; hash.each(x, z, 16, o => { const d = Math.hypot(o.x - x, o.z - z); if (d < o.tr + 0.8) shade = 9; else if (d < o.cr * 0.8) shade += 1; });
    if (shade > 1 || (shade === 1 && rng() < 0.7)) continue;
    const Z = zone(x, z, h, ny), bl = Z.mixed > 0.35 && rng() < 0.45;
    const t = bl ? makeTree(rng() < 0.6 ? 'leaf' : 'birch', x, h - 0.1, z, rng, { a: 0, scale: 0.28 + rng() * 0.2, cl: Z.cl, br: Z.br })
      : { kind: 'sapling', v: Math.floor(rng() * 4), x, y: h - 0.08, z, s: lerp(1.1, 4.5, Math.pow(rng(), 1.4)), sx: 0.85 + rng() * 0.35, r: rng() * 6.28, tilt: (rng() - 0.5) * 0.08, tilt2: (rng() - 0.5) * 0.08, c: coniferColor(rng, 'sapling', Z.cl, Z.br) };
    t.cr = crownR(t); t.tr = 0.2;
    saplings.push(t);
  }
  // ---- pass 3: the meadow fringe — lone trees and little groves, thickest near the forest edge (a young conifer or
  // birch that seeded out of the woods), broad crowns out in the open, now and then a blossom tree on the low ground
  for (let k = 0; k < meadow; k++) {
    const cx = (rng() * 2 - 1) * (HALF - 60), cz = (rng() * 2 - 1) * (HALF - 60), near = at(FW, cx, cz);
    if (at(forest, cx, cz) > 0.14 || rng() > 0.2 + 0.8 * smoothstep(0.04, 0.3, near) || !meadowOK(cx, cz)) continue;
    const grove = rng() < 0.4, m = grove ? 2 + Math.floor(rng() * 5) : 1;
    for (let q = 0; q < m; q++) {
      const x = cx + (rng() - 0.5) * 22 * grove, z = cz + (rng() - 0.5) * 22 * grove, h = hf.heightAt(x, z);
      if (h < water + 3 || h > water + meadowMaxH || at(forest, x, z) > 0.25) continue;
      const ny = hf.normalAt(x, z, nrm).y; if (ny < 0.86 || blocked(x, z, 2) || !meadowOK(x, z)) continue;
      const Z = zone(x, z, h, ny), edgeSide = smoothstep(0.08, 0.35, at(FW, x, z)), r = rng();
      let kind;
      if (sakura && Z.alt < 30 && r < 0.1) kind = 'sakura';
      else if (r < 0.1 + 0.4 * edgeSide * conifer) kind = rng() < 0.6 ? 'young' : 'spruce';
      else { const q2 = rng(); kind = q2 < 0.15 + 0.35 * smoothstep(40, 90, Z.alt) ? 'birch' : q2 < 0.55 ? 'leaf' : q2 < 0.93 ? 'oak' : 'maple'; }
      const t = makeTree(kind, x, h - 0.2, z, rng, { a: rng(), scale: kind === 'young' || kind === 'spruce' ? 0.8 : 1, cl: Z.cl, br: Z.br });
      place(t, 0.7);
    }
  }
  return { trees, saplings, hash, FB, FW };
}

// What lies and grows on the forest floor, from the placed trees and the fields: fallen logs (more in old stands, and a
// fallen top beside every snapped trunk), spreads of dead branches, low dark shrubs in patches, and weights for ferns.
export function forestFloor({ hf, forest, moist, trees, seed = 5, water = 0, blocked = () => false, logs = 700, twigs = 6000, shrubs = 2600 }) {
  const rng = mulberry32(seed), nrm = new THREE.Vector3(), at = (A, x, z) => A[hf.idx(x, z)], HALF = hf.HALF;
  const out = { logs: [], twigs: [], shrubs: [], stumps: [] };
  const logAt = (x, z, len, rad, r) => {
    const h = hf.heightAt(x, z); hf.normalAt(x, z, nrm);
    if (nrm.y < 0.82 || blocked(x, z, 1.5)) return;
    const c = Math.cos(r), s = Math.sin(r), h0 = hf.heightAt(x - c * len * 0.5, z + s * len * 0.5), h1 = hf.heightAt(x + c * len * 0.5, z - s * len * 0.5);
    const dark = 0.72 + rng() * 0.28;
    out.logs.push({ x, y: Math.min(h, (h0 + h1) / 2) + rad * 0.55, z, len, rad, r, tilt: 0, tilt2: Math.atan2(h1 - h0, len),
      c: new THREE.Color(dark * 1.05, dark * 0.9, dark * 0.76) });
  };
  for (const t of trees) if (t.kind === 'broken' && rng() < 0.75) { // the snapped-off top lies beside its trunk
    const a = rng() * 6.28, len = t.s * lerp(0.35, 0.5, rng()), d = len * 0.5 + 0.4;
    logAt(t.x + Math.cos(a) * d, t.z - Math.sin(a) * d, len, t.s * 0.03 * t.sx, a);
  }
  for (let k = 0; k < logs * 8 && out.logs.length < logs; k++) {
    const x = (rng() * 2 - 1) * (HALF - 20), z = (rng() * 2 - 1) * (HALF - 20), f = at(forest, x, z);
    const age = smoothstep(-0.35, 0.45, fbm(x * 0.0032 + 11.3, z * 0.0032 - 4.1, 3));
    if (f < 0.35 || rng() > f * (0.35 + 0.65 * age)) continue;
    const h = hf.heightAt(x, z); if (h < water + 2.5) continue;
    logAt(x, z, lerp(4, 14, rng()), lerp(0.18, 0.42, rng()), rng() * 6.28);
  }
  for (let k = 0; k < twigs * 6 && out.twigs.length < twigs; k++) {
    const x = (rng() * 2 - 1) * (HALF - 10), z = (rng() * 2 - 1) * (HALF - 10), f = at(forest, x, z);
    if (f < 0.3 || rng() > f) continue;
    const h = hf.heightAt(x, z); if (h < water + 2.5 || hf.normalAt(x, z, nrm).y < 0.8 || blocked(x, z, 0.5)) continue;
    const g = 0.6 + rng() * 0.3;
    out.twigs.push({ kind: 'twigs', v: Math.floor(rng() * 4), x, y: h, z, s: lerp(0.7, 1.6, rng()), r: rng() * 6.28, tilt: Math.atan2(nrm.z, nrm.y), tilt2: -Math.atan2(nrm.x, nrm.y), c: new THREE.Color(g, g * 0.93, g * 0.86) });
  }
  for (let k = 0; k < shrubs * 8 && out.shrubs.length < shrubs; k++) {
    const x = (rng() * 2 - 1) * (HALF - 10), z = (rng() * 2 - 1) * (HALF - 10), f = at(forest, x, z);
    const patch = fbm(x * 0.04 - 2.3, z * 0.04 + 6.1, 2);
    if (f < 0.3 || patch < 0.05 || rng() > f * smoothstep(0.05, 0.4, patch)) continue;
    const h = hf.heightAt(x, z); if (h < water + 2.5 || hf.normalAt(x, z, nrm).y < 0.82 || blocked(x, z, 1)) continue;
    const m = moist ? at(moist, x, z) : 0.5, c = bushColor(rng).multiplyScalar(0.72 + 0.12 * m);
    out.shrubs.push({ x, y: h - 0.12, z, s: lerp(0.6, 1.5, Math.pow(rng(), 1.3)), sx: 0.9 + rng() * 0.4, r: rng() * 6.28, c });
  }
  return out;
}

// Ground moisture: lake shore and stream banks, hollows (low baked AO), lower altitudes, with slow noise
export function moistureField(hf, { water = 0, streamDist = null, dryAbove = [60, 160] } = {}) {
  const { HN, HALF, CELL, H, mask } = hf, M = new Float32Array(HN * HN);
  for (let j = 0; j < HN; j++) for (let i = 0; i < HN; i++) {
    const o = j * HN + i, x = -HALF + i * CELL, z = -HALF + j * CELL, h = H[o] - water;
    const lake = 1 - smoothstep(1.5, 14, h), sd = streamDist ? streamDist(x, z) : 1e9, stream = 1 - smoothstep(3, 38, sd);
    const hollow = 1 - mask[o * 4 + 1] / 255;
    const nz = fbm(x * 0.006 + 3.3, z * 0.006 + 8.1, 3);
    M[o] = clamp(0.32 + Math.max(lake, stream * 0.9) * 0.55 + hollow * 1.6 + nz * 0.3 - smoothstep(dryAbove[0], dryAbove[1], h) * 0.25, 0, 1);
  }
  return M;
}
