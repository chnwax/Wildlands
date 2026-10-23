// Your home and your farm (a little farming game). On a levelled stretch of meadow, a concrete lane off the nearest road
// leads in under a wooden gate sign to the farmyard:
//  - the house: Idyllic Anime Japan's two-storey house (house_residential_building_01) in its walled garden, dressed as
//    the pack's own demo scene dresses it (garden walls, gate, garden tree, flower beds, pots, mailbox, lamp). The model is
//    a shell, so the house is cut open (the front door becomes a leaf that swings, the lower roof and the slabs that run
//    through the upper storey are taken out of it) and built inside: a genkan with its step, a dining kitchen and a living
//    room, a washroom, toilet and bathroom, a staircase to the upper floor (a bedroom, a desk under the window, a tatami
//    corner) — furnished from two CC0 packs (assets/models/home: Quaternius' Ultimate House Interior Pack, CreativeTrio's
//    Household Props 001), doors opened with E, your bed to sleep in
//  - the farmyard: a storehouse (the pack's house annex), a shelter with an old tractor, hay, firewood, a well, a
//    clothesline; the produce stand by the lane is the farm's office (E: the board)
//  - the field: 7 x 5 plots behind a split-rail fence (six yours to start, the rest bought in order), sown with seeds
//    bought on the spot, growing with the hours of the game, harvested for yen
//  - upgrades bought at the board or at their building plots: sprinklers (1.5x growth), a greenhouse (four beds, 2x
//    growth), beehives (honey), an orchard (fruit every half day) and a farm hand (harvests and sows again)
// Everything about the farm is kept on this computer (localStorage: wl_farm2).
import { THREE, scene, buildCompound, addCompound, addProp, addBox, addCircle, colInsert, colRemove, capHooks, gltfLoader, lampPoints } from './core.js';
import { time, updateSky } from './sky.js';
import { wallFill, reveals } from './building.js';
import { interiorKit, roomLamp } from './interiors.js';
import { packsReady, packParts, packProp } from './packs.js';
import { signMesh, GeoBuilder } from './townkit.js';
import { earn, spend, inv, yen } from './items.js';
import { toastMsg } from './ui.js';

const BASE = 'assets/models/home/';
// the CC0 packs' own scales to metres (the interior pack is modelled at twice life size, the household props a little under)
const SC = id => id.startsWith('i_') ? 0.5 : 1.42;
export const CROPS = {
  lettuce: { name: 'Lettuce', jp: 'レタス', model: 'farm_lettuce_01_l', price: 60, hours: 2, sell: 150, n: 4, s: 1.6, look: ['lettuce'] },
  cabbage: { name: 'Cabbage', jp: 'キャベツ', model: 'farm_cabbage_01_l', price: 90, hours: 3, sell: 240, n: 3, s: 1.3, look: ['cabbage'] },
  sunflower: { name: 'Sunflower', jp: 'ひまわり', model: 'farm_sunflower_1', price: 100, hours: 3, sell: 270, n: 3, s: 1.1, look: ['sunflower'] },
  potato: { name: 'Potato', jp: 'じゃがいも', model: 'farm_plant_potato_01_l', price: 110, hours: 4, sell: 310, n: 3, s: 0.6, look: ['potato'] },
  tomato: { name: 'Tomato', jp: 'トマト', model: 'farm_tomato_bush', price: 120, hours: 4, sell: 340, n: 3, s: 0.95, look: ['tomato'] },
  bean: { name: 'Edamame', jp: '枝豆', model: 'farm_bean_bush', price: 130, hours: 4.5, sell: 380, n: 3, s: 0.9, look: ['bean'] },
  strawberry: { name: 'Strawberry', jp: 'いちご', model: 'farm_strawberry', price: 150, hours: 5, sell: 430, n: 3, s: 0.95, look: ['strawberry'] },
  corn: { name: 'Corn', jp: 'とうもろこし', model: 'farm_corn_m', price: 180, hours: 6, sell: 540, n: 3, s: 0.85, look: ['corn'] },
  pumpkin: { name: 'Pumpkin', jp: 'かぼちゃ', model: 'farm_pumpkin_m', price: 250, hours: 8, sell: 820, n: 3, s: 1.3, look: ['pumpkin'] },
  watermelon: { name: 'Watermelon', jp: 'すいか', model: 'farm_watermelon', price: 320, hours: 10, sell: 1100, n: 3, s: 1.25, look: ['watermelon'] },
};
const COLS = 7, ROWS = 5, PLOT = 2.4, GAP = 0.6, FREE = 6;
const plotPrice = k => 600 + 300 * (k - FREE); // (the k-th plot, counting from 0)
export const UPGRADES = {
  sprinkler: { name: 'Sprinklers', jp: 'スプリンクラー', price: 4000, note: 'the field grows 1.5× as fast' },
  greenhouse: { name: 'Greenhouse', jp: '温室', price: 7000, note: 'four beds that grow twice as fast' },
  hives: { name: 'Beehives', jp: '養蜂', price: 5000, note: 'three hives: a jar of honey each every 4 h' },
  orchard: { name: 'Orchard', jp: '果樹園', price: 6000, note: 'five fruit trees, a crate each every 12 h' },
  hand: { name: 'Farm hand', jp: '手伝いさん', price: 9000, note: 'harvests what is ripe and sows the same again' },
};
const HONEY = 180, FRUIT = 360, HIVE_H = 4, FRUIT_H = 12;

// ---------------------------------------------------------------- the farm's state (localStorage)
const KEY = 'wl_farm2';
const state = { plots: Array.from({ length: COLS * ROWS }, (_, i) => ({ own: i < FREE, crop: null, g: 0 })), gh: Array.from({ length: 4 }, () => ({ crop: null, g: 0 })), honey: 0, fruit: [0, 0, 0, 0, 0], upg: {}, earned: 0 };
try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && s.plots && s.plots.length === state.plots.length) Object.assign(state, s); } catch (e) {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} };

// ---------------------------------------------------------------- the CC0 furniture
const models = new Map(); let BOX = {};
async function loadModels(ids) {
  try { BOX = await (await fetch(BASE + 'models.json')).json(); } catch (e) {}
  await Promise.all(ids.map(async id => { try { const g = await gltfLoader.loadAsync(BASE + id + '.glb'); g.scene.updateMatrixWorld(true); const parts = []; g.scene.traverse(o => { if (o.isMesh) parts.push({ geometry: o.geometry, material: o.material, m: o.matrixWorld.clone() }); }); models.set(id, parts); } catch (e) { console.warn('home: model', id, e); } }));
}

// ---------------------------------------------------------------- cutting a pack model's triangles
// A triangle's corners carry position, normal and uv; polygons are clipped against axis planes (the corners' attributes
// interpolated), a box is subtracted as the pieces outside its six planes.
const lerpV = (a, b, t) => ({ p: a.p.map((v, k) => v + (b.p[k] - v) * t), n: a.n.map((v, k) => v + (b.n[k] - v) * t), u: a.u.map((v, k) => v + (b.u[k] - v) * t) });
function clip(P, ax, val, keepAbove) {
  const out = []; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length], da = a.p[ax] - val, db = b.p[ax] - val, ia = keepAbove ? da >= 0 : da <= 0, ib = keepAbove ? db >= 0 : db <= 0;
    if (ia) out.push(a); if (ia !== ib) out.push(lerpV(a, b, da / (da - db))); } return out;
}
function subtractBox(P, b) {
  for (let ax = 0; ax < 3; ax++) { const r = b[ax]; if (!r) continue; let lo = 1e9, hi = -1e9; for (const v of P) { lo = Math.min(lo, v.p[ax]); hi = Math.max(hi, v.p[ax]); } if (hi <= r[0] || lo >= r[1]) return [P]; }
  const out = []; let rest = P;
  for (let ax = 0; ax < 3; ax++) { const r = b[ax]; if (!r) continue;
    const below = clip(rest, ax, r[0], false); if (below.length >= 3) out.push(below);
    rest = clip(rest, ax, r[0], true); if (rest.length < 3) return out;
    const above = clip(rest, ax, r[1], true); if (above.length >= 3) out.push(above);
    rest = clip(rest, ax, r[1], false); if (rest.length < 3) return out; }
  return out; // (what is inside the box is dropped)
}
// parts of a pack model -> { keep: [{geometry, material}], take: [[{geometry, material}] per take box] }; cut: boxes
// [[x0,x1],[y0,y1],[z0,z1]] subtracted; take: boxes whose triangles (by centroid) are taken out whole
function cutModel(parts, cut, take = []) {
  const keep = [], took = take.map(() => []);
  for (const q of parts) {
    const g = q.geometry, pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv, idx = g.index, n = idx ? idx.count : pos.count;
    const K = { p: [], n: [], u: [] }, T = take.map(() => ({ p: [], n: [], u: [] }));
    const V = i => ({ p: [pos.getX(i), pos.getY(i), pos.getZ(i)], n: nor ? [nor.getX(i), nor.getY(i), nor.getZ(i)] : [0, 1, 0], u: uv ? [uv.getX(i), uv.getY(i)] : [0, 0] });
    const emit = (d, P) => { for (let k = 1; k + 1 < P.length; k++) for (const v of [P[0], P[k], P[k + 1]]) { d.p.push(...v.p); const l = Math.hypot(...v.n) || 1; d.n.push(v.n[0] / l, v.n[1] / l, v.n[2] / l); d.u.push(...v.u); } };
    for (let t = 0; t < n; t += 3) {
      const tri = [0, 1, 2].map(k => V(idx ? idx.getX(t + k) : t + k)), c = [0, 1, 2].map(k => (tri[0].p[k] + tri[1].p[k] + tri[2].p[k]) / 3);
      const ti = take.findIndex(b => b.every((r, k) => c[k] >= r[0] && c[k] <= r[1])); if (ti >= 0) { emit(T[ti], tri); continue; }
      let polys = [tri]; for (const b of cut) polys = polys.flatMap(P => subtractBox(P, b)); for (const P of polys) emit(K, P);
    }
    const geo = d => { const G = new THREE.BufferGeometry(); G.setAttribute('position', new THREE.Float32BufferAttribute(d.p, 3)); G.setAttribute('normal', new THREE.Float32BufferAttribute(d.n, 3)); G.setAttribute('uv', new THREE.Float32BufferAttribute(d.u, 2)); G.computeBoundingSphere(); return G; };
    if (K.p.length) keep.push({ geometry: geo(K), material: q.material, castShadow: q.castShadow !== false });
    T.forEach((d, i) => { if (d.p.length) took[i].push({ geometry: geo(d), material: q.material }); });
  }
  return { keep, take: took };
}
// pack parts as plain meshes at matrix M (a group, its own world matrix: for what moves or appears later)
function meshGroup(parts, M, shadow = true) { const g = new THREE.Group(); g.matrixAutoUpdate = false; g.matrix.copy(M); for (const q of parts) { const m = new THREE.Mesh(q.geometry, q.material); m.castShadow = shadow && q.castShadow !== false; m.receiveShadow = true; m.matrixAutoUpdate = false; g.add(m); } g.updateMatrixWorld(true); scene.add(g); return g; }
const trisOf = (parts, M, out) => { const v = new THREE.Vector3(); for (const q of parts) { const g = q.geometry, pos = g.attributes.position, idx = g.index, n = idx ? idx.count : pos.count; for (let i = 0; i < n; i++) { v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(M); out.push(v.x, v.y, v.z); } } return out; };

// ---------------------------------------------------------------- the site's plan (site frame: its front, toward the lane and the road, +z)
const HW = 30, HD = 18;                        // the site: 60 x 36 m
const HX = -18.5, HZ = -4;                     // the house (its own frame: the model's)
const LX = -6;                                 // where the lane comes in
const FX = 11.5, FZ = -2, FW = COLS * PLOT + (COLS - 1) * GAP, FD = ROWS * PLOT + (ROWS - 1) * GAP, FENCE = 1.0; // the field
const GATE = FZ + FD / 2 + FENCE;              // the field fence's front line
const GH = [26.5, -1.5], HIVES = [[24.5, -14], [26, -14.4], [27.5, -14]], ORCHARD = [[1, -14.5, 'farm_mikan'], [6, -14.5, 'farm_peach'], [11, -14.5, 'farm_apple'], [16, -14.5, 'farm_plum'], [21, -14.5, 'farm_cherry_fruit']];
const STAND = [2.0, 13.6];                     // the produce stand (the farm's board)
// the house: the model's frame (front +z). Ground floor: floor FG (the genkan FK), ceiling C0, the inner faces of its
// walls IX0..IX1 x IZ0..IZ1; upper floor FU over the upper storey's footprint (inner faces UX0..UX1 x UZ0..UZ1), ceiling C1
const FG = 0.32, FK = 0.06, C0 = 2.95, FU = 4.1, C1 = 6.9;
const IX0 = -3.76, IX1 = 3.76, IZ0 = -3.48, IZ1 = 3.33, UX0 = -3.06, UX1 = 2.46, UZ0 = -3.48, UZ1 = 1.18;
const STAIR_X0 = -3.06, STEP = 0.24, NSTEP = 19, STAIR_Z = [-3.48, -2.28], HOLE = [-2.75, STAIR_X0 + (NSTEP - 1) * STEP]; // (the stairwell: x)
const DOOR = [0.57, 1.67, 2.34]; // (the front door: x0, x1, head)
// the garden as the pack's demo scene lays it out round this house: [id, x, y, z, yaw°, scale] in the house's frame
const KIT = [['jp_walls_poarch_01', -0.16, 0, 2.40, 0, 1], ['jp_entrance_fence_02', -1.08, -0.04, 9.35, 0, 1.33], ['jp_entrance_edge', -1.18, 0.02, 9.35, 0, 1], ['jp_entrance_edge', 0.81, 0.02, 9.35, 0, 1],
  ['jp_tree_garden', -3.74, 1.0, 8.05, -22, 0.75], ['jp_wall_flowerbed', -3.60, 0, 8.37, 0, 1], ['jp_wall_flowerbed', -2.17, 0, 4.16, 0, 1], ['jp_bush_01', -2.85, 0.35, 4.08, 0, 0.59], ['jp_bush_01', -1.56, 0.35, 4.10, 71, 0.55],
  ['jp_flowerpot_06', -0.39, 0, 4.23, 0, 1], ['jp_flowerpot_07', -0.56, 0, 4.75, 0, 1], ['jp_mailbox_resident_02', 1.16, 1.25, 9.64, 0, 1], ['jp_flowerpot_09', 1.64, 1.82, 9.41, 0, 1], ['jp_flowerpot_02', 1.16, 1.87, 9.49, 0, 1],
  ['jp_flowerpot_010', -1.49, 1.87, 9.43, 0, 1], ['jp_plants_box_01', -3.42, 0, 9.78, 0, 1.04], ['jp_flowerpot_06', -2.79, 0, 9.77, 0, 1.05], ['jp_flowerpot_05', -2.36, 0, 9.71, 0, 0.94], ['jp_lamp_03', 2.25, 2.68, 4.08, 0, 1],
  ['jp_fusebox_wall_02', 3.32, 2.02, 3.49, 0, 1.12], ['jp_fusebox_wall_03', -0.76, 4.25, 3.55, 0, 1.24], ['jp_broom_stick', 1.60, 0, 9.86, 25, 1.07], ['jp_bucket', 1.89, 0, 9.73, 0, 1.09],
  // (and a few of ours: the bicycle in the side yard, the air conditioner's outdoor unit, a planter by the door)
  ['jp_bicycle', 4.55, 0, 2.2, -90, 1], ['jp_airconditioner_01', -4.35, 0, -1.6, 90, 1], ['jp_plants_box_02', 2.95, 0, 4.0, 0, 0.9], ['jp_flowerpot_03', 0.25, 0, 3.75, 0, 1]];

// ---------------------------------------------------------------- building it (town.js, while the map is built)
// ctx: { B (the town's builder), hf, occRect, gy, RN, blocked(x, z), footpath(x0, z0, x1, z1, w) }
export async function buildHome(ctx) {
  const { B, hf, occRect, gy, RN } = ctx, blocked = (x, z) => ctx.blocked(x, z) || (ctx.paddy && ctx.paddy(x, z)) || gy(x, z) < 4.5;
  const P = packsReady(); if (!P || !P.models.jp_house_01) { console.warn('home: the model libraries are missing'); return null; }
  // ---- the place: a free stretch of meadow (60 x 36 m, levelled below) as near the middle of the town as can be, with a
  // lane from its front to the nearest road or footway over free ground (four ways round). The place found is kept
  // (localStorage) and checked again on the next start rather than searched for anew.
  const onWay = (x, z) => RN.roadAt(x, z) || (RN.walkY && RN.walkY(x, z) !== null);
  const spread = (x, z, c, s, step = 4) => {
    let lo = 1e9, hi = -1e9;
    for (let dz = -HD; dz <= HD; dz += step) for (let dx = -HW; dx <= HW; dx += step) { const px = x + dx * c + dz * s, pz = z - dx * s + dz * c; if (blocked(px, pz) || onWay(px, pz)) return -1; const h = gy(px, pz); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    return hi - lo;
  };
  // the lane: Dijkstra over 2 m cells (8 neighbours, up to 150 m) from just outside the site's front to the first cell
  // of a road (for cars), never through the site, a lot, a tree or a steep step; then straightened where the way is clear
  const lanePath = (x, z, c, s) => {
    const G = 2, RM = 150, N = Math.ceil(2 * RM / G) + 1, ox = x + LX * c + (HD + 1.5) * s, oz = z - LX * s + (HD + 1.5) * c, x0 = ox - RM, z0 = oz - RM;
    const cell = new Int8Array(N * N), dist = new Float32Array(N * N).fill(1e9), prev = new Int32Array(N * N).fill(-1);
    const W = k => [x0 + (k % N) * G, z0 + Math.floor(k / N) * G];
    const inSite = (px, pz) => { const dx = px - x, dz = pz - z, lx = dx * c - dz * s, lz = dx * s + dz * c; return Math.abs(lx) < HW + 1 && Math.abs(lz) < HD + 1; };
    const kind = k => { if (cell[k]) return cell[k]; const [px, pz] = W(k); return (cell[k] = inSite(px, pz) ? 2 : RN.roadAt(px, pz) ? 3 : RN.walkY && RN.walkY(px, pz) !== null ? 1 : blocked(px, pz) || occRect(px, pz, 1.7, 1.7, 0, 0, true) ? 2 : 1); }; // (to a road for cars, over a footway if need be)
    const heap = [], push = (k, d) => { heap.push([d, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r2 = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r2 < heap.length && heap[r2][0] < heap[m][0]) m = r2; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    const k0 = Math.round(RM / G) * N + Math.round(RM / G); dist[k0] = 0; cell[k0] = 1; push(k0, 0); let goal = -1;
    while (heap.length) { const [d, k] = pop(); if (d > dist[k]) continue; if (cell[k] === 3) { goal = k; break; } if (d > RM * 1.6) break; const i = k % N, j = (k - i) / N, hk = gy(...W(k));
      for (const [di, dj, w] of [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]]) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue; const kk = jj * N + ii, t = kind(kk); if (t === 2) continue;
        if (Math.abs(gy(...W(kk)) - hk) > 0.9 * w) continue; const nd = d + w * G; if (nd < dist[kk]) { dist[kk] = nd; prev[kk] = k; push(kk, nd); } } }
    if (goal < 0) return null;
    const raw = []; for (let k = goal; k >= 0; k = prev[k]) raw.push(W(k)); raw.reverse(); raw[0] = [ox, oz];
    const clear = (a, b) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]); for (let t = 0.5; t <= L; t += 1) { const px = a[0] + (b[0] - a[0]) * t / L, pz = a[1] + (b[1] - a[1]) * t / L; if (inSite(px, pz)) return false; if (!onWay(px, pz) && (blocked(px, pz) || occRect(px, pz, 1.7, 1.7, 0, 0, true))) return false; } return true; };
    const out = [raw[0]]; for (let i = 0; i < raw.length - 1;) { let j = raw.length - 1; while (j > i + 1 && !clear(raw[i], raw[j])) j--; out.push(raw[j]); i = j; }
    let len = 0; for (let i = 1; i < out.length; i++) len += Math.hypot(out[i][0] - out[i - 1][0], out[i][1] - out[i - 1][1]); return { pts: out, len };
  };
  const SITE_KEY = 'wl_home_site1'; let best = null;
  try { const k = JSON.parse(localStorage.getItem(SITE_KEY) || 'null'); if (k) { const c = Math.cos(k.r), s = Math.sin(k.r), sp = spread(k.x, k.z, c, s, 3); if (sp >= 0 && sp <= 4 && !occRect(k.x, k.z, HW, HD, k.r, 0, true)) { const L = lanePath(k.x, k.z, c, s); if (L) best = [k.x, k.z, k.r, L]; } } } catch (e) {}
  if (!best) {
    const cand = [];
    for (let z = -520; z <= 520; z += 8) for (let x = -520; x <= 520; x += 8) for (const r of [0, Math.PI / 2]) { const sp = spread(x, z, Math.cos(r), Math.sin(r)); if (sp >= 0 && sp <= 4) cand.push([x, z, r, sp, Math.hypot(x, z + 30) * 0.15 + sp * 4]); }
    cand.sort((a, b) => a[4] - b[4]);
    let bs = 1e9, tried = 0;
    for (const [x, z, r0, sp, s0] of cand) { if (s0 >= bs || tried > 24) break;
      for (const r of [r0, r0 + Math.PI]) { const c = Math.cos(r), s = Math.sin(r); if (occRect(x, z, HW, HD, r, 0, true)) continue; tried++; const L = lanePath(x, z, c, s); if (!L) continue; const sc = s0 + L.len * 0.6; if (sc < bs) { bs = sc; best = [x, z, r, L]; } } }
    if (best) try { localStorage.setItem(SITE_KEY, JSON.stringify({ x: best[0], z: best[1], r: best[2] })); } catch (e) {}
  }
  if (!best) { console.warn('home: no room for the farm'); return null; }
  const [sx, sz, r, lane] = best, road = Math.round(lane.len), c = Math.cos(r), s = Math.sin(r);
  const S = (lx, lz) => [sx + lx * c + lz * s, sz - lx * s + lz * c]; // site frame -> world
  const SL = (x, z) => { const dx = x - sx, dz = z - sz; return [dx * c - dz * s, dx * s + dz * c]; }; // world -> site frame
  occRect(sx, sz, HW, HD, r, 1);
  // ---- the ground levelled: the site's middle at one height, its rim (5 m) easing back into the meadow
  let sum = 0, cnt = 0; for (let dz = -HD + 6; dz <= HD - 6; dz += 3) for (let dx = -HW + 6; dx <= HW - 6; dx += 3) { const [px, pz] = S(dx, dz); sum += gy(px, pz); cnt++; }
  const lev = sum / cnt;
  { const { HN, HALF, CELL, GRID, H } = hf, R0 = Math.hypot(HW, HD) + 2, i0 = Math.max(0, Math.floor((sx - R0 + HALF) / CELL)), i1 = Math.min(GRID, Math.ceil((sx + R0 + HALF) / CELL)), j0 = Math.max(0, Math.floor((sz - R0 + HALF) / CELL)), j1 = Math.min(GRID, Math.ceil((sz + R0 + HALF) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const [lx, lz] = SL(-HALF + i * CELL, -HALF + j * CELL), e = Math.min(HW - Math.abs(lx), HD - Math.abs(lz)); if (e <= 0) continue; const w = e >= 5 ? 1 : e * e * (3 - 2 * e / 5) / 25 * (1 / 1); H[j * HN + i] += (lev - H[j * HN + i]) * Math.min(1, w); } }
  // ---- the ground's look: no grass under the buildings, on the yard, the paths and the field
  const laneLamps = [];
  const inRect = (x, z, cx, cz, hw, hd) => { const [lx, lz] = SL(x, z); return Math.abs(lx - cx) < hw && Math.abs(lz - cz) < hd; };
  const R1 = HW + HD + 2;
  const pave = (cx, cz, hw, hd) => { const R2 = Math.hypot(hw, hd) + 1, [wx, wz] = S(cx, cz); hf.paintPave(wx - R2, wz - R2, wx + R2, wz + R2, (x, z) => inRect(x, z, cx, cz, hw, hd) ? 1 : 0); };
  for (const [cx, cz, hw, hd] of [[HX, HZ - 0.08, 4.05, 3.7], [HX + 0.45, HZ + 6.4, 0.75, 2.9], [HX + 1.45, HZ + 3.95, 1.25, 0.5], [-11.25, 10.4, 14.3, 4.2], [-6.5, 3.55, 3.75, 2.75], [LX, 16.3, 2.2, 1.8],
    [FX, FZ - FENCE / 2 + (GATE - FZ - FD / 2) / 2, FW / 2 + FENCE + 0.2, (FD + FENCE + GATE - FZ - FD / 2) / 2 + 0.2], [(3.0 + FX + 1.1) / 2, 8.1, (FX + 1.1 - 3.0) / 2, 0.75], [FX, (GATE + 7.4) / 2, 1.15, (7.4 - GATE) / 2 + 0.2],
    [-6.5, -3.1, 3.3, 3.9], [-6.5, -12.6, 2.6, 1.9], [GH[0], GH[1], 2.95, 4.05], [STAND[0], STAND[1], 1.7, 1.7]]) pave(cx, cz, hw, hd);
  hf.paint2(3, sx - R1, sz - R1, sx + R1, sz + R1, (x, z) => inRect(x, z, HX - 0.16, HZ + 2.4, 5.3, 6.8) ? 1 : 0); // (the garden's lawn, mown)
  hf.paint2(2, sx - R1, sz - R1, sx + R1, sz + R1, (x, z) => inRect(x, z, HX, HZ, 4.4, 4.0) || inRect(x, z, FX, FZ, FW / 2 + FENCE + 0.4, FD / 2 + FENCE + 0.4) || inRect(x, z, -11.25, 10.4, 14.5, 4.2) || inRect(x, z, -6.5, 3.6, 3.8, 3.0) || inRect(x, z, -6.5, -3, 3.4, 4.0) || inRect(x, z, -6.5, -12.5, 2.8, 2.2) || inRect(x, z, LX, 16.2, 2.2, 2.2) ? 1 : 0);
  // ---- the lane: concrete, 3.4 m, with gravel shoulders, from the road to the yard; the yard and the paths gravel
  const drape = (mat, x0, x1, z0, z1, col, step = 1, dy = 0.04, uv = 2.5) => { // a site-frame rectangle laid on the ground
    const nx = Math.max(1, Math.ceil((x1 - x0) / step)), nz = Math.max(1, Math.ceil((z1 - z0) / step)), V = (i, j) => { const [x, z] = S(x0 + (x1 - x0) * i / nx, z0 + (z1 - z0) * j / nz); return [x, gy(x, z) + dy, z]; };
    B.frame(0, 0, 0, 0); for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const Q = [V(i, j), V(i + 1, j), V(i + 1, j + 1), V(i, j + 1)]; B.poly(mat, Q, [0, 1, 0], { color: col, uvs: Q.map(p => [p[0] / uv, p[2] / uv]) }); } };
  // inside the site: from the yard to the gate; outside: along the lane's path to the road (a ribbon draped on the ground,
  // its corners mitred), lamps along it, the ground under it kept free
  drape('concrete', LX - 1.7, LX + 1.7, 14.6, HD + 1.6, [0.8, 0.79, 0.76], 1.5, 0.06, 3);
  drape('gravelPath', LX - 2.15, LX - 1.7, 14.6, HD + 1.6, [0.78, 0.72, 0.62], 1.5, 0.05); drape('gravelPath', LX + 1.7, LX + 2.15, 14.6, HD + 1.6, [0.78, 0.72, 0.62], 1.5, 0.05);
  const ribbon = (pts, w0, w1, mat, col, dy, uv = 3) => { // between offsets w0 and w1 (m, left negative) of the path
    const n = pts.length, N2 = pts.map((p, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1; let nx = -dz / l, nz = dx / l;
      if (i > 0 && i < n - 1) { const d1 = [p[0] - a[0], p[1] - a[1]], d2 = [b[0] - p[0], b[1] - p[1]], l1 = Math.hypot(...d1) || 1, l2 = Math.hypot(...d2) || 1, m1 = [-d1[1] / l1, d1[0] / l1], m2 = [-d2[1] / l2, d2[0] / l2], mx = m1[0] + m2[0], mz = m1[1] + m2[1], ml = Math.hypot(mx, mz) || 1, k = 1 / Math.max(0.5, (mx * m1[0] + mz * m1[1]) / ml); nx = mx / ml * k; nz = mz / ml * k; }
      return [nx, nz]; });
    B.frame(0, 0, 0, 0);
    for (let i = 0; i < n - 1; i++) { const a = pts[i], b = pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), m = Math.max(1, Math.ceil(L / 1.5));
      for (let k = 0; k < m; k++) { const t0 = k / m, t1 = (k + 1) / m, V = (t, w) => { const nx = N2[i][0] + (N2[i + 1][0] - N2[i][0]) * t, nz = N2[i][1] + (N2[i + 1][1] - N2[i][1]) * t, x = a[0] + (b[0] - a[0]) * t + nx * w, z = a[1] + (b[1] - a[1]) * t + nz * w; return [x, gy(x, z) + dy, z]; };
        const Q = [V(t0, w0), V(t1, w0), V(t1, w1), V(t0, w1)]; B.poly(mat, Q, [0, 1, 0], { color: col, uvs: Q.map(p => [p[0] / uv, p[2] / uv]) }); } } };
  { const pts = lane.pts.slice(), e = pts[pts.length - 1], q = pts[pts.length - 2] || pts[0], l = Math.hypot(e[0] - q[0], e[1] - q[1]) || 1; pts[pts.length - 1] = [e[0] + (e[0] - q[0]) / l * 1.5, e[1] + (e[1] - q[1]) / l * 1.5];
    ribbon(pts, -1.7, 1.7, 'concrete', [0.8, 0.79, 0.76], 0.06); ribbon(pts, -2.15, -1.7, 'gravelPath', [0.78, 0.72, 0.62], 0.05, 2.5); ribbon(pts, 1.7, 2.15, 'gravelPath', [0.78, 0.72, 0.62], 0.05, 2.5);
    let run = 0; for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let t = 0; t <= L; t += 2) { const px = a[0] + (b[0] - a[0]) * t / L, pz = a[1] + (b[1] - a[1]) * t / L; if (!onWay(px, pz)) occRect(px, pz, 2.2, 2.2, 0, 1); }
      { const near = (x, z, w) => { const t = Math.max(0, Math.min(1, ((x - a[0]) * (b[0] - a[0]) + (z - a[1]) * (b[1] - a[1])) / (L * L || 1))); return Math.hypot(x - a[0] - (b[0] - a[0]) * t, z - a[1] - (b[1] - a[1]) * t) < w ? 1 : 0; };
        hf.paint2(2, Math.min(a[0], b[0]) - 3, Math.min(a[1], b[1]) - 3, Math.max(a[0], b[0]) + 3, Math.max(a[1], b[1]) + 3, (x, z) => near(x, z, 2.4)); hf.paintPave(Math.min(a[0], b[0]) - 3, Math.min(a[1], b[1]) - 3, Math.max(a[0], b[0]) + 3, Math.max(a[1], b[1]) + 3, (x, z) => near(x, z, 2.2)); }
      for (let t = 0; t < L; t += 1) { run += 1; if (run % 24 === 12) { const px = a[0] + (b[0] - a[0]) * t / L, pz = a[1] + (b[1] - a[1]) * t / L, nx = -(b[1] - a[1]) / L, nz = (b[0] - a[0]) / L; laneLamps.push([px + nx * 2.6, pz + nz * 2.6]); } } } }
  drape('gravelPath', -25.5, 3.0, 6.25, 14.6, [0.86, 0.8, 0.7], 1.5, 0.045, 2); // (the yard)
  drape('gravelPath', -10.2, -2.8, 0.85, 6.25, [0.84, 0.78, 0.68], 1.5, 0.045, 2); // (the storehouse's apron)
  drape('gravelPath', 3.0, FX + 1.1, 7.4, 8.8, [0.84, 0.78, 0.68], 1.5, 0.045, 2); drape('gravelPath', FX - 1.1, FX + 1.1, GATE - 0.2, 7.4, [0.84, 0.78, 0.68], 1, 0.045, 2); // (to the field's gate)
  // the field's ground: tilled earth
  drape('soil', FX - FW / 2 - FENCE, FX + FW / 2 + FENCE, FZ - FD / 2 - FENCE, GATE, [0.52, 0.42, 0.33], 1.5, 0.035);
  // ---- the models
  const MODEL_IDS = ['i_door', 'i_couch_large', 'i_table_round_large', 'i_table_round_small', 'i_chair_2', 'i_night_stand_2', 'i_table_lamp', 'i_drawer_5', 'i_kitchen_sink', 'i_bathtub', 'i_toilet', 'i_bathroom_sink', 'i_washing_machine', 'i_round_rug', 'i_rug',
    'i_houseplant_2', 'i_houseplant_4', 'i_houseplant_5', 'i_houseplant_6', 'i_light_ceiling', 'i_light_ceiling_2', 'i_towel_rack', 'i_toilet_paper_stack',
    'h_refrigirator', 'h_stove', 'h_bed', 'h_desk', 'h_computer', 'h_chair', 'h_desk_lamp', 'h_monitor', 'h_rocking_chair', 'h_coat_rack', 'h_closed_umbrella', 'h_fruit_bowl', 'h_frying_pan', 'h_cup_of_tea', 'h_books', 'h_alarm_clock', 'h_globe', 'h_flowers', 'h_barbecue', 'h_watering_can', 'h_grandfathers_clock'];
  await loadModels(MODEL_IDS);
  const { MT, indoor } = interiorKit();
  // the rooms' own builder and materials: interiors.js's, without the sun
  const homeIndoor = (m, key, em = 0) => { indoor(m, 'home:' + key, em); const ob = m.onBeforeCompile; m.onBeforeCompile = (sh, rr) => { ob(sh, rr); sh.fragmentShader = sh.fragmentShader.replace('directLight.color *= 0.5;', 'directLight.color *= 0.0;'); }; m.customProgramCacheKey = () => 'indoorHome:' + key; return m; };
  const HB = new GeoBuilder(48), HMT = {}; for (const [k, m] of Object.entries(MT)) HMT[k] = k === 'glass' ? m : homeIndoor(m.clone(), k, m.emissive && m.emissive.getHex() && m.emissiveIntensity > 0 ? m.emissiveIntensity : 0);
  const tris = [];
  const cap = [capHooks.bucket, capHooks.collider, capHooks.prop, capHooks.frame]; capHooks.bucket = capHooks.collider = capHooks.prop = capHooks.frame = null; // (the farm is the player's own, not a World Builder object)
  // ---------------------------------------------------------------- the house
  const [hx, hz] = S(HX, HZ), Y = lev - 0.02;
  const Hp = (lx, ly, lz) => [hx + lx * c + lz * s, Y + ly, hz - lx * s + lz * c];
  const HM = new THREE.Matrix4().compose(new THREE.Vector3(hx, Y, hz), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r), new THREE.Vector3(1, 1, 1));
  // the model cut open: the front door's opening (the leaf taken out to swing), the lower roof and the upper storey's
  // floor where they run through the upper storey, anything inside the ground floor
  const cut = cutModel(packParts('jp_house_01'), [[[DOOR[0], DOOR[1]], [-0.2, DOOR[2]], [3.36, 3.53]], [[-3.16, 2.56], [3.6, 7.5], [-3.53, 1.28]], [[-3.85, 3.85], [-0.5, 3.2], [-3.57, 3.40]]],
    [[[DOOR[0] - 0.01, DOOR[1] + 0.02], [0.02, DOOR[2] + 0.02], [3.53, 3.72]]]);
  meshGroup(cut.keep, HM); trisOf(cut.keep, HM, tris);
  // the windows lit at night: additive panes just outside the model's own (their strength set by the hour: homeRuntime)
  const glow = new THREE.Group(), gmat = new THREE.MeshBasicMaterial({ color: 0xffb35c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: true });
  const pane2 = (x0, x1, y0, y1, side, at) => { const w = x1 - x0, h = y1 - y0, m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), gmat), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    if (side === 'F') m.position.set(cx, cy, at); else { m.position.set(at, cy, cx); m.rotation.y = side === 'L' ? -Math.PI / 2 : Math.PI / 2; } glow.add(m); };
  pane2(-3.09, -1.18, 1.02, 2.26, 'F', 3.48); pane2(0.58, 2.55, 2.41, 2.84, 'F', 3.6); pane2(0.93, 1.30, 1.66, 2.04, 'F', 3.63);
  for (const [a, b] of [[-1.67, -0.75], [-0.69, 0.23], [0.30, 1.22]]) pane2(a, b, 1.03, 2.28, 'L', -3.95); for (const [a, b] of [[-1.60, -0.68], [-0.61, 0.31], [0.37, 1.29]]) pane2(a, b, 1.03, 2.28, 'R', 3.94);
  for (const [a, b] of [[-2.13, -1.18], [-1.14, -0.22]]) pane2(a, b, 4.71, 5.95, 'L', -3.2); for (const [a, b] of [[-1.87, -0.87], [-0.80, 0.20], [0.27, 1.27]]) pane2(a, b, 6.04, 7.40, 'F', 1.35);
  glow.position.set(hx, Y, hz); glow.rotation.y = r; glow.traverse(o => { o.userData.noDistCull = true; }); glow.updateMatrixWorld(true); scene.add(glow);
  lampPoints.push({ p: Hp(2.25, 2.45, 4.15), s: 0.1, c: [1, 0.78, 0.5] }, { p: Hp(0.95, 1.6, 9.7), s: 0.06, c: [1, 0.8, 0.55] });
  // the garden (the pack's dressing) and its wall (a collider of its own triangles)
  const wallTris = [];
  for (const [id, x, y, z, yaw, sc] of KIT) { if (!P.models[id]) continue; const [px, py, pz] = Hp(x, y, z), ry = r + yaw * Math.PI / 180;
    packProp(id, px, py, pz, ry, sc);
    if (/walls_poarch|entrance_fence|entrance_edge/.test(id)) trisOf(P.models[id].parts.map(q => ({ geometry: q.geometry })), new THREE.Matrix4().compose(new THREE.Vector3(px, py, pz), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(sc, sc, sc)), wallTris);
    else if (/bicycle|airconditioner|plants_box|wall_flowerbed/.test(id)) { const d = P.models[id].dims; addBox(px, pz, d[0] * sc / 2, d[2] * sc / 2, ry, py - 1, py + d[1] * sc); } }
  addCompound(buildCompound(new Float32Array(wallTris), { x: hx, y: Y, z: hz, r, ground: (x, z) => gy(x, z) }, 'wall'));
  // stepping stones from the gate to the door
  B.frame(hx, Y, hz, r);
  for (let k = 0; k < 6; k++) { const t = k / 5, x = -0.25 + (1.12 + 0.25) * t, z = 9.0 + (3.95 - 9.0) * t; B.bbox('stone', x + (k % 2 ? 0.08 : -0.08), -0.05, z, 0.62, 0.1, 0.5, 0.03, { color: [0.6, 0.58, 0.55] }); }
  B.bbox('concrete', (DOOR[0] + DOOR[1]) / 2 + 0.35, -0.1, 3.95, 2.2, 0.16, 0.75, 0.02, { color: [0.7, 0.69, 0.66] }); // (the door step)
  // ---------------------------------------------------------------- the rooms (their own builder and materials)
  // The rooms take no direct sun: the pack's shell is single-sided, so the sun's shadows through it were wrong (they
  // swam over the floors as the camera moved); the rooms are lit by the sky's light, the bounce and their lamps.
  const IN = [0.94, 0.91, 0.85], TRIM = [0.42, 0.29, 0.18], DARKW = [0.36, 0.25, 0.16]; HB.lod = 2; // (the rooms: seen only from near, drawn within ~90 m)
  // an inner wall face on the plane of one side ('F' front, 'K' back, 'L' left, 'R' right) at `at`, from a0 to a1 along
  // it (house x for F/K, house z for L/R), y0..y1, with openings [{a0, a1, y0, y1, glass?}] and their reveals d deep;
  // skirting boards (in front of the wall, never in its plane) along [[a0, a1, y]] (default: the whole foot)
  const skin = (side, at, a0, a1, y0, y1, holes, skirts = null, d = 0.12) => {
    const th = { F: Math.PI, K: 0, L: Math.PI / 2, R: -Math.PI / 2 }[side], u = side === 'F' || side === 'L' ? a => -a : a => a;
    const o = side === 'F' || side === 'K' ? Hp(0, 0, at) : Hp(at, 0, 0); HB.frame(o[0], Y, o[2], r + th);
    const H2 = holes.map(h => ({ x0: Math.min(u(h.a0), u(h.a1)), x1: Math.max(u(h.a0), u(h.a1)), y0: h.y0, y1: h.y1, d, glass: h.glass }));
    wallFill(HB, 'matte', Math.min(u(a0), u(a1)), Math.max(u(a0), u(a1)), y0, y1, H2, IN, 3);
    for (const [s0, s1, sy] of skirts || [[a0, a1, y0]]) { const lo = Math.min(u(s0), u(s1)), hi = Math.max(u(s0), u(s1)), cuts = H2.filter(h => h.y0 <= sy + 0.08).sort((p, q) => p.x0 - q.x0); let x = lo;
      for (const [c0, c1] of [...cuts.map(h => [h.x0, h.x1]), [hi, hi]]) { if (c0 > x + 0.01) HB.box('wood', (x + Math.min(c0, hi)) / 2, sy, 0.009, Math.min(c0, hi) - x, 0.07, 0.016, { color: DARKW }); x = Math.max(x, c1); } }
    for (const h of H2) { reveals(HB, 'matte', h, [0.88, 0.85, 0.79]); const w = h.x1 - h.x0, hh = h.y1 - h.y0, cx = (h.x0 + h.x1) / 2;
      if (h.y0 > y0 + 0.1) HB.box('wood', cx, h.y0 - 0.026, -0.02, w + 0.08, 0.03, 0.12, { color: TRIM }); // (the sill: its top just over the opening's)
      for (const x of [h.x0 - 0.025, h.x1 + 0.025]) HB.box('wood', x, h.y0, 0.012, 0.05, hh + 0.04, 0.02, { color: TRIM }); HB.box('wood', cx, h.y1, 0.012, w + 0.1, 0.05, 0.02, { color: TRIM });
      if (h.glass) { const zp = -d + 0.04, nx = Math.max(2, Math.round(w / 0.3)), ny = Math.max(3, Math.round(hh / 0.3)), L = [0.62, 0.48, 0.32], Fr = [0.55, 0.4, 0.26]; // (shoji: paper behind a lattice)
        HB.quad('paper', [h.x0, h.y0, zp], [h.x1, h.y0, zp], [h.x1, h.y1, zp], [h.x0, h.y1, zp], { color: [1, 0.97, 0.9] });
        for (let i = 1; i < nx; i++) HB.box('wood', h.x0 + w * i / nx, h.y0, zp + 0.02, 0.018, hh, 0.02, { color: L }); for (let j = 1; j < ny; j++) HB.box('wood', cx, h.y0 + hh * j / ny - 0.009, zp + 0.02, w, 0.018, 0.02, { color: L });
        for (const x of [h.x0 + 0.02, h.x1 - 0.02]) HB.box('wood', x, h.y0, zp + 0.03, 0.04, hh, 0.03, { color: Fr }); for (const y of [h.y0, h.y1 - 0.04]) HB.box('wood', cx, y, zp + 0.03, w - 0.08, 0.04, 0.03, { color: Fr }); } }
    HB.frame(hx, Y, hz, r);
  };
  const pane = (a0, a1, y0, y1) => ({ a0, a1, y0, y1, glass: true });
  // ground floor: the front (the kitchen's window; the genkan's door), the sides' windows (three panes each), the back
  skin('F', IZ1, IX0, 0.35, FG, C0, [pane(-3.09, -1.18, 1.02, 2.26)]);
  skin('F', IZ1, 0.35, IX1, FK, C0, [{ a0: DOOR[0], a1: DOOR[1], y0: FK, y1: DOOR[2] }]);
  skin('L', IX0, IZ0, IZ1, FG, C0, [pane(-1.67, -0.75, 1.03, 2.28), pane(-0.69, 0.23, 1.03, 2.28), pane(0.30, 1.22, 1.03, 2.28)]);
  skin('R', IX1, IZ0, IZ1, FG, C0, [pane(-1.60, -0.68, 1.03, 2.28), pane(-0.61, 0.31, 1.03, 2.28), pane(0.37, 1.29, 1.03, 2.28)]);
  skin('K', IZ0, IX0, IX1, FG, C0, []);
  // upper floor: the left wall's window, the front's high windows; the back wall down into the stairwell
  skin('L', UX0, UZ0, UZ1, FU, C1, [pane(-2.13, -1.18, 4.71, 5.95), pane(-1.14, -0.22, 4.71, 5.95)]);
  skin('F', UZ1, UX0, UX1, FU, C1, [pane(-1.87, -0.87, 6.04, C1 - 0.02), pane(-0.80, 0.20, 6.04, C1 - 0.02), pane(0.27, 1.27, 6.04, C1 - 0.02)]);
  skin('R', UX1, UZ0, UZ1, FU, C1, []);
  skin('K', UZ0, UX0, UX1, C0, C1, [], [[UX0, HOLE[0], FU], [HOLE[1], UX1, FU]]);
  // floors, ceilings, the slab between them with its stairwell
  const up = (mat, x0, z0, x1, z1, y, col = [1, 1, 1], uv = 1) => HB.poly(mat, [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], [0, 1, 0], { color: col, uv });
  const snapHB = () => { const m = new Map(); for (const [k, b] of HB.parts) m.set(k, b.idx.length); return m; }, noCollide = [], drawOnly = fn => { const a = snapHB(); fn(); for (const [k, n1] of snapHB()) { const n0 = a.get(k) || 0; if (n1 > n0) noCollide.push([k, n0, n1]); } };
  // (the ceilings are drawn only: a ceiling at the walls' top would merge with them into solid cells of the collider)
  const down = (mat, x0, z0, x1, z1, y, col = [0.92, 0.88, 0.82], uv = 1.2) => drawOnly(() => HB.poly(mat, [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], [0, -1, 0], { color: col, uv }));
  const BX = 1.35, BZ = 0.34; // (the bathrooms' block: x from BX, z to BZ)
  up('woodWarm', IX0, IZ0, BX, 2.0, FG); up('woodWarm', IX0, 2.0, 0.35, IZ1, FG); up('woodWarm', BX, BZ, IX1, 2.0, FG); up('kitchen', BX, IZ0, IX1, BZ, FG, [1, 1, 1], 1.3);
  up('stone', 0.35, 2.0, IX1, IZ1, FK, [0.9, 0.88, 0.85]);
  HB.box('wood', (0.35 + IX1) / 2, FK, 2.03, IX1 - 0.35, FG - FK - 0.004, 0.06, { color: DARKW }); // (the step up from the genkan)
  down('boards', IX0, IZ0, HOLE[0], STAIR_Z[1], C0); down('boards', HOLE[1], IZ0, IX1, STAIR_Z[1], C0); down('boards', IX0, STAIR_Z[1], IX1, IZ1, C0);
  up('woodWarm', UX0, STAIR_Z[1], UX1, UZ1, FU); up('woodWarm', UX0, UZ0, HOLE[0], STAIR_Z[1], FU); up('woodWarm', HOLE[1], UZ0, UX1, STAIR_Z[1], FU);
  HB.quad('matte', [HOLE[0], C0, STAIR_Z[1]], [HOLE[1], C0, STAIR_Z[1]], [HOLE[1], FU, STAIR_Z[1]], [HOLE[0], FU, STAIR_Z[1]], { color: IN }); // (the stairwell's sides)
  HB.quad('matte', [HOLE[1], C0, STAIR_Z[1]], [HOLE[0], C0, STAIR_Z[1]], [HOLE[0], FU, STAIR_Z[1]], [HOLE[1], FU, STAIR_Z[1]], { color: IN });
  HB.poly('matte', [[HOLE[0], C0, UZ0], [HOLE[0], C0, STAIR_Z[1]], [HOLE[0], FU, STAIR_Z[1]], [HOLE[0], FU, UZ0]], [1, 0, 0], { color: IN });
  HB.poly('matte', [[HOLE[1], C0, UZ0], [HOLE[1], C0, STAIR_Z[1]], [HOLE[1], FU, STAIR_Z[1]], [HOLE[1], FU, UZ0]], [-1, 0, 0], { color: IN });
  for (const [x0, x1, z0, z1] of [[UX0, UX1, STAIR_Z[1], UZ1], [UX0, HOLE[0], UZ0, STAIR_Z[1]], [HOLE[1], UX1, UZ0, STAIR_Z[1]]]) HB.box('matte', (x0 + x1) / 2, C0 + 0.02, (z0 + z1) / 2, x1 - x0, FU - C0 - 0.04, z1 - z0, { color: IN, skip: 'py ny' }); // (the slab's solid)
  down('boards', UX0, UZ0, UX1, UZ1, C1, [0.93, 0.9, 0.84]);
  // the staircase (1.2 m wide): a closed run of solid steps along the back wall, a handrail on its open side; the upper
  // floor's railing. It is kept out of the house's collider (0.2 m cells mix two risers of 0.24 m treads into one wall)
  // and collides as its treads and its open side
  const RISE = (FU - FG) / NSTEP, stair0 = snapHB();
  for (let k = 1; k < NSTEP; k++) { const x = STAIR_X0 + (k - 0.5) * STEP; HB.box('wood', x, FG, (STAIR_Z[0] + STAIR_Z[1]) / 2, STEP, k * RISE, STAIR_Z[1] - STAIR_Z[0], { color: k % 2 ? [0.62, 0.45, 0.3] : [0.58, 0.42, 0.28] }); }
  { const zr = STAIR_Z[1] + 0.04, xa = STAIR_X0 + 0.1, xb = HOLE[1] - 0.1, ya = FG + RISE + 0.9, yb = FU + 0.9 - RISE;
    HB.beam('wood', [xa, ya, zr], [xb, yb, zr], 0.05, 0.06, { color: DARKW }); for (const t of [0, 0.33, 0.66, 1]) { const x = xa + (xb - xa) * t, y = FG + RISE * Math.max(1, Math.round((x - STAIR_X0) / STEP + 0.5)); HB.box('wood', x, y, zr, 0.05, ya + (yb - ya) * t - y, 0.05, { color: DARKW }); } }
  for (const [k, n1] of snapHB()) { const n0 = stair0.get(k) || 0; if (n1 > n0) noCollide.push([k, n0, n1]); }
  { const y = FU, h = 0.92; HB.box('wood', (HOLE[0] + HOLE[1]) / 2 - 0.2, y + h - 0.05, STAIR_Z[1] + 0.03, HOLE[1] - HOLE[0] - 0.4, 0.05, 0.06, { color: DARKW }); HB.box('wood', HOLE[0] + 0.03, y + h - 0.05, (UZ0 + STAIR_Z[1]) / 2, 0.06, 0.05, STAIR_Z[1] - UZ0, { color: DARKW });
    for (let x = HOLE[0] + 0.03; x < HOLE[1] - 0.45; x += 0.12) HB.box('wood', x, y, STAIR_Z[1] + 0.03, 0.025, h - 0.05, 0.025, { color: TRIM });
    for (let z = UZ0 + 0.06; z < STAIR_Z[1]; z += 0.12) HB.box('wood', HOLE[0] + 0.03, y, z, 0.025, h - 0.05, 0.025, { color: TRIM }); }
  { const T = (a, b, c) => { for (const p of [a, b, c]) tris.push(...Hp(p[0], p[1], p[2])); }, [z0, z1] = STAIR_Z;
    for (let k = 1; k < NSTEP; k++) { const x0 = STAIR_X0 + (k - 1) * STEP, x1 = x0 + STEP, h = FG + k * RISE; T([x0, h, z0], [x0, h, z1], [x1, h, z1]); T([x0, h, z0], [x1, h, z1], [x1, h, z0]); // (a tread, facing up)
      T([x0, FG, z1], [x1, FG, z1], [x1, h, z1]); T([x0, FG, z1], [x1, h, z1], [x0, h, z1]); } // (the open side, below the tread)
    const zr = z1 + 0.03; T([HOLE[0], FU, zr], [HOLE[1] - 0.45, FU, zr], [HOLE[1] - 0.45, FU + 0.95, zr]); T([HOLE[0], FU, zr], [HOLE[1] - 0.45, FU + 0.95, zr], [HOLE[0], FU + 0.95, zr]); // (the railing upstairs)
    T([HOLE[0] + 0.03, FU, UZ0], [HOLE[0] + 0.03, FU, zr], [HOLE[0] + 0.03, FU + 0.95, zr]); T([HOLE[0] + 0.03, FU, UZ0], [HOLE[0] + 0.03, FU + 0.95, zr], [HOLE[0] + 0.03, FU + 0.95, UZ0]); }
  // partitions: the genkan's side; the bathrooms' block — the washroom along its west side, the toilet and the bathroom
  // by the right wall (their windows the right wall's panes)
  const wallZ = (x, za, zb, gaps, y0 = FG) => { let z = za; for (const [g0, g1] of [...gaps, [zb, zb]]) { if (g0 > z) HB.box('matte', x, y0, (z + g0) / 2, 0.1, C0 - y0, g0 - z, { color: IN }); if (g1 > g0) HB.box('matte', x, y0 + 2.1, (g0 + g1) / 2, 0.1, C0 - y0 - 2.1, g1 - g0, { color: IN }); z = g1; } };
  const wallX = (z, xa, xb, gaps, y0 = FG) => { let x = xa; for (const [g0, g1] of [...gaps, [xb, xb]]) { if (g0 > x) HB.box('matte', (x + g0) / 2, y0, z, g0 - x, C0 - y0, 0.1, { color: IN }); if (g1 > g0) HB.box('matte', (g0 + g1) / 2, y0 + 2.1, z, g1 - g0, C0 - y0 - 2.1, 0.1, { color: IN }); x = g1; } };
  const WASH_DOOR = [1.5, 2.37], WX = 2.55, WC_DOOR = [-0.6, 0.27], BATH_GAP = [-1.5, -0.68], WCZ = -0.645;
  wallZ(0.35, 2.0, IZ1, [], FK); wallZ(BX, IZ0, BZ, []); wallX(BZ, BX, IX1, [WASH_DOOR]); wallZ(WX, IZ0, BZ, [BATH_GAP, WC_DOOR]); wallX(WCZ, WX, IX1, []);
  for (const sd of [-1, 1]) { const xx = WASH_DOOR, z = BZ; HB.box('wood', xx[0] - 0.03, FG, z + sd * 0.056, 0.06, 2.12, 0.012, { color: TRIM }); HB.box('wood', xx[1] + 0.03, FG, z + sd * 0.056, 0.06, 2.12, 0.012, { color: TRIM }); HB.box('wood', (xx[0] + xx[1]) / 2, FG + 2.1, z + sd * 0.056, xx[1] - xx[0] + 0.12, 0.06, 0.012, { color: TRIM });
    for (const zz of [WC_DOOR, BATH_GAP]) { HB.box('wood', WX + sd * 0.056, FG, zz[0] - 0.03, 0.012, 2.12, 0.06, { color: TRIM }); HB.box('wood', WX + sd * 0.056, FG, zz[1] + 0.03, 0.012, 2.12, 0.06, { color: TRIM }); HB.box('wood', WX + sd * 0.056, FG + 2.1, (zz[0] + zz[1]) / 2, 0.012, 0.06, zz[1] - zz[0] + 0.12, { color: TRIM }); } }
  // the kitchen counter along the front wall (fridge, sink and stove stand in its gaps), the hood; the genkan's shoe cupboard
  for (const [a, b] of [[-2.93, -2.32], [-1.80, -1.02], [-0.37, 0.25]]) { HB.box('wood', (a + b) / 2, FG, IZ1 - 0.31, b - a, 0.84, 0.6, { color: [0.78, 0.6, 0.42] }); HB.box('gloss', (a + b) / 2, FG + 0.84, IZ1 - 0.31, b - a + 0.02, 0.04, 0.64, { color: [0.3, 0.29, 0.28] }); }
  HB.box('metal', -0.69, FG + 1.62, IZ1 - 0.2, 0.72, 0.36, 0.38, { color: [0.75, 0.75, 0.76] }); HB.box('matte', -0.69, FG + 1.98, IZ1 - 0.12, 0.3, C0 - FG - 1.98, 0.22, { color: [0.8, 0.8, 0.8] });
  HB.box('wood', -1.4, FG + 1.62, IZ1 - 0.17, 1.2, 0.04, 0.3, { color: [0.62, 0.45, 0.3] }); // (a shelf)
  HB.box('wood', IX1 - 0.22, FK, 2.7, 0.42, 1.0, 1.15, { color: [0.48, 0.34, 0.22] }); HB.box('wood', IX1 - 0.22, FK + 1.0, 2.7, 0.46, 0.03, 1.19, { color: DARKW });
  // the tatami corner upstairs
  up('tatami', 0.45, -2.15, UX1, 0.15, FU + 0.012, [1, 1, 1], 0.9); for (const [x0, x1, z0, z1] of [[0.45, UX1, -2.17, -2.13], [0.45, UX1, 0.13, 0.17], [0.43, 0.47, -2.17, 0.17]]) HB.box('wood', (x0 + x1) / 2, FU, (z0 + z1) / 2, x1 - x0, 0.03, z1 - z0, { color: [0.2, 0.18, 0.15] });
  for (const [x, z] of [[0.75, -1.0], [2.15, -1.0], [1.45, -0.25], [1.45, -1.75]]) HB.bbox('matte', x, FU + 0.014, z, 0.5, 0.08, 0.5, 0.03, { color: [0.62, 0.2, 0.18] });
  // lamps
  for (const [lx, ly, lz, i] of [[-1.9, C0, 1.5, 7], [-0.6, C0, -1.0, 7.5], [2.55, C0, 1.2, 5.5], [1.9, C0, 2.7, 4.5], [1.95, C0, -1.2, 5], [3.15, C0, -0.15, 3.5], [3.15, C0, -2.2, 4.5], [-0.6, FU + 2.4, -2.9, 5],
    [-1.9, C1, -0.4, 7], [1.2, C1, -0.6, 7]]) lampPoints.push(roomLamp(Hp(lx, ly - 0.35, lz), i, [1.0, 0.86, 0.68], 4.2));
  HB.lod = 0;
  // ---------------------------------------------------------------- the furniture
  // place(id, x, floorY, z, yaw, k): the model's footprint centred at (x, z) of the house, its front (+z) turned by yaw
  // (yaw = atan2(dx, dz) faces (dx, dz)), k: its size against the pack's own (a number or [x, y, z])
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), Yax = new THREE.Vector3(0, 1, 0), _v = new THREE.Vector3(), _s = new THREE.Vector3(), mats = new Map();
  const inMat = m => { if (!mats.has(m)) { const k = homeIndoor(m.clone(), 'glb'); k.envMapIntensity = 0.6; mats.set(m, k); } return mats.get(m); };
  const place = (id, lx, ly, lz, yaw = 0, k = 1, collide = true, centred = true) => {
    const Pm = models.get(id); if (!Pm) return; const b = SC(id), K = Array.isArray(k) ? k.map(v => v * b) : [k * b, k * b, k * b], bx = BOX[id];
    let ox = 0, oz = 0; if (centred && bx) { ox = (bx.min[0] + bx.size[0] / 2) * K[0]; oz = (bx.min[2] + bx.size[2] / 2) * K[2]; }
    const cy = Math.cos(yaw), sy = Math.sin(yaw), w = Hp(lx - (ox * cy + oz * sy), ly, lz - (-ox * sy + oz * cy));
    _m.compose(_v.set(w[0], w[1], w[2]), _q.setFromAxisAngle(Yax, r + yaw), _s.set(K[0], K[1], K[2]));
    const parts = Pm.map(p => ({ geometry: p.geometry, material: inMat(p.material), matrix: _m.clone().multiply(p.m), castShadow: false, near: 90 }));
    addProp('home:' + id, parts); if (collide) for (const p of parts) trisOf([p], p.matrix, tris);
  };
  const F = FG + 0.005, U = FU + 0.005, PI = Math.PI;
  // kitchen and dining (a table for four along the kitchen: the way past the couch stays free)
  place('h_refrigirator', -3.33, F, IZ1 - 0.42, PI); place('i_kitchen_sink', -2.06, F, IZ1 - 0.3, PI, [1, 0.92, 1]); place('h_stove', -0.69, F, IZ1 - 0.42, PI);
  place('h_frying_pan', -0.6, F + 0.95, IZ1 - 0.42, 0.4, 1, false); place('h_flowers', -1.55, F + 0.88, IZ1 - 0.25, 0, 0.8, false); place('h_cup_of_tea', 0.0, F + 0.88, IZ1 - 0.3, 0, 1, false);
  place('i_table_round_large', -1.9, F, 1.2, 0, [0.75, 1.3, 0.85]); for (const [x, z, y] of [[-2.35, 1.83, PI], [-1.45, 1.83, PI], [-2.85, 1.2, PI / 2], [-0.95, 1.2, -PI / 2]]) place('i_chair_2', x, F, z, y, 1);
  place('h_fruit_bowl', -1.9, F + 0.73, 1.2, 0, 1, false); place('i_light_ceiling', -1.9, C0, 1.2, 0, 1, false, false);
  // living room: the TV on a low chest against the bathrooms' wall, the couch facing it over a low table on a round rug
  place('i_drawer_5', BX - 0.31, F, -1.0, -PI / 2); place('i_houseplant_6', BX - 0.3, F + 0.67, -1.55, 0, 1.5, false); place('h_monitor', BX - 0.33, F + 0.67, -1.0, -PI / 2, 1.6, false); place('i_round_rug', -0.35, F, -1.0, 0, 1.5, false);
  place('i_couch_large', -1.3, F, -1.0, PI / 2, 0.72); place('i_table_round_small', -0.15, F, -1.0, 0, [0.5, 0.7, 0.5]); place('h_books', -0.1, F + 0.42, -1.0, 0.5, 1, false);
  place('i_houseplant_5', -3.45, F, 2.1, 0, 1.4); place('i_light_ceiling_2', -0.6, C0, -1.0, 0, 1, false, false);
  // the corner by the right windows: a rocking chair, the clock, a plant
  place('h_rocking_chair', 2.95, F, 1.3, -2.5); place('h_grandfathers_clock', 3.45, F, BZ + 0.2, 0, 1); place('i_houseplant_4', 1.65, F, 1.6, 0, 1.6);
  // genkan: coat rack, umbrella, a plant on the shoe cupboard
  place('h_coat_rack', 2.95, FK, 2.25, 0, 1); place('h_closed_umbrella', 2.85, FK, 3.1, 0, 1, false); place('i_houseplant_6', IX1 - 0.22, FK + 1.03, 2.5, 0, 1.6, false);
  // washroom (basin, washing machine), toilet, bathroom (the bath by the right wall)
  place('i_bathroom_sink', BX + 0.26, F, -1.1, PI / 2); place('i_washing_machine', BX + 0.38, F, -2.35, PI / 2); place('i_towel_rack', BX + 0.06, F + 1.3, -1.75, PI / 2, 1, false, false);
  place('i_toilet', IX1 - 0.45, F, -0.17, -PI / 2); place('i_toilet_paper_stack', IX1 - 0.12, F, 0.22, 0, 1, false);
  place('i_bathtub', IX1 - 0.44, F, -2.35, 0); place('i_towel_rack', WX + 0.07, F + 1.25, -2.6, PI / 2, 1, false, false);
  // upstairs: the bed against the front wall, a night stand and lamp; the desk under the window; the bookshelf on the
  // tatami's side; the tatami's low table
  place('h_bed', -2.2, U, 0.07, PI, 0.8); place('i_night_stand_2', -0.95, U, 0.9, PI); place('i_table_lamp', -0.95, U + 0.41, 0.9, 0, 1, false); place('h_alarm_clock', -0.85, U + 0.41, 0.75, PI - 0.4, 1, false);
  place('h_desk', 0.8, U, 0.85, PI, [0.75, 1.2, 0.75]); place('h_chair', 0.8, U, 0.2, 0); place('h_computer', 0.62, U + 0.73, 0.95, PI, 1, false); place('h_desk_lamp', 1.2, U, 0.95, PI, 1, false); place('h_globe', 0.25, U + 0.73, 0.95, 0, 1, false);
  place('i_houseplant_2', UX0 + 0.3, U, -1.9, 0, 1.6);
  place('i_table_round_small', 1.45, U, -1.0, 0, [0.85, 0.5, 0.85]); place('h_cup_of_tea', 1.35, U + 0.3, -0.95, 0, 1, false);
  place('i_rug', -2.2, U, -1.6, PI / 2, 1.3, false); place('i_light_ceiling', -1.9, C1, -0.4, 0, 1, false, false); place('i_light_ceiling', 1.2, C1, -0.6, 0, 1, false, false);
  if (P.models.jp_book_shelf_01) { const [px, py, pz] = Hp(UX1 - 0.33, U, 0.25); const m = P.models.jp_book_shelf_01; addProp('home:shelf', m.parts.map(q => ({ geometry: q.geometry, material: inMat(q.material), matrix: new THREE.Matrix4().compose(new THREE.Vector3(px, py, pz), new THREE.Quaternion().setFromAxisAngle(Yax, r - PI / 2), new THREE.Vector3(1, 1, 1)), near: 90 }))); addBox(px, pz, 0.47, 0.33, r - PI / 2, py - 0.2, py + 2.3); }
  // ---------------------------------------------------------------- doors (their leaves move: E)
  const doors = [];
  const leaf = (parts, hinge, yaw0, openSign, w, name, M0 = null, floorY = FG) => { // parts in a frame whose origin is the hinge
    const g = new THREE.Group(); for (const q of parts) { const m = new THREE.Mesh(q.geometry, q.material); m.castShadow = true; m.receiveShadow = true; if (q.m) m.applyMatrix4(q.m); g.add(m); }
    if (M0) g.children.forEach(m => m.applyMatrix4(M0));
    const p = Hp(hinge[0], hinge[1], hinge[2]); g.position.set(p[0], p[1], p[2]); g.rotation.y = r + yaw0; g.updateMatrixWorld(true); scene.add(g);
    const dx = Math.cos(yaw0) * w / 2, dz = -Math.sin(yaw0) * w / 2, mid = Hp(hinge[0] + dx, 0, hinge[2] + dz);
    const col2 = { t: 1, x: mid[0], z: mid[2], hx: w / 2, hz: 0.07, c: Math.cos(r + yaw0), s: Math.sin(r + yaw0), y0: p[1] - 0.3, y1: p[1] + 2.2 };
    const d = { name, x: mid[0], z: mid[2], y: Y + floorY, t: 0, want: 0, on: true, move(t) { g.rotation.y = r + yaw0 + openSign * t * 1.5; g.updateMatrixWorld(true); }, block(v) { if (v === this.on) return; this.on = v; if (v) colInsert(col2); else colRemove(col2); } };
    colInsert(col2); doors.push(d); return d;
  };
  // the front door: the model's own leaf, hinged at its left edge, opening outward (as a genkan's door does)
  leaf(cut.take[0], [DOOR[0] + 0.02, FK, 3.585], 0, -1, DOOR[1] - DOOR[0], 'Front door', new THREE.Matrix4().makeTranslation(-(DOOR[0] + 0.02), -FK, -3.585), FK);
  const iDoor = models.get('i_door'), DS = SC('i_door');
  if (iDoor) { const scaled = iDoor.map(p => ({ geometry: p.geometry, material: inMat(p.material), m: new THREE.Matrix4().makeScale(DS, DS, DS).multiply(p.m) }));
    // (the pack's door: 0.87 m, its hinge at its origin, the leaf along -x): the washroom's opens into the room before
    // it, the toilet's into the toilet (out into the washroom it would close the washroom's door)
    leaf(scaled, [WASH_DOOR[0], FG, BZ], 0, -1, 0.87, 'Washroom door', new THREE.Matrix4().makeRotationY(PI));
    leaf(scaled, [WX, FG, WC_DOOR[1]], PI / 2, -1, 0.87, 'Toilet door', new THREE.Matrix4().makeRotationY(PI)); }
  // ---------------------------------------------------------------- the farmyard
  const put = (id, lx, lz, yaw = 0, sc = 1, collide = 'box', dy = 0) => { const m = P.models[id]; if (!m) return null; const [x, z] = S(lx, lz), y = gy(x, z) + dy, ry = r + yaw;
    packProp(id, x, y, z, ry, sc); const d = m.dims, k = Array.isArray(sc) ? sc : [sc, sc, sc];
    if (collide === 'box') addBox(x, z, d[0] * k[0] / 2, d[2] * k[2] / 2, ry, y - 1, y + d[1] * k[1]); else if (collide === 'circle') addCircle(x, z, Math.min(d[0], d[2]) * k[0] / 2, y - 1, y + d[1] * k[1]);
    else if (collide === 'tris') { const M = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(Yax, ry), new THREE.Vector3(k[0], k[1], k[2])); addCompound(buildCompound(new Float32Array(trisOf(m.parts.map(q => ({ geometry: q.geometry })), M, [])), { x, y, z, r: ry, ground: gy }, 'prop')); }
    return [x, y, z]; };
  put('jp_house_annex', -6.5, -3, 0, 1, 'none'); { const [x, z] = S(-6.5, -3.15); addBox(x, z, 2.95, 3.4, r, lev - 1, lev + 5); }
  put('farm_shelter', -6.5, -12.6, 0, 1, 'tris'); put('farm_tractor_old', -6.6, -12.3, PI / 2, 1, 'box');
  put('farm_clothesline', -11.2, -3.5, 0, 1, 'none'); put('farm_wood_stack', -2.75, -4.6, PI / 2, 1); put('farm_wood_stack_02', -2.8, -2.4, PI / 2, 1);
  put('farm_hay_bale_square', -2.6, -12.4, 0.2, 1); put('farm_hay_bale_square', -2.7, -12.2, 0.15, 1, 'none', 0.94); put('farm_hay_bale_round', -10.6, -11.2, 0, 1, 'circle'); put('farm_hay_bale_round', -11.4, -12.5, 1, 1, 'circle');
  put('farm_barrel', -3.6, 1.55, 0, 1, 'circle'); put('farm_barrel_02', -2.9, 1.3, 0.6, 1, 'circle'); put('farm_wheelbarrow', -9.1, 1.9, 0.4, 1); put('farm_well', -0.6, 3.6, 0.3, 1, 'circle');
  put('farm_watering_can', -0.1, 2.5, 1.0, 1, 'none'); put('farm_signpost', 2.6, 9.8, -0.6, 1, 'none');
  { const at = (lx, lz) => { const [x, z] = S(lx, lz); return [x, gy(x, z), z]; }; // (the barbecue in the yard by the house's wall)
    const bq = models.get('h_barbecue'); if (bq) { const [x, y, z] = at(-12.2, 7.6); addProp('home:bbq', bq.map(p => ({ geometry: p.geometry, material: p.material, matrix: new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(Yax, r + PI), new THREE.Vector3(1.42, 1.42, 1.42)).multiply(p.m), castShadow: true }))); addBox(x, z, 0.6, 0.3, r, y - 1, y + 1.2); } }
  // the produce stand by the lane (the farm's office), crates of produce, a bench, paper lanterns under its eaves
  put('farm_produce_stand', STAND[0], STAND[1], 0, 1, 'tris'); put('farm_box_cucumber', STAND[0] - 2.0, STAND[1] + 0.6, 0.3, 1); put('farm_box_potato', STAND[0] - 2.3, STAND[1] - 0.4, -0.2, 1); put('farm_box_apple', STAND[0] + 2.0, STAND[1] + 0.4, 0.1, 1);
  put('farm_bench', STAND[0] - 4.5, STAND[1] + 0.2, 0, 1); put('farm_crate', STAND[0] + 2.2, STAND[1] - 0.8, 0.5, 1);
  for (const e of [-1.1, 1.1]) { const [x, z] = S(STAND[0] + e, STAND[1] + 1.35), y = gy(x, z); packProp('jp_lantern_traditional_02', x, y + 0.9, z, r, 1); lampPoints.push({ p: [x, y + 2.15, z], s: 0.08, c: [1, 0.55, 0.3] }); }
  // the gate over the lane: two posts and a beam with the farm's name
  { const gw = 4.6, [ax, az] = S(LX, HD - 0.6), gy0 = gy(ax, az);
    B.frame(ax, gy0, az, r); for (const e of [-gw / 2, gw / 2]) B.bbox('wood', e, -0.2, 0, 0.24, 3.6, 0.24, 0.03, { color: [0.36, 0.25, 0.16] });
    B.bbox('wood', 0, 3.2, 0, gw + 0.8, 0.22, 0.28, 0.03, { color: [0.3, 0.2, 0.13] }); B.bbox('wood', 0, 2.75, 0, gw, 0.14, 0.18, 0.02, { color: [0.36, 0.25, 0.16] });
    const sg = signMesh(2.2, 0.55, (g, W2, H2) => { g.fillStyle = '#3b2616'; g.fillRect(0, 0, W2, H2); g.fillStyle = '#f2e6c8'; g.fillRect(W2 * 0.03, H2 * 0.08, W2 * 0.94, H2 * 0.84); g.fillStyle = '#2b1d12'; g.textAlign = 'center'; g.font = `bold ${H2 * 0.5}px "Yu Mincho", serif`; g.fillText('さくら農園', W2 / 2, H2 * 0.62); g.font = `${H2 * 0.13}px "Segoe UI", sans-serif`; g.fillText('SAKURA FARM', W2 / 2, H2 * 0.86); }, 0.05, 256);
    const [px, pz] = S(LX, HD - 0.6 + 0.16); sg.position.set(px, gy0 + 3.0, pz); sg.rotation.y = r; sg.updateMatrixWorld(); scene.add(sg);
    for (const e of [-gw / 2, gw / 2]) { const [x, z] = S(LX + e, HD - 0.6); addBox(x, z, 0.14, 0.14, r, gy0 - 1, gy0 + 3.6); } }
  // lamps: by the yard, at the field's gate, along the lane
  const lampPost = (lx, lz) => { const [x, z] = S(lx, lz), y = gy(x, z); B.frame(x, y, z, r); B.bbox('wood', 0, -0.2, 0, 0.12, 3.0, 0.12, 0.02, { color: [0.35, 0.26, 0.18] }); B.box('wood', 0, 2.72, 0.2, 0.05, 0.05, 0.42, { color: [0.35, 0.26, 0.18] });
    B.cyl('plain', 0, 2.48, 0.38, 0.06, 0.22, 0.18, 10, { color: [0.18, 0.22, 0.2] }); B.cyl('lamp', 0, 2.44, 0.38, 0.05, 0.05, 0.06, 8, { color: [1, 0.95, 0.85] });
    const [lpx, lpz] = S(lx, lz + 0.38); lampPoints.push({ p: [lpx, y + 2.4, lpz], s: 0.3 }); addBox(x, z, 0.08, 0.08, r, y - 1, y + 3); };
  lampPost(-14, 13.2); lampPost(-1.5, 8.6); lampPost(FX + 1.9, GATE + 0.5); lampPost(LX + 2.4, HD + 2); for (const [x, z] of laneLamps) { const [lx, lz] = SL(x, z); lampPost(lx, lz); }
  // ---------------------------------------------------------------- the field: fence, gate, scarecrow
  const ex0 = FX - FW / 2 - FENCE, ex1 = FX + FW / 2 + FENCE, ez0 = FZ - FD / 2 - FENCE, ez1 = GATE;
  const fence = (a0, b0, a1, b1) => { const L = Math.hypot(a1 - a0, b1 - b0), n = Math.max(1, Math.round(L / 2.55)), yaw = Math.atan2(a1 - a0, b1 - b0) - PI / 2;
    for (let k = 0; k <= n; k++) { const t = k / n; put('farm_fence_round_pole', a0 + (a1 - a0) * t, b0 + (b1 - b0) * t, 0, 1, 'circle'); }
    for (let k = 0; k < n; k++) { const t = (k + 0.5) / n, [x, z] = S(a0 + (a1 - a0) * t, b0 + (b1 - b0) * t), y = gy(x, z); packProp('farm_fence_round', x, y, z, r + yaw, [L / n / 2.6, 1, 1]); addBox(x, z, L / n / 2, 0.08, r + yaw, y - 1, y + 1); } };
  fence(ex0, ez0, ex1, ez0); fence(ex1, ez0, ex1, ez1); fence(ex0, ez1, ex0, ez0); fence(ex0, ez1, FX - 1.4, ez1); fence(FX + 1.4, ez1, ex1, ez1);
  put('farm_fence_gate', FX - 1.4 - 1.42, ez1 + 0.3, 0, [0.55, 1, 1], 'box'); // (the gate, slid open along the fence)
  put('farm_scarecrow', 24.6, 8.4, -0.4, 1, 'circle'); put('farm_weathervane', -6.5, -3.15, 0.5, 1, 'none', 5.35);
  const plotAt = (i) => { const cI = i % COLS, rI = Math.floor(i / COLS), lx = FX - FW / 2 + PLOT / 2 + cI * (PLOT + GAP), lz = FZ + FD / 2 - PLOT / 2 - rI * (PLOT + GAP), [x, z] = S(lx, lz); return { lx, lz, x, z, y: gy(x, z), w: PLOT, d: PLOT }; };
  const plots = state.plots.map((_, i) => plotAt(i));
  // ---------------------------------------------------------------- the upgrades (drawn once bought)
  const groupAt = (id, lx, lz, yaw = 0, sc = 1, dy = 0) => { const m = P.models[id]; if (!m) return null; const [x, z] = S(lx, lz), y = gy(x, z) + dy, k = Array.isArray(sc) ? sc : [sc, sc, sc];
    const M = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(Yax, r + yaw), new THREE.Vector3(...k)); const g = meshGroup(m.parts, M); g.visible = false; return g; };
  const ups = { sprinkler: [], greenhouse: [], hives: [], orchard: [] }, upCols = { sprinkler: [], greenhouse: [], hives: [], orchard: [] };
  for (const [lx, lz] of [[FX - 5.1, FZ - 1.5], [FX + 0.0, FZ - 1.5], [FX + 5.1, FZ - 1.5], [FX - 2.5, FZ + 3.0], [FX + 2.5, FZ + 3.0]]) { const g = groupAt('farm_sprinkler', lx + 0.3 * 0, lz, 0, 1); if (g) ups.sprinkler.push(g); }
  { // the greenhouse: its glass doors taken out (a way in), four beds inside
    const m = P.models.farm_greenhouse_glass; if (m) { const [x, z] = S(GH[0], GH[1]), y = gy(x, z), M = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(Yax, r), new THREE.Vector3(1, 1, 1));
      const gc = cutModel(m.parts, [[[-1.0, 1.0], [-0.1, 2.4], [3.5, 3.95]]]); const g = meshGroup(gc.keep, M); g.visible = false; ups.greenhouse.push(g);
      { const fl = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 7.5), new THREE.MeshStandardMaterial({ color: 0x9a8e7c, roughness: 0.95 })); fl.rotation.x = -Math.PI / 2; fl.position.y = 0.04; fl.receiveShadow = true; fl.matrixAutoUpdate = true; g.add(fl); fl.updateMatrixWorld(true); }
      const C = buildCompound(new Float32Array(trisOf(gc.keep, M, [])), { x, y, z, r, ground: gy }, 'building'); upCols.greenhouse.push(() => addCompound(C)); } }
  const ghBeds = [[-1.75, -1.75], [-1.75, 1.6], [1.75, -1.75], [1.75, 1.6]].map(([bx, bz]) => { const [x, z] = S(GH[0] + bx, GH[1] + bz); return { x, z, y: gy(x, z), w: 0.95, d: 2.9 }; });
  HIVES.forEach(([lx, lz], k) => { const g = groupAt('farm_beehive', lx, lz, 0.2 * (k - 1), 1); if (g) ups.hives.push(g); const [x, z] = S(lx, lz); upCols.hives.push(() => addCircle(x, z, 0.42, gy(x, z) - 1, gy(x, z) + 1.3)); });
  const trees = ORCHARD.map(([lx, lz, id], k) => { const g = groupAt(id, lx, lz, k * 1.3, 0.8); if (g) ups.orchard.push(g); const [x, z] = S(lx, lz); upCols.orchard.push(() => addCircle(x, z, 0.35, gy(x, z) - 1, gy(x, z) + 3)); return { x, z, y: gy(x, z), lx, lz }; });
  const crates = ORCHARD.map(([lx, lz], k) => groupAt(['farm_box_apple', 'farm_box_peach', 'farm_box_apple_02', 'farm_box_plum', 'farm_box_peach'][k], lx + 1.1, lz + 1.0, 0.3, 1));
  const honeyJars = HIVES.map(([lx, lz]) => groupAt('farm_box_apple_02', lx, lz + 1.0, 0, [0.6, 0.6, 0.6]));
  // ---------------------------------------------------------------- the house's collider: the shell, the rooms and what stands in them
  for (const [k, b] of HB.parts) { const P2 = b.pos.a, I = b.idx.a, skip = noCollide.filter(q => q[0] === k); for (let i = 0; i < b.idx.length; i++) { if (skip.some(q => i >= q[1] && i < q[2])) continue; const v = I[i] * 3; tris.push(P2[v], P2[v + 1], P2[v + 2]); } }
  [capHooks.bucket, capHooks.collider, capHooks.prop, capHooks.frame] = cap;
  addCompound(buildCompound(new Float32Array(tris), { x: hx, y: Y, z: hz, r, ground: (x, z) => gy(x, z) }));
  { const none = {}; for (const k in HMT) none[k] = false; for (const m of HB.flush(HMT, none)) { m.updateMatrixWorld(); if (m.material === HMT.glass) m.renderOrder = 2; } }
  const sale = { // where each upgrade is built (a sign stands there till it is)
    sprinkler: S(FX + 3.4, GATE + 0.6), greenhouse: S(GH[0], GH[1] + 4.6), hives: S(26, -12.4), orchard: S(11, -12.2), hand: S(STAND[0] - 3.4, STAND[1] + 1.5) };
  const home = { site: { x: sx, z: sz, r }, house: { x: hx, z: hz, y: Y, FL: FG }, doors, plots, ghBeds, trees, crates, honeyJars, ups, upCols, sale,
    glow: gmat, bed: Hp(-2.2, FU, 0.07), boardAt: S(STAND[0], STAND[1] + 1.9), hivesAt: S(26, -13.0), spawnAt: (([x, z]) => [x, 0, z])(S(LX, HD + 1.5)), spawnYaw: r, gy, floors: [Y + FG, Y + FU] };
  console.info(`home: farm at ${sx.toFixed(0)}, ${sz.toFixed(0)} facing ${Math.round(r * 180 / Math.PI)}°, ${road ? road + ' m of lane to the road' : 'no road near'}; ground levelled to ${lev.toFixed(1)} m`);
  return home;
}

// ---------------------------------------------------------------- the farm and the house while you play
// home: what buildHome returned; ui: shopui; returns { spots, update(dt) }
export function homeRuntime(home, ui) {
  if (!home) return { spots: [], update() {} };
  const P = packsReady(), r = home.site.r, cr = Math.cos(r), sr = Math.sin(r);
  const Q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r), M4 = new THREE.Matrix4(), V = new THREE.Vector3(), SV = new THREE.Vector3(), QJ = new THREE.Quaternion(), YA = new THREE.Vector3(0, 1, 0);
  const at = (p, lx, lz) => V.set(p.x + lx * cr + lz * sr, p.y, p.z - lx * sr + lz * cr);
  // the beds (the field's plots you own, the greenhouse's once built): tilled earth in a frame of boards, instanced
  const furrow = (() => { const cv = document.createElement('canvas'); cv.width = cv.height = 256; const g = cv.getContext('2d'); g.fillStyle = '#86603f'; g.fillRect(0, 0, 256, 256); for (let i = 0; i < 6; i++) { const y = 18 + i * 43; g.fillStyle = '#6a4a31'; g.fillRect(0, y, 256, 16); g.fillStyle = '#a07a55'; g.fillRect(0, y + 16, 256, 7); } for (let i = 0; i < 1400; i++) { g.fillStyle = i % 2 ? 'rgba(50,34,20,.35)' : 'rgba(190,160,120,.3)'; g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); } const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; })();
  const beds = [...home.plots.map((p, i) => ({ ...p, kind: 'plot', i })), ...home.ghBeds.map((p, i) => ({ ...p, kind: 'gh', i }))], N = beds.length;
  const soil = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.14, 1), new THREE.MeshStandardMaterial({ map: furrow, roughness: 0.95 }), N);
  const boards = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x6b4a30, roughness: 0.85 }), N * 4);
  const sphere = new THREE.Sphere(new THREE.Vector3(home.site.x, home.house.y, home.site.z), 40);
  for (const m of [soil, boards]) { m.receiveShadow = true; m.castShadow = false; m.boundingSphere = sphere; m.count = 0; scene.add(m); }
  const crops = {}; // crop -> [InstancedMesh per part]
  for (const [id, C] of Object.entries(CROPS)) { const parts = P && packParts(C.model); if (!parts) continue; crops[id] = parts.map(q => { const im = new THREE.InstancedMesh(q.geometry, q.material, N * 16); im.count = 0; im.castShadow = true; im.receiveShadow = true; im.boundingSphere = sphere; scene.add(im); return im; }); }
  const bedState = b => b.kind === 'plot' ? state.plots[b.i] : state.gh[b.i];
  const bedOn = b => b.kind === 'plot' ? state.plots[b.i].own : !!state.upg.greenhouse;
  const rate = b => b.kind === 'gh' ? 2 : state.upg.sprinkler ? 1.5 : 1;
  let sale = null, saleFor = -1; const signs = {};
  const stakeSign = (lines, color = '#b8322a') => { const g = new THREE.Group(), sg = signMesh(0.8, 0.55, (c, W2, H2) => { c.fillStyle = '#f6f1e2'; c.fillRect(0, 0, W2, H2); c.strokeStyle = color; c.lineWidth = H2 * 0.05; c.strokeRect(H2 * 0.05, H2 * 0.05, W2 - H2 * 0.1, H2 - H2 * 0.1); c.textAlign = 'center'; c.fillStyle = color; c.font = `bold ${H2 * 0.3}px "Yu Mincho", serif`; c.fillText(lines[0], W2 / 2, H2 * 0.42); c.fillStyle = '#2b2420'; c.font = `bold ${H2 * 0.15}px "Segoe UI", sans-serif`; c.fillText(lines[1], W2 / 2, H2 * 0.64); c.fillText(lines[2], W2 / 2, H2 * 0.84); }, 0.1, 192);
    sg.position.y = 1.05; g.add(sg); const st = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.0, 0.06), new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.8 })); st.position.y = 0.5; g.add(st); return g; };
  const placeAt = (g, x, z, y) => { g.position.set(x, y, z); g.rotation.y = r; g.updateMatrixWorld(true); scene.add(g); return g; };
  function saleSign() { // the stake and its sign on the next plot for sale
    const next = state.plots.findIndex(q => !q.own), own = state.plots.filter(q => q.own).length;
    if (next === saleFor) return; saleFor = next; if (sale) { scene.remove(sale); sale = null; } if (next < 0) return;
    const p = home.plots[next]; sale = stakeSign(['売 地', 'PLOT FOR SALE', yen(plotPrice(own)) + '  ·  E']); at(p, 0, PLOT / 2 - 0.25); placeAt(sale, V.x, V.z, p.y);
  }
  function upgrades() { // what is bought stands; where it is not yet, a sign
    for (const [k, U] of Object.entries(UPGRADES)) {
      const on = !!state.upg[k];
      for (const g of home.ups[k] || []) if (g.visible !== on) g.visible = on;
      if (on && home.upCols[k] && !home.upCols[k].done) { home.upCols[k].forEach(f => f()); home.upCols[k].done = true; }
      if (on && signs[k]) { scene.remove(signs[k]); delete signs[k]; }
      if (!on && !signs[k]) { const [x, z] = home.sale[k]; signs[k] = placeAt(stakeSign(['建設予定', U.name.toUpperCase(), yen(U.price) + '  ·  E'], '#24344d'), x, z, home.gy(x, z)); }
    }
  }
  let dirty = true;
  function redraw() {
    let ns = 0, nb = 0;
    beds.forEach(b => { if (!bedOn(b)) return;
      at(b, 0, 0); V.y += 0.03; M4.compose(V, Q, SV.set(b.w - 0.08, 1, b.d - 0.08)); soil.setMatrixAt(ns++, M4);
      for (const [bx, bz, w, d] of [[0, b.d / 2 - 0.03, b.w, 0.06], [0, -b.d / 2 + 0.03, b.w, 0.06], [b.w / 2 - 0.03, 0, 0.06, b.d - 0.12], [-b.w / 2 + 0.03, 0, 0.06, b.d - 0.12]]) { at(b, bx, bz); V.y += 0.04; M4.compose(V, Q, SV.set(w, 0.2, d)); boards.setMatrixAt(nb++, M4); } });
    soil.count = ns; boards.count = nb; soil.instanceMatrix.needsUpdate = boards.instanceMatrix.needsUpdate = true;
    const cnt = {}; for (const id in crops) cnt[id] = 0;
    beds.forEach((b, bi) => { const s = bedState(b); if (!bedOn(b) || !s.crop || !crops[s.crop]) return; const C = CROPS[s.crop], g = Math.min(1, s.g), sc = C.s * (0.15 + 0.85 * Math.pow(g, 0.8)), cell = (PLOT - 0.2) / C.n;
      const nx = Math.max(1, Math.round((b.w - 0.2) / cell)), nz = Math.max(1, Math.round((b.d - 0.2) / cell)), sx = (b.w - 0.2) / nx, sz = (b.d - 0.2) / nz;
      for (let a = 0; a < nx; a++) for (let k = 0; k < nz; k++) { const jit = ((bi * 7 + a * 3 + k * 5) % 7) / 7; if (cnt[s.crop] >= N * 16) break;
        at(b, -b.w / 2 + 0.1 + sx * (a + 0.5), -b.d / 2 + 0.1 + sz * (k + 0.5)); V.y += 0.1; M4.compose(V, QJ.setFromAxisAngle(YA, jit * 6.28), SV.setScalar(sc * (0.9 + jit * 0.2)));
        for (const im of crops[s.crop]) im.setMatrixAt(cnt[s.crop], M4); cnt[s.crop]++; } });
    for (const id in crops) for (const im of crops[id]) { im.count = cnt[id]; im.instanceMatrix.needsUpdate = true; }
    home.crates.forEach((g, k) => { if (g) g.visible = !!state.upg.orchard && state.fruit[k] >= 1; });
    home.honeyJars.forEach((g, k) => { if (g) g.visible = !!state.upg.hives && state.honey >= (k + 1) * 3 - 2; });
    saleSign(); upgrades();
  }
  // growth: the hours of the game since the last frame (a night's sleep is a jump of the clock)
  let lastH = time.hour;
  const sellBed = (b, s) => { const C = CROPS[s.crop]; earn(C.sell); state.earned += C.sell; return C; };
  function grow(dh) {
    if (dh <= 0) return;
    beds.forEach(b => { const s = bedState(b); if (!bedOn(b) || !s.crop || s.g >= 1) return; const before = Math.floor(s.g * 12); s.g = Math.min(1, s.g + dh * rate(b) / CROPS[s.crop].hours); if (Math.floor(s.g * 12) !== before || s.g >= 1) dirty = true; });
    if (state.upg.hives) { const h0 = Math.floor(state.honey); state.honey = Math.min(9, state.honey + dh * 3 / HIVE_H); if (Math.floor(state.honey) !== h0) dirty = true; }
    if (state.upg.orchard) state.fruit.forEach((f, k) => { if (f < 1) { state.fruit[k] = Math.min(1, f + dh / FRUIT_H); if (state.fruit[k] >= 1) dirty = true; } });
    if (state.upg.hand) {
      beds.forEach(b => { const s = bedState(b); if (bedOn(b) && s.crop && s.g >= 1) { const C = sellBed(b, s); if (inv.yen >= C.price) { earn(-C.price); s.g = 0; } else s.crop = null; dirty = true; } });
      if (state.honey >= 1) { const n = Math.floor(state.honey); earn(n * HONEY); state.earned += n * HONEY; state.honey -= n; dirty = true; }
      state.fruit.forEach((f, k) => { if (f >= 1) { earn(FRUIT); state.earned += FRUIT; state.fruit[k] = 0; dirty = true; } });
    }
  }
  // ---- what E does round the house and the farm
  const spots = [];
  const [YG, YU] = home.floors;
  for (const d of home.doors) spots.push({ kind: 'custom', x: d.x, z: d.z, r: 1.5, ylo: YG - 1.5, yhi: YG + 1.5, prompt: () => `<b>E</b><span>${d.want ? 'Close' : 'Open'} — ${d.name}</span>`, use: () => { d.want = d.want ? 0 : 1; return false; } });
  spots.push({ kind: 'custom', x: home.bed[0], z: home.bed[2], r: 1.9, ylo: YU - 0.6, yhi: YU + 1.5, prompt: () => `<b>E</b><span>Sleep until morning</span><span class="jp">寝る</span>`, use: () => {
    const h = time.hour, to = 6.5, dh = (to - h + 24) % 24 || 24; time.hour = to; updateSky(true); lastH = to; grow(dh); save(); toastMsg('Slept ' + Math.round(dh) + ' h — good morning (6:30)'); dirty = true; return false; } });
  const sow = s => ({ title: 'Seeds', jp: '種', seeds: Object.entries(CROPS).map(([id, C]) => ({ ...C, id: 'crop_' + id, crop: id, sz: [2, 2] })), sprinkler: !!state.upg.sprinkler,
    pick(id) { const C = CROPS[id]; if (!spend(C.price)) return false; s.crop = id; s.g = 0; dirty = true; save(); toastMsg('Sown: ' + C.name + ' ' + C.jp); return true; } });
  const buyNext = () => { const own = state.plots.filter(q => q.own).length, next = state.plots.findIndex(q => !q.own); if (next < 0 || !spend(plotPrice(own))) return false; state.plots[next].own = true; dirty = true; save(); toastMsg('A new plot — dug and ready'); return true; };
  const buyUp = k => { const U = UPGRADES[k]; if (state.upg[k] || !spend(U.price)) return false; state.upg[k] = true; dirty = true; save(); toastMsg(U.name + ' ' + U.jp + ' — built'); return true; };
  beds.forEach(b => spots.push({ kind: 'custom', x: b.x, z: b.z, r: b.kind === 'gh' ? 1.1 : 1.45, prompt: () => {
    if (!bedOn(b)) return b.kind === 'plot' && state.plots.findIndex(q => !q.own) === b.i ? `<b>E</b><span>Buy this plot — ${yen(plotPrice(state.plots.filter(q => q.own).length))}</span><span class="jp">畑を買う</span>` : null;
    const s = bedState(b); if (!s.crop) return `<b>E</b><span>Sow seeds${b.kind === 'gh' ? ' — greenhouse bed' : ''}</span><span class="jp">種をまく</span>`;
    const C = CROPS[s.crop]; if (s.g >= 1) return `<b>E</b><span>Harvest ${C.name} — ${yen(C.sell)}</span><span class="jp">収穫</span>`;
    return `<span>${C.name} ${C.jp} — ${Math.floor(s.g * 100)}% · ripe in ${Math.ceil((1 - s.g) * C.hours / rate(b) * 10) / 10} h</span>`; },
    use: () => {
      if (!bedOn(b)) { if (b.kind === 'plot') buyNext(); return false; }
      const s = bedState(b); if (!s.crop) { ui.show('seeds', sow(s)); return true; }
      if (s.g >= 1) { const C = sellBed(b, s); s.crop = null; s.g = 0; dirty = true; save(); toastMsg('Harvested ' + C.name + ' — +' + yen(C.sell)); }
      return false; } }));
  spots.push({ kind: 'custom', x: home.hivesAt[0], z: home.hivesAt[1], r: 2.4, prompt: () => state.upg.hives ? (state.honey >= 1 ? `<b>E</b><span>Take the honey — ${Math.floor(state.honey)} jar${state.honey >= 2 ? 's' : ''} · ${yen(Math.floor(state.honey) * HONEY)}</span><span class="jp">はちみつ</span>` : `<span>Beehives — the next jar in ${Math.ceil((1 - state.honey % 1) * HIVE_H / 3 * 10) / 10} h</span>`) : null,
    use: () => { const n = Math.floor(state.honey); if (!state.upg.hives || !n) return false; earn(n * HONEY); state.earned += n * HONEY; state.honey -= n; dirty = true; save(); toastMsg(n + ' jar' + (n > 1 ? 's' : '') + ' of honey — +' + yen(n * HONEY)); return false; } });
  home.trees.forEach((t, k) => spots.push({ kind: 'custom', x: t.x, z: t.z, r: 2.2, prompt: () => state.upg.orchard ? (state.fruit[k] >= 1 ? `<b>E</b><span>Pick the fruit — ${yen(FRUIT)}</span><span class="jp">果物</span>` : `<span>Fruit tree — ripe in ${Math.ceil((1 - state.fruit[k]) * FRUIT_H * 10) / 10} h</span>`) : null,
    use: () => { if (!state.upg.orchard || state.fruit[k] < 1) return false; earn(FRUIT); state.earned += FRUIT; state.fruit[k] = 0; dirty = true; save(); toastMsg('A crate of fruit — +' + yen(FRUIT)); return false; } }));
  for (const k of Object.keys(UPGRADES)) { const [x, z] = home.sale[k]; spots.push({ kind: 'custom', x, z, r: 1.6, prompt: () => state.upg[k] ? null : `<b>E</b><span>Build: ${UPGRADES[k].name} — ${yen(UPGRADES[k].price)}</span><span class="jp">${UPGRADES[k].jp}</span>`, use: () => { buyUp(k); return false; } }); }
  spots.push({ kind: 'custom', x: home.boardAt[0], z: home.boardAt[1], r: 2.0, prompt: () => `<b>E</b><span>Farm board — plots & upgrades</span><span class="jp">農園の掲示板</span>`, use: () => { ui.show('farm', farmPanel()); return true; } });
  function farmPanel() {
    const own = state.plots.filter(q => q.own).length, growing = beds.filter(b => bedOn(b) && bedState(b).crop).length, ripe = beds.filter(b => bedOn(b) && bedState(b).crop && bedState(b).g >= 1).length;
    const acts = [];
    if (own < state.plots.length) acts.push({ label: 'Buy the next plot', jp: '畑を広げる', price: plotPrice(own), note: own + ' of ' + state.plots.length + ' plots yours', run: buyNext });
    for (const [k, U] of Object.entries(UPGRADES)) acts.push({ label: U.name, jp: U.jp, price: U.price, note: U.note, done: !!state.upg[k], run: () => buyUp(k) });
    return { title: 'さくら農園', sub: 'SAKURA FARM', stats: [['Plots', own + ' / ' + state.plots.length], ['Growing', growing], ['Ripe', ripe], ['Earned so far', yen(state.earned)]], acts, refresh: () => farmPanel() };
  }
  return {
    spots, state,
    update(dt) {
      const h = time.hour; let dh = h - lastH; if (dh < -12) dh += 24; if (dh > 0 && dh < 12) grow(dh); lastH = h;
      for (const d of home.doors) { const t = Math.max(0, Math.min(1, d.t + (d.want ? 1 : -1) * dt / 0.5)); if (t !== d.t) { d.t = t; d.move(t * t * (3 - 2 * t)); } d.block(d.t < 0.6); }
      { const n = h >= 18.5 || h < 5.5 ? 1 : h > 17 ? (h - 17) / 1.5 : h < 7 ? (7 - h) / 1.5 : 0; home.glow.opacity = 0.55 * n; home.glow.visible = n > 0; }
      if (dirty) { redraw(); save(); dirty = false; }
    },
  };
}
