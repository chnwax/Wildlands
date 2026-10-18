// Distance culling of the loose things the frustum alone lets through: every scene mesh that is not a merged map bucket
// or an instanced set with its own levels (Scatter) — shop signs, lamp discs, the World Builder's detached objects and
// their props, the props' 512 m cell groups — is skipped once it is so far away that it covers well under a pixel or
// two: farther than CULL_K times its own radius (a 0.5 m sign plate beyond ~250 m, a 10 m house beyond ~5 km, never
// anything as large as a hill). The test runs on a quarter of the list each frame. Hidden things are taken off every
// layer (their mask kept and restored), so the shadow passes skip them too and no other system's .visible is touched.
import { scene, Q } from './core.js';

const CULL_K = 500, MIN_D = 120;
let list = null, k0 = 0;
function collect() {
  list = [];
  scene.traverse(o => {
    if (!(o.isMesh || o.isLine || o.isPoints) || o.userData.bucket || o.userData.scatter || o.userData.near || o.userData.noDistCull) return;
    const g = o.geometry; if (!g) return; if (!g.boundingSphere) g.computeBoundingSphere(); if (!g.boundingSphere || !isFinite(g.boundingSphere.radius)) return;
    // the size of one thing: its geometry's reach at its scale (an instanced group: one instance's reach)
    o.updateMatrixWorld(); const e = o.matrixWorld.elements, sc = Math.sqrt(Math.max(e[0] * e[0] + e[1] * e[1] + e[2] * e[2], e[4] * e[4] + e[5] * e[5] + e[6] * e[6], e[8] * e[8] + e[9] * e[9] + e[10] * e[10]));
    const r = (g.boundingSphere.radius + g.boundingSphere.center.length() * (o.isInstancedMesh ? 0 : 0)) * sc;
    if (r * CULL_K > 20000) return; // (large things stay: hills, roads, the sky)
    list.push({ o, r, mask: null });
  });
}
const _c = { x: 0, y: 0, z: 0 };
function sphereOf(o, out) { // world centre and radius of what o draws
  const s = o.isInstancedMesh && o.boundingSphere ? o.boundingSphere : o.geometry.boundingSphere, e = o.matrixWorld.elements, c = s.center;
  out.x = e[0] * c.x + e[4] * c.y + e[8] * c.z + e[12]; out.y = e[1] * c.x + e[5] * c.y + e[9] * c.z + e[13]; out.z = e[2] * c.x + e[6] * c.y + e[10] * c.z + e[14];
  out.r = s.radius * Math.sqrt(Math.max(e[0] * e[0] + e[1] * e[1] + e[2] * e[2], e[4] * e[4] + e[5] * e[5] + e[6] * e[6], e[8] * e[8] + e[9] * e[9] + e[10] * e[10]));
  return out;
}
export function distCull(cam) {
  if (!list) collect();
  const n = list.length; if (!n) return;
  const p = cam.position, k = Q.lodScale || 1, step = Math.ceil(n / 4);
  for (let j = 0; j < step; j++) {
    const it = list[(k0 + j) % n], o = it.o;
    if (!o.parent) continue;
    sphereOf(o, _c);
    const d = Math.hypot(_c.x - p.x, _c.y - p.y, _c.z - p.z) - _c.r, far = d > Math.max(MIN_D, it.r * CULL_K) * k;
    if (far && it.mask === null) { it.mask = o.layers.mask; o.layers.mask = 0; }
    else if (!far && it.mask !== null) { o.layers.mask = it.mask; it.mask = null; }
  }
  k0 = (k0 + step) % n;
}
export const resetDistCull = () => { if (list) for (const it of list) if (it.mask !== null) { it.o.layers.mask = it.mask; it.mask = null; } list = null; };
