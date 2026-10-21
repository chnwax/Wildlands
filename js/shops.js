// Buying things: the shops' counters with their shopkeepers, the vending machines, and the two panels — the counter (E,
// where you can be served) and your bag (I or Tab: what you carry, eat or drink; the wallet; the boost you are on).
// Shops and their shopkeepers come from the town build (building.js SHOP_SITES): the konbini, the ramen shop, the soba
// and sushi counters, the izakaya, the café, the bakery, the sweet shop, the pharmacy and the liquor shop — each with its
// menu and its hours (items.js); a shop that is closed has nobody at the counter. Vending machines are the world's
// vending_machine objects and sell drinks at any hour.
import { THREE } from './core.js';
import { time } from './sky.js';
import { SHOP_NAMES } from './townkit.js';
import { SHOP_SITES } from './building.js';
import { ITEMS, MENUS, openAt, inv, buy, use, drop, yen, onInventory, boostLeft, slotsUsed, BAG, effectOf } from './items.js';

const css = `
#wlPrompt { position: fixed; left: 50%; bottom: 84px; transform: translateX(-50%); padding: 8px 14px; border-radius: 6px; background: rgba(9,12,14,.66);
  color: var(--fg); font-size: 13px; letter-spacing: .06em; pointer-events: none; opacity: 0; transition: opacity .2s; z-index: 7; backdrop-filter: blur(4px); white-space: nowrap; }
#wlPrompt b { color: var(--accent); margin-right: 6px; } #wlPrompt .shut { color: #e2a092; }
#wlWallet { margin-top: 4px; font-size: 13px; color: var(--fg); letter-spacing: .08em; } #wlWallet .bst { color: var(--accent); margin-left: 8px; font-size: 12px; }
.wlPanel { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(560px, 92vw); max-height: 82vh; overflow: auto; z-index: 20;
  background: rgba(10,13,15,.9); border: 1px solid rgba(242,239,230,.18); border-radius: 10px; padding: 18px 20px 14px; color: var(--fg); backdrop-filter: blur(8px);
  box-shadow: 0 20px 60px rgba(0,0,0,.5); display: none; font-size: 13px; }
.wlPanel.on { display: block; }
.wlPanel h3 { margin: 0; font-weight: 400; font-size: 18px; letter-spacing: .14em; } .wlPanel .wlSub { color: var(--dim); font-size: 12px; letter-spacing: .1em; margin: 2px 0 12px; }
.wlPanel .wlTop { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; } .wlPanel .cash { color: var(--accent); font-size: 15px; letter-spacing: .06em; }
.wlRow { display: grid; grid-template-columns: 34px 1fr auto auto; align-items: center; gap: 10px; padding: 7px 4px; border-top: 1px solid rgba(242,239,230,.08); }
.wlRow .ic { font-size: 22px; text-align: center; } .wlRow .nm small { display: block; color: var(--dim); font-size: 11px; letter-spacing: .06em; } .wlRow .pr { color: var(--fg); letter-spacing: .04em; }
.wlBtn { all: unset; cursor: pointer; padding: 5px 12px; border-radius: 5px; border: 1px solid rgba(217,181,106,.55); color: var(--fg); font-size: 12px; letter-spacing: .08em; text-align: center; }
.wlBtn:hover, .wlBtn:focus-visible { background: rgba(217,181,106,.18); border-color: var(--accent); } .wlBtn[disabled] { opacity: .35; pointer-events: none; }
.wlGrid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; margin: 6px 0 10px; }
.wlSlot { position: relative; aspect-ratio: 1; border-radius: 8px; background: rgba(242,239,230,.05); border: 1px solid rgba(242,239,230,.1); display: grid; place-items: center; font-size: 28px; cursor: pointer; }
.wlSlot:hover { border-color: var(--accent); background: rgba(217,181,106,.1); } .wlSlot .n { position: absolute; right: 5px; bottom: 3px; font-size: 11px; color: var(--fg); }
.wlSlot.empty { cursor: default; } .wlSlot.empty:hover { border-color: rgba(242,239,230,.1); background: rgba(242,239,230,.05); }
.wlInfo { min-height: 38px; color: var(--dim); font-size: 12px; letter-spacing: .04em; } .wlInfo b { color: var(--fg); font-weight: 500; }
.wlHint { color: var(--dim); font-size: 11px; letter-spacing: .1em; margin-top: 10px; text-align: right; }
`;

export function buildShops({ layer }) {
  if (!document.getElementById('wlShopCss')) { const st = document.createElement('style'); st.id = 'wlShopCss'; st.textContent = css; document.head.append(st); }
  const el = (tag, attrs = {}, parent = document.body) => { const e = document.createElement(tag); Object.assign(e, attrs); parent.append(e); return e; };
  const prompt = el('div', { id: 'wlPrompt' }), wallet = el('div', { id: 'wlWallet' }, document.getElementById('hud') || document.body);
  const shopP = el('div', { className: 'wlPanel', id: 'wlShop' }), bagP = el('div', { className: 'wlPanel', id: 'wlBag' });

  // ---- places to be served: the shops with a menu, and every vending machine
  const counters = [];
  for (const s of SHOP_SITES) {
    const menu = MENUS[s.trade]; if (!menu || s.closed || !s.door) continue;
    const nm = s.trade === 'konbini' ? ['コンビニ', 'Sunny Mart'] : SHOP_NAMES[s.trade];
    counters.push({ kind: 'shop', menu, site: s, x: s.door.x, z: s.door.z, r: 2.6, title: s.trade === 'konbini' ? 'Sunny Mart' : nm[1], jp: s.trade === 'konbini' ? 'コンビニ' : nm[0], label: menu.label });
  }
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  for (const ent of layer.ents.values()) {
    if (ent.prefab !== 'vending_machine') continue; const st = ent.state; if (st && (st.deleted || st.hidden)) continue;
    layer.matrixOf(ent, m).decompose(p, q, sc);
    counters.push({ kind: 'vend', menu: MENUS.vending, x: p.x, z: p.z, r: 1.7, title: 'Vending machine', jp: '自動販売機', label: 'Drinks' });
  }
  // the shopkeepers (pedestrians.js draws them): who stands where, dressed for the trade, there while the shop is open
  const APRON = { konbini: [0.2, 0.42, 0.72], 0: [0.12, 0.12, 0.14], 3: [0.18, 0.16, 0.2], 12: [0.2, 0.24, 0.3], 16: [0.95, 0.95, 0.93], 7: [0.35, 0.25, 0.18], 11: [0.92, 0.88, 0.8], 6: [0.5, 0.2, 0.22], 1: [0.95, 0.96, 0.98], 8: [0.25, 0.3, 0.45] };
  const WOMEN = new Set([7, 11, 6, 1]), keepers = [];
  for (const c of counters) {
    const s = c.site; if (!s || !s.keeper) continue; const t = s.trade, h = Math.abs(Math.floor(s.keeper.x * 7 + s.keeper.z * 13));
    keepers.push({ x: s.keeper.x, y: s.keeper.y, z: s.keeper.z, yaw: s.keeper.yaw, woman: WOMEN.has(t) || (t === 'konbini' && h % 2 === 0), shirt: APRON[t] || [0.3, 0.3, 0.32], open: () => openAt(c.menu, time.hour), counter: c, ground: !s.inside });
    c.keeper = keepers.length - 1;
  }

  // ---- the panels
  let open = null, onGreet = null;
  const hhmm = h => String(Math.floor(h) % 24).padStart(2, '0') + ':00';
  const row = (parent, it, btn, fn, ok = true) => {
    const r = el('div', { className: 'wlRow' }, parent);
    el('div', { className: 'ic', textContent: it.icon }, r);
    const nm = el('div', { className: 'nm', textContent: it.name }, r); el('small', { textContent: it.jp + ' · ' + effectOf(it).name.toLowerCase() + (it.here ? ' · eaten here' : '') }, nm);
    el('div', { className: 'pr', textContent: yen(it.price) }, r);
    const b = el('button', { className: 'wlBtn', textContent: btn }, r); b.disabled = !ok; b.addEventListener('click', e => { e.stopPropagation(); fn(); });
  };
  function drawShop() {
    const c = open.counter; shopP.innerHTML = '';
    const top = el('div', { className: 'wlTop' }, shopP); el('h3', { textContent: c.title }, top); el('div', { className: 'cash', textContent: yen(inv.yen) }, top);
    el('div', { className: 'wlSub', textContent: c.jp + ' · ' + c.label + (c.menu.greet ? '  —  「' + c.menu.greet + '」' : '') }, shopP);
    for (const id of c.menu.items) { const it = ITEMS[id]; row(shopP, it, it.here ? 'Eat' : 'Buy', () => { if (buy(id)) drawShop(); }, inv.yen >= it.price); }
    el('div', { className: 'wlHint', textContent: 'bag: ' + slotsUsed() + ' / ' + BAG.SLOTS + '   ·   E / Esc — leave' }, shopP);
  }
  function drawBag() {
    bagP.innerHTML = '';
    const top = el('div', { className: 'wlTop' }, bagP); el('h3', { textContent: 'Bag' }, top); el('div', { className: 'cash', textContent: yen(inv.yen) }, top);
    const left = boostLeft(); el('div', { className: 'wlSub', textContent: left > 0 ? inv.boost.icon + ' ' + inv.boost.name + ' — ' + Math.ceil(left / 60) + ' min left (quicker on your feet)' : 'Nothing eaten lately' }, bagP);
    const grid = el('div', { className: 'wlGrid' }, bagP), stacks = [];
    for (const [id, n] of Object.entries(inv.items)) for (let k = n; k > 0; k -= BAG.STACK) stacks.push([id, Math.min(k, BAG.STACK)]);
    const info = el('div', { className: 'wlInfo' }, bagP);
    for (let i = 0; i < BAG.SLOTS; i++) {
      const s = stacks[i], slot = el('div', { className: 'wlSlot' + (s ? '' : ' empty') }, grid);
      if (!s) continue; const it = ITEMS[s[0]];
      slot.textContent = it.icon; el('span', { className: 'n', textContent: s[1] > 1 ? s[1] : '' }, slot);
      slot.title = it.name;
      slot.addEventListener('mouseenter', () => { info.innerHTML = `<b>${it.name}</b> ${it.jp} — ${effectOf(it).name.toLowerCase()} (${Math.round(effectOf(it).fx * 100)}% quicker for ${Math.round(effectOf(it).t / 60)} min). Click: ${it.kind === 'drink' || it.kind === 'coffee' ? 'drink' : 'eat'} · right-click: throw away`; });
      slot.addEventListener('click', () => { use(s[0]); drawBag(); });
      slot.addEventListener('contextmenu', e => { e.preventDefault(); drop(s[0]); drawBag(); });
    }
    if (!stacks.length) info.textContent = 'Empty. Konbini, shops and vending machines sell food and drinks.';
    el('div', { className: 'wlHint', textContent: stacks.length + ' / ' + BAG.SLOTS + ' slots   ·   I / Tab / Esc — close' }, bagP);
  }
  const showWallet = () => { const left = boostLeft(); wallet.innerHTML = yen(inv.yen) + (left > 0 ? `<span class="bst">${inv.boost.icon} ${inv.boost.name}</span>` : ''); };
  onInventory(() => { showWallet(); if (open && open.kind === 'bag') drawBag(); });
  showWallet();

  // ---- who is in reach: the nearest counter the player faces, within its reach
  let near = null;
  const fwd = new THREE.Vector3();
  function update(player, cam) {
    near = null;
    if (open) { prompt.style.opacity = 0; return; }
    cam.getWorldDirection(fwd);
    let bd = Infinity;
    for (const c of counters) {
      const dx = c.x - player.pos.x, dz = c.z - player.pos.z, d = Math.hypot(dx, dz); if (d > c.r || d >= bd) continue;
      if (d > 0.6 && (dx * fwd.x + dz * fwd.z) / d < 0.35) continue; // (facing it)
      bd = d; near = c;
    }
    if (near) {
      const ok = openAt(near.menu, time.hour);
      prompt.innerHTML = ok ? `<b>E</b>${near.title} <span style="opacity:.6">${near.jp} · ${near.label}</span>` : `<span class="shut">${near.title} — closed, opens ${hhmm(near.menu.hours[0])}</span>`;
      prompt.style.opacity = 1;
    } else prompt.style.opacity = 0;
    if (!(Math.floor(performance.now() / 1000) % 5)) showWallet(); // (the boost wears off)
  }
  return {
    counters, keepers, update,
    set onGreet(f) { onGreet = f; },
    isOpen: () => !!open,
    // E: be served where you stand (true: a panel opened)
    interact() { if (!near || !openAt(near.menu, time.hour)) return false; open = { kind: 'shop', counter: near }; drawShop(); shopP.classList.add('on'); if (onGreet && near.keeper !== undefined) onGreet(near.keeper); return true; },
    toggleBag() { if (open && open.kind === 'bag') { this.close(); return false; } if (open) this.close(); open = { kind: 'bag' }; drawBag(); bagP.classList.add('on'); return true; },
    close() { open = null; shopP.classList.remove('on'); bagP.classList.remove('on'); },
  };
}
