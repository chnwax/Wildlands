// Things to buy, carry and eat or drink, the wallet, and what a meal or a drink does for you.
// The inventory holds stacks of items and the yen in the wallet; it is kept on this computer (localStorage). Eating and
// drinking give a short boost — refreshed (a drink), energised (coffee, an energy drink), a snack, well fed (a meal) —
// that makes walking and running a little quicker for a few minutes; boosts do not stack, the strongest one counts.
import { toastMsg } from './ui.js';

// kind: drink | coffee | snack | meal | dessert ; fx: speed boost while it lasts ; t: how long (seconds)
const FX = { drink: { name: 'Refreshed', fx: 0.08, t: 150 }, coffee: { name: 'Energised', fx: 0.16, t: 240 }, snack: { name: 'Snack', fx: 0.06, t: 150 },
  dessert: { name: 'Sweet tooth', fx: 0.07, t: 180 }, meal: { name: 'Well fed', fx: 0.12, t: 420 } };
export const ITEMS = {
  // drinks (vending machines, konbini, pharmacy, the liquor shop)
  water: { name: 'Mineral water', jp: '天然水', icon: '💧', kind: 'drink', price: 110 },
  greentea: { name: 'Green tea', jp: 'お茶', icon: '🍵', kind: 'drink', price: 140 },
  mugicha: { name: 'Barley tea', jp: '麦茶', icon: '🍵', kind: 'drink', price: 130 },
  coffeecan: { name: 'Canned coffee', jp: '缶コーヒー', icon: '☕', kind: 'coffee', price: 130 },
  milktea: { name: 'Royal milk tea', jp: 'ミルクティー', icon: '🧋', kind: 'drink', price: 150 },
  cola: { name: 'Cola', jp: 'コーラ', icon: '🥤', kind: 'drink', price: 160 },
  sports: { name: 'Sports drink', jp: 'スポーツドリンク', icon: '🧃', kind: 'drink', price: 150 },
  orange: { name: 'Orange juice', jp: 'オレンジ', icon: '🧃', kind: 'drink', price: 140 },
  ramune: { name: 'Ramune', jp: 'ラムネ', icon: '🍾', kind: 'drink', price: 200 },
  energy: { name: 'Energy drink', jp: '栄養ドリンク', icon: '⚡', kind: 'coffee', price: 280 },
  // konbini
  onigiri_salmon: { name: 'Onigiri (salmon)', jp: '鮭おにぎり', icon: '🍙', kind: 'snack', price: 160 },
  onigiri_tuna: { name: 'Onigiri (tuna mayo)', jp: 'ツナマヨ', icon: '🍙', kind: 'snack', price: 150 },
  sando: { name: 'Egg sandwich', jp: 'たまごサンド', icon: '🥪', kind: 'snack', price: 320 },
  bento: { name: 'Karaage bento', jp: '唐揚げ弁当', icon: '🍱', kind: 'meal', price: 550 },
  nikuman: { name: 'Nikuman', jp: '肉まん', icon: '🥟', kind: 'snack', price: 180 },
  karaagekun: { name: 'Karaage-kun', jp: 'からあげクン', icon: '🍗', kind: 'snack', price: 240 },
  pocky: { name: 'Pocky', jp: 'ポッキー', icon: '🍫', kind: 'dessert', price: 180 },
  icecream: { name: 'Ice cream', jp: 'アイス', icon: '🍦', kind: 'dessert', price: 150 },
  jelly: { name: 'Vitamin jelly', jp: 'ゼリー飲料', icon: '🧴', kind: 'snack', price: 200 },
  // bakery and sweets
  melonpan: { name: 'Melon pan', jp: 'メロンパン', icon: '🍈', kind: 'snack', price: 180 },
  currypan: { name: 'Curry pan', jp: 'カレーパン', icon: '🥐', kind: 'snack', price: 220 },
  anpan: { name: 'Anpan', jp: 'あんパン', icon: '🍞', kind: 'snack', price: 160 },
  croissant: { name: 'Croissant', jp: 'クロワッサン', icon: '🥐', kind: 'snack', price: 200 },
  dango: { name: 'Dango', jp: 'だんご', icon: '🍡', kind: 'dessert', price: 300 },
  daifuku: { name: 'Daifuku', jp: '大福', icon: '🍘', kind: 'dessert', price: 250 },
  dorayaki: { name: 'Dorayaki', jp: 'どら焼き', icon: '🥞', kind: 'dessert', price: 220 },
  taiyaki: { name: 'Taiyaki', jp: 'たい焼き', icon: '🐟', kind: 'dessert', price: 200 },
  // dishes eaten where they are served
  shoyu: { name: 'Shoyu ramen', jp: '醤油ラーメン', icon: '🍜', kind: 'meal', price: 850, here: true },
  tonkotsu: { name: 'Tonkotsu ramen', jp: '豚骨ラーメン', icon: '🍜', kind: 'meal', price: 950, here: true },
  miso: { name: 'Miso ramen', jp: '味噌ラーメン', icon: '🍜', kind: 'meal', price: 900, here: true },
  gyoza: { name: 'Gyoza (6)', jp: '餃子', icon: '🥟', kind: 'snack', price: 400, here: true },
  chahan: { name: 'Fried rice', jp: 'チャーハン', icon: '🍚', kind: 'meal', price: 650, here: true },
  zarusoba: { name: 'Zaru soba', jp: 'ざるそば', icon: '🍜', kind: 'meal', price: 750, here: true },
  tenudon: { name: 'Tempura udon', jp: '天ぷらうどん', icon: '🍤', kind: 'meal', price: 950, here: true },
  kitsune: { name: 'Kitsune udon', jp: 'きつねうどん', icon: '🍜', kind: 'meal', price: 800, here: true },
  nigiri: { name: 'Nigiri set', jp: 'にぎり寿司', icon: '🍣', kind: 'meal', price: 1800, here: true },
  maki: { name: 'Maki rolls', jp: '巻き寿司', icon: '🍣', kind: 'meal', price: 900, here: true },
  yakitori: { name: 'Yakitori (5)', jp: '焼き鳥', icon: '🍢', kind: 'meal', price: 700, here: true },
  edamame: { name: 'Edamame', jp: '枝豆', icon: '🫛', kind: 'snack', price: 350, here: true },
  karaage: { name: 'Karaage', jp: '唐揚げ', icon: '🍗', kind: 'meal', price: 600, here: true },
  oolong: { name: 'Oolong tea', jp: 'ウーロン茶', icon: '🍵', kind: 'drink', price: 300, here: true },
  blend: { name: 'Blend coffee', jp: 'ブレンド', icon: '☕', kind: 'coffee', price: 450, here: true },
  matcha: { name: 'Matcha latte', jp: '抹茶ラテ', icon: '🍵', kind: 'coffee', price: 550, here: true },
  cake: { name: 'Shortcake', jp: 'ショートケーキ', icon: '🍰', kind: 'dessert', price: 500, here: true },
  toast: { name: 'Toast set', jp: 'モーニング', icon: '🍞', kind: 'meal', price: 600, here: true },
};
for (const [id, it] of Object.entries(ITEMS)) it.id = id;

// what each shop sells (trades as townkit.js SHOP_NAMES numbers them; konbini and vending by name) and its hours
export const MENUS = {
  konbini: { label: 'Convenience store', hours: [0, 24], greet: 'いらっしゃいませ！', items: ['onigiri_salmon', 'onigiri_tuna', 'sando', 'bento', 'nikuman', 'karaagekun', 'pocky', 'icecream', 'greentea', 'water', 'coffeecan', 'cola', 'milktea', 'sports'] },
  vending: { label: 'Vending machine', hours: [0, 24], items: ['greentea', 'water', 'coffeecan', 'cola', 'sports', 'orange', 'milktea', 'mugicha'] },
  0: { label: 'Ramen', hours: [11, 23], greet: 'へい、らっしゃい！', items: ['shoyu', 'tonkotsu', 'miso', 'gyoza', 'chahan', 'oolong'] },
  1: { label: 'Pharmacy', hours: [9, 21], greet: 'いらっしゃいませ。', items: ['energy', 'jelly', 'sports', 'water'] },
  3: { label: 'Izakaya', hours: [17, 24], greet: 'いらっしゃい！', items: ['yakitori', 'edamame', 'karaage', 'oolong'] },
  6: { label: 'Japanese sweets', hours: [9, 19], greet: 'いらっしゃいませ。', items: ['dango', 'daifuku', 'dorayaki', 'taiyaki', 'greentea'] },
  7: { label: 'Café', hours: [8, 20], greet: 'いらっしゃいませ。', items: ['blend', 'matcha', 'cake', 'toast'] },
  8: { label: 'Liquor & drinks', hours: [10, 21], greet: 'まいど！', items: ['ramune', 'orange', 'mugicha', 'cola', 'greentea'] },
  11: { label: 'Bakery', hours: [7, 19], greet: 'いらっしゃいませ！', items: ['melonpan', 'currypan', 'anpan', 'croissant', 'coffeecan'] },
  12: { label: 'Soba & udon', hours: [11, 21], greet: 'いらっしゃい！', items: ['zarusoba', 'tenudon', 'kitsune', 'greentea'] },
  16: { label: 'Sushi', hours: [11, 22], greet: 'へい、らっしゃい！', items: ['nigiri', 'maki', 'greentea'] },
};
export const openAt = (menu, h) => { const [a, b] = menu.hours; return a <= b ? h >= a && h < b : h >= a || h < b; };

const KEY = 'wl_inventory', SLOTS = 24, STACK = 20, START_YEN = 10000;
export const inv = { yen: START_YEN, items: {}, boost: null }; // items: id -> count ; boost: { name, fx, until (ms) }
try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && typeof s.yen === 'number') { inv.yen = s.yen; inv.items = s.items || {}; } } catch (e) {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ yen: inv.yen, items: inv.items })); } catch (e) {} };
const listeners = new Set();
export const onInventory = fn => listeners.add(fn);
const changed = () => { save(); for (const f of listeners) f(); };

export const slotsUsed = () => Object.values(inv.items).reduce((n, c) => n + Math.ceil(c / STACK), 0);
export const yen = n => '¥' + n.toLocaleString('ja-JP');
// buy one of an item: into the bag, or eaten at once when it is served (here); false (and why) when it cannot be
export function buy(id) {
  const it = ITEMS[id]; if (!it) return false;
  if (inv.yen < it.price) { toastMsg('Not enough money'); return false; }
  if (!it.here && !inv.items[id] && slotsUsed() >= SLOTS) { toastMsg('Your bag is full'); return false; }
  if (!it.here && inv.items[id] && inv.items[id] % STACK === 0 && slotsUsed() >= SLOTS) { toastMsg('Your bag is full'); return false; }
  inv.yen -= it.price;
  if (it.here) consume(it); else { inv.items[id] = (inv.items[id] || 0) + 1; toastMsg(it.name + ' — into your bag'); }
  changed(); return true;
}
// eat or drink one from the bag
export function use(id) {
  const it = ITEMS[id]; if (!it || !inv.items[id]) return false;
  if (--inv.items[id] <= 0) delete inv.items[id];
  consume(it); changed(); return true;
}
export function drop(id) { if (!inv.items[id]) return; if (--inv.items[id] <= 0) delete inv.items[id]; changed(); }
function consume(it) {
  const f = FX[it.kind], now = performance.now();
  if (!inv.boost || now > inv.boost.until || f.fx >= inv.boost.fx) inv.boost = { name: f.name, fx: f.fx, until: now + f.t * 1000, icon: it.icon };
  toastMsg((it.kind === 'drink' || it.kind === 'coffee' ? 'Drank ' : 'Ate ') + it.name.toLowerCase() + ' — ' + f.name.toLowerCase());
}
// the speed factor of the boost now (1 without one)
export function boostNow() { if (!inv.boost) return 1; if (performance.now() > inv.boost.until) { inv.boost = null; for (const f of listeners) f(); return 1; } return 1 + inv.boost.fx; }
export const boostLeft = () => inv.boost ? Math.max(0, (inv.boost.until - performance.now()) / 1000) : 0;
export const effectOf = it => FX[it.kind];
export const BAG = { SLOTS, STACK };
