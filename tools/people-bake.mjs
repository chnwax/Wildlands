// Bakes the rigged, animated people (AssetsToUse/Ludzie, FBX from poly.pizza) into the game's crowd format:
// assets/models/people/people.json (per model: vertex and index counts, clips, byte ranges) + people.bin.
//   node tools/people-bake.mjs
// Each model's skin is evaluated here, offline, for the clips the pedestrians use (walk, idle, sit, run, a reach and a
// wave where the model has them), sampled into frames; the game draws every person of a model as one instanced mesh
// whose vertex shader reads its pose from these frames (vertex-animation textures, js/crowd.js). Positions are stored
// as half floats laid out as texture rows, one row a frame. The models are flat-shaded low poly: vertices are welded per
// control point and material, and the faces' normals come from the screen-space derivatives (no normal frames).
// FBX transforms: Lcl Translation / Rotation (Euler XYZ, degrees) / Scaling per node, no pivots or pre-rotations (the
// files are Blender exports); a vertex follows its clusters: bone world now x inverse(bone world at bind) x mesh world.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { readFBX } from './fbx.mjs';
import * as THREE from '../lib/three/build/three.module.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..');
const SRC = path.join(ROOT, 'AssetsToUse/Ludzie'), OUT = path.join(ROOT, 'assets/models/people');
const TICK = 46186158000;
// clips per model family: game clip -> the file's stack name, or [stack, from, to] for a part of it (fractions of its
// length); frames sampled per clip (the shader interpolates between). The men's sitting clip sits down in its first
// fifth and then stays seated: the game plays that part forward to sit and backward to stand (sitdown), and the seated
// rest back and forth while the person sits (sit).
const MEN = { walk: 'Man_Walk', idle: 'Man_Idle', sitdown: ['Man_Sitting', 0, 0.2], sit: ['Man_Sitting', 0.2, 1], run: 'Man_Run' };
const CHAR = { walk: 'Walk', idle: 'Idle_Neutral', run: 'Run', act: 'Interact', talk: 'Wave' };
const FRAMES = { walk: 20, idle: 16, sitdown: 10, sit: 16, run: 14, act: 18, talk: 20 };
const LOOP = { walk: true, idle: true, sitdown: false, sit: false, run: true, act: false, talk: true };
// parts the game recolours per person: 1 shirt / top, 2 trousers / skirt, 3 hair (0: keep the model's colour)
const MAN_PARTS = { Shirt: 1, Shirt2: 1, Pants: 2, Hair: 3, Hair2: 3 };
export const MODELS = [
  { id: 'man_casual', file: 'Man/Male_Casual.fbx', H: 1.74, clips: MEN, parts: MAN_PARTS },
  { id: 'man_shirt', file: 'Man-fjHyMd5Wxw/Male_Shirt.fbx', H: 1.72, clips: MEN, parts: MAN_PARTS },
  { id: 'man_longsleeve', file: 'Man in Long Sleeves/Male_LongSleeve.fbx', H: 1.75, clips: MEN, parts: MAN_PARTS },
  { id: 'man_suit', file: 'Man in Suit/Male_Suit.fbx', H: 1.76, clips: MEN, parts: { Hair: 3 } },
  // the women: casual (white top, orange trousers, blond hair) and formal (green dress, red hair)
  { id: 'casual', file: 'Casual.fbx', H: 1.66, clips: CHAR, parts: { White: 1, Orange: 2, Hair_Blond: 3, Hair_Brown: 3 } },
  { id: 'formal', file: 'Formal.fbx', H: 1.66, clips: CHAR, parts: { LimeGreen: 1, Red: 3 } },
];

const child = (n, name) => n && n.children.find(c => c.name === name);
const P70 = n => { const m = {}; const p = child(n, 'Properties70'); if (p) for (const c of p.children) m[c.props[0]] = c.props.slice(4); return m; };
const arr = (n, name) => { const c = child(n, name); return c ? c.props[0] : null; };
const ORDER = ['ZYX', 'YZX', 'XZY', 'ZXY', 'YXZ', 'XYZ']; // FBX eEulerXYZ.. (applied first to last) as three's orders

function loadFBX(file) {
  const fbx = readFBX(file), objects = fbx.roots.find(n => n.name === 'Objects'), conns = fbx.roots.find(n => n.name === 'Connections');
  const byId = new Map(); for (const n of objects.children) byId.set(n.props[0], n);
  const OO = [], OP = []; for (const c of conns.children) (c.props[0] === 'OO' ? OO : c.props[0] === 'OP' ? OP : []).push(c.props);
  const kids = id => OO.filter(c => c[2] === id).map(c => c[1]), parents = id => OO.filter(c => c[1] === id).map(c => c[2]);
  const models = new Map();
  for (const n of objects.children) if (n.name === 'Model') {
    const p = P70(n), id = n.props[0];
    models.set(id, { id, name: String(n.props[1]).split('::')[0], kind: n.props[2], T: (p['Lcl Translation'] || [0, 0, 0]).map(Number), R: (p['Lcl Rotation'] || [0, 0, 0]).map(Number),
      S: (p['Lcl Scaling'] || [1, 1, 1]).map(Number), order: ORDER[Number(p.RotationOrder?.[0] || 0)] || 'ZYX', parent: null });
    if (p.PreRotation || p.PostRotation || p.RotationPivot || p.ScalingPivot) console.warn(file, n.props[1], 'has pivots / pre-rotation: not supported');
  }
  for (const [id, m] of models) { const pm = parents(id).find(q => models.has(q)); m.parent = pm ?? null; }
  // animation stacks: name -> { t0, t1, nodes: Map(modelId -> { 'Lcl Translation': [curve x, y, z] | default, ... }) }
  const stacks = new Map();
  for (const n of objects.children) if (n.name === 'AnimationStack') {
    const p = P70(n), name = String(n.props[1]).split('::')[0].replace(/^.*\|/, ''), t0 = Number(p.LocalStart?.[0] || 0) / TICK, t1 = Number(p.LocalStop?.[0] || 0) / TICK;
    const nodes = new Map();
    for (const layerId of kids(n.props[0])) for (const cnId of kids(layerId)) {
      const cn = byId.get(cnId); if (!cn || cn.name !== 'AnimationCurveNode') continue;
      const tgt = OP.find(c => c[1] === cnId && models.has(c[2])); if (!tgt) continue;
      const def = P70(cn), curves = [0, 1, 2].map(k => { const ax = 'd|' + 'XYZ'[k], cid = OP.find(c => c[2] === cnId && c[3] === ax)?.[1], cv = cid && byId.get(cid);
        if (!cv) return { def: Number(def[ax]?.[0] ?? 0) };
        return { times: arr(cv, 'KeyTime').map(v => v / TICK), values: arr(cv, 'KeyValueFloat'), def: Number(arr(cv, 'Default') ?? def[ax]?.[0] ?? 0) }; });
      if (!nodes.has(tgt[2])) nodes.set(tgt[2], {});
      nodes.get(tgt[2])[tgt[3]] = curves;
    }
    stacks.set(name, { t0, t1, nodes });
  }
  // meshes with their skins
  const meshes = [];
  for (const n of objects.children) if (n.name === 'Geometry' && n.props[2] === 'Mesh') {
    const gid = n.props[0], modelId = parents(gid).find(q => models.has(q));
    const mats = kids(modelId).map(q => byId.get(q)).filter(q => q && q.name === 'Material').map(q => { const p = P70(q); return { name: String(q.props[1]).split('::')[0], color: (p.DiffuseColor || p.Diffuse || [0.8, 0.8, 0.8]).map(Number) }; });
    const skinId = kids(gid).find(q => byId.get(q)?.name === 'Deformer' && byId.get(q).props[2] === 'Skin');
    const clusters = skinId ? kids(skinId).map(q => byId.get(q)).filter(q => q && q.props[2] === 'Cluster').map(c => {
      const bone = kids(c.props[0]).find(q => models.has(q));
      return { bone, idx: arr(c, 'Indexes') || [], w: arr(c, 'Weights') || [], T: new THREE.Matrix4().fromArray(arr(c, 'Transform')), TL: new THREE.Matrix4().fromArray(arr(c, 'TransformLink')) };
    }) : [];
    meshes.push({ geo: n, model: modelId, mats, clusters });
  }
  return { models, stacks, meshes };
}

// a curve's value at t (linear between keys, held past the ends)
function curveAt(c, t) {
  if (!c.times || !c.times.length) return c.def;
  const T = c.times, V = c.values; if (t <= T[0]) return V[0]; if (t >= T[T.length - 1]) return V[V.length - 1];
  let lo = 0, hi = T.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] <= t) lo = m; else hi = m; }
  const f = (t - T[lo]) / (T[hi] - T[lo] || 1); return V[lo] + (V[hi] - V[lo]) * f;
}
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
function worldMatrices(F, stack, t) {
  const W = new Map();
  const get = id => {
    if (W.has(id)) return W.get(id);
    const m = F.models.get(id), A = stack && stack.nodes.get(id), val = (key, base, k) => A && A[key] ? curveAt(A[key][k], t) : base[k];
    const T = [0, 1, 2].map(k => val('Lcl Translation', m.T, k)), R = [0, 1, 2].map(k => val('Lcl Rotation', m.R, k) * Math.PI / 180), S = [0, 1, 2].map(k => val('Lcl Scaling', m.S, k));
    _e.set(R[0], R[1], R[2], m.order); _q.setFromEuler(_e);
    const L = new THREE.Matrix4().compose(_v.set(T[0], T[1], T[2]), _q, _s.set(S[0], S[1], S[2]));
    const out = m.parent != null ? new THREE.Matrix4().multiplyMatrices(get(m.parent), L) : L;
    W.set(id, out); return out;
  };
  for (const id of F.models.keys()) get(id);
  return W;
}

function bakeModel(def) {
  const F = loadFBX(path.join(SRC, def.file));
  // welded vertices: a control point per material
  const V = [], idx = [], key = new Map();
  for (const [mi, M] of F.meshes.entries()) {
    const g = M.geo, cp = arr(g, 'Vertices'), PI = arr(g, 'PolygonVertexIndex'), ln = child(g, 'LayerElementNormal'), lm = child(g, 'LayerElementMaterial');
    const nData = ln && arr(ln, 'Normals'), nIdx = ln && arr(ln, 'NormalsIndex'), nMap = ln && arr(ln, 'MappingInformationType');
    const mList = lm ? arr(lm, 'Materials') : null, mMap = lm ? arr(lm, 'MappingInformationType') : 'AllSame';
    // skin: per control point, its clusters and weights
    const inf = Array.from({ length: cp.length / 3 }, () => []);
    M.clusters.forEach((c, ci) => { for (let k = 0; k < c.idx.length; k++) if (c.w[k] > 1e-4) inf[c.idx[k]].push([ci, c.w[k]]); });
    for (const L of inf) { const s = L.reduce((a, b) => a + b[1], 0) || 1; for (const e of L) e[1] /= s; }
    let poly = 0, start = 0;
    const corner = (c, pIdx) => {
      const p = PI[c] < 0 ? ~PI[c] : PI[c], mat = mList ? (mMap === 'AllSame' ? mList[0] : mList[pIdx] ?? 0) : 0;
      let ni = nMap === 'ByPolygonVertex' ? c : p; if (nIdx) ni = nIdx[ni];
      const nx = nData ? nData[ni * 3] : 0, ny = nData ? nData[ni * 3 + 1] : 1, nz = nData ? nData[ni * 3 + 2] : 0;
      const k = mi + '|' + p + '|' + mat;
      let v = key.get(k);
      if (v === undefined) { v = V.length; key.set(k, v); const m = M.mats[mat] || { name: '', color: [0.8, 0.8, 0.8] };
        V.push({ mesh: mi, p: [cp[p * 3], cp[p * 3 + 1], cp[p * 3 + 2]], n: [nx, ny, nz], inf: inf[p], color: m.color, part: def.parts[m.name] || 0 }); }
      return v;
    };
    for (let c = 0; c < PI.length; c++) {
      if (PI[c] >= 0) continue;
      const vs = []; for (let q = start; q <= c; q++) vs.push(corner(q, poly));
      for (let k = 1; k + 1 < vs.length; k++) idx.push(vs[0], vs[k], vs[k + 1]);
      start = c + 1; poly++;
    }
  }
  const nv = V.length;
  // per cluster: from the mesh to the bone's frame at bind (inverse bone world at bind x the mesh's world). (The
  // clusters' own Transform is not the mesh's world in these files: the mesh model's transform is used, as three's
  // FBXLoader does.)
  const W0 = worldMatrices(F, null, 0), bindInv = F.meshes.map(M => M.clusters.map(c => new THREE.Matrix4().copy(c.TL).invert().multiply(W0.get(M.model))));
  const clips = {}, frameList = [];
  for (const [name, spec] of Object.entries(def.clips)) {
    const [stackName, a = 0, b = 1] = Array.isArray(spec) ? spec : [spec], st = F.stacks.get(stackName); if (!st) { console.warn(def.id, 'no clip', stackName); continue; }
    const n = FRAMES[name], len = st.t1 - st.t0, t0 = st.t0 + len * a, dur = len * (b - a), loop = LOOP[name];
    clips[name] = { f0: frameList.length, n, dur: +dur.toFixed(4), loop };
    for (let f = 0; f < n; f++) frameList.push([st, t0 + dur * f / (loop ? n : n - 1)]);
  }
  const nF = frameList.length, P = new Float32Array(nF * nv * 3);
  const v = new THREE.Vector3(), acc = new THREE.Vector3();
  frameList.forEach(([st, t], f) => {
    const W = worldMatrices(F, st, t);
    const skin = F.meshes.map((M, mi) => M.clusters.map((c, ci) => new THREE.Matrix4().multiplyMatrices(W.get(c.bone), bindInv[mi][ci])));
    for (let i = 0; i < nv; i++) {
      const q = V[i]; acc.set(0, 0, 0);
      if (!q.inf.length) acc.set(...q.p).applyMatrix4(W.get(F.meshes[q.mesh].model));
      else for (const [ci, w] of q.inf) acc.addScaledVector(v.set(...q.p).applyMatrix4(skin[q.mesh][ci]), w);
      P.set([acc.x, acc.y, acc.z], (f * nv + i) * 3);
    }
  });
  // standing on y = 0, centred over its feet, scaled to its height (all measured on the first idle frame)
  const r0 = clips.idle.f0; let y0 = Infinity, y1 = -Infinity, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < nv; i++) { const o = (r0 * nv + i) * 3; y0 = Math.min(y0, P[o + 1]); y1 = Math.max(y1, P[o + 1]); if (P[o + 1] - y0 < 1e9) { x0 = Math.min(x0, P[o]); x1 = Math.max(x1, P[o]); z0 = Math.min(z0, P[o + 2]); z1 = Math.max(z1, P[o + 2]); } }
  const s = def.H / (y1 - y0), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  for (let k = 0; k < nF * nv; k++) { P[k * 3] = (P[k * 3] - cx) * s; P[k * 3 + 1] = (P[k * 3 + 1] - y0) * s; P[k * 3 + 2] = (P[k * 3 + 2] - cz) * s; }
  // seated: where the seat bears (the lowest point under the pelvis, behind the knees), relative to the feet
  let seat = null;
  if (clips.sit) { const f = clips.sit.f0 + (clips.sit.n >> 1); let kz = -Infinity; for (let i = 0; i < nv; i++) { const o = (f * nv + i) * 3; if (P[o + 1] > 0.3 && P[o + 1] < 0.7) kz = Math.max(kz, P[o + 2]); }
    let sy = Infinity, sz = 0; for (let i = 0; i < nv; i++) { const o = (f * nv + i) * 3; if (P[o + 1] > 0.25 && P[o + 1] < 0.8 && Math.abs(P[o]) < 0.2 && P[o + 2] < kz - 0.25 && P[o + 1] < sy) { sy = P[o + 1]; sz = P[o + 2]; } }
    seat = [+sy.toFixed(3), +sz.toFixed(3)]; }
  // stride of the walk and the run (metres a cycle covers, so the game can match the cadence to the pace): the feet's
  // travel along the body over the cycle is a step; a cycle is two
  for (const c of ['walk', 'run']) { const C = clips[c]; if (!C) continue; let step = 0;
    const low = [...Array(nv).keys()].sort((a, b) => P[(C.f0 * nv + a) * 3 + 1] - P[(C.f0 * nv + b) * 3 + 1]).slice(0, 24);
    for (const i of low) { let z0 = Infinity, z1 = -Infinity; for (let f = 0; f < C.n; f++) { const z = P[((C.f0 + f) * nv + i) * 3 + 2]; z0 = Math.min(z0, z); z1 = Math.max(z1, z); } step = Math.max(step, z1 - z0); }
    C.stride = +(2 * step).toFixed(3); }
  return { def, nv, idx, V, clips, nF, P, seat, raw: { height: y1 - y0 } };
}

// float32 -> IEEE half
const _f = new Float32Array(1), _u = new Uint32Array(_f.buffer);
function half(x) {
  _f[0] = x; const b = _u[0], s = (b >>> 16) & 0x8000; let e = ((b >>> 23) & 0xff) - 127 + 15, m = b & 0x7fffff;
  if (e <= 0) return s; if (e >= 31) return s | 0x7c00;
  m += 0x1000; if (m & 0x800000) { m = 0; e++; if (e >= 31) return s | 0x7c00; }
  return s | (e << 10) | (m >> 13);
}

const chunks = [], meta = { version: 2, models: [] };
let off = 0;
const push = (typed) => { const pad = (4 - (off % 4)) % 4; if (pad) { chunks.push(Buffer.alloc(pad)); off += pad; } const b = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength); chunks.push(b); const at = off; off += b.length; return at; };
for (const def of MODELS) {
  const B = bakeModel(def), tex = new Uint16Array(B.nv * B.nF * 4);
  for (let k = 0; k < B.nv * B.nF; k++) { tex[k * 4] = half(B.P[k * 3]); tex[k * 4 + 1] = half(B.P[k * 3 + 1]); tex[k * 4 + 2] = half(B.P[k * 3 + 2]); tex[k * 4 + 3] = half(1); }
  const col = new Float32Array(B.nv * 3), part = new Uint8Array(B.nv); B.V.forEach((q, i) => { col.set(q.color, i * 3); part[i] = q.part; });
  const idx = B.nv > 65535 ? Uint32Array.from(B.idx) : Uint16Array.from(B.idx);
  const rec = { id: def.id, nv: B.nv, ni: B.idx.length, idx32: B.nv > 65535, frames: B.nF, H: def.H, clips: B.clips, seat: B.seat,
    idx: push(idx), col: push(col), part: push(part), pos: push(tex) };
  meta.models.push(rec);
  console.log(def.id.padEnd(15), 'verts', B.nv, 'tris', B.idx.length / 3, 'frames', B.nF, 'clips', Object.keys(B.clips).join(','), 'seat', B.seat, 'stride', B.clips.walk.stride, B.clips.run && B.clips.run.stride, 'walk', B.clips.walk.dur);
}
fs.mkdirSync(OUT, { recursive: true });
const all = Buffer.concat(chunks);
fs.writeFileSync(path.join(OUT, 'people.bin'), all);
meta.bytes = off; meta.hash = crypto.createHash('md5').update(all).digest('hex').slice(0, 10); // (the binary's URL carries it: a rebake is never served from a stale cache)
fs.writeFileSync(path.join(OUT, 'people.json'), JSON.stringify(meta));
console.log('people.bin', (off / 1048576).toFixed(2), 'MB');
