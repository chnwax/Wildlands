// Models from the owned Unity packs, baked by tools/packs-import.mjs into assets/packs/<library>.glb (one node per
// model, named by its id, e.g. farm_corn_l). The folder is git-ignored (the pack licences cover the game, not the
// files in a public repository), so everything here is optional: without the libraries loadPacks() resolves to null,
// nothing is queued and the generators keep their own procedural look.
// Builders queue models while the map is built (queuePack); the map lays each model's list out as one instanced world
// object (packScatter), editable in the World Builder like the other instanced props, and every model is in the
// builder's catalogue. Crops and trees sway in the shared wind (terrain.js windPatch) and take a per-item tint.
import { THREE, Q, Scatter, withScatterMeta, gltfLoader } from './core.js';
import { addCatalog } from './world/catalog.js';
import { windPatch } from './terrain.js';

const DIR = new URL('../assets/packs/', import.meta.url);
let pending = null, packs = null;
// how far each kind is drawn (a share of the quality's prop distance, Q.props: 260 m on High) and how much it sways
const KIND = { crop: { dist: 0.45, sway: 3.0, tint: true }, tree: { dist: 1.25, sway: 1.1, tint: true }, prop: { dist: 0.3 }, building: { dist: 1.0 } };

export function loadPacks() {
  if (pending) return pending;
  return (pending = (async () => {
    const mf = await fetch(new URL('manifest.json', DIR), { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null);
    if (!mf || !mf.libraries) return null;
    const models = {}, mats = new Map();
    for (const [lib, L] of Object.entries(mf.libraries)) {
      if (L.runtime === false) continue; // (built for a later stage, not drawn yet)
      let g = null;
      try { g = await gltfLoader.loadAsync(new URL(L.file + '?v=' + L.hash, DIR).href); } catch (e) { console.warn('packs: ' + lib + ' not loaded', e); continue; }
      for (const node of g.scene.children) {
        const kind = node.userData.kind || 'prop', K = KIND[kind] || KIND.prop, parts = [];
        node.traverse(o => { if (!o.isMesh) return;
          const geometry = o.geometry; geometry.computeBoundingSphere(); geometry.computeBoundingBox();
          parts.push({ geometry, material: material(o.material, kind, K, mats), castShadow: kind !== 'crop' || geometry.boundingBox.max.y > 0.8, tint: K.tint || undefined }); });
        if (parts.length) models[node.name] = { kind, parts, dims: node.userData.dims || [1, 1, 1], lib };
      }
    }
    for (const [id, m] of Object.entries(models)) addCatalog(id, m.kind === 'tree' ? 'tree' : m.kind === 'building' ? 'building' : 'prop', () => ({ parts: m.parts }));
    return (packs = { models, has: id => !!models[id], dims: id => models[id] && models[id].dims });
  })().catch(e => { console.warn('packs:', e); return null; }));
}
export const packsReady = () => packs;

// one shared material per source material and use: the painted look of the town (matte, the pack's colours kept),
// alpha-tested foliage, glass left see-through; crops and trees get the wind
function material(src, kind, K, cache) {
  const sway = K.sway && src.userData?.wl?.kind !== 'glass' ? K.sway : 0, key = src.name + '|' + kind + '|' + sway;
  if (cache.has(key)) return cache.get(key);
  const m = src.clone(), wl = src.userData?.wl || {};
  m.name = 'pack:' + src.name;
  m.roughness = Math.max(m.roughness, wl.kind === 'glass' ? 0.1 : 0.75); m.metalness = Math.min(m.metalness, 0.2);
  m.envMapIntensity = 0.6;
  if (m.map) { m.map.anisotropy = 4; m.map.colorSpace = THREE.SRGBColorSpace; }
  if (m.alphaTest > 0) { m.transparent = false; m.alphaToCoverage = false; m.side = THREE.DoubleSide; m.shadowSide = THREE.DoubleSide; }
  if (wl.kind === 'glass') { m.transparent = true; m.depthWrite = false; }
  if (sway) windPatch(m, 'packWind' + sway.toFixed(2) + (m.alphaTest > 0 ? 'a' : '') + (m.transparent ? 't' : ''), sway);
  cache.set(key, m);
  return m;
}

// models placed while the map is built (builders that know nothing of the libraries queue them; the map lays them out)
export const packQueue = new Map();
export function queuePack(id, x, y, z, r = 0, o = {}) {
  if (!packs || !packs.models[id]) return false;
  if (!packQueue.has(id)) packQueue.set(id, []);
  packQueue.get(id).push({ x, y, z, r, s: 1, ...o });
  return true;
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
