// The race screens, in the game's own look (index.html: dark glass panels, gold accent, spaced capitals): the board's
// prompt, the race and car selection opened at the board in Sakuragawa, the transition while a map is made ready, the
// results at the finish; and the style of the race HUD (race.js, rally.js).
import { RACES, CARS, raceById, stageConfig } from './races.js';
import { trackLine } from './stagedata.js';

const css = document.createElement('style');
css.textContent = `
#rbPrompt { position: fixed; left: 50%; bottom: 13vh; transform: translateX(-50%); z-index: 14; padding: 10px 20px; pointer-events: none; opacity: 0; transition: opacity .25s;
  background: rgba(10,10,18,.62); border: 1px solid rgba(242,239,230,.18); backdrop-filter: blur(8px); color: var(--fg); font-size: 12px; letter-spacing: .26em; text-transform: uppercase; }
#rbPrompt.on { opacity: 1; }
#rbPrompt b { display: inline-block; min-width: 24px; margin-right: 12px; padding: 2px 8px; color: #14110b; background: var(--accent); letter-spacing: 0; text-align: center; }
#raceSel { position: fixed; inset: 0; z-index: 40; display: none; align-items: stretch; justify-content: center; padding: clamp(18px, 4vh, 44px) clamp(14px, 3vw, 48px);
  background: linear-gradient(90deg, rgba(6,7,12,.9) 0%, rgba(6,7,12,.78) 45%, rgba(6,7,12,.55) 100%); }
#raceSel.on { display: flex; animation: rise .35s ease both; }
#raceSel .wrap { display: grid; grid-template-columns: minmax(250px, 320px) minmax(380px, 1fr) minmax(260px, 330px); gap: 22px; width: min(1400px, 100%); }
#raceSel h2 { margin: 0 0 14px; font-weight: 400; font-size: 11px; letter-spacing: .32em; text-transform: uppercase; color: var(--dim); }
#raceSel .head { grid-column: 1 / -1; display: flex; align-items: baseline; gap: 18px; }
#raceSel .head h1 { margin: 0; font-weight: 200; font-size: clamp(26px, 3vw, 40px); letter-spacing: .38em; }
#raceSel .head .k { font: 16px var(--mincho); color: var(--accent); letter-spacing: .3em; }
#raceSel .col { display: flex; flex-direction: column; min-height: 0; padding: 18px; background: rgba(10,10,18,.5); border: 1px solid rgba(242,239,230,.1); backdrop-filter: blur(10px); }
#raceSel .list { display: flex; flex-direction: column; gap: 8px; overflow-y: auto; }
#raceSel .rc { all: unset; box-sizing: border-box; cursor: pointer; display: grid; grid-template-columns: 48px 1fr auto; align-items: center; gap: 10px; padding: 10px 12px;
  background: rgba(14,13,22,.6); border: 1px solid rgba(242,239,230,.14); transition: border-color .2s, transform .2s; }
#raceSel .rc:hover { border-color: rgba(242,239,230,.4); transform: translateX(3px); }
#raceSel .rc.sel { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
#raceSel .rc .n { font: 600 26px/1 var(--mincho); color: rgba(255,255,255,.28); }
#raceSel .rc.sel .n { color: var(--accent); }
#raceSel .rc .nm { font-size: 13px; letter-spacing: .18em; text-transform: uppercase; }
#raceSel .rc .sf { font-size: 10.5px; color: var(--dim); letter-spacing: .08em; }
#raceSel .rc .ln { font-size: 12px; color: var(--fg); font-variant-numeric: tabular-nums; }
#raceSel .rdy { width: 7px; height: 7px; border-radius: 50%; background: rgba(242,239,230,.18); display: inline-block; margin-left: 8px; vertical-align: middle; }
#raceSel .rdy.part { background: #d9b56a88; } #raceSel .rdy.full { background: #7dffa0; box-shadow: 0 0 6px #7dffa0aa; }
#raceSel .map { position: relative; flex: 1; min-height: 220px; }
#raceSel .map canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
#raceSel .prof { height: 70px; margin-top: 10px; position: relative; }
#raceSel .prof canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
#raceSel .facts { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 14px; }
#raceSel .facts div { padding: 8px 10px; border: 1px solid rgba(242,239,230,.12); }
#raceSel .facts small { display: block; font-size: 9.5px; letter-spacing: .24em; text-transform: uppercase; color: var(--dim); }
#raceSel .facts span { font-size: 15px; letter-spacing: .06em; }
#raceSel .blurb { margin: 12px 0 0; font-size: 12.5px; color: var(--dim); }
#raceSel .cars { display: flex; flex-direction: column; gap: 10px; }
#raceSel .cc { all: unset; box-sizing: border-box; cursor: pointer; padding: 12px 14px; background: rgba(14,13,22,.6); border: 1px solid rgba(242,239,230,.14); transition: border-color .2s; }
#raceSel .cc:hover { border-color: rgba(242,239,230,.4); }
#raceSel .cc.sel { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
#raceSel .cc .cn { font-size: 13px; letter-spacing: .16em; text-transform: uppercase; }
#raceSel .cc .st { display: grid; grid-template-columns: 1fr 1fr; gap: 3px 10px; margin-top: 8px; font-size: 11.5px; color: var(--dim); }
#raceSel .cc .st b { color: var(--fg); font-weight: 600; }
#raceSel .cc .fit { margin-top: 8px; height: 3px; background: rgba(255,255,255,.1); } #raceSel .cc .fit i { display: block; height: 100%; background: var(--accent); }
#raceSel .cc .nt { margin-top: 8px; font-size: 11.5px; color: var(--dim); line-height: 1.4; }
#raceSel .cc .warn { color: var(--pink); }
#raceSel .go { margin-top: auto; display: flex; flex-direction: column; gap: 10px; padding-top: 16px; }
#raceSel .go .state { font-size: 11px; letter-spacing: .1em; color: var(--dim); min-height: 16px; }
#raceSel .go .bar { width: 100%; }
#raceSel #rsStart { all: unset; box-sizing: border-box; cursor: pointer; text-align: center; padding: 15px 20px; font-size: 13px; letter-spacing: .36em; text-transform: uppercase;
  background: rgba(217,181,106,.18); border: 1px solid var(--accent); transition: background .2s, color .2s; }
#raceSel #rsStart:hover, #raceSel #rsStart:focus-visible { background: var(--accent); color: #14110b; }
#raceSel #rsBack { all: unset; box-sizing: border-box; cursor: pointer; text-align: center; padding: 11px; font-size: 11px; letter-spacing: .3em; text-transform: uppercase; color: var(--dim); border: 1px solid rgba(242,239,230,.22); }
#raceSel #rsBack:hover { color: var(--fg); border-color: var(--fg); }
#raceSel .hint { font-size: 10.5px; color: rgba(242,239,230,.4); letter-spacing: .06em; }
@media (max-width: 980px) { #raceSel .wrap { grid-template-columns: 1fr; overflow-y: auto; } #raceSel { overflow-y: auto; } #raceSel .map { min-height: 240px; } }
#raceLoad { position: fixed; inset: 0; z-index: 45; display: flex; flex-direction: column; align-items: center; justify-content: center; opacity: 0; pointer-events: none; transition: opacity .45s;
  background: radial-gradient(ellipse at 50% 60%, #1b2226 0%, #0b0d0f 72%); }
#raceLoad.on { opacity: 1; pointer-events: auto; }
#raceLoad h1 { font-weight: 200; font-size: clamp(28px, 4.6vw, 58px); letter-spacing: .42em; margin: 0 0 10px .42em; }
#raceLoad .k { font: 18px var(--mincho); letter-spacing: .5em; color: var(--accent); margin-bottom: 26px; min-height: 24px; }
#raceLoad canvas { width: min(360px, 70vw); height: 160px; margin-bottom: 18px; opacity: .9; }
#raceLoad .txt { margin-top: 14px; color: var(--dim); font-size: 12px; letter-spacing: .08em; min-height: 18px; }
#raceLoad.ready { cursor: pointer; } #raceLoad.ready .bar { opacity: 0; } #raceLoad.ready .txt { color: var(--fg); font-size: 13px; letter-spacing: .42em; text-transform: uppercase; animation: pulse 2.4s ease-in-out infinite; }
#raceRes { position: fixed; inset: 0; z-index: 42; display: none; align-items: center; justify-content: center; background: rgba(6,7,12,.55); }
#raceRes.on { display: flex; animation: rise .4s ease both; }
#raceRes .box { width: min(560px, 92vw); padding: 24px 26px; background: rgba(10,10,18,.78); border: 1px solid rgba(242,239,230,.14); backdrop-filter: blur(10px); }
#raceRes h1 { margin: 0 0 4px; font-weight: 200; font-size: 30px; letter-spacing: .36em; }
#raceRes .sub { margin-bottom: 18px; }
#raceRes table { width: 100%; border-collapse: collapse; font-size: 13px; }
#raceRes td { padding: 6px 4px; border-bottom: 1px solid rgba(242,239,230,.08); font-variant-numeric: tabular-nums; }
#raceRes td:first-child { width: 34px; color: var(--dim); } #raceRes td:last-child { text-align: right; }
#raceRes tr.me td { color: var(--accent); font-weight: 600; }
#raceRes .btns { display: flex; gap: 10px; margin-top: 20px; }
#raceRes button { all: unset; box-sizing: border-box; cursor: pointer; flex: 1; text-align: center; padding: 13px; font-size: 11.5px; letter-spacing: .3em; text-transform: uppercase; border: 1px solid rgba(242,239,230,.25); color: var(--dim); }
#raceRes button.pri { border-color: var(--accent); color: var(--fg); background: rgba(217,181,106,.16); }
#raceRes button:hover, #raceRes button:focus-visible { color: #14110b; background: var(--accent); border-color: var(--accent); }
#raceOrder { position: fixed; right: 16px; top: 44px; z-index: 9; min-width: 210px; padding: 9px 13px; background: rgba(9,13,19,.78); border: 1px solid rgba(255,255,255,.16);
  color: #fff; font: 600 13px/1.55 "Segoe UI", system-ui, sans-serif; text-shadow: 0 1px 3px #000; pointer-events: none; backdrop-filter: blur(6px); }
#raceOrder div span { float: right; margin-left: 14px; opacity: .72; font-variant-numeric: tabular-nums; }
#raceOrder .pos { font: 800 26px/1.1 "Segoe UI"; } #raceOrder .pos small { font-size: 15px; opacity: .7; }
#raceOrder .me { color: #ffd54d; font-weight: 800; } #raceOrder .hd { font: 800 15px "Segoe UI"; color: #ffd54d; margin-bottom: 3px; } #raceOrder .dim { opacity: .6; }
#raceFeed { position: fixed; right: 16px; z-index: 9; min-width: 210px; max-width: 280px; color: #fff; font: 600 12.5px/1.45 "Segoe UI", system-ui, sans-serif; text-shadow: 0 1px 3px #000; pointer-events: none; text-align: right; }
#raceFeed .good { color: #7dffa0; } #raceFeed .bad { color: #ffb08a; } #raceFeed .info { color: #e8eef5; }
`;
document.head.appendChild(css);
const el = (tag, id, html = '') => { const e = document.createElement(tag); if (id) e.id = id; e.innerHTML = html; document.body.appendChild(e); return e; };
const fmt = t => { if (t == null) return '—'; const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2); };
const SURF = { asphalt: 'asfalt', gravel: 'szuter' };
const bestOf = race => { try { return +localStorage.getItem('wl_raceBest_' + race.id) || 0; } catch (e) { return 0; } };
export const saveBest = (race, t) => { if (!(t > 0)) return false; const b = bestOf(race); if (b && b <= t) return false; try { localStorage.setItem('wl_raceBest_' + race.id, String(t)); } catch (e) {} return true; };

// ---------------------------------------------------------------- the stage's line for previews (computed once a race)
const lines = new Map();
export function stageLine(race) {
  if (!lines.has(race.id)) lines.set(race.id, stageConfig(race).then(cfg => { const L = trackLine(cfg); return { P: L.pts, Y: L.Y, n: L.nComp, cfg }; }));
  return lines.get(race.id);
}
// the route drawn into a canvas: north up, the run-off faint, start green, finish chequered; and the climb under it
export function drawRoute(cv, L, { line = '#d6dde5', glow = 'rgba(217,181,106,.35)', pad = 18, lw = 3 } = {}) {
  const dpr = Math.min(2, devicePixelRatio || 1), W = cv.clientWidth || cv.width, H = cv.clientHeight || cv.height; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (const [x, z] of L.P) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
  const k = Math.min((W - 2 * pad) / Math.max(x1 - x0, 1), (H - 2 * pad) / Math.max(z1 - z0, 1)), mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, f = ([x, z]) => [W / 2 - (x - mx) * k, H / 2 - (z - mz) * k];
  const path = (a, b) => { g.beginPath(); for (let i = a; i <= b; i += 3) { const [u, v] = f(L.P[Math.min(i, b)]); i === a ? g.moveTo(u, v) : g.lineTo(u, v); } };
  g.lineCap = g.lineJoin = 'round';
  path(L.n - 1, L.P.length - 1); g.strokeStyle = 'rgba(214,221,229,.25)'; g.lineWidth = lw; g.stroke();
  path(0, L.n - 1); g.strokeStyle = glow; g.lineWidth = lw * 3.2; g.stroke(); g.strokeStyle = line; g.lineWidth = lw; g.stroke();
  const [sx, sz] = f(L.P[30]); g.fillStyle = '#3ce26a'; g.beginPath(); g.arc(sx, sz, lw * 1.8, 0, 6.283); g.fill();
  const [fx, fz] = f(L.P[L.n - 28]), h = lw * 1.6; for (let q = 0; q < 4; q++) { g.fillStyle = q % 2 ? '#111' : '#fff'; g.fillRect(fx - h + (q % 2) * h, fz - h + (q >> 1) * h, h, h); }
}
export function drawProfile(cv, L) {
  const dpr = Math.min(2, devicePixelRatio || 1), W = cv.clientWidth || cv.width, H = cv.clientHeight || cv.height; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const n = L.n, Y = L.Y; let lo = 1e9, hi = -1e9; for (let i = 0; i < n; i++) { lo = Math.min(lo, Y[i]); hi = Math.max(hi, Y[i]); }
  const sx = i => i / (n - 1) * W, sy = y => H - 14 - (y - lo) / Math.max(hi - lo, 1) * (H - 26);
  g.beginPath(); g.moveTo(0, H); for (let i = 0; i < n; i += 4) g.lineTo(sx(i), sy(Y[i])); g.lineTo(W, H); g.closePath();
  const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, 'rgba(217,181,106,.45)'); gr.addColorStop(1, 'rgba(217,181,106,.04)'); g.fillStyle = gr; g.fill();
  g.beginPath(); for (let i = 0; i < n; i += 4) i ? g.lineTo(sx(i), sy(Y[i])) : g.moveTo(sx(i), sy(Y[i])); g.strokeStyle = 'rgba(242,239,230,.75)'; g.lineWidth = 1.4; g.stroke();
  g.fillStyle = 'rgba(242,239,230,.55)'; g.font = '10px "Segoe UI", sans-serif'; g.fillText(Math.round(hi) + ' m', 4, 10); g.fillText(Math.round(lo) + ' m', 4, H - 3);
  g.textAlign = 'right'; g.fillText('przewyższenie ' + Math.round(hi - lo) + ' m', W - 4, 10);
}

// ---------------------------------------------------------------- the board's prompt
const prompt = el('div', 'rbPrompt');
export function showPrompt(text) { if (text) { prompt.innerHTML = text; prompt.classList.add('on'); } else prompt.classList.remove('on'); }

// ---------------------------------------------------------------- race and car selection
const sel = el('div', 'raceSel', `<div class="wrap">
  <div class="head"><h1>WYŚCIGI</h1><span class="k">桜川 モータースポーツ</span><span class="hint" style="margin-left:auto">↑ ↓ trasa · ← → auto · Enter start · Esc powrót</span></div>
  <div class="col"><h2>Trasa</h2><div class="list" data-list></div></div>
  <div class="col"><h2 data-title>Podgląd trasy</h2><div class="map"><canvas data-map></canvas></div><div class="prof"><canvas data-prof></canvas></div>
    <div class="facts"><div><small>Nawierzchnia</small><span data-surf></span></div><div><small>Długość</small><span data-len></span></div><div><small>Rywale</small><span data-field></span></div><div><small>Rekord</small><span data-best></span></div></div>
    <p class="blurb" data-blurb></p></div>
  <div class="col"><h2>Samochód</h2><div class="cars" data-cars></div>
    <div class="go"><div class="state" data-state></div><div class="bar"><i data-prog></i></div><button id="rsStart" type="button">Start wyścigu</button><button id="rsBack" type="button">Wróć do Sakuragawa</button></div></div>
</div>`);
const $s = q => sel.querySelector(q);
let cur = null, curCar = null, handlers = null, readyFn = null, pollT = 0;
function renderList() {
  $s('[data-list]').innerHTML = RACES.map(r => `<button type="button" class="rc${cur && r.id === cur.id ? ' sel' : ''}" data-id="${r.id}"><span class="n">${r.kanji}</span><span><div class="nm">${r.name}</div><div class="sf">${SURF[r.surface]} · ${r.tags.slice(1).join(' · ')}</div></span><span class="ln">${(r.length / 1000).toFixed(1)} km<i class="rdy" data-rdy="${r.id}"></i></span></button>`).join('');
  for (const b of sel.querySelectorAll('.rc')) b.onclick = () => pick(raceById(b.dataset.id));
}
function renderCars() {
  $s('[data-cars]').innerHTML = Object.entries(CARS).map(([id, c]) => { const fit = c.grip[cur.surface] ?? 1;
    return `<button type="button" class="cc${id === curCar ? ' sel' : ''}" data-car="${id}"><div class="cn">${c.name}</div>
      <div class="st"><span>Moc <b>${c.power}</b></span><span>Masa <b>${c.mass}</b></span><span>Napęd <b>${c.drive}</b></span><span>V max <b>${c.top}</b></span></div>
      <div class="fit" title="dopasowanie do nawierzchni"><i style="width:${Math.round(fit * 100)}%"></i></div>
      <div class="nt ${fit < 0.6 ? 'warn' : ''}">${fit < 0.6 ? 'Słaba przyczepność na tej nawierzchni. ' : ''}${c.note}</div></button>`; }).join('');
  for (const b of sel.querySelectorAll('.cc')) b.onclick = () => { curCar = b.dataset.car; renderCars(); handlers && handlers.onPick && handlers.onPick(cur, curCar); };
}
async function pick(r) {
  cur = r; try { localStorage.setItem('wl_raceSel', r.id); } catch (e) {}
  if (!curCar || !CARS[curCar]) curCar = r.car;
  if (r.surface === 'gravel' && curCar === 'f40') curCar = 'i20'; // (the default on gravel: the rally car)
  renderList(); renderCars();
  $s('[data-title]').textContent = r.name + ' · ' + r.kanji;
  $s('[data-surf]').textContent = SURF[r.surface]; $s('[data-len]').textContent = (r.length / 1000).toFixed(1) + ' km'; $s('[data-field]').textContent = r.field;
  const b = bestOf(r); $s('[data-best]').textContent = b ? fmt(b) : '—'; $s('[data-blurb]').textContent = r.blurb;
  handlers && handlers.onPick && handlers.onPick(r, curCar);
  const L = await stageLine(r); if (cur !== r) return;
  drawRoute($s('[data-map]'), L, { lw: 3.2 }); drawProfile($s('[data-prof]'), L);
}
function poll() {
  if (!sel.classList.contains('on')) return;
  if (readyFn) { for (const r of RACES) { const d = sel.querySelector(`[data-rdy="${r.id}"]`), k = readyFn(r).k; if (d) d.className = 'rdy' + (k >= 0.999 ? ' full' : k > 0.3 ? ' part' : ''); }
    const k = readyFn(cur, curCar).k; $s('[data-prog]').style.width = (k * 100).toFixed(0) + '%';
    $s('[data-state]').textContent = k >= 0.999 ? 'Trasa przygotowana — start natychmiast' : 'Przygotowywanie trasy w tle… ' + Math.round(k * 100) + '%'; }
  pollT = setTimeout(poll, 250);
}
const key = e => {
  if (!sel.classList.contains('on')) return;
  const i = RACES.indexOf(cur), ids = Object.keys(CARS);
  if (e.code === 'Escape') { e.preventDefault(); close(true); }
  else if (e.code === 'Enter') { e.preventDefault(); start(); }
  else if (e.code === 'ArrowDown' || e.code === 'KeyS') { e.preventDefault(); pick(RACES[(i + 1) % RACES.length]); }
  else if (e.code === 'ArrowUp' || e.code === 'KeyW') { e.preventDefault(); pick(RACES[(i + RACES.length - 1) % RACES.length]); }
  else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight' || e.code === 'KeyA' || e.code === 'KeyD') { e.preventDefault(); curCar = ids[(ids.indexOf(curCar) + 1) % ids.length]; renderCars(); handlers && handlers.onPick && handlers.onPick(cur, curCar); }
  e.stopPropagation();
};
addEventListener('keydown', key, true);
function close(cancelled) { sel.classList.remove('on'); clearTimeout(pollT); const h = handlers; handlers = null; if (cancelled && h && h.onCancel) h.onCancel(); }
function start() { if (!cur) return; const h = handlers, r = cur, c = curCar; close(false); h && h.onStart && h.onStart(r, c); }
$s('#rsStart').onclick = start; $s('#rsBack').onclick = () => close(true);
export const selection = {
  // opens the panel; h: { onStart(race, car), onCancel(), onPick(race, car) }, ready(race, car) -> { k: 0..1 }
  open(h, ready) { handlers = h; readyFn = ready; let id = null; try { id = localStorage.getItem('wl_raceSel'); } catch (e) {} sel.classList.add('on'); pick(raceById(id) || RACES[0]); poll(); },
  close: () => close(true), isOpen: () => sel.classList.contains('on'),
  // (tests: pick and start without the mouse)
  choose(raceId, carId) { const r = raceById(raceId); if (!r) return false; cur = r; curCar = carId || r.car; start(); return true; },
};

// ---------------------------------------------------------------- the transition between maps
const load = el('div', 'raceLoad', `<h1 data-t></h1><div class="k" data-k></div><canvas data-c></canvas><div class="bar"><i data-p></i></div><div class="txt" data-x></div>`);
const $l = q => load.querySelector(q);
export const transition = {
  async show(title, kanji, race = null) { $l('[data-t]').textContent = title; $l('[data-k]').textContent = kanji || ''; $l('[data-p]').style.width = '0%'; $l('[data-x]').textContent = '';
    const cv = $l('[data-c]'); cv.style.display = race ? '' : 'none'; load.classList.add('on');
    if (race) stageLine(race).then(L => drawRoute(cv, L, { lw: 2.4 })).catch(() => {});
    await new Promise(r => setTimeout(r, 460)); }, // (faded in fully before the scene behind it changes)
  progress(p, label) { $l('[data-p]').style.width = (Math.max(0, Math.min(1, p)) * 100).toFixed(1) + '%'; if (label) $l('[data-x]').textContent = label; },
  hide() { load.classList.remove('on', 'ready'); },
  // the map is ready: a click (pointer lock needs one) or Enter hands over to it
  ready(fn, label = 'Kliknij, aby rozpocząć') { $l('[data-p]').style.width = '100%'; $l('[data-x]').textContent = label; load.classList.add('ready');
    const go = e => { if (e && e.type === 'keydown' && e.code !== 'Enter' && e.code !== 'Space') return; if (e && e.preventDefault) e.preventDefault(); load.removeEventListener('click', go); removeEventListener('keydown', go, true); fn(); };
    load.addEventListener('click', go); addEventListener('keydown', go, true); return go; },
  get on() { return load.classList.contains('on'); },
};

// ---------------------------------------------------------------- the results
const res = el('div', 'raceRes', `<div class="box"><h1 data-h>WYNIKI</h1><div class="sub" data-s></div><table data-tb></table><div class="btns"><button type="button" data-again>Jeszcze raz</button><button type="button" class="pri" data-home>Wróć do Sakuragawa</button></div></div>`);
const $r = q => res.querySelector(q);
let resH = null;
export const results = {
  show(race, rows, { newBest = false, mine = null, best = 0 } = {}, h = {}) { resH = h;
    const pos = rows.findIndex(r => r.me) + 1;
    $r('[data-h]').textContent = pos ? (pos === 1 ? 'ZWYCIĘSTWO' : 'P' + pos + ' / ' + rows.length) : 'WYNIKI';
    $r('[data-s]').innerHTML = `${race.name} · ${(race.length / 1000).toFixed(1)} km · twój czas ${fmt(mine)}${newBest ? ' · <span style="color:var(--accent)">nowy rekord</span>' : best ? ' · rekord ' + fmt(best) : ''}`;
    const lead = rows[0] && rows[0].t;
    $r('[data-tb]').innerHTML = rows.map((r, k) => `<tr class="${r.me ? 'me' : ''}"><td>${k + 1}.</td><td>${r.me ? 'Ty' : r.name}</td><td>${r.car === 'f40' ? 'F40' : r.car === 'i20' ? 'i20' : ''}</td><td>${r.t == null ? 'na trasie' : k && lead ? '+' + (r.t - lead).toFixed(2) + ' s' : fmt(r.t)}</td></tr>`).join('');
    res.classList.add('on'); },
  hide() { res.classList.remove('on'); }, get on() { return res.classList.contains('on'); },
};
$r('[data-again]').onclick = () => { results.hide(); resH && resH.onAgain && resH.onAgain(); };
$r('[data-home]').onclick = () => { results.hide(); resH && resH.onHome && resH.onHome(); };
addEventListener('keydown', e => { if (!res.classList.contains('on')) return; if (e.code === 'Enter' || e.code === 'Escape') { e.preventDefault(); e.stopPropagation(); $r('[data-home]').click(); } else if (e.code === 'KeyR') { e.preventDefault(); e.stopPropagation(); $r('[data-again]').click(); } }, true);
