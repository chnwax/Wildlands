// Stage 06: Coastal Highway — a long asphalt race cut into the cliffs over the sea (js/stages/coastal.js has the place:
// the coast, the inlet, the headland, the route). Timing, the cars, the rivals and the road builder are shared with every
// other stage; the sea is the town's water (terrain.js buildWater).
import { buildStage } from './rally.js';
import { COASTAL_STAGE } from './stages/coastal.js';
export { COASTAL_STAGE };

export const meta = {
  name: 'Coastal Highway',
  builder: false,
  startHour: 11.2,
  sunAzimuth: 1.4,
  life: { flowers: false, birds: true, fireflies: 0, mist: 0.12 },
  vehicle: true,
  car: 'f40',
};

export async function build(progress, opts) { return buildStage(progress, COASTAL_STAGE, opts); }
