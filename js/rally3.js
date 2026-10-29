// Stage 03: a narrow asphalt road built high on the face of a mountain. The face climbs north at about 30° above a deep
// valley, ribbed with spurs and gullies; a rock band towers over the last traverse, the valley wall falls away just
// below the first one, and between them the road climbs a ladder of five hairpins. Across the valley and all round
// stand higher, snow-capped peaks. Timing, car, co-driver and the road builder are shared with the other stages.
import { buildStage } from './rally.js';
import { HILL_STAGE } from './stages/hillcrest.js';
export { HILL_STAGE };

export const meta = {
  name: 'Hill Crest',
  builder: false,
  startHour: 9.1,
  sunAzimuth: 2.45,
  life: { flowers: false, birds: true, fireflies: 0, mist: 0.5 },
  vehicle: true,
};

export async function build(progress, opts) { return buildStage(progress, HILL_STAGE, opts); }
