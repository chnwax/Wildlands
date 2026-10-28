// Stage 03: a narrow asphalt mountain stage cut into a snowy slope. Timing, car, co-driver and the route generator are
// shared with the other stages; this one keeps the hillside open, follows contour-line switchbacks and guards the drop.
import { buildStage } from './rally.js';

export const meta = {
  name: 'Hill Crest',
  builder: false,
  startHour: 10.2,
  sunAzimuth: 2.05,
  life: { flowers: false, birds: true, fireflies: 0, mist: 0.35 },
  vehicle: true,
};

export const HILL_STAGE = {
  id: 'hillcrest', name: 'Hill Crest', target: 1800, roadType: 'asphalt', profile: 'mountain', snowLine: 62, seed: 6317,
  bestKey: 'wl_rally_hillcrest_best_v1', forestMin: 0, forestSeed: 271, floorSeed: 83,
  way: [[-350, -390], [-330, -340], [-120, -300], [-290, -245], [-70, -185], [-265, -125], [-35, -65], [-225, -5], [5, 55], [-175, 115], [65, 175], [125, 225], [105, 285], [160, 345]],
  jumps: [{ f: 0.36, h: 0.55, text: 'Przez szczyt' }, { f: 0.71, h: 0.7, text: 'Mały skok' }],
  features: [{ f: 0.18, text: 'Pod górę' }, { f: 0.52, text: 'Ślepy szczyt' }, { f: 0.61, text: 'Uwaga spadanie' }, { f: 0.84, text: 'Mocna kompresja' }],
};

export async function build(progress) { return buildStage(progress, HILL_STAGE); }
