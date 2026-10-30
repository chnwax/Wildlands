// Editor camera: orbit (around a pivot) and free fly, switchable at any time without a jump.
//   Orbit: right-drag orbits, middle-drag (or Shift+right-drag) pans, wheel zooms toward the cursor.
//   Fly:   right-drag looks around.
//   Both:  while the right button is held, W A S D move, Q / E go down / up, Shift is faster, the wheel changes speed.
// The camera keeps yaw/pitch (camera.rotation order YXZ); the pivot lies `dist` metres ahead of it.
import { THREE, camera, clamp } from '../core.js';

const _v = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3();
export class EditorCamera {
  constructor(dom, { groundAt, pickPoint }) {
    this.dom = dom; this.groundAt = groundAt; this.pickPoint = pickPoint; // pickPoint(clientX, clientY) -> Vector3 | null
    this.mode = 'fly'; this.yaw = 0; this.pitch = -0.5; this.dist = 60; this.pivot = new THREE.Vector3();
    this.speed = 12; this.keys = {}; this.drag = null; this.anim = null; this.onChange = () => {};
    dom.addEventListener('pointerdown', e => this._down(e));
    addEventListener('pointermove', e => this._move(e));
    addEventListener('pointerup', e => this._up(e));
    dom.addEventListener('wheel', e => this._wheel(e), { passive: false });
    dom.addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('keydown', e => { if (!e.target.closest || !e.target.closest('input,textarea,select')) this.keys[e.code] = true; });
    addEventListener('keyup', e => { this.keys[e.code] = false; });
    addEventListener('blur', () => { this.keys = {}; this.drag = null; });
  }
  get flying() { return !!(this.drag && this.drag.button === 2 && !this.drag.pan); }
  setMode(m) { if (m === this.mode) return; this.mode = m; this.onChange(); }
  place(x, y, z, yaw, pitch, dist = this.dist) {
    this.yaw = yaw; this.pitch = pitch; this.dist = dist;
    camera.position.set(x, y, z); this._syncPivot(); this._apply();
  }
  // current view, serializable (survives reloads of world files)
  get state() { return { p: camera.position.toArray().map(v => +v.toFixed(3)), yaw: +this.yaw.toFixed(4), pitch: +this.pitch.toFixed(4), dist: +this.dist.toFixed(2), mode: this.mode, speed: this.speed }; }
  set state(s) { this.mode = s.mode || this.mode; this.speed = s.speed || this.speed; this.place(s.p[0], s.p[1], s.p[2], s.yaw, s.pitch, s.dist || this.dist); }
  forward(out = _f) { return out.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch)); }
  _syncPivot() { this.pivot.copy(camera.position).addScaledVector(this.forward(), this.dist); }
  _apply() { camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ'); camera.updateMatrixWorld(); }
  _fromPivot() { camera.position.copy(this.pivot).addScaledVector(this.forward(), -this.dist); this._apply(); }
  // smooth move so that box (Box3) fills the view, keeping the viewing direction
  focus(box, instant = false) {
    const c = box.getCenter(new THREE.Vector3()), r = Math.max(0.5, box.getSize(_v).length() / 2);
    const fov = camera.fov * Math.PI / 180, d = clamp(r / Math.sin(Math.min(fov, fov * camera.aspect) / 2) * 1.05, 2, 4000);
    const from = { p: this.pivot.clone(), d: this.dist }, to = { p: c, d };
    if (instant) { this.pivot.copy(c); this.dist = d; this._fromPivot(); this.onChange(); return; }
    this.anim = { t: 0, from, to };
  }
  _down(e) {
    // right: look around (fly) / orbit (orbit mode); middle or Shift+right: pan; Alt+left: orbit round the selection
    const altOrbit = e.button === 0 && e.altKey;
    if (e.button !== 2 && e.button !== 1 && !altOrbit) return;
    e.preventDefault(); this.dom.setPointerCapture?.(e.pointerId);
    const pan = e.button === 1 || (e.button === 2 && e.shiftKey);
    this.anim = null;
    if (altOrbit) { // pivot: the selection (getPivot) or what is under the cursor; the view itself does not jump
      const p = (this.getPivot && this.getPivot()) || this.pickPoint(e.clientX, e.clientY);
      if (p) { const d = Math.max(1, p.distanceTo(camera.position)); this.dist = d; this.pivot.copy(camera.position).addScaledVector(this.forward(), d); this.orbitAround = p.clone(); } else this.orbitAround = null;
      this.drag = { button: 0, x: e.clientX, y: e.clientY, pan: false, orbit: true, moved: 0 }; return;
    }
    let panDepth = this.dist;
    if (pan) { const p = this.pickPoint(e.clientX, e.clientY); if (p) panDepth = Math.max(2, p.distanceTo(camera.position)); }
    this.drag = { button: e.button, x: e.clientX, y: e.clientY, pan, moved: 0, panDepth };
  }
  _move(e) {
    const D = this.drag; if (!D) return;
    const dx = e.clientX - D.x, dy = e.clientY - D.y; D.x = e.clientX; D.y = e.clientY; D.moved += Math.abs(dx) + Math.abs(dy);
    if (D.pan) {
      const k = 2 * D.panDepth * Math.tan(camera.fov * Math.PI / 360) / innerHeight;
      _r.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const up = _v.set(0, 1, 0).applyQuaternion(camera.quaternion);
      const delta = _r.multiplyScalar(-dx * k).addScaledVector(up, dy * k);
      camera.position.add(delta); this.pivot.add(delta); this._apply();
    } else if (D.orbit && this.orbitAround) {
      // turn the camera round the pivot point: position rotates about it, the view direction turns with it
      const P = this.orbitAround, off = camera.position.clone().sub(P), oldYaw = this.yaw, oldPitch = this.pitch;
      this.yaw -= dx * 0.005; this.pitch = clamp(this.pitch - dy * 0.005, -1.5, 1.5);
      off.applyAxisAngle(_v.set(0, 1, 0), this.yaw - oldYaw);
      const right = _r.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)); off.applyAxisAngle(right, this.pitch - oldPitch);
      camera.position.copy(P).add(off);
      const g = this.groundAt(camera.position.x, camera.position.z); if (camera.position.y < g + 0.4) camera.position.y = g + 0.4;
      this._apply(); this._syncPivot();
    } else {
      this.yaw -= dx * 0.0035; this.pitch = clamp(this.pitch - dy * 0.0035, -1.55, 1.55);
      if (this.mode === 'orbit' && !this._keysMoving()) this._fromPivot(); else { this._apply(); this._syncPivot(); }
    }
    this.onChange();
  }
  _up(e) { if (this.drag && e.button === this.drag.button) { this.drag = null; this.keys = {}; } }
  _keysMoving() { const k = this.keys; return k.KeyW || k.KeyA || k.KeyS || k.KeyD || k.KeyQ || k.KeyE; }
  _wheel(e) {
    e.preventDefault();
    if (this.flying) { this.speed = clamp(this.speed * (e.deltaY < 0 ? 1.25 : 0.8), 0.5, 600); this.onChange(); return; }
    this.anim = null;
    const s = Math.exp(clamp(e.deltaY, -300, 300) * 0.0012);
    if (true) { // zoom toward what is under the cursor (both modes)
      // zoom toward the point under the cursor
      const p = this.pickPoint(e.clientX, e.clientY);
      if (p) { const d = p.distanceTo(camera.position), nd = clamp(d * s, 0.5, 6000); camera.position.lerp(p, 1 - nd / d); this._syncPivot(); this.dist = clamp(this.dist * s, 0.5, 6000); this._syncPivot(); }
      else { this.dist = clamp(this.dist * s, 0.5, 6000); this._fromPivot(); }
    } else {
      camera.position.addScaledVector(this.forward(), (1 - s) * Math.max(4, this.speed)); this._apply(); this._syncPivot();
    }
    this.onChange();
  }
  update(dt) {
    if (this.anim) {
      const A = this.anim; A.t = Math.min(1, A.t + dt / 0.35); const k = 1 - Math.pow(1 - A.t, 3);
      this.pivot.lerpVectors(A.from.p, A.to.p, k); this.dist = A.from.d + (A.to.d - A.from.d) * k; this._fromPivot();
      if (A.t >= 1) this.anim = null; this.onChange();
    }
    if (!this.flying) return;
    const k = this.keys, f = this.forward(_f), r = _r.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const mv = _v.set(0, 0, 0);
    if (k.KeyW) mv.add(f); if (k.KeyS) mv.sub(f); if (k.KeyD) mv.add(r); if (k.KeyA) mv.sub(r);
    if (k.KeyE) mv.y += 1; if (k.KeyQ) mv.y -= 1;
    if (mv.lengthSq() === 0) return;
    const sp = this.speed * (k.ShiftLeft || k.ShiftRight ? 3 : 1) * (k.ControlLeft ? 0.25 : 1);
    camera.position.addScaledVector(mv.normalize(), sp * dt);
    const g = this.groundAt(camera.position.x, camera.position.z); if (camera.position.y < g + 0.4) camera.position.y = g + 0.4;
    this._apply(); this._syncPivot(); this.onChange();
  }
}
