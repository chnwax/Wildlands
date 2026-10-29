// Stage 05 · Canyon Ridge: four and a half kilometres of asphalt through red-rock canyon country. A plateau of layered
// sandstone, mesas and buttes standing on it, is cut by a deep, meandering canyon whose walls fall in terraces of cliff
// and scree. The road runs fast along the north rim (through a cut in a butte), drops down a long scree ramp in a ladder
// of hairpins, follows the dry river on the canyon floor between towering walls, passes through a fin of rock that
// crosses the canyon in a tunnel, and climbs the far wall to finish high above the floor. The stage's config for the
// stage builder (rally.js), the board's preview and the preparation worker (prep.worker.js).
import { erosion, fbm, smoothstep, clamp } from '../noise.js';

// the canyon's axis (z of its floor at x), its floor and the plateau
export const canyonZ = x => 95 * Math.sin(x * 0.0019 + 0.7) + 42 * Math.sin(x * 0.0051 + 2.1);
const FLOOR = x => 48 + 0.006 * x, RIM = 182, FIN_X = 905, BUTTE = [-560, -235], TRIB_X = -940;
// the scree ramps the road takes down the north wall and up the south one: a straight slope from the floor's edge (40 m
// from the axis) to the rim (380 m)
const RAMP_D0 = 40, RAMP_D1 = 380;
const rampH = (x, d) => { const t = clamp((d - RAMP_D0) / (RAMP_D1 - RAMP_D0), 0, 1); return FLOOR(x) + (RIM - FLOOR(x)) * (t * t * (3 - 2 * t) * 0.25 + t * 0.75); };
function land(x, z) {
  const zc = canyonZ(x), dz = z - zc, d = Math.abs(dz), n = fbm(x * 0.0045 + 1.3, z * 0.0045 - 4.2, 4), e = erosion(x * 0.0017 + 3.1, z * 0.0017 - 0.7, 6);
  const plateau = RIM + 14 * e + 0.006 * x + 5 * n, floor = FLOOR(x) + 2.5 * n;
  // the walls: three terraces of cliff between the floor and the rim, their edges ragged
  const w = d + 22 * n + 9 * fbm(x * 0.017, z * 0.017, 3);
  const steps = 0.36 * smoothstep(38, 50, w) + 0.3 * smoothstep(92, 104, w) + 0.34 * smoothstep(150, 166, w);
  let h = floor + (plateau - floor) * steps;
  // (the ramps: scree slopes in place of the terraces, the north one between x 60 and 640, the south one past x 1060;
  // their top edges run into the plateau)
  const xr = x + 40 * fbm(z * 0.006, x * 0.002, 2); // (the ramps' sides wander: an alcove broken out of the wall, not a box)
  const north = smoothstep(-90, 130, xr) * (1 - smoothstep(600, 780, xr)) * smoothstep(-6, -30, dz), south = smoothstep(940, 1060, xr) * (1 - smoothstep(1460, 1600, xr)) * smoothstep(6, 30, dz);
  const ramp = Math.max(north, south) * (1 - smoothstep(RAMP_D1, RAMP_D1 + 120, d));
  if (ramp > 0) h = h * (1 - ramp) + Math.min(rampH(x, d) + 3 * n, plateau) * ramp;
  // mesas and buttes on the plateau: flat tops, sheer sides (none on the ramps); and the butte the rim road cuts through
  const m = fbm(x * 0.0021 - 7.7, z * 0.0021 + 1.9, 4) + 0.25 * fbm(x * 0.009, z * 0.009, 2);
  h += smoothstep(175, 230, d) * (1 - ramp) * (42 * smoothstep(0.34, 0.4, m) + 30 * smoothstep(0.52, 0.56, m));
  const bd = Math.hypot(x - BUTTE[0], (z - BUTTE[1]) * 1.4) + 10 * n; h += 34 * (1 - smoothstep(58, 70, bd)) + 10 * (1 - smoothstep(30, 40, bd));
  // a side canyon running into the main one from the north, the rim road looping round its head
  { const tz = z - (canyonZ(TRIB_X) - 120), tx = x - TRIB_X - 22 * Math.sin(tz * 0.012), along = -tz / 360, dw = Math.abs(tx) + 12 * n, depth = (1 - smoothstep(0.72, 1, along)) * smoothstep(-0.15, 0.05, along);
    if (depth > 0) { const wall = 0.45 * smoothstep(18, 28, dw) + 0.55 * smoothstep(46, 64, dw); h -= (h - floor) * 0.85 * (1 - wall) * depth; } }
  // the fin: a wall of rock across the canyon, the road through it in a tunnel
  h += 105 * Math.exp(-(((x - FIN_X) / (26 + 6 * n)) ** 2)) * (1 - smoothstep(130, 230, d));
  // far off: higher tablelands and mountains on the horizon
  const r = Math.hypot(x, z), far = smoothstep(1500, 3600, r);
  if (far > 0) { const rr = erosion(x * 0.0004 + 2.4, z * 0.0004 - 5.1, 6) * 0.5 + 0.5; h += far * (60 + rr * rr * 900 + e * 90); }
  return h;
}

// the route: along the north rim, the hairpin ladder down the ramp, the floor through the fin, up the south wall
function route() {
  const pts = [], at = (x, d) => [x, canyonZ(x) + d];
  pts.push(at(-1220, -236), at(-1130, -244));
  // (round the head of the side canyon: in along its west rim, across its head, out along its east rim)
  for (const [x, d] of [[-1070, -280], [-1052, -360], [-1046, -440], [-1018, -520], [-940, -560], [-862, -522], [-834, -440], [-828, -360], [-810, -282], [-740, -240]]) pts.push(at(x, d));
  for (let x = -660; x <= -260; x += 100) pts.push(at(x, -232 - 26 * Math.sin(x * 0.0047 + 1.2) - 14 * Math.sin(x * 0.012)));
  // (away from the edge toward the ramp's top)
  pts.push(at(-150, -262), at(-40, -318), at(50, -366));
  // (down the ramp: four legs across it, each falling some 25-30 m, turned at hairpins: long legs, so the road keeps to
  // the grade a road can have)
  const leg = (x0, x1, d0, d1, k = 4, side = -1) => { for (let i = 1; i <= k; i++) { const t = i / k; pts.push(at(x0 + (x1 - x0) * t, side * (d0 + (d1 - d0) * t))); } };
  leg(50, 560, 366, 300, 5); leg(560, 110, 266, 196, 5); leg(110, 560, 162, 92, 5); leg(560, 700, 58, 6, 3);
  // (the floor: past the fin, the river beside the road)
  for (let x = 720; x <= 1100; x += 66) pts.push(at(x, 4 * Math.sin(x * 0.02)));
  // (up the south wall: east across the ramp, a hairpin, back west to finish some 60 m over the floor; each leg climbs
  // no more than a road can, the ramp being as steep as it is)
  leg(1100, 1425, 16, 72, 5, 1); leg(1425, 1180, 106, 162, 4, 1);
  return pts;
}

export const CANYON_STAGE = {
  id: 'canyon', name: 'Canyon Ridge', target: 4400, roadType: 'asphalt', seed: 5521, half: 3.4, lanes: 2, world: 3072,
  bestKey: 'wl_race_canyon_best_v1', forestMin: 0, forestSeed: 433, floorSeed: 151, verge: 'cut', land, grade: 150, rails: true, pilot: true, splits: 1000, hairpin: 16,
  keepScale: true, tunnels: [{ at: [FIN_X, canyonZ(FIN_X)], len: 110 }], cuts: [{ at: [BUTTE[0], canyonZ(BUTTE[0]) + BUTTE[1] + 230], len: 150 }], runoff: 170, // (the route keeps its place on the land; the tunnel where it passes the fin)
  // (a dry country: junipers and pines in the hollows, scrub, bare rock)
  // (junipers and pinyon pines only, no broadleaf in this country; scree and boulders all down the slopes under the cliffs)
  eco: { alpine: [150, 300], lowland: [0, 40], step: 7, logs: 20, twigs: 200, shrubs: 2600, woods: 0.6, broad: 0, mix: { pine: 3, old: 0.25, spruce: 0.15, tall: 0, young: 0.5 }, boulders: 22000 }, stony: 0.95, stoneGround: [1.18, 0.95, 0.8], stoneNorm: 0.35,
  // (dusty: the red of the rock weathered and dulled, the grass bleached straw)
  paint: { gDeep: '#5c4a35', gLush: '#6f5e40', gLight: '#a38866', gDry: '#b19470', forest: '#4c4232', canopy: '#384431', rockL: '#b47f60', rockD: '#6a4232', sand: '#bb9675', sandWet: '#87654c' },
  way: route(),
  jumps: [], features: [],
};
