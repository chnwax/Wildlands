// Cars: procedural Japanese car models (kei wagons, compacts, kei trucks, vans, taxis) rendered with instancing,
// and a left-hand-traffic simulation along road loops with car-following, stop signs and level-crossing logic.
import { THREE, scene, Q, clamp, lerp, mulberry32, addBox } from './core.js';
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
// far level of detail (cars beyond Fleet.lodDist): the same shapes with fewer segments on curves, bevels and rounds
let LO = false;
const sg = (n, min = 3) => LO ? Math.max(min, Math.round(n / 2)) : n;
function extrude(shape, width, bevel = 0.05) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.01, width - bevel * 2), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.6, bevelSegments: LO ? 1 : 3, curveSegments: LO ? 2 : 5 });
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
    seats: { floor: 0.4, frontFromDash: 0.58, rearGap: 0.86, track: 0.34 },
    body: [[-1.69, 0.3], [1.69, 0.3], [1.69, 0.8], [1.32, 1.0], [0.96, 1.75], [-1.62, 1.78], [-1.69, 1.45]] },
  keiHatch: { L: 3.39, W: 1.47, belt: 0.98, wb: 2.46, r: 0.28, kei: true,
    seats: { floor: 0.36, frontFromDash: 0.58, rearGap: 0.84, track: 0.33 },
    body: [[-1.69, 0.3], [1.69, 0.3], [1.69, 0.72], [1.2, 0.92], [0.62, 1.62], [-1.5, 1.64], [-1.69, 1.2]] },
  compact: { L: 4.05, W: 1.69, belt: 0.92, wb: 2.55, r: 0.3, kei: false,
    seats: { floor: 0.35, frontFromDash: 0.63, rearGap: 0.96, track: 0.39 },
    body: [[-2.02, 0.32], [2.02, 0.32], [2.02, 0.62], [1.35, 0.86], [0.45, 1.46], [-1.1, 1.48], [-1.95, 1.02]] },
  minivan: { L: 4.69, W: 1.69, belt: 1.02, wb: 2.85, r: 0.31, kei: false,
    seats: { floor: 0.4, frontFromDash: 0.62, rearGap: 1.04, track: 0.39 },
    body: [[-2.34, 0.32], [2.34, 0.32], [2.34, 0.78], [1.72, 1.0], [1.02, 1.82], [-2.25, 1.85], [-2.34, 1.5]] },
  van: { L: 4.69, W: 1.69, belt: 1.12, wb: 2.57, r: 0.3, kei: false,
    seats: { floor: 0.46, frontFromDash: 0.6, rearGap: 1.02, track: 0.39 },
    body: [[-2.34, 0.32], [2.34, 0.32], [2.34, 1.0], [2.1, 1.25], [1.72, 1.95], [-2.3, 1.98], [-2.34, 1.7]] },
  taxi: { L: 4.4, W: 1.7, belt: 1.0, wb: 2.75, r: 0.3, kei: false, taxi: true,
    seats: { floor: 0.38, frontFromDash: 0.62, rearGap: 1.02, track: 0.39 },
    body: [[-2.2, 0.32], [2.2, 0.32], [2.2, 0.75], [1.5, 0.95], [0.9, 1.72], [-1.95, 1.75], [-2.2, 1.35]] },
  keiTruck: { L: 3.39, W: 1.47, belt: 1.12, wb: 1.9, r: 0.27, kei: true, truck: true,
    seats: { floor: 0.43, frontFromDash: 0.55, track: 0.34 },
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
const BODY = ['paint', 'glass', 'trim', 'plate', 'head', 'tail', 'chrome', 'shadow', 'cabin'];
// Occupants: one mesh per material holding every seat of the body (attribute seat 0..3: driver, front passenger, rear
// right, rear left). Per car a vec4 seatCol carries, per seat, the colour packed as r*65536+g*256+b (8 bits each) or
// -1 for an empty seat, whose vertices then collapse: three draws a set however the cars are filled.
const SEATS = ['driver', 'pax', 'rearR', 'rearL'], OCC_KEYS = ['occSkin', 'occCloth', 'occHair'];
const packCol = c => Math.round(clamp(c[0], 0, 1) * 255) * 65536 + Math.round(clamp(c[1], 0, 1) * 255) * 256 + Math.round(clamp(c[2], 0, 1) * 255);
function seatedMat(base, tinted) {
  const m = base.clone();
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
      attribute float seat; attribute vec4 seatCol; varying vec3 vSeatCol;`).replace('#include <begin_vertex>', `#include <begin_vertex>
      float sc = seat < 0.5 ? seatCol.x : seat < 1.5 ? seatCol.y : seat < 2.5 ? seatCol.z : seatCol.w;
      if (sc < 0.0) transformed = vec3(0.0);
      vSeatCol = vec3(floor(sc / 65536.0), mod(floor(sc / 256.0), 256.0), mod(sc, 256.0)) / 255.0;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vSeatCol;')
      .replace('#include <color_fragment>', '#include <color_fragment>' + (tinted ? '\n diffuseColor.rgb *= vSeatCol;' : ''));
  };
  m.customProgramCacheKey = () => 'seated' + (tinted ? 1 : 0);
  return m;
}
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

// ---------------------------------------------------------------- occupants
// A seated person posed from a seat anchor A: h the H-point (hip-joint centre on the cushion), back the backrest angle
// from vertical, heel where the heels rest on the floor (at the pedals, or under the seat ahead), out the door side (+1
// right / -1 left), wheel the steering-wheel rim { c, r, z, up } for the driver (hands at ten to two) or null (hands in
// the lap), style the hair ('short' | 'bob' | 'long' | 'tied'), s the body scale. Limbs are two-bone chains solved
// to their targets (elbows down and out, knees up). Anime proportions — a round head a little large for the body, big
// dark eyes, simple hair masses — on a believable seated adult. Returns the skin mesh (also the fixed-colour trousers,
// shoes, eyes and seat belt), the shirt (tinted per car) and the hair (tinted per car), and the head's top and the
// shoulders' reach for the cabin fit.
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const capsule = (r, a, b) => { const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), L = d.length(), g = new THREE.CapsuleGeometry(r, Math.max(0.001, L), sg(4, 2), sg(10));
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())); g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2); return g; };
function ik2(a, t, l1, l2, pole) {
  const d = t.clone().sub(a), L = Math.min(Math.max(d.length(), Math.abs(l1 - l2) + 1e-3), (l1 + l2) * 0.999); d.normalize();
  const x = (l1 * l1 - l2 * l2 + L * L) / (2 * L), h = Math.sqrt(Math.max(0, l1 * l1 - x * x)), p = pole.clone().addScaledVector(d, -pole.dot(d)).normalize();
  return { joint: a.clone().addScaledVector(d, x).addScaledVector(p, h), end: a.clone().addScaledVector(d, L) };
}
function seatedFigure(A) {
  const s = A.s, skin = [], shirt = [], hair = [], [hx, hy, hz] = A.h, H = V3(hx, hy, hz), put = (g, c) => skin.push(tint(g, c));
  const SKIN = A.skin, PANTS = A.pants, SHOE = [0.12, 0.1, 0.09], BELT = [0.16, 0.16, 0.17], EYE = [0.17, 0.11, 0.09];
  const up = V3(-Math.sin(A.back), Math.cos(A.back), 0);                         // along the spine, leaning with the backrest
  const S0 = H.clone().addScaledVector(up, 0.5 * s);                             // middle of the shoulder line
  const head = V3(S0.x + 0.035 * s, S0.y + 0.215 * s, hz), R = 0.112 * s;        // the head held upright over the neck
  // torso: chest and belly a flattened capsule from the pelvis up the backrest, a rounded shoulder bar, the hips
  { const g = new THREE.CapsuleGeometry(0.125 * s, 0.3 * s, sg(4, 2), sg(12)).scale(0.74, 1, 1.22).rotateZ(A.back); g.translate(...H.clone().addScaledVector(up, 0.27 * s).toArray()); shirt.push(g); }
  shirt.push(new THREE.CapsuleGeometry(0.068 * s, 0.27 * s, sg(4, 2), sg(10)).rotateX(Math.PI / 2).translate(S0.x, S0.y - 0.02 * s, hz));
  put(new THREE.CapsuleGeometry(0.11 * s, 0.17 * s, sg(4, 2), sg(10)).rotateX(Math.PI / 2).translate(hx, hy + 0.01, hz), PANTS);
  shirt.push(new THREE.TorusGeometry(0.048 * s, 0.016 * s, sg(6), sg(12)).rotateX(Math.PI / 2).translate(head.x - 0.02 * s, S0.y + 0.03 * s, hz)); // collar
  put(new THREE.CylinderGeometry(0.038 * s, 0.045 * s, 0.11 * s, sg(10)).translate(head.x - 0.015 * s, S0.y + 0.07 * s, hz), SKIN);                 // neck
  // head: round skull and soft jaw, a small nose, ears, big dark eyes; brows in the hair colour
  put(new THREE.SphereGeometry(R, sg(16), sg(12)).scale(0.94, 1.04, 0.9).translate(head.x, head.y, hz), SKIN);
  put(new THREE.SphereGeometry(R * 0.7, sg(12), sg(8)).scale(1, 0.78, 1).translate(head.x + 0.028 * s, head.y - 0.055 * s, hz), SKIN);
  put(new THREE.SphereGeometry(R * 0.15, sg(6), sg(5)).scale(1.1, 1.2, 0.8).translate(head.x + R * 0.93, head.y - 0.012 * s, hz), SKIN);
  for (const e of [-1, 1]) {
    put(new THREE.SphereGeometry(R * 0.2, sg(6), sg(5)).scale(0.45, 1, 1).translate(head.x - 0.01 * s, head.y - 0.005 * s, hz + e * R * 0.88), SKIN);
    put(new THREE.SphereGeometry(R * 0.16, sg(8), sg(6)).scale(0.45, 1.25, 0.85).translate(head.x + R * 0.84, head.y + 0.012 * s, hz + e * R * 0.36), EYE);
    hair.push(new THREE.BoxGeometry(0.012 * s, 0.01 * s, 0.045 * s).rotateX(e * 0.12).translate(head.x + R * 0.87, head.y + 0.05 * s, hz + e * R * 0.37));
  }
  // hair: a cap over the crown and the back of the head and a fringe, then the style's masses
  hair.push(new THREE.SphereGeometry(R * 1.08, sg(16), sg(10), 0, Math.PI * 2, 0, 1.8).scale(0.97, 1.02, 0.94).rotateZ(0.4).translate(head.x - 0.012 * s, head.y + 0.012 * s, hz));
  hair.push(new THREE.SphereGeometry(R * 0.62, sg(10), sg(6)).scale(0.55, 0.42, 1.38).translate(head.x + R * 0.58, head.y + R * 0.66, hz));
  if (A.style === 'bob' || A.style === 'long') for (const e of [-1, 1]) hair.push(new THREE.CapsuleGeometry(R * 0.36, R * (A.style === 'long' ? 1.3 : 0.62), sg(4, 2), sg(8)).scale(1, 1, 0.6).translate(head.x - R * 0.15, head.y - R * (A.style === 'long' ? 0.75 : 0.4), hz + e * R * 0.8));
  if (A.style === 'long') hair.push(new THREE.CapsuleGeometry(R * 0.7, R * 1.5, sg(4, 2), sg(10)).scale(0.6, 1, 1.15).rotateZ(A.back * 0.6).translate(head.x - R * 0.72, head.y - R * 1.0, hz));
  if (A.style === 'bob') hair.push(new THREE.SphereGeometry(R * 0.95, sg(12), sg(8)).scale(0.7, 0.75, 1.02).translate(head.x - R * 0.45, head.y - R * 0.45, hz));
  if (A.style === 'tied') hair.push(new THREE.SphereGeometry(R * 0.36, sg(8), sg(6)).translate(head.x - R * 1.02, head.y + R * 0.15, hz));
  // arms: from the shoulders to the wheel rim at ten to two, or to the thighs
  for (const e of [-1, 1]) {
    const sh = S0.clone().add(V3(0, -0.025 * s, e * 0.175 * s));
    const t = A.wheel ? A.wheel.c.clone().addScaledVector(A.wheel.z, e * A.wheel.r * 0.87).addScaledVector(A.wheel.up, A.wheel.r * 0.45) : V3(hx + 0.27 * s, hy + 0.1 * s, hz + e * 0.1 * s);
    const k = ik2(sh, t, 0.3 * s, 0.28 * s, V3(-0.2, -1, e * 0.7));
    shirt.push(capsule(0.046 * s, sh.toArray(), k.joint.toArray()), capsule(0.038 * s, k.joint.toArray(), k.end.toArray()));
    put(new THREE.SphereGeometry(0.04 * s, sg(8), sg(6)).scale(1.15, 0.8, 0.9).translate(k.end.x, k.end.y, k.end.z), SKIN);
  }
  // legs: hips to the heels with the knees up, a shoe on the floor
  for (const e of [-1, 1]) {
    const hip = V3(hx + 0.02 * s, hy - 0.01, hz + e * 0.095 * s), ank = V3(A.heel[0] + 0.04, A.heel[1] + 0.085 * s, hz + e * (A.wheel ? 0.12 : 0.1) * s);
    const k = ik2(hip, ank, 0.45 * s, 0.43 * s, V3(0.4, 1, 0));
    put(capsule(0.07 * s, hip.toArray(), k.joint.toArray()), PANTS); put(capsule(0.053 * s, k.joint.toArray(), k.end.toArray()), PANTS);
    put(new THREE.CapsuleGeometry(0.045 * s, 0.17 * s, sg(3, 2), sg(8)).rotateZ(Math.PI / 2).scale(1, 0.9, 1.1).translate(k.end.x + 0.07 * s, A.heel[1] + 0.045 * s, k.end.z), SHOE);
  }
  // the seat belt: from the door-side shoulder across the chest to the inboard hip, and the lap strap
  const o = A.out;
  put(capsule(0.011, S0.clone().add(V3(0.075 * s, 0.01, o * 0.14 * s)).toArray(), [hx + 0.12 * s, hy + 0.08 * s, hz - o * 0.15 * s]), BELT);
  put(capsule(0.01, [hx + 0.1 * s, hy + 0.06 * s, hz - o * 0.17 * s], [hx + 0.08 * s, hy + 0.04 * s, hz + o * 0.19 * s]), BELT);
  return { skin: mergeC(skin), shirt: merge(shirt.map(g => g.index ? g.toNonIndexed() : g)), hair: merge(hair.map(g => g.index ? g.toNonIndexed() : g)),
    top: head.y + R * 1.13, headX: head.x, reach: Math.abs(hz) + 0.25 * s, shoulderY: S0.y };
}
// who sits where (skin tone and trousers per seat; shirts and hair are tinted per car)
const SEAT_LOOK = {
  driver: { style: 'short', skin: [0.84, 0.58, 0.43], pants: [0.05, 0.06, 0.09] },   // (linear colours: warm peach skin tones)
  pax:    { style: 'long', skin: [0.9, 0.66, 0.52], pants: [0.24, 0.2, 0.15] },
  rearR:  { style: 'bob', skin: [0.78, 0.52, 0.37], pants: [0.06, 0.1, 0.19] },
  rearL:  { style: 'tied', skin: [0.88, 0.63, 0.49], pants: [0.09, 0.09, 0.1] },
};

function buildType(T) {
  const hl = T.L / 2;
  const bodyPts = T.body;
  const parts = {};
  const roofY = Math.max(...bodyPts.map(p => p[1]));
  // painted shell = lower body (below the belt line) + roof panel + pillars; the greenhouse is real glass. The lower body is
  // hollow where the cabin is: a bonnet block ahead of the dashboard, a tail block behind the cabin, thin door skins
  // along the sides and a floor pan, so the seats, dashboard and driver sit in a real cabin under the glass
  const lower = clipBelow(withArches(bodyPts, T), T.belt + 0.02);
  const wsx0 = bodyPts[3][0], cx1 = wsx0 - 0.02, cx0 = T.truck ? bodyPts[0][0] + 0.1 : -hl + 0.32, skin = 0.07;
  const floorY = T.seats?.floor ?? 0.36; // each body style has a real seat/floor datum instead of sharing one generic occupant height
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
  const B0 = T.belt, dz = T.seats?.track ?? 0.34 * T.W / 1.47, cabin = [];
  const dx0 = cx1 - 0.55;                                                       // dashboard face
  cabin.push(tint(boxG(cx1 - dx0, B0 - floorY - 0.12, T.W - 2 * skin, (cx1 + dx0) / 2, (B0 + floorY + 0.12) / 2, 0), DASH));
  cabin.push(tint(new THREE.BoxGeometry(0.55, 0.06, T.W - 2 * skin).rotateZ(-0.18).translate((cx1 + dx0) / 2 + 0.02, B0 + 0.03, 0), DASH));   // dash top
  cabin.push(tint(boxG(0.22, 0.09, 0.42, dx0 + 0.1, B0 + 0.08, dz), PLAS));                                            // instrument hood
  cabin.push(tint(boxG(0.1, 0.34, 0.26, dx0 - 0.02, B0 - 0.2, 0), PLAS));                                              // centre stack
  cabin.push(tint(new THREE.CylinderGeometry(0.025, 0.03, 0.34, sg(8)).rotateZ(Math.PI / 2 - 0.45).translate(dx0 - 0.1, B0 - 0.05, dz), PLAS)); // column
  cabin.push(tint(new THREE.TorusGeometry(0.17, 0.022, sg(8), sg(22)).rotateY(Math.PI / 2).rotateZ(-0.45).translate(dx0 - 0.25, B0 + 0.02, dz), DASH));
  cabin.push(tint(new THREE.CylinderGeometry(0.05, 0.05, 0.05, sg(10)).rotateZ(Math.PI / 2 - 0.45).translate(dx0 - 0.25, B0 + 0.02, dz), PLAS)); // hub
  const sx = dx0 - (T.seats?.frontFromDash ?? 0.6);                             // centre of the front seat cushions
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
  const rx = sx - (T.seats?.rearGap ?? 1.0);
  if (!T.truck && rx - 0.35 > cx0) {                                             // rear bench
    cabin.push(tint(boxG(0.5, 0.16, T.W - 2 * skin - 0.1, rx, floorY + 0.2, 0), SEAT));
    cabin.push(tint(new THREE.BoxGeometry(0.12, 0.6, T.W - 2 * skin - 0.1).translate(0, 0.3, 0).rotateZ(0.22).translate(rx - 0.27, floorY + 0.26, 0), SEAT));
    for (const sd of [-1, 1]) cabin.push(tint(boxG(0.1, 0.15, 0.25, rx - 0.35, floorY + 0.87, sd * dz), SEAT));
  }
  parts.cabin = mergeC(cabin);
  // ---- occupants: seat anchors from this body's own cabin (cushion heights, backrest angles, the wheel, where feet
  // go), each figure then fitted to this body's roof line and door glass: it reclines a little, then is drawn slighter,
  // and a seat without room for a person stays empty (no head through the roof, no shoulder through the glass)
  const roofLine = x => { let y = -1; for (let i = 0; i < bodyPts.length; i++) { const a = bodyPts[i], b = bodyPts[(i + 1) % bodyPts.length];
    if (a[0] !== b[0] && (a[0] - x) * (b[0] - x) <= 0) y = Math.max(y, a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0])); } return y - 0.075; };
  const glassAt = y => (T.W / 2 - 0.05) * (1 - 0.13 * clamp((y - T.belt) / Math.max(0.2, roofY - T.belt), 0, 1)) - 0.03;
  const wheel = { c: V3(dx0 - 0.25, B0 + 0.02, dz), r: 0.17, z: V3(0, 0, 1), up: V3(Math.sin(0.45), Math.cos(0.45), 0) };
  const seat = (role, h, back, heel, out, drive) => {
    const look = SEAT_LOOK[role];
    for (const [b, sc] of [[back, 1], [back + 0.07, 1], [back + 0.12, 0.96], [back + 0.16, 0.92], [back + 0.18, 0.88], [back + 0.2, 0.84]]) {
      const hh = h.slice(), A = { h: hh, back: b, heel, out, wheel: drive ? wheel : null, s: sc, ...look };
      let f = seatedFigure(A);
      const over = f.reach - glassAt(f.shoulderY);
      if (over > 0 && over < 0.07) { hh[2] -= Math.sign(hh[2]) * over; if (drive) A.wheel = { ...wheel, c: wheel.c.clone().setZ(hh[2]) }; f = seatedFigure(A); }
      if (f.top <= roofLine(f.headX) - 0.025 && f.reach <= glassAt(f.shoulderY) + 0.005) return f;
    }
    return null;
  };
  const figs = [], seatIn = (role, f) => { if (f) figs.push([SEATS.indexOf(role), f]); };
  seatIn('driver', seat('driver', [sx - 0.11, floorY + 0.32, dz], 0.2, [dx0 - 0.12, floorY + 0.02], 1, true));
  seatIn('pax', seat('pax', [sx - 0.11, floorY + 0.32, -dz], 0.2, [dx0 - 0.16, floorY + 0.02], -1, false));
  if (!T.truck && rx - 0.35 > cx0) {
    seatIn('rearR', seat('rearR', [rx - 0.11, floorY + 0.37, dz], 0.22, [sx - 0.5, floorY + 0.02], 1, false));
    seatIn('rearL', seat('rearL', [rx - 0.11, floorY + 0.37, -dz], 0.22, [sx - 0.5, floorY + 0.02], -1, false));
  }
  const seated = (key, coloured) => { const list = figs.map(([k, f]) => { const g = f[key], n = g.attributes.position.count; g.setAttribute('seat', new THREE.BufferAttribute(new Float32Array(n).fill(k), 1)); return g; });
    if (!list.length) return null; const m = coloured ? mergeC(list) : merge(list), sa = new Float32Array(m.attributes.position.count); let o = 0;
    for (const g of list) { sa.set(g.attributes.seat.array, o); o += g.attributes.seat.count; } m.setAttribute('seat', new THREE.BufferAttribute(sa, 1)); return m; };
  parts.occSkin = seated('skin', true); parts.occCloth = seated('shirt', false); parts.occHair = seated('hair', false);
  parts.plate = merge([boxG(0.02, 0.165, 0.33, hl + 0.09, 0.5, 0), boxG(0.02, 0.165, 0.33, -hl - 0.09, 0.6, 0)]);
  const hy = bodyPts[2][1] - 0.1;
  parts.head = merge([boxG(0.05, 0.12, 0.3, hl - 0.01, hy, T.W / 2 - 0.22), boxG(0.05, 0.12, 0.3, hl - 0.01, hy, -T.W / 2 + 0.22)]);
  parts.chrome = merge([boxG(0.04, 0.17, 0.36, hl - 0.03, hy, T.W / 2 - 0.22), boxG(0.04, 0.17, 0.36, hl - 0.03, hy, -T.W / 2 + 0.22)]);
  const ty = T.truck ? 0.62 : bodyPts[bodyPts.length - 1][1] - 0.35;
  parts.tail = merge([boxG(0.05, 0.3, 0.14, -hl - 0.01, ty, T.W / 2 - 0.1), boxG(0.05, 0.3, 0.14, -hl - 0.01, ty, -T.W / 2 + 0.1)]);
  parts.shadow = new THREE.PlaneGeometry(T.L + 0.7, T.W + 0.6).rotateX(-Math.PI / 2).translate(0, 0.025, 0);
  const tire = new THREE.CylinderGeometry(T.r, T.r, 0.17, sg(20)); tire.rotateX(Math.PI / 2);
  const rimParts = [new THREE.CylinderGeometry(T.r * 0.64, T.r * 0.64, 0.02, sg(18)).rotateX(Math.PI / 2).translate(0, 0, 0.07),
    new THREE.CylinderGeometry(T.r * 0.18, T.r * 0.18, 0.05, sg(10)).rotateX(Math.PI / 2).translate(0, 0, 0.09)];
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
const _m = new THREE.Matrix4(), _w = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _c = new THREE.Color(), _qs = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);
const PART_MAT = { paint: paintMat, glass: glassMat, trim: trimMat, plate: plateMat, head: headMat, tail: tailMat, chrome: chromeMat, shadow: shadowMat, tire: tireMat, rim: rimMat,
  cabin: cabinMat, occSkin: seatedMat(cabinMat, false), occCloth: seatedMat(clothMat, true), occHair: seatedMat(hairMat, true) };
const CASTS = { paint: true, glass: true, tire: true };
const TINTED = ['paint', 'plate', 'head', 'tail'];
const OCCUPANT = new Set(OCC_KEYS);
// Every car keeps a stable identity (fleet.cars[id]: type, index within its type, transform, colours). What is drawn is
// derived from it each frame: per car type the near set — full detail within lodDist of the camera — and, beyond it,
// the same car with fewer segments. The far cars are spread over the whole town, so they are drawn as two lists: the
// cars inside the view, rebuilt every frame (the rest are never sent to the GPU), and every far car's shadow-casting
// shell (body, glass, tyres) on a layer only the shadow passes draw. A car moves between near and far with a few metres
// of hysteresis. In the near and shadow sets the moving cars occupy the first slots and the parked ones the rest, so the
// per-frame upload is only the moving span; only the moving cars have drivers and passengers.
export class Fleet {
  constructor(specs) { // specs: [{type, color}]
    this.cars = []; this.types = {}; this.lodDist = 60;
    const byType = {};
    specs.forEach((sp, i) => { (byType[sp.type] ||= []).push(i); });
    for (const [type, idxs] of Object.entries(byType)) {
      const T = TYPES[type], n = idxs.length;
      const G = buildType(T); LO = true; const F = buildType(T); LO = false;
      // kind 0: near set (all parts); 1: far shadow shells (shadow passes only, layer 7); 2: far cars in view (no shadow)
      const family = (geo, kind) => {
        const M = {};
        for (const key in PART_MAT) {
          if (kind === 1 && !CASTS[key]) continue;
          const g = key === 'tire' ? geo.tire : key === 'rim' ? geo.rim : geo.parts[key], per = key === 'tire' || key === 'rim' ? 4 : 1;
          if (!g) continue;
          let geo2 = g;
          if (OCCUPANT.has(key)) { // (its own seat colours: a geometry view sharing the shape's buffers)
            geo2 = new THREE.BufferGeometry(); for (const a in g.attributes) geo2.setAttribute(a, g.attributes[a]);
            geo2.boundingSphere = (g.boundingSphere || (g.computeBoundingSphere(), g.boundingSphere)).clone();
            geo2.setAttribute('seatCol', new THREE.InstancedBufferAttribute(new Float32Array(n * 4).fill(-1), 4));
          }
          const im = new THREE.InstancedMesh(geo2, PART_MAT[key], n * per); im.count = 0;
          im.castShadow = kind !== 2 && !!CASTS[key]; im.receiveShadow = key !== 'shadow';
          im.frustumCulled = kind === 0; // the near set is bounded every frame; the far lists are culled per car
          if (TINTED.includes(key)) im.setColorAt(0, _c.setRGB(1, 1, 1));
          im.userData.per = per; im.userData.occupant = OCCUPANT.has(key); im.userData.dynamicCaster = true; M[key] = im; scene.add(im);
        }
        if (M.glass) M.glass.renderOrder = 3;
        const list = Object.values(M), sphere = new THREE.Sphere();
        if (kind === 0) for (const im of list) im.boundingSphere = sphere;
        if (kind === 1) for (const im of list) { im.userData.shadowOnly = true; im.layers.set(7); }
        return { M, list, sphere, slots: [], nMove: 0, d0: Infinity, d1: -1 };
      };
      const sets = [family(G, 0), family(F, 1)], view = family(F, 2);
      this.types[type] = { T, sets, view, cars: [] };
      idxs.forEach((si, k) => {
        const sp = specs[si];
        const car = { id: si, type, k, T, spin: 0, x: 0, y: 0, z: 0, r: 0, lod: -1, slot: -1, moving: false, placed: false, dirty: false,
          mat: new Float32Array(16), wheels: new Float32Array(64), head: 0, tail: 0,
          col: { paint: sp.color || PAINTS[0], plate: T.kei ? [0.95, 0.82, 0.1] : [0.95, 0.95, 0.93],
            driverCloth: CLOTH[(si * 7 + 3) % CLOTH.length], paxCloth: CLOTH[(si * 5 + 1) % CLOTH.length],
            rearRCloth: CLOTH[(si * 13 + 4) % CLOTH.length], rearLCloth: CLOTH[(si * 17 + 6) % CLOTH.length],
            driverHair: HAIRS[(si * 3 + 1) % HAIRS.length], paxHair: HAIRS[(si * 11 + 2) % HAIRS.length],
            rearRHair: HAIRS[(si * 5 + 3) % HAIRS.length], rearLHair: HAIRS[(si * 7 + 5) % HAIRS.length] } };
        this.cars[si] = car; this.types[type].cars.push(car);
      });
    }
  }
  place(car, x, y, z, r, dist = 0, head = 0, tail = 0, steer = 0) {
    const T = car.T;
    car.x = x; car.y = y; car.z = z; car.r = r; car.head = head; car.tail = tail; car.dirty = true; car.placed = true;
    if (car.driver && !car.moving) { car.moving = true; if (car.lod >= 0) { const l = car.lod; car.moving = false; this._remove(car); car.moving = true; this._insert(car, l); } }
    _e.set(0, r, 0); _q.setFromEuler(_e); _p.set(x, y, z);
    _m.compose(_p, _q, _s); _m.toArray(car.mat);
    car.spin -= dist / T.r;
    const wx2 = T._wheelX || (T._wheelX = wheelX(T));
    let i = 0;
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
      const side = b ? 1 : -1;
      _e.set(side > 0 ? 0 : Math.PI, 0, car.spin * side); _q.setFromEuler(_e);
      if (a === 0 && steer) _q.premultiply(_qs.setFromAxisAngle(_up, steer)); // front wheels steer
      _w.compose(_p.set(wx2[a], T.r, side * (T.W / 2 - 0.13)), _q, _s);
      _w.premultiply(_m); _w.toArray(car.wheels, i * 16); i++;
    }
  }
  // write one car into its slot of its set
  _write(set, car, s = car.slot) {
    const M = set.M, A = car.mat;
    for (const key of BODY) if (M[key]) M[key].instanceMatrix.array.set(A, s * 16);
    for (const key of OCC_KEYS) {
      const im = M[key]; if (!im) continue;
      im.instanceMatrix.array.set(A, s * 16);
      const a = im.geometry.attributes.seatCol.array;
      for (let k = 0; k < 4; k++) { const on = car.driver && (k === 0 || car[SEATS[k]]);
        a[s * 4 + k] = !on ? -1 : key === 'occSkin' ? 0 : packCol(car.col[SEATS[k] + (key === 'occCloth' ? 'Cloth' : 'Hair')]); }
    }
    M.tire.instanceMatrix.array.set(car.wheels, s * 64); if (M.rim) M.rim.instanceMatrix.array.set(car.wheels, s * 64);
    for (const key of TINTED) {
      if (!M[key]) continue;
      const c = key === 'head' ? _hc(car.head) : key === 'tail' ? _hc(car.tail) : car.col[key], arr = M[key].instanceColor.array;
      arr[s * 3] = c[0]; arr[s * 3 + 1] = c[1]; arr[s * 3 + 2] = c[2];
    }
    if (s < set.d0) set.d0 = s; if (s > set.d1) set.d1 = s;
  }
  _put(set, car, slot) { set.slots[slot] = car; car.slot = slot; this._write(set, car); }
  _insert(car, lod) {
    const set = this.types[car.type].sets[lod], n = set.slots.length;
    car.lod = lod;
    if (car.moving) { // moving cars first: the parked car at the boundary moves to the end
      if (set.nMove < n) this._put(set, set.slots[set.nMove], n);
      this._put(set, car, set.nMove); set.nMove++;
    } else this._put(set, car, n);
  }
  _remove(car) {
    const set = this.types[car.type].sets[car.lod], s = car.slot, last = set.slots.length - 1;
    if (car.moving) {
      const lm = set.nMove - 1;
      if (s !== lm) this._put(set, set.slots[lm], s);
      if (lm !== last) this._put(set, set.slots[last], lm);
      set.nMove--;
    } else if (s !== last) this._put(set, set.slots[last], s);
    set.slots.length = last; car.lod = -1; car.slot = -1;
  }
  // choose each car's level of detail from the camera, write what changed and upload only that span
  commit(cam, camera) {
    const D = this.lodDist * (Q.lodScale || 1), H = 4, cx = cam ? cam.x : 0, cz = cam ? cam.z : 0;
    if (camera) _fr.setFromProjectionMatrix(_vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    for (const type in this.types) {
      const ty = this.types[type];
      for (const car of ty.cars) {
        if (!car.placed) continue;
        const dx = car.x - cx, dz = car.z - cz, d2 = dx * dx + dz * dz;
        const want = !cam ? 1 : car.lod === 0 ? (d2 > (D + H) * (D + H) ? 1 : 0) : car.lod === 1 ? (d2 < (D - H) * (D - H) ? 0 : 1) : (d2 < D * D ? 0 : 1);
        if (want !== car.lod) { if (car.lod >= 0) this._remove(car); this._insert(car, want); }
        else if (car.dirty) this._write(ty.sets[car.lod], car);
        car.dirty = false;
      }
      for (let li = 0; li < 2; li++) {
        const set = ty.sets[li], n = set.slots.length;
        for (const im of set.list) im.count = (im.userData.occupant ? set.nMove : n) * im.userData.per;
        if (li === 0 && n) { // bound the near set (cars are ~5 m long)
          let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
          for (const c of set.slots) { x0 = Math.min(x0, c.x); x1 = Math.max(x1, c.x); y0 = Math.min(y0, c.y); y1 = Math.max(y1, c.y); z0 = Math.min(z0, c.z); z1 = Math.max(z1, c.z); }
          const ex = x1 - x0, ey = y1 - y0, ez = z1 - z0;
          set.sphere.center.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); set.sphere.radius = Math.sqrt(ex * ex + ey * ey + ez * ez) / 2 + 3.5;
        }
        if (set.d1 < set.d0) continue;
        for (const im of set.list) {
          const per = im.userData.per, a = im.instanceMatrix, c = im.instanceColor;
          a.clearUpdateRanges(); a.addUpdateRange(set.d0 * per * 16, (set.d1 - set.d0 + 1) * per * 16); a.needsUpdate = true;
          if (c) { c.clearUpdateRanges(); c.addUpdateRange(set.d0 * 3, (set.d1 - set.d0 + 1) * 3); c.needsUpdate = true; }
          const q = im.geometry.attributes.seatCol; if (q) { q.clearUpdateRanges(); q.addUpdateRange(set.d0 * 4, (set.d1 - set.d0 + 1) * 4); q.needsUpdate = true; }
        }
        set.d0 = Infinity; set.d1 = -1;
      }
      // the far cars in view (moving ones first: they carry the drivers), every frame
      const V = ty.view; let k = 0, km = 0;
      V.d0 = Infinity; V.d1 = -1;
      for (let pass = 0; pass < 2; pass++) for (const car of ty.sets[1].slots) {
        if (car.moving !== (pass === 0)) continue;
        _sph.center.set(car.x, car.y + 0.9, car.z);
        if (camera && !_fr.intersectsSphere(_sph)) continue;
        this._write(V, car, k++); if (pass === 0) km = k;
      }
      for (const im of V.list) {
        im.count = (im.userData.occupant ? km : k) * im.userData.per; im.visible = k > 0;
        if (!k) continue;
        const per = im.userData.per, a = im.instanceMatrix, c = im.instanceColor;
        a.clearUpdateRanges(); a.addUpdateRange(0, k * per * 16); a.needsUpdate = true;
        if (c) { c.clearUpdateRanges(); c.addUpdateRange(0, k * 3); c.needsUpdate = true; }
        const q = im.geometry.attributes.seatCol; if (q) { q.clearUpdateRanges(); q.addUpdateRange(0, k * 4); q.needsUpdate = true; }
      }
    }
  }
}
const _fr = new THREE.Frustum(), _vp = new THREE.Matrix4(), _sph = new THREE.Sphere(new THREE.Vector3(), 3.2);
const _hcv = [0, 0, 0], _hc = v => { _hcv[0] = v; return _hcv; }; // lamp intensity rides in the red channel
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
      for (let k = 0; k <= 16; k++) { const t = k / 16, u = 1 - t; P.push([u * u * p1[0] + 2 * u * t * p[0] + t * t * p2[0], u * u * p1[1] + 2 * u * t * p[1] + t * t * p2[1]]); }
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
    // a tangent per point (the mean of the segments either side) interpolated between points: heading and the lane
    // offset turn continuously through a bend instead of stepping at every point of the polyline
    const N = this.pts.length, last = N - 1;
    const seg = (i, j) => { const a = this.pts[i], b = this.pts[j], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz); return l > 1e-6 ? [dx / l, dz / l] : null; };
    const wrap = i => !closed ? i : i < 0 ? i + last : i > last ? i - last : i; // (closed: the last point is the first)
    this.tan = this.pts.map((_, i) => {
      let a = null, b = null;
      for (let k = 1; k < 6 && !a; k++) { const j = wrap(i - k), h = wrap(i - k + 1); if (j >= 0 && j <= last) a = seg(j, h); }
      for (let k = 1; k < 6 && !b; k++) { const j = wrap(i + k), h = wrap(i + k - 1); if (j >= 0 && j <= last) b = seg(h, j); }
      if (!a) a = b; if (!b) b = a; if (!a) return [1, 0];
      const x = a[0] + b[0], z = a[1] + b[1], l = Math.hypot(x, z);
      return l > 1e-6 ? [x / l, z / l] : b;
    });
    this.stops = []; // {s, kind: 'stop'|'crossing', crossing}
  }
  at(s, out) {
    s = this.closed ? ((s % this.len) + this.len) % this.len : clamp(s, 0, this.len);
    let lo = 0, hi = this.s.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.s[m] <= s) lo = m; else hi = m; }
    const a = this.pts[lo], b = this.pts[hi], t = (s - this.s[lo]) / Math.max(1e-6, this.s[hi] - this.s[lo]);
    const ta = this.tan[lo], tb = this.tan[hi], tx = lerp(ta[0], tb[0], t), tz = lerp(ta[1], tb[1], t), l = Math.hypot(tx, tz) || 1;
    out.x = lerp(a[0], b[0], t); out.z = lerp(a[1], b[1], t); out.dx = tx / l; out.dz = tz / l;
    return out;
  }
  // signed turn rate of the heading (radians per metre, positive = the yaw angle growing), from the tangents 1.5 m either side
  turnRate(s) { const a = this.at(s - 1.5, _ca), b = this.at(s + 1.5, _cb); return Math.atan2(a.dz * b.dx - a.dx * b.dz, a.dx * b.dx + a.dz * b.dz) / 3; }
  curvature(s) { const a = _ca, b = _cb; this.at(s, a); this.at(s + 6, b); return Math.acos(clamp(a.dx * b.dx + a.dz * b.dz, -1, 1)) / 6; }
}

const tmpA = { x: 0, z: 0, dx: 0, dz: 0 }, tmpB = { x: 0, z: 0, dx: 0, dz: 0 }, _ca = { x: 0, z: 0, dx: 0, dz: 0 }, _cb = { x: 0, z: 0, dx: 0, dz: 0 };
export class Traffic {
  constructor(fleet, groundAt) { this.fleet = fleet; this.groundAt = groundAt; this.movers = []; this.emitters = [0, 1, 2, 3].map(() => new Emitter('engine')); }
  add(car, route, s) {
    const roll = (car.k * 7919 + car.type.length * 31) % 100;
    car.driver = true;
    car.pax = roll < (car.T.taxi ? 18 : 34);
    car.rearR = !car.T.truck && (car.T.taxi ? roll < 72 : roll >= 34 && roll < 48);
    car.rearL = !car.T.truck && (car.T.taxi ? roll < 26 : roll >= 43 && roll < 51);
    this.movers.push({ car, route, s, v: route.vmax * 0.5, wait: 0, stopIdx: this.nextStop(route, s), brake: 0 });
  }
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
      const y = this.groundAt(m.wx, m.wz), T = m.car.T, wx = T._wheelX || (T._wheelX = wheelX(T));
      const steer = clamp(Math.atan((wx[0] - wx[1]) * R.turnRate(m.s)), -0.6, 0.6); m.steer = (m.steer || 0) + (steer - (m.steer || 0)) * Math.min(1, dt * 8);
      this.fleet.place(m.car, m.wx, y, m.wz, Math.atan2(m.hx, m.hz) - Math.PI / 2, m.v * dt, headlights ? 1.4 : 0.02, (headlights ? 0.45 : 0.08) + m.brake * 0.9, m.steer);
    }
    // engine sounds for the nearest few cars (insertion into a fixed-size list: no per-frame arrays)
    const E = this.emitters, nm = this._near || (this._near = E.map(() => null)), nd = this._nearD || (this._nearD = new Float64Array(E.length));
    nm.fill(null); nd.fill(Infinity);
    for (const m of M) {
      const dx = m.wx - player.x, dz = m.wz - player.z, d = Math.sqrt(dx * dx + dz * dz);
      if (d >= nd[E.length - 1]) continue;
      let j = E.length - 1; while (j > 0 && nd[j - 1] > d) { nd[j] = nd[j - 1]; nm[j] = nm[j - 1]; j--; }
      nd[j] = d; nm[j] = m;
    }
    const st = this._est || (this._est = { speed: 0, accel: 0 });
    for (let i = 0; i < E.length; i++) { const e = E[i], m = nm[i]; e.on = !!m && nd[i] < 90; if (m) { st.speed = m.v; st.accel = m.accel; e.set(m.wx, m.car.y + 0.5, m.wz, st); } }
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
