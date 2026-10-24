// Collider view (F4): the colliders round the walker drawn where they are, coloured by type —
//   orange  buildings' solid spans (walls, glazing, doors, rails, posts, risers, soffits) at their real footprint and
//           height (compound colliders, core.js)
//   green   walkable tops: buildings' floors, galleries, landings, treads and steps, and platforms
//   red     boxes (walls, fences, kiosks, vending machines ...), yellow: circles (trees, posts, poles)
// Built for the ground within 28 m of the walker and rebuilt as it moves on; nothing is drawn or updated while off.
import { THREE, scene, colliders, colKey } from './core.js';

const RAD = 28, BOX = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
const M = { solid: new THREE.MeshBasicMaterial({ color: 0xff8a1e, transparent: true, opacity: 0.5, depthWrite: false }),
  top: new THREE.MeshBasicMaterial({ color: 0x2ee86a, transparent: true, opacity: 0.6, depthWrite: false }),
  box: new THREE.LineBasicMaterial({ color: 0xff3030 }), plat: new THREE.LineBasicMaterial({ color: 0x2ee86a }), circ: new THREE.LineBasicMaterial({ color: 0xffe030 }) };
let group = null, at = null;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

function build(cx, cy, cz, groundAt) {
  const g = new THREE.Group(), seen = new Set(), solids = [], tops = [], lines = { box: [], plat: [], circ: [] };
  for (let i = Math.floor((cx - RAD) / 16); i <= Math.floor((cx + RAD) / 16); i++) for (let j = Math.floor((cz - RAD) / 16); j <= Math.floor((cz + RAD) / 16); j++) for (const c of colliders.get(colKey(i, j)) || []) {
    if (seen.has(c)) continue; seen.add(c);
    if (c.t === 2) { const D = c.data, C = c.cell;
      for (let q = 0; q < c.keys.length; q++) { const k = c.keys[q], ci = k % c.nx, cj = (k - ci) / c.nx, lx = c.x0 + (ci + 0.5) * C, lz = c.z0 + (cj + 0.5) * C;
        const wx = c.x + lx * c.c + lz * c.s, wz = c.z - lx * c.s + lz * c.c; if (Math.hypot(wx - cx, wz - cz) > RAD) continue;
        for (let m = c.start[q]; m < c.start[q + 1]; m++) { const o = m * 7, y0 = c.y + D[o + 1], y1 = c.y + D[o + 2]; if (y1 < cy - 4 || y0 > cy + 12) continue;
          if (D[o] === 1) tops.push(wx, y0, wz, C * 0.9, 0.02, C * 0.9, c.r);
          else { const mx = (D[o + 3] + D[o + 4]) / 2, mz = (D[o + 5] + D[o + 6]) / 2; solids.push(c.x + mx * c.c + mz * c.s, Math.max(y0, cy - 4), c.z - mx * c.s + mz * c.c, Math.max(0.02, D[o + 4] - D[o + 3]), Math.max(0.02, Math.min(y1, cy + 12) - Math.max(y0, cy - 4)), Math.max(0.02, D[o + 6] - D[o + 5]), c.r); } } }
      continue; }
    const g0 = groundAt(c.x, c.z), ya = Math.max(c.y0, g0 - 0.2), yb = Math.min(c.y1, g0 + 3);
    if (c.t === 0) { const L = lines.circ; for (const y of [ya, yb]) for (let a = 0; a < 16; a++) { const a0 = a / 16 * Math.PI * 2, a1 = (a + 1) / 16 * Math.PI * 2; L.push(c.x + Math.cos(a0) * c.r, y, c.z + Math.sin(a0) * c.r, c.x + Math.cos(a1) * c.r, y, c.z + Math.sin(a1) * c.r); }
      for (let a = 0; a < 4; a++) { const aa = a * Math.PI / 2; L.push(c.x + Math.cos(aa) * c.r, ya, c.z + Math.sin(aa) * c.r, c.x + Math.cos(aa) * c.r, yb, c.z + Math.sin(aa) * c.r); } }
    else { const L = c.walk ? lines.plat : lines.box, top = c.walk ? c.y1 : yb, bot = c.walk ? Math.min(c.y1, g0) : ya;
      const P = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => { const lx = u * c.hx, lz = v * c.hz; return [c.x + lx * c.c + lz * c.s, c.z - lx * c.s + lz * c.c]; });
      for (let k = 0; k < 4; k++) { const [ax, az] = P[k], [bx, bz] = P[(k + 1) % 4]; for (const y of [bot, top]) L.push(ax, y, az, bx, y, bz); L.push(ax, bot, az, ax, top, az); } }
  }
  for (const [list, mat] of [[solids, M.solid], [tops, M.top]]) { const n = list.length / 7; if (!n) continue;
    const im = new THREE.InstancedMesh(BOX, mat, n);
    for (let i = 0; i < n; i++) { const o = i * 7; _q.setFromAxisAngle(_up, list[o + 6]); _m.compose(_p.set(list[o], list[o + 1], list[o + 2]), _q, _s.set(list[o + 3], list[o + 4], list[o + 5])); im.setMatrixAt(i, _m); }
    im.frustumCulled = false; g.add(im); }
  for (const [k, L] of Object.entries(lines)) if (L.length) { const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(L, 3)); g.add(new THREE.LineSegments(geo, M[k])); }
  g.renderOrder = 10; return g;
}
function drop() { if (!group) return; scene.remove(group); group.traverse(o => { if (o.geometry && o.geometry !== BOX) o.geometry.dispose(); if (o.dispose) o.dispose(); }); group = null; }
export const colliderView = {
  on: false,
  toggle(p, groundAt) { this.on = !this.on; drop(); at = null; if (this.on) this.update(p, groundAt); return this.on; },
  // (rebuilt once the walker is 6 m from where it was last built)
  update(p, groundAt) { if (!this.on || (at && Math.hypot(p.x - at.x, p.z - at.z) < 6 && Math.abs(p.y - at.y) < 3)) return;
    drop(); group = build(p.x, p.y, p.z, groundAt); scene.add(group); at = p.clone(); },
};
