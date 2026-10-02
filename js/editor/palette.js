// Asset palette: every prefab of the map (all generated object types — buildings, rocks, trees, benches, lamps,
// fences, props — plus basic primitives) with search, categories and rendered thumbnails. Click an item to place it
// (a ghost follows the cursor; every click places one, Esc / right-click stops) or drag it into the viewport.
import { THREE, renderer } from '../core.js';
import { el, icon, ui } from './ui.js';
import { CAT_COLOR } from './outliner.js';
import { PRIMITIVES, labelOf } from '../world/layer.js';

const CATS = ['all', 'building', 'structure', 'furniture', 'lighting', 'fence', 'play', 'sign', 'vegetation', 'rock', 'prop', 'vehicle', 'primitive'];
export function buildPalette(E, pane) {
  const L = E.L;
  const items = prefabList(L);
  let cat = 'all', q = '';
  const search = el('input', { class: 'txt', placeholder: `Search ${items.length} prefabs…`, spellcheck: false });
  const chips = el('div', { class: 'chips' });
  const grid = el('div', { class: 'pal-grid' }), scroll = el('div', { class: 'scroll' }, grid);
  const opt = (k, label, title) => el('label', { class: 'note', title, style: { display: 'flex', alignItems: 'center', gap: '4px' } }, el('input', { type: 'checkbox', checked: ui.placeOpts[k], onchange: e => { ui.placeOpts[k] = e.target.checked; try { localStorage.setItem('wl_ed_place', JSON.stringify(ui.placeOpts)); } catch (x) {} } }), label);
  const opts = el('div', { class: 'ol-foot' }, opt('align', 'Align to surface', 'Tilt placed objects to the slope / face under the cursor'), opt('randomYaw', 'Random turn', 'Turn each placed object to a random heading'));
  pane.append(el('div', { class: 'ph' }, el('div', { class: 'search' }, icon('search'), search)), chips, scroll, opts);
  const counts = {}; for (const it of items) counts[it.category] = (counts[it.category] || 0) + 1;
  const CL = { all: 'All', building: 'Buildings', structure: 'Structures', furniture: 'Furniture', lighting: 'Lighting', fence: 'Fences', play: 'Play', sign: 'Signs', vegetation: 'Plants', rock: 'Rocks', prop: 'Props', vehicle: 'Vehicles', primitive: 'Primitives' };
  for (const c of CATS) if (c === 'all' || counts[c]) chips.append(el('button', { class: 'chip' + (c === cat ? ' on' : ''), onclick: e => { cat = c; chips.querySelectorAll('.chip').forEach(b => b.classList.toggle('on', b === e.target)); draw(); } }, CL[c] + (c === 'all' ? '' : ` ${counts[c]}`)));
  search.addEventListener('input', () => { q = search.value.trim().toLowerCase(); draw(); });
  search.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') search.blur(); });
  const cards = new Map();
  function card(it) {
    let c = cards.get(it.name); if (c) return c;
    const th = el('div', { class: 'th' }, it.category === 'primitive' ? it.label : '');
    c = el('div', { class: 'pal-item', draggable: true, title: `${it.label} — ${it.name}\n${it.count ? it.count + ' in the world' : it.category}${it.size ? '\n' + it.size.map(v => v.toFixed(1)).join(' × ') + ' m' : ''}\nClick to place, or drag into the view` },
      th, el('div', { class: 'lb' }, it.label, el('small', {}, it.size ? it.size.map(v => v < 10 ? v.toFixed(1) : Math.round(v)).join('×') + ' m' : it.category)));
    c.style.borderLeft = `3px solid ${CAT_COLOR[it.category] || '#555'}`;
    c.addEventListener('click', () => { if (E.placing && E.placing.prefab === it.name) E.disarm(); else E.arm(it.name); });
    c.addEventListener('dragstart', e => { e.dataTransfer.setData('text/wl-prefab', it.name); e.dataTransfer.effectAllowed = 'copy'; E.arm(it.name, true); });
    c.addEventListener('dragend', () => { if (E.placing && E.placing.prefab === it.name) E.disarm(true); });
    c._th = th; cards.set(it.name, c); thumbs.want(it, th);
    return c;
  }
  function draw() {
    const shown = items.filter(it => (cat === 'all' || it.category === cat) && (!q || it.name.includes(q) || it.label.toLowerCase().includes(q) || it.category.includes(q)));
    grid.replaceChildren(...shown.map(card));
    if (!shown.length) grid.append(el('div', { class: 'hint', style: { gridColumn: '1/-1' } }, 'No prefab matches.'));
    mark();
  }
  const mark = () => { for (const [n, c] of cards) c.classList.toggle('armed', !!(E.placing && E.placing.prefab === n)); };
  E.on(t => { if (t === 'placing') mark(); });
  const thumbs = new Thumbs(L);
  draw();
  return { show: () => thumbs.run() };
}
export function prefabList(L) {
  const m = new Map();
  for (const e of L.geo) { const p = m.get(e.prefab) || { name: e.prefab, label: labelOf(e.prefab), category: e.category, count: 0 }; p.count++; m.set(e.prefab, p); }
  for (const [P, sets] of L.scatterPrefabs) {
    const s0 = sets[0], field = s0.meta.field; let n = 0, nf = 0; for (const s of sets) for (const it of s.items) (it.field || field ? nf++ : n++);
    m.set(P, { name: P, label: labelOf(P), category: (L.get(L.templateOf(P)) || {}).category || 'vegetation', count: n + nf });
  }
  for (const [k, d] of Object.entries(PRIMITIVES)) m.set(k, { name: k, label: d.label, category: 'primitive', count: 0 });
  for (const p of m.values()) if (p.category !== 'primitive') { const t = L.get(L.templateOf(p.name)); if (t) { const s = L.localBounds(t).getSize(new THREE.Vector3()).multiply(new THREE.Vector3().fromArray(t.base.s)); p.size = s.toArray(); p.template = t.id; } }
  const order = c => CATS.indexOf(c) < 0 ? 99 : CATS.indexOf(c);
  return [...m.values()].sort((a, b) => order(a.category) - order(b.category) || (a.label < b.label ? -1 : 1));
}
// thumbnails rendered from each prefab's template (cached in localStorage per template id)
class Thumbs {
  constructor(L) {
    this.L = L; this.queue = []; this.busy = false; this.size = 112;
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0x0e1014);
    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a3226, 1.6));
    const d = new THREE.DirectionalLight(0xffffff, 2.6); d.position.set(3, 5, 4); this.scene.add(d, d.target);
    this.cam = new THREE.PerspectiveCamera(30, 1, 0.05, 2000); this.cam.layers.enableAll(); // (world parts live on layers 1 and 3 too)
    this.rt = new THREE.WebGLRenderTarget(this.size, this.size, { samples: 4 }); this.rt.texture.colorSpace = THREE.SRGBColorSpace;
    this.cv = document.createElement('canvas'); this.cv.width = this.cv.height = this.size;
  }
  key(it) { return 'wl_thumb4_' + it.name + '_' + (it.template || 'p'); }
  want(it, th) {
    let url = null; try { url = localStorage.getItem(this.key(it)); } catch (e) {}
    if (url) { th.style.backgroundImage = `url(${url})`; th.textContent = ''; return; }
    this.queue.push([it, th]); this.run();
  }
  run() { if (this.busy || !this.queue.length) return; this.busy = true; const step = () => { const job = this.queue.shift(); if (!job) { this.busy = false; return; } try { this.render(...job); } catch (e) { console.warn('thumbnail', job[0].name, e); } setTimeout(() => requestAnimationFrame(step), 30); }; requestAnimationFrame(step); }
  render(it, th) {
    let group;
    if (it.category === 'primitive') { const g = PRIMITIVES[it.name].geo(); group = new THREE.Group(); group.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xc9c4ba, roughness: 0.7 }))); }
    else { const t = this.L.get(it.template); if (!t) return; group = this.L.buildParts(t, false).group; group.scale.fromArray(t.base.s); }
    group.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
    this.scene.add(group); group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(group), c = box.getCenter(new THREE.Vector3()), r = Math.max(0.3, box.getSize(new THREE.Vector3()).length() / 2);
    const dir = new THREE.Vector3(0.75, 0.55, 1).normalize(), dist = r / Math.sin(this.cam.fov * Math.PI / 360) * 0.98;
    this.cam.position.copy(c).addScaledVector(dir, dist); this.cam.near = dist / 50; this.cam.far = dist * 4; this.cam.updateProjectionMatrix(); this.cam.lookAt(c);
    const prevRT = renderer.getRenderTarget(), tm = renderer.toneMapping, cc = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha();
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.setRenderTarget(this.rt); renderer.setClearColor(0x0e1014, 1); renderer.clear(); renderer.render(this.scene, this.cam);
    const px = new Uint8Array(this.size * this.size * 4); renderer.readRenderTargetPixels(this.rt, 0, 0, this.size, this.size, px);
    renderer.setRenderTarget(prevRT); renderer.toneMapping = tm; renderer.setClearColor(cc, ca);
    this.scene.remove(group);
    const g = this.cv.getContext('2d'), img = g.createImageData(this.size, this.size);
    for (let y = 0; y < this.size; y++) img.data.set(px.subarray((this.size - 1 - y) * this.size * 4, (this.size - y) * this.size * 4), y * this.size * 4);
    g.putImageData(img, 0, 0);
    const url = this.cv.toDataURL('image/jpeg', 0.82);
    th.style.backgroundImage = `url(${url})`; th.textContent = '';
    try { localStorage.setItem(this.key(it), url); } catch (e) {}
  }
}
