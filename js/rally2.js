// Stage 02: a short paved alpine pass. The vehicle, timing, co-driver and stage furniture are shared with Pine Forest;
// only the route, vertical profile, surface and ecology change here.
import { buildStage } from './rally.js';

export const meta = {
  name: 'Alpine Pass',
  builder: false,
  startHour: 16.1,
  sunAzimuth: 2.55,
  life: { flowers: true, birds: true, fireflies: 0.1, mist: 0 },
  vehicle: true,
};

export const ALPINE_STAGE = {
  id: 'alpine', name: 'Alpine Pass', target: 1600, roadType: 'asphalt', seed: 8297,
  bestKey: 'wl_rally_alpine_best_v1', forestMin: 0.43, forestSeed: 173, floorSeed: 41,
  way: [[-350, -365], [-330, -300], [-360, -235], [-322, -168], [-350, -92], [-318, -18], [-272, 62], [-218, 112], [-168, 68], [-142, -5], [-92, -62], [-40, -82], [8, -42], [55, -52], [92, 8], [112, 84], [162, 137], [225, 130], [286, 88]],
  jumps: [{ f: 0.24, h: 0.65, text: 'Przez szczyt' }, { f: 0.78, h: 0.75, text: 'Mały skok' }],
  features: [{ f: 0.43, text: 'Ślepy szczyt' }, { f: 0.61, text: 'Mocna kompresja' }],
};

export async function build(progress) { return buildStage(progress, ALPINE_STAGE); }
