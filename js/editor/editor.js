// Editor controller: selection, viewport interaction (click, Shift+click, box select, direct manipulation — face grips,
// dragging objects over the ground, the lift grip and the turn ring — and the advanced XYZ gizmo, placing from the
// palette) and every editing command (duplicate, copy / paste of objects and of single parts, delete, drop to ground,
// align to surface, group, hide, lock, materials). All changes go through the document's command history (doc.js).
import { THREE, camera, renderer } from '../core.js';
import { Picker } from './picking.js';
import { Gizmo } from './gizmo.js';
import { DirectHandles } from './handles.js';
import { Outline } from './outline.js';
import { ui, toast } from './ui.js';
import { labelOf, PRIMITIVES } from '../world/layer.js';

const DEG = Math.PI / 180, RAD = 180 / Math.PI;
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler(), _m = new THREE.Matrix4(), _s = new THREE.Vector3();
const clone = o => o == null ? o : JSON.parse(JSON.stringify(o));
export const quatOf = r => _q.setFromEuler(_e.set(r[0] * DEG, r[1] * DEG, r[2] * DEG, 'XYZ')).clone();
// degrees, XYZ order; of the two equivalent angle sets the one with the smaller tilt (a pure turn reads [0, yaw, 0])
export const eulerOf = q => {
  _e.setFromQuaternion(q, 'XYZ'); let x = _e.x * RAD, y = _e.y * RAD, z = _e.z * RAD;
  const alt = [x - Math.sign(x || 1) * 180, (y >= 0 ? 180 : -180) - y, z - Math.sign(z || 1) * 180];
  if (Math.abs(alt[0]) + Math.abs(alt[2]) < Math.abs(x) + Math.abs(z) - 1e-6) [x, y, z] = alt;
  const clean = v => Math.abs(v) < 1e-7 ? 0 : v;
  return [clean(x), clean(y), clean(z)];
};
const MAX_OUTLINED = 250;

export class Editor {
  constructor(ed, doc) {
    this.ed = ed; this.doc = doc; this.L = doc.layer; this.world = ed.world; this.dom = renderer.domElement;
    this.sel = []; this.hoverId = null; this.tool = 'direct'; this.showHidden = false; this.listeners = new Set();
    this.picker = new Picker(this.L, this.world, { dom: this.dom, showHidden: () => this.showHidden });
    this.gizmo = new Gizmo(this.dom); this.outline = new Outline(); this.handles = new DirectHandles(this.dom, this.gizmo.scene);
    this.placing = null; // { prefab, ghost } while a palette item is armed
    this.matClip = null; // copied material: { material, materialOverrides, slots }
    this.gizmo.onStart = D => this.dragStart(D); this.gizmo.onDrag = o => this.dragMove(o); this.gizmo.onEnd = c => this.dragEnd(c);
    try { const s = JSON.parse(localStorage.getItem('wl_ed_snap') || 'null'); if (s) Object.assign(this.gizmo.snap, s); } catch (e) {}
    this.bindPointer();
    doc.on(ev => { if (ev.type === 'change' || ev.type === 'external') { for (const id of ev.ids || []) this.picker.invalidate(id); if (ev.type === 'external' && ev.ids && ev.ids.length) this.picker.invalidate(); this.sel = this.sel.filter(id => this.L.get(id)); this.refreshSelection(); } });
  }
  on(fn) { this.listeners.add(fn); }
  emit(t) { for (const f of this.listeners) f(t); }
  // ---------------------------------------------------------------- selection
  select(ids, mode = 'set', keepPart = false) {
    if (!keepPart) this.part = null;
    ids = ids.filter(id => { const e = this.L.get(id); return e && !(this.doc.rec(id) || {}).locked; });
    if (mode === 'set') this.sel = [...new Set(ids)];
    else if (mode === 'add') { for (const id of ids) if (!this.sel.includes(id)) this.sel.push(id); }
    else if (mode === 'toggle') for (const id of ids) { const i = this.sel.indexOf(id); if (i >= 0) this.sel.splice(i, 1); else this.sel.push(id); }
    else if (mode === 'remove') this.sel = this.sel.filter(id => !ids.includes(id));
    this.refreshSelection();
  }
  get primary() { return this.sel.length ? this.sel[this.sel.length - 1] : null; }
  refreshSelection() {
    const meshes = [], boxes = [];
    this.sel.forEach((id, k) => {
      const e = this.L.get(id); if (!e) return;
      const rec = this.doc.rec(id);
      const P = this.part && this.part.id === id ? this.part.slot : null;
      if (k < MAX_OUTLINED && !(rec && (rec.deleted))) { if (!e.det) this.L.detach(e); if (e.det.group.visible) { if (P) { for (const p of e.det.parts) if (p.slot === P) meshes.push(p.mesh); } else e.det.group.traverse(o => { if (o.isMesh && o.visible !== false) meshes.push(o); }); } else boxes.push(this.L.worldBox(e)); }
      else boxes.push(this.L.worldBox(e));
    });
    const hov = [];
    if (this.hoverId && !this.sel.includes(this.hoverId)) { const e = this.L.get(this.hoverId); if (e && e.det && e.det.group.visible) e.det.group.traverse(o => { if (o.isMesh) hov.push(o); }); }
    this.outline.set(meshes, boxes, hov);
    this.placeGizmo();
    this.emit('selection');
  }
  get xyz() { return this.tool === 'translate' || this.tool === 'rotate' || this.tool === 'scale'; }
  placeGizmo() {
    const ids = this.sel.filter(id => { const r = this.doc.rec(id); return r && !r.deleted; });
    this.gizmo.visible = ids.length > 0 && this.xyz && !this.placing;
    this.handles.visible = ids.length > 0 && this.tool === 'direct' && !this.placing;
    if (!ids.length) { this.handles.set(null); return; }
    const box = this.selectionBox(ids); this.handles.set(box);
    this.handles.allow = { resize: ids.length === 1, turn: true, lift: true };
    const c = new THREE.Vector3(); for (const id of ids) c.add(_v.fromArray(this.doc.rec(id).position)); c.divideScalar(ids.length);
    const prim = this.doc.rec(ids[ids.length - 1]);
    if (this.part && ids.length === 1) { const e = this.L.get(ids[0]); if (e && e.det) { const el = (prim.slots || {})[this.part.slot] || {}, c = this.L.elementPivot(e, this.part.slot).clone().add(_v.fromArray(el.offset || [0, 0, 0])); e.det.group.updateMatrixWorld(true); this.gizmo.place(c.applyMatrix4(e.det.group.matrixWorld), quatOf(prim.rotation)); return; } }
    this.gizmo.place(ids.length === 1 ? _v.fromArray(prim.position) : c, quatOf(prim.rotation));
  }
  // the box the direct handles sit on: one object (or the element being edited) in its own axes, several objects as one
  // box in world axes. { C, U: [3 unit axes], H: [3 half sizes], foot }
  selectionBox(ids) {
    const mk = (M, lb) => {
      const ctr = lb.getCenter(new THREE.Vector3()), C = ctr.clone().applyMatrix4(M), U = [], H = [];
      for (let i = 0; i < 3; i++) { const col = new THREE.Vector3().setFromMatrixColumn(M, i), L = col.length() || 1; U.push(col.divideScalar(L)); H.push(L * (lb.max.getComponent(i) - lb.min.getComponent(i)) / 2); }
      const foot = new THREE.Vector3(ctr.x, lb.min.y, ctr.z).applyMatrix4(M);
      return { C, U, H, foot, M: M.clone(), lb: lb.clone() };
    };
    if (ids.length === 1) {
      const e = this.L.get(ids[0]); if (!e) return null;
      if (this.part && this.part.id === ids[0] && e.det) {
        e.det.group.updateMatrixWorld(true);
        const p = e.det.parts.find(q => q.slot === this.part.slot); if (!p) return null;
        p.mesh.updateMatrix(); const rel = p.t0 ? p.mesh.matrix.clone().multiply(p.t0.clone().invert()) : new THREE.Matrix4();
        return mk(e.det.group.matrixWorld.clone().multiply(rel), this.L.elementBox(e, this.part.slot));
      }
      return mk(this.L.matrixOf(e, new THREE.Matrix4()), this.L.localBounds(e));
    }
    const b = new THREE.Box3(); for (const id of ids) { const e = this.L.get(id); if (e) b.union(this.L.worldBox(e)); }
    return mk(new THREE.Matrix4(), b);
  }
  // ---------------------------------------------------------------- elements (parts of one material slot: roof, walls...)
  // the element of object id under the cursor (client x, y), or its main element
  elementAt(id, x, y) {
    const e = this.L.get(id); if (!e) return null; if (!e.det) this.L.detach(e);
    const r = this.picker.setFromClient(x, y), ray = new THREE.Raycaster(); ray.ray.copy(r); ray.layers.enableAll();
    const hit = ray.intersectObject(e.det.group, true).find(h => h.object.visible !== false);
    if (!hit) return null;
    if (hit.object.isInstancedMesh) { const p = e.det.parts.find(q => q.mesh === hit.object); return p && p.slot; }
    // Alt+click inside the piece being edited goes one level finer: its flat faces (one wall face, one roof plane)
    if (this.part && this.part.id === id && /#\d+$/.test(this.part.slot)) { const own = e.det.parts.find(q => q.mesh === hit.object); if (own && (own.slot === this.part.slot || own.slot === this.part.slot.split('#')[0])) { const sub = this.L.subPieceAt(e, this.part.slot, hit.object, hit.faceIndex); if (sub) return sub; } }
    return this.L.pieceAt(e, hit.object, hit.faceIndex); // one connected piece: a wall, a window frame, a sign plate
  }
  selectElement(id, slot) {
    if (!slot) { this.part = null; this.refreshSelection(); return; }
    const e = this.L.get(id); if (e && slot.includes('#')) this.L.ensurePiece(e, slot);
    this.sel = [id]; this.part = { id, slot }; if (this.xyz) this.gizmo.mode = this.tool;
    this.refreshSelection(); ui.status(`Element “${slot}” of ${(this.doc.rec(id) || {}).name || id} — move / turn / scale it with the gizmo, H hides it, Esc back to the whole object`);
  }
  // edit element fields of the current part (fn(el) -> el)
  editElement(fn, label) {
    const P = this.part; if (!P) return;
    this.doc.edit([P.id], r => { const S = { ...(r.slots || {}) }, el = fn({ ...(S[P.slot] || {}) }); for (const k of Object.keys(el)) if (el[k] === undefined) delete el[k]; if (Object.keys(el).length) S[P.slot] = el; else delete S[P.slot]; if (Object.keys(S).length) r.slots = Object.fromEntries(Object.entries(S).sort()); else delete r.slots; return r; }, label);
    this.refreshSelection();
  }
  setTool(t) { if (t === 'select') t = 'direct'; this.tool = t; if (this.xyz) this.gizmo.mode = t; this.placeGizmo(); this.emit('tool'); }
  // ---------------------------------------------------------------- pointer
  bindPointer() {
    const D = this.dom; let down = null, lastHover = 0;
    const rect = document.createElement('div'); rect.id = 'boxsel'; document.body.append(rect);
    D.addEventListener('pointerdown', e => {
      if (e.button !== 0) { if (e.button === 2 && this.placing) this.disarm(); return; }
      D.focus();
      if (this.placing) { this.placeAt(e.clientX, e.clientY, e); return; }
      if (this.eyedropper) { this.pickMaterialAt(e.clientX, e.clientY); return; }
      const dh = this.tool === 'direct' && this.handles.hit(e.clientX, e.clientY);
      if (dh) { D.setPointerCapture(e.pointerId); this.beginDirect(dh, e.clientX, e.clientY, e.altKey); return; }
      if (e.altKey) { // Alt+left-drag is the camera's (orbit); Alt+click picks an element (even over the gizmo)
        down = { x: e.clientX, y: e.clientY, alt: true, box: false, cam: true }; return; }
      const h = this.gizmo.hit(e.clientX, e.clientY);
      if (h) { D.setPointerCapture(e.pointerId); this.gizmo.begin(h, e.clientX, e.clientY); return; }
      down = { x: e.clientX, y: e.clientY, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, box: false };
      // in the main tool, pressing on an object grabs it: dragging slides it over the ground (a click still selects)
      if (this.tool === 'direct' && !down.shift && !down.ctrl) { const p = this.picker.pick(e.clientX, e.clientY); if (p.hit) { down.grab = p.hit.id; down.point = p.hit.point.clone(); } }
      D.setPointerCapture(e.pointerId);
    });
    D.addEventListener('pointermove', e => {
      if (this.gizmo.drag) { this.gizmo.move(e.clientX, e.clientY); return; }
      if (this.direct) { this.moveDirect(e.clientX, e.clientY, e.altKey); return; }
      if (down) {
        if (down.cam) { if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) down.moved = true; return; }
        if (down.grab && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) { // start sliding the grabbed object
          const g = down.grab, pt = down.point; down = null;
          const inPart = this.part && this.part.id === g;
          if (!this.sel.includes(g)) this.select([g]);
          if (this.sel.includes(g)) { this.beginDirect('move', e.clientX, e.clientY, false, pt, inPart); this.moveDirect(e.clientX, e.clientY); }
          return;
        }
        if (!down.box && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) down.box = true;
        if (down.box) { const x0 = Math.min(down.x, e.clientX), y0 = Math.min(down.y, e.clientY); Object.assign(rect.style, { display: 'block', left: x0 + 'px', top: y0 + 'px', width: Math.abs(e.clientX - down.x) + 'px', height: Math.abs(e.clientY - down.y) + 'px' }); }
        return;
      }
      if (this.placing) { this.moveGhost(e.clientX, e.clientY, e); return; }
      if (this.ed.cam.drag) return;
      const h = this.gizmo.hit(e.clientX, e.clientY); this.gizmo.highlight(h);
      const dh = !h && this.tool === 'direct' ? this.handles.hit(e.clientX, e.clientY) : null; this.handles.highlight(dh);
      if (dh) { const n = dh[1] ? this.handles.faceName(dh) : ''; D.style.cursor = dh === 'rot' ? 'grab' : dh === 'up' || n === 'TOP' || n === 'BOTTOM' ? 'ns-resize' : 'ew-resize'; this.handles.label(this.handles.hint(dh), e.clientX, e.clientY); return; }
      this.handles.label(null);
      D.style.cursor = h ? 'pointer' : this.eyedropper ? 'crosshair' : this.tool === 'direct' && this.hoverId && this.sel.includes(this.hoverId) ? 'move' : '';
      const now = performance.now();
      if (!h && now - lastHover > 90) { lastHover = now; const p = this.picker.pick(e.clientX, e.clientY); const id = p.hit ? p.hit.id : null; this.cursor = p; if (id !== this.hoverId) { this.hoverId = id; this.refreshHover(); } this.emit('cursor'); }
    });
    D.addEventListener('pointerup', e => {
      if (e.button !== 0) return;
      if (this.gizmo.drag) { this.gizmo.end(); return; }
      if (this.direct) { this.endDirect(false); return; }
      if (!down) return;
      const d = down; down = null; rect.style.display = 'none';
      if (d.cam && d.moved) return;
      if (d.box) {
        const ids = this.picker.inRect(Math.min(d.x, e.clientX), Math.min(d.y, e.clientY), Math.max(d.x, e.clientX), Math.max(d.y, e.clientY), { fields: this.boxFields });
        this.select(ids, d.shift ? 'add' : d.ctrl ? 'remove' : 'set');
        if (ids.length) ui.status(`${ids.length} object${ids.length > 1 ? 's' : ''} in the box`);
        return;
      }
      const p = this.picker.pick(e.clientX, e.clientY, { details: true });
      // Alt+click (or any click inside the object whose element is being edited) picks one element of an object
      if (p.hit && (d.alt || (this.part && this.part.id === p.hit.id))) { this.selectElement(p.hit.id, this.elementAt(p.hit.id, e.clientX, e.clientY)); return; }
      if (p.hit) this.select([p.hit.id], d.shift ? 'toggle' : d.ctrl ? 'remove' : 'set');
      else if (!d.shift && !d.ctrl) this.select([]);
    });
    D.addEventListener('dblclick', e => {
      const p = this.picker.pick(e.clientX, e.clientY, { details: true }); if (!p.hit) return;
      const g = (this.doc.rec(p.hit.id) || {}).group;
      if (e.shiftKey && g) { this.select(this.groupMembers(g), 'set'); ui.status(`group ${g}: ${this.sel.length} objects`); return; }
      // double-click goes one level in: the part under the cursor (a wall, a window frame, a sign plate), then finer
      this.selectElement(p.hit.id, this.elementAt(p.hit.id, e.clientX, e.clientY));
    });
    D.addEventListener('pointerleave', () => { if (this.hoverId) { this.hoverId = null; this.refreshHover(); } });
    // drag and drop from the palette
    D.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('text/wl-prefab')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; if (this.placing) this.moveGhost(e.clientX, e.clientY, e); } });
    D.addEventListener('drop', e => { const p = e.dataTransfer.getData('text/wl-prefab'); if (!p) return; e.preventDefault(); if (!this.placing || this.placing.prefab !== p) this.arm(p, true); this.placeAt(e.clientX, e.clientY, e); this.disarm(); });
  }
  refreshHover() { this.refreshSelection(); }
  groupMembers(g) {
    const out = [];
    for (const [id, r] of this.doc.ov) if (r.group === g) out.push(id);
    for (const e of this.L.geo) if ((e.parent === g || e.id === g) && !out.includes(e.id) && (this.doc.rec(e.id).group || '') === (e.id === g ? (this.doc.rec(e.id).group || '') : g)) out.push(e.id);
    return out;
  }
  // ---------------------------------------------------------------- gizmo drags
  dragStart() {
    if (this.part) { const r = this.doc.rec(this.part.id); this.drag = { part: this.part, start: r, el: { ...((r.slots || {})[this.part.slot] || {}) } }; return; }
    this.drag = { ids: this.sel.filter(id => { const r = this.doc.rec(id); return r && !r.deleted && !r.locked; }), start: new Map() };
    for (const id of this.drag.ids) this.drag.start.set(id, this.doc.rec(id));
    for (const id of this.drag.ids) { const e = this.L.get(id); if (e.det) e.det.group.traverse(o => { o.userData.dynamicCaster = true; }); }
    this.ed.refreshShadows && this.ed.refreshShadows();
  }
  dragMove(o) {
    const D = this.drag; if (!D) return;
    if (D.part) {
      const e = this.L.get(D.part.id), r0 = D.start, qo = quatOf(r0.rotation), qi = qo.clone().invert(), so = _v.fromArray(r0.scale).clone(), el = { ...D.el }, st = o.snapStep;
      if (o.mode === 'translate') {
        const loc = o.offset.clone().applyQuaternion(qi).divide(so), base = el.offset || [0, 0, 0];
        el.offset = base.map((v, i) => { let n = v + loc.getComponent(i); if (o.snap && st.move > 0) n = Math.round(n / st.move) * st.move; return n; });
      } else if (o.mode === 'rotate') {
        el.rotate = eulerOf(qi.clone().multiply(o.quat).multiply(qo).multiply(quatOf(el.rotate || [0, 0, 0])));
      } else el.scale = (el.scale || [1, 1, 1]).map((v, i) => { let n = v * o.scale[i]; if (o.snap && st.scale > 0) n = Math.max(st.scale, Math.round(n / st.scale) * st.scale); return n; });
      const r = clone(r0); r.slots = { ...(r.slots || {}), [D.part.slot]: el };
      D.last = el; this.L.apply(e, r); if (o.mode === 'translate') this.placeGizmo(); this.emit('preview');
      return;
    }
    D.last = new Map();
    const snapOn = o.snap, st = o.snapStep;
    for (const id of D.ids) {
      const r0 = D.start.get(id), r = clone(r0), p0 = _v.fromArray(r0.position).clone();
      if (o.mode === 'translate') {
        const p = p0.clone().add(o.offset);
        if (snapOn && st.move > 0) {
          if (this.gizmo.space === 'world' || o.axis === 'view') { const axes = o.axis === 'view' ? 'xz' : o.axis; for (const a of axes) p[a] = Math.round(p[a] / st.move) * st.move; }
          else { const len = o.offset.length(), k = Math.round(len / st.move) * st.move; if (len > 1e-6) p.copy(p0).addScaledVector(o.offset.clone().normalize(), k); }
        }
        r.position = p.toArray();
      } else if (o.mode === 'rotate') {
        const rel = p0.clone().sub(o.pivot).applyQuaternion(o.quat);
        r.position = o.pivot.clone().add(rel).toArray();
        r.rotation = eulerOf(o.quat.clone().multiply(quatOf(r0.rotation)));
      } else {
        const f = o.scale.slice(), B = o.basis, Bi = B.clone().invert();
        const rel = p0.clone().sub(o.pivot).applyQuaternion(Bi).multiply(_s.fromArray(f)).applyQuaternion(B);
        if (D.ids.length > 1) r.position = o.pivot.clone().add(rel).toArray();
        // each object stretches along its own axes: the gizmo's axes mapped into the object's frame
        const qo = quatOf(r0.rotation), local = qo.clone().invert().multiply(B), M = new THREE.Matrix4().makeRotationFromQuaternion(local).elements;
        const ns = [0, 1, 2].map(i => { let k = 0; for (let j = 0; j < 3; j++) k += Math.abs(M[i + j * 4]) * f[j]; return r0.scale[i] * k; });
        r.scale = ns.map(v => snapOn && st.scale > 0 ? Math.max(st.scale, Math.round(v / st.scale) * st.scale) * Math.sign(v || 1) : v);
      }
      D.last.set(id, r);
      this.L.apply(this.L.get(id), r);
    }
    if (o.mode === 'translate' && D.ids.length) { const c = new THREE.Vector3(); for (const r of D.last.values()) c.add(_v.fromArray(r.position)); c.divideScalar(D.last.size); this.gizmo.place(D.ids.length === 1 ? _v.fromArray(D.last.get(D.ids[0]).position) : c); }
    this.emit('preview');
  }
  dragEnd(cancel) {
    const D = this.drag; this.drag = null; if (!D) return;
    if (D.part) {
      this.L.apply(this.L.get(D.part.id), D.start);
      if (!cancel && D.last) { const el = D.last; this.editElement(() => el, `${{ translate: 'Move', rotate: 'Rotate', scale: 'Scale' }[this.gizmo.mode]} element ${D.part.slot}`); }
      this.picker.invalidate(D.part.id); this.ed.refreshShadows && this.ed.refreshShadows(); this.placeGizmo(); this.emit('selection'); return;
    }
    for (const id of D.ids) { const e = this.L.get(id); if (e && e.det) e.det.group.traverse(o => { delete o.userData.dynamicCaster; }); }
    if (cancel || !D.last) { for (const [id, r] of D.start) this.L.apply(this.L.get(id), r); }
    else {
      const label = { translate: 'Move', rotate: 'Rotate', scale: 'Scale' }[this.gizmo.mode] + (D.ids.length > 1 ? ` ${D.ids.length} objects` : '');
      // put the preview back so the command applies the change itself (one undo step)
      for (const [id, r] of D.start) this.L.apply(this.L.get(id), r);
      this.doc.edit(D.ids, (r, id) => D.last.get(id), label);
    }
    for (const id of D.ids) this.picker.invalidate(id);
    this.ed.refreshShadows && this.ed.refreshShadows();
    this.placeGizmo(); this.emit('selection');
  }
  // ---------------------------------------------------------------- direct manipulation
  // kind: a face key ('0+'..'2-'), 'up', 'rot' or 'move'; grab: the world point an object was grabbed at (move)
  beginDirect(kind, x, y, alt = false, grab = null, inPart = !!this.part) {
    const ids = this.sel.filter(id => { const r = this.doc.rec(id); return r && !r.deleted && !r.locked; }); if (!ids.length) return;
    const H = this.handles, B = this.selectionBox(ids); if (!B) return;
    H.set(B); H.active = kind;
    const part = inPart && this.part && ids.length === 1 ? this.part : null;
    const D = this.direct = { kind, ids, part, B, alt, start: new Map(), x0: x, y0: y };
    for (const id of ids) D.start.set(id, this.doc.rec(id));
    if (part) { const r = this.doc.rec(part.id); D.el0 = { ...((r.slots || {})[part.slot] || {}) }; }
    const toCam = camera.position.clone();
    const facing = (dir, through) => { const n = toCam.clone().sub(through).normalize(); n.addScaledVector(dir, -n.dot(dir)); if (n.lengthSq() < 1e-6) n.set(0, 1, 0); return new THREE.Plane().setFromNormalAndCoplanarPoint(n.normalize(), through); };
    if (kind === 'move') { D.plane = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), grab || B.foot); }
    else if (kind === 'rot') { D.plane = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), B.foot); D.center = B.foot.clone(); }
    else if (kind === 'up') { D.dir = new THREE.Vector3(0, 1, 0); D.plane = facing(D.dir, B.foot); }
    else { D.dir = H.dir(kind); D.axis = +kind[0]; D.sign = kind[1] === '+' ? 1 : -1; D.plane = facing(D.dir, H.facePoint(kind)); D.ext0 = B.H[D.axis] * 2; D.dim = H.dimName(kind); D.face = H.faceName(kind); }
    D.p0 = this.handles.ray(x, y).intersectPlane(D.plane, new THREE.Vector3()) || (grab || B.foot).clone();
    for (const id of ids) { const e = this.L.get(id); if (e && e.det) e.det.group.traverse(o => { o.userData.dynamicCaster = true; }); }
    this.ed.refreshShadows && this.ed.refreshShadows();
  }
  moveDirect(x, y, alt = false) {
    const D = this.direct; if (!D) return;
    const p = this.handles.ray(x, y).intersectPlane(D.plane, new THREE.Vector3()); if (!p) return;
    const snap = this.gizmo.snapping, st = this.gizmo.snap, sizeStep = Math.min(st.move, 0.25);
    const recs = new Map(); let label = '';
    if (D.kind === 'move' || D.kind === 'up') {
      const delta = p.clone().sub(D.p0);
      if (D.kind === 'move') delta.y = 0; else { delta.set(0, delta.dot(D.dir), 0); if (snap) delta.y = Math.round(delta.y / sizeStep) * sizeStep; }
      if (D.kind === 'move' && snap && st.move > 0) { const r0 = D.start.get(D.ids[D.ids.length - 1]); delta.x = Math.round((r0.position[0] + delta.x) / st.move) * st.move - r0.position[0]; delta.z = Math.round((r0.position[2] + delta.z) / st.move) * st.move - r0.position[2]; }
      if (D.part) {
        const r0 = D.start.get(D.part.id), qi = quatOf(r0.rotation).invert(), sc = _v.fromArray(r0.scale).clone(), loc = delta.clone().applyQuaternion(qi).divide(sc), el = { ...D.el0 };
        el.offset = (el.offset || [0, 0, 0]).map((v, i) => v + loc.getComponent(i)); this.previewPart(el);
      } else for (const id of D.ids) {
        const r0 = D.start.get(id), r = clone(r0), [x0, y0, z0] = r0.position;
        r.position = [x0 + delta.x, y0 + delta.y, z0 + delta.z];
        if (D.kind === 'move') { const g0 = this.world.groundAt(x0, z0); if (Math.abs(y0 - g0) < 0.3) r.position[1] = this.world.groundAt(r.position[0], r.position[2]) + (y0 - g0); } // (standing on the ground: stays on it)
        recs.set(id, r);
      }
      label = D.kind === 'move' ? `<b>Move</b> ${Math.hypot(delta.x, delta.z).toFixed(2)} m${snap ? ' · snapped' : ''}` : `<b>${delta.y >= 0 ? 'Raise' : 'Lower'}</b> ${delta.y >= 0 ? '+' : ''}${delta.y.toFixed(2)} m`;
    } else if (D.kind === 'rot') {
      const a = D.p0.clone().sub(D.center), b = p.clone().sub(D.center); a.y = b.y = 0;
      let ang = Math.atan2(a.clone().cross(b).y, a.dot(b)); if (snap) ang = Math.round(ang / (st.rotate * DEG)) * st.rotate * DEG;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang);
      if (D.part) { const r0 = D.start.get(D.part.id), qo = quatOf(r0.rotation), qi = qo.clone().invert(), el = { ...D.el0 }; el.rotate = eulerOf(qi.multiply(q).multiply(qo).multiply(quatOf(el.rotate || [0, 0, 0]))); this.previewPart(el); }
      else for (const id of D.ids) { const r0 = D.start.get(id), r = clone(r0), rel = _v.fromArray(r0.position).clone().sub(D.center).applyQuaternion(q); r.position = D.center.clone().add(rel).toArray(); r.rotation = eulerOf(q.clone().multiply(quatOf(r0.rotation))); recs.set(id, r); }
      label = `<b>Turn</b> ${(ang * RAD).toFixed(snap ? 0 : 1)}°`;
    } else { // one face: the opposite face stays (Alt: both move, about the centre)
      const centered = alt || D.alt, i = D.axis;
      let d = p.clone().sub(D.p0).dot(D.dir), ext = D.ext0 + (centered ? 2 * d : d);
      if (snap) ext = Math.round(ext / sizeStep) * sizeStep;
      ext = Math.max(0.02, ext); const f = ext / Math.max(1e-6, D.ext0);
      const lb = D.B.lb, fixedLocal = centered ? (lb.min.getComponent(i) + lb.max.getComponent(i)) / 2 : D.sign > 0 ? lb.min.getComponent(i) : lb.max.getComponent(i);
      if (D.part) {
        const e = this.L.get(D.part.id), c = this.L.elementPivot(e, D.part.slot), el = { ...D.el0 }, k0 = el.scale || [1, 1, 1], k1 = k0.slice(); k1[i] = k0[i] * f;
        const v = [0, 0, 0]; v[i] = (k0[i] - k1[i]) * (fixedLocal - c.getComponent(i));
        const R = quatOf(el.rotate || [0, 0, 0]), w = new THREE.Vector3(...v).applyQuaternion(R);
        el.scale = k1; el.offset = (el.offset || [0, 0, 0]).map((o, j) => o + w.getComponent(j)); this.previewPart(el);
      } else {
        const id = D.ids[0], r0 = D.start.get(id), r = clone(r0), s1 = r0.scale.slice(); s1[i] = r0.scale[i] * f;
        const v = [0, 0, 0]; v[i] = (r0.scale[i] - s1[i]) * fixedLocal; const w = new THREE.Vector3(...v).applyQuaternion(quatOf(r0.rotation));
        r.scale = s1; r.position = r0.position.map((o, j) => o + w.getComponent(j)); recs.set(id, r);
      }
      const dd = ext - D.ext0;
      label = `<b>${D.dim} ${ext.toFixed(2)} m</b> (${dd >= 0 ? '+' : ''}${dd.toFixed(2)})${centered ? ' · both sides' : ` · ${D.face.toLowerCase()} side`}${snap ? ' · snapped' : ''}`;
    }
    if (recs.size) { D.last = recs; for (const [id, r] of recs) this.L.apply(this.L.get(id), r); }
    this.placeGizmo(); this.handles.active = D.kind; this.handles.label(label, x, y); this.emit('preview');
  }
  previewPart(el) { const D = this.direct, e = this.L.get(D.part.id), r = clone(D.start.get(D.part.id)); r.slots = { ...(r.slots || {}), [D.part.slot]: el }; D.lastEl = el; this.L.apply(e, r); }
  endDirect(cancel) {
    const D = this.direct; this.direct = null; if (!D) return;
    this.handles.active = null; this.handles.label(null); this.handles.highlight(null);
    for (const id of D.ids) { const e = this.L.get(id); if (e && e.det) e.det.group.traverse(o => { delete o.userData.dynamicCaster; }); }
    const what = D.kind === 'move' ? 'Move' : D.kind === 'up' ? 'Raise / lower' : D.kind === 'rot' ? 'Turn' : `Resize ${D.face.toLowerCase()} side`;
    if (D.part) {
      this.L.apply(this.L.get(D.part.id), D.start.get(D.part.id));
      if (!cancel && D.lastEl) { const el = D.lastEl; this.editElement(() => el, `${what} — element ${D.part.slot}`); }
    } else {
      for (const [id, r] of D.start) this.L.apply(this.L.get(id), r);
      if (!cancel && D.last) this.doc.edit([...D.last.keys()], (r, id) => D.last.get(id), what + (D.ids.length > 1 ? ` ${D.ids.length} objects` : ''));
    }
    for (const id of D.ids) this.picker.invalidate(id);
    this.ed.refreshShadows && this.ed.refreshShadows();
    this.placeGizmo(); this.emit('selection');
  }
  // ---------------------------------------------------------------- commands
  editSel(fn, label) { const ids = this.sel.filter(id => this.L.get(id)); if (!ids.length) return 0; const n = this.doc.edit(ids, fn, label); for (const id of ids) this.picker.invalidate(id); this.refreshSelection(); return n; }
  // a new object record copying `id` (its look comes from its source), at an offset
  copyRecord(id, offset = [0, 0, 0], taken = new Set()) {
    const r = this.doc.rec(id); if (!r) return null;
    const e = this.L.get(id), src = e.kind === 'added' ? (r.source || null) : id;
    const nid = this.doc.freshId(r.prefab || 'object', taken); taken.add(nid);
    const out = { id: nid, name: (r.name || labelOf(r.prefab || 'object')).replace(/ \(copy\)$/, '') + ' (copy)', prefab: r.prefab };
    if (src) out.source = src;
    out.position = r.position.map((v, i) => v + offset[i]); out.rotation = r.rotation.slice(); out.scale = r.scale.slice();
    for (const k of ['part', 'material', 'materialOverrides', 'slots', 'tags']) if (r[k] !== undefined) out[k] = clone(r[k]);
    if (r.group && e.kind === 'added') out.group = r.group;
    return out;
  }
  // ---------------------------------------------------------------- one part as an object of its own
  // the record of a new object holding just the part being edited (an element — every "stucco" part — or one piece),
  // with its look (material, colour, texture, transparency...) and its own edits; it stands where the part is
  partRecord(taken = new Set()) {
    const P = this.part; if (!P) return null;
    const r = this.doc.rec(P.id), e = this.L.get(P.id); if (!r || !e) return null;
    const src = e.kind === 'added' ? (r.source || null) : P.id; if (!src) return null;
    const base = P.slot.split('#')[0], key = e.kind === 'added' && r.part ? r.part : P.slot;
    const gen = e.kind === 'added' ? null : this.L.generatedRecord(e), look = this.L.slotOverride(e, r, gen, base) || {};
    const el = { ...((r.slots || {})[base] || {}), ...((r.slots || {})[P.slot] || {}) }; delete el.hidden;
    const out = { id: this.doc.freshId('part', taken), name: `${labelOf(base)} (part of ${r.name || P.id})`.slice(0, 150), prefab: r.prefab || 'part', source: src, part: key,
      position: r.position.slice(), rotation: r.rotation.slice(), scale: r.scale.slice() };
    taken.add(out.id);
    const mat = look.material, ov = { ...look }; delete ov.material; for (const k of ['offset', 'rotate', 'scale', 'hidden']) delete ov[k];
    if (mat) out.material = mat; if (Object.keys(ov).length) out.materialOverrides = ov;
    const elT = {}; for (const k of ['offset', 'rotate', 'scale']) if (el[k]) elT[k] = el[k];
    if (Object.keys(elT).length) out.slots = { [base]: elT };
    if (r.tags) out.tags = r.tags.slice();
    return out;
  }
  duplicatePart() {
    const rec = this.partRecord(); if (!rec) { toast('Pick a part first (double-click an object, or Alt+click)', 'warn'); return; }
    // beside the original: to the viewer's right by the part's width
    const box = this.selectionBox([this.part.id]), right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion); right.y = 0; right.normalize();
    const w = box ? Math.abs(box.U[0].dot(right)) * box.H[0] * 2 + Math.abs(box.U[2].dot(right)) * box.H[2] * 2 : 1, step = w + 0.3;
    rec.position = rec.position.map((v, i) => v + [right.x, 0, right.z][i] * step);
    const ids = this.doc.add([rec], 'Duplicate part ' + this.part.slot);
    this.select(ids); toast(`Copied the part as a new object (${ids[0]}) — it keeps its material and colour`);
  }
  duplicate() {
    if (this.part) { this.duplicatePart(); return; }
    const ids = this.sel.filter(id => { const r = this.doc.rec(id); return r && !r.deleted; }); if (!ids.length) return;
    // offset: along the object's own width (its local X axis, kept level) by its width plus a small gap, so repeated
    // Ctrl+D lines copies up side by side — benches in a row, houses along a street; with snapping a whole number of
    // grid steps. Several objects move as a block by the selection's extent along that axis.
    const prim = this.doc.rec(ids[ids.length - 1]), q = quatOf(prim.rotation), ax = new THREE.Vector3(1, 0, 0).applyQuaternion(q); ax.y = 0;
    if (ax.lengthSq() < 1e-6) ax.set(1, 0, 0); ax.normalize();
    let ext;
    if (ids.length === 1) { const e = this.L.get(ids[0]), lb = this.L.localBounds(e); ext = (lb.max.x - lb.min.x) * Math.abs(prim.scale[0]); }
    else { let a = Infinity, b = -Infinity; for (const id of ids) { const bx = this.L.worldBox(this.L.get(id)); for (const x of [bx.min.x, bx.max.x]) for (const z of [bx.min.z, bx.max.z]) { const t = x * ax.x + z * ax.z; a = Math.min(a, t); b = Math.max(b, t); } } ext = b - a; }
    const sm = this.gizmo.snap.move, gap = ext + 0.3, step = Math.min(80, this.gizmo.snap.on && sm > 0 ? Math.ceil(gap / sm) * sm : gap);
    const off = [ax.x * step, 0, ax.z * step];
    const recs = [], taken = new Set(); for (const id of ids) { const r = this.copyRecord(id, off, taken); if (r) recs.push(r); }
    const out = this.doc.add(recs, ids.length > 1 ? `Duplicate ${ids.length} objects` : 'Duplicate');
    this.select(out);
    toast(`Duplicated ${out.length} — drag the gizmo to place ${out.length > 1 ? 'them' : 'it'}`);
  }
  copy() {
    const ids = this.sel.filter(id => { const r = this.doc.rec(id); return r && !r.deleted; }); if (!ids.length) return;
    const recs = this.part ? [this.partRecord()].filter(Boolean) : ids.map(id => this.copyRecord(id)).filter(Boolean);
    if (!recs.length) return;
    const c = new THREE.Vector3(); for (const r of recs) c.add(_v.fromArray(r.position)); c.divideScalar(recs.length);
    const text = JSON.stringify({ wildlands: 'objects', map: this.doc.map, center: c.toArray(), records: recs }, null, 1);
    try { localStorage.setItem('wl_ed_clipboard', text); } catch (e) {}
    if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
    toast(this.part ? `Copied the part ${this.part.slot} — Ctrl+V pastes it as an object of its own` : `Copied ${recs.length} object${recs.length > 1 ? 's' : ''}`);
  }
  async paste() {
    let text = null;
    try { if (navigator.clipboard && navigator.clipboard.readText) text = await navigator.clipboard.readText(); } catch (e) {}
    if (!text || !text.includes('"wildlands"')) try { text = localStorage.getItem('wl_ed_clipboard'); } catch (e) {}
    let data = null; try { data = JSON.parse(text); } catch (e) {}
    if (!data || data.wildlands !== 'objects' || !Array.isArray(data.records)) { toast('Nothing to paste — copy objects first (Ctrl+C)', 'warn'); return; }
    // at the point under the cursor (or the same place when the cursor is not over the world)
    const p = this.cursor && (this.cursor.hit ? this.cursor.hit.point : this.cursor.ground ? this.cursor.ground.point : null);
    const off = p ? [p.x - data.center[0], 0, p.z - data.center[2]] : [2, 0, 2];
    const recs = [], taken = new Set();
    for (const r0 of data.records) {
      const r = clone(r0); r.id = this.doc.freshId(r.prefab || 'object', taken); taken.add(r.id);
      if (r.source && !this.L.get(r.source)) { if (r.prefab && (PRIMITIVES[r.prefab] || this.L.templateOf(r.prefab))) delete r.source; else continue; }
      r.position = [r.position[0] + off[0], r.position[1], r.position[2] + off[2]];
      if (p) r.position[1] = this.world.groundAt(r.position[0], r.position[2]) + (r0.position[1] - this.world.groundAt(r0.position[0], r0.position[2]) || 0);
      recs.push(r);
    }
    if (!recs.length) { toast('The copied objects do not exist in this map', 'warn'); return; }
    const ids = this.doc.add(recs, `Paste ${recs.length} object${recs.length > 1 ? 's' : ''}`);
    this.select(ids);
  }
  remove() {
    const ids = this.sel.slice(); if (!ids.length) return;
    this.doc.remove(ids, ids.length > 1 ? `Delete ${ids.length} objects` : 'Delete ' + ((this.doc.rec(ids[0]) || {}).name || ids[0]));
    this.select([]);
    toast(`Deleted ${ids.length} object${ids.length > 1 ? 's' : ''} — Ctrl+Z restores`);
  }
  // highest surface under (x, z) ignoring the objects being moved: other objects' tops or the ground
  surfaceBelow(x, z, yTop, ignore) {
    const ray = new THREE.Ray(new THREE.Vector3(x, yTop, z), new THREE.Vector3(0, -1, 0));
    let best = this.world.groundAt(x, z), n = this.normalAt(x, z);
    const hit = this.picker.pickRay(ray, ignore);
    if (hit && hit.point.y > best + 0.02) { best = hit.point.y; n = hit.normal || n; }
    return { y: best, normal: n };
  }
  normalAt(x, z) {
    if (this.world.normalAt) { const n = new THREE.Vector3(); this.world.normalAt(x, z, n); if (n.lengthSq() > 0.5) return n.normalize(); }
    const e = 0.5, g = (a, b) => this.world.groundAt(a, b);
    return new THREE.Vector3(g(x - e, z) - g(x + e, z), 2 * e, g(x, z - e) - g(x, z + e)).normalize();
  }
  dropToGround(align = false) {
    const ids = this.sel.slice(); if (!ids.length) return;
    const ignore = new Set(ids);
    this.editSel(r => {
      const e = this.L.get(r.id), b = this.L.worldBox(e);
      const s = this.surfaceBelow(r.position[0], r.position[2], b.max.y + 0.5, ignore);
      // the object's origin is the point it stands on (generated objects are placed by it)
      r.position[1] = s.y;
      if (align) {
        const yaw = quatOf(r.rotation); const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(yaw); fwd.y = 0; fwd.normalize();
        const up = s.normal.clone().normalize(), right = new THREE.Vector3().crossVectors(up, fwd).normalize(), f2 = new THREE.Vector3().crossVectors(right, up);
        const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, f2));
        r.rotation = eulerOf(q);
      }
      return r;
    }, align ? 'Align to surface' : 'Drop to ground');
  }
  group() {
    const ids = this.sel.slice(); if (ids.length < 2) { toast('Select two or more objects to group them', 'warn'); return; }
    let n = 1; const used = new Set(); for (const r of this.doc.ov.values()) if (r.group) used.add(r.group); for (const e of this.L.geo) used.add(e.id);
    while (used.has('group_' + String(n).padStart(3, '0'))) n++;
    const g = 'group_' + String(n).padStart(3, '0');
    this.editSel(r => { r.group = g; return r; }, `Group ${ids.length} objects`);
    toast(`Grouped as ${g} — double-click a member to select the group`);
  }
  ungroup() { const n = this.editSel(r => { if (!r.group) return null; r.group = ''; return r; }, 'Ungroup'); if (n) toast(`Ungrouped ${n} object${n > 1 ? 's' : ''}`); }
  setFlag(flag, v) {
    const ids = this.sel.slice(); if (!ids.length) return;
    const val = v ?? !ids.every(id => (this.doc.rec(id) || {})[flag]);
    this.editSel(r => { if (val) r[flag] = true; else delete r[flag]; return r; }, `${val ? '' : 'Un'}${flag === 'hidden' ? 'hide' : 'lock'}`.replace(/^U/, 'U').replace(/^(.)/, c => c.toUpperCase()) + (ids.length > 1 ? ` ${ids.length} objects` : ''));
    if (flag === 'locked' && val) this.select([]);
  }
  showAll() {
    const ids = [...this.doc.ov].filter(([, r]) => r.hidden).map(([id]) => id);
    if (!ids.length) { toast('Nothing is hidden'); return; }
    this.doc.edit(ids, r => { delete r.hidden; return r; }, `Show ${ids.length} hidden`);
  }
  focus() {
    const ids = this.sel.length ? this.sel : [];
    if (!ids.length) return;
    const box = new THREE.Box3(); for (const id of ids) box.union(this.L.worldBox(this.L.get(id)));
    this.ed.cam.focus(box);
  }
  // ---------------------------------------------------------------- materials
  // an object's look, slot by slot: { from, prim, map: { slot: override } }; the main slot always names its library
  // material, so pasting onto an object whose main slot is another material still copies the look
  materialSpec(id) {
    const e = this.L.get(id), r = this.doc.rec(id); if (!e || !r) return null;
    const gen = e.kind === 'added' ? null : this.L.generatedRecord(e), slots = this.L.slotsOf(e), map = {};
    for (const s of slots) { const o = this.L.slotOverride(e, r, gen, s); if (o) map[s] = o; }
    const prim = slots[0]; if (prim) map[prim] = { material: (map[prim] && map[prim].material) || r.material || prim, ...(map[prim] || {}) };
    return { from: id, prim, map };
  }
  // record r with the look of spec (slots the target shares get their override, its main slot the source's main look)
  withMaterial(r, spec) {
    const e = this.L.get(r.id), gen = e.kind === 'added' ? null : this.L.generatedRecord(e), slots = this.L.slotsOf(e), prim = slots[0];
    const out = { ...r }; delete out.materialOverrides; delete out.slots; out.material = gen ? gen.material : (e.prim ? 'primitive' : r.material);
    for (const s of slots) {
      let o = spec.map[s] || (s === prim ? spec.map[spec.prim] : null); if (!o) continue; o = clone(o);
      if (s === prim) { if (o.material && o.material !== prim) out.material = o.material; else if (o.material === prim) out.material = prim; delete o.material; if (Object.keys(o).length) out.materialOverrides = o; }
      else { if (o.material === s) delete o.material; if (Object.keys(o).length) (out.slots = out.slots || {})[s] = o; }
    }
    if (out.slots) out.slots = Object.fromEntries(Object.entries(out.slots).sort());
    return out;
  }
  copyMaterial(id = this.primary) { if (!id) return; this.matClip = this.materialSpec(id); toast(`Material copied from ${(this.doc.rec(id) || {}).name || id} — Ctrl+Shift+V pastes it onto the selection`); this.emit('matclip'); }
  pasteMaterial() {
    const M = this.matClip; if (!M) { toast('Copy a material first (eyedropper I, or Copy material in the inspector)', 'warn'); return; }
    const n = this.editSel(r => r.id === M.from ? null : this.withMaterial(r, M), 'Paste material');
    toast(n ? `Material pasted onto ${n} object${n > 1 ? 's' : ''}` : 'Nothing changed', n ? 'ok' : '');
  }
  armEyedropper() { this.eyedropper = !this.eyedropper; this.dom.style.cursor = this.eyedropper ? 'crosshair' : ''; ui.status(this.eyedropper ? 'Eyedropper: click an object to copy its material (Esc cancels)' : ''); this.emit('tool'); }
  pickMaterialAt(x, y) { const p = this.picker.pick(x, y); this.eyedropper = false; this.dom.style.cursor = ''; if (p.hit) { this.copyMaterial(p.hit.id); if (this.sel.length && !this.sel.includes(p.hit.id)) this.pasteMaterial(); } this.emit('tool'); }
  // ---------------------------------------------------------------- placing from the palette
  arm(prefab, silent = false) {
    this.disarm(true);
    const id = '__ghost__';
    const rec = this.placementRecord(prefab, [this.ed.cam.pivot.x, this.ed.cam.pivot.y, this.ed.cam.pivot.z], id);
    if (!rec) { toast(`No template for ${prefab}`, 'err'); return; }
    const ent = this.L.createAdded(rec); if (!ent) return;
    ent.det.group.traverse(o => { if (o.isMesh) { o.castShadow = false; o.userData.ghost = true; } });
    ent.det.group.visible = false;
    this.placing = { prefab, ent, rec, yaw: 0 };
    this.gizmo.visible = false;
    if (!silent) ui.status(`Placing ${labelOf(prefab)}: click to place (keeps placing) · [ / ] or Alt+wheel turn · + / − resize · Esc / right-click stops`);
    this.emit('placing');
  }
  disarm(quiet) { if (!this.placing) return; this.L.removeAdded(this.placing.ent); this.placing = null; this.placeGizmo(); if (!quiet) ui.status(''); this.emit('placing'); }
  placementRecord(prefab, pos, id) {
    const prim = PRIMITIVES[prefab], tid = prim ? null : this.L.templateOf(prefab); if (!prim && !tid) return null;
    const t = tid ? this.L.get(tid) : null, g = t ? this.L.generatedRecord(t) : null;
    const rec = { id, name: labelOf(prefab), prefab, position: pos, rotation: [0, 0, 0], scale: g ? g.scale.slice() : [1, 1, 1] };
    if (g && g.material) rec.material = g.material; else if (prim) rec.material = 'primitive';
    // instanced templates keep their natural size; their tilt is dropped
    return rec;
  }
  placementAt(x, y, e) {
    const p = this.picker.pick(x, y, { ignore: new Set(['__ghost__']) });
    const pt = p.hit ? p.hit.point : p.ground ? p.ground.point : null; if (!pt) return null;
    const n = p.hit && p.hit.normal ? p.hit.normal : this.normalAt(pt.x, pt.z);
    let pos = pt.clone();
    if (this.gizmo.snapping && this.gizmo.snap.move > 0) { pos.x = Math.round(pos.x / this.gizmo.snap.move) * this.gizmo.snap.move; pos.z = Math.round(pos.z / this.gizmo.snap.move) * this.gizmo.snap.move; if (!p.hit) pos.y = this.world.groundAt(pos.x, pos.z); }
    const P = this.placing, yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), P.yaw);
    let q = yawQ;
    if (ui.placeOpts.align) { const up = n.clone().normalize(); q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up).multiply(yawQ); }
    return { position: pos.toArray(), rotation: eulerOf(q) };
  }
  moveGhost(x, y, e) {
    const P = this.placing; if (!P) return;
    const at = this.placementAt(x, y, e);
    if (!at) { P.ent.det.group.visible = false; return; }
    P.rec = { ...P.rec, ...at };
    this.L.apply(P.ent, P.rec); P.ent.det.group.visible = true;
  }
  placeAt(x, y, e) {
    const P = this.placing; if (!P) return;
    const at = this.placementAt(x, y, e); if (!at) { toast('Point at the ground or an object to place it', 'warn'); return; }
    const rec = { ...P.rec, ...at, id: this.doc.freshId(P.prefab) };
    const ids = this.doc.add([rec], 'Place ' + labelOf(P.prefab));
    this.select(ids);
    if (ui.placeOpts.randomYaw) P.yaw = Math.random() * Math.PI * 2;
    this.picker.invalidate();
  }
  scaleGhost(k) { const P = this.placing; if (!P) return; P.rec = { ...P.rec, scale: P.rec.scale.map(v => v * k) }; this.moveGhost(this.lastX || 0, this.lastY || 0); ui.status(`Placing ${labelOf(P.prefab)} at ${(P.rec.scale[1]).toFixed(2)}× scale — + / − resize, [ / ] turn, Esc stops`); }
  turnGhost(d) { if (!this.placing) return; this.placing.yaw += d; this.moveGhost(this.lastX || 0, this.lastY || 0); }
}
