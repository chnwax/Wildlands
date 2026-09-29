// "Sakuragawa" — a small Japanese town in a valley: station and level crossings, commuter trains, traffic,
// houses and shops, utility poles, a river with concrete banks, rice paddies and cedar-covered hills.
import { THREE, scene, Q, S, clamp, lerp, smoothstep, mulberry32, tick, fbm, erosion, loadTex, phTex, NFLAT, loadModel, extractParts, normalizeParts,
  Scatter, addBox, addCircle, addPlatform, colliders, decimate } from './core.js';
import { Heightfield, terrainMaterial, buildTerrainMeshes, buildGrass, buildWater, farForestAt } from './terrain.js';
import { buildTrees, buildBushes, buildLogs, sakuraColor, bushColor, hydraColor, leafColor } from './trees.js';
import { plantForest, forestFloor, moistureField, makeTree } from './ecology.js';
import { plantTown } from './towngreen.js';
import { nobori, standBoard, postBox, busStop, garbagePoint, dryingRack, mailbox, crosswalk, playground, school, pedestrians, constructionSite, streetShrine, chainMaterial, tennisCourts } from './towndeco.js';
import { GeoBuilder as LGeo, lantern, bench, flushLandmarks } from './landmarks.js';
import { house, shopBuilding, konbini, apartment, warehouse, carPark, allotment, greenhouse, inFrame, shedRoof } from './building.js';
import { shrineCompound, sacredRope } from './shrine.js';
import { stationForecourt } from './station.js';
import { GeoBuilder, materials, night, updateNight, updateGlow, updateLod, utilityPole, wires, wireMat, curveMirror, roadSign,
  vendingMachine, stopMat, lampPoints, signalMast, signalLampMaterial, signMesh, JP_FONT, bicycles, clockPole, chochin } from './townkit.js';
import { RAIL, buildRailway, railFences, buildCrossing, updateCrossings, crossings, crossingActive, Train, tunnelPortal } from './rail.js';
import { Fleet, Traffic, Route, randomCar, carDims } from './traffic.js';
import { planRoads } from './roads.js';

export const meta = { name: 'Sakuragawa 桜川', startHour: 16.6, sunAzimuth: 2.6 };
const Y0 = 6;
const riverX = z => 215 + 22 * Math.sin(z * 0.0075) + 8 * Math.sin(z * 0.021 + 1);
const PADDIES = [[-650, -330, -430, -110], [-650, -40, -430, 330], [262, 0, 650, 330], [262, -330, 650, -100]];
const inPaddyZone = (x, z) => PADDIES.some(([a, b, c, d]) => x > a && x < c && z > b && z < d);
const SHRINE = { x: -60, z: -300 };
const XINGS = [[110, 5.2], [-150, 2.7], [-400, 2.7]]; // level crossings: road centre x, half width incl. footways
const LEVEL = [[-147, 190, -32.5, 256]]; // school block
const RIVER_STAIRS = [[-170, 1], [-150, -1], [95, -1], [130, 1], [270, -1]]; // [z where the stair starts, bank side]
const SHRINE_M = { lac: 'plastic', dark: 'plastic', wood: 'wood', stone: 'concrete', roof: 'roofMetal', glow: 'lamp', paper: 'plain', rope: 'plain', metal: 'steel', water: 'glass' };

function paddyCell(x, z) { // returns {inside (0..1), levee} for the paddy grid
  const cx = ((x % 30) + 30) % 30, cz = ((z % 20) + 20) % 20;
  const e = Math.min(cx, 30 - cx, cz, 20 - cz);
  return e;
}
// the valley and its ring of hills, before any earthworks; far out, higher mountain ranges rise behind the hills so the
// horizon shows layered ridgelines (snow on the highest peaks)
function hills(x, z) {
  const ex = x / 720, ez = (z + 10) / 440, ve = Math.hypot(ex, ez);
  const hn = fbm(x * 0.004 + 7, z * 0.004 - 2, 5), ridge = erosion(x * 0.0021 + 5, z * 0.0021 - 3) * 0.5 + 0.5;
  const hill = smoothstep(0.8, 1.55, ve + hn * 0.12);
  let h = Y0 + fbm(x * 0.01, z * 0.01, 3) * 0.2 * (1 - hill) + hill * hill * (30 + ridge * ridge * 210 + hn * 30);
  const far = smoothstep(1350, 4600, Math.hypot(x, z * 1.2));
  if (far > 0) { const r = erosion(x * 0.00045 + 2.1, z * 0.00045 - 7.3, 6) * 0.5 + 0.5; h += far * (70 + r * r * 980 + ridge * 90); }
  return h;
}
// the main road climbs gently out of the valley; railway and road reach the hills in open cuttings and then bore into
// them through tunnels sited where the ground first stands 10.5 m above the formation, so no slot is carved through
// the mountains and the ridgelines stay whole (the ground over each bore is kept at least 12 m above the formation)
export const roadGrade = x => Y0 + Math.max(0, Math.abs(x) - 640) * 0.035;
function portalAt(z, sx, level) { for (let x = 450; x < 1000; x++) if (hills(sx * x, z) - level(x) >= 12) return x; return 1000; }
export const PORTALS = { railW: portalAt(-80, -1, () => Y0), railE: portalAt(-80, 1, () => Y0), roadW: portalAt(-25, -1, roadGrade), roadE: portalAt(-25, 1, roadGrade) };
RAIL.portalW = PORTALS.railW; RAIL.portalE = PORTALS.railE; RAIL.portal = Math.max(PORTALS.railW, PORTALS.railE);
// earthworks: a level formation `hw` wide, grassed banks at about 1:1.5 either side, back to the natural ground
const earthwork = (h, level, dz, hw) => { const bank = Math.max(0, dz - hw) * 0.68; return clamp(h, level - bank, level + bank); };
// smooth minimum (k = blend width in metres)
const smin = (a, b, k) => { if (k <= 0) return Math.min(a, b); const t = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - t * t * k * 0.25; };
function baseHeight(x, z) {
  let h = hills(x, z);
  const ax = Math.abs(x), pr = x < 0 ? PORTALS.railW : PORTALS.railE, pd = x < 0 ? PORTALS.roadW : PORTALS.roadE;
  // the cut runs one heightfield cell on into the portal under the arch itself, so the bore's floor is open ground
  const bore = (P, dz, hw) => ax < Math.ceil(P / 2) * 2 + 0.5 && dz < hw;
  if (ax < pr || bore(pr, Math.abs(z + 80), 6.6)) h = earthwork(h, Y0, Math.abs(z + 80), 7.4);
  else if (ax < pr + 170) h = Math.max(h, Y0 + 12 + (ax - pr) * 0.04 - Math.max(0, Math.abs(z + 80) - 10) * 0.6); // cover over the bore
  if (ax < pd || bore(pd, Math.abs(z + 25), 7.6)) h = earthwork(h, roadGrade(x), Math.abs(z + 25), 8.6);
  else if (ax < pd + 190) h = Math.max(h, roadGrade(x) + 12 + (ax - pd) * 0.04 - Math.max(0, Math.abs(z + 25) - 11) * 0.6);
  // level crossings: the roads ramp up over ~10 m onto the deck at rail-top level, on a small embankment
  for (const [cx, hwx] of XINGS) {
    const dx = Math.abs(x - cx) - hwx, dz = Math.abs(z + 80);
    if (dx < 4 && dz < 18 && dz > 6.6) h = lerp(h, Math.max(h, Y0 + 0.4 * smoothstep(17, 6.6, dz)), smoothstep(4, 0, Math.max(dx, 0)));
  }
  // shrine terrace
  h = lerp(h, Y0 + 0.4, smoothstep(34, 24, Math.hypot(x - SHRINE.x, z - SHRINE.z + 10)));
  // levelled grounds (the school yard): exactly at the valley floor, blending out over 6 m
  for (const [x0, z0, x1, z1] of LEVEL) { const d = Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(z0 - z, 0, z - z1)); if (d < 6) h = lerp(h, Y0, smoothstep(6, 0, d)); }
  // the river runs down a broad valley: flat floor, then walls of ~24 degrees meeting the hills in a soft crease
  const rd = Math.abs(x - riverX(z)), wall = Y0 + Math.max(0, rd - 30) * 0.45;
  h = smin(h, wall, Math.min(14, (wall - Y0) * 0.6));
  h = lerp(h, Y0, smoothstep(60, 30, rd));
  // channel: bed, then a sloped concrete revetment from rd 12.2 (y 0.45) up to the walkway at rd 14.6; the ground
  // stays 1.3 m under the revetment slab (so the 2 m heightfield never pokes through it) and is level again under the
  // walkway deck, well before the lanes along the banks
  if (rd < 17) {
    const bed = rd < 5 ? -1.3 : rd < 12.2 ? lerp(-1.3, 0.45, (rd - 5) / 7.2) : 0.45;
    const rev = 0.45 + (rd - 12.2) / 2.4 * (Y0 - 0.3);
    h = rd < 12.2 ? bed : Math.min(h, Math.max(0.45, rev - 1.3));
  }
  return h;
}
// rice paddies are only laid out where the valley floor is flat: a cell whose natural ground rises more than ~1 m stays
// meadow, so paddies end where the hills begin instead of being cut into them behind a wall
const paddyCache = new Map();
function paddyOK(x, z) {
  const cx = Math.floor(x / 30) * 30, cz = Math.floor(z / 20) * 20, k = cx * 100003 + cz;
  let v = paddyCache.get(k);
  if (v === undefined) {
    v = inPaddyZone(cx + 15, cz + 10) && Math.abs(cx + 15 - riverX(cz + 10)) >= 30;
    for (const [px, pz] of [[0, 0], [30, 0], [0, 20], [30, 20], [15, 10]]) if (!v || !inPaddyZone(cx + Math.min(px, 29.9), cz + Math.min(pz, 19.9)) || baseHeight(cx + px, cz + pz) > Y0 + 0.9) v = false;
    paddyCache.set(k, v);
  }
  return v;
}
function height(x, z) {
  let h = baseHeight(x, z);
  // rice paddies: flat terraces with levees (farm roads then ride across them on their graded embankment)
  if (inPaddyZone(x, z) && paddyOK(x, z)) { const e = paddyCell(x, z); h = Y0 - (e > 1.2 ? 0.35 : 0.05); }
  return graded(x, z, h);
}

// ---------------------------------------------------------------- road network
// kind: main > road > lane > path ; w = carriageway width
const ROADS = [
  { id: 'A', kind: 'main', w: 7.0, walk: 2.5, center: 'yellow', pts: [[-PORTALS.roadW - 30, -25], [PORTALS.roadE + 30, -25]], mat: 'asphalt' },
  { id: 'B', kind: 'road', w: 6.0, walk: 2.0, center: 'white', pts: [[110, -340], [110, 330]], mat: 'asphalt' },
  { id: 'C', kind: 'lane', w: 5.0, pts: [[-150, -300], [-150, 300]], mat: 'asphalt', age: 0.55 },
  { id: 'D', kind: 'lane', w: 5.0, pts: [[-400, -312], [-400, 322]], mat: 'asphalt', age: 0.8 },
  // residential lanes: the ones the bus loops use run straight; the others bend gently with the old field boundaries
  ...[48, 118, 188, 258].map((z, i) => ({ id: 'S' + i, kind: 'lane', w: 4.2, mat: 'asphalt', age: [0.62, 0.85, 0.3, 0.5][i],
    pts: i === 1 ? [[-400, 118], [-340, 121], [-275, 116], [-210, 120], [-150, 118], [-95, 116], [-30, 118], [40, 121], [110, 118]] : [[-400, z], [110, z]] })),
  { id: 'N0', kind: 'lane', w: 4.2, mat: 'asphalt', age: 0.9, pts: [[-400, -150], [-330, -147], [-240, -153], [-150, -150], [-80, -146], [-30, -150], [40, -154], [110, -150]] },
  { id: 'N1', kind: 'lane', w: 4.2, mat: 'asphalt', age: 0.7, pts: [[-400, -225], [110, -225]] },
  { id: 'V0', kind: 'lane', w: 4.0, mat: 'asphalt', age: 0.78, pts: [[-275, -25], [-278, 20], [-273, 85], [-277, 150], [-274, 210], [-275, 258]] },
  { id: 'V1', kind: 'lane', w: 4.0, mat: 'asphalt', age: 0.45, pts: [[-30, -25], [-30, 258]] },
  { id: 'W0', kind: 'lane', w: 4.0, mat: 'asphalt', age: 0.92, pts: [[-275, -100], [-278, -130], [-274, -170], [-275, -225]] },
  { id: 'W1', kind: 'lane', w: 4.0, mat: 'asphalt', age: 0.66, pts: [[-30, -100], [-33, -125], [-29, -175], [-30, -225]] },
  // narrow unmarked dead-end alleys (roji) into the blocks
  { id: 'Y1', kind: 'lane', w: 3.2, noMarks: true, mat: 'asphalt', age: 0.97, pts: [[-210, -150], [-212, -170], [-209, -190]] },
  { id: 'Y3', kind: 'lane', w: 3.2, noMarks: true, mat: 'asphalt', age: 0.93, pts: [[40, -225], [42, -245], [39, -262]] },
  { id: 'F', kind: 'lane', w: 4.0, pts: [[110, 200], [640, 200]], mat: 'asphalt', age: 0.95 }, // service road out to the yards
  { id: 'R', kind: 'lane', w: 4.5, pts: Array.from({ length: 34 }, (_, i) => { const z = -335 + i * 20; return [riverX(z) - 21, z]; }), mat: 'asphalt', age: 0.6 },
  { id: 'P', kind: 'path', w: 3.0, pts: [[SHRINE.x, -225], [SHRINE.x, SHRINE.z + 4]], mat: 'gravelPath' },
  // the blocks are subdivided the way the town actually grew: mid-block lanes that wander with the old plot lines, dead-end
  // roji off the through roads, short cross lanes that stop the grid from lining up, a rear lane along the railway, and
  // the old highway (旧街道) cutting diagonally through the old quarter
  ...[
    // service lanes behind the shopping street, between the shops' backs and the railway fence
    // lanes that cross a through road are one continuous road (a four-way junction, never two T-junctions a metre apart)
    ['Q0a', 3.4, true, 0.85, [[-262, -54], [-240, -53], [-200, -55], [-150, -55], [-110, -54], [-72, -56], [-40, -55]]],
    ['Q0b', 3.4, true, 0.8, [[110, -56], [80, -55], [50, -56]]],
    ['M0', 3.6, true, 0.8, [[-277, 22], [-236, 18], [-196, 14], [-150, 12], [-108, 10], [-66, 13], [-30, 13], [20, 13], [60, 16], [110, 14]]],
    ['M1', 3.6, true, 0.88, [[-400, 84], [-362, 82], [-318, 86], [-275, 84]]],
    ['M2', 3.2, true, 0.93, [[-246, 118], [-248, 103], [-245, 91]]],
    ['M3', 3.8, false, 0.7, [[-150, 87], [-112, 85], [-70, 88], [-30, 86], [-4, 82], [14, 80]]],
    ['M4', 3.4, true, 0.8, [[110, 84], [78, 85], [50, 83]]],
    ['M5', 3.6, true, 0.85, [[-338, 118], [-336, 152], [-339, 188]]],
    ['M6', 3.8, false, 0.6, [[-275, 155], [-236, 153], [-196, 156], [-150, 154]]],
    ['M7', 3.2, true, 0.75, [[-30, 161], [-62, 162], [-88, 160], [-89, 172], [-90, 188]]], // from lane V1 round the apartment to S2
    ['M8', 3.6, true, 0.55, [[40, 118], [42, 152], [39, 188]]],
    ['M9', 3.6, true, 0.82, [[-400, 222], [-356, 224], [-316, 221], [-275, 223]]],
    ['M10', 3.2, true, 0.7, [[-212, 258], [-210, 238], [-213, 219]]],
    ['M11', 3.8, false, 0.45, [[-30, 221], [16, 224], [62, 220], [110, 222]]],
    ['Q1', 3.4, true, 0.88, [[-400, -104], [-356, -101], [-316, -105], [-275, -103], [-232, -106], [-190, -102], [-150, -104], [-110, -101], [-66, -105], [-30, -103], [14, -106], [60, -102], [110, -104]]],
    ['M12', 3.6, true, 0.92, [[-400, -186], [-356, -189], [-316, -185], [-275, -188]]],
    ['M13', 3.8, false, 0.8, [[-150, -188], [-104, -185], [-62, -189], [-30, -187]]],
    ['M14', 3.6, true, 0.75, [[62, -150], [64, -188], [60, -225]]],
    ['O1', 4.2, false, 0.92, [[-250, -25], [-252, -10], [-268, 2], [-290, 12], [-318, 28], [-336, 38], [-342, 48]]], // leaves the main road square
  ].map(([id, w, alley, age, pts]) => ({ id, kind: 'lane', w, noMarks: alley, mat: 'asphalt', age, pts })),
];
const RANK = { main: 3, road: 2, lane: 1, path: 0 };
// a lane that ends at another road is snapped onto that road's centreline, so the junction is found and built as a
// clean T (an end that stops a metre short or runs a metre past leaves overlapping asphalt and broken kerbs)
for (const R of ROADS) {
  if (R.kind === 'main' || R.kind === 'path') continue;
  for (const end of [0, R.pts.length - 1]) {
    const p = R.pts[end]; let best = null;
    for (const O of ROADS) { if (O === R || O.kind === 'path') continue;
      for (let i = 0; i + 1 < O.pts.length; i++) { const a = O.pts[i], b = O.pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
        const t = clamp((p[0] - a[0]) * dx + (p[1] - a[1]) * dz, 0, L), q = [a[0] + dx * t, a[1] + dz * t], d = Math.hypot(p[0] - q[0], p[1] - q[1]);
        const atEnd = (i === 0 && t < 0.5) || (i + 2 === O.pts.length && t > L - 0.5); // end to end: not a junction
        if (d < 6 && !atEnd && (!best || d < best.d)) best = { d, q }; } }
    if (best && best.d > 1e-3) R.pts[end] = best.q;
  }
}
// streets that stop at the edge of town carry on as gravel farm tracks (農道) out into the fields and up to the woods,
// instead of ending in an asphalt cliff at the meadow
for (const R of ROADS.slice()) {
  if (R.kind === 'path' || R.kind === 'main' || R.noMarks) continue;
  for (const end of [0, R.pts.length - 1]) {
    const p = R.pts[end], q = R.pts[end === 0 ? 1 : end - 1], L = Math.hypot(p[0] - q[0], p[1] - q[1]), d = [(p[0] - q[0]) / L, (p[1] - q[1]) / L];
    const joined = ROADS.some(O => O !== R && O.pts.some((v, i) => i + 1 < O.pts.length && (() => { const a = v, b = O.pts[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]), t = clamp(((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (l * l), 0, 1);
      return Math.hypot(p[0] - a[0] - (b[0] - a[0]) * t, p[1] - a[1] - (b[1] - a[1]) * t) < 3; })()));
    if (joined) continue;
    const pts = [p.slice()];
    for (let k = 1; k <= 8; k++) { const x = p[0] + d[0] * k * 10 + Math.sin(k * 0.9 + p[0]) * 1.2 * (k > 2), z = p[1] + d[1] * k * 10 + Math.cos(k * 0.7 + p[1]) * 1.2 * (k > 2);
      if (baseHeight(x, z) > Y0 + 6 || Math.abs(x) > 980 || Math.abs(z) > 980) break; pts.push([x, z]); }
    if (pts.length > 2) ROADS.push({ id: R.id + (end ? 'x' : 'w'), kind: 'path', w: 2.8, pts, mat: 'gravelPath', track: true });
  }
}

function segInter(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]], den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den, u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  if (t < -0.02 || t > 1.02 || u < -0.02 || u > 1.02) return null;
  return [a[0] + r[0] * t, a[1] + r[1] * t];
}
function roadSegs(R) { const out = []; for (let i = 0; i + 1 < R.pts.length; i++) out.push([R.pts[i], R.pts[i + 1]]); return out; }

// Road grading: every road gets a designed longitudinal profile — the natural ground low-passed over ±14 m (farm roads
// across the paddies ride on a low embankment at levee height) — and the ground is cut / filled to it across the
// corridor, feathering out over 3.5 m. Roads, kerbs and the houses beside them then sit on clean, even grades instead
// of copying every hummock of the valley floor. Bridges, the channel and the tunnel approaches keep their own levels.
let GRADE = null;
function buildGrades() {
  const segs = [], grid = new Map(), CS = 16, key = (i, j) => i * 100003 + j;
  for (const R of ROADS) {
    if (R.kind === 'path') continue;
    const S = [], H = [];
    let s0 = 0;
    for (const [a, b] of roadSegs(R)) {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let t = 0; t < L; t += 2) {
        const x = a[0] + (b[0] - a[0]) * t / L, z = a[1] + (b[1] - a[1]) * t / L;
        let h = baseHeight(x, z);
        if (inPaddyZone(x, z)) h = Math.max(h, Y0 + 0.02);
        if (Math.abs(x - riverX(z)) < 24) h = Y0;                                        // bridge approaches stay level
        S.push(s0 + t); H.push(h);
      }
      s0 += L;
    }
    const n = S.length, pre = new Float64Array(n + 1); for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + H[i];
    const G = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const lo = Math.max(0, i - 7), hi = Math.min(n - 1, i + 7); G[i] = (pre[hi + 1] - pre[lo]) / (hi - lo + 1);
    }
    let sAcc = 0;
    for (const [a, b] of roadSegs(R)) {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]), seg = { R, a, b, L, d: [(b[0] - a[0]) / L, (b[1] - a[1]) / L], s0: sAcc, S, G, C: R.w / 2 + (R.walk || 0) + 0.8 };
      segs.push(seg); sAcc += L;
      const e = seg.C + 3.6;
      for (let i = Math.floor((Math.min(a[0], b[0]) - e) / CS); i <= Math.floor((Math.max(a[0], b[0]) + e) / CS); i++)
        for (let j = Math.floor((Math.min(a[1], b[1]) - e) / CS); j <= Math.floor((Math.max(a[1], b[1]) + e) / CS); j++) { const k = key(i, j); let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(seg); }
    }
  }
  GRADE = { grid, CS, key };
}
function graded(x, z, h) {
  if (Math.abs(x) > 1150 || Math.abs(z) > 420) return h;
  if (!GRADE) buildGrades();
  const list = GRADE.grid.get(GRADE.key(Math.floor(x / GRADE.CS), Math.floor(z / GRADE.CS))); if (!list) return h;
  if (Math.abs(x - riverX(z)) < 24 || Math.abs(z + 80) < 17) return h;                 // channel and bridge ramps, rail formation + crossing ramps
  let best = 0, gh = 0;
  for (const g of list) {
    const t = clamp((x - g.a[0]) * g.d[0] + (z - g.a[1]) * g.d[1], 0, g.L), d = Math.hypot(x - g.a[0] - g.d[0] * t, z - g.a[1] - g.d[1] * t);
    const w = smoothstep(g.C + 3.5, g.C, d); if (w <= best) continue;
    const s = g.s0 + t, i = clamp(Math.floor(s / 2), 0, g.S.length - 2), f = clamp((s - g.S[i]) / 2, 0, 1);
    best = w; gh = lerp(g.G[i], g.G[i + 1], f);
  }
  if (Math.abs(x) > 600 && Math.abs(z + 25) < 12) best *= 1 - smoothstep(600, 640, Math.abs(x)); // tunnel approach keeps its grade
  best *= smoothstep(17, 22, Math.abs(z + 80)) * smoothstep(24, 29, Math.abs(x - riverX(z)));
  return best > 0 ? lerp(h, gh, best) : h;
}
function nearestOnRoad(R, x, z) {
  let best = { d: 1e9 };
  for (const [a, b] of roadSegs(R)) {
    const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz, t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / L2, 0, 1);
    const px = a[0] + dx * t, pz = a[1] + dz * t, d = Math.hypot(x - px, z - pz);
    if (d < best.d) best = { d, px, pz, dx: dx / Math.sqrt(L2), dz: dz / Math.sqrt(L2) };
  }
  return best;
}

export async function build(progress) {
  const reflected = new Set(scene.children); // sky, clouds, lights... (terrain + forest are added below)
  const MT = materials();
  MT.paddyWater = new THREE.MeshStandardMaterial({ color: 0x3b3a2a, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.72, depthWrite: false, envMapIntensity: 1.3 });

  const hf = new Heightfield({ world: 2048, grid: 1024, height });
  const { HN, HALF, CELL } = hf;
  const layers = {
    grass: { d: phTex('aerial_grass_rock', 'diff', '2k', true), n: phTex('aerial_grass_rock', 'nor_gl', '2k', false, NFLAT), s: 6, tint: [0.95, 1.1, 0.8] },
    forest: { d: phTex('forest_leaves_03', 'diff', '2k', true), n: phTex('forest_leaves_03', 'nor_gl', '1k', false, NFLAT), s: 3 },
    rock: { d: phTex('rock_face_03', 'diff', '2k', true), n: phTex('rock_face_03', 'nor_gl', '2k', false, NFLAT), s: 9 },
    shore: { d: phTex('brown_mud', 'diff', '1k', true), n: phTex('brown_mud', 'nor_gl', '1k', false, NFLAT), s: 3, tint: [0.85, 0.82, 0.78] },
    urban: { d: phTex('bicolour_gravel', 'diff', '1k', true), n: phTex('bicolour_gravel', 'nor_gl', '1k', false, NFLAT), s: 2.5, tint: [1.1, 1.03, 0.9], norm: 0.44 },
  };
  const modelsP = Promise.all(['shrub_02', 'potted_plant_04', 'planter_box_01', 'plastic_crate_01', 'utility_box_02', 'weed_plant_02', 'water_manhole_cover'].map(loadModel));
  await hf.generate(p => progress('Shaping the valley', p * 0.3));

  // ---------------------------------------------------------------- occupancy grid (1 m) for lots
  const OG = 1600, occ = new Uint8Array(OG * OG), oi = (x, z) => (Math.floor(z) + 800) * OG + (Math.floor(x) + 800);
  const occRect = (cx, cz, hw, hd, r, val, test) => {
    const c = Math.cos(r), s = Math.sin(r), R = Math.hypot(hw, hd);
    for (let z = Math.floor(cz - R); z <= cz + R; z++) for (let x = Math.floor(cx - R); x <= cx + R; x++) {
      const dx = x + 0.5 - cx, dz = z + 0.5 - cz, lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) > hw || Math.abs(lz) > hd) continue;
      if (x < -800 || z < -800 || x >= 800 || z >= 800) { if (test) return true; continue; }
      if (test) { if (occ[oi(x, z)]) return true; } else occ[oi(x, z)] = val;
    }
    return false;
  };
  // road base height: the ground (+5 cm), the tunnel approaches' grade, and the bridge decks with a 5 m ramp onto them
  const roadY = (x, z) => {
    const rd = Math.abs(x - riverX(z));
    if (rd < 17) return Y0 + 0.35;
    if (Math.abs(z + 25) < 6.5 && Math.abs(x) > 600) return roadGrade(x) + 0.05;
    const g = hf.groundAt(x, z) + 0.05;
    return rd < 22 && (Math.abs(z + 25) < 9 || Math.abs(z - 200) < 5) ? lerp(g, Y0 + 0.35, smoothstep(22, 17, rd)) : g;
  };

  // ---------------------------------------------------------------- roads, markings, intersections (roads.js)
  const B = new GeoBuilder(192);
  const onRail = z => Math.abs(z + 80) < 6.6;
  const onBridge = (x, z) => Math.abs(x - riverX(z)) < 17;
  const RN = planRoads(ROADS, { baseY: roadY, skip: (x, z, R) => onRail(z) && R.kind !== 'path', inBounds: (x, z) => Math.abs(x) < 900 && Math.abs(z) < 700, noEdge: (x, z, R) => onBridge(x, z) && !R.walk });
  const inters = RN.inters, surfaceY = RN.surfaceY;
  const topY = (x, z) => RN.topY(x, z, (a, b) => hf.groundAt(a, b));
  const nearInter = (x, z, R, pad = 1.2) => inters.some(I => I.roads.includes(R) && (() => { const o = I.roads[0] === R ? I.roads[1] : I.roads[0]; return Math.hypot(x - I.p[0], z - I.p[1]) < o.w / 2 + (o.walk || 0) + pad; })());
  const sOf = (id, x, z) => { const n = RN.byId.get(id); let best = null; for (const g of n.PL.segs) { const t = clamp((x - g.a[0]) * g.d[0] + (z - g.a[1]) * g.d[1], 0, g.L), d = Math.hypot(x - g.a[0] - g.d[0] * t, z - g.a[1] - g.d[1] * t); if (!best || d < best.d) best = { d, s: g.s0 + t }; } return best.s; };
  // zebra crossings on every arm of the main road and road B at their junctions, just past the curb returns;
  // stop lines on the minor approaches (behind the crossing where there is one)
  const zebras = [], stops = [];
  const isSignal = I => I.roads.some(R => R.id === 'A') && I.roads.some(R => R.id === 'B'); // the one signalised junction
  for (const I of inters) {
    const [r1, r2] = I.roads;
    const [major, minor] = RN.RANK[r1.kind] >= RN.RANK[r2.kind] ? [r1, r2] : [r2, r1];
    if (minor.kind === 'path' || onBridge(I.p[0], I.p[1])) continue;
    const band = 4;
    for (const arm of I.arms) {
      const R = arm.n.R, other = arm.n.R === r1 ? r2 : r1;
      const hasX = (R.id === 'A' || R.id === 'B') && Math.abs(I.p[0]) < 460 && Math.abs(I.p[1]) < 340 && !other.noMarks; // no zebras across alley mouths
      const d = other.w / 2 + I.rF + 0.4 + band / 2;
      const cq = RN.sampleAt(arm.n, clamp(arm.s + arm.dir * d, 0, arm.n.PL.len));
      if (hasX && !onBridge(cq.x, cq.z)) zebras.push({ id: R.id, s: arm.s + arm.dir * d, band, I }); else if (hasX) continue;
      if (isSignal(I)) { // every approach stops at its line on red
        const ss = arm.s + arm.dir * (d + band / 2 + 1.2); if (ss < 1 || ss > arm.n.PL.len - 1) continue;
        stops.push({ id: R.id, s: ss, dir: -arm.dir, arm, sign: false, legend: false, signal: R.id });
      } else if (R === minor || R.kind === major.kind && R === r2 && R.kind === 'lane') {
        const ds = hasX ? d + band / 2 + 1.2 : arm.L + 0.3;
        const ss = arm.s + arm.dir * ds; if (ss < 1 || ss > arm.n.PL.len - 1) continue;
        stops.push({ id: R.id, s: ss, dir: -arm.dir, arm, sign: true });
      }
    }
  }
  { // one crossing per approach: drop zebras that fall inside another junction's mouth or crowd one already kept
    const kept = [], rank = zb => (isSignal(zb.I) ? 10 : 0) + Math.max(...zb.I.roads.map(R => RN.RANK[R.kind]));
    zebras.sort((a, b) => rank(b) - rank(a)); // the signalised junction's crossings first, then the busier junctions
    for (const zb of zebras) {
      const n = RN.byId.get(zb.id);
      const inOther = inters.some(I => I !== zb.I && I.nets.includes(n) && (() => { const k = I.nets.indexOf(n); const cl = n.clips[k] ; void cl; const sj = I.s[k], o = I.nets[1 - k]; return Math.abs(zb.s - sj) < o.hw + o.walk + I.rF + zb.band / 2 + 0.5; })());
      if (inOther || kept.some(q => q.id === zb.id && Math.abs(q.s - zb.s) < 28)) continue; // crossings at least ~30 m apart
      kept.push(zb);
    }
    zebras.length = 0; zebras.push(...kept);
  }
  RN.build(B, { crossings: zebras });
  // occupancy + masks along every road (lots keep off the carriageway and sidewalks; no grass pokes through)
  for (const R of ROADS) {
    const hw = R.w / 2;
    for (const [a, b] of roadSegs(R)) {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]), dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
      for (let t = 0; t <= L; t += 1) {
        const x = a[0] + dx * t, z = a[1] + dz * t;
        if (Math.abs(x) > 800 || Math.abs(z) > 800) continue;
        occRect(x, z, hw + (R.walk ? R.walk + 0.05 : 0.45), 1, Math.atan2(dx, dz), 1); // footways have a hard edge; lanes keep their L-gutter
      }
      const ext = hw + (R.walk || 0) + (R.kind === 'lane' ? 0.5 : 0) + 0.6;
      hf.paint2(2, Math.min(a[0], b[0]) - ext, Math.min(a[1], b[1]) - ext, Math.max(a[0], b[0]) + ext, Math.max(a[1], b[1]) + ext, (x, z) => { const q = nearestOnRoad({ pts: [a, b] }, x, z); return q.d < ext ? 1 : 0; });
      hf.paint2(0, Math.min(a[0], b[0]) - ext - 2, Math.min(a[1], b[1]) - ext - 2, Math.max(a[0], b[0]) + ext + 2, Math.max(a[1], b[1]) + ext + 2, (x, z) => { const q = nearestOnRoad({ pts: [a, b] }, x, z); return q.d < ext + 1.5 ? 0.8 : 0; });
    }
  }
  for (const I of inters) for (const cr of I.corners) hf.paint2(2, cr.O[0] - cr.rF, cr.O[1] - cr.rF, cr.O[0] + cr.rF, cr.O[1] + cr.rF, () => 1);
  progress('Laying roads', 0.36); await tick();
  // railway and main road leave the valley through tunnels at both ends. Each headwall sits between the last cut
  // heightfield vertex and the first natural one, so it hides the step between them
  for (const sx of [-1, 1]) for (const [zc, P, level, o] of [[-80, sx < 0 ? PORTALS.railW : PORTALS.railE, () => Y0, { archW: 11, archH: 9.5, dzMax: 26 }],
    [-25, sx < 0 ? PORTALS.roadW : PORTALS.roadE, roadGrade, { archW: 13, archH: 8.5, dzMin: -26 }]]) {
    const xNat = sx * Math.ceil(P / hf.CELL) * hf.CELL, xCut = xNat - sx * hf.CELL, xHill = xNat + sx * hf.CELL, y = level(Math.abs(xCut));
    tunnelPortal(MT, { xFace: xCut, xBack: xHill, y, z: zc, sx, ...o, capAt: hf.CELL, top: dz => height(xHill, zc + dz) - y, bottom: dz => height(xCut, zc + dz) - y,
      cutDepth: dz => hills(xCut, zc + dz) - height(xCut, zc + dz) });
    addBox(xCut + sx * 1.0, zc, 1.0, o.archW / 2 + 1, 0); // nobody walks into the tunnel
  }

  // stop lines + 止まれ + stop signs on the minor approaches, and before level crossings (sign on the driver's left)
  const stopSpots = []; // {x, z, hx, hz} approach heading
  const addStop = (id, s, dir, sign, legend = true, signal = null) => {
    RN.stop(B, id, s, dir, { legend });
    const n = RN.byId.get(id), q = RN.sampleAt(n, s), hx = q.d[0] * dir, hz = q.d[1] * dir;
    if (sign) { const off = n.hw + (n.walk ? n.walk - 0.45 : 0.75), x = q.x + hz * off, z = q.z - hx * off; roadSign(B, x, topY(x, z), z, Math.atan2(-hx, -hz), 'stop'); }
    stopSpots.push({ x: q.x, z: q.z, hx, hz, signal });
  };
  for (const st of stops) addStop(st.id, st.s, st.dir, st.sign, st.legend ?? true, st.signal ?? null);
  // traffic signals at A x B: a mast on the far-left corner of every approach (arm over the approach lane), pedestrian
  // heads facing across both crosswalks at each corner. 36 s cycle: A green 16 s, amber 3, all-red 1, B green 12, amber 3, all-red 1
  const signals = { t: 0, lamps: [], mats: {} };
  {
    const I = inters.find(isSignal), mat = (g, k) => signals.mats[g + k] || (signals.mats[g + k] = signalLampMaterial(k));
    const disc = new THREE.CircleGeometry(0.13, 20), sq = new THREE.PlaneGeometry(0.28, 0.28);
    if (I) for (const arm of I.arms) {
      const n = arm.n, other = I.nets.find(o => o !== n), h = [-arm.d[0], -arm.d[1]], L = [h[1], -h[0]];
      const rF = I.rF, oh = other.hw + rF, ol = n.hw + rF, k = (rF - 0.6) / Math.SQRT2;
      const ph = oh - k, pl = ol - k, x = I.p[0] + h[0] * ph + L[0] * pl, z = I.p[1] + h[1] * ph + L[1] * pl;
      const g = n.R.id, og = other.R.id;
      const out = signalMast(B, x, topY(x, z), z, Math.atan2(-h[0], -h[1]), { arm: pl - n.hw / 2 + 0.95, peds: [{ a: Math.PI / 2, group: og }, { a: 0, group: g }] });
      for (const v of out.veh) { const m = new THREE.Mesh(disc, mat(g, v.k)); m.position.set(...v.p); m.rotation.y = v.r; scene.add(m); }
      for (const v of out.ped) { const m = new THREE.Mesh(sq, mat('p' + v.group, v.k)); m.position.set(...v.p); m.rotation.y = v.r; scene.add(m); }
    }
    const cyc = () => signals.t % 36;
    signals.state = g => { const c = cyc(); return g === 'A' ? (c < 16 ? 'g' : c < 19 ? 'y' : 'r') : (c >= 20 && c < 32 ? 'g' : c >= 32 && c < 35 ? 'y' : 'r'); };
    // cars already within braking distance run the amber; nobody enters on red
    signals.go = (g, d) => { const s = signals.state(g); return s === 'g' || s === 'y' && d < 7; };
    signals.update = dt => {
      signals.t += dt; const c = cyc(), blink = Math.floor(signals.t * 2) % 2;
      for (const g of ['A', 'B']) { const s = signals.state(g); for (const k of ['g', 'y', 'r']) { const m = signals.mats[g + k]; if (m) m.emissiveIntensity = s === k ? m.userData.on : 0; } }
      for (const g of ['A', 'B']) { // walkers parallel to that road's traffic: walk, then a flashing green, then red
        const start = g === 'A' ? 0 : 20, e = c - start, walk = e >= 0 && e < 13 ? 1 : e >= 13 && e < 16 ? blink : 0;
        const w = signals.mats['p' + g + 'walk'], r = signals.mats['p' + g + 'stop'];
        if (w) w.emissiveIntensity = walk ? w.userData.on : 0; if (r) r.emissiveIntensity = walk || (e >= 13 && e < 16) ? 0 : r.userData.on;
      }
    };
  }
  // level crossings on B, C, D
  const crossingRoads = ROADS.filter(R => ['B', 'C', 'D'].includes(R.id));
  const Bx = new GeoBuilder(192);
  const railInfo = buildRailway({ y0: Y0, riverX, B: Bx });
  for (const R of crossingRoads) {
    const x = R.pts[0][0];
    buildCrossing(Bx, x, Y0, R.w + 2 * (R.walk || 0) + 0.4, { hw: R.w / 2, walk: R.walk || 0 });
    if (R.walk) for (const side of [-1, 1]) for (const [za, zb] of [[-73.4, -70.6], [-89.4, -86.6]]) { const sa = sOf(R.id, x, za), sb = sOf(R.id, x, zb); RN.cuts.push({ id: R.id, side, s0: Math.min(sa, sb), s1: Math.max(sa, sb) }); } // footways step down to the crossing
    for (const dir of [-1, 1]) addStop(R.id, sOf(R.id, x, -80 - dir * 8.6), dir, false);
    const sgn = [[-1, -89.5], [1, -70.5]];
    for (const [sd, z] of sgn) { const sx = x + sd * (R.w / 2 + (R.walk ? R.walk - 0.5 : 1.4)); roadSign(B, sx, topY(sx, z + sd * 2), z + sd * 2, sd > 0 ? 0 : Math.PI, 'crossing'); }
  }
  chainMaterial();
  railFences(Bx, (x, z) => hf.groundAt(x, z), Y0, [
    ...crossingRoads.map(R => [R.pts[0][0] - R.w / 2 - (R.walk || 0) - 3, R.pts[0][0] + R.w / 2 + (R.walk || 0) + 3]),
    [riverX(-80) - 24, riverX(-80) + 24], [RAIL.stationX + 6 - 9.6, RAIL.stationX + 6 + 9.6, 1], [RAIL.stationX - RAIL.platformLen / 2 + 2.5, RAIL.stationX - RAIL.platformLen / 2 + 9.5, 1]]);
  // occupancy/masks for railway corridor, river corridor, station
  occRect(0, -80, 1000, 13, 0, 1);
  for (let z = -800; z < 800; z += 1) { const rx = riverX(z); occRect(rx, z, 24, 0.6, 0, 1); }
  hf.paint2(2, -PORTALS.railW, -92, PORTALS.railE, -68, (x, z) => Math.abs(z + 80) < 11 ? 1 : 0);
  // station forecourt: paved square, bus / taxi loop round a raised island (station.js)
  occRect(RAIL.stationX + 6, -47.5, 34, 17, 0, 1);
  hf.paint2(2, -60, -66, 40, -30, (x, z) => x < -34.5 || x > 32 ? 0 : 1); hf.paint2(0, -60, -66, 40, -30, (x, z) => x < -34.5 || x > 32 ? 0 : 1);
  hf.paint2(2, RAIL.stationX - 4, -74, RAIL.stationX + 16, -63, () => 1); // nothing grows in or under the station building
  const stationCars = [], forecourt = stationForecourt(B, { Y0, RN, sOf, rng: mulberry32(55), parked: stationCars });
  // river banks: concrete revetments with railings, plus bridges. Nothing grows through the revetment slabs or
  // under the walkway deck (the ground there sits below the concrete)
  hf.paint2(2, 100, -800, 330, 800, (x, z) => Math.abs(x - riverX(z)) < 18.2 && Math.abs(x - riverX(z)) > 11.9 ? 1 : 0); // revetment + bank-top walkway
  for (let z = -760; z < 760; z += 4) {
    for (const sd of [-1, 1]) {
      const xa = riverX(z) + sd * 14.6, xb = riverX(z + 4) + sd * 14.6, xa0 = riverX(z) + sd * 12.2, xb0 = riverX(z + 4) + sd * 12.2;
      B.frame(0, 0, 0, 0);
      // sloped revetment slab, with a low toe wall where it meets the gravel margin
      if (sd < 0) { B.quad('stone', [xa0, 0.45, z], [xb0, 0.45, z + 4], [xb, Y0 + 0.15, z + 4], [xa, Y0 + 0.15, z], { uv: 2, color: [0.8, 0.8, 0.78] });
        B.quad('concrete', [xa0 + 0.35, 0.1, z], [xb0 + 0.35, 0.1, z + 4], [xb0, 0.45, z + 4], [xa0, 0.45, z], { color: [0.7, 0.7, 0.68] }); }
      else { B.quad('stone', [xb0, 0.45, z + 4], [xa0, 0.45, z], [xa, Y0 + 0.15, z], [xb, Y0 + 0.15, z + 4], { uv: 2, color: [0.8, 0.8, 0.78] });
        B.quad('concrete', [xb0 - 0.35, 0.1, z + 4], [xa0 - 0.35, 0.1, z], [xa0, 0.45, z], [xb0, 0.45, z + 4], { color: [0.7, 0.7, 0.68] }); }
      // paved walkway on top of the bank, with a skirt down to the ground on its outer edge (it stops at the bridges,
      // whose decks and parapets take over there)
      if (Math.abs(z + 78) > 8 && Math.abs(z + 2 + 25) > 8.5 && Math.abs(z + 2 - 200) > 5.2) {
        const xo = riverX(z) + sd * 17.6, xo2 = riverX(z + 4) + sd * 17.6, yd = Y0 + 0.12, pc = { uv: 1.5, color: [0.88, 0.86, 0.82] }, sk = { uv: 2, color: [0.72, 0.72, 0.7] };
        if (sd > 0) { B.quad('pavement', [xa, yd, z], [xb, yd, z + 4], [xo2, yd, z + 4], [xo, yd, z], pc); B.quad('concrete', [xo2, Y0 - 1.2, z + 4], [xo, Y0 - 1.2, z], [xo, yd, z], [xo2, yd, z + 4], sk); }
        else { B.quad('pavement', [xo, yd, z], [xo2, yd, z + 4], [xb, yd, z + 4], [xa, yd, z], pc); B.quad('concrete', [xo, Y0 - 1.2, z], [xo2, Y0 - 1.2, z + 4], [xo2, yd, z + 4], [xo, yd, z], sk); }
      }
      if (Math.abs(z + 25) < 12 || Math.abs(z + 80) < 12 || Math.abs(z - 200) < 10) continue;
      if (RIVER_STAIRS.some(([z0, s2]) => s2 === sd && z + 4 > z0 - 1 && z < z0 + 2.5)) continue; // opening at the head of a stair
      // railing: rails follow the bank's curve segment by segment, posts every 2 m
      const ra = xa + sd * 0.4, rb = xb + sd * 0.4, rc = { color: [0.3, 0.52, 0.47] };
      B.beam('alu', [ra, Y0 + 1.07, z], [rb, Y0 + 1.07, z + 4], 0.07, 0.07, rc);
      B.beam('alu', [ra, Y0 + 0.62, z], [rb, Y0 + 0.62, z + 4], 0.035, 0.035, rc);
      for (const k of [0, 0.5]) B.box('alu', lerp(ra, rb, k), Y0 + 0.1, z + 4 * k, 0.06, 0.97, 0.06, rc);
      addBox((ra + rb) / 2, z + 2, 0.1, 2.05, Math.atan2(rb - ra, 4));
    }
  }
  // road bridges: deck slab on concrete girders and cross-beams, round-nosed piers with caps, abutments; parapet wall with
  // an aluminium railing, name pillars (親柱) at the four corners, lamps, and steel expansion joints across the road
  // river access: concrete stairs let into the revetment, running down along the bank to the gravel margin, with a rail
  for (const [z0, sd] of RIVER_STAIRS) {
    const rise = 0.19, run = 0.34, n = Math.ceil((Y0 + 0.12 - 0.45) / rise), slopeRd = y2 => 12.2 + (y2 - 0.45) / (Y0 - 0.3) * 2.4;
    for (let k = 0; k < n; k++) {
      const yt = Y0 + 0.12 - (k + 1) * rise, zz = z0 + k * run, rd = slopeRd(yt), rx = riverX(zz);
      B.frame(rx + sd * (rd + 0.55), yt - 1.2, zz, 0); B.bbox('concrete', 0, 0, 0, 1.1, 1.2, run + 0.01, 0.01, { color: [0.76, 0.76, 0.74], skip: 'ny' });
      if (k % 4 === 0) { B.frame(rx + sd * (rd + 1.12), yt, zz, 0); B.cyl('steel', 0, 0, 0, 0.025, 0.025, 0.9, 8, { color: [0.3, 0.52, 0.47], cap: true }); }
    }
    const top = [riverX(z0) + sd * (slopeRd(Y0 + 0.12 - rise) + 1.12), Y0 + 0.12 - rise + 0.9, z0], bot = [riverX(z0 + (n - 1) * run) + sd * (slopeRd(Y0 + 0.12 - n * rise) + 1.12), Y0 + 0.12 - n * rise + 0.9, z0 + (n - 1) * run];
    B.frame(0, 0, 0, 0); B.sweep('steel', [[-0.022, -0.022], [0.022, -0.022], [0.022, 0.022], [-0.022, 0.022]], [top, bot], { closed: true, caps: true, color: [0.3, 0.52, 0.47] });
  }
  for (const [bz, bw, id, names] of [[-25, 12, 'A', ['桜川橋', 'さくらがわばし']], [200, 5, 'F', ['舟橋', 'ふなばし']]]) {
    const rx = riverX(bz), L = 34, gc = [0.76, 0.76, 0.74];
    B.frame(rx, Y0, bz, 0);
    B.bbox('concrete', 0, -0.5, 0, L, 0.8, bw + 0.9, 0.03, { color: gc, uv: 3 });
    for (const sd of [-1, 1]) B.bbox('concrete', 0, -0.72, sd * (bw / 2 + 0.3), L, 0.34, 0.5, 0.03, { color: [0.72, 0.72, 0.7], uv: 3 }); // edge beams
    const ng = Math.max(2, Math.round(bw / 3));
    for (let g = 0; g < ng; g++) B.bbox('concrete', 0, -1.55, (g / (ng - 1) - 0.5) * (bw - 1), L - 0.4, 1.06, 0.45, 0.03, { color: [0.7, 0.7, 0.68], uv: 3 });
    for (let x = -L / 2 + 1; x <= L / 2 - 1; x += 5.5) B.bbox('concrete', x, -1.3, 0, 0.3, 0.8, bw - 0.6, 0.02, { color: [0.68, 0.68, 0.66] });
    for (const px of [-7, 7]) {
      B.bbox('concrete', px, -1.9, 0, 1.9, 0.4, bw + 0.2, 0.03, { color: [0.72, 0.72, 0.7], uv: 3 });                 // pier cap
      B.bbox('concrete', px, -8, 0, 1.3, 6.1, bw - 1.3, 0.02, { color: [0.68, 0.68, 0.66], uv: 3 });
      for (const sd of [-1, 1]) B.cyl('concrete', px, -8, sd * (bw / 2 - 0.65), 0.65, 0.65, 6.1, 16, { color: [0.68, 0.68, 0.66], uv: 3 });
    }
    for (const ax of [-L / 2, L / 2]) B.bbox('concrete', ax, -3.2, 0, 0.9, 3.15, bw + 1.6, 0.03, { color: [0.7, 0.7, 0.68], uv: 3 });  // abutments (top under the approach road)
    for (const sd of [-1, 1]) {
      const zp = sd * (bw / 2 + 0.16);
      B.bbox('concrete', 0, 0.3, zp, L, 0.5, 0.3, 0.025, { color: [0.8, 0.8, 0.78], uv: 3 });
      B.bbox('concrete', 0, 0.8, zp, L + 0.02, 0.06, 0.36, 0.015, { color: [0.72, 0.72, 0.7] });
      B.detail(1, () => {
        for (let x = -L / 2 + 1; x <= L / 2 - 1; x += 2) B.bbox('alu', x, 0.86, zp, 0.06, 0.52, 0.06, 0.008, { color: [0.62, 0.66, 0.7] });
        for (const yy of [1.1, 1.36]) B.bbox('alu', 0, yy, zp, L - 1.6, 0.05, 0.05, 0.008, { color: [0.66, 0.7, 0.74] });
      });
      addBox(rx, bz + zp, 17, 0.2, 0);
      if (bw < 8) B.bbox('concrete', 0, 0.3, sd * (bw / 2 - 0.25), L, 0.2, 0.5, 0.02, { color: [0.78, 0.78, 0.76] });   // narrow ledge beside the lane
      for (const ex of [-1, 1]) { // name pillars
        const px = ex * (L / 2 - 0.4);
        B.bbox('stone', px, 0.3, zp, 0.62, 1.15, 0.62, 0.03, { color: [0.7, 0.68, 0.64] });
        B.bbox('stone', px, 1.45, zp, 0.72, 0.12, 0.72, 0.03, { color: [0.64, 0.62, 0.58] });
        B.bbox('stone', px, 1.57, zp, 0.4, 0.14, 0.4, 0.04, { color: [0.62, 0.6, 0.56] });
        const txt = names[(ex > 0) !== (sd > 0) ? 0 : 1];
        const plate = signMesh(0.3, 0.8, (g, W, H) => { g.fillStyle = '#3a3630'; g.fillRect(0, 0, W, H); g.fillStyle = '#d8cfb8'; g.fillRect(6, 6, W - 12, H - 12); g.fillStyle = '#2b2620'; g.textAlign = 'center'; g.textBaseline = 'middle';
          const cs = [...txt]; g.font = `bold ${Math.min(W * 0.66, H / (cs.length + 0.6))}px ${JP_FONT}`; cs.forEach((c, i) => g.fillText(c, W / 2, H * (i + 0.8) / (cs.length + 0.6))); }, 0.05, 128);
        plate.position.set(...B.P([px, 0.95, zp - sd * 0.32])); plate.rotation.y = sd > 0 ? Math.PI : 0; scene.add(plate);
      }
      for (const lx of [-8, 8]) { // lamp posts
        B.detail(1, () => { B.cyl('steel', lx, 0.86, zp, 0.08, 0.06, 4.6, 12, { color: [0.3, 0.34, 0.38] }); B.sweep('steel', [[-0.025, -0.025], [0.025, -0.025], [0.025, 0.025], [-0.025, 0.025]], [[lx, 5.3, zp], [lx, 5.55, zp - sd * 0.3], [lx, 5.5, zp - sd * 0.7]], { closed: true, caps: true, color: [0.3, 0.34, 0.38] }); });
        B.bbox('steel', lx, 5.28, zp - sd * 0.72, 0.36, 0.16, 0.24, 0.03, { color: [0.28, 0.3, 0.33] }); B.box('lamp', lx, 5.26, zp - sd * 0.72, 0.3, 0.03, 0.18);
        lampPoints.push({ p: [rx + lx, Y0 + 5.1, bz + zp - sd * 0.72], s: 0.9 });
      }
    }
    addPlatform(rx, bz, 17, bw / 2, 0, Y0 + 0.35);
    // steel finger joints across the road at both deck ends
    for (const ex of [-1, 1]) RN.decal(B, 'metal', [rx + ex * L / 2, bz], [1, 0], 0.11, RN.byId.get(id).hw, { color: [0.36, 0.36, 0.36], lift: 0.006, road: false });
  }
  progress('Building the railway', 0.42); await tick();

  // ---------------------------------------------------------------- lots and buildings
  const rng = mulberry32(4242), extras = [], carSpots = [];
  const reserve = (cx, cz, hw, hd, r) => { occRect(cx, cz, hw, hd, r, 1); };
  // konbini on the corner of A and B
  const kb = { x: 134, y: 0, z: -3, r: 0, w: 22, d: 13 };
  kb.z = -3 - 6; kb.y = hf.groundAt(kb.x, kb.z);
  const kLot = { x: 134, z: 0, hw: 20, hd: 16 };
  reserve(kLot.x, kLot.z, kLot.hw, kLot.hd, 0);
  konbini(B, { x: kb.x, y: Y0, z: 7, r: Math.PI, w: 22, d: 13 }, rng, extras);
  { // the konbini's pole sign at the corner of the lot
    const px = 151.5, pz = -17.2;
    B.frame(px, Y0 + 0.08, pz, 0); B.cyl('steel', 0, 0, 0, 0.16, 0.14, 6.2, 16, { color: [0.85, 0.86, 0.88] }); B.bbox('concrete', 0, -0.1, 0, 0.8, 0.3, 0.8, 0.03, { color: [0.72, 0.72, 0.7] });
    B.bbox('plastic', 0, 6.1, 0, 2.3, 1.6, 0.5, 0.05, { color: [0.95, 0.95, 0.95] }); B.frame(0, 0, 0, 0); addCircle(px, pz, 0.25);
    for (const e of [-1, 1]) { const m = signMesh(2.1, 1.4, (g, W2, H2) => { g.fillStyle = '#fff'; g.fillRect(0, 0, W2, H2); g.fillStyle = '#0a8a4b'; g.fillRect(0, 0, W2, H2 * 0.2); g.fillStyle = '#1a5fb4'; g.fillRect(0, H2 * 0.8, W2, H2 * 0.2); g.fillStyle = '#f08a14'; g.fillRect(0, H2 * 0.2, W2, H2 * 0.08);
      g.fillStyle = '#0a4f8f'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `bold ${H2 * 0.24}px Arial`; g.fillText('SUNNY', W2 / 2, H2 * 0.42); g.fillText('MART', W2 / 2, H2 * 0.66); }, 1.4);
      m.position.set(px, Y0 + 0.08 + 6.9, pz + e * 0.26); m.rotation.y = e > 0 ? 0 : Math.PI; scene.add(m); }
  }
  B.frame(0, 0, 0, 0); B.box('asphalt', 134.4, Y0 - 0.1, -9.6, 38.8, 0.18, 18.8, { uv: 4, skip: 'ny' });
  for (let i = 0; i < 7; i++) {
    RN.decal(B, 'paint', [118.5 + i * 5, -2.3], [0, 1], 2.5, 0.06, { color: [0.92, 0.92, 0.9], y: () => Y0 + 0.08, lift: 0.004, road: false });
    if (i < 6) { B.frame(121 + i * 5, Y0 + 0.08, -0.7, 0); B.bbox('concrete', 0, 0, 0, 1.7, 0.1, 0.14, 0.02, { color: [0.82, 0.82, 0.8], skip: 'ny' }); B.frame(0, 0, 0, 0); } // wheel stops
  }
  for (const [x0, x1] of [[119, 129], [138, 150]]) RN.cuts.push({ id: 'A', side: 1, s0: sOf('A', x0, -25), s1: sOf('A', x1, -25) });
  RN.cuts.push({ id: 'B', side: -1, s0: sOf('B', 110, -16), s1: sOf('B', 110, -6) });
  hf.paint2(2, 114, -20, 156, 16, () => 1);
  // apartment block
  const apt = { x: -95, z: 138, r: Math.PI, w: 34, d: 11 };
  reserve(apt.x, apt.z, apt.w / 2 + 3.6, apt.d / 2 + 5.6, apt.r);
  apartment(B, { ...apt, y: hf.groundAt(apt.x, apt.z) }, rng, extras);
  B.frame(0, 0, 0, 0); B.box('asphaltLane2', apt.x, Y0 - 0.1, 126, 34, 0.15, 11, { uv: 4, skip: 'ny' });
  hf.paint2(2, apt.x - 18, 118, apt.x + 18, 146, () => 1);
  for (let i = 0; i < 6; i++) carSpots.push({ p: [apt.x - 14 + i * 5.5, Y0, 127], r: 0 });
  // shrine
  const shrineInfo = shrineCompound(B, SHRINE_M,
    SHRINE.x, hf.groundAt(SHRINE.x, SHRINE.z), SHRINE.z, 0, extras, mulberry32(808));
  for (const p of shrineInfo.lamps) lampPoints.push({ p, s: 0.35 });
  // the shrine's sacred tree, girded with a shimenawa sized to its trunk
  const shrineTree = makeTree('zelkova', shrineInfo.tree[0], shrineInfo.tree[1] - 0.2, shrineInfo.tree[2], mulberry32(31), { scale: 1.1 });
  B.frame(0, shrineInfo.tree[1], 0, 0); sacredRope(B, SHRINE_M, shrineTree.x, shrineTree.z, shrineTree.tr * 1.02 + 0.06, 1.9);
  hf.paint2(0, SHRINE.x - 11, SHRINE.z - 38, SHRINE.x + 11, SHRINE.z + 5, (x2, z2) => Math.abs(x2 - SHRINE.x) < 10 && z2 < SHRINE.z + 4 ? 1 : 0);   // gravel precinct
  hf.paint2(2, SHRINE.x - 11, SHRINE.z - 38, SHRINE.x + 11, SHRINE.z + 5, (x2, z2) => Math.abs(x2 - SHRINE.x) < 9.5 && z2 < SHRINE.z + 4 && z2 > SHRINE.z - 37 ? 1 : 0);
  reserve(SHRINE.x, SHRINE.z - 15, 12.5, 24.5, 0);
  // an elementary school fills the block between lanes C, V1, S2 and S3; a playground park opens onto lane S0
  const drng = mulberry32(2024), schoolSak = [], parkTrees = [], bikeList = [];
  { // covered bicycle park beside the station forecourt (駐輪場): steel frames, a long mono-pitch roof, racks, bikes
    const bx = 37, z0 = -62, z1 = -34, y = hf.groundAt(bx, (z0 + z1) / 2), L = z1 - z0;
    reserve(bx, (z0 + z1) / 2, 4.6, L / 2 + 0.5, 0);
    B.frame(bx, y, (z0 + z1) / 2, 0);
    B.bbox('concrete', 0, -0.05, 0, 8.4, 0.1, L + 0.6, 0.01, { color: [0.7, 0.7, 0.68], skip: 'ny', uv: 2 });
    for (let zz = -L / 2 + 0.5; zz <= L / 2 - 0.4; zz += 4.5) { B.bbox('steel', 2.6, 0, zz, 0.1, 2.4, 0.1, 0.01, { color: [0.6, 0.63, 0.66] }); B.bbox('steel', -2.6, 0, zz, 0.1, 2.7, 0.1, 0.01, { color: [0.6, 0.63, 0.66] });
      B.beam('steel', [-2.6, 2.66, zz], [2.6, 2.36, zz], 0.08, 0.14, { color: [0.6, 0.63, 0.66] }); }
    inFrame(B, [0, 0, 0], Math.PI / 2, () => shedRoof(B, { w: L, d: 5.4, y: 2.4, pitch: 0.06, over: 0.5, mat: 'roofMetal', color: [0.36, 0.5, 0.52], gutterColor: [0.6, 0.6, 0.6] }));
    for (const sx of [-1.1, 1.1]) { B.box('steel', sx, 0.35, 0, 0.04, 0.04, L - 1, { color: [0.7, 0.7, 0.72] });
      for (let zz = -L / 2 + 0.8; zz < L / 2 - 0.5; zz += 0.62) { B.box('steel', sx, 0, zz, 0.03, 0.35, 0.03, { color: [0.7, 0.7, 0.72] }); if (drng() < 0.72) bikeList.push({ x: bx + sx * 1.6, y, z: (z0 + z1) / 2 + zz, r: sx > 0 ? 0 : Math.PI }); } }
    B.frame(0, 0, 0, 0);
    hf.paint2(2, bx - 5, z0 - 1, bx + 5, z1 + 1, () => 1);
  }
  const SCH = { x: -89.75, z: 223, w: 113, d: 64 }, PK = { x: -212, z: 69.5, w: 42, d: 32 };
  reserve(SCH.x, SCH.z, SCH.w / 2 + 1, SCH.d / 2 + 1, 0);
  school(B, SCH.x, hf.groundAt(SCH.x, SCH.z), SCH.z, Math.PI, SCH.w, SCH.d, drng, schoolSak, bikeList, extras);
  hf.paint2(0, SCH.x - SCH.w / 2, SCH.z - SCH.d / 2, SCH.x + SCH.w / 2, SCH.z + SCH.d / 2, (x, z) => Math.abs(x - SCH.x) < SCH.w / 2 - 4 && Math.abs(z - SCH.z) < SCH.d / 2 - 4 ? 1 : 0);
  hf.paint2(2, SCH.x - SCH.w / 2, SCH.z - SCH.d / 2, SCH.x + SCH.w / 2, SCH.z + SCH.d / 2, (x, z) => Math.abs(x - SCH.x) < SCH.w / 2 - 4.5 && Math.abs(z - SCH.z) < SCH.d / 2 - 4.5 || Math.abs(x - SCH.x) < 4.5 && z < SCH.z ? 1 : 0);
  hf.paint2(0, SCH.x - 6, SCH.z - SCH.d / 2 - 2, SCH.x + 6, SCH.z, (x, z) => Math.abs(x - SCH.x) < 4.2 ? 1 : 0); // paved way in from the gate
  reserve(PK.x, PK.z, PK.w / 2 + 1, PK.d / 2 + 1, 0);
  { // municipal tennis courts east of road B, reached by a gravel path from the footway
    const TC = { x: 152, z: 292, r: -Math.PI / 2 };
    reserve(TC.x, TC.z, 22, 21.5, 0); reserve((TC.x - 22 + 116) / 2, TC.z, (TC.x - 22 - 116) / 2 + 0.5, 2, 0);
    tennisCourts(B, TC.x, hf.groundAt(TC.x, TC.z), TC.z, TC.r, drng, extras, lampPoints);
    hf.paint2(2, TC.x - 23, TC.z - 22, TC.x + 23, TC.z + 22, () => 1);
    hf.paint2(0, 114, TC.z - 2.2, TC.x - 18, TC.z + 2.2, () => 1); hf.paint2(2, 114, TC.z - 1.6, TC.x - 18, TC.z + 1.6, () => 1);
    RN.cuts.push({ id: 'B', side: -1, s0: sOf('B', 110, TC.z) - 1.5, s1: sOf('B', 110, TC.z) + 1.5 });
  }
  playground(B, PK.x, hf.groundAt(PK.x, PK.z), PK.z, Math.PI, PK.w, PK.d, drng, parkTrees, extras);
  hf.paint2(0, PK.x - PK.w / 2, PK.z - PK.d / 2, PK.x + PK.w / 2, PK.z + PK.d / 2, (x, z) => Math.abs(x - PK.x) < PK.w / 2 - 4 && Math.abs(z - PK.z) < PK.d / 2 - 4 ? 1 : 0);
  hf.paint2(2, PK.x - PK.w / 2, PK.z - PK.d / 2, PK.x + PK.w / 2, PK.z + PK.d / 2, (x, z) => Math.abs(x - PK.x) < PK.w / 2 - 4.5 && Math.abs(z - PK.z) < PK.d / 2 - 4.5 ? 1 : 0);

  // little street shrines on free corners where lanes meet
  const shrineSpots = [];
  { const shr = mulberry32(2718); let placed = 0;
    for (const I of inters) {
      if (placed >= 5 || I.roads.some(R => R.kind !== 'lane') || shr() > 0.5) continue;
      const [a, b] = I.roads;
      for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        let done = false;
        for (const off of [Math.max(a.w, b.w) / 2 + 2.9, Math.max(a.w, b.w) / 2 + 3.8]) {
          const x = I.p[0] + sx * off, z = I.p[1] + sz * off, r = Math.atan2(-sx, -sz);
          if (occRect(x, z, 1.45, 1.6, r, 0, true) || Math.abs(x - riverX(z)) < 30) continue;
          streetShrine(B, x, hf.groundAt(x, z), z, r, shr); occRect(x, z, 1.45, 1.6, r, 1); placed++; done = true; shrineSpots.push([+x.toFixed(1), +z.toFixed(1), +r.toFixed(2)]);
          hf.paint2(2, x - 2.5, z - 2.5, x + 2.5, z + 2.5, (x2, z2) => Math.hypot(x2 - x, z2 - z) < 2.2 ? 1 : 0); break;
        }
        if (done) break;
      }
    }
    }
  // ---- parcels. Every road gets frontage lots on both sides, marched along it; alleys claim their small plots first,
  // then the through roads in order. A lot takes the depth its block leaves it (shallower lots where two frontages meet
  // back to back), and some lots are split into a front plot plus a flag lot (旗竿地) behind it, reached by its own
  // 2.6 m "pole" driveway beside the front plot. The district sets lot size, setback, front yard, boundary and use.
  const district = (x2, z2) => {
    if (x2 > 262 || x2 < -415) return 'farm';
    if (Math.abs(x2 - riverX(z2)) < 80) return 'river';
    if (x2 > -130 && x2 < 160 && z2 > -75 && z2 < 32) return 'station';
    if (x2 < -250 || (z2 < -110 && x2 < 0)) return 'old';
    if (z2 > 140 || x2 > 150) return 'new';
    return 'mid';
  };
  // per district: lot width, depth, setback beyond the corridor, front yard, gap between lots, flag-lot odds, boundaries
  const DIST = {
    old:     { w: [8, 11], d: [13, 17], set: [0.5, 0.8], front: [1.0, 2.6], gap: [0.1, 0.3], flag: 0.3, fence: { block: 0.45, wood: 0.4, open: 0.15 } },
    mid:     { w: [10, 13.5], d: [13.5, 16.5], set: [0.9, 1.3], front: [3.0, 6.0], gap: [0.3, 0.8], flag: 0.22, fence: { block: 0.65, low: 0.2, open: 0.15 } },
    new:     { w: [11.5, 14.5], d: [14.5, 17], set: [1.2, 1.5], front: [5.6, 6.4], gap: [0.4, 0.6], flag: 0.08, fence: { low: 0.55, open: 0.35, block: 0.1 } },
    river:   { w: [10, 13], d: [13.5, 16], set: [0.9, 1.3], front: [2.5, 5.8], gap: [0.3, 0.8], flag: 0.2, fence: { block: 0.55, wood: 0.15, low: 0.15, open: 0.15 } },
    station: { w: [8.5, 11], d: [12, 15], set: [0.5, 1.0], front: [1.5, 5.6], gap: [0.1, 0.4], flag: 0.25, fence: { block: 0.5, low: 0.2, open: 0.3 } },
    farm:    { w: [16, 22], d: [20, 25], set: [1.5, 3.0], front: [6.0, 9.0], gap: [4, 14], flag: 0, fence: { hedge: 0.5, open: 0.3, block: 0.2 } },
  };
  const rr = (a2, b2) => a2 + rng() * (b2 - a2);
  const pickW = obj => { let v = rng(); for (const k in obj) { if ((v -= obj[k]) <= 0) return k; } return Object.keys(obj)[0]; };
  const lots = [], poles = [];
  const lotFree = (cx, cz, hw, hd, r) => !occRect(cx, cz, hw, hd, r, 0, true) && Math.abs(cx) < 640 && Math.abs(cz) < 345 && !inPaddyZone(cx, cz)
    && hf.groundAt(cx, cz) < Y0 + 1.2 && hf.groundAt(cx, cz) > Y0 - 0.6;
  for (const R of [...ROADS].sort((a2, b2) => (b2.noMarks ? 1 : 0) - (a2.noMarks ? 1 : 0))) {
    if (R.kind === 'path') continue;
    const alley = !!R.noMarks;
    for (const [a, b] of roadSegs(R)) {
      const ind = R.id === 'F';
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]), dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
      for (const side of [-1, 1]) {
        const nx = -dz * side, nz = dx * side, r = Math.atan2(-nx, -nz);
        if (R.id === 'R' && Math.abs(a[0] + nx * 10 - riverX(a[1] + nz * 10)) < Math.abs(a[0] - riverX(a[1]))) continue; // not on the river side
        // the lot's gate side (local +x) runs toward lower t on side 1 and higher t on side -1
        const gateHigh = side < 0;
        let t = alley ? 3.2 : 4 + rng() * 2;
        while (t < L - (alley ? 1 : 4)) {
          const mx = a[0] + dx * t, mz = a[1] + dz * t;
          const dist = ind ? 'yard' : district(mx, mz), D = DIST[dist] || DIST.mid, shopZone = R.id === 'A' && mx > -272 && mx < 200;
          const w = ind ? 18 + rng() * 6 : alley ? 8 + rng() * 2 : rr(...D.w);
          const d0 = ind ? 17 + rng() * 4 : shopZone ? 12 : alley ? 11.5 + rng() * 2 : rr(...D.d);
          const set = R.w / 2 + (R.walk || 0) + (shopZone ? 0.12 : ind ? 1.05 : rr(...D.set));
          const gap = dist === 'farm' ? rr(...D.gap) : ind ? 0.6 : rr(...D.gap);
          const flag = !ind && !alley && !shopZone && rng() < D.flag, poleW = 2.6;
          const span = w + (flag ? gap + poleW : 0);
          const t0 = t, at = (u, off) => [a[0] + dx * (t0 + u) + nx * off, a[1] + dz * (t0 + u) + nz * off];
          // front plot and pole positions along the span (pole on the gate side)
          const uLot = flag && !gateHigh ? poleW + gap + w / 2 : w / 2, uPole = gateHigh ? w + gap + poleW / 2 : poleW / 2;
          t += span + gap;
          if (rng() < 0.035) continue; // empty lot
          // the deepest plot the block allows (down to 10 m where frontages meet back to back)
          let d = 0, c = null;
          for (const dt of [d0, d0 * 0.86, d0 * 0.74, 10]) { if (dt < 9.5) break; const cc = at(uLot, set + dt / 2); if (lotFree(cc[0], cc[1], w / 2, dt / 2, r)) { d = dt; c = cc; break; } }
          if (!c) continue;
          occRect(c[0], c[1], w / 2, d / 2, r, 1);
          const kind = ind ? 'yard' : shopZone ? 'shop' : dist === 'station' && !alley && rng() < 0.3 ? 'shop' : rng() < 0.035 ? 'carpark' : rng() < 0.07 && dist !== 'new' ? 'garden' : 'house';
          const lot = { x: c[0], z: c[1], r, w, d, shop: kind === 'shop', road: R, kind, district: dist, era: dist === 'old' || dist === 'farm' ? 'old' : dist === 'new' ? 'new' : rng() < 0.5 ? 'old' : 'new',
            front: dist === 'farm' ? rr(...D.front) : clamp(rr(...D.front), 0.9, d - 7.8), fence: pickW(D.fence) };
          lots.push(lot);
          if (!flag) continue;
          // flag lot: pole strip from the road beside the front plot, the plot itself behind both
          const bd = 11.5 + rng() * 3, bw = w + gap + poleW, depthPole = d + 0.5;
          const pc = at(uPole, set + depthPole / 2), bc = at(span / 2, set + depthPole + bd / 2);
          if (!lotFree(pc[0], pc[1], poleW / 2, depthPole / 2, r) || !lotFree(bc[0], bc[1], bw / 2, bd / 2, r)) continue;
          occRect(pc[0], pc[1], poleW / 2, depthPole / 2, r, 1); occRect(bc[0], bc[1], bw / 2, bd / 2, r, 1);
          poles.push({ x: pc[0], z: pc[1], r, len: depthPole, road: R, s: sOf(R.id, pc[0], pc[1]), side });
          lots.push({ x: bc[0], z: bc[1], r, w: bw, d: bd, shop: false, road: R, back: true, kind: rng() < 0.06 ? 'garden' : 'house', district: dist, era: lot.era,
            front: clamp(5.6 + rng() * 0.6, 0.9, bd - 7.8), fence: dist === 'new' ? 'low' : 'block' });
        }
      }
    }
  }
  // pole driveways: a concrete strip with tyre-track joints, running from the road edge to the flag lot
  for (const P of poles) {
    B.frame(P.x, hf.groundAt(P.x, P.z), P.z, P.r);
    B.bbox('concrete', 0, -0.05, 0, 2.4, 0.09, P.len, 0.01, { color: [0.73, 0.73, 0.71], skip: 'ny', uv: 2 });
    for (let k = -P.len / 2 + 2.5; k < P.len / 2 - 0.5; k += 2.5) B.box('dark', 0, 0.035, k, 2.3, 0.004, 0.02, { color: [0.45, 0.45, 0.44] });
    hf.paint2(2, P.x - 12, P.z - 12, P.x + 12, P.z + 12, (x2, z2) => { const cc = Math.cos(P.r), ss = Math.sin(P.r), ddx = x2 - P.x, ddz = z2 - P.z; return Math.abs(ddx * cc - ddz * ss) < 1.4 && Math.abs(ddx * ss + ddz * cc) < P.len / 2 ? 1 : 0; });
    if (P.road.walk) RN.cuts.push({ id: P.road.id, side: P.side, s0: P.s - 1.6, s1: P.s + 1.6 });
  }
  // corners of the main junctions that no lot could take (the curb returns eat into them) become small coin car parks,
  // the way Japanese street corners usually end up
  for (const I of inters) {
    if (!I.roads.some(R => R.id === 'A' || R.id === 'B') || onBridge(I.p[0], I.p[1])) continue;
    for (const cr of I.corners) {
      const bx = cr.O[0] - I.p[0], bz = cr.O[1] - I.p[1], bl = Math.hypot(bx, bz); if (bl < 1) continue;
      const r = Math.atan2(cr.a.d[0], cr.a.d[1]);
      // the corner behind the curb return is paved gravel, never a patch of meadow
      hf.paint2(2, cr.O[0] - 9, cr.O[1] - 9, cr.O[0] + 9, cr.O[1] + 9, (x2, z2) => Math.hypot(x2 - cr.O[0], z2 - cr.O[1]) < 8.5 ? 1 : 0);
      hf.paint2(0, cr.O[0] - 9, cr.O[1] - 9, cr.O[0] + 9, cr.O[1] + 9, (x2, z2) => Math.hypot(x2 - cr.O[0], z2 - cr.O[1]) < 8.5 ? 1 : 0);
      let cx = 0, cz = 0, ok = false;
      for (const off of [5.5, 7, 8.5, 10]) { cx = cr.O[0] + bx / bl * off; cz = cr.O[1] + bz / bl * off;
        if (!(Math.abs(cx) > 640 || Math.abs(cz) > 345 || inPaddyZone(cx, cz) || occRect(cx, cz, 6.2, 6.2, r, 0, true))) { ok = true; break; } }
      if (!ok) continue;
      occRect(cx, cz, 6, 6, r, 1);
      lots.push({ x: cx, z: cz, r, w: 11.5, d: 11.5, shop: false, road: cr.a.n.R, kind: 'carpark', district: district(cx, cz), corner: true });
    }
  }
  progress('Building houses', 0.5); await tick();
  const vend = [];
  const srng = mulberry32(3131), sakura = [], hydras = [], bushes = [];
  const lotW = (lot, lx, lz) => { const c = Math.cos(lot.r), s = Math.sin(lot.r); return [lot.x + lx * c + lz * s, lot.z - lx * s + lz * c]; };
  let li = 0, building = 0, lastCon = null;
  const conRng = mulberry32(515);
  for (const lot of lots) {
    const y = hf.groundAt(lot.x, lot.z);
    // a couple of plots are building sites: a new house going up behind a site fence
    if (!lot.shop && building < 2 && lot.w > 11 && lot.d > 13 && conRng() < 0.05 && !(lastCon && Math.hypot(lot.x - lastCon.x, lot.z - lastCon.z) < 200)) {
      constructionSite(B, lot.x, y, lot.z, lot.r, lot.w, lot.d, rng, extras); building++; lastCon = lot;
      hf.paint2(0, lot.x - 10, lot.z - 10, lot.x + 10, lot.z + 10, (x, z) => { const c = Math.cos(lot.r), s2 = Math.sin(lot.r), dx = x - lot.x, dz = z - lot.z; return Math.abs(dx * c - dz * s2) < lot.w / 2 && Math.abs(dx * s2 + dz * c) < lot.d / 2 ? 1 : 0; });
      hf.paint2(2, lot.x - 10, lot.z - 10, lot.x + 10, lot.z + 10, (x, z) => { const c = Math.cos(lot.r), s2 = Math.sin(lot.r), dx = x - lot.x, dz = z - lot.z; return Math.abs(dx * c - dz * s2) < lot.w / 2 - 1 && Math.abs(dx * s2 + dz * c) < lot.d / 2 - 1 ? 1 : 0; });
      continue;
    }
    if (lot.kind === 'yard') { warehouse(B, { x: lot.x, y, z: lot.z, r: lot.r, w: lot.w, d: lot.d }, rng, extras);
      hf.paint2(2, lot.x - 14, lot.z - 14, lot.x + 14, lot.z + 14, (x2, z2) => { const c = Math.cos(lot.r), s2 = Math.sin(lot.r), dx = x2 - lot.x, dz = z2 - lot.z; return Math.abs(dx * c - dz * s2) < lot.w / 2 - 0.6 && Math.abs(dx * s2 + dz * c) < lot.d / 2 ? 1 : 0; });
      hf.paint2(0, lot.x - 14, lot.z - 14, lot.x + 14, lot.z + 14, (x2, z2) => { const c = Math.cos(lot.r), s2 = Math.sin(lot.r), dx = x2 - lot.x, dz = z2 - lot.z; return Math.abs(dx * c - dz * s2) < lot.w / 2 && Math.abs(dx * s2 + dz * c) < lot.d / 2 ? 1 : 0; }); continue; }
    if (lot.kind === 'carpark') { for (const sp of carPark(B, { x: lot.x, y, z: lot.z, r: lot.r, w: lot.w, d: lot.d }, rng, extras)) if (rng() < 0.6) carSpots.push(sp);
      hf.paint2(2, lot.x - 10, lot.z - 10, lot.x + 10, lot.z + 10, (x2, z2) => { const c = Math.cos(lot.r), s2 = Math.sin(lot.r), dx = x2 - lot.x, dz = z2 - lot.z; return Math.abs(dx * c - dz * s2) < lot.w / 2 && Math.abs(dx * s2 + dz * c) < lot.d / 2 ? 1 : 0; }); continue; }
    if (lot.kind === 'garden') { allotment(B, { x: lot.x, y, z: lot.z, r: lot.r, w: lot.w, d: lot.d }, rng);
      hf.paint2(2, lot.x - 10, lot.z - 10, lot.x + 10, lot.z + 10, (x2, z2) => { const c = Math.cos(lot.r), s2 = Math.sin(lot.r), dx = x2 - lot.x, dz = z2 - lot.z; return Math.abs(dx * c - dz * s2) < lot.w / 2 - 0.5 && Math.abs(dx * s2 + dz * c) < lot.d / 2 - 1 ? 1 : 0; }); continue; }
    if (lot.shop) {
      shopBuilding(B, { x: lot.x, y, z: lot.z, r: lot.r, w: lot.w, d: Math.min(lot.d, 12), old: lot.district === 'old' || lot.era === 'old' }, rng, extras);
      hf.paint2(2, lot.x - 9, lot.z - 9, lot.x + 9, lot.z + 9, (x, z) => { const c = Math.cos(lot.r), s = Math.sin(lot.r), dx = x - lot.x, dz = z - lot.z; return Math.abs(dx * c - dz * s) < lot.w / 2 && Math.abs(dx * s + dz * c) < lot.d / 2 ? 1 : 0; });
      if (rng() < 0.18) vend.push({ lot, off: [lot.w / 2 - 0.6, Math.min(lot.d, 12) / 2 + 0.6] });
      if (srng() < 0.45) { // flower planter by the shop door
        const fz = Math.min(lot.d, 12) / 2 + 0.45, lx = -lot.w / 2 + 1.1;
        B.frame(lot.x, y, lot.z, lot.r); B.box('wood', lx, 0, fz, 1.3, 0.42, 0.5, { color: [0.62, 0.44, 0.3] });
        const [px, pz] = lotW(lot, lx, fz); addBox(px, pz, 0.65, 0.25, lot.r, y - 1, y + 0.5);
        for (const o of [-0.35, 0.35]) { const [hx, hz] = lotW(lot, lx + o, fz); hydras.push({ x: hx, y: y + 0.36, z: hz, s: 0.62 + srng() * 0.15, sx: 1, r: srng() * 6.28, c: hydraColor(srng) }); }
      }
      // shopfront clutter: a pair of nobori banners, a chalk signboard, customers' bicycles
      const sfz = Math.min(lot.d, 12) / 2;
      if (drng() < 0.5) { const col = [[0.86, 0.18, 0.14], [0.18, 0.4, 0.78], [0.98, 0.78, 0.2], [0.22, 0.62, 0.42], [0.95, 0.5, 0.65]][Math.floor(drng() * 5)];
        for (const o of [2.3, 2.95]) { const [nx, nz] = lotW(lot, -lot.w / 2 + o, sfz + 0.4); nobori(B, nx, y, nz, lot.r, col); addCircle(nx, nz, 0.18); } }
      if (drng() < 0.35) { const [bx, bz] = lotW(lot, lot.w * 0.08, sfz + 0.7); standBoard(B, bx, y, bz, lot.r + (drng() - 0.5) * 0.4, [[0.92, 0.9, 0.86], [0.55, 0.36, 0.24], [0.2, 0.3, 0.45]][Math.floor(drng() * 3)]); addCircle(bx, bz, 0.3); }
      if (drng() < 0.4) for (let k = 0, n = 1 + Math.floor(drng() * 3); k < n; k++) { const [bx, bz] = lotW(lot, lot.w * 0.22 + k * 0.62, sfz + 1.05); bikeList.push({ x: bx, y, z: bz, r: lot.r + Math.PI / 2 + (drng() - 0.5) * 0.15 }); }
    } else {
      const info = house(B, { x: lot.x, y, z: lot.z, r: lot.r, w: lot.w, d: lot.d, district: lot.district, front: lot.front, fence: lot.fence, era: lot.era, back: lot.back }, rng, extras);
      lot.info = info; // gardens, hedges and garden trees are planted from this layout (towngreen.js)
      if (info.carSpot) carSpots.push(info.carSpot);
      if (info.carSpot && lot.road.walk && !lot.back) { // lowered kerb in front of the parking space
        const n = RN.byId.get(lot.road.id), cp = info.carSpot.p, sc = sOf(lot.road.id, cp[0], cp[2]), q = RN.sampleAt(n, sc);
        const side = Math.sign((cp[0] - q.x) * -q.d[1] + (cp[2] - q.z) * q.d[0]);
        RN.cuts.push({ id: lot.road.id, side, s0: sc - 1.5, s1: sc + 1.5 });
      }
      // yard life: laundry in the side yard, a mailbox by the gate, bicycles beside the car
      const gapL = info.hx - info.W / 2 + lot.w / 2, gapR = lot.w / 2 - info.hx - info.W / 2;
      if (drng() < 0.3 && Math.max(gapL, gapR) > 1.5) { const left = gapL >= gapR, g = left ? gapL : gapR, lx = left ? -lot.w / 2 + g / 2 : lot.w / 2 - g / 2, [rx, rz] = lotW(lot, lx, info.hz - 0.5);
        dryingRack(B, rx, y, rz, lot.r + Math.PI / 2, drng, Math.min(2.6, info.D - 2)); }
      if (drng() < 0.45) { const [mx, mz] = lotW(lot, lot.w / 2 - 4.0, lot.d / 2 - 0.4); mailbox(B, mx, y, mz, lot.r, [[0.22, 0.32, 0.52], [0.86, 0.86, 0.84], [0.58, 0.26, 0.2], [0.26, 0.26, 0.28], [0.32, 0.48, 0.36]][Math.floor(drng() * 5)]); }
      if (info.carSpot && drng() < 0.35) for (let k = 0, n = 1 + Math.floor(drng() * 2); k < n; k++) { const [bx, bz] = lotW(lot, lot.w / 2 - 0.55, lot.d / 2 - 4.6 + k * 0.75); bikeList.push({ x: bx, y, z: bz, r: lot.r + Math.PI / 2 + (drng() - 0.5) * 0.1 }); }
      hf.paint2(0, lot.x - 10, lot.z - 10, lot.x + 10, lot.z + 10, (x, z) => { const c = Math.cos(lot.r), s = Math.sin(lot.r), dx = x - lot.x, dz = z - lot.z, lx = dx * c - dz * s, lz = dx * s + dz * c; return Math.abs(lx) < lot.w / 2 && Math.abs(lz) < lot.d / 2 ? (lz > lot.d / 2 - 6 ? 0.9 : 0.25) : 0; });
      hf.paint2(2, lot.x - 10, lot.z - 10, lot.x + 10, lot.z + 10, (x, z) => { const c = Math.cos(lot.r), s = Math.sin(lot.r), dx = x - lot.x, dz = z - lot.z, lx = dx * c - dz * s, lz = dx * s + dz * c; return Math.abs(lx) < lot.w / 2 - 0.3 && Math.abs(lz) < lot.d / 2 - 0.3 && lz > lot.d / 2 - 6.5 ? 1 : 0; });
      if (rng() < 0.07) vend.push({ lot, off: [-lot.w / 2 + 0.8, lot.d / 2 + 0.55] });
    }
    if (++li % 40 === 0) { progress('Building houses', 0.5 + 0.12 * li / lots.length); await tick(); }
  }
  // agricultural edge: vegetable fields and tunnel greenhouses on the flat land past the last streets, along farm tracks
  {
    const frng = mulberry32(4711);
    for (let fx = -392; fx < 104; fx += 23 + frng() * 6) for (let fz = 274; fz < 330; fz += 27 + frng() * 5) {
      const w = 16 + frng() * 5, d = 20 + frng() * 5, y = hf.groundAt(fx, fz);
      if (occRect(fx, fz, w / 2 + 1, d / 2 + 1, 0, 0, true) || inPaddyZone(fx, fz) || Math.abs(y - Y0) > 0.8 || Math.abs(hf.groundAt(fx + w / 2, fz + d / 2) - y) > 0.6) continue;
      const roll = frng(); if (roll < 0.25) continue;
      occRect(fx, fz, w / 2, d / 2, 0, 1);
      if (roll < 0.55) { greenhouse(B, { x: fx - 3.1, y, z: fz, r: 0, w: 5.4, d: d - 2 }, frng); greenhouse(B, { x: fx + 3.1, y, z: fz, r: 0, w: 5.4, d: d - 2 }, frng); addBox(fx, fz, 5.8, d / 2 - 1, 0); }
      else allotment(B, { x: fx, y, z: fz, r: frng() < 0.5 ? 0 : Math.PI / 2 * 0, w, d }, frng);
      hf.paint2(2, fx - w / 2, fz - d / 2, fx + w / 2, fz + d / 2, () => 1);
      hf.paint2(0, fx - w / 2, fz - d / 2, fx + w / 2, fz + d / 2, () => 0.35);
    }
  }
  // kerbs, sidewalks, gutters and curb returns, now that every driveway is known
  RN.buildEdges(B, { tactile: (n, p) => n.R.id === 'A' && Math.abs(p[0]) < 470 }); // guide blocks in town, not out on the valley road
  { // direction arrows in the approach lanes of the main road at its junction with road B (left-hand traffic)
    const I = inters.find(I2 => I2.roads.some(R => R.id === 'A') && I2.roads.some(R => R.id === 'B'));
    if (I) for (const dir of [1, -1]) for (const back of [20, 34]) {
      const t = [dir, 0], l = [0, -dir], hw = 3.5, u = hw / 2, cx = I.p[0] - dir * back, cz = I.p[1] + l[1] * u;
      const P2 = (a2, b2) => { const x2 = cx + t[0] * a2 + l[0] * b2, z2 = cz + t[1] * a2 + l[1] * b2; return [x2, surfaceY(x2, z2) + 0.012, z2]; };
      RN.decal(B, 'paint', [cx + t[0] * -0.6, cz], t, 1.6, 0.075, { color: [0.94, 0.94, 0.92], cell: 0.8 });                     // shaft
      B.poly('paint', [P2(1.0, -0.33), P2(1.0, 0.33), P2(2.1, 0)], [0, 1, 0], { color: [0.94, 0.94, 0.92] });                  // head
      if (back === 20) { RN.decal(B, 'paint', [cx + l[0] * -0.45, cz + l[1] * -0.45], [-l[0], -l[1]], 0.45, 0.075, { color: [0.94, 0.94, 0.92], cell: 0.5 }); // right branch
        B.poly('paint', [P2(-0.2, -0.85), P2(0.35, -0.85), P2(0.08, -1.45)], [0, 1, 0], { color: [0.94, 0.94, 0.92] }); }
    }
  }
  { // utility covers set into roads and footways (water valves, hydrant pits, telecom), and red fire hydrants
    const urng = mulberry32(606);
    for (const n of RN.net) {
      if (n.R.kind === 'path') continue;
      for (let s0 = 8 + urng() * 20; s0 < n.PL.len - 8; s0 += 26 + urng() * 40) {
        const q = RN.sampleAt(n, s0), l = [-q.d[1], q.d[0]], x0 = q.x, z0 = q.z;
        if (Math.abs(x0) > 700 || Math.abs(z0) > 360 || onRail(z0) || onBridge(x0, z0) || RN.clipDist(n, s0) < 3) continue;
        const side = urng() < 0.5 ? 1 : -1, onWalk = n.walk > 0 && urng() < 0.6;
        const u = onWalk ? side * (n.hw + 0.6 + urng() * (n.walk - 1.0)) : side * (n.hw * 0.35 + urng() * n.hw * 0.4);
        const cx = x0 + l[0] * u, cz = z0 + l[1] * u, yf = onWalk ? topY : surfaceY;
        const kind = urng(), sz = kind < 0.4 ? 0.2 : kind < 0.75 ? 0.3 : 0.45, col = kind < 0.4 ? [0.3, 0.32, 0.36] : kind < 0.75 ? [0.95, 0.78, 0.12] : [0.38, 0.36, 0.34];
        B.detail(2, () => RN.decal(B, 'metal', [cx, cz], q.d, sz, sz, { color: col, lift: 0.006, y: yf, road: false, cell: 1 }));
        if (onWalk && urng() < 0.25) { const hx = x0 + l[0] * side * (n.hw + n.walk - 0.35), hz = z0 + l[1] * side * (n.hw + n.walk - 0.35), hy = topY(hx, hz);
          B.frame(hx, hy, hz, 0); B.cyl('plastic', 0, -0.02, 0, 0.1, 0.1, 0.6, 12, { color: [0.85, 0.12, 0.1] }); B.cyl('plastic', 0, 0.58, 0, 0.12, 0.05, 0.12, 12, { color: [0.85, 0.12, 0.1], cap: true });
          for (const e of [-1, 1]) B.cyl('steel', e * 0.1, 0.35, 0, 0.035, 0.035, 0.08, 8, { color: [0.7, 0.7, 0.68], cap: true }); B.frame(0, 0, 0, 0); addCircle(hx, hz, 0.14); }
      }
    }
  }
  // street trees in square planters along the main road's sidewalks, outside the shopping street
  const streetTrees = [];
  for (let x = -430; x < 430; x += 13) for (const sd of [-1, 1]) {
    if (x > -268 && x < 205 || Math.abs(x - riverX(-25)) < 32 || nearInter(x, -25, ROADS[0], 5)) continue;
    const z = -25 + sd * 4.4, ty = topY(x, z); streetTrees.push({ x, y: ty + 0.02, z, s: lerp(7, 8.5, drng()), sx: 0.9, r: drng() * 6.28, c: leafColor(drng) });
    B.frame(x, ty - 0.06, z, 0); B.bbox('concrete', 0, 0, 0, 0.92, 0.14, 0.92, 0.02, { color: [0.8, 0.8, 0.77], skip: 'ny' }); B.box('plain', 0, 0.02, 0, 0.8, 0.1, 0.8, { color: [0.3, 0.23, 0.18] });
    for (const [gx, gz, gw, gd] of [[0, 0.33, 0.8, 0.14], [0, -0.33, 0.8, 0.14], [0.33, 0, 0.14, 0.52], [-0.33, 0, 0.14, 0.52]]) B.box('metal', gx, 0.12, gz, gw, 0.012, gd, { color: [0.22, 0.22, 0.23] }); // tree grate
  }
  // bus stops, post boxes, garbage points
  for (const [x, sd] of [[-205, 1], [58, -1], [300, 1]]) { const z = -25 + sd * 5.55; busStop(B, x, topY(x, z), z, sd > 0 ? Math.PI : 0); }
  for (const z of [-150, 120]) busStop(B, 110 + 4.3, topY(114.3, z), z, -Math.PI / 2, false);
  for (const [x, sd] of [[-128, 1], [22, 1], [158, -1], [-240, -1]]) postBox(B, x, topY(x, -25 + sd * 5.4), -25 + sd * 5.4, sd > 0 ? Math.PI : 0);
  for (const R of ROADS) if (R.kind === 'lane' && R.id !== 'R') for (const [a, b] of roadSegs(R)) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
    for (let t = 40 + drng() * 30; t < L - 20; t += 90 + drng() * 60) {
      const sd = drng() < 0.5 ? 1 : -1, x = a[0] + dx * t - dz * sd * (R.w / 2 + 0.45), z = a[1] + dz * t + dx * sd * (R.w / 2 + 0.45);
      if (Math.abs(x) > 440 || Math.abs(z) > 330 || nearInter(x, z, R, 4) || onRail(z) || Math.abs(x - riverX(z)) < 26 || hf.groundAt(x, z) > Y0 + 1) continue;
      garbagePoint(B, x, hf.groundAt(x, z), z, Math.atan2(dx, dz) + (sd > 0 ? -Math.PI / 2 : Math.PI / 2), drng);
    }
  }
  // festival lantern strings across the shopping street
  for (let x = -252; x < 190; x += 21) {
    if (nearInter(x, -25, ROADS[0], 5) || Math.abs(x - riverX(-25)) < 26) continue;
    B.frame(x, Y0, -25, 0);
    for (const sd of [-1, 1]) { B.box('wood', 0, 0.1, sd * 5.75, 0.15, 5.35, 0.15, { color: [0.52, 0.37, 0.26] }); B.box('wood', 0, 5.4, sd * 5.75, 0.2, 0.08, 0.2, { color: [0.3, 0.22, 0.16] }); addCircle(x, -25 + sd * 5.75, 0.16); }
    const N = 10, pt = i => { const t = i / N; return [0, 5.2 - 0.75 * 4 * t * (1 - t), -5.75 + 11.5 * t]; };
    for (let i = 0; i < N; i++) B.beam('dark', pt(i), pt(i + 1), 0.025, 0.025);
    for (let i = 1; i < N; i++) { const p = pt(i); B.box('dark', 0, p[1] - 0.16, p[2], 0.015, 0.16, 0.015); chochin(B, 0, p[1] - 0.62, p[2], i % 2 ? [1, 0.3, 0.2] : [1, 0.88, 0.7], 0.8); }
    lampPoints.push({ p: [x, 4.4, -25], s: 0.6 });
  }
  // colliders from buildings/walls
  for (const e of extras) {
    if (e.t === 'box') addBox(e.p[0], e.p[2], e.hx, e.hz, e.r, e.p[1] - 1, e.p[1] + (e.h || 20));
    else if (e.t === 'circle') addCircle(e.p[0], e.p[2], e.r);
  }
  // carport roofs (translucent polycarbonate)
  for (const e of extras) if (e.t === 'poly') { const m = new THREE.Mesh(new THREE.PlaneGeometry(e.w, e.d).rotateX(-Math.PI / 2), MT.poly); m.position.set(...e.p); m.rotation.y = e.r; scene.add(m); }
  // vending machines: station plaza, konbini, scattered along lanes
  let vi = 0;
  for (const [x, z, r] of [[-26.5, -35.4, 0], [-25.4, -35.4, 0], [-24.3, -35.4, 0],[150, 4.5, Math.PI], [151.1, 4.5, Math.PI], [-120, -34, Math.PI]]) vendingMachine(x, z < -30 && z > -64 && x > -30 && x < 75 ? Y0 + 0.22 : topY(x, z), z, r, vi++, B);
  for (const v of vend) {
    const c = Math.cos(v.lot.r), s = Math.sin(v.lot.r), lx = v.off[0], lz = v.off[1];
    const x = v.lot.x + lx * c + lz * s, z = v.lot.z - lx * s + lz * c;
    for (let k = 0; k < (rng() < 0.5 ? 2 : 1); k++) vendingMachine(x + c * k * 1.1, topY(x, z), z - s * k * 1.1, v.lot.r, vi++, B);
  }
  progress('Stringing power lines', 0.64); await tick();

  // ---------------------------------------------------------------- retaining walls where the streets cut into the foothills
  // Along every road edge, wherever the ground just beyond the corridor stands more than ~0.7 m above the road, a
  // fitted-stone retaining wall (masonry in the old quarter, concrete block with a coping elsewhere) holds the bank back.
  {
    const wallRuns = [];
    for (const R of ROADS) {
      if (R.kind === 'path') continue;
      for (const [a, b] of roadSegs(R)) {
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]), dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
        for (const side of [-1, 1]) {
          const nx = -dz * side, nz = dx * side, off = R.w / 2 + (R.walk || 0) + (R.walk ? 0.1 : 0.55);
          let run = [];
          const flush = () => { if (run.length > 2) wallRuns.push({ pts: run, old: district(run[0][0], run[0][2]) === 'old' }); run = []; };
          for (let t = 0; t <= L; t += 2) {
            const x = a[0] + dx * t + nx * off, z = a[1] + dz * t + nz * off;
            if (Math.abs(x) > 900 || Math.abs(z) > 700 || Math.abs(z + 80) < 14 || Math.abs(x - riverX(z)) < 26 || nearInter(x, z, R, 2)) { flush(); continue; }
            const ry = topY(x - nx * 0.6, z - nz * 0.6), g = hf.groundAt(x + nx * 1.5, z + nz * 1.5);
            if (g - ry > 0.7) run.push([x, ry, z, Math.min(g - ry + 0.25, 4.5)]); else flush();
          }
          flush();
        }
      }
    }
    for (const W of wallRuns) for (let i = 0; i + 1 < W.pts.length; i++) {
      const [x0, y0, z0, h0] = W.pts[i], [x1, y1, z1, h1] = W.pts[i + 1], h = Math.max(h0, h1), yb = Math.min(y0, y1) - 0.3;
      B.frame(0, 0, 0, 0);
      B.beam(W.old ? 'stone' : 'block', [x0, yb + (h + 0.3) / 2, z0], [x1, yb + (h + 0.3) / 2, z1], 0.45, h + 0.3, { color: W.old ? [0.66, 0.64, 0.6] : [0.74, 0.73, 0.7], uv: W.old ? 1.6 : 1.4 });
      B.beam('concrete', [x0, yb + h + 0.36, z0], [x1, yb + h + 0.36, z1], 0.52, 0.12, { color: [0.68, 0.68, 0.66] });
      if (i % 2 === 0) B.detail(2, () => B.cyl('plastic', (x0 + x1) / 2, yb + 0.55, (z0 + z1) / 2, 0.05, 0.05, 0.06, 8, { color: [0.2, 0.2, 0.2] })); // weep hole
      addBox((x0 + x1) / 2, (z0 + z1) / 2, 0.25, 1.05, Math.atan2(x1 - x0, z1 - z0), yb, yb + h);
    }
  }
  // ---------------------------------------------------------------- utility poles and wires
  const allPoles = [];
  for (const R of ROADS) {
    if (R.kind === 'path' || R.id === 'A' && false) continue;
    for (const [a, b] of roadSegs(R)) {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]), dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L, side = R.id.charCodeAt(0) % 2 ? 1 : -1;
      const nx = -dz * side, nz = dx * side, off = R.w / 2 + (R.walk ? R.walk - 0.5 : 0.45);
      const poles = [];
      let k = 0;
      for (let t = 6; t < L - 4; t += 28 + rng() * 6) {
        const x = a[0] + dx * t + nx * off, z = a[1] + dz * t + nz * off;
        if (Math.abs(x) > 700 || Math.abs(z) > 360 || nearInter(x, z, R, 3) || Math.abs(z + 80) < 11 || Math.abs(x - riverX(z)) < 20) { if (poles.length) { wires(poles); poles.length = 0; } continue; }
        if (hf.groundAt(x, z) > Y0 + 3) continue;
        const pole = utilityPole(B, x, hf.groundAt(x, z), z, Math.atan2(dx, dz), rng, { transformer: rng() < 0.25, light: k++ % 2 === 0, side });
        if (pole.lamp) lampPoints.push({ p: pole.lamp, s: 1.0 });
        poles.push(pole); allPoles.push(pole);
      }
      if (poles.length > 1) wires(poles);
    }
  }
  // service drops: every house takes its supply from the nearest pole, a sagging cable to a bracket under the eaves
  {
    const pts = [], cell = new Map(), key = (x2, z2) => Math.floor(x2 / 30) + ',' + Math.floor(z2 / 30);
    for (const p of allPoles) { const k = key(p.pts[0][0], p.pts[0][2]); if (!cell.has(k)) cell.set(k, []); cell.get(k).push(p); }
    for (const lot of lots) {
      const I = lot.info; if (!I || !I.eave) continue;
      const c = Math.cos(lot.r), s2 = Math.sin(lot.r), W2 = (lx, lz) => [lot.x + lx * c + lz * s2, lot.z - lx * s2 + lz * c];
      const front = W2(I.hx, I.hz + I.D / 2);
      let best = null, bd = 32;
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const p of cell.get((Math.floor(front[0] / 30) + i) + ',' + (Math.floor(front[1] / 30) + j)) || []) {
        const q = p.pts.reduce((m, v) => v[1] < m[1] ? v : m, p.pts[0]), d = Math.hypot(q[0] - front[0], q[2] - front[1]);
        if (d < bd) { bd = d; best = q; } }
      if (!best) continue;
      // the corner of the front wall nearer the pole
      const cands = [W2(I.hx - I.W / 2 + 0.3, I.hz + I.D / 2 + 0.05), W2(I.hx + I.W / 2 - 0.3, I.hz + I.D / 2 + 0.05)];
      const a2 = cands.reduce((m, v) => Math.hypot(v[0] - best[0], v[1] - best[2]) < Math.hypot(m[0] - best[0], m[1] - best[2]) ? v : m, cands[0]);
      const y2 = hf.groundAt(lot.x, lot.z) + I.eave - 0.35, span = Math.hypot(a2[0] - best[0], a2[1] - best[2]), sag = 0.15 + span * 0.015;
      for (let s = 0; s < 8; s++) for (const t of [s / 8, (s + 1) / 8]) pts.push(lerp(best[0], a2[0], t), lerp(best[1] - 0.4, y2, t) - sag * 4 * t * (1 - t), lerp(best[2], a2[1], t));
      B.frame(a2[0], y2, a2[1], lot.r); B.detail(2, () => B.box('dark', 0, -0.06, -0.02, 0.06, 0.12, 0.06, { color: [0.2, 0.2, 0.2] })); B.frame(0, 0, 0, 0);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const l = new THREE.LineSegments(g, wireMat); l.frustumCulled = false; scene.add(l);
  }
  // curve mirrors at blind lane junctions: on a corner just behind the kerb line, the dome turned into the junction so a
  // driver edging out of either lane can see along the other; T-junctions get a double mirror on the far side
  for (const I of inters) {
    if (!I.roads.every(r => r.kind === 'lane') || rng() < 0.35 || !I.corners.length) continue;
    const cr = I.corners[Math.floor(rng() * I.corners.length)], mid = cr.arc[Math.floor(cr.arc.length / 2)];
    const ox = cr.O[0] - mid[0], oz = cr.O[1] - mid[1], ol = Math.hypot(ox, oz) || 1, x = mid[0] + ox / ol * 0.75, z = mid[1] + oz / ol * 0.75;
    const face = Math.atan2(I.p[0] - x, I.p[1] - z);
    curveMirror(B, x, topY(x, z), z, face, I.arms.length === 3 ? 2 : 1); shrineSpots.mirrors = (shrineSpots.mirrors || []).concat([[+x.toFixed(1), +z.toFixed(1), +face.toFixed(2)]]);
  }
  // speed-limit signs on B
  for (const z of [-200, 60, 250]) roadSign(B, 110 + 4.55, topY(114.55, z), z, Math.PI / 2 * 0, 'speed30');

  // ---------------------------------------------------------------- rice paddy water surfaces
  for (const [x0, z0, x1, z1] of PADDIES) {
    for (let cx = Math.ceil(x0 / 30) * 30; cx < x1 - 1; cx += 30) for (let cz = Math.ceil(z0 / 20) * 20; cz < z1 - 1; cz += 20) {
      if (!paddyOK(cx + 15, cz + 10)) continue;
      B.frame(0, 0, 0, 0);
      const y = Y0 - 0.3, a = [cx + 1.3, y, cz + 1.3], b = [cx + 28.7, y, cz + 18.7];
      B.quad('paddyWater', [a[0], y, b[2]], [b[0], y, b[2]], [b[0], y, a[2]], [a[0], y, a[2]], { uv: 10 });
    }
    hf.paint2(1, x0, z0, x1, z1, (x, z) => inPaddyZone(x, z) && paddyOK(x, z) && paddyCell(x, z) > 1.4 ? 1 : 0);
  }
  // town lawns are mowed; yards are gravel
  hf.paint2(3, -460, -345, 205, 345, (x, z) => !inPaddyZone(x, z) && hf.groundAt(x, z) < Y0 + 1.5 && Math.abs(x - riverX(z)) > 16 ? 1 : 0);
  for (const lot of lots) hf.paint2(0, lot.x - 10, lot.z - 10, lot.x + 10, lot.z + 10, (x, z) => { const c = Math.cos(lot.r), s = Math.sin(lot.r), dx = x - lot.x, dz = z - lot.z; return Math.abs(dx * c - dz * s) < lot.w / 2 && Math.abs(dx * s + dz * c) < lot.d / 2 ? 0.55 : 0; });
  // shrine approach gravel
  hf.paint2(2, SHRINE.x - 12, SHRINE.z - 40, SHRINE.x + 12, -222, (x, z) => Math.abs(x - SHRINE.x) < 8 || Math.hypot(x - SHRINE.x, z - SHRINE.z + 12) < 16 ? 1 : 0);
  hf.paint2(2, SHRINE.x - 12, SHRINE.z - 40, SHRINE.x + 12, -222, (x, z) => Math.abs(x - SHRINE.x) < 2 ? 1 : 0);

  // ---------------------------------------------------------------- hills: cedar forest
  progress('Planting cedar forests', 0.7); await tick();
  const trees = [], nrm = new THREE.Vector3(), FOREST = new Float32Array(HN * HN);
  for (let j = 0; j < HN; j++) for (let i = 0; i < HN; i++) {
    const x = -HALF + i * CELL, z = -HALF + j * CELL, h = hf.H[j * HN + i];
    // woods climb from ragged tongues at the foot of the hills (satoyama) into the forest above
    const f = smoothstep(Y0 + 2.2, Y0 + 12, h + fbm(x * 0.011 - 4.1, z * 0.011 + 2.7, 3) * 5) * smoothstep(-0.3, 0.1, fbm(x * 0.006 + 3, z * 0.006, 3)) * smoothstep(0.62, 0.8, hf.gridNormalY(i, j));
    const shrineWood = smoothstep(55, 30, Math.hypot(x - SHRINE.x, z - SHRINE.z + 14)) * (Math.hypot(x - SHRINE.x, z - SHRINE.z + 16) > 23 ? 1 : 0) * (z > SHRINE.z + 8 ? smoothstep(10, 15, Math.abs(x - SHRINE.x)) : Math.abs(x - SHRINE.x) > 5 ? 1 : 0); // open lawns along the approach
    // satoyama: woods spill from the foot of the hills onto the valley margins in ragged tongues (outside the town and
    // the paddies), so fields -> woodland -> forest instead of a wall of trees where the slope begins
    const ve = Math.hypot(x / 720, (z + 10) / 440) + fbm(x * 0.004 + 7, z * 0.004 - 2, 3) * 0.12 + fbm(x * 0.013 + 1.3, z * 0.013 - 0.7, 2) * 0.05;
    const outTown = Math.max(smoothstep(440, 520, Math.abs(x)), smoothstep(330, 400, Math.abs(z)));
    const foot = smoothstep(0.7, 0.84, ve) * smoothstep(-0.12, 0.25, fbm(x * 0.009 - 6.2, z * 0.009 + 1.1, 3)) * outTown * (inPaddyZone(x, z) ? 0 : 1) * smoothstep(24, 40, Math.abs(x - riverX(z)));
    let v = Math.max(f, shrineWood, foot * 0.85);
    const edge = smoothstep(HALF - 240, HALF - 20, Math.max(Math.abs(x), Math.abs(z))); // woods continue past the map edge
    if (edge > 0) v = lerp(v, farForestAt(x, z, h, 1 - hf.gridNormalY(i, j), 0, 900), edge);
    FOREST[j * HN + i] = v; hf.mask[(j * HN + i) * 4] = v * 255;
  }
  await hf.bakeAO();
  const MOIST = moistureField(hf, { water: Y0 - 3, streamDist: (x, z) => Math.abs(x - riverX(z)) - 14, dryAbove: [Y0 + 40, Y0 + 180] });
  for (let o = 0; o < HN * HN; o++) hf.mask[o * 4 + 3] = MOIST[o] * 255;
  const occAt = (x, z) => x > -800 && z > -800 && x < 800 && z < 800 && occ[oi(x, z)];
  const free = (x, z, r = 0) => { for (let dz = -r; dz <= r; dz += Math.max(1, r)) for (let dx = -r; dx <= r; dx += Math.max(1, r)) if (occAt(x + dx, z + dz)) return false; return !occAt(x, z); };
  const inCut = (x, z, zc, pw, pe, w) => Math.abs(z - zc) < w && Math.abs(x) < (x < 0 ? pw : pe) + 4; // trees grow over the tunnels
  const wildBlocked = (x, z, pad = 0) => inCut(x, z, -80, PORTALS.railW, PORTALS.railE, 12 + pad) || inCut(x, z, -25, PORTALS.roadW, PORTALS.roadE, 9 + pad) || Math.abs(x - riverX(z)) < 20 + pad
    || inPaddyZone(x, z) && paddyOK(x, z) || !free(x, z, Math.ceil(pad)) || Math.hypot(x - SHRINE.x, z - SHRINE.z + 10) < 26 || Math.abs(x - SHRINE.x) < 9 && z > SHRINE.z && z < -220;
  // cedar plantations dominate the Japanese hills (tall straight sugi), with konara / camphor / maple woods and bamboo
  // groves at their damp feet; the meadow fringe stays out of the town (towngreen.js plants that)
  const { trees: wild, saplings, hash: treeHash } = plantForest({ hf, forest: FOREST, moist: MOIST, seed: 77, water: Y0 - 3, snow: 900, blocked: wildBlocked,
    alpine: [200, 320], lowland: [8, 34], meadow: 700, meadowMaxH: 60, mix: { tall: 3.2, spruce: 0.9, old: 0.7, pine: 0.6, young: 0.9 }, bamboo: 0.55, conifer: 0.9, edgeBroad: 0.45, step: 5.5, spacing: 1.12,
    meadowOK: (x, z) => !(Math.abs(x) < 470 && Math.abs(z) < 350) && !inPaddyZone(x, z) });
  for (const t of wild) trees.push(t);
  // sakura: the town's namesake — a blossom promenade along both river banks and an avenue up the shrine approach
  const riverTrees = [], LB = new LGeo(96), bankClear = z => Math.abs(z + 25) > 13 && Math.abs(z - 200) > 9 && Math.abs(z + 80) > 15;
  const flatTown = (x, z) => { const g = hf.groundAt(x, z); return g > Y0 - 0.5 && g < Y0 + 1.6; };
  for (let z = -520, n = 0; z < 520; z += 8 + srng() * 2.5, n++) {
    if (!bankClear(z)) continue;
    const rx = riverX(z), xe = rx + 21.2 + (srng() - 0.5) * 1.2, xw = rx - 26 + (srng() - 0.5) * 0.8;
    if (flatTown(xe, z)) riverTrees.push({ x: xe, y: hf.groundAt(xe, z) - 0.2, z, s: lerp(7.5, 10, srng()), sx: 1, r: srng() * 6.28, c: sakuraColor(srng) });
    if (flatTown(xw, z) && !occRect(xw, z, 1.3, 1.3, 0, 0, true)) riverTrees.push({ x: xw, y: hf.groundAt(xw, z) - 0.2, z, s: lerp(7, 9.5, srng()), sx: 1, r: srng() * 6.28, c: sakuraColor(srng) });
    // benches facing the water between the trees on the east promenade
    if (n % 5 === 2 && Math.abs(z) < 360 && bankClear(z + 4)) { const bx = riverX(z + 4) + 16.4; bench(LB, bx, Y0 + 0.12, z + 4, -Math.PI / 2); }
  }
  // gravel promenade on the east bank
  hf.paint2(0, 150, -760, 280, 760, (x, z) => { const d = Math.abs(x - riverX(z)); return d > 14 && d < 18.6 ? 1 : 0; });
  for (let z = -284; z < -228; z += 9) for (const sd of [-1, 1]) {
    const x = SHRINE.x + sd * (6.2 + srng() * 0.6), zz = z + (srng() - 0.5) * 1.5;
    if (!occRect(x, zz, 1.0, 1.0, 0, 0, true)) riverTrees.push({ x, y: hf.groundAt(x, zz) - 0.2, z: zz, s: lerp(7, 9, srng()), sx: 1, r: srng() * 6.28, c: sakuraColor(srng) });
    if ((z + 284) % 18 === 0 && z + 4 < -230) lantern(LB, SHRINE.x + sd * 2.8, hf.groundAt(SHRINE.x + sd * 2.8, z + 4) - 0.05, z + 4, 0);
  }
  for (let i = trees.length - 1; i >= 0; i--) if (riverTrees.some(t => Math.hypot(t.x - trees[i].x, t.z - trees[i].z) < 6)) trees.splice(i, 1);
  // weeping willows lean over the water between the cherries (every fifth tree on the east bank)
  riverTrees.forEach((t, i) => { if (i % 5 === 3 && Math.abs(t.x - riverX(t.z) - 21.2) < 1.5) Object.assign(t, makeTree('willow', t.x, t.y, t.z, srng, { a: srng() }), { y: t.y }); else t.kind = 'sakura'; });
  for (const t of riverTrees) (t.kind === 'sakura' ? sakura : trees).push(t);
  for (const t of riverTrees) for (let k = 0; k < 2; k++) if (srng() < 0.55) { // bushes and hydrangeas at the tree feet
    const a = srng() * 6.28, d = 1.6 + srng() * 1.6, x = t.x + Math.cos(a) * d, z = t.z + Math.sin(a) * d, rd = x - riverX(z);
    if (rd > -23.8 && rd < 20.2 || Math.abs(x - SHRINE.x) < 4.5 || Math.abs(rd) > 24 && (occRect(x, z, 0.5, 0.5, 0, 0, true) || inPaddyZone(x, z)) || !bankClear(z)) continue;
    const hy = srng() < 0.55;
    (hy ? hydras : bushes).push({ x, y: hf.groundAt(x, z) - 0.1, z, s: 0.9 + srng() * 0.6, sx: 0.9 + srng() * 0.3, r: srng() * 6.28, c: hy ? hydraColor(srng) : bushColor(srng) });
  }
  // gardens, groves, hedges, the station, the shrine, and the valley floor between the town and the hills
  const LBg = new LGeo(64);
  const green = plantTown({ hf, free, lots, lotW, riverX, inPaddyZone, SHRINE, Y0, PADDIES, stationX: RAIL.stationX, hash: treeHash, B, LB: LBg, bench,
    isShop: (x, z) => Math.abs(z + 25) < 26 && x > -275 && x < 205 || Math.hypot(x - 134, z) < 26 });
  for (const t of green.trees) { t.town = true; (t.kind === 'sakura' ? sakura : trees).push(t); }
  for (const t of schoolSak) { const h = hf.groundAt(t.x, t.z); sakura.push({ town: true, x: t.x, y: h - 0.2, z: t.z, s: lerp(7, 9, srng()), sx: 1, r: srng() * 6.28, c: sakuraColor(srng) }); }
  for (const b of green.bushes) bushes.push(b);
  for (const b of green.hydras) hydras.push(b);
  // under the hill woods: logs, dead branches, low shrubs
  const floor = forestFloor({ hf, forest: FOREST, moist: MOIST, trees, seed: 9, water: Y0 - 3, blocked: wildBlocked, logs: 260, twigs: 2600, shrubs: 1400 });
  for (const b of floor.shrubs) bushes.push(b);
  hf.paintCanopy([...trees, ...sakura]);
  hf.uploadHeight(); hf.uploadMasks();
  progress('Building terrain', 0.76); await tick();
  const firstNatural = scene.children.length;
  const terrainGroup = await buildTerrainMeshes(hf, terrainMaterial(hf, layers, { water: 0, snow: 900, conifer: 0.72 }));
  // the hill woods and the riverside trees are mirrored in the river; garden and street trees, saplings and the
  // forest floor are not (keeps the reflection pass cheap)
  const allTrees = [...trees, ...sakura.map(t => ({ ...t, kind: 'sakura', v: t.v ?? Math.floor(srng() * 4) }))];
  buildTrees(allTrees.filter(t => !t.town));
  for (let i = firstNatural; i < scene.children.length; i++) reflected.add(scene.children[i]);
  buildTrees([...allTrees.filter(t => t.town), ...saplings]);
  buildTrees(floor.twigs, { colliders: false });
  buildLogs(floor.logs);
  const grass = buildGrass(hf, layers.grass.d, { water: 0, snow: 900, reeds: true, shore: 0.9 });
  const water = buildWater(hf, { level: 0, normals: loadTex('tex/waternormals.jpg', false, NFLAT), hide: [grass], waves: 6, strength: 0.3, deep: '#1d5a78', mid: '#2e8f9a', shallow: '#5cc4b0',
    active: c => Math.abs(c.x - riverX(c.z)) < 380 });
  reflected.add(water);

  // flush all static geometry
  progress('Merging geometry', 0.82); await tick();
  B.flush(MT, { paint: false, stopLegend: false, tactileL: false, tactileD: false, manhole: false, glassLit: false, glass: true, window: false, shopWindow: false, paddyWater: false, lamp: false, chain: false, poly: false });
  Bx.flush(MT, { paint: false, tactileL: false, tactileD: false, glassLit: false, window: false, shopWindow: false, lamp: false, poly: false });
  const landmarks = flushLandmarks(LB), parkBenches = flushLandmarks(LBg);

  // ---------------------------------------------------------------- scanned props (gardens, shops)
  const [shrub, potted, planter, crate, ubox, weed, manhole] = await modelsP;
  const prng = mulberry32(99);
  const scatterModel = (model, items, byHeight, dist, shadow = true, split = false) => {
    if (!model || !items.length) return;
    const parts = extractParts(model);
    // scanned props are dense: full detail up close, a clustered low-poly copy beyond ~35 m
    const lods = ps => [{ dist: () => Math.min(35, dist()), parts: ps.map(p => ({ ...p, castShadow: shadow })) }, { dist, parts: ps.map(p => ({ ...p, geometry: decimate(p.geometry, 7), castShadow: shadow })) }];
    if (!split) { normalizeParts(parts, byHeight); new Scatter(items, lods(parts), 128); return; }
    // asset sheets with several plants side by side: every plant becomes its own instanced model
    parts.forEach((p, i) => { normalizeParts([p], byHeight); const mine = items.filter((_, k) => k % parts.length === i); if (mine.length) new Scatter(mine, lods([p]), 128); });
  };
  const shrubs = [], pots = [], weeds = [], crates = [], boxes = [];
  for (const lot of lots) {
    const c = Math.cos(lot.r), s = Math.sin(lot.r), W = (lx, lz) => [lot.x + lx * c + lz * s, lot.z - lx * s + lz * c];
    if (lot.kind === 'house') {
      for (let k = 0; k < 3; k++) if (prng() < 0.7) { const [x, z] = W((prng() - 0.5) * (lot.w - 2), -lot.d / 2 + 0.8 + prng() * 1.2); (k === 1 ? shrubs : bushes).push({ x, y: hf.groundAt(x, z) - 0.1, z, s: 0.9 + prng() * 0.6, sx: 0.9 + prng() * 0.3, r: prng() * 6.28, c: bushColor(prng) }); }
      if (prng() < 0.6 && lot.backSide !== 1) { const [x, z] = W(lot.w / 2 - 0.8, -lot.d / 2 + 0.9); shrubs.push({ x, y: hf.groundAt(x, z), z, s: 1.2 + prng() * 1.0, r: prng() * 6.28 }); }
      for (let k = 0; k < 3; k++) if (prng() < 0.5 && !lot.frontTree) { const [x, z] = W(-lot.w / 2 + 2.6 + prng() * 2.4, lot.d / 2 - 1.1 - prng() * 2); pots.push({ x, y: hf.groundAt(x, z), z, s: 0.35 + prng() * 0.25, r: prng() * 6.28 }); }
    } else if (lot.shop && prng() < 0.4) { const [x, z] = W(lot.w / 2 - 1.2, Math.min(lot.d, 12) / 2 + 0.5); crates.push({ x, y: hf.groundAt(x, z), z, s: 0.45, r: lot.r + (prng() - 0.5) * 0.3 }); if (prng() < 0.5) crates.push({ x, y: hf.groundAt(x, z) + 0.3, z, s: 0.45, r: lot.r + (prng() - 0.5) * 0.3 }); }
    for (let k = 0; k < 4; k++) if (prng() < 0.25) { const [x, z] = W((prng() - 0.5) * lot.w, lot.d / 2 - 0.15); weeds.push({ x, y: hf.groundAt(x, z), z, s: 0.25 + prng() * 0.3, r: prng() * 6.28 }); }
    if (prng() < 0.05) { const [x, z] = W(lot.w / 2 - 0.5, lot.d / 2 + 0.4); boxes.push({ x, y: hf.groundAt(x, z), z, s: 1.3, r: lot.r }); addCircle(x, z, 0.4); }
  }
  scatterModel(shrub, shrubs, true, () => Q.props, true, true);
  buildBushes(bushes, 'bush');
  buildBushes(hydras, 'hydra');
  buildBushes(green.hedges, 'hedge', { collide: false });
  buildBushes(green.ivy, 'ivy', { collide: false, hiDist: () => Q.props * 0.5, farDist: () => Q.props * 1.2 });
  // park shade trees (zelkova and oak) and street trees along the main road's sidewalks outside the shops
  const greenTrees = [];
  for (const t of parkTrees) greenTrees.push(makeTree(drng() < 0.6 ? 'zelkova' : 'oak', t.x, hf.groundAt(t.x, t.z) - 0.2, t.z, drng, { scale: 0.75 }));
  for (const t of streetTrees) greenTrees.push(makeTree('zelkova', t.x, t.y, t.z, drng, { scale: 0.62, a: 0.5 }));
  greenTrees.push(shrineTree);
  buildTrees(greenTrees);
  bicycles(bikeList, drng);
  scatterModel(potted, [...pots, ...green.pots], true, () => Q.props * 0.35);
  scatterModel(weed, [...weeds, ...green.weeds], true, () => Q.props * 0.3, false, true);
  scatterModel(crate, crates, true, () => Q.props * 0.4);
  scatterModel(ubox, boxes, true, () => Q.props * 0.6);
  // sewer manholes: flush cast-iron covers on the sewer line, which runs a little off the crown in one lane
  for (const R of ROADS) if (R.kind !== 'path') for (const [a, b] of roadSegs(R)) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], off = (R.w / 2) * (0.25 + 0.2 * prng()) * (prng() < 0.5 ? -1 : 1);
    for (let t = 20; t < L; t += 45 + prng() * 30) {
      const x = a[0] + d[0] * t - d[1] * off, z = a[1] + d[1] * t + d[0] * off;
      if (Math.abs(x) < 700 && Math.abs(z) < 350 && !onRail(z) && !onBridge(x, z) && !nearInter(x, z, R, 3)) B.detail(1, () => RN.decal(B, 'manhole', [x, z], d, 0.33, 0.33, { uv01: true, lift: 0.004, cell: 0.33, road: false }));
    }
  }
  void manhole;

  // ---------------------------------------------------------------- vehicles
  progress('Starting traffic', 0.9); await tick();
  const crng = mulberry32(7);
  const parked = carSpots.filter(() => crng() < 0.85).map(sp => ({ sp, spec: randomCar(crng, false) }));
  parked.push(...stationCars); // taxis waiting in the station rank beside the island
  // routes (closed loops; driving on the left)
  const loops = [
    { pts: [[-400, -25], [110, -25], [110, -225], [-400, -225]], n: 5, v: 11 },
    { pts: [[-400, -225], [110, -225], [110, -25], [-400, -25]], n: 4, v: 11 },
    { pts: [[-150, -25], [110, -25], [110, 258], [-150, 258]], n: 4, v: 10 },
    { pts: [[-150, 258], [110, 258], [110, -25], [-150, -25]], n: 3, v: 10 },
    { pts: [[-400, 48], [-30, 48], [-30, 188], [-400, 188]], n: 2, v: 8 },
    { pts: [[-1050, -25], [1050, -25]], n: 4, v: 14, open: true },
    { pts: [[1050, -25], [-1050, -25]], n: 4, v: 14, open: true },
  ];
  const routes = loops.map(L => new Route(L.pts, { closed: !L.open, vmax: L.v, lane: L.v > 12 ? 1.75 : L.v > 9 ? 1.5 : 1.05 }));
  // mandatory stops: every stop line we painted that lies on the route with matching heading
  const tmp = {};
  routes.forEach(R => {
    for (let s = 0; s < R.len; s += 1) {
      R.at(s, tmp);
      for (const st of stopSpots) {
        if (Math.hypot(tmp.x - st.x, tmp.z - st.z) < 2.2 && tmp.dx * st.hx + tmp.dz * st.hz > 0.8 && !R.stops.some(q => Math.abs(q.s - s) < 6)) {
          const cr = Math.abs(st.z + 80) < 10 ? crossings.reduce((b, c) => Math.abs(c.x - st.x) < Math.abs(b.x - st.x) ? c : b) : null;
          R.stops.push({ s, crossing: cr, signal: st.signal ? { go: d => signals.go(st.signal, d) } : null });
        }
      }
    }
    R.stops.sort((a, b) => a.s - b.s);
  });
  const moving = [];
  loops.forEach((L, i) => { for (let k = 0; k < L.n; k++) moving.push({ route: routes[i], s: routes[i].len * (k + crng() * 0.5) / L.n, spec: randomCar(crng) }); });
  const fleet = new Fleet([...parked.map(p => p.spec), ...moving.map(m => m.spec)]);
  parked.forEach((p, i) => { const car = fleet.cars[i]; fleet.place(car, p.sp.p[0], p.sp.y ?? hf.groundAt(p.sp.p[0], p.sp.p[2]) + (p.sp.p[1] > Y0 + 0.1 ? 0.14 : 0), p.sp.p[2], p.sp.r + Math.PI / 2, 0, 0, 0); const T = carDims(car.type); addBox(p.sp.p[0], p.sp.p[2], T.L / 2, T.W / 2, p.sp.r + Math.PI / 2, -1e9, Y0 + 1.6); });
  const traffic = new Traffic(fleet, (x, z) => (Math.abs(z + 80) < 6.8 && XINGS.some(([cx, hw]) => Math.abs(x - cx) < hw) ? Y0 + 0.45 : surfaceY(x, z)) - 0.04);
  moving.forEach((m, i) => traffic.add(fleet.cars[parked.length + i], m.route, m.s));
  fleet.commit();
  // trains
  const trains = [new Train(Y0), new Train(Y0)];
  trains[0].start(1, 2); trains[1].start(-1, 40);

  // town geometry, props, vehicles are not reflected by the river (keeps the reflection pass cheap)
  for (const o of scene.children) if (!reflected.has(o)) o.traverse(c => c.layers.set(1));

  // ---------------------------------------------------------------- night lighting: a few real point lights follow the nearest fixtures
  const plights = [];
  for (let i = 0; i < 6; i++) { const l = new THREE.PointLight(0xffd9a8, 0, 22, 2); scene.add(l); plights.push(l); }
  let lightTimer = 0;

  // people on the streets: sidewalks of the main road, lane shoulders, the riverside walkways and the shrine approach
  const walkPaths = [];
  for (const R of ROADS) {
    const pts = R.pts.map(([x, z]) => [clamp(x, -440, 440), clamp(z, -335, 335)]);
    walkPaths.push({ pts, off: R.kind === 'path' ? 1.0 : R.w / 2 + (R.walk ? R.walk / 2 : 0.55), lift: null, w: R.id === 'A' ? 3 : 1 });
  }
  for (const sd of [-1, 1]) for (const [z0, z1] of [[-330, -94], [-66, 330]]) walkPaths.push({ pts: Array.from({ length: 13 }, (_, i) => { const z = lerp(z0, z1, i / 12); return [riverX(z) + sd * 16.1, z]; }), off: 0, lift: null });
  // across the station forecourt: from the main road to the ticket hall, and over the crossing to the bus berths
  walkPaths.push({ pts: [[-2.5, -30.2], [-2.5, -62.8]], off: 1.1, lift: null, w: 2 }, { pts: [[-1, -48.5], [12.7, -48.5], [12.7, -32]], off: 0.4, lift: null });
  const people = pedestrians(walkPaths.flatMap(P => Array(P.w || 1).fill(P)), (x, z) => world.groundAt(x, z), 260);
  const spawn = { x: 107.9, z: -42, yaw: 0.12, pitch: 0.04 }; // edge of road B, looking at the level crossing
  const _n = new THREE.Vector3();
  const world = {
    hf, grass, water, spawn, trains, traffic, crossings, sakura, lots, roadNet: RN, materials: MT, terrain: terrainGroup, shrineSpots,
    bounds: { minX: -990, maxX: 990, minZ: -990, maxZ: 990 },
    groundAt(x, z) {
      const f = forecourt.heightAt(x, z); if (f !== null) return f;
      if (Math.abs(z + 80) < 6.8 && XINGS.some(([cx, hw]) => Math.abs(x - cx) < hw + 0.2)) return Y0 + 0.45; // crossing deck
      const w = RN.walkY(x, z); if (w !== null) return w;
      if (RN.roadAt(x, z)) return surfaceY(x, z);
      const g = hf.groundAt(x, z); if (onBridge(x, z) && (Math.abs(z + 25) < 7 || Math.abs(z - 200) < 3.5)) return Math.max(g, Y0 + 0.35);
      const rd = Math.abs(x - riverX(z)); return rd > 14.55 && rd < 17.65 && Math.abs(z + 78) > 8 ? Math.max(g, Y0 + 0.12) : g; // bank-top walkway
    },
    normalAt: (x, z, out) => hf.normalAt(x, z, out),
    waterAt: (x, z) => Math.abs(x - riverX(z)) < 15 ? 0 : -1e9,
    surfaceAt(x, z, y) {
      if (y !== undefined && y > Y0 + 0.9 && Math.abs(z + 80) < 8) return 'asphalt';
      if (Math.abs(z + 80) < 5.6 && y < Y0 + 0.6) return 'gravel';
      const g = hf.groundAt(x, z);
      if (Math.abs(x - riverX(z)) < 14.5) return g < 0.2 ? 'water' : 'gravel';
      if (inPaddyZone(x, z) && paddyOK(x, z) && paddyCell(x, z) > 1.2) return 'water';
      const m2 = hf.mask2[hf.idx(x, z) * 4 + 2], ur = hf.mask2[hf.idx(x, z) * 4];
      if (m2 > 128) return 'asphalt';
      if (ur > 128) return 'gravel';
      return FOREST[hf.idx(x, z)] > 0.4 ? 'forest' : 'grass';
    },
    ambience(x, z) {
      const rd = Math.abs(x - riverX(z));
      return { forest: FOREST[hf.idx(clamp(x, -HALF, HALF), clamp(z, -HALF, HALF))], water: rd < 40 ? (1 - rd / 40) * 0.6 : 0, town: Math.abs(x) < 450 && Math.abs(z) < 330 ? 1 : 0.3, insects: 0.9 };
    },
    collide(p) { traffic.collide(p); people.collide(p); for (const tr of trains) { const sp = tr.span(); if (!sp) continue; const tz = RAIL.z[tr.track]; if (p.x > sp[0] - 0.4 && p.x < sp[1] + 0.4 && Math.abs(p.z - tz) < 1.9 && p.y < tr.y + 3.5) p.z = tz + Math.sign(p.z - tz || 1) * 1.9; } },
    update(dt, t, cam) {
      updateNight(); updateGlow(); updateLod(cam); landmarks.update(); parkBenches.update(); people.update(dt);
      const pl = { x: cam.position.x, y: cam.position.y - 1.6, z: cam.position.z };
      for (const tr of trains) tr.update(dt, pl);
      for (const c of crossings) c.active = crossingActive(c, trains);
      updateCrossings(dt, t); signals.update(dt);
      traffic.update(dt, pl, night.value > 0.35);
      fleet.commit();
      lightTimer -= dt;
      if (lightTimer < 0) {
        lightTimer = 0.5;
        const on = night.value > 0.25;
        const near = on ? lampPoints.map(l => ({ l, d: Math.hypot(l.p[0] - cam.position.x, l.p[2] - cam.position.z) })).sort((a, b) => a.d - b.d).slice(0, plights.length) : [];
        plights.forEach((L, i) => { const n = near[i]; if (n && n.d < 90) { L.position.set(n.l.p[0], n.l.p[1] - 0.2, n.l.p[2]); L.userData.target = 18 * n.l.s * night.value; } else L.userData.target = 0; });
      }
      for (const L of plights) L.intensity = lerp(L.intensity, L.userData.target || 0, 1 - Math.exp(-dt * 4));
    },
  };
  // signage LOD: canvas-textured signs, plates and machine fronts are separate meshes (one texture each); they cast no
  // shadow (thin plates) and are skipped past ~190 m, where they are a few pixels — ~1700 fewer draws per pass
  const smallSigns = [];
  scene.traverse(o => { if (!o.isMesh || o.isInstancedMesh || o.parent !== scene || !o.material || !o.material.map || !o.material.map.isCanvasTexture) return;
    o.geometry.computeBoundingSphere(); if (o.geometry.boundingSphere.radius > 4) return; o.castShadow = false; smallSigns.push(o); });
  let signTick = 0;
  const baseUpdate = world.update;
  world.update = (dt, t, cam) => { baseUpdate(dt, t, cam);
    if (signTick++ % 6 === 0) { const R = 190 * (Q.lodScale || 1), R2 = R * R, p = cam.position;
      for (const o of smallSigns) { const dx = o.position.x - p.x, dz = o.position.z - p.z; o.visible = dx * dx + dz * dz < R2; } } };
  people.update(0);
  return world;
}
