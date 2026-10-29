// Stage 04: a race on an ordinary country road. Four and a half kilometres of two-lane asphalt (7 m, edge lines and a
// dashed centre line) across a broad valley: long straights joined by fast sweepers, a few tighter bends, the road
// graded smoothly over the rolling ground with guardrails where it runs on an embankment. The player starts on the
// second row against three rivals (race.js); the first over the line wins. Car, timing and the road builder are shared
// with the special stages.
import { buildStage } from './rally.js';
import { VALLEY_STAGE } from './stages/valley.js';
export { VALLEY_STAGE };

export const meta = {
  name: 'Valley Run',
  builder: false,
  startHour: 15.9,
  sunAzimuth: 2.3,
  life: { flowers: false, birds: true, fireflies: 0, mist: 0.25 },
  vehicle: true,
  car: 'f40',
};

export async function build(progress, opts) { return buildStage(progress, VALLEY_STAGE, opts); }
