// Stage 03 · Alpine Pass: the stage's config (route, ground, surface, dressing) for the stage builder (rally.js), the board's
// preview and the preparation worker (prep.worker.js).
import { erosion, fbm, smoothstep } from '../noise.js';

// the towers of the pass: monumental limestone pillars standing over the road, two of them a gate the road threads
// between (sites placed beside the stage's line, their feet some ten metres off its edge: [x, z, radius, height])
const TOWERS = [[-477, -277, 22, 48], [-386, -135, 26, 62], [-398, 34, 18, 40], [-233, 146, 16, 55], [-257, 95, 15, 50], [-190, -49, 24, 70], [-55, -63, 20, 46], [128, -46, 28, 66], [137, 161, 22, 52], [261, 135, 18, 44]];
function towers(x, z) { let h = 0;
  for (const [cx, cz, r, H] of TOWERS) { const dx = x - cx, dz = z - cz; if (dx * dx + dz * dz > (r + 16) ** 2) continue;
    const n = fbm(x * 0.045 + cx, z * 0.045 - cz, 3), d = Math.hypot(dx, dz) + 5 * n;
    // (sheer walls, broken into ledges; a rounded, weathered top; scree heaped at the foot)
    const body = 1 - smoothstep(r * 0.72, r * 1.04, d), t = H * (0.82 + 0.18 * fbm(x * 0.02 - cz, z * 0.02 + cx, 2)) * body;
    h = Math.max(h, t - 2.2 * Math.abs(Math.sin(t * 0.32)) * body + 0.16 * H * (1 - smoothstep(r * 0.9, r + 12, d))); }
  return h; }
// the uplands: ridges and ravines (eroded noise) rising gently north, and the higher ranges further out
function land(x, z) {
  const e = erosion(x * 0.0021 - 5.2, z * 0.0021 + 2.6, 6), r = fbm(x * 0.012 + 3.3, z * 0.012 - 6.1, 4);
  let h = 90 + z * 0.05 + 62 * e + 9 * r + 14 * Math.sin(x * 0.0061 + z * 0.0023 + 0.9);
  const cr = 1 - Math.abs(fbm(x * 0.0071 - 2.2, z * 0.0071 + 4.4, 4)); h += 13 * smoothstep(0.8, 0.95, cr); // (limestone crags breaking out of the slopes)
  h += towers(x, z);
  const d = Math.hypot(x, z), far = smoothstep(700, 2400, d);
  if (far > 0) { const rr = erosion(x * 0.00045 + 4.7, z * 0.00045 - 1.9, 6) * 0.5 + 0.5; h += far * (90 + rr * rr * 1100 + e * 120); }
  return h;
}

export const ALPINE_STAGE = {
  id: 'alpine', name: 'Alpine Pass', target: 1600, roadType: 'asphalt', seed: 8297, half: 3.0, lanes: 2,
  bestKey: 'wl_rally_alpine_best_v4', forestMin: 0.12, forestSeed: 173, floorSeed: 41, verge: 'cut', land, grade: 130, walls: true,
  stony: 0.75, stoneGround: [1.0, 1.2, 1.45], // (the warm photo rock lifted to pale limestone)
  eco: { alpine: [40, 110], lowland: [0, 20], step: 6.2, logs: 60, twigs: 900, shrubs: 2600, woods: 0.42, broad: 0.35, boulders: 14000 },
  paint: { gDeep: '#5c5e36', gLush: '#7a7746', gLight: '#c2b476', gDry: '#cfb67e', forest: '#4f4a34', canopy: '#34412f', rockL: '#cdc4b2', rockD: '#7a7164', sand: '#d1c29e', sandWet: '#9a8a6c' },
  way: [[-350, -365], [-330, -300], [-360, -235], [-322, -168], [-350, -92], [-318, -18], [-272, 62], [-218, 112], [-168, 68], [-142, -5], [-92, -62], [-40, -82], [8, -42], [55, -52], [92, 8], [112, 84], [162, 137], [225, 130], [286, 88]],
  jumps: [{ f: 0.24, h: 0.65, text: 'Przez szczyt' }, { f: 0.78, h: 0.75, text: 'Mały skok' }],
  features: [{ f: 0.43, text: 'Ślepy szczyt' }, { f: 0.61, text: 'Mocna kompresja' }],
};
