// Editor UI frame: DOM helpers, toolbar, status bar, toasts, modal dialogs and the keyboard shortcut overlay.
// Panels (outliner, palette, inspector) and tools register themselves on `ui`.
import { THREE, Q, QUALITY, renderer } from '../core.js';
import { time, updateSky } from '../sky.js';
import { setQuality } from '../engine.js';
import { toggleOverlay } from '../perf.js';

export function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v; else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'html') e.innerHTML = v;
    else if (k in e && typeof v !== 'string') e[k] = v; else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
const ICONS = {
  select: '<path d="M4 3l7 17 2.2-7.2L20 11z"/>',
  move: '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/>',
  scale: '<path d="M4 20h7v-7H4zM11 13l9-9M14 4h6v6"/>',
  local: '<rect x="5" y="5" width="14" height="14" rx="2" transform="rotate(15 12 12)"/><path d="M12 12l5-2"/>',
  world: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c3 3 3 13 0 16M12 4c-3 3-3 13 0 16"/>',
  snap: '<path d="M4 4h16v16H4zM4 10h16M4 16h16M10 4v16M16 4v16"/>',
  orbit: '<circle cx="12" cy="12" r="3"/><ellipse cx="12" cy="12" rx="9" ry="4"/>',
  fly: '<path d="M2 16l20-8-7 13-3-6z"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
  save: '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 1-1 1.7M12 17h.01"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3 3.7M6.6 6.6A17 17 0 0 0 2 12s4 7 10 7a9.6 9.6 0 0 0 5.4-1.6"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  focus: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><circle cx="12" cy="12" r="2.5"/>',
  ground: '<path d="M12 3v11M8 10l4 4 4-4M3 20h18"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  drop: '<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z"/>',
  group: '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/><path d="M11 7h4a2 2 0 0 1 2 2v4"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  normal: '<path d="M4 18h16"/><path d="M12 18V6M8 10l4-4 4 4"/>',
};
export const icon = n => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.innerHTML = ICONS[n] || ''; return s; };

// ---------------------------------------------------------------- toasts / dialogs
// a message at the bottom of the view; the same message again restarts it instead of stacking (at most 3 shown)
export function toast(msg, kind = '', ms = 2200) {
  const box = document.getElementById('toasts');
  let t = [...box.children].find(c => c.textContent === msg && !c.classList.contains('out'));
  if (!t) { t = el('div', { class: 'toast ' + kind }, msg); box.append(t); while (box.children.length > 3) box.firstChild.remove(); }
  clearTimeout(t._a); clearTimeout(t._b);
  t._a = setTimeout(() => t.classList.add('out'), ms); t._b = setTimeout(() => t.remove(), ms + 400);
  return t;
}
export function modal(title, body, { onClose } = {}) {
  const bg = el('div', { class: 'modal-bg' });
  const close = () => { bg.remove(); removeEventListener('keydown', esc, true); onClose && onClose(); };
  const esc = e => { if (e.code === 'Escape') { e.stopPropagation(); close(); } };
  bg.append(el('div', { class: 'modal' }, el('div', { class: 'modal-h' }, title, el('button', { class: 'btn sm x', onclick: close }, icon('close'))), el('div', { class: 'modal-b' }, body)));
  bg.addEventListener('pointerdown', e => { if (e.target === bg) close(); });
  addEventListener('keydown', esc, true);
  document.body.append(bg);
  return { close };
}
export function contextMenu(x, y, items) {
  document.querySelectorAll('.ctx').forEach(c => c.remove());
  const m = el('div', { class: 'ctx' });
  for (const it of items) {
    if (it === '-') { m.append(el('hr')); continue; }
    m.append(el('button', { disabled: it.disabled, onclick: () => { m.remove(); it.run(); } }, it.label, it.key ? el('span', { class: 'kbd' }, it.key) : null));
  }
  document.body.append(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, innerWidth - r.width - 6) + 'px'; m.style.top = Math.min(y, innerHeight - r.height - 6) + 'px';
  const off = e => { if (!m.contains(e.target)) { m.remove(); removeEventListener('pointerdown', off, true); } };
  setTimeout(() => addEventListener('pointerdown', off, true));
}

// ---------------------------------------------------------------- the UI registry
export const ui = {
  beforeFrame: [], afterRender: [], statusItems: [], pickPoint: null, ed: null,
  toolbar: null, left: null, right: null, statusBar: null, vp: null,
  refreshStatus() { for (const f of this.statusItems) f(); },
  init(ed) {
    this.ed = ed;
    this.toolbar = document.getElementById('toolbar'); this.left = document.getElementById('left'); this.right = document.getElementById('right');
    this.statusBar = document.getElementById('status'); this.vp = document.getElementById('viewportUI');
    buildToolbar(this, ed); buildStatus(this, ed);
    for (const f of this.inits) f(ed);
    addEventListener('keydown', e => onKey(e, this, ed));
    // buttons do not keep the keyboard focus (shortcuts keep going to the view)
    document.addEventListener('mousedown', e => { if (e.target.closest && e.target.closest('.tbtn, .tab, .chip, .btn, .pal-item, .ol-row')) e.preventDefault(); });
  },
  inits: [], keys: [], // keys: [{code, ctrl?, shift?, alt?, run(e), when?()}]
  tb: {}, textures: [], placeOpts: (() => { try { return JSON.parse(localStorage.getItem('wl_ed_place')) || { align: false, randomYaw: false }; } catch (e) { return { align: false, randomYaw: false }; } })(),
  status(msg, kind = '') { if (!this.statusMsg) return; this.statusMsg.textContent = msg || ''; this.statusMsg.style.color = kind === 'err' ? 'var(--err)' : kind === 'warn' ? 'var(--warn)' : ''; },
};
export const isTyping = e => { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); };
function onKey(e, U, ed) {
  if (e.code === 'F1' || (e.key === '?' && !isTyping(e))) { e.preventDefault(); showShortcuts(); return; }
  if (isTyping(e) && !(e.ctrlKey && (e.code === 'KeyS' || e.code === 'KeyZ' || e.code === 'KeyY') && !e.target.matches('.txt, textarea'))) return;
  if (ed.cam.flying && !e.ctrlKey) return; // W A S D Q E fly while the right button is held
  for (const k of U.keys) {
    if (k.code !== e.code || !!k.ctrl !== (e.ctrlKey || e.metaKey) || (k.shift !== undefined && !!k.shift !== e.shiftKey) || !!k.alt !== e.altKey) continue;
    if (k.when && !k.when()) continue;
    e.preventDefault(); k.run(e); return;
  }
}

// ---------------------------------------------------------------- toolbar
const PRESETS = [['Dawn', 5.75], ['Morning', 8], ['Noon', 12.5], ['Golden', 17.3], ['Blue hour', 18.4], ['Night', 23]];
const fmtHour = h => { const hh = Math.floor(h), mm = Math.floor((h - hh) * 60); return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0'); };
export function setHour(h) { time.hour = ((h % 24) + 24) % 24; updateSky(true); ui.tb.hour && (ui.tb.hour.value = time.hour, ui.tb.clock.textContent = fmtHour(time.hour)); }
function buildToolbar(U, ed) {
  const T = U.toolbar, tb = U.tb;
  T.append(el('div', { class: 'tb-brand', title: 'Wildlands world editor · map ' + ed.map }, el('b', {}, 'WL'), ' ' + ed.map));
  tb.tools = el('div', { class: 'tb-group' }); tb.space = el('div', { class: 'tb-group' }); tb.snap = el('div', { class: 'tb-group' });
  tb.history = el('div', { class: 'tb-group' });
  T.append(tb.history, el('div', { class: 'tb-sep' }), tb.tools, tb.space, tb.snap, el('div', { class: 'tb-sep' }));
  // camera mode
  const camG = el('div', { class: 'tb-group' });
  const bOrbit = el('button', { class: 'tbtn', title: 'Orbit camera — right-drag orbits, middle-drag pans, wheel zooms (Tab toggles)', onclick: () => ed.cam.setMode('orbit') }, icon('orbit'));
  const bFly = el('button', { class: 'tbtn', title: 'Fly camera — hold right button: mouse looks, W A S D / Q E move, wheel = speed (Tab toggles)', onclick: () => ed.cam.setMode('fly') }, icon('fly'));
  const speed = el('input', { class: 'num', type: 'number', min: 0.5, max: 600, step: 1, title: 'Fly speed (m/s) — wheel while flying changes it', onchange: e => { ed.cam.speed = Math.max(0.5, +e.target.value || 12); } });
  camG.append(bOrbit, bFly, speed);
  const syncCam = () => { bOrbit.classList.toggle('on', ed.cam.mode === 'orbit'); bFly.classList.toggle('on', ed.cam.mode === 'fly'); if (document.activeElement !== speed) speed.value = Math.round(ed.cam.speed); };
  const prevOnChange = ed.cam.onChange; ed.cam.onChange = () => { prevOnChange(); syncCam(); };
  syncCam();
  U.keys.push({ code: 'Tab', run: () => ed.cam.setMode(ed.cam.mode === 'orbit' ? 'fly' : 'orbit') });
  T.append(camG, el('div', { class: 'tb-sep' }));
  // time of day (frozen; set here)
  tb.hour = el('input', { type: 'range', min: 0, max: 24, step: 0.05, value: time.hour, style: { width: '84px' }, title: 'Time of day (the editor keeps it still)', oninput: e => setHour(+e.target.value) });
  tb.clock = el('span', { class: 'clock' }, fmtHour(time.hour));
  const pre = el('select', { class: 'sel', title: 'Time-of-day presets', onchange: e => { if (e.target.value) setHour(+e.target.value); e.target.value = ''; } },
    el('option', { value: '' }, '☀'), PRESETS.map(([n, h]) => el('option', { value: h }, `${n} (${fmtHour(h)})`)));
  T.append(el('div', { class: 'tb-time' }, tb.hour, tb.clock, pre));
  T.append(el('div', { class: 'tb-sep' }));
  const qs = el('select', { class: 'sel', title: 'Render quality (the editor stays responsive on High; Extreme is the full game look)', onchange: e => { setQuality(e.target.value, ed.world); } },
    Object.keys(QUALITY).map(k => el('option', { value: k, selected: Q.name === k }, k[0].toUpperCase() + k.slice(1))));
  T.append(qs);
  T.append(el('div', { class: 'tb-spacer' }));
  tb.right = el('div', { style: { display: 'flex', alignItems: 'center', gap: '4px' } });
  T.append(tb.right, el('button', { class: 'tbtn', title: 'Keyboard shortcuts (?)', onclick: showShortcuts }, icon('help')));
  U.keys.push({ code: 'BracketLeft', run: () => setHour(time.hour - 0.5) }, { code: 'BracketRight', run: () => setHour(time.hour + 0.5) });
  U.keys.push({ code: 'F3', run: () => toggleOverlay() });
}
function buildStatus(U, ed) {
  const S = U.statusBar, fps = el('span'), cam = el('span'), msg = el('span', { class: 'grow' });
  U.statusMsg = msg;
  S.append(msg, cam, fps);
  U.statusItems.push(() => {
    const p = ed.cam.state.p;
    cam.innerHTML = `camera <b>${p[0].toFixed(1)}, ${p[1].toFixed(1)}, ${p[2].toFixed(1)}</b> · ${ed.cam.mode}`;
    fps.innerHTML = `<b>${ed.fps}</b> fps · ${ed.frameMs.toFixed(1)} ms · ${Q.name}`;
  });
}

// ---------------------------------------------------------------- shortcut overlay
export const SHORTCUTS = [
  ['Tools', [['Select', 'Q'], ['Move', 'W'], ['Rotate', 'E'], ['Scale / stretch', 'R'], ['Local / world space', 'X'], ['Toggle snapping', 'G'], ['Invert snapping while dragging', 'Ctrl (hold)'], ['Constrain drag to an axis', 'gizmo handle'], ['Uniform scale', 'centre handle']]],
  ['Selection', [['Select', 'Click'], ['Add / remove', 'Shift+Click'], ['Box select', 'Drag on empty space'], ['Add box to selection', 'Shift+Drag'], ['Select all visible', 'Ctrl+A'], ['Deselect', 'Esc'], ['Select a group', 'Double-click a member'], ['Search the outliner', 'Ctrl+F']]],
  ['Placing (palette)', [['Place one', 'Click'], ['Turn', '[ / ] / Alt+Wheel'], ['Resize', '+ / −'], ['Stop placing', 'Esc / Right-click'], ['Drop in from the palette', 'Drag']]],
  ['Edit', [['Undo', 'Ctrl+Z'], ['Redo', 'Ctrl+Y / Ctrl+Shift+Z'], ['Duplicate', 'Ctrl+D'], ['Copy', 'Ctrl+C'], ['Paste', 'Ctrl+V'], ['Delete', 'Delete'], ['Drop to ground', 'End'], ['Align to surface', 'Shift+End'], ['Group', 'Ctrl+G'], ['Ungroup', 'Ctrl+Shift+G'], ['Rename', 'F2'], ['Hide / show', 'H'], ['Show all hidden', 'Alt+H'], ['Lock / unlock', 'L']]],
  ['Materials', [['Pick material (eyedropper)', 'I'], ['Paste material onto selection', 'Ctrl+Shift+V']]],
  ['Camera', [['Focus selection', 'F'], ['Orbit / fly', 'Tab'], ['Orbit', 'Right-drag'], ['Pan', 'Middle-drag / Shift+Right-drag'], ['Zoom', 'Wheel'], ['Fly', 'Hold right + W A S D, Q / E'], ['Fly faster / slower', 'Shift / Ctrl, wheel while flying']]],
  ['World', [['Save', 'Ctrl+S'], ['Time of day −/+', '[ / ]'], ['Performance overlay', 'F3'], ['This help', '?']]],
];
export function showShortcuts() {
  if (document.querySelector('.modal-bg')) return;
  const g = el('div', { class: 'keys' });
  for (const [h, list] of SHORTCUTS) { g.append(el('h4', {}, h)); for (const [a, k] of list) g.append(el('div', {}, el('span', {}, a), el('span', {}, k.split(' / ').map((x, i) => [i ? ' / ' : '', el('span', { class: 'kbd' }, x)])))); }
  modal('Keyboard shortcuts', g);
}
export { THREE, renderer };
