// "Wildlands" — lake valley, conifer forests, mountains.
import { THREE, Q, clamp, lerp, smoothstep, mulberry32, tick, fbm, erosion, loadTex, phTex, NFLAT, loadModel, extractParts, normalizeParts, Scatter, addCircle, clearColliders } from './core.js';
import { Heightfield, terrainMaterial, buildTerrainMeshes, buildGrass, buildWater, farForestAt } from './terrain.js';
import { buildConiferForest, buildBroadleafForest, buildSakura, buildBushes, firColor, leafColor, sakuraColor, bushColor, hydraColor } from './trees.js';
import { GeoBuilder, dock, shrine, cottage, bench, lantern, flushLandmarks } from './landmarks.js';

export const meta = { name: 'Wildlands', startHour: 16.4, sunAzimuth: 2.2, life: { flockCenter: { x: 40, y: 0, z: -60 } } };
const LAKE_X = 40, LAKE_Z = -60;

function height(x, z) {
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

export async function build(progress) {
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
      if (edge > 0) v = lerp(v, farForestAt(x, z, h, 1 - hf.gridNormalY(i, j), 0, 175), edge);
      FOREST[j * HN + i] = v; hf.mask[(j * HN + i) * 4] = v * 255;
    }
    if ((j & 63) === 0) { progress('Growing forests', 0.4 + 0.1 * j / HN); await tick(); }
  }
  await hf.bakeAO(p => progress('Growing forests', 0.5 + 0.1 * p));
  // trees
  const rng = mulberry32(99), nrm = new THREE.Vector3(), trees = [];
  const STEP = 8, n = Math.floor(2048 / STEP);
  for (let gz = 0; gz < n; gz++) for (let gx = 0; gx < n; gx++) {
    const x = -HALF + (gx + 0.5 + (rng() - 0.5) * 0.9) * STEP, z = -HALF + (gz + 0.5 + (rng() - 0.5) * 0.9) * STEP;
    const f = FOREST[hf.idx(x, z)], h = hf.heightAt(x, z);
    if (h < 2.2 || h > 205) continue;
    hf.normalAt(x, z, nrm); if (nrm.y < 0.8) continue;
    if (rng() > f * 0.9 + 0.006) continue;
    // round broadleaf trees mix into the lower, sunnier forest edges; conifers own the slopes above
    const leafy = h < 75 && rng() < 0.55 * (1 - smoothstep(40, 75, h)) * (1.15 - f);
    const s = leafy ? lerp(8, 14, rng()) : lerp(11, 25, Math.pow(rng(), 1.3)) * (0.75 + 0.25 * f) * (1 - smoothstep(120, 205, h) * 0.45);
    trees.push({ x, y: h - 0.25, z, s, sx: 0.85 + rng() * 0.35, r: rng() * Math.PI * 2, tilt: (rng() - 0.5) * 0.05, tilt2: (rng() - 0.5) * 0.05, leafy, c: leafy ? leafColor(rng) : firColor(rng) });
  }
  // lone trees and little groves out in the meadows (the classic painted hillside)
  for (let k = 0; k < 900; k++) {
    const cx = (rng() * 2 - 1) * (HALF - 60), cz = (rng() * 2 - 1) * (HALF - 60), n = rng() < 0.6 ? 1 : 2 + Math.floor(rng() * 4);
    for (let m = 0; m < n; m++) {
      const x = cx + (rng() - 0.5) * 18 * (n > 1), z = cz + (rng() - 0.5) * 18 * (n > 1), h = hf.heightAt(x, z);
      if (h < 3 || h > 90 || FOREST[hf.idx(x, z)] > 0.25 || hf.normalAt(x, z, nrm).y < 0.88) continue;
      trees.push({ x, y: h - 0.2, z, s: lerp(8, 15, rng()), sx: 0.9 + rng() * 0.3, r: rng() * 6.28, tilt: (rng() - 0.5) * 0.06, tilt2: (rng() - 0.5) * 0.06, leafy: true, c: leafColor(rng) });
    }
  }
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
  const siteSearch = (dMin, dMax, hMin, hMax, flat, fMax) => {
    let best = null, bestScore = 1e9;
    for (let a = 0; a < 96; a++) for (let d = dMin; d <= dMax; d += 6) {
      const ang = a / 96 * Math.PI * 2, x = spawn.x + Math.cos(ang) * d, z = spawn.z + Math.sin(ang) * d, h = hf.heightAt(x, z);
      if (h < hMin || h > hMax || flatAt(x, z) < flat || FOREST[hf.idx(x, z)] > fMax) continue;
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
  const pathDist = (x, z) => { let m = 1e9; for (const P of paths) for (let i = 0; i + 1 < P.length; i++) {
    const a = P[i], b = P[i + 1], dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1, t = clamp(((x - a.x) * dx + (z - a.z) * dz) / L2, 0, 1);
    m = Math.min(m, Math.hypot(x - a.x - dx * t, z - a.z - dz * t)); } return m; };
  const blocked = (x, z, pad = 0) => sites.some(q => Math.hypot(x - q.x, z - q.z) < q.r + pad) || pathDist(x, z) < 1.6 + pad;

  // sakura: blossom groves by the lake and around the landmarks, and a share of the lone meadow trees
  const srng = mulberry32(4242);
  for (const t of trees) if (t.leafy && !t.sakura && t.y < 40 && srng() < 0.3) { t.sakura = true; t.leafy = false; t.s *= 0.9; t.c = sakuraColor(srng); }
  const plantSakura = (cx, cz, n, rMin, rMax) => { for (let k = 0; k < n * 4 && n > 0; k++) {
    const a = srng() * 6.28, d = lerp(rMin, rMax, srng()), x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d, h = hf.heightAt(x, z);
    if (h < 1.5 || flatAt(x, z) < 0.88 || blocked(x, z, 2.5)) continue;
    trees.push({ x, y: h - 0.2, z, s: lerp(7, 10, srng()), sx: 1, r: srng() * 6.28, sakura: true, c: sakuraColor(srng) }); n--; } };
  if (shrineS) plantSakura(shrineS.x, shrineS.z, 7, 14, 24);
  if (cottageS) plantSakura(cottageS.x, cottageS.z, 3, 18, 26);
  plantSakura(spawn.x, spawn.z, 4, 14, 30);
  for (let k = 0; k < 16; k++) { const a = k / 16 * 6.28 + srng(), R = 290 + srng() * 40; plantSakura(LAKE_X + Math.cos(a) * R, LAKE_Z + Math.sin(a) * R / 1.3, 3, 0, 18); }
  for (let i = trees.length - 1; i >= 0; i--) {
    const t = trees[i];
    if (blocked(t.x, t.z, t.sakura ? 0 : 3) || (t.leafy && Math.hypot(t.x - LAKE_X, (t.z - LAKE_Z) * 1.3) < 205 && t.y < 2.5)) trees.splice(i, 1);
  }
  // paths: sandy ground, no grass
  for (const P of paths) for (const q of P) {
    hf.paint2(0, q.x - 3, q.z - 3, q.x + 3, q.z + 3, (x, z) => 1.15 - pathDist(x, z) / 1.3);
    hf.paint2(2, q.x - 3, q.z - 3, q.x + 3, q.z + 3, (x, z) => 1.4 - pathDist(x, z) / 1.1);
  }
  for (const q of sites.slice(1)) hf.paint2(2, q.x - 7, q.z - 7, q.x + 7, q.z + 7, (x, z) => 1.3 - Math.hypot(x - q.x, z - q.z) / 5.5);
  hf.paintCanopy(trees);
  hf.uploadHeight(); hf.uploadMasks();
  progress('Building terrain', 0.68); await tick();
  await buildTerrainMeshes(hf, terrainMaterial(hf, layers, { water: 0, snow: 175, shore: 0.8, conifer: 0.62 }));
  progress('Planting trees', 0.78); await tick();
  buildConiferForest(trees.filter(t => !t.leafy && !t.sakura));
  buildBroadleafForest(trees.filter(t => t.leafy));
  const sakura = trees.filter(t => t.sakura);
  buildSakura(sakura);
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
  const hydraAt = (cx, cz, n, rMin, rMax) => { for (let k = 0; k < n * 5 && n > 0; k++) {
    const a = brng() * 6.28, d = lerp(rMin, rMax, brng()), x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d, h = hf.heightAt(x, z);
    if (h < 1 || flatAt(x, z) < 0.85 || blocked(x, z, 0.3)) continue;
    hydras.push({ x, y: h - 0.1, z, s: lerp(1.1, 1.8, brng()), sx: 0.9 + brng() * 0.3, r: brng() * 6.28, c: hydraColor(brng) }); n--; } };
  for (const P of paths) for (let i = 1; i < P.length; i += 2) hydraAt(P[i].x, P[i].z, 1, 2.2, 4.5);
  if (cottageS) { hydraAt(cottageS.x, cottageS.z, 10, 5, 9); }
  if (shrineS) hydraAt(shrineS.x, shrineS.z, 8, 8, 16);
  for (let k = 0; k < 120; k++) { const x = (brng() * 2 - 1) * 700, z = (brng() * 2 - 1) * 700; if (FOREST[hf.idx(x, z)] > 0.1 && FOREST[hf.idx(x, z)] < 0.5) hydraAt(x, z, 3, 0, 5); }
  buildBushes(bushes, 'bush');
  buildBushes(hydras, 'hydra');
  const grass = buildGrass(hf, layers.grass.d, { water: 0, shore: 0.8, reeds: true });
  const water = buildWater(hf, { level: 0, normals: loadTex('tex/waternormals.jpg', false, NFLAT), hide: [grass] });

  progress('Placing rocks and plants', 0.9); await tick();
  await models;
  const [rockSet, boulder, fern, shrub, stump, deadTrunk] = await models;
  const prng = mulberry32(777);
  const placeLow = (x, z, r) => Math.min(hf.heightAt(x - r, z - r), hf.heightAt(x + r, z - r), hf.heightAt(x - r, z + r), hf.heightAt(x + r, z + r), hf.heightAt(x, z));
  const nearSpawn = (x, z) => blocked(x, z, 1);
  if (rockSet) extractParts(rockSet).forEach(part => {
    const dim = normalizeParts([part], false), items = [];
    for (let k = 0; k < 700; k++) {
      const x = (prng() * 2 - 1) * (HALF - 20), z = (prng() * 2 - 1) * (HALF - 20), h = hf.heightAt(x, z);
      hf.normalAt(x, z, nrm);
      if (h < -1.5 || h > 200 || nrm.y < 0.55 || nearSpawn(x, z)) continue;
      if (prng() > 0.18 + FOREST[hf.idx(x, z)] * 0.6 + (1 - nrm.y) * 1.5) continue;
      const s = lerp(0.5, 2.6, Math.pow(prng(), 2.2));
      items.push({ x, y: placeLow(x, z, s * dim.w * 0.35) - s * dim.h * 0.18, z, s, r: prng() * 6.28, tilt: (prng() - 0.5) * 0.4, tilt2: (prng() - 0.5) * 0.4 });
      if (s * dim.h > 0.55) addCircle(x, z, s * dim.w * 0.4);
    }
    new Scatter(items, [{ dist: () => Q.rocks, parts: [{ geometry: part.geometry, material: part.material, castShadow: true }] }], 96);
  });
  if (boulder) {
    const parts = extractParts(boulder), dim = normalizeParts(parts, false), items = [];
    for (let k = 0; k < 420 && items.length < 70; k++) {
      const x = (prng() * 2 - 1) * (HALF - 40), z = (prng() * 2 - 1) * (HALF - 40), h = hf.heightAt(x, z);
      hf.normalAt(x, z, nrm);
      if (h < -2 || h > 190 || nrm.y < 0.7 || prng() > (h < 6 ? 0.6 : 0.12) || nearSpawn(x, z)) continue;
      const s = lerp(2.2, 6.5, prng());
      items.push({ x, y: placeLow(x, z, s * dim.w * 0.35) - s * dim.h * 0.22, z, s, r: prng() * 6.28, tilt: (prng() - 0.5) * 0.3 });
      addCircle(x, z, s * dim.w * 0.42);
    }
    new Scatter(items, [{ dist: () => Q.rocks * 2.2, parts: parts.map(p => ({ ...p, castShadow: true })) }], 160);
  }
  const understory = (model, count, minF, sMin, sMax, dist, cell, split = false) => {
    if (!model) return;
    const parts = extractParts(model);
    if (split) { // several plants on one asset sheet: scatter each separately
      parts.forEach(p => { const one = new THREE.Group(); one.add(new THREE.Mesh(p.geometry, p.material)); understory(one, Math.ceil(count / parts.length), minF, sMin, sMax, dist, cell); });
      return;
    }
    normalizeParts(parts, true);
    parts.forEach(p => { p.material.side = THREE.DoubleSide; });
    const items = [];
    for (let k = 0; k < count * 8 && items.length < count; k++) {
      const x = (prng() * 2 - 1) * (HALF - 10), z = (prng() * 2 - 1) * (HALF - 10), f = FOREST[hf.idx(x, z)];
      if (f < minF || prng() > f + 0.05) continue;
      const h = hf.heightAt(x, z); if (h < 3) continue;
      hf.normalAt(x, z, nrm); if (nrm.y < 0.8) continue;
      items.push({ x, y: h - 0.05, z, s: lerp(sMin, sMax, prng()), r: prng() * 6.28, tilt: (prng() - 0.5) * 0.25, tilt2: (prng() - 0.5) * 0.25 });
    }
    new Scatter(items, [{ dist, parts: parts.map(p => ({ ...p, castShadow: false })) }], cell);
  };
  understory(fern, 9000, 0.35, 0.45, 1.05, () => Q.ferns, 48);
  understory(shrub, 3500, 0.15, 0.6, 1.5, () => Q.ferns * 1.3, 64, true);
  // forest debris: scanned stumps and fallen dead trunks lying on the slope
  const debris = (model, count, sMin, sMax, dist, lying) => {
    if (!model) return;
    const parts = extractParts(model), dim = normalizeParts(parts, !lying), items = [];
    for (let k = 0; k < count * 10 && items.length < count; k++) {
      const x = (prng() * 2 - 1) * (HALF - 20), z = (prng() * 2 - 1) * (HALF - 20), f = FOREST[hf.idx(x, z)];
      if (f < 0.4 || prng() > f || nearSpawn(x, z)) continue;
      const h = hf.heightAt(x, z); if (h < 3) continue;
      hf.normalAt(x, z, nrm); if (nrm.y < 0.82) continue;
      const s = lerp(sMin, sMax, prng());
      items.push({ x, y: placeLow(x, z, s * dim.w * 0.3) - s * dim.h * (lying ? 0.25 : 0.08), z, s, r: prng() * 6.28, tilt: Math.atan2(nrm.z, nrm.y) * 0.8, tilt2: -Math.atan2(nrm.x, nrm.y) * 0.8 });
      if (s * dim.h > 0.4) addCircle(x, z, s * dim.w * (lying ? 0.18 : 0.35));
    }
    new Scatter(items, [{ dist, parts: parts.map(p => ({ ...p, castShadow: true })) }], 96);
  };
  debris(stump, 500, 0.45, 1.0, () => Q.rocks * 0.3, false);
  debris(deadTrunk, 120, 5, 9, () => Q.rocks * 0.3, true);

  const _n = new THREE.Vector3();
  return {
    hf, grass, water, spawn, sakura, sites: { dock: dockS, shrine: shrineS, cottage: cottageS },
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
