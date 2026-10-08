// The small props of everyday life imported from the Urban Clutter pack (tools/clutter-import.mjs): garden tools, a
// rain barrel, tyres, planks, cardboard boxes, refuse sacks, brick edging, a skip, site pipes and barriers. Loaded once;
// each prop is one vertex-coloured geometry (one shared material) for instancing: clutterScatter() lays a list of them
// out as an instanced world object (editable in the World Builder like the other instanced props).
import { THREE, Scatter, withScatterMeta } from './core.js';

const DIR = new URL('../assets/models/clutter/', import.meta.url);
let pack = null;
export async function loadClutter() {
  if (pack) return pack;
  const meta = await fetch(new URL('clutter.json', DIR), { cache: 'no-cache' }).then(r => r.json());
  const bin = await fetch(new URL('clutter.bin?v=' + meta.hash, DIR)).then(r => r.arrayBuffer()); // (versioned: never a stale copy)
  // painted like the town's kit: soft, matte, the pack's flat colours kept
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 });
  material.name = 'clutter';
  const geos = {}, q = 1 / meta.scale;
  for (const [name, p] of Object.entries(meta.props)) {
    const pos = new Int16Array(bin, p.pos, p.n * 3), nor = new Int8Array(bin, p.nor, p.n * 4), col = new Uint8Array(bin, p.col, p.n * 4);
    const P = new Float32Array(p.n * 3), N = new Float32Array(p.n * 3), C = new Float32Array(p.n * 3);
    for (let i = 0; i < p.n; i++) for (let k = 0; k < 3; k++) { P[i * 3 + k] = pos[i * 3 + k] * q; N[i * 3 + k] = nor[i * 4 + k] / 127; C[i * 3 + k] = col[i * 4 + k] / 255; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(N, 3)); g.setAttribute('color', new THREE.BufferAttribute(C, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(p.n * 2), 2));
    g.setIndex(new THREE.BufferAttribute(new Uint16Array(bin, p.idx, p.i).slice(), 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    geos[name] = g;
  }
  return (pack = { meta, geos, material, size: name => meta.props[name] && meta.props[name].size });
}
// props placed while the town is built (builders that know nothing of the pack queue them; the town lays them out)
export const clutterQueue = new Map();
export function queueClutter(name, x, y, z, r = 0, o = {}) { if (!clutterQueue.has(name)) clutterQueue.set(name, []); clutterQueue.get(name).push({ x, y, z, r, s: 1, ...o }); }
// items: [{ x, y, z, r, s?, sx?, sy?, sz? }] of one prop -> an instanced world object (prefab clutter name), drawn within
// dist metres
export function clutterScatter(P, name, items, { dist = 70, shadow = true, category = 'prop' } = {}) {
  if (!items.length || !P.geos[name]) return null;
  for (const it of items) it.s = it.s || 1;
  return withScatterMeta({ prefab: name, category }, () => new Scatter(items, [{ dist: () => dist, parts: [{ geometry: P.geos[name], material: P.material, castShadow: shadow }] }], 64));
}
