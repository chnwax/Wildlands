// Models from the owned Unity packs, read straight from the sorted library ModeleZPaczek/ (tools/packs-extract.mjs: one
// GLB per model, textures shared in ModeleZPaczek/_tekstury/). Which models the game uses, under which id, is listed in
// tools/packs.json (libraries -> assets { id, src: '<pack>/<model>' as in ModeleZPaczek/katalog.json, kind, category });
// only those are loaded. The folder is git-ignored (the pack licences cover the game, not the files in a public
// repository), so everything here is optional: without it loadPacks() resolves to null, nothing is queued and the
// generators keep their own procedural look.
// Each model's textures and materials are shared with every other model of its pack that uses them (one GPU texture
// per image, one material per Unity material and use). Builders either queue models (queuePack: laid out as instanced
// world objects, packScatter) or place them as instanced props of the world object being built (packProp: they move
// and hide with it in the World Builder), or take a model's parts for their own instanced sets (packParts).
// Crops and trees sway in the shared wind (terrain.js windPatch) and take a per-item tint.
import { THREE, Q, Scatter, withScatterMeta, gltfLoader, addProp } from './core.js';
import { addCatalog } from './world/catalog.js';
import { windPatch } from './terrain.js';
import { CAP } from './world/capture.js';

const LIB = new URL('../ModeleZPaczek/', import.meta.url), CFG = new URL('../tools/packs.json', import.meta.url);
const FIXED = new URL('../assets/packs-fix/', import.meta.url); // (corrected copies of models the library got wrong: tools/packs-fix.mjs)
let pending = null, packs = null;
export const packGlow = []; // (materials that light up at night: townkit.js updateGlow)
// how far each kind is drawn (a share of the quality's prop distance, Q.props: 260 m on High) and how much it sways
const KIND = { crop: { dist: 0.45, sway: 3.0, tint: true }, tree: { dist: 1.25, sway: 1.1, tint: true }, prop: { dist: 0.3 }, building: { dist: 1.0 }, lod: { dist: 1, sway: 0 } }; // (lod: parts handed to other systems — trees.js puts its own wind and shading on them)

const FIXES = {}; // (per-file corrections at load: none needed since assets/packs-fix)
const MISSING_TEX = { M_pipes: 'anime_japan/M_pipes_BaseMap.png' };
const await_tex = file => { const t = new THREE.TextureLoader().load(new URL('_tekstury/' + file, LIB).href); t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; t.name = file.split('/').pop(); return t; };
export function loadPacks() {
  if (pending) return pending;
  return (pending = (async () => {
    const [cfg, kat, fixed, kits] = await Promise.all([CFG, new URL('katalog.json', LIB), new URL('poprawki.json', FIXED), new URL('kits.json', FIXED)].map(u => fetch(u, { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null)));
    if (!cfg || !kat || !kat.modele) return null;
    const want = [];
    for (const L of Object.values(cfg.libraries)) if (L.runtime !== false) for (const a of L.assets) if (a.src && kat.modele[a.src]) want.push({ ...a, lib: L });
    // the props of the shop buildings' dressing kits (tools/packs-kits.mjs: as the pack's demo scene dresses them), each
    // under its library name
    if (kits) { const have = new Set(want.map(a => a.id)); for (const K of Object.values(kits)) for (const p of K.props) if (!have.has(p.src) && kat.modele[p.src]) { have.add(p.src); want.push({ id: p.src, kind: 'prop', category: 'kit', src: p.src }); } }
    const models = {}, mats = new Map(), texs = new Map(), files = new Map();
    const cacheWas = THREE.Cache.enabled; THREE.Cache.enabled = true; // (the shared images are fetched once)
    const loadFile = src => { if (!files.has(src)) files.set(src, gltfLoader.loadAsync((fixed && fixed[src] ? new URL(fixed[src], FIXED) : new URL(kat.modele[src].plik, LIB)).href).catch(e => { console.warn('packs: ' + src, e); return null; })); return files.get(src); };
    // a few files at a time
    let next = 0;
    await Promise.all(Array.from({ length: 12 }, async () => { for (;;) { const i = next++; if (i >= want.length) return; await loadFile(want[i].src); } }));
    THREE.Cache.enabled = cacheWas;
    // a Unity material shared by several models keeps its texture in only some of their files (the extraction found it
    // there): the others borrow it by the material's name, so which file loads first no longer decides the look
    // known slips in the library's files that a corrected copy does not cover (FIXES), and images the extraction missed
    // though they are in _tekstury (MISSING_TEX)
    for (const a of want) { const g = await loadFile(a.src); if (!g || FIXES[a.src] === undefined || g.userData.wlFixed) continue; g.userData.wlFixed = true; FIXES[a.src](g); }
    const named = new Map();
    for (const a of want) { const g = await loadFile(a.src); if (g) g.scene.traverse(o => { if (o.isMesh && o.material.map) { const k = a.src.split('/')[0] + '/' + o.material.name; if (!named.has(k)) named.set(k, o.material.map); } }); }
    for (const a of want) { const g = await loadFile(a.src); if (g) g.scene.traverse(o => { if (o.isMesh && !o.material.map) { const t = named.get(a.src.split('/')[0] + '/' + o.material.name); if (t) { o.material.map = t; o.material.needsUpdate = true; } } }); }
    for (const [mat, file] of Object.entries(MISSING_TEX)) { let t = null;
      for (const a of want) { const g = await loadFile(a.src); if (g) g.scene.traverse(o => { if (o.isMesh && o.material.name === mat && !o.material.map) { t = t || await_tex(file); o.material.map = t; o.material.needsUpdate = true; } }); } }
    for (const a of want) {
      const g = await loadFile(a.src); if (!g) continue;
      const pack = a.src.split('/')[0], kind = a.kind || 'prop', K = KIND[kind] || KIND.prop, parts = [];
      g.scene.traverse(o => { if (!o.isMesh) return;
        const geometry = o.geometry; if (!geometry.boundingSphere) geometry.computeBoundingSphere(); if (!geometry.boundingBox) geometry.computeBoundingBox();
        parts.push({ geometry, material: material(o.material, pack, kind, a.sway ?? K.sway, mats, texs), castShadow: kind !== 'crop' || geometry.boundingBox.max.y > 0.8, tint: (a.tint ?? K.tint) || undefined }); });
      if (parts.length) models[a.id] = { kind, category: a.category, parts, dims: kat.modele[a.src].wymiary_m || [1, 1, 1], src: a.src };
    }
    for (const [id, m] of Object.entries(models)) if (m.kind !== 'lod' && m.category !== 'kit') addCatalog(id, m.kind === 'tree' ? 'tree' : m.kind === 'building' ? 'building' : 'prop', () => ({ parts: m.parts }));
    console.info(`packs: ${Object.keys(models).length} models from ModeleZPaczek (${files.size} files, ${texs.size} textures, ${mats.size} materials)`);
    for (const a of want) if (a.category === 'kit' && models[a.id]) models[a.id].kitOnly = true;
    return (packs = { models, kits: kits || {}, has: id => !!models[id], dims: id => models[id] && models[id].dims });
  })().catch(e => { console.warn('packs:', e); return null; }));
}
export const packsReady = () => packs;

// one shared material per pack material and use: the painted look of the town (matte, the pack's own colours and
// textures kept), alpha-tested foliage, glass left see-through; crops and trees get the wind. One texture per image.
function material(src, pack, kind, sway, cache, texs) {
  const wl = src.userData?.wl || {}, sw = sway && wl.kind !== 'glass' ? sway : 0, key = pack + '/' + src.name + '|' + kind + '|' + sw;
  if (cache.has(key)) return cache.get(key);
  const m = src.clone();
  m.name = 'pack:' + src.name;
  if (m.map) { const tk = pack + '/' + (m.map.name || m.map.uuid); if (texs.has(tk)) m.map = texs.get(tk); else { m.map.anisotropy = 4; m.map.colorSpace = THREE.SRGBColorSpace; texs.set(tk, m.map); } }
  m.roughness = Math.max(m.roughness, wl.kind === 'glass' ? 0.1 : 0.75); m.metalness = Math.min(m.metalness, 0.2);
  m.envMapIntensity = 0.6;
  if (m.alphaTest > 0) { m.transparent = false; m.alphaToCoverage = false; m.side = THREE.DoubleSide; m.shadowSide = THREE.DoubleSide; }
  if (wl.kind === 'glass') { m.transparent = true; m.depthWrite = false; }
  if (/mirror/i.test(src.name)) { m.metalness = 0.85; m.roughness = 0.1; m.envMapIntensity = 1.2; } // (curve mirrors: a real reflection)
  // light sources glow at night (townkit.js updateGlow drives packGlow with the town's other lamps): the packs' emissive
  // lamp glass, paper lanterns, the lit fronts of vending machines
  if (/emissive/i.test(src.name)) { m.emissive = new THREE.Color(0xfff0d6); m.userData.glow = 2.2; packGlow.push(m); }
  else if (/lantern/i.test(src.name) && m.map) { m.emissive = new THREE.Color(0xffd9a0); m.emissiveMap = m.map; m.userData.glow = /^M_lanterns/.test(src.name) ? 1.6 : 0.7; packGlow.push(m); } // (the paper lanterns brighter than lit stone)
  else if (/drinks|bottles/i.test(src.name)) { m.emissive = new THREE.Color(0xffffff); if (m.map) m.emissiveMap = m.map; m.userData.glow = 0.25; packGlow.push(m); } // (the stocked display only)
  if (/^M_vendingmachine/i.test(src.name)) m.color.multiplyScalar(0.82); // (the white bodies blew out into bloom in full sun)
  if (sw) windPatch(m, 'packWind' + sw.toFixed(2) + (m.alphaTest > 0 ? 'a' : '') + (m.transparent ? 't' : ''), sw);
  cache.set(key, m);
  return m;
}
// a model's parts ({ geometry, material, castShadow, tint }) for a builder's own instanced sets (null when not loaded)
export const packParts = id => packs && packs.models[id] ? packs.models[id].parts : null;

// models placed while the map is built (builders that know nothing of the libraries queue them; the map lays them out)
export const packQueue = new Map();
export function queuePack(id, x, y, z, r = 0, o = {}) {
  if (!packs || !packs.models[id] || CAP.scratch) return false;
  if (!packQueue.has(id)) packQueue.set(id, []);
  packQueue.get(id).push({ x, y, z, r, s: 1, ...o });
  return true;
}
// a model as instanced props of the world object being built (core.js addProp): it belongs to that object — moved, hidden
// and deleted with it in the World Builder. s: uniform scale or [sx, sy, sz]; tilt: [about x, about z] after the yaw.
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
export function packProp(id, x, y, z, r = 0, s = 1, tilt = null) {
  const m = packs && packs.models[id]; if (!m || CAP.scratch) return null; // (a scratch build is thrown away: its props would stay behind)
  _e.set(tilt ? tilt[0] : 0, r, tilt ? tilt[1] : 0); _q.setFromEuler(_e);
  if (Array.isArray(s)) _s.set(s[0], s[1], s[2]); else _s.setScalar(s);
  _m.compose(_p.set(x, y, z), _q, _s);
  // (small things are drawn near only: an AC unit, a meter, a pot or a mailbox covers a pixel or two past ~110 m; things
  // up to 2.5 m to ~220 m; larger ones as far as the frustum and the distance culler let them)
  const k = Array.isArray(s) ? Math.max(...s) : s, size = Math.max(...m.dims) * k, near = size < 1.2 ? 110 : size < 2.5 ? 220 : 0;
  return addProp('pack:' + id, m.parts.map(p => ({ geometry: p.geometry, material: p.material, matrix: _m, castShadow: p.castShadow !== false && m.dims[1] * (Array.isArray(s) ? s[1] : s) > 0.5, near })));
}
// a building's dressing kit (packs-kits.mjs) as props of the object being built: the building stands at (x, y, z) turned
// r, scaled s ([sx, sy, sz]); each prop goes where the kit puts it in the building's frame, turned with it, at su x its
// own size (a stretched shop front does not stretch its stools). Returns how many were placed (0: no kit).
const _kr = new THREE.Matrix4(), _kb = new THREE.Matrix4(), _kq = new THREE.Quaternion(), _ky = new THREE.Quaternion(), _kY = new THREE.Vector3(0, 1, 0);
// opt.skip: props left out (a shop's own sign goes where the kit's stood: their world positions and widths in opt.signs);
// opt.where(src, x, y, z): also left out when true (x, y, z: where the kit puts it in the building's own units — a shop
// furnished anew leaves out the kit's things inside); opt.onProp(src, matrix): each placed (a collider made of them)
export function packKit(src, x, y, z, r, s, su = 1, opt = {}) {
  const K = packs && packs.kits[src]; if (!K || CAP.scratch) return 0;
  _kb.compose(_p.set(x, y, z), _ky.setFromAxisAngle(_kY, r), _s.set(s[0], s[1], s[2]));
  let n = 0;
  for (const p of K.props) { const m = packs.models[p.src]; if (!m) continue;
    _kr.fromArray(p.m).decompose(_p, _kq, _s); if (opt.where && opt.where(p.src, _p.x, _p.y, _p.z)) continue; _p.applyMatrix4(_kb); _kq.premultiply(_ky); _s.multiplyScalar(su);
    if (opt.skip && opt.skip.test(p.src)) { if (opt.signs) opt.signs.push({ p: _p.clone(), w: m.dims[0] * _s.x, h: m.dims[1] * _s.y, src: p.src }); continue; }
    _m.compose(_p, _kq, _s);
    const big = Math.max(...m.dims) * su; // (small things drawn near only, and only the larger ones cast shadows)
    addProp('pack:' + p.src, m.parts.map(q => ({ geometry: q.geometry, material: q.material, matrix: _m, castShadow: q.castShadow !== false && m.dims[1] * su > 1.0, near: big < 1.6 ? 70 : 170 }))); n++;
    if (opt.onProp) opt.onProp(p.src, _m);
    if (/shelves_store$/.test(p.src)) stockShelf(_sh.copy(_m), x * 7 + z * 13 + n); }
  return n;
}
// a pack model placed as one prop with some of its materials swapped (a shop building's walls in another colour)
export function packPropMats(id, M, swap) {
  const m = packs && packs.models[id]; if (!m || CAP.scratch) return null;
  return addProp('pack:' + id, m.parts.map(q => ({ geometry: q.geometry, material: swap(q.material), matrix: M, castShadow: q.castShadow !== false })));
}
// a store rack stocked shelf by shelf (its own noise: no draws of anyone's rng): drinks in runs of one kind, boxed goods
// on the top shelf. Shelf heights and length as measured on the pack's rack (model units).
const _sh = new THREE.Matrix4(), _sl = new THREE.Matrix4(), _sm2 = new THREE.Matrix4();
const SHELF_Y = [0.14, 0.58, 1.02, 1.46, 2.0], GOODS = ['anime_japan/bottle_drink_01', 'anime_japan/bottle_drink_02', 'anime_japan/bottle_drink_03', 'anime_japan/bottle_drink_04'];
export function stockShelf(M, seed) {
  const h = k => { const v = Math.sin((seed + k) * 12.9898) * 43758.5453; return v - Math.floor(v); };
  let k = 0;
  SHELF_Y.forEach((y, li) => {
    for (let u = -1.66; u <= 1.66;) {
      if (li === 4) { const id = 'anime_japan/carton_03', m = packs.models[id]; if (m) put(M, m, id, u, y, 0, (h(k++) - 0.5) * 0.3, 0.5); u += 0.32 + h(k++) * 0.12; continue; }
      const id = GOODS[Math.floor(h(k++) * GOODS.length)], m = packs.models[id], run = 3 + Math.floor(h(k++) * 5);
      for (let r = 0; r < run && u <= 1.66; r++, u += 0.13) if (m) for (const v of [-0.18, 0.02]) put(M, m, id, u, y, v, h(k++) * 6.28, id.endsWith('04') ? 0.75 : 0.8);
      u += 0.06;
    }
  });
}
function put(M, m, id, u, y, v, r, sc) {
  _sl.compose(_p.set(u, y, v), _q.setFromAxisAngle(_kY, r), _s.setScalar(sc)); _sm2.multiplyMatrices(M, _sl);
  addProp('pack:' + id + ':shelf', m.parts.map(q => ({ geometry: q.geometry, material: q.material, matrix: _sm2, castShadow: false, near: 45 })));
}
// a model's triangles placed by matrix M, appended to out (flat x, y, z per vertex: a compound collider's input)
const _tv = new THREE.Vector3();
export function packTris(id, M, out, skipMat = null) {
  const m = packs && packs.models[id]; if (!m) return out;
  for (const q of m.parts) { if (skipMat && skipMat(q.material)) continue; const g = q.geometry, pos = g.attributes.position, idx = g.index, n = idx ? idx.count : pos.count;
    for (let i = 0; i < n; i++) { _tv.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(M); out.push(_tv.x, _tv.y, _tv.z); } }
  return out;
}
export const packKitHas = (src, re) => !!(packs && packs.kits[src] && packs.kits[src].props.some(p => re.test(p.src)));
// items [{ x, y, z, r, s?, sx?, sy?, sz?, c? }] of one model -> an instanced world object (prefab = the model id)
export function packScatter(P, id, items, { dist = null, shadow = true, category = null } = {}) {
  const m = P && P.models[id];
  if (!m || !items.length) return null;
  // (low crops — strawberries, seedlings — only near: past that the mulch rows carry the field's look)
  const K = KIND[m.kind] || KIND.prop, f = m.kind === 'crop' && m.dims[1] < 0.5 ? 0.55 : 1, D = () => dist ?? Q.props * K.dist * f + 10;
  for (const it of items) it.s = it.s || 1;
  const parts = m.parts.map(p => ({ ...p, castShadow: shadow && p.castShadow }));
  return withScatterMeta({ prefab: id, category: category || (m.kind === 'tree' ? 'tree' : m.kind === 'building' ? 'building' : 'prop') },
    () => new Scatter(items, [{ dist: D, parts }], m.kind === 'tree' || m.kind === 'building' ? 96 : 48));
}
// everything queued, laid out (called once the map is built)
export function flushPacks(P, opt = {}) {
  let n = 0;
  if (P) for (const [id, items] of packQueue) if (packScatter(P, id, items, opt)) n += items.length;
  packQueue.clear();
  return n;
}
