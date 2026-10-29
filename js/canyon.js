// Stage 05: Canyon Ridge — a long asphalt race through red-rock canyon country (js/stages/canyon.js has the place: the
// plateau, the canyon, the route). Timing, the cars, the rivals and the road builder are shared with every other stage.
import { buildStage } from './rally.js';
import { CANYON_STAGE } from './stages/canyon.js';
export { CANYON_STAGE };

export const meta = {
  name: 'Canyon Ridge',
  builder: false,
  startHour: 17.1,
  sunAzimuth: 2.9,
  life: { flowers: false, birds: true, fireflies: 0, mist: 0.05 },
  vehicle: true,
  car: 'f40',
};

export async function build(progress, opts) { return buildStage(progress, CANYON_STAGE, opts); }
