// Building kit for Sakuragawa. Facades are built as real walls with openings: every window and door sits in a reveal,
// its frame and glass recessed into the wall, with a sill that projects and drips; roofs have thickness, fascia and
// barge boards, soffits, ridge / hip caps or standing seams, and carry gutters that drain through downpipes to the
// ground. Around them: foundations with vents, corner boards, band courses, and the service clutter of a lived-in
// Japanese street (AC units with pipe ducts, meters, vent hoods, water heaters, nameplates, intercoms, gate pillars).
// All of it goes through GeoBuilder frames; in a wall frame X runs along the wall, Y up, +Z out of the face (z = 0).
import { scene, clamp, lerp, mulberry32 } from './core.js';
import { lampPoints, chochin, signMesh, shopSign, verticalSign, SHOP_NAMES, SHOP_INTERIOR, WALL_TINTS } from './townkit.js';
import { cropSet } from './crops.js';
import { placeable, atXYZR, atObj, atLocal } from './world/capture.js';

const pick = (rng, a) => a[Math.floor(rng() * a.length)];
const jitter = (rng, c, a = 0.04) => c.map(v => clamp(v + (rng() - 0.5) * a, 0, 1));
const mul = (c, k) => c.map(v => v * k);
const TAU = Math.PI * 2;
const circle = (r, n = 8, a0 = 0) => Array.from({ length: n }, (_, i) => [Math.cos(a0 + i / n * TAU) * r, Math.sin(a0 + i / n * TAU) * r]);
// run fn in a sub-frame at local point p, turned by dr
export function inFrame(B, p, dr, fn) { const F = B.F; B.frame(...B.P(p), F.r + dr); const out = fn(); B.F = F; return out; }
const deco = mulberry32(9091);

// ---------------------------------------------------------------- walls with openings
// fill the wall rectangle [x0,x1] x [y0,y1] around rectangular holes (texture continuous across the pieces)
export function wallFill(B, mat, x0, x1, y0, y1, holes, color, uv = 3) {
  const xs = [x0, x1];
  const hs = holes.filter(h => h.x1 > x0 && h.x0 < x1 && h.y1 > y0 && h.y0 < y1);
  for (const h of hs) xs.push(clamp(h.x0, x0, x1), clamp(h.x1, x0, x1));
  xs.sort((a, b) => a - b);
  const q = (a, b, c, d) => B.quad(mat, [a, c, 0], [b, c, 0], [b, d, 0], [a, d, 0], { color, uvs: [[a / uv, c / uv], [b / uv, c / uv], [b / uv, d / uv], [a / uv, d / uv]] });
  for (let i = 0; i + 1 < xs.length; i++) {
    const a = xs[i], b = xs[i + 1]; if (b - a < 1e-3) continue;
    const cov = hs.filter(h => h.x0 <= a + 1e-3 && h.x1 >= b - 1e-3).map(h => [Math.max(y0, h.y0), Math.min(y1, h.y1)]).filter(r => r[1] > r[0] + 1e-3).sort((p, r) => p[0] - r[0]);
    let y = y0;
    for (const [c, d] of cov) { if (c > y + 1e-3) q(a, b, y, c); y = Math.max(y, d); }
    if (y1 > y + 1e-3) q(a, b, y, y1);
  }
}
// the four inner faces of an opening (d deep)
export function reveals(B, mat, h, color, uv = 1.5) {
  const d = h.d, o = (pts, hint) => B.poly(mat, pts, hint, { color, uv });
  o([[h.x0, h.y0, 0], [h.x0, h.y0, -d], [h.x0, h.y1, -d], [h.x0, h.y1, 0]], [1, 0, 0]);
  o([[h.x1, h.y0, -d], [h.x1, h.y0, 0], [h.x1, h.y1, 0], [h.x1, h.y1, -d]], [-1, 0, 0]);
  o([[h.x0, h.y1, 0], [h.x0, h.y1, -d], [h.x1, h.y1, -d], [h.x1, h.y1, 0]], [0, -1, 0]);
  o([[h.x0, h.y0, 0], [h.x1, h.y0, 0], [h.x1, h.y0, -d], [h.x0, h.y0, -d]], [0, 1, 0]);
}

// window set into an opening h {x0,x1,y0,y1,d}: glass (interior-mapped rooms) 3.5 cm behind a 45 mm aluminium frame,
// sliding sashes with offset meeting stiles, a projecting sill; optional roll-shutter box and guides, security grille,
// wooden lattice, hood, frosted glass, part-drawn shutter
export function windowUnit(B, h, o) {
  const rng = o.rng, w = h.x1 - h.x0, H = h.y1 - h.y0, cx = (h.x0 + h.x1) / 2, d = h.d, fc = o.frame || [0.8, 0.82, 0.84], fm = o.frameMat || 'alu';
  if (!(w > 0.05 && w < 40 && H > 0.05 && H < 40)) return; // degenerate opening (a sliver left between two others)
  const zg = -d + 0.035, lit = o.lit ?? rng() < 0.45;
  if (o.frosted) B.quad('plastic', [h.x0, h.y0, zg], [h.x1, h.y0, zg], [h.x1, h.y1, zg], [h.x0, h.y1, zg], { color: [0.78, 0.83, 0.86] });
  else B.quad(o.glassMat || 'window', [h.x0, h.y0, zg], [h.x1, h.y0, zg], [h.x1, h.y1, zg], [h.x0, h.y1, zg],
    { color: o.glass || (lit ? jitter(rng, rng() < 0.7 ? [1, 0.85, 0.6] : [0.85, 0.92, 1], 0.1) : [1, 1, 1]), uvs: [[0, 0], [1, 0], [1, 1], [0, 1]] });
  const f = o.f || 0.045, fd = 0.065, zc = -d + fd / 2 + 0.005;
  const bar = (x, y, bw, bh, z = zc, dd = fd) => B.detail(1, () => B.bbox(fm, x, y, z, bw, bh, dd, 0.006, { color: fc }));
  bar(cx, h.y0, w, f); bar(cx, h.y1 - f, w, f); bar(h.x0 + f / 2, h.y0 + f, f, H - 2 * f); bar(h.x1 - f / 2, h.y0 + f, f, H - 2 * f);
  const type = o.type || (w > 0.75 ? 'slide' : 'fixed');
  if (type === 'slide') { // two sashes: the meeting stiles overlap, one sash a runner in front of the other
    const n = w > 2.2 ? 4 : 2;
    for (let k = 1; k < n; k++) { const x = h.x0 + w * k / n; bar(x - 0.017, h.y0 + f, 0.034, H - 2 * f, zc + (k % 2 ? 0.014 : -0.014), 0.028); bar(x + 0.017, h.y0 + f, 0.034, H - 2 * f, zc + (k % 2 ? -0.014 : 0.014), 0.028); }
  } else if (type === 'grid') {
    for (let k = 1; k < 3; k++) bar(h.x0 + w * k / 3, h.y0 + f, 0.03, H - 2 * f, zc, 0.03);
    bar(cx, h.y0 + H * 0.62, w - 2 * f, 0.03, zc, 0.03);
  }
  if (o.transom && H > 1.5) bar(cx, h.y1 - f - 0.42, w - 2 * f, 0.04, zc, 0.05);
  if (o.sill !== false) B.detail(1, () => { // sill: sits in the reveal and projects 6 cm with a drip lip
    const sm = o.sillMat || fm, sc = o.sillColor || fc;
    B.bbox(sm, cx, h.y0 - 0.032, (-d + 0.06) / 2 + 0.005, w + 0.09, 0.036, d + 0.05, 0.008, { color: sc });
    B.box(sm, cx, h.y0 - 0.05, 0.057, w + 0.09, 0.02, 0.012, { color: mul(sc, 0.8) });
  });
  if (o.shutterBox) { // roll shutter: box over the opening, guide rails down the jambs, sometimes half down
    B.bbox('alu', cx, h.y1 + 0.02, 0.1, w + 0.22, 0.25, 0.2, 0.012, { color: o.shutterColor || [0.76, 0.75, 0.72] });
    for (const x of [h.x0 - 0.035, h.x1 + 0.035]) B.bbox('alu', x, h.y0, 0.035, 0.05, H + 0.03, 0.07, 0.006, { color: o.shutterColor || [0.76, 0.75, 0.72] });
    if (o.shutter > 0) {
      const yb = h.y1 - H * o.shutter;
      B.quad('shutter', [h.x0 - 0.02, yb, 0.03], [h.x1 + 0.02, yb, 0.03], [h.x1 + 0.02, h.y1 + 0.02, 0.03], [h.x0 - 0.02, h.y1 + 0.02, 0.03], { color: o.shutterColor || [0.76, 0.75, 0.72], uv: 1 });
      B.bbox('alu', cx, yb - 0.04, 0.035, w + 0.04, 0.045, 0.05, 0.006, { color: mul(o.shutterColor || [0.76, 0.75, 0.72], 0.85) });
    }
  }
  if (o.grille) B.detail(1, () => { // 面格子: security grille in front of bathroom / toilet windows
    const gz = 0.075, gc = o.grilleColor || fc;
    for (const y of [h.y0 + 0.02, h.y1 - 0.04]) B.box('alu', cx, y, gz, w + 0.1, 0.03, 0.03, { color: gc });
    for (let i = 0, n = Math.max(3, Math.round(w / 0.1)); i <= n; i++) B.box('alu', h.x0 - 0.03 + (w + 0.06) * i / n, h.y0 + 0.02, gz, 0.018, H - 0.02, 0.018, { color: gc });
    for (const x of [h.x0 - 0.04, h.x1 + 0.04]) for (const y of [h.y0 + 0.03, h.y1 - 0.03]) B.box('alu', x, y - 0.02, 0.04, 0.03, 0.04, 0.07, { color: gc });
  });
  if (o.lattice) B.detail(1, () => { const n = Math.round(w / 0.1); for (let i = 1; i < n; i++) B.box('wood', h.x0 + i * w / n, h.y0, -0.01, 0.028, H, 0.035, { color: [0.4, 0.28, 0.2] }); });
  if (o.hood) { // small sloped hood (hisashi) with thickness and a fascia lip
    const hy = h.y1 + (o.shutterBox ? 0.34 : 0.16), hd = 0.42, hw = w / 2 + 0.2;
    B.quad('roofMetal', [cx - hw, hy, hd], [cx + hw, hy, hd], [cx + hw, hy + 0.14, 0], [cx - hw, hy + 0.14, 0], { color: o.hood });
    B.quad('plain', [cx + hw, hy - 0.035, hd], [cx - hw, hy - 0.035, hd], [cx - hw, hy + 0.105, 0], [cx + hw, hy + 0.105, 0], { color: [0.9, 0.88, 0.84] });
    B.box('plain', cx, hy - 0.06, hd, hw * 2, 0.075, 0.025, { color: mul(o.hood, 0.75) });
    for (const sx of [-1, 1]) B.poly('plain', [[cx + sx * hw, hy - 0.035, hd], [cx + sx * hw, hy + 0.14, 0], [cx + sx * hw, hy - 0.035, 0]], [sx, 0, 0], { color: mul(o.hood, 0.8) });
  }
}
// door in an opening (y0 = floor): leaf recessed in a frame, architrave on the wall, handle, glazed slit or side light
export function doorUnit(B, h, o) {
  const w = h.x1 - h.x0, H = h.y1 - h.y0, cx = (h.x0 + h.x1) / 2, d = h.d, fc = o.frame || [0.35, 0.33, 0.32];
  const zl = -d + 0.06, side = w > 1.25 ? Math.min(0.4, w - 0.95) : 0, lw = w - side - 0.08, lx = h.x0 + 0.04 + lw / 2 + (o.sideLeft ? side : 0);
  for (const [x, bw] of [[h.x0 + 0.025, 0.05], [h.x1 - 0.025, 0.05]]) B.bbox('alu', x, h.y0, zl, bw, H, 0.09, 0.006, { color: fc });
  B.bbox('alu', cx, h.y1 - 0.05, zl, w, 0.05, 0.09, 0.006, { color: fc });
  if (o.lattice) { // sliding lattice door (traditional)
    B.bbox('wood', lx, h.y0 + 0.02, zl, lw, H - 0.08, 0.04, 0.006, { color: o.color });
    for (let i = 1; i < 9; i++) B.box('wood', lx - lw / 2 + i * lw / 9, h.y0 + 0.1, zl + 0.022, 0.022, H - 0.25, 0.012, { color: mul(o.color, 0.6) });
    B.quad('plastic', [lx - lw / 2 + 0.05, h.y0 + 0.1, zl + 0.021], [lx + lw / 2 - 0.05, h.y0 + 0.1, zl + 0.021], [lx + lw / 2 - 0.05, h.y1 - 0.15, zl + 0.021], [lx - lw / 2 + 0.05, h.y1 - 0.15, zl + 0.021], { color: [0.94, 0.92, 0.84] });
  } else {
    B.bbox(o.mat || 'plain', lx, h.y0 + 0.02, zl, lw, H - 0.08, 0.045, 0.008, { color: o.color });
    if (o.panel) for (const y of [0.25, 1.05]) B.bbox(o.mat || 'plain', lx, h.y0 + y, zl + 0.03, lw - 0.2, 0.62, 0.02, 0.006, { color: mul(o.color, 0.92) });
    if (o.slit) B.quad('window', [lx - lw / 2 + 0.12, h.y0 + 0.5, zl + 0.024], [lx - lw / 2 + 0.22, h.y0 + 0.5, zl + 0.024], [lx - lw / 2 + 0.22, h.y1 - 0.3, zl + 0.024], [lx - lw / 2 + 0.12, h.y1 - 0.3, zl + 0.024], { color: [1, 0.86, 0.66], uvs: [[0, 0], [1, 0], [1, 1], [0, 1]] });
    const hx = lx + (o.sideLeft ? -1 : 1) * (lw / 2 - 0.09);
    B.detail(2, () => { B.bbox('steel', hx, h.y0 + 0.82, zl + 0.04, 0.035, 0.3, 0.02, 0.005, { color: [0.72, 0.72, 0.7] });
      B.box('steel', hx - (o.sideLeft ? -1 : 1) * 0.06, h.y0 + 0.97, zl + 0.07, 0.14, 0.022, 0.022, { color: [0.75, 0.75, 0.72] }); });
  }
  if (side > 0) { const sx = o.sideLeft ? h.x0 + 0.04 + side / 2 : h.x1 - 0.04 - side / 2;
    B.quad('plastic', [sx - side / 2 + 0.03, h.y0 + 0.1, zl], [sx + side / 2 - 0.03, h.y0 + 0.1, zl], [sx + side / 2 - 0.03, h.y1 - 0.12, zl], [sx - side / 2 + 0.03, h.y1 - 0.12, zl], { color: [0.84, 0.88, 0.9] });
    B.bbox('alu', sx - side / 2, h.y0, zl, 0.04, H, 0.08, 0.005, { color: fc }); }
  // architrave around the opening on the wall face
  const ac = o.trim || [0.93, 0.92, 0.9];
  B.bbox('plain', h.x0 - 0.035, h.y0, 0.012, 0.07, H + 0.07, 0.024, 0.006, { color: ac });
  B.bbox('plain', h.x1 + 0.035, h.y0, 0.012, 0.07, H + 0.07, 0.024, 0.006, { color: ac });
  B.bbox('plain', cx, h.y1, 0.012, w + 0.14, 0.07, 0.024, 0.006, { color: ac });
  B.bbox('concrete', cx, h.y0 - 0.02, -d / 2 + 0.03, w + 0.02, 0.03, d + 0.06, 0.006, { color: [0.62, 0.62, 0.6] }); // threshold
}

// ---------------------------------------------------------------- rainwater goods
const GUTTER_PROFILE = (() => { const R = 0.065, t = 0.008, out = [], inn = [];
  for (let i = 0; i <= 8; i++) { const a = Math.PI + i / 8 * Math.PI; out.push([Math.cos(a) * R, Math.sin(a) * R]); inn.push([Math.cos(a) * (R - t), Math.sin(a) * (R - t)]); }
  return [...out, ...inn.reverse()]; })();
// half-round gutter along a horizontal run (local points), with end caps
export function gutter(B, a, b, color) { B.detail(1, () => gutter0(B, a, b, color)); }
function gutter0(B, a, b, color) {
  B.sweep('alu', GUTTER_PROFILE, [a, b], { closed: true, color, uv: 1 });
  const L = Math.hypot(b[0] - a[0], b[2] - a[2]), dx = (b[0] - a[0]) / L, dz = (b[2] - a[2]) / L;
  for (const [p, s] of [[a, -1], [b, 1]]) {
    const pts = []; for (let i = 0; i <= 8; i++) { const an = Math.PI + i / 8 * Math.PI; pts.push([p[0] - dz * Math.cos(an) * 0.065, p[1] + Math.sin(an) * 0.065, p[2] + dx * Math.cos(an) * 0.065]); }
    for (let i = 0; i < 8; i++) B.poly('alu', [p, pts[i], pts[i + 1]], [dx * s, 0, dz * s], { color });
  }
}
// round downpipe from a gutter outlet (top, outside the fascia) back to the wall and down to the ground
export function downpipe(B, top, wall, y0, color) { B.detail(1, () => downpipe0(B, top, wall, y0, color)); }
function downpipe0(B, top, wall, y0, color) {
  const r = 0.035, prof = circle(r, 8);
  const p1 = [top[0], top[1] - 0.12, top[2]], p2 = [wall[0], top[1] - 0.42, wall[2]], p3 = [wall[0], y0 + 0.22, wall[2]];
  B.sweep('alu', prof, [top, p1, p2, p3], { closed: true, color, uv: 1 });
  const out = [(wall[0] - top[0]), 0, (wall[2] - top[2])], ol = Math.hypot(out[0], out[2]) || 1;
  B.sweep('alu', prof, [p3, [wall[0] - out[0] / ol * 0.14, y0 + 0.06, wall[2] - out[2] / ol * 0.14]], { closed: true, color, uv: 1 }); // shoe
  B.detail(2, () => { for (let y = y0 + 0.6; y < top[1] - 0.6; y += 1.3) B.box('alu', wall[0], y, wall[2], 0.09, 0.03, 0.09, { color: mul(color, 0.85) }); });   // brackets
  B.cyl('concrete', wall[0] - out[0] / ol * 0.2, y0 - 0.02, wall[2] - out[2] / ol * 0.2, 0.13, 0.13, 0.06, 10, { color: [0.6, 0.6, 0.58], cap: true }); // drain basin
}

// ---------------------------------------------------------------- roofs
const SOFFIT = [0.9, 0.88, 0.84];
function ridgeCap(B, mat, a, b, color, metal) {
  if (metal) { const L = Math.hypot(b[0] - a[0], b[2] - a[2]); void L; B.sweep(mat, [[-0.13, -0.04], [0, 0.035], [0.13, -0.04], [0, 0.0]], [a, b], { closed: true, color, uv: 1 }); }
  else B.sweep(mat, circle(0.11, 8), [a, b], { closed: true, color, uv: 0.6 });
}
// Japanese tile roofs: the rows of round-topped tiles running down the slope, as low triangular ribs, so tiled roofs
// have a corrugated silhouette at eaves and verges instead of reading as a flat textured plane. rib(x) -> [eave, top]
function tileRows(B, mat, color, xs, rib, s) {
  B.detail(1, () => {
    const c = mul(color, 0.95), cc = mul(color, 0.8);
    for (const x of xs) {
      const e = rib(x); if (!e) continue; const [a, b] = e;
      B.poly(mat, [[x - 0.08, a[1], a[2]], [x - 0.08, b[1], b[2]], [x, b[1] + 0.055, b[2]], [x, a[1] + 0.055, a[2]]], [-1, 2, 0], { color: c, uv: 0.5 });
      B.poly(mat, [[x, a[1] + 0.055, a[2]], [x, b[1] + 0.055, b[2]], [x + 0.08, b[1], b[2]], [x + 0.08, a[1], a[2]]], [1, 2, 0], { color: c, uv: 0.5 });
      B.poly(mat, [[x - 0.08, a[1], a[2]], [x + 0.08, a[1], a[2]], [x, a[1] + 0.055, a[2]]], [0, 0, s], { color: cc });
    }
  });
}
// gable roof in a roof frame: ridge along X at z = 0, walls w (x) by d (z) with tops at y; the underside meets the
// wall tops, eaves overhang by `over`, rakes by `rake`
export function gableRoof(B, o) {
  const { w, d, y, pitch, over, mat, color } = o, rake = o.rake ?? over * 0.75, t = o.t ?? 0.13, metal = mat === 'roofMetal';
  const k = Math.tan(pitch), tv = t / Math.cos(pitch), yR = y + tv + k * d / 2, x1 = w / 2 + rake, z1 = d / 2 + over, ye = yR - k * z1;
  const fasc = o.fascia || mul(color, 0.62), uvo = { color, uv: 2 };
  for (const s of [1, -1]) {
    B.poly(mat, [[-x1, ye, s * z1], [x1, ye, s * z1], [x1, yR, 0], [-x1, yR, 0]], [0, 1, s * k], uvo);
    B.poly('plain', [[-x1, ye - tv, s * z1], [x1, ye - tv, s * z1], [x1, y, s * d / 2], [-x1, y, s * d / 2]], [0, -1, 0], { color: SOFFIT });
    for (const e of [-1, 1]) B.poly('plain', [[e * w / 2, y, s * d / 2], [e * x1, y, s * d / 2], [e * x1, yR - tv, 0], [e * w / 2, yR - tv, 0]], [0, -1, 0], { color: SOFFIT });
    B.bbox('plain', 0, ye - tv - 0.07, s * (z1 + 0.014), 2 * x1 + 0.06, tv + 0.1, 0.028, 0.006, { color: fasc });       // fascia
    for (const e of [-1, 1]) B.beam('plain', [e * (x1 + 0.016), ye - tv / 2 + 0.01, s * (z1 + 0.03)], [e * (x1 + 0.016), yR - tv / 2 + 0.01, 0], 0.032, tv + 0.13, { color: fasc }); // barge boards
    B.detail(1, () => { if (metal) for (let x = -x1 + 0.22; x < x1 - 0.1; x += 0.455) B.beam(mat, [x, ye + 0.012, s * z1], [x, yR - 0.01, 0], 0.022, 0.03, { color: mul(color, 0.92) }); // standing seams
      else B.sweep(mat, circle(0.05, 6), [[-x1, ye + 0.02, s * (z1 - 0.03)], [x1, ye + 0.02, s * (z1 - 0.03)]], { closed: true, color: mul(color, 0.9), uv: 0.6 }); }); // eave tile roll
    if (!metal && mat === 'roofTile') { const xs = []; for (let x = -x1 + 0.2; x < x1 - 0.1; x += 0.3) xs.push(x); tileRows(B, mat, color, xs, x => [[x, ye + 0.004, s * (z1 - 0.02)], [x, yR - 0.03, s * 0.05]], s); }
    if (o.gutters !== false) {
      const gy = ye - tv - 0.05, gz = s * (z1 + 0.1);
      gutter(B, [-x1 + 0.05, gy, gz], [x1 - 0.05, gy, gz], o.gutterColor || [0.78, 0.78, 0.76]);
      const e = (o.pipeSide ?? 1) * s;
      downpipe(B, [e * (x1 - 0.25), gy - 0.03, gz], [e * (w / 2 - 0.14), 0, s * (d / 2 + 0.07)], o.ground ?? 0, o.gutterColor || [0.78, 0.78, 0.76]);
    }
  }
  for (const e of [-1, 1]) B.poly(o.wallMat || 'plain', [[e * w / 2, y, e * d / 2], [e * w / 2, y, -e * d / 2], [e * w / 2, yR - tv, 0]], [e, 0, 0], { color: o.wallColor || [0.9, 0.9, 0.88], uv: o.wallUv || 2.2 });
  ridgeCap(B, mat, [-x1 - 0.03, yR - 0.015, 0], [x1 + 0.03, yR - 0.015, 0], mul(color, 0.82), metal);
  if (!metal) for (const e of [-1, 1]) B.bbox(mat, e * (x1 + 0.02), yR - 0.12, 0, 0.1, 0.3, 0.3, 0.03, { color: mul(color, 0.75) }); // onigawara
  return { yR, ye, tv };
}
// hip roof (w >= d): four planes, level eaves all round, hip caps, fascia and gutters on every side
export function hipRoof(B, o) {
  const { w, d, y, pitch, over, mat, color } = o, t = o.t ?? 0.13, metal = mat === 'roofMetal';
  const k = Math.tan(pitch), tv = t / Math.cos(pitch), hw = w / 2 + over, hd = d / 2 + over, ye = y + tv - k * over, yR = ye + k * hd, r = Math.max(0, hw - hd);
  const fasc = o.fascia || mul(color, 0.62), uvo = { color, uv: 2 };
  for (const s of [1, -1]) {
    B.poly(mat, [[-hw, ye, s * hd], [hw, ye, s * hd], [r, yR, 0], [-r, yR, 0]], [0, 1, s * k], uvo);
    B.poly(mat, [[s * hw, ye, hd], [s * hw, ye, -hd], [s * r, yR, 0]], [s * k, 1, 0], uvo);
    B.poly('plain', [[-hw, ye - tv, s * hd], [hw, ye - tv, s * hd], [w / 2, y, s * d / 2], [-w / 2, y, s * d / 2]], [0, -1, 0], { color: SOFFIT });
    B.poly('plain', [[s * hw, ye - tv, hd], [s * hw, ye - tv, -hd], [s * w / 2, y, -d / 2], [s * w / 2, y, d / 2]], [0, -1, 0], { color: SOFFIT });
    B.bbox('plain', 0, ye - tv - 0.07, s * (hd + 0.014), 2 * hw + 0.056, tv + 0.1, 0.028, 0.006, { color: fasc });
    B.bbox('plain', s * (hw + 0.014), ye - tv - 0.07, 0, 0.028, tv + 0.1, 2 * hd + 0.056, 0.006, { color: fasc });
    for (const e of [-1, 1]) {
      if (metal) B.beam(mat, [s * hw, ye + 0.02, e * hd], [s * r, yR + 0.01, 0], 0.16, 0.04, { color: mul(color, 0.85) });
      else B.sweep(mat, circle(0.1, 8), [[s * hw, ye + 0.03, e * hd], [s * r, yR - 0.01, 0]], { closed: true, color: mul(color, 0.82), uv: 0.6 });
    }
    if (metal) for (let x = -hw + 0.3; x < hw - 0.2; x += 0.455) {
      const zTop = Math.abs(x) <= r ? 0 : hd * (Math.abs(x) - r) / (hw - r || 1); if (hd - zTop < 0.3) continue;
      B.beam(mat, [x, ye + 0.012, s * hd], [x, ye + k * (hd - zTop) - 0.01, s * zTop], 0.022, 0.03, { color: mul(color, 0.92) }); }
    else if (mat === 'roofTile') { const xs = []; for (let x = -hw + 0.35; x < hw - 0.3; x += 0.3) xs.push(x);
      tileRows(B, mat, color, xs, x => { const zTop = Math.abs(x) <= r ? 0.05 : hd * (Math.abs(x) - r) / (hw - r || 1) + 0.12; return hd - zTop < 0.35 ? null : [[x, ye + 0.004, s * (hd - 0.02)], [x, ye + k * (hd - zTop) - 0.02, s * zTop]]; }, s); }
    if (o.gutters !== false) {
      const gy = ye - tv - 0.05, gc = o.gutterColor || [0.78, 0.78, 0.76];
      gutter(B, [-hw - 0.05, gy, s * (hd + 0.1)], [hw + 0.05, gy, s * (hd + 0.1)], gc);
      gutter(B, [s * (hw + 0.1), gy, -hd - 0.05], [s * (hw + 0.1), gy, hd + 0.05], gc);
      downpipe(B, [s * (hw - 0.2), gy - 0.03, s * (hd + 0.1)], [s * (w / 2 - 0.14), 0, s * (d / 2 + 0.07)], o.ground ?? 0, gc);
    }
  }
  if (r > 0.05) ridgeCap(B, mat, [-r - 0.05, yR - 0.015, 0], [r + 0.05, yR - 0.015, 0], mul(color, 0.82), metal);
  return { yR, ye, tv };
}
// single-pitch roof: low eave at +z (the front wall's top y), rising to the back; returns the underside height at z
export function shedRoof(B, o) {
  const { w, d, y, pitch, over, mat, color } = o, rake = o.rake ?? over * 0.6, t = o.t ?? 0.12, metal = mat === 'roofMetal';
  const k = Math.tan(pitch), tv = t / Math.cos(pitch), x1 = w / 2 + rake, z1 = d / 2 + over, z0 = -d / 2 - over;
  const yU = zz => y + k * (d / 2 - zz), yT = zz => yU(zz) + tv, fasc = o.fascia || mul(color, 0.62);
  B.poly(mat, [[-x1, yT(z1), z1], [x1, yT(z1), z1], [x1, yT(z0), z0], [-x1, yT(z0), z0]], [0, 1, k], { color, uv: 2 });
  B.poly('plain', [[-x1, yU(z1), z1], [x1, yU(z1), z1], [x1, yU(d / 2), d / 2], [-x1, yU(d / 2), d / 2]], [0, -1, 0], { color: SOFFIT });
  B.poly('plain', [[-x1, yU(-d / 2), -d / 2], [x1, yU(-d / 2), -d / 2], [x1, yU(z0), z0], [-x1, yU(z0), z0]], [0, -1, 0], { color: SOFFIT });
  for (const e of [-1, 1]) B.poly('plain', [[e * w / 2, yU(d / 2), d / 2], [e * x1, yU(d / 2), d / 2], [e * x1, yU(-d / 2), -d / 2], [e * w / 2, yU(-d / 2), -d / 2]], [0, -1, 0], { color: SOFFIT });
  B.bbox('plain', 0, yU(z1) - 0.07, z1 + 0.014, 2 * x1 + 0.06, tv + 0.1, 0.028, 0.006, { color: fasc });
  B.bbox('plain', 0, yU(z0) - 0.07, z0 - 0.014, 2 * x1 + 0.06, tv + 0.12, 0.028, 0.006, { color: fasc });
  for (const e of [-1, 1]) B.beam('plain', [e * (x1 + 0.016), yU(z1) + tv / 2 + 0.01, z1 + 0.03], [e * (x1 + 0.016), yU(z0) + tv / 2 + 0.01, z0 - 0.03], 0.032, tv + 0.13, { color: fasc });
  if (metal) for (let x = -x1 + 0.22; x < x1 - 0.1; x += 0.455) B.beam(mat, [x, yT(z1) + 0.012, z1], [x, yT(z0) + 0.012, z0], 0.022, 0.03, { color: mul(color, 0.92) });
  B.beam(mat, [-x1, yT(z0) + 0.02, z0 + 0.06], [x1, yT(z0) + 0.02, z0 + 0.06], 0.14, 0.04, { color: mul(color, 0.85) }); // top flashing
  if (o.gutters !== false) {
    const gy = yU(z1) - 0.05, gz = z1 + 0.1, gc = o.gutterColor || [0.78, 0.78, 0.76], e = o.pipeSide ?? 1;
    gutter(B, [-x1 + 0.05, gy, gz], [x1 - 0.05, gy, gz], gc);
    downpipe(B, [e * (x1 - 0.25), gy - 0.03, gz], [e * (w / 2 - 0.14), 0, d / 2 + 0.07], o.ground ?? 0, gc);
  }
  return { yU, yT };
}
// flat roof inside a parapet: inner parapet faces, coping all round, membrane, drains
export function flatRoof(B, o) {
  const { w, d, y, para = 0.5, color } = o, cc = o.coping || [0.72, 0.72, 0.7], ty = y + para, t = 0.16;
  for (const s of [1, -1]) {
    B.poly(o.wallMat || 'concrete', [[-w / 2 + t, y, s * (d / 2 - t)], [w / 2 - t, y, s * (d / 2 - t)], [w / 2 - t, ty, s * (d / 2 - t)], [-w / 2 + t, ty, s * (d / 2 - t)]], [0, 0, -s], { color: mul(color, 0.92), uv: 3 });
    B.poly(o.wallMat || 'concrete', [[s * (w / 2 - t), y, -d / 2 + t], [s * (w / 2 - t), y, d / 2 - t], [s * (w / 2 - t), ty, d / 2 - t], [s * (w / 2 - t), ty, -d / 2 + t]], [-s, 0, 0], { color: mul(color, 0.92), uv: 3 });
    B.bbox('concrete', 0, ty, s * (d / 2 - t / 2 + 0.02), w + 0.06, 0.07, t + 0.1, 0.012, { color: cc });
    B.bbox('concrete', s * (w / 2 - t / 2 + 0.02), ty, 0, t + 0.1, 0.07, d - 2 * t, 0.012, { color: cc });
  }
  B.quad('concrete', [-w / 2 + t, y + 0.03, d / 2 - t], [w / 2 - t, y + 0.03, d / 2 - t], [w / 2 - t, y + 0.03, -d / 2 + t], [-w / 2 + t, y + 0.03, -d / 2 + t], { color: o.membrane || [0.55, 0.57, 0.58], uv: 3 });
  for (const s of [-1, 1]) B.cyl('dark', s * (w / 2 - t - 0.25), y + 0.03, -d / 2 + t + 0.25, 0.08, 0.08, 0.012, 8, { cap: true });
  return ty + 0.07;
}

// ---------------------------------------------------------------- service details (wall frame, ground at y = g)
export function acUnit(B, x, g, rng, opt = {}) { B.detail(1, () => acUnit0(B, x, g, rng, opt)); }
function acUnit0(B, x, g, rng, { pipeTo = 2.4, onWall = false, z = 0.22 } = {}) {
  const y = onWall ? g : g + 0.1, c = [0.93, 0.93, 0.9];
  B.bbox('plain', x, y, z, 0.8, 0.56, 0.28, 0.025, { color: c });
  const cx = x - 0.12, cy = y + 0.28, zf = z + 0.141, R = 0.21;
  for (let i = 0; i < 14; i++) { const a0 = i / 14 * TAU, a1 = (i + 1) / 14 * TAU; B.poly('dark', [[cx, cy, zf], [cx + Math.cos(a0) * R, cy + Math.sin(a0) * R, zf], [cx + Math.cos(a1) * R, cy + Math.sin(a1) * R, zf]], [0, 0, 1], { color: [0.16, 0.17, 0.18] }); }
  B.detail(2, () => { for (let i = -2; i <= 2; i++) B.box('plain', cx, cy + i * 0.075 - 0.006, zf, 2 * Math.sqrt(Math.max(0, R * R - (i * 0.075) ** 2)), 0.012, 0.01, { color: [0.82, 0.82, 0.8] });
    for (let i = 0; i < 5; i++) B.box('plain', x + 0.25, y + 0.12 + i * 0.08, zf - 0.004, 0.2, 0.012, 0.012, { color: [0.8, 0.8, 0.78] }); });
  if (!onWall) for (const sx of [-0.3, 0.3]) B.bbox('plastic', x + sx, g, z, 0.1, 0.1, 0.34, 0.01, { color: [0.28, 0.28, 0.3] });
  else for (const sx of [-0.3, 0.3]) { B.box('steel', x + sx, g - 0.04, 0.2, 0.04, 0.04, 0.4, { color: [0.6, 0.6, 0.6] }); B.beam('steel', [x + sx, g - 0.03, 0.38], [x + sx, g - 0.35, 0.02], 0.03, 0.03, { color: [0.6, 0.6, 0.6] }); }
  // pipe duct up the wall into a wall cap, drain hose to the ground
  const px = x + 0.47, top = Math.max(pipeTo, y + 0.7);
  B.beam('plain', [x + 0.4, y + 0.3, z - 0.02], [px, y + 0.3, 0.045], 0.08, 0.07, { color: [0.9, 0.88, 0.8] });
  B.bbox('plain', px, y + 0.26, 0.04, 0.085, top - y - 0.26, 0.07, 0.012, { color: [0.9, 0.88, 0.8] });
  B.bbox('plain', px, top - 0.02, 0.04, 0.13, 0.12, 0.09, 0.015, { color: [0.86, 0.84, 0.77] });
  if (!onWall) B.beam('plastic', [x - 0.36, y + 0.04, z], [x - 0.5, g + 0.005, z + 0.25], 0.018, 0.018, { color: [0.3, 0.32, 0.34] });
}
export function meterBox(B, x, y, kind = 'power') { B.detail(2, () => meterBox0(B, x, y, kind)); }
function meterBox0(B, x, y, kind = 'power') {
  if (kind === 'power') { B.bbox('plastic', x, y, 0.06, 0.24, 0.34, 0.12, 0.015, { color: [0.82, 0.83, 0.82] }); B.quad('glass', [x - 0.08, y + 0.14, 0.121], [x + 0.08, y + 0.14, 0.121], [x + 0.08, y + 0.27, 0.121], [x - 0.08, y + 0.27, 0.121], { color: [0.4, 0.45, 0.5] }); }
  else { B.bbox('plain', x, y, 0.08, 0.26, 0.26, 0.16, 0.02, { color: [0.62, 0.64, 0.62] }); B.cyl('steel', x - 0.08, 0, 0.08, 0.018, 0.018, y, 6, { color: [0.7, 0.62, 0.3] }); B.cyl('steel', x + 0.08, y + 0.26, 0.08, 0.018, 0.018, 0.5, 6, { color: [0.7, 0.62, 0.3] }); }
}
export function ventHood(B, x, y, color = [0.88, 0.88, 0.86]) { B.detail(2, () => ventHood0(B, x, y, color)); }
function ventHood0(B, x, y, color = [0.88, 0.88, 0.86]) {
  B.bbox('plain', x, y, 0.07, 0.2, 0.18, 0.13, 0.02, { color });
  B.box('dark', x, y - 0.002, 0.08, 0.16, 0.02, 0.1, { color: [0.12, 0.12, 0.12] });
}
export function waterHeater(B, x, g, rng) { // EcoCute: tank + heat pump
  B.bbox('plain', x, g + 0.05, 0.4, 0.62, 1.9, 0.68, 0.03, { color: [0.95, 0.95, 0.93] });
  B.box('concrete', x + 0.4, g, 0.4, 1.8, 0.05, 0.9, { color: [0.7, 0.7, 0.68] });
  acUnit(B, x + 1.05, g, rng, { pipeTo: 0.9, z: 0.3 });
}
export function nameplate(B, x, y, z, rng) { B.detail(2, () => nameplate0(B, x, y, z, rng)); }
function nameplate0(B, x, y, z, rng) {
  B.bbox('stone', x, y, z, 0.3, 0.12, 0.025, 0.004, { color: pick(rng, [[0.28, 0.27, 0.26], [0.86, 0.84, 0.8], [0.55, 0.42, 0.3]]) });
  B.box('dark', x, y + 0.035, z + 0.013, 0.2, 0.05, 0.003, { color: pick(rng, [[0.85, 0.82, 0.7], [0.15, 0.15, 0.15]]) });
}
export function intercom(B, x, y, z) { B.detail(2, () => intercom0(B, x, y, z)); }
function intercom0(B, x, y, z) {
  B.bbox('plastic', x, y, z, 0.1, 0.16, 0.035, 0.008, { color: [0.2, 0.2, 0.22] });
  B.box('glass', x, y + 0.1, z + 0.018, 0.05, 0.035, 0.004, { color: [0.3, 0.35, 0.4] });
  B.cyl('plastic', x, y + 0.035, z + 0.02, 0.018, 0.018, 0.004, 8, { color: [0.85, 0.85, 0.84] });
}
// foundation band with vent grilles (a wall frame per face: fw long, base high)
function foundationFace(B, fw, base, skip = []) { B.detail(2, () => foundationFace0(B, fw, base, skip)); }
function foundationFace0(B, fw, base, skip) {
  const n = Math.floor(fw / 1.9);
  for (let i = 0; i < n; i++) {
    const x = -fw / 2 + (i + 0.5) * fw / n; if (skip.some(([a, b]) => x > a - 0.3 && x < b + 0.3)) continue;
    B.box('dark', x, base * 0.45, 0.001, 0.36, 0.12, 0.012, { color: [0.12, 0.12, 0.12] });
    for (let k = 0; k < 5; k++) B.box('metal', x - 0.15 + k * 0.075, base * 0.45, 0.012, 0.012, 0.12, 0.012, { color: [0.45, 0.45, 0.46] });
  }
}

// ---------------------------------------------------------------- detached house
// Five styles so streets never look copy-pasted:
//  classic      pastel siding, gable or hip roof, sometimes a smaller second floor over a lean-to
//  twoTone      tiled or timber ground floor under a pastel upper floor, bay window
//  modern       single-pitch roof with solar panels, dark frames, tall windows, timber accent
//  traditional  dark cedar skirting under white plaster, heavy tiled hip roof, skirt roof between floors, lattices
//  cube         flat roof with parapet, ribbon windows, glass balcony
// Lot frame: origin lot centre, +Z towards the street.
const HOUSE_WALLS = [[1, 0.93, 0.78], [0.98, 0.98, 0.96], [0.78, 0.95, 0.82], [0.78, 0.88, 1], [1, 0.82, 0.7], [1, 0.92, 0.62], [1, 0.82, 0.85],
  [0.87, 0.82, 0.98], [0.78, 0.87, 0.7], [0.95, 0.86, 0.72], [0.74, 0.86, 0.94], [1, 0.97, 0.9]];
const MODERN_WALLS = [[0.97, 0.97, 0.95], [0.97, 0.97, 0.95], [0.36, 0.38, 0.42], [0.32, 0.42, 0.6], [0.62, 0.76, 0.62], [0.92, 0.86, 0.78], [0.84, 0.6, 0.5]];
const LOWER_TONES = [[0.86, 0.6, 0.48], [0.72, 0.72, 0.74], [0.9, 0.8, 0.66], [0.62, 0.5, 0.44], [0.58, 0.66, 0.72]];
const HOUSE_ROOFS = [[0.2, 0.33, 0.6], [0.2, 0.5, 0.52], [0.72, 0.28, 0.2], [0.26, 0.3, 0.42], [0.3, 0.5, 0.32], [0.55, 0.22, 0.2], [0.18, 0.42, 0.7],
  [0.42, 0.28, 0.22], [0.62, 0.36, 0.22], [0.3, 0.32, 0.36]];
const FRAMES = { alu: [0.8, 0.82, 0.84], white: [0.96, 0.96, 0.94], brown: [0.36, 0.25, 0.18], black: [0.16, 0.16, 0.18], wood: [0.5, 0.35, 0.22] };
const FLOWERS = [[1, 0.45, 0.55], [0.98, 0.3, 0.28], [1, 0.86, 0.3], [0.96, 0.96, 0.94], [0.72, 0.52, 0.95], [1, 0.62, 0.8]];
export function doorGap(LW, gw) { return [LW / 2 - 0.5 - gw, LW / 2 - 0.5]; }
function flowerBox(B, cx, y, w, rng) { B.detail(1, () => flowerBox0(B, cx, y, w, rng)); }
function flowerBox0(B, cx, y, w, rng) {
  B.bbox('wood', cx, y - 0.3, 0.14, w, 0.22, 0.24, 0.015, { color: [0.55, 0.38, 0.26] });
  const c = pick(rng, FLOWERS), n = Math.max(3, Math.floor(w / 0.18));
  for (let i = 0; i < n; i++) B.box('plain', cx - w / 2 + (i + 0.5) * w / n, y - 0.1, 0.12 + (i % 2) * 0.06, 0.13, 0.12 + (i % 3) * 0.03, 0.13, { color: i % 3 === 2 ? [0.3, 0.6, 0.3] : c });
}
function solarPanels(B, w, z0, z1, yAt, rows) {
  const cols = Math.max(2, Math.floor(w / 1.05)), pw = 0.98, gx = -cols * pw / 2;
  for (let rI = 0; rI < rows; rI++) {
    const za = lerp(z0, z1, rI / rows) + 0.05, zb = lerp(z0, z1, (rI + 1) / rows) - 0.05;
    for (let c = 0; c < cols; c++) {
      const xa = gx + c * pw + 0.03, xb = xa + pw - 0.06;
      B.quad('glass', [xa, yAt(za) + 0.1, za], [xb, yAt(za) + 0.1, za], [xb, yAt(zb) + 0.1, zb], [xa, yAt(zb) + 0.1, zb], { color: [0.55, 0.7, 1.1] });
      B.quad('alu', [xa - 0.02, yAt(za) + 0.06, za - 0.02], [xa - 0.02, yAt(zb) + 0.06, zb + 0.02], [xa - 0.02, yAt(zb) + 0.1, zb + 0.02], [xa - 0.02, yAt(za) + 0.1, za - 0.02], { color: [0.7, 0.72, 0.75] });
    }
    B.beam('alu', [gx, yAt(za) + 0.07, za], [gx + cols * pw, yAt(za) + 0.07, za], 0.04, 0.05, { color: [0.75, 0.77, 0.8] });
    B.beam('alu', [gx, yAt(zb) + 0.07, zb], [gx + cols * pw, yAt(zb) + 0.07, zb], 0.04, 0.05, { color: [0.75, 0.77, 0.8] });
  }
}
export function antenna(B, x, y, z) { B.detail(1, () => antenna0(B, x, y, z)); }
function antenna0(B, x, y, z) {
  B.cyl('alu', x, y, z, 0.025, 0.02, 2.3, 6, { color: [0.7, 0.72, 0.75] });
  B.box('alu', x, y + 1.9, z, 0.03, 0.03, 1.4, { color: [0.7, 0.72, 0.75] });
  for (let i = 0; i < 5; i++) B.box('alu', x, y + 1.9, z - 0.6 + i * 0.3, 0.7 - i * 0.08, 0.02, 0.02, { color: [0.7, 0.72, 0.75] });
  for (const [dx, dz] of [[0.9, 0.5], [-0.9, -0.5]]) B.beam('steel', [x, y + 1.6, z], [x + dx, y - 0.15, z + dz], 0.008, 0.008, { color: [0.4, 0.4, 0.4] }); // guy wires
}
// walls of a box (centre cx on x, w by d, from y0 to y1) with per-face holes; mats per band [[mat, color, uv, yTop]]
export function boxWalls(B, cx, w, d, y0, y1, bands, holesOf, revealC) {
  const faces = [[0, d / 2, w], [Math.PI, d / 2, w], [Math.PI / 2, w / 2, d], [-Math.PI / 2, w / 2, d]];
  faces.forEach(([fr, off, fw], fi) => inFrame(B, [cx + Math.sin(fr) * off, 0, Math.cos(fr) * off], fr, () => {
    const holes = holesOf(fi, fw) || [];
    let yb = y0;
    for (const [mat, color, uv, yTop] of bands) { const yt = Math.min(y1, yTop ?? y1); if (yt > yb) wallFill(B, mat, -fw / 2, fw / 2, yb, yt, holes, color, uv); yb = yt; }
    for (const h of holes) { const band = bands.find(b => (b[3] ?? y1) > (h.y0 + h.y1) / 2) || bands[bands.length - 1]; reveals(B, h.revealMat || band[0], h, h.revealColor || revealC || band[1], band[2] / 2); }
  }));
}

function house_build(B, lot, rng, extras) {
  const { x, y, z, r, w: LW, d: LD } = lot;
  B.frame(x, y, z, r);
  const farm = lot.district === 'farm';
  B.defAttr = { aWear: [clamp((lot.era === 'old' ? 0.62 : 0.18) + (lot.district === 'old' || farm ? 0.2 : 0) + (rng() - 0.5) * 0.3, 0, 1), 1] };
  const W = clamp(LW - 2.2 - rng() * 1.2, 6.5, farm ? 13 : 10), D = clamp(LD - (lot.front ?? 4.8) - 1.2 - rng() * 1.5, 7, farm ? 12 : 10.5);
  // the district biases the style: old quarters keep timber-and-plaster houses, the newer estates are modern
  const WTS = { old: [0.28, 0.12, 0.04, 0.5, 0.06], river: [0.32, 0.18, 0.08, 0.36, 0.06], new: [0.22, 0.26, 0.3, 0.03, 0.19], mid: [0.3, 0.23, 0.18, 0.16, 0.13],
    station: [0.3, 0.26, 0.2, 0.08, 0.16], farm: [0.22, 0.04, 0, 0.74, 0] }[lot.district || 'mid'];
  let sr = rng(), si = 0; while (si < 4 && sr > WTS[si]) { sr -= WTS[si]; si++; }
  const style = ['classic', 'twoTone', 'modern', 'traditional', 'cube'][si];
  const floors = style === 'cube' ? 2 : style === 'traditional' ? (rng() < 0.35 ? 1 : 2) : rng() < 0.12 ? 1 : 2;
  const fh = 2.85, base = style === 'traditional' ? 0.55 : 0.45, H = base + floors * fh, g1 = base + fh;
  // the lot sets the front yard: old-quarter houses stand close behind their walls, estate houses keep a car-deep yard
  const frontY = clamp(lot.front ?? LD - 1.2 - D, 0.9, LD - D - 0.8), hz = LD / 2 - frontY - D / 2, hx = (rng() - 0.5) * (LW - W - 1.6);
  let wallMat = rng() < 0.55 ? 'siding' : rng() < 0.6 ? 'stucco' : 'plaster', wc = jitter(rng, pick(rng, HOUSE_WALLS), 0.05);
  let lowMat = wallMat, lc = wc, frameC = FRAMES.alu, frameMat = 'alu', roofC = pick(rng, HOUSE_ROOFS), roofMat = rng() < 0.5 ? 'roofTile' : 'roofMetal';
  if (style === 'twoTone') { lowMat = rng() < 0.6 ? 'tiles' : 'wood'; lc = jitter(rng, lowMat === 'wood' ? [0.86, 0.62, 0.42] : pick(rng, LOWER_TONES), 0.05); wallMat = 'siding'; frameC = rng() < 0.5 ? FRAMES.white : FRAMES.brown; frameMat = 'plain'; }
  if (style === 'modern') { wallMat = rng() < 0.7 ? 'siding' : 'stucco'; wc = jitter(rng, pick(rng, MODERN_WALLS), 0.03); lowMat = wallMat; lc = wc; frameC = FRAMES.black; frameMat = 'plain'; roofMat = 'roofMetal'; roofC = pick(rng, [[0.24, 0.26, 0.3], [0.2, 0.3, 0.44], [0.46, 0.3, 0.24], [0.3, 0.42, 0.36]]); }
  if (style === 'traditional') { wallMat = 'plaster'; wc = [0.98, 0.96, 0.9]; lowMat = 'wood'; lc = [0.5, 0.36, 0.28]; frameC = FRAMES.wood; frameMat = 'plain'; roofMat = 'roofTile'; roofC = jitter(rng, pick(rng, [[0.36, 0.42, 0.55], [0.3, 0.33, 0.4], [0.42, 0.46, 0.52]]), 0.04); }
  if (style === 'cube') { wallMat = rng() < 0.5 ? 'stucco' : 'plaster'; wc = jitter(rng, pick(rng, [[0.98, 0.98, 0.96], [0.9, 0.9, 0.9], [0.95, 0.9, 0.82], [0.4, 0.42, 0.46]]), 0.03); lowMat = wallMat; lc = wc; frameC = FRAMES.black; frameMat = 'plain'; }
  if (style === 'classic' && rng() < 0.4) { frameC = rng() < 0.6 ? FRAMES.white : FRAMES.brown; frameMat = 'plain'; }
  const uvW = m => m === 'siding' ? 2.2 : m === 'wood' ? 2 : 3;
  const trimC = style === 'traditional' ? [0.36, 0.26, 0.2] : frameC === FRAMES.black ? [0.22, 0.22, 0.24] : mul(wc, 0.86).map((v, i) => Math.max(v, [0.9, 0.9, 0.88][i] * 0.9));
  const upperOnly = style === 'classic' && floors === 2 && rng() < 0.35;
  const W2 = upperOnly ? Math.max(4.6, W * (0.55 + rng() * 0.12)) : W, x2 = upperOnly ? (rng() < 0.5 ? -1 : 1) * (W - W2) / 2 : 0;
  const doorX = (rng() < 0.5 ? -1 : 1) * (W / 2 - 1.1), bayX = -doorX * 0.45;
  let roofTop = H, ridgeZ = 0, ridgeAlongX = true, shedSide = 0;
  const gutterC = pick(rng, [[0.78, 0.78, 0.76], [0.35, 0.3, 0.26], [0.9, 0.9, 0.88], [0.25, 0.26, 0.28]]);
  const lattice = style === 'traditional', boxes = (style === 'classic' || style === 'twoTone') && rng() < 0.45;
  const hoods = (style === 'classic' || style === 'twoTone' || style === 'traditional') && rng() < 0.5;
  const balcony = floors === 2 && style !== 'traditional' && rng() < (style === 'cube' ? 0.8 : 0.6);
  const bw = Math.min(W2 - 1, 3.5 + rng() * 2), bx = x2 + (rng() - 0.5) * (W2 - bw);
  inFrame(B, [hx, 0, hz], 0, () => {
    // ---- plan the openings of every face and floor
    const openings = {}; // key `${box}:${fi}` -> [{h, kind, opt}]
    const faces = [[0, D / 2, W, 0], [Math.PI, D / 2, W, 0], [Math.PI / 2, W / 2, D, 1], [-Math.PI / 2, W / 2, D, 1]];
    const add = (key, h, kind, opt = {}) => (openings[key] = openings[key] || []).push({ h, kind, opt });
    for (let fl = 0; fl < floors; fl++) faces.forEach(([fr, , fw, isSide], fi) => {
      const upper = fl === 1 && upperOnly, key = (upper ? 'U' : 'L') + (fl === 1 && !upperOnly ? '2' : '') + ':' + fi;
      const faceW = upper && !isSide ? W2 : fw, faceX = upper && !isSide ? x2 * (fr === 0 ? 1 : -1) : 0;
      if (upper && isSide && Math.sign(Math.sin(fr)) !== Math.sign(x2)) return;
      let n = isSide ? (rng() < 0.6 ? 1 : 2) : Math.max(1, Math.floor(faceW / (style === 'modern' ? 3.2 : 2.6)));
      if (style === 'cube' && !isSide) n = 1;
      for (let k = 0; k < n; k++) {
        let cx = faceX + (k + 0.5) / n * faceW - faceW / 2 + (rng() - 0.5) * 0.3;
        let big = !isSide && rng() < 0.5, ww = big ? 1.65 : 0.9 + rng() * 0.3, wh = big && fl === 0 ? 1.8 : 1.1, wy = base + fl * fh + (big && fl === 0 ? 0.35 : 0.95);
        let type = 'slide';
        if (style === 'cube' && !isSide) { const gd = fl === 0 && fi === 0; ww = faceW * (gd ? 0.4 : 0.62); cx = gd ? -Math.sign(doorX) * faceW * 0.22 : faceX; wh = 1.05; wy = base + fl * fh + 0.95; big = false; }
        else if (style === 'modern' && !isSide && rng() < 0.6) { ww = 0.7; wh = 2.1; wy = base + fl * fh + 0.35; type = 'fixed'; }
        const wx = clamp(cx, faceX - faceW / 2 + ww / 2 + 0.35, faceX + faceW / 2 - ww / 2 - 0.35);
        if (fi === 0 && fl === 0 && (Math.abs(wx - doorX) < ww / 2 + 0.8 || style === 'twoTone' && Math.abs(wx - bayX) < ww / 2 + 1.25)) continue;
        // the upper-floor window behind the balcony becomes a sliding glass door onto it
        const toBalc = balcony && fl === 1 && fi === 0 && Math.abs(wx - bx) < bw / 2 - ww / 2 && !(style === 'cube');
        if (toBalc) { const ox = upper ? faceX : 0; add(key, { x0: wx - 0.9 - ox, x1: wx + 0.9 - ox, y0: g1 + 0.05, y1: g1 + 2.05, d: 0.14 }, 'win', { type: 'slide', sill: false }); continue; }
        const small = isSide && !big && rng() < 0.35; // bathroom / toilet: small, frosted, grilled
        if (small) { ww = 0.6; wh = 0.55; wy = base + fl * fh + 1.45; }
        const ox = upper && !isSide ? faceX : 0;
        add(key, { x0: wx - ww / 2 - ox, x1: wx + ww / 2 - ox, y0: wy, y1: wy + wh, d: style === 'traditional' ? 0.1 : 0.14 }, 'win',
          { type: small ? 'fixed' : type, frosted: small, grille: small && fl === 0 || isSide && fl === 0 && rng() < 0.3,
            shutterBox: style !== 'cube' && style !== 'modern' && !small && (big || rng() < 0.4), shutter: rng() < 0.25 ? 0.2 + rng() * 0.8 : 0,
            lattice: lattice && fl === 0 && !small, hood: hoods && !isSide && !small ? roofC : null, flowers: boxes && fi === 0 && !big && fl === 1 && rng() < 0.7 });
      }
    });
    add('L:0', { x0: doorX - 0.52, x1: doorX + 0.52, y0: base, y1: base + 2.08, d: 0.16 }, 'door');
    const wOpt = { frame: frameC, frameMat, rng };
    const build = (key, fi) => inFrame(B, [faceOff(fi)[0], 0, faceOff(fi)[1]], faces[fi][0], () => {
      for (const { h, kind, opt } of openings[key] || []) {
        if (kind === 'door') {
          const doorC = style === 'traditional' ? [0.45, 0.32, 0.22] : pick(rng, [[0.28, 0.42, 0.62], [0.66, 0.3, 0.26], [0.35, 0.52, 0.42], [0.95, 0.95, 0.93], [0.38, 0.29, 0.24], [0.86, 0.68, 0.3], [0.3, 0.3, 0.33]]);
          const wood = style === 'traditional' || rng() < 0.4;
          doorUnit(B, h, { color: wood ? [0.78, 0.56, 0.38] : doorC, mat: wood ? 'wood' : 'plain', lattice: style === 'traditional', panel: !wood && rng() < 0.5, slit: rng() < 0.6, sideLeft: doorX > 0, trim: trimC, frame: frameC });
        } else {
          windowUnit(B, h, Object.assign({}, wOpt, opt));
          if (opt.flowers) flowerBox(B, (h.x0 + h.x1) / 2, h.y0, h.x1 - h.x0 + 0.1, rng);
        }
      }
    });
    const faceOff = fi => { const [fr, off] = faces[fi]; return [Math.sin(fr) * off, Math.cos(fr) * off]; };
    const holesOf = pref => (fi) => (openings[pref + ':' + fi] || []).map(o => o.h);
    // ---- foundation
    B.bbox('concrete', 0, -0.6, 0, W + 0.05, base + 0.6, D + 0.05, 0.012, { color: [0.72, 0.72, 0.7], skip: 'ny', uv: 2 });
    faces.forEach(([fr, off, fw], fi) => inFrame(B, [Math.sin(fr) * (off + 0.025), 0, Math.cos(fr) * (off + 0.025)], fr, () => foundationFace(B, fw, base, fi === 0 ? [[doorX - 0.6, doorX + 0.6]] : [])));
    // ---- walls
    const revC = frameMat === 'plain' ? mul(wc, 0.95) : [0.9, 0.9, 0.88];
    if (style === 'traditional') {
      boxWalls(B, 0, W, D, base, H, [['wood', lc, 2, base + 1.0], [wallMat, wc, 3]], fi => [...holesOf('L')(fi), ...holesOf('L2')(fi)], revC);
      faces.forEach(([fr, off, fw]) => inFrame(B, [Math.sin(fr) * off, 0, Math.cos(fr) * off], fr, () => B.bbox('wood', 0, base + 0.98, 0.02, fw + 0.06, 0.06, 0.05, 0.008, { color: [0.3, 0.22, 0.16] })));
    } else if (floors === 1) boxWalls(B, 0, W, D, base, H, [[lowMat, lc, uvW(lowMat)]], holesOf('L'), revC);
    else if (!upperOnly) boxWalls(B, 0, W, D, base, H, [[lowMat, lc, uvW(lowMat), g1], [wallMat, wc, uvW(wallMat)]], fi => [...holesOf('L')(fi), ...holesOf('L2')(fi)], revC);
    else { boxWalls(B, 0, W, D, base, g1, [[lowMat, lc, uvW(lowMat)]], holesOf('L'), revC); boxWalls(B, x2, W2, D, g1, H, [[wallMat, wc, uvW(wallMat)]], holesOf('U'), revC); }
    // corner boards and band course between floors
    if (wallMat === 'siding' || lowMat === 'siding') for (const [cxx, cw, y0c, y1c] of upperOnly ? [[0, W, base, g1], [x2, W2, g1, H]] : [[0, W, base, H]])
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.bbox('plain', cxx + sx * (cw / 2 + 0.01), y0c, sz * (D / 2 + 0.01), 0.1, y1c - y0c, 0.1, 0.01, { color: trimC });
    if (floors === 2 && style !== 'traditional' && style !== 'modern') B.bbox('plain', x2, g1 - 0.08, 0, W2 + 0.07, 0.14, D + 0.07, 0.012, { color: style === 'twoTone' ? frameC : trimC, skip: 'ny py' });
    if (style === 'modern') inFrame(B, [W / 2 - 1.3, 0, D / 2], 0, () => B.bbox('wood', 0, base, 0.03, 1.6, floors * fh - 0.02, 0.06, 0.01, { color: [1.0, 0.76, 0.52], uv: 2 }));
    // ---- openings: frames, glass, sills
    faces.forEach((_, fi) => { build('L:' + fi, fi); build('L2:' + fi, fi); });
    if (upperOnly) faces.forEach(([fr, off, fw, isSide], fi) => inFrame(B, [x2 + Math.sin(fr) * (isSide ? W2 / 2 : off), 0, Math.cos(fr) * off], fr, () => {
      for (const { h, opt } of openings['U:' + fi] || []) { windowUnit(B, h, Object.assign({}, wOpt, opt)); if (opt.flowers) flowerBox(B, (h.x0 + h.x1) / 2, h.y0, h.x1 - h.x0 + 0.1, rng); }
    }));
    // ---- roofs
    const over = style === 'traditional' ? 0.85 : style === 'modern' ? 0.4 : 0.55;
    if (style === 'cube') {
      faces.forEach(([fr, off, fw]) => inFrame(B, [Math.sin(fr) * off, 0, Math.cos(fr) * off], fr, () => wallFill(B, wallMat, -fw / 2, fw / 2, H, H + 0.5, [], mul(wc, 0.97), uvW(wallMat))));
      roofTop = flatRoof(B, { w: W, d: D, y: H, para: 0.5, color: wc, wallMat });
      inFrame(B, [W / 2 - 0.4, 0, -D / 2], Math.PI, () => { B.sweep('alu', circle(0.035, 8), [[0.2, H + 0.3, 0.1], [0.2, H + 0.1, 0.1], [0.2, 0.25, 0.1]], { closed: true, color: gutterC }); });
    } else if (style === 'modern') {
      const flip = rng() < 0.5 ? 0 : Math.PI, pitch = (12 + rng() * 8) * Math.PI / 180;
      inFrame(B, [0, 0, 0], flip, () => {
        const S = shedRoof(B, { w: W, d: D, y: H, pitch, over, mat: roofMat, color: roofC, gutterColor: gutterC, pipeSide: rng() < 0.5 ? 1 : -1 });
        const yb = S.yU(-D / 2);
        for (const e of [-1, 1]) B.poly(wallMat, [[e * W / 2, H, D / 2], [e * W / 2, H, -D / 2], [e * W / 2, yb, -D / 2]], [e, 0, 0], { color: wc, uv: uvW(wallMat) });
        const ch = Math.min(1.1, yb - H - 0.45), holes = [];
        if (ch > 0.35) for (let k = 0; k < 3; k++) holes.push({ x0: -W / 3 + k * W / 3 - 0.55, x1: -W / 3 + k * W / 3 + 0.55, y0: H + 0.15, y1: H + 0.15 + ch, d: 0.12 });
        inFrame(B, [0, 0, -D / 2], Math.PI, () => { wallFill(B, wallMat, -W / 2, W / 2, H, yb, holes, wc, uvW(wallMat)); for (const h of holes) { reveals(B, wallMat, h, wc, 1.5); windowUnit(B, h, { ...wOpt, sill: false, type: 'fixed' }); } });
        if (rng() < 0.7) solarPanels(B, W * 0.8, D / 2 - 0.2, -D / 2 + 0.4, zz => S.yU(zz) + 0.13, 2);
        roofTop = S.yT(-D / 2 - over); ridgeZ = flip ? D / 2 - 0.3 : -D / 2 + 0.3;
      });
    } else {
      const gableFront = !upperOnly && style !== 'traditional' && rng() < 0.38;
      const hip = !gableFront && (style === 'traditional' ? rng() < 0.75 : rng() < 0.4);
      const pitch = (style === 'traditional' ? 27 : gableFront ? 31 + rng() * 9 : roofMat === 'roofTile' ? 22 + rng() * 6 : 18 + rng() * 12) * Math.PI / 180;
      const along = gableFront ? false : W2 >= D;
      const rw = along ? W2 : D, rd = along ? D : W2;
      const R = inFrame(B, [x2, 0, 0], along ? 0 : Math.PI / 2, () => hip && rw >= rd
        ? hipRoof(B, { w: rw, d: rd, y: H, pitch, over, mat: roofMat, color: roofC, gutterColor: gutterC })
        : gableRoof(B, { w: rw, d: rd, y: H, pitch, over: over * 0.95, mat: roofMat, color: roofC, wallMat, wallColor: wc, wallUv: uvW(wallMat), gutterColor: gutterC, pipeSide: rng() < 0.5 ? 1 : -1 }));
      if (!hip && along && rng() < 0.3 && style === 'classic') inFrame(B, [x2, 0, 0], 0, () => { const k = Math.tan(pitch); solarPanels(B, rw * 0.7, rd / 2 - 0.1, 0.5, zz => R.yR - k * zz - 0.02, 2); });
      roofTop = R.yR; ridgeAlongX = along;
      if (gableFront && R.yR - H > 1.6) inFrame(B, [x2, 0, D / 2], 0, () => windowUnit(B, { x0: -0.38, x1: 0.38, y0: H + (R.yR - H) * 0.22, y1: H + (R.yR - H) * 0.22 + Math.min(0.9, (R.yR - H) * 0.35), d: 0.02 }, { ...wOpt, sill: false, type: 'fixed' }));
      if (upperOnly) { // lean-to over the single-storey part
        const lw = W - W2, side = -Math.sign(x2);
        inFrame(B, [-Math.sign(x2) * W2 / 2, 0, 0], side * Math.PI / 2, () => {
          const S = shedRoof(B, { w: D, d: lw, y: g1 + 0.02, pitch: 0.3, over: 0.45, rake: 0.3, mat: roofMat, color: roofC, gutterColor: gutterC });
          for (const e of [-1, 1]) B.poly(lowMat, [[e * D / 2, g1, lw / 2], [e * D / 2, g1, -lw / 2], [e * D / 2, S.yU(-lw / 2), -lw / 2]], [e, 0, 0], { color: lc, uv: uvW(lowMat) });
        });
      }
      if (style === 'traditional' && floors === 2) { // skirt roof (hisashi) between the floors, tiled
        faces.forEach(([fr, off, fw]) => inFrame(B, [Math.sin(fr) * off, 0, Math.cos(fr) * off], fr, () => {
          const yh = g1 + 0.25, out = 0.72, drop = 0.36, hl = fw / 2;
          B.poly(roofMat, [[-hl - out, yh - drop, out], [hl + out, yh - drop, out], [hl, yh, 0], [-hl, yh, 0]], [0, 1, 1], { color: roofC, uv: 2 });
          B.poly('plain', [[-hl - out, yh - drop - 0.08, out], [hl + out, yh - drop - 0.08, out], [hl, yh - 0.1, 0], [-hl, yh - 0.1, 0]], [0, -1, 0], { color: SOFFIT });
          B.bbox('plain', 0, yh - drop - 0.1, out + 0.012, 2 * (hl + out), 0.12, 0.025, 0.005, { color: mul(roofC, 0.6) });
          B.sweep(roofMat, circle(0.045, 6), [[-hl - out, yh - drop + 0.02, out - 0.03], [hl + out, yh - drop + 0.02, out - 0.03]], { closed: true, color: mul(roofC, 0.9), uv: 0.6 });
        }));
      }
    }
    if (rng() < 0.35 && style !== 'cube') { const off = (rng() - 0.5) * 1.2; antenna(B, x2 + (ridgeAlongX ? off : 0), roofTop - 0.12, ridgeAlongX ? ridgeZ : off); }
    // ---- twoTone: a bay window on the ground floor front
    if (style === 'twoTone') inFrame(B, [bayX, 0, D / 2], 0, () => {
      B.bbox(lowMat, 0, base + 0.3, 0.3, 2.3, 1.9, 0.6, 0.015, { color: lc, skip: 'nz pz', uv: uvW(lowMat) });
      B.bbox('roofMetal', 0, base + 2.2, 0.33, 2.5, 0.09, 0.74, 0.015, { color: roofC });
      inFrame(B, [0, 0, 0.6], 0, () => {
        const h = { x0: -0.9, x1: 0.9, y0: base + 0.75, y1: base + 1.95, d: 0.08 };
        wallFill(B, lowMat, -1.15, 1.15, base + 0.3, base + 2.2, [h], lc, uvW(lowMat)); reveals(B, lowMat, h, lc);
        windowUnit(B, h, { ...wOpt, type: 'grid' });
        if (rng() < 0.6) flowerBox(B, 0, base + 0.75, 1.9, rng);
      });
    });
    // ---- entrance: steps, canopy with brackets, porch light, nameplate, intercom
    inFrame(B, [doorX, 0, D / 2], 0, () => {
      const tile = style === 'traditional' ? [0.55, 0.55, 0.53] : pick(rng, [[0.72, 0.7, 0.66], [0.6, 0.58, 0.55], [0.8, 0.76, 0.7]]);
      B.bbox('tiles', 0, 0, 0.62, 1.7, base * 0.5, 1.24, 0.01, { color: tile, uv: 1 });
      B.bbox('tiles', 0, 0, 0.3, 1.5, base - 0.02, 0.6, 0.01, { color: tile, uv: 1 });
      const modernC = style === 'modern' || style === 'cube';
      B.bbox(modernC ? 'plain' : 'roofMetal', 0, base + 2.32, 0.52, 1.55, 0.09, 1.04, 0.012, { color: modernC ? [0.25, 0.25, 0.27] : roofC });
      if (!modernC) for (const sx of [-0.62, 0.62]) B.beam('plain', [sx, base + 1.95, 0.02], [sx, base + 2.3, 0.8], 0.05, 0.05, { color: trimC });
      B.bbox('lamp', 0.72, base + 1.85, 0.05, 0.12, 0.18, 0.09, 0.02);
      lampPoints.push({ p: B.P([0.72, base + 1.9, 0.3]), s: 0.5 });
      nameplate(B, -0.78, base + 1.4, 0.02, rng); intercom(B, -0.78, base + 1.05, 0.02);
      if (rng() < 0.5) B.bbox('plastic', 0.95, 0, 0.35, 0.34, 0.5, 0.3, 0.02, { color: pick(rng, [[0.3, 0.45, 0.35], [0.55, 0.4, 0.3], [0.8, 0.8, 0.78]]) }); // umbrella stand / planter
    });
    // ---- balcony: slab with thickness, railing with balusters, laundry poles
    if (balcony) inFrame(B, [bx, 0, D / 2], 0, () => {
      const by = g1 - 0.14, dep = 0.95;
      B.bbox('concrete', 0, by, dep / 2, bw, 0.16, dep, 0.012, { color: [0.78, 0.78, 0.76] });
      B.detail(1, () => { for (const sx of [-bw / 2 + 0.25, bw / 2 - 0.25]) { // steel knee brackets under the slab
        B.beam('steel', [sx, by - 0.55, 0.02], [sx, by - 0.02, dep - 0.12], 0.05, 0.05, { color: [0.62, 0.64, 0.66] });
        B.box('steel', sx, by - 0.05, dep / 2 - 0.05, 0.05, 0.05, dep - 0.1, { color: [0.62, 0.64, 0.66] }); } });
      const railC = style === 'cube' ? FRAMES.black : [0.82, 0.83, 0.84];
      B.bbox('alu', 0, by + 1.08, dep - 0.03, bw, 0.05, 0.07, 0.01, { color: railC });
      for (const s of [-1, 1]) { B.bbox('alu', s * (bw / 2 - 0.03), by + 0.16, dep - 0.03, 0.05, 0.94, 0.05, 0.008, { color: railC }); B.bbox('alu', s * (bw / 2 - 0.03), by + 1.08, dep / 2, 0.05, 0.05, dep, 0.008, { color: railC }); }
      if (style === 'cube') B.quad('poly', [-bw / 2, by + 0.16, dep - 0.03], [bw / 2, by + 0.16, dep - 0.03], [bw / 2, by + 1.08, dep - 0.03], [-bw / 2, by + 1.08, dep - 0.03]);
      else B.detail(1, () => { B.box('alu', 0, by + 0.24, dep - 0.03, bw, 0.03, 0.03, { color: railC }); for (let i = 1; i < Math.floor(bw / 0.12); i++) B.box('alu', -bw / 2 + i * 0.12, by + 0.26, dep - 0.03, 0.018, 0.82, 0.018, { color: railC });
        for (let s = -1; s <= 1; s += 2) for (let i = 1; i < 8; i++) B.box('alu', s * (bw / 2 - 0.03), by + 0.26, i * dep / 8, 0.018, 0.82, 0.018, { color: railC }); });
      B.cyl('alu', bw / 2 - 0.25, by - 0.12, dep - 0.2, 0.02, 0.02, 0.12, 6, { color: [0.5, 0.5, 0.5] }); // drain spout
      for (const s of [-1, 1]) B.box('steel', s * (bw / 2 - 0.3), by + 1.2, 0.35, 0.03, 0.55, 0.03, { color: [0.6, 0.62, 0.64] });
      B.beam('alu', [-bw / 2 + 0.3, by + 1.74, 0.35], [bw / 2 - 0.3, by + 1.74, 0.35], 0.03, 0.03, { color: [0.62, 0.64, 0.66] });
      if (rng() < 0.5) for (let i = 0; i < 4; i++) B.box('plain', -bw / 2 + 0.5 + i * (bw - 1) / 3, by + 1.1, 0.35, 0.45, 0.62, 0.02, { color: jitter(rng, pick(rng, [[0.95, 0.95, 0.95], [0.5, 0.62, 0.9], [0.95, 0.6, 0.62], [0.98, 0.86, 0.5]]), 0.1) });
      if (rng() < 0.5) acUnit(B, -bw / 2 + 0.6, by + 0.16, rng, { pipeTo: by + 1.9, z: 0.25 });
    });
    // ---- service side: AC units, meters, vents, water heater, back door
    faces.forEach(([fr, off, fw, isSide], fi) => inFrame(B, [Math.sin(fr) * off, 0, Math.cos(fr) * off], fr, () => {
      const busy = (xx, ww = 0.9) => (openings['L:' + fi] || []).some(o => Math.abs((o.h.x0 + o.h.x1) / 2 - xx) < (o.h.x1 - o.h.x0) / 2 + ww / 2 && o.h.y0 < 1.6);
      if (fi !== 0 && rng() < 0.7) { let ax = (rng() - 0.5) * (fw - 2); if (!busy(ax, 1.4)) { acUnit(B, ax, 0, rng, { pipeTo: base + fh * (floors > 1 && rng() < 0.5 ? 1.75 : 0.8) }); extras.push({ t: 'box', p: B.P([ax, 0, 0.22]), hx: 0.42, hz: 0.18, r: r + fr }); } }
      if (isSide && fi === 3 && (lot.district === 'old' || farm || lot.district === 'river') && rng() < 0.7) B.detail(1, () => { // LPG cylinders chained to the wall
        for (const px of [-fw / 2 + 1.0, -fw / 2 + 1.45]) { B.cyl('plain', px, 0, 0.22, 0.18, 0.18, 1.15, 12, { color: [0.62, 0.64, 0.66] }); B.cyl('plain', px, 1.15, 0.22, 0.18, 0.06, 0.1, 12, { color: [0.62, 0.64, 0.66], cap: true });
          B.cyl('steel', px, 1.25, 0.22, 0.04, 0.04, 0.08, 6, { color: [0.3, 0.3, 0.3] }); }
        B.box('dark', -fw / 2 + 1.22, 0.85, 0.03, 0.9, 0.02, 0.02, { color: [0.2, 0.2, 0.2] });
        B.sweep('steel', circle(0.012, 5), [[-fw / 2 + 1.22, 1.3, 0.2], [-fw / 2 + 1.22, 1.5, 0.05], [-fw / 2 + 1.8, 1.5, 0.03]], { closed: true, color: [0.5, 0.5, 0.5] });
        extras.push({ t: 'box', p: B.P([-fw / 2 + 1.22, 0, 0.22]), hx: 0.5, hz: 0.22, r: r + fr }); });
      if (isSide && fi === 2) { meterBox(B, fw / 2 - 1.2, 1.45, 'power'); meterBox(B, fw / 2 - 0.7, 0.55, 'gas'); B.sweep('dark', circle(0.012, 5), [[fw / 2 - 1.2, 1.8, 0.06], [fw / 2 - 1.2, H - 0.3, 0.06], [fw / 2 - 1.2, H - 0.25, 0.35]], { closed: true, color: [0.1, 0.1, 0.1] }); }
      if (fi >= 1) for (let k = 0; k < 2; k++) { const vx = (rng() - 0.5) * (fw - 1.5), vy = base + (rng() < 0.5 ? 2.2 : fh + 2.2); if (vy < H - 0.4 && !busy(vx, 0.5)) ventHood(B, vx, vy); }
      if (fi === 1 && rng() < 0.7) { const bdx = (rng() - 0.5) * (fw - 3); if (!busy(bdx, 1.4)) { const h = { x0: bdx - 0.4, x1: bdx + 0.4, y0: base, y1: base + 1.95, d: 0.1 }; doorUnit(B, h, { color: [0.62, 0.62, 0.6], mat: 'metal', frame: frameC, trim: trimC });
        B.bbox('concrete', bdx, 0, 0.35, 1.0, base - 0.03, 0.7, 0.01, { color: [0.7, 0.7, 0.68] }); B.bbox('roofMetal', bdx, base + 2.15, 0.35, 1.1, 0.06, 0.7, 0.01, { color: roofC }); } }
    }));
    extras.push({ t: 'box', p: B.P([0, 0, 0]), hx: W / 2, hz: D / 2, r });
    // backyard storage shed (steel monooki)
    if (rng() < 0.45) { const side = rng() < 0.5 ? -1 : 1; shedSide = side; inFrame(B, [side * (W / 2 - 0.9), 0, -D / 2 - 0.55], 0, () => {
      const sc = pick(rng, [[0.86, 0.82, 0.7], [0.62, 0.72, 0.6], [0.8, 0.8, 0.78], [0.55, 0.62, 0.72]]);
      B.bbox('metal', 0, 0.06, 0, 1.5, 1.55, 0.6, 0.012, { color: sc }); B.bbox('metal', 0, 1.6, 0, 1.62, 0.06, 0.72, 0.01, { color: mul(sc, 0.8) });
      for (const dx of [-0.37, 0.37]) B.box('dark', dx, 0.12, 0.301, 0.015, 1.4, 0.01, { color: [0.3, 0.3, 0.3] });
      B.box('dark', 0, 0.02, 0, 1.4, 0.05, 0.55, { color: [0.2, 0.2, 0.2] });
      extras.push({ t: 'box', p: B.P([0, 0, 0]), hx: 0.75, hz: 0.3, r }); }); }
    if (rng() < 0.4) inFrame(B, [W / 2, 0, -D / 4], Math.PI / 2, () => { waterHeater(B, -0.6, 0, rng); extras.push({ t: 'box', p: B.P([0, 0, 0.4]), hx: 1.2, hz: 0.4, r: r + Math.PI / 2 }); });
  });
  // ---- boundary: block wall with coping, gate pillars, mailbox slot
  B.frame(x, y, z, r);
  // boundary: block wall (with coping), low block wall, dark cedar board fence (板塀, old quarter), or an open front
  const fence = lot.fence || (rng() < 0.8 ? 'block' : 'open');
  const wood = fence === 'wood', wallH = wood ? 1.7 + rng() * 0.2 : fence === 'low' ? 0.45 + rng() * 0.15 : 0.8 + rng() * 0.6, gateW = 3.2;
  const wc2 = wood ? jitter(rng, [0.17, 0.13, 0.11], 0.03) : jitter(rng, [0.75, 0.74, 0.72], 0.05), hasWall = fence === 'block' || fence === 'low' || wood;
  if (fence === 'open' || fence === 'hedge') { // kerb stones mark the front edge
    B.beam('concrete', [-LW / 2, 0.05, LD / 2 - 0.08], [doorGap(LW, gateW)[0], 0.05, LD / 2 - 0.08], 0.12, 0.1, { color: [0.7, 0.7, 0.68] });
  }
  if (hasWall) {
    const seg = wood
      ? (ax, az, bx2, bz) => { B.beam('concrete', [ax, 0.15, az], [bx2, 0.15, bz], 0.2, 0.3, { color: [0.62, 0.62, 0.6] });
        B.beam('wood', [ax, 0.3 + (wallH - 0.3) / 2, az], [bx2, 0.3 + (wallH - 0.3) / 2, bz], 0.06, wallH - 0.3, { color: wc2, uv: 1.2 });
        B.beam('roofTile', [ax, wallH + 0.04, az], [bx2, wallH + 0.04, bz], 0.34, 0.08, { color: [0.3, 0.32, 0.36] }); }
      : (ax, az, bx2, bz) => { B.beam('block', [ax, wallH / 2 - 0.2, az], [bx2, wallH / 2 - 0.2, bz], 0.15, wallH + 0.4, { color: wc2, uv: 1.6 }); B.beam('concrete', [ax, wallH + 0.03, az], [bx2, wallH + 0.03, bz], 0.2, 0.06, { color: [0.66, 0.66, 0.64] }); };
    seg(-LW / 2, -LD / 2, LW / 2, -LD / 2);
    seg(-LW / 2, -LD / 2, -LW / 2, LD / 2 - 0.1); seg(LW / 2, -LD / 2, LW / 2, LD / 2 - 0.1);
    const gx = doorGap(LW, gateW);
    seg(-LW / 2, LD / 2 - 0.1, gx[0], LD / 2 - 0.1); seg(gx[1], LD / 2 - 0.1, LW / 2, LD / 2 - 0.1);
    for (const px of [gx[0], gx[1]]) { B.bbox('block', px, 0, LD / 2 - 0.1, 0.36, wallH + 0.25, 0.36, 0.01, { color: mul(wc2, 0.95), uv: 1.6 }); B.bbox('concrete', px, wallH + 0.25, LD / 2 - 0.1, 0.42, 0.06, 0.42, 0.01, { color: [0.62, 0.62, 0.6] }); }
    for (const [ax, az, bx2, bz] of [[-LW / 2, -LD / 2, LW / 2, -LD / 2], [-LW / 2, -LD / 2, -LW / 2, LD / 2], [LW / 2, -LD / 2, LW / 2, LD / 2], [-LW / 2, LD / 2 - 0.1, gx[0], LD / 2 - 0.1], [gx[1], LD / 2 - 0.1, LW / 2, LD / 2 - 0.1]]) {
      const cxl = (ax + bx2) / 2, czl = (az + bz) / 2, L = Math.hypot(bx2 - ax, bz - az), P = B.P([cxl, 0, czl]);
      extras.push({ t: 'box', p: P, hx: Math.abs(bx2 - ax) > 0.1 ? L / 2 : 0.1, hz: Math.abs(bx2 - ax) > 0.1 ? 0.1 : L / 2, r, h: wallH });
    }
  }
  const carOdds = lot.district === 'new' ? 0.95 : lot.district === 'old' ? 0.5 : 0.78;
  const carSpot = frontY >= 5.4 && rng() < carOdds ? { p: B.P([doorGap(LW, gateW)[0] + gateW / 2 + 0.2, 0, LD / 2 - 3.0]), r: r + (rng() < 0.5 ? 0 : Math.PI) } : null;
  if (carSpot) { // concrete parking pad with tyre strips, sometimes an aluminium carport
    B.frame(...carSpot.p, r);
    B.bbox('concrete', 0, -0.04, 0.4, 2.7, 0.07, 5.4, 0.01, { color: [0.74, 0.74, 0.72], skip: 'ny', uv: 2 });
    for (const s of [-0.55, 0.55]) B.box('dark', s, 0.028, 0.4, 0.06, 0.004, 5.2, { color: [0.45, 0.45, 0.44] }); // seam joints
    if (rng() < 0.35) {
      for (const [sx, sz] of [[-1.35, -2.3], [-1.35, 2.3]]) B.bbox('alu', sx, 0, sz, 0.1, 2.3, 0.1, 0.008, { color: [0.6, 0.55, 0.5] });
      B.bbox('alu', -0.1, 2.3, 0, 2.9, 0.12, 5.2, 0.01, { color: [0.6, 0.55, 0.5], skip: 'py ny' });
      gutter(B, [1.4, 2.3, -2.6], [1.4, 2.3, 2.6], [0.6, 0.55, 0.5]);
      extras.push({ t: 'poly', p: B.P([-0.1, 2.36, 0]), r, w: 2.8, d: 5.1 });
    }
  }
  // farmhouses keep a machinery barn (納屋) beside the house: timber posts, corrugated walls on three sides, open front
  if (farm && LW - W - 2.5 > 4) {
    const bw = Math.min(8, LW - W - 2.5), bd = Math.min(7, D), sx = hx > 0 ? -1 : 1;
    B.frame(x, y, z, r);
    inFrame(B, [sx * (LW / 2 - bw / 2 - 0.6), 0, hz], 0, () => barn(B, bw, bd, rng, extras));
  }
  B.defAttr = null;
  return { carSpot, doorX: hx + doorX, planters: rng() < 0.6, hx, hz, W, D, H: roofTop, eave: H, shedSide, hasWall, wallH, gate: doorGap(LW, gateW), style };
}
function barn(B, w, d, rng, extras) {
  const h = 3.2 + rng() * 0.6, post = [0.42, 0.32, 0.24], clad = jitter(rng, pick(rng, [[0.55, 0.5, 0.44], [0.46, 0.5, 0.52], [0.6, 0.36, 0.28]]), 0.04);
  B.bbox('concrete', 0, -0.05, 0, w + 0.3, 0.15, d + 0.3, 0.01, { color: [0.66, 0.66, 0.64], skip: 'ny' });
  for (const px of [-w / 2, 0, w / 2]) for (const pz of [-d / 2, d / 2]) B.bbox('wood', px, 0.1, pz, 0.14, h - 0.1, 0.14, 0.01, { color: post });
  const rise = Math.tan(0.18) * d;
  B.box('metalWall', 0, 0.1, -d / 2 - 0.02, w, h - 0.1 + rise, 0.03, { color: clad, uv: 1.2 });
  for (const s of [-1, 1]) { B.box('metalWall', s * (w / 2 + 0.02), 0.1, 0, 0.03, h - 0.1, d, { color: clad, uv: 1.2 });
    B.poly('metalWall', [[s * (w / 2 + 0.02), h, d / 2], [s * (w / 2 + 0.02), h, -d / 2], [s * (w / 2 + 0.02), h + rise, -d / 2]], [s, 0, 0], { color: clad, uv: 1.2 }); }
  B.beam('wood', [-w / 2, h - 0.12, d / 2], [w / 2, h - 0.12, d / 2], 0.14, 0.2, { color: post });
  shedRoof(B, { w, d, y: h, pitch: 0.18, over: 0.5, mat: 'roofMetal', color: jitter(rng, [0.42, 0.44, 0.46], 0.05), gutterColor: [0.5, 0.5, 0.5] });
  B.detail(1, () => { // stored gear: rice bags on a pallet, crates, a hand cart
    B.box('wood', -w / 4, 0.1, -d / 4, 1.1, 0.12, 1.1, { color: [0.6, 0.48, 0.34] });
    for (let k = 0; k < 6; k++) B.bbox('plain', -w / 4 + (k % 2 - 0.5) * 0.5, 0.22 + Math.floor(k / 2) * 0.22, -d / 4 + (k % 3 - 1) * 0.3, 0.45, 0.2, 0.28, 0.05, { color: [0.86, 0.82, 0.7] });
    for (let k = 0; k < 3; k++) B.bbox('plastic', w / 4, 0.1 + k * 0.3, -d / 3, 0.5, 0.3, 0.35, 0.02, { color: [0.2, 0.5, 0.3] });
  });
  extras.push({ t: 'box', p: B.P([0, 0, 0]), hx: w / 2, hz: d / 2, r: B.F.r });
}

// ---------------------------------------------------------------- shop building (shotengai)
// Two or three storeys over a recessed storefront: glazed shopfront with mullions, transom and kick plates (or a
// rolled-down shutter), sign board on a backing frame lit by gooseneck lamps, fabric awning on steel arms, noren and
// lanterns; living quarters above with real windows, wall-bracket AC units; back yard with service door, meters,
// water heater and sometimes an external steel stair; flat roof with parapet coping, water tank, condensers.
function shopBuilding_build(B, s, rng, extras) {
  const { x, y, z, r, w, d } = s;
  B.frame(x, y, z, r);
  // three shopfront types: RC flat-roofed (2-3 floors), 看板建築 (a flat false front hiding a pitched roof) and the
  // timber machiya (tiled roof parallel to the street, tiled pent roof over the shopfront, latticed upper windows)
  const type = s.type || (rng() < (s.old ? 0.5 : 0.22) ? 'machiya' : rng() < 0.45 ? 'kanban' : 'flat');
  const floors = type === 'flat' ? 2 + (rng() < 0.4 ? 1 : 0) : 2, fh = type === 'machiya' ? 2.9 : 3.1, H = floors * fh, W = w - 0.1;
  let mat = pick(rng, ['tiles', 'tiles', 'stucco', 'plaster', 'siding']), wc = jitter(rng, pick(rng, WALL_TINTS), 0.06), uv = mat === 'tiles' ? 2.5 : 3;
  if (type === 'machiya') { mat = 'plaster'; wc = jitter(rng, [0.96, 0.94, 0.88], 0.03); uv = 3; }
  B.defAttr = { aWear: [clamp((s.old ? 0.6 : 0.3) + (rng() - 0.5) * 0.4, 0, 1), 1] };
  B.bbox('concrete', 0, -0.6, 0, W + 0.04, 0.62, d + 0.04, 0.01, { color: [0.62, 0.62, 0.6], skip: 'ny py' });
  const para = type === 'flat' ? 0.6 : 0, winY = type === 'machiya' ? 1.45 : 0.9, winH = type === 'machiya' ? 1.0 : 1.3, signY = type === 'machiya' ? fh + 0.45 : 3.02;
  const tradeIdx = Math.floor(mulberry32(Math.floor(x * 131 + z * 71) | 0)() * SHOP_NAMES.length), interior = (SHOP_INTERIOR[tradeIdx] + 0.5) / 8;
  const closed = rng() < 0.3, frameC = pick(rng, [[0.78, 0.8, 0.82], [0.3, 0.3, 0.32], [0.55, 0.42, 0.3]]);
  const sf = { x0: -W / 2 + 0.35, x1: W / 2 - 0.35, y0: 0.12, y1: 2.75, d: 0.32 };
  const holes = [[sf], [], [], []], wins = [[], [], [], []];
  for (let f = 1; f < floors; f++) {
    const n = Math.max(1, Math.floor(W / 2.4));
    for (let k = 0; k < n; k++) { const cx = ((k + 0.5) / n - 0.5) * (W - 1), h = { x0: cx - 0.7, x1: cx + 0.7, y0: f * fh + winY, y1: f * fh + winY + winH, d: 0.16 }; holes[0].push(h);
      wins[0].push([h, type === 'machiya' ? { lattice: true, type: 'slide' } : { shutterBox: rng() < 0.3, shutter: rng() < 0.2 ? 0.6 : 0 }]); }
    const nb = Math.max(1, Math.floor(W / 3));
    for (let k = 0; k < nb; k++) if (rng() < 0.85) { const cx = ((k + 0.5) / nb - 0.5) * (W - 1.6), h = { x0: cx - 0.45, x1: cx + 0.45, y0: f * fh + 0.9, y1: f * fh + 2.0, d: 0.14 }; holes[1].push(h); wins[1].push([h, {}]); }
    for (const fi of [2, 3]) for (const zc of [-d / 4, d / 4]) if (rng() < 0.4) { const big = rng() < 0.5, h = { x0: zc - (big ? 0.7 : 0.35), x1: zc + (big ? 0.7 : 0.35), y0: f * fh + (big ? 0.9 : 1.2), y1: f * fh + (big ? 2.1 : 1.9), d: 0.14 }; holes[fi].push(h); wins[fi].push([h, { frosted: !big && rng() < 0.5, shutterBox: big && rng() < 0.5 }]); }
  }
  const back = { x0: W / 2 - 1.75, x1: W / 2 - 0.85, y0: 0.15, y1: 2.15, d: 0.12 }; holes[1].push(back);
  const bw0 = { x0: -W / 4 - 0.4, x1: -W / 4 + 0.4, y0: 1.2, y1: 1.9, d: 0.12 }; holes[1].push(bw0); wins[1].push([bw0, { grille: true, frosted: true }]);
  boxWalls(B, 0, W, d, 0, H + para, type === 'machiya' ? [['wood', [0.4, 0.29, 0.21], 2, fh], [mat, wc, uv]] : [[mat, wc, uv]], fi => holes[fi], mul(wc, 0.94));
  let roofY;
  const roofC = type === 'machiya' ? jitter(rng, [0.34, 0.38, 0.46], 0.04) : jitter(rng, pick(rng, [[0.28, 0.32, 0.4], [0.5, 0.26, 0.2], [0.24, 0.4, 0.44], [0.4, 0.4, 0.42]]), 0.04);
  if (type === 'flat') roofY = flatRoof(B, { w: W, d, y: H, para: 0.6, color: wc, wallMat: mat });
  else if (type === 'kanban') {
    const R2 = inFrame(B, [0, 0, 0], Math.PI / 2, () => gableRoof(B, { w: d, d: W, y: H, pitch: 0.36, over: 0.3, rake: 0, mat: 'roofMetal', color: roofC, wallMat: mat, wallColor: wc, wallUv: uv, gutterColor: [0.6, 0.6, 0.6] }));
    roofY = R2.yR;
    // the false front carried up past the gable: a slab with a stepped crest, moulded cornices and a band at the floor line
    const top = R2.yR + 0.55;
    B.bbox(mat, 0, H, d / 2 - 0.07, W + 0.02, top - 0.6 - H, 0.18, 0.01, { color: wc, uv });
    B.bbox(mat, 0, top - 0.6, d / 2 - 0.07, W - 2.4, 0.6, 0.18, 0.01, { color: wc, uv });
    B.bbox('plain', 0, top - 0.64, d / 2 + 0.02, W + 0.14, 0.14, 0.12, 0.02, { color: mul(wc, 0.84) });
    B.bbox('plain', 0, top - 0.04, d / 2 + 0.02, W - 2.26, 0.14, 0.12, 0.02, { color: mul(wc, 0.84) });
    B.bbox('plain', 0, H - 0.08, d / 2 + 0.01, W + 0.1, 0.12, 0.1, 0.02, { color: mul(wc, 0.88) });
  } else {
    const R2 = gableRoof(B, { w: W, d, y: H, pitch: 0.46, over: 0.7, rake: 0.35, mat: 'roofTile', color: roofC, wallMat: mat, wallColor: wc, wallUv: uv, gutterColor: [0.35, 0.3, 0.26] });
    roofY = R2.yR;
    inFrame(B, [0, 0, d / 2], 0, () => { // tiled pent roof (庇) over the shopfront on timber brackets
      const y1 = fh + 0.32, y0 = fh - 0.05, out = 0.95, hl = W / 2 + 0.15, nb = Math.max(1, Math.round((2 * hl - 0.7) / 1.8));
      B.poly('roofTile', [[-hl, y0, out], [hl, y0, out], [hl, y1, 0], [-hl, y1, 0]], [0, 1, 1], { color: roofC, uv: 2 });
      B.poly('plain', [[-hl, y0 - 0.08, out], [hl, y0 - 0.08, out], [hl, y1 - 0.1, 0], [-hl, y1 - 0.1, 0]], [0, -1, 0], { color: SOFFIT });
      B.bbox('wood', 0, y0 - 0.1, out, 2 * hl, 0.1, 0.05, 0.01, { color: [0.3, 0.22, 0.16] });
      B.sweep('roofTile', circle(0.045, 6), [[-hl, y0 + 0.02, out - 0.03], [hl, y0 + 0.02, out - 0.03]], { closed: true, color: mul(roofC, 0.9), uv: 0.6 });
      for (let i = 0; i <= nb; i++) { const bx2 = -hl + 0.35 + i * (2 * hl - 0.7) / nb; B.beam('wood', [bx2, y1 - 0.45, 0.02], [bx2, y0 - 0.12, out - 0.08], 0.07, 0.09, { color: [0.36, 0.26, 0.19] }); }
    });
  }
  const fz = d / 2;
  inFrame(B, [0, 0, fz], 0, () => {
    for (const [h, o] of wins[0]) windowUnit(B, h, { rng, frame: frameC, frameMat: 'alu', ...o });
    // storefront
    const zb = -sf.d + 0.04;
    B.bbox('concrete', 0, 0, -sf.d / 2, sf.x1 - sf.x0, 0.12, sf.d, 0.01, { color: [0.6, 0.6, 0.58] });
    if (closed) {
      B.quad('shutter', [sf.x0, sf.y0, zb + 0.1], [sf.x1, sf.y0, zb + 0.1], [sf.x1, sf.y1, zb + 0.1], [sf.x0, sf.y1, zb + 0.1], { color: jitter(rng, [0.72, 0.74, 0.74], 0.08), uv: 1.2 });
      B.bbox('alu', 0, sf.y0, zb + 0.12, sf.x1 - sf.x0, 0.06, 0.06, 0.008, { color: [0.6, 0.6, 0.6] });
    } else {
      B.quad('shopWindow', [sf.x0, sf.y0, zb], [sf.x1, sf.y0, zb], [sf.x1, sf.y1, zb], [sf.x0, sf.y1, zb], { color: [1, 0.95, interior], uvs: [[0, 0], [1, 0], [1, 1], [0, 1]] });
      const bays = Math.max(2, Math.round((sf.x1 - sf.x0) / 1.8)), bwid = (sf.x1 - sf.x0) / bays, door = Math.floor(rng() * bays);
      for (let i = 0; i <= bays; i++) B.bbox('alu', sf.x0 + i * bwid, sf.y0, zb + 0.04, 0.07, sf.y1 - sf.y0, 0.09, 0.008, { color: frameC });
      B.bbox('alu', 0, 2.25, zb + 0.04, sf.x1 - sf.x0, 0.07, 0.09, 0.008, { color: frameC });
      B.bbox('alu', 0, sf.y1 - 0.06, zb + 0.04, sf.x1 - sf.x0, 0.06, 0.09, 0.008, { color: frameC });
      for (let i = 0; i < bays; i++) if (i !== door) B.bbox('plain', sf.x0 + (i + 0.5) * bwid, sf.y0, zb + 0.03, bwid - 0.07, 0.3, 0.06, 0.008, { color: mul(frameC, 0.8) });
      const dx = sf.x0 + (door + 0.5) * bwid;
      B.bbox('alu', dx, sf.y0, zb + 0.06, bwid - 0.07, 0.05, 0.05, 0.006, { color: frameC });
      B.bbox('steel', dx + bwid * 0.3, 0.95, zb + 0.12, 0.03, 0.6, 0.03, 0.006, { color: [0.8, 0.8, 0.78] }); // door pull
      const nx = dx;
      if (deco() < 0.6) { // noren over the door
        const nc = pick(deco, [[0.14, 0.22, 0.48], [0.78, 0.18, 0.15], [0.96, 0.94, 0.88], [0.22, 0.48, 0.36], [0.5, 0.25, 0.42], [0.95, 0.62, 0.2]]);
        B.bbox('wood', nx, 2.18, 0.12, 1.95, 0.05, 0.05, 0.008, { color: [0.45, 0.32, 0.22] });
        for (let k = 0; k < 3; k++) { const x0 = nx - 0.9 + k * 0.61, x1 = x0 + 0.57; B.quad('plain', [x0, 1.55, 0.14], [x1, 1.55, 0.14], [x1, 2.18, 0.14], [x0, 2.18, 0.14], { color: nc }); B.quad('plain', [x1, 1.55, 0.14], [x0, 1.55, 0.14], [x0, 2.18, 0.14], [x1, 2.18, 0.14], { color: mul(nc, 0.7) }); }
      }
      if (deco() < 0.45) for (const sd of [-1, 1]) { const lx = nx + sd * 1.35; B.box('dark', lx, 2.45, 0.3, 0.02, 0.2, 0.02); chochin(B, lx, 1.95, 0.3, deco() < 0.8 ? [1, 0.28, 0.18] : [1, 0.85, 0.6], 0.95); }
    }
    // shutter box over the storefront, sign board on a backing frame with lamps
    B.bbox('alu', 0, sf.y1 + 0.02, 0.12, sf.x1 - sf.x0 + 0.2, 0.3, 0.24, 0.012, { color: [0.72, 0.72, 0.7] });
    const signW = W - 1.2;
    B.bbox(type === 'machiya' ? 'wood' : 'plain', 0, signY, 0.06, signW + 0.14, 0.92, 0.12, 0.012, { color: type === 'machiya' ? [0.3, 0.22, 0.16] : [0.3, 0.3, 0.32] });
    const sign = shopSign(rng, signW, tradeIdx); sign.position.set(...B.P([0, signY + 0.45, 0.125])); sign.rotation.y = r; scene.add(sign);
    if (type !== 'machiya') for (let i = 0; i < 3; i++) { const lx = (i - 1) * signW / 3; B.sweep('steel', circle(0.012, 5), [[lx, 4.05, 0.02], [lx, 4.15, 0.25], [lx, 4.05, 0.42]], { closed: true, color: [0.25, 0.25, 0.27] }); B.bbox('lamp', lx, 3.97, 0.42, 0.12, 0.08, 0.1, 0.02, { color: [1, 0.95, 0.85] }); }
    if (type !== 'machiya' && rng() < 0.55) { // fabric awning on steel arms
      const ac = pick(rng, [[0.85, 0.2, 0.18], [0.2, 0.55, 0.35], [0.22, 0.38, 0.75], [0.98, 0.7, 0.2], [0.9, 0.45, 0.6], [0.3, 0.65, 0.7]]);
      const ax = W / 2 - 0.3, y0 = 2.92, y1 = 2.6, dz = 1.1;
      B.poly('plain', [[-ax, y0, 0.02], [ax, y0, 0.02], [ax, y1, dz], [-ax, y1, dz]], [0, 1, 0.3], { color: ac });
      B.poly('plain', [[-ax, y0 - 0.02, 0.02], [ax, y0 - 0.02, 0.02], [ax, y1 - 0.02, dz], [-ax, y1 - 0.02, dz]], [0, -1, -0.3], { color: mul(ac, 0.62) });
      for (const e of [-1, 1]) B.poly('plain', [[e * ax, y0, 0.02], [e * ax, y1, dz], [e * ax, y1 - 0.25, dz]], [e, 0, 0], { color: mul(ac, 0.8) });
      B.quad('plain', [-ax, y1 - 0.25, dz], [ax, y1 - 0.25, dz], [ax, y1, dz], [-ax, y1, dz], { color: mul(ac, 0.9) });
      B.quad('plain', [ax, y1 - 0.25, dz - 0.01], [-ax, y1 - 0.25, dz - 0.01], [-ax, y1, dz - 0.01], [ax, y1, dz - 0.01], { color: mul(ac, 0.6) });
      for (const e of [-1, 0, 1]) B.beam('steel', [e * (ax - 0.1), y0 - 0.45, 0.03], [e * (ax - 0.1), y1 - 0.04, dz - 0.05], 0.025, 0.025, { color: [0.3, 0.3, 0.32] });
    }
    if (type !== 'machiya' && rng() < 0.5) { const vs = verticalSign(rng, tradeIdx), vp = B.P([W / 2 - 0.5, 5.2, 0.45]); vs.position.set(...vp); vs.rotation.y = r + Math.PI / 2; scene.add(vs);
      for (const yy of [4.3, 6.0]) B.bbox('steel', W / 2 - 0.5, yy, 0.22, 0.05, 0.05, 0.45, 0.008, { color: [0.3, 0.3, 0.32] }); }
    // living quarters: a wall-bracket AC unit beside some upper windows
    for (let f = 1; f < floors; f++) if (rng() < 0.5) acUnit(B, -W / 2 + 0.75, f * fh + 0.45, rng, { onWall: true, pipeTo: f * fh + 2.2, z: 0.25 });
    lampPoints.push({ p: B.P([0, 2.9, 0.8]), s: 0.8 });
  });
  // back: service door, windows, meters, water heater, downpipes, external stair
  inFrame(B, [0, 0, -d / 2], Math.PI, () => {
    for (const [h, o] of wins[1]) windowUnit(B, h, { rng, ...o });
    doorUnit(B, back, { color: jitter(rng, [0.55, 0.57, 0.58], 0.1), mat: 'metal', frame: [0.5, 0.5, 0.5], trim: [0.72, 0.72, 0.7] });
    B.bbox('roofMetal', (back.x0 + back.x1) / 2, 2.35, 0.35, 1.3, 0.06, 0.7, 0.01, { color: [0.45, 0.47, 0.5] });
    meterBox(B, W / 2 - 2.3, 1.45, 'power'); meterBox(B, W / 2 - 2.8, 0.55, 'gas');
    if (rng() < 0.8) acUnit(B, -W / 4 + 1.2, 0, rng, { pipeTo: 2.4 });
    if (floors > 2 && rng() < 0.6) acUnit(B, W / 4 - 1, fh + 0.35, rng, { onWall: true, pipeTo: fh + 2.2 });
    for (const e of [-1, 1]) downpipe(B, [e * (W / 2 - 0.3), H + 0.3, 0.02], [e * (W / 2 - 0.3), 0, 0.08], 0, [0.62, 0.62, 0.6]);
    if (rng() < 0.35) { // external steel stair to the upper floor
      const sx = -W / 2 + 1.0, top = fh, n = 16;
      for (let i = 0; i < n; i++) B.bbox('metal', sx + 0.2 + i * 0.25, (i + 1) * top / n - 0.03, 0.55, 0.26, 0.04, 0.9, 0.005, { color: [0.45, 0.48, 0.5] });
      for (const zz of [0.1, 1.0]) { B.beam('metal', [sx + 0.1, 0.1, zz], [sx + 0.2 + n * 0.25, top - 0.1, zz], 0.04, 0.2, { color: [0.4, 0.43, 0.45] }); B.beam('steel', [sx + 0.1, 1.0, zz], [sx + 0.2 + n * 0.25, top + 0.9, zz], 0.04, 0.04, { color: [0.4, 0.43, 0.45] }); }
      B.bbox('metal', sx + 0.2 + n * 0.25 + 0.5, top - 0.05, 0.55, 1.0, 0.06, 1.1, 0.008, { color: [0.45, 0.48, 0.5] });
    }
  });
  // roof: water tank on a stand, condensers, vent stack (flat roofs); pitched roofs get an aerial
  if (type !== 'flat') { if (rng() < 0.4) antenna(B, 0, roofY - 0.1, 0); extras.push({ t: 'box', p: B.P([0, 0, 0]), hx: w / 2, hz: d / 2, r }); B.defAttr = null; return; }
  if (deco() < 0.45) {
    const tc = pick(deco, [[0.92, 0.92, 0.9], [0.4, 0.6, 0.82], [0.85, 0.86, 0.88]]), tx = (deco() - 0.5) * (W - 3), tz = -d / 4;
    for (const [sx, sz] of [[-0.55, -0.55], [0.55, -0.55], [-0.55, 0.55], [0.55, 0.55]]) B.bbox('alu', tx + sx, H + 0.03, tz + sz, 0.08, 0.7, 0.08, 0.006, { color: [0.5, 0.5, 0.52] });
    B.cyl('plastic', tx, H + 0.72, tz, 0.72, 0.72, 1.2, 16, { color: tc });
    B.cyl('plastic', tx, H + 1.92, tz, 0.72, 0.28, 0.26, 16, { color: tc, cap: true });
  }
  inFrame(B, [W / 4, 0, 0], 0, () => { acUnit(B, 0, H + 0.03, rng, { pipeTo: H + 0.5 }); if (rng() < 0.5) acUnit(B, -1.2, H + 0.03, rng, { pipeTo: H + 0.5 }); });
  B.cyl('steel', -W / 3, H, d / 4, 0.05, 0.05, 1.2, 8, { color: [0.6, 0.6, 0.6] }); B.cyl('steel', -W / 3, H + 1.2, d / 4, 0.09, 0.09, 0.08, 8, { color: [0.5, 0.5, 0.5], cap: true });
  if (rng() < 0.4) antenna(B, W / 3, roofY, -d / 4);
  B.defAttr = null;
  extras.push({ t: 'box', p: B.P([0, 0, 0]), hx: w / 2, hz: d / 2, r });
}

// ---------------------------------------------------------------- convenience store
function konbini_build(B, s, rng, extras) {
  const { x, y, z, r, w, d } = s;
  B.frame(x, y, z, r);
  const H = 4.2, gl = { x0: -w / 2 + 0.5, x1: w / 2 - 0.5, y0: 0.12, y1: 2.95, d: 0.22 };
  const sideWin = { x0: d / 2 - 4.5, x1: d / 2 - 0.6, y0: 0.12, y1: 2.95, d: 0.22 };
  const back = [{ x0: -w / 2 + 1.5, x1: -w / 2 + 2.4, y0: 0.1, y1: 2.2, d: 0.12 }, { x0: w / 2 - 4.2, x1: w / 2 - 2.0, y0: 0.1, y1: 2.6, d: 0.12 }];
  boxWalls(B, 0, w, d, 0, H + 0.5, [['stucco', [0.97, 0.97, 0.96], 3]], fi => fi === 0 ? [gl] : fi === 1 ? back : fi === 2 ? [sideWin] : [], [0.9, 0.9, 0.9]);
  flatRoof(B, { w, d, y: H, para: 0.5, color: [0.97, 0.97, 0.96], wallMat: 'stucco' });
  const stripes = [[0.05, 0.55, 0.3], [0.95, 0.95, 0.95], [0.1, 0.35, 0.75], [0.95, 0.95, 0.95], [0.95, 0.55, 0.1]];
  stripes.forEach((c, i) => B.bbox('plain', 0, 3.2 + i * 0.16, 0, w + 0.08, 0.16, d + 0.08, 0.004, { color: c, skip: 'ny py' }));
  const glaze = (h, n, doorBay) => {
    const zb = -h.d + 0.04, bwid = (h.x1 - h.x0) / n;
    B.quad('shopWindow', [h.x0, h.y0, zb], [h.x1, h.y0, zb], [h.x1, h.y1, zb], [h.x0, h.y1, zb], { color: [1.4, 1.45, 0.0625], uvs: [[0, 0], [1, 0], [1, 1], [0, 1]] });
    for (let i = 0; i <= n; i++) B.bbox('alu', h.x0 + i * bwid, h.y0, zb + 0.05, 0.08, h.y1 - h.y0, 0.1, 0.008, { color: [0.82, 0.84, 0.86] });
    B.bbox('alu', (h.x0 + h.x1) / 2, h.y1 - 0.07, zb + 0.05, h.x1 - h.x0, 0.07, 0.1, 0.008, { color: [0.82, 0.84, 0.86] });
    B.bbox('alu', (h.x0 + h.x1) / 2, 2.35, zb + 0.05, h.x1 - h.x0, 0.06, 0.1, 0.008, { color: [0.82, 0.84, 0.86] });
    for (let i = 0; i < n; i++) if (i !== doorBay) B.bbox('plain', h.x0 + (i + 0.5) * bwid, h.y0, zb + 0.03, bwid - 0.08, 0.25, 0.05, 0.006, { color: [0.35, 0.36, 0.38] });
    B.bbox('concrete', (h.x0 + h.x1) / 2, 0, -h.d / 2, h.x1 - h.x0, 0.12, h.d, 0.01, { color: [0.62, 0.62, 0.6] });
    return zb;
  };
  inFrame(B, [0, 0, d / 2], 0, () => {
    const doorBay = 1, n = 6, bwid = (gl.x1 - gl.x0) / n, zb = glaze(gl, n, doorBay), dx = gl.x0 + (doorBay + 0.5) * bwid;
    for (const s2 of [-1, 1]) B.bbox('alu', dx + s2 * bwid * 0.25, 0.14, zb + 0.09, bwid * 0.48, 2.2, 0.04, 0.006, { color: [0.82, 0.84, 0.86], skip: 'pz nz' }); // sliding door leaves (frames)
    B.bbox('plastic', dx, 2.5, 0.08, 0.35, 0.1, 0.12, 0.01, { color: [0.2, 0.2, 0.22] }); // door sensor
    B.bbox('plastic', dx, 0, 1.0, bwid + 0.4, 0.015, 1.3, 0.004, { color: [0.3, 0.32, 0.34] }); // entrance mat
    // bins station and a smoking stand by the door
    const bc = [[0.2, 0.45, 0.8], [0.25, 0.6, 0.3], [0.85, 0.55, 0.15], [0.7, 0.7, 0.72]];
    bc.forEach((c, i) => { const bx2 = dx + bwid * 0.9 + 0.6 + i * 0.52; B.bbox('plastic', bx2, 0, 0.45, 0.48, 1.0, 0.5, 0.03, { color: [0.92, 0.92, 0.9] }); B.box('plastic', bx2, 0.8, 0.705, 0.34, 0.1, 0.01, { color: c }); B.box('dark', bx2, 0.62, 0.705, 0.18, 0.1, 0.012, { color: [0.1, 0.1, 0.1] }); });
    extras.push({ t: 'box', p: B.P([dx + bwid * 0.9 + 1.4, 0, 0.45]), hx: 1.1, hz: 0.3, r });
    B.cyl('steel', dx - bwid, 0, 1.2, 0.18, 0.2, 0.85, 12, { color: [0.35, 0.36, 0.38], cap: true });
    for (let i = 0; i < 3; i++) B.sweep('steel', circle(0.015, 5), [[gl.x1 - 3 + i * 0.9, 0.02, 1.3], [gl.x1 - 3 + i * 0.9, 0.6, 1.3], [gl.x1 - 2.4 + i * 0.9, 0.6, 1.3], [gl.x1 - 2.4 + i * 0.9, 0.02, 1.3]], { color: [0.7, 0.7, 0.72] }); // bike racks
    const sign = signMesh(6, 1.0, (g, W2, H2) => {
      g.fillStyle = '#fff'; g.fillRect(0, 0, W2, H2);
      g.fillStyle = '#0a8a4b'; g.fillRect(0, 0, W2, H2 * 0.22); g.fillStyle = '#1a5fb4'; g.fillRect(0, H2 * 0.78, W2, H2 * 0.22);
      g.fillStyle = '#0a4f8f'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `bold ${H2 * 0.42}px Arial`; g.fillText('SUNNY MART', W2 / 2, H2 * 0.52);
    }, 1.2);
    sign.position.set(...B.P([0, 3.6, 0.1])); sign.rotation.y = r; scene.add(sign);
  });
  inFrame(B, [w / 2, 0, 0], Math.PI / 2, () => { glaze(sideWin, 3, -1); });
  inFrame(B, [0, 0, -d / 2], Math.PI, () => {
    doorUnit(B, back[0], { color: [0.6, 0.62, 0.64], mat: 'metal', frame: [0.5, 0.5, 0.5] });
    const h = back[1]; B.quad('shutter', [h.x0, h.y0, -h.d + 0.03], [h.x1, h.y0, -h.d + 0.03], [h.x1, h.y1, -h.d + 0.03], [h.x0, h.y1, -h.d + 0.03], { color: [0.7, 0.72, 0.72], uv: 1.2 });
    for (let i = 0; i < 4; i++) acUnit(B, -w / 2 + 4.5 + i * 1.05, 0, rng, { pipeTo: 3.0 });
    for (const e of [-1, 1]) downpipe(B, [e * (w / 2 - 0.3), H + 0.3, 0.02], [e * (w / 2 - 0.3), 0, 0.08], 0, [0.8, 0.8, 0.78]);
    meterBox(B, -w / 2 + 3.2, 1.45, 'power');
  });
  for (let i = 0; i < 5; i++) inFrame(B, [-w / 2 + 2.5 + i * 1.3, 0, -d / 4], 0, () => acUnit(B, 0, H + 0.03, rng, { pipeTo: H + 0.4 }));
  lampPoints.push({ p: B.P([0, 2.6, d / 2 + 2]), s: 1.4 }, { p: B.P([-w / 3, 2.6, d / 2 + 2]), s: 1.2 }, { p: B.P([w / 3, 2.6, d / 2 + 2]), s: 1.2 });
  extras.push({ t: 'box', p: B.P([0, 0, 0]), hx: w / 2, hz: d / 2, r });
}

// ---------------------------------------------------------------- apartment block (mansion)
// Balconies on the +Z side with slab edges, frosted panels in aluminium frames, fire-escape partitions, sliding glass
// doors behind; open access corridors on the back with a parapet, unit doors with meter boxes; stair tower; roof plant.
function apartment_build(B, s, rng, extras) {
  const { x, y, z, r, w, d } = s;
  B.frame(x, y, z, r);
  const floors = 5, fh = 2.95, H = floors * fh + 0.3, units = Math.floor(w / 6.2), uw = w / units, wc = jitter(rng, [0.8, 0.76, 0.69], 0.04); // muted: a white block in full sun blew out into bloom
  const front = [], backH = [], frontWins = [], doors = [];
  for (let f = 0; f < floors; f++) for (let u = 0; u < units; u++) {
    const cx = ((u + 0.5) / units - 0.5) * w, fy = 0.3 + f * fh;
    const h = { x0: cx - 1.65, x1: cx + 1.65, y0: fy + 0.05, y1: fy + 2.1, d: 0.16 }; front.push(h); frontWins.push([h, f, u]);
    const dh = { x0: cx - 0.45, x1: cx + 0.45, y0: fy + 0.02, y1: fy + 2.02, d: 0.12 }, wh = { x0: cx + 1.0, x1: cx + 1.9, y0: fy + 1.1, y1: fy + 1.9, d: 0.12 };
    backH.push(dh, wh); doors.push([dh, wh, f]);
  }
  boxWalls(B, 0, w, d, 0, H + 0.6, [['tiles', wc, 2.5]], fi => fi === 0 ? front : fi === 1 ? backH : [], [0.9, 0.88, 0.84]);
  const roofY = flatRoof(B, { w, d, y: H, para: 0.6, color: wc, wallMat: 'tiles' });
  inFrame(B, [0, 0, d / 2], 0, () => {
    for (const [h, f, u] of frontWins) {
      windowUnit(B, h, { rng, frame: [0.8, 0.82, 0.84], type: 'slide', sill: false });
      const cx = (h.x0 + h.x1) / 2, fy = 0.3 + f * fh;
      B.bbox('concrete', cx, fy - 0.18, 0.72, uw - 0.02, 0.2, 1.44, 0.015, { color: [0.7, 0.69, 0.67] });                     // slab with its edge
      B.bbox('concrete', cx, fy + 0.02, 1.4, uw - 0.02, 0.12, 0.1, 0.01, { color: [0.68, 0.67, 0.65] });                        // upstand
      B.bbox('alu', cx, fy + 0.14, 1.4, uw - 0.2, 0.05, 0.06, 0.008, { color: [0.72, 0.74, 0.76] });
      B.bbox('alu', cx, fy + 1.05, 1.4, uw - 0.2, 0.06, 0.08, 0.008, { color: [0.72, 0.74, 0.76] });
      B.quad('plain', [cx - uw / 2 + 0.12, fy + 0.19, 1.43], [cx + uw / 2 - 0.12, fy + 0.19, 1.43], [cx + uw / 2 - 0.12, fy + 1.05, 1.43], [cx - uw / 2 + 0.12, fy + 1.05, 1.43], { color: [0.55, 0.6, 0.63] }); // matte frosted panel
      B.quad('plain', [cx + uw / 2 - 0.12, fy + 0.19, 1.425], [cx - uw / 2 + 0.12, fy + 0.19, 1.425], [cx - uw / 2 + 0.12, fy + 1.05, 1.425], [cx + uw / 2 - 0.12, fy + 1.05, 1.425], { color: [0.5, 0.54, 0.56] });
      for (let k = 0; k <= 4; k++) B.bbox('alu', cx - uw / 2 + 0.12 + k * (uw - 0.24) / 4, fy + 0.14, 1.4, 0.04, 0.95, 0.05, 0.006, { color: [0.72, 0.74, 0.76] });
      B.bbox('plain', cx + uw / 2 - 0.02, fy + 0.02, 0.72, 0.04, fh - 0.25, 1.36, 0.01, { color: [0.72, 0.72, 0.7] });        // fire-escape partition
      if (rng() < 0.45) acUnit(B, cx - uw / 2 + 0.7, fy + 0.02, rng, { pipeTo: fy + 2.25, z: 0.35 });
      B.bbox('alu', cx, fy + 1.9, 0.4, uw - 0.8, 0.03, 0.03, 0.005, { color: [0.62, 0.64, 0.66] });
      if (rng() < 0.35) for (let i = 0; i < 4; i++) B.box('plain', cx - uw / 2 + 0.8 + i * 0.7, fy + 1.3, 0.4, 0.45, 0.6, 0.02, { color: jitter(rng, pick(rng, [[0.95, 0.95, 0.95], [0.5, 0.62, 0.9], [0.95, 0.6, 0.62], [0.98, 0.86, 0.5]]), 0.1) });
      void u;
    }
  });
  inFrame(B, [0, 0, -d / 2], Math.PI, () => {
    for (const [dh, wh, f] of doors) {
      doorUnit(B, dh, { color: jitter(rng, [0.5, 0.42, 0.34], 0.06), mat: 'metal', frame: [0.4, 0.4, 0.42], trim: [0.8, 0.78, 0.74] });
      windowUnit(B, wh, { rng, grille: true, frosted: rng() < 0.6 });
      meterBox(B, (dh.x0 + dh.x1) / 2 - 0.8, dh.y0 + 1.3, 'power');
      void f;
    }
    for (let f = 1; f < floors; f++) { const fy = 0.3 + f * fh;
      B.bbox('concrete', 0, fy - 0.17, 0.8, w + 0.4, 0.17, 1.6, 0.012, { color: [0.8, 0.8, 0.78] });
      B.bbox('concrete', 0, fy, 1.55, w + 0.4, 1.1, 0.12, 0.012, { color: [0.86, 0.85, 0.82] });
      B.bbox('concrete', 0, fy + 1.1, 1.55, w + 0.46, 0.05, 0.18, 0.008, { color: [0.7, 0.7, 0.68] });
      lampPoints.push({ p: B.P([0, fy + 2.2, 1.2]), s: 0.4 }); }
    // open switch-back stair at one end: floor landings flush with the access corridors, half landings at the far end,
    // two flights per storey with stepped treads over a raking slab, concrete parapets and corner columns
    {
      const x0 = w / 2 + 0.2, x1 = w / 2 + 3.0, xm = (x0 + x1) / 2, zL = 1.6, zM = 3.8, zE = 5.0, cc = [0.84, 0.83, 0.8], pc = mul(wc, 0.97);
      for (const [cx2, cz2] of [[x0 + 0.15, zE - 0.15], [x1 - 0.15, zE - 0.15], [x1 - 0.15, 0.15]]) B.bbox('concrete', cx2, 0, cz2, 0.3, H + 0.9, 0.3, 0.02, { color: cc });
      for (let f = 0; f < floors; f++) {
        const fy = 0.3 + f * fh, my = fy + fh / 2;
        if (f > 0) B.bbox('concrete', xm, fy - 0.17, zL / 2, x1 - x0, 0.17, zL, 0.01, { color: cc });                  // floor landing
        B.bbox('concrete', xm, my - 0.17, (zM + zE) / 2, x1 - x0, 0.17, zE - zM, 0.01, { color: cc });                  // half landing
        B.bbox('tiles', xm, my, zE - 0.06, x1 - x0, 1.1, 0.12, 0.01, { color: pc, uv: 2.5 });                          // its parapet
        if (f === floors - 1) { B.bbox('tiles', x1 - 0.06, fy + fh, zL / 2, 0.12, 1.1, zL, 0.01, { color: pc, uv: 2.5 }); }
        const flight = (xa, xb, ya, yb, za, zb) => {
          const n = 8, xc = (xa + xb) / 2;
          for (let i = 0; i < n; i++) { const zz = za + (zb - za) * (i + 0.5) / n, yy = ya + (yb - ya) * (i + 1) / n; B.bbox('concrete', xc, yy - 0.18, zz, xb - xa, 0.18, Math.abs(zb - za) / n + 0.01, 0.006, { color: cc }); }
          B.beam('concrete', [xc, ya - 0.2, za], [xc, yb - 0.2, zb], xb - xa, 0.14, { color: mul(cc, 0.92) });   // raking slab
          const ex = xa < xm ? xa + 0.05 : xb - 0.05;
          B.beam('tiles', [ex, ya + 0.55, za], [ex, yb + 0.55, zb], 0.1, 1.1, { color: pc, uv: 2.5 });          // side parapet
          B.beam('steel', [xa < xm ? xb - 0.05 : xa + 0.05, ya + 0.85, za], [xa < xm ? xb - 0.05 : xa + 0.05, yb + 0.85, zb], 0.04, 0.04, { color: [0.62, 0.64, 0.66] }); // handrail
        };
        flight(x0, xm - 0.08, fy, my, zL, zM);        // up and away from the corridor
        flight(xm + 0.08, x1, my, fy + fh, zM, zL);   // and back to the next floor
      }
      B.bbox('concrete', xm, H + 0.75, zE / 2, x1 - x0 + 0.3, 0.15, zE + 0.2, 0.01, { color: cc });                    // canopy slab over the top
    }
    for (const e of [-1, 1]) downpipe(B, [e * (w / 2 - 0.4), H + 0.3, 0.02], [e * (w / 2 - 0.4), 0, 0.08], 0, [0.7, 0.7, 0.68]);
  });
  extras.push({ t: 'box', p: B.P([-w / 2 - 1.6, 0, -d / 2 - 2.5]), hx: 1.4, hz: 2.5, r });
  B.bbox('metal', w / 2 - 3, roofY, 0, 2.2, 1.8, 2.2, 0.03, { color: [0.85, 0.85, 0.82] }); // water tank
  B.bbox('concrete', -w / 2 + 2.5, roofY, 0, 2.6, 2.2, 2.6, 0.02, { color: mul(wc, 0.92) }); // machine room
  for (let i = 0; i < 3; i++) inFrame(B, [-w / 6 + i * 2.2, 0, -d / 4], 0, () => acUnit(B, 0, roofY, rng, { pipeTo: roofY + 0.4 }));
  antenna(B, w / 4, roofY, d / 4);
  for (let f = 0; f < floors; f++) lampPoints.push({ p: B.P([0, 0.3 + f * fh + 2.2, -d / 2 - 1.2]), s: 0.4 });
  extras.push({ t: 'box', p: B.P([0, 0, 0]), hx: w / 2, hz: d / 2, r });
}

// ---------------------------------------------------------------- service yard buildings and open lots
const TRADES = ['桜川運輸', '山田工業', '中村鉄工所', '川口建材', '森田自動車', '桜川農協'];
// steel-clad warehouse / workshop: box-profile walls, low metal gable roof, roll-up door, personnel door, a high band of
// windows, concrete apron, company sign, pallets
function warehouse_build(B, s, rng, extras) {
  const { x, y, z, r, w, d } = s;
  B.frame(x, y, z, r);
  const W = w - 3, D = d - 7, H = 5.4 + rng() * 1.6, wc = jitter(rng, pick(rng, [[0.72, 0.78, 0.82], [0.86, 0.84, 0.78], [0.62, 0.7, 0.64], [0.8, 0.8, 0.82], [0.78, 0.66, 0.56]]), 0.04);
  const roofC = pick(rng, [[0.36, 0.4, 0.44], [0.5, 0.32, 0.26], [0.3, 0.42, 0.52]]), zc = -d / 2 + 1.2 + D / 2;
  inFrame(B, [0, 0, zc], 0, () => {
    const sh = { x0: -W / 2 + 1.2, x1: -W / 2 + 1.2 + Math.min(5, W * 0.4), y0: 0.05, y1: 4.3, d: 0.1, noSill: true };
    const dr = { x0: W / 2 - 2.2, x1: W / 2 - 1.3, y0: 0.05, y1: 2.1, d: 0.1 };
    const band = []; for (let k = 0; k < Math.floor(W / 3.2); k++) { const cx = -W / 2 + 1.6 + k * 3.2; if (cx > sh.x1 + 0.4 || cx < sh.x0 - 1.4) band.push({ x0: cx - 1.1, x1: cx + 1.1, y0: H - 1.7, y1: H - 0.9, d: 0.08 }); }
    const side = [-1, 1].map(k => ({ x0: k * D / 4 - 1.1, x1: k * D / 4 + 1.1, y0: H - 1.7, y1: H - 0.9, d: 0.08 }));
    boxWalls(B, 0, W, D, 0, H, [['metalWall', wc, 1.2]], fi => fi === 0 ? [sh, dr, ...band] : fi >= 2 ? side : [], mul(wc, 0.9));
    B.bbox('concrete', 0, 0, 0, W + 0.2, 0.35, D + 0.2, 0.01, { color: [0.7, 0.7, 0.68], skip: 'ny' });
    inFrame(B, [0, 0, D / 2], 0, () => {
      B.quad('shutter', [sh.x0, sh.y0, -0.06], [sh.x1, sh.y0, -0.06], [sh.x1, sh.y1, -0.06], [sh.x0, sh.y1, -0.06], { color: jitter(rng, [0.74, 0.75, 0.74], 0.06), uv: 1.2 });
      B.bbox('alu', (sh.x0 + sh.x1) / 2, sh.y1 + 0.02, 0.18, sh.x1 - sh.x0 + 0.3, 0.45, 0.36, 0.02, { color: [0.7, 0.7, 0.7] });
      for (const xx of [sh.x0 - 0.06, sh.x1 + 0.06]) B.bbox('alu', xx, 0, 0.05, 0.1, sh.y1, 0.1, 0.008, { color: [0.62, 0.62, 0.62] });
      doorUnit(B, dr, { color: jitter(rng, [0.62, 0.64, 0.66], 0.08), mat: 'metal', frame: [0.5, 0.5, 0.5] });
      B.bbox('roofMetal', (dr.x0 + dr.x1) / 2, 2.3, 0.4, 1.4, 0.06, 0.8, 0.01, { color: roofC });
      for (const h of band) windowUnit(B, h, { rng, type: 'grid', sill: false, glass: [0.9, 0.9, 0.9] });
      const sign = signMesh(Math.min(6, W * 0.5), 0.9, (g, W2, H2) => { g.fillStyle = '#f4f2ea'; g.fillRect(0, 0, W2, H2); g.fillStyle = pick(rng, ['#1d3e7a', '#8a1f1a', '#1f5a32']); g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `bold ${H2 * 0.58}px "Yu Gothic", "Meiryo", sans-serif`; g.fillText(pick(rng, TRADES), W2 / 2, H2 * 0.54); }, 0.4);
      sign.position.set(...B.P([W / 4, H - 0.4, 0.06])); sign.rotation.y = r; scene.add(sign);
      B.bbox('concrete', 0, -0.02, 3.2, W + 1.5, 0.08, 6.4, 0.01, { color: [0.72, 0.72, 0.7], skip: 'ny', uv: 3 });
      for (let k = 0; k < 3; k++) if (rng() < 0.7) { const px = sh.x1 + 1.2 + k * 1.3, n = 1 + Math.floor(rng() * 4);
        for (let j = 0; j < n; j++) { B.bbox('wood', px, j * 0.15, 1.2, 1.1, 0.14, 1.1, 0.01, { color: [0.72, 0.58, 0.4] }); } }
    });
    inFrame(B, [0, 0, -D / 2], Math.PI, () => { for (const e of [-1, 1]) acUnit(B, e * W / 4, 0, rng, { pipeTo: 2.6 }); });
    for (const e of [-1, 1]) inFrame(B, [e * W / 2, 0, 0], e * Math.PI / 2, () => { for (const h of side) windowUnit(B, h, { rng, type: 'grid', sill: false, glass: [0.9, 0.9, 0.9] }); });
    gableRoof(B, { w: W, d: D, y: H, pitch: 0.16 + rng() * 0.08, over: 0.4, rake: 0.25, mat: 'roofMetal', color: roofC, wallMat: 'metalWall', wallColor: wc, wallUv: 1.2, gutterColor: [0.7, 0.7, 0.7] });
    extras.push({ t: 'box', p: B.P([0, 0, 0]), hx: W / 2, hz: D / 2, r });
  });
}
// monthly car park (月極駐車場): asphalt with bays, wheel stops, a sign; returns bay spots for parked cars
function carPark_build(B, s, rng, extras) {
  const { x, y, z, r, w, d } = s;
  B.frame(x, y, z, r);
  B.bbox('asphalt', 0, -0.06, 0, w, 0.1, d, 0.01, { color: [1, 1, 1], skip: 'ny', uv: 4 });
  const n = Math.floor((w - 0.6) / 2.5), x0 = -n * 2.5 / 2, spots = [];
  for (let i = 0; i <= n; i++) B.box('paint', x0 + i * 2.5, 0.045, -d / 2 + 0.6 + 2.5, 0.1, 0.004, 5, { color: [0.94, 0.94, 0.92] });
  for (let i = 0; i < n; i++) {
    B.detail(1, () => B.bbox('concrete', x0 + (i + 0.5) * 2.5, 0.04, -d / 2 + 1.25, 1.6, 0.1, 0.14, 0.02, { color: [0.8, 0.8, 0.78] }));
    B.box('paint', x0 + (i + 0.5) * 2.5, 0.045, -d / 2 + 0.9, 0.5, 0.004, 0.25, { color: [0.95, 0.85, 0.2] }); // bay number plate
    spots.push({ p: B.P([x0 + (i + 0.5) * 2.5, 0.04, -d / 2 + 3.1]), r: r + Math.PI });
  }
  for (const e of [-1, 1]) B.detail(1, () => { for (let k = 0; k <= Math.round(d / 2); k++) B.cyl('steel', e * (w / 2 - 0.1), 0, -d / 2 + k * d / Math.round(d / 2), 0.03, 0.03, 0.6, 6, { color: [0.85, 0.85, 0.8], cap: true }); B.beam('steel', [e * (w / 2 - 0.1), 0.55, -d / 2], [e * (w / 2 - 0.1), 0.55, d / 2], 0.03, 0.03, { color: [0.85, 0.85, 0.8] }); });
  const sp = [w / 2 - 0.6, 0, d / 2 - 0.3];
  B.detail(1, () => { for (const sx of [-0.45, 0.45]) B.cyl('steel', sp[0] + sx, 0, sp[2], 0.03, 0.03, 1.9, 6, { color: [0.75, 0.75, 0.72], cap: true }); });
  const sign = signMesh(1.1, 0.8, (g, W2, H2) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, W2, H2); g.fillStyle = '#1b4f9c'; g.fillRect(0, 0, W2, H2 * 0.3);
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `bold ${H2 * 0.2}px "Yu Gothic", "Meiryo", sans-serif`; g.fillText('月極駐車場', W2 / 2, H2 * 0.16);
    g.fillStyle = '#222'; g.font = `${H2 * 0.14}px "Yu Gothic", "Meiryo", sans-serif`; g.fillText('空きあり', W2 / 2, H2 * 0.5); g.fillText('桜川不動産', W2 / 2, H2 * 0.78); }, 0.2);
  sign.position.set(...B.P([sp[0], 1.4, sp[2] + 0.04])); sign.rotation.y = r; scene.add(sign);
  return spots;
}
// allotment (家庭菜園): raised soil ridges with crops, a cucumber frame, a tool box
// plastic tunnel greenhouse (ビニールハウス): galvanised hoops every 1.5 m on ground pipes, purlins along the ridge and
// shoulders, milky film with the side vents rolled up, end walls framed in pipe with a film-covered sliding door (one
// end propped open), raised beds inside with crops, a water tank and hose outside. w: span, d: length.
function greenhouse_build(B, s, rng, gy) {
  const { x, y, z, r, w = 5.4, d = 24, film = 'new' } = s, h = s.h || 3.0, R2 = w / 2, n = 12, PIPE = [0.72, 0.74, 0.76];
  // fresh film is clear, a season-old one milky and yellowed; a bare frame is a house whose film came off for winter
  const FILM = film === 'old' ? [0.9, 0.9, 0.78] : [0.93, 0.96, 0.97], bare = film === 'bare';
  B.frame(x, y, z, r);
  if (gy) soilPatch(B, frameGround(B, y, gy), -R2 - 0.3, -d / 2 - 0.3, R2 + 0.3, d / 2 + 0.3, jitter(rng, [0.44, 0.34, 0.27], 0.04));
  const arc = i => { const a = Math.PI * i / n; return [-Math.cos(a) * R2, 1.1 + Math.sin(a) * (h - 1.1)]; };
  const pipe = (a, b, rad = 0.022) => B.sweep('steel', [[rad, 0], [0, rad], [-rad, 0], [0, -rad]], [a, b], { closed: true, color: PIPE });
  const hoops = []; for (let zz = -d / 2; zz <= d / 2 + 1e-3; zz += 1.5) hoops.push(zz);
  for (const zz of hoops) { for (let i = 0; i < n; i++) { const p = arc(i), q = arc(i + 1); pipe([p[0], p[1], zz], [q[0], q[1], zz]); }
    for (const s2 of [-1, 1]) pipe([s2 * R2, -0.3, zz], [s2 * R2, 1.1, zz]); }
  for (const i of [0, 3, 6, 9, 12]) { const p = arc(i); pipe([p[0], p[1], -d / 2], [p[0], p[1], d / 2], 0.018); }                         // purlins
  for (const s2 of [-1, 1]) pipe([s2 * R2, 0.05, -d / 2], [s2 * R2, 0.05, d / 2], 0.018);                                                // ground pipes
  // film: the arch between the rolled-up side vents, low skirts below them
  if (!bare) for (let i = 1; i < n - 1; i++) { const p = arc(i), q = arc(i + 1); B.quad('poly', [p[0], p[1], -d / 2], [p[0], p[1], d / 2], [q[0], q[1], d / 2], [q[0], q[1], -d / 2], { color: FILM }); }
  if (!bare) { const p = arc(0), q = arc(1); for (const [a, b] of [[p, q], [arc(n), arc(n - 1)]]) B.quad('poly', [a[0], a[1] + 0.35, -d / 2], [a[0], a[1] + 0.35, d / 2], [b[0], b[1], d / 2], [b[0], b[1], -d / 2], { color: FILM }); }
  if (!bare) for (const s2 of [-1, 1]) { B.quad('poly', [s2 * R2, 0.0, -d / 2], [s2 * R2, 0.0, d / 2], [s2 * R2, 0.45, d / 2], [s2 * R2, 0.45, -d / 2], { color: FILM });
    B.sweep('plain', [[0.055, 0], [0, 0.055], [-0.055, 0], [0, -0.055]], [[s2 * R2, 1.05, -d / 2], [s2 * R2, 1.05, d / 2]], { closed: true, color: [0.86, 0.88, 0.88] }); } // rolled vent
  // end walls: film on a pipe frame, a sliding door with its own frame; the south door stands open
  if (!bare) for (const e of [-1, 1]) {
    const zz = e * d / 2, open = e > 0;
    for (let i = 0; i < n; i++) { const p = arc(i), q = arc(i + 1); B.poly('poly', [[0, 1.1, zz], [p[0], p[1], zz], [q[0], q[1], zz]], [0, 0, e], { color: FILM }); }
    for (const s2 of [-1, 1]) B.quad('poly', [s2 * 0.6, 0, zz], [s2 * R2, 0, zz], [s2 * R2, 1.1, zz], [s2 * 0.6, 1.1, zz], { color: FILM });
    for (const px of [-0.6, 0.6]) pipe([px, 0, zz], [px, 2.25, zz], 0.025);
    pipe([-0.6, 2.25, zz], [0.6, 2.25, zz], 0.025); pipe([-0.62, 2.28, zz + e * 0.05], [1.9, 2.28, zz + e * 0.05], 0.015);                // door head + rail
    const dx = open ? 1.2 : 0;                                                                                                            // door leaf (pipe frame + film)
    for (const px of [-0.58 + dx, 0.58 + dx]) pipe([px, 0.02, zz + e * 0.07], [px, 2.2, zz + e * 0.07], 0.018);
    for (const py of [0.02, 1.1, 2.2]) pipe([-0.58 + dx, py, zz + e * 0.07], [0.58 + dx, py, zz + e * 0.07], 0.018);
    B.quad('poly', [-0.56 + dx, 0.04, zz + e * 0.07], [0.56 + dx, 0.04, zz + e * 0.07], [0.56 + dx, 2.18, zz + e * 0.07], [-0.56 + dx, 2.18, zz + e * 0.07], { color: FILM });
    if (!open) B.quad('poly', [-0.58, 1.1, zz], [0.58, 1.1, zz], [0.58, 2.25, zz], [-0.58, 2.25, zz], { color: FILM });
  }
  // inside: three raised beds with a crop per house, drip line, a walkway of boards
  const crop = rng() < 0.5 ? 'tomato' : rng() < 0.5 ? 'cucumber' : 'greens';
  B.detail(1, () => {
    for (let k = -1; k <= 1; k++) { const bx = k * 1.6;
      B.bbox('plain', bx, -0.04, 0, 0.9, 0.26, d - 1.4, 0.08, { color: [0.36, 0.27, 0.2] });
      B.box('dark', bx, 0.22, 0, 0.9, 0.005, d - 1.5, { color: [0.12, 0.12, 0.13] });                                                     // black mulch film
      for (let zz = -d / 2 + 1.1; zz < d / 2 - 0.8; zz += crop === 'greens' ? 0.3 : 0.5)
        if (crop === 'greens') for (const lx of [-0.2, 0.2]) plant(B, 'greens', bx + lx, 0.22, zz, rng); else plant(B, crop === 'tomato' ? 'tomato' : 'vine', bx, 0.22, zz, rng, crop === 'tomato' ? 1 : 1.3);
      if (crop !== 'greens') B.box('steel', bx, 1.95, 0, 0.02, 0.02, d - 1.4, { color: [0.7, 0.72, 0.74] });                              // support wire
    }
    for (const k of [-0.8, 0.8]) for (let zz = -d / 2 + 0.6; zz < d / 2 - 0.4; zz += 1.2) B.bbox('wood', k, 0, zz, 0.5, 0.04, 1.1, 0.01, { color: [0.62, 0.5, 0.36] });
  });
  // outside the open end: a blue water tank on blocks, a coiled hose, crates
  B.bbox('concrete', R2 + 0.9, 0, d / 2 - 1.5, 0.9, 0.2, 0.9, 0.02, { color: [0.62, 0.62, 0.6] });
  B.cyl('plastic', R2 + 0.9, 0.2, d / 2 - 1.5, 0.42, 0.42, 1.0, 16, { color: [0.2, 0.42, 0.72], cap: true });
  B.detail(1, () => { B.sweep('plastic', circle(0.02, 6), Array.from({ length: 13 }, (_, i) => [R2 + 0.6 + Math.cos(i * 0.9) * 0.28, 0.03 + i * 0.012, d / 2 - 0.4 + Math.sin(i * 0.9) * 0.28]), { color: [0.1, 0.5, 0.3] });
    for (let k = 0; k < 3; k++) B.bbox('plastic', R2 + 0.5, k * 0.28, d / 2 + 0.6, 0.52, 0.27, 0.36, 0.02, { color: [0.24, 0.52, 0.3] }); });
}
// plant a crop (crops.js) at a point of the current frame, turned by yaw (plus a little random turn)
function plant(B, type, lx, ly, lz, rng, s = 1, t = null) { const p = B.P([lx, ly, lz]); cropSet.add(type, p[0], p[1], p[2], B.F.r + rng() * Math.PI * 2, s * (0.85 + rng() * 0.3), t); }
// kitchen garden plot (家庭菜園): a low block edge with a wire fence and gate on the street side, ridged beds (畝) of
// different crops — cabbages, leeks, tomatoes on cane frames, eggplants, potatoes, some under black or silver mulch
// film — a cucumber net, bird netting over the brassicas, paths of trodden earth, a tool box, water tank and hose,
// compost bin and a wheelbarrow. Local frame: the street side is +z.
function allotment_build(B, s, rng, gy) {
  const { x, y, z, r, w, d } = s;
  B.frame(x, y, z, r);
  const SOIL = [0.5, 0.39, 0.3], LEAF = [0.34, 0.6, 0.3];
  if (gy) soilPatch(B, frameGround(B, y, gy), -w / 2 + 0.06, -d / 2 + 0.06, w / 2 - 0.06, d / 2 - 0.06, jitter(rng, [0.48, 0.37, 0.28], 0.04)); // paths of trodden earth
  // edge + fence
  for (const [ax, az, bx, bz] of [[-w / 2, -d / 2, w / 2, -d / 2], [-w / 2, -d / 2, -w / 2, d / 2], [w / 2, -d / 2, w / 2, d / 2], [-w / 2, d / 2, w / 2 - 1.6, d / 2]]) {
    B.beam('concrete', [ax, 0.06, az], [bx, 0.06, bz], 0.12, 0.2, { color: [0.7, 0.7, 0.68] });
    const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 2));
    B.detail(1, () => { for (let k = 0; k <= n; k++) B.cyl('steel', ax + (bx - ax) * k / n, 0.1, az + (bz - az) * k / n, 0.02, 0.02, 1.0, 6, { color: [0.35, 0.5, 0.36] });
      B.quad('chain', [ax, 0.2, az], [bx, 0.2, bz], [bx, 1.05, bz], [ax, 1.05, az], { uv: 0.12, color: [0.3, 0.45, 0.32] }); });
  }
  B.bbox('steel', w / 2 - 0.8, 0.1, d / 2, 1.5, 0.9, 0.04, 0.01, { color: [0.35, 0.5, 0.36] });                                          // gate
  // beds run across the plot; the back 2.4 m is the working corner
  const bedsZ0 = -d / 2 + 2.6, bedsZ1 = d / 2 - 1.4, bw = 0.8, pitch = 1.35, nb = Math.max(2, Math.floor((w - 1.6) / pitch));
  const kinds = ['cabbage', 'leek', 'tomato', 'eggplant', 'potato', 'greens', 'cucumber', 'mulch'];
  const offset = Math.floor(rng() * kinds.length);
  for (let i = 0; i < nb; i++) {
    const bx = -w / 2 + 0.9 + (i + 0.5) * (w - 1.8) / nb, L = bedsZ1 - bedsZ0, zc = (bedsZ0 + bedsZ1) / 2, kind = kinds[(i + offset) % kinds.length];
    B.poly('soil', [[bx - bw / 2 - 0.12, 0.02, bedsZ0], [bx - bw / 2 - 0.12, 0.02, bedsZ1], [bx - bw / 2 + 0.08, 0.22, bedsZ1], [bx - bw / 2 + 0.08, 0.22, bedsZ0]], [-1, 1, 0], { color: SOIL, uv: 1 });
    B.poly('soil', [[bx + bw / 2 + 0.12, 0.02, bedsZ0], [bx + bw / 2 + 0.12, 0.02, bedsZ1], [bx + bw / 2 - 0.08, 0.22, bedsZ1], [bx + bw / 2 - 0.08, 0.22, bedsZ0]], [1, 1, 0], { color: SOIL, uv: 1 });
    B.box('soil', bx, 0.02, zc, bw - 0.16, 0.2, L, { color: mul(SOIL, 1.08), skip: 'ny', uv: 2.5 });
    for (const e of [bedsZ0, bedsZ1]) B.poly('soil', [[bx - bw / 2 - 0.12, 0.02, e], [bx + bw / 2 + 0.12, 0.02, e], [bx + bw / 2 - 0.08, 0.22, e], [bx - bw / 2 + 0.08, 0.22, e]], [0, 0, e > 0 ? 1 : -1], { color: SOIL });
    if (kind === 'mulch' || kind === 'eggplant' || kind === 'tomato') B.box('dark', bx, 0.222, zc, bw - 0.1, 0.004, L - 0.1, { color: kind === 'mulch' ? [0.72, 0.74, 0.76] : [0.1, 0.1, 0.11] });
    B.detail(1, () => {
      for (let zz = bedsZ0 + 0.35; zz < bedsZ1 - 0.2; zz += kind === 'leek' ? 0.2 : kind === 'greens' ? 0.3 : 0.45) {
        const T = { cabbage: 'cabbage', leek: 'leek', potato: 'potato', greens: 'greens', eggplant: 'eggplant' }[kind];
        if (T) for (const lx of kind === 'leek' || kind === 'greens' ? [-0.18, 0.18] : [0]) plant(B, T, bx + lx, 0.22, zz, rng);
        else if (kind === 'tomato') for (const lx of [-0.2, 0.2]) plant(B, 'tomato', bx + lx, 0.22, zz, rng, 0.95);
      }
      if (kind === 'tomato') for (const lx of [-0.2, 0.2]) B.box('wood', bx + lx, 1.72, (bedsZ0 + bedsZ1) / 2, 0.02, 0.02, L - 0.3, { color: [0.62, 0.52, 0.36] });
      if (kind === 'cucumber') { // net on an A-frame
        for (let zz = bedsZ0 + 0.3; zz < bedsZ1; zz += 1.2) for (const sd of [-1, 1]) B.beam('plain', [bx + sd * 0.35, 0.2, zz], [bx, 1.85, zz], 0.025, 0.025, { color: [0.3, 0.55, 0.35] });
        for (const sd of [-1, 1]) B.quad('chain', [bx + sd * 0.35, 0.25, bedsZ0 + 0.3], [bx + sd * 0.35, 0.25, bedsZ1 - 0.2], [bx, 1.85, bedsZ1 - 0.2], [bx, 1.85, bedsZ0 + 0.3], { uv: 0.2, color: [0.2, 0.55, 0.3] });
        for (let k = 0; k < Math.floor(L * 2.5); k++) { const t = rng(), sd = rng() < 0.5 ? -1 : 1; plant(B, 'vine', bx + sd * 0.35 * (1 - t), 0.25 + t * 1.4, bedsZ0 + 0.4 + rng() * (L - 0.8), rng); }
      }
      if (kind === 'cabbage') { for (let zz = bedsZ0 + 0.2; zz <= bedsZ1 + 0.01; zz += (L - 0.4) / Math.max(1, Math.round(L / 1.5))) { const hoop = []; for (let k = 0; k <= 8; k++) { const a = Math.PI * k / 8; hoop.push([bx - Math.cos(a) * 0.5, 0.2 + Math.sin(a) * 0.55, zz]); } B.sweep('plastic', circle(0.008, 5), hoop, { color: [0.3, 0.6, 0.7] }); }
        B.quad('poly', [bx - 0.5, 0.2, bedsZ0 + 0.2], [bx - 0.5, 0.2, bedsZ1], [bx, 0.75, bedsZ1], [bx, 0.75, bedsZ0 + 0.2], { color: [0.9, 0.95, 0.95] });
        B.quad('poly', [bx, 0.75, bedsZ0 + 0.2], [bx, 0.75, bedsZ1], [bx + 0.5, 0.2, bedsZ1], [bx + 0.5, 0.2, bedsZ0 + 0.2], { color: [0.9, 0.95, 0.95] }); }
    });
  }
  // working corner: tool box, blue water barrel with a watering can, compost bin, wheelbarrow, fertiliser bags
  { const sc = pick(rng, [[0.86, 0.82, 0.7], [0.62, 0.72, 0.6], [0.78, 0.74, 0.62], [0.55, 0.62, 0.72]]), tx = -w / 2 + 1.2, tz = -d / 2 + 1.0; // steel tool locker on blocks
    for (const ox of [-0.5, 0.5]) B.box('concrete', tx + ox, 0, tz, 0.2, 0.1, 0.6, { color: [0.62, 0.62, 0.6] });
    B.bbox('metal', tx, 0.1, tz, 1.3, 1.25, 0.66, 0.012, { color: sc }); B.bbox('metal', tx, 1.35, tz, 1.42, 0.05, 0.8, 0.01, { color: mul(sc, 0.8) });
    B.detail(1, () => { for (const dx of [-0.32, 0, 0.32]) B.box('dark', tx + dx, 0.16, tz + 0.331, 0.012, 1.12, 0.01, { color: [0.3, 0.3, 0.3] });
      B.box('steel', tx + 0.08, 0.72, tz + 0.34, 0.025, 0.14, 0.02, { color: [0.4, 0.4, 0.4] }); }); }
  B.cyl('plastic', -w / 2 + 2.6, 0, -d / 2 + 1.1, 0.3, 0.3, 0.9, 14, { color: [0.2, 0.4, 0.75], cap: true });
  B.detail(1, () => {
    B.cyl('plastic', -w / 2 + 3.2, 0, -d / 2 + 1.0, 0.12, 0.1, 0.26, 10, { color: [0.2, 0.62, 0.32], cap: true }); B.beam('plastic', [-w / 2 + 3.2, 0.2, -d / 2 + 1.1], [-w / 2 + 3.2, 0.32, -d / 2 + 1.45], 0.02, 0.02, { color: [0.2, 0.62, 0.32] });
    B.cyl('plain', w / 2 - 1.2, 0, -d / 2 + 1.0, 0.42, 0.32, 0.78, 14, { color: [0.15, 0.15, 0.16], cap: true }); B.cyl('plain', w / 2 - 1.2, 0.78, -d / 2 + 1.0, 0.36, 0.3, 0.07, 14, { color: [0.2, 0.2, 0.21], cap: true }); // compost bin
    B.bbox('metal', w / 2 - 2.6, 0.35, -d / 2 + 1.2, 0.6, 0.28, 0.9, 0.04, { color: [0.2, 0.5, 0.35] }); B.cyl('plastic', w / 2 - 2.6, 0.18, -d / 2 + 1.8, 0.18, 0.18, 0.08, 10, { color: [0.12, 0.12, 0.12] }); // wheelbarrow
    for (const sd of [-1, 1]) B.beam('steel', [w / 2 - 2.6 + sd * 0.25, 0.4, -d / 2 + 0.7], [w / 2 - 2.6 + sd * 0.25, 0.1, -d / 2 + 0.6], 0.02, 0.02, { color: [0.3, 0.3, 0.3] });
    for (let k = 0; k < 3; k++) B.bbox('plain', -w / 2 + 4.0 + k * 0.1, 0, -d / 2 + 1.0 + k * 0.05, 0.5, 0.18, 0.35, 0.08, { color: k % 2 ? [0.86, 0.82, 0.68] : [0.85, 0.72, 0.55] });
  });
}

// tilled soil draped over the ground in 2 m cells (gy: world ground height), in the current frame; lift raises it
function soilPatch(B, at, x0, z0, x1, z1, col, US = 2.5) {
  const nx = Math.max(1, Math.round((x1 - x0) / 2)), nz = Math.max(1, Math.round((z1 - z0) / 2));
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const a = x0 + (x1 - x0) * i / nx, b = x0 + (x1 - x0) * (i + 1) / nx, c = z0 + (z1 - z0) * j / nz, e = z0 + (z1 - z0) * (j + 1) / nz;
    B.quad('soil', [a, at(a, e), e], [b, at(b, e), e], [b, at(b, c), c], [a, at(a, c), c], { color: col, uvs: [[a / US, e / US], [b / US, e / US], [b / US, c / US], [a / US, c / US]] });
  }
}
// ground height in the current frame, from a world height function (2 cm clear of the terrain)
const frameGround = (B, y, gy) => (lx, lz) => { const p = B.P([lx, 0, lz]); return gy(p[0], p[2]) - y + 0.02; };
// open vegetable field (露地畑) at the edge of town: tilled soil draped over the ground and ridged rows (畝) along local
// z that follow it, in blocks of different crops — cabbage, napa cabbage, daikon, leeks earthed up high, potatoes,
// taro with big leaves, white row-cover tunnels, black or silver mulch with seedlings, a fallow strip. A bare headland
// runs round the edge; an irrigation standpipe with a hose stands at one corner; the far end often has a corrugated tool
// shed, a water drum, crates and a heap under a blue tarp, and now and then a scarecrow stands in a furrow.
function field_build(B, s, rng, gy) {
  const { x, y, z, r, w, d, shed = false } = s;
  B.frame(x, y, z, r);
  const at = frameGround(B, y, gy), US = 2.5;
  const SOIL = jitter(rng, [0.46, 0.35, 0.27], 0.05), DRY = mul(SOIL, 1.1);
  const planar = pts => pts.map(p => [p[0] / US, p[2] / US]);
  const q4 = (mat, a, b, c, e, col) => B.quad(mat, a, b, c, e, { color: col, uvs: planar([a, b, c, e]) });
  soilPatch(B, at, -w / 2, -d / 2, w / 2, d / 2, SOIL, US);
  const HL = 0.9, zA = -d / 2 + HL, zB = d / 2 - HL - (shed ? 3.6 : 0), pitch = 1.15 + rng() * 0.3, n = Math.max(2, Math.floor((w - 2 * HL) / pitch));
  const nz = Math.max(2, Math.ceil((zB - zA) / 2)), xr0 = -n * pitch / 2;
  const LEAF = { cabbage: [0.36, 0.56, 0.36], napa: [0.44, 0.62, 0.36], daikon: [0.26, 0.48, 0.28], potato: [0.32, 0.5, 0.26], taro: [0.3, 0.52, 0.32], leek: [0.36, 0.56, 0.42] };
  const ridge = (xc, kind) => {
    const bw = pitch * 0.42, tw = pitch * (kind === 'leek' ? 0.15 : 0.27), hh = kind === 'leek' ? 0.32 : kind === 'fallow' ? 0.1 : 0.19 + rng() * 0.05;
    const film = kind === 'mulchB' ? [0.06, 0.06, 0.07] : kind === 'mulchS' ? [0.7, 0.72, 0.74] : null;
    const mat = film ? 'plastic' : 'soil', topC = film || DRY, sideC = film || SOIL;
    const st = [];
    for (let k = 0; k <= nz; k++) { const zz = zA + (zB - zA) * k / nz, g = at(xc, zz);
      st.push({ zz, g, L0: [xc - bw, at(xc - bw, zz), zz], L1: [xc - tw, g + hh, zz], R1: [xc + tw, g + hh, zz], R0: [xc + bw, at(xc + bw, zz), zz] }); }
    for (let k = 0; k < nz; k++) { const p = st[k], q = st[k + 1];
      q4(mat, p.L0, q.L0, q.L1, p.L1, sideC); q4(mat, p.L1, q.L1, q.R1, p.R1, topC); q4(mat, p.R1, q.R1, q.R0, p.R0, sideC); }
    for (const [e, sg] of [[st[0], -1], [st[nz], 1]]) B.poly(mat, [e.L0, e.L1, e.R1, e.R0], [0, 0, sg], { color: sideC, uv: US });
    const topAt = zz => { const k = Math.min(nz - 1, Math.floor((zz - zA) / (zB - zA) * nz)), t = ((zz - zA) / (zB - zA) * nz) - k; return lerp(st[k].g, st[k + 1].g, t) + hh; };
    if (kind === 'tunnel') { // white non-woven row cover on hoops (トンネル)
      const R = bw * 0.95, H = 0.5, arcP = (k, zz, g) => { const a = Math.PI * k / 6; return [xc - Math.cos(a) * R, g + Math.sin(a) * H, zz]; };
      for (let k = 0; k < nz; k++) { const p = st[k], q = st[k + 1];
        for (let i = 0; i < 6; i++) q4('plain', arcP(i, p.zz, p.g), arcP(i, q.zz, q.g), arcP(i + 1, q.zz, q.g), arcP(i + 1, p.zz, p.g), [0.8, 0.82, 0.8]); }
      for (const [e, sg] of [[st[0], -1], [st[nz], 1]]) for (let i = 0; i < 6; i++) B.poly('plain', [[xc, e.g, e.zz], arcP(i, e.zz, e.g), arcP(i + 1, e.zz, e.g)], [0, 0, sg], { color: [0.76, 0.78, 0.76] });
      B.detail(1, () => { for (let zz = zA + 0.6; zz < zB; zz += 1.5) { const g = topAt(zz) - hh, hoop = []; for (let i = 0; i <= 8; i++) { const a = Math.PI * i / 8; hoop.push([xc - Math.cos(a) * (R + 0.02), g + Math.sin(a) * (H + 0.02), zz]); } B.sweep('plastic', circle(0.008, 5), hoop, { color: [0.3, 0.55, 0.75] }); } });
      return;
    }
    // the plants themselves (crops.js): spacing and rows per crop, a plant every few tens of centimetres along the ridge
    const SP = { cabbage: [0.42, [0]], napa: [0.45, [0]], daikon: [0.28, [0]], leek: [0.16, [0]], potato: [0.38, [0]], taro: [0.7, [0]], mulchB: [0.3, [-0.5, 0.5]], mulchS: [0.3, [-0.5, 0.5]] }[kind];
    const T = { cabbage: 'cabbage', napa: 'napa', daikon: 'daikon', leek: 'leek', potato: 'potato', taro: 'taro', mulchB: 'seedling', mulchS: 'seedling' }[kind];
    if (SP) for (let zz = zA + 0.3; zz < zB - 0.2; zz += SP[0]) for (const f of SP[1]) plant(B, T, xc + f * tw + (rng() - 0.5) * 0.05, topAt(zz) - 0.01, zz, rng);
    if (kind === 'fallow') for (let k = 0; k < (zB - zA) * 0.8; k++) { const zz = zA + rng() * (zB - zA); plant(B, 'greens', xc + (rng() - 0.5) * pitch, topAt(zz) - hh + 0.02, zz, rng, 0.6, [0.8, 0.85, 0.6]); }
  };
  const KINDS = ['cabbage', 'napa', 'daikon', 'leek', 'potato', 'taro', 'tunnel', 'mulchB', 'mulchS', 'fallow'];
  const rows = [];
  for (let i = 0; i < n;) { const kind = pick(rng, KINDS), m = Math.min(n - i, 3 + Math.floor(rng() * 6)); for (let k = 0; k < m; k++, i++) rows.push(kind); }
  rows.forEach((kind, i) => ridge(xr0 + (i + 0.5) * pitch, kind));
  // irrigation standpipe (給水栓) at the headland: grey pipe, blue valve wheel, spout, a hose looped on the ground
  { const sx = -w / 2 + 0.45, sz = -d / 2 + 0.45, g = at(sx, sz);
    B.cyl('plastic', sx, g - 0.2, sz, 0.05, 0.05, 1.0, 10, { color: [0.62, 0.64, 0.64], cap: true });
    B.cyl('plastic', sx, g + 0.8, sz, 0.1, 0.1, 0.03, 12, { color: [0.2, 0.36, 0.78], cap: true });
    B.detail(1, () => { B.beam('plastic', [sx, g + 0.62, sz], [sx + 0.16, g + 0.58, sz + 0.02], 0.035, 0.035, { color: [0.62, 0.64, 0.64] });
      B.sweep('plastic', circle(0.015, 6), Array.from({ length: 17 }, (_, i) => [sx + 0.55 + Math.cos(i * 0.8) * 0.3, g + 0.01 + i * 0.008, sz + 0.5 + Math.sin(i * 0.8) * 0.3]), { color: [0.2, 0.48, 0.3] }); }); }
  // the working end: tool shed, drum, crates, a heap under a blue tarp held down by tyres
  if (shed) {
    const cx = w / 2 - 1.9, cz = d / 2 - 1.35, SW = 2.6, SD = 1.9;
    const g0 = Math.min(at(cx - SW / 2, cz - SD / 2), at(cx + SW / 2, cz - SD / 2), at(cx - SW / 2, cz + SD / 2), at(cx + SW / 2, cz + SD / 2));
    const SH = pick(rng, [[0.55, 0.6, 0.62], [0.52, 0.4, 0.33], [0.6, 0.66, 0.56], [0.74, 0.72, 0.66]]);
    B.bbox('concrete', cx, g0 - 0.2, cz, SW + 0.2, 0.28, SD + 0.2, 0.02, { color: [0.62, 0.62, 0.6] });
    inFrame(B, [cx, g0 + 0.08, cz], 0, () => {
      const H = 2.05;
      B.box('metalWall', 0, 0, SD / 2 - 0.03, SW, H + 0.25, 0.06, { color: SH });
      for (const sx of [-1, 1]) { B.box('metalWall', sx * (SW / 2 - 0.03), 0, 0, 0.06, H, SD, { color: SH });
        B.poly('metalWall', [[sx * SW / 2, H, -SD / 2], [sx * SW / 2, H, SD / 2], [sx * SW / 2, H + 0.25, SD / 2]], [sx, 0, 0], { color: SH }); }
      B.box('metalWall', -SW / 4 - 0.02, 0, -SD / 2 + 0.03, SW / 2, H, 0.06, { color: mul(SH, 0.92) });                               // fixed leaf
      B.box('metalWall', SW / 4 + 0.02, 0, -SD / 2 - 0.03, SW / 2, H - 0.05, 0.05, { color: mul(SH, 1.05) });                          // sliding leaf
      B.box('steel', 0, H - 0.02, -SD / 2 - 0.07, SW, 0.05, 0.04, { color: [0.5, 0.5, 0.5] });                                           // door rail
      shedRoof(B, { w: SW, d: SD, y: H + 0.27, pitch: Math.atan2(-0.25, SD), over: 0.2, mat: 'roofMetal', color: mul(SH, 0.85), t: 0.05 });
      B.detail(1, () => { B.box('steel', SW / 4 - 0.35, 1.0, -SD / 2 - 0.07, 0.04, 0.2, 0.03, { color: [0.3, 0.3, 0.3] }); B.box('plain', 0, 0.05, -SD / 2 - 0.02, SW, 0.08, 0.04, { color: [0.35, 0.3, 0.26] }); });
    });
    const dx = cx - SW / 2 - 0.7, dz = cz + 0.3, gd = at(dx, dz);
    B.cyl('plastic', dx, gd - 0.02, dz, 0.3, 0.3, 0.9, 14, { color: pick(rng, [[0.2, 0.4, 0.75], [0.25, 0.28, 0.3], [0.6, 0.26, 0.2]]), cap: true });
    if (rng() < 0.7) { const hx = -w / 2 + 1.8, hz = d / 2 - 1.5, gh = at(hx, hz);
      B.bbox('plastic', hx, gh - 0.05, hz, 1.9, 0.65, 1.4, 0.28, { color: [0.2, 0.4, 0.78] });
      B.detail(1, () => { for (const [ox, oz] of [[-0.5, -0.3], [0.45, 0.35]]) B.cyl('dark', hx + ox, gh + 0.55, hz + oz, 0.28, 0.28, 0.16, 12, { color: [0.12, 0.12, 0.12], cap: true }); }); }
    B.detail(1, () => { for (let k = 0; k < 4; k++) { const bx = dx - 0.9 + (k % 2) * 0.54, bz = cz - 0.4, by = at(bx, bz) - 0.02 + Math.floor(k / 2) * 0.3;
      B.bbox('plastic', bx, by, bz, 0.52, 0.29, 0.36, 0.02, { color: k % 3 ? [0.9, 0.72, 0.18] : [0.24, 0.52, 0.34] }); } });
  }
  // scarecrow (案山子) in a furrow: a pole and crossbar, an old shirt, a sack head and a straw hat
  if (rng() < 0.22 && n > 3) {
    const kx = xr0 + pitch * Math.floor(n / 2), kz = lerp(zA, zB, 0.3 + rng() * 0.4), g = at(kx, kz);
    B.cyl('wood', kx, g - 0.3, kz, 0.03, 0.03, 1.95, 6, { color: [0.5, 0.4, 0.3] });
    B.beam('wood', [kx - 0.6, g + 1.25, kz], [kx + 0.6, g + 1.25, kz], 0.035, 0.035, { color: [0.5, 0.4, 0.3] });
    B.bbox('plain', kx, g + 0.75, kz, 0.46, 0.58, 0.2, 0.06, { color: pick(rng, [[0.3, 0.38, 0.6], [0.66, 0.3, 0.26], [0.7, 0.66, 0.5]]) });
    B.bbox('plain', kx, g + 1.12, kz, 1.1, 0.22, 0.16, 0.05, { color: [0.7, 0.66, 0.52] });
    B.bbox('plain', kx, g + 1.38, kz, 0.26, 0.28, 0.24, 0.1, { color: [0.86, 0.8, 0.66] });
    B.cyl('plain', kx, g + 1.6, kz, 0.34, 0.34, 0.03, 14, { color: [0.82, 0.72, 0.46], cap: true }); B.cyl('plain', kx, g + 1.62, kz, 0.14, 0.12, 0.12, 10, { color: [0.82, 0.72, 0.46], cap: true });
  }
}

// ---------------------------------------------------------------- placed objects (world/capture.js: each call is one editable world object)
export const house = placeable('house', house_build, atObj);
export const shopBuilding = placeable('shop', shopBuilding_build, atObj);
export const konbini = placeable('konbini', konbini_build, atObj);
export const apartment = placeable('apartment_block', apartment_build, atObj);
export const warehouse = placeable('warehouse', warehouse_build, atObj);
export const carPark = placeable('car_park', carPark_build, atObj);
export const allotment = placeable('allotment', allotment_build, atObj);
export const greenhouse = placeable('greenhouse', greenhouse_build, atObj);
export const field = placeable('vegetable_field', field_build, atObj);
