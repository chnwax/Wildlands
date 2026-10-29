// Stage 06 · Coastal Highway: a road cut into the cliffs of a mountainous coast, high over the sea. The coast runs north
// and south in headlands and bays; the cliffs fall sheer to the water, rock and surf at their feet; behind them the
// mountains climb steep and bare. The road keeps to the cliff tops — long arcs round the bays, tight bends where it
// rounds a cove — loops deep inland round a narrow inlet, passes under two rock galleries where the mountain stands
// over it, and goes through the rock of a headland in a tunnel. The stage's config for the stage builder (rally.js), the
// board's preview and the preparation worker (prep.worker.js).
import { erosion, fbm, smoothstep, clamp } from '../noise.js';

// the coastline (x of the shore at z), the inlet and the headland
export const coastX = z => -380 + 130 * Math.sin(z * 0.0019 + 0.6) + 60 * Math.sin(z * 0.0053 + 2.2) + 22 * Math.sin(z * 0.013 + 0.4);
const INLET_Z = -330, INLET_LEN = 470, HEAD_Z = 560;
const cliffTop = (z, e) => 92 + 38 * Math.sin(z * 0.0021 + 2.0) + 18 * e;
const COVES = [[110, 70], [1040, 80]];
// how far in from the shore the road keeps along the cliff tops (a few dozen metres from the edge, the drop in view), and
// where the mountain stands over it in a crag, the road passing under a rock gallery
const offN = z => 50 + 12 * Math.sin(z * 0.009), offS = z => 58 + 16 * Math.sin(z * 0.006 + 1) + 64 * (Math.exp(-(((z - 110) / 90) ** 2)) + Math.exp(-(((z - 1040) / 100) ** 2)));
const GALLERY_Z = [-930, 760], roadOff = z => z < -300 ? offN(z) : offS(z);
// how far inland a point is from the water: from the open coast, and from the inlet's shores
// (a soft minimum: where the open coast's distance and the inlet's meet, the ground has no crease)
const smin = (a, b, k) => Math.min(a, b) - k * Math.log1p(Math.exp(-Math.abs(a - b) / k));
function shoreDist(x, z) {
  const s = x - coastX(z);
  // (the inlet: its half width narrows to its head; past the head the distance is round it)
  const iz = INLET_Z + 26 * Math.sin(x * 0.011 + 1.0), dz = z - iz;
  const inlet = s < INLET_LEN ? Math.abs(dz) - 92 * Math.pow(clamp(1 - s / INLET_LEN, 0, 1), 0.6) : Math.hypot(s - INLET_LEN, dz);
  return smin(s, inlet, 24);
}
function land(x, z) {
  const n = fbm(x * 0.006 + 2.1, z * 0.006 - 1.3, 4), e = erosion(x * 0.0019 - 4.4, z * 0.0019 + 1.7, 6), sd = shoreDist(x, z) + 8 * n;
  if (sd < 0) return Math.max(-46, -5 + sd * 0.07 + 3 * n); // (the sea floor, deepening offshore)
  const top = cliffTop(z, e);
  let cove = 0; for (const [cz, w] of COVES) cove = Math.max(cove, Math.exp(-(((z - cz) / w) ** 2))); cove *= 1 - smoothstep(50, 135, sd); // (the coves only down at the shore: the road passes above them)
  // the cliff: sheer from the water to its top in some 30 m, broken rock at its foot; behind it the slope climbs on
  const cliff = top * (0.12 * smoothstep(0, 6, sd) + 0.88 * smoothstep(5, 34, sd)) + Math.max(0, sd - 34) * (0.18 + 0.08 * n);
  const beach = 1.5 * smoothstep(0, 40, sd) + Math.max(0, sd - 40) * 0.45;
  let h = cliff * (1 - cove) + beach * cove;
  // (the crags over the galleries: the hillside behind the road rising sheer for some 25 m)
  for (const gz of GALLERY_Z) { const k = Math.exp(-(((z - gz) / 62) ** 2)); if (k > 0.01) h += k * 26 * smoothstep(roadOff(gz) + 5, roadOff(gz) + 14, sd); }
  // the mountains behind: steep and bare, ribbed with gullies
  h += smoothstep(430, 1700, sd) * (420 + 260 * e) + 18 * e * smoothstep(80, 300, sd);
  // the headland the road tunnels through: a dome of rock standing over the coast
  // (a ridge running down from the mountains to the sea, its crest broken)
  const hd = Math.hypot((x - coastX(HEAD_Z) - 170) * 0.55, z - HEAD_Z + 18 * Math.sin(x * 0.012)) + 26 * fbm(x * 0.013 - 3.3, z * 0.013 + 0.8, 3); h += 135 * (1 - smoothstep(40, 150, hd));
  // far off: the coast's ranges fading out
  const r = Math.hypot(x - 600, z), far = smoothstep(1700, 3600, r);
  if (far > 0) h += far * (100 + 700 * (e * 0.5 + 0.5) ** 2) * smoothstep(-200, 200, x);
  return h;
}

// the route: south along the cliff tops, round the inlet, over the coves, through the headland
function route() {
  const pts = [], at = (z, off) => [coastX(z) + off, z];
  for (let z = -1310; z <= -560; z += 75) pts.push(at(z, offN(z)));
  // (round the inlet: in along its north shore, round its head, out along its south shore)
  const iz = INLET_Z, inX = s => coastX(iz) + s;
  for (const [s, dz] of [[120, -170], [200, -150], [300, -146], [400, -144], [490, -128], [560, -70], [585, 0], [560, 72], [490, 128], [400, 146], [300, 150], [200, 158], [124, 182]]) pts.push([inX(s), iz + dz]);
  for (let z = -60; z <= 1110; z += 72) pts.push(at(z, offS(z))); // (wide round the coves' heads)
  // (and up the mountain to the finish on a col: three legs across the slope and two hairpins between them)
  for (const [z, off] of [[1175, 140], [1225, 190], [1250, 240], [1150, 268], [1030, 296], [920, 322], [872, 342], [880, 366], [940, 380], [1060, 410], [1180, 440], [1262, 464], [1268, 492], [1220, 508], [1110, 528], [1010, 546]]) pts.push(at(z, off));
  return pts;
}

export const COASTAL_STAGE = {
  id: 'coastal', name: 'Coastal Highway', target: 4800, roadType: 'asphalt', seed: 7719, half: 3.4, lanes: 2, world: 3072,
  bestKey: 'wl_race_coastal_best_v1', forestMin: 0, forestSeed: 557, floorSeed: 199, verge: 'cut', land, grade: 150, rails: true, walls: false, pilot: true, splits: 1000, hairpin: 14,
  keepScale: true, sea: true, runoff: 220,
  tunnels: [{ at: [coastX(HEAD_Z) + 100, HEAD_Z], len: 250 }],
  galleries: GALLERY_Z.map((z, k) => ({ at: [coastX(z) + roadOff(z), z], len: k ? 80 : 90, side: -1 })),
  // (a Mediterranean coast: pines and holm oaks in the gullies, maquis on the slopes, bare rock on the cliffs)
  eco: { alpine: [260, 480], lowland: [0, 60], step: 6.5, logs: 20, twigs: 300, shrubs: 6500, woods: 0.8, broad: 0.5, mix: { pine: 2.5, spruce: 0.05, tall: 0.2, old: 0.3 }, boulders: 16000 }, stony: 0.85, stoneGround: [1.12, 1.06, 0.96], stoneNorm: 0.3,
  paint: { gDeep: '#535d38', gLush: '#6a7044', gLight: '#aca36b', gDry: '#c6af79', forest: '#454a2f', canopy: '#2f402d', rockL: '#c9c0ad', rockD: '#6f675b', sand: '#d8c7a0', sandWet: '#9d8b6c' },
  way: route(),
  jumps: [], features: [],
};
