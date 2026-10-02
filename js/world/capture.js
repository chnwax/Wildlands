// World-object capture. While a map is built, every placed object (a house, a bench, a lamp post, a rock...) is wrapped
// in beginEntity/endEntity — usually by `placeable` around the function that builds it. The capture notes which
// vertices and triangles the object wrote into the shared, merged GeoBuilder buffers, which colliders, instanced props,
// scene meshes and light fixtures it added, and where it stands (its base transform). The world layer (world/layer.js)
// turns these records into editable objects with stable ids: the game keeps drawing everything merged and instanced,
// and only an object that is edited is taken out of the merged buffers into a mesh of its own.
// Objects may nest (a playground builds benches): an inner object is its own entity and records its parent.
import { scene, capHooks, lampPoints } from '../core.js';

export const CAP = { ents: [], active: false };
export const owner = new WeakMap(); // loose scene mesh -> the captured object it belongs to
const stack = [];
let top = null;

function closeOpen(e) { for (const s of e.open.values()) { s.v1 = s.b.pos.length / 3; s.i1 = s.b.idx.length; } e.open.clear(); }
function touch(b) {
  if (!top) return;
  let s = top.open.get(b);
  if (!s) { s = { b, v0: b.pos.length / 3, i0: b.idx.length, v1: -1, i1: -1 }; top.open.set(b, s); top.segs.push(s); }
}
export function startCapture() {
  CAP.active = true; CAP.ents.length = 0;
  capHooks.bucket = touch;
  // an object placed without an explicit base stands where its builder first sets a frame (B.frame(x, y, z, yaw))
  capHooks.frame = (x, y, z, r) => { if (top && !top.based && (x || y || z)) { top.x = x; top.y = y; top.z = z; top.ry = r; top.based = true; } };
  capHooks.collider = c => { if (top) top.colliders.push(c); };
  capHooks.prop = id => { if (top) top.props.push(id); };
}
export function stopCapture() {
  while (stack.length) endEntity();
  capHooks.bucket = capHooks.collider = capHooks.prop = capHooks.frame = null; CAP.active = false;
}
// base: [x, y, z, yaw] — where the object stands and which way it faces (the frame its geometry was built in)
export function beginEntity(prefab, base, opts = {}) {
  if (!CAP.active) return null;
  const e = { prefab, x: base ? base[0] : 0, y: base ? base[1] : 0, z: base ? base[2] : 0, ry: base ? base[3] || 0 : 0, based: !!base, segs: [], open: new Map(), colliders: [], props: [], meshes: [], lamps: [],
    parent: top, mesh0: scene.children.length, lamp0: lampPoints.length, opts, seq: CAP.ents.length };
  if (top) closeOpen(top);
  stack.push(e); top = e; CAP.ents.push(e);
  return e;
}
export function endEntity() {
  const e = stack.pop(); if (!e) return;
  closeOpen(e);
  for (let i = e.mesh0; i < scene.children.length; i++) { const o = scene.children[i]; if (!owner.has(o) && (o.isMesh || o.isLine || o.isPoints || o.isGroup) && !o.isInstancedMesh) { owner.set(o, e); e.meshes.push(o); } }
  for (let i = e.lamp0; i < lampPoints.length; i++) { const l = lampPoints[i]; if (!l.__ent) { l.__ent = e; e.lamps.push(l); } }
  e.segs = e.segs.filter(s => s.v1 > s.v0 || s.i1 > s.i0);
  top = stack.length ? stack[stack.length - 1] : null;
}
// run fn as one placed object (base null: taken from the builder's first frame, see capHooks.frame)
export function entity(prefab, fn, base = null, opts) {
  if (!CAP.active) return fn();
  beginEntity(prefab, base, opts);
  try { return fn(); } finally { endEntity(); }
}
// fn wrapped so that each call is one placed object of `prefab`; at(...args) -> [x, y, z, yaw]
export function placeable(prefab, fn, at, opts) {
  const w = function (...args) {
    if (!CAP.active) return fn.apply(this, args);
    let base = null; if (at) try { base = at(...args); } catch (e) { base = null; }
    beginEntity(typeof prefab === 'function' ? prefab(...args) : prefab, base, opts);
    try { return fn.apply(this, args); } finally { endEntity(); }
  };
  return w;
}
// the usual argument shapes
export const atXYZR = (B, x, y, z, r = 0) => [x, y, z, r];        // fn(B, x, y, z, r, ...)
export const atObj = (B, s) => [s.x, s.y ?? 0, s.z, s.r || 0];    // fn(B, {x, y, z, r, ...}, ...)
// coordinates in the builder's current frame (helpers that place a part inside a compound)
export const atLocal = (B, lx, ly, lz, lr = 0) => { const p = B.P([lx, ly, lz]); return [p[0], p[1], p[2], B.F.r + lr]; };
