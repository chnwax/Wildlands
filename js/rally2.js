// Stage 02: a paved pass over dry limestone uplands in the south: rolling ridges and ravines eroded out of pale rock, thin
// sunburnt grass between broken stone, scattered pines, and low dry-stone walls along the drops as the old mountain
// roads have them. The vehicle, timing, co-driver and the road builder are shared with the other stages.
import { buildStage } from './rally.js';
import { ALPINE_STAGE } from './stages/alpine.js';
export { ALPINE_STAGE };

export const meta = {
  name: 'Alpine Pass',
  builder: false,
  startHour: 16.4,
  sunAzimuth: 2.55,
  life: { flowers: false, birds: true, fireflies: 0.1, mist: 0.15 },
  vehicle: true,
};

export async function build(progress, opts) { return buildStage(progress, ALPINE_STAGE, opts); }
