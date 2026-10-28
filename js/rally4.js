// Stage 04: a race on an ordinary country road. Four and a half kilometres of two-lane asphalt (7 m, edge lines and a
// dashed centre line) across a broad valley: long straights joined by fast sweepers, a few tighter bends, the road
// graded smoothly over the rolling ground with guardrails where it runs on an embankment. The player starts on the
// second row against three rivals (race.js); the first over the line wins. Car, timing and the road builder are shared
// with the special stages.
import { buildStage } from './rally.js';
import { erosion, fbm, smoothstep } from './core.js';

export const meta = {
  name: 'Valley Run',
  builder: false,
  startHour: 15.9,
  sunAzimuth: 2.3,
  life: { flowers: false, birds: true, fireflies: 0, mist: 0.25 },
  vehicle: true,
  car: 'f40',
};

// the valley: rolling farmland and woods over a gentle fall to the east, hills along both sides, mountains far off
function land(x, z) {
  const e = erosion(x * 0.0011 + 4.4, z * 0.0011 - 2.2, 6), r = fbm(x * 0.006 - 1.7, z * 0.006 + 3.9, 4);
  let h = 60 - x * 0.012 + 26 * e + 5 * r;
  h += 40 * smoothstep(700, 1350, Math.abs(x * 0.6 - z * 0.8 + 120)); // (the valley's sides)
  const d = Math.hypot(x, z), far = smoothstep(1500, 3800, d);
  if (far > 0) { const rr = erosion(x * 0.00038 + 6.1, z * 0.00038 - 0.4, 6) * 0.5 + 0.5; h += far * (80 + rr * rr * 1300 + e * 120); }
  return h;
}

export const VALLEY_STAGE = {
  id: 'valley', name: 'Valley Run', target: 4300, roadType: 'asphalt', seed: 9137, half: 3.5, lanes: 2, world: 3072,
  bestKey: 'wl_race_valley_best_v2', forestMin: 0.08, forestSeed: 311, floorSeed: 97, verge: 'cut', land, grade: 150, rails: true, pilot: false, splits: 1000,
  eco: { alpine: [200, 320], lowland: [0, 90], step: 6, logs: 120, twigs: 1500, shrubs: 2600, woods: 0.38 }, stony: 0.12, forestNear: 9,
  paint: { gDeep: '#3d5a2f', gLush: '#5d7338', gLight: '#a8a865', gDry: '#c2ad6c', forest: '#3e4630', canopy: '#2b3d2c', rockL: '#b3ab9d', rockD: '#635d55' },
  way: [[-1240, -1180], [-1010, -1150], [-820, -1010], [-640, -1060], [-430, -930], [-330, -700], [-120, -620], [80, -690], [300, -560], [380, -330], [560, -210], [790, -260], [980, -120], [1030, 120], [1180, 290], [1220, 560], [1080, 760], [1150, 1000], [1260, 1150]],
  jumps: [], features: [],
};

export async function build(progress, opts) { return buildStage(progress, VALLEY_STAGE, opts); }
