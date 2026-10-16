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

const LIB = new URL('../ModeleZPaczek/', import.meta.url), CFG = new URL('../tools/packs.json', import.meta.url);
let pending = null, packs = null;
// how far each kind is drawn (a share of the quality's prop distance, Q.props: 260 m on High) and how much it sways
const KIND = { crop: { dist: 0.45, sway: 3.0, tint: true }, tree: { dist: 1.25, sway: 1.1, tint: true }, prop: { dist: 0.3 }, building: { dist: 1.0 }, lod: { dist: 1, sway: 0 } }; // (lod: parts handed to other systems — trees.js puts its own wind and shading on them)

export function loadPacks() {
  if (pending) return pending;
  return (pending = (async () => {
    const [cfg, kat] = await Promise.all([CFG, new URL('katalog.json', LIB)].map(u => fetch(u, { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null)));
    if (!cfg || !kat || !kat.modele) return null;
    const want = [];
    for (const L of Object.values(cfg.libraries)) if (L.runtime !== false) for (const a of L.assets) if (a.src && kat.modele[a.src]) want.push({ ...a, lib: L });
    const models = {}, mats = new Map(), texs = new Map(), files = new Map();
    const cacheWas = THREE.Cache.enabled; THREE.Cache.enabled = true; // (the shared images are fetched once)
    const loadFile = src => { if (!files.has(src)) files.set(src, gltfLoader.loadAsync(new URL(kat.modele[src].plik, LIB).href).catch(e => { console.warn('packs: ' + src, e); return null; })); return files.get(src); };
    // a few files at a time
    let next = 0;
    await Promise.all(Array.from({ length: 12 }, async () => { for (;;) { const i = next++; if (i >= want.length) return; await loadFile(want[i].src); } }));
    THREE.Cache.enabled = cacheWas;
    for (const a of want) {
      const g = await loadFile(a.src); if (!g) continue;
      const pack = a.src.split('/')[0], kind = a.kind || 'prop', K = KIND[kind] || KIND.prop, parts = [];
      g.scene.traverse(o => { if (!o.isMesh) return;
        const geometry = o.geometry; if (!geometry.boundingSphere) geometry.computeBoundingSphere(); if (!geometry.boundingBox) geometry.computeBoundingBox();
        parts.push({ geometry, material: material(o.material, pack, kind, a.sway ?? K.sway, mats, texs), castShadow: kind !== 'crop' || geometry.boundingBox.max.y > 0.8, tint: (a.tint ?? K.tint) || undefined }); });
      if (parts.length) models[a.id] = { kind, category: a.category, parts, dims: kat.modele[a.src].wymiary_m || [1, 1, 1], src: a.src };
    }
    for (const [id, m] of Object.entries(models)) if (m.kind !== 'lod') addCatalog(id, m.kind === 'tree' ? 'tree' : m.kind === 'building' ? 'building' : 'prop', () => ({ parts: m.parts }));
    console.info(`packs: ${Object.keys(models).length} models from ModeleZPaczek (${files.size} files, ${texs.size} textures, ${mats.size} materials)`);
    return (packs = { models, has: id => !!models[id], dims: id => models[id] && models[id].dims });
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
  if (sw) windPatch(m, 'packWind' + sw.toFixed(2) + (m.alphaTest > 0 ? 'a' : '') + (m.transparent ? 't' : ''), sw);
  cache.set(key, m);
  return m;
}
// a model's parts ({ geometry, material, castShadow, tint }) for a builder's own instanced sets (null when not loaded)
export const packParts = id => packs && packs.models[id] ? packs.models[id].parts : null;

// models placed while the map is built (builders that know nothing of the libraries queue them; the map lays them out)
export const packQueue = new Map();
export function queuePack(id, x, y, z, r = 0, o = {}) {
  if (!packs || !packs.models[id]) return false;
  if (!packQueue.has(id)) packQueue.set(id, []);
  packQueue.get(id).push({ x, y, z, r, s: 1, ...o });
  return true;
}
// a model as instanced props of the world object being built (core.js addProp): it belongs to that object — moved, hidden
// and deleted with it in the World Builder. s: uniform scale or [sx, sy, sz]; tilt: [about x, about z] after the yaw.
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
export function packProp(id, x, y, z, r = 0, s = 1, tilt = null) {
  const m = packs && packs.models[id]; if (!m) return null;
  _e.set(tilt ? tilt[0] : 0, r, tilt ? tilt[1] : 0); _q.setFromEuler(_e);
  if (Array.isArray(s)) _s.set(s[0], s[1], s[2]); else _s.setScalar(s);
  _m.compose(_p.set(x, y, z), _q, _s);
  return addProp('pack:' + id, m.parts.map(p => ({ geometry: p.geometry, material: p.material, matrix: _m, castShadow: p.castShadow !== false && m.dims[1] * (Array.isArray(s) ? s[1] : s) > 0.5 })));
}
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
