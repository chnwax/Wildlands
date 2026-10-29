// Stage 01 · Valley Run: the stage's config (route, ground, surface, dressing) for the stage builder (rally.js), the board's
// preview and the preparation worker (prep.worker.js).
import { erosion, fbm, smoothstep, lerp } from '../noise.js';

// the lake in the valley floor, the road running along its northern shore for half a kilometre (placed by its fit
// beside the road: the shore 25 m off at its nearest, the level under the lowest ground elsewhere)
export const VALLEY_LAKE = { x: 638, z: -26, a: 300, b: 165, rot: -0.176, level: 40 };
const lakeF = (x, z) => { const L = VALLEY_LAKE, dx = x - L.x, dz = z - L.z, c = Math.cos(L.rot), s = Math.sin(L.rot); return Math.hypot((dx * c + dz * s) / L.a, (-dx * s + dz * c) / L.b) + 0.1 * fbm(x * 0.008 + 3.3, z * 0.008 - 1.1, 3); };
// the valley: rolling farmland and woods over a gentle fall to the east, hills along both sides, mountains far off
function land(x, z) {
  const e = erosion(x * 0.0011 + 4.4, z * 0.0011 - 2.2, 6), r = fbm(x * 0.006 - 1.7, z * 0.006 + 3.9, 4);
  let h = 60 - x * 0.012 + 26 * e + 5 * r;
  h += 40 * smoothstep(700, 1350, Math.abs(x * 0.6 - z * 0.8 + 120)); // (the valley's sides)
  // (the lake: its bed deepening to some ten metres, its banks easing up over the next hundred; no water anywhere else)
  const f = lakeF(x, z), lv = VALLEY_LAKE.level;
  if (f < 1.5) h = lerp(lv - 1 - 9 * (1 - smoothstep(0.1, 0.95, f)), h, smoothstep(0.92, 1.45, f));
  else h = Math.max(h, lv + 1.5);
  const d = Math.hypot(x, z), far = smoothstep(1500, 3800, d);
  if (far > 0) { const rr = erosion(x * 0.00038 + 6.1, z * 0.00038 - 0.4, 6) * 0.5 + 0.5; h += far * (80 + rr * rr * 1300 + e * 120); }
  return h;
}

export const VALLEY_STAGE = {
  id: 'valley', name: 'Valley Run', target: 4300, roadType: 'asphalt', seed: 9137, half: 3.5, lanes: 2, world: 3072,
  lake: { level: VALLEY_LAKE.level }, bestKey: 'wl_race_valley_best_v3', forestMin: 0.08, forestSeed: 311, floorSeed: 97, verge: 'cut', land, grade: 150, rails: true, pilot: false, splits: 1000,
  eco: { alpine: [200, 320], lowland: [0, 90], step: 6, logs: 120, twigs: 1500, shrubs: 2600, woods: 0.38 }, stony: 0.12, forestNear: 9,
  paint: { gDeep: '#3d5a2f', gLush: '#5d7338', gLight: '#a8a865', gDry: '#c2ad6c', forest: '#3e4630', canopy: '#2b3d2c', rockL: '#b3ab9d', rockD: '#635d55' },
  way: [[-1240, -1180], [-1010, -1150], [-820, -1010], [-640, -1060], [-430, -930], [-330, -700], [-120, -620], [80, -690], [300, -560], [380, -330], [560, -210], [790, -260], [980, -120], [1030, 120], [1180, 290], [1220, 560], [1080, 760], [1150, 1000], [1260, 1150]],
  jumps: [], features: [],
};
