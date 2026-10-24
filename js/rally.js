// Rally Stage: a closed gravel special stage on flat ground, for the car (car.js). The road is a loop of about 4.6 km
// laid out like a turtle's walk (straights, and arcs of a given radius and angle: a chicane, fast sweepers, square
// ninety-degree corners, two pairs of hairpins), its small closing error spread along the whole loop and its joins
// smoothed so each corner tightens and opens like a real road's. A distance field over the map (2 m cells: the distance
// to the centre line and the nearest point on it) answers what the ground is under a wheel, where the trees may stand
// and how far round the stage the car has come (the stage clock). The road: the ground's own gravel layer under it
// (soft edges into the grass), and a ribbon of graded gravel over that with the two wheel ruts and loose gravel on the
// crown and the edges. Pine, spruce and birch woods in patches, meadows between; chevron boards on the outside of the
// tight corners, straw bales and tape at the hairpins and the chicane, the start and finish arch with its line.
import { THREE, scene, clamp, lerp, smoothstep, mulberry32, tick, phTex, NFLAT, maxAniso, addCircle, addBox } from './core.js';
import { Heightfield, terrainMaterial, buildTerrainMeshes, buildGrass } from './terrain.js';
import { buildTrees } from './trees.js';
import { makeTree } from './ecology.js';

export const meta = {
  name: 'Rally Stage',
  builder: false,
  startHour: 15.4,
  sunAzimuth: 2.15,
  life: { flowers: true, birds: true, fireflies: 0.3, mist: 0 },
  vehicle: true,
};

// the stage: [S, length] or [L|R, radius, degrees]
const SEGS = [
  ['S', 420], ['R', 45, 40], ['L', 45, 80], ['R', 45, 40], ['S', 260],                                  // start straight, the chicane
  ['L', 90, 90],
  ['S', 200], ['R', 250, 30], ['L', 250, 30], ['S', 140], ['L', 15, 180], ['S', 110], ['R', 15, 180], ['S', 220], // sweepers, hairpins
  ['L', 60, 90],
  ['S', 280], ['R', 25, 90], ['S', 80], ['L', 25, 90], ['S', 150], ['L', 25, 90], ['S', 80], ['R', 25, 90],   // square corners
  ['S', 240], ['L', 300, 15], ['R', 300, 15], ['S', 120],                                                  // the long straight's kink
  ['L', 40, 90],
  ['S', 230], ['R', 60, 60], ['L', 60, 120], ['R', 60, 60], ['S', 180], ['L', 14, 165], ['S', 60], ['R', 16, 165], ['S', 140],
  ['L', 110, 90], ['S', 60],
];
const ROAD = 3.6, SHOULDER = 5.2; // (half widths: the graded gravel, the loose edge)

function trackLine() {
  const D = Math.PI / 180; let x = 0, z = 0, h = 0; const P = [[0, 0]];
  for (const [k, a, b] of SEGS) {
    if (k === 'S') for (let i = 0; i < a; i++) { x += Math.cos(h); z += Math.sin(h); P.push([x, z]); }
    else { const n = Math.max(2, Math.round(a * b * D)), sg = k === 'L' ? 1 : -1; for (let i = 0; i < n; i++) { h += sg * b * D / n; x += Math.cos(h) * a * b * D / n; z += Math.sin(h) * a * b * D / n; P.push([x, z]); } }
  }
  // (the loop closes: what is left of the error is spread along it; the turtle's z is north, the world's south)
  const N = P.length - 1, ex = P[N][0], ez = P[N][1];
  let pts = P.slice(0, N).map(([px, pz], i) => [px - ex * i / N, -(pz - ez * i / N)]);
  // the joins of straights and arcs smoothed (box filter, ±5 m, twice): a corner's curvature ramps in and out
  for (let pass = 0; pass < 2; pass++) { const q = pts.map(() => [0, 0]), K = 5;
    for (let i = 0; i < N; i++) { let sx = 0, sz = 0; for (let k = -K; k <= K; k++) { const p = pts[(i + k + N) % N]; sx += p[0]; sz += p[1]; } q[i] = [sx / (2 * K + 1), sz / (2 * K + 1)]; }
    pts = q; }
  let lx = 1e9, hx = -1e9, lz = 1e9, hz = -1e9; for (const [px, pz] of pts) { lx = Math.min(lx, px); hx = Math.max(hx, px); lz = Math.min(lz, pz); hz = Math.max(hz, pz); }
  const cx = (lx + hx) / 2, cz = (lz + hz) / 2;
  return pts.map(([px, pz]) => [px - cx, pz - cz]);
}

export async function build(progress) {
  progress('Laying out the stage', 0.05); await tick();
  const P = trackLine(), N = P.length;
  const T = P.map((_, i) => { const a = P[(i - 2 + N) % N], b = P[(i + 2) % N], l = Math.hypot(b[0] - a[0], b[1] - a[1]); return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; });
  // signed curvature (left positive: the car's left is +x when it faces +z) over ±6 m
  const K = P.map((_, i) => { const a = T[(i - 6 + N) % N], b = T[(i + 6) % N]; return (a[1] * b[0] - a[0] * b[1]) / 12; });
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
  const { HN, CELL } = hf, FOREST = new Float32Array(HN * HN);
  for (let j = 0; j < HN; j++) for (let i = 0; i < HN; i++) { const x = -HALF + i * CELL, z = -HALF + j * CELL, o = j * HN + i, d = distAt(x, z);
    const f = woods(x, z) * smoothstep(12, 30, d); FOREST[o] = f;
    hf.mask[o * 4] = smoothstep(0.35, 0.8, f) * 235; hf.mask[o * 4 + 1] = 255; hf.mask[o * 4 + 3] = (0.42 + 0.3 * f + 0.12 * Math.sin(x * 0.011 + z * 0.007)) * 255;
    hf.mask2[o * 4] = (1 - smoothstep(ROAD - 0.6, SHOULDER + 0.6, d)) * 255;         // the gravel layer: the road and its edges
    hf.mask2[o * 4 + 2] = (1 - smoothstep(SHOULDER - 0.4, SHOULDER + 1.2, d)) * 255;  // no grass on it
  }
  let bx0 = 1e9, bx1 = -1e9, bz0 = 1e9, bz1 = -1e9; for (const [x, z] of P) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); bz0 = Math.min(bz0, z); bz1 = Math.max(bz1, z); }
  hf.paintPave(bx0 - 8, bz0 - 8, bx1 + 8, bz1 + 8, (x, z) => 1 - smoothstep(ROAD + 0.2, SHOULDER - 0.2, distAt(x, z)));
  // ---- trees
  progress('Planting the woods', 0.28); await tick();
  const trees = [], kinds = [['spruce', 0.42], ['pine', 0.22], ['tall', 0.12], ['birch', 0.14], ['young', 0.1]];
  const pick = r => { let a = 0; for (const [k, w] of kinds) { a += w; if (r < a) return k; } return 'spruce'; };
  const SP = 7.5, edge = HALF - 26;
  for (let z = -edge; z < edge; z += SP) for (let x = -edge; x < edge; x += SP) {
    const px = x + (rng() - 0.5) * SP * 0.9, pz = z + (rng() - 0.5) * SP * 0.9, d = distAt(px, pz); if (d < 9.5) { rng(); rng(); continue; }
    const w = woods(px, pz), dens = w * 0.9 * smoothstep(9.5, 22, d) + (d < 22 && w > 0.3 ? 0.05 : 0) + 0.012; // (a lone tree here and there in the meadows)
    if (rng() > dens) continue;
    const k = w < 0.25 && rng() < 0.6 ? 'birch' : pick(rng());
    trees.push(makeTree(k, px, -0.2, pz, rng, { a: rng() * (d < 20 ? 0.7 : 1), cl: w, br: rng() }));
  }
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
  buildTrees(trees);
  progress('Grading the road', 0.68); await tick();
  const road = roadRibbon(P, T, N);
  const dressing = dressStage(P, T, K, N, left, rng);
  progress('Sowing the meadows', 0.8); await tick();
  const grass = buildGrass(hf, layers.grass.d, { water: -60, snow: 5000, reeds: false, shore: 0.01 });
  progress('Opening the stage', 0.95); await tick();
  // ---- the start: the car on the line facing down the road, the walker beside it
  const s0 = 8, [sx, sz] = P[N - s0], [tx, tz] = T[N - s0], [lx2, lz2] = left(N - s0);
  const carSpawn = { x: sx, z: sz, yaw: Math.atan2(tx, tz) };
  const spawn = { x: sx + lx2 * 5, z: sz + lz2 * 5, yaw: Math.atan2(-tx, -tz), pitch: -0.05 };
  // ---- the stage clock: progress round the loop from the nearest centre-line point; a lap counts only once the car
  // has come round (not by reversing over the line)
  const clock = stageClock(N, nearAt, distAt);
  const world = {
    hf, grass, terrain, road, spawn, carSpawn, track: { P, T, N, distAt, nearAt },
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
    gripAt(x, z) { const d = distAt(x, z); return d < ROAD || d > SHOULDER + 1 ? 1 : lerp(1, 0.84, clamp((d - ROAD) / (SHOULDER - ROAD), 0, 1)); }, // (the loose gravel at the edges)
    ambience(x, z) { return { forest: FOREST[hf.idx(clamp(x, -HALF, HALF), clamp(z, -HALF, HALF))], water: 0, town: 0, insects: 0.4 }; },
    update(dt) { clock.update(dt, world.vehicle); dressing.update && dressing.update(dt); },
  };
  return world;
}

// the graded road over the ground's gravel: 9 m across, its outer metre on each side dissolving into the gravel under it
// (hashed alpha: no sorting, the temporal AA smooths it), darker compacted ruts, loose gravel on the crown and the edges
function roadRibbon(P, T, N) {
  const X = [-4.7, -3.4, -1.65, -0.82, 0, 0.82, 1.65, 3.4, 4.7], A = [0, 1, 1, 1, 1, 1, 1, 1, 0], C = [1.1, 1.06, 0.98, 0.8, 0.94, 0.8, 0.98, 1.06, 1.1];
  const step = 2, M = Math.floor(N / step), nx = X.length, pos = new Float32Array((M + 1) * nx * 3), uv = new Float32Array((M + 1) * nx * 2), col = new Float32Array((M + 1) * nx * 4), idx = [];
  for (let m = 0; m <= M; m++) { const i = (m * step) % N, [px, pz] = P[i], [tx, tz] = T[i], lx = tz, lz = -tx;
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
function dressStage(P, T, K, N, left, rng) {
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
  // the corners: runs of points tighter than 75 m, by their tightest point and their direction
  const corners = []; let s = -1;
  for (let i = 0; i <= N; i++) { const tight = i < N && Math.abs(K[i]) > 1 / 75; if (tight && s < 0) s = i; if (!tight && s >= 0) { let a = s; for (let k = s; k < i; k++) if (Math.abs(K[k]) > Math.abs(K[a])) a = k; corners.push({ s, e: i - 1, apex: a, R: 1 / Math.abs(K[a]), dir: Math.sign(K[a]) }); s = -1; } }
  for (const c of corners) {
    const out = i => { const [lx, lz] = left(i); return [-lx * c.dir, -lz * c.dir]; }; // (the corner's outside)
    // boards along the outside, facing the road, from before the corner to its exit
    const from = c.s - 12, to = c.e + 6, n = Math.max(2, Math.round((to - from) / (c.R < 30 ? 7 : 12)));
    for (let k = 0; k <= n; k++) { const i = (Math.round(from + (to - from) * k / n) + N) % N, [ox, oz] = out(i), [px, pz] = P[i], d = 8.8, x = px + ox * d, z = pz + oz * d, yaw = Math.atan2(-ox, -oz);
      items.board.push([at(x, 1.05, z, yaw), c.dir]); items.back.push(at(x + ox * 0.012, 1.05, z + oz * 0.012, yaw + Math.PI)); items.post.push(at(x + Math.cos(yaw) * 0.45, 0, z - Math.sin(yaw) * 0.45, yaw), at(x - Math.cos(yaw) * 0.45, 0, z + Math.sin(yaw) * 0.45, yaw));
      addBox(x, z, 0.7, 0.12, yaw, 0, 1.4); }
    if (c.R > 45) continue;
    // straw bales on the outside of the tight ones, tape on poles behind
    const nb = c.R < 20 ? 7 : 4;
    for (let k = 0; k < nb; k++) { const i = (c.apex + Math.round((k - (nb - 1) / 2) * 2.6) + N) % N, [ox, oz] = out(i), [px, pz] = P[i], d = 7.9 + rng() * 0.3, x = px + ox * d, z = pz + oz * d;
      items.bale.push(at(x, 0.72, z, Math.atan2(T[i][0], T[i][1]) + Math.PI / 2 + (rng() - 0.5) * 0.15)); addCircle(x, z, 0.75, 0, 1.4); }
    let prev = null;
    for (let i = c.s - 20; i <= c.e + 20; i += 6) { const ii = (i + N) % N, [ox, oz] = out(ii), [px, pz] = P[ii], x = px + ox * 11.5, z = pz + oz * 11.5;
      items.pole.push(at(x, 0, z, 0)); if (prev) tape(prev, [x, z]); prev = [x, z]; }
  }
  function tape(a, b) { const l = Math.hypot(b[0] - a[0], b[1] - a[1]), u = l / 2; for (const y of [0.85]) { const h = 0.05, v = [[a[0], y - h, a[1]], [b[0], y - h, b[1]], [b[0], y + h, b[1]], [a[0], y + h, a[1]]]; const base = tapePos.length / 3; for (const p of [v[0], v[1], v[2], v[0], v[2], v[3]]) tapePos.push(...p); tapeUv.push(0, 0, u, 0, u, 1, 0, 0, u, 1, 0, 1); } }
  const inst = (geo, mat, list, shadow = true) => { if (!list.length) return; const m = new THREE.InstancedMesh(geo, mat, list.length); list.forEach((x, i) => m.setMatrixAt(i, x)); m.castShadow = shadow; m.receiveShadow = true; group.add(m); return m; };
  inst(boardG, boardR, items.board.filter(b => b[1] < 0).map(b => b[0])); inst(boardG, boardL, items.board.filter(b => b[1] > 0).map(b => b[0]));
  inst(new THREE.PlaneGeometry(1.32, 0.67), backM, items.back, false); inst(postG, postM, items.post); inst(baleG, baleM, items.bale);
  inst(new THREE.CylinderGeometry(0.025, 0.025, 1.0, 6).translate(0, 0.5, 0), poleM, items.pole, false);
  if (tapePos.length) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(tapePos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(tapeUv, 2)); g.computeVertexNormals(); group.add(new THREE.Mesh(g, tapeM)); }
  // ---- the start and finish: an arch over the road at the line, a chequered line across it
  const i0 = 0, [px, pz] = P[i0], [tx, tz] = T[i0], [lx, lz] = left(i0), yaw = Math.atan2(tx, tz);
  const banner = canvasTex(1024, 128, (g, w, h) => { g.fillStyle = '#10161f'; g.fillRect(0, 0, w, h); for (let i = 0; i < 16; i++) for (let j = 0; j < 4; j++) { g.fillStyle = (i + j) % 2 ? '#fff' : '#111'; g.fillRect(i * 8, j * 32, 8, 32); g.fillRect(w - 128 + i * 8, j * 32, 8, 32); }
    g.fillStyle = '#fff'; g.font = '700 64px "Segoe UI", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('START  ·  FINISH', w / 2, h / 2 + 2); g.fillStyle = '#e2b13c'; g.fillRect(140, h - 10, w - 280, 4); });
  const archM = new THREE.MeshStandardMaterial({ color: 0x2a2f38, roughness: 0.6, metalness: 0.3 }), bannerM = new THREE.MeshStandardMaterial({ map: banner, roughness: 0.7 });
  const arch = new THREE.Group(); arch.position.set(px, 0, pz); arch.rotation.y = yaw; group.add(arch);
  for (const sd of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.35, 5.4, 0.35), archM); post.position.set(sd * 6.2, 2.7, 0); post.castShadow = true; arch.add(post); addBox(px + lx * sd * 6.2, pz + lz * sd * 6.2, 0.25, 0.25, yaw, 0, 5.4); }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(12.8, 0.3, 0.3), archM); beam.position.set(0, 5.3, 0); beam.castShadow = true; arch.add(beam);
  for (const sd of [-1, 1]) { const ban = new THREE.Mesh(new THREE.PlaneGeometry(11.6, 1.45), bannerM); ban.position.set(0, 4.45, sd * 0.16); ban.rotation.y = sd < 0 ? Math.PI : 0; ban.castShadow = true; arch.add(ban); } // (read the right way from either side)
  const chq = canvasTex(512, 64, (g, w, h) => { for (let i = 0; i < 32; i++) for (let j = 0; j < 4; j++) { g.fillStyle = (i + j) % 2 ? '#f2f2ee' : '#1a1a1a'; g.fillRect(i * 16, j * 16, 16, 16); } });
  const line = new THREE.Mesh(new THREE.PlaneGeometry(7.6, 0.95).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: chq, roughness: 0.85, transparent: true, opacity: 0.88, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }));
  line.position.set(0, 0.02, 0); line.receiveShadow = true; arch.add(line);
  arch.updateMatrixWorld(true);
  return { group, corners };
}

// the stage clock: a lap from the line round to the line, its time on screen, the best one kept on this computer
function stageClock(N, nearAt, distAt) {
  const el = document.createElement('div'); el.id = 'stageClock';
  el.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:9;color:#fff;font:600 15px/1.25 "Segoe UI",system-ui,sans-serif;text-shadow:0 1px 3px #000b;text-align:center;pointer-events:none;letter-spacing:.02em';
  document.body.appendChild(el);
  let best = 0; try { best = +localStorage.getItem('wl_rally_best') || 0; } catch (e) {}
  const st = { running: false, t: 0, last: -1, prog: 0, lastLap: 0, msg: '', msgT: 0, frame: 0 };
  const fmt = t => { const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2); };
  return {
    update(dt, car) {
      if (!car) { el.style.display = 'none'; return; }
      el.style.display = car.driving ? '' : 'none';
      const p = car.st.pos, i = nearAt(p.x, p.z), on = i >= 0 && distAt(p.x, p.z) < 25;
      if (on && st.last >= 0) { let d = i - st.last; if (d < -N / 2) d += N; else if (d > N / 2) d -= N;
        const crossed = d > 0 && st.last > N - 60 && i < 60; // (forward over the line)
        if (st.running) { st.prog += d; st.t += dt; }
        if (crossed) { if (st.running && st.prog > N * 0.9) { st.lastLap = st.t; const nb = !best || st.t < best; if (nb) { best = st.t; try { localStorage.setItem('wl_rally_best', String(best)); } catch (e) {} } st.msg = (nb ? 'NEW BEST  ' : 'STAGE TIME  ') + fmt(st.t); st.msgT = 5; }
          st.running = true; st.t = 0; st.prog = 0; } }
      if (on) st.last = i;
      if (st.msgT > 0) st.msgT -= dt;
      if (++st.frame % 4) return;
      const head = st.running ? `<div style="font:700 30px/1.1 'Segoe UI',system-ui;letter-spacing:0">${fmt(st.t)}</div><div style="opacity:.8;font-size:12px">${Math.round(clamp(st.prog / N, 0, 1) * 100)}% · ${(st.prog * 0.001).toFixed(2)} / ${(N * 0.001).toFixed(2)} km</div>` : '<div style="opacity:.9">Drive over the start line to begin the stage</div>';
      el.innerHTML = head + `<div style="opacity:.75;font-size:12px">${best ? 'best ' + fmt(best) : ''}${st.lastLap ? ' · last ' + fmt(st.lastLap) : ''}</div>` + (st.msgT > 0 ? `<div style="margin-top:6px;font:700 20px 'Segoe UI';color:#ffd34a">${st.msg}</div>` : '');
    },
  };
}
