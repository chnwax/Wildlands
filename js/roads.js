// Sakuragawa road network. Everything is built from one surface description, so whatever lies on the asphalt
// (markings, stop lines, zebra crossings, manholes, cars) sits exactly on it and needs no depth tricks:
//  - carriageways with a crown (camber) that flattens toward junctions, laid in strips whose edges include every
//    marking edge, so longitudinal paint shares the road's own vertices
//  - junction pads: one polygon per junction with filleted kerb corners, so road surfaces never overlap
//  - kerbs (gutter apron, chamfered precast kerb blocks) and sidewalks with a cross-fall, curb returns swept around
//    every corner, lowered kerbs at driveways and crossings, storm drains, tactile paving
//  - residential lanes edged with concrete L-gutters and grates; plain asphalt edges elsewhere, never a floating sheet
// Road-local data goes to the asphalt and paint shaders per vertex (aRoad = [lateral offset, floor(10 hw) + age]).
import { clamp, lerp, smoothstep } from './core.js';

const CROWN = { main: 0.075, road: 0.055, lane: 0.035, path: 0 };
const RANK = { main: 3, road: 2, lane: 1, path: 0 };
const FADE = 10;                                         // the crown fades out over this distance before a junction
const V = (x, y, z) => [x, y, z];
const rot = d => [-d[1], d[0]];                          // (x, z) turned +90 degrees: the right-hand normal (y up)
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const norm2 = v => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
const hash = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

function polyline(R) {
  const segs = []; let s = 0;
  for (let i = 0; i + 1 < R.pts.length; i++) {
    const a = R.pts[i], b = R.pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    segs.push({ a, b, L, d: [(b[0] - a[0]) / L, (b[1] - a[1]) / L], s0: s }); s += L;
  }
  return { segs, len: s };
}
// point and (mitred) tangent at arclength s
function sampleAt(PL, s) {
  const segs = PL.segs;
  let i = segs.length - 1;
  for (let k = 0; k < segs.length; k++) if (s <= segs[k].s0 + segs[k].L + 1e-6) { i = k; break; }
  const g = segs[i], t = clamp(s - g.s0, 0, g.L);
  let d = g.d;
  if (t < 1e-4 && i > 0) d = norm2([g.d[0] + segs[i - 1].d[0], g.d[1] + segs[i - 1].d[1]]);
  else if (t > g.L - 1e-4 && i < segs.length - 1) d = norm2([g.d[0] + segs[i + 1].d[0], g.d[1] + segs[i + 1].d[1]]);
  return { x: g.a[0] + g.d[0] * t, z: g.a[1] + g.d[1] * t, d };
}
function segInter(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]], den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den, u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  if (t < -0.02 || t > 1.02 || u < -0.02 || u > 1.02) return null;
  return { p: [a[0] + r[0] * t, a[1] + r[1] * t], t, u };
}
// kerb + sidewalk profile [outward q, up v] from the carriageway edge: 30 cm gutter apron, 15 cm kerb with a chamfered
// arris, then the footway rising 1.2 % away from the road. drop (0..1) lowers it for driveways and crossings.
function kerbProfile(walk, drop) {
  const kh = lerp(0.15, 0.025, drop), top = kh + 0.01;
  return [[0, 0], [0.3, 0.004], [0.3, kh - 0.02], [0.325, kh], [0.45, kh], [0.46, top], [walk, top + walk * 0.012 * (1 - drop)], [walk, -0.12]];
}
const GUTTER = [[0, 0], [0.06, -0.018], [0.26, -0.018], [0.3, 0.0], [0.3, 0.05], [0.4, 0.05], [0.4, -0.1]];
const SKIRT = [[0, 0], [0, -0.14]];
const profileY = (pr, q) => { for (let k = 0; k + 1 < pr.length - 1; k++) { const a = pr[k], b = pr[k + 1]; if (q <= b[0] + 1e-6 && b[0] > a[0]) return lerp(a[1], b[1], clamp((q - a[0]) / (b[0] - a[0]), 0, 1)); } return pr[pr.length - 2][1]; };

// roads: [{id, kind, w, walk?, pts, mat, age?}]; baseY(x, z): road base height (a little above the ground);
// skip(x, z, R): something else builds the deck here (level crossings); noEdge(x, z, R): no kerb or gutter (bridges)
export function planRoads(roads, { baseY, skip = () => false, inBounds = () => true, noEdge = () => false, step = 2.5 }) {
  const net = roads.map(R => ({ R, PL: polyline(R), hw: R.w / 2, walk: R.walk || 0, clips: [], arms: [] }));
  const byId = new Map(net.map(n => [n.R.id, n]));
  const age = n => n.R.age ?? (n.R.kind === 'main' ? 0.12 : n.R.kind === 'road' ? 0.4 : n.R.kind === 'lane' ? 0.72 : 0.5);
  const hwAge = n => Math.floor(n.hw * 10 + 1e-3) + Math.min(age(n), 0.99);
  const edgeKind = n => n.walk > 0 ? 'walk' : n.R.kind === 'lane' || n.R.kind === 'road' ? 'gutter' : 'skirt';

  // ---- junctions: arms, clip ranges, filleted corners
  const inters = [];
  for (let i = 0; i < net.length; i++) for (let j = i + 1; j < net.length; j++) {
    const A = net[i], Bn = net[j];
    for (const sa of A.PL.segs) for (const sb of Bn.PL.segs) {
      const h = segInter(sa.a, sa.b, sb.a, sb.b); if (!h) continue;
      if (inters.some(I => I.nets.includes(A) && I.nets.includes(Bn) && Math.hypot(I.p[0] - h.p[0], I.p[1] - h.p[1]) < 1)) continue;
      inters.push({ p: h.p, roads: [A.R, Bn.R], nets: [A, Bn], s: [sa.s0 + h.t * sa.L, sb.s0 + h.u * sb.L], corners: [] });
    }
  }
  for (const I of inters) {
    const rF = Math.max(3, Math.max(I.nets[0].walk, I.nets[1].walk) + 2);
    I.rF = rF; I.arms = [];
    I.nets.forEach((n, k) => {
      const o = I.nets[1 - k], s = I.s[k], smp = sampleAt(n.PL, s), L = o.hw + o.walk + rF;
      for (const dir of [1, -1]) {
        if (dir > 0 ? s > n.PL.len - 0.5 : s < 0.5) continue;
        const arm = { I, n, dir, d: [smp.d[0] * dir, smp.d[1] * dir], h: n.hw, L, s, cornerT: {} };
        I.arms.push(arm); n.arms.push(arm);
      }
      n.clips.push([s - L, s + L]);
    });
    I.arms.sort((a, b) => Math.atan2(a.d[1], a.d[0]) - Math.atan2(b.d[1], b.d[0]));
    const c = I.p, arms = I.arms, m = arms.length;
    for (let i = 0; i < m && m > 1; i++) {
      const a = arms[i], b = arms[(i + 1) % m];
      let ang = Math.atan2(b.d[1], b.d[0]) - Math.atan2(a.d[1], a.d[0]); if (ang <= 0) ang += Math.PI * 2;
      if (ang > Math.PI * 0.94) continue;                 // straight kerb line (the through side of a T)
      const na = rot(a.d), nb = rot(b.d), phi = Math.acos(clamp(dot(a.d, b.d), -1, 1));
      const p1 = [c[0] + na[0] * a.h, c[1] + na[1] * a.h], p2 = [c[0] - nb[0] * b.h, c[1] - nb[1] * b.h];
      const den = a.d[0] * b.d[1] - a.d[1] * b.d[0]; if (Math.abs(den) < 1e-6) continue;
      const t = ((p2[0] - p1[0]) * b.d[1] - (p2[1] - p1[1]) * b.d[0]) / den;
      const C = [p1[0] + a.d[0] * t, p1[1] + a.d[1] * t];
      const td = rF / Math.tan(phi / 2), bis = norm2([a.d[0] + b.d[0], a.d[1] + b.d[1]]), oc = rF / Math.sin(phi / 2);
      const O = [C[0] + bis[0] * oc, C[1] + bis[1] * oc], T1 = [C[0] + a.d[0] * td, C[1] + a.d[1] * td], T2 = [C[0] + b.d[0] * td, C[1] + b.d[1] * td];
      const a1 = Math.atan2(T1[1] - O[1], T1[0] - O[0]), a2 = Math.atan2(T2[1] - O[1], T2[0] - O[0]);
      let da = a2 - a1; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
      const k = Math.max(6, Math.ceil(Math.abs(da) * rF / 0.5)), arc = [];
      for (let j = 0; j <= k; j++) { const aa = a1 + da * j / k; arc.push([O[0] + Math.cos(aa) * rF, O[1] + Math.sin(aa) * rF]); }
      a.cornerT[a.dir] = dot([T1[0] - c[0], T1[1] - c[1]], a.d);
      b.cornerT[-b.dir] = dot([T2[0] - c[0], T2[1] - c[1]], b.d);
      const kinds = [edgeKind(a.n), edgeKind(b.n)];
      I.corners.push({ a, b, O, rF, arc, T1, T2, walk: Math.max(a.n.walk, b.n.walk), kind: kinds.includes('walk') ? 'walk' : kinds.includes('gutter') ? 'gutter' : 'skirt' });
    }
  }
  const inClip = (n, s) => n.clips.some(([a, b]) => s > a + 1e-3 && s < b - 1e-3);
  const clipDist = (n, s) => { let m = 1e9; for (const [a, b] of n.clips) m = Math.min(m, s < a ? a - s : s > b ? s - b : 0); return m; };
  const crown = (n, s, u) => (CROWN[n.R.kind] || 0) * smoothstep(0, FADE, clipDist(n, s)) * (1 - (clamp(u, -n.hw, n.hw) / n.hw) ** 2);
  // world point on road n at arclength s, lateral u (left positive), lifted by `lift`
  const P = (n, s, u, lift = 0) => { const q = sampleAt(n.PL, s), l = rot(q.d), x = q.x + l[0] * u, z = q.z + l[1] * u; return V(x, baseY(x, z) + crown(n, s, u) + lift, z); };

  // ---- markings per kind: [centre offset, width, colour, dashed]
  const WHITE = [0.93, 0.93, 0.9], YELLOW = [0.96, 0.72, 0.12];
  const marks = n => {
    const hw = n.hw, k = n.R.kind;
    if (n.R.noMarks) return [];
    if (k === 'main') return [[0, 0.15, YELLOW, false], [hw - 0.2, 0.15, WHITE, false], [-hw + 0.2, 0.15, WHITE, false]];
    if (k === 'road') return [[0, 0.15, WHITE, true], [hw - 0.25, 0.15, WHITE, false], [-hw + 0.25, 0.15, WHITE, false]];
    if (k === 'lane') return [[hw - 0.35, 0.15, WHITE, false], [-hw + 0.35, 0.15, WHITE, false]];
    return [];
  };
  // lateral strip edges: carriageway edges, every marking edge, then filled so no strip is wider than 1.1 m
  const offsets = n => {
    const set = [-n.hw, n.hw];
    for (const [c, w] of marks(n)) set.push(c - w / 2, c + w / 2);
    set.sort((a, b) => a - b);
    const out = [];
    for (let i = 0; i < set.length; i++) {
      if (i && set[i] - set[i - 1] < 1e-3) continue;
      if (i) { const gap = set[i] - set[i - 1], m = Math.ceil(gap / 1.1); for (let k = 1; k < m; k++) out.push(set[i - 1] + gap * k / m); }
      out.push(set[i]);
    }
    return out;
  };

  // pieces: carriageway spans outside junctions, split every `step` (every metre where the crown fades)
  for (const n of net) {
    const cuts = new Set([0, n.PL.len]);
    for (let s = 0; s < n.PL.len; s += step) cuts.add(s);
    for (const g of n.PL.segs) cuts.add(g.s0);
    for (const [a, b] of n.clips) for (let k = 0; k <= FADE; k++) { if (a - k > 0 && a - k < n.PL.len) cuts.add(a - k); if (b + k > 0 && b + k < n.PL.len) cuts.add(b + k); }
    const ss = [...cuts].sort((a, b) => a - b);
    n.pieces = [];
    for (let i = 0; i + 1 < ss.length; i++) {
      const s0 = ss[i], s1 = ss[i + 1]; if (s1 - s0 < 0.02) continue;
      const sm = (s0 + s1) / 2, q = sampleAt(n.PL, sm);
      if (inClip(n, sm) || !inBounds(q.x, q.z) || skip(q.x, q.z, n.R)) continue;
      n.pieces.push([s0, s1]);
    }
  }

  // ---- spatial index for surface queries (8 m cells: road segments and corners that reach into each cell)
  const CELLSZ = 8, grid = new Map(), key = (i, j) => i * 73856093 ^ j * 19349663;
  const addBox = (x0, z0, x1, z1, item) => {
    for (let i = Math.floor(x0 / CELLSZ); i <= Math.floor(x1 / CELLSZ); i++) for (let j = Math.floor(z0 / CELLSZ); j <= Math.floor(z1 / CELLSZ); j++) {
      const k = key(i, j); let L = grid.get(k); if (!L) grid.set(k, L = []); L.push(item);
    }
  };
  for (const n of net) for (const g of n.PL.segs) { const e = n.hw + n.walk + 0.5; addBox(Math.min(g.a[0], g.b[0]) - e, Math.min(g.a[1], g.b[1]) - e, Math.max(g.a[0], g.b[0]) + e, Math.max(g.a[1], g.b[1]) + e, { n, g }); }
  for (const I of inters) for (const cr of I.corners) addBox(cr.O[0] - cr.rF, cr.O[1] - cr.rF, cr.O[0] + cr.rF, cr.O[1] + cr.rF, { cr });
  const near = (x, z) => grid.get(key(Math.floor(x / CELLSZ), Math.floor(z / CELLSZ))) || [];
  // nearest road (within its carriageway) at a point: {n, s, u}
  const roadAt = (x, z) => {
    let best = null;
    for (const it of near(x, z)) {
      if (!it.g) continue;
      const { n, g } = it, t = clamp((x - g.a[0]) * g.d[0] + (z - g.a[1]) * g.d[1], 0, g.L), px = g.a[0] + g.d[0] * t, pz = g.a[1] + g.d[1] * t, d = Math.hypot(x - px, z - pz);
      if (d < n.hw + 1e-3 && (!best || d < best.d)) { const l = rot(g.d); best = { d, n, s: g.s0 + t, u: (x - px) * l[0] + (z - pz) * l[1] }; }
    }
    return best;
  };
  const surfaceY = (x, z) => { const r = roadAt(x, z); return baseY(x, z) + (r ? crown(r.n, r.s, r.u) : 0); };
  const aRoadAt = (x, z) => { const r = roadAt(x, z); return r ? [r.u, hwAge(r.n)] : [0, 0]; };

  const RN = { net, byId, inters, RANK, P, crown, clipDist, sampleAt: (n, s) => sampleAt(n.PL, s), offsets, roadAt, surfaceY, aRoadAt, hwAge, edgeKind, cuts: [], runs: null };

  // a flat marking laid on the road surface: rectangle centred at c, long axis f (unit), half extents hl (along f) and
  // hwid (across), cut into cells so it follows crown and grade; lifted 12 mm (reversed-Z keeps that stable)
  RN.decal = (B, mat, c, f, hl, hwid, opt = {}) => {
    const cell = opt.cell || 0.6, lift = opt.lift ?? 0.012, l = rot(f), yf = opt.y || surfaceY;
    const nl = Math.max(1, Math.ceil(2 * hl / cell)), nw = Math.max(1, Math.ceil(2 * hwid / cell));
    const pt = (i, j) => { const a = -hl + 2 * hl * i / nl, b = -hwid + 2 * hwid * j / nw, x = c[0] + f[0] * a + l[0] * b, z = c[1] + f[1] * a + l[1] * b; return V(x, yf(x, z) + lift, z); };
    const uv = (i, j) => opt.uv01 ? [j / nw, i / nl] : [(c[0] + f[0] * (-hl + 2 * hl * i / nl)) / 2, (c[1] + f[1] * (-hl + 2 * hl * i / nl)) / 2 + j / nw];
    B.frame(0, 0, 0, 0);
    for (let i = 0; i < nl; i++) for (let j = 0; j < nw; j++) {
      const q = [pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1)];
      const at = opt.road === false ? undefined : { aRoad: q.map(p => aRoadAt(p[0], p[2])) };
      B.poly(mat, q, [0, 1, 0], { color: opt.color, uvs: [uv(i, j), uv(i + 1, j), uv(i + 1, j + 1), uv(i, j + 1)], attr: at });
    }
  };

  // ---- carriageways, longitudinal markings and junction pads
  RN.build = (B, { crossings = [] } = {}) => {
    B.frame(0, 0, 0, 0);
    RN.crossings = crossings;
    for (const cw of crossings) if (byId.get(cw.id).walk) for (const side of [1, -1]) RN.cuts.push({ id: cw.id, side, s0: cw.s - cw.band / 2, s1: cw.s + cw.band / 2 });
    const noPaint = (n, s) => crossings.some(c => c.id === n.R.id && Math.abs(s - c.s) < c.band / 2 + 0.4);
    for (const n of net) {
      const S = offsets(n), M = marks(n), mat = n.R.mat, ha = hwAge(n);
      if (!mat) continue;
      for (const [s0, s1] of n.pieces) {
        for (let k = S.length - 1; k > 0; k--) {
          const ua = S[k], ub = S[k - 1], pa0 = P(n, s0, ua), pa1 = P(n, s1, ua), pb1 = P(n, s1, ub), pb0 = P(n, s0, ub);
          B.quad(mat, pa0, pa1, pb1, pb0, { uvs: [pa0, pa1, pb1, pb0].map(p => [p[0] / 4, p[2] / 4]), attr: { aRoad: [[ua, ha], [ua, ha], [ub, ha], [ub, ha]], aRoadS: [[s0, 0], [s1, 0], [s1, 0], [s0, 0]] } });
        }
        const sm = (s0 + s1) / 2, cd = clipDist(n, sm);
        if (noPaint(n, sm)) continue;
        for (const [c, w, col, dash] of M) {
          if (dash && Math.floor(sm / 5) % 2) continue;
          if (c === 0 && cd < 1.2) continue;                // centre lines stop at the junction mouth
          const u0 = c + w / 2, u1 = c - w / 2;
          B.quad('paint', P(n, s0, u0, 0.012), P(n, s1, u0, 0.012), P(n, s1, u1, 0.012), P(n, s0, u1, 0.012), { color: col, attr: { aRoad: [[u0, ha], [u0, ha], [u1, ha], [u1, ha]] } });
        }
      }
      // dead ends: close the asphalt sheet with a short edge face
      for (const [sE, sgn] of [[0, -1], [n.PL.len, 1]]) {
        if (n.clips.some(([a, b]) => sE >= a - 0.5 && sE <= b + 0.5) || !n.pieces.some(([a, b]) => Math.abs(a - sE) < 0.01 || Math.abs(b - sE) < 0.01)) continue;
        for (let k = S.length - 1; k > 0; k--) {
          const pa = P(n, sE, S[k]), pb = P(n, sE, S[k - 1]), q = sampleAt(n.PL, sE);
          B.poly(mat, [pa, pb, [pb[0], pb[1] - 0.14, pb[2]], [pa[0], pa[1] - 0.14, pa[2]]], [q.d[0] * sgn, 0, q.d[1] * sgn], { attr: { aRoad: [[S[k], ha], [S[k - 1], ha], [S[k - 1], ha], [S[k], ha]] } });
        }
      }
    }
    for (const I of inters) {
      const c = I.p, pts = [], arms = I.arms, m = arms.length;
      for (let i = 0; i < m; i++) {
        const a = arms[i], n = a.n, sC = clamp(a.s + a.dir * a.L, 0, n.PL.len), S = offsets(n), us = a.dir > 0 ? S : [...S].reverse();
        for (const u of us) pts.push(P(n, sC, u));
        const cr = I.corners.find(k => k.a === a);
        if (cr) for (const q of cr.arc) pts.push(V(q[0], baseY(q[0], q[1]), q[1]));
      }
      const top = arms.reduce((best, a) => !best || RANK[a.n.R.kind] > RANK[best.n.R.kind] ? a : best, null).n;
      const ag = Math.min(...I.nets.map(age));
      // the pad is laid in rings from the centre out to its outline, every vertex on the ground's grade, so it follows
      // slopes and bridge ramps instead of spanning them with one flat fan (which let decks and terrain show through)
      const NR = 4, ring = t => pts.map(p => { if (t >= 1) return p; const x = c[0] + (p[0] - c[0]) * t, z = c[1] + (p[2] - c[1]) * t; return V(x, baseY(x, z), z); });
      const cv = V(c[0], baseY(c[0], c[1]), c[1]), rings = [];
      for (let k = 1; k <= NR; k++) rings.push(ring(k / NR));
      const uvOf = p => [p[0] / 4, p[2] / 4], at3 = { aRoad: [[0, ag], [0, ag], [0, ag]] }, at4 = { aRoad: [[0, ag], [0, ag], [0, ag], [0, ag]] };
      for (let i = 0; i < pts.length; i++) {
        const j = (i + 1) % pts.length;
        if (Math.hypot(pts[i][0] - pts[j][0], pts[i][2] - pts[j][2]) < 1e-4) continue;
        B.poly(top.R.mat, [cv, rings[0][i], rings[0][j]], [0, 1, 0], { uvs: [uvOf(cv), uvOf(rings[0][i]), uvOf(rings[0][j])], attr: at3 });
        for (let k = 1; k < NR; k++) { const a0 = rings[k - 1][i], b0 = rings[k - 1][j], a1 = rings[k][i], b1 = rings[k][j];
          B.poly(top.R.mat, [a0, a1, b1, b0], [0, 1, 0], { uvs: [uvOf(a0), uvOf(a1), uvOf(b1), uvOf(b0)], attr: at4 }); }
      }
    }
    // zebra crossings: 45 cm bars across the whole carriageway
    for (const cw of crossings) {
      const n = byId.get(cw.id), q = sampleAt(n.PL, cw.s), l = rot(q.d), nb = Math.floor((2 * n.hw - 0.7) / 0.9);
      for (let k = 0; k < nb; k++) {
        const u = -((nb - 1) * 0.9) / 2 + k * 0.9;
        RN.decal(B, 'paint', [q.x + l[0] * u, q.z + l[1] * u], q.d, cw.band / 2, 0.225, { color: [0.94, 0.94, 0.92], cell: 0.8 });
      }
    }
  };

  // stop line across the approach lane (left-hand traffic) and 止まれ written before it
  RN.stop = (B, id, s, dir, { legend = true } = {}) => {
    const n = byId.get(id), q = sampleAt(n.PL, s), t = [q.d[0] * dir, q.d[1] * dir], r = rot(t), l = [-r[0], -r[1]], full = n.hw <= 2.5;
    const u0 = full ? -n.hw + 0.25 : 0.1, u1 = n.hw - 0.25, um = (u0 + u1) / 2;
    RN.decal(B, 'paint', [q.x + l[0] * um, q.z + l[1] * um], t, 0.225, (u1 - u0) / 2, { color: [0.94, 0.94, 0.92], cell: 0.7 });
    if (legend) {
      const back = 3.2 + 0.225 + 1.6, uc = full ? 0 : (n.hw) / 2;
      RN.decal(B, 'stopLegend', [q.x - t[0] * back + l[0] * uc, q.z - t[1] * back + l[1] * uc], t, 1.6, 0.7, { uv01: true, cell: 0.8, road: false });
    }
  };

  // ---- kerbs, sidewalks, gutters and edge faces
  // runs: [n, side, s0, s1, kind] over pieces plus, at each junction arm, from the corner tangent point (or the
  // junction centre on a straight side) out to the pad edge; merged so caps only appear where an edge really ends
  const computeRuns = () => {
    const raw = [];
    for (const n of net) {
      const k0 = edgeKind(n);
      for (const [s0, s1] of n.pieces) for (const side of [1, -1]) {
        const p = P(n, (s0 + s1) / 2, side * n.hw);
        raw.push([n, side, s0, s1, noEdge(p[0], p[2], n.R) ? 'skirt' : k0]);
      }
      for (const a of n.arms) for (const side of [1, -1]) {
        const t0 = a.cornerT[side] ?? 0, t1 = a.L; if (t1 - t0 < 0.05) continue;
        let s0 = clamp(a.s + a.dir * t0, 0, n.PL.len), s1 = clamp(a.s + a.dir * t1, 0, n.PL.len); if (s0 > s1) [s0, s1] = [s1, s0];
        if (s1 - s0 < 0.05) continue;
        const sm = (s0 + s1) / 2, q = sampleAt(n.PL, sm);
        if (!inBounds(q.x, q.z) || skip(q.x, q.z, n.R)) continue;
        const p = P(n, sm, side * n.hw);
        raw.push([n, side, s0, s1, noEdge(p[0], p[2], n.R) ? 'skirt' : k0]);
      }
    }
    raw.sort((A, Bq) => A[0] === Bq[0] ? A[1] - Bq[1] || A[2] - Bq[2] : net.indexOf(A[0]) - net.indexOf(Bq[0]));
    const out = [];
    for (const r of raw) {
      const last = out[out.length - 1];
      if (last && last[0] === r[0] && last[1] === r[1] && last[4] === r[4] && r[2] <= last[3] + 0.02) last[3] = Math.max(last[3], r[3]);
      else out.push([...r]);
    }
    return out;
  };
  RN.runs = computeRuns();
  const cutAt = (n, side, s) => { let h = 0; for (const c of RN.cuts) if (c.id === n.R.id && c.side === side) h = Math.max(h, smoothstep(c.s0 - 1.2, c.s0, s) * (1 - smoothstep(c.s1, c.s1 + 1.2, s))); return h; };
  // sidewalk / kerb top at a point (null when not on one)
  RN.walkY = (x, z) => {
    for (const it of near(x, z)) {
      if (it.cr) {
        const cr = it.cr; if (cr.kind !== 'walk') continue;
        const r = Math.hypot(x - cr.O[0], z - cr.O[1]); if (r > cr.rF || r < cr.rF - cr.walk) continue;
        const aa = Math.atan2(z - cr.O[1], x - cr.O[0]), a1 = Math.atan2(cr.arc[0][1] - cr.O[1], cr.arc[0][0] - cr.O[0]), a2 = Math.atan2(cr.arc[cr.arc.length - 1][1] - cr.O[1], cr.arc[cr.arc.length - 1][0] - cr.O[0]);
        let span = a2 - a1; while (span > Math.PI) span -= 2 * Math.PI; while (span < -Math.PI) span += 2 * Math.PI;
        let rel = aa - a1; while (rel > Math.PI) rel -= 2 * Math.PI; while (rel < -Math.PI) rel += 2 * Math.PI;
        if (rel * Math.sign(span) < 0 || Math.abs(rel) > Math.abs(span)) continue;
        const e = [cr.O[0] + (x - cr.O[0]) / r * cr.rF, cr.O[1] + (z - cr.O[1]) / r * cr.rF];
        const arcL = Math.abs(span) * cr.rF, sa = Math.abs(rel) * cr.rF;
        const drop = Math.max(!cr.a.n.walk ? 1 - smoothstep(0.6, 2.2, sa) : 0, !cr.b.n.walk ? smoothstep(arcL - 2.2, arcL - 0.6, sa) : 0);
        return baseY(e[0], e[1]) + profileY(kerbProfile(cr.walk, drop), cr.rF - r);
      }
      const { n, g } = it; if (!n.walk) continue;
      const t = clamp((x - g.a[0]) * g.d[0] + (z - g.a[1]) * g.d[1], 0, g.L), l = rot(g.d), u = (x - g.a[0] - g.d[0] * t) * l[0] + (z - g.a[1] - g.d[1] * t) * l[1];
      const au = Math.abs(u), side = Math.sign(u), s = g.s0 + t;
      if (au < n.hw || au > n.hw + n.walk) continue;
      if (!RN.runs.some(r => r[0] === n && r[1] === side && r[4] === 'walk' && s >= r[2] && s <= r[3])) continue;
      return baseY(x, z) + profileY(kerbProfile(n.walk, cutAt(n, side, s)), au - n.hw);
    }
    return null;
  };
  RN.topY = (x, z, fallback) => { const w = RN.walkY(x, z); if (w !== null) return w; const r = roadAt(x, z); if (r) return baseY(x, z) + crown(r.n, r.s, r.u); return fallback(x, z); };

  RN.buildEdges = (B, { tactile = () => false } = {}) => {
    B.frame(0, 0, 0, 0);
    const KERB = [0.86, 0.86, 0.83], GUT = [0.8, 0.8, 0.77], WALK = [0.9, 0.89, 0.86], BACK = [0.62, 0.62, 0.6];
    const matOf = (kind, k, pr) => kind === 'walk' ? (k === 5 ? 'pavement' : k === pr.length - 2 ? 'plain' : 'concrete') : kind === 'gutter' ? 'concrete' : 'asphalt';
    // one profile ring swept between two cross-sections A (at s0) and Bs (at s1); frames give [point(q), outward dir]
    const sweepSeg = (kind, prA, prB, fa, fb, alongA, alongB, jitter, n) => {
      let acc = 0;
      for (let k = 0; k + 1 < prA.length; k++) {
        const qa0 = prA[k], qa1 = prA[k + 1], qb0 = prB[k], qb1 = prB[k + 1];
        const du = qa1[0] - qa0[0], dv = qa1[1] - qa0[1], pl = Math.hypot(du, dv);
        const hn = Math.abs(dv) > Math.abs(du) ? [fa.o[0] * -Math.sign(dv), 0, fa.o[1] * -Math.sign(dv)] : [0, 1, 0];
        const hint = k === prA.length - 2 ? [fa.o[0], 0, fa.o[1]] : hn;
        const mat = matOf(kind, k, prA), isWalk = mat === 'pavement';
        let col = kind === 'walk' ? (k === 0 ? GUT : isWalk ? WALK : k === prA.length - 2 ? BACK : KERB) : kind === 'gutter' ? [0.78, 0.78, 0.75] : [1, 1, 1];
        if (k >= 1 && k <= 4 && kind === 'walk') col = shade(col, 0.93 + 0.12 * jitter);
        const sc = isWalk ? 1.2 : 1.5;
        const uvs = isWalk ? [[alongA / sc, qa0[0] / sc], [alongB / sc, qb0[0] / sc], [alongB / sc, qb1[0] / sc], [alongA / sc, qa1[0] / sc]]
          : [[alongA / sc, acc / sc], [alongB / sc, acc / sc], [alongB / sc, (acc + pl) / sc], [alongA / sc, (acc + pl) / sc]];
        const opt = { color: col, uvs };
        if (isWalk) opt.attr = { aPave: [[alongA, qa0[0]], [alongB, qb0[0]], [alongB, qb1[0]], [alongA, qa1[0]]] };
        if (mat === 'asphalt') opt.attr = { aRoad: [0, 0, 0, 0].map(() => [n ? n.hw : 0, n ? hwAge(n) : 0]) };
        B.poly(mat, [fa.at(qa0), fb.at(qb0), fb.at(qb1), fa.at(qa1)], hint, opt);
        acc += pl;
      }
    };
    // end cap: the profile closed down to its base, facing `dir`
    const cap = (kind, pr, f, dir) => {
      const base = Math.min(...pr.map(q => q[1]));
      for (let k = 0; k + 1 < pr.length; k++) {
        const a = pr[k], b = pr[k + 1]; if (b[0] - a[0] < 1e-4) continue;
        B.poly(kind === 'walk' ? 'concrete' : kind === 'gutter' ? 'concrete' : 'asphalt', [f.at([a[0], base]), f.at([b[0], base]), f.at(b), f.at(a)], [dir[0], 0, dir[1]], { color: kind === 'skirt' ? [1, 1, 1] : [0.8, 0.8, 0.77] });
      }
    };
    const profOf = (kind, walk, drop) => kind === 'walk' ? kerbProfile(walk, drop) : kind === 'gutter' ? GUTTER : SKIRT;
    for (const [n, side, sa, sb, kind] of RN.runs) {
      const frame = s => {
        const q = sampleAt(n.PL, s), l = rot(q.d), o = [l[0] * side, l[1] * side];
        return { o, t: q.d, at: pq => { const u = side * (n.hw + pq[0]), x = q.x + l[0] * u, z = q.z + l[1] * u; return V(x, baseY(x, z) + pq[1], z); } };
      };
      const sub = kind === 'skirt' ? 2.5 : 1;
      const ss = []; for (let s = sa; s < sb - 1e-3; s = Math.min(sb, (Math.floor(s / sub + 1e-6) + 1) * sub)) ss.push(s); ss.push(sb);
      for (let i = 0; i + 1 < ss.length; i++) {
        const s0 = ss[i], s1 = ss[i + 1], sm = (s0 + s1) / 2;
        const prA = profOf(kind, n.walk, cutAt(n, side, s0)), prB = profOf(kind, n.walk, cutAt(n, side, s1));
        sweepSeg(kind, prA, prB, frame(s0), frame(s1), s0, s1, hash(Math.floor(sm), side + n.hw), n);
        // storm drains in the gutter apron (walk), grates in the L-gutter (lanes)
        if (kind === 'walk' && Math.floor(s0 / 22) !== Math.floor(s1 / 22) && cutAt(n, side, sm) < 0.1) B.detail(2, () => {
          const f = frame(sm), g = f.at([0.15, 0.003]);
          B.frame(g[0], g[1], g[2], Math.atan2(f.t[0], f.t[1]));
          B.box('dark', 0, -0.004, 0, 0.36, 0.006, 0.66, { color: [0.12, 0.12, 0.12] });
          B.box('metal', 0, 0.0, -0.315, 0.36, 0.005, 0.03, { color: [0.3, 0.29, 0.28] }); B.box('metal', 0, 0.0, 0.315, 0.36, 0.005, 0.03, { color: [0.3, 0.29, 0.28] });
          for (let k = -3; k <= 3; k++) B.box('metal', 0, 0.0, k * 0.085, 0.36, 0.005, 0.028, { color: [0.3, 0.29, 0.28] });
          B.frame(0, 0, 0, 0);
        }); else if (kind === 'gutter' && Math.floor(s0 / 6) !== Math.floor(s1 / 6)) B.detail(2, () => {
          const f = frame(sm), g = f.at([0.16, -0.018]);
          B.frame(g[0], g[1], g[2], Math.atan2(f.t[0], f.t[1]));
          B.box('dark', 0, -0.002, 0, 0.2, 0.004, 0.48, { color: [0.1, 0.1, 0.1] });
          for (let k = -2; k <= 2; k++) B.box('metal', 0, 0.0, k * 0.09, 0.22, 0.004, 0.028, { color: [0.32, 0.31, 0.3] });
          B.box('metal', -0.105, 0.0, 0, 0.02, 0.004, 0.5, { color: [0.32, 0.31, 0.3] }); B.box('metal', 0.105, 0.0, 0, 0.02, 0.004, 0.5, { color: [0.32, 0.31, 0.3] });
          B.frame(0, 0, 0, 0);
        });
        // tactile guide line on main-road sidewalks: yellow bar blocks 30 cm wide, 5 mm proud of the paving
        if (kind === 'walk' && tactile(n, frame(s0).at([0, 0]))) {
          const qc = n.walk * 0.64, fa = frame(s0), fb = frame(s1), pa = prA, pb = prB;
          const at = (f, pr, q) => { const p = f.at([q, profileY(pr, q) + 0.005]); return p; };
          const a0 = at(fa, pa, qc - 0.15), a1 = at(fa, pa, qc + 0.15), b0 = at(fb, pb, qc - 0.15), b1 = at(fb, pb, qc + 0.15);
          B.poly('tactileL', [a0, b0, b1, a1], [0, 1, 0], { uvs: [[s0 / 0.3, 0], [s1 / 0.3, 0], [s1 / 0.3, 1], [s0 / 0.3, 1]] });
        }
      }
      // caps where the run ends
      const fa = frame(sa), fb = frame(sb);
      cap(kind, profOf(kind, n.walk, cutAt(n, side, sa)), fa, [-fa.t[0], -fa.t[1]]);
      cap(kind, profOf(kind, n.walk, cutAt(n, side, sb)), fb, [fb.t[0], fb.t[1]]);
    }
    // curb returns: the edge profile swept around each fillet (toward the block)
    for (const I of inters) for (const cr of I.corners) {
      const pr = profOf(cr.kind, cr.walk, 0), k = cr.arc.length - 1;
      const dropA = cr.kind === 'walk' && !cr.a.n.walk, dropB = cr.kind === 'walk' && !cr.b.n.walk;
      const frame = j => {
        const p = cr.arc[j], inw = [(cr.O[0] - p[0]) / cr.rF, (cr.O[1] - p[1]) / cr.rF];
        return { o: inw, at: q => { const x = p[0] + inw[0] * q[0], z = p[1] + inw[1] * q[0]; return V(x, baseY(p[0], p[1]) + q[1], z); } };
      };
      const segLen = Math.hypot(cr.arc[1][0] - cr.arc[0][0], cr.arc[1][1] - cr.arc[0][1]);
      const arcL = k * segLen, dropAt = j => { const s = j * segLen; return cr.kind !== 'walk' ? 0 : Math.max(dropA ? 1 - smoothstep(0.6, 2.2, s) : 0, dropB ? smoothstep(arcL - 2.2, arcL - 0.6, s) : 0); };
      const prJ = j => profOf(cr.kind, cr.walk, dropAt(j));
      for (let j = 0; j < k; j++) sweepSeg(cr.kind, prJ(j), prJ(j + 1), frame(j), frame(j + 1), j * segLen, (j + 1) * segLen, hash(j, cr.O[0]), cr.a.n);
      const f0 = frame(0), fk = frame(k), t0 = norm2([cr.arc[0][0] - cr.arc[1][0], cr.arc[0][1] - cr.arc[1][1]]), tk = norm2([cr.arc[k][0] - cr.arc[k - 1][0], cr.arc[k][1] - cr.arc[k - 1][1]]);
      cap(cr.kind, prJ(0), f0, t0); cap(cr.kind, prJ(k), fk, tk);
    }
    // warning blocks (dots) where crossings meet a lowered kerb
    for (const cw of RN.crossings || []) {
      const n = byId.get(cw.id); if (!n.walk) continue;
      for (const side of [1, -1]) for (let s = cw.s - cw.band / 2; s < cw.s + cw.band / 2 - 1e-3; s += 0.3) {
        const s1 = Math.min(s + 0.3, cw.s + cw.band / 2), f = sq => { const q = sampleAt(n.PL, sq), l = rot(q.d); return pq => { const u = side * (n.hw + pq[0]), x = q.x + l[0] * u, z = q.z + l[1] * u; return V(x, baseY(x, z) + pq[1], z); }; };
        const pa = kerbProfile(n.walk, cutAt(n, side, s)), pb = kerbProfile(n.walk, cutAt(n, side, s1));
        const A = f(s), Bq = f(s1), q0 = 0.5, q1 = 1.1;
        B.poly('tactileD', [A([q0, profileY(pa, q0) + 0.005]), Bq([q0, profileY(pb, q0) + 0.005]), Bq([q1, profileY(pb, q1) + 0.005]), A([q1, profileY(pa, q1) + 0.005])], [0, 1, 0],
          { uvs: [[0, 0], [1, 0], [1, 2], [0, 2]] });
      }
    }
  };
  return RN;
}
