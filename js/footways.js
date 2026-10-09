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
  let nid = 0;
  for (const [n, side, s0, s1, kind, rw] of RN.runs) runs[NI.get(n)][side].push({ id: nid++, type: 'run', n, side, s0, s1, kind, walk: kind === 'walk', w: rw, freeA: true, freeB: true });
  for (const L of runs) for (const side of [1, -1]) L[side].sort((a, b) => a.s0 - b.s0);
  for (const I of RN.inters) for (const cr of I.corners) {
    const p0 = cr.arc[0], p1 = cr.arc[cr.arc.length - 1], a1 = Math.atan2(p0[1] - cr.O[1], p0[0] - cr.O[0]), a2 = Math.atan2(p1[1] - cr.O[1], p1[0] - cr.O[0]);
    let span = a2 - a1; while (span > Math.PI) span -= 2 * Math.PI; while (span < -Math.PI) span += 2 * Math.PI;
    arcs.push({ id: nid++, type: 'arc', cr, kind: cr.kind, walk: cr.kind === 'walk', a1, span, arcL: Math.abs(span) * cr.rF, p0, p1 });
  }
  // a run's end is joined where a curb return starts at it (the corner takes over); elsewhere it is free and the footway
  // ends square across there
  const edgePt = (n, s, side) => { const q = RN.sampleAt(n, s), l = rot(q.d); return [q.x + l[0] * side * n.hw, q.z + l[1] * side * n.hw]; };
  for (const L of runs) for (const side of [1, -1]) for (const e of L[side]) {
    const A = edgePt(e.n, e.s0, side), Bp = edgePt(e.n, e.s1, side), at = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.45;
    for (const a of arcs) { if (at(A, a.p0) || at(A, a.p1)) e.freeA = false; if (at(Bp, a.p0) || at(Bp, a.p1)) e.freeB = false; }
    // (a run continued by the next run of the same side — a change of kind or width — is joined to it as well)
    for (const o of L[side]) if (o !== e) { if (Math.abs(o.s1 - e.s0) < 0.05) e.freeA = !(o.walk && e.walk) && e.freeA; if (Math.abs(o.s0 - e.s1) < 0.05) e.freeB = !(o.walk && e.walk) && e.freeB; }
    // (a free end where the road runs on onto a level-crossing deck: the deck's own footway panels take over flush)
    e.deckA = e.freeA && e.s0 > 0.3 && RN.skipAt(e.n, e.s0 - 0.3); e.deckB = e.freeB && e.s1 < e.n.PL.len - 0.3 && RN.skipAt(e.n, e.s1 + 0.3);
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
  const C = [], cand = () => { const c = { e: null, sd: 0, s: 0, along: 0, w: 0, endM: Infinity, deck: false, drop: 0, semi: false, nk: -1 }; C.push(c); return c; };
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
      const c = C[nc++]; c.e = a; c.sd = sd; c.s = sa; c.along = 1000 + sa; c.endM = Infinity; c.deck = false; c.nk = -1;
      if (a.walk) { const q = RN.cornerAt(cr, clamp(sa, 0, a.arcL), a.arcL); c.w = q.w; c.drop = q.drop; c.semi = q.semi; } else c.w = CLAIM[a.kind] || 0.16;
    }
    for (const k of seen) {
      const n = net[k], s = bs[k], side = bu[k] >= 0 ? 1 : -1, sd = bd[k] - n.hw, past = bpast[k];
      if (sd < 0 && past < 1e-6) carr = Math.max(carr, -sd);
      // the run of that side covering s (or the nearest one within reach of a joined end)
      // the run of that side covering s; and the footway run there — the covering one, or one whose free end lies just
      // behind (its end then has a gradient for the grid to cut it square on)
      let en = null, ew = null, ewM = -Infinity, ewD = false;
      for (const r of runs[k][side]) {
        const lo = r.s0 - (r.freeA ? 0 : OVER), hi = r.s1 + (r.freeB ? 0 : OVER);
        if (s < lo - 0.8 || s > hi + 0.8) continue;
        const mA = r.freeA ? s - r.s0 : Infinity, mB = r.freeB ? r.s1 - s : Infinity, m = Math.min(mA, mB, past > 0 ? -past : Infinity), dk = m === mA ? r.deckA : m === mB ? r.deckB : false;
        if (s >= lo && s <= hi) { if (r.walk) { ew = r; ewM = m; ewD = dk; } else en = r; continue; }
        if (r.walk && (s < lo ? r.freeA : r.freeB) && m > ewM && !(ew && ewM >= 0)) { ew = r; ewM = m; ewD = dk; }
      }
      if (en) { if (nc >= C.length) cand(); const c = C[nc++]; c.e = en; c.sd = sd; c.s = s; c.along = s; c.endM = Infinity; c.deck = false; c.nk = k; c.w = CLAIM[en.kind] || 0.16; }
      if (ew) { if (nc >= C.length) cand(); const c = C[nc++]; c.e = ew; c.sd = sd; c.s = s; c.along = s; c.endM = ewM; c.deck = ewD; c.nk = k; c.w = ew.w;
        dropAt(n, side, clamp(s, ew.s0, ew.s1), _d); c.drop = _d.drop; c.semi = _d.semi; }
    }
    // the footway's own kerb: the nearest kerb line that carries one (a little way into the road still counts, so the
    // edge along the kerb has a gradient for the grid to cut it on)
    let b1 = null, b2 = null;
    for (let i = 0; i < nc; i++) { const c = C[i]; if (!c.e.walk || c.sd < -0.8) continue; if (!b1 || c.sd < b1.sd) { b2 = b1; b1 = c; } else if (!b2 || c.sd < b2.sd) b2 = c; }
    if (!b1) { P.phi = P.phiK = -1; P.term = 'none'; P.e = null; P.H = P.Hs = NaN; P.T = null; if (P.wantC) P.cands = []; return P; }
    let phiN = Infinity;   // ground kept by road sides without a footway (not the one the footway itself ends against)
    for (let i = 0; i < nc; i++) { const c = C[i]; if (c.e.walk || c.sd < -0.3 || (c.nk === b1.nk && c.nk >= 0 && Math.sign(c.sd + 1e-9) === Math.sign(b1.sd + 1e-9) && b1.endM < 0.8)) continue; phiN = Math.min(phiN, c.sd - c.w); }
    // another road's carriageway (or a junction pad): the footway stops at its edge
    const phiC = carr > 0 && !(b1.sd < 0) ? -carr : Infinity;
    const tK = b1.sd - SEAM, tE = b1.endM;
    let tB = b1.w - b1.sd, backTerm = 'back', jy = 0, jd = 0, jmax = 0, hasJ = false;
    // joins: other paving close behind the footway (a riverside walkway): the narrow gap between them is paved too, the
    // footway's back carried on to that paving's edge, its surface eased from the footway's level to that paving's
    for (const J of joins) { if (tB > 0.6) break; const dJ = J.dist(x, z); if (dJ === null || dJ < -0.8) continue;
      const gap = (b1.sd - b1.w) + dJ; if (gap > J.max || gap < 0.05) continue;
      if (dJ > tB) { tB = dJ; backTerm = 'join'; hasJ = true; jy = J.y(x, z); jd = dJ; jmax = J.max; } }
    let phi = tK, term = 'kerb';
    if (tB < phi) { phi = tB; term = backTerm; } if (tE < phi) { phi = tE; term = b1.deck ? 'deck' : 'end'; } if (phiN < phi) { phi = phiN; term = 'other'; } if (phiC < phi) { phi = phiC; term = 'road'; }
    if (P.wantC) { const T = P.T || (P.T = {}); T.kerb = tK; T.back = backTerm === 'back' ? tB : Infinity; T.join = backTerm === 'join' ? tB : Infinity; T.end = b1.deck ? Infinity : tE; T.deck = b1.deck ? tE : Infinity; T.other = phiN; T.road = phiC; }
    P.phi = phi; P.phiK = Math.min(b1.sd, tB, tE, phiN, phiC); P.term = term; P.e = b1.e; P.along = b1.along; P.sd = b1.sd; P.w = b1.w;
    if (needH) {
      // (in a join, each footway's surface is eased from its back to the joined paving across the gap behind it)
      const hOf = (c, q0) => { let h = heightOf(c, x, z, Math.max(q0, c.sd));
        if (hasJ && c.sd > c.w) { const gap = (c.sd - c.w) + jd; if (gap > 0.05 && gap < jmax + 0.6) { const t = clamp((c.sd - c.w) / gap, 0, 1); h = lerp(h, jy, t * t * (3 - 2 * t)); } } return h; };
      P.H = hOf(b1, 0); P.Hs = hOf(b1, KERB_IN) + LIFT;
      // where two footways meet, their surfaces are blended across the seam
      if (b2 && b2.sd - b1.sd < 0.6 && b2.sd >= 0) { const f = 0.5 * (1 - smoothstep(0, 0.6, b2.sd - b1.sd));
        P.H = lerp(P.H, hOf(b2, 0), f); P.Hs = lerp(P.Hs, hOf(b2, KERB_IN) + LIFT, f); }
    }
    // (for the paving's builder: every footway kerb line near the point, with the point's paving coordinates from each)
    if (P.wantC) { P.cands = []; for (let i = 0; i < nc; i++) { const c = C[i]; if (c.e.walk && c.sd > -0.8) P.cands.push({ e: c.e, sd: c.sd, along: c.along }); } }
    return P;
  }
  // footway top at a point (kerb strip included), or null where there is none
  // (on the paving: the paving's own top, which lies a few millimetres over the kerb profile — what stands or is painted
  // on the footway sits on what is drawn)
  const walkY = (x, z) => { const p = probe(x, z); return p.phiK >= -1e-6 ? (p.sd >= KERB_IN ? p.Hs : p.H) : null; };

  // ---- the paving: a 0.5 m world grid clipped to the area
  // FW.joins: [{ dist(x, z): distance outside the other paving's edge (null: not here), y(x, z): its surface, max: widest
  // gap joined, box: [x0, z0, x1, z1] where it applies }]
  // FW.flush: [(x, z) => bool] — other paving built against the footway there: its edge gets no edging or skirt
  const FW = { probe, walkY, chains: [], joins, flush: [] };
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
    // Grid vertices and the points where a limit crosses a cell's edge are computed once and shared by the cells either
    // side, so no crack can open between them. A cell along the area's edge is clipped by each limit in turn (kerb,
    // back, end, another road's ground, a carriageway, a join, a deck): where two limits meet — the back and the end of a
    // footway — the corner comes out sharp, inside the cell, instead of cut off across it.
    const TERMS = ['kerb', 'back', 'join', 'end', 'deck', 'other', 'road'];
    const verts = new Map(); P.wantC = true;
    const fin = q => q > 50 ? 50 : q < -50 ? -50 : q;   // (a limit that does not apply here is far away, not infinite: crossings stay finite)
    const mk = (k, x, z, p, eks, g) => { const T = p.T ? {} : null; if (T) for (const t of TERMS) T[t] = fin(p.T[t]); return { k, x, z, Hs: p.Hs, along: p.along, sd: p.sd, o: p.e, cands: p.cands, T, eks, g }; };
    const vAt = (i, j) => { const k = 'v' + i + ',' + j; let v = verts.get(k); if (v) return v;
      const x = i * CELL, z = j * CELL, p = probe(x, z); v = mk(k, x, z, p, ['H' + i + ',' + j, 'H' + (i - 1) + ',' + j, 'V' + i + ',' + j, 'V' + i + ',' + (j - 1)], null); v.i = i; v.j = j; v.g = v;
      v.phi = p.phi; verts.set(k, v); return v; };
    const tv = (v, t) => v.T ? v.T[t] : -1;
    const common = (U, W) => { for (const e of U.eks) if (W.eks.includes(e)) return e; return null; };
    // a crossing on U-W, made once: on a cell edge shared with the neighbouring cell, inside a cell by its two ends
    const crossKey = (U, W, key) => { const ek = common(U, W); return [ek, (ek || (U.k < W.k ? U.k + '|' + W.k : W.k + '|' + U.k)) + '#' + key]; };
    // the point on U-W where field f is zero (regula falsi on the true field, from the two ends' values)
    const root = (U, W, fu, fw, f) => { let ax = U.x, az = U.z, fa = fu, bx = W.x, bz = W.z, fb = fw, x = ax, z = az;
      for (let it = 0; it < 6; it++) { const t = clamp(fa / (fa - fb), 0, 1); x = lerp(ax, bx, t); z = lerp(az, bz, t); const fm = f(x, z); if (Math.abs(fm) < 5e-4) break;
        if ((fm >= 0) === (fa >= 0)) { ax = x; az = z; fa = fm; } else { bx = x; bz = z; fb = fm; } } return [x, z]; };
    const newV = (k, ek, x, z, U, W, t) => { const p = probe(x, z), okU = Number.isFinite(U.Hs), okW = Number.isFinite(W.Hs);
      // (its grid vertex — for the normal and, where the probe finds no footway at the very edge, the surface — is one with a surface)
      const gU = U.g || U, gW = W.g || W, g = Number.isFinite(gU.Hs) && (t < 0.5 || !Number.isFinite(gW.Hs)) ? gU : Number.isFinite(gW.Hs) ? gW : gU, v = mk(k, x, z, p, ek ? [ek] : [], g);
      if (!Number.isFinite(v.Hs)) v.Hs = okU && okW ? lerp(U.Hs, W.Hs, t) : okU ? U.Hs : okW ? W.Hs : g.Hs;
      if (!v.cands || !v.T) { v.cands = (okU ? U : W).cands || g.cands; v.o = (okU ? U : W).o || g.o; v.along = g.along; v.sd = g.sd; } verts.set(k, v); return v; };
    const termCross = t => { const f = (x, z) => { const p = probe(x, z, false); return p.T ? fin(p.T[t]) : -1; };
      return (U, W, fu, fw) => { const [ek, k] = crossKey(U, W, t), v = verts.get(k); if (v) return v; const [x, z] = root(U, W, fu, fw, f);
        return newV(k, ek, x, z, U, W, Math.hypot(x - U.x, z - U.z) / (Math.hypot(W.x - U.x, W.z - U.z) || 1)); }; };
    const TC = Object.fromEntries(TERMS.map(t => [t, termCross(t)]));
    // Sutherland-Hodgman against val >= 0; tags[i]: what the edge from vertex i to the next is (null: inside the paving)
    const clip = (poly, tags, vs, cross, tag) => {
      const n = poly.length; if (vs.every(q => q >= 0)) return [poly, tags]; if (vs.every(q => q < 0)) return [[], []];
      const out = [], tagIn = [];
      for (let i = 0; i < n; i++) { const U = poly[i], W = poly[(i + 1) % n], fu = vs[i], fw = vs[(i + 1) % n], t = tags[i];
        if (fu >= 0 && fw >= 0) { out.push(W); tagIn.push(t); }
        else if (fu >= 0 && fw < 0) { out.push(cross(U, W, fu, fw)); tagIn.push(t); }
        else if (fu < 0 && fw >= 0) { out.push(cross(U, W, fu, fw)); tagIn.push(tag); out.push(W); tagIn.push(t); } }
      return [out, out.map((_, i) => tagIn[(i + 1) % out.length])]; };
    // seams: where the paving passes from one kerb line's footway to another's, a piece is cut along the line where the
    // two lie equally far (the footways' own boundary), so every piece carries one kerb line's paving coordinates and no
    // slab is smeared across the seam (sd to each line is near linear across a cell: the cut is interpolated)
    // (a kerb line's distance where a vertex did not list it: from the line itself)
    const sdTo = (X, x, z) => { if (X.type === 'arc') return X.cr.rF - Math.hypot(x - X.cr.O[0], z - X.cr.O[1]);
      let d = Infinity; for (const g of X.n.PL.segs) { const t = clamp((x - g.a[0]) * g.d[0] + (z - g.a[1]) * g.d[1], 0, g.L); d = Math.min(d, Math.hypot(x - g.a[0] - g.d[0] * t, z - g.a[1] - g.d[1] * t)); } return d - X.n.hw; };
    const sdOf = (v, X) => { if (v.cands) for (const c of v.cands) if (c.e === X) return c.sd; return sdTo(X, v.x, v.z); };
    const alongTo = (X, x, z) => { if (X.type === 'arc') { let rel = Math.atan2(z - X.cr.O[1], x - X.cr.O[0]) - X.a1; while (rel > Math.PI) rel -= 2 * Math.PI; while (rel < -Math.PI) rel += 2 * Math.PI; return 1000 + rel * Math.sign(X.span) * X.cr.rF; }
      let best = Infinity, sb = 0; for (const g of X.n.PL.segs) { const t = clamp((x - g.a[0]) * g.d[0] + (z - g.a[1]) * g.d[1], 0, g.L), d = Math.hypot(x - g.a[0] - g.d[0] * t, z - g.a[1] - g.d[1] * t); if (d < best) { best = d; sb = g.s0 + t; } } return sb; };
    const splitBy = (poly, tags, A, Bo) => { const g = poly.map(v => { const a = sdOf(v, A), b = sdOf(v, Bo); return a === null || b === null ? null : a - b; });
      if (g.some(q => q === null)) return null;
      const key = 's' + Math.min(A.id, Bo.id) + ',' + Math.max(A.id, Bo.id);
      const cross = (U, W, fu, fw) => { const [ek, k] = crossKey(U, W, key), v = verts.get(k); if (v) return v; const t = Math.abs(fu) / (Math.abs(fu) + Math.abs(fw));
        return newV(k, ek, lerp(U.x, W.x, t), lerp(U.z, W.z, t), U, W, t); };
      return [clip(poly, tags, g.map(q => -q), cross, 'seam'), clip(poly, tags, g, cross, 'seam')]; };
    const segs = [];
    const nrm = v => { v = v.g || v; if (v.n) return v.n;
      const H = (a, b) => { const q = vAt(v.i + a, v.j + b); return Number.isFinite(q.Hs) ? q.Hs : v.Hs; };
      const gx = (H(1, 0) - H(-1, 0)) / (2 * CELL), gz = (H(0, 1) - H(0, -1)) / (2 * CELL), L = Math.hypot(gx, 1, gz);
      return (v.n = [-gx / L, 1 / L, -gz / L]); };
    // (the grid's cells run clockwise seen from above: each polygon is turned over to face up, its attributes with it)
    const emitOwned = (poly0, X) => {
      if (poly0.length < 3) return;
      if (poly0.some(v => !Number.isFinite(v.Hs))) return;
      const poly = [...poly0].reverse();
      const pts = poly.map(v => [v.x, v.Hs, v.z]), uvs = poly.map(v => [v.x / 1.2, v.z / 1.2]), normals = poly.map(nrm);
      const ap = poly.map(v => { if (X) { if (v.cands) for (const c of v.cands) if (c.e === X) return [c.along, c.sd]; return [alongTo(X, v.x, v.z), sdTo(X, v.x, v.z)]; } return [v.along, v.sd]; });
      if (poly.length === 4) { B.quad('pavement', pts[0], pts[1], pts[2], pts[3], { color, uvs, normals, attr: { aPave: ap } }); return; }
      for (let i = 1; i + 1 < poly.length; i++) B.tri('pavement', pts[0], pts[i], pts[i + 1], { color, uvs: [uvs[0], uvs[i], uvs[i + 1]], normals: [normals[0], normals[i], normals[i + 1]], attr: { aPave: [ap[0], ap[i], ap[i + 1]] } });
    };
    const piece = (poly, tags, X) => { emitOwned(poly, X); for (let i = 0; i < poly.length; i++) { const t = tags[i]; if (t && t !== 'seam') segs.push([poly[i], poly[(i + 1) % poly.length], t]); } };
    const emit = (poly, tags) => {
      const cnt = new Map(); for (const v of poly) if (v.o) cnt.set(v.o, (cnt.get(v.o) || 0) + 1);
      const own = [...cnt.entries()].sort((a, b) => b[1] - a[1]).map(q => q[0]);
      if (own.length < 2) { piece(poly, tags, own[0]); return; }
      const parts = splitBy(poly, tags, own[0], own[1]);
      if (!parts) { piece(poly, tags, own[0]); return; }
      // (a third kerb line in the same cell — where three footways meet — is cut away from each half in turn)
      for (const [[half, ht], X] of [[parts[0], own[0]], [parts[1], own[1]]]) {
        const other = own.slice(2).find(Y => half.some(v => v.o === Y)), sub = other ? splitBy(half, ht, X, other) : null;
        if (sub) { piece(sub[0][0], sub[0][1], X); piece(sub[1][0], sub[1][1], other); } else piece(half, ht, X); } };
    for (const c of cells) {
      const i = Math.floor(c / 65536) - 32768, j = c % 65536 - 32768;
      const Q = [vAt(i, j), vAt(i + 1, j), vAt(i + 1, j + 1), vAt(i, j + 1)];
      if (Q.every(v => v.phi < 0) && Q.every(v => !v.T || TERMS.some(t => v.T[t] < -1.2))) continue;
      let poly = Q, tags = [null, null, null, null];
      for (const t of TERMS) { if (!poly.length) break; [poly, tags] = clip(poly, tags, poly.map(v => tv(v, t)), TC[t], t); }
      if (poly.length >= 3) emit(poly, tags);
    }
    // ---- the edges that are not a kerb, traced into chains
    for (const sg of segs) { sg[0].term = sg[0].term && sg[0].term !== 'kerb' && sg[0].term !== 'join' && sg[0].term !== 'deck' ? sg[0].term : sg[2]; if (!sg[1].term) sg[1].term = sg[2]; }
    const next = new Map(), prev = new Map(); for (const sg of segs) { next.set(sg[0].k, sg); prev.set(sg[1].k, sg); }
    const used = new Set(), chains = [];
    for (const sg of segs) { if (used.has(sg)) continue;
      // walk back to the chain's start (or round a loop), then forward
      let st = sg, guard = 0;
      while (prev.has(st[0].k) && !used.has(prev.get(st[0].k)) && prev.get(st[0].k) !== sg && guard++ < 100000) st = prev.get(st[0].k);
      const pts = [st[0]], tg = []; let cur = st;
      while (cur && !used.has(cur)) { used.add(cur); pts.push(cur[1]); tg.push(cur[2]); cur = next.get(cur[1].k); }
      const closed = pts.length > 2 && pts[pts.length - 1] === pts[0];
      chains.push({ pts, closed, tags: tg });
    }
    // outward normals (horizontal) along each chain, from its segments, averaged at the vertices
    for (const ch of chains) {
      const P2 = ch.pts, m = P2.length, sn = [];
      for (let i = 0; i + 1 < m; i++) { const a = P2[i], b = P2[i + 1], dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1; let nx = dz / L, nz = -dx / L;
        if (probe((a.x + b.x) / 2 + nx * 0.03, (a.z + b.z) / 2 + nz * 0.03, false).phi > probe((a.x + b.x) / 2 - nx * 0.03, (a.z + b.z) / 2 - nz * 0.03, false).phi) { nx = -nx; nz = -nz; } sn.push([nx, nz]); }
      ch.sn = sn;
      ch.n = P2.map((_, i) => { const a = sn[Math.max(0, i - 1)] || sn[0], b = sn[Math.min(sn.length - 1, i)] || a; let nx = a[0] + b[0], nz = a[1] + b[1];
        if (ch.closed && (i === 0 || i === m - 1)) { const c = sn[sn.length - 1], d = sn[0]; nx = c[0] + d[0]; nz = c[1] + d[1]; }
        const L = Math.hypot(nx, nz) || 1; return [nx / L, nz / L]; });
    }
    FW.chains = chains; P.wantC = false;
    return chains;
  };
  // the edges that are not a kerb: an edging strip along the paving's edge and a skirt down to the ground
  // ground(x, z): the terrain under the edge
  // skirt(x, z): whether a skirt may go down to the ground there (not over water, nor off a bridge deck); it reaches at
  // most SKIRT_MAX below the paving
  FW.buildEdges = (B, { ground, skirt = () => true } = {}) => {
    B.frame(0, 0, 0, 0);
    const EW = 0.12, SKIRT_MAX = 1.6, kerbish = t => t === 'kerb' || t === 'join' || t === 'deck';
    for (const ch of FW.chains) {
      const P2 = ch.pts, sn = ch.sn, m = P2.length, on = i => i >= 0 && i < m - 1 && !kerbish(ch.tags[i]);
      // the edging's inner line, mitred at its corners; where it meets a kerb it is cut square to its own segment
      const inner = i => { const a = on(i - 1) || (ch.closed && i === 0 && on(m - 2)) ? sn[i > 0 ? i - 1 : m - 2] : null, b = on(i) || (ch.closed && i === m - 1 && on(0)) ? sn[i < m - 1 ? i : 0] : null;
        const n0 = a && b ? [a[0] + b[0], a[1] + b[1]] : (a || b), L = Math.hypot(n0[0], n0[1]) || 1, nn = [n0[0] / L, n0[1] / L], ref = b || a, k = EW / Math.max(0.5, nn[0] * ref[0] + nn[1] * ref[1]);
        return [P2[i].x - nn[0] * k, P2[i].z - nn[1] * k]; };
      for (let i = 0; i + 1 < m; i++) { if (!on(i)) continue;
        const a = P2[i], b = P2[i + 1], s = sn[i], fx = (a.x + b.x) / 2 + s[0] * 0.1, fz = (a.z + b.z) / 2 + s[1] * 0.1;
        if (FW.flush.some(f => f(fx, fz))) continue;
        if (skirt(a.x, a.z) && skirt(b.x, b.z)) { const ga = Math.max(ground(a.x, a.z) - 0.06, a.Hs - SKIRT_MAX), gb = Math.max(ground(b.x, b.z) - 0.06, b.Hs - SKIRT_MAX);
          if (Math.max(a.Hs - ga, b.Hs - gb) > 0.08) B.poly('concrete', [[a.x, ga, a.z], [b.x, gb, b.z], [b.x, b.Hs, b.z], [a.x, a.Hs, a.z]], [s[0], 0, s[1]], { color: BACK, uv: 1.5 }); }
        // edging: 12 cm of plain concrete along the edge, flush with the paving (a hair above it)
        const ia = inner(i), ib = inner(i + 1);
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
