// The model catalogue: everything the world builder can place, also what the generated world itself does not contain —
// every variant of every tree species, every car model, every prop of the clutter pack. Each entry is made on first use
// (the editor's palette, or an edit placing it in the game) as a one-item instanced set in the shape the world layer
// already builds objects from (world/layer.js), so a catalogue model is placed, moved, recoloured and saved like any
// other instanced object; it is only never drawn in the world itself.
import { THREE } from '../core.js';

const WHITE = new THREE.Color(1, 1, 1);
const entries = new Map(); // prefab -> { category, make, set }
// make() -> { parts: [{ geometry, material, tint?, castShadow?, depth?, receiveShadow?, sway? }], item?: { s, c, ... } }
export function addCatalog(prefab, category, make) { if (!entries.has(prefab)) entries.set(prefab, { category, make, set: null }); }
export const catalogPrefabs = () => [...entries.entries()].map(([name, e]) => ({ name, category: e.category }));
export const inCatalog = prefab => entries.has(prefab);
export function catalogSet(prefab) {
  const e = entries.get(prefab); if (!e) return null;
  if (e.set) return e.set;
  const { parts, item = {} } = e.make();
  const it = { x: 0, y: 0, z: 0, s: 1, r: 0, ...item };
  const col = new Map();
  for (const p of parts) if (p.tint && !col.has(p.tint)) { const c = (p.tint === true ? it.c : it[p.tint]) || WHITE; col.set(p.tint, Float32Array.of(c.r, c.g, c.b)); }
  e.set = { meta: { prefab, category: e.category, catalog: true }, items: [it], lods: [{ dist: () => Infinity, parts }], col, wArea: ['catalog'], wNum: Int32Array.of(1), setItemMatrix() {} };
  return e.set;
}
