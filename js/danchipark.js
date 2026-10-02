// The district's three public spaces, each with its own character within one art direction:
//   fountainPark  噴水広場 — formal and paved: a round plaza in concentric granite bands round a two-tier fountain, a
//                 cross of axes (the long one a promenade between the two streets), clipped box-hedge parterres with
//                 flower carpets, an allée, benches facing the water, ornamental lamps, a seat-wall exedra
//   lakePark      池の公園 — green and relaxed: an irregular pond with a timber viewing deck, a pebble beach, reed beds
//                 and irises, a rocky shore under black pines, a vermilion bridge over the spring's inlet, a gazebo,
//                 a gravel loop with branches to every edge, a picnic lawn, cherries, azaleas, water lilies
//   playground    児童遊園 — family and practical: two fenced play yards (big-kid equipment on one, a toddler yard with
//                 the sand pit on the other) on safety surfacing, a spine path and a cross path tying the surrounding
//                 buildings together, a parents' pergola garden, a ball lawn, shade trees, benches, bins, a fountain
import { THREE, addPlatform, clamp } from './core.js';
import { lampPoints } from './townkit.js';

// the lake's outline (a lobed ellipse round LAKE_C), its inlet channel and the spring pool; the ground under them is
// dug out (danchiGround) so the water lies in a real basin: shelving gently at the beach, steeper under the deck
export const LAKE_C = [482, 15];
export const lakeR = a => { const e = 1 / Math.hypot(Math.cos(a) / 23, Math.sin(a) / 10.5); return e * (1 + 0.1 * Math.sin(a * 3 + 0.7) + 0.06 * Math.sin(a * 5 + 2.1) - 0.08 * Math.exp(-((a - 0.9) ** 2) / 0.05)); };
export const LAKE_CH = { x0: 448.6, x1: LAKE_C[0] - lakeR(Math.PI) + 1.2, z: 13, w: 2.8 }, SPRING = [446, 13, 3.2];
const sst = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export function lakeDepth(x, z) {
  if (x < 438 || x > 512 || z < -2 || z > 32) return 0;
  const dx = x - LAKE_C[0], dz = z - LAKE_C[1], a = Math.atan2(dz, dx), t = Math.hypot(dx, dz) / lakeR(a);
  const beach = Math.exp(-(Math.atan2(Math.sin(a - 0.05), Math.cos(a - 0.05)) ** 2) / 0.25), deck = Math.exp(-((a - Math.PI / 2) ** 2) / 0.2);
  let d = 1.25 * sst(0, 0.42 + 0.3 * beach - 0.12 * deck, 1.06 - t);
  const c = LAKE_CH; if (x > c.x0 - 2 && x < c.x1 + 1) d = Math.max(d, 0.75 * sst(0, 1.4, c.w / 2 + 0.9 - Math.abs(z - c.z)) * sst(c.x0 - 2, c.x0, x));
  d = Math.max(d, 0.95 * sst(0, 2.0, SPRING[2] + 0.9 - Math.hypot(x - SPRING[0], z - SPRING[1])));
  return d;
}

// the fountain park's ground (also the keep-out its neighbours respect, danchi.js)
export const FOUNTAIN = { cx: 578, cz: 134, R: 10.5, x0: 553, x1: 603, z0: 120.6, z1: 147.6 };
// K.probe: a dry run that only records where the parks plant, pave and furnish (no geometry, no side effects), so the
// buildings can be placed clear of them before the parks are laid out
export function buildParks(K) {
  const { B, gy, rng, out, pathLine, pave, paint, occRect, navRect, tree, benchAt, addBox, addCircle } = K;
  const lampPts = K.lampPoints || lampPoints, addPlat = K.addPlatform || addPlatform;
  const V = (x, z, yo = 0) => [x, gy(x, z) + yo, z];
  const col = (h, s, l) => new THREE.Color().setHSL(h, s, l);
  const lerp = (a, b, t) => a + (b - a) * t, mul = (c, k) => c.map(v => v * k);
  // ---------------------------------------------------------------- small kit
  // draped rectangle of surfacing in ~1 m cells (mat, colour, height over the ground); pavement gets slab joints
  const surf = (x0, z0, x1, z1, mat, color, yo, { cell = 1, uv = 1.2 } = {}) => {
    B.frame(0, 0, 0, 0); const nx = Math.max(1, Math.ceil((x1 - x0) / cell)), nz = Math.max(1, Math.ceil((z1 - z0) / cell));
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) { const xa = lerp(x0, x1, i / nx), xb = lerp(x0, x1, (i + 1) / nx), za = lerp(z0, z1, j / nz), zb = lerp(z0, z1, (j + 1) / nz), p4 = [V(xa, za, yo), V(xb, za, yo), V(xb, zb, yo), V(xa, zb, yo)];
      B.poly(mat, p4, [0, 1, 0], { color, uvs: p4.map(v => [v[0] / uv, v[2] / uv]), attr: mat === 'pavement' ? { aPave: [[xa, za - z0 + 0.5], [xb, za - z0 + 0.5], [xb, zb - z0 + 0.5], [xa, zb - z0 + 0.5]] } : undefined }); }
    pave(x0 - 1, z0 - 1, x1 + 1, z1 + 1, (px, pz) => px > x0 - 0.15 && px < x1 + 0.15 && pz > z0 - 0.15 && pz < z1 + 0.15 ? 1 : 0);
    if (mat === 'pavement') K.coverRect(x0, z0, x1, z1);
    if (K.area && yo < 0.06) K.area([[x0, z0], [x1, z0], [x1, z1], [x0, z1]], (x, z) => gy(x, z) + yo);              // (paths meet it: the network joins them)
  };
  // annulus sector of paving round (cx, cz) laid in polar cells: its joints run round and across the rings
  const ring = (cx, cz, r0, r1, mat, color, yo, { a0 = 0, a1 = Math.PI * 2, seg = 48, rad = 1 } = {}) => {
    B.frame(0, 0, 0, 0); const nr = Math.max(1, Math.ceil((r1 - r0) / rad)), na = Math.max(3, Math.ceil(seg * (a1 - a0) / (Math.PI * 2)));
    for (let i = 0; i < na; i++) for (let j = 0; j < nr; j++) {
      const t0 = lerp(a0, a1, i / na), t1 = lerp(a0, a1, (i + 1) / na), q0 = lerp(r0, r1, j / nr), q1 = lerp(r0, r1, (j + 1) / nr);
      const P = (a, r) => V(cx + Math.cos(a) * r, cz + Math.sin(a) * r, yo), p4 = [P(t0, q0), P(t1, q0), P(t1, q1), P(t0, q1)];
      const s0 = t0 * (q0 + q1) / 2, s1 = t1 * (q0 + q1) / 2;
      B.poly(mat, p4, [0, 1, 0], { color, uvs: p4.map(v => [v[0] / 1.2, v[2] / 1.2]), attr: mat === 'pavement' ? { aPave: [[s0, q0 - r0 + 0.5], [s1, q0 - r0 + 0.5], [s1, q1 - r0 + 0.5], [s0, q1 - r0 + 0.5]] } : undefined }); }
    K.coverDisc(cx, cz, r1);
    if (K.area && a1 - a0 > 6.28) K.area(Array.from({ length: 48 }, (_, k) => [cx + Math.cos(k / 48 * Math.PI * 2) * r1, cz + Math.sin(k / 48 * Math.PI * 2) * r1]), (x, z) => gy(x, z) + yo);
    pave(cx - r1 - 1, cz - r1 - 1, cx + r1 + 1, cz + r1 + 1, (px, pz) => { const r = Math.hypot(px - cx, pz - cz); if (r < r0 - 0.1 || r > r1 + 0.15) return 0; let a = Math.atan2(pz - cz, px - cx); while (a < a0) a += Math.PI * 2; return a <= a1 + 0.02 ? 1 : 0; });
  };
  const hedge = (a, b, h = 0.7) => { out.hedges.push({ a, b, h }); const L = Math.hypot(b[0] - a[0], b[1] - a[1]); navRect((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0.45, L / 2, Math.atan2(b[0] - a[0], b[1] - a[1]), 2); };
  const bush = (x, z, s, c, sx = 1) => out.bushes.push({ x, y: gy(x, z) - 0.05, z, s, sx, r: rng() * 6.28, c });
  const clump = (x, z, n, R, c, s = [0.5, 0.8]) => { for (let k = 0; k < n; k++) { const a = rng() * 6.28, r = Math.sqrt(rng()) * R; bush(x + Math.cos(a) * r, z + Math.sin(a) * r, lerp(s[0], s[1], rng()), c.clone().offsetHSL((rng() - 0.5) * 0.02, 0, (rng() - 0.5) * 0.06)); } };
  const AZALEA = [col(0.93, 0.62, 0.62), col(0.97, 0.7, 0.72), col(0.0, 0.0, 0.93), col(0.88, 0.55, 0.58)], HYDRANGEA = [col(0.62, 0.45, 0.6), col(0.72, 0.4, 0.62), col(0.58, 0.5, 0.66)];
  const GREEN = () => col(0.26 + rng() * 0.06, 0.45, 0.3 + rng() * 0.08);
  // ornamental lamp: a fluted post with a lantern head (formal spaces), or the plain park lamp
  const lamp = (x0, z0, ornate = true) => { const q = K.freeSpot(x0, z0, 0.3); if (!q) return; const [x, z] = q, y = gy(x, z); B.frame(x, y, z, 0);
    if (ornate) { B.cyl('metal', 0, 0, 0, 0.16, 0.13, 0.5, 12, { color: [0.18, 0.2, 0.2] }); B.cyl('metal', 0, 0.5, 0, 0.07, 0.055, 3.4, 12, { color: [0.18, 0.2, 0.2] });
      B.cyl('metal', 0, 3.9, 0, 0.1, 0.18, 0.12, 12, { color: [0.18, 0.2, 0.2], cap: true }); B.cyl('lamp', 0, 4.02, 0, 0.2, 0.2, 0.42, 12, {}); B.cyl('metal', 0, 4.44, 0, 0.26, 0.04, 0.2, 12, { color: [0.18, 0.2, 0.2], cap: true });
      lampPts.push({ p: [x, y + 4.2, z], s: 0.7 }); }
    else { B.cyl('steel', 0, 0, 0, 0.06, 0.05, 3.2, 10, { color: [0.3, 0.32, 0.34] }); B.cyl('metal', 0, 3.2, 0, 0.16, 0.2, 0.08, 14, { color: [0.28, 0.3, 0.32], cap: true }); B.cyl('lamp', 0, 3.02, 0, 0.14, 0.14, 0.18, 12, {}); lampPts.push({ p: [x, y + 2.9, z], s: 0.45 }); }
    B.frame(0, 0, 0, 0); addCircle(x, z, 0.12); navRect(x, z, 0.4, 0.4, 0, 2); };
  const bollard = (x, z, lit = true) => { const y = gy(x, z); B.frame(x, y, z, 0); B.cyl('metal', 0, 0, 0, 0.1, 0.1, 0.8, 12, { color: [0.2, 0.22, 0.22], cap: !lit });
    if (lit) { B.cyl('lamp', 0, 0.62, 0, 0.1, 0.1, 0.12, 12, {}); B.cyl('metal', 0, 0.74, 0, 0.12, 0.12, 0.06, 12, { color: [0.2, 0.22, 0.22], cap: true }); lampPts.push({ p: [x, y + 0.7, z], s: 0.15 }); }
    B.frame(0, 0, 0, 0); addCircle(x, z, 0.1); };
  const bin = (x0, z0, c = [0.26, 0.42, 0.34]) => { const q = K.freeSpot(x0, z0, 0.32); if (!q) return; const [x, z] = q, y = gy(x, z); B.frame(x, y, z, 0); B.cyl('metal', 0, 0, 0, 0.26, 0.24, 0.85, 14, { color: c }); B.cyl('metal', 0, 0.85, 0, 0.28, 0.2, 0.1, 14, { color: [0.3, 0.32, 0.33], cap: true }); B.cyl('dark', 0, 0.9, 0, 0.1, 0.1, 0.06, 10, { color: [0.1, 0.1, 0.1], cap: true }); B.frame(0, 0, 0, 0); addCircle(x, z, 0.28); navRect(x, z, 0.35, 0.35, 0, 2); };
  // a bench with a bin at one end, the pair set back from a path edge (yaw: the way the seat faces)
  const seat = (x, z, yaw, withBin = false) => { const q = benchAt(x, z, yaw); if (q && withBin) bin(q[0] + Math.cos(yaw) * 1.3, q[1] - Math.sin(yaw) * 1.3); };
  // rocks: scanned stones and boulders (instanced in town.js) placed by the rules of a real outcrop — never on paving,
  // sunk by part of their height into the ground (more for small stones), turned to lie on their broad side, tinted a
  // little apart. A group reads big → medium → small: one or two big stones, medium ones leaning on them, a spill of
  // small stones and gravel, soil and low planting round the foot. kind 'b' boulder, 's' one of the rock set's stones.
  out.rocks = out.rocks || [];
  const TINT = [[1.06, 1.02, 0.95], [0.96, 0.97, 0.99], [1.1, 1.05, 0.97], [0.9, 0.92, 0.95], [1.0, 0.97, 0.9], [0.86, 0.85, 0.82]].map(c => new THREE.Color(...c));
  const rockOk = (x, z, r) => { for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) if (K.paved(x + dx, z + dz)) return false; return true; };
  const rock = (x, z, s, { kind = 's', sink = s < 0.6 ? 0.3 : s < 1.3 ? 0.2 : 0.14, tilt = s < 0.6 ? 0.45 : 0.2, sy = 0.85 + rng() * 0.5, force = false, part = Math.floor(rng() * 64) } = {}) => {
    if (!force && !rockOk(x, z, s * 0.45)) return false;
    out.rocks.push({ x, z, s, kind, sink, part, r: rng() * 6.283, tilt: (rng() - 0.5) * tilt, tilt2: (rng() - 0.5) * tilt, sx: 0.85 + rng() * 0.35, sy, c: TINT[Math.floor(rng() * TINT.length)].clone().offsetHSL(0, 0, (rng() - 0.5) * 0.06) });
    if (s > 0.6) navRect(x, z, s * 0.45, s * 0.45, 0, 2);
    if (s > 0.35) { const R = s * 0.34; pave(x - R, z - R, x + R, z + R, (px, pz) => Math.hypot(px - x, pz - z) < R ? 1 : 0); }                  // no grass blades through the stone
    return true; };
  const rockGroup = (x, z, S, { dir = rng() * 6.283, spread = 1, soil = true, plants = true, water = null } = {}) => {
    rock(x, z, S, { kind: rng() < 0.4 ? 'b' : 's', sy: 1.0 + rng() * 0.5 });
    const nm = 2 + Math.floor(rng() * 3), ns = 6 + Math.floor(rng() * 6);
    for (let k = 0; k < nm; k++) { const a = dir + (k - (nm - 1) / 2) * 0.9 + (rng() - 0.5) * 0.4, d = S * (0.5 + rng() * 0.25) * spread; rock(x + Math.cos(a) * d, z + Math.sin(a) * d, S * (0.4 + rng() * 0.2)); }
    for (let k = 0; k < ns; k++) { const a = dir + (rng() - 0.5) * 3.6, d = S * (0.8 + rng() * 0.8) * spread; rock(x + Math.cos(a) * d, z + Math.sin(a) * d, 0.22 + rng() * 0.28); }
    if (soil) paint(0, x - S * 2, z - S * 2, x + S * 2, z + S * 2, (px, pz) => Math.max(0, 0.55 - Math.hypot(px - x, pz - z) / (S * 2.2)) * (water && water(px, pz) ? 0 : 1));
    if (plants) for (let k = 0; k < 3 + Math.floor(S * 2); k++) { const a = dir + Math.PI + (rng() - 0.5) * 2.6, d = S * (0.8 + rng() * 0.6), px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      if (!K.paved(px, pz) && !(water && water(px, pz))) bush(px, pz, 0.35 + rng() * 0.3, rng() < 0.3 ? col(0.22, 0.4, 0.28) : GREEN(), 1.3); }
  };
  // water: a star-shaped outline round (cx, cz) filled as a fan, deep in the middle; y: water level over the ground there
  // water surface (pond water shader, terrain.js): a fan over outline P round (cx, cz) at level wy; the vertex colour
  // tints the water body (deep → shallow toward the rim), the shader does depth, reflection, ripples and the shoreline
  const water = (cx, cz, P, wy, deep = [0.86, 0.95, 0.98], shal = [1.0, 1.0, 0.94], mat = 'pondWater') => {
    const mid = deep.map((v, i) => (v + shal[i]) / 2), ring2 = (p, f) => [cx + (p[0] - cx) * f, wy, cz + (p[1] - cz) * f];
    B.frame(0, 0, 0, 0);
    for (let k = 0; k < P.length; k++) { const p = P[k], q = P[(k + 1) % P.length], a1 = ring2(p, 0.6), b1 = ring2(q, 0.6), a2 = ring2(p, 1), b2 = ring2(q, 1);
      B.tri(mat, [cx, wy, cz], b1, a1, { colors: [deep, mid, mid] }); B.tri(mat, a1, b1, b2, { colors: [mid, mid, shal] }); B.tri(mat, a1, b2, a2, { colors: [mid, shal, shal] }); }
    return wy; };
  const q2 = (q, p, P, k) => P[(k + 1) % P.length];
  const inPolyW = (P, x, z) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, zi] = P[i], [xj, zj] = P[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
  const blockPoly = (P, m = 0) => { const xs = P.map(p => p[0]), zs = P.map(p => p[1]);
    for (let z = Math.floor(Math.min(...zs)) - 1; z <= Math.max(...zs) + 1; z++) for (let x = Math.floor(Math.min(...xs)) - 1; x <= Math.max(...xs) + 1; x++) if (inPolyW(P, x + 0.5, z + 0.5)) navRect(x + 0.5, z + 0.5, 0.5 + m, 0.5 + m, 0, 2); };
  // play-yard fence: steel posts and rails with pickets, gaps with gate frames at `gates` (distances along the run)
  const fence = (pts, color, gates = [], h = 0.9) => {
    B.frame(0, 0, 0, 0); let s = 0;
    for (let i = 0; i + 1 < pts.length; i++) { const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L;
      const open = t => gates.some(g => Math.abs(s + t - g) < 0.75);
      for (let t = 0; t < L; t += 0.2) { if (open(t + 0.1)) continue; const t1 = Math.min(L, t + 0.2), x0 = ax + ux * t, z0 = az + uz * t, x1 = ax + ux * t1, z1 = az + uz * t1;
        const y0 = gy(x0, z0), y1 = gy(x1, z1); B.beam('metal', [x0, y0 + h, z0], [x1, y1 + h, z1], 0.05, 0.05, { color }); B.beam('metal', [x0, y0 + 0.12, z0], [x1, y1 + 0.12, z1], 0.04, 0.04, { color });
        B.box('metal', x0, y0 + 0.12, z0, 0.025, h - 0.12, 0.025, { color }); }
      for (let t = 0; t <= L + 1e-3; t += 1.8) { const x = ax + ux * Math.min(t, L), z = az + uz * Math.min(t, L); if (!open(Math.min(t, L))) B.box('metal', x, gy(x, z) - 0.2, z, 0.07, h + 0.28, 0.07, { color }); }
      for (const g of gates) if (g >= s && g <= s + L) for (const e of [-0.78, 0.78]) { const t = g - s + e, x = ax + ux * t, z = az + uz * t; B.box('metal', x, gy(x, z) - 0.2, z, 0.08, h + 0.5, 0.08, { color }); }
      for (let t = 0; t < L; t += 0.5) if (!open(t + 0.25)) navRect(ax + ux * (t + 0.25), az + uz * (t + 0.25), 0.3, 0.3, 0, 2);
      s += L; }
  };

  // ================================================================ 噴水広場: the fountain park
  function fountainPark() {
    const { cx, cz, R, x0, x1, z0, z1 } = FOUNTAIN;
    // the long axis: a promenade from the west street's footway to the east's, through the plaza (the plaza lies over it)
    pathLine([[533.2, cz], [609.8, cz]], 4.0, { lamps: false, color: [0.82, 0.8, 0.76] });
    // the plaza: granite bands and light pavers in rings round the basin, the outer band darker
    ring(cx, cz, 5.3, 6.9, 'stone', [0.44, 0.43, 0.42], 0.056, { rad: 0.8, seg: 64 });
    ring(cx, cz, 6.9, R - 1.1, 'pavement', [0.86, 0.84, 0.8], 0.056, { rad: 1.0, seg: 56 });
    ring(cx, cz, R - 1.1, R - 0.5, 'stone', [0.46, 0.45, 0.43], 0.056, { rad: 0.6, seg: 64 });
    ring(cx, cz, R - 0.5, R, 'pavement', [0.74, 0.72, 0.68], 0.056, { rad: 0.5, seg: 64 });
    // the minor axis: north to a seat-wall exedra, south to a sculpture in a flower bed; paved in the band stone
    surf(cx - 1.6, cz + R - 0.3, cx + 1.6, z1 - 1.2, 'pavement', [0.76, 0.74, 0.7], 0.054);
    surf(cx - 1.6, z0 + 1.6, cx + 1.6, cz - R + 0.3, 'pavement', [0.76, 0.74, 0.7], 0.054);
    occRect(cx, cz, R, R, 0, 1, 1); occRect(cx, (cz + R + z1) / 2, 1.7, (z1 - cz - R) / 2, 0, 1, 1); occRect(cx, (z0 + cz - R) / 2 + 0.8, 1.7, (cz - R - z0) / 2, 0, 1, 1);
    // the fountain: an eight-lobed granite basin with a seat-high coping, a mosaic floor under 32 cm of water; on an island
    // in the middle a fluted column carries a scalloped lower bowl and a small upper bowl with a bronze lotus finial. The
    // water: a plume from the finial falling back in a crown onto the upper bowl, a sheet off its lip into the lower bowl,
    // eight spouts from the lower bowl's scallops arching into the basin, sixteen jets from the basin's rim arching in to
    // meet them; white water where every fall lands; lights set in the basin floor and under the bowls
    { const y = gy(cx, cz), N = 96, RB = a => 5.15 + 0.32 * Math.cos(8 * a), GR = [0.66, 0.64, 0.61], GRD = [0.5, 0.49, 0.47], CAP = [0.78, 0.76, 0.72], CS = [0.84, 0.82, 0.77];
      const P = (a, r, h) => [Math.cos(a) * r, h, Math.sin(a) * r];
      B.frame(cx, y, cz, 0);
      for (let k = 0; k < N; k++) { const a0 = k / N * Math.PI * 2, a1 = (k + 1) / N * Math.PI * 2, am = (a0 + a1) / 2, r0 = RB(a0), r1 = RB(a1), o = [Math.cos(am), 0, Math.sin(am)];
        // plinth step, outer wall, coping (top, overhanging edge, inner lip), inner wall down to the floor
        B.poly('stone', [P(a0, r0 + 0.35, 0.12), P(a1, r1 + 0.35, 0.12), P(a1, r1, 0.12), P(a0, r0, 0.12)], [0, 1, 0], { color: GRD });
        B.poly('stone', [P(a0, r0 + 0.35, -0.1), P(a1, r1 + 0.35, -0.1), P(a1, r1 + 0.35, 0.12), P(a0, r0 + 0.35, 0.12)], o, { color: GRD });
        B.poly('stone', [P(a0, r0, 0.12), P(a1, r1, 0.12), P(a1, r1, 0.5), P(a0, r0, 0.5)], o, { color: GR, uv: 1.2 });
        B.poly('stone', [P(a0, r0 + 0.07, 0.5), P(a1, r1 + 0.07, 0.5), P(a1, r1 + 0.07, 0.6), P(a0, r0 + 0.07, 0.6)], o, { color: CAP });
        B.poly('stone', [P(a0, r0 + 0.07, 0.5), P(a1, r1 + 0.07, 0.5), P(a1, r1, 0.5), P(a0, r0, 0.5)], [0, -1, 0], { color: GRD });
        B.poly('stone', [P(a0, r0 - 0.55, 0.62), P(a1, r1 - 0.55, 0.62), P(a1, r1 + 0.07, 0.6), P(a0, r0 + 0.07, 0.6)], [0, 1, 0], { color: CAP });
        B.poly('stone', [P(a0, r0 - 0.55, 0.3), P(a1, r1 - 0.55, 0.3), P(a1, r1 - 0.55, 0.62), P(a0, r0 - 0.55, 0.62)], [-o[0], 0, -o[2]], { color: GR });
        // mosaic floor: dark blue-grey tiles in rings (seen through the water)
        B.poly('tiles', [[0, 0.06, 0], P(a0, r0 - 0.55, 0.06), P(a1, r1 - 0.55, 0.06)], [0, 1, 0], { color: (k % 12 < 6) ? [0.3, 0.42, 0.5] : [0.36, 0.48, 0.55], uv: 0.35 }); }
      B.frame(0, 0, 0, 0);
      const WL = y + 0.42;
      water(cx, cz, Array.from({ length: N }, (_, k) => { const a = k / N * 6.2832; return [cx + Math.cos(a) * (RB(a) - 0.5), cz + Math.sin(a) * (RB(a) - 0.5)]; }), WL, [0.9, 1.0, 1.04], [1, 1, 1], 'fountainWater');
      B.frame(cx, y, cz, 0);
      // the island and column
      B.cyl('stone', 0, 0.06, 0, 1.25, 1.1, 0.5, 32, { color: GR }); B.cyl('stone', 0, 0.56, 0, 1.18, 1.18, 0.06, 32, { color: CAP, cap: true });
      B.cyl('stone', 0, 0.62, 0, 0.62, 0.5, 0.14, 24, { color: CS }); B.cyl('stone', 0, 0.76, 0, 0.42, 0.36, 0.32, 16, { color: CS });
      for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; B.box('stone', Math.cos(a) * 0.37, 0.76, Math.sin(a) * 0.37, 0.07, 0.3, 0.07, { color: mul(CS, 0.9) }); }
      // the lower bowl: scalloped lip, the underside flaring from the column, water in it
      const RL = a => 2.2 + 0.13 * Math.cos(8 * a), n2 = 64;
      for (let k = 0; k < n2; k++) { const a0 = k / n2 * Math.PI * 2, a1 = (k + 1) / n2 * Math.PI * 2, am = (a0 + a1) / 2, o = [Math.cos(am), 0, Math.sin(am)];
        B.poly('stone', [P(a0, 0.45, 1.06), P(a1, 0.45, 1.06), P(a1, RL(a1), 1.36), P(a0, RL(a0), 1.36)], [o[0], -0.8, o[2]], { color: mul(CS, 0.92) });
        B.poly('stone', [P(a0, RL(a0), 1.36), P(a1, RL(a1), 1.36), P(a1, RL(a1), 1.48), P(a0, RL(a0), 1.48)], o, { color: CS });
        B.poly('stone', [P(a0, RL(a0) - 0.14, 1.48), P(a1, RL(a1) - 0.14, 1.48), P(a1, RL(a1), 1.48), P(a0, RL(a0), 1.48)], [0, 1, 0], { color: CAP });
        B.poly('stone', [P(a0, RL(a0) - 0.14, 1.3), P(a1, RL(a1) - 0.14, 1.3), P(a1, RL(a1) - 0.14, 1.48), P(a0, RL(a0) - 0.14, 1.48)], [-o[0], 0, -o[2]], { color: mul(CS, 0.85) }); }
      B.frame(0, 0, 0, 0); water(cx, cz, Array.from({ length: n2 }, (_, k) => { const a = k / n2 * 6.2832; return [cx + Math.cos(a) * (RL(a) - 0.1), cz + Math.sin(a) * (RL(a) - 0.1)]; }), y + 1.44, [0.9, 1, 1.04], [1, 1, 1], 'fountainWater');
      B.frame(cx, y, cz, 0);
      // stem, knot, upper bowl, lotus finial in bronze
      B.cyl('stone', 0, 1.3, 0, 0.3, 0.24, 0.6, 16, { color: CS }); B.cyl('stone', 0, 1.78, 0, 0.34, 0.34, 0.1, 16, { color: CAP }); B.cyl('stone', 0, 1.88, 0, 0.24, 0.3, 0.32, 16, { color: CS });
      for (let k = 0; k < 40; k++) { const a0 = k / 40 * Math.PI * 2, a1 = (k + 1) / 40 * Math.PI * 2, am = (a0 + a1) / 2, o = [Math.cos(am), 0, Math.sin(am)];
        B.poly('stone', [P(a0, 0.28, 2.18), P(a1, 0.28, 2.18), P(a1, 1.1, 2.38), P(a0, 1.1, 2.38)], [o[0], -0.9, o[2]], { color: mul(CS, 0.92) });
        B.poly('stone', [P(a0, 1.1, 2.38), P(a1, 1.1, 2.38), P(a1, 1.1, 2.46), P(a0, 1.1, 2.46)], o, { color: CS });
        B.poly('stone', [P(a0, 1.0, 2.46), P(a1, 1.0, 2.46), P(a1, 1.1, 2.46), P(a0, 1.1, 2.46)], [0, 1, 0], { color: CAP }); }
      B.cyl('fountainWater', 0, 2.4, 0, 1.0, 1.0, 0.03, 40, { color: [1, 1, 1], cap: true });
      const BRZ = [0.46, 0.36, 0.22];
      B.cyl('metal', 0, 2.42, 0, 0.18, 0.14, 0.12, 12, { color: BRZ });
      for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; B.poly('metal', [P(a - 0.28, 0.12, 2.52), P(a + 0.28, 0.12, 2.52), P(a, 0.3, 2.86)], [Math.cos(a), 0.4, Math.sin(a)], { color: BRZ }); }
      B.cyl('metal', 0, 2.52, 0, 0.1, 0.03, 0.42, 10, { color: BRZ, cap: true });
      // water: ribbon along a parabola from p to q rising h over the chord (w wide), a vertical and a flat strip crossed
      const arc = (p, q, h, w, n = 10) => { for (let i = 0; i < n; i++) { const t0 = i / n, t1 = (i + 1) / n, pt = t => [lerp(p[0], q[0], t), lerp(p[1], q[1], t) + 4 * h * t * (1 - t), lerp(p[2], q[2], t)];
        const A = pt(t0), Bp = pt(t1), dx = q[0] - p[0], dz = q[2] - p[2], L = Math.hypot(dx, dz) || 1, sx = -dz / L * w / 2, sz = dx / L * w / 2;
        B.quad('waterFlow', [A[0] - sx, A[1], A[2] - sz], [A[0] + sx, A[1], A[2] + sz], [Bp[0] + sx, Bp[1], Bp[2] + sz], [Bp[0] - sx, Bp[1], Bp[2] - sz], { uvs: [[0, t0 * 3], [1, t0 * 3], [1, t1 * 3], [0, t1 * 3]] });
        B.quad('waterFlow', [A[0], A[1] - w / 2, A[2]], [A[0], A[1] + w / 2, A[2]], [Bp[0], Bp[1] + w / 2, Bp[2]], [Bp[0], Bp[1] - w / 2, Bp[2]], { uvs: [[0, t0 * 3], [1, t0 * 3], [1, t1 * 3], [0, t1 * 3]] }); } };
      const foam = (x, z, yy, r) => B.quad('waterFoam', [x - r, yy, z - r], [x + r, yy, z - r], [x + r, yy, z + r], [x - r, yy, z + r], { uvs: [[0, 0], [1, 0], [1, 1], [0, 1]] });
      // the plume and its crown
      { const n = 12; for (let k = 0; k < n; k++) { const a0 = k / n * Math.PI * 2, a1 = (k + 1) / n * Math.PI * 2, r0 = 0.07, r1 = 0.03;
          B.quad('waterFlow', P(a0, r0, 2.85), P(a1, r0, 2.85), P(a1, r1, 3.95), P(a0, r1, 3.95), { uvs: [[k / n, 0], [(k + 1) / n, 0], [(k + 1) / n, 2], [k / n, 2]] }); }
        for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2; arc(P(a, 0.05, 3.95), P(a, 0.85, 2.42), 0.2, 0.05, 8); } foam(0, 0, 2.43, 0.95); }
      // the sheet off the upper bowl's lip, falling into the lower bowl
      { const n = 40; for (let k = 0; k < n; k++) { const a0 = k / n * Math.PI * 2, a1 = (k + 1) / n * Math.PI * 2;
          B.quad('waterFlow', P(a0, 1.13, 2.44), P(a1, 1.13, 2.44), P(a1, 1.24, 1.46), P(a0, 1.24, 1.46), { uvs: [[k / n * 6, 0], [(k + 1) / n * 6, 0], [(k + 1) / n * 6, 1.6], [k / n * 6, 1.6]] }); }
        for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; foam(Math.cos(a) * 1.22, Math.sin(a) * 1.22, 1.45, 0.42); } }
      // spouts from the lower bowl's scallops, jets from the basin's rim
      for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; arc(P(a, RL(a) + 0.02, 1.44), P(a, 3.25, 0.43), 0.18, 0.1, 10); foam(Math.cos(a) * 3.25, Math.sin(a) * 3.25, 0.435, 0.34); }
      for (let k = 0; k < 16; k++) { const a = (k + 0.5) / 16 * Math.PI * 2, rr = RB(a) - 0.62; B.cyl('metal', Math.cos(a) * rr, 0.36, Math.sin(a) * rr, 0.04, 0.04, 0.1, 8, { color: [0.4, 0.4, 0.4], cap: true });
        arc(P(a, rr, 0.46), P(a, 3.7, 0.43), 0.75, 0.035, 10); foam(Math.cos(a) * 3.7, Math.sin(a) * 3.7, 0.437, 0.22); }
      // light: a ring of lamps in the basin floor, uplights under the lower bowl
      for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2, rr = RB(a) - 1.1; B.cyl('lamp', Math.cos(a) * rr, 0.065, Math.sin(a) * rr, 0.1, 0.1, 0.02, 10, { cap: true }); }
      for (let k = 0; k < 4; k++) { const a = k / 4 * Math.PI * 2 + 0.4; B.cyl('lamp', Math.cos(a) * 1.0, 0.62, Math.sin(a) * 1.0, 0.08, 0.08, 0.02, 8, { cap: true }); lampPts.push({ p: [cx + Math.cos(a) * 3.6, WL + 0.5, cz + Math.sin(a) * 3.6], s: 0.6 }); lampPts.push({ p: [cx + Math.cos(a) * 0.9, y + 1.2, cz + Math.sin(a) * 0.9], s: 0.35 }); }
      B.frame(0, 0, 0, 0); addCircle(cx, cz, 5.6); navRect(cx, cz, 5.8, 5.8, 0, 2); }
    // four round granite planters on the diagonals, clipped box balls and seasonal flowers in them
    for (const a of [Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4, 7 * Math.PI / 4]) { const px = cx + Math.cos(a) * 7.2, pz = cz + Math.sin(a) * 7.2, py = gy(px, pz); B.frame(px, py, pz, 0);
      B.cyl('stone', 0, 0, 0, 0.85, 0.78, 0.55, 24, { color: [0.62, 0.6, 0.57] }); B.cyl('stone', 0, 0.55, 0, 0.9, 0.9, 0.06, 24, { color: [0.72, 0.7, 0.66] }); B.cyl('plain', 0, 0.56, 0, 0.74, 0.74, 0.02, 24, { color: [0.3, 0.24, 0.18], cap: true });
      B.frame(0, 0, 0, 0); out.bushes.push({ x: px, y: py + 0.55, z: pz, s: 0.9, sx: 1, r: 0, c: col(0.3, 0.45, 0.24), keep: true });
      for (let k = 0; k < 7; k++) { const t = k / 7 * Math.PI * 2; out.bushes.push({ x: px + Math.cos(t) * 0.56, y: py + 0.55, z: pz + Math.sin(t) * 0.56, s: 0.3, sx: 1.2, r: t, c: AZALEA[k % 2].clone(), keep: true }); }
      addCircle(px, pz, 0.9); navRect(px, pz, 1.0, 1.0, 0, 2); }
    // benches round the plaza facing the water, between the axes, each with a lamp behind and bins at the quarters
    for (let k = 0; k < 8; k++) { const a = Math.PI / 2 * Math.floor(k / 2) + (k % 2 ? Math.PI / 3 : Math.PI / 6), c = Math.cos(a), s = Math.sin(a);
      seat(cx + c * 8.6, cz + s * 8.6, Math.atan2(-c, -s), false); if (k % 2) lamp(cx + Math.cos(a + 0.13) * (R - 0.45), cz + Math.sin(a + 0.13) * (R - 0.45)); }
    for (const a of [Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4, 7 * Math.PI / 4]) bin(cx + Math.cos(a) * 9.4, cz + Math.sin(a) * 9.4);
    // parterres in the four quarters: box hedge frames round flower carpets, a specimen tree in the outer corner;
    // an allée of zelkovas in grates along the promenade outside the plaza
    const Q = [[x0 + 0.8, cz + 3.2, cx - 2.6, z1 - 0.8], [cx + 2.6, cz + 3.2, x1 - 0.8, z1 - 0.8], [x0 + 0.8, z0 + 0.8, cx - 2.6, cz - 3.2], [cx + 2.6, z0 + 0.8, x1 - 0.8, cz - 3.2]];
    const FL = [col(0.0, 0.7, 0.55), col(0.12, 0.85, 0.6), col(0.8, 0.45, 0.62), col(0.97, 0.6, 0.75), col(0.15, 0.1, 0.92)];
    Q.forEach(([qa, qb, qc, qd], qi) => {
      const inCircle = (x, z) => Math.hypot(x - cx, z - cz) < R + 0.8;
      // the frame follows the quarter's rectangle but stops short of the plaza: hedge segments with gaps where the circle cuts
      const segs = [[[qa, qb], [qc, qb]], [[qc, qb], [qc, qd]], [[qc, qd], [qa, qd]], [[qa, qd], [qa, qb]]];
      for (const [p, q] of segs) { const L = Math.hypot(q[0] - p[0], q[1] - p[1]), n = Math.ceil(L / 1.0); let run = null;
        for (let k = 0; k <= n; k++) { const t = k / n, x = lerp(p[0], q[0], t), z = lerp(p[1], q[1], t), ok = !inCircle(x, z);
          if (ok && !run) run = [x, z]; if ((!ok || k === n) && run) { const e = ok ? [x, z] : [lerp(p[0], q[0], (k - 1) / n), lerp(p[1], q[1], (k - 1) / n)]; if (Math.hypot(e[0] - run[0], e[1] - run[1]) > 0.8) hedge(run, e, 0.55); run = null; } } }
      // bedding: two ribbons of flowers along the quarter's inner edges (one along the promenade, one along the minor
      // axis), each a wave of two colours; the lawn inside carries a row of clipped topiary balls
      const c1 = FL[qi % FL.length], c2 = FL[(qi + 2) % FL.length], inner = qi < 2 ? qb : qd, sgn = qi < 2 ? 1 : -1, sideX = qi % 2 ? qa : qc, sx = qi % 2 ? 1 : -1;
      for (let x = qa + 1.0; x < qc - 0.7; x += 0.5) for (let k = 0; k < 3; k++) { const z = inner + sgn * (0.8 + k * 0.5); if (Math.hypot(x - cx, z - cz) < R + 1.6) continue;
        bush(x + (rng() - 0.5) * 0.12, z + (rng() - 0.5) * 0.12, 0.3 + rng() * 0.06, (Math.sin(x * 0.9) * 0.5 + k * 0.4 > 0.4 ? c1 : c2).clone().offsetHSL(0, 0, (rng() - 0.5) * 0.05), 1.2); }
      for (let z = qb + 1.0; z < qd - 0.7; z += 0.5) for (let k = 0; k < 3; k++) { const x = sideX + sx * (0.8 + k * 0.5); if (Math.hypot(x - cx, z - cz) < R + 1.6 || Math.abs(z - inner) < 2.4) continue;
        bush(x + (rng() - 0.5) * 0.12, z + (rng() - 0.5) * 0.12, 0.3 + rng() * 0.06, (Math.sin(z * 0.9) * 0.5 + k * 0.4 > 0.4 ? c2 : c1).clone().offsetHSL(0, 0, (rng() - 0.5) * 0.05), 1.2); }
      const midZ = (qb + qd) / 2 + sgn * 0.8; for (let x = qa + 3.5; x < qc - 3; x += 3.2) if (Math.hypot(x - cx, midZ - cz) > R + 3) bush(x, midZ, 0.85, col(0.3, 0.5, 0.22), 1.0);
      const ox = qi % 2 ? qc - 2.2 : qa + 2.2, oz = qi < 2 ? qd - 2.2 : qb + 2.2; tree(qi % 2 ? 'maple' : 'jpine', ox, oz, 0.7);
      occRect((qa + qc) / 2, (qb + qd) / 2, (qc - qa) / 2, (qd - qb) / 2, 0, 1);
    });
    for (const x of [x0 - 5, x0 - 12, x1 + 2.5]) for (const e of [-1, 1]) { const z = cz + e * 3.3; tree('zelkova', x, z, 0.62);
      const y = gy(x, z) + 0.05; B.frame(x, y, z, 0); B.box('metal', 0, 0.005, 0, 1.4, 0.01, 1.4, { color: [0.22, 0.22, 0.23] }); B.frame(0, 0, 0, 0); }
    // exedra: a curved seat wall of granite closing the north axis, a flower bed behind it, a lamp either end
    { const ex = cx, ez = z1 - 1.0, Rr = 2.6; B.frame(0, 0, 0, 0);
      for (let k = 0; k < 12; k++) { const a0 = Math.PI * (0.05 + 0.9 * k / 12), a1 = Math.PI * (0.05 + 0.9 * (k + 1) / 12), am = (a0 + a1) / 2, px = ex + Math.cos(am) * Rr, pz = ez - 1.4 + Math.sin(am) * Rr;
        B.frame(px, gy(px, pz), pz, Math.atan2(Math.cos(am), Math.sin(am))); B.bbox('stone', 0, 0, 0, 0.5, 0.46, Rr * Math.PI * 0.9 / 12 + 0.04, 0.02, { color: [0.62, 0.6, 0.57] });
        B.bbox('stone', 0, 0.46, 0, 0.56, 0.06, Rr * Math.PI * 0.9 / 12 + 0.06, 0.01, { color: [0.7, 0.68, 0.65] }); }
      B.frame(0, 0, 0, 0); for (let k = 0; k < 14; k++) { const a = Math.PI * (0.05 + 0.9 * k / 13); bush(ex + Math.cos(a) * (Rr + 0.8), ez - 1.4 + Math.sin(a) * (Rr + 0.8), 0.55, AZALEA[k % 2]); }
      for (const e of [-1, 1]) lamp(ex + e * (Rr + 0.2), ez - 1.6);
      navRect(ex, ez - 0.3, Rr + 0.6, 1.4, 0, 2); }
    // south axis end: a bronze sculpture on a plinth in a round bed
    { const sx = cx, sz = z0 + 1.2, y = gy(sx, sz); B.frame(sx, y, sz, 0); B.cyl('stone', 0, 0, 0, 1.3, 1.3, 0.35, 24, { color: [0.62, 0.6, 0.57] }); B.cyl('plain', 0, 0.35, 0, 1.2, 1.2, 0.02, 24, { color: [0.3, 0.24, 0.18], cap: true });
      B.bbox('stone', 0, 0.35, 0, 0.7, 0.9, 0.7, 0.03, { color: [0.7, 0.68, 0.64] });
      B.cyl('metal', 0, 1.25, 0, 0.18, 0.28, 0.9, 12, { color: [0.36, 0.3, 0.2] }); B.cyl('metal', 0, 2.15, 0, 0.3, 0.12, 0.6, 12, { color: [0.36, 0.3, 0.2] }); B.cyl('metal', 0.1, 2.75, 0, 0.16, 0.05, 0.4, 10, { color: [0.36, 0.3, 0.2], cap: true });
      B.frame(0, 0, 0, 0); for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2; bush(sx + Math.cos(a) * 0.95, sz + Math.sin(a) * 0.95, 0.35, FL[k % 3]); } addCircle(sx, sz, 1.3); navRect(sx, sz, 1.4, 1.4, 0, 2); }
    // the edges: a low clipped hedge along the car park and the ends, bollards at the promenade's mouths
    hedge([x0, z0 - 0.3], [cx - 2.2, z0 - 0.3], 0.8); hedge([cx + 2.2, z0 - 0.3], [x1, z0 - 0.3], 0.8);
    for (const x of [x0 - 0.4, x1 + 0.4]) { hedge([x, z0 - 0.3], [x, cz - 2.6], 0.8); hedge([x, cz + 2.6], [x, z1], 0.8); for (const e of [-1.9, 1.9]) bollard(x, cz + e); }
    for (const x of [x0 - 8.5, x0 - 15.5]) for (const e of [-1, 1]) seat(x, cz + e * 2.6, e > 0 ? Math.PI : 0, e > 0);
    occRect((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2 + 1, (z1 - z0) / 2 + 1, 0, 1, 0);
  }

  // ================================================================ 池の公園: the lake park on the green belt
  function lakePark() {
    const cx = 482, cz = 15;
    const rOf = lakeR;
    const N = 72, LAKE = Array.from({ length: N }, (_, k) => { const a = k / N * Math.PI * 2, r = rOf(a); return [cx + Math.cos(a) * r, cz + Math.sin(a) * r]; });
    // the water stands 10 cm under the lawn at the shore; its sheet runs on under the banks, so the shoreline is where
    // the dug ground climbs out of it
    let wy = LAKE.reduce((a, p) => a + gy(cx + (p[0] - cx) * 1.14, cz + (p[1] - cz) * 1.14), 0) / N - 0.1;

    // the inlet: a narrow channel from the spring pool west of the path into the lake's west end
    const CH = LAKE_CH;
    B.frame(0, 0, 0, 0);
    // the channel's and the spring's water: exactly over their dug beds, never higher than the ground at their banks
    let cwy = wy; for (let x = CH.x0 + 3; x <= CH.x1 - 4; x += 0.5) for (const e of [-1, 1]) cwy = Math.min(cwy, gy(x, CH.z + e * (CH.w / 2 + 2.6)) - 0.1);
    for (let a = 0.9; a < 5.4; a += 0.3) cwy = Math.min(cwy, gy(446 + Math.cos(a) * 6.4, 13 + Math.sin(a) * 6.4) - 0.1);
    // one sheet of water at one level over the whole dug basin (lake, inlet and spring together, so nothing overlaps);
    // laid in 1 m cells wherever the ground is dug, running on under the banks, so the shoreline is where they climb out
    { const lv = Math.min(wy, cwy); B.frame(0, 0, 0, 0);
      for (let x = 438; x < 512; x += 1) for (let z = -2; z < 32; z += 1) { let dug = 0; for (const [ax, az] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5]]) dug = Math.max(dug, lakeDepth(x + ax, z + az)); if (dug < 0.002) continue;
        const tint = [0.97 + 0.03 * Math.sin(x * 0.3), 1, 0.97], p4 = [[x, lv, z], [x + 1, lv, z], [x + 1, lv, z + 1], [x, lv, z + 1]];
        B.poly('pondWater', p4, [0, 1, 0], { color: tint }); }
      wy = lv; }
    for (let x = CH.x0; x < CH.x1; x += 1) { const xa = x;
      // its banks: stones set along the water's edge at irregular spacing, grass and ferns between (none under the bridge)
      if (Math.abs(xa + 0.5 - 455.5) > 2.2) for (const e of [-1, 1]) { if (rng() < 0.6) rock(xa + rng(), CH.z + e * (CH.w / 2 + 0.05 + rng() * 0.25), 0.4 + rng() * 0.45);
        if (rng() < 0.5) bush(xa + rng(), CH.z + e * (CH.w / 2 + 0.7 + rng() * 0.5), 0.35 + rng() * 0.2, GREEN(), 1.3); } }
    const SP = Array.from({ length: 20 }, (_, k) => { const a = k / 20 * Math.PI * 2, r = 3.2 * (1 + 0.12 * Math.sin(a * 3)); return [446 + Math.cos(a) * r, 13 + Math.sin(a) * r]; });

    // the gravel loop round the water (a closed spline) and branches to every edge of the park, laid first so that
    // nothing placed after them can stand on them
    const CP = [[482, 31], [499, 30.5], [511, 24], [515.5, 12], [508, 0], [494, -5.5], [478, -6.5], [464, -3.5], [455.5, 3.5], [455.5, 21.5], [464, 29.5]];
    const spline = (P, step = 2.5) => { const o = []; for (let i = 0; i < P.length; i++) { const p0 = P[(i - 1 + P.length) % P.length], p1 = P[i], p2 = P[(i + 1) % P.length], p3 = P[(i + 2) % P.length], L = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), n = Math.max(2, Math.ceil(L / step));
      for (let k = 0; k < n; k++) { const t = k / n, t2 = t * t, t3 = t2 * t; o.push([0, 1].map(j => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3))); } } return o; };
    const loop = spline(CP), GRV = { mat: 'gravelPath', color: [0.9, 0.84, 0.74] };
    // the loop is laid in two halves either side of the bridge over the inlet
    const onBridge = p => Math.abs(p[0] - 455.5) < 2 && Math.abs(p[1] - CH.z) < 4.2;
    let runs = [[]]; for (const p of loop.concat([loop[0]])) { if (onBridge(p)) { if (runs[runs.length - 1].length) runs.push([]); continue; } runs[runs.length - 1].push(p); }
    if (runs.length > 1 && runs[runs.length - 1].length) { runs[0] = runs[runs.length - 1].concat(runs[0]); runs.pop(); }
    for (const r of runs) if (r.length > 1) pathLine(r, 2.4, { ...GRV, lamps: true, link: true });                  // (joined by the bridge)
    bridge(455.5, CH.z - 4.4, 455.5, CH.z + 4.4, 2.4);
    for (const P of [[[476, 31.1], [476, 51.6]], [[462.6, 29.6], [447, 35.5], [440, 41], [440, 51.6]], [[477.5, -6.4], [476, -18.9]], [[455.4, 5], [440, 5], [428.3, 5]],
      [[511, 24], [521, 30], [526.5, 40], [526.5, 46.4], [545.6, 46.4]], [[482, 30.8], [482, 26.1]], [[494.5, -5.4], [494.5, -1.1]], [[524.6, 36], [516.5, 36]]]) {
      const spur = P.length === 2 && Math.hypot(P[1][0] - P[0][0], P[1][1] - P[0][1]) < 9;                              // spurs end at a feature: never run on
      pathLine(P, spur ? 2.0 : 2.4, { ...GRV, lamps: P.length > 2 || Math.abs(P[1][1] - P[0][1]) > 10, link: spur }); }
    // the south spur ends at a viewing place over the reed beds: a stone landing at the water's edge, a bench on it
    if (K.lookout) K.lookout([[492.6, -1.4], [496.4, -1.4], [496.4, 1.6], [492.6, 1.6]]);
    // the spring: a tall standing stone at its head, big stones round the west half, a spill of small stones into the
    // water, reeds and ferns in the gaps; the east side opens into the channel
    rock(442.9, 14.4, 1.9, { part: 3, sink: 0.1, sy: 1.55, tilt: 0.1, force: true }); rock(441.8, 11.9, 1.7, { kind: 'b', sink: 0.16, force: true }); rock(444.2, 16.6, 1.2, { force: true });
    for (const [a, sz] of [[1.2, 1.2], [2.1, 1.0], [3.7, 1.3], [4.4, 0.9], [5.2, 1.1]]) rock(446 + Math.cos(a) * 3.5, 13 + Math.sin(a) * 3.3, sz, { sink: 0.26, force: true });
    for (let k = 0; k < 16; k++) { const a = 0.7 + rng() * 4.9, r = 2.8 + rng() * 1.6; rock(446 + Math.cos(a) * r, 13 + Math.sin(a) * r, 0.25 + rng() * 0.3, { force: true }); }
    for (const a of [1.65, 2.9, 4.8]) reeds(446 + Math.cos(a) * 2.9, 13 + Math.sin(a) * 2.9, gy(446, 13) + 0.07, 12);
    // shore by zone: cut stone kerb at the deck (north), a pebble beach (east), reeds and irises (south), rocks under
    // pines (west), natural stones elsewhere
    const zone = a => { const d = (x, y) => Math.abs(Math.atan2(Math.sin(x - y), Math.cos(x - y))); return d(a, Math.PI / 2) < 0.55 ? 'deck' : d(a, 0.05) < 0.62 ? 'beach' : d(a, -Math.PI / 2) < 0.8 ? 'reed' : d(a, Math.PI) < 0.75 ? 'rock' : 'stone'; };
    for (let k = 0; k < N; k++) { const a = (k + 0.5) / N * Math.PI * 2, p = LAKE[k], q = LAKE[(k + 1) % N], Z = zone(a);
      if (Z === 'deck') { const o = (P, f) => [cx + (P[0] - cx) * f, cz + (P[1] - cz) * f], a = o(p, 1.0), b = o(q, 1.0);             // dressed stone kerb at the waterline
        B.beam('stone', [a[0], wy - 0.02, a[1]], [b[0], wy - 0.02, b[1]], 0.45, 0.34, { color: [0.7, 0.68, 0.64] }); }
      else if (Z === 'beach') {
        for (let q = 0; q < 3; q++) { const t = rng(), u = 0.95 + rng() * 0.17; rock(cx + (lerp(p[0], q2(q, p, LAKE, k)[0], t) - cx) * u, cz + (lerp(p[1], q2(q, p, LAKE, k)[1], t) - cz) * u, 0.2 + rng() * 0.25, { sink: 0.35 }); } }
      else if (Z === 'rock') { if (k % 3 === 0) rockGroup(p[0] + (p[0] - cx) * 0.03, p[1] + (p[1] - cz) * 0.03, 1.6 + rng() * 0.9, { dir: Math.atan2(p[1] - cz, p[0] - cx), water: (x, z) => inPolyW(LAKE, x, z) }); }
      else { if (k % 2 === 0 || rng() < 0.3) rock(p[0] + (p[0] - cx) * 0.01, p[1] + (p[1] - cz) * 0.01, 0.45 + rng() * 0.5);
        if (rng() < 0.5) bush(cx + (p[0] - cx) * 1.07, cz + (p[1] - cz) * 1.07, 0.4 + rng() * 0.2, GREEN(), 1.3); }
      if (Z === 'reed' || (Z === 'stone' && rng() < 0.3)) { // reed clumps standing in the shallows, irises on the bank
        const f = 0.9 + rng() * 0.06, rx = cx + (p[0] - cx) * f, rz = cz + (p[1] - cz) * f; reeds(rx, rz, wy, 10 + Math.floor(rng() * 10));
        if (rng() < 0.6) { const bx = cx + (p[0] - cx) * 1.08, bz = cz + (p[1] - cz) * 1.08; bush(bx, bz, 0.4, rng() < 0.5 ? col(0.74, 0.55, 0.5) : col(0.26, 0.5, 0.3), 1.2); } } }
    pave(cx - 30, cz - 16, cx + 30, cz + 16, (x, z) => { const a = Math.atan2(z - cz, x - cx), r = Math.hypot(x - cx, z - cz), R0 = rOf(a); return r < R0 * (zone(a) === 'beach' ? 1.16 : 1.04) ? 1 : 0; });
    // the bank: the beach's sand shelving into the water; elsewhere a band of damp earth at the waterline under the grass
    paint(1, cx - 30, cz - 16, cx + 30, cz + 16, (x, z) => { const a = Math.atan2(z - cz, x - cx), t = Math.hypot(x - cx, z - cz) / rOf(a);
      return zone(a) === 'beach' ? (t < 1.14 ? 1 : Math.max(0, 0.55 - (t - 1.14) * 6)) : Math.max(0, 0.55 - Math.abs(t - 1.02) * 7); });
    paint(1, CH.x0 - 3, CH.z - 4, CH.x1, CH.z + 4, (x, z) => lakeDepth(x, z) > 0.12 ? 0.9 : lakeDepth(x, z) > 0.01 ? 0.5 : 0);
    paint(1, 439, 6, 453, 20, (x, z) => lakeDepth(x, z) > 0.12 ? 0.9 : lakeDepth(x, z) > 0.01 ? 0.5 : 0);
    paint(1, cx - 26, cz - 13, cx + 26, cz + 13, (x, z) => Math.hypot(x - cx, z - cz) < rOf(Math.atan2(z - cz, x - cx)) * 0.97 ? 0.9 : 0);    // the lake bed: wet sand and silt
    // no grass on the dug beds: over the channel and the spring out to where their banks climb out of the water
    const underCh = (x, z) => lakeDepth(x, z) > 0.04 && x < CH.x1 + 0.5;
    pave(CH.x0 - 3, CH.z - 4, CH.x1, CH.z + 4, (x, z) => underCh(x, z) ? 1 : 0);
    pave(439, 6, 453, 20, (x, z) => underCh(x, z) ? 1 : 0);
    blockPoly(LAKE); blockPoly(SP); navRect((CH.x0 + CH.x1) / 2, CH.z, (CH.x1 - CH.x0) / 2, CH.w / 2 + 0.2, Math.PI / 2, 2);
    addCircle(cx, cz, 9); for (const dx of [-14, 14]) addCircle(cx + dx, cz, 6);
    // water lilies in the quiet corners
    B.frame(0, 0, 0, 0);
    for (const [lx, lz, n] of [[467, 11, 9], [470, 20, 6], [496, 21, 7], [490, 7, 5]]) for (let k = 0; k < n; k++) { const x = lx + (rng() - 0.5) * 4, z = lz + (rng() - 0.5) * 2.4, r = 0.25 + rng() * 0.2, a0 = rng() * 6.28;
      for (let q = 0; q < 8; q++) { if (q === 0) continue; const b0 = a0 + q / 8 * 6.283, b1 = a0 + (q + 1) / 8 * 6.283; B.tri('plain', [x, wy + 0.008, z], [x + Math.cos(b1) * r, wy + 0.008, z + Math.sin(b1) * r], [x + Math.cos(b0) * r, wy + 0.008, z + Math.sin(b0) * r], { color: [0.24, 0.42, 0.2] }); }
      if (rng() < 0.3) B.cyl('plastic', x, wy + 0.01, z, 0.06, 0.09, 0.07, 8, { color: [0.98, 0.84, 0.9], cap: true }); }
    // the viewing deck out over the water, north shore
    { const dz0 = cz + rOf(Math.PI / 2) + 1.6, dz1 = dz0 - 5.2, y = Math.max(gy(482, dz0) + 0.12, wy + 0.16); B.frame(0, 0, 0, 0);
      if (K.area) K.area([[477.6, dz1], [486.4, dz1], [486.4, dz0], [477.6, dz0]], () => y);
      for (let x = 477.6; x < 486.4; x += 0.3) B.box('wood', x + 0.15, y - 0.08, (dz0 + dz1) / 2, 0.27, 0.06, dz0 - dz1, { color: [0.62, 0.48, 0.34] });
      B.box('wood', 482, y - 0.3, (dz0 + dz1) / 2, 8.8, 0.22, dz0 - dz1 - 0.2, { color: [0.45, 0.35, 0.26] });
      for (const x of [477.9, 482, 486.1]) for (const z of [dz1 + 0.3, (dz0 + dz1) / 2]) B.cyl('wood', x, wy - 0.6, z, 0.12, 0.12, y - wy + 0.3, 8, { color: [0.4, 0.3, 0.22] });
      const rail = (ax, az, bx, bz) => { B.beam('wood', [ax, y + 0.95, az], [bx, y + 0.95, bz], 0.1, 0.08, { color: [0.55, 0.42, 0.3] }); B.beam('wood', [ax, y + 0.5, az], [bx, y + 0.5, bz], 0.06, 0.06, { color: [0.55, 0.42, 0.3] });
        const L = Math.hypot(bx - ax, bz - az), n = Math.ceil(L / 1.5); for (let k = 0; k <= n; k++) { const t = k / n; B.box('wood', lerp(ax, bx, t), y - 0.05, lerp(az, bz, t), 0.1, 1.05, 0.1, { color: [0.5, 0.38, 0.27] }); } };
      rail(477.65, dz0 - 1.6, 477.65, dz1 + 0.05); rail(477.65, dz1 + 0.05, 486.35, dz1 + 0.05); rail(486.35, dz1 + 0.05, 486.35, dz0 - 1.6);
      for (const x of [480, 484]) benchAt(x, dz1 + 1.6, Math.PI);
      for (const x of [477.9, 486.1]) { B.cyl('lamp', x, y + 1.0, dz0 - 1.7, 0.06, 0.06, 0.12, 8, { cap: true }); lampPts.push({ p: [x, y + 1.1, dz0 - 1.7], s: 0.15 }); }
      addBox(477.65, (dz0 + dz1) / 2, 0.05, (dz0 - dz1) / 2, 0, -1e9, y + 1); addBox(486.35, (dz0 + dz1) / 2, 0.05, (dz0 - dz1) / 2, 0, -1e9, y + 1); addBox(482, dz1, 4.4, 0.05, 0, -1e9, y + 1);
      addPlat(482, (dz0 + dz1) / 2, 4.4, (dz0 - dz1) / 2, 0, y - 0.02); }
    // the gazebo (東屋) on the south shore: four posts, a hipped roof, benches round a table
    { const gx = 494.5, gz = 1.2, y = gy(gx, gz), S = 2.3; B.frame(gx, y, gz, 0.08);
      B.bbox('stone', 0, -0.2, 0, 5.4, 0.32, 5.4, 0.03, { color: [0.64, 0.62, 0.58] });
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.bbox('wood', sx * S, 0.1, sz * S, 0.18, 2.5, 0.18, 0.015, { color: [0.42, 0.3, 0.2] });
      for (const e of [-1, 1]) { B.bbox('wood', 0, 2.55, e * S, 2 * S + 0.3, 0.2, 0.16, 0.01, { color: [0.4, 0.28, 0.2] }); B.bbox('wood', e * S, 2.55, 0, 0.16, 0.2, 2 * S + 0.3, 0.01, { color: [0.4, 0.28, 0.2] }); }
      const top = 4.0, ov = 0.7, eY = 2.72; for (let s = 0; s < 4; s++) { const a = s * Math.PI / 2, rot = (x, z) => [x * Math.cos(a) - z * Math.sin(a), z * Math.cos(a) + x * Math.sin(a)];
        const p0 = rot(-S - ov, S + ov), p1 = rot(S + ov, S + ov); B.poly('roofTile', [[p0[0], eY, p0[1]], [p1[0], eY, p1[1]], [0, top, 0]], [0, 1, 0], { color: [0.32, 0.3, 0.3] });
        B.poly('wood', [[p1[0], eY - 0.005, p1[1]], [p0[0], eY - 0.005, p0[1]], [0, top - 0.2, 0]], [0, -1, 0], { color: [0.55, 0.42, 0.3] }); }
      B.cyl('roofTile', 0, top - 0.05, 0, 0.18, 0.08, 0.35, 8, { color: [0.3, 0.28, 0.28], cap: true });
      for (const [bx, bz, r] of [[0, -S + 0.35, 0], [-S + 0.35, 0, Math.PI / 2], [S - 0.35, 0, -Math.PI / 2]]) { B.frame(...B.P([bx, 0.12, bz]), 0.08 + r); B.bbox('wood', 0, 0.3, 0, 3.4, 0.08, 0.42, 0.01, { color: [0.62, 0.48, 0.34] }); for (const e of [-1.4, 0, 1.4]) B.box('wood', e, 0, 0, 0.08, 0.3, 0.36, { color: [0.45, 0.34, 0.24] }); B.frame(gx, y, gz, 0.08); }
      B.bbox('wood', 0, 0.12, 0.2, 1.2, 0.7, 0.8, 0.02, { color: [0.58, 0.44, 0.3] });
      B.box('lamp', 0, 2.62, 0, 0.3, 0.05, 0.3); lampPts.push({ p: B.P([0, 2.4, 0]), s: 0.4 });
      B.frame(0, 0, 0, 0); for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const p = [gx + sx * S * Math.cos(0.08) + sz * S * Math.sin(0.08), gz - sx * S * Math.sin(0.08) + sz * S * Math.cos(0.08)]; addCircle(p[0], p[1], 0.12); }
      navRect(gx, gz, 2.9, 2.9, 0.08, 2); for (const c of HYDRANGEA) clump(gx + (rng() - 0.5) * 6, gz - 3.8, 3, 1.0, c, [0.55, 0.8]); }
    // planting: black pines leaning over the rocky west shore, maples by the bridge, a cherry grove east, big shade
    // trees on the picnic lawn, a buffer of broadleaves along the main road, azalea drifts along the loop
    for (const [x, z, s] of [[459.5, 5.5, 0.62], [460.5, 23, 0.58], [466, -0.5, 0.55], [452, 23, 0.5], [451, 7.5, 0.52]]) tree('jpine', x, z, s);
    for (const [x, z] of [[451.5, 18.5], [459.5, 16.5]]) tree('maple', x, z, 0.6);
    for (let k = 0; k < 9; k++) { const a = -0.9 + k * 0.24, r = 30 + (k % 2) * 4; tree('sakura', cx + Math.cos(a) * r, cz + Math.sin(a) * r * 0.75, 0.75 + rng() * 0.15); }
    for (const [x, z, k, s] of [[436, 30, 'zelkova', 1.0], [448, 44, 'oak', 0.95], [434, 44, 'zelkova', 0.85], [468, 42, 'leaf', 0.9], [494, 42, 'maple', 0.75], [505, 41, 'leaf', 0.8]]) tree(k, x, z, s);
    for (let x = 434; x < 524; x += 7 + rng() * 3) tree(rng() < 0.5 ? 'leaf' : 'zelkova', x, -13.5 - rng() * 2, 0.75 + rng() * 0.2);
    for (const [x, z, n] of [[470, 34, 7], [492, 34, 6], [514, 17, 6], [504, -8.5, 6], [462, -7, 5], [449.5, 27, 6], [486, -9, 5]]) clump(x, z, n, 1.8, AZALEA[Math.floor(rng() * AZALEA.length)]);
    for (let k = 0; k < 14; k++) { const a = rng() * 6.28, r = rOf(a) + 3 + rng() * 2.5, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r; if (zone(a) === 'beach') continue; bush(x, z, 0.6 + rng() * 0.3, GREEN(), 1.1); }
    // seats: facing the water along the loop, the picnic lawn's tables under the trees
    for (const [x, z, yaw] of [[468, 30.2, Math.PI * 0.95], [497, 29.8, Math.PI * 1.08], [512.5, 5.5, -Math.PI * 0.62], [470, -5, 0.08], [458, 18, Math.PI / 2 + 0.1]]) seat(x, z, yaw, rng() < 0.5);
    for (const [tx, tz] of [[440, 32], [446, 39]]) { const q = K.freeSpot(tx, tz, 1.3); if (!q) continue; const [x, z] = q, y = gy(x, z); B.frame(x, y, z, 0.3); B.bbox('wood', 0, 0.72, 0, 1.8, 0.06, 0.8, 0.01, { color: [0.6, 0.46, 0.32] }); for (const e of [-0.7, 0.7]) B.box('wood', e, 0, 0, 0.08, 0.72, 0.6, { color: [0.45, 0.34, 0.24] });
      for (const e of [-0.75, 0.75]) { B.bbox('wood', 0, 0.44, e, 1.8, 0.05, 0.3, 0.01, { color: [0.6, 0.46, 0.32] }); for (const f of [-0.7, 0.7]) B.box('wood', f, 0, e, 0.06, 0.44, 0.25, { color: [0.45, 0.34, 0.24] }); }
      B.frame(0, 0, 0, 0); addBox(x, z, 0.95, 0.95, 0.3, y - 1, y + 0.8); navRect(x, z, 1.1, 1.1, 0.3, 2); }
    K.toilet(515, 36, Math.PI / 2);
    paint(2, 428, 24, 460, 48, () => 0.25);                                                                              // the picnic lawn, softly mown
  }
  // reeds: thin blades leaning out of the shallows round (x, z)
  function reeds(x, z, wy, n) { B.frame(0, 0, 0, 0);
    for (let k = 0; k < n; k++) { const px = x + (rng() - 0.5) * 1.3, pz = z + (rng() - 0.5) * 1.3, h = 0.9 + rng() * 0.9, a = rng() * 6.28, lx = Math.cos(a) * 0.25 * rng(), lz = Math.sin(a) * 0.25 * rng(), w = 0.035, t = rng() * 6.28;
      const c = rng() < 0.2 ? [0.62, 0.58, 0.38] : [0.34 + rng() * 0.08, 0.5 + rng() * 0.08, 0.26];
      B.tri('plain', [px - Math.cos(t) * w, wy, pz - Math.sin(t) * w], [px + Math.cos(t) * w, wy, pz + Math.sin(t) * w], [px + lx, wy + h, pz + lz], { color: c });
      B.tri('plain', [px + Math.cos(t) * w, wy, pz + Math.sin(t) * w], [px - Math.cos(t) * w, wy, pz - Math.sin(t) * w], [px + lx, wy + h, pz + lz], { color: c });
      if (rng() < 0.25) B.cyl('plain', px + lx * 0.95, wy + h * 0.82, pz + lz * 0.95, 0.03, 0.025, 0.2, 5, { color: [0.4, 0.28, 0.18] }); } }
  // arched timber bridge in vermilion between two points (the path's ends either side), deck rising to the middle
  function bridge(ax, az, bx, bz, w) {
    const L = Math.hypot(bx - ax, bz - az), r = Math.atan2(bx - ax, bz - az), y0 = gy(ax, az) + 0.05, y1 = gy(bx, bz) + 0.05, rise = 0.55, VER = [0.78, 0.22, 0.14];
    B.frame(ax, 0, az, r); const n = 12, yAt = t => lerp(y0, y1, t) + Math.sin(t * Math.PI) * rise;
    for (let k = 0; k < n; k++) { const t0 = k / n, t1 = (k + 1) / n;
      B.poly('wood', [[-w / 2, yAt(t0), t0 * L], [w / 2, yAt(t0), t0 * L], [w / 2, yAt(t1), t1 * L], [-w / 2, yAt(t1), t1 * L]], [0, 1, 0], { color: [0.56, 0.44, 0.32], uv: 0.8 });
      for (const e of [-1, 1]) { B.beam('wood', [e * (w / 2 - 0.05), yAt(t0) - 0.18, t0 * L], [e * (w / 2 - 0.05), yAt(t1) - 0.18, t1 * L], 0.12, 0.3, { color: [0.4, 0.3, 0.22] });
        B.beam('wood', [e * (w / 2 + 0.02), yAt(t0) + 0.92, t0 * L], [e * (w / 2 + 0.02), yAt(t1) + 0.92, t1 * L], 0.09, 0.09, { color: VER });
        B.beam('wood', [e * (w / 2 + 0.02), yAt(t0) + 0.45, t0 * L], [e * (w / 2 + 0.02), yAt(t1) + 0.45, t1 * L], 0.06, 0.06, { color: VER }); } }
    for (let k = 0; k <= 4; k++) { const t = k / 4; for (const e of [-1, 1]) { B.box('wood', e * (w / 2 + 0.02), yAt(t) - 0.1, t * L, 0.12, 1.12, 0.12, { color: VER }); if (k === 0 || k === 4) B.cyl('metal', e * (w / 2 + 0.02), yAt(t) + 1.02, t * L, 0.08, 0.02, 0.16, 8, { color: [0.7, 0.58, 0.2], cap: true }); } }
    for (const t of [0.3, 0.7]) for (const e of [-1, 1]) B.cyl('wood', e * (w / 2 - 0.2), gy(ax, az) - 0.6, t * L, 0.1, 0.1, yAt(t) - gy(ax, az) + 0.4, 8, { color: [0.35, 0.26, 0.2] });
    B.frame(0, 0, 0, 0);
    for (const e of [-1, 1]) { const px = ax + Math.cos(r) * e * (w / 2 + 0.02), pz = az - Math.sin(r) * e * (w / 2 + 0.02); addBox(px + Math.sin(r) * L / 2, pz + Math.cos(r) * L / 2, 0.06, L / 2, r, -1e9, Math.max(y0, y1) + rise + 1); }
    for (let k = 0; k < 12; k++) { const t = (k + 0.5) / 12; addPlat(ax + (bx - ax) * t, az + (bz - az) * t, w / 2, L / 24 + 0.02, r, yAt(t)); }                // walkable deck
    if (K.area) { const ux = (bx - ax) / L, uz = (bz - az) / L, nx = -uz * w / 2, nz = ux * w / 2;                                                     // the paths meet its ends
      K.area([[ax - nx, az - nz], [bx - nx, bz - nz], [bx + nx, bz + nz], [ax + nx, az + nz]], (x, z) => yAt(clamp(((x - ax) * ux + (z - az) * uz) / L, 0, 1))); }
    navRect((ax + bx) / 2, (az + bz) / 2, w / 2, L / 2, r, 1);
  }

  // ================================================================ 児童遊園: the playground in the court of the U
  function playground() {
    const X0 = 465.3, X1 = 496.3, Z1 = 139.5, SX = 480.5, CZ = 117.3;
    // spine and cross paths (the cross ties the mid-rise's lobby to the walk-up's back walk), a paved square where they meet
    pathLine([[SX, 89.6], [SX, Z1 + 1.0]], 3.0, { lamps: true, color: [0.84, 0.8, 0.74] });
    pathLine([[463.8, CZ], [498.9, CZ]], 2.4, { lamps: false, color: [0.84, 0.8, 0.74] });
    surf(SX - 4, CZ - 2.5, SX + 4, CZ + 2.5, 'pavement', [0.8, 0.76, 0.7], 0.053);
    occRect(SX, CZ, 4, 2.5, 0, 1, 1);
    // yard A (big kids): combination tower, swings, see-saw, bars on terracotta and green rubber, a fence with two gates
    const A = [466.4, 94.8, 477.2, 115.2], Bq = [483.8, 94.8, 495.0, 115.2];
    surf(A[0], A[1], A[2], A[3], 'plain', [0.62, 0.34, 0.27], 0.06);
    surf(A[0] + 1.5, A[1] + 1.5, A[2] - 1.5, A[1] + 7.5, 'plain', [0.36, 0.56, 0.38], 0.066);
    fence([[A[0], A[1]], [A[2], A[1]], [A[2], A[3]], [A[0], A[3]], [A[0], A[1]]], [0.2, 0.46, 0.66], [10.8 + 20.4 + 4.5, 10.8 + 6]);
    blockPoly([[A[0] + 0.3, A[1] + 0.3], [A[2] - 0.3, A[1] + 0.3], [A[2] - 0.3, A[3] - 0.3], [A[0] + 0.3, A[3] - 0.3]]);
    combo(471.8, 107.5, 0); swings4(471.8, 98.2, 0); seesaw(475.3, 112, Math.PI / 2); bars(468.3, 112.6, Math.PI / 2);
    // yard B (toddlers): sand pit under its sail, spring riders, a little dome climber and a play house, blue rubber
    surf(Bq[0], Bq[1], Bq[2], Bq[3], 'plain', [0.3, 0.46, 0.64], 0.06);
    surf(484.4, 106, 488.4, 111.6, 'plain', [0.9, 0.78, 0.36], 0.066);
    fence([[Bq[0], Bq[1]], [Bq[2], Bq[1]], [Bq[2], Bq[3]], [Bq[0], Bq[3]], [Bq[0], Bq[1]]], [0.9, 0.62, 0.16], [11.2 + 20.4 + 11.2 + 4.2, 11.2 + 20.4 + 6]);
    blockPoly([[Bq[0] + 0.3, Bq[1] + 0.3], [Bq[2] - 0.3, Bq[1] + 0.3], [Bq[2] - 0.3, Bq[3] - 0.3], [Bq[0] + 0.3, Bq[3] - 0.3]]);
    K.sandPit(490, 99.5); for (const [x, z, c] of [[485.4, 107.2, [0.95, 0.72, 0.2]], [487.4, 108.6, [0.3, 0.62, 0.86]], [485.6, 110.4, [0.9, 0.36, 0.3]]]) K.springRider(x, z, c);
    dome(491.4, 106.6, 1.6); playHouse(491.6, 112.4, Math.PI / 2);
    // benches for the parents along the yards, facing in, with bins; a drinking fountain at the square
    for (const z of [100, 108]) { seat(SX - 2.3, z, -Math.PI / 2, z === 100); seat(SX + 2.3, z, Math.PI / 2, z === 108); }
    fountainTap(SX - 3.3, CZ + 2.0);
    // the parents' garden (north-west): a pergola with benches under wisteria, flower beds, shade trees
    K.pergola(472, 128, 0, 6.2, 3.2); for (const dx of [-1.6, 1.6]) benchAt(472 + dx, 127.6, Math.PI);
    for (const [x0, z0, x1, z1] of [[467, 121, 477.5, 123], [467, 133, 477.5, 135.5]]) {
      surf(x0, z0, x1, z1, 'soil', [0.42, 0.33, 0.26], 0.03, { cell: 2 });
      B.frame(0, 0, 0, 0); for (const [a, b] of [[[x0, z0], [x1, z0]], [[x1, z0], [x1, z1]], [[x1, z1], [x0, z1]], [[x0, z1], [x0, z0]]]) B.beam('block', [a[0], gy(a[0], a[1]) + 0.02, a[1]], [b[0], gy(b[0], b[1]) + 0.02, b[1]], 0.14, 0.18, { color: [0.62, 0.36, 0.28] });
      for (let x = x0 + 0.5; x < x1 - 0.2; x += 0.75) for (let z = z0 + 0.5; z < z1 - 0.2; z += 0.75) { const k = Math.floor((x - x0) / 1.5 + (z - z0) / 1.5) % 3;
        bush(x + (rng() - 0.5) * 0.15, z + (rng() - 0.5) * 0.15, k === 2 ? 0.46 : 0.38, k === 0 ? HYDRANGEA[Math.floor(rng() * 3)] : k === 1 ? AZALEA[Math.floor(rng() * 2)] : GREEN(), 1.15); }
      navRect((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (z1 - z0) / 2, 0, 2); }
    for (const [x, z] of [[467.5, 137.5], [477.5, 137.8], [467.3, 129]]) tree('sakura', x, z, 0.7);
    // the ball lawn (north-east): open grass, trees round its edge, a bench row facing it
    for (const [x, z, k] of [[495, 121.5, 'zelkova'], [495.2, 131, 'maple'], [494.5, 138, 'zelkova'], [484, 138.5, 'leaf']]) tree(k, x, z, 0.7);
    for (const z of [123, 131]) seat(SX + 2.1, z, Math.PI / 2, z === 131);
    occRect(489, 129, 5, 6, 0, 1, 0);
    // round the yards: shade trees at the corners, hedges against the buildings' walks with gaps at the paths
    for (const [x, z] of [[468.5, 92.9], [494.5, 92.9]]) tree(rng() < 0.5 ? 'zelkova' : 'sakura', x, z, 0.62);
    hedge([X0, 94], [X0, CZ - 2.2], 0.9); hedge([X0, CZ + 2.2], [X0, Z1], 0.9); hedge([X1, 96.5], [X1, CZ - 2.2], 0.9); hedge([X1, CZ + 2.2], [X1, Z1 - 1], 0.9);
    for (const x of [X0 + 1.3, X1 - 1.3]) for (const z of [104, 130]) clump(x, z, 3, 0.8, GREEN());
    // lamps along the cross path and at the yard gates, a bike rack by the square
    for (const x of [470, 491]) lamp(x, CZ + 1.9, false);
    { const bx = SX + 6.2, bz = CZ + 3.6, y = gy(bx, bz); B.frame(bx, y, bz, 0); for (let k = 0; k < 5; k++) B.beam('steel', [-1.6 + k * 0.8, 0, 0], [-1.6 + k * 0.8, 0.7, 0], 0.04, 0.04, { color: [0.7, 0.72, 0.74] });
      B.box('steel', 0, 0.68, 0, 3.4, 0.04, 0.04, { color: [0.7, 0.72, 0.74] }); B.frame(0, 0, 0, 0); for (let k = 0; k < 3; k++) out.bikes.push({ x: bx - 1.2 + k * 1.2, y, z: bz, r: Math.PI / 2 + (rng() - 0.5) * 0.1 }); navRect(bx, bz, 1.9, 1.0, 0, 2); }
  }
  // combination play tower: two decks joined by a rope bridge, roofs, a wide slide, a wavy slide, a climbing wall,
  // a ladder and a pole
  function combo(x, z, yaw) { const y = gy(x, z) + 0.06; B.frame(x, y, z, yaw);
    const post = (px, pz, h, c) => B.cyl('steel', px, 0, pz, 0.065, 0.065, h, 10, { color: c }), BLU = [0.2, 0.5, 0.74], YEL = [0.96, 0.78, 0.2], RED = [0.86, 0.28, 0.22], GRN = [0.24, 0.66, 0.4];
    const tower = (tx, dh, roof) => { for (const sx of [-1, 1]) for (const sz of [-1, 1]) post(tx + sx * 0.8, sz * 0.8, dh + 1.6, BLU);
      B.bbox('plastic', tx, dh, 0, 1.7, 0.08, 1.7, 0.02, { color: YEL });
      for (const e of [-1, 1]) B.bbox('plastic', tx + e * 0.83, dh + 0.1, 0, 0.05, 0.75, 1.5, 0.01, { color: e > 0 ? RED : GRN });
      B.poly('plastic', [[tx - 1.0, dh + 1.6, -1.0], [tx + 1.0, dh + 1.6, -1.0], [tx, dh + 2.5, 0]], [0, 0.6, -1], { color: roof }); B.poly('plastic', [[tx + 1.0, dh + 1.6, 1.0], [tx - 1.0, dh + 1.6, 1.0], [tx, dh + 2.5, 0]], [0, 0.6, 1], { color: roof });
      B.poly('plastic', [[tx + 1.0, dh + 1.6, -1.0], [tx + 1.0, dh + 1.6, 1.0], [tx, dh + 2.5, 0]], [1, 0.6, 0], { color: roof }); B.poly('plastic', [[tx - 1.0, dh + 1.6, 1.0], [tx - 1.0, dh + 1.6, -1.0], [tx, dh + 2.5, 0]], [-1, 0.6, 0], { color: roof }); };
    tower(-2.2, 1.5, RED); tower(2.2, 1.9, GRN);
    // rope bridge between the decks: planks on chains, rope rails
    for (let k = 0; k < 8; k++) { const t = (k + 0.5) / 8, px = -1.3 + t * 2.6, py = lerp(1.5, 1.9, t) - Math.sin(t * Math.PI) * 0.12; B.box('wood', px, py, 0, 0.26, 0.05, 0.9, { color: [0.62, 0.46, 0.3] }); }
    for (const e of [-0.5, 0.5]) { B.beam('plastic', [-1.35, 2.3, e], [0, 2.2, e], 0.04, 0.04, { color: BLU }); B.beam('plastic', [0, 2.2, e], [1.35, 2.7, e], 0.04, 0.04, { color: BLU }); }
    // the wide slide off the low tower, the wavy one off the high tower, a climbing wall and a ladder
    B.poly('plastic', [[-2.2 - 0.5, 1.55, 0.85], [-2.2 + 0.5, 1.55, 0.85], [-2.2 + 0.5, 0.25, 4.4], [-2.2 - 0.5, 0.25, 4.4]], [0, 1, 0.4], { color: YEL });
    for (const e of [-0.5, 0.5]) B.beam('plastic', [-2.2 + e, 1.8, 0.85], [-2.2 + e, 0.5, 4.4], 0.05, 0.3, { color: YEL });
    let p = [2.2, 1.95, -0.85]; for (let k = 1; k <= 8; k++) { const t = k / 8, q = [2.2 + Math.sin(t * 5) * 0.25, 1.95 - t * 1.7 + Math.sin(t * Math.PI * 2) * 0.12, -0.85 - t * 4.2];
      B.poly('plastic', [[p[0] - 0.35, p[1], p[2]], [p[0] + 0.35, p[1], p[2]], [q[0] + 0.35, q[1], q[2]], [q[0] - 0.35, q[1], q[2]]], [0, 1, -0.3], { color: GRN });
      for (const e of [-0.36, 0.36]) B.beam('plastic', [p[0] + e, p[1] + 0.2, p[2]], [q[0] + e, q[1] + 0.2, q[2]], 0.05, 0.25, { color: GRN }); p = q; }
    B.poly('plastic', [[3.05, 0, -0.8], [3.05, 0, 0.8], [3.05, 1.9, 0.8], [3.05, 1.9, -0.8]], [1, 0, 0], { color: [0.94, 0.94, 0.9] });
    B.detail(1, () => { for (let k = 0; k < 14; k++) B.bbox('plastic', 3.1, 0.2 + (k * 0.37) % 1.6, -0.6 + (k * 0.53) % 1.2, 0.08, 0.1, 0.12, 0.02, { color: [RED, BLU, YEL, GRN][k % 4] }); });
    for (let k = 0; k < 5; k++) B.box('steel', -3.2 - k * 0.12, 0.3 + k * 0.28, 0, 0.05, 0.05, 0.8, { color: [0.7, 0.7, 0.72] });
    for (const e of [-0.42, 0.42]) B.beam('steel', [-3.9, 0, e], [-3.05, 1.5, e], 0.06, 0.06, { color: [0.7, 0.7, 0.72] });
    B.cyl('steel', 1.2, 0, 1.2, 0.035, 0.035, 2.6, 8, { color: [0.8, 0.8, 0.8] });
    B.frame(0, 0, 0, 0); addBox(x, z, 3.3, 1.0, yaw, y - 1, y + 4.4); }
  function swings4(x, z, yaw) { const y = gy(x, z) + 0.06; B.frame(x, y, z, yaw); const C = [0.86, 0.3, 0.24];
    for (const sx of [-3.6, 0, 3.6]) for (const sz of [-1, 1]) B.beam('steel', [sx, 0, sz * 1.2], [sx, 2.5, 0], 0.08, 0.08, { color: C });
    B.beam('steel', [-3.7, 2.5, 0], [3.7, 2.5, 0], 0.1, 0.1, { color: C });
    for (const sx of [-2.6, -1.0, 1.0, 2.6]) { for (const e of [-0.22, 0.22]) B.beam('steel', [sx + e, 2.48, 0], [sx + e, 0.52, 0], 0.012, 0.012, { color: [0.6, 0.6, 0.6] }); B.bbox('plastic', sx, 0.46, 0, 0.5, 0.06, 0.24, 0.01, { color: [0.12, 0.14, 0.16] }); }
    B.bbox('steel', 0, 0, 2.6, 7.6, 0.55, 0.06, 0.01, { color: [0.95, 0.8, 0.2] }); for (const sx of [-3.8, 3.8]) B.box('steel', sx, 0, 2.6, 0.08, 0.55, 0.08, { color: [0.95, 0.8, 0.2] });     // safety rail in front
    B.frame(0, 0, 0, 0); addBox(x, z, 3.8, 0.4, yaw, y - 1, y + 2.6); addBox(x + Math.sin(yaw) * 2.6, z + Math.cos(yaw) * 2.6, 3.8, 0.05, yaw, y - 1, y + 0.6); }
  function seesaw(x, z, yaw) { const y = gy(x, z) + 0.06; B.frame(x, y, z, yaw);
    B.bbox('steel', 0, 0, 0, 0.5, 0.45, 0.6, 0.02, { color: [0.3, 0.5, 0.76] }); B.cyl('steel', 0, 0.45, -0.3, 0.06, 0.06, 0.6, 8, { color: [0.7, 0.7, 0.72] });
    B.beam('plastic', [-1.9, 0.26, 0], [1.9, 0.72, 0], 0.26, 0.08, { color: [0.95, 0.74, 0.2] });
    for (const [sx, sy] of [[-1.7, 0.3], [1.7, 0.7]]) { B.bbox('plastic', sx, sy + 0.04, 0, 0.36, 0.06, 0.34, 0.01, { color: [0.86, 0.3, 0.24] }); B.box('steel', sx + (sx < 0 ? 0.3 : -0.3), sy, 0, 0.04, 0.4, 0.04, { color: [0.7, 0.7, 0.72] }); B.box('steel', sx + (sx < 0 ? 0.3 : -0.3), sy + 0.38, 0, 0.04, 0.04, 0.34, { color: [0.7, 0.7, 0.72] }); }
    for (const sx of [-1.8, 1.8]) B.cyl('dark', sx, 0, 0, 0.2, 0.2, 0.14, 10, { color: [0.12, 0.12, 0.12], cap: true });
    B.frame(0, 0, 0, 0); addBox(x, z, 2, 0.3, yaw, y - 1, y + 0.9); }
  function bars(x, z, yaw) { const y = gy(x, z) + 0.06; B.frame(x, y, z, yaw); const hs = [0.9, 1.1, 1.35], C = [[0.3, 0.62, 0.86], [0.95, 0.72, 0.2], [0.86, 0.3, 0.24]];
    for (let i = 0; i <= 3; i++) B.cyl('steel', -1.8 + i * 1.2, 0, 0, 0.05, 0.05, (hs[Math.min(i, 2)] + (i ? hs[i - 1] : hs[0])) / 2 + 0.1, 10, { color: C[Math.min(i, 2)], cap: true });
    for (let i = 0; i < 3; i++) B.beam('steel', [-1.8 + i * 1.2, hs[i], 0], [-0.6 + i * 1.2, hs[i], 0], 0.03, 0.03, { color: [0.8, 0.8, 0.8] });
    B.frame(0, 0, 0, 0); addBox(x, z, 1.9, 0.1, yaw, y - 1, y + 1.4); }
  function dome(x, z, R) { const y = gy(x, z) + 0.06; B.frame(x, y, z, 0); const C = [0.2, 0.62, 0.42];
    for (let m = 0; m < 8; m++) { const a = m / 8 * Math.PI * 2; let p = [Math.cos(a) * R, 0, Math.sin(a) * R]; for (let k = 1; k <= 4; k++) { const e = k / 4 * Math.PI / 2, q = [Math.cos(a) * R * Math.cos(e), R * Math.sin(e), Math.sin(a) * R * Math.cos(e)]; B.beam('steel', p, q, 0.04, 0.04, { color: C }); p = q; } }
    for (const k of [1, 2, 3]) { const e = k / 4 * Math.PI / 2, r = R * Math.cos(e), h = R * Math.sin(e); for (let m = 0; m < 8; m++) { const a0 = m / 8 * Math.PI * 2, a1 = (m + 1) / 8 * Math.PI * 2; B.beam('steel', [Math.cos(a0) * r, h, Math.sin(a0) * r], [Math.cos(a1) * r, h, Math.sin(a1) * r], 0.035, 0.035, { color: [0.95, 0.74, 0.2] }); } }
    B.frame(0, 0, 0, 0); addCircle(x, z, R); }
  function playHouse(x, z, yaw) { const y = gy(x, z) + 0.06; B.frame(x, y, z, yaw);
    for (const sx of [-0.8, 0.8]) for (const sz of [-0.7, 0.7]) B.box('wood', sx, 0, sz, 0.1, 1.3, 0.1, { color: [0.6, 0.44, 0.3] });
    B.bbox('wood', 0, 0.35, -0.7, 1.6, 0.6, 0.06, 0.01, { color: [0.96, 0.9, 0.8] }); B.bbox('wood', 0, 0.35, 0.7, 1.6, 0.6, 0.06, 0.01, { color: [0.96, 0.9, 0.8] });
    B.poly('plastic', [[-1.0, 1.3, -0.9], [1.0, 1.3, -0.9], [1.0, 1.85, 0], [-1.0, 1.85, 0]], [0, 1, -1], { color: [0.86, 0.3, 0.24] }); B.poly('plastic', [[1.0, 1.3, 0.9], [-1.0, 1.3, 0.9], [-1.0, 1.85, 0], [1.0, 1.85, 0]], [0, 1, 1], { color: [0.86, 0.3, 0.24] });
    B.bbox('wood', 0, 0.45, 0, 0.8, 0.05, 0.5, 0.01, { color: [0.6, 0.44, 0.3] });
    B.frame(0, 0, 0, 0); addBox(x, z, 0.9, 0.8, yaw, y - 1, y + 1.9); }
  function fountainTap(x0, z0) { const q = K.freeSpot(x0, z0, 0.45); if (!q) return; const [x, z] = q, y = gy(x, z); B.frame(x, y, z, 0); B.bbox('concrete', 0, 0, 0, 0.4, 0.8, 0.4, 0.03, { color: [0.72, 0.72, 0.7] }); B.cyl('steel', 0, 0.8, 0, 0.22, 0.16, 0.08, 14, { color: [0.78, 0.8, 0.82], cap: true });
    B.cyl('steel', 0.05, 0.86, 0, 0.02, 0.02, 0.12, 6, { color: [0.8, 0.8, 0.82], cap: true }); B.bbox('concrete', 0.35, 0, 0, 0.3, 0.45, 0.3, 0.02, { color: [0.72, 0.72, 0.7] }); B.frame(0, 0, 0, 0); addCircle(x, z, 0.3); navRect(x, z, 0.5, 0.4, 0, 2); }

  // the hill foot: where the district's platform is let into the valley side, the steeper spots of the bank carry a few
  // stone groups (big stone downhill-leaning, the spill of small stones below it), never on a road, path or field edge
  function hillFoot() {
    const hr = [], grad = (x, z) => Math.hypot(gy(x + 1, z) - gy(x - 1, z), gy(x, z + 1) - gy(x, z - 1)) / 2;
    for (let k = 0; k < 3000 && hr.length < 11; k++) {
      const x = 330 + rng() * 340, z = -20 + rng() * 380, d = K.sd(x, z); if (d < 5 || d > 24) continue;
      const g = grad(x, z); if (g < 0.09 || K.paved(x, z) || K.nearRoad(x, z, 6) || !K.clear(x, z, 8) || hr.some(q => Math.hypot(q[0] - x, q[1] - z) < 30)) continue;
      const dx = gy(x + 1, z) - gy(x - 1, z), dz = gy(x, z + 1) - gy(x, z - 1); hr.push([x, z]);
      rockGroup(x, z, 2.2 + rng() * 1.1, { dir: Math.atan2(-dz, -dx), spread: 1.1 }); }
  }
  fountainPark(); lakePark(); playground(); if (!K.probe) hillFoot(); // (the hill-foot outcrops keep off the buildings themselves)
}
