// The editor's workspace: panels (outliner / palette, inspector), the tool and snapping toolbar, undo / redo, saving
// (Ctrl+S, autosave, unsaved-changes indicator and warning), live reload of world files edited on disk, data
// problems, and every keyboard shortcut. Built once the world is loaded (main.js).
import { THREE, renderer } from '../core.js';
import { refreshShadowCasters } from '../sky.js';
import { ui, el, icon, toast, modal, contextMenu, isTyping } from './ui.js';
import { io, hashText } from './io.js';
import { Doc } from './doc.js';
import { Editor } from './editor.js';
import { buildOutliner } from './outliner.js';
import { buildInspector } from './inspector.js';
import { buildPalette } from './palette.js';
import { formatProblem } from '../world/format.js';

export async function startWorkspace(ed) {
  const L = ed.world.layer;
  await io.init();
  ui.textures = io.textures;
  const doc = new Doc(L, ed.map), E = new Editor(ed, doc);
  ed.doc = doc; ed.E = E;
  ed.refreshShadows = () => refreshShadowCasters();
  // the camera orbits around / zooms toward what is under the cursor (objects only when close: the ground is cheaper)
  ed.cam.getPivot = () => { if (!E.sel.length) return null; const b = new THREE.Box3(); for (const id of E.sel) { const e = L.get(id); if (e) b.union(L.worldBox(e)); } return b.isEmpty() ? null : b.getCenter(new THREE.Vector3()); };
  ui.pickPoint = (x, y) => { const p = E.picker.pick(x, y); return p.hit ? p.hit.point : p.ground ? p.ground.point : null; };
  // ---------------------------------------------------------------- panels
  const tabs = el('div', { class: 'tabs' }), olPane = el('div', { class: 'pane' }), palPane = el('div', { class: 'pane hidden' });
  const tabBtn = (name, pane) => el('button', { class: 'tab', onclick: () => showTab(name) }, name);
  const tOl = tabBtn('Outliner'), tPal = tabBtn('Palette');
  tabs.append(tOl, tPal); ui.left.append(tabs, olPane, palPane);
  const outliner = buildOutliner(E, olPane), palette = buildPalette(E, palPane);
  function showTab(n) { tOl.classList.toggle('on', n === 'Outliner'); tPal.classList.toggle('on', n === 'Palette'); olPane.classList.toggle('hidden', n !== 'Outliner'); palPane.classList.toggle('hidden', n !== 'Palette'); if (n === 'Palette') palette.show(); try { localStorage.setItem('wl_ed_tab', n); } catch (e) {} }
  showTab(localStorage.getItem('wl_ed_tab') || 'Outliner');
  ui.right.append(el('div', { class: 'tabs' }, el('button', { class: 'tab on' }, 'Inspector')), el('div', { class: 'pane' }));
  const inspector = buildInspector(E, ui.right.lastChild);
  // ---------------------------------------------------------------- toolbar: history, tools, space, snapping
  const tb = ui.tb;
  const bUndo = el('button', { class: 'tbtn', onclick: () => undo() }, icon('undo')), bRedo = el('button', { class: 'tbtn', onclick: () => redo() }, icon('redo'));
  tb.history.append(bUndo, bRedo);
  // the main tool edits directly (grab faces, drag objects, lift, turn); the XYZ gizmo tools are the precise / advanced way
  const TOOLS = [['direct', 'Edit directly: drag an object to move it, its face grips to resize one side, the ring to turn it, the arrow to raise it', 'Q'],
    ['translate', 'Move along X / Y / Z (advanced)', 'W'], ['rotate', 'Rotate about X / Y / Z (advanced)', 'E'], ['scale', 'Scale along X / Y / Z (advanced)', 'R']];
  const toolBtns = TOOLS.map(([t, label, k]) => el('button', { class: 'tbtn', title: `${label} (${k})`, onclick: () => E.setTool(t) }, icon(t === 'translate' ? 'move' : t), t === 'direct' ? 'Edit' : null, el('kbd', {}, k)));
  tb.tools.append(...toolBtns);
  const bSpace = el('button', { class: 'tbtn', title: 'Gizmo in world or object (local) axes (X)', onclick: () => { E.gizmo.space = E.gizmo.space === 'world' ? 'local' : 'world'; syncTb(); E.placeGizmo(); } });
  tb.space.append(bSpace);
  const sn = E.gizmo.snap, saveSnap = () => { try { localStorage.setItem('wl_ed_snap', JSON.stringify(sn)); } catch (e) {} };
  const bSnap = el('button', { class: 'tbtn', title: 'Snapping on / off (G). Hold Ctrl while dragging to invert it.', onclick: () => { sn.on = !sn.on; saveSnap(); syncTb(); } }, icon('snap'), 'Snap');
  const stepIn = (k, title, suffix) => { const i = el('input', { class: 'num', type: 'number', step: 'any', min: 0.001, value: sn[k], title }); i.addEventListener('change', () => { const v = parseFloat(i.value); if (v > 0) { sn[k] = v; saveSnap(); } else i.value = sn[k]; }); i.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') i.blur(); }); return [i, el('span', { class: 'note', style: { margin: '0 4px 0 1px' } }, suffix)]; };
  tb.snap.append(bSnap, ...stepIn('move', 'Grid step (m)', 'm'), ...stepIn('rotate', 'Rotation step (°)', '°'), ...stepIn('scale', 'Scale step', '×'));
  // right side: show hidden, problems, save state, save
  const bHidden = el('button', { class: 'tbtn', title: 'Show hidden objects as ghosts (selectable)', onclick: () => { E.showHidden = !E.showHidden; applyHiddenGhosts(); syncTb(); } }, icon('eye'));
  const bProblems = el('button', { class: 'tbtn hidden', title: 'World data problems', onclick: () => showProblems(true) });
  const saveState = el('div', { class: 'savestate', title: 'Save state' }, el('i'), el('span', {}, 'Saved'));
  const bAuto = el('button', { class: 'tbtn', title: 'Autosave: save 2 s after every change' , onclick: () => { autosave = !autosave; try { localStorage.setItem('wl_ed_autosave', autosave ? '1' : '0'); } catch (e) {} syncTb(); if (autosave) scheduleSave(); } }, 'Auto');
  const bSave = el('button', { class: 'tbtn', title: 'Save to world/' + ed.map + '/edits (Ctrl+S)', onclick: () => save() }, icon('save'), 'Save');
  tb.right.append(bHidden, bProblems, saveState, bAuto, bSave);
  let autosave = localStorage.getItem('wl_ed_autosave') !== '0';
  function syncTb() {
    toolBtns.forEach((b, i) => b.classList.toggle('on', E.tool === TOOLS[i][0]));
    bSpace.replaceChildren(icon(E.gizmo.space === 'world' ? 'world' : 'local'), E.gizmo.space === 'world' ? 'World' : 'Local'); bSpace.title = `Gizmo axes: ${E.gizmo.space} (X toggles)`;
    bSnap.classList.toggle('on', sn.on); bHidden.classList.toggle('on', E.showHidden); bAuto.classList.toggle('on', autosave);
    const u = doc.undoStack[doc.undoStack.length - 1], r = doc.redoStack[doc.redoStack.length - 1];
    bUndo.disabled = !u; bRedo.disabled = !r;
    bUndo.title = u ? `Undo ${u.label} (Ctrl+Z) — ${doc.undoStack.length} step${doc.undoStack.length > 1 ? 's' : ''}` : 'Nothing to undo';
    bRedo.title = r ? `Redo ${r.label} (Ctrl+Y)` : 'Nothing to redo';
    syncSave();
  }
  let saving = false, saveErr = null;
  function syncSave() {
    const dirty = doc.isDirty;
    saveState.className = 'savestate' + (saving ? ' saving' : saveErr ? ' error' : dirty ? ' dirty' : '');
    saveState.lastChild.textContent = !io.dev ? 'No dev server — cannot save' : saving ? 'Saving…' : saveErr ? 'Save failed' : dirty ? `Unsaved (${doc.dirty.size + (doc.indexDirty ? 1 : 0)} file${doc.dirty.size + (doc.indexDirty ? 1 : 0) > 1 ? 's' : ''})` : 'All changes saved';
    saveState.title = saveErr || (dirty ? [...doc.dirty].join('\n') : 'world/' + ed.map + '/edits');
    document.title = (dirty ? '● ' : '') + 'Wildlands — World Editor · ' + ed.map;
  }
  E.on(t => { if (t === 'tool' || t === 'selection') syncTb(); });
  // ---------------------------------------------------------------- saving
  let saveTimer = 0;
  function scheduleSave() { clearTimeout(saveTimer); if (autosave && io.dev) saveTimer = setTimeout(() => save(true), 2000); }
  async function save(auto = false) {
    clearTimeout(saveTimer);
    if (!io.dev) { toast('Saving needs the dev server: npm run editor', 'err', 4000); return; }
    if (saving) { scheduleSave(); return; }
    if (!doc.isDirty) { if (!auto) toast('Nothing to save — all changes are saved', 'ok'); return; }
    saving = true; saveErr = null; syncSave();
    const r = await doc.save().catch(e => ({ saved: [], failed: [['', e.message]] }));
    saving = false;
    if (r.failed.length) { saveErr = r.failed.map(([p, m]) => `${p}: ${m}`).join('\n'); toast('Save failed: ' + saveErr, 'err', 6000); }
    else if (!auto) toast(`Saved ${r.saved.length} file${r.saved.length > 1 ? 's' : ''} to world/${ed.map}/`, 'ok');
    syncSave();
  }
  addEventListener('beforeunload', e => { if (doc.isDirty) { e.preventDefault(); e.returnValue = 'You have unsaved world edits.'; return e.returnValue; } });
  doc.on(ev => {
    if (ev.type === 'change') { scheduleSave(); syncTb(); if (ev.cmd && !ev.undo && !ev.redo) ui.status(ev.cmd.label); for (const id of ev.ids || []) E.picker.invalidate(id); shadowsSoon(); applyHiddenGhosts(); }
    if (ev.type === 'external') { const n = (ev.ids || []).length; toast(`${ev.path} changed on disk — reloaded${n ? ` (${n} object${n > 1 ? 's' : ''})` : ''}`, ev.problems && ev.problems.some(q => q.level === 'error') ? 'warn' : 'ok', 3200); E.picker.invalidate(); syncTb(); shadowsSoon(); showProblems(); }
    if (ev.type === 'problems') showProblems(true);
    if (ev.type === 'conflict') showConflict(ev.path);
    if (ev.type === 'saved') syncSave();
  });
  let shT = 0; const shadowsSoon = () => { clearTimeout(shT); shT = setTimeout(() => refreshShadowCasters(), 150); };
  // ---------------------------------------------------------------- files changed on disk
  io.onFileChanged = async m => {
    if (!m.path.startsWith(`world/${ed.map}/`)) return;
    if (m.path.includes('/generated/')) { ui.status('Generated world files changed on disk — reload the editor to see the regenerated world', 'warn'); return; }
    try { await doc.external(m.path); } catch (e) { toast(`Could not reload ${m.path}: ${e.message}`, 'err', 5000); }
  };
  io.onConnection = ok => { if (!ok) ui.status('Lost the dev server connection — saving paused until it is back', 'warn'); else if (io.dev) ui.status(''); };
  // ---------------------------------------------------------------- problems / conflicts
  let banner = null;
  function showProblems(force = false) {
    const P = L.problems;
    bProblems.classList.toggle('hidden', !P.length); bProblems.replaceChildren(el('span', { style: { color: P.some(p => p.level === 'error') ? 'var(--err)' : 'var(--warn)' } }, '⚠'), `${P.length}`);
    if (banner) { banner.remove(); banner = null; }
    if (!P.length || (!force && !P.some(p => p.level === 'error'))) return;
    const errs = P.filter(p => p.level === 'error').length;
    banner = el('div', { class: 'banner' + (errs ? '' : ' warn') },
      el('div', { class: 'bh' }, `World data: ${errs} error${errs === 1 ? '' : 's'}, ${P.length - errs} warning${P.length - errs === 1 ? '' : 's'}`, el('span', { class: 'grow' }),
        el('span', { class: 'note' }, 'Invalid entries are skipped; a file with errors is not overwritten until it is fixed.'), el('button', { class: 'btn sm', onclick: () => { banner.remove(); banner = null; } }, icon('close'))),
      el('pre', {}, P.slice(0, 30).map(formatProblem).join('\n') + (P.length > 30 ? `\n… ${P.length - 30} more` : '')));
    document.body.append(banner);
  }
  function showConflict(path) {
    const b = el('div', { class: 'banner warn' }, el('div', { class: 'bh' }, `${path} changed on disk while you had unsaved changes in it.`, el('span', { class: 'grow' }),
      el('button', { class: 'btn sm', onclick: async () => { b.remove(); await doc.resolve(path, 'disk'); toast(`Loaded ${path} from disk`); } }, 'Load from disk'),
      el('button', { class: 'btn sm pri', onclick: async () => { b.remove(); await doc.resolve(path, 'mine'); toast(`Kept your version of ${path}`); } }, 'Keep mine (save)')));
    document.body.append(b);
  }
  showProblems();
  // ---------------------------------------------------------------- hidden objects as ghosts
  const ghostMat = new THREE.MeshBasicMaterial({ color: 0x9ab4d8, transparent: true, opacity: 0.22, depthWrite: false, fog: false });
  function applyHiddenGhosts() {
    for (const e of L.ents.values()) {
      if (!e.det) continue; const st = e.state || {}, ghost = E.showHidden && st.hidden && !st.deleted;
      if (ghost && !e.det.ghost) { e.det.ghost = true; e.det.group.visible = true; e.det.group.traverse(o => { if (o.isMesh && o.material) { o.userData.realMat = o.material; o.material = ghostMat; o.castShadow = false; } }); }
      else if (!ghost && e.det.ghost) { e.det.ghost = false; e.det.group.visible = !(st.hidden || st.deleted); e.det.group.traverse(o => { if (o.userData.realMat) { o.material = o.userData.realMat; delete o.userData.realMat; } }); }
    }
  }
  // ---------------------------------------------------------------- undo / redo
  function undo() { const c = doc.undo(); if (c) { ui.status('Undo: ' + c.label); toast('Undo: ' + c.label); } else toast('Nothing to undo'); syncTb(); }
  function redo() { const c = doc.redo(); if (c) { ui.status('Redo: ' + c.label); toast('Redo: ' + c.label); } else toast('Nothing to redo'); syncTb(); }
  // ---------------------------------------------------------------- keyboard
  const K = (code, run, o = {}) => ui.keys.push({ code, run, ...o });
  const has = () => E.sel.length > 0;
  K('KeyQ', () => E.setTool('direct')); K('KeyW', () => E.setTool('translate')); K('KeyE', () => E.setTool('rotate')); K('KeyR', () => E.setTool('scale'));
  K('KeyX', () => { E.gizmo.space = E.gizmo.space === 'world' ? 'local' : 'world'; syncTb(); E.placeGizmo(); toast('Gizmo: ' + E.gizmo.space + ' axes'); });
  K('KeyG', () => { sn.on = !sn.on; saveSnap(); syncTb(); toast('Snapping ' + (sn.on ? 'on' : 'off')); });
  K('KeyZ', undo, { ctrl: true, shift: false }); K('KeyZ', redo, { ctrl: true, shift: true }); K('KeyY', redo, { ctrl: true });
  K('KeyS', () => save(), { ctrl: true });
  K('KeyD', () => E.duplicate(), { ctrl: true, when: has });
  K('KeyC', () => E.copy(), { ctrl: true, when: has });
  K('KeyV', () => E.paste(), { ctrl: true, shift: false });
  K('KeyV', () => E.pasteMaterial(), { ctrl: true, shift: true });
  K('Delete', () => E.remove(), { when: () => has() && !E.part }); K('Backspace', () => E.remove(), { when: () => has() && !E.part });
  K('End', () => E.dropToGround(false), { shift: false, when: has }); K('End', () => E.dropToGround(true), { shift: true, when: has });
  K('KeyF', () => E.focus(), { when: has });
  K('KeyH', () => E.editElement(el => ({ ...el, hidden: el.hidden ? undefined : true }), 'Hide / show element'), { when: () => !!E.part, alt: false });
  K('Delete', () => E.editElement(el => ({ ...el, hidden: true }), 'Hide element'), { when: () => !!E.part });
  K('KeyH', () => E.setFlag('hidden'), { when: has, alt: false }); K('KeyH', () => E.showAll(), { alt: true });
  K('KeyL', () => E.setFlag('locked'), { when: has });
  K('KeyG', () => E.group(), { ctrl: true, shift: false }); K('KeyG', () => E.ungroup(), { ctrl: true, shift: true });
  K('KeyI', () => E.armEyedropper());
  K('KeyA', () => { const ids = E.picker.inRect(0, 0, innerWidth, innerHeight); E.select(ids); toast(`Selected ${ids.length} visible objects`); }, { ctrl: true });
  K('F2', () => { if (E.sel.length === 1) { showTab('Outliner'); outliner.startRename(E.primary); } });
  K('KeyF', () => { showTab('Outliner'); outliner.focusSearch(); }, { ctrl: true });
  K('Escape', () => { if (E.direct) E.endDirect(true); else if (E.gizmo.drag) E.gizmo.end(true); else if (E.part) E.selectElement(E.part.id, null); else if (E.placing) E.disarm(); else if (E.eyedropper) E.armEyedropper(); else E.select([]); });
  K('Equal', () => E.scaleGhost(1.25), { when: () => !!E.placing }); K('Minus', () => E.scaleGhost(0.8), { when: () => !!E.placing });
  K('NumpadAdd', () => E.scaleGhost(1.25), { when: () => !!E.placing }); K('NumpadSubtract', () => E.scaleGhost(0.8), { when: () => !!E.placing });
  K('BracketLeft', () => E.turnGhost(-Math.PI / 12), { when: () => !!E.placing }); K('BracketRight', () => E.turnGhost(Math.PI / 12), { when: () => !!E.placing });
  // the time-of-day [ ] keys come after these (placing a ghost turns it instead)
  ui.keys.sort((a, b) => (a.when ? 0 : 1) - (b.when ? 0 : 1));
  renderer.domElement.addEventListener('wheel', e => { if (E.placing && e.altKey) { e.preventDefault(); e.stopImmediatePropagation(); E.turnGhost(Math.sign(e.deltaY) * Math.PI / 12); } }, { capture: true, passive: false });
  addEventListener('pointermove', e => { E.lastX = e.clientX; E.lastY = e.clientY; });
  // right-click menu on the selection
  renderer.domElement.addEventListener('contextmenu', e => {
    if (ed.cam.drag && ed.cam.drag.moved > 4) return;
    // (the right button never selects: it is the camera's; the menu is for what is already selected)
    if (!E.sel.length) return;
    const p = E.picker.pick(e.clientX, e.clientY); if (!p.hit || !E.sel.includes(p.hit.id)) return;
    const n = E.sel.length;
    contextMenu(e.clientX, e.clientY, [
      { label: 'Focus', key: 'F', run: () => E.focus() }, '-',
      { label: 'Duplicate', key: 'Ctrl+D', run: () => E.duplicate() }, { label: 'Copy', key: 'Ctrl+C', run: () => E.copy() }, { label: 'Delete', key: 'Del', run: () => E.remove() }, '-',
      { label: 'Drop to ground', key: 'End', run: () => E.dropToGround(false) }, { label: 'Align to surface', key: 'Shift+End', run: () => E.dropToGround(true) }, '-',
      { label: 'Copy material', key: 'I', run: () => E.copyMaterial(p.hit.id) }, { label: 'Paste material', key: 'Ctrl+Shift+V', disabled: !E.matClip, run: () => E.pasteMaterial() }, '-',
      { label: n > 1 ? `Group ${n} objects` : 'Group', key: 'Ctrl+G', disabled: n < 2, run: () => E.group() }, { label: 'Ungroup', key: 'Ctrl+Shift+G', run: () => E.ungroup() },
      { label: 'Hide', key: 'H', run: () => E.setFlag('hidden', true) }, { label: 'Lock', key: 'L', run: () => E.setFlag('locked', true) }]);
  });
  // ---------------------------------------------------------------- per frame: gizmo + overlays; status line
  ui.afterRender.push(() => { E.gizmo.update(); E.handles.update(); E.outline.render(E.gizmo.visible || E.handles.visible ? E.gizmo.scene : null); });
  const selInfo = el('span'), hovInfo = el('span');
  ui.statusMsg.after(hovInfo, selInfo);
  ui.statusItems.push(() => {
    selInfo.innerHTML = E.sel.length ? `<b>${E.sel.length}</b> selected` : '';
    const c = E.cursor; hovInfo.innerHTML = c && (c.hit || c.ground) ? `${c.hit ? '<b>' + c.hit.id + '</b> · ' : ''}${(c.hit ? c.hit.point : c.ground.point).toArray().map(v => v.toFixed(1)).join(', ')}` : '';
  });
  syncTb();
  if (doc.isDirty) { ui.status('Edits were renamed to the ids the generator now uses — save to keep that', 'warn'); scheduleSave(); }
  // regenerate: the generator's output into world/<map>/generated (only files that changed are written)
  if (io.dev) setTimeout(async () => { try { const r = await regenerate(ed, doc); const n = r.files.filter(f => f.written || f.removed).length; if (n) toast(`Generated world files updated (${n})`, 'ok'); } catch (e) { console.warn('regenerate', e); } }, 1500);
  return { doc, E };
}
export async function regenerate(ed, doc, done = false) {
  const files = ed.world.layer.exportGenerated({ textures: io.textures, editsIndex: doc ? doc.index : null });
  if (doc) doc.index = { ...JSON.parse(files[`world/${ed.map}/world.json`]), edits: doc.index.edits, ...(doc.index.materialEdits ? { materialEdits: doc.index.materialEdits } : {}) };
  for (const [p, t] of Object.entries(files)) io.lastSaved.set(p, await hashText(t));
  const r = await fetch('/api/regenerated', { method: 'POST', body: JSON.stringify({ files, done, map: ed.map }) });
  return r.json();
}
