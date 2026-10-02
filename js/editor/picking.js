// Picking world objects under the cursor, whatever the renderer does with them: objects merged into shared buffers are
// tested against their own triangles inside those buffers, instanced ones (trees, rocks, bikes) against their part
// geometry at their instance transform, detached / added ones through their own meshes. The terrain is ray-marched
// with the world's ground height, so clicks on open ground hit the ground (placement) and nothing behind it.
import { THREE, camera } from '../core.js';

const ray = new THREE.Raycaster(), _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _box = new THREE.Box3(), _hit = new THREE.Vector3(), tmpMesh = new THREE.Mesh();
ray.layers.enableAll();
export class Picker {
  constructor(layer, world, opts) { this.L = layer; this.world = world; this.opts = opts; this.boxes = new Map(); this.spheres = new Map(); this.epoch = 0; }
  // the world-space bounds of an object may change: forget the cached ones
  invalidate(id) { if (id) this.boxes.delete(id); else this.boxes.clear(); }
  setFromClient(x, y) {
    const r = this.opts.dom.getBoundingClientRect();
    ray.setFromCamera({ x: (x - r.left) / r.width * 2 - 1, y: -(y - r.top) / r.height * 2 + 1 }, camera);
    return ray.ray;
  }
  // ground under the ray: [distance, point] or null (marching the world's height function)
  ground(r = ray.ray, maxD = 6000) {
    const g = (x, z) => this.world.groundAt(x, z);
    let t = 0, step = 0.5, prevT = 0, prevAbove = r.origin.y - g(r.origin.x, r.origin.z);
    if (prevAbove < 0) return null;
    while (t < maxD) {
      t += step; step = Math.min(step * 1.12, 12);
      r.at(t, _v); const h = _v.y - g(_v.x, _v.z);
      if (h <= 0) { // bisect between prevT and t
        let a = prevT, b = t; for (let k = 0; k < 24; k++) { const m = (a + b) / 2; r.at(m, _v); if (_v.y - g(_v.x, _v.z) > 0) a = m; else b = m; }
        r.at(b, _v); return [b, _v.clone()];
      }
      prevT = t; prevAbove = h;
    }
    return null;
  }
  box(ent) { let b = this.boxes.get(ent.id); if (!b) { b = this.L.worldBox(ent, new THREE.Box3()); this.boxes.set(ent.id, b); } return b; }
  visible(ent) {
    const st = ent.state;
    if (st && (st.deleted || (st.hidden && !this.opts.showHidden()))) return false;
    if (st && st.locked) return false;
    if (ent.kind === 'scatter' && !ent.det) { const s = ent.set; if (s.multi && s.lod[ent.i] < 0) return false; }
    return true;
  }
  // nearest object under the cursor: { id, point, distance } or null; also returns the ground hit
  pick(x, y, opts = {}) { return this.pickAlong(this.setFromClient(x, y).clone(), opts); }
  // nearest object hit by a ray (world space): { id, ent, point, normal, distance } or null
  pickRay(r, ignore = null) { return this.pickAlong(r, { ignore }).hit; }
  pickAlong(r, { ignore = null } = {}) {
    const gr = this.ground(r), far = gr ? gr[0] + 0.5 : 3000;
    const cands = [];
    for (const ent of this.L.geo) { if (ignore && ignore.has(ent.id)) continue; const b = this.box(ent); const t = r.intersectBox(b, _v) ? _v.distanceTo(r.origin) : (b.containsPoint(r.origin) ? 0 : -1); if (t >= 0 && t < far) cands.push([t, ent]); }
    for (const ent of this.L.ents.values()) if (ent.kind !== 'geo' && ent.det && !(ignore && ignore.has(ent.id))) { const b = this.box(ent); if (r.intersectBox(b, _v)) { const t = _v.distanceTo(r.origin); if (t < far) cands.push([t, ent]); } }
    // instanced objects: a sphere per item, cached per set
    for (const s of this.L.sets) {
      const S = this.sphereSet(s), n = s.items.length, ox = r.origin.x, oy = r.origin.y, oz = r.origin.z, dx = r.direction.x, dy = r.direction.y, dz = r.direction.z;
      for (let i = 0; i < n; i++) {
        const cx = S[i * 4] - ox, cy = S[i * 4 + 1] - oy, cz = S[i * 4 + 2] - oz, rr = S[i * 4 + 3];
        if (rr <= 0) continue;
        const tc = cx * dx + cy * dy + cz * dz; if (tc < -rr || tc - rr > far) continue;
        const d2 = cx * cx + cy * cy + cz * cz - tc * tc; if (d2 > rr * rr) continue;
        const ent = this.L.scatterEnt(this.L.table(s.meta.prefab) && s, i); if (ent.det || (ignore && ignore.has(ent.id))) continue;
        cands.push([Math.max(0, tc - rr), ent]);
      }
    }
    cands.sort((a, b) => a[0] - b[0]);
    let best = null;
    for (const [t0, ent] of cands) {
      if (best && t0 > best.distance) break;
      if (!this.visible(ent)) continue;
      const h = this.precise(ent, r);
      if (h && h.distance < far && (!best || h.distance < best.distance)) best = { id: ent.id, ent, point: h.point, distance: h.distance, normal: h.normal };
    }
    return { hit: best, ground: gr ? { point: gr[1], distance: gr[0] } : null };
  }
  sphereSet(s) {
    let S = this.spheres.get(s); if (S) return S;
    let rad = 0; for (const p of s.lods[0].parts) { const g = p.geometry; if (!g.boundingSphere) g.computeBoundingSphere(); rad = Math.max(rad, g.boundingSphere.center.length() + g.boundingSphere.radius); }
    S = new Float32Array(s.items.length * 4);
    s.items.forEach((it, i) => { const sc = it.s * Math.max(it.sx || 1, it.sy || 1, it.sz || it.sx || 1); S[i * 4] = it.x; S[i * 4 + 1] = it.y + sc * rad * 0.5; S[i * 4 + 2] = it.z; S[i * 4 + 3] = sc * rad; });
    this.spheres.set(s, S); return S;
  }
  precise(ent, r) {
    if (ent.det) {
      if (!ent.det.group.visible && !this.opts.showHidden()) return null;
      ray.ray.copy(r); const hits = ray.intersectObject(ent.det.group, true).filter(h => h.object.visible !== false);
      return hits.length ? { distance: hits[0].distance, point: hits[0].point, normal: hits[0].face ? hits[0].face.normal.clone().transformDirection(hits[0].object.matrixWorld) : null } : null;
    }
    if (ent.kind === 'scatter') {
      const s = ent.set; _m.fromArray(s.mat, ent.i * 16); let best = null;
      ray.ray.copy(r);
      for (const p of s.lods[0].parts) { tmpMesh.geometry = p.geometry; tmpMesh.material = p.material; tmpMesh.matrixWorld.copy(_m); const hits = []; tmpMesh.raycast(ray, hits); if (hits.length && (!best || hits[0].distance < best.distance)) best = hits[0]; }
      return best ? { distance: best.distance, point: best.point, normal: best.face ? best.face.normal.clone().transformDirection(_m) : null } : null;
    }
    // merged: the object's own triangles inside the shared buffers
    let best = null;
    for (const sg of ent.cap.segs) {
      const m = sg.b.mesh; if (!m || !m.visible) continue;
      const P = m.geometry.attributes.position.array, I = m.geometry.index.array; if (!P || !I) continue;
      for (let k = sg.i0; k + 2 < sg.i1; k += 3) {
        const a = I[k], b = I[k + 1], c = I[k + 2]; if (a === b || b === c) continue;
        _a.fromArray(P, a * 3); _b.fromArray(P, b * 3); _c.fromArray(P, c * 3);
        if (r.intersectTriangle(_a, _b, _c, false, _hit)) { const d = _hit.distanceTo(r.origin); if (!best || d < best.distance) best = { distance: d, point: _hit.clone(), normal: _b.sub(_a).cross(_c.sub(_a)).normalize().clone() }; }
      }
    }
    for (const o of ent.cap.meshes) { if (!o.geometry || !o.layers.mask) continue; ray.ray.copy(r); const hits = []; o.raycast(ray, hits); if (hits.length && (!best || hits[0].distance < best.distance)) best = { distance: hits[0].distance, point: hits[0].point, normal: null }; }
    return best;
  }
  // objects whose centre projects into the screen rectangle [x0,y0]-[x1,y1] (client pixels)
  inRect(x0, y0, x1, y1, { fields = false, maxDist = 1500 } = {}) {
    const rc = this.opts.dom.getBoundingClientRect(), out = [], cam = camera.position;
    const test = (ent, cx, cy, cz) => {
      _v.set(cx, cy, cz); if (_v.distanceTo(cam) > maxDist) return;
      _v.project(camera); if (_v.z < -1 || _v.z > 1) return;
      const sx = (_v.x + 1) / 2 * rc.width + rc.left, sy = (1 - _v.y) / 2 * rc.height + rc.top;
      if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1 && this.visible(ent)) out.push(ent.id);
    };
    for (const ent of this.L.geo) { const b = this.box(ent); b.getCenter(_c); test(ent, _c.x, _c.y, _c.z); }
    for (const ent of this.L.ents.values()) if (ent.kind === 'added') { const b = this.box(ent); b.getCenter(_c); test(ent, _c.x, _c.y, _c.z); }
    for (const s of this.L.sets) {
      if (!fields && s.meta.field) continue;
      s.items.forEach((it, i) => { if (!fields && it.field) return; _v.set(it.x, it.y, it.z); if (_v.distanceTo(cam) > maxDist) return; this.L.table(s.meta.prefab); test(this.L.scatterEnt(s, i), it.x, it.y + 0.5, it.z); });
    }
    return out;
  }
}
