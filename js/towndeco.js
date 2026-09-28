// Town dressing for Sakuragawa: the things that make a street feel lived in. An elementary school with its sports
// ground, a playground park, zebra crossings, shop banners and signboards, bus stops, post boxes, garbage points,
// drying racks, mailboxes, rooftop tanks, and people walking the streets (instanced, animated in the vertex shader).
import { THREE, scene, S, mulberry32, clamp, lerp, addBox, addCircle } from './core.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTex, signMesh, JP_FONT, lampPoints, materials } from './townkit.js';
import { wallFill, reveals, windowUnit } from './building.js';

// chain-link fence mesh: a diamond wire pattern, alpha-tested so it stays see-through (one texture repeat = 0.5 m)
export function chainMaterial() {
  const MT = materials();
  if (MT.chain) return MT.chain;
  const t = canvasTex(64, 64, (g, W, H) => {
    g.clearRect(0, 0, W, H); g.strokeStyle = '#ffffff'; g.lineWidth = 3.2;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(W, H); g.moveTo(W, 0); g.lineTo(0, H); g.stroke();
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  MT.chain = new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true, roughness: 0.5, metalness: 0.4 });
  // mesh wire keeps its coverage down the mip chain (alpha scaled by mip level), so fences and nets neither fade out nor
  // shimmer into moire at distance; alpha-to-coverage (MSAA) then resolves the thin wires smoothly
  MT.chain.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <alphatest_fragment>', `
    #ifdef USE_MAP
      { vec2 tdx = dFdx(vMapUv * 64.0), tdy = dFdy(vMapUv * 64.0); float lod = max(0.0, 0.5 * log2(max(dot(tdx, tdx), dot(tdy, tdy))));
        diffuseColor.a *= 1.0 + lod * 0.32; }
    #endif
    #include <alphatest_fragment>`); };
  MT.chain.customProgramCacheKey = () => 'chainAA';
  return MT.chain;
}

const pick = (rng, a) => a[Math.floor(rng() * a.length)];
const WHITE = [0.97, 0.97, 0.95];

// ---------------------------------------------------------------- street furniture
// nobori: tall cloth shop banner on a pole (local +Z faces the street)
export function nobori(B, x, y, z, r, col) {
  B.frame(x, y, z, r);
  const pc = { color: [0.86, 0.87, 0.88] };
  B.box('concrete', 0, 0, 0, 0.32, 0.12, 0.32, { color: [0.3, 0.3, 0.32] });
  B.cyl('alu', 0, 0.12, 0, 0.022, 0.022, 2.9, 6, pc);
  B.box('alu', 0.24, 2.9, 0, 0.48, 0.025, 0.025, pc);
  const a = [0.03, 0.85, 0], b = [0.48, 0.85, 0], c = [0.48, 2.88, 0], d = [0.03, 2.88, 0];
  B.quad('plain', a, b, c, d, { color: col }); B.quad('plain', b, a, d, c, { color: col });
  for (const s of [1, -1]) { // white lettering band down the middle, both faces
    const z = s * 0.006, p = [[0.19, 1.05, z], [0.32, 1.05, z], [0.32, 2.62, z], [0.19, 2.62, z]];
    if (s > 0) B.quad('plain', ...p, { color: WHITE }); else B.quad('plain', p[1], p[0], p[3], p[2], { color: WHITE });
    for (let k = 0; k < 5; k++) B.box('plain', 0.255, 1.2 + k * 0.28, z * 2, 0.08, 0.14, 0.004, { color: col.map(v => v * 0.55) }); // glyph blocks
  }
}
// A-frame standing signboard with a chalk menu panel
export function standBoard(B, x, y, z, r, col) {
  B.frame(x, y, z, r);
  for (const s of [-1, 1]) {
    const zz = s * 0.22, top = s * 0.03;
    const q = [[-0.3, 0, zz], [0.3, 0, zz], [0.3, 1.0, top], [-0.3, 1.0, top]];
    if (s > 0) B.quad('plain', ...q, { color: col }); else B.quad('plain', q[1], q[0], q[3], q[2], { color: col });
    const p = [[-0.24, 0.12, zz * 0.98 + s * 0.012], [0.24, 0.12, zz * 0.98 + s * 0.012], [0.24, 0.85, top + s * 0.012 + zz * 0.15], [-0.24, 0.85, top + s * 0.012 + zz * 0.15]];
    if (s > 0) B.quad('dark', ...p, { color: [0.2, 0.28, 0.24] }); else B.quad('dark', p[1], p[0], p[3], p[2], { color: [0.2, 0.28, 0.24] });
  }
}
// red Japanese pillar post box
export function postBox(B, x, y, z, r) {
  B.frame(x, y, z, r);
  const red = [0.86, 0.14, 0.1];
  B.bbox('concrete', 0, 0, 0, 0.5, 0.1, 0.5, 0.012, { color: [0.7, 0.7, 0.68] });
  B.cyl('plain', 0, 0.1, 0, 0.23, 0.23, 1.05, 14, { color: red });
  B.cyl('plain', 0, 1.15, 0, 0.25, 0.08, 0.2, 14, { color: red, cap: true });
  B.bbox('dark', 0, 0.95, 0.225, 0.22, 0.04, 0.03, 0.012);
  B.bbox('plain', 0, 0.55, 0.23, 0.2, 0.26, 0.02, 0.012, { color: WHITE });
  const p = B.P([0, 0, 0]); addCircle(p[0], p[2], 0.3);
}
// bus stop: sign pole, timetable, shelter with a bench
export function busStop(B, x, y, z, r, shelter = true) {
  B.frame(x, y, z, r);
  B.bbox('concrete', 0, 0, 0, 0.5, 0.15, 0.5, 0.012, { color: [0.6, 0.6, 0.6] });
  B.cyl('alu', 0, 0.15, 0, 0.035, 0.035, 2.35, 6, { color: [0.85, 0.86, 0.88] });
  B.cyl('plain', 0, 2.1, 0, 0.3, 0.3, 0.06, 16, { color: [0.2, 0.42, 0.78], cap: true });
  B.cyl('plain', 0, 2.1, 0, 0.24, 0.24, 0.065, 16, { color: WHITE, cap: true });
  B.bbox('plain', 0, 1.1, 0.04, 0.34, 0.5, 0.04, 0.012, { color: WHITE });
  if (!shelter) { const p = B.P([0, 0, 0]); addCircle(p[0], p[2], 0.2); return; }
  // shelter
  B.frame(...B.P([2.2, 0, -0.6]), r);
  for (const sx of [-1.4, 1.4]) B.bbox('alu', sx, 0, -0.55, 0.08, 2.4, 0.08, 0.012, { color: [0.3, 0.45, 0.62] });
  B.bbox('roofMetal', 0, 2.4, -0.1, 3.3, 0.08, 1.5, 0.012, { color: [0.3, 0.45, 0.62] });
  B.quad('poly', [1.4, 0.3, -0.58], [-1.4, 0.3, -0.58], [-1.4, 2.3, -0.58], [1.4, 2.3, -0.58]);
  B.bbox('wood', 0, 0.42, -0.3, 2.4, 0.06, 0.38, 0.012, { color: [0.8, 0.58, 0.4] });
  for (const sx of [-1, 1]) B.bbox('alu', sx, 0, -0.3, 0.05, 0.42, 0.3, 0.012, { color: [0.6, 0.62, 0.64] });
  const p = B.P([0, 0, -0.35]); addBox(p[0], p[2], 1.5, 0.3, r, y - 1, y + 2.4);
}
// garbage collection point: a folding green cage with a few bags
export function garbagePoint(B, x, y, z, r, rng) {
  B.frame(x, y, z, r);
  const g = [0.28, 0.58, 0.38];
  for (const [sx, sz] of [[-0.8, -0.45], [0.8, -0.45], [-0.8, 0.45], [0.8, 0.45]]) B.box('alu', sx, 0, sz, 0.04, 0.95, 0.04, { color: g });
  for (const yy of [0.02, 0.93]) { B.box('alu', 0, yy, -0.45, 1.64, 0.03, 0.03, { color: g }); B.box('alu', 0, yy, 0.45, 1.64, 0.03, 0.03, { color: g }); B.box('alu', -0.8, yy, 0, 0.03, 0.03, 0.94, { color: g }); B.box('alu', 0.8, yy, 0, 0.03, 0.03, 0.94, { color: g }); }
  for (let k = 0; k < 7; k++) B.box('alu', -0.8 + k * 0.267, 0.02, 0.45, 0.012, 0.92, 0.012, { color: g });
  const n = 1 + Math.floor(rng() * 4);
  for (let k = 0; k < n; k++) B.box('plain', -0.5 + k * 0.33, 0.02, (rng() - 0.5) * 0.3, 0.3, 0.3 + rng() * 0.15, 0.3, { color: rng() < 0.6 ? [0.95, 0.95, 0.9] : [0.95, 0.86, 0.45] });
}
// drying rack (monohoshi) with laundry, local +X along the poles
export function dryingRack(B, x, y, z, r, rng, len = 2.4) {
  B.frame(x, y, z, r);
  const c = { color: [0.72, 0.74, 0.76] };
  for (const sx of [-len / 2, len / 2]) { B.box('concrete', sx, 0, 0, 0.3, 0.15, 0.3, { color: [0.6, 0.6, 0.6] }); B.box('alu', sx, 0, 0, 0.05, 1.8, 0.05, c); B.box('alu', sx, 1.72, 0, 0.05, 0.05, 0.9, c); }
  for (const sz of [-0.4, 0.4]) B.box('alu', 0, 1.72, sz, len + 0.2, 0.035, 0.035, c);
  const cols = [[0.97, 0.97, 0.95], [0.5, 0.66, 0.92], [0.98, 0.72, 0.74], [0.98, 0.9, 0.55], [0.62, 0.84, 0.66], [0.9, 0.9, 0.92]];
  for (const sz of [-0.4, 0.4]) for (let k = 0; k < 4; k++) if (rng() < 0.75) {
    const cx = -len / 2 + 0.35 + k * (len - 0.7) / 3, w = 0.35 + rng() * 0.25, h = 0.45 + rng() * 0.35, col = pick(rng, cols);
    B.quad('plain', [cx - w / 2, 1.7 - h, sz], [cx + w / 2, 1.7 - h, sz], [cx + w / 2, 1.7, sz], [cx - w / 2, 1.7, sz], { color: col });
    B.quad('plain', [cx + w / 2, 1.7 - h, sz], [cx - w / 2, 1.7 - h, sz], [cx - w / 2, 1.7, sz], [cx + w / 2, 1.7, sz], { color: col });
  }
}
export function mailbox(B, x, y, z, r, col) {
  B.frame(x, y, z, r);
  B.bbox('alu', 0, 0, 0, 0.06, 0.95, 0.06, 0.012, { color: [0.4, 0.4, 0.42] });
  B.bbox('plain', 0, 0.95, 0, 0.36, 0.34, 0.22, 0.012, { color: col });
  B.bbox('dark', 0, 1.18, 0.112, 0.22, 0.03, 0.01, 0.012);
  B.bbox('plain', 0, 1.02, 0.112, 0.2, 0.08, 0.01, 0.012, { color: WHITE }); // name plate
}
export function waterTank(B, x, y, z, rng) {
  B.frame(x, y, z, 0);
  const c = pick(rng, [[0.92, 0.92, 0.9], [0.4, 0.6, 0.82], [0.85, 0.86, 0.88]]);
  for (const [sx, sz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) B.box('alu', sx, 0, sz, 0.08, 0.7, 0.08, { color: [0.5, 0.5, 0.52] });
  B.cyl('plastic', 0, 0.7, 0, 0.78, 0.78, 1.3, 16, { color: c });
  B.cyl('plastic', 0, 2.0, 0, 0.78, 0.3, 0.3, 16, { color: c, cap: true });
}
// a house going up on a lot (local +Z faces the street): timber frame on a concrete footing, scaffolding wrapped in mesh
// sheeting, a site fence along the street with a gate, cones, a portable toilet and the builder's sign board
export function constructionSite(B, x, y, z, r, LW, LD, rng, extras) {
  B.frame(x, y, z, r);
  const W = Math.min(LW - 3, 9), D = Math.min(LD - 5, 8), hz = -LD / 2 + D / 2 + 1.2;
  B.box('concrete', 0, -0.05, hz, W, 0.45, D, { color: [0.78, 0.78, 0.76], uv: 3 });
  const post = (px, pz, h) => B.box('wood', px, 0.4, pz, 0.12, h, 0.12, { color: [0.95, 0.85, 0.66] });
  for (let i = 0; i <= 4; i++) for (const sz of [-D / 2 + 0.1, D / 2 - 0.1]) post(-W / 2 + 0.1 + i * (W - 0.2) / 4, hz + sz, 5.6);
  for (const sx of [-W / 2 + 0.1, W / 2 - 0.1]) for (let k = 1; k < 3; k++) post(sx, hz - D / 2 + k * D / 3, 5.6);
  for (const h of [2.9, 5.9]) { B.box('wood', 0, 0.4 + h - 0.2, hz - D / 2 + 0.1, W, 0.22, 0.14, { color: [0.93, 0.83, 0.64] }); B.box('wood', 0, 0.4 + h - 0.2, hz + D / 2 - 0.1, W, 0.22, 0.14, { color: [0.93, 0.83, 0.64] });
    B.box('wood', -W / 2 + 0.1, 0.4 + h - 0.2, hz, 0.14, 0.22, D, { color: [0.93, 0.83, 0.64] }); B.box('wood', W / 2 - 0.1, 0.4 + h - 0.2, hz, 0.14, 0.22, D, { color: [0.93, 0.83, 0.64] }); }
  // roof rafters of the gable, first floor joists
  for (let i = 0; i <= 6; i++) { const px = -W / 2 + 0.1 + i * (W - 0.2) / 6; B.beam('wood', [px, 6.2, hz - D / 2 - 0.3], [px, 7.6, hz], 0.1, 0.16, { color: [0.95, 0.86, 0.68] }); B.beam('wood', [px, 7.6, hz], [px, 6.2, hz + D / 2 + 0.3], 0.1, 0.16, { color: [0.95, 0.86, 0.68] }); }
  // scaffolding with sheeting on the street side and one flank
  const sc = { color: [0.55, 0.58, 0.6] }, sheet = pick(rng, [[0.25, 0.45, 0.62], [0.22, 0.5, 0.35], [0.3, 0.52, 0.66]]);
  for (let i = 0; i <= 5; i++) { const px = -W / 2 - 0.8 + i * (W + 1.6) / 5; B.box('alu', px, 0, hz + D / 2 + 0.8, 0.05, 7.2, 0.05, sc); B.box('alu', px, 0, hz + D / 2 + 1.5, 0.05, 7.2, 0.05, sc); }
  for (const h of [1.8, 3.6, 5.4]) { B.box('alu', 0, h, hz + D / 2 + 1.15, W + 1.6, 0.05, 0.75, sc); B.box('alu', 0, h + 0.9, hz + D / 2 + 1.5, W + 1.6, 0.04, 0.04, sc); }
  // mesh sheeting hung in panels, alternating in shade, with gaps where the scaffold shows through
  for (let px = -W / 2 - 0.8; px < W / 2 + 0.8 - 0.1; px += 1.8) { const qx = Math.min(px + 1.72, W / 2 + 0.8), sc2 = sheet.map(v => v * (Math.round(px / 1.8) % 2 ? 0.92 : 1.0));
    B.quad('plain', [px, 1.9, hz + D / 2 + 1.56], [qx, 1.9, hz + D / 2 + 1.56], [qx, 7.2, hz + D / 2 + 1.56], [px, 7.2, hz + D / 2 + 1.56], { color: sc2 }); }
  B.quad('plain', [-W / 2 - 0.8, 0.9, hz - D / 2], [-W / 2 - 0.8, 0.9, hz + D / 2 + 1.56], [-W / 2 - 0.8, 7.2, hz + D / 2 + 1.56], [-W / 2 - 0.8, 7.2, hz - D / 2], { color: sheet.map(v => v * 0.9) });
  // site fence: white panels with a green stripe, a sliding gate left open
  const fz = LD / 2 - 0.2;
  for (let fx = -LW / 2 + 0.2; fx < LW / 2 - 3.6; fx += 1.8) {
    B.box('plain', fx + 0.9, 0, fz, 1.76, 1.8, 0.05, { color: [0.95, 0.95, 0.93] });
    B.box('plain', fx + 0.9, 1.2, fz + 0.03, 1.76, 0.18, 0.02, { color: [0.2, 0.55, 0.35] });
  }
  extras.push({ t: 'box', p: B.P([-1.8, 0, fz]), hx: LW / 2 - 1.8, hz: 0.1, r, h: 1.8 });
  for (let k = 0; k < 3; k++) { const cx = LW / 2 - 3 + k * 0.9; B.cyl('plastic', cx, 0, fz + 0.6, 0.16, 0.03, 0.7, 8, { color: [1, 0.45, 0.1] }); B.cyl('plain', cx, 0.35, fz + 0.6, 0.1, 0.07, 0.12, 8, { color: WHITE }); }
  B.box('plastic', LW / 2 - 1.2, 0, -LD / 2 + 1.4, 1.0, 2.2, 1.0, { color: [0.3, 0.55, 0.75] });
  extras.push({ t: 'box', p: B.P([LW / 2 - 1.2, 0, -LD / 2 + 1.4]), hx: 0.5, hz: 0.5, r });
  // a mini excavator parked in the front yard
  { const F0 = B.F; B.frame(...B.P([Math.min(W / 2, LW / 2 - 2.2), 0, Math.min(hz + D / 2 + 3.4, LD / 2 - 1.8)]), r + 2.4 + rng() * 0.8); excavator(B, rng); B.F = F0;
    extras.push({ t: 'box', p: B.P([Math.min(W / 2, LW / 2 - 2.2), 0, Math.min(hz + D / 2 + 3.4, LD / 2 - 1.8)]), hx: 0.9, hz: 1.2, r }); }
  // builder's sign
  const sign = signMesh(1.2, 0.9, (g, Wc, Hc) => { g.fillStyle = '#f7f7f2'; g.fillRect(0, 0, Wc, Hc); g.fillStyle = '#1f5f9b'; g.fillRect(0, 0, Wc, Hc * 0.22);
    g.fillStyle = '#fff'; g.font = `bold ${Hc * 0.14}px ${JP_FONT}`; g.textAlign = 'center'; g.fillText('工事中', Wc / 2, Hc * 0.16);
    g.fillStyle = '#222'; g.font = `${Hc * 0.1}px ${JP_FONT}`; ['建築主　山田様邸', '施工　桜川工務店', 'ご迷惑をおかけします'].forEach((t, i) => g.fillText(t, Wc / 2, Hc * (0.42 + i * 0.18))); }, 0.05);
  const sp = B.P([-LW / 2 + 2.2, 1.2, fz + 0.05]); sign.position.set(...sp); sign.rotation.y = r; scene.add(sign);
}

// mini excavator (~1.5 t): rubber tracks with rounded ends, dozer blade, slewing body with counterweight, open cab,
// boom and arm with hydraulic rams, bucket. Local +Z is the digging side.
export function excavator(B, rng) {
  const yel = [0.98, 0.72, 0.1], dark = [0.14, 0.14, 0.15], grey = [0.55, 0.56, 0.58];
  const stadium = []; for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2, c = Math.cos(a) > 0 ? 0.62 : -0.62; stadium.push([c + Math.cos(a) * 0.19, 0.19 + Math.sin(a) * 0.19]); }
  for (const sx of [-0.52, 0.22]) B.sweep('dark', stadium, [[sx, 0, 0], [sx + 0.3, 0, 0]], { closed: true, caps: true, color: dark, uv: 0.5 });
  B.bbox('metal', 0, 0.12, 0, 0.8, 0.26, 1.2, 0.03, { color: [0.3, 0.3, 0.32] });
  B.bbox('metal', 0, 0.06, 0.98, 1.1, 0.34, 0.08, 0.02, { color: yel });                      // blade
  for (const sx of [-0.3, 0.3]) B.beam('metal', [sx, 0.25, 0.5], [sx, 0.2, 0.95], 0.06, 0.06, { color: yel });
  B.cyl('metal', 0, 0.38, 0, 0.42, 0.42, 0.08, 16, { color: [0.2, 0.2, 0.2], cap: true });           // slewing ring
  B.bbox('metal', 0, 0.46, -0.1, 1.05, 0.5, 1.2, 0.06, { color: yel });
  B.cyl('metal', 0, 0.46, -0.55, 0.5, 0.5, 0.5, 16, { color: yel, cap: true });                      // counterweight
  for (const [px, pz] of [[-0.48, -0.05], [0.05, -0.05], [-0.48, 0.45], [0.05, 0.45]]) B.bbox('metal', px, 0.96, pz, 0.05, 1.05, 0.05, 0.01, { color: dark });
  B.bbox('metal', -0.21, 2.0, 0.2, 0.62, 0.06, 0.62, 0.015, { color: dark });
  B.bbox('plastic', -0.21, 0.96, 0.05, 0.4, 0.34, 0.4, 0.04, { color: [0.2, 0.2, 0.22] });              // seat
  B.quad('glass', [-0.46, 1.1, 0.46], [0.02, 1.1, 0.46], [0.02, 1.95, 0.46], [-0.46, 1.95, 0.46], { color: [0.5, 0.6, 0.7] });
  // boom, arm, rams, bucket
  const b0 = [0.3, 0.8, 0.5], b1 = [0.3, 2.05, 1.35], b2 = [0.3, 0.95, 2.15];
  B.beam('metal', b0, b1, 0.16, 0.2, { color: yel }); B.beam('metal', b1, b2, 0.12, 0.16, { color: yel });
  B.beam('steel', [0.3, 0.7, 0.62], [0.3, 1.6, 1.1], 0.07, 0.07, { color: grey }); B.beam('steel', [0.3, 2.15, 1.2], [0.3, 1.6, 1.95], 0.06, 0.06, { color: grey });
  B.bbox('metal', 0.3, 0.55, 2.2, 0.42, 0.4, 0.32, 0.03, { color: dark });
  for (let k = -1; k <= 1; k++) B.bbox('steel', 0.3 + k * 0.13, 0.5, 2.36, 0.05, 0.08, 0.08, 0.01, { color: grey }); // teeth
  void rng;
}
// small roadside shrine: a hokora with a tiny torii and a stone Jizo (local +Z faces the street)
export function streetShrine(B, x, y, z, r) {
  B.frame(x, y, z, r);
  B.box('concrete', 0, 0, 0, 1.4, 0.35, 1.1, { color: [0.7, 0.7, 0.68] });
  B.box('wood', 0, 0.35, -0.1, 0.8, 0.7, 0.6, { color: [0.72, 0.52, 0.36] });
  B.box('dark', 0, 0.45, 0.21, 0.4, 0.45, 0.02);
  B.quad('roofMetal', [-0.62, 1.05, 0.38], [0.62, 1.05, 0.38], [0.62, 1.32, -0.1], [-0.62, 1.32, -0.1], { color: [0.35, 0.33, 0.33] });
  B.quad('roofMetal', [0.62, 1.05, -0.58], [-0.62, 1.05, -0.58], [-0.62, 1.32, -0.1], [0.62, 1.32, -0.1], { color: [0.35, 0.33, 0.33] });
  const red = { color: [0.86, 0.22, 0.14] };
  for (const sx of [-0.35, 0.35]) B.box('plain', sx, 0.35, 0.5, 0.06, 0.85, 0.06, red);
  B.box('plain', 0, 1.12, 0.5, 0.95, 0.06, 0.08, red); B.box('plain', 0, 1.0, 0.5, 0.8, 0.05, 0.05, red);
  B.cyl('plastic', 0.55, 0.35, 0.25, 0.1, 0.12, 0.34, 8, { color: [0.7, 0.7, 0.67] }); B.cyl('plastic', 0.55, 0.69, 0.25, 0.09, 0.09, 0.14, 8, { color: [0.72, 0.72, 0.69], cap: true });
  B.box('plain', 0.55, 0.56, 0.33, 0.2, 0.1, 0.03, red);
  const p = B.P([0, 0, 0]); addBox(p[0], p[2], 0.72, 0.58, r, y - 1, y + 1.3);
}

// zebra crossing across a road: (x,z) on the centreline, (dx,dz) the road direction, W the carriageway width
export function crosswalk(B, x, y, z, dx, dz, W, band = 3.2) {
  B.frame(x, y + 0.028, z, Math.atan2(dx, dz));
  const n = Math.floor((W - 0.6) / 0.9);
  for (let k = 0; k < n; k++) {
    const cx = -((n - 1) * 0.9) / 2 + k * 0.9;
    B.quad('paint', [cx - 0.23, 0, band / 2], [cx + 0.23, 0, band / 2], [cx + 0.23, 0, -band / 2], [cx - 0.23, 0, -band / 2], { color: [0.94, 0.94, 0.92] });
  }
}

// ---------------------------------------------------------------- playground park (local +Z faces the street)
export function playground(B, x, y, z, r, W, D, rng, trees, extras) {
  B.frame(x, y, z, r);
  const F = B.F, at = (lx, lz, rr = 0) => { B.F = F; B.frame(...B.P([lx, 0, lz]), r + rr); };
  const red = [0.9, 0.25, 0.2], yel = [1, 0.8, 0.2], blu = [0.25, 0.5, 0.9], grn = [0.3, 0.72, 0.4];
  const tube = (mat, pts, rad, col, caps = true) => B.sweep(mat, circ(rad, 10), pts, { closed: true, caps, color: col, uv: 1 });
  // low tubular fence with an opening to the street, posts every 2.2 m
  const fcol = [0.35, 0.6, 0.45];
  const run = (ax, az, bx, bz) => {
    const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 2.2));
    B.F = F; tube('alu', [[ax, 0.85, az], [bx, 0.85, bz]], 0.03, fcol); tube('alu', [[ax, 0.45, az], [bx, 0.45, bz]], 0.022, fcol);
    for (let k = 0; k <= n; k++) B.cyl('alu', lerp(ax, bx, k / n), -0.1, lerp(az, bz, k / n), 0.035, 0.035, 0.98, 10, { color: fcol, cap: true });
    const p = B.P([(ax + bx) / 2, 0, (az + bz) / 2]); extras.push({ t: 'box', p, hx: Math.abs(bx - ax) > 0.1 ? L / 2 : 0.08, hz: Math.abs(bx - ax) > 0.1 ? 0.08 : L / 2, r, h: 0.9 });
  };
  run(-W / 2, -D / 2, W / 2, -D / 2); run(-W / 2, -D / 2, -W / 2, D / 2); run(W / 2, -D / 2, W / 2, D / 2);
  run(-W / 2, D / 2, -2.5, D / 2); run(2.5, D / 2, W / 2, D / 2);
  for (const sx of [-2.6, 2.6]) { at(sx, D / 2); B.bbox('concrete', 0, 0, 0, 0.4, 1.1, 0.4, 0.02, { color: [0.78, 0.78, 0.76] }); } // gate posts
  at(-3.4, D / 2 + 0.05);
  const sign = signMesh(1.6, 0.5, (g, W2, H2) => { g.fillStyle = '#2f6b4a'; g.fillRect(0, 0, W2, H2); g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `bold ${H2 * 0.5}px ${JP_FONT}`; g.fillText('桜川児童公園', W2 / 2, H2 * 0.54); }, 0.2);
  sign.position.set(...B.P([0, 1.4, 0.08])); sign.rotation.y = r; scene.add(sign);
  B.cyl('steel', -0.7, 0, 0, 0.03, 0.03, 1.7, 8, { color: [0.6, 0.6, 0.6], cap: true }); B.cyl('steel', 0.7, 0, 0, 0.03, 0.03, 1.7, 8, { color: [0.6, 0.6, 0.6], cap: true });
  // swings: tubular A-frames, a top bar, chain-hung seats over rubber mats
  at(-W / 4, -D / 4);
  for (const sx of [-2.4, 2.4]) { tube('plain', [[sx, 0, -0.95], [sx, 2.45, 0]], 0.055, red); tube('plain', [[sx, 0, 0.95], [sx, 2.45, 0]], 0.055, red); }
  tube('plain', [[-2.6, 2.45, 0], [2.6, 2.45, 0]], 0.06, blu);
  for (const sx of [-1.2, 1.2]) {
    B.detail(1, () => { for (const d of [-0.2, 0.2]) B.beam('steel', [sx + d, 2.42, 0], [sx + d, 0.5, 0], 0.012, 0.012, { color: [0.72, 0.72, 0.74] }); });
    B.bbox('plastic', sx, 0.44, 0, 0.5, 0.05, 0.2, 0.015, { color: yel });
    B.bbox('plastic', sx, 0.0, 0, 1.1, 0.03, 1.8, 0.01, { color: [0.2, 0.42, 0.3] });
  }
  extras.push({ t: 'box', p: B.P([0, 0, 0]), hx: 2.6, hz: 1.0, r, h: 2.5 });
  // slide: four posts, a deck with a little hipped hood, rung ladder, a chute with side walls and a run-out
  at(W / 4, -D / 4);
  for (const [sx, sz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) B.cyl('plain', sx, 0, sz, 0.06, 0.06, 2.6, 10, { color: blu, cap: true });
  B.bbox('wood', 0, 1.5, 0, 1.3, 0.08, 1.3, 0.015, { color: [0.85, 0.6, 0.4] });
  B.cyl('plain', 0, 2.6, 0, 1.05, 0.08, 0.55, 4, { color: red, cap: true, smooth: false });
  for (let k = 0; k < 6; k++) tube('alu', [[-0.3, 0.25 + k * 0.25, -0.72], [0.3, 0.25 + k * 0.25, -0.72]], 0.02, yel);
  for (const sx of [-0.32, 0.32]) tube('plain', [[sx, 0, -0.95], [sx, 1.95, -0.62]], 0.035, yel);
  const chute = [[0, 1.55, 0.65], [0, 1.2, 1.45], [0, 0.72, 2.4], [0, 0.4, 3.3], [0, 0.32, 3.8]];
  B.sweep('plastic', [[-0.36, 0], [0.36, 0], [0.36, 0.3], [0.32, 0.3], [0.32, 0.03], [-0.32, 0.03], [-0.32, 0.3], [-0.36, 0.3]], chute, { closed: true, color: yel });
  for (const sx of [-0.3, 0.3]) B.cyl('plain', sx, 0, 3.5, 0.04, 0.04, 0.38, 8, { color: blu });
  extras.push({ t: 'box', p: B.P([0, 0, 1.2]), hx: 0.7, hz: 2.2, r, h: 2.6 });
  // climbing frame (jungle gym) of tubes
  at(-W / 4, D / 5);
  for (let a = 0; a <= 3; a++) for (let b = 0; b <= 3; b++) B.cyl('alu', -1.2 + a * 0.8, 0, -1.2 + b * 0.8, 0.03, 0.03, 2.1, 8, { color: pick(rng, [red, yel, blu, grn]), cap: true });
  for (let h = 1; h <= 3; h++) for (let a = 0; a <= 3; a++) { tube('alu', [[-1.2, h * 0.7, -1.2 + a * 0.8], [1.2, h * 0.7, -1.2 + a * 0.8]], 0.022, grn, false); tube('alu', [[-1.2 + a * 0.8, h * 0.7, -1.2], [-1.2 + a * 0.8, h * 0.7, 1.2]], 0.022, yel, false); }
  extras.push({ t: 'box', p: B.P([0, 0, 0]), hx: 1.25, hz: 1.25, r, h: 2.1 });
  // sandbox with a timber edge
  at(W / 4, D / 5);
  for (const s2 of [-1, 1]) { B.bbox('wood', 0, 0, s2 * 1.62, 3.4, 0.3, 0.16, 0.03, { color: [0.85, 0.62, 0.42] }); B.bbox('wood', s2 * 1.62, 0, 0, 0.16, 0.3, 3.1, 0.03, { color: [0.85, 0.62, 0.42] }); }
  B.box('plain', 0, 0.01, 0, 3.1, 0.2, 3.1, { color: [0.96, 0.88, 0.66], skip: 'ny' });
  B.bbox('plastic', 0.6, 0.21, 0.4, 0.3, 0.12, 0.3, 0.03, { color: red }); B.bbox('plastic', -0.7, 0.21, -0.5, 0.25, 0.1, 0.35, 0.03, { color: blu });
  // benches (slatted seat and back on cast legs) along the back fence and a drinking fountain
  for (const bx of [-W / 2 + 4, 0, W / 2 - 4]) {
    at(bx, -D / 2 + 1.4);
    for (let k = 0; k < 4; k++) B.bbox('wood', 0, 0.42, -0.15 + k * 0.1, 1.8, 0.04, 0.085, 0.01, { color: [0.82, 0.6, 0.42] });
    for (let k = 0; k < 3; k++) B.bbox('wood', 0, 0.55 + k * 0.12, -0.24, 1.8, 0.09, 0.03, 0.01, { color: [0.82, 0.6, 0.42] });
    for (const sx of [-0.8, 0.8]) { B.bbox('metal', sx, 0, 0, 0.05, 0.42, 0.44, 0.01, { color: [0.24, 0.25, 0.27] }); B.bbox('metal', sx, 0.42, -0.24, 0.05, 0.42, 0.05, 0.01, { color: [0.24, 0.25, 0.27] }); }
    extras.push({ t: 'box', p: B.P([0, 0, 0]), hx: 0.95, hz: 0.25, r, h: 0.5 });
  }
  at(W / 2 - 3, D / 2 - 3);
  B.cyl('concrete', 0, 0, 0, 0.25, 0.2, 0.85, 12, { color: [0.78, 0.78, 0.76] }); B.cyl('alu', 0, 0.85, 0, 0.3, 0.3, 0.08, 12, { color: [0.8, 0.82, 0.84], cap: true });
  B.cyl('steel', 0.1, 0.93, 0, 0.02, 0.02, 0.08, 6, { color: [0.7, 0.7, 0.7], cap: true });
  // public toilet block in a corner
  at(-W / 2 + 3.2, D / 2 - 3.6, Math.PI / 2);
  B.bbox('block', 0, 0, 0, 3.6, 2.6, 2.8, 0.02, { color: [0.88, 0.86, 0.8], uv: 1.6 });
  B.bbox('roofMetal', 0, 2.6, 0, 4.2, 0.12, 3.4, 0.02, { color: [0.35, 0.5, 0.42] });
  for (const [sx, c] of [[-0.9, [0.2, 0.35, 0.75]], [0.9, [0.85, 0.25, 0.3]]]) { B.bbox('metal', sx, 0.05, 1.41, 0.8, 1.95, 0.04, 0.01, { color: [0.72, 0.74, 0.76] }); B.bbox('plastic', sx, 2.15, 1.43, 0.3, 0.3, 0.02, 0.01, { color: c }); }
  extras.push({ t: 'box', p: B.P([0, 0, 0]), hx: 1.8, hz: 1.4, r: r + Math.PI / 2 });
  // shade trees around the edge
  for (let k = 0; k < 10; k++) {
    const side = k % 4, lx = side < 2 ? (side ? W / 2 - 2 : -W / 2 + 2) : lerp(-W / 2 + 4, W / 2 - 4, rng()), lz = side < 2 ? lerp(-D / 2 + 3, D / 2 - 3, rng()) : -D / 2 + 2.5;
    B.F = F; const p = B.P([lx, 0, lz]); trees.push({ x: p[0], z: p[2] });
  }
  B.F = F;
}
const circ = (rad, n) => Array.from({ length: n }, (_, i) => [Math.cos(i / n * Math.PI * 2) * rad, Math.sin(i / n * Math.PI * 2) * rad]);

// ---------------------------------------------------------------- elementary school (local +Z faces the entrance road)
let clockMat = null;
function schoolClock(x, y, z, r) {
  if (!clockMat) {
    const t = canvasTex(256, 256, (g, W, H) => {
      g.fillStyle = '#fbfaf2'; g.beginPath(); g.arc(W / 2, H / 2, 120, 0, 7); g.fill(); g.strokeStyle = '#2f3a48'; g.lineWidth = 10; g.stroke();
      g.fillStyle = '#2f3a48'; for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; g.fillRect(W / 2 + Math.sin(a) * 96 - 4, H / 2 - Math.cos(a) * 96 - 10, 8, 20); }
      g.lineCap = 'round'; g.lineWidth = 10; g.beginPath(); g.moveTo(W / 2, H / 2); g.lineTo(W / 2 + 40, H / 2 - 50); g.stroke();
      g.lineWidth = 6; g.beginPath(); g.moveTo(W / 2, H / 2); g.lineTo(W / 2 - 10, H / 2 - 90); g.stroke();
    });
    clockMat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.5 });
  }
  const m = new THREE.Mesh(new THREE.CircleGeometry(1.1, 32), clockMat);
  m.position.set(x, y, z); m.rotation.y = r; scene.add(m);
}
export function school(B, cx, y, cz, r, BW, BD, rng, sakura, bikes, extras) {
  chainMaterial();
  B.frame(cx, y, cz, r);
  const F = B.F, at = (lx, lz, rr = 0) => { B.F = F; B.frame(...B.P([lx, 0, lz]), r + rr); };
  const wall = [0.97, 0.96, 0.92], fh = 3.6, floors = 3, H = floors * fh;
  // main building along the back of the grounds
  const bw = Math.min(64, BW - 38), bd = 12, bx = -BW / 2 + 4 + bw / 2, bz = -BD / 2 + 3 + bd / 2;
  at(bx, bz);
  // walls with real ribbon-window openings (recessed frames, sills) on both long faces
  const bays = Math.floor((bw - 3) / 1.8), bay0 = -bays * 1.8 / 2;
  for (const [fr, off, fw] of [[0, bd / 2, bw], [Math.PI, bd / 2, bw], [Math.PI / 2, bw / 2, bd], [-Math.PI / 2, bw / 2, bd]]) {
    const F0 = B.F; B.frame(...B.P([Math.sin(fr) * off, 0, Math.cos(fr) * off]), r + fr);
    const holes = [];
    if (fw === bw) for (let f = 0; f < floors; f++) for (let k = 0; k < bays; k++) holes.push({ x0: bay0 + k * 1.8 + 0.06, x1: bay0 + (k + 1) * 1.8 - 0.06, y0: f * fh + 0.95, y1: f * fh + 2.9, d: 0.2 });
    else for (let f = 0; f < floors; f++) holes.push({ x0: -0.6, x1: 0.6, y0: f * fh + 1.2, y1: f * fh + 2.6, d: 0.2 });
    wallFill(B, 'stucco', -fw / 2, fw / 2, 0, H + 1.0, holes, wall, 3);
    for (const h of holes) { reveals(B, 'stucco', h, [0.92, 0.92, 0.9]); windowUnit(B, h, { rng, frame: [0.82, 0.84, 0.86], transom: true, glass: [1, 0.94, 0.8] }); }
    for (let f = 1; f <= floors; f++) B.bbox('concrete', 0, f * fh - 0.1, 0.03, fw + 0.06, 0.12, 0.06, 0.01, { color: [0.86, 0.86, 0.84] }); // floor bands
    B.F = F0;
  }
  B.quad('concrete', [-bw / 2, H + 1.0, bd / 2], [bw / 2, H + 1.0, bd / 2], [bw / 2, H + 1.0, -bd / 2], [-bw / 2, H + 1.0, -bd / 2], { color: [0.62, 0.64, 0.64] });
  B.bbox('concrete', 0, H + 1.0, 0, bw + 0.14, 0.09, bd + 0.14, 0.02, { color: [0.7, 0.72, 0.72], skip: 'ny' });
  for (let f = 0; f < floors; f++) {
    // sunshade balconies on the grounds side
    B.box('concrete', 0, f * fh + 3.2, bd / 2 + 0.55, bw, 0.14, 1.1, { color: [0.9, 0.9, 0.88] });
    B.box('alu', 0, f * fh + 3.34 + 0.9, bd / 2 + 1.08, bw, 0.05, 0.05, { color: [0.82, 0.84, 0.86] });
  }
  // green roof railing, stair tower, clock
  for (let k = 0; k <= Math.floor(bw / 1.5); k++) B.box('alu', -bw / 2 + k * 1.5, H + 1.08, bd / 2 - 0.1, 0.04, 1.0, 0.04, { color: [0.35, 0.6, 0.42] });
  B.box('alu', 0, H + 2.05, bd / 2 - 0.1, bw, 0.05, 0.05, { color: [0.35, 0.6, 0.42] });
  B.box('stucco', -bw / 2 + 3.5, H, -1, 5, 3.6, 6, { color: [0.95, 0.94, 0.9], skip: 'ny', uv: 3 });
  B.box('concrete', -bw / 2 + 3.5, H + 3.6, -1, 5.2, 0.1, 6.2, { color: [0.7, 0.72, 0.72] });
  B.box('stucco', 0, H - 0.3, bd / 2 - 0.15, 2.6, 2.4, 0.35, { color: [0.95, 0.94, 0.9], uv: 3 });
  const cp = B.P([0, H + 0.9, bd / 2 + 0.05]);
  schoolClock(cp[0], cp[1], cp[2], r);
  // entrance canopy
  B.box('concrete', 0, 2.9, bd / 2 + 1.6, 6, 0.2, 3.2, { color: [0.88, 0.88, 0.86] });
  for (const sx of [-2.8, 2.8]) B.box('concrete', sx, 0, bd / 2 + 3, 0.3, 2.9, 0.3, { color: [0.88, 0.88, 0.86] });
  extras.push({ t: 'box', p: B.P([0, 0, 0]), hx: bw / 2, hz: bd / 2, r });
  for (let f = 0; f < floors; f++) lampPoints.push({ p: B.P([0, f * fh + 3.0, bd / 2 + 1]), s: 0.3 });
  // gym with a barrel roof
  const gw = 24, gd = 18, gx = bx + bw / 2 + 4 + gw / 2, gz = -BD / 2 + 3 + gd / 2, gh = 7;
  if (gx + gw / 2 < BW / 2 - 2) {
    at(gx, gz);
    // walls with real openings: tall window bands along both sides, four steel doors on the front
    const gcol = [0.86, 0.94, 0.9];
    for (const [fr, off, fw] of [[0, gd / 2, gw], [Math.PI, gd / 2, gw], [Math.PI / 2, gw / 2, gd], [-Math.PI / 2, gw / 2, gd]]) {
      const F0 = B.F; B.frame(...B.P([Math.sin(fr) * off, 0, Math.cos(fr) * off]), r + fr);
      const holes = [];
      if (fw === gd) for (let k = 0; k < 4; k++) { const zz = -gd / 2 + 2.5 + k * (gd - 5) / 3; holes.push({ x0: zz - 1.2, x1: zz + 1.2, y0: 3.6, y1: 6.2, d: 0.16 }); }
      if (fr === 0) for (let k = 0; k < 4; k++) { const dx = -gw / 2 + 3 + k * (gw - 6) / 3; holes.push({ x0: dx - 1.1, x1: dx + 1.1, y0: 0.2, y1: 2.6, d: 0.14, door: true }); }
      wallFill(B, 'siding', -fw / 2, fw / 2, 0, gh, holes, gcol, 2.2);
      for (const h of holes) { reveals(B, 'siding', h, [0.8, 0.86, 0.84]);
        if (h.door) { B.quad('shutter', [h.x0, h.y0, -0.1], [h.x1, h.y0, -0.1], [h.x1, h.y1, -0.1], [h.x0, h.y1, -0.1], { color: [0.72, 0.74, 0.76], uv: 1.2 }); B.bbox('concrete', (h.x0 + h.x1) / 2, 0, 0.5, 2.6, 0.2, 1.0, 0.02, { color: [0.72, 0.72, 0.7] }); }
        else windowUnit(B, h, { rng, type: 'grid', glass: [1, 0.95, 0.85], grille: true, grilleColor: [0.3, 0.45, 0.4] }); }
      B.F = F0;
    }
    B.bbox('concrete', 0, 0, 0, gw + 0.1, 0.4, gd + 0.1, 0.02, { color: [0.72, 0.72, 0.7], skip: 'ny' });
    const segs = 12, rise = 3.2, rc = [0.3, 0.55, 0.62];
    const arc = k => { const t = k / segs, a = (t - 0.5) * Math.PI * 0.8; return [Math.sin(a) / Math.sin(Math.PI * 0.4) * (gd / 2 + 0.4), gh + (Math.cos(a) - Math.cos(Math.PI * 0.4)) / (1 - Math.cos(Math.PI * 0.4)) * rise]; };
    for (let k = 0; k < segs; k++) {
      const [z0, y0] = arc(k), [z1, y1] = arc(k + 1);
      B.quad('roofMetal', [gw / 2 + 0.4, y0, z0], [-gw / 2 - 0.4, y0, z0], [-gw / 2 - 0.4, y1, z1], [gw / 2 + 0.4, y1, z1], { color: rc, uv: 2 });
      B.quad('plain', [-gw / 2 - 0.4, y0 - 0.05, z0], [gw / 2 + 0.4, y0 - 0.05, z0], [gw / 2 + 0.4, y1 - 0.05, z1], [-gw / 2 - 0.4, y1 - 0.05, z1], { color: [0.9, 0.9, 0.88] });
      for (const sx of [-1, 1]) { const X = sx * gw / 2; const t = sx > 0 ? [[X, gh, 0], [X, y0, z0], [X, y1, z1]] : [[X, gh, 0], [X, y1, z1], [X, y0, z0]]; B.tri('siding', ...t, { color: [0.86, 0.94, 0.9], uv: 2.2 }); }
    }
    extras.push({ t: 'box', p: B.P([0, 0, 0]), hx: gw / 2, hz: gd / 2, r });
  }
  // sports ground: a levelled dirt field inside concrete edging with covered drainage channels; chalk track lanes and
  // pitch lines laid on it; football goals with nets, ball-stop nets behind both ends, a baseball backstop, floodlights,
  // team benches under shelters
  const fx = -8, fz = BD / 2 - 3 - 19, fw = Math.min(78, BW - 20), fd = 32, fy = 0.07, sand = [1.0, 0.86, 0.66];
  at(fx, fz);
  B.box('ballast', 0, fy - 0.2, 0, fw, 0.2, fd, { color: sand, uv: 3, skip: 'ny' });
  for (const s of [-1, 1]) { B.bbox('concrete', 0, fy - 0.16, s * (fd / 2 + 0.08), fw + 0.32, 0.22, 0.16, 0.02, { color: [0.78, 0.78, 0.75] }); B.bbox('concrete', s * (fw / 2 + 0.08), fy - 0.16, 0, 0.16, 0.22, fd, 0.02, { color: [0.78, 0.78, 0.75] }); }
  for (const s of [-1, 1]) { // U-channel drains with steel gratings along the long sides
    const zc = s * (fd / 2 + 0.42);
    B.box('dark', 0, fy - 0.12, zc, fw, 0.1, 0.36, { color: [0.1, 0.1, 0.1] });
    for (const e of [-1, 1]) B.bbox('concrete', 0, fy - 0.16, zc + e * 0.24, fw + 0.3, 0.2, 0.12, 0.015, { color: [0.74, 0.74, 0.72] });
    B.quad('chain', [-fw / 2, fy + 0.02, zc - 0.18], [fw / 2, fy + 0.02, zc - 0.18], [fw / 2, fy + 0.02, zc + 0.18], [-fw / 2, fy + 0.02, zc + 0.18], { uv: 0.12, color: [0.3, 0.3, 0.32] });
  }
  const chalk = [0.97, 0.97, 0.95], ly = fy + 0.006;
  const line = (x0, z0, x1, z1, wd = 0.1) => { const L = Math.hypot(x1 - x0, z1 - z0), nx = -(z1 - z0) / L * wd / 2, nz = (x1 - x0) / L * wd / 2; B.quad('paint', [x0 - nx, ly, z0 - nz], [x0 + nx, ly, z0 + nz], [x1 + nx, ly, z1 + nz], [x1 - nx, ly, z1 - nz], { color: chalk }); };
  const arc = (cx, cz, rad, a0, a1, n = 32) => { for (let k = 0; k < n; k++) { const t0 = a0 + (a1 - a0) * k / n, t1 = a0 + (a1 - a0) * (k + 1) / n; line(cx + Math.cos(t0) * rad, cz + Math.sin(t0) * rad, cx + Math.cos(t1) * rad, cz + Math.sin(t1) * rad); } };
  const sxT = fw / 2 - fd / 2;
  for (const lane of [0, 1.22, 2.44, 3.66]) {
    const rx = fd / 2 - 1.5 - lane;
    line(-sxT, -rx, sxT, -rx); line(sxT, rx, -sxT, rx);
    arc(sxT, 0, rx, -Math.PI / 2, Math.PI / 2); arc(-sxT, 0, rx, Math.PI / 2, Math.PI * 1.5);
  }
  for (let k = 0; k < 4; k++) line(-4 + k * 1.22, fd / 2 - 1.5, -4 + k * 1.22, fd / 2 - 5.2, 0.06); // start marks
  const pw = 2 * sxT - 6, pd = fd - 10;
  line(-pw / 2, -pd / 2, pw / 2, -pd / 2); line(-pw / 2, pd / 2, pw / 2, pd / 2); line(-pw / 2, -pd / 2, -pw / 2, pd / 2); line(pw / 2, -pd / 2, pw / 2, pd / 2);
  line(0, -pd / 2, 0, pd / 2); arc(0, 0, 4, 0, Math.PI * 2, 40);
  for (const e of [-1, 1]) { const x0 = e * pw / 2, x1 = e * (pw / 2 - 5); line(x0, -6, x1, -6); line(x1, -6, x1, 6); line(x1, 6, x0, 6); }
  const goal = (gx, face) => { // posts, crossbar, ground frame, nets
    at(fx + gx, fz, face);
    const gw = 5, gh = 2.1, gd = 1.6, wc = [0.97, 0.97, 0.95];
    for (const sx of [-gw / 2, gw / 2]) { B.cyl('alu', sx, fy, 0, 0.06, 0.06, gh, 10, { color: wc }); B.beam('alu', [sx, gh + fy, 0], [sx, fy + 0.05, -gd], 0.04, 0.04, { color: [0.85, 0.85, 0.85] }); B.beam('alu', [sx, fy + 0.03, 0], [sx, fy + 0.03, -gd], 0.04, 0.04, { color: [0.85, 0.85, 0.85] }); }
    B.sweep('alu', [[-0.06, -0.06], [0.06, -0.06], [0.06, 0.06], [-0.06, 0.06]], [[-gw / 2 - 0.06, fy + gh, 0], [gw / 2 + 0.06, fy + gh, 0]], { closed: true, caps: true, color: wc });
    B.beam('alu', [-gw / 2, fy + 0.03, -gd], [gw / 2, fy + 0.03, -gd], 0.04, 0.04, { color: [0.85, 0.85, 0.85] });
    const nc = { uv: 0.1, color: [0.95, 0.95, 0.95] };
    B.quad('chain', [gw / 2, fy, -gd], [-gw / 2, fy, -gd], [-gw / 2, fy + gh, 0], [gw / 2, fy + gh, 0], nc);
    for (const sx of [-gw / 2, gw / 2]) B.tri('chain', [sx, fy, 0], [sx, fy, -gd], [sx, fy + gh, 0], nc);
    extras.push({ t: 'box', p: B.P([0, 0, -gd / 2]), hx: gw / 2, hz: gd / 2, r: r + face, h: gh });
  };
  goal(-(pw / 2 - 0.2), Math.PI / 2); goal(pw / 2 - 0.2, -Math.PI / 2);
  for (const e of [-1, 1]) { // ball-stop nets behind both ends
    at(fx + e * (fw / 2 + 1.2), fz, e > 0 ? -Math.PI / 2 : Math.PI / 2);
    const nw = fd + 4, nh = 8, n = Math.round(nw / 5);
    for (let k = 0; k <= n; k++) { const px = -nw / 2 + k * nw / n; B.cyl('steel', px, 0, 0, 0.09, 0.075, nh, 10, { color: [0.4, 0.5, 0.44] }); B.cyl('steel', px, nh, 0, 0.1, 0.1, 0.06, 10, { color: [0.35, 0.42, 0.38], cap: true }); }
    for (const yy of [0.15, 2.0, nh - 0.1]) B.beam('steel', [-nw / 2, yy, 0], [nw / 2, yy, 0], 0.05, 0.05, { color: [0.4, 0.5, 0.44] });
    B.quad('chain', [-nw / 2, 0.1, 0], [nw / 2, 0.1, 0], [nw / 2, nh, 0], [-nw / 2, nh, 0], { uv: 0.35, color: [0.26, 0.4, 0.32] });
    extras.push({ t: 'box', p: B.P([0, 0, 0]), hx: nw / 2, hz: 0.12, r: r + (e > 0 ? -Math.PI / 2 : Math.PI / 2), h: nh });
  }
  { // baseball backstop in one corner (angled net panels)
    at(fx - fw / 2 + 9, fz + fd / 2 - 4, Math.PI * 0.75);
    const pts = [[-5, 0], [-2.2, 2.2], [2.2, 2.2], [5, 0]];
    for (const [px, pz] of pts) B.cyl('steel', px, 0, pz, 0.08, 0.07, 6, 10, { color: [0.4, 0.5, 0.44] });
    for (let i = 0; i + 1 < pts.length; i++) { const [ax, az] = pts[i], [bx2, bz] = pts[i + 1];
      B.quad('chain', [ax, 0.1, az], [bx2, 0.1, bz], [bx2, 6, bz], [ax, 6, az], { uv: 0.35, color: [0.26, 0.4, 0.32] }); B.beam('steel', [ax, 6, az], [bx2, 6, bz], 0.05, 0.05, { color: [0.4, 0.5, 0.44] }); }
  }
  for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { // floodlights
    at(fx + lx * (fw / 2 + 2.5), fz + lz * (fd / 2 + 2.5), Math.atan2(lx, lz) + Math.PI);
    B.cyl('steel', 0, 0, 0, 0.2, 0.12, 14, 12, { color: [0.72, 0.74, 0.76] });
    B.bbox('steel', 0, 14, 0.2, 2.6, 0.1, 0.1, 0.01, { color: [0.6, 0.62, 0.64] }); B.bbox('steel', 0, 14.9, 0.2, 2.6, 0.1, 0.1, 0.01, { color: [0.6, 0.62, 0.64] });
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) { B.bbox('steel', -0.9 + i * 0.6, 14.12 + j * 0.9, 0.3, 0.44, 0.34, 0.3, 0.03, { color: [0.3, 0.32, 0.34] }); B.box('lamp', -0.9 + i * 0.6, 14.16 + j * 0.9, 0.455, 0.36, 0.26, 0.01, { color: [1, 0.97, 0.9] }); }
    for (let k = 0; k < 18; k++) B.box('steel', 0.14, 0.8 + k * 0.7, -0.12, 0.25, 0.03, 0.03, { color: [0.6, 0.62, 0.64] }); // climbing rungs
    extras.push({ t: 'circle', p: B.P([0, 0, 0]), r: 0.25 });
  }
  for (const e of [-1, 1]) { // team benches under polycarbonate shelters
    at(fx + e * 12, fz + fd / 2 + 2.2, Math.PI);
    for (const sx of [-2.4, 2.4]) for (const sz of [-0.7, 0.7]) B.bbox('alu', sx, 0, sz, 0.08, 2.3 - sz * 0.2, 0.08, 0.008, { color: [0.62, 0.64, 0.66] });
    B.quad('poly', [-2.6, 2.44, -0.9], [2.6, 2.44, -0.9], [2.6, 2.16, 0.9], [-2.6, 2.16, 0.9]);
    B.bbox('alu', 0, 2.2, 0.85, 5.3, 0.06, 0.06, 0.008, { color: [0.62, 0.64, 0.66] }); B.bbox('alu', 0, 2.48, -0.85, 5.3, 0.06, 0.06, 0.008, { color: [0.62, 0.64, 0.66] });
    B.bbox('wood', 0, 0.42, -0.3, 4.6, 0.05, 0.36, 0.008, { color: [0.72, 0.52, 0.36] }); B.bbox('wood', 0, 0.62, -0.55, 4.6, 0.3, 0.04, 0.006, { color: [0.72, 0.52, 0.36] });
    for (const sx of [-2, 0, 2]) B.bbox('alu', sx, 0, -0.3, 0.05, 0.42, 0.34, 0.005, { color: [0.4, 0.4, 0.42] });
    extras.push({ t: 'box', p: B.P([0, 0, 0]), hx: 2.6, hz: 0.9, r: r + Math.PI, h: 2.4 });
  }
  at(bx + bw / 2 - 6, bz + bd / 2 + 4); // tetsubo: horizontal bars of three heights
  for (let k = 0; k < 4; k++) B.box('plain', -2.1 + k * 1.4, 0, 0, 0.1, 0.9 + k * 0.25, 0.1, { color: [0.9, 0.3, 0.25] });
  for (let k = 0; k < 3; k++) B.box('alu', -1.4 + k * 1.4, 0.85 + k * 0.25, 0, 1.4, 0.04, 0.04, { color: [0.75, 0.77, 0.8] });
  at(bx, bz + bd / 2 + 5.5); // assembly stage
  B.box('concrete', 0, 0, 0, 4, 1.0, 2.4, { color: [0.86, 0.86, 0.84] });
  for (let k = 0; k < 3; k++) B.box('concrete', 0, 0, 1.2 + k * 0.3 + 0.15, 1.6, 1.0 - (k + 1) * 0.3, 0.3, { color: [0.82, 0.82, 0.8] });
  extras.push({ t: 'box', p: B.P([0, 0, 0]), hx: 2, hz: 1.2, r, h: 1.0 });
  at(bx - 8, bz + bd / 2 + 5);
  B.cyl('alu', 0, 0, 0, 0.07, 0.05, 11, 8, { color: [0.85, 0.86, 0.88] });
  B.quad('plain', [0.05, 9.2, 0], [1.6, 9.2, 0], [1.6, 10.6, 0], [0.05, 10.6, 0], { color: WHITE });
  B.quad('plain', [1.6, 9.2, 0], [0.05, 9.2, 0], [0.05, 10.6, 0], [1.6, 10.6, 0], { color: WHITE });
  B.cyl('plain', 0.82, 9.9, 0.004, 0.36, 0.36, 0.004, 16, { color: [0.85, 0.12, 0.12], cap: true });
  // chain-link fence round the grounds, gate with name plate
  B.F = F;
  const fcol = { color: [0.32, 0.56, 0.42] };
  const fence = (ax, az, bx2, bz2) => {
    const L = Math.hypot(bx2 - ax, bz2 - az), n = Math.max(1, Math.round(L / 3));
    B.F = F;
    for (const yy of [0.1, 1.1, 2.1]) B.beam('alu', [ax, yy, az], [bx2, yy, bz2], 0.04, 0.04, fcol);
    for (let k = 0; k <= n; k++) B.box('alu', lerp(ax, bx2, k / n), 0, lerp(az, bz2, k / n), 0.06, 2.15, 0.06, fcol);
    const hor = Math.abs(bx2 - ax) > Math.abs(bz2 - az);
    const q = hor ? [[ax, 0.1, az], [bx2, 0.1, bz2], [bx2, 2.1, bz2], [ax, 2.1, az]] : [[ax, 0.1, az], [bx2, 0.1, bz2], [bx2, 2.1, bz2], [ax, 2.1, az]];
    B.quad('chain', ...q, { uv: 0.5, color: [0.5, 0.72, 0.58] });
    const p = B.P([(ax + bx2) / 2, 0, (az + bz2) / 2]);
    extras.push({ t: 'box', p, hx: hor ? L / 2 : 0.08, hz: hor ? 0.08 : L / 2, r, h: 2.2 });
  };
  const hw = BW / 2, hd = BD / 2;
  fence(-hw, -hd, hw, -hd); fence(-hw, -hd, -hw, hd); fence(hw, -hd, hw, hd);
  fence(-hw, hd, -4, hd); fence(4, hd, hw, hd);
  for (const sx of [-4.3, 4.3]) { at(sx, hd); B.box('concrete', 0, 0, 0, 0.6, 1.9, 0.6, { color: [0.82, 0.8, 0.76] }); extras.push({ t: 'box', p: B.P([0, 0, 0]), hx: 0.3, hz: 0.3, r }); }
  at(-4.3, hd);
  const plate = signMesh(0.42, 1.3, (g, W, H) => { g.fillStyle = '#f7f3ea'; g.fillRect(0, 0, W, H); g.fillStyle = '#2b2b2b'; g.textAlign = 'center';
    const txt = '桜川小学校'; g.font = `bold ${W * 0.7}px ${JP_FONT}`; for (let i = 0; i < txt.length; i++) g.fillText(txt[i], W / 2, H * (0.16 + i * 0.17)); }, 0.2, 256);
  const pp = B.P([0, 1.1, 0.31]); plate.position.set(...pp); plate.rotation.y = r; scene.add(plate);
  // cherry trees along the fence, bicycle shelter by the gate
  for (let k = 0; k < 14; k++) {
    const t = (k + 0.5) / 14, lx = lerp(-hw + 3, hw - 3, t);
    if (Math.abs(lx) < 7) continue;
    B.F = F; const p = B.P([lx, 0, hd - 2.4]); sakura.push({ x: p[0], z: p[2], front: true });
  }
  for (const sx of [-1, 1]) for (let k = 0; k < 4; k++) { B.F = F; const p = B.P([sx * (hw - 2.4), 0, -hd + 8 + k * (BD - 16) / 3]); sakura.push({ x: p[0], z: p[2] }); }
  at(hw - 12, hd - 6);
  for (const sx of [-4, 4]) for (const sz of [-1.2, 1.2]) B.box('alu', sx, 0, sz, 0.08, 2.2, 0.08, { color: [0.6, 0.62, 0.64] });
  B.box('roofMetal', 0, 2.2, 0, 8.6, 0.08, 3, { color: [0.3, 0.5, 0.62] });
  for (let k = 0; k < 12; k++) { const p = B.P([-3.6 + k * 0.65, 0, 0]); bikes.push({ x: p[0], y, z: p[2], r: r + Math.PI / 2 + (rng() - 0.5) * 0.1 }); }
  B.F = F;
  return { field: { x: fx, z: fz, w: fw, d: fd } };
}

// ---------------------------------------------------------------- people walking the streets
// A little anime figure (about 1.6 m) built from boxes; parts carry a limb id so the vertex shader can swing legs and
// arms, and a palette slot so each instance gets its own shirt, trousers/skirt and hair colours.
function personGeometry() {
  const parts = [];
  const add = (w, h, d, x, y, z, part, slot, ico = 0) => {
    const g = ico ? new THREE.IcosahedronGeometry(ico, 1) : new THREE.BoxGeometry(w, h, d);
    if (ico) g.scale(w, h, d);
    g.translate(x, y, z);
    const n = g.attributes.position.count;
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(new Float32Array(n).fill(part), 1));
    g.setAttribute('aSlot', new THREE.Float32BufferAttribute(new Float32Array(n).fill(slot), 1));
    g.deleteAttribute('uv');
    parts.push(g.index ? g.toNonIndexed() : g);
  };
  add(0.33, 0.5, 0.2, 0, 1.08, 0, 0, 1);                 // torso
  add(0.35, 0.18, 0.22, 0, 0.8, 0, 0, 2);                // hips / skirt
  for (const s of [-1, 1]) {
    add(0.12, 0.74, 0.13, s * 0.085, 0.43, 0, s < 0 ? 1 : 2, 2);   // legs
    add(0.13, 0.08, 0.22, s * 0.085, 0.04, 0.03, s < 0 ? 1 : 2, 4); // shoes
    add(0.085, 0.48, 0.09, s * 0.21, 1.07, 0, s < 0 ? 3 : 4, 1);    // arms
    add(0.075, 0.09, 0.08, s * 0.21, 0.79, 0, s < 0 ? 3 : 4, 0);    // hands
  }
  add(0.08, 0.06, 0.08, 0, 1.36, 0, 0, 0);               // neck
  add(1, 1.08, 1, 0, 1.5, 0.005, 0, 0, 0.125);           // head
  add(1.06, 1.0, 1.1, 0, 1.54, -0.025, 0, 3, 0.132);     // hair cap
  add(0.24, 0.26, 0.1, 0, 1.1, -0.14, 0, 5);              // backpack / bag
  return mergeGeometries(parts);
}
const SHIRTS = [[0.97, 0.97, 0.95], [0.2, 0.26, 0.42], [0.98, 0.72, 0.76], [0.55, 0.74, 0.95], [0.98, 0.88, 0.45], [0.62, 0.82, 0.62], [0.9, 0.42, 0.36], [0.22, 0.22, 0.24], [0.8, 0.7, 0.92]];
const PANTS = [[0.18, 0.22, 0.36], [0.3, 0.3, 0.32], [0.62, 0.55, 0.42], [0.14, 0.14, 0.16], [0.28, 0.36, 0.55], [0.55, 0.3, 0.3], [0.85, 0.82, 0.76]];
const HAIR = [[0.08, 0.07, 0.07], [0.08, 0.07, 0.07], [0.22, 0.14, 0.1], [0.36, 0.22, 0.14], [0.6, 0.42, 0.26], [0.12, 0.1, 0.12]];
const BAGS = [[0.2, 0.14, 0.1], [0.12, 0.14, 0.22], [0.75, 0.18, 0.16], [0.9, 0.62, 0.3]];

// paths: [{ pts: [[x,z],...], off, lift(x,z) }]; people walk along a path at `off` metres to one side, turning at the ends
export function pedestrians(paths, groundAt, count, seed = 21) {
  const rng = mulberry32(seed), geo = personGeometry();
  const walkers = [];
  const lens = paths.map(P => { let L = 0; const seg = []; for (let i = 0; i + 1 < P.pts.length; i++) { const l = Math.hypot(P.pts[i + 1][0] - P.pts[i][0], P.pts[i + 1][1] - P.pts[i][1]); seg.push(l); L += l; } P.seg = seg; P.L = L; return L; });
  const total = lens.reduce((a, b) => a + b, 0);
  const cols = new Float32Array(count * 12), ps = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    let u = rng() * total, pi = 0; while (pi < paths.length - 1 && u > lens[pi]) { u -= lens[pi]; pi++; }
    const P = paths[pi], kid = rng() < 0.22, uniform = kid && rng() < 0.6;
    const shirt = uniform ? [0.97, 0.97, 0.95] : pick(rng, SHIRTS), pants = uniform ? [0.16, 0.2, 0.36] : pick(rng, PANTS), hair = pick(rng, HAIR), bag = kid ? (rng() < 0.5 ? [0.2, 0.12, 0.1] : [0.75, 0.2, 0.18]) : pick(rng, BAGS);
    cols.set([...shirt, ...pants, ...hair, ...bag], i * 12);
    const speed = (kid ? 1.05 : 1.2) + rng() * 0.35, scale = kid ? 0.78 + rng() * 0.08 : 0.95 + rng() * 0.12;
    ps[i * 2] = rng() * 6.28; ps[i * 2 + 1] = speed * 2.9 / scale;
    walkers.push({ P, s: u, dir: rng() < 0.5 ? 1 : -1, side: rng() < 0.5 ? 1 : -1, speed, scale, pause: 0, x: 0, z: 0 });
  }
  // shirt, trousers, hair and bag colours: 12 floats per person, read as three vec4 views
  const buf = new THREE.InstancedInterleavedBuffer(cols, 12, 1);
  geo.setAttribute('iColA', new THREE.InterleavedBufferAttribute(buf, 4, 0));
  geo.setAttribute('iColB', new THREE.InterleavedBufferAttribute(buf, 4, 4));
  geo.setAttribute('iColC', new THREE.InterleavedBufferAttribute(buf, 4, 8));
  geo.setAttribute('iWalk', new THREE.InstancedBufferAttribute(ps, 2));
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0 });
  mat.onBeforeCompile = sh => {
    sh.uniforms.uTime = S.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aPart, aSlot; attribute vec4 iColA, iColB, iColC; attribute vec2 iWalk;
        uniform float uTime; varying vec3 vPCol;
        float pAng() { float ph = uTime * iWalk.y + iWalk.x, s = sin(ph) * 0.5;
          return aPart < 0.5 ? 0.0 : aPart < 1.5 ? s : aPart < 2.5 ? -s : aPart < 3.5 ? -s * 0.8 : s * 0.8; }
        vec3 pRot(vec3 p, float a, float py) { p.y -= py; p = vec3(p.x, p.y * cos(a) - p.z * sin(a), p.y * sin(a) + p.z * cos(a)); p.y += py; return p; }`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        float pa = pAng(), piv = aPart < 2.5 ? 0.82 : 1.3;
        objectNormal = pRot(objectNormal + vec3(0.0, piv, 0.0), pa, piv) - vec3(0.0, piv, 0.0);`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed = pRot(transformed, pa, piv);
        transformed.y += abs(sin(uTime * iWalk.y + iWalk.x)) * 0.035;
        vec3 skin = vec3(1.0, 0.84, 0.72);
        vPCol = aSlot < 0.5 ? skin : aSlot < 1.5 ? iColA.rgb : aSlot < 2.5 ? vec3(iColA.a, iColB.rg) : aSlot < 3.5 ? vec3(iColB.ba, iColC.r) : aSlot < 4.5 ? vec3(0.14, 0.13, 0.14) : iColC.gba;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPCol;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vPCol;');
  };
  mat.customProgramCacheKey = () => 'people';
  const im = new THREE.InstancedMesh(geo, mat, count);
  im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false;
  scene.add(im);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), sc = new THREE.Vector3();
  const at = (P, s) => { // point + direction along a polyline
    s = clamp(s, 0, P.L);
    for (let i = 0; i < P.seg.length; i++) {
      if (s <= P.seg[i] || i === P.seg.length - 1) { const a = P.pts[i], b = P.pts[i + 1], t = P.seg[i] ? s / P.seg[i] : 0, dx = (b[0] - a[0]) / (P.seg[i] || 1), dz = (b[1] - a[1]) / (P.seg[i] || 1); return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), dx, dz]; }
      s -= P.seg[i];
    }
  };
  const update = (dt) => {
    for (let i = 0; i < walkers.length; i++) {
      const w = walkers[i];
      w.s += w.dir * w.speed * dt;
      if (w.s < 0 || w.s > w.P.L) { w.dir *= -1; w.s = clamp(w.s, 0, w.P.L); }
      const [x, z, dx, dz] = at(w.P, w.s), o = w.P.off * w.side;
      w.x = x - dz * o; w.z = z + dx * o;
      const y = groundAt(w.x, w.z) + (w.P.lift ? w.P.lift(w.x, w.z) : 0);
      q.setFromAxisAngle(up, Math.atan2(dx * w.dir, dz * w.dir));
      m4.compose(v.set(w.x, y, w.z), q, sc.setScalar(w.scale));
      im.setMatrixAt(i, m4);
    }
    im.instanceMatrix.needsUpdate = true;
  };
  return { mesh: im, walkers, update, collide(p) { for (const w of walkers) { const dx = p.x - w.x, dz = p.z - w.z, d = Math.hypot(dx, dz); if (d < 0.6 && d > 1e-4) { p.x = w.x + dx / d * 0.6; p.z = w.z + dz / d * 0.6; } } } };
}
