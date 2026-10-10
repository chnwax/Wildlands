// Outliner: every world object in one searchable, filterable list (virtualised: tens of thousands of rows stay fast).
// Groups show as collapsible parents. Click selects (Shift toggles, Ctrl adds), double-click focuses the camera,
// F2 / double-click on the name renames, the eye and lock buttons hide / lock.
import { el, icon, ui } from './ui.js';

export const CAT_COLOR = { building: '#d9a35a', structure: '#c9b48a', path: '#cfc8b8', furniture: '#7fb6d9', lighting: '#f0d264', vegetation: '#6fbf6a', rock: '#a8a29a', prop: '#b48fd9',
  sign: '#e07b5f', play: '#e79bc4', vehicle: '#8fd0c4', fence: '#b9a07a', primitive: '#9aa4b8' };
const CATS = [['all', 'All objects'], ['building', 'Buildings'], ['structure', 'Structures'], ['path', 'Paving'], ['furniture', 'Furniture'], ['lighting', 'Lighting'], ['vegetation', 'Vegetation'], ['rock', 'Rocks'],
  ['prop', 'Props'], ['sign', 'Signs & poles'], ['play', 'Play equipment'], ['vehicle', 'Vehicles'], ['fence', 'Fences'], ['primitive', 'Primitives'], ['-', ''], ['edited', 'Edited (any change)'], ['new', 'Added'], ['deleted', 'Deleted'], ['hidden', 'Hidden'], ['locked', 'Locked']];
const ROW = 24;

export function buildOutliner(E, pane) {
  const doc = E.doc, L = E.L;
  let lastDown = null, filter = 'all', query = '', fields = false, rows = [], collapsed = new Set(), anchor = null, renaming = null;
  const search = el('input', { class: 'txt', placeholder: 'Search name, id, prefab, tag…', spellcheck: false });
  const cat = el('select', { class: 'sel', title: 'Filter by type or state' }, CATS.map(([v, l]) => v === '-' ? el('option', { disabled: true }, '──────────') : el('option', { value: v }, l)));
  const fieldsBox = el('label', { class: 'note', style: { display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }, title: 'List the dense forest / hedgerow plants too (tens of thousands)' }, el('input', { type: 'checkbox', onchange: e => { fields = e.target.checked; rebuild(); } }), 'forest');
  const list = el('div', { class: 'scroll', tabIndex: 0 }), inner = el('div', { style: { position: 'relative' } }); list.append(inner);
  const foot = el('div', { class: 'ol-foot' });
  pane.append(el('div', { class: 'ph' }, el('div', { class: 'search' }, icon('search'), search), cat, fieldsBox), list, foot);
  let t = 0; search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { query = search.value.trim().toLowerCase(); rebuild(); }, 120); });
  cat.addEventListener('change', () => { filter = cat.value; rebuild(); });

  // every object as a light entry { id, name, prefab, cat, group, status, hidden, locked }
  function entries() {
    const out = [];
    const add = (e) => {
      if (e.id === '__ghost__') return;
      const r = doc.ov.get(e.id), gen = e.kind === 'added' ? null : L.generatedRecord(e);
      const name = (r && r.name) || (gen && gen.name) || e.id, group = r && r.group !== undefined ? r.group : gen && gen.group;
      out.push({ id: e.id, name, prefab: e.prefab, cat: e.category || 'prop', group: group || '', status: doc.status(e.id), hidden: !!(r && r.hidden), locked: !!(r && r.locked), field: e.field, area: e.area, tags: (r && r.tags) || (gen && gen.tags) || [] });
    };
    for (const e of L.allGenerated({ fields })) add(e);
    for (const e of L.ents.values()) if (e.kind === 'added') add(e);
    return out;
  }
  function matches(x) {
    if (filter === 'edited' && !x.status) return false; if (filter === 'new' && x.status !== 'new') return false; if (filter === 'deleted' && x.status !== 'deleted') return false;
    if (filter === 'hidden' && !x.hidden) return false; if (filter === 'locked' && !x.locked) return false;
    if (!['all', 'edited', 'new', 'deleted', 'hidden', 'locked'].includes(filter) && x.cat !== filter) return false;
    if (!query) return true;
    return query.split(/\s+/).every(q => q.startsWith('tag:') ? x.tags.some(t => t.includes(q.slice(4))) : x.id.includes(q) || x.name.toLowerCase().includes(q) || x.prefab.includes(q) || x.area === q);
  }
  let all = null;
  function rebuild(keepScroll = true) {
    all = entries();
    const shown = all.filter(matches), byGroup = new Map(), top = [];
    for (const x of shown) { if (x.group) { if (!byGroup.has(x.group)) byGroup.set(x.group, []); byGroup.get(x.group).push(x); } else top.push(x); }
    // a group whose parent object is itself listed sits under that object; others get a group row
    const ids = new Set(shown.map(x => x.id));
    rows = [];
    const cmp = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    const emit = (x, depth) => {
      rows.push({ x, depth });
      const kids = byGroup.get(x.id); if (kids) { byGroup.delete(x.id); x.kids = kids.length; if (!collapsed.has(x.id) || query) for (const k of kids.sort(cmp)) emit(k, depth + 1); }
    };
    for (const x of top.sort(cmp)) emit(x, 0);
    for (const [g, kids] of [...byGroup].sort((a, b) => a[0] < b[0] ? -1 : 1)) {
      if (ids.has(g)) continue;
      rows.push({ group: g, n: kids.length, depth: 0 });
      if (!collapsed.has(g) || query) for (const k of kids.sort(cmp)) emit(k, 1);
    }
    inner.style.height = rows.length * ROW + 'px';
    if (!keepScroll) list.scrollTop = 0;
    foot.textContent = `${shown.length.toLocaleString()} of ${all.length.toLocaleString()} objects` + (E.sel.length ? ` · ${E.sel.length} selected` : '');
    draw();
  }
  const pool = [];
  function draw() {
    const h = list.clientHeight || 400, first = Math.max(0, Math.floor(list.scrollTop / ROW) - 4), last = Math.min(rows.length, first + Math.ceil(h / ROW) + 8);
    const sel = new Set(E.sel);
    let k = 0;
    for (let i = first; i < last; i++, k++) {
      let r = pool[k]; if (!r) { r = el('div', { class: 'ol-row' }); pool.push(r); inner.append(r); r.addEventListener('pointerdown', onRowDown); }
      const row = rows[i]; r.style.top = i * ROW + 'px'; r.style.display = ''; r._row = row;
      r.style.paddingLeft = 8 + row.depth * 16 + 'px';
      if (row.group) {
        r.className = 'ol-row grp';
        r.replaceChildren(el('span', { class: 'caret' }, collapsed.has(row.group) && !query ? '▸' : '▾'), el('span', { class: 'nm' }, row.group, el('small', {}, `${row.n} objects`)));
        continue;
      }
      const x = row.x, st = x.status;
      r.className = 'ol-row' + (sel.has(x.id) ? ' sel' : '') + (x.hidden ? ' hid' : '');
      const nm = renaming === x.id ? el('span', { class: 'nm' }, renameInput(x)) : el('span', { class: 'nm', title: x.id }, x.name, el('small', {}, x.id));
      r.replaceChildren(...[
        x.kids ? el('span', { class: 'caret', onpointerdown: e => { e.stopPropagation(); toggle(x.id); } }, collapsed.has(x.id) && !query ? '▸' : '▾') : el('span', { class: 'caret' }),
        el('span', { class: 'ic', style: { background: CAT_COLOR[x.cat] || '#9aa4b8' } }, (x.cat || '?')[0].toUpperCase()), nm,
        st ? el('span', { class: 'badge ' + (st === 'new' ? 'new' : st === 'deleted' ? 'del' : 'mod') }, st === 'new' ? 'new' : st === 'deleted' ? 'deleted' : 'edited') : null,
        el('button', { class: 'tg' + (x.hidden ? ' act' : ''), title: x.hidden ? 'Show (H)' : 'Hide (H)', onpointerdown: e => { e.stopPropagation(); flag(x.id, 'hidden'); } }, icon(x.hidden ? 'eyeoff' : 'eye')),
        el('button', { class: 'tg' + (x.locked ? ' act' : ''), title: x.locked ? 'Unlock (L)' : 'Lock (L)', onpointerdown: e => { e.stopPropagation(); flag(x.id, 'locked'); } }, icon(x.locked ? 'lock' : 'unlock'))].filter(Boolean));
    }
    for (; k < pool.length; k++) pool[k].style.display = 'none';
  }
  function toggle(g) { if (collapsed.has(g)) collapsed.delete(g); else collapsed.add(g); rebuild(); }
  function flag(id, f) {
    const r = doc.rec(id); const v = !r[f];
    doc.edit([id], rr => { if (v) rr[f] = true; else delete rr[f]; return rr; }, `${v ? '' : 'Un'}${f === 'hidden' ? 'hide' : 'lock'} ${r.name || id}`.replace(/^./, c => c.toUpperCase()));
    if (f === 'locked' && v) E.select([id], 'remove');
  }
  function onRowDown(e) {
    const row = this._row; if (!row || e.button !== 0) return;
    if (row.group) { if (e.target.classList.contains('caret')) { toggle(row.group); return; } E.select(E.groupMembers(row.group), e.shiftKey ? 'add' : 'set'); return; }
    const id = row.x.id;
    if (row.x.locked) { ui.status(`${row.x.name} is locked — unlock it to select it`); return; }
    if (e.shiftKey && anchor) { const ids = rows.filter(r => r.x).map(r => r.x.id), a = ids.indexOf(anchor), b = ids.indexOf(id); if (a >= 0 && b >= 0) { E.select(ids.slice(Math.min(a, b), Math.max(a, b) + 1).filter(i => !(doc.rec(i) || {}).locked), 'set'); return; } }
    // (double-click by hand: the row's contents are redrawn between the clicks, which loses the browser's dblclick)
    const now = performance.now(), dbl = lastDown && lastDown.id === id && now - lastDown.t < 450; lastDown = { id, t: now };
    if (dbl && !e.ctrlKey && !e.shiftKey) { E.select([id]); E.focus(); return; }
    E.select([id], e.ctrlKey || e.metaKey ? 'toggle' : 'set'); anchor = id;
  }
  function onRowDbl(e) {
    const row = this._row; if (!row || row.group) return;
    E.select([row.x.id]); E.focus(); // (F2 renames)
  }
  function renameInput(x) {
    const inp = el('input', { value: x.name, spellcheck: false });
    const done = ok => { if (renaming !== x.id) return; renaming = null; const v = inp.value.trim(); if (ok && v && v !== x.name) doc.edit([x.id], r => { r.name = v; return r; }, `Rename to ${v}`); else draw(); };
    inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
    inp.addEventListener('blur', () => done(true));
    setTimeout(() => { inp.focus(); inp.select(); });
    return inp;
  }
  function startRename(id) { renaming = id; const i = rows.findIndex(r => r.x && r.x.id === id); if (i >= 0 && (i * ROW < list.scrollTop || i * ROW > list.scrollTop + list.clientHeight - ROW)) list.scrollTop = i * ROW - list.clientHeight / 2; draw(); }
  list.addEventListener('scroll', () => draw());
  addEventListener('resize', () => draw());
  // reveal the primary selection
  function reveal() { const id = E.primary; if (!id) return; const i = rows.findIndex(r => r.x && r.x.id === id); if (i >= 0 && (i * ROW < list.scrollTop || i * ROW > list.scrollTop + list.clientHeight - ROW)) list.scrollTop = i * ROW - list.clientHeight / 2 + ROW; }
  let pending = 0;
  const soon = () => { cancelAnimationFrame(pending); pending = requestAnimationFrame(() => rebuild()); };
  E.on(t => { if (t === 'selection') { reveal(); draw(); foot.textContent = foot.textContent.replace(/ · \d+ selected$/, '') + (E.sel.length ? ` · ${E.sel.length} selected` : ''); } });
  doc.on(ev => { if (ev.type === 'change' || ev.type === 'external') soon(); });
  rebuild();
  return { rebuild, startRename, focusSearch: () => { search.focus(); search.select(); } };
}
