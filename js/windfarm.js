// A small wind farm on the far hills to the north-east, turning slowly: POLYGON Farm's turbine (the model library's
// prop_windfarm_01, its tower and its rotor as one mesh: split here by their triangles, the rotor turned about its hub).
// Seen from town only far off, so it is a world prop of its own — not a World Builder object — drawn instanced, no
// shadows. Without the model library there is none.
import { THREE, scene } from './core.js';
import { packParts } from './packs.js';

// spots along the ridge: angle (deg, x = cos, z = sin) and the band of distance to look for the crest in
const SPOTS = [22, 29, 36, 43, 50, 57, 64];
export function windFarm(groundAt) {
  const P = packParts('farm_windfarm'); if (!P || !P[0].geometry.index) return null;
  const src = P[0].geometry, idx = src.index.array, pos = src.attributes.position;
  // the tower's triangles first, then the rotor's (the FBX's two meshes in order): find the split as the first triangle
  // that lies wholly above the top of the tower
  const triMinY = t => Math.min(pos.getY(idx[t * 3]), pos.getY(idx[t * 3 + 1]), pos.getY(idx[t * 3 + 2]));
  const n = idx.length / 3; let cut = n;
  for (let t = n - 1; t >= 0 && triMinY(t) > 45; t--) cut = t;
  if (cut <= 0 || cut >= n) return null;
  // (each part its own copy of just the vertices it uses: the rotor is moved to its hub, the pack's mesh stays as it is)
  const part = (a, b) => {
    const map = new Map(), out = [], g = new THREE.BufferGeometry();
    for (let i = a * 3; i < b * 3; i++) { const v = idx[i]; if (!map.has(v)) map.set(v, map.size); out.push(map.get(v)); }
    for (const k in src.attributes) { const A = src.attributes[k], arr = new A.array.constructor(map.size * A.itemSize);
      const get = [A.getX, A.getY, A.getZ, A.getW]; for (const [v, j] of map) for (let c = 0; c < A.itemSize; c++) arr[j * A.itemSize + c] = get[c].call(A, v);
      g.setAttribute(k, new THREE.BufferAttribute(arr, A.itemSize, A.normalized)); }
    g.setIndex(out); g.computeBoundingBox(); return g;
  };
  const tower = part(0, cut), rotor = part(cut, n), bb = rotor.boundingBox;
  // hub: a three-bladed rotor with a blade straight up spans R up and R/2 down from it
  const R = (bb.max.y - bb.min.y) / 1.5, hub = new THREE.Vector3((bb.min.x + bb.max.x) / 2, bb.max.y - R, (bb.min.z + bb.max.z) / 2);
  rotor.translate(-hub.x, -hub.y, -hub.z); rotor.computeBoundingSphere(); tower.computeBoundingSphere();
  const mat = P[0].material;
  const sites = [];
  for (const a of SPOTS) {
    const r = a * Math.PI / 180; let best = null;
    for (let D = 820; D <= 960; D += 20) { const x = Math.cos(r) * D, z = Math.sin(r) * D, h = groundAt(x, z); if (!best || h > best.y) best = { x, z, y: h }; }
    sites.push({ ...best, phase: a * 0.37 });
  }
  const yaw = Math.atan2(-0.55, -0.83); // (all facing the same wind, rotors toward the town's side of the ridge)
  const towers = new THREE.InstancedMesh(tower, mat, sites.length), rotors = new THREE.InstancedMesh(rotor, mat, sites.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), qs = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(1.15, 1.15, 1.15), Z = new THREE.Vector3(0, 0, 1);
  q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  sites.forEach((t, i) => { towers.setMatrixAt(i, m.compose(v.set(t.x, t.y - 1.5, t.z), q, s)); t.hub = v.copy(hub).multiply(s).applyQuaternion(q).add(new THREE.Vector3(t.x, t.y - 1.5, t.z)).clone(); });
  for (const o of [towers, rotors]) { o.castShadow = false; o.receiveShadow = false; o.matrixAutoUpdate = false; o.name = 'windfarm'; scene.add(o); }
  const update = time => {
    sites.forEach((t, i) => { qs.setFromAxisAngle(Z, time * 0.55 + t.phase).premultiply(q); rotors.setMatrixAt(i, m.compose(t.hub, qs, s)); });
    rotors.instanceMatrix.needsUpdate = true;
  };
  update(0); towers.computeBoundingSphere(); rotors.computeBoundingSphere();
  return { update, sites };
}
