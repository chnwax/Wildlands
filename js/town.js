// "Sakuragawa" — a small Japanese town in a valley: station and level crossings, commuter trains, traffic,
// houses and shops, utility poles, a river with concrete banks, rice paddies and cedar-covered hills.
import { THREE, scene, Q, S, clamp, lerp, smoothstep, mulberry32, tick, fbm, erosion, loadTex, phTex, NFLAT, loadModel, extractParts, normalizeParts, flushProps,
  Scatter, addBox, addCircle, addPlatform, colliders, decimate, withScatterMeta } from './core.js';
import { Heightfield, terrainMaterial, buildTerrainMeshes, buildGrass, buildWater, farForestAt, pondWaterMaterial, flowWaterMaterial, foamMaterial } from './terrain.js';
import { buildTrees, buildBushes, buildLogs, sakuraColor, bushColor, hydraColor, leafColor } from './trees.js';
import { plantForest, forestFloor, moistureField, makeTree } from './ecology.js';
import { plantTown } from './towngreen.js';
import { nobori, standBoard, postBox, busStop, garbagePoint, dryingRack, mailbox, crosswalk, playground, school, pedestrians, constructionSite, streetShrine, chainMaterial, tennisCourts } from './towndeco.js';
import { GeoBuilder as LGeo, lantern, bench, flushLandmarks, landmarkMaterials } from './landmarks.js';
import { house, shopBuilding, konbini, apartment, warehouse, carPark, allotment, greenhouse, field, inFrame, shedRoof } from './building.js';
import { shrineCompound, sacredRope } from './shrine.js';
import { stationForecourt } from './station.js';
import { buildCityLights, enableCityLights, cityLightU } from './citylights.js';
import { buildCrops, updateCrops } from './crops.js';
import { loadCrowd } from './crowd.js';
import { setTownGlow } from './sky.js';
import { keepArrays, GeoBuilder, materials, night, updateNight, updateGlow, updateLod, utilityPole, wires, wireMat, curveMirror, roadSign,
  vendingMachine, stopMat, lampPoints, signalMast, signalLampMaterial, signMesh, JP_FONT, bicycles, clockPole, chochin, canvasTex } from './townkit.js';
import { RAIL, buildRailway, railFences, trackside, buildCrossing, pedCrossing, updateCrossings, crossings, crossingActive, Train, tunnelPortal } from './rail.js';
import { Fleet, Traffic, Route, randomCar, carDims } from './traffic.js';
import { planRoads } from './roads.js';
import { DANCHI, DANCHI_ROADS, danchiGround, inDanchi, buildDanchi } from './danchi.js';
import { perf } from './perf.js';
import { startCapture, stopCapture, entity } from './world/capture.js';
import { finalizeWorld } from './world/layer.js';

export const meta = { name: 'Sakuragawa 桜川', startHour: 16.6, sunAzimuth: 2.6 };
const Y0 = 6;
const riverX = z => 215 + 22 * Math.sin(z * 0.0075) + 8 * Math.sin(z * 0.021 + 1);
const PADDIES = [[-650, -330, -430, -110], [-650, -40, -430, 330], [262, 0, 334, 330], [262, -330, 650, -100]]; // (east of the river the fields north of the
// main road are a belt between the river and the apartment district)
const inPaddyZone = (x, z) => PADDIES.some(([a, b, c, d]) => x > a && x < c && z > b && z < d);
const SHRINE = { x: -60, z: -300 };
// level crossings: road centre x, half width incl. footways (the riverside lane R crosses the line beside the rail bridge)
const RRD = 25.5, XR = riverX(-80) - RRD; // lane R: its distance from the river, and its level crossing
// the bank walkways cross the line beside the rail bridge on pedestrian level crossings (x, half width)
const WALK_XINGS = [-1, 1].map(sd => [riverX(-80) + sd * 16.1, 1.7]);
// Level-crossing geometry shared by the terrain, the roads and the deck (rail.js). The deck spans |z + 80| < XD and is
// straight and square to the line. Each approach is an engineered transition XT long: the road is held straight on the
// crossing's axis, its crown fades out, and its profile climbs on a vertical curve onto a flat landing (the last XL m)
// at exactly the deck's top, so carriageway, kerbs, footways and gutters meet the deck edge without a step or a jog.
const XD = 6.6, XT = 10.4, XL = 2.2, DECK_Y = Y0 + 0.447;
const xingProfile = dz => lerp(Y0 + 0.05, DECK_Y, smoothstep(XD + XT, XD + XL, dz)); // road surface on an approach
let XINGS = []; // [centre x, half width to the back of the footway / gutter] — filled from the roads that cross the line
const LEVEL = [[-147, 190, -32.5, 256]]; // school block
// road bridges over the river: [centre z, deck width between the parapets, road id, name plates]; the deck spans the
// channel only (abutments on the two bank lines, 14.4 m either side of the river centre), road edge half width off it
const BRIDGES = [[-25, 12, 'A', ['桜川橋', 'さくらがわばし']], [200, 11.5, 'F', ['舟橋', 'ふなばし']]];
const BRIDGE_EDGE = { A: 6.0, F: 5.75 }; // road centre to the back of its footway / gutter on the approaches
// The river: one water surface along its whole length (no step anywhere). Through the town (|z| <= RIVER_END) it runs
// between concrete revetments sloping from the toe at rd 12.2 (y 0.45) up to the bank-top walkway at rd 14.6; past
// their end walls it runs on between natural earth banks, the ground easing from the revetment's line onto them over
// BANK_BLEND m. The surface stands 1.15 m up the revetment, 4.5 m below the walkway and the lanes along the banks.
const RIVER_LV = 1.6, RIVER_END = 760, BANK_BLEND = 30;
const REV_K = (Y0 - 0.3) / 2.4, REV_WL = 12.2 + (RIVER_LV - 0.45) / REV_K; // revetment rise per metre; rd of its waterline
const revY = rd => 0.45 + (rd - 12.2) * REV_K; // the revetment slab's surface
// natural river bank, by distance from the centreline: bed, a shelving margin under the water, the waterline at about the
// same distance as on the revetments (rd ~12.7), wet mud and pebbles, then an earth bank up to the valley floor at rd 24
const naturalBank = rd => -1.3 + 2.45 * smoothstep(3.5, 11.5, rd) + 0.75 * smoothstep(10.5, 14.5, rd) + 4.1 * smoothstep(13.5, 24, rd);
// bamboo stands the town is known for: in the shrine's wood behind the hall, on the river terraces beyond the houses,
// and on the town's outer edges toward the fields (the hill-foot stands come from the forest planting, the garden and
// block groves from towngreen.js). [x, z, radius]
const BAMBOO_SITES = [[-60, -364, 15], [-103, -336, 9], [-18, -342, 10], [riverX(392) + 42, 392, 13], [riverX(436) - 44, 436, 11], [riverX(-392) + 40, -392, 12],
  [riverX(-446) - 42, -446, 10], [-455, -150, 12], [-458, 196, 11], [-236, 356, 12], [42, 360, 10], [168, -345, 9]].map(([x, z, R]) => ({ x, z, R }));
const SHRINE_M = { lac: 'plastic', dark: 'plastic', wood: 'wood', stone: 'concrete', roof: 'roofMetal', glow: 'lamp', paper: 'plain', rope: 'plain', metal: 'steel', water: 'glass' };

// areas of the town (world object ids are <prefab>_<area>_<n>; world files are split by area)
function townArea(x, z) {
  if (inDanchi(x, z, 6)) return 'danchi';
  if (Math.abs(x - riverX(z)) < 34) return 'river';
  if (Math.hypot(x - SHRINE.x, z - SHRINE.z + 15) < 45) return 'shrine';
  if (x > -150 && x < -28 && z > 188 && z < 258) return 'school';
  if (x > -130 && x < 160 && z > -75 && z < 32) return 'station';
  if (Math.abs(x) > 470 || Math.abs(z) > 350) return 'hills';
  if (inPaddyZone(x, z)) return 'paddies';
  if (z > 258 || x > 262 || x < -415) return 'farmland';
  if (x < -250 || (z < -110 && x < 0)) return 'oldtown';
  if (z > 140 || x > 150) return 'newtown';
  return 'midtown';
}
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
  // level crossings: the roads ramp up over ~10 m onto the deck at rail-top level, on a small embankment; under the deck
  // itself the ground is held at the deck's underside, so the approach meets the deck edge without a step (applied
  // after the valley floor is levelled, or the riverside crossing would lose its ramp)
  // the ground under an approach follows the road's designed profile 5 cm below it (and falls away over 4 m beside it)
  for (const [cx, hwx] of XINGS) {
    if (Math.abs(x - riverX(z)) < 17.7) break;                                          // never inside the river channel / bank walkway
    const dx = Math.abs(x - cx) - hwx, dz = Math.abs(z + 80);
    if (dz <= XD && dx < 0) h = Math.max(h, Y0 + 0.3); // (below the flangeway floors)
    // the approach embankment wraps round the deck's corners at landing level and only then falls to the ballast toe,
    // so the ground never drops away under the end of a footway or gutter where it meets the deck
    if (dx < 4 && dz < XD + XT + 1.5 && dz > XD - 2.2) { const w = smoothstep(4, 0.4, Math.max(dx, 0)) * smoothstep(XD + XT + 1.5, XD + XT - 1, dz) * smoothstep(XD - 2.2, XD - 0.6, dz);
      h = lerp(h, xingProfile(Math.max(dz, XD)) - 0.05, w); }
  }
  // channel: bed, then a sloped concrete revetment from rd 12.2 (y 0.45) up to the walkway at rd 14.6; the ground
  // stays 1.3 m under the revetment slab (so the 2 m heightfield never pokes through it) and is level again under the
  // walkway deck, well before the lanes along the banks
  // past the revetments the banks are natural earth; at a revetment's end wall the ground meets the wall just under its
  // cap (the slab's line, and the walkway's level behind it) and eases onto the natural bank over BANK_BLEND m
  if (rd < 26) {
    const bed = rd < 5 ? -1.3 : rd < 12.2 ? lerp(-1.3, 0.45, (rd - 5) / 7.2) : 0.45, az = Math.abs(z);
    // under the revetment slab the ground is kept well down: with 2 m cells a vertex on the gravel margin and the next
    // one up the slope interpolate straight through a 67-degree slab (the saw-toothed sand showing along the toe)
    const town = rd < 12.2 ? bed : rd < 14.8 ? Math.min(h, 0.2) : rd < 17 ? Math.min(h, Math.max(0.45, revY(rd) - 1.3), Y0 - 0.45) : h;
    if (az <= RIVER_END) h = town;
    else {
      const face = rd < 12.2 ? bed : rd < 14.6 ? revY(rd) - 0.3 : rd < 17.6 ? Y0 + 0.08 : h;
      h = lerp(face, Math.min(h, naturalBank(rd)), smoothstep(RIVER_END, RIVER_END + BANK_BLEND, az));
    }
  }
  // the apartment district stands on a graded platform cut into the foot of the hills (its rim blends back to them)
  h = danchiGround(x, z, h, Y0);
  // bridge approaches: an embankment at road level from the abutment back to the valley floor
  for (const [bz, bw] of BRIDGES) { const dz = Math.abs(z - bz) - (bw / 2 + 0.6);
    if (rd > 14.7 && rd < 26 && dz < 1.5) h = Math.max(h, lerp(Y0 + 0.28, h, smoothstep(18, 24, rd)) - Math.max(0, dz) * 0.4); }
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
  { id: 'B', kind: 'road', w: 6.0, walk: 2.0, center: 'white', xing: true, pts: [[110, -340], [110, 330]], mat: 'asphalt' },
  { id: 'C', kind: 'lane', w: 5.0, xing: true, pts: [[-150, -300], [-150, 300]], mat: 'asphalt', age: 0.55 },
  { id: 'D', kind: 'lane', w: 5.0, xing: true, pts: [[-400, -312], [-400, 322]], mat: 'asphalt', age: 0.8 },
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
  // the district road: from road B over the Funabashi bridge and the paddy belt into the apartment district
  { id: 'F', kind: 'road', w: 6.5, walk: 2.5, center: 'white', pts: [[110, 200], [600, 200]], mat: 'asphalt', age: 0.45, district: true },
  ...DANCHI_ROADS,
  { id: 'R', kind: 'lane', w: 4.5, mat: 'asphalt', age: 0.6, xing: true, pts: (() => { // follows the river RRD out; square across the railway
    // river-following points away from the line; near it the lane leaves the river on smooth Hermite curves onto the
    // crossing's straight (held square to the rails for XD + XT + 2 m either side of the track axis)
    const P = [], SB = XD + XT + 2, zS = -80 - SB, zN = -80 + SB, za = -132, zb = -26;
    for (let i = 0; i < 34; i++) { const z = -335 + i * 20; if (z > za - 8 && z < zb + 8) continue; P.push([riverX(z) - RRD, z]); }
    const herm = (p0, t0, p1, t1, n) => { for (let k = 0; k <= n; k++) { const t = k / n, h00 = 2 * t ** 3 - 3 * t * t + 1, h10 = t ** 3 - 2 * t * t + t, h01 = -2 * t ** 3 + 3 * t * t, h11 = t ** 3 - t * t;
      P.push([h00 * p0[0] + h10 * t0[0] + h01 * p1[0] + h11 * t1[0], h00 * p0[1] + h10 * t0[1] + h01 * p1[1] + h11 * t1[1]]); } };
    const slope = z => (riverX(z + 0.5) - riverX(z - 0.5));
    herm([riverX(za) - RRD, za], [slope(za) * (zS - za), zS - za], [XR, zS], [0, zS - za], 5);
    herm([XR, zN], [0, zb - zN], [riverX(zb) - RRD, zb], [slope(zb) * (zb - zN), zb - zN], 5);
    const out = P.sort((a, b) => a[1] - b[1]);
    return out.filter((p, i) => i === 0 || Math.hypot(p[0] - out[i - 1][0], p[1] - out[i - 1][1]) > 0.5); })() },
  { id: 'P', kind: 'path', w: 3.0, pts: [[SHRINE.x, -225], [SHRINE.x, SHRINE.z + 4]], mat: 'gravelPath' },
  // the estate lane through the housing estate (団地) on the southern meadow, from road D to lane C
  { id: 'E0', kind: 'lane', w: 5.0, pts: [[-400, -282], [-150, -282]], mat: 'asphalt', age: 0.35 },
  // farm lane (農道) through the fields north of the last street: plots front onto it and onto lane S3
  { id: 'FE', kind: 'path', w: 3.0, pts: [[-400, 312], [-340, 313], [-275, 311], [-212, 312.5], [-150, 312], [-90, 311], [-30, 312.5], [40, 312], [110, 312]], mat: 'gravelPath', track: true },
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
    ['M3', 3.8, false, 0.7, [[-150, 87], [-112, 85], [-70, 88], [-30, 86], [-4, 82], [14, 80], [50, 83], [78, 85], [110, 84]]], // through to road B
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
// every road that meets the railway at grade crosses it on a straight held square to the rails: the vertices within
// XD + XT + 2 m of the track axis are replaced by the two ends of that straight (the road bends, if at all, beyond the
// transition), so the deck is never skewed or shifted to suit the road
const xAtRail = R => { for (let i = 0; i + 1 < R.pts.length; i++) { const [ax, az] = R.pts[i], [bx, bz] = R.pts[i + 1]; if ((az + 80) * (bz + 80) <= 0 && az !== bz) return ax + (bx - ax) * (-80 - az) / (bz - az); } return R.pts[0][0]; };
for (const R of ROADS) {
  if (!R.xing) continue;
  const x = xAtRail(R), SB = XD + XT + 2, up = R.pts[R.pts.length - 1][1] > R.pts[0][1];
  const keep = R.pts.filter(p => Math.abs(p[1] + 80) >= SB + 0.5);
  keep.push([x, -80 - SB], [x, -80 + SB]);
  keep.sort((a, b) => up ? a[1] - b[1] : b[1] - a[1]);
  R.pts = keep;
  XINGS.push([x, R.w / 2 + (R.walk || 0.4)]);
}
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
    if (!(Math.abs(p[1]) > 250 || p[0] < -390 || p[0] > 100)) continue; // only at the edge of town, never across lots
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
  const et = 0.6 / Math.hypot(r[0], r[1]), eu = 0.6 / Math.hypot(s[0], s[1]); // metres, not a fraction of the segment
  if (t < -et || t > 1 + et || u < -eu || u > 1 + eu) return null;
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
// within pad metres of a road's formation (carriageway + footways + 0.8 m): paddies keep off roads that cross them —
// the road rides on its embankment and the fields start past its toe and a levee
function roadNear(x, z, pad) {
  if (!GRADE) buildGrades();
  const list = GRADE.grid.get(GRADE.key(Math.floor(x / GRADE.CS), Math.floor(z / GRADE.CS))); if (!list) return false;
  for (const g of list) { const t = clamp((x - g.a[0]) * g.d[0] + (z - g.a[1]) * g.d[1], 0, g.L); if (Math.hypot(x - g.a[0] - g.d[0] * t, z - g.a[1] - g.d[1] * t) < g.C + pad) return true; }
  return false;
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

export async function build(progress, opts = {}) {
  const SIM = !opts.editor; // the world editor builds the town without its simulation (moving traffic, trains, pedestrians)
  keepArrays.on = !!opts.editor; startCapture(); // every placed object is recorded for the world data layer (world/)
  const reflected = new Set(scene.children); // sky, clouds, lights... (terrain + forest are added below)
  const MT = materials();
  MT.paddyWater = new THREE.MeshStandardMaterial({ color: 0x3b3a2a, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.72, depthWrite: false, envMapIntensity: 1.3 });
  const hf = new Heightfield({ world: 2048, grid: 1024, height });
  // still water in the district park (the lake, its spring and inlet) and in the fountain's basins (terrain.js)
  const waterNormals = loadTex('tex/waternormals.jpg', false, NFLAT);
  MT.pondWater = pondWaterMaterial(hf, waterNormals);
  MT.fountainWater = pondWaterMaterial(hf, waterNormals, { deep: '#2b6d82', mid: '#4a9aac', shallow: '#8cc8cc', fixedDepth: 0.32 });
  MT.waterFlow = flowWaterMaterial(); MT.waterFoam = foamMaterial();
  // mown turf (the district's football ground): short blades drawn in along the mowing direction over a green ground,
  // the vertex colour carrying the stripes and the wear; goal and ball-stop netting
  MT.turf = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, map: canvasTex(256, 256, (g, W, H) => {
    const r = mulberry32(515); g.fillStyle = '#4f7d33'; g.fillRect(0, 0, W, H);
    for (let k = 0; k < 9000; k++) { const x = r() * W, y = r() * H, l = 3 + r() * 6, a = -Math.PI / 2 + (r() - 0.5) * 0.5, s = r();
      g.strokeStyle = `rgb(${Math.round(55 + s * 55)},${Math.round(95 + s * 70)},${Math.round(30 + s * 30)})`; g.lineWidth = 0.8 + r() * 1.1;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
    g.globalAlpha = 0.18; for (let k = 0; k < 400; k++) { g.fillStyle = r() < 0.5 ? '#3e6428' : '#6f9848'; g.beginPath(); g.arc(r() * W, r() * H, 3 + r() * 9, 0, 7); g.fill(); } g.globalAlpha = 1; }) });
  MT.turf.map.wrapS = MT.turf.map.wrapT = THREE.RepeatWrapping;
  MT.net = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, alphaTest: 0.35, roughness: 0.8, map: canvasTex(64, 64, (g, W, H) => { g.clearRect(0, 0, W, H); g.strokeStyle = '#f4f4f2'; g.lineWidth = 5;
    g.beginPath(); for (const t of [0, W]) { g.moveTo(t, 0); g.lineTo(t, H); g.moveTo(0, t); g.lineTo(W, t); } g.stroke(); }) });
  MT.net.map.wrapS = MT.net.map.wrapT = THREE.RepeatWrapping;
  MT.waterFlow.uniforms.uGlow = MT.waterFoam.uniforms.uGlow = { get value() { return night.value * 0.35; } };
  const { HN, HALF, CELL } = hf;
  const layers = {
    grass: { d: phTex('aerial_grass_rock', 'diff', '2k', true), n: phTex('aerial_grass_rock', 'nor_gl', '2k', false, NFLAT), s: 6, tint: [0.95, 1.1, 0.8] },
    forest: { d: phTex('forest_leaves_03', 'diff', '2k', true), n: phTex('forest_leaves_03', 'nor_gl', '1k', false, NFLAT), s: 3 },
    rock: { d: phTex('rock_face_03', 'diff', '2k', true), n: phTex('rock_face_03', 'nor_gl', '2k', false, NFLAT), s: 9 },
    shore: { d: phTex('brown_mud', 'diff', '1k', true), n: phTex('brown_mud', 'nor_gl', '1k', false, NFLAT), s: 3, tint: [0.85, 0.82, 0.78] },
    urban: { d: phTex('bicolour_gravel', 'diff', '1k', true), n: phTex('bicolour_gravel', 'nor_gl', '1k', false, NFLAT), s: 2.5, tint: [1.1, 1.03, 0.9], norm: 0.44 },
  };
  const modelsP = Promise.all(['shrub_02', 'potted_plant_04', 'planter_box_01', 'plastic_crate_01', 'utility_box_02', 'weed_plant_02', 'water_manhole_cover'].map(loadModel));
  const rockModelsP = Promise.all(['rock_moss_set_01', 'boulder_01'].map(loadModel));
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
    let g = hf.groundAt(x, z) + 0.05;
    // on a level-crossing approach the carriageway (and its kerbs and footways) follows the designed profile exactly,
    // arriving at the deck's top on a flat landing; it blends back to the ground's grade at the start of the transition
    const dz = Math.abs(z + 80);
    if (dz < XD + XT + 1) for (const [cx, hwx] of XINGS) if (Math.abs(x - cx) < hwx + 1) g = lerp(g, xingProfile(dz), smoothstep(XD + XT + 1, XD + XT - 2, dz));
    return rd < 24.5 && (Math.abs(z + 25) < 9 || Math.abs(z - 200) < 5) ? lerp(g, Y0 + 0.35, smoothstep(24, 18, rd)) : g;
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
      const hasX = ((R.id === 'A' || R.id === 'B') && Math.abs(I.p[0]) < 460 && Math.abs(I.p[1]) < 340 || R.district && other.district || R.district && other.id === 'A') && !other.noMarks; // no zebras across alley mouths
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
  for (const [bz, , id] of BRIDGES) for (const sd of [-1, 1]) zebras.push({ id, s: sOf(id, riverX(bz) + sd * 16.1, bz), band: 3.0, bank: true });
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
      // paved: the carriageway and its footways (or a lane's L-gutter) exactly — the verge beyond stays lawn to the kerb
      const ext = hw + (R.walk || 0) + (R.kind === 'lane' ? 0.5 : 0) + 0.12;
      hf.paintPave(Math.min(a[0], b[0]) - ext, Math.min(a[1], b[1]) - ext, Math.max(a[0], b[0]) + ext, Math.max(a[1], b[1]) + ext, (x, z) => nearestOnRoad({ pts: [a, b] }, x, z).d < ext ? 1 : 0);
    }
  }
  // junction corners: the footway round the kerb arc and the carriageway inside the corner's sector
  for (const I of inters) for (const cr of I.corners) {
    const u1 = [(cr.T1[0] - cr.O[0]) / cr.rF, (cr.T1[1] - cr.O[1]) / cr.rF], u2 = [(cr.T2[0] - cr.O[0]) / cr.rF, (cr.T2[1] - cr.O[1]) / cr.rF], k = u1[0] * u2[1] - u1[1] * u2[0], E = cr.rF + 1;
    hf.paintPave(cr.O[0] - E, cr.O[1] - E, cr.O[0] + E, cr.O[1] + E, (x, z) => { const vx = x - cr.O[0], vz = z - cr.O[1], r = Math.hypot(vx, vz);
      return r > cr.rF - (cr.walk || 0.5) - 0.15 && (u1[0] * vz - u1[1] * vx) * k >= -0.3 * r && (vx * u2[1] - vz * u2[0]) * k >= -0.3 * r ? 1 : 0; });
  }
  // footways the pedestrian network carries on round corners onto lanes: lots keep off them, nothing grows through
  for (const n of RN.net) if (!n.walk) for (const side of [1, -1]) for (const [s0, s1, w] of n.ws[side]) for (let s = s0; s <= s1 + 0.5; s += 0.8) {
    const q = RN.sampleAt(n, Math.min(s, s1)), l = [-q.d[1], q.d[0]], off = side * (n.hw + w / 2), x = q.x + l[0] * off, z = q.z + l[1] * off;
    occRect(x, z, w / 2 + 0.05, 0.5, Math.atan2(q.d[0], q.d[1]), 1);
    hf.paintPave(x - w, z - w, x + w, z + w, (px, pz) => { const dx = px - x, dz = pz - z; return Math.abs(dx * q.d[0] + dz * q.d[1]) < 0.5 && Math.abs(-dx * q.d[1] + dz * q.d[0]) < w / 2 + 0.12 ? 1 : 0; });
  }
  // footway width in front of a stretch [s0, s1] of road R on one side (0 where there is none)
  const walkAlong = (R, side, s0, s1) => { const n = RN.byId.get(R.id); let w = 0; for (let k = 0; k <= 4; k++) w = Math.max(w, RN.walkAt(n, side, lerp(s0, s1, k / 4))); return w; };
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
  // level crossings on B, C, D and the riverside lane R (every road that meets the line at grade gets gates)
  const crossingRoads = ROADS.filter(R => R.xing);
  const Bx = new GeoBuilder(192);
  const railInfo = buildRailway({ y0: Y0, riverX, B: Bx });
  for (const R of crossingRoads) {
    const x = xAtRail(R), n = RN.byId.get(R.id), sC = sOf(R.id, x, -80), dz = Math.sign(RN.sampleAt(n, sC).d[1]) || 1;
    // the deck takes the road's own cross-section: carriageway, footways or L-gutters, the edge lines where the
    // approach has them, and the asphalt's lane coordinates (so its wear, patches and cracks run on across)
    const sideW = R.walk || 0.4, lines = RN.marks(n).filter(([c]) => c !== 0).map(([c, w]) => [c * -dz, w]);
    buildCrossing(Bx, x, Y0, R.w + 2 * sideW + 0.4, { hw: R.w / 2, walk: R.walk || 0, side: { w: sideW, kind: R.walk ? 'walk' : 'gutter' }, lines,
      uSign: -dz, sAt: z => sC + (z + 80) * dz, hwAge: RN.hwAge(n), machineSide: R.id === 'R' ? -1 : 0, groundAt: (gx, gz) => hf.groundAt(gx, gz), age: Math.min(0.99, R.age ?? (R.kind === 'main' ? 0.12 : R.kind === 'road' ? 0.4 : 0.72)) });
    // kerbs and gutters ease down over 3 m onto the landing and lie flush with it, so footway and shoulder run level onto the deck
    for (const side of [-1, 1]) { const sa = sOf(R.id, x, -80 - XD - XL), sb = sOf(R.id, x, -80 + XD + XL); RN.cuts.push({ id: R.id, side, s0: Math.min(sa, sb), s1: Math.max(sa, sb), flush: true, ramp: 3.0 }); }
    for (const dir of [-1, 1]) addStop(R.id, sOf(R.id, x, -80 - dir * 8.6), dir, false);
    const sgn = [[-1, -89.5], [1, -70.5]];
    for (const [sd, z] of sgn) { const sx = x + sd * (R.w / 2 + (R.walk ? R.walk - 0.5 : 1.4)); roadSign(B, sx, topY(sx, z + sd * 2), z + sd * 2, sd > 0 ? 0 : Math.PI, 'crossing'); }
  }
  for (const sd of [-1, 1]) pedCrossing(Bx, { cx: z => riverX(z) + sd * 16.1, sd, y0: Y0, hw: 1.5, name: sd < 0 ? '河畔西踏切' : '河畔東踏切', ramp: 4.0 });
  chainMaterial();
  railFences(Bx, (x, z) => hf.groundAt(x, z), Y0, [
    ...crossingRoads.map(R => [xAtRail(R) - R.w / 2 - (R.walk || 0) - 3, xAtRail(R) + R.w / 2 + (R.walk || 0) + 3]),
    [riverX(-67.6) - 17.9, riverX(-67.6) + 17.9, 1], [riverX(-92.4) - 17.9, riverX(-92.4) + 17.9, -1], [RAIL.stationX + 6 - 9.6, RAIL.stationX + 6 + 9.6, 1], [RAIL.stationX - RAIL.platformLen / 2 + 2.5, RAIL.stationX - RAIL.platformLen / 2 + 9.5, 1]], RAIL.stationX);
  trackside(Bx, (x, z) => hf.groundAt(x, z), Y0, { x0: -PORTALS.railW + 30, x1: PORTALS.railE - 30, stationX: RAIL.stationX, platformLen: RAIL.platformLen,
    crossX: crossingRoads.map(xAtRail), gaps: [...crossingRoads.map(R => [xAtRail(R) - R.w / 2 - (R.walk || 0) - 4, xAtRail(R) + R.w / 2 + (R.walk || 0) + 4]),
      [RAIL.stationX - RAIL.platformLen / 2 - 14, RAIL.stationX + RAIL.platformLen / 2 + 4], [riverX(-80) - 20, riverX(-80) + 20]] });
  // occupancy/masks for railway corridor, river corridor, station
  occRect(0, -80, 1000, 13, 0, 1);
  for (let z = -800; z < 800; z += 1) { const rx = riverX(z); occRect(rx, z, 24, 0.6, 0, 1); }
  // the maintained track bed and paths stay bare; past them a mown grass verge runs to the fence (wider bare patches here and there)
  hf.paint2(2, -PORTALS.railW, -92, PORTALS.railE, -68, (x, z) => Math.abs(z + 80) < 8.4 + (Math.sin(x * 0.043) > 0.7 ? 1.6 : 0) + Math.max(0, Math.sin(x * 0.11 + z)) * 0.5 ? 1 : 0);
  // station forecourt: paved square, bus / taxi loop round a raised island (station.js)
  occRect(RAIL.stationX + 6, -47.5, 34, 17, 0, 1);
  hf.paint2(2, -60, -66, 40, -30, (x, z) => x < -34.5 || x > 32 ? 0 : 1); hf.paint2(0, -60, -66, 40, -30, (x, z) => x < -34.5 || x > 32 ? 0 : 1);
  hf.paint2(2, RAIL.stationX - 4, -74, RAIL.stationX + 16, -63, () => 1); // nothing grows in or under the station building
  const stationCars = [], forecourt = stationForecourt(B, { Y0, RN, sOf, rng: mulberry32(55), parked: stationCars });
  // river banks: concrete revetments with railings, plus bridges. Nothing grows through the revetment slabs or
  // under the walkway deck (the ground there sits below the concrete)
  hf.paintPave(100, -RIVER_END - 1, 330, RIVER_END + 1, (x, z) => Math.abs(z) < RIVER_END + 0.4 && Math.abs(x - riverX(z)) < 18.3 && Math.abs(x - riverX(z)) > 11.9 ? 1 : 0); // revetment + bank-top walkway
  // nothing grows anywhere in the channel, along its whole length (the bed under the water; the grass rule keeps blades
  // off the water's edge as well)
  hf.paint2(2, -hf.HALF, -hf.HALF, hf.HALF, hf.HALF, (x, z) => smoothstep(REV_WL - 0.4, REV_WL - 1.6, Math.abs(x - riverX(z))));
  // where the bank walkway stops: the two road bridges (it meets their footways at the parapet line) and the railway
  const WALK_GAPS = [...BRIDGES.map(([bz, , id]) => [bz - BRIDGE_EDGE[id] - 3.0, bz + BRIDGE_EDGE[id] + 3.0]), [-90.6, -69.4]]; // (ramps up to the roads / pedestrian crossings take over there)
  // the revetment's colour by height: [y, vertex colour] (the slab's photo texture and weathering stay continuous)
  const REV_S = Math.hypot(2.4, Y0 - 0.3) / (Y0 - 0.3), DRY = [0.8, 0.8, 0.78];
  const REV_BANDS = [[0.45, [0.42, 0.43, 0.36]], [RIVER_LV - 0.45, [0.4, 0.44, 0.34]], [RIVER_LV - 0.06, [0.25, 0.32, 0.19]], [RIVER_LV + 0.08, [0.29, 0.33, 0.24]],
    [RIVER_LV + 0.3, [0.48, 0.49, 0.43]], [RIVER_LV + 0.55, [0.64, 0.62, 0.56]], [RIVER_LV + 1.1, DRY], [Y0 + 0.15, DRY]];
  const clipRanges = (a, b, gaps) => { let parts = [[a, b]]; for (const [g0, g1] of gaps) parts = parts.flatMap(([p, q]) => q <= g0 || p >= g1 ? [[p, q]] : [...(p < g0 ? [[p, g0]] : []), ...(q > g1 ? [[g1, q]] : [])]); return parts.filter(([p, q]) => q - p > 0.02); };
  for (let z = -760; z < 760; z += 4) {
    for (const sd of [-1, 1]) {
      const xa = riverX(z) + sd * 14.6, xb = riverX(z + 4) + sd * 14.6, xa0 = riverX(z) + sd * 12.2, xb0 = riverX(z + 4) + sd * 12.2;
      B.frame(0, 0, 0, 0);
      // sloped revetment slab, unbroken along the whole river (no access down to the water), with a low toe wall where
      // it meets the bed. It is laid in bands up the slope so the water leaves its marks: silt-grey stone under the
      // surface, a dark band of algae at the waterline, wet stone above it drying out toward the walkway
      for (let k = 0; k + 1 < REV_BANDS.length; k++) {
        const [y0, c0] = REV_BANDS[k], [y1, c1] = REV_BANDS[k + 1], r0 = 12.2 + (y0 - 0.45) / REV_K, r1 = 12.2 + (y1 - 0.45) / REV_K, s0 = (y0 - 0.45) * REV_S / 2, s1 = (y1 - 0.45) * REV_S / 2;
        B.poly('stone', [[riverX(z) + sd * r0, y0, z], [riverX(z + 4) + sd * r0, y0, z + 4], [riverX(z + 4) + sd * r1, y1, z + 4], [riverX(z) + sd * r1, y1, z]], [-sd, 0.4, 0],
          { uvs: [[z / 2, s0], [z / 2 + 2, s0], [z / 2 + 2, s1], [z / 2, s1]], colors: [c0, c0, c1, c1] });
      }
      if (sd < 0) B.quad('concrete', [xa0 + 0.35, 0.1, z], [xb0 + 0.35, 0.1, z + 4], [xb0, 0.45, z + 4], [xa0, 0.45, z], { color: [0.7, 0.7, 0.68] });
      else B.quad('concrete', [xb0 - 0.35, 0.1, z + 4], [xa0 - 0.35, 0.1, z], [xa0, 0.45, z], [xb0, 0.45, z + 4], { color: [0.7, 0.7, 0.68] });
      // paved walkway on top of the bank, with a skirt down to the ground on its outer edge. It runs right up to the
      // bridges (where it meets the road's own footway or, at the railway, ends at a railing with a paved link to the
      // lane R crossing), and the railing on its river edge runs just as far, unbroken
      const yd = Y0 + 0.12, pc = { uv: 1.5, color: [0.88, 0.86, 0.82] }, sk = { uv: 2, color: [0.72, 0.72, 0.7] }, rc = { color: [0.3, 0.52, 0.47] };
      const walkParts = clipRanges(z, z + 4, WALK_GAPS);
      for (const [za, zb] of walkParts) {
        const wa = riverX(za) + sd * 14.6, wb = riverX(zb) + sd * 14.6, xo = riverX(za) + sd * 17.6, xo2 = riverX(zb) + sd * 17.6;
        B.poly('pavement', [[wa, yd, za], [wb, yd, zb], [xo2, yd, zb], [xo, yd, za]], [0, 1, 0], pc);
        B.poly('concrete', [[xo, Y0 - 1.2, za], [xo2, Y0 - 1.2, zb], [xo2, yd, zb], [xo, yd, za]], [sd, 0, 0], sk);
      }
      for (const [za, zb] of walkParts) {
        const ra = riverX(za) + sd * 15.0, rb = riverX(zb) + sd * 15.0, L = zb - za; if (L < 0.05) continue;
        B.beam('alu', [ra, Y0 + 1.07, za], [rb, Y0 + 1.07, zb], 0.07, 0.07, rc);
        B.beam('alu', [ra, Y0 + 0.62, za], [rb, Y0 + 0.62, zb], 0.035, 0.035, rc);
        for (let zp = za; zp <= zb + 1e-3; zp += Math.max(0.5, L / Math.max(1, Math.round(L / 2)))) { const t = (zp - za) / L; B.box('alu', lerp(ra, rb, t), Y0 + 0.1, zp, 0.06, 0.97, 0.06, rc); }
        addBox((ra + rb) / 2, (za + zb) / 2, 0.1, L / 2 + 0.05, Math.atan2(rb - ra, L));
      }
    }
  }
  // end walls where the revetments stop and the natural banks begin: a cast wall across the end of each revetment,
  // its cap standing proud of the slab and running flush across the end of the walkway (closing it off underneath); the
  // ground of the natural bank meets its outer face just under the cap
  for (const zE of [-RIVER_END, RIVER_END]) for (const sd of [-1, 1]) {
    const e = Math.sign(zE), z1 = zE + e * 0.4, W = (rd, y, zz) => [riverX(zE) + sd * rd, y, zz], o = { uv: 2, color: [0.76, 0.76, 0.73] };
    const top = rd => rd <= 12.2 ? 0.6 : rd <= 14.6 ? revY(rd) + 0.15 : Y0 + 0.12, bot = rd => rd <= 12.2 ? -1.3 : rd <= 14.6 ? revY(rd) - 1.8 : Y0 - 1.4;
    const R = [11.75, 12.2, 14.6, 17.75];
    B.frame(0, 0, 0, 0);
    for (let k = 0; k + 1 < R.length; k++) {
      const ra = R[k], rb = R[k + 1], ta = top(ra), tb = top(rb), ba = bot(ra), bb = bot(rb);
      B.poly('concrete', [W(ra, ba, z1), W(rb, bb, z1), W(rb, tb, z1), W(ra, ta, z1)], [0, 0, e], o);                    // outer face
      B.poly('concrete', [W(ra, ta, zE), W(rb, tb, zE), W(rb, tb, z1), W(ra, ta, z1)], [0, 1, 0], { color: [0.8, 0.8, 0.77] }); // cap
      if (rb <= 12.2 || ra >= 14.6) B.poly('concrete', [W(ra, ba, zE), W(rb, bb, zE), W(rb, tb, zE), W(ra, ta, zE)], [0, 0, -e], o); // inner face (toe / under the walkway)
      else B.poly('concrete', [W(ra, revY(ra) - 0.02, zE), W(rb, revY(rb) - 0.02, zE), W(rb, tb, zE), W(ra, ta, zE)], [0, 0, -e], o);  // its lip above the slab
    }
    B.poly('concrete', [W(R[0], bot(R[0]), zE), W(R[0], bot(R[0]), z1), W(R[0], top(R[0]), z1), W(R[0], top(R[0]), zE)], [-sd, 0, 0], o); // river end
    B.poly('concrete', [W(R[3], bot(R[3]), zE), W(R[3], bot(R[3]), z1), W(R[3], top(R[3]), z1), W(R[3], top(R[3]), zE)], [sd, 0, 0], o); // landward end
  }
  // the natural banks past the revetments: stones lie along the waterline — a bigger stone every few metres, half in
  // the water, with smaller ones spilled round it (instanced with the district's rocks below)
  const riverRocks = [], rrng = mulberry32(4242), RTINT = [[1.0, 0.97, 0.9], [0.9, 0.92, 0.95], [0.86, 0.85, 0.8], [0.96, 0.95, 0.9]].map(c => new THREE.Color(...c));
  for (const sg of [-1, 1]) for (const sd of [-1, 1]) for (let az = RIVER_END + 18; az < hf.HALF - 4;) {
    const z = sg * az, n = 1 + Math.floor(rrng() * 3);
    for (let k = 0; k < n; k++) {
      const big = k === 0, s = big ? 0.6 + rrng() * 0.7 : 0.22 + rrng() * 0.3, rd = (big ? 12.3 : 12.0) + rrng() * (big ? 1.0 : 1.8), zz = z + (big ? 0 : (rrng() - 0.5) * 2.4);
      riverRocks.push({ x: riverX(zz) + sd * rd, z: zz, s, kind: 's', part: Math.floor(rrng() * 64), sink: big ? 0.3 : 0.4, r: rrng() * 6.283, tilt: (rrng() - 0.5) * 0.4, tilt2: (rrng() - 0.5) * 0.4,
        sx: 0.85 + rrng() * 0.35, sy: 0.7 + rrng() * 0.4, c: RTINT[Math.floor(rrng() * RTINT.length)].clone().offsetHSL(0, 0, (rrng() - 0.5) * 0.06) });
    }
    az += 3 + rrng() * 7;
  }
  // at the railway the bank walkways ramp up onto their pedestrian level crossings (built with the road crossings);
  // on the west bank a paved link also leads off the walkway to the lane R crossing
  for (const [za, zb] of [[-93.4, -91.1], [-68.9, -66.6]]) {
    const xr = XR + 2.25, ya = zz => riverX(zz) - 17.6, yr = zz => surfaceY(xr - 0.3, zz) + 0.01, e = za < -80 ? -1 : 1;
    B.frame(0, 0, 0, 0);
    B.poly('pavement', [[xr, yr(za), za], [ya(za), Y0 + 0.12, za], [ya(zb), Y0 + 0.12, zb], [xr, yr(zb), zb]], [0, 1, 0], { uv: 1.5, color: [0.86, 0.84, 0.8] });
    for (const zz of [za, zb]) B.poly('concrete', [[xr, Y0 - 0.4, zz], [ya(zz), Y0 - 0.4, zz], [ya(zz), Y0 + 0.12, zz], [xr, yr(zz), zz]], [0, 0, zz === za ? -1 : 1], { color: [0.72, 0.72, 0.7] });
    hf.paint2(2, xr - 1, Math.min(za, zb) - 1, ya(zb) + 1, Math.max(za, zb) + 1, () => 1);
    void e;
  }
  // the bank walkways meet each bridge road at grade: a ramp up from the walkway to the back of the road's footway (or
  // its gutter), a railing along the river side, and a zebra crossing over the road on the walkway's line
  const RAMP = 3.0, TOPY = Y0 + 0.385;
  for (const [bz, , id] of BRIDGES) for (const sd of [-1, 1]) for (const e of [-1, 1]) {
    const E = BRIDGE_EDGE[id], z1 = bz + e * (E + RAMP), z2 = bz + e * E, N = 5, rc = { color: [0.3, 0.52, 0.47] };
    const W = (z, rd, y) => [riverX(z) + sd * rd, y, z], yAt = z => lerp(Y0 + 0.12, TOPY, Math.abs(z - z1) / RAMP);
    B.frame(0, 0, 0, 0);
    for (let k = 0; k < N; k++) { const za = lerp(z1, z2, k / N), zb = lerp(z1, z2, (k + 1) / N), q = [W(za, 14.6, yAt(za)), W(zb, 14.6, yAt(zb)), W(zb, 17.6, yAt(zb)), W(za, 17.6, yAt(za))];
      B.poly('pavement', q, [0, 1, 0], { uv: 1.5, color: [0.88, 0.86, 0.82] });
      B.poly('concrete', [W(za, 17.6, Y0 - 1.2), W(zb, 17.6, Y0 - 1.2), q[2], q[3]], [sd, 0, 0], { uv: 2, color: [0.72, 0.72, 0.7] });
      B.poly('stone', [W(za, 14.6, Y0 - 0.2), W(zb, 14.6, Y0 - 0.2), q[1], q[0]], [-sd, 0, 0], { uv: 2, color: [0.8, 0.8, 0.78] }); }
    const ra = W(z1, 15.0, yAt(z1)), rb = W(z2 - e * 0.15, 15.0, yAt(z2));
    B.beam('alu', [ra[0], ra[1] + 0.95, z1], [rb[0], rb[1] + 0.95, rb[2]], 0.07, 0.07, rc); B.beam('alu', [ra[0], ra[1] + 0.5, z1], [rb[0], rb[1] + 0.5, rb[2]], 0.035, 0.035, rc);
    for (const t of [0, 0.5, 1]) { const p = [lerp(ra[0], rb[0], t), lerp(ra[1], rb[1], t), lerp(z1, rb[2], t)]; B.box('alu', p[0], p[1] - 0.02, p[2], 0.06, 0.97, 0.06, rc); }
    addBox((ra[0] + rb[0]) / 2, (z1 + rb[2]) / 2, 0.1, Math.abs(rb[2] - z1) / 2, 0);
    hf.paint2(2, riverX(z2) + sd * 14.4 - 3.5, Math.min(z1, z2) - 1, riverX(z2) + sd * 14.4 + 3.5, Math.max(z1, z2) + 1, () => 1);
  }
  // road bridges: deck slab on concrete girders and cross-beams, round-nosed piers with caps, abutments; parapet wall with
  // an aluminium railing, name pillars (親柱) at the four corners, lamps, and steel expansion joints across the road
  for (const [bz, bw, id, names] of BRIDGES) {
    // deck, girders and cross beams span the channel from bank line to bank line (the river crosses the road askew
    // here, so the deck ends run along the banks); piers turned into the current; abutments along both bank lines
    const rx = riverX(bz), gc = [0.76, 0.76, 0.74], BE = 14.4, hwD = bw / 2 + 0.45, kx = (riverX(bz + 1) - riverX(bz - 1)) / 2, ang = Math.atan(kx);
    const xL = z => riverX(z) - BE, xR = z => riverX(z) + BE;
    B.frame(0, 0, 0, 0);
    const slab = (mat, z0, z1, ya, yb, col, in0 = 0) => { const P = (z, x, y) => [x, y, z], a0 = xL(z0) + in0, a1 = xL(z1) + in0, b0 = xR(z0) - in0, b1 = xR(z1) - in0, o = { color: col, uv: 3 };
      B.poly(mat, [P(z0, a0, yb), P(z0, b0, yb), P(z1, b1, yb), P(z1, a1, yb)], [0, 1, 0], o); B.poly(mat, [P(z0, a0, ya), P(z0, b0, ya), P(z1, b1, ya), P(z1, a1, ya)], [0, -1, 0], o);
      B.poly(mat, [P(z0, a0, ya), P(z0, b0, ya), P(z0, b0, yb), P(z0, a0, yb)], [0, 0, -1], o); B.poly(mat, [P(z1, a1, ya), P(z1, b1, ya), P(z1, b1, yb), P(z1, a1, yb)], [0, 0, 1], o);
      B.poly(mat, [P(z0, a0, ya), P(z1, a1, ya), P(z1, a1, yb), P(z0, a0, yb)], [-1, 0, 0], o); B.poly(mat, [P(z0, b0, ya), P(z1, b1, ya), P(z1, b1, yb), P(z0, b0, yb)], [1, 0, 0], o); };
    slab('concrete', bz - hwD, bz + hwD, Y0 - 0.5, Y0 + 0.3, gc);                                                                  // deck slab
    for (const sd of [-1, 1]) slab('concrete', bz + sd * (bw / 2 + 0.3) - 0.25, bz + sd * (bw / 2 + 0.3) + 0.25, Y0 - 0.72, Y0 - 0.5, [0.72, 0.72, 0.7], 0.05); // edge beams
    const ng = Math.max(2, Math.round(bw / 3));
    for (let g = 0; g < ng; g++) { const gz = bz + (g / (ng - 1) - 0.5) * (bw - 1); slab('concrete', gz - 0.225, gz + 0.225, Y0 - 1.55, Y0 - 0.5, [0.7, 0.7, 0.68], 0.25); } // girders
    for (let x = -11; x <= 11; x += 5.5) { B.frame(rx + x, Y0, bz, 0); B.bbox('concrete', 0, -1.3, 0, 0.3, 0.8, bw - 0.6, 0.02, { color: [0.68, 0.68, 0.66] }); }
    for (const px of [-7, 7]) { // round-nosed piers set along the flow
      B.frame(rx + px, Y0, bz, ang);
      B.bbox('concrete', 0, -1.9, 0, 1.9, 0.4, (bw + 0.2) / Math.cos(ang), 0.03, { color: [0.72, 0.72, 0.7], uv: 3 });
      B.bbox('concrete', 0, -8, 0, 1.3, 6.1, bw - 1.3, 0.02, { color: [0.68, 0.68, 0.66], uv: 3 });
      for (const s2 of [-1, 1]) B.cyl('concrete', 0, -8, s2 * (bw / 2 - 0.65), 0.65, 0.65, 6.1, 16, { color: [0.68, 0.68, 0.66], uv: 3 });
    }
    B.frame(0, 0, 0, 0);
    for (const s2 of [-1, 1]) { // abutments: a wall on each bank line under the deck end, wing walls back along the approach
      const at = (z, d) => riverX(z) + s2 * (BE + d), z0 = bz - hwD - 0.3, z1 = bz + hwD + 0.3, ya = Y0 - 3.4, yb = Y0 - 0.5, o = { color: [0.7, 0.7, 0.68], uv: 3 };
      B.poly('concrete', [[at(z0, -0.05), ya, z0], [at(z1, -0.05), ya, z1], [at(z1, -0.05), yb, z1], [at(z0, -0.05), yb, z0]], [-s2, 0, 0], o);
      B.poly('concrete', [[at(z0, -0.05), Y0 - 0.49, z0], [at(z1, -0.05), Y0 - 0.49, z1], [at(z1, 1.2), Y0 - 0.49, z1], [at(z0, 1.2), Y0 - 0.49, z0]], [0, 1, 0], o);
      for (const [zz, e] of [[z0, -1], [z1, 1]]) {                                                                                 // wing walls
        B.poly('concrete', [[at(zz, -0.05), ya, zz], [at(zz, 3.2), ya, zz], [at(zz, 3.2), Y0 + 0.3, zz], [at(zz, -0.05), Y0 + 0.3, zz]], [0, 0, e], o);
        B.poly('concrete', [[at(zz, -0.05), Y0 + 0.3, zz], [at(zz, 3.2), Y0 + 0.3, zz], [at(zz + e * 0.35, 3.2), Y0 + 0.3, zz + e * 0.35], [at(zz + e * 0.35, -0.05), Y0 + 0.3, zz + e * 0.35]], [0, 1, 0], { color: [0.76, 0.76, 0.74] });
        B.poly('concrete', [[at(zz + e * 0.35, -0.05), ya, zz + e * 0.35], [at(zz + e * 0.35, 3.2), ya, zz + e * 0.35], [at(zz + e * 0.35, 3.2), Y0 + 0.3, zz + e * 0.35], [at(zz + e * 0.35, -0.05), Y0 + 0.3, zz + e * 0.35]], [0, 0, e], o);
        B.poly('concrete', [[at(zz, -0.05), ya, zz], [at(zz + e * 0.35, -0.05), ya, zz + e * 0.35], [at(zz + e * 0.35, -0.05), Y0 + 0.3, zz + e * 0.35], [at(zz, -0.05), Y0 + 0.3, zz]], [-s2, 0, 0], o); }
    }
    // deck drains: small cast scuppers through the edge beams every 6 m
    B.detail(1, () => { for (let x = -12; x <= 12; x += 6) for (const s2 of [-1, 1]) { const zz = bz + s2 * (bw / 2 + 0.52); B.cyl('dark', rx + x, Y0 - 0.95, zz, 0.06, 0.06, 0.45, 8, { color: [0.2, 0.2, 0.21], cap: true }); } });
    B.frame(rx, Y0, bz, 0);
    for (const sd of [-1, 1]) {
      // parapet runs over the channel only, ending over the revetment top, so the bank walkway passes its end
      const zp = sd * (bw / 2 + 0.16), rc2 = riverX(bz + zp) - rx, PL = 2 * BE, pc0 = rc2, pL = PL;
      B.bbox('concrete', pc0, 0.3, zp, pL, 0.5, 0.3, 0.025, { color: [0.8, 0.8, 0.78], uv: 3 });
      B.bbox('concrete', pc0, 0.8, zp, pL + 0.02, 0.06, 0.36, 0.015, { color: [0.72, 0.72, 0.7] });
      B.detail(1, () => {
        for (let x = pc0 - pL / 2 + 1; x <= pc0 + pL / 2 - 1; x += 2) B.bbox('alu', x, 0.86, zp, 0.06, 0.52, 0.06, 0.008, { color: [0.62, 0.66, 0.7] });
        for (const yy of [1.1, 1.36]) B.bbox('alu', pc0, yy, zp, pL - 1.6, 0.05, 0.05, 0.008, { color: [0.66, 0.7, 0.74] });
      });
      addBox(rx + pc0, bz + zp, pL / 2, 0.2, 0);
      if (bw < 8) B.bbox('concrete', rc2, 0.3, sd * (bw / 2 - 0.25), 2 * BE - 0.8, 0.2, 0.5, 0.02, { color: [0.78, 0.78, 0.76] });   // narrow ledge beside the lane
      for (const ex of [-1, 1]) { // name pillars
        const px = pc0 + ex * (pL / 2 - 0.4);
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
    addPlatform(rx, bz, BE + 2.5, bw / 2, 0, Y0 + 0.35);
    // steel finger joints across the road at both deck ends
    { const n2 = Math.hypot(1, kx); for (const ex of [-1, 1]) RN.decal(B, 'metal', [rx + ex * BE, bz], [1 / n2, -kx / n2], 0.11, RN.byId.get(id).hw * n2, { color: [0.36, 0.36, 0.36], lift: 0.006, road: false }); } // finger joints along the bank lines
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
  entity('konbini_pole_sign', () => { // the konbini's pole sign at the corner of the lot
    const px = 151.5, pz = -17.2;
    B.frame(px, Y0 + 0.08, pz, 0); B.cyl('steel', 0, 0, 0, 0.16, 0.14, 6.2, 16, { color: [0.85, 0.86, 0.88] }); B.bbox('concrete', 0, -0.1, 0, 0.8, 0.3, 0.8, 0.03, { color: [0.72, 0.72, 0.7] });
    B.bbox('plastic', 0, 6.1, 0, 2.3, 1.6, 0.5, 0.05, { color: [0.95, 0.95, 0.95] }); B.frame(0, 0, 0, 0); addCircle(px, pz, 0.25);
    for (const e of [-1, 1]) { const m = signMesh(2.1, 1.4, (g, W2, H2) => { g.fillStyle = '#fff'; g.fillRect(0, 0, W2, H2); g.fillStyle = '#0a8a4b'; g.fillRect(0, 0, W2, H2 * 0.2); g.fillStyle = '#1a5fb4'; g.fillRect(0, H2 * 0.8, W2, H2 * 0.2); g.fillStyle = '#f08a14'; g.fillRect(0, H2 * 0.2, W2, H2 * 0.08);
      g.fillStyle = '#0a4f8f'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `bold ${H2 * 0.24}px Arial`; g.fillText('SUNNY', W2 / 2, H2 * 0.42); g.fillText('MART', W2 / 2, H2 * 0.66); }, 1.4);
      m.position.set(px, Y0 + 0.08 + 6.9, pz + e * 0.26); m.rotation.y = e > 0 ? 0 : Math.PI; scene.add(m); }
  });
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
  // ---------------------------------------------------------------- 桜川ニュータウン: the apartment district (danchi.js)
  // east of the river, beyond the paddy belt: its buildings, parking courts, courtyards, paths, park and sports ground
  const LBd = new LGeo(64), estateTrees = [], estateSak = [];
  const danchi = buildDanchi({ B, Y0, gy: (x, z) => hf.groundAt(x, z), RN, riverX, occRect, extras, hf, bench, LB: LBd, busStop, garbagePoint, occAt: (x, z, r) => occRect(x, z, r, r, 0, 0, true) });
  for (const sp of danchi.carSpots) carSpots.push(sp);
  for (const b of danchi.bikes) bikeList.push(b);
  for (const g of danchi.groves) BAMBOO_SITES.push({ ...g, H: [9, 13] });
  entity('bicycle_park', () => { // covered bicycle park beside the station forecourt (駐輪場): steel frames, a long mono-pitch roof, racks, bikes
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
  });
  const SCH = { x: -89.75, z: 223, w: 113, d: 64 }, PK = { x: -212, z: 69.5, w: 42, d: 32 };
  reserve(SCH.x, SCH.z, SCH.w / 2 + 1, SCH.d / 2 + 1, 0);
  school(B, SCH.x, hf.groundAt(SCH.x, SCH.z), SCH.z, Math.PI, SCH.w, SCH.d, drng, schoolSak, bikeList, extras);
  hf.paint2(0, SCH.x - SCH.w / 2, SCH.z - SCH.d / 2, SCH.x + SCH.w / 2, SCH.z + SCH.d / 2, (x, z) => Math.abs(x - SCH.x) < SCH.w / 2 - 4 && Math.abs(z - SCH.z) < SCH.d / 2 - 4 ? 1 : 0);
  hf.paint2(2, SCH.x - SCH.w / 2, SCH.z - SCH.d / 2, SCH.x + SCH.w / 2, SCH.z + SCH.d / 2, (x, z) => Math.abs(x - SCH.x) < SCH.w / 2 - 4.5 && Math.abs(z - SCH.z) < SCH.d / 2 - 4.5 ? 1 : 0);
  reserve(PK.x, PK.z, PK.w / 2 + 1, PK.d / 2 + 1, 0);
  { // municipal tennis courts east of road B, reached by a gravel path from the footway
    const TC = { x: 152, z: 292, r: -Math.PI / 2 };
    reserve(TC.x, TC.z, 22, 21.5, 0); reserve((TC.x - 22 + 116) / 2, TC.z, (TC.x - 22 - 116) / 2 + 0.5, 2, 0);
    let ty = -1e9; for (let dx = -21; dx <= 21; dx += 3) for (let dz = -21; dz <= 21; dz += 3) ty = Math.max(ty, hf.groundAt(TC.x + dx, TC.z + dz)); // the slab clears the highest ground
    tennisCourts(B, TC.x, ty, TC.z, TC.r, drng, extras, lampPoints);
    hf.paint2(2, TC.x - 23, TC.z - 22, TC.x + 23, TC.z + 22, () => 1);
    hf.paint2(0, 114, TC.z - 2.2, TC.x - 18, TC.z + 2.2, () => 1); hf.paint2(2, 114, TC.z - 1.6, TC.x - 18, TC.z + 1.6, () => 1);
    RN.cuts.push({ id: 'B', side: -1, s0: sOf('B', 110, TC.z) - 1.5, s1: sOf('B', 110, TC.z) + 1.5 });
  }
  const park = playground(B, PK.x, hf.groundAt(PK.x, PK.z), PK.z, Math.PI, PK.w, PK.d, drng, parkTrees, extras, lampPoints, bikeList);
  { // packed-earth play areas, a mown lawn in the middle (the park is turned 180 degrees: local = -(world - centre))
    const [l0, m0, l1, m1] = park.lawn, inLawn = (x, z) => { const lx = -(x - PK.x), lz = -(z - PK.z); return lx > l0 && lx < l1 && lz > m0 && lz < m1; };
    hf.paint2(0, PK.x - PK.w / 2, PK.z - PK.d / 2, PK.x + PK.w / 2, PK.z + PK.d / 2, (x, z) => Math.abs(x - PK.x) < PK.w / 2 - 1 && Math.abs(z - PK.z) < PK.d / 2 - 1 && !inLawn(x, z) ? 1 : 0);
    hf.paint2(2, PK.x - PK.w / 2, PK.z - PK.d / 2, PK.x + PK.w / 2, PK.z + PK.d / 2, (x, z) => Math.abs(x - PK.x) < PK.w / 2 - 1.5 && Math.abs(z - PK.z) < PK.d / 2 - 1.5 && !inLawn(x, z) ? 1 : 0);
    hf.paint2(3, PK.x - PK.w / 2, PK.z - PK.d / 2, PK.x + PK.w / 2, PK.z + PK.d / 2, (x, z) => inLawn(x, z) ? 1 : 0);
    hf.paint2(2, PK.x - 2, PK.z - PK.d / 2 - 4, PK.x + 2, PK.z - PK.d / 2 + 1, () => 1);   // the entrance path out to the street
  }

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
  // (no frontage lots in the apartment district, nor in the gap of fields between it and the river)
  const lotFree = (cx, cz, hw, hd, r) => !occRect(cx, cz, hw, hd, r, 0, true) && Math.abs(cx) < 640 && Math.abs(cz) < 345 && !inPaddyZone(cx, cz) && !inDanchi(cx, cz, 8) && !(cx > 232 && cx < 342 && cz > -75 && cz < 340)
    && hf.groundAt(cx, cz) < Y0 + 1.2 && hf.groundAt(cx, cz) > Y0 - 0.6;
  for (const R of [...ROADS].sort((a2, b2) => (b2.noMarks ? 1 : 0) - (a2.noMarks ? 1 : 0))) {
    if (R.kind === 'path' || R.noLots) continue;
    const alley = !!R.noMarks;
    let segS = 0;
    for (const [a, b] of roadSegs(R)) {
      const s00 = segS; segS += Math.hypot(b[0] - a[0], b[1] - a[1]);
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
          const set = R.w / 2 + Math.max(R.walk || 0, walkAlong(R, side, s00 + t - 1, s00 + t + w + 1)) + (shopZone ? 0.12 : ind ? 1.05 : rr(...D.set));
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
    hf.paintPave(P.x - 12, P.z - 12, P.x + 12, P.z + 12, (x2, z2) => { const cc = Math.cos(P.r), ss = Math.sin(P.r), ddx = x2 - P.x, ddz = z2 - P.z; return Math.abs(ddx * cc - ddz * ss) < 1.32 && Math.abs(ddx * ss + ddz * cc) < P.len / 2 + 0.1 ? 1 : 0; });
    if (RN.walkAt(RN.byId.get(P.road.id), P.side, P.s)) RN.cuts.push({ id: P.road.id, side: P.side, s0: P.s - 1.6, s1: P.s + 1.6 });
  }
  // corners of the main junctions that no lot could take (the curb returns eat into them) become small coin car parks,
  // the way Japanese street corners usually end up
  for (const I of inters) {
    if (!I.roads.some(R => R.id === 'A' || R.id === 'B') || onBridge(I.p[0], I.p[1]) || inDanchi(I.p[0], I.p[1], 30) || I.p[0] > 232) continue;
    for (const cr of I.corners) {
      const bx = cr.O[0] - I.p[0], bz = cr.O[1] - I.p[1], bl = Math.hypot(bx, bz); if (bl < 1) continue;
      const r = Math.atan2(cr.a.d[0], cr.a.d[1]);
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
    if (lot.kind === 'garden') { allotment(B, { x: lot.x, y, z: lot.z, r: lot.r, w: lot.w, d: lot.d }, mulberry32((Math.floor(lot.x * 131 + lot.z * 977) >>> 0) + 17), (x, z) => hf.groundAt(x, z));
      hf.paint2(2, lot.x - 10, lot.z - 10, lot.x + 10, lot.z + 10, (x2, z2) => { const c = Math.cos(lot.r), s2 = Math.sin(lot.r), dx = x2 - lot.x, dz = z2 - lot.z; return Math.abs(dx * c - dz * s2) < lot.w / 2 - 0.5 && Math.abs(dx * s2 + dz * c) < lot.d / 2 - 1 ? 1 : 0; }); continue; }
    if (lot.shop) {
      shopBuilding(B, { x: lot.x, y, z: lot.z, r: lot.r, w: lot.w, d: Math.min(lot.d, 12), old: lot.district === 'old' || lot.era === 'old' }, rng, extras);
      hf.paint2(2, lot.x - 9, lot.z - 9, lot.x + 9, lot.z + 9, (x, z) => { const c = Math.cos(lot.r), s = Math.sin(lot.r), dx = x - lot.x, dz = z - lot.z; return Math.abs(dx * c - dz * s) < lot.w / 2 && Math.abs(dx * s + dz * c) < lot.d / 2 ? 1 : 0; });
      if (rng() < 0.18) vend.push({ lot, off: [lot.w / 2 - 0.6, Math.min(lot.d, 12) / 2 + 0.6] });
      if (srng() < 0.45) entity('shop_planter', () => { // flower planter by the shop door
        const fz = Math.min(lot.d, 12) / 2 + 0.45, lx = -lot.w / 2 + 1.1;
        B.frame(lot.x, y, lot.z, lot.r); B.box('wood', lx, 0, fz, 1.3, 0.42, 0.5, { color: [0.62, 0.44, 0.3] });
        const [px, pz] = lotW(lot, lx, fz); addBox(px, pz, 0.65, 0.25, lot.r, y - 1, y + 0.5);
        for (const o of [-0.35, 0.35]) { const [hx, hz] = lotW(lot, lx + o, fz); hydras.push({ x: hx, y: y + 0.36, z: hz, s: 0.62 + srng() * 0.15, sx: 1, r: srng() * 6.28, c: hydraColor(srng) }); }
      });
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
      if (info.carSpot && !lot.back) { // lowered kerb in front of the parking space, wherever a footway runs past it
        const n = RN.byId.get(lot.road.id), cp = info.carSpot.p, sc = sOf(lot.road.id, cp[0], cp[2]), q = RN.sampleAt(n, sc);
        const side = Math.sign((cp[0] - q.x) * -q.d[1] + (cp[2] - q.z) * q.d[0]);
        if (RN.walkAt(n, side, sc)) RN.cuts.push({ id: lot.road.id, side, s0: sc - 1.5, s1: sc + 1.5 });
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
  // agricultural edge (畑): the land north of the last street is laid out the way it is farmed — strips of plots fronting
  // lane S3 and the farm lane FE on both sides, each plot a different width, separated by trodden earth paths (畦道)
  // that run from the lane to the back of the plots, with a grass headland between the back-to-back rows. A plot is
  // an open vegetable field, a row of tunnel greenhouses or (near the houses) a fenced kitchen garden, always with its
  // working end — shed, gate, open greenhouse doors — toward its lane
  {
    const frng = mulberry32(4711), gy = (x, z) => hf.groundAt(x, z), fields = [];
    const laneZ = x => { const P = ROADS.find(R => R.id === 'FE').pts; for (let i = 0; i + 1 < P.length; i++) if (x >= P[i][0] && x <= P[i + 1][0]) return lerp(P[i][1], P[i + 1][1], (x - P[i][0]) / (P[i + 1][0] - P[i][0])); return 312; };
    const s3Z = x => 258;
    // rows: [front line (lane edge + verge), direction away from the lane, depth range, near houses?]
    const rows = [
      { front: x => s3Z(x) + 2.1 + 1.0, dir: 1, dmin: 16, dmax: 20, town: true },
      { front: x => laneZ(x) - 1.5 - 0.9, dir: -1, dmin: 20, dmax: 25 },
      { front: x => laneZ(x) + 1.5 + 0.9, dir: 1, dmin: 18, dmax: 27 },
    ];
    const footpath = (x0, z0, x1, z1, wd = 0.55) => { // trodden earth strip with ragged edges, draped on the ground
      const L = Math.hypot(x1 - x0, z1 - z0); if (L < 1) return;
      const ux = (x1 - x0) / L, uz = (z1 - z0) / L, nx = -uz, nz = ux, N = Math.max(2, Math.ceil(L / 0.8)), prng = mulberry32(Math.floor(x0 * 31 + z0 * 17) >>> 0);
      const e = []; for (let k = 0; k <= N; k++) e.push([wd + (prng() - 0.5) * 0.14, wd + (prng() - 0.5) * 0.14]);
      const P = (t, sg, w2) => { const x = x0 + ux * t + nx * sg * w2, z = z0 + uz * t + nz * sg * w2; return [x, gy(x, z) + 0.03, z]; };
      B.frame(0, 0, 0, 0);
      for (let k = 0; k < N; k++) { const t0 = L * k / N, t1 = L * (k + 1) / N, pts = [P(t0, 1, e[k][0]), P(t1, 1, e[k + 1][0]), P(t1, -1, e[k + 1][1]), P(t0, -1, e[k][1])];
        B.poly('gravelPath', pts, [0, 1, 0], { color: [0.84, 0.76, 0.64], uvs: pts.map(v => [v[0] / 2, v[2] / 2]) }); }
      hf.paintPave(Math.min(x0, x1) - 2, Math.min(z0, z1) - 2, Math.max(x0, x1) + 2, Math.max(z0, z1) + 2, (px, pz) => { const vx = px - x0, vz = pz - z0, t = vx * ux + vz * uz; return t > -0.2 && t < L + 0.2 && Math.abs(vx * uz - vz * ux) < 0.62 ? 1 : 0; });
    };
    const blocked = [[-156, -144], [104, 120], [-406, -393]]; // the track C carries on as, road B, road D
    for (const row of rows) {
      let x = -392 + frng() * 3;
      while (x < 100) {
        const gh = frng() < (row.town ? 0.15 : 0.28), n = 1 + Math.floor(frng() * 3.2);
        const w = gh ? n * 6.6 + 0.6 : 10 + frng() * 10, dep = row.dmin + frng() * (row.dmax - row.dmin);
        if (blocked.some(([a2, b2]) => x + w > a2 && x < b2)) { x = Math.max(...blocked.filter(([a2, b2]) => x + w > a2 && x < b2).map(([, b2]) => b2)) + 1.8; continue; }
        const xc = x + w / 2, zf = row.front(xc), zc = zf + row.dir * dep / 2, r = row.dir > 0 ? Math.PI : 0; // local +z (working end) toward the lane
        const hs = [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a2, b2]) => gy(xc + a2 * w / 2, zc + b2 * dep / 2));
        const flat = Math.max(...hs) - Math.min(...hs) < (gh ? 0.4 : 0.9) && Math.abs(hs[0] - Y0) < 1.2 && !inPaddyZone(xc, zc);
        if (!flat || occRect(xc, zc, w / 2 + 0.6, dep / 2 + 0.3, 0, 0, true)) { x += 4; continue; }
        occRect(xc, zc, w / 2 + 0.3, dep / 2, 0, 1);
        const y = hs[0], prng = mulberry32(90001 + Math.floor(xc * 13 + zc * 7));
        if (gh) {
          const film = frng() < 0.15 ? 'bare' : frng() < 0.4 ? 'old' : 'new', hgt = 2.9 + frng() * 0.5, c = Math.cos(r), s2 = Math.sin(r);
          for (let k = 0; k < n; k++) { const lx = -w / 2 + 3.6 + k * 6.6, gx = xc + lx * c, gz = zc - lx * s2;
            greenhouse(B, { x: gx, y: gy(gx, gz), z: gz, r, w: 5.4, d: dep - 1, film, h: hgt }, prng, gy);
            if (film === 'bare') continue;
            for (const sd of [-1, 1]) addBox(gx + sd * 2.7, gz, 0.08, (dep - 1) / 2, 0);
            for (const e of [-1, 1]) for (const sd of [-1, 1]) addBox(gx + sd * 1.65, gz + e * (dep - 1) / 2, 1.05, 0.08, 0);
            addBox(gx, gz + row.dir * (dep - 1) / 2, 0.6, 0.08, 0); } // (the closed end, away from the lane)
        } else if (row.town && frng() < 0.35) allotment(B, { x: xc, y, z: zc, r, w, d: dep }, prng, gy);
        else field(B, { x: xc, y, z: zc, r, w, d: dep, shed: frng() < 0.45 }, prng, gy);
        fields.push({ x: xc, z: zc, w, d: dep, kind: gh ? 'greenhouse' : 'field' });
        hf.paint2(2, xc - w / 2, zc - dep / 2, xc + w / 2, zc + dep / 2, (px, pz) => Math.abs(px - xc) < w / 2 - 0.4 && Math.abs(pz - zc) < dep / 2 - 0.4 ? 1 : 0);
        // the earth path up the side of the plot, from the lane to the back
        const gapX = x + w + 0.75;
        if (!blocked.some(([a2, b2]) => gapX > a2 - 1 && gapX < b2 + 1) && gapX < 100) footpath(gapX, zf - row.dir * 0.9, gapX, zf + row.dir * (dep + 0.4));
        x += w + 1.5;
      }
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
        if (onWalk && urng() < 0.25) entity('fire_hydrant', () => { const hx = x0 + l[0] * side * (n.hw + n.walk - 0.35), hz = z0 + l[1] * side * (n.hw + n.walk - 0.35), hy = topY(hx, hz);
          B.frame(hx, hy, hz, 0); B.cyl('plastic', 0, -0.02, 0, 0.1, 0.1, 0.6, 12, { color: [0.85, 0.12, 0.1] }); B.cyl('plastic', 0, 0.58, 0, 0.12, 0.05, 0.12, 12, { color: [0.85, 0.12, 0.1], cap: true });
          for (const e of [-1, 1]) B.cyl('steel', e * 0.1, 0.35, 0, 0.035, 0.035, 0.08, 8, { color: [0.7, 0.7, 0.68], cap: true }); B.frame(0, 0, 0, 0); addCircle(hx, hz, 0.14); });
      }
    }
  }
  // street trees in square planters along the main road's sidewalks, outside the shopping street
  const streetTrees = [];
  for (let x = -430; x < 430; x += 13) for (const sd of [-1, 1]) {
    if (x > -268 && x < 205 || Math.abs(x - riverX(-25)) < 32 || nearInter(x, -25, ROADS[0], 5)) continue;
    const z = -25 + sd * 4.4, ty = topY(x, z); streetTrees.push({ x, y: ty + 0.02, z, s: lerp(7, 8.5, drng()), sx: 0.9, r: drng() * 6.28, c: leafColor(drng) });
    entity('tree_planter', () => { B.frame(x, ty - 0.06, z, 0); B.bbox('concrete', 0, 0, 0, 0.92, 0.14, 0.92, 0.02, { color: [0.8, 0.8, 0.77], skip: 'ny' }); B.box('plain', 0, 0.02, 0, 0.8, 0.1, 0.8, { color: [0.3, 0.23, 0.18] });
    for (const [gx, gz, gw, gd] of [[0, 0.33, 0.8, 0.14], [0, -0.33, 0.8, 0.14], [0.33, 0, 0.14, 0.52], [-0.33, 0, 0.14, 0.52]]) B.box('metal', gx, 0.12, gz, gw, 0.012, gd, { color: [0.22, 0.22, 0.23] }); }); // tree grate
  }
  // bus stops, post boxes, garbage points
  for (const [x, sd] of [[-205, 1], [58, -1], [300, 1]]) { const z = -25 + sd * 5.55; busStop(B, x, topY(x, z), z, sd > 0 ? Math.PI : 0); }
  for (const z of [-150, 120]) busStop(B, 110 + 4.3, topY(114.3, z), z, -Math.PI / 2, false);
  for (const [x, sd] of [[-128, 1], [22, 1], [158, -1], [-240, -1]]) postBox(B, x, topY(x, -25 + sd * 5.4), -25 + sd * 5.4, sd > 0 ? Math.PI : 0);
  for (const R of ROADS) if (R.kind === 'lane' && R.id !== 'R' && !R.district) for (const [a, b] of roadSegs(R)) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
    for (let t = 40 + drng() * 30; t < L - 20; t += 90 + drng() * 60) {
      const sd = drng() < 0.5 ? 1 : -1, x = a[0] + dx * t - dz * sd * (R.w / 2 + 0.45), z = a[1] + dz * t + dx * sd * (R.w / 2 + 0.45);
      if (Math.abs(x) > 440 || Math.abs(z) > 330 || nearInter(x, z, R, 4) || onRail(z) || Math.abs(x - riverX(z)) < 26 || hf.groundAt(x, z) > Y0 + 1) continue;
      garbagePoint(B, x, hf.groundAt(x, z), z, Math.atan2(dx, dz) + (sd > 0 ? -Math.PI / 2 : Math.PI / 2), drng);
    }
  }
  // festival lantern strings across the shopping street
  for (let x = -252; x < 190; x += 21) { entity('lantern_string', () => {
    if (nearInter(x, -25, ROADS[0], 5) || Math.abs(x - riverX(-25)) < 26) return;
    B.frame(x, Y0, -25, 0);
    for (const sd of [-1, 1]) { B.box('wood', 0, 0.1, sd * 5.75, 0.15, 5.35, 0.15, { color: [0.52, 0.37, 0.26] }); B.box('wood', 0, 5.4, sd * 5.75, 0.2, 0.08, 0.2, { color: [0.3, 0.22, 0.16] }); addCircle(x, -25 + sd * 5.75, 0.16); }
    const N = 10, pt = i => { const t = i / N; return [0, 5.2 - 0.75 * 4 * t * (1 - t), -5.75 + 11.5 * t]; };
    for (let i = 0; i < N; i++) B.beam('dark', pt(i), pt(i + 1), 0.025, 0.025);
    for (let i = 1; i < N; i++) { const p = pt(i); B.box('dark', 0, p[1] - 0.16, p[2], 0.015, 0.16, 0.015); chochin(B, 0, p[1] - 0.62, p[2], i % 2 ? [1, 0.3, 0.2] : [1, 0.88, 0.7], 0.8); }
    lampPoints.push({ p: [x, 4.4, -25], s: 0.6 });
  }); }
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
    if (R.kind === 'path' || R.district) continue; // (the district's cables are underground)
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
      // a road across the cell: the water stops at the levee beyond its embankment
      const rowFree = (zz) => { for (let xx = a[0]; xx <= b[0] + 0.01; xx += (b[0] - a[0]) / 8) if (roadNear(xx, zz, 4.5)) return false; return true; };
      const colFree = (xx) => { for (let zz = a[2]; zz <= b[2] + 0.01; zz += (b[2] - a[2]) / 6) if (roadNear(xx, zz, 4.5)) return false; return true; };
      while (a[2] < b[2] - 2 && !rowFree(a[2])) a[2] += 0.5; while (b[2] > a[2] + 2 && !rowFree(b[2])) b[2] -= 0.5;
      while (a[0] < b[0] - 2 && !colFree(a[0])) a[0] += 0.5; while (b[0] > a[0] + 2 && !colFree(b[0])) b[0] -= 0.5;
      if (b[2] - a[2] < 3 || b[0] - a[0] < 3) continue;
      B.quad('paddyWater', [a[0], y, b[2]], [b[0], y, b[2]], [b[0], y, a[2]], [a[0], y, a[2]], { uv: 10 });
    }
    hf.paint2(1, x0, z0, x1, z1, (x, z) => inPaddyZone(x, z) && paddyOK(x, z) && paddyCell(x, z) > 1.4 && !roadNear(x, z, 4.8) ? 1 : 0);
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
    || inPaddyZone(x, z) && paddyOK(x, z) || !free(x, z, Math.ceil(pad)) || Math.hypot(x - SHRINE.x, z - SHRINE.z + 10) < 26 || Math.abs(x - SHRINE.x) < 9 && z > SHRINE.z && z < -220
    || BAMBOO_SITES.some(g => Math.hypot(x - g.x, z - g.z) < g.R * 1.35 + pad) || inDanchi(x, z, 3 + pad);
  // cedar plantations dominate the Japanese hills (tall straight sugi), with konara / camphor / maple woods and bamboo
  // groves at their damp feet; the meadow fringe stays out of the town (towngreen.js plants that)
  const { trees: wild, saplings, hash: treeHash } = plantForest({ hf, forest: FOREST, moist: MOIST, seed: 77, water: Y0 - 3, snow: 900, blocked: wildBlocked,
    alpine: [200, 320], lowland: [8, 34], meadow: 700, meadowMaxH: 60, mix: { tall: 3.2, spruce: 0.9, old: 0.7, pine: 0.6, young: 0.9 }, bamboo: 0.55, conifer: 0.9, edgeBroad: 0.45, step: 5.5, spacing: 1.12,
    meadowOK: (x, z) => !(Math.abs(x) < 470 && Math.abs(z) < 350) && !inPaddyZone(x, z) && !inDanchi(x, z, 18) });
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
  const green = plantTown({ hf, free, lots, lotW, riverX, inPaddyZone, SHRINE, Y0, PADDIES, stationX: RAIL.stationX, hash: treeHash, B, LB: LBg, bench, bambooSites: BAMBOO_SITES,
    isShop: (x, z) => Math.abs(z + 25) < 26 && x > -275 && x < 205 || Math.hypot(x - 134, z) < 26 });
  // the floor of every bamboo stand is its own fallen leaves: forest-floor litter in the middle (the lawn and most of the
  // grass give way), grass creeping back in toward the rim
  const litter = (x, z, R) => hf.paint2(2, x - R, z - R, x + R, z + R, (px, pz) => 0.45 * smoothstep(R * 0.85, R * 0.45, Math.hypot(px - x, pz - z)));
  for (const g of green.groves) {
    litter(g.x, g.z, g.R);
    const { HN, HALF, CELL } = hf, i0 = Math.floor((g.x - g.R + HALF) / CELL), i1 = Math.ceil((g.x + g.R + HALF) / CELL), j0 = Math.floor((g.z - g.R + HALF) / CELL), j1 = Math.ceil((g.z + g.R + HALF) / CELL);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const o = j * HN + i, f = smoothstep(g.R, g.R * 0.55, Math.hypot(-HALF + i * CELL - g.x, -HALF + j * CELL - g.z));
      if (f <= 0) continue; hf.mask[o * 4] = Math.max(hf.mask[o * 4], f * 235); FOREST[o] = Math.max(FOREST[o], f * 0.92); hf.mask2[o * 4 + 3] = Math.min(hf.mask2[o * 4 + 3], (1 - f) * 255); }
  }
  for (const t of green.trees) { t.town = true; (t.kind === 'sakura' ? sakura : trees).push(t); }
  for (const t of estateSak) { const h = hf.groundAt(t.x, t.z); sakura.push({ town: true, x: t.x, y: h - 0.2, z: t.z, s: lerp(6.5, 8.5, srng()), sx: 1, r: srng() * 6.28, c: sakuraColor(srng) }); }
  for (const t of schoolSak) { const h = hf.groundAt(t.x, t.z); sakura.push({ town: true, x: t.x, y: h - 0.2, z: t.z, s: lerp(7, 9, srng()), sx: 1, r: srng() * 6.28, c: sakuraColor(srng) }); }
  for (const b of green.bushes) bushes.push(b);
  for (const b of danchi.bushes) bushes.push(b);
  for (const hd of danchi.hedges) { const [ax, az] = hd.a, [bx, bz] = hd.b, L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L)), yaw = Math.atan2(-(bz - az), bx - ax), col = new THREE.Color(0.3, 0.46, 0.26);
    for (let k = 0; k < n; k++) { const t = (k + 0.5) / n, x = lerp(ax, bx, t), z = lerp(az, bz, t); green.hedges.push({ x, y: hf.groundAt(x, z) - 0.05, z, s: hd.h, sx: L / n / 1.04 * 1.3 / hd.h, sz: 1, r: yaw, c: col.clone().multiplyScalar(0.95 + srng() * 0.1) }); } }
  for (const b of green.hydras) hydras.push(b);
  // under the hill woods: logs, dead branches, low shrubs
  const floor = forestFloor({ hf, forest: FOREST, moist: MOIST, trees, seed: 9, water: Y0 - 3, blocked: wildBlocked, logs: 260, twigs: 2600, shrubs: 1400 });
  for (const b of floor.shrubs) bushes.push(b);
  hf.paintCanopy([...trees, ...sakura]);
  hf.uploadHeight(); hf.uploadMasks();
  progress('Building terrain', 0.76); await tick();
  const firstNatural = scene.children.length;
  const terrainGroup = await buildTerrainMeshes(hf, terrainMaterial(hf, layers, { water: RIVER_LV, snow: 900, conifer: 0.72, riverBed: true }));
  // the hill woods and the riverside trees are mirrored in the river; garden and street trees, saplings and the
  // forest floor are not (keeps the reflection pass cheap)
  const allTrees = [...trees, ...sakura.map(t => ({ ...t, kind: 'sakura', v: t.v ?? Math.floor(srng() * 4) }))];
  buildTrees(allTrees.filter(t => !t.town));
  for (let i = firstNatural; i < scene.children.length; i++) reflected.add(scene.children[i]);
  buildTrees([...allTrees.filter(t => t.town), ...saplings]);
  buildTrees(floor.twigs, { colliders: false });
  buildLogs(floor.logs);
  // no grass in the river: nothing is rooted within 30 cm of the surface (it thins out and shortens above that), and no
  // reed beds stand in the channel
  const grass = buildGrass(hf, layers.grass.d, { water: RIVER_LV, snow: 900, reeds: false, shore: 0.9, dry: 0.3 });
  // where the water meets a revetment the depth follows the slab (the ground under it lies well below), so the water
  // clears toward the wall and laps against it in a line of foam, as it does on the natural banks
  const bankGLSL = /* glsl */`
    float bankDepth(vec2 p, float d) {
      if (abs(p.y) > ${RIVER_END.toFixed(1)}) return d;
      float rd = abs(p.x - (215.0 + 22.0 * sin(p.y * 0.0075) + 8.0 * sin(p.y * 0.021 + 1.0)));
      // (the face is read as shelving gently for the shading, so the contact is a soft clear margin with a lapping line,
      // not a hairline)
      return rd > 12.2 ? min(d, max(0.0, ${REV_WL.toFixed(4)} - rd) * 0.9) : d;
    }`;
  const water = buildWater(hf, { level: RIVER_LV, normals: waterNormals, hide: [grass], waves: 6, strength: 0.3, deep: '#1d5a78', mid: '#2e8f9a', shallow: '#5cc4b0',
    active: c => Math.abs(c.x - riverX(c.z)) < 380, bank: bankGLSL });
  reflected.add(water);
  for (const m of [MT.pondWater, MT.fountainWater]) m.userData.linkReflection(water);
  // where the reflection can be seen: the river channel in 20 m boxes, and (once built) every pond and fountain basin
  water.userData.regions = [];
  for (let z = -1000; z < 1000; z += 20) { const a = riverX(z), b = riverX(z + 20); water.userData.regions.push(new THREE.Box3(new THREE.Vector3(Math.min(a, b) - 17, RIVER_LV - 4, z), new THREE.Vector3(Math.max(a, b) + 17, RIVER_LV + 2, z + 20))); }

  // flush all static geometry
  progress('Merging geometry', 0.82); await tick();
  for (const m of B.flush(MT, { paint: false, stopLegend: false, cycleLegend: false, tactileL: false, tactileD: false, manhole: false, glassLit: false, glass: true, window: false, shopWindow: false, paddyWater: false, pondWater: false, fountainWater: false, waterFlow: false, waterFoam: false, turf: false, net: false, lamp: false, chain: false, poly: false }))
    if (m.material === MT.pondWater || m.material === MT.fountainWater) { m.geometry.computeBoundingBox(); water.userData.regions.push(m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld).expandByScalar(0.5)); water.userData.watchVisibility(m); }
  Bx.flush(MT, { paint: false, tactileL: false, tactileD: false, glassLit: false, window: false, shopWindow: false, lamp: false, poly: false });
  const landmarks = flushLandmarks(LB), parkBenches = flushLandmarks(LBg), danchiBenches = flushLandmarks(LBd);

  // ---------------------------------------------------------------- scanned props (gardens, shops)
  const [shrub, potted, planter, crate, ubox, weed, manhole] = await modelsP;
  const prng = mulberry32(99);
  const scatterModel = (model, items, byHeight, dist, shadow = true, split = false, meta = null) => withScatterMeta(meta, () => {
    if (!model || !items.length) return;
    const parts = extractParts(model);
    // scanned props are dense: full detail up close, a clustered low-poly copy beyond ~35 m
    const lods = ps => [{ dist: () => Math.min(35, dist()), parts: ps.map(p => ({ ...p, castShadow: shadow })) }, { dist, parts: ps.map(p => ({ ...p, geometry: decimate(p.geometry, 7), castShadow: shadow })) }];
    if (!split) { normalizeParts(parts, byHeight); new Scatter(items, lods(parts), 128); return; }
    // asset sheets with several plants side by side: every plant becomes its own instanced model
    parts.forEach((p, i) => { normalizeParts([p], byHeight); const mine = items.filter((_, k) => k % parts.length === i); if (mine.length) withScatterMeta(meta && { ...meta, prefab: meta.prefab + '_' + (i + 1) }, () => new Scatter(mine, lods([p]), 128)); });
  });
  // the district's rocks (danchi.js, danchipark.js): each stone of the scanned rock set is its own instanced model,
  // the boulder another; every stone sits on the lowest ground under it, sunk by the fraction its record asks
  { const [rockSet, boulderM] = await rockModelsP, stones = [];
    if (rockSet) for (const p of extractParts(rockSet)) stones.push({ parts: [p], dim: normalizeParts([p], false) });
    const bould = boulderM ? (() => { const parts = extractParts(boulderM); return { parts, dim: normalizeParts(parts, false) }; })() : null;
    const low = (x, z, r) => Math.min(hf.groundAt(x, z), hf.groundAt(x - r, z), hf.groundAt(x + r, z), hf.groundAt(x, z - r), hf.groundAt(x, z + r)), groups = new Map();
    for (const q of [...(danchi.rocks || []), ...riverRocks]) { const M = q.kind === 'b' && bould ? bould : stones.length ? stones[q.part % stones.length] : bould; if (!M) continue;
      const h = q.s * M.dim.h * (q.sy || 1), y = low(q.x, q.z, q.s * M.dim.w * 0.3) - h * q.sink;
      if (!groups.has(M)) groups.set(M, []); groups.get(M).push({ x: q.x, y, z: q.z, s: q.s, sx: q.sx, sy: q.sy, r: q.r, tilt: q.tilt, tilt2: q.tilt2, c: q.c });
      if (h * (1 - q.sink) > 0.4) addCircle(q.x, q.z, q.s * M.dim.w * 0.36); }
    // painted like the town's other stone (toon.js): the scan's brightness evened out, its hue kept a little, the
    // instance tint deciding the colour of each stone
    for (const M of [...stones, bould]) if (M) for (const p of M.parts) { p.material = p.material.clone(); p.material.userData.toonNorm = 0.5; }
    for (const [M, items] of groups) withScatterMeta({ prefab: M === bould ? 'boulder' : 'rock_' + (stones.indexOf(M) + 1), category: 'rock' }, () => new Scatter(items, [{ dist: () => 110, parts: M.parts.map(p => ({ ...p, castShadow: true, tint: true })) },
      { dist: () => 360, parts: M.parts.map(p => ({ ...p, geometry: decimate(p.geometry, 10), castShadow: true, tint: true })) }], 96)); }
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
  scatterModel(shrub, shrubs, true, () => Q.props, true, true, { prefab: 'shrub', category: 'vegetation' });
  buildBushes(bushes, 'bush');
  buildBushes(hydras, 'hydra');
  buildBushes(green.hedges, 'hedge', { collide: false });
  buildBushes(green.ivy, 'ivy', { collide: false, hiDist: () => Q.props * 0.5, farDist: () => Q.props * 1.2 });
  // park shade trees (zelkova and oak) and street trees along the main road's sidewalks outside the shops
  const greenTrees = [];
  for (const t of estateTrees) greenTrees.push(makeTree(drng() < 0.5 ? 'zelkova' : 'leaf', t.x, hf.groundAt(t.x, t.z) - 0.2, t.z, drng, { scale: 0.8 }));
  for (const t of parkTrees) greenTrees.push(makeTree(drng() < 0.6 ? 'zelkova' : 'oak', t.x, hf.groundAt(t.x, t.z) - 0.2, t.z, drng, { scale: 0.75 }));
  for (const t of streetTrees) greenTrees.push(makeTree('zelkova', t.x, t.y, t.z, drng, { scale: 0.62, a: 0.5 }));
  for (const t of danchi.trees) greenTrees.push(makeTree(t.kind, t.x, (t.pit ? topY(t.x, t.z) + 0.1 : hf.groundAt(t.x, t.z)) - 0.2, t.z, drng, { scale: t.scale, a: 0.6 }));
  greenTrees.push(shrineTree);
  buildTrees(greenTrees);
  bicycles(bikeList, drng);
  scatterModel(potted, [...pots, ...green.pots], true, () => Q.props * 0.35, true, false, { prefab: 'potted_plant', category: 'prop' });
  scatterModel(weed, [...weeds, ...green.weeds], true, () => Q.props * 0.3, false, true, { prefab: 'weed', category: 'vegetation', field: 'weeds' });
  scatterModel(crate, crates, true, () => Q.props * 0.4, true, false, { prefab: 'crate', category: 'prop' });
  scatterModel(ubox, boxes, true, () => Q.props * 0.6, true, false, { prefab: 'utility_box', category: 'prop' });
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
    { pts: [[-400, -25], [110, -25], [110, -225], [-400, -225]], n: 8, v: 11 },
    { pts: [[-400, -225], [110, -225], [110, -25], [-400, -25]], n: 7, v: 11 },
    { pts: [[-150, -25], [110, -25], [110, 258], [-150, 258]], n: 6, v: 10 },
    { pts: [[-150, 258], [110, 258], [110, -25], [-150, -25]], n: 5, v: 10 },
    { pts: [[-400, 48], [-30, 48], [-30, 188], [-400, 188]], n: 3, v: 8 },
    { pts: [[-400, 188], [-30, 188], [-30, 48], [-400, 48]], n: 2, v: 8 },
    // the western blocks and lane C over its level crossing
    { pts: [[-400, 48], [-150, 48], [-150, 258], [-400, 258]], n: 3, v: 8 },
    { pts: [[-400, 258], [-150, 258], [-150, 48], [-400, 48]], n: 2, v: 8 },
    { pts: [[-150, -25], [-150, -225], [110, -225], [110, -25]], n: 3, v: 9 },
    { pts: [[110, -25], [110, -225], [-150, -225], [-150, -25]], n: 3, v: 9 },
    { pts: [[-1050, -25], [1050, -25]], n: 6, v: 14, open: true },
    { pts: [[1050, -25], [-1050, -25]], n: 6, v: 14, open: true },
    // the apartment district: in from the main road up the avenue, home to town over the Funabashi bridge, and round its loop
    { pts: [[110, -25], [422, -25], [422, 40], [425, 100], [435, 150], [452, 200], [110, 200]], n: 5, v: 11 },
    { pts: [[110, 200], [452, 200], [435, 150], [425, 100], [422, 40], [422, -25], [110, -25]], n: 5, v: 11 },
    { pts: [[346, -25], [346, 200], [452, 200], [435, 150], [425, 100], [422, 56], [346, 56]], n: 2, v: 8 },
    { pts: [[614, -25], [614, 140], [598, 202], [452, 200], [435, 150], [425, 100], [422, 40], [422, -25]], n: 2, v: 8 },
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
  if (SIM) loops.forEach((L, i) => { for (let k = 0; k < L.n; k++) moving.push({ route: routes[i], s: routes[i].len * (k + crng() * 0.5) / L.n, spec: randomCar(crng) }); });
  const fleet = new Fleet([...parked.map(p => p.spec), ...moving.map(m => m.spec)]);
  parked.forEach((p, i) => { const car = fleet.cars[i], T = carDims(car.type), sp = p.sp;
    // bays with a wheel stop: back the car in until its rear tyres touch it (sp.stop: bay point to the stop's face)
    let [x, , z] = sp.p; if (sp.stop != null) { const k = sp.stop - (T.truck ? T.L / 2 - 0.75 : T.wb / 2) - T.r - 0.03; x += Math.sin(sp.r) * k; z += Math.cos(sp.r) * k; }
    const y = sp.y ?? hf.groundAt(x, z) + (sp.p[1] > Y0 + 0.1 ? 0.14 : 0);
    fleet.place(car, x, y, z, sp.r + Math.PI / 2, 0, 0, 0); addBox(x, z, T.L / 2, T.W / 2, sp.r + Math.PI / 2, -1e9, Math.max(Y0, y) + 1.6); });
  const onXing = (x, pad) => { for (let i = 0; i < XINGS.length; i++) if (Math.abs(x - XINGS[i][0]) < XINGS[i][1] + pad) return true; return false; }; // (no closure per query)
  const traffic = new Traffic(fleet, (x, z) => (Math.abs(z + 80) < 6.8 && onXing(x, 0) ? Y0 + 0.45 : surfaceY(x, z)) - 0.04);
  moving.forEach((m, i) => traffic.add(fleet.cars[parked.length + i], m.route, m.s));
  fleet.commit();
  // trains
  const trains = SIM ? [new Train(Y0), new Train(Y0)] : [];
  if (SIM) { trains[0].start(1, 2); trains[1].start(-1, 40); }

  flushProps(); // instanced props (core.js)
  // town geometry, props, vehicles are not reflected by the river (keeps the reflection pass cheap)
  for (const o of scene.children) if (!reflected.has(o)) o.traverse(c => c.layers.set(1));

  // ---------------------------------------------------------------- world data: object ids, the edits in world/town/edits (world/layer.js)
  stopCapture();
  const layer = await finalizeWorld({ map: opts.map || 'town', editor: !!opts.editor, progress, areaOf: townArea, materialSets: { town: MT, landmark: landmarkMaterials() } });
  // ---------------------------------------------------------------- night lighting: every fixture lights its surroundings (citylights.js)
  const cropInfo = buildCrops();
  const cityLights = buildCityLights(layer.activeLamps());
  setTownGlow(-140, -5, 330, 0.035);

  // people on the streets: sidewalks of the main road, lane shoulders, the riverside walkways and the shrine approach
  const walkPaths = [];
  for (const R of ROADS) {
    const pts = R.district ? R.pts : R.pts.map(([x, z]) => [clamp(x, -440, 440), clamp(z, -335, 335)]);
    walkPaths.push({ pts, off: R.kind === 'path' ? 1.0 : R.w / 2 + (R.walk ? R.walk / 2 : 0.55), lift: null, w: R.id === 'A' ? 3 : 1 });
  }
  for (const sd of [-1, 1]) walkPaths.push({ pts: Array.from({ length: 67 }, (_, i) => { const z = lerp(-330, 330, i / 66); return [riverX(z) + sd * 16.1, z]; }), off: 0, lift: null });
  for (const P of danchi.walkPaths) walkPaths.push(P);
  // across the station forecourt: from the main road to the ticket hall, and over the crossing to the bus berths
  walkPaths.push({ pts: [[-2.5, -30.2], [-2.5, -62.8]], off: 1.1, lift: null, w: 2 }, { pts: [[-1, -48.5], [12.7, -48.5], [12.7, -32]], off: 0.4, lift: null });
  // nobody steps onto a level crossing while its bells ring or its booms are down
  const xingClosed = (x0, z0, x1, z1) => Math.abs(z1 + 80) < 7.2 && Math.abs(z0 + 80) >= 7.2 - 1e-3 && crossings.some(c => (c.active || c.down > 0.01) && Math.abs(x1 - c.x) < c.roadW / 2 + 3);
  let crowd = null; if (SIM) try { crowd = await loadCrowd(); } catch (e) { console.warn('crowd models failed, box figures instead', e); }
  const people = !SIM ? { update() {}, collide() {} } : pedestrians(walkPaths.flatMap(P => Array(P.w || 1).fill(P)), (x, z) => world.groundAt(x, z), 300, 21, { blocked: xingClosed, crowd });
  const spawn = { x: 107.9, z: -42, yaw: 0.12, pitch: 0.04 }; // edge of road B, looking at the level crossing
  const _n = new THREE.Vector3(), _pl = { x: 0, y: 0, z: 0 };
  const PW = { lights: perf.id('world: lights'), lod: perf.id('world: building LOD'), crops: perf.id('world: crops'), props: perf.id('world: props'), people: perf.id('world: pedestrians'),
    trains: perf.id('world: trains+xings'), traffic: perf.id('world: traffic'), signs: perf.id('world: sign LOD') };
  const world = {
    hf, grass, water, spawn, trains, traffic, crossings, sakura, lots, roadNet: RN, materials: MT, terrain: terrainGroup, shrineSpots,
    bounds: { minX: -990, maxX: 990, minZ: -990, maxZ: 990 },
    groundAt(x, z) {
      const f = forecourt.heightAt(x, z); if (f !== null) return f;
      if (Math.abs(z + 80) < 6.8 && onXing(x, 0.2)) return Y0 + 0.45; // crossing deck
      const w = RN.walkY(x, z); if (w !== null) return w;
      if (RN.roadAt(x, z)) return surfaceY(x, z);
      const g = hf.groundAt(x, z); if (onBridge(x, z) && (Math.abs(z + 25) < 7 || Math.abs(z - 200) < 3.5)) return Math.max(g, Y0 + 0.35);
      const rd = Math.abs(x - riverX(z)), dz = Math.abs(z + 80);
      if (rd > 14.55 && rd < 17.65 && dz < 6.6) return Y0 + 0.447;                                                   // pedestrian level crossing
      if (rd > 14.55 && rd < 17.65 && dz < 10.6) return Math.max(g, lerp(Y0 + 0.447, Y0 + 0.12, (dz - 6.6) / 4.0)); // its ramps
      if (rd > 14.55 && rd < 17.65) for (const [bz, , id] of BRIDGES) { const E = BRIDGE_EDGE[id], d = Math.abs(z - bz); if (d >= E && d < E + 3.0) return lerp(Y0 + 0.385, Y0 + 0.12, (d - E) / 3.0); }
      if (Math.abs(z) > RIVER_END + 0.4) return g; // past the revetments: natural banks
      if (rd > 14.55 && rd < 17.65) return Math.max(g, Y0 + 0.12); // bank-top walkway
      return rd > 12.2 && rd <= 14.55 ? Math.max(g, revY(rd)) : g; // the revetment slab (the ground lies under it) and its end wall
    },
    normalAt: (x, z, out) => { const rd = x - riverX(z); if (Math.abs(rd) > 12.2 && Math.abs(rd) <= 14.55 && Math.abs(z) <= RIVER_END) { const l = Math.hypot(REV_K, 1); return out.set(-Math.sign(rd) * REV_K / l, 1 / l, 0); } return hf.normalAt(x, z, out); },
    waterAt: (x, z) => Math.abs(x - riverX(z)) < 16 ? RIVER_LV : -1e9,
    waterLevel: RIVER_LV,
    district: danchi,
    surfaceAt(x, z, y) {
      if (y !== undefined && y > Y0 + 0.9 && Math.abs(z + 80) < 8) return 'asphalt';
      if (Math.abs(z + 80) < 5.6 && y < Y0 + 0.6) return 'gravel';
      const g = hf.groundAt(x, z);
      if (Math.abs(x - riverX(z)) < 14.5) return g < RIVER_LV ? 'water' : 'gravel';
      if (inPaddyZone(x, z) && paddyOK(x, z) && paddyCell(x, z) > 1.2) return 'water';
      const m2 = hf.mask2[hf.idx(x, z) * 4 + 2], ur = hf.mask2[hf.idx(x, z) * 4];
      if (m2 > 128 || hf.paveAt(x, z) > 0.5) return 'asphalt';
      if (ur > 128) return 'gravel';
      return FOREST[hf.idx(x, z)] > 0.4 ? 'forest' : 'grass';
    },
    ambience(x, z) {
      const rd = Math.abs(x - riverX(z));
      return { forest: FOREST[hf.idx(clamp(x, -HALF, HALF), clamp(z, -HALF, HALF))], water: rd < 40 ? (1 - rd / 40) * 0.6 : 0, town: Math.abs(x) < 450 && Math.abs(z) < 330 ? 1 : 0.3, insects: 0.9 };
    },
    collide(p) { traffic.collide(p); people.collide(p);
      // the revetments are walls to anyone in the channel: no climbing the slab out of the water
      if (Math.abs(p.z) <= RIVER_END && p.y < Y0 - 0.5) { const rx = riverX(p.z), rd = p.x - rx; if (Math.abs(rd) > REV_WL - 0.2 && Math.abs(rd) < 15) p.x = rx + Math.sign(rd) * (REV_WL - 0.2); } for (const tr of trains) { const sp = tr.span(); if (!sp) continue; const tz = RAIL.z[tr.track]; if (p.x > sp[0] - 0.4 && p.x < sp[1] + 0.4 && Math.abs(p.z - tz) < 1.9 && p.y < tr.y + 3.5) p.z = tz + Math.sign(p.z - tz || 1) * 1.9; } },
    update(dt, t, cam) {
      perf.begin(PW.lights); updateNight(); updateGlow(); perf.end(PW.lights);
      perf.begin(PW.lod); updateLod(cam); perf.end(PW.lod);
      perf.begin(PW.crops); updateCrops(cam); perf.end(PW.crops);
      perf.begin(PW.props); landmarks.update(); parkBenches.update(); danchiBenches.update(); perf.end(PW.props);
      if (!SIM) { fleet.commit(cam.position, cam); cityLightU.uCLI.value = smoothstep(0.2, 0.5, night.value); return; } // editor: static scenery only
      perf.begin(PW.people); people.update(dt); perf.end(PW.people);
      const pl = _pl; pl.x = cam.position.x; pl.y = cam.position.y - 1.6; pl.z = cam.position.z;
      perf.begin(PW.trains);
      for (const tr of trains) tr.update(dt, pl);
      for (const c of crossings) c.active = crossingActive(c, trains);
      updateCrossings(dt, t); signals.update(dt);
      perf.end(PW.trains);
      perf.begin(PW.traffic);
      traffic.update(dt, pl, night.value > 0.35);
      fleet.commit(cam.position, cam);
      perf.end(PW.traffic);
      cityLightU.uCLI.value = smoothstep(0.2, 0.5, night.value); // lamps come on together at dusk
    },
  };
  // signage LOD: canvas-textured signs, plates and machine fronts are separate meshes (one texture each); they cast no
  // shadow (thin plates) and are skipped past ~190 m, where they are a few pixels — ~1700 fewer draws per pass
  const smallSigns = [];
  scene.traverse(o => { if (!o.isMesh || o.isInstancedMesh || o.parent !== scene || !o.material || !o.material.map || !o.material.map.isCanvasTexture || o.userData.keepShadow) return;
    o.geometry.computeBoundingSphere(); if (o.geometry.boundingSphere.radius > 4) return; o.castShadow = false; smallSigns.push(o); });
  let signTick = 0;
  const baseUpdate = world.update;
  world.update = (dt, t, cam) => { baseUpdate(dt, t, cam);
    perf.begin(PW.signs);
    if (signTick++ % 6 === 0) { const R = 190 * (Q.lodScale || 1), R2 = R * R, p = cam.position;
      for (const o of smallSigns) { const dx = o.position.x - p.x, dz = o.position.z - p.z; o.visible = dx * dx + dz * dz < R2; } }
    perf.end(PW.signs); };
  people.update(0);
  world.cityLights = Object.assign(cityLights, { materials: enableCityLights(scene) });
  world.layer = layer; layer.attach(world);
  world.people = people;
  return world;
}
