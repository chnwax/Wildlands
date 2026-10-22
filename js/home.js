// Your house and your farm (a first test of a little farming game): a one-storey house at the edge of the fields with
// rooms you walk into — the entrance (genkan), a living room with a dining kitchen, a bedroom, a washroom with the
// toilet and a bathroom — furnished from two CC0 model packs (assets/models/home: Quaternius' Ultimate House Interior
// Pack, CreativeTrio's Household Props 001), its doors opened with E; a path from its door to the nearest road; and
// beside it a fenced field of plots:
//  - a plot is bought (the first four are yours), sown with a seed bought on the spot, grows with the hours of the game
//    (a night's sleep in your bed lets it grow), and is harvested straight into the shipping box for yen
//  - the farm's board sells more plots and the upgrades: a sprinkler (everything grows half as fast again) and a farm
//    hand who harvests what is ripe and sows the same again
// Everything about the farm is kept on this computer (localStorage: wl_farm).
import { THREE, scene, buildCompound, addCompound, addProp, colInsert, colRemove, capHooks, gltfLoader, lampPoints } from './core.js';
import { time, updateSky } from './sky.js';
import { inFrame, wallFill, reveals, windowUnit, gableRoof } from './building.js';
import { interiorKit, roomLamp } from './interiors.js';
import { packsReady, packParts, packProp } from './packs.js';
import { signMesh } from './townkit.js';
import { earn, spend, inv, yen } from './items.js';
import { toastMsg } from './ui.js';

const BASE = 'assets/models/home/';
// the packs' own scales to metres (the interior pack is modelled at twice life size, the household props a little under)
const SC = id => id.startsWith('i_') ? 0.5 : 1.42;
export const CROPS = {
  lettuce: { name: 'Lettuce', jp: 'レタス', model: 'farm_lettuce_01_l', price: 60, hours: 2, sell: 150, n: 4, s: 1.6, look: ['lettuce'] },
  cabbage: { name: 'Cabbage', jp: 'キャベツ', model: 'farm_cabbage_01_l', price: 90, hours: 3, sell: 240, n: 3, s: 1.3, look: ['cabbage'] },
  sunflower: { name: 'Sunflower', jp: 'ひまわり', model: 'farm_sunflower_1', price: 100, hours: 3, sell: 270, n: 3, s: 1.1, look: ['sunflower'] },
  tomato: { name: 'Tomato', jp: 'トマト', model: 'farm_tomato_bush', price: 120, hours: 4, sell: 340, n: 3, s: 0.95, look: ['tomato'] },
  strawberry: { name: 'Strawberry', jp: 'いちご', model: 'farm_strawberry', price: 150, hours: 5, sell: 430, n: 3, s: 0.95, look: ['strawberry'] },
  corn: { name: 'Corn', jp: 'とうもろこし', model: 'farm_corn_m', price: 180, hours: 6, sell: 540, n: 3, s: 0.85, look: ['corn'] },
  pumpkin: { name: 'Pumpkin', jp: 'かぼちゃ', model: 'farm_pumpkin_m', price: 250, hours: 8, sell: 820, n: 3, s: 1.3, look: ['pumpkin'] },
  watermelon: { name: 'Watermelon', jp: 'すいか', model: 'farm_watermelon', price: 320, hours: 10, sell: 1100, n: 3, s: 1.25, look: ['watermelon'] },
};
const COLS = 5, ROWS = 4, PLOT = 2.2, GAP = 0.55, FREE = 4;
const plotPrice = k => 600 + 350 * (k - FREE); // (the k-th plot, counting from 0)
const UPGRADES = { sprinkler: { name: 'Sprinkler', jp: 'スプリンクラー', price: 4000, note: 'everything grows 1.5× as fast' }, hand: { name: 'Farm hand', jp: '手伝いさん', price: 9000, note: 'harvests what is ripe and sows the same again' } };

// ---------------------------------------------------------------- the farm's state (localStorage)
const KEY = 'wl_farm';
const state = { plots: Array.from({ length: COLS * ROWS }, (_, i) => ({ own: i < FREE, crop: null, g: 0 })), upg: {}, earned: 0 };
try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && s.plots && s.plots.length === state.plots.length) Object.assign(state, s); } catch (e) {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} };

// ---------------------------------------------------------------- models of the two packs
const models = new Map();
async function loadModels(ids) {
  await Promise.all(ids.map(async id => { try { const g = await gltfLoader.loadAsync(BASE + id + '.glb'); g.scene.updateMatrixWorld(true); const parts = []; g.scene.traverse(o => { if (o.isMesh) parts.push({ geometry: o.geometry, material: o.material, m: o.matrixWorld.clone() }); }); models.set(id, parts); } catch (e) { console.warn('home: model', id, e); } }));
}

// ---------------------------------------------------------------- the site's plan (site frame: front toward +z)
const HW = 15, HD = 11;                       // the site: 30 x 22 m
const HX = -8, HZ = -0.5, W = 10, D = 8;      // the house's centre and size
const DX = HX - 3.575;                        // the front door's x (house-local -3.575)
const FX = 6.2, FZ = -0.6, FW = COLS * PLOT + (COLS - 1) * GAP, FD = ROWS * PLOT + (ROWS - 1) * GAP; // the field
const GATE = FD / 2 + FZ + 0.8;               // the fence's front line (z)

// ---------------------------------------------------------------- building it (town.js, while the map is built)
// ctx: { B (the town's builder), hf, occRect, gy, RN, blocked(x, z), footpath(x0, z0, x1, z1) }
export async function buildHome(ctx) {
  const { B, hf, occRect, gy, RN, blocked } = ctx;
  // the place: a level, free stretch of meadow (30 x 22 m) whose front looks onto a road or a footway a short, clear walk
  // away, the nearer the middle of the town the better; four ways round
  const onWay = (x, z) => RN.roadAt(x, z) || (RN.walkY && RN.walkY(x, z) !== null);
  const ok = (x, z, c, s) => {
    let lo = 1e9, hi = -1e9;
    for (let dz = -HD; dz <= HD; dz += 2) for (let dx = -HW; dx <= HW; dx += 2) { const px = x + dx * c + dz * s, pz = z - dx * s + dz * c; if (blocked(px, pz) || onWay(px, pz)) return false; const h = gy(px, pz); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    return hi - lo < 1.3;
  };
  const toRoad = (x, z, c, s) => { // metres from the site's front edge, out from the door, to the first road or footway (0: none, or something in the way)
    const ox = x + DX * c + HD * s, oz = z - DX * s + HD * c, h0 = gy(ox, oz);
    for (let d = 1; d <= 30; d++) { const px = ox + s * d, pz = oz + c * d; if (onWay(px, pz)) return d; if (blocked(px, pz) || occRect(px, pz, 0.8, 0.8, 0, 0, true) || Math.abs(gy(px, pz) - h0) > 3) return 0; }
    return 0;
  };
  const cand = [];
  for (let z = 300; z <= 430; z += 3) for (let x = -390; x <= 140; x += 3) cand.push([x, z, Math.hypot(x, z + 30) * 0.25]);
  cand.sort((a, b) => a[2] - b[2]);
  let best = null, bs = 1e9;
  for (const [x, z, s0] of cand) {
    if (s0 + 1.5 >= bs) break;
    for (const r of [Math.PI, Math.PI / 2, -Math.PI / 2, 0]) { const c = Math.cos(r), s = Math.sin(r);
      if (occRect(x, z, HW, HD, r, 0, true) || !ok(x, z, c, s)) continue;
      const d = toRoad(x, z, c, s), sc = s0 + (d ? d * 1.5 : 60); if (sc < bs) { best = [x, z, r, d]; bs = sc; } }
  }
  if (!best) { console.warn('home: no room for the house'); return null; }
  const [sx, sz, r, road] = best, c = Math.cos(r), s = Math.sin(r);
  const S = (lx, lz) => [sx + lx * c + lz * s, sz - lx * s + lz * c]; // site frame -> world
  occRect(sx, sz, HW, HD, r, 1);
  // the ground: no grass in the house nor the field; the field and the yard's ground trodden
  const inRect = (x, z, cx, cz, hw, hd) => { const dx = x - sx, dz = z - sz, lx = dx * c - dz * s, lz = dx * s + dz * c; return Math.abs(lx - cx) < hw && Math.abs(lz - cz) < hd; };
  const R0 = HW + HD + 2;
  hf.paint2(2, sx - R0, sz - R0, sx + R0, sz + R0, (x, z) => inRect(x, z, HX, HZ, W / 2 + 1.6, D / 2 + 1.6) || inRect(x, z, FX, FZ, FW / 2 + 1.2, FD / 2 + 1.2) ? 1 : 0);
  { const ax = FX - FW / 2 - 0.8, bx = FX + FW / 2 + 0.8, az = FZ - FD / 2 - 0.8, bz = GATE, nx = Math.ceil(bx - ax), nz = Math.ceil(bz - az);
    const V = (i, j) => { const lx = ax + (bx - ax) * i / nx, lz = az + (bz - az) * j / nz, [x, z] = S(lx, lz); return [x, gy(x, z) + 0.035, z]; };
    B.frame(0, 0, 0, 0); for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const P = [V(i, j), V(i + 1, j), V(i + 1, j + 1), V(i, j + 1)]; B.poly('soil', P, [0, 1, 0], { color: [0.52, 0.42, 0.33], uvs: P.map(p => [p[0] / 2.5, p[2] / 2.5]) }); } }
  // the paths: from the door to the road, along the front of the house to the field's gate
  const path = (a, b, w) => { if (!ctx.footpath) return; const [x0, z0] = S(...a), [x1, z1] = S(...b); ctx.footpath(x0, z0, x1, z1, w); };
  if (road) { path([DX, D / 2 + HZ + 1.0], [DX, HD + road + 0.6], 0.75); for (let d = 0; d <= road; d += 2) { const [px, pz] = S(DX, HD + d); occRect(px, pz, 1.2, 1.2, 0, 1); } }
  path([DX + 0.6, D / 2 + HZ + 2.6], [FX, D / 2 + HZ + 2.6], 0.6); path([FX, D / 2 + HZ + 2.6], [FX, GATE - 0.2], 0.6);
  // the models
  const MODEL_IDS = ['i_couch_medium_2', 'i_table_round_large', 'i_table_round_small_2', 'i_chair', 'i_bed_king', 'i_night_stand', 'i_table_lamp', 'i_drawer_2', 'i_kitchen_fridge', 'i_oven', 'i_kitchen_sink', 'i_bathtub', 'i_toilet', 'i_bathroom_sink', 'i_washing_machine', 'i_round_rug', 'i_houseplant_2', 'i_houseplant_3', 'i_houseplant_5', 'i_cactus', 'i_light_ceiling', 'i_light_floor_2', 'i_shelf_large', 'i_curtains_double', 'i_towel_rack', 'i_toilet_paper_stack',
    'h_desk', 'h_computer', 'h_chair', 'h_grandfathers_clock', 'h_armchair', 'h_coat_rack', 'h_closed_umbrella', 'h_monitor', 'h_fruit_bowl', 'h_cup_of_tea', 'h_books', 'h_alarm_clock', 'h_wall_corkboard', 'h_globe', 'h_piggy_bank', 'h_frying_pan', 'h_watering_can', 'h_hoe', 'h_toolbox', 'h_mailbox', 'h_bird_house', 'h_dresser', 'h_flowers'];
  await loadModels(MODEL_IDS);
  const { IB, indoor } = interiorKit();
  const tris = [], mark = new Map(); for (const [k, b] of B.parts) mark.set(k, b.idx.length);
  const ibMark = new Map(); for (const [k, b] of IB.parts) ibMark.set(k, b.idx.length);
  const cap = [capHooks.bucket, capHooks.collider, capHooks.prop, capHooks.frame]; capHooks.bucket = capHooks.collider = capHooks.prop = capHooks.frame = null; // (the house is the player's own, not a World Builder object)
  // ---------------------------------------------------------------- the house
  // house frame: centre at site (HX, HZ), the same turn; floor 0.45 over the highest ground under it
  const [hx, hz] = S(HX, HZ); let gmax = -1e9, gmin = 1e9; for (let dz = -4.5; dz <= 4.5; dz += 1.5) for (let dx = -5.5; dx <= 5.5; dx += 1.5) { const [px, pz] = S(HX + dx, HZ + dz), h = gy(px, pz); gmax = Math.max(gmax, h); gmin = Math.min(gmin, h); }
  const Y = gmax + 0.02, FL = 0.45, WH = 2.6, T = 0.15;
  const HW2 = (lx, ly, lz) => [hx + lx * c + lz * s, Y + ly, hz - lx * s + lz * c];
  B.frame(hx, Y, hz, r);
  B.bbox('concrete', 0, gmin - Y - 0.4, 0, W + 0.3, FL - (gmin - Y - 0.4), D + 0.3, 0.02, { color: [0.66, 0.66, 0.64] });
  // walls with their openings (face 0 front, 1 back, 2 right, 3 left; x along each face as the face's frame lays it:
  // the right wall's x runs to -z, the left wall's to +z, the back wall's to -x)
  const HOLES = {
    0: [{ x0: -4.1, x1: -3.05, y0: FL, y1: FL + 2.05, d: T, door: true }, { x0: 0.1, x1: 4.3, y0: FL + 0.12, y1: FL + 2.05, d: T }],
    1: [{ x0: -3.4, x1: -1.6, y0: FL + 1.0, y1: FL + 2.0, d: T }, { x0: 3.6, x1: 4.5, y0: FL + 1.45, y1: FL + 2.05, d: T, frosted: true }],
    2: [{ x0: -3.3, x1: -2.2, y0: FL + 0.85, y1: FL + 2.0, d: T }, { x0: 1.4, x1: 3.0, y0: FL + 0.95, y1: FL + 2.0, d: T }],
    3: [{ x0: -0.2, x1: 1.8, y0: FL + 0.85, y1: FL + 2.0, d: T }, { x0: -2.65, x1: -2.05, y0: FL + 1.5, y1: FL + 2.05, d: T, frosted: true }],
  };
  const FACES = [[0, D / 2, W], [Math.PI, D / 2, W], [Math.PI / 2, W / 2, D], [-Math.PI / 2, W / 2, D]];
  const WALL = [0.93, 0.91, 0.86], TRIM = [0.36, 0.25, 0.17];
  FACES.forEach(([fr, off, fw], fi) => inFrame(B, [Math.sin(fr) * off, 0, Math.cos(fr) * off], fr, () => {
    wallFill(B, 'plaster', -fw / 2, fw / 2, FL, FL + WH, HOLES[fi], WALL, 3);
    wallFill(B, 'wood', -fw / 2, fw / 2, FL - 0.02, FL + 0.06, HOLES[fi], TRIM, 1);
    for (const h of HOLES[fi]) { reveals(B, 'plaster', h, [0.88, 0.86, 0.82]); if (!h.door) windowUnit(B, h, { rng: Math.random, type: h.x1 - h.x0 > 1.2 ? 'slide' : 'fixed', frosted: h.frosted, lit: false, frame: [0.3, 0.28, 0.26] }); }
  }));
  // the door's frame and architrave (its leaf moves: below), the steps up to it, a lamp, the deck before the big window
  inFrame(B, [0, 0, D / 2], 0, () => { const h = HOLES[0][0], cx = (h.x0 + h.x1) / 2;
    for (const x of [h.x0 + 0.025, h.x1 - 0.025]) B.bbox('wood', x, h.y0, -0.04, 0.05, h.y1 - h.y0, 0.1, 0.006, { color: TRIM });
    B.bbox('wood', cx, h.y1 - 0.05, -0.04, h.x1 - h.x0, 0.05, 0.1, 0.006, { color: TRIM });
    B.bbox('concrete', cx, FL - 0.15, 0.35, 1.5, 0.15, 0.7, 0.01, { color: [0.7, 0.7, 0.68] }); B.bbox('concrete', cx, FL - 0.3, 0.75, 1.6, 0.15, 0.6, 0.01, { color: [0.68, 0.68, 0.66] });
    B.bbox('concrete', cx, gmin - Y - 0.2, 0.75, 1.6, FL - 0.3 - (gmin - Y - 0.2), 0.6, 0.01, { color: [0.62, 0.62, 0.6] });
    B.bbox('wood', 2.2, FL - 0.06, 0.5, 4.6, 0.06, 1.0, 0.008, { color: [0.55, 0.38, 0.24] }); // (the engawa deck)
    for (const x of [0.1, 2.2, 4.3]) B.box('wood', x, gmin - Y - 0.1, 0.9, 0.08, FL - 0.06 - (gmin - Y - 0.1), 0.08, { color: [0.4, 0.28, 0.18] });
    B.bbox('plain', h.x1 + 0.35, FL + 1.75, 0.04, 0.16, 0.22, 0.08, 0.01, { color: [0.95, 0.92, 0.82] }); // (the porch lamp)
    B.bbox('plain', h.x1 + 0.5, FL + 1.2, 0.02, 0.28, 0.1, 0.03, 0.005, { color: [0.2, 0.18, 0.16] }); // (the nameplate)
  });
  lampPoints.push({ p: HW2(-2.7, FL + 1.75, D / 2 + 0.3), s: 0.12 });
  gableRoof(B, { w: W, d: D, y: FL + WH, pitch: 0.48, over: 0.6, mat: 'roofTile', color: [0.27, 0.3, 0.36], wallMat: 'plaster', wallColor: WALL, ground: gmin - Y });
  // ---------------------------------------------------------------- the rooms (the rooms' builder: indoor materials)
  const IN = [0.94, 0.92, 0.87];
  // inner skins of the outer walls: each face again, turned inward, a wall's thickness in, the openings mirrored
  FACES.forEach(([fr, off, fw], fi) => {
    const [wx, , wz] = HW2(Math.sin(fr) * (off - T), 0, Math.cos(fr) * (off - T));
    IB.frame(wx, Y, wz, r + fr + Math.PI);
    const holes = HOLES[fi].map(h => ({ ...h, x0: -h.x1, x1: -h.x0 }));
    wallFill(IB, 'matte', -fw / 2 + T, fw / 2 - T, FL, FL + WH, holes, IN, 3);
    for (const h of holes) if (!h.door) IB.box('wood', (h.x0 + h.x1) / 2, h.y0 - 0.04, 0.05, h.x1 - h.x0 + 0.1, 0.04, 0.1, { color: [0.62, 0.48, 0.32] }); // (sills)
    wallFill(IB, 'wood', -fw / 2 + T, fw / 2 - T, FL, FL + 0.08, holes, [0.42, 0.3, 0.2], 1); // (skirting)
  });
  IB.frame(hx, Y, hz, r);
  const x0 = -W / 2 + T, x1 = W / 2 - T, z0 = -D / 2 + T, z1 = D / 2 - T, PX = -1.6, GZ = 2.4, BZ = -0.6, TX = -3.2;
  const up = (mat, a, b, cc, d, y, col = [1, 1, 1], uv = 1) => IB.poly(mat, [[a, y, b], [cc, y, b], [cc, y, d], [a, y, d]], [0, 1, 0], { color: col, uv });
  up('woodWarm', PX, z0, x1, z1, FL + 0.004); up('stone', x0, GZ, PX, z1, FL + 0.004); up('woodWarm', x0, BZ, PX, GZ, FL + 0.004, [0.92, 0.88, 0.82]); up('kitchen', x0, z0, PX, BZ, FL + 0.004, [1, 1, 1], 1.4);
  IB.poly('matte', [[x0, FL + WH - 0.01, z0], [x1, FL + WH - 0.01, z0], [x1, FL + WH - 0.01, z1], [x0, FL + WH - 0.01, z1]], [0, -1, 0], { color: [0.97, 0.96, 0.93] }); // (ceiling)
  IB.box('wood', PX + 0.05, FL, (GZ + z1) / 2, 0.12, 0.03, z1 - GZ, { color: [0.45, 0.32, 0.2] }); // (the genkan's step edge)
  // partitions with their doorways: the bedroom's and washroom's wall along x = PX, the genkan's, the bath's
  const wallZ = (x, za, zb, gaps) => { let z = za; for (const [g0, g1] of [...gaps, [zb, zb]]) { if (g0 > z) IB.box('matte', x, FL, (z + g0) / 2, 0.1, WH, g0 - z, { color: IN }); if (g1 > g0) IB.box('matte', x, FL + 2.05, (g0 + g1) / 2, 0.1, WH - 2.05, g1 - g0, { color: IN }); z = g1; } };
  const wallX = (z, xa, xb, gaps) => { let x = xa; for (const [g0, g1] of [...gaps, [xb, xb]]) { if (g0 > x) IB.box('matte', (x + g0) / 2, FL, z, g0 - x, WH, 0.1, { color: IN }); if (g1 > g0) IB.box('matte', (g0 + g1) / 2, FL + 2.05, z, g1 - g0, WH - 2.05, 0.1, { color: IN }); x = g1; } };
  const BED_DOOR = [0.5, 1.35], BATH_DOOR = [-2.75, -1.9];
  wallZ(PX, z0, GZ, [BED_DOOR, BATH_DOOR]); wallX(GZ, x0, PX, []); wallX(BZ, x0, PX, []); wallZ(TX, z0, BZ, [[-2.6, -1.8]]);
  for (const [x, zz] of [[PX, BED_DOOR], [PX, BATH_DOOR]]) for (const sd of [-1, 1]) { IB.box('wood', x + sd * 0.055, FL, zz[0], 0.012, 2.08, 0.06, { color: TRIM }); IB.box('wood', x + sd * 0.055, FL, zz[1], 0.012, 2.08, 0.06, { color: TRIM }); IB.box('wood', x + sd * 0.055, FL + 2.05, (zz[0] + zz[1]) / 2, 0.012, 0.06, zz[1] - zz[0] + 0.06, { color: TRIM }); }
  // the kitchen counter along the back wall (oven, sink and fridge stand in its gaps); the genkan's shoe cupboard
  for (const [a, b] of [[1.32, 2.33], [2.87, 4.06]]) { IB.box('matte', (a + b) / 2, FL, z0 + 0.3, b - a, 0.86, 0.6, { color: [0.86, 0.84, 0.8] }); IB.box('gloss', (a + b) / 2, FL + 0.86, z0 + 0.31, b - a + 0.02, 0.04, 0.64, { color: [0.3, 0.3, 0.32] }); }
  IB.box('wood', x0 + 0.22, FL, GZ + 0.8, 0.4, 1.0, 1.1, { color: [0.48, 0.34, 0.22] });
  // lamps of the rooms
  for (const [lx, lz, i] of [[3.0, 1.2, 7], [2.4, -2.1, 6.5], [-3.2, 1.0, 6], [-3.2, -2.3, 6], [-3.2, 3.2, 5]]) lampPoints.push(roomLamp(HW2(lx, FL + WH - 0.35, lz), i, [1.0, 0.86, 0.68], 4.2));
  // ---------------------------------------------------------------- furniture from the packs
  // place(id, x, y, z, yaw, k): house-local, the model's front (+z) turned by yaw (yaw = atan2(dx, dz) faces (dx, dz)),
  // k: size against the pack's own (a number or [x, y, z])
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), Yax = new THREE.Vector3(0, 1, 0), _v = new THREE.Vector3(), _s = new THREE.Vector3(), mats = new Map();
  const inMat = m => { if (!mats.has(m)) { const k = indoor(m.clone(), 'glb'); k.envMapIntensity = 0.6; mats.set(m, k); } return mats.get(m); };
  const place = (id, lx, ly, lz, yaw = 0, k = 1, collide = true, outdoor = false) => {
    const P = models.get(id); if (!P) return; const b = SC(id), w = HW2(lx, ly, lz);
    _m.compose(_v.set(w[0], w[1], w[2]), _q.setFromAxisAngle(Yax, r + yaw), Array.isArray(k) ? _s.set(k[0] * b, k[1] * b, k[2] * b) : _s.setScalar(k * b));
    const parts = P.map(p => ({ geometry: p.geometry, material: outdoor ? p.material : inMat(p.material), matrix: _m.clone().multiply(p.m), castShadow: outdoor, near: 110 }));
    addProp('home:' + id, parts);
    if (collide) for (const p of parts) { const g = p.geometry, pos = g.attributes.position, idx = g.index, n = idx ? idx.count : pos.count; for (let i = 0; i < n; i++) { _v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(p.matrix); tris.push(_v.x, _v.y, _v.z); } }
  };
  const F = FL + 0.005, PI = Math.PI;
  // living room (front right): the TV on its low board against the right wall, the couch facing it over a low table
  // on a round rug, an armchair by the big window, a floor lamp, plants, a bookshelf and the clock
  place('i_drawer_2', 4.6, F, 0.9, -PI / 2, [0.85, 0.75, 0.85]); place('h_monitor', 4.62, F + 0.49, 0.9, -PI / 2, 1.6, false);
  place('i_round_rug', 3.1, F, 0.9, 0, 1.5, false); place('i_couch_medium_2', 1.85, F, 0.9, PI / 2, 0.88); place('i_table_round_small_2', 3.1, F, 0.9, 0, [0.7, 0.72, 0.7]);
  place('h_cup_of_tea', 3.0, F + 0.41, 0.8, 0, 1, false); place('h_books', 3.2, F + 0.41, 1.05, 0.4, 1, false);
  place('h_armchair', 3.5, F, 2.65, -3.0, 0.85); place('i_light_floor_2', 1.25, F, 2.2, 0, [1, 1.9, 1]);
  place('i_houseplant_5', 4.45, F, 3.45, 0, 1.4); place('i_houseplant_2', 0.0, F, 3.55, 0, 1.6);
  place('i_curtains_double', 0.62, F + 0.02, 3.76, PI, [0.6, 0.9, 1], false); place('i_curtains_double', 3.78, F + 0.02, 3.76, PI, [0.6, 0.9, 1], false);
  place('i_shelf_large', -1.42, F, -0.75, PI / 2, 0.8); place('h_grandfathers_clock', 4.66, F, -0.5, -PI / 2, 1);
  place('i_light_ceiling', 3.0, FL + WH, 1.0, 0, 1, false); place('i_light_ceiling', 2.4, FL + WH, -1.75, 0, 1, false);
  // dining kitchen (back right): oven, sink and fridge in the counter along the back wall; the table and four chairs
  place('i_oven', 1.0, F, z0 + 0.29, 0, [1, 1.1, 1]); place('i_kitchen_sink', 2.6, F, z0 + 0.3, 0, [1, 0.92, 1]); place('i_kitchen_fridge', 4.4, F, z0 + 0.34, 0, [1, 1.1, 1]);
  place('h_frying_pan', 1.0, F + 0.88, z0 + 0.32, 0.3, 1, false); place('h_piggy_bank', 3.6, F + 0.9, z0 + 0.3, -0.4, 1, false); place('h_flowers', 3.2, F + 0.9, z0 + 0.25, 0, 0.8, false);
  place('i_table_round_large', 2.4, F, -1.75, 0, [0.75, 1.3, 0.85]); for (const [cx, cz, cy] of [[1.95, -2.5, 0], [2.85, -2.5, 0], [1.95, -1.0, PI], [2.85, -1.0, PI]]) place('i_chair', cx, F, cz, cy, 1);
  place('h_fruit_bowl', 2.4, F + 0.73, -1.75, 0, 1, false);
  // bedroom (middle left): the bed's head against the genkan's wall, a night stand and lamp, a dresser, the desk
  place('i_bed_king', -4.08, F, 1.41, PI, 1); place('i_night_stand', -3.0, F, 2.12, PI, 1); place('i_table_lamp', -3.0, F + 0.47, 2.12, 0, 1, false); place('h_alarm_clock', -2.88, F + 0.47, 2.0, -0.5 + PI, 1, false);
  place('h_dresser', -2.2, F, 2.19, PI, [0.75, 0.9, 0.75]); place('h_globe', -2.15, F + 0.8, 2.2, 0, 1, false);
  place('h_desk', -2.75, F, -0.25, 0, [0.75, 1.2, 0.75]); place('h_computer', -2.95, F + 0.73, -0.35, 0, 1, false); place('i_cactus', -2.25, F + 0.73, -0.4, 0, 1, false); place('h_chair', -2.75, F, 0.45, PI, 1);
  place('h_wall_corkboard', -2.75, F + 1.15, -0.53, 0, 1, false); place('i_light_ceiling', -3.2, FL + WH, 1.0, 0, 1, false);
  // washroom (back left, by its door: the basin, the washing machine, the toilet) and the bathroom behind it
  place('i_bathroom_sink', -2.0, F, -0.85, PI, 1); place('i_washing_machine', -2.75, F, -0.95, PI, 1); place('i_toilet', -2.4, F, z0 + 0.43, 0, 1); place('i_toilet_paper_stack', -1.85, F, z0 + 0.15, 0, 1, false);
  place('i_bathtub', -4.43, F, z0 + 0.99, 0, 1); place('i_towel_rack', -3.28, F + 1.3, -3.2, -PI / 2, 1, false);
  // the genkan: coat rack, umbrella, a plant on the shoe cupboard
  place('h_coat_rack', -2.1, F, 3.5, 0, 1); place('h_closed_umbrella', -2.65, F, 3.62, 0, 1, false); place('i_houseplant_3', -4.55, F + 1.0, 2.85, 0, 0.8, false);
  // outside: the mailbox where the path meets the road, a bird house, tools by the field
  const SX = (lx, lz) => [lx - HX, lz - HZ]; // (site to house frame)
  if (road) { const [ax, az] = SX(DX + 1.1, HD + road - 0.6), [wx, wz] = S(DX + 1.1, HD + road - 0.6); place('h_mailbox', ax, gy(wx, wz) - Y - 0.02, az, 0, 1, true, true); }
  place('h_bird_house', 5.12, FL + 1.6, -2.2, PI / 2, 1.2, false, true);
  { const at = (lx, lz) => { const [wx, wz] = S(lx + HX, lz + HZ); return gy(wx, wz) - Y; };
    place('h_hoe', 5.5, at(5.5, 2.6) + 0.03, 2.6, PI / 2, 0.8, false, true); place('h_watering_can', 5.45, at(5.45, 3.3), 3.3, 0.5, 1, false, true); place('h_toolbox', 5.4, at(5.4, 1.8), 1.8, 0, 1, true, true); }
  // ---------------------------------------------------------------- doors (their leaves move: E)
  const doors = [];
  const doorLeaf = (hingeX, hingeZ, along, w, openSign, col) => { // a leaf hinged at (hingeX, hingeZ), w long along x (along='x') or z
    const g = new THREE.Group(), leaf = new THREE.Mesh(new THREE.BoxGeometry(along === 'x' ? w : 0.045, 2.0, along === 'x' ? 0.045 : w), new THREE.MeshStandardMaterial({ color: col, roughness: 0.6 }));
    leaf.position.set(along === 'x' ? w / 2 : 0, 1.0, along === 'x' ? 0 : w / 2); g.add(leaf);
    const knob = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), new THREE.MeshStandardMaterial({ color: 0xc8b070, roughness: 0.3, metalness: 0.7 })); knob.position.set(along === 'x' ? w - 0.08 : 0.04, 1.0, along === 'x' ? 0.04 : w - 0.08); g.add(knob);
    const k2 = knob.clone(); k2.position.set(along === 'x' ? w - 0.08 : -0.04, 1.0, along === 'x' ? -0.04 : w - 0.08); g.add(k2);
    const p = HW2(hingeX, FL, hingeZ); g.position.set(p[0], p[1], p[2]); g.rotation.y = r; g.updateMatrixWorld(true); leaf.castShadow = true; scene.add(g);
    const mid = HW2(along === 'x' ? hingeX + w / 2 : hingeX, 0, along === 'x' ? hingeZ : hingeZ + w / 2);
    const col2 = { t: 1, x: mid[0], z: mid[2], hx: along === 'x' ? w / 2 : 0.06, hz: along === 'x' ? 0.06 : w / 2, c: Math.cos(r), s: Math.sin(r), y0: Y + FL - 0.5, y1: Y + FL + 2.1 };
    const d = { x: mid[0], z: mid[2], t: 0, want: 0, on: true, move(t) { g.rotation.y = r + openSign * t * 1.45; g.updateMatrixWorld(true); }, block(v) { if (v === this.on) return; this.on = v; if (v) colInsert(col2); else colRemove(col2); } };
    colInsert(col2); doors.push(d); return d;
  };
  const fh = HOLES[0][0];
  doorLeaf(fh.x0 + 0.04, D / 2 - T + 0.02, 'x', fh.x1 - fh.x0 - 0.08, 1, 0x5a3a24).name = 'Front door';
  doorLeaf(PX, BED_DOOR[0], 'z', BED_DOOR[1] - BED_DOOR[0], -1, 0xe8e2d6).name = 'Bedroom door';
  doorLeaf(PX, BATH_DOOR[0], 'z', BATH_DOOR[1] - BATH_DOOR[0], -1, 0xe8e2d6).name = 'Washroom door';
  // ---------------------------------------------------------------- the field: plots, fence, the board, the shipping box
  const [fx, fz] = S(FX, FZ), fy = gy(fx, fz);
  const plotAt = i => { const cI = i % COLS, rI = Math.floor(i / COLS), lx = FX - FW / 2 + PLOT / 2 + cI * (PLOT + GAP), lz = FZ + FD / 2 - PLOT / 2 - rI * (PLOT + GAP); const [px, pz] = S(lx, lz); return { lx, lz, x: px, z: pz, y: gy(px, pz) }; };
  const plots = state.plots.map((p, i) => ({ ...plotAt(i), i }));
  // fence round the field with a gate in the middle of its front (toward the house's path)
  const fenceP = (lx0, lz0, lx1, lz1) => { const L = Math.hypot(lx1 - lx0, lz1 - lz0), n = Math.max(1, Math.round(L / 2.5)); for (let k = 0; k < n; k++) { const t = (k + 0.5) / n, lx = lx0 + (lx1 - lx0) * t, lz = lz0 + (lz1 - lz0) * t, [px, pz] = S(lx, lz); packProp('farm_fence_wood', px, gy(px, pz), pz, r + Math.atan2(lx1 - lx0, lz1 - lz0) - Math.PI / 2, [L / n / 2.5, 1, 1]); } };
  const ex0 = FX - FW / 2 - 0.8, ex1 = FX + FW / 2 + 0.8, ez0 = FZ - FD / 2 - 0.8, ez1 = GATE;
  fenceP(ex0, ez0, ex1, ez0); fenceP(ex1, ez0, ex1, ez1); fenceP(ex0, ez1, ex0, ez0); fenceP(ex0, ez1, FX - 1.4, ez1); fenceP(FX + 1.4, ez1, ex1, ez1);
  const box = S(FX - 2.6, ez1 + 0.9); packProp('farm_crate', box[0], gy(...box), box[1], r + 0.2, 1);
  { const [lx, lz] = S(FX - 1.6, ez1 + 0.35), ly = gy(lx, lz), pole = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.7, 0.1), new THREE.MeshStandardMaterial({ color: 0x5a4430, roughness: 0.8 }));
    pole.position.set(lx, ly + 1.35, lz); pole.rotation.y = r; pole.castShadow = true; pole.updateMatrixWorld(); scene.add(pole);
    const [ax2, az2] = S(FX - 1.6, ez1 + 0.6), shade = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.16, 12, 1, true), new THREE.MeshStandardMaterial({ color: 0x2f3a33, roughness: 0.5, side: THREE.DoubleSide })); shade.position.set(ax2, ly + 2.62, az2); shade.updateMatrixWorld(); scene.add(shade);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), new THREE.MeshStandardMaterial({ color: 0xfff2d8, emissive: 0xffd9a0, emissiveIntensity: 1.2 })); bulb.position.set(ax2, ly + 2.53, az2); bulb.updateMatrixWorld(); scene.add(bulb);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.3), pole.material); const [mx, mz] = S(FX - 1.6, ez1 + 0.48); arm.position.set(mx, ly + 2.68, mz); arm.rotation.y = r; arm.updateMatrixWorld(); scene.add(arm);
    lampPoints.push({ p: [ax2, ly + 2.5, az2], s: 0.35 }); }
  // the board by the gate
  const board = signMesh(1.3, 0.9, (g, W2, H2) => { g.fillStyle = '#5a3a20'; g.fillRect(0, 0, W2, H2); g.fillStyle = '#f2ead6'; g.fillRect(W2 * 0.05, H2 * 0.08, W2 * 0.9, H2 * 0.84); g.fillStyle = '#2b2420'; g.textAlign = 'center'; g.font = `bold ${H2 * 0.24}px "Yu Mincho", serif`; g.fillText('さくら農園', W2 / 2, H2 * 0.4); g.font = `${H2 * 0.12}px "Segoe UI", sans-serif`; g.fillText('MY FARM  ·  E', W2 / 2, H2 * 0.62); g.fillStyle = '#5f8a2e'; g.fillRect(W2 * 0.2, H2 * 0.72, W2 * 0.6, H2 * 0.06); }, 0.05, 256);
  { const [px, pz] = S(FX + 2.6, ez1 + 0.5), by = gy(px, pz); board.position.set(px, by + 1.25, pz); board.rotation.y = r; board.updateMatrixWorld(); scene.add(board);
    for (const e of [-0.55, 0.55]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.3, 0.08), new THREE.MeshStandardMaterial({ color: 0x4a3020, roughness: 0.8 })); const [qx, qz] = S(FX + 2.6 + e, ez1 + 0.5); post.position.set(qx, by + 0.65, qz); post.updateMatrixWorld(); scene.add(post); } }
  // ---------------------------------------------------------------- the collider: the house and what stands in it
  for (const [k, b] of B.parts) { const P2 = b.pos.a, I = b.idx.a; for (let i = mark.get(k) || 0; i < b.idx.length; i++) { const v = I[i] * 3; tris.push(P2[v], P2[v + 1], P2[v + 2]); } }
  for (const [k, b] of IB.parts) { const P2 = b.pos.a, I = b.idx.a; for (let i = ibMark.get(k) || 0; i < b.idx.length; i++) { const v = I[i] * 3; tris.push(P2[v], P2[v + 1], P2[v + 2]); } }
  [capHooks.bucket, capHooks.collider, capHooks.prop, capHooks.frame] = cap;
  addCompound(buildCompound(new Float32Array(tris), { x: hx, y: Y, z: hz, r, ground: (x, z) => gy(x, z) }));
  const sprinklers = [S(FX - FW / 4, FZ), S(FX + FW / 4, FZ)].map(([x, z]) => [x, gy(x, z), z]);
  const home = { site: { x: sx, z: sz, r }, house: { x: hx, z: hz, y: Y, FL }, doors, plots, sprinklers, field: { x: fx, z: fz, y: fy }, bed: HW2(-4.08, 0, 1.41), boardAt: S(FX + 2.6, ez1 + 1.2), spawnAt: HW2(-3.575, FL, D / 2 + 2.2) };
  console.info(`home: house at ${hx.toFixed(0)}, ${hz.toFixed(0)} facing ${Math.round(r * 180 / Math.PI)}°, ${road ? road + ' m from the road' : 'no road near'}; ${COLS * ROWS} plots`);
  return home;
}

// ---------------------------------------------------------------- the farm and the house while you play
// home: what buildHome returned; ui: shopui; returns { spots, update(dt) }
export function homeRuntime(home, ui) {
  if (!home) return { spots: [], update() {} };
  const P = packsReady(), r = home.site.r, cr = Math.cos(r), sr = Math.sin(r);
  const Q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r), M4 = new THREE.Matrix4(), V = new THREE.Vector3(), SV = new THREE.Vector3(), QJ = new THREE.Quaternion(), YA = new THREE.Vector3(0, 1, 0);
  // the plots you own: tilled earth in a frame of boards (instanced); the next one for sale: a sign on its stake
  const furrow = (() => { const cv = document.createElement('canvas'); cv.width = cv.height = 256; const g = cv.getContext('2d'); g.fillStyle = '#86603f'; g.fillRect(0, 0, 256, 256); for (let i = 0; i < 6; i++) { const y = 18 + i * 43; g.fillStyle = '#6a4a31'; g.fillRect(0, y, 256, 16); g.fillStyle = '#a07a55'; g.fillRect(0, y + 16, 256, 7); } for (let i = 0; i < 1400; i++) { g.fillStyle = i % 2 ? 'rgba(50,34,20,.35)' : 'rgba(190,160,120,.3)'; g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); } const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; })();
  const N = home.plots.length;
  const soil = new THREE.InstancedMesh(new THREE.BoxGeometry(PLOT - 0.08, 0.14, PLOT - 0.08), new THREE.MeshStandardMaterial({ map: furrow, roughness: 0.95 }), N);
  const boards = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x6b4a30, roughness: 0.85 }), N * 4);
  for (const m of [soil, boards]) { m.receiveShadow = true; m.castShadow = false; m.frustumCulled = false; m.userData.noDistCull = true; m.count = 0; scene.add(m); }
  const crops = {}; // crop -> [InstancedMesh per part]
  for (const [id, C] of Object.entries(CROPS)) { const parts = P && packParts(C.model); if (!parts) continue; crops[id] = parts.map(q => { const im = new THREE.InstancedMesh(q.geometry, q.material, N * C.n * C.n); im.count = 0; im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; im.userData.noDistCull = true; scene.add(im); return im; }); }
  const at = (p, lx, lz) => V.set(p.x + lx * cr + lz * sr, p.y, p.z - lx * sr + lz * cr);
  let sale = null, saleFor = -1;
  function saleSign() { // the stake and its sign on the next plot for sale
    const next = state.plots.findIndex(q => !q.own), own = state.plots.filter(q => q.own).length;
    if (next === saleFor) return; saleFor = next; if (sale) { scene.remove(sale); sale = null; } if (next < 0) return;
    const p = home.plots[next], price = plotPrice(own);
    sale = new THREE.Group();
    const sign = signMesh(0.7, 0.5, (g, W2, H2) => { g.fillStyle = '#f6f1e2'; g.fillRect(0, 0, W2, H2); g.strokeStyle = '#b8322a'; g.lineWidth = H2 * 0.05; g.strokeRect(H2 * 0.05, H2 * 0.05, W2 - H2 * 0.1, H2 - H2 * 0.1); g.fillStyle = '#b8322a'; g.textAlign = 'center'; g.font = `bold ${H2 * 0.34}px "Yu Mincho", serif`; g.fillText('売 地', W2 / 2, H2 * 0.45); g.fillStyle = '#2b2420'; g.font = `bold ${H2 * 0.2}px "Segoe UI", sans-serif`; g.fillText('¥' + price.toLocaleString('ja-JP') + ' · E', W2 / 2, H2 * 0.78); }, 0.1, 192);
    sign.position.set(0, 1.0, 0); sale.add(sign);
    const stake = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.0, 0.06), new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.8 })); stake.position.y = 0.5; sale.add(stake);
    at(p, 0, PLOT / 2 - 0.2); sale.position.copy(V); sale.rotation.y = r; sale.traverse(o => o.updateMatrixWorld && o.updateMatrixWorld()); sale.updateMatrixWorld(true); scene.add(sale);
  }
  // the sprinklers (bought): standing in the field, a fine spray turning
  let spray = null;
  function sprinklers() {
    if (spray || !state.upg.sprinkler) return; spray = new THREE.Group();
    const parts = P && packParts('farm_sprinkler');
    for (const [x, y, z] of home.sprinklers) { if (parts) for (const q of parts) { const m = new THREE.Mesh(q.geometry, q.material); m.position.set(x, y, z); m.rotation.y = r; m.castShadow = true; spray.add(m); }
      const jet = new THREE.Mesh(new THREE.ConeGeometry(2.6, 1.2, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide })); jet.position.set(x, y + 1.1, z); jet.rotation.x = Math.PI; spray.add(jet); }
    spray.traverse(o => o.updateMatrixWorld && o.updateMatrixWorld()); scene.add(spray);
  }
  let dirty = true;
  function redraw() {
    let ns = 0, nb = 0;
    home.plots.forEach((p, i) => { const s = state.plots[i]; if (!s.own) return;
      at(p, 0, 0); V.y += 0.03; M4.compose(V, Q, SV.set(1, 1, 1)); soil.setMatrixAt(ns++, M4);
      for (const [bx, bz, w, d] of [[0, PLOT / 2 - 0.03, PLOT, 0.06], [0, -PLOT / 2 + 0.03, PLOT, 0.06], [PLOT / 2 - 0.03, 0, 0.06, PLOT - 0.12], [-PLOT / 2 + 0.03, 0, 0.06, PLOT - 0.12]]) { at(p, bx, bz); V.y += 0.04; M4.compose(V, Q, SV.set(w, 0.2, d)); boards.setMatrixAt(nb++, M4); } });
    soil.count = ns; boards.count = nb; soil.instanceMatrix.needsUpdate = boards.instanceMatrix.needsUpdate = true;
    const cnt = {}; for (const id in crops) cnt[id] = 0;
    home.plots.forEach((p, i) => { const s = state.plots[i]; if (!s.crop || !crops[s.crop]) return; const C = CROPS[s.crop], n = C.n, g = Math.min(1, s.g), sc = C.s * (0.15 + 0.85 * Math.pow(g, 0.8)), step = (PLOT - 0.2) / n;
      for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) { const jit = ((i * 7 + a * 3 + b * 5) % 7) / 7;
        at(p, -PLOT / 2 + 0.1 + step * (a + 0.5), -PLOT / 2 + 0.1 + step * (b + 0.5)); V.y += 0.1; M4.compose(V, QJ.setFromAxisAngle(YA, jit * 6.28), SV.setScalar(sc * (0.9 + jit * 0.2)));
        for (const im of crops[s.crop]) im.setMatrixAt(cnt[s.crop], M4); cnt[s.crop]++; } });
    for (const id in crops) for (const im of crops[id]) { im.count = cnt[id]; im.instanceMatrix.needsUpdate = true; }
    saleSign(); sprinklers();
  }
  // growth: the hours of the game since the last frame (a night's sleep is a jump of the clock)
  let lastH = time.hour;
  function grow(dh) {
    if (dh <= 0) return; const k = state.upg.sprinkler ? 1.5 : 1;
    state.plots.forEach(s => { if (!s.crop || s.g >= 1) return; const before = Math.floor(s.g * 12); s.g = Math.min(1, s.g + dh * k / CROPS[s.crop].hours); if (Math.floor(s.g * 12) !== before || s.g >= 1) dirty = true; });
    if (state.upg.hand) state.plots.forEach(s => { if (s.crop && s.g >= 1) { const C = CROPS[s.crop]; earn(C.sell); state.earned += C.sell; if (inv.yen >= C.price) { earn(-C.price); s.g = 0; } else s.crop = null; dirty = true; } });
  }
  // ---- what E does round the house and the field
  const spots = [];
  for (const d of home.doors) spots.push({ kind: 'custom', x: d.x, z: d.z, r: 1.6, prompt: () => `<b>E</b><span>${d.want ? 'Close' : 'Open'} — ${d.name}</span>`, use: () => { d.want = d.want ? 0 : 1; return false; } });
  spots.push({ kind: 'custom', x: home.bed[0], z: home.bed[2], r: 1.9, prompt: () => `<b>E</b><span>Sleep until morning</span><span class="jp">寝る</span>`, use: () => {
    const h = time.hour, to = 6.5, dh = (to - h + 24) % 24 || 24; time.hour = to; updateSky(true); lastH = to; grow(dh); save(); toastMsg('Slept ' + Math.round(dh) + ' h — good morning (6:30)'); dirty = true; return false; } });
  const sow = s => ({ title: 'Seeds', jp: '種', seeds: Object.entries(CROPS).map(([id, C]) => ({ ...C, id: 'crop_' + id, crop: id, sz: [2, 2] })), sprinkler: !!state.upg.sprinkler,
    pick(id) { const C = CROPS[id]; if (!spend(C.price)) return false; s.crop = id; s.g = 0; dirty = true; save(); toastMsg('Sown: ' + C.name + ' ' + C.jp); return true; } });
  const buyNext = () => { const own = state.plots.filter(q => q.own).length, next = state.plots.findIndex(q => !q.own); if (next < 0 || !spend(plotPrice(own))) return false; state.plots[next].own = true; dirty = true; save(); toastMsg('A new plot — dug and ready'); return true; };
  home.plots.forEach((p, i) => spots.push({ kind: 'custom', x: p.x, z: p.z, r: 1.4, prompt: () => {
    const s = state.plots[i];
    if (!s.own) return state.plots.findIndex(q => !q.own) === i ? `<b>E</b><span>Buy this plot — ${yen(plotPrice(state.plots.filter(q => q.own).length))}</span><span class="jp">畑を買う</span>` : null;
    if (!s.crop) return `<b>E</b><span>Sow seeds</span><span class="jp">種をまく</span>`;
    const C = CROPS[s.crop]; if (s.g >= 1) return `<b>E</b><span>Harvest ${C.name} — ${yen(C.sell)}</span><span class="jp">収穫</span>`;
    return `<span>${C.name} ${C.jp} — ${Math.floor(s.g * 100)}% · ripe in ${Math.ceil((1 - s.g) * C.hours / (state.upg.sprinkler ? 1.5 : 1) * 10) / 10} h</span>`; },
    use: () => {
      const s = state.plots[i];
      if (!s.own) { buyNext(); return false; }
      if (!s.crop) { ui.show('seeds', sow(s)); return true; }
      if (s.g >= 1) { const C = CROPS[s.crop]; earn(C.sell); state.earned += C.sell; s.crop = null; s.g = 0; dirty = true; save(); toastMsg('Harvested ' + C.name + ' — +' + yen(C.sell) + ' into the shipping box'); }
      return false; } }));
  spots.push({ kind: 'custom', x: home.boardAt[0], z: home.boardAt[1], r: 1.8, prompt: () => `<b>E</b><span>Farm board — plots & upgrades</span><span class="jp">農園の掲示板</span>`, use: () => { ui.show('farm', farmPanel()); return true; } });
  function farmPanel() {
    const own = state.plots.filter(q => q.own).length, growing = state.plots.filter(q => q.crop).length, ripe = state.plots.filter(q => q.crop && q.g >= 1).length;
    const acts = [];
    if (own < state.plots.length) acts.push({ label: 'Buy the next plot', jp: '畑を広げる', price: plotPrice(own), note: own + ' of ' + state.plots.length + ' plots yours', run: buyNext });
    for (const [k, U] of Object.entries(UPGRADES)) acts.push({ label: U.name, jp: U.jp, price: U.price, note: U.note, done: !!state.upg[k], run() { if (state.upg[k] || !spend(U.price)) return; state.upg[k] = true; dirty = true; save(); toastMsg(U.name + ' — bought'); } });
    return { title: 'さくら農園', sub: 'MY FARM', stats: [['Plots', own + ' / ' + state.plots.length], ['Growing', growing], ['Ripe', ripe], ['Earned so far', yen(state.earned)]], acts, refresh: () => farmPanel() };
  }
  return {
    spots, state,
    update(dt) {
      const h = time.hour; let dh = h - lastH; if (dh < -12) dh += 24; if (dh > 0 && dh < 12) grow(dh); lastH = h;
      for (const d of home.doors) { const t = Math.max(0, Math.min(1, d.t + (d.want ? 1 : -1) * dt / 0.5)); if (t !== d.t) { d.t = t; d.move(t * t * (3 - 2 * t)); } d.block(d.t < 0.6); }
      if (spray) spray.children.forEach(o => { if (o.geometry && o.geometry.type === 'ConeGeometry') { o.rotation.y += dt * 2; o.updateMatrixWorld(); } });
      if (dirty) { redraw(); save(); dirty = false; }
    },
  };
}
