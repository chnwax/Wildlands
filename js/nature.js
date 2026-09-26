// "Wildlands" — lake valley, conifer forests, mountains.
import { THREE, Q, clamp, lerp, smoothstep, mulberry32, tick, fbm, erosion, loadTex, phTex, NFLAT, loadModel, extractParts, normalizeParts, Scatter, addCircle, clearColliders } from './core.js';
import { Heightfield, terrainMaterial, buildTerrainMeshes, buildGrass, buildWater, buildForest, treeColor } from './terrain.js';

export const meta = { name: 'Wildlands', startHour: 16.4, sunAzimuth: 2.2, life: { flockCenter: { x: 40, y: 0, z: -60 } } };
const LAKE_X = 40, LAKE_Z = -60;

function height(x, z) {
  const wx = x + 70 * fbm(x * 0.0021 + 3.1, z * 0.0021 + 7.7, 3);
  const wz = z + 70 * fbm(x * 0.0021 - 5.3, z * 0.0021 + 1.9, 3);
  const d = Math.hypot(wx, wz * 0.85);
  const mm = smoothstep(380, 1150, d);
  const e = erosion(wx * 0.0017 + 11.3, wz * 0.0017 - 4.2) * 0.5 + 0.5;
  const hills = fbm(wx * 0.0055, wz * 0.0055, 5);
  const h = 7 + hills * (10 - mm * 4) + e * e * (38 + 380 * mm) + mm * 30;
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
    urban: { d: phTex('coast_sand_01', 'diff', '2k', true), n: phTex('coast_sand_01', 'nor_gl', '1k', false, NFLAT), s: 4 },
  };
  const models = Promise.all(['rock_moss_set_01', 'boulder_01', 'fern_02', 'shrub_02', 'tree_stump_01', 'dead_tree_trunk'].map(loadModel));

  await hf.generate(p => progress('Sculpting terrain', p * 0.4), 0, 1);
  // forest density
  const FOREST = new Float32Array(HN * HN);
  for (let j = 0; j < HN; j++) {
    for (let i = 0; i < HN; i++) {
      const x = -HALF + i * CELL, z = -HALF + j * CELL, h = hf.H[j * HN + i];
      const f = fbm(x * 0.0042 + 40, z * 0.0042 - 17, 4) * 0.85 + fbm(x * 0.02, z * 0.02, 2) * 0.3;
      const v = smoothstep(-0.02, 0.22, f) * smoothstep(2.5, 6, h) * (1 - smoothstep(140, 195, h)) * smoothstep(0.78, 0.9, hf.gridNormalY(i, j));
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
    const s = lerp(11, 25, Math.pow(rng(), 1.3)) * (0.75 + 0.25 * f) * (1 - smoothstep(120, 205, h) * 0.45);
    trees.push({ x, y: h - 0.25, z, s, sx: 0.85 + rng() * 0.35, r: rng() * Math.PI * 2, tilt: (rng() - 0.5) * 0.05, tilt2: (rng() - 0.5) * 0.05, c: treeColor(rng) });
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
  for (let i = trees.length - 1; i >= 0; i--) if (Math.hypot(trees[i].x - spawn.x, trees[i].z - spawn.z) < 9) trees.splice(i, 1);
  hf.paintCanopy(trees);
  hf.uploadHeight(); hf.uploadMasks();
  progress('Building terrain', 0.68); await tick();
  buildTerrainMeshes(hf, terrainMaterial(hf, layers, { water: 0, snow: 175, shore: 0.8 }));
  progress('Planting trees', 0.78); await tick();
  buildForest(trees);
  const grass = buildGrass(hf, layers.grass.d, { water: 0, shore: 0.8, reeds: true });
  const water = buildWater(hf, { level: 0, normals: loadTex('tex/waternormals.jpg', false, NFLAT), hide: [grass] });

  progress('Placing rocks and plants', 0.9); await tick();
  await models;
  const [rockSet, boulder, fern, shrub, stump, deadTrunk] = await models;
  const prng = mulberry32(777);
  const placeLow = (x, z, r) => Math.min(hf.heightAt(x - r, z - r), hf.heightAt(x + r, z - r), hf.heightAt(x - r, z + r), hf.heightAt(x + r, z + r), hf.heightAt(x, z));
  const nearSpawn = (x, z) => Math.hypot(x - spawn.x, z - spawn.z) < 7;
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
    hf, grass, water, spawn,
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
    update() {},
  };
}
