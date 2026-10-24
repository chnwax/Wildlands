// The konbini's shop floor and its front of house from Idyllic Anime Japan (building.js konbini_build calls this when
// the model library is there; without it the store keeps its painted interior behind the glass).
// Through clear glass: a lit sales floor — drinks on the wall racks at the back, goods on the wall racks down the side,
// three rows of low gondolas stocked with packets, the counter by the door with the cigarette shelves behind it, a
// cash machine, magazine racks along the front glass, strip lights in the ceiling. Outside: the pack's bins by the
// door, bicycle stands, a 3D コンビニ sign on the side wall, stickers on the glass, a roof vent and a big fuse box at the
// back. Everything is placed in the store's own frame (origin its centre, +z to the street, front wall at z = d/2) and
// belongs to the konbini object (props and loose meshes), so it moves and hides with it in the World Builder.
// Its own random stream: the town's draws stay as they were.
import { THREE, scene, mulberry32, addProp } from './core.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { packParts, packProp, packTris } from './packs.js';
import { glowMats, lampPoints, signMesh } from './townkit.js';
import { roomTexture } from './interiors.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _y = new THREE.Vector3(0, 1, 0);
let mats = null;
function materials() {
  if (mats) return mats;
  // (the room is in the shell's shadow and lit by its own strip lights: a steady glow, brighter at night with the town's lamps)
  const lit = (color, glow) => { const m = new THREE.MeshStandardMaterial({ color, roughness: 0.6, emissive: color, emissiveIntensity: 0 }); m.userData.glow = glow; return m; };
  mats = {
    glass: new THREE.MeshStandardMaterial({ color: 0xe6eef2, transparent: true, opacity: 0.12, roughness: 0.03, metalness: 0.2, envMapIntensity: 1.6, depthWrite: false }),
    // (a faint glow of their own; the room's lamps light it — citylights.js: a room's lamps reach the room only)
    wall: lit(0xe2e3de, 0.06), floor: lit(0xb9bdb8, 0.04), ceiling: lit(0xf4f4f0, 0.1),
    strip: new THREE.MeshBasicMaterial({ color: 0xd8d8d0 }), // (bright, not blinding: below the bloom threshold)
    goods: (() => { const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, emissive: 0xffffff, emissiveIntensity: 0 }); m.userData.glow = 0.05; glowMats.push(m); return m; })(),
  };
  mats.glass.name = 'konbini_glass'; mats.wall.name = 'konbini_wall'; mats.floor.name = 'konbini_floor'; mats.ceiling.name = 'konbini_ceiling'; mats.strip.name = 'konbini_strip'; mats.goods.name = 'konbini_goods';
  return mats;
}

// door: the sliding doors' bay (x0, x1, its top): the glass is left out there; tris: the room's triangles (its floor, the
// glass, the fittings) for the store's collider
export function konbiniDress(B, { w, d, H, gl, sideWin, glassZ, dx, bwid, bins, door = null, tris = null }) {
  const M = materials(), rng = mulberry32(4242), F = B.F;
  const place = (lx, ly, lz, dr, sc) => { const p = B.P([lx, ly, lz]); return _m.compose(_v.set(p[0], p[1], p[2]), _q.setFromAxisAngle(_y, F.r + dr), Array.isArray(sc) ? _s.set(sc[0], sc[1], sc[2]) : _s.setScalar(sc)); };
  const mesh = (geo, mat, lx, ly, lz, dr = 0) => { const o = new THREE.Mesh(geo, mat); place(lx, ly, lz, dr, 1).decompose(o.position, o.quaternion, o.scale); o.receiveShadow = false; o.castShadow = false; scene.add(o); return o; };
  // indoor models: lit as the room is (no shadows from the shell over them), none cast
  const inside = (id, lx, ly, lz, dr = 0, sc = 1) => { const P = packParts(id); if (!P) return null;
    place(lx, ly, lz, dr, sc); if (tris && !/sticker|carton|bottle|fusebox_wall/.test(id)) packTris(id, _m, tris); return addProp('pack:' + id + ':in', P.map(q => ({ geometry: q.geometry, material: q.material, matrix: _m, castShadow: false, receiveShadow: false }))); };
  const outside = (id, lx, ly, lz, dr = 0, sc = 1) => { const p = B.P([lx, ly, lz]); return packProp(id, p[0], p[1], p[2], F.r + dr, sc); };

  // ---- the room: an inside-out box (floor, ceiling, walls seen from within), clear glass in the front and side windows
  const ix = w / 2 - 0.25, iz0 = -d / 2 + 0.25, iz1 = glassZ - 0.06, Y0 = 0.12, Y1 = 3.0;
  const room = new THREE.BoxGeometry(2 * ix, Y1 - Y0, iz1 - iz0);
  const roomMats = [M.wall, M.wall, M.ceiling, M.floor, M.wall, M.wall].map(m => { const c = m.clone(); c.side = THREE.BackSide; c.emissiveIntensity = m.userData.glow; return c; });
  roomMats[3].map = roomTexture('vinyl', 2 * ix / 1.0, (iz1 - iz0) / 1.0); roomMats[3].color.set(0xffffff); // (vinyl tiles underfoot)
  mesh(room, roomMats, 0, (Y0 + Y1) / 2, (iz0 + iz1) / 2).receiveShadow = true;
  // the chain's colours round the walls over the racks, aisle signs over the gondolas, posters
  { const g = new THREE.MeshStandardMaterial({ color: 0x0a8a4b, roughness: 0.6 }), b = new THREE.MeshStandardMaterial({ color: 0x1f5fb4, roughness: 0.6 });
    for (const [mat, yy, hh] of [[g, 2.78, 0.12], [b, 2.66, 0.05]]) { mesh(new THREE.BoxGeometry(2 * ix, hh, 0.02), mat, 0, yy, iz0 + 0.012); for (const e of [-1, 1]) mesh(new THREE.BoxGeometry(0.02, hh, iz1 - iz0), mat, e * (ix - 0.012), yy, (iz0 + iz1) / 2); } }
  const sign = (w2, h2, draw, lx, ly, lz, dr) => { const s = signMesh(w2, h2, draw, 0.15, 128, { back: 'both' }); const p = B.P([lx, ly, lz]); s.position.set(p[0], p[1], p[2]); s.rotation.y = F.r + dr; s.updateMatrixWorld(); scene.add(s); return s; };
  const aisle = (jp, en, bg) => (g2, W2, H2) => { g2.fillStyle = bg; g2.fillRect(0, 0, W2, H2); g2.fillStyle = '#fff'; g2.textAlign = 'center'; g2.textBaseline = 'middle'; g2.font = `bold ${H2 * 0.5}px "Yu Gothic UI", "Meiryo", sans-serif`; g2.fillText(jp, W2 / 2, H2 * 0.42); g2.font = `${H2 * 0.2}px "Yu Gothic UI", sans-serif`; g2.fillText(en, W2 / 2, H2 * 0.82); };
  [['お菓子', 'SNACKS', '#d0521e', -3.3], ['日用品', 'DAILY GOODS', '#1f5fb4', -0.85], ['カップ麺', 'NOODLES', '#0a8a4b', 1.6]].forEach(([jp, en, bg, gz]) => sign(1.1, 0.28, aisle(jp, en, bg), 1.0, 2.55, gz, 0));
  sign(1.3, 0.3, aisle('飲料', 'DRINKS', '#0a8a4b'), 0, 2.45, iz0 + 1.1, 0);
  // (the front glass: round the door's bay when the doors slide; in the collider as panes, with the room's floor)
  const pane = (x0, x1, y0, y1) => { mesh(new THREE.PlaneGeometry(x1 - x0, y1 - y0), M.glass, (x0 + x1) / 2, (y0 + y1) / 2, glassZ); if (tris) { const a = B.P([x0, y0, glassZ]), b = B.P([x1, y0, glassZ]), c = B.P([x1, y1, glassZ]), e = B.P([x0, y1, glassZ]); tris.push(...a, ...b, ...c, ...a, ...c, ...e); } };
  if (door) { pane(gl.x0, door[0], gl.y0, gl.y1); pane(door[1], gl.x1, gl.y0, gl.y1); pane(door[0], door[1], door[2], gl.y1); } else pane(gl.x0, gl.x1, gl.y0, gl.y1);
  if (tris) { const a = B.P([-ix, Y0, iz0]), b = B.P([ix, Y0, iz0]), c = B.P([ix, Y0, iz1 + 0.3]), e = B.P([-ix, Y0, iz1 + 0.3]); tris.push(...a, ...e, ...c, ...a, ...c, ...b); }
  { const p = [w / 2 - sideWin.d + 0.04, (sideWin.y0 + sideWin.y1) / 2, -(sideWin.x0 + sideWin.x1) / 2];
    mesh(new THREE.PlaneGeometry(sideWin.x1 - sideWin.x0, sideWin.y1 - sideWin.y0), M.glass, p[0], p[1], p[2], Math.PI / 2); }
  // strip lights, and the light they give at night (citylights.js)
  const strips = [];
  for (const sz of [-4.2, -1.6, 1.0, 3.6]) strips.push(new THREE.BoxGeometry(2 * ix - 3, 0.05, 0.22).translate(0.5, Y1 - 0.03, sz));
  mesh(mergeGeometries(strips), M.strip, 0, 0, 0);
  for (const [lx, lz] of [[-6, -3.2], [0, -3.2], [6, -3.2], [-6, 1.2], [0, 1.2], [6, 1.2]]) lampPoints.push({ p: B.P([lx, 2.7, lz]), s: 0.1, r: 5.2, i: 12, c: [0.92, 0.96, 1.0], in: true });

  // ---- drinks along the back wall, goods down the side: tall racks stocked shelf by shelf
  const LEVELS = [0.12, 0.56, 1.0, 1.44, 1.98], BOTTLES = ['jp_bottle_drink_01', 'jp_bottle_drink_02', 'jp_bottle_drink_03', 'jp_bottle_drink_04'];
  const rack = (cx, cz, dr, stock) => {
    if (inside('jp_shelves_store', cx, Y0, cz, dr) === null) return;
    const c = Math.cos(dr), s = Math.sin(dr), at = (u, v) => [cx + u * c + v * s, cz - u * s + v * c]; // rack frame: u along it, v toward the aisle
    for (const ly of LEVELS) stock(at, ly);
  };
  const bottles = (at, ly) => { let kind = 0;
    for (let u = -1.68; u <= 1.68; u += 0.14) { if (Math.round((u + 1.68) / 0.14) % 6 === 0) kind = Math.floor(rng() * BOTTLES.length);
      for (const v of [0.22, 0.04]) { const [px, pz] = at(u, v); inside(BOTTLES[kind], px, Y0 + ly + 0.02, pz, rng() * 6.28, kind === 3 ? 1.1 : 0.75); } } };
  const cartons = (at, ly) => { for (let u = -1.55; u <= 1.6; u += 0.42 + rng() * 0.2) { const [px, pz] = at(u, 0.05); if (rng() < 0.6) inside('jp_carton_03', px, Y0 + ly + 0.02, pz, (rng() - 0.5) * 0.3, 0.55); else inside(BOTTLES[Math.floor(rng() * 4)], px, Y0 + ly + 0.02, pz, 0, 1); } };
  for (let i = 0; i < 5; i++) rack(-7.3 + i * 3.66, iz0 + 0.42, 0, bottles);
  for (let i = 0; i < 2; i++) rack(ix - 0.42, -1.27 + 1.83 + i * 3.66, -Math.PI / 2, (at, ly) => ly < 1.9 && cartons(at, ly));

  // ---- gondolas: three rows of low racks back to back, packets on every shelf (one merged mesh of little boxes)
  const GS = [1, 0.6, 0.8], GL = [0.07, 0.34, 0.6, 0.86], packets = [];
  const COLS = [0xe8473f, 0xf2b632, 0x3d8fd6, 0x5ab55a, 0xf07fb0, 0xffffff, 0xf5e6c4, 0x8b5a3c, 0xff8a2a, 0x7a5cc7, 0x2fb3a8];
  for (const gz of [-3.3, -0.85, 1.6]) for (let i = 0; i < 3; i++) {
    const gx = -2.4 + 1.83 + i * 3.66;
    for (const side of [-1, 1]) {
      inside('jp_shelves_store', gx, Y0, gz + side * 0.33, side > 0 ? 0 : Math.PI, GS);
      for (const ly of GL) for (let u = -1.7; u < 1.62;) {
        const bw = 0.1 + rng() * 0.22, bh = 0.1 + rng() * 0.12, bd = 0.22, c = new THREE.Color(COLS[Math.floor(rng() * COLS.length)]);
        const g = new THREE.BoxGeometry(bw * 0.92, bh, bd).translate(gx + u + bw / 2, Y0 + ly + 0.025 + bh / 2, gz + side * (0.33 + 0.12));
        const n = g.attributes.position.count, col = new Float32Array(n * 3); for (let k = 0; k < n; k++) c.toArray(col, k * 3);
        g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.deleteAttribute('uv'); packets.push(g); u += bw;
      }
    }
  }
  if (packets.length) mesh(mergeGeometries(packets), M.goods, 0, 0, 0);

  // ---- counter by the door, cigarette shelves behind it, register; a cash machine; magazine racks along the glass
  inside('jp_counter_shop', -ix + 1.9, Y0, 2.75, Math.PI / 2);
  for (let i = 0; i < 3; i++) inside('jp_shelf_wooden', -ix + 0.33, Y0, 1.0 + i * 1.22, Math.PI / 2);
  // (behind the clerk: the shelves full — cigarettes, sweets, daily things; on the counter the hot-snack warmer, the
  // steamer and the coffee machine)
  { const packs = [], COLS2 = [0xf2f2f2, 0x2a4fa8, 0xc8322a, 0xe8b830, 0x303034, 0x3d8fd6, 0xf07fb0];
    for (let i = 0; i < 3; i++) for (const ly of [0.44, 0.92, 1.38, 1.86]) for (let u = -0.55; u < 0.55;) { const bw = 0.06 + rng() * 0.08, bh = 0.08 + rng() * (ly > 1.5 ? 0.1 : 0.2), c = new THREE.Color(COLS2[Math.floor(rng() * COLS2.length)]);
      const g = new THREE.BoxGeometry(0.2, bh, bw * 0.9).translate(-ix + 0.38, Y0 + ly + 0.01 + bh / 2, 1.0 + i * 1.22 + u + bw / 2); const n = g.attributes.position.count, col = new Float32Array(n * 3); for (let k = 0; k < n; k++) c.toArray(col, k * 3); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.deleteAttribute('uv'); packs.push(g); u += bw; }
    mesh(mergeGeometries(packs), M.goods, 0, 0, 0);
    const steel = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.35, metalness: 0.5 }), warm = new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffb050, emissiveIntensity: 0.5 }), dark = new THREE.MeshStandardMaterial({ color: 0x1e1f22, roughness: 0.4 });
    mesh(new THREE.BoxGeometry(0.42, 0.42, 0.6), steel, -ix + 1.75, Y0 + 1.33, 1.1); mesh(new THREE.BoxGeometry(0.36, 0.06, 0.52), warm, -ix + 1.75, Y0 + 1.5, 1.1);
    mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.36, 16), steel, -ix + 1.75, Y0 + 1.3, 1.75); mesh(new THREE.BoxGeometry(0.42, 0.62, 0.42), dark, -ix + 1.75, Y0 + 1.43, 4.6); }
  inside('jp_fusebox_wall_09', -ix + 1.9, Y0 + 1.12, 1.6, Math.PI / 2, 1.1);           // (the till)
  inside('jp_fusebox_large', dx + bwid * 0.75, Y0, iz1 - 0.35, Math.PI, [0.85, 0.95, 0.9]); // (the cash machine / copier)
  inside('jp_sticker_atm', dx + bwid * 0.75, Y0 + 1.2, iz1 - 0.35 - 0.22, Math.PI, 1.2);
  for (let i = 0; i < 6; i++) inside('jp_shelf_wooden', 1.0 + i * 1.22, Y0, iz1 - 0.4, Math.PI, [1, 0.48, 0.7]);
  for (let i = 0; i < 6; i++) for (let k = 0; k < 2; k++) inside('jp_carton_03', 1.0 + i * 1.22 + (k - 0.5) * 0.5, Y0 + 1.11, iz1 - 0.45, (rng() - 0.5) * 0.2, [0.9, 0.12, 0.5]);

  // ---- outside: bins by the door (where the drawn ones stood), bicycle stands, the side-wall sign, stickers, vents
  const BIN_IDS = ['jp_trash_recycling', 'jp_trash_recycling', 'jp_trash_can_02', 'jp_trash_can_01'];
  bins.forEach((bx, i) => outside(BIN_IDS[i], bx, 0, 0.45, 0, i < 2 ? 0.85 : 0.75));
  for (let i = 0; i < 4; i++) outside('jp_bikestand', gl.x1 - 3.3 + i * 0.8, 0, 1.3, 0, 1);
  { const p = B.P([w / 2 + 0.09, 3.1, -1.2]); packProp('jp_sign_3d_konbini', p[0], p[1], p[2], F.r + Math.PI / 2, 0.9); }
  outside('jp_sticker_open', dx - bwid * 0.2, 1.35, glassZ + 0.01);
  outside('jp_sticker_tobacco', gl.x0 + bwid * 2.5, 2.05, glassZ + 0.01, 0, 1.4);
  outside('jp_sticker_store_ads', gl.x0 + bwid * 4.5, 2.1, glassZ + 0.01);
  outside('jp_sticker_store_ads_02', gl.x0 + bwid * 3.5, 2.1, glassZ + 0.01);
  for (const lx of [-w / 4, w / 4]) outside('jp_ventilation_01', lx, H + 0.03, -d / 2 + 1.4, Math.PI, 1);
  outside('jp_ventilation_03', -2, 3.0, -d / 2 - 0.04, Math.PI, 1);
  outside('jp_fusebox_large', 1.5, 0, -d / 2 - 0.26, Math.PI, 0.9);
  outside('jp_warning_panel_08', 1.5, 1.15, -d / 2 - 0.49, Math.PI, 1.2);          // (a high-voltage warning on it)
  outside('jp_warning_panel_02', bins[0] + 0.26, 1.6, glassZ + 0.012, 0, 1.1);   // (the recycling notice over the bins)
}

// the sliding doors (automatic: shops.js opens them as you come): two leaves of an aluminium frame round a glass pane,
// each its own mesh, sliding apart along the front. dx: the bay's middle, bwid: its width, z: the leaves' line (frame).
let alu = null;
export function konbiniDoors(B, { dx, bwid, z, y0 = 0.14, h = 2.2 }) {
  const M = materials(), doors = []; alu = alu || new THREE.MeshStandardMaterial({ color: 0xc8ccd0, roughness: 0.35, metalness: 0.6, envMapIntensity: 0.6 });
  const F = B.F, ax = Math.cos(F.r), az = -Math.sin(F.r), lw = bwid * 0.48;
  for (const s2 of [-1, 1]) {
    const geo = mergeGeometries([[0.05, h, -lw / 2 + 0.025, h / 2], [0.05, h, lw / 2 - 0.025, h / 2], [lw, 0.07, 0, 0.035], [lw, 0.05, 0, h - 0.025]].map(([bw, bh, x, y]) => new THREE.BoxGeometry(bw, bh, 0.04).translate(x, y, 0)));
    const g = new THREE.Group(), fr = new THREE.Mesh(geo, alu), gp = new THREE.Mesh(new THREE.PlaneGeometry(lw - 0.08, h - 0.12), M.glass);
    gp.position.set(0, h / 2 + 0.01, 0); fr.castShadow = true; g.add(fr, gp);
    const p = B.P([dx + s2 * bwid * 0.25, y0, z]); g.position.set(p[0], p[1], p[2]); g.rotation.y = F.r; scene.add(g); g.updateMatrixWorld(true);
    const bx = p[0], bz = p[2];
    doors.push({ x: B.P([dx, 0, z])[0], z: B.P([dx, 0, z])[2], auto: true, move: t => { g.position.set(bx + s2 * ax * lw * 0.95 * t, p[1], bz + s2 * az * lw * 0.95 * t); g.updateMatrixWorld(true); }, show: v => { g.visible = v; } });
  }
  return doors;
}
