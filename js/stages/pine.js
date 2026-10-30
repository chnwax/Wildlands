// Stage 04 · Pine Forest: a gravel road over the crests and dips of a dark northern forest. The stage's config — its
// route, ground, surface and dressing — read by the stage builder (rally.js), the board's preview and the preparation
// worker (prep.worker.js): no engine here, only the shape of the place.
import { erosion, fbm, smoothstep } from '../noise.js';

// the forest's ground: a low, rolling moraine country (the road rides its crests and dips), granite breaking out of it
function pineLand(x, z) {
  const e = erosion(x * 0.0029 + 1.4, z * 0.0029 - 3.8, 5), cr = 1 - Math.abs(fbm(x * 0.009 + 6.1, z * 0.009 - 2.7, 4));
  return 24 + z * 0.025 + Math.sin(x * 0.005) * 4.5 + Math.sin(z * 0.007 + 0.8) * 3.5 + Math.sin((x + z) * 0.01) * 2 + 6.5 * e + 5 * smoothstep(0.78, 0.95, cr);
}

export const PINE_STAGE = {
  id: 'pine', name: 'Pine Forest', target: 1500, roadType: 'gravel', seed: 4471, half: 2.5, // (a forest road two cars wide: room to race side by side)
  bestKey: 'wl_rally_pine_best_v3', forestMin: 0.86, forestSeed: 99, floorSeed: 5, forestNear: 2.6, stony: 0.22, land: pineLand, grade: 30, roadTint: [0.78, 0.74, 0.68],
  // (a northern wood: dark spruce, needle litter and moss up to the ditches, grey granite, the grass short and dull)
  paint: { gDeep: '#2e452b', gLush: '#47592f', gLight: '#878a51', gDry: '#9f915b', forest: '#3f3b27', canopy: '#25362a', rockL: '#a5a197', rockD: '#5a5753' },
  way: [[-355, -360], [-365, -300], [-340, -245], [-360, -185], [-335, -125], [-300, -70], [-280, -5], [-230, 55], [-170, 82], [-120, 62], [-100, 112], [-62, 78], [-18, 112], [35, 102], [82, 62], [118, 20], [168, -5], [225, -18], [272, -58], [294, -118], [310, -190], [350, -255], [382, -325]],
  jumps: [{ f: 0.31, h: 0.8, text: 'Przez szczyt' }, { f: 0.72, h: 1.05, text: 'Mały skok' }],
  features: [{ f: 0.49, text: 'Mocna kompresja' }],
};
