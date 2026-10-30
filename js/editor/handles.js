// Direct manipulation (the editor's main tool, Q): the selection's box with a grip on each of its six faces, a grip
// above it and a ring at its foot.
//   face grip: drag it and only that side of the object moves — the opposite side stays where it is and the object
//              gets wider / taller / deeper in that one direction (Alt: both sides together, about the centre)
//   up grip:   raises or lowers the object
//   ring:      turns it about its vertical axis
//   the object itself: dragged, it slides over the ground (handled by the editor)
// Faces are named the way the viewer sees them — LEFT / RIGHT / FRONT / BACK relative to the camera, TOP / BOTTOM —
// and the box's size and the change in progress are shown in a label beside the cursor. The grips keep their size on
// screen (and never outgrow the face they sit on); everything is drawn over the frame in the gizmo's overlay scene.
import { THREE, camera } from '../core.js';

const COL = { 0: 0xf27b6b, 1: 0x7fd36f, 2: 0x6aa8ff, up: 0xeef2f8, rot: 0xffc857, hi: 0xffe066, box: 0xffffff };
const mat = (c, o = 1) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false });
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _r = new THREE.Raycaster(), Z = new THREE.Vector3(0, 0, 1), UP = new THREE.Vector3(0, 1, 0);
export const FACES = ['0+', '0-', '1+', '1-', '2+', '2-'];

export class DirectHandles {
  constructor(dom, scene) {
    this.dom = dom; this.root = new THREE.Group(); this.root.renderOrder = 10; scene.add(this.root);
    this.visible = false; this.hover = null; this.active = null; this.box = null; this.allow = { resize: true, turn: true, lift: true };
    // the box outline (a unit cube's edges, placed by the box's axes and size)
    this.lines = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: COL.box, transparent: true, opacity: 0.75, depthTest: false, depthWrite: false, toneMapped: false, fog: false }));
    this.lines.matrixAutoUpdate = false; this.root.add(this.lines);
    // face grips: a disc on the face and an arrow pointing out of it
    const disc = new THREE.CircleGeometry(1, 28), ring = new THREE.RingGeometry(0.72, 1.12, 28), arrow = new THREE.ConeGeometry(0.42, 0.9, 16).rotateX(Math.PI / 2).translate(0, 0, 1.05);
    this.grips = {};
    for (const f of FACES) {
      const ax = +f[0], g = new THREE.Group(), m = mat(COL[ax], 0.9), edge = mat(0xffffff, 0.95);
      const d = new THREE.Mesh(disc, m), e = new THREE.Mesh(ring, edge), a = new THREE.Mesh(arrow, m), pick = new THREE.Mesh(new THREE.SphereGeometry(1.7, 10, 8), mat(0, 0));
      pick.visible = false; pick.userData.pick = f; g.add(d, e, a, pick); g.userData = { key: f, mats: [m], base: COL[ax] };
      this.root.add(g); this.grips[f] = g;
    }
    // up grip: a double arrow above the box
    { const g = new THREE.Group(), m = mat(COL.up, 0.95);
      g.add(new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.8, 16).translate(0, 0.9, 0), m), new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.8, 16).rotateX(Math.PI).translate(0, -0.9, 0), m), new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 1.2, 10), m));
      const pick = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 3, 8), mat(0, 0)); pick.visible = false; pick.userData.pick = 'up'; g.add(pick);
      g.userData = { key: 'up', mats: [m], base: COL.up }; this.root.add(g); this.grips.up = g; }
    // turn ring at the foot, with a knob
    { const g = new THREE.Group(), m = mat(COL.rot, 0.6);
      g.add(new THREE.Mesh(new THREE.TorusGeometry(1, 0.006, 6, 128).rotateX(Math.PI / 2), m));
      const knob = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), m); knob.userData.knob = true; g.add(knob);
      const pick = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 6, 48).rotateX(Math.PI / 2), mat(0, 0)); pick.visible = false; pick.userData.pick = 'rot'; g.add(pick);
      const kp = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), mat(0, 0)); kp.visible = false; kp.userData.pick = 'rot'; kp.userData.knob = true; g.add(kp);
      g.userData = { key: 'rot', mats: [m], base: COL.rot }; this.root.add(g); this.grips.rot = g; }
    // label beside the cursor
    this.tip = document.createElement('div'); this.tip.id = 'dmTip';
    Object.assign(this.tip.style, { position: 'fixed', zIndex: 30, pointerEvents: 'none', display: 'none', padding: '4px 8px', borderRadius: '6px', background: 'rgba(20,24,32,.88)', color: '#f2f4f8',
      font: '12px/1.35 system-ui,sans-serif', border: '1px solid rgba(255,255,255,.18)', whiteSpace: 'nowrap', boxShadow: '0 2px 8px rgba(0,0,0,.35)' });
    document.body.append(this.tip);
  }
  // box: { C: center (world), U: [3 world unit axes], H: [3 half sizes in metres], foot: Vector3 (bottom centre) } or null
  set(box) { this.box = box; }
  // the world direction a face grip pushes along (outward)
  dir(key) { return this.box.U[+key[0]].clone().multiplyScalar(key[1] === '+' ? 1 : -1); }
  facePoint(key) { return this.box.C.clone().addScaledVector(this.dir(key), this.box.H[+key[0]]); }
  // the face's name as seen from the camera: TOP / BOTTOM, or LEFT / RIGHT / FRONT (toward the viewer) / BACK
  faceName(key) {
    const n = this.dir(key), right = _v.set(1, 0, 0).applyQuaternion(camera.quaternion), fwd = _v2.set(0, 0, -1).applyQuaternion(camera.quaternion); fwd.y = 0; fwd.normalize();
    const u = n.y, rr = n.dot(right), ff = n.dot(fwd);
    if (Math.abs(u) >= Math.max(Math.abs(rr), Math.abs(ff)) * 0.9) return u > 0 ? 'TOP' : 'BOTTOM';
    return Math.abs(rr) >= Math.abs(ff) ? (rr > 0 ? 'RIGHT' : 'LEFT') : (ff < 0 ? 'FRONT' : 'BACK');
  }
  // what the dimension along a face is called from here
  dimName(key) { const n = this.faceName(key); return n === 'TOP' || n === 'BOTTOM' ? 'Height' : n === 'LEFT' || n === 'RIGHT' ? 'Width' : 'Depth'; }
  update() {
    const B = this.box, on = this.visible && !!B; this.root.visible = on;
    if (!on) { this.tip.style.display = this.active ? this.tip.style.display : 'none'; return; }
    // box outline
    const M = new THREE.Matrix4().makeBasis(B.U[0].clone().multiplyScalar(B.H[0] * 2), B.U[1].clone().multiplyScalar(B.H[1] * 2), B.U[2].clone().multiplyScalar(B.H[2] * 2)).setPosition(B.C);
    this.lines.matrix.copy(M); this.lines.matrixWorldNeedsUpdate = true;
    const px = d => d * Math.tan(camera.fov * Math.PI / 360) * 2 / Math.max(1, this.dom.clientHeight); // metres per pixel at distance d
    for (const f of FACES) {
      const g = this.grips[f], p = this.facePoint(f), d = camera.position.distanceTo(p), ax = +f[0];
      const other = [0, 1, 2].filter(i => i !== ax).map(i => B.H[i]), s = Math.max(px(d) * 6, Math.min(px(d) * 12, Math.max(...other) * 0.5 + 0.03));
      g.visible = this.allow.resize;
      // on a small part the grips would pile up: each stands off its face far enough to be grabbed on its own
      const stand = Math.max(s * 0.15, px(d) * 22 - B.H[ax]);
      g.position.copy(p).addScaledVector(this.dir(f), stand); g.quaternion.setFromUnitVectors(Z, this.dir(f)); g.scale.setScalar(Math.max(1e-3, s));
      // a grip seen edge-on is hard to grab and hides its neighbours: it fades
      const facing = Math.abs(this.dir(f).dot(_v.copy(camera.position).sub(p).normalize()));
      for (const m of g.userData.mats) m.opacity = this.hover === f || this.active === f ? 1 : 0.6 + 0.4 * Math.min(1, facing * 1.6);
    }
    { const g = this.grips.up, top = B.C.clone().addScaledVector(UP, Math.abs(B.U[1].y) * B.H[1] + Math.abs(B.U[0].y) * B.H[0] + Math.abs(B.U[2].y) * B.H[2]), d = camera.position.distanceTo(top), s = px(d) * 9;
      g.visible = this.allow.lift; g.position.copy(top).addScaledVector(UP, s * 3.2); g.quaternion.identity(); g.scale.setScalar(s); }
    { const g = this.grips.rot, R = Math.hypot(B.H[0] * Math.hypot(B.U[0].x, B.U[0].z), B.H[2] * Math.hypot(B.U[2].x, B.U[2].z)) * 1.08 + 0.1, d = camera.position.distanceTo(B.foot), s = px(d) * 6;
      g.visible = this.allow.turn; g.position.copy(B.foot).addScaledVector(UP, 0.02); g.scale.set(R, R, R); g.quaternion.identity();
      // the knob sits on the ring on the side nearest the camera
      const toCam = _v.copy(camera.position).sub(B.foot); toCam.y = 0; if (toCam.lengthSq() < 1e-6) toCam.set(0, 0, 1); toCam.normalize();
      for (const k of g.children) if (k.userData.knob) { k.position.copy(toCam); k.scale.setScalar(Math.max(1e-3, s * 1.1 / R)); }
      g.children[0].scale.set(1, 1, 1); }
    this.root.updateMatrixWorld(true);
  }
  highlight(key) {
    this.hover = key;
    for (const g of Object.values(this.grips)) for (const m of g.userData.mats) m.color.setHex(g.userData.key === key || g.userData.key === this.active ? COL.hi : g.userData.base);
  }
  ray(x, y) { const r = this.dom.getBoundingClientRect(); _r.setFromCamera({ x: (x - r.left) / r.width * 2 - 1, y: -(y - r.top) / r.height * 2 + 1 }, camera); return _r.ray.clone(); }
  // the grip under the cursor (client coordinates): a face key '0+'..'2-', 'up', 'rot', or null
  hit(x, y) {
    if (!this.visible || !this.box) return null;
    this.update();
    const picks = []; this.root.traverse(o => { if (o.userData.pick && o.parent.visible) picks.push(o); });
    for (const p of picks) p.visible = true;
    const r = this.dom.getBoundingClientRect(); _r.setFromCamera({ x: (x - r.left) / r.width * 2 - 1, y: -(y - r.top) / r.height * 2 + 1 }, camera);
    const hits = _r.intersectObjects(picks, false);
    for (const p of picks) p.visible = false;
    if (!hits.length) return null;
    // a face grip wins over the ring it may overlap; among faces, the nearest
    hits.sort((a, b) => (a.object.userData.pick === 'rot') - (b.object.userData.pick === 'rot') || a.distance - b.distance);
    return hits[0].object.userData.pick;
  }
  // the tooltip / label: text (may contain <b>), at client x, y
  label(html, x, y) { if (!html) { this.tip.style.display = 'none'; return; } this.tip.innerHTML = html; this.tip.style.display = 'block'; this.tip.style.left = (x + 16) + 'px'; this.tip.style.top = (y + 14) + 'px'; }
  hint(key) {
    if (key === 'up') return '<b>Raise / lower</b> — drag up or down';
    if (key === 'rot') return '<b>Turn</b> — drag around the ring';
    const n = this.faceName(key), dim = this.dimName(key), opp = { LEFT: 'right', RIGHT: 'left', TOP: 'bottom', BOTTOM: 'top', FRONT: 'back', BACK: 'front' }[n];
    return `<b>${n} side</b> — drag to change the ${dim.toLowerCase()} (${dim} ${(this.box.H[+key[0]] * 2).toFixed(2)} m)<br><span style="opacity:.7">the ${opp} side stays · Alt: both sides</span>`;
  }
}
