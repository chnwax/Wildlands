// Town dressing for Sakuragawa: the things that make a street feel lived in. An elementary school with its sports
// ground, a playground park, zebra crossings, shop banners and signboards, bus stops, post boxes, garbage points,
// drying racks, mailboxes, rooftop tanks, and people walking the streets (instanced, animated in the vertex shader).
import { THREE, scene, S, mulberry32, clamp, lerp, addBox, addCircle, addPlatform } from './core.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTex, signMesh, JP_FONT, lampPoints, materials } from './townkit.js';
import { wallFill, reveals, windowUnit, inFrame } from './building.js';
import { cropSet } from './crops.js';
import { crowdMeshes } from './crowd.js';
import { torii, shimenawa, toro, offeringBox } from './shrine.js';

const plantAt = (B, type, lx, ly, lz, rng, s = 1) => { const p = B.P([lx, ly, lz]); cropSet.add(type, p[0], p[1], p[2], B.F.r + rng() * Math.PI * 2, s * (0.85 + rng() * 0.3)); };
const addPlatformAt = (p, hx, hz, r, top) => addPlatform(p[0], p[2], hx, hz, r, top);
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
  // woven windbreak screen for sports fences: dense dark green, a little see-through
  MT.screen = new THREE.MeshStandardMaterial({ color: 0x1d4630, roughness: 0.9, transparent: true, opacity: 0.86, side: THREE.DoubleSide, depthWrite: false });
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
const mul = (c, k) => c.map(v => v * k);
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
// roadside shrine (祠 hokora): a two-tier dressed-stone plinth on a gravel pad with a stone kerb, a small cedar hall
// with latticed doors under a nagare-style roof (the front slope sweeps out over the doors, copper ridge with chigi
// and katsuogi), a straw rope with paper streamers, a pair of small stone lanterns, a vermilion torii in front, an
// offering box, sakaki vases and a sake cup — and, at some, a stone jizo in a red bib.
const HOKORA_M = { lac: 'plastic', dark: 'plastic', wood: 'wood', stone: 'concrete', roof: 'roofMetal', glow: 'lamp', paper: 'plain', rope: 'plain', metal: 'steel', water: 'glass' };
export function streetShrine(B, x, y, z, r, rng = Math.random) {
  B.frame(x, y, z, r);
  const M = HOKORA_M, GRAN = [0.66, 0.65, 0.62], CEDAR = [0.62, 0.44, 0.3], DARK = [0.34, 0.24, 0.17], COP = [0.36, 0.56, 0.5];
  // gravel pad edged with stone kerbs
  B.box('ballast', 0, -0.02, 0.35, 2.6, 0.06, 2.9, { color: [0.86, 0.82, 0.74], skip: 'ny', uv: 1 });
  for (const [cx, cz, w, d] of [[0, -1.1, 2.7, 0.14], [-1.3, 0.35, 0.14, 2.9], [1.3, 0.35, 0.14, 2.9]]) B.bbox('concrete', cx, -0.05, cz, w, 0.16, d, 0.02, { color: GRAN });
  // two-tier plinth
  B.bbox('concrete', 0, -0.1, -0.3, 1.5, 0.42, 1.2, 0.03, { color: mul(GRAN, 0.95), uv: 1 });
  B.bbox('concrete', 0, 0.32, -0.3, 1.14, 0.28, 0.9, 0.025, { color: GRAN, uv: 1 });
  B.bbox('concrete', 0, 0.6, -0.3, 1.02, 0.05, 0.8, 0.01, { color: mul(GRAN, 1.05) });
  const f0 = 0.65;
  // hall: sill, corner posts, board walls, latticed double doors, a little veranda board in front
  B.bbox('wood', 0, f0, -0.35, 0.78, 0.06, 0.6, 0.008, { color: DARK });
  for (const sx of [-0.36, 0.36]) for (const sz of [-0.62, -0.08]) B.bbox('wood', sx, f0 + 0.06, sz, 0.06, 0.62, 0.06, 0.006, { color: DARK });
  B.box('wood', 0, f0 + 0.06, -0.62, 0.66, 0.62, 0.02, { color: CEDAR, uv: 0.8 });
  for (const sx of [-1, 1]) B.box('wood', sx * 0.36, f0 + 0.06, -0.35, 0.02, 0.62, 0.48, { color: CEDAR, uv: 0.8 });
  B.box('dark', 0, f0 + 0.08, -0.1, 0.62, 0.56, 0.01, { color: [0.08, 0.07, 0.06] });
  for (const sx of [-1, 1]) { // lattice doors
    const dx = sx * 0.16;
    B.bbox('wood', dx, f0 + 0.08, -0.07, 0.3, 0.02, 0.03, 0.004, { color: DARK }); B.bbox('wood', dx, f0 + 0.62, -0.07, 0.3, 0.03, 0.03, 0.004, { color: DARK });
    for (const e of [-0.14, 0.14]) B.box('wood', dx + e, f0 + 0.08, -0.07, 0.025, 0.56, 0.03, { color: DARK });
    B.detail(1, () => { for (let k = 1; k < 5; k++) B.box('wood', dx - 0.14 + k * 0.056, f0 + 0.1, -0.07, 0.012, 0.52, 0.02, { color: DARK });
      for (let k = 1; k < 9; k++) B.box('wood', dx, f0 + 0.08 + k * 0.06, -0.07, 0.28, 0.01, 0.02, { color: DARK }); });
  }
  B.bbox('wood', 0, f0 - 0.02, 0.05, 0.86, 0.04, 0.24, 0.006, { color: CEDAR });
  // nagare roof: the rear slope short, the front slope long and swept, with thickness, verge boards and a copper ridge
  const ry = f0 + 0.95, eb = f0 + 0.68, zr = -0.42, zb = -0.78, zf = 0.22, xh = 0.52, t = 0.05;
  const slope = (za, ya, zc, yc, s) => {
    B.poly('roofMetal', [[-xh, ya, za], [xh, ya, za], [xh, yc, zc], [-xh, yc, zc]], [0, 1, s * 0.6], { color: COP, uv: 0.5 });
    B.poly('plain', [[-xh, ya - t, za], [xh, ya - t, za], [xh, yc - t, zc], [-xh, yc - t, zc]], [0, -1, 0], { color: mul(CEDAR, 0.8) });
    B.bbox('wood', 0, ya - t - 0.01, za, 2 * xh + 0.02, t + 0.02, 0.03, 0.004, { color: DARK });
    for (const sx of [-1, 1]) B.beam('wood', [sx * xh, ya - t / 2, za], [sx * xh, yc - t / 2, zc], 0.03, t + 0.03, { color: DARK });
  };
  slope(zb, eb, zr, ry, -1);
  const zm = 0.02, ym = eb + 0.02; // front slope in two pitches: steeper near the ridge, flatter at the eave (the sweep)
  slope(zf, ym - 0.1, zm, ym + 0.06, 1); slope(zm, ym + 0.06, zr, ry, 1);
  for (const sx of [-1, 1]) B.poly('wood', [[sx * 0.36, f0 + 0.68, -0.62], [sx * 0.36, f0 + 0.68, -0.08], [sx * 0.36, ry - 0.06, zr]], [sx, 0, 0], { color: CEDAR, uv: 0.8 }); // gable triangles
  B.bbox('roofMetal', 0, ry - 0.01, zr, 2 * xh + 0.06, 0.07, 0.1, 0.01, { color: mul(COP, 0.85) });                    // ridge
  for (const k of [-0.2, 0, 0.2]) B.cyl('wood', k, ry + 0.06, zr, 0.025, 0.025, 0.035, 8, { color: [0.92, 0.78, 0.3], cap: true }); // katsuogi ends
  for (const sx of [-1, 1]) { B.beam('wood', [sx * (xh + 0.02), ry - 0.05, zr - 0.1], [sx * (xh - 0.06), ry + 0.22, zr + 0.06], 0.025, 0.03, { color: DARK }); } // chigi
  // straw rope with streamers across the front, sake cup and sakaki vases, offering box
  shimenawa(B, M, [-0.38, f0 + 0.64, -0.03], [0.38, f0 + 0.64, -0.03], 0.07, 0.022, 2);
  for (const sx of [-0.3, 0.3]) { B.cyl('plastic', sx, f0, 0.1, 0.035, 0.03, 0.12, 8, { color: [0.95, 0.95, 0.93], cap: true });
    B.detail(1, () => { for (let k = 0; k < 4; k++) B.bbox('plain', sx + (k % 2 - 0.5) * 0.05, f0 + 0.12 + Math.floor(k / 2) * 0.06, 0.1 + (k - 1.5) * 0.015, 0.07, 0.05, 0.03, 0.012, { color: [0.16, 0.42, 0.22] }); }); }
  B.cyl('plastic', 0, f0, 0.12, 0.03, 0.022, 0.025, 8, { color: [0.95, 0.95, 0.93], cap: true });
  offeringBox(B, M, 0, 0.62, 0.42);
  // small stone lanterns either side, and the torii in front
  for (const sx of [-0.95, 0.95]) toro(B, M, sx, 0.45, 0.42);
  inFrame(B, [0, 0, 1.25], 0, () => torii(B, M, { span: 1.2, h: 1.65, rope: false }));
  if (rng() < 0.45) inFrame(B, [0.95, 0, -0.35], 0, () => { // jizo on its own stone
    B.bbox('concrete', 0, 0, 0, 0.36, 0.2, 0.32, 0.02, { color: GRAN });
    B.cyl('concrete', 0, 0.2, 0, 0.11, 0.13, 0.36, 10, { color: [0.6, 0.6, 0.57] });
    B.cyl('concrete', 0, 0.56, 0, 0.08, 0.1, 0.02, 10, { color: [0.6, 0.6, 0.57] });
    B.sweep('concrete', [[0.0, -0.09], [0.07, -0.06], [0.09, 0], [0.07, 0.07], [0, 0.1], [-0.07, 0.07], [-0.09, 0], [-0.07, -0.06]], [[0, 0.58, 0], [0, 0.6, 0]], { closed: true, caps: true, color: [0.6, 0.6, 0.57] });
    B.cyl('plastic', 0, 0.44, 0, 0.13, 0.15, 0.12, 10, { color: [0.86, 0.16, 0.12] }); });                            // red bib
  const p = B.P([0, 0, 0.1]); addBox(p[0], p[2], 1.35, 1.5, r, y - 1, y + 1.6);
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
// neighbourhood park (児童公園): a looping paver path from the gate round a central lawn, play equipment in zones on
// rubber safety surfacing — swings, a combination tower with slides, a bridge and a climbing net, monkey bars, a jungle
// gym, horizontal bars at three heights, spring riders, a seesaw, a shaded sandbox — a wisteria pergola with benches,
// a drinking fountain, a clock, park lights, bins and a notice board, the toilet block, a bike rack by the gate, trees
// round the edge. Local frame: the gate is at +z (D / 2). Returns { lawn: [x0, z0, x1, z1] } (local) for the ground mask.
export function playground(B, x, y, z, r, W, D, rng, trees, extras, lampPts = null, bikes = null) {
  B.frame(x, y, z, r);
  const F = B.F, at = (lx, lz, rr = 0) => { B.F = F; B.frame(...B.P([lx, 0, lz]), r + rr); };
  const red = [0.9, 0.25, 0.2], yel = [1, 0.8, 0.2], blu = [0.25, 0.5, 0.9], grn = [0.3, 0.72, 0.4], org = [0.95, 0.52, 0.18];
  const tube = (mat, pts, rad, col, caps = true) => B.sweep(mat, circ(rad, 10), pts, { closed: true, caps, color: col, uv: 1 });
  const box = (lx, lz, hx, hz, h = 2) => { const p = B.P([lx, 0, lz]); extras.push({ t: 'box', p, hx, hz, r: B.F.r, h }); };
  const mat = (lx, lz, w, d, col) => { B.F = F; B.bbox('plastic', lx, -0.06, lz, w, 0.1, d, 0.03, { color: col, skip: 'ny' }); };
  // ---- fence with the gate on the street side, gate posts, name board
  const fcol = [0.35, 0.6, 0.45];
  const run = (ax, az, bx, bz) => {
    const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 2.2));
    B.F = F; tube('alu', [[ax, 0.85, az], [bx, 0.85, bz]], 0.03, fcol); tube('alu', [[ax, 0.45, az], [bx, 0.45, bz]], 0.022, fcol);
    for (let k = 0; k <= n; k++) B.cyl('alu', lerp(ax, bx, k / n), -0.1, lerp(az, bz, k / n), 0.035, 0.035, 0.98, 10, { color: fcol, cap: true });
    const p = B.P([(ax + bx) / 2, 0, (az + bz) / 2]); extras.push({ t: 'box', p, hx: Math.abs(bx - ax) > 0.1 ? L / 2 : 0.08, hz: Math.abs(bx - ax) > 0.1 ? 0.08 : L / 2, r, h: 0.9 });
  };
  run(-W / 2, -D / 2, W / 2, -D / 2); run(-W / 2, -D / 2, -W / 2, D / 2); run(W / 2, -D / 2, W / 2, D / 2);
  run(-W / 2, D / 2, -2.5, D / 2); run(2.5, D / 2, W / 2, D / 2);
  for (const sx of [-2.6, 2.6]) { at(sx, D / 2); B.bbox('concrete', 0, 0, 0, 0.4, 1.1, 0.4, 0.02, { color: [0.78, 0.78, 0.76] }); }
  at(-3.4, D / 2 + 0.05);
  const sign = signMesh(1.6, 0.5, (g, W2, H2) => { g.fillStyle = '#2f6b4a'; g.fillRect(0, 0, W2, H2); g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `bold ${H2 * 0.5}px ${JP_FONT}`; g.fillText('桜川児童公園', W2 / 2, H2 * 0.54); }, 0.2);
  sign.position.set(...B.P([0, 1.4, 0.08])); sign.rotation.y = r; scene.add(sign);
  B.cyl('steel', -0.7, 0, 0, 0.03, 0.03, 1.7, 8, { color: [0.6, 0.6, 0.6], cap: true }); B.cyl('steel', 0.7, 0, 0, 0.03, 0.03, 1.7, 8, { color: [0.6, 0.6, 0.6], cap: true });
  // car-stop bollards in the gateway, a bike rack outside it
  for (const bx of [-1.2, 0, 1.2]) { at(bx, D / 2); B.cyl('steel', 0, 0, 0, 0.06, 0.06, 0.8, 12, { color: [0.85, 0.86, 0.86], cap: true }); B.cyl('plain', 0, 0.62, 0, 0.065, 0.065, 0.08, 12, { color: yel }); }
  at(6.5, D / 2 + 1.2);
  for (let k = 0; k < 6; k++) { tube('steel', [[-2 + k * 0.8, 0, 0], [-2 + k * 0.8, 0.7, 0], [-2 + k * 0.8 + 0.35, 0.7, 0], [-2 + k * 0.8 + 0.35, 0, 0]], 0.02, [0.7, 0.7, 0.72]);
    if (bikes && rng() < 0.6) bikes.push({ x: B.P([-2 + k * 0.8 + 0.17, 0, 0])[0], y, z: B.P([-2 + k * 0.8 + 0.17, 0, 0])[2], r: r + Math.PI / 2 }); }
  // ---- paver paths: gate -> plaza -> a loop round the lawn (terracotta interlocking blocks with a granite edge)
  const PAV = [0.74, 0.52, 0.42], EDGE = [0.72, 0.72, 0.7];
  const path = (ax, az, bx, bz, w = 2.2) => { B.F = F; const L = Math.hypot(bx - ax, bz - az), cx = (ax + bx) / 2, cz = (az + bz) / 2, rr = Math.atan2(bx - ax, bz - az);
    B.frame(...B.P([cx, 0, cz]), r + rr); B.box('tiles', 0, -0.07, 0, w, 0.1, L + w * 0.0, { color: PAV, uv: 0.8, skip: 'ny' });
    for (const s of [-1, 1]) B.bbox('concrete', s * (w / 2 + 0.06), -0.08, 0, 0.12, 0.12, L, 0.01, { color: EDGE }); B.F = F; };
  path(0, D / 2 + 3.3, 0, 5.5, 3);                                                          // from the footway edge in through the gate
  B.F = F; B.cyl('tiles', 0, -0.07, 3.5, 3.2, 3.2, 0.1, 28, { color: PAV, cap: true, uv: 0.8 }); // plaza disc
  const LX = 6.5, LZ0 = -9, LZ1 = 3.5; // lawn loop
  path(-LX, LZ1, LX, LZ1); path(-LX, LZ0, LX, LZ0); path(-LX, LZ0 - 1.1, -LX, LZ1 + 1.1); path(LX, LZ0 - 1.1, LX, LZ1 + 1.1);
  // ---- NW: swings on a mat
  at(-13.5, -10);
  for (const sx of [-2.4, 2.4]) { tube('plain', [[sx, 0, -0.95], [sx, 2.45, 0]], 0.055, red); tube('plain', [[sx, 0, 0.95], [sx, 2.45, 0]], 0.055, red); }
  tube('plain', [[-2.6, 2.45, 0], [2.6, 2.45, 0]], 0.06, blu);
  for (const sx of [-1.2, 1.2]) {
    B.detail(1, () => { for (const d of [-0.2, 0.2]) B.beam('steel', [sx + d, 2.42, 0], [sx + d, 0.5, 0], 0.012, 0.012, { color: [0.72, 0.72, 0.74] }); });
    B.bbox('plastic', sx, 0.44, 0, 0.5, 0.05, 0.2, 0.015, { color: yel });
  }
  B.bbox('steel', 0, 0, 2.3, 5.8, 0.6, 0.06, 0.01, { color: [0.35, 0.6, 0.45] });                           // safety rail in front
  mat(-13.5, -10, 6.6, 5.6, [0.26, 0.5, 0.36]); box(-13.5, -10, 2.6, 1.0, 2.5);
  // ---- NE: combination tower: two decks with a hipped hood, a straight slide, a spiral-ish tube slide, rope net, bridge
  at(12.5, -9.5);
  const post = (px, pz, h) => B.cyl('plain', px, 0, pz, 0.07, 0.07, h, 12, { color: blu, cap: true });
  for (const [px, pz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) post(px - 2.2, pz, 3.1);
  for (const [px, pz] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) post(px + 2.2, pz, 2.4);
  B.bbox('wood', -2.2, 1.8, 0, 1.7, 0.08, 1.7, 0.015, { color: [0.85, 0.6, 0.4] }); B.bbox('wood', 2.2, 1.2, 0, 1.5, 0.08, 1.5, 0.015, { color: [0.85, 0.6, 0.4] });
  B.cyl('plain', -2.2, 3.1, 0, 1.3, 0.1, 0.7, 4, { color: red, cap: true, smooth: false });
  B.cyl('plain', 2.2, 2.4, 0, 1.15, 0.1, 0.55, 4, { color: yel, cap: true, smooth: false });
  for (const s of [-1, 1]) { tube('alu', [[-1.4, 2.6, s * 0.72], [1.5, 2.0, s * 0.62]], 0.03, org); for (let k = 0; k <= 8; k++) B.cyl('alu', -1.4 + k * 0.36, 1.84 - k * 0.075, s * 0.7, 0.015, 0.015, 0.75, 6, { color: org }); }
  for (let k = 0; k < 9; k++) B.bbox('wood', -1.25 + k * 0.32, 1.84 - (k + 0.5) * 0.072, 0, 0.26, 0.05, 1.3, 0.01, { color: [0.82, 0.58, 0.38] }); // bridge slats
  for (const s of [-1, 1]) for (const k of [0.95, 1.9]) tube('alu', [[-3.0, k, s * 0.8], [-1.4, k, s * 0.8]], 0.025, grn, false);
  const chute = [[-2.2, 1.85, -0.85], [-2.2, 1.45, -1.8], [-2.2, 0.85, -2.9], [-2.2, 0.45, -3.8], [-2.2, 0.35, -4.3]];
  B.sweep('plastic', [[-0.36, 0], [0.36, 0], [0.36, 0.3], [0.32, 0.3], [0.32, 0.03], [-0.32, 0.03], [-0.32, 0.3], [-0.36, 0.3]], chute, { closed: true, color: yel });
  const tubeP = []; for (let k = 0; k <= 10; k++) { const a = k / 10 * Math.PI * 0.9; tubeP.push([2.2 + 1.3 * Math.sin(a), 1.25 - k * 0.1, 0.8 + 1.3 * (1 - Math.cos(a))]); }
  B.sweep('plastic', circ(0.36, 14), tubeP, { closed: true, color: grn });
  for (let i = 0; i <= 5; i++) { const zz = -0.75 + i * 0.3; tube('steel', [[-3.05, 0.1, zz], [-3.05, 1.8, zz]], 0.012, [0.6, 0.45, 0.3], false); }  // rope net
  for (let j = 1; j <= 5; j++) tube('steel', [[-3.05, j * 0.3, -0.75], [-3.05, j * 0.3, 0.75]], 0.012, [0.6, 0.45, 0.3], false);
  mat(12.5, -10, 9.5, 9, [0.72, 0.36, 0.3]); box(12.5 - 2.2, -9.5, 0.9, 0.9, 3.1); box(12.5 + 2.2, -9.5, 0.8, 0.8, 2.4); box(12.5 - 2.2, -12, 0.4, 1.6, 1.2);
  // ---- back centre: wisteria pergola (藤棚) with benches
  at(0, -13);
  for (const px of [-2.5, 2.5]) for (const pz of [-1.1, 1.1]) B.bbox('wood', px, 0, pz, 0.16, 2.4, 0.16, 0.015, { color: [0.45, 0.32, 0.22] });
  for (const pz of [-1.1, 1.1]) B.bbox('wood', 0, 2.4, pz, 5.6, 0.14, 0.14, 0.01, { color: [0.45, 0.32, 0.22] });
  for (let k = 0; k < 11; k++) B.bbox('wood', -2.6 + k * 0.52, 2.54, 0, 0.08, 0.08, 2.8, 0.01, { color: [0.5, 0.36, 0.24] });
  B.detail(1, () => { const wr = mulberry32(99); for (let k = 0; k < 26; k++) { const px = -2.6 + wr() * 5.2, pz = -1.3 + wr() * 2.6;
    B.bbox('plain', px, 2.62, pz, 0.6 + wr() * 0.5, 0.18, 0.5 + wr() * 0.4, 0.08, { color: [0.4, 0.58, 0.3] });
    if (wr() < 0.6) B.bbox('plain', px, 2.3, pz, 0.12, 0.35, 0.12, 0.05, { color: [0.72, 0.58, 0.9] }); } });            // leaves and hanging racemes
  for (const pz of [-0.6, 0.6]) { B.bbox('wood', 0, 0.42, pz, 3.8, 0.05, 0.38, 0.01, { color: [0.82, 0.6, 0.42] }); for (const sx of [-1.6, 1.6]) B.bbox('concrete', sx, 0, pz, 0.12, 0.42, 0.34, 0.01, { color: [0.7, 0.7, 0.68] }); }
  mat(0, -13, 6, 3.2, [0.66, 0.62, 0.56]); box(0, -13, 2.0, 0.7, 0.5);
  // ---- SW: shaded sandbox and the toilet block in the corner
  at(-12, 8.5);
  for (const s2 of [-1, 1]) { B.bbox('wood', 0, 0, s2 * 1.92, 4.0, 0.3, 0.16, 0.03, { color: [0.85, 0.62, 0.42] }); B.bbox('wood', s2 * 1.92, 0, 0, 0.16, 0.3, 3.7, 0.03, { color: [0.85, 0.62, 0.42] }); }
  B.box('plain', 0, 0.01, 0, 3.7, 0.2, 3.7, { color: [0.96, 0.88, 0.66], skip: 'ny' });
  B.bbox('plastic', 0.6, 0.21, 0.4, 0.3, 0.12, 0.3, 0.03, { color: red }); B.bbox('plastic', -0.7, 0.21, -0.5, 0.25, 0.1, 0.35, 0.03, { color: blu });
  B.cyl('plastic', 1.1, 0.21, -0.9, 0.14, 0.1, 0.16, 10, { color: yel }); B.bbox('plastic', -0.2, 0.21, 1.0, 0.4, 0.06, 0.2, 0.02, { color: grn });
  for (const [px, pz] of [[-2.1, -2.1], [2.1, -2.1], [-2.1, 2.1], [2.1, 2.1]]) B.cyl('steel', px, 0, pz, 0.05, 0.05, 2.6, 10, { color: [0.85, 0.86, 0.86], cap: true });
  B.poly('plain', [[-2.4, 2.75, -2.4], [2.4, 2.75, -2.4], [2.4, 2.45, 2.4], [-2.4, 2.45, 2.4]], [0, 1, 0.1], { color: [0.84, 0.8, 0.7] });   // sun canvas
  B.poly('plain', [[-2.4, 2.73, -2.4], [2.4, 2.73, -2.4], [2.4, 2.43, 2.4], [-2.4, 2.43, 2.4]], [0, -1, 0], { color: [0.86, 0.85, 0.8] });
  at(-W / 2 + 3.2, D / 2 - 3.6, Math.PI / 2);
  B.bbox('block', 0, 0, 0, 3.6, 2.6, 2.8, 0.02, { color: [0.88, 0.86, 0.8], uv: 1.6 });
  B.bbox('roofMetal', 0, 2.6, 0, 4.2, 0.12, 3.4, 0.02, { color: [0.35, 0.5, 0.42] });
  for (const [sx, c] of [[-0.9, [0.2, 0.35, 0.75]], [0.9, [0.85, 0.25, 0.3]]]) { B.bbox('metal', sx, 0.05, 1.41, 0.8, 1.95, 0.04, 0.01, { color: [0.72, 0.74, 0.76] }); B.bbox('plastic', sx, 2.15, 1.43, 0.3, 0.3, 0.02, 0.01, { color: c }); }
  B.bbox('lamp', 0, 2.3, 1.43, 0.4, 0.1, 0.06, 0.01);
  extras.push({ t: 'box', p: B.P([0, 0, 0]), hx: 1.8, hz: 1.4, r: r + Math.PI / 2 });
  // ---- SE: horizontal bars, spring riders, seesaw, jungle gym, monkey bars
  at(14, 12);
  for (let k = 0; k < 4; k++) B.cyl('plain', -1.8 + k * 1.2, 0, 0, 0.05, 0.05, [1.0, 1.25, 1.5, 1.5][k] + 0.1, 10, { color: yel, cap: true });
  for (let k = 0; k < 3; k++) tube('steel', [[-1.8 + k * 1.2, 0.95 + k * 0.25, 0], [-0.6 + k * 1.2, 0.95 + k * 0.25, 0]], 0.02, [0.8, 0.82, 0.84]);
  mat(14, 12, 4.6, 2.2, [0.26, 0.5, 0.36]); box(14, 12, 2.0, 0.2, 1.5);
  const rider = (lx, lz, col) => { at(lx, lz); B.cyl('steel', 0, 0, 0, 0.12, 0.12, 0.08, 10, { color: [0.4, 0.4, 0.42], cap: true });
    const sp = []; for (let k = 0; k <= 12; k++) { const a = k / 12 * Math.PI * 8; sp.push([Math.cos(a) * 0.1, 0.08 + k * 0.03, Math.sin(a) * 0.1]); } B.sweep('steel', circ(0.015, 6), sp, { color: [0.3, 0.3, 0.32] });
    B.bbox('plastic', 0, 0.45, 0, 0.3, 0.3, 0.75, 0.1, { color: col }); B.bbox('plastic', 0, 0.65, 0.35, 0.26, 0.3, 0.26, 0.1, { color: col });
    tube('plastic', [[-0.16, 0.78, 0.2], [0.16, 0.78, 0.2]], 0.02, [0.9, 0.9, 0.9]); box(lx, lz, 0.25, 0.4, 0.9); };
  rider(9.5, 6.5, red); rider(11.2, 6.2, [0.95, 0.6, 0.75]); rider(12.9, 6.8, grn);
  mat(11.2, 6.5, 5, 2.4, [0.72, 0.36, 0.3]);
  at(16.5, 6.5, Math.PI / 2);                                                                               // seesaw
  B.bbox('metal', 0, 0, 0, 0.3, 0.45, 0.3, 0.02, { color: blu });
  B.bbox('plain', 0, 0.48, 0, 3.4, 0.08, 0.26, 0.02, { color: yel });
  for (const s of [-1, 1]) { B.bbox('plastic', s * 1.55, 0.56, 0, 0.3, 0.06, 0.26, 0.02, { color: red }); tube('steel', [[s * 1.35, 0.56, -0.12], [s * 1.35, 0.8, 0], [s * 1.35, 0.56, 0.12]], 0.018, [0.8, 0.8, 0.8]); }
  box(16.5, 6.5, 0.2, 1.8, 0.8);
  at(-13.5, -2.5);                                                                                          // monkey bars (雲梯)
  for (const s of [-1, 1]) for (const e of [-2.4, 2.4]) B.cyl('plain', e, 0, s * 0.3, 0.05, 0.05, 2.1, 10, { color: org, cap: true });
  for (const s of [-1, 1]) tube('plain', [[-2.4, 2.05, s * 0.3], [2.4, 2.05, s * 0.3]], 0.04, org);
  for (let k = 0; k < 13; k++) tube('steel', [[-2.2 + k * 0.37, 2.05, -0.3], [-2.2 + k * 0.37, 2.05, 0.3]], 0.018, [0.8, 0.82, 0.84], false);
  for (const e of [-2.4, 2.4]) for (let k = 1; k < 5; k++) tube('steel', [[e, k * 0.4, -0.3], [e, k * 0.4, 0.3]], 0.018, [0.8, 0.82, 0.84], false);
  mat(-13.5, -2.5, 6, 1.8, [0.26, 0.5, 0.36]); box(-13.5, -2.5, 2.5, 0.35, 2.1);
  at(13, -1.5);                                                                                             // jungle gym
  for (let a = 0; a <= 3; a++) for (let b = 0; b <= 3; b++) B.cyl('alu', -1.2 + a * 0.8, 0, -1.2 + b * 0.8, 0.03, 0.03, 2.1, 8, { color: pick(rng, [red, yel, blu, grn]), cap: true });
  for (let h = 1; h <= 3; h++) for (let a = 0; a <= 3; a++) { tube('alu', [[-1.2, h * 0.7, -1.2 + a * 0.8], [1.2, h * 0.7, -1.2 + a * 0.8]], 0.022, grn, false); tube('alu', [[-1.2 + a * 0.8, h * 0.7, -1.2], [-1.2 + a * 0.8, h * 0.7, 1.2]], 0.022, yel, false); }
  mat(13, -1.5, 3.4, 3.4, [0.72, 0.36, 0.3]); box(13, -1.5, 1.25, 1.25, 2.1);
  // ---- furniture: benches facing the lawn, drinking fountain, clock, lights, bins, notice board
  const bench = (lx, lz, rr) => { at(lx, lz, rr);
    for (let k = 0; k < 4; k++) B.bbox('wood', 0, 0.42, -0.15 + k * 0.1, 1.8, 0.04, 0.085, 0.01, { color: [0.82, 0.6, 0.42] });
    for (let k = 0; k < 3; k++) B.bbox('wood', 0, 0.55 + k * 0.12, -0.24, 1.8, 0.09, 0.03, 0.01, { color: [0.82, 0.6, 0.42] });
    for (const sx of [-0.8, 0.8]) { B.bbox('metal', sx, 0, 0, 0.05, 0.42, 0.44, 0.01, { color: [0.24, 0.25, 0.27] }); B.bbox('metal', sx, 0.42, -0.24, 0.05, 0.42, 0.05, 0.01, { color: [0.24, 0.25, 0.27] }); }
    const p = B.P([0, 0, 0]); extras.push({ t: 'box', p, hx: 0.95, hz: 0.25, r: r + rr, h: 0.5 }); };
  bench(-3.5, LZ1 + 1.9, Math.PI); bench(3.5, LZ1 + 1.9, Math.PI); bench(-LX - 1.9, -3, -Math.PI / 2); bench(LX + 1.9, -3, Math.PI / 2);
  at(3.2, 5.5); B.cyl('concrete', 0, 0, 0, 0.25, 0.2, 0.85, 12, { color: [0.78, 0.78, 0.76] }); B.cyl('alu', 0, 0.85, 0, 0.3, 0.3, 0.08, 12, { color: [0.8, 0.82, 0.84], cap: true });
  B.cyl('steel', 0.1, 0.93, 0, 0.02, 0.02, 0.08, 6, { color: [0.7, 0.7, 0.7], cap: true }); box(3.2, 5.5, 0.3, 0.3, 1);
  at(-3.2, 5.8); B.cyl('steel', 0, 0, 0, 0.06, 0.05, 3.2, 10, { color: [0.85, 0.86, 0.86] });
  const clk = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.1, 24).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xf4f2ea, roughness: 0.4 }));
  clk.position.set(...B.P([0, 3.25, 0])); clk.rotation.y = r; clk.castShadow = true; scene.add(clk); box(-3.2, 5.8, 0.1, 0.1, 3);
  for (const [lx, lz] of [[-LX - 1.4, LZ1 + 1.4], [LX + 1.4, LZ1 + 1.4], [-LX - 1.4, LZ0 - 1.4], [LX + 1.4, LZ0 - 1.4]]) {
    at(lx, lz); B.cyl('steel', 0, 0, 0, 0.07, 0.05, 4.2, 10, { color: [0.3, 0.34, 0.3] });
    B.cyl('plain', 0, 4.2, 0, 0.26, 0.14, 0.18, 12, { color: [0.3, 0.34, 0.3], cap: true }); B.cyl('lamp', 0, 4.04, 0, 0.2, 0.2, 0.16, 12, { color: [1, 0.96, 0.86] });
    if (lampPts) lampPts.push({ p: B.P([0, 3.9, 0]), s: 0.9 }); box(lx, lz, 0.1, 0.1, 4);
  }
  for (const [lx, lz] of [[1.9, 7.5], [-LX - 1.6, 1]]) { at(lx, lz); B.cyl('metal', 0, 0, 0, 0.25, 0.23, 0.8, 14, { color: [0.28, 0.42, 0.34] }); B.cyl('metal', 0, 0.8, 0, 0.27, 0.27, 0.06, 14, { color: [0.2, 0.3, 0.25], cap: true }); box(lx, lz, 0.28, 0.28, 0.9); }
  at(4, D / 2 - 0.6);
  B.bbox('wood', 0, 0.8, 0, 1.4, 0.9, 0.08, 0.01, { color: [0.4, 0.3, 0.22] }); for (const sx of [-0.6, 0.6]) B.bbox('wood', sx, 0, 0, 0.08, 1.8, 0.08, 0.01, { color: [0.4, 0.3, 0.22] });
  B.box('plain', 0, 0.9, 0.045, 1.2, 0.7, 0.01, { color: [0.95, 0.94, 0.9] }); B.bbox('wood', 0, 1.75, 0, 1.6, 0.06, 0.24, 0.01, { color: [0.35, 0.26, 0.2] });
  // ---- trees round the edge (not over the equipment)
  const spots = [[-W / 2 + 2, -D / 2 + 2.5], [-W / 2 + 2, 0.5], [-4.5, -D / 2 + 2], [4.5, -D / 2 + 2], [W / 2 - 2, -D / 2 + 2], [W / 2 - 2, 3.5], [W / 2 - 2, D / 2 - 3.5], [-6.5, D / 2 - 3], [8.5, D / 2 - 2.5], [-LX + 1, -3.5], [LX - 1.5, 1.5]];
  for (const [lx, lz] of spots) { B.F = F; const p = B.P([lx, 0, lz]); trees.push({ x: p[0], z: p[2] }); }
  B.F = F;
  return { lawn: [-LX + 1.2, LZ0 + 1.2, LX - 1.2, LZ1 - 1.2] };
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
    if (fw === bw) for (let f = 0; f < floors; f++) for (let k = 0; k < bays; k++) { const x0 = bay0 + k * 1.8 + 0.06, x1 = bay0 + (k + 1) * 1.8 - 0.06;
      if (fr === 0 && f === 0 && x1 > -2.7 && x0 < 2.7) continue; holes.push({ x0, x1, y0: f * fh + 0.95, y1: f * fh + 2.9, d: 0.2 }); }
    else for (let f = 0; f < floors; f++) holes.push({ x0: -0.6, x1: 0.6, y0: f * fh + 1.2, y1: f * fh + 2.6, d: 0.2 });
    if (fr === 0) holes.push({ x0: -2.4, x1: 2.4, y0: 0.15, y1: 2.75, d: 0.25, door: true });
    wallFill(B, 'stucco', -fw / 2, fw / 2, 0, H + 1.0, holes, wall, 3);
    for (const h of holes) { reveals(B, 'stucco', h, [0.92, 0.92, 0.9]);
      if (!h.door) { windowUnit(B, h, { rng, frame: [0.82, 0.84, 0.86], transom: true, glass: [1, 0.94, 0.8], glassMat: fw === bw ? 'schoolWindow' : undefined }); continue; }
      // entrance (昇降口): four glass leaves in aluminium frames under a transom light, pull handles
      const zg = -0.16, AL = { color: [0.78, 0.8, 0.82] };
      B.quad('glass', [h.x0, h.y0, zg], [h.x1, h.y0, zg], [h.x1, h.y1, zg], [h.x0, h.y1, zg], { color: [0.9, 0.95, 1] });
      for (let k = 0; k <= 4; k++) B.box('alu', lerp(h.x0, h.x1, k / 4), h.y0, zg + 0.02, 0.07, h.y1 - h.y0, 0.06, AL);
      for (const yy of [h.y0, 2.25, h.y1 - 0.06]) B.box('alu', 0, yy, zg + 0.02, h.x1 - h.x0, 0.07, 0.06, AL);
      for (const xx of [-0.12, 0.12]) B.box('steel', xx, 0.9, zg + 0.08, 0.03, 0.5, 0.03, { color: [0.6, 0.62, 0.64] }); }
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
  // main entrance (昇降口): a raised porch under a deep flat roof on round columns, the school's name in cast letters
  // on the fascia with the cherry-blossom crest beside it, a glazed wind-lobby (風除室) with sliding doors in front of
  // the entrance, steps across the front and a ramp at one side, brick planters of flowers either side of the steps
  {
    const PD = 4.6, PW = 11, zf = bd / 2 + PD, SY = 0.32, STONE = [0.8, 0.79, 0.76], COL = [0.94, 0.93, 0.9];
    B.bbox('concrete', 0, -0.12, bd / 2 + PD / 2, PW, SY + 0.12, PD, 0.02, { color: STONE, uv: 1.5 });                          // porch floor
    for (let k = 1; k <= 2; k++) B.bbox('concrete', -1, -0.12, zf + k * 0.34 - 0.17, 7, SY + 0.12 - k * SY / 3, 0.34, 0.015, { color: mul(STONE, 1 - k * 0.03) }); // steps
    { const rx0 = 3.5, rl = 4.2; B.poly('concrete', [[rx0, SY, zf], [rx0 + 1.5, SY, zf], [rx0 + 1.5, 0.06, zf + rl], [rx0, 0.06, zf + rl]], [0, 1, 0], { color: STONE }); // ramp
      for (const xx of [rx0, rx0 + 1.5]) B.poly('concrete', [[xx, -0.1, zf], [xx, SY, zf], [xx, 0.06, zf + rl], [xx, -0.1, zf + rl]], [xx > rx0 ? 1 : -1, 0, 0], { color: STONE });
      for (const xx of [rx0 + 0.05, rx0 + 1.45]) { B.beam('steel', [xx, SY + 0.85, zf], [xx, 0.06 + 0.85, zf + rl], 0.04, 0.04, { color: [0.72, 0.74, 0.76] });
        for (const t of [0, 0.5, 1]) B.cyl('steel', xx, lerp(SY, 0.06, t), zf + rl * t, 0.022, 0.022, 0.85, 8, { color: [0.72, 0.74, 0.76] }); } }
    // roof slab on four columns, a soffit with downlights
    const RY = 3.7, RD = PD + 1.4;
    B.bbox('concrete', 0, RY, bd / 2 + RD / 2 - 0.2, PW + 1.2, 0.4, RD, 0.03, { color: COL, uv: 2 });
    for (const cx of [-PW / 2 + 0.6, -1.6, 1.6, PW / 2 - 0.6]) { B.cyl('concrete', cx, SY, zf - 0.2, 0.2, 0.2, RY - SY, 20, { color: COL }); extras.push({ t: 'circle', p: B.P([cx, 0, zf - 0.2]), r: 0.22 }); }
    for (const cx of [-3.5, 0, 3.5]) { B.box('lamp', cx, RY - 0.012, bd / 2 + 2.6, 0.5, 0.012, 0.5); lampPoints.push({ p: B.P([cx, RY - 0.2, bd / 2 + 2.6]), s: 0.45 }); }
    // wind lobby: aluminium-framed glass box round the entrance doors, automatic sliding doors in its front
    const LW = 5.6, LD = 2.2, LH = 2.8, AL = { color: [0.8, 0.82, 0.84] }, lz = bd / 2 + LD;
    for (const [a, b2, n, out] of [[[-LW / 2, lz], [LW / 2, lz], 4, [0, 0, 1]], [[-LW / 2, bd / 2], [-LW / 2, lz], 2, [-1, 0, 0]], [[LW / 2, bd / 2], [LW / 2, lz], 2, [1, 0, 0]]]) {
      B.poly('glass', [[a[0], SY, a[1]], [b2[0], SY, b2[1]], [b2[0], SY + LH, b2[1]], [a[0], SY + LH, a[1]]], out, { color: [0.9, 0.95, 1] });
      for (let k = 0; k <= n; k++) B.box('alu', lerp(a[0], b2[0], k / n), SY, lerp(a[1], b2[1], k / n), 0.07, LH, 0.07, AL);
      for (const yy of [SY, SY + 2.3, SY + LH - 0.07]) B.beam('alu', [a[0], yy + 0.035, a[1]], [b2[0], yy + 0.035, b2[1]], 0.07, 0.07, AL); }
    B.box('alu', 0, SY + LH, bd / 2 + LD / 2, LW + 0.1, 0.1, LD + 0.1, AL);
    B.box('dark', 0, SY + 2.38, lz + 0.05, 1.8, 0.18, 0.08, { color: [0.2, 0.2, 0.22] });                                          // door operator
    B.box('dark', 0, SY + 0.002, lz - 0.5, 2.2, 0.01, 1.6, { color: [0.2, 0.24, 0.2] });                                         // entrance mat
    extras.push({ t: 'box', p: B.P([-LW / 2, 0, bd / 2 + LD / 2]), hx: 0.06, hz: LD / 2, r }, { t: 'box', p: B.P([LW / 2, 0, bd / 2 + LD / 2]), hx: 0.06, hz: LD / 2, r });
    // name in cast letters on the fascia and the crest (校章: a five-petal cherry blossom round the character 桜)
    { const nm = signMesh(6.2, 0.36, (g, W, Hh) => { g.clearRect(0, 0, W, Hh); g.fillStyle = '#efede6'; g.fillRect(0, 0, W, Hh);
        g.fillStyle = '#6b5a3a'; g.font = `bold ${Hh * 0.78}px ${JP_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('桜 川 町 立 桜 川 小 学 校', W / 2, Hh * 0.52); }, 0.35, 128);
      const np = B.P([0.6, RY + 0.2, bd / 2 + RD - 0.2 + 0.011]); nm.position.set(...np); nm.rotation.y = r; scene.add(nm);
      const cr = signMesh(0.62, 0.62, (g, W, Hh) => { g.clearRect(0, 0, W, Hh); g.save(); g.translate(W / 2, Hh / 2);
        for (let k = 0; k < 5; k++) { g.rotate(Math.PI * 2 / 5); g.fillStyle = '#e8a6b8'; g.beginPath(); g.ellipse(0, -W * 0.25, W * 0.15, W * 0.22, 0, 0, Math.PI * 2); g.fill(); }
        g.fillStyle = '#f7f1e4'; g.beginPath(); g.arc(0, 0, W * 0.16, 0, Math.PI * 2); g.fill(); g.fillStyle = '#6b5a3a'; g.font = `bold ${W * 0.2}px ${JP_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('桜', 0, W * 0.01); g.restore(); }, 0.3, 128);
      cr.material.transparent = false; cr.material.alphaTest = 0.5;
      const cp2 = B.P([-PW / 2 + 0.2, RY + 0.2, bd / 2 + RD - 0.2 + 0.012]); cr.position.set(...cp2); cr.rotation.y = r; scene.add(cr); }
    // brick planters with flowers either side of the steps
    for (const [cx, w2] of [[-6.3, 2.4], [6.5, 2.0]]) {
      B.bbox('block', cx, -0.12, zf + 1.1, w2, 0.62, 1.2, 0.02, { color: [0.7, 0.42, 0.34], uv: 1 });
      B.box('soil', cx, 0.48, zf + 1.1, w2 - 0.2, 0.01, 1.0, { color: [0.4, 0.3, 0.22] });
      for (let k = 0; k < 10; k++) plantAt(B, k % 2 ? 'flowerP' : 'flowerY', cx - w2 / 2 + 0.3 + (k % 5) * (w2 - 0.6) / 4, 0.49, zf + 0.8 + Math.floor(k / 5) * 0.6, rng);
      extras.push({ t: 'box', p: B.P([cx, 0, zf + 1.1]), hx: w2 / 2, hz: 0.6, r, h: 0.6 }); }
    extras.push({ t: 'box', p: B.P([0, 0, bd / 2 + PD / 2]), hx: PW / 2, hz: PD / 2, r, h: SY });
    addPlatformAt(B.P([0, 0, bd / 2 + PD / 2]), PW / 2, PD / 2, r, B.P([0, SY, 0])[1]);
  }
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
    const nw = fd + 1, nh = 8, n = Math.round(nw / 5);
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
  at(bx + 12, bz + bd / 2 + 5.5); // assembly stage, to one side of the entrance forecourt
  B.box('concrete', 0, 0, 0, 4, 1.0, 2.4, { color: [0.86, 0.86, 0.84] });
  for (let k = 0; k < 3; k++) B.box('concrete', 0, 0, 1.2 + k * 0.3 + 0.15, 1.6, 1.0 - (k + 1) * 0.3, 0.3, { color: [0.82, 0.82, 0.8] });
  extras.push({ t: 'box', p: B.P([0, 0, 0]), hx: 2, hz: 1.2, r, h: 1.0 });
  at(bx - 9, bz + bd / 2 + 2.3); // flag pole at the corner of the forecourt
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
  const hw = BW / 2, hd = BD / 2, pz = bz + bd / 2 + 7.2, aw = 3.6, gap = 3.3; // walkway centre line / width, half gate
  fence(-hw, -hd, hw, -hd); fence(hw, -hd, hw, hd); fence(-hw, hd, hw, hd);
  fence(-hw, -hd, -hw, pz - gap - 0.3); fence(-hw, pz + gap + 0.3, -hw, hd);
  // gate pillars clad in tile with caps, a lamp on each, the name plate and an intercom on the street face
  for (const sz of [-1, 1]) { at(-hw, pz + sz * gap);
    B.bbox('tiles', 0, 0, 0, 0.62, 1.95, 0.62, 0.02, { color: [0.78, 0.74, 0.68], uv: 1 }); B.bbox('concrete', 0, 1.95, 0, 0.74, 0.1, 0.74, 0.02, { color: [0.62, 0.6, 0.56] });
    B.cyl('steel', 0, 2.05, 0, 0.05, 0.05, 0.06, 10, { color: [0.3, 0.3, 0.3] }); B.cyl('lamp', 0, 2.1, 0, 0.12, 0.1, 0.28, 14, { color: [0.98, 0.96, 0.9], cap: true });
    lampPoints.push({ p: B.P([0, 2.2, 0]), s: 0.35 });
    extras.push({ t: 'box', p: B.P([0, 0, 0]), hx: 0.31, hz: 0.31, r }); }
  at(-hw, pz - gap);
  const plate = signMesh(0.42, 1.3, (g, W, H) => { g.fillStyle = '#f7f3ea'; g.fillRect(0, 0, W, H); g.fillStyle = '#2b2b2b'; g.textAlign = 'center';
    const txt = '桜川小学校'; g.font = `bold ${W * 0.7}px ${JP_FONT}`; for (let i = 0; i < txt.length; i++) g.fillText(txt[i], W / 2, H * (0.16 + i * 0.17)); }, 0.2, 256);
  const pp = B.P([-0.32, 1.05, 0]); plate.position.set(...pp); plate.rotation.y = Math.atan2(-Math.cos(r), Math.sin(r)); scene.add(plate);
  B.bbox('plastic', -0.32, 1.25, 0.18, 0.03, 0.2, 0.12, 0.01, { color: [0.3, 0.3, 0.32] });                                  // intercom
  // expanding gate (伸縮門扉) folded back against the south pillar: a pack of lattice bars on castors, and its rail
  at(-hw + 0.45, pz + gap - 0.75);
  for (let k = 0; k < 10; k++) B.box('alu', 0, 0.12, -0.36 + k * 0.08, 0.05, 1.25, 0.025, { color: [0.72, 0.74, 0.76] });
  for (const yy of [0.35, 0.75, 1.15]) for (let k = 0; k < 9; k++) B.beam('alu', [0, yy - 0.18, -0.36 + k * 0.08], [0, yy + 0.18, -0.28 + k * 0.08], 0.02, 0.012, { color: [0.72, 0.74, 0.76] });
  for (const zz of [-0.36, 0.36]) B.cyl('dark', 0, 0, zz, 0.06, 0.06, 0.12, 10, { color: [0.15, 0.15, 0.15], cap: true });
  extras.push({ t: 'box', p: B.P([0, 0, 0]), hx: 0.1, hz: 0.42, r, h: 1.4 });
  B.F = F;
  B.box('steel', -hw, 0.0, pz, 0.08, 0.02, gap * 2, { color: [0.5, 0.5, 0.5] });                                              // gate rail
  // paved approach: an apron out to the road, the walkway along the grounds, a forecourt at the entrance
  const ex = bx - 9, PAVE = { color: [0.84, 0.82, 0.78], uv: 1.5 };
  B.box('pavement', (-hw - 1.4 + ex) / 2, -0.12, pz, ex + hw + 1.4, 0.18, aw, PAVE);
  B.box('pavement', bx, -0.12, bz + bd / 2 + (pz + aw / 2 - bz - bd / 2) / 2 + 0.02, 18, 0.18, pz + aw / 2 - bz - bd / 2 - 0.04, PAVE);
  for (const sd of [-1, 1]) B.box('concrete', (-hw + ex) / 2, -0.1, pz + sd * (aw / 2 + 0.06), ex + hw, 0.2, 0.12, { color: [0.72, 0.72, 0.7] }); // edging
  // covered way (渡り廊下) from just inside the gate to the forecourt: steel posts on the building side carrying a
  // cantilevered polycarbonate roof with a gutter, so the approach is sheltered all the way in
  { const x0 = -hw + 4, x1 = ex + 1, pzr = pz - aw / 2 - 0.25, RH = 2.7, G = { color: [0.55, 0.6, 0.64] };
    const np = Math.max(2, Math.round((x1 - x0) / 3.6));
    for (let k = 0; k <= np; k++) { const xx = lerp(x0, x1, k / np); B.box('steel', xx, 0, pzr, 0.12, RH + 0.1, 0.12, G); B.beam('steel', [xx, RH, pzr], [xx, RH - 0.15, pz + aw / 2 + 0.3], 0.1, 0.14, G);
      extras.push({ t: 'box', p: B.P([xx, 0, pzr]), hx: 0.08, hz: 0.08, r }); }
    B.box('steel', (x0 + x1) / 2, RH - 0.05, pzr, x1 - x0 + 0.1, 0.16, 0.12, G);
    B.quad('poly', [x0 - 0.1, RH + 0.12, pzr], [x1 + 0.1, RH + 0.12, pzr], [x1 + 0.1, RH - 0.02, pz + aw / 2 + 0.35], [x0 - 0.1, RH - 0.02, pz + aw / 2 + 0.35], { color: [0.85, 0.92, 0.95] });
    B.box('steel', (x0 + x1) / 2, RH - 0.12, pz + aw / 2 + 0.36, x1 - x0 + 0.2, 0.12, 0.1, G); }
  // school name monument (校名碑): a rough standing stone on a low plinth at the corner where the way reaches the forecourt
  { const mx = ex + 3.8, mz = pz - aw / 2 - 1.9;
    B.bbox('concrete', mx, -0.1, mz, 2.2, 0.3, 1.1, 0.03, { color: [0.7, 0.69, 0.66] });
    B.bbox('stone', mx, 0.2, mz, 1.6, 1.25, 0.5, 0.12, { color: [0.52, 0.52, 0.5], uv: 1 });
    const pl = signMesh(1.2, 0.8, (g, W, Hh) => { g.fillStyle = '#44423e'; g.fillRect(0, 0, W, Hh); g.fillStyle = '#e8e2d2'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `bold ${Hh * 0.3}px ${JP_FONT}`; g.fillText('桜川小学校', W / 2, Hh * 0.42); g.font = `${Hh * 0.11}px ${JP_FONT}`; g.fillText('創立百周年記念', W / 2, Hh * 0.78); }, 0.1, 256);
    const pp2 = B.P([mx, 0.85, mz + 0.26]); pl.position.set(...pp2); pl.rotation.y = r; scene.add(pl);
    for (let k = 0; k < 6; k++) plantAt(B, k % 2 ? 'flowerP' : 'flowerY', mx - 1.0 + k * 0.4, 0.2, mz + 0.75, rng, 0.9);
    extras.push({ t: 'box', p: B.P([mx, 0, mz]), hx: 1.1, hz: 0.55, r, h: 1.5 }); }
  { const nb = inFrame(B, [-hw - 0.9, 0, pz - gap - 1.3], -Math.PI / 2, () => { // notice board by the gate, facing the road
      for (const sx of [-0.8, 0.8]) B.box('metal', sx, 0, 0, 0.07, 1.9, 0.07, { color: [0.3, 0.42, 0.36] });
      B.bbox('metal', 0, 0.95, 0, 1.8, 0.95, 0.12, 0.01, { color: [0.3, 0.42, 0.36] }); B.box('plain', 0, 1.02, 0.065, 1.66, 0.8, 0.01, { color: [0.92, 0.9, 0.84] });
      B.box('metal', 0, 1.9, 0.02, 1.95, 0.05, 0.3, { color: [0.3, 0.42, 0.36] }); return B.P([0, 0, 0]); });
    extras.push({ t: 'box', p: nb, hx: 0.9, hz: 0.1, r: r - Math.PI / 2 }); }
  // cherry trees along the fence, bicycle shelter by the gate
  for (let k = 0; k < 14; k++) {
    const t = (k + 0.5) / 14, lx = lerp(-hw + 3, hw - 3, t);
    if (Math.abs(lx) < 7) continue;
    B.F = F; const p = B.P([lx, 0, hd - 2.4]); sakura.push({ x: p[0], z: p[2], front: true });
  }
  for (const sx of [-1, 1]) for (let k = 0; k < 4; k++) { const lz = -hd + 8 + k * (BD - 16) / 3; if (sx < 0 && Math.abs(lz - pz) < 5) continue; B.F = F; const p = B.P([sx * (hw - 2.4), 0, lz]); sakura.push({ x: p[0], z: p[2] }); }
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
export function pedestrians(paths, groundAt, count, seed = 21, { blocked = null, crowd = null } = {}) {
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
    walkers.push({ P, s: u, dir: rng() < 0.5 ? 1 : -1, side: rng() < 0.5 ? 1 : -1, speed, scale, pause: 0, x: 0, z: 0, model: rng() < 0.5 ? 0 : 1, colour: { shirt, pants, hair }, phase: rng() });
  }
  // rigged characters with baked animation (crowd.js) when they loaded; the box figures otherwise
  const C = crowd ? crowdMeshes(crowd, walkers, walkers.map(w => w.colour)) : null;
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
  if (!C) scene.add(im);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), sc = new THREE.Vector3();
  const at = (P, s) => { // point + direction along a polyline
    s = clamp(s, 0, P.L);
    for (let i = 0; i < P.seg.length; i++) {
      if (s <= P.seg[i] || i === P.seg.length - 1) { const a = P.pts[i], b = P.pts[i + 1], t = P.seg[i] ? s / P.seg[i] : 0, dx = (b[0] - a[0]) / (P.seg[i] || 1), dz = (b[1] - a[1]) / (P.seg[i] || 1); return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), dx, dz]; }
      s -= P.seg[i];
    }
  };
  const walkAttr = geo.attributes.iWalk, rate0 = Float32Array.from(ps.filter((_, k) => k % 2 === 1)), phase0 = Float32Array.from(ps.filter((_, k) => k % 2 === 0));
  const update = (dt) => {
    let animChanged = false;
    for (let i = 0; i < walkers.length; i++) {
      const w = walkers[i];
      // walkers stop short of anything blocked ahead (a level crossing whose bells are ringing), stand still, and go on
      // once it clears; someone already on the crossing keeps walking off it
      let ns = w.s + w.dir * w.speed * dt;
      if (ns < 0 || ns > w.P.L) { w.dir *= -1; ns = clamp(ns, 0, w.P.L); }
      let wait = false;
      if (blocked && dt > 0) { const [nx0, nz0, ndx, ndz] = at(w.P, ns + w.dir * 0.8), oo = w.P.off * w.side; wait = blocked(w.x, w.z, nx0 - ndz * oo, nz0 + ndx * oo); }
      if (!wait) w.s = ns;
      if (wait !== !!w.waiting) { w.waiting = wait; ps[i * 2 + 1] = wait ? 0 : rate0[i]; ps[i * 2] = wait ? 0 : phase0[i]; animChanged = true; }
      const [x, z, dx, dz] = at(w.P, w.s), o = w.P.off * w.side;
      w.x = x - dz * o; w.z = z + dx * o;
      const y = groundAt(w.x, w.z) + (w.P.lift ? w.P.lift(w.x, w.z) : 0);
      q.setFromAxisAngle(up, Math.atan2(dx * w.dir, dz * w.dir));
      m4.compose(v.set(w.x, y, w.z), q, sc.setScalar(w.scale));
      if (C) C.set(i, m4, w.phase, w.speed / (1.4 * w.scale), w.waiting ? 1 : 0); // one gait cycle (two steps) ≈ 1.4 m
      else im.setMatrixAt(i, m4);
    }
    if (C) C.commit(); else { im.instanceMatrix.needsUpdate = true; if (animChanged) walkAttr.needsUpdate = true; }
  };
  return { mesh: C ? C.meshes[0] : im, walkers, update, collide(p) { for (const w of walkers) { const dx = p.x - w.x, dz = p.z - w.z, d = Math.hypot(dx, dz); if (d < 0.6 && d > 1e-4) { p.x = w.x + dx / d * 0.6; p.z = w.z + dz / d * 0.6; } } } };
}

// municipal tennis courts (市民テニスコート): two sand-filled artificial-grass courts inside a 4 m chain-link cage, nets on
// winding posts, floodlights, a judge's chair, benches, a storage shed, worn baselines, and a gate onto the road side
export function tennisCourts(B, x, y, z, r, rng, extras, lampPts) {
  // y is the highest ground under the courts: everything stands on a raised concrete slab, so the terrain never breaks
  // through, and the surfacing is laid as non-overlapping pieces (surround strips + one panel per court) with the worn
  // patches and the lines each a few millimetres higher — no two coplanar layers to fight
  B.frame(x, y, z, r);
  const W = 36, D = 38, SL = 0.13, TOP = 0.15, g = [0.36, 0.56, 0.4], gi = [0.3, 0.5, 0.42], white = [0.96, 0.96, 0.94];
  const hw = W / 2 + 0.3, hd2 = D / 2 + 0.3, gx0 = -1.2, gx1 = 1.2, KC = [0.74, 0.74, 0.72];
  B.bbox('concrete', 0, -0.45, 0, W + 1.6, SL + 0.45, D + 1.6, 0.03, { color: [0.72, 0.72, 0.7], skip: 'ny', uv: 2 });
  const pad = (x0, x1, z0, z1, col, top = TOP) => B.box('plain', (x0 + x1) / 2, SL, (z0 + z1) / 2, x1 - x0, top - SL, z1 - z0, { color: col, skip: 'ny', uv: 2 });
  const CW = 10.97 + 2, CD = 23.77 + 4, cxs = [-8.6, 8.6];
  pad(-W / 2, W / 2, -D / 2, -CD / 2, g); pad(-W / 2, W / 2, CD / 2, D / 2, g);
  pad(-W / 2, cxs[0] - CW / 2, -CD / 2, CD / 2, g); pad(cxs[0] + CW / 2, cxs[1] - CW / 2, -CD / 2, CD / 2, g); pad(cxs[1] + CW / 2, W / 2, -CD / 2, CD / 2, g);
  const ly = TOP + 0.008, line = (x0, z0, x1, z1, wd = 0.05) => { const L = Math.hypot(x1 - x0, z1 - z0), nx = -(z1 - z0) / L * wd / 2, nz = (x1 - x0) / L * wd / 2;
    B.quad('paint', [x0 - nx, ly, z0 - nz], [x0 + nx, ly, z0 + nz], [x1 + nx, ly, z1 + nz], [x1 - nx, ly, z1 - nz], { color: white }); };
  for (const cx of cxs) {
    pad(cx - CW / 2, cx + CW / 2, -CD / 2, CD / 2, gi);
    const hl = 23.77 / 2, hd = 10.97 / 2, hs = 8.23 / 2, sl = 6.4;
    for (const s2 of [-1, 1]) { line(cx - hd, s2 * hl, cx + hd, s2 * hl, 0.08); line(cx + s2 * hd, -hl, cx + s2 * hd, hl); line(cx + s2 * hs, -hl, cx + s2 * hs, hl); line(cx - hs, s2 * sl, cx + hs, s2 * sl);
      line(cx, s2 * hl, cx, s2 * (hl - 0.12)); }
    line(cx, -sl, cx, sl);
    for (const s2 of [-1, 1]) { B.cyl('steel', cx + s2 * 6.4, TOP, 0, 0.04, 0.04, 1.07, 10, { color: [0.3, 0.42, 0.34], cap: true }); B.box('steel', cx + s2 * 6.4, TOP + 0.5, 0.06, 0.06, 0.12, 0.08, { color: [0.3, 0.3, 0.3] }); }
    B.quad('chain', [cx - 6.4, TOP + 0.02, 0], [cx + 6.4, TOP + 0.02, 0], [cx + 6.4, TOP + 0.9, 0], [cx - 6.4, TOP + 0.9, 0], { uv: 0.08, color: [0.12, 0.12, 0.12] });
    B.quad('chain', [cx + 6.4, TOP + 0.02, 0], [cx - 6.4, TOP + 0.02, 0], [cx - 6.4, TOP + 0.9, 0], [cx + 6.4, TOP + 0.9, 0], { uv: 0.08, color: [0.12, 0.12, 0.12] });
    B.bbox('plain', cx, TOP + 0.89, 0, 12.8, 0.07, 0.03, 0.005, { color: white });
    B.box('plain', cx, TOP + 0.01, 0, 0.05, 0.88, 0.02, { color: white }); // centre strap
    extras.push({ t: 'box', p: B.P([cx, 0, 0]), hx: 6.4, hz: 0.05, r, h: TOP + 0.95 });
    // umpire's chair
    B.frame(...B.P([cx + 7.4, TOP, 0]), r); B.beam('steel', [-0.3, 0, -0.3], [-0.2, 1.4, -0.2], 0.04, 0.04, { color: [0.3, 0.42, 0.34] }); B.beam('steel', [0.3, 0, -0.3], [0.2, 1.4, -0.2], 0.04, 0.04, { color: [0.3, 0.42, 0.34] });
    B.beam('steel', [-0.3, 0, 0.3], [-0.2, 1.4, 0.2], 0.04, 0.04, { color: [0.3, 0.42, 0.34] }); B.beam('steel', [0.3, 0, 0.3], [0.2, 1.4, 0.2], 0.04, 0.04, { color: [0.3, 0.42, 0.34] });
    B.bbox('plain', 0, 1.4, 0, 0.55, 0.06, 0.55, 0.01, { color: [0.3, 0.42, 0.34] }); B.frame(x, y, z, r);
  }
  // fence: 4 m chain link on galvanised posts with a top rail, standing on a low concrete upstand round the slab
  const fh = 4, FB = SL + 0.18;
  const run = (ax, az, bx, bz) => { const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 3));
    B.bbox('concrete', (ax + bx) / 2, SL - 0.02, (az + bz) / 2, Math.abs(bx - ax) + 0.24, 0.2, Math.abs(bz - az) + 0.24, 0.02, { color: KC });
    for (let i = 0; i <= n; i++) { const t = i / n; B.cyl('steel', ax + (bx - ax) * t, FB, az + (bz - az) * t, 0.045, 0.045, fh - FB, 8, { color: [0.62, 0.66, 0.64], cap: true }); }
    B.quad('chain', [ax, FB, az], [bx, FB, bz], [bx, fh, bz], [ax, fh, az], { uv: 0.16, color: [0.4, 0.56, 0.46] });            // 45 mm tennis mesh
    // green windbreak screen (防風ネット) tied to the inside of the long sides up to 1.8 m
    if (Math.abs(bz - az) > 10) { const o = Math.sign(ax) * -0.06; B.poly('screen', [[ax + o, FB + 0.05, az], [bx + o, FB + 0.05, bz], [bx + o, 1.85, bz], [ax + o, 1.85, az]], [-Math.sign(ax), 0, 0], { uv: 1 }); }
    B.beam('steel', [ax, 2.4, az], [bx, 2.4, bz], 0.03, 0.03, { color: [0.62, 0.66, 0.64] });
    B.beam('steel', [ax, fh, az], [bx, fh, bz], 0.05, 0.05, { color: [0.62, 0.66, 0.64] }); B.beam('steel', [ax, 1.2, az], [bx, 1.2, bz], 0.035, 0.035, { color: [0.62, 0.66, 0.64] });
    extras.push({ t: 'box', p: B.P([(ax + bx) / 2, 0, (az + bz) / 2]), hx: Math.abs(bx - ax) / 2 + 0.05, hz: Math.abs(bz - az) / 2 + 0.05, r, h: fh }); };
  run(-hw, -hd2, hw, -hd2); run(-hw, -hd2, -hw, hd2); run(hw, -hd2, hw, hd2); run(-hw, hd2, gx0, hd2); run(gx1, hd2, hw, hd2);
  // gate: gate posts, a mesh leaf shut on the left and one swung open inward on the right, a drop bolt and a latch
  const GC = [0.62, 0.66, 0.64];
  for (const gx of [gx0, gx1]) B.cyl('steel', gx, SL, hd2, 0.06, 0.06, 2.3, 10, { color: GC, cap: true });
  const leaf = (x0, z0, x1, z1) => { // frame tube + chain infill + mid rail, from (x0,z0) to (x1,z1) at the gate line
    for (const yy of [SL + 0.08, SL + 1.0, SL + 2.05]) B.beam('steel', [x0, yy, z0], [x1, yy, z1], 0.04, 0.04, { color: GC });
    for (const [px, pz] of [[x0, z0], [x1, z1]]) B.beam('steel', [px, SL + 0.08, pz], [px, SL + 2.05, pz], 0.04, 0.04, { color: GC });
    B.quad('chain', [x0, SL + 0.1, z0], [x1, SL + 0.1, z1], [x1, SL + 2.03, z1], [x0, SL + 2.03, z0], { uv: 0.16, color: [0.4, 0.56, 0.46] }); };
  leaf(gx0 + 0.08, hd2, -0.02, hd2);
  leaf(gx1 - 0.08, hd2 - 0.06, gx1 - 0.08, hd2 - 1.2);                                                                  // open, swung in
  B.box('steel', -0.08, SL + 1.0, hd2 + 0.03, 0.08, 0.1, 0.05, { color: [0.3, 0.3, 0.3] });                               // latch
  B.beam('steel', [gx1 - 0.14, SL, hd2 - 1.0], [gx1 - 0.14, SL + 0.5, hd2 - 1.0], 0.02, 0.02, { color: [0.3, 0.3, 0.3] }); // drop bolt
  extras.push({ t: 'box', p: B.P([gx0 / 2, 0, hd2]), hx: Math.abs(gx0) / 2, hz: 0.06, r, h: 2.3 });
  // outside the gate: a concrete apron ramping down from the slab to the path
  { const za = D / 2 + 0.8, zb = za + 1.8;
    B.quad('concrete', [-1.7, SL, za], [-1.7, -0.02, zb], [1.7, -0.02, zb], [1.7, SL, za], { color: [0.76, 0.76, 0.74], uv: 1.5 });
    for (const sx of [-1.7, 1.7]) B.poly('concrete', [[sx, -0.3, za], [sx, -0.3, zb], [sx, -0.02, zb], [sx, SL, za]], [Math.sign(sx), 0, 0], { color: [0.7, 0.7, 0.68] }); }
  // floodlights on the long sides, benches, a store shed and a sign by the gate
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const px = sx * (hw + 0.6), pz = sz * 10;
    B.bbox('concrete', px, -0.3, pz, 0.6, 0.45, 0.6, 0.02, { color: KC });
    B.cyl('steel', px, 0.15, pz, 0.12, 0.08, 9.85, 10, { color: [0.64, 0.66, 0.68] });
    B.bbox('steel', px - sx * 0.3, 10, pz, 0.9, 0.08, 0.9, 0.01, { color: [0.5, 0.5, 0.52] });
    for (const k of [-0.25, 0.25]) { B.bbox('plastic', px - sx * 0.45, 9.55, pz + k, 0.45, 0.4, 0.35, 0.02, { color: [0.3, 0.32, 0.34] }); B.bbox('lamp', px - sx * 0.68, 9.6, pz + k, 0.02, 0.3, 0.26, 0.01); }
    if (lampPts) lampPts.push({ p: B.P([px - sx * 0.8, 9.5, pz]), s: 1.4 });
  }
  for (const sx of [-1, 1]) { B.bbox('wood', sx * (hw - 1.2), TOP + 0.42, 0, 0.45, 0.06, 2.2, 0.01, { color: [0.62, 0.46, 0.3] }); for (const zz of [-0.9, 0.9]) B.box('steel', sx * (hw - 1.2), TOP, zz, 0.4, 0.42, 0.05, { color: [0.4, 0.4, 0.42] }); }
  B.bbox('concrete', hw + 2.2, -0.3, -hd2 + 1.6, 2.6, 0.42, 1.8, 0.02, { color: KC });
  B.bbox('metal', hw + 2.2, 0.12, -hd2 + 1.6, 2.4, 2.0, 1.6, 0.02, { color: [0.62, 0.7, 0.62] }); B.bbox('metal', hw + 2.2, 2.12, -hd2 + 1.6, 2.6, 0.06, 1.8, 0.01, { color: [0.5, 0.56, 0.5] });
  B.detail(1, () => { for (const dz of [-0.38, 0.38]) B.box('dark', hw + 2.2 - 1.201, 0.2, -hd2 + 1.6 + dz, 0.01, 1.8, 0.012, { color: [0.3, 0.3, 0.3] }); });
  extras.push({ t: 'box', p: B.P([hw + 2.2, 0, -hd2 + 1.6]), hx: 1.2, hz: 0.8, r });
  const sign = signMesh(1.6, 0.5, (g2, w2, h2) => { g2.fillStyle = '#f4f4ee'; g2.fillRect(0, 0, w2, h2); g2.fillStyle = '#1d4d3a'; g2.font = `bold ${h2 * 0.42}px ${JP_FONT}`; g2.textAlign = 'center'; g2.textBaseline = 'middle'; g2.fillText('桜川市民テニスコート', w2 / 2, h2 / 2); }, 0.2);
  sign.position.set(...B.P([3.2, 2.2, hd2 + 0.08])); sign.rotation.y = r; scene.add(sign);
  { const p0 = B.P([0, 0, 0]); addPlatform(p0[0], p0[2], W / 2 + 0.8, D / 2 + 0.8, r, y + TOP); }
  B.frame(0, 0, 0, 0);
  return { top: TOP, slab: SL };
}
