// Sakuragawa road network. Everything is built from one surface description, so whatever lies on the asphalt
// (markings, stop lines, zebra crossings, manholes, cars) sits exactly on it and needs no depth tricks:
//  - carriageways with a crown (camber) that flattens toward junctions, laid in strips whose edges include every
//    marking edge, so longitudinal paint shares the road's own vertices
//  - junction pads: one polygon per junction with filleted kerb corners, so road surfaces never overlap
//  - kerbs (gutter apron, chamfered precast kerb blocks) swept along every footway and around every corner, lowered at
//    driveways and crossings, storm drains, tactile paving; the footways behind them are one paved area (footways.js)
//  - residential lanes edged with concrete L-gutters and grates; plain asphalt edges elsewhere, never a floating sheet
// Road-local data goes to the asphalt and paint shaders per vertex (aRoad = [lateral offset, floor(10 hw) + age]).
import { clamp, lerp, smoothstep } from './core.js';
import { kerbProfile, profileY, planFootways } from './footways.js';

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
  // tolerance in metres, not a fraction of the segment: a 2 % overshoot on a 600 m straight reached 12 m past a road's
  // end and built a phantom junction (with its asphalt pad) out in the fields
  const et = 0.6 / Math.hypot(r[0], r[1]), eu = 0.6 / Math.hypot(s[0], s[1]);
  if (t < -et || t > 1 + et || u < -eu || u > 1 + eu) return null;
  return { p: [a[0] + r[0] * t, a[1] + r[1] * t], t, u };
}
// A road's centreline with its bends rounded: every vertex where the line turns is replaced by a circular arc (sampled
// every `step` m) tangent to both straights, so the carriageway, its kerbs and footways sweep round the bend instead of
// folding at it. The radius is the road's design radius, reduced where the straights are too short to hold the arc
// (neighbouring arcs never overlap) and where the arc would pull the road more than maxDev off its corner point (the
// buildings and paths beside it were planned against the original line).
// keep: [[x, z, r]] — the road stays straight within r of these points (its junctions: a curb return needs straight
// kerbs to meet)
export function filletPolyline(pts, { radius = 40, maxDev = 1.2, step = 2.5, keep = [] } = {}) {
  const n = pts.length; if (n < 3) return pts.map(p => p.slice());
  const L = [], D = [];
  for (let i = 0; i + 1 < n; i++) { const dx = pts[i + 1][0] - pts[i][0], dz = pts[i + 1][1] - pts[i][1], l = Math.hypot(dx, dz) || 1e-9; L.push(l); D.push([dx / l, dz / l]); }
  const T = new Array(n).fill(0), TH = new Array(n).fill(0);
  for (let i = 1; i + 1 < n; i++) {
    const th = Math.acos(clamp(dot(D[i - 1], D[i]), -1, 1)); if (th < 0.006) continue;
    const R = Math.min(radius, maxDev / (1 / Math.cos(th / 2) - 1));
    let t = Math.min(R * Math.tan(th / 2), (i === 1 ? 0.4 : 0.5) * L[i - 1], (i + 2 === n ? 0.4 : 0.5) * L[i]); // (a road's end segments stay mostly straight: they run into junctions)
    const inKeep = (x, z) => keep.some(([kx, kz, kr]) => Math.hypot(x - kx, z - kz) < kr);
    if (inKeep(pts[i][0], pts[i][1])) continue;
    while (t > 0.3 && (inKeep(pts[i][0] - D[i - 1][0] * t, pts[i][1] - D[i - 1][1] * t) || inKeep(pts[i][0] + D[i][0] * t, pts[i][1] + D[i][1] * t))) t *= 0.85;
    if (t <= 0.3) continue;
    T[i] = t; TH[i] = th;
  }
  const out = [pts[0].slice()];
  for (let i = 1; i + 1 < n; i++) {
    if (!T[i]) { out.push(pts[i].slice()); continue; }
    const p = pts[i], a = D[i - 1], b = D[i], t = T[i], th = TH[i], R = t / Math.tan(th / 2), side = Math.sign(a[0] * b[1] - a[1] * b[0]) || 1;
    const A = [p[0] - a[0] * t, p[1] - a[1] * t], nA = [-a[1] * side, a[0] * side], C = [A[0] + nA[0] * R, A[1] + nA[1] * R];
    const a0 = Math.atan2(A[1] - C[1], A[0] - C[0]), k = Math.max(2, Math.ceil(th * R / step), Math.ceil(th / 0.05));
    for (let j = 0; j <= k; j++) { const aa = a0 + side * th * j / k; out.push([C[0] + Math.cos(aa) * R, C[1] + Math.sin(aa) * R]); }
  }
  out.push(pts[n - 1].slice());
  return out.filter((q, i) => i === 0 || Math.hypot(q[0] - out[i - 1][0], q[1] - out[i - 1][1]) > 0.05);
}
// kerb + sidewalk profile [outward q, up v] from the carriageway edge (footways.js kerbProfile): 30 cm gutter apron, 15 cm
// kerb with a chamfered arris, then the footway rising 1.2 % away from the road; drop lowers it for driveways, crossings
// and level-crossing landings. Here only its kerb strip (q < KERB_IN) is swept: the footway is laid by footways.js.
const _kp = Array.from({ length: 9 }, () => [0, 0]);
// concrete L-gutter; drop above 1 flattens it into a flush concrete shoulder
const GUTTER = [[0, 0], [0.06, -0.018], [0.26, -0.018], [0.3, 0.0], [0.3, 0.05], [0.4, 0.05], [0.4, -0.1]];
const gutterProfile = drop => { const f = clamp(drop - 1, 0, 1); return f <= 0 ? GUTTER : GUTTER.map(([q, v], i) => [q, i === GUTTER.length - 1 ? v : v * (1 - f)]); };
const SKIRT = [[0, 0], [0, -0.14]];

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
    // (each arm is the straight line of its road where the curb return meets it — at the end of the junction, a road
    // that bends or kinks at the crossing point included: the corner's tangent points then lie exactly on the kerb line
    // the straight footway runs along, instead of on a line through the crossing point that the road no longer follows)
    I.nets.forEach((n, k) => {
      const o = I.nets[1 - k], s = I.s[k], L = o.hw + o.walk + rF;
      for (const dir of [1, -1]) {
        if (dir > 0 ? s > n.PL.len - 0.5 : s < 0.5) continue;
        const sQ = clamp(s + dir * L, 0, n.PL.len), Lm = Math.abs(sQ - s), q = sampleAt(n.PL, sQ), d = [q.d[0] * dir, q.d[1] * dir];
        const tQ = (q.x - I.p[0]) * d[0] + (q.z - I.p[1]) * d[1], base = [q.x - d[0] * tQ, q.z - d[1] * tQ];
        const arm = { I, n, dir, d, base, Lm, tQ, h: n.hw, L, s, cornerT: {} };
        I.arms.push(arm); n.arms.push(arm);
      }
      n.clips.push([s - L, s + L]); (I.clipIx = I.clipIx || []).push([n, n.clips.length - 1]);
    });
    I.arms.sort((a, b) => Math.atan2(a.d[1], a.d[0]) - Math.atan2(b.d[1], b.d[0]));
    const c = I.p, arms = I.arms, m = arms.length;
    // an arm's straight line as the road runs at distance t from the crossing point: { d, base, Lm, tQ }
    // (its direction from a chord across a metre and a half either side: a road's bends are polylines, and a direction that
    // jumps from segment to segment made the corner's tangent point swing between two places)
    const frameAt = (a, t) => { const n = a.n, sQ = clamp(a.s + a.dir * t, 0, n.PL.len), q = sampleAt(n.PL, sQ), qa = sampleAt(n.PL, clamp(sQ - 1.5, 0, n.PL.len)), qb = sampleAt(n.PL, clamp(sQ + 1.5, 0, n.PL.len));
      const cd = norm2([qb.x - qa.x, qb.z - qa.z]), d = t > a.L - 0.05 ? [cd[0] * a.dir, cd[1] * a.dir] : [q.d[0] * a.dir, q.d[1] * a.dir];
      const tQ = (q.x - c[0]) * d[0] + (q.z - c[1]) * d[1]; return { d, base: [q.x - d[0] * tQ, q.z - d[1] * tQ], Lm: Math.abs(sQ - a.s), tQ }; };
    for (let i = 0; i < m && m > 1; i++) {
      const a = arms[i], b = arms[(i + 1) % m];
      let ang = Math.atan2(b.d[1], b.d[0]) - Math.atan2(a.d[1], a.d[0]); if (ang <= 0) ang += Math.PI * 2;
      if (ang > Math.PI * 0.94) continue;                 // straight kerb line (the through side of a T)
      // The fillet is laid between the two kerb lines as the roads run where it meets them: first from the arms' lines at
      // the end of the junction; where a tangent point falls further out on a road that curves (a corner wider than the
      // junction), the fillet is laid again against that road's line at the tangent point, until it sits on the kerb
      // (otherwise the curb return started off the road's kerb line and left a step or a gap where they should meet)
      let fa = frameAt(a, a.L), fb = frameAt(b, b.L), F = null;
      for (let it = 0; it < 24; it++) {
        const na = rot(fa.d), nb = rot(fb.d), phi = Math.acos(clamp(dot(fa.d, fb.d), -1, 1));
        const p1 = [fa.base[0] + na[0] * a.h, fa.base[1] + na[1] * a.h], p2 = [fb.base[0] - nb[0] * b.h, fb.base[1] - nb[1] * b.h];
        const den = fa.d[0] * fb.d[1] - fa.d[1] * fb.d[0]; if (Math.abs(den) < 1e-6) { F = null; break; }
        const t = ((p2[0] - p1[0]) * fb.d[1] - (p2[1] - p1[1]) * fb.d[0]) / den;
        const C = [p1[0] + fa.d[0] * t, p1[1] + fa.d[1] * t];
        const td = rF / Math.tan(phi / 2), bis = norm2([fa.d[0] + fb.d[0], fa.d[1] + fb.d[1]]), oc = rF / Math.sin(phi / 2);
        const O = [C[0] + bis[0] * oc, C[1] + bis[1] * oc], T1 = [C[0] + fa.d[0] * td, C[1] + fa.d[1] * td], T2 = [C[0] + fb.d[0] * td, C[1] + fb.d[1] * td];
        const tA = fa.Lm - fa.tQ + dot([T1[0] - fa.base[0], T1[1] - fa.base[1]], fa.d), tB = fb.Lm - fb.tQ + dot([T2[0] - fb.base[0], T2[1] - fb.base[1]], fb.d);
        F = { O, T1, T2, tA, tB };
        // (each arm's line taken again where the tangent point now lies along its road, nearer or further)
        // (damped: on a road that curves round the corner the plain fixed point can swing between two solutions)
        const ra = Math.abs(tA - fa.Lm) > 0.02 && tA > 0.5 ? frameAt(a, it < 2 ? tA : (fa.Lm + tA) / 2) : fa, rb = Math.abs(tB - fb.Lm) > 0.02 && tB > 0.5 ? frameAt(b, it < 2 ? tB : (fb.Lm + tB) / 2) : fb;
        if (ra === fa && rb === fb) break;
        fa = ra; fb = rb;
      }
      if (!F) continue;
      const { O, T1, T2 } = F;
      const a1 = Math.atan2(T1[1] - O[1], T1[0] - O[0]), a2 = Math.atan2(T2[1] - O[1], T2[0] - O[0]);
      let da = a2 - a1; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
      const k = Math.max(6, Math.ceil(Math.abs(da) * rF / 0.5)), arc = [];
      for (let j = 0; j <= k; j++) { const aa = a1 + da * j / k; arc.push([O[0] + Math.cos(aa) * rF, O[1] + Math.sin(aa) * rF]); }
      // (the tangent point's distance along the road from the crossing point: where it projects onto the road itself)
      const along = (arm, T, t0) => { let best = null; for (const g of arm.n.PL.segs) { const tt = clamp((T[0] - g.a[0]) * g.d[0] + (T[1] - g.a[1]) * g.d[1], 0, g.L), d = Math.hypot(T[0] - g.a[0] - g.d[0] * tt, T[1] - g.a[1] - g.d[1] * tt), sv = g.s0 + tt;
        if (Math.abs(Math.abs(sv - arm.s) - t0) < 6 && (!best || d < best.d)) best = { d, t: Math.abs(sv - arm.s) }; } return best ? best.t : t0; };
      a.cornerT[a.dir] = along(a, T1, F.tA);
      b.cornerT[-b.dir] = along(b, T2, F.tB);
      const kinds = [edgeKind(a.n), edgeKind(b.n)];
      I.corners.push({ a, b, O, rF, arc, T1, T2, walk: Math.max(a.n.walk, b.n.walk), kind: kinds.includes('walk') ? 'walk' : kinds.includes('gutter') ? 'gutter' : 'skirt' });
    }
    // a corner whose tangent point lies further out than the junction's end (a skewed junction, a road bending away)
    // carries the junction's pad out to it: the carriageway stops there, and pad and carriageway never lie one over
    // the other (two asphalt sheets at one height flickered against each other)
    for (const a of arms) { const t = Math.max(a.L, ...Object.values(a.cornerT)); if (t > a.L + 0.02) a.L = t; }
    for (const [n, ix] of I.clipIx || []) { const k = I.nets.indexOf(n), s = I.s[k], lo = arms.find(a => a.n === n && a.dir < 0), hi = arms.find(a => a.n === n && a.dir > 0);
      n.clips[ix] = [s - (lo ? lo.L : n.clips[ix][1] - s), s + (hi ? hi.L : s - n.clips[ix][0])]; }
  }
  // ---- the pedestrian network: footway spans per road side, n.ws[side] = [[s0, s1, width]]
  // Roads with footways carry them along their whole length. Where a footway comes round a corner onto a street without
  // one it does not stop at the end of the curb return: it follows the turn and runs on along that lane (or alley) far
  // enough to clear the junction — past the stop line, to where the lane's own pedestrian shoulder takes over — and ends
  // there on purpose: the kerb eases down flush with the road and a band of warning tiles marks the end. If the next
  // junction or the lane's end is close, it runs on to it rather than leave a short gap. Paths and tracks get no
  // footway (the corner lowers onto them). A footway also ends flush, with its tiles, at a road's free end.
  const CONT = 9;
  const baseKind = n => n.R.kind === 'lane' || n.R.kind === 'road' ? 'gutter' : 'skirt';
  for (const n of net) { n.ws = { 1: n.walk ? [[0, n.PL.len, n.walk]] : [], [-1]: n.walk ? [[0, n.PL.len, n.walk]] : [] }; n.ends = []; }
  const wsAt = (n, side, s) => { let w = 0; const L = n.ws[side]; if (L) for (const q of L) if (s >= q[0] - 1e-6 && s <= q[1] + 1e-6) w = Math.max(w, q[2]); return w; };
  for (const I of inters) for (const cr of I.corners) {
    const sides = [[cr.a, cr.a.dir], [cr.b, -cr.b.dir]], wMax = Math.max(cr.a.n.walk, cr.b.n.walk);
    if (!wMax) continue;
    for (const [arm, side] of sides) {
      const n = arm.n; if (n.walk || n.R.kind === 'path') continue;
      const dir = arm.dir, t0 = arm.cornerT[side] ?? 0;
      let reach = arm.L + (n.R.noMarks ? CONT * 0.6 : CONT), limit = dir > 0 ? n.PL.len - arm.s : arm.s;
      for (const [ca, cb] of n.clips) { const d = dir > 0 ? ca - arm.s : arm.s - cb; if (d > arm.L + 0.5 && d < limit) limit = d; }
      if (limit - reach < 8) reach = limit;                                                   // on to the next junction / the end
      const sA = arm.s + dir * t0; let sB = arm.s + dir * reach;
      // (an end beside a bend of the lane's line falls where the whole outer wedge of the bend has one distance along the
      // road, and could not be cut square — its edge came out in steps: it ends clear of the bend instead)
      if (reach < limit) for (let i = 1; i < n.PL.segs.length; i++) { const g = n.PL.segs[i], gp = n.PL.segs[i - 1], sv = g.s0, clr = wMax + 0.8;
        if (Math.abs(gp.d[0] * g.d[1] - gp.d[1] * g.d[0]) < 0.03 || Math.abs(sB - sv) >= clr) continue;
        const back = sv - dir * clr; sB = Math.abs(back - arm.s) > arm.L + 2 ? back : sv + dir * clr; }
      n.ws[side].push([Math.min(sA, sB), Math.max(sA, sB), wMax]);
      n.ends.push({ side, s: sB, dir });
    }
  }
  // free ends of roads with footways (also where the road runs on only as a gravel path or track)
  for (const n of net) if (n.walk) for (const [sE, dir] of [[0, -1], [n.PL.len, 1]]) {
    const q = sampleAt(n.PL, sE); if (!inBounds(q.x, q.z)) continue;
    const I = inters.find(J => J.nets.includes(n) && Math.abs(J.s[J.nets.indexOf(n)] - sE) < 0.6);
    if (!I || I.nets.find(o => o !== n).R.kind === 'path') for (const side of [1, -1]) n.ends.push({ side, s: sE, dir });
  }
  for (const n of net) for (const side of [1, -1]) { // merge overlapping spans (the wider wins)
    const L = n.ws[side].sort((p, q) => p[0] - q[0]), out = [];
    for (const sp of L) { const last = out[out.length - 1]; if (last && sp[0] <= last[1] + 0.05 && Math.abs(sp[2] - last[2]) < 1e-3) last[1] = Math.max(last[1], sp[1]); else out.push([...sp]); }
    n.ws[side] = out;
    n.ends = n.ends.filter(e => !n.ws[e.side].some(([a, b]) => e.s > a + 0.5 && e.s < b - 0.5)); // (an end swallowed by another span)
  }
  // corner kinds from the spans: a curb return is a footway wherever either of its roads has one there
  for (const I of inters) for (const cr of I.corners) {
    const wA = wsAt(cr.a.n, cr.a.dir, cr.a.s + cr.a.dir * ((cr.a.cornerT[cr.a.dir] ?? 0) + 0.05)), wB = wsAt(cr.b.n, -cr.b.dir, cr.b.s + cr.b.dir * ((cr.b.cornerT[-cr.b.dir] ?? 0) + 0.05));
    if (wA || wB) { cr.kind = 'walk'; cr.walk = Math.max(wA, wB); cr.dropA = !wA; cr.dropB = !wB; }
    else { cr.dropA = cr.dropB = false; }
  }
  const inClip = (n, s) => n.clips.some(([a, b]) => s > a + 1e-3 && s < b - 1e-3);
  const clipDist = (n, s) => { let m = 1e9; for (const c of n.clips) m = Math.min(m, s < c[0] ? c[0] - s : s > c[1] ? s - c[1] : 0); if (n.flats) for (const c of n.flats) m = Math.min(m, s < c[0] ? c[0] - s : s > c[1] ? s - c[1] : 0); return m; };
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
    for (const side of [1, -1]) for (const [a, b] of n.ws[side]) for (const e of [a, b]) if (e > 0.01 && e < n.PL.len - 0.01) cuts.add(e); // footway span ends
    // the carriageway ends exactly where something else takes over (a level-crossing deck): find each edge of the
    // skipped stretch to a centimetre, so the asphalt meets the deck instead of stopping short on a step grid
    { const sk = s => { const q = sampleAt(n.PL, s); return skip(q.x, q.z, n.R); };
      let prev = sk(0);
      for (let s = 0.25; s <= n.PL.len; s += 0.25) { const cur = sk(s); if (cur !== prev) { let a = s - 0.25, b = s; for (let k = 0; k < 12; k++) { const m = (a + b) / 2; if (sk(m) === prev) a = m; else b = m; } cuts.add((a + b) / 2); } prev = cur; } }
    // the skipped stretches (level-crossing decks) are flat: the crown fades out toward them like toward a junction
    n.flats = [];
    { let a0 = null; const sk = s => { const q = sampleAt(n.PL, s); return skip(q.x, q.z, n.R); };
      const edges = [...cuts].sort((a, b) => a - b);
      for (let i = 0; i + 1 < edges.length; i++) { const m = (edges[i] + edges[i + 1]) / 2, on = sk(m);
        if (on && a0 === null) a0 = edges[i]; if (!on && a0 !== null) { n.flats.push([a0, edges[i]]); a0 = null; } }
      if (a0 !== null) n.flats.push([a0, n.PL.len]); }
    for (const [a, b] of n.flats) for (let k = 0; k <= FADE; k++) { if (a - k > 0) cuts.add(a - k); if (b + k < n.PL.len) cuts.add(b + k); }
    // (cuts closer than 2 cm merge into one — the exact ones kept: the road's ends, the junction clips, the edges of the
    // skipped stretches; a sliver piece dropped instead left a crack across the whole road, the ground showing through)
    const hard = new Set([0, n.PL.len, ...n.clips.flat(), ...n.flats.flat()]), ss = [];
    for (const c of [...cuts].sort((a, b) => a - b)) {
      const L = ss.length ? ss[ss.length - 1] : -1;
      if (ss.length && c - L < 0.02) { if (hard.has(c) && !hard.has(L)) ss[ss.length - 1] = c; continue; }
      ss.push(c);
    }
    n.pieces = [];
    for (let i = 0; i + 1 < ss.length; i++) {
      const s0 = ss[i], s1 = ss[i + 1];
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
  for (const n of net) for (const g of n.PL.segs) { const e = n.hw + Math.max(n.walk, ...n.ws[1].map(q => q[2]), ...n.ws[-1].map(q => q[2]), 0) + 0.5; addBox(Math.min(g.a[0], g.b[0]) - e, Math.min(g.a[1], g.b[1]) - e, Math.max(g.a[0], g.b[0]) + e, Math.max(g.a[1], g.b[1]) + e, { n, g }); }
  for (const I of inters) for (const cr of I.corners) addBox(cr.O[0] - cr.rF, cr.O[1] - cr.rF, cr.O[0] + cr.rF, cr.O[1] + cr.rF, { cr });
  const NONE = [], near = (x, z) => grid.get(key(Math.floor(x / CELLSZ), Math.floor(z / CELLSZ))) || NONE;
  // nearest road (within its carriageway) at a point: {n, s, u} — one reused result, valid until the next call
  const _ra = { d: 0, n: null, s: 0, u: 0 };
  const roadAt = (x, z) => {
    let best = null;
    for (const it of near(x, z)) {
      if (!it.g) continue;
      const { n, g } = it, t = clamp((x - g.a[0]) * g.d[0] + (z - g.a[1]) * g.d[1], 0, g.L), px = g.a[0] + g.d[0] * t, pz = g.a[1] + g.d[1] * t, ex = x - px, ez = z - pz, d = Math.sqrt(ex * ex + ez * ez);
      if (d < n.hw + 1e-3 && (!best || d < best.d)) { best = _ra; best.d = d; best.n = n; best.s = g.s0 + t; best.u = ex * -g.d[1] + ez * g.d[0]; }
    }
    return best;
  };
  const surfaceY = (x, z) => { const r = roadAt(x, z); return baseY(x, z) + (r ? crown(r.n, r.s, r.u) : 0); };
  const aRoadAt = (x, z) => { const r = roadAt(x, z); return r ? [r.u, hwAge(r.n)] : [0, 0]; };

  const RN = { net, byId, inters, RANK, P, crown, clipDist, sampleAt: (n, s) => sampleAt(n.PL, s), offsets, marks, roadAt, surfaceY, aRoadAt, hwAge, edgeKind, cuts: [], runs: null, walkAt: wsAt };
  // footway ends: the kerb eases down to flush over the last few metres (and the gutter beyond lies flush to meet it)
  for (const n of net) for (const e of n.ends) RN.cuts.push({ id: n.R.id, side: e.side, s0: Math.min(e.s - e.dir * 0.3, e.s + e.dir * 1.6), s1: Math.max(e.s - e.dir * 0.3, e.s + e.dir * 1.6), flush: true, ramp: 2.6 });

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
    for (const cw of crossings) if (byId.get(cw.id).walk) for (const side of [1, -1]) RN.cuts.push({ id: cw.id, side, s0: cw.s - cw.band / 2, s1: cw.s + cw.band / 2, xing: true });
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
        else if (m > 1) { // a straight side: where the road kinks at the junction, the pad reaches out to the kink of its kerb lines
          const b = arms[(i + 1) % m], na = rot(a.d), nb = rot(b.d), p1 = [a.base[0] + na[0] * a.h, a.base[1] + na[1] * a.h], p2 = [b.base[0] - nb[0] * b.h, b.base[1] - nb[1] * b.h];
          const den = a.d[0] * b.d[1] - a.d[1] * b.d[0];
          if (Math.abs(den) > 0.02) { const t = ((p2[0] - p1[0]) * b.d[1] - (p2[1] - p1[1]) * b.d[0]) / den, C = [p1[0] + a.d[0] * t, p1[1] + a.d[1] * t];
            if (Math.hypot(C[0] - c[0], C[1] - c[1]) < a.L + 2) pts.push(V(C[0], baseY(C[0], C[1]), C[1])); } }
      }
      I.pad = pts.map(p => [p[0], p[2]]); // (its outline, for surface queries)
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
      const kindAt = (side, s) => { const w = wsAt(n, side, s); return [w > 0 ? 'walk' : baseKind(n), w]; };
      for (const [s0, s1] of n.pieces) for (const side of [1, -1]) {
        const sm = (s0 + s1) / 2, p = P(n, sm, side * n.hw), [k, w] = kindAt(side, sm);
        raw.push([n, side, s0, s1, noEdge(p[0], p[2], n.R) ? 'skirt' : k, w]);
      }
      for (const a of n.arms) for (const side of [1, -1]) {
        const t0 = a.cornerT[side] ?? 0, t1 = a.L; if (t1 - t0 < 0.05) continue;
        let s0 = clamp(a.s + a.dir * t0, 0, n.PL.len), s1 = clamp(a.s + a.dir * t1, 0, n.PL.len); if (s0 > s1) [s0, s1] = [s1, s0];
        if (s1 - s0 < 0.05) continue;
        const sm = (s0 + s1) / 2, q = sampleAt(n.PL, sm);
        if (!inBounds(q.x, q.z) || skip(q.x, q.z, n.R)) continue;
        const p = P(n, sm, side * n.hw), [k, w] = kindAt(side, sm);
        raw.push([n, side, s0, s1, noEdge(p[0], p[2], n.R) ? 'skirt' : k, w]);
      }
    }
    // where a curb return's tangent point lies beyond the junction's clip (a skewed junction, a road bending at it) the
    // corner takes over from there: the straight kerb along the road stops at the tangent point instead of running on
    // to the clip beside the arc (two kerbs, the straight one sticking out past the curve)
    const gaps = [];
    for (const n of net) for (const a of n.arms) for (const side of [1, -1]) { const t = a.cornerT[side]; if (t === undefined || t <= a.L + 0.02) continue;
      const s0 = clamp(a.s + a.dir * a.L, 0, n.PL.len), s1 = clamp(a.s + a.dir * t, 0, n.PL.len); gaps.push([n, side, Math.min(s0, s1), Math.max(s0, s1)]); }
    for (const [n, side, g0, g1] of gaps) for (let i = raw.length - 1; i >= 0; i--) { const r = raw[i]; if (r[0] !== n || r[1] !== side || r[3] <= g0 + 1e-6 || r[2] >= g1 - 1e-6) continue;
      const parts = []; if (r[2] < g0 - 0.02) parts.push([...r.slice(0, 2), r[2], g0, ...r.slice(4)]); if (r[3] > g1 + 0.02) parts.push([...r.slice(0, 2), g1, r[3], ...r.slice(4)]); raw.splice(i, 1, ...parts); }
    raw.sort((A, Bq) => A[0] === Bq[0] ? A[1] - Bq[1] || A[2] - Bq[2] : net.indexOf(A[0]) - net.indexOf(Bq[0]));
    const out = [];
    for (const r of raw) {
      const last = out[out.length - 1];
      if (last && last[0] === r[0] && last[1] === r[1] && last[4] === r[4] && last[5] === r[5] && r[2] <= last[3] + 0.02) last[3] = Math.max(last[3], r[3]);
      else out.push([...r]);
    }
    return out;
  };
  RN.runs = computeRuns();
  // kerb drop at s: 0 full kerb, 1 lowered (driveways, zebra crossings), 2 flush (level-crossing landings); each cut
  // ramps in over `ramp` metres
  // (semiAt: whether the lowering at s is a pedestrian crossing's, which keeps the footway level behind its ramp)
  const cutAt = (n, side, s) => { let h = 0; for (const c of RN.cuts) if (c.id === n.R.id && c.side === side) { const r = c.ramp || 1.2;
    h = Math.max(h, (c.flush ? 2 : 1) * smoothstep(c.s0 - r, c.s0, s) * (1 - smoothstep(c.s1, c.s1 + r, s))); } return h; };
  const semiAt = (n, side, s) => { let best = 0, semi = false; for (const c of RN.cuts) if (c.id === n.R.id && c.side === side) { const r = c.ramp || 1.2, v = smoothstep(c.s0 - r, c.s0, s) * (1 - smoothstep(c.s1, c.s1 + r, s)); if (v > best + 1e-6) { best = v; semi = !!c.xing; } } return semi; };
  // sidewalk / kerb top at a point (null when not on one)
  // A curb return joins two footway runs: at each tangent point it takes on that run's width and kerb (lowered for a
  // crossing or a driveway next to the corner, semi-flat or not), and between them it changes smoothly — a corner
  // between a 3 m avenue footway and a 2 m street footway narrows round its arc instead of ending in a 1 m step, and a
  // crossing just past the corner no longer leaves the corner standing 15 cm above the lowered kerb beside it.
  // sa: arc length from the corner's A end, arcL: its length. -> { w, drop, semi }
  const cornerEnds = cr => cr.ends || (cr.ends = (() => { const a = cr.a, b = cr.b, sA = a.s + a.dir * (a.cornerT[a.dir] ?? 0), sB = b.s + b.dir * (b.cornerT[-b.dir] ?? 0);
    // (an end on a road without a footway — the corner ramps down onto a lane, a path — narrows to a kerb's width there)
    return { sA, sB, wA: wsAt(a.n, a.dir, sA + a.dir * 0.05) || (cr.dropA ? 0.6 : cr.walk), wB: wsAt(b.n, -b.dir, sB + b.dir * 0.05) || (cr.dropB ? 0.6 : cr.walk) }; })());
  const cornerAt = (cr, sa, arcL) => {
    const E = cornerEnds(cr), f = arcL > 1e-6 ? clamp(sa / arcL, 0, 1) : 0, w = lerp(E.wA, E.wB, f * f * (3 - 2 * f));
    if (cr.kind !== 'walk') return { w, drop: 0, semi: false };
    const fa = 1 - smoothstep(0.3, 1.8, sa), fb = smoothstep(arcL - 1.8, arcL - 0.3, sa);
    const C = [[cr.dropA ? 1 - smoothstep(0.6, 2.2, sa) : 0, false], [cr.dropB ? smoothstep(arcL - 2.2, arcL - 0.6, sa) : 0, false],
      [cutAt(cr.a.n, cr.a.dir, E.sA) * fa, semiAt(cr.a.n, cr.a.dir, E.sA)], [cutAt(cr.b.n, -cr.b.dir, E.sB) * fb, semiAt(cr.b.n, -cr.b.dir, E.sB)]];
    let best = C[0]; for (const c of C) if (c[0] > best[0] + 1e-6) best = c;
    return { w, drop: best[0], semi: best[0] > 1e-4 ? best[1] : true };
  };
  // a curb return's footway width toward (x, z) (its arc's centre seen from the point)
  RN.cornerW = (cr, x, z) => { const aa = Math.atan2(z - cr.O[1], x - cr.O[0]), a1 = Math.atan2(cr.arc[0][1] - cr.O[1], cr.arc[0][0] - cr.O[0]), a2 = Math.atan2(cr.arc[cr.arc.length - 1][1] - cr.O[1], cr.arc[cr.arc.length - 1][0] - cr.O[0]);
    let span = a2 - a1; while (span > Math.PI) span -= 2 * Math.PI; while (span < -Math.PI) span += 2 * Math.PI;
    let rel = aa - a1; while (rel > Math.PI) rel -= 2 * Math.PI; while (rel < -Math.PI) rel += 2 * Math.PI;
    const arcL = Math.abs(span) * cr.rF, sa = clamp(rel * Math.sign(span), 0, Math.abs(span)) * cr.rF; return cornerAt(cr, sa, arcL).w; };
  // the footways as one area (footways.js): RN.walkY(x, z) is their top, or null off them
  RN.cornerAt = cornerAt; RN.cutAt = cutAt; RN.semiAt = semiAt;
  RN.skipAt = (n, s) => { const q = sampleAt(n.PL, s); return skip(q.x, q.z, n.R); };
  RN.FW = planFootways(RN, { baseY });
  RN.walkY = RN.FW.walkY;
  RN.topY = (x, z, fallback) => { const w = RN.walkY(x, z); if (w !== null) return w; const r = roadAt(x, z); if (r) return baseY(x, z) + crown(r.n, r.s, r.u); return fallback(x, z); };

  RN.buildEdges = (B, { tactile = () => false } = {}) => {
    B.frame(0, 0, 0, 0);
    const KERB = [0.86, 0.845, 0.8], GUT = [0.8, 0.785, 0.745]; // (warm, slightly sandy concrete)
    // one profile ring swept between two cross-sections A (at s0) and Bs (at s1); frames give [point(q), outward dir]
    const sweepSeg = (kind, prA, prB, fa, fb, alongA, alongB, jitter, n) => {
      let acc = 0;
      for (let k = 0; k + 1 < prA.length; k++) {
        const qa0 = prA[k], qa1 = prA[k + 1], qb0 = prB[k], qb1 = prB[k + 1];
        const du = qa1[0] - qa0[0], dv = qa1[1] - qa0[1], pl = Math.hypot(du, dv);
        const hn = Math.abs(dv) > Math.abs(du) ? [fa.o[0] * -Math.sign(dv), 0, fa.o[1] * -Math.sign(dv)] : [0, 1, 0];
        const hint = k === prA.length - 2 ? [fa.o[0], 0, fa.o[1]] : hn;
        const mat = kind === 'skirt' ? 'asphalt' : 'concrete';
        let col = kind === 'walk' ? (k === 0 ? GUT : KERB) : kind === 'gutter' ? [0.78, 0.78, 0.75] : [1, 1, 1];
        if (k >= 1 && k <= 4 && kind === 'walk') col = shade(col, 0.93 + 0.12 * jitter);
        const sc = 1.5, uvs = [[alongA / sc, acc / sc], [alongB / sc, acc / sc], [alongB / sc, (acc + pl) / sc], [alongA / sc, (acc + pl) / sc]];
        const opt = { color: col, uvs };
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
    // (along a footway only its kerb strip — apron, kerb face, kerb top — up to KERB_IN: the paving is the footways' own)
    const profOf = (kind, walk, drop, f, semi = false) => kind === 'walk' ? kerbProfile(walk, drop, null, semi).slice(0, 6) : kind === 'gutter' ? gutterProfile(drop) : SKIRT;
    for (const [n, side, sa, sb, kind, rw] of RN.runs) {
      const frame = s => {
        const q = sampleAt(n.PL, s), l = rot(q.d), o = [l[0] * side, l[1] * side];
        return { o, t: q.d, at: pq => { const u = side * (n.hw + pq[0]), x = q.x + l[0] * u, z = q.z + l[1] * u; return V(x, baseY(x, z) + pq[1], z); } };
      };
      const sub = kind === 'skirt' ? 2.5 : 1;
      const ss = []; for (let s = sa; s < sb - 1e-3; s = Math.min(sb, (Math.floor(s / sub + 1e-6) + 1) * sub)) ss.push(s); ss.push(sb);
      for (let i = 0; i + 1 < ss.length; i++) {
        const s0 = ss[i], s1 = ss[i + 1], sm = (s0 + s1) / 2;
        const fA = frame(s0), fB = frame(s1), prA = profOf(kind, rw, cutAt(n, side, s0), fA, semiAt(n, side, s0)), prB = profOf(kind, rw, cutAt(n, side, s1), fB, semiAt(n, side, s1));
        sweepSeg(kind, prA, prB, fA, fB, s0, s1, hash(Math.floor(sm), side + n.hw), n);
        // storm drains in the gutter apron (walk), grates in the L-gutter (lanes)
        if (kind === 'walk' && Math.floor(s0 / 22) !== Math.floor(s1 / 22) && cutAt(n, side, sm) < 0.1) B.detail(2, () => {
          const f = frame(sm), g = f.at([0.15, 0.003]);
          B.frame(g[0], g[1], g[2], Math.atan2(f.t[0], f.t[1]));
          B.box('dark', 0, -0.004, 0, 0.36, 0.006, 0.66, { color: [0.12, 0.12, 0.12] });
          B.box('metal', 0, 0.0, -0.315, 0.36, 0.005, 0.03, { color: [0.3, 0.29, 0.28] }); B.box('metal', 0, 0.0, 0.315, 0.36, 0.005, 0.03, { color: [0.3, 0.29, 0.28] });
          for (let k = -3; k <= 3; k++) B.box('metal', 0, 0.0, k * 0.085, 0.36, 0.005, 0.028, { color: [0.3, 0.29, 0.28] });
          B.frame(0, 0, 0, 0);
        }); else if (kind === 'gutter' && Math.floor(s0 / 6) !== Math.floor(s1 / 6) && cutAt(n, side, sm) < 1) B.detail(2, () => {
          const f = frame(sm), g = f.at([0.16, -0.018]);
          B.frame(g[0], g[1], g[2], Math.atan2(f.t[0], f.t[1]));
          B.box('dark', 0, -0.002, 0, 0.2, 0.004, 0.48, { color: [0.1, 0.1, 0.1] });
          for (let k = -2; k <= 2; k++) B.box('metal', 0, 0.0, k * 0.09, 0.22, 0.004, 0.028, { color: [0.32, 0.31, 0.3] });
          B.box('metal', -0.105, 0.0, 0, 0.02, 0.004, 0.5, { color: [0.32, 0.31, 0.3] }); B.box('metal', 0.105, 0.0, 0, 0.02, 0.004, 0.5, { color: [0.32, 0.31, 0.3] });
          B.frame(0, 0, 0, 0);
        });
        // tactile guide line on main-road sidewalks: yellow bar blocks 30 cm wide, 5 mm proud of the paving
        if (kind === 'walk' && tactile(n, frame(s0).at([0, 0]))) {
          const qc = rw * 0.64, fa = frame(s0), fb = frame(s1), pa = kerbProfile(rw, cutAt(n, side, s0), null, semiAt(n, side, s0)), pb = kerbProfile(rw, cutAt(n, side, s1), null, semiAt(n, side, s1));
          const at = (f, pr, q) => { const p = f.at([q, profileY(pr, q) + 0.009]); return p; };
          const a0 = at(fa, pa, qc - 0.15), a1 = at(fa, pa, qc + 0.15), b0 = at(fb, pb, qc - 0.15), b1 = at(fb, pb, qc + 0.15);
          B.poly('tactileL', [a0, b0, b1, a1], [0, 1, 0], { uvs: [[s0 / 0.3, 0], [s1 / 0.3, 0], [s1 / 0.3, 1], [s0 / 0.3, 1]] });
        }
      }
      // caps where the run ends
      const fa = frame(sa), fb = frame(sb);
      cap(kind, profOf(kind, rw, cutAt(n, side, sa), fa, semiAt(n, side, sa)), fa, [-fa.t[0], -fa.t[1]]);
      cap(kind, profOf(kind, rw, cutAt(n, side, sb), fb, semiAt(n, side, sb)), fb, [fb.t[0], fb.t[1]]);
    }
    // curb returns: the edge profile swept around each fillet (toward the block)
    for (const I of inters) for (const cr of I.corners) {
      const k = cr.arc.length - 1;
      const frame = j => {
        const p = cr.arc[j], inw = [(cr.O[0] - p[0]) / cr.rF, (cr.O[1] - p[1]) / cr.rF];
        return { o: inw, at: q => { const x = p[0] + inw[0] * q[0], z = p[1] + inw[1] * q[0]; return V(x, baseY(x, z) + q[1], z); } };
      };
      const segLen = Math.hypot(cr.arc[1][0] - cr.arc[0][0], cr.arc[1][1] - cr.arc[0][1]);
      const arcL = k * segLen, prJ = j => { const C = cornerAt(cr, j * segLen, arcL); return profOf(cr.kind, C.w, C.drop, frame(j), C.semi); };
      for (let j = 0; j < k; j++) sweepSeg(cr.kind, prJ(j), prJ(j + 1), frame(j), frame(j + 1), j * segLen, (j + 1) * segLen, hash(j, cr.O[0]), cr.a.n);
      const f0 = frame(0), fk = frame(k), t0 = norm2([cr.arc[0][0] - cr.arc[1][0], cr.arc[0][1] - cr.arc[1][1]]), tk = norm2([cr.arc[k][0] - cr.arc[k - 1][0], cr.arc[k][1] - cr.arc[k - 1][1]]);
      cap(cr.kind, prJ(0), f0, t0); cap(cr.kind, prJ(k), fk, tk);
    }
    // where a footway ends (on a lane beyond its junction, or at a road's free end) a band of warning tiles lies across
    // it at the foot of its ramp, where the walker steps out onto the road's shoulder
    for (const n of net) for (const e of n.ends) {
      const w = wsAt(n, e.side, e.s - e.dir * 0.5); if (!w) continue;
      const fr = sq => { const q = sampleAt(n.PL, sq), l = rot(q.d); return pq => { const u = e.side * (n.hw + pq[0]), x = q.x + l[0] * u, z = q.z + l[1] * u; return V(x, baseY(x, z) + pq[1], z); }; };
      const sa = e.s - e.dir * 0.95, sb = e.s - e.dir * 0.35, A = fr(sa), Bq = fr(sb), pa = kerbProfile(w, cutAt(n, e.side, sa)), pb = kerbProfile(w, cutAt(n, e.side, sb)), q0 = 0.5, q1 = w - 0.15;
      if (q1 - q0 < 0.3) continue;
      B.poly('tactileD', [A([q0, profileY(pa, q0) + 0.009]), Bq([q0, profileY(pb, q0) + 0.009]), Bq([q1, profileY(pb, q1) + 0.009]), A([q1, profileY(pa, q1) + 0.009])], [0, 1, 0],
        { uvs: [[0, 0], [2, 0], [2, (q1 - q0) / 0.3], [0, (q1 - q0) / 0.3]] });
    }
    // warning blocks (dots) where crossings meet a lowered kerb
    for (const cw of RN.crossings || []) {
      const n = byId.get(cw.id); if (!n.walk) continue;
      for (const side of [1, -1]) for (let s = cw.s - cw.band / 2; s < cw.s + cw.band / 2 - 1e-3; s += 0.3) {
        const s1 = Math.min(s + 0.3, cw.s + cw.band / 2), f = sq => { const q = sampleAt(n.PL, sq), l = rot(q.d); return pq => { const u = side * (n.hw + pq[0]), x = q.x + l[0] * u, z = q.z + l[1] * u; return V(x, baseY(x, z) + pq[1], z); }; };
        const pa = kerbProfile(n.walk, cutAt(n, side, s), null, true), pb = kerbProfile(n.walk, cutAt(n, side, s1), null, true);
        const A = f(s), Bq = f(s1), q0 = 0.5, q1 = 1.1;
        B.poly('tactileD', [A([q0, profileY(pa, q0) + 0.009]), Bq([q0, profileY(pb, q0) + 0.009]), Bq([q1, profileY(pb, q1) + 0.009]), A([q1, profileY(pa, q1) + 0.009])], [0, 1, 0],
          { uvs: [[0, 0], [1, 0], [1, 2], [0, 2]] });
      }
    }
  };
  return RN;
}
