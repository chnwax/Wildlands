// Title screen: the painted backdrop, the main menu (city, settings, controls) and the loading screen. It is its own
// module script, loaded before main.js, so the title is up before the engine and the map code have arrived; main.js
// takes the player's choice from it (title.onPlay) and reports loading through it. A page opened with ?map=<name>
// (the dev server, the World Builder, test harnesses) skips the title and goes straight to loading that map.
const $ = id => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
};
const titleMode = document.documentElement.classList.contains('boot-title');
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Cities in menu order. map: the engine map that builds the city (engine.js MAPS), null while it is still being built.
// The original Wildlands valley (map 'nature') is no longer offered here but still opens with ?map=nature.
export const CITIES = [
  { id: 'sakuragawa', map: 'town', name: 'Sakuragawa', kanji: '桜川', blurb: 'A small Japanese river town',
    tags: ['river & bridges', 'trains', 'traffic', 'apartment district'] },
  { id: 'shiomi', map: null, name: 'Shiomi', kanji: '潮見', blurb: 'A seaside harbour town' },
];
const UNLISTED = { nature: { name: 'Wildlands', kanji: '' }, assetmap: { name: 'Asset Garden', kanji: '庭' } };
export const cityOfMap = map => CITIES.find(c => c.map === map) || UNLISTED[map] || { name: map, kanji: '' };

// arrival time: null keeps the map's own start hour
const ARRIVE = [['Dawn', 5.75], ['Morning', 8], ['Noon', 12.5], ['Afternoon', null], ['Golden hour', 17.3], ['Night', 23]];
const TIPS = [
  ['F', 'fly mode: drift over the rooftops, F again to land'],
  ['[ ]', 'move the clock half an hour back or forward'],
  ['T', 'stop or restart time'],
  ['B', 'open the World Builder exactly where you are looking'],
  ['E', 'buy at a shop counter or a vending machine · I or Tab for your bag'],
  ['1 – 5', 'change the graphics quality at any moment'],
  ['H', 'hide the clock for clean screenshots'],
  ['Shift', 'sprint · C to crouch · Space to jump'],
  ['Esc', 'pause, settings and the main menu'],
];

// ---------------------------------------------------------------- painted backdrop
// Dusk over a small river town, painted once per window size into two layers: everything behind the passing train,
// and the cherry tree and near bank in front of it. Each frame adds the train, glints on the water and falling petals.
const rnd = seed => { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; };
const PETAL = ['#f9cdd9', '#f4b6c8', '#fde3ea', '#eea3bb'];

const backdrop = (() => {
  const cv = $('backdrop');
  if (!cv || !titleMode) return null;
  const ctx = cv.getContext('2d');
  let W = 1, H = 1, u = 1, hy = 0, railY = 0, sx = 0, bg = null, fg = null;
  let raf = 0, last = 0, t = 0, running = false;
  const petals = [], glints = [];
  const layer = () => Object.assign(document.createElement('canvas'), { width: W, height: H });

  function paint() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    W = cv.width = Math.max(1, Math.round(innerWidth * dpr)); H = cv.height = Math.max(1, Math.round(innerHeight * dpr));
    u = Math.max(H, W * 0.5) / 1000;
    hy = H * (W > H ? 0.64 : 0.6); railY = hy + 34 * u; sx = W * 0.64;
    const sy = hy - 128 * u, q = rnd(11);
    bg = layer(); const b = bg.getContext('2d');
    // sky, a few early stars, the low sun and its glow
    let g = b.createLinearGradient(0, 0, 0, hy);
    [[0, '#121831'], [0.38, '#37325a'], [0.64, '#86566f'], [0.86, '#dc8b69'], [1, '#f4c088']].forEach(([o, c]) => g.addColorStop(o, c));
    b.fillStyle = g; b.fillRect(0, 0, W, H);
    for (let i = 0; i < 80; i++) {
      const y = q() * q() * hy * 0.42;
      b.fillStyle = `rgba(255,245,230,${((0.15 + q() * 0.55) * (1 - y / (hy * 0.42))).toFixed(3)})`;
      b.fillRect(q() * W, y, 1.5 * u, 1.5 * u);
    }
    g = b.createRadialGradient(sx, sy, 0, sx, sy, 560 * u);
    g.addColorStop(0, 'rgba(255,236,190,.95)'); g.addColorStop(0.05, 'rgba(255,214,150,.6)');
    g.addColorStop(0.25, 'rgba(244,150,104,.2)'); g.addColorStop(1, 'rgba(244,150,104,0)');
    b.fillStyle = g; b.fillRect(0, 0, W, H);
    b.fillStyle = '#fff4dc'; b.beginPath(); b.arc(sx, sy, 26 * u, 0, 7); b.fill();
    // cloud streaks, lit from below by the low sun
    b.filter = `blur(${(7 * u).toFixed(1)}px)`;
    for (let i = 0; i < 16; i++) {
      const y = hy * (0.2 + q() * 0.58), k = y / hy;
      b.fillStyle = `rgba(${150 + 105 * k | 0},${120 + 62 * k | 0},${165 - 25 * k | 0},${(0.1 + q() * 0.2).toFixed(3)})`;
      b.beginPath(); b.ellipse(q() * W, y, (160 + q() * 380) * u, (5 + q() * 12) * u, 0, 0, 7); b.fill();
    }
    b.filter = 'none';
    // three ridges fading into the warm haze of the valley
    const ridge = (base, amp, f, col, seed, rough) => {
      const r = rnd(seed), p = [r() * 9, r() * 9, r() * 9, r() * 9];
      b.beginPath(); b.moveTo(0, H);
      for (let x = 0; x <= W + 6 * u; x += 4 * u) {
        const k = x / (1000 * u) * f;
        const n = 0.5 * (1 - Math.abs(Math.sin(k + p[0]))) + 0.3 * Math.sin(k * 2.1 + p[1]) + 0.2 * Math.sin(k * 4.7 + p[2])
          + rough * Math.sin(k * 23 + p[3]) * Math.sin(k * 9 + p[0]);
        b.lineTo(x, base - amp * (0.4 + 0.6 * n));
      }
      b.lineTo(W + 6 * u, H); b.closePath(); b.fillStyle = col; b.fill();
      const h = b.createLinearGradient(0, base - amp * 0.6, 0, base + 10 * u);
      h.addColorStop(0, 'rgba(232,150,118,0)'); h.addColorStop(1, 'rgba(232,150,118,.38)');
      b.fillStyle = h; b.fill();
    };
    ridge(hy - 70 * u, 190 * u, 2.2, '#9c6a80', 3, 0.02);
    ridge(hy - 22 * u, 110 * u, 3.4, '#6a4866', 5, 0.04);
    ridge(hy + 6 * u, 50 * u, 6.0, '#433150', 8, 0.1);
    // the town: a hazier back row, the ground, street trees, the front row with lit windows
    const town = (base, col, lit, seed, sc, dens) => {
      const r = rnd(seed); let x = -30 * u;
      while (x < W + 30 * u) {
        const big = r() < dens, w = (big ? 120 + r() * 90 : 24 + r() * 38) * u * sc, h = (big ? 70 + r() * 50 : 16 + r() * 22) * u * sc, top = base - h;
        b.fillStyle = col; b.fillRect(x, top, w, H - top);
        if (big) b.fillRect(x + w * (0.2 + r() * 0.5), top - 9 * u * sc, 14 * u * sc, 9 * u * sc); // rooftop water tank
        else if (r() < 0.72) {
          b.beginPath(); b.moveTo(x - 3 * u, top + 1); b.lineTo(x + w * (0.35 + r() * 0.3), top - (7 + r() * 8) * u * sc); b.lineTo(x + w + 3 * u, top + 1); b.fill();
        }
        const step = (big ? 10 : 9) * u * sc;
        for (let wy = top + 7 * u * sc; wy < base - 6 * u * sc; wy += step)
          for (let wx = x + 6 * u * sc; wx < x + w - 8 * u * sc; wx += step)
            if (r() < (big ? 0.3 : 0.17)) {
              b.fillStyle = `rgba(255,${200 + r() * 30 | 0},${120 + r() * 40 | 0},${(lit * (0.45 + r() * 0.5)).toFixed(3)})`;
              b.fillRect(wx, wy, 4 * u * sc, 3.4 * u * sc);
            }
        b.fillStyle = col;
        x += w + (r() < 0.25 ? r() * 16 * u : -r() * 3 * u);
      }
    };
    town(hy - 8 * u, '#3a2c47', 0.55, 21, 0.75, 0.05);
    b.fillStyle = '#271e33'; b.fillRect(0, hy + 4 * u, W, H);
    b.fillStyle = '#2b2236';
    for (let i = 0; i < 60; i++) { b.beginPath(); b.arc(q() * W, hy + 2 * u, (6 + q() * 10) * u, 0, 7); b.fill(); }
    town(hy + 4 * u, '#271e33', 1, 22, 1, 0.07);
    // utility poles and their sagging wires
    b.strokeStyle = '#1b1524'; b.lineCap = 'round';
    let px = 30 * u, prev = null;
    while (px < W + 160 * u) {
      const top = hy + 4 * u - (64 + q() * 10) * u;
      b.lineWidth = 2.4 * u; b.beginPath(); b.moveTo(px, hy + 6 * u); b.lineTo(px, top); b.stroke();
      b.lineWidth = 1.6 * u; b.beginPath(); b.moveTo(px - 9 * u, top + 6 * u); b.lineTo(px + 9 * u, top + 6 * u); b.stroke();
      if (prev) {
        b.lineWidth = 0.9 * u;
        for (const [ox, oy] of [[-8, 6], [8, 6], [0, 15]]) {
          b.beginPath(); b.moveTo(prev.x + ox * u, prev.top + oy * u);
          b.quadraticCurveTo((prev.x + px) / 2, (prev.top + top) / 2 + (oy + 16) * u, px + ox * u, top + oy * u); b.stroke();
        }
      }
      prev = { x: px, top }; px += (120 + q() * 70) * u;
    }
    // railway embankment: catenary masts, the contact wire, a glint on the rail
    b.fillStyle = '#1f1829'; b.fillRect(0, railY, W, 22 * u);
    b.fillStyle = 'rgba(255,190,140,.28)'; b.fillRect(0, railY, W, 1.4 * u);
    b.strokeStyle = '#1a1422'; b.lineWidth = 1.4 * u;
    for (let x = 12 * u; x < W; x += 92 * u) { b.beginPath(); b.moveTo(x, railY); b.lineTo(x, railY - 32 * u); b.lineTo(x + 12 * u, railY - 32 * u); b.stroke(); }
    b.lineWidth = 0.8 * u; b.beginPath(); b.moveTo(0, railY - 28 * u); b.lineTo(W, railY - 28 * u); b.stroke();
    // the river: sky reflected darker, the sun's path broken into ripples
    const r0 = railY + 22 * u, r1 = H * 0.9;
    g = b.createLinearGradient(0, r0, 0, r1);
    g.addColorStop(0, '#b97c6c'); g.addColorStop(0.35, '#6b4a62'); g.addColorStop(1, '#221a30');
    b.fillStyle = g; b.fillRect(0, r0, W, H - r0);
    b.fillStyle = 'rgba(25,18,36,.55)'; b.fillRect(0, r0, W, 10 * u);
    for (let i = 0; i < 80; i++) {
      const k = i / 80, y = r0 + 12 * u + (r1 - r0 - 12 * u) * Math.pow(k, 1.25), w = (14 + q() * 50) * u * (0.6 + k * 2.2);
      b.fillStyle = `rgba(255,${210 + q() * 30 | 0},160,${(0.55 * (1 - k) * (0.4 + q() * 0.6)).toFixed(3)})`;
      b.fillRect(sx - w / 2 + (q() - 0.5) * 24 * u * (1 + k * 3), y, w, (1 + k * 2) * u);
    }
    for (let i = 0; i < 180; i++) {
      b.fillStyle = `rgba(255,220,200,${(0.03 + q() * 0.05).toFixed(3)})`;
      b.fillRect(q() * W, r0 + 10 * u + q() * (r1 - r0), (20 + q() * 90) * u, u);
    }
    glints.length = 0;
    for (let i = 0; i < 46; i++) {
      const k = q();
      glints.push({ x: sx + (q() - 0.5) * (50 + k * 300) * u, y: r0 + 14 * u + (r1 - r0) * 0.8 * k, w: (5 + q() * 14) * u, ph: q() * 9, sp: 0.8 + q() * 2.2 });
    }

    fg = layer(); const f = fg.getContext('2d');
    // near bank: grass, the promenade railing
    const bank = H * 0.9;
    f.fillStyle = '#120e19'; f.beginPath(); f.moveTo(0, H);
    for (let x = 0; x <= W + 8 * u; x += 8 * u) f.lineTo(x, bank - Math.sin(x / (90 * u)) * 3 * u - q() * 2 * u);
    f.lineTo(W + 8 * u, H); f.fill();
    f.strokeStyle = '#120e19'; f.lineWidth = 1.4 * u;
    for (let x = 0; x < W; x += 3 * u) { f.beginPath(); f.moveTo(x, bank + 2 * u); f.lineTo(x + (q() - 0.5) * 6 * u, bank - (3 + q() * 10) * u); f.stroke(); }
    f.fillStyle = '#0f0b15';
    for (let x = 6 * u; x < W; x += 46 * u) f.fillRect(x, bank - 26 * u, 3 * u, 26 * u);
    f.fillRect(0, bank - 26 * u, W, 2.2 * u); f.fillRect(0, bank - 15 * u, W, 1.6 * u);
    // the cherry tree leaning over the water from the right
    const tx = W * 0.9 + 40 * u, tips = [];
    f.strokeStyle = '#1a1220'; f.lineCap = 'round';
    const branch = (x, y, a, len, w, d) => {
      const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len, bend = (q() - 0.5) * len * 0.3;
      f.lineWidth = w; f.beginPath(); f.moveTo(x, y);
      f.quadraticCurveTo((x + x2) / 2 - Math.sin(a) * bend, (y + y2) / 2 + Math.cos(a) * bend, x2, y2); f.stroke();
      if (d <= 3) tips.push([x2, y2, d]);
      if (!d) return;
      const n = d > 4 ? 2 : 2 + (q() < 0.5);
      for (let i = 0; i < n; i++)
        branch(x2, y2, a + (i - (n - 1) / 2) * (0.5 + q() * 0.3) + (q() - 0.5) * 0.4 - 0.07, len * (0.68 + q() * 0.12), w * 0.64, d - 1);
    };
    branch(tx, H + 10 * u, -Math.PI / 2 - 0.42, 190 * u, 30 * u, 7);
    const LIT = ['#ffdbe5', '#fac4d3', '#f4b0c5'], SHADE = ['#c9809f', '#a8668a', '#d895b0'];
    f.filter = `blur(${(8 * u).toFixed(1)}px)`; f.fillStyle = 'rgba(240,160,190,.16)';
    for (const [x, y, d] of tips) { f.beginPath(); f.arc(x, y, (14 + d * 8) * u, 0, 7); f.fill(); }
    f.filter = 'none';
    for (const [x, y, d] of tips) {
      for (let i = 0, n = 10 + d * 3; i < n; i++) {
        const a = q() * 6.283, rr = q() * (16 + d * 6) * u, cx = x + Math.cos(a) * rr, cy = y + Math.sin(a) * rr * 0.75;
        const lit = (cy < y ? 0.25 : 0) + (cx < tx - 60 * u ? 0.4 : 0.12) + q() * 0.35 > 0.55, set = lit ? LIT : SHADE;
        f.globalAlpha = 0.7 + q() * 0.3; f.fillStyle = set[q() * 3 | 0];
        f.beginPath(); f.arc(cx, cy, (3 + q() * 6) * u, 0, 7); f.fill();
      }
    }
    f.globalAlpha = 1;
    petals.length = 0;
    if (!still) for (let i = 0; i < 90; i++) petals.push(spawn({}, true));
  }

  function spawn(p, anywhere) {
    p.z = 0.45 + Math.random() * 0.9;
    p.x = anywhere ? Math.random() * W : W * (0.5 + Math.random() * 0.55);
    p.y = anywhere ? Math.random() * H : H * (0.04 + Math.random() * 0.5);
    p.vx = -(26 + Math.random() * 40) * u * p.z; p.vy = (14 + Math.random() * 22) * u * p.z;
    p.sw = (8 + Math.random() * 18) * u; p.ph = Math.random() * 6.28; p.fq = 0.6 + Math.random() * 1.2;
    p.rot = Math.random() * 6.28; p.vr = (Math.random() - 0.5) * 2.4; p.flip = Math.random() * 6.28; p.vf = 1 + Math.random() * 2.5;
    p.age = anywhere ? 9 : 0; p.s = (3.2 + Math.random() * 2.6) * u * p.z; p.c = PETAL[Math.random() * PETAL.length | 0];
    return p;
  }

  function drawTrain() {
    const period = 38, run = 15, tt = (t + period - 4) % period;
    if (tt > run) return;
    const cars = 3, cl = 110 * u, gap = 4 * u, len = cars * (cl + gap), x0 = -len + (W + len) * (tt / run), h = 15 * u, y = railY - 2 * u;
    for (let i = 0; i < cars; i++) {
      const x = x0 + i * (cl + gap), lead = i === cars - 1;
      ctx.fillStyle = '#1c1525';
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - h);
      ctx.lineTo(x + cl - (lead ? 9 * u : 0), y - h); ctx.quadraticCurveTo(x + cl, y - h, x + cl, y - (lead ? h * 0.35 : h)); ctx.lineTo(x + cl, y); ctx.fill();
      if (i !== 1) { ctx.strokeStyle = '#1c1525'; ctx.lineWidth = 1.2 * u; ctx.beginPath(); ctx.moveTo(x + 30 * u, y - h); ctx.lineTo(x + 40 * u, y - h - 10 * u); ctx.lineTo(x + 50 * u, y - h); ctx.stroke(); }
      ctx.fillStyle = 'rgba(255,220,160,.92)';
      for (let wx = x + 8 * u; wx < x + cl - 14 * u; wx += 11 * u) ctx.fillRect(wx, y - h + 4 * u, 7 * u, 4.5 * u);
      ctx.fillStyle = 'rgba(255,220,160,.16)';
      for (let wx = x + 8 * u; wx < x + cl - 14 * u; wx += 11 * u) ctx.fillRect(wx, railY + 30 * u, 7 * u, 3 * u);
    }
    const hx = x0 + len - gap, g = ctx.createRadialGradient(hx, y - 4 * u, 0, hx, y - 4 * u, 60 * u);
    g.addColorStop(0, 'rgba(255,240,200,.75)'); g.addColorStop(1, 'rgba(255,240,200,0)');
    ctx.fillStyle = g; ctx.fillRect(hx - 60 * u, y - 64 * u, 120 * u, 120 * u);
  }

  function draw(dt) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(bg, 0, 0);
    for (const g of glints) {
      const a = Math.pow(Math.max(0, Math.sin(t * g.sp + g.ph)), 6);
      if (a < 0.02) continue;
      ctx.fillStyle = `rgba(255,244,214,${(a * 0.85).toFixed(3)})`; ctx.fillRect(g.x, g.y, g.w, 1.3 * u);
    }
    if (!still) drawTrain();
    ctx.drawImage(fg, 0, 0);
    const gust = Math.sin(t * 0.31) * 10 * u;
    for (const p of petals) {
      p.age += dt; p.x += (p.vx - gust) * dt; p.y += p.vy * dt; p.rot += p.vr * dt; p.flip += p.vf * dt;
      if (p.x < -40 * u || p.y > H + 30 * u) spawn(p, false);
      const x = p.x + Math.sin(p.ph + t * p.fq) * p.sw, c = Math.cos(p.rot), s = Math.sin(p.rot), k = 0.25 + 0.75 * Math.abs(Math.cos(p.flip)), r = p.s;
      ctx.setTransform(c, s, -s * k, c * k, x, p.y);
      ctx.globalAlpha = Math.min(1, p.age / 1.2) * (0.5 + 0.4 * p.z);
      ctx.fillStyle = p.c;
      ctx.beginPath(); ctx.moveTo(-r, 0);
      ctx.quadraticCurveTo(-r * 0.2, -r * 0.9, r, -r * 0.18); ctx.lineTo(r * 0.72, 0); ctx.lineTo(r, r * 0.18);
      ctx.quadraticCurveTo(-r * 0.2, r * 0.9, -r, 0); ctx.fill();
    }
    ctx.globalAlpha = 1; ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0; last = now; t += dt;
    draw(dt);
  }
  let resizeT = 0;
  addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (!cv.isConnected) return; paint(); draw(0); }, 120); });
  paint(); draw(0);
  return {
    start() { if (running || still) return; running = true; last = 0; raf = requestAnimationFrame(frame); },
    stop() { running = false; cancelAnimationFrame(raf); },
    dim() { cv.classList.add('dim'); },
    gone() { this.stop(); cv.classList.add('gone'); setTimeout(() => cv.remove(), 1600); },
  };
})();

// ---------------------------------------------------------------- main menu
let selCity = CITIES.find(c => c.map && c.id === store.get('wl_city')) || CITIES[0];
let arrive = ARRIVE.findIndex(a => a[0] === store.get('wl_arrive'));
if (arrive < 0) arrive = ARRIVE.findIndex(a => a[1] === null);
let playFn = null, builderFn = null, chosen = null, tipT = 0;

const LOCK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M4 7V5a4 4 0 0 1 8 0v2h1v8H3V7h1zm2 0h4V5a2 2 0 0 0-4 0v2z"/></svg>';
const ART = {
  sakuragawa: `<svg viewBox="0 0 300 130" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
    <defs><radialGradient id="aSun"><stop offset="0" stop-color="#fff3d2"/><stop offset=".25" stop-color="#ffd59a" stop-opacity=".7"/><stop offset="1" stop-color="#f0a070" stop-opacity="0"/></radialGradient>
    <linearGradient id="aRiv" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c58571"/><stop offset="1" stop-color="#2a2036"/></linearGradient></defs>
    <circle cx="206" cy="80" r="46" fill="url(#aSun)"/><circle cx="206" cy="80" r="8" fill="#fff4dc"/>
    <path d="M0 86C30 70 62 66 96 76S150 64 186 62 250 74 300 70V130H0Z" fill="#9a6580" opacity=".6"/>
    <path d="M0 96C40 86 70 90 110 92S200 82 240 86 290 86 300 85V130H0Z" fill="#5b3f60" opacity=".85"/>
    <path fill="#2b2036" d="M0 130V102h10l8-7 8 7h4v-8h18v8h6l9-8 9 8h4V88h26v14h5l7-6 7 6h10v-6h14v6h6l10-8 10 8h8V82h30v20h6l8-7 8 7h12v-5h16v5h5l9-8 9 8h18V130Z"/>
    <g fill="#ffd38a"><rect x="81" y="91" width="3" height="3"/><rect x="93" y="96" width="3" height="3"/><rect x="185" y="86" width="3" height="3"/><rect x="197" y="86" width="3" height="3"/><rect x="191" y="91" width="3" height="3"/><rect x="203" y="96" width="3" height="3"/><rect x="38" y="97" width="3" height="2.5"/><rect x="250" y="99" width="3" height="2.5"/></g>
    <rect y="106" width="300" height="24" fill="url(#aRiv)"/>
    <g fill="#ffdcaa" opacity=".7"><rect x="196" y="109" width="22" height="1.2"/><rect x="190" y="113" width="34" height="1.2"/><rect x="200" y="118" width="18" height="1.2"/><rect x="186" y="123" width="44" height="1.2"/></g>
    <path d="M304 4C276 12 258 22 240 36M268 16c-4 9-2 18-8 28M282 10c2 8-2 14-4 20" stroke="#24182a" stroke-width="3" fill="none" stroke-linecap="round"/>
    <g fill="#f6bccd"><circle cx="240" cy="36" r="7"/><circle cx="232" cy="40" r="5"/><circle cx="246" cy="30" r="6"/><circle cx="260" cy="44" r="7"/><circle cx="254" cy="49" r="5"/><circle cx="268" cy="20" r="6"/><circle cx="276" cy="30" r="7"/><circle cx="286" cy="14" r="6"/><circle cx="296" cy="8" r="7"/></g>
    <g fill="#d58ea9"><circle cx="244" cy="40" r="4"/><circle cx="264" cy="48" r="4"/><circle cx="280" cy="34" r="4"/><circle cx="292" cy="16" r="4"/></g></svg>`,
  shiomi: `<svg viewBox="0 0 300 130" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
    <defs><linearGradient id="aSea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7f9fb3"/><stop offset="1" stop-color="#152338"/></linearGradient>
    <linearGradient id="aBeam" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff6d8" stop-opacity=".5"/><stop offset="1" stop-color="#fff6d8" stop-opacity="0"/></linearGradient></defs>
    <rect y="84" width="300" height="46" fill="url(#aSea)"/>
    <path d="M0 84C20 70 46 60 70 64S98 78 116 84Z" fill="#1b2738"/>
    <path d="M50 64h8l1 -20h-10z" fill="#d9d6cc"/><rect x="48" y="40" width="12" height="5" fill="#2a3446"/><path d="M60 41l120 -14v22z" fill="url(#aBeam)"/>
    <path d="M186 84V62h4v22M188 62l40 -10M222 52v32" stroke="#1b2738" stroke-width="3" fill="none"/>
    <path d="M232 84v-10h46v10z" fill="#1b2738"/><path d="M150 96h34l-4 6h-26z" fill="#1b2738"/><path d="M164 96v-14l12 14z" fill="#d9d6cc" opacity=".7"/>
    <g fill="#cfe0ea" opacity=".35"><rect x="20" y="96" width="60" height="1"/><rect x="120" y="106" width="80" height="1"/><rect x="200" y="114" width="70" height="1"/></g></svg>`,
};

function buildMenu() {
  const box = $('cities');
  for (const c of CITIES) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'city' + (c.map ? '' : ' locked'); b.dataset.city = c.id;
    b.innerHTML = `<span class="art art-${c.id}">${ART[c.id] || ''}<span class="kanji">${c.kanji}</span>${c.map ? '' : `<span class="lock">${LOCK}Coming soon</span>`}</span>
      <span class="cbody"><span class="cname">${c.name}<span class="ck">${c.kanji}</span></span><span class="cblurb">${c.blurb}</span>
      ${c.map ? `<span class="tags">${c.tags.map(x => `<i>${x}</i>`).join('')}</span>` : '<span class="soon">Under construction · no map yet</span>'}</span>`;
    if (!c.map) b.setAttribute('aria-disabled', 'true');
    b.addEventListener('click', () => pickCity(c, b));
    b.addEventListener('dblclick', () => { if (c.map) play(); });
    box.appendChild(b);
  }
  const at = $('arrive');
  ARRIVE.forEach(([name], i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = name;
    b.addEventListener('click', () => { arrive = i; store.set('wl_arrive', name); markArrive(); });
    at.appendChild(b);
  });
  document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => tab(b.dataset.tab)));
  $('enter').addEventListener('click', play);
  $('tBuilder').addEventListener('click', () => builderFn ? builderFn() : location.assign('editor.html?map=town'));
  $('keysHome').append($('keysBox'));
  $('settingsHome').append($('settingsBox'));
  markCity(); markArrive();
}
function markCity() {
  document.querySelectorAll('.city').forEach(b => b.classList.toggle('sel', b.dataset.city === selCity.id));
  $('enter').querySelector('span').textContent = 'Enter ' + selCity.name;
}
function markArrive() { [...$('arrive').children].forEach((b, i) => b.classList.toggle('on', i === arrive)); }
function pickCity(c, b) {
  const note = $('cityNote');
  if (!c.map) {
    b.classList.remove('nope'); void b.offsetWidth; b.classList.add('nope');
    note.textContent = `${c.name} ${c.kanji} is still being built: there is no map for it yet.`;
    return;
  }
  note.textContent = '';
  selCity = c; store.set('wl_city', c.id); markCity();
}
function tab(name) {
  document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  document.querySelectorAll('[data-panel]').forEach(p => p.classList.toggle('on', p.dataset.panel === name));
}
function play() {
  if (chosen || !selCity.map) return;
  chosen = [selCity, ARRIVE[arrive][1]];
  const el = $('title'); el.classList.add('hidden'); setTimeout(() => el.remove(), 800);
  if (playFn) playFn(...chosen); else title.loading(selCity);
}

export const title = {
  // fn(city, hour|null) runs once the player has chosen (at once if they already have)
  onPlay(fn) { playFn = fn; if (chosen) fn(...chosen); },
  onBuilder(fn) { builderFn = fn; },
  // the loading screen for a city (or an unlisted map opened with ?map=)
  loading(city) {
    const ld = $('loading'); if (!ld) return;
    $('loadCity').textContent = city.name.toUpperCase();
    $('loadKanji').textContent = city.kanji || '';
    $('menuPanel').append($('keysBox'), $('settingsBox'));
    if (!titleMode || ld.classList.contains('on')) return;
    ld.classList.add('on');
    if (backdrop) { backdrop.stop(); backdrop.dim(); }
    let i = Math.random() * TIPS.length | 0;
    const tip = () => { const [k, s] = TIPS[i++ % TIPS.length]; $('loadTip').innerHTML = `<b>${k}</b>${s}`; };
    tip(); tipT = setInterval(tip, 5200);
  },
  // the world is ready: wait for a click (pointer lock needs one), then hand over to the game
  ready(onStart) {
    const ld = $('loading');
    clearInterval(tipT);
    ld.classList.add('ready'); $('loadText').textContent = 'Click to start';
    if (backdrop) backdrop.gone();
    let done = false;
    const go = () => {
      if (done) return; done = true;
      removeEventListener('keydown', key);
      onStart();
      ld.classList.add('hidden'); setTimeout(() => ld.remove(), 900);
    };
    const key = e => { if (e.code === 'Enter' || e.code === 'Space') go(); };
    ld.addEventListener('click', go); addEventListener('keydown', key);
  },
};

if (titleMode) { buildMenu(); if (backdrop) backdrop.start(); }
