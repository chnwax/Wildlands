// Inspector: the selected object(s) — name, transform (position, rotation, scale and size in metres, all typed or
// scrubbed), materials (this object only vs. the shared library material, kept clearly apart), group, tags, flags.
// With several objects selected a field shows "—" where they differ; typing a value sets it on all of them.
import { THREE } from '../core.js';
import { el, icon, ui, toast } from './ui.js';
import { quatOf, eulerOf } from './editor.js';
import { CAT_COLOR } from './outliner.js';
import { labelOf } from '../world/layer.js';

const clone = o => o == null ? o : JSON.parse(JSON.stringify(o));
const fmt = (v, d = 3) => { if (v === null || v === undefined || Number.isNaN(v)) return ''; const r = +v.toFixed(d); return String(Object.is(r, -0) ? 0 : r); };
export function buildInspector(E, pane) {
  const doc = E.doc, L = E.L;
  const body = el('div', { class: 'insp' }), scroll = el('div', { class: 'scroll' }, body);
  pane.append(scroll);
  const closed = new Set(JSON.parse(localStorage.getItem('wl_ed_closed') || '[]'));
  // the X / Y / Z fields are the advanced way: folded until opened once
  if (!localStorage.getItem('wl_ed_xyz_seen')) { closed.add('transform'); closed.add('elxyz'); try { localStorage.setItem('wl_ed_xyz_seen', '1'); localStorage.setItem('wl_ed_closed', JSON.stringify([...closed])); } catch (e) {} }
  let matMode = 'object', live = null; // live: preview while a slider / colour drags: { ids, before }
  const section = (key, title, tools, ...kids) => {
    const s = el('div', { class: 'sec' + (closed.has(key) ? ' closed' : '') });
    s.append(el('div', { class: 'sec-h', onclick: e => { if (e.target.closest('.tools')) return; s.classList.toggle('closed'); if (s.classList.contains('closed')) closed.add(key); else closed.delete(key); localStorage.setItem('wl_ed_closed', JSON.stringify([...closed])); } }, title, tools ? el('span', { class: 'tools' }, tools) : null), el('div', { class: 'sec-b' }, kids));
    return s;
  };
  const row = (label, ...kids) => el('div', { class: 'row' }, el('label', { title: label }, label), el('div', {}, kids));
  // a number field: Enter / blur commits, Esc reverts, ↑↓ step (Shift ×10), drag the axis tag to scrub
  function numField(value, onCommit, { step = 0.1, axis = null, mixed = false, min = -Infinity, digits = 3 } = {}) {
    const inp = el('input', { class: 'num', value: mixed ? '' : fmt(value, digits), placeholder: mixed ? '—' : '', spellcheck: false });
    const commit = () => { const v = parseFloat(inp.value.replace(',', '.')); if (!Number.isFinite(v)) { inp.value = mixed ? '' : fmt(value, digits); return; } if (v === value && !mixed) return; onCommit(Math.max(min, v)); };
    inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { commit(); inp.blur(); } if (e.key === 'Escape') { inp.value = mixed ? '' : fmt(value, digits); inp.blur(); }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); const v = (parseFloat(inp.value) || 0) + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1); inp.value = fmt(v, digits); onCommit(Math.max(min, v)); } });
    inp.addEventListener('change', commit);
    const wrap = el('div', { class: 'vin' + (mixed ? ' mixed' : ''), 'data-a': axis || '' }, inp);
    if (axis) wrap.addEventListener('pointerdown', e => { // scrub on the coloured axis tag
      if (e.target === inp) return; e.preventDefault(); const x0 = e.clientX, v0 = parseFloat(inp.value) || 0; let v = v0;
      const mv = ev => { v = v0 + (ev.clientX - x0) * step * (ev.shiftKey ? 10 : 1) * 0.25; inp.value = fmt(v, digits); onCommit(v, true); };
      const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); onCommit(v, false, true); };
      addEventListener('pointermove', mv); addEventListener('pointerup', up);
    });
    return wrap;
  }
  // value of field k (array index i) over the selection: number, or null when mixed
  const common = (recs, f) => { const a = recs.map(f); return a.every(v => Math.abs(v - a[0]) < 1e-6) ? a[0] : null; };
  // transform edits with live preview while scrubbing: one undo step per gesture
  function setVec(ids, key, i, v, preview, end) {
    const fn = r => { r[key] = r[key].slice(); r[key][i] = v; return r; };
    if (preview) { if (!live) live = { recs: new Map(ids.map(id => [id, doc.rec(id)])) }; for (const id of ids) L.apply(L.get(id), fn(clone(live.recs.get(id)))); E.placeGizmo(); return; }
    if (end && live) { for (const [id, r] of live.recs) L.apply(L.get(id), r); live = null; }
    E.editSel(fn, `Set ${key} ${'XYZ'[i]}`);
  }
  function sizeOf(id) { const r = doc.rec(id), e = L.get(id), sz = L.localBounds(e).getSize(new THREE.Vector3()); return [sz.x * Math.abs(r.scale[0]), sz.y * Math.abs(r.scale[1]), sz.z * Math.abs(r.scale[2])]; }
  function setSize(ids, i, v) {
    E.editSel(r => { const e = L.get(r.id), sz = L.localBounds(e).getSize(new THREE.Vector3()).toArray()[i]; if (sz < 1e-4) return null; r.scale = r.scale.slice(); r.scale[i] = Math.sign(r.scale[i] || 1) * v / sz; return r; }, `Set size ${'XYZ'[i]}`);
  }
  // ---------------------------------------------------------------- material editing
  const slotInfo = id => { const e = L.get(id); return L.slotsOf(e); };
  function slotOv(r, slot, primary) { const o = { ...(r.slots && r.slots[slot] || {}) }; if (slot === primary) { Object.assign(o, r.materialOverrides || {}); if (r.material && r.material !== slot) o.material = r.material; } return o; }
  // override edit: k (color / roughness / ...) on slot for every selected object; v undefined removes it
  function setOverride(ids, slot, k, v, preview, end) {
    const fn = r => {
      const prim = slotInfo(r.id)[0];
      if (!slotInfo(r.id).includes(slot.split('#')[0])) return null;
      if (slot === prim && k !== 'material') { const o = { ...(r.materialOverrides || {}) }; if (v === undefined) delete o[k]; else o[k] = v; if (Object.keys(o).length) r.materialOverrides = o; else delete r.materialOverrides; }
      else if (slot === prim && k === 'material') { if (v === undefined) delete r.material; else r.material = v; }
      else { const S = { ...(r.slots || {}) }, o = { ...(S[slot] || {}) }; if (v === undefined) delete o[k]; else o[k] = v; if (Object.keys(o).length) S[slot] = o; else delete S[slot]; if (Object.keys(S).length) r.slots = S; else delete r.slots; }
      return r;
    };
    if (preview) { if (!live) live = { recs: new Map(ids.map(id => [id, doc.rec(id)])) }; for (const id of ids) { const r = fn(clone(live.recs.get(id))); if (r) L.apply(L.get(id), r); } return; }
    if (live) { for (const [id, r] of live.recs) L.apply(L.get(id), r); live = null; }
    E.editSel(fn, k === 'material' ? `Material ${v || 'reset'}` : `${labelOf(k)} (this object)`);
  }
  function setSharedProp(name, k, v, preview) {
    const cur = { ...(doc.mats.get(name) || {}) }; if (v === undefined) delete cur[k]; else cur[k] = v;
    if (preview) { L.setShared(name, cur); return; }
    doc.setShared(name, cur, `${labelOf(k)} of shared material ${name}`);
  }
  function materialEditor(ids, slot, isPrimary, recs) {
    const lib = slot.split('#')[0]; // (a piece "stucco#3" uses the library material "stucco")
    const users = [...L.geo].filter(e => L.slotsOf(e).includes(lib)).length;
    const shared = matMode === 'shared', box = el('div', { class: 'slot' });
    const r0 = recs[0], ov = slotOv(r0, slot, slotInfo(r0.id)[0]);
    const base = L.sharedProps(ov.material || lib) || {};
    const cur = shared ? { ...base, ...(doc.mats.get(lib) || {}) } : { ...base, ...ov };
    // the colour shown is the one the object really has: most kit materials are white and painted per vertex, textured
    // ones multiply their picture, trees and rocks are tinted per instance (the material's own colour is only a factor)
    const look = L.slotLook(L.get(r0.id), ov.material && ov.material !== lib ? ov.material : slot) || { hex: cur.color, source: 'material' };
    const seen = shared ? (cur.color || '#ffffff') : (ov.color || look.hex || cur.color || '#ffffff');
    const how = shared ? 'tint of every object using it' : ov.color ? 'this object’s colour' : { vertex: 'as painted (per-vertex colours)', tint: 'as tinted (per object)', texture: 'texture colour', material: 'material colour' }[look.source];
    const set = (k, v, preview) => shared ? setSharedProp(lib, k, v, preview) : setOverride(ids, slot, k, v, preview);
    const changed = k => shared ? doc.mats.get(lib) && doc.mats.get(lib)[k] !== undefined : ov[k] !== undefined;
    const reset = k => changed(k) ? el('button', { class: 'btn sm', title: shared ? 'Back to the generated value' : 'Remove this override', onclick: () => set(k, undefined) }, '↺') : null;
    box.append(el('div', { class: 'slot-h' }, el('span', { class: 'ic', style: { width: '10px', height: '10px', borderRadius: '2px', background: seen, display: 'inline-block' } }), slot, isPrimary ? el('small', {}, 'main') : null,
      el('small', { style: { marginLeft: 'auto' } }, shared ? `shared · ${users} objects` : 'this object')));
    if (!shared) {
      const names = [...L.matByName.keys()].sort();
      const sel = el('select', { class: 'sel', style: { width: '100%' }, title: 'Use another library material for this slot (this object only)', onchange: e => setOverride(ids, slot, 'material', e.target.value === lib ? undefined : e.target.value) }, names.map(n => el('option', { value: n }, n)));
      sel.value = ov.material || lib;
      box.append(row('Material', sel));
    }
    const color = el('input', { type: 'color', class: 'swatch', value: seen });
    color.addEventListener('input', e => set('color', e.target.value, true)); color.addEventListener('change', e => set('color', e.target.value));
    box.append(row(shared ? 'Tint' : 'Colour', el('div', { class: 'ib' }, color, el('span', { class: 'kv', title: how }, seen), reset('color')), el('div', { class: 'note', style: { marginTop: '2px' } }, how)));
    const slider = (k, label, max = 1, step = 0.01) => {
      const v = cur[k] ?? 0, num = el('input', { class: 'num', value: fmt(v, 2) }), rng = el('input', { type: 'range', min: 0, max, step, value: v });
      rng.addEventListener('input', e => { num.value = fmt(+e.target.value, 2); set(k, +e.target.value, true); }); rng.addEventListener('change', e => set(k, +e.target.value));
      num.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { const n = parseFloat(num.value); if (Number.isFinite(n)) set(k, Math.min(max, Math.max(0, n))); } });
      return row(label, el('div', { class: 'slider' }, rng, el('div', { class: 'ib', style: { flexWrap: 'nowrap' } }, num, reset(k))));
    };
    if (cur.roughness !== undefined) box.append(slider('roughness', 'Roughness'));
    if (cur.metalness !== undefined) box.append(slider('metalness', 'Metalness'));
    if (cur.emissive !== undefined) {
      const em = el('input', { type: 'color', class: 'swatch', value: cur.emissive || '#000000' });
      em.addEventListener('input', e => set('emissive', e.target.value, true)); em.addEventListener('change', e => set('emissive', e.target.value));
      box.append(row('Emissive', el('div', { class: 'ib' }, em, reset('emissive'))), slider('emissiveIntensity', 'Glow', 10, 0.05));
    }
    const tex = el('select', { class: 'sel', style: { width: '100%' }, onchange: e => set('texture', e.target.value === '__none' ? null : e.target.value === '__keep' ? undefined : e.target.value) },
      el('option', { value: '__keep' }, cur.texture === 'procedural' ? 'painted (procedural)' : cur.texture ? cur.texture.replace(/^tex\//, '') : 'none'),
      el('option', { value: '__none' }, 'no texture'), (ui.textures || []).map(t => el('option', { value: t, selected: cur.texture === t && changed('texture') }, t.replace(/^tex\//, '').replace(/_diff_\dk\.jpg$/, ''))));
    box.append(row('Texture', el('div', { class: 'ib', style: { flexWrap: 'nowrap' } }, tex, reset('texture'))));
    if (shared) box.append(el('div', { class: 'note warn' }, `Changes the shared material: all ${users} objects using “${slot}” change.`));
    return box;
  }
  // ---------------------------------------------------------------- rendering
  function render() {
    if (live) return; // (a scrub / slider gesture is running: keep its controls)
    const ids = E.sel.filter(id => L.get(id)), recs = ids.map(id => doc.rec(id)).filter(Boolean);
    body.replaceChildren();
    if (!recs.length) { body.append(emptyState()); return; }
    const one = recs.length === 1, r0 = recs[0], e0 = L.get(r0.id);
    // header
    const nameIn = el('input', { class: 'txt', value: one ? (r0.name || '') : `${recs.length} objects`, disabled: !one, spellcheck: false, title: 'Name (F2)' });
    nameIn.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') nameIn.blur(); if (e.key === 'Escape') { nameIn.value = r0.name || ''; nameIn.blur(); } });
    nameIn.addEventListener('change', () => { const v = nameIn.value.trim(); if (v && v !== r0.name) doc.edit([r0.id], r => { r.name = v; return r; }, `Rename to ${v}`); });
    const st = one ? doc.status(r0.id) : null;
    body.append(el('div', { class: 'sec' }, el('div', { class: 'sec-b', style: { paddingTop: '10px' } },
      el('div', { class: 'ib', style: { flexWrap: 'nowrap' } }, el('span', { class: 'ic', style: { width: '22px', height: '22px', borderRadius: '5px', background: CAT_COLOR[e0.category] || '#9aa4b8', flex: 'none' } }), nameIn),
      one ? el('div', { class: 'kv id', title: 'Object id (stable; used in the world files) — click to copy', style: { cursor: 'copy' }, onclick: () => { navigator.clipboard && navigator.clipboard.writeText(r0.id); toast('Copied id ' + r0.id); } }, r0.id) : el('div', { class: 'note' }, [...new Set(recs.map(r => r.prefab))].slice(0, 6).join(', ')),
      one ? el('div', { class: 'note' }, `${labelOf(r0.prefab || '')} · ${e0.kind === 'added' ? 'added' : 'generated'} · ${e0.area || ''}${st ? ' · ' + st : ''}${doc.fileOf.get(r0.id) ? ' · ' + doc.fileOf.get(r0.id) : ''}`) : null,
      r0.deleted ? el('div', { class: 'note err' }, 'Deleted — undo (Ctrl+Z) or restore it:', el('button', { class: 'btn sm', style: { marginLeft: '6px' }, onclick: () => E.editSel(r => { delete r.deleted; return r; }, 'Restore') }, 'Restore')) : null)));
    // one element (the parts of one material slot: roof, walls, windows...) being edited
    if (one && E.part && E.part.id === r0.id) {
      const slot = E.part.slot, ev = (r0.slots || {})[slot] || {};
      const evec = (key, label, def, digits, step) => row(label, el('div', { class: 'vec' }, [0, 1, 2].map(i => numField((ev[key] || def)[i], v => E.editElement(x => { const a = (x[key] || def).slice(); a[i] = v; x[key] = a; return x; }, `Element ${slot} ${key}`), { axis: 'XYZ'[i], digits, step })))) ;
      const piece = slot.includes('#'), base = slot.split('#')[0];
      const eb = L.elementBox(e0, slot).getSize(new THREE.Vector3()).toArray(), ek = ev.scale || [1, 1, 1];
      const eSize = (i, label) => row(label, numField(eb[i] * Math.abs(ek[i]), v => { if (eb[i] < 1e-4) return; E.editElement(x => { const k = (x.scale || [1, 1, 1]).slice(); k[i] = Math.sign(k[i] || 1) * v / eb[i]; x.scale = k; return x; }, `Element ${slot} ${label.split(' ')[0].toLowerCase()}`); }, { digits: 2, step: 0.05, min: 0.01 }));
      body.append(section('element', piece ? `Piece: ${base} ${slot.split('#')[1].split('.').map(v => +v + 1).join('.')}` : `Element: ${slot}`, [piece ? el('button', { class: 'btn sm', title: 'Every part of this material', onclick: () => E.selectElement(r0.id, base) }, 'All ' + base) : null, el('button', { class: 'btn sm', title: 'Back to the whole object (Esc)', onclick: () => E.selectElement(r0.id, null) }, 'Whole object')].filter(Boolean),
        el('div', { class: 'note' }, (piece ? 'One piece of the “' + base + '” parts (Alt+click it again for a finer piece: one face).' : 'Every part of this object made of “' + slot + '”.') + ' Move / turn / scale it with the gizmo or here (in the object’s own axes). Alt+click picks another element.'),
        eSize(0, 'Width m'), eSize(1, 'Height m'), eSize(2, 'Depth m'),
        el('details', { class: 'adv', open: !closed.has('elxyz'), ontoggle: ev2 => { if (ev2.target.open) closed.delete('elxyz'); else closed.add('elxyz'); localStorage.setItem('wl_ed_closed', JSON.stringify([...closed])); } },
          el('summary', { class: 'note', style: { cursor: 'pointer', margin: '4px 0' } }, 'Advanced — X / Y / Z'),
          evec('offset', 'Move m', [0, 0, 0], 2, 0.05), evec('rotate', 'Turn °', [0, 0, 0], 1, 1), evec('scale', 'Scale', [1, 1, 1], 3, 0.01)),
        el('div', { class: 'ib' },
          el('button', { class: 'btn sm', onclick: () => E.editElement(x => ({ ...x, hidden: x.hidden ? undefined : true }), ev.hidden ? 'Show element' : 'Hide element') }, icon(ev.hidden ? 'eye' : 'eyeoff'), ev.hidden ? 'Show' : 'Hide'),
          el('button', { class: 'btn sm', title: 'Undo every change to this element', onclick: () => E.editElement(() => ({}), `Reset element ${slot}`) }, 'Reset element'),
          el('button', { class: 'btn sm', title: 'A copy of just this part as an object of its own, with its material and colour (Ctrl+D)', onclick: () => E.duplicatePart() }, icon('copy'), 'Duplicate part'),
          el('button', { class: 'btn sm', title: 'Copy just this part (Ctrl+C), then paste it anywhere with Ctrl+V', onclick: () => E.copy() }, 'Copy part')),
        materialEditor(ids, slot, !piece && slot === slotInfo(r0.id)[0], recs)));
    }
    // transform
    const vec = (key, label, digits, step) => row(label, el('div', { class: 'vec' }, [0, 1, 2].map(i => numField(common(recs, r => r[key][i]), (v, preview, end) => setVec(ids, key, i, v, preview, end), { axis: 'XYZ'[i], mixed: common(recs, r => r[key][i]) === null, digits, step }))));
    const sizes = ids.map(sizeOf);
    const plain = (i, label) => row(label, numField(common(sizes.map(s => ({ s })), o => o.s[i]), v => setSize(ids, i, v), { mixed: common(sizes.map(s => ({ s })), o => o.s[i]) === null, digits: 2, step: 0.1, min: 0.01 }));
    body.append(section('size', 'Size & direction', null,
      el('div', { class: 'note' }, 'Drag the coloured grips on the object’s sides to resize one side, the object itself to move it, the ring to turn it. Or type here.'),
      plain(0, 'Width m'), plain(1, 'Height m'), plain(2, 'Depth m'),
      row('Turn °', numField(common(recs, r => r.rotation[1]), (v, preview, end) => setVec(ids, 'rotation', 1, v, preview, end), { mixed: common(recs, r => r.rotation[1]) === null, digits: 1, step: 5 })),
      row('Height above ground m', numField(common(recs, r => r.position[1] - E.world.groundAt(r.position[0], r.position[2])), v => E.editSel(r => { r.position = r.position.slice(); r.position[1] = E.world.groundAt(r.position[0], r.position[2]) + v; return r; }, 'Height above ground'), { mixed: common(recs, r => r.position[1] - E.world.groundAt(r.position[0], r.position[2])) === null, digits: 2, step: 0.05 }))));
    body.append(section('transform', 'Advanced — X / Y / Z', [el('button', { class: 'btn sm', title: 'Reset to the generated transform (or identity)', onclick: () => E.editSel(r => { const e = L.get(r.id), g = e.kind === 'added' ? null : L.generatedRecord(e); r.rotation = g ? g.rotation.slice() : [0, 0, 0]; r.scale = g ? g.scale.slice() : [1, 1, 1]; if (g) r.position = g.position.slice(); return r; }, 'Reset transform') }, 'Reset')],
      vec('position', 'Position m', 2, 0.1), vec('rotation', 'Rotation °', 1, 1), vec('scale', 'Scale', 3, 0.01),
      row('Size m', el('div', { class: 'vec' }, [0, 1, 2].map(i => numField(common(sizes.map((s, k) => ({ s })), o => o.s[i]), v => setSize(ids, i, v), { axis: 'XYZ'[i], mixed: common(sizes.map(s => ({ s })), o => o.s[i]) === null, digits: 2, step: 0.1, min: 0.01 })))),
      el('div', { class: 'ib' }, el('button', { class: 'btn sm', title: 'Drop onto the ground or the object below (End)', onclick: () => E.dropToGround(false) }, icon('ground'), 'Drop to ground'),
        el('button', { class: 'btn sm', title: 'Drop and tilt to the surface below (Shift+End)', onclick: () => E.dropToGround(true) }, icon('normal'), 'Align to surface'),
        el('button', { class: 'btn sm', title: 'Focus the camera (F)', onclick: () => E.focus() }, icon('focus'), 'Focus'))));
    // materials
    const slots = slotInfo(r0.id), commonSlots = slots.filter(s => ids.every(id => slotInfo(id).includes(s)));
    const modeSw = el('div', { class: 'mode-switch' },
      el('button', { class: matMode === 'object' ? 'on' : '', title: 'Change only the selected object(s)', onclick: () => { matMode = 'object'; render(); } }, one ? 'This object' : `These ${ids.length} objects`),
      el('button', { class: matMode === 'shared' ? 'on shared' : '', title: 'Change the library material itself: every object that uses it changes', onclick: () => { matMode = 'shared'; render(); } }, 'Shared material'));
    const matKids = [modeSw];
    if (!commonSlots.length) matKids.push(el('div', { class: 'note' }, 'The selected objects share no material slot.'));
    else {
      matKids.push(materialEditor(ids, commonSlots[0], true, recs));
      if (commonSlots.length > 1) {
        const more = el('details', {}, el('summary', { class: 'note', style: { cursor: 'pointer', margin: '4px 0' } }, `Other slots (${commonSlots.length - 1})`));
        for (const s of commonSlots.slice(1)) more.append(materialEditor(ids, s, false, recs));
        if (E.openSlots) more.open = true; more.addEventListener('toggle', () => { E.openSlots = more.open; });
        matKids.push(more);
      }
    }
    matKids.push(el('div', { class: 'ib' },
      el('button', { class: 'btn sm', title: 'Copy this object\'s material (eyedropper: I)', onclick: () => E.copyMaterial(r0.id) }, icon('copy'), 'Copy material'),
      el('button', { class: 'btn sm', disabled: !E.matClip, title: 'Paste the copied material onto the selection (Ctrl+Shift+V)', onclick: () => E.pasteMaterial() }, icon('drop'), 'Paste' + (E.matClip ? ` (${(doc.rec(E.matClip.from) || {}).name || E.matClip.from})` : '')),
      el('button', { class: 'btn sm', title: 'Remove every material override of the selection', onclick: () => E.editSel(r => { if (!r.materialOverrides && !r.slots && (L.get(r.id).kind === 'added' || r.material === (L.generatedRecord(L.get(r.id)) || {}).material)) return null; delete r.materialOverrides; delete r.slots; const g = L.get(r.id).kind === 'added' ? null : L.generatedRecord(L.get(r.id)); if (g) r.material = g.material; return r; }, 'Reset materials') }, 'Reset')));
    body.append(section('material', 'Material', null, ...matKids));
    // the object's elements: pick one to move / hide / recolour it on its own
    if (one && !(E.part && E.part.id === r0.id)) {
      const list = el('div', { style: { display: 'grid', gap: '2px' } });
      for (const sl of slotInfo(r0.id)) {
        const ex = (r0.slots || {})[sl] || {}, changed = Object.keys(ex).length > 0;
        list.append(el('div', { class: 'ib', style: { flexWrap: 'nowrap', alignItems: 'center' } },
          el('button', { class: 'btn sm', style: { flex: '1', justifyContent: 'flex-start' }, title: 'Edit this element (or Alt+click it in the view)', onclick: () => E.selectElement(r0.id, sl) }, sl, changed ? el('span', { class: 'badge mod', style: { marginLeft: 'auto', fontSize: '9.5px', color: 'var(--warn)' } }, 'edited') : null),
          el('button', { class: 'btn sm', title: ex.hidden ? 'Show' : 'Hide', onclick: () => { E.part = { id: r0.id, slot: sl }; E.editElement(x => ({ ...x, hidden: x.hidden ? undefined : true }), (ex.hidden ? 'Show' : 'Hide') + ' element ' + sl); E.part = null; E.refreshSelection(); } }, icon(ex.hidden ? 'eyeoff' : 'eye'))));
      }
      body.append(section('elements', 'Elements', null, el('div', { class: 'note' }, 'Each part of the object by material. Click one to move, turn, scale, hide or recolour just that part (Alt+click in the view does the same).'), list));
    }
    // organisation
    const groups = new Set(recs.map(r => r.group || ''));
    const grp = el('input', { class: 'txt', value: groups.size === 1 ? [...groups][0] : '', placeholder: groups.size > 1 ? '—' : 'no group', spellcheck: false });
    grp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') grp.blur(); });
    grp.addEventListener('change', () => { const v = grp.value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_'); E.editSel(r => { r.group = v; return r; }, v ? `Group ${v}` : 'Ungroup'); });
    const g0 = groups.size === 1 ? [...groups][0] : '';
    const tags = [...new Set(recs.flatMap(r => r.tags || []))];
    const tagIn = el('input', { class: 'txt', placeholder: 'add tag…', spellcheck: false });
    tagIn.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter' && tagIn.value.trim()) { const t = tagIn.value.trim(); E.editSel(r => { r.tags = [...new Set([...(r.tags || []), t])]; return r; }, `Tag ${t}`); } });
    const flag = (f, label) => { const on = recs.every(r => r[f]); return el('label', { class: 'note', style: { display: 'flex', alignItems: 'center', gap: '5px' } }, el('input', { type: 'checkbox', checked: on, onchange: e => E.setFlag(f, e.target.checked) }), label); };
    body.append(section('organize', 'Organisation', null,
      row('Group', el('div', { class: 'ib', style: { flexWrap: 'nowrap' } }, grp, g0 ? el('button', { class: 'btn sm', title: 'Select every object of this group', onclick: () => E.select(E.groupMembers(g0)) }, 'Select') : null)),
      row('Tags', el('div', {}, el('div', { class: 'tagbox' }, tags.map(t => el('span', { class: 'tag', title: 'click to remove', style: { cursor: 'pointer' }, onclick: () => E.editSel(r => { r.tags = (r.tags || []).filter(x => x !== t); return r; }, `Untag ${t}`) }, t, ' ×'))), tagIn)),
      el('div', { class: 'ib' }, flag('hidden', 'Hidden (game too)'), flag('locked', 'Locked'))));
  }
  function emptyState() {
    const n = L.geo.length, ed = doc.ov.size;
    return el('div', { class: 'hint' }, el('b', {}, 'Nothing selected.'), el('br'),
      'Click an object in the viewport or the outliner. Shift+click adds, drag on empty space for a box.', el('br'), el('br'),
      `World: ${n.toLocaleString()} generated objects (plus instanced trees, rocks and props), ${ed} edited.`, el('br'), el('br'),
      'Add things from the ', el('b', {}, 'Palette'), ' tab, or press ', el('span', { class: 'kbd' }, '?'), ' for every shortcut.');
  }
  let raf = 0; const soon = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(render); };
  E.on(t => { if (t === 'selection' || t === 'matclip') soon(); });
  doc.on(ev => { if (ev.type === 'change' || ev.type === 'external') soon(); });
  render();
  return { render, focusName: () => { const i = body.querySelector('input.txt'); if (i && !i.disabled) { i.focus(); i.select(); } } };
}
