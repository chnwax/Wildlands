// Apartment building families for the district (桜川ニュータウン). All go through GeoBuilder frames: the building frame
// has x along its length, z across (+z = the front, where the balconies are), y up from the platform. Facades are real
// walls with openings (boxWalls), windows and doors sit in reveals; balconies, stair towers, corridors, lobbies, canopies,
// roof plant, signs and the service clutter (AC units, meters, laundry, downpipes) are built on. Each family returns
// { entrances: [{ p: [x, y, z], out: [dx, dz], kind }], footprint: [[x, z]...], lamps: [...] }.
//   walkupSlab  階段室型 walk-up, 4-5 storeys: stair halls on the back serve two flats a floor, balconies across the front
//   pointTower  ポイント型 tower, 9-12 storeys: square plan round a core, wrap-around corner balconies, glazed lobby
//   mansion     modern mid-rise (マンション), 6-9 storeys: open corridors on the back with a lift tower and stair,
//               balconies of glass and tiled panels on the front, lobby and optional pilotis parking
//   centreBlock the neighbourhood centre: an L of shops under a canopy on a podium, with mansion wings above
//   lowRise     2-storey terraced flats (アパート) with an outside stair and an access gallery, hip roof
import { THREE, scene, clamp, lerp } from './core.js';
import { lampPoints, signMesh, JP_FONT, materials } from './townkit.js';
import { inFrame, windowUnit, doorUnit, flatRoof, hipRoof, acUnit, meterBox, downpipe, boxWalls, antenna, reveals, wallFill } from './building.js';
import { placeable, atXYZR, atObj, atLocal } from './world/capture.js';

const pick = (rng, a) => a[Math.floor(rng() * a.length)];
const mul = (c, k) => c.map(v => v * k);
const jit = (rng, c, a = 0.03) => c.map(v => clamp(v + (rng() - 0.5) * a, 0, 1));
const W = (B, lx, ly, lz) => B.P([lx, ly, lz]);
const LAUNDRY = [[0.95, 0.95, 0.94], [0.52, 0.64, 0.9], [0.95, 0.62, 0.64], [0.98, 0.86, 0.52], [0.6, 0.8, 0.62], [0.35, 0.38, 0.5]];

// palettes: body wall, balcony / parapet, trim (frames, coping), accent band, base
export const PALETTES = {
  cream:  { wall: [0.88, 0.84, 0.76], parapet: [0.9, 0.88, 0.83], trim: [0.8, 0.8, 0.78], accent: [0.34, 0.52, 0.56], base: [0.6, 0.58, 0.55] },
  salmon: { wall: [0.9, 0.78, 0.7], parapet: [0.93, 0.9, 0.86], trim: [0.82, 0.8, 0.77], accent: [0.62, 0.3, 0.24], base: [0.58, 0.54, 0.5] },
  grey:   { wall: [0.8, 0.81, 0.8], parapet: [0.9, 0.9, 0.88], trim: [0.74, 0.76, 0.78], accent: [0.26, 0.4, 0.58], base: [0.55, 0.56, 0.56] },
  sand:   { wall: [0.84, 0.76, 0.64], parapet: [0.88, 0.85, 0.78], trim: [0.7, 0.66, 0.6], accent: [0.42, 0.5, 0.36], base: [0.52, 0.48, 0.44] },
  white:  { wall: [0.92, 0.92, 0.9], parapet: [0.94, 0.94, 0.92], trim: [0.7, 0.72, 0.74], accent: [0.2, 0.24, 0.28], base: [0.6, 0.42, 0.36] },
  brick:  { wall: [0.72, 0.52, 0.42], parapet: [0.9, 0.88, 0.84], trim: [0.86, 0.84, 0.8], accent: [0.9, 0.88, 0.84], base: [0.46, 0.34, 0.3] },
  mocha:  { wall: [0.7, 0.62, 0.54], parapet: [0.86, 0.84, 0.8], trim: [0.28, 0.28, 0.3], accent: [0.9, 0.86, 0.78], base: [0.4, 0.36, 0.34] },
  blue:   { wall: [0.82, 0.84, 0.84], parapet: [0.9, 0.9, 0.88], trim: [0.72, 0.74, 0.76], accent: [0.3, 0.45, 0.62], base: [0.42, 0.46, 0.52] },
  terra:  { wall: [0.86, 0.8, 0.7], parapet: [0.9, 0.87, 0.8], trim: [0.76, 0.72, 0.66], accent: [0.66, 0.36, 0.26], base: [0.5, 0.36, 0.3] },
};
// panel colour for the vertical accent strips and gable graphics: the accent, or where that is pale, the base
const strong = pal => (pal.accent[0] + pal.accent[1] + pal.accent[2] > 2.1 ? pal.base : pal.accent);
const mix3 = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// facade kit (in a wall frame, +z out of the wall): slab-edge bands at the floor lines, proud tiled panels, so large
// walls read at a distance as storeys and bays rather than a blank box
function floorBands(B, x0, x1, ys, color, dz = 0.07) { if (x1 - x0 < 0.3) return; for (const y of ys) B.box('concrete', (x0 + x1) / 2, y - 0.09, dz / 2, x1 - x0, 0.18, dz, { color }); }
function panel(B, x0, x1, y0, y1, color, dz = 0.06) { if (x1 - x0 < 0.2 || y1 - y0 < 0.2) return; B.bbox('tiles', (x0 + x1) / 2, y0, dz / 2, x1 - x0, y1 - y0, dz, 0.012, { color, uv: 2.5 }); }

// a sign plate (canvas) on a face: text lines centred
function plate(B, lx, ly, lz, face, w, h, draw, glow = 0.1, px = 256) {
  const m = signMesh(w, h, draw, glow, px); m.position.set(...B.P([lx, ly, lz])); m.rotation.y = B.F.r + face; scene.add(m); return m;
}
// block number painted high on a gable (号棟), facing +z of the current frame
function blockNumber(B, lx, ly, lz, face, n, color = '#5d5750') {
  const m = plate(B, lx, ly, lz, face, 3.0, 3.0, (g, W2, H2) => { g.clearRect(0, 0, W2, H2); g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `bold ${H2 * 0.6}px Arial`; g.fillText(String(n), W2 / 2, H2 * 0.4); g.font = `bold ${H2 * 0.2}px ${JP_FONT}`; g.fillText('号棟', W2 / 2, H2 * 0.84); }, 0.05);
  m.material.transparent = true; m.material.alphaTest = 0.3;
}
// one straight guard between two points of the current frame (ax, az) -> (bx, bz) on a floor at fy, its outer face to
// the left of the direction of travel (so a run walked wall -> front -> along -> front -> wall faces outward all round).
// Every guard is 1.1 m high (建築基準法 手すり高さ), carries posts at both ends and at its bays, and runs 6 cm past its
// ends so neighbouring guards meet at the corners instead of leaving a notch.
//   solid  tiled concrete parapet with a coping and drip line       glass  laminated glass in an aluminium frame
//   rail   steel railing: frosted lower panel, balusters, handrail  fence  a low garden fence (0.95 m) of posts and rails
function guard(B, kind, ax, az, bx, bz, fy, { color = [0.9, 0.88, 0.84], trim = [0.7, 0.72, 0.74], ext = 0.06 } = {}) {
  const L0 = Math.hypot(bx - ax, bz - az); if (L0 < 0.05) return;
  const ux = (bx - ax) / L0, uz = (bz - az) / L0, L = L0 + 2 * ext;
  inFrame(B, [ax - ux * ext, 0, az - uz * ext], Math.atan2(-uz, ux), () => {
    const cx = L / 2, post = x => B.bbox('alu', x, fy + 0.02, 0, 0.05, 1.06, 0.05, 0.006, { color: trim });
    if (kind === 'solid') {
      B.bbox('tiles', cx, fy + 0.02, 0, L, 1.03, 0.12, 0.012, { color, uv: 2.5 });
      B.bbox('concrete', cx, fy + 1.05, 0, L + 0.02, 0.05, 0.16, 0.01, { color: trim });
      B.box('plain', cx, fy + 0.02, 0.062, L, 0.12, 0.004, { color: mul(color, 0.8) });                                // drip line
    } else if (kind === 'glass') {
      B.quad('plastic', [0, fy + 0.1, 0.012], [L, fy + 0.1, 0.012], [L, fy + 1.02, 0.012], [0, fy + 1.02, 0.012], { color: [0.62, 0.72, 0.76] });
      B.quad('plastic', [L, fy + 0.1, -0.012], [0, fy + 0.1, -0.012], [0, fy + 1.02, -0.012], [L, fy + 1.02, -0.012], { color: [0.58, 0.66, 0.7] });
      B.bbox('alu', cx, fy + 1.02, 0, L, 0.08, 0.09, 0.008, { color: trim });                                         // handrail cap
      B.bbox('alu', cx, fy + 0.03, 0, L, 0.07, 0.06, 0.006, { color: trim });                                         // shoe on the slab
      const n = Math.max(1, Math.round(L0 / 1.2)); for (let k = 0; k <= n; k++) post(ext + L0 * k / n);
    } else if (kind === 'rail') {
      B.quad('plastic', [0, fy + 0.1, 0.004], [L, fy + 0.1, 0.004], [L, fy + 0.68, 0.004], [0, fy + 0.68, 0.004], { color: [0.84, 0.86, 0.86] });
      B.quad('plastic', [L, fy + 0.1, -0.004], [0, fy + 0.1, -0.004], [0, fy + 0.68, -0.004], [L, fy + 0.68, -0.004], { color: [0.8, 0.82, 0.82] });
      B.bbox('alu', cx, fy + 1.04, 0, L, 0.06, 0.07, 0.008, { color: trim });
      B.box('alu', cx, fy + 0.66, 0, L, 0.04, 0.035, { color: trim });
      B.box('alu', cx, fy + 0.05, 0, L, 0.05, 0.035, { color: trim });
      B.detail(1, () => { for (let x = 0.12; x < L - 0.06; x += 0.12) B.box('alu', x, fy + 0.7, 0, 0.02, 0.34, 0.02, { color: trim }); });
      const n = Math.max(1, Math.round(L0 / 1.8)); for (let k = 0; k <= n; k++) post(ext + L0 * k / n);
    } else { // fence
      const n = Math.max(1, Math.round(L0 / 1.5));
      B.detail(1, () => { for (let k = 0; k <= n; k++) B.box('alu', ext + L0 * k / n, fy - 0.33, 0, 0.045, 1.26, 0.045, { color: trim });
        B.box('alu', cx, fy + 0.86, 0, L, 0.045, 0.045, { color: trim }); B.box('alu', cx, fy + 0.1, 0, L, 0.035, 0.035, { color: trim });
        for (let x = 0.15; x < L; x += 0.15) B.box('alu', x, fy + 0.1, 0, 0.018, 0.76, 0.018, { color: trim }); });
    }
  });
}
// ---------------------------------------------------------------- stairs
// a closed six-sided solid from its corners (a0..a3 one end ring, b0..b3 the other, in the same order), every face
// turned outward: sloped stringers, rails and parapets that a beam would leave open-ended
function hexa(B, mat, c, opt = {}) {
  const m = [0, 1, 2].map(i => c.reduce((s, p) => s + p[i], 0) / 8);
  for (const f of [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]) {
    const P = f.map(i => c[i]), fc = [0, 1, 2].map(i => P.reduce((s, p) => s + p[i], 0) / 4);
    B.poly(mat, P, [fc[0] - m[0], fc[1] - m[1], fc[2] - m[2]], opt); }
}
// a square bar of side s from a to b (closed at both ends)
function bar(B, mat, a, b, s, opt = {}) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(...d) || 1; d.forEach((v, i) => d[i] = v / L);
  let u = Math.abs(d[1]) > 0.99 ? [1, 0, 0] : [d[2], 0, -d[0]]; const ul = Math.hypot(...u); u = u.map(v => v / ul * s / 2);
  const v = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
  const ring = p => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => [p[0] + u[0] * i + v[0] * j, p[1] + u[1] * i + v[1] * j, p[2] + u[2] * i + v[2] * j]);
  hexa(B, mat, [...ring(a), ...ring(b)], opt);
}
// the rise and going of a flight climbing H over a run (first riser to the landing's edge): n risers of equal height,
// n - 1 treads of equal going, the landing the last tread — risers at most 20 cm, treads at least 22 cm where the run
// allows, as near the comfortable 2R + G = 63 cm as can be
function stairSteps(H, run) {
  let best = null;
  for (let k = Math.max(2, Math.ceil(H / 0.2 - 1e-6)); k <= Math.ceil(H / 0.13) + 1; k++) { const R = H / k, G = run / (k - 1), e = Math.abs(2 * R + G - 0.63) + Math.max(0, 0.22 - G) * 6;
    if (!best || e < best.e) best = { n: k, R, G, e }; }
  return best;
}
// a flight in the current frame: rising along +z from its first riser at z = 0 (floor y0) to the landing's edge at
// z = run (landing top y1), centred on x = 0, w wide; base: how low its body goes (into the ground, or the underside of
// the slab it starts from).
//   'concrete': cast with a waist slab — treads with a dark anti-slip nosing, risers, the sawtooth on both open sides,
//               a sloped soffit under it
//   'steel':    checker-plate treads and closed riser plates between two plate stringers
// Returns the steps and pitch(z): the height of the nosing line over z (rails run 0.85-0.9 m above it).
function stairFlight(B, { w, y0, y1, run, base = null, style = 'concrete', body = [0.78, 0.78, 0.76], tread = [0.84, 0.83, 0.8], nose = [0.26, 0.26, 0.27] }) {
  const S = stairSteps(y1 - y0, run), { n, R, G } = S, hw = w / 2, pitch = z => y0 + R + clamp(z, 0, run - G) * R / G, yb = base ?? y0 - 0.16;
  if (style === 'steel') {
    const t = 0.035, iw = w - 0.12;
    for (let k = 0; k < n - 1; k++) { const y = y0 + (k + 1) * R; B.box('metal', 0, y - t, (k + 0.5) * G, iw, t, G + 0.02, { color: tread }); }
    for (let k = 0; k < n; k++) B.box('metal', 0, y0 + k * R, k * G - 0.006, iw, R - (k < n - 1 ? t : 0), 0.012, { color: body });
    for (const e of [-1, 1]) { const xo = e * hw, xi = e * (hw - 0.05), top = z => y0 + R + z * R / G + 0.06, depth = 0.27;
      hexa(B, 'metal', [[xi, top(0) - depth, 0], [xo, top(0) - depth, 0], [xo, top(0), 0], [xi, top(0), 0], [xi, top(run) - depth, run], [xo, top(run) - depth, run], [xo, top(run), run], [xi, top(run), run]], { color: body }); }
  } else {
    const t = 0.2, cs = G / Math.hypot(G, R), sof = z => y0 + R + z * R / G - t / cs, zs = clamp((yb - (y0 + R - t / cs)) * G / R, 0, run);
    for (let k = 0; k < n - 1; k++) { const y = y0 + (k + 1) * R, za = k * G, zb = (k + 1) * G;
      B.poly('concrete', [[-hw, y, za], [hw, y, za], [hw, y, zb], [-hw, y, zb]], [0, 1, 0], { color: tread, uv: 0.9 });
      B.box('plain', 0, y, za + 0.025, w - 0.06, 0.004, 0.04, { color: nose }); }
    for (let k = 0; k < n; k++) { const z = k * G; B.poly('concrete', [[-hw, y0 + k * R, z], [hw, y0 + k * R, z], [hw, y0 + (k + 1) * R, z], [-hw, y0 + (k + 1) * R, z]], [0, 0, -1], { color: mul(body, 0.96) }); }
    const bot = z => Math.max(yb, sof(z));
    for (const e of [-1, 1]) { const x = e * hw;
      for (let k = 0; k < n - 1; k++) { const za = k * G, zb = (k + 1) * G, y = y0 + (k + 1) * R, cuts = [za, ...(zs > za && zs < zb ? [zs] : []), zb];
        for (let i = 0; i + 1 < cuts.length; i++) { const a = cuts[i], b = cuts[i + 1]; B.poly('concrete', [[x, bot(a), a], [x, bot(b), b], [x, y, b], [x, y, a]], [e, 0, 0], { color: body, uv: 1.2 }); } } }
    if (yb < y0) B.poly('concrete', [[-hw, yb, 0], [hw, yb, 0], [hw, y0, 0], [-hw, y0, 0]], [0, 0, -1], { color: body });
    if (zs > 0) B.poly('concrete', [[-hw, yb, 0], [hw, yb, 0], [hw, yb, zs], [-hw, yb, zs]], [0, -1, 0], { color: mul(body, 0.8) });
    B.poly('concrete', [[-hw, sof(zs), zs], [hw, sof(zs), zs], [hw, sof(run), run], [-hw, sof(run), run]], [0, -G, R], { color: mul(body, 0.86), uv: 1.2 });
    B.poly('concrete', [[-hw, sof(run), run], [hw, sof(run), run], [hw, y1, run], [-hw, y1, run]], [0, 0, 1], { color: body });
  }
  return { ...S, pitch };
}
// railing along a flight side at x, from z0 to z1 (flight frame), following the nosing line pitch(z) (flat beyond the
// flight's ends at the floor or landing height there): 'balustrade' — posts, a top rail 0.9 m up, a knee rail and
// balusters 11 cm apart (steel stairs); 'handrail' — a round-section rail 0.85 m up on posts; 'parapet' — a raking solid
// wall 1.1 m up, coped (concrete stairs' open sides)
function stairRail(B, kind, x, z0, z1, pitch, { color = [0.62, 0.64, 0.66], wall = [0.88, 0.87, 0.84], below = 0.3 } = {}) {
  const L = z1 - z0; if (L < 0.1) return;
  if (kind === 'parapet') { const T = 0.12, ya = pitch(z0), yb = pitch(z1);
    hexa(B, 'tiles', [[x - T / 2, ya - below, z0], [x + T / 2, ya - below, z0], [x + T / 2, ya + 1.1, z0], [x - T / 2, ya + 1.1, z0], [x - T / 2, yb - below, z1], [x + T / 2, yb - below, z1], [x + T / 2, yb + 1.1, z1], [x - T / 2, yb + 1.1, z1]], { color: wall, uv: 2.5 });
    bar(B, 'concrete', [x, ya + 1.12, z0], [x, yb + 1.12, z1], 0.16, { color: mul(wall, 0.9) }); return; }
  const h = kind === 'handrail' ? 0.85 : 0.9, m = Math.max(1, Math.round(L / 1.2));
  bar(B, 'steel', [x, pitch(z0) + h, z0], [x, pitch(z1) + h, z1], kind === 'handrail' ? 0.045 : 0.05, { color });
  for (let k = 0; k <= m; k++) { const z = z0 + L * k / m; B.box('steel', x, pitch(z) - 0.02, z, 0.05, h + 0.02, 0.05, { color }); }
  if (kind === 'balustrade') { bar(B, 'steel', [x, pitch(z0) + 0.12, z0], [x, pitch(z1) + 0.12, z1], 0.03, { color });
    B.detail(1, () => { for (let z = z0 + 0.11; z < z1 - 0.05; z += 0.11) B.box('steel', x, pitch(z) + 0.12, z, 0.018, h - 0.14, 0.018, { color }); }); }
}

// balcony run along the current (wall) frame: x0..x1, floor level fy, depth dp; kind 'solid' | 'rail' | 'glass';
// partitions at `parts`; laundry and AC units on some. ends [left, right]: close that end with a return guard back to
// the wall (off where a fin, a wall or another run already closes it)
function balconyRun(B, rng, x0, x1, fy, dp, { kind = 'solid', color, trim, parts = [], acs = [], laundry = 0.3, fh = 2.8, ground = false, ends = [true, true], lift = 0 }) {
  const len = x1 - x0, cx = (x0 + x1) / 2;
  if (!ground) B.bbox('concrete', cx, fy - 0.17, dp / 2, len, 0.19, dp, 0.015, { color: [0.72, 0.71, 0.69] });           // slab with its edge
  if (ground) { // a garden terrace instead: paving, a low fence round it and between the flats' gardens
    const fz = dp + 1.15;
    B.box('pavement', cx, fy - 0.33 + lift, dp / 2 + 0.6, len, 0.05, dp + 1.2, { color: [0.82, 0.8, 0.76] });
    guard(B, 'fence', x0, fz, x1, fz, fy, { trim, ext: 0 });
    if (ends[0]) guard(B, 'fence', x0, 0.05, x0, fz, fy, { trim, ext: 0 });
    if (ends[1]) guard(B, 'fence', x1, fz, x1, 0.05, fy, { trim, ext: 0 });
    for (const px of parts) guard(B, 'fence', px, 0.05, px, fz, fy, { trim, ext: 0 });
    return;
  }
  const pz = dp - 0.06, g = { color, trim };
  guard(B, kind, x0, pz, x1, pz, fy, { ...g, ext: 0 });
  if (ends[0]) guard(B, kind, x0 + 0.06, 0.02, x0 + 0.06, pz, fy, g);
  if (ends[1]) guard(B, kind, x1 - 0.06, pz, x1 - 0.06, 0.02, fy, g);
  for (const px of parts) B.bbox('plain', px, fy + 0.02, dp / 2, 0.05, fh - 0.35, dp - 0.1, 0.008, { color: [0.86, 0.85, 0.82] }); // fire-escape partitions
  for (const ax of acs) acUnit(B, ax, fy + 0.02, rng, { pipeTo: fy + fh - 0.5, z: 0.36 });
  if (rng() < laundry) B.detail(2, () => { // laundry poles between the partitions, something hung out
    const a = x0 + 0.4, b = x1 - 0.4;
    for (const zz of [dp - 0.45, dp - 0.75]) B.box('alu', (a + b) / 2, fy + 1.8, zz, b - a, 0.025, 0.025, { color: [0.7, 0.72, 0.74] });
    for (let x = a + 0.3; x < b - 0.3; x += 0.45 + rng() * 0.4) if (rng() < 0.7) B.box('plain', x, fy + 1.18, dp - 0.45, 0.32 + rng() * 0.2, 0.6, 0.02, { color: pick(rng, LAUNDRY) });
  });
}
// ground-floor entrance canopy + steps + light, in the current wall frame (door centred at x, sill at y0)
function entranceCanopy(B, x, y0, w, depth, { h = 2.65, color = [0.86, 0.85, 0.82], cols = false, lampAt = null, steps = true } = {}) {
  B.bbox('concrete', x, y0 + h, depth / 2, w, 0.16, depth, 0.02, { color });
  B.box('plain', x, y0 + h + 0.16, depth / 2, w - 0.1, 0.02, depth - 0.1, { color: mul(color, 0.92) });
  B.bbox('metal', x, y0 + h - 0.06, depth - 0.03, w + 0.02, 0.28, 0.06, 0.01, { color: mul(color, 0.8) });           // fascia
  if (cols) for (const sx of [-1, 1]) B.cyl('steel', x + sx * (w / 2 - 0.2), y0 - 0.05, depth - 0.25, 0.07, 0.07, h + 0.05, 10, { color: [0.62, 0.64, 0.66] });
  for (const k of depth > 1.8 ? [0.3, 0.7] : [0.5]) { B.cyl('lamp', x, y0 + h - 0.02, depth * k, 0.1, 0.1, 0.02, 12, { cap: true }); if (lampAt) lampAt.push({ p: B.P([x, y0 + h - 0.2, depth * k]), s: 0.5 }); }
  if (!steps) return;
  // a landing level with the door sill and a step down to the path
  B.bbox('concrete', x, y0 - 0.45, 0.45, w - 0.2, 0.45, 0.9, 0.012, { color: [0.76, 0.75, 0.72] });
  B.bbox('concrete', x, y0 - 0.6, 1.1, w - 0.2, 0.45, 0.4, 0.012, { color: [0.74, 0.73, 0.7] });
}

// ---------------------------------------------------------------- entrance hardware
// One texture atlas (1024 px square) holds the entrance hardware faces, so every intercom, mailbox bank, delivery
// locker and notice board in the district batches into one material: regions [x, y, w, h] in canvas pixels.
const ATL = { intercom: [0, 0, 256, 512], bell: [256, 0, 64, 128], card: [320, 0, 64, 128], cam: [384, 0, 256, 96], auto: [384, 96, 256, 64],
  fire: [640, 0, 128, 128], notice: [768, 0, 256, 192], mail: [0, 512, 512, 512], locker: [512, 512, 256, 512], mat: [768, 512, 256, 128],
  rules: [768, 640, 256, 192], keypad: [640, 160, 128, 192] };
function entryMaterial() {
  const M = materials(); if (M.entry) return M.entry;
  const c = document.createElement('canvas'); c.width = c.height = 1024; const g = c.getContext('2d');
  const R = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  const T = (t, x, y, px, col, font = JP_FONT, wt = 'bold') => { g.fillStyle = col; g.font = `${wt} ${px}px ${font}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, x, y); };
  const steel = (x, y, w, h, a = '#c9cdd0', b = '#9ea3a8') => { const gr = g.createLinearGradient(x, y, x + w, y + h); gr.addColorStop(0, a); gr.addColorStop(0.5, b); gr.addColorStop(1, a); g.fillStyle = gr; g.fillRect(x, y, w, h);
    g.globalAlpha = 0.07; for (let k = 0; k < h; k += 2) R(x, y + k, w, 1, k % 4 ? '#fff' : '#000'); g.globalAlpha = 1; };
  const rr = (x, y, w, h, r, col) => { g.fillStyle = col; g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); g.fill(); };
  // 集合玄関機: camera, speaker, display, ten-key pad with call and cancel, a key cylinder
  { const [x, y, w, h] = ATL.intercom; steel(x, y, w, h); g.strokeStyle = '#7d8286'; g.lineWidth = 4; g.strokeRect(x + 2, y + 2, w - 4, h - 4);
    rr(x + 98, y + 22, 60, 60, 30, '#1b1d20'); rr(x + 110, y + 34, 36, 36, 18, '#2c3a4a'); rr(x + 121, y + 45, 14, 14, 7, '#0b0d10'); R(x + 170, y + 40, 8, 8, '#3fdc6a');
    for (let r = 0; r < 4; r++) for (let q = 0; q < 9; q++) rr(x + 64 + q * 15, y + 100 + r * 12, 6, 6, 3, '#34383c');
    R(x + 34, y + 160, 188, 86, '#1d3440'); T('お部屋番号を', x + 128, y + 188, 20, '#8fe7ff'); T('押してください', x + 128, y + 218, 20, '#8fe7ff');
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].forEach((k, i) => { const kx = x + 44 + (i % 3) * 58, ky = y + 266 + Math.floor(i / 3) * 44;
      rr(kx, ky, 50, 36, 6, '#e7e9ea'); rr(kx + 2, ky + 30, 46, 6, 3, '#b8bcbf'); T(k, kx + 25, ky + 17, 22, '#222', 'Arial'); });
    rr(x + 44, y + 446, 108, 40, 6, '#2d6fb8'); T('呼出', x + 98, y + 466, 22, '#fff'); rr(x + 160, y + 446, 52, 40, 6, '#c8cbce'); T('取消', x + 186, y + 466, 16, '#333');
    rr(x + 196, y + 110, 26, 26, 13, '#8a8f93'); R(x + 205, y + 116, 8, 14, '#3a3d40'); T('INTERCOM', x + 128, y + 500, 12, '#5d6266', 'Arial'); }
  // a flat's own camera doorbell, and a card reader
  { const [x, y, w, h] = ATL.bell; rr(x + 4, y + 4, w - 8, h - 8, 10, '#e9eae7'); rr(x + 20, y + 16, 24, 24, 12, '#1b1d20'); rr(x + 27, y + 23, 10, 10, 5, '#35506a');
    for (let r = 0; r < 3; r++) for (let q = 0; q < 4; q++) rr(x + 18 + q * 8, y + 52 + r * 8, 4, 4, 2, '#8a8d8f'); rr(x + 14, y + 86, 36, 28, 8, '#c9ccce'); rr(x + 20, y + 92, 24, 16, 5, '#f4f4f2'); }
  { const [x, y, w, h] = ATL.card; rr(x + 4, y + 4, w - 8, h - 8, 6, '#3a3e42'); rr(x + 10, y + 12, w - 20, 60, 4, '#50565c'); g.strokeStyle = '#d8dde0'; g.lineWidth = 3;
    for (const r of [8, 14, 20]) { g.beginPath(); g.arc(x + 26, y + 42, r, -0.8, 0.8); g.stroke(); } R(x + 20, y + 84, 24, 8, '#3fdc6a'); T('かざす', x + 32, y + 108, 11, '#e8e8e8'); }
  // signs: 防犯カメラ作動中, the auto-lock sticker, the extinguisher sign, the management board
  { const [x, y, w, h] = ATL.cam; R(x, y, w, h, '#ffd400'); R(x + 4, y + 4, w - 8, h - 8, '#111'); R(x + 8, y + 8, w - 16, h - 16, '#ffd400');
    g.fillStyle = '#111'; g.beginPath(); g.moveTo(x + 24, y + 34); g.lineTo(x + 64, y + 28); g.lineTo(x + 64, y + 52); g.lineTo(x + 24, y + 48); g.fill(); R(x + 64, y + 34, 10, 12, '#111');
    T('防犯カメラ', x + 160, y + 34, 26, '#111'); T('作動中', x + 160, y + 66, 26, '#c00'); }
  { const [x, y, w, h] = ATL.auto; R(x, y, w, h, '#dfe6ee'); rr(x + 4, y + 6, w - 8, h - 12, 8, '#1e5aa8'); T('オートロック', x + w / 2, y + 24, 20, '#fff'); T('AUTO LOCK · 自動ドア', x + w / 2, y + 45, 12, '#dfe9f6'); }
  { const [x, y, w, h] = ATL.fire; R(x, y, w, h, '#c81e1e'); R(x + 6, y + 6, w - 12, h - 12, '#d8262a'); T('消火器', x + w / 2, y + 40, 30, '#fff'); T('FIRE', x + w / 2, y + 78, 20, '#fff', 'Arial'); T('EXTINGUISHER', x + w / 2, y + 100, 12, '#fff', 'Arial'); }
  { const [x, y, w, h] = ATL.notice; R(x, y, w, h, '#6d5a42'); R(x + 8, y + 8, w - 16, h - 16, '#b99b6e');
    for (const [px, py, pw, ph, col] of [[18, 16, 70, 92, '#fdfcf6'], [96, 20, 64, 48, '#fff4c8'], [168, 14, 70, 88, '#f6f9ff'], [96, 76, 64, 90, '#fdfcf6'], [20, 116, 66, 58, '#e8f4e2'], [168, 110, 70, 62, '#fdeeee']]) {
      R(x + px, y + py, pw, ph, col); for (let k = 12; k < ph - 6; k += 7) R(x + px + 6, y + py + k, pw * (0.55 + ((k * 7) % 5) / 12), 2, '#9aa0a6'); R(x + px + 6, y + py + 5, pw - 12, 4, '#44546a'); rr(x + px + pw / 2 - 3, y + py - 2, 6, 6, 3, '#d33'); }
    T('お知らせ', x + 128, y + 184, 12, '#f3ead8'); }
  { const [x, y, w] = ATL.rules; R(x, y, w, 192, '#f6f4ee'); R(x, y, w, 40, '#2f4f6f'); T('桜川ニュータウン 管理組合', x + w / 2, y + 20, 17, '#fff');
    for (let k = 0; k < 6; k++) { R(x + 18, y + 58 + k * 18, 8, 8, '#2f4f6f'); R(x + 34, y + 60 + k * 18, 150 + (k * 37) % 50, 4, '#6a6f75'); }
    T('ゴミ出しは朝8時まで', x + w / 2, y + 176, 14, '#b02020'); }
  // 集合ポスト: 4 x 5 doors (a bank takes as many as it needs), each with its room number, the slot, a dial lock
  { const [x, y] = ATL.mail;
    for (let r = 0; r < 5; r++) for (let q = 0; q < 4; q++) { const cx = x + q * 128, cy = y + r * 102.4;
      steel(cx, cy, 128, 102, '#d9dcdd', '#b7bbbe'); g.strokeStyle = '#6d7276'; g.lineWidth = 3; g.strokeRect(cx + 1.5, cy + 1.5, 125, 99);
      R(cx + 14, cy + 12, 100, 10, '#2a2c2e'); R(cx + 16, cy + 14, 96, 3, '#555');
      R(cx + 12, cy + 36, 58, 22, '#fdfdfb'); T(`${5 - r}0${q + 1}`, cx + 41, cy + 47, 16, '#222', 'Arial');
      rr(cx + 84, cy + 36, 30, 30, 15, '#50565c'); rr(cx + 90, cy + 42, 18, 18, 9, '#8d9398'); R(cx + 98, cy + 42, 2, 8, '#222'); R(cx + 12, cy + 76, 104, 3, '#9aa0a4'); } }
  // 宅配ボックス: numbered locker doors round a touch panel
  { const [x, y, w, h] = ATL.locker; R(x, y, w, h, '#5d7288'); let n = 0;
    for (const [q, r, cw] of [[0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1], [1, 2, 1], [0, 3, 2], [0, 4, 1], [1, 4, 1]]) { const cx = x + 8 + q * 120, cy = y + 8 + r * 100, W2 = cw * 120 - 8, H2 = 92;
      if (cw === 2) { R(cx, cy, W2, H2, '#2b3440'); R(cx + 50, cy + 14, 130, 60, '#8fd3ff'); T('宅配ボックス', cx + 115, cy + 32, 18, '#12324a'); T('タッチしてください', cx + 115, cy + 58, 12, '#12324a'); rr(cx + 14, cy + 30, 22, 22, 4, '#e9e9e9'); continue; }
      steel(cx, cy, W2, H2, '#c4ccd4', '#a2acb6'); R(cx + W2 - 26, cy + H2 / 2 - 16, 8, 32, '#3d4650'); rr(cx + 10, cy + 10, 26, 18, 3, '#f2f2ee'); T(String(++n), cx + 23, cy + 19, 13, '#222', 'Arial'); R(cx + 44, cy + 14, 6, 6, '#3fdc6a'); } }
  { const [x, y, w, h] = ATL.mat; R(x, y, w, h, '#3a3c3e'); R(x + 10, y + 10, w - 20, h - 20, '#4a4d50'); g.globalAlpha = 0.25; for (let k = 14; k < w - 14; k += 6) R(x + k, y + 14, 2, h - 28, '#222'); g.globalAlpha = 1; }
  { const [x, y, w, h] = ATL.keypad; steel(x, y, w, h); for (let i = 0; i < 12; i++) rr(x + 16 + (i % 3) * 34, y + 30 + Math.floor(i / 3) * 36, 28, 28, 5, '#e3e5e6'); rr(x + 40, y + 6, 48, 16, 4, '#1d3440'); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  M.entry = new THREE.MeshStandardMaterial({ map: t, vertexColors: true, roughness: 0.42, metalness: 0.25 });
  return M.entry;
}
// a face of the atlas as a quad in the current frame: corners a (bottom-left) b c d; sub [u0, v0, u1, v1] picks a part
function atlasQuad(B, key, a, b, c, d, sub = [0, 0, 1, 1]) {
  entryMaterial(); const [x, y, w, h] = ATL[key], u = t => (x + w * t) / 1024, v = t => 1 - (y + h * (1 - t)) / 1024;
  B.quad('entry', a, b, c, d, { uvs: [[u(sub[0]), v(sub[1])], [u(sub[2]), v(sub[1])], [u(sub[2]), v(sub[3])], [u(sub[0]), v(sub[3])]] });
}
// a panel on a wall (current frame: wall plane z = 0, +z out): a box dz deep with the atlas face on its front
function wallPanel(B, key, cx, y0, w, h, dz, { sub, color = [0.72, 0.74, 0.76], mat = 'alu' } = {}) {
  B.bbox(mat, cx, y0, dz / 2, w, h, dz, 0.004, { color });
  atlasQuad(B, key, [cx - w / 2, y0, dz + 0.002], [cx + w / 2, y0, dz + 0.002], [cx + w / 2, y0 + h, dz + 0.002], [cx - w / 2, y0 + h, dz + 0.002], sub);
}
// a flat's door furniture beside its door (current frame on the wall, at x): the camera doorbell and a nameplate
function doorFurniture(B, x, y0) {
  B.detail(2, () => { wallPanel(B, 'bell', x, y0 + 1.25, 0.1, 0.2, 0.025, { color: [0.9, 0.9, 0.88], mat: 'plastic' });
    B.bbox('plastic', x, y0 + 1.55, 0.012, 0.16, 0.08, 0.02, 0.004, { color: [0.95, 0.94, 0.9] }); B.box('dark', x, y0 + 1.575, 0.023, 0.1, 0.03, 0.002, { color: [0.25, 0.25, 0.26] }); });
}
// Recessed entrance porch in the current wall frame: the opening (w wide, floor at y0, head at yh) is cut in the wall at
// z = 0 by the caller and the porch runs back to its doors at z = -depth. Stone-tiled floor with a mat, tiled walls, a
// soffit with a downlight, a door screen (a pair of glazed doors with pulls and kick plates, or an automatic sliding
// pair with its sensor) under a transom, the hall beyond; the entrance panel (intercom, card reader) on one wall by the
// doors with the management board; the mail bank on the other with delivery lockers or a notice board; the security
// camera and its sign, an extinguisher, a lamp either side of the mouth.
function entrancePorch(B, rng, { w, y0, yh, depth, wall, frame = [0.3, 0.31, 0.33], floorC = [0.5, 0.48, 0.46], soffit = [0.9, 0.9, 0.88],
  auto = false, mail = [2, 5], lockers = false, side = rng() < 0.5 ? -1 : 1, lampAt = null, noticeOut = false, back = 0.12 }) {
  const hw = w / 2, D = depth, P = side, Q = -side;                                                                // P: panel wall, Q: mail wall
  B.bbox('tiles', 0, y0 - 0.12, -D / 2, w, 0.12, D, 0.004, { color: floorC, uv: 0.9 });
  B.box('concrete', 0, y0 - 0.001, -0.06, w, 0.012, 0.12, { color: [0.72, 0.71, 0.68] });                               // threshold
  atlasQuad(B, 'mat', [-0.7, y0 + 0.004, -D + 1.2], [0.7, y0 + 0.004, -D + 1.2], [0.7, y0 + 0.004, -D + 0.35], [-0.7, y0 + 0.004, -D + 0.35]);
  for (const e of [-1, 1]) B.poly('tiles', [[e * hw, y0, 0], [e * hw, y0, -D], [e * hw, yh, -D], [e * hw, yh, 0]], [-e, 0, 0], { color: mul(wall, 0.94), uv: 2.5 });
  B.poly('plain', [[-hw, yh, 0], [hw, yh, 0], [hw, yh, -D], [-hw, yh, -D]], [0, -1, 0], { color: soffit });
  B.cyl('lamp', 0, yh - 0.02, -D / 2, 0.11, 0.11, 0.02, 12, { cap: true }); if (lampAt) lampAt.push({ p: B.P([0, yh - 0.3, -D / 2]), s: 0.45 });
  // the door screen
  const dw = Math.min(w - 0.3, auto ? 2.0 : 1.8), dh = Math.min(2.25, yh - y0 - 0.35), zd = -D, fr = { color: frame };
  B.poly('tiles', [[-hw, y0, zd], [-dw / 2, y0, zd], [-dw / 2, yh, zd], [-hw, yh, zd]], [0, 0, 1], { color: mul(wall, 0.9), uv: 2.5 });
  B.poly('tiles', [[dw / 2, y0, zd], [hw, y0, zd], [hw, yh, zd], [dw / 2, yh, zd]], [0, 0, 1], { color: mul(wall, 0.9), uv: 2.5 });
  B.quad('shopWindow', [-dw / 2, y0, zd - back], [dw / 2, y0, zd - back], [dw / 2, yh, zd - back], [-dw / 2, yh, zd - back], { color: [1.25, 1, 3.5 / 8], uvs: [[0, 0], [1, 0], [1, 1], [0, 1]] });
  for (const e of [-1, 1]) B.bbox('alu', e * (dw / 2 - 0.04), y0, zd - 0.02, 0.08, yh - y0, 0.1, 0.006, fr);
  B.bbox('alu', 0, y0 + dh, zd - 0.02, dw, 0.08, 0.1, 0.006, fr); B.bbox('alu', 0, yh - 0.06, zd - 0.02, dw, 0.06, 0.1, 0.006, fr);
  const lw = (dw - 0.16) / 2;
  for (const e of [-1, 1]) { const lx = e * (lw / 2 + 0.005), zl = zd - 0.03 + (auto && e > 0 ? -0.05 : 0);
    for (const sx of [-1, 1]) B.box('alu', lx + sx * (lw / 2 - 0.035), y0 + 0.02, zl, 0.07, dh - 0.03, 0.05, fr);
    B.box('alu', lx, y0 + 0.02, zl, lw, 0.2, 0.05, fr); B.box('alu', lx, y0 + dh - 0.08, zl, lw, 0.07, 0.05, fr);
    if (!auto) { const hx = e * 0.1; B.cyl('steel', hx, y0 + 0.75, zl + 0.09, 0.016, 0.016, 0.7, 8, { color: [0.8, 0.82, 0.84], cap: true });
      for (const yy of [0.8, 1.38]) B.box('steel', hx, y0 + yy, zl + 0.025, 0.02, 0.02, 0.07, { color: [0.8, 0.82, 0.84] }); } }
  if (auto) { B.bbox('alu', 0, y0 + dh + 0.1, zd + 0.05, 0.5, 0.1, 0.1, 0.01, { color: [0.2, 0.2, 0.22] }); B.box('dark', 0, y0 + dh + 0.09, zd + 0.1, 0.12, 0.02, 0.02, { color: [0.6, 0.1, 0.1] }); }
  atlasQuad(B, 'auto', [-0.36, y0 + 1.2, zd + 0.012], [0.36, y0 + 1.2, zd + 0.012], [0.36, y0 + 1.38, zd + 0.012], [-0.36, y0 + 1.38, zd + 0.012]);
  // P wall: the entrance panel a step before the doors, the card reader beside it, the management board toward the mouth
  inFrame(B, [P * hw, 0, 0], -P * Math.PI / 2, () => { const a = t => -P * t;                                   // a(t): t metres in from the mouth
    wallPanel(B, 'intercom', a(D - 0.55), y0 + 1.0, 0.22, 0.44, 0.05, { color: [0.62, 0.64, 0.66] });
    B.bbox('alu', a(D - 0.55), y0 + 1.46, 0.035, 0.26, 0.03, 0.07, 0.004, { color: [0.62, 0.64, 0.66] });
    wallPanel(B, 'card', a(D - 0.25), y0 + 1.1, 0.08, 0.16, 0.03, { color: [0.3, 0.32, 0.34], mat: 'plastic' });
    if (lockers && D >= 2.0) { const cl = a(0.62); B.bbox('metal', cl, y0 + 0.05, 0.25, 0.9, 1.8, 0.5, 0.01, { color: [0.36, 0.44, 0.52] });     // 宅配ボックス
      atlasQuad(B, 'locker', [cl - 0.44, y0 + 0.08, 0.502], [cl + 0.44, y0 + 0.08, 0.502], [cl + 0.44, y0 + 1.82, 0.502], [cl - 0.44, y0 + 1.82, 0.502]); }
    else if (D > 1.5) wallPanel(B, 'rules', a(Math.max(0.45, D - 1.3)), y0 + 1.2, 0.5, 0.375, 0.02, { color: [0.3, 0.3, 0.3] });
    atlasQuad(B, 'cam', [a(0.18) - 0.18, yh - 0.42, 0.003], [a(0.18) + 0.18, yh - 0.42, 0.003], [a(0.18) + 0.18, yh - 0.285, 0.003], [a(0.18) - 0.18, yh - 0.285, 0.003]);
  });
  B.detail(1, () => { B.box('plain', P * (hw - 0.1), yh - 0.1, -0.3, 0.1, 0.1, 0.1, { color: [0.92, 0.92, 0.9] }); B.cyl('dark', P * (hw - 0.1), yh - 0.19, -0.3, 0.055, 0.055, 0.09, 10, { color: [0.12, 0.12, 0.14], cap: true }); });
  // Q wall: the mail bank (a steel cabinet, its doors on the face), then delivery lockers or a notice board
  inFrame(B, [Q * hw, 0, 0], -Q * Math.PI / 2, () => { const a = t => -Q * t;
    const [mc, mr] = mail, bw = mc * 0.3, bh = mr * 0.24, mz = 0.34, t0 = Math.max(0.3, Math.min(D - 0.25 - bw, 0.45)), cm = a(t0 + bw / 2);
    B.bbox('metal', cm, y0 + 0.36, mz / 2, bw + 0.06, bh + 0.08, mz, 0.01, { color: [0.7, 0.72, 0.73] });
    atlasQuad(B, 'mail', [cm - bw / 2, y0 + 0.4, mz + 0.002], [cm + bw / 2, y0 + 0.4, mz + 0.002], [cm + bw / 2, y0 + 0.4 + bh, mz + 0.002], [cm - bw / 2, y0 + 0.4 + bh, mz + 0.002], [0, 1 - mr / 5, mc / 4, 1]);
    const t1 = t0 + bw + 0.12;
    if (D - t1 > 0.6) wallPanel(B, 'notice', a(t1 + 0.3), y0 + 1.25, 0.5, 0.375, 0.04, { color: [0.4, 0.34, 0.26], mat: 'wood' });
    B.detail(1, () => { const e0 = a(0.17); B.bbox('metal', e0, y0 + 0.05, 0.12, 0.26, 0.62, 0.24, 0.01, { color: [0.78, 0.12, 0.12] });
      atlasQuad(B, 'fire', [e0 - 0.1, y0 + 0.74, 0.004], [e0 + 0.1, y0 + 0.74, 0.004], [e0 + 0.1, y0 + 0.94, 0.004], [e0 - 0.1, y0 + 0.94, 0.004]); });
  });
  // outside: bracket lamps either side of the mouth; the notice board outside where asked
  for (const e of [-1, 1]) { B.bbox('metal', e * (hw + 0.28), y0 + 2.0, 0.06, 0.16, 0.26, 0.12, 0.01, { color: [0.26, 0.27, 0.29] }); B.box('lamp', e * (hw + 0.28), y0 + 2.04, 0.125, 0.12, 0.18, 0.01);
    if (lampAt) lampAt.push({ p: B.P([e * (hw + 0.28), y0 + 2.1, 0.4]), s: 0.3 }); }
  if (noticeOut) wallPanel(B, 'notice', -(hw + 0.95), y0 + 1.15, 0.6, 0.45, 0.04, { color: [0.4, 0.34, 0.26], mat: 'wood' });
}
// Approach to an entrance at sill height y0 (current frame on the facade, +z out, door centred at x = 0), built to the
// ground actually found in front of it:
//   under 14 cm: a level approach — the landing's paving falls gently (1:14 or flatter) to the forecourt, no step at all
//   more: a landing the entrance's width, then steps (risers near 15.5 cm, 32 cm treads with a lighter tread plate, a
//         dark anti-slip nosing and a set-back riser), a tactile warning strip across the landing before the first
//         step, cheek walls either side following the flight (coped, sunk below the ground), and handrails on posts
//         both sides at 85 cm over the nosings, run on 30 cm past the bottom step and turned down at the end
//   ramp (±1): a barrier-free ramp (1:12) along the facade from the landing's side, cheek walls and rails both sides;
//         on that side the landing is left open onto it
// style 'concrete' (walk-ups: board-marked concrete, galvanised pipe rails) or 'granite' (flame-finished granite,
// stainless rails). Returns the forecourt's front centre (where the path takes over), its outline, and the footprint
// the paths must keep off.
function approach(B, gy, { w, y0, land = 1.3, ramp = 0, court = 2.4, extraW = 0, style = 'concrete' }) {
  const F = B.F, gl = (lx, lz) => { const p = B.P([lx, 0, lz]); return gy(p[0], p[2]) - F.y; };
  const probe = z => Math.min(gl(0, z), gl(-w / 2, z), gl(w / 2, z));
  const G = style === 'granite', BODY = G ? [0.5, 0.49, 0.47] : [0.74, 0.73, 0.7], TREAD = G ? [0.68, 0.66, 0.62] : [0.8, 0.79, 0.76],
    NOSE = [0.28, 0.28, 0.29], CHEEK = G ? [0.42, 0.41, 0.4] : [0.7, 0.69, 0.66], RAIL = G ? [0.82, 0.84, 0.86] : [0.62, 0.64, 0.66];
  let g0 = probe(land + 0.9), rise = Math.max(0, y0 - g0);
  const T = 0.32, level = rise < 0.14;
  const n = level ? 0 : Math.max(2, Math.round(rise / 0.155)), rs = level ? 0 : rise / n;
  if (level) land = Math.max(land, rise * 14 + 0.4);
  const foot = level ? land : land + (n - 1) * T;
  g0 = Math.min(g0, probe(foot + 0.3));
  // the landing (sloping to the ground when level) with its finish
  if (level) {
    const yA = y0, yB = g0 + 0.03;
    B.poly('concrete', [[-w / 2, yA, 0.02], [w / 2, yA, 0.02], [w / 2, yB, land], [-w / 2, yB, land]], [0, 1, 0], { color: TREAD, uv: 0.9 });
    for (const e of [-1, 1]) B.poly('concrete', [[e * w / 2, g0 - 0.3, 0.02], [e * w / 2, g0 - 0.3, land], [e * w / 2, yB, land], [e * w / 2, yA, 0.02]], [e, 0, 0], { color: BODY });
    B.poly('concrete', [[-w / 2, g0 - 0.3, land], [w / 2, g0 - 0.3, land], [w / 2, yB, land], [-w / 2, yB, land]], [0, 0, 1], { color: BODY });
  } else {
    B.bbox('concrete', 0, g0 - 0.35, land / 2, w, y0 - g0 + 0.35 - 0.03, land, 0.015, { color: BODY });
    B.bbox(G ? 'stone' : 'concrete', 0, y0 - 0.03, land / 2 - 0.01, w + 0.02, 0.03, land + 0.02, 0.006, { color: TREAD, uv: 0.8 });
    B.box('tactileD', 0, y0 + 0.001, land - 0.45, Math.min(w - 0.4, 1.8), 0.006, 0.3, { uv: 0.3 });              // 点状ブロック before the flight
    B.box('plain', 0, y0 - 0.025, land + 0.005, w, 0.028, 0.03, { color: NOSE });
    // the flight: each step a solid block down into the ground, a tread plate with its nosing, the riser set back
    for (let k = 1; k < n; k++) { const top = y0 - k * rs, z0 = land + (k - 1) * T;
      B.box('concrete', 0, g0 - 0.35, z0 + 0.02 + (T - 0.02) / 2, w, top - 0.03 - (g0 - 0.35), T - 0.02, { color: mul(BODY, 0.94) });
      B.box(G ? 'stone' : 'concrete', 0, top - 0.03, z0 + T / 2, w, 0.03, T + 0.02, { color: TREAD, uv: 0.8 });
      B.box('plain', 0, top - 0.025, z0 + T + 0.005, w, 0.028, 0.03, { color: NOSE }); }
  }
  // cheek walls and rails, both sides (the ramp's side open along the landing)
  const cheekTop = z => z <= land ? y0 + 0.14 : lerp(y0, g0, clamp((z - land) / Math.max(0.01, foot - land + T), 0, 1)) + 0.14 - (level ? 0 : 0);
  const railY = z => level ? lerp(y0, g0, clamp(z / land, 0, 1)) + 0.85 : z <= land ? y0 + 0.85 : lerp(y0, g0 + rs, clamp((z - land) / Math.max(0.01, foot - land), 0, 1)) + 0.85;
  const zEnd = foot + (level ? 0 : T);
  for (const e of [-1, 1]) {
    const open = ramp === e, zs = open ? land : 0.03, x = e * (w / 2 + 0.08);
    if (!level || rise > 0.05) {
      const pts = []; for (let z = zs; z <= zEnd + 1e-3; z += 0.16) pts.push(z); if (pts[pts.length - 1] < zEnd - 0.01) pts.push(zEnd);
      for (let i = 0; i + 1 < pts.length; i++) { const za = pts[i], zb = pts[i + 1], ta = level ? lerp(y0, g0, za / land) + 0.1 : cheekTop(za), tb = level ? lerp(y0, g0, zb / land) + 0.1 : cheekTop(zb);
        B.poly(G ? 'stone' : 'concrete', [[x, g0 - 0.3, za], [x, g0 - 0.3, zb], [x, tb, zb], [x, ta, za]], [e, 0, 0], { color: CHEEK, uv: 1.2 });
        B.poly(G ? 'stone' : 'concrete', [[x - e * 0.16, g0 - 0.3, zb], [x - e * 0.16, g0 - 0.3, za], [x - e * 0.16, ta, za], [x - e * 0.16, tb, zb]], [-e, 0, 0], { color: mul(CHEEK, 0.9), uv: 1.2 });
        B.poly('concrete', [[x - e * 0.16, ta, za], [x, ta, za], [x, tb, zb], [x - e * 0.16, tb, zb]], [0, 1, 0], { color: mul(CHEEK, 1.12) }); }
      B.poly(G ? 'stone' : 'concrete', [[x - e * 0.16, g0 - 0.3, zEnd], [x, g0 - 0.3, zEnd], [x, cheekTop(zEnd) + (level ? -0.04 : 0), zEnd], [x - e * 0.16, cheekTop(zEnd) + (level ? -0.04 : 0), zEnd]], [0, 0, 1], { color: CHEEK });
    }
    if (level && rise < 0.08) continue;                                                                               // nothing to hold on to
    B.detail(1, () => { const xr = x - e * 0.08, zr0 = zs + 0.15, zr1 = zEnd + 0.3, m = 6;
      for (let i = 0; i < m; i++) { const za = lerp(zr0, zr1, i / m), zb = lerp(zr0, zr1, (i + 1) / m); B.beam('steel', [xr, railY(za), za], [xr, railY(zb), zb], 0.045, 0.045, { color: RAIL }); }
      B.box('steel', xr, railY(zr1) - 0.12, zr1, 0.045, 0.12, 0.045, { color: RAIL });                                // end turned down
      for (const zp of [zr0, open ? zr0 : land, zr1 - 0.3]) B.box('steel', xr, cheekTop(zp) - 0.02, zp, 0.05, railY(zp) - cheekTop(zp) + 0.02, 0.05, { color: RAIL }); });
  }
  let rampEnd = null;
  if (ramp && rise > 0.06) {
    const L = Math.max(1.2, rise * 12), x0 = ramp * (w / 2 + 0.16), x1 = ramp * (w / 2 + 0.16 + L), rw = 1.3, zi = 0.08, zo = zi + rw, zc = (zi + zo) / 2;
    B.poly('concrete', [[x0, y0, zi], [x1, g0 + 0.02, zi], [x1, g0 + 0.02, zo], [x0, y0, zo]], [0, 1, 0], { color: TREAD, uv: 1.5 });
    B.poly('concrete', [[x0, g0 - 0.2, zo], [x1, g0 - 0.2, zo], [x1, g0 + 0.02, zo], [x0, y0, zo]], [0, 0, 1], { color: BODY, uv: 1.5 });
    for (const zz of [zi - 0.06, zo + 0.06]) { B.beam(G ? 'stone' : 'concrete', [x0, y0 - 0.03, zz], [x1, g0 - 0.03, zz], 0.12, 0.34, { color: CHEEK });
      B.detail(1, () => { B.beam('steel', [x0, y0 + 0.9, zz], [x1, g0 + 0.92, zz], 0.045, 0.045, { color: RAIL }); B.beam('steel', [x1, g0 + 0.92, zz], [x1 + ramp * 0.3, g0 + 0.92, zz], 0.045, 0.045, { color: RAIL });
        B.box('steel', x1 + ramp * 0.3, g0 + 0.8, zz, 0.045, 0.12, 0.045, { color: RAIL });
        const m = Math.max(1, Math.round(L / 1.5)); for (let k = 0; k <= m; k++) { const t = k / m; B.box('steel', x0 + (x1 - x0) * t, y0 + (g0 - y0) * t + 0.14, zz, 0.045, 0.76, 0.045, { color: RAIL }); } }); }
    rampEnd = [x1 + ramp * 0.5, zc];
  }
  const xa = -w / 2 - 0.6 - (ramp < 0 && rampEnd ? -rampEnd[0] - w / 2 : 0) - extraW, xb = w / 2 + 0.6 + (ramp > 0 && rampEnd ? rampEnd[0] - w / 2 : 0) + extraW;
  const block = [[-w / 2 - 0.3, 0, w / 2 + 0.3, zEnd + 0.1]]; if (rampEnd) block.push([Math.min(ramp * w / 2, rampEnd[0] - ramp * 0.5), 0, Math.max(ramp * w / 2, rampEnd[0] - ramp * 0.5), 1.6]);
  return { foot: [0, zEnd + court], court: [xa, rampEnd ? 0.05 : land - 0.1, xb, zEnd + court], rampEnd, g0, rise, block };
}

// the ground a building of family fam will take, in its own frame, as rectangles [[x0, z0], [x1, z1]]: walls, balconies,
// garden fences, stair towers, lobbies with their landings, steps, ramps and forecourts (the layout rules in the families
// below). The district's placement keeps these clear of carriageways, footways and each other.
export function envelope(fam, o) {
  const w = o.w, M = (w, d, lift) => { const nU = Math.max(3, Math.round(w / 6.6)), uw = w / nU, lx = -w / 2 + ((lift ?? Math.round(nU / 2) - 1) + 1) * uw;
    return [[[-w / 2 - 2.9, -d / 2 - 2.0], [w / 2 + 0.4, d / 2 + 3.1]], [[lx - 6.5, -d / 2 - 9.2], [lx + 6.5, -d / 2]]]; };
  if (fam === 'S') { const d = o.d || 9.6; return [[[-w / 2 - 0.35, -d / 2 - 6.2], [w / 2 + 0.35, d / 2 + 2.6]]]; }
  if (fam === 'T') { const W = o.w || 18, d = o.d || 16; return [[[-W / 2 - 2.9, -d / 2 - 7.6], [W / 2 + 2.9, d / 2 + 2.8]]]; }
  if (fam === 'M') return M(w, o.d || 11.5, o.lift);
  if (fam === 'R') { const d = o.d || 8.2; return [[[-w / 2 - 1.4, -d / 2 - 2.3], [w / 2 + 1.9, d / 2 + 1.6]]]; }
  if (fam === 'L') { const wa = o.wa || 58, wb = o.wb || 40, dp = o.dp || 17; return [[[-3.0, -dp - 0.3], [wa, 3.0]], [[-3.0, -wb - 0.3], [dp + 2.6, -dp]]]; }
  if (fam === 'K') { const wa = o.wa || 30, wb = o.wb || 26, C = 6, cxA = C + wa / 2 - 0.3, czB = C + wb / 2 - 0.3, R = [[[-C - 0.5, -C - 0.5], [C + 0.5, C + 0.5]]];
    for (const [[a0, b0], [a1, b1]] of M(wa, 11.5, 0)) R.push([[cxA - a1, -b1], [cxA - a0, -b0]]);
    for (const [[a0, b0], [a1, b1]] of M(wb, 11.5, 2)) R.push([[-b1, czB + a0], [-b0, czB + a1]]);
    return R; }
  return [[[-15, -8], [15, 8]]];
}
// a forecourt rectangle [x0, z0, x1, z1] of the current frame as world corners
const courtW = (B, [x0, z0, x1, z1]) => [B.P([x0, 0, z0]), B.P([x1, 0, z0]), B.P([x1, 0, z1]), B.P([x0, 0, z1])].map(p => [p[0], p[2]]);

// ---------------------------------------------------------------- 階段室型 walk-up slab
function walkupSlab_build(B, s, rng, ex) {
  const { x, y, z, r, w, d = 9.6, floors = 5, pal = PALETTES.cream, no = 1, bal = 'solid' } = s, fh = 2.8, y0 = 0.35, H = y0 + floors * fh;
  const nU = Math.max(2, Math.round(w / 6.9 / 2) * 2), uw = w / nU, out = { entrances: [], lamps: [] };
  const cores = []; for (let k = 0; k < nU / 2; k++) cores.push(-w / 2 + (2 * k + 1) * uw);
  const wall = jit(rng, pal.wall, 0.03);
  B.frame(x, y, z, r);
  B.bbox('concrete', 0, -0.45, 0, w + 0.12, 0.8, d + 0.12, 0.02, { color: pal.base });                                     // plinth
  const front = [], back = [], gable = [];
  for (let f = 0; f < floors; f++) {
    const fy = y0 + f * fh;
    for (let u = 0; u < nU; u++) {
      const cx = -w / 2 + (u + 0.5) * uw;
      front.push({ x0: cx - uw / 2 + 0.45, x1: cx - 0.25, y0: fy + 0.05, y1: fy + 2.05, d: 0.18, f, u, kind: 'living' }, { x0: cx + 0.25, x1: cx + uw / 2 - 0.7, y0: fy + 0.05, y1: fy + 2.05, d: 0.18, f, u, kind: 'room' });
      const sgn = u % 2 ? 1 : -1, bx0 = cx + sgn * 0.6, bx1 = cx + sgn * 2.2;                                         // away from the stair hall
      back.push({ x0: -Math.max(bx0, bx1) - 0.65, x1: -Math.max(bx0, bx1) + 0.65, y0: fy + 1.0, y1: fy + 2.0, d: 0.14, f, kind: 'kitchen' });
      back.push({ x0: -Math.min(bx0, bx1) - 0.35, x1: -Math.min(bx0, bx1) + 0.35, y0: fy + 1.45, y1: fy + 2.05, d: 0.12, f, kind: 'bath' });
    }
    gable.push({ x0: d / 2 - 2.6, x1: d / 2 - 1.6, y0: fy + 1.0, y1: fy + 2.0, d: 0.14 });
  }
  const mir = hs => hs.map(h => ({ ...h, x0: -h.x1, x1: -h.x0 }));                                                   // (+x gable runs front-to-back reversed)
  boxWalls(B, 0, w, d, y0, H + 0.7, [['tiles', mix3(wall, pal.base, 0.35), 2.5, y0 + fh - 0.1], ['tiles', wall, 2.5]], fi => fi === 0 ? front : fi === 1 ? back : fi === 2 ? mir(gable) : gable, mul(wall, 0.95));
  const towerC = mix3(wall, strong(pal), 0.28), floorsY = []; for (let f = 1; f < floors; f++) floorsY.push(y0 + f * fh);
  // front: windows, balconies (the ground floor has garden terraces), AC units, laundry
  inFrame(B, [0, 0, d / 2], 0, () => {
    for (const h of front) windowUnit(B, h, { rng, frame: [0.78, 0.8, 0.82], type: 'slide', sill: false, shutterBox: h.kind === 'room' && rng() < 0.35 });
    for (let f = 0; f < floors; f++) {
      const fy = y0 + f * fh, parts = [];
      for (let u = 1; u < nU; u++) parts.push(-w / 2 + u * uw);
      const acs = []; for (let u = 0; u < nU; u++) if (rng() < 0.55) acs.push(-w / 2 + u * uw + 0.7);
      balconyRun(B, rng, -w / 2 - 0.1, w / 2 + 0.1, fy, 1.3, { kind: bal, color: pal.parapet, trim: pal.trim, parts: f === 0 ? parts.map(p => p) : parts, acs: f === 0 ? [] : acs, laundry: f === 0 ? 0 : 0.45, fh, ground: f === 0 });
      if (bal === 'solid') B.box('plain', 0, fy + 1.12, 1.25, w + 0.12, 0.05, 0.1, { color: pal.accent });           // accent line on the coping
    }
    for (const e of [-1, 1]) downpipe(B, [e * (w / 2 + 0.05), H + 0.3, 1.2], [e * (w / 2 + 0.05), 0, 1.2], 0, [0.72, 0.72, 0.7]);
  });
  // back: service windows, meter boxes, and a stair tower at every core with its entrance
  inFrame(B, [0, 0, -d / 2], Math.PI, () => {
    for (const h of back) windowUnit(B, h, { rng, frame: [0.78, 0.8, 0.82], grille: h.kind === 'kitchen', frosted: h.kind === 'bath' || rng() < 0.4, type: h.kind === 'bath' ? 'fixed' : 'slide', hood: h.kind === 'kitchen' ? mul(pal.trim, 0.9) : null });
    // slab edges along the back between the stair towers, a downpipe beside each tower
    { const xs = cores.map(c => -c).sort((a, b) => a - b); let xa = -w / 2;
      for (const X of xs) { floorBands(B, xa, X - 1.35, floorsY, pal.trim); xa = X + 1.35; } floorBands(B, xa, w / 2, floorsY, pal.trim);
      for (const X of xs) downpipe(B, [X + 1.6, H + 0.3, 0.08], [X + 1.6, 0, 0.08], 0, [0.72, 0.72, 0.7]); }
    for (const c of cores) {
      const X = -c, tw = 2.7, td = 1.5, top = H + 2.4;
      // tower walls (its back face is open at the half landings)
      const holes = [{ x0: X - 1.0, x1: X + 1.0, y0: y0, y1: 2.6, d: 1.25, porch: true }];
      for (let f = 0; f < floors; f++) { const hy = y0 + f * fh + fh / 2; holes.push({ x0: X - 0.95, x1: X + 0.95, y0: hy + 0.95, y1: hy + 1.95, d: 0.12, open: true }); }
      inFrame(B, [X, 0, td], 0, () => {
        const hl = holes.map(h => ({ ...h, x0: h.x0 - X, x1: h.x1 - X }));
        B.frame(...B.P([0, 0, 0]), B.F.r);
        // face with openings
        const Fr = B.F;
        const wf = (x0, x1, yb, yt) => B.quad('tiles', [x0, yb, 0], [x1, yb, 0], [x1, yt, 0], [x0, yt, 0], { color: towerC, uvs: [[x0 / 2.5, yb / 2.5], [x1 / 2.5, yb / 2.5], [x1 / 2.5, yt / 2.5], [x0 / 2.5, yt / 2.5]] });
        let yb = 0;
        for (const h of hl) { if (h.y0 > yb) { wf(-tw / 2, tw / 2, yb, h.y0); } wf(-tw / 2, h.x0, h.y0, h.y1); wf(h.x1, tw / 2, h.y0, h.y1); yb = h.y1; }
        wf(-tw / 2, tw / 2, yb, top);
        // inside: the dark stair well behind each opening, its reveals, and the landing railing
        for (const h of hl) { if (h.porch) continue;
          B.quad('dark', [h.x0, h.y0, -0.9], [h.x1, h.y0, -0.9], [h.x1, h.y1, -0.9], [h.x0, h.y1, -0.9], { color: [0.2, 0.2, 0.21] });
          reveals(B, 'tiles', { ...h, d: 0.9 }, mul(wall, 0.88), 1.2);
          if (h.open) { B.box('steel', (h.x0 + h.x1) / 2, h.y0 + 0.2, -0.06, h.x1 - h.x0, 0.04, 0.04, { color: [0.6, 0.62, 0.64] }); B.detail(1, () => { for (let xx = h.x0 + 0.12; xx < h.x1; xx += 0.14) B.box('steel', xx, h.y0, -0.06, 0.02, 0.2, 0.02, { color: [0.6, 0.62, 0.64] }); }); }
        }
        // the entrance: a porch into the stair hall with its doors, intercom, mail bank for the ten flats it serves,
        // under a canopy; the landing and steps down to a forecourt
        B.frame(Fr.x, Fr.y, Fr.z, Fr.r);
        const ci = cores.indexOf(c);
        entrancePorch(B, rng, { w: 2.0, y0, yh: 2.6, depth: 1.25, wall: towerC, mail: [2, floors], side: ci % 2 ? 1 : -1, lampAt: out.lamps, frame: [0.36, 0.37, 0.38] });
        entranceCanopy(B, 0, y0, 2.9, 1.45, { color: pal.parapet, lampAt: out.lamps, steps: false, h: 2.62 });
        const rooms = `${ci * 2 + 1 < 10 ? '10' : '1'}${ci * 2 + 1}〜${floors}${String(ci * 2 + 2).padStart(2, '0')}`;
        plate(B, 0, 2.78, 0.02, 0, 0.9, 0.3, (g, W2, H2) => { g.fillStyle = '#f2f0ea'; g.fillRect(0, 0, W2, H2); g.fillStyle = '#2d3136'; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.font = `bold ${H2 * 0.52}px Arial`; g.fillText(`${no}-${ci + 1}`, W2 * 0.26, H2 * 0.54); g.fillRect(W2 * 0.5, H2 * 0.18, 2, H2 * 0.64); g.font = `${H2 * 0.34}px ${JP_FONT}`; g.fillText(rooms, W2 * 0.75, H2 * 0.54); }, 0.25, 128);
        const ap = s.gy ? approach(B, s.gy, { w: 2.4, y0, land: 1.45, ramp: 0 }) : { foot: [0, 2.2], court: [-1.8, 1.2, 1.8, 3.4] };
        out.entrances.push({ p: B.P([ap.foot[0], 0, ap.foot[1]]), out: [B.N([0, 0, 1])[0], B.N([0, 0, 1])[2]], kind: 'stair', court: courtW(B, ap.court), block: (ap.block || []).map(q => courtW(B, q)), front: B.P([0, 0, ap.foot[1] - 0.9]) });
      });
      // the tower's side walls and roof (it stands td proud of the back wall)
      for (const sx of [-1, 1]) inFrame(B, [X + sx * tw / 2, 0, td / 2], sx * Math.PI / 2, () => B.quad('tiles', [-td / 2, 0, 0], [td / 2, 0, 0], [td / 2, top, 0], [-td / 2, top, 0], { color: mul(towerC, 0.96), uv: 2.5 }));
      B.bbox('concrete', X, top, td / 2 - 0.05, tw + 0.2, 0.14, td + 0.3, 0.015, { color: pal.trim });
      B.bbox('concrete', X, top - 0.55, td + 0.02, tw + 0.04, 0.5, 0.06, 0.01, { color: strong(pal) });                      // coloured band at the tower head
      for (let f = 1; f < floors; f++) meterBox(B, X + (rng() < 0.5 ? -1 : 1) * 2.1, y0 + f * fh + 1.2, 'power');
    }
  });
  // gables: the estate's graphic painted on the blank part (stepped stripes or storey bands in the accent), the block
  // number high on the east end
  const graphic = no % 3, gA = strong(pal), gB = mix3(gA, [1, 1, 1], 0.45), gC = mul(gA, 0.72);
  const gableArt = (xa, xb) => { const span = xb - xa;
    if (graphic === 0) [[0, 0.62, gC], [0.24, 0.8, gA], [0.48, 1, gB]].forEach(([t, k, c]) => panel(B, xa + span * t, xa + span * (t + 0.2), y0 + fh * 0.5, y0 + fh * 0.5 + (H - y0 - fh) * k, c, 0.04));
    else if (graphic === 1) for (let f = 0; f < floors; f += 2) panel(B, xa, xb, y0 + f * fh + 0.35, y0 + (f + 1) * fh - 0.35, f % 4 === 0 ? gA : gB, 0.04);
    else { panel(B, xa, xb, H - fh * 1.6, H - 0.3, gA, 0.04); panel(B, xa, xa + 1.3, y0 + 0.4, H - fh * 1.6, gC, 0.04); panel(B, xa + 1.6, xa + 2.1, y0 + 0.4, H - fh * 1.6, gB, 0.04); } };
  inFrame(B, [w / 2, 0, 0], Math.PI / 2, () => { for (const h of mir(gable)) windowUnit(B, h, { rng, frame: [0.78, 0.8, 0.82], type: 'slide' }); gableArt(-d / 2 + 3.2, d / 2 - 0.7); blockNumber(B, 0.8, H - 3.6, 0.07, 0, no); });
  inFrame(B, [-w / 2, 0, 0], -Math.PI / 2, () => { for (const h of gable) windowUnit(B, h, { rng, frame: [0.78, 0.8, 0.82], type: 'slide' }); gableArt(-d / 2 + 0.7, d / 2 - 3.2); });
  const roofY = flatRoof(B, { w, d, y: H, para: 0.7, color: wall, wallMat: 'tiles', coping: pal.trim });
  B.bbox('metal', cores[0], roofY, -d / 4, 2.4, 1.9, 2.4, 0.03, { color: [0.86, 0.86, 0.83] });                            // water tank
  for (let i = 0; i < Math.min(3, cores.length); i++) antenna(B, cores[i] + 1.5, roofY, 0);
  ex.push({ t: 'box', p: B.P([0, 0, 0.3]), hx: w / 2 + 0.2, hz: d / 2 + 1.2, r, h: H + 1 });
  for (const c of cores) ex.push({ t: 'box', p: B.P([c, 0, -d / 2 - 0.75]), hx: 1.4, hz: 0.8, r, h: H + 2 });
  out.footprint = [[-w / 2 - 0.3, -d / 2 - 1.6], [w / 2 + 0.3, d / 2 + 1.5]]; out.H = H;
  for (const e of out.lamps) lampPoints.push(e);
  B.frame(0, 0, 0, 0);
  return out;
}

// ---------------------------------------------------------------- ポイント型 point tower
function pointTower_build(B, s, rng, ex) {
  const { x, y, z, r, w = 18, d = 16, floors = 11, pal = PALETTES.white, no = 1 } = s, fh = 2.9, y0 = 0.4, H = y0 + floors * fh;
  const out = { entrances: [], lamps: [] }, wall = jit(rng, pal.wall, 0.02), WR = 3.2;                                      // WR: corner balconies wrap this far
  B.frame(x, y, z, r);
  B.bbox('concrete', 0, -0.45, 0, w + 0.12, 0.85, d + 0.12, 0.02, { color: pal.base });
  const front = [], back = [], side = [];
  for (let f = 0; f < floors; f++) {
    const fy = y0 + f * fh;
    for (const u of [-1, 1]) { const cx = u * w / 4;
      front.push({ x0: cx - 3.3, x1: cx - 0.6, y0: fy + 0.05, y1: fy + 2.1, d: 0.18 }, { x0: cx + 0.2, x1: cx + 2.6, y0: fy + 0.05, y1: fy + 2.1, d: 0.18 }); }
    side.push({ x0: d / 2 - WR + 0.5, x1: d / 2 - 0.6, y0: fy + 0.05, y1: fy + 2.1, d: 0.18 }, { x0: -d / 2 + 1.2, x1: -d / 2 + 2.9, y0: fy + 0.95, y1: fy + 2.05, d: 0.16 }, { x0: -1.6, x1: 0.2, y0: fy + 0.95, y1: fy + 2.05, d: 0.16 });
    for (const u of [-1, 1]) back.push({ x0: u * 6.4 - 0.75, x1: u * 6.4 + 0.75, y0: fy + 1.0, y1: fy + 2.0, d: 0.14, frosted: true },
      { x0: u * 4.3 - 0.55, x1: u * 4.3 + 0.55, y0: fy + 0.95, y1: fy + 2.05, d: 0.16 });
  }
  const crown = mix3(wall, strong(pal), 0.3), floorsY = []; for (let f = 2; f < floors; f++) floorsY.push(y0 + f * fh);
  const bands = [['tiles', pal.base, 2.5, y0 + 2 * fh], ['tiles', wall, 2.5, y0 + (floors - 1) * fh], ['tiles', crown, 2.5]];
  const mir = hs => hs.map(h => ({ ...h, x0: -h.x1, x1: -h.x0 }));
  boxWalls(B, 0, w, d, y0, H + 0.9, bands, fi => fi === 0 ? front : fi === 1 ? back : fi === 2 ? mir(side) : side, mul(wall, 0.95));
  // front and side balconies: one continuous slab across the front turning the corners
  const parC = mix3(pal.parapet, strong(pal), 0.22);
  const balc = f => {
    const fy = y0 + f * fh, dp = 1.5;
    inFrame(B, [0, 0, d / 2], 0, () => balconyRun(B, rng, -w / 2 - dp, w / 2 + dp, fy, dp, { kind: f % 2 ? 'glass' : 'solid', color: parC, trim: pal.trim, parts: [0], acs: rng() < 0.6 ? [-w / 4 + 1, w / 4 + 1] : [], fh, laundry: 0.35, ground: f === 0, ends: [false, false] }));
    for (const sx of [-1, 1]) inFrame(B, [sx * w / 2, 0, d / 2 - WR / 2], sx * Math.PI / 2, () => balconyRun(B, rng, sx > 0 ? -WR / 2 - dp : -WR / 2, sx > 0 ? WR / 2 : WR / 2 + dp, fy, dp, { kind: f % 2 ? 'glass' : 'solid', color: parC, trim: pal.trim, fh, laundry: 0, ground: f === 0, ends: sx > 0 ? [false, true] : [true, false], lift: 0.004 }));
  };
  for (let f = 0; f < floors; f++) balc(f);
  inFrame(B, [0, 0, d / 2], 0, () => { for (const h of front) windowUnit(B, h, { rng, frame: [0.8, 0.82, 0.84], type: 'slide', sill: false }); });
  for (const sx of [-1, 1]) inFrame(B, [sx * w / 2, 0, 0], sx * Math.PI / 2, () => { for (const h of sx > 0 ? mir(side) : side) windowUnit(B, h, { rng, frame: [0.8, 0.82, 0.84], type: 'slide', sill: (h.y0 - y0) % fh > 0.5, shutterBox: (h.y0 - y0) % fh > 0.5 && rng() < 0.3, hood: (h.y0 - y0) % fh > 0.5 ? mul(pal.trim, 0.85) : null });
    // the back corner of each side carries a full-height accent panel; slab edges run from it to the balcony wrap
    const m = x => sx > 0 ? -x : x;
    panel(B, Math.min(m(-d / 2), m(-d / 2 + 0.95)), Math.max(m(-d / 2), m(-d / 2 + 0.95)), y0 + 2 * fh, H + 0.9, strong(pal));
    floorBands(B, Math.min(m(-d / 2 + 0.95), m(d / 2 - WR - 0.2)), Math.max(m(-d / 2 + 0.95), m(d / 2 - WR - 0.2)), floorsY, pal.trim); });
  // the core: a shaft on the back rising over the roof (lift machine room), hall windows up it, glazed lobby below
  const cw = 6.4, cd = 2.6, ctop = H + 3.6;
  inFrame(B, [0, 0, -d / 2], Math.PI, () => {
    for (const h of back) windowUnit(B, h, { rng, frame: [0.8, 0.82, 0.84], frosted: h.frosted, type: 'slide', hood: mul(pal.trim, 0.85) });
    for (const sx of [-1, 1]) { panel(B, sx > 0 ? w / 2 - 0.95 : -w / 2, sx > 0 ? w / 2 : -w / 2 + 0.95, y0 + 2 * fh, H + 0.9, strong(pal));
      floorBands(B, sx > 0 ? cw / 2 : -w / 2 + 0.95, sx > 0 ? w / 2 - 0.95 : -cw / 2, floorsY, pal.trim);
      for (let f = 2; f < floors; f += 1) if (rng() < 0.5) acUnit(B, sx * 4.3, y0 + f * fh + 0.2, rng, { z: 0.3, onWall: true }); }
    B.bbox('tiles', 0, 0, cd / 2, cw, ctop, cd, 0.03, { color: mul(wall, 0.97), uv: 2.5, skip: 'nypz' });
    inFrame(B, [0, 0, cd], 0, () => wallFill(B, 'tiles', -cw / 2 + 0.03, cw / 2 - 0.03, 0, ctop, [{ x0: -2.6, x1: 2.6, y0: y0, y1: 3.0 }], mul(wall, 0.97), 2.5));
    for (let f = 1; f < floors; f++) { const fy = y0 + f * fh; B.quad('shopWindow', [-0.7, fy + 0.4, cd + 0.005], [0.7, fy + 0.4, cd + 0.005], [0.7, fy + 2.3, cd + 0.005], [-0.7, fy + 2.3, cd + 0.005], { color: [0.9, 1, 3.5 / 8], uvs: [[0, 0], [1, 0], [1, 1], [0, 1]] });
      B.box('alu', 0, fy + 0.35, cd + 0.02, 1.5, 0.06, 0.06, { color: pal.trim }); B.box('alu', 0, fy + 2.3, cd + 0.02, 1.5, 0.06, 0.06, { color: pal.trim }); }
    B.bbox('concrete', 0, ctop, cd / 2, cw + 0.2, 0.18, cd + 0.2, 0.02, { color: pal.trim });
    // lobby: glazed screens either side of a recessed entrance porch with automatic doors, a canopy on two columns
    B.frame(...B.P([0, 0, cd]), B.F.r);
    const lob = { color: [1.25, 1, 3.5 / 8], uvs: [[0, 0], [1, 0], [1, 1], [0, 1]] }, fr = { color: [0.3, 0.3, 0.32] };
    for (const e of [-1, 1]) { const a = e * 1.4, b = e * 2.6;
      B.quad('dark', [Math.min(a, b), y0, -0.3], [Math.max(a, b), y0, -0.3], [Math.max(a, b), 3.0, -0.3], [Math.min(a, b), 3.0, -0.3], { color: [0.1, 0.1, 0.1] });
      B.quad('shopWindow', [Math.min(a, b), y0, 0.02], [Math.max(a, b), y0, 0.02], [Math.max(a, b), 3.0, 0.02], [Math.min(a, b), 3.0, 0.02], lob);
      for (const xx of [b, (a + b) / 2]) B.box('alu', xx, y0, 0.04, 0.08, 3.0 - y0, 0.08, fr); B.box('alu', (a + b) / 2, y0, 0.04, 1.24, 0.12, 0.08, fr); B.box('alu', (a + b) / 2, 2.94, 0.04, 1.24, 0.06, 0.08, fr); }
    entrancePorch(B, rng, { w: 2.8, y0, yh: 3.0, depth: 2.2, wall: [0.86, 0.85, 0.82], auto: true, mail: [4, 5], lockers: true, lampAt: out.lamps, floorC: [0.42, 0.4, 0.39] });
    entranceCanopy(B, 0, y0, 5.6, 3.0, { cols: true, color: [0.9, 0.9, 0.88], lampAt: out.lamps, h: 3.0, steps: false });
    plate(B, 0, 3.86, 0.02, 0, 3.2, 0.4, (g, W2, H2) => { g.fillStyle = '#2f3438'; g.fillRect(0, 0, W2, H2); g.fillStyle = '#e8e4d8'; g.font = `bold ${H2 * 0.55}px ${JP_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(s.name || `サクラタワー ${no}`, W2 / 2, H2 * 0.55); }, 0.4, 256);
    const ap = s.gy ? approach(B, s.gy, { w: 3.6, y0, land: 1.8, ramp: rng() < 0.5 ? -1 : 1, court: 2.6, style: 'granite' }) : { foot: [0, 4.2], court: [-2.4, 1.6, 2.4, 4.4] };
    out.entrances.push({ p: B.P([ap.foot[0], 0, ap.foot[1]]), out: [B.N([0, 0, 1])[0], B.N([0, 0, 1])[2]], kind: 'lobby', court: courtW(B, ap.court), block: (ap.block || []).map(q => courtW(B, q)) });
  });
  B.frame(x, y, z, r);
  const roofY = flatRoof(B, { w, d, y: H, para: 0.9, color: wall, wallMat: 'tiles', coping: pal.trim });
  B.bbox('concrete', 0, H + 0.2, d / 2 - 0.2, w + 0.1, 0.5, 0.14, 0.01, { color: pal.accent });                          // crown band
  B.bbox('metal', w / 4, roofY, 0, 2.6, 2.1, 2.6, 0.03, { color: [0.86, 0.86, 0.83] });
  antenna(B, -w / 4, roofY, d / 5);
  ex.push({ t: 'box', p: B.P([0, 0, 0]), hx: w / 2 + 1.6, hz: d / 2 + 1.6, r, h: H + 1 });
  out.footprint = [[-w / 2 - 1.6, -d / 2 - 3], [w / 2 + 1.6, d / 2 + 1.6]]; out.H = H;
  for (const e of out.lamps) lampPoints.push(e);
  B.frame(0, 0, 0, 0);
  return out;
}

// ---------------------------------------------------------------- modern mid-rise (マンション)
function mansion_build(B, s, rng, ex) {
  const { x, y, z, r, w, d = 11.5, floors = 8, pal = PALETTES.mocha, no = 1, podium = false, pilotis = 0, name = null } = s, fh = 3.0, y0 = podium ? 0.1 : 0.4, H = y0 + floors * fh;
  const nU = Math.max(3, Math.round(w / 6.6)), uw = w / nU, out = { entrances: [], lamps: [] }, wall = jit(rng, pal.wall, 0.02);
  const lift = s.lift ?? Math.round(nU / 2) - 1, liftX = -w / 2 + (lift + 1) * uw;                                        // lift at a unit boundary near the middle
  B.frame(x, y, z, r);
  if (!podium) { const pw = pilotis * uw; B.bbox('concrete', -pw / 2, -0.45, 0, w + 0.12 - pw, 0.85, d + 0.12, 0.02, { color: pal.base }); }  // (the pilotis bays stand at grade)
  const front = [], back = [];
  for (let f = 0; f < floors; f++) {
    const fy = y0 + f * fh;
    for (let u = 0; u < nU; u++) {
      const cx = -w / 2 + (u + 0.5) * uw, pil = !podium && f === 0 && u >= nU - pilotis;
      if (pil) continue;
      front.push({ x0: cx - uw / 2 + 0.4, x1: cx + 0.6, y0: fy + 0.05, y1: fy + 2.2, d: 0.2 }, { x0: cx + 1.0, x1: cx + uw / 2 - 0.4, y0: fy + 0.05, y1: fy + 2.2, d: 0.2 });
      if (f === 0 && !podium && Math.abs(cx - liftX) < uw) continue;                                                        // the lobby takes the back here
      const X = -cx;                                                                                                        // (back faces run mirrored)
      back.push({ x0: X - 0.5, x1: X + 0.5, y0: fy + 0.02, y1: fy + 2.12, d: 0.14, door: true }, { x0: X + 0.9, x1: X + 2.1, y0: fy + 1.05, y1: fy + 2.0, d: 0.14 });
    }
  }
  // gables: a bedroom window at the front (and at the back where no stair stands) on each floor either side of a
  // full-height accent panel. (+x gable: local x runs toward the back; -x gable: toward the front, its back 4.5 m under
  // the stair tower)
  const gP = [], gM = [], gFloors = [];
  for (let f = podium ? 0 : 1; f < floors; f++) { const fy = y0 + f * fh; gFloors.push(fy);
    gP.push({ x0: -d / 2 + 1.1, x1: -d / 2 + 2.3, y0: fy + 0.95, y1: fy + 2.05, d: 0.16 }, { x0: d / 2 - 2.3, x1: d / 2 - 1.1, y0: fy + 0.95, y1: fy + 2.05, d: 0.16 });
    gM.push({ x0: d / 2 - 2.3, x1: d / 2 - 1.1, y0: fy + 0.95, y1: fy + 2.05, d: 0.16 }); }
  const bodyBands = podium ? [['tiles', wall, 2.5]] : [['tiles', mix3(wall, pal.base, 0.45), 2.5, y0 + fh - 0.1], ['tiles', wall, 2.5]];
  // pilotis: the ground floor of the end units is open to the front and the end, a beam over the opening
  const px0 = -w / 2 + (nU - pilotis) * uw, pTop = y0 + fh - 0.35, pil = !podium && pilotis > 0;
  const pilF = pil ? [{ x0: px0 + 0.3, x1: w / 2 + 0.01, y0: y0 - 0.01, y1: pTop, d: 0.25 }] : [], pilG = pil ? [{ x0: -d / 2 - 0.01, x1: d / 2 - 0.3, y0: y0 - 0.01, y1: pTop, d: 0.25 }] : [];
  boxWalls(B, 0, w, d, y0, H + 0.9, bodyBands, fi => fi === 0 ? front.concat(pilF) : fi === 1 ? back : fi === 2 ? gP.concat(pilG) : gM, mul(wall, 0.95));
  for (const sx of [-1, 1]) inFrame(B, [sx * w / 2, 0, 0], sx * Math.PI / 2, () => {
    for (const h of sx > 0 ? gP : gM) windowUnit(B, h, { rng, frame: [0.3, 0.3, 0.32], type: 'slide', hood: mul(pal.trim, 0.9) });
    panel(B, sx > 0 ? -1.1 : -1.0, sx > 0 ? 1.1 : 1.2, y0 + (podium ? 0.2 : fh), H + 0.9, strong(pal));
    floorBands(B, sx > 0 ? -d / 2 + 0.2 : -d / 2 + 4.6, sx > 0 ? -1.1 : -1.0, gFloors, pal.trim); floorBands(B, sx > 0 ? 1.1 : 1.2, d / 2 - 0.2, gFloors, pal.trim);
  });
  // front: balconies whose fronts alternate glass and tiled panels in vertical stripes, AC units, partitions
  inFrame(B, [0, 0, d / 2], 0, () => {
    for (const h of front) windowUnit(B, h, { rng, frame: [0.3, 0.3, 0.32], type: 'slide', sill: false });
    for (let f = 0; f < floors; f++) {
      const fy = y0 + f * fh;
      for (let u = 0; u < nU; u++) {
        const x0 = -w / 2 + u * uw, x1 = x0 + uw, pil = !podium && f === 0 && u >= nU - pilotis;
        if (pil) continue;
        const gnd = f === 0 && !podium;
        balconyRun(B, rng, x0 + (gnd ? 0 : 0.125), x1 - (gnd ? 0 : 0.125), fy, 1.8, { kind: (u + (f > floors - 3 ? 1 : 0)) % 3 === 1 ? 'solid' : 'glass', color: u % 3 === 1 ? pal.accent : pal.parapet, trim: pal.trim, parts: [], acs: rng() < 0.6 ? [x0 + 0.7] : [], fh, laundry: 0.25, ground: gnd, ends: gnd ? [u === 0, true] : [false, false] });
      }
    }
    // the balcony slabs' edges read as bands across the face; slim fins between the columns of balconies
    const finY = podium ? y0 - 0.2 : y0 + fh - 0.2;
    for (let u = 0; u <= nU; u++) B.bbox('concrete', -w / 2 + u * uw, finY, 0.95, 0.25, H - finY + 0.1, 1.9, 0.01, { color: pal.trim });
  });
  // back: an open access corridor on every upper floor, doors and small windows along it
  inFrame(B, [0, 0, -d / 2], Math.PI, () => {
    for (const h of back) { if (h.door) { doorUnit(B, h, { color: jit(rng, [0.38, 0.32, 0.28], 0.06), mat: 'metal', frame: [0.3, 0.3, 0.32] }); doorFurniture(B, h.x1 + 0.15, h.y0); } else windowUnit(B, h, { rng, grille: true, frosted: true, frame: [0.3, 0.3, 0.32] }); }
    for (let f = 1; f < floors; f++) {
      const fy = y0 + f * fh;
      B.bbox('concrete', 0, fy - 0.18, 0.8, w, 0.18, 1.6, 0.012, { color: [0.8, 0.8, 0.78] });
      B.bbox('tiles', 0, fy, 1.54, w + 0.04, 1.15, 0.12, 0.012, { color: pal.parapet, uv: 2.5 });
      B.box('plain', 0, fy + 1.15, 1.54, w + 0.06, 0.06, 0.16, { color: pal.accent });
      guard(B, 'solid', -w / 2 + 0.06, 1.54, -w / 2 + 0.06, 0.02, fy, { color: pal.parapet, trim: pal.trim });
      B.box('lamp', 0, fy + fh - 0.22, 0.8, w - 1, 0.02, 0.08);
      lampPoints.push({ p: B.P([0, fy + fh - 0.4, 1.0]), s: 0.4 });
      for (let u = 0; u < nU; u++) meterBox(B, -w / 2 + (u + 0.5) * uw - 1.0, fy + 1.3, 'power');
    }
    // lift tower in the middle of the corridor side, glazed at each landing; lobby at its foot
    // (without a podium the shaft stands on the lobby: a glazed box out past the corridor line at its foot)
    const X = -liftX, lt = H + 3.2, LW = 7.2, LD = 4.2, LH = y0 + fh - 0.2, sb = podium ? 0 : LH + 0.6;
    B.bbox('tiles', X, sb, 2.8, 3.0, lt - sb, 2.4, 0.03, { color: mul(wall, 0.92), uv: 2.5, skip: 'ny' });
    const hall = { color: [0.9, 1, 3.5 / 8], uvs: [[0, 0], [1, 0], [1, 1], [0, 1]] };
    for (let f = 1; f < floors; f++) { const gy0 = y0 + f * fh + 0.2; B.quad('shopWindow', [X - 0.6, gy0, 4.01], [X + 0.6, gy0, 4.01], [X + 0.6, gy0 + 2.2, 4.01], [X - 0.6, gy0 + 2.2, 4.01], hall);
      for (const yy of [gy0 - 0.04, gy0 + 2.2]) B.box('alu', X, yy, 4.03, 1.3, 0.05, 0.05, { color: [0.3, 0.3, 0.32] }); }
    B.bbox('concrete', X, lt, 2.8, 3.2, 0.16, 2.6, 0.02, { color: pal.trim });
    if (!podium) {
      const lob = { color: [1.25, 1, 3.5 / 8], uvs: [[0, 0], [1, 0], [1, 1], [0, 1]] }, mul3 = { color: [0.3, 0.3, 0.32] };
      B.bbox('concrete', X, -0.45, LD / 2, LW + 0.2, y0 + 0.45, LD + 0.1, 0.02, { color: pal.base });
      // glazed screens either side of a recessed porch with automatic doors; glazed ends
      for (const e of [-1, 1]) { const a = X + e * 1.4, b = X + e * LW / 2;
        B.quad('shopWindow', [Math.min(a, b), y0 + 0.02, LD], [Math.max(a, b), y0 + 0.02, LD], [Math.max(a, b), LH, LD], [Math.min(a, b), LH, LD], lob);
        for (const xx of [b, (a + b) / 2, a]) B.box('alu', xx, y0, LD + 0.02, 0.08, LH - y0, 0.08, mul3);
        B.box('alu', (a + b) / 2, LH - 0.8, LD + 0.02, LW / 2 - 1.4, 0.06, 0.06, mul3); }
      for (const e of [-1, 1]) B.poly('shopWindow', [[X + e * LW / 2, y0 + 0.02, 0.05], [X + e * LW / 2, y0 + 0.02, LD], [X + e * LW / 2, LH, LD], [X + e * LW / 2, LH, 0.05]], [e, 0, 0], lob);
      for (const e of [-1, 1]) for (const zz of [0.1, LD / 2]) B.box('alu', X + e * LW / 2, y0, zz, 0.08, LH - y0, 0.08, mul3);
      B.bbox('tiles', X, LH, (1.6 + LD + 0.2) / 2, LW + 0.3, 0.6, LD + 0.2 - 1.6, 0.02, { color: mul(wall, 0.92), uv: 2.5 });
      // colliders: the lobby's two glazed wings and its back, so the porch itself can be walked into
      for (const e of [-1, 1]) ex.push({ t: 'box', p: B.P([X + e * (LW / 2 + 1.4) / 2, 0, LD / 2]), hx: (LW / 2 - 1.4) / 2 + 0.1, hz: LD / 2, r, h: LH + 0.6 });
      ex.push({ t: 'box', p: B.P([X, 0, (LD - 2.2) / 2]), hx: 1.5, hz: (LD - 2.2) / 2, r, h: LH + 0.6 });
      B.frame(...B.P([X, 0, LD]), B.F.r);
      entrancePorch(B, rng, { w: 2.8, y0, yh: LH - 0.35, depth: 2.2, wall: mix3(wall, [0.9, 0.88, 0.84], 0.5), auto: true, mail: [4, 5], lockers: true, lampAt: out.lamps, floorC: [0.4, 0.38, 0.37] });
      entranceCanopy(B, 0, y0, 3.8, 2.3, { cols: true, color: [0.28, 0.28, 0.3], lampAt: out.lamps, h: LH - y0 - 0.22, steps: false });
      plate(B, 0, LH + 0.3, 0.22, 0, 4.4, 0.42, (g, W2, H2) => { g.fillStyle = '#26282b'; g.fillRect(0, 0, W2, H2); g.fillStyle = '#e9dcc0'; g.font = `${H2 * 0.5}px ${JP_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(name || `パークハイツ桜川 ${no}`, W2 / 2, H2 * 0.55); }, 0.5, 256);
      const ap = s.gy ? approach(B, s.gy, { w: 3.0, y0, land: 1.6, ramp: rng() < 0.5 ? -1 : 1, court: 2.6, style: 'granite' }) : { foot: [0, 2.4], court: [-2, 1.4, 2, 3.4] };
      out.entrances.push({ p: B.P([ap.foot[0], 0, ap.foot[1]]), out: [B.N([0, 0, 1])[0], B.N([0, 0, 1])[2]], kind: 'lobby', court: courtW(B, ap.court), block: (ap.block || []).map(q => courtW(B, q)) });
      // walks from the ground-floor doors under the corridor, round the lobby's glazed sides, into the apron's side
      { const [xa, za, xb, zb] = ap.court, zm = (za + zb) / 2 + 0.3; out.walkways = [];
        // (on the stair tower's side it ends on the stair's foot)
        for (const e of [-1, 1]) { const sideX = e < 0 ? xa : xb, cx2 = e * Math.max(Math.abs(sideX) + 1.1, LW / 2 + 0.95), endX = e * (w / 2 + 0.3) + (-X);
          if (e * endX < e * cx2 + 1) continue;
          out.walkways.push([[endX, -LD + 0.85], [cx2, -LD + 0.85], [cx2, zm], [sideX - e * 0.6, zm]].map(([lx, lz]) => { const q = B.P([lx, 0, lz]); return [q[0], q[2]]; })); } }
    }
  });
  B.frame(x, y, z, r);
  // stair: an open stair tower against the far gable, at the access corridor's end: a landing level with the corridor
  // on every upper floor, a half landing against the outer face, two concrete flights a storey (8 risers of 18.75 cm,
  // 25 cm treads), the first from the ground (paved where the walk under the corridor arrives) to the first half
  // landing, the last arriving at the top floor; solid parapets on every open side and raking ones along the outer
  // flights, handrails along the inner. (local x: -2.25 at the building's back, where the corridor comes in, to +2.25;
  // z: 0 at the gable wall to 2.6 out)
  // (stairTower: false — a wing whose stair end abuts another block's mass, reaching a stair along its corridor)
  if (s.stairTower !== false) inFrame(B, [-w / 2, 0, -d / 2 + 0.65], -Math.PI / 2, () => {
    const top = H + 1.2, SC = [0.8, 0.8, 0.78], pc = pal.parapet, g = { color: pc, trim: pal.trim }, LX = 0.875, RAIL = [0.6, 0.62, 0.64];
    const gl = (lx, lz) => { if (!s.gy) return 0; const p = B.P([lx, 0, lz]); return s.gy(p[0], p[2]) - B.F.y; };
    for (const cx2 of [-2.1, 2.1]) B.bbox('tiles', cx2, Math.min(0, gl(cx2, 2.45)) - 0.3, 2.45, 0.3, top - Math.min(0, gl(cx2, 2.45)) + 0.3, 0.3, 0.02, { color: mul(wall, 0.95) });
    // flight in the tower frame from (xa, ya) to (xb, yb) along z = zc, 1.2 wide
    const flight = (xa, xb, ya, yb, zc, base) => { const dir = Math.sign(xb - xa); let S;
      inFrame(B, [xa, 0, zc], dir * Math.PI / 2, () => { S = stairFlight(B, { w: 1.2, y0: ya, y1: yb, run: Math.abs(xb - xa), base, body: SC, tread: [0.86, 0.85, 0.82] }); });
      return S; };
    const rail = (kind, xa, xb, zr, S) => { const dir = Math.sign(xb - xa); inFrame(B, [xa, 0, zr], dir * Math.PI / 2, () => stairRail(B, kind, 0, -0.15, Math.abs(xb - xa) + 0.15, S.pitch, { color: RAIL, wall: pc })); };
    for (let f = 0; f < floors; f++) {
      const fy = y0 + f * fh, hy = fy + fh / 2, last = f === floors - 1;
      if (f > 0) { B.bbox('concrete', -(2.25 + LX) / 2, fy - 0.16, 1.3, 2.25 - LX, 0.16, 2.6, 0.01, { color: SC });
        guard(B, 'solid', -LX, 2.54, -2.19, 2.54, fy, g); guard(B, 'solid', -2.19, 2.54, -2.19, 0.02, fy, g); }
      if (last) continue;                                                                                                // (the stair ends at the top floor)
      B.bbox('concrete', (2.25 + LX) / 2, hy - 0.16, 1.3, 2.25 - LX, 0.16, 2.6, 0.01, { color: SC });
      guard(B, 'solid', 2.19, 0.02, 2.19, 2.54, hy, g); guard(B, 'solid', 2.19, 2.54, LX, 2.54, hy, g);
      // up along the wall to the half landing (from the ground: a longer flight starting further back), back along the
      // outer face to the next floor
      let xa = -LX, ya = fy, base = fy - 0.16;
      // (on a podium the stair starts from the podium's roof terrace, which is the wing's ground)
      if (f === 0) { ya = podium ? 0.06 : Math.max(gl(-LX, 0.65), gl(-2.0, 0.65), gl(LX, 0.65)) + 0.05; const n0 = Math.ceil((hy - ya) / 0.19 - 1e-6); xa = Math.max(-2.25 + 0.75, LX - (n0 - 1) * 0.25); base = ya - (podium ? 0.06 : 0.35); }
      const SA = flight(xa, LX, ya, hy, 0.65, base), SB = flight(LX, -LX, hy, fy + fh, 1.95, hy - 0.16);
      B.detail(1, () => { rail('handrail', xa, LX, 1.22, SA); rail('handrail', xa, LX, 0.09, SA); rail('handrail', LX, -LX, 1.38, SB); });
      rail('parapet', LX, -LX, 2.54, SB);
      // the stair's foot: a paved landing the corridor's width, from under the corridor's end to past the first step
      // (its far part runs on under the first treads), which the walk under the corridor joins
      if (f === 0 && !podium) out.entrances.push({ p: B.P([(xa - 2.25) / 2, 0, 0.65]), out: [B.N([-1, 0, 0])[0], B.N([-1, 0, 0])[2]], kind: 'stair foot', viaWalk: true,
        court: [[-0.65, -1.0], [-0.65, 1.3], [-2.25, 1.3], [-2.25, -1.0]].map(([lx, lz]) => { const q = B.P([lx, 0, lz]); return [q[0], q[2]]; }) });
    }
    B.bbox('concrete', 0, top, 1.3, 4.7, 0.16, 2.9, 0.02, { color: pal.trim });
  });
  if (pilotis && !podium) { // open ground floor at the far end: columns, a ceiling, parking bays under the building
    for (let u = nU - pilotis; u <= nU; u++) for (const zz of [-d / 2 + 0.3, d / 2 - 0.3]) B.bbox('concrete', Math.min(w / 2 - 0.3, -w / 2 + u * uw), 0, zz, 0.6, y0 + fh, 0.6, 0.02, { color: [0.8, 0.8, 0.78] });
    const pc = (px0 + w / 2) / 2, pw = w / 2 - px0, SOF = [0.82, 0.82, 0.8];
    // inside: the soffit, the back wall and the flats' end wall seen from under the slab, a base course along the back,
    // lights under the soffit, a lined floor laid by the parking builder
    B.box('plain', pc, pTop - 0.02, 0, pw, 0.02, d, { color: SOF, skip: 'py' });
    B.quad('tiles', [px0, 0, d / 2], [px0, 0, -d / 2], [px0, pTop, -d / 2], [px0, pTop, d / 2], { color: mul(wall, 0.9), uv: 2.5 });
    B.quad('tiles', [px0, 0, -d / 2 + 0.01], [w / 2, 0, -d / 2 + 0.01], [w / 2, pTop, -d / 2 + 0.01], [px0, pTop, -d / 2 + 0.01], { color: mul(wall, 0.9), uv: 2.5 });
    B.bbox('concrete', pc, -0.45, -d / 2 + 0.1, pw, 0.85, 0.3, 0.02, { color: pal.base });
    for (const zz of [-d / 4, d / 4]) { B.box('lamp', pc, pTop - 0.06, zz, 1.2, 0.04, 0.14); lampPoints.push({ p: B.P([pc, pTop - 0.3, zz]), s: 0.5 }); }
    out.pilotis = { x0: px0, x1: w / 2 };
  }
  const roofY = flatRoof(B, { w, d, y: H, para: 0.9, color: wall, wallMat: 'tiles', coping: pal.trim });
  for (let i = 0; i < 3; i++) acUnit(B, -w / 3 + i * 2.2, roofY, rng, { pipeTo: roofY + 0.4 });
  ex.push({ t: 'box', p: B.P([0, 0, 0]), hx: w / 2 + 0.2, hz: d / 2 + 1.8, r, h: H + 1 });
  out.footprint = [[-w / 2 - 3, -d / 2 - 4.6], [w / 2 + 0.3, d / 2 + 2]]; out.H = H; if (!podium) out.corridor = { w, d, X: liftX };
  for (const e of out.lamps) lampPoints.push(e);
  B.frame(0, 0, 0, 0);
  return out;
}

// ---------------------------------------------------------------- corner block (コーナー棟)
// Two mid-rise wings meeting at a street corner round a taller corner tower. Frame: the corner tower centred at the
// origin, wing A along +x with its balconies to -z, wing B along +z with its balconies to -x; both wings' access
// corridors and lobbies face the court inside the L (+x +z). The tower rises two floors over the wings and carries
// recessed loggias (balconies set into the building, walled both sides) on its two street faces, glazed corner rooms at
// the top, a community room with a glazed front at street level, and the block's name on its crown.
function cornerBlock_build(B, s, rng, ex) {
  const { x, y, z, r, wa = 30, wb = 26, floors = 7, pal = PALETTES.white, no = 1, name = 'グランコート桜川', gy } = s, C = 6.0, fh = 3.0, y0 = 0.4, CF = floors + 2, H = y0 + CF * fh;
  const P = (lx, lz) => { B.frame(x, y, z, r); return B.P([lx, 0, lz]); };
  const pa = P(C + wa / 2 - 0.3, 0), A = mansion(B, { x: pa[0], y, z: pa[2], r: r + Math.PI, w: wa, floors, pal, no, name: name + ' A棟', gy, lift: 0 }, rng, ex);
  const pb = P(0, C + wb / 2 - 0.3), Bw = mansion(B, { x: pb[0], y, z: pb[2], r: r - Math.PI / 2, w: wb, floors, pal, no: no + 1, name: name + ' B棟', gy, lift: 2, stairTower: false }, rng, ex);
  // the wings' walks under their corridors that start at the tower meet in the court's inner corner (each wing's own
  // would run on past its end, into the tower)
  { const tc = P(0, 0), dt = q => Math.hypot(q[0] - tc[0], q[1] - tc[2]), near = L => L.reduce((b, k) => !b || dt(k[0]) < dt(b[0]) ? k : b, null), wA = near(A.walkways || []), wB = near(Bw.walkways || []);
    if (wA && wB) { const [a, b] = wA, [c, e] = wB, r1 = [b[0] - a[0], b[1] - a[1]], r2 = [e[0] - c[0], e[1] - c[1]], den = r1[0] * r2[1] - r1[1] * r2[0];
      if (Math.abs(den) > 1e-6) { const t = ((c[0] - a[0]) * r2[1] - (c[1] - a[1]) * r2[0]) / den, X = [a[0] + r1[0] * t, a[1] + r1[1] * t];
        if (Math.hypot(X[0] - a[0], X[1] - a[1]) < 4 && Math.hypot(X[0] - c[0], X[1] - c[1]) < 4) { wA[0] = X; wB[0] = [X[0], X[1]]; } } } }
  const out = { entrances: A.entrances.concat(Bw.entrances), walkways: (A.walkways || []).concat(Bw.walkways || []), lamps: [], H };
  const cxA = C + wa / 2 - 0.3, czB = C + wb / 2 - 0.3, d = 11.5;
  out.boxes0 = [[[-C - 0.5, -C - 0.5], [C + 0.5, C + 0.5]], [[cxA - wa / 2 - 0.3, -d / 2 - 2], [cxA + wa / 2 + 3, d / 2 + 4.6]], [[-d / 2 - 2, czB - wb / 2 - 3], [d / 2 + 4.6, czB + wb / 2 + 0.3]]];
  // the tower
  B.frame(x, y, z, r);
  const wall = mix3(jit(rng, pal.wall, 0.02), pal.parapet, 0.25), acc = strong(pal);
  B.bbox('concrete', 0, -0.45, 0, 2 * C + 0.12, 0.85, 2 * C + 0.12, 0.02, { color: pal.base });
  const logg = [], upper = [], ground = [];
  for (let f = 1; f < CF; f++) { const fy = y0 + f * fh; for (const [a, b] of [[-C + 0.9, -0.55], [0.55, C - 0.9]]) logg.push({ x0: a, x1: b, y0: fy + 0.02, y1: fy + fh - 0.35, d: 1.6, f }); }
  for (let f = floors; f < CF; f++) { const fy = y0 + f * fh; upper.push({ x0: -C + 1.0, x1: -1.0, y0: fy + 0.6, y1: fy + 2.4, d: 0.18 }, { x0: 1.0, x1: C - 1.0, y0: fy + 0.6, y1: fy + 2.4, d: 0.18 }); }
  ground.push({ x0: -C + 0.8, x1: C - 0.8, y0: y0 + 0.02, y1: y0 + 2.7, d: 0.2, shop: true });
  const bands = [['tiles', mix3(wall, pal.base, 0.5), 2.5, y0 + fh - 0.1], ['tiles', wall, 2.5, H - fh * 0.5], ['tiles', mix3(wall, acc, 0.35), 2.5]];
  boxWalls(B, 0, 2 * C, 2 * C, y0, H + 0.9, bands, fi => fi === 1 || fi === 3 ? logg.concat(ground) : upper, mul(wall, 0.92));
  // loggias: the flat's glazed wall at the back of the recess, a guard across the mouth, AC unit and laundry inside;
  // the community room behind a shop-front at street level; windows in the corner rooms at the top
  for (const fr of [Math.PI, -Math.PI / 2]) inFrame(B, [Math.sin(fr) * C, 0, Math.cos(fr) * C], fr, () => {
    for (const h of logg) { const kind = (h.f + (h.x0 < 0 ? 0 : 1)) % 3 === 0 ? 'solid' : 'glass';
      inFrame(B, [0, 0, -h.d], 0, () => { const dh = { x0: h.x0 + 0.35, x1: h.x1 - 0.35, y0: h.y0 + 0.03, y1: h.y0 + 2.15, d: 0.12 };
        wallFill(B, 'tiles', h.x0, h.x1, h.y0, h.y1, [dh], mul(wall, 0.9), 2.5); reveals(B, 'tiles', dh, mul(wall, 0.85), 1.2); windowUnit(B, dh, { rng, frame: [0.3, 0.3, 0.32], type: 'slide', sill: false }); });
      guard(B, kind, h.x0, -0.1, h.x1, -0.1, h.y0, { color: kind === 'solid' ? mix3(pal.parapet, acc, 0.3) : pal.parapet, trim: pal.trim, ext: 0 });
      if (rng() < 0.5) acUnit(B, h.x1 - 0.55, h.y0, rng, { pipeTo: h.y1 - 0.4, z: -h.d + 0.22 });
      if (rng() < 0.35) B.detail(2, () => { for (let xx = h.x0 + 0.5; xx < h.x1 - 0.5; xx += 0.5 + rng() * 0.3) if (rng() < 0.7) B.box('plain', xx, h.y0 + 1.15, -h.d + 0.5, 0.3 + rng() * 0.15, 0.6, 0.02, { color: pick(rng, LAUNDRY) }); }); }
    for (const h of ground) { B.quad('shopWindow', [h.x0, h.y0, -h.d + 0.03], [h.x1, h.y0, -h.d + 0.03], [h.x1, h.y1, -h.d + 0.03], [h.x0, h.y1, -h.d + 0.03], { color: [1.1, 1, 4.5 / 8], uvs: [[0, 0], [1, 0], [1, 1], [0, 1]] });
      for (let k = 0; k <= 4; k++) B.box('alu', h.x0 + (h.x1 - h.x0) * k / 4, h.y0, -h.d + 0.05, 0.07, h.y1 - h.y0, 0.07, { color: [0.3, 0.3, 0.32] });
      B.bbox('metal', 0, h.y1 + 0.1, 0.5, h.x1 - h.x0 + 0.6, 0.14, 1.0, 0.01, { color: [0.3, 0.31, 0.33] }); }
    floorBands(B, -C, C, Array.from({ length: CF - 1 }, (_, k) => y0 + (k + 1) * fh), pal.trim, 0.05);
  });
  plate(B, -C - 0.03, y0 + 3.05, -C + 3.5, -Math.PI / 2, 2.6, 0.36, (g, W2, H2) => { g.fillStyle = '#f4f1ea'; g.fillRect(0, 0, W2, H2); g.fillStyle = '#2f3a44'; g.font = `bold ${H2 * 0.5}px ${JP_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('集会所・管理事務所', W2 / 2, H2 * 0.55); }, 0.4, 256);
  for (const fr of [0, Math.PI / 2]) inFrame(B, [Math.sin(fr) * C, 0, Math.cos(fr) * C], fr, () => { for (const h of upper) windowUnit(B, h, { rng, frame: [0.3, 0.3, 0.32], type: 'slide' }); });
  const roofY = flatRoof(B, { w: 2 * C, d: 2 * C, y: H, para: 1.2, color: wall, wallMat: 'tiles', coping: pal.trim });
  B.bbox('concrete', -C - 0.02, H - 0.2, -C - 0.02, 0.6, 1.5, 0.6, 0.02, { color: acc });                                   // the corner's accent pier head
  plate(B, 0, H + 0.5, -C - 0.05, Math.PI, 5.0, 0.7, (g, W2, H2) => { g.clearRect(0, 0, W2, H2); g.fillStyle = '#3a4550'; g.font = `bold ${H2 * 0.6}px ${JP_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(name, W2 / 2, H2 * 0.55); }, 0.6, 512).material.transparent = true;
  B.bbox('metal', C / 2, roofY, C / 2, 2.4, 2.0, 2.4, 0.03, { color: [0.86, 0.86, 0.83] });
  ex.push({ t: 'box', p: B.P([0, 0, 0]), hx: C + 0.2, hz: C + 0.2, r, h: H + 1 });
  for (const e of out.lamps) lampPoints.push(e);
  B.frame(0, 0, 0, 0);
  return out;
}

// ---------------------------------------------------------------- the neighbourhood centre: shops on a podium, flats above
// An L of two legs meeting at the corner (x, z): leg A runs along +local x (length wa), leg B along -local z (length
// wb); the street faces (+z for A, -x for B) carry glazed shopfronts under a continuous canopy with fascia signs; two
// mansion wings stand back on the podium roof, whose open parts are a planted terrace.
const SHOPS = [['スーパーさくら', '#c8342c', '#fff', 0], ['ドラッグ桜川', '#1f5fa8', '#fff', 0], ['桜川クリニック', '#2a8a6a', '#fff', 3], ['ベーカリー こむぎ', '#8a5a30', '#fff3dc', 7],
  ['郵便局', '#d8302a', '#fff', 4], ['書店', '#333', '#f2e6c8', 6], ['カフェ はなみずき', '#5b7f3a', '#fff', 1], ['クリーニング', '#2f6ea6', '#fff', 3]];
function centreBlock_build(B, s, rng, ex) {
  const { x, y, z, r, wa = 58, wb = 40, dp = 17, pal = PALETTES.brick } = s, PH = 4.6, out = { entrances: [], lamps: [], shopFronts: [] };
  B.frame(x, y, z, r);
  const legs = [{ cx: wa / 2, cz: -dp / 2, w: wa, d: dp, face: 0 }, { cx: dp / 2, cz: -dp - (wb - dp) / 2, w: wb - dp, d: dp, face: 1 }];
  // podium boxes: leg A (x 0..wa, z -dp..0), leg B (x 0..dp, z -wb..-dp)
  const box = (x0, x1, z0, z1) => { B.bbox('concrete', (x0 + x1) / 2, -0.4, (z0 + z1) / 2, x1 - x0, 0.5, z1 - z0, 0.02, { color: pal.base });
    B.bbox('tiles', (x0 + x1) / 2, 0.1, (z0 + z1) / 2, x1 - x0, PH - 0.1, z1 - z0, 0.02, { color: pal.wall, uv: 2.5 }); };
  box(0, wa, -dp, 0); box(0, dp, -wb, -dp);
  // podium roof: terrace paving with planters (the wings stand on it)
  B.box('pavement', wa / 2, PH, -dp / 2, wa - 0.3, 0.06, dp - 0.3, { color: [0.78, 0.76, 0.72], uv: 1.5 });
  B.box('pavement', dp / 2, PH, -dp - (wb - dp) / 2, dp - 0.3, 0.06, wb - dp - 0.3, { color: [0.78, 0.76, 0.72], uv: 1.5 });
  for (const [x0, x1, zz] of [[0.2, wa - 0.2, -0.1], [0.2, wa - 0.2, -dp + 0.1]]) B.bbox('concrete', (x0 + x1) / 2, PH, zz, x1 - x0, 1.05, 0.14, 0.01, { color: pal.parapet });
  for (const xx of [0.1, dp - 0.1]) B.bbox('concrete', xx, PH, -wb / 2, 0.14, 1.05, wb - 0.2, 0.01, { color: pal.parapet });
  // shopfronts along the two street faces
  const front = (len, place, faceR) => inFrame(B, place, faceR, () => {
    const n = Math.max(2, Math.round(len / 9)), sw = len / n;
    for (let i = 0; i < n; i++) {
      const x0 = -len / 2 + i * sw + 0.25, x1 = x0 + sw - 0.5, sh = SHOPS[((s.shopOffset || 0) + out.shopFronts.length) % SHOPS.length];
      B.quad('dark', [x0, 0.15, 0.02], [x1, 0.15, 0.02], [x1, 3.35, 0.02], [x0, 3.35, 0.02], { color: [0.12, 0.12, 0.12] });
      B.quad('shopWindow', [x0 + 0.05, 0.2, 0.05], [x1 - 0.05, 0.2, 0.05], [x1 - 0.05, 3.3, 0.05], [x0 + 0.05, 3.3, 0.05], { color: [1.1, 1, (sh[3] + 0.5) / 8], uvs: [[0, 0], [1, 0], [1, 1], [0, 1]] });
      for (let k = 0; k <= 4; k++) B.box('alu', x0 + (x1 - x0) * k / 4, 0.15, 0.08, 0.07, 3.2, 0.07, { color: [0.62, 0.64, 0.66] });
      B.box('alu', (x0 + x1) / 2, 2.5, 0.08, x1 - x0, 0.06, 0.07, { color: [0.62, 0.64, 0.66] });
      plate(B, (x0 + x1) / 2, 3.65, 0.62, 0, Math.min(sw - 1.2, 6.5), 0.62, (g, W2, H2) => { g.fillStyle = sh[1]; g.fillRect(0, 0, W2, H2); g.fillStyle = sh[2]; g.font = `bold ${H2 * 0.56}px ${JP_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(sh[0], W2 / 2, H2 * 0.55); }, 0.9, 512);
      out.shopFronts.push({ p: B.P([(x0 + x1) / 2, 0, 2.5]), name: sh[0] });
      out.entrances.push({ p: B.P([(x0 + x1) / 2, 0, 3.5]), out: [B.N([0, 0, 1])[0], B.N([0, 0, 1])[2]], kind: 'shop' });
    }
    // a continuous canopy with its fascia over the shopfronts, on slim columns at the kerb side
    B.bbox('metal', 0, 3.4, 1.4, len + 0.4, 0.2, 2.8, 0.02, { color: [0.3, 0.31, 0.33] });
    B.box('lamp', 0, 3.38, 1.4, len - 1, 0.02, 0.2);
    for (let xx = -len / 2 + 1; xx <= len / 2 - 1 + 1e-3; xx += len / Math.max(2, Math.round(len / 7))) B.cyl('steel', xx, 0.1, 2.65, 0.07, 0.07, 3.3, 10, { color: [0.3, 0.31, 0.33] });
    for (let xx = -len / 2 + 2; xx < len / 2; xx += 6) lampPoints.push({ p: B.P([xx, 3.1, 1.5]), s: 0.7 });
  });
  front(wa, [wa / 2, 0, 0], 0);
  front(wb, [0, 0, -wb / 2], -Math.PI / 2);
  // residents' lobbies for the flats above, in the podium's inner faces: glazed doors, a canopy on columns, the
  // building's name, mailboxes and a light inside
  const lobby = (place, faceR, label) => inFrame(B, place, faceR, () => {
    // an entrance pavilion standing out from the podium: stone-clad cheeks and roof round a porch with automatic doors
    const D = 2.2, hw = 1.2, t = 0.3, yh = 2.9, CL = [0.4, 0.38, 0.37];
    const DP = D + 0.15;                                                                                            // the doors stand 15 cm off the podium
    for (const e of [-1, 1]) B.bbox('stone', e * (hw + t / 2), -0.3, DP / 2, t, yh + 0.7, DP, 0.02, { color: CL, skip: e < 0 ? 'px' : 'nx' });
    B.bbox('stone', 0, yh, DP / 2, 2 * (hw + t), 0.4, DP, 0.02, { color: CL, skip: 'ny' });
    for (const e of [-1, 1]) ex.push({ t: 'box', p: B.P([e * (hw + t / 2), 0, DP / 2]), hx: t / 2, hz: DP / 2, r: B.F.r, h: yh + 0.5 });
    B.frame(...B.P([0, 0, DP]), B.F.r);
    entrancePorch(B, rng, { w: 2 * hw, y0: 0.1, yh, depth: D, wall: [0.8, 0.78, 0.74], auto: true, mail: [4, 5], lockers: true, lampAt: out.lamps, floorC: [0.38, 0.36, 0.35] });
    entranceCanopy(B, 0, 0.1, 4.2, 2.0, { cols: true, color: [0.3, 0.31, 0.33], lampAt: out.lamps, h: 3.1, steps: false });
    plate(B, 0, 3.72, -DP + 0.03, 0, 3.8, 0.42, (g, W2, H2) => { g.fillStyle = '#26282b'; g.fillRect(0, 0, W2, H2); g.fillStyle = '#e9dcc0'; g.font = `${H2 * 0.48}px ${JP_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, W2 / 2, H2 * 0.55); }, 0.5, 256);
    const ap = s.gy ? approach(B, s.gy, { w: 3.2, y0: 0.1, land: 1.2, ramp: 0, court: 2.4, style: 'granite' }) : { foot: [0, 3.2], court: [-2, 1, 2, 3.4] };
    out.entrances.push({ p: B.P([ap.foot[0], 0, ap.foot[1]]), out: [B.N([0, 0, 1])[0], B.N([0, 0, 1])[2]], kind: 'lobby', court: courtW(B, ap.court), block: (ap.block || []).map(q => courtW(B, q)) });
  });
  lobby([wa / 2 + 5, 0, -dp], Math.PI, 'センタービル桜川 東館');
  lobby([dp, 0, -dp - (wb - dp) / 2 - 1.5], Math.PI / 2, 'センタービル桜川 西館');
  out.boxes0 = [[[-3.0, -dp - 0.3], [wa, 3.0]], [[-3.0, -wb - 0.3], [dp + 0.3, -dp]]];
  B.frame(x, y, z, r);
  // wings above: set back from the street faces
  const cA = B.P([wa / 2 + 5, 0, -7]);
  const wA = mansion(B, { x: cA[0], y: y + PH, z: cA[2], r, w: wa - 14, d: 11, floors: 6, pal, podium: true, no: s.no, name: 'センタービル桜川' }, rng, ex);
  B.frame(x, y, z, r);
  const cB = B.P([7, 0, -dp - (wb - dp) / 2 - 1.5]);
  const wB = mansion(B, { x: cB[0], y: y + PH, z: cB[2], r: r - Math.PI / 2, w: wb - dp - 5, d: 11, floors: 5, pal, podium: true, no: s.no + 1, name: 'センタービル桜川' }, rng, ex);
  void wA; void wB;
  ex.push({ t: 'box', p: B.P([wa / 2, 0, -dp / 2]), hx: wa / 2, hz: dp / 2, r, h: PH });
  ex.push({ t: 'box', p: B.P([dp / 2, 0, -dp - (wb - dp) / 2]), hx: dp / 2, hz: (wb - dp) / 2, r, h: PH });
  for (const e of out.lamps) lampPoints.push(e);
  B.frame(0, 0, 0, 0);
  return out;
}

// ---------------------------------------------------------------- 2-storey terraced flats (アパート)
const APATO = ['コーポ桜', 'ハイツ川辺', 'メゾン花水木', 'グリーンハイツ', 'コーポ田園', 'ハイム東雲', 'サンライズ桜川', 'レジデンス若葉'];
function lowRise_build(B, s, rng, ex) {
  const { x, y, z, r, w, d = 8.2, pal = PALETTES.cream } = s, fh = 2.75, y0 = 0.45, H = y0 + 2 * fh, out = { entrances: [], lamps: [] };
  const nU = Math.max(3, Math.round(w / 6)), uw = w / nU, wall = jit(rng, pal.wall, 0.03), mat = rng() < 0.5 ? 'siding' : 'stucco';
  B.frame(x, y, z, r);
  B.bbox('concrete', 0, -0.4, 0, w + 0.1, 0.85, d + 0.1, 0.02, { color: [0.62, 0.62, 0.6] });
  const front = [], back = [];
  for (let f = 0; f < 2; f++) for (let u = 0; u < nU; u++) {
    const fy = y0 + f * fh, cx = -w / 2 + (u + 0.5) * uw;
    front.push({ x0: cx - 1.5, x1: cx - 0.7, y0: fy + 0.02, y1: fy + 2.05, d: 0.12, door: true }, { x0: cx + 0.2, x1: cx + 1.4, y0: fy + 1.05, y1: fy + 1.95, d: 0.12 });
    back.push({ x0: -cx - 2.0, x1: -cx + 0.6, y0: fy + 0.05, y1: fy + 2.0, d: 0.16 }, { x0: -cx + 1.2, x1: -cx + 2.2, y0: fy + 1.0, y1: fy + 1.9, d: 0.14 });
  }
  boxWalls(B, 0, w, d, y0, H + 0.1, [[mat, wall, mat === 'siding' ? 3 : 2.5]], fi => fi === 0 ? front : fi === 1 ? back : [], mul(wall, 0.94));
  const rc = pick(rng, [[0.3, 0.34, 0.4], [0.42, 0.28, 0.24], [0.28, 0.36, 0.3], [0.36, 0.36, 0.38]]);
  hipRoof(B, { w: w + 0.2, d: d + 0.2, y: H + 0.1, pitch: 0.28, over: 0.55, mat: 'roofMetal', color: rc });
  // front: doors on both floors, the upper floor reached by a gallery and an open steel stair at one end
  inFrame(B, [0, 0, d / 2], 0, () => {
    for (const h of front) { if (h.door) { doorUnit(B, h, { color: jit(rng, [0.62, 0.55, 0.46], 0.08), mat: 'metal' }); doorFurniture(B, h.x1 + 0.16, h.y0); } else windowUnit(B, h, { rng, grille: true, frosted: rng() < 0.5 }); }
    const gy = y0 + fh, gc = pick(rng, [[0.3, 0.32, 0.36], [0.55, 0.3, 0.26], [0.86, 0.85, 0.82]]);
    // the gallery runs on past the end wall over the stair's landing
    B.bbox('concrete', 0.65, gy - 0.16, 0.65, w + 1.3, 0.16, 1.3, 0.01, { color: [0.78, 0.78, 0.76] });
    // its railing runs the whole front, past the end wall to the stair landing, and returns to the wall at both ends
    const rail = (ax, az, bx, bz) => inFrame(B, [ax, 0, az], Math.atan2(-(bz - az), bx - ax), () => { const L = Math.hypot(bx - ax, bz - az);
      B.bbox('metal', L / 2, gy + 1.02, 0, L + 0.06, 0.06, 0.06, 0.008, { color: gc }); B.box('metal', L / 2, gy + 0.08, 0, L, 0.04, 0.04, { color: gc });
      for (const xx of [0, L]) B.box('metal', xx, gy, 0, 0.05, 1.05, 0.05, { color: gc });
      B.detail(1, () => { for (let xx = 0.12; xx < L - 0.05; xx += 0.12) B.box('metal', xx, gy + 0.1, 0, 0.02, 0.92, 0.02, { color: gc }); }); });
    rail(-w / 2 + 0.03, 0.05, -w / 2 + 0.03, 1.28); rail(-w / 2 + 0.03, 1.28, w / 2 + 1.27, 1.28); rail(w / 2 + 1.27, 1.28, w / 2 + 1.27, 0.3);
    for (let xx = -w / 2 + 0.1; xx <= w / 2; xx += w / Math.ceil(w / 4)) B.box('metal', xx, 0, 1.25, 0.09, gy, 0.09, { color: gc });
    // stair: one straight steel flight along the gable end, rising from behind to a landing on the gallery's end:
    // risers under 20 cm, 25 cm checker-plate treads, closed riser plates, plate stringers, balustrades both sides
    // (the outer one running on round the landing). It starts from the end of the front walk, which runs round the
    // gable to its foot.
    const sx = w / 2 + 0.7, foot = s.gy ? (p => s.gy(p[0], p[2]) - B.F.y)(B.P([sx, 0, -3.6])) + 0.05 : 0.05;
    const nS = Math.ceil((gy - foot) / 0.2 - 1e-6), run = (nS - 1) * 0.25;
    inFrame(B, [sx, 0, -run], 0, () => { const S = stairFlight(B, { w: 1.0, y0: foot, y1: gy, run, style: 'steel', body: gc, tread: mul(gc, 1.1) });
      stairRail(B, 'balustrade', 0.47, -0.05, run + 0.3, S.pitch, { color: gc }); stairRail(B, 'balustrade', -0.47, -0.05, run, S.pitch, { color: gc }); });
    B.box('metal', sx + 0.55, 0, 1.25, 0.08, gy - 0.16, 0.08, { color: gc });                                          // the landing's post
    out.stairRun = run;
    for (let u = 0; u < nU; u++) { B.box('lamp', -w / 2 + (u + 0.5) * uw - 1.1, gy + 2.35, 0.2, 0.18, 0.12, 0.08); lampPoints.push({ p: B.P([-w / 2 + (u + 0.5) * uw - 1.1, gy + 2.2, 0.4]), s: 0.25 });
      meterBox(B, -w / 2 + (u + 0.5) * uw - 1.9, y0 + 1.4, 'power'); }
    plate(B, -w / 2 + 1.4, 1.6, 0.03, 0, 1.4, 0.36, (g, W2, H2) => { g.fillStyle = '#f5f1e6'; g.fillRect(0, 0, W2, H2); g.fillStyle = '#4a3a2c'; g.font = `bold ${H2 * 0.55}px ${JP_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(s.name || pick(rng, APATO), W2 / 2, H2 * 0.55); }, 0.15, 256);
    out.entrances.push({ p: B.P([0, 0, 2.6]), out: [B.N([0, 0, 1])[0], B.N([0, 0, 1])[2]], kind: 'gallery' });
  });
  // the mail bank on the near gable by the walkway's end, under a little hood with a lamp, the notice board beside it
  inFrame(B, [-w / 2, 0, d / 2 - 1.45], -Math.PI / 2, () => {
    const cols = Math.min(4, nU), bw = cols * 0.3, bh = 0.48, yb = 0.85;
    B.bbox('metal', 0, yb - 0.04, 0.17, bw + 0.06, bh + 0.08, 0.34, 0.01, { color: [0.7, 0.72, 0.73] });
    atlasQuad(B, 'mail', [-bw / 2, yb, 0.342], [bw / 2, yb, 0.342], [bw / 2, yb + bh, 0.342], [-bw / 2, yb + bh, 0.342], [0, 1 - 2 / 5, cols / 4, 1]);
    B.bbox('metal', 0, yb + bh + 0.5, 0.3, bw + 0.5, 0.05, 0.6, 0.008, { color: [0.36, 0.38, 0.4] });
    B.box('lamp', 0, yb + bh + 0.47, 0.3, 0.3, 0.03, 0.1); out.lamps.push({ p: B.P([0, yb + bh + 0.3, 0.5]), s: 0.3 });
    wallPanel(B, 'rules', -(bw / 2 + 0.45), 1.0, 0.44, 0.33, 0.02, { color: [0.3, 0.3, 0.3] });
  });
  // back: small balconies on the upper floor, garden fences on the ground floor
  inFrame(B, [0, 0, -d / 2], Math.PI, () => {
    for (const h of back) windowUnit(B, h, { rng, type: 'slide', sill: false, shutterBox: rng() < 0.4 });
    for (let u = 0; u < nU; u++) { const cx = -(-w / 2 + (u + 0.5) * uw);
      balconyRun(B, rng, cx - 2.3, cx + 0.9, y0 + fh, 0.9, { kind: 'rail', trim: [0.4, 0.42, 0.44], fh, laundry: 0.5 });
      balconyRun(B, rng, cx - uw / 2, cx + uw / 2, y0, 1.0, { ground: true, trim: [0.55, 0.56, 0.56], ends: [u === nU - 1, true] }); }
  });
  ex.push({ t: 'box', p: B.P([0, 0, 0.3]), hx: w / 2 + 1.2, hz: d / 2 + 1.3, r, h: H + 1 });
  out.footprint = [[-w / 2 - 1.3, -d / 2 - 2.2], [w / 2 + 1.3, d / 2 + 1.4]]; out.H = H; out.walk = { w, d, foot: out.stairRun + 0.25 };
  for (const e of out.lamps) lampPoints.push(e);
  B.frame(0, 0, 0, 0);
  return out;
}

// ---------------------------------------------------------------- placed objects (world/capture.js: each call is one editable world object)
export const walkupSlab = placeable('apartment_walkup', walkupSlab_build, atObj);
export const pointTower = placeable('apartment_tower', pointTower_build, atObj);
export const mansion = placeable('apartment_mansion', mansion_build, atObj);
export const cornerBlock = placeable('apartment_corner', cornerBlock_build, atObj);
export const centreBlock = placeable('apartment_centre', centreBlock_build, atObj);
export const lowRise = placeable('apartment_lowrise', lowRise_build, atObj);
