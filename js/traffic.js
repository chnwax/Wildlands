// Cars: procedural Japanese car models (kei wagons, compacts, kei trucks, vans, taxis) rendered with instancing,
// and a left-hand-traffic simulation along road loops with car-following, stop signs and level-crossing logic.
import { THREE, scene, clamp, lerp, mulberry32, addBox } from './core.js';
import { Emitter } from './audio.js';
import { night, canvasTex, JP_FONT } from './townkit.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------- geometry helpers
function roundedShape(pts, r) {
  const s = new THREE.Shape(), n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i], a = pts[(i + n - 1) % n], b = pts[(i + 1) % n];
    const ra = Math.min(r, Math.hypot(p[0] - a[0], p[1] - a[1]) / 2.2), rb = Math.min(r, Math.hypot(p[0] - b[0], p[1] - b[1]) / 2.2);
    const da = Math.hypot(p[0] - a[0], p[1] - a[1]), db = Math.hypot(p[0] - b[0], p[1] - b[1]);
    const p1 = [p[0] + (a[0] - p[0]) / da * ra, p[1] + (a[1] - p[1]) / da * ra], p2 = [p[0] + (b[0] - p[0]) / db * rb, p[1] + (b[1] - p[1]) / db * rb];
    if (i === 0) s.moveTo(p1[0], p1[1]); else s.lineTo(p1[0], p1[1]);
    s.quadraticCurveTo(p[0], p[1], p2[0], p2[1]);
  }
  s.closePath();
  return s;
}
// keep the part of a polygon with y >= yc (Sutherland–Hodgman against one line)
function clipAbove(pts, yc) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], ia = a[1] >= yc, ib = b[1] >= yc;
    if (ia) out.push(a);
    if (ia !== ib) { const t = (yc - a[1]) / (b[1] - a[1]); out.push([a[0] + (b[0] - a[0]) * t, yc]); }
  }
  return out;
}
function clipBelow(pts, yc) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], ia = a[1] <= yc, ib = b[1] <= yc;
    if (ia) out.push(a);
    if (ia !== ib) { const t = (yc - a[1]) / (b[1] - a[1]); out.push([a[0] + (b[0] - a[0]) * t, yc]); }
  }
  return out;
}
function offsetPoly(pts, d) {
  let area = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; area += a[0] * b[1] - b[0] * a[1]; }
  const sgn = area > 0 ? 1 : -1, n = pts.length;
  return pts.map((p, i) => {
    const a = pts[(i + n - 1) % n], b = pts[(i + 1) % n];
    const n1 = [(p[1] - a[1]), -(p[0] - a[0])], n2 = [(b[1] - p[1]), -(b[0] - p[0])];
    const l1 = Math.hypot(...n1) || 1, l2 = Math.hypot(...n2) || 1;
    const nx = (n1[0] / l1 + n2[0] / l2) * sgn, ny = (n1[1] / l1 + n2[1] / l2) * sgn, l = Math.hypot(nx, ny) || 1;
    return [p[0] + nx / l * d, p[1] + ny / l * d];
  });
}
function extrude(shape, width, bevel = 0.05) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.01, width - bevel * 2), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.6, bevelSegments: 3, curveSegments: 5 });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  return g;
}
const boxG = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
// clip a closed polygon to x >= xc (keep = 1) or x <= xc (keep = -1)
function clipX(pts, xc, keep) {
  const out = [], inside = p => keep > 0 ? p[0] >= xc : p[0] <= xc;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], ia = inside(a), ib = inside(b);
    if (ia) out.push(a);
    if (ia !== ib) { const t = (xc - a[0]) / (b[0] - a[0]); out.push([xc, a[1] + (b[1] - a[1]) * t]); }
  }
  return out;
}
// geometry painted with one vertex colour (for the multi-coloured cabin and driver meshes)
const tint = (g, c) => { const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set(c, i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
function mergeC(geos) {
  const parts = geos.map(g => g.index ? g.toNonIndexed() : g), m = merge(parts), n = m.attributes.position.count, col = new Float32Array(n * 3);
  let o = 0; for (const g of parts) { col.set(g.attributes.color.array, o * 3); o += g.attributes.position.count; }
  m.setAttribute('color', new THREE.BufferAttribute(col, 3)); return m;
}
function merge(geos) {
  // tiny merge (positions/normals/uvs) – avoids pulling in BufferGeometryUtils for simple parts
  const parts = geos.map(g => g.index ? g.toNonIndexed() : g);
  const count = parts.reduce((a, g) => a + g.attributes.position.count, 0);
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), uv = new Float32Array(count * 2);
  let o = 0;
  for (const g of parts) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2); o += g.attributes.position.count; }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(pos, 3)); m.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); m.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return m;
}

// side profiles (x forward, y up), width, wheelbase, track, wheel radius, plate colour
const TYPES = {
  keiTall: { L: 3.39, W: 1.47, belt: 1.05, wb: 2.52, r: 0.28, kei: true,
    body: [[-1.69, 0.3], [1.69, 0.3], [1.69, 0.8], [1.32, 1.0], [0.96, 1.75], [-1.62, 1.78], [-1.69, 1.45]] },
  keiHatch: { L: 3.39, W: 1.47, belt: 0.98, wb: 2.46, r: 0.28, kei: true,
    body: [[-1.69, 0.3], [1.69, 0.3], [1.69, 0.72], [1.2, 0.92], [0.62, 1.62], [-1.5, 1.64], [-1.69, 1.2]] },
  compact: { L: 4.05, W: 1.69, belt: 0.92, wb: 2.55, r: 0.3, kei: false,
    body: [[-2.02, 0.32], [2.02, 0.32], [2.02, 0.62], [1.35, 0.86], [0.45, 1.46], [-1.1, 1.48], [-1.95, 1.02]] },
  minivan: { L: 4.69, W: 1.69, belt: 1.02, wb: 2.85, r: 0.31, kei: false,
    body: [[-2.34, 0.32], [2.34, 0.32], [2.34, 0.78], [1.72, 1.0], [1.02, 1.82], [-2.25, 1.85], [-2.34, 1.5]] },
  van: { L: 4.69, W: 1.69, belt: 1.12, wb: 2.57, r: 0.3, kei: false,
    body: [[-2.34, 0.32], [2.34, 0.32], [2.34, 1.0], [2.1, 1.25], [1.72, 1.95], [-2.3, 1.98], [-2.34, 1.7]] },
  taxi: { L: 4.4, W: 1.7, belt: 1.0, wb: 2.75, r: 0.3, kei: false, taxi: true,
    body: [[-2.2, 0.32], [2.2, 0.32], [2.2, 0.75], [1.5, 0.95], [0.9, 1.72], [-1.95, 1.75], [-2.2, 1.35]] },
  keiTruck: { L: 3.39, W: 1.47, belt: 1.12, wb: 1.9, r: 0.27, kei: true, truck: true,
    body: [[0.25, 0.32], [1.69, 0.32], [1.69, 0.95], [1.55, 1.15], [1.35, 1.8], [0.3, 1.82], [0.25, 1.6]] },
};
const PAINTS = [[0.93, 0.93, 0.92], [0.95, 0.95, 0.94], [0.9, 0.9, 0.9], [0.62, 0.64, 0.66], [0.55, 0.56, 0.58], [0.05, 0.05, 0.06], [0.08, 0.08, 0.09],
  [0.3, 0.32, 0.36], [0.6, 0.72, 0.82], [0.75, 0.68, 0.55], [0.5, 0.06, 0.06], [0.85, 0.72, 0.72], [0.28, 0.2, 0.14], [0.22, 0.32, 0.45], [0.93, 0.92, 0.9]];

const paintMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.4, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.04 });
const glassMat = new THREE.MeshStandardMaterial({ color: 0x0b1015, metalness: 0.2, roughness: 0.02, transparent: true, opacity: 0.5, depthWrite: false, envMapIntensity: 1.4, side: THREE.DoubleSide });
const trimMat = new THREE.MeshStandardMaterial({ color: 0x151617, roughness: 0.6, side: THREE.DoubleSide });
const chromeMat = new THREE.MeshStandardMaterial({ color: 0xd8dde2, metalness: 1, roughness: 0.12 });
const cabinMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
const clothMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
const CLOTH = [[0.2, 0.3, 0.5], [0.88, 0.88, 0.85], [0.3, 0.3, 0.32], [0.62, 0.22, 0.2], [0.25, 0.42, 0.3], [0.72, 0.64, 0.5], [0.12, 0.12, 0.14], [0.55, 0.62, 0.78], [0.86, 0.72, 0.74], [0.9, 0.84, 0.6]];
const HAIRS = [[0.06, 0.05, 0.05], [0.1, 0.07, 0.05], [0.22, 0.15, 0.1], [0.08, 0.06, 0.05], [0.55, 0.55, 0.56], [0.32, 0.22, 0.14], [0.05, 0.05, 0.06]];
const hairMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55 });
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
const plateTex = canvasTex(256, 128, (g, W, H) => {
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.strokeStyle = '#1f4d2c'; g.lineWidth = 6; g.strokeRect(4, 4, W - 8, H - 8);
  g.fillStyle = '#1f4d2c'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `bold 30px ${JP_FONT}`; g.fillText('桜川 580', W * 0.58, H * 0.26);
  g.fillText('さ', W * 0.12, H * 0.68);
  g.font = 'bold 62px Arial'; g.fillText('12-34', W * 0.58, H * 0.68);
});
const plateMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: plateTex, roughness: 0.35 });
const tireMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.92 });
const rimMat = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, metalness: 0.9, roughness: 0.28 });
const shadowTex = canvasTex(128, 128, (g, W, H) => {
  const gr = g.createRadialGradient(W / 2, H / 2, 4, W / 2, H / 2, W / 2);
  gr.addColorStop(0, 'rgba(0,0,0,0.75)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
});
// soft contact shadow under each car (ambient occlusion the shadow map is too coarse to resolve)
const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8, color: 0x000000 });
// lamps: emissive scaled by the instance colour (x = intensity)
function lampMat(color, key) {
  const m = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.2, emissive: color, emissiveIntensity: 1 });
  m.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_INSTANCING_COLOR\n totalEmissiveRadiance *= vColor.r;\n diffuseColor.rgb = vec3(0.12);\n#endif'); };
  m.customProgramCacheKey = () => key;
  return m;
}
const headMat = lampMat(0xfff6e8, 'carHead'), tailMat = lampMat(0xff1a0a, 'carTail');

export function wheelX(T) {
  return T.truck ? [T.L / 2 - 0.62, -T.L / 2 + 0.75] : [T.wb / 2, -T.wb / 2];
}
// insert semicircular wheel-arch cut-outs into the bottom edge of a side profile
function withArches(pts, T) {
  const [p0, p1] = pts, y0 = p0[1], R = T.r + 0.055, out = [p0];
  const xs = wheelX(T).filter(x => x > p0[0] + R && x < p1[0] - R).sort((a, b) => a - b);
  for (const xc of xs) {
    const a0 = Math.asin(Math.min(0.99, (y0 - T.r) / R));
    for (let k = 0; k <= 12; k++) { const th = Math.PI - a0 - (Math.PI - 2 * a0) * k / 12; out.push([xc + R * Math.cos(th), T.r + R * Math.sin(th)]); }
  }
  return [...out, ...pts.slice(1)];
}
function archLiner(xc, T) {
  const R = T.r + 0.045, zw = T.W / 2 - 0.02, pos = [], idx = [];
  for (let k = 0; k <= 12; k++) {
    const th = Math.PI * k / 12, x = xc + R * Math.cos(th), y = T.r + R * Math.sin(th);
    pos.push(x, y, -zw, x, y, zw);
    if (k) { const a = (k - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3 * 2), 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g.toNonIndexed();
}

function buildType(T) {
  const hl = T.L / 2;
  const bodyPts = T.body;
  const parts = {};
  const roofY = Math.max(...bodyPts.map(p => p[1]));
  // painted shell = lower body (below the belt line) + roof panel + pillars; the greenhouse is real glass. The lower body is
  // hollow where the cabin is: a bonnet block ahead of the dashboard, a tail block behind the cabin, thin door skins
  // along the sides and a floor pan, so the seats, dashboard and driver sit in a real cabin under the glass
  const lower = clipBelow(withArches(bodyPts, T), T.belt + 0.02);
  const wsx0 = bodyPts[3][0], cx1 = wsx0 - 0.02, cx0 = T.truck ? bodyPts[0][0] + 0.1 : -hl + 0.32, skin = 0.07, floorY = 0.36; // floor pan and seats sit low, as in a real cabin (heads clear the roof)
  const shell = [extrude(roundedShape(clipX(lower, cx1, 1), 0.1), T.W, 0.06)];
  if (!T.truck) shell.push(extrude(roundedShape(clipX(lower, cx0, -1), 0.1), T.W, 0.06));
  for (const sd of [-1, 1]) shell.push(extrude(roundedShape(lower, 0.1), skin, 0.02).translate(0, 0, sd * (T.W / 2 - skin / 2)));
  shell.push(boxG(cx1 - cx0 + 0.02, floorY - 0.3, T.W - 2 * skin + 0.02, (cx0 + cx1) / 2, (floorY + 0.3) / 2, 0));
  if (T.truck) shell.push(boxG(0.06, T.belt - 0.3, T.W - 0.02, cx0 - 0.03, (T.belt + 0.3) / 2, 0)); // cab back wall
  const top = clipAbove(bodyPts, roofY - 0.09);
  if (top.length > 2) shell.push(extrude(roundedShape(top, 0.05), T.W * 0.98, 0.04));
  const up = clipAbove(bodyPts, T.belt);                 // greenhouse outline: find front (A) and rear (C) edges
  const front = up.filter(p => p[0] > 0).sort((a, b) => a[1] - b[1]), rear = up.filter(p => p[0] < 0).sort((a, b) => a[1] - b[1]);
  const pillar = (a, b, w) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
    return [-1, 1].map(sd => new THREE.BoxGeometry(L, w, 0.07).rotateZ(Math.atan2(dy, dx)).translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, sd * (T.W / 2 - 0.04))); };
  if (front.length >= 2) shell.push(...pillar(front[0], front[front.length - 1], 0.09));
  if (rear.length >= 2) shell.push(...pillar(rear[0], rear[rear.length - 1], T.L > 4.3 ? 0.22 : 0.16));
  const bx = (front.length ? front[0][0] : 0.5) - 1.0;   // B pillar
  if (!T.truck) shell.push(...[-1, 1].map(sd => boxG(0.1, roofY - T.belt, 0.07, bx, (roofY + T.belt) / 2, sd * (T.W / 2 - 0.04))));
  let body = merge(shell);
  const gl = offsetPoly(clipAbove(bodyPts, T.belt - 0.02), -0.01).map(p => [p[0], Math.min(p[1], roofY - 0.06)]);
  // the greenhouse extrusion is a closed prism: drop its floor (the faces along the belt line), which would otherwise lie
  // over the cabin like a sheet of dark glass
  const glass = (() => { const g0 = extrude(roundedShape(gl, 0.06), T.W - 0.07, 0).toNonIndexed(), P = g0.attributes.position, keep = [];
    const v = i => new THREE.Vector3(P.getX(i), P.getY(i), P.getZ(i));
    for (let i = 0; i < P.count; i += 3) { const a = v(i), b = v(i + 1), c = v(i + 2), n = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
      if (!(n.y < -0.7 && Math.max(a.y, b.y, c.y) < T.belt + 0.05)) keep.push(i); }
    const pos = new Float32Array(keep.length * 9); keep.forEach((i, k) => { for (let j = 0; j < 9; j++) pos[k * 9 + j] = P.array[i * 3 + j]; });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(keep.length * 6), 2)); g.computeVertexNormals(); return g; })();
  const wsx = bodyPts[3][0];                     // windshield base
  const side = fn => [-1, 1].flatMap(sd => fn(sd));
  const trim = [
    boxG(0.12, 0.26, T.W * 0.98, hl - 0.02, 0.42, 0), boxG(0.12, 0.26, T.W * 0.98, -hl + 0.02, 0.42, 0),   // bumpers
    boxG(0.04, 0.16, T.W * 0.45, hl + 0.02, 0.66, 0),                                                  // grille
    ...side(sd => [boxG(0.18, 0.1, 0.12, wsx - 0.25, T.belt + 0.05, sd * (T.W / 2 + 0.06))]),          // mirrors
    ...side(sd => [boxG(T.L * 0.9, 0.05, 0.02, 0, 0.36, sd * (T.W / 2 - 0.005))]),                      // side sills
    ...side(sd => [boxG(Math.max(0.5, wsx + hl - 0.25), 0.022, 0.012, (wsx - hl) / 2 - 0.05, T.belt - 0.01, sd * (T.W / 2 + 0.003))]), // belt moulding
    ...side(sd => [0, 1, 2].filter(k => wsx - 0.05 - k * 1.02 > -hl + 0.35 && !(T.truck && k > 0)).map(k => boxG(0.01, T.belt - 0.4, 0.006, wsx - 0.05 - k * 1.02, 0.4 + (T.belt - 0.4) / 2, sd * (T.W / 2 + 0.002)))), // door seams
    ...side(sd => [0, 1].filter(k => wsx - 0.35 - k * 1.02 > -hl + 0.3 && !(T.truck && k > 0)).map(k => boxG(0.16, 0.03, 0.02, wsx - 0.35 - k * 1.02, T.belt - 0.12, sd * (T.W / 2 + 0.01)))), // door handles
    ...wheelX(T).filter(x => !(T.truck && x < 0)).map(x => archLiner(x, T)),
  ];
  if (T.truck) {
    const bed = [boxG(1.95, 0.08, T.W, -0.75, 0.75, 0), boxG(1.95, 0.35, 0.05, -0.75, 0.95, T.W / 2 - 0.03), boxG(1.95, 0.35, 0.05, -0.75, 0.95, -T.W / 2 + 0.03),
      boxG(0.05, 0.35, T.W, -1.7, 0.95, 0), boxG(0.05, 0.7, T.W, 0.2, 1.1, 0), boxG(1.9, 0.1, T.W * 0.9, -0.75, 0.66, 0)];
    body = merge([body, ...bed]);
  }
  if (T.taxi) trim.push(boxG(0.45, 0.16, 0.2, -0.3, roofY + 0.08, 0));
  parts.paint = body; parts.glass = glass; parts.trim = merge(trim);
  // ---- cabin (vertex coloured): dashboard with instrument hood and centre stack, steering column and wheel on the right
  // (right-hand drive, +z), front seats with cushions, backrests and headrests, a rear bench, door cards, floor carpet
  const DASH = [0.13, 0.13, 0.14], SEAT = T.taxi ? [0.2, 0.22, 0.3] : [0.36, 0.36, 0.38], DOOR = [0.32, 0.31, 0.3], CARPET = [0.12, 0.12, 0.12], PLAS = [0.22, 0.22, 0.23];
  const B0 = T.belt, dz = 0.34 * T.W / 1.47, cabin = [];
  const dx0 = cx1 - 0.55;                                                       // dashboard face
  cabin.push(tint(boxG(cx1 - dx0, B0 - floorY - 0.12, T.W - 2 * skin, (cx1 + dx0) / 2, (B0 + floorY + 0.12) / 2, 0), DASH));
  cabin.push(tint(new THREE.BoxGeometry(0.55, 0.06, T.W - 2 * skin).rotateZ(-0.18).translate((cx1 + dx0) / 2 + 0.02, B0 + 0.03, 0), DASH));   // dash top
  cabin.push(tint(boxG(0.22, 0.09, 0.42, dx0 + 0.1, B0 + 0.08, dz), PLAS));                                            // instrument hood
  cabin.push(tint(boxG(0.1, 0.34, 0.26, dx0 - 0.02, B0 - 0.2, 0), PLAS));                                              // centre stack
  cabin.push(tint(new THREE.CylinderGeometry(0.025, 0.03, 0.34, 8).rotateZ(Math.PI / 2 - 0.45).translate(dx0 - 0.1, B0 - 0.05, dz), PLAS)); // column
  cabin.push(tint(new THREE.TorusGeometry(0.17, 0.022, 8, 22).rotateY(Math.PI / 2).rotateZ(-0.45).translate(dx0 - 0.25, B0 + 0.02, dz), DASH));
  cabin.push(tint(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 10).rotateZ(Math.PI / 2 - 0.45).translate(dx0 - 0.25, B0 + 0.02, dz), PLAS)); // hub
  const sx = dx0 - 0.6;                                                         // centre of the front seat cushions
  for (const sd of [-1, 1]) {
    cabin.push(tint(boxG(0.5, 0.14, 0.48, sx, floorY + 0.16, sd * dz), SEAT));
    cabin.push(tint(boxG(0.1, 0.22, 0.4, sx + 0.02, floorY + 0.08, sd * dz), PLAS));                                  // seat base
    cabin.push(tint(new THREE.BoxGeometry(0.12, 0.62, 0.46).translate(0, 0.31, 0).rotateZ(0.2).translate(sx - 0.27, floorY + 0.2, sd * dz), SEAT));
    cabin.push(tint(boxG(0.1, 0.16, 0.26, sx - 0.37, floorY + 0.86, sd * dz), SEAT));                                 // headrest
    cabin.push(tint(boxG(cx1 - cx0 - 0.1, B0 - floorY - 0.05, 0.03, (cx0 + cx1) / 2 - 0.05, (B0 + floorY) / 2, sd * (T.W / 2 - skin - 0.015)), DOOR)); // door cards
    cabin.push(tint(boxG(0.3, 0.04, 0.1, sx + 0.1, B0 - 0.2, sd * (T.W / 2 - skin - 0.07)), PLAS));                  // armrests
  }
  cabin.push(tint(boxG(0.6, 0.2, 0.2, sx + 0.05, floorY + 0.1, 0), PLAS));                                           // console
  cabin.push(tint(boxG(cx1 - cx0 - 0.1, 0.02, T.W - 2 * skin - 0.02, (cx0 + cx1) / 2, floorY + 0.01, 0), CARPET));
  const rx = sx - 1.0;
  if (!T.truck && rx - 0.35 > cx0) {                                             // rear bench
    cabin.push(tint(boxG(0.5, 0.16, T.W - 2 * skin - 0.1, rx, floorY + 0.2, 0), SEAT));
    cabin.push(tint(new THREE.BoxGeometry(0.12, 0.6, T.W - 2 * skin - 0.1).translate(0, 0.3, 0).rotateZ(0.22).translate(rx - 0.27, floorY + 0.26, 0), SEAT));
  }
  parts.cabin = mergeC(cabin);
  // ---- occupants: a seated figure built from rounded parts — head with jaw, nose, ears and eyes, neck, a torso with
  // shoulders and collar, jointed arms (hands on the wheel for the driver, in the lap for the passenger), thighs and
  // shins, a seat belt across the chest. Three meshes each: skin/trousers/shoes/belt (fixed colours), shirt (tinted per
  // car) and hair (tinted per car). The driver sits on the right (right-hand drive), a front passenger on the left.
  const SKIN = [0.96, 0.8, 0.68], PANTS = [0.2, 0.22, 0.28], SHOE = [0.12, 0.1, 0.09], BELT = [0.16, 0.16, 0.17], EYE = [0.1, 0.08, 0.08];
  const cap = (r, a, b) => { const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), L = d.length(), g = new THREE.CapsuleGeometry(r, Math.max(0.001, L), 4, 10);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())); g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2); return g; };
  const person = (pz, drive) => {
    const hx = sx - 0.08, hy0 = floorY + 0.13, skin = [], hair = [], shirt = [], head = [hx - 0.19, hy0 + 0.86, pz];
    skin.push(tint(new THREE.SphereGeometry(0.098, 16, 12).scale(0.95, 1.1, 0.86).translate(...head), SKIN));                          // skull
    skin.push(tint(new THREE.SphereGeometry(0.07, 12, 8).scale(1, 0.8, 1.05).translate(head[0] + 0.03, head[1] - 0.06, pz), SKIN));  // jaw
    skin.push(tint(new THREE.SphereGeometry(0.018, 6, 5).scale(1.2, 1.3, 0.9).translate(head[0] + 0.093, head[1] - 0.01, pz), SKIN)); // nose
    for (const e of [-1, 1]) { skin.push(tint(new THREE.SphereGeometry(0.022, 6, 5).scale(0.5, 1, 1).translate(head[0] - 0.005, head[1] - 0.005, pz + e * 0.087), SKIN)); // ears
      skin.push(tint(new THREE.SphereGeometry(0.011, 6, 5).translate(head[0] + 0.082, head[1] + 0.018, pz + e * 0.034), EYE)); }        // eyes
    skin.push(tint(new THREE.CylinderGeometry(0.036, 0.042, 0.1, 10).translate(head[0] + 0.01, head[1] - 0.13, pz), SKIN));          // neck
    // hair: a cap over the crown and back of the head, a fringe over the brow
    hair.push(new THREE.SphereGeometry(0.106, 16, 10, 0, Math.PI * 2, 0, 1.75).scale(0.97, 1.02, 0.9).rotateZ(0.42).translate(head[0] - 0.012, head[1] + 0.012, pz));
    hair.push(new THREE.SphereGeometry(0.06, 10, 6).scale(0.6, 0.45, 1.35).translate(head[0] + 0.06, head[1] + 0.07, pz));
    // torso: a rounded chest and shoulders leaning back with the seat, collar round the neck
    const sh = [hx - 0.17, hy0 + 0.6], hip = [hx - 0.1, hy0 + 0.1];
    shirt.push(cap(0.13, [hip[0], hip[1] + 0.1, pz], [sh[0], sh[1] - 0.08, pz]).scale(1, 1, 1).translate(0, 0, 0));
    shirt.push(new THREE.CapsuleGeometry(0.075, 0.28, 4, 10).rotateX(Math.PI / 2).translate(sh[0], sh[1], pz));                        // shoulders
    shirt.push(new THREE.TorusGeometry(0.045, 0.014, 6, 12).rotateX(Math.PI / 2).translate(head[0] + 0.01, head[1] - 0.17, pz));     // collar
    // seat belt from the outboard shoulder across to the inboard hip
    { const out = drive ? 1 : -1; skin.push(tint(cap(0.012, [sh[0] + 0.07, sh[1] + 0.02, pz + out * 0.15], [hip[0] + 0.15, hip[1] + 0.1, pz - out * 0.15]), BELT)); }
    // arms: upper arm, forearm, hand
    for (const e of [-1, 1]) {
      const S = [sh[0], sh[1] - 0.02, pz + e * 0.17];
      const H = drive ? [dx0 - 0.3, B0 + 0.03 + e * 0.1, dz + e * 0.13] : [hx + 0.26, hy0 + 0.16, pz + e * 0.09];
      const E = drive ? [hx + 0.07, hy0 + 0.33, pz + e * 0.22] : [hx + 0.02, hy0 + 0.28, pz + e * 0.21];
      shirt.push(cap(0.047, S, E)); shirt.push(cap(0.04, E, [lerp(E[0], H[0], 0.85), lerp(E[1], H[1], 0.85), lerp(E[2], H[2], 0.85)]));
      skin.push(tint(new THREE.SphereGeometry(0.036, 8, 6).scale(1.2, 0.8, 1).translate(...H), SKIN));
      // legs: thigh along the cushion, shin down to the pedals, a shoe
      const K = [hx + 0.34, hy0 + 0.22, pz + e * 0.1], A = [hx + 0.55, floorY + 0.08, pz + e * 0.1];
      skin.push(tint(cap(0.068, [hip[0] + 0.02, hip[1] - 0.01, pz + e * 0.09], K), PANTS), tint(cap(0.052, K, A), PANTS));
      skin.push(tint(new THREE.BoxGeometry(0.22, 0.07, 0.09).translate(A[0] + 0.06, floorY + 0.035, A[2]), SHOE));
    }
    return { skin: mergeC(skin), hair: merge(hair.map(g => g.index ? g.toNonIndexed() : g)), shirt: merge(shirt.map(g => g.index ? g.toNonIndexed() : g)) };
  };
  { const d = person(dz, true), q = person(-dz, false);
    parts.driverSkin = d.skin; parts.driverHair = d.hair; parts.driverCloth = d.shirt;
    parts.paxSkin = q.skin; parts.paxHair = q.hair; parts.paxCloth = q.shirt; }
  parts.plate = merge([boxG(0.02, 0.165, 0.33, hl + 0.09, 0.5, 0), boxG(0.02, 0.165, 0.33, -hl - 0.09, 0.6, 0)]);
  const hy = bodyPts[2][1] - 0.1;
  parts.head = merge([boxG(0.05, 0.12, 0.3, hl - 0.01, hy, T.W / 2 - 0.22), boxG(0.05, 0.12, 0.3, hl - 0.01, hy, -T.W / 2 + 0.22)]);
  parts.chrome = merge([boxG(0.04, 0.17, 0.36, hl - 0.03, hy, T.W / 2 - 0.22), boxG(0.04, 0.17, 0.36, hl - 0.03, hy, -T.W / 2 + 0.22)]);
  const ty = T.truck ? 0.62 : bodyPts[bodyPts.length - 1][1] - 0.35;
  parts.tail = merge([boxG(0.05, 0.3, 0.14, -hl - 0.01, ty, T.W / 2 - 0.1), boxG(0.05, 0.3, 0.14, -hl - 0.01, ty, -T.W / 2 + 0.1)]);
  parts.shadow = new THREE.PlaneGeometry(T.L + 0.7, T.W + 0.6).rotateX(-Math.PI / 2).translate(0, 0.025, 0);
  const tire = new THREE.CylinderGeometry(T.r, T.r, 0.17, 20); tire.rotateX(Math.PI / 2);
  const rimParts = [new THREE.CylinderGeometry(T.r * 0.64, T.r * 0.64, 0.02, 18).rotateX(Math.PI / 2).translate(0, 0, 0.07),
    new THREE.CylinderGeometry(T.r * 0.18, T.r * 0.18, 0.05, 10).rotateX(Math.PI / 2).translate(0, 0, 0.09)];
  for (let k = 0; k < 5; k++) rimParts.push(new THREE.BoxGeometry(T.r * 0.5, 0.055, 0.03).translate(T.r * 0.3, 0, 0.09).rotateZ(k / 5 * Math.PI * 2));
  const rim = merge(rimParts);
  // sculpt the extruded shells: rounded corners in plan view, tumblehome above the belt line, tucked-in bumpers
  const roofTop = roofY;
  const sculpt = (g) => {
    const P = g.attributes.position;
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i); let z = P.getZ(i);
      const rc = Math.min(0.55, T.L * 0.14), ax = Math.abs(x) - (hl - rc);
      if (ax > 0) z *= 1 - 0.2 * Math.pow(Math.min(1, ax / rc), 2);
      if (y > T.belt) z *= 1 - 0.13 * Math.min(1, (y - T.belt) / Math.max(0.2, roofTop - T.belt));
      if (y < 0.5) z *= 1 - 0.035 * (0.5 - y) / 0.2;
      z *= 1 + 0.02 * Math.cos(Math.min(1, Math.abs(x) / hl) * Math.PI / 2); // slight side bulge
      P.setZ(i, z);
    }
    P.needsUpdate = true;
    return g;
  };
  const smooth = g => { g.deleteAttribute('normal'); g.deleteAttribute('uv'); const m = mergeVertices(g, 1e-3); m.computeVertexNormals(); return m; };
  parts.paint = T.truck ? sculpt(parts.paint) : smooth(sculpt(parts.paint));
  parts.glass = smooth(sculpt(parts.glass));
  for (const k of ['trim', 'plate', 'head', 'chrome', 'tail', 'cabin']) sculpt(parts[k]);
  return { parts, tire, rim, T };
}

// ---------------------------------------------------------------- fleet: instanced rendering of all cars
const _m = new THREE.Matrix4(), _w = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _c = new THREE.Color();
export class Fleet {
  constructor(specs) { // specs: [{type, color}]
    this.cars = [];
    const byType = {};
    specs.forEach((sp, i) => { (byType[sp.type] ||= []).push(i); });
    this.types = {};
    for (const [type, idxs] of Object.entries(byType)) {
      const G = buildType(TYPES[type]), n = idxs.length, mk = (geo, mat, cnt, shadow = true) => {
        const im = new THREE.InstancedMesh(geo, mat, cnt); im.castShadow = shadow; im.receiveShadow = true; im.frustumCulled = false; scene.add(im); return im;
      };
      const M = { paint: mk(G.parts.paint, paintMat, n), glass: mk(G.parts.glass, glassMat, n), trim: mk(G.parts.trim, trimMat, n, false), plate: mk(G.parts.plate, plateMat, n, false),
        head: mk(G.parts.head, headMat, n, false), tail: mk(G.parts.tail, tailMat, n, false), chrome: mk(G.parts.chrome, chromeMat, n, false), shadow: mk(G.parts.shadow, shadowMat, n, false),
        tire: mk(G.tire, tireMat, n * 4), rim: mk(G.rim, rimMat, n * 4, false),
        cabin: mk(G.parts.cabin, cabinMat, n, false), driverSkin: mk(G.parts.driverSkin, cabinMat, n, false), driverCloth: mk(G.parts.driverCloth, clothMat, n, false),
        driverHair: mk(G.parts.driverHair, hairMat, n, false), paxSkin: mk(G.parts.paxSkin, cabinMat, n, false), paxCloth: mk(G.parts.paxCloth, clothMat, n, false), paxHair: mk(G.parts.paxHair, hairMat, n, false) };
      M.glass.renderOrder = 3; M.shadow.receiveShadow = false;
      this.types[type] = { G, M };
      idxs.forEach((si, k) => {
        const sp = specs[si], T = TYPES[type];
        const car = { type, k, T, spin: 0, x: 0, y: 0, z: 0, r: 0 };
        M.paint.setColorAt(k, _c.setRGB(...(sp.color || PAINTS[0])));
        M.plate.setColorAt(k, T.kei ? _c.setRGB(0.95, 0.82, 0.1) : _c.setRGB(0.95, 0.95, 0.93));
        M.head.setColorAt(k, _c.setRGB(0.1, 0, 0)); M.tail.setColorAt(k, _c.setRGB(0.1, 0, 0));
        M.driverCloth.setColorAt(k, _c.setRGB(...CLOTH[(si * 7 + 3) % CLOTH.length])); M.paxCloth.setColorAt(k, _c.setRGB(...CLOTH[(si * 5 + 1) % CLOTH.length]));
        M.driverHair.setColorAt(k, _c.setRGB(...HAIRS[(si * 3 + 1) % HAIRS.length])); M.paxHair.setColorAt(k, _c.setRGB(...HAIRS[(si * 11 + 2) % HAIRS.length]));
        this.cars[si] = car;
      });
    }
  }
  place(car, x, y, z, r, dist = 0, head = 0, tail = 0) {
    const { M, G } = this.types[car.type], T = car.T, k = car.k;
    car.x = x; car.y = y; car.z = z; car.r = r;
    _e.set(0, r, 0); _q.setFromEuler(_e); _p.set(x, y, z);
    _m.compose(_p, _q, _s);
    for (const key of ['paint', 'glass', 'trim', 'plate', 'head', 'tail', 'chrome', 'shadow', 'cabin']) M[key].setMatrixAt(k, _m);
    for (const key of ['driverSkin', 'driverCloth', 'driverHair']) M[key].setMatrixAt(k, car.driver ? _m : _zero);
    for (const key of ['paxSkin', 'paxCloth', 'paxHair']) M[key].setMatrixAt(k, car.driver && car.pax ? _m : _zero);
    car.spin -= dist / T.r;
    const [fx, rx] = wheelX(T);
    let i = 0;
    for (const wx of [fx, rx]) for (const side of [-1, 1]) {
      _e.set(side > 0 ? 0 : Math.PI, 0, car.spin * side); _q.setFromEuler(_e);
      _w.compose(_p.set(wx, T.r, side * (T.W / 2 - 0.13)), _q, _s);
      _w.premultiply(_m);
      M.tire.setMatrixAt(k * 4 + i, _w); M.rim.setMatrixAt(k * 4 + i, _w); i++;
    }
    M.head.setColorAt(k, _c.setRGB(head, 0, 0)); M.tail.setColorAt(k, _c.setRGB(tail, 0, 0));
  }
  commit() {
    for (const { M } of Object.values(this.types)) for (const im of Object.values(M)) {
      im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }
}
export const CAR_TYPES = Object.keys(TYPES);
export function randomCar(rng, trucks = true) {
  const r = rng();
  // (the compact hatch and the kei pickup are retired: crude shapes that also left no headroom for the occupants)
  const type = r < 0.34 ? 'keiTall' : r < 0.58 ? 'keiHatch' : r < 0.8 ? 'minivan' : r < 0.93 ? 'van' : 'taxi'; void trucks;
  const color = type === 'taxi' ? [0.08, 0.1, 0.2] : type === 'van' || type === 'keiTruck' ? (rng() < 0.8 ? [0.93, 0.93, 0.92] : [0.62, 0.64, 0.66]) : PAINTS[Math.floor(rng() * PAINTS.length)];
  return { type, color };
}
export const carDims = type => TYPES[type];

// ---------------------------------------------------------------- routes and simulation
// A route is a polyline (closed loop) with filleted corners, sampled every ~1 m.
export class Route {
  constructor(pts, { closed = true, vmax = 11, lane = 1.6, fillet = 7 } = {}) {
    this.vmax = vmax; this.lane = lane; this.closed = closed;
    const P = [], n = pts.length;
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      if (!closed && (i === 0 || i === n - 1)) { P.push(p); continue; }
      const a = pts[(i + n - 1) % n], b = pts[(i + 1) % n];
      const da = Math.hypot(a[0] - p[0], a[1] - p[1]), db = Math.hypot(b[0] - p[0], b[1] - p[1]), r = Math.min(fillet, da / 2.1, db / 2.1);
      const p1 = [p[0] + (a[0] - p[0]) / da * r, p[1] + (a[1] - p[1]) / da * r], p2 = [p[0] + (b[0] - p[0]) / db * r, p[1] + (b[1] - p[1]) / db * r];
      for (let k = 0; k <= 6; k++) { const t = k / 6, u = 1 - t; P.push([u * u * p1[0] + 2 * u * t * p[0] + t * t * p2[0], u * u * p1[1] + 2 * u * t * p[1] + t * t * p2[1]]); }
    }
    if (closed) P.push(P[0]);
    // resample
    this.pts = []; this.s = [];
    let acc = 0;
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i], b = P[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), steps = Math.max(1, Math.round(L));
      for (let k = 0; k < steps; k++) { this.pts.push([lerp(a[0], b[0], k / steps), lerp(a[1], b[1], k / steps)]); this.s.push(acc + L * k / steps); }
      acc += L;
    }
    this.pts.push(P[P.length - 1]); this.s.push(acc);
    this.len = acc;
    this.stops = []; // {s, kind: 'stop'|'crossing', crossing}
  }
  at(s, out) {
    s = this.closed ? ((s % this.len) + this.len) % this.len : clamp(s, 0, this.len);
    let lo = 0, hi = this.s.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.s[m] <= s) lo = m; else hi = m; }
    const a = this.pts[lo], b = this.pts[hi], t = (s - this.s[lo]) / Math.max(1e-6, this.s[hi] - this.s[lo]);
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
    out.x = lerp(a[0], b[0], t); out.z = lerp(a[1], b[1], t); out.dx = dx / l; out.dz = dz / l;
    return out;
  }
  curvature(s) { const a = {}, b = {}; this.at(s, a); this.at(s + 6, b); return Math.acos(clamp(a.dx * b.dx + a.dz * b.dz, -1, 1)) / 6; }
}

const tmpA = {}, tmpB = {};
export class Traffic {
  constructor(fleet, groundAt) { this.fleet = fleet; this.groundAt = groundAt; this.movers = []; this.emitters = [0, 1, 2, 3].map(() => new Emitter('engine')); }
  add(car, route, s) { car.driver = true; car.pax = ((car.k * 7919 + car.type.length * 31) % 100) < 35; this.movers.push({ car, route, s, v: route.vmax * 0.5, wait: 0, stopIdx: this.nextStop(route, s), brake: 0 }); }
  nextStop(route, s) { let best = -1, bd = 1e9; route.stops.forEach((st, i) => { const d = ((st.s - s) % route.len + route.len) % route.len; if (d < bd) { bd = d; best = i; } }); return best; }
  update(dt, player, headlights) {
    const M = this.movers;
    for (const m of M) {
      const R = m.route, pos = R.at(m.s, tmpA);
      const hx = pos.dx, hz = pos.dz;
      m.wx = pos.x + hz * R.lane; m.wz = pos.z - hx * R.lane; m.hx = hx; m.hz = hz; // drive on the left: offset to the left of travel (x right, z toward the viewer)
    }
    for (const m of M) {
      const R = m.route;
      let target = R.vmax;
      target = Math.min(target, Math.sqrt(2.6 / Math.max(R.curvature(m.s), 1e-4)));
      // car ahead (any route) within the lane corridor
      let gap = 1e9;
      for (const o of M) {
        if (o === m) continue;
        const dx = o.wx - m.wx, dz = o.wz - m.wz, ahead = dx * m.hx + dz * m.hz, lat = Math.abs(-dx * m.hz + dz * m.hx);
        if (ahead > 0 && ahead < 30 && lat < 1.6 && o.hx * m.hx + o.hz * m.hz > 0.3) gap = Math.min(gap, ahead - (o.car.T.L + m.car.T.L) / 2);
      }
      { // pedestrians (the player)
        const dx = player.x - m.wx, dz = player.z - m.wz, ahead = dx * m.hx + dz * m.hz, lat = Math.abs(-dx * m.hz + dz * m.hx);
        if (ahead > 0 && ahead < 14 && lat < 1.7 && Math.abs(player.y - m.car.y) < 3) gap = Math.min(gap, ahead - m.car.T.L / 2 - 1.5);
      }
      if (gap < 1e8) target = Math.min(target, Math.max(0, (gap - 2.5) * 0.9));
      // mandatory stops: stop signs and level crossings (Japanese law: always stop before a crossing)
      if (m.stopIdx >= 0) {
        const st = R.stops[m.stopIdx];
        let d = ((st.s - m.s) % R.len + R.len) % R.len - m.car.T.L / 2 - 0.5;
        if (d > R.len - 20) d = -1;
        if (st.signal) {
          if (d <= 0.6 && st.signal.go(d)) { m.stopIdx = (m.stopIdx + 1) % R.stops.length; m.stoppedHere = false; }
          else if (d < 40 && !st.signal.go(d)) target = Math.min(target, d > 0.6 ? Math.sqrt(2 * 2.8 * Math.max(0, d - 0.3)) : 0);
        } else if (d < 40) {
          const blocked = st.crossing && (st.crossing.active || st.crossing.down > 0.02);
          if (m.wait <= 0 && d > 0.6) target = Math.min(target, Math.sqrt(2 * 2.8 * Math.max(0, d - 0.3)));
          else if (d <= 0.6) {
            if (m.v < 0.4 && m.wait <= 0 && !m.stoppedHere) { m.wait = st.crossing ? 2.2 : 1.2; m.stoppedHere = true; }
            if (m.wait > 0) { m.wait -= dt; target = 0; }
            if (blocked) { target = 0; m.wait = Math.max(m.wait, 0.8); }
            if (m.stoppedHere && m.wait <= 0 && !blocked) { m.stopIdx = (m.stopIdx + 1) % R.stops.length; m.stoppedHere = false; }
            else if (!m.stoppedHere) target = Math.min(target, 0.3);
          }
        }
      }
      const prev = m.v;
      m.v = target > m.v ? Math.min(target, m.v + 1.8 * dt) : Math.max(target, m.v - Math.max(2.5, (m.v - target) * 3) * dt);
      m.brake = m.v < prev - 0.02 || m.v < 0.05 ? 1 : 0;
      m.accel = (m.v - prev) / Math.max(dt, 1e-3);
      m.s += m.v * dt;
      if (!R.closed && m.s > R.len) m.s = 0;
      const y = this.groundAt(m.wx, m.wz);
      this.fleet.place(m.car, m.wx, y, m.wz, Math.atan2(m.hx, m.hz) - Math.PI / 2, m.v * dt, headlights ? 1.4 : 0.02, (headlights ? 0.45 : 0.08) + m.brake * 0.9);
    }
    // engine sounds for the nearest few cars
    const near = M.map(m => ({ m, d: Math.hypot(m.wx - player.x, m.wz - player.z) })).sort((a, b) => a.d - b.d).slice(0, this.emitters.length);
    this.emitters.forEach((e, i) => { const n = near[i]; e.on = !!n && n.d < 90; if (n) e.set(n.m.wx, n.m.car.y + 0.5, n.m.wz, { speed: n.m.v, accel: n.m.accel }); });
  }
  // push the player out of moving cars
  collide(p) {
    for (const m of this.movers) {
      const T = m.car.T, dx = p.x - m.wx, dz = p.z - m.wz;
      if (dx * dx + dz * dz > 16) continue;
      let lx = dx * m.hx + dz * m.hz, lz = -dx * m.hz + dz * m.hx;
      const ox = T.L / 2 + 0.35 - Math.abs(lx), oz = T.W / 2 + 0.35 - Math.abs(lz);
      if (ox > 0 && oz > 0 && p.y < m.car.y + 1.6) {
        if (ox < oz) lx += Math.sign(lx) * ox; else lz += Math.sign(lz) * oz;
        p.x = m.wx + lx * m.hx - lz * m.hz; p.z = m.wz + lx * m.hz + lz * m.hx;
      }
    }
  }
}
