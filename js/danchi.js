// 桜川ニュータウン — the apartment district east of the river. It stands apart from the old town: the river with its
// cherry promenade and a belt of rice paddies lie between them, and it is reached by the Funabashi bridge road (F),
// by three entries off the main road (A) and by the bus. Its own street structure is a loop road (DU) round the
// district with footways, a tree-lined avenue (DA) up the middle from the main road to the loop's north arc, a south
// street (DS) and a local street (DL); F runs through it east-west to the loop's far side. The superblocks between
// them hold building groups of several families at different heights and orientations, parking courts, courtyards
// that differ from block to block, a neighbourhood centre with shops and the bus stop, and a green belt with a park
// and a sports ground along the main road. Its rim steps down in scale to terraced low-rise flats and then to the
// fields, the wooded hill foot and the countryside.
export const DANCHI = {
  // the developed area: loop road plus its outer frontage, and the green belt down to the main road
  poly: [[338, -17], [657, -17], [657, 144], [608, 208], [577, 256], [534, 298], [490, 338], [432, 352], [380, 348], [350, 318], [338, 250]],
};
// district streets (appended to the town's road list): the loop, the avenue, the south street, local streets
export const DANCHI_ROADS = [
  { id: 'DU', kind: 'lane', w: 5.5, walk: 2.0, district: true, noLots: true, mat: 'asphalt', age: 0.28,
    pts: [[346, -25], [346, 120], [347, 250], [356, 298], [384, 318], [430, 324], [480, 312], [528, 286], [568, 248], [598, 202], [614, 140], [614, -25]] },
  { id: 'DA', kind: 'road', w: 7.0, walk: 3.0, center: 'white', district: true, noLots: true, mat: 'asphalt', age: 0.22,
    pts: [[422, -25], [422, 40], [425, 100], [435, 150], [452, 200], [474, 248], [500, 290], [511, 300]] },
  { id: 'DS', kind: 'lane', w: 5.5, walk: 2.0, district: true, noLots: true, mat: 'asphalt', age: 0.3, pts: [[346, 56], [614, 56]] },
  { id: 'DL', kind: 'lane', w: 5.0, walk: 2.0, district: true, noLots: true, mat: 'asphalt', age: 0.34, pts: [[528, 56], [530, 128], [527, 200]] },
  { id: 'DN', kind: 'lane', w: 5.0, walk: 2.0, district: true, noLots: true, mat: 'asphalt', age: 0.32, pts: [[398, 200], [400, 262], [404, 322]] },
];

const inPoly = (P, x, z) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, zi] = P[i], [xj, zj] = P[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
function polyDist(P, x, z) {
  let d = 1e9;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [ax, az] = P[j], [bx, bz] = P[i], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
    d = Math.min(d, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return inPoly(P, x, z) ? -d : d;
}
// signed distance to the district outline (negative inside)
export const danchiSD = (x, z) => (x < 300 || x > 680 || z < -60 || z > 380) ? 99 : polyDist(DANCHI.poly, x, z);
export const inDanchi = (x, z, pad = 0) => danchiSD(x, z) < pad;
const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// the platform: level with the valley floor over most of the district, rising gently (to ~1 m) into the north-east
// corner where it is cut into the hill foot; outside the outline the ground blends back to the natural slope over
// 26 m (a grassed bank), so the district reads as terraced into the valley side rather than stamped onto it
export const danchiLift = (x, z) => 1.0 * ss(0.58, 1.0, ((x - 346) / 270 + (z - 56) / 270) / 2);
export function danchiGround(x, z, h, Y0) {
  const d = danchiSD(x, z); if (d > 26) return h;
  const target = Y0 + danchiLift(x, z), w = ss(26, 1, d);
  return h + (target - h) * w - lakeDepth(x, z);
}

// ---------------------------------------------------------------- building the district
import { THREE, scene, lerp, clamp, mulberry32, addBox, addCircle } from './core.js';
import { lampPoints, signMesh, JP_FONT } from './townkit.js';
import { walkupSlab, pointTower, mansion, centreBlock, cornerBlock, lowRise, PALETTES, envelope } from './apartments.js';
import { buildParks, lakeDepth } from './danchipark.js';
import { turfU } from './terrain.js';

// building groups by superblock: [family, x, z, yaw, options]. Yaw turns the building's front (balconies) to face
// (sin r, cos r); most face the sun (south, -z) but every group has buildings turned to close a courtyard, follow the
// avenue's bend or look out over the hill.
const BUILDINGS = [
  // south-west block: two walk-up slabs framing a lawn court, a point tower at the avenue corner, a low-rise block by F
  ['S', 384, 80, Math.PI, { w: 41.4, floors: 5, pal: 'cream', no: 1 }],
  ['S', 393, 126, Math.PI - 0.12, { w: 27.6, floors: 4, pal: 'salmon', no: 2, bal: 'rail' }],
  ['T', 420, 168, Math.PI + 0.25, { floors: 14, pal: 'white', no: 1, name: 'サクラタワー 壱番館' }],
  ['S', 394, 150, Math.PI, { w: 27.6, floors: 4, pal: 'sand', no: 9, bal: 'rail' }],
  ['R', 372, 176, Math.PI, { w: 22, pal: 'cream', name: 'コーポ桜' }],
  // south-east block A: the neighbourhood centre on the F / avenue corner, a U of flats round the playground court
  ['L', 459, 190, 0, { wa: 58, wb: 46, dp: 17, pal: 'brick', no: 21 }],
  ['S', 476, 80, Math.PI, { w: 55.2, floors: 5, pal: 'grey', no: 3 }],
  ['S', 508, 118, Math.PI / 2, { w: 27.6, floors: 4, pal: 'sand', no: 4, bal: 'rail' }],
  ['M', 450, 114, -Math.PI / 2, { w: 33, floors: 7, pal: 'mocha', no: 5, name: 'パークハイツ桜川 東' }],
  // south-east block B: a long mid-rise with pilotis parking, a tower over the paved court
  ['M', 568, 84, Math.PI, { w: 46.2, floors: 8, pal: 'grey', no: 6, pilotis: 1, name: 'パークハイツ桜川 南' }],
  ['T', 575, 160, Math.PI - 0.35, { floors: 13, pal: 'blue', no: 2, name: 'サクラタワー 弐番館' }],
  // the loop road's outer frontage on the east: two slabs looking out to the wooded hill, entered from the loop road
  ['S', 637, 74, Math.PI / 2, { w: 41.4, floors: 5, pal: 'salmon', no: 10 }],
  ['S', 637, 121, Math.PI / 2, { w: 27.6, floors: 5, pal: 'terra', no: 11, bal: 'rail' }],
  // north-west: low-rise terraces along the west edge (toward the paddies), a tower and a slab turned along the avenue
  ['R', 372, 225, Math.PI / 2, { w: 20, pal: 'sand', name: 'ハイツ川辺' }],
  ['R', 371, 252, Math.PI / 2, { w: 20, pal: 'cream', name: 'メゾン花水木' }],
  ['R', 372, 279, Math.PI / 2, { w: 18, pal: 'salmon', name: 'グリーンハイツ' }],
  ['T', 428, 236, Math.PI - 0.1, { floors: 10, pal: 'terra', no: 3, name: 'サクラタワー 参番館' }],
  ['R', 440, 214, Math.PI, { w: 22, pal: 'cream', name: 'レジデンス若葉' }],
  ['S', 468, 280, 2.125, { w: 27.6, floors: 5, pal: 'cream', no: 7 }],
  // north-east: a mid-rise facing F, a tower looking out over the hill foot
  ['M', 503, 224, Math.PI + 0.08, { w: 39.6, floors: 7, pal: 'blue', no: 8, name: 'パークハイツ桜川 北' }],
  ['T', 548, 236, Math.PI - 0.4, { floors: 11, pal: 'sand', no: 4, name: 'サクラタワー 四番館' }],
  // the north rim: low-rise flats stepping up the hill foot beyond the loop road, their galleries toward it
  ['R', 400, 336, Math.PI, { w: 22, pal: 'sand', name: 'ハイム東雲' }],
  ['R', 432, 340, Math.PI, { w: 22, pal: 'grey', name: 'サンライズ桜川' }],
  ['R', 464, 331, Math.PI + 0.22, { w: 20, pal: 'cream', name: 'コーポ丘の上' }],
  // green belt, west end: a corner block on the avenue / south street corner and a walk-up opposite round a court
  ['K', 405, 41, Math.PI, { wa: 22, wb: 22, floors: 7, pal: 'white', no: 14, name: 'グランコート桜川' }],
  ['S', 365, 21.5, Math.PI / 2, { w: 27.6, floors: 4, pal: 'sand', no: 12, bal: 'rail' }],
  // east of the loop's south-east arc: a mid-rise along the local street with pilotis parking, a tower on F's north side
  ['M', 543, 176, -Math.PI / 2 + 0.05, { w: 29.7, floors: 6, pal: 'terra', no: 13, pilotis: 1, name: 'パークハイツ桜川 西' }],
  ['R', 578, 215, Math.PI - 0.5, { w: 20, pal: 'cream', name: 'コーポ桜台' }],
  // the north interior: a tall tower on the rise under the hill, looking south over the bosque
  ['T', 425, 300, Math.PI, { floors: 13, pal: 'grey', no: 5, name: 'サクラタワー 五番館' }],
  // more low-rise flats on the rim: beyond the north-east arc and on the east frontage
  ['R', 506.2, 312.6, -2.64, { w: 20, pal: 'sand', name: 'コーポ若草' }],
  ['R', 630, 158, -Math.PI / 2, { w: 20, pal: 'grey', name: 'ハイツ山の手' }],
];
// bays straight off the street in front of the low-rise flats (perpendicular, reversed in, the kerb dropped along them),
// either side of the gap their entrance path takes: [building index by position, road id, depth]
const ROAD_BAYS = [[400, 336, 'DU', 5.0], [432, 340, 'DU', 5.0], [464, 331, 'DU', 4.9], [630, 158, 'DU', 5.2], [372, 225, 'DN', 5.2], [371, 252, 'DN', 5.2], [372, 279, 'DN', 5.2]];
// parking courts: an access aisle from a street straight into the court, bays both sides. [road id, x, z at the
// road's edge (the entry), direction into the court (radians, as a yaw), aisle length, rows]
const PARKING = [
  ['DU', 350.75, 104, Math.PI / 2, 28, 2], ['DU', 350.75, 148, Math.PI / 2, 26, 2],     // south-west block, off the loop road
  ['DL', 525.3, 152, -Math.PI / 2, 38, 2, 5],                                             // behind the centre: residents and shoppers (visitor bays)
  ['DL', 534.8, 110, Math.PI / 2, 54, 2],                                                 // south-east block B
  ['DN', 404.5, 270, Math.PI / 2, 34, 2],                                                 // north-west, off the local street
  ['DA', 488.2, 262, Math.PI / 2 - 0.05, 38, 2],                                          // north-east, off the avenue
  ['DU', 618.75, 36, Math.PI / 2, 32, 2],                                                 // east frontage, off the loop road
  ['DU', 618.75, 99, Math.PI / 2, 26, 1],
  ['DU', 350.75, -3, Math.PI / 2, 34, 2],                                                 // green belt west: the corner block and its walk-up
];

export function buildDanchi(ctx) {
  const { B, Y0, gy, RN, extras, hf } = ctx, rng = mulberry32(19740), out = { trees: [], hedges: [], bushes: [], carSpots: [], bikes: [], walkPaths: [], lamps: [], benches: [], groves: [] };
  const P2 = (x, z) => [x, gy(x, z), z];
  const BUS = [[492, 194.8, Math.PI], [420, 205.2, 0]];                               // F's bus stops at the centre, both ways
  const paint = (c, x0, z0, x1, z1, fn) => hf.paint2(c, Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1), fn);
  // paved ground (fine mask): no grass through paving, and lawn right up to its edge
  const pave = (x0, z0, x1, z1, fn) => hf.paintPave(Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1), fn);
  const inRect = (x, z, cx, cz, r, hw, hd, m = 0) => { const c = Math.cos(r), s = Math.sin(r), dx = x - cx, dz = z - cz; return Math.abs(dx * c - dz * s) < hw + m && Math.abs(dx * s + dz * c) < hd + m; };
  // the whole district is mown lawn unless something else is laid there
  paint(3, 320, -30, 670, 370, (x, z) => inDanchi(x, z, 12) ? 1 : 0);
  // pedestrian navigation grid (1 m) over the district, kept alongside the town's occupancy: 0 lawn, 1 paving (a path
  // or plaza, with its region id), 2 blocked (buildings, water, equipment, fences), 3 footway, 4 car park. Entrance paths
  // are routed over it so every door is reached without cutting through a building, a court or a pond, and designed
  // paths that stop short of a footway are joined to the network
  const NX0 = 330, NZ0 = -34, NW = 340, NH = 396, NAV = new Uint8Array(NW * NH), REG = new Int16Array(NW * NH).fill(-1), regions = [];
  const navI = (x, z) => { const i = Math.floor(x - NX0), j = Math.floor(z - NZ0); return i < 0 || j < 0 || i >= NW || j >= NH ? -1 : j * NW + i; };
  // paving coverage at 0.5 m (up to two surfaces a cell, by region id; 32000 for plazas and other paving): the concrete
  // edging of a path is laid last and left out wherever it would run across another path, a plaza or a footway
  const CW = NW * 2, CH = NH * 2, COV = new Int16Array(CW * CH).fill(-1), COV2 = new Int16Array(CW * CH).fill(-1), edgeQ = [];
  const covI = (x, z) => { const i = Math.floor((x - NX0) * 2), j = Math.floor((z - NZ0) * 2); return i < 0 || j < 0 || i >= CW || j >= CH ? -1 : j * CW + i; };
  const covMark = (k, rid) => { if (k < 0) return; if (COV[k] === -1 || COV[k] === rid) COV[k] = rid; else if (COV2[k] === -1) COV2[k] = rid; };
  const coverPoly = (Q, rid) => { const xs = Q.map(q => q[0]), zs = Q.map(q => q[1]);
    for (let z = Math.floor(Math.min(...zs) * 2) / 2; z <= Math.max(...zs); z += 0.5) for (let x = Math.floor(Math.min(...xs) * 2) / 2; x <= Math.max(...xs); x += 0.5) { const px = x + 0.25, pz = z + 0.25; let inside = true;
      for (let j = 0; j < Q.length && inside; j++) { const [x1, z1] = Q[j], [x2, z2] = Q[(j + 1) % Q.length]; if ((x2 - x1) * (pz - z1) - (z2 - z1) * (px - x1) < 0) inside = false; }
      if (inside) covMark(covI(px, pz), rid); } };
  const coverRect = (x0, z0, x1, z1, rid = 32000) => coverPoly([[x0, z0], [x1, z0], [x1, z1], [x0, z1]], rid);
  const coverDisc = (cx, cz, r, rid = 32000) => { for (let z = cz - r; z <= cz + r; z += 0.5) for (let x = cx - r; x <= cx + r; x += 0.5) if (Math.hypot(x - cx, z - cz) < r) covMark(covI(x, z), rid); };
  const flushEdges = () => { for (const e of edgeQ) { const mx = (e.a[0] + e.b[0]) / 2, mz = (e.a[2] + e.b[2]) / 2, k = covI(mx, mz);
      if (RN.walkY(mx, mz) !== null || RN.roadAt(mx, mz)) continue; if (k >= 0 && ((COV[k] >= 0 && COV[k] !== e.rid) || (COV2[k] >= 0 && COV2[k] !== e.rid))) continue;
      B.detail(1, () => B.beam('concrete', [e.a[0], e.a[1] - 0.04, e.a[2]], [e.b[0], e.b[1] - 0.04, e.b[2]], 0.1, 0.12, { color: [0.74, 0.74, 0.72] })); } edgeQ.length = 0; };
  const navRect = (cx, cz, hw, hd, r, v, rid = -1) => { const R = Math.hypot(hw, hd) + 1;
    for (let z = Math.floor(cz - R); z <= cz + R; z++) for (let x = Math.floor(cx - R); x <= cx + R; x++) {
      if (!inRect(x + 0.5, z + 0.5, cx, cz, r, hw, hd)) continue; const k = navI(x + 0.5, z + 0.5); if (k < 0) continue;
      if (v === 2) { NAV[k] = 2; REG[k] = -1; } else if (NAV[k] !== 2) { NAV[k] = v; REG[k] = v === 1 ? rid : -1; } } };
  // occupancy for the town (lots, props, scattered trees) and the grid: kind 2 blocked unless said otherwise
  const occRect = (cx, cz, hw, hd, r, val, kind = 2, rid = -1) => { ctx.occRect(cx, cz, hw, hd, r, val); navRect(cx, cz, hw, hd, r, kind, rid); };

  // ---- buildings
  // placement: a building's whole envelope (walls, balconies, gardens, stair towers, lobbies with their steps, ramps and
  // forecourts; apartments.js envelope()) must stand clear of every carriageway and footway by CLR and of the envelopes
  // of the buildings already placed. A group's planned position is the starting point; where the envelope breaks those
  // rules the building is walked away from the conflict (half a metre at a time along the mean direction from the
  // offending ground to its centre) until it fits; one that cannot be fitted within 12 m is not built.
  const CLR = 0.8, placed = [];
  const envWorld = (fam, o, x, z, r) => { const c = Math.cos(r), sn = Math.sin(r);
    return envelope(fam, o).map(([[a0, b0], [a1, b1]]) => { const cx = (a0 + a1) / 2, cz = (b0 + b1) / 2; return { x: x + cx * c + cz * sn, z: z - cx * sn + cz * c, hw: (a1 - a0) / 2, hd: (b1 - b0) / 2, r }; }); };
  const onStreet = (px, pz) => { if (RN.roadAt(px, pz) || RN.walkY(px, pz) !== null) return true;
    for (let a = 0; a < 6.28; a += 1.05) if (RN.roadAt(px + Math.cos(a) * CLR, pz + Math.sin(a) * CLR) || RN.walkY(px + Math.cos(a) * CLR, pz + Math.sin(a) * CLR) !== null) return true; return false; };
  const conflicts = (rects, street, first = false) => { const bad = [];
    for (const q of rects) { const c = Math.cos(q.r), sn = Math.sin(q.r), nu = Math.max(1, Math.ceil(q.hw * 2)), nv = Math.max(1, Math.ceil(q.hd * 2));
      for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) { const u = -q.hw + 2 * q.hw * i / nu, v = -q.hd + 2 * q.hd * j / nv, px = q.x + u * c + v * sn, pz = q.z - u * sn + v * c;
        if (!inDanchi(px, pz, 30) || (street && onStreet(px, pz)) || placed.some(P => P.some(E => inRect(px, pz, E.x, E.z, E.r, E.hw, E.hd, 1.0)))) { bad.push([px, pz]); if (first) return bad; } } }
    return bad; };
  // walk away from the conflict first (it keeps a building close to its plan); if that stalls, search outward on a
  // spiral for the nearest spot where the whole envelope fits
  const fit = (fam, o, x, z, r) => { let px = x, pz = z;
    for (let it = 0; it < 30; it++) { const bad = conflicts(envWorld(fam, o, px, pz, r), fam !== 'L'); if (!bad.length) return [px, pz];
      let dx = 0, dz = 0; for (const [bx, bz] of bad) { const l = Math.hypot(px - bx, pz - bz) || 1; dx += (px - bx) / l; dz += (pz - bz) / l; } const l = Math.hypot(dx, dz) || 1; px += dx / l * 0.5; pz += dz / l * 0.5; }
    for (let rad = 1; rad <= 24; rad += 1) for (let k = 0, n = Math.ceil(rad * 2 * Math.PI / 1.5); k < n; k++) { const a = k / n * Math.PI * 2, qx = x + Math.cos(a) * rad, qz = z + Math.sin(a) * rad;
      if (!conflicts(envWorld(fam, o, qx, qz, r), fam !== 'L', true).length) return [qx, qz]; }
    return null; };
  const blds = [];
  for (const [fam, x0, z0, r, o] of BUILDINGS) {
    const at = fit(fam, o, x0, z0, r); if (!at) { console.warn("danchi: no room for", fam, x0, z0); continue; }
    const [x, z] = at; placed.push(envWorld(fam, o, x, z, r));
    const y = gy(x, z) + 0.02, pal = PALETTES[o.pal] || PALETTES.cream, s = { ...o, x, y, z, r, pal, gy };
    const info = fam === 'S' ? walkupSlab(B, s, rng, extras) : fam === 'T' ? pointTower(B, s, rng, extras) : fam === 'M' ? mansion(B, s, rng, extras) : fam === 'L' ? centreBlock(B, s, rng, extras) : fam === 'K' ? cornerBlock(B, s, rng, extras) : lowRise(B, s, rng, extras);
    info.fam = fam; info.x = x; info.z = z; info.r = r; info.y = y; info.x0 = x0; info.z0 = z0; info.wa = o.wa; blds.push(info);
    // keep everything else off its footprint (one rectangle, or several for the L-shaped centre); no grass against it
    info.boxes = [];
    for (const fp of info.boxes0 || [info.footprint || [[-30, -12], [30, 12]]]) {
      const hw = (fp[1][0] - fp[0][0]) / 2, hd = (fp[1][1] - fp[0][1]) / 2, cx = (fp[0][0] + fp[1][0]) / 2, cz = (fp[0][1] + fp[1][1]) / 2;
      const c = Math.cos(r), sn = Math.sin(r), wx = x + cx * c + cz * sn, wz = z - cx * sn + cz * c, R = Math.hypot(hw, hd) + 1;
      occRect(wx, wz, hw, hd, r, 1);
      info.boxes.push({ x: wx, z: wz, hw, hd, r });
      pave(wx - R, wz - R, wx + R, wz + R, (px, pz) => inRect(px, pz, wx, wz, r, hw, hd, 0.3) ? 1 : 0);
    }
  }
  const clear = (x, z, m = 1.0) => !blds.some(b => b.boxes.some(q => inRect(x, z, q.x, q.z, q.r, q.hw, q.hd, m)));

  // ---- paved paths: pavers with concrete edging laid as one mitred ribbon (no notches or overlaps at the bends), draped
  // on the ground in 1 m steps; where an end runs into a street's footway the path rises to meet the footway's back edge
  // at its height (a gentle ramp, a concrete skirt along the raised part) and tucks under it. Lamps (short posts) along
  // it. yo: height over the ground (designed paths lie a few millimetres above the branch paths that join them, so a
  // branch's run-on end disappears under the path it meets instead of flickering with it)
  const walkEdge = (pts, end) => { // where a path end inside a footway leaves it, walking back along the path
    const [x0, z0] = end ? pts[pts.length - 1] : pts[0]; if (RN.walkY(x0, z0) === null) return null;
    let px = x0, pz = z0, i = end ? pts.length - 1 : 0, d = end ? -1 : 1, left = 4;
    while (left > 0 && i + d >= 0 && i + d < pts.length) { const [bx, bz] = pts[i + d], L = Math.hypot(bx - px, bz - pz);
      for (let t = 0.05; t <= L; t += 0.05) { const x = px + (bx - px) * t / L, z = pz + (bz - pz) * t / L; if (RN.walkY(x, z) === null) { const q = t - 0.08, xi = px + (bx - px) * q / L, zi = pz + (bz - pz) * q / L; return { x, z, y: RN.walkY(xi, zi) ?? RN.walkY(px, pz) }; } }
      left -= L; px = bx; pz = bz; i += d; }
    return null; };
  const g0w = w => w >= 2.2 ? 2 : 1;                                                                                   // pedestrians: busier on the wider paths
  const pathLine = (pts0, w = 2.4, { lamps = true, edge = true, mat = 'pavement', color = [0.84, 0.82, 0.78], link = false, yo = 0.05 } = {}) => {
    const pts = []; for (const p of pts0) if (!pts.length || Math.hypot(p[0] - pts[pts.length - 1][0], p[1] - pts[pts.length - 1][1]) > 0.15) pts.push([p[0], p[1]]);
    const rid = regions.length; regions.push({ kind: 'path', pts: pts.map(p => [p[0], p[1]]), w, link, connected: false });
    if (pts.length < 2) return rid;
    const n = pts.length, seg = [], off = [];
    for (let i = 0; i + 1 < n; i++) { const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L; seg.push({ ax, az, bx, bz, L, ux, uz, nx: -uz, nz: ux }); }
    for (let i = 0; i < n; i++) { const a = seg[Math.max(0, i - 1)], b = seg[Math.min(n - 2, i)]; let mx = a.nx + b.nx, mz = a.nz + b.nz; const ml = Math.hypot(mx, mz) || 1; mx /= ml; mz /= ml;
      // a full mitre only where both legs are long enough to carry it (a short leg's corners would cross and fold)
      const short = i > 0 && i < n - 1 && Math.min(a.L, b.L) < w * 1.1, k = short ? 1 : 1 / Math.max(0.4, mx * b.nx + mz * b.nz); off.push([mx * k, mz * k]); }
    const anchors = [walkEdge(pts, false), walkEdge(pts, true)].filter(Boolean);
    const H = (x, z) => { let y = gy(x, z) + yo; for (const a of anchors) y = Math.max(y, a.y - 0.09 * Math.max(0, Math.hypot(x - a.x, z - a.z) - 0.3)); const wy = RN.walkY(x, z); return wy !== null ? Math.min(y, wy - 0.006) : y; };
    B.frame(0, 0, 0, 0);
    let s0 = 0;
    for (let i = 0; i + 1 < n; i++) {
      const g = seg[i], N = Math.max(1, Math.ceil(g.L / 1.0));
      const at = (f, e) => { const x = g.ax + (g.bx - g.ax) * f + (off[i][0] * (1 - f) + off[i + 1][0] * f) * e, z = g.az + (g.bz - g.az) * f + (off[i][1] * (1 - f) + off[i + 1][1] * f) * e; return [x, H(x, z), z]; };
      for (let k = 0; k < N; k++) {
        const f0 = k / N, f1 = (k + 1) / N, t0 = s0 + g.L * f0, t1 = s0 + g.L * f1;
        const p4 = [at(f0, -w / 2), at(f1, -w / 2), at(f1, w / 2), at(f0, w / 2)];
        B.poly(mat, p4, [0, 1, 0], { color, uvs: p4.map(v => [v[0] / 1.2, v[2] / 1.2]), attr: mat === 'pavement' ? { aPave: [[t0, 0.5], [t1, 0.5], [t1, 0.5 + w], [t0, 0.5 + w]] } : undefined });
        for (const e of [-1, 1]) {
          const a = at(f0, e * (w / 2 + 0.05)), b = at(f1, e * (w / 2 + 0.05)), ga = gy(a[0], a[2]), gb = gy(b[0], b[2]);
          if (edge) edgeQ.push({ a, b, rid });
          if (a[1] - ga > yo + 0.03 || b[1] - gb > yo + 0.03) { const c = at(f0, e * (w / 2 + 0.1)), d = at(f1, e * (w / 2 + 0.1));      // skirt under a raised end
            B.poly('concrete', [[c[0], ga - 0.06, c[2]], [d[0], gb - 0.06, d[2]], [d[0], b[1] - 0.02, d[2]], [c[0], a[1] - 0.02, c[2]]], [g.nx * e, 0, g.nz * e], { color: [0.72, 0.72, 0.7] }); }
        }
      }
      // grass off the paving: the segment's mitred quad, a little wider
      coverPoly([[g.ax - off[i][0] * w / 2, g.az - off[i][1] * w / 2], [g.bx - off[i + 1][0] * w / 2, g.bz - off[i + 1][1] * w / 2], [g.bx + off[i + 1][0] * w / 2, g.bz + off[i + 1][1] * w / 2], [g.ax + off[i][0] * w / 2, g.az + off[i][1] * w / 2]], rid);
      const q = [[g.ax - off[i][0] * (w / 2 + 0.2), g.az - off[i][1] * (w / 2 + 0.2)], [g.bx - off[i + 1][0] * (w / 2 + 0.2), g.bz - off[i + 1][1] * (w / 2 + 0.2)], [g.bx + off[i + 1][0] * (w / 2 + 0.2), g.bz + off[i + 1][1] * (w / 2 + 0.2)], [g.ax + off[i][0] * (w / 2 + 0.2), g.az + off[i][1] * (w / 2 + 0.2)]];
      const inQ = (px, pz) => { for (let j = 0; j < 4; j++) { const [x1, z1] = q[j], [x2, z2] = q[(j + 1) % 4]; if ((x2 - x1) * (pz - z1) - (z2 - z1) * (px - x1) < 0) return false; } return true; };
      pave(Math.min(...q.map(v => v[0])) - 0.5, Math.min(...q.map(v => v[1])) - 0.5, Math.max(...q.map(v => v[0])) + 0.5, Math.max(...q.map(v => v[1])) + 0.5, (px, pz) => inQ(px, pz) ? 1 : 0);
      occRect((g.ax + g.bx) / 2, (g.az + g.bz) / 2, w / 2 + 0.3, g.L / 2 + 0.3, Math.atan2(g.bx - g.ax, g.bz - g.az), 1, 1, rid);
      if (lamps) for (let t = 6; t < g.L - 2; t += 16) { const x = g.ax + g.ux * t + g.nx * (w / 2 + 0.6), z = g.az + g.uz * t + g.nz * (w / 2 + 0.6); if (clear(x, z, 0.3) && !poles.some(p => Math.hypot(p[0] - x, p[1] - z) < 8)) { const q = freeSpot(x, z, 0.35); if (q && Math.hypot(q[0] - x, q[1] - z) < 1.2) pathLamp(q[0], q[1]); } }
      s0 += g.L;
    }
    out.walkPaths.push({ pts: pts.map(p => [p[0], p[1]]), off: 0, lift: null, w: g0w(w) });
    return rid;
  };
  // a paved forecourt (an entrance's apron) on four world corners, laid on the ground in ~1 m cells
  const apron = (C, rid = -1, yo = 0.044, color = [0.8, 0.78, 0.74]) => {
    const [a, b, c, d] = C, L1 = Math.hypot(b[0] - a[0], b[1] - a[1]), L2 = Math.hypot(d[0] - a[0], d[1] - a[1]), nu = Math.max(1, Math.ceil(L1)), nv = Math.max(1, Math.ceil(L2));
    const at = (u, v) => { const x = a[0] + (b[0] - a[0]) * u + (d[0] - a[0]) * v, z = a[1] + (b[1] - a[1]) * u + (d[1] - a[1]) * v; return [x, gy(x, z) + yo, z]; };
    B.frame(0, 0, 0, 0);
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const u0 = i / nu, u1 = (i + 1) / nu, v0 = j / nv, v1 = (j + 1) / nv, p4 = [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)];
      B.poly('pavement', p4, [0, 1, 0], { color, uvs: p4.map(v => [v[0] / 1.2, v[2] / 1.2]), attr: { aPave: [[u0 * L1, v0 * L2 + 0.5], [u1 * L1, v0 * L2 + 0.5], [u1 * L1, v1 * L2 + 0.5], [u0 * L1, v1 * L2 + 0.5]] } }); }
    coverPoly(C, rid);
    for (const [p, q] of [[b, c], [c, d], [d, a]]) { const L = Math.hypot(q[0] - p[0], q[1] - p[1]), m = Math.max(1, Math.ceil(L / 1)), ox = (q[1] - p[1]) / L * 0.06, oz = -(q[0] - p[0]) / L * 0.06;
      for (let k = 0; k < m; k++) { const x0 = p[0] + (q[0] - p[0]) * k / m + ox, z0 = p[1] + (q[1] - p[1]) * k / m + oz, x1 = p[0] + (q[0] - p[0]) * (k + 1) / m + ox, z1 = p[1] + (q[1] - p[1]) * (k + 1) / m + oz;
        edgeQ.push({ a: [x0, gy(x0, z0) + yo + 0.004, z0], b: [x1, gy(x1, z1) + yo + 0.004, z1], rid }); } }
    const xs = C.map(p => p[0]), zs = C.map(p => p[1]), inC = (px, pz) => { for (let j = 0; j < 4; j++) { const [x1, z1] = C[j], [x2, z2] = C[(j + 1) % 4]; if ((x2 - x1) * (pz - z1) - (z2 - z1) * (px - x1) < -0.2 * Math.hypot(x2 - x1, z2 - z1)) return false; } return true; };
    pave(Math.min(...xs) - 1, Math.min(...zs) - 1, Math.max(...xs) + 1, Math.max(...zs) + 1, (px, pz) => inC(px, pz) ? 1 : 0);
    const cx = (a[0] + c[0]) / 2, cz = (a[1] + c[1]) / 2, r = Math.atan2(b[0] - a[0], b[1] - a[1]);
    occRect(cx, cz, L2 / 2, L1 / 2, r, 1, 1, rid);
  };
  const poles = [];
  const pathLamp = (x, z) => { const y = gy(x, z); B.frame(x, y, z, 0); poles.push([x, z]);
    B.cyl('steel', 0, 0, 0, 0.06, 0.05, 3.2, 10, { color: [0.3, 0.32, 0.34] }); B.cyl('metal', 0, 3.2, 0, 0.16, 0.2, 0.08, 14, { color: [0.28, 0.3, 0.32], cap: true });
    B.cyl('lamp', 0, 3.02, 0, 0.14, 0.14, 0.18, 12, {}); B.frame(0, 0, 0, 0); lampPoints.push({ p: [x, y + 2.9, z], s: 0.45 }); addCircle(x, z, 0.1); };
  // street lamp: a tapered galvanised pole with an LED head on a short arm over the carriageway
  const streetLamp = (x, z, yaw) => { const y = gy(x, z); B.frame(x, y, z, yaw); poles.push([x, z]);
    B.bbox('concrete', 0, -0.25, 0, 0.36, 0.3, 0.36, 0.02, { color: [0.7, 0.7, 0.68] });
    B.cyl('steel', 0, 0, 0, 0.1, 0.06, 7.6, 12, { color: [0.72, 0.74, 0.76] });
    B.sweep('steel', [[-0.03, -0.03], [0.03, -0.03], [0.03, 0.03], [-0.03, 0.03]], [[0, 7.5, 0], [0, 7.75, 0.4], [0, 7.8, 1.4]], { closed: true, caps: true, color: [0.72, 0.74, 0.76] });
    B.bbox('metal', 0, 7.68, 1.55, 0.3, 0.1, 0.62, 0.02, { color: [0.46, 0.48, 0.5] }); B.box('lamp', 0, 7.66, 1.55, 0.24, 0.02, 0.5);
    const p = B.P([0, 7.4, 1.55]); B.frame(0, 0, 0, 0); lampPoints.push({ p, s: 1.0 }); addCircle(x, z, 0.12); };

  // ---- streets: street lamps, trees, name signs
  const lampQ = [], signsAt = [];
  const edgePt = (n, s, side, off) => { const q = RN.sampleAt(n, s), l = [-q.d[1], q.d[0]], u = side * (n.hw + off); return { x: q.x + l[0] * u, z: q.z + l[1] * u, d: q.d, l }; };
  for (const id of ['DU', 'DA', 'DS', 'DL', 'DN', 'F']) {
    const n = RN.byId.get(id), W = n.walk || 2;
    for (let s = 14, k = 0; s < n.PL.len - 8; s += 30, k++) {
      const side = k % 2 ? 1 : -1, e = edgePt(n, s, side, W - 0.45);
      if (id === 'F' && e.x < 350) continue;
      if (RN.clipDist(n, s) < 3 || !clear(e.x, e.z, 0.5)) continue;
      lampQ.push({ n, s, side, W });                                                                                  // placed once the paths are laid
    }
    // the south street: cherries in tree pits along the park (the avenue's and F's trees stand in the verge behind their
    // shared footways — planted below, once the courts and paths that cross the verge are laid)
    const kind = id === 'DS' ? 'sakura' : null; if (!kind) continue;
    for (let s = 8; s < n.PL.len - 6; s += id === 'DA' ? 11 : 12) for (const side of id === 'DS' ? [-1] : [1, -1]) {
      const e = edgePt(n, s, side, W - 0.9); if (id === 'F' && e.x < 350) continue;
      if (RN.clipDist(n, s) < 4 || !clear(e.x, e.z, 0.5) || RN.walkAt(n, side, s) < 1.5) continue;
      out.trees.push({ kind, x: e.x, z: e.z, scale: kind === 'zelkova' ? 0.62 : kind === 'sakura' ? 0.8 : 0.7, pit: true });
      const y = gy(e.x, e.z) + 0.18; B.frame(e.x, y, e.z, Math.atan2(e.d[0], e.d[1]));
      B.bbox('concrete', 0, -0.04, 0, 1.0, 0.1, 1.0, 0.015, { color: [0.78, 0.78, 0.75], skip: 'ny' }); B.box('plain', 0, 0.0, 0, 0.84, 0.05, 0.84, { color: [0.32, 0.25, 0.19] });
      B.detail(2, () => { for (const [gx, gz, gw, gd] of [[0, 0.36, 0.84, 0.12], [0, -0.36, 0.84, 0.12], [0.36, 0, 0.12, 0.6], [-0.36, 0, 0.12, 0.6]]) B.box('metal', gx, 0.05, gz, gw, 0.012, gd, { color: [0.22, 0.22, 0.23] }); });
      B.frame(0, 0, 0, 0);
    }
  }
  // cycle route: F (from the town across the Funabashi bridge) and the avenue carry 自転車歩行者道 — shared footways
  // with a blue line dividing cyclists (kerb side) from walkers, pictograms painted every ~40 m in each direction of
  // travel and blue round 自転車及び歩行者専用 signs where the route enters each stretch
  { let signProto = null, signBack = null;
    const cycleSign = (x, z, yaw) => { const y = RN.walkY(x, z) ?? gy(x, z) + 0.15; B.frame(x, y, z, yaw);
      B.cyl('steel', 0, -0.1, 0, 0.035, 0.035, 2.75, 8, { color: [0.75, 0.77, 0.78] }); B.box('metal', 0, 2.2, 0.02, 0.12, 0.5, 0.04, { color: [0.6, 0.62, 0.64] });
      B.frame(0, 0, 0, 0);
      if (!signProto) signProto = signMesh(0.6, 0.6, (g, W2, H2) => { g.clearRect(0, 0, W2, H2); g.fillStyle = '#fff'; g.beginPath(); g.arc(W2 / 2, H2 / 2, W2 * 0.49, 0, 7); g.fill();
        g.fillStyle = '#1d55b0'; g.beginPath(); g.arc(W2 / 2, H2 / 2, W2 * 0.45, 0, 7); g.fill(); g.strokeStyle = g.fillStyle = '#fff'; g.lineCap = g.lineJoin = 'round'; const k = W2 / 256;
        g.lineWidth = 7 * k; for (const hx of [70, 132]) { g.beginPath(); g.arc(hx * k, 158 * k, 21 * k, 0, 7); g.stroke(); }
        g.beginPath(); g.moveTo(70 * k, 158 * k); g.lineTo(100 * k, 158 * k); g.lineTo(92 * k, 124 * k); g.lineTo(70 * k, 158 * k); g.moveTo(100 * k, 158 * k); g.lineTo(124 * k, 124 * k); g.lineTo(92 * k, 124 * k); g.moveTo(124 * k, 124 * k); g.lineTo(132 * k, 158 * k); g.moveTo(124 * k, 124 * k); g.lineTo(120 * k, 112 * k); g.stroke();
        g.lineWidth = 11 * k; g.beginPath(); g.arc(178 * k, 86 * k, 13 * k, 0, 7); g.fill(); g.beginPath(); g.moveTo(178 * k, 106 * k); g.lineTo(178 * k, 150 * k); g.moveTo(178 * k, 116 * k); g.lineTo(160 * k, 140 * k); g.moveTo(178 * k, 116 * k); g.lineTo(196 * k, 140 * k);
        g.moveTo(178 * k, 150 * k); g.lineTo(164 * k, 190 * k); g.moveTo(178 * k, 150 * k); g.lineTo(192 * k, 190 * k); g.stroke(); }, 0.2, 256);
      if (!signBack) signBack = new THREE.MeshStandardMaterial({ color: 0x9ea2a6, roughness: 0.5, metalness: 0.3, alphaMap: signProto.material.map, alphaTest: 0.5 });
      signsAt.push([x, z]);
      for (const face of [0, Math.PI]) { const m = face ? new THREE.Mesh(signProto.geometry, signBack) : signProto.parent ? signProto.clone() : signProto;
        const p = B.frame(x, y, z, yaw).P([0, 2.45, face ? 0.045 : 0.06]); B.frame(0, 0, 0, 0); m.position.set(...p); m.rotation.y = yaw + face; scene.add(m); }
      addCircle(x, z, 0.08); };
    const bridge = (x, z) => ctx.riverX && Math.abs(x - ctx.riverX(z)) < 19.5;
    for (const id of ['F', 'DA']) {
      const n = RN.byId.get(id), W = n.walk || 2, len = n.PL.len;
      for (const side of [1, -1]) {
        const ok = s => { const e = edgePt(n, s, side, W / 2); return RN.clipDist(n, s) > 3.5 && RN.walkAt(n, side, s) > W - 0.3 && !bridge(e.x, e.z) && RN.walkY(e.x, e.z) !== null
          && !BUS.some(b => Math.hypot(e.x - b[0], e.z - b[1]) < 7.5); };
        const yW = (x, z) => RN.walkY(x, z) ?? gy(x, z) + 0.15;
        // the dividing line, in 3 m pieces laid only where the footway runs full width
        for (let s = 0; s + 3 <= len; s += 3) { if (!ok(s) || !ok(s + 3)) continue;
          const a = edgePt(n, s, side, W * 0.5), b = edgePt(n, s + 3, side, W * 0.5), L = Math.hypot(b.x - a.x, b.z - a.z);
          RN.decal(B, 'paint', [(a.x + b.x) / 2, (a.z + b.z) / 2], [(b.x - a.x) / L, (b.z - a.z) / L], L / 2, 0.06, { y: yW, road: false, cell: 1.5, color: [0.2, 0.36, 0.66] }); }
        // pictograms: facing the direction of travel on that side (keep left)
        for (let s = 18; s < len - 6; s += 40) { if (!ok(s - 1.2) || !ok(s + 1.2)) continue;
          const c = edgePt(n, s, side, W * 0.5), f = side > 0 ? [-c.d[0], -c.d[1]] : [c.d[0], c.d[1]];
          RN.decal(B, 'cycleLegend', [c.x, c.z], f, 0.8, W / 2 - 0.2, { y: yW, road: false, uv01: true, cell: 0.8 }); }
        // signs at each stretch's start in the direction of travel, and about every 180 m
        const s0s = []; for (let s = 6; s < len - 6; s += 1) if (ok(s) && !ok(s + side)) s0s.push(s);
        for (let s = 6; s < len - 6; s += 180) if (ok(s)) s0s.push(s);
        for (const s of s0s) { const e = edgePt(n, s, side, W - 0.3); if (!clear(e.x, e.z, 0.3)) continue;
          if (poles.some(q => Math.hypot(q[0] - e.x, q[1] - e.z) < 1.4) || out.trees.some(t => Math.hypot(t.x - e.x, t.z - e.z) < 1.2)) continue;
          cycleSign(e.x, e.z, Math.atan2(e.d[0], e.d[1]) + (side > 0 ? 0 : Math.PI)); }
      }
    } }
  // district name at its two main gateways: low stone walls with the name, planted in front
  for (const [x, z, yaw] of [[431.5, -13, 0], [356.5, 190, -Math.PI / 2]]) {
    const y = gy(x, z); B.frame(x, y, z, yaw);
    B.bbox('stone', 0, -0.3, 0, 6.4, 1.6, 0.7, 0.03, { color: [0.62, 0.6, 0.56] }); B.bbox('stone', 0, 1.3, 0, 6.6, 0.12, 0.8, 0.02, { color: [0.56, 0.54, 0.5] });
    B.box('plain', 0, -0.2, 0.9, 6.2, 0.35, 0.9, { color: [0.3, 0.24, 0.18] }); B.frame(0, 0, 0, 0);
    const sg = signMesh(5.4, 0.9, (g, W2, H2) => { g.clearRect(0, 0, W2, H2); g.fillStyle = '#f1ece0'; g.font = `bold ${H2 * 0.5}px ${JP_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('桜川ニュータウン', W2 / 2, H2 * 0.42); g.font = `${H2 * 0.22}px Arial`; g.fillText('SAKURAGAWA NEW TOWN', W2 / 2, H2 * 0.82); }, 0.35, 512);
    sg.material.transparent = true; sg.material.alphaTest = 0.3; sg.position.set(...B.frame(x, y, z, yaw).P([0, 0.75, 0.37])); sg.rotation.y = yaw; scene.add(sg); B.frame(0, 0, 0, 0);
    for (let k = -2; k <= 2; k++) out.bushes.push({ x: x + Math.cos(yaw) * k * 1.3 + Math.sin(yaw) * 0.9, y: y - 0.05, z: z - Math.sin(yaw) * k * 1.3 + Math.cos(yaw) * 0.9, s: 0.7, sx: 1, r: k, c: new THREE.Color(0.36, 0.56, 0.3) });
    addBox(x, z, 3.2, 0.4, yaw);
  }

  // ---- parking courts
  const visitorBays = [];
  for (const [id, ex0, ez0, yaw, len0, rows, visitors = 0] of PARKING) {
    const n = RN.byId.get(id), fx = Math.sin(yaw), fz = Math.cos(yaw), lx = Math.cos(yaw), lz = -Math.sin(yaw), D = rows === 2 ? 16 : 11;
    // a court runs in from its street only as far as the buildings' envelopes (with its hedges and lamps) leave room
    let len = len0; const fits = L => { const cx = ex0 + fx * (L / 2 + 0.5), cz = ez0 + fz * (L / 2 + 0.5); return !conflicts([{ x: cx, z: cz, hw: D / 2 + 1.6, hd: L / 2 + 0.3, r: yaw }], false, true).length; };
    while (len >= 14 && !fits(len)) len -= 2; if (len < 14) continue;
    const cx = ex0 + fx * (len / 2 + 0.5), cz = ez0 + fz * (len / 2 + 0.5), y = gy(cx, cz) + 0.02;
    // the court: asphalt slab in a concrete kerb, the aisle down the middle, a driveway apron across the footway
    B.frame(cx, y, cz, yaw);
    B.bbox('asphalt', 0, -0.08, 0, D, 0.12, len, 0.01, { color: [1, 1, 1], skip: 'ny', uv: 4 });
    for (const e of [-1, 1]) B.bbox('concrete', e * (D / 2 + 0.08), -0.08, 0, 0.16, 0.24, len + 0.3, 0.015, { color: [0.78, 0.78, 0.75] });
    B.bbox('concrete', 0, -0.08, len / 2 + 0.08, D + 0.3, 0.24, 0.16, 0.015, { color: [0.78, 0.78, 0.75] });
    const nb = Math.floor((len - 3) / 2.5), spots = [];
    for (const e of rows === 2 ? [-1, 1] : [1]) for (let i = 0; i < nb; i++) {
      const bz = -len / 2 + 2 + (i + 0.5) * 2.5, bx = e * (D / 2 - 2.5);
      if (i % 7 === 3) { // planting island with a tree
        B.bbox('concrete', bx, 0.04, bz, 4.6, 0.16, 2.2, 0.02, { color: [0.78, 0.78, 0.75] }); B.box('plain', bx, 0.18, bz, 4.3, 0.03, 1.9, { color: [0.32, 0.36, 0.22] });
        const w = B.P([bx, 0, bz]); out.trees.push({ kind: rng() < 0.5 ? 'maple' : 'leaf', x: w[0], z: w[2], scale: 0.55 }); continue; }
      // visitor bays (来客用) at the court's entrance end of the first row: green lines, 来客 painted at the bay's head
      const vis = e < 0 && i < visitors, lineC = vis ? [0.3, 0.62, 0.36] : [0.94, 0.94, 0.92];
      for (const sgn of [-1, 1]) B.box('paint', bx, 0.045, bz + sgn * 1.25, 5.0, 0.004, 0.1, { color: lineC });
      if (vis) B.box('paint', e * (D / 2 - 5.0 + 0.05), 0.045, bz, 0.1, 0.004, 2.5, { color: lineC });
      B.detail(1, () => B.bbox('concrete', e * (D / 2 - 0.65), 0.04, bz, 0.14, 0.1, 1.6, 0.02, { color: [0.8, 0.8, 0.78] }));
      if (vis) visitorBays.push(B.P([bx - e * 1.5, 0.05, bz]));
      // the car lies along its bay (across the aisle), reversed in until its rear tyres touch the wheel stop, nose to
      // the aisle (a spot's r turns a car to face -(sin r, cos r)); stop: from the bay's middle back to the stop's face
      if (rng() < (vis ? 0.35 : 0.74)) spots.push({ p: B.P([bx, 0.04, bz]), r: yaw + e * Math.PI / 2, y: y + 0.05, stop: 1.78 });
    }
    B.box('paint', 0, 0.045, 0, 0.12, 0.004, len - 3, { color: [0.94, 0.94, 0.92] });                                // aisle centre line
    if (visitors) { // a sign on a post at the head of the visitor bays
      const sp = B.P([-(D / 2 + 0.6), 0, -len / 2 + 2]); B.frame(sp[0], y, sp[2], yaw); B.cyl('steel', 0, -0.1, 0, 0.035, 0.035, 2.1, 8, { color: [0.75, 0.77, 0.78] });
      const sg = signMesh(0.7, 0.5, (g, W2, H2) => { g.fillStyle = '#fff'; g.fillRect(0, 0, W2, H2); g.fillStyle = '#2f7a40'; g.fillRect(0, 0, W2, H2 * 0.42); g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.font = `bold ${H2 * 0.3}px ${JP_FONT}`; g.fillText('来客用', W2 / 2, H2 * 0.22); g.fillStyle = '#222'; g.font = `bold ${H2 * 0.17}px ${JP_FONT}`; g.fillText('駐車場 (2時間まで)', W2 / 2, H2 * 0.6); g.font = `${H2 * 0.12}px ${JP_FONT}`; g.fillText('管理事務所', W2 / 2, H2 * 0.85); }, 0.2, 256);
      B.bbox('metal', 0, 1.58, 0.02, 0.74, 0.54, 0.03, 0.006, { color: [0.62, 0.64, 0.66] });                     // back plate
      sg.position.set(...B.P([0, 1.85, -0.001])); sg.rotation.y = yaw + Math.PI; scene.add(sg);
      B.frame(cx, y, cz, yaw); }
    for (const vp of visitorBays.splice(0)) { const m = signMesh(1.2, 0.5, (g, W2, H2) => { g.clearRect(0, 0, W2, H2); g.fillStyle = '#e8eee6'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `bold ${H2 * 0.8}px ${JP_FONT}`; g.fillText('来客', W2 / 2, H2 * 0.55); }, 0.05, 128);
      m.material.transparent = true; m.material.alphaTest = 0.4; m.material.roughness = 0.62; m.position.set(vp[0], vp[1] + 0.001, vp[2]); m.rotation.set(-Math.PI / 2, 0, yaw + Math.PI / 2, 'YXZ'); scene.add(m); }
    // driveway apron through the kerb line of the street, and a lamp at the court's far corners
    B.bbox('concrete', 0, -0.1, -len / 2 - 0.8, 6.2, 0.12, 1.6, 0.01, { color: [0.74, 0.74, 0.72], skip: 'ny' });
    B.frame(0, 0, 0, 0);
    const sEntry = RN.byId.get(id) ? (() => { let best = null; for (const g of n.PL.segs) { const t = clamp((ex0 - g.a[0]) * g.d[0] + (ez0 - g.a[1]) * g.d[1], 0, g.L), d = Math.hypot(ex0 - g.a[0] - g.d[0] * t, ez0 - g.a[1] - g.d[1] * t); if (!best || d < best.d) best = { d, s: g.s0 + t, side: Math.sign((ex0 - g.a[0]) * -g.d[1] + (ez0 - g.a[1]) * g.d[0]) }; } return best; })() : null;
    if (sEntry) RN.cuts.push({ id, side: sEntry.side, s0: sEntry.s - 3.2, s1: sEntry.s + 3.2 });
    for (const e of [-1, 1]) { const px = cx + lx * e * (D / 2 + 0.8) + fx * (len / 2 - 2), pz = cz + lz * e * (D / 2 + 0.8) + fz * (len / 2 - 2); streetLamp(px, pz, yaw + Math.PI + e * 0.4); }
    occRect(cx, cz, D / 2 + 0.3, len / 2 + 0.3, yaw, 1, 4);
    pave(cx - len, cz - len, cx + len, cz + len, (px, pz) => inRect(px, pz, cx, cz, yaw, D / 2 + 0.3, len / 2 + 0.3) || inRect(px, pz, ex0 - fx * 0.3, ez0 - fz * 0.3, yaw, 3.3, 1.4) ? 1 : 0);
    // hedge along the court's long sides, a walkway from its far end
    for (const e of [-1, 1]) { const a = [cx + lx * e * (D / 2 + 1.2) - fx * (len / 2 - 1), cz + lz * e * (D / 2 + 1.2) - fz * (len / 2 - 1)], b = [cx + lx * e * (D / 2 + 1.2) + fx * (len / 2 - 1), cz + lz * e * (D / 2 + 1.2) + fz * (len / 2 - 1)];
      if (clear((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0.8)) { out.hedges.push({ a, b, h: 1.0 }); navRect((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0.45, Math.hypot(b[0] - a[0], b[1] - a[1]) / 2, Math.atan2(b[0] - a[0], b[1] - a[1]), 2); } }
    out.carSpots.push(...spots);
    out.parkings = (out.parkings || []).concat([{ cx, cz, yaw, len, D }]);
  }

  // ---- parking under the pilotis of the mid-rises: bays under the open ground floor, reached by a driveway from the
  // nearest street in front of the building, the kerb lowered where it crosses the footway
  for (const b of blds) if (b.pilotis && b.corridor) {
    const { x0, x1 } = b.pilotis, d = b.corridor.d, c = Math.cos(b.r), sn = Math.sin(b.r), Wd = (lx, lz) => [b.x + lx * c + lz * sn, b.z - lx * sn + lz * c];
    const mx = (x0 + x1) / 2, front = Wd(mx, d / 2), fdir = [sn, c];                         // the building's front and its facing
    // the street: the nearest footway-edged road straight out in front
    let best = null; for (const id of ['DS', 'DA', 'DU', 'DL', 'DN']) { const n = RN.byId.get(id); for (const g of n.PL.segs) { const t = clamp((front[0] - g.a[0]) * g.d[0] + (front[1] - g.a[1]) * g.d[1], 0, g.L), qx = g.a[0] + g.d[0] * t, qz = g.a[1] + g.d[1] * t, dd = Math.hypot(front[0] - qx, front[1] - qz);
      if ((qx - front[0]) * fdir[0] + (qz - front[1]) * fdir[1] < dd * 0.9) continue; if (!best || dd < best.dd) best = { dd, id, n, s: g.s0 + t, side: Math.sign((front[0] - g.a[0]) * -g.d[1] + (front[1] - g.a[1]) * g.d[0]) }; } }
    if (!best || best.dd > 40) continue;
    const L = best.dd - best.n.hw - (best.n.walk || 2), y = b.y, nb = Math.floor((x1 - x0 - 0.6) / 2.5);
    const [ox, oz] = Wd(mx, d / 2); B.frame(ox, y, oz, b.r);
    // the drive: asphalt from the footway's back to the building line, kerbed along both sides; bays under the slab
    B.bbox('asphalt', 0, -0.08, L / 2, 5.4, 0.12, L + 0.2, 0.01, { color: [1, 1, 1], skip: 'ny', uv: 4 });
    for (const e of [-1, 1]) B.bbox('concrete', e * 2.78, -0.08, L / 2, 0.16, 0.24, L, 0.015, { color: [0.78, 0.78, 0.75] });
    B.bbox('asphalt', 0, -0.08, -d / 2 + 0.3, x1 - x0 - 0.3, 0.12, d - 0.6, 0.01, { color: [1, 1, 1], skip: 'ny', uv: 4 });
    for (let i = 0; i < nb; i++) { const bx = -(nb * 2.5) / 2 + (i + 0.5) * 2.5;
      for (const sg of [-1, 1]) B.box('paint', bx + sg * 1.25, 0.045, -2.6, 0.1, 0.004, 5.0, { color: [0.94, 0.94, 0.92] });
      B.bbox('concrete', bx, 0.04, -4.45, 1.6, 0.1, 0.14, 0.02, { color: [0.8, 0.8, 0.78] });
      if (rng() < 0.85) out.carSpots.push({ p: B.P([bx, 0.04, -2.6]), r: b.r + Math.PI, y: y + 0.05, stop: 1.78 }); }
    B.frame(0, 0, 0, 0);
    RN.cuts.push({ id: best.id, side: best.side, s0: best.s - 3.0, s1: best.s + 3.0 });
    const mid = Wd(mx, d / 2 + L / 2); occRect(mid[0], mid[1], 2.9, L / 2 + 0.2, b.r, 1, 4);
    pave(mid[0] - L, mid[1] - L, mid[0] + L, mid[1] + L, (px, pz) => inRect(px, pz, mid[0], mid[1], b.r, 2.9, L / 2 + 0.3) ? 1 : 0);
  }

  for (const [bx0, bz0, id, dep] of ROAD_BAYS) {
    const b = blds.find(q => Math.hypot(q.x0 - bx0, q.z0 - bz0) < 1); if (!b) continue;
    const n = RN.byId.get(id); let best = null;
    for (const g of n.PL.segs) { const t = clamp((b.x - g.a[0]) * g.d[0] + (b.z - g.a[1]) * g.d[1], 0, g.L), qx = g.a[0] + g.d[0] * t, qz = g.a[1] + g.d[1] * t, dd = Math.hypot(b.x - qx, b.z - qz);
      if (!best || dd < best.dd) best = { dd, s: g.s0 + t, q: [qx, qz], d: g.d, side: Math.sign((b.x - g.a[0]) * -g.d[1] + (b.z - g.a[1]) * g.d[0]) }; }
    const l = [-best.d[1] * best.side, best.d[0] * best.side], off = n.hw + (n.walk || 2);
    // the gap goes where the entrance path will cross: the gallery entrance's line out to the road
    const ge = (b.entrances || []).find(e => e.kind === 'gallery'); if (ge) { const dn = ge.out[0] * -l[0] + ge.out[1] * -l[1];
      if (dn > 0.3) { const t = ((best.q[0] + l[0] * off - ge.p[0]) * -l[0] + (best.q[1] + l[1] * off - ge.p[2]) * -l[1]) / dn, hx = ge.p[0] + ge.out[0] * t, hz = ge.p[2] + ge.out[1] * t;
        const ds = (hx - best.q[0]) * best.d[0] + (hz - best.q[1]) * best.d[1]; best.s += ds; best.q = [best.q[0] + best.d[0] * ds, best.q[1] + best.d[1] * ds]; } }
    const ex0 = best.q[0] + l[0] * off, ez0 = best.q[1] + l[1] * off, yaw = Math.atan2(l[0], l[1]);
    const y = gy(ex0 + l[0] * dep / 2, ez0 + l[1] * dep / 2) + 0.02, per = 3, gap = 3.6;
    B.frame(ex0, y, ez0, yaw);
    for (const e of [-1, 1]) { const xc = e * (gap / 2 + per * 1.25);
      B.bbox('asphalt', xc, -0.08, dep / 2, per * 2.5, 0.12, dep, 0.01, { color: [1, 1, 1], skip: 'ny', uv: 4 });
      B.bbox('concrete', xc, -0.08, dep + 0.08, per * 2.5 + 0.16, 0.22, 0.16, 0.015, { color: [0.78, 0.78, 0.75] });
      B.bbox('concrete', e * (gap / 2 + per * 2.5 + 0.08), -0.08, dep / 2, 0.16, 0.22, dep + 0.3, 0.015, { color: [0.78, 0.78, 0.75] });
      for (let i = 0; i < per; i++) { const bx = e * (gap / 2 + (i + 0.5) * 2.5);
        for (const sg of [-1, 1]) B.box('paint', bx + sg * 1.25, 0.045, dep / 2 + 0.2, 0.1, 0.004, dep - 0.6, { color: [0.94, 0.94, 0.92] });
        B.bbox('concrete', bx, 0.04, dep - 0.65, 1.6, 0.1, 0.14, 0.02, { color: [0.8, 0.8, 0.78] });
        if (rng() < 0.7) out.carSpots.push({ p: B.P([bx, 0.04, dep / 2]), r: yaw, y: y + 0.05, stop: dep / 2 - 0.72 }); } }
    B.frame(0, 0, 0, 0);
    for (const e of [-1, 1]) { const xc = e * (gap / 2 + per * 1.25), cxw = ex0 + Math.cos(yaw) * xc + l[0] * dep / 2, czw = ez0 - Math.sin(yaw) * xc + l[1] * dep / 2;
      occRect(cxw, czw, per * 1.25 + 0.2, dep / 2 + 0.2, yaw, 1, 4); pave(cxw - 10, czw - 10, cxw + 10, czw + 10, (px, pz) => inRect(px, pz, cxw, czw, yaw, per * 1.25 + 0.3, dep / 2 + 0.3) ? 1 : 0);
      RN.cuts.push({ id, side: best.side, s0: best.s + e * gap / 2 - (e > 0 ? 0 : per * 2.5), s1: best.s + e * gap / 2 + (e > 0 ? per * 2.5 : 0) }); }
  }

  function bikeShelter(x, z, yaw, n) { const y = gy(x, z); B.frame(x, y, z, yaw); const L = n * 0.8 + 0.6;
    B.box('concrete', 0, -0.05, 0, L, 0.08, 2.4, { color: [0.72, 0.72, 0.7] });
    for (const e of [-1, 1]) for (const zz of [-0.95]) B.cyl('steel', e * (L / 2 - 0.2), 0, zz, 0.045, 0.045, 2.2, 8, { color: [0.62, 0.64, 0.66] });
    B.beam('steel', [-L / 2, 2.25, -1.0], [L / 2, 2.25, -1.0], 0.08, 0.1, { color: [0.62, 0.64, 0.66] });
    B.poly('roofMetal', [[-L / 2 - 0.1, 2.3, -1.2], [L / 2 + 0.1, 2.3, -1.2], [L / 2 + 0.1, 2.1, 1.3], [-L / 2 - 0.1, 2.1, 1.3]], [0, 1, 0.1], { color: [0.44, 0.58, 0.62] });
    B.poly('roofMetal', [[L / 2 + 0.1, 2.28, -1.2], [-L / 2 - 0.1, 2.28, -1.2], [-L / 2 - 0.1, 2.08, 1.3], [L / 2 + 0.1, 2.08, 1.3]], [0, -1, -0.1], { color: [0.4, 0.5, 0.54] });
    B.frame(0, 0, 0, 0);
    for (let i = 0; i < n; i++) if (rng() < 0.8) { const p = [x + Math.cos(yaw) * (-L / 2 + 0.7 + i * 0.8), z - Math.sin(yaw) * (-L / 2 + 0.7 + i * 0.8)]; out.bikes.push({ x: p[0], y, z: p[1], r: yaw + Math.PI / 2 + (rng() - 0.5) * 0.1 }); }
    addBox(x, z, L / 2, 1.2, yaw, y - 1, y + 2.3); occRect(x, z, L / 2 + 0.3, 1.4, yaw, 1);
    pave(x - L, z - L, x + L, z + L, (px, pz) => inRect(px, pz, x, z, yaw, L / 2 + 0.1, 1.3) ? 1 : 0);
  }

  // ---- courtyards, each of its own kind
  // street furniture keeps off the walking surface: a bench whose footprint (with 0.35 m to spare) touches a path,
  // plaza, apron or footway backs away from it — along its own depth, away from the side it faces — until clear
  const paved = (x, z) => { const k = covI(x, z); return (k >= 0 && (COV[k] >= 0 || COV2[k] >= 0)) || RN.walkY(x, z) !== null || !!RN.roadAt(x, z); };
  const wet = (x, z) => lakeDepth(x, z) > 0.03;                                                                       // in the lake's basin
  // on a walking route: a path, an entrance apron or a footway (plazas and squares may carry benches and lamps)
  const onWalk = (x, z) => { if (RN.walkY(x, z) !== null || RN.roadAt(x, z)) return true; const k = covI(x, z); if (k < 0) return false;
    for (const id of [COV[k], COV2[k]]) if (id >= 0 && id < 32000 && regions[id] && (regions[id].kind === 'path' || regions[id].kind === 'apron')) return true; return false; };
  const benchClear = (x, z, yaw) => { const c = Math.cos(yaw), s = Math.sin(yaw); for (let u = -1.25; u <= 1.25; u += 0.4) for (const v of [-0.65, -0.3, 0, 0.3, 0.65]) { const px = x + u * c + v * s, pz = z - u * s + v * c; if (onWalk(px, pz) || wet(px, pz)) return false; } return true; };
  const offPaving = (x, z, yaw) => { const bx = -Math.sin(yaw), bz = -Math.cos(yaw);
    for (let t = 0; t <= 3.0; t += 0.25) for (const sg of t ? [1, -1] : [1]) { const px = x + bx * t * sg, pz = z + bz * t * sg; if (benchClear(px, pz, yaw)) return [px, pz]; } return null; };
  const benchAt = (x, z, yaw) => { const q = offPaving(x, z, yaw); if (!q || !clear(q[0], q[1], 0.4)) return false; ctx.bench(ctx.LB, q[0], gy(q[0], q[1]), q[1], yaw); occRect(q[0], q[1], 1.0, 0.6, yaw, 1); navRect(q[0], q[1], 1.0, 0.45, yaw, 2); return q; };
  // the nearest spot to (x, z) where a small fixture of radius r stands off every walking surface and out of the water
  // (lamps, bins, bollards, tables, taps): searched outward in rings, null when there is none within 3 m
  const freeSpot = (x, z, r) => { const ok = (px, pz) => { for (let a = 0; a < 6.28; a += 0.785) { const qx = px + Math.cos(a) * r, qz = pz + Math.sin(a) * r; if (onWalk(qx, qz) || wet(qx, qz)) return false; } return !onWalk(px, pz) && !wet(px, pz); };
    if (ok(x, z)) return [x, z]; for (let d = 0.25; d <= 3; d += 0.25) for (let a = 0; a < 6.28; a += 0.5 / d) { const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d; if (ok(px, pz)) return [px, pz]; } return null; };
  const tree = (kind, x, z, scale = 1, inPlanter = false) => { if (inPlanter) { out.trees.push({ kind, x, z, scale, planter: true }); navRect(x, z, 0.6, 0.6, 0, 2); return; } if (clear(x, z, 1.2) && !wet(x, z) && !wet(x + 1.5, z) && !wet(x - 1.5, z) && !wet(x, z + 1.5) && !wet(x, z - 1.5) && !paved(x, z) && !paved(x + 0.6, z) && !paved(x - 0.6, z) && !paved(x, z + 0.6) && !paved(x, z - 0.6)) { out.trees.push({ kind, x, z, scale }); navRect(x, z, 0.6, 0.6, 0, 2); } };
  const plaza = (x0, z0, x1, z1, color = [0.82, 0.8, 0.76]) => { B.frame(0, 0, 0, 0);
    for (let x = x0; x < x1 - 1e-3; x += 4) for (let z = z0; z < z1 - 1e-3; z += 4) { const xa = x, xb = Math.min(x1, x + 4), za = z, zb = Math.min(z1, z + 4), q = (px, pz) => [px, gy(px, pz) + 0.05, pz];
      B.poly('pavement', [q(xa, za), q(xb, za), q(xb, zb), q(xa, zb)], [0, 1, 0], { color, uvs: [[xa / 1.2, za / 1.2], [xb / 1.2, za / 1.2], [xb / 1.2, zb / 1.2], [xa / 1.2, zb / 1.2]], attr: { aPave: [[xa, za - z0 + 0.5], [xb, za - z0 + 0.5], [xb, zb - z0 + 0.5], [xa, zb - z0 + 0.5]] } }); }
    pave(x0 - 1, z0 - 1, x1 + 1, z1 + 1, (px, pz) => px > x0 - 0.15 && px < x1 + 0.15 && pz > z0 - 0.15 && pz < z1 + 0.15 ? 1 : 0);
    const rid = regions.length; regions.push({ kind: 'plaza', pts: [[(x0 + x1) / 2, (z0 + z1) / 2]], connected: false }); coverRect(x0, z0, x1, z1, rid);
    occRect((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (z1 - z0) / 2, 0, 1, 1, rid); };
  // C1 south-west: a lawn court under a group of big zelkovas, a curving path between the two slabs, a wisteria pergola
  { const pts = []; for (let k = 0; k <= 8; k++) { const t = k / 8; pts.push([lerp(366, 410, t), lerp(96, 114, t) + Math.sin(t * Math.PI * 2) * 3.5]); } pathLine(pts, 2.0);
    for (const [x, z, s] of [[375, 106, 1.0], [392, 99, 0.9], [404, 110, 0.85], [383, 113, 0.75]]) tree('zelkova', x, z, s);
    pergola(396, 104, 0.12, 5.4, 3.0); benchAt(371, 101, Math.PI * 0.5); benchAt(398, 108.5, Math.PI); benchAt(407, 102, -Math.PI / 2); }
  // C2, C3, C6: the playground, the fountain park and the lake park are designed spaces of their own (danchipark.js)
  buildParks({ B, gy, rng, out, pathLine, pave, paint, occRect, navRect, tree, benchAt, addBox, addCircle, pergola, toilet, sandPit, springRider, coverRect, coverDisc, paved, freeSpot, sd: danchiSD,
    nearRoad: (x, z, r) => { for (let a = 0; a < 6.28; a += 0.8) if (RN.roadAt(x + Math.cos(a) * r, z + Math.sin(a) * r) || RN.walkY(x + Math.cos(a) * r, z + Math.sin(a) * r) !== null) return true; return false; } });
  // C4 north-west: a shaded bosque of trees on gravel between the tower and the slab, benches under it; a bamboo grove
  // closes the court to the north against the hill foot
  { const x0 = 440, z0 = 238; paint(0, x0 - 2, z0 - 2, x0 + 22, z0 + 24, () => 1); paint(2, x0 - 2, z0 - 2, x0 + 22, z0 + 24, () => 0.7);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) tree(j % 2 ? 'oak' : 'zelkova', x0 + i * 6 + (rng() - 0.5), z0 + j * 6.5 + (rng() - 0.5), 0.6);
    for (const [x, z, r] of [[443, 244, 0], [455, 250, Math.PI], [449, 258, Math.PI / 2]]) benchAt(x, z, r);
    out.groves.push({ x: 443, z: 302, R: 7 }); }
  // C5 north-east: a hill-view garden on the strip between the north-east parking court and the loop road's north
  // arc — a path from the avenue's footway to the loop road's, a wisteria pergola with benches looking out to the hill,
  // maples and low planting
  { pathLine([[499.6, 277], [507, 280.5], [516, 279.5], [525, 276], [536.2, 271.4]], 1.8);
    pergola(510.5, 285.2, 0.496, 4.8, 2.8); for (const dx of [-1.1, 1.1]) benchAt(510.5 + Math.cos(0.496) * dx - Math.sin(0.496) * 0.2, 285.2 - Math.sin(0.496) * dx - Math.cos(0.496) * 0.2, 0.496);
    for (const [x, z, s] of [[503, 281.8, 0.6], [518, 283.4, 0.65]]) tree('maple', x, z, s);
    for (let k = 0; k < 9; k++) { const x = 504 + k * 2.6 + (rng() - 0.5), z = 281.4 + k * -0.35 + 1.2 + rng() * 0.6; out.bushes.push({ x, y: gy(x, z) - 0.05, z, s: 0.5 + rng() * 0.2, sx: 1.2, r: rng() * 6, c: new THREE.Color().setHSL(0.24 + rng() * 0.08, 0.5, 0.3 + rng() * 0.08) }); } }
  // C9 green belt west: the court between the corner block and the walk-up, laid out from where they actually stand —
  // a walk in from the south street through the gap between the walk-up's gardens and the corner block's west wing, a
  // ring of cherries round a lawn with benches under them, a toddlers' corner by the walk-up's gardens
  { const K9 = blds.find(b => b.fam === 'K'), S9 = blds.find(b => b.fam === 'S' && b.x0 === 365);
    if (K9 && S9) {
      const sFront = S9.x + 4.8 + 2.6, kWest = K9.x - 6 - (K9.wa || 22) - 2.6, gapX = (sFront + kWest) / 2, aprA = K9.entrances.find(e => e.out[1] < -0.5);
      const zTurn = aprA ? aprA.p[2] + 1.2 : K9.z - 14, cx9 = (sFront + K9.x - 10) / 2, cz9 = (S9.z - 12 + zTurn) / 2;
      if (kWest - sFront > 2.8) pathLine([[gapX, 51.6], [gapX, zTurn], [aprA ? aprA.p[0] - 2.0 : cx9, zTurn]], 2.0);
      for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2 + 0.3; tree('sakura', cx9 + Math.cos(a) * 6.5, cz9 + Math.sin(a) * 5.0, 0.72); }
      for (const [dx, dz, r] of [[-3.2, 1.2, Math.PI * 0.6], [3.2, -2.2, -Math.PI * 0.4]]) benchAt(cx9 + dx, cz9 + dz, r);
      for (const [dx, dz, c] of [[0, -1.5, [0.95, 0.72, 0.2]], [1.9, -2.3, [0.3, 0.62, 0.86]], [0.3, -3.2, [0.9, 0.36, 0.3]]]) springRider(sFront + 2.5 + dx, S9.z - 6 + dz, c);
      benchAt(sFront + 1.4, S9.z - 3.5, Math.PI / 2);
      for (const [x, z] of [[cx9 - 5, cz9 + 7], [cx9 + 6, cz9 - 6], [cx9 - 7, cz9 - 2]]) for (let q = 0; q < 4; q++) out.bushes.push({ x: x + (rng() - 0.5) * 2, y: gy(x, z) - 0.05, z: z + (rng() - 0.5) * 2, s: 0.55 + rng() * 0.25, sx: 1, r: rng() * 6, c: new THREE.Color().setHSL(0.93 + rng() * 0.05, 0.6, 0.66) }); } }
  // C7 the football ground (多目的グラウンド): a 63 × 42 m pitch of mown turf striped by the mower, worn in the goalmouths,
  // at the centre spot and at the gates; full markings; youth goals with nets; ball-stop nets behind the goals; a
  // chain-link fence with a pedestrian gate onto the south street's path and a maintenance gate onto the loop road; team
  // shelters, a drainage channel round the pitch, the floodlights, a shed, spectators' benches along the path outside
  { const x0 = 530, x1 = 604, z0 = -10, z1 = 44, PX0 = 535.5, PX1 = 598.5, PZ0 = -4, PZ1 = 38, cx = (PX0 + PX1) / 2, cz = (PZ0 + PZ1) / 2, LW = 0.1;
    const GX = 556, GZ = z1, EZ = 26;                                                                                // gates: north (pedestrians), east (vehicles)
    const TY = x => 0.012, ty = (x, z) => gy(x, z) + TY();
    occRect((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2 + 0.5, (z1 - z0) / 2 + 0.5, 0, 1);
    // short mown blades stand up through the turf over the field of play (the lawn mask is mown short here); no grass
    // on the markings' side of the run-off where the shelters, benches and gate aprons stand
    pave(x0, z0, x1, z1, (x, z) => x > x0 + 0.2 && x < x1 - 0.2 && z > z0 + 0.2 && z < z1 - 0.2 && !(x > PX0 - 0.8 && x < PX1 + 0.8 && z > PZ0 - 0.8 && z < PZ1 + 0.8) ? 1 : 0);
    turfU.uTurf0.value.set(PX0 - 0.8, PZ0 - 0.8, PX1 + 0.8, PZ1 + 0.8); turfU.uTurfStripe.value.set(1, PX0, 63 / 12, 0);
    // turf: 1 m cells, mowing stripes across the pitch (alternating 5.25 m bands), the run-off plainer; wear where the
    // game and the people concentrate
    const wear = (x, z) => { let w = 0;
      for (const gx of [PX0, PX1]) { const d = Math.hypot((x - gx) * 1.3, z - cz); w = Math.max(w, 0.75 * Math.max(0, 1 - d / 7)); }
      w = Math.max(w, 0.35 * Math.max(0, 1 - Math.hypot(x - cx, z - cz) / 3));
      w = Math.max(w, 0.8 * Math.max(0, 1 - Math.hypot(x - GX, z - GZ) / 5), 0.6 * Math.max(0, 1 - Math.hypot(x - x1, z - EZ) / 5));
      for (const sx of [PX0 + 16, PX1 - 16]) w = Math.max(w, 0.3 * Math.max(0, 1 - Math.hypot(x - sx, z - (PZ1 + 3)) / 4));  // at the shelters
      return w * (0.75 + 0.25 * Math.sin(x * 1.7 + z * 2.3)); };
    const tcol = (x, z) => { const on = x > PX0 && x < PX1 && z > PZ0 && z < PZ1, band = Math.floor((x - PX0) / (63 / 12)) % 2;
      const g = on ? (band ? [0.9, 0.97, 0.88] : [1.06, 1.08, 1.0]) : [0.98, 1.02, 0.92], w = wear(x, z);
      return [lerp(g[0], 1.55, w), lerp(g[1], 1.25, w), lerp(g[2], 0.95, w)]; };
    B.frame(0, 0, 0, 0);
    for (let x = x0 + 0.2; x < x1 - 0.2; x += 1) for (let z = z0 + 0.2; z < z1 - 0.2; z += 1) { const xb = Math.min(x1 - 0.2, x + 1), zb = Math.min(z1 - 0.2, z + 1);
      const p4 = [[x, ty(x, z), z], [xb, ty(xb, z), z], [xb, ty(xb, zb), zb], [x, ty(x, zb), zb]];
      B.poly('turf', p4, [0, 1, 0], { colors: undefined, color: tcol(x + 0.5, z + 0.5), uvs: p4.map(v => [v[0] / 1.6, v[2] / 1.6]) }); }
    // markings: 10 cm lines laid on the turf
    const LC = [0.97, 0.97, 0.95], line = (ax, az, bx, bz) => { const L = Math.hypot(bx - ax, bz - az), mx = (ax + bx) / 2, mz = (az + bz) / 2; B.frame(mx, ty(mx, mz) + 0.004, mz, Math.atan2(bx - ax, bz - az)); B.box('paint', 0, 0, 0, LW, 0.004, L + LW, { color: LC }); B.frame(0, 0, 0, 0); };
    const arcL = (ox, oz, r, a0, a1, n = 24) => { for (let k = 0; k < n; k++) { const t0 = lerp(a0, a1, k / n), t1 = lerp(a0, a1, (k + 1) / n); line(ox + Math.cos(t0) * r, oz + Math.sin(t0) * r, ox + Math.cos(t1) * r, oz + Math.sin(t1) * r); } };
    const spot = (x, z, r = 0.12) => { B.frame(x, ty(x, z) + 0.004, z, 0); B.cyl('paint', 0, 0, 0, r, r, 0.004, 12, { color: LC, cap: true }); B.frame(0, 0, 0, 0); };
    line(PX0, PZ0, PX1, PZ0); line(PX0, PZ1, PX1, PZ1); line(PX0, PZ0, PX0, PZ1); line(PX1, PZ0, PX1, PZ1); line(cx, PZ0, cx, PZ1);
    arcL(cx, cz, 5.6, 0, Math.PI * 2, 48); spot(cx, cz, 0.15);
    for (const [gx, s] of [[PX0, 1], [PX1, -1]]) {
      const pa = 10.0, pw = 12.5, ga = 3.4, gw = 5.6, ps = gx + s * 6.7;
      line(gx, cz - pw, gx + s * pa, cz - pw); line(gx, cz + pw, gx + s * pa, cz + pw); line(gx + s * pa, cz - pw, gx + s * pa, cz + pw);
      line(gx, cz - gw, gx + s * ga, cz - gw); line(gx, cz + gw, gx + s * ga, cz + gw); line(gx + s * ga, cz - gw, gx + s * ga, cz + gw);
      spot(ps, cz); const aa = Math.acos((pa - 6.7) / 5.6); arcL(ps, cz, 5.6, s > 0 ? -aa : Math.PI - aa, s > 0 ? aa : Math.PI + aa, 14);
      for (const cz2 of [PZ0, PZ1]) { const a0 = s > 0 ? (cz2 === PZ0 ? 0 : -Math.PI / 2) : (cz2 === PZ0 ? Math.PI / 2 : Math.PI); arcL(gx, cz2, 1.0, a0, a0 + Math.PI / 2, 6);
        B.frame(gx, ty(gx, cz2), cz2, 0); B.cyl('plastic', 0, 0, 0, 0.02, 0.02, 1.5, 6, { color: [0.95, 0.95, 0.95] }); B.poly('plastic', [[0, 1.5, 0], [0, 1.2, 0], [s * 0.4, 1.35, 0.01]], [0, 0, 1], { color: [0.95, 0.75, 0.1] }); B.poly('plastic', [[0, 1.2, 0], [0, 1.5, 0], [s * 0.4, 1.35, 0.01]], [0, 0, -1], { color: [0.95, 0.75, 0.1] }); B.frame(0, 0, 0, 0); } }
    // goals: 5 × 2 m white frames on the goal lines, a back frame 1.4 m deep, nets on the back, sides and roof
    for (const [gx, s] of [[PX0, -1], [PX1, 1]]) { const y = gy(gx, cz) + 0.02, W = 5, H = 2, D = 1.4, dH = 1.0, WC = [0.96, 0.96, 0.95];
      B.frame(gx, y, cz, 0);
      for (const e of [-1, 1]) { B.bbox('steel', 0, 0, e * W / 2, 0.1, H, 0.1, 0.02, { color: WC }); B.beam('steel', [s * D, 0, e * W / 2], [s * D, dH, e * W / 2], 0.05, 0.05, { color: WC });
        B.beam('steel', [0, H - 0.02, e * W / 2], [s * D, dH, e * W / 2], 0.05, 0.05, { color: WC }); B.beam('steel', [0, 0.02, e * W / 2], [s * D, 0.02, e * W / 2], 0.05, 0.05, { color: WC }); }
      B.bbox('steel', 0, H, 0, 0.1, 0.1, W + 0.1, 0.02, { color: WC }); B.beam('steel', [s * D, 0.02, -W / 2], [s * D, 0.02, W / 2], 0.05, 0.05, { color: WC }); B.beam('steel', [s * D, dH, -W / 2], [s * D, dH, W / 2], 0.04, 0.04, { color: WC });
      const net = (a, b, c, d, u, v) => B.quad('net', a, b, c, d, { uvs: [[0, 0], [u, 0], [u, v], [0, v]] });
      net([s * D, 0, W / 2], [s * D, 0, -W / 2], [s * D, dH, -W / 2], [s * D, dH, W / 2], W / 0.12, dH / 0.12);
      net([0, H, -W / 2], [0, H, W / 2], [s * D, dH, W / 2], [s * D, dH, -W / 2], W / 0.12, Math.hypot(D, H - dH) / 0.12);
      for (const e of [-1, 1]) { B.poly('net', [[0, 0, e * W / 2], [s * D, 0, e * W / 2], [s * D, dH, e * W / 2], [0, H, e * W / 2]], [0, 0, e], { uvs: [[0, 0], [D / 0.12, 0], [D / 0.12, dH / 0.12], [0, H / 0.12]] }); }
      B.frame(0, 0, 0, 0); for (const e of [-1, 1]) addCircle(gx, cz + e * W / 2, 0.08); addBox(gx + s * D, cz, 0.05, W / 2, 0, y - 1, y + dH);
      // ball-stop net on tall posts behind the goal, in front of the fence
      const bx = s < 0 ? x0 + 0.6 : x1 - 0.6; B.frame(bx, gy(bx, cz), cz, 0);
      for (let k = -2; k <= 2; k++) B.cyl('steel', 0, 0, k * 6, 0.07, 0.06, 6, 10, { color: [0.3, 0.46, 0.38] });
      B.beam('steel', [0, 5.95, -12], [0, 5.95, 12], 0.05, 0.05, { color: [0.3, 0.46, 0.38] });
      B.quad('net', [0, 2.3, 12], [0, 2.3, -12], [0, 5.9, -12], [0, 5.9, 12], { uvs: [[0, 0], [24 / 0.12, 0], [24 / 0.12, 3.6 / 0.12], [0, 3.6 / 0.12]] });
      B.frame(0, 0, 0, 0); }
    // the fence: galvanised posts every 3 m painted green, chain link, top rail, a kick board; gaps at the gates
    const GC = [0.3, 0.46, 0.38], gap = (x, z) => (Math.abs(z - z1) < 0.3 && Math.abs(x - GX) < 1.3) || (Math.abs(x - x1) < 0.3 && Math.abs(z - EZ) < 2.2);
    for (const [ax, az, bx, bz] of [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]]) { const L = Math.hypot(bx - ax, bz - az), n = Math.ceil(L / 3);
      for (let k = 0; k <= n; k++) { const t = k / n, x = lerp(ax, bx, t), z = lerp(az, bz, t); if (gap(x, z)) continue; B.cyl('steel', x, gy(x, z) - 0.1, z, 0.045, 0.045, 2.55, 8, { color: GC }); }
      const m = Math.ceil(L / 1.5); for (let k = 0; k < m; k++) { const t0 = k / m, t1 = (k + 1) / m, xa = lerp(ax, bx, t0), za = lerp(az, bz, t0), xb = lerp(ax, bx, t1), zb = lerp(az, bz, t1);
        if (gap((xa + xb) / 2, (za + zb) / 2)) continue; const ya = gy(xa, za), yb = gy(xb, zb);
        B.beam('chain', [xa, ya + 0.25, za], [xb, yb + 0.25, zb], 0.02, 2.1, { color: GC }); B.beam('steel', [xa, ya + 2.4, za], [xb, yb + 2.4, zb], 0.045, 0.045, { color: GC });
        B.beam('concrete', [xa, ya + 0.1, za], [xb, yb + 0.1, zb], 0.12, 0.3, { color: [0.72, 0.72, 0.7] });
        addBox((xa + xb) / 2, (za + zb) / 2, Math.hypot(xb - xa, zb - za) / 2 + 0.05, 0.08, Math.atan2(xb - xa, zb - za) + Math.PI / 2); } }
    // the pedestrian gate: stout posts with caps, a pair of mesh leaves (one standing open), the ground worn to earth
    { const y = gy(GX, GZ); B.frame(GX, y, GZ, 0);
      for (const e of [-1, 1]) { B.bbox('steel', e * 1.25, 0, 0, 0.12, 2.6, 0.12, 0.01, { color: GC }); B.cyl('steel', e * 1.25, 2.6, 0, 0.09, 0.02, 0.1, 8, { color: GC, cap: true }); }
      const leaf = (hx, ang, len) => { B.frame(...B.P([hx, 0, 0]), ang); B.box('steel', len / 2 * Math.sign(-hx), 0.08, 0, len, 0.05, 0.05, { color: GC }); B.box('steel', len / 2 * Math.sign(-hx), 2.0, 0, len, 0.05, 0.05, { color: GC });
        B.box('steel', len * Math.sign(-hx), 0.08, 0, 0.05, 1.97, 0.05, { color: GC }); B.box('chain', len / 2 * Math.sign(-hx), 0.12, 0, len - 0.06, 1.85, 0.015, { color: GC }); B.frame(GX, y, GZ, 0); };
      leaf(-1.2, 0, 1.18); leaf(1.2, -1.2, 1.18);
      B.frame(0, 0, 0, 0);
      const sg = signMesh(1.6, 0.9, (g, W2, H2) => { g.fillStyle = '#f4f2ec'; g.fillRect(0, 0, W2, H2); g.fillStyle = '#2a6a3a'; g.fillRect(0, 0, W2, H2 * 0.34); g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.font = `bold ${H2 * 0.15}px ${JP_FONT}`; g.fillText('桜川ニュータウン 多目的グラウンド', W2 / 2, H2 * 0.17); g.fillStyle = '#222'; g.font = `${H2 * 0.11}px ${JP_FONT}`;
        ['利用時間 9:00〜21:00（予約制）', 'ゴールは使用後元の位置へ', '場内禁煙・ペットの入場禁止'].forEach((t, i) => g.fillText(t, W2 / 2, H2 * (0.48 + i * 0.16))); }, 0.25, 512);
      sg.position.set(GX - 3.4, y + 1.45, GZ + 0.06); scene.add(sg); }
    // the maintenance gate on the loop road: a pair of wide leaves, closed; a driveway across the footway
    { const y = gy(x1, EZ); B.frame(x1, y, EZ, Math.PI / 2);
      for (const e of [-1, 1]) B.bbox('steel', e * 2.15, 0, 0, 0.14, 2.6, 0.14, 0.01, { color: GC });
      for (const e of [-1, 1]) { const c0 = e * 1.05; B.box('steel', c0, 0.1, 0, 2.05, 0.06, 0.06, { color: GC }); B.box('steel', c0, 2.0, 0, 2.05, 0.06, 0.06, { color: GC }); B.box('chain', c0, 0.15, 0, 1.95, 1.82, 0.015, { color: GC }); for (const xx of [e * 0.05, e * 2.05]) B.box('steel', xx, 0.1, 0, 0.06, 1.96, 0.06, { color: GC }); }
      B.frame(0, 0, 0, 0); addBox(x1, EZ, 0.1, 2.2, 0);
      const dU = RN.byId.get('DU'); let best = null; for (const g of dU.PL.segs) { const t = clamp((x1 - g.a[0]) * g.d[0] + (EZ - g.a[1]) * g.d[1], 0, g.L), qx = g.a[0] + g.d[0] * t, qz = g.a[1] + g.d[1] * t, dd = Math.hypot(x1 - qx, EZ - qz); if (!best || dd < best.dd) best = { dd, s: g.s0 + t, side: Math.sign((x1 - g.a[0]) * -g.d[1] + (EZ - g.a[1]) * g.d[0]) }; }
      // the service drive from the footway to the gate: brushed concrete between kerbs, with a grass-block strip down the
      // middle (the way such seldom-used drives are laid), in 1 m slabs draped on the ground
      const xe = x1 + 0.1, xf = 614 - dU.hw - (dU.walk || 2) + 0.3, L = xf - xe; if (L > 0.5) { B.frame(0, 0, 0, 0);
        for (let x = xe; x < xf - 1e-3; x += 1) { const xb = Math.min(xf, x + 1);
          for (const [za, zb, mat, c] of [[EZ - 2.2, EZ - 0.5, 'concrete', [0.8, 0.79, 0.76]], [EZ - 0.5, EZ + 0.5, 'block', [0.62, 0.66, 0.54]], [EZ + 0.5, EZ + 2.2, 'concrete', [0.8, 0.79, 0.76]]])
            B.poly(mat, [[x, gy(x, za) + 0.04, za], [xb, gy(xb, za) + 0.04, za], [xb, gy(xb, zb) + 0.04, zb], [x, gy(x, zb) + 0.04, zb]], [0, 1, 0], { color: c, uv: mat === 'block' ? 0.5 : 1.5 });
          for (const zk of [EZ - 2.28, EZ + 2.28]) B.beam('concrete', [x, gy(x, zk) - 0.02, zk], [xb, gy(xb, zk) - 0.02, zk], 0.14, 0.14, { color: [0.74, 0.74, 0.72] }); }
        pave(xe - 1, EZ - 3, xf + 1, EZ + 3, (x, z) => x > xe - 0.1 && x < xf + 0.2 && Math.abs(z - EZ) < 2.4 ? 1 : 0); occRect((xe + xf) / 2, EZ, 2.4, L / 2 + 0.2, Math.PI / 2, 1, 4); }
      if (best) RN.cuts.push({ id: 'DU', side: best.side, s0: best.s - 2.4, s1: best.s + 2.4 }); }
    // team shelters facing the pitch from the north touchline, a line of benches on the south side
    for (const sx of [cx - 15, cx + 15]) { const x = sx, z = PZ1 + 3.2, y = gy(x, z); B.frame(x, y, z, Math.PI);
      B.bbox('concrete', 0, -0.05, 0, 5.2, 0.12, 1.6, 0.01, { color: [0.7, 0.7, 0.68] });
      B.bbox('wood', 0, 0.42, 0.1, 4.6, 0.06, 0.42, 0.01, { color: [0.3, 0.44, 0.62] }); for (const e of [-2.1, 0, 2.1]) B.box('steel', e, 0, 0.1, 0.06, 0.42, 0.34, { color: [0.6, 0.6, 0.6] });
      B.poly('plastic', [[-2.6, 0.05, -0.7], [2.6, 0.05, -0.7], [2.6, 2.1, -0.7], [-2.6, 2.1, -0.7]], [0, 0, 1], { color: [0.78, 0.84, 0.88] });
      for (const e of [-1, 1]) B.poly('plastic', [[e * 2.6, 0.05, -0.7], [e * 2.6, 0.05, 0.6], [e * 2.6, 1.9, 0.6], [e * 2.6, 2.1, -0.7]], [e, 0, 0], { color: [0.78, 0.84, 0.88] });
      B.poly('roofMetal', [[-2.7, 2.15, -0.8], [2.7, 2.15, -0.8], [2.7, 1.95, 0.8], [-2.7, 1.95, 0.8]], [0, 1, 0.1], { color: [0.3, 0.46, 0.38] });
      for (const e of [-2.55, 2.55]) for (const zz of [-0.65, 0.55]) B.box('steel', e, 0, zz, 0.06, zz < 0 ? 2.12 : 1.93, 0.06, { color: [0.6, 0.6, 0.6] });
      B.frame(0, 0, 0, 0); addBox(x, z - 0.65, 2.6, 0.1, 0, y - 1, y + 2.2); navRect(x, z, 2.8, 1.0, 0, 2); }
    for (let x = cx - 18; x <= cx + 18; x += 6) { const z = PZ0 - 2.4, y = gy(x, z); B.frame(x, y, z, 0); B.bbox('wood', 0, 0.42, 0, 2.0, 0.06, 0.38, 0.01, { color: [0.62, 0.48, 0.32] }); for (const e of [-0.8, 0.8]) B.box('concrete', e, 0, 0, 0.14, 0.42, 0.3, { color: [0.7, 0.7, 0.68] }); B.frame(0, 0, 0, 0); }
    // drainage: a slotted channel round the pitch, a metre outside its lines
    for (const [ax, az, bx, bz] of [[PX0 - 1.2, PZ0 - 1.2, PX1 + 1.2, PZ0 - 1.2], [PX1 + 1.2, PZ0 - 1.2, PX1 + 1.2, PZ1 + 1.2], [PX1 + 1.2, PZ1 + 1.2, PX0 - 1.2, PZ1 + 1.2], [PX0 - 1.2, PZ1 + 1.2, PX0 - 1.2, PZ0 - 1.2]]) {
      const L = Math.hypot(bx - ax, bz - az), n = Math.ceil(L / 2); for (let k = 0; k < n; k++) { const xa = lerp(ax, bx, k / n), za = lerp(az, bz, k / n), xb = lerp(ax, bx, (k + 1) / n), zb = lerp(az, bz, (k + 1) / n);
        B.beam('concrete', [xa, ty(xa, za) + 0.005, za], [xb, ty(xb, zb) + 0.005, zb], 0.3, 0.02, { color: [0.66, 0.66, 0.64] });
        B.beam('dark', [xa, ty(xa, za) + 0.016, za], [xb, ty(xb, zb) + 0.016, zb], 0.06, 0.005, { color: [0.16, 0.16, 0.17] }); } }
    // floodlights at the corners, a shed for the goals and the line marker by the maintenance gate
    for (const [x, z] of [[x0 + 2, z0 + 2], [x1 - 2, z0 + 2], [x1 - 2, z1 - 2], [x0 + 2, z1 - 2]]) { const y = gy(x, z), yaw = Math.atan2(cx - x, cz - z);
      B.frame(x, y, z, yaw); B.bbox('concrete', 0, -0.3, 0, 0.8, 0.5, 0.8, 0.02, { color: [0.7, 0.7, 0.68] }); B.cyl('steel', 0, 0.2, 0, 0.16, 0.1, 14, 10, { color: [0.7, 0.72, 0.74] });
      B.box('steel', 0, 14.1, 0.15, 2.2, 0.1, 0.1, { color: [0.6, 0.62, 0.64] });
      for (const e of [-0.75, 0, 0.75]) { B.bbox('metal', e, 13.9, 0.35, 0.6, 0.5, 0.3, 0.02, { color: [0.4, 0.42, 0.44] }); B.box('lamp', e, 13.94, 0.51, 0.5, 0.42, 0.02); }
      B.frame(0, 0, 0, 0); lampPoints.push({ p: [x, y + 13.5, z], s: 1.4 }); addCircle(x, z, 0.25); }
    { const x = x1 - 4.5, z = EZ + 5.5, y = gy(x, z); B.frame(x, y, z, Math.PI / 2); B.bbox('concrete', 0, -0.2, 0, 3.4, 0.3, 2.6, 0.02, { color: [0.7, 0.7, 0.68] });
      B.bbox('metalWall', 0, 0.1, 0, 3.0, 2.1, 2.2, 0.02, { color: [0.36, 0.5, 0.42] }); B.poly('roofMetal', [[-1.7, 2.3, -1.3], [1.7, 2.3, -1.3], [1.7, 2.1, 1.3], [-1.7, 2.1, 1.3]], [0, 1, 0.1], { color: [0.4, 0.42, 0.44] });
      B.quad('dark', [-0.8, 0.1, 1.105], [0.8, 0.1, 1.105], [0.8, 1.95, 1.105], [-0.8, 1.95, 1.105], { color: [0.2, 0.24, 0.22] }); B.frame(0, 0, 0, 0); addBox(x, z, 1.1, 1.5, Math.PI / 2); navRect(x, z, 1.8, 2.0, 0, 2); }
    // outside: the path from the gate to the south street, the lake park's path along the fence to it, benches beside it
    pathLine([[GX, GZ - 1.5], [GX, 51.7]], 3.0, { lamps: false, link: true });
    pathLine([[545.2, 46.4], [GX + 0.8, 46.4]], 2.4, { lamps: true, link: true, mat: 'gravelPath', color: [0.9, 0.84, 0.74] });
    for (const x of [563, 571, 579, 587]) benchAt(x, 48.2, Math.PI);
    paint(0, GX - 5, GZ - 5, GX + 5, GZ + 5, (x, z) => Math.max(0, 0.7 - Math.hypot(x - GX, z - GZ) / 6)); }
  // C8 the centre plaza between the avenue and the shops: pavers, trees in planters, a clock, benches, bike racks
  { plaza(442, 142, 457.5, 192, [0.84, 0.8, 0.74]);
    for (const [x, z] of [[447, 150], [447, 166], [447, 182]]) { tree('zelkova', x, z, 0.6, true); const y = gy(x, z) + 0.05; B.frame(x, y, z, 0); B.bbox('concrete', 0, 0, 0, 2.2, 0.5, 2.2, 0.03, { color: [0.76, 0.75, 0.72] }); B.box('plain', 0, 0.46, 0, 1.9, 0.04, 1.9, { color: [0.3, 0.24, 0.18] }); B.frame(0, 0, 0, 0); addBox(x, z, 1.1, 1.1, 0, y - 1, y + 0.55); navRect(x, z, 1.2, 1.2, 0, 2); }
    const cy = gy(452, 158); B.frame(452, cy + 0.05, 158, 0); B.cyl('steel', 0, 0, 0, 0.09, 0.07, 3.6, 12, { color: [0.24, 0.3, 0.28] }); B.cyl('metal', 0, 3.6, 0, 0.42, 0.42, 0.18, 20, { color: [0.24, 0.3, 0.28], cap: true }); B.frame(0, 0, 0, 0);
    for (const face of [0, Math.PI]) { const m = signMesh(0.76, 0.76, (g, W2, H2) => { g.fillStyle = '#f4f2ea'; g.beginPath(); g.arc(W2 / 2, H2 / 2, W2 * 0.48, 0, 7); g.fill(); g.strokeStyle = '#222'; g.lineWidth = 4; g.stroke(); g.lineWidth = 6; g.beginPath(); g.moveTo(W2 / 2, H2 / 2); g.lineTo(W2 / 2, H2 * 0.2); g.moveTo(W2 / 2, H2 / 2); g.lineTo(W2 * 0.72, H2 * 0.56); g.stroke(); }, 0.2, 128);
      m.position.set(452 + Math.sin(face) * 0.1, cy + 3.69, 158 + Math.cos(face) * 0.19); m.rotation.y = face; scene.add(m); }
    addCircle(452, 158, 0.15);
    for (const [x, z, r] of [[451, 172, Math.PI / 2], [451, 144, Math.PI / 2], [453, 187, Math.PI / 2]]) benchAt(x, z, r); }
  // bus stops on F at the centre, both directions
  for (const [x, z, yaw] of BUS) ctx.busStop(B, x, gy(x, z), z, yaw); B.frame(0, 0, 0, 0);
  // garbage stations beside the parking courts
  for (const pk of out.parkings) { const x = pk.cx + Math.cos(pk.yaw) * (pk.D / 2 + 2.2) - Math.sin(pk.yaw) * (pk.len / 2 - 3), z = pk.cz - Math.sin(pk.yaw) * (pk.D / 2 + 2.2) - Math.cos(pk.yaw) * (pk.len / 2 - 3);
    if (clear(x, z, 1.2)) { ctx.garbagePoint(B, x, gy(x, z), z, pk.yaw, rng); B.frame(0, 0, 0, 0); navRect(x, z, 1.6, 1.2, pk.yaw, 2); } }
  // pedestrian links through the blocks (緑道): between the park and the centre, and across the north-west block
  // (the park path meets the south street's footway; the link goes on from the far footway: people cross at the corner)
  pathLine([[440, 60.6], [440, 70], [454.5, 84.5], [454.5, 89.8]], 2.6);
  pathLine([[415, 60.6], [415, 64], [412, 90]], 2.2);
  pathLine([[520, 60.6], [520, 89.5], [498.2, 89.5]], 2.2);
  pathLine([[404.6, 232], [416, 232]], 2.2); pathLine([[440, 262], [452, 268]], 2.2);

  // ---- the buildings' own paving: an apron (forecourt) at every entrance, laid on the ground in front of its landing,
  // steps and ramp (which the router treats as walls); a walk along the front of the low-rise flats (their ground-floor
  // doors, round the gable to the foot of the outside stair); walks under the mid-rises' access corridors round the
  // lobby to its apron; and at the walk-ups a walk joining the stair halls' aprons along the back
  const quadRect = C => { const [a, b, , d] = C, L1 = Math.hypot(b[0] - a[0], b[1] - a[1]), L2 = Math.hypot(d[0] - a[0], d[1] - a[1]);
    return { cx: (C[0][0] + C[2][0]) / 2, cz: (C[0][1] + C[2][1]) / 2, hw: L2 / 2, hd: L1 / 2, r: Math.atan2(b[0] - a[0], b[1] - a[1]) }; };
  for (const b of blds) {
    const c = Math.cos(b.r), sn = Math.sin(b.r), Wd = (lx, lz) => [b.x + lx * c + lz * sn, b.z - lx * sn + lz * c];
    b.own = new Set();
    for (const e of b.entrances || []) { if (!e.court) continue;
      const rid = regions.length; regions.push({ kind: 'apron', pts: [[(e.court[0][0] + e.court[2][0]) / 2, (e.court[0][1] + e.court[2][1]) / 2]], connected: false, link: true }); b.own.add(rid);
      apron(e.court, rid);
      for (const q of e.block || []) { const R = quadRect(q); navRect(R.cx, R.cz, R.hw, R.hd, R.r, 2); } }
    if (b.fam === 'R' && b.walk) { const { w, d } = b.walk, f = d / 2;
      b.own.add(pathLine([Wd(-w / 2 - 0.4, f + 0.85), Wd(w / 2 + 1.95, f + 0.85), Wd(w / 2 + 1.95, f - 3.95), Wd(w / 2 + 0.7, f - 3.95)], 1.3, { lamps: false, edge: false, link: true, yo: 0.048 }));
      for (const e of b.entrances) if (e.kind === 'gallery') { e.from = Wd(0, f + 0.85); const q = Wd(0, f + 1.95); e.p = [q[0], 0, q[1]]; } }
    for (const wk of b.walkways || []) b.own.add(pathLine(wk, 1.5, { lamps: false, edge: false, link: true, yo: 0.047 }));
    if (b.fam === 'S') { const st = (b.entrances || []).filter(e => e.kind === 'stair' && e.front);
      if (st.length > 1) { const ax = [-c, sn], pr = e => (e.front[0] - b.x) * ax[0] + (e.front[2] - b.z) * ax[1]; st.sort((p, q) => pr(p) - pr(q));
        const f0 = st[0].front, f1 = st[st.length - 1].front, L = Math.hypot(f1[0] - f0[0], f1[2] - f0[2]), ux = (f1[0] - f0[0]) / L, uz = (f1[2] - f0[2]) / L;
        const pts = [[f0[0] - ux * 2.2, f0[2] - uz * 2.2], [f1[0] + ux * 2.2, f1[2] + uz * 2.2]];
        b.backWalk = { pts, rid: pathLine(pts, 1.8, { lamps: true, link: true, yo: 0.047 }), u: [ux, uz], out: st[0].out }; b.own.add(b.backWalk.rid);
        for (const e of st) e.viaWalk = true; } }
  }

  // ---- routing over the grid: footway cells from the road network, the carriageways blocked
  for (let j = 0; j < NH; j++) for (let i = 0; i < NW; i++) { const k = j * NW + i; if (NAV[k] === 2 || NAV[k] === 1) continue;
    const x = NX0 + i + 0.5, z = NZ0 + j + 0.5; if (!inDanchi(x, z, 14)) continue;
    if (RN.roadAt(x, z)) NAV[k] = 2; else if (RN.walkY(x, z) !== null) NAV[k] = 3; }
  const nearFoot = (x, z, r = 1.6) => { for (let dz = -r; dz <= r; dz += 0.8) for (let dx = -r; dx <= r; dx += 0.8) { const k = navI(x + dx, z + dz); if (k >= 0 && NAV[k] === 3) return true; } return false; };
  for (let k = 0; k < NW * NH; k++) if (NAV[k] === 1 && REG[k] >= 0 && !regions[REG[k]].connected) {
    const i = k % NW, j = (k - i) / NW; if (nearFoot(NX0 + i + 0.5, NZ0 + j + 0.5, 1.2)) regions[REG[k]].connected = true; }
  // cheapest way from (sx, sz) to a footway or to paving of another region; returns the cells walked, or null
  const COST = [1, 0.3, Infinity, 0.3, 2.6];
  const route = (sx, sz, own, maxCost) => {                                     // own: region ids not to stop on
    const s0 = navI(sx, sz); if (s0 < 0) return null;
    const dist = new Float32Array(NW * NH).fill(Infinity), prev = new Int32Array(NW * NH).fill(-1), heap = [[0, s0]]; dist[s0] = 0;
    const push = (d, k) => { heap.push([d, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    while (heap.length) {
      const [d, k] = pop(); if (d > dist[k]) continue; if (d > maxCost) return null;
      if (k !== s0 && (NAV[k] === 3 || NAV[k] === 1 && REG[k] >= 0 && !own.has(REG[k]))) { const cells = []; for (let q = k; q >= 0; q = prev[q]) cells.push(q); return cells.reverse(); }
      const i = k % NW, j = (k - i) / NW;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { if (!di && !dj) continue; const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= NW || jj >= NH) continue;
        const kk = jj * NW + ii, cst = COST[NAV[kk]]; if (cst === Infinity) continue;
        if (di && dj && (NAV[j * NW + ii] === 2 || NAV[jj * NW + i] === 2)) continue;                                  // no corner cutting past a wall
        const nd = d + cst * (di && dj ? 1.414 : 1); if (nd < dist[kk]) { dist[kk] = nd; prev[kk] = k; push(nd, kk); } }
    }
    return null;
  };
  // the walked cells as a polyline: straight runs where nothing blocks the view between their ends
  const clearLine = (a, b) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.ceil(L / 0.4);
    for (let q = 0; q <= n; q++) { const k = navI(a[0] + (b[0] - a[0]) * q / n, a[1] + (b[1] - a[1]) * q / n); if (k < 0 || NAV[k] === 2 || NAV[k] === 4) return false; } return true; };
  const toLine = (cells, from) => { const pts = [from, ...cells.slice(1).map(k => [NX0 + k % NW + 0.5, NZ0 + Math.floor(k / NW) + 0.5])], outp = [pts[0]];
    let i = 0; while (i < pts.length - 1) { let j = pts.length - 1; while (j > i + 1 && !clearLine(pts[i], pts[j])) j--; outp.push(pts[j]); i = j; } return outp; };
  const finish = (pts, k, w, lamps) => { // run on half a metre into what it joins, so the paving overlaps rather than butts
    const a = pts[pts.length - 2], b = pts[pts.length - 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; pts[pts.length - 1] = [b[0] + (b[0] - a[0]) / L * 0.5, b[1] + (b[1] - a[1]) / L * 0.5];
    if (k >= 0 && REG[k] >= 0) regions[REG[k]].connected = true;
    pathLine(pts, w, { lamps, link: true, yo: 0.046 }); regions[regions.length - 1].connected = true; return true; };
  const link = (x, z, own, w, maxCost, from = null) => { const cells = route(x, z, own, maxCost); if (!cells) return false;
    const end = cells[cells.length - 1], pts = toLine(cells, [x, z]); if (from) pts.unshift(from);
    return finish(pts, end, w, Math.hypot(pts[pts.length - 1][0] - x, pts[pts.length - 1][1] - z) > 10); };
  // a branch path laid square to what it leaves: straight on along (dx, dz) to the first footway or paving it meets, or
  // out and then square to one side (an L), whichever is shortest and clear for its full width; the grid router only
  // where neither will do. Clean right-angled branches read as laid out, not as wandering desire lines.
  const clearRun = (x, z, dx, dz, t1, hw) => { for (let t = 0; t <= t1 + 1e-6; t += 0.5) for (const e of [-hw, 0, hw]) { const k = navI(x + dx * t - dz * e, z + dz * t + dx * e); if (k < 0 || NAV[k] === 2 || NAV[k] === 4) return false; } return true; };
  const rayHit = (x, z, dx, dz, own, maxL, hw) => { for (let t = 0.5; t <= maxL; t += 0.5) { const k = navI(x + dx * t, z + dz * t); if (k < 0) return null; const v = NAV[k];
    if (v === 3 || (v === 1 && REG[k] >= 0 && !own.has(REG[k]))) return clearRun(x, z, dx, dz, Math.max(0, t - 1), hw) ? { t, k } : null; if (v === 2 || v === 4) return null; } return null; };
  const linkOrtho = (x, z, dx, dz, own, w, from = null, maxL = 45) => {
    const hw = w / 2 + 0.15; let best = null;
    const s1 = rayHit(x, z, dx, dz, own, maxL, hw); if (s1) best = { pts: [[x, z], [x + dx * s1.t, z + dz * s1.t]], cost: s1.t, k: s1.k };
    for (let d1 = 0.5; d1 <= 22; d1 += 0.5) { if (best && d1 >= best.cost) break; if (!clearRun(x, z, dx, dz, d1, hw)) break; const cx = x + dx * d1, cz = z + dz * d1;
      for (const sg of [-1, 1]) { const ex = -dz * sg, ez = dx * sg, h = rayHit(cx, cz, ex, ez, own, 55, hw); if (!h) continue; const cost = d1 + h.t + 5;
        // a turn right at the apron's edge: the branch simply leaves along it from inside the apron (no stub of a first leg)
        const pts = d1 < w * 1.25 ? [[x - dx * 0.4, z - dz * 0.4], [x - dx * 0.4 + ex * (h.t + 0.2), z - dz * 0.4 + ez * (h.t + 0.2)]] : [[x, z], [cx, cz], [cx + ex * h.t, cz + ez * h.t]];
        if (!best || cost < best.cost) best = { pts, cost, k: h.k }; } }
    if (!best || best.cost > 70) return link(x, z, own, w, 220, from);
    if (from) best.pts.unshift(from);
    return finish(best.pts, best.k, w, best.cost > 10); };
  // designed paths that stop short of the network run on to it, straight on from their ends; plazas are joined from
  // their middle
  for (let rid = 0; rid < regions.length; rid++) { const R = regions[rid]; if (R.link) continue;
    if (R.kind !== 'path') { if (!R.connected) link(R.pts[0][0], R.pts[0][1], new Set([rid]), 2.2, 40); continue; }
    for (const end of [0, 1]) { const P = R.pts, [x, z] = end ? P[P.length - 1] : P[0], [px, pz] = end ? P[P.length - 2] : P[1];
      if (RN.walkY(x, z) !== null) continue;                                                                        // already on a footway
      const L = Math.hypot(x - px, z - pz) || 1, dx = (x - px) / L, dz = (z - pz) / L;
      let joined = false; for (let t = 0.3; t < 1.6 && !joined; t += 0.3) { const k = navI(x + dx * t, z + dz * t); if (k >= 0 && NAV[k] === 1 && REG[k] >= 0 && REG[k] !== rid) joined = true; }
      if (!joined) linkOrtho(x - dx * 0.5, z - dz * 0.5, dx, dz, new Set([rid]), Math.min(R.w || 2.2, 2.6), null, 30); }
  }
  // every door: a branch from its apron to the nearest footway or path (the walk-ups' stair halls through the walk along
  // their back, which is joined once from its middle and run on from its ends), lamps along it, planting beside the door,
  // a bicycle shelter near stair halls and lobbies
  for (const b of blds) if (b.backWalk) { const W = b.backWalk, [a, c] = W.pts, mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
    linkOrtho(mx, mz, W.out[0], W.out[1], b.own, 2.0);
    for (const [q, sg] of [[a, -1], [c, 1]]) { const dx = W.u[0] * sg, dz = W.u[1] * sg, h = rayHit(q[0], q[1], dx, dz, b.own, 14, 1.05);
      if (h) finish([[q[0] - dx * 0.5, q[1] - dz * 0.5], [q[0] + dx * h.t, q[1] + dz * h.t]], h.k, 1.8, false); } }
  for (const b of blds) for (const e of b.entrances || []) {
    const [x, , z] = e.p; if (e.kind === 'shop') continue;
    if (!e.viaWalk) { const wd = e.kind === 'lobby' ? 2.6 : e.kind === 'gallery' ? 1.6 : 2.0;
      const back = e.from ? 0 : 0.6; linkOrtho(x - e.out[0] * back, z - e.out[1] * back, e.out[0], e.out[1], b.own, wd, e.from || null); }
    for (const sd of [-1, 1]) { const px = x + e.out[0] * 1.6 - e.out[1] * sd * 2.6, pz = z + e.out[1] * 1.6 + e.out[0] * sd * 2.6, k = navI(px, pz);
      if (clear(px, pz, 0.2) && k >= 0 && NAV[k] === 0) for (let q = 0; q < 3; q++) out.bushes.push({ x: px + (rng() - 0.5) * 1.2, y: gy(px, pz) - 0.05, z: pz + (rng() - 0.5) * 1.2, s: 0.6 + rng() * 0.3, sx: 1, r: rng() * 6.28, c: new THREE.Color().setHSL(0.26 + rng() * 0.06, 0.45, 0.32 + rng() * 0.08) }); }
    if (e.kind !== 'gallery' && rng() < 0.8) for (const sd of rng() < 0.5 ? [-1, 1] : [1, -1]) { const px = x + e.out[0] * 5 - e.out[1] * sd * 6, pz = z + e.out[1] * 5 + e.out[0] * sd * 6, yaw = Math.atan2(e.out[0], e.out[1]) + Math.PI / 2;
      let free = clear(px, pz, 2.5); for (let q = -4; q <= 4 && free; q += 1) for (const t of [-1.6, 0, 1.6]) { const k = navI(px + Math.cos(yaw) * q + Math.sin(yaw) * t, pz - Math.sin(yaw) * q + Math.cos(yaw) * t); if (k < 0 || NAV[k] !== 0) { free = false; break; } }
      if (free) { bikeShelter(px, pz, yaw, 6 + Math.floor(rng() * 4)); break; } }
  }
  // edge planting: a hedge along the west loop road facing the paddies, trees along the district's rim
  for (let z = 70; z < 300; z += 9 + rng() * 5) { const x = 341.5 - rng() * 1.5; if (clear(x, z, 1)) out.trees.push({ kind: rng() < 0.6 ? 'leaf' : 'zelkova', x, z, scale: 0.7 + rng() * 0.2 }); }
  for (let t = 0; t < 1; t += 0.05) { const a = lerp(-0.3, 2.3, t), x = 476 + Math.cos(a) * 158, z = 170 + Math.sin(a) * 158; if (inDanchi(x, z, 14) && !inDanchi(x, z, 3) && clear(x, z, 2)) out.trees.push({ kind: rng() < 0.5 ? 'oak' : 'leaf', x, z, scale: 0.9 }); }

  // avenue (zelkovas) and F (maples): a verge row just behind the footway, both sides, clear of paths, courts and shelters
  for (const id of ['DA', 'F']) { const n = RN.byId.get(id), W = n.walk || 2;
    for (let s = 8; s < n.PL.len - 6; s += id === 'DA' ? 11 : 12) for (const side of [1, -1]) {
      const e = edgePt(n, s, side, W + 1.3); if (id === 'F' && e.x < 350) continue;
      if (RN.clipDist(n, s) < 5 || !inDanchi(e.x, e.z, 2) || !clear(e.x, e.z, 1.0) || (ctx.occAt && ctx.occAt(e.x, e.z, 1.4))) continue;
      out.trees.push({ kind: id === 'DA' ? 'zelkova' : 'maple', x: e.x, z: e.z, scale: id === 'DA' ? 0.64 : 0.7 }); occRect(e.x, e.z, 0.8, 0.8, 0, 1);
    } }
  // mature trees through the open lawns between the buildings, in loose groups (never on paths, parking or doors)
  { const occAt = ctx.occAt;
    for (let z = -10; z < 350; z += 6.5) for (let x = 344; x < 656; x += 6.5) {
      const px = x + (rng() - 0.5) * 4, pz = z + (rng() - 0.5) * 4;
      if (!inDanchi(px, pz, -4) || !clear(px, pz, 4.5) || (occAt && occAt(px, pz, 2.5))) continue;
      const g = Math.sin(px * 0.05 + 1.3) * Math.sin(pz * 0.047 + 0.4) + Math.sin(px * 0.13) * Math.sin(pz * 0.11) * 0.4;
      if (rng() > 0.18 + 0.5 * Math.max(0, g)) continue;
      if (out.trees.some(t => Math.hypot(t.x - px, t.z - pz) < 5.5)) continue;
      const k = rng();
      out.trees.push({ kind: k < 0.3 ? 'zelkova' : k < 0.5 ? 'leaf' : k < 0.66 ? 'sakura' : k < 0.82 ? 'oak' : 'maple', x: px, z: pz, scale: 0.65 + rng() * 0.3 });
    } }
  // ---- small builders used above
  function pergola(x, z, yaw, L, D) { const y = gy(x, z); B.frame(x, y, z, yaw);
    for (const ex of [-L / 2, L / 2]) for (const ez of [-D / 2, D / 2]) B.bbox('wood', ex, 0, ez, 0.16, 2.5, 0.16, 0.015, { color: [0.52, 0.38, 0.26] });
    for (const ez of [-D / 2, D / 2]) B.bbox('wood', 0, 2.5, ez, L + 0.6, 0.18, 0.12, 0.01, { color: [0.5, 0.36, 0.25] });
    for (let k = 0; k <= Math.round(L / 0.5); k++) B.box('wood', -L / 2 + k * L / Math.round(L / 0.5), 2.68, 0, 0.08, 0.1, D + 0.5, { color: [0.54, 0.4, 0.28] });
    B.frame(0, 0, 0, 0);
    for (let k = 0; k < 6; k++) out.bushes.push({ x: x + (rng() - 0.5) * L, y: y + 2.55, z: z + (rng() - 0.5) * D, s: 0.8, sx: 1.4, r: rng() * 6, c: new THREE.Color().setHSL(0.72 + rng() * 0.04, 0.45, 0.62) }); // wisteria
    for (const ex of [-L / 2, L / 2]) for (const ez of [-D / 2, D / 2]) { const p = [x + Math.cos(yaw) * ex + Math.sin(yaw) * ez, z - Math.sin(yaw) * ex + Math.cos(yaw) * ez]; addCircle(p[0], p[1], 0.12); }
    occRect(x, z, L / 2 + 0.4, D / 2 + 0.4, yaw, 1); }
  function sandPit(x, z) { const y = gy(x, z) + 0.05; B.frame(x, y, z, 0); B.bbox('wood', 0, -0.05, 0, 4.2, 0.3, 3.4, 0.02, { color: [0.58, 0.44, 0.3] }); B.box('ballast', 0, 0.2, 0, 3.8, 0.01, 3.0, { color: [1.0, 0.9, 0.72], uv: 2 });
    for (const [sx, sz] of [[-2, -1.6], [2, -1.6], [2, 1.6], [-2, 1.6]]) B.cyl('steel', sx, 0, sz, 0.05, 0.05, 2.6, 8, { color: [0.7, 0.7, 0.72] });
    B.poly('plastic', [[-2.1, 2.6, -1.7], [2.1, 2.3, -1.7], [2.1, 2.6, 1.7], [-2.1, 2.3, 1.7]], [0, 1, 0], { color: [0.96, 0.9, 0.78] }); B.poly('plastic', [[2.1, 2.3, -1.7], [-2.1, 2.6, -1.7], [-2.1, 2.3, 1.7], [2.1, 2.6, 1.7]], [0, -1, 0], { color: [0.9, 0.84, 0.72] });
    B.frame(0, 0, 0, 0); }
  function springRider(x, z, col) { const y = gy(x, z) + 0.05; B.frame(x, y, z, rng() * 6); B.cyl('steel', 0, 0, 0, 0.1, 0.1, 0.4, 10, { color: [0.4, 0.4, 0.42] }); B.bbox('plastic', 0, 0.4, 0, 0.3, 0.45, 0.8, 0.08, { color: col }); B.cyl('plastic', 0, 0.85, 0.35, 0.12, 0.1, 0.25, 10, { color: col, cap: true }); B.frame(0, 0, 0, 0); addCircle(x, z, 0.35); }
  function toilet(x, z, yaw) { const y = gy(x, z); B.frame(x, y, z, yaw);
    B.bbox('concrete', 0, -0.2, 0, 5.2, 0.3, 3.4, 0.02, { color: [0.7, 0.7, 0.68] }); B.bbox('tiles', 0, 0.1, 0, 4.8, 2.8, 3.0, 0.02, { color: [0.78, 0.7, 0.62], uv: 2 });
    B.bbox('roofMetal', 0, 2.9, 0, 5.6, 0.18, 3.8, 0.02, { color: [0.36, 0.42, 0.46] });
    for (const sx of [-1.3, 1.3]) { B.quad('dark', [sx - 0.5, 0.15, 1.51], [sx + 0.5, 0.15, 1.51], [sx + 0.5, 2.2, 1.51], [sx - 0.5, 2.2, 1.51], { color: [0.15, 0.15, 0.15] }); }
    B.box('lamp', 0, 2.6, 1.55, 0.4, 0.1, 0.06); B.frame(0, 0, 0, 0); addBox(x, z, 2.5, 1.6, yaw); occRect(x, z, 3.2, 2.4, yaw, 1); lampPoints.push({ p: B.frame(x, y, z, yaw).P([0, 2.5, 1.8]), s: 0.4 }); B.frame(0, 0, 0, 0); }
  // street lamps: at their spacing along the footway's back, but never in the mouth of a path, a driveway or a
  // crossing — such a lamp slides along the street to the nearest clear spot
  for (const L of lampQ) { const { n, side, W } = L;
    for (const ds of [0, 2, -2, 3.5, -3.5, 5, -5, 7, -7]) { const sv = L.s + ds; if (sv < 6 || sv > n.PL.len - 6 || RN.clipDist(n, sv) < 3) continue;
      const e = edgePt(n, sv, side, W - 0.45); let bad = !clear(e.x, e.z, 0.5) || signsAt.some(q => Math.hypot(q[0] - e.x, q[1] - e.z) < 1.5);
      for (let a = 0; a < 6.28 && !bad; a += 0.785) for (const r of [0.6, 1.2]) { const k = covI(e.x + Math.cos(a) * r, e.z + Math.sin(a) * r); if (k >= 0 && (COV[k] >= 0 || COV2[k] >= 0)) { bad = true; break; } }
      if (!bad && RN.cuts.some(c => c.id === n.R.id && c.side === side && sv > c.s0 - 1.5 && sv < c.s1 + 1.5)) bad = true;
      if (bad) continue; streetLamp(e.x, e.z, Math.atan2(-e.l[0] * side, -e.l[1] * side)); break; } }
  flushEdges();
  // final sweep: shrubs, stones and trees that ended up on a walking surface (planted before a later path or apron
  // crossed their spot) are taken out
  out.bushes = out.bushes.filter(b => { if (b.keep) return true; const r = (b.s || 0.5) * 0.45; return lakeDepth(b.x, b.z) < 0.08 && !paved(b.x, b.z) && !paved(b.x + r, b.z) && !paved(b.x - r, b.z) && !paved(b.x, b.z + r) && !paved(b.x, b.z - r); });
  out.rocks = (out.rocks || []).filter(q => { const r = q.s * 0.4; return !paved(q.x, q.z) && !paved(q.x + r, q.z) && !paved(q.x - r, q.z) && !paved(q.x, q.z + r) && !paved(q.x, q.z - r); });
  out.trees = out.trees.filter(t => t.pit || t.planter || (!paved(t.x, t.z) && lakeDepth(t.x, t.z) < 0.02));
  B.frame(0, 0, 0, 0);
  out.buildings = blds;
  return out;
}
