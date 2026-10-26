// Stage 03: a narrow asphalt hill stage. Timing, car, co-driver, Wildlands pack trees and roadside furniture are
// shared with the other rally stages; this route adds a sustained climb, repeated switchbacks and rolling crests.
import { buildStage } from './rally.js';

export const meta = {
  name: 'Hill Crest',
  builder: false,
  startHour: 14.8,
  sunAzimuth: 2.05,
  life: { flowers: true, birds: true, fireflies: 0.05, mist: 0 },
  vehicle: true,
};

export const HILL_STAGE = {
  id: 'hillcrest', name: 'Hill Crest', target: 1800, roadType: 'asphalt', profile: 'hills', seed: 6317,
  bestKey: 'wl_rally_hillcrest_best_v1', forestMin: 0.6, forestSeed: 271, floorSeed: 83,
  way: [[-350, -390], [-330, -340], [-120, -300], [-290, -245], [-70, -185], [-265, -125], [-35, -65], [-225, -5], [5, 55], [-175, 115], [65, 175], [125, 225], [105, 285], [160, 345]],
  jumps: [{ f: 0.36, h: 0.55, text: 'Przez szczyt' }, { f: 0.71, h: 0.7, text: 'Mały skok' }],
  features: [{ f: 0.18, text: 'Pod górę' }, { f: 0.52, text: 'Ślepy szczyt' }, { f: 0.61, text: 'Uwaga spadanie' }, { f: 0.84, text: 'Mocna kompresja' }],
};

export async function build(progress) { return buildStage(progress, HILL_STAGE); }
