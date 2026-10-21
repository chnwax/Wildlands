// Pedestrians with somewhere to go (歩行者). The town's walkable surfaces become one navigation graph — both footways of
// every street (or the shoulders of a lane without them), the rounded footway corners of the junctions, the zebra
// crossings, the riverside walks, the station forecourt and the estate's paths to every door — and the people are
// agents on it with a home, a kind of day and a plan:
//  - places to go are read from the world's objects: house gates and the estate's doors (homes), shops and konbini,
//    vending machines, benches, bus stops, street shrines, and the station's ticket hall; each is reached from its
//    nearest point of the graph by a last few steps off it
//  - a plan follows the hour: commuters to the station in the morning and home in the evening, errands, a drink from a
//    machine, a rest on a bench, a prayer at a shrine, a walk by the river; joggers at dawn and dusk; few people at
//    night; some walk in pairs and stop together
//  - routes are found with A* over the graph; streets are crossed at the zebras (waiting for the green man where there
//    are signals, for a gap in the traffic where there are not), lanes also between them when no car is coming, and
//    nobody steps onto a level crossing while its bells ring
//  - on the way they keep to the left of the walk, slow down behind someone slower, overtake on the right, step aside
//    for people coming the other way and for the player, and go round poles, benches and machines (the colliders)
//  - people come out of doors and go back in: homes, shops, the station; the population follows the time of day and
//    gathers round the player (agents far away finish their errand and go indoors, new ones step out nearby)
// Drawn with the baked crowd models (crowd.js): walking at a cadence that matches their pace, idling, sitting down,
// reaching for a machine, waving.
import { THREE, Q, clamp, mulberry32, collide } from './core.js';
import { time } from './sky.js';
import { CLIP, crowdMeshes } from './crowd.js';

const hyp = Math.hypot, TAU = Math.PI * 2;
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };

// ---------------------------------------------------------------- navigation graph
// node kinds: 0 a street's footway or shoulder, 1 a footway corner, 2 a path, 3 an estate path; edge kinds: 0 walk,
// 1 zebra crossing, 2 crossing a quiet lane anywhere
export class NavGraph {
  constructor() { this.x = []; this.z = []; this.w = []; this.kind = []; this.adj = []; this.edges = []; this.grid = new Map(); }
  _k(ix, iz) { return (ix + 4096) * 8192 + iz + 4096; }
  nearest(x, z, r, ok = null) {
    const C = 4, i0 = Math.floor((x - r) / C), i1 = Math.floor((x + r) / C), j0 = Math.floor((z - r) / C), j1 = Math.floor((z + r) / C);
    let best = -1, bd = r;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const L = this.grid.get(this._k(i, j)); if (!L) continue;
      for (const n of L) { const d = hyp(this.x[n] - x, this.z[n] - z); if (d < bd && (!ok || ok(n))) { bd = d; best = n; } } }
    return best;
  }
  near(x, z, r) { // every node within r
    const C = 4, out = [];
    for (let i = Math.floor((x - r) / C); i <= Math.floor((x + r) / C); i++) for (let j = Math.floor((z - r) / C); j <= Math.floor((z + r) / C); j++) { const L = this.grid.get(this._k(i, j)); if (L) for (const n of L) if (hyp(this.x[n] - x, this.z[n] - z) < r) out.push(n); }
    return out;
  }
  node(x, z, kind, w, merge = 0.9) {
    if (merge > 0) { const n = this.nearest(x, z, merge, q => this.kind[q] === kind || (kind !== 3 && this.kind[q] !== 3)); if (n >= 0) return n; }
    const id = this.x.length; this.x.push(x); this.z.push(z); this.w.push(w); this.kind.push(kind); this.adj.push([]);
    const k = this._k(Math.floor(x / 4), Math.floor(z / 4)); if (!this.grid.has(k)) this.grid.set(k, []); this.grid.get(k).push(id);
    return id;
  }
  link(a, b, kind = 0, data = null) {
    if (a === b || a < 0 || b < 0 || this.adj[a].some(e => e.to === b)) return null;
    const e = { a, b, len: hyp(this.x[a] - this.x[b], this.z[a] - this.z[b]), kind, data, blocked: 0, dead: false };
    this.edges.push(e); this.adj[a].push({ to: b, e }); this.adj[b].push({ to: a, e });
    return e;
  }
  edge(a, b) { const r = this.adj[a].find(q => q.to === b); return r ? r.e : null; }
  components() {
    const N = this.x.length, comp = new Int32Array(N).fill(-1), size = []; let c = 0;
    for (let s = 0; s < N; s++) { if (comp[s] >= 0) continue; const st = [s]; comp[s] = c; let n = 0;
      while (st.length) { const u = st.pop(); n++; for (const { to } of this.adj[u]) if (comp[to] < 0) { comp[to] = c; st.push(to); } }
      size.push(n); c++; }
    this.comp = comp; this.compSize = size;
  }
  // A* from a to b; returns the nodes or null. (Crossings cost a little extra: people keep to their side when it is not
  // much longer, and cross a lane where they must.)
  path(a, b) {
    const N = this.x.length;
    if (!this._g || this._g.length < N) { this._g = new Float64Array(N); this._f = new Int32Array(N); this._s = new Int32Array(N); this._stamp = 0; }
    const g = this._g, from = this._f, seen = this._s, st = ++this._stamp, X = this.x, Z = this.z, bx = X[b], bz = Z[b];
    const heap = [], push = (f, n) => { heap.push([f, n]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    seen[a] = st; g[a] = 0; from[a] = -1; push(hyp(X[a] - bx, Z[a] - bz), a);
    let it = 0;
    while (heap.length && it++ < 60000) {
      const [, u] = pop(); if (u === b) break;
      if (seen[u] === -st) continue; const gu = g[u]; seen[u] = -st;
      for (const { to, e } of this.adj[u]) {
        if (seen[to] === -st || e.dead) continue;
        const c = gu + e.len * (e.kind === 2 ? 1.5 : 1) + (e.kind === 1 ? 6 : e.kind === 2 ? 14 : 0);
        if (seen[to] !== st || c < g[to]) { seen[to] = st; g[to] = c; from[to] = u; push(c + hyp(X[to] - bx, Z[to] - bz), to); }
      }
    }
    if (seen[b] !== st && seen[b] !== -st) return null;
    const out = []; for (let u = b; u >= 0; u = from[u]) out.push(u); out.reverse();
    return out[0] === a ? out : null;
  }
}

// builds the graph. RN: the road network; zebras: [{id, s, band}] with sig(zb) the pedestrian signal group or null;
// walkable(x, z, edge): a person may stand there (not in a carriageway — but on a lane's edge, edge true — not in the
// river); chains: other walks [{pts, kind
// (2 path | 3 estate), w, door}]
export function buildNavGraph({ RN, zebras, zebraSignal, walkable, chains = [] }) {
  const G = new NavGraph(), clearLine = (x0, z0, x1, z1) => { const L = hyp(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(L / 0.4)); for (let i = 1; i < n; i++) { const t = i / n; if (!walkable(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t)) return false; } return true; };
  const sideOf = new Map(); // road id -> side -> [[s, node]]
  // footways (or shoulders) along every street; a path's own centreline
  for (const n of RN.net) {
    // (a lane without footways: along its very edge — the plots' walls and fences stand a step behind it)
    const R = n.R, L = n.PL.len, path = R.kind === 'path', sides = path ? [0] : [-1, 1], off = path ? 0 : n.hw + (n.walk ? n.walk / 2 : 0.2), w = path ? R.w : n.walk ? n.walk : 0.9, edge = !path && !n.walk;
    const ss = []; for (let s = 0; s < L; s += 5) ss.push(s); ss.push(L);
    for (const zb of zebras) if (zb.id === R.id) ss.push(clamp(zb.s, 0, L));
    ss.sort((a, b) => a - b);
    const per = {};
    for (const side of sides) {
      let prev = -1; const list = []; per[side] = list;
      for (const s of ss) {
        const q = RN.sampleAt(n, s), lx = -q.d[1], lz = q.d[0], x = q.x + lx * side * off, z = q.z + lz * side * off;
        if (!walkable(x, z, edge)) { prev = -1; continue; }
        const id = G.node(x, z, path ? 2 : 0, w, 0.6);
        if (prev >= 0 && hyp(G.x[prev] - x, G.z[prev] - z) < 9) G.link(prev, id);
        prev = id; list.push([s, id]);
      }
    }
    sideOf.set(R.id, per);
    // a quiet lane may be crossed anywhere (every ~35 m) when no car comes
    if ((R.kind === 'lane' || R.district) && !path && n.hw < 3.6) {
      for (let s = 12; s < L - 12; s += 35) {
        const a = nearestS(per[-1], s), b = nearestS(per[1], s); if (!a || !b || Math.abs(a[0] - s) > 4 || Math.abs(b[0] - s) > 4) continue;
        const q = RN.sampleAt(n, s); G.link(a[1], b[1], 2, { x: q.x, z: q.z, road: R.id });
      }
    }
  }
  function nearestS(list, s) { let best = null; if (list) for (const e of list) if (!best || Math.abs(e[0] - s) < Math.abs(best[0] - s)) best = e; return best; }
  // the junctions' footway corners: the kerb's arc, moved in onto the footway (or the shoulder)
  for (const I of RN.inters) for (const cr of I.corners || []) {
    if (!cr.arc || cr.arc.length < 2) continue;
    const w2 = cr.walk > 0 ? cr.walk / 2 : 0.2, edge = !(cr.walk > 0);
    const pts = sgn => cr.arc.map(p => { const vx = p[0] - cr.O[0], vz = p[1] - cr.O[1], l = hyp(vx, vz) || 1, k = (l + sgn * w2) / l; return [cr.O[0] + vx * k, cr.O[1] + vz * k]; });
    const A = pts(-1), B = pts(1), okA = A.filter(p => walkable(p[0], p[1], edge)).length, okB = B.filter(p => walkable(p[0], p[1], edge)).length, P = okA >= okB ? A : B;
    if (Math.max(okA, okB) < P.length * 0.7) continue;
    let prev = -1;
    for (let i = 0; i < P.length; i += Math.max(1, Math.floor(P.length / 5))) { const [x, z] = P[i]; if (!walkable(x, z, edge)) { prev = -1; continue; } const id = G.node(x, z, 1, cr.walk || 1.1, 0.6); if (prev >= 0) G.link(prev, id); prev = id; }
    const [xe, ze] = P[P.length - 1]; if (walkable(xe, ze, edge)) { const id = G.node(xe, ze, 1, cr.walk || 1.1, 0.6); if (prev >= 0) G.link(prev, id); }
  }
  // zebra crossings: the footway nodes either side of each, joined across
  for (const zb of zebras) {
    const per = sideOf.get(zb.id); if (!per || !per[-1] || !per[1]) continue;
    const a = nearestS(per[-1], zb.s), b = nearestS(per[1], zb.s); if (!a || !b || Math.abs(a[0] - zb.s) > 2 || Math.abs(b[0] - zb.s) > 2) continue;
    const n = RN.byId.get(zb.id), q = RN.sampleAt(n, zb.s);
    G.link(a[1], b[1], 1, { x: q.x, z: q.z, road: zb.id, sig: zebraSignal(zb) });
  }
  // the other walks: riverside, forecourt, the estate (its chains share their joints; an end on a street footway is
  // joined to the footway)
  const doorEnds = [];
  for (const C of chains) {
    const kind = C.kind || 2, w = C.w || 2, pts = [];
    for (let i = 0; i + 1 < C.pts.length; i++) { const [ax, az] = C.pts[i], [bx, bz] = C.pts[i + 1], L = hyp(bx - ax, bz - az), k = Math.max(1, Math.ceil(L / 4)); for (let j = 0; j < k; j++) pts.push([ax + (bx - ax) * j / k, az + (bz - az) * j / k]); }
    pts.push(C.pts[C.pts.length - 1]);
    let prev = -1, first = -1, last = -1;
    for (const [x, z] of pts) { if (!walkable(x, z)) { prev = -1; continue; } const id = G.node(x, z, kind, w, kind === 3 ? 1.0 : 0.7); if (first < 0) first = id; if (prev >= 0) G.link(prev, id); prev = id; last = id; }
    if (C.door && first >= 0) doorEnds.push([first, last, C]);
  }
  // loose ends: each joined to the nearest node in reach it can walk straight to (a chain onto a footway, a footway's
  // end round a corner the arcs missed); estate paths only onto streets
  const N0 = G.x.length;
  for (let u = 0; u < N0; u++) {
    if (G.adj[u].length > 1) continue;
    const est = G.kind[u] === 3, R = est ? 5 : 7;
    let best = -1, bd = R;
    for (const v of G.near(G.x[u], G.z[u], R)) {
      if (v === u || G.adj[u].some(e => e.to === v) || (est && G.kind[v] === 3)) continue;
      const d = hyp(G.x[v] - G.x[u], G.z[v] - G.z[u]); if (d >= bd) continue;
      if (G.adj[u].length && G.adj[v].length && G.adj[u][0].to === G.adj[v][0]?.to) continue;
      if (!clearLine(G.x[u], G.z[u], G.x[v], G.z[v])) continue;
      bd = d; best = v;
    }
    if (best >= 0) G.link(u, best);
  }
  G.components();
  // the doors at the ends of the estate's own walks (the end still loose: against its building)
  G.doors = [];
  for (const [a, b] of doorEnds) for (const e of [a, b]) if (G.adj[e].length <= 1 && G.compSize[G.comp[e]] > 40) G.doors.push(e);
  return G;
}

// ---------------------------------------------------------------- places
// poi: { type, x, z, yaw (facing while there), node (access), seat? }
const POI_TYPES = { garden_gate: 'home', shop: 'shop', vending_machine: 'vend', bench: 'bench', bus_stop: 'bus', street_shrine: 'shrine', offering_box: 'shrine', post_box: 'post' };
export function collectPOIs(G, layer, extra = []) {
  const out = [], m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(), main = c => G.compSize[c] > 60;
  const access = (x, z, R = 30) => G.nearest(x, z, R, n => main(G.comp[n]));
  for (const ent of layer.ents.values()) {
    const type = POI_TYPES[ent.prefab]; if (!type) continue;
    const st = ent.state; if (st && (st.deleted || st.hidden)) continue;
    layer.matrixOf(ent, m).decompose(p, q, s);
    const e = m.elements, fx = e[8], fz = e[10], fl = hyp(fx, fz) || 1, fwd = [fx / fl, fz / fl];
    if (type === 'bench') { // two seats; you sit facing its local +Z
      const node = access(p.x + fwd[0] * 1.5, p.z + fwd[1] * 1.5, 20); if (node < 0) continue;
      const yaw = Math.atan2(fwd[0], fwd[1]), rx = fwd[1], rz = -fwd[0];
      for (const u of [-0.4, 0.4]) out.push({ type, x: p.x + rx * u + fwd[0] * 0.55, z: p.z + rz * u + fwd[1] * 0.55, yaw, node, seat: { x: p.x + rx * u - fwd[0] * 0.05, z: p.z + rz * u - fwd[1] * 0.05, y: p.y + 0.5 }, busy: null });
      continue;
    }
    let x = p.x, z = p.z, R = type === 'shop' ? 30 : 18;
    if (type === 'shop') { // its door: the side of the building toward the street
      const box = layer.worldBox(ent); const node0 = access((box.min.x + box.max.x) / 2, (box.min.z + box.max.z) / 2, 35); if (node0 < 0) continue;
      x = clamp(G.x[node0], box.min.x, box.max.x); z = clamp(G.z[node0], box.min.z, box.max.z);
    }
    const node = access(x, z, R); if (node < 0) continue;
    const tx = G.x[node] - x, tz = G.z[node] - z, tl = hyp(tx, tz) || 1;
    let yaw = Math.atan2(-tx, -tz), sx = x, sz = z; // (default: facing the place, from its access side)
    if (type === 'vend' || type === 'shrine' || type === 'post') { const k = Math.min(type === 'shrine' ? 1.3 : 0.75, tl); sx = x + tx / tl * k; sz = z + tz / tl * k; } // stand in front, facing it
    if (type === 'bus') yaw = Math.atan2(tx, tz); // waiting, facing the street
    out.push({ type, x: sx, z: sz, yaw, node, busy: 0 });
  }
  for (const d of G.doors) out.push({ type: 'home', x: G.x[d], z: G.z[d], yaw: 0, node: d, estate: true, busy: 0 });
  for (const P of extra) { const node = access(P.x, P.z, 40); if (node >= 0) out.push({ ...P, node, busy: 0 }); }
  return out;
}

// ---------------------------------------------------------------- the people
const SHIRTS = [[0.92, 0.92, 0.9], [0.2, 0.26, 0.42], [0.85, 0.55, 0.6], [0.45, 0.62, 0.82], [0.85, 0.75, 0.38], [0.5, 0.68, 0.5], [0.72, 0.3, 0.26], [0.2, 0.2, 0.22], [0.62, 0.55, 0.75], [0.6, 0.6, 0.62], [0.32, 0.4, 0.3]];
const PANTS = [[0.16, 0.2, 0.32], [0.26, 0.26, 0.28], [0.5, 0.45, 0.35], [0.12, 0.12, 0.14], [0.24, 0.3, 0.45], [0.42, 0.26, 0.24], [0.7, 0.68, 0.62], [0.3, 0.34, 0.26]];
const HAIR = [[0.06, 0.05, 0.05], [0.06, 0.05, 0.05], [0.06, 0.05, 0.05], [0.18, 0.12, 0.08], [0.3, 0.2, 0.12], [0.5, 0.36, 0.22], [0.5, 0.5, 0.52], [0.72, 0.72, 0.74]];
// how many are about at an hour (a share of the population)
const density = h => h < 4.5 ? 0.1 : h < 6.5 ? 0.1 + (h - 4.5) * 0.25 : h < 9.5 ? 1 : h < 16 ? 0.72 : h < 19.5 ? 1 : h < 22.5 ? 0.85 - (h - 19.5) * 0.22 : 0.18;

export class Pedestrians {
  // opts: G, pois, people (loadPeople), groundAt, pedSignal(group) -> 'walk'|'flash'|'stop', carNear(x, z, r),
  // railClosed(x0, z0, x1, z1), count, seed
  constructor(o) {
    Object.assign(this, { G: o.G, pois: o.pois, people: o.people, groundAt: o.groundAt, pedSignal: o.pedSignal || (() => 'walk'), carNear: o.carNear || (() => false), railClosed: o.railClosed || (() => false) });
    const rng = this.rng = mulberry32(o.seed || 77), P = this.people;
    this.byType = {}; for (const p of this.pois) (this.byType[p.type] ||= []).push(p);
    this.homes = this.byType.home || [];
    const N = o.count || 300, men = P.map((M, i) => M.id.startsWith('man') ? i : -1).filter(i => i >= 0), women = P.map((M, i) => !M.id.startsWith('man') ? i : -1).filter(i => i >= 0);
    this.agents = [];
    for (let i = 0; i < N; i++) {
      const woman = women.length && rng() < 0.45, m = woman ? women[Math.floor(rng() * women.length)] : men[Math.floor(rng() * men.length)], M = P[m];
      const suit = M.id === 'man_suit' || M.id === 'formal', elder = !woman && rng() < 0.12, jog = !woman && !elder && M.has('run') && M.id === 'man_casual' && rng() < 0.25;
      const kind = jog ? 'jogger' : elder ? 'elder' : suit || rng() < 0.3 ? 'commuter' : 'local';
      const cols = M.id === 'man_suit' ? [-1, -1, crowdPack(pick(rng, HAIR))] : [crowdPack(pick(rng, SHIRTS)), crowdPack(pick(rng, PANTS)), crowdPack(elder ? pick(rng, HAIR.slice(5)) : pick(rng, HAIR.slice(0, 6)))];
      this.agents.push({ i, m, M, kind, cols, woman, scale: (woman ? 0.94 : 0.97) + rng() * 0.08, speed: elder ? 0.85 + rng() * 0.2 : jog ? 2.6 + rng() * 0.6 : 1.15 + rng() * 0.35,
        home: this.homes.length ? this.homes[Math.floor(rng() * this.homes.length)] : null, on: false, x: 0, z: 0, y: 0, yaw: 0, v: 0, lat: 0.3, latT: 0.3,
        route: null, ri: 0, poi: null, mode: 'off', t: 0, trips: 0, a: CLIP.idle, ta: rng(), b: CLIP.idle, tb: 0, w: 0, wt: 0, phase: rng(), lead: null, mate: null, far: 0, sitY: 0 });
    }
    // the shopkeepers (shops.js): standing at their counters while the shop is open, idle, a wave for a customer
    this.keepers = [];
    for (const K of o.keepers || []) {
      const pool = K.woman && women.length ? women : men, h = Math.abs(Math.floor(K.x * 7.3 + K.z * 11.7)), m = pool[h % pool.length], M = P[m];
      const cols = M.id === 'man_suit' ? [-1, -1, crowdPack(HAIR[h % 6])] : [crowdPack(K.shirt), crowdPack(PANTS[h % PANTS.length]), crowdPack(HAIR[h % 6])];
      const A = { i: this.agents.length, m, M, kind: 'keeper', cols, woman: M.id === 'casual' || M.id === 'formal', scale: 0.98, speed: 0, home: null, on: false, x: K.x, z: K.z, y: K.y, yaw: K.yaw, v: 0, lat: 0, latT: 0,
        route: null, ri: 0, poi: null, mode: 'keeper', t: 0, trips: 0, a: CLIP.idle, ta: (h % 97) / 97, b: CLIP.idle, tb: 0, w: 1, wt: 0, phase: 0, lead: null, mate: null, far: 0, sitY: 0, K, greet: 0 };
      this.agents.push(A); this.keepers.push(A);
    }
    const cap = P.map(() => 0); for (const a of this.agents) cap[a.m]++;
    this.crowd = crowdMeshes(P, cap); this.meshes = this.crowd.meshes;
    this.grid = new Map(); this.queue = []; this.spawnAcc = 0; this.first = true;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3(); this._up = new THREE.Vector3(0, 1, 0);
    this._fr = new THREE.Frustum(); this._pm = new THREE.Matrix4(); this._sph = new THREE.Sphere(new THREE.Vector3(), 1.4);
  }

  // ---- planning
  near(list, x, z, maxD = 450, minD = 0) { // a random place of a list, nearer ones likelier
    if (!list || !list.length) return null;
    let tot = 0; const w = new Float64Array(list.length);
    for (let i = 0; i < list.length; i++) { const p = list[i], d = hyp(p.x - x, p.z - z); w[i] = d < minD || d > maxD || (p.busy && p.type === 'bench') ? 0 : 1 / (1 + (d / 120) ** 2); tot += w[i]; }
    if (tot <= 0) return null; let r = this.rng() * tot; for (let i = 0; i < list.length; i++) { r -= w[i]; if (r <= 0) return list[i]; } return list[list.length - 1];
  }
  // the next place for agent A standing at (x, z)
  nextGoal(A, x, z) {
    const h = time.hour, r = this.rng(), B = this.byType, homeward = A.trips >= (A.kind === 'elder' ? 3 : 2) || h > 21.5 || h < 5;
    if (A.kind === 'jogger') return A.trips >= 2 ? A.home : this.strollPoint(x, z, 250, 600);
    if (homeward && A.home) return A.home;
    if (A.kind === 'commuter') {
      if (h >= 6 && h < 9.5 && A.trips === 0 && B.station) return this.near(B.station, x, z, 2000);
      if (h >= 16.5 && h < 20.5 && A.fromStation && A.home) return A.home;
    }
    const opts = [
      [B.shop, h > 8 && h < 21 ? 3 : 0.3], [B.vend, 1.6], [B.bench, A.M.has('sit') ? (A.kind === 'elder' ? 4 : 1.4) : 0], [B.bus, h > 6 && h < 21 ? 0.7 : 0],
      [B.shrine, A.kind === 'elder' ? 1.2 : 0.35], [B.post, 0.25], [B.station, A.kind === 'commuter' ? 1.2 : 0.4], ['stroll', A.kind === 'elder' ? 1.2 : 0.9], [A.home ? [A.home] : null, A.trips ? 1.2 : 0],
    ].filter(o => o[1] > 0 && (o[0] === 'stroll' || (o[0] && o[0].length)));
    let tot = 0; for (const o of opts) tot += o[1];
    let q = r * tot;
    for (const [list, w] of opts) { q -= w; if (q > 0) continue; if (list === 'stroll') return this.strollPoint(x, z, 80, 300); const p = list.length === 1 ? list[0] : this.near(list, x, z); if (p) return p; break; }
    return A.home;
  }
  strollPoint(x, z, minD, maxD) { // a walk to somewhere on the paths and back: a node at some distance
    const G = this.G, n0 = G.nearest(x, z, 40); if (n0 < 0) return null;
    for (let k = 0; k < 20; k++) { const n = Math.floor(this.rng() * G.x.length), d = hyp(G.x[n] - x, G.z[n] - z); if (d > minD && d < maxD && G.comp[n] === G.comp[n0] && G.kind[n] !== 3) return { type: 'stroll', x: G.x[n], z: G.z[n], node: n, yaw: 0 }; }
    return null;
  }
  // a route from where A stands to poi (A* now: a handful a frame)
  plan(A, poi) {
    const G = this.G; if (!poi) return false;
    const n0 = A.route && A.ri < A.route.length ? A.route[Math.max(0, A.ri - 1)] : G.nearest(A.x, A.z, 30, n => G.comp[n] === G.comp[poi.node]);
    if (n0 < 0 || G.comp[n0] !== G.comp[poi.node]) return false;
    const r = G.path(n0, poi.node); if (!r) return false;
    A.route = r; A.ri = r.length > 1 && hyp(G.x[r[0]] - A.x, G.z[r[0]] - A.z) < 2 ? 1 : 0; A.poi = poi; A.mode = 'walk';
    // where exactly: a spot of one's own at a bus stop or a shrine (not everyone on the same point), the place itself
    // elsewhere; how close counts as there
    const rr = this.rng(), spread = poi.type === 'bus' ? 1.7 : poi.type === 'shrine' || poi.type === 'stroll' ? 0.8 : 0, a = rr * TAU;
    A.tx = poi.x + Math.cos(a) * spread * Math.sqrt(this.rng()); A.tz = poi.z + Math.sin(a) * spread * Math.sqrt(this.rng());
    A.reach = poi.type === 'home' || poi.type === 'shop' || poi.type === 'station' ? 0.75 : poi.type === 'bench' || poi.type === 'vend' || poi.type === 'post' ? 0.3 : 0.55;
    return true;
  }

  // ---- population
  spawn(A, px, pz, init) {
    const h = time.hour, B = this.byType;
    // where they come out: a home (most), the station (arrivals), a shop
    let from = null;
    if (A.kind === 'commuter' && h >= 16.5 && h < 20.5 && B.station && this.rng() < 0.6) from = this.near(B.station, px, pz, 2000), A.fromStation = true;
    else if (this.rng() < 0.12 && B.shop) from = this.near(B.shop, px, pz, 500);
    else { A.home = this.near(this.homes, px, pz, init ? 700 : 420, init ? 0 : 25) || A.home; from = A.home; }
    if (!from) return false;
    A.x = from.x; A.z = from.z; A.yaw = this.rng() * TAU; A.trips = 0; A.route = null; A.on = true; A.mode = 'walk'; A.a = CLIP.idle; A.w = 0;
    const goal = this.nextGoal(A, A.x, A.z); if (!goal || goal === from || !this.plan(A, goal)) { A.on = false; A.mode = 'off'; return false; }
    A.lat = A.latT = 0.2 + this.rng() * 0.35;
    if (init) { const k = Math.floor(this.rng() * A.route.length); A.ri = Math.max(1, k); const n = A.route[Math.max(0, A.ri - 1)]; A.x = this.G.x[n]; A.z = this.G.z[n]; } // (already on the way)
    else { A.x = from.x; A.z = from.z; }
    A.y = this.groundAt(A.x, A.z);
    // some go out in pairs: a mate of the same plan walking beside
    if (!A.mate && this.rng() < 0.18) { const M = this.agents.find(b => !b.on && b.mode === 'off' && b !== A && b.kind !== 'jogger' && A.kind !== 'jogger'); if (M) { M.on = true; M.mode = 'follow'; M.lead = A; A.mate = M; M.x = A.x + 0.6; M.z = A.z; M.y = A.y; M.home = A.home; M.speed = A.speed; } }
    return true;
  }
  despawn(A) { if (A.poi && A.poi.busy === A) A.poi.busy = 0; A.on = false; A.mode = 'off'; A.route = null; if (A.seat) { A.seat.busy = null; A.seat = null; } if (A.mate) { const M = A.mate; M.on = false; M.mode = 'off'; M.lead = null; A.mate = null; } }

  // ---- per frame
  update(dt, cam) {
    if (!cam) return;
    const G = this.G, px = cam.position.x, pz = cam.position.z, ag = this.agents;
    // how many should be out now, and new ones stepping out near the player
    const target = Math.round(ag.length * density(time.hour));
    let on = 0; for (const A of ag) if (A.on && A.mode !== 'keeper') on++;
    if (this.first) { this.first = false; for (const A of ag) { if (on >= target) break; if (!A.on && A.mode === 'off' && this.spawn(A, px, pz, true)) on += A.mate ? 2 : 1; } }
    this.spawnAcc = Math.min(4, this.spawnAcc + dt * 3);
    while (on < target && this.spawnAcc >= 1) { this.spawnAcc--; const A = ag.find(b => !b.on && b.mode === 'off'); if (!A) break; if (this.spawn(A, px, pz, false)) on += A.mate ? 2 : 1; }
    // neighbours
    const grid = this.grid; grid.clear();
    for (const A of ag) if (A.on) { const k = (Math.floor(A.x / 3) + 2048) * 4096 + Math.floor(A.z / 3) + 2048; let L = grid.get(k); if (!L) grid.set(k, L = []); L.push(A); }
    this.plans = 0;
    for (const A of ag) {
      if (A.mode === 'keeper') { A.on = A.K.open(); if (A.on && hyp(A.x - px, A.z - pz) < 300) this.keep(A, dt); continue; }
      if (!A.on) continue;
      const d = hyp(A.x - px, A.z - pz);
      // far away: every fourth frame; very far and done: home
      if (d > 380) { A.far += dt; if ((A.i + this.frame) % 4) continue; this.step(A, A.far, d, px, pz, false); A.far = 0; }
      else this.step(A, dt, d, px, pz, true);
      if (d > 900 && A.mode !== 'follow') this.despawn(A);
    }
    this.frame = (this.frame || 0) + 1;
    this.draw(cam);
  }

  // a shopkeeper's frame: at the counter, now and then a look round, a wave (or a nod) for a customer
  keep(A, dt) {
    if (A.K.ground && !A.gy) { A.y = this.groundAt(A.x, A.z); A.gy = true; }
    if (A.greet > 0) { A.greet -= dt; const talk = A.M.has('talk'); this.anim(A, talk ? CLIP.talk : CLIP.idle, dt, talk ? dt / A.M.dur('talk') : 0); return; }
    this.anim(A, CLIP.idle, dt, 0);
  }
  greet(k) { const A = this.keepers[k]; if (A) A.greet = 2.2; }
  // one agent's frame
  step(A, dt, dist, px, pz, near) {
    const G = this.G;
    if (A.mode === 'follow') return this.follow(A, dt, near);
    if (A.mode === 'act') return this.activity(A, dt, near);
    if (!A.route) { this.despawn(A); return; }
    // the point being walked to: the next node, held to the left of the walk; then the place itself
    let tx, tz, last = A.ri >= A.route.length;
    if (last) { tx = A.tx; tz = A.tz; }
    else {
      const n = A.route[A.ri], p = A.route[Math.max(0, A.ri - 1)], dx = G.x[n] - G.x[p], dz = G.z[n] - G.z[p], l = hyp(dx, dz) || 1;
      const room = Math.max(0, (Math.min(G.w[n], G.w[p]) / 2) - 0.45); A.lat += (clamp(A.latT, -room, room) - A.lat) * Math.min(1, dt * 1.5);
      tx = G.x[n] - dz / l * A.lat; tz = G.z[n] + dx / l * A.lat;
      // about to cross: wait at the kerb for the green man, a gap in the traffic or the level crossing
      const e = A.ri > 0 ? G.edge(p, n) : null;
      if (e && e.kind && hyp(A.x - G.x[p], A.z - G.z[p]) < 1.6 && !A.crossing) {
        const wait = e.kind === 1 ? (e.data.sig ? this.pedSignal(e.data.sig) !== 'walk' : this.carNear(e.data.x, e.data.z, 16)) : this.carNear(e.data.x, e.data.z, 26);
        if (wait) { A.mode = 'wait'; A.v = 0; this.face(A, Math.atan2(G.x[n] - A.x, G.z[n] - A.z), dt); this.anim(A, CLIP.idle, dt, 0); if (A.mate) A.mate.waiting = true; return; }
        A.crossing = e;
      }
    }
    let dx = tx - A.x, dz = tz - A.z, dd = hyp(dx, dz);
    if (A.mode === 'wait') A.mode = 'walk';
    // no headway for a while (a wall or a fence the walk was drawn through, a crowd): that stretch is marked and avoided
    // from then on, and the way is found again from here
    if (dt > 0 && near) { if (dd < (A.best ?? 1e9) - 0.25) { A.best = dd; A.stuckT = 0; } else if ((A.stuckT = (A.stuckT || 0) + dt) > 3.5) {
      A.stuckT = 0; A.best = 1e9; const e = !last && A.ri > 0 ? G.edge(A.route[A.ri - 1], A.route[A.ri]) : null; if (e && ++e.blocked >= 3) e.dead = true;
      if (last) return this.arrive(A); const P0 = A.poi; A.route = null; if (!this.plan(A, P0)) this.despawn(A); return; } }
    if (A.mate) A.mate.waiting = false;
    // reached a node: on to the next (a crossing is over once its far node is reached)
    if (!last && (dd < 0.9 || this.passed(A))) { A.best = 1e9; if (A.crossing && A.route[A.ri] === (A.crossing.a === A.route[A.ri - 1] ? A.crossing.b : A.crossing.a)) A.crossing = null; A.ri++; return this.step(A, 0, dist, px, pz, near); }
    if (last && dd < A.reach) return this.arrive(A);
    // speed: own pace, slower behind someone slower, a little brisker over a crossing; the player in the way
    let sp = A.speed * (A.crossing ? 1.15 : 1), ux = dx / (dd || 1), uz = dz / (dd || 1);
    if (near) {
      const ix = Math.floor(A.x / 3), iz = Math.floor(A.z / 3);
      for (let i = ix - 1; i <= ix + 1; i++) for (let j = iz - 1; j <= iz + 1; j++) { const L = this.grid.get((i + 2048) * 4096 + j + 2048); if (!L) continue;
        for (const B of L) { if (B === A || B === A.mate || B === A.lead) continue;
          const rx = B.x - A.x, rz = B.z - A.z, r = hyp(rx, rz); if (r > 2.4 || r < 1e-4) continue;
          const ahead = rx * ux + rz * uz, side = -rx * uz + rz * ux;
          if (r < 0.5) { A.x -= rx / r * (0.5 - r) * 0.5; A.z -= rz / r * (0.5 - r) * 0.5; }
          if (ahead > 0 && ahead < 1.7 && Math.abs(side) < 0.65) {
            const same = Math.sin(B.yaw) * ux + Math.cos(B.yaw) * uz;
            if (same > 0.4) { if (B.v < sp) { if (A.latT < 0.9 && r < 1.3) A.latT -= 0.6 * dt * 3; else sp = Math.min(sp, B.v * 0.98 + 0.05); } } // behind: overtake on the right or fall in
            else { A.latT = Math.min(A.latT + dt * 2.5, 1.2); if (ahead < 0.8) sp *= 0.6; } // coming the other way: keep left
          }
        } }
      const rx = px - A.x, rz = pz - A.z, r = hyp(rx, rz);
      if (r < 2.2) { const ahead = rx * ux + rz * uz, side = -rx * uz + rz * ux; if (ahead > 0 && Math.abs(side) < 0.8) { A.latT += (side < 0 ? 1 : -1) * dt * 2; if (r < 1.0) sp *= 0.3; } }
      if (A.latT > 0.25) A.latT -= dt * 0.15; else if (A.latT < 0.25) A.latT += dt * 0.35; // drift back to the left of the walk
    }
    // round a pole, a bench or a machine in the way: the step is aimed where a probe ahead slides off it
    if (near && dist < 160) { const pr = this._pr || (this._pr = { x: 0, y: 0, z: 0 }); pr.x = A.x + ux * 0.65; pr.z = A.z + uz * 0.65; pr.y = A.y; collide(pr, 0.26, 1.6);
      const sx = pr.x - A.x, sz = pr.z - A.z, sl = hyp(sx, sz); if (sl > 0.1) { ux = sx / sl; uz = sz / sl; } }
    // the level crossing: nobody steps in while its bells ring
    const nx = A.x + ux * sp * dt, nz = A.z + uz * sp * dt;
    if (this.railClosed(A.x, A.z, nx + ux * 0.8, nz + uz * 0.8)) { A.v = 0; this.anim(A, CLIP.idle, dt, 0); return; }
    A.x = nx; A.z = nz; A.v = sp;
    if (near && dist < 160) this.unstick(A);
    this.face(A, Math.atan2(ux, uz), dt);
    if (near || this.frame % 8 === A.i % 8) A.y = this.groundAt(A.x, A.z);
    const run = A.kind === 'jogger' && A.M.has('run');
    this.anim(A, run ? CLIP.run : CLIP.walk, dt, sp * dt / (A.M.stride(run ? 'run' : 'walk') * A.scale)); // (the steps cover the ground walked)
  }
  passed(A) { // already beyond the node (the segment's end) — avoids circling a node someone was pushed off
    const G = this.G, n = A.route[A.ri], p = A.route[Math.max(0, A.ri - 1)]; if (n === p) return true;
    const dx = G.x[n] - G.x[p], dz = G.z[n] - G.z[p]; return (A.x - G.x[n]) * dx + (A.z - G.z[n]) * dz > 0 && hyp(A.x - G.x[n], A.z - G.z[n]) < 3;
  }
  unstick(A) { const c = this._c || (this._c = { x: 0, y: 0, z: 0 }); c.x = A.x; c.y = A.y; c.z = A.z; collide(c, 0.24, 1.6); A.x = c.x; A.z = c.z; } // (out of poles, benches, machines, walls)
  face(A, yaw, dt) { A.yaw += clamp(angDiff(A.yaw, yaw), -dt * 5, dt * 5); }

  // at the place: what happens there
  arrive(A) {
    const P = A.poi, r = this.rng();
    A.trips++; A.v = 0; A.route = null; A.mode = 'act'; A.act = P.type; A.t = 0;
    switch (P.type) {
      case 'home': case 'station': this.despawn(A); return; // indoors / onto a train
      case 'shop': A.dur = 0; this.despawn(A); return; // (into the shop)
      case 'vend': case 'post': if (P.busy && P.busy !== A && P.busy.on && P.busy.poi === P) { A.dur = 3 + r * 3; A.act = 'look'; break; } P.busy = A; A.dur = P.type === 'post' ? 3 : 5 + r * 5; break; // (someone at the machine already: a look, then on)
      case 'bench': if (P.busy || !A.M.has('sit')) { A.dur = 3; A.act = 'look'; break; } P.busy = A; A.seat = P; A.dur = 25 + r * 70; break;
      case 'bus': A.dur = 40 + r * 120; break;
      case 'shrine': A.dur = 6 + r * 6; break;
      default: A.dur = 2 + r * 6; A.act = 'look';
    }
  }
  activity(A, dt, near) {
    const P = A.poi; A.t += dt;
    if (A.act === 'bench' && A.seat) {
      const M = A.M, seat = M.seat || [0.34, -0.21], s = P.seat, sitD = M.dur('sitdown');
      const tStand = A.dur, phase = A.t < sitD ? 'down' : A.t < tStand ? 'sit' : A.t < tStand + sitD ? 'up' : 'done';
      // the feet stand where the seated pose puts the seat on the bench; while sitting down the body lowers onto it
      const fx = Math.sin(P.yaw), fz = Math.cos(P.yaw), rootX = s.x - fx * seat[1], rootZ = s.z - fz * seat[1];
      const k = phase === 'down' ? A.t / sitD : phase === 'up' ? 1 - (A.t - tStand) / sitD : phase === 'sit' ? 1 : 0;
      A.x += (rootX - A.x) * Math.min(1, dt * 4); A.z += (rootZ - A.z) * Math.min(1, dt * 4); this.face(A, P.yaw, dt * 2);
      A.sitY = (s.y - seat[0] - this.groundAt(rootX, rootZ)) * 0.65 * k; A.y = this.groundAt(A.x, A.z);
      if (phase === 'down') this.pose(A, CLIP.sitdown, A.t / sitD);
      else if (phase === 'sit') this.pose(A, CLIP.sit, 0.5 + 0.5 * Math.sin((A.t - sitD) * 0.25));
      else if (phase === 'up') this.pose(A, CLIP.sitdown, 1 - (A.t - tStand) / sitD);
      else { P.busy = null; A.seat = null; A.sitY = 0; return this.leave(A); }
      return;
    }
    this.face(A, P.yaw, dt);
    if (A.act === 'vend' && A.woman && A.M.has('act') && A.t < A.M.dur('act')) this.anim(A, CLIP.act, dt, dt / A.M.dur('act'), true);
    else if (A.act === 'shrine' && A.M.has('act') && A.t > 2 && A.t < 2 + A.M.dur('act')) this.anim(A, CLIP.act, dt, dt / A.M.dur('act'), true);
    else this.anim(A, CLIP.idle, dt, 0);
    if (A.act === 'bus' && A.t > A.dur) { this.despawn(A); return; } // (the bus came)
    if (A.t > A.dur) this.leave(A);
  }
  leave(A) { if (A.poi && A.poi.busy === A) A.poi.busy = 0; A.mode = 'walk'; const g = this.nextGoal(A, A.x, A.z); if (!g || !this.plan(A, g)) this.despawn(A); }
  // a mate walks beside (or just behind, where the walk is narrow) and stops with the leader, facing them
  follow(A, dt, near) {
    const L = A.lead; if (!L || !L.on) { this.despawn(A); return; }
    const fx = Math.sin(L.yaw), fz = Math.cos(L.yaw), moving = L.mode === 'walk' && L.v > 0.05;
    const tx = moving ? L.x + fz * 0.62 - fx * 0.1 : L.x + fx * 0.9 + fz * 0.5, tz = moving ? L.z - fx * 0.62 - fz * 0.1 : L.z + fz * 0.9 - fx * 0.5;
    const dx = tx - A.x, dz = tz - A.z, dd = hyp(dx, dz), sp = dd > 0.08 ? Math.min(dd * 3, Math.max(L.v, 0.6) * 1.25) : 0;
    if (dd > 6) { A.x = tx; A.z = tz; } else if (sp) { A.x += dx / dd * sp * dt; A.z += dz / dd * sp * dt; }
    A.v = sp; if (near && sp) this.unstick(A); A.y = near ? this.groundAt(A.x, A.z) : L.y;
    if (sp > 0.15) { this.face(A, Math.atan2(dx, dz), dt); this.anim(A, CLIP.walk, dt, sp * dt / (A.M.stride('walk') * A.scale)); }
    else { this.face(A, Math.atan2(L.x - A.x, L.z - A.z), dt); const talk = A.M.has('talk') && L.mode === 'act' && (Math.floor(L.t / 4) + A.i) % 3 === 0; this.anim(A, talk ? CLIP.talk : CLIP.idle, dt, talk ? dt / A.M.dur('talk') : 0, talk); }
  }

  // animation: the clip playing (a) and the one fading in (b); adv: how far the clip's time moves this frame (walk:
  // from the distance walked, so the steps match the ground); idle clips run on their own time
  anim(A, clip, dt, adv, once = false) {
    const own = clip === CLIP.idle || clip === CLIP.talk || clip === CLIP.sit;
    const step = own ? dt / A.M.dur(clip === CLIP.idle ? 'idle' : clip === CLIP.talk ? 'talk' : 'sit') : adv;
    if (A.b !== clip && A.a !== clip) { if (A.w > 0.5) { A.a = A.b; A.ta = A.tb; } A.b = clip; A.tb = clip === CLIP.walk || clip === CLIP.run ? A.phase : once ? 0 : this.rng(); A.w = 0; }
    if (A.a === clip && A.w > 0 && A.b !== clip) { A.w = Math.max(0, A.w - dt * 4); }
    if (A.b === clip && A.a !== clip) { A.w = Math.min(1, A.w + dt * 4); A.tb += step; if (A.w >= 1) { A.a = clip; A.ta = A.tb; A.w = 0; } }
    else { A.ta += step; }
    if (clip === CLIP.walk || clip === CLIP.run) A.phase = A.a === clip ? A.ta : A.tb;
    if (once) { A.ta = Math.min(A.ta, 1); A.tb = Math.min(A.tb, 1); }
  }
  pose(A, clip, t) { A.a = clip; A.ta = t; A.b = clip; A.w = 0; }

  // ---- drawing: those near enough and in view (and close behind the camera, for their shadows)
  draw(cam) {
    const C = this.crowd, m = this._m, q = this._q, v = this._v, s = this._s, fr = this._fr, sph = this._sph, px = cam.position.x, pz = cam.position.z;
    fr.setFromProjectionMatrix(this._pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const far = 420 * (Q.lodScale || 1);
    C.begin();
    for (const A of this.agents) {
      if (!A.on) continue;
      const d = hyp(A.x - px, A.z - pz); if (d > far) continue;
      sph.center.set(A.x, A.y + 0.9, A.z); if (d > 30 && !fr.intersectsSphere(sph)) continue;
      q.setFromAxisAngle(this._up, A.yaw); m.compose(v.set(A.x, A.y + (A.sitY || 0), A.z), q, s.setScalar(A.scale));
      C.put(A.m, m, A.a, A.ta, A.b, A.tb, A.w, A.cols);
    }
    C.end();
  }
  collide(p) {
    for (const A of this.agents) { if (!A.on) continue; const dx = p.x - A.x, dz = p.z - A.z, d2 = dx * dx + dz * dz;
      if (d2 < 0.36 && d2 > 1e-8 && Math.abs(p.y - A.y) < 1.7) { const d = Math.sqrt(d2); p.x = A.x + dx / d * 0.6; p.z = A.z + dz / d * 0.6; } }
  }
}
const pick = (rng, a) => a[Math.floor(rng() * a.length)];
const crowdPack = c => Math.round(clamp(c[0], 0, 1) * 255) * 65536 + Math.round(clamp(c[1], 0, 1) * 255) * 256 + Math.round(clamp(c[2], 0, 1) * 255);
