// "Wildlands" — lake valley, conifer forests, mountains.
import { THREE, Q, clamp, lerp, smoothstep, mulberry32, tick, fbm, erosion, loadTex, phTex, NFLAT, loadModel, extractParts, normalizeParts, Scatter, addCircle, clearColliders, decimate } from './core.js';
import { Heightfield, terrainMaterial, buildTerrainMeshes, buildGrass, buildWater, buildStream, farForestAt } from './terrain.js';
import { buildTrees, buildBushes, buildLogs, sakuraColor, bushColor, hydraColor } from './trees.js';
import { plantForest, forestFloor, moistureField, makeTree, crownR } from './ecology.js';
import { GeoBuilder, dock, shrine, cottage, bench, lantern, ruin, viewpoint, hokora, footbridge, flushLandmarks } from './landmarks.js';

export const meta = { name: 'Wildlands', startHour: 16.4, sunAzimuth: 2.2, life: { flockCenter: { x: 40, y: 0, z: -60 } } };
const LAKE_X = 40, LAKE_Z = -60;

function baseHeight(x, z) {
  const wx = x + 70 * fbm(x * 0.0021 + 3.1, z * 0.0021 + 7.7, 3);
  const wz = z + 70 * fbm(x * 0.0021 - 5.3, z * 0.0021 + 1.9, 3);
  const d = Math.hypot(wx, wz * 0.85);
  const mm = smoothstep(380, 1150, d);
  const e = erosion(wx * 0.0017 + 11.3, wz * 0.0017 - 4.2) * 0.5 + 0.5;
  const hills = fbm(wx * 0.0055, wz * 0.0055, 5);
  let h = 7 + hills * (10 - mm * 4) + e * e * (38 + 380 * mm) + mm * 30;
  // beyond the valley's own mountains, higher ranges rise ridge behind ridge toward the horizon (snow-capped)
  const far = smoothstep(1350, 4800, d);
  if (far > 0) { const r = erosion(wx * 0.00042 + 2.1, wz * 0.00042 - 7.3, 6) * 0.5 + 0.5; h += far * (60 + r * r * 1150 + e * 120); }
  const ld = Math.hypot(wx - LAKE_X, (wz - LAKE_Z) * 1.3) + fbm(x * 0.008, z * 0.008, 2) * 45;
  const lm = smoothstep(290, 70, ld);
  return h * (1 - lm) - 10 * lm;
}

// ---------------------------------------------------------------- streams
// A few streams run down from the hills into the lake: traced downhill over the natural ground (with some meander and a
// pull toward the lake), then cut into the terrain as rounded channels whose bed never runs uphill.
const streams = [], SGRID = new Map(), SG = 24;
function traceStreams() {
  const rng = mulberry32(8080);
  for (let tries = 0; tries < 80 && streams.length < 3; tries++) {
    const a = rng() * Math.PI * 2, d = 480 + rng() * 420;
    let x = LAKE_X + Math.cos(a) * d, z = LAKE_Z + Math.sin(a) * d;
    if (Math.abs(x) > 940 || Math.abs(z) > 940) continue;
    const h0 = baseHeight(x, z); if (h0 < 40 || h0 > 150) continue;
    const pts = []; let dx = 0, dz = 0, ok = false, prev = h0, climb = 0;
    for (let i = 0; i < 1100; i++) {
      const h = baseHeight(x, z); pts.push({ x, z, h });
      if (h < 0.2) { ok = true; break; }
      // over flats and out of hollows the water keeps heading for the lake (the bed is cut through the rise)
      climb = h > prev - 0.02 ? Math.min(climb + 1, 30) : Math.max(climb - 2, 0); prev = h;
      const e = 3, gx = baseHeight(x + e, z) - baseHeight(x - e, z), gz = baseHeight(x, z + e) - baseHeight(x, z - e);
      let ux = -gx, uz = -gz, L = Math.hypot(ux, uz) || 1; ux /= L; uz /= L;
      const lx = LAKE_X - x, lz = LAKE_Z - z, ll = Math.hypot(lx, lz) || 1, lw = 0.3 + climb * 0.12;
      ux += lx / ll * lw; uz += lz / ll * lw;
      const m = fbm(x * 0.012 + tries * 3.1, z * 0.012, 2) * 1.1 / (1 + climb * 0.2), c = Math.cos(m), sn = Math.sin(m);
      const mx = ux * c - uz * sn, mz = ux * sn + uz * c;
      dx = dx * 0.55 + mx * 0.45; dz = dz * 0.55 + mz * 0.45; const dl = Math.hypot(dx, dz) || 1;
      x += dx / dl * 3; z += dz / dl * 3;
    }
    if (!ok || pts.length < 70) continue;
    // smooth the traced line (descent zig-zags in hollows), then resample it every 3 m
    let P = pts.map(q => ({ x: q.x, z: q.z }));
    for (let it = 0; it < 8; it++) P = P.map((q, i) => i === 0 || i === P.length - 1 ? q : { x: (P[i - 1].x + q.x * 2 + P[i + 1].x) / 4, z: (P[i - 1].z + q.z * 2 + P[i + 1].z) / 4 });
    const RS = [P[0]];
    for (let i = 1; i < P.length; i++) { let a = RS[RS.length - 1]; const b = P[i]; let L = Math.hypot(b.x - a.x, b.z - a.z);
      while (L >= 3) { const t = 3 / L; a = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }; RS.push(a); L = Math.hypot(b.x - a.x, b.z - a.z); } }
    pts.length = 0; for (const q of RS) pts.push({ x: q.x, z: q.z, h: baseHeight(q.x, q.z) });
    if (pts.length < 60) continue;
    const e0 = pts[pts.length - 1];
    if (streams.some(S => { const e1 = S.pts[S.pts.length - 1]; return Math.hypot(e1.x - e0.x, e1.z - e0.z) < 200 || S.pts.some(q => Math.hypot(q.x - pts[0].x, q.z - pts[0].z) < 160); })) continue;
    let bed = 1e9, cut = 0;
    pts.forEach((q, i) => { bed = Math.min(bed - 0.003, q.h - 1.0); q.b = bed; q.W = 3.6 + 4.4 * i / pts.length; q.w = Math.max(bed + 0.5, 0.03); cut = Math.max(cut, q.h - bed); });
    if (cut > 7.5) continue; // would need a gorge: not this one
    streams.push({ pts });
  }
  for (const S of streams) for (let i = 0; i + 1 < S.pts.length; i++) {
    const a = S.pts[i], b = S.pts[i + 1], pad = 14;
    for (let gz = Math.floor((Math.min(a.z, b.z) - pad) / SG); gz <= Math.floor((Math.max(a.z, b.z) + pad) / SG); gz++)
      for (let gx = Math.floor((Math.min(a.x, b.x) - pad) / SG); gx <= Math.floor((Math.max(a.x, b.x) + pad) / SG); gx++) {
        const k = gx * 7919 + gz; if (!SGRID.has(k)) SGRID.set(k, []); SGRID.get(k).push([a, b]);
      }
  }
}
function streamAt(x, z) {
  const list = SGRID.get(Math.floor(x / SG) * 7919 + Math.floor(z / SG)); if (!list) return null;
  let best = null;
  for (const [a, b] of list) {
    const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1, t = clamp(((x - a.x) * dx + (z - a.z) * dz) / L2, 0, 1);
    const d = Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
    if (!best || d < best.d) best = { d, b: lerp(a.b, b.b, t), W: lerp(a.W, b.W, t), w: lerp(a.w, b.w, t) };
  }
  return best;
}
function height(x, z) {
  const h = baseHeight(x, z), s = SGRID.size ? streamAt(x, z) : null;
  if (!s) return h;
  const hw = s.W / 2, bank = hw + 8;
  if (s.d > bank) return h;
  const inner = s.b + Math.pow(Math.min(s.d / hw, 1), 2) * 0.7; // rounded channel
  return Math.min(h, lerp(inner, h, smoothstep(hw, bank, s.d)));
}

export async function build(progress) {
  progress('Tracing streams', 0.01); await tick();
  if (!streams.length) traceStreams();
  const hf = new Heightfield({ world: 2048, grid: 1024, height });
  const { HN, HALF, CELL, GRID } = hf;
  const layers = {
    grass: { d: phTex('aerial_grass_rock', 'diff', '2k', true, [92, 98, 52]), n: phTex('aerial_grass_rock', 'nor_gl', '2k', false, NFLAT), s: 6, tint: [0.95, 1.08, 0.82] },
    forest: { d: phTex('forest_leaves_03', 'diff', '2k', true, [70, 58, 40]), n: phTex('forest_leaves_03', 'nor_gl', '1k', false, NFLAT), s: 3 },
    rock: { d: phTex('rock_face_03', 'diff', '2k', true, [110, 100, 90]), n: phTex('rock_face_03', 'nor_gl', '2k', false, NFLAT), s: 9 },
    shore: { d: phTex('coast_sand_01', 'diff', '2k', true, [140, 125, 100]), n: phTex('coast_sand_01', 'nor_gl', '1k', false, NFLAT), s: 4, tint: [0.78, 0.72, 0.6] },
    urban: { d: phTex('coast_sand_01', 'diff', '2k', true), n: phTex('coast_sand_01', 'nor_gl', '1k', false, NFLAT), s: 4, tint: [1.25, 1.02, 0.72] }, // sandy footpaths
  };
  const models = Promise.all(['rock_moss_set_01', 'boulder_01', 'fern_02', 'shrub_02', 'tree_stump_01', 'dead_tree_trunk'].map(loadModel));

  await hf.generate(p => progress('Sculpting terrain', p * 0.4), 0, 1);
  // forest density
  const FOREST = new Float32Array(HN * HN);
  for (let j = 0; j < HN; j++) {
    for (let i = 0; i < HN; i++) {
      const x = -HALF + i * CELL, z = -HALF + j * CELL, h = hf.H[j * HN + i];
      const f = fbm(x * 0.0042 + 40, z * 0.0042 - 17, 4) * 0.85 + fbm(x * 0.02, z * 0.02, 2) * 0.3;
      let v = smoothstep(-0.02, 0.22, f) * smoothstep(2.5, 6, h) * (1 - smoothstep(140, 195, h)) * smoothstep(0.78, 0.9, hf.gridNormalY(i, j));
      // toward the map edge the woods follow the far-forest mask, so they carry on seamlessly past the boundary
      const edge = smoothstep(HALF - 240, HALF - 20, Math.max(Math.abs(x), Math.abs(z)));
      if (edge > 0) v = lerp(v, farForestAt(x, z, h, 1 - hf.gridNormalY(i, j), 0, 280), edge);
      const st = streamAt(x, z); if (st) v *= smoothstep(st.W / 2 + 0.5, st.W / 2 + 4, st.d); // stream banks stay open
      FOREST[j * HN + i] = v; hf.mask[(j * HN + i) * 4] = v * 255;
    }
    if ((j & 63) === 0) { progress('Growing forests', 0.4 + 0.1 * j / HN); await tick(); }
  }
  // glades: open clearings in the woods (a fallen log, stumps and rocks in each; the biggest hides an old ruin)
  const grng = mulberry32(606), clearings = [], gv = new THREE.Vector3();
  for (let k = 0; k < 1200 && clearings.length < 30; k++) {
    const x = (grng() * 2 - 1) * (HALF - 120), z = (grng() * 2 - 1) * (HALF - 120);
    if (FOREST[hf.idx(x, z)] < 0.6 || clearings.some(c => Math.hypot(c.x - x, c.z - z) < (clearings.length < 16 ? 170 : 110))) continue;
    const h = hf.heightAt(x, z); if (h < 6 || h > 130 || hf.normalAt(x, z, gv).y < 0.9) continue;
    clearings.push({ x, z, r: clearings.length < 16 ? 18 + grng() * 22 : 10 + grng() * 12, h });
  }
  for (const c of clearings) {
    const i0 = Math.max(0, Math.floor((c.x - c.r + HALF) / CELL)), i1 = Math.min(GRID, Math.ceil((c.x + c.r + HALF) / CELL));
    const j0 = Math.max(0, Math.floor((c.z - c.r + HALF) / CELL)), j1 = Math.min(GRID, Math.ceil((c.z + c.r + HALF) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = -HALF + i * CELL, z = -HALF + j * CELL, d = Math.hypot(x - c.x, z - c.z) + fbm(x * 0.05, z * 0.05, 2) * 6;
      const o = j * HN + i; FOREST[o] *= smoothstep(c.r * 0.55, c.r, d); hf.mask[o * 4] = FOREST[o] * 255;
    }
  }
  await hf.bakeAO(p => progress('Growing forests', 0.5 + 0.1 * p));
  // ground moisture (lake shore, stream banks, hollows): drives the woodland mix, ferns and moss; mask A for the ground
  const MOIST = moistureField(hf, { water: 0, streamDist: (x, z) => { const st = streamAt(x, z); return st ? st.d : 1e9; } });
  for (let o = 0; o < HN * HN; o++) hf.mask[o * 4 + 3] = MOIST[o] * 255;
  const nrm = new THREE.Vector3();
  // spawn on the lake shore, facing the water, in a small clearing
  let spawn = null;
  for (let a = 0; a < 64 && !spawn; a++) {
    const ang = 2.2 + a * 0.39;
    for (let r = 330; r > 60; r -= 4) {
      const x = LAKE_X + Math.cos(ang) * r, z = LAKE_Z + Math.sin(ang) * r / 1.3, h = hf.heightAt(x, z);
      if (h > 2.5 && h < 4.5 && hf.normalAt(x, z, nrm).y > 0.94) { spawn = { x, z }; break; }
    }
  }
  spawn = spawn || { x: 0, z: 150 };
  spawn.yaw = Math.atan2(-(LAKE_X - spawn.x), -(LAKE_Z - spawn.z));

  // ---------------------------------------------------------------- landmark sites: dock, shrine, cottage, paths
  const toL = Math.hypot(LAKE_X - spawn.x, LAKE_Z - spawn.z), ldx = (LAKE_X - spawn.x) / toL, ldz = (LAKE_Z - spawn.z) / toL;
  const flatAt = (x, z) => hf.normalAt(x, z, nrm).y;
  // dock: a little to the right of the spawn, starting where the bank meets the water
  let dockS = null;
  for (const side of [9, -9, 16, -16]) {
    let x = spawn.x - ldz * side, z = spawn.z + ldx * side;
    for (let k = 0; k < 60 && hf.heightAt(x, z) > 0.7; k++) { x += ldx; z += ldz; }
    if (hf.heightAt(x, z) <= 0.7 && hf.heightAt(x + ldx * 14, z + ldz * 14) < -0.5) { dockS = { x: x - ldx * 1.5, z: z - ldz * 1.5 }; break; }
  }
  const inStream = (x, z, pad = 0) => { const st = streamAt(x, z); return !!st && st.d < st.W / 2 + 1.2 + pad; };
  const siteSearch = (dMin, dMax, hMin, hMax, flat, fMax) => {
    let best = null, bestScore = 1e9;
    for (let a = 0; a < 96; a++) for (let d = dMin; d <= dMax; d += 6) {
      const ang = a / 96 * Math.PI * 2, x = spawn.x + Math.cos(ang) * d, z = spawn.z + Math.sin(ang) * d, h = hf.heightAt(x, z);
      if (h < hMin || h > hMax || flatAt(x, z) < flat || FOREST[hf.idx(x, z)] > fMax || inStream(x, z, 8)) continue;
      let ok = true; for (const [ox, oz] of [[6, 0], [-6, 0], [0, 6], [0, -6]]) if (hf.heightAt(x + ox, z + oz) < hMin - 0.5 || flatAt(x + ox, z + oz) < flat - 0.03) ok = false;
      if (!ok) continue;
      const lakeD = Math.hypot(x - LAKE_X, (z - LAKE_Z) * 1.3), score = Math.abs(d - (dMin + dMax) / 2) + Math.abs(lakeD - 250) * 0.3;
      if (score < bestScore) { bestScore = score; best = { x, z, h }; }
    }
    return best;
  };
  const shrineS = siteSearch(45, 95, 3.5, 16, 0.93, 0.6);
  const cottageS = siteSearch(95, 170, 4, 45, 0.95, 0.35);
  const sites = [{ x: spawn.x, z: spawn.z, r: 9 }];
  if (dockS) sites.push({ x: dockS.x, z: dockS.z, r: 5 });
  if (shrineS) { shrineS.r = Math.atan2(LAKE_X - shrineS.x, LAKE_Z - shrineS.z); sites.push({ x: shrineS.x, z: shrineS.z, r: 13 }); }
  if (cottageS) { cottageS.r = Math.atan2(spawn.x - cottageS.x, spawn.z - cottageS.z); sites.push({ x: cottageS.x, z: cottageS.z, r: 17 }); }
  // hilltop viewpoint looking back over the lake: the highest flat spot 160-480 m out
  let viewS = null;
  for (let a = 0; a < 72; a++) for (let d = 160; d <= 480; d += 8) {
    const ang = a / 72 * Math.PI * 2, x = spawn.x + Math.cos(ang) * d, z = spawn.z + Math.sin(ang) * d, h = hf.heightAt(x, z);
    if (h < 25 || h > 150 || Math.abs(x) > HALF - 60 || Math.abs(z) > HALF - 60 || flatAt(x, z) < 0.93 || inStream(x, z, 10)) continue;
    if ([[5, 0], [-5, 0], [0, 5], [0, -5]].some(([ox, oz]) => flatAt(x + ox, z + oz) < 0.9)) continue;
    if (!viewS || h - d * 0.03 > viewS.h - viewS.d * 0.03) viewS = { x, z, h, d };
  }
  if (viewS) { viewS.r = Math.atan2(LAKE_X - viewS.x, LAKE_Z - viewS.z); sites.push({ x: viewS.x, z: viewS.z, r: 8 }); }
  // the old ruin stands in the flattest large glade
  let ruinS = null;
  for (const c of clearings) if (c.r > 24 && c.h < 90 && flatAt(c.x, c.z) > 0.94 && !inStream(c.x, c.z, 14) && Math.hypot(c.x - spawn.x, c.z - spawn.z) > 120 && (!ruinS || c.r > ruinS.r)) ruinS = c;
  if (ruinS) sites.push({ x: ruinS.x, z: ruinS.z, r: 9 });
  // sandy footpaths from the spawn to each landmark (gently wandering)
  const paths = [];
  const addPath = (a, b) => {
    const L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.ceil(L / 3), px = -(b.z - a.z) / L, pz = (b.x - a.x) / L, pts = [];
    for (let k = 0; k <= n; k++) { const t = k / n, w = Math.sin(t * Math.PI) * Math.sin(t * 7 + a.x) * 3; pts.push({ x: a.x + (b.x - a.x) * t + px * w, z: a.z + (b.z - a.z) * t + pz * w }); }
    paths.push(pts);
  };
  const front = (s, d) => ({ x: s.x + Math.sin(s.r) * d, z: s.z + Math.cos(s.r) * d });
  if (dockS) addPath(spawn, dockS);
  if (shrineS) addPath(spawn, front(shrineS, 9));
  if (cottageS) addPath(spawn, front(cottageS, 11.5));
  if (viewS) addPath(shrineS ? front(shrineS, 9) : spawn, front(viewS, -3.5));
  const pathDist = (x, z) => { let m = 1e9; for (const P of paths) for (let i = 0; i + 1 < P.length; i++) {
    const a = P[i], b = P[i + 1], dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1, t = clamp(((x - a.x) * dx + (z - a.z) * dz) / L2, 0, 1);
    m = Math.min(m, Math.hypot(x - a.x - dx * t, z - a.z - dz * t)); } return m; };
  // the hilltop viewpoint keeps an open wedge down toward the lake (nothing grows into its view)
  const inView = (x, z) => { if (!viewS) return false; const dx = x - viewS.x, dz = z - viewS.z, d = Math.hypot(dx, dz); if (d < 4 || d > 170) return false;
    let a = Math.atan2(dx, dz) - viewS.r; a = Math.atan2(Math.sin(a), Math.cos(a)); return Math.abs(a) < 0.75 && hf.heightAt(x, z) > viewS.h - 40 - d * 0.12; };
  const blocked = (x, z, pad = 0) => sites.some(q => Math.hypot(x - q.x, z - q.z) < q.r + pad) || pathDist(x, z) < 1.6 + pad || inStream(x, z, pad) || inView(x, z);

  // ---------------------------------------------------------------- forests (ecology.js): stands, species, spacing, fringe
  progress('Growing forests', 0.62); await tick();
  const { trees, saplings } = plantForest({ hf, forest: FOREST, moist: MOIST, seed: 99, water: 0, snow: 205, blocked: (x, z, pad) => blocked(x, z, pad),
    alpine: [110, 175], lowland: [22, 60], meadow: 1100 });
  // sakura where it belongs: blossom groves by the lake and around the landmarks, along the open stream banks and in a
  // few scenic clusters where the forest edge meets the low meadows — never inside the dense conifer woods
  const srng = mulberry32(4242);
  const plantSakura = (cx, cz, n, rMin, rMax) => { for (let k = 0; k < n * 4 && n > 0; k++) {
    const a = srng() * 6.28, d = lerp(rMin, rMax, srng()), x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d, h = hf.heightAt(x, z);
    if (h < 1.5 || flatAt(x, z) < 0.88 || blocked(x, z, 2.5) || FOREST[hf.idx(x, z)] > 0.45) continue;
    const t = makeTree('sakura', x, h - 0.2, z, srng, { a: srng() });
    if (trees.some(o => Math.hypot(o.x - x, o.z - z) < 0.6 * (o.cr + t.cr))) continue;
    trees.push(t); n--; } };
  if (shrineS) plantSakura(shrineS.x, shrineS.z, 7, 14, 24);
  if (cottageS) plantSakura(cottageS.x, cottageS.z, 3, 18, 26);
  plantSakura(spawn.x, spawn.z, 4, 14, 30);
  for (let k = 0; k < 16; k++) { const a = k / 16 * 6.28 + srng(), R = 290 + srng() * 40; plantSakura(LAKE_X + Math.cos(a) * R, LAKE_Z + Math.sin(a) * R / 1.3, 3, 0, 18); }
  for (const S of streams) for (let i = 10; i < S.pts.length; i += 9) {
    const q = S.pts[i]; if (q.h > 45 || FOREST[hf.idx(q.x, q.z)] > 0.3 || srng() > 0.3) continue;
    plantSakura(q.x, q.z, 1 + Math.floor(srng() * 2), q.W / 2 + 4, q.W / 2 + 9);
  }
  for (let k = 0, placed = 0; k < 3000 && placed < 14; k++) { // scenic clusters on the low forest edges
    const x = (srng() * 2 - 1) * (HALF - 80), z = (srng() * 2 - 1) * (HALF - 80), f = FOREST[hf.idx(x, z)], h = hf.heightAt(x, z);
    if (f < 0.06 || f > 0.28 || h < 4 || h > 32 || flatAt(x, z) < 0.93) continue;
    plantSakura(x, z, 2 + Math.floor(srng() * 3), 0, 9); placed++;
  }
  // weeping willows lean over the lake shore and the lower streams
  for (let k = 0, placed = 0; k < 4000 && placed < 16; k++) {
    const a = srng() * 6.28, R = 200 + srng() * 120, x = LAKE_X + Math.cos(a) * R, z = LAKE_Z + Math.sin(a) * R / 1.3, h = hf.heightAt(x, z);
    if (h < 1.1 || h > 3.2 || flatAt(x, z) < 0.9 || blocked(x, z, 4)) continue;
    const t = makeTree('willow', x, h - 0.2, z, srng, { a: srng() });
    if (trees.some(o => Math.hypot(o.x - x, o.z - z) < 0.75 * (o.cr + t.cr))) continue;
    trees.push(t); placed++;
  }
  for (let i = trees.length - 1; i >= 0; i--) { const t = trees[i]; if (t.kind !== 'willow' && t.kind !== 'sakura' && Math.hypot(t.x - LAKE_X, (t.z - LAKE_Z) * 1.3) < 205 && t.y < 2.5) trees.splice(i, 1); }
  // paths: sandy ground, no grass
  for (const P of paths) for (const q of P) {
    hf.paint2(0, q.x - 3, q.z - 3, q.x + 3, q.z + 3, (x, z) => 1.15 - pathDist(x, z) / 1.3);
    hf.paint2(2, q.x - 3, q.z - 3, q.x + 3, q.z + 3, (x, z) => 1.4 - pathDist(x, z) / 1.1);
  }
  for (const q of sites.slice(1)) hf.paint2(2, q.x - 7, q.z - 7, q.x + 7, q.z + 7, (x, z) => 1.3 - Math.hypot(x - q.x, z - q.z) / 5.5);
  // stream beds: no grass in the channel, wet mud and gravel along the banks
  for (const S of streams) for (let i = 0; i < S.pts.length; i += 2) {
    const q = S.pts[i], e = q.W / 2 + 4;
    hf.paint2(2, q.x - e, q.z - e, q.x + e, q.z + e, (x, z) => { const st = streamAt(x, z); return st && st.d < st.W / 2 + 0.6 ? 1 : 0; });
    hf.paint2(1, q.x - e, q.z - e, q.x + e, q.z + e, (x, z) => { const st = streamAt(x, z); return st ? 0.5 * (1 - smoothstep(st.W / 2 - 0.5, st.W / 2 + 1.4, st.d)) : 0; });
  }
  hf.paintCanopy(trees);
  hf.uploadHeight(); hf.uploadMasks();
  progress('Building terrain', 0.68); await tick();
  await buildTerrainMeshes(hf, terrainMaterial(hf, layers, { water: 0, snow: 280, shore: 0.8, conifer: 0.62 }));
  progress('Planting trees', 0.78); await tick();
  buildTrees([...trees, ...saplings]);
  const sakura = trees.filter(t => t.kind === 'sakura');
  // landmarks
  const LB = new GeoBuilder(96), gAt = (x, z) => hf.heightAt(x, z);
  if (dockS) { const r = Math.atan2(ldx, ldz); dock(LB, dockS.x, dockS.z, r, 17, gAt); bench(LB, dockS.x - ldz * 3 - ldx * 2.5, gAt(dockS.x - ldz * 3 - ldx * 2.5, dockS.z + ldx * 3 - ldz * 2.5), dockS.z + ldx * 3 - ldz * 2.5, r); }
  if (shrineS) {
    shrine(LB, shrineS.x, gAt(shrineS.x, shrineS.z), shrineS.z, shrineS.r);
    const b = front(shrineS, 6.5); bench(LB, b.x + Math.cos(shrineS.r) * 3.5, gAt(b.x, b.z), b.z - Math.sin(shrineS.r) * 3.5, shrineS.r);
  }
  if (cottageS) cottage(LB, cottageS.x, gAt(cottageS.x, cottageS.z) + 0.1, cottageS.z, cottageS.r);
  // stone lanterns along the paths
  for (const P of paths) for (let i = 4; i < P.length - 2; i += 7) { const q = P[i], nx = P[i + 1].z - q.z, nz = q.x - P[i + 1].x, l = Math.hypot(nx, nz) || 1; lantern(LB, q.x + nx / l * 1.9, gAt(q.x + nx / l * 1.9, q.z + nz / l * 1.9) - 0.05, q.z + nz / l * 1.9, 0); }
  // plank footbridges where the paths cross the streams
  for (const P of paths) for (const S of streams) {
    let bi = -1, bd = 1e9;
    P.forEach((q, i) => { const st = streamAt(q.x, q.z); if (st && st.d < st.W / 2 + 1 && st.d < bd && i > 0 && i < P.length - 1) { bd = st.d; bi = i; } });
    if (bi < 0) continue;
    const q = P[bi], st = streamAt(q.x, q.z), a = P[bi - 1], b = P[bi + 1], L = Math.hypot(b.x - a.x, b.z - a.z) || 1, ux = (b.x - a.x) / L, uz = (b.z - a.z) / L, half = st.W / 2 + 2.4;
    const x0 = q.x - ux * half, z0 = q.z - uz * half, x1 = q.x + ux * half, z1 = q.z + uz * half;
    footbridge(LB, x0, z0, x1, z1, Math.max(gAt(x0, z0), gAt(x1, z1), st.w + 0.6) + 0.2, gAt);
  }
  if (viewS) viewpoint(LB, viewS.x, viewS.z, viewS.r, gAt);
  if (ruinS) ruin(LB, ruinS.x, ruinS.z, grng() * 6.28, gAt, 7);
  // a little hokora beside the path up to the viewpoint
  if (viewS && paths.length) { const P = paths[paths.length - 1], i = Math.floor(P.length * 0.45), q = P[i], n = P[i + 1] || q, dx = n.x - q.x, dz = n.z - q.z, l = Math.hypot(dx, dz) || 1;
    const hx = q.x - dz / l * 2.6, hz = q.z + dx / l * 2.6; if (flatAt(hx, hz) > 0.85) hokora(LB, hx, gAt(hx, hz) - 0.05, hz, Math.atan2(dz / l, -dx / l)); }
  const landmarks = flushLandmarks(LB);
  // shrubs everywhere things grow: green bushes on forest edges and in the meadows, hydrangeas by paths and homes
  const brng = mulberry32(1717), bushes = [], hydras = [];
  for (let k = 0; k < 26000 && bushes.length < 2600; k++) {
    const x = (brng() * 2 - 1) * (HALF - 20), z = (brng() * 2 - 1) * (HALF - 20), h = hf.heightAt(x, z), f = FOREST[hf.idx(x, z)];
    if (h < 1.2 || h > 150 || flatAt(x, z) < 0.8 || blocked(x, z, 1)) continue;
    const edge = f > 0.08 && f < 0.6 ? 1 : 0.12;
    if (brng() > edge) continue;
    bushes.push({ x, y: h - 0.15, z, s: lerp(1.0, 2.8, Math.pow(brng(), 1.5)), sx: 0.9 + brng() * 0.4, r: brng() * 6.28, c: bushColor(brng) });
  }
  // riparian thickets: shrubs crowd the stream banks
  for (const S of streams) for (let i = 4; i < S.pts.length; i += 2) {
    if (brng() > 0.45) continue;
    const q = S.pts[i], n = S.pts[i + 1] || q, dx = n.x - q.x, dz = n.z - q.z, l = Math.hypot(dx, dz) || 1, sd = brng() < 0.5 ? -1 : 1, off = q.W / 2 + 1.6 + brng() * 3;
    const x = q.x - dz / l * off * sd, z = q.z + dx / l * off * sd, h = hf.heightAt(x, z);
    if (h < 0.8 || sites.some(t => Math.hypot(x - t.x, z - t.z) < t.r + 1) || pathDist(x, z) < 2.6) continue;
    bushes.push({ x, y: h - 0.15, z, s: lerp(1.2, 2.6, brng()), sx: 0.9 + brng() * 0.4, r: brng() * 6.28, c: bushColor(brng) });
  }
  const hydraAt = (cx, cz, n, rMin, rMax) => { for (let k = 0; k < n * 5 && n > 0; k++) {
    const a = brng() * 6.28, d = lerp(rMin, rMax, brng()), x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d, h = hf.heightAt(x, z);
    if (h < 1 || flatAt(x, z) < 0.85 || blocked(x, z, 0.3)) continue;
    hydras.push({ x, y: h - 0.1, z, s: lerp(1.1, 1.8, brng()), sx: 0.9 + brng() * 0.3, r: brng() * 6.28, c: hydraColor(brng) }); n--; } };
  for (const P of paths) for (let i = 1; i < P.length; i += 2) hydraAt(P[i].x, P[i].z, 1, 2.2, 4.5);
  if (cottageS) { hydraAt(cottageS.x, cottageS.z, 10, 5, 9); }
  if (shrineS) hydraAt(shrineS.x, shrineS.z, 8, 8, 16);
  for (let k = 0; k < 120; k++) { const x = (brng() * 2 - 1) * 700, z = (brng() * 2 - 1) * 700; if (FOREST[hf.idx(x, z)] > 0.1 && FOREST[hf.idx(x, z)] < 0.5) hydraAt(x, z, 3, 0, 5); }
  // the forest floor: low shrubs in patches, spreads of dead branches, fallen logs (a fallen top beside every snapped
  // trunk), all kept off the paths and landmarks
  const floor = forestFloor({ hf, forest: FOREST, moist: MOIST, trees, seed: 5, water: 0, blocked: (x, z, pad) => blocked(x, z, pad), logs: 650, twigs: 7000, shrubs: 3000 });
  for (const b of floor.shrubs) bushes.push(b);
  buildBushes(bushes, 'bush');
  buildBushes(hydras, 'hydra');
  buildTrees(floor.twigs, { colliders: false });
  buildLogs(floor.logs);
  const grass = buildGrass(hf, layers.grass.d, { water: 0, shore: 0.8, reeds: true, snow: 280 });
  const water = buildWater(hf, { level: 0, normals: loadTex('tex/waternormals.jpg', false, NFLAT), hide: [grass] });
  for (const S of streams) { const pts = S.pts.filter(q => q.b > -0.25); if (pts.length > 2) buildStream(pts); }

  progress('Placing rocks and plants', 0.9); await tick();
  await models;
  const [rockSet, boulder, fern, shrub, stump, deadTrunk] = await models;
  const prng = mulberry32(777);
  const placeLow = (x, z, r) => Math.min(hf.heightAt(x - r, z - r), hf.heightAt(x + r, z - r), hf.heightAt(x - r, z + r), hf.heightAt(x + r, z + r), hf.heightAt(x, z));
  const nearSpawn = (x, z) => blocked(x, z, 1);
  // rock clusters in a natural scale hierarchy: one big boulder, a ring of medium rocks and a spill of small stones
  // around it, all sunk into the ground; they gather on broken slopes, along the streams and in the glades
  const krng = mulberry32(3030), centres = [], onSite = (x, z) => sites.some(q => Math.hypot(x - q.x, z - q.z) < q.r + 2) || pathDist(x, z) < 2.5;
  for (let k = 0; k < 4000 && centres.length < 60; k++) {
    const x = (krng() * 2 - 1) * (HALF - 40), z = (krng() * 2 - 1) * (HALF - 40), h = hf.heightAt(x, z);
    if (h < 1.5 || h > 190 || onSite(x, z) || centres.some(c => Math.hypot(c.x - x, c.z - z) < 50)) continue;
    const ny = hf.normalAt(x, z, nrm).y, st = streamAt(x, z);
    const score = (ny < 0.9 && ny > 0.6 ? 0.45 : 0.02) + (st && st.d < st.W / 2 + 5 ? 0.7 : 0) + (FOREST[hf.idx(x, z)] > 0.5 ? 0.12 : 0);
    if (krng() < score) centres.push({ x, z, big: true });
  }
  for (const c of clearings) if (!onSite(c.x + c.r * 0.35, c.z)) centres.push({ x: c.x + c.r * 0.35, z: c.z, big: false });
  const rockParts = rockSet ? extractParts(rockSet) : [], rockDims = rockParts.map(p => normalizeParts([p], false)), members = [];
  for (const c of centres) {
    const nMed = 3 + Math.floor(krng() * 4), nSmall = 8 + Math.floor(krng() * 9);
    for (let k = 0; k < nMed + nSmall; k++) {
      const med = k < nMed, a = krng() * 6.28, d = med ? 2 + krng() * 4.5 : 1.5 + krng() * 8, x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d * 0.8;
      if (onSite(x, z)) continue;
      members.push({ x, z, part: Math.floor(krng() * Math.max(1, rockParts.length)), s: med ? lerp(1.0, 2.2, krng()) : lerp(0.25, 0.75, krng()) });
    }
  }
  rockParts.forEach((part, pi) => {
    const dim = rockDims[pi], items = [];
    const add = (x, z, s, sink) => {
      items.push({ x, y: placeLow(x, z, s * dim.w * 0.35) - s * dim.h * sink, z, s, r: prng() * 6.28, tilt: (prng() - 0.5) * 0.4, tilt2: (prng() - 0.5) * 0.4 });
      if (s * dim.h > 0.55) addCircle(x, z, s * dim.w * 0.4);
    };
    for (let k = 0; k < 700; k++) {
      const x = (prng() * 2 - 1) * (HALF - 20), z = (prng() * 2 - 1) * (HALF - 20), h = hf.heightAt(x, z);
      hf.normalAt(x, z, nrm);
      if (h < -1.5 || h > 200 || nrm.y < 0.55 || nearSpawn(x, z)) continue;
      if (prng() > 0.18 + FOREST[hf.idx(x, z)] * 0.6 + (1 - nrm.y) * 1.5) continue;
      add(x, z, lerp(0.5, 2.6, Math.pow(prng(), 2.2)), 0.18);
    }
    for (const m of members) if (m.part === pi) add(m.x, m.z, m.s, m.s < 0.8 ? 0.3 : 0.22);
    // scanned rocks are dense meshes: full detail up close, a clustered low-poly copy further out
    const lo = decimate(part.geometry, 9);
    new Scatter(items, [{ dist: () => Math.min(110, Q.rocks), parts: [{ geometry: part.geometry, material: part.material, castShadow: true }] },
      { dist: () => Q.rocks, parts: [{ geometry: lo, material: part.material, castShadow: true }] }], 128);
  });
  if (boulder) {
    const parts = extractParts(boulder), dim = normalizeParts(parts, false), items = [];
    const add = (x, z, s) => { items.push({ x, y: placeLow(x, z, s * dim.w * 0.35) - s * dim.h * 0.26, z, s, r: prng() * 6.28, tilt: (prng() - 0.5) * 0.3 }); addCircle(x, z, s * dim.w * 0.42); };
    for (let k = 0; k < 420 && items.length < 70; k++) {
      const x = (prng() * 2 - 1) * (HALF - 40), z = (prng() * 2 - 1) * (HALF - 40), h = hf.heightAt(x, z);
      hf.normalAt(x, z, nrm);
      if (h < -2 || h > 190 || nrm.y < 0.7 || prng() > (h < 6 ? 0.6 : 0.12) || nearSpawn(x, z)) continue;
      add(x, z, lerp(2.2, 6.5, prng()));
    }
    for (const c of centres) if (c.big) add(c.x, c.z, lerp(2.8, 6.0, krng()));
    const loParts = parts.map(p => ({ ...p, geometry: decimate(p.geometry, 12), castShadow: true }));
    new Scatter(items, [{ dist: () => 170, parts: parts.map(p => ({ ...p, castShadow: true })) }, { dist: () => Q.rocks * 2.2, parts: loParts }], 160);
    // outcrops: big rock heads breaking out of steep upper slopes and ridges, half buried, seen from far away
    const out = [], orng = mulberry32(4455);
    for (let k = 0; k < 5000 && out.length < 46; k++) {
      const x = (orng() * 2 - 1) * (HALF - 60), z = (orng() * 2 - 1) * (HALF - 60), h = hf.heightAt(x, z), ny = hf.normalAt(x, z, nrm).y;
      if (h < 35 || h > 260 || ny > 0.8 || ny < 0.5 || onSite(x, z) || out.some(o => Math.hypot(o.x - x, o.z - z) < 70)) continue;
      const s2 = lerp(9, 20, orng());
      out.push({ x, y: placeLow(x, z, s2 * dim.w * 0.3) - s2 * dim.h * 0.45, z, s: s2, sx: 0.8 + orng() * 0.6, sy: 0.6 + orng() * 0.4, r: orng() * 6.28, tilt: Math.atan2(nrm.z, nrm.y) * 0.6, tilt2: -Math.atan2(nrm.x, nrm.y) * 0.6 });
      addCircle(x, z, s2 * dim.w * 0.35);
    }
    new Scatter(out, [{ dist: () => 320, parts: parts.map(p => ({ ...p, castShadow: true })) }, { dist: () => Q.trees, parts: loParts }], 256);
  }
  // weight(x, z, f, m): chance a plant grows here (f forest cover, m ground moisture)
  const understory = (model, count, weight, sMin, sMax, dist, cell, split = false) => {
    if (!model) return;
    const parts = extractParts(model);
    if (split) { // several plants on one asset sheet: scatter each separately
      parts.forEach(p => { const one = new THREE.Group(); one.add(new THREE.Mesh(p.geometry, p.material)); understory(one, Math.ceil(count / parts.length), weight, sMin, sMax, dist, cell); });
      return;
    }
    normalizeParts(parts, true);
    parts.forEach(p => { p.material.side = THREE.DoubleSide; });
    const items = [];
    for (let k = 0; k < count * 10 && items.length < count; k++) {
      const x = (prng() * 2 - 1) * (HALF - 10), z = (prng() * 2 - 1) * (HALF - 10), f = FOREST[hf.idx(x, z)];
      if (prng() > weight(x, z, f, MOIST[hf.idx(x, z)]) || blocked(x, z, 0.5)) continue;
      const h = hf.heightAt(x, z); if (h < 3) continue;
      hf.normalAt(x, z, nrm); if (nrm.y < 0.8) continue;
      items.push({ x, y: h - 0.05, z, s: lerp(sMin, sMax, prng()), r: prng() * 6.28, tilt: (prng() - 0.5) * 0.25, tilt2: (prng() - 0.5) * 0.25 });
    }
    new Scatter(items, [{ dist: () => dist() * 0.35, parts: parts.map(p => ({ ...p, castShadow: false })) }, { dist, parts: parts.map(p => ({ ...p, geometry: decimate(p.geometry, 6), castShadow: false })) }], cell);
  };
  // ferns carpet the damp, shaded ground in patches (thin on dry pine slopes); scanned shrubs keep to edges and glades
  const fernPatch = (x, z) => smoothstep(-0.15, 0.3, fbm(x * 0.035 + 9.1, z * 0.035 - 1.7, 2));
  understory(fern, 15000, (x, z, f, m) => f < 0.25 ? 0 : f * (0.2 + 0.8 * smoothstep(0.2, 0.6, m)) * (0.15 + 0.85 * fernPatch(x, z)) * (1 - smoothstep(120, 170, hf.heightAt(x, z))), 0.45, 1.15, () => Q.ferns, 96);
  understory(shrub, 3800, (x, z, f) => f < 0.12 ? 0 : f < 0.6 ? 1 : 0.35, 0.6, 1.5, () => Q.ferns * 1.3, 128, true);
  // forest debris: scanned stumps and fallen dead trunks lying on the slope
  const debris = (model, count, sMin, sMax, dist, lying, spots = []) => {
    if (!model) return;
    const parts = extractParts(model), dim = normalizeParts(parts, !lying), items = [];
    for (let k = 0; k < count * 10 + spots.length && items.length < count + spots.length; k++) {
      const sp = k < spots.length ? spots[k] : null;
      const x = sp ? sp.x : (prng() * 2 - 1) * (HALF - 20), z = sp ? sp.z : (prng() * 2 - 1) * (HALF - 20), f = FOREST[hf.idx(x, z)];
      if (!sp && (f < 0.4 || prng() > f) || nearSpawn(x, z)) continue;
      const h = hf.heightAt(x, z); if (h < 3) continue;
      hf.normalAt(x, z, nrm); if (nrm.y < 0.82) continue;
      const s = lerp(sMin, sMax, prng());
      items.push({ x, y: placeLow(x, z, s * dim.w * 0.3) - s * dim.h * (lying ? 0.25 : 0.08), z, s, r: prng() * 6.28, tilt: Math.atan2(nrm.z, nrm.y) * 0.8, tilt2: -Math.atan2(nrm.x, nrm.y) * 0.8 });
      if (s * dim.h > 0.4) addCircle(x, z, s * dim.w * (lying ? 0.18 : 0.35));
    }
    new Scatter(items, [{ dist: () => lying ? 70 : 45, parts: parts.map(p => ({ ...p, castShadow: true })) }, { dist, parts: parts.map(p => ({ ...p, geometry: decimate(p.geometry, lying ? 12 : 7), castShadow: true })) }], 160);
  };
  // every glade gets a fallen trunk and a few old stumps from the trees that once stood there
  const gl = mulberry32(99), stumpSpots = [], logSpots = [];
  for (const c of clearings) {
    if (gl() < 0.8) { const a = gl() * 6.28, d = c.r * (0.3 + gl() * 0.3); logSpots.push({ x: c.x + Math.cos(a) * d, z: c.z + Math.sin(a) * d }); }
    for (let k = 0, n = 2 + Math.floor(gl() * 4); k < n; k++) { const a = gl() * 6.28, d = c.r * (0.4 + gl() * 0.5); stumpSpots.push({ x: c.x + Math.cos(a) * d, z: c.z + Math.sin(a) * d }); }
  }
  debris(stump, 500, 0.45, 1.0, () => Q.rocks * 0.45, false, stumpSpots);
  debris(deadTrunk, 120, 5, 9, () => Q.rocks * 0.45, true, logSpots);

  const _n = new THREE.Vector3();
  return {
    hf, grass, water, spawn, sakura, streams, sites: { dock: dockS, shrine: shrineS, cottage: cottageS, view: viewS, ruin: ruinS && { x: ruinS.x, z: ruinS.z, r: 0 } },
    bounds: { minX: -HALF + 30, maxX: HALF - 30, minZ: -HALF + 30, maxZ: HALF - 30 },
    groundAt: (x, z) => hf.groundAt(x, z),
    normalAt: (x, z, out) => hf.normalAt(x, z, out),
    waterAt: () => 0,
    surfaceAt(x, z) {
      const h = hf.heightAt(x, z);
      if (h < 0.3) return 'water'; if (h < 1.3) return 'sand';
      if (hf.normalAt(x, z, _n).y < 0.72) return 'rock';
      return FOREST[hf.idx(x, z)] > 0.45 ? 'forest' : 'grass';
    },
    ambience(x, z) {
      let best = 99;
      for (const r of [2, 6, 12, 20, 30]) for (let a = 0; a < 12; a++) if (hf.heightAt(x + Math.cos(a / 12 * 6.28) * r, z + Math.sin(a / 12 * 6.28) * r) < 0) best = Math.min(best, r);
      return { forest: FOREST[hf.idx(clamp(x, -HALF, HALF), clamp(z, -HALF, HALF))], water: best < 99 ? 1 - best / 34 : 0, town: 0, insects: 0.2 };
    },
    update() { landmarks.update(); },
  };
}
