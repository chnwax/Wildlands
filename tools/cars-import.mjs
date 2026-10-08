// Imports the low-poly car pack (AssetsToUse/Low Poly Soviet Car Pack, FBX from poly.pizza) into the game's car
// format: assets/models/cars/cars.json (per model: dimensions, axles, profile, part ranges) + cars.bin (geometry).
//   node tools/cars-import.mjs
// Every model is split by the pack's palette texture into the parts the fleet draws with its own materials: paint
// (tinted per car), glass, black trim, bright metal, headlamps, tail lamps, plates; one wheel becomes tyre + rim.
// Axes become the game's (x forward, y up, z to the right), the ground is y = 0 and the car is centred on its length.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { readFBX, fbxScene } from './fbx.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..');
const SRC = path.join(ROOT, 'AssetsToUse/Low Poly Soviet Car Pack/Models');
const OUT = path.join(ROOT, 'assets/models/cars');
// palette (151 x 30 px): top row  0 light grey (bright metal), 1 dark grey, 2 black, 3 glass, 4 headlamp, 5 red lamp,
// 6 dark red lamp, 7 amber, 8 white (the plates in the coloured variants); bottom row: the body colours
const TOP = ['chrome', 'trim', 'trim', 'glass', 'head', 'tail', 'tail', 'amber', 'plate'];
const WHEEL = ['rim', 'tire', 'tire', 'tire', 'rim', 'rim', 'rim', 'rim', 'rim'];

const deg = Math.PI / 180;
function xform(m, models) { // model -> world (cm) as a function of a mesh-space point (m)
  const chain = []; for (let k = m; k; k = models.get(k).parent) chain.push(models.get(k));
  return p => {
    let [x, y, z] = p;
    for (const M of chain) {
      x *= M.S[0]; y *= M.S[1]; z *= M.S[2];
      for (const [ax, a] of [[0, M.R[0]], [1, M.R[1]], [2, M.R[2]]]) { // FBX XYZ order: X first, then Y, then Z
        if (!a) continue; const c = Math.cos(a * deg), s = Math.sin(a * deg);
        if (ax === 0) [y, z] = [y * c - z * s, y * s + z * c];
        else if (ax === 1) [x, z] = [x * c + z * s, -x * s + z * c];
        else [x, y] = [x * c - y * s, x * s + y * c];
      }
      x += M.T[0]; y += M.T[1]; z += M.T[2];
    }
    return [x, y, z];
  };
}
const rotN = (m, models) => { const f = xform(m, models), o = f([0, 0, 0]); return n => { const p = f(n), l = Math.hypot(p[0] - o[0], p[1] - o[1], p[2] - o[2]) || 1; return [(p[0] - o[0]) / l, (p[1] - o[1]) / l, (p[2] - o[2]) / l]; }; };

function load(id) {
  const file = path.join(SRC, id, id + '_red.fbx'), sc = fbxScene(readFBX(file));
  const tris = { body: [], wheel: [] }; let wheels = [];
  for (const g of sc.meshes) {
    const name = sc.models.get(g.model).name, isWheel = /wheel/i.test(name), P = xform(g.model, sc.models), N = rotN(g.model, sc.models);
    if (isWheel) { // the wheel's centre: its mesh's box in the world (some objects carry their mesh off their origin)
      const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; for (let i = 0; i < g.pos.length; i += 3) { const w = P([g.pos[i], g.pos[i + 1], g.pos[i + 2]]); for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], w[k]); hi[k] = Math.max(hi[k], w[k]); } }
      wheels.push({ name, c: lo.map((v, k) => (v + hi[k]) / 200) }); }
    for (let t = 0; t < g.pos.length / 9; t++) {
      const u = (g.uv[t * 6] + g.uv[t * 6 + 2] + g.uv[t * 6 + 4]) / 3, v = (g.uv[t * 6 + 1] + g.uv[t * 6 + 3] + g.uv[t * 6 + 5]) / 3;
      const col = Math.min(8, Math.floor((u - Math.floor(u)) * 9)), top = v - Math.floor(v) > 0.5;
      const part = isWheel ? (top ? WHEEL[col] : 'rim') : top ? TOP[col] : 'paint';
      const vs = [0, 1, 2].map(k => { const i = t * 9 + k * 3; return { p: (isWheel ? [g.pos[i], g.pos[i + 1], g.pos[i + 2]] : P([g.pos[i], g.pos[i + 1], g.pos[i + 2]]).map(v => v / 100)),
        n: isWheel ? [g.nor[i], g.nor[i + 1], g.nor[i + 2]] : N([g.nor[i], g.nor[i + 1], g.nor[i + 2]]) }; });
      if (isWheel && !/fr$/i.test(name)) continue; // one wheel: the front right one (its face looks outward to the right)
      (isWheel ? tris.wheel : tris.body).push({ part, vs });
    }
  }
  return { tris, wheels };
}

// FBX (x left, y up, z forward) -> game (x forward, y up, z right)
const G = ([x, y, z]) => [z, y, -x];

function convert(id) {
  const { tris, wheels } = load(id);
  const wc = wheels.map(w => G(w.c));
  for (const t of tris.body) for (const v of t.vs) { v.p = G(v.p); v.n = G(v.n); }
  for (const t of tris.wheel) for (const v of t.vs) { v.p = G(v.p); v.n = G(v.n); }
  // the wheel: centred on its own box (some files offset the mesh inside its object), radius from its extent; its face
  // must look toward +z (the right side)
  { const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; for (const t of tris.wheel) for (const v of t.vs) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], v.p[k]); hi[k] = Math.max(hi[k], v.p[k]); }
    for (const t of tris.wheel) for (const v of t.vs) for (let k = 0; k < 3; k++) v.p[k] -= (lo[k] + hi[k]) / 2; }
  let r = 0, zmin = 1e9, zmax = -1e9; for (const t of tris.wheel) for (const v of t.vs) { r = Math.max(r, Math.hypot(v.p[0], v.p[1])); zmin = Math.min(zmin, v.p[2]); zmax = Math.max(zmax, v.p[2]); }
  let zface = 0, wsum = 0; for (const t of tris.wheel) if (t.part === 'rim') for (const v of t.vs) { zface += v.p[2]; wsum++; }
  if (wsum && zface / wsum < (zmin + zmax) / 2) for (const t of tris.wheel) { for (const v of t.vs) { v.p[2] = -v.p[2]; v.n[2] = -v.n[2]; } t.vs.reverse(); }
  // axles and track (some files place both right wheels on the left: use |z|)
  const xs = wc.map(c => c[0]), xf = Math.max(...xs), xr = Math.min(...xs), track = Math.max(...wc.map(c => Math.abs(c[2]))) * 2, wy = wc[0][1];
  // ground at the wheels' feet, the car centred on its length
  let bb = [[1e9, -1e9], [1e9, -1e9], [1e9, -1e9]];
  for (const t of tris.body) for (const v of t.vs) for (let k = 0; k < 3; k++) { bb[k][0] = Math.min(bb[k][0], v.p[k]); bb[k][1] = Math.max(bb[k][1], v.p[k]); }
  const dx = -(bb[0][0] + bb[0][1]) / 2, dy = r - wy;
  for (const t of tris.body) for (const v of t.vs) { v.p[0] += dx; v.p[1] += dy; }
  const L = bb[0][1] - bb[0][0], W = bb[2][1] - bb[2][0], H = bb[1][1] + dy;
  // side profile (top line) every 5 cm, for the occupants' head room; the glass's lowest side edge is the belt line
  const prof = [], step = 0.05, n = Math.ceil(L / step);
  for (let i = 0; i <= n; i++) prof.push(-1);
  // (from the surfaces, not the vertices: a low-poly roof is one big polygon with no vertex in its middle — every
  // triangle near the centreline is sampled densely, so the profile is the real top line)
  for (const t of tris.body) { if (t.part === 'chrome' && t.vs.every(v => v.p[1] > 1.2)) continue; // (a roof rack is not head room)
    const [A, Bv, C] = t.vs.map(v => v.p), ext = Math.max(Math.hypot(Bv[0] - A[0], Bv[2] - A[2]), Math.hypot(C[0] - A[0], C[2] - A[2]), Math.hypot(C[0] - Bv[0], C[2] - Bv[2])), m = Math.max(1, Math.ceil(ext / 0.025));
    if (Math.min(Math.abs(A[2]), Math.abs(Bv[2]), Math.abs(C[2])) > W * 0.3 && Math.sign(A[2]) === Math.sign(Bv[2]) && Math.sign(Bv[2]) === Math.sign(C[2])) continue;
    for (let a = 0; a <= m; a++) for (let b = 0; a + b <= m; b++) { const u = a / m, w = b / m, x = A[0] + (Bv[0] - A[0]) * u + (C[0] - A[0]) * w, y = A[1] + (Bv[1] - A[1]) * u + (C[1] - A[1]) * w, z = A[2] + (Bv[2] - A[2]) * u + (C[2] - A[2]) * w;
      if (Math.abs(z) > W * 0.3) continue; const i = Math.round((x + L / 2) / step); if (i >= 0 && i <= n) prof[i] = Math.max(prof[i], y); } }
  for (let i = 0; i <= n; i++) if (prof[i] < 0) prof[i] = prof[i - 1] ?? 0.5;
  let belt = 9, wsx = -9, glassTop = 0;
  for (const t of tris.body) if (t.part === 'glass') for (const v of t.vs) { if (Math.abs(v.p[2]) > W * 0.35) belt = Math.min(belt, v.p[1]); wsx = Math.max(wsx, v.p[0]); glassTop = Math.max(glassTop, v.p[1]); }
  // the body's width at the doors (the box above also holds the mirrors) and the side glass's half width
  let wDoor = 0, wGlass = 0;
  for (const t of tris.body) for (const v of t.vs) { if (t.part === 'paint' && v.p[1] > H * 0.3 && v.p[1] < belt - 0.05) wDoor = Math.max(wDoor, Math.abs(v.p[2])); if (t.part === 'glass' && Math.abs(v.p[2]) > W * 0.35) wGlass = Math.max(wGlass, Math.abs(v.p[2])); }
  // parts: weld (position + normal) into indexed, quantised buffers
  const parts = {};
  const add = (part, vs) => { const P = parts[part] ||= { map: new Map(), pos: [], nor: [], idx: [] };
    for (const v of vs) { const q = v.p.map(c => Math.round(c * 4000)), m = v.n.map(c => Math.round(c * 127)), key = q.join(',') + '/' + m.join(',');
      let i = P.map.get(key); if (i === undefined) { i = P.pos.length / 3; P.map.set(key, i); P.pos.push(...q); P.nor.push(...m, 0); } P.idx.push(i); } };
  for (const t of tris.body) add(t.part, t.vs);
  for (const t of tris.wheel) add(t.part === 'rim' ? 'rim' : 'tire', t.vs);
  return { id, L: +L.toFixed(3), W: +W.toFixed(3), H: +H.toFixed(3), r: +r.toFixed(3), wb: +(xf - xr).toFixed(3), axles: [+(xf + dx).toFixed(3), +(xr + dx).toFixed(3)], track: +track.toFixed(3),
    wDoor: +(wDoor * 2).toFixed(3), wGlass: +wGlass.toFixed(3), belt: +belt.toFixed(3), wsx: +wsx.toFixed(3), glassTop: +glassTop.toFixed(3), profile: { x0: +(-L / 2).toFixed(3), step, y: prof.map(v => +v.toFixed(3)) }, parts };
}

const ids = fs.readdirSync(SRC).filter(n => !n.endsWith('.meta')).sort();
const chunks = [], meta = { source: 'Low Poly Soviet Car Pack (poly.pizza)', scale: 4000, models: {} }; let off = 0;
const push = arr => { const b = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength); const pad = (4 - (off + b.length) % 4) % 4; const at = off; chunks.push(b, Buffer.alloc(pad)); off += b.length + pad; return at; };
for (const id of ids) {
  const c = convert(id), parts = {};
  for (const [k, P] of Object.entries(c.parts)) {
    if (P.pos.length / 3 > 65535) throw new Error(id + ' ' + k + ': too many vertices');
    parts[k] = { n: P.pos.length / 3, i: P.idx.length, pos: push(Int16Array.from(P.pos)), nor: push(Int8Array.from(P.nor)), idx: push(Uint16Array.from(P.idx)) };
  }
  meta.models[id] = { ...c, parts };
  console.log(id, 'L', c.L, 'W', c.W, 'Wdoor', c.wDoor, 'wGlass', c.wGlass, 'H', c.H, 'r', c.r, 'wb', c.wb, 'track', c.track, 'belt', c.belt, 'wsx', c.wsx, Object.entries(parts).map(([k, p]) => k + ':' + p.i / 3).join(' '));
}
fs.mkdirSync(OUT, { recursive: true });
const bin = Buffer.concat(chunks);
meta.hash = crypto.createHash('sha1').update(bin).digest('hex').slice(0, 12); // the page asks for cars.bin?v=hash: a cached copy never meets a newer cars.json
fs.writeFileSync(path.join(OUT, 'cars.bin'), bin);
fs.writeFileSync(path.join(OUT, 'cars.json'), JSON.stringify(meta));
console.log('wrote', off, 'bytes');
