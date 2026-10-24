// Transform gizmo: move (W), rotate (E), scale / stretch (R), in world or local space.
//   move:   an arrow per axis, a square per plane, the centre moves in the view plane
//   rotate: a ring per axis, the outer ring turns around the view direction
//   scale:  a cube-tipped line per axis (stretch along it), a square per plane, the centre cube scales uniformly
// It is drawn on top of the frame (its own overlay scene), stays the same size on screen, and reports a drag as a
// delta relative to its start: { mode, axis, offset (move), quat (rotate), scale [x, y, z] (scale), pivot, basis }.
// Snapping: snap.on with steps for metres, degrees and scale factors; holding Ctrl inverts it during the drag.
import { THREE, camera } from '../core.js';

const COL = { x: 0xef5a5a, y: 0x6fd06a, z: 0x5a9cff, v: 0xd9dde6, hi: 0xffd34d };
const AX = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
const mat = (c, o = 1) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false });
const lineMat = (c, o = 1) => new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: o, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _p = new THREE.Plane(), _r = new THREE.Raycaster();

export class Gizmo {
  constructor(dom) {
    this.dom = dom; this.scene = new THREE.Scene(); this.root = new THREE.Group(); this.scene.add(this.root);
    this.mode = 'translate'; this.space = 'world'; this.visible = false; this.size = 0.14;
    this.snap = { on: false, move: 0.5, rotate: 15, scale: 0.1 };
    this.pivot = new THREE.Vector3(); this.basis = new THREE.Quaternion(); // local space orientation
    this.hover = null; this.drag = null; this.ctrl = false;
    this.handles = { translate: this.buildTranslate(), rotate: this.buildRotate(), scale: this.buildScale() };
    for (const k in this.handles) this.root.add(this.handles[k]);
    this.onStart = this.onDrag = this.onEnd = () => {};
    addEventListener('keydown', e => { if (e.key === 'Control') { this.ctrl = true; if (this.drag) this.redrag(); } });
    addEventListener('keyup', e => { if (e.key === 'Control') { this.ctrl = false; if (this.drag) this.redrag(); } });
  }
  get snapping() { return this.snap.on !== this.ctrl; }
  // ---------------------------------------------------------------- building
  handle(group, axis, vis, pick, kind) { vis.userData.axis = axis; vis.userData.kind = kind; pick.userData.axis = axis; pick.userData.kind = kind; pick.visible = false; pick.userData.pick = true; vis.userData.base = vis.material.color.getHex(); vis.userData.op = vis.material.opacity; group.add(vis, pick); }
  buildTranslate() {
    const g = new THREE.Group();
    for (const a of ['x', 'y', 'z']) {
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.82, 8).translate(0, 0.41 + 0.08, 0), mat(COL[a]));
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 16).translate(0, 1.0, 0), mat(COL[a]));
      const vis = new THREE.Group(); vis.add(shaft, tip); vis.material = shaft.material; tip.material = shaft.material;
      const pick = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 1.05, 6).translate(0, 0.6, 0), mat(0, 0));
      for (const o of [vis, pick]) orient(o, a);
      this.handle(g, a, vis, pick, 'axis');
    }
    for (const [p, c] of [['xy', 'z'], ['yz', 'x'], ['xz', 'y']]) {
      const sq = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.24).translate(0.32, 0.32, 0), mat(COL[c], 0.45));
      const pick = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3).translate(0.32, 0.32, 0), mat(0, 0));
      for (const o of [sq, pick]) { if (p === 'yz') o.rotation.y = -Math.PI / 2; if (p === 'xz') o.rotation.x = Math.PI / 2; }
      this.handle(g, p, sq, pick, 'plane');
    }
    const c = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), mat(COL.v, 0.9)), cp = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), mat(0, 0));
    this.handle(g, 'view', c, cp, 'view');
    return g;
  }
  buildRotate() {
    const g = new THREE.Group();
    for (const a of ['x', 'y', 'z']) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.014, 6, 96), mat(COL[a]));
      const pick = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.09, 4, 48), mat(0, 0));
      for (const o of [ring, pick]) { if (a === 'x') o.rotation.y = Math.PI / 2; if (a === 'y') o.rotation.x = Math.PI / 2; }
      this.handle(g, a, ring, pick, 'ring');
    }
    const vr = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.012, 6, 96), mat(COL.v, 0.8)), vp = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.07, 4, 48), mat(0, 0));
    vr.userData.billboard = vp.userData.billboard = true;
    this.handle(g, 'view', vr, vp, 'ring');
    // a disc behind the rings: grabbing it does nothing, it just makes the rings read as a ball
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.88, 64), mat(0x000000, 0.12)); disc.userData.billboard = true; g.add(disc);
    return g;
  }
  buildScale() {
    const g = new THREE.Group();
    for (const a of ['x', 'y', 'z']) {
      const line = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.82, 8).translate(0, 0.41 + 0.08, 0), mat(COL[a]));
      const cube = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12).translate(0, 0.96, 0), line.material);
      const vis = new THREE.Group(); vis.add(line, cube); vis.material = line.material;
      const pick = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 1.05, 6).translate(0, 0.6, 0), mat(0, 0));
      for (const o of [vis, pick]) orient(o, a);
      this.handle(g, a, vis, pick, 'axis');
    }
    for (const [p, c] of [['xy', 'z'], ['yz', 'x'], ['xz', 'y']]) {
      const sq = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2).translate(0.3, 0.3, 0), mat(COL[c], 0.45));
      const pick = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26).translate(0.3, 0.3, 0), mat(0, 0));
      for (const o of [sq, pick]) { if (p === 'yz') o.rotation.y = -Math.PI / 2; if (p === 'xz') o.rotation.x = Math.PI / 2; }
      this.handle(g, p, sq, pick, 'plane');
    }
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), mat(COL.v, 0.95)), cp = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.26), mat(0, 0));
    this.handle(g, 'uniform', c, cp, 'uniform');
    return g;
  }
  // ---------------------------------------------------------------- per frame
  place(pivot, basis) { this.pivot.copy(pivot); if (basis) this.basis.copy(basis); }
  get orient() { return this.space === 'local' || this.mode === 'scale' ? this.basis : _q.identity(); }
  update() {
    this.root.visible = this.visible;
    for (const k in this.handles) this.handles[k].visible = this.visible && k === this.mode;
    if (!this.visible) return;
    const d = camera.position.distanceTo(this.pivot), s = d * Math.tan(camera.fov * Math.PI / 360) * 2 * this.size;
    this.root.position.copy(this.pivot); this.root.scale.setScalar(Math.max(1e-3, s));
    this.root.quaternion.copy(this.orient);
    // ring of the view axis and the disc face the camera; axis handles seen end-on fade out
    this.root.updateMatrixWorld(true);
    const toCam = _v.copy(camera.position).sub(this.pivot).normalize();
    this.handles[this.mode].traverse(o => {
      if (o.userData.billboard) { o.quaternion.copy(this.root.quaternion).invert().multiply(camera.quaternion); }
      if (o.userData.axis && o.userData.kind === 'axis' && !o.userData.pick) {
        const ax = _v2.copy(AX[o.userData.axis]).applyQuaternion(this.root.quaternion), f = Math.abs(ax.dot(toCam));
        o.visible = f < 0.985; o.traverse(m => { if (m.material) m.material.opacity = (this.hover === o.userData.axis || (this.drag && this.drag.axis === o.userData.axis)) ? 1 : f > 0.9 ? 0.35 : 1; });
      }
    });
    this.root.updateMatrixWorld(true);
  }
  highlight(axis) {
    this.hover = axis;
    this.handles[this.mode].traverse(o => {
      if (!o.userData.axis || o.userData.pick) return;
      const on = o.userData.axis === axis || (this.drag && this.drag.axis === o.userData.axis);
      const set = m => { if (!m.material || m.userData.pick) return; m.material.color.setHex(on ? COL.hi : o.userData.base); };
      o.traverse(set);
    });
  }
  // which handle is under the cursor (client coordinates), or null
  hit(x, y) {
    if (!this.visible) return null;
    const r = this.dom.getBoundingClientRect();
    _r.setFromCamera({ x: (x - r.left) / r.width * 2 - 1, y: -(y - r.top) / r.height * 2 + 1 }, camera);
    const picks = []; this.handles[this.mode].traverse(o => { if (o.userData.pick) picks.push(o); });
    for (const p of picks) p.visible = true;
    const hits = _r.intersectObjects(picks, false);
    for (const p of picks) p.visible = false;
    if (!hits.length) return null;
    // prefer the specific handle over the centre when they overlap
    const pri = h => ({ axis: 0, ring: 0, plane: 1, view: 2, uniform: 2 })[h.object.userData.kind] ?? 1; // arrows win over the plane squares they pass
    // rings cross each other on screen: the ring whose centre line passes nearest the cursor wins
    const ringD = h => { if (h.object.userData.kind !== 'ring') return 0; const p = h.object.worldToLocal(h.point.clone()), R = h.object.geometry.parameters.radius; return Math.hypot(Math.hypot(p.x, p.y) - R, p.z); };
    hits.sort((a, b) => pri(a) - pri(b) || (ringD(a) - ringD(b)) || a.distance - b.distance);
    return hits[0].object.userData.axis;
  }
  // ---------------------------------------------------------------- dragging
  rayAt(x, y) { const r = this.dom.getBoundingClientRect(); _r.setFromCamera({ x: (x - r.left) / r.width * 2 - 1, y: -(y - r.top) / r.height * 2 + 1 }, camera); return _r.ray.clone(); }
  axisDir(a) { return AX[a].clone().applyQuaternion(this.orient); }
  // a plane through the pivot that contains the axis and faces the camera as much as possible
  axisPlane(dir) { const toCam = _v.copy(camera.position).sub(this.pivot).normalize(); const n = _v2.copy(toCam).sub(dir.clone().multiplyScalar(toCam.dot(dir))); if (n.lengthSq() < 1e-6) n.copy(toCam); return new THREE.Plane().setFromNormalAndCoplanarPoint(n.normalize(), this.pivot); }
  point(ray, plane) { const p = new THREE.Vector3(); return ray.intersectPlane(plane, p) ? p : null; }
  begin(axis, x, y) {
    const D = { axis, x0: x, y0: y, x, y, pivot0: this.pivot.clone(), basis0: this.orient.clone(), mode: this.mode };
    const ray = this.rayAt(x, y);
    if (this.mode === 'translate' || this.mode === 'scale') {
      if (axis.length === 1) { D.dir = this.axisDir(axis); D.plane = this.axisPlane(D.dir); }
      else if (axis.length === 2) { const n = ['x', 'y', 'z'].find(a => !axis.includes(a)); D.plane = new THREE.Plane().setFromNormalAndCoplanarPoint(this.axisDir(n), this.pivot); D.axes = [...axis].map(a => this.axisDir(a)); }
      else D.plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()).negate(), this.pivot);
    } else {
      D.dir = axis === 'view' ? camera.getWorldDirection(new THREE.Vector3()).negate() : this.axisDir(axis);
      D.plane = new THREE.Plane().setFromNormalAndCoplanarPoint(D.dir, this.pivot);
    }
    D.p0 = this.point(ray, D.plane) || this.pivot.clone();
    const sp = this.pivot.clone().project(camera), r = this.dom.getBoundingClientRect();
    D.screenPivot = [(sp.x + 1) / 2 * r.width + r.left, (1 - sp.y) / 2 * r.height + r.top];
    D.r0 = Math.max(8, Math.hypot(x - D.screenPivot[0], y - D.screenPivot[1]));
    this.drag = D; this.highlight(axis); this.onStart(D);
  }
  move(x, y) { if (!this.drag) return; this.drag.x = x; this.drag.y = y; this.redrag(); }
  redrag() {
    const D = this.drag, ray = this.rayAt(D.x, D.y), p = this.point(ray, D.plane), snap = this.snapping;
    const out = { mode: D.mode, axis: D.axis, pivot: D.pivot0, basis: D.basis0, snap, snapStep: this.snap };
    if (D.mode === 'translate') {
      const off = p ? p.clone().sub(D.p0) : new THREE.Vector3();
      if (D.dir) { const k = off.dot(D.dir); off.copy(D.dir).multiplyScalar(k); }
      else if (D.axes && snap) { /* plane: snapped per axis below */ }
      out.offset = off;
    } else if (D.mode === 'rotate') {
      let ang = 0;
      if (p) { const a = D.p0.clone().sub(D.pivot0), b = p.clone().sub(D.pivot0); ang = Math.atan2(a.clone().cross(b).dot(D.dir), a.dot(b)); }
      if (snap) ang = Math.round(ang / (this.snap.rotate * Math.PI / 180)) * this.snap.rotate * Math.PI / 180;
      out.angle = ang; out.quat = new THREE.Quaternion().setFromAxisAngle(D.dir, ang);
    } else {
      let f = [1, 1, 1];
      if (D.axis === 'uniform') { const k = Math.max(0.01, Math.hypot(D.x - D.screenPivot[0], D.y - D.screenPivot[1]) / D.r0); f = [k, k, k]; }
      else if (p) {
        const idx = a => 'xyz'.indexOf(a);
        for (const a of D.axis) {
          const dir = this.axisDir(a), t0 = D.p0.clone().sub(D.pivot0).dot(dir), t = p.clone().sub(D.pivot0).dot(dir);
          f[idx(a)] = Math.abs(t0) > 1e-4 ? t / t0 : 1;
        }
        if (D.axis.length === 2) { const [a, b] = [...D.axis].map(idx), k = (f[a] + f[b]) / 2; f[a] = f[b] = k; }
      }
      out.scale = f.map(v => Math.max(-100, Math.min(100, v)));
    }
    this.onDrag(out);
  }
  end(cancel = false) { const D = this.drag; this.drag = null; this.highlight(null); if (D) this.onEnd(cancel); }
}
function orient(o, a) { if (a === 'x') o.rotation.z = -Math.PI / 2; if (a === 'z') o.rotation.x = Math.PI / 2; }
