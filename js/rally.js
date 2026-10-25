// Rally Stage: a point-to-point gravel special stage on flat ground, for the car (car.js). A hand-shaped route crosses
// four distinct forest sections through fast sweepers, linked corners, square turns and two slow reversals. A distance
// field over the map (2 m cells: the distance
// to the centre line and the nearest point on it) answers what the ground is under a wheel, where the trees may stand
// and how far round the stage the car has come (the stage clock). The road: the ground's own gravel layer under it
// (soft edges into the grass), and a ribbon of graded gravel over that with the two wheel ruts and loose gravel on the
// crown and the edges. Pine, spruce and birch woods in patches, meadows between; chevron boards on the outside of the
// tight corners, straw bales and tape at the hairpins and the chicane, the start and finish arch with its line.
import { THREE, scene, clamp, lerp, smoothstep, mulberry32, tick, phTex, NFLAT, maxAniso, addCircle, addBox } from './core.js';
import { Heightfield, terrainMaterial, buildTerrainMeshes, buildGrass } from './terrain.js';
import { buildTrees, buildBushes, buildLogs } from './trees.js';
import { plantForest, forestFloor } from './ecology.js';

export const meta = {
  name: 'Rally Stage',
  builder: false,
  startHour: 15.4,
  sunAzimuth: 2.15,
  life: { flowers: true, birds: true, fireflies: 0.3, mist: 0 },
  vehicle: true,
};

const ROAD = 3.6, SHOULDER = 5.2; // (half widths: the graded gravel, the loose edge)

function trackLine() {
  const way = [[-900, -820], [-720, -830], [-520, -800], [-300, -720], [-80, -760], [160, -730], [420, -700], [650, -690],
    [780, -650], [860, -580], [885, -500], [860, -430], [790, -370], [690, -330], [500, -300], [330, -190],
    [230, -175], [150, -220], [70, -250], [-20, -215], [-110, -180], [-250, -210],
    [-500, -170], [-700, -110], [-830, -20], [-880, 80], [-855, 170], [-790, 250], [-650, 330],
    [-450, 400], [-250, 455], [-40, 450], [150, 380], [300, 400], [390, 470], [470, 550], [570, 590], [690, 620], [800, 790]];
  const curve = new THREE.CatmullRomCurve3(way.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
  const length = curve.getLength(), n = Math.max(2, Math.round(length)), pts = [];
  for (let i = 0; i <= n; i++) { const p = curve.getPointAt(i / n); pts.push([p.x, p.z]); }
  return pts;
}

export async function build(progress) {
  progress('Laying out the stage', 0.05); await tick();
  const P = trackLine(), N = P.length;
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

  // ---- woods: patches from a few long waves, thinned toward the road, none on it
  const rng = mulberry32(4471), ph = Array.from({ length: 8 }, () => [rng() * 6.28, 0.6 + rng() * 0.8, rng() * 6.28]);
  const woods = (x, z) => { let n = 0; for (let k = 0; k < 8; k++) { const [a, f, p] = ph[k], s = 0.0028 * f * (1 + k * 0.45); n += Math.sin((x * Math.cos(a) + z * Math.sin(a)) * s + p) / (1 + k * 0.6); } return smoothstep(-0.1, 0.9, n * 0.75 + 0.1); };
  progress('Grading the ground', 0.18); await tick();
  const hf = new Heightfield({ world: WORLD, grid: 1024, height: () => 0 });
  await hf.generate(p => progress('Grading the ground', 0.18 + 0.06 * p));
  const { HN, CELL } = hf, FOREST = new Float32Array(HN * HN), MOIST = new Float32Array(HN * HN);
  for (let j = 0; j < HN; j++) for (let i = 0; i < HN; i++) { const x = -HALF + i * CELL, z = -HALF + j * CELL, o = j * HN + i, d = distAt(x, z);
    const f = woods(x, z) * smoothstep(12, 30, d), moist = clamp(0.48 + 0.22 * Math.sin(x * 0.011 + z * 0.007) + 0.1 * Math.sin(z * 0.021), 0, 1); FOREST[o] = f; MOIST[o] = moist;
    hf.mask[o * 4] = smoothstep(0.35, 0.8, f) * 235; hf.mask[o * 4 + 1] = 255; hf.mask[o * 4 + 3] = moist * 255;
    hf.mask2[o * 4] = (1 - smoothstep(ROAD - 0.6, SHOULDER + 0.6, d)) * 255;         // the gravel layer: the road and its edges
    hf.mask2[o * 4 + 2] = (1 - smoothstep(SHOULDER - 0.4, SHOULDER + 1.2, d)) * 255;  // no grass on it
  }
  let bx0 = 1e9, bx1 = -1e9, bz0 = 1e9, bz1 = -1e9; for (const [x, z] of P) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); bz0 = Math.min(bz0, z); bz1 = Math.max(bz1, z); }
  hf.paintPave(bx0 - 8, bz0 - 8, bx1 + 8, bz1 + 8, (x, z) => 1 - smoothstep(ROAD + 0.2, SHOULDER - 0.2, distAt(x, z)));
  // ---- the same forest ecology used by Wildlands: mixed ages and stands, broadleaf fringe, old conifers, dead trees
  progress('Planting the woods', 0.28); await tick();
  const blocked = (x, z, pad = 0) => distAt(x, z) < 10.5 + pad;
  const { trees, saplings } = plantForest({ hf, forest: FOREST, moist: MOIST, seed: 99, water: -60, snow: 5000, blocked,
    alpine: [110, 175], lowland: [22, 60], meadow: 700, meadowMaxH: 95, sakura: false, step: 4.8 });
  const floor = forestFloor({ hf, forest: FOREST, moist: MOIST, trees, seed: 5, water: -60, blocked, logs: 260, twigs: 2800, shrubs: 1200 });
  hf.paintCanopy(trees);
  hf.uploadHeight(); hf.uploadMasks();
  progress('Shaping the ground', 0.4); await tick();
  const layers = {
    grass: { d: phTex('aerial_grass_rock', 'diff', '2k', true, [92, 98, 52]), n: phTex('aerial_grass_rock', 'nor_gl', '2k', false, NFLAT), s: 6, tint: [0.95, 1.06, 0.8] },
    forest: { d: phTex('forest_leaves_03', 'diff', '2k', true, [70, 58, 40]), n: phTex('forest_leaves_03', 'nor_gl', '1k', false, NFLAT), s: 3 },
    rock: { d: phTex('rock_face_03', 'diff', '2k', true, [110, 100, 90]), n: phTex('rock_face_03', 'nor_gl', '2k', false, NFLAT), s: 9 },
    shore: { d: phTex('coast_sand_01', 'diff', '2k', true, [140, 125, 100]), n: phTex('coast_sand_01', 'nor_gl', '1k', false, NFLAT), s: 4, tint: [0.78, 0.72, 0.6] },
    urban: { d: phTex('bicolour_gravel', 'diff', '1k', true), n: phTex('bicolour_gravel', 'nor_gl', '1k', false, NFLAT), s: 2.5, tint: [1.08, 0.98, 0.84], norm: 0.5 },
  };
  const terrain = await buildTerrainMeshes(hf, terrainMaterial(hf, layers, { water: -60, snow: 5000, shore: 0.01, conifer: 0.7 }));
  progress('Growing the woods', 0.55); await tick();
  buildTrees([...trees, ...saplings]);
  buildBushes(floor.shrubs, 'bush');
  buildTrees(floor.twigs, { colliders: false });
  buildLogs(floor.logs);
  progress('Grading the road', 0.68); await tick();
  const road = roadRibbon(P, T, N);
  const startI = 14, finishI = N - 28, dressing = dressStage(P, T, K, N, left, rng, startI, finishI);
  progress('Sowing the meadows', 0.8); await tick();
  const grass = buildGrass(hf, layers.grass.d, { water: -60, snow: 5000, reeds: false, shore: 0.01 });
  progress('Opening the stage', 0.95); await tick();
  // ---- the start: the car on the line facing down the road, the walker beside it
  const s0 = 8, [sx, sz] = P[s0], [tx, tz] = T[s0], [lx2, lz2] = left(s0);
  const carSpawn = { x: sx, z: sz, yaw: Math.atan2(tx, tz) };
  const spawn = { x: sx + lx2 * 5, z: sz + lz2 * 5, yaw: Math.atan2(-tx, -tz), pitch: -0.05 };
  const clock = stageClock(N, nearAt, distAt, dressing.corners, startI, finishI, carSpawn);
  const world = {
    hf, grass, terrain, road, spawn, carSpawn, track: { P, T, N, distAt, nearAt }, race: clock,
    bounds: { minX: -HALF + 30, maxX: HALF - 30, minZ: -HALF + 30, maxZ: HALF - 30 },
    waterLevel: -60, waterAt: () => -60,
    groundAt: (x, z) => hf.groundAt(x, z),
    normalAt: (x, z, out) => out.set(0, 1, 0),
    surfaceAt(x, z) { const d = distAt(x, z); return d < SHOULDER ? 'gravel' : FOREST[hf.idx(x, z)] > 0.5 ? 'forest' : 'grass'; },
    // (the car feels the road's surface: corrugations and the odd pothole on the gravel, a softer roll on the grass)
    bumpAt(x, z) { const d = distAt(x, z), g = 1 - smoothstep(ROAD, SHOULDER + 1, d);
      const b = Math.sin(x * 1.1 + z * 0.5) * Math.sin(z * 0.9 - x * 0.3) * 0.003 + Math.sin(x * 0.37 - z * 0.41) * Math.sin(z * 0.29 + x * 0.19) * 0.012;
      const pot = -0.045 * smoothstep(0.975, 0.995, Math.sin(x * 0.173 + 1.3) * Math.sin(z * 0.151 + 0.4));
      return b * (0.45 + 0.55 * g) + pot * g; },
    gripAt(x, z) { const d = distAt(x, z); return d < ROAD || d > SHOULDER + 1 ? 1 : lerp(1, 0.93, clamp((d - ROAD) / (SHOULDER - ROAD), 0, 1)); }, // (the loose gravel at the edges)
    ambience(x, z) { return { forest: FOREST[hf.idx(clamp(x, -HALF, HALF), clamp(z, -HALF, HALF))], water: 0, town: 0, insects: 0.4 }; },
    restartStage() { clock.reset(); },
    update(dt) { clock.update(dt, world.vehicle); dressing.update && dressing.update(dt); },
  };
  return world;
}

// the graded road over the ground's gravel: 9 m across, its outer metre on each side dissolving into the gravel under it
// (hashed alpha: no sorting, the temporal AA smooths it), darker compacted ruts, loose gravel on the crown and the edges
function roadRibbon(P, T, N) {
  const X = [-4.7, -3.4, -1.65, -0.82, 0, 0.82, 1.65, 3.4, 4.7], A = [0, 1, 1, 1, 1, 1, 1, 1, 0], C = [1.1, 1.06, 0.98, 0.8, 0.94, 0.8, 0.98, 1.06, 1.1];
  const step = 2, M = Math.ceil((N - 1) / step), nx = X.length, pos = new Float32Array((M + 1) * nx * 3), uv = new Float32Array((M + 1) * nx * 2), col = new Float32Array((M + 1) * nx * 4), idx = [];
  for (let m = 0; m <= M; m++) { const i = Math.min(N - 1, m * step), [px, pz] = P[i], [tx, tz] = T[i], lx = tz, lz = -tx;
    for (let k = 0; k < nx; k++) { const o = m * nx + k, w = X[k] + (k === 0 || k === nx - 1 ? Math.sin(m * 0.7) * 0.25 + Math.sin(m * 0.23) * 0.3 : 0);
      pos.set([px + lx * w, 0.012, pz + lz * w], o * 3); uv.set([w / 2.5, m * step / 2.5], o * 2);
      const v = C[k] * (0.96 + 0.08 * Math.sin(m * 0.37 + k)); col.set([v, v, v, A[k]], o * 4); } }
  for (let m = 0; m < M; m++) for (let k = 0; k < nx - 1; k++) { const a = m * nx + k, b = a + nx; idx.push(a, a + 1, b, a + 1, b + 1, b); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.BufferAttribute(col, 4)); g.setIndex(idx); g.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0xb8a68c, map: phTex('bicolour_gravel', 'diff', '1k', true), normalMap: phTex('bicolour_gravel', 'nor_gl', '1k', false, NFLAT), normalScale: new THREE.Vector2(0.6, 0.6),
    roughness: 0.97, metalness: 0, vertexColors: true, alphaHash: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const mesh = new THREE.Mesh(g, mat); mesh.receiveShadow = true; mesh.name = 'rally-road'; scene.add(mesh);
  return mesh;
}

// boards, bales, tape and the start arch
function dressStage(P, T, K, N, left, rng, startI, finishI) {
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
  const items = { board: [], post: [], back: [], bale: [], pole: [] }, tapePos = [], tapeUv = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0), S1 = new THREE.Vector3(1, 1, 1);
  const at = (x, y, z, yaw) => m4.compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(UP, yaw), S1).clone();
  // the corners: runs of signed curvature, by their tightest point and direction; the wider runs are kept for pace notes
  const corners = []; let s = -1;
  for (let i = 0; i <= N; i++) { const tight = i < N && Math.abs(K[i]) > 1 / 500; if (tight && s < 0) s = i; if (!tight && s >= 0) { let a = s; for (let k = s; k < i; k++) if (Math.abs(K[k]) > Math.abs(K[a])) a = k; if (a > startI + 45 && a < finishI - 40) corners.push({ s, e: i - 1, apex: a, R: 1 / Math.abs(K[a]), dir: Math.sign(K[a]) }); s = -1; } }
  for (const c of corners) {
    if (c.R > 95) continue;
    const out = i => { const [lx, lz] = left(i); return [-lx * c.dir, -lz * c.dir]; }; // (the corner's outside)
    // boards along the outside, facing the road, from before the corner to its exit
    const from = Math.max(0, c.s - 12), to = Math.min(N - 1, c.e + 6), n = Math.max(2, Math.round((to - from) / (c.R < 30 ? 7 : 12)));
    for (let k = 0; k <= n; k++) { const i = Math.round(from + (to - from) * k / n), [ox, oz] = out(i), [px, pz] = P[i], d = 8.8, x = px + ox * d, z = pz + oz * d, yaw = Math.atan2(-ox, -oz);
      items.board.push([at(x, 1.05, z, yaw), c.dir]); items.back.push(at(x + ox * 0.012, 1.05, z + oz * 0.012, yaw + Math.PI)); items.post.push(at(x + Math.cos(yaw) * 0.45, 0, z - Math.sin(yaw) * 0.45, yaw), at(x - Math.cos(yaw) * 0.45, 0, z + Math.sin(yaw) * 0.45, yaw));
      addBox(x, z, 0.7, 0.12, yaw, 0, 1.4); }
    if (c.R > 45) continue;
    // straw bales on the outside of the tight ones, tape on poles behind
    const nb = c.R < 20 ? 7 : 4;
    for (let k = 0; k < nb; k++) { const i = clamp(c.apex + Math.round((k - (nb - 1) / 2) * 2.6), 0, N - 1), [ox, oz] = out(i), [px, pz] = P[i], d = 7.9 + rng() * 0.3, x = px + ox * d, z = pz + oz * d;
      items.bale.push(at(x, 0.72, z, Math.atan2(T[i][0], T[i][1]) + Math.PI / 2 + (rng() - 0.5) * 0.15)); addCircle(x, z, 0.75, 0, 1.4); }
    let prev = null;
    for (let i = Math.max(0, c.s - 20); i <= Math.min(N - 1, c.e + 20); i += 6) { const ii = i, [ox, oz] = out(ii), [px, pz] = P[ii], x = px + ox * 11.5, z = pz + oz * 11.5;
      items.pole.push(at(x, 0, z, 0)); if (prev) tape(prev, [x, z]); prev = [x, z]; }
  }
  function tape(a, b) { const l = Math.hypot(b[0] - a[0], b[1] - a[1]), u = l / 2; for (const y of [0.85]) { const h = 0.05, v = [[a[0], y - h, a[1]], [b[0], y - h, b[1]], [b[0], y + h, b[1]], [a[0], y + h, a[1]]]; const base = tapePos.length / 3; for (const p of [v[0], v[1], v[2], v[0], v[2], v[3]]) tapePos.push(...p); tapeUv.push(0, 0, u, 0, u, 1, 0, 0, u, 1, 0, 1); } }
  const inst = (geo, mat, list, shadow = true) => { if (!list.length) return; const m = new THREE.InstancedMesh(geo, mat, list.length); list.forEach((x, i) => m.setMatrixAt(i, x)); m.castShadow = shadow; m.receiveShadow = true; group.add(m); return m; };
  inst(boardG, boardR, items.board.filter(b => b[1] < 0).map(b => b[0])); inst(boardG, boardL, items.board.filter(b => b[1] > 0).map(b => b[0]));
  inst(new THREE.PlaneGeometry(1.32, 0.67), backM, items.back, false); inst(postG, postM, items.post); inst(baleG, baleM, items.bale);
  inst(new THREE.CylinderGeometry(0.025, 0.025, 1.0, 6).translate(0, 0.5, 0), poleM, items.pole, false);
  if (tapePos.length) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(tapePos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(tapeUv, 2)); g.computeVertexNormals(); group.add(new THREE.Mesh(g, tapeM)); }
  const chq = canvasTex(512, 64, (g, w, h) => { for (let i = 0; i < 32; i++) for (let j = 0; j < 4; j++) { g.fillStyle = (i + j) % 2 ? '#f2f2ee' : '#1a1a1a'; g.fillRect(i * 16, j * 16, 16, 16); } });
  const archM = new THREE.MeshStandardMaterial({ color: 0x2a2f38, roughness: 0.6, metalness: 0.3 });
  const archAt = (i0, label, gold) => { const [px, pz] = P[i0], [tx, tz] = T[i0], [lx, lz] = left(i0), yaw = Math.atan2(tx, tz);
    const banner = canvasTex(1024, 128, (g, w, h) => { g.fillStyle = gold ? '#6e1719' : '#10161f'; g.fillRect(0, 0, w, h); for (let i = 0; i < 16; i++) for (let j = 0; j < 4; j++) { g.fillStyle = (i + j) % 2 ? '#fff' : '#111'; g.fillRect(i * 8, j * 32, 8, 32); g.fillRect(w - 128 + i * 8, j * 32, 8, 32); }
      g.fillStyle = '#fff'; g.font = '700 68px "Segoe UI", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, w / 2, h / 2 + 2); g.fillStyle = gold ? '#ffe06a' : '#e2b13c'; g.fillRect(140, h - 10, w - 280, 4); });
    const bannerM = new THREE.MeshStandardMaterial({ map: banner, roughness: 0.7 }), arch = new THREE.Group(); arch.position.set(px, 0, pz); arch.rotation.y = yaw; group.add(arch);
    for (const sd of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.35, 5.4, 0.35), archM); post.position.set(sd * 6.2, 2.7, 0); post.castShadow = true; arch.add(post); addBox(px + lx * sd * 6.2, pz + lz * sd * 6.2, 0.25, 0.25, yaw, 0, 5.4); }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(12.8, 0.3, 0.3), archM); beam.position.set(0, 5.3, 0); beam.castShadow = true; arch.add(beam);
    for (const sd of [-1, 1]) { const ban = new THREE.Mesh(new THREE.PlaneGeometry(11.6, 1.45), bannerM); ban.position.set(0, 4.45, sd * 0.16); ban.rotation.y = sd < 0 ? Math.PI : 0; ban.castShadow = true; arch.add(ban); }
    const line = new THREE.Mesh(new THREE.PlaneGeometry(7.6, 0.95).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: chq, roughness: 0.85, transparent: true, opacity: 0.88, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }));
    line.position.set(0, 0.02, 0); line.receiveShadow = true; arch.add(line); arch.updateMatrixWorld(true); };
  archAt(startI, 'START', false); archAt(finishI, 'FINISH', true);
  return { group, corners };
}

// A real point-to-point special stage: start marshal, mandatory split gates, finish timing and a Polish co-driver.
function stageClock(N, nearAt, distAt, corners, startI, finishI, spawn) {
  const host = document.createElement('div'); host.id = 'stageClock';
  host.style.cssText = 'position:fixed;inset:0;z-index:9;color:#fff;font:600 15px/1.25 "Segoe UI",system-ui,sans-serif;text-shadow:0 2px 5px #000;pointer-events:none;letter-spacing:.02em';
  host.innerHTML = `<div data-race style="position:absolute;left:50%;top:14px;transform:translateX(-50%);min-width:260px;padding:9px 16px;border-radius:7px;background:#090d13bd;border:1px solid #ffffff28;text-align:center;box-shadow:0 8px 24px #0008"></div><div data-count style="position:absolute;left:50%;top:32%;transform:translate(-50%,-50%);font:900 92px/1 Impact,Haettenschweiler,sans-serif;color:#fff;text-shadow:0 4px 0 #151515,0 0 28px #000;display:none"></div><div data-note style="position:absolute;left:50%;top:116px;transform:translateX(-50%);min-width:330px;padding:10px 18px;border-radius:7px;background:#10151ee8;border-left:6px solid #e1262f;text-align:center;font:800 24px/1.08 'Segoe UI',system-ui;opacity:0;transition:opacity .12s"></div>`;
  document.body.appendChild(host);
  const raceEl = host.querySelector('[data-race]'), countEl = host.querySelector('[data-count]'), noteEl = host.querySelector('[data-note]');
  let best = 0; try { best = +localStorage.getItem('wl_rally_stage_best_v2') || 0; } catch (e) {}
  const grade = r => r < 24 ? 1 : r < 34 ? 2 : r < 48 ? 3 : r < 68 ? 4 : r < 105 ? 5 : 6;
  const phrase = c => `${c.dir > 0 ? 'Lewy' : 'Prawy'} ${grade(c.R)}${c.e - c.s > 42 ? ' długi' : ''}`;
  const raw = corners.filter(c => c.apex > startI + 70 && c.apex < finishI - 35).map(c => ({ at: c.apex, end: c.e, text: phrase(c), dir: c.dir, grade: grade(c.R), long: c.e - c.s > 42 }));
  const notes = [];
  for (let i = 0; i < raw.length; i++) { const a = raw[i], b = raw[i + 1];
    if (b && b.at - a.end < 85) { const tail = a.dir === b.dir ? `${b.grade < a.grade ? 'zaciska' : 'otwiera'} ${b.grade}${b.long ? ' długi' : ''}` : `w ${b.text.toLowerCase()}`; notes.push({ at: a.at, end: b.end, text: `${a.text}, ${tail}`, dir: a.dir, grade: a.grade, linked: true }); i++; }
    else notes.push(a);
  }
  const checkpoints = []; for (let i = startI + 450; i < finishI - 160; i += 450) checkpoints.push(i);
  const st = { phase: 'waiting', t: 0, progress: startI, countdown: 3.8, countSaid: 4, checkpoint: 0, note: 0, noteText: '', noteT: 0, result: 0, newBest: false, frame: 0 };
  const fmt = t => { const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2); };
  const say = text => { if (!text || !('speechSynthesis' in window)) return; const u = new SpeechSynthesisUtterance(text), vs = speechSynthesis.getVoices(); u.voice = vs.find(v => /^pl\b/i.test(v.lang)) || null; u.lang = 'pl-PL'; u.rate = 1.22; u.pitch = 0.86; u.volume = 0.92; speechSynthesis.speak(u); };
  const stopVoice = () => { if ('speechSynthesis' in window) speechSynthesis.cancel(); };
  const lockAtStart = car => { const cs = car.st; cs.pos.set(spawn.x, car.world.groundAt(spawn.x, spawn.z) + car.spec.cg[1] + 0.01, spawn.z); cs.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), spawn.yaw); cs.vel.set(0, 0, 0); cs.ang.set(0, 0, 0); cs.throttle = 0; cs.brake = 1; cs.hand = cs.handEff = 0; for (const w of car.wheels) w.w = 0; };
  const reset = () => { stopVoice(); Object.assign(st, { phase: 'waiting', t: 0, progress: startI, countdown: 3.8, countSaid: 4, checkpoint: 0, note: 0, noteText: '', noteT: 0, result: 0, newBest: false, frame: 0 }); };
  const showNote = (n, distance) => { const lead = distance > 115 ? 'Za sto, ' : distance > 88 ? 'Za osiemdziesiąt, ' : ''; st.noteText = n.text; st.noteT = 3.4; noteEl.innerHTML = `<span style="display:inline-block;width:29px;color:${n.dir > 0 ? '#ffcf45' : '#60baff'}">${n.dir > 0 ? '↶' : '↷'}</span>${n.text}`; say(lead + n.text); };
  const finish = () => { st.phase = 'finished'; st.result = st.t; st.newBest = !best || st.result < best; if (st.newBest) { best = st.result; try { localStorage.setItem('wl_rally_stage_best_v2', String(best)); } catch (e) {} } stopVoice(); say(`${st.newBest ? 'Nowy rekord.' : 'Meta.'} Czas ${Math.floor(st.result / 60)} minut ${Math.round(st.result % 60)} sekund`); st.noteText = ''; st.noteT = 0; };
  const api = { state: st, notes, checkpoints, reset,
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
      if (st.phase === 'waiting') raceEl.innerHTML = '<div style="font-size:18px">ODCINEK SPECJALNY</div><div style="opacity:.75;font-size:12px">Kliknij, aby rozpocząć odliczanie</div>';
      else if (st.phase === 'finished') raceEl.innerHTML = `<div style="color:#ffd54d;font:800 14px 'Segoe UI'">${st.newBest ? 'NOWY REKORD' : 'META'}</div><div style="font:800 34px/1.05 'Segoe UI'">${fmt(st.result)}</div><div style="opacity:.72;font-size:12px">R — ponowny start · rekord ${fmt(best)}</div>`;
      else raceEl.innerHTML = `<div style="font:800 31px/1.05 'Segoe UI'">${fmt(st.t)}</div><div style="height:3px;background:#ffffff28;margin:6px 0 5px"><i style="display:block;height:100%;width:${(pct * 100).toFixed(1)}%;background:#e1252d"></i></div><div style="opacity:.78;font-size:12px">${km.toFixed(2)} km do mety · PK ${st.checkpoint}/${checkpoints.length}${best ? ' · rekord ' + fmt(best) : ''}</div>`;
    },
  };
  return api;
}
