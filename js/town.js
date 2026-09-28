// "Sakuragawa" — a small Japanese town in a valley: station and level crossings, commuter trains, traffic,
// houses and shops, utility poles, a river with concrete banks, rice paddies and cedar-covered hills.
import { THREE, scene, Q, S, clamp, lerp, smoothstep, mulberry32, tick, fbm, erosion, loadTex, phTex, NFLAT, loadModel, extractParts, normalizeParts,
  Scatter, addBox, addCircle, addPlatform, colliders, decimate } from './core.js';
import { Heightfield, terrainMaterial, buildTerrainMeshes, buildGrass, buildWater, farForestAt } from './terrain.js';
import { buildTrees, buildBushes, buildLogs, sakuraColor, bushColor, hydraColor, leafColor } from './trees.js';
import { plantForest, forestFloor, moistureField, makeTree } from './ecology.js';
import { plantTown } from './towngreen.js';
import { nobori, standBoard, postBox, busStop, garbagePoint, dryingRack, mailbox, crosswalk, playground, school, pedestrians, constructionSite, streetShrine } from './towndeco.js';
import { GeoBuilder as LGeo, lantern, bench, flushLandmarks } from './landmarks.js';
import { house, shopBuilding, konbini, apartment, warehouse, carPark, allotment } from './building.js';
import { shrineCompound } from './shrine.js';
import { GeoBuilder, materials, night, updateNight, updateGlow, updateLod, utilityPole, wires, curveMirror, roadSign,
  vendingMachine, stopMat, lampPoints, signMesh, JP_FONT, bicycles, clockPole, chochin } from './townkit.js';
import { RAIL, buildRailway, buildCrossing, updateCrossings, crossings, crossingActive, Train, tunnelPortal } from './rail.js';
import { Fleet, Traffic, Route, randomCar, carDims } from './traffic.js';
import { planRoads } from './roads.js';

export const meta = { name: 'Sakuragawa 桜川', startHour: 16.6, sunAzimuth: 2.6 };
const Y0 = 6;
const riverX = z => 215 + 22 * Math.sin(z * 0.0075) + 8 * Math.sin(z * 0.021 + 1);
const PADDIES = [[-650, -330, -430, -110], [-650, -40, -430, 330], [262, 0, 650, 330], [262, -330, 650, -100]];
const inPaddyZone = (x, z) => PADDIES.some(([a, b, c, d]) => x > a && x < c && z > b && z < d);
const SHRINE = { x: -60, z: -300 };
const LEVEL = [[-147, 190, -32.5, 256]]; // school block

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
  const h = baseHeight(x, z);
  // rice paddies: flat terraces with levees
  if (inPaddyZone(x, z) && paddyOK(x, z)) { const e = paddyCell(x, z); return Y0 - (e > 1.2 ? 0.35 : 0.05); }
  return h;
}

// ---------------------------------------------------------------- road network
// kind: main > road > lane > path ; w = carriageway width
const ROADS = [
  { id: 'A', kind: 'main', w: 7.0, walk: 2.5, center: 'yellow', pts: [[-PORTALS.roadW - 30, -25], [PORTALS.roadE + 30, -25]], mat: 'asphalt' },
  { id: 'B', kind: 'road', w: 6.0, walk: 2.0, center: 'white', pts: [[110, -340], [110, 330]], mat: 'asphalt' },
  { id: 'C', kind: 'lane', w: 5.0, pts: [[-150, -300], [-150, 300]], mat: 'asphalt', age: 0.55 },
  { id: 'D', kind: 'lane', w: 5.0, pts: [[-400, -312], [-400, 322]], mat: 'asphalt', age: 0.8 },
  ...[48, 118, 188, 258].map((z, i) => ({ id: 'S' + i, kind: 'lane', w: 4.2, pts: [[-400, z], [110, z]], mat: 'asphalt', age: [0.62, 0.85, 0.3, 0.5][i] })),
  ...[-150, -225].map((z, i) => ({ id: 'N' + i, kind: 'lane', w: 4.2, pts: [[-400, z], [110, z]], mat: 'asphalt', age: [0.9, 0.7][i] })),
  ...[-275, -30].map((x, i) => ({ id: 'V' + i, kind: 'lane', w: 4.0, pts: [[x, -25], [x, 258]], mat: 'asphalt', age: [0.78, 0.45][i] })),
  ...[-275, -30].map((x, i) => ({ id: 'W' + i, kind: 'lane', w: 4.0, pts: [[x, -100], [x, -225]], mat: 'asphalt', age: [0.92, 0.66][i] })),
  { id: 'R', kind: 'lane', w: 4.5, pts: Array.from({ length: 34 }, (_, i) => { const z = -335 + i * 20; return [riverX(z) - 21, z]; }), mat: 'asphalt', age: 0.6 },
  { id: 'F', kind: 'lane', w: 4.0, pts: [[110, 200], [640, 200]], mat: 'asphalt', age: 0.95 },
  { id: 'P', kind: 'path', w: 3.0, pts: [[SHRINE.x, -225], [SHRINE.x, SHRINE.z + 4]], mat: 'gravelPath' },
];
const RANK = { main: 3, road: 2, lane: 1, path: 0 };

function segInter(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]], den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den, u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  if (t < -0.02 || t > 1.02 || u < -0.02 || u > 1.02) return null;
  return [a[0] + r[0] * t, a[1] + r[1] * t];
}
function roadSegs(R) { const out = []; for (let i = 0; i + 1 < R.pts.length; i++) out.push([R.pts[i], R.pts[i + 1]]); return out; }
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
  const crossings = [], stops = [];
  for (const I of inters) {
    const [r1, r2] = I.roads;
    const [major, minor] = RN.RANK[r1.kind] >= RN.RANK[r2.kind] ? [r1, r2] : [r2, r1];
    if (minor.kind === 'path' || onBridge(I.p[0], I.p[1])) continue;
    const band = 4;
    for (const arm of I.arms) {
      const R = arm.n.R, other = arm.n.R === r1 ? r2 : r1;
      const hasX = (R.id === 'A' || R.id === 'B') && Math.abs(I.p[0]) < 460 && Math.abs(I.p[1]) < 340;
      const d = other.w / 2 + I.rF + 0.4 + band / 2;
      const cq = RN.sampleAt(arm.n, clamp(arm.s + arm.dir * d, 0, arm.n.PL.len));
      if (hasX && !onBridge(cq.x, cq.z)) crossings.push({ id: R.id, s: arm.s + arm.dir * d, band }); else if (hasX) continue;
      if (R === minor || R.kind === major.kind && R === r2 && R.kind === 'lane') {
        const ds = hasX ? d + band / 2 + 1.2 : arm.L + 0.3;
        const ss = arm.s + arm.dir * ds; if (ss < 1 || ss > arm.n.PL.len - 1) continue;
        stops.push({ id: R.id, s: ss, dir: -arm.dir, arm, sign: true });
      }
    }
  }
  RN.build(B, { crossings });
  // occupancy + masks along every road (lots keep off the carriageway and sidewalks; no grass pokes through)
  for (const R of ROADS) {
    const hw = R.w / 2;
    for (const [a, b] of roadSegs(R)) {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]), dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
      for (let t = 0; t <= L; t += 1) {
        const x = a[0] + dx * t, z = a[1] + dz * t;
        if (Math.abs(x) > 800 || Math.abs(z) > 800) continue;
        occRect(x, z, hw + (R.walk || 0) + 1, 1, Math.atan2(dx, dz), 1);
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
  const addStop = (id, s, dir, sign, legend = true) => {
    RN.stop(B, id, s, dir, { legend });
    const n = RN.byId.get(id), q = RN.sampleAt(n, s), hx = q.d[0] * dir, hz = q.d[1] * dir;
    if (sign) { const off = n.hw + (n.walk ? n.walk - 0.45 : 0.75), x = q.x - hz * off, z = q.z + hx * off; roadSign(B, x, topY(x, z), z, Math.atan2(-hx, -hz), 'stop'); }
    stopSpots.push({ x: q.x, z: q.z, hx, hz });
  };
  for (const st of stops) addStop(st.id, st.s, st.dir, st.sign);
  // level crossings on B, C, D
  const crossingRoads = ROADS.filter(R => ['B', 'C', 'D'].includes(R.id));
  const Bx = new GeoBuilder(192);
  const railInfo = buildRailway({ y0: Y0, riverX, B: Bx });
  for (const R of crossingRoads) {
    const x = R.pts[0][0];
    buildCrossing(Bx, x, Y0, R.w + 2 * (R.walk || 0) + 0.4);
    for (const dir of [-1, 1]) addStop(R.id, sOf(R.id, x, -80 - dir * 8.6), dir, false);
    const sgn = [[-1, -89.5], [1, -70.5]];
    for (const [sd, z] of sgn) { const sx = x + sd * (R.w / 2 + (R.walk ? R.walk - 0.5 : 1.4)); roadSign(B, sx, topY(sx, z + sd * 2), z + sd * 2, sd > 0 ? 0 : Math.PI, 'crossing'); }
  }
  // occupancy/masks for railway corridor, river corridor, station
  occRect(0, -80, 1000, 13, 0, 1);
  for (let z = -800; z < 800; z += 1) { const rx = riverX(z); occRect(rx, z, 24, 0.6, 0, 1); }
  hf.paint2(2, -PORTALS.railW, -92, PORTALS.railE, -68, (x, z) => Math.abs(z + 80) < 11 ? 1 : 0);
  // station plaza
  B.frame(0, 0, 0, 0);
  B.box('pavement', RAIL.stationX + 6, Y0 - 0.2, -47.5, 64, 0.34, 32, { color: [0.86, 0.85, 0.82], uv: 1.2, skip: 'ny' });
  occRect(RAIL.stationX + 6, -47.5, 34, 17, 0, 1);
  hf.paint2(2, -60, -66, 75, -30, () => 1); hf.paint2(0, -60, -66, 75, -30, () => 1);
  addPlatform(RAIL.stationX + 6, -47.5, 32, 16, 0, Y0 + 0.14);
  { // plaza furniture: bicycle parking under a shelter, clock, bus stop
    const py = Y0 + 0.14, prng0 = mulberry32(55), bikes = [];
    for (let row = 0; row < 2; row++) for (let i = 0; i < 16; i++) if (prng0() < 0.85) bikes.push({ x: 20 + i * 0.62, y: py, z: -58 + row * 2.6, r: Math.PI / 2 + (row ? Math.PI : 0) + (prng0() - 0.5) * 0.1 });
    bicycles(bikes.map(b => ({ ...b, x: b.x + 6 })), prng0);
    B.frame(35.6, py, -56.7, 0);
    for (const sx of [-5.2, 5.2]) for (const sz of [-2.2, 2.2]) B.box('alu', sx, 0, sz, 0.1, 2.3, 0.1, { color: [0.55, 0.58, 0.6] });
    B.box('roofMetal', 0, 2.3, 0, 11, 0.08, 5.2, { color: [0.35, 0.45, 0.5], uv: 2 });
    addBox(35.6, -56.7, 5.4, 2.4, 0, -1e9, py + 1.2);
    clockPole(B, -6, py, -40);
    for (const z of [-58, -55.4]) addBox(30.7, z, 5.2, 0.35, 0, -1e9, py + 1.1);
  }
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
      // railing: rails follow the bank's curve segment by segment, posts every 2 m
      const ra = xa + sd * 0.4, rb = xb + sd * 0.4, rc = { color: [0.3, 0.52, 0.47] };
      B.beam('alu', [ra, Y0 + 1.07, z], [rb, Y0 + 1.07, z + 4], 0.07, 0.07, rc);
      B.beam('alu', [ra, Y0 + 0.62, z], [rb, Y0 + 0.62, z + 4], 0.035, 0.035, rc);
      for (const k of [0, 0.5]) B.box('alu', lerp(ra, rb, k), Y0 + 0.1, z + 4 * k, 0.06, 0.97, 0.06, rc);
      addBox((ra + rb) / 2, z + 2, 0.1, 2.05, Math.atan2(rb - ra, 4));
    }
  }
  for (const [bz, bw] of [[-25, 7 + 5], [200, 4.0 + 1]]) {
    const rx = riverX(bz);
    B.frame(rx, Y0, bz, 0);
    B.box('concrete', 0, -0.9, 0, 34, 1.2, bw + 1.2, { color: [0.74, 0.74, 0.72], uv: 3 });
    for (const sd of [-1, 1]) { B.box('concrete', 0, 0.3, sd * (bw / 2 + 0.45), 34, 0.8, 0.3, { color: [0.78, 0.78, 0.76], uv: 3 }); addBox(rx, bz + sd * (bw / 2 + 0.45), 17, 0.2, 0); }
    for (const px of [-7, 7]) B.box('concrete', px, -8, 0, 1.6, 6.5, bw, { color: [0.7, 0.7, 0.68], uv: 3 });
    addPlatform(rx, bz, 17, bw / 2 + 0.3, 0, Y0 + 0.35);
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
  reserve(apt.x, apt.z, apt.w / 2 + 3.6, apt.d / 2 + 3.2, apt.r);
  apartment(B, { ...apt, y: hf.groundAt(apt.x, apt.z) }, rng, extras);
  B.frame(0, 0, 0, 0); B.box('asphaltLane2', apt.x, Y0 - 0.1, 126, 34, 0.15, 11, { uv: 4, skip: 'ny' });
  hf.paint2(2, apt.x - 18, 118, apt.x + 18, 146, () => 1);
  for (let i = 0; i < 6; i++) carSpots.push({ p: [apt.x - 14 + i * 5.5, Y0, 127], r: 0 });
  // shrine
  const shrineInfo = shrineCompound(B, { lac: 'plastic', dark: 'plastic', wood: 'wood', stone: 'concrete', roof: 'roofMetal', glow: 'lamp', paper: 'plain', rope: 'plain', metal: 'steel', water: 'glass' },
    SHRINE.x, hf.groundAt(SHRINE.x, SHRINE.z), SHRINE.z, 0, extras, mulberry32(808));
  for (const p of shrineInfo.lamps) lampPoints.push({ p, s: 0.35 });
  hf.paint2(0, SHRINE.x - 11, SHRINE.z - 38, SHRINE.x + 11, SHRINE.z + 5, (x2, z2) => Math.abs(x2 - SHRINE.x) < 10 && z2 < SHRINE.z + 4 ? 1 : 0);   // gravel precinct
  hf.paint2(2, SHRINE.x - 11, SHRINE.z - 38, SHRINE.x + 11, SHRINE.z + 5, (x2, z2) => Math.abs(x2 - SHRINE.x) < 9.5 && z2 < SHRINE.z + 4 && z2 > SHRINE.z - 37 ? 1 : 0);
  reserve(SHRINE.x, SHRINE.z - 15, 12.5, 24.5, 0);
  // an elementary school fills the block between lanes C, V1, S2 and S3; a playground park opens onto lane S0
  const drng = mulberry32(2024), schoolSak = [], parkTrees = [], bikeList = [];
  const SCH = { x: -89.75, z: 223, w: 113, d: 64 }, PK = { x: -212, z: 69.5, w: 42, d: 32 };
  reserve(SCH.x, SCH.z, SCH.w / 2 + 1, SCH.d / 2 + 1, 0);
  school(B, SCH.x, hf.groundAt(SCH.x, SCH.z), SCH.z, Math.PI, SCH.w, SCH.d, drng, schoolSak, bikeList, extras);
  hf.paint2(0, SCH.x - SCH.w / 2, SCH.z - SCH.d / 2, SCH.x + SCH.w / 2, SCH.z + SCH.d / 2, (x, z) => Math.abs(x - SCH.x) < SCH.w / 2 - 4 && Math.abs(z - SCH.z) < SCH.d / 2 - 4 ? 1 : 0);
  hf.paint2(2, SCH.x - SCH.w / 2, SCH.z - SCH.d / 2, SCH.x + SCH.w / 2, SCH.z + SCH.d / 2, (x, z) => Math.abs(x - SCH.x) < SCH.w / 2 - 4.5 && Math.abs(z - SCH.z) < SCH.d / 2 - 4.5 || Math.abs(x - SCH.x) < 4.5 && z < SCH.z ? 1 : 0);
  hf.paint2(0, SCH.x - 6, SCH.z - SCH.d / 2 - 2, SCH.x + 6, SCH.z, (x, z) => Math.abs(x - SCH.x) < 4.2 ? 1 : 0); // paved way in from the gate
  reserve(PK.x, PK.z, PK.w / 2 + 1, PK.d / 2 + 1, 0);
  playground(B, PK.x, hf.groundAt(PK.x, PK.z), PK.z, Math.PI, PK.w, PK.d, drng, parkTrees, extras);
  hf.paint2(0, PK.x - PK.w / 2, PK.z - PK.d / 2, PK.x + PK.w / 2, PK.z + PK.d / 2, (x, z) => Math.abs(x - PK.x) < PK.w / 2 - 4 && Math.abs(z - PK.z) < PK.d / 2 - 4 ? 1 : 0);
  hf.paint2(2, PK.x - PK.w / 2, PK.z - PK.d / 2, PK.x + PK.w / 2, PK.z + PK.d / 2, (x, z) => Math.abs(x - PK.x) < PK.w / 2 - 4.5 && Math.abs(z - PK.z) < PK.d / 2 - 4.5 ? 1 : 0);

  // parcels along every road: frontage lots facing the road, flag lots (旗竿地) behind them; lot sizes and uses follow the
  // district (old quarter, river neighbourhood, newer estates, the service yards along lane F)
  const district = (x2, z2) => Math.abs(x2 - riverX(z2)) < 80 ? 'river' : x2 < -250 || (z2 < -110 && x2 < 0) ? 'old' : z2 > 140 || x2 > 150 ? 'new' : 'mid';
  const lots = [];
  for (const R of ROADS) {
    if (R.kind === 'path') continue;
    const ind = R.id === 'F';
    for (const [a, b] of roadSegs(R)) {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]), dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
      for (const side of [-1, 1]) {
        const nx = -dz * side, nz = dx * side;
        if (R.id === 'R' && Math.abs(a[0] + nx * 10 - riverX(a[1] + nz * 10)) < Math.abs(a[0] - riverX(a[1]))) continue; // not on the river side
        let t = 4 + rng() * 2;
        while (t < L - 4) {
          const dist = ind ? 'yard' : district(a[0] + dx * t, a[1] + dz * t);
          const w = ind ? 18 + rng() * 6 : dist === 'old' ? 8.5 + rng() * 3 : dist === 'new' ? 11 + rng() * 4 : 10 + rng() * 3.5;
          const d = ind ? 17 + rng() * 4 : dist === 'old' ? 14 + rng() * 4 : 13.5 + rng() * 3;
          const set = (R.w / 2 + (R.walk || 0) + (dist === 'new' ? 1.2 : 0.7));
          const cx = a[0] + dx * (t + w / 2) + nx * (set + d / 2), cz = a[1] + dz * (t + w / 2) + nz * (set + d / 2);
          const r = Math.atan2(-nx, -nz);
          t += w + (dist === 'old' ? 0.15 : 0.3 + rng() * 0.6);
          if (Math.abs(cx) > 640 || Math.abs(cz) > 345 || inPaddyZone(cx, cz)) continue;
          if (hf.groundAt(cx, cz) > Y0 + 1.2 || hf.groundAt(cx, cz) < Y0 - 0.6) continue;
          if (occRect(cx, cz, w / 2, d / 2, r, 0, true)) continue;
          if (rng() < 0.04) continue; // empty lot
          occRect(cx, cz, w / 2, d / 2, r, 1);
          const shop = R.id === 'A' && cx > -270 && cx < 200;
          const roll = rng(), kind = ind ? 'yard' : shop ? 'shop' : roll < 0.06 ? 'carpark' : roll < 0.1 && dist !== 'new' ? 'garden' : 'house';
          lots.push({ x: cx, z: cz, r, w, d, shop, road: R, kind, district: dist });
          // flag lot behind (旗竿地) reached by a narrow driveway beside the front lot
          if (!shop && !ind) for (let row = 1; row <= 2; row++) {
            const off = (d + 0.6) * row, bw = 10 + rng() * 3, bd = 13 + rng() * 3;
            const bx = cx - nx * off, bz = cz - nz * off;
            if (Math.abs(bx) > 640 || Math.abs(bz) > 345 || inPaddyZone(bx, bz) || hf.groundAt(bx, bz) > Y0 + 1.2) break;
            if (occRect(bx, bz, bw / 2, bd / 2, r, 0, true)) break;
            occRect(bx, bz, bw / 2, bd / 2, r, 1);
            lots.push({ x: bx, z: bz, r, w: bw, d: bd, shop: false, road: R, back: true, kind: rng() < 0.08 ? 'garden' : 'house', district: dist });
          }
        }
      }
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
    if (lot.kind === 'yard') { warehouse(B, { x: lot.x, y, z: lot.z, r: lot.r, w: lot.w, d: lot.d }, rng, extras); continue; }
    if (lot.kind === 'carpark') { for (const sp of carPark(B, { x: lot.x, y, z: lot.z, r: lot.r, w: lot.w, d: lot.d }, rng, extras)) if (rng() < 0.6) carSpots.push(sp);
      hf.paint2(2, lot.x - 10, lot.z - 10, lot.x + 10, lot.z + 10, (x2, z2) => { const c = Math.cos(lot.r), s2 = Math.sin(lot.r), dx = x2 - lot.x, dz = z2 - lot.z; return Math.abs(dx * c - dz * s2) < lot.w / 2 && Math.abs(dx * s2 + dz * c) < lot.d / 2 ? 1 : 0; }); continue; }
    if (lot.kind === 'garden') { allotment(B, { x: lot.x, y, z: lot.z, r: lot.r, w: lot.w, d: lot.d }, rng);
      hf.paint2(2, lot.x - 10, lot.z - 10, lot.x + 10, lot.z + 10, (x2, z2) => { const c = Math.cos(lot.r), s2 = Math.sin(lot.r), dx = x2 - lot.x, dz = z2 - lot.z; return Math.abs(dx * c - dz * s2) < lot.w / 2 - 0.5 && Math.abs(dx * s2 + dz * c) < lot.d / 2 - 1 ? 1 : 0; }); continue; }
    if (lot.shop) {
      shopBuilding(B, { x: lot.x, y, z: lot.z, r: lot.r, w: lot.w, d: Math.min(lot.d, 12) }, rng, extras);
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
      const info = house(B, { x: lot.x, y, z: lot.z, r: lot.r, w: lot.w, d: lot.d, district: lot.district }, rng, extras);
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
  // kerbs, sidewalks, gutters and curb returns, now that every driveway is known
  RN.buildEdges(B, { tactile: n => n.R.id === 'A' });
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
    for (const sd of [-1, 1]) { B.box('wood', 0, 0.1, sd * 6.35, 0.15, 5.35, 0.15, { color: [0.52, 0.37, 0.26] }); B.box('wood', 0, 5.4, sd * 6.35, 0.2, 0.08, 0.2, { color: [0.3, 0.22, 0.16] }); addCircle(x, -25 + sd * 6.35, 0.16); }
    const N = 10, pt = i => { const t = i / N; return [0, 5.2 - 0.75 * 4 * t * (1 - t), -6.35 + 12.7 * t]; };
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
  for (const [x, z, r] of [[RAIL.stationX + 18, -35.5, 0], [RAIL.stationX + 19.1, -35.5, 0], [RAIL.stationX + 20.2, -35.5, 0], [150, 4.5, Math.PI], [151.1, 4.5, Math.PI], [-120, -34, Math.PI]]) vendingMachine(x, Y0 + (z < -30 && z > -64 && x > -30 && x < 75 ? 0.14 : 0), z, r, vi++);
  for (const v of vend) {
    const c = Math.cos(v.lot.r), s = Math.sin(v.lot.r), lx = v.off[0], lz = v.off[1];
    const x = v.lot.x + lx * c + lz * s, z = v.lot.z - lx * s + lz * c;
    for (let k = 0; k < (rng() < 0.5 ? 2 : 1); k++) vendingMachine(x + c * k * 1.1, hf.groundAt(x, z), z - s * k * 1.1, v.lot.r, vi++);
  }
  // little street shrines on free corners where lanes meet
  { const shr = mulberry32(2718); let placed = 0;
    for (const I of inters) {
      if (placed >= 5 || I.roads.some(R => R.kind !== 'lane') || shr() > 0.5) continue;
      const [a, b] = I.roads, off = Math.max(a.w, b.w) / 2 + 1.6;
      for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const x = I.p[0] + sx * off, z = I.p[1] + sz * off;
        if (occRect(x, z, 0.9, 0.8, 0, 0, true) || Math.abs(x - riverX(z)) < 30) continue;
        streetShrine(B, x, hf.groundAt(x, z), z, Math.atan2(-sx, -sz)); occRect(x, z, 0.9, 0.8, 0, 1); placed++; break;
      }
    } }
  progress('Stringing power lines', 0.64); await tick();

  // ---------------------------------------------------------------- utility poles and wires
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
        poles.push(pole);
      }
      if (poles.length > 1) wires(poles);
    }
  }
  // curve mirrors at lane junctions
  for (const I of inters) {
    if (!I.roads.every(r => r.kind === 'lane') || rng() < 0.4) continue;
    const x = I.p[0] + 3.4, z = I.p[1] + 3.4;
    if (occRect(x, z, 0.2, 0.2, 0, 0, true) && rng() < 0.5) continue;
    curveMirror(B, x, hf.groundAt(x, z), z, Math.PI * 1.25);
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
  await buildTerrainMeshes(hf, terrainMaterial(hf, layers, { water: 0, snow: 900, conifer: 0.72 }));
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
  B.flush(MT, { paint: false, stopLegend: false, tactileL: false, tactileD: false, glassLit: false, glass: true, window: false, shopWindow: false, paddyWater: false, lamp: false, chain: false, poly: false });
  Bx.flush(MT, { paint: false });
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
  greenTrees.push(makeTree('zelkova', shrineInfo.tree[0], shrineInfo.tree[1] - 0.2, shrineInfo.tree[2], mulberry32(31), { scale: 1.25 })); // the shrine's sacred tree
  buildTrees(greenTrees);
  bicycles(bikeList, drng);
  scatterModel(potted, [...pots, ...green.pots], true, () => Q.props * 0.35);
  scatterModel(weed, [...weeds, ...green.weeds], true, () => Q.props * 0.3, false, true);
  scatterModel(crate, crates, true, () => Q.props * 0.4);
  scatterModel(ubox, boxes, true, () => Q.props * 0.6);
  // manholes in roads
  const holes = [];
  for (const R of ROADS) if (R.kind !== 'path') for (const [a, b] of roadSegs(R)) { const L = Math.hypot(b[0] - a[0], b[1] - a[1]); for (let t = 20; t < L; t += 45 + prng() * 30) { const x = lerp(a[0], b[0], t / L), z = lerp(a[1], b[1], t / L); if (Math.abs(x) < 700 && Math.abs(z) < 350 && !onRail(z) && !onBridge(x, z)) holes.push({ x, y: surfaceY(x, z) - 0.01, z, s: 0.7, r: prng() * 6.28 }); } }
  scatterModel(manhole, holes, false, () => Q.props * 0.5, false);

  // ---------------------------------------------------------------- vehicles
  progress('Starting traffic', 0.9); await tick();
  const crng = mulberry32(7);
  const parked = carSpots.filter(() => crng() < 0.85).map(sp => ({ sp, spec: randomCar(crng, false) }));
  // taxis waiting at the station
  for (let i = 0; i < 3; i++) parked.push({ sp: { p: [RAIL.stationX + 30 - i * 5.2, Y0 + 0.14, -41], r: -Math.PI / 2 }, spec: { type: 'taxi', color: [0.08, 0.1, 0.2] } });
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
          R.stops.push({ s, crossing: cr });
        }
      }
    }
    R.stops.sort((a, b) => a.s - b.s);
  });
  const moving = [];
  loops.forEach((L, i) => { for (let k = 0; k < L.n; k++) moving.push({ route: routes[i], s: routes[i].len * (k + crng() * 0.5) / L.n, spec: randomCar(crng) }); });
  const fleet = new Fleet([...parked.map(p => p.spec), ...moving.map(m => m.spec)]);
  parked.forEach((p, i) => { const car = fleet.cars[i]; fleet.place(car, p.sp.p[0], hf.groundAt(p.sp.p[0], p.sp.p[2]) + (p.sp.p[1] > Y0 + 0.1 ? 0.14 : 0), p.sp.p[2], p.sp.r + Math.PI / 2, 0, 0, 0); const T = carDims(car.type); addBox(p.sp.p[0], p.sp.p[2], T.L / 2, T.W / 2, p.sp.r + Math.PI / 2, -1e9, Y0 + 1.6); });
  const traffic = new Traffic(fleet, (x, z) => surfaceY(x, z) - 0.04);
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
    if (R.id === 'F') continue;
    const pts = R.pts.map(([x, z]) => [clamp(x, -440, 440), clamp(z, -335, 335)]);
    walkPaths.push({ pts, off: R.kind === 'path' ? 1.0 : R.w / 2 + (R.walk ? R.walk / 2 : 0.55), lift: null, w: R.id === 'A' ? 3 : 1 });
  }
  for (const sd of [-1, 1]) for (const [z0, z1] of [[-330, -94], [-66, 330]]) walkPaths.push({ pts: Array.from({ length: 13 }, (_, i) => { const z = lerp(z0, z1, i / 12); return [riverX(z) + sd * 16.1, z]; }), off: 0, lift: null });
  const people = pedestrians(walkPaths.flatMap(P => Array(P.w || 1).fill(P)), (x, z) => world.groundAt(x, z), 260);
  const spawn = { x: 107.9, z: -42, yaw: 0.12, pitch: 0.04 }; // edge of road B, looking at the level crossing
  const _n = new THREE.Vector3();
  const world = {
    hf, grass, water, spawn, trains, traffic, crossings, sakura,
    bounds: { minX: -990, maxX: 990, minZ: -990, maxZ: 990 },
    groundAt(x, z) {
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
      updateCrossings(dt, t);
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
  people.update(0);
  return world;
}
