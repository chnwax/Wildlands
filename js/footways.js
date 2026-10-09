// Footways (歩道) as one paved area. The kerb lines of the road network — each road side's edge between its junctions
// and every curb return — are known exactly; a footway is the ground behind a kerb line out to its width. Rather than
// sweep a band beside each road and patch the places where bands meet (corners onto lanes, junctions close together,
// curved streets, roads on embankments up to the bridges), every point is given to the kerb line it lies nearest to:
//  - a point belongs to the footway when the kerb line nearest to it carries one and the point lies within its width;
//    footways of different kerbs meet along the line halfway between them, never overlap, never leave a gap
//  - a lane's L-gutter, another road's carriageway and a junction pad keep their ground; a footway that ends (a road's
//    free end, the end of a footway carried round a corner onto a lane) ends square across
//  - its height is one function: the road base under the point plus the kerb profile at the point's distance from its
//    kerb (lowered for crossings and driveways along that kerb), blended across the seam where two footways meet
//  - joins (FW.joins): where other paving runs a few metres behind a footway (the riverside walkway at the bridgeheads)
//    the gap between them is paved too, the surface eased from one to the other
// The paving is laid on a 0.5 m world grid clipped to that area (cells along its edges cut where the area's edge
// crosses them), so it follows any shape; the kerb itself (gutter apron, kerb face and top) is swept along the kerb
// lines by roads.js and the paving overlaps its top by a few centimetres. Wherever the area's edge is not a kerb — its
// back, its ends — the edge is traced into chains: a concrete edging strip, a skirt down to the ground, and the verge
// (town.js) grading the lawn up to it.
import { clamp, lerp, smoothstep } from './core.js';

// ---- the kerb's cross-section (the kerb line at q = 0, q growing toward the footway's back): [q, height] points
// A lowered kerb at a pedestrian crossing is 'semi-flat' (セミフラット): it dips the kerb and a short transverse ramp
// behind it (at most 0.9 m) down to the crossing, and the footway beyond stays level, so walking along it never rolls up
// and down. At a driveway the whole footway width comes down to the lowered kerb (a car crosses it onto the plot, which
// lies at ground level). drop 1..2 goes on from the lowered kerb to flush: kerb, footway and apron all at road level (the
// landing of a level crossing, where the footway runs level onto the deck's footway panels).
export function kerbProfile(walk, drop, out, semi = false) {
  const f = clamp(drop - 1, 0, 1), d = Math.min(drop, 1);
  const kh = f > 0 ? lerp(0.025, 0, f) : lerp(0.15, 0.025, d), ap = 0.004 * (1 - f), low = kh + 0.01 * (1 - f);
  const foot = lerp(0.16, low, semi ? f : d), edge = lerp(foot, low, d);      // the footway's level, and its edge at the kerb
  const q6 = 0.46 + Math.max(0.02, semi ? Math.min(0.9, walk * 0.4) * d * (1 - f) : 0), fall = 0.012 * (1 - (semi ? f : d));
  const P = out || Array.from({ length: 9 }, () => [0, 0]);
  const set = (i, q, v) => { P[i][0] = q; P[i][1] = v; };
  set(0, 0, 0); set(1, 0.3, ap); set(2, 0.3, Math.max(kh - 0.02, ap)); set(3, 0.325, kh); set(4, 0.45, kh);
  set(5, 0.46, edge); set(6, q6, foot + (q6 - 0.46) * fall); set(7, walk, foot + (walk - 0.46) * fall); set(8, walk, -0.12);
  return P;
}
export const profileY = (pr, q) => { for (let k = 0; k + 1 < pr.length - 1; k++) { const a = pr[k], b = pr[k + 1]; if (q <= b[0] + 1e-6 && b[0] > a[0]) return lerp(a[1], b[1], clamp((q - a[0]) / (b[0] - a[0]), 0, 1)); } return pr[pr.length - 2][1]; };
export const KERB_IN = 0.46;           // the kerb strip (apron, kerb face, kerb top) lies between the kerb line and this
const SEAM = 0.40;                     // the paving's edge over the kerb top (it overlaps the strip, a few millimetres above it)
const LIFT = 0.004;                    // (the paving's lift over the kerb profile, so the overlap never fights)
const CLAIM = { gutter: 0.42, skirt: 0.16 }; // what a road side without a footway keeps for itself behind its edge
const OVER = 0.6;                      // a kerb line still reaches this far past an end joined to the next one (no gap at joints)
const CELL = 0.5;                      // the paving grid
const WALK = [0.91, 0.885, 0.835], EDGE = [0.8, 0.79, 0.755], BACK = [0.66, 0.645, 0.61];

// RN: the road network (roads.js); baseY(x, z): the road base height. -> FW { walkY, probe, build, chains, paint }
export function planFootways(RN, { baseY }) {
  const net = RN.net, NI = new Map(net.map((n, i) => [n, i])), joins = [];
  const rot = d => [-d[1], d[0]];
  // ---- the kerb lines: a run along a road side ([s0, s1] at u = side * hw) or a curb return (arc round O at rF)
  const runs = net.map(() => ({ 1: [], [-1]: [] })), arcs = [];
  for (const [n, side, s0, s1, kind, rw] of RN.runs) runs[NI.get(n)][side].push({ type: 'run', n, side, s0, s1, kind, walk: kind === 'walk', w: rw, freeA: true, freeB: true });
  for (const L of runs) for (const side of [1, -1]) L[side].sort((a, b) => a.s0 - b.s0);
  for (const I of RN.inters) for (const cr of I.corners) {
    const p0 = cr.arc[0], p1 = cr.arc[cr.arc.length - 1], a1 = Math.atan2(p0[1] - cr.O[1], p0[0] - cr.O[0]), a2 = Math.atan2(p1[1] - cr.O[1], p1[0] - cr.O[0]);
    let span = a2 - a1; while (span > Math.PI) span -= 2 * Math.PI; while (span < -Math.PI) span += 2 * Math.PI;
    arcs.push({ type: 'arc', cr, kind: cr.kind, walk: cr.kind === 'walk', a1, span, arcL: Math.abs(span) * cr.rF, p0, p1 });
  }
  // a run's end is joined where a curb return starts at it (the corner takes over); elsewhere it is free and the footway
  // ends square across there
  const edgePt = (n, s, side) => { const q = RN.sampleAt(n, s), l = rot(q.d); return [q.x + l[0] * side * n.hw, q.z + l[1] * side * n.hw]; };
  for (const L of runs) for (const side of [1, -1]) for (const e of L[side]) {
    const A = edgePt(e.n, e.s0, side), Bp = edgePt(e.n, e.s1, side), at = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.15;
    for (const a of arcs) { if (at(A, a.p0) || at(A, a.p1)) e.freeA = false; if (at(Bp, a.p0) || at(Bp, a.p1)) e.freeB = false; }
    // (a run continued by the next run of the same side — a change of kind or width — is joined to it as well)
    for (const o of L[side]) if (o !== e) { if (Math.abs(o.s1 - e.s0) < 0.05) e.freeA = !(o.walk && e.walk) && e.freeA; if (Math.abs(o.s0 - e.s1) < 0.05) e.freeB = !(o.walk && e.walk) && e.freeB; }
  }
  // ---- spatial index (8 m cells): road segments and curb returns reaching into each cell
  const CS = 8, grid = new Map(), key = (i, j) => i * 73856093 ^ j * 19349663;
  const addBox = (x0, z0, x1, z1, item) => { for (let i = Math.floor(x0 / CS); i <= Math.floor(x1 / CS); i++) for (let j = Math.floor(z0 / CS); j <= Math.floor(z1 / CS); j++) { const k = key(i, j); let L = grid.get(k); if (!L) grid.set(k, L = []); L.push(item); } };
  net.forEach((n, k) => {
    const ext = n.hw + Math.max(n.walk, ...n.ws[1].map(q => q[2]), ...n.ws[-1].map(q => q[2]), 0.5) + 1.5;
    n.PL.segs.forEach((g, i) => addBox(Math.min(g.a[0], g.b[0]) - ext, Math.min(g.a[1], g.b[1]) - ext, Math.max(g.a[0], g.b[0]) + ext, Math.max(g.a[1], g.b[1]) + ext,
      { k, n, g, first: i === 0, last: i === n.PL.segs.length - 1 }));
  });
  for (const a of arcs) addBox(a.cr.O[0] - a.cr.rF - 1, a.cr.O[1] - a.cr.rF - 1, a.cr.O[0] + a.cr.rF + 1, a.cr.O[1] + a.cr.rF + 1, { a });
  const NONE = [], near = (x, z) => grid.get(key(Math.floor(x / CS), Math.floor(z / CS))) || NONE;

  // ---- kerb drops (RN.cuts) per road side, indexed again whenever cuts were added
  let cutN = -1, cutIdx = new Map();
  const cutsOf = (n, side) => { if (cutN !== RN.cuts.length) { cutN = RN.cuts.length; cutIdx = new Map(); for (const c of RN.cuts) { const k = c.id + '|' + c.side; let L = cutIdx.get(k); if (!L) cutIdx.set(k, L = []); L.push(c); } }
    return cutIdx.get(n.R.id + '|' + side) || NONE; };
  const dropAt = (n, side, s, out) => { let best = 0, semi = false;
    for (const c of cutsOf(n, side)) { const r = c.ramp || 1.2; if (s < c.s0 - r || s > c.s1 + r) continue; const v = (c.flush ? 2 : 1) * smoothstep(c.s0 - r, c.s0, s) * (1 - smoothstep(c.s1, c.s1 + r, s));
      if (v > best + 1e-6) { best = v; semi = !!c.xing; } }
    out.drop = best; out.semi = best > 1e-4 ? semi : false; return out; };

  // ---- the probe: which kerb line a point belongs to, and the footway's surface there
  const stamp = new Int32Array(net.length), bd = new Float64Array(net.length), bs = new Float64Array(net.length), bu = new Float64Array(net.length), bpast = new Float64Array(net.length), seen = [];
  let tickN = 0;
  const C = [], cand = () => { const c = { e: null, sd: 0, s: 0, along: 0, w: 0, endM: Infinity, drop: 0, semi: false, nk: -1 }; C.push(c); return c; };
  for (let i = 0; i < 12; i++) cand();
  const _kp = Array.from({ length: 9 }, () => [0, 0]), _d = { drop: 0, semi: false };
  // P: { phi (paving: > 0 inside), phiK (the whole footway incl. the kerb strip), H (surface), Hs (paving), along, sd, w, term, e }
  const P = { phi: -1, phiK: -1, H: 0, Hs: 0, along: 0, sd: 0, w: 0, term: '', e: null };
  const heightOf = (c, x, z, q) => baseY(x, z) + profileY(kerbProfile(c.w, c.drop, _kp, c.semi), q);
  function probe(x, z, needH = true) {
    tickN++; seen.length = 0; let nc = 0, carr = 0;
    for (const it of near(x, z)) {
      if (it.g) {
        const { k, g } = it, tu = (x - g.a[0]) * g.d[0] + (z - g.a[1]) * g.d[1], t = clamp(tu, 0, g.L), px = g.a[0] + g.d[0] * t, pz = g.a[1] + g.d[1] * t, d = Math.hypot(x - px, z - pz);
        if (stamp[k] !== tickN) { stamp[k] = tickN; seen.push(k); bd[k] = Infinity; }
        if (d < bd[k]) { bd[k] = d; bs[k] = g.s0 + t; bu[k] = (x - px) * -g.d[1] + (z - pz) * g.d[0]; bpast[k] = it.first && tu < 0 ? -tu : it.last && tu > g.L ? tu - g.L : 0; }
        continue;
      }
      const a = it.a, cr = a.cr, vx = x - cr.O[0], vz = z - cr.O[1], r = Math.hypot(vx, vz);
      if (r > cr.rF + 1.0) continue;
      let rel = Math.atan2(vz, vx) - a.a1; while (rel > Math.PI) rel -= 2 * Math.PI; while (rel < -Math.PI) rel += 2 * Math.PI;
      const sa = rel * Math.sign(a.span) * cr.rF; if (sa < -0.02 || sa > a.arcL + 0.02) continue;
      const sd = cr.rF - r;
      if (sd < 0) { carr = Math.max(carr, -sd); }
      if (nc >= C.length) cand();
      const c = C[nc++]; c.e = a; c.sd = sd; c.s = sa; c.along = 1000 + sa; c.endM = Infinity; c.nk = -1;
      if (a.walk) { const q = RN.cornerAt(cr, clamp(sa, 0, a.arcL), a.arcL); c.w = q.w; c.drop = q.drop; c.semi = q.semi; } else c.w = CLAIM[a.kind] || 0.16;
    }
    for (const k of seen) {
      const n = net[k], s = bs[k], side = bu[k] >= 0 ? 1 : -1, sd = bd[k] - n.hw, past = bpast[k];
      if (sd < 0 && past < 1e-6) carr = Math.max(carr, -sd);
      // the run of that side covering s (or the nearest one within reach of a joined end)
      // the run of that side covering s; and the footway run there — the covering one, or one whose free end lies just
      // behind (its end then has a gradient for the grid to cut it square on)
      let en = null, ew = null, ewM = -Infinity;
      for (const r of runs[k][side]) {
        const lo = r.s0 - (r.freeA ? 0 : OVER), hi = r.s1 + (r.freeB ? 0 : OVER);
        if (s < lo - 0.8 || s > hi + 0.8) continue;
        const m = Math.min(r.freeA ? s - r.s0 : Infinity, r.freeB ? r.s1 - s : Infinity, past > 0 ? -past : Infinity);
        if (s >= lo && s <= hi) { if (r.walk) { ew = r; ewM = m; } else en = r; continue; }
        if (r.walk && (s < lo ? r.freeA : r.freeB) && m > ewM && !(ew && ewM >= 0)) { ew = r; ewM = m; }
      }
      if (en) { if (nc >= C.length) cand(); const c = C[nc++]; c.e = en; c.sd = sd; c.s = s; c.along = s; c.endM = Infinity; c.nk = k; c.w = CLAIM[en.kind] || 0.16; }
      if (ew) { if (nc >= C.length) cand(); const c = C[nc++]; c.e = ew; c.sd = sd; c.s = s; c.along = s; c.endM = ewM; c.nk = k; c.w = ew.w;
        dropAt(n, side, clamp(s, ew.s0, ew.s1), _d); c.drop = _d.drop; c.semi = _d.semi; }
    }
    // the footway's own kerb: the nearest kerb line that carries one (a little way into the road still counts, so the
    // edge along the kerb has a gradient for the grid to cut it on)
    let b1 = null, b2 = null;
    for (let i = 0; i < nc; i++) { const c = C[i]; if (!c.e.walk || c.sd < -0.8) continue; if (!b1 || c.sd < b1.sd) { b2 = b1; b1 = c; } else if (!b2 || c.sd < b2.sd) b2 = c; }
    if (!b1) { P.phi = P.phiK = -1; P.term = 'none'; P.e = null; P.H = P.Hs = NaN; return P; }
    let phiN = Infinity;   // ground kept by road sides without a footway (not the one the footway itself ends against)
    for (let i = 0; i < nc; i++) { const c = C[i]; if (c.e.walk || c.sd < -0.3 || (c.nk === b1.nk && c.nk >= 0 && Math.sign(c.sd + 1e-9) === Math.sign(b1.sd + 1e-9) && b1.endM < 0.8)) continue; phiN = Math.min(phiN, c.sd - c.w); }
    // another road's carriageway (or a junction pad): the footway stops at its edge
    const phiC = carr > 0 && !(b1.sd < 0) ? -carr : Infinity;
    const tK = b1.sd - SEAM, tE = b1.endM;
    let tB = b1.w - b1.sd, backTerm = 'back', jy = 0, jt = 0;
    // joins: other paving close behind the footway (a riverside walkway): the narrow gap between them is paved too, the
    // footway's back carried on to that paving's edge, its surface eased from the footway's level to that paving's
    for (const J of joins) { if (tB > 0.6) break; const dJ = J.dist(x, z); if (dJ === null || dJ < -0.8) continue;
      const gap = (b1.sd - b1.w) + dJ; if (gap > J.max || gap < 0.05) continue;
      if (dJ > tB) { tB = dJ; backTerm = 'join'; jt = clamp((b1.sd - b1.w) / gap, 0, 1); jy = J.y(x, z); } }
    let phi = tK, term = 'kerb';
    if (tB < phi) { phi = tB; term = backTerm; } if (tE < phi) { phi = tE; term = 'end'; } if (phiN < phi) { phi = phiN; term = 'other'; } if (phiC < phi) { phi = phiC; term = 'road'; }
    P.phi = phi; P.phiK = Math.min(b1.sd, tB, tE, phiN, phiC); P.term = term; P.e = b1.e; P.along = b1.along; P.sd = b1.sd; P.w = b1.w;
    if (needH) {
      P.H = heightOf(b1, x, z, Math.max(0, b1.sd)); P.Hs = heightOf(b1, x, z, Math.max(KERB_IN, b1.sd)) + LIFT;
      // where two footways meet, their surfaces are blended across the seam
      if (b2 && b2.sd - b1.sd < 0.6 && b2.sd >= 0) { const f = 0.5 * (1 - smoothstep(0, 0.6, b2.sd - b1.sd));
        P.H = lerp(P.H, heightOf(b2, x, z, Math.max(0, b2.sd)), f); P.Hs = lerp(P.Hs, heightOf(b2, x, z, Math.max(KERB_IN, b2.sd)) + LIFT, f); }
      if (jt > 0) { const e = jt * jt * (3 - 2 * jt); P.H = lerp(P.H, jy, e); P.Hs = lerp(P.Hs, jy + LIFT, e); }
    }
    return P;
  }
  // footway top at a point (kerb strip included), or null where there is none
  const walkY = (x, z) => { const p = probe(x, z); return p.phiK >= -1e-6 ? p.H : null; };

  // ---- the paving: a 0.5 m world grid clipped to the area
  // FW.joins: [{ dist(x, z): distance outside the other paving's edge (null: not here), y(x, z): its surface, max: widest
  // gap joined, box: [x0, z0, x1, z1] where it applies }]
  const FW = { probe, walkY, chains: [], joins };
  FW.build = (B, { color = WALK } = {}) => {
    B.frame(0, 0, 0, 0);
    const cells = new Set(), ck = (i, j) => (i + 32768) * 65536 + (j + 32768);
    const mark = (x, z) => { const i = Math.floor(x / CELL), j = Math.floor(z / CELL); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) cells.add(ck(i + a, j + b)); };
    for (const L of runs) for (const side of [1, -1]) for (const e of L[side]) { if (!e.walk) continue;
      for (let s = e.s0 - (e.freeA ? 0 : OVER); s <= e.s1 + (e.freeB ? 0 : OVER) + 1e-6; s += 0.4) { const q = RN.sampleAt(e.n, clamp(s, 0, e.n.PL.len)), l = rot(q.d);
        for (let u = e.n.hw - 0.3; u <= e.n.hw + e.w + 0.4; u += 0.35) mark(q.x + l[0] * side * u, q.z + l[1] * side * u); } }
    for (const J of joins) { const [x0, z0, x1, z1] = J.box; for (let x = x0; x <= x1; x += CELL) for (let z = z0; z <= z1; z += CELL) mark(x, z); }
    for (const a of arcs) { if (!a.walk) continue; const cr = a.cr;
      for (let sa = -0.3; sa <= a.arcL + 0.3; sa += 0.35) { const ang = a.a1 + Math.sign(a.span) * sa / cr.rF;
        for (let r = cr.rF + 0.3; r >= cr.rF - Math.max(cr.walk, 3) - 0.4; r -= 0.35) mark(cr.O[0] + Math.cos(ang) * r, cr.O[1] + Math.sin(ang) * r); } }
    // grid vertices and edge crossings, each computed once (cells sharing an edge share its crossing exactly)
    const verts = new Map();
    const vAt = (i, j) => { const k = 'v' + i + ',' + j; let v = verts.get(k); if (v) return v;
      const x = i * CELL, z = j * CELL, p = probe(x, z); v = { k, i, j, x, z, phi: p.phi, Hs: p.Hs, along: p.along, sd: p.sd }; verts.set(k, v); return v; };
    const xAt = (A, Bv) => { const k = A.k < Bv.k ? A.k + '|' + Bv.k : Bv.k + '|' + A.k; let v = verts.get(k); if (v) return v;
      let lo = A.phi >= 0 ? A : Bv, hi = lo === A ? Bv : A, t = lo.phi / (lo.phi - hi.phi), x = lerp(lo.x, hi.x, t), z = lerp(lo.z, hi.z, t);
      for (let it = 0; it < 2; it++) { const f = probe(x, z, false).phi; if (Math.abs(f) < 1e-3) break;            // (secant refinement on the true field)
        const m = { x, z, phi: f }; if (f >= 0) lo = m; else hi = m; t = lo.phi / (lo.phi - hi.phi); x = lerp(lo.x, hi.x, t); z = lerp(lo.z, hi.z, t); }
      // its height and paving coordinates from just inside (the edge belongs to the paving); its kind from just outside
      const pin = probe(x + (lo.x - x) * 0.08, z + (lo.z - z) * 0.08);
      v = { k, x, z, phi: 0, Hs: pin.Hs, along: pin.along, sd: pin.sd, edge: true, g: A.phi >= 0 ? A : Bv };
      v.term = probe(x + (hi.x - x) * 0.15, z + (hi.z - z) * 0.15, false).term; verts.set(k, v); return v; };
    const segs = [];
    // smooth normals: the surface's gradient over the grid (flat-shaded triangles showed every cell in the toon light)
    const nrm = v => { if (v.edge) v = v.g; if (v.n) return v.n;
      const H = (a, b) => { const q = vAt(v.i + a, v.j + b); return Number.isFinite(q.Hs) ? q.Hs : v.Hs; };
      const gx = (H(1, 0) - H(-1, 0)) / (2 * CELL), gz = (H(0, 1) - H(0, -1)) / (2 * CELL), L = Math.hypot(gx, 1, gz);
      return (v.n = [-gx / L, 1 / L, -gz / L]); };
    // (the grid's cells run clockwise seen from above: each polygon is turned over to face up, its attributes with it;
    // a polygon spanning a seam between two kerb lines takes one line's paving coordinates, so its slabs don't smear)
    const emit = poly0 => {
      const poly = [...poly0].reverse(), a0 = poly[0].along;
      const pts = poly.map(v => [v.x, v.Hs, v.z]), uvs = poly.map(v => [v.x / 1.2, v.z / 1.2]), normals = poly.map(nrm);
      const mixed = poly.some(v => Math.abs(v.along - a0) > 3), ap = poly.map(v => mixed ? [a0, v.sd] : [v.along, v.sd]);
      if (poly.length === 4) { B.quad('pavement', pts[0], pts[1], pts[2], pts[3], { color, uvs, normals, attr: { aPave: ap } }); return; }
      for (let i = 1; i + 1 < poly.length; i++) B.tri('pavement', pts[0], pts[i], pts[i + 1], { color, uvs: [uvs[0], uvs[i], uvs[i + 1]], normals: [normals[0], normals[i], normals[i + 1]], attr: { aPave: [ap[0], ap[i], ap[i + 1]] } });
    };
    for (const c of cells) {
      const i = Math.floor(c / 65536) - 32768, j = c % 65536 - 32768;
      const Q = [vAt(i, j), vAt(i + 1, j), vAt(i + 1, j + 1), vAt(i, j + 1)];
      const ins = Q.map(v => v.phi >= 0), nIn = ins.filter(Boolean).length;
      if (!nIn) continue;
      if (nIn === 4) { emit(Q); continue; }
      // Sutherland-Hodgman against phi >= 0 (a saddle stays one polygon through the cell)
      const out = [];
      for (let a = 0; a < 4; a++) { const A = Q[a], Bv = Q[(a + 1) % 4];
        if (ins[a]) out.push(A);
        if (ins[a] !== ins[(a + 1) % 4]) out.push(xAt(A, Bv)); }
      if (out.length >= 3) emit(out);
      // its boundary inside the cell: from a crossing to the next crossing (the area on the polygon's inner side)
      for (let a = 0; a < out.length; a++) { const A = out[a], Bv = out[(a + 1) % out.length]; if (A.edge && Bv.edge) segs.push([A, Bv]); }
    }
    // ---- the edges that are not a kerb, traced into chains
    const next = new Map(), prev = new Map(); for (const sg of segs) { next.set(sg[0].k, sg); prev.set(sg[1].k, sg); }
    const used = new Set(), chains = [];
    for (const sg of segs) { if (used.has(sg)) continue;
      // walk back to the chain's start (or round a loop), then forward
      let st = sg, guard = 0;
      while (prev.has(st[0].k) && !used.has(prev.get(st[0].k)) && prev.get(st[0].k) !== sg && guard++ < 100000) st = prev.get(st[0].k);
      const pts = [st[0]]; let cur = st;
      while (cur && !used.has(cur)) { used.add(cur); pts.push(cur[1]); cur = next.get(cur[1].k); }
      const closed = pts.length > 2 && pts[pts.length - 1] === pts[0];
      chains.push({ pts, closed });
    }
    // outward normals (horizontal) along each chain, from its segments, averaged at the vertices
    for (const ch of chains) {
      const P2 = ch.pts, m = P2.length, sn = [];
      for (let i = 0; i + 1 < m; i++) { const a = P2[i], b = P2[i + 1], dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1; let nx = dz / L, nz = -dx / L;
        if (probe((a.x + b.x) / 2 + nx * 0.06, (a.z + b.z) / 2 + nz * 0.06, false).phi > 0) { nx = -nx; nz = -nz; } sn.push([nx, nz]); }
      ch.n = P2.map((_, i) => { const a = sn[Math.max(0, i - 1)] || sn[0], b = sn[Math.min(sn.length - 1, i)] || a; let nx = a[0] + b[0], nz = a[1] + b[1];
        if (ch.closed && (i === 0 || i === m - 1)) { const c = sn[sn.length - 1], d = sn[0]; nx = c[0] + d[0]; nz = c[1] + d[1]; }
        const L = Math.hypot(nx, nz) || 1; return [nx / L, nz / L]; });
    }
    FW.chains = chains;
    return chains;
  };
  // the edges that are not a kerb: an edging strip along the paving's edge and a skirt down to the ground
  // ground(x, z): the terrain under the edge
  FW.buildEdges = (B, { ground }) => {
    B.frame(0, 0, 0, 0);
    for (const ch of FW.chains) {
      const P2 = ch.pts, N = ch.n;
      for (let i = 0; i + 1 < P2.length; i++) {
        const a = P2[i], b = P2[i + 1], na = N[i], nb = N[i + 1];
        const kerbish = (a.term === 'kerb' || a.term === 'join') && (b.term === 'kerb' || b.term === 'join'); if (kerbish) continue; // (along the kerb the kerb strip is the edge; a join meets other paving)
        const ga = ground(a.x, a.z) - 0.06, gb = ground(b.x, b.z) - 0.06;
        if (Math.max(a.Hs - ga, b.Hs - gb) > 0.08) B.poly('concrete', [[a.x, ga, a.z], [b.x, gb, b.z], [b.x, b.Hs, b.z], [a.x, a.Hs, a.z]], [(na[0] + nb[0]) / 2, 0, (na[1] + nb[1]) / 2], { color: BACK, uv: 1.5 });
        // edging: 12 cm of plain concrete along the edge, flush with the paving (a hair above it)
        const ia = [a.x - na[0] * 0.12, a.z - na[1] * 0.12], ib = [b.x - nb[0] * 0.12, b.z - nb[1] * 0.12];
        B.poly('concrete', [[a.x, a.Hs + 0.003, a.z], [b.x, b.Hs + 0.003, b.z], [ib[0], b.Hs + 0.003, ib[1]], [ia[0], a.Hs + 0.003, ia[1]]], [0, 1, 0], { color: EDGE, uv: 1.2 });
      }
    }
  };
  // paint the area into a mask: paint(x0, z0, x1, z1, fn) as hf.paintPave
  FW.paint = paintPave => {
    for (const J of joins) { const [x0, z0, x1, z1] = J.box; paintPave(x0, z0, x1, z1, (x, z) => probe(x, z, false).phiK > 0.05 ? 1 : 0); }
    for (const L of runs) for (const side of [1, -1]) for (const e of L[side]) { if (!e.walk) continue;
      const ext = e.n.hw + e.w + 1;
      for (let s = e.s0; s < e.s1; s += 4) { const a = RN.sampleAt(e.n, s), b = RN.sampleAt(e.n, Math.min(e.s1, s + 4));
        paintPave(Math.min(a.x, b.x) - ext, Math.min(a.z, b.z) - ext, Math.max(a.x, b.x) + ext, Math.max(a.z, b.z) + ext, (x, z) => probe(x, z, false).phiK > 0.05 ? 1 : 0); } }
    for (const a of arcs) { if (!a.walk) continue; const E = a.cr.rF + 0.5;
      paintPave(a.cr.O[0] - E, a.cr.O[1] - E, a.cr.O[0] + E, a.cr.O[1] + E, (x, z) => probe(x, z, false).phiK > 0.05 ? 1 : 0); }
  };
  return FW;
}
