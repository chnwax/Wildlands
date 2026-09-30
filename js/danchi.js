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
  return h + (target - h) * w;
}

// ---------------------------------------------------------------- building the district
import { THREE, scene, lerp, clamp, mulberry32, addBox, addCircle } from './core.js';
import { lampPoints, signMesh, JP_FONT } from './townkit.js';
import { walkupSlab, pointTower, mansion, centreBlock, lowRise, PALETTES } from './apartments.js';

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
  ['T', 575, 160, Math.PI - 0.35, { floors: 13, pal: 'white', no: 2, name: 'サクラタワー 弐番館' }],
  // the loop road's outer frontage on the east: two slabs looking out to the wooded hill, entered from the loop road
  ['S', 637, 74, Math.PI / 2, { w: 41.4, floors: 5, pal: 'salmon', no: 10 }],
  ['S', 637, 121, Math.PI / 2, { w: 27.6, floors: 5, pal: 'grey', no: 11, bal: 'rail' }],
  // north-west: low-rise terraces along the west edge (toward the paddies), a tower and a slab turned along the avenue
  ['R', 372, 225, Math.PI / 2, { w: 20, pal: 'sand', name: 'ハイツ川辺' }],
  ['R', 371, 252, Math.PI / 2, { w: 20, pal: 'cream', name: 'メゾン花水木' }],
  ['R', 372, 279, Math.PI / 2, { w: 18, pal: 'salmon', name: 'グリーンハイツ' }],
  ['T', 428, 236, Math.PI - 0.1, { floors: 10, pal: 'white', no: 3, name: 'サクラタワー 参番館' }],
  ['R', 440, 214, Math.PI, { w: 22, pal: 'cream', name: 'レジデンス若葉' }],
  ['S', 468, 280, 2.125, { w: 27.6, floors: 5, pal: 'cream', no: 7 }],
  // north-east: a mid-rise facing F, a tower looking out over the hill foot
  ['M', 503, 224, Math.PI + 0.08, { w: 39.6, floors: 7, pal: 'mocha', no: 8, name: 'パークハイツ桜川 北' }],
  ['T', 548, 236, Math.PI - 0.4, { floors: 11, pal: 'white', no: 4, name: 'サクラタワー 四番館' }],
  // the north rim: low-rise flats stepping up the hill foot beyond the loop road, their galleries toward it
  ['R', 400, 336, Math.PI, { w: 22, pal: 'sand', name: 'ハイム東雲' }],
  ['R', 432, 340, Math.PI, { w: 22, pal: 'grey', name: 'サンライズ桜川' }],
  ['R', 464, 331, Math.PI + 0.22, { w: 20, pal: 'cream', name: 'コーポ丘の上' }],
  // green belt, west end: low-rise flats on the district's corner toward the main road and the fields
  ['R', 378, 18, Math.PI, { w: 24, pal: 'grey', name: 'コーポ田園' }],
];
// parking courts: an access aisle from a street straight into the court, bays both sides. [road id, x, z at the
// road's edge (the entry), direction into the court (radians, as a yaw), aisle length, rows]
const PARKING = [
  ['DU', 350.75, 104, Math.PI / 2, 28, 2], ['DU', 350.75, 148, Math.PI / 2, 26, 2],     // south-west block, off the loop road
  ['DL', 525.3, 152, -Math.PI / 2, 38, 2],                                                // behind the centre: residents and shoppers
  ['DL', 534.8, 110, Math.PI / 2, 54, 2],                                                 // south-east block B
  ['DN', 404.5, 270, Math.PI / 2, 34, 2],                                                 // north-west, off the local street
  ['DA', 488.2, 262, Math.PI / 2 - 0.05, 38, 2],                                          // north-east, off the avenue
  ['DU', 618.75, 36, Math.PI / 2, 32, 2],                                                 // east frontage, off the loop road
  ['DU', 618.75, 99, Math.PI / 2, 26, 1],
];

export function buildDanchi(ctx) {
  const { B, Y0, gy, RN, occRect, extras, hf } = ctx, rng = mulberry32(19740), out = { trees: [], hedges: [], bushes: [], carSpots: [], bikes: [], walkPaths: [], lamps: [], benches: [], groves: [] };
  const P2 = (x, z) => [x, gy(x, z), z];
  const BUS = [[492, 194.8, Math.PI], [420, 205.2, 0]];                               // F's bus stops at the centre, both ways
  const paint = (c, x0, z0, x1, z1, fn) => hf.paint2(c, Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1), fn);
  const inRect = (x, z, cx, cz, r, hw, hd, m = 0) => { const c = Math.cos(r), s = Math.sin(r), dx = x - cx, dz = z - cz; return Math.abs(dx * c - dz * s) < hw + m && Math.abs(dx * s + dz * c) < hd + m; };
  // the whole district is mown lawn unless something else is laid there
  paint(3, 338, -18, 624, 332, (x, z) => inDanchi(x, z, -1) ? 1 : 0);

  // ---- buildings
  const blds = [];
  for (const [fam, x, z, r, o] of BUILDINGS) {
    const y = gy(x, z) + 0.02, pal = PALETTES[o.pal] || PALETTES.cream, s = { ...o, x, y, z, r, pal };
    const info = fam === 'S' ? walkupSlab(B, s, rng, extras) : fam === 'T' ? pointTower(B, s, rng, extras) : fam === 'M' ? mansion(B, s, rng, extras) : fam === 'L' ? centreBlock(B, s, rng, extras) : lowRise(B, s, rng, extras);
    info.fam = fam; info.x = x; info.z = z; info.r = r; info.y = y; blds.push(info);
    // keep everything else off its footprint; the ground round it is bare under a gravel strip
    const fp = info.footprint || [[-30, -12], [30, 12]], hw = (fp[1][0] - fp[0][0]) / 2, hd = (fp[1][1] - fp[0][1]) / 2, cx = (fp[0][0] + fp[1][0]) / 2, cz = (fp[0][1] + fp[1][1]) / 2;
    const c = Math.cos(r), sn = Math.sin(r), wx = x + cx * c + cz * sn, wz = z - cx * sn + cz * c;
    occRect(wx, wz, hw, hd, r, 1);
    info.box = { x: wx, z: wz, hw, hd, r };
    paint(2, wx - hw - 2, wz - hw - 2, wx + hw + 2, wz + hw + 2, (px, pz) => inRect(px, pz, wx, wz, r, hw, hd, 0.8) ? 1 : 0);
  }
  const clear = (x, z, m = 1.0) => !blds.some(b => inRect(x, z, b.box.x, b.box.z, b.box.r, b.box.hw, b.box.hd, m));

  // ---- paved paths: pavers with concrete edging, draped on the ground; lamps (short posts) along them
  const pathLine = (pts, w = 2.4, { lamps = true, edge = true, mat = 'pavement', color = [0.84, 0.82, 0.78] } = {}) => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az); if (L < 0.2) continue;
      const ux = (bx - ax) / L, uz = (bz - az) / L, nx = -uz, nz = ux, N = Math.max(1, Math.ceil(L / 2));
      B.frame(0, 0, 0, 0);
      for (let k = 0; k < N; k++) {
        const t0 = L * k / N, t1 = L * (k + 1) / N, q = (t, e) => { const x = ax + ux * t + nx * e, z = az + uz * t + nz * e; return [x, gy(x, z) + 0.05, z]; };
        const pts4 = [q(t0, -w / 2), q(t1, -w / 2), q(t1, w / 2), q(t0, w / 2)];
        B.poly(mat, pts4, [0, 1, 0], { color, uvs: pts4.map(v => [v[0] / 1.2, v[2] / 1.2]), attr: mat === 'pavement' ? { aPave: [[t0, 0.5], [t1, 0.5], [t1, 0.5 + w], [t0, 0.5 + w]] } : undefined });
        if (edge) for (const e of [-1, 1]) B.detail(1, () => { const a = q(t0, e * (w / 2 + 0.05)), b = q(t1, e * (w / 2 + 0.05)); B.beam('concrete', [a[0], a[1] - 0.04, a[2]], [b[0], b[1] - 0.04, b[2]], 0.1, 0.12, { color: [0.74, 0.74, 0.72] }); });
      }
      paint(2, Math.min(ax, bx) - w, Math.min(az, bz) - w, Math.max(ax, bx) + w, Math.max(az, bz) + w, (px, pz) => { const t = (px - ax) * ux + (pz - az) * uz, e = Math.abs((px - ax) * nx + (pz - az) * nz); return t > -0.5 && t < L + 0.5 && e < w / 2 + 0.4 ? 1 : 0; });
      occRect((ax + bx) / 2, (az + bz) / 2, w / 2 + 0.3, L / 2 + 0.3, Math.atan2(bx - ax, bz - az), 1);
      if (lamps) for (let t = 6; t < L - 2; t += 16) { const x = ax + ux * t + nx * (w / 2 + 0.6), z = az + uz * t + nz * (w / 2 + 0.6); if (clear(x, z, 0.3)) pathLamp(x, z); }
    }
    out.walkPaths.push({ pts: pts.map(p => [p[0], p[1]]), off: 0, lift: null });
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
  const edgePt = (n, s, side, off) => { const q = RN.sampleAt(n, s), l = [-q.d[1], q.d[0]], u = side * (n.hw + off); return { x: q.x + l[0] * u, z: q.z + l[1] * u, d: q.d, l }; };
  for (const id of ['DU', 'DA', 'DS', 'DL', 'DN', 'F']) {
    const n = RN.byId.get(id), W = n.walk || 2;
    for (let s = 14, k = 0; s < n.PL.len - 8; s += 30, k++) {
      const side = k % 2 ? 1 : -1, e = edgePt(n, s, side, W - 0.45);
      if (id === 'F' && e.x < 350) continue;
      if (RN.clipDist(n, s) < 3 || !clear(e.x, e.z, 0.5)) continue;
      streetLamp(e.x, e.z, Math.atan2(-e.l[0] * side, -e.l[1] * side));
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
    const cycleSign = (x, z, yaw) => { const y = gy(x, z) + 0.12; B.frame(x, y, z, yaw);
      B.cyl('steel', 0, -0.1, 0, 0.035, 0.035, 2.75, 8, { color: [0.75, 0.77, 0.78] }); B.box('metal', 0, 2.2, 0.02, 0.12, 0.5, 0.04, { color: [0.6, 0.62, 0.64] });
      B.frame(0, 0, 0, 0);
      if (!signProto) signProto = signMesh(0.6, 0.6, (g, W2, H2) => { g.clearRect(0, 0, W2, H2); g.fillStyle = '#fff'; g.beginPath(); g.arc(W2 / 2, H2 / 2, W2 * 0.49, 0, 7); g.fill();
        g.fillStyle = '#1d55b0'; g.beginPath(); g.arc(W2 / 2, H2 / 2, W2 * 0.45, 0, 7); g.fill(); g.strokeStyle = g.fillStyle = '#fff'; g.lineCap = g.lineJoin = 'round'; const k = W2 / 256;
        g.lineWidth = 7 * k; for (const hx of [70, 132]) { g.beginPath(); g.arc(hx * k, 158 * k, 21 * k, 0, 7); g.stroke(); }
        g.beginPath(); g.moveTo(70 * k, 158 * k); g.lineTo(100 * k, 158 * k); g.lineTo(92 * k, 124 * k); g.lineTo(70 * k, 158 * k); g.moveTo(100 * k, 158 * k); g.lineTo(124 * k, 124 * k); g.lineTo(92 * k, 124 * k); g.moveTo(124 * k, 124 * k); g.lineTo(132 * k, 158 * k); g.moveTo(124 * k, 124 * k); g.lineTo(120 * k, 112 * k); g.stroke();
        g.lineWidth = 11 * k; g.beginPath(); g.arc(178 * k, 86 * k, 13 * k, 0, 7); g.fill(); g.beginPath(); g.moveTo(178 * k, 106 * k); g.lineTo(178 * k, 150 * k); g.moveTo(178 * k, 116 * k); g.lineTo(160 * k, 140 * k); g.moveTo(178 * k, 116 * k); g.lineTo(196 * k, 140 * k);
        g.moveTo(178 * k, 150 * k); g.lineTo(164 * k, 190 * k); g.moveTo(178 * k, 150 * k); g.lineTo(192 * k, 190 * k); g.stroke(); }, 0.2, 256);
      if (!signBack) signBack = new THREE.MeshStandardMaterial({ color: 0x9ea2a6, roughness: 0.5, metalness: 0.3, alphaMap: signProto.material.map, alphaTest: 0.5 });
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
  for (const [id, ex0, ez0, yaw, len, rows] of PARKING) {
    const n = RN.byId.get(id), fx = Math.sin(yaw), fz = Math.cos(yaw), lx = Math.cos(yaw), lz = -Math.sin(yaw), D = rows === 2 ? 16 : 11;
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
      for (const sgn of [-1, 1]) B.box('paint', bx, 0.045, bz + sgn * 1.25, 5.0, 0.004, 0.1, { color: [0.94, 0.94, 0.92] });
      B.detail(1, () => B.bbox('concrete', e * (D / 2 - 0.65), 0.04, bz, 0.14, 0.1, 1.6, 0.02, { color: [0.8, 0.8, 0.78] }));
      if (rng() < 0.74) spots.push({ p: B.P([bx, 0.04, bz]), r: yaw + (e > 0 ? Math.PI / 2 : -Math.PI / 2) - Math.PI / 2, y: y + 0.05 });
    }
    B.box('paint', 0, 0.045, 0, 0.12, 0.004, len - 3, { color: [0.94, 0.94, 0.92] });                                // aisle centre line
    // driveway apron through the kerb line of the street, and a lamp at the court's far corners
    B.bbox('concrete', 0, -0.1, -len / 2 - 0.8, 6.2, 0.12, 1.6, 0.01, { color: [0.74, 0.74, 0.72], skip: 'ny' });
    B.frame(0, 0, 0, 0);
    const sEntry = RN.byId.get(id) ? (() => { let best = null; for (const g of n.PL.segs) { const t = clamp((ex0 - g.a[0]) * g.d[0] + (ez0 - g.a[1]) * g.d[1], 0, g.L), d = Math.hypot(ex0 - g.a[0] - g.d[0] * t, ez0 - g.a[1] - g.d[1] * t); if (!best || d < best.d) best = { d, s: g.s0 + t, side: Math.sign((ex0 - g.a[0]) * -g.d[1] + (ez0 - g.a[1]) * g.d[0]) }; } return best; })() : null;
    if (sEntry) RN.cuts.push({ id, side: sEntry.side, s0: sEntry.s - 3.2, s1: sEntry.s + 3.2 });
    for (const e of [-1, 1]) { const px = cx + lx * e * (D / 2 + 0.8) + fx * (len / 2 - 2), pz = cz + lz * e * (D / 2 + 0.8) + fz * (len / 2 - 2); streetLamp(px, pz, yaw + Math.PI + e * 0.4); }
    occRect(cx, cz, D / 2 + 0.3, len / 2 + 0.3, yaw, 1);
    paint(2, cx - len, cz - len, cx + len, cz + len, (px, pz) => inRect(px, pz, cx, cz, yaw, D / 2 + 0.4, len / 2 + 0.4) ? 1 : 0);
    paint(0, cx - len, cz - len, cx + len, cz + len, (px, pz) => inRect(px, pz, cx, cz, yaw, D / 2 + 0.2, len / 2 + 0.2) ? 1 : 0);
    // hedge along the court's long sides, a walkway from its far end
    for (const e of [-1, 1]) { const a = [cx + lx * e * (D / 2 + 1.2) - fx * (len / 2 - 1), cz + lz * e * (D / 2 + 1.2) - fz * (len / 2 - 1)], b = [cx + lx * e * (D / 2 + 1.2) + fx * (len / 2 - 1), cz + lz * e * (D / 2 + 1.2) + fz * (len / 2 - 1)];
      if (clear((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0.8)) out.hedges.push({ a, b, h: 1.0 }); }
    out.carSpots.push(...spots);
    out.parkings = (out.parkings || []).concat([{ cx, cz, yaw, len, D }]);
  }

  // ---- entrances: a path from every door to the nearest footway (or path), lamps along it
  const footwayPt = (x, z) => { let best = null; for (const n of RN.net) { if (!n.R.district && n.R.id !== 'A') continue; const W = n.walk || 0; if (!W) continue;
    for (const g of n.PL.segs) { const t = clamp((x - g.a[0]) * g.d[0] + (z - g.a[1]) * g.d[1], 0, g.L), px = g.a[0] + g.d[0] * t, pz = g.a[1] + g.d[1] * t, d = Math.hypot(x - px, z - pz);
      if (!best || d < best.d) { const k = (n.hw + W * 0.55) / (d || 1); best = { d, x: px + (x - px) * k, z: pz + (z - pz) * k }; } } } return best; };
  for (const b of blds) for (const e of b.entrances || []) {
    const [x, , z] = e.p; if (e.kind === 'shop') continue;
    const f = footwayPt(x, z); if (!f || f.d > 60) continue;
    // straight out of the door, then turning onto the footway
    const k = 3.5, mx = x + e.out[0] * k, mz = z + e.out[1] * k;
    pathLine([[x - e.out[0] * 0.2, z - e.out[1] * 0.2], [mx, mz], [f.x, f.z]], e.kind === 'lobby' ? 3.2 : 2.2, { lamps: true });
    // planting beds either side of the entrance and a bicycle shelter beside it
    for (const sd of [-1, 1]) { const px = x + e.out[0] * 1.6 - e.out[1] * sd * 2.6, pz = z + e.out[1] * 1.6 + e.out[0] * sd * 2.6;
      if (clear(px, pz, 0.2)) for (let q = 0; q < 3; q++) out.bushes.push({ x: px + (rng() - 0.5) * 1.2, y: gy(px, pz) - 0.05, z: pz + (rng() - 0.5) * 1.2, s: 0.6 + rng() * 0.3, sx: 1, r: rng() * 6.28, c: new THREE.Color().setHSL(0.26 + rng() * 0.06, 0.45, 0.32 + rng() * 0.08) }); }
    if (e.kind !== 'gallery' && rng() < 0.8) { const sd = rng() < 0.5 ? -1 : 1, px = x + e.out[0] * 5 - e.out[1] * sd * 6, pz = z + e.out[1] * 5 + e.out[0] * sd * 6;
      if (clear(px, pz, 2.5)) bikeShelter(px, pz, Math.atan2(e.out[0], e.out[1]) + Math.PI / 2, 6 + Math.floor(rng() * 4)); }
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
  }

  // ---- courtyards, each of its own kind
  const benchAt = (x, z, yaw) => { if (!clear(x, z, 0.4)) return; ctx.bench(ctx.LB, x, gy(x, z), z, yaw); occRect(x, z, 1.0, 0.6, yaw, 1); };
  const tree = (kind, x, z, scale = 1) => { if (clear(x, z, 1.2)) out.trees.push({ kind, x, z, scale }); };
  const plaza = (x0, z0, x1, z1, color = [0.82, 0.8, 0.76]) => { B.frame(0, 0, 0, 0);
    for (let x = x0; x < x1 - 1e-3; x += 4) for (let z = z0; z < z1 - 1e-3; z += 4) { const xa = x, xb = Math.min(x1, x + 4), za = z, zb = Math.min(z1, z + 4), q = (px, pz) => [px, gy(px, pz) + 0.05, pz];
      B.poly('pavement', [q(xa, za), q(xb, za), q(xb, zb), q(xa, zb)], [0, 1, 0], { color, uvs: [[xa / 1.2, za / 1.2], [xb / 1.2, za / 1.2], [xb / 1.2, zb / 1.2], [xa / 1.2, zb / 1.2]], attr: { aPave: [[xa, za - z0 + 0.5], [xb, za - z0 + 0.5], [xb, zb - z0 + 0.5], [xa, zb - z0 + 0.5]] } }); }
    paint(2, x0 - 1, z0 - 1, x1 + 1, z1 + 1, (px, pz) => px > x0 - 0.3 && px < x1 + 0.3 && pz > z0 - 0.3 && pz < z1 + 0.3 ? 1 : 0);
    occRect((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (z1 - z0) / 2, 0, 1); };
  // C1 south-west: a lawn court under a group of big zelkovas, a curving path between the two slabs, a wisteria pergola
  { const pts = []; for (let k = 0; k <= 8; k++) { const t = k / 8; pts.push([lerp(366, 410, t), lerp(96, 114, t) + Math.sin(t * Math.PI * 2) * 3.5]); } pathLine(pts, 2.0);
    for (const [x, z, s] of [[375, 106, 1.0], [392, 99, 0.9], [404, 110, 0.85], [383, 113, 0.75]]) tree('zelkova', x, z, s);
    pergola(396, 104, 0.12, 5.4, 3.0); benchAt(371, 101, Math.PI * 0.5); benchAt(398, 108.5, Math.PI); benchAt(407, 102, -Math.PI / 2); }
  // C2 south-east A: the playground court inside the U — safety surfacing, a combination tower with a slide, swings,
  // spring riders, a sand pit under a shade sail, benches for the parents, trees round the edge
  { const cx = 481, cz = 115; plaza(462, 92, 499, 138, [0.84, 0.8, 0.74]);
    B.frame(cx, gy(cx, cz), cz, 0); B.box('plain', 0, 0.06, 0, 22, 0.03, 18, { color: [0.62, 0.32, 0.26] }); B.frame(0, 0, 0, 0);
    playSet(cx - 4, cz - 2, 0); swings(cx + 7, cz + 4, Math.PI / 2); sandPit(cx - 6, cz + 6.5); for (const [dx, dz] of [[5, -6], [8, -3.5]]) springRider(cx + dx, cz + dz, rng() < 0.5 ? [0.95, 0.72, 0.2] : [0.3, 0.62, 0.86]);
    for (const [x, z, r] of [[466, 100, Math.PI / 2], [466, 128, Math.PI / 2], [495, 99, -Math.PI / 2], [481, 135, Math.PI]]) benchAt(x, z, r);
    for (const [x, z] of [[464, 94], [497, 94], [464, 136], [497, 136], [481, 94]]) tree(rng() < 0.5 ? 'sakura' : 'maple', x, z, 0.75);
    for (const [x, z] of [[470, 120], [492, 110]]) pathLamp(x, z); }
  // C3 south-east B: a paved court — trees in grates on a grid, planters with seats, a shallow fountain basin
  { plaza(556, 120, 600, 147, [0.8, 0.79, 0.77]);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) { const x = 561 + i * 11, z = 126 + j * 15; tree('zelkova', x, z, 0.6); const y = gy(x, z) + 0.05; B.frame(x, y, z, 0); B.box('metal', 0, 0.005, 0, 1.4, 0.01, 1.4, { color: [0.22, 0.22, 0.23] }); B.frame(0, 0, 0, 0); }
    for (const [x, z] of [[566.5, 133.5], [588.5, 133.5]]) { const y = gy(x, z) + 0.05; B.frame(x, y, z, 0); B.bbox('concrete', 0, 0, 0, 4.2, 0.45, 1.6, 0.03, { color: [0.76, 0.75, 0.72] }); B.box('plain', 0, 0.44, 0, 3.9, 0.04, 1.3, { color: [0.3, 0.24, 0.18] });
      B.bbox('wood', 0, 0.45, 1.0, 4.2, 0.06, 0.45, 0.01, { color: [0.6, 0.46, 0.32] }); B.frame(0, 0, 0, 0); addBox(x, z, 2.1, 0.8, 0, y - 1, y + 0.5);
      for (let k = 0; k < 4; k++) out.bushes.push({ x: x - 1.5 + k, y: y + 0.45, z: z + (rng() - 0.5) * 0.4, s: 0.55, sx: 1, r: rng() * 6, c: new THREE.Color().setHSL(0.28, 0.5, 0.34) }); }
    fountain(577.5, 133.5); }
  // C4 north-west: a shaded bosque of trees on gravel between the tower and the slab, benches under it; a bamboo grove
  // closes the court to the north against the hill foot
  { const x0 = 440, z0 = 238; paint(0, x0 - 2, z0 - 2, x0 + 22, z0 + 24, () => 1); paint(2, x0 - 2, z0 - 2, x0 + 22, z0 + 24, () => 0.7);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) tree(j % 2 ? 'oak' : 'zelkova', x0 + i * 6 + (rng() - 0.5), z0 + j * 6.5 + (rng() - 0.5), 0.6);
    for (const [x, z, r] of [[443, 244, 0], [455, 250, Math.PI], [449, 258, Math.PI / 2]]) benchAt(x, z, r);
    out.groves.push({ x: 428, z: 296, R: 11 }); }
  // C5 north-east: a hill-view garden on the strip between the north-east parking court and the loop road's north
  // arc — a path from the avenue's footway to the loop road's, a wisteria pergola with benches looking out to the hill,
  // maples and low planting
  { pathLine([[499.6, 277], [507, 280.5], [516, 279.5], [525, 276], [536.2, 271.4]], 1.8);
    pergola(510.5, 285.2, 0.496, 4.8, 2.8); for (const dx of [-1.1, 1.1]) benchAt(510.5 + Math.cos(0.496) * dx - Math.sin(0.496) * 0.2, 285.2 - Math.sin(0.496) * dx - Math.cos(0.496) * 0.2, 0.496);
    for (const [x, z, s] of [[503, 281.8, 0.6], [518, 283.4, 0.65]]) tree('maple', x, z, s);
    for (let k = 0; k < 9; k++) { const x = 504 + k * 2.6 + (rng() - 0.5), z = 281.4 + k * -0.35 + 1.2 + rng() * 0.6; out.bushes.push({ x, y: gy(x, z) - 0.05, z, s: 0.5 + rng() * 0.2, sx: 1.2, r: rng() * 6, c: new THREE.Color().setHSL(0.24 + rng() * 0.08, 0.5, 0.3 + rng() * 0.08) }); } }
  // C6 the central park on the green belt: a lawn with a pond, loop paths, big trees, a play corner, a toilet block
  { const px = 476, pz = 18;
    const loop = []; for (let k = 0; k <= 24; k++) { const a = k / 24 * Math.PI * 2; loop.push([px + Math.cos(a) * 34, pz + Math.sin(a) * 18]); } pathLine(loop, 2.6);
    pathLine([[440, 18], [442, 18]], 2.6, { lamps: false }); pathLine([[476, 36], [476, 47.5]], 2.6); pathLine([[476, 0], [476, -18.5]], 2.6); pathLine([[510, 18], [520, 18]], 2.6);
    pond(px + 8, pz - 2, 12, 6.5);
    for (const [x, z, k, s] of [[452, 8, 'zelkova', 1.0], [458, 30, 'oak', 1.0], [496, 30, 'sakura', 0.9], [502, 6, 'zelkova', 0.9], [470, 4, 'sakura', 0.85], [446, 22, 'sakura', 0.8], [490, 38, 'leaf', 1.0], [462, 40, 'maple', 0.8], [505, 40, 'maple', 0.75], [440, 36, 'zelkova', 0.9], [512, 26, 'oak', 0.9]]) tree(k, x, z, s);
    playSet(456, 16, Math.PI / 2); swings(462, 26, 0);
    for (const [x, z, r] of [[468, 1, 0], [488, 1, 0], [498, 34, Math.PI], [454, 34, Math.PI], [444, 12, Math.PI / 2]]) benchAt(x, z, r);
    toilet(506, 16, -Math.PI / 2); }
  // C7 sports ground: a clay field with a baseball backstop, a fence, benches and floodlights
  { const x0 = 530, x1 = 604, z0 = -10, z1 = 44;
    paint(0, x0, z0, x1, z1, () => 1); paint(2, x0, z0, x1, z1, (x, z) => x > x0 + 2 && x < x1 - 2 && z > z0 + 2 && z < z1 - 2 ? 1 : 0);
    occRect((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2 + 0.5, (z1 - z0) / 2 + 0.5, 0, 1);
    B.frame(0, 0, 0, 0);
    for (const [ax, az, bx, bz] of [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]]) { const L = Math.hypot(bx - ax, bz - az), n = Math.ceil(L / 3);
      for (let k = 0; k < n; k++) { const t = k / n, x = lerp(ax, bx, t), z = lerp(az, bz, t), y = gy(x, z); B.cyl('steel', x, y, z, 0.04, 0.04, 2.4, 6, { color: [0.3, 0.46, 0.38] }); }
      const y0 = gy(ax, az), y1 = gy(bx, bz); B.beam('chain', [ax, y0 + 0.1, az], [bx, y1 + 0.1, bz], 0.02, 2.3, { color: [0.3, 0.46, 0.38] }); B.beam('steel', [ax, y0 + 2.38, az], [bx, y1 + 2.38, bz], 0.05, 0.05, { color: [0.3, 0.46, 0.38] }); addBox((ax + bx) / 2, (az + bz) / 2, L / 2, 0.1, Math.atan2(bx - ax, bz - az) + Math.PI / 2); }
    // backstop in the south-west corner, home plate diamond marked out in chalk
    const hx = x0 + 10, hz = z1 - 10, hy = gy(hx, hz);
    for (let k = -3; k <= 3; k++) { const a = Math.PI * 0.75 + k * 0.2, x = hx + Math.cos(a) * 7, z = hz + Math.sin(a) * 7; B.cyl('steel', x, hy, z, 0.07, 0.07, 6, 8, { color: [0.3, 0.46, 0.38] }); }
    for (let k = -3; k < 3; k++) { const a0 = Math.PI * 0.75 + k * 0.2, a1 = a0 + 0.2; B.beam('chain', [hx + Math.cos(a0) * 7, hy + 0.1, hz + Math.sin(a0) * 7], [hx + Math.cos(a1) * 7, hy + 0.1, hz + Math.sin(a1) * 7], 0.02, 5.9, { color: [0.3, 0.46, 0.38] }); }
    const diag = [[0, 0], [19.4, 0], [19.4, -19.4], [0, -19.4]].map(([a, b]) => [hx + (a - b) * 0.707, hz - (a + b) * 0.707 * 0]);
    void diag;
    for (const [ax, az, bx, bz] of [[hx, hz, hx + 19, hz], [hx, hz, hx, hz - 19], [hx + 19, hz, hx + 19, hz - 19], [hx, hz - 19, hx + 19, hz - 19]]) { B.frame(0, 0, 0, 0); const L = Math.hypot(bx - ax, bz - az), cx2 = (ax + bx) / 2, cz2 = (az + bz) / 2; B.frame(cx2, gy(cx2, cz2) + 0.02, cz2, Math.atan2(bx - ax, bz - az)); B.box('paint', 0, 0, 0, 0.1, 0.005, L, { color: [0.96, 0.96, 0.94] }); }
    B.frame(0, 0, 0, 0);
    for (const [x, z] of [[x0 + 2, z0 + 2], [x1 - 2, z0 + 2], [x1 - 2, z1 - 2], [x0 + 2, z1 - 2]]) { const y = gy(x, z); B.cyl('steel', x, y, z, 0.14, 0.1, 14, 10, { color: [0.7, 0.72, 0.74] }); B.bbox('metal', x, y + 14, z, 1.6, 0.9, 0.4, 0.02, { color: [0.4, 0.42, 0.44] }); B.box('lamp', x, y + 14.1, z + 0.21, 1.4, 0.7, 0.02); lampPoints.push({ p: [x, y + 13.5, z], s: 1.4 }); addCircle(x, z, 0.2); }
    for (const [x, z] of [[x0 + 14, z1 - 3], [x0 + 22, z1 - 3]]) { const y = gy(x, z); B.frame(x, y, z, 0); B.bbox('wood', 0, 0.42, 0, 3.6, 0.06, 0.4, 0.01, { color: [0.3, 0.44, 0.62] }); for (const e of [-1.5, 1.5]) B.box('steel', e, 0, 0, 0.06, 0.42, 0.34, { color: [0.6, 0.6, 0.6] });
      B.poly('roofMetal', [[-2, 2.3, -0.8], [2, 2.3, -0.8], [2, 2.1, 0.6], [-2, 2.1, 0.6]], [0, 1, 0.1], { color: [0.4, 0.5, 0.6] }); for (const e of [-1.9, 1.9]) B.box('steel', e, 0, -0.7, 0.06, 2.3, 0.06, { color: [0.6, 0.6, 0.6] }); B.frame(0, 0, 0, 0); }
    pathLine([[x0 + 16, z1 + 0.2], [x0 + 16, 47.5]], 3.0, { lamps: false }); }
  // C8 the centre plaza between the avenue and the shops: pavers, trees in planters, a clock, benches, bike racks
  { plaza(442, 142, 457.5, 192, [0.84, 0.8, 0.74]);
    for (const [x, z] of [[447, 150], [447, 166], [447, 182]]) { tree('zelkova', x, z, 0.6); const y = gy(x, z) + 0.05; B.frame(x, y, z, 0); B.bbox('concrete', 0, 0, 0, 2.2, 0.5, 2.2, 0.03, { color: [0.76, 0.75, 0.72] }); B.box('plain', 0, 0.46, 0, 1.9, 0.04, 1.9, { color: [0.3, 0.24, 0.18] }); B.frame(0, 0, 0, 0); addBox(x, z, 1.1, 1.1, 0, y - 1, y + 0.55); }
    const cy = gy(452, 158); B.frame(452, cy + 0.05, 158, 0); B.cyl('steel', 0, 0, 0, 0.09, 0.07, 3.6, 12, { color: [0.24, 0.3, 0.28] }); B.cyl('metal', 0, 3.6, 0, 0.42, 0.42, 0.18, 20, { color: [0.24, 0.3, 0.28], cap: true }); B.frame(0, 0, 0, 0);
    for (const face of [0, Math.PI]) { const m = signMesh(0.76, 0.76, (g, W2, H2) => { g.fillStyle = '#f4f2ea'; g.beginPath(); g.arc(W2 / 2, H2 / 2, W2 * 0.48, 0, 7); g.fill(); g.strokeStyle = '#222'; g.lineWidth = 4; g.stroke(); g.lineWidth = 6; g.beginPath(); g.moveTo(W2 / 2, H2 / 2); g.lineTo(W2 / 2, H2 * 0.2); g.moveTo(W2 / 2, H2 / 2); g.lineTo(W2 * 0.72, H2 * 0.56); g.stroke(); }, 0.2, 128);
      m.position.set(452 + Math.sin(face) * 0.1, cy + 3.69, 158 + Math.cos(face) * 0.19); m.rotation.y = face; scene.add(m); }
    addCircle(452, 158, 0.15);
    for (const [x, z, r] of [[451, 172, Math.PI / 2], [451, 144, Math.PI / 2], [453, 187, Math.PI / 2]]) benchAt(x, z, r); }
  // bus stops on F at the centre, both directions
  for (const [x, z, yaw] of BUS) ctx.busStop(B, x, gy(x, z), z, yaw); B.frame(0, 0, 0, 0);
  // garbage stations beside the parking courts
  for (const pk of out.parkings) { const x = pk.cx + Math.cos(pk.yaw) * (pk.D / 2 + 2.2) - Math.sin(pk.yaw) * (pk.len / 2 - 3), z = pk.cz - Math.sin(pk.yaw) * (pk.D / 2 + 2.2) - Math.cos(pk.yaw) * (pk.len / 2 - 3);
    if (clear(x, z, 1.2)) { ctx.garbagePoint(B, x, gy(x, z), z, pk.yaw, rng); B.frame(0, 0, 0, 0); } }
  // pedestrian links through the blocks (緑道): between the park and the centre, and across the north-west block
  pathLine([[440, 47.5], [440, 64], [458, 88], [462, 92]], 2.6);
  pathLine([[415, 64], [412, 90]], 2.2);
  pathLine([[520, 64], [520, 92], [499, 98]], 2.2);
  pathLine([[408.5, 232], [416, 232]], 2.2); pathLine([[440, 262], [452, 268]], 2.2);
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
  function playSet(x, z, yaw) { const y = gy(x, z) + 0.05; B.frame(x, y, z, yaw);
    for (const [px, pz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.cyl('steel', px * 1.2, 0, pz * 1.2, 0.07, 0.07, 3.4, 10, { color: [0.2, 0.52, 0.72] });
    B.bbox('plastic', 0, 1.5, 0, 2.6, 0.1, 2.6, 0.02, { color: [0.95, 0.76, 0.2] });
    B.poly('plastic', [[-1.5, 3.4, -1.5], [1.5, 3.4, -1.5], [0, 4.4, 0]], [0, 0.6, -1], { color: [0.86, 0.26, 0.22] }); B.poly('plastic', [[1.5, 3.4, 1.5], [-1.5, 3.4, 1.5], [0, 4.4, 0]], [0, 0.6, 1], { color: [0.86, 0.26, 0.22] });
    B.poly('plastic', [[1.5, 3.4, -1.5], [1.5, 3.4, 1.5], [0, 4.4, 0]], [1, 0.6, 0], { color: [0.8, 0.22, 0.2] }); B.poly('plastic', [[-1.5, 3.4, 1.5], [-1.5, 3.4, -1.5], [0, 4.4, 0]], [-1, 0.6, 0], { color: [0.8, 0.22, 0.2] });
    for (const e of [-1, 1]) B.bbox('plastic', e * 1.25, 1.6, 0, 0.06, 0.8, 2.4, 0.01, { color: [0.3, 0.62, 0.86] });
    // slide down one side, ladder up the other
    B.poly('plastic', [[1.3, 1.6, 1.3], [1.3, 1.6, 0.5], [4.6, 0.25, 0.5], [4.6, 0.25, 1.3]], [0.4, 1, 0], { color: [0.2, 0.7, 0.4] });
    for (const e of [0.45, 1.35]) B.beam('plastic', [1.3, 1.9, e], [4.6, 0.55, e], 0.05, 0.3, { color: [0.2, 0.7, 0.4] });
    for (let k = 0; k < 5; k++) B.box('steel', -1.6 - k * 0.12, 0.3 + k * 0.3, 0, 0.05, 0.05, 0.9, { color: [0.7, 0.7, 0.72] });
    for (const e of [-0.45, 0.45]) B.beam('steel', [-2.2, 0, e], [-1.25, 1.6, e], 0.06, 0.06, { color: [0.7, 0.7, 0.72] });
    B.frame(0, 0, 0, 0); addBox(x, z, 1.4, 1.4, yaw, y - 1, y + 4); occRect(x + Math.cos(yaw) * 1.2, z - Math.sin(yaw) * 1.2, 4, 2.2, yaw, 1); }
  function swings(x, z, yaw) { const y = gy(x, z) + 0.05; B.frame(x, y, z, yaw);
    for (const sx of [-2.1, 2.1]) for (const sz of [-0.9, 0.9]) B.beam('steel', [sx, 0, sz * 1.3], [sx, 2.5, 0], 0.08, 0.08, { color: [0.86, 0.3, 0.24] });
    B.beam('steel', [-2.2, 2.5, 0], [2.2, 2.5, 0], 0.09, 0.09, { color: [0.86, 0.3, 0.24] });
    for (const sx of [-1, 1]) { for (const e of [-0.22, 0.22]) B.beam('steel', [sx + e, 2.48, 0], [sx + e, 0.55, 0], 0.012, 0.012, { color: [0.6, 0.6, 0.6] }); B.bbox('plastic', sx, 0.5, 0, 0.5, 0.05, 0.22, 0.01, { color: [0.2, 0.3, 0.62] }); }
    B.frame(0, 0, 0, 0); addBox(x, z, 2.2, 0.5, yaw, y - 1, y + 2.6); occRect(x, z, 2.8, 2.4, yaw, 1); }
  function sandPit(x, z) { const y = gy(x, z) + 0.05; B.frame(x, y, z, 0); B.bbox('wood', 0, -0.05, 0, 4.2, 0.3, 3.4, 0.02, { color: [0.58, 0.44, 0.3] }); B.box('ballast', 0, 0.2, 0, 3.8, 0.01, 3.0, { color: [1.0, 0.9, 0.72], uv: 2 });
    for (const [sx, sz] of [[-2, -1.6], [2, -1.6], [2, 1.6], [-2, 1.6]]) B.cyl('steel', sx, 0, sz, 0.05, 0.05, 2.6, 8, { color: [0.7, 0.7, 0.72] });
    B.poly('plastic', [[-2.1, 2.6, -1.7], [2.1, 2.3, -1.7], [2.1, 2.6, 1.7], [-2.1, 2.3, 1.7]], [0, 1, 0], { color: [0.96, 0.9, 0.78] }); B.poly('plastic', [[2.1, 2.3, -1.7], [-2.1, 2.6, -1.7], [-2.1, 2.3, 1.7], [2.1, 2.6, 1.7]], [0, -1, 0], { color: [0.9, 0.84, 0.72] });
    B.frame(0, 0, 0, 0); }
  function springRider(x, z, col) { const y = gy(x, z) + 0.05; B.frame(x, y, z, rng() * 6); B.cyl('steel', 0, 0, 0, 0.1, 0.1, 0.4, 10, { color: [0.4, 0.4, 0.42] }); B.bbox('plastic', 0, 0.4, 0, 0.3, 0.45, 0.8, 0.08, { color: col }); B.cyl('plastic', 0, 0.85, 0.35, 0.12, 0.1, 0.25, 10, { color: col, cap: true }); B.frame(0, 0, 0, 0); addCircle(x, z, 0.35); }
  function fountain(x, z) { const y = gy(x, z) + 0.05; B.frame(x, y, z, 0);
    B.cyl('stone', 0, 0, 0, 3.1, 3.0, 0.45, 32, { color: [0.72, 0.7, 0.66] }); B.cyl('concrete', 0, 0.44, 0, 3.1, 3.1, 0.06, 32, { color: [0.78, 0.77, 0.74], cap: true });
    B.cyl('glass', 0, 0.3, 0, 2.8, 2.8, 0.18, 32, { color: [0.3, 0.5, 0.6], cap: true }); B.cyl('stone', 0, 0.3, 0, 0.5, 0.35, 1.1, 16, { color: [0.7, 0.68, 0.64], cap: true });
    B.frame(0, 0, 0, 0); addCircle(x, z, 3.1); occRect(x, z, 3.3, 3.3, 0, 1); }
  function pond(x, z, a, b) { const y = gy(x, z); B.frame(0, 0, 0, 0); const n = 36, pts = [];
    for (let k = 0; k < n; k++) { const t = k / n * Math.PI * 2, rr = 1 + 0.12 * Math.sin(t * 3 + 1) + 0.06 * Math.sin(t * 5); pts.push([x + Math.cos(t) * a * rr, z + Math.sin(t) * b * rr]); }
    const deep = [0.1, 0.26, 0.3], midC = [0.17, 0.36, 0.37], shal = [0.3, 0.44, 0.36], wy = y + 0.06, ring = (p, f) => [x + (p[0] - x) * f, wy, z + (p[1] - z) * f];
    for (let k = 0; k < n; k++) { const p = pts[k], q = pts[(k + 1) % n], a1 = ring(p, 0.55), b1 = ring(q, 0.55), a2 = ring(p, 1), b2 = ring(q, 1);
      B.tri('pondWater', [x, wy, z], b1, a1, { colors: [deep, midC, midC] });
      B.tri('pondWater', a1, b1, b2, { colors: [midC, midC, shal] }); B.tri('pondWater', a1, b2, a2, { colors: [midC, shal, shal] });
      B.beam('stone', [p[0], gy(p[0], p[1]) - 0.1, p[1]], [q[0], gy(q[0], q[1]) - 0.1, q[1]], 0.55, 0.32, { color: [0.62, 0.6, 0.56] }); }
    paint(2, x - a - 2, z - b - 2, x + a + 2, z + b + 2, (px, pz) => ((px - x) / (a + 0.8)) ** 2 + ((pz - z) / (b + 0.8)) ** 2 < 1 ? 1 : 0);
    for (let k = 0; k < 8; k++) { const t = rng() * Math.PI * 2; out.bushes.push({ x: x + Math.cos(t) * (a + 1.2), y: y - 0.05, z: z + Math.sin(t) * (b + 1.2), s: 0.7 + rng() * 0.4, sx: 1, r: rng() * 6, c: new THREE.Color().setHSL(0.27, 0.45, 0.3) }); }
    occRect(x, z, a, b, 0, 1); addCircle(x, z, Math.min(a, b)); }
  function toilet(x, z, yaw) { const y = gy(x, z); B.frame(x, y, z, yaw);
    B.bbox('concrete', 0, -0.2, 0, 5.2, 0.3, 3.4, 0.02, { color: [0.7, 0.7, 0.68] }); B.bbox('tiles', 0, 0.1, 0, 4.8, 2.8, 3.0, 0.02, { color: [0.78, 0.7, 0.62], uv: 2 });
    B.bbox('roofMetal', 0, 2.9, 0, 5.6, 0.18, 3.8, 0.02, { color: [0.36, 0.42, 0.46] });
    for (const sx of [-1.3, 1.3]) { B.quad('dark', [sx - 0.5, 0.15, 1.51], [sx + 0.5, 0.15, 1.51], [sx + 0.5, 2.2, 1.51], [sx - 0.5, 2.2, 1.51], { color: [0.15, 0.15, 0.15] }); }
    B.box('lamp', 0, 2.6, 1.55, 0.4, 0.1, 0.06); B.frame(0, 0, 0, 0); addBox(x, z, 2.5, 1.6, yaw); occRect(x, z, 3.2, 2.4, yaw, 1); lampPoints.push({ p: B.frame(x, y, z, yaw).P([0, 2.5, 1.8]), s: 0.4 }); B.frame(0, 0, 0, 0); }
  B.frame(0, 0, 0, 0);
  out.buildings = blds;
  return out;
}
