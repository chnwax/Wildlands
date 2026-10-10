// Hand-placed landmarks for the Wildlands, built in the painted style: a wooden dock you can walk out on, a vermilion
// torii with a little shrine and stone lanterns, a Ghibli cottage with a fenced flower garden, and benches.
// Everything is batched through the town GeoBuilder into a handful of meshes; lanterns and windows glow at night.
import { THREE, phTex, addBox, addCircle, addPlatform, mulberry32 } from './core.js';
import { GeoBuilder } from './townkit.js';
import { wildShrine } from './shrine.js';
import { inFrame, wallFill, reveals, windowUnit, doorUnit, gableRoof } from './building.js';
import { env } from './sky.js';
import { placeable, atXYZR, atObj, atLocal } from './world/capture.js';

let M = null;
function materials() {
  if (M) return M;
  const std = o => new THREE.MeshStandardMaterial(Object.assign({ vertexColors: true, roughness: 0.9, metalness: 0 }, o));
  const planks = phTex('japanese_cedar_planks', 'diff', '1k', true);
  M = {
    wood: std({ map: planks, color: 0xd9b48c }),
    woodDark: std({ color: 0x6e4c38 }),
    red: std({ color: 0xe0452f, roughness: 0.6 }),
    black: std({ color: 0x2c2a2e, roughness: 0.7 }),
    stone: std({ color: 0xc4bfb6 }),
    plaster: std({ color: 0xf6f1e6 }),
    roof: std({ roughness: 0.7 }),
    glow: std({ color: 0xfff1d0, emissive: 0xffc774, emissiveIntensity: 0 }),
    window: std({ color: 0x4a6fa5, roughness: 0.2, emissive: 0xffb866, emissiveIntensity: 0 }),
    paint: std({ roughness: 0.8 }),
    // white-based sets for the shared building / shrine kits (colour comes per vertex)
    plain: std({ roughness: 0.85 }), alu: std({ roughness: 0.35, metalness: 0.8 }), lacq: std({ roughness: 0.42 }),
    stoneW: std({ roughness: 0.92 }), woodW: std({ map: planks }), roofW: std({ roughness: 0.6, metalness: 0.3 }),
    steelW: std({ roughness: 0.3, metalness: 1 }), waterW: std({ roughness: 0.05, metalness: 0.4 }),
  };
  // the town kit's material names, mapped onto this set
  Object.assign(M, { steel: M.steelW, metal: M.steelW, concrete: M.stoneW, plastic: M.lacq, glass: M.waterW, tiles: M.stoneW, dark: M.black, lamp: M.glow, roofMetal: M.roofW, wood2: M.woodW });
  return M;
}
const J = (rng, c, a = 0.06) => c.map(v => Math.max(0, Math.min(1, v * (1 + (rng() - 0.5) * a))));

// wooden dock from (x,z) along direction r (local +Z), deck at `top`; walkable
function dock_build(B, x, z, r, L, groundAt, top = 0.85) {
  const rng = mulberry32(5), W = 2.4;
  B.frame(x, 0, z, r);
  for (let s = 0; s < L; s += 0.31) B.bbox('wood', 0, top - 0.07, s + 0.15, W - (rng() < 0.2 ? 0.1 : 0), 0.07, 0.28, 0.012, { color: J(rng, [1, 1, 1], 0.14), uv: 2 });
  for (const sx of [-1.05, 1.05]) B.bbox('woodDark', sx, top - 0.3, L / 2, 0.14, 0.23, L, 0.02);
  for (const sx of [-1.2, 1.2]) B.bbox('woodDark', sx, top - 0.12, L / 2, 0.08, 0.12, L, 0.015); // fascia boards
  for (let s = 0.2; s <= L; s += 2.5) for (const sx of [-1.18, 1.18]) {
    const p = B.P([sx, 0, s]), gy = Math.min(groundAt(p[0], p[2]), top - 0.4);
    B.cyl('woodDark', sx, gy - 0.4, s, 0.11, 0.1, top + 0.3 - gy + 0.4, 8);
  }
  // bollards and a lantern post at the far end
  for (const sx of [-1.05, 1.05]) B.cyl('woodDark', sx, top, L - 0.2, 0.12, 0.12, 0.45, 8, { cap: true });
  B.cyl('woodDark', 0.95, top, L - 1.2, 0.07, 0.07, 1.9, 6);
  B.box('black', 0.95, top + 1.9, L - 1.2, 0.34, 0.06, 0.34);
  B.box('glow', 0.95, top + 1.55, L - 1.2, 0.26, 0.34, 0.26);
  B.box('black', 0.95, top + 1.5, L - 1.2, 0.3, 0.05, 0.3);
  const c = B.P([0, 0, L / 2]);
  addPlatform(c[0], c[2], W / 2, L / 2, r, top);
}

function gable(B, mat, w, d, y, rise, over, color) {
  const x0 = -w / 2 - over, x1 = w / 2 + over, z0 = -d / 2 - over, z1 = d / 2 + over, o = { color, uv: 1.6 };
  B.quad(mat, [x0, y, z1], [x1, y, z1], [x1, y + rise, 0], [x0, y + rise, 0], o);
  B.quad(mat, [x1, y, z0], [x0, y, z0], [x0, y + rise, 0], [x1, y + rise, 0], o);
  B.quad('woodDark', [x1, y, z1], [x0, y, z1], [x0, y + rise, 0], [x1, y + rise, 0]);     // soffits
  B.quad('woodDark', [x0, y, z0], [x1, y, z0], [x1, y + rise, 0], [x0, y + rise, 0]);
  B.box(mat, 0, y + rise - 0.03, 0, x1 - x0, 0.12, 0.3, { color: color.map(v => v * 0.8) });
}

// stone lantern (toro)
function lantern_build(B, x, y, z, r = 0) {
  B.frame(x, y, z, r);
  B.box('stone', 0, 0, 0, 0.62, 0.18, 0.62);
  B.cyl('stone', 0, 0.18, 0, 0.13, 0.11, 0.85, 8);
  B.box('stone', 0, 1.03, 0, 0.56, 0.12, 0.56);
  B.box('glow', 0, 1.15, 0, 0.36, 0.34, 0.36);
  for (const [px, pz] of [[-0.19, -0.19], [0.19, -0.19], [0.19, 0.19], [-0.19, 0.19]]) B.box('stone', px, 1.15, pz, 0.07, 0.34, 0.07);
  const h = 1.49, e = 0.42;
  B.box('stone', 0, h, 0, 0.8, 0.07, 0.8);
  for (const [a, b] of [[[-e, h + 0.07, e], [e, h + 0.07, e]], [[e, h + 0.07, e], [e, h + 0.07, -e]], [[e, h + 0.07, -e], [-e, h + 0.07, -e]], [[-e, h + 0.07, -e], [-e, h + 0.07, e]]])
    B.tri('stone', a, b, [0, h + 0.36, 0]);
  B.cyl('stone', 0, h + 0.33, 0, 0.06, 0.02, 0.14, 6);
  const p = B.P([0, 0, 0]); addCircle(p[0], p[2], 0.32);
}

// vermilion torii with a roped hokora behind it (shrine.js kit); local +Z faces the approach
export const KIT_M = { lac: 'lacq', dark: 'lacq', wood: 'woodW', stone: 'stoneW', roof: 'roofW', glow: 'glow', paper: 'plain', rope: 'plain', metal: 'steelW', water: 'waterW' };
function shrine_build(B, x, y, z, r) {
  const S = wildShrine(B, KIT_M, x, y, z, r);
  for (const p of S.cols) addCircle(p[0], p[2], 0.28);
  addBox(S.hall[0], S.hall[2], 1.6, 1.5, r, y - 1, y + 3);
}
// Ghibli cottage: white plaster between dark timbers, red tiled roof, chimney, flower boxes, fenced garden (+Z front)
function cottage_build(B, x, y, z, r, garden = true) {
  const W = 6.4, D = 5.2, H = 2.9, rng = mulberry32(9);
  B.frame(x, y, z, r);
  B.bbox('stone', 0, -0.4, 0, W + 0.3, 0.62, D + 0.3, 0.04);
  // plaster walls with real openings between the timbers: recessed casements, a planked door in its frame
  const faces = [[0, D / 2, W], [Math.PI, D / 2, W], [Math.PI / 2, W / 2, D], [-Math.PI / 2, W / 2, D]];
  const holes = [[{ x0: 0.7, x1: 1.7, y0: 1.0, y1: 2.0, d: 0.16 }, { x0: -1.8, x1: -0.8, y0: 0.22, y1: 2.27, d: 0.16, door: true }],
    [{ x0: 0.9, x1: 1.9, y0: 1.0, y1: 2.0, d: 0.16 }, { x0: -1.9, x1: -0.9, y0: 1.0, y1: 2.0, d: 0.16 }],
    [{ x0: -1.3, x1: -0.3, y0: 1.0, y1: 2.0, d: 0.16 }], [{ x0: 0.3, x1: 1.3, y0: 1.0, y1: 2.0, d: 0.16 }]];
  const flowers = [[1, 0.35, 0.5], [1, 0.8, 0.2], [0.95, 0.95, 0.9], [0.6, 0.45, 1], [1, 0.5, 0.75]];
  faces.forEach(([fr, off, fw], fi) => inFrame(B, [Math.sin(fr) * off, 0, Math.cos(fr) * off], fr, () => {
    const hs = holes[fi];
    wallFill(B, 'plaster', -fw / 2, fw / 2, 0.2, H + 0.2, hs, [1, 1, 1], 3);
    for (const h of hs) {
      reveals(B, 'plaster', h, [0.95, 0.94, 0.9]);
      if (h.door) { doorUnit(B, h, { color: [0.62, 0.4, 0.28], mat: 'woodW', frame: [0.3, 0.22, 0.16], trim: [0.3, 0.22, 0.16], slit: true, panel: true }); B.bbox('stone', (h.x0 + h.x1) / 2, -0.12, 0.45, 1.4, 0.32, 0.8, 0.04); continue; }
      windowUnit(B, h, { rng, frame: [0.32, 0.24, 0.18], frameMat: 'woodW', type: 'grid', sillMat: 'woodW', sillColor: [0.36, 0.26, 0.2] });
      const cx = (h.x0 + h.x1) / 2;
      for (const sd of [-1, 1]) { B.bbox('woodW', cx + sd * 0.8, 0.98, 0.07, 0.52, 1.04, 0.05, 0.01, { color: [0.45, 0.62, 0.55] }); for (let k = 0; k < 5; k++) B.box('woodW', cx + sd * 0.8, 1.08 + k * 0.2, 0.1, 0.46, 0.03, 0.01, { color: [0.36, 0.5, 0.44] }); }
      B.bbox('woodW', cx, 0.62, 0.2, 1.1, 0.22, 0.3, 0.02, { color: [0.4, 0.28, 0.2] });
      for (let k = 0; k < 7; k++) B.bbox('paint', cx - 0.45 + k * 0.15, 0.82, 0.2 + (rng() - 0.5) * 0.12, 0.13, 0.13, 0.13, 0.04, { color: flowers[Math.floor(rng() * flowers.length)] });
    }
    B.bbox('woodDark', 0, 1.55, 0.02, fw + 0.06, 0.16, 0.06, 0.01); B.bbox('woodDark', 0, H + 0.08, 0.02, fw + 0.06, 0.18, 0.06, 0.01);
  }));
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.bbox('woodDark', sx * W / 2, 0.2, sz * D / 2, 0.22, H, 0.22, 0.02);
  // tiled gable roof along X with thickness, gutters and a downpipe; plaster gables with a timber cross
  const R = gableRoof(B, { w: W, d: D, y: H + 0.2, pitch: 0.63, over: 0.55, rake: 0.4, mat: 'roofW', color: [0.86, 0.3, 0.2], wallMat: 'plaster', wallColor: [1, 1, 1], gutterColor: [0.45, 0.32, 0.24] });
  for (const sx of [-1, 1]) {
    B.beam('woodDark', [sx * (W / 2 + 0.02), H + 0.25, -D / 2 + 0.3], [sx * (W / 2 + 0.02), R.yR - 0.3, 0], 0.08, 0.1);
    B.beam('woodDark', [sx * (W / 2 + 0.02), H + 0.25, D / 2 - 0.3], [sx * (W / 2 + 0.02), R.yR - 0.3, 0], 0.08, 0.1);
  }
  B.bbox('stone', 1.6, H + 0.6, -0.9, 0.7, R.yR - H + 0.3, 0.7, 0.04);          // chimney
  B.bbox('black', 1.6, R.yR + 0.9, -0.9, 0.84, 0.1, 0.84, 0.02);
  addBox(x, z, W / 2 + 0.2, D / 2 + 0.2, r, y - 1, y + 6);
  if (!garden) return;
  // picket fence around the front garden, with a gap for the path
  const gw = 11, gd = 7, gz0 = D / 2 + 0.8;
  const post = (px, pz) => { B.box('wood', px, 0, pz, 0.12, 1.0, 0.12, { color: [1, 0.97, 0.9] }); };
  const run = (ax, az, bx, bz, gap) => {
    const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 1.6));
    for (let k = 0; k <= n; k++) { const t = k / n, px = ax + (bx - ax) * t, pz = az + (bz - az) * t; if (gap && Math.abs(px - gap) < 0.9) continue; post(px, pz); }
    for (const hy of [0.35, 0.75]) {
      if (gap !== undefined) { B.beam('wood', [ax, hy, az], [gap - 0.9, hy, bz], 0.05, 0.08, { color: [1, 0.97, 0.9] }); B.beam('wood', [gap + 0.9, hy, az], [bx, hy, bz], 0.05, 0.08, { color: [1, 0.97, 0.9] }); }
      else B.beam('wood', [ax, hy, az], [bx, hy, bz], 0.05, 0.08, { color: [1, 0.97, 0.9] });
    }
  };
  run(-gw / 2, gz0 + gd, gw / 2, gz0 + gd, -1.3);
  run(-gw / 2, gz0 - 0.4, -gw / 2, gz0 + gd); run(gw / 2, gz0 - 0.4, gw / 2, gz0 + gd);
}

// a simple wooden bench (local +Z: the side you sit facing)
function bench_build(B, x, y, z, r) {
  B.frame(x, y, z, r);
  for (const sx of [-0.7, 0.7]) { B.bbox('woodDark', sx, 0, 0, 0.08, 0.45, 0.42, 0.012); B.bbox('woodDark', sx, 0.45, -0.22, 0.08, 0.45, 0.06, 0.012); B.bbox('woodDark', sx, 0.3, 0, 0.1, 0.05, 0.46, 0.01); }
  for (let k = 0; k < 3; k++) B.bbox('wood', 0, 0.45, -0.15 + k * 0.14, 1.7, 0.05, 0.12, 0.012);
  for (let k = 0; k < 2; k++) B.bbox('wood', 0, 0.62 + k * 0.16, -0.24, 1.7, 0.1, 0.04, 0.01);
  const p = B.P([0, 0, 0]); addBox(p[0], p[2], 0.85, 0.25, r, y - 1, y + 0.5);
}

// abandoned stone hut: broken dry-stone walls of uneven height, a doorway, fallen roof timbers and tumbled stones,
// moss on the wall tops. groundAt keeps every course sitting on the slope.
function ruin_build(B, x, z, r, groundAt, seed = 1) {
  const rng = mulberry32(seed), W = 6 + rng() * 2, D = 4.5 + rng() * 1.5, y0 = groundAt(x, z);
  B.frame(x, y0, z, r);
  const course = (ax, az, bx, bz, hMax, door) => {
    const L = Math.hypot(bx - ax, bz - az), n = Math.ceil(L / 0.62), ux = (bx - ax) / L, uz = (bz - az) / L;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n * L; if (door && Math.abs(t - L / 2) < 0.6) continue;
      const cx = ax + ux * t, cz = az + uz * t, p = B.P([cx, 0, cz]), gy = groundAt(p[0], p[2]) - y0;
      const h = Math.max(0.25, hMax * (0.45 + 0.55 * Math.sin(t * 0.9 + seed) * Math.sin(t * 0.37 + 1)) + (rng() - 0.5) * 0.3);
      for (let y = 0; y < h; y += 0.3) {
        const mossy = y + 0.3 >= h ? 0.35 : 0;
        const c = J(rng, [0.6 - mossy * 0.22, 0.59 - mossy * 0.02, 0.54 - mossy * 0.26], 0.2);
        B.bbox('stone', cx + (rng() - 0.5) * 0.06, gy + y - 0.1, cz + (rng() - 0.5) * 0.06, (Math.abs(ux) > 0.5 ? 0.64 : 0.46) - rng() * 0.05, 0.3, (Math.abs(ux) > 0.5 ? 0.46 : 0.64) - rng() * 0.05, 0.035 + rng() * 0.03, { color: c });
      }
      addBox(p[0], p[2], 0.36, 0.36, r, -1e9, y0 + gy + h);
    }
  };
  course(-W / 2, -D / 2, W / 2, -D / 2, 2.2); course(-W / 2, D / 2, W / 2, D / 2, 1.2, true);
  course(-W / 2, -D / 2, -W / 2, D / 2, 1.8); course(W / 2, -D / 2, W / 2, D / 2, 0.8);
  // fallen roof beams and loose stones
  for (let k = 0; k < 3; k++) { const a = (rng() - 0.5) * 0.9, bx = (rng() - 0.5) * W * 0.5, bz = (rng() - 0.5) * D * 0.5, L = D * (0.8 + rng() * 0.4);
    B.beam('woodDark', [bx - Math.sin(a) * L / 2, 0.15 + rng() * 0.8, bz - Math.cos(a) * L / 2], [bx + Math.sin(a) * L / 2, 0.1, bz + Math.cos(a) * L / 2], 0.2, 0.18, { color: J(rng, [0.8, 0.75, 0.7], 0.2) }); }
  for (let k = 0; k < 14; k++) { const a = rng() * 6.28, d = W * 0.5 + rng() * 2.5, sx = Math.cos(a) * d, sz = Math.sin(a) * d * 0.8, p = B.P([sx, 0, sz]);
    B.bbox('stone', sx, groundAt(p[0], p[2]) - y0 - 0.12, sz, 0.3 + rng() * 0.3, 0.25, 0.3 + rng() * 0.3, 0.06, { color: J(rng, [0.48, 0.54, 0.4], 0.2) }); }
}

// hilltop viewpoint: a small timber deck with a rail on the view side, a bench and a wooden sign post
function viewpoint_build(B, x, z, r, groundAt) {
  const y = groundAt(x, z), top = y + 0.35;
  B.frame(x, 0, z, r);
  for (let s = -1.6; s <= 1.6; s += 0.3) B.bbox('wood', 0, top - 0.06, s, 4.2, 0.06, 0.27, 0.01, { color: [0.95, 0.92, 0.88], uv: 2 });
  for (const sz of [-1.2, 0, 1.2]) B.bbox('woodDark', 0, top - 0.24, sz, 4.1, 0.18, 0.12, 0.015); // joists
  for (const sx of [-2, 2]) for (const sz of [-1.6, 1.6]) { const p = B.P([sx, 0, sz]), gy = groundAt(p[0], p[2]); B.bbox('woodDark', sx, gy - 0.3, sz, 0.14, top - gy + 0.3, 0.14, 0.015); }
  // rail on the view side: posts, a top rail and two mid rails; open sides with low rails
  for (let k = 0; k <= 4; k++) B.bbox('woodDark', -2 + k, top, 1.75, 0.1, 1.0, 0.1, 0.012);
  for (const yy of [0.35, 0.65]) B.bbox('woodDark', 0, top + yy, 1.75, 4.2, 0.07, 0.05, 0.01);
  for (const sx of [-2.05, 2.05]) { for (const zz of [-1.6, 0, 1.6]) B.bbox('woodDark', sx, top, zz, 0.1, 1.0, 0.1, 0.012); B.bbox('woodDark', sx, top + 0.5, 0, 0.05, 0.07, 3.3, 0.01); B.bbox('wood', sx, top + 0.95, 0, 0.14, 0.07, 3.4, 0.012, { color: [0.95, 0.92, 0.88] }); }
  B.bbox('wood', 0, top + 0.95, 1.75, 4.3, 0.08, 0.16, 0.015);
  const p = B.P([0, 0, 0]); addPlatform(p[0], p[2], 2.1, 1.7, r, top);
  const b = B.P([0, 0, -0.5]); bench(B, b[0], top, b[2], r); // facing the rail and the view
  B.frame(x, 0, z, r);
  const sp = B.P([-2.6, 0, -2.2]), sy = groundAt(sp[0], sp[2]);
  B.bbox('woodDark', -2.6, sy - 0.2, -2.2, 0.12, 1.9, 0.12, 0.015);
  B.bbox('wood', -2.6, sy + 1.45, -2.2, 0.9, 0.28, 0.05, 0.012, { color: [0.9, 0.8, 0.62] });
  B.bbox('woodDark', -2.6, sy + 1.72, -2.2, 1.0, 0.05, 0.12, 0.01);
  addCircle(sp[0], sp[2], 0.12);
}

// roadside hokora: a tiny wooden shrine house on a stone plinth, with a red-bibbed stone Jizo beside it
function hokora_build(B, x, y, z, r) {
  B.frame(x, y, z, r);
  B.bbox('stone', 0, -0.1, 0, 0.9, 0.55, 0.8, 0.04, { color: [0.72, 0.72, 0.68] });
  B.bbox('stone', 0, 0.42, 0, 0.72, 0.05, 0.62, 0.015, { color: [0.66, 0.66, 0.62] });
  B.bbox('woodW', 0, 0.47, 0, 0.6, 0.5, 0.48, 0.012, { color: [0.85, 0.7, 0.55] });
  for (const sx of [-0.3, 0.3]) for (const sz of [-0.24, 0.24]) B.bbox('woodDark', sx, 0.45, sz, 0.05, 0.56, 0.05, 0.006);
  B.bbox('black', 0, 0.52, 0.245, 0.34, 0.36, 0.02, 0.005);
  for (let i = -3; i <= 3; i++) B.box('woodDark', i * 0.045, 0.52, 0.258, 0.012, 0.36, 0.006);          // lattice doors
  gableRoof(B, { w: 0.6, d: 0.48, y: 0.99, pitch: 0.55, over: 0.2, rake: 0.14, mat: 'roofW', color: [0.34, 0.32, 0.32], gutters: false, wallMat: 'woodW', wallColor: [0.8, 0.66, 0.52], t: 0.05 });
  shimenawaMini(B, [-0.33, 0.98, 0.3], [0.33, 0.98, 0.3]);
  // stone Jizo with a red bib and cap
  B.bbox('stone', 0.75, -0.05, 0.1, 0.34, 0.12, 0.3, 0.03, { color: [0.64, 0.64, 0.6] });
  B.cyl('stone', 0.75, 0.07, 0.1, 0.14, 0.16, 0.42, 10, { color: [0.7, 0.7, 0.66] });
  B.cyl('stone', 0.75, 0.49, 0.1, 0.1, 0.12, 0.04, 10, { color: [0.7, 0.7, 0.66], cap: true });
  B.cyl('stone', 0.75, 0.52, 0.1, 0.11, 0.1, 0.12, 10, { color: [0.72, 0.72, 0.68] });
  B.cyl('stone', 0.75, 0.64, 0.1, 0.1, 0.02, 0.06, 10, { color: [0.72, 0.72, 0.68], cap: true });
  B.cyl('red', 0.75, 0.3, 0.1, 0.17, 0.12, 0.2, 10, { color: [1, 1, 1] });
  B.cyl('red', 0.75, 0.63, 0.1, 0.115, 0.06, 0.07, 10, { color: [1, 1, 1], cap: true });
  const p = B.P([0.2, 0, 0]); addBox(p[0], p[2], 0.7, 0.45, r, y - 1, y + 1.2);
}

function shimenawaMini(B, a, b) {
  const pts = []; for (let i = 0; i <= 6; i++) { const t = i / 6; pts.push([a[0] + (b[0] - a[0]) * t, a[1] - 0.05 * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t]); }
  B.sweep('plain', [[0.02, 0], [0, 0.02], [-0.02, 0], [0, -0.02]], pts, { closed: true, color: [0.86, 0.76, 0.5] });
  for (const t of [0.33, 0.67]) { const p = pts[Math.round(t * 6)]; for (let j = 0; j < 3; j++) B.box('plain', p[0] + (j % 2 ? 0.02 : -0.02), p[1] - 0.06 - j * 0.045, p[2], 0.04, 0.045, 0.003, { color: [0.97, 0.96, 0.92] }); }
}
// a plank footbridge from (x0,z0) to (x1,z1) at deck height `top` (walkable), with low rails
function footbridge_build(B, x0, z0, x1, z1, top, groundAt) {
  const L = Math.hypot(x1 - x0, z1 - z0), r = Math.atan2(x1 - x0, z1 - z0);
  B.frame(x0, 0, z0, r);
  for (let s = 0.15; s < L; s += 0.3) B.bbox('wood', 0, top - 0.06, s, 1.6, 0.06, 0.27, 0.01, { color: [0.92, 0.88, 0.82], uv: 2 });
  for (const sx of [-0.72, 0.72]) { B.bbox('woodDark', sx, top - 0.26, L / 2, 0.12, 0.2, L, 0.015); B.bbox('woodDark', sx, top + 0.62, L / 2, 0.08, 0.07, L, 0.012); B.bbox('woodDark', sx, top + 0.3, L / 2, 0.05, 0.05, L, 0.01); }
  for (let s = 0; s <= L + 1e-3; s += L / Math.max(2, Math.round(L / 1.6))) for (const sx of [-0.75, 0.75]) { const p = B.P([sx, 0, s]), gy = Math.min(groundAt(p[0], p[2]), top - 0.3); B.bbox('woodDark', sx, gy - 0.3, s, 0.1, top + 0.7 - gy + 0.3, 0.1, 0.012); }
  const c = B.P([0, 0, L / 2]); addPlatform(c[0], c[2], 0.8, L / 2, r, top);
}

export function flushLandmarks(B) {
  const MT = materials();
  B.flush(MT);
  return {
    update() { MT.glow.emissiveIntensity = 0.15 + 2.6 * env.night; MT.window.emissiveIntensity = 1.8 * env.night; },
  };
}
export { GeoBuilder, materials as landmarkMaterials };

// ---------------------------------------------------------------- placed objects (world/capture.js: each call is one editable world object)
export const dock = placeable('dock', dock_build, (B, x, z, r) => [x, 0, z, r]);
export const lantern = placeable('stone_lantern', lantern_build, atXYZR);
export const shrine = placeable('shrine_small', shrine_build, atXYZR);
export const cottage = placeable('cottage', cottage_build, atXYZR);
export const bench = placeable('bench', bench_build, atXYZR);
export const ruin = placeable('ruin', ruin_build, (B, x, z, r, groundAt) => [x, groundAt(x, z), z, r]);
export const viewpoint = placeable('viewpoint', viewpoint_build, (B, x, z, r, groundAt) => [x, groundAt(x, z), z, r]);
export const hokora = placeable('hokora', hokora_build, atXYZR);
export const footbridge = placeable('footbridge', footbridge_build, (B, x0, z0, x1, z1, top) => [(x0 + x1) / 2, top, (z0 + z1) / 2, Math.atan2(x1 - x0, z1 - z0)]);
