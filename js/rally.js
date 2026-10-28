// Shared point-to-point rally stage builder for the car (car.js). Each stage supplies a hand-shaped route,
// exact competitive distance, surface and ecology while reusing timing, pace notes and roadside dressing. A distance
// field over the map (2 m cells: the distance
// to the centre line and the nearest point on it) answers what the ground is under a wheel, where the trees may stand
// and how far round the stage the car has come (the stage clock). The road is graded into the terrain and receives
// either a gravel ribbon with wheel ruts or painted asphalt. Wildlands woods border a readable low verge; chevron boards mark the
// tight corners, straw bales and tape at the hairpins and the chicane, the start and finish arch with its line.
import { THREE, scene, camera, clamp, lerp, smoothstep, mulberry32, tick, phTex, NFLAT, maxAniso, addCircle, addBox, Scatter, withScatterMeta, erosion, fbm, decimate } from './core.js';
import { Heightfield, terrainMaterial, buildTerrainMeshes, buildGrass, setPaint } from './terrain.js';
import { buildTrees, buildBushes, buildLogs } from './trees.js';
import { plantForest, forestFloor } from './ecology.js';
import { audio } from './audio.js';
import { loadPacks, packsReady } from './packs.js';
import { loadPeople, crowdMeshes, CLIP } from './crowd.js';

export const meta = {
  name: 'Pine Forest',
  builder: false,
  startHour: 15.4,
  sunAzimuth: 2.15,
  life: { flowers: false, birds: true, fireflies: 0.3, mist: 0.2 },
  vehicle: true,
};

const ROAD = 1.3, SHOULDER = 1.6, CLEAR = 3.45; // one-car lane with the pack-tree forest closing in just behind the verge

// the forest's ground: a low, rolling moraine country (the road rides its crests and dips), granite breaking out of it
function pineLand(x, z) {
  const e = erosion(x * 0.0029 + 1.4, z * 0.0029 - 3.8, 5), cr = 1 - Math.abs(fbm(x * 0.009 + 6.1, z * 0.009 - 2.7, 4));
  return 24 + z * 0.025 + Math.sin(x * 0.005) * 4.5 + Math.sin(z * 0.007 + 0.8) * 3.5 + Math.sin((x + z) * 0.01) * 2 + 6.5 * e + 5 * smoothstep(0.78, 0.95, cr);
}

export const PINE_STAGE = {
  id: 'pine', name: 'Pine Forest', target: 1500, roadType: 'gravel', seed: 4471,
  bestKey: 'wl_rally_pine_best_v2', forestMin: 0.86, forestSeed: 99, floorSeed: 5, forestNear: 2.6, stony: 0.22, land: pineLand, grade: 30,
  // (a northern wood: dark spruce, needle litter and moss up to the ditches, grey granite, the grass short and dull)
  paint: { gDeep: '#2e452b', gLush: '#47592f', gLight: '#878a51', gDry: '#9f915b', forest: '#3f3b27', canopy: '#25362a', rockL: '#a5a197', rockD: '#5a5753' },
  way: [[-355, -360], [-365, -300], [-340, -245], [-360, -185], [-335, -125], [-300, -70], [-280, -5], [-230, 55], [-170, 82], [-120, 62], [-100, 112], [-62, 78], [-18, 112], [35, 102], [82, 62], [118, 20], [168, -5], [225, -18], [272, -58], [294, -118], [310, -190], [350, -255], [382, -325]],
  jumps: [{ f: 0.31, h: 0.8, text: 'Przez szczyt' }, { f: 0.72, h: 1.05, text: 'Mały skok' }],
  features: [{ f: 0.49, text: 'Mocna kompresja' }],
};

// A way point the route turns sharply at (a switchback) becomes an arc of radius R tangent to both legs, as a road's
// hairpin is built: a spline through the bare point would turn there on a few metres, tighter than any car can.
function fillet(way, R0) {
  const out = [way[0]];
  for (let i = 1; i < way.length - 1; i++) {
    const [ax, az] = way[i - 1], [bx, bz] = way[i], [cx, cz] = way[i + 1], lu = Math.hypot(bx - ax, bz - az), lv = Math.hypot(cx - bx, cz - bz);
    const ux = (bx - ax) / lu, uz = (bz - az) / lu, vx = (cx - bx) / lv, vz = (cz - bz) / lv, th = Math.acos(clamp(ux * vx + uz * vz, -1, 1));
    if (th < 1.0) { out.push(way[i]); continue; } // (gentler bends: the spline rounds them well enough)
    let R = R0, t = R * Math.tan(th / 2); const tmax = 0.45 * Math.min(lu, lv); if (t > tmax) { t = tmax; R = t / Math.tan(th / 2); }
    const p0x = bx - ux * t, p0z = bz - uz * t, p1x = bx + vx * t, p1z = bz + vz * t, sd = -uz * vx + ux * vz > 0 ? 1 : -1, ox = p0x - uz * sd * R, oz = p0z + ux * sd * R;
    const a0 = Math.atan2(p0z - oz, p0x - ox); let sw = Math.atan2(p1z - oz, p1x - ox) - a0; sw -= Math.round(sw / (2 * Math.PI)) * 2 * Math.PI;
    const n = Math.max(3, Math.ceil(Math.abs(sw) * R / 3));
    for (let k = 0; k <= n; k++) { const a = a0 + sw * k / n; out.push([ox + Math.cos(a) * R, oz + Math.sin(a) * R]); }
  }
  out.push(way[way.length - 1]);
  return out;
}

function trackLine(cfg) {
  // Fit each hand-drawn route to its declared competitive distance. Sampling is followed by one final uniform
  // correction, so the polyline used by timing, pace notes and the road itself has the requested length.
  let way = cfg.way.map(p => p.slice()), curve = new THREE.CatmullRomCurve3(way.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
  const fit = cfg.target / curve.getLength(); way = fillet(way.map(([x, z]) => [x * fit, z * fit]), cfg.hairpin || 10);
  curve = new THREE.CatmullRomCurve3(way.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
  const fit2 = cfg.target / curve.getLength(); way = way.map(([x, z]) => [x * fit2, z * fit2]);
  curve = new THREE.CatmullRomCurve3(way.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
  const n = Math.max(2, Math.round(cfg.target)), pts = [];
  curve.arcLengthDivisions = n * 8; // (the even 1 m stations need a fine arc-length table: the default 200 steps bunched them up round the hairpins)
  for (let i = 0; i <= n; i++) { const p = curve.getPointAt(i / n); pts.push([p.x, p.z]); }
  const sampled = pts.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0), exact = cfg.target / sampled;
  for (const p of pts) { p[0] *= exact; p[1] *= exact; }
  const mountain = cfg.profile === 'mountain';
  const land = cfg.land || (mountain
    ? (x, z) => 68 + z * 0.105 + x * 0.006 + Math.sin(x * 0.007 + 0.4) * 3.2 + Math.sin(z * 0.008 + 1.1) * 2.4 + Math.sin((x - z) * 0.014) * 1.1 + Math.sin(x * 0.013 - z * 0.004 + 2.1) * 5 + Math.sin(x * 0.031 + z * 0.017) * 2.2
    : cfg.roadType === 'asphalt'
    ? (x, z) => 48 + z * 0.075 + Math.sin(x * 0.006) * 7 + Math.sin(z * 0.008 + 0.8) * 5 + Math.sin((x + z) * 0.012) * 2.8 + Math.sin(x * 0.016 + z * 0.005 + 1.3) * 10 + Math.sin(z * 0.021 - x * 0.011 + 0.4) * 4.5
    : (x, z) => 24 + z * 0.025 + Math.sin(x * 0.005) * 4.5 + Math.sin(z * 0.007 + 0.8) * 3.5 + Math.sin((x + z) * 0.01) * 2);
  const jumpSpecs = cfg.jumps || [];
  const jump = (s, c, h) => { const d = s - c; if (d < -18 || d > 7) return 0; return d <= 0 ? h * Math.pow((d + 18) / 18, 1.18) : h * (1 - d / 7); };
  // (a hillside road is graded: it follows the land smoothed along its way, cutting into the rises and built up over the
  // hollows, so the slopes beside it keep their own shape)
  const graded = mountain || cfg.verge === 'cut' || cfg.grade, L0 = pts.map(([x, z]) => land(x, z)), LS = graded ? L0.map((_, i) => { let a = 0, c = 0; for (let k = Math.max(0, i - (cfg.grade || 60)); k <= Math.min(L0.length - 1, i + (cfg.grade || 60)); k += 3) { a += L0[k]; c++; } return a / c; }) : L0;
  const Y = pts.map(([x, z], i) => LS[i]
    + (cfg.land ? Math.sin(i / 70) * 0.5 : mountain ? Math.sin(i / 180 + 0.5) * 2.4 + Math.sin(i / 80) * 0.8 : Math.sin(i / (cfg.roadType === 'asphalt' ? 210 : 260) + 0.5) * (cfg.roadType === 'asphalt' ? 3.8 : 2.8) + Math.sin(i / 92) * 1.7)
    + jumpSpecs.reduce((v, j) => v + jump(i, j.f * n, j.h), 0));
  const features = jumpSpecs.map(j => ({ at: Math.round(j.f * n), end: Math.round(j.f * n) + 12, text: j.text, kind: 'feature', dir: 0 }));
  for (const f of cfg.features || []) features.push({ at: Math.round(n * f.f), end: Math.round(n * f.f) + 10, text: f.text, kind: 'feature', dir: 0 });
  return { pts, Y, features, land, length: cfg.target };
}

export async function build(progress) { return buildStage(progress, PINE_STAGE); }

export async function buildStage(progress, cfg) {
  // Start loading the same owned Idyllic Woodlands / Illustrated Nature library used by Wildlands. trees.js will
  // automatically use tree02/tree03 and their LODs once it is ready, while installations without the local pack
  // retain the procedural fallback.
  setPaint(cfg.paint); // (each stage's own palette: a dry upland, a dark northern wood, a high massif)
  const packsP = loadPacks(), peopleP = loadPeople().catch(e => { console.warn('rally spectators: ' + e.message); return null; });
  progress('Laying out the stage', 0.05); await tick();
  const line = trackLine(cfg), P = line.pts, Y = line.Y, N = P.length;
  const T = P.map((_, i) => { const a = P[Math.max(0, i - 2)], b = P[Math.min(N - 1, i + 2)], l = Math.hypot(b[0] - a[0], b[1] - a[1]); return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; });
  // signed curvature (left positive: the car's left is +x when it faces +z) over ±6 m
  const K = P.map((_, i) => { const a = T[Math.max(0, i - 6)], b = T[Math.min(N - 1, i + 6)]; return (a[1] * b[0] - a[0] * b[1]) / 12; });
  const left = i => [T[i][1], -T[i][0]];
  // ---- the distance field: distance to the centre line and the nearest point on it (2 m cells, 60 m round the road)
  const WORLD = 2048, HALF = WORLD / 2, DC = 2, DN = WORLD / DC, FAR = 60;
  const DIST = new Float32Array(DN * DN).fill(FAR), NEAR = new Int32Array(DN * DN).fill(-1);
  for (let i = 0; i < N; i++) { const [px, pz] = P[i], i0 = Math.max(0, Math.floor((px - FAR + HALF) / DC)), i1 = Math.min(DN - 1, Math.ceil((px + FAR + HALF) / DC)), j0 = Math.max(0, Math.floor((pz - FAR + HALF) / DC)), j1 = Math.min(DN - 1, Math.ceil((pz + FAR + HALF) / DC));
    for (let j = j0; j <= j1; j++) { const z = -HALF + (j + 0.5) * DC, dz = z - pz; for (let ii = i0; ii <= i1; ii++) { const dx = -HALF + (ii + 0.5) * DC - px, d = dx * dx + dz * dz, o = j * DN + ii; if (d < DIST[o] * DIST[o]) { DIST[o] = Math.sqrt(d); NEAR[o] = i; } } }
    if ((i & 511) === 0) { progress('Laying out the stage', 0.05 + 0.1 * i / N); await tick(); } }
  const distAt = (x, z) => { const gx = clamp((x + HALF) / DC - 0.5, 0, DN - 1.001), gz = clamp((z + HALF) / DC - 0.5, 0, DN - 1.001), i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j, o = j * DN + i;
    return lerp(lerp(DIST[o], DIST[o + 1], fx), lerp(DIST[o + DN], DIST[o + DN + 1], fx), fz); };
  const nearAt = (x, z) => { const i = clamp(Math.floor((x + HALF) / DC), 0, DN - 1), j = clamp(Math.floor((z + HALF) / DC), 0, DN - 1); return NEAR[j * DN + i]; };

  // ---- woods: the dense Wildlands pack forest forms a close corridor; posts and a clean road edge keep bends legible
  const rng = mulberry32(cfg.seed), ph = Array.from({ length: 8 }, () => [rng() * 6.28, 0.6 + rng() * 0.8, rng() * 6.28]);
  const woods = (x, z) => { let n = 0; for (let k = 0; k < 8; k++) { const [a, f, p] = ph[k], s = 0.0028 * f * (1 + k * 0.45); n += Math.sin((x * Math.cos(a) + z * Math.sin(a)) * s + p) / (1 + k * 0.6); } return smoothstep(-0.1, 0.9, n * 0.75 + 0.1); };
  progress('Grading the ground', 0.18); await tick();
  const mountain = cfg.profile === 'mountain', asphalt = cfg.roadType === 'asphalt', cut = (cfg.verge || (mountain ? 'cut' : 'ditch')) === 'cut', eco = cfg.eco || {};
  // ---- the road's own surface, exact between the 2 m cells of the ground: a crowned cross-section (water runs off to
  // the edges, more so on gravel), the bends banked a little toward their inside. Wheels, the ribbon and the ground under
  // it all read it from here, so the road never takes the shape of the coarse terrain grid
  const CROWN = asphalt ? 0.035 : 0.075, BANK = Float32Array.from(K, k => asphalt ? clamp(k * 7, -0.055, 0.055) : clamp(k * 3, -0.03, 0.03));
  const project = (x, z, o) => { const i = nearAt(x, z); if (i < 0) return null; let best = Infinity;
    for (let k = Math.max(0, i - 3); k <= Math.min(N - 2, i + 2); k++) { const ax = P[k][0], az = P[k][1], dx = P[k + 1][0] - ax, dz = P[k + 1][1] - az, l2 = dx * dx + dz * dz || 1e-9;
      const t = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1), ex = x - ax - dx * t, ez = z - az - dz * t, d2 = ex * ex + ez * ez;
      if (d2 < best) { best = d2; o.k = k; o.t = t; o.w = (ex * dz - ez * dx) / Math.sqrt(l2); } }
    o.d = Math.sqrt(best); return o; };
  const roadY = (o, w = o.w) => lerp(Y[o.k], Y[o.k + 1], o.t) - CROWN * Math.min((w / 1.4) ** 2, 2) - lerp(BANK[o.k], BANK[o.k + 1], o.t) * w;
  const surfY = (i, w) => Y[i] - CROWN * Math.min((w / 1.4) ** 2, 2) - BANK[i] * w; // (at a point of the line)
  const ED = SHOULDER + 0.25, BANK0 = 4.3, PT = { k: 0, t: 0, w: 0, d: 0 }, PB = { k: 0, t: 0, w: 0, d: 0 };
  // beside the road: in the woods a drainage ditch each side, then the forest floor; on a hillside the road is cut into
  // the slope — a steep bank with a gutter at its foot above it, a longer embankment of fill below — and the hill goes on
  const terrainHeight = (x, z) => { const base = line.land(x, z), o = project(x, z, PT); if (!o) return base;
    const d = o.d; if (d <= ED) return roadY(o) - 0.035;
    const edgeY = roadY(o, o.w < 0 ? -ED : ED) - 0.035, roadH = lerp(Y[o.k], Y[o.k + 1], o.t);
    // (ground rising above the road starts only past BANK0: a terrain triangle reaches 2.8 m, and one touching the road's
    // edge must not stand over it)
    if (cut) { const px = lerp(P[o.k][0], P[o.k + 1][0], o.t), pz = lerp(P[o.k][1], P[o.k + 1][1], o.t), natural = base + (roadH - line.land(px, pz)) * (1 - smoothstep(5, 14, d)), dh = natural - edgeY;
      const span = clamp(Math.abs(dh) * (dh > 0 ? 0.75 : 1.5), 1.4, 16), gutter = dh > 0.5 ? 0.28 * smoothstep(ED, ED + 0.7, d) * (1 - smoothstep(ED + 1.2, BANK0, d)) : 0;
      return lerp(edgeY, natural, smoothstep(dh > 0 ? BANK0 : ED + 0.15, (dh > 0 ? BANK0 : ED) + span, d)) - gutter; }
    const far = lerp(base, roadH, 1 - smoothstep(10, FAR - 3, d)), dip = (cfg.ditch ?? 0.5) * smoothstep(ED, ED + 1.0, d) * (1 - smoothstep(ED + 1.4, ED + 2.9, d));
    return lerp(edgeY, far, smoothstep(far > edgeY ? BANK0 : ED + 1, ED + 8, d)) - dip; };
  // where the spectators stand and the timber is stacked: kept clear of trees
  const corners = findCorners(K, N, 14, N - 28), sites = crowdSites(P, T, K, N, left, corners, line.features, distAt, cfg, mulberry32(cfg.seed + 11)), piles = cut ? [] : logPiles(P, T, K, N, left, distAt, mulberry32(cfg.seed + 17));
  const keepClear = (x, z, pad) => { for (const c of sites) if (Math.hypot(x - c.x, z - c.z) < c.r + pad) return true; for (const p of piles) if (Math.hypot(x - p.x, z - p.z) < 4 + pad) return true; return false; };
  const hf = new Heightfield({ world: WORLD, grid: 1024, height: terrainHeight });
  await hf.generate(p => progress('Grading the ground', 0.18 + 0.06 * p));
  const { HN, CELL } = hf, FOREST = new Float32Array(HN * HN), MOIST = new Float32Array(HN * HN);
  // which side the hill falls away on (smoothed over ±15 m: +1 the left): the guardrail stands there; on the other side,
  // above the snow line, the plough has left a bank of snow along the road (soft, low grip: the car rides up it)
  const DROP = new Int8Array(N), BANKAMT = new Float32Array(N);
  { const raw = new Float32Array(N); for (let i = 0; i < N; i++) { const [px, pz] = P[i], [lx, lz] = left(i); raw[i] = hf.groundAt(px - lx * 6, pz - lz * 6) - hf.groundAt(px + lx * 6, pz + lz * 6); }
    for (let i = 0; i < N; i++) { let a = 0; for (let k = Math.max(0, i - 15); k <= Math.min(N - 1, i + 15); k++) a += raw[k]; DROP[i] = a > 0 ? 1 : -1;
      if (mountain && cfg.snowLine) BANKAMT[i] = smoothstep(cfg.snowLine - 12, cfg.snowLine + 22, Y[i]) * (0.7 + 0.3 * Math.sin(i * 0.071) + 0.15 * Math.sin(i * 0.23)) * smoothstep(20, 60, i) * (1 - smoothstep(N - 60, N - 25, i)); } }
  // (round a switchback the hill falls away on the outside of the bend: the rail keeps to it through the whole bend)
  for (const c of corners) if (c.R < 40) for (let i = Math.max(0, c.s - 6); i <= Math.min(N - 1, c.e + 6); i++) DROP[i] = -c.dir;
  const bankH = a => { const u = (a - 2.45) / 0.95; return u * u < 1 ? 0.55 * (1 - u * u) ** 0.7 : 0; };
  const snowBank = o => BANKAMT[o.k] > 0.01 && (o.w < 0 ? -1 : 1) === -DROP[o.k] ? bankH(o.d) * BANKAMT[o.k] : 0;
  const clearAt = (x, z) => { const ni = nearAt(x, z); if (mountain) return 9; return ni >= 0 && (ni < 58 || ni > N - 72) ? 7.4 : CLEAR; };
  for (let j = 0; j < HN; j++) for (let i = 0; i < HN; i++) { const x = -HALF + i * CELL, z = -HALF + j * CELL, o = j * HN + i, d = distAt(x, z), clear = clearAt(x, z);
    const forestBase = mountain || eco.woods ? Math.max(0, woods(x, z) - (eco.woods ?? 0.56)) * (eco.woods ? 1.6 : 0.5) : Math.max(cfg.forestMin, woods(x, z)), near = cfg.forestNear ?? clear + 0.35;
    const f = forestBase * smoothstep(near, near + 4.4, d) * (d < 40 && keepClear(x, z, 2) ? 0.25 : 1), moist = clamp(0.48 + 0.22 * Math.sin(x * 0.011 + z * 0.007) + 0.1 * Math.sin(z * 0.021), 0, 1); FOREST[o] = f; MOIST[o] = moist;
    hf.mask[o * 4] = smoothstep(0.35, 0.8, f) * 235; hf.mask[o * 4 + 1] = 255; hf.mask[o * 4 + 3] = moist * 255;
    const rag = Math.sin(x * 0.37 + z * 0.23) * 0.5 + Math.sin(x * 0.11 - z * 0.29) * 0.5; // (a ragged verge, never a ruled line)
    // the shoulder (loose gravel, bare earth) and, on a stony stage, broken stone over the slopes: little soil, little grass
    const slope = 1 - hf.gridNormalY(i, j), patch = 0.5 + 0.35 * Math.sin(x * 0.031 + z * 0.017 + Math.sin(z * 0.05)) + 0.25 * Math.sin(x * 0.083 - z * 0.061);
    const stony = (cfg.stony || 0) * clamp(smoothstep(0.1, 0.3, slope + (patch - 0.5) * 0.16) * 0.8 + smoothstep(0.78, 1.05, patch) * 0.5, 0, 1) * (1 - smoothstep(0.3, 0.7, f)) * (1 - smoothstep(0.32, 0.46, slope)); // (cliffs stay the rock layer's)
    hf.mask2[o * 4] = Math.max(1 - smoothstep(SHOULDER - 0.1, SHOULDER + 0.5 + rag * 0.25, d), stony) * 255;
    hf.mask2[o * 4 + 2] = (1 - smoothstep(SHOULDER + 0.05, SHOULDER + 0.55, d)) * 255;
    hf.mask2[o * 4 + 3] = (1 - smoothstep(SHOULDER + 2.5, SHOULDER + 5.5 + rag, d)) * 255;   // a mown verge: short, sparse grass before the long grass
  }
  let bx0 = 1e9, bx1 = -1e9, bz0 = 1e9, bz1 = -1e9; for (const [x, z] of P) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); bz0 = Math.min(bz0, z); bz1 = Math.max(bz1, z); }
  hf.paintPave(bx0 - 5, bz0 - 5, bx1 + 5, bz1 + 5, (x, z) => 1 - smoothstep(SHOULDER - 0.05, SHOULDER + 0.35 + 0.15 * Math.sin(x * 0.9 + z * 1.3), distAt(x, z)));
  // ---- the same forest ecology used by Wildlands: mixed ages and stands, broadleaf fringe, old conifers, dead trees
  progress('Planting the woods', 0.28); await tick();
  const blocked = (x, z, pad = 0) => distAt(x, z) < clearAt(x, z) + pad || keepClear(x, z, pad);
  // The same altitude reference and species mix as nature.js: low woodland gets oak/leaf/birch among the conifers.
  const alpine = asphalt, ecologySnow = eco.snow ?? cfg.snowLine ?? 205;
  const { trees, saplings } = plantForest({ hf, forest: FOREST, moist: MOIST, seed: cfg.forestSeed, water: 0, snow: ecologySnow, blocked,
    alpine: eco.alpine || (alpine ? [38, 76] : [110, 175]), lowland: eco.lowland || (alpine ? [12, 32] : [22, 60]), meadow: 1100, step: eco.step || (alpine ? 5.4 : 4.5) });
  const floor = forestFloor({ hf, forest: FOREST, moist: MOIST, trees, seed: cfg.floorSeed, water: 0, blocked,
    logs: eco.logs ?? (mountain ? 60 : alpine ? 320 : 650), twigs: eco.twigs ?? (mountain ? 500 : alpine ? 3500 : 7000), shrubs: eco.shrubs ?? (mountain ? 280 : alpine ? 1500 : 3000) });
  hf.paintCanopy(trees);
  hf.uploadHeight(); hf.uploadMasks();
  progress('Shaping the ground', 0.4); await tick();
  const layers = {
    grass: { d: phTex('aerial_grass_rock', 'diff', '2k', true, [92, 98, 52]), n: phTex('aerial_grass_rock', 'nor_gl', '2k', false, NFLAT), s: 6, tint: [0.95, 1.06, 0.8] },
    forest: { d: phTex('forest_leaves_03', 'diff', '2k', true, [70, 58, 40]), n: phTex('forest_leaves_03', 'nor_gl', '1k', false, NFLAT), s: 3 },
    rock: { d: phTex('rock_face_03', 'diff', '2k', true, [110, 100, 90]), n: phTex('rock_face_03', 'nor_gl', '2k', false, NFLAT), s: 9 },
    shore: { d: phTex('coast_sand_01', 'diff', '2k', true, [140, 125, 100]), n: phTex('coast_sand_01', 'nor_gl', '1k', false, NFLAT), s: 4, tint: [0.78, 0.72, 0.6] },
    // (the shoulders and the stony ground: gravel in the woods, broken rock on the mountains)
    urban: cfg.stoneGround ? { d: phTex('rock_face_03', 'diff', '2k', true, [110, 100, 90]), n: phTex('rock_face_03', 'nor_gl', '2k', false, NFLAT), s: 3.4, tint: cfg.stoneGround, norm: cfg.stoneNorm || 0.3 }
      : { d: phTex('bicolour_gravel', 'diff', '1k', true), n: phTex('bicolour_gravel', 'nor_gl', '1k', false, NFLAT), s: 2.5, tint: [1.08, 0.98, 0.84], norm: 0.5 },
  };
  const terrainSnow = cfg.snowLine ?? 5000;
  const terrain = await buildTerrainMeshes(hf, terrainMaterial(hf, layers, { water: -60, snow: terrainSnow, shore: 0.01, conifer: 0.7 }));
  progress('Growing the woods', 0.55); await tick();
  await packsP;
  buildTrees([...trees, ...saplings]);
  buildBushes(floor.shrubs, 'bush');
  buildTrees(floor.twigs, { colliders: false });
  buildLogs(floor.logs);
  progress('Grading the road', 0.68); await tick();
  const road = roadRibbon(P, T, K, N, surfY, corners, cfg);
  const startI = 14, finishI = N - 28, dressing = dressStage(P, T, K, N, left, rng, startI, finishI, hf, cfg, corners, sites, DROP);
  progress('Dressing the roadside', 0.76); await tick();
  roadside(P, T, K, N, left, startI, finishI, hf, cfg, piles, distAt, mulberry32(cfg.seed + 23), packsReady());
  const crowd = spectators(sites, await peopleP, hf, P);
  progress('Sowing the meadows', 0.8); await tick();
  const grass = buildGrass(hf, layers.grass.d, { water: -60, snow: terrainSnow, reeds: false, shore: 0.01 });
  progress('Opening the stage', 0.95); await tick();
  // ---- the start: the car on the line facing down the road, the walker beside it
  const s0 = 8, [sx, sz] = P[s0], [tx, tz] = T[s0], [lx2, lz2] = left(s0);
  const carSpawn = { x: sx, z: sz, yaw: Math.atan2(tx, tz) };
  const spawn = { x: sx + lx2 * 5, z: sz + lz2 * 5, yaw: Math.atan2(-tx, -tz), pitch: -0.05 };
  const PG = { k: 0, t: 0, w: 0, d: 0 };
  const groundBase = (x, z, o) => { if (o.d > ED + 0.4) return hf.groundAt(x, z); const r = roadY(o) + 0.02; return o.d <= SHOULDER ? r : lerp(r, hf.groundAt(x, z), smoothstep(SHOULDER, ED + 0.4, o.d)); };
  if (BANKAMT.some(v => v > 0.01)) snowBanks(P, T, N, left, DROP, BANKAMT, bankH, (x, z) => { const o = project(x, z, PB); return o ? groundBase(x, z, o) : hf.groundAt(x, z); });
  const clock = stageClock(N, nearAt, distAt, corners, line.features, startI, finishI, carSpawn, cfg);
  const world = {
    hf, grass, terrain, road, spawn, carSpawn, track: { P, T, N, distAt, nearAt, length: line.length, sites, piles }, race: clock, stage: cfg,
    bounds: { minX: -HALF + 30, maxX: HALF - 30, minZ: -HALF + 30, maxZ: HALF - 30 },
    waterLevel: -60, waterAt: () => -60,
    // (on and beside the road the exact surface, blended into the ground past its edge; elsewhere the terrain)
    groundAt(x, z) { const o = project(x, z, PG); if (!o || o.d > 3.5) return hf.groundAt(x, z); return groundBase(x, z, o) + snowBank(o); },
    normalAt(x, z, out) { const o = project(x, z, PG); if (!o || o.d > 3.7) return hf.normalAt(x, z, out); const e = 0.3, hx = world.groundAt(x + e, z) - world.groundAt(x - e, z), hz = world.groundAt(x, z + e) - world.groundAt(x, z - e), l = Math.hypot(hx, 2 * e, hz); return out.set(-hx / l, 2 * e / l, -hz / l); },
    surfaceAt(x, z) { const d = distAt(x, z); if (d < SHOULDER) return cfg.roadType; if (d < 3.5) { const o = project(x, z, PG); if (o && snowBank(o) > 0.08) return 'snow'; } return FOREST[hf.idx(x, z)] > 0.5 ? 'forest' : 'grass'; },
    // (the car feels the road's surface: corrugations and the odd pothole on the gravel, a softer roll on the grass)
    bumpAt(x, z) { const d = distAt(x, z), g = 1 - smoothstep(ROAD, SHOULDER + 1, d);
      const b = Math.sin(x * 1.1 + z * 0.5) * Math.sin(z * 0.9 - x * 0.3) * 0.003 + Math.sin(x * 0.37 - z * 0.41) * Math.sin(z * 0.29 + x * 0.19) * 0.012;
      const pot = -0.045 * smoothstep(0.975, 0.995, Math.sin(x * 0.173 + 1.3) * Math.sin(z * 0.151 + 0.4));
      return b * (0.45 + 0.55 * g) + pot * g; },
    gripAt(x, z) { const d = distAt(x, z); return d < ROAD || d > SHOULDER + 1 ? 1 : lerp(1, 0.93, clamp((d - ROAD) / (SHOULDER - ROAD), 0, 1)); }, // (the loose gravel at the edges)
    ambience(x, z) { return { forest: FOREST[hf.idx(clamp(x, -HALF, HALF), clamp(z, -HALF, HALF))], water: 0, town: 0, insects: 0.4 }; },
    restartStage() { clock.reset(); },
    update(dt) { clock.update(dt, world.vehicle); dressing.update && dressing.update(dt); crowd && crowd.update(dt, world.vehicle); },
  };
  return world;
}

// The graded road is one car wide, its heights the exact crowned and banked surface (surfY). Its cross-section tells the
// surface's story: on gravel two compacted wheel tracks (darker, the stones pressed in), loose gravel swept to the middle
// and the edges and thrown to the outside of the bends, bare earth at a ragged shoulder and where cars have cut the
// insides of the bends, damp stretches, and dark wet earth in the potholes the car feels (bumpAt); on asphalt a real
// worn surface with darker rubbered wheel tracks, patched repairs, a crumbling edge with worn edge lines and grit dragged
// onto the tarmac at the inside of the corners. A second texture (earth, or grit) is mixed in per vertex (aDirt).
function roadRibbon(P, T, K, N, surfY, corners, cfg) {
  const asphalt = cfg.roadType === 'asphalt';
  const X = asphalt ? [-1.85, -1.6, -1.42, -1.27, -1.05, -0.8, -0.55, -0.25, 0, 0.25, 0.55, 0.8, 1.05, 1.27, 1.42, 1.6, 1.85]
    : [-2.0, -1.72, -1.45, -1.2, -0.98, -0.78, -0.55, -0.3, 0, 0.3, 0.55, 0.78, 0.98, 1.2, 1.45, 1.72, 2.0];
  const nx = X.length, M = N - 1, nv = N * nx;
  const pos = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), col = new Float32Array(nv * 4), dirt = new Float32Array(nv), idx = [];
  // per point of the line: the inside of a bend cut (earth dragged in) and its outside (loose gravel thrown wide), each side
  const cutL = new Float32Array(N), cutR = new Float32Array(N), throwL = new Float32Array(N), throwR = new Float32Array(N);
  for (const c of corners) { if (c.R > 90) continue; const k = clamp((90 - c.R) / 60, 0, 1), a = c.apex, i0 = Math.max(0, c.s - 8), i1 = Math.min(N - 1, c.e + 25);
    for (let i = i0; i <= i1; i++) { const v = (i < a ? smoothstep(i0, a, i) : 1 - smoothstep(a, i1, i)) * k;
      if (c.dir > 0) { cutL[i] = Math.max(cutL[i], v); throwR[i] = Math.max(throwR[i], v); } else { cutR[i] = Math.max(cutR[i], v); throwL[i] = Math.max(throwL[i], v); } } }
  const hash = i => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  const noise1 = x => { const i = Math.floor(x), f = x - i; return lerp(hash(i), hash(i + 1), f * f * (3 - 2 * f)); };
  // asphalt repairs: darker patches a few metres long over one half of the road or the whole of it
  const patch = new Int8Array(N); // (1 the left half, 2 the right half, 3 all of it)
  if (asphalt) for (let i = 30 + Math.floor(hash(7) * 40); i < N - 20; i += 35 + Math.floor(hash(i) * 70)) { const len = 3 + Math.floor(hash(i + 3) * 9), kind = 1 + Math.floor(hash(i + 5) * 3); for (let j = i; j < Math.min(N, i + len); j++) patch[j] = kind; }
  const patched = (i, w) => patch[i] === 3 || (patch[i] === 1 && w > -0.05) || (patch[i] === 2 && w < 0.05);
  let sAlong = 0;
  for (let i = 0; i < N; i++) { const [px, pz] = P[i], [tx, tz] = T[i], lx = tz, lz = -tx; if (i) sAlong += Math.hypot(px - P[i - 1][0], pz - P[i - 1][1]);
    const tone = 0.86 + 0.22 * noise1(i / 23) + 0.08 * noise1(i / 5.3), damp = smoothstep(0.62, 0.85, noise1(i / 41 + 9.3));
    const ragL = 0.12 * noise1(i / 3.1 + 1.7) + 0.1 * noise1(i / 11 + 4.2), ragR = 0.12 * noise1(i / 3.3 + 7.1) + 0.1 * noise1(i / 13 + 2.4);
    for (let k = 0; k < nx; k++) { const o = i * nx + k, w = X[k], aw = Math.abs(w), L = w > 0, rag = L ? ragL : ragR, cutV = L ? cutL[i] : cutR[i], throwV = L ? throwL[i] : throwR[i];
      const x = px + lx * w, z = pz + lz * w; pos[o * 3] = x; pos[o * 3 + 1] = surfY(i, w) + 0.02; pos[o * 3 + 2] = z;
      uv[o * 2] = w / (asphalt ? 3.2 : 2.5); uv[o * 2 + 1] = sAlong / (asphalt ? 3.2 : 2.5);
      let v, a, e;
      if (asphalt) {
        const edge = 1.32 + rag * 0.6;
        a = 1 - smoothstep(edge, edge + 0.42, aw);
        v = tone * (1 - 0.1 * Math.exp(-(((aw - 0.78) / 0.22) ** 2))) * (1 - 0.06 * damp) * (patched(i, w) ? 0.68 : 1);
        e = Math.max(smoothstep(1.2, 1.55, aw + rag * 0.5) * 0.75,           // (the crumbling edge, grit on it)
          cutV * smoothstep(1.45 - 1.25 * cutV, 1.5, aw) * 0.95,              // (grit dragged in where the bend was cut)
          throwV * 0.25 * smoothstep(0.9, 1.5, aw));
      } else {
        const edge = 1.45 + rag + throwV * 0.35;
        a = 1 - smoothstep(edge, edge + 0.45, aw);
        const track = Math.exp(-(((aw - 0.8) / 0.25) ** 2)), berm = Math.exp(-((w / 0.3) ** 2)), loose = smoothstep(1.0, 1.35, aw) * (1 - smoothstep(1.5, 1.9, aw));
        v = tone * (1 - 0.26 * track) * (1 + 0.14 * berm + 0.16 * loose * (1 + throwV)) * (1 - 0.22 * damp * (1 - berm));
        const pot = smoothstep(0.96, 0.99, Math.sin(x * 0.173 + 1.3) * Math.sin(z * 0.151 + 0.4)) * (1 - smoothstep(ROAD, SHOULDER + 1, aw));
        e = Math.max(smoothstep(1.3, 1.85, aw - rag * 0.5) * 0.85, cutV * smoothstep(1.5 - 1.1 * cutV, 1.6, aw), pot * 0.8); v *= 1 - 0.3 * pot;
      }
      col[o * 4] = col[o * 4 + 1] = col[o * 4 + 2] = v; col[o * 4 + 3] = a; dirt[o] = e; } }
  for (let m = 0; m < M; m++) for (let k = 0; k < nx - 1; k++) { const a = m * nx + k, b = a + nx; idx.push(a, b, a + 1, a + 1, b, b + 1); } // (wound to face up: k runs to the left)
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.BufferAttribute(col, 4));
  g.setAttribute('aDirt', new THREE.BufferAttribute(dirt, 1)); g.setIndex(idx); g.computeVertexNormals();
  const tex = asphalt ? 'asphalt_pit_lane' : 'bicolour_gravel';
  const mat = new THREE.MeshStandardMaterial({ map: phTex(tex, 'diff', asphalt ? '2k' : '1k', true), normalMap: phTex(tex, 'nor_gl', '1k', false, NFLAT),
    roughnessMap: asphalt ? phTex('asphalt_pit_lane', 'rough', '1k', false, [210, 210, 210]) : null, normalScale: new THREE.Vector2(asphalt ? 0.85 : 0.65, asphalt ? 0.85 : 0.65),
    roughness: asphalt ? 1 : 0.97, metalness: 0, vertexColors: true, alphaHash: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const dirtTex = asphalt ? phTex('bicolour_gravel', 'diff', '1k', true) : phTex('brown_mud', 'diff', '1k', true), dirtTint = asphalt ? new THREE.Color(1.9, 1.72, 1.42) : new THREE.Color(2.3, 2.0, 1.6);
  mat.onBeforeCompile = sh => { Object.assign(sh.uniforms, { tDirt: { value: dirtTex }, uDirtTint: { value: dirtTint } });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aDirt; varying float vDirt; varying vec2 vDirtUv;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvDirt = aDirt; vDirtUv = uv * 1.3;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D tDirt; uniform vec3 uDirtTint; varying float vDirt; varying vec2 vDirtUv;')
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, texture2D(tDirt, vDirtUv).rgb * uDirtTint, clamp(vDirt, 0.0, 1.0));'); };
  mat.customProgramCacheKey = () => 'rally-road';
  // (the photo textures are dark on average: lifted to the albedo of sunlit grey asphalt, of dry beige-grey gravel)
  mat.color.setRGB(...(asphalt ? [1.9, 1.86, 1.8] : [2.4, 2.1, 1.68]));
  mat.name = asphalt ? 'rally-asphalt' : 'rally-gravel';
  const group = new THREE.Group(); group.name = 'rally-road'; scene.add(group);
  const mesh = new THREE.Mesh(g, mat); mesh.receiveShadow = true; mesh.name = 'rally-road-surface'; group.add(mesh);
  if (asphalt) { // (worn edge lines, broken where the paint has gone or a patch has covered it; no centre line on a road one car wide)
    const marks = [], emit = (i, off, half) => { const j = Math.min(N - 1, i + 2), [ax, az] = P[i], [bx, bz] = P[j], [atx, atz] = T[i], [btx, btz] = T[j], ya = surfY(i, off) + 0.035, yb = surfY(j, off) + 0.035;
      const a0 = [ax + atz * (off - half), ya, az - atx * (off - half)], a1 = [ax + atz * (off + half), ya, az - atx * (off + half)];
      const b0 = [bx + btz * (off - half), yb, bz - btx * (off - half)], b1 = [bx + btz * (off + half), yb, bz - btx * (off + half)]; marks.push(...a0, ...b0, ...a1, ...a1, ...b0, ...b1); };
    for (let i = 0; i < N - 2; i += 2) for (const off of [-1.24, 1.24]) if (hash(i * 3.7 + off) > 0.16 && !patched(i, off) && (off > 0 ? cutL[i] : cutR[i]) < 0.4) emit(i, off, 0.055);
    const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.Float32BufferAttribute(marks, 3)); mg.computeVertexNormals();
    const mm = new THREE.MeshStandardMaterial({ color: 0xd9d6cb, roughness: 0.82, opacity: 0.82, alphaHash: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
    const painted = new THREE.Mesh(mg, mm); painted.receiveShadow = true; painted.name = 'rally-road-markings'; group.add(painted);
  }
  return group;
}

// the corners: runs of signed curvature, by their tightest point and direction (also kept for the pace notes)
function findCorners(K, N, startI, finishI) {
  const corners = []; let s = -1;
  for (let i = 0; i <= N; i++) { const tight = i < N && Math.abs(K[i]) > 1 / 500; if (tight && s < 0) s = i;
    if (!tight && s >= 0) { let a = s; for (let k = s; k < i; k++) if (Math.abs(K[k]) > Math.abs(K[a])) a = k; if (a > startI + 45 && a < finishI - 40) corners.push({ s, e: i - 1, apex: a, R: 1 / Math.abs(K[a]), dir: Math.sign(K[a]) }); s = -1; } }
  return corners;
}

// where the spectators gather: at the tightest bends (the inside, behind tape) and at the crests and jumps, never on
// another stretch of the road
function crowdSites(P, T, K, N, left, corners, features, distAt, cfg, rng) {
  const cand = corners.filter(c => c.R < 42).sort((a, b) => a.R - b.R).slice(0, 4).map(c => ({ i: c.apex, side: c.dir }));
  for (const f of features) if (/skok|szczyt|kompresja/i.test(f.text)) cand.push({ i: f.at, side: rng() < 0.5 ? 1 : -1 });
  const sites = [];
  for (const c of cand) { if (sites.some(s => Math.abs(s.i - c.i) < 140) || c.i < 90 || c.i > N - 90) continue;
    for (const side of [c.side, -c.side]) { const [lx, lz] = left(c.i), x = P[c.i][0] + lx * side * 10.5, z = P[c.i][1] + lz * side * 10.5;
      if (distAt(x, z) < 9) continue;
      sites.push({ i: c.i, side, x, z, r: 9, n: 9 + Math.floor(rng() * 9) }); break; }
    if (sites.length >= 5) break; }
  return sites;
}

// timber stacked by the road, as the forestry leaves it beside every forest track: on straight stretches, past the ditch
function logPiles(P, T, K, N, left, distAt, rng) {
  const piles = [];
  for (let i = 110 + Math.floor(rng() * 60); i < N - 110;) {
    let straight = true; for (let k = i - 10; k <= i + 10; k++) if (Math.abs(K[k]) > 1 / 90) { straight = false; break; }
    const side = rng() < 0.5 ? 1 : -1, [lx, lz] = left(i), d = 5.8 + rng() * 0.8, x = P[i][0] + lx * side * d, z = P[i][1] + lz * side * d;
    if (!straight || distAt(x, z) < d - 0.6) { i += 15; continue; }
    piles.push({ i, x, z, side, len: 4 + rng() * 1.4, rad: 0.13 + rng() * 0.07, rows: 2 + Math.floor(rng() * 2), seed: rng() });
    i += 140 + Math.floor(rng() * 150);
  }
  return piles;
}

// the roadside: stacked timber, and stones — boulders in the woods, rock broken out of the cut bank above a hill road and
// the odd outcrop standing out of the slope
function roadside(P, T, K, N, left, startI, finishI, hf, cfg, piles, distAt, rng, packs) {
  // (the timber: straight trunks cut to length, bark on, the sawn ends pale with their rings)
  if (piles.length) {
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), mats = [];
    for (const p of piles) { const [tx, tz] = T[p.i], [lx, lz] = left(p.i), yaw = Math.atan2(tx, tz), r2 = mulberry32(Math.floor(p.seed * 1e6));
      const ex = tx * p.len * 0.5, ez = tz * p.len * 0.5, g0 = (hf.groundAt(p.x - ex, p.z - ez) + hf.groundAt(p.x + ex, p.z + ez) + 2 * hf.groundAt(p.x, p.z)) / 4;
      let top = 0, wide = 0;
      for (let row = 0; row < p.rows; row++) { const n = 6 - row - (p.rows === 2 ? 1 : 0);
        for (let k = 0; k < n; k++) { const off = (k - (n - 1) / 2) * p.rad * 2.02, along = (r2() - 0.5) * 0.4, rad = p.rad * (0.85 + r2() * 0.3), y = g0 + p.rad * 0.92 + row * p.rad * 1.74;
          q.setFromAxisAngle(UPV, yaw + (r2() - 0.5) * 0.03); m4.compose(v.set(p.x + lx * off + tx * along, y, p.z + lz * off + tz * along), q, sc.set(rad, rad, p.len * (0.92 + r2() * 0.12))); mats.push(m4.clone());
          top = Math.max(top, y + rad); wide = Math.max(wide, Math.abs(off) + rad); } }
      addBox(p.x, p.z, wide, p.len * 0.5, yaw, g0 - 0.5, top); }
    const barkT = phTex('pine_bark', 'diff', '1k', true).clone(), barkN = phTex('pine_bark', 'nor_gl', '1k', false, NFLAT).clone();
    for (const t of [barkT, barkN]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 3); t.needsUpdate = true; }
    const ends = document.createElement('canvas'); ends.width = ends.height = 128; { const g = ends.getContext('2d');
      g.fillStyle = '#5a4230'; g.fillRect(0, 0, 128, 128); const rg = g.createRadialGradient(64, 64, 4, 64, 64, 58); rg.addColorStop(0, '#b98a52'); rg.addColorStop(0.5, '#d9b47c'); rg.addColorStop(1, '#c79a5e');
      g.fillStyle = rg; g.beginPath(); g.arc(64, 64, 57, 0, 6.283); g.fill(); g.strokeStyle = '#a07040'; g.globalAlpha = 0.35; for (let r = 6; r < 56; r += 4 + (r % 3)) { g.lineWidth = 1 + (r % 2); g.beginPath(); g.arc(64 + (r % 5) * 0.3, 64, r, 0, 6.283); g.stroke(); } }
    const endT = new THREE.CanvasTexture(ends); endT.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.CylinderGeometry(1, 1, 1, 14, 1, false).rotateX(Math.PI / 2); // (along local z; groups: bark, then the two sawn ends)
    const im = new THREE.InstancedMesh(geo, [new THREE.MeshStandardMaterial({ map: barkT, normalMap: barkN, color: 0xc8b8a4, roughness: 0.95 }), new THREE.MeshStandardMaterial({ map: endT, roughness: 0.9 }), new THREE.MeshStandardMaterial({ map: endT, roughness: 0.9 })], mats.length);
    mats.forEach((m, i) => im.setMatrixAt(i, m)); im.castShadow = im.receiveShadow = true; im.name = 'rally-timber'; im.computeBoundingSphere(); scene.add(im);
  }
  if (!packs) return;
  const ids = ['rk_il_boulder_01', 'rk_il_boulder_02', 'rk_il_boulder_03'].filter(id => packs.models[id]);
  if (!ids.length) return;
  const items = new Map(), cut = (cfg.verge || (cfg.profile === 'mountain' ? 'cut' : 'ditch')) === 'cut';
  const put = (id, x, z, s, sink) => { const M = packs.models[id], w = Math.max(M.dims[0], M.dims[2]) * s, h = M.dims[1] * s; if (distAt(x, z) < 2.4 + w * 0.5) return;
    const y = Math.min(hf.groundAt(x, z), hf.groundAt(x + w * 0.3, z), hf.groundAt(x - w * 0.3, z), hf.groundAt(x, z + w * 0.3), hf.groundAt(x, z - w * 0.3)) - h * sink;
    if (!items.has(id)) items.set(id, []); items.get(id).push({ x, y, z, s, r: rng() * 6.283, tilt: (rng() - 0.5) * 0.3, tilt2: (rng() - 0.5) * 0.3, c: new THREE.Color().setHSL(0.08 + rng() * 0.05, 0.07, cut ? 0.4 + rng() * 0.14 : 0.36 + rng() * 0.12) });
    if (h * (1 - sink) > 0.35) addCircle(x, z, w * 0.36, y, y + h); };
  const putSmall = (id, x, z, s) => { const M = packs.models[id]; if (!items.has(id)) items.set(id, []); items.get(id).push({ x, y: hf.groundAt(x, z) - M.dims[1] * s * 0.3, z, s, r: rng() * 6.283, tilt: (rng() - 0.5) * 0.6, tilt2: (rng() - 0.5) * 0.6, c: new THREE.Color().setHSL(0.08 + rng() * 0.04, 0.06, 0.42 + rng() * 0.12) }); };
  for (let i = startI + 25; i < finishI - 10; i += cut ? 7 + Math.floor(rng() * 16) : 14 + Math.floor(rng() * 26)) {
    const [px, pz] = P[i], [lx, lz] = left(i);
    if (cut) { const up = hf.groundAt(px + lx * 7, pz + lz * 7) > hf.groundAt(px - lx * 7, pz - lz * 7) ? 1 : -1, sd = rng() < 0.82 ? up : -up, d = sd === up ? 3.2 + rng() * 5 : 4 + rng() * 6;
      put(ids[Math.floor(rng() * ids.length)], px + lx * sd * d, pz + lz * sd * d, 0.45 + rng() * rng() * 2.2, 0.35);
      if (rng() < 0.2) { const d2 = 7 + rng() * 9; put(ids[Math.floor(rng() * ids.length)], px + lx * up * d2, pz + lz * up * d2, 1.6 + rng() * 1.8, 0.45); } } // (now and then a big block broken out of the slope)
    else { const sd = rng() < 0.5 ? 1 : -1, d = 4.6 + rng() * 6; put(ids[Math.floor(rng() * ids.length)], px + lx * sd * d, pz + lz * sd * d, 0.4 + rng() * rng() * 1.5, 0.4); if (rng() < 0.4) put(ids[Math.floor(rng() * ids.length)], px + lx * sd * (d + 1.5), pz + lz * sd * (d + 1.5), 0.3 + rng() * 0.5, 0.45); }
  }
  // (tinted per stone like the town's rocks: the library's stone is pale)
  if (cut) { // (rock fallen from the cut bank into the gutter and the odd stone at the edge; boulders all over the slopes)
    for (let i = startI + 6; i < finishI - 6; i += 3 + Math.floor(rng() * 6)) { const [px, pz] = P[i], [lx, lz] = left(i), up = hf.groundAt(px + lx * 7, pz + lz * 7) > hf.groundAt(px - lx * 7, pz - lz * 7) ? 1 : -1;
      const edge = rng() < 0.18, d = edge ? 1.75 + rng() * 0.3 : 2.5 + rng() * 1.4; putSmall(ids[Math.floor(rng() * ids.length)], px + lx * up * d, pz + lz * up * d, edge ? 0.08 + rng() * 0.1 : 0.14 + rng() * rng() * 0.45); }
    const box = [1e9, 1e9, -1e9, -1e9]; for (const [x, z] of P) { box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], z); box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], z); }
    const n3 = new THREE.Vector3();
    for (let k = 0; k < 9000; k++) { const x = box[0] - 220 + rng() * (box[2] - box[0] + 440), z = box[1] - 220 + rng() * (box[3] - box[1] + 440), dd = distAt(x, z); if (dd < 6) continue;
      hf.normalAt(x, z, n3); const sl = 1 - n3.y; if (sl < 0.08 || rng() > smoothstep(0.08, 0.3, sl) * 0.5) continue;
      const big = rng() < 0.1; put(ids[Math.floor(rng() * ids.length)], x, z, big ? 2.2 + rng() * 3 : 0.5 + rng() * rng() * 2, big ? 0.35 : 0.4); }
  }
  for (const [id, list] of items) withScatterMeta({ prefab: 'rally_' + id, category: 'rock' }, () => new Scatter(list, [{ dist: () => 70, parts: packs.models[id].parts.map(q => ({ ...q, castShadow: true, tint: true })) },
    { dist: () => 300, parts: packs.models[id].parts.map(q => ({ ...q, geometry: decimate(q.geometry, 8), castShadow: true, tint: true })) }], 128)); // (a clustered copy past 70 m)
}

// the spectators: little groups behind the tape, standing about and talking, turning to watch the car come and waving it
// through as it passes (the crowd models of the town, crowd.js)
function spectators(sites, people, hf, P) {
  if (!people || !sites.length) return null;
  const rng = mulberry32(919), list = [], JACKET = [[0.85, 0.14, 0.12], [0.95, 0.45, 0.08], [0.95, 0.8, 0.12], [0.12, 0.3, 0.7], [0.1, 0.1, 0.12], [0.18, 0.45, 0.22], [0.9, 0.9, 0.88], [0.45, 0.12, 0.35]];
  const PANTS = [[0.12, 0.13, 0.16], [0.2, 0.24, 0.36], [0.28, 0.27, 0.25], [0.35, 0.3, 0.22]], HAIR = [[0.06, 0.05, 0.05], [0.18, 0.12, 0.08], [0.32, 0.22, 0.12], [0.5, 0.36, 0.22], [0.55, 0.55, 0.56]];
  const pick = a => a[Math.floor(rng() * a.length)], names = Object.keys(CLIP);
  for (const s of sites) for (let k = 0; k < s.n; k++) {
    const along = (rng() - 0.5) * 14, back = (rng() - 0.5) * 4.5, i = clamp(s.i + Math.round(along), 0, P.length - 1);
    const fx = P[i][0], fz = P[i][1], dx = s.x - P[s.i][0], dz = s.z - P[s.i][1], dl = Math.hypot(dx, dz), x = fx + dx / dl * (10.5 + back) + (rng() - 0.5) * 0.6, z = fz + dz / dl * (10.5 + back) + (rng() - 0.5) * 0.6;
    const m = Math.floor(rng() * people.length), M = people[m], yaw = Math.atan2(fx - x, fz - z) + (rng() - 0.5) * 0.7;
    list.push({ m, x, z, y: hf.groundAt(x, z), yaw, base: yaw, look: yaw, clip: rng() < 0.35 ? CLIP.talk : CLIP.idle, t: rng(), wave: rng() < 0.55, waving: 0,
      cols: M.id === 'man_suit' ? [-1, -1, packColor(pick(HAIR))] : [packColor(pick(JACKET)), packColor(pick(PANTS)), packColor(pick(HAIR))] }); }
  const C = crowdMeshes(people, people.map((_, mi) => list.filter(a => a.m === mi).length));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), UP = new THREE.Vector3(0, 1, 0);
  const update = (dt, car) => { const cx = car ? car.st.pos.x : 1e9, cz = car ? car.st.pos.z : 1e9;
    C.begin();
    for (const A of list) { const d = Math.hypot(cx - A.x, cz - A.z), near = d < 90;
      // (heads and bodies turn to follow the car; those who wave do it while it is close)
      const want = near ? Math.atan2(cx - A.x, cz - A.z) : A.base; let dy = want - A.look; dy -= Math.round(dy / 6.283) * 6.283; A.look += clamp(dy, -2.4 * dt, 2.4 * dt);
      const clip = A.wave && d < 45 ? CLIP.act : A.clip; if (clip !== A.cur) { A.cur = clip; A.t = clip === CLIP.act ? 0 : rng(); }
      A.t = (A.t + dt / Math.max(0.3, people[A.m].dur(names[clip]))) % 1;
      q.setFromAxisAngle(UP, A.look); m4.compose(v.set(A.x, A.y, A.z), q, one); C.put(A.m, m4, A.cur, A.t, A.cur, A.t, 0, A.cols); }
    C.end(); };
  update(0, null);
  return { update, list };
}
// the plough's snow banks above the snow line: a rounded bank along the uphill side, grey with grit and slush where it
// meets the road, white on its crown (the same heights the car rides on: bankH, groundAt)
function snowBanks(P, T, N, left, DROP, AMT, bankH, base) {
  const A = [1.5, 1.7, 1.9, 2.15, 2.45, 2.75, 3.0, 3.2, 3.4], na = A.length, pos = [], col = [], uv = [], idx = [];
  let prev = -1;
  for (let i = 0; i < N; i += 2) {
    const amt = AMT[i]; if (amt <= 0.01) { prev = -1; continue; }
    const side = -DROP[i], [lx, lz] = left(i), [px, pz] = P[i], row = pos.length / 3;
    for (const a of A) { const x = px + lx * side * a, z = pz + lz * side * a, h = bankH(a) * amt, dirty = 1 - smoothstep(1.5, 2.15, a), c = lerp(0.95, 0.5, dirty * 0.85);
      pos.push(x, base(x, z) + (h > 0.005 ? h + 0.015 : -0.01), z); col.push(c * 0.97, c * 0.985, c * 1.02); uv.push(a * side * 0.7, i * 0.35); }
    if (prev >= 0 && DROP[i - 2] === DROP[i]) for (let k = 0; k < na - 1; k++) { const p0 = prev + k, p1 = row + k; // (a runs away from the road: to the left on the left side)
      if (side > 0) idx.push(p0, p1, p0 + 1, p0 + 1, p1, p1 + 1); else idx.push(p0, p0 + 1, p1, p0 + 1, p1 + 1, p1); }
    prev = row;
  }
  if (!idx.length) return null;
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const n = phTex('coast_sand_01', 'nor_gl', '1k', false, NFLAT);
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, normalMap: n, normalScale: new THREE.Vector2(0.45, 0.45) }));
  mesh.name = 'rally-snow-banks'; mesh.receiveShadow = true; mesh.castShadow = true; scene.add(mesh); mesh.updateMatrixWorld();
  return mesh;
}


const UPV = new THREE.Vector3(0, 1, 0);
const packColor = c => Math.round(clamp(c[0], 0, 1) * 255) * 65536 + Math.round(clamp(c[1], 0, 1) * 255) * 256 + Math.round(clamp(c[2], 0, 1) * 255);

// roadside marker posts, boards, bales, tape and the start arch
function dressStage(P, T, K, N, left, rng, startI, finishI, hf, cfg, corners, sites, DROP) {
  const group = new THREE.Group(); group.name = 'rally-dressing'; scene.add(group);
  const canvasTex = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = Math.min(8, maxAniso); return t; };
  // chevron boards (red, white arrows toward the turn)
  const chevTex = canvasTex(256, 128, (g, w, h) => { g.fillStyle = '#c8151b'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; for (const x0 of [40, 120, 200]) { g.beginPath(); g.moveTo(x0 - 26, 18); g.lineTo(x0 + 10, 64); g.lineTo(x0 - 26, 110); g.lineTo(x0 - 6, 110); g.lineTo(x0 + 30, 64); g.lineTo(x0 - 6, 18); g.closePath(); g.fill(); } g.strokeStyle = '#fff'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6); });
  const boardG = new THREE.PlaneGeometry(1.3, 0.65), postG = new THREE.BoxGeometry(0.07, 1.25, 0.07).translate(0, 0.625, 0);
  const boardR = new THREE.MeshStandardMaterial({ map: chevTex, roughness: 0.6, side: THREE.DoubleSide }), boardL = boardR.clone(); boardL.map = chevTex.clone(); boardL.map.repeat.x = -1; boardL.map.offset.x = 1; boardL.map.wrapS = THREE.RepeatWrapping;
  const postM = new THREE.MeshStandardMaterial({ color: 0x8a7a64, roughness: 0.9 }), backM = new THREE.MeshStandardMaterial({ color: 0x40403c, roughness: 0.9 });
  // straw bales (round, lying on their side) and tape on poles
  const strawTex = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#c9a85a'; g.fillRect(0, 0, w, h); const r = mulberry32(9); for (let i = 0; i < 2600; i++) { const x = r() * w, y = r() * h, l = 6 + r() * 18, a = (r() - 0.5) * 0.5; g.strokeStyle = `hsla(${38 + r() * 12},${45 + r() * 25}%,${48 + r() * 30}%,0.8)`; g.lineWidth = 1 + r() * 1.5; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); } });
  strawTex.wrapS = strawTex.wrapT = THREE.RepeatWrapping;
  const baleG = new THREE.CylinderGeometry(0.72, 0.72, 1.2, 18, 1).rotateZ(Math.PI / 2), baleM = new THREE.MeshStandardMaterial({ map: strawTex, roughness: 0.95 });
  const tapeTex = canvasTex(128, 16, (g, w, h) => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#fff' : '#d01a20'; g.fillRect(i * 16, 0, 16, h); } }); tapeTex.wrapS = THREE.RepeatWrapping;
  const tapeM = new THREE.MeshStandardMaterial({ map: tapeTex, roughness: 0.7, side: THREE.DoubleSide }), poleM = new THREE.MeshStandardMaterial({ color: 0xdedad0, roughness: 0.8 });
  const mountain = cfg.profile === 'mountain';
  const items = { board: [], post: [], back: [], bale: [], pole: [], marker: [], guardPost: [], reflector: [] }, tapePos = [], tapeUv = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0), S1 = new THREE.Vector3(1, 1, 1);
  const at = (x, y, z, yaw) => m4.compose(new THREE.Vector3(x, hf.groundAt(x, z) + y, z), q.setFromAxisAngle(UP, yaw), S1).clone();
  const atY = (x, y, z, yaw) => m4.compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(UP, yaw), S1).clone();
  // Frequent red/white delineators make the narrow road readable through the dense tree corridor, as on real stages.
  for (let i = startI + 18; i < finishI - 12; i += 22) {
    const [px, pz] = P[i], [lx, lz] = left(i), wobble = (rng() - 0.5) * 0.12;
    for (const side of [-1, 1]) { const d = 2.18 + wobble, x = px + lx * d * side, z = pz + lz * d * side; items.marker.push(at(x, 0, z, Math.atan2(T[i][0], T[i][1]))); }
  }
  const wide = new Float32Array(N); for (const c of corners) if (c.R < 40) for (let i = Math.max(0, c.s - 10); i <= Math.min(N - 1, c.e + 10); i++) wide[i] = 1;
  const fall = new Uint8Array(N), railed = new Uint8Array(N);
  if (mountain || cfg.walls) { for (let i = startI + 10; i < finishI - 10; i += 4) { const [px, pz] = P[i], [lx, lz] = left(i), s = DROP[i], y = hf.groundAt(px, pz); fall[i] = wide[i] || y - hf.groundAt(px + lx * s * 7, pz + lz * s * 7) > (cfg.walls ? 1.4 : 2.2) ? 1 : 0; }
    for (let i = startI + 10; i < finishI - 10; i += 4) for (let k = i - 16; k <= i + 16; k += 4) if (fall[k]) { railed[i] = 1; break; } }
  // the guardrail and the walls run unbroken: one section swept along each stretch where the hill falls away (a change of
  // side starts a new run), set back from the edge by an offset that eases out round the switchbacks, its height smoothed
  // along the run. A rail's ends turn down and away into the ground; a wall's are closed off with its own stone.
  const wideS = new Float32Array(N); for (let i = 0; i < N; i++) { let a = 0, c = 0; for (let k = Math.max(0, i - 14); k <= Math.min(N - 1, i + 14); k += 2) { a += wide[k]; c++; } wideS[i] = a / c; }
  const isRailed = i => i >= startI + 10 && i < finishI - 10 && railed[i - (i - startI - 10) % 4] === 1;
  const runs = []; if (mountain || cfg.walls) { let cur = null; for (let i = startI + 10; i < finishI - 10; i += 2) { if (isRailed(i) && (!cur || DROP[i] === cur.side)) { if (!cur) runs.push(cur = { side: DROP[i], idx: [] }); cur.idx.push(i); } else cur = null; } }
  const line = (run, rd0, base) => { const pts = run.idx.map(i => { const [px, pz] = P[i], [lx, lz] = left(i), s = run.side, rd = rd0 + 0.75 * wideS[i], x = px + lx * s * rd, z = pz + lz * s * rd;
      return { x, z, y: base(px, pz, x, z), rx: -lx * s, rz: -lz * s }; });
    for (let pass = 0; pass < 3; pass++) for (let k = 1; k + 1 < pts.length; k++) pts[k].y = (pts[k - 1].y + 2 * pts[k].y + pts[k + 1].y) / 4;
    return pts; };
  // (a closed profile [u toward the road, v up] swept along the points; uv: metres along, metres round the profile)
  const sweep = (pts, prof, out, cap) => { const np = prof.length, perim = [0]; for (let j = 1; j <= np; j++) perim.push(perim[j - 1] + Math.hypot(prof[j % np][0] - prof[j - 1][0], prof[j % np][1] - prof[j - 1][1]));
    let along = 0, v0 = out.pos.length / 3;
    pts.forEach((p, k) => { if (k) along += Math.hypot(p.x - pts[k - 1].x, p.z - pts[k - 1].z);
      for (let j = 0; j <= np; j++) { const [u, v] = prof[j % np]; out.pos.push(p.x + p.rx * u, p.y + v, p.z + p.rz * u); out.uv.push(along / 1.4, perim[j] / 1.4); } });
    for (let k = 0; k + 1 < pts.length; k++) for (let j = 0; j < np; j++) { const a = v0 + k * (np + 1) + j, b = a + np + 1; out.idx.push(a, b, a + 1, a + 1, b, b + 1); }
    if (cap) for (const k of [0, pts.length - 1]) { const p = pts[k], c = out.pos.length / 3; out.pos.push(p.x, p.y + 0.15, p.z); out.uv.push(0, 0);
      for (let j = 0; j < np; j++) { const a = v0 + k * (np + 1) + j; out.idx.push(c, a, a + 1); } } };
  const rails = { pos: [], uv: [], idx: [] }, walls = { pos: [], uv: [], idx: [] };
  if (mountain) {
    const W = [[0, -0.155], [0.025, -0.155], [0.08, -0.105], [0.08, -0.055], [0.035, 0], [0.08, 0.055], [0.08, 0.105], [0.025, 0.155], [0, 0.155], [0, 0.11], [0.05, 0.075], [0.05, 0.035], [0.012, 0], [0.05, -0.035], [0.05, -0.075], [0, -0.11]];
    for (const run of runs) { if (run.idx.length < 3) continue;
      const pts = line(run, 2.5, (px, pz) => hf.groundAt(px, pz) + 0.6);
      // (the ends: on along the road another 4 m, down into the ground and turned away from the road)
      for (const [e, f] of [[0, 1], [pts.length - 1, pts.length - 2]]) { const a = pts[e], b = pts[f], dx = a.x - b.x, dz = a.z - b.z, l = Math.hypot(dx, dz) || 1, ext = [];
        for (const t of [1.5, 3, 4.2]) { const x = a.x + dx / l * t - a.rx * t * 0.09, z = a.z + dz / l * t - a.rz * t * 0.09; ext.push({ x, z, y: lerp(a.y, hf.groundAt(x, z) + 0.05, t / 4.2), rx: a.rx, rz: a.rz }); }
        if (e === 0) pts.unshift(...ext.reverse()); else pts.push(...ext); }
      sweep(pts, W, rails, false);
      pts.forEach((p, k) => { if (k < 3 || k > pts.length - 4) return; const gx = p.x - p.rx * 0.11, gz = p.z - p.rz * 0.11, gy = Math.min(p.y - 0.6, hf.groundAt(gx, gz)), ph = p.y + 0.15 - gy + 0.25;
        if (k % 2 === 0) items.guardPost.push(m4.compose(new THREE.Vector3(gx, gy - 0.25 + ph / 2, gz), q.setFromAxisAngle(UP, Math.atan2(p.rx, p.rz)), new THREE.Vector3(1, ph, 1)).clone());
        if (k % 10 === 5) items.reflector.push(atY(gx, p.y + 0.3, gz, Math.atan2(p.rx, p.rz)));
        const n = pts[k + 1]; if (n) { const mx = (p.x + n.x) / 2, mz = (p.z + n.z) / 2, l = Math.hypot(n.x - p.x, n.z - p.z); addBox(mx, mz, 0.1, l / 2 + 0.15, Math.atan2(n.x - p.x, n.z - p.z), p.y - 0.8, p.y + 0.35); } }); }
  }
  if (cfg.walls) {
    const Wp = [[-0.24, -0.35], [0.24, -0.35], [0.24, 0.48], [0.17, 0.62], [-0.17, 0.62], [-0.24, 0.48]];
    for (const run of runs) { if (run.idx.length < 3) continue;
      const pts = line(run, 2.79, (px, pz, x, z) => Math.min(hf.groundAt(px, pz) - 0.05, hf.groundAt(x, z)));
      sweep(pts, Wp.map(([u, v]) => [-u, v]), walls, true);
      for (let k = 0; k + 1 < pts.length; k++) { const p = pts[k], n = pts[k + 1], l = Math.hypot(n.x - p.x, n.z - p.z); addBox((p.x + n.x) / 2, (p.z + n.z) / 2, 0.24, l / 2 + 0.1, Math.atan2(n.x - p.x, n.z - p.z), p.y - 0.3, p.y + 0.62); } }
  }
  for (const c of corners) {
    if (c.R > 60) continue; // (chevrons only where a bend can catch you out)
    const out = i => { const [lx, lz] = left(i); return [-lx * c.dir, -lz * c.dir]; }; // (the corner's outside)
    // boards along the outside, facing the road, from before the corner to its exit
    const from = Math.max(0, c.apex - (c.R < 30 ? 10 : 6)), to = Math.min(N - 1, c.apex + (c.R < 30 ? 10 : 6)), n = c.R < 30 ? 3 : 1;
    for (let k = 0; k <= n; k++) { const i = Math.round(from + (to - from) * k / n), [ox, oz] = out(i), [px, pz] = P[i], d = 8.8, x = px + ox * d, z = pz + oz * d, yaw = Math.atan2(-ox, -oz);
      items.board.push([at(x, 1.05, z, yaw), c.dir]); items.back.push(at(x + ox * 0.012, 1.05, z + oz * 0.012, yaw + Math.PI)); items.post.push(at(x + Math.cos(yaw) * 0.45, 0, z - Math.sin(yaw) * 0.45, yaw), at(x - Math.cos(yaw) * 0.45, 0, z + Math.sin(yaw) * 0.45, yaw));
      const gy = hf.groundAt(x, z); addBox(x, z, 0.7, 0.12, yaw, gy, gy + 1.4); }
    if (c.R > 45 || mountain) continue;
    // straw bales on the outside of the tight ones, tape on poles behind
    const nb = c.R < 20 ? 7 : 4;
    for (let k = 0; k < nb; k++) { const i = clamp(c.apex + Math.round((k - (nb - 1) / 2) * 2.6), 0, N - 1), [ox, oz] = out(i), [px, pz] = P[i], d = 7.9 + rng() * 0.3, x = px + ox * d, z = pz + oz * d;
      items.bale.push(at(x, 0.72, z, Math.atan2(T[i][0], T[i][1]) + Math.PI / 2 + (rng() - 0.5) * 0.15)); const gy = hf.groundAt(x, z); addCircle(x, z, 0.75, gy, gy + 1.4); }
    if (c.R > 26) continue; // (tape behind the bales only at the hairpins)
    let prev = null;
    for (let i = Math.max(0, c.s - 20); i <= Math.min(N - 1, c.e + 20); i += 6) { const ii = i, [ox, oz] = out(ii), [px, pz] = P[ii], x = px + ox * 11.5, z = pz + oz * 11.5;
      items.pole.push(at(x, 0, z, 0)); if (prev) tape(prev, [x, z]); prev = [x, z]; }
  }
  // the spectators' tape: a line of poles between them and the road
  for (const st of sites) { let prev = null; const dx = st.x - P[st.i][0], dz = st.z - P[st.i][1], dl = Math.hypot(dx, dz);
    for (let i = st.i - 10; i <= st.i + 10; i += 4) { const x = P[i][0] + dx / dl * 7, z = P[i][1] + dz / dl * 7; items.pole.push(at(x, 0, z, 0)); if (prev) tape(prev, [x, z]); prev = [x, z]; } }
  function tape(a, b) { const l = Math.hypot(b[0] - a[0], b[1] - a[1]), u = l / 2, ya = hf.groundAt(a[0], a[1]), yb = hf.groundAt(b[0], b[1]); for (const y of [0.85]) { const h = 0.05, v = [[a[0], ya + y - h, a[1]], [b[0], yb + y - h, b[1]], [b[0], yb + y + h, b[1]], [a[0], ya + y + h, a[1]]]; const base = tapePos.length / 3; for (const p of [v[0], v[1], v[2], v[0], v[2], v[3]]) tapePos.push(...p); tapeUv.push(0, 0, u, 0, u, 1, 0, 0, u, 1, 0, 1); } }
  const inst = (geo, mat, list, shadow = true) => { if (!list.length) return; const m = new THREE.InstancedMesh(geo, mat, list.length); list.forEach((x, i) => m.setMatrixAt(i, x)); m.castShadow = shadow; m.receiveShadow = true; group.add(m); return m; };
  inst(boardG, boardR, items.board.filter(b => b[1] < 0).map(b => b[0])); inst(boardG, boardL, items.board.filter(b => b[1] > 0).map(b => b[0]));
  inst(new THREE.PlaneGeometry(1.32, 0.67), backM, items.back, false); inst(postG, postM, items.post); inst(baleG, baleM, items.bale);
  inst(new THREE.CylinderGeometry(0.025, 0.025, 1.0, 6).translate(0, 0.5, 0), poleM, items.pole, false);
  const markerWhite = new THREE.MeshStandardMaterial({ color: 0xe8e8df, roughness: 0.88 }), markerRed = new THREE.MeshStandardMaterial({ color: 0xc9272f, roughness: 0.76 });
  const markerBase = inst(new THREE.BoxGeometry(0.075, 1.05, 0.075).translate(0, 0.525, 0), markerWhite, items.marker, false);
  const markerBand = inst(new THREE.BoxGeometry(0.09, 0.22, 0.09).translate(0, 0.72, 0), markerRed, items.marker, false);
  if (markerBase) markerBase.name = 'rally-marker-posts'; if (markerBand) markerBand.name = 'rally-marker-bands';
  if (mountain) {
    const steel = new THREE.MeshStandardMaterial({ color: 0xaeb6ba, roughness: 0.48, metalness: 0.72, side: THREE.DoubleSide }), darkSteel = new THREE.MeshStandardMaterial({ color: 0x70787c, roughness: 0.62, metalness: 0.5 }), orange = new THREE.MeshStandardMaterial({ color: 0xff8b18, emissive: 0x6b2300, emissiveIntensity: 0.35, roughness: 0.55 });
    if (rails.idx.length) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(rails.pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(rails.uv, 2)); g.setIndex(rails.idx); g.computeVertexNormals();
      const m = new THREE.Mesh(g, steel); m.name = 'rally-mountain-guardrails'; m.castShadow = m.receiveShadow = true; group.add(m); }
    const posts = inst(new THREE.BoxGeometry(0.1, 1, 0.15), darkSteel, items.guardPost); if (posts) posts.name = 'rally-mountain-guardrail-posts';
    const reflectors = inst(new THREE.BoxGeometry(0.16, 0.12, 0.05), orange, items.reflector, false); if (reflectors) reflectors.name = 'rally-mountain-reflectors';
  }
  if (walls.idx.length) { // (the stone photo laid on in metres along the wall and round it, so the courses keep their size)
    const sw = new THREE.MeshStandardMaterial({ map: phTex('japanese_stone_wall', 'diff', '1k', true), normalMap: phTex('japanese_stone_wall', 'nor_gl', '1k', false, NFLAT), roughness: 0.95, color: 0xe2d8c6, side: THREE.DoubleSide });
    for (const t of [sw.map, sw.normalMap]) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(walls.pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(walls.uv, 2)); g.setIndex(walls.idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, sw); m.name = 'rally-stone-walls'; m.castShadow = m.receiveShadow = true; group.add(m); }
  if (tapePos.length) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(tapePos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(tapeUv, 2)); g.computeVertexNormals(); group.add(new THREE.Mesh(g, tapeM)); }
  const chq = canvasTex(512, 64, (g, w, h) => { for (let i = 0; i < 32; i++) for (let j = 0; j < 4; j++) { g.fillStyle = (i + j) % 2 ? '#f2f2ee' : '#1a1a1a'; g.fillRect(i * 16, j * 16, 16, 16); } });
  const archM = new THREE.MeshStandardMaterial({ color: 0x2a2f38, roughness: 0.6, metalness: 0.3 });
  const archAt = (i0, label, gold) => { const [px, pz] = P[i0], [tx, tz] = T[i0], [lx, lz] = left(i0), yaw = Math.atan2(tx, tz);
    const banner = canvasTex(1024, 128, (g, w, h) => { g.fillStyle = gold ? '#6e1719' : '#10161f'; g.fillRect(0, 0, w, h); for (let i = 0; i < 16; i++) for (let j = 0; j < 4; j++) { g.fillStyle = (i + j) % 2 ? '#fff' : '#111'; g.fillRect(i * 8, j * 32, 8, 32); g.fillRect(w - 128 + i * 8, j * 32, 8, 32); }
      g.fillStyle = '#fff'; g.font = '700 68px "Segoe UI", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, w / 2, h / 2 + 2); g.fillStyle = gold ? '#ffe06a' : '#e2b13c'; g.fillRect(140, h - 10, w - 280, 4); });
    const bannerM = new THREE.MeshStandardMaterial({ map: banner, roughness: 0.7 }), arch = new THREE.Group(), gy = hf.groundAt(px, pz); arch.position.set(px, gy, pz); arch.rotation.y = yaw; group.add(arch);
    for (const sd of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.35, 5.4, 0.35), archM); post.position.set(sd * 6.2, 2.7, 0); post.castShadow = true; arch.add(post); const x = px + lx * sd * 6.2, z = pz + lz * sd * 6.2, py = hf.groundAt(x, z); addBox(x, z, 0.25, 0.25, yaw, py, py + 5.4); }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(12.8, 0.3, 0.3), archM); beam.position.set(0, 5.3, 0); beam.castShadow = true; arch.add(beam);
    for (const sd of [-1, 1]) { const ban = new THREE.Mesh(new THREE.PlaneGeometry(11.6, 1.45), bannerM); ban.position.set(0, 4.45, sd * 0.16); ban.rotation.y = sd < 0 ? Math.PI : 0; ban.castShadow = true; arch.add(ban); }
    const line = new THREE.Mesh(new THREE.PlaneGeometry(7.6, 0.95).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: chq, roughness: 0.85, transparent: true, opacity: 0.88, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }));
    line.position.set(0, 0.02, 0); line.receiveShadow = true; arch.add(line); arch.updateMatrixWorld(true); };
  archAt(startI, 'START', false); archAt(finishI, 'FINISH', true);
  let update = null;
  if (mountain) {
    const count = 1100, pos = new Float32Array(count * 3), drift = new Float32Array(count);
    for (let i = 0; i < count; i++) { pos[i * 3] = (rng() * 2 - 1) * 62; pos[i * 3 + 1] = rng() * 48 - 10; pos[i * 3 + 2] = (rng() * 2 - 1) * 62; drift[i] = 2.8 + rng() * 4.8; }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const st = canvasTex(32, 32, g => { const r = g.createRadialGradient(16, 16, 0, 16, 16, 15); r.addColorStop(0, '#fff'); r.addColorStop(0.35, '#fff'); r.addColorStop(1, '#fff0'); g.fillStyle = r; g.fillRect(0, 0, 32, 32); });
    const snow = new THREE.Points(sg, new THREE.PointsMaterial({ map: st, color: 0xf7fbff, size: 0.16, transparent: true, opacity: 0.82, alphaTest: 0.03, depthWrite: false })); snow.name = 'rally-snowfall'; snow.frustumCulled = false; group.add(snow);
    update = dt => { snow.position.copy(camera.position); for (let i = 0; i < count; i++) { const o = i * 3; pos[o] += dt * 0.9; pos[o + 1] -= dt * drift[i]; if (pos[o] > 62) pos[o] -= 124; if (pos[o + 1] < -10) pos[o + 1] += 48; } sg.attributes.position.needsUpdate = true; };
  }
  return { group, update };
}

// The supplied ElevenLabs recording is one audio sprite: 136 clean phrases and their timing manifest. Keeping it whole
// avoids a request per word; linked notes are queued from complete phrases, never assembled word by word.
function coDriver() {
  const BASE = 'Modeleaut/sounds/rally-pilot', V = '?v=20261025b', raw = Promise.all([
    fetch(BASE + '.json' + V).then(r => { if (!r.ok) throw new Error(`pilot manifest ${r.status}`); return r.json(); }),
    fetch(BASE + '.mp3' + V).then(r => { if (!r.ok) throw new Error(`pilot audio ${r.status}`); return r.arrayBuffer(); }),
  ]);
  let data = null, buffer = null, decode = null, serial = 0, active = [];
  const norm = s => s.toLocaleLowerCase('pl-PL').replace(/[.!?]+$/g, '').replace(/\s+/g, ' ').trim();
  const fallback = text => { if (!text || !('speechSynthesis' in window)) return; const u = new SpeechSynthesisUtterance(text), vs = speechSynthesis.getVoices(); u.voice = vs.find(v => /^pl\b/i.test(v.lang)) || null; u.lang = 'pl-PL'; u.rate = 1.22; u.pitch = 0.86; u.volume = 0.92; speechSynthesis.speak(u); };
  const ready = async () => { if (!audio.ctx) return null; if (buffer && data) return { data, buffer }; if (!decode) decode = raw.then(async ([m, bytes]) => { data = m; buffer = await audio.ctx.decodeAudioData(bytes.slice(0)); return { data, buffer }; }).catch(e => { console.warn('rally pilot:', e); return null; }); return decode; };
  const stop = () => { serial++; for (const s of active) try { s.stop(); } catch (e) {} active = []; if ('speechSynthesis' in window) speechSynthesis.cancel(); };
  const keysFor = (text, clips) => {
    const byName = new Map(Object.keys(clips).map(k => [norm(k), k])), get = s => byName.get(norm(s));
    const out = [], push = s => { const k = get(s); if (k) out.push(k); return !!k; };
    let rest = text.trim().replace(/[.!?]+$/g, '');
    const distance = rest.match(/^(Za (?:trzydzieści|pięćdziesiąt|osiemdziesiąt|sto(?: pięćdziesiąt)?|dwieście|trzysta|czterysta|pięćset)),\s*(.+)$/i);
    if (distance) { push(distance[1]); rest = distance[2]; }
    if (push(rest)) return out;
    const linked = rest.match(/^(.+?),\s*w\s+((?:lewy|prawy)\s+.+)$/i);
    if (linked) { push(linked[1]); push(linked[2][0].toUpperCase() + linked[2].slice(1)); return out; }
    const changing = rest.match(/^((?:Lewy|Prawy)\s+\d)(?:\s+długi)?,\s*(zaciska|otwiera)\s+(\d)/i);
    if (changing) { const full = `${changing[1]}, ${changing[2].toLowerCase()} ${changing[3]}`; if (!push(full)) push(rest.split(',')[0]); return out; }
    push(rest.split(',')[0]);
    return out;
  };
  const say = async text => {
    if (!text) return; const my = ++serial, pack = await ready(); if (my !== serial) return;
    if (!pack) { fallback(text); return; }
    const keys = keysFor(text, pack.data.clips); if (!keys.length) { fallback(text); return; }
    for (const s of active) try { s.stop(); } catch (e) {} active = [];
    const ctx = audio.ctx, bus = ctx.createGain(), hp = ctx.createBiquadFilter(), presence = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter(), drive = ctx.createWaveShaper(), comp = ctx.createDynamicsCompressor();
    bus.gain.value = 1.34; hp.type = 'highpass'; hp.frequency.value = 280; hp.Q.value = 0.7; presence.type = 'peaking'; presence.frequency.value = 1750; presence.Q.value = 1.1; presence.gain.value = 5.5; lp.type = 'lowpass'; lp.frequency.value = 3650; lp.Q.value = 0.8;
    const curve = new Float32Array(257); for (let i = 0; i < curve.length; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 1.8) / Math.tanh(1.8); } drive.curve = curve; drive.oversample = '2x';
    comp.threshold.value = -23; comp.knee.value = 5; comp.ratio.value = 4.5; comp.attack.value = 0.003; comp.release.value = 0.11;
    bus.connect(hp).connect(presence).connect(lp).connect(drive).connect(comp).connect(audio.master);
    let at = ctx.currentTime + 0.025, left = keys.length;
    for (const key of keys) { let [offset, duration] = pack.data.clips[key]; if (key === 'Trzy') duration = Math.min(duration, 0.48); else if (key === 'Dwa') duration = Math.min(duration, 0.74); else if (key === 'Jeden') duration = Math.min(duration, 0.55); // countdown words end before the next word in the source recording
      const src = ctx.createBufferSource(); src.buffer = pack.buffer; src.connect(bus); src.start(at, offset, duration); src.onended = () => { const i = active.indexOf(src); if (i >= 0) active.splice(i, 1); if (--left === 0) bus.disconnect(); }; active.push(src); at += Math.max(0.25, duration - 0.04); }
    api.last = text; api.keys = keys; api.loaded = true;
  };
  const api = { say, stop, loaded: false, last: '', keys: [] };
  raw.then(() => { api.fetched = true; }).catch(() => {});
  return api;
}

// A real point-to-point special stage: start marshal, mandatory split gates, finish timing and a Polish co-driver.
function stageClock(N, nearAt, distAt, corners, features, startI, finishI, spawn, cfg) {
  const host = document.createElement('div'); host.id = 'stageClock';
  host.style.cssText = 'position:fixed;inset:0;z-index:9;color:#fff;font:600 15px/1.25 "Segoe UI",system-ui,sans-serif;text-shadow:0 2px 5px #000;pointer-events:none;letter-spacing:.02em';
  host.innerHTML = `<div data-race style="position:absolute;left:50%;top:14px;transform:translateX(-50%);min-width:260px;padding:9px 16px;border-radius:7px;background:#090d13bd;border:1px solid #ffffff28;text-align:center;box-shadow:0 8px 24px #0008"></div><div data-count style="position:absolute;left:50%;top:32%;transform:translate(-50%,-50%);font:900 92px/1 Impact,Haettenschweiler,sans-serif;color:#fff;text-shadow:0 4px 0 #151515,0 0 28px #000;display:none"></div><div data-note style="position:absolute;left:50%;top:116px;transform:translateX(-50%);min-width:330px;padding:10px 18px;border-radius:7px;background:#10151ee8;border-left:6px solid #e1262f;text-align:center;font:800 24px/1.08 'Segoe UI',system-ui;opacity:0;transition:opacity .12s"></div>`;
  document.body.appendChild(host);
  const raceEl = host.querySelector('[data-race]'), countEl = host.querySelector('[data-count]'), noteEl = host.querySelector('[data-note]');
  let best = 0; try { best = +localStorage.getItem(cfg.bestKey) || 0; } catch (e) {}
  const grade = r => r < 15 ? 0 : r < 24 ? 1 : r < 34 ? 2 : r < 48 ? 3 : r < 68 ? 4 : r < 105 ? 5 : 6; // (0: a hairpin)
  const phrase = c => grade(c.R) === 0 ? `${c.dir > 0 ? 'Lewy' : 'Prawy'} nawrót` : `${c.dir > 0 ? 'Lewy' : 'Prawy'} ${grade(c.R)}${c.e - c.s > 42 ? ' długi' : ''}`;
  const raw = corners.filter(c => c.apex > startI + 70 && c.apex < finishI - 35).map(c => ({ at: c.apex, end: c.e, text: phrase(c), dir: c.dir, grade: grade(c.R), long: c.e - c.s > 42, kind: 'turn' }));
  for (const f of features) if (f.at > startI + 70 && f.at < finishI - 35) raw.push(f); raw.sort((a, b) => a.at - b.at);
  const notes = [];
  for (let i = 0; i < raw.length; i++) { const a = raw[i], b = raw[i + 1];
    if (a.kind === 'turn' && b && b.kind === 'turn' && b.at - a.end < 85) { const tail = a.dir === b.dir && b.grade !== a.grade && a.grade > 0 && b.grade > 0 ? `${b.grade < a.grade ? 'zaciska' : 'otwiera'} ${b.grade}${b.long ? ' długi' : ''}` : `w ${b.text.toLowerCase()}`; notes.push({ at: a.at, end: b.end, text: `${a.text}, ${tail}`, dir: a.dir, grade: a.grade, linked: true, kind: 'turn' }); i++; }
    else notes.push(a);
  }
  const checkpoints = []; for (let i = startI + 300; i < finishI - 120; i += 300) checkpoints.push(i);
  const st = { phase: 'waiting', t: 0, progress: startI, countdown: 3.8, countSaid: 4, checkpoint: 0, note: 0, noteText: '', noteT: 0, result: 0, newBest: false, frame: 0 };
  const fmt = t => { const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2); };
  const pilot = coDriver(), say = text => pilot.say(text), stopVoice = () => pilot.stop();
  const lockAtStart = car => { const cs = car.st; cs.pos.set(spawn.x, car.world.groundAt(spawn.x, spawn.z) + car.spec.cg[1] + 0.01, spawn.z); cs.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), spawn.yaw); cs.vel.set(0, 0, 0); cs.ang.set(0, 0, 0); cs.throttle = 0; cs.brake = 1; cs.hand = cs.handEff = 0; for (const w of car.wheels) w.w = 0; };
  const reset = () => { stopVoice(); Object.assign(st, { phase: 'waiting', t: 0, progress: startI, countdown: 3.8, countSaid: 4, checkpoint: 0, note: 0, noteText: '', noteT: 0, result: 0, newBest: false, frame: 0 }); };
  const showNote = (n, distance) => { const lead = distance > 115 ? 'Za sto, ' : distance > 88 ? 'Za osiemdziesiąt, ' : ''; st.noteText = n.text; st.noteT = 3.4; const special = n.kind === 'feature'; noteEl.innerHTML = `<span style="display:inline-block;width:29px;color:${special ? '#fff075' : n.dir > 0 ? '#ffcf45' : '#60baff'}">${special ? '▲' : n.dir > 0 ? '↶' : '↷'}</span>${n.text}`; say(lead + n.text); };
  const finish = () => { st.phase = 'finished'; st.result = st.t; st.newBest = !best || st.result < best; if (st.newBest) { best = st.result; try { localStorage.setItem(cfg.bestKey, String(best)); } catch (e) {} } stopVoice(); say(st.newBest ? 'Nowy rekord' : 'Meta'); st.noteText = ''; st.noteT = 0; };
  const api = { state: st, notes, checkpoints, pilot, reset,
    update(dt, car) {
      if (!car) { host.style.display = 'none'; return; }
      host.style.display = car.driving ? '' : 'none';
      if (st.phase === 'waiting') { lockAtStart(car); if (car.inputOn) { st.phase = 'countdown'; st.countdown = 3.8; st.countSaid = 4; } }
      else if (st.phase === 'countdown') { lockAtStart(car); st.countdown -= dt; const n = Math.ceil(st.countdown); if (n <= 3 && n > 0 && n < st.countSaid) { st.countSaid = n; say(['', 'Jeden', 'Dwa', 'Trzy'][n]); }
        if (st.countdown <= 0) { st.phase = 'running'; st.countdown = 0; car.st.brake = 0; say('Start'); } }
      else if (st.phase === 'running') {
        st.t += dt; const p = car.st.pos, i = nearAt(p.x, p.z), onRoad = i >= 0 && distAt(p.x, p.z) < 24;
        if (onRoad && i >= st.progress - 35 && i <= st.progress + 380) st.progress = Math.max(st.progress, Math.min(i, finishI));
        while (st.checkpoint < checkpoints.length && st.progress >= checkpoints[st.checkpoint] - 18) st.checkpoint++;
        const speed = car.st.vel.length(), lead = clamp(72 + speed * 2.15, 72, 155);
        while (st.note < notes.length && st.progress > notes[st.note].end + 70) st.note++;
        if (st.note < notes.length && notes[st.note].at - st.progress <= lead) { showNote(notes[st.note], notes[st.note].at - st.progress); st.note++; }
        if (onRoad && i >= finishI - 5 && st.checkpoint === checkpoints.length) finish();
      }
      if (st.noteT > 0) st.noteT -= dt;
      noteEl.style.opacity = st.noteT > 0 && st.phase === 'running' ? '1' : '0';
      const cd = st.phase === 'countdown' ? Math.min(3, Math.max(1, Math.ceil(st.countdown))) : st.phase === 'running' && st.t < 0.7 ? 'START!' : '';
      countEl.style.display = cd ? '' : 'none'; countEl.textContent = cd;
      if (++st.frame % 3) return;
      const km = Math.max(0, finishI - st.progress) / 1000, pct = clamp((st.progress - startI) / (finishI - startI), 0, 1);
      if (st.phase === 'waiting') raceEl.innerHTML = `<div style="font-size:18px">${cfg.name.toUpperCase()} · ${(cfg.target / 1000).toFixed(1)} KM</div><div style="opacity:.75;font-size:12px">Kliknij, aby rozpocząć odliczanie</div>`;
      else if (st.phase === 'finished') raceEl.innerHTML = `<div style="color:#ffd54d;font:800 14px 'Segoe UI'">${st.newBest ? 'NOWY REKORD' : 'META'}</div><div style="font:800 34px/1.05 'Segoe UI'">${fmt(st.result)}</div><div style="opacity:.72;font-size:12px">R — ponowny start · rekord ${fmt(best)}</div>`;
      else raceEl.innerHTML = `<div style="font:800 31px/1.05 'Segoe UI'">${fmt(st.t)}</div><div style="height:3px;background:#ffffff28;margin:6px 0 5px"><i style="display:block;height:100%;width:${(pct * 100).toFixed(1)}%;background:#e1252d"></i></div><div style="opacity:.78;font-size:12px">${km.toFixed(2)} km do mety · PK ${st.checkpoint}/${checkpoints.length}${best ? ' · rekord ' + fmt(best) : ''}</div>`;
    },
  };
  return api;
}
