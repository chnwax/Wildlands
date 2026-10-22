// The insides of the shops you can walk into: each shop that sells something (items.js MENUS) gets a way in and a room
// furnished for its trade, at the sizes of real things (the model library's own furniture is drawn a third larger
// than life; it is used here at its true size):
//  - the eateries (ramen, soba, sushi, izakaya): a kitchen along the back — stove and pots, the noodle boiler, the
//    grill, an extractor hood, a shelf of bowls or bottles — a counter with its pass ledge and condiments, stools before
//    it, tables where there is room, the menu on hanging paper strips over the kitchen, lanterns or pendant lamps
//  - the café: a counter with the espresso machine and a cake case, small tables, plants, a chalkboard menu
//  - the sweet shop and the bakery: a glass case of what is sold, gift boxes behind, a bench or bread racks
//  - the pharmacy and the liquor shop: shelves of goods, a fridge wall of drinks, the till by the door
//  - the konbini: a fridge wall, the chilled case of rice balls and bento, gondolas, the magazine rack under the window,
//    the till with its hot-snack case, the coffee machine, the ATM, a lit ceiling
//  - the cycle shop: bicycles in a row, a wall of bags, the counter
// The building itself: its door leaves slide open on their own track as you come (they are taken out of the model
// into meshes of their own), and the shop collides as what it is now made of (a compound collider from its own
// triangles and those of its furniture: walls, counters, shelves, stools), no longer as one solid box.
// What the shop knows afterwards (building.js SHOP_SITES, used by shops.js and pedestrians.js): its floor box, the door
// (and a point just inside it), where the shopkeeper stands, where you are served, its shelves and till, its seats for
// customers, its bins.
import { THREE, scene, lampPoints, buildCompound, addCompound, addProp, colInsert, colRemove, capHooks } from './core.js';
import { packsReady, packProp, packTris, stockShelf } from './packs.js';
import { GeoBuilder, signMesh, chochin, materials as townMaterials } from './townkit.js';
import { ITEMS, MENUS } from './items.js';

export const ENTERABLE = new Set([0, 1, 3, 6, 7, 8, 11, 12, 15, 16, 'konbini']);
// the pack shop buildings, in their own units (front +z): the shop floor (x0, x1, z0, z1), the front's inner line, the
// way in (x0, x1) and the door leaves that slide (x0, x1, which way)
export const SPECS = {
  jp_ramenshop: { room: [-2.6, 2.45, -1.75, 1.5], front: 1.62, door: [-2.3, 2.2] },
  jp_shop_building_05: { room: [-2.7, 2.45, -3.35, 2.55], front: 2.7, door: [-1.15, 0.95] },
  jp_shop_building_01: { room: [-2.7, 2.45, -3.35, 2.55], front: 2.7, door: [-1.2, 0.3] },
  jp_shop_building_04: { room: [-2.55, 2.55, -3.55, 2.45], front: 2.74, door: [-0.45, 0.58], leaves: [[-0.48, 0.61, -1]] },
  jp_shop_building_02: { room: [-2.65, 2.65, -2.95, 1.95], front: 2.25, door: [-0.37, 0.9], leaves: [[-0.39, 0.92, -1]] },
  jp_store_rowbuilding_01: { room: [-2.3, 2.3, -1.85, 2.55], front: 2.82, door: [-1.49, -0.52], leaves: [[-1.51, -0.5, 1]] },
  jp_store_rowbuilding_03: { room: [-2.25, 2.25, -1.85, 1.9], front: 2.05, door: [-1.05, 0.92], leaves: [[-1.09, -0.07, -1], [-0.07, 0.95, 1]] },
  jp_store_rowbuilding_02: { room: [-2.25, 2.25, 0.85, 2.4], front: 2.55, door: [-2.0, 2.0] },
  jp_convenience_store: { room: [-5.3, 5.3, -3.8, 0.15], vest: [-2.55, 2.55, 0.15, 3.75], front: 4.2, door: [-1.05, 1.05], leaves: [[-1.08, 0, -1], [0, 1.08, 1]], ceiling: 3.0 },
};
const y0Lamp = R => R.y + R.ceil - 0.4;
export const canEnter = (trade, model) => ENTERABLE.has(trade) && !!SPECS[model];

// ---------------------------------------------------------------- materials and the builder of the furnishings
let IB = null, MT = null;
const SIGNS = []; // (boards and posters: drawn only near)
function builder() {
  if (IB) return IB;
  IB = new GeoBuilder(48);
  const T = townMaterials();
  const std = o => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0, ...o });
  MT = {
    matte: std({}), gloss: std({ roughness: 0.32 }), metal: std({ roughness: 0.38, metalness: 0.45, envMapIntensity: 0.45 }), dark: std({ roughness: 0.85, color: 0x9a9a9a }),
    wood: T.wood, glass: new THREE.MeshStandardMaterial({ color: 0xcfe6ee, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.22, depthWrite: false, envMapIntensity: 1.2 }),
    lit: std({ roughness: 0.5, emissive: 0xffffff, emissiveIntensity: 0.85 }), lamp: T.lamp,
  };
  MT.lit.userData.vertexEmissive = true;
  MT.lit.onBeforeCompile = s => { s.fragmentShader = s.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance *= diffuseColor.rgb;'); };
  MT.lit.customProgramCacheKey = () => 'interiorLit';
  return IB;
}
// the furnishings' meshes, once every shop is built (town.js)
export function flushInteriors() {
  if (!IB) return [];
  const meshes = IB.flush(MT, { matte: false, gloss: false, metal: false, dark: false, wood: false, glass: false, lit: false, lamp: false }); // (indoors under a roof: none cast)
  for (const m of meshes) { m.updateMatrixWorld(); if (m.material === MT.glass) m.renderOrder = 2; }
  return meshes;
}
// boards and posters shown only within ~45 m (shops.js calls this)
export function interiorSigns(px, pz) { for (const s of SIGNS) { const dx = s.position.x - px, dz = s.position.z - pz; s.visible = dx * dx + dz * dz < 2000; } }

// ---------------------------------------------------------------- canvas pictures: menus, posters, a clock
const MINCHO = '"Yu Mincho", "YuMincho", "Hiragino Mincho ProN", "MS Mincho", serif', GOTHIC = '"Yu Gothic UI", "Yu Gothic", "Meiryo", sans-serif';
function vText(g, s, x, y, size, color, font = MINCHO) { g.fillStyle = color; g.font = `bold ${size}px ${font}`; g.textAlign = 'center'; g.textBaseline = 'top'; let yy = y; for (const ch of s) { if (ch === 'ー') { g.save(); g.translate(x, yy + size / 2); g.rotate(Math.PI / 2); g.fillText(ch, 0, -size / 2); g.restore(); } else g.fillText(ch, x, yy); yy += size * 1.02; } return yy; }
const kanjiNum = n => String(n).replace(/\d/g, d => '〇一二三四五六七八九'[d]);
// お品書き: hanging paper strips on a dark wooden board, one strip a dish (written top to bottom, the price under it)
function drawStrips(items, accent = '#b8322a', paper = ['#f6efdc', '#efe4c8']) {
  return (g, W, H) => {
    g.fillStyle = '#3b2617'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 40; i++) { g.strokeStyle = `rgba(0,0,0,${0.08 + (i % 3) * 0.04})`; g.lineWidth = 1 + (i % 4); g.beginPath(); const y = (i * 37) % H; g.moveTo(0, y); g.bezierCurveTo(W * 0.3, y + 6, W * 0.6, y - 6, W, y + 3); g.stroke(); }
    g.fillStyle = '#24170e'; g.fillRect(0, 0, W, H * 0.07); g.fillRect(0, H * 0.93, W, H * 0.07);
    const n = items.length, sw = Math.min(W / (n + 0.6) * 0.78, H * 0.2), gap = (W - n * sw) / (n + 1);
    items.forEach((id, i) => { const it = ITEMS[id], x = gap + i * (sw + gap), top = H * 0.1, bot = H * 0.9;
      g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x + 4, top + 5, sw, bot - top);
      g.fillStyle = paper[i % paper.length]; g.fillRect(x, top, sw, bot - top);
      const size = Math.min(sw * 0.62, (bot - top) * 0.62 / Math.max(3, it.jp.length));
      const ye = vText(g, it.jp, x + sw / 2, top + sw * 0.25, size, '#1d1712');
      g.fillStyle = accent; g.font = `bold ${sw * 0.3}px ${MINCHO}`; g.textAlign = 'center'; g.textBaseline = 'bottom'; g.fillText(it.price + '円', x + sw / 2, bot - sw * 0.12); });
  };
}
function drawChalk(title, items) {
  return (g, W, H) => {
    g.fillStyle = '#5a3f28'; g.fillRect(0, 0, W, H); g.fillStyle = '#23302a'; g.fillRect(W * 0.04, H * 0.05, W * 0.92, H * 0.9);
    g.fillStyle = 'rgba(255,255,255,.04)'; for (let i = 0; i < 60; i++) g.fillRect((i * 97) % W, (i * 53) % H, 40, 2);
    g.fillStyle = '#f4efe2'; g.textAlign = 'center'; g.font = `italic bold ${H * 0.12}px Georgia, serif`; g.fillText(title, W / 2, H * 0.2);
    g.font = `${H * 0.055}px ${MINCHO}`; g.fillStyle = '#e8d9a8'; g.fillText('メニュー', W / 2, H * 0.29);
    items.forEach((id, i) => { const it = ITEMS[id], y = H * 0.42 + i * H * 0.12; g.textAlign = 'left'; g.fillStyle = '#f4efe2'; g.font = `${H * 0.065}px Georgia, serif`; g.fillText(it.name, W * 0.12, y);
      g.font = `${H * 0.045}px ${MINCHO}`; g.fillStyle = '#cfe0c4'; g.fillText(it.jp, W * 0.12, y + H * 0.05); g.textAlign = 'right'; g.fillStyle = '#f2c46a'; g.font = `${H * 0.065}px Georgia, serif`; g.fillText('¥' + it.price, W * 0.88, y); });
    g.strokeStyle = '#f4efe2'; g.lineWidth = 3; g.beginPath(); g.arc(W * 0.86, H * 0.86, H * 0.05, 0, Math.PI * 2); g.stroke();
  };
}
const drawPoster = (bg, fg, big, small, sub = '') => (g, W, H) => {
  g.fillStyle = bg; g.fillRect(0, 0, W, H); g.fillStyle = 'rgba(255,255,255,.18)'; for (let i = -H; i < W; i += 40) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 20, 0); g.lineTo(i + 20 + H, H); g.lineTo(i + H, H); g.fill(); }
  g.fillStyle = fg; g.textAlign = 'center'; g.font = `900 ${H * 0.3}px ${GOTHIC}`; g.fillText(big, W / 2, H * 0.48); g.font = `bold ${H * 0.13}px ${GOTHIC}`; g.fillText(small, W / 2, H * 0.72); if (sub) { g.font = `${H * 0.08}px ${GOTHIC}`; g.fillText(sub, W / 2, H * 0.88); }
};
const drawClock = (g, W, H) => { const c = W / 2, r = W * 0.46; g.fillStyle = '#2b2420'; g.beginPath(); g.arc(c, c, r + 6, 0, Math.PI * 2); g.fill(); g.fillStyle = '#fbf8f0'; g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#2b2420'; for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; g.fillRect(c + Math.sin(a) * r * 0.82 - 3, c - Math.cos(a) * r * 0.82 - 3, 6, 6); }
  g.strokeStyle = '#2b2420'; g.lineCap = 'round'; g.lineWidth = 8; g.beginPath(); g.moveTo(c, c); g.lineTo(c + r * 0.45, c - r * 0.2); g.stroke(); g.lineWidth = 5; g.beginPath(); g.moveTo(c, c); g.lineTo(c - r * 0.1, c - r * 0.72); g.stroke(); };
const drawCalendar = (g, W, H) => { g.fillStyle = '#fbfaf6'; g.fillRect(0, 0, W, H); g.fillStyle = '#c0281e'; g.fillRect(0, 0, W, H * 0.16); g.fillStyle = '#fff'; g.font = `bold ${H * 0.1}px ${GOTHIC}`; g.textAlign = 'center'; g.fillText('10月', W / 2, H * 0.12);
  g.fillStyle = '#2b2420'; g.font = `${H * 0.05}px ${GOTHIC}`; for (let d = 1; d <= 31; d++) { const k = d + 2, x = (k % 7 + 0.5) * W / 7, y = H * 0.28 + Math.floor(k / 7) * H * 0.12; g.fillStyle = k % 7 === 0 ? '#c0281e' : k % 7 === 6 ? '#1f5fb4' : '#2b2420'; g.fillText(String(d), x, y); } };
const drawScroll = (txt) => (g, W, H) => { g.fillStyle = '#6b5b3e'; g.fillRect(0, 0, W, H); g.fillStyle = '#efe6cf'; g.fillRect(W * 0.12, H * 0.06, W * 0.76, H * 0.86); vText(g, txt, W / 2, H * 0.2, W * 0.42, '#1d1712'); g.fillStyle = '#b8322a'; g.fillRect(W * 0.58, H * 0.74, W * 0.12, W * 0.12); };
const drawLabel = (bg, fg, txt, jp) => (g, W, H) => { g.fillStyle = bg; g.fillRect(0, 0, W, H); g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `bold ${H * 0.46}px ${GOTHIC}`; g.fillText(jp, W / 2, H * 0.42); g.font = `${H * 0.2}px ${GOTHIC}`; g.fillText(txt, W / 2, H * 0.8); };

// ---------------------------------------------------------------- one shop
// o: the model's origin, r: its turn, s: its scale ([sx, sy, sz] metres a model unit)
function kit(o, r, tris) {
  const c = Math.cos(r), s = Math.sin(r), B = builder(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _sc = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  const W = (x, y, z) => [o[0] + x * c + z * s, o[1] + y, o[2] - x * s + z * c];
  const K = {
    W, B, r,
    box: (mat, cx, y, cz, w, h, d, col, bev = 0.012, opt = {}) => { (bev > 0 ? B.bbox(mat, cx, y, cz, w, h, d, bev, { color: col, ...opt }) : B.box(mat, cx, y, cz, w, h, d, { color: col, ...opt })); },
    cyl: (mat, cx, y, cz, r0, r1, h, col, seg = 12, cap = true) => B.cyl(mat, cx, y, cz, r0, r1, h, seg, { color: col, cap }),
    quad: (mat, a, b, cc, d, col, opt = {}) => B.quad(mat, a, b, cc, d, { color: col, ...opt }),
    // a model of the library at (x, y, z), turned yaw, scale sc (number or [x, y, z]); collides unless told not to
    pack(id, x, y, z, yaw = 0, sc = 1, collide = true) {
      const P = packsReady(); if (!P || !P.models[id]) return null;
      const w = W(x, y, z); packProp(id, w[0], w[1], w[2], r + yaw, sc);
      _m.compose(_v.set(w[0], w[1], w[2]), _q.setFromAxisAngle(Y, r + yaw), Array.isArray(sc) ? _sc.set(sc[0], sc[1], sc[2]) : _sc.setScalar(sc));
      if (collide) packTris(id, _m, tris);
      return _m.clone();
    },
    // a board or poster (canvas) on a wall: centre (x, y, z), facing yaw (0: +z, into the room from the back wall)
    sign(w, h, draw, x, y, z, yaw = 0, glow = 0.25, px = 256, back = 'panel') {
      const m = signMesh(w, h, draw, glow, px, { back }); const p = W(x, y, z); m.position.set(p[0], p[1], p[2]); m.rotation.y = r + yaw; m.updateMatrixWorld(); m.visible = false; scene.add(m); SIGNS.push(m); return m;
    },
    lamp(x, y, z, strength = 0.7, col) { lampPoints.push({ p: W(x, y, z), s: strength, ...(col ? { c: col } : {}) }); },
  };
  return K;
}
const rnd = seed => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const pick = (rng, a) => a[Math.floor(rng() * a.length)];
const WHITE = [0.95, 0.95, 0.94], STEEL = [0.78, 0.8, 0.82], DARKW = [0.32, 0.22, 0.15], MIDW = [0.55, 0.4, 0.27], LIGHTW = [0.78, 0.64, 0.46], RED = [0.72, 0.12, 0.1], BLACK = [0.08, 0.08, 0.09];

// ---- pieces of furniture (room frame: metres from the model's origin, the shop's front toward +z)
function stool(K, x, z, y, seat = RED) { K.cyl('gloss', x, y, z, 0.2, 0.16, 0.03, [0.45, 0.46, 0.48], 12); K.cyl('gloss', x, y, z, 0.025, 0.025, 0.62, [0.62, 0.63, 0.65], 6, false); K.cyl('gloss', x, y + 0.6, z, 0.18, 0.18, 0.08, seat, 14); }
function chair(K, x, z, y, yaw, col = MIDW) { // seat at 0.45, back away from the table (yaw: the way the sitter faces)
  const fx = Math.sin(yaw), fz = Math.cos(yaw), bx = x - fx * 0.2, bz = z - fz * 0.2;
  for (const [a, b] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) K.box('wood', x + a, y, z + b, 0.035, 0.44, 0.035, col, 0);
  K.box('wood', x, y + 0.42, z, 0.42, 0.04, 0.42, col, 0.008);
  K.box('wood', bx, y + 0.46, bz, Math.abs(fz) > 0.5 ? 0.42 : 0.04, 0.42, Math.abs(fz) > 0.5 ? 0.04 : 0.42, col, 0);
}
function table(K, x, z, y, w, d, col = MIDW, top = null) { K.box('wood', x, y + 0.71, z, w, 0.04, d, top || col, 0.01); for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) K.box('wood', x + a * (w / 2 - 0.06), y, z + b * (d / 2 - 0.06), 0.05, 0.71, 0.05, col, 0); }
function condiments(K, x, z, y, rng, kind) {
  K.box('wood', x - 0.12, y, z, 0.16, 0.12, 0.08, LIGHTW, 0.006); // chopstick box
  for (let i = 0; i < 5; i++) K.box('wood', x - 0.17 + i * 0.025, y + 0.12, z, 0.012, 0.06, 0.012, [0.86, 0.78, 0.6], 0);
  K.cyl('gloss', x + 0.04, y, z, 0.025, 0.02, 0.11, [0.15, 0.08, 0.06], 8); K.cyl('gloss', x + 0.04, y + 0.11, z, 0.012, 0.012, 0.025, RED, 6); // soy sauce
  if (kind === 'ramen') { K.cyl('gloss', x + 0.1, y, z, 0.02, 0.02, 0.09, [0.9, 0.9, 0.88], 8); K.cyl('gloss', x + 0.15, y, z, 0.022, 0.022, 0.08, [0.75, 0.2, 0.08], 8); }
  K.box('matte', x + 0.22, y, z, 0.1, 0.07, 0.07, WHITE, 0.005); // napkins
}
function bowl(K, x, z, y, col = BLACK, s = 1) { K.cyl('gloss', x, y, z, 0.05 * s, 0.085 * s, 0.07 * s, col, 12); K.cyl('gloss', x, y + 0.068 * s, z, 0.08 * s, 0.08 * s, 0.004, [0.85, 0.55, 0.3], 12); }
function bottles(K, x0, x1, z, y, rng, palette, h = 0.28) { for (let x = x0; x <= x1; x += 0.09) { const c = pick(rng, palette); K.cyl('gloss', x, y, z, 0.035, 0.035, h * 0.7, c, 8); K.cyl('gloss', x, y + h * 0.7, z, 0.035, 0.014, h * 0.18, c, 8); K.cyl('gloss', x, y + h * 0.88, z, 0.014, 0.014, h * 0.12, [0.15, 0.15, 0.15], 6); } }
// a pendant lamp: shade and bulb (lit at night) and a cord
function pendant(K, x, y, z, ceil, col = [0.95, 0.9, 0.8], shade = BLACK) { K.box('dark', x, y + 0.2, z, 0.008, ceil - y - 0.2, 0.008, BLACK, 0); K.cyl('gloss', x, y, z, 0.2, 0.06, 0.2, shade, 14, false); K.cyl('lamp', x, y + 0.02, z, 0.07, 0.07, 0.06, col, 8); }
// a fluorescent ceiling panel (lit; a lamp at night)
function panel(K, x, y, z, w, d) { K.box('lit', x, y - 0.03, z, w, 0.03, d, [1, 0.99, 0.96], 0); K.box('matte', x, y - 0.01, z, w + 0.06, 0.01, d + 0.06, WHITE, 0); }

// a glass-fronted fridge along a back wall (front +z at z): doors, lit shelves of bottles, a lit header
function fridgeWall(K, x0, x1, z, y, rng, H = 2.0, dep = 0.6) {
  const L = x1 - x0, n = Math.max(2, Math.round(L / 0.75)), dw = L / n, cx = (x0 + x1) / 2;
  K.box('matte', cx, y, z - dep / 2 + 0.02, L, H + 0.25, dep, WHITE, 0.01);
  K.box('lit', cx, y + H + 0.02, z + 0.03, L - 0.04, 0.2, 0.02, [0.95, 0.97, 1.0], 0);
  const PAL = [[0.85, 0.15, 0.15], [0.2, 0.55, 0.25], [0.95, 0.75, 0.2], [0.2, 0.4, 0.8], [0.95, 0.95, 0.95], [0.55, 0.32, 0.18], [0.9, 0.5, 0.15], [0.6, 0.85, 0.95]];
  for (let k = 0; k < n; k++) {
    const u0 = x0 + k * dw;
    for (let sy = 0; sy < 5; sy++) { const yy = y + 0.15 + sy * 0.38; K.box('lit', u0 + dw / 2, yy - 0.02, z - 0.25, dw - 0.06, 0.015, 0.42, [0.8, 0.86, 0.9], 0);
      const kind = pick(rng, PAL), tall = rng() < 0.6;
      for (let u = u0 + 0.09; u < u0 + dw - 0.06; u += 0.085) { const c = rng() < 0.75 ? kind : pick(rng, PAL); K.cyl('gloss', u, yy, z - 0.12, 0.033, 0.033, tall ? 0.22 : 0.12, c, 8); K.cyl('gloss', u, yy + (tall ? 0.22 : 0.12), z - 0.12, 0.016, 0.016, 0.03, tall ? WHITE : [0.7, 0.7, 0.72], 6); } }
    K.box('metal', u0 + 0.015, y + 0.05, z + 0.02, 0.03, H - 0.05, 0.04, STEEL, 0); K.box('metal', u0 + dw / 2, y + 0.05, z + 0.02, dw, 0.04, 0.04, STEEL, 0); K.box('metal', u0 + dw / 2, y + H - 0.04, z + 0.02, dw, 0.04, 0.04, STEEL, 0);
    K.box('metal', u0 + dw - 0.06, y + 0.8, z + 0.05, 0.02, 0.5, 0.03, STEEL, 0);
    K.box('glass', u0 + dw / 2, y + 0.07, z + 0.03, dw - 0.04, H - 0.11, 0.01, [1, 1, 1], 0);
  }
  K.box('matte', cx, y, z, L, 0.05, 0.05, [0.3, 0.3, 0.32], 0);
}
// open shelves of goods (the library's store rack, stocked shelf by shelf), at true size; yaw: its front
function rack(K, x, z, y, yaw, seed) { const M = K.pack('jp_shelves_store', x, y, z, yaw, 0.68); if (M) stockShelf(M, seed); return M; }
// a register on a counter top at height yt, its screen toward the customer (+z turned yaw)
function register(K, x, yt, z) { K.box('gloss', x, yt, z, 0.34, 0.12, 0.3, [0.15, 0.15, 0.17], 0.01); K.box('gloss', x, yt + 0.12, z - 0.05, 0.3, 0.2, 0.04, [0.12, 0.12, 0.14], 0.005); K.box('lit', x, yt + 0.15, z - 0.025, 0.24, 0.13, 0.01, [0.6, 0.85, 0.95], 0); K.box('gloss', x + 0.3, yt, z + 0.05, 0.08, 0.03, 0.14, [0.2, 0.2, 0.22], 0); }
// the till: a counter (w along x, d deep) with the register; the shopkeeper behind it (toward -z)
function till(K, x, z, y, w, d, col = [0.85, 0.85, 0.83], top = [0.3, 0.3, 0.32]) {
  K.box('matte', x, y, z, w, 0.92, d, col, 0.012); K.box('gloss', x, y + 0.92, z, w + 0.04, 0.04, d + 0.04, top, 0.008);
  register(K, x - w * 0.25, y + 0.96, z);
}
// a till against a side wall: the counter runs along z, the customer comes from +x (side 1) or -x (side -1)
function sideTill(K, x, z, y, len, d, side, col, top) {
  K.box('matte', x, y, z, d, 0.92, len, col, 0.012); K.box('gloss', x, y + 0.92, z, d + 0.04, 0.04, len + 0.04, top, 0.008);
  K.box('gloss', x, y + 0.96, z - len * 0.25, 0.3, 0.12, 0.34, [0.15, 0.15, 0.17], 0.01); K.box('gloss', x - side * 0.05, y + 1.08, z - len * 0.25, 0.04, 0.2, 0.3, [0.12, 0.12, 0.14], 0.005); K.box('lit', x - side * 0.025 + side * 0.0, y + 1.11, z - len * 0.25, 0.01, 0.13, 0.24, [0.6, 0.85, 0.95], 0);
}

// ---------------------------------------------------------------- the trades' rooms
// R: the room in metres { x0, x1, z0, z1, y (floor), cx, W, D, door: [x0, x1], front }
function eatery(K, R, trade, rng, out) {
  const izk = trade === 3, sushi = trade === 16, ramen = trade === 0, soba = trade === 12;
  const y = R.y, kd = Math.min(1.45, R.D * 0.3), zb = R.z0, zc = zb + kd + 0.3, top = izk || soba ? MIDW : sushi ? [0.86, 0.76, 0.58] : [0.62, 0.45, 0.3];
  const len = Math.min(R.W - 1.5, 6.2), cx0 = R.x0 + 0.35, cx1 = cx0 + len, gapX = cx1 + 0.5; // (the way behind the counter: its open end)
  // the kitchen along the back wall: worktop, stove and pots, sink, the noodle boiler or the grill, shelves over it
  K.box('metal', R.cx, y, zb + 0.32, R.W - 0.25, 0.88, 0.6, STEEL, 0.01);
  K.box('dark', R.cx, y + 0.02, zb + 0.62, R.W - 0.3, 0.1, 0.02, BLACK, 0);
  const sx = R.x0 + 0.9; K.box('dark', sx, y + 0.88, zb + 0.32, 0.9, 0.04, 0.5, [0.15, 0.15, 0.16], 0);
  for (const [a, b] of [[-0.22, 0], [0.22, 0]]) { K.cyl('dark', sx + a, y + 0.92, zb + 0.32 + b, 0.12, 0.12, 0.01, [0.25, 0.25, 0.26], 12); K.cyl('metal', sx + a, y + 0.93, zb + 0.32 + b, 0.15, 0.14, ramen || soba ? 0.26 : 0.16, STEEL, 14); }
  if (ramen || soba) { const bx = sx + 1.0; K.box('metal', bx, y + 0.88, zb + 0.32, 0.7, 0.18, 0.5, STEEL, 0.01); for (let i = 0; i < 4; i++) K.cyl('metal', bx - 0.24 + i * 0.16, y + 1.06, zb + 0.32, 0.06, 0.06, 0.05, [0.6, 0.6, 0.62], 8); K.cyl('dark', bx + 0.2, y + 1.06, zb + 0.18, 0.012, 0.012, 0.4, MIDW, 6); }
  if (izk) { const gx = sx + 1.1; K.box('dark', gx, y + 0.88, zb + 0.32, 1.0, 0.14, 0.32, [0.12, 0.12, 0.12], 0.01); K.box('lit', gx, y + 1.0, zb + 0.32, 0.9, 0.02, 0.22, [1.0, 0.35, 0.1], 0); for (let i = 0; i < 6; i++) K.box('wood', gx - 0.4 + i * 0.16, y + 1.03, zb + 0.32, 0.01, 0.01, 0.3, [0.5, 0.3, 0.15], 0); }
  if (sushi) { K.box('wood', R.cx + 0.5, y + 0.88, zb + 0.32, 1.2, 0.05, 0.4, [0.8, 0.68, 0.48], 0.01); }
  const sinkX = R.x1 - 0.8; K.box('metal', sinkX, y + 0.8, zb + 0.32, 0.6, 0.09, 0.42, [0.6, 0.62, 0.64], 0); K.cyl('metal', sinkX, y + 0.88, zb + 0.13, 0.015, 0.015, 0.3, STEEL, 6);
  // hood and shelves
  K.box('metal', sx + 0.4, y + 1.95, zb + 0.35, 1.8, 0.45, 0.7, STEEL, 0.01);
  K.box('wood', R.cx + 0.6, y + 1.5, zb + 0.14, R.W * 0.45, 0.03, 0.26, DARKW, 0);
  for (let x = R.cx + 0.6 - R.W * 0.2; x < R.cx + 0.6 + R.W * 0.2; x += 0.22) izk || soba ? bottles(K, x, x, zb + 0.14, y + 1.53, rng, [[0.15, 0.3, 0.15], [0.3, 0.15, 0.08], [0.9, 0.9, 0.88]], 0.3) : bowl(K, x, zb + 0.14, y + 1.53, rng() < 0.5 ? BLACK : [0.9, 0.88, 0.82], 1.1);
  // the menu over the kitchen (paper strips), a clock and a calendar
  const items = MENUS[trade].items;
  K.sign(Math.min(R.W - 0.8, 0.55 + items.length * 0.42), 0.72, drawStrips(items, '#b8322a', izk ? ['#f6efdc', '#f2d36b', '#f6efdc'] : ['#f6efdc', '#efe4c8']), R.cx - 0.2, y + 2.15, zb + 0.03, 0, 0.3, 320);
  K.sign(0.3, 0.3, drawClock, R.x1 - 0.5, y + 2.25, zb + 0.03, 0, 0.1, 128, 'flat');
  K.sign(0.34, 0.48, drawCalendar, R.x0 + 0.04, y + 1.65, zb + 1.1, Math.PI / 2, 0.05, 160, 'flat');
  // the counter: a raised pass ledge on the kitchen side, the top, a panel before the stools
  K.box('wood', (cx0 + cx1) / 2, y, zc, len, 1.0, 0.5, izk ? [0.3, 0.2, 0.13] : [0.88, 0.85, 0.78], 0.01);
  K.box('wood', (cx0 + cx1) / 2, y + 1.0, zc + 0.05, len + 0.06, 0.05, 0.62, top, 0.01);
  K.box('wood', (cx0 + cx1) / 2, y + 1.05, zc - 0.22, len, 0.18, 0.16, top, 0.008);
  if (sushi) { for (let k = 0; k < 2; k++) { const gx = cx0 + len * (0.28 + k * 0.44); K.box('metal', gx, y + 1.05, zc - 0.05, 1.3, 0.04, 0.3, STEEL, 0); K.box('glass', gx, y + 1.09, zc - 0.05, 1.3, 0.22, 0.3, [1, 1, 1], 0);
    for (let i = 0; i < 8; i++) K.box('gloss', gx - 0.55 + i * 0.15, y + 1.1, zc - 0.05, 0.11, 0.05, 0.08, pick(rng, [[0.95, 0.5, 0.35], [0.8, 0.15, 0.2], [0.95, 0.8, 0.3], [0.9, 0.9, 0.85]]), 0.005); } }
  // condiments and a cup at every other seat; stools
  const seats = Math.floor(len / 0.62);
  for (let i = 0; i < seats; i++) { const x = cx0 + (i + 0.5) * len / seats;
    stool(K, x, zc + 0.62, y, izk ? [0.75, 0.15, 0.12] : sushi ? MIDW : RED);
    if (i % 2 === 0) condiments(K, x + 0.25, zc + 0.05, y + 1.05, rng, ramen ? 'ramen' : 'x');
    if (Math.abs(x - (cx0 + cx1) / 2) > 0.5) out.seats.push({ x, z: zc + 0.62, y: y + 0.68, yaw: Math.PI, stool: true }); // (the middle stool kept for you)
  }
  // tables where there is room before the counter (away from the way in)
  const free = R.z1 - (zc + 1.2);
  if (free > 1.9) for (const side of [-1, 1]) {
    const tx = side < 0 ? R.x0 + 0.85 : R.x1 - 0.85; if (tx > R.door[0] - 0.9 && tx < R.door[1] + 0.9) continue;
    for (let tz = zc + 2.0; tz < R.z1 - 0.7; tz += 1.75) { table(K, tx, tz, y, 0.75, 0.75, MIDW); chair(K, tx, tz - 0.6, y, 0, MIDW); chair(K, tx, tz + 0.6, y, Math.PI, MIDW);
      out.seats.push({ x: tx, z: tz - 0.6, y: y + 0.45, yaw: 0 }, { x: tx, z: tz + 0.6, y: y + 0.45, yaw: Math.PI }); condiments(K, tx, tz, y + 0.75, rng, ramen ? 'ramen' : 'x'); }
  }
  // lights: pendants over the counter, red lanterns in an izakaya
  for (let i = 0; i < 3; i++) { const x = cx0 + len * (i + 0.5) / 3; if (izk) chochin(K.B, x, y + 2.0, zc + 0.1, [1, 0.3, 0.2], 1.2); else pendant(K, x, y + 2.05, zc + 0.15, R.ceil, [0.98, 0.9, 0.75], ramen ? RED : BLACK); }
  K.lamp(R.cx, y + 1.9, zc + 0.2, 0.7, izk ? [1, 0.55, 0.35] : undefined);
  if (izk) for (let i = 0; i < 4; i++) chochin(K.B, R.x0 + 0.5 + i * (R.W - 1) / 3, y + 2.35, R.z1 - 0.4, i % 2 ? [1, 0.88, 0.7] : [1, 0.3, 0.2], 0.9);
  K.lamp(R.cx, y + 2.3, R.z1 - 1.2, 0.5);
  // a noren in the doorway to the back, a plant by the door, a bin
  K.quad('matte', [R.x1 - 0.95, y + 2.1, zb + 0.66], [R.x1 - 0.35, y + 2.1, zb + 0.66], [R.x1 - 0.35, y + 1.45, zb + 0.66], [R.x1 - 0.95, y + 1.45, zb + 0.66], [0.15, 0.2, 0.35], { uv: 1 });
  K.pack('jp_plants_box_02', R.door[1] + 0.55 < R.x1 - 0.3 ? R.door[1] + 0.5 : R.door[0] - 0.5, y, R.z1 - 0.35, 0, 0.8);
  out.keeper = { x: R.cx - 0.3, z: zb + kd - 0.15, yaw: 0 };
  out.spots.push({ kind: 'counter', x: (cx0 + cx1) / 2, z: zc + 0.85, r: Math.max(2.2, len / 2 + 0.6) });
}
// places on a grid over the free floor (cells w x d), clear of the walls and of the way in from the door
function freeCells(R, z0, z1, w, d, margin = 0.35) {
  const out = [], dc = (R.door[0] + R.door[1]) / 2, dh = (R.door[1] - R.door[0]) / 2 + 0.75;
  const nx = Math.floor((R.W - 2 * margin) / w), nz = Math.floor((z1 - z0) / d);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const x = R.x0 + margin + (i + 0.5) * (R.W - 2 * margin) / nx, z = z0 + (j + 0.5) * (z1 - z0) / nz;
    if (Math.abs(x - dc) < dh + w / 2 && z > R.z1 - 2.2) continue; if (Math.abs(x - dc) < 0.55 + w / 2) continue; out.push([x, z]); }
  return out;
}
function cafe(K, R, trade, rng, out) {
  const y = R.y, zb = R.z0, cw = Math.min(3.0, R.W * 0.55), cxc = R.x1 - cw / 2 - 0.2, zc = zb + 1.35;
  // the counter, back shelf with cups and coffee, espresso machine, cake case, register
  K.box('wood', cxc, y, zc, cw, 0.95, 0.6, [0.32, 0.22, 0.15], 0.012); K.box('wood', cxc, y + 0.95, zc, cw + 0.05, 0.04, 0.66, [0.82, 0.7, 0.52], 0.008);
  K.box('metal', cxc + cw / 2 - 0.45, y + 0.99, zc - 0.1, 0.55, 0.42, 0.42, [0.75, 0.2, 0.15], 0.02); K.box('metal', cxc + cw / 2 - 0.45, y + 1.2, zc + 0.12, 0.42, 0.06, 0.04, STEEL, 0);
  K.box('metal', cxc - cw / 2 + 0.5, y + 0.99, zc + 0.05, 0.8, 0.04, 0.5, STEEL, 0); K.box('glass', cxc - cw / 2 + 0.5, y + 1.03, zc + 0.05, 0.8, 0.36, 0.5, [1, 1, 1], 0);
  for (let i = 0; i < 4; i++) { const x = cxc - cw / 2 + 0.2 + i * 0.2; K.box('gloss', x, y + 1.05, zc + 0.05, 0.12, 0.08, 0.1, [0.98, 0.95, 0.9], 0.005); K.box('gloss', x, y + 1.13, zc + 0.05, 0.12, 0.01, 0.1, pick(rng, [[0.85, 0.2, 0.25], [0.45, 0.25, 0.12], [0.55, 0.7, 0.3]]), 0); }
  register(K, cxc + 0.2, y + 0.99, zc);
  K.box('wood', cxc, y + 1.45, zb + 0.15, cw, 0.03, 0.26, DARKW, 0); K.box('wood', cxc, y + 1.85, zb + 0.15, cw, 0.03, 0.26, DARKW, 0);
  for (let x = cxc - cw / 2 + 0.15; x < cxc + cw / 2 - 0.1; x += 0.18) { K.cyl('gloss', x, y + 1.48, zb + 0.15, 0.04, 0.035, 0.08, WHITE, 10); K.box('matte', x, y + 1.88, zb + 0.15, 0.1, 0.18, 0.08, pick(rng, [[0.5, 0.32, 0.2], [0.2, 0.25, 0.2], [0.75, 0.6, 0.35]]), 0.005); }
  K.sign(1.0, 1.25, drawChalk(trade === 7 ? 'Café' : 'Menu', MENUS[trade].items), R.x0 + 0.04, y + 1.55, zb + 1.2, Math.PI / 2, 0.15, 320);
  K.sign(0.3, 0.3, drawClock, cxc, y + 2.3, zb + 0.03, 0, 0.1, 128, 'flat');
  // tables: two-seaters over the floor, clear of the way in; a pendant over each
  for (const [tx, tz] of freeCells(R, zc + 0.75, R.z1 - 0.2, 1.55, 1.4)) {
    table(K, tx, tz, y, 0.65, 0.65, [0.3, 0.2, 0.13], [0.86, 0.78, 0.62]); chair(K, tx - 0.55, tz, y, Math.PI / 2, [0.3, 0.2, 0.13]); chair(K, tx + 0.55, tz, y, -Math.PI / 2, [0.3, 0.2, 0.13]);
    out.seats.push({ x: tx - 0.55, z: tz, y: y + 0.45, yaw: Math.PI / 2 }, { x: tx + 0.55, z: tz, y: y + 0.45, yaw: -Math.PI / 2 });
    K.cyl('gloss', tx, y + 0.75, tz, 0.03, 0.03, 0.12, [0.95, 0.95, 0.9], 8); K.box('matte', tx + 0.15, y + 0.75, tz - 0.1, 0.08, 0.1, 0.05, WHITE, 0.004);
    pendant(K, tx, y + 1.95, tz, R.ceil, [1, 0.88, 0.7], [0.85, 0.75, 0.55]); }
  // a bookshelf and pictures on the side wall, plants in the corners
  const bx = R.x1 - 0.2; K.box('wood', bx, y, R.z1 - 1.6, 0.32, 1.7, 1.0, DARKW, 0.01);
  for (let lv = 0; lv < 4; lv++) for (let i = 0; i < 9; i++) K.box('matte', bx - 0.02, y + 0.12 + lv * 0.4, R.z1 - 2.05 + i * 0.1, 0.22, 0.24 + rng() * 0.06, 0.07, pick(rng, [[0.6, 0.15, 0.12], [0.2, 0.3, 0.45], [0.85, 0.8, 0.65], [0.3, 0.45, 0.3], [0.15, 0.15, 0.17]]), 0);
  for (let k = 0; k < 2; k++) K.sign(0.55, 0.42, drawPoster(['#c98a3e', '#5a7a8a'][k], '#fbf6ea', ['珈琲', '喫茶'][k], ['COFFEE', 'KISSA'][k]), R.x1 - 0.03, y + 1.65, R.z0 + 2.2 + k * 1.1, -Math.PI / 2, 0.1, 256, 'flat');
  K.pack('jp_plants_box_02', R.x0 + 0.4, y, zb + 0.4, 0, 0.75); K.pack('jp_plants_box_01', R.x1 - 0.45, y, R.z1 - 0.4, 0, 0.7);
  pendant(K, cxc - 0.6, y + 2.0, zc, R.ceil, [1, 0.88, 0.7], [0.85, 0.75, 0.55]); pendant(K, cxc + 0.6, y + 2.0, zc, R.ceil, [1, 0.88, 0.7], [0.85, 0.75, 0.55]);
  out.keeper = { x: cxc, z: zc - 0.6, yaw: 0 };
  out.spots.push({ kind: 'counter', x: cxc, z: zc + 0.75, r: 2.0 });
}
function caseShop(K, R, trade, rng, out) {
  const y = R.y, zb = R.z0, bake = trade === 11, zc = zb + 1.45, len = Math.min(R.W - 1.2, 4.2), cx = R.x0 + 0.3 + len / 2;
  // the glass case: a base, lit glass box, trays of what is sold
  K.box('wood', cx, y, zc, len, 0.78, 0.62, bake ? [0.86, 0.8, 0.7] : DARKW, 0.012);
  K.box('metal', cx, y + 0.78, zc, len, 0.03, 0.62, STEEL, 0); K.box('glass', cx, y + 0.81, zc, len, 0.42, 0.62, [1, 1, 1], 0); K.box('wood', cx, y + 1.23, zc, len + 0.02, 0.03, 0.64, bake ? LIGHTW : DARKW, 0.006);
  K.box('lit', cx, y + 1.2, zc, len - 0.1, 0.012, 0.5, [1, 0.97, 0.9], 0);
  const goods = MENUS[trade].items.filter(id => !ITEMS[id].here && !ITEMS[id].look[0].match(/pet|can/));
  const per = len / Math.max(1, goods.length);
  goods.forEach((id, k) => { const gx = cx - len / 2 + per * (k + 0.5), look = ITEMS[id].look; K.box('matte', gx, y + 0.82, zc, per - 0.1, 0.012, 0.42, [0.95, 0.94, 0.9], 0);
    for (let i = 0; i < 6; i++) { const ix = gx - per / 2 + 0.1 + (i % 3) * (per - 0.2) / 2, iz = zc - 0.1 + Math.floor(i / 3) * 0.2, yy = y + 0.835;
      if (look[0] === 'dango') { K.box('wood', ix, yy + 0.01, iz, 0.14, 0.006, 0.006, LIGHTW, 0); ['#f3a9bd', '#fbf6ea', '#9cc46a'].forEach((c, j) => K.cyl('gloss', ix - 0.04 + j * 0.04, yy, iz, 0.02, 0.02, 0.035, hex(c), 8)); }
      else if (look[0] === 'daifuku') K.cyl('gloss', ix, yy, iz, 0.035, 0.03, 0.035, [0.98, 0.97, 0.94], 10);
      else if (look[0] === 'taiyaki') K.box('gloss', ix, yy, iz, 0.12, 0.03, 0.06, [0.82, 0.55, 0.25], 0.012);
      else if (look[0] === 'croissant') K.box('gloss', ix, yy, iz, 0.12, 0.05, 0.07, [0.85, 0.58, 0.25], 0.02);
      else K.cyl('gloss', ix, yy, iz, 0.05, 0.045, look[0] === 'dorayaki' ? 0.035 : 0.05, hex(look[1] && look[1][0] === '#' ? look[1] : look[0] === 'dorayaki' ? '#b8692a' : look[0] === 'currypan' ? '#c48a3e' : '#d9a35a'), 12); }
    K.sign(0.12, 0.07, drawLabel('#ffffff', '#b8322a', ITEMS[id].price + '円', ITEMS[id].jp.slice(0, 4)), gx, y + 0.86, zc + 0.27, 0, 0.1, 64, 'flat'); });
  // behind: shelves of boxes (gift boxes or bread bags), a register at the case's end
  K.box('wood', R.cx, y, zb + 0.25, R.W - 0.4, 0.9, 0.42, bake ? [0.9, 0.86, 0.78] : DARKW, 0.012);
  for (let x = R.x0 + 0.4; x < R.x1 - 0.3; x += 0.34) K.box('matte', x, y + 0.9, zb + 0.25, 0.28, 0.12 + rng() * 0.08, 0.26, pick(rng, bake ? [[0.95, 0.9, 0.8], [0.8, 0.62, 0.4]] : [[0.75, 0.15, 0.15], [0.95, 0.92, 0.85], [0.2, 0.3, 0.45], [0.55, 0.7, 0.4]]), 0.006);
  K.box('wood', R.cx, y + 1.5, zb + 0.15, R.W - 0.4, 0.03, 0.25, DARKW, 0);
  for (let x = R.x0 + 0.4; x < R.x1 - 0.3; x += 0.3) K.box('matte', x, y + 1.53, zb + 0.15, 0.22, 0.16, 0.18, pick(rng, [[0.85, 0.75, 0.55], [0.75, 0.2, 0.2], [0.95, 0.95, 0.9]]), 0.006);
  const tx = cx + len / 2 + 0.35; if (tx < R.x1 - 0.2) { K.box('wood', tx, y, zc, 0.5, 0.92, 0.6, bake ? [0.86, 0.8, 0.7] : DARKW, 0.01); register(K, tx, y + 0.92, zc); }
  if (bake) { // bread racks along the side wall and a tray stand by the door
    for (let tz = zc + 1.2; tz < R.z1 - 1.2; tz += 1.3) { const rx = R.x1 - 0.35; K.box('wood', rx, y, tz, 0.5, 1.3, 1.1, LIGHTW, 0.01);
      for (let lv = 0; lv < 3; lv++) for (let i = 0; i < 4; i++) K.box('gloss', rx, y + 0.35 + lv * 0.4, tz - 0.4 + i * 0.27, 0.16, 0.08, 0.14, pick(rng, [[0.82, 0.55, 0.25], [0.9, 0.75, 0.4], [0.72, 0.42, 0.2]]), 0.03); }
    K.box('wood', R.door[0] - 0.45, y, R.z1 - 0.45, 0.4, 0.9, 0.4, LIGHTW, 0.01); for (let i = 0; i < 6; i++) K.box('matte', R.door[0] - 0.45, y + 0.9 + i * 0.012, R.z1 - 0.45, 0.36, 0.01, 0.28, [0.75, 0.6, 0.4], 0);
  } else { // a bench with red felt and a parasol, a hanging scroll
    const bx = R.x0 + 0.5; K.box('wood', bx, y, R.z1 - 1.6, 0.5, 0.42, 1.4, DARKW, 0.01); K.box('matte', bx, y + 0.42, R.z1 - 1.6, 0.52, 0.02, 1.42, [0.75, 0.12, 0.12], 0);
    out.seats.push({ x: bx, z: R.z1 - 1.9, y: y + 0.44, yaw: Math.PI / 2 }, { x: bx, z: R.z1 - 1.3, y: y + 0.44, yaw: Math.PI / 2 });
    K.sign(0.42, 1.1, drawScroll('和'), R.x0 + 0.04, y + 1.5, zc + 0.9, Math.PI / 2, 0.05, 256, 'flat');
  }
  // the floor: a sweet shop's tea tables (甘味処: benches in red felt, a parasol), a bakery's display tables of baskets
  freeCells(R, zc + 0.9, R.z1 - 0.2, 1.9, 1.7).forEach(([fx, fz], k) => {
    if (bake) { table(K, fx, fz, y, 1.0, 0.7, LIGHTW); for (let i = 0; i < 4; i++) { const bx = fx - 0.36 + i * 0.24; K.cyl('wood', bx, y + 0.75, fz, 0.1, 0.12, 0.08, [0.72, 0.55, 0.32], 10); for (let j = 0; j < 3; j++) K.box('gloss', bx - 0.04 + j * 0.04, y + 0.8, fz - 0.03 + (j % 2) * 0.05, 0.07, 0.05, 0.06, pick(rng, [[0.82, 0.55, 0.25], [0.9, 0.75, 0.4], [0.72, 0.42, 0.2]]), 0.02); } return; }
    K.box('wood', fx, y, fz, 0.55, 0.45, 0.55, DARKW, 0.01); for (const sd of [-1, 1]) { K.box('wood', fx + sd * 0.6, y, fz, 0.38, 0.4, 0.9, DARKW, 0.01); K.box('matte', fx + sd * 0.6, y + 0.4, fz, 0.4, 0.02, 0.92, [0.75, 0.12, 0.12], 0); out.seats.push({ x: fx + sd * 0.6, z: fz, y: y + 0.42, yaw: -sd * Math.PI / 2 }); }
    K.cyl('gloss', fx - 0.1, y + 0.45, fz, 0.04, 0.035, 0.07, [0.35, 0.5, 0.3], 10); K.box('matte', fx + 0.1, y + 0.45, fz, 0.18, 0.015, 0.12, [0.9, 0.85, 0.7], 0);
    if (k === 0) { K.cyl('wood', fx + 0.95, y, fz + 0.5, 0.02, 0.02, 2.0, LIGHTW, 6, false); K.cyl('matte', fx + 0.95, y + 1.75, fz + 0.5, 1.05, 0.04, 0.45, [0.8, 0.12, 0.1], 16); } });
  for (let i = 0; i < 2; i++) panel(K, R.cx + (i - 0.5) * R.W * 0.4, R.ceil, R.cz, 1.2, 0.3);
  out.keeper = { x: cx, z: zc - 0.6, yaw: 0 };
  out.spots.push({ kind: 'counter', x: cx, z: zc + 0.75, r: Math.max(2.0, len / 2 + 0.5) });
}
const hex = h => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
// the shelves shops: pharmacy, liquor shop (and the konbini, below)
export const SECTIONS = {
  1: [{ name: 'Health drinks & jelly', jp: '栄養ドリンク', items: ['energy', 'jelly'] }, { name: 'Drinks', jp: '飲料', items: ['sports', 'water', 'greentea'], fridge: true }, { name: 'Sweets', jp: 'お菓子', items: ['pocky'] }],
  8: [{ name: 'Soft drinks', jp: 'ソフトドリンク', items: ['ramune', 'orange', 'cola'] }, { name: 'Tea & water', jp: 'お茶・水', items: ['greentea', 'mugicha', 'water', 'coffeecan'], fridge: true }],
  konbini: [{ name: 'Drinks', jp: '飲料', items: ['greentea', 'water', 'milktea', 'sports', 'cola', 'orange', 'coffeecan'], fridge: true },
    { name: 'Rice balls & bento', jp: 'おにぎり・弁当', items: ['onigiri_salmon', 'onigiri_tuna', 'sando', 'bento'], chill: true },
    { name: 'Sweets & snacks', jp: 'お菓子', items: ['pocky', 'jelly', 'energy'] }, { name: 'Ice cream', jp: 'アイス', items: ['icecream'], freezer: true }],
};
function shelfShop(K, R, trade, rng, out, seed) {
  const y = R.y, zb = R.z0, ph = trade === 1, secs = SECTIONS[trade];
  // the fridge along the back wall, racks down the room (clear of the door), the till by the door
  const fx0 = R.x0 + 0.3, fx1 = Math.min(R.x1 - 0.3, R.x0 + 0.3 + Math.max(1.6, R.W * 0.55));
  fridgeWall(K, fx0, fx1, zb + 0.62, y, rng, 1.95, 0.6);
  out.spots.push({ kind: 'shelf', ...secs.find(s => s.fridge), x: (fx0 + fx1) / 2, z: zb + 1.25, r: 1.6, tx: (fx0 + fx1) / 2, tz: zb + 0.3 });
  const others = secs.filter(s => !s.fridge);
  // racks: one along the side wall away from the door, one down the middle if there is room
  const wallX = R.door[0] - R.x0 > R.x1 - R.door[1] ? R.x0 + 0.32 : R.x1 - 0.32, yawW = wallX < R.cx ? Math.PI / 2 : -Math.PI / 2;
  const rz = zb + 1.0 + (R.D - 1.6) / 2;
  rack(K, wallX, Math.min(rz, R.z1 - 1.5), y, yawW, seed + 1);
  out.spots.push({ kind: 'shelf', ...others[0], x: wallX + (yawW > 0 ? 1.1 : -1.1), z: Math.min(rz, R.z1 - 1.5), r: 1.6, tx: wallX, tz: Math.min(rz, R.z1 - 1.5) });
  if (others[1] && R.W > 4.2) { const mx = (wallX + R.cx) / 2 + (wallX < R.cx ? 0.9 : -0.9); rack(K, mx, rz, y, yawW, seed + 2); out.spots.push({ kind: 'shelf', ...others[1], x: mx + (yawW > 0 ? 1.0 : -1.0), z: rz, r: 1.4, tx: mx, tz: rz }); }
  // the till: across the room's other side, toward the front
  const tw = 1.5, tx = wallX < R.cx ? R.x1 - 0.55 : R.x0 + 0.55, tz = R.z1 - 1.6;
  sideTill(K, tx, tz, y, tw, 0.6, wallX < R.cx ? -1 : 1, ph ? WHITE : [0.4, 0.3, 0.22], ph ? [0.85, 0.88, 0.9] : [0.25, 0.18, 0.12]);
  out.keeper = { x: tx + (wallX < R.cx ? 0.55 : -0.55), z: tz, yaw: wallX < R.cx ? -Math.PI / 2 : Math.PI / 2 };
  out.spots.push({ kind: 'till', x: tx + (wallX < R.cx ? -0.95 : 0.95), z: tz, r: 1.6 });
  // a poster, the clock, lit ceiling panels
  K.sign(0.6, 0.85, ph ? drawPoster('#1f6fb5', '#ffffff', '健康', 'くすりのヤマダ', 'HEALTH & BEAUTY') : drawPoster('#1d3557', '#f2d49b', '地酒', 'たなか酒店', 'SAKE · DRINKS'), R.cx + 0.6, y + 1.9, zb + 0.03, 0, 0.2, 256, 'flat');
  if (ph) K.sign(1.0, 0.34, drawLabel('#ffffff', '#1f6fb5', 'DISPENSING', '調剤'), R.x1 - 0.8, y + 2.05, zb + 0.03, 0, 0.3, 128, 'flat');
  K.sign(0.3, 0.3, drawClock, R.x0 + 0.6, y + 2.2, zb + 0.03, 0, 0.1, 128, 'flat');
  for (let i = 0; i < 3; i++) panel(K, R.cx, R.ceil, R.z0 + (i + 0.5) * R.D / 3, 1.2, 0.3);
  if (!ph) for (let i = 0; i < 3; i++) K.box('wood', R.x0 + 0.5 + i * 0.5, y, R.z1 - 0.5, 0.45, 0.3, 0.33, [0.75, 0.55, 0.2], 0.01); // (beer crates by the door)
}
function konbini(K, R, rng, out, seed) {
  // the shop floor behind the glass vestibule: drinks along the back wall (left) and the chilled case of rice balls and
  // bento (right), a gondola down the middle, the till against the front wall right of the way in (hot snacks, coffee
  // machine, cigarettes behind the clerk), the ice-cream chest left; in the vestibule the magazine rack, the ATM and the
  // copier
  const y = R.y, zb = R.z0, secs = SECTIONS.konbini;
  fridgeWall(K, R.x0 + 0.2, -0.15, zb + 0.62, y, rng, 1.95, 0.6);
  out.spots.push({ kind: 'shelf', ...secs[0], x: (R.x0 + 0.2 - 0.15) / 2, z: zb + 1.25, r: 1.8, tx: (R.x0 + 0.2 - 0.15) / 2, tz: zb + 0.3 });
  const cx0 = 0.15, cx1 = R.x1 - 0.2, cc = (cx0 + cx1) / 2; // chilled open case: tiers of rice balls, sandwiches and bento
  K.box('matte', cc, y, zb + 0.4, cx1 - cx0, 0.72, 0.75, WHITE, 0.01); K.box('matte', cc, y, zb + 0.14, cx1 - cx0, 1.95, 0.25, WHITE, 0.01);
  K.box('lit', cc, y + 1.85, zb + 0.32, cx1 - cx0, 0.1, 0.3, [0.95, 0.97, 1], 0); K.box('gloss', cc, y + 0.72, zb + 0.78, cx1 - cx0, 0.06, 0.03, [0.1, 0.55, 0.3], 0);
  for (let lv = 0; lv < 4; lv++) { const yy = y + 0.76 + lv * 0.27, dz = zb + 0.62 - lv * 0.1; K.box('metal', cc, yy - 0.02, dz, cx1 - cx0, 0.015, 0.3, STEEL, 0);
    for (let x = cx0 + 0.08; x < cx1 - 0.06; x += 0.13) { const kind = lv < 2 ? 'oni' : lv === 2 ? 'sando' : 'bento';
      if (kind === 'oni') { K.box('gloss', x, yy, dz, 0.1, 0.09, 0.03, [0.97, 0.97, 0.95], 0.008); K.box('gloss', x, yy, dz + 0.016, 0.05, 0.06, 0.004, [0.12, 0.18, 0.14], 0); K.box('gloss', x, yy + 0.07, dz + 0.016, 0.05, 0.015, 0.004, pick(rng, [[0.9, 0.3, 0.2], [0.95, 0.85, 0.4], [0.2, 0.5, 0.25]]), 0); }
      else if (kind === 'sando') K.box('gloss', x, yy, dz, 0.11, 0.1, 0.06, [0.97, 0.92, 0.55], 0.01);
      else { K.box('gloss', x, yy, dz, 0.12, 0.05, 0.12, [0.1, 0.1, 0.1], 0.008); K.box('gloss', x, yy + 0.05, dz, 0.11, 0.004, 0.11, [0.85, 0.55, 0.3], 0); x += 0.02; } } }
  out.spots.push({ kind: 'shelf', ...secs[1], x: cc, z: zb + 1.3, r: 1.7, tx: cc, tz: zb + 0.4 });
  // the gondola
  const gz = zb + 1.85; rack(K, 0, gz, y, Math.PI, seed + 3);
  out.spots.push({ kind: 'shelf', ...secs[2], x: 0, z: gz + 0.9, r: 1.5, tx: 0, tz: gz }, { kind: 'shelf', ...secs[2], x: 0, z: gz - 0.85, r: 1.2, tx: 0, tz: gz });
  // the ice-cream chest
  const ix = R.x0 + 0.9, iz = R.z1 - 0.65; K.box('matte', ix, y, iz, 1.0, 0.8, 0.6, WHITE, 0.02); K.box('glass', ix, y + 0.8, iz, 0.96, 0.02, 0.56, [1, 1, 1], 0); K.box('lit', ix, y + 0.79, iz, 0.9, 0.005, 0.5, [0.75, 0.9, 1], 0);
  for (let i = 0; i < 8; i++) K.box('gloss', ix - 0.36 + (i % 4) * 0.24, y + 0.62, iz - 0.12 + Math.floor(i / 4) * 0.24, 0.18, 0.06, 0.08, pick(rng, [[0.5, 0.8, 0.95], [0.95, 0.6, 0.7], [0.95, 0.9, 0.7]]), 0.01);
  out.spots.push({ kind: 'shelf', ...secs[3], x: ix, z: iz - 0.95, r: 1.4, tx: ix, tz: iz });
  // the till against the front wall, right of the way in: the clerk between it and the wall, facing the shop
  const tx = (Math.max(R.vx1 ?? 2, 2.1) + R.x1) / 2 + 0.1, tw = Math.min(2.2, R.x1 - (R.vx1 ?? 2) - 0.3), tz = R.z1 - 0.72;
  K.box('matte', tx, y, tz, tw, 0.92, 0.6, [0.96, 0.96, 0.94], 0.012); K.box('gloss', tx, y + 0.92, tz, tw + 0.04, 0.04, 0.64, [0.2, 0.42, 0.72], 0.008);
  K.box('gloss', tx, y + 0.3, tz - 0.31, tw, 0.08, 0.01, [0.1, 0.55, 0.3], 0); K.box('gloss', tx, y + 0.42, tz - 0.31, tw, 0.04, 0.01, [0.2, 0.42, 0.72], 0);
  register(K, tx + tw * 0.2, y + 0.96, tz); 
  // hot snacks: a lit warmer (karaage, croquettes) and the nikuman steamer; the coffee machine at the end
  const hx = tx - tw * 0.25; K.box('metal', hx, y + 0.96, tz, 0.55, 0.4, 0.42, STEEL, 0.01); K.box('glass', hx, y + 0.98, tz - 0.21, 0.5, 0.34, 0.01, [1, 1, 1], 0); K.box('lit', hx, y + 1.33, tz, 0.5, 0.02, 0.38, [1, 0.8, 0.5], 0);
  for (let i = 0; i < 6; i++) K.box('gloss', hx - 0.17 + (i % 3) * 0.17, y + 1.0 + Math.floor(i / 3) * 0.16, tz - 0.04, 0.12, 0.06, 0.1, pick(rng, [[0.85, 0.55, 0.2], [0.8, 0.45, 0.15], [0.95, 0.8, 0.35]]), 0.01);
  K.box('gloss', tx - tw / 2 + 0.2, y + 0.96, tz, 0.36, 0.56, 0.38, [0.12, 0.12, 0.14], 0.02); K.box('lit', tx - tw / 2 + 0.2, y + 1.3, tz - 0.195, 0.24, 0.14, 0.01, [0.95, 0.7, 0.4], 0); K.cyl('gloss', tx - tw / 2 + 0.2, y + 0.98, tz - 0.08, 0.04, 0.035, 0.1, WHITE, 10);
  for (let i = 0; i < 30; i++) K.box('gloss', tx - tw / 2 + 0.2 + (i % 10) * (tw - 0.4) / 9, y + 1.45 + Math.floor(i / 10) * 0.13, R.z1 - 0.06, 0.08, 0.1, 0.05, pick(rng, [[0.95, 0.95, 0.95], [0.2, 0.3, 0.7], [0.8, 0.15, 0.15], [0.9, 0.75, 0.2], [0.2, 0.2, 0.2]]), 0.004);
  out.keeper = { x: tx, z: R.z1 - 0.2, yaw: Math.PI };
  out.spots.push({ kind: 'till', x: tx, z: tz - 0.95, r: 1.6 });
  // the vestibule: magazine rack along its left, ATM and copier along its right
  if (R.vx0 !== undefined) {
    const mx = R.vx0 + 0.22; K.box('matte', mx, y, (R.vz0 + R.vz1) / 2 - 0.2, 0.36, 0.9, Math.min(2.2, R.vz1 - R.vz0 - 0.8), [0.9, 0.9, 0.88], 0.01);
    for (let i = 0; i < 12; i++) K.box('matte', mx + 0.12, y + 0.92 - (i % 2) * 0.35, R.vz0 + 0.35 + Math.floor(i / 2) * 0.32, 0.03, 0.3, 0.22, pick(rng, [[0.9, 0.3, 0.3], [0.3, 0.5, 0.9], [0.95, 0.85, 0.3], [0.95, 0.95, 0.95], [0.4, 0.75, 0.4], [0.95, 0.6, 0.75]]), 0);
    const ax = R.vx1 - 0.32; K.box('gloss', ax, y, R.vz0 + 0.55, 0.55, 1.45, 0.6, [0.85, 0.87, 0.9], 0.02); K.box('lit', ax - 0.28, y + 1.05, R.vz0 + 0.55, 0.01, 0.22, 0.35, [0.4, 0.7, 0.95], 0); K.box('gloss', ax - 0.25, y + 0.85, R.vz0 + 0.55, 0.1, 0.03, 0.4, [0.3, 0.3, 0.32], 0);
    K.sign(0.5, 0.18, drawLabel('#1f5fb4', '#ffffff', 'ATM', 'ATM'), ax, y + 1.62, R.vz0 + 0.55, -Math.PI / 2, 0.3, 64, 'flat');
    K.box('gloss', ax, y, R.vz0 + 1.45, 0.6, 1.05, 0.65, [0.92, 0.92, 0.9], 0.02); K.box('dark', ax - 0.1, y + 1.05, R.vz0 + 1.45, 0.4, 0.04, 0.5, [0.2, 0.2, 0.22], 0);
    K.box('matte', R.cx, y + R.ceil, (R.vz0 + R.vz1) / 2 + 0.2, R.vx1 - R.vx0 + 1.2, 0.05, R.vz1 - R.vz0 + 0.5, WHITE, 0); panel(K, R.cx, y + R.ceil, R.vz0 + 0.9, 1.2, 0.2); panel(K, R.cx, y + R.ceil, R.vz0 + 2.0, 1.2, 0.2);
  }
  // the lit ceiling over the shop floor, posters
  K.box('matte', R.cx, y + R.ceil, R.cz, R.W + 0.1, 0.05, R.D + 0.1, WHITE, 0);
  for (let k = 0; k < 4; k++) for (let j = 0; j < 2; j++) panel(K, R.x0 + R.W * (k + 0.5) / 4, y + R.ceil, R.z0 + 0.9 + j * 1.5, 1.4, 0.18);
  K.sign(0.8, 0.55, drawPoster('#0a8a4b', '#ffffff', '100円', 'おにぎりフェア', 'RICE BALL FAIR'), R.x1 - 0.03, y + 1.75, R.z0 + 1.6, -Math.PI / 2, 0.3, 256, 'flat');
  K.sign(0.55, 0.55, drawPoster('#f2c400', '#c0281e', 'NEW', '新発売', 'からあげクン'), tx + tw / 2 - 0.3, y + 2.0, R.z1 - 0.05, Math.PI, 0.3, 256, 'flat');
  K.sign(0.3, 0.3, drawClock, R.x0 + 0.03, y + 2.1, R.z0 + 1.8, Math.PI / 2, 0.1, 128, 'flat');
}
function cycleShop(K, R, rng, out) {
  const y = R.y;
  // bicycles along the left, a wall of bags on the right, the counter in the middle back
  for (let i = 0; i < 3; i++) K.pack(i % 2 ? 'jp_bicycle_2' : 'jp_bicycle_1', R.x0 + 0.5 + i * 0.55, y, R.cz, Math.PI / 2 - 0.25, 0.75, false);
  const wx = R.x1 - 0.12; K.box('wood', wx, y + 0.3, R.cz, 0.04, 1.8, R.D - 0.3, [0.85, 0.78, 0.62], 0);
  for (let j = 0; j < 3; j++) for (let i = 0; i < Math.floor((R.D - 0.4) / 0.45); i++) { const bz = R.z0 + 0.35 + i * 0.45, by = y + 0.55 + j * 0.55, c = pick(rng, [[0.18, 0.29, 0.39], [0.48, 0.35, 0.23], [0.55, 0.14, 0.12], [0.2, 0.35, 0.22], [0.15, 0.15, 0.17]]);
    K.box('matte', wx - 0.14, by, bz, 0.22, 0.38, 0.3, c, 0.06); K.box('matte', wx - 0.24, by + 0.06, bz, 0.04, 0.18, 0.22, c, 0.02); }
  const tx = R.cx + 0.4, tz = R.z0 + 0.45; till(K, tx, tz, y, 1.6, 0.55, [0.35, 0.25, 0.18], [0.75, 0.62, 0.45]);
  out.keeper = { x: tx, z: tz - 0.5, yaw: 0 };
  out.spots.push({ kind: 'counter', x: tx, z: tz + 0.85, r: 1.8 });
  panel(K, R.cx, R.ceil, R.cz, 1.6, 0.3);
}

// ---------------------------------------------------------------- the building: its door leaves taken out and sliding
function splitDoors(id, M, swap, spec, o, r, s) {
  const P = packsReady(), m = P.models[id], leaves = spec.leaves || [], out = { parts: [], doors: [] };
  const groups = leaves.map(() => []); // per leaf: [{ material, tris (model units) }]
  for (const q of m.parts) {
    const mat = swap(q.material);
    if (!leaves.length || /wall|roof|tiles|ground|brick|concrete/i.test(q.material.name)) { out.parts.push({ geometry: q.geometry, material: mat, matrix: M, castShadow: q.castShadow !== false }); continue; }
    const g = q.geometry, pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv, idx = g.index, n = idx ? idx.count : pos.count;
    const rest = { p: [], n: [], u: [] }, mine = leaves.map(() => ({ p: [], n: [], u: [] }));
    for (let t = 0; t < n; t += 3) {
      const I = [0, 1, 2].map(k => idx ? idx.getX(t + k) : t + k);
      // (a leaf: whatever lies within its width at the front, up to the door's head — frame, glass or paper, handle — but
      // not the head rail over it nor the floor under it)
      let x0 = 1e9, x1 = -1e9, y1 = -1e9, cz = 0; for (const i of I) { x0 = Math.min(x0, pos.getX(i)); x1 = Math.max(x1, pos.getX(i)); y1 = Math.max(y1, pos.getY(i)); cz += pos.getZ(i) / 3; }
      const L = y1 < 0.25 || y1 > (spec.top || 2.25) ? -1 : leaves.findIndex(([a, b]) => x0 > a - 0.03 && x1 < b + 0.03 && Math.abs(cz - spec.front) < 0.25);
      const dst = L >= 0 ? mine[L] : rest;
      for (const i of I) { dst.p.push(pos.getX(i), pos.getY(i), pos.getZ(i)); if (nor) dst.n.push(nor.getX(i), nor.getY(i), nor.getZ(i)); if (uv) dst.u.push(uv.getX(i), uv.getY(i)); }
    }
    const geo = d => { const G = new THREE.BufferGeometry(); G.setAttribute('position', new THREE.Float32BufferAttribute(d.p, 3)); if (d.n.length) G.setAttribute('normal', new THREE.Float32BufferAttribute(d.n, 3)); if (d.u.length) G.setAttribute('uv', new THREE.Float32BufferAttribute(d.u, 2)); G.computeBoundingSphere(); return G; };
    if (rest.p.length) out.parts.push({ geometry: geo(rest), material: mat, matrix: M, castShadow: q.castShadow !== false });
    mine.forEach((d, k) => { if (d.p.length) groups[k].push({ geometry: geo(d), material: mat }); });
  }
  // each leaf: its meshes, moved along the front by up to its width (model units)
  const c = Math.cos(r), sn = Math.sin(r);
  leaves.forEach(([a, b, dir], k) => {
    if (!groups[k].length) return;
    const meshes = groups[k].map(({ geometry, material }) => { const me = new THREE.Mesh(geometry, material); me.matrixAutoUpdate = false; me.matrix.copy(M); me.matrixWorld.copy(M); me.castShadow = true; me.receiveShadow = true; scene.add(me); return me; });
    const T = new THREE.Matrix4(), wdt = (b - a) * 0.97, mx = (a + b) / 2;
    const wx = o[0] + mx * s[0] * c + spec.front * s[2] * sn, wz = o[2] - mx * s[0] * sn + spec.front * s[2] * c;
    out.doors.push({ x: wx, z: wz, auto: true, move: t => { T.makeTranslation(dir * wdt * t, 0, 0); for (const me of meshes) { me.matrixWorld.multiplyMatrices(M, T); } }, show: v => { for (const me of meshes) me.visible = v; } });
  });
  return out;
}

// ---------------------------------------------------------------- the whole: called by building.js for a pack shop
// returns the site's interior (or null when the shop is not entered): { kitWhere, kitProp, finish(B, mark) }
export function packInterior({ id, M, swap, o, r, s, site, y }) {
  const spec = SPECS[id]; if (!spec || !packsReady() || !canEnter(site.trade, id)) return null;
  const tris = [], K = kit(o, r, tris), seed = Math.abs(Math.floor(o[0] * 13 + o[2] * 7)), rng = rnd(seed);
  // the building, its door leaves apart
  const B = splitDoors(id, M, swap, spec, o, r, s);
  addProp('pack:' + id + ':shop', B.parts);
  for (const p of B.parts) { const g = p.geometry, pos = g.attributes.position, idx = g.index, n = idx ? idx.count : pos.count, v = new THREE.Vector3(); for (let i = 0; i < n; i++) { v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(M); tris.push(v.x, v.y, v.z); } }
  const [rx0, rx1, rz0, rz1] = spec.room, floorY = 0.06 * s[1] + 0.02;
  const R = { x0: rx0 * s[0], x1: rx1 * s[0], z0: rz0 * s[2], z1: rz1 * s[2], y: floorY, door: [spec.door[0] * s[0], spec.door[1] * s[0]], front: spec.front * s[2], ceil: (spec.ceiling || 2.3) * s[1] - 0.05 };
  R.cx = (R.x0 + R.x1) / 2; R.cz = (R.z0 + R.z1) / 2; R.W = R.x1 - R.x0; R.D = R.z1 - R.z0;
  if (spec.vest) { R.vx0 = spec.vest[0] * s[0]; R.vx1 = spec.vest[1] * s[0]; R.vz0 = spec.vest[2] * s[2]; R.vz1 = spec.vest[3] * s[2]; }
  return {
    // the kit's own things inside the room are left out (the room is furnished anew)
    // (and what the kit stuck on the doors — stickers on the glass would stay behind as a leaf slides)
    kitWhere: (src, x, yy, z) => (x > rx0 - 0.1 && x < rx1 + 0.1 && z > rz0 - 0.1 && z < (spec.vest ? spec.vest[3] : rz1) + 0.05 && yy < 2.6) || (x > spec.door[0] - 0.15 && x < spec.door[1] + 0.15 && Math.abs(z - spec.front) < 0.4 && yy < 2.4),
    kitProp: (src, m) => { if (!/sticker|sign|lamp|cable|warning|ventilation|aircondition|fusebox|lantern|cloth/.test(src)) packTris(src, m, tris); },
    finish(BB, mark) {
      const out = { spots: [], seats: [], keeper: null }, t = site.trade;
      const cap = capHooks.bucket; capHooks.bucket = null; // (the furnishings are the shop's own; the World Builder does not edit them)
      const ib = builder(), m0 = new Map(); for (const [k, b] of ib.parts) m0.set(k, b.idx.length);
      ib.frame(o[0], o[1], o[2], r);
      ib.detail(2, () => { // (fittings: near detail, drawn within ~90 m)
        if (t === 'konbini') konbini(K, R, rng, out, seed); else if (t === 15) cycleShop(K, R, rng, out);
        else if (MENUS[t].serve === 'shelves') shelfShop(K, R, t, rng, out, seed);
        else if (t === 7) cafe(K, R, t, rng, out); else if (t === 6 || t === 11) caseShop(K, R, t, rng, out); else eatery(K, R, t, rng, out);
      });
      if (t !== 0 && t !== 3 && t !== 12 && t !== 16) { K.lamp(R.cx, y0Lamp(R), R.cz, R.W * R.D > 30 ? 0.9 : 0.7); if (R.vx0 !== undefined) K.lamp(R.cx, y0Lamp(R), (R.vz0 + R.vz1) / 2, 0.6); }
      // (the furnishings' triangles, and the building builder's since the shop began: its slab)
      for (const [k, b] of ib.parts) { const P2 = b.pos.a, I = b.idx.a; for (let i = m0.get(k) || 0; i < b.idx.length; i++) { const v = I[i] * 3; tris.push(P2[v], P2[v + 1], P2[v + 2]); } }
      for (const [k, b] of BB.parts) { const P2 = b.pos.a, I = b.idx.a; for (let i = mark.get(k) || 0; i < b.idx.length; i++) { const v = I[i] * 3; tris.push(P2[v], P2[v + 1], P2[v + 2]); } }
      capHooks.bucket = cap;
      const C = addCompound(buildCompound(new Float32Array(tris), { x: o[0], y: o[1], z: o[2], r, ground: () => y }));
      // the site: the world places of all this
      const W = (lx, lz) => K.W(lx, 0, lz);
      const zmax = spec.vest ? R.vz1 : R.z1, zmin = R.z0, xmin = Math.min(R.x0, R.vx0 ?? R.x0), xmax = Math.max(R.x1, R.vx1 ?? R.x1);
      const bc = W((xmin + xmax) / 2, (zmin + zmax) / 2);
      site.box = { x: bc[0], z: bc[2], r, hx: (xmax - xmin) / 2, hz: (zmax - zmin) / 2 + 0.15 };
      const dIn = W((R.door[0] + R.door[1]) / 2, zmax - 0.6); site.inDoor = [dIn[0], dIn[2]];
      const dOut = W((R.door[0] + R.door[1]) / 2, R.front + 1.2); site.door = { x: dOut[0], z: dOut[2], yaw: r };
      if (out.keeper) { const k = W(out.keeper.x, out.keeper.z); site.keeper = { x: k[0], y: o[1] + R.y, z: k[2], yaw: r + out.keeper.yaw }; }
      // (each with what it is: the shopkeeper over the counter, the shelf — the player faces that)
      site.spots = out.spots.map(p => { const w = W(p.x, p.z), tg = p.tx !== undefined ? W(p.tx, p.tz) : (p.kind === 'counter' || p.kind === 'till') && out.keeper ? W(out.keeper.x, out.keeper.z) : null; return { ...p, x: w[0], z: w[2], tx: tg ? tg[0] : undefined, tz: tg ? tg[2] : undefined }; });
      site.seats = out.seats.map(p => { const w = W(p.x, p.z); return { x: w[0], z: w[2], y: o[1] + p.y, floor: o[1] + R.y, yaw: r + p.yaw, stool: !!p.stool }; });
      site.doors = B.doors;
      site.inside = true; site.collider = C; site.enter = true;
      // the doorway shut when the shop is closed
      if (B.doors.length) { const a = W(R.door[0], R.front), b = W(R.door[1], R.front), cc = { t: 1, x: (a[0] + b[0]) / 2, z: (a[2] + b[2]) / 2, hx: Math.hypot(b[0] - a[0], b[2] - a[2]) / 2 + 0.1, hz: 0.12, c: Math.cos(r), s: Math.sin(r), y0: -1e9, y1: 1e9 };
        let on = false; site.doors[0].block = v => { if (!!v === on) return; on = !!v; if (on) colInsert(cc); else colRemove(cc); }; }
      if (t === 'konbini') { const bw = W(R.door[1] + 1.5, R.front + 0.8); site.bins = [[bw[0], bw[2]]]; }
    },
  };
}
