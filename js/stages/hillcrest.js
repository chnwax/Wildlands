// Stage 02 · Hill Crest: the stage's config (route, ground, surface, dressing) for the stage builder (rally.js), the board's
// preview and the preparation worker (prep.worker.js).
import { erosion, fbm, smoothstep } from '../noise.js';

const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const smax = (a, b, k) => -smin(-a, -b, k);
// the massif (z north, metres): the face, the valley under it and the far side, the relief over all of it
function land(x, z) {
  const wz = z + 16 * Math.sin(x * 0.0047 + 0.6) + 7 * Math.sin(x * 0.013 + 2.0), vz = z + 5 * Math.sin(x * 0.011 + 1.3); // (the contours wander; the valley's edge less so)
  const e = erosion(x * 0.0024 + 3.1, z * 0.0024 - 1.7, 6), r = fbm(x * 0.011 + 7.7, z * 0.011 - 2.3, 4);
  let h = 260 + 0.58 * (wz + 360);                                    // the face the road climbs
  h = smin(h, 243.8 + 1.3 * (vz + 388), 18);                            // the valley wall, its edge just below the first traverse
  h = smax(h, 34 + 0.9 * Math.max(0, -640 - wz) + 6 * Math.sin(x * 0.004), 40); // the valley floor and the far side rising
  // rock bands above the road: broken, rising and falling along the face, higher in places, gone in others
  const bw = fbm(x * 0.0045 + 1.9, 3.3, 3), bh = 0.55 + 0.75 * fbm(x * 0.006 - 4.1, 8.2, 3);
  h += Math.max(0, bh) * (30 * smoothstep(-216, -198, wz + 4 * r + 14 * bw) + 46 * smoothstep(-128, -104, wz + 6 * r + 22 * bw)) + (0.7 + 0.5 * bw) * 70 * smoothstep(0, 34, wz + 8 * r + 30 * bw);
  // crags: rock ribs and towers standing out of the slopes (a ridged noise, its crests steep)
  const cr = 1 - Math.abs(fbm(x * 0.0062 + 5.3, z * 0.0062 - 0.7, 4));
  h += 15 * smoothstep(0.8, 0.95, cr) * smoothstep(-760, -420, wz);
  const ribs = smoothstep(-700, -380, wz);                             // spurs and gullies on the slopes, ribs of rock
  h += (24 * e + 7 * r) * ribs + 10 * e * (1 - ribs);
  // all round, further out: the higher range, snow on its peaks (as nature.js lays its far mountains)
  const d = Math.hypot(x + 60, z + 120), far = smoothstep(800, 2600, d);
  if (far > 0) { const rr = erosion(x * 0.00042 + 2.1, z * 0.00042 - 7.3, 6) * 0.5 + 0.5; h += far * (120 + rr * rr * 1500 + e * 140); }
  return h;
}

// the route: a traverse along the top of the valley wall, then a ladder of five legs across the face joined by four
// hairpins (true half circles of ~11 m: a hairpin built on a landing, not a corner turned on a point), then a last
// traverse under the rock band to the col
function route() {
  const R = 14.5, pts = [[-620, -402], [-540, -398], [-470, -404], [-405, -397]], xa = -360, xb = -120;
  let z = -392, dir = 1;
  for (let k = 0; k < 5; k++) {
    const x0 = dir > 0 ? xa : xb, x1 = dir > 0 ? xb : xa, rise = 6, b = k % 2 ? 4 : -5; // (each leg with a gentle double bend)
    pts.push([x0 + (x1 - x0) * 0.33, z + rise * 0.33 + b], [x0 + (x1 - x0) * 0.66, z + rise * 0.66 - b * 0.8], [x1, z + rise]); z += rise;
    if (k < 4) { for (let a = 1; a < 12; a++) { const t = -Math.PI / 2 + a / 12 * Math.PI; pts.push([x1 + dir * R * Math.cos(t), z + R + R * Math.sin(t)]); } z += 2 * R; dir = -dir; }
  }
  return pts.concat([[-40, z + 3], [60, z + 14], [140, z + 6], [215, z + 18], [290, z + 12]]);
}

export const HILL_STAGE = {
  id: 'hillcrest', name: 'Hill Crest', target: 1800, roadType: 'asphalt', profile: 'mountain', snowLine: 760, seed: 6317, half: 2.9, lanes: 2,
  bestKey: 'wl_rally_hillcrest_best_v3', forestMin: 0, forestSeed: 271, floorSeed: 83, hairpin: 13.5, land,
  // (the trees: spruce and larch in stands on the gentler ground, thinning out to dwarf pine on the rock above)
  eco: { alpine: [330, 520], lowland: [0, 120], snow: 700, step: 5.6, logs: 40, twigs: 400, shrubs: 520, woods: 0.5 }, stony: 0.7, stoneGround: [0.76, 0.96, 1.3], stoneNorm: 0.24, // (the photo rock is warm sandstone: greyed to the massif's limestone)
  paint: { gDeep: '#4f5a35', gLush: '#68713f', gLight: '#a6a06a', gDry: '#b8a571', forest: '#3d4a33', canopy: '#2f3f31', rockL: '#bcb2a3', rockD: '#6d665c', snow: '#eef2f6', sand: '#b9ab90', sandWet: '#857660' },
  way: route(), grade: 100,
  jumps: [{ f: 0.86, h: 0.45, text: 'Przez szczyt' }],
  features: [{ f: 0.07, text: 'Uwaga' }, { f: 0.93, text: 'Ślepy szczyt' }],
};
