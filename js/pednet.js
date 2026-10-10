// The district's pedestrian network (歩行者ネットワーク). Every walking surface that is not a street's own footway —
// court and park paths, the branches to the doors, the buildings' own walks, entrance aprons and plazas — is one graph,
// and its geometry is generated from that graph:
//  - chains of points become nodes and edges. The stretches of a chain that lie on a street (footway or carriageway) or
//    on a paved area are cut away, so the chain ends exactly on that boundary and is attached to it; a free end that
//    reaches another path is carried on to its centreline and joined there (a T); chains that cross get a shared node
//  - one height field for all of this paving, H(x, z): the ground plus the paving's lift, blended up to a footway's back
//    edge wherever a path meets one (at most 1:16), so everything meeting at a point — the strips, a junction, an
//    apron, the footway — has the same height there
//  - edges are strips between their nodes' junction cut lines, draped on H every metre; junctions are polygons round
//    their node (inner corners filleted, outer corners rounded); an end on a footway or an area is cut along that
//    boundary, flush with it
//  - concrete edging wherever paving borders the lawn, a concrete skirt where paving stands above the lawn, and the lawn
//    itself raised to meet a path that climbs to a footway
// validate() reports what a walker would trip over: dead ends, gaps and steps at joints, slopes over 1:12, doors with
// no route to a street, and paving on buildings, on carriageways or running over other paving.
import { clamp, smoothstep } from './core.js';

export const LIFT = 0.05, RAMP = 1 / 16, MAX_GRADE = 1 / 12;
const HOLD = 1.5;   // (a joint's reach over the length of its fade to the lawn)
// path types and their widths: every chain is snapped to one of them (a width changes only at a junction). The
// buildings' own walks: along the low-rises' gallery fronts, under the mid-rises' corridors, behind the walk-ups' stair
// halls (flush with their aprons); then the branches to the doors, the court and park paths, the playground's spine and
// the fountain park's promenade
export const PATH_W = { front: 1.3, walk: 1.5, back: 1.8, branch: 2.0, path: 2.4, spine: 3.0, promenade: 4.0 };
export const snapWidth = w => { const V = Object.values(PATH_W); let best = V[0]; for (const v of V) { const d = Math.abs(v - w), db = Math.abs(best - w); if (d < db - 1e-6 || (Math.abs(d - db) < 1e-6 && v > best)) best = v; } return best; };

const hyp = Math.hypot;
export const inPoly = (P, x, z) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, zi] = P[i], [xj, zj] = P[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
const segDist = (px, pz, ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz, t = L2 ? clamp(((px - ax) * dx + (pz - az) * dz) / L2, 0, 1) : 0; return { d: hyp(px - ax - dx * t, pz - az - dz * t), t, x: ax + dx * t, z: az + dz * t }; };
const segX = (a, b, c, d) => { const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]], den = r[0] * s[1] - r[1] * s[0]; if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den, u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den; return t > 1e-3 && t < 1 - 1e-3 && u > 1e-3 && u < 1 - 1e-3 ? { t, u, p: [a[0] + r[0] * t, a[1] + r[1] * t] } : null; };
const sameTag = (a, b) => (!a && !b) || (!!a && !!b && a.k === b.k && a.i === b.i);

export class PedNet {
  // gy(x, z): ground; walkY(x, z): a street footway's top or null; roadAt(x, z): carriageway or null
  // onBuilding(x, z, m): a building's ground floor stands within m of (x, z)
  constructor({ gy, walkY, roadAt, onBuilding = () => false }) { this.gy = gy; this.walkY = walkY; this.roadAt = roadAt; this.onBuilding = onBuilding; this.chains = []; this.areas = []; this.fixList = []; this.fixed = new Map(); this.raised = []; }
  // a run of paving along pts; o: { w (snapped to its type), rid, mat, color, edge, door (a building's own walk: an end
  // may stop at the building) }
  addChain(pts, o = {}) { const P = []; for (const p of pts) if (!P.length || hyp(p[0] - P[P.length - 1][0], p[1] - P[P.length - 1][1]) > 0.15) P.push([p[0], p[1]]);
    if (P.length > 1) this.chains.push({ pts: P, w0: o.w ?? 2.4, w: snapWidth(o.w ?? 2.4), rid: o.rid ?? -1, mat: o.mat || 'pavement', color: o.color || [0.84, 0.82, 0.78], edge: o.edge !== false, door: !!o.door }); }
  // a paved area: draw — the network lays it (aprons, plazas: a quad) or its owner does (park paving, y(x, z) its
  // height); door — an entrance's apron (poly[0]-poly[1] is the side against the building, left without edging)
  addArea(poly, o = {}) { const xs = poly.map(p => p[0]), zs = poly.map(p => p[1]);
    this.areas.push({ poly, rid: o.rid ?? -1, draw: o.draw !== false, y: o.y || null, door: o.door ?? null, color: o.color || [0.8, 0.78, 0.74], bb: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] });
    return this.areas.length - 1; }
  // is (x, z) on the network's paving (a path's strip or an area), within pad metres
  onPaving(x, z, pad = 0) {
    if (this.areaAt(x, z) >= 0) return true;
    for (const e of this.edges || []) { if (e.dead) continue; const A = this.nodes[e.a], Bq = this.nodes[e.b], hw = this.chains[e.c].w / 2 + pad;
      if (x < Math.min(A.x, Bq.x) - hw || x > Math.max(A.x, Bq.x) + hw || z < Math.min(A.z, Bq.z) - hw || z > Math.max(A.z, Bq.z) + hw) continue;
      if (segDist(x, z, A.x, A.z, Bq.x, Bq.z).d < hw) return true; }
    return false;
  }
  areaAt(x, z) { for (let i = 0; i < this.areas.length; i++) if (this.inArea(i, x, z)) return i; return -1; }
  inArea(i, x, z) { const A = this.areas[i]; return x >= A.bb[0] && x <= A.bb[2] && z >= A.bb[1] && z <= A.bb[3] && inPoly(A.poly, x, z); }
  // is (x, z) on what a tag names (a street, or that particular area — areas may overlap)
  on(tag, x, z) { return tag.k === 'foot' ? this.onStreet(x, z) : this.inArea(tag.i, x, z); }
  onStreet(x, z) { return this.walkY(x, z) !== null || !!this.roadAt(x, z); }
  // what lies at a point: { k: 'foot' } a street, { k: 'area', i } a paved area, null open ground
  what(x, z) { if (this.onStreet(x, z)) return { k: 'foot' }; const i = this.areaAt(x, z); return i >= 0 ? { k: 'area', i } : null; }

  // ---------------------------------------------------------------- the height field
  // fixed heights: the joints where paving meets a footway's back edge (or paving laid by its owner), each a line of
  // heights sampled along it (gid: the joint)
  fix(x, z, y, gid, d) { this.fixList.push({ x, z, y, gid, d }); }
  // once all are in: each joint's reach — how far its height blends out to the lawn's at no more than 1:16: held for the
  // first third (so between joints close together the lawn has no say), then a smoothstep (1.5 times as steep as its
  // mean slope at its middle: the blend runs 1.5 times as far) — and two joints of
  // different heights close enough to need a ramp between them reach each other (so the blend between them is that
  // ramp, not two fades to the lawn); then filed by 4 m cells
  seal() { const G = new Map(), reach = dy => (1.5 * dy / RAMP + 0.3) * HOLD;
    for (const f of this.fixList) { if (!G.has(f.gid)) G.set(f.gid, { P: [], R: 1.5, d: f.d }); const g = G.get(f.gid); g.P.push([f.x, f.z, f.y]); g.R = Math.max(g.R, reach(Math.abs(f.y - this.gy(f.x, f.z) - LIFT))); }
    const L = [...G.values()];
    // (the lawn the joint fades into may fall or rise away from it: its reach is grown to the largest height difference
    // over the ground it covers, on the paving's side of the joint)
    for (const g of L) for (let it = 0; it < 2; it++) { let dy = 0; const R = g.R;
      for (const p of [g.P[0], g.P[g.P.length >> 1], g.P[g.P.length - 1]]) for (let a = 0; a < 12; a++) { const cx = Math.cos(a * Math.PI / 6), cz = Math.sin(a * Math.PI / 6); if (g.d && cx * g.d[0] + cz * g.d[1] < 0) continue;
        for (const f of [1 / 3, 2 / 3, 1]) dy = Math.max(dy, Math.abs(p[2] - this.gy(p[0] + cx * R * f, p[1] + cz * R * f) - LIFT)); }
      g.R = Math.max(g.R, reach(dy)); }
    for (const g of L) { const xs = g.P.map(p => p[0]), zs = g.P.map(p => p[1]); g.bb = [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)]; }
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) { const a = L[i], b = L[j];
      if (a.bb[0] > b.bb[2] + 12 || b.bb[0] > a.bb[2] + 12 || a.bb[1] > b.bb[3] + 12 || b.bb[1] > a.bb[3] + 12) continue;
      for (const p of a.P) for (const q of b.P) { const dy = Math.abs(p[2] - q[2]), r = hyp(p[0] - q[0], p[1] - q[1]); if (dy >= 0.02 && r < reach(dy) / HOLD) { a.R = Math.max(a.R, (r + 0.5) * HOLD); b.R = Math.max(b.R, (r + 0.5) * HOLD); } } }
    this.fixed = new Map();
    for (const g of L) for (let i = Math.floor((g.bb[0] - g.R) / 4); i <= Math.floor((g.bb[2] + g.R) / 4); i++) for (let j = Math.floor((g.bb[1] - g.R) / 4); j <= Math.floor((g.bb[3] + g.R) / 4); j++) { const k = i + ',' + j; if (!this.fixed.has(k)) this.fixed.set(k, []); this.fixed.get(k).push(g); } }
  // (the joints are blended by inverse distance to the nearest point of each — exact on every joint, and between two
  // joints of different heights a ramp no steeper than their height difference over their distance apart, whatever
  // the lawn does between them — and the lawn's own height takes over away from the nearest of them, over its reach)
  H(x, z) { const L = this.fixed.get(Math.floor(x / 4) + ',' + Math.floor(z / 4)), g0 = this.gy(x, z) + LIFT; if (!L) return g0;
    let sw = 0, sy = 0, fade = 0;
    for (const g of L) { let r = 1e9, y = 0; const P = g.P;
      if (P.length === 1) { r = hyp(x - P[0][0], z - P[0][1]); y = P[0][2]; }
      else for (let i = 0; i + 1 < P.length; i++) { const q = segDist(x, z, P[i][0], P[i][1], P[i + 1][0], P[i + 1][1]); if (q.d < r) { r = q.d; y = P[i][2] + (P[i + 1][2] - P[i][2]) * q.t; } }
      if (r >= g.R) continue; const k = 1 - smoothstep(g.R * (1 - 1 / HOLD), g.R, r); if (r < 1e-4) return y; const w = k / r; sw += w; sy += w * y; if (k > fade) fade = k; }
    return sw > 0 ? g0 + (sy / sw - g0) * fade : g0; }

  // ---------------------------------------------------------------- the graph
  solve() {
    const nodes = this.nodes = [], edges = this.edges = [];
    const node = (x, z, tag = null) => { nodes.push({ x, z, tag, e: [] }); return nodes.length - 1; };
    const edge = (a, b, c) => { if (a === b) return -1; edges.push({ a, b, c, dead: false }); nodes[a].e.push(edges.length - 1); nodes[b].e.push(edges.length - 1); return edges.length - 1; };
    const unlink = ei => { const e = edges[ei]; e.dead = true; nodes[e.a].e = nodes[e.a].e.filter(k => k !== ei); nodes[e.b].e = nodes[e.b].e.filter(k => k !== ei); };
    const merge = (keep, gone) => { if (keep === gone) return; const G = nodes[gone];
      for (const ei of G.e) { const e = edges[ei]; if (e.dead) continue; if (e.a === gone) e.a = keep; if (e.b === gone) e.b = keep; if (e.a === e.b) e.dead = true; else nodes[keep].e.push(ei); }
      if (G.tag && !nodes[keep].tag) nodes[keep].tag = G.tag; G.e = []; G.gone = true; nodes[keep].e = [...new Set(nodes[keep].e)].filter(k => !edges[k].dead); };
    const split = (ei, x, z) => { const e = edges[ei], n = node(x, z); unlink(ei); edge(e.a, n, e.c); edge(n, e.b, e.c); return n; };
    // 1. runs: each chain cut where it enters a street or an area, or where it runs along a path laid before it (on its
    //    paving and within 35 degrees of its direction — a link laid along the walk it leaves); a cut end carries what it
    //    meets (a path's end is left free, to be joined to that path below)
    const segGrid = new Map(), segKey = (i, j) => i + ',' + j;
    const addSeg = (ci, a, b) => { for (let i = Math.floor((Math.min(a[0], b[0]) - 3) / 8); i <= Math.floor((Math.max(a[0], b[0]) + 3) / 8); i++) for (let j = Math.floor((Math.min(a[1], b[1]) - 3) / 8); j <= Math.floor((Math.max(a[1], b[1]) + 3) / 8); j++) { const k = segKey(i, j); if (!segGrid.has(k)) segGrid.set(k, []); segGrid.get(k).push({ ci, a, b }); } };
    const along = (x, z, dx, dz, ci) => { for (const g of segGrid.get(segKey(Math.floor(x / 8), Math.floor(z / 8))) || []) { if (g.ci === ci) continue; const q = segDist(x, z, g.a[0], g.a[1], g.b[0], g.b[1]);
      if (q.d > this.chains[g.ci].w / 2 + 0.05) continue; const gl = hyp(g.b[0] - g.a[0], g.b[1] - g.a[1]) || 1; if (Math.abs((dx * (g.b[0] - g.a[0]) + dz * (g.b[1] - g.a[1])) / gl) > 0.82) return { k: 'path', i: g.ci }; } return null; };
    for (const [ci, C] of this.chains.entries()) {
      const runs = []; let run = null;
      for (let i = 0; i + 1 < C.pts.length; i++) {
        const [ax, az] = C.pts[i], [bx, bz] = C.pts[i + 1], L = hyp(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / 0.2)), at = f => [ax + (bx - ax) * f, az + (bz - az) * f];
        const st = (x, z) => this.what(x, z) || along(x, z, (bx - ax) / L, (bz - az) / L, ci);
        let prev = st(ax, az), pf = 0;
        if (i === 0 && !prev) run = { pts: [[ax, az]], t0: null };
        for (let k = 1; k <= n; k++) {
          const f = k / n, cur = st(...at(f));
          if (!sameTag(cur, prev)) { let lo = pf, hi = f; for (let q = 0; q < 16; q++) { const m = (lo + hi) / 2; if (sameTag(st(...at(m)), prev)) lo = m; else hi = m; } const p = at((lo + hi) / 2);
            // (a vertex can read differently from the two segments meeting at it — the along-a-path test depends on the
            // direction — so a stretch may leave open ground with no run open: it had none to close)
            if (!prev && run) { run.pts.push(p); run.t1 = cur; runs.push(run); run = null; }
            if (!cur) run = { pts: [p], t0: prev }; }
          prev = cur; pf = f;
        }
        if (run && !prev) run.pts.push([bx, bz]);
      }
      if (run) { run.t1 = null; runs.push(run); }
      const tagOf = t => t && t.k !== 'path' ? t : null;
      for (const r of runs) { const P = []; for (const p of r.pts) if (!P.length || hyp(p[0] - P[P.length - 1][0], p[1] - P[P.length - 1][1]) > 0.05) P.push(p);
        let len = 0; for (let i = 0; i + 1 < P.length; i++) len += hyp(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]); if (P.length < 2 || len < 0.4) continue;
        let a = node(P[0][0], P[0][1], tagOf(r.t0)); for (let i = 1; i < P.length; i++) { const b = node(P[i][0], P[i][1], i === P.length - 1 ? tagOf(r.t1) : null); edge(a, b, ci); a = b; }
        for (let i = 0; i + 1 < P.length; i++) addSeg(ci, P[i], P[i + 1]); }
    }
    // consecutive points of one chain are one node
    const len = e => hyp(nodes[e.b].x - nodes[e.a].x, nodes[e.b].z - nodes[e.a].z);
    // 2. crossings: a node where two runs cross
    for (let i = 0; i < edges.length; i++) { const A = edges[i]; if (A.dead) continue;
      for (let j = i + 1; j < edges.length; j++) { const Bq = edges[j]; if (A.dead) break; if (Bq.dead || A.a === Bq.a || A.a === Bq.b || A.b === Bq.a || A.b === Bq.b) continue;
        const h = segX([nodes[A.a].x, nodes[A.a].z], [nodes[A.b].x, nodes[A.b].z], [nodes[Bq.a].x, nodes[Bq.a].z], [nodes[Bq.b].x, nodes[Bq.b].z]); if (!h) continue;
        const n1 = split(i, h.p[0], h.p[1]), n2 = split(j, h.p[0], h.p[1]); merge(n1, n2); } }
    // 3. free ends: a stub that only runs on into other paving goes (a link run on into the path it joins, the bit of a
    //    path past a crossing); two ends that meet become one path; an end that reaches another path is carried on to
    //    its centreline (a T); an end that stops just short of a street or an area is carried on to it
    const free = ni => { const N = nodes[ni]; return !N.gone && !N.tag && N.e.length === 1; };
    const inRibbon = (x, z, skip) => { for (const [ei, e] of edges.entries()) { if (e.dead || ei === skip || (skip instanceof Array && skip.includes(ei))) continue; const A = nodes[e.a], Bq = nodes[e.b];
      if (segDist(x, z, A.x, A.z, Bq.x, Bq.z).d < this.chains[e.c].w / 2 + 0.05) return true; } return false; };
    // (a stub: under 2.5 m and either lying in other paving — wholly, or run on past a junction — or hanging off the far
    // side of an apron or the street; a link that comes in from the lawn and ends in the path it joins stays, to be
    // carried on to its centreline)
    const prune = () => { for (let any = true; any;) { any = false;
      for (let ni = 0; ni < nodes.length; ni++) { if (!free(ni)) continue; const N = nodes[ni], ei = N.e[0], e = edges[ei], o = nodes[e.a === ni ? e.b : e.a];
        if (len(e) < 2.5 && ((inRibbon(N.x, N.z, ei) && !this.what(N.x, N.z) && (o.e.length >= 3 || inRibbon(o.x, o.z, o.e))) || (o.tag && o.e.length === 1))) { unlink(ei); N.gone = true; if (o.e.length === 0) o.gone = true; any = true; } } } };
    prune();
    for (let ni = 0; ni < nodes.length; ni++) { if (!free(ni)) continue; const N = nodes[ni], wN = this.chains[edges[N.e[0]].c].w;
      for (let nj = ni + 1; nj < nodes.length; nj++) { if (!free(nj)) continue; const M = nodes[nj];
        if (hyp(M.x - N.x, M.z - N.z) < (wN + this.chains[edges[M.e[0]].c].w) / 4 + 0.6) { merge(ni, nj); break; } } }
    const snapFree = ni => { const N = nodes[ni]; if (!free(ni)) return;
      const e0 = edges[N.e[0]], o = e0.a === ni ? e0.b : e0.a, dl = hyp(N.x - nodes[o].x, N.z - nodes[o].z) || 1, ux = (N.x - nodes[o].x) / dl, uz = (N.z - nodes[o].z) / dl, w0 = this.chains[e0.c].w;
      let best = null;
      for (const [ei, e] of edges.entries()) { if (e.dead || e === e0 || e.a === ni || e.b === ni) continue; const A = nodes[e.a], Bq = nodes[e.b];
        const q = segDist(N.x, N.z, A.x, A.z, Bq.x, Bq.z); if (q.d > this.chains[e.c].w / 2 + 1.0) continue;
        if ((q.x - N.x) * ux + (q.z - N.z) * uz < -w0 / 2 - 0.3) continue;                                       // (behind the end)
        if (!best || q.d < best.d) best = { ei, ...q }; }
      if (best) { const e = edges[best.ei], at = best.t * len(e) < 0.4 ? e.a : (1 - best.t) * len(e) < 0.4 ? e.b : null, tgt = at ?? split(best.ei, best.x, best.z);
        if (hyp(nodes[tgt].x - N.x, nodes[tgt].z - N.z) < 0.35) merge(tgt, ni); else edge(ni, tgt, e0.c); return; }
      for (let t = 0.1; t <= 1.21; t += 0.1) { const w = this.what(N.x + ux * t, N.z + uz * t); if (!w) continue;
        let lo = 0, hi = t; for (let k = 0; k < 14; k++) { const m = (lo + hi) / 2; if (this.what(N.x + ux * m, N.z + uz * m)) hi = m; else lo = m; }
        N.x += ux * (lo + hi) / 2; N.z += uz * (lo + hi) / 2; N.tag = w; break; }
    };
    for (let ni = 0; ni < nodes.length; ni++) snapFree(ni);
    prune();
    // 3b. an end still left in the lawn is joined to the nearest paving within 6 m — a path, an area or a street — by a
    //     straight link of its own width that keeps off buildings and carriageways
    for (let ni = 0; ni < nodes.length; ni++) { if (!free(ni)) continue; const N = nodes[ni], e0 = edges[N.e[0]], C = this.chains[e0.c];
      if (C.door && this.onBuilding(N.x, N.z, 1.2)) continue;
      const own = new Set(); { const st = [ni]; while (st.length) { const k = st.pop(); for (const ei of nodes[k].e) { if (own.has(ei)) continue; if (edges[ei].c !== e0.c) continue; own.add(ei); st.push(edges[ei].a, edges[ei].b); } } }
      const clearTo = (x, z) => { const L = hyp(x - N.x, z - N.z), n = Math.max(1, Math.ceil(L / 0.25)); for (let k = 1; k < n; k++) { const px = N.x + (x - N.x) * k / n, pz = N.z + (z - N.z) * k / n; if (this.roadAt(px, pz) || this.onBuilding(px, pz, C.w / 2 + 0.2)) return false; } return true; };
      let best = null;
      for (const [ei, e] of edges.entries()) { if (e.dead || own.has(ei)) continue; const A = nodes[e.a], Bq = nodes[e.b], q = segDist(N.x, N.z, A.x, A.z, Bq.x, Bq.z);
        if (q.d < 6 && (!best || q.d < best.d) && clearTo(q.x, q.z)) best = { d: q.d, x: q.x, z: q.z, ei, t: q.t }; }
      for (const [ai, A] of this.areas.entries()) { if (A.bb[0] > N.x + 6 || A.bb[2] < N.x - 6 || A.bb[1] > N.z + 6 || A.bb[3] < N.z - 6) continue;
        for (let k = 0; k < A.poly.length; k++) { const p = A.poly[k], q2 = A.poly[(k + 1) % A.poly.length], q = segDist(N.x, N.z, p[0], p[1], q2[0], q2[1]);
          if (q.d < 6 && (!best || q.d < best.d) && clearTo(q.x, q.z)) best = { d: q.d, x: q.x, z: q.z, tag: { k: 'area', i: ai } }; } }
      for (let a = 0; a < 6.283; a += 0.196) for (let r = 0.25; r < 6 && (!best || r < best.d); r += 0.25) { const x = N.x + Math.cos(a) * r, z = N.z + Math.sin(a) * r;
        if (this.walkY(x, z) === null) continue; let lo = 0, hi = r; for (let k = 0; k < 12; k++) { const m = (lo + hi) / 2; if (this.walkY(N.x + Math.cos(a) * m, N.z + Math.sin(a) * m) !== null) hi = m; else lo = m; }
        const bx = N.x + Math.cos(a) * hi, bz = N.z + Math.sin(a) * hi; if (clearTo(bx, bz) && (!best || hi < best.d)) best = { d: hi, x: bx + Math.cos(a) * 0.05, z: bz + Math.sin(a) * 0.05, tag: { k: 'foot' } }; break; }
      if (!best) continue;
      if (best.ei !== undefined) { const e = edges[best.ei], tgt = best.t * len(e) < 0.4 ? e.a : (1 - best.t) * len(e) < 0.4 ? e.b : split(best.ei, best.x, best.z); edge(ni, tgt, e0.c); }
      else { const t = node(best.x, best.z, best.tag); edge(ni, t, e0.c); }
    }
    // 4. tidy: nodes closer than 0.35 m become one, duplicate edges go
    for (let pass = 0; pass < 3; pass++) for (const e of edges) { if (e.dead) continue; const lim = nodes[e.a].e.length >= 3 && nodes[e.b].e.length >= 2 || nodes[e.b].e.length >= 3 && nodes[e.a].e.length >= 2 ? Math.min(1.2, this.chains[e.c].w * 0.5) : 0.35; if (len(e) >= lim) continue; const A = nodes[e.a], Bq = nodes[e.b], keep = A.tag || (!Bq.tag && A.e.length >= Bq.e.length) ? e.a : e.b; e.dead = true; merge(keep, keep === e.a ? e.b : e.a); }
    for (const N of nodes) N.e = N.e.filter(k => !edges[k].dead);
    const seen = new Set(); for (const [ei, e] of edges.entries()) { if (e.dead) continue; const k = Math.min(e.a, e.b) + ',' + Math.max(e.a, e.b); if (seen.has(k)) unlink(ei); else seen.add(k); }
    // 4b. squared ends (run again once the junctions are clustered: a cluster can move the node before an end)
    const square = () => {
      // an end that meets an area's edge at a slant is turned to meet it square over its last metres, so the whole end
      // lies on that edge (a slanting end would leave one corner hanging past it)
      for (const [ni, N] of nodes.entries()) { if (N.gone || N.e.length !== 1 || !N.tag || N.tag.k !== 'area') continue;
        const A = this.areas[N.tag.i], e = edges[N.e[0]], o = nodes[e.a === ni ? e.b : e.a], hw = this.chains[e.c].w / 2; let bestK = -1, bd = 1e9;
        for (let k = 0; k < A.poly.length; k++) { const p = A.poly[k], q = A.poly[(k + 1) % A.poly.length], d = segDist(N.x, N.z, p[0], p[1], q[0], q[1]); if (d.d < bd) { bd = d.d; bestK = k; } }
        const p = A.poly[bestK], q = A.poly[(bestK + 1) % A.poly.length], L = hyp(q[0] - p[0], q[1] - p[1]); if (L < 2 * hw - 0.02) continue;
        let nx = (q[1] - p[1]) / L, nz = -(q[0] - p[0]) / L; if ((o.x - N.x) * nx + (o.z - N.z) * nz < 0) { nx = -nx; nz = -nz; }
        // slide the end along the edge so the whole path lies on the edge's span — square below the node before it if
        // that is on the span — then (if it still comes in slanting) bend it in
        const lo = Math.min(0.5, (hw + 0.1) / L), proj = (x, z) => ((x - p[0]) * (q[0] - p[0]) + (z - p[1]) * (q[1] - p[1])) / (L * L), to = proj(o.x, o.z);
        // (and its last metres clear of the building beside an apron)
        const clearAt = t => { const x = p[0] + (q[0] - p[0]) * t, z = p[1] + (q[1] - p[1]) * t; for (let s = 0; s <= 2.5; s += 0.25) for (const sg of [-1, 1]) if (this.onBuilding(x + nx * s + nz * hw * sg, z + nz * s - nx * hw * sg, 0.15)) return false; return true; };
        const tN = clamp(proj(N.x, N.z), lo, 1 - lo), cands = [...(to >= lo && to <= 1 - lo && (o.x - N.x) * nx + (o.z - N.z) * nz > hw + 0.3 ? [to] : []), tN];
        for (let k = 1; k <= 20; k++) for (const sg of [-1, 1]) { const t = tN + sg * k * 0.1 / L; if (t >= lo && t <= 1 - lo) cands.push(t); }
        const t = cands.find(clearAt) ?? tN; N.x = p[0] + (q[0] - p[0]) * t; N.z = p[1] + (q[1] - p[1]) * t;
        const ux = (o.x - N.x) / (hyp(o.x - N.x, o.z - N.z) || 1), uz = (o.z - N.z) / (hyp(o.x - N.x, o.z - N.z) || 1); if (ux * nx + uz * nz > 0.9995) continue;
        const run = Math.min(hw + 0.8, Math.max(hw + 0.45, hyp(o.x - N.x, o.z - N.z) * 0.6));
        if (hyp(o.x - N.x, o.z - N.z) < run + 0.3) continue; // (too short to bend in: the bend would fold back over the path)
        const m = node(N.x + nx * run, N.z + nz * run); nodes[m].sq = true; const ei = N.e[0], ce = e.c; unlink(ei); edge(o === nodes[e.a] ? e.a : e.b, m, ce); edge(m, ni, ce); }
      for (const N of nodes) N.e = N.e.filter(k => !edges[k].dead);
      // an end on a footway meets its back edge square, and off a lowered kerb's slope (a crossing's or a
      // driveway's): slid along the footway to where the back edge is level over the whole end, then turned in square
      for (const [ni, N] of nodes.entries()) { if (N.gone || N.e.length !== 1 || !N.tag || N.tag.k !== 'foot') continue;
        const e = edges[N.e[0]], oi = e.a === ni ? e.b : e.a, o = nodes[oi], hw = this.chains[e.c].w / 2, l0 = hyp(o.x - N.x, o.z - N.z) || 1, ux = (N.x - o.x) / l0, uz = (N.z - o.z) / l0;
        // the footway's back edge reached from (x, z) along (dx, dz); its tangent there; how much its height varies over an end
        const edgeAt = (x, z, dx, dz) => { let lo = -2.5, hi = 2.5; const on = t => this.onStreet(x + dx * t, z + dz * t); if (on(lo) || !on(hi)) return null; for (let k = 0; k < 16; k++) { const m = (lo + hi) / 2; if (on(m)) hi = m; else lo = m; } return [x + dx * hi, z + dz * hi]; };
        const normalAt = (x, z) => { const a = edgeAt(x - uz * 0.8, z + ux * 0.8, ux, uz), b = edgeAt(x + uz * 0.8, z - ux * 0.8, ux, uz); if (!a || !b) return null; let tx = a[0] - b[0], tz = a[1] - b[1]; const l = hyp(tx, tz) || 1; tx /= l; tz /= l;
          let nx = -tz, nz = tx; if (nx * -ux + nz * -uz < 0) { nx = -nx; nz = -nz; } return [nx, nz, tx, tz]; };          // (pointing off the footway)
        // a clean joint: the back edge level (within 2 cm) and straight (within 4 cm) across the whole end, and no other
        // footway alongside the path's last 3 m (not in a corner's curb return); 1e9 where it is not
        const spread = (x, z, n) => { let mn = 1e9, mx = -1e9; const E = [];
          for (let k = -1; k <= 1; k += 0.25) { const p = edgeAt(x + n[2] * hw * k + n[0], z + n[3] * hw * k + n[1], -n[0], -n[1]); if (!p) return 1e9; const y = this.walkY(p[0] - n[0] * 0.04, p[1] - n[1] * 0.04); if (y === null) return 1e9; mn = Math.min(mn, y); mx = Math.max(mx, y); E.push(p); }
          const a = E[0], b = E[E.length - 1], L = hyp(b[0] - a[0], b[1] - a[1]) || 1; for (const p of E) if (Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) / L > 0.04) return 1e9;
          for (let t = 0.4; t <= 3; t += 0.4) for (const sg of [-1, 1]) if (this.onStreet(x + n[0] * t + n[2] * (hw + 0.3) * sg, z + n[1] * t + n[3] * (hw + 0.3) * sg)) return 1e9;
          return mx - mn; };
        let n = normalAt(N.x, N.z) || [-ux, -uz, -uz, ux];  // (in a corner the edge's own normal may not be found)
        if (spread(N.x, N.z, n) > 0.02) { let found = null; // (slid square to the way it came: along the footway it was heading for)
          for (let sft = 0.25; sft <= 12 && !found; sft += 0.25) for (const sg of [-1, 1]) { const x = N.x - uz * sft * sg, z = N.z + ux * sft * sg, p = edgeAt(x - ux, z - uz, ux, uz); if (!p) continue;
            const n2 = normalAt(p[0], p[1]); if (n2 && spread(p[0], p[1], n2) <= 0.02 && !this.onBuilding(p[0], p[1], hw)) { found = [p, n2]; break; } }
          if (found) { N.x = found[0][0]; N.z = found[0][1]; n = found[1]; } }
        if ((o.x - N.x) * n[0] + (o.z - N.z) * n[1] > 0.9995 * hyp(o.x - N.x, o.z - N.z)) continue;
        const run = Math.min(hw + 0.8, Math.max(hw + 0.45, hyp(o.x - N.x, o.z - N.z) * 0.6)); if (hyp(o.x - N.x, o.z - N.z) < run + 0.3) continue;
        const m = node(N.x + n[0] * run, N.z + n[1] * run), ce = e.c; nodes[m].sq = true; unlink(N.e[0]); edge(oi, m, ce); edge(m, ni, ce); }
      for (const N of nodes) N.e = N.e.filter(k => !edges[k].dead);
    };
    square();
    // 4c. two paths whose ends would overlap on one edge of an area: the narrower one joins the wider before it
    const edgeOf = (A, x, z) => { let best = null; for (let k = 0; k < A.poly.length; k++) { const p = A.poly[k], q = A.poly[(k + 1) % A.poly.length], d = segDist(x, z, p[0], p[1], q[0], q[1]); if (!best || d.d < best.d) best = { k, d: d.d, s: d.t * hyp(q[0] - p[0], q[1] - p[1]) }; } return best; };
    for (let pass = 0; pass < 2; pass++) for (let i = 0; i < nodes.length; i++) { const A = nodes[i]; if (A.gone || A.e.length !== 1 || !A.tag || A.tag.k !== 'area') continue;
      const ea = edgeOf(this.areas[A.tag.i], A.x, A.z);
      for (let j = 0; j < nodes.length; j++) { const Bq = nodes[j]; if (j === i || Bq.gone || Bq.e.length !== 1 || !sameTag(A.tag, Bq.tag)) continue;
        const eb = edgeOf(this.areas[A.tag.i], Bq.x, Bq.z), wa = this.chains[edges[A.e[0]].c].w, wb = this.chains[edges[Bq.e[0]].c].w;
        if (ea.k !== eb.k || Math.abs(ea.s - eb.s) >= (wa + wb) / 2 + 0.1) continue;
        const n1 = wa < wb || (wa === wb && i > j) ? i : j, n2 = n1 === i ? j : i, N1 = nodes[n1], e1 = edges[N1.e[0]], p1 = e1.a === n1 ? e1.b : e1.a; if (nodes[p1].tag) continue;
        // the joint goes on the wider path far enough back from the area for a clean T: walk back along it
        const w2 = Math.max(wa, wb), back = w2 / 2 + Math.min(wa, wb) + 0.6; let cur = n2, prev = -1, left = back, at = null;
        while (left > 0) { const cand = nodes[cur].e.filter(k => { const g = edges[k]; return (g.a === cur ? g.b : g.a) !== prev; }); if (cand.length !== 1) break; const g = edges[cand[0]], nxt = g.a === cur ? g.b : g.a, l = len(g);
          if (l > left + 0.3) { const f = left / l; at = split(cand[0], nodes[cur].x + (nodes[nxt].x - nodes[cur].x) * f, nodes[cur].z + (nodes[nxt].z - nodes[cur].z) * f); break; } left -= l; prev = cur; cur = nxt; if (!nodes[cur].tag && nodes[cur].e.length !== 2) { at = cur; break; } }
        unlink(N1.e[0]); N1.gone = true;
        if (at !== null && hyp(nodes[at].x - nodes[p1].x, nodes[at].z - nodes[p1].z) < 5) { if (hyp(nodes[at].x - nodes[p1].x, nodes[at].z - nodes[p1].z) < 0.35) merge(at, p1); else edge(p1, at, e1.c); } else snapFree(p1);
        break; } }
    for (const N of nodes) N.e = N.e.filter(k => !edges[k].dead);
    // 4d. clusters: nodes joined by an edge shorter than half the paths' width become one junction (a bend next to an
    //     attached end is taken out, the end staying where it is — but not the bend that squares an end: the bend stays
    //     and the node beyond it goes)
    const wMax = ni => Math.max(...nodes[ni].e.map(k => this.chains[edges[k].c].w), 0);
    for (let any = true, guard = 0; any && guard < 6; guard++) { any = false;
      for (const e of edges) { if (e.dead) continue; const A = nodes[e.a], Bq = nodes[e.b], lim = 0.5 * Math.max(wMax(e.a), wMax(e.b)) + 0.2; if (len(e) >= lim) continue;
        if (!A.tag && !Bq.tag) { const keep = A.sq !== Bq.sq ? (A.sq ? e.a : e.b) : A.e.length >= Bq.e.length ? e.a : e.b; e.dead = true; merge(keep, keep === e.a ? e.b : e.a); any = true; }
        else if (A.tag && !Bq.tag && Bq.e.length === 2 && !Bq.sq) { e.dead = true; merge(e.a, e.b); any = true; }
        else if (Bq.tag && !A.tag && A.e.length === 2 && !A.sq) { e.dead = true; merge(e.b, e.a); any = true; } }
      for (const N of nodes) N.e = N.e.filter(k => !edges[k].dead); }
    for (const N of nodes) N.e = N.e.filter(k => !edges[k].dead);
    square();
    this.outlines();
    // 5. heights: every joint with a footway (or with paving its owner laid) fixes the paving's height along it
    for (const [ni, N] of nodes.entries()) { if (N.gone || N.e.length !== 1 || !N.tag) continue;
      const J = this.ends.get(ni), A = this.areas[N.tag.i]; if (!J) continue; if (N.tag.k === 'area' && !A.y) continue;
      const [p, q] = J.pts, L = hyp(q[0] - p[0], q[1] - p[1]), n = Math.max(1, Math.ceil(L / 0.4));
      for (let k = 0; k <= n; k++) { const x = p[0] + (q[0] - p[0]) * k / n, z = p[1] + (q[1] - p[1]) * k / n, ix = x - J.d[0] * 0.04, iz = z - J.d[1] * 0.04;
        const y = N.tag.k === 'foot' ? (this.walkY(ix, iz) ?? null) : A.y(ix, iz); if (y !== null) this.fix(x, z, y - (N.tag.k === 'foot' ? 0.004 : 0), ni, J.d); } }
    this.seal();
    return this;
  }

  // ---------------------------------------------------------------- junction and strip outlines
  outlines() {
    const { nodes, edges, chains } = this;
    const out = (ni, e) => { const N = nodes[ni], O = nodes[e.a === ni ? e.b : e.a], l = hyp(O.x - N.x, O.z - N.z) || 1; return [(O.x - N.x) / l, (O.z - N.z) / l, l]; };
    // where a side line p + d t (t from t0 down to t1) passes into what the end is attached to
    const cross = (px, pz, dx, dz, t0, t1, tag) => { const hit = t => this.on(tag, px + dx * t, pz + dz * t);
      if (hit(t0) || !hit(t1)) return null; let a = t0, b = t1; for (let k = 0; k < 18; k++) { const m = (a + b) / 2; if (hit(m)) b = m; else a = m; } return (a + b) / 2; };
    this.cuts = new Map();      // `${edge}:${node}` -> { m, p }: where the strip starts on its - and + sides (m from the node)
    this.junctions = []; this.ends = new Map();
    for (const [ni, N] of nodes.entries()) {
      if (N.gone || !N.e.length) continue;
      const inc = N.e.map(ei => { const [dx, dz, l] = out(ni, edges[ei]); return { ei, d: [dx, dz], n: [-dz, dx], hw: chains[edges[ei].c].w / 2, len: l, ang: Math.atan2(dz, dx) }; }).sort((a, b) => a.ang - b.ang);
      if (inc.length === 1) { // an end: square, or cut along what it is attached to
        const I = inc[0], cut = { m: 0, p: 0 }, pts = [];
        for (const [sg, key] of [[-1, 'm'], [1, 'p']]) { const px = N.x + I.n[0] * I.hw * sg, pz = N.z + I.n[1] * I.hw * sg;
          const t = N.tag ? cross(px, pz, I.d[0], I.d[1], Math.min(2.5, I.len * 0.45), -2.5, N.tag) : null; cut[key] = t ?? 0; pts.push([px + I.d[0] * cut[key], pz + I.d[1] * cut[key]]); }
        this.cuts.set(I.ei + ':' + ni, cut); this.ends.set(ni, { pts, d: I.d, ei: I.ei }); continue; }
      const m = inc.length, corner = [];
      for (let i = 0; i < m; i++) { const A = inc[i], Bq = inc[(i + 1) % m]; let gap = Bq.ang - A.ang; if (i === m - 1) gap += Math.PI * 2;
        if (gap < Math.PI - 0.02 && gap > 0.15) { // inner corner: A's + side meets B's - side, filleted
          const pa = [N.x + A.n[0] * A.hw, N.z + A.n[1] * A.hw], pb = [N.x - Bq.n[0] * Bq.hw, N.z - Bq.n[1] * Bq.hw], den = A.d[0] * Bq.d[1] - A.d[1] * Bq.d[0], r = [pb[0] - pa[0], pb[1] - pa[1]];
          const ta = (r[0] * Bq.d[1] - r[1] * Bq.d[0]) / den, tb = (r[0] * A.d[1] - r[1] * A.d[0]) / den;
          const rf = Math.min(0.9, (A.hw + Bq.hw) * 0.4), td = rf / Math.tan(gap / 2), C = [pa[0] + A.d[0] * ta, pa[1] + A.d[1] * ta], bis = [A.d[0] + Bq.d[0], A.d[1] + Bq.d[1]], bl = hyp(...bis) || 1, oc = rf / Math.sin(gap / 2);
          const O = [C[0] + bis[0] / bl * oc, C[1] + bis[1] / bl * oc], T1 = [C[0] + A.d[0] * td, C[1] + A.d[1] * td], T2 = [C[0] + Bq.d[0] * td, C[1] + Bq.d[1] * td];
          const a1 = Math.atan2(T1[1] - O[1], T1[0] - O[0]), a2 = Math.atan2(T2[1] - O[1], T2[0] - O[0]); let da = a2 - a1; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
          const pts = [], k = Math.max(2, Math.ceil(Math.abs(da) * rf / 0.25)); for (let j = 0; j <= k; j++) { const aa = a1 + da * j / k; pts.push([O[0] + Math.cos(aa) * rf, O[1] + Math.sin(aa) * rf]); }
          corner.push({ ta: ta + td, tb: tb + td, pts });
        } else if (gap >= Math.PI - 0.02) { // outer corner: round, about the node
          const a0 = A.ang + Math.PI / 2, sw = gap - Math.PI, k = Math.max(1, Math.ceil(Math.max(0, sw) * Math.max(A.hw, Bq.hw) / 0.25)), pts = [];
          for (let j = 0; j <= k; j++) { const aa = a0 + sw * j / k, rr = A.hw + (Bq.hw - A.hw) * j / k; pts.push([N.x + Math.cos(aa) * rr, N.z + Math.sin(aa) * rr]); }
          corner.push({ ta: 0, tb: 0, pts });
        } else corner.push({ ta: 0, tb: 0, pts: [], bad: true });                                       // (two runs on top of each other)
      }
      const cut = inc.map((I, i) => Math.min(Math.max(corner[(i - 1 + m) % m].tb, corner[i].ta, 0.05), I.len * 0.45));
      const poly = [], kind = [];  // kind: 1 for an outline piece that borders the lawn, 0 for a cut line (a strip goes on)
      inc.forEach((I, i) => { const t = cut[i];
        poly.push([N.x - I.n[0] * I.hw + I.d[0] * t, N.z - I.n[1] * I.hw + I.d[1] * t]); kind.push(0);
        poly.push([N.x + I.n[0] * I.hw + I.d[0] * t, N.z + I.n[1] * I.hw + I.d[1] * t]); kind.push(1);
        for (const p of corner[i].pts) { poly.push(p); kind.push(1); }
        this.cuts.set(I.ei + ':' + ni, { m: t, p: t }); });
      this.junctions.push({ ni, poly, kind, inc, bad: corner.some(c => c.bad) });
    }
  }

  // strip of edge ei: its two sides (relative to a -> b, `-n` and `+n`) as point lists of the same length, the along
  // distance (from a) of every row, and the chain
  strip(ei) {
    const e = this.edges[ei], A = this.nodes[e.a], Bq = this.nodes[e.b], C = this.chains[e.c], L = hyp(Bq.x - A.x, Bq.z - A.z), d = [(Bq.x - A.x) / L, (Bq.z - A.z) / L], n = [-d[1], d[0]], hw = C.w / 2;
    const ca = this.cuts.get(ei + ':' + e.a) || { m: 0, p: 0 }, cb = this.cuts.get(ei + ':' + e.b) || { m: 0, p: 0 };
    const sm = [ca.m, L - cb.p], sp = [ca.p, L - cb.m], k = Math.max(1, Math.ceil(Math.max(sm[1] - sm[0], sp[1] - sp[0]) / 1.0)), M = [], P = [], T = [];
    for (let j = 0; j <= k; j++) { const tm = sm[0] + (sm[1] - sm[0]) * j / k, tp = sp[0] + (sp[1] - sp[0]) * j / k;
      M.push([A.x + d[0] * tm - n[0] * hw, A.z + d[1] * tm - n[1] * hw]); P.push([A.x + d[0] * tp + n[0] * hw, A.z + d[1] * tp + n[1] * hw]); T.push([tm, tp]); }
    return { M, P, T, C, d, n, hw, L, A, B: Bq };
  }

  // ---------------------------------------------------------------- geometry
  // The network's paving is laid as one area: the union of its shapes — every path's strip (its ends mitred where it runs
  // on into the next stretch, carried to the node where it meets a walk across it), the junctions where three or more
  // paths meet at angles, and the aprons and plazas it lays. A path coming into a wider walk only abuts it: the walk's
  // edge runs straight on past the mouth, the corners are sharp. Every point belongs to the shape it lies deepest in, and
  // takes that shape's slab pattern (a path's slabs run on along its whole chain). The paving is laid on a 0.5 m grid
  // clipped to the union's boundary and, between shapes, to the seam where they meet; the boundary is traced into chains
  // and the concrete edging is one mitred band along each, broken only where other paving lies outside it (a footway, a
  // carriageway, paving another builder laid) — so edging pieces never overlap, never leave gaps at a corner.
  // o: { cover(x, z, rid, ignore): another surface's paving lies here (no edging), raise(x, z, y): lift the lawn to y }
  build(B, o = {}) {
    const { nodes, edges, chains } = this, H = (x, z) => this.H(x, z), EDGE = [0.74, 0.74, 0.72], CELL = 0.5;
    const netRids = new Set([...chains.map(c => c.rid), ...this.areas.filter(A => A.draw).map(A => A.rid)]);
    // ---- the shapes: { poly, bb, frame(x, z) -> [along, across], C (material / colour / edge / rid) }
    const shapes = [];
    // (a convex shape is also kept as its edges' half-planes: clipped by each in turn its corners come out exact, where a
    // corner inside a grid cell would otherwise be cut off across the cell)
    const addShape = (poly, frame, C, extra = {}) => { const xs = poly.map(p => p[0]), zs = poly.map(p => p[1]);
      let area = 0; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) area += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
      const sg = area >= 0 ? 1 : -1, planes = []; let convex = true;
      for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length], r = poly[(i + 2) % poly.length], L = hyp(q[0] - p[0], q[1] - p[1]); if (L < 1e-6) continue;
        if (((q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0])) * sg < -1e-9) convex = false;
        const n = [-(q[1] - p[1]) / L * sg, (q[0] - p[0]) / L * sg]; planes.push([n[0], n[1], n[0] * p[0] + n[1] * p[1]]); }
      shapes.push({ id: shapes.length, poly, frame, C, bb: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)], planes: convex ? planes : null, w: extra.w ?? 0, ...extra }); };
    // a chain's own arclength at a point (so its slabs run on unbroken from stretch to stretch)
    const chainS = (C, x, z) => { if (!C._s) { C._s = [0]; for (let i = 1; i < C.pts.length; i++) C._s.push(C._s[i - 1] + hyp(C.pts[i][0] - C.pts[i - 1][0], C.pts[i][1] - C.pts[i - 1][1])); }
      let best = 1e9, s = 0; for (let i = 0; i + 1 < C.pts.length; i++) { const q = segDist(x, z, C.pts[i][0], C.pts[i][1], C.pts[i + 1][0], C.pts[i + 1][1]); if (q.d < best) { best = q.d; s = C._s[i] + q.t * hyp(C.pts[i + 1][0] - C.pts[i][0], C.pts[i + 1][1] - C.pts[i][1]); } } return s; };
    const out = (ni, ei) => { const e = edges[ei], N = nodes[ni], O = nodes[e.a === ni ? e.b : e.a], l = hyp(O.x - N.x, O.z - N.z) || 1; return [(O.x - N.x) / l, (O.z - N.z) / l]; };
    const lineX = (p, d, q, f) => { const den = d[0] * f[1] - d[1] * f[0]; if (Math.abs(den) < 1e-6) return null; return ((q[0] - p[0]) * f[1] - (q[1] - p[1]) * f[0]) / den; };
    const junctionPoly = new Set();
    // each edge's end at a node: [t on its - side, t on its + side] measured from the node along the edge
    const endCut = (ei, ni) => {
      const e = edges[ei], N = nodes[ni], inc = N.e.filter(k => !edges[k].dead), hw = chains[e.c].w / 2, d = out(ni, ei), n = [-d[1], d[0]];
      if (inc.length === 1) { const c = this.cuts.get(ei + ':' + ni) || { m: 0, p: 0 }; return [c.m, c.p]; } // (as the end was cut)
      // the partner it runs on into: the most nearly opposite edge, within 35 degrees of straight
      let partner = null, bestDot = -0.82;
      for (const k of inc) { if (k === ei) continue; const d2 = out(ni, k), dt = d[0] * d2[0] + d[1] * d2[1]; if (dt < bestDot) { bestDot = dt; partner = k; } }
      if (inc.length === 2 && !partner) partner = inc.find(k => k !== ei);
      const through = inc.some(k => k !== ei && inc.some(k2 => k2 !== k && k2 !== ei && (() => { const p1 = out(ni, k), p2 = out(ni, k2); return p1[0] * p2[0] + p1[1] * p2[1] < -0.82; })()));
      if (partner !== null) {
        const d2 = out(ni, partner), n2 = [-d2[1], d2[0]], hw2 = chains[edges[partner].c].w / 2;
        // the mitre through the meeting points of the two outer and the two inner side lines
        const sides = [-1, 1].map(sg => { const p = [N.x + n[0] * hw * sg, N.z + n[1] * hw * sg], q = [N.x - n2[0] * hw2 * sg, N.z - n2[1] * hw2 * sg], t = lineX(p, d, q, d2); return t; });
        if (sides.every(t => t !== null && Math.abs(t) < Math.max(hw, hw2) * 2.2)) return sides;
        if (Math.abs(bestDot) > 0.99 || bestDot < -0.99) return [0, 0];
        junctionPoly.add(ni); return [0, 0];
      }
      if (!through) junctionPoly.add(ni); return [0, 0];  // (a stem into a walk across it: carried to the node; where paths meet at angles, the junction's own polygon round it)
    };
    for (const [ei, e] of edges.entries()) { if (e.dead) continue;
      const A = nodes[e.a], Bq = nodes[e.b], C = chains[e.c], L = hyp(Bq.x - A.x, Bq.z - A.z) || 1, d = [(Bq.x - A.x) / L, (Bq.z - A.z) / L], n = [-d[1], d[0]], hw = C.w / 2;
      const [am, ap] = endCut(ei, e.a), [bm, bp] = (() => { const c = endCut(ei, e.b); return [c[1], c[0]]; })(); // (from b the sides swap)
      // a stem that only reaches a walk across it is carried to the node (inside that walk); at a mitre the cut stands
      const poly = [[A.x + d[0] * am - n[0] * hw, A.z + d[1] * am - n[1] * hw], [Bq.x - d[0] * bm - n[0] * hw, Bq.z - d[1] * bm - n[1] * hw], [Bq.x - d[0] * bp + n[0] * hw, Bq.z - d[1] * bp + n[1] * hw], [A.x + d[0] * ap + n[0] * hw, A.z + d[1] * ap + n[1] * hw]];
      const s0 = chainS(C, A.x, A.z), s1 = chainS(C, Bq.x, Bq.z), dir = s1 >= s0 ? 1 : -1;
      addShape(poly, (x, z) => [s0 + dir * ((x - A.x) * d[0] + (z - A.z) * d[1]), 0.5 + hw + ((x - A.x) * n[0] + (z - A.z) * n[1]) * dir], C, { rid: C.rid, edge: C.edge, w: C.w });
    }
    for (const J of this.junctions) { if (!junctionPoly.has(J.ni)) continue;
      const W = J.inc.reduce((a, b) => b.hw > a.hw ? b : a), e = edges[W.ei], C = chains[e.c], A = nodes[e.a], Bq = nodes[e.b], L = hyp(Bq.x - A.x, Bq.z - A.z) || 1, d = [(Bq.x - A.x) / L, (Bq.z - A.z) / L], n = [-d[1], d[0]], s0 = chainS(C, A.x, A.z);
      addShape(J.poly, (x, z) => [s0 + (x - A.x) * d[0] + (z - A.z) * d[1], 0.5 + C.w / 2 + (x - A.x) * n[0] + (z - A.z) * n[1]], C, { rid: C.rid, edge: J.inc.some(I => chains[edges[I.ei].c].edge), junction: true, w: C.w + 0.01 }); }
    for (const A of this.areas) { if (!A.draw) continue;
      // (its slabs square to its first side, running into the area)
      const [a, b] = A.poly, L1 = hyp(b[0] - a[0], b[1] - a[1]) || 1, u = [(b[0] - a[0]) / L1, (b[1] - a[1]) / L1], cx = A.poly.reduce((q, p) => q + p[0], 0) / A.poly.length, cz = A.poly.reduce((q, p) => q + p[1], 0) / A.poly.length;
      let v = [-u[1], u[0]]; if ((cx - a[0]) * v[0] + (cz - a[1]) * v[1] < 0) v = [-v[0], -v[1]];
      addShape(A.poly, (x, z) => [(x - a[0]) * u[0] + (z - a[1]) * u[1], 0.5 + (x - a[0]) * v[0] + (z - a[1]) * v[1]], { mat: 'pavement', color: A.color }, { rid: A.rid, edge: true, area: A, w: 1e3 }); }
    // signed distance into a shape's polygon (+ inside)
    const sd = (S, x, z) => { const P = S.poly; let d = 1e9, inside = false;
      for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, zi] = P[i], [xj, zj] = P[j];
        if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
        d = Math.min(d, segDist(x, z, xj, zj, xi, zi).d); }
      return inside ? d : -d; };
    // spatial index (4 m cells)
    const IX = new Map(), ik = (i, j) => i * 92821 + j;
    for (const S of shapes) for (let i = Math.floor((S.bb[0] - 1) / 4); i <= Math.floor((S.bb[2] + 1) / 4); i++) for (let j = Math.floor((S.bb[1] - 1) / 4); j <= Math.floor((S.bb[3] + 1) / 4); j++) { const k = ik(i, j); if (!IX.has(k)) IX.set(k, []); IX.get(k).push(S); }
    const near = (x, z) => IX.get(ik(Math.floor(x / 4), Math.floor(z / 4))) || [];
    // ---- the paving grid
    const cells = new Set(), ck = (i, j) => (i + 32768) * 65536 + (j + 32768);
    for (const S of shapes) for (let i = Math.floor(S.bb[0] / CELL) - 1; i <= Math.floor(S.bb[2] / CELL) + 1; i++) for (let j = Math.floor(S.bb[1] / CELL) - 1; j <= Math.floor(S.bb[3] / CELL) + 1; j++)
      if (sd(S, (i + 0.5) * CELL, (j + 0.5) * CELL) > -CELL * 1.2) cells.add(ck(i, j));
    const verts = new Map();
    const mkV = (k, x, z, eks) => ({ k, x, z, eks, ph: new Map(), y: H(x, z) });
    const phOf = (v, S) => { let p = v.ph.get(S.id); if (p === undefined) { p = sd(S, v.x, v.z); v.ph.set(S.id, p); } return p; };
    const vAt = (i, j) => { const k = 'v' + i + ',' + j; let v = verts.get(k); if (v) return v; v = mkV(k, i * CELL, j * CELL, ['H' + i + ',' + j, 'H' + (i - 1) + ',' + j, 'V' + i + ',' + j, 'V' + i + ',' + (j - 1)]); v.i = i; v.j = j; verts.set(k, v); return v; };
    const common = (U, W) => { for (const e of U.eks) if (W.eks.includes(e)) return e; return null; };
    const cross = (U, W, key, f, fu, fw) => { const ek = common(U, W), k = (ek || (U.k < W.k ? U.k + '|' + W.k : W.k + '|' + U.k)) + '#' + key; let v = verts.get(k); if (v) return v;
      let ax = U.x, az = U.z, fa = fu, bx = W.x, bz = W.z, fb = fw, x = ax, z = az;
      for (let it = 0; it < 8; it++) { const t = clamp(fa / (fa - fb), 0, 1); x = ax + (bx - ax) * t; z = az + (bz - az) * t; const fm = f(x, z); if (Math.abs(fm) < 2e-4) break; if ((fm >= 0) === (fa >= 0)) { ax = x; az = z; fa = fm; } else { bx = x; bz = z; fb = fm; } }
      v = mkV(k, x, z, ek ? [ek] : []); verts.set(k, v); return v; };
    const clip = (poly, tags, vs, cr, tag) => { const n = poly.length; if (vs.every(q => q >= 0)) return [poly, tags]; if (vs.every(q => q < 0)) return [[], []];
      const outP = [], tIn = [];
      for (let i = 0; i < n; i++) { const U = poly[i], W = poly[(i + 1) % n], fu = vs[i], fw = vs[(i + 1) % n], t = tags[i];
        if (fu >= 0 && fw >= 0) { outP.push(W); tIn.push(t); }
        else if (fu >= 0) { outP.push(cr(U, W, fu, fw)); tIn.push(t); }
        else if (fw >= 0) { outP.push(cr(U, W, fu, fw)); tIn.push(tag); outP.push(W); tIn.push(t); } }
      return [outP, outP.map((_, i) => tIn[(i + 1) % outP.length])]; };
    const nrm = (x, z) => { const h = 0.25, gx = (H(x + h, z) - H(x - h, z)) / (2 * h), gz = (H(x, z + h) - H(x, z - h)) / (2 * h), L = Math.hypot(gx, 1, gz); return [-gx / L, 1 / L, -gz / L]; };
    const emit = (poly0, S) => { if (poly0.length < 3) return; const poly = [...poly0].reverse(), C = S.C;
      const pts = poly.map(v => [v.x, v.y, v.z]), uvs = poly.map(v => [v.x / 1.2, v.z / 1.2]), normals = poly.map(v => nrm(v.x, v.z)), ap = poly.map(v => S.frame(v.x, v.z));
      const attr = C.mat === 'pavement' ? { aPave: ap } : undefined;
      if (poly.length === 4) { B.quad(C.mat, pts[0], pts[1], pts[2], pts[3], { color: C.color, uvs, normals, attr }); return; }
      for (let i = 1; i + 1 < poly.length; i++) B.tri(C.mat, pts[0], pts[i], pts[i + 1], { color: C.color, uvs: [uvs[0], uvs[i], uvs[i + 1]], normals: [normals[0], normals[i], normals[i + 1]], attr: attr && { aPave: [ap[0], ap[i], ap[i + 1]] } }); };
    const bsegs = [];
    B.frame(0, 0, 0, 0);
    for (const c of cells) {
      const i = Math.floor(c / 65536) - 32768, j = c % 65536 - 32768, Q = [vAt(i, j), vAt(i + 1, j), vAt(i + 1, j + 1), vAt(i, j + 1)];
      const cand = near((i + 0.5) * CELL, (j + 0.5) * CELL).filter(S => Q.some(v => phOf(v, S) > -CELL * 1.5));
      if (!cand.length || !Q.some(v => cand.some(S => phOf(v, S) >= 0)) && !cand.some(S => Q.some(v => phOf(v, S) > -0.75))) continue;
      for (const A of cand) {
        // the part of the cell this shape owns: its paving (clipped to its own edge first), less where another shape lies
        // deeper (ties to the earlier one) — the seams only ever run where both are paved
        let poly = Q, tags = [null, null, null, null];
        if (A.planes) A.planes.forEach(([nx, nz, c], k) => { if (poly.length < 3) return; const f = (x, z) => nx * x + nz * z - c;
          [poly, tags] = clip(poly, tags, poly.map(v => f(v.x, v.z)), (U, W, fu, fw) => cross(U, W, 'p' + A.id + '_' + k, f, fu, fw), 'edge'); });
        else [poly, tags] = clip(poly, tags, poly.map(v => phOf(v, A)), (U, W, fu, fw) => cross(U, W, 'b' + A.id, (x, z) => sd(A, x, z), fu, fw), 'edge');
        // where shapes overlap the wider one keeps the overlap (a walk runs on past a path's mouth); shapes of one width
        // share it along the line where they lie equally deep (a stretch running on into the next)
        for (const S of cand) { if (S === A || poly.length < 3) continue;
          if (S.w > A.w + 0.005) { [poly, tags] = clip(poly, tags, poly.map(v => -phOf(v, S)), (U, W, fu, fw) => cross(U, W, 'x' + S.id, (x, z) => -sd(S, x, z), fu, fw), 'seam'); continue; }
          if (A.w > S.w + 0.005) continue;
          const key = 's' + Math.min(A.id, S.id) + ',' + Math.max(A.id, S.id), vs = poly.map(v => phOf(v, A) - phOf(v, S) + (A.id < S.id ? 1e-6 : -1e-6));
          [poly, tags] = clip(poly, tags, vs, (U, W, fu, fw) => cross(U, W, key, (x, z) => sd(A, x, z) - sd(S, x, z), fu, fw), 'seam'); }
        if (poly.length < 3) continue;
        emit(poly, A);
        // (a piece's edge is the network's boundary only where no other shape is paved just outside it: two stretches
        // butting end to end each end on the line where the other begins)
        for (let k = 0; k < poly.length; k++) if (tags[k] === 'edge') { const a = poly[k], b = poly[(k + 1) % poly.length], dx = b.x - a.x, dz = b.z - a.z, L = hyp(dx, dz); if (L < 1e-4) continue;
          let nx = dz / L, nz = -dx / L; const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2; if (sd(A, mx + nx * 0.02, mz + nz * 0.02) > sd(A, mx - nx * 0.02, mz - nz * 0.02)) { nx = -nx; nz = -nz; }
          if (near(mx, mz).some(S => S !== A && sd(S, mx + nx * 0.03, mz + nz * 0.03) > 0)) continue;
          bsegs.push([a, b, A]); }
      }
    }
    // ---- the boundary traced into chains (ends joined by position: the corner where two shapes' edges meet is reached
    // from both), each oriented with the paving on its left
    const qk = v => Math.round(v.x * 500) + ',' + Math.round(v.z * 500);
    const next = new Map(); for (const s of bsegs) { const k = qk(s[0]); if (!next.has(k)) next.set(k, []); next.get(k).push(s); }
    const used = new Set(), runs = [];
    for (const s0 of bsegs) { if (used.has(s0)) continue;
      // walk back to the start of this run (or once round a loop)
      let st = s0; const prevOf = new Map(); for (const s of bsegs) prevOf.set(qk(s[1]), s);
      for (let g = 0; g < 100000; g++) { const p = prevOf.get(qk(st[0])); if (!p || used.has(p) || p === s0) break; st = p; }
      const pts = [st[0]], own = []; let cur = st;
      while (cur && !used.has(cur)) { used.add(cur); pts.push(cur[1]); own.push(cur[2]); const L = next.get(qk(cur[1])) || []; cur = L.find(s => !used.has(s)) || null; }
      runs.push({ pts, own, closed: qk(pts[0]) === qk(pts[pts.length - 1]) });
    }
    // ---- the edging: a band 10 cm wide outside the boundary, its top 1.5 cm above the paving, a skirt down to the lawn
    // where the paving stands above it; laid where nothing else is paved outside, mitred at every corner
    const EW = 0.1, TOP = 0.015;
    for (const R of runs) {
      const P = R.pts, m = P.length; if (m < 2) continue;
      // outward normal of each segment (the paving lies on the left of the run as the polygons were wound clockwise and
      // then turned over: the outside is found by probing)
      const sn = [];
      for (let i = 0; i + 1 < m; i++) { const a = P[i], b = P[i + 1], dx = b.x - a.x, dz = b.z - a.z, L = hyp(dx, dz) || 1; let nx = dz / L, nz = -dx / L;
        const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, S = R.own[i]; if (sd(S, mx + nx * 0.05, mz + nz * 0.05) > sd(S, mx - nx * 0.05, mz - nz * 0.05)) { nx = -nx; nz = -nz; } sn.push([nx, nz]); }
      const on = sn.map((n, i) => { const a = P[i], b = P[i + 1], S = R.own[i]; if (!S.edge) return false;
        // (an apron's side against its building has no edging)
        if (S.area && S.area.door !== null) { const [p0, p1] = S.area.poly; if (segDist(a.x, a.z, p0[0], p0[1], p1[0], p1[1]).d < 0.03 && segDist(b.x, b.z, p0[0], p0[1], p1[0], p1[1]).d < 0.03) return false; }
        const mx = (a.x + b.x) / 2 + n[0] * 0.14, mz = (a.z + b.z) / 2 + n[1] * 0.14;
        return !(o.cover && o.cover(mx, mz, S.rid, netRids)); });
      const offAt = i => { const a = sn[i - 1] && on[i - 1] ? sn[i - 1] : null, b = sn[i] && on[i] ? sn[i] : null, A2 = a || (R.closed && i === 0 && on[m - 2] ? sn[m - 2] : null), B2 = b || (R.closed && i === m - 1 && on[0] ? sn[0] : null);
        const n0 = A2 && B2 ? [A2[0] + B2[0], A2[1] + B2[1]] : (A2 || B2), L = hyp(n0[0], n0[1]) || 1, nn = [n0[0] / L, n0[1] / L], ref = B2 || A2, k = EW / Math.max(0.35, nn[0] * ref[0] + nn[1] * ref[1]);
        return [P[i].x + nn[0] * k, P[i].z + nn[1] * k]; };
      for (let i = 0; i + 1 < m; i++) { if (!on[i]) continue;
        const a = P[i], b = P[i + 1], oa = offAt(i), ob = offAt(i + 1), ya = a.y + TOP, yb = b.y + TOP, n = sn[i];
        B.detail(1, () => {
          B.poly('concrete', [[a.x, ya, a.z], [b.x, yb, b.z], [ob[0], yb, ob[1]], [oa[0], ya, oa[1]]], [0, 1, 0], { color: EDGE, uv: 1.2 });
          B.poly('concrete', [[a.x, a.y - 0.01, a.z], [b.x, b.y - 0.01, b.z], [b.x, yb, b.z], [a.x, ya, a.z]], [-n[0], 0, -n[1]], { color: EDGE }); });
        // its outer face down into the lawn (a skirt where the paving stands above it)
        const ga = this.gy(oa[0] + n[0] * 0.05, oa[1] + n[1] * 0.05) - 0.06, gb = this.gy(ob[0] + n[0] * 0.05, ob[1] + n[1] * 0.05) - 0.06;
        B.poly('concrete', [[oa[0], Math.min(ga, ya - 0.08), oa[1]], [ob[0], Math.min(gb, yb - 0.08), ob[1]], [ob[0], yb, ob[1]], [oa[0], ya, oa[1]]], [n[0], 0, n[1]], { color: EDGE });
        // (an end of the band: closed)
        for (const [p, q2, y, end] of [[a, oa, ya, i === 0 || !on[i - 1]], [b, ob, yb, i + 1 === m - 1 || !on[i + 1]]]) if (end && !(R.closed && on[(i === 0 ? m - 2 : 0)])) {
          const t = [q2[0] - p.x, q2[1] - p.z]; B.poly('concrete', [[p.x, y - 0.12, p.z], [q2[0], y - 0.12, q2[1]], [q2[0], y, q2[1]], [p.x, y, p.z]], [t[1], 0, -t[0]], { color: EDGE }); }
        for (const [x, z, y] of [[a.x, a.z, a.y], [b.x, b.z, b.y]]) if (y - LIFT - this.gy(x, z) > 0.015) this.raised.push([x + n[0] * 0.14, z + n[1] * 0.14, y - LIFT - 0.008]);
      }
    }
    // the lawn raised to meet paving that climbs to a footway
    if (o.raise) for (const [x, z, y] of this.raised) o.raise(x, z, y);
  }

  // ---------------------------------------------------------------- validation
  // ctx: { onBuilding(x, z): paving there stands on a building's ground floor, doors: [{ area, name }] }
  validate(ctx = {}) {
    const { nodes, edges, chains } = this, issues = [], f = v => v.toFixed(1), at = (x, z) => `(${f(x)}, ${f(z)})`, H = (x, z) => this.H(x, z);
    // dead ends: an end that is not on a street, an area or a path — a building's own walk may stop at its building
    for (const [ni, N] of nodes.entries()) { if (N.gone || N.e.length !== 1 || N.tag) continue;
      const C = chains[edges[N.e[0]].c]; if (C.door && ctx.onBuilding && ctx.onBuilding(N.x, N.z, 1.2)) continue;
      issues.push(`dead end at ${at(N.x, N.z)}`); }
    // gaps and steps: every strip end against its junction or the boundary it is cut to
    for (const J of this.junctions) { if (J.bad) issues.push(`paths on top of each other at ${at(nodes[J.ni].x, nodes[J.ni].z)}`);
      for (const I of J.inc) { const S = this.strip(I.ei), e = edges[I.ei], atA = e.a === J.ni, m = atA ? S.M[0] : S.P[S.P.length - 1], p = atA ? S.P[0] : S.M[S.M.length - 1];
        const near = q => J.poly.some(r => hyp(r[0] - q[0], r[1] - q[1]) < 0.005); if (!near(m) || !near(p)) issues.push(`gap between a strip and its junction at ${at(nodes[J.ni].x, nodes[J.ni].z)}`); } }
    for (const [ni, E] of this.ends) { const N = nodes[ni]; if (!N.tag) continue;
      for (const q of E.pts) {
        if (this.on(N.tag, q[0] + E.d[0] * 0.06, q[1] + E.d[1] * 0.06)) issues.push(`end at ${at(q[0], q[1])} does not stop at the boundary it joins`);
        const cx = N.x - q[0], cz = N.z - q[1], cl = hyp(cx, cz) || 1; // (a corner exactly on the target's side: tested a hair inside the strip)
        if (![0, 0.03].some(k => this.on(N.tag, q[0] - E.d[0] * 0.06 + cx / cl * k, q[1] - E.d[1] * 0.06 + cz / cl * k))) issues.push(`gap between the end at ${at(q[0], q[1])} and what it joins`);
        const yTo = N.tag.k === 'foot' ? this.walkY(q[0] - E.d[0] * 0.04, q[1] - E.d[1] * 0.04) : this.areas[N.tag.i].y ? this.areas[N.tag.i].y(q[0] - E.d[0] * 0.04, q[1] - E.d[1] * 0.04) : H(q[0] - E.d[0] * 0.04, q[1] - E.d[1] * 0.04);
        if (yTo === null) issues.push(`end at ${at(q[0], q[1])} meets a carriageway, not a footway`);
        else if (Math.abs(H(q[0], q[1]) - yTo) > 0.012) issues.push(`step of ${(H(q[0], q[1]) - yTo).toFixed(3)} m where the path at ${at(q[0], q[1])} meets ${N.tag.k === 'foot' ? 'the footway' : 'paving'}`); } }
    // slopes along every strip side, and paving that stands on a building, a carriageway or other paving
    for (const [ei, e] of edges.entries()) { if (e.dead) continue; const S = this.strip(ei);
      for (const side of [S.M, S.P]) for (let j = 0; j + 1 < side.length; j++) { const [ax, az] = side[j], [bx, bz] = side[j + 1], l = hyp(bx - ax, bz - az); if (l < 0.05) continue;
        const g = Math.abs(H(bx, bz) - H(ax, az)) / l; if (g > MAX_GRADE) { issues.push(`slope 1:${(1 / g).toFixed(0)} on the path at ${at(ax, az)}`); break; } }
      for (let j = 0; j + 1 < S.M.length; j++) for (const t of [0.15, 0.5, 0.85]) { const mx = (S.M[j][0] + S.M[j + 1][0]) / 2, mz = (S.M[j][1] + S.M[j + 1][1]) / 2, px = (S.P[j][0] + S.P[j + 1][0]) / 2, pz = (S.P[j][1] + S.P[j + 1][1]) / 2, x = mx + (px - mx) * t, z = mz + (pz - mz) * t;
        if (this.roadAt(x, z) || this.walkY(x, z) !== null) { issues.push(`path on the street at ${at(x, z)}`); j = 1e9; break; }
        const ai = this.areaAt(x, z); if (ai >= 0) { issues.push(`path over paving at ${at(x, z)}`); j = 1e9; break; }
        if (ctx.onBuilding && ctx.onBuilding(x, z, S.C.door ? 0 : 0.1) && (!S.C.door || t === 0.5)) { issues.push(`path through a building at ${at(x, z)}`); j = 1e9; break; } }
      // running alongside a street's footway (a second pavement beside the first) for more than 5 m
      { let run = 0; for (let t = 0; t <= S.L; t += 0.5) { const x = S.A.x + S.d[0] * t, z = S.A.z + S.d[1] * t;
        if ([-1, 1].some(sg => [0.6, 1.2, 1.8].some(o => this.walkY(x + S.n[0] * sg * (S.hw + o), z + S.n[1] * sg * (S.hw + o)) !== null))) run += 0.5; else run = 0;
        if (run > 5) { issues.push(`path alongside the footway at ${at(x, z)}`); break; } } }
      // running over another path (away from the joints where they meet: within two edges of this one's ends)
      const near2 = new Set(); for (const k of [e.a, e.b]) for (const ej of nodes[k].e) { near2.add(ej); const g = edges[ej]; for (const kk of [g.a, g.b]) for (const ek of nodes[kk].e) near2.add(ek); }
      for (let t = 0.5; t < S.L - 0.5; t += 0.5) { const x = S.A.x + S.d[0] * t, z = S.A.z + S.d[1] * t; let hit = null;
        for (const [ej, g] of edges.entries()) { if (g.dead || ej === ei) continue; const A = nodes[g.a], Bq = nodes[g.b], q = segDist(x, z, A.x, A.z, Bq.x, Bq.z), lim = (S.C.w + chains[g.c].w) / 2 - 0.25;
          if (q.d >= lim) continue; if (near2.has(ej) && [e.a, e.b].some(k => hyp(nodes[k].x - x, nodes[k].z - z) < (S.C.w + chains[g.c].w) / 2 + 2.5)) continue; hit = [x, z]; break; }
        if (hit) { issues.push(`two paths overlap at ${at(...hit)}`); break; } } }
    // slopes over the junctions and the aprons and plazas the network lays (the steepest way across, on a 0.4 m grid)
    const steep = (P, what) => { const xs = P.map(p => p[0]), zs = P.map(p => p[1]);
      for (let x = Math.min(...xs) + 0.2; x < Math.max(...xs); x += 0.4) for (let z = Math.min(...zs) + 0.2; z < Math.max(...zs); z += 0.4) { if (!inPoly(P, x - 0.2, z) || !inPoly(P, x + 0.2, z) || !inPoly(P, x, z - 0.2) || !inPoly(P, x, z + 0.2)) continue;
        const g = hyp(H(x + 0.2, z) - H(x - 0.2, z), H(x, z + 0.2) - H(x, z - 0.2)) / 0.4; if (g > MAX_GRADE) { issues.push(`slope 1:${(1 / g).toFixed(0)} on ${what} at ${at(x, z)}`); return; } } };
    for (const J of this.junctions) steep(J.poly, 'a junction');
    for (const A of this.areas) if (A.draw) steep(A.poly, A.door !== null ? 'an apron' : 'a plaza');
    // every door reaches a street over the network
    if (ctx.doors) { const adj = new Map(), link = (a, b) => { if (!adj.has(a)) adj.set(a, new Set()); if (!adj.has(b)) adj.set(b, new Set()); adj.get(a).add(b); adj.get(b).add(a); };
      for (const e of edges) if (!e.dead) link('n' + e.a, 'n' + e.b);
      for (const [ni, N] of nodes.entries()) if (!N.gone && N.tag) link('n' + ni, N.tag.k === 'foot' ? 'street' : 'a' + N.tag.i);
      for (const [ai, A] of this.areas.entries()) { const P = A.poly; let touch = false; for (let k = 0; k < P.length && !touch; k++) { const p = P[k], q = P[(k + 1) % P.length]; for (let t = 0; t <= 1; t += 0.1) { const x = p[0] + (q[0] - p[0]) * t, z = p[1] + (q[1] - p[1]) * t; if (this.onStreet(x, z)) { touch = true; break; } } } if (touch) link('a' + ai, 'street');
        for (const [aj, A2] of this.areas.entries()) if (aj > ai && A2.bb[0] <= A.bb[2] + 0.3 && A2.bb[2] >= A.bb[0] - 0.3 && A2.bb[1] <= A.bb[3] + 0.3 && A2.bb[3] >= A.bb[1] - 0.3 && P.some(p => inPoly(A2.poly, p[0], p[1]) || A2.poly.some(q => inPoly(P, q[0], q[1])))) link('a' + ai, 'a' + aj); }
      const reach = k0 => { const seen = new Set([k0]), st = [k0]; while (st.length) { const k = st.pop(); if (k === 'street') return true; for (const q of adj.get(k) || []) if (!seen.has(q)) { seen.add(q); st.push(q); } } return false; };
      // (a door with an apron starts from it; one without — a low-rise's gallery door on its front walk, a shop on its
      // arcade — from what it opens onto: the street, a paved area, or a path's paving)
      for (const D of ctx.doors) { let k0 = null;
        if (D.area !== undefined) k0 = 'a' + D.area;
        else if (this.onStreet(D.x, D.z)) k0 = 'street';
        else { const ai = this.areaAt(D.x, D.z); if (ai >= 0) k0 = 'a' + ai;
          else for (const [ei, e] of edges.entries()) { if (e.dead) continue; const A = nodes[e.a], Bq = nodes[e.b]; if (segDist(D.x, D.z, A.x, A.z, Bq.x, Bq.z).d < chains[e.c].w / 2 + 0.05) { k0 = 'n' + e.a; break; } } }
        if (k0 === null) issues.push(`${D.name}: its door at ${at(D.x, D.z)} opens onto no paving`);
        else if (!reach(k0)) { if (ctx.unreached) ctx.unreached.push(D); const A = D.area !== undefined ? this.areas[D.area].bb : null; issues.push(`${D.name}: no route from its door at ${A ? at((A[0] + A[2]) / 2, (A[1] + A[3]) / 2) : at(D.x, D.z)} to a street`); } } }
    return issues;
  }
}
