// Hand-placed landmarks for the Wildlands, built in the painted style: a wooden dock you can walk out on, a vermilion
// torii with a little shrine and stone lanterns, a Ghibli cottage with a fenced flower garden, and benches.
// Everything is batched through the town GeoBuilder into a handful of meshes; lanterns and windows glow at night.
import { THREE, phTex, addBox, addCircle, addPlatform, mulberry32 } from './core.js';
import { GeoBuilder } from './townkit.js';
import { env } from './sky.js';

let M = null;
function materials() {
  if (M) return M;
  const std = o => new THREE.MeshStandardMaterial(Object.assign({ vertexColors: true, roughness: 0.9, metalness: 0 }, o));
  const planks = phTex('japanese_cedar_planks', 'diff', '1k', true);
  M = {
    wood: std({ map: planks, color: 0xd9b48c }),
    woodDark: std({ color: 0x6e4c38 }),
    red: std({ color: 0xe0452f, roughness: 0.6 }),
    black: std({ color: 0x2c2a2e, roughness: 0.7 }),
    stone: std({ color: 0xc4bfb6 }),
    plaster: std({ color: 0xf6f1e6 }),
    roof: std({ roughness: 0.7 }),
    glow: std({ color: 0xfff1d0, emissive: 0xffc774, emissiveIntensity: 0 }),
    window: std({ color: 0x4a6fa5, roughness: 0.2, emissive: 0xffb866, emissiveIntensity: 0 }),
    paint: std({ roughness: 0.8 }),
  };
  return M;
}
const J = (rng, c, a = 0.06) => c.map(v => Math.max(0, Math.min(1, v * (1 + (rng() - 0.5) * a))));

// wooden dock from (x,z) along direction r (local +Z), deck at `top`; walkable
export function dock(B, x, z, r, L, groundAt, top = 0.85) {
  const rng = mulberry32(5), W = 2.4;
  B.frame(x, 0, z, r);
  for (let s = 0; s < L; s += 0.31) B.box('wood', 0, top - 0.07, s + 0.15, W, 0.07, 0.28, { color: J(rng, [1, 1, 1], 0.14), uv: 2 });
  for (const sx of [-1.05, 1.05]) B.box('woodDark', sx, top - 0.3, L / 2, 0.14, 0.23, L);
  for (let s = 0.2; s <= L; s += 2.5) for (const sx of [-1.18, 1.18]) {
    const p = B.P([sx, 0, s]), gy = Math.min(groundAt(p[0], p[2]), top - 0.4);
    B.cyl('woodDark', sx, gy - 0.4, s, 0.11, 0.1, top + 0.3 - gy + 0.4, 8);
  }
  // bollards and a lantern post at the far end
  for (const sx of [-1.05, 1.05]) B.cyl('woodDark', sx, top, L - 0.2, 0.12, 0.12, 0.45, 8, { cap: true });
  B.cyl('woodDark', 0.95, top, L - 1.2, 0.07, 0.07, 1.9, 6);
  B.box('black', 0.95, top + 1.9, L - 1.2, 0.34, 0.06, 0.34);
  B.box('glow', 0.95, top + 1.55, L - 1.2, 0.26, 0.34, 0.26);
  B.box('black', 0.95, top + 1.5, L - 1.2, 0.3, 0.05, 0.3);
  const c = B.P([0, 0, L / 2]);
  addPlatform(c[0], c[2], W / 2, L / 2, r, top);
}

function gable(B, mat, w, d, y, rise, over, color) {
  const x0 = -w / 2 - over, x1 = w / 2 + over, z0 = -d / 2 - over, z1 = d / 2 + over, o = { color, uv: 1.6 };
  B.quad(mat, [x0, y, z1], [x1, y, z1], [x1, y + rise, 0], [x0, y + rise, 0], o);
  B.quad(mat, [x1, y, z0], [x0, y, z0], [x0, y + rise, 0], [x1, y + rise, 0], o);
  B.quad('woodDark', [x1, y, z1], [x0, y, z1], [x0, y + rise, 0], [x1, y + rise, 0]);     // soffits
  B.quad('woodDark', [x0, y, z0], [x1, y, z0], [x1, y + rise, 0], [x0, y + rise, 0]);
  B.box(mat, 0, y + rise - 0.03, 0, x1 - x0, 0.12, 0.3, { color: color.map(v => v * 0.8) });
}

// stone lantern (toro)
export function lantern(B, x, y, z, r = 0) {
  B.frame(x, y, z, r);
  B.box('stone', 0, 0, 0, 0.62, 0.18, 0.62);
  B.cyl('stone', 0, 0.18, 0, 0.13, 0.11, 0.85, 8);
  B.box('stone', 0, 1.03, 0, 0.56, 0.12, 0.56);
  B.box('glow', 0, 1.15, 0, 0.36, 0.34, 0.36);
  for (const [px, pz] of [[-0.19, -0.19], [0.19, -0.19], [0.19, 0.19], [-0.19, 0.19]]) B.box('stone', px, 1.15, pz, 0.07, 0.34, 0.07);
  const h = 1.49, e = 0.42;
  B.box('stone', 0, h, 0, 0.8, 0.07, 0.8);
  for (const [a, b] of [[[-e, h + 0.07, e], [e, h + 0.07, e]], [[e, h + 0.07, e], [e, h + 0.07, -e]], [[e, h + 0.07, -e], [-e, h + 0.07, -e]], [[-e, h + 0.07, -e], [-e, h + 0.07, e]]])
    B.tri('stone', a, b, [0, h + 0.36, 0]);
  B.cyl('stone', 0, h + 0.33, 0, 0.06, 0.02, 0.14, 6);
  const p = B.P([0, 0, 0]); addCircle(p[0], p[2], 0.32);
}

// vermilion torii with a small shrine (hokora) behind it; local +Z faces the approach
export function shrine(B, x, y, z, r) {
  B.frame(x, y, z, r);
  for (const sx of [-1.8, 1.8]) {
    B.cyl('black', sx, -0.2, 0, 0.25, 0.25, 0.5, 12);
    B.cyl('red', sx, 0.3, 0, 0.19, 0.16, 4.05, 12);
    const p = B.P([sx, 0, 0]); addCircle(p[0], p[2], 0.25);
  }
  B.box('red', 0, 3.15, 0, 4.7, 0.28, 0.2);                 // nuki
  B.box('red', 0, 3.43, 0, 0.24, 0.62, 0.18);               // gakuzuka
  B.box('black', 0, 3.54, 0.1, 0.5, 0.38, 0.04);            // name plaque
  B.box('red', 0, 4.02, 0, 5.3, 0.3, 0.32);                 // shimaki
  B.box('black', 0, 4.32, 0, 5.2, 0.2, 0.44);               // kasagi
  for (const sd of [-1, 1]) B.beam('black', [sd * 2.55, 4.42, 0], [sd * 3.25, 4.66, 0], 0.44, 0.2);
  // approach stones, the shrine house and a pair of lanterns
  for (let k = 0; k < 7; k++) B.box('stone', (k % 2 - 0.5) * 0.15, -0.05, 2 - k * 1.2, 1.1, 0.12, 0.8);
  B.frame(...B.P([0, 0, -5.2]), r);
  B.box('stone', 0, -0.1, 0, 2.2, 0.45, 1.9);
  B.box('wood', 0, 0.35, 0, 1.3, 1.15, 1.1, { color: [0.95, 0.82, 0.65] });
  B.box('black', 0, 0.45, 0.56, 0.7, 0.8, 0.02);
  gable(B, 'roof', 1.3, 1.1, 1.5, 0.55, 0.35, [0.22, 0.26, 0.36]);
  const hp = B.P([0, 0, 0]); addBox(hp[0], hp[2], 1.1, 0.95, r, y - 1, y + 2.5);
  B.frame(x, y, z, r);
  for (const sx of [-1.9, 1.9]) { const p = B.P([sx, 0, -3.2]); lantern(B, p[0], y - 0.05, p[2], r); B.frame(x, y, z, r); }
}

// Ghibli cottage: white plaster between dark timbers, red tiled roof, chimney, flower boxes, fenced garden (+Z front)
export function cottage(B, x, y, z, r, garden = true) {
  const W = 6.4, D = 5.2, H = 2.9, rng = mulberry32(9);
  B.frame(x, y, z, r);
  B.box('stone', 0, -0.4, 0, W + 0.3, 0.6, D + 0.3);
  B.box('plaster', 0, 0.2, 0, W, H, D);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.box('woodDark', sx * W / 2, 0.2, sz * D / 2, 0.22, H, 0.22);
  for (const sz of [-1, 1]) { B.box('woodDark', 0, 1.55, sz * (D / 2 + 0.01), W, 0.16, 0.06); B.box('woodDark', 0, H + 0.1, sz * (D / 2 + 0.01), W, 0.18, 0.06); }
  for (const sx of [-1, 1]) { B.box('woodDark', sx * (W / 2 + 0.01), 1.55, 0, 0.06, 0.16, D); B.box('woodDark', sx * (W / 2 + 0.01), H + 0.1, 0, 0.06, 0.18, D); }
  // gable roof along X, plaster gable ends with a timber cross
  const rise = 1.9;
  gable(B, 'roof', W, D, H + 0.2, rise, 0.55, [0.86, 0.26, 0.17]);
  for (const sx of [-1, 1]) {
    B.tri('plaster', [sx * W / 2, H + 0.2, sx * D / 2], [sx * W / 2, H + 0.2, -sx * D / 2], [sx * W / 2, H + 0.2 + rise, 0]);
    B.beam('woodDark', [sx * (W / 2 + 0.02), H + 0.25, -D / 2 + 0.3], [sx * (W / 2 + 0.02), H + rise - 0.1, 0], 0.08, 0.1);
    B.beam('woodDark', [sx * (W / 2 + 0.02), H + 0.25, D / 2 - 0.3], [sx * (W / 2 + 0.02), H + rise - 0.1, 0], 0.08, 0.1);
  }
  B.box('stone', 1.6, H + 0.6, -0.9, 0.7, 2.1, 0.7);          // chimney
  B.box('black', 1.6, H + 2.7, -0.9, 0.8, 0.1, 0.8);
  // door, windows with glowing panes, shutters and flower boxes
  B.box('woodDark', -1.3, 0.2, D / 2 + 0.02, 1.0, 2.05, 0.08, { color: [0.62, 0.4, 0.28] });
  B.box('window', -1.3, 1.75, D / 2 + 0.07, 0.35, 0.3, 0.02);
  B.box('stone', -1.3, -0.1, D / 2 + 0.5, 1.4, 0.3, 0.8);
  const flowers = [[1, 0.35, 0.5], [1, 0.8, 0.2], [0.95, 0.95, 0.9], [0.6, 0.45, 1], [1, 0.5, 0.75]];
  const win = (wx, wy, wz, rot) => {
    const F = B.F; B.frame(...B.P([wx, wy, wz]), r + rot);
    B.box('window', 0, 0, 0.02, 1.0, 1.0, 0.04);
    B.box('woodDark', 0, 0.47, 0.05, 0.08, 0.06, 0.06); B.box('woodDark', 0, -0.03, 0.05, 1.12, 0.08, 0.1); B.box('woodDark', 0, 1.0, 0.05, 1.12, 0.08, 0.1);
    B.box('woodDark', 0, 0, 0.05, 0.06, 1.0, 0.06);
    for (const sd of [-1, 1]) B.box('wood', sd * 0.82, 0, 0.06, 0.5, 1.0, 0.05, { color: [0.45, 0.62, 0.55] });
    B.box('woodDark', 0, -0.25, 0.2, 1.1, 0.22, 0.3);
    for (let k = 0; k < 7; k++) B.box('paint', -0.45 + k * 0.15, -0.05, 0.2 + (rng() - 0.5) * 0.12, 0.13, 0.13, 0.13, { color: flowers[Math.floor(rng() * flowers.length)] });
    B.F = F;
  };
  win(1.2, 1.0, D / 2, 0); win(-1.4, 1.0, -D / 2, Math.PI); win(1.4, 1.0, -D / 2, Math.PI);
  win(W / 2, 1.0, 0.8, Math.PI / 2); win(-W / 2, 1.0, -0.8, -Math.PI / 2);
  addBox(x, z, W / 2 + 0.2, D / 2 + 0.2, r, y - 1, y + 6);
  if (!garden) return;
  // picket fence around the front garden, with a gap for the path
  const gw = 11, gd = 7, gz0 = D / 2 + 0.8;
  const post = (px, pz) => { B.box('wood', px, 0, pz, 0.12, 1.0, 0.12, { color: [1, 0.97, 0.9] }); };
  const run = (ax, az, bx, bz, gap) => {
    const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 1.6));
    for (let k = 0; k <= n; k++) { const t = k / n, px = ax + (bx - ax) * t, pz = az + (bz - az) * t; if (gap && Math.abs(px - gap) < 0.9) continue; post(px, pz); }
    for (const hy of [0.35, 0.75]) {
      if (gap !== undefined) { B.beam('wood', [ax, hy, az], [gap - 0.9, hy, bz], 0.05, 0.08, { color: [1, 0.97, 0.9] }); B.beam('wood', [gap + 0.9, hy, az], [bx, hy, bz], 0.05, 0.08, { color: [1, 0.97, 0.9] }); }
      else B.beam('wood', [ax, hy, az], [bx, hy, bz], 0.05, 0.08, { color: [1, 0.97, 0.9] });
    }
  };
  run(-gw / 2, gz0 + gd, gw / 2, gz0 + gd, -1.3);
  run(-gw / 2, gz0 - 0.4, -gw / 2, gz0 + gd); run(gw / 2, gz0 - 0.4, gw / 2, gz0 + gd);
}

// a simple wooden bench (local +Z: the side you sit facing)
export function bench(B, x, y, z, r) {
  B.frame(x, y, z, r);
  for (const sx of [-0.7, 0.7]) { B.box('woodDark', sx, 0, 0, 0.08, 0.45, 0.42); B.box('woodDark', sx, 0.45, -0.22, 0.08, 0.45, 0.06); }
  for (let k = 0; k < 3; k++) B.box('wood', 0, 0.45, -0.15 + k * 0.14, 1.7, 0.05, 0.12);
  for (let k = 0; k < 2; k++) B.box('wood', 0, 0.62 + k * 0.16, -0.24, 1.7, 0.1, 0.04);
  const p = B.P([0, 0, 0]); addBox(p[0], p[2], 0.85, 0.25, r, y - 1, y + 0.5);
}

export function flushLandmarks(B) {
  const MT = materials();
  B.flush(MT);
  return {
    update() { MT.glow.emissiveIntensity = 0.15 + 2.6 * env.night; MT.window.emissiveIntensity = 1.8 * env.night; },
  };
}
export { GeoBuilder };
