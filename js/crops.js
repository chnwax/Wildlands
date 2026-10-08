// Field crops as real little plants instead of boxes. Each crop is a small mesh built from bent, curled leaf cards cut
// out of a painted leaf atlas (broad veined leaf, long serrated daikon leaf, heart-shaped taro leaf, a cabbage-head
// texture) plus stems, heads, roots and fruit, all in one material. Plants are registered during the town build
// (cropSet.add) and drawn as instanced meshes grouped per crop and per 128 m chunk, so a field of a thousand plants is
// a handful of draws; chunks further than ~320 m are skipped (the rows' low crop mass carries the colour out there).
import { THREE, scene, mulberry32 } from './core.js';
import { canvasTex } from './townkit.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------- leaf atlas (2 x 2 cells of 256 px)
const ATLAS = { broad: [0, 0], long: [1, 0], heart: [0, 1], head: [1, 1] };
let atlasTex = null;
function atlas() {
  if (atlasTex) return atlasTex;
  atlasTex = canvasTex(512, 512, (g) => {
    g.clearRect(0, 0, 512, 512);
    const leaf = (ox, oy, path, rib, veins) => {
      g.save(); g.translate(ox, oy);
      const gr = g.createLinearGradient(0, 256, 0, 0); gr.addColorStop(0, '#b9d98f'); gr.addColorStop(1, '#e2f2c4');
      g.fillStyle = gr; g.beginPath(); path(); g.fill();
      g.strokeStyle = 'rgba(96,130,70,0.55)'; g.lineWidth = 1.6; g.beginPath(); path(); g.stroke();
      g.strokeStyle = 'rgba(245,255,225,0.85)'; g.lineWidth = 5; g.beginPath(); g.moveTo(128, 252); g.lineTo(128, rib); g.stroke();
      g.lineWidth = 2; g.strokeStyle = 'rgba(245,255,225,0.6)';
      for (const [y, dx, dy] of veins) for (const s of [-1, 1]) { g.beginPath(); g.moveTo(128, y); g.quadraticCurveTo(128 + s * dx * 0.5, y - dy * 0.3, 128 + s * dx, y - dy); g.stroke(); }
      g.restore();
    };
    // broad oval leaf with a crinkled margin (cabbage wrapper leaves, potato, eggplant, greens)
    leaf(0, 0, () => { g.moveTo(128, 254); for (let a = 0; a <= 1.001; a += 0.02) { const t = a * Math.PI, r = 1 + 0.05 * Math.sin(a * 60); g.lineTo(128 + Math.sin(t) * 104 * r, 250 - (1 - Math.cos(t)) * 118 * r); }
      for (let a = 1; a >= -0.001; a -= 0.02) { const t = a * Math.PI, r = 1 + 0.05 * Math.sin(a * 60 + 1); g.lineTo(128 - Math.sin(t) * 104 * r, 250 - (1 - Math.cos(t)) * 118 * r); } g.closePath(); },
      18, [[210, 70, 40], [170, 85, 45], [130, 88, 45], [90, 76, 40], [55, 50, 30]]);
    // long serrated leaf (daikon, turnip tops)
    leaf(256, 0, () => { g.moveTo(128, 254); for (let y = 250; y >= 6; y -= 8) { const w = 44 * Math.sin((250 - y) / 244 * Math.PI) ** 0.7 + 4; g.lineTo(128 + w * ((y / 8) % 2 ? 1.12 : 0.8), y); }
      for (let y = 6; y <= 250; y += 8) { const w = 44 * Math.sin((250 - y) / 244 * Math.PI) ** 0.7 + 4; g.lineTo(128 - w * ((y / 8) % 2 ? 1.12 : 0.8), y); } g.closePath(); },
      8, [[220, 30, 25], [180, 38, 28], [140, 42, 28], [100, 40, 26], [60, 30, 22]]);
    // heart-shaped leaf (taro), the stalk meeting it near the middle
    leaf(0, 256, () => { g.moveTo(128, 200); g.bezierCurveTo(40, 250, -10, 120, 60, 40); g.quadraticCurveTo(100, 0, 128, 8); g.quadraticCurveTo(156, 0, 196, 40); g.bezierCurveTo(266, 120, 216, 250, 128, 200); g.closePath(); },
      30, [[160, 90, 60], [120, 100, 40], [80, 80, 20], [190, 70, 80]]);
    // cabbage head: pale overlapping leaf bands with fine veins (no alpha)
    g.save(); g.translate(256, 256);
    g.fillStyle = '#e4f0c8'; g.fillRect(0, 0, 256, 256);
    for (let k = 0; k < 9; k++) { g.strokeStyle = `rgba(150,185,110,${0.35 + 0.05 * (k % 3)})`; g.lineWidth = 3; g.beginPath(); g.arc(128 + (k % 3 - 1) * 60, 300, 120 + k * 22, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); }
    const r = mulberry32(5); g.strokeStyle = 'rgba(250,255,235,0.8)'; g.lineWidth = 1.5;
    for (let k = 0; k < 40; k++) { const x = r() * 256, y = r() * 256; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 10, y - 14, x + 4 + r() * 20, y - 30); g.stroke(); }
    g.restore();
  });
  atlasTex.anisotropy = 8;
  return atlasTex;
}

// ---------------------------------------------------------------- parts
const tint = (g, c) => { const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set(c, i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
// a leaf card: base at the origin, growing along +z, tilted up by `lift` (radians from horizontal), bent (+ curls the
// tip up, - droops it) and cupped across its width; uv into one atlas cell
function leafCard(cell, len, wid, lift, bend = 0, cup = 0, col = [1, 1, 1]) {
  const NU = 3, NV = 5, pos = [], uv = [], idx = [], [cx, cy] = ATLAS[cell];
  for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) {
    const u = i / NU - 0.5, v = j / NV, a = lift + bend * v;
    const along = v * len, y = Math.sin(lift) * along + bend * along * along * 0.8 + cup * (u * u) * wid, z = Math.cos(lift) * along;
    pos.push(u * wid, y, z); uv.push((cx + 0.5 + u) * 0.5, (1 - cy + v) * 0.5); void a;
  }
  for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) { const a = j * (NU + 1) + i, b = a + 1, c = a + NU + 1, d = c + 1; idx.push(a, b, d, a, d, c); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  g.computeVertexNormals();
  return tint(g, col);
}
const place = (g, yaw, x = 0, y = 0, z = 0, pitch = 0) => g.rotateX(-pitch).rotateY(yaw).translate(x, y, z);
const noUV = (g, cell = 'head') => { const [cx, cy] = ATLAS[cell], a = g.attributes.uv; for (let i = 0; i < a.count; i++) a.setXY(i, (cx + 0.1 + a.getX(i) * 0.8) * 0.5, (1 - cy + 0.1 + a.getY(i) * 0.8) * 0.5); return g; };
const solid = (g, col, cell = 'head') => tint(noUV(g.index ? g : g, cell), col);
const merge = parts => { const m = mergeGeometries(parts.map(p => { const q = p.index ? p.toNonIndexed() : p; for (const k of Object.keys(q.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) q.deleteAttribute(k); return q; })); m.computeBoundingSphere(); return m; };
const LEAF = [0.52, 0.78, 0.46], DARK = [0.36, 0.6, 0.36], BLUE = [0.5, 0.72, 0.6];

const GEOS = {};
function geo(type) {
  if (GEOS[type]) return GEOS[type];
  const r = mulberry32(type.length * 977 + type.charCodeAt(0)), P = [];
  if (type === 'cabbage') { // a round pale head in a ring of big blue-green wrapper leaves
    P.push(solid(new THREE.SphereGeometry(0.13, 12, 9).scale(1, 0.85, 1).translate(0, 0.12, 0), [0.86, 0.95, 0.72]));
    for (let k = 0; k < 8; k++) P.push(place(leafCard('broad', 0.3 + r() * 0.06, 0.28, 0.35 + r() * 0.35, 0.6, 0.35, k % 2 ? LEAF : DARK), k / 8 * Math.PI * 2 + r() * 0.3, 0, 0.03));
    for (let k = 0; k < 4; k++) P.push(place(leafCard('broad', 0.18, 0.2, 1.1, -0.4, 0.5, [0.7, 0.86, 0.56]), k / 4 * Math.PI * 2 + 0.4, 0, 0.1));
  } else if (type === 'napa') { // tall barrel head of pale leaves, a few outer leaves leaning out
    P.push(solid(new THREE.SphereGeometry(0.1, 10, 10).scale(1, 2.1, 1).translate(0, 0.2, 0), [0.9, 0.95, 0.7]));
    for (let k = 0; k < 5; k++) P.push(place(leafCard('broad', 0.4, 0.2, 1.35, -0.25, 0.8, [0.72, 0.9, 0.58]), k / 5 * Math.PI * 2 + 0.3, 0, 0.02));   // wrapped leaves, green tops
    for (let k = 0; k < 6; k++) P.push(place(leafCard('broad', 0.34, 0.26, 0.55 + r() * 0.3, -0.6, 0.4, k % 2 ? DARK : LEAF), k / 6 * Math.PI * 2, 0, 0.02)); // outer leaves
  } else if (type === 'daikon') { // a rosette of long serrated leaves arching out; the white shoulder of the root
    P.push(solid(new THREE.CylinderGeometry(0.04, 0.045, 0.1, 10).translate(0, 0.02, 0), [0.96, 0.97, 0.92]));
    for (let k = 0; k < 9; k++) P.push(place(leafCard('long', 0.42 + r() * 0.1, 0.12, 0.9 + r() * 0.3, -0.9, 0.2, k % 2 ? DARK : LEAF), k / 9 * Math.PI * 2 + r() * 0.3, 0, 0.06));
  } else if (type === 'leek') { // blue-green hollow blades fanning from a white earthed-up shank
    P.push(solid(new THREE.CylinderGeometry(0.02, 0.024, 0.18, 8).translate(0, 0.09, 0), [0.95, 0.96, 0.9]));
    for (let k = 0; k < 6; k++) { const L = 0.38 + r() * 0.16, a = (r() - 0.5) * 0.5, b = r() * Math.PI * 2;
      P.push(solid(new THREE.CylinderGeometry(0.004, 0.011, L, 6).translate(0, L / 2, 0).rotateZ(a).rotateY(b).translate(0, 0.17, 0), k % 2 ? BLUE : [0.44, 0.64, 0.52])); }
  } else if (type === 'potato' || type === 'eggplant' || type === 'bush') { // leafy clump on a few stems (eggplant: purple fruit)
    const big = type === 'eggplant' ? 1.25 : 1, N = type === 'eggplant' ? 12 : 16;
    for (let k = 0; k < N; k++) { const b = r() * Math.PI * 2, h = 0.05 + r() * (type === 'eggplant' ? 0.45 : 0.3), d = 0.03 + r() * 0.12;
      P.push(place(leafCard('broad', 0.17 * big, 0.13 * big, 0.2 + r() * 0.6, -0.3, 0.3, r() < 0.5 ? DARK : LEAF), b, Math.cos(b) * d, h, Math.sin(b) * d)); }
    for (let k = 0; k < 3; k++) P.push(solid(new THREE.CylinderGeometry(0.008, 0.01, 0.35, 5).translate(0, 0.17, 0).rotateZ((r() - 0.5) * 0.5).rotateY(r() * 6), [0.42, 0.56, 0.3]));
    if (type === 'eggplant') for (let k = 0; k < 2; k++) P.push(solid(new THREE.SphereGeometry(0.035, 8, 6).scale(1, 2.2, 1).translate((r() - 0.5) * 0.2, 0.2 + r() * 0.15, (r() - 0.5) * 0.2), [0.3, 0.1, 0.34]));
  } else if (type === 'greens' || type === 'seedling') { // low rosette (komatsuna, lettuce) or a transplant in the mulch
    const s = type === 'seedling' ? 0.5 : 1;
    for (let k = 0; k < 7; k++) P.push(place(leafCard('broad', 0.17 * s, 0.12 * s, 0.7 + r() * 0.4, -0.5, 0.3, k % 2 ? [0.6, 0.86, 0.5] : LEAF), k / 7 * Math.PI * 2 + r() * 0.4, 0, 0.01));
  } else if (type === 'flowerP' || type === 'flowerY') { // bedding plants: a leafy mound topped with flower heads
    const FC = type === 'flowerP' ? [[0.96, 0.5, 0.66], [0.98, 0.7, 0.8], [0.85, 0.3, 0.45]] : [[1, 0.86, 0.3], [1, 0.95, 0.6], [0.98, 0.6, 0.2]];
    for (let k = 0; k < 7; k++) P.push(place(leafCard('broad', 0.12, 0.09, 0.5 + r() * 0.4, -0.4, 0.3, k % 2 ? DARK : LEAF), k / 7 * Math.PI * 2, 0, 0.01));
    for (let k = 0; k < 9; k++) P.push(solid(new THREE.SphereGeometry(0.03, 6, 5).scale(1, 0.6, 1).translate((r() - 0.5) * 0.2, 0.12 + r() * 0.06, (r() - 0.5) * 0.2), FC[k % 3]));
  } else if (type === 'taro') { // three stalks carrying big heart leaves
    for (let k = 0; k < 3; k++) { const b = k / 3 * Math.PI * 2 + r() * 0.5, L = 0.6 + r() * 0.3, tx = Math.cos(b) * 0.12, tz = Math.sin(b) * 0.12;
      P.push(solid(new THREE.CylinderGeometry(0.01, 0.018, L, 6).translate(0, L / 2, 0).rotateZ(-0.2).rotateY(-b), [0.55, 0.66, 0.4]));
      P.push(place(leafCard('heart', 0.42, 0.38, -0.25, -0.3, 0.25, [0.46, 0.7, 0.44]), -b + Math.PI / 2, tx, L - 0.06, tz)); }
  } else if (type === 'tomato') { // a staked vine: leaflets up the stake, trusses of red and green fruit
    P.push(solid(new THREE.CylinderGeometry(0.01, 0.012, 1.7, 5).translate(0, 0.85, 0), [0.6, 0.5, 0.36]));
    for (let k = 0; k < 14; k++) { const h = 0.15 + k * 0.1, b = r() * Math.PI * 2; P.push(place(leafCard('broad', 0.15, 0.1, 0.1 + r() * 0.4, -0.4, 0.2, r() < 0.5 ? DARK : LEAF), b, 0, h)); }
    for (let k = 0; k < 5; k++) P.push(solid(new THREE.SphereGeometry(0.03, 8, 6).translate((r() - 0.5) * 0.12, 0.4 + r() * 0.8, (r() - 0.5) * 0.12), r() < 0.6 ? [0.9, 0.2, 0.12] : [0.5, 0.72, 0.3]));
  } else if (type === 'vine') { // cucumber / bean leaves climbing a net
    for (let k = 0; k < 10; k++) { const b = r() * Math.PI * 2; P.push(place(leafCard('broad', 0.14, 0.13, 1.2 + r() * 0.3, -0.2, 0.2, r() < 0.5 ? DARK : LEAF), b, (r() - 0.5) * 0.1, r() * 0.5, (r() - 0.5) * 0.1)); }
  }
  GEOS[type] = merge(P);
  return GEOS[type];
}

// ---------------------------------------------------------------- registry + instancing
const CH = 256, list = new Map();
export const cropSet = {
  // world position of the plant's base, heading, scale, tint (multiplies the plant's own colours); far: drawn within
  // this distance only — garden plants (yards.js) are small and many, in 48 m chunks drawn within 90 m
  add(type, x, y, z, yaw = 0, s = 1, tintC = null, far = 0) {
    const ch = far ? 48 : CH, k = type + '|' + far + '|' + Math.floor(x / ch) + ',' + Math.floor(z / ch);
    let L = list.get(k); if (!L) list.set(k, L = { type, items: [], far });
    L.items.push([x, y, z, yaw, s, tintC]);
  },
};
let MAT = null;
const chunks = [];
export function buildCrops() {
  if (!MAT) MAT = new THREE.MeshStandardMaterial({ map: atlas(), vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.78 });
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color();
  let n = 0;
  for (const L of list.values()) {
    const im = new THREE.InstancedMesh(geo(L.type), MAT, L.items.length); im.name = 'crop:' + L.type;
    L.items.forEach(([x, y, z, yaw, s, t], i) => { im.setMatrixAt(i, m4.compose(v.set(x, y, z), q.setFromAxisAngle(up, yaw), sc.setScalar(s))); im.setColorAt(i, t ? col.setRGB(t[0], t[1], t[2]) : col.setRGB(1, 1, 1)); });
    im.computeBoundingSphere(); im.castShadow = false; im.receiveShadow = true; im.userData.far = L.far;
    scene.add(im); chunks.push(im); n += L.items.length;
  }
  list.clear();
  return { plants: n, draws: chunks.length };
}
const _c = new THREE.Vector3();
export function updateCrops(cam, far = 320) {
  for (const im of chunks) { const b = im.boundingSphere; if (!b) continue; im.visible = _c.copy(b.center).distanceTo(cam.position) - b.radius < (im.userData.far ? Math.min(far, im.userData.far) : far); }
}
