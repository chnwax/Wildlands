// Shinto shrine kit, shared by the town shrine and the small Wildlands shrine. M maps roles to the caller's material
// names (lac, dark, wood, stone, roof, copper, glow, paper, rope, metal, water); colours are always explicit.
//  torii (myojin style): base stones, black collars, pillars, nuki with wedges, plaque strut, shimaki, a kasagi swept
//  into upturned ends; komainu on pedestals; kasuga stone lanterns; chozuya (basin, ladles, pavilion); haiden with an
//  irimoya roof (hip below, gable above), deck, railing, lattice doors, bell rope, offering box and shimenawa with shide;
//  honden with chigi and katsuogi inside a tamagaki fence; ema and omikuji racks; a stone-paved sando.
import { mulberry32, addPlatform } from './core.js';
import { gableRoof, inFrame, wallFill, reveals, windowUnit, doorUnit } from './building.js';

const TAU = Math.PI * 2;
const circle = (r, n = 8) => Array.from({ length: n }, (_, i) => [Math.cos(i / n * TAU) * r, Math.sin(i / n * TAU) * r]);
const mul = (c, k) => c.map(v => v * k);
export const VERM = [0.88, 0.24, 0.11], BLACK = [0.13, 0.12, 0.13], STONE = [0.74, 0.73, 0.7], OLDWOOD = [0.56, 0.42, 0.3],
  WHITE = [0.97, 0.96, 0.92], STRAW = [0.88, 0.78, 0.52], COPPER = [0.4, 0.64, 0.56], GOLD = [0.98, 0.78, 0.32];

export function torii(B, M, { span = 3.6, h = 4.5, col = VERM, top = BLACK, rope = false } = {}) {
  const px = span / 2, r0 = 0.2 * span / 3.6;
  for (const s of [-1, 1]) {
    B.bbox(M.stone, s * px, -0.12, 0, r0 * 3.6, 0.18, r0 * 3.6, 0.02, { color: STONE });
    B.cyl(M.dark, s * px, 0, 0, r0 * 1.34, r0 * 1.24, 0.42, 16, { color: top });
    B.cyl(M.dark, s * px, 0.4, 0, r0 * 1.24, r0 * 1.02, 0.05, 16, { color: top });
    B.cyl(M.lac, s * px, 0.42, 0, r0, r0 * 0.88, h - 0.42, 16, { color: col });
  }
  const yN = h * 0.7, yS = h - 0.02;
  B.bbox(M.lac, 0, yN, 0, span + 1.15, 0.24, 0.17, 0.015, { color: col });
  for (const s of [-1, 1]) B.bbox(M.dark, s * (px + r0 + 0.1), yN - 0.03, 0, 0.12, 0.3, 0.21, 0.01, { color: top });
  B.bbox(M.lac, 0, yN + 0.24, 0, 0.24, yS - yN - 0.24, 0.15, 0.01, { color: col });
  B.bbox(M.dark, 0, yN + 0.3, 0.1, 0.52, 0.74, 0.06, 0.012, { color: top });
  B.bbox(M.metal, 0, yN + 0.36, 0.13, 0.4, 0.62, 0.012, 0.004, { color: GOLD });
  B.bbox(M.dark, 0, yN + 0.4, 0.137, 0.32, 0.54, 0.008, 0.003, { color: top });
  B.bbox(M.lac, 0, yS, 0, span + 1.45, 0.26, 0.28, 0.015, { color: col });
  const xe = span / 2 + 1.05, pts = [];
  for (let i = 0; i <= 14; i++) { const x = -xe + 2 * xe * i / 14, t = Math.abs(x) / xe; pts.push([x, yS + 0.36 + 0.26 * t ** 3.2, 0]); }
  B.sweep(M.dark, [[-0.25, -0.12], [0.25, -0.12], [0.25, 0.13], [-0.25, 0.13]], pts, { closed: true, caps: true, color: top, uv: 1 });
  if (rope) shimenawa(B, M, [-px + 0.1, yN - 0.05, 0.12], [px - 0.1, yN - 0.05, 0.12], 0.35, 0.06, 3);
  return [[-px, 0], [px, 0]];
}
// straw rope sagging between two points, with zigzag paper streamers (shide)
export function shimenawa(B, M, a, b, sag, rad, nShide) {
  const pts = [];
  for (let i = 0; i <= 12; i++) { const t = i / 12; pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t]); }
  B.sweep(M.rope, circle(rad, 8), pts, { closed: true, caps: true, color: STRAW, uv: 0.3 });
  for (let i = 0; i < 12; i++) { const p = pts[i]; B.box(M.rope, p[0], p[1] - rad * 0.2, p[2], 0.02, rad * 0.4, rad * 2.05, { color: mul(STRAW, 0.8) }); } // twist bands
  for (let k = 1; k <= nShide; k++) {
    const t = k / (nShide + 1), p = pts[Math.round(t * 12)], y0 = p[1] - rad;
    for (let j = 0; j < 4; j++) { const x0 = p[0] + (j % 2 ? 0.05 : -0.05), y = y0 - j * 0.1;
      B.quad(M.paper, [x0 - 0.06, y - 0.1, p[2]], [x0 + 0.06, y - 0.1, p[2]], [x0 + 0.06, y, p[2]], [x0 - 0.06, y, p[2]], { color: WHITE });
      B.quad(M.paper, [x0 + 0.06, y - 0.1, p[2] - 0.004], [x0 - 0.06, y - 0.1, p[2] - 0.004], [x0 - 0.06, y, p[2] - 0.004], [x0 + 0.06, y, p[2] - 0.004], { color: mul(WHITE, 0.85) }); }
  }
}
export function komainu(B, M, x, z, r, open) {
  inFrame(B, [x, 0, z], r, () => {
    B.bbox(M.stone, 0, 0, 0, 1.0, 0.24, 1.0, 0.02, { color: mul(STONE, 0.9) });
    B.bbox(M.stone, 0, 0.24, 0, 0.74, 0.72, 0.74, 0.025, { color: STONE });
    B.bbox(M.stone, 0, 0.96, 0, 0.88, 0.12, 0.88, 0.025, { color: mul(STONE, 0.95) });
    const y = 1.08, c = [0.64, 0.62, 0.58];
    B.bbox(M.stone, 0, y, -0.1, 0.52, 0.38, 0.5, 0.1, { color: c });
    B.bbox(M.stone, 0, y + 0.3, 0.02, 0.42, 0.52, 0.36, 0.09, { color: c });
    for (const s of [-1, 1]) { B.bbox(M.stone, s * 0.13, y, 0.18, 0.12, 0.52, 0.14, 0.035, { color: c }); B.bbox(M.stone, s * 0.13, y, 0.25, 0.15, 0.08, 0.13, 0.025, { color: mul(c, 0.95) }); }
    B.bbox(M.stone, 0, y + 0.66, -0.02, 0.54, 0.5, 0.42, 0.12, { color: mul(c, 0.94) });                  // mane
    B.bbox(M.stone, 0, y + 0.72, 0.14, 0.38, 0.34, 0.3, 0.08, { color: c });                              // face
    B.bbox(M.stone, 0, y + 0.7, 0.3, 0.22, open ? 0.08 : 0.13, 0.1, 0.03, { color: mul(c, 0.92) });       // muzzle
    if (open) B.bbox(M.dark, 0, y + 0.79, 0.3, 0.16, 0.05, 0.08, 0.01, { color: [0.22, 0.18, 0.16] });
    for (const s of [-1, 1]) { B.box(M.dark, s * 0.09, y + 0.92, 0.29, 0.06, 0.035, 0.01, { color: [0.2, 0.19, 0.18] }); B.bbox(M.stone, s * 0.17, y + 1.0, 0.08, 0.1, 0.12, 0.08, 0.02, { color: c }); }
    B.sweep(M.stone, circle(0.075, 6), [[0, y + 0.2, -0.33], [0, y + 0.5, -0.46], [0, y + 0.78, -0.4], [0, y + 0.86, -0.27]], { closed: true, caps: true, color: c, uv: 0.5 });
  });
}
// kasuga-style stone lantern; returns the fire box position for a night light
export function toro(B, M, x, z, s = 1) {
  return inFrame(B, [x, 0, z], 0, () => {
    const c = STONE, o = { color: c, cap: true, smooth: false };
    B.cyl(M.stone, 0, 0, 0, 0.44 * s, 0.4 * s, 0.16 * s, 6, { ...o, color: mul(c, 0.9) });
    B.cyl(M.stone, 0, 0.16 * s, 0, 0.28 * s, 0.2 * s, 0.1 * s, 6, o);
    B.cyl(M.stone, 0, 0.26 * s, 0, 0.13 * s, 0.12 * s, 0.76 * s, 12, { color: c });
    for (const k of [0.3, 0.62]) B.cyl(M.stone, 0, (0.26 + k * 0.76) * s, 0, 0.15 * s, 0.15 * s, 0.04 * s, 12, { color: mul(c, 0.95), cap: true });
    B.cyl(M.stone, 0, 1.02 * s, 0, 0.2 * s, 0.34 * s, 0.13 * s, 6, o);
    B.cyl(M.glow, 0, 1.15 * s, 0, 0.2 * s, 0.2 * s, 0.3 * s, 6, { color: [1, 1, 1], smooth: false });
    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; B.box(M.stone, Math.cos(a) * 0.24 * s, 1.15 * s, Math.sin(a) * 0.24 * s, 0.075 * s, 0.3 * s, 0.075 * s, { color: c }); }
    B.cyl(M.stone, 0, 1.45 * s, 0, 0.52 * s, 0.48 * s, 0.06 * s, 6, o);
    B.cyl(M.stone, 0, 1.51 * s, 0, 0.48 * s, 0.1 * s, 0.22 * s, 6, o);
    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; B.cyl(M.stone, Math.cos(a) * 0.51 * s, 1.47 * s, Math.sin(a) * 0.51 * s, 0.035 * s, 0.015 * s, 0.1 * s, 5, { color: c, cap: true }); }
    B.cyl(M.stone, 0, 1.73 * s, 0, 0.08 * s, 0.08 * s, 0.03 * s, 8, { color: c, cap: true });
    B.cyl(M.stone, 0, 1.76 * s, 0, 0.07 * s, 0.1 * s, 0.07 * s, 8, { color: c, cap: true });
    B.cyl(M.stone, 0, 1.83 * s, 0, 0.1 * s, 0.01 * s, 0.11 * s, 8, { color: c, cap: true });
    return B.P([0, 1.3 * s, 0]);
  });
}
export function offeringBox(B, M, x, z, w = 1.3) {
  inFrame(B, [x, 0, z], 0, () => {
    B.bbox(M.wood, 0, 0, 0, w, 0.62, 0.62, 0.015, { color: OLDWOOD });
    for (let i = 0; i < 7; i++) B.beam(M.wood, [-w / 2 + 0.05, 0.62, -0.25 + i * 0.08], [w / 2 - 0.05, 0.62, -0.25 + i * 0.08], 0.025, 0.05, { color: mul(OLDWOOD, 0.8) });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.bbox(M.dark, sx * (w / 2 - 0.02), 0.5, sz * 0.29, 0.06, 0.14, 0.06, 0.005, { color: [0.2, 0.18, 0.15] });
    B.bbox(M.metal, 0, 0.3, 0.315, 0.5, 0.18, 0.01, 0.003, { color: GOLD });
  });
}
// irimoya roof: hip below, a gable pediment above (fraction g of each hip end); copper or tile
export function irimoyaRoof(B, M, { w, d, y, pitch, over, color, g = 0.5, t = 0.2 }) {
  const k = Math.tan(pitch), tv = t / Math.cos(pitch), hw = w / 2 + over, hd = d / 2 + over, ye = y + tv - k * over, yR = ye + k * hd, r = Math.max(0, hw - hd);
  const xg = r + (hw - r) * g, yg = ye + k * (hw - xg), zg = hd * (xg - r) / (hw - r || 1), mat = M.roof, uvo = { color, uv: 2 };
  for (const s of [1, -1]) {
    B.poly(mat, [[-hw, ye, s * hd], [hw, ye, s * hd], [r, yR, 0], [-r, yR, 0]], [0, 1, s * k], uvo);
    for (const e of [-1, 1]) B.poly(mat, [[e * r, yR, 0], [e * xg, yR, 0], [e * xg, yg, s * zg]], [0, 1, s * k], uvo);      // gable slopes
    B.poly(mat, [[s * hw, ye, hd], [s * hw, ye, -hd], [s * xg, yg, -zg], [s * xg, yg, zg]], [s * k, 1, 0], uvo);            // lower hip end
    B.poly(M.wood, [[s * xg, yg, zg], [s * xg, yg, -zg], [s * xg, yR, 0]], [s, 0, 0], { color: mul(OLDWOOD, 0.9) });          // pediment
    for (let i = 1; i < 6; i++) { const zz = -zg + 2 * zg * i / 6, yt = yR - (yR - yg) * Math.abs(zz) / zg; B.box(M.wood, s * (xg + 0.02), yg, zz, 0.03, yt - yg, 0.04, { color: mul(OLDWOOD, 0.6) }); }
    B.bbox(M.lac, s * (xg + 0.03), yg - 0.05, 0, 0.05, 0.1, 2 * zg, 0.005, { color: BLACK });
    for (const e of [-1, 1]) B.beam(M.lac, [s * (xg + 0.04), yg + 0.02, e * zg], [s * (xg + 0.04), yR + 0.06, 0], 0.05, 0.16, { color: mul(color, 0.7) });   // barge boards
    B.poly(M.wood, [[-hw, ye - tv, s * hd], [hw, ye - tv, s * hd], [w / 2, y, s * d / 2], [-w / 2, y, s * d / 2]], [0, -1, 0], { color: mul(OLDWOOD, 0.75) });
    B.poly(M.wood, [[s * hw, ye - tv, hd], [s * hw, ye - tv, -hd], [s * w / 2, y, -d / 2], [s * w / 2, y, d / 2]], [0, -1, 0], { color: mul(OLDWOOD, 0.75) });
    B.bbox(M.wood, 0, ye - tv - 0.06, s * (hd + 0.02), 2 * hw + 0.08, tv + 0.08, 0.04, 0.008, { color: mul(OLDWOOD, 0.7) });
    B.bbox(M.wood, s * (hw + 0.02), ye - tv - 0.06, 0, 0.04, tv + 0.08, 2 * hd + 0.08, 0.008, { color: mul(OLDWOOD, 0.7) });
    for (let x = -hw + 0.3; x < hw; x += 0.4) B.box(M.wood, x, ye - tv - 0.2, s * (hd - 0.35), 0.08, 0.1, 0.7, { color: mul(OLDWOOD, 0.8) }); // rafter ends
    for (const e of [-1, 1]) B.sweep(mat, circle(0.1, 8), [[s * hw, ye + 0.03, e * hd], [s * xg, yg + 0.02, e * zg]], { closed: true, caps: true, color: mul(color, 0.85), uv: 0.6 });
  }
  B.sweep(mat, circle(0.16, 10), [[-xg - 0.15, yR - 0.02, 0], [xg + 0.15, yR - 0.02, 0]], { closed: true, caps: true, color: mul(color, 0.8), uv: 0.6 });
  return { yR, ye };
}
// the worship hall; local +Z faces the approach
export function haiden(B, M, x, z, r, { w = 8, d = 6, col = VERM, roofC = COPPER } = {}) {
  return inFrame(B, [x, 0, z], r, () => {
    const fl = 1.0, ch = 3.1;
    B.bbox(M.stone, 0, 0, 0, w + 2.0, 0.45, d + 2.0, 0.03, { color: STONE, uv: 2 });
    B.bbox(M.wood, 0, 0.45, 0, w + 1.3, fl - 0.45, d + 1.3, 0.02, { color: mul(OLDWOOD, 0.8), uv: 2 });
    for (let i = 0; i <= 12; i++) B.box(M.wood, -w / 2 - 0.65 + i * (w + 1.3) / 12, fl - 0.005, 0, 0.02, 0.01, d + 1.3, { color: mul(OLDWOOD, 0.6) }); // deck boards
    const cols = [];
    for (let i = 0; i <= 3; i++) for (const s of [-1, 1]) cols.push([-w / 2 + i * w / 3, s * d / 2]);
    for (const s of [-1, 1]) cols.push([s * w / 2, 0]);
    for (const [cx, cz] of cols) { B.cyl(M.lac, cx, fl, cz, 0.17, 0.16, ch, 12, { color: col }); B.bbox(M.wood, cx, fl + ch - 0.02, cz, 0.42, 0.18, 0.42, 0.02, { color: mul(OLDWOOD, 0.85) }); }
    // walls: plaster panels at the sides and back, lattice doors across the front
    for (const s of [-1, 1]) B.bbox(M.paper, s * (w / 2 - 0.02), fl + 0.15, 0, 0.1, ch - 0.35, d - 0.3, 0.01, { color: WHITE });
    B.bbox(M.paper, 0, fl + 0.15, -d / 2 + 0.02, w - 0.3, ch - 0.35, 0.1, 0.01, { color: WHITE });
    for (let i = 0; i < 3; i++) {
      const cx = -w / 2 + (i + 0.5) * w / 3, bw = w / 3 - 0.36;
      B.bbox(M.paper, cx, fl + 0.12, d / 2 - 0.12, bw, ch - 0.55, 0.04, 0.005, { color: [0.95, 0.93, 0.86] });
      for (let k = 0; k <= 10; k++) B.box(M.lac, cx - bw / 2 + k * bw / 10, fl + 0.12, d / 2 - 0.08, 0.03, ch - 0.55, 0.03, { color: mul(col, 0.9) });
      for (let k = 0; k <= 8; k++) B.box(M.lac, cx, fl + 0.12 + k * (ch - 0.55) / 8, d / 2 - 0.08, bw, 0.03, 0.03, { color: mul(col, 0.9) });
    }
    for (const yb of [fl + 0.05, fl + ch - 0.45, fl + ch - 0.18]) { // nuki bands all round
      B.bbox(M.lac, 0, yb, d / 2 + 0.02, w + 0.4, 0.14, 0.12, 0.01, { color: col }); B.bbox(M.lac, 0, yb, -d / 2 - 0.02, w + 0.4, 0.14, 0.12, 0.01, { color: col });
      for (const s of [-1, 1]) B.bbox(M.lac, s * (w / 2 + 0.02), yb, 0, 0.12, 0.14, d + 0.4, 0.01, { color: col });
    }
    // railing round the deck (open at the front steps)
    const rl = (ax, az, bx, bz) => { B.beam(M.lac, [ax, fl + 0.72, az], [bx, fl + 0.72, bz], 0.07, 0.06, { color: col }); B.beam(M.lac, [ax, fl + 0.3, az], [bx, fl + 0.3, bz], 0.05, 0.05, { color: col });
      const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 1.1)); for (let i = 0; i <= n; i++) B.box(M.lac, ax + (bx - ax) * i / n, fl, az + (bz - az) * i / n, 0.08, 0.76, 0.08, { color: col }); };
    const ex = w / 2 + 0.6, ez = d / 2 + 0.6;
    rl(-ex, -ez, ex, -ez); rl(-ex, -ez, -ex, ez); rl(ex, -ez, ex, ez); rl(-ex, ez, -1.4, ez); rl(1.4, ez, ex, ez);
    // steps up to the deck with handrails
    for (let i = 0; i < 5; i++) B.bbox(M.wood, 0, i * fl / 5, ez + 0.25 + (4 - i) * 0.28, 2.6, fl / 5, 0.3, 0.01, { color: mul(OLDWOOD, 0.85) });
    for (const s of [-1, 1]) { B.beam(M.lac, [s * 1.35, fl + 0.72, ez], [s * 1.35, 0.8, ez + 1.6], 0.06, 0.06, { color: col }); B.cyl(M.lac, s * 1.35, 0, ez + 1.6, 0.05, 0.05, 0.85, 8, { color: col, cap: true }); }
    const R = irimoyaRoof(B, M, { w: w + 0.3, d: d + 0.3, y: fl + ch + 0.14, pitch: 0.62, over: 1.45, color: roofC });
    // front canopy (kohai) over the steps
    inFrame(B, [0, 0, d / 2 + 1.5], Math.PI / 2, () => gableRoof(B, { w: 2.6, d: 3.0, y: fl + ch - 0.05, pitch: 0.5, over: 0.4, rake: 0.4, mat: M.roof, color: roofC, gutters: false, wallMat: M.wood, wallColor: mul(OLDWOOD, 0.8) }));
    for (const s of [-1, 1]) { B.cyl(M.lac, s * 1.35, 0, d / 2 + 2.8, 0.13, 0.12, fl + ch - 0.05, 10, { color: col }); B.bbox(M.stone, s * 1.35, -0.05, d / 2 + 2.8, 0.45, 0.15, 0.45, 0.02, { color: STONE }); }
    // bell with its rope, offering box, shimenawa across the front
    const by = fl + ch - 0.25;
    B.cyl(M.metal, 0, by - 0.42, d / 2 + 0.5, 0.05, 0.19, 0.12, 12, { color: GOLD });
    B.cyl(M.metal, 0, by - 0.3, d / 2 + 0.5, 0.19, 0.17, 0.12, 12, { color: GOLD });
    B.cyl(M.metal, 0, by - 0.18, d / 2 + 0.5, 0.17, 0.06, 0.1, 12, { color: GOLD, cap: true });
    for (const [c2, a0, a1] of [[[0.86, 0.2, 0.16], 0, 0.33], [WHITE, 0.33, 0.66], [[0.45, 0.25, 0.55], 0.66, 1]])
      B.sweep(M.rope, circle(0.045, 8), [[0, by - 0.45 - a0 * (by - fl - 1.5), d / 2 + 0.5], [0, by - 0.45 - a1 * (by - fl - 1.5), d / 2 + 0.5]], { closed: true, color: c2, uv: 0.3 });
    offeringBox(B, M, 0, d / 2 + 0.95, 1.6);
    shimenawa(B, M, [-w / 2, fl + ch - 0.35, d / 2 + 0.32], [w / 2, fl + ch - 0.35, d / 2 + 0.32], 0.35, 0.09, 5);
    return { top: R.yR, fl };
  });
}
// main sanctuary (nagare-zukuri gable) with chigi and katsuogi
export function honden(B, M, x, z, r, { w = 3.6, d = 3.2, col = VERM, roofC = COPPER } = {}) {
  inFrame(B, [x, 0, z], r, () => {
    const fl = 1.2, ch = 2.4;
    B.bbox(M.stone, 0, 0, 0, w + 1.4, 0.6, d + 1.4, 0.03, { color: STONE, uv: 2 });
    B.bbox(M.wood, 0, 0.6, 0, w + 0.8, fl - 0.6, d + 0.8, 0.02, { color: mul(OLDWOOD, 0.8) });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.cyl(M.lac, sx * w / 2, fl, sz * d / 2, 0.14, 0.13, ch, 10, { color: col });
    B.bbox(M.wood, 0, fl, 0, w - 0.1, ch, d - 0.1, 0.01, { color: mul(OLDWOOD, 1.1) });
    B.bbox(M.lac, 0, fl + 0.1, d / 2 - 0.02, 1.2, 1.8, 0.06, 0.01, { color: mul(col, 0.8) });
    B.bbox(M.metal, 0, fl + 1.0, d / 2 + 0.02, 0.08, 0.3, 0.02, 0.005, { color: GOLD });
    for (let i = 0; i < 4; i++) B.bbox(M.wood, 0, i * fl / 4, d / 2 + 0.5 + (3 - i) * 0.25, 1.4, fl / 4, 0.26, 0.01, { color: mul(OLDWOOD, 0.85) });
    const R = gableRoof(B, { w, d, y: fl + ch, pitch: 0.72, over: 0.9, rake: 0.5, mat: M.roof, color: roofC, gutters: false, wallMat: M.wood, wallColor: mul(OLDWOOD, 0.95), t: 0.18 });
    const k = Math.tan(0.72), z1 = d / 2 + 0.9, x1 = w / 2 + 0.5;
    for (const e of [-1, 1]) for (const s of [-1, 1]) B.beam(M.wood, [e * (x1 + 0.03), R.ye - 0.05, s * z1 * 0.35], [e * (x1 + 0.03), R.yR + 0.95, -s * 0.55], 0.07, 0.2, { color: mul(OLDWOOD, 0.75) }); // chigi
    for (let i = 0; i < 5; i++) { const xx = -w / 2 + 0.3 + i * (w - 0.6) / 4; B.sweep(M.wood, circle(0.1, 8), [[xx, R.yR + 0.1, -0.45], [xx, R.yR + 0.1, 0.45]], { closed: true, caps: true, color: mul(OLDWOOD, 0.8), capColor: GOLD }); } // katsuogi
    void k;
  });
}
// low fence (tamagaki) round a rectangle, open at the front middle
export function tamagaki(B, M, x, z, w, d, col = VERM) {
  inFrame(B, [x, 0, z], 0, () => {
    const run = (ax, az, bx, bz) => { const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 0.9));
      for (let i = 0; i <= n; i++) { const px = ax + (bx - ax) * i / n, pz = az + (bz - az) * i / n; B.bbox(M.lac, px, 0, pz, 0.1, 1.25, 0.1, 0.01, { color: col }); B.bbox(M.dark, px, 1.25, pz, 0.13, 0.04, 0.13, 0.005, { color: BLACK }); }
      for (const yy of [0.35, 1.0]) B.beam(M.lac, [ax, yy, az], [bx, yy, bz], 0.06, 0.08, { color: col }); };
    run(-w / 2, -d / 2, w / 2, -d / 2); run(-w / 2, -d / 2, -w / 2, d / 2); run(w / 2, -d / 2, w / 2, d / 2); run(-w / 2, d / 2, -0.9, d / 2); run(0.9, d / 2, w / 2, d / 2);
  });
}
export function chozuya(B, M, x, z, r, { col = OLDWOOD, roofC = COPPER } = {}) {
  inFrame(B, [x, 0, z], r, () => {
    B.bbox(M.stone, 0, 0, 0, 2.8, 0.14, 2.2, 0.02, { color: mul(STONE, 0.92) });
    B.bbox(M.stone, 0, 0.14, 0, 1.6, 0.26, 0.82, 0.03, { color: mul(STONE, 0.85) });
    const bw = 1.45, bd = 0.72, by = 0.4, bh = 0.42, t = 0.1;
    for (const s of [-1, 1]) { B.bbox(M.stone, 0, by, s * (bd / 2 - t / 2), bw, bh, t, 0.02, { color: STONE }); B.bbox(M.stone, s * (bw / 2 - t / 2), by, 0, t, bh, bd - 2 * t, 0.02, { color: STONE }); }
    B.bbox(M.stone, 0, by, 0, bw - 2 * t, 0.1, bd - 2 * t, 0.01, { color: mul(STONE, 0.8) });
    B.quad(M.water, [-bw / 2 + t, by + bh - 0.06, bd / 2 - t], [bw / 2 - t, by + bh - 0.06, bd / 2 - t], [bw / 2 - t, by + bh - 0.06, -bd / 2 + t], [-bw / 2 + t, by + bh - 0.06, -bd / 2 + t], { color: [0.25, 0.42, 0.45] });
    for (let i = 0; i < 5; i++) { const lx = -0.5 + i * 0.25; B.beam(M.wood, [lx, by + bh + 0.03, -0.3], [lx, by + bh + 0.03, 0.2], 0.018, 0.018, { color: [0.82, 0.74, 0.5] }); B.cyl(M.wood, lx, by + bh + 0.0, 0.26, 0.04, 0.04, 0.07, 8, { color: [0.82, 0.74, 0.5], cap: true }); }
    B.bbox(M.metal, bw / 2 - 0.15, by + bh + 0.05, -0.25, 0.14, 0.18, 0.14, 0.02, { color: [0.3, 0.52, 0.46] }); // bronze dragon spout
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.cyl(M.wood, sx * 1.15, 0.14, sz * 0.85, 0.09, 0.08, 2.25, 10, { color: col });
    for (const s of [-1, 1]) { B.bbox(M.wood, 0, 2.2, s * 0.85, 2.5, 0.16, 0.14, 0.01, { color: mul(col, 0.9) }); B.bbox(M.wood, s * 1.15, 2.2, 0, 0.14, 0.16, 1.9, 0.01, { color: mul(col, 0.9) }); }
    gableRoof(B, { w: 2.3, d: 1.7, y: 2.38, pitch: 0.55, over: 0.55, rake: 0.45, mat: M.roof, color: roofC, gutters: false, wallMat: M.wood, wallColor: mul(col, 0.9), t: 0.12 });
  });
}
export function emaRack(B, M, x, z, r, rng) {
  inFrame(B, [x, 0, z], r, () => {
    for (const s of [-1, 1]) B.bbox(M.wood, s * 1.0, 0, 0, 0.1, 2.0, 0.1, 0.01, { color: OLDWOOD });
    for (const yy of [0.9, 1.35, 1.8]) B.bbox(M.wood, 0, yy, 0, 2.1, 0.05, 0.06, 0.005, { color: OLDWOOD });
    for (const yy of [0.9, 1.35]) for (let i = 0; i < 12; i++) if (rng() < 0.85) {
      const px = -0.9 + i * 0.165 + (rng() - 0.5) * 0.03, py = yy - 0.02, zz = 0.04 + rng() * 0.02, tw = 0.07, th = 0.1;
      B.poly(M.wood, [[px - tw, py - th, zz], [px + tw, py - th, zz], [px + tw, py - 0.02, zz], [px - tw, py - 0.02, zz]], [0, 0, 1], { color: [0.9, 0.78, 0.58] });
      B.poly(M.wood, [[px - tw, py - 0.02, zz], [px + tw, py - 0.02, zz], [px, py + 0.02, zz]], [0, 0, 1], { color: [0.9, 0.78, 0.58] });
      if (rng() < 0.6) B.box(M.dark, px, py - 0.07, zz + 0.002, 0.06, 0.03, 0.002, { color: [0.2, 0.15, 0.12] });
    }
    gableRoof(B, { w: 2.2, d: 0.4, y: 2.0, pitch: 0.5, over: 0.2, rake: 0.1, mat: M.roof, color: [0.3, 0.3, 0.32], gutters: false, wallMat: M.wood, wallColor: OLDWOOD, t: 0.06 });
  });
}
export function omikuji(B, M, x, z, r, rng) {
  inFrame(B, [x, 0, z], r, () => {
    for (const s of [-1, 1]) B.bbox(M.wood, s * 1.1, 0, 0, 0.08, 1.7, 0.08, 0.01, { color: OLDWOOD });
    for (const yy of [1.0, 1.35, 1.65]) { B.beam(M.metal, [-1.1, yy, 0], [1.1, yy, 0], 0.012, 0.012, { color: [0.5, 0.5, 0.5] });
      for (let i = 0; i < 26; i++) if (rng() < 0.8) B.box(M.paper, -1.0 + i * 0.08 + (rng() - 0.5) * 0.02, yy - 0.03, 0, 0.03, 0.06, 0.03, { color: WHITE }); }
  });
}
// stone-paved approach from (0, z0) to (0, z1) along local z: paving stones in gravel, stone kerbs
export function sando(B, M, z0, z1, w = 2.2) {
  const rng = mulberry32(77), L = Math.abs(z1 - z0), dir = Math.sign(z1 - z0);
  for (let s = 0; s < L; s += 0.62) {
    const n = 2, sw = w / n;
    const off = Math.floor(s / 0.62) % 2 ? sw * 0.5 : 0;   // running bond
    for (let i = -1; i < n; i++) { const a = Math.max(-w / 2, -w / 2 + i * sw + off), b = Math.min(w / 2, -w / 2 + (i + 1) * sw + off); if (b - a < 0.1) continue;
      B.bbox(M.stone, (a + b) / 2, -0.06, z0 + dir * (s + 0.3), b - a - 0.04, 0.12, 0.58, 0.015, { color: mul(STONE, 0.88 + rng() * 0.14) }); }
  }
  for (const sx of [-1, 1]) B.bbox(M.stone, sx * (w / 2 + 0.08), -0.06, (z0 + z1) / 2, 0.14, 0.14, L, 0.015, { color: mul(STONE, 0.85) });
}

// sacred tree marker: shimenawa round the trunk with shide
export function sacredRope(B, M, x, z, rad = 0.98, y = 1.9) {
  const pts = []; for (let i = 0; i <= 20; i++) { const a = i / 20 * TAU; pts.push([x + Math.cos(a) * rad, y + Math.sin(a * 2) * 0.03, z + Math.sin(a) * rad]); }
  B.sweep(M.rope, circle(0.085, 8), pts, { closed: true, color: STRAW, uv: 0.3 });
  for (let k = 0; k < 4; k++) { const a = k / 4 * TAU + 0.4, px = x + Math.cos(a) * (rad + 0.07), pz = z + Math.sin(a) * (rad + 0.07);
    inFrame(B, [px, 0, pz], Math.atan2(Math.cos(a), Math.sin(a)), () => { for (let j = 0; j < 4; j++) { const xx = j % 2 ? 0.05 : -0.05, yy = y - 0.08 - j * 0.1;
      B.quad(M.paper, [xx - 0.06, yy - 0.1, 0], [xx + 0.06, yy - 0.1, 0], [xx + 0.06, yy, 0], [xx - 0.06, yy, 0], { color: WHITE }); B.quad(M.paper, [xx + 0.06, yy - 0.1, -0.004], [xx - 0.06, yy - 0.1, -0.004], [xx - 0.06, yy, -0.004], [xx + 0.06, yy, -0.004], { color: mul(WHITE, 0.85) }); } }); }
}
// town shrine compound; local +Z faces the approach, origin at the torii. Returns lamp points, colliders, tree spot
export function shrineCompound(B, M, x, y, z, r, extras, rng) {
  const lamps = [];
  B.frame(x, y, z, r);
  const circ = (lx, lz, rr) => extras.push({ t: 'circle', p: B.P([lx, 0, lz]), r: rr });
  const box = (lx, lz, hx, hz, h = 20) => extras.push({ t: 'box', p: B.P([lx, 0, lz]), hx, hz, r, h });
  for (const [px, pz] of torii(B, M, { span: 4.2, h: 5.3, rope: true })) circ(px, pz, 0.32);
  sando(B, M, 3.5, -20.4, 2.2);
  for (const s of [-1, 1]) { komainu(B, M, s * 2.7, -5.2, -s * 0.28, s < 0); box(s * 2.7, -5.2, 0.5, 0.5, 2.2); }
  for (const zz of [-2.2, -10.5, -16.5]) for (const s of [-1, 1]) { lamps.push(toro(B, M, s * 2.8, zz, zz === -2.2 ? 1.15 : 1)); circ(s * 2.8, zz, 0.45); }
  chozuya(B, M, 5.6, -8.5, -Math.PI / 2); box(5.6, -8.5, 1.2, 1.4, 3);
  // the inner precinct stands on a terrace of fitted stone (石垣) reached by a flight of stone steps (石段), with a
  // grey stone torii at their foot; the halls are built on the terrace
  const rise = 1.35, tz0 = -21.6, tz1 = -38.8, tw = 7.6, nSt = 9, run = 0.32, sz0 = tz0 + nSt * run, sw = 3.0;
  const wallSeg = (x0, x1, z0, z1) => { const L = Math.hypot(x1 - x0, z1 - z0); if (L < 0.05) return;
    B.beam(M.stone, [x0, rise / 2 - 0.1, z0], [x1, rise / 2 - 0.1, z1], 0.5, rise + 0.2, { color: [0.62, 0.6, 0.56], uv: 1.4 });
    B.beam(M.stone, [x0, rise + 0.04, z0], [x1, rise + 0.04, z1], 0.62, 0.1, { color: [0.7, 0.68, 0.64] }); };
  wallSeg(-tw, -sw / 2 - 0.25, tz0, tz0); wallSeg(sw / 2 + 0.25, tw, tz0, tz0);
  wallSeg(-tw, -tw, tz0, tz1); wallSeg(tw, tw, tz0, tz1); wallSeg(-tw, tw, tz1, tz1);
  B.bbox(M.stone, 0, rise - 0.12, (tz0 + tz1) / 2, 2 * tw - 0.4, 0.14, tz0 - tz1 - 0.4, 0.02, { color: [0.78, 0.74, 0.66], uv: 2 }); // gravel-grey top
  for (let i = 0; i < nSt; i++) { const zz = sz0 - (i + 0.5) * run, yy = (i + 1) * rise / nSt;
    B.bbox(M.stone, 0, 0, zz, sw, yy, run + 0.02, 0.02, { color: [0.68 - 0.01 * (i % 2), 0.66, 0.62], uv: 1 }); addPlatform(...[B.P([0, 0, zz])[0], B.P([0, 0, zz])[2]], sw / 2, run / 2, r, B.F.y + yy); }
  for (const s of [-1, 1]) B.beam(M.stone, [s * (sw / 2 + 0.12), 0.35, sz0], [s * (sw / 2 + 0.12), rise + 0.35, tz0], 0.24, 0.7, { color: [0.6, 0.58, 0.54] }); // cheek walls
  { const c = B.P([0, 0, (tz0 + tz1) / 2]); addPlatform(c[0], c[2], tw - 0.3, (tz0 - tz1) / 2 - 0.3, r, B.F.y + rise); }
  box(-tw, (tz0 + tz1) / 2, 0.3, (tz0 - tz1) / 2, rise); box(tw, (tz0 + tz1) / 2, 0.3, (tz0 - tz1) / 2, rise); box(0, tz1, tw, 0.3, rise);
  box(-(sw / 2 + tw) / 2 - 0.12, tz0, (tw - sw / 2) / 2, 0.3, rise); box((sw / 2 + tw) / 2 + 0.12, tz0, (tw - sw / 2) / 2, 0.3, rise);
  inFrame(B, [0, 0, sz0 + 0.9], 0, () => { for (const [px, pz] of torii(B, M, { span: 3.2, h: 3.9, col: [0.66, 0.64, 0.6], top: [0.5, 0.49, 0.46] })) circ(px, sz0 + 0.9 + pz, 0.25); });
  const F0 = B.F; B.frame(F0.x, F0.y + rise, F0.z, F0.r);
  const H = haiden(B, M, 0, -26, 0, { w: 8, d: 6 }); box(0, -26, 5, 4, 8);
  honden(B, M, 0, -33.4, 0, { w: 3.6, d: 3.2 }); tamagaki(B, M, 0, -33.4, 7.2, 6.4); box(0, -33.4, 3.6, 3.2, 8);
  for (const s of [-1, 1]) { lamps.push(toro(B, M, s * 5.6, -23.4, 0.9)); }
  B.frame(F0.x, F0.y, F0.z, F0.r);
  emaRack(B, M, -5.2, -17.5, Math.PI / 2, rng); box(-5.2, -17.5, 0.3, 1.1, 2.5);
  omikuji(B, M, -5.2, -13.2, Math.PI / 2, rng); box(-5.2, -13.2, 0.2, 1.2, 2);
  // shrine office (shamusho): white walls on a timber base, a counter window onto the approach
  inFrame(B, [-8.2, 0, -7.5], Math.PI / 2, () => {
    const W = 5.2, D = 3.6, Hh = 2.6;
    B.bbox(M.stone, 0, 0, 0, W + 0.3, 0.3, D + 0.3, 0.02, { color: STONE });
    const faces = [[0, D / 2, W], [Math.PI, D / 2, W], [Math.PI / 2, W / 2, D], [-Math.PI / 2, W / 2, D]];
    faces.forEach(([fr, off, fw], fi) => inFrame(B, [Math.sin(fr) * off, 0, Math.cos(fr) * off], fr, () => {
      const holes = fi === 0 ? [{ x0: -1.6, x1: 0.4, y0: 1.0, y1: 1.9, d: 0.12 }, { x0: 1.0, x1: 1.9, y0: 0.3, y1: 2.2, d: 0.12, noSill: true }] : fi === 1 ? [{ x0: -0.5, x1: 0.5, y0: 1.2, y1: 1.9, d: 0.12 }] : [];
      wallFill(B, M.wood, -fw / 2, fw / 2, 0.3, 1.0, holes, mul(OLDWOOD, 0.9), 2); wallFill(B, M.paper, -fw / 2, fw / 2, 1.0, Hh, holes, WHITE, 3);
      for (const h of holes) { reveals(B, M.paper, h, WHITE); if (h.noSill) doorUnit(B, h, { color: mul(OLDWOOD, 1.1), mat: M.wood, lattice: true, frame: mul(OLDWOOD, 0.7), trim: mul(OLDWOOD, 0.7) }); else windowUnit(B, h, { rng, frame: mul(OLDWOOD, 0.7), frameMat: M.wood, lattice: fi === 1, glass: fi === 0 ? [1, 0.9, 0.72] : undefined }); }
      B.bbox(M.wood, 0, 0.95, 0.02, fw + 0.04, 0.06, 0.05, 0.006, { color: mul(OLDWOOD, 0.6) });
    }));
    B.bbox(M.wood, -0.6, 0.95, D / 2 + 0.25, 2.2, 0.06, 0.5, 0.01, { color: mul(OLDWOOD, 1.05) }); // counter shelf
    gableRoof(B, { w: W, d: D, y: Hh, pitch: 0.5, over: 0.7, mat: M.roof, color: [0.34, 0.36, 0.4], wallMat: M.paper, wallColor: WHITE, gutters: true });
    box(0, 0, W / 2 + 0.2, D / 2 + 0.2);
  });
  // banners (nobori) along the approach
  for (const zz of [1.5, -6.5, -13.5]) for (const s of [-1, 1]) {
    const px = s * 1.75; B.cyl(M.wood, px, 0, zz, 0.03, 0.03, 4.2, 6, { color: [0.85, 0.8, 0.7], cap: true });
    B.quad(M.paper, [px, 1.2, zz - 0.02], [px, 1.2, zz + 0.62], [px, 4.0, zz + 0.62], [px, 4.0, zz - 0.02], { color: s < 0 ? [0.92, 0.22, 0.16] : WHITE });
    B.quad(M.paper, [px - 0.004, 1.2, zz + 0.62], [px - 0.004, 1.2, zz - 0.02], [px - 0.004, 4.0, zz - 0.02], [px - 0.004, 4.0, zz + 0.62], { color: s < 0 ? [0.8, 0.18, 0.14] : [0.86, 0.85, 0.8] });
  }
  return { lamps, tree: B.P([6.8, 0, -19.2]), top: H.top };
}
// the small Wildlands shrine: torii with a rope, a raised hokora with chigi, two lanterns, an offering box
export function wildShrine(B, M, x, y, z, r) {
  B.frame(x, y, z, r);
  const cols = torii(B, M, { span: 3.6, h: 4.5, rope: true });
  for (let k = 0; k < 7; k++) B.bbox(M.stone, (k % 2 - 0.5) * 0.15, -0.08, 2 - k * 1.2, 1.1, 0.14, 0.8, 0.02, { color: STONE });
  honden(B, M, 0, -6.2, 0, { w: 1.7, d: 1.5 });
  const lamps = [toro(B, M, -1.9, -3.2, 0.9), toro(B, M, 1.9, -3.2, 0.9)];
  offeringBox(B, M, 0, -3.9, 0.9);
  return { cols: cols.map(([px, pz]) => B.P([px, 0, pz])), lamps, hall: B.P([0, 0, -6.2]) };
}
