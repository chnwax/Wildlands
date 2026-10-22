// The insides of the shops you can walk into. Each shop that sells something (items.js MENUS) gets a way in and a room
// made for its trade — not furniture dropped into the model's empty box, but the room itself: its floor (quarry
// tiles, planks, vinyl, slate, tatami), panelling and skirting round its walls, a ceiling of panels or slats where the
// model's own is bare, its lamps (lighting the room only: citylights.js), and furniture at the sizes of real things
// (the model library's own is drawn a third larger than life; it is used here at its true size), laid out the way such
// a shop is laid out:
//  - ramen: the kitchen along the back (stoves, noodle boiler, hood, bowls), the counter with its pass ledge and
//    condiments, stools, two-seat tables, the ticket machine by the door, signed boards and a manga shelf, a TV
//  - izakaya, soba, sushi: kitchen and counter as above (a grill, a fish case), a raised tatami room with low tables
//    and cushions, menu strips along the wall, sake bottles, lanterns, beer posters
//  - café: a counter in the middle of the back with the espresso machine, the cake case and a back bar, a bar along
//    the front window, a bench along the side wall with small tables, pictures, a bookshelf, plants
//  - sweet shop and bakery: the glass case just inside the window, gift boxes on the wall behind, tea benches or
//    bread racks
//  - pharmacy and liquor shop: gondolas down the room packed with goods, wall shelving, a drinks fridge, the till by
//    the door; a dispensing counter, crates and sake bottles
//  - konbini: the drinks fridge and the chilled case of rice balls and bento, gondolas, magazines under the window,
//    the till with hot snacks and cigarettes, the ATM, a lit panel ceiling, aisle signs
//  - cycle shop: bicycles at the open front, a pegboard of helmets and bags, tyres, a repair stand, the counter
// Indoor surfaces (CL_INDOOR) take the room's lamps only — a street lamp outside does not light a shelf through the
// wall — and a warmer, dimmer share of the sky's ambient than the street. The fittings are near detail (drawn within
// ~90 m), boards and posters show within ~45 m, no fitting casts shadow.
// The building itself: its door leaves slide open on their own track as you come (taken out of the model into meshes
// of their own), and the shop collides as what it is now made of (a compound collider from its own triangles and its
// furniture's), no longer as one solid box.
// What the shop knows afterwards (building.js SHOP_SITES, used by shops.js and pedestrians.js): its floor box, the door
// (and a point just inside it), where the shopkeeper stands, where you are served, its shelves and till, its seats for
// customers, its bins.
import { THREE, scene, lampPoints, buildCompound, addCompound, addProp, colInsert, colRemove, capHooks } from './core.js';
import { packsReady, packProp, packTris, stockShelf } from './packs.js';
import { GeoBuilder, signMesh, canvasTex, materials as townMaterials, night } from './townkit.js';
import { ITEMS, MENUS } from './items.js';

export const ENTERABLE = new Set([0, 1, 3, 6, 7, 8, 11, 12, 15, 16, 'konbini']);
// the pack shop buildings, in their own units (front +z): the shop floor (x0, x1, z0, z1), the front's inner line, the
// way in (x0, x1), the door leaves that slide (x0, x1, which way); side walls with windows (no panelling over them)
export const SPECS = {
  jp_ramenshop: { room: [-2.6, 2.7, -1.75, 1.5], front: 1.62, door: [-2.3, 2.2] },
  jp_shop_building_05: { room: [-1.9, 2.9, -3.5, 2.55], front: 2.7, door: [-0.7, 1.5] },
  jp_shop_building_01: { room: [-1.8, 1.4, -3.5, 2.55], front: 2.7, door: [-0.7, 1.05] }, // (the left room: a wall stands at x 1.5)
  jp_shop_building_04: { room: [-2.0, 2.7, -3.7, 2.45], front: 2.74, door: [-0.45, 0.58], leaves: [[-0.48, 0.61, -1]], ceil: 'boards' },
  jp_shop_building_02: { room: [-2.2, 2.7, -2.8, 1.95], front: 2.25, door: [-0.37, 0.9], leaves: [[-0.39, 0.92, -1]] },
  jp_store_rowbuilding_01: { room: [-2.3, 2.3, -1.85, 2.55], front: 2.82, door: [-1.49, -0.52], leaves: [[-1.51, -0.5, 1]] },
  jp_store_rowbuilding_03: { room: [-2.4, 2.3, -1.85, 1.9], front: 2.05, door: [-1.05, 0.92], leaves: [[-1.09, -0.07, -1], [-0.07, 0.95, 1]] },
  // (the cycle shop: the deep right-hand bay is the shop, the open front the bicycles' showroom)
  jp_store_rowbuilding_02: { room: [0.1, 2.4, -2.15, 2.4], zone: [-2.25, 0.1, 0.85, 2.4], walls: { L: [-2.15, 0.75] }, face: [-1.1, 0.05, 0.97], front: 2.55, door: [-2.0, 2.0] },
  jp_convenience_store: { room: [-5.3, 5.3, -3.8, 0.15], vest: [-2.55, 2.55, 0.15, 3.75], front: 4.2, door: [-1.05, 1.05], leaves: [[-1.08, 0, -1], [0, 1.08, 1]], windows: 'LR' },
};
export const canEnter = (trade, model) => ENTERABLE.has(trade) && !!SPECS[model];

// ---------------------------------------------------------------- materials and the builder of the furnishings
let IB = null, MT = null;
const SIGNS = []; // (boards and posters: drawn only near)
const IN_AMB = { value: new THREE.Color(0.62, 0.58, 0.53) }; // (indoors: a warmer, dimmer share of the sky's light — the lamps do the rest)
// (and the light a lit room throws back off its walls, floor and goods: what reaches a ceiling and the shade under a
// shelf — stronger when the lamps are what light the room, at night)
const IN_FILL = { value: new THREE.Color(1.0, 0.93, 0.84) };
// a material of the rooms: lit by the room's own lamps only, the sky's ambient warmed and dimmed; em: its emissive is
// its vertex colour times em (panels, bulbs, paper lanterns, screens)
function indoor(m, key, em = 0) {
  m.defines = Object.assign({}, m.defines, { CL_INDOOR: '' });
  if (em) { m.emissive = new THREE.Color(1, 1, 1); m.emissiveIntensity = em; }
  m.onBeforeCompile = s => {
    s.uniforms.uInAmb = IN_AMB; s.uniforms.uInFill = IN_FILL; s.uniforms.uInNight = night;
    s.fragmentShader = s.fragmentShader.replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replace('getDirectionalLightInfo( directionalLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight ); directLight.color *= 0.5;'))
      .replace('#include <common>', '#include <common>\nuniform vec3 uInAmb, uInFill; uniform float uInNight;')
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n reflectedLight.indirectDiffuse *= uInAmb; reflectedLight.indirectSpecular *= 0.55;\n reflectedLight.indirectDiffuse += uInFill * ( 0.45 + 0.75 * uInNight ) * BRDF_Lambert( material.diffuseColor );');
    if (em) s.fragmentShader = s.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance *= diffuseColor.rgb;');
  };
  m.customProgramCacheKey = () => 'indoor:' + key;
  return m;
}
// floors, ceiling panels and wall boards drawn on canvases, one metre a repeat
function tex(draw, px = 512) { const t = canvasTex(px, px, draw); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t; }
const noise = (g, W, n, a, cols) => { for (let i = 0; i < n; i++) { g.fillStyle = cols[i % cols.length]; g.globalAlpha = a * (0.4 + (i * 7919 % 97) / 97); g.fillRect((i * 1103515245 >>> 7) % W, (i * 12345 + i * i * 31) % W, 1 + i % 3, 1 + (i >> 3) % 2); } g.globalAlpha = 1; };
const TEX = {
  woodDark: g => { const W = 512, n = 8; for (let i = 0; i < n; i++) { const L = 120 + ((i * 37) % 9) * 10; g.fillStyle = `rgb(${86 + (i * 13) % 18},${58 + (i * 7) % 12},${38 + (i * 5) % 9})`; g.fillRect(i * W / n, 0, W / n, W); for (let k = 0; k < 9; k++) { g.strokeStyle = 'rgba(30,18,10,.18)'; g.lineWidth = 1 + (k % 2); g.beginPath(); const x = i * W / n + 6 + k * 7; g.moveTo(x, 0); g.bezierCurveTo(x + 4, W * 0.3, x - 4, W * 0.6, x + 2, W); g.stroke(); } g.fillStyle = 'rgba(20,12,6,.55)'; g.fillRect(i * W / n, 0, 2, W); g.fillRect(i * W / n, (i * 211) % W, W / n, 2); } },
  woodWarm: g => { const W = 512, n = 8; for (let i = 0; i < n; i++) { g.fillStyle = `rgb(${168 + (i * 13) % 22},${122 + (i * 7) % 16},${80 + (i * 5) % 12})`; g.fillRect(i * W / n, 0, W / n, W); for (let k = 0; k < 9; k++) { g.strokeStyle = 'rgba(90,55,25,.16)'; g.lineWidth = 1 + (k % 2); g.beginPath(); const x = i * W / n + 6 + k * 7; g.moveTo(x, 0); g.bezierCurveTo(x + 5, W * 0.3, x - 5, W * 0.6, x + 2, W); g.stroke(); } g.fillStyle = 'rgba(60,35,15,.45)'; g.fillRect(i * W / n, 0, 2, W); g.fillRect(i * W / n, (i * 211) % W, W / n, 2); } },
  tileRed: g => { const W = 512, n = 4, s = W / n; g.fillStyle = '#4a2c22'; g.fillRect(0, 0, W, W); for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { g.fillStyle = `rgb(${128 + ((i * 7 + j * 13) % 5) * 6},${62 + ((i + j * 3) % 4) * 4},${44 + ((i * 3 + j) % 3) * 3})`; g.fillRect(i * s + 3, j * s + 3, s - 6, s - 6); } noise(g, W, 900, 0.25, ['#2a1610', '#a86a52']); },
  vinyl: g => { const W = 512, n = 3, s = W / n; for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { g.fillStyle = (i + j) % 2 ? '#d9dad6' : '#e8e8e4'; g.fillRect(i * s, j * s, s, s); } noise(g, W, 1600, 0.35, ['#9a9c98', '#ffffff', '#b8b4aa']); g.strokeStyle = 'rgba(80,80,80,.25)'; g.lineWidth = 2; for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, W); g.stroke(); g.beginPath(); g.moveTo(0, i * s); g.lineTo(W, i * s); g.stroke(); } },
  stone: g => { const W = 512; g.fillStyle = '#5f5b54'; g.fillRect(0, 0, W, W); const R = [[0, 0, 300, 230], [300, 0, 212, 160], [300, 160, 212, 190], [0, 230, 180, 282], [180, 230, 120, 140], [180, 370, 332, 142], [300, 350, 212, 20]]; R.forEach(([x, y, w, h], k) => { g.fillStyle = `rgb(${120 + k * 9 % 30},${114 + k * 7 % 26},${104 + k * 5 % 20})`; g.fillRect(x + 4, y + 4, w - 8, h - 8); }); noise(g, W, 1400, 0.3, ['#3a3832', '#c8c2b4']); },
  concrete: g => { const W = 512; g.fillStyle = '#8e8c87'; g.fillRect(0, 0, W, W); noise(g, W, 3000, 0.3, ['#6f6d68', '#a9a7a1', '#7d7b75']); g.strokeStyle = 'rgba(40,40,40,.35)'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, 2); g.lineTo(W, 2); g.moveTo(2, 0); g.lineTo(2, W); g.stroke(); },
  tatami: g => { const W = 512; g.fillStyle = '#b6b07a'; g.fillRect(0, 0, W, W); for (let y = 0; y < W; y += 6) { g.fillStyle = y % 12 ? 'rgba(120,112,60,.35)' : 'rgba(220,214,160,.3)'; g.fillRect(0, y, W, 3); } noise(g, W, 600, 0.2, ['#8a844e', '#d8d29a']); },
  ceilGrid: g => { const W = 512, s = W / 2; g.fillStyle = '#ecebe6'; g.fillRect(0, 0, W, W); noise(g, W, 2600, 0.25, ['#c9c7c0', '#d8d6cf']); g.fillStyle = '#c4c4c0'; for (let i = 0; i <= 2; i++) { g.fillRect(i * s - 3, 0, 6, W); g.fillRect(0, i * s - 3, W, 6); } },
  boards: g => { const W = 512, n = 6; for (let i = 0; i < n; i++) { g.fillStyle = `rgb(${150 + (i * 11) % 20},${110 + (i * 7) % 14},${72 + (i * 5) % 10})`; g.fillRect(i * W / n, 0, W / n, W); g.fillStyle = 'rgba(50,30,15,.5)'; g.fillRect(i * W / n, 0, 3, W); } noise(g, W, 800, 0.15, ['#5a3a1e']); },
  peg: g => { const W = 512; g.fillStyle = '#c9a77a'; g.fillRect(0, 0, W, W); g.fillStyle = '#5a4128'; for (let y = 16; y < W; y += 32) for (let x = 16; x < W; x += 32) { g.beginPath(); g.arc(x, y, 3.5, 0, 6.3); g.fill(); } },
  kitchen: g => { const W = 512, n = 8, s = W / n; g.fillStyle = '#c8cac6'; g.fillRect(0, 0, W, W); for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { g.fillStyle = (i * 5 + j * 3) % 7 ? '#f2f2ee' : '#e8ebe8'; g.fillRect(i * s + 2, j * s + 2, s - 4, s - 4); } },
};
function builder() {
  if (IB) return IB;
  IB = new GeoBuilder(48);
  const T = townMaterials();
  const std = (o, key, em = 0) => indoor(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0, envMapIntensity: 0.7, ...o }), key, em);
  MT = {
    matte: std({}, 'matte'), gloss: std({ roughness: 0.32 }, 'gloss'), metal: std({ roughness: 0.38, metalness: 0.45, envMapIntensity: 0.45 }, 'metal'), dark: std({ roughness: 0.85, color: 0x9a9a9a }, 'dark'),
    wood: indoor(T.wood.clone(), 'wood'),
    glass: new THREE.MeshStandardMaterial({ color: 0xcfe6ee, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.2, depthWrite: false, envMapIntensity: 1.0 }),
    lit: std({ roughness: 0.5 }, 'lit', 0.62), bulb: std({ roughness: 0.4 }, 'bulb', 0.9), paper: std({ roughness: 0.7 }, 'paper', 0.42), screen: std({ roughness: 0.2 }, 'screen', 0.7),
  };
  for (const [k, f] of Object.entries(TEX)) MT[k] = std({ map: tex(f), roughness: /wood|boards/.test(k) ? 0.62 : /vinyl|tile|kitchen/.test(k) ? 0.38 : 0.85 }, 'tex' + k);
  return IB;
}
// a floor or wall pattern of the rooms (vinyl tiles, planks …) repeated rx x ry times — for builders outside this module
export function roomTexture(kind, rx = 1, ry = 1) { const t = tex(TEX[kind]); t.repeat.set(rx, ry); return t; }
// the furnishings' meshes, once every shop is built (town.js)
export function flushInteriors() {
  if (!IB) return [];
  const none = {}; for (const k in MT) none[k] = false; // (indoors under a roof: none cast)
  const meshes = IB.flush(MT, none);
  for (const m of meshes) { m.updateMatrixWorld(); if (m.material === MT.glass) m.renderOrder = 2; }
  return meshes;
}
// boards and posters shown only within ~45 m (shops.js calls this)
export function interiorSigns(px, pz) { for (const s of SIGNS) { const dx = s.position.x - px, dz = s.position.z - pz; s.visible = dx * dx + dz * dz < 1050; } }

// ---------------------------------------------------------------- canvas pictures: menus, posters, boards, a clock
const MINCHO = '"Yu Mincho", "YuMincho", "Hiragino Mincho ProN", "MS Mincho", serif', GOTHIC = '"Yu Gothic UI", "Yu Gothic", "Meiryo", sans-serif';
function vText(g, s, x, y, size, color, font = MINCHO) { g.fillStyle = color; g.font = `bold ${size}px ${font}`; g.textAlign = 'center'; g.textBaseline = 'top'; let yy = y; for (const ch of s) { if (ch === 'ー') { g.save(); g.translate(x, yy + size / 2); g.rotate(Math.PI / 2); g.fillText(ch, 0, -size / 2); g.restore(); } else g.fillText(ch, x, yy); yy += size * 1.02; } return yy; }
// お品書き: hanging paper strips on a dark wooden board, one strip a dish (written top to bottom, the price under it)
function drawStrips(entries, accent = '#b8322a', paper = ['#f6efdc', '#efe4c8'], wood = '#3b2617') {
  return (g, W, H) => {
    g.fillStyle = wood; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 40; i++) { g.strokeStyle = `rgba(0,0,0,${0.08 + (i % 3) * 0.04})`; g.lineWidth = 1 + (i % 4); g.beginPath(); const y = (i * 37) % H; g.moveTo(0, y); g.bezierCurveTo(W * 0.3, y + 6, W * 0.6, y - 6, W, y + 3); g.stroke(); }
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, 0, W, H * 0.06); g.fillRect(0, H * 0.94, W, H * 0.06);
    const n = entries.length, sw = Math.min(W / (n + 0.6) * 0.8, H * 0.2), gap = (W - n * sw) / (n + 1);
    entries.forEach(([jp, price], i) => { const x = gap + i * (sw + gap), top = H * 0.1, bot = H * 0.9;
      g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x + 4, top + 5, sw, bot - top);
      g.fillStyle = paper[i % paper.length]; g.fillRect(x, top, sw, bot - top);
      const size = Math.min(sw * 0.62, (bot - top) * 0.62 / Math.max(3, jp.length));
      vText(g, jp, x + sw / 2, top + sw * 0.25, size, '#1d1712');
      if (price) { g.fillStyle = accent; g.font = `bold ${sw * 0.3}px ${MINCHO}`; g.textAlign = 'center'; g.textBaseline = 'bottom'; g.fillText(price + '円', x + sw / 2, bot - sw * 0.12); } });
  };
}
const menuEntries = t => MENUS[t].items.map(id => [ITEMS[id].jp, ITEMS[id].price]);
const EXTRA_STRIPS = { 3: [['冷奴', 380], ['だし巻き卵', 480], ['刺身盛り', 980], ['もつ煮', 520], ['ポテトフライ', 420], ['ハイボール', 450], ['生ビール', 550], ['日本酒', 600], ['焼きおにぎり', 350], ['お新香', 300]],
  12: [['もりそば', 650], ['かけそば', 600], ['月見そば', 750], ['天丼', 980], ['親子丼', 850]], 16: [['まぐろ', 300], ['サーモン', 250], ['いか', 200], ['えび', 250], ['玉子', 150], ['いくら', 450]], 0: [['味玉', 120], ['チャーシュー', 250], ['ライス', 150], ['替え玉', 150]] };
function drawChalk(title, items) {
  return (g, W, H) => {
    g.fillStyle = '#5a3f28'; g.fillRect(0, 0, W, H); g.fillStyle = '#23302a'; g.fillRect(W * 0.04, H * 0.05, W * 0.92, H * 0.9);
    g.fillStyle = 'rgba(255,255,255,.04)'; for (let i = 0; i < 60; i++) g.fillRect((i * 97) % W, (i * 53) % H, 40, 2);
    g.fillStyle = '#f4efe2'; g.textAlign = 'center'; g.font = `italic bold ${H * 0.12}px Georgia, serif`; g.fillText(title, W / 2, H * 0.2);
    g.font = `${H * 0.055}px ${MINCHO}`; g.fillStyle = '#e8d9a8'; g.fillText('メニュー', W / 2, H * 0.29);
    items.forEach((id, i) => { const it = ITEMS[id], y = H * 0.42 + i * H * 0.12; g.textAlign = 'left'; g.fillStyle = '#f4efe2'; g.font = `${H * 0.065}px Georgia, serif`; g.fillText(it.name, W * 0.12, y);
      g.font = `${H * 0.045}px ${MINCHO}`; g.fillStyle = '#cfe0c4'; g.fillText(it.jp, W * 0.12, y + H * 0.05); g.textAlign = 'right'; g.fillStyle = '#f2c46a'; g.font = `${H * 0.065}px Georgia, serif`; g.fillText('¥' + it.price, W * 0.88, y); });
  };
}
const drawPoster = (bg, fg, big, small, sub = '') => (g, W, H) => {
  g.fillStyle = bg; g.fillRect(0, 0, W, H); g.fillStyle = 'rgba(255,255,255,.16)'; for (let i = -H; i < W; i += 40) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 20, 0); g.lineTo(i + 20 + H, H); g.lineTo(i + H, H); g.fill(); }
  g.fillStyle = fg; g.textAlign = 'center'; g.font = `900 ${H * 0.3}px ${GOTHIC}`; g.fillText(big, W / 2, H * 0.48); g.font = `bold ${H * 0.13}px ${GOTHIC}`; g.fillText(small, W / 2, H * 0.72); if (sub) { g.font = `${H * 0.08}px ${GOTHIC}`; g.fillText(sub, W / 2, H * 0.88); }
};
// a beer poster: a frothy mug on red
const drawBeer = (g, W, H) => { g.fillStyle = '#b8201c'; g.fillRect(0, 0, W, H); g.fillStyle = '#f5b82e'; g.fillRect(W * 0.3, H * 0.3, W * 0.4, H * 0.45); g.fillStyle = '#fff8e8'; g.beginPath(); g.ellipse(W * 0.5, H * 0.3, W * 0.24, H * 0.08, 0, 0, 6.3); g.fill(); g.strokeStyle = '#f5b82e'; g.lineWidth = W * 0.05; g.beginPath(); g.arc(W * 0.72, H * 0.52, W * 0.09, -1.4, 1.4); g.stroke(); g.fillStyle = '#fff'; g.textAlign = 'center'; g.font = `900 ${H * 0.13}px ${GOTHIC}`; g.fillText('生ビール', W / 2, H * 0.9); g.font = `bold ${H * 0.07}px ${GOTHIC}`; g.fillText('冷えてます', W / 2, H * 0.17); };
// 色紙: a signed board (a guest's autograph)
const drawShikishi = k => (g, W, H) => { g.fillStyle = '#c9a24a'; g.fillRect(0, 0, W, H); g.fillStyle = '#f7f1e2'; g.fillRect(W * 0.05, H * 0.05, W * 0.9, H * 0.9); g.strokeStyle = '#1d1712'; g.lineWidth = W * 0.025; g.lineCap = 'round'; g.beginPath(); for (let i = 0; i < 5; i++) { const x = W * (0.25 + ((k * 3 + i) % 5) * 0.12), y = H * (0.25 + i * 0.1); g.moveTo(x, y); g.bezierCurveTo(x + W * 0.2, y - H * 0.05, x - W * 0.1, y + H * 0.15, x + W * 0.25, y + H * 0.12); } g.stroke(); g.fillStyle = '#b8322a'; g.fillRect(W * 0.66, H * 0.72, W * 0.1, W * 0.1); };
const drawClock = (g, W, H) => { const c = W / 2, r = W * 0.46; g.fillStyle = '#2b2420'; g.beginPath(); g.arc(c, c, r + 6, 0, Math.PI * 2); g.fill(); g.fillStyle = '#fbf8f0'; g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#2b2420'; for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; g.fillRect(c + Math.sin(a) * r * 0.82 - 3, c - Math.cos(a) * r * 0.82 - 3, 6, 6); }
  g.strokeStyle = '#2b2420'; g.lineCap = 'round'; g.lineWidth = 8; g.beginPath(); g.moveTo(c, c); g.lineTo(c + r * 0.45, c - r * 0.2); g.stroke(); g.lineWidth = 5; g.beginPath(); g.moveTo(c, c); g.lineTo(c - r * 0.1, c - r * 0.72); g.stroke(); };
const drawCalendar = (g, W, H) => { g.fillStyle = '#fbfaf6'; g.fillRect(0, 0, W, H); g.fillStyle = '#c0281e'; g.fillRect(0, 0, W, H * 0.16); g.fillStyle = '#fff'; g.font = `bold ${H * 0.1}px ${GOTHIC}`; g.textAlign = 'center'; g.fillText('10月', W / 2, H * 0.12);
  g.font = `${H * 0.05}px ${GOTHIC}`; for (let d = 1; d <= 31; d++) { const k = d + 2, x = (k % 7 + 0.5) * W / 7, y = H * 0.28 + Math.floor(k / 7) * H * 0.12; g.fillStyle = k % 7 === 0 ? '#c0281e' : k % 7 === 6 ? '#1f5fb4' : '#2b2420'; g.fillText(String(d), x, y); } };
const drawScroll = (txt) => (g, W, H) => { g.fillStyle = '#6b5b3e'; g.fillRect(0, 0, W, H); g.fillStyle = '#efe6cf'; g.fillRect(W * 0.12, H * 0.06, W * 0.76, H * 0.86); vText(g, txt, W / 2, H * 0.2, W * 0.42, '#1d1712'); g.fillStyle = '#b8322a'; g.fillRect(W * 0.58, H * 0.74, W * 0.12, W * 0.12); };
const drawLabel = (bg, fg, txt, jp) => (g, W, H) => { g.fillStyle = bg; g.fillRect(0, 0, W, H); g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `bold ${H * 0.46}px ${GOTHIC}`; g.fillText(jp, W / 2, H * 0.42); g.font = `${H * 0.2}px ${GOTHIC}`; g.fillText(txt, W / 2, H * 0.8); };
const drawPicture = k => (g, W, H) => { const P = [['#e8d8b8', '#7aa0b8', '#3a5a70'], ['#f0e0c8', '#c8784a', '#5a3a28'], ['#e0e8d8', '#6a9a5a', '#2a4a2a']][k % 3]; g.fillStyle = '#2b2018'; g.fillRect(0, 0, W, H); g.fillStyle = P[0]; g.fillRect(W * 0.07, H * 0.07, W * 0.86, H * 0.86); g.fillStyle = P[1]; g.beginPath(); g.moveTo(W * 0.07, H * 0.75); g.lineTo(W * 0.4, H * 0.4); g.lineTo(W * 0.6, H * 0.6); g.lineTo(W * 0.93, H * 0.35); g.lineTo(W * 0.93, H * 0.93); g.lineTo(W * 0.07, H * 0.93); g.fill(); g.fillStyle = P[2]; g.beginPath(); g.arc(W * 0.7, H * 0.25, W * 0.08, 0, 6.3); g.fill(); };
const drawTicketMachine = items => (g, W, H) => { g.fillStyle = '#e9ecee'; g.fillRect(0, 0, W, H); g.fillStyle = '#b8322a'; g.fillRect(0, 0, W, H * 0.1); g.fillStyle = '#fff'; g.font = `bold ${H * 0.06}px ${GOTHIC}`; g.textAlign = 'center'; g.fillText('食券', W / 2, H * 0.07);
  items.slice(0, 12).forEach(([jp, p], i) => { const x = W * 0.06 + (i % 3) * W * 0.3, y = H * 0.14 + Math.floor(i / 3) * H * 0.11; g.fillStyle = i < 3 ? '#f2c400' : '#ffffff'; g.fillRect(x, y, W * 0.27, H * 0.09); g.strokeStyle = '#555'; g.strokeRect(x, y, W * 0.27, H * 0.09); g.fillStyle = '#222'; g.font = `bold ${H * 0.028}px ${GOTHIC}`; g.fillText(jp.slice(0, 6), x + W * 0.135, y + H * 0.04); g.fillStyle = '#b8322a'; g.fillText(p + '円', x + W * 0.135, y + H * 0.075); });
  g.fillStyle = '#333'; g.fillRect(W * 0.1, H * 0.62, W * 0.35, H * 0.05); g.fillRect(W * 0.55, H * 0.62, W * 0.35, H * 0.05); g.fillStyle = '#1a1a1a'; g.fillRect(W * 0.2, H * 0.8, W * 0.6, H * 0.08); };
const drawTV = (g, W, H) => { const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#3f7fc4'); gr.addColorStop(1, '#8fd0e8'); g.fillStyle = gr; g.fillRect(0, 0, W, H); g.fillStyle = '#2e6a2a'; g.fillRect(0, H * 0.62, W, H * 0.38); g.fillStyle = '#fff'; g.fillRect(W * 0.08, H * 0.78, W * 0.84, H * 0.14); g.fillStyle = '#c0281e'; g.font = `bold ${H * 0.09}px ${GOTHIC}`; g.fillText('野球中継 3-2', W * 0.12, H * 0.88); };
const drawAisle = (jp, en, bg = '#0a8a4b') => (g, W, H) => { g.fillStyle = bg; g.fillRect(0, 0, W, H); g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `bold ${H * 0.5}px ${GOTHIC}`; g.fillText(jp, W / 2, H * 0.42); g.font = `${H * 0.2}px ${GOTHIC}`; g.fillText(en, W / 2, H * 0.82); };

// ---------------------------------------------------------------- one shop: the builder's frame, its walls
function kit(o, r, tris) {
  const c = Math.cos(r), s = Math.sin(r), B = builder(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _sc = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  const W = (x, y, z) => [o[0] + x * c + z * s, o[1] + y, o[2] - x * s + z * c];
  return {
    W, B, r, used: {},
    box: (mat, cx, y, cz, w, h, d, col, bev = 0.012, opt = {}) => { (bev > 0 ? B.bbox(mat, cx, y, cz, w, h, d, bev, { color: col, ...opt }) : B.box(mat, cx, y, cz, w, h, d, { color: col, ...opt })); },
    cyl: (mat, cx, y, cz, r0, r1, h, col, seg = 12, cap = true) => B.cyl(mat, cx, y, cz, r0, r1, h, seg, { color: col, cap }),
    quad: (mat, a, b, cc, d, col, opt = {}) => B.quad(mat, a, b, cc, d, { color: col, ...opt }),
    up: (mat, x0, z0, x1, z1, y, col = [1, 1, 1], uv = 1) => B.poly(mat, [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], [0, 1, 0], { color: col, uv }),
    down: (mat, x0, z0, x1, z1, y, col = [1, 1, 1], uv = 1) => B.poly(mat, [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], [0, -1, 0], { color: col, uv }),
    // a model of the library at (x, y, z), turned yaw, scale sc (number or [x, y, z]); collides unless told not to
    pack(id, x, y, z, yaw = 0, sc = 1, collide = true) {
      const P = packsReady(); if (!P || !P.models[id]) return null;
      const w = W(x, y, z); packProp(id, w[0], w[1], w[2], r + yaw, sc);
      _m.compose(_v.set(w[0], w[1], w[2]), _q.setFromAxisAngle(Y, r + yaw), Array.isArray(sc) ? _sc.set(sc[0], sc[1], sc[2]) : _sc.setScalar(sc));
      if (collide) packTris(id, _m, tris);
      return _m.clone();
    },
    // a board or poster (canvas) on a wall: centre (x, y, z), facing yaw (0: +z, into the room from the back wall)
    sign(w, h, draw, x, y, z, yaw = 0, glow = 0.05, px = 256, back = 'panel') {
      const m = signMesh(w, h, draw, glow, px, { back }); const p = W(x, y, z); m.position.set(p[0], p[1], p[2]); m.rotation.y = r + yaw; m.updateMatrixWorld(); m.visible = false; scene.add(m); SIGNS.push(m); return m;
    },
    // a room's own lamp (citylights.js): lights within r metres, at an indoor fitting's brightness
    lamp(x, y, z, i = 2.4, col = WARM, rr = 4.6) { lampPoints.push({ p: W(x, y, z), s: 0.1, r: rr, i, c: col, in: true }); },
  };
}
const rnd = seed => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const pick = (rng, a) => a[Math.floor(rng() * a.length)];
const hex = h => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const WHITE = [0.86, 0.86, 0.85], STEEL = [0.78, 0.8, 0.82], DARKW = [0.3, 0.2, 0.13], MIDW = [0.55, 0.4, 0.27], LIGHTW = [0.8, 0.66, 0.48], HINOKI = [0.9, 0.8, 0.62], RED = [0.72, 0.12, 0.1], BLACK = [0.08, 0.08, 0.09];
const WARM = [1.0, 0.8, 0.58], NEUTRAL = [1.0, 0.94, 0.86], COOL = [0.92, 0.96, 1.0];
const GOODS = [[0.85, 0.2, 0.18], [0.95, 0.72, 0.18], [0.24, 0.56, 0.84], [0.35, 0.7, 0.35], [0.94, 0.5, 0.69], [0.98, 0.98, 0.96], [0.96, 0.9, 0.77], [0.55, 0.35, 0.24], [1.0, 0.54, 0.16], [0.48, 0.36, 0.78], [0.18, 0.7, 0.66]];

// the walls as they really stand (measured on the model: the inner faces of the side and back walls, the ceiling)
function measure(id, spec, s) {
  const P = packsReady(), m = P.models[id], [x0, x1, z0, z1] = spec.room;
  let L = -1e9, Rr = 1e9, Bk = -1e9, C = 1e9;
  const v = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const q of m.parts) {
    const g = q.geometry, pos = g.attributes.position, idx = g.index, n = idx ? idx.count : pos.count;
    for (let t = 0; t < n; t += 3) {
      for (let k = 0; k < 3; k++) { const i = idx ? idx.getX(t + k) : t + k; v[k][0] = pos.getX(i); v[k][1] = pos.getY(i); v[k][2] = pos.getZ(i); }
      const ux = v[1][0] - v[0][0], uy = v[1][1] - v[0][1], uz = v[1][2] - v[0][2], wx = v[2][0] - v[0][0], wy = v[2][1] - v[0][1], wz = v[2][2] - v[0][2];
      let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx; const nl = Math.hypot(nx, ny, nz); if (nl < 1e-9) continue; nx /= nl; ny /= nl; nz /= nl;
      const cx = (v[0][0] + v[1][0] + v[2][0]) / 3, cy = (v[0][1] + v[1][1] + v[2][1]) / 3, cz = (v[0][2] + v[1][2] + v[2][2]) / 3;
      const inX = cx > x0 + 0.2 && cx < x1 - 0.2, inZ = cz > z0 + 0.2 && cz < z1 - 0.2;
      if (Math.abs(ny) < 0.3 && cy > 0.7 && cy < 2.1) {
        if (Math.abs(nx) > 0.8 && inZ && cx < x0 + 0.35 && cx > x0 - 0.7) L = Math.max(L, cx);
        if (Math.abs(nx) > 0.8 && inZ && cx > x1 - 0.35 && cx < x1 + 0.7) Rr = Math.min(Rr, cx);
        if (Math.abs(nz) > 0.8 && inX && cz < z0 + 0.35 && cz > z0 - 0.7) Bk = Math.max(Bk, cz);
      }
      if (Math.abs(ny) > 0.8 && inX && inZ && cy > 1.9 && cy < 4.5) C = Math.min(C, cy);
    }
  }
  return { L: (L > -1e8 ? L : x0 - 0.05) * s[0], R: (Rr < 1e8 ? Rr : x1 + 0.05) * s[0], B: (Bk > -1e8 ? Bk : z0 - 0.05) * s[2], C: (C < 1e8 ? C : 2.35) * s[1] };
}
// a wall of the room: side 'L' | 'R' | 'B'; at(u, y, off): a point on it (u along it, off out from it into the room);
// yaw: what faces into the room; [u0, u1]: its length
function wallOf(R, side) {
  const lim = R.walls && R.walls[side]; // (a wall that stops short: open beyond)
  if (side === 'L') return { side, at: (u, y, off = 0) => [R.wl + off, y, u], yaw: Math.PI / 2, u0: lim ? lim[0] : R.wb, u1: lim ? lim[1] : R.wf, n: [1, 0] };
  if (side === 'R') return { side, at: (u, y, off = 0) => [R.wr - off, y, u], yaw: -Math.PI / 2, u0: lim ? lim[0] : R.wb, u1: lim ? lim[1] : R.wf, n: [-1, 0] };
  return { side, at: (u, y, off = 0) => [u, y, R.wb + off], yaw: 0, u0: R.wl, u1: R.wr, n: [0, 1] };
}
// a box laid against a wall: centre along it u, height y0..y0+h, depth d out from it, length len
function wallBox(K, w, mat, u, y0, len, h, d, col, off = 0, bev = 0) { const p = w.at(u, y0, off + d / 2), along = w.n[0] === 0; K.box(mat, p[0], y0, p[2], along ? len : d, h, along ? d : len, col, bev); }

// ---------------------------------------------------------------- the room: floor, panelling, ceiling, lamps
// TH: { floor, wain: [mat, colour, height], rail, base, band, ceil: 'grid' | null, light: colour, lux, lamps }
const THEMES = {
  0: { floor: 'tileRed', wain: ['wood', [0.36, 0.24, 0.15], 1.0], rail: [0.22, 0.14, 0.08], base: [0.18, 0.11, 0.06], light: WARM, lux: 9 },
  3: { floor: 'woodDark', wain: ['wood', [0.3, 0.19, 0.11], 1.05], rail: [0.18, 0.11, 0.06], base: [0.14, 0.08, 0.05], light: [1.0, 0.72, 0.48], lux: 7.5 },
  12: { floor: 'stone', wain: ['wood', [0.5, 0.36, 0.22], 0.95], rail: [0.3, 0.2, 0.12], base: [0.22, 0.15, 0.09], light: WARM, lux: 9 },
  16: { floor: 'stone', wain: ['boards', [1, 0.96, 0.9], 1.0], rail: [0.62, 0.5, 0.34], base: [0.4, 0.3, 0.2], light: NEUTRAL, lux: 10 },
  7: { floor: 'woodWarm', wain: ['matte', [0.2, 0.32, 0.27], 1.0], rail: [0.32, 0.22, 0.14], base: [0.16, 0.12, 0.09], light: WARM, lux: 8 },
  6: { floor: 'stone', wain: ['wood', [0.42, 0.29, 0.18], 0.9], rail: [0.26, 0.17, 0.1], base: [0.18, 0.12, 0.07], light: WARM, lux: 9 },
  11: { floor: 'woodWarm', wain: ['matte', [0.86, 0.78, 0.62], 1.0], rail: [0.55, 0.4, 0.25], base: [0.35, 0.25, 0.16], light: WARM, lux: 8.5 },
  1: { floor: 'vinyl', wain: ['matte', [0.9, 0.92, 0.93], 0.0], band: [0.16, 0.44, 0.71], base: [0.5, 0.52, 0.55], ceil: 'grid', light: COOL, lux: 8 },
  8: { floor: 'concrete', wain: ['wood', [0.4, 0.28, 0.18], 1.1], rail: [0.22, 0.15, 0.09], base: [0.2, 0.14, 0.09], ceil: 'grid', light: NEUTRAL, lux: 8 },
  konbini: { floor: 'vinyl', wain: ['matte', [0.88, 0.9, 0.9], 0.0], band: [0.04, 0.54, 0.29], band2: [0.1, 0.37, 0.71], base: [0.45, 0.47, 0.5], ceil: 'grid', light: COOL, lux: 9 },
  15: { floor: 'concrete', wain: ['matte', [0.24, 0.3, 0.26], 1.0], rail: [0.12, 0.14, 0.12], base: [0.1, 0.1, 0.1], ceil: 'grid', light: NEUTRAL, lux: 8 },
};
function shell(K, R, TH, spec) {
  const y = R.y;
  // the floor over the model's own, wall to wall (and the vestibule, the showroom)
  K.up(TH.floor, R.wl, R.wb, R.wr, R.wf + 0.1, y + 0.006);
  if (R.vx0 !== undefined) K.up(TH.floor, R.vx0, R.vz0 - 0.05, R.vx1, R.vz1, y + 0.006);
  if (R.zone) K.up(TH.floor, R.zone[0], R.zone[2], R.zone[1], R.zone[3], y + 0.006);
  // skirting, panelling with its rail, a colour band at the top — on the solid walls
  const sides = spec.windows === 'LR' ? ['B'] : ['L', 'R', 'B'];
  for (const sd of ['L', 'R', 'B']) {
    const w = wallOf(R, sd), len = w.u1 - w.u0, mid = (w.u0 + w.u1) / 2;
    wallBox(K, w, 'matte', mid, y, len, 0.09, 0.03, TH.base, 0.004);
    if (!sides.includes(sd)) continue;
    const [wm, wc, wh] = TH.wain;
    if (wh > 0) { wallBox(K, w, wm, mid, y + 0.09, len, wh - 0.09, 0.02, wc, 0.004, 0); wallBox(K, w, 'matte', mid, y + wh, len, 0.045, 0.035, TH.rail || TH.base, 0.004);
      if (wm === 'matte') for (let u = w.u0 + 0.45; u < w.u1 - 0.2; u += 0.9) wallBox(K, w, 'matte', u, y + 0.12, 0.035, wh - 0.15, 0.03, TH.rail || TH.base, 0.004); } // (raised mouldings)
    if (TH.band) { wallBox(K, w, 'matte', mid, y + R.ch - 0.42, len, 0.16, 0.012, TH.band, 0.004); if (TH.band2) wallBox(K, w, 'matte', mid, y + R.ch - 0.25, len, 0.06, 0.012, TH.band2, 0.004); }
  }
  // the ceiling where the model's is bare: white panels in a T-bar grid
  if (spec.ceil === 'boards' && TH.ceil !== 'grid') K.down('boards', R.wl, R.wb, R.wr, R.wf + 0.1, y + R.ch, [0.85, 0.8, 0.74], 1.4);
  if (TH.ceil === 'grid') { K.down('ceilGrid', R.wl, R.wb, R.wr, R.wf + 0.1, y + R.ch, [1, 1, 1], 1.2); if (R.vx0 !== undefined) K.down('ceilGrid', R.vx0, R.vz0 - 0.05, R.vx1, R.vz1, y + R.ch, [1, 1, 1], 1.2); if (R.zone) K.down('ceilGrid', R.zone[0], R.zone[2], R.zone[1], R.zone[3], y + R.ch, [1, 1, 1], 1.2); }
  // the room's lamps: one every ~3.2 m (lighting this room only), and its fittings drawn by the trade
  const nx = Math.max(1, Math.round((R.wr - R.wl) / 4.6)), nz = Math.max(1, Math.round((R.wf - R.wb) / 4.6));
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) K.lamp(R.wl + (i + 0.5) * (R.wr - R.wl) / nx, y + R.ch - 0.35, R.wb + (j + 0.5) * (R.wf - R.wb) / nz, TH.lux * 1.25, TH.light, Math.max(4.2, Math.hypot((R.wr - R.wl) / nx, (R.wf - R.wb) / nz) * 0.75 + 1.4));
  if (R.vx0 !== undefined) K.lamp((R.vx0 + R.vx1) / 2, y + R.ch - 0.35, (R.vz0 + R.vz1) / 2, TH.lux * 0.8, TH.light, 3.4);
  if (R.zone) K.lamp((R.zone[0] + R.zone[1]) / 2, y + R.ch - 0.35, (R.zone[2] + R.zone[3]) / 2, TH.lux * 0.8, TH.light, 3.6);
}

// ---------------------------------------------------------------- pieces of furniture (room frame, metres, front +z)
function stool(K, x, z, y, seat = RED, h = 0.68) { K.cyl('gloss', x, y, z, 0.2, 0.16, 0.03, [0.42, 0.43, 0.45], 12); K.cyl('gloss', x, y, z, 0.025, 0.025, h - 0.06, [0.6, 0.61, 0.63], 6, false); K.cyl('gloss', x, y + h - 0.08, z, 0.18, 0.18, 0.08, seat, 14); K.cyl('gloss', x, y + 0.3, z, 0.15, 0.15, 0.015, [0.55, 0.56, 0.58], 10, false); }
function chair(K, x, z, y, yaw, col = MIDW, seatCol = null) { // seat at 0.45, back behind the sitter (yaw: the way the sitter faces)
  const fx = Math.sin(yaw), fz = Math.cos(yaw), bx = x - fx * 0.2, bz = z - fz * 0.2, along = Math.abs(fz) > 0.5;
  for (const [a, b] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) K.box('wood', x + a, y, z + b, 0.035, 0.44, 0.035, col, 0);
  K.box('wood', x, y + 0.42, z, 0.42, 0.04, 0.42, seatCol || col, 0.008);
  K.box('wood', bx, y + 0.46, bz, along ? 0.42 : 0.035, 0.08, along ? 0.035 : 0.42, col, 0); K.box('wood', bx, y + 0.72, bz, along ? 0.42 : 0.035, 0.1, along ? 0.035 : 0.42, col, 0);
  for (const e of [-0.18, 0.18]) K.box('wood', bx + (along ? e : 0), y + 0.44, bz + (along ? 0 : e), 0.035, 0.42, 0.035, col, 0);
}
function table(K, x, z, y, w, d, col = MIDW, top = null, h = 0.72) { K.box('wood', x, y + h - 0.04, z, w, 0.04, d, top || col, 0.01); for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) K.box('wood', x + a * (w / 2 - 0.06), y, z + b * (d / 2 - 0.06), 0.05, h - 0.04, 0.05, col, 0); }
function condiments(K, x, z, y, rng, kind) { K.B.detail(3, () => condiments0(K, x, z, y, rng, kind)); }
function condiments0(K, x, z, y, rng, kind) {
  K.box('wood', x - 0.12, y, z, 0.16, 0.12, 0.08, LIGHTW, 0.006);
  for (let i = 0; i < 5; i++) K.box('wood', x - 0.17 + i * 0.025, y + 0.12, z, 0.012, 0.06, 0.012, [0.86, 0.78, 0.6], 0);
  K.cyl('gloss', x + 0.04, y, z, 0.025, 0.02, 0.11, [0.15, 0.08, 0.06], 8); K.cyl('gloss', x + 0.04, y + 0.11, z, 0.012, 0.012, 0.025, RED, 6);
  if (kind === 'ramen') { K.cyl('gloss', x + 0.1, y, z, 0.02, 0.02, 0.09, [0.9, 0.9, 0.88], 8); K.cyl('gloss', x + 0.15, y, z, 0.022, 0.022, 0.08, [0.75, 0.2, 0.08], 8); }
  K.box('matte', x + 0.22, y, z, 0.1, 0.07, 0.07, WHITE, 0.005);
}
function bowl(K, x, z, y, col = BLACK, s = 1) { K.B.detail(3, () => bowl0(K, x, z, y, col, s)); }
function bowl0(K, x, z, y, col = BLACK, s = 1) { K.cyl('gloss', x, y, z, 0.05 * s, 0.085 * s, 0.07 * s, col, 12); K.cyl('gloss', x, y + 0.068 * s, z, 0.08 * s, 0.08 * s, 0.004, [0.85, 0.55, 0.3], 12); }
function bottle(K, x, z, y, c, h = 0.3, r = 0.035) { K.B.detail(3, () => { K.cyl('gloss', x, y, z, r, r * 0.9, h * 0.7, c, 6, false); K.box('gloss', x, y + h * 0.7, z, r * 0.8, h * 0.3, r * 0.8, h > 0.3 ? c : [0.15, 0.15, 0.15], 0); }); }
// a pendant lamp: shade, bulb (lit) and cord
function pendant(K, x, y, z, ceil, shade = BLACK, big = 1) { K.box('dark', x, y + 0.2, z, 0.008, Math.max(0.05, ceil - y - 0.2), 0.008, BLACK, 0); K.cyl('gloss', x, y, z, 0.2 * big, 0.06, 0.2 * big, shade, 14, false); K.cyl('bulb', x, y + 0.02, z, 0.07, 0.07, 0.06, [1, 0.86, 0.62], 8); }
// a paper lantern (chōchin): body of the paper material (a soft glow), dark caps
function lantern(K, x, y, z, col = [1, 0.32, 0.22], s = 1) {
  K.cyl('dark', x, y + 0.5 * s, z, 0.1 * s, 0.1 * s, 0.05 * s, BLACK, 8); K.cyl('paper', x, y + 0.36 * s, z, 0.19 * s, 0.11 * s, 0.14 * s, col, 12); K.cyl('paper', x, y + 0.12 * s, z, 0.19 * s, 0.19 * s, 0.24 * s, col, 12); K.cyl('paper', x, y, z, 0.11 * s, 0.19 * s, 0.12 * s, col, 12); K.cyl('dark', x, y - 0.04 * s, z, 0.1 * s, 0.1 * s, 0.05 * s, BLACK, 8);
}
// a fluorescent ceiling panel (lit)
function panel(K, x, y, z, w, d) { K.box('lit', x, y - 0.03, z, w, 0.025, d, [0.96, 0.95, 0.9], 0); K.box('matte', x, y - 0.012, z, w + 0.06, 0.012, d + 0.06, WHITE, 0); }
// packets on a shelf: a run of small boxes from u0 to u1 (along x at z), shelf top y, depth d — one merged run
function packets(K, x0, x1, z, y, rng, h = [0.1, 0.22], d = 0.22, pal = GOODS) { K.B.detail(3, () => packets0(K, x0, x1, z, y, rng, h, d, pal)); }
function packets0(K, x0, x1, z, y, rng, h = [0.1, 0.22], d = 0.22, pal = GOODS) { for (let u = x0; u < x1 - 0.05;) { const bw = 0.07 + rng() * 0.16, bh = h[0] + rng() * (h[1] - h[0]); K.box('gloss', u + bw / 2, y, z, bw * 0.92, bh, d, pick(rng, pal), 0); u += bw; } }
function packetsZ(K, x, z0, z1, y, rng, h = [0.1, 0.22], d = 0.22, pal = GOODS) { K.B.detail(3, () => packetsZ0(K, x, z0, z1, y, rng, h, d, pal)); }
function packetsZ0(K, x, z0, z1, y, rng, h = [0.1, 0.22], d = 0.22, pal = GOODS) { for (let u = z0; u < z1 - 0.05;) { const bw = 0.07 + rng() * 0.16, bh = h[0] + rng() * (h[1] - h[0]); K.box('gloss', x, y, u + bw / 2, d, bh, bw * 0.92, pick(rng, pal), 0); u += bw; } }
// a gondola of our own: two-sided shelving along x (length L) centred at (x, z), 4 shelves each side, goods packed on
// them, price rails, an end cap facing the front — pal: the goods, frame: its colour
function gondola(K, x, z, y, L, rng, { pal = GOODS, frame = [0.93, 0.93, 0.92], H = 1.5, bottles: bt = false, tall = false, D = 0.9 } = {}) { K.box('matte', x, y, z, L, 0.12, D, [0.3, 0.3, 0.32], 0); K.box('matte', x, y + 0.12, z, L, H - 0.12, 0.06, frame, 0);
  for (const e of [-1, 1]) K.box('matte', x + e * (L / 2 - 0.02), y + 0.12, z, 0.04, H - 0.1, D, frame, 0);
  const levels = tall ? [0.15, 0.48, 0.81, 1.14, 1.47] : [0.15, 0.5, 0.85, 1.2];
  for (const side of [-1, 1]) for (const ly of levels) {
    if (ly > H - 0.15) continue;
    const sz = z + side * (D / 4 + 0.03);
    K.box('matte', x, y + ly - 0.02, sz, L - 0.06, 0.02, D / 2 - 0.08, frame, 0);
    K.box('gloss', x, y + ly - 0.05, z + side * (D / 2 - 0.02), L - 0.06, 0.05, 0.012, [0.98, 0.84, 0.16], 0); // (price rail)
    if (bt) for (let u = x - L / 2 + 0.08; u < x + L / 2 - 0.06; u += 0.09) { const c = pick(rng, pal); bottle(K, u, sz + side * 0.05, y + ly, c, ly < 0.3 ? 0.36 : 0.26, 0.032); }
    else packets(K, x - L / 2 + 0.05, x + L / 2 - 0.05, sz + side * 0.04, y + ly, rng, [0.08, ly > 1 ? 0.18 : 0.24], 0.2, pal);
  }
}
// wall shelving: shelves along a wall (len, levels from y0 every dy), goods packed on each (or bottles)
function wallShelves(K, w, u, len, y0, n, dy, rng, { pal = GOODS, d = 0.36, frame = [0.93, 0.93, 0.92], bottles: bt = false, mat = 'matte' } = {}) {
  used(K, w, u - len / 2, u + len / 2);
  wallBox(K, w, mat, u, y0 - 0.05, len, n * dy + 0.05, 0.02, frame, 0.005);
  for (let i = 0; i < n; i++) { const yy = y0 + i * dy; wallBox(K, w, mat, u, yy - 0.025, len, 0.025, d, frame, 0.02);
    const run = len - 0.08, start = u - run / 2;
    if (bt) for (let k = 0; k < run / 0.1; k++) { const p = w.at(start + k * 0.1 + 0.05, yy, d * 0.5); bottle(K, p[0], p[2], yy, pick(rng, pal), dy > 0.45 ? 0.36 : 0.26, 0.034); }
    else K.B.detail(3, () => { for (let s = start; s < start + run - 0.06;) { const bw = 0.07 + rng() * 0.15, bh = 0.08 + rng() * Math.min(0.24, dy - 0.1), p = w.at(s + bw / 2, yy, d * 0.5), along = w.n[0] === 0; K.box('gloss', p[0], yy, p[2], along ? bw * 0.9 : d * 0.75, bh, along ? d * 0.75 : bw * 0.9, pick(rng, pal), 0); s += bw; } });
  }
}
// what stands against a wall from u0 to u1 (its upper part then not dressed)
function used(K, w, u0, u1) { (K.used[w.side] ||= []).push([u0, u1]); }
// the walls' free stretches above the furniture (1.35 – 2.3 m): pictures, posters, a shelf of goods — as the trade has them
function dressWalls(K, R, kind, rng, sides = ['L', 'R']) {
  for (const sd of sides) {
    const w = wallOf(R, sd), U = (K.used[sd] || []).slice().sort((a, b) => a[0] - b[0]), free = []; let u = w.u0 + 0.35;
    for (const [a, b] of U) { if (a - u > 0.7) free.push([u, a - 0.1]); u = Math.max(u, b + 0.1); } if (w.u1 - 0.35 - u > 0.7) free.push([u, w.u1 - 0.35]);
    for (const [a, b] of free) {
      const len = b - a, n = Math.max(1, Math.floor(len / 1.6));
      for (let i = 0; i < n; i++) { const c = a + (i + 0.5) * len / n, p = w.at(c, R.y + 1.75, 0.015), k = (i + (sd === 'L' ? 0 : 1)) % 3;
        if (kind === 'cafe') { if (k === 2) wallShelves(K, w, c, 0.9, R.y + 1.55, 1, 0.3, rng, { pal: [[0.2, 0.4, 0.22], [0.75, 0.6, 0.35], [0.5, 0.32, 0.2]], d: 0.22, frame: DARKW, mat: 'wood' }); else K.sign(0.5, 0.38, drawPicture(i + k), p[0], p[1], p[2], w.yaw, 0.03, 192, 'flat'); }
        else if (kind === 'sweets') { if (k === 1) K.sign(0.36, 0.95, drawScroll(['春', '茶', '菓'][i % 3]), p[0], p[1], p[2], w.yaw, 0.03, 256, 'flat'); else wallShelves(K, w, c, 0.9, R.y + 1.4, 2, 0.34, rng, { pal: [[0.75, 0.15, 0.15], [0.95, 0.92, 0.85], [0.2, 0.3, 0.45], [0.55, 0.7, 0.4], [0.8, 0.6, 0.3]], d: 0.26, frame: DARKW, mat: 'wood' }); }
        else if (kind === 'eatery') { if (k === 0) K.sign(0.5, 0.7, drawBeer, p[0], p[1], p[2], w.yaw, 0.03, 192, 'flat'); else if (k === 1) K.sign(0.27, 0.3, drawShikishi(i), p[0], p[1] - 0.1, p[2], w.yaw, 0.03, 128, 'flat'); else K.sign(0.6, 0.42, drawPoster('#f4ecdc', '#1b1b1b', '本日', 'おすすめ', 'TODAY'), p[0], p[1], p[2], w.yaw, 0.03, 192, 'flat'); }
        else if (kind === 'shop') { if (k === 1) K.sign(0.55, 0.75, drawPoster(pick(rng, ['#1f6fb5', '#0a8a4b', '#c0281e']), '#ffffff', pick(rng, ['特売', '新商品', 'SALE']), pick(rng, ['お買い得', '今月のおすすめ', '期間限定']), 'SPECIAL'), p[0], p[1], p[2], w.yaw, 0.04, 192, 'flat'); else wallShelves(K, w, c, 1.0, R.y + 1.45, 2, 0.34, rng, { pal: GOODS, d: 0.26 }); }
      }
    }
  }
}
// a glass-fronted fridge along the back wall (front +z at z): doors, lit shelves of bottles, a lit header
function fridgeWall(K, x0, x1, z, y, rng, H = 1.95, dep = 0.6) {
  const L = x1 - x0, n = Math.max(2, Math.round(L / 0.75)), dw = L / n, cx = (x0 + x1) / 2;
  K.box('matte', cx, y, z - dep / 2 + 0.02, L, H + 0.25, dep, WHITE, 0.01);
  K.box('lit', cx, y + H + 0.02, z + 0.03, L - 0.04, 0.2, 0.02, [0.92, 0.95, 1.0], 0);
  const PAL = [[0.85, 0.15, 0.15], [0.2, 0.55, 0.25], [0.95, 0.75, 0.2], [0.2, 0.4, 0.8], [0.95, 0.95, 0.95], [0.55, 0.32, 0.18], [0.9, 0.5, 0.15], [0.6, 0.85, 0.95]];
  for (let k = 0; k < n; k++) {
    const u0 = x0 + k * dw;
    for (let sy = 0; sy < 5; sy++) { const yy = y + 0.15 + sy * 0.38; K.box('matte', u0 + dw / 2, yy - 0.02, z - 0.25, dw - 0.06, 0.015, 0.42, [0.82, 0.86, 0.9], 0);
      const kind = pick(rng, PAL), tall = rng() < 0.6;
      K.B.detail(3, () => { for (let u = u0 + 0.09; u < u0 + dw - 0.06; u += 0.085) { const c = rng() < 0.75 ? kind : pick(rng, PAL); K.cyl('gloss', u, yy, z - 0.12, 0.033, 0.033, tall ? 0.22 : 0.12, c, 6, false); K.box('gloss', u, yy + (tall ? 0.22 : 0.12), z - 0.12, 0.026, 0.03, 0.026, tall ? WHITE : [0.7, 0.7, 0.72], 0); } }); }
    K.box('lit', u0 + dw / 2, y + H - 0.12, z - 0.05, dw - 0.1, 0.03, 0.03, [0.85, 0.9, 1], 0); // (the light inside each door)
    K.box('metal', u0 + 0.015, y + 0.05, z + 0.02, 0.03, H - 0.05, 0.04, STEEL, 0); K.box('metal', u0 + dw / 2, y + 0.05, z + 0.02, dw, 0.04, 0.04, STEEL, 0); K.box('metal', u0 + dw / 2, y + H - 0.04, z + 0.02, dw, 0.04, 0.04, STEEL, 0);
    K.box('metal', u0 + dw - 0.06, y + 0.8, z + 0.05, 0.02, 0.5, 0.03, STEEL, 0);
    K.box('glass', u0 + dw / 2, y + 0.07, z + 0.03, dw - 0.04, H - 0.11, 0.01, [1, 1, 1], 0);
  }
  K.box('matte', cx, y, z, L, 0.05, 0.05, [0.3, 0.3, 0.32], 0);
}
// open shelves of goods (the library's store rack, stocked shelf by shelf), at true size; yaw: its front
function rack(K, x, z, y, yaw, seed) { const M = K.pack('jp_shelves_store', x, y, z, yaw, 0.68); if (M) stockShelf(M, seed); return M; }
// a register on a counter top at height yt (screen toward the customer, +z)
function register(K, x, yt, z) { K.box('gloss', x, yt, z, 0.34, 0.12, 0.3, [0.15, 0.15, 0.17], 0.01); K.box('gloss', x, yt + 0.12, z - 0.05, 0.3, 0.2, 0.04, [0.12, 0.12, 0.14], 0.005); K.box('screen', x, yt + 0.15, z - 0.025, 0.24, 0.13, 0.01, [0.55, 0.8, 0.92], 0); K.box('gloss', x + 0.3, yt, z + 0.05, 0.08, 0.03, 0.14, [0.2, 0.2, 0.22], 0); }
// a counter (w along x, d deep): a front panel with a kick plate and a top; the customer at +z
function counter(K, x, z, y, w, d, body, top, h = 0.92, trim = null) {
  K.box('matte', x, y, z, w, 0.08, d - 0.06, [0.12, 0.12, 0.12], 0); K.box('matte', x, y + 0.08, z, w, h - 0.08, d, body, 0.012);
  K.box('gloss', x, y + h, z + 0.02, w + 0.04, 0.04, d + 0.06, top, 0.008);
  if (trim) K.box('matte', x, y + h - 0.12, z + d / 2 + 0.004, w, 0.05, 0.01, trim, 0);
}
// a TV on a bracket in a corner, the clock, a calendar
function tvBracket(K, x, y, z, yaw) { K.box('dark', x, y + 0.42, z, 0.06, 0.25, 0.06, BLACK, 0); K.box('gloss', x, y, z, yaw ? 0.06 : 0.72, 0.44, yaw ? 0.72 : 0.06, BLACK, 0.01); K.sign(0.66, 0.38, drawTV, x + Math.sin(yaw) * 0.032, y + 0.22, z + Math.cos(yaw) * 0.032, yaw, 0.6, 128, 'flat'); }
// a maneki-neko (beckoning cat) on a shelf
function maneki(K, x, y, z) { K.B.detail(3, () => maneki0(K, x, y, z)); }
function maneki0(K, x, y, z) { K.cyl('gloss', x, y, z, 0.07, 0.06, 0.1, WHITE, 10); K.cyl('gloss', x, y + 0.1, z, 0.055, 0.055, 0.08, WHITE, 10); K.box('gloss', x + 0.05, y + 0.12, z, 0.03, 0.08, 0.03, WHITE, 0); K.box('gloss', x, y + 0.05, z + 0.06, 0.05, 0.04, 0.02, [0.9, 0.7, 0.2], 0); K.box('gloss', x, y + 0.085, z + 0.055, 0.06, 0.01, 0.01, RED, 0); }
function plant(K, x, z, y, big = 1) { K.B.detail(3, () => plant0(K, x, z, y, big)); }
function plant0(K, x, z, y, big = 1) { K.cyl('matte', x, y, z, 0.16 * big, 0.12 * big, 0.3 * big, [0.62, 0.36, 0.22], 10); for (let i = 0; i < 7; i++) { const a = i * 0.9, h = (0.45 + (i % 3) * 0.15) * big; K.box('matte', x + Math.cos(a) * 0.08 * big, y + 0.3 * big, z + Math.sin(a) * 0.08 * big, 0.05, h, 0.05, [0.22, 0.45 + (i % 3) * 0.06, 0.2], 0); K.box('matte', x + Math.cos(a) * 0.16 * big, y + 0.3 * big + h, z + Math.sin(a) * 0.16 * big, 0.2 * big, 0.04, 0.12 * big, [0.25, 0.52, 0.24], 0); } }

// ---------------------------------------------------------------- the trades' rooms
// R: the room in metres { x0, x1, z0, z1 (the free floor), wl, wr, wb, wf (the walls), y (floor), ch (ceiling height),
// cx, cz, W, D, door: [x0, x1], front }
function freeCells(R, z0, z1, w, d, margin = 0.35, x0 = R.x0, x1 = R.x1) {
  // (clear: a path 1.1 m wide from the door's middle straight in, the whole doorway's width near the door)
  const out = [], dc = (R.door[0] + R.door[1]) / 2, dh = Math.min((R.door[1] - R.door[0]) / 2, 1.0);
  const nx = Math.floor((x1 - x0 - 2 * margin) / w), nz = Math.floor((z1 - z0) / d);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const x = x0 + margin + (i + 0.5) * (x1 - x0 - 2 * margin) / nx, z = z0 + (j + 0.5) * (z1 - z0) / nz;
    if (Math.abs(x - dc) < 0.55 + w / 2 - 0.15) continue; if (z + d / 2 > R.z1 - 1.4 && Math.abs(x - dc) < dh + w / 2) continue; out.push([x, z]); }
  return out;
}
// the kitchen along the back wall, the counter, stools: ramen, soba, sushi, izakaya
function eatery(K, R, trade, rng, out) {
  const izk = trade === 3, sushi = trade === 16, ramen = trade === 0, soba = trade === 12, y = R.y;
  const kd = Math.min(1.45, R.D * 0.3), zb = R.z0, zc = zb + kd + 0.3, wall = wallOf(R, 'B');
  const top = izk ? [0.42, 0.28, 0.17] : sushi ? HINOKI : soba ? [0.62, 0.46, 0.3] : [0.62, 0.45, 0.3], body = izk ? [0.26, 0.17, 0.1] : sushi ? [0.78, 0.68, 0.5] : [0.85, 0.82, 0.75];
  // a tatami room along one side where the room is deep enough (izakaya, soba, sushi): the counter then shorter
  const tatami = !ramen && R.z1 - (zc + 1.2) > 2.4 && R.W > 5.2, tside = R.door[0] - R.x0 > R.x1 - R.door[1] ? -1 : 1, tw = 1.9;
  const len = Math.min(R.W - 1.5, 6.2), cx0 = R.x0 + 0.35, cx1 = cx0 + len;
  // the kitchen: tiled back wall, worktop, stoves and pots, the noodle boiler or the grill, sink, hood, shelves
  K.quad('kitchen', [R.wl, y + 0.9, R.wb + 0.012], [R.wr, y + 0.9, R.wb + 0.012], [R.wr, y + 1.75, R.wb + 0.012], [R.wl, y + 1.75, R.wb + 0.012], [1, 1, 1], { uv: 1 });
  K.box('metal', R.cx, y, zb + 0.32, R.W - 0.25, 0.88, 0.6, STEEL, 0.01);
  K.box('dark', R.cx, y + 0.02, zb + 0.62, R.W - 0.3, 0.1, 0.02, BLACK, 0);
  const sx = R.x0 + 0.9; K.box('dark', sx, y + 0.88, zb + 0.32, 0.9, 0.04, 0.5, [0.15, 0.15, 0.16], 0);
  for (const a of [-0.22, 0.22]) { K.cyl('dark', sx + a, y + 0.92, zb + 0.32, 0.12, 0.12, 0.01, [0.25, 0.25, 0.26], 12); K.cyl('metal', sx + a, y + 0.93, zb + 0.32, 0.15, 0.14, ramen || soba ? 0.26 : 0.16, STEEL, 14); }
  if (ramen || soba) { const bx = sx + 1.0; K.box('metal', bx, y + 0.88, zb + 0.32, 0.7, 0.18, 0.5, STEEL, 0.01); for (let i = 0; i < 4; i++) K.cyl('metal', bx - 0.24 + i * 0.16, y + 1.06, zb + 0.32, 0.06, 0.06, 0.05, [0.6, 0.6, 0.62], 8); K.cyl('dark', bx + 0.2, y + 1.06, zb + 0.18, 0.012, 0.012, 0.4, MIDW, 6); }
  if (izk) { const gx = sx + 1.1; K.box('dark', gx, y + 0.88, zb + 0.32, 1.0, 0.14, 0.32, [0.12, 0.12, 0.12], 0.01); K.box('paper', gx, y + 1.0, zb + 0.32, 0.9, 0.02, 0.22, [1.0, 0.35, 0.1], 0); for (let i = 0; i < 6; i++) K.box('wood', gx - 0.4 + i * 0.16, y + 1.03, zb + 0.32, 0.01, 0.01, 0.3, [0.5, 0.3, 0.15], 0); }
  const sinkX = R.x1 - 0.8; K.box('metal', sinkX, y + 0.8, zb + 0.32, 0.6, 0.09, 0.42, [0.6, 0.62, 0.64], 0); K.cyl('metal', sinkX, y + 0.88, zb + 0.13, 0.015, 0.015, 0.3, STEEL, 6);
  K.box('metal', sx + 0.4, y + 1.95, zb + 0.35, 1.8, 0.45, 0.7, STEEL, 0.01);
  K.box('wood', R.cx + 0.6, y + 1.5, zb + 0.14, R.W * 0.45, 0.03, 0.26, DARKW, 0);
  for (let x = R.cx + 0.6 - R.W * 0.2; x < R.cx + 0.6 + R.W * 0.2; x += 0.2) izk || soba ? bottle(K, x, zb + 0.14, y + 1.53, pick(rng, [[0.15, 0.3, 0.15], [0.3, 0.15, 0.08], [0.9, 0.9, 0.88]]), 0.32) : bowl(K, x, zb + 0.14, y + 1.53, rng() < 0.5 ? BLACK : [0.9, 0.88, 0.82], 1.1);
  // over the kitchen: the menu strips and today's specials; the clock
  const items = menuEntries(trade);
  K.sign(Math.min(R.W - 0.8, 0.55 + items.length * 0.42), 0.72, drawStrips(items), R.cx - 0.2, y + R.ch - 0.55, zb + 0.03, 0, 0.08, 320);
  K.sign(0.3, 0.3, drawClock, R.x1 - 0.45, y + R.ch - 0.45, zb + 0.03, 0, 0.05, 128, 'flat');
  // the counter: a raised pass ledge on the kitchen side, the top, a panel before the stools
  const cl = tatami ? len - (tside > 0 ? 0 : 0) : len, cxa = tatami && tside < 0 ? R.x1 - 0.35 - Math.min(cl, R.W - tw - 1.6) : cx0, cxb = tatami && tside < 0 ? R.x1 - 0.35 : cx0 + Math.min(cl, tatami ? R.W - tw - 1.6 : cl);
  const ccx = (cxa + cxb) / 2, clen = cxb - cxa;
  K.box('wood', ccx, y, zc, clen, 1.0, 0.5, body, 0.01);
  K.box('wood', ccx, y + 1.0, zc + 0.05, clen + 0.06, 0.05, 0.62, top, 0.01);
  K.box('wood', ccx, y + 1.05, zc - 0.22, clen, 0.18, 0.16, top, 0.008);
  K.box('matte', ccx, y + 0.06, zc + 0.27, clen, 0.06, 0.04, [0.15, 0.12, 0.1], 0); // (foot rail)
  if (sushi) for (let k = 0; k < 2; k++) { const gx = cxa + clen * (0.28 + k * 0.44); K.box('metal', gx, y + 1.05, zc - 0.05, 1.2, 0.04, 0.3, STEEL, 0); K.box('glass', gx, y + 1.09, zc - 0.05, 1.2, 0.22, 0.3, [1, 1, 1], 0);
    for (let i = 0; i < 8; i++) K.box('gloss', gx - 0.5 + i * 0.14, y + 1.1, zc - 0.05, 0.1, 0.05, 0.08, pick(rng, [[0.95, 0.5, 0.35], [0.8, 0.15, 0.2], [0.95, 0.8, 0.3], [0.9, 0.9, 0.85]]), 0.005); }
  const seats = Math.floor(clen / 0.62);
  for (let i = 0; i < seats; i++) { const x = cxa + (i + 0.5) * clen / seats;
    stool(K, x, zc + 0.62, y, izk ? [0.72, 0.16, 0.12] : sushi || soba ? MIDW : RED);
    if (i % 2 === 0) condiments(K, x + 0.25, zc + 0.05, y + 1.05, rng, ramen ? 'ramen' : 'x');
    if (Math.abs(x - ccx) > 0.5) out.seats.push({ x, z: zc + 0.62, y: y + 0.68, yaw: Math.PI, stool: true }); // (the middle stool kept for you)
  }
  for (let i = 0; i < 3; i++) { const x = cxa + clen * (i + 0.5) / 3; if (izk) lantern(K, x, y + 2.0, zc + 0.1, [1, 0.34, 0.22], 1.1); else pendant(K, x, y + 1.95, zc + 0.15, R.ch, ramen ? RED : sushi ? [0.85, 0.75, 0.55] : BLACK); }
  // the tatami room: a raised floor of mats edged in dark wood, low tables and cushions, a step and the shoes below
  if (tatami) {
    const tx0 = tside < 0 ? R.x0 : R.x1 - tw, tx1 = tx0 + tw, tz0 = zc + 0.9, tz1 = R.z1 - 0.3, th = 0.38;
    K.box('wood', (tx0 + tx1) / 2, y, (tz0 + tz1) / 2, tw, th, tz1 - tz0, DARKW, 0.01);
    K.up('tatami', tx0 + 0.06, tz0 + 0.06, tx1 - 0.06, tz1 - 0.06, y + th + 0.002, [1, 1, 1], 0.9);
    for (let z = tz0 + 0.06 + 0.9; z < tz1 - 0.2; z += 0.9) K.box('matte', (tx0 + tx1) / 2, y + th + 0.003, z, tw - 0.12, 0.004, 0.035, [0.15, 0.12, 0.08], 0); // (mat edges)
    const ex = tside < 0 ? tx1 : tx0; K.box('wood', ex + tside * -0.2, y, (tz0 + tz1) / 2, 0.4, 0.18, tz1 - tz0 - 0.2, MIDW, 0.01); // (the step)
    for (let z = tz0 + 0.8, k = 0; z < tz1 - 0.6; z += 1.5, k++) { const lx = (tx0 + tx1) / 2; K.box('wood', lx, y + th, z, 0.8, 0.32, 0.65, DARKW, 0.01); K.box('wood', lx, y + th + 0.32, z, 0.86, 0.03, 0.7, [0.36, 0.24, 0.14], 0.005);
      for (const sd of [-1, 1]) K.box('matte', lx + sd * 0.62, y + th, z, 0.42, 0.06, 0.42, [0.55, 0.18, 0.16], 0.02); // (cushions: nobody sits on them — the people know chairs only)
      condiments(K, lx, z, y + th + 0.35, rng, 'x'); }
    for (let i = 0; i < 3; i++) K.box('matte', ex + tside * -0.55, y + 0.18, tz0 + 0.5 + i * 0.35, 0.12, 0.05, 0.28, pick(rng, [[0.2, 0.2, 0.22], [0.5, 0.35, 0.25], [0.15, 0.25, 0.4]]), 0.01); // (shoes)
    lantern(K, (tx0 + tx1) / 2, y + 2.15, (tz0 + tz1) / 2, izk ? [0.95, 0.62, 0.35] : [0.9, 0.7, 0.45], 0.8);
  }
  // tables in the rest of the front, away from the way in and the tatami
  const fz0 = zc + 1.25, fz1 = R.z1 - 0.15;
  if (fz1 - fz0 > 1.3) for (const [tx, tz] of freeCells(R, fz0, fz1, 1.6, 1.6, 0.25, tatami && tside < 0 ? R.x0 + tw + 0.6 : R.x0, tatami && tside > 0 ? R.x1 - tw - 0.6 : R.x1)) {
    table(K, tx, tz, y, 0.75, 0.75, MIDW); chair(K, tx, tz - 0.58, y, 0, MIDW); chair(K, tx, tz + 0.58, y, Math.PI, MIDW);
    out.seats.push({ x: tx, z: tz - 0.58, y: y + 0.45, yaw: 0 }, { x: tx, z: tz + 0.58, y: y + 0.45, yaw: Math.PI }); condiments(K, tx, tz, y + 0.75, rng, ramen ? 'ramen' : 'x');
    if (!izk) pendant(K, tx, y + 1.9, tz, R.ch, ramen ? RED : BLACK, 0.8); }
  // the walls: menu strips along a side wall (izakaya, soba), signed boards, posters, a TV, a manga shelf (ramen)
  const sideW = wallOf(R, tatami ? (tside < 0 ? 'R' : 'L') : (R.door[0] - R.x0 > R.x1 - R.door[1] ? 'L' : 'R'));
  const extra = EXTRA_STRIPS[trade] || [];
  if (extra.length) { const sw = Math.min(sideW.u1 - sideW.u0 - 1.2, 0.5 + extra.length * 0.36), p = sideW.at((sideW.u0 + sideW.u1) / 2 + 0.3, y + R.ch - 0.62, 0.03); K.sign(sw, 0.62, drawStrips(extra, '#b8322a', izk ? ['#f6efdc', '#f2d36b'] : ['#f6efdc', '#efe4c8'], izk ? '#2a1a10' : '#4a3020'), p[0], p[1], p[2], sideW.yaw, 0.06, 320); }
  const posters = izk ? [drawBeer, drawPoster('#1d3557', '#f2d49b', '日本酒', '地酒あります', 'LOCAL SAKE')] : ramen ? [drawShikishi(1), drawShikishi(2), drawShikishi(3)] : [drawScroll(soba ? '蕎麦' : '鮨'), drawPoster('#f4ecdc', '#1b1b1b', '本日', 'おすすめ', 'TODAY')];
  posters.forEach((d, k) => { const u = sideW.u0 + 0.6 + k * (ramen ? 0.42 : 0.9), sq = ramen; const p = sideW.at(u, y + (sq ? 1.45 : 1.55), 0.02); K.sign(sq ? 0.27 : 0.55, sq ? 0.3 : 0.75, d, p[0], p[1], p[2], sideW.yaw, 0.04, 192, 'flat'); });
  const oppo = wallOf(R, sideW.at(0, 0, 0)[0] < R.cx ? 'R' : 'L'), oc = oppo.at(oppo.u0 + 0.4, y + 2.0, 0.4); tvBracket(K, oc[0], oc[1], oc[2], oppo.yaw);
  if (ramen) { wallShelves(K, oppo, oppo.u0 + 1.4, 1.1, y + 1.2, 2, 0.32, rng, { pal: [[0.85, 0.2, 0.2], [0.95, 0.9, 0.8], [0.2, 0.45, 0.8], [0.95, 0.75, 0.2]], d: 0.22, frame: DARKW, mat: 'wood' }); const mp = oppo.at(oppo.u0 + 1.0, y + 1.85, 0.12); maneki(K, mp[0], mp[1], mp[2]); }
  if (izk || soba) { wallShelves(K, oppo, oppo.u0 + 1.6, 1.4, y + 1.35, 2, 0.45, rng, { bottles: true, pal: [[0.12, 0.28, 0.14], [0.35, 0.18, 0.08], [0.9, 0.9, 0.86], [0.1, 0.12, 0.3]], d: 0.26, frame: DARKW, mat: 'wood' }); }
  // the ticket machine by the door (ramen), the water jug
  if (ramen) { const mx = R.door[0] - 0.5 > R.x0 + 0.4 ? R.door[0] - 0.45 : R.door[1] + 0.45, mz = R.z1 - 0.45;
    K.box('gloss', mx, y, mz, 0.62, 1.55, 0.5, [0.88, 0.9, 0.92], 0.015); K.sign(0.54, 0.98, drawTicketMachine([...items, ...extra]), mx, y + 1.0, mz - 0.255, Math.PI, 0.3, 256, 'flat'); }
  K.box('wood', R.x1 - 0.45, y, R.z1 - 0.45, 0.5, 0.75, 0.4, MIDW, 0.01); K.cyl('glass', R.x1 - 0.55, y + 0.75, R.z1 - 0.45, 0.06, 0.06, 0.22, [1, 1, 1], 10); for (let i = 0; i < 4; i++) K.cyl('gloss', R.x1 - 0.35 + (i % 2) * 0.08, y + 0.75, R.z1 - 0.5 + Math.floor(i / 2) * 0.09, 0.03, 0.03, 0.08, [0.8, 0.86, 0.9], 8);
  K.quad('matte', [R.x1 - 0.95, y + 2.1, zb + 0.66], [R.x1 - 0.35, y + 2.1, zb + 0.66], [R.x1 - 0.35, y + 1.45, zb + 0.66], [R.x1 - 0.95, y + 1.45, zb + 0.66], [0.15, 0.2, 0.35], { uv: 1 });
  used(K, sideW, sideW.u0, sideW.u0 + 2.4); used(K, oppo, oppo.u0, oppo.u0 + 2.4);
  if (extra.length) used(K, sideW, (sideW.u0 + sideW.u1) / 2 + 0.3 - 1.5, (sideW.u0 + sideW.u1) / 2 + 0.3 + 1.5);
  dressWalls(K, R, 'eatery', rng);
  out.keeper = { x: ccx - 0.3, z: zb + kd - 0.15, yaw: 0 };
  out.spots.push({ kind: 'counter', x: ccx, z: zc + 0.85, r: Math.max(2.2, clen / 2 + 0.6) });
}
// the café: counter in the middle of the back, back bar, a bar along the front window, a bench along a side wall
function cafe(K, R, trade, rng, out) {
  const y = R.y, zb = R.z0, cw = Math.min(3.2, R.W * 0.6), cxc = R.cx + ((R.door[0] + R.door[1]) / 2 > R.cx ? -0.3 : 0.3), zc = zb + 1.3;
  counter(K, cxc, zc, y, cw, 0.62, [0.3, 0.2, 0.13], [0.82, 0.7, 0.52], 0.95, [0.6, 0.45, 0.25]);
  const em = cxc + cw / 2 - 0.5; K.box('metal', em, y + 0.99, zc - 0.12, 0.6, 0.42, 0.42, [0.72, 0.18, 0.14], 0.02); K.box('metal', em, y + 1.2, zc + 0.1, 0.46, 0.06, 0.04, STEEL, 0); K.cyl('gloss', em - 0.35, y + 0.99, zc - 0.05, 0.07, 0.06, 0.32, BLACK, 10); // (espresso machine, grinder)
  K.box('metal', cxc - cw / 2 + 0.55, y + 0.99, zc + 0.05, 0.9, 0.04, 0.5, STEEL, 0); K.box('glass', cxc - cw / 2 + 0.55, y + 1.03, zc + 0.05, 0.9, 0.4, 0.5, [1, 1, 1], 0); K.box('lit', cxc - cw / 2 + 0.55, y + 1.41, zc + 0.05, 0.86, 0.01, 0.46, [1, 0.95, 0.85], 0);
  for (let i = 0; i < 4; i++) { const x = cxc - cw / 2 + 0.22 + i * 0.22; K.box('gloss', x, y + 1.05, zc + 0.05, 0.14, 0.09, 0.12, [0.98, 0.95, 0.9], 0.005); K.box('gloss', x, y + 1.14, zc + 0.05, 0.14, 0.012, 0.12, pick(rng, [[0.85, 0.2, 0.25], [0.45, 0.25, 0.12], [0.55, 0.7, 0.3]]), 0); K.box('gloss', x, y + 1.05, zc + 0.05 + 0.13, 0.12, 0.05, 0.08, pick(rng, [[0.92, 0.82, 0.6], [0.4, 0.2, 0.1]]), 0.01); }
  register(K, cxc + 0.15, y + 0.99, zc);
  // the back bar: shelves of cups, jars, coffee bags; the menu board above
  const bw = wallOf(R, 'B'); K.box('wood', cxc, y, zb + 0.3, cw, 0.9, 0.55, [0.3, 0.2, 0.13], 0.012); K.box('gloss', cxc, y + 0.9, zb + 0.3, cw + 0.02, 0.03, 0.57, [0.75, 0.62, 0.45], 0.005);
  for (const yy of [1.4, 1.75]) { K.box('wood', cxc, y + yy, zb + 0.13, cw, 0.03, 0.24, DARKW, 0); for (let x = cxc - cw / 2 + 0.12; x < cxc + cw / 2 - 0.08; x += 0.17) yy < 1.5 ? K.cyl('gloss', x, y + yy + 0.03, zb + 0.13, 0.045, 0.04, 0.08, rng() < 0.3 ? [0.2, 0.3, 0.35] : WHITE, 10) : K.box('matte', x, y + yy + 0.03, zb + 0.13, 0.1, 0.18, 0.08, pick(rng, [[0.5, 0.32, 0.2], [0.2, 0.25, 0.2], [0.75, 0.6, 0.35], [0.85, 0.82, 0.75]]), 0.005); }
  K.sign(1.3, 0.62, drawChalk(trade === 7 ? 'Café' : 'Menu', MENUS[trade].items), cxc, y + R.ch - 0.5, zb + 0.03, 0, 0.06, 320);
  pendant(K, cxc - cw / 4, y + 1.95, zc, R.ch, [0.85, 0.75, 0.55]); pendant(K, cxc + cw / 4, y + 1.95, zc, R.ch, [0.85, 0.75, 0.55]);
  // a bench along the side wall away from the door, tables before it; chairs facing the bench
  const sd = R.door[0] - R.x0 > R.x1 - R.door[1] ? 'L' : 'R', w = wallOf(R, sd), barW = Math.min(R.door[0] - R.x0 - 0.5, 2.6), bz0 = zc + 0.9, bz1 = R.z1 - (sd === 'L' && barW > 1.0 ? 1.3 : 0.4);
  if (bz1 - bz0 > 1.2) {
    const mid = (bz0 + bz1) / 2, len = bz1 - bz0; wallBox(K, w, 'wood', mid, y, len, 0.44, 0.48, [0.3, 0.2, 0.13], 0.03, 0.01); wallBox(K, w, 'matte', mid, y + 0.44, len, 0.06, 0.46, [0.42, 0.2, 0.16], 0.04, 0.02); wallBox(K, w, 'matte', mid, y + 0.5, len, 0.42, 0.1, [0.42, 0.2, 0.16], 0.03, 0.03);
    for (let z = bz0 + 0.55, k = 0; z < bz1 - 0.3; z += 1.25, k++) { const p = w.at(z, y, 0.95); table(K, p[0], z, y, 0.62, 0.62, [0.3, 0.2, 0.13], [0.86, 0.78, 0.62]); const cp = w.at(z, y, 1.45); chair(K, cp[0], z, y, w.yaw + Math.PI, [0.3, 0.2, 0.13]);
      const bp = w.at(z, y, 0.27); out.seats.push({ x: bp[0], z, y: y + 0.47, yaw: w.yaw }, { x: cp[0], z, y: y + 0.45, yaw: w.yaw + Math.PI });
      K.cyl('gloss', p[0], y + 0.72, z, 0.03, 0.03, 0.11, [0.95, 0.95, 0.9], 8); pendant(K, p[0], y + 1.9, z, R.ch, [0.85, 0.75, 0.55], 0.8);
      const fp = w.at(z, y + 1.55, 0.015); K.sign(0.5, 0.38, drawPicture(k), fp[0], fp[1], fp[2], w.yaw, 0.03, 192, 'flat'); }
  }
  // a bar along the front window with high stools (seen from the street), plants, a bookshelf on the other wall
  const ww = barW, wx = R.x0 + 0.3 + ww / 2;
  if (ww > 1.0) { K.box('wood', wx, y + 1.0, R.z1 - 0.2, ww, 0.04, 0.36, [0.75, 0.6, 0.42], 0.006); K.box('dark', wx - ww / 2 + 0.1, y, R.z1 - 0.12, 0.04, 1.0, 0.04, BLACK, 0); K.box('dark', wx + ww / 2 - 0.1, y, R.z1 - 0.12, 0.04, 1.0, 0.04, BLACK, 0);
    for (let x = wx - ww / 2 + 0.35; x < wx + ww / 2 - 0.2; x += 0.6) { stool(K, x, R.z1 - 0.62, y, [0.3, 0.2, 0.13], 0.74); out.seats.push({ x, z: R.z1 - 0.62, y: y + 0.74, yaw: 0, stool: true }); } }
  const ow = wallOf(R, sd === 'L' ? 'R' : 'L'); wallShelves(K, ow, ow.u0 + 1.9, 1.0, y + 0.3, 4, 0.4, rng, { pal: [[0.6, 0.15, 0.12], [0.2, 0.3, 0.45], [0.85, 0.8, 0.65], [0.3, 0.45, 0.3], [0.15, 0.15, 0.17]], d: 0.28, frame: DARKW, mat: 'wood' });
  const pp = ow.at(ow.u0 + 0.6, y, 0.35); plant(K, pp[0], pp[2], y, 1.1); const pp2 = w.at(R.z1 - 0.3, y, 0.3); plant(K, pp2[0], pp2[2], y, 0.9);
  const cp = ow.at(ow.u0 + 3.0, y + 1.6, 0.015); K.sign(0.6, 0.42, drawPoster('#c98a3e', '#fbf6ea', '珈琲', 'ひだまり', 'COFFEE · SINCE 1978'), cp[0], cp[1], cp[2], ow.yaw, 0.03, 256, 'flat');
  used(K, w, bz0, bz1); used(K, ow, ow.u0 + 1.35, ow.u0 + 3.4);
  dressWalls(K, R, 'cafe', rng);
  out.keeper = { x: cxc - 0.2, z: zc - 0.6, yaw: 0 };
  out.spots.push({ kind: 'counter', x: cxc, z: zc + 0.8, r: 2.0 });
}
// the sweet shop and the bakery: the case just inside the window, the shelves behind, seats or racks
function caseShop(K, R, trade, rng, out) {
  const y = R.y, bake = trade === 11, zc = R.z0 + 1.45, len = Math.min(R.W - 1.4, 3.8), cx = R.cx - (R.door[0] + R.door[1] > 2 * R.cx ? 0.4 : -0.4);
  // the case: a wooden base, lit glass, trays of what is sold, tent cards
  K.box('wood', cx, y, zc, len, 0.78, 0.62, bake ? [0.86, 0.8, 0.7] : DARKW, 0.012);
  K.box('metal', cx, y + 0.78, zc, len, 0.03, 0.62, STEEL, 0); K.box('glass', cx, y + 0.81, zc, len, 0.42, 0.62, [1, 1, 1], 0); K.box('wood', cx, y + 1.23, zc, len + 0.02, 0.03, 0.64, bake ? LIGHTW : DARKW, 0.006);
  K.box('lit', cx, y + 1.2, zc, len - 0.1, 0.012, 0.5, [1, 0.97, 0.9], 0);
  const goods = MENUS[trade].items.filter(id => !ITEMS[id].here && !ITEMS[id].look[0].match(/pet|can/)), per = len / Math.max(1, goods.length);
  goods.forEach((id, k) => { const gx = cx - len / 2 + per * (k + 0.5), look = ITEMS[id].look; K.box('matte', gx, y + 0.82, zc, per - 0.1, 0.012, 0.42, [0.95, 0.94, 0.9], 0);
    for (let i = 0; i < 6; i++) { const ix = gx - per / 2 + 0.1 + (i % 3) * (per - 0.2) / 2, iz = zc - 0.1 + Math.floor(i / 3) * 0.2, yy = y + 0.835;
      if (look[0] === 'dango') { K.box('wood', ix, yy + 0.01, iz, 0.14, 0.006, 0.006, LIGHTW, 0); ['#f3a9bd', '#fbf6ea', '#9cc46a'].forEach((c, j) => K.cyl('gloss', ix - 0.04 + j * 0.04, yy, iz, 0.02, 0.02, 0.035, hex(c), 8)); }
      else if (look[0] === 'daifuku') K.cyl('gloss', ix, yy, iz, 0.035, 0.03, 0.035, [0.98, 0.97, 0.94], 10);
      else if (look[0] === 'taiyaki') K.box('gloss', ix, yy, iz, 0.12, 0.03, 0.06, [0.82, 0.55, 0.25], 0.012);
      else if (look[0] === 'croissant') K.box('gloss', ix, yy, iz, 0.12, 0.05, 0.07, [0.85, 0.58, 0.25], 0.02);
      else K.cyl('gloss', ix, yy, iz, 0.05, 0.045, look[0] === 'dorayaki' ? 0.035 : 0.05, hex(look[1] && look[1][0] === '#' ? look[1] : look[0] === 'dorayaki' ? '#b8692a' : look[0] === 'currypan' ? '#c48a3e' : '#d9a35a'), 12); }
    K.sign(0.12, 0.07, drawLabel('#ffffff', '#b8322a', ITEMS[id].price + '円', ITEMS[id].jp.slice(0, 4)), gx, y + 0.86, zc + 0.27, 0, 0.05, 64, 'flat'); });
  const tx = cx + len / 2 + 0.32; if (tx < R.x1 - 0.2) { K.box('wood', tx, y, zc, 0.5, 0.92, 0.6, bake ? [0.86, 0.8, 0.7] : DARKW, 0.01); register(K, tx, y + 0.92, zc); }
  // behind the case: the back counter and wall shelves of gift boxes (or bread), a scroll, a lamp over the case
  const bw = wallOf(R, 'B');
  K.box('wood', R.cx, y, R.z0 + 0.28, R.W - 0.4, 0.88, 0.5, bake ? [0.9, 0.86, 0.78] : DARKW, 0.012); K.box('gloss', R.cx, y + 0.88, R.z0 + 0.28, R.W - 0.38, 0.03, 0.52, bake ? LIGHTW : [0.48, 0.34, 0.22], 0.005);
  wallShelves(K, bw, R.cx, R.W - 0.6, y + 1.2, 3, 0.36, rng, { pal: bake ? [[0.95, 0.9, 0.8], [0.8, 0.62, 0.4], [0.72, 0.5, 0.3]] : [[0.75, 0.15, 0.15], [0.95, 0.92, 0.85], [0.2, 0.3, 0.45], [0.55, 0.7, 0.4], [0.8, 0.6, 0.3]], d: 0.3, frame: bake ? LIGHTW : DARKW, mat: 'wood' });
  for (let i = 0; i < 2; i++) pendant(K, cx + (i - 0.5) * len * 0.5, y + 1.9, zc, R.ch, bake ? [0.9, 0.85, 0.75] : DARKW, 0.9);
  if (bake) { // bread racks down the side walls, a table of baskets, trays and tongs by the door
    for (const sd of ['L', 'R']) { const w = wallOf(R, sd), u0 = zc + 0.9, u1 = R.z1 - 0.7; if (u1 - u0 > 0.8) wallShelves(K, w, (u0 + u1) / 2, u1 - u0, y + 0.5, 3, 0.42, rng, { pal: [[0.82, 0.55, 0.25], [0.9, 0.75, 0.4], [0.72, 0.42, 0.2]], d: 0.45, frame: LIGHTW, mat: 'wood' }); }
    K.box('wood', R.door[0] - 0.45, y, R.z1 - 0.45, 0.4, 0.9, 0.4, LIGHTW, 0.01); for (let i = 0; i < 6; i++) K.box('matte', R.door[0] - 0.45, y + 0.9 + i * 0.012, R.z1 - 0.45, 0.36, 0.01, 0.28, [0.75, 0.6, 0.4], 0);
  } else { // tea benches in red felt behind, a parasol, a hanging scroll and flowers
    const ez0 = zc + 1.0, ez1 = R.z1 - 0.2;
    if (ez1 - ez0 > 1.2) freeCells(R, ez0, ez1, 2.0, 1.6, 0.3, R.x0, R.x1).slice(0, 2).forEach(([fx, fz], k) => {
      K.box('wood', fx, y, fz, 0.55, 0.45, 0.55, DARKW, 0.01); for (const sd of [-1, 1]) { K.box('wood', fx + sd * 0.6, y, fz, 0.38, 0.4, 0.9, DARKW, 0.01); K.box('matte', fx + sd * 0.6, y + 0.4, fz, 0.4, 0.02, 0.92, [0.75, 0.12, 0.12], 0); out.seats.push({ x: fx + sd * 0.6, z: fz, y: y + 0.42, yaw: -sd * Math.PI / 2 }); }
      K.cyl('gloss', fx - 0.1, y + 0.45, fz, 0.04, 0.035, 0.07, [0.35, 0.5, 0.3], 10);
      if (k === 0) { K.cyl('wood', fx + 0.95, y, fz + 0.5, 0.02, 0.02, 2.0, LIGHTW, 6, false); K.cyl('matte', fx + 0.95, y + 1.75, fz + 0.5, 1.05, 0.04, 0.45, [0.8, 0.12, 0.1], 16); } });
    const sw = wallOf(R, R.door[0] - R.x0 > R.x1 - R.door[1] ? 'L' : 'R'), sp = sw.at(zc + 0.6, y + 1.5, 0.015); K.sign(0.42, 1.1, drawScroll('和'), sp[0], sp[1], sp[2], sw.yaw, 0.03, 256, 'flat');
    const fp = sw.at(zc + 1.3, y, 0.25); K.box('wood', fp[0], y, fp[2], 0.4, 0.7, 0.4, DARKW, 0.01); plant(K, fp[0], fp[2], y + 0.7, 0.6);
  }
  if (!bake) { const sw2 = wallOf(R, R.door[0] - R.x0 > R.x1 - R.door[1] ? 'L' : 'R'); used(K, sw2, zc + 0.3, zc + 1.6); }
  dressWalls(K, R, bake ? 'shop' : 'sweets', rng);
  out.keeper = { x: cx, z: zc - 0.55, yaw: 0 };
  out.spots.push({ kind: 'counter', x: cx, z: zc + 0.8, r: Math.max(2.0, len / 2 + 0.5) });
}
// the shelves shops: pharmacy and liquor shop (and the konbini, below) — what each shelf holds
export const SECTIONS = {
  1: [{ name: 'Health drinks & jelly', jp: '栄養ドリンク', items: ['energy', 'jelly'] }, { name: 'Drinks', jp: '飲料', items: ['sports', 'water', 'greentea'], fridge: true }, { name: 'Sweets', jp: 'お菓子', items: ['pocky'] }],
  8: [{ name: 'Soft drinks', jp: 'ソフトドリンク', items: ['ramune', 'orange', 'cola'] }, { name: 'Tea & water', jp: 'お茶・水', items: ['greentea', 'mugicha', 'water', 'coffeecan'], fridge: true }],
  konbini: [{ name: 'Drinks', jp: '飲料', items: ['greentea', 'water', 'milktea', 'sports', 'cola', 'orange', 'coffeecan'], fridge: true },
    { name: 'Rice balls & bento', jp: 'おにぎり・弁当', items: ['onigiri_salmon', 'onigiri_tuna', 'sando', 'bento'], chill: true },
    { name: 'Sweets & snacks', jp: 'お菓子', items: ['pocky', 'jelly', 'energy'] }, { name: 'Ice cream', jp: 'アイス', items: ['icecream'], freezer: true }],
};
const MEDS = [[0.95, 0.95, 0.96], [0.86, 0.2, 0.22], [0.16, 0.44, 0.78], [0.95, 0.8, 0.2], [0.3, 0.68, 0.45], [0.95, 0.6, 0.7], [0.55, 0.75, 0.92]];
const SAKE = [[0.12, 0.28, 0.14], [0.35, 0.18, 0.08], [0.9, 0.9, 0.86], [0.1, 0.12, 0.3], [0.6, 0.4, 0.12]];
function shelfShop(K, R, trade, rng, out) {
  const y = R.y, ph = trade === 1, secs = SECTIONS[trade], others = secs.filter(s => !s.fridge);
  // the drinks fridge along the back wall (its other half: the dispensing counter, or sake shelves)
  const fx0 = R.x0 + 0.25, fx1 = Math.min(R.x1 - 0.25, R.x0 + 0.25 + Math.max(1.6, R.W * 0.5));
  fridgeWall(K, fx0, fx1, R.z0 + 0.62, y, rng, 1.95, 0.6);
  out.spots.push({ kind: 'shelf', ...secs.find(s => s.fridge), x: (fx0 + fx1) / 2, z: R.z0 + 1.3, r: 1.6, tx: (fx0 + fx1) / 2, tz: R.z0 + 0.3 });
  const bw = wallOf(R, 'B'), rx0 = fx1 + 0.15, rx1 = R.x1 - 0.2;
  if (rx1 - rx0 > 0.8) { if (ph) { counter(K, (rx0 + rx1) / 2, R.z0 + 0.45, y, rx1 - rx0, 0.55, WHITE, [0.85, 0.88, 0.9], 0.95, [0.16, 0.44, 0.71]); wallShelves(K, bw, (rx0 + rx1) / 2, rx1 - rx0, y + 1.25, 3, 0.3, rng, { pal: MEDS, d: 0.22 }); const sp = bw.at((rx0 + rx1) / 2, y + R.ch - 0.35, 0.02); K.sign(Math.min(1.2, rx1 - rx0), 0.3, drawLabel('#ffffff', '#1f6fb5', 'DISPENSING', '調剤'), sp[0], sp[1], sp[2], 0, 0.15, 128, 'flat'); }
    else wallShelves(K, bw, (rx0 + rx1) / 2, rx1 - rx0, y + 0.3, 4, 0.48, rng, { bottles: true, pal: SAKE, d: 0.3, frame: DARKW, mat: 'wood' }); }
  // gondolas down the room (their ends to the window: the goods seen from the street), clear of the door's way
  const tillSide = R.door[0] - R.x0 > R.x1 - R.door[1] ? 'R' : 'L', gl = Math.min(R.D - 2.6, 2.6), gz = R.z0 + 1.35 + gl / 2, dc = (R.door[0] + R.door[1]) / 2;
  const bandL = R.x0 + (tillSide === 'L' ? 1.75 : 1.3), bandR = R.x1 - (tillSide === 'R' ? 1.75 : 1.3), cols = [];
  for (let x = bandL; x <= bandR + 0.01; x += 1.9) if (Math.abs(x - dc) > 0.85) cols.push(x);
  cols.slice(0, 2).forEach((gx, k) => {
    // (along z: a gondola is built along x, so turned by laying its run along z)
    const D = 0.9, L = gl, H = ph ? 1.45 : 1.35, frame = ph ? [0.84, 0.85, 0.86] : [0.45, 0.32, 0.2];
    K.box('matte', gx, y, gz, D, 0.12, L, [0.3, 0.3, 0.32], 0); K.box('matte', gx, y + 0.12, gz, 0.06, H - 0.12, L, frame, 0); for (const e of [-1, 1]) K.box('matte', gx, y + 0.12, gz + e * (L / 2 - 0.02), D, H - 0.1, 0.04, frame, 0);
    for (const sd of [-1, 1]) for (const ly of [0.15, 0.5, 0.85, 1.2]) { const sx = gx + sd * (D / 4 + 0.03); K.box('matte', sx, y + ly - 0.02, gz, D / 2 - 0.08, 0.02, L - 0.06, frame, 0); K.box('gloss', gx + sd * (D / 2 - 0.02), y + ly - 0.05, gz, 0.012, 0.05, L - 0.06, [0.98, 0.84, 0.16], 0);
      if (ph) packetsZ(K, sx + sd * 0.04, gz - L / 2 + 0.05, gz + L / 2 - 0.05, y + ly, rng, [0.06, 0.16], 0.18, MEDS); else for (let u = gz - L / 2 + 0.08; u < gz + L / 2 - 0.06; u += 0.1) bottle(K, sx + sd * 0.05, u, y + ly, pick(rng, SAKE.concat([[0.85, 0.2, 0.18], [0.95, 0.75, 0.2]])), ly < 0.3 ? 0.4 : 0.28, 0.034); }
    const sec = others[k % others.length]; out.spots.push({ kind: 'shelf', ...sec, x: gx + (gx < R.cx ? 0.95 : -0.95), z: gz, r: 1.5, tx: gx, tz: gz });
    const sg = K.sign(0.9, 0.24, drawAisle(sec.jp, sec.name.toUpperCase(), ph ? '#1f6fb5' : '#5a3a20'), gx, y + R.ch - 0.45, gz, 0, 0.2, 128, 'both');
  });
  // wall shelving down the side wall away from the till
  const ow = wallOf(R, tillSide === 'R' ? 'L' : 'R'), ou0 = R.z0 + 1.0, ou1 = R.z1 - 0.6;
  if (ou1 - ou0 > 0.8) wallShelves(K, ow, (ou0 + ou1) / 2, ou1 - ou0, y + 0.25, 5, 0.38, rng, ph ? { pal: MEDS, d: 0.32 } : { bottles: true, pal: SAKE, d: 0.32, frame: DARKW, mat: 'wood' });
  // the till near the door against the other wall: counter, register, goods behind the clerk
  const tw = wallOf(R, tillSide), tz = R.z1 - 1.3, p = tw.at(tz, y, 0.95);
  K.box('matte', p[0], y, tz, 0.6, 0.92, 1.4, ph ? WHITE : [0.4, 0.3, 0.22], 0.012); K.box('gloss', p[0], y + 0.92, tz, 0.64, 0.04, 1.44, ph ? [0.85, 0.88, 0.9] : [0.25, 0.18, 0.12], 0.008);
  K.box('gloss', p[0], y + 0.96, tz - 0.35, 0.3, 0.12, 0.34, [0.15, 0.15, 0.17], 0.01); K.box('screen', p[0] + (tillSide === 'L' ? 0.05 : -0.05), y + 1.11, tz - 0.35, 0.01, 0.13, 0.24, [0.55, 0.8, 0.92], 0);
  wallShelves(K, tw, tz, 1.4, y + 1.0, 3, 0.3, rng, { pal: ph ? MEDS : [[0.9, 0.9, 0.9], [0.2, 0.3, 0.7], [0.8, 0.15, 0.15], [0.9, 0.75, 0.2]], d: 0.2 });
  const kp = tw.at(tz, y, 0.35); out.keeper = { x: kp[0], z: tz, yaw: tw.yaw };
  const cp = tw.at(tz, y, 1.75); out.spots.push({ kind: 'till', x: cp[0], z: tz, r: 1.6 });
  if (!ph) for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) K.box('wood', R.x0 + 0.5 + i * 0.5, y + j * 0.3, R.z1 - 0.4, 0.45, 0.3, 0.33, [0.75, 0.55, 0.2], 0.01); // (crates by the window)
  if (!ph) K.cyl('wood', R.x0 + 0.5, y + 0.6, R.z1 - 0.4, 0.22, 0.22, 0.36, [0.82, 0.68, 0.45], 14); // (a sake cask on them)
  for (let i = 0; i < 3; i++) panel(K, R.cx, y + R.ch, R.z0 + (i + 0.5) * R.D / 3, 1.2, 0.3);
  dressWalls(K, R, 'shop', rng, [tillSide]);
  const pw = wallOf(R, tillSide), pp = pw.at(R.z0 + 0.9, y + 1.9, 0.015); K.sign(0.55, 0.75, ph ? drawPoster('#1f6fb5', '#ffffff', '健康', 'くすりのヤマダ', 'HEALTH & BEAUTY') : drawPoster('#1d3557', '#f2d49b', '地酒', 'たなか酒店', 'SAKE · DRINKS'), pp[0], pp[1], pp[2], pw.yaw, 0.05, 256, 'flat');
}
function konbini(K, R, rng, out, seed) {
  // the shop floor behind the glass vestibule: drinks along the back wall (left), the chilled case of rice balls and
  // bento (right), two gondolas, the till against the front wall right of the way in (hot snacks, coffee machine,
  // cigarettes behind the clerk), the ice-cream chest; in the vestibule the magazine rack, the ATM and the copier
  const y = R.y, zb = R.z0, secs = SECTIONS.konbini;
  fridgeWall(K, R.x0 + 0.2, -0.15, zb + 0.62, y, rng, 1.95, 0.6);
  out.spots.push({ kind: 'shelf', ...secs[0], x: (R.x0 + 0.2 - 0.15) / 2, z: zb + 1.25, r: 1.8, tx: (R.x0 + 0.2 - 0.15) / 2, tz: zb + 0.3 });
  const cx0 = 0.15, cx1 = R.x1 - 0.2, cc = (cx0 + cx1) / 2; // chilled open case: tiers of rice balls, sandwiches and bento
  K.box('matte', cc, y, zb + 0.35, cx1 - cx0, 0.72, 0.65, WHITE, 0.01); K.box('matte', cc, y, zb + 0.14, cx1 - cx0, 1.95, 0.25, WHITE, 0.01);
  K.box('lit', cc, y + 1.85, zb + 0.32, cx1 - cx0, 0.1, 0.3, [0.9, 0.94, 1], 0); K.box('gloss', cc, y + 0.72, zb + 0.68, cx1 - cx0, 0.06, 0.03, [0.1, 0.55, 0.3], 0);
  for (let lv = 0; lv < 4; lv++) { const yy = y + 0.76 + lv * 0.27, dz = zb + 0.55 - lv * 0.09; K.box('metal', cc, yy - 0.02, dz, cx1 - cx0, 0.015, 0.3, STEEL, 0);
    K.B.detail(3, () => { for (let x = cx0 + 0.08; x < cx1 - 0.06; x += 0.13) { const kind = lv < 2 ? 'oni' : lv === 2 ? 'sando' : 'bento';
      if (kind === 'oni') { K.box('gloss', x, yy, dz, 0.1, 0.09, 0.03, [0.97, 0.97, 0.95], 0.008); K.box('gloss', x, yy, dz + 0.016, 0.05, 0.06, 0.004, [0.12, 0.18, 0.14], 0); K.box('gloss', x, yy + 0.07, dz + 0.016, 0.05, 0.015, 0.004, pick(rng, [[0.9, 0.3, 0.2], [0.95, 0.85, 0.4], [0.2, 0.5, 0.25]]), 0); }
      else if (kind === 'sando') K.box('gloss', x, yy, dz, 0.11, 0.1, 0.06, [0.97, 0.92, 0.55], 0.01);
      else { K.box('gloss', x, yy, dz, 0.12, 0.05, 0.12, [0.1, 0.1, 0.1], 0.008); K.box('gloss', x, yy + 0.05, dz, 0.11, 0.004, 0.11, [0.85, 0.55, 0.3], 0); x += 0.02; } } }); }
  out.spots.push({ kind: 'shelf', ...secs[1], x: cc, z: zb + 1.3, r: 1.7, tx: cc, tz: zb + 0.4 });
  // the gondolas: packed with goods, price rails, an aisle sign over each
  // (the till's place first: the gondola on its side stops short of the customers' way to it)
  const tx = (Math.max(R.vx1 ?? 2, 2.1) + R.x1) / 2 + 0.1, tw = Math.min(2.2, R.x1 - (R.vx1 ?? 2) - 0.3), tz = R.z1 - 0.72;
  const gz = zb + 1.8, gA0 = R.x0 + 0.9, gA1 = -0.35, gB0 = 0.35, gB1 = Math.min(R.x1 - 0.5, tx - tw / 2 - 0.8);
  gondola(K, (gA0 + gA1) / 2, gz, y, gA1 - gA0, rng, { D: 0.7 }); if (gB1 - gB0 > 0.7) gondola(K, (gB0 + gB1) / 2, gz, y, gB1 - gB0, rng, { D: 0.7, pal: [[0.95, 0.85, 0.2], [0.85, 0.2, 0.18], [0.98, 0.98, 0.96], [0.94, 0.5, 0.69], [0.55, 0.35, 0.24]] });
  out.spots.push({ kind: 'shelf', ...secs[2], x: (gA0 + gA1) / 2, z: gz + 0.85, r: 1.6, tx: (gA0 + gA1) / 2, tz: gz }, { kind: 'shelf', ...secs[2], x: (gA0 + gA1) / 2, z: gz - 0.75, r: 1.3, tx: (gA0 + gA1) / 2, tz: gz });
  K.sign(1.0, 0.26, drawAisle('飲料', 'DRINKS'), (R.x0 + 0.2 - 0.15) / 2, y + R.ch - 0.42, zb + 1.1, 0, 0.2, 128, 'both');
  K.sign(1.0, 0.26, drawAisle('おにぎり・お弁当', 'RICE BALLS · BENTO', '#1f5fb4'), cc, y + R.ch - 0.42, zb + 1.1, 0, 0.2, 128, 'both');
  K.sign(1.0, 0.26, drawAisle('お菓子・日用品', 'SNACKS · DAILY', '#d0521e'), (gA0 + gA1) / 2, y + R.ch - 0.42, gz, 0, 0.2, 128, 'both');
  // the ice-cream chest
  const ix = R.x0 + 0.9, iz = R.z1 - 0.65; K.box('matte', ix, y, iz, 1.0, 0.8, 0.6, WHITE, 0.02); K.box('glass', ix, y + 0.8, iz, 0.96, 0.02, 0.56, [1, 1, 1], 0); K.box('lit', ix, y + 0.79, iz, 0.9, 0.005, 0.5, [0.75, 0.9, 1], 0);
  for (let i = 0; i < 8; i++) K.box('gloss', ix - 0.36 + (i % 4) * 0.24, y + 0.62, iz - 0.12 + Math.floor(i / 4) * 0.24, 0.18, 0.06, 0.08, pick(rng, [[0.5, 0.8, 0.95], [0.95, 0.6, 0.7], [0.95, 0.9, 0.7]]), 0.01);
  out.spots.push({ kind: 'shelf', ...secs[3], x: ix, z: iz - 0.95, r: 1.4, tx: ix, tz: iz });
  // the till against the front wall right of the way in: the clerk between it and the wall, facing the shop
  counter(K, tx, tz, y, tw, 0.6, [0.96, 0.96, 0.94], [0.2, 0.42, 0.72], 0.92, [0.1, 0.55, 0.3]);
  register(K, tx + tw * 0.2, y + 0.96, tz);
  const hx = tx - tw * 0.25; K.box('metal', hx, y + 0.96, tz, 0.55, 0.4, 0.42, STEEL, 0.01); K.box('glass', hx, y + 0.98, tz - 0.21, 0.5, 0.34, 0.01, [1, 1, 1], 0); K.box('lit', hx, y + 1.33, tz, 0.5, 0.02, 0.38, [1, 0.8, 0.55], 0);
  for (let i = 0; i < 6; i++) K.box('gloss', hx - 0.17 + (i % 3) * 0.17, y + 1.0 + Math.floor(i / 3) * 0.16, tz - 0.04, 0.12, 0.06, 0.1, pick(rng, [[0.85, 0.55, 0.2], [0.8, 0.45, 0.15], [0.95, 0.8, 0.35]]), 0.01);
  K.box('gloss', tx - tw / 2 + 0.2, y + 0.96, tz, 0.36, 0.56, 0.38, [0.12, 0.12, 0.14], 0.02); K.box('screen', tx - tw / 2 + 0.2, y + 1.3, tz - 0.195, 0.24, 0.14, 0.01, [0.95, 0.7, 0.4], 0); K.cyl('gloss', tx - tw / 2 + 0.2, y + 0.98, tz - 0.08, 0.04, 0.035, 0.1, WHITE, 10);
  for (let i = 0; i < 30; i++) K.box('gloss', tx - tw / 2 + 0.2 + (i % 10) * (tw - 0.4) / 9, y + 1.45 + Math.floor(i / 10) * 0.13, R.z1 - 0.06, 0.08, 0.1, 0.05, pick(rng, [[0.95, 0.95, 0.95], [0.2, 0.3, 0.7], [0.8, 0.15, 0.15], [0.9, 0.75, 0.2], [0.2, 0.2, 0.2]]), 0.004);
  out.keeper = { x: tx, z: R.z1 - 0.2, yaw: Math.PI };
  out.spots.push({ kind: 'till', x: tx, z: tz - 0.95, r: 1.6 });
  // the vestibule: magazine rack under the left window, ATM and copier along its right
  if (R.vx0 !== undefined) {
    const mx = R.vx0 + 0.22; K.box('matte', mx, y, (R.vz0 + R.vz1) / 2 - 0.2, 0.36, 0.9, Math.min(2.2, R.vz1 - R.vz0 - 0.8), [0.9, 0.9, 0.88], 0.01);
    for (let i = 0; i < 12; i++) K.box('matte', mx + 0.12, y + 0.92 - (i % 2) * 0.35, R.vz0 + 0.35 + Math.floor(i / 2) * 0.32, 0.03, 0.3, 0.22, pick(rng, [[0.9, 0.3, 0.3], [0.3, 0.5, 0.9], [0.95, 0.85, 0.3], [0.95, 0.95, 0.95], [0.4, 0.75, 0.4], [0.95, 0.6, 0.75]]), 0);
    const ax = R.vx1 - 0.32; K.box('gloss', ax, y, R.vz0 + 0.55, 0.55, 1.45, 0.6, [0.85, 0.87, 0.9], 0.02); K.box('screen', ax - 0.28, y + 1.05, R.vz0 + 0.55, 0.01, 0.22, 0.35, [0.4, 0.7, 0.95], 0); K.box('gloss', ax - 0.25, y + 0.85, R.vz0 + 0.55, 0.1, 0.03, 0.4, [0.3, 0.3, 0.32], 0);
    K.sign(0.5, 0.18, drawLabel('#1f5fb4', '#ffffff', 'ATM', 'ATM'), ax, y + 1.62, R.vz0 + 0.55, -Math.PI / 2, 0.15, 64, 'flat');
    K.box('gloss', ax, y, R.vz0 + 1.45, 0.6, 1.05, 0.65, [0.92, 0.92, 0.9], 0.02); K.box('dark', ax - 0.1, y + 1.05, R.vz0 + 1.45, 0.4, 0.04, 0.5, [0.2, 0.2, 0.22], 0);
    panel(K, R.cx, y + R.ch, R.vz0 + 0.9, 1.2, 0.2); panel(K, R.cx, y + R.ch, R.vz0 + 2.0, 1.2, 0.2);
  }
  for (let k = 0; k < 4; k++) for (let j = 0; j < 2; j++) panel(K, R.x0 + R.W * (k + 0.5) / 4, y + R.ch, R.z0 + 0.9 + j * 1.5, 1.4, 0.18);
  const rw = wallOf(R, 'R'), pp = rw.at(R.z0 + 1.6, y + 1.75, 0.03); K.sign(0.8, 0.55, drawPoster('#0a8a4b', '#ffffff', '100円', 'おにぎりフェア', 'RICE BALL FAIR'), pp[0], pp[1], pp[2], rw.yaw, 0.1, 256, 'flat');
  K.sign(0.55, 0.55, drawPoster('#f2c400', '#c0281e', 'NEW', '新発売', 'からあげクン'), tx + tw / 2 - 0.3, y + 2.0, R.z1 - 0.05, Math.PI, 0.1, 256, 'flat');
}
function cycleShop(K, R, rng, out) {
  const y = R.y;
  // the showroom at the open front: bicycles in a row; the shop bay: pegboard of helmets and bags, tyres, a repair
  // stand, the counter at the back
  if (R.zone) { const [zx0, zx1, zz0, zz1] = R.zone; for (let i = 0, x = zx0 + 0.45; x < zx1 - 0.3 && i < 5; x += 0.55, i++) K.pack(i % 2 ? 'jp_bicycle_2' : 'jp_bicycle_1', x, y, (zz0 + zz1) / 2 + 0.35, Math.PI / 2 - 0.25, 0.75, false); }
  const w = wallOf(R, 'R'), u0 = R.z0 + 0.4, u1 = R.z1 - 0.8;
  K.quad('peg', w.at(u0, y + 0.9, 0.01), w.at(u1, y + 0.9, 0.01), w.at(u1, y + 2.2, 0.01), w.at(u0, y + 2.2, 0.01), [1, 1, 1], { uv: 1 });
  for (let u = u0 + 0.25; u < u1 - 0.2; u += 0.42) for (let j = 0; j < 3; j++) { const c = pick(rng, [[0.18, 0.29, 0.39], [0.48, 0.35, 0.23], [0.55, 0.14, 0.12], [0.2, 0.35, 0.22], [0.15, 0.15, 0.17], [0.92, 0.75, 0.2]]), p = w.at(u, y + 1.05 + j * 0.42, 0.13);
    if (j === 2) { K.cyl('gloss', p[0], p[1], p[2], 0.13, 0.11, 0.12, c, 12); } else { K.box('matte', p[0], p[1], p[2], 0.22, 0.32, 0.26, c, 0.06); } }
  const lw = wallOf(R, 'L'); for (let k = 0; k < 4; k++) { const p = lw.at(R.z0 + 0.6 + k * 0.5, y + 1.5, 0.08); K.cyl('dark', p[0], p[1] - 0.33, p[2], 0.33, 0.33, 0.05, [0.08, 0.08, 0.09], 18, false); }
  K.box('metal', R.cx, y, R.z0 + 1.9, 0.4, 0.05, 0.4, STEEL, 0); K.box('metal', R.cx, y + 0.05, R.z0 + 1.9, 0.05, 1.1, 0.05, STEEL, 0); K.pack('jp_bicycle', R.cx, y + 0.25, R.z0 + 1.9, 0.15, 0.7, false);
  // the wall of the closed block beside the stairs, facing the street: pegboard, a poster, helmets and bags on hooks
  if (R.face) { const [fx0, fx1, fz] = R.face, fy = fz + 0.012; K.quad('peg', [fx0, y + 0.5, fy], [fx1, y + 0.5, fy], [fx1, y + 2.3, fy], [fx0, y + 2.3, fy], [1, 1, 1], { uv: 1 });
    K.sign(Math.min(0.9, fx1 - fx0 - 0.2), 0.62, drawPoster('#ffcc00', '#222222', 'CYCLE', 'サイクル中村', '修理・点検 承ります'), (fx0 + fx1) / 2, y + 1.85, fy + 0.01, 0, 0.05, 256, 'flat');
    for (let x = fx0 + 0.2; x < fx1 - 0.15; x += 0.3) { K.cyl('gloss', x, y + 1.05, fy + 0.12, 0.12, 0.1, 0.12, pick(rng, [[0.15, 0.15, 0.17], [0.85, 0.2, 0.18], [0.92, 0.92, 0.9], [0.2, 0.4, 0.75]]), 12); K.box('matte', x, y + 0.7, fy + 0.08, 0.2, 0.18, 0.12, pick(rng, [[0.18, 0.29, 0.39], [0.48, 0.35, 0.23], [0.2, 0.2, 0.22]]), 0.03); } }
  // the passage beside the stairs: bicycles parked along the stair wall with their price tags, a banner over them
  if (R.aisle) { const [ax0, ax1, az0, az1] = R.aisle; K.up('concrete', ax0, az0, ax1, az1, y + 0.006); K.down('ceilGrid', ax0, az0, ax1, az1, y + R.ch, [1, 1, 1], 1.2); K.lamp((ax0 + ax1) / 2, y + R.ch - 0.35, (az0 + az1) / 2, 8, NEUTRAL, 3.6);
    for (let z = az0 + 1.0, k = 0; z < az1 - 0.6 && k < 2; z += 1.9, k++) { K.pack(k ? 'jp_bicycle_2' : 'jp_bicycle_1', ax0 + 0.42, y, z, Math.PI / 2, 0.75, false); K.sign(0.18, 0.12, drawLabel('#ffffff', '#c0281e', '¥' + (24800 + k * 6000).toLocaleString('ja-JP'), '特価'), ax0 + 0.42, y + 1.0, z + 0.2, Math.PI / 2, 0.05, 64, 'flat'); }
    K.sign(Math.min(2.2, az1 - az0 - 0.6), 0.5, drawPoster('#1f5fb4', '#ffffff', '新車入荷', 'NEW BICYCLES', '電動アシスト自転車 あります'), ax0 + 0.02, y + 1.85, (az0 + az1) / 2, Math.PI / 2, 0.05, 256, 'flat');
    K.quad('peg', [ax1 - 0.012, y + 0.6, az1 - 0.3], [ax1 - 0.012, y + 0.6, az0 + 0.3], [ax1 - 0.012, y + 2.2, az0 + 0.3], [ax1 - 0.012, y + 2.2, az1 - 0.3], [1, 1, 1], { uv: 1 });
    for (let z = az0 + 0.55; z < az1 - 0.4; z += 0.38) for (let j = 0; j < 3; j++) { const c = pick(rng, [[0.15, 0.15, 0.17], [0.85, 0.2, 0.18], [0.92, 0.92, 0.9], [0.2, 0.4, 0.75], [0.95, 0.75, 0.2]]); if (j === 2) K.cyl('gloss', ax1 - 0.13, y + 1.85, z, 0.12, 0.1, 0.12, c, 12); else K.box('matte', ax1 - 0.13, y + 0.8 + j * 0.48, z, 0.24, 0.3, 0.22, c, 0.05); } panel(K, (ax0 + ax1) / 2, y + R.ch, (az0 + az1) / 2, 1.2, 0.25); }
  const tx = R.cx, tz = R.z0 + 0.5; counter(K, tx, tz, y, Math.min(1.6, R.W - 0.3), 0.55, [0.35, 0.25, 0.18], [0.75, 0.62, 0.45], 0.92); register(K, tx + 0.3, y + 0.96, tz);
  const bw = wallOf(R, 'B'); wallShelves(K, bw, R.cx, R.W - 0.3, y + 1.3, 2, 0.35, rng, { pal: [[0.15, 0.15, 0.17], [0.7, 0.7, 0.72], [0.85, 0.2, 0.18], [0.95, 0.75, 0.2]], d: 0.24, frame: DARKW, mat: 'wood' });
  const sp = bw.at(R.cx, y + R.ch - 0.4, 0.02); K.sign(1.0, 0.3, drawLabel('#ffcc00', '#222222', 'CYCLE NAKAMURA', 'サイクル中村'), sp[0], sp[1], sp[2], 0, 0.15, 128, 'flat');
  out.keeper = { x: tx, z: tz - 0.45, yaw: 0 };
  out.spots.push({ kind: 'counter', x: tx, z: tz + 0.85, r: 1.8 });
  panel(K, R.cx, y + R.ch, R.cz, 1.4, 0.3); if (R.zone) panel(K, (R.zone[0] + R.zone[1]) / 2, y + R.ch, (R.zone[2] + R.zone[3]) / 2, 1.4, 0.3);
}

// ---------------------------------------------------------------- the building: its door leaves taken out and sliding
function splitDoors(id, M, swap, spec, o, r, s) {
  const P = packsReady(), m = P.models[id], leaves = spec.leaves || [], out = { parts: [], doors: [] };
  const groups = leaves.map(() => []);
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
  const B = splitDoors(id, M, swap, spec, o, r, s);
  addProp('pack:' + id + ':shop', B.parts);
  for (const p of B.parts) { const g = p.geometry, pos = g.attributes.position, idx = g.index, n = idx ? idx.count : pos.count, v = new THREE.Vector3(); for (let i = 0; i < n; i++) { v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(M); tris.push(v.x, v.y, v.z); } }
  // the room: its walls as measured, its free floor a little inside them
  const [rx0, rx1, rz0, rz1] = spec.room, mw = measure(id, spec, s), floorY = 0.06 * s[1] + 0.02, front = spec.front * s[2];
  const R = { wl: mw.L, wr: mw.R, wb: mw.B, wf: Math.min(rz1 * s[2], front - 0.08), y: floorY, door: [spec.door[0] * s[0], spec.door[1] * s[0]], front, ch: Math.min(mw.C, (spec.ceiling || 3.2) * s[1]) - floorY - 0.01 };
  Object.assign(R, { x0: R.wl + 0.03, x1: R.wr - 0.03, z0: R.wb + 0.03, z1: R.wf });
  R.cx = (R.x0 + R.x1) / 2; R.cz = (R.z0 + R.z1) / 2; R.W = R.x1 - R.x0; R.D = R.z1 - R.z0;
  if (spec.vest) { R.vx0 = spec.vest[0] * s[0]; R.vx1 = spec.vest[1] * s[0]; R.vz0 = spec.vest[2] * s[2]; R.vz1 = spec.vest[3] * s[2]; }
  if (spec.zone) R.zone = [spec.zone[0] * s[0], spec.zone[1] * s[0], spec.zone[2] * s[2], spec.zone[3] * s[2]];
  if (spec.face) R.face = [spec.face[0] * s[0], spec.face[1] * s[0], spec.face[2] * s[2]];
  if (spec.aisle) R.aisle = [spec.aisle[0] * s[0], spec.aisle[1] * s[0], spec.aisle[2] * s[2], spec.aisle[3] * s[2]];
  if (spec.walls) { R.walls = {}; for (const [k, [a, b]] of Object.entries(spec.walls)) R.walls[k] = [a * s[2], b * s[2]]; }
  const zoneIn = (x, z) => spec.zone && x > spec.zone[0] - 0.1 && x < spec.zone[1] + 0.1 && z > spec.zone[2] - 0.1 && z < spec.zone[3] + 0.1;
  return {
    // the kit's own things inside the room are left out (the room is furnished anew), and what it stuck on the doors
    kitWhere: (src, x, yy, z) => (x > rx0 - 0.1 && x < rx1 + 0.1 && z > rz0 - 0.1 && z < (spec.vest ? spec.vest[3] : rz1) + 0.05 && yy < 2.6) || (zoneIn(x, z) && yy < 2.6) || (x > spec.door[0] - 0.15 && x < spec.door[1] + 0.15 && Math.abs(z - spec.front) < 0.4 && yy < 2.4),
    kitProp: (src, m) => { if (!/sticker|sign|lamp|cable|warning|ventilation|aircondition|fusebox|lantern|cloth/.test(src)) packTris(src, m, tris); },
    finish(BB, mark) {
      const out = { spots: [], seats: [], keeper: null }, t = site.trade, TH = THEMES[t] || THEMES[7];
      const cap = capHooks.bucket; capHooks.bucket = null; // (the furnishings are the shop's own; the World Builder does not edit them)
      const ib = builder(), m0 = new Map(); for (const [k, b] of ib.parts) m0.set(k, b.idx.length);
      ib.frame(o[0], o[1], o[2], r);
      ib.detail(2, () => { // (fittings: near detail, drawn within ~90 m)
        shell(K, R, TH, spec);
        if (t === 'konbini') konbini(K, R, rng, out, seed); else if (t === 15) cycleShop(K, R, rng, out);
        else if (MENUS[t].serve === 'shelves') shelfShop(K, R, t, rng, out);
        else if (t === 7) cafe(K, R, t, rng, out); else if (t === 6 || t === 11) caseShop(K, R, t, rng, out); else eatery(K, R, t, rng, out);
      });
      // (the furnishings' triangles, and the building builder's since the shop began: its slab)
      for (const [k, b] of ib.parts) { const P2 = b.pos.a, I = b.idx.a; for (let i = m0.get(k) || 0; i < b.idx.length; i++) { const v = I[i] * 3; tris.push(P2[v], P2[v + 1], P2[v + 2]); } }
      for (const [k, b] of BB.parts) { const P2 = b.pos.a, I = b.idx.a; for (let i = mark.get(k) || 0; i < b.idx.length; i++) { const v = I[i] * 3; tris.push(P2[v], P2[v + 1], P2[v + 2]); } }
      capHooks.bucket = cap;
      const C = addCompound(buildCompound(new Float32Array(tris), { x: o[0], y: o[1], z: o[2], r, ground: () => y }));
      // the site: the world places of all this
      const W = (lx, lz) => K.W(lx, 0, lz);
      const zmax = spec.vest ? R.vz1 : R.z1, zmin = R.z0, xmin = Math.min(R.x0, R.vx0 ?? R.x0, R.zone ? R.zone[0] : R.x0), xmax = Math.max(R.x1, R.vx1 ?? R.x1, R.zone ? R.zone[1] : R.x1);
      const bc = W((xmin + xmax) / 2, (zmin + zmax) / 2);
      site.box = { x: bc[0], z: bc[2], r, hx: (xmax - xmin) / 2, hz: (zmax - zmin) / 2 + 0.15 };
      const dIn = W((R.door[0] + R.door[1]) / 2, zmax - 0.6); site.inDoor = [dIn[0], dIn[2]];
      const dOut = W((R.door[0] + R.door[1]) / 2, R.front + 1.2); site.door = { x: dOut[0], z: dOut[2], yaw: r };
      if (out.keeper) { const k = W(out.keeper.x, out.keeper.z); site.keeper = { x: k[0], y: o[1] + R.y, z: k[2], yaw: r + out.keeper.yaw }; }
      // (each with what it is: the shopkeeper over the counter, the shelf — the player faces that)
      site.spots = out.spots.map(p => { const w = W(p.x, p.z), tg = p.tx !== undefined ? W(p.tx, p.tz) : (p.kind === 'counter' || p.kind === 'till') && out.keeper ? W(out.keeper.x, out.keeper.z) : null; return { ...p, x: w[0], z: w[2], tx: tg ? tg[0] : undefined, tz: tg ? tg[2] : undefined }; });
      site.seats = out.seats.map(p => { const w = W(p.x, p.z); return { x: w[0], z: w[2], y: o[1] + p.y, floor: o[1] + (p.floorY ?? R.y), yaw: r + p.yaw, stool: !!p.stool }; });
      site.doors = B.doors;
      site.inside = true; site.collider = C; site.enter = true;
      // the doorway shut when the shop is closed
      if (B.doors.length) { const a = W(R.door[0], R.front), b = W(R.door[1], R.front), cc = { t: 1, x: (a[0] + b[0]) / 2, z: (a[2] + b[2]) / 2, hx: Math.hypot(b[0] - a[0], b[2] - a[2]) / 2 + 0.1, hz: 0.12, c: Math.cos(r), s: Math.sin(r), y0: -1e9, y1: 1e9 };
        let on = false; site.doors[0].block = v => { if (!!v === on) return; on = !!v; if (on) colInsert(cc); else colRemove(cc); }; }
      if (t === 'konbini') { const bw = W(R.door[1] + 1.5, R.front + 0.8); site.bins = [[bw[0], bw[2]]]; }
    },
  };
}
// a room's lamp for builders outside this module (the drawn konbini): indoor brightness, a room's reach
export const roomLamp = (p, i = 2.6, c = COOL, r = 4.6) => ({ p, s: 0.1, r, i, c, in: true });
