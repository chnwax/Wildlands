// Editor controller: selection, viewport interaction (click, Shift+click, box select, gizmo drags, placing from the
// palette) and every editing command (duplicate, copy / paste, delete, drop to ground, align to surface, group,
// hide, lock, materials). All changes go through the document's command history (doc.js).
import { THREE, camera, renderer } from '../core.js';
import { Picker } from './picking.js';
import { Gizmo } from './gizmo.js';
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
    this.sel = []; this.hoverId = null; this.tool = 'translate'; this.showHidden = false; this.listeners = new Set();
    this.picker = new Picker(this.L, this.world, { dom: this.dom, showHidden: () => this.showHidden });
    this.gizmo = new Gizmo(this.dom); this.outline = new Outline();
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
  select(ids, mode = 'set') {
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
      if (k < MAX_OUTLINED && !(rec && (rec.deleted))) { if (!e.det) this.L.detach(e); if (e.det.group.visible) e.det.group.traverse(o => { if (o.isMesh && o.visible !== false) meshes.push(o); }); else boxes.push(this.L.worldBox(e)); }
      else boxes.push(this.L.worldBox(e));
    });
    const hov = [];
    if (this.hoverId && !this.sel.includes(this.hoverId)) { const e = this.L.get(this.hoverId); if (e && e.det && e.det.group.visible) e.det.group.traverse(o => { if (o.isMesh) hov.push(o); }); }
    this.outline.set(meshes, boxes, hov);
    this.placeGizmo();
    this.emit('selection');
  }
  placeGizmo() {
    const ids = this.sel.filter(id => { const r = this.doc.rec(id); return r && !r.deleted; });
    this.gizmo.visible = ids.length > 0 && this.tool !== 'select' && !this.placing;
    if (!ids.length) return;
    const c = new THREE.Vector3(); for (const id of ids) c.add(_v.fromArray(this.doc.rec(id).position)); c.divideScalar(ids.length);
    const prim = this.doc.rec(ids[ids.length - 1]);
    this.gizmo.place(ids.length === 1 ? _v.fromArray(prim.position) : c, quatOf(prim.rotation));
  }
  setTool(t) { this.tool = t; this.gizmo.mode = t === 'select' ? this.gizmo.mode : t; this.placeGizmo(); this.emit('tool'); }
  // ---------------------------------------------------------------- pointer
  bindPointer() {
    const D = this.dom; let down = null, lastHover = 0;
    const rect = document.createElement('div'); rect.id = 'boxsel'; document.body.append(rect);
    D.addEventListener('pointerdown', e => {
      if (e.button !== 0) { if (e.button === 2 && this.placing) this.disarm(); return; }
      D.focus();
      if (this.placing) { this.placeAt(e.clientX, e.clientY, e); return; }
      if (this.eyedropper) { this.pickMaterialAt(e.clientX, e.clientY); return; }
      const h = this.gizmo.hit(e.clientX, e.clientY);
      if (h) { D.setPointerCapture(e.pointerId); this.gizmo.begin(h, e.clientX, e.clientY); return; }
      down = { x: e.clientX, y: e.clientY, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, box: false };
      D.setPointerCapture(e.pointerId);
    });
    D.addEventListener('pointermove', e => {
      if (this.gizmo.drag) { this.gizmo.move(e.clientX, e.clientY); return; }
      if (down) {
        if (!down.box && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) down.box = true;
        if (down.box) { const x0 = Math.min(down.x, e.clientX), y0 = Math.min(down.y, e.clientY); Object.assign(rect.style, { display: 'block', left: x0 + 'px', top: y0 + 'px', width: Math.abs(e.clientX - down.x) + 'px', height: Math.abs(e.clientY - down.y) + 'px' }); }
        return;
      }
      if (this.placing) { this.moveGhost(e.clientX, e.clientY, e); return; }
      if (this.ed.cam.drag) return;
      const h = this.gizmo.hit(e.clientX, e.clientY); this.gizmo.highlight(h); D.style.cursor = h ? 'pointer' : this.eyedropper ? 'crosshair' : '';
      const now = performance.now();
      if (!h && now - lastHover > 90) { lastHover = now; const p = this.picker.pick(e.clientX, e.clientY); const id = p.hit ? p.hit.id : null; this.cursor = p; if (id !== this.hoverId) { this.hoverId = id; this.refreshHover(); } this.emit('cursor'); }
    });
    D.addEventListener('pointerup', e => {
      if (e.button !== 0) return;
      if (this.gizmo.drag) { this.gizmo.end(); return; }
      if (!down) return;
      const d = down; down = null; rect.style.display = 'none';
      if (d.box) {
        const ids = this.picker.inRect(Math.min(d.x, e.clientX), Math.min(d.y, e.clientY), Math.max(d.x, e.clientX), Math.max(d.y, e.clientY), { fields: this.boxFields });
        this.select(ids, d.shift ? 'add' : d.ctrl ? 'remove' : 'set');
        if (ids.length) ui.status(`${ids.length} object${ids.length > 1 ? 's' : ''} in the box`);
        return;
      }
      const p = this.picker.pick(e.clientX, e.clientY);
      if (p.hit) this.select([p.hit.id], d.shift ? 'toggle' : d.ctrl ? 'remove' : 'set');
      else if (!d.shift && !d.ctrl) this.select([]);
    });
    D.addEventListener('dblclick', e => {
      const p = this.picker.pick(e.clientX, e.clientY); if (!p.hit) return;
      const g = (this.doc.rec(p.hit.id) || {}).group;
      if (g) { this.select(this.groupMembers(g), 'set'); ui.status(`group ${g}: ${this.sel.length} objects`); }
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
    this.drag = { ids: this.sel.filter(id => { const r = this.doc.rec(id); return r && !r.deleted && !r.locked; }), start: new Map() };
    for (const id of this.drag.ids) this.drag.start.set(id, this.doc.rec(id));
    for (const id of this.drag.ids) { const e = this.L.get(id); if (e.det) e.det.group.traverse(o => { o.userData.dynamicCaster = true; }); }
    this.ed.refreshShadows && this.ed.refreshShadows();
  }
  dragMove(o) {
    const D = this.drag; if (!D) return;
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
    for (const k of ['material', 'materialOverrides', 'slots', 'tags']) if (r[k] !== undefined) out[k] = clone(r[k]);
    if (r.group && e.kind === 'added') out.group = r.group;
    return out;
  }
  duplicate() {
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
    this.select(out); if (this.tool === 'select') this.setTool('translate');
    toast(`Duplicated ${out.length} — drag the gizmo to place ${out.length > 1 ? 'them' : 'it'}`);
  }
  copy() {
    const ids = this.sel.filter(id => { const r = this.doc.rec(id); return r && !r.deleted; }); if (!ids.length) return;
    const recs = ids.map(id => this.copyRecord(id)).filter(Boolean);
    const c = new THREE.Vector3(); for (const r of recs) c.add(_v.fromArray(r.position)); c.divideScalar(recs.length);
    const text = JSON.stringify({ wildlands: 'objects', map: this.doc.map, center: c.toArray(), records: recs }, null, 1);
    try { localStorage.setItem('wl_ed_clipboard', text); } catch (e) {}
    if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
    toast(`Copied ${recs.length} object${recs.length > 1 ? 's' : ''}`);
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
