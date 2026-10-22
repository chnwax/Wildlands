// Shops in the world: where you are served and what you can reach — the shopkeepers' counters inside the shops (or at
// the door of a shop without a way in), a konbini's and a pharmacy's shelves and their till, vending machines and the
// recycling boxes beside them, the parks' litter bins — the prompt for what is in front of you (E), the doors that slide
// open as you come, and the shop's bell. The panels themselves are shopui.js; what is sold and carried, items.js.
// Shops and their insides come from the town build (building.js SHOP_SITES; interiors.js furnishes them): each knows its
// trade, its menu and hours (items.js MENUS), where its shopkeeper stands, its counter, shelves, till and bins, its
// floor (a box: inside or not) and its doors. A shop that is closed has nobody at the counter and its door shut.
import { THREE } from './core.js';
import { time } from './sky.js';
import { SHOP_NAMES } from './townkit.js';
import { SHOP_SITES } from './building.js';
import { ITEMS, MENUS, openAt, unpaid, unpaidTotal, empties, binEmpties, yen } from './items.js';
import { shopUI } from './shopui.js';
import { interiorSigns } from './interiors.js';
import { toastMsg } from './ui.js';

const hhmm = h => String(Math.floor(h) % 24).padStart(2, '0') + ':00';
// (a point in a site's floor box)
const inBox = (b, x, z, pad = 0) => { if (!b) return false; const dx = x - b.x, dz = z - b.z, lx = dx * Math.cos(b.r) - dz * Math.sin(b.r), lz = dx * Math.sin(b.r) + dz * Math.cos(b.r); return Math.abs(lx) < b.hx + pad && Math.abs(lz) < b.hz + pad; };

export function buildShops({ layer }) {
  // ---- what can be used: shops (their counter, shelves, till), vending machines, bins
  const shops = [], spots = [];
  for (const s of SHOP_SITES) {
    const menu = MENUS[s.trade]; if (!menu || s.closed || !s.door) continue;
    const nm = s.trade === 'konbini' ? ['コンビニ', 'Sunny Mart'] : SHOP_NAMES[s.trade];
    const c = { site: s, menu, trade: s.trade, title: s.trade === 'konbini' ? 'Sunny Mart' : nm[1], jp: s.trade === 'konbini' ? 'コンビニ' : nm[0], label: menu.label, open: () => openAt(menu, time.hour) };
    shops.push(c);
    if (s.spots && s.spots.length) for (const p of s.spots) spots.push({ ...p, shop: c });
    else spots.push({ kind: 'counter', x: s.door.x, z: s.door.z, r: 2.6, shop: c }); // (served at the door)
  }
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), bins = [];
  for (const ent of layer.ents.values()) {
    if (ent.prefab !== 'vending_machine' && ent.prefab !== 'litter_bin') continue; const st = ent.state; if (st && (st.deleted || st.hidden)) continue;
    layer.matrixOf(ent, m).decompose(p, q, sc);
    if (ent.prefab === 'vending_machine') spots.push({ kind: 'vend', x: p.x, z: p.z, r: 1.7, shop: { menu: MENUS.vending, title: 'Vending machine', jp: '自動販売機', label: 'Drinks', open: () => true } });
    else spots.push({ kind: 'bin', x: p.x, z: p.z, r: 1.6 });
    bins.push([p.x, p.z]);
  }
  for (const c of shops) for (const b of c.site.bins || []) bins.push(b);
  // the shopkeepers (pedestrians.js draws them): who stands where, dressed for the trade, there while the shop is open
  const APRON = { konbini: [0.2, 0.42, 0.72], 0: [0.12, 0.12, 0.14], 3: [0.18, 0.16, 0.2], 12: [0.2, 0.24, 0.3], 16: [0.95, 0.95, 0.93], 7: [0.35, 0.25, 0.18], 11: [0.92, 0.88, 0.8], 6: [0.5, 0.2, 0.22], 1: [0.95, 0.96, 0.98], 8: [0.25, 0.3, 0.45], 15: [0.3, 0.42, 0.3] };
  const WOMEN = new Set([7, 11, 6, 1]), keepers = [];
  for (const c of shops) {
    const s = c.site; if (!s.keeper) continue; const t = s.trade, h = Math.abs(Math.floor(s.keeper.x * 7 + s.keeper.z * 13));
    keepers.push({ x: s.keeper.x, y: s.keeper.y, z: s.keeper.z, yaw: s.keeper.yaw, woman: WOMEN.has(t) || (t === 'konbini' && h % 2 === 0), shirt: APRON[t] || [0.3, 0.3, 0.32], open: c.open, counter: c, ground: !s.inside });
    c.keeper = keepers.length - 1;
  }
  // patrons: people at the counters and tables of the eateries while they are open (pedestrians.js seats them)
  const patrons = [];
  for (const c of shops) for (const st of c.site.seats || []) patrons.push({ ...st, open: c.open, shop: c });

  // ---- the panels
  let player = null, onGreet = null, here = null, unpaidAt = null, near = null;
  const binNear = () => !!player && bins.some(([x, z]) => Math.hypot(x - player.pos.x, z - player.pos.z) < 3.2);
  const shelfNear = () => !!near && near.kind === 'shelf';
  const ui = shopUI({ binNear, shelfNear, onPaid: c => { if (onGreet && c.keeper !== undefined) onGreet(c.keeper); }, onBought: c => { if (onGreet && c.keeper !== undefined) onGreet(c.keeper); } });

  // ---- doors: each leaf slides open when you come close to an open shop, and shuts behind you
  const doors = []; for (const c of shops) for (const d of c.site.doors || []) doors.push({ ...d, shop: c, t: 0 });
  let audio = null;
  function chime() { // a konbini's door chime: a few soft sine notes
    try { audio = audio || new AudioContext(); const t0 = audio.currentTime;
      [[659, 0], [523, 0.22], [587, 0.44], [784, 0.66]].forEach(([f, dt]) => { const o = audio.createOscillator(), g = audio.createGain(); o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0, t0 + dt); g.gain.linearRampToValueAtTime(0.06, t0 + dt + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.6); o.connect(g).connect(audio.destination); o.start(t0 + dt); o.stop(t0 + dt + 0.7); });
    } catch (e) {} }
  function doorsStep(dt, px, pz) {
    for (const d of doors) {
      const dist = Math.hypot(px - d.x, pz - d.z), vis = dist < 160; if (vis !== d.vis) { d.vis = vis; if (d.show) d.show(vis); } // (far away: not drawn)
      const want = d.shop.open() && dist < (d.auto ? 2.4 : 1.9) ? 1 : 0;
      if (want && d.t === 0 && d.auto && d.shop.trade === 'konbini') chime();
      const t = Math.max(0, Math.min(1, d.t + (want ? 1 : -1) * dt / (d.auto ? 0.45 : 0.6)));
      if (t !== d.t) { d.t = t; d.move(t * t * (3 - 2 * t)); }
      if (d.block) d.block(d.shop.open() ? 0 : 1);
    }
  }

  // ---- who is in reach: the nearest thing the player faces
  const fwd = new THREE.Vector3();
  function update(pl, cam, dt = 0.016) {
    player = pl; near = null;
    const px = pl.pos.x, pz = pl.pos.z;
    doorsStep(dt, px, pz); interiorSigns(px, pz);
    here = shops.find(c => inBox(c.site.box, px, pz)) || null;
    // taken from the shelves and not paid: the shop's door does not let you out
    if (unpaidAt && unpaid().length && !inBox(unpaidAt.site.box, px, pz, 0.25)) {
      const b = unpaidAt.site.box, back = unpaidAt.site.inDoor; if (back) { pl.pos.x = back[0]; pl.pos.z = back[1]; }
      toastMsg('「お客様、お会計がまだです！」 — pay at the till first (' + yen(unpaidTotal()) + ')');
    }
    if (!unpaid().length) unpaidAt = null;
    if (ui.isOpen()) { ui.prompt(null); return; }
    cam.getWorldDirection(fwd);
    let bd = Infinity;
    for (const s of spots) {
      const dx = s.x - px, dz = s.z - pz, d = Math.hypot(dx, dz); if (d > s.r || d >= bd) continue;
      if (s.shop && s.shop.site && s.shop.site.box && !!inBox(s.shop.site.box, px, pz, 0.4) !== !s.outside) continue; // (a shop's own things from inside it)
      const tx = (s.tx ?? s.x) - px, tz = (s.tz ?? s.z) - pz, td = Math.hypot(tx, tz); if (td > 0.6 && (tx * fwd.x + tz * fwd.z) / td < 0.3) continue; // (facing it: the counter, the shelf)
      if (s.kind === 'bin' && !empties().length) continue;
      if (s.kind === 'custom' && !s.prompt()) continue;
      bd = d; near = s;
    }
    if (!near) { ui.prompt(null); return; }
    const c = near.shop, ok = !c || c.open();
    let html;
    if (near.kind === 'custom') html = near.prompt();
    else if (!ok) html = `<span class="shut">${c.title} — closed, opens ${hhmm(c.menu.hours[0])}</span>`;
    else if (near.kind === 'counter') html = `<b>E</b><span>${c.menu.serve === 'shelves' ? 'Shop' : 'Order'} — ${c.title}</span><span class="jp">${c.jp} · ${c.label}</span>`;
    else if (near.kind === 'shelf') html = `<b>E</b><span>${near.name}</span><span class="jp">${near.jp}</span>`;
    else if (near.kind === 'till') { const n = unpaid().length; html = `<b>E</b><span>${n ? 'Pay — ' + yen(unpaidTotal()) : 'Till'}</span><span class="jp">レジ</span>`; }
    else if (near.kind === 'vend') html = `<b>E</b><span>Vending machine</span><span class="jp">自動販売機${empties().length ? ' · recycling box' : ''}</span>`;
    else if (near.kind === 'bin') html = `<b>E</b><span>Throw away ${empties().length} empt${empties().length > 1 ? 'ies' : 'y'}</span><span class="jp">ゴミ箱</span>`;
    ui.prompt(html);
  }
  const STYLE = { board: 'board', card: 'card', case: 'case', tag: 'tag' };
  return {
    shops, spots, keepers, patrons, update, ui,
    // other things used with E (home.js: doors, the bed, the farm's plots and board): { kind: 'custom', x, z, r, tx?, tz?,
    // prompt() -> html (or null: not offered now), use() -> true when a panel opened }
    addSpots(list) { for (const s of list) spots.push(s); },
    set onGreet(f) { onGreet = f; },
    isOpen: () => ui.isOpen(),
    get inside() { return here; },
    // E: use what is in front of you (true: a panel opened)
    interact() {
      if (!near) return false; const c = near.shop;
      if (near.kind === 'custom') return !!near.use();
      if (c && !c.open()) return false;
      if (near.kind === 'bin') { const n = binEmpties(); if (n) toastMsg(n + ' empt' + (n > 1 ? 'ies' : 'y') + ' into the bin'); return false; }
      if (near.kind === 'vend') { ui.show('vend', c); return true; }
      if (near.kind === 'shelf') { unpaidAt = c; ui.show('shelf', { ...near, menu: c.menu }); return true; }
      if (near.kind === 'till') { ui.show('till', c); if (onGreet && c.keeper !== undefined) onGreet(c.keeper); return true; }
      // a counter: the trade's menu (a shop of shelves served at its door: its goods in a case)
      ui.show(c.menu.serve === 'shelves' ? 'case' : STYLE[c.menu.style] || 'card', c);
      if (onGreet && c.keeper !== undefined) onGreet(c.keeper);
      return true;
    },
    toggleBag() { if (ui.kind() === 'bag') { ui.close(); return false; } ui.show('bag'); return true; },
    close() { ui.close(); },
  };
}
