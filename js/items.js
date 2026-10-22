// Things to buy, carry, eat and drink; how they are carried; the wallet and what a meal or a drink does for you.
//
// Carrying: two hands of five fingers. Everything takes a few fingers at the least to be held (f): a rice ball three,
// a can four, a bento box both hands. What one hand can hold (up to five fingers) is held in one hand; a thing that
// needs more takes a whole hand and some of the other. Bags hold more: a worn bag (a daypack: no fingers) and carried
// ones (a konbini's plastic bag: its handles take two fingers) are grids of cells, and each thing in one takes its own
// rectangle (sz: [w, h] cells, turned either way). Drinks leave their can or bottle in your hand once drunk — empties go
// in a bin (by every vending machine, at the konbini, in the parks). Things taken from a shop's shelves are carried
// unpaid until the till.
// Eating and drinking give a short boost — refreshed (a drink), energised (coffee, an energy drink), a snack, well fed (a
// meal) — that makes walking and running a little quicker for a few minutes; boosts do not stack, the strongest counts.
// The wallet and everything carried are kept on this computer (localStorage).
import { toastMsg } from './ui.js';

// kind: drink | coffee | snack | meal | dessert ; fx: speed boost while it lasts ; t: how long (seconds)
const FX = { drink: { name: 'Refreshed', jp: '爽快', fx: 0.08, t: 150 }, coffee: { name: 'Energised', jp: '元気', fx: 0.16, t: 240 }, snack: { name: 'Snack', jp: '小腹', fx: 0.06, t: 150 },
  dessert: { name: 'Sweet tooth', jp: '甘味', fx: 0.07, t: 180 }, meal: { name: 'Well fed', jp: '満腹', fx: 0.12, t: 420 } };
// f: fingers to hold it; sz: cells in a bag; empty: what is left once drunk; here: served and eaten where it is sold;
// grid: a bag's cells (wear: on the back, no fingers); look: how its picture is drawn (icons.js)
export const ITEMS = {
  // drinks (vending machines, konbini, pharmacy, the liquor shop)
  water: { name: 'Mineral water', jp: '天然水', kind: 'drink', price: 110, f: 4, sz: [1, 3], empty: 'pet_e', look: ['pet', '#dfeef7', '#7cc4e8', '#3a8fc9'] },
  greentea: { name: 'Green tea', jp: 'お茶', kind: 'drink', price: 140, f: 4, sz: [1, 3], empty: 'pet_e', look: ['pet', '#2f7a3b', '#b9cf6a', '#2f7a3b'] },
  mugicha: { name: 'Barley tea', jp: '麦茶', kind: 'drink', price: 130, f: 4, sz: [1, 3], empty: 'pet_e', look: ['pet', '#c9762b', '#b8792e', '#f0d38a'] },
  coffeecan: { name: 'Canned coffee', jp: '缶コーヒー', kind: 'coffee', price: 130, f: 3, sz: [1, 2], empty: 'can_e', look: ['can', '#3b2a22', '#c8a26a', 'BOSS'] },
  milktea: { name: 'Royal milk tea', jp: 'ミルクティー', kind: 'drink', price: 150, f: 4, sz: [1, 3], empty: 'pet_e', look: ['pet', '#e9e2d0', '#d6b48a', '#8a4b2a'] },
  cola: { name: 'Cola', jp: 'コーラ', kind: 'drink', price: 160, f: 4, sz: [1, 2], empty: 'can_e', look: ['can', '#c8202c', '#f4f1ea', 'COLA'] },
  sports: { name: 'Sports drink', jp: 'スポーツドリンク', kind: 'drink', price: 150, f: 4, sz: [1, 3], empty: 'pet_e', look: ['pet', '#1f5fb8', '#e8f3fb', '#1f5fb8'] },
  orange: { name: 'Orange juice', jp: 'オレンジ', kind: 'drink', price: 140, f: 4, sz: [1, 2], empty: 'can_e', look: ['can', '#f08a1c', '#fff3c4', 'Qoo'] },
  ramune: { name: 'Ramune', jp: 'ラムネ', kind: 'drink', price: 200, f: 3, sz: [1, 2], empty: 'bottle_e', look: ['ramune'] },
  energy: { name: 'Energy drink', jp: '栄養ドリンク', kind: 'coffee', price: 280, f: 2, sz: [1, 1], empty: 'bottle_e', look: ['vial'] },
  // konbini
  onigiri_salmon: { name: 'Onigiri (salmon)', jp: '鮭おにぎり', kind: 'snack', price: 160, f: 3, sz: [2, 2], look: ['onigiri', '#f08a6a'] },
  onigiri_tuna: { name: 'Onigiri (tuna mayo)', jp: 'ツナマヨ', kind: 'snack', price: 150, f: 3, sz: [2, 2], look: ['onigiri', '#efe2b0'] },
  sando: { name: 'Egg sandwich', jp: 'たまごサンド', kind: 'snack', price: 320, f: 3, sz: [2, 2], look: ['sando'] },
  bento: { name: 'Karaage bento', jp: '唐揚げ弁当', kind: 'meal', price: 550, f: 10, sz: [4, 3], look: ['bento'] },
  nikuman: { name: 'Nikuman', jp: '肉まん', kind: 'snack', price: 180, f: 3, sz: [2, 2], look: ['bun', '#f6f1e6', 'pleat'] },
  karaagekun: { name: 'Karaage-kun', jp: 'からあげクン', kind: 'snack', price: 240, f: 3, sz: [1, 2], look: ['cupbox'] },
  pocky: { name: 'Pocky', jp: 'ポッキー', kind: 'dessert', price: 180, f: 2, sz: [1, 3], look: ['pocky'] },
  icecream: { name: 'Ice cream', jp: 'アイス', kind: 'dessert', price: 150, f: 2, sz: [1, 2], look: ['icebar'] },
  jelly: { name: 'Vitamin jelly', jp: 'ゼリー飲料', kind: 'snack', price: 200, f: 3, sz: [1, 2], look: ['pouch'] },
  // bakery and sweets
  melonpan: { name: 'Melon pan', jp: 'メロンパン', kind: 'snack', price: 180, f: 4, sz: [2, 2], look: ['bun', '#f2cf6b', 'grid'] },
  currypan: { name: 'Curry pan', jp: 'カレーパン', kind: 'snack', price: 220, f: 3, sz: [2, 2], look: ['currypan'] },
  anpan: { name: 'Anpan', jp: 'あんパン', kind: 'snack', price: 160, f: 3, sz: [2, 2], look: ['bun', '#b8682e', 'sesame'] },
  croissant: { name: 'Croissant', jp: 'クロワッサン', kind: 'snack', price: 200, f: 3, sz: [3, 2], look: ['croissant'] },
  dango: { name: 'Dango', jp: 'だんご', kind: 'dessert', price: 300, f: 2, sz: [1, 3], look: ['dango'] },
  daifuku: { name: 'Daifuku', jp: '大福', kind: 'dessert', price: 250, f: 2, sz: [1, 1], look: ['daifuku'] },
  dorayaki: { name: 'Dorayaki', jp: 'どら焼き', kind: 'dessert', price: 220, f: 3, sz: [2, 2], look: ['dorayaki'] },
  taiyaki: { name: 'Taiyaki', jp: 'たい焼き', kind: 'dessert', price: 200, f: 2, sz: [3, 1], look: ['taiyaki'] },
  // dishes eaten where they are served
  shoyu: { name: 'Shoyu ramen', jp: '醤油ラーメン', kind: 'meal', price: 850, here: true, look: ['bowl', '#9a5a26', 'ramen'] },
  tonkotsu: { name: 'Tonkotsu ramen', jp: '豚骨ラーメン', kind: 'meal', price: 950, here: true, look: ['bowl', '#ecdcc0', 'ramen'] },
  miso: { name: 'Miso ramen', jp: '味噌ラーメン', kind: 'meal', price: 900, here: true, look: ['bowl', '#c98a3a', 'ramen'] },
  gyoza: { name: 'Gyoza (6)', jp: '餃子', kind: 'snack', price: 400, here: true, look: ['gyoza'] },
  chahan: { name: 'Fried rice', jp: 'チャーハン', kind: 'meal', price: 650, here: true, look: ['chahan'] },
  zarusoba: { name: 'Zaru soba', jp: 'ざるそば', kind: 'meal', price: 750, here: true, look: ['zaru'] },
  tenudon: { name: 'Tempura udon', jp: '天ぷらうどん', kind: 'meal', price: 950, here: true, look: ['bowl', '#d9b37a', 'tempura'] },
  kitsune: { name: 'Kitsune udon', jp: 'きつねうどん', kind: 'meal', price: 800, here: true, look: ['bowl', '#d9b37a', 'kitsune'] },
  nigiri: { name: 'Nigiri set', jp: 'にぎり寿司', kind: 'meal', price: 1800, here: true, look: ['nigiri'] },
  maki: { name: 'Maki rolls', jp: '巻き寿司', kind: 'meal', price: 900, here: true, look: ['maki'] },
  yakitori: { name: 'Yakitori (5)', jp: '焼き鳥', kind: 'meal', price: 700, here: true, look: ['yakitori'] },
  edamame: { name: 'Edamame', jp: '枝豆', kind: 'snack', price: 350, here: true, look: ['edamame'] },
  karaage: { name: 'Karaage', jp: '唐揚げ', kind: 'meal', price: 600, here: true, look: ['karaage'] },
  oolong: { name: 'Oolong tea', jp: 'ウーロン茶', kind: 'drink', price: 300, here: true, look: ['glass', '#a4561e'] },
  blend: { name: 'Blend coffee', jp: 'ブレンド', kind: 'coffee', price: 450, here: true, look: ['coffee', '#3b2418'] },
  matcha: { name: 'Matcha latte', jp: '抹茶ラテ', kind: 'coffee', price: 550, here: true, look: ['coffee', '#8fb052'] },
  cake: { name: 'Shortcake', jp: 'ショートケーキ', kind: 'dessert', price: 500, here: true, look: ['cake'] },
  toast: { name: 'Toast set', jp: 'モーニング', kind: 'meal', price: 600, here: true, look: ['toast'] },
  // bags
  daypack: { name: 'Daypack', jp: 'デイパック', kind: 'bag', price: 3980, wear: true, grid: [8, 6], look: ['daypack', '#2f4a63'] },
  sacoche: { name: 'Sacoche', jp: 'サコッシュ', kind: 'bag', price: 1980, wear: true, grid: [5, 3], look: ['sacoche', '#7a5a3a'] },
  bag: { name: 'Plastic bag', jp: 'レジ袋', kind: 'bag', price: 3, f: 2, grid: [5, 4], fold: [1, 1], look: ['plasticbag'] },
  // what is left
  can_e: { name: 'Empty can', jp: '空き缶', kind: 'trash', price: 0, f: 2, sz: [1, 2], look: ['emptycan'] },
  pet_e: { name: 'Empty bottle', jp: '空のペットボトル', kind: 'trash', price: 0, f: 2, sz: [1, 3], look: ['emptypet'] },
  bottle_e: { name: 'Empty glass bottle', jp: '空きびん', kind: 'trash', price: 0, f: 2, sz: [1, 2], look: ['emptybottle'] },
};
for (const [id, it] of Object.entries(ITEMS)) it.id = id;

// what each shop sells (trades as townkit.js SHOP_NAMES numbers them; konbini and vending by name), its hours, how it
// serves (counter: ordered from the shopkeeper; shelves: taken from the shelves and paid at the till) and its greeting
export const MENUS = {
  konbini: { label: 'Convenience store', hours: [0, 24], serve: 'shelves', greet: 'いらっしゃいませー！', thanks: 'ありがとうございましたー！',
    items: ['onigiri_salmon', 'onigiri_tuna', 'sando', 'bento', 'nikuman', 'karaagekun', 'pocky', 'icecream', 'jelly', 'greentea', 'water', 'coffeecan', 'cola', 'milktea', 'sports', 'orange', 'energy'],
    till: ['nikuman', 'karaagekun', 'bag'] },
  vending: { label: 'Vending machine', hours: [0, 24], serve: 'machine', items: ['greentea', 'water', 'coffeecan', 'cola', 'sports', 'orange', 'milktea', 'mugicha'] },
  0: { label: 'Ramen', hours: [11, 23], serve: 'counter', style: 'board', greet: 'へい、らっしゃい！', thanks: 'まいど！', items: ['shoyu', 'tonkotsu', 'miso', 'gyoza', 'chahan', 'oolong'] },
  1: { label: 'Pharmacy', hours: [9, 21], serve: 'shelves', greet: 'いらっしゃいませ。', thanks: 'お大事に。', items: ['energy', 'jelly', 'sports', 'water', 'greentea', 'pocky'], till: ['bag'] },
  3: { label: 'Izakaya', hours: [17, 24], serve: 'counter', style: 'board', greet: 'いらっしゃい！', thanks: 'ありがとうございました！', items: ['yakitori', 'edamame', 'karaage', 'oolong'] },
  6: { label: 'Japanese sweets', hours: [9, 19], serve: 'counter', style: 'case', greet: 'いらっしゃいませ。', thanks: 'ありがとうございます。', items: ['dango', 'daifuku', 'dorayaki', 'taiyaki', 'greentea'] },
  7: { label: 'Café', hours: [8, 20], serve: 'counter', style: 'card', greet: 'いらっしゃいませ。', thanks: 'ありがとうございました。', items: ['blend', 'matcha', 'cake', 'toast'] },
  8: { label: 'Liquor & drinks', hours: [10, 21], serve: 'shelves', greet: 'まいど！', thanks: 'まいどあり！', items: ['ramune', 'orange', 'mugicha', 'cola', 'greentea', 'coffeecan', 'water'], till: ['bag'] },
  11: { label: 'Bakery', hours: [7, 19], serve: 'counter', style: 'case', greet: 'いらっしゃいませ！', thanks: 'ありがとうございます！', items: ['melonpan', 'currypan', 'anpan', 'croissant', 'coffeecan'] },
  12: { label: 'Soba & udon', hours: [11, 21], serve: 'counter', style: 'board', greet: 'いらっしゃい！', thanks: 'ありがとうございました。', items: ['zarusoba', 'tenudon', 'kitsune', 'greentea'] },
  15: { label: 'Cycles & bags', hours: [10, 19], serve: 'counter', style: 'tag', greet: 'いらっしゃいませ。', thanks: 'ありがとうございました。', items: ['daypack', 'sacoche', 'sports', 'water'] },
  16: { label: 'Sushi', hours: [11, 22], serve: 'counter', style: 'board', greet: 'へい、らっしゃい！', thanks: 'まいど！', items: ['nigiri', 'maki', 'greentea'] },
};
export const openAt = (menu, h) => { const [a, b] = menu.hours; return a <= b ? h >= a && h < b : h >= a || h < b; };
export const effectOf = it => FX[it.kind];
export const yen = n => '¥' + n.toLocaleString('ja-JP');
export const isDrink = it => it.kind === 'drink' || it.kind === 'coffee';

// ---------------------------------------------------------------- what is carried
// an entry: { id, k (its own key), paid (false: taken from a shelf, not paid yet), x, y, rot (where in a bag),
// items (a bag's contents) }. Hands: the entries held, in the order taken. worn: the bag on your back (or null).
const KEY = 'wl_inventory', START_YEN = 10000;
export const inv = { yen: START_YEN, hands: [], worn: null, boost: null };
let nextK = 1;
const entry = (id, paid = true) => ({ id, k: nextK++, paid });
const listeners = new Set();
export const onInventory = fn => listeners.add(fn);
const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ v: 2, yen: inv.yen, hands: inv.hands, worn: inv.worn })); } catch (e) {} };
const changed = () => { save(); for (const f of listeners) f(); };

// ---- hands: which hand holds what (an item of up to five fingers in one hand; more: a whole hand and the rest in the
// other); null when they cannot all be held. Returns per entry { hand: 0 right | 1 left, f: [fingers in right, left] }.
export const fingersOf = e => { const it = ITEMS[e.id]; return it.f || (it.wear ? 4 : 2); }; // (a worn bag taken off: carried by its straps)
export function handsFit(list) {
  const f = list.map(fingersOf), order = f.map((_, i) => i).sort((a, b) => f[b] - f[a]), out = new Array(list.length), cap = [5, 5];
  const go = q => {
    if (q === order.length) return true;
    const i = order[q], n = f[i];
    if (n > 10) return false;
    const opts = n > 5 ? [[5, n - 5], [n - 5, 5]] : [[n, 0], [0, n]];
    for (const [r, l] of opts) { if (r > cap[0] || l > cap[1]) continue; cap[0] -= r; cap[1] -= l; out[i] = { hand: r >= l ? 0 : 1, f: [r, l] }; if (go(q + 1)) return true; cap[0] += r; cap[1] += l; }
    return false;
  };
  return go(0) ? out : null;
}
export const fingersUsed = () => inv.hands.reduce((n, e) => n + fingersOf(e), 0);
// ---- bags: the worn one and the carried ones (held entries with a grid)
export const bagsOf = () => [...(inv.worn ? [inv.worn] : []), ...inv.hands.filter(e => ITEMS[e.id].grid)];
export const sizeOf = (e, rot = e.rot) => { const it = ITEMS[e.id], s = it.grid ? it.fold || [2, 2] : it.sz || [1, 1]; return rot ? [s[1], s[0]] : s; };
export function cellsFree(bag, w, h, x, y, skip = null) {
  const [W, H] = ITEMS[bag.id].grid; if (x < 0 || y < 0 || x + w > W || y + h > H) return false;
  for (const o of bag.items) { if (o === skip) continue; const [ow, oh] = sizeOf(o); if (x < o.x + ow && o.x < x + w && y < o.y + oh && o.y < y + h) return false; }
  return true;
}
// the first place an entry fits in a bag (either way round): {x, y, rot} or null
export function fitIn(bag, e) {
  const [W, H] = ITEMS[bag.id].grid, it = ITEMS[e.id];
  if (it.grid && e.items && e.items.length) return null; // (a bag with things in it is not packed away)
  if (it.wear) return null;
  for (const rot of [0, 1]) { const [w, h] = sizeOf(e, rot); for (let y = 0; y + h <= H; y++) for (let x = 0; x + w <= W; x++) if (cellsFree(bag, w, h, x, y)) return { x, y, rot }; }
  return null;
}
// where an entry is: { in: 'hands' | bag entry, i }
export function whereIs(k) {
  const h = inv.hands.findIndex(e => e.k === k); if (h >= 0) return { in: 'hands', e: inv.hands[h] };
  for (const b of bagsOf()) { const i = b.items.findIndex(e => e.k === k); if (i >= 0) return { in: b, e: b.items[i] }; }
  return null;
}
export const allEntries = () => { const out = []; for (const e of inv.hands) { out.push(e); if (e.items) out.push(...e.items); } if (inv.worn) out.push(...inv.worn.items); return out; };
const takeOut = k => { const w = whereIs(k); if (!w) return null; const L = w.in === 'hands' ? inv.hands : w.in.items; L.splice(L.indexOf(w.e), 1); delete w.e.x; delete w.e.y; delete w.e.rot; return w.e; };
// put an entry away: into a bag first (the worn one, then those carried), else into the hands; false if nowhere
function stow(e, prefer = 'bag') {
  const it = ITEMS[e.id];
  if (it.wear) { if (inv.worn) return false; inv.worn = { ...e, items: e.items || [] }; return true; }
  if (prefer === 'bag') for (const b of bagsOf()) { if (b === e) continue; const p = fitIn(b, e); if (p) { Object.assign(e, p); b.items.push(e); return true; } }
  if (handsFit([...inv.hands, e])) { inv.hands.push(e); return true; }
  if (prefer !== 'bag') for (const b of bagsOf()) { if (b === e) continue; const p = fitIn(b, e); if (p) { Object.assign(e, p); b.items.push(e); return true; } }
  return false;
}
// could it be carried (without carrying it)
export function canCarry(id) { const e = entry(id); nextK--; if (ITEMS[id].grid) e.items = []; if (ITEMS[id].wear) return !inv.worn; if (bagsOf().some(b => fitIn(b, e))) return true; return !!handsFit([...inv.hands, e]); }
export const why = id => ITEMS[id].wear && inv.worn ? 'You already carry a ' + ITEMS[inv.worn.id].name.toLowerCase() : 'Your hands are full' + (bagsOf().length ? ' and your bags too' : '') + ' — ' + ITEMS[id].f + ' fingers needed';

// ---- moving things about (the bag panel): into hands, into a bag at a cell, turned
export function toHands(k) { const w = whereIs(k); if (!w || w.in === 'hands') return false; const e = w.e;
  if (!handsFit([...inv.hands, e])) { toastMsg('Not enough free fingers (' + fingersOf(e) + ' needed)'); return false; }
  takeOut(k); inv.hands.push(e); changed(); return true; }
export function toBag(k, bagK, x, y, rot) {
  const w = whereIs(k); if (!w) return false; const e = w.e, bag = bagK === 'worn' ? inv.worn : inv.hands.find(b => b.k === bagK); if (!bag || bag === e) return false;
  if (ITEMS[e.id].grid && e.items && e.items.length) { toastMsg('Empty the bag first'); return false; }
  const [sw, sh] = sizeOf(e, rot); if (!cellsFree(bag, sw, sh, x, y, e)) return false;
  takeOut(k); Object.assign(e, { x, y, rot }); bag.items.push(e); changed(); return true; }
// the worn bag taken off (into the hands, if they can hold it: four fingers) or put on
export function wear(k) { const w = whereIs(k); if (!w || !ITEMS[w.e.id].wear || inv.worn) return false; takeOut(k); inv.worn = { ...w.e, items: w.e.items || [] }; changed(); return true; }

// ---- money earned and spent elsewhere (the farm: home.js)
export function earn(n) { inv.yen += Math.round(n); changed(); }
export function spend(n) { if (inv.yen < n) { toastMsg('Not enough money'); return false; } inv.yen -= Math.round(n); changed(); return true; }
// ---- shopping
// buy one at a counter or a machine: eaten at once when served here, otherwise put away (a bag first); false if not
export function buy(id) {
  const it = ITEMS[id]; if (!it) return false;
  if (inv.yen < it.price) { toastMsg('Not enough money'); return false; }
  if (!it.here && !canCarry(id)) { toastMsg(why(id)); return false; }
  inv.yen -= it.price;
  if (it.here) consume(it);
  else { const e = entry(id); if (it.grid) e.items = []; stow(e); toastMsg(it.name + (it.wear ? ' — on your back' : '')); }
  changed(); return true;
}
// take one from a shop's shelf (carried unpaid: the till takes the money), and put one back
export function take(id) {
  const it = ITEMS[id]; if (!it) return false;
  if (!canCarry(id)) { toastMsg(why(id)); return false; }
  const e = entry(id, false); stow(e, 'hands'); changed(); return true;
}
export function putBack(k) { const w = whereIs(k); if (!w || w.e.paid) return false; takeOut(k); changed(); return true; }
export const unpaid = () => allEntries().filter(e => e.paid === false);
export const unpaidTotal = () => unpaid().reduce((n, e) => n + ITEMS[e.id].price, 0);
// the till: everything unpaid paid for (and a bag bought, the unpaid things packed into it where they fit)
export function payAll(withBag = false) {
  const U = unpaid(), total = U.reduce((n, e) => n + ITEMS[e.id].price, 0) + (withBag ? ITEMS.bag.price : 0);
  if (!U.length) return false;
  if (inv.yen < total) { toastMsg('Not enough money'); return false; }
  inv.yen -= total; for (const e of U) e.paid = true;
  if (withBag) { // (the shopkeeper packs it: the things paid for, out of the hands into the new bag; the bag's handles in a hand)
    const b = entry('bag'); b.items = [];
    for (const e of U) { const w = whereIs(e.k); if (!w || w.in !== 'hands') continue; const p = fitIn(b, e); if (p) { takeOut(e.k); Object.assign(e, p); b.items.push(e); } }
    if (!stow(b, 'hands')) { for (const e of b.items.splice(0)) inv.hands.push(e); inv.yen += ITEMS.bag.price; toastMsg('No free fingers for a bag'); }
  }
  changed(); return total;
}
// ---- eating, drinking, throwing away
// eat or drink one (from the hands, or out of a bag when there are fingers free to hold it); a drink leaves its empty
export function use(k) {
  const w = whereIs(k); if (!w) return false; const e = w.e, it = ITEMS[e.id];
  if (!FX[it.kind]) return false;
  if (e.paid === false) { toastMsg('Pay for it first'); return false; }
  if (w.in !== 'hands' && !handsFit([...inv.hands, e])) { toastMsg('Your hands are full'); return false; }
  takeOut(k); consume(it);
  if (it.empty) { const em = entry(it.empty); if (!stow(em, 'hands')) inv.hands.push(em); }
  changed(); return true;
}
// thrown away (in a bin: the caller knows one is near)
export function discard(k) { const w = whereIs(k); if (!w) return false; if (w.e.paid === false) { toastMsg('Put it back on the shelf'); return false; } takeOut(k); changed(); return true; }
export const empties = () => allEntries().filter(e => ITEMS[e.id].kind === 'trash');
export function binEmpties() { const E = empties(); for (const e of E) takeOut(e.k); if (E.length) changed(); return E.length; }
function consume(it) {
  const f = FX[it.kind], now = performance.now();
  if (!inv.boost || now > inv.boost.until || f.fx >= inv.boost.fx) inv.boost = { name: f.name, jp: f.jp, fx: f.fx, until: now + f.t * 1000, id: it.id };
  toastMsg((isDrink(it) ? 'Drank ' : 'Ate ') + it.name.toLowerCase() + ' — ' + f.name.toLowerCase());
}
// the speed factor of the boost now (1 without one)
export function boostNow() { if (!inv.boost) return 1; if (performance.now() > inv.boost.until) { inv.boost = null; for (const f of listeners) f(); return 1; } return 1 + inv.boost.fx; }
export const boostLeft = () => inv.boost ? Math.max(0, (inv.boost.until - performance.now()) / 1000) : 0;

// ---- loaded from this computer (the old stacks of a bag of slots: each thing put away again where it fits)
try {
  const s = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (s && typeof s.yen === 'number') {
    inv.yen = s.yen;
    const fix = e => { e.k = nextK++; if (e.items) e.items.forEach(fix); };
    if (s.v === 2) { inv.hands = (s.hands || []).filter(e => ITEMS[e.id]); inv.worn = s.worn && ITEMS[s.worn.id] ? s.worn : null; inv.hands.forEach(fix); if (inv.worn) { fix(inv.worn); inv.worn.items = inv.worn.items.filter(e => ITEMS[e.id]); } for (const b of bagsOf()) b.items = (b.items || []).filter(e => ITEMS[e.id]); }
    else if (s.items) for (const [id, n] of Object.entries(s.items)) for (let i = 0; i < n && ITEMS[id]; i++) if (!stow(entry(id))) break;
    // (nothing left unpaid from a shop the game was closed in)
    for (const e of allEntries()) if (e.paid === false) takeOut(e.k);
  }
} catch (e) {}
