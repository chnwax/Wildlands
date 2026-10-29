// Road tunnels on the stages: a lined tube from portal to portal, built the way a mountain road tunnel is.
//  - inside: raised walkways with a curb each side, the walls tiled in pale ceramic to above a car's roof, a painted band,
//    then the cast-concrete vault in 10 m rings; luminaires in two rows along the vault's shoulders (closer together
//    near the portals, where eyes come in from the daylight), each throwing a warm pool of light on the walls and the
//    road; jet fans in pairs under the crown, a cable tray and the fire main along the walls, amber delineators, SOS
//    niches and emergency-exit signs
//  - outside: a stone-faced headwall round a protruding concrete hood, a coping on top, wing walls running back into
//    the cut, and the tunnel's name over the mouth
// The game's look flattens scanned photo textures toward their average colour (toon.js), which left a photo-lined
// tube a flat grey-green: every surface here is drawn into its own canvas instead (tiles, joints, stones, signs),
// shared by all stages and kept for the session.
import { THREE, markShared, mulberry32, addBox, smoothstep, lerp } from './core.js';

// ---------------------------------------------------------------- the painted textures
const texCache = new Map();
function canvasTex(key, w, h, draw) {
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h, mulberry32(key.length * 7919 + w));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  markShared(t); texCache.set(key, t); return t;
}
const shade = (hex, k) => { const c = new THREE.Color(hex); c.multiplyScalar(k); return '#' + c.getHexString(); };
// blotches of a darker or lighter tone: the mottling of concrete and the wear of everything
function mottle(g, w, h, rng, n, col, a0, a1, r0, r1) {
  for (let i = 0; i < n; i++) { const x = rng() * w, y = rng() * h, r = r0 + rng() * (r1 - r0), gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, col.replace('A', (a0 + rng() * (a1 - a0)).toFixed(3))); gr.addColorStop(1, col.replace('A', '0')); g.fillStyle = gr;
    for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) { g.save(); g.translate(dx, dy); g.fillRect(x - r, y - r, 2 * r, 2 * r); g.restore(); } }
}
// 1.6 x 1.6 m of wall tiles, 20 x 10 cm, pale and glazed, each its own shade, grout between
const tilesTex = () => canvasTex('tunnel-tiles', 512, 512, (g, w, h, rng) => {
  g.fillStyle = '#9d988c'; g.fillRect(0, 0, w, h);
  const tw = w / 8, th = h / 16;
  for (let r = 0; r < 16; r++) for (let c = 0; c < 8; c++) { const x = c * tw, y = r * th, k = 0.95 + rng() * 0.08 - (rng() < 0.04 ? 0.1 : 0);
    g.fillStyle = shade('#ece6d8', k); g.fillRect(x + 2, y + 2, tw - 4, th - 4);
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(x + 3, y + 3, tw - 6, 2); // (the glaze catching the light on each tile's top edge)
    g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(x + 3, y + th - 5, tw - 6, 2); }
  mottle(g, w, h, rng, 26, 'rgba(70,62,50,A)', 0.03, 0.09, 20, 90);
});
// a 10 m ring of the vault (along) by 5 m of its curve: cast concrete, the formwork's boards, tie holes, the ring joint
const vaultTex = () => canvasTex('tunnel-vault', 1024, 512, (g, w, h, rng) => {
  g.fillStyle = '#b3aea3'; g.fillRect(0, 0, w, h);
  mottle(g, w, h, rng, 70, 'rgba(60,56,50,A)', 0.04, 0.12, 25, 120); mottle(g, w, h, rng, 40, 'rgba(255,250,240,A)', 0.03, 0.08, 20, 90);
  for (let y = 0; y < h; y += h / 8) { g.fillStyle = 'rgba(40,36,30,0.10)'; g.fillRect(0, y, w, 2); g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(0, y + 2, w, 1); } // (the boards)
  for (let x = w / 8; x < w; x += w / 4) for (let y = h / 16; y < h; y += h / 4) { g.fillStyle = 'rgba(30,28,24,0.45)'; g.beginPath(); g.arc(x, y, 3.2, 0, 6.283); g.fill(); }
  g.fillStyle = 'rgba(30,27,22,0.85)'; g.fillRect(0, 0, 6, h); g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(6, 0, 3, h); // (the joint between rings)
  for (let i = 0; i < 9; i++) { const x = rng() * w; g.strokeStyle = 'rgba(70,62,52,0.16)'; g.lineWidth = 1 + rng() * 2; g.beginPath(); g.moveTo(x, 0); for (let y = 0; y < h; y += 16) g.lineTo(x + (rng() - 0.5) * 6, y); g.stroke(); } // (seepage streaks)
});
// 2 x 2 m of walkway: concrete slabs a metre square, their joints, the grit of the road
const walkTex = () => canvasTex('tunnel-walk', 256, 256, (g, w, h, rng) => {
  g.fillStyle = '#a7a196'; g.fillRect(0, 0, w, h); mottle(g, w, h, rng, 30, 'rgba(50,46,40,A)', 0.05, 0.14, 10, 50);
  for (let i = 0; i < 1400; i++) { g.fillStyle = rng() < 0.5 ? 'rgba(40,36,30,0.25)' : 'rgba(255,255,255,0.18)'; g.fillRect(rng() * w, rng() * h, 1.5, 1.5); }
  g.fillStyle = 'rgba(35,32,28,0.7)'; g.fillRect(0, 0, w, 2); g.fillRect(0, h / 2, w, 2); g.fillRect(0, 0, 2, h); g.fillRect(w / 2, 0, 2, h);
});
// 3 x 3 m of the portals' facing: coursed rubble stone, each stone its own tone and lit from above, deep mortar joints
const stoneTex = () => canvasTex('tunnel-stone', 1024, 1024, (g, w, h, rng) => {
  g.fillStyle = '#6d675d'; g.fillRect(0, 0, w, h);
  let y = 0; while (y < h) { const rh = Math.min(h - y, (0.32 + rng() * 0.24) / 3 * h); let x = -rng() * 120;
    while (x < w) { const sw = (0.45 + rng() * 0.6) / 3 * w, base = ['#a39c8f', '#958d80', '#aca394', '#8e887e', '#9f9483'][Math.floor(rng() * 5)], k = 0.86 + rng() * 0.22;
      const x0 = x + 5, y0 = y + 5, x1 = x + sw - 5, y1 = y + rh - 5, j = () => (rng() - 0.5) * 7;
      for (const dx of x1 > w ? [0, -w] : [0]) { g.save(); g.translate(dx, 0);
        const gr = g.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, shade(base, k * 1.12)); gr.addColorStop(1, shade(base, k * 0.8)); g.fillStyle = gr;
        g.beginPath(); g.moveTo(x0 + j(), y0 + j()); g.lineTo(x1 + j(), y0 + j()); g.lineTo(x1 + j(), y1 + j()); g.lineTo(x0 + j(), y1 + j()); g.closePath(); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(x0 + 3, y0 + 2, x1 - x0 - 6, 3); g.restore(); }
      x += sw; }
    y += rh; }
  mottle(g, w, h, rng, 60, 'rgba(40,36,30,A)', 0.05, 0.16, 20, 110);
});
// plain concrete for the hood and the coping: mottled, weathered darker toward the bottom
const concTex = () => canvasTex('tunnel-concrete', 512, 512, (g, w, h, rng) => {
  g.fillStyle = '#bcb7ac'; g.fillRect(0, 0, w, h); mottle(g, w, h, rng, 50, 'rgba(60,56,50,A)', 0.04, 0.12, 20, 90); mottle(g, w, h, rng, 30, 'rgba(255,252,245,A)', 0.04, 0.1, 15, 70);
  for (let i = 0; i < 2000; i++) { g.fillStyle = 'rgba(40,36,30,0.18)'; g.fillRect(rng() * w, rng() * h, 1.2, 1.2); }
});
// the signs: drawn to their own canvases (crisp, lit from inside)
function signTex(key, w, h, draw) { const t = canvasTex(key, w, h, draw); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.anisotropy = 4; return t; }
const nameSign = (name, len) => signTex('tunnel-name:' + name + len, 1024, 220, g => {
  g.fillStyle = '#f2f2ee'; g.fillRect(0, 0, 1024, 220); g.fillStyle = '#1b4f9c'; g.fillRect(10, 10, 1004, 200);
  g.strokeStyle = '#f2f2ee'; g.lineWidth = 6; g.strokeRect(22, 22, 980, 176);
  // (the tunnel pictogram: an arch over a road)
  g.fillStyle = '#f2f2ee'; g.beginPath(); g.moveTo(52, 186); g.lineTo(52, 104); g.arc(122, 104, 70, Math.PI, 0); g.lineTo(192, 186); g.closePath(); g.fill();
  g.fillStyle = '#1b4f9c'; g.beginPath(); g.moveTo(76, 186); g.lineTo(76, 108); g.arc(122, 108, 46, Math.PI, 0); g.lineTo(168, 186); g.closePath(); g.fill();
  g.fillStyle = '#f2f2ee'; g.fillRect(118, 130, 8, 22); g.fillRect(118, 162, 8, 20);
  g.textBaseline = 'middle'; const title = ('TUNEL ' + name).toUpperCase(); let fs = 78; do { g.font = 'bold ' + fs + 'px "Segoe UI", Arial, sans-serif'; fs -= 2; } while (g.measureText(title).width > 760 && fs > 30); g.fillText(title, 228, 90); // (the name fitted to the plate)
  g.font = '600 52px "Segoe UI", Arial, sans-serif'; g.fillText(len + ' m', 228, 162);
});
const sosSign = () => signTex('tunnel-sos', 256, 256, g => {
  g.fillStyle = '#1b4f9c'; g.fillRect(0, 0, 256, 256); g.strokeStyle = '#f2f2ee'; g.lineWidth = 8; g.strokeRect(10, 10, 236, 236);
  g.fillStyle = '#f2f2ee'; g.font = 'bold 86px "Segoe UI", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('SOS', 128, 78);
  // (a telephone handset and an extinguisher)
  g.lineWidth = 14; g.lineCap = 'round'; g.strokeStyle = '#f2f2ee'; g.beginPath(); g.arc(80, 178, 34, Math.PI * 0.85, Math.PI * 2.15); g.stroke();
  g.fillStyle = '#d8312a'; g.fillRect(160, 150, 40, 70); g.fillRect(170, 136, 20, 16); g.fillStyle = '#f2f2ee'; g.fillRect(166, 168, 28, 10);
});
const exitSign = () => signTex('tunnel-exit', 512, 160, g => {
  g.fillStyle = '#12844a'; g.fillRect(0, 0, 512, 160); g.strokeStyle = '#f2f2ee'; g.lineWidth = 6; g.strokeRect(8, 8, 496, 144);
  g.fillStyle = '#f2f2ee'; // (a running figure toward a door)
  g.beginPath(); g.arc(64, 42, 13, 0, 6.283); g.fill(); g.lineWidth = 11; g.lineCap = 'round'; g.strokeStyle = '#f2f2ee';
  g.beginPath(); g.moveTo(60, 60); g.lineTo(50, 98); g.lineTo(30, 126); g.moveTo(50, 98); g.lineTo(76, 112); g.lineTo(84, 136); g.moveTo(58, 70); g.lineTo(84, 82); g.moveTo(58, 70); g.lineTo(34, 84); g.stroke();
  g.fillRect(100, 32, 46, 104); g.fillStyle = '#12844a'; g.fillRect(108, 40, 30, 88);
  g.fillStyle = '#f2f2ee'; g.font = 'bold 48px "Segoe UI", Arial, sans-serif'; g.textBaseline = 'middle'; g.fillText('WYJŚCIE', 168, 62); g.font = '600 34px "Segoe UI", Arial, sans-serif'; g.fillText('AWARYJNE  →', 168, 112);
});

// ---------------------------------------------------------------- materials
// the lamps' light on a surface: a per-vertex weight (aGlow) times the lamps' colour, added as emitted light over the
// surface's own colour; the tube is otherwise darkened, so its rhythm of light pools reads as lamplight
function lampLit(mat, col) {
  const uGlow = { value: new THREE.Color(col) };
  mat.onBeforeCompile = sh => { sh.uniforms.uGlow = uGlow;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aGlow; varying float vGlow;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uGlow; varying float vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uGlow * vGlow * diffuseColor.rgb;'); };
  mat.customProgramCacheKey = () => 'tunnelLit'; return mat;
}
function materials(cfg) {
  const lampCol = cfg.tunnelLight || 0xffd8a4;
  const tex = (t, rx = 1, ry = 1) => { const c = t.clone(); c.repeat.set(rx, ry); c.needsUpdate = true; return c; };
  return {
    lampCol,
    tiles: lampLit(new THREE.MeshStandardMaterial({ map: tilesTex(), roughness: 0.32, metalness: 0, vertexColors: true, side: THREE.DoubleSide }), lampCol),
    vault: lampLit(new THREE.MeshStandardMaterial({ map: vaultTex(), roughness: 0.92, vertexColors: true, side: THREE.DoubleSide }), lampCol),
    walk: lampLit(new THREE.MeshStandardMaterial({ map: walkTex(), roughness: 0.9, vertexColors: true, side: THREE.DoubleSide }), lampCol),
    curb: lampLit(new THREE.MeshStandardMaterial({ color: 0xd9d4c8, roughness: 0.7, vertexColors: true, side: THREE.DoubleSide }), lampCol),
    band: lampLit(new THREE.MeshStandardMaterial({ color: 0x2f5f8e, roughness: 0.45, vertexColors: true, side: THREE.DoubleSide }), lampCol),
    pool: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -10, toneMapped: true }),
    metal: new THREE.MeshStandardMaterial({ color: 0x7d8387, roughness: 0.45, metalness: 0.6 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x2a2c2e, roughness: 0.6, metalness: 0.3 }),
    pipe: new THREE.MeshStandardMaterial({ color: 0x8e2f27, roughness: 0.55, metalness: 0.2 }),
    lens: new THREE.MeshStandardMaterial({ color: 0x111111, emissive: lampCol, emissiveIntensity: 4.5, roughness: 0.4 }),
    amber: new THREE.MeshStandardMaterial({ color: 0x221100, emissive: 0xffa21e, emissiveIntensity: 2.2, roughness: 0.5 }),
    stone: new THREE.MeshStandardMaterial({ map: tex(stoneTex(), 1 / 3, 1 / 3), roughness: 0.95, side: THREE.DoubleSide }),
    stoneW: new THREE.MeshStandardMaterial({ map: stoneTex(), roughness: 0.95, side: THREE.DoubleSide }), // (the wing walls: uv already in 3 m)
    conc: new THREE.MeshStandardMaterial({ map: tex(concTex(), 1 / 3, 1 / 3), roughness: 0.88, side: THREE.DoubleSide }), // (the hood's inner faces seen from the road whichever way they wind)
    sign: (() => { const ms = new Map(); return t => ms.get(t) || ms.set(t, new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.5 })).get(t); })(),
    door: new THREE.MeshStandardMaterial({ color: 0xc9772a, roughness: 0.6, emissive: 0x2a1404 }),
  };
}

// ---------------------------------------------------------------- the tube
// ctx: { P, T, N, left, surfY, RW, cfg, ground(x, z), chunked(parent, geo, mat, matrices, opts), names }
export function buildTunnels(group, tunnels, ctx) {
  if (!tunnels.length) return;
  const { P, T, N, left, surfY, RW, cfg, ground, chunked } = ctx, M = materials(cfg);
  const hw = RW + 1.25, H = cfg.tunnelH || 7.2, wallH = 4.0, walkH = 0.25, tileTop = 3.3, bandTop = 3.55;
  const vaultV = u => wallH + (H - wallH) * Math.sqrt(Math.max(0, 1 - (u / hw) ** 2)); // (the vault's height over a point across)
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0), FWD = new THREE.Vector3(0, 0, 1), V = new THREE.Vector3(), S = new THREE.Vector3();
  const housings = [], lenses = [], fans = [], brackets = [], deli = [];
  tunnels.forEach(([a0, b0], k) => {
    const a = a0 - 14, b = b0 + 14, len = Math.round(b - a);
    // (the distance along the tube at each station, and the luminaires: every 6 m, every 3 m in the first and last 30 m)
    const AL = new Float32Array(b - a + 1); for (let i = a + 1; i <= b; i++) AL[i - a] = AL[i - a - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
    const L = AL[b - a], lu = hw * 0.56, lv = vaultV(lu) - 0.14, rows = [];
    for (let s = 2; s < L - 1; s += s < 30 || s > L - 30 ? 3 : 6) rows.push(s);
    const glowAt = (al, u, v) => { let g = 0; for (const s of rows) { const d = al - s; if (d < -14 || d > 14) continue; for (const su of [-lu, lu]) { const d2 = d * d + (u - su) ** 2 + (v - lv) ** 2; g += 1 / (1 + d2 / 5.5); } } return Math.min(1.6, g * 0.55); };
    // a profile [u, v] swept along the tube, a row a metre; uv in metres (along / uA, round the profile / uP); the
    // vertex colour from shadeV(v) (grime low down, soot up the vault), the lamplight weight per vertex
    const sweep = (prof, mat, { uA = 3, uP = 3, shadeV = () => 0.8, glow = true, closed = false, offY = 0 } = {}) => {
      const np = prof.length + (closed ? 1 : 0), per = [0]; for (let j = 1; j < np; j++) per.push(per[j - 1] + Math.hypot(prof[j % prof.length][0] - prof[j - 1][0], prof[j % prof.length][1] - prof[j - 1][1]));
      const pos = [], uv = [], col = [], gl = [], idx = []; let rowsN = 0;
      for (let i = a; i <= b; i++) { const [px, pz] = P[i], [lx, lz] = left(i), y = surfY(i, 0) + offY, al = AL[i - a];
        for (let j = 0; j < np; j++) { const [u, v] = prof[j % prof.length]; pos.push(px + lx * u, y + v, pz + lz * u); uv.push(al / uA, per[j] / uP); const c = shadeV(v, al); col.push(c, c, c); gl.push(glow ? glowAt(al, u, v) : 0); }
        rowsN++; }
      for (let r = 0; r + 1 < rowsN; r++) for (let j = 0; j + 1 < np; j++) { const o = r * np + j; idx.push(o, o + np, o + 1, o + 1, o + np, o + np + 1); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('aGlow', new THREE.Float32BufferAttribute(gl, 1)); g.setIndex(idx); g.computeVertexNormals();
      const m = new THREE.Mesh(g, mat); m.castShadow = false; m.receiveShadow = true; m.name = 'rally-tunnel'; group.add(m); return m; };
    // (the walls: grime from the road up to a metre, the tiles' own pale above; the vault darkened by the exhaust toward
    // its crown, the lamps lighting it in pools)
    const grime = v => lerp(0.3, 0.7, smoothstep(walkH, 1.4, v)), soot = v => lerp(0.52, 0.34, smoothstep(bandTop, H, v));
    for (const sd of [-1, 1]) {
      const w0 = sd * (RW + 0.15), w1 = sd * hw;
      sweep(sd > 0 ? [[w0, 0.0], [w0, walkH]] : [[w0, walkH], [w0, 0.0]], M.curb, { shadeV: () => 0.78 });                  // the curb's face
      sweep(sd > 0 ? [[w0, walkH], [w1, walkH]] : [[w1, walkH], [w0, walkH]], M.walk, { uA: 2, uP: 2, shadeV: () => 0.72 }); // the walkway
      sweep(sd > 0 ? [[w1, walkH], [w1, tileTop]] : [[w1, tileTop], [w1, walkH]], M.tiles, { uA: 1.6, uP: 1.6, shadeV: grime }); // the tiles
      sweep(sd > 0 ? [[w1, tileTop], [w1, bandTop]] : [[w1, bandTop], [w1, tileTop]], M.band, { shadeV: () => 0.85 });     // the band
    }
    const vault = [[hw, bandTop], [hw, wallH]]; for (let s = 1; s < 22; s++) { const t = Math.PI * s / 22; vault.push([hw * Math.cos(t), wallH + (H - wallH) * Math.sin(t)]); } vault.push([-hw, wallH], [-hw, bandTop]);
    sweep(vault, M.vault, { uA: 10, uP: 5, shadeV: soot });
    // (the light pools on the road: the same weights, laid over the asphalt, added to it)
    { const prof = []; for (let s = 0; s <= 8; s++) prof.push([-RW + 2 * RW * s / 8, 0.03]); const m = sweep(prof, M.pool, { glow: false, shadeV: () => 0 });
      const c = m.geometry.attributes.color, pa = m.geometry.attributes.position, lc = new THREE.Color(M.lampCol); let o = 0;
      for (let i = a; i <= b; i++) for (const [u] of prof) { const w = glowAt(AL[i - a], u, 0.03) * 0.55; c.setXYZ(o++, lc.r * w, lc.g * w, lc.b * w); }
      c.needsUpdate = true; void pa; m.receiveShadow = false; m.renderOrder = 2; }
    // (the services along the walls: a cable tray on the left, the fire main on the right)
    sweep([[hw - 0.02, 4.05], [hw - 0.34, 4.05], [hw - 0.34, 4.17], [hw - 0.3, 4.17], [hw - 0.3, 4.09], [hw - 0.02, 4.09]], M.dark, { glow: false, shadeV: () => 1 });
    { const pr = []; for (let s = 0; s < 8; s++) { const t = s / 8 * 6.283; pr.push([-hw + 0.2 + 0.1 * Math.cos(t), 4.3 + 0.1 * Math.sin(t)]); } sweep(pr, M.pipe, { glow: false, closed: true, shadeV: () => 1 }); }
    // (the luminaires: a housing tilted to the vault, its lens lit)
    const tilt = Math.atan2(lu / hw ** 2, Math.sqrt(Math.max(1e-4, 1 - (lu / hw) ** 2)) / (H - wallH));
    const at = (al) => { let i = a; while (i < b && AL[i + 1 - a] < al) i++; return i; };
    for (const s of rows) { const i = at(s), [px, pz] = P[i], [tx, tz] = T[i], [lx, lz] = left(i), y = surfY(i, 0), yaw = Math.atan2(tx, tz);
      for (const su of [-1, 1]) { q.setFromAxisAngle(UP, yaw); q2.setFromAxisAngle(FWD, su * tilt); q.multiply(q2); // (its lens turned down toward the middle of the road)
        V.set(px + lx * su * lu, y + lv + 0.02, pz + lz * su * lu); m4.compose(V, q, S.set(1, 1, 1)); housings.push(m4.clone());
        V.y -= 0.075; m4.compose(V, q, S.set(1, 1, 1)); lenses.push(m4.clone()); } }
    // (jet fans: a pair under the crown every 90 m, clear of the portals)
    for (let s = 40; s < L - 40; s += 90) { const i = at(s), [px, pz] = P[i], [tx, tz] = T[i], [lx, lz] = left(i), y = surfY(i, 0), yaw = Math.atan2(tx, tz);
      for (const su of [-1, 1]) { const u = su * 1.9, v = vaultV(u) - 0.95; q.setFromAxisAngle(UP, yaw); V.set(px + lx * u, y + v, pz + lz * u); m4.compose(V, q, S.set(1, 1, 1)); fans.push(m4.clone());
        for (const d of [-0.9, 0.9]) { V.set(px + lx * u + tx * d, y + v + 0.6, pz + lz * u + tz * d); m4.compose(V, q, S.set(1, 1, 1)); brackets.push(m4.clone()); } } }
    // (amber delineators on both walls every 12 m)
    for (let s = 6; s < L - 3; s += 12) { const i = at(s), [px, pz] = P[i], [tx, tz] = T[i], [lx, lz] = left(i), y = surfY(i, 0), yaw = Math.atan2(tx, tz);
      for (const su of [-1, 1]) { q.setFromAxisAngle(UP, yaw + su * Math.PI / 2); V.set(px + lx * su * (hw - 0.03), y + 1.0, pz + lz * su * (hw - 0.03)); m4.compose(V, q, S.set(1, 1, 1)); deli.push(m4.clone()); } }
    // (SOS niches every 75 m, side by side in turn; the way out signed every 150 m)
    const plate = (mat, w, h, s, su, v) => { const i = at(s), [px, pz] = P[i], [tx, tz] = T[i], [lx, lz] = left(i), y = surfY(i, 0);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.position.set(px + lx * su * (hw - 0.04), y + v, pz + lz * su * (hw - 0.04)); m.rotation.y = Math.atan2(tx, tz) + su * Math.PI / 2; m.name = 'rally-tunnel-sign'; group.add(m); m.updateMatrixWorld(true); return m; };
    let side = 1; for (let s = 37; s < L - 20; s += 75, side = -side) { plate(M.sign(sosSign()), 0.7, 0.7, s, side, 2.4); plate(M.door, 1.1, 1.95, s + 1.2, side, walkH + 0.98); }
    for (let s = 75; s < L - 30; s += 150) plate(M.sign(exitSign()), 1.6, 0.5, s, -side, 2.9);
    // (the walls against the cars)
    for (let i = a; i < b; i += 4) { const j = Math.min(N - 1, i + 4), [ax, az] = P[i], [bx, bz] = P[j], y = surfY(i, 0), l = Math.hypot(bx - ax, bz - az), yaw = Math.atan2(bx - ax, bz - az);
      for (const sd of [-1, 1]) { const [lx, lz] = left(i), u = sd * (hw + 0.25); addBox((ax + bx) / 2 + lx * u, (az + bz) / 2 + lz * u, 0.3, l / 2 + 0.2, yaw, y - 1, y + H); } }
    // ---- the portals
    const arch = [[-hw, -0.4], [-hw, wallH]]; for (let s = 1; s < 22; s++) { const t = Math.PI * (1 - s / 22); arch.push([hw * Math.cos(t), wallH + (H - wallH) * Math.sin(t)]); } arch.push([hw, wallH], [hw, -0.4]);
    const name = (ctx.names && ctx.names[k]) || '';
    for (const [i, dir] of [[a, -1], [b, 1]]) {
      const [px, pz] = P[i], [tx, tz] = T[i], [lx, lz] = left(i), y = surfY(i, 0), yaw = Math.atan2(tx, tz), W2 = hw + 6.5, top = H + 4.4;
      const place = (m, out, v = 0) => { m.position.set(px + tx * out * dir, y + v, pz + tz * out * dir); m.rotation.y = yaw; m.castShadow = m.receiveShadow = true; group.add(m); m.updateMatrixWorld(true); return m; };
      // (the headwall, stone-faced, with the arch's opening)
      { const sh = new THREE.Shape(); sh.moveTo(-W2, -1.8); sh.lineTo(W2, -1.8); sh.lineTo(W2, top); sh.lineTo(-W2, top); sh.closePath();
        const ho = new THREE.Path(); ho.moveTo(-hw - 0.9, -0.4); ho.lineTo(-hw - 0.9, wallH); for (let s = 1; s < 22; s++) { const t = Math.PI * (1 - s / 22); ho.lineTo((hw + 0.9) * Math.cos(t), wallH + (H + 0.9 - wallH) * Math.sin(t)); } ho.lineTo(hw + 0.9, wallH); ho.lineTo(hw + 0.9, -0.4); ho.closePath(); sh.holes.push(ho);
        const g = new THREE.ExtrudeGeometry(sh, { depth: 1.2, bevelEnabled: false, curveSegments: 4 }); g.translate(0, 0, -0.6); place(new THREE.Mesh(g, M.stone), 0.15); }
      // (the hood: a concrete arch ring standing out of the headwall, its edge rounded)
      { const sh = new THREE.Shape(); sh.moveTo(-hw - 0.9, -0.4); sh.lineTo(-hw - 0.9, wallH); for (let s = 1; s < 22; s++) { const t = Math.PI * (1 - s / 22); sh.lineTo((hw + 0.9) * Math.cos(t), wallH + (H + 0.9 - wallH) * Math.sin(t)); } sh.lineTo(hw + 0.9, wallH); sh.lineTo(hw + 0.9, -0.4); sh.closePath();
        const ho = new THREE.Path(); ho.moveTo(arch[0][0], arch[0][1]); for (const [u, v] of arch.slice(1)) ho.lineTo(u, v); ho.closePath(); sh.holes.push(ho);
        const g = new THREE.ExtrudeGeometry(sh, { depth: 1.7, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.1, bevelSegments: 2, curveSegments: 4 }); g.translate(0, 0, -0.85); place(new THREE.Mesh(g, M.conc), 0.75); }
      // (the coping along the top, and the wing walls running back into the cut)
      { const g = new THREE.BoxGeometry(2 * W2 + 0.7, 0.5, 1.7); const m = new THREE.Mesh(g, M.conc); place(m, 0.15, top + 0.25); }
      for (const su of [-1, 1]) {
        const x0 = px + lx * su * W2, z0 = pz + lz * su * W2, ox = tx * dir, oz = tz * dir, x1 = x0 + ox * 11 + lx * su * 4.5, z1 = z0 + oz * 11 + lz * su * 4.5;
        const g0 = ground(x0, z0), g1 = ground(x1, z1), t0 = y + top - 0.1, t1 = Math.max(g1 + 0.9, y + 1.2), f0 = Math.min(g0, y) - 2.5, f1 = Math.min(g1, y) - 2.5, th = 0.8;
        const nx = -(z1 - z0), nz = x1 - x0, nl = Math.hypot(nx, nz), ux = nx / nl * th / 2, uz = nz / nl * th / 2, L2 = Math.hypot(x1 - x0, z1 - z0);
        const c = [[x0 - ux, f0, z0 - uz], [x1 - ux, f1, z1 - uz], [x1 - ux, t1, z1 - uz], [x0 - ux, t0, z0 - uz], [x0 + ux, f0, z0 + uz], [x1 + ux, f1, z1 + uz], [x1 + ux, t1, z1 + uz], [x0 + ux, t0, z0 + uz]];
        // (each face's uv in metres in its own plane: along the wall and up its faces, across its top and ends)
        const faces = [[0, 1, 2, 3, 'side'], [5, 4, 7, 6, 'side'], [3, 2, 6, 7, 'top'], [1, 5, 6, 2, 'end'], [4, 0, 3, 7, 'end']], pos = [], uv = [], idx = [];
        for (const f of faces) { const o = pos.length / 3; for (const n of f.slice(0, 4)) { const p = c[n], al = Math.hypot(p[0] - x0, p[2] - z0), across = n < 4 ? 0 : th; pos.push(...p);
            uv.push(f[4] === 'end' ? across / 3 : al / 3, f[4] === 'top' ? across / 3 : (p[1] - y) / 3); } idx.push(o, o + 1, o + 2, o, o + 2, o + 3); }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
        const m = new THREE.Mesh(g, M.stoneW); m.castShadow = m.receiveShadow = true; m.name = 'rally-tunnel-wing'; group.add(m); m.updateMatrixWorld(true);
        addBox((x0 + x1) / 2, (z0 + z1) / 2, th / 2, L2 / 2, Math.atan2(x1 - x0, z1 - z0), f0, Math.max(t0, t1)); }
      // (the tunnel's name over the mouth)
      if (name) { const m = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 1.2), M.sign(nameSign(name, len))); place(m, 0.8, H + 2.4); if (dir < 0) m.rotation.y = yaw + Math.PI; m.updateMatrixWorld(true); }
    }
  });
  const housingG = new THREE.BoxGeometry(0.42, 0.13, 1.5), lensG = new THREE.BoxGeometry(0.32, 0.03, 1.36);
  const fanG = new THREE.CylinderGeometry(0.56, 0.56, 3.0, 18, 1, true).rotateX(Math.PI / 2), fanEndG = new THREE.CylinderGeometry(0.5, 0.5, 2.6, 18).rotateX(Math.PI / 2), bracketG = new THREE.BoxGeometry(0.08, 0.7, 0.08);
  chunked(group, housingG, M.dark, housings, { shadow: false, name: 'rally-tunnel-luminaires' });
  chunked(group, lensG, M.lens, lenses, { shadow: false, receive: false, name: 'rally-tunnel-lamps' });
  chunked(group, fanG, M.metal, fans, { shadow: false, name: 'rally-tunnel-fans' });
  chunked(group, fanEndG, M.dark, fans, { shadow: false, name: 'rally-tunnel-fan-cores' });
  chunked(group, bracketG, M.metal, brackets, { shadow: false, name: 'rally-tunnel-fan-brackets' });
  chunked(group, new THREE.PlaneGeometry(0.1, 0.2), M.amber, deli, { shadow: false, receive: false, name: 'rally-tunnel-delineators' });
}
