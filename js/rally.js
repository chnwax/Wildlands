// Shared point-to-point rally stage builder for the car (car.js). Each stage supplies a hand-shaped route,
// exact competitive distance, surface and ecology while reusing timing, pace notes and roadside dressing. A distance
// field over the map (2 m cells: the distance
// to the centre line and the nearest point on it) answers what the ground is under a wheel, where the trees may stand
// and how far round the stage the car has come (the stage clock). The road is graded into the terrain and receives
// either a gravel ribbon with wheel ruts or painted asphalt. Wildlands woods border a readable low verge; chevron boards mark the
// tight corners, straw bales and tape at the hairpins and the chicane, the start and finish arch with its line.
import { THREE, scene, camera, clamp, lerp, smoothstep, mulberry32, tick, phTex, loadTex, NFLAT, maxAniso, addCircle, addBox, Scatter, withScatterMeta, erosion, fbm, decimate } from './core.js';
import { Heightfield, terrainMaterial, buildTerrainMeshes, buildGrass, buildWater, setPaint } from './terrain.js';
import { buildTrees, buildBushes, buildLogs } from './trees.js';
import { plantForest, forestFloor } from './ecology.js';
import { audio } from './audio.js';
import { loadPacks, packsReady } from './packs.js';
import { loadPeople, crowdMeshes, CLIP } from './crowd.js';
import { PINE_STAGE } from './stages/pine.js';
import { stageGeometry, stageFields } from './stagedata.js';
import { distCull } from './distcull.js';

// An instanced set cut into cells along the stage, each cell its own bounds: the frustum drops what is behind the camera
// and the distance cull (distcull.js, as in the town) what is too far off to see — a set the length of the stage, its
// bounds the whole map, was drawn whole from anywhere. The cells share the geometry and the material.
const CHUNK = 160;
function chunked(parent, geo, mat, list, { shadow = true, receive = true, name = '' } = {}) {
  if (!list.length) return null;
  const cells = new Map(), v = new THREE.Vector3();
  for (const m of list) { v.setFromMatrixPosition(m); const k = Math.floor(v.x / CHUNK) * 4096 + Math.floor(v.z / CHUNK); let a = cells.get(k); if (!a) cells.set(k, a = []); a.push(m); }
  const out = [];
  for (const a of cells.values()) { const im = new THREE.InstancedMesh(geo, mat, a.length); a.forEach((m, i) => im.setMatrixAt(i, m)); im.castShadow = shadow; im.receiveShadow = receive; im.name = name;
    im.computeBoundingSphere(); parent.add(im); out.push(im); }
  return out;
}
export { PINE_STAGE };

export const meta = {
  name: 'Pine Forest',
  builder: false,
  startHour: 15.4,
  sunAzimuth: 2.15,
  life: { flowers: false, birds: true, fireflies: 0.3, mist: 0.2 },
  vehicle: true,
};

// the race the registry has for a stage opened by itself (?map=): its field drawn, the player in the race's own car
async function defaultRace(map) {
  const { raceOfMap, fieldFor } = await import('./races.js'), race = raceOfMap(map);
  return race ? { field: fieldFor(race), car: race.car, id: race.id } : null;
}

// (the road's widths, set per stage as it is built: RW the asphalt's or the gravel's half width — 1.4 m, one car, unless a stage
// asks for more — and EX how much wider than that one-car road it is; ROAD the clean middle, SHOULDER the edge's end)
let ROAD = 1.3, SHOULDER = 1.6, CLEAR = 3.45, RW = 1.4, EX = 0, LANES = 1;





export async function build(progress, opts) { return buildStage(progress, PINE_STAGE, opts); }

// opts.race: { field: [{name, car, paint?, ...driver}], car: the player's } for a race with rivals, false for a run alone
// against the clock; missing: the race the registry has for this stage, its field drawn at random
export async function buildStage(progress0, cfg, opts = {}) {
  // (how long each step took, kept on the world: the board's loading times and the tests read it)
  const buildLog = [], tB = performance.now(); let tL = tB;
  const progress = (label, p) => { const now = performance.now(); if (buildLog.length) buildLog[buildLog.length - 1].ms = Math.round(now - tL); buildLog.push({ label, ms: 0 }); tL = now; progress0(label, p); };
  // Start loading the same owned Idyllic Woodlands / Illustrated Nature library used by Wildlands. trees.js will
  // automatically use tree02/tree03 and their LODs once it is ready, while installations without the local pack
  // retain the procedural fallback.
  setPaint(cfg.paint); // (each stage's own palette: a dry upland, a dark northern wood, a high massif)
  RW = cfg.half || 1.4; EX = RW - 1.4; LANES = cfg.lanes || 1; ROAD = RW - 0.1; SHOULDER = RW + 0.2; CLEAR = RW + 2.05;
  const packsP = loadPacks(), peopleP = loadPeople().catch(e => { console.warn('rally spectators: ' + e.message); return null; });
  progress('Laying out the stage', 0.05); await tick();
  // ---- the stage's data (stagedata.js): the line, the distance field, the graded ground and its masks — prepared in the
  // background by the preloader (opts.prepared, from prep.worker.js) or, when nothing was, computed here between frames
  const pre = opts.prepared || null, step = async gen => { for (;;) { const r = gen.next(); if (r.done) return r.value; progress(...r.value); await tick(); } };
  const G = await step(stageGeometry(cfg, pre)), { line, P, Y, N, T, K, left, finishAt, distAt, nearAt, rng, project, roadY, surfY, corners, sites, piles, keepClear, clearAt, TUN } = G;
  const { WORLD, HALF, ED, BANK0 } = G.D, mountain = G.mountain, asphalt = G.asphalt, cut = G.cut, eco = cfg.eco || {};
  // (under rock: the tunnels' stations and their approaches (2), the galleries' (1); none of the roadside is set there)
  const COVER = new Uint8Array(N); for (const [a, b] of G.tunnels) for (let i = Math.max(0, a - 16); i <= Math.min(N - 1, b + 16); i++) COVER[i] = 2;
  for (const [a, b] of G.galleries) for (let i = Math.max(0, a - 3); i <= Math.min(N - 1, b + 3); i++) COVER[i] = COVER[i] || 1;
  const covered = i => COVER[clamp(Math.round(i), 0, N - 1)] > 0, WL = cfg.sea ? 0 : cfg.lake ? cfg.lake.level : -60, SHORE = cfg.sea ? 1.6 : cfg.lake ? 0.9 : 0.01; // (WL: the water's level — the sea's, a lake's, or none)
  progress('Grading the ground', 0.18); await tick();
  const F = pre && pre.H ? pre : await step(stageFields(G));
  const PB = { k: 0, t: 0, w: 0, d: 0 };
  const hf = new Heightfield({ world: WORLD, grid: 1024, height: G.terrainHeight });
  hf.H.set(F.H); hf.mask.set(F.mask); hf.mask2.set(F.mask2);
  const { HN, CELL } = hf, FOREST = F.FOREST, MOIST = F.MOIST;
  // which side the hill falls away on (smoothed over ±15 m: +1 the left): the guardrail stands there; on the other side,
  // above the snow line, the plough has left a bank of snow along the road (soft, low grip: the car rides up it)
  const DROP = new Int8Array(N), BANKAMT = new Float32Array(N);
  { const raw = new Float32Array(N); for (let i = 0; i < N; i++) { const [px, pz] = P[i], [lx, lz] = left(i); raw[i] = hf.groundAt(px - lx * (6 + EX), pz - lz * (6 + EX)) - hf.groundAt(px + lx * (6 + EX), pz + lz * (6 + EX)); }
    for (let i = 0; i < N; i++) { let a = 0; for (let k = Math.max(0, i - 15); k <= Math.min(N - 1, i + 15); k++) a += raw[k]; DROP[i] = a > 0 ? 1 : -1;
      if (mountain && cfg.snowLine) BANKAMT[i] = smoothstep(cfg.snowLine - 12, cfg.snowLine + 22, Y[i]) * (0.7 + 0.3 * Math.sin(i * 0.071) + 0.15 * Math.sin(i * 0.23)) * smoothstep(20, 60, i) * (1 - smoothstep(N - 60, N - 25, i)); } }
  // (round a switchback the hill falls away on the outside of the bend: the rail keeps to it through the whole bend)
  for (const c of corners) if (c.R < 40) for (let i = Math.max(0, c.s - 6); i <= Math.min(N - 1, c.e + 6); i++) DROP[i] = -c.dir;
  const bankH = a => { const u = (a - EX - 2.45) / 0.95; return u * u < 1 ? 0.55 * (1 - u * u) ** 0.7 : 0; };
  const snowBank = o => BANKAMT[o.k] > 0.01 && (o.w < 0 ? -1 : 1) === -DROP[o.k] ? bankH(o.d) * BANKAMT[o.k] : 0;
  let bx0 = 1e9, bx1 = -1e9, bz0 = 1e9, bz1 = -1e9; for (const [x, z] of P) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); bz0 = Math.min(bz0, z); bz1 = Math.max(bz1, z); }
  if (WORLD > 1600) { hf.PC = WORLD / 3072; hf.PH = HALF; hf.PN = Math.round(2 * hf.PH / hf.PC); } // (the no-grass mask over the whole of a wider stage)
  hf.paintPave(bx0 - 5, bz0 - 5, bx1 + 5, bz1 + 5, (x, z) => 1 - smoothstep(SHOULDER - 0.05, SHOULDER + 0.35 + 0.15 * Math.sin(x * 0.9 + z * 1.3), distAt(x, z)));
  // ---- the same forest ecology used by Wildlands: mixed ages and stands, broadleaf fringe, old conifers, dead trees
  progress('Planting the woods', 0.28); await tick();
  const blocked = (x, z, pad = 0) => distAt(x, z) < clearAt(x, z) + pad || keepClear(x, z, pad);
  // The same altitude reference and species mix as nature.js: low woodland gets oak/leaf/birch among the conifers.
  const alpine = asphalt, ecologySnow = eco.snow ?? cfg.snowLine ?? 205;
  const { trees, saplings } = plantForest({ hf, forest: FOREST, moist: MOIST, seed: cfg.forestSeed, water: Math.max(0, WL), snow: ecologySnow, blocked,
    alpine: eco.alpine || (alpine ? [38, 76] : [110, 175]), lowland: eco.lowland || (alpine ? [12, 32] : [22, 60]), meadow: 1100, step: eco.step || (alpine ? 5.4 : 4.5),
    broad: eco.broad ?? 1, mix: eco.mix || {} }); // (a stage's own country: no broadleaves in a desert canyon, pines on a dry coast)
  for (const t of saplings) if (t.c && t.c.isColor) t.c.offsetHSL(0.015, -0.2, -0.07); // (the young firs under the canopy dulled: drawn as plain cones, their light green read as teal against the woods)
  const floor = forestFloor({ hf, forest: FOREST, moist: MOIST, trees, seed: cfg.floorSeed, water: Math.max(0, WL), blocked,
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
  // (the tunnels' tubes cut out of the ground: segments along each tube, portal to portal, between the road and the roof)
  const holes = [], tunLen = G.tunnels.reduce((t, [a0, b0]) => t + b0 - a0 + 28, 0), hStep = Math.max(6, Math.ceil(tunLen / 30));
  for (const [a0, b0] of G.tunnels) { const a = Math.max(0, a0 - 14), b = Math.min(N - 1, b0 + 14), hw = RW + 1.25, H = cfg.tunnelH || 7.2;
    let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (let i = a; i <= b; i++) { x0 = Math.min(x0, P[i][0]); z0 = Math.min(z0, P[i][1]); x1 = Math.max(x1, P[i][0]); z1 = Math.max(z1, P[i][1]); }
    hf.paintPave(x0 - hw - 2, z0 - hw - 2, x1 + hw + 2, z1 + hw + 2, (x, z) => { const k = nearAt(x, z); return k >= a && k <= b && distAt(x, z) < hw + 1 ? 1 : 0; }); if (hf.U.tPave.value) hf.U.tPave.value.needsUpdate = true; // (no grass in the tube)
    for (let i = a; i < b; i += hStep) { const j = Math.min(b, i + hStep), y0 = Math.min(surfY(i, 0), surfY(j, 0)), y1 = Math.max(surfY(i, 0), surfY(j, 0)); holes.push([P[i][0], P[i][1], P[j][0], P[j][1], hw + 0.5, y0 + 0.25, y1 + H + 0.8]); } }
  const terrain = await buildTerrainMeshes(hf, terrainMaterial(hf, layers, { water: WL, snow: terrainSnow, shore: SHORE, conifer: 0.7, holes }));
  progress('Growing the woods', 0.55); await tick();
  await packsP;
  buildTrees([...trees, ...saplings]);
  buildBushes(floor.shrubs, 'bush');
  buildTrees(floor.twigs, { colliders: false });
  buildLogs(floor.logs);
  progress('Grading the road', 0.68); await tick();
  const road = roadRibbon(P, T, K, N, surfY, corners, cfg, COVER);
  const covers = buildCovers(P, T, N, left, surfY, G.tunnels, G.galleries, cfg);
  // ---- the start: a race lines its field up two by two, 9 m apart, before the start line; the player's place on the grid
  // is drawn. Alone, the car waits on the line.
  let field = null, grid = null, slot = null;
  const raceOpt = opts.race === false ? null : opts.race || await defaultRace(opts.map);
  if (raceOpt && raceOpt.field && raceOpt.field.length) { field = raceOpt.field; const n = field.length, slots = [], rows = Math.ceil((n + 1) / 2);
    for (let r = 0; r < rows; r++) for (const sd of [1, -1]) if (slots.length < n + 1) slots.push({ s: 6 + 9 * (rows - 1 - r), w: sd * Math.min(RW / 2, RW - 1.15) });
    slot = slots.splice(Math.floor(Math.random() * slots.length), 1)[0]; grid = slots; }
  const startI = field ? 6 + 9 * (Math.ceil((field.length + 1) / 2) - 1) + 9 : 14, finishI = finishAt, dressing = dressStage(P, T, K, N, left, rng, startI, finishI, hf, cfg, corners, sites.filter(c => !covered(c.i)), DROP, surfY, covered);
  progress('Dressing the roadside', 0.76); await tick();
  roadside(P, T, K, N, left, startI, finishI, hf, cfg, piles, distAt, mulberry32(cfg.seed + 23), packsReady(), covered);
  const crowd = spectators(sites.filter(c => !covered(c.i)), await peopleP, hf, P);
  progress('Sowing the meadows', 0.8); await tick();
  const grass = buildGrass(hf, layers.grass.d, { water: WL, snow: terrainSnow, reeds: !!cfg.lake, shore: SHORE });
  // (the sea: the town's planar-reflection water, at level 0, its surf on the rocks at the cliffs' feet)
  // (the sea, or a lake in the valley: the same water, calmer and darker inland)
  const water = cfg.sea ? buildWater(hf, { level: 0, normals: loadTex('tex/waternormals.jpg', false, NFLAT), hide: [grass], deep: '#0e3a5e', mid: '#1c6f8c', shallow: '#4fb0aa', waves: 5, strength: 0.42 })
    : cfg.lake ? buildWater(hf, { level: WL, normals: loadTex('tex/waternormals.jpg', false, NFLAT), hide: [grass], deep: '#14313c', mid: '#28525a', shallow: '#5f8a80', waves: 2, strength: 0.25 }) : null;
  progress('Opening the stage', 0.95); await tick();
  // ---- the car on its place, facing down the road; the walker beside it
  const s0 = field ? slot.s : 8, lane0 = field ? slot.w : 0, [sx, sz] = P[s0], [tx, tz] = T[s0], [lx2, lz2] = left(s0);
  const carSpawn = { x: sx + lx2 * lane0, z: sz + lz2 * lane0, yaw: Math.atan2(tx, tz) };
  const spawn = { x: sx + lx2 * 5, z: sz + lz2 * 5, yaw: Math.atan2(-tx, -tz), pitch: -0.05 };
  const PG = { k: 0, t: 0, w: 0, d: 0 };
  // (past the shoulder the road's edge eases down — or up — into the ground over a metre and a half, as wide as a cell of
  // the ground's grid: read straight off the grid, the ground there dipped toward the cell's far corner, a step of half a
  // metre at the asphalt's edge that threw a wheel off it on a wide road)
  const VERGE = ED + Math.max(1.5, hf.CELL * 0.6);
  const groundBase = (x, z, o) => { if (o.d > VERGE) return hf.groundAt(x, z); const r = roadY(o) + 0.02; return o.d <= SHOULDER ? r : lerp(r, hf.groundAt(x, z), smoothstep(SHOULDER, VERGE, o.d)); };
  if (cfg.roadType === 'gravel') { const PR = { k: 0, t: 0, w: 0, d: 0 }; forestRoad(P, N, startI, surfY, trees, distAt, nearAt, (x, z) => { const o = project(x, z, PR); return o && o.d <= VERGE ? groundBase(x, z, o) : hf.groundAt(x, z); }, mulberry32(cfg.seed + 31), packsReady(), covered); }
  if (BANKAMT.some(v => v > 0.01)) snowBanks(P, T, N, left, DROP, BANKAMT, bankH, (x, z) => { const o = project(x, z, PB); return o ? groundBase(x, z, o) : hf.groundAt(x, z); });
  const clock = stageClock(N, nearAt, distAt, corners, line.features, startI, finishI, carSpawn, cfg, P);
  const world = {
    hf, grass, terrain, road, water, covers, spawn, carSpawn, track: { P, T, N, Y, K, RW, distAt, nearAt, length: line.length, sites, piles, startI, finishI }, race: clock, stage: cfg, raceOpt,
    bounds: { minX: -HALF + 30, maxX: HALF - 30, minZ: -HALF + 30, maxZ: HALF - 30 },
    waterLevel: WL, waterAt: () => WL,
    // (on and beside the road the exact surface, blended into the ground past its edge; elsewhere the terrain)
    groundAt(x, z) { const o = project(x, z, PG); if (!o || o.d > Math.max(VERGE, 3.5 + EX)) return hf.groundAt(x, z); return groundBase(x, z, o) + snowBank(o); },
    normalAt(x, z, out) { const o = project(x, z, PG); if (!o || o.d > Math.max(VERGE, 3.5 + EX) + 0.3) return hf.normalAt(x, z, out); const e = 0.3, hx = world.groundAt(x + e, z) - world.groundAt(x - e, z), hz = world.groundAt(x, z + e) - world.groundAt(x, z - e), l = Math.hypot(hx, 2 * e, hz); return out.set(-hx / l, 2 * e / l, -hz / l); },
    surfaceAt(x, z) { const d = distAt(x, z); if (d < SHOULDER) return cfg.roadType; if (d < 3.5 + EX) { const o = project(x, z, PG); if (o && snowBank(o) > 0.08) return 'snow'; } return FOREST[hf.idx(x, z)] > 0.5 ? 'forest' : 'grass'; },
    // (the car feels the road's surface: on gravel corrugations and the odd pothole, the same ones the road shows dark and
    // wet; on asphalt only the faintest undulation and no holes at all; a softer roll on the grass)
    bumpAt(x, z) { const d = distAt(x, z), g = 1 - smoothstep(ROAD, SHOULDER + 1, d);
      const b = Math.sin(x * 1.1 + z * 0.5) * Math.sin(z * 0.9 - x * 0.3) * 0.003 + Math.sin(x * 0.37 - z * 0.41) * Math.sin(z * 0.29 + x * 0.19) * 0.012;
      if (asphalt && d < SHOULDER + 0.3) return b * 0.25;
      const pot = -0.03 * smoothstep(0.982, 0.997, Math.sin(x * 0.173 + 1.3) * Math.sin(z * 0.151 + 0.4));
      return b * (0.45 + 0.55 * g) + pot * g; },
    gripAt(x, z) { const d = distAt(x, z); return d < ROAD || d > SHOULDER + 1 ? 1 : lerp(1, 0.93, clamp((d - ROAD) / (SHOULDER - ROAD), 0, 1)); }, // (the loose gravel at the edges)
    ambience(x, z) { return { forest: FOREST[hf.idx(clamp(x, -HALF, HALF), clamp(z, -HALF, HALF))], water: 0, town: 0, insects: 0.4 }; },
    restartStage() { clock.reset(); world.raceAI && world.raceAI.reset(); },
    update(dt, t, cam) { clock.update(dt, world.vehicle); world.raceAI && world.raceAI.update(dt, world.vehicle); dressing.update && dressing.update(dt); crowd && crowd.update(dt, world.vehicle); if (cam) distCull(cam); },
  };
  if (field) { progress('Lining up the grid', 0.97); await tick();
    world.raceAI = await (await import('./race.js')).createRace(world, { rivals: field, grid, startI, finishI, lanes: LANES, RW, clock }); }
  // (leaving the stage: its HUD, its voice and its rivals go with it; the scene's objects are released by the session)
  world.dispose = () => { clock.dispose(); if (world.raceAI) world.raceAI.dispose(); world.raceAI = null;
    for (const k of ['tHeight', 'tMask', 'tMask2', 'tPave']) { const t = hf.U[k] && hf.U[k].value; if (t && t.dispose) t.dispose(); }
    if (hf.outer && hf.outer.tex) hf.outer.tex.dispose(); }; // (the ground's own textures: the session finds them only in compiled programs)
  if (buildLog.length) buildLog[buildLog.length - 1].ms = Math.round(performance.now() - tL); world.buildLog = buildLog; world.buildMs = Math.round(performance.now() - tB);
  return world;
}

// The graded road is one car wide, its heights the exact crowned and banked surface (surfY). Its cross-section tells the
// surface's story: on gravel two compacted wheel tracks (darker, the stones pressed in), loose gravel swept to the middle
// and the edges and thrown to the outside of the bends, bare earth at a ragged shoulder and where cars have cut the
// insides of the bends, damp stretches, and dark wet earth in the potholes the car feels (bumpAt); on asphalt a real
// worn surface with darker rubbered wheel tracks, patched repairs, a crumbling edge with worn edge lines and grit dragged
// onto the tarmac at the inside of the corners. A second texture (earth, or grit) is mixed in per vertex (aDirt).
function roadRibbon(P, T, K, N, surfY, corners, cfg, COVER = null) {
  const asphalt = cfg.roadType === 'asphalt';
  const X = asphalt ? (LANES > 1 ? [-1, -0.92, -0.86, -0.8, -0.7, -0.6, -0.5, -0.42, -0.34, -0.25, -0.17, -0.08, 0, 0.08, 0.17, 0.25, 0.34, 0.42, 0.5, 0.6, 0.7, 0.8, 0.86, 0.92, 1].map(f => f * (RW + 0.45))
      : [-1.85, -1.6, -1.42, -1.27, -1.05, -0.8, -0.55, -0.25, 0, 0.25, 0.55, 0.8, 1.05, 1.27, 1.42, 1.6, 1.85])
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
        const edge = RW - 0.08 + rag * 0.6, ae = aw - EX, track = LANES > 1 ? Math.exp(-(((Math.abs(aw - RW / 2) - 0.8) / 0.22) ** 2)) : Math.exp(-(((aw - 0.78) / 0.22) ** 2)); // (the wheel tracks: of the one car, or of each lane)
        a = 1 - smoothstep(edge, edge + 0.42, aw);
        v = tone * (1 - 0.1 * track) * (1 - 0.06 * damp) * (patched(i, w) ? 0.68 : 1);
        e = Math.max(smoothstep(1.2, 1.55, ae + rag * 0.5) * 0.75,           // (the crumbling edge, grit on it)
          cutV * smoothstep(1.45 - 1.25 * cutV, 1.5, ae) * 0.95,              // (grit dragged in where the bend was cut)
          throwV * 0.25 * smoothstep(0.9, 1.5, ae));
      } else {
        const edge = 1.45 + rag + throwV * 0.35;
        a = 1 - smoothstep(edge, edge + 0.45, aw);
        const track = Math.exp(-(((aw - 0.8) / 0.25) ** 2)), berm = Math.exp(-((w / 0.3) ** 2)), loose = smoothstep(1.0, 1.35, aw) * (1 - smoothstep(1.5, 1.9, aw));
        v = tone * (1 - 0.26 * track) * (1 + 0.14 * berm + 0.16 * loose * (1 + throwV)) * (1 - 0.22 * damp * (1 - berm));
        const pot = smoothstep(0.975, 0.995, Math.sin(x * 0.173 + 1.3) * Math.sin(z * 0.151 + 0.4)) * (1 - smoothstep(ROAD, SHOULDER + 1, aw));
        e = Math.max(smoothstep(1.3, 1.85, aw - rag * 0.5) * 0.85, cutV * smoothstep(1.5 - 1.1 * cutV, 1.6, aw), pot * 0.8); v *= 1 - 0.3 * pot;
      }
      if (COVER && COVER[i] === 2) v *= 0.5; // (in a tunnel: the sky's light does not reach the road)
      col[o * 4] = col[o * 4 + 1] = col[o * 4 + 2] = v; col[o * 4 + 3] = a; dirt[o] = e; } }
  for (let m = 0; m < M; m++) for (let k = 0; k < nx - 1; k++) { const a = m * nx + k, b = a + nx; idx.push(a, b, a + 1, a + 1, b, b + 1); } // (wound to face up: k runs to the left)
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.BufferAttribute(col, 4));
  g.setAttribute('aDirt', new THREE.BufferAttribute(dirt, 1)); g.setIndex(idx); g.computeVertexNormals();
  const tex = asphalt ? 'asphalt_pit_lane' : 'bicolour_gravel';
  const mat = new THREE.MeshStandardMaterial({ map: phTex(tex, 'diff', asphalt ? '2k' : '1k', true), normalMap: phTex(tex, 'nor_gl', '1k', false, NFLAT),
    roughnessMap: asphalt ? phTex('asphalt_pit_lane', 'rough', '1k', false, [210, 210, 210]) : null, normalScale: new THREE.Vector2(asphalt ? 0.85 : 0.65, asphalt ? 0.85 : 0.65),
    roughness: asphalt ? 1 : 0.97, metalness: 0, vertexColors: true, alphaHash: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6, color: cfg.roadTint ? new THREE.Color(...cfg.roadTint) : 0xffffff }); // (a stage's own stone: the pale photo gravel darkened in a dark wood)
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
    for (let i = 0; i < N - 2; i += 2) for (const off of [-(RW - 0.16), RW - 0.16]) if ((LANES > 1 || hash(i * 3.7 + off) > 0.16) && !patched(i, off) && (off > 0 ? cutL[i] : cutR[i]) < 0.4) emit(i, off, LANES > 1 ? 0.07 : 0.055);
    // (a road of two lanes: the centre line dashed, 4 m of paint and 8 of gap, and unbroken through the sharper bends)
    if (LANES > 1) for (let i = 0; i < N - 2; i += 2) if (i % 12 < 4 || Math.abs(K[i]) > 1 / 160) emit(i, 0, 0.06);
    const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.Float32BufferAttribute(marks, 3)); mg.computeVertexNormals();
    const mm = new THREE.MeshStandardMaterial({ color: 0xd9d6cb, roughness: 0.82, opacity: 0.82, alphaHash: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
    const painted = new THREE.Mesh(mg, mm); painted.receiveShadow = true; painted.name = 'rally-road-markings'; group.add(painted);
  }
  return group;
}




// the roadside: stacked timber, and stones — boulders in the woods, rock broken out of the cut bank above a hill road and
// the odd outcrop standing out of the slope
function roadside(P, T, K, N, left, startI, finishI, hf, cfg, piles, distAt, rng, packs, covered = () => false) {
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
    const mat = [new THREE.MeshStandardMaterial({ map: barkT, normalMap: barkN, color: 0xc8b8a4, roughness: 0.95 }), new THREE.MeshStandardMaterial({ map: endT, roughness: 0.9 }), new THREE.MeshStandardMaterial({ map: endT, roughness: 0.9 })];
    chunked(scene, geo, mat, mats, { name: 'rally-timber' });
  }
  if (!packs) return;
  const ids = ['rk_il_boulder_01', 'rk_il_boulder_02', 'rk_il_boulder_03'].filter(id => packs.models[id]);
  if (!ids.length) return;
  const items = new Map(), cut = (cfg.verge || (cfg.profile === 'mountain' ? 'cut' : 'ditch')) === 'cut';
  const put = (id, x, z, s, sink) => { const M = packs.models[id], w = Math.max(M.dims[0], M.dims[2]) * s, h = M.dims[1] * s; if (distAt(x, z) < 2.4 + EX + w * 0.5) return;
    const y = Math.min(hf.groundAt(x, z), hf.groundAt(x + w * 0.3, z), hf.groundAt(x - w * 0.3, z), hf.groundAt(x, z + w * 0.3), hf.groundAt(x, z - w * 0.3)) - h * sink;
    if (!items.has(id)) items.set(id, []); items.get(id).push({ x, y, z, s, r: rng() * 6.283, tilt: (rng() - 0.5) * 0.3, tilt2: (rng() - 0.5) * 0.3, c: new THREE.Color().setHSL(0.08 + rng() * 0.05, 0.07, cut ? 0.4 + rng() * 0.14 : 0.36 + rng() * 0.12) });
    if (h * (1 - sink) > 0.35) addCircle(x, z, w * 0.36, y, y + h); };
  const putSmall = (id, x, z, s) => { const M = packs.models[id]; if (!items.has(id)) items.set(id, []); items.get(id).push({ x, y: hf.groundAt(x, z) - M.dims[1] * s * 0.3, z, s, r: rng() * 6.283, tilt: (rng() - 0.5) * 0.6, tilt2: (rng() - 0.5) * 0.6, c: new THREE.Color().setHSL(0.08 + rng() * 0.04, 0.06, 0.42 + rng() * 0.12) }); };
  for (let i = startI + 25; i < finishI - 10; i += cut ? 7 + Math.floor(rng() * 16) : 14 + Math.floor(rng() * 26)) {
    if (covered(i)) continue;
    const [px, pz] = P[i], [lx, lz] = left(i);
    if (cut) { const up = hf.groundAt(px + lx * (7 + EX), pz + lz * (7 + EX)) > hf.groundAt(px - lx * (7 + EX), pz - lz * (7 + EX)) ? 1 : -1, sd = rng() < 0.82 ? up : -up, d = (sd === up ? 3.2 + rng() * 5 : 4 + rng() * 6) + EX;
      put(ids[Math.floor(rng() * ids.length)], px + lx * sd * d, pz + lz * sd * d, 0.45 + rng() * rng() * 2.2, 0.35);
      if (rng() < 0.2) { const d2 = 7 + EX + rng() * 9; put(ids[Math.floor(rng() * ids.length)], px + lx * up * d2, pz + lz * up * d2, 1.6 + rng() * 1.8, 0.45); } } // (now and then a big block broken out of the slope)
    else { const sd = rng() < 0.5 ? 1 : -1, d = 4.6 + EX + rng() * 6; put(ids[Math.floor(rng() * ids.length)], px + lx * sd * d, pz + lz * sd * d, 0.4 + rng() * rng() * 1.5, 0.4); if (rng() < 0.4) put(ids[Math.floor(rng() * ids.length)], px + lx * sd * (d + 1.5), pz + lz * sd * (d + 1.5), 0.3 + rng() * 0.5, 0.45); }
  }
  // (tinted per stone like the town's rocks: the library's stone is pale)
  if (cut) { // (rock fallen from the cut bank into the gutter and the odd stone at the edge; boulders all over the slopes)
    for (let i = startI + 6; i < finishI - 6; i += 3 + Math.floor(rng() * 6)) { if (covered(i)) continue; const [px, pz] = P[i], [lx, lz] = left(i), up = hf.groundAt(px + lx * 7, pz + lz * 7) > hf.groundAt(px - lx * 7, pz - lz * 7) ? 1 : -1;
      const edge = rng() < 0.18, d = (edge ? 1.75 + rng() * 0.3 : 2.5 + rng() * 1.4) + EX; putSmall(ids[Math.floor(rng() * ids.length)], px + lx * up * d, pz + lz * up * d, edge ? 0.08 + rng() * 0.1 : 0.14 + rng() * rng() * 0.45); }
    const box = [1e9, 1e9, -1e9, -1e9]; for (const [x, z] of P) { box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], z); box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], z); }
    const n3 = new THREE.Vector3();
    for (let k = 0, nb = (cfg.eco && cfg.eco.boulders) || 9000; k < nb; k++) { const x = box[0] - 220 + rng() * (box[2] - box[0] + 440), z = box[1] - 220 + rng() * (box[3] - box[1] + 440), dd = distAt(x, z); if (dd < 6 + EX) continue;
      hf.normalAt(x, z, n3); const sl = 1 - n3.y; if (sl < 0.045 || rng() > smoothstep(0.045, 0.3, sl) * 0.5) continue; // (scree from 17 degrees: the slopes under the cliffs)
      const big = rng() < 0.1; put(ids[Math.floor(rng() * ids.length)], x, z, big ? 2.2 + rng() * 3 : 0.5 + rng() * rng() * 2, big ? 0.35 : 0.4); }
  }
  for (const [id, list] of items) withScatterMeta({ prefab: 'rally_' + id, category: 'rock' }, () => new Scatter(list, [{ dist: () => 70, parts: packs.models[id].parts.map(q => ({ ...q, castShadow: true, tint: true })) },
    { dist: () => 300, parts: packs.models[id].parts.map(q => ({ ...q, geometry: decimate(q.geometry, 8), castShadow: true, tint: true })) }], 128)); // (a clustered copy past 70 m)
}

// A forest road's own wear: the roots of the trees beside it run out across the ditch and onto the edge of the gravel,
// half buried and polished by the wheels; loose stones lie thrown out to the edges and along the crown between the
// tracks. The roots are tapered tubes laid along the ground, merged by cells of the road (culled like the rest).
function forestRoad(P, N, startI, surfY, trees, distAt, nearAt, ground, rng, packs, covered) {
  const cells = new Map(), UPV = new THREE.Vector3(0, 1, 0), tg = new THREE.Vector3(), sd = new THREE.Vector3(), up = new THREE.Vector3(), c = new THREE.Vector3(), RS = 5;
  const cell = (x, z) => { const k = Math.floor(x / CHUNK) * 4096 + Math.floor(z / CHUNK); let g = cells.get(k); if (!g) cells.set(k, g = { pos: [], nor: [], uv: [], idx: [] }); return g; };
  const tube = (pts, r0) => { const g = cell(pts[0][0], pts[0][2]), base = g.pos.length / 3, n = pts.length; let len = 0;
    for (let j = 0; j < n; j++) { const a = pts[Math.max(0, j - 1)], b = pts[Math.min(n - 1, j + 1)]; tg.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize(); sd.crossVectors(UPV, tg).normalize(); up.crossVectors(tg, sd);
      if (j) len += Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][2] - pts[j - 1][2]);
      const r = r0 * (1 - 0.82 * j / (n - 1));
      for (let q = 0; q <= RS; q++) { const th = q / RS * Math.PI * 2, cs = Math.cos(th), sn = Math.sin(th); c.copy(sd).multiplyScalar(cs).addScaledVector(up, sn);
        g.pos.push(pts[j][0] + c.x * r, pts[j][1] + c.y * r * 0.8, pts[j][2] + c.z * r); g.nor.push(c.x, c.y, c.z); g.uv.push(q / RS, len / 0.7); } }
    for (let j = 0; j < n - 1; j++) for (let q = 0; q < RS; q++) { const a = base + j * (RS + 1) + q, b = a + RS + 1; g.idx.push(a, b, a + 1, a + 1, b, b + 1); } };
  // (the roots: from the trees standing within a few metres of the edge, two or three running toward the road, the rest
  // spreading round the trunk; none past the gravel's edge, where the wheels would have torn them out)
  for (const t of trees) {
    if (!t.tr || t.s < 7 || t.kind === 'young' || t.kind === 'sapling' || t.kind === 'bamboo') continue;
    const d0 = distAt(t.x, t.z); if (d0 > RW + 7 || d0 < RW + 0.5) continue;
    const ni = nearAt(t.x, t.z); if (ni < startI - 40 || ni > N - 20 || covered(ni)) continue;
    let tx = P[ni][0] - t.x, tz = P[ni][1] - t.z; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    const n = 3 + Math.floor(rng() * 3), r0 = clamp(t.tr * 0.5, 0.05, 0.16);
    for (let k = 0; k < n; k++) { let a = Math.atan2(tx, tz) + (k < 2 + (d0 < RW + 3 ? 1 : 0) ? (rng() - 0.5) * 1.2 : rng() * 6.283);
      const L = (1.5 + rng() * 2.4) * clamp(t.s / 14, 0.7, 1.4), S = 8, pts = []; let x = t.x + Math.sin(a) * t.tr * 0.7, z = t.z + Math.cos(a) * t.tr * 0.7;
      for (let j = 0; j <= S; j++) { if (j) { a += (rng() - 0.5) * 0.55; x += Math.sin(a) * L / S; z += Math.cos(a) * L / S; } if (distAt(x, z) < RW - 0.3) break;
        const r = r0 * (1 - 0.82 * j / S); pts.push([x, ground(x, z) - r * (j ? 0.3 : 0.1), z]); }
      if (pts.length >= 3) tube(pts, r0 * (0.75 + rng() * 0.5)); } }
  if (cells.size) { const bark = phTex('pine_bark', 'diff', '1k', true), barkN = phTex('pine_bark', 'nor_gl', '1k', false, NFLAT);
    const mat = new THREE.MeshStandardMaterial({ map: bark, normalMap: barkN, color: 0x8c7b68, roughness: 0.93 });
    for (const g of cells.values()) { const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.nor, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2)); geo.setIndex(g.idx); geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, mat); m.name = 'rally-roots'; m.castShadow = false; m.receiveShadow = true; scene.add(m); m.updateMatrixWorld(true); } }
  // (the stones: thrown out to the berms at the edges, a line of them on the crown, the odd one in a wheel track)
  const ids = packs ? ['rk_il_boulder_01', 'rk_il_boulder_02', 'rk_il_boulder_03'].filter(id => packs.models[id]) : [];
  if (!ids.length) return;
  const items = new Map();
  for (let i = startI - 30; i < N - 16; i += 1 + Math.floor(rng() * 2)) { if (covered(i)) continue;
    for (let k = 0, m = 1 + Math.floor(rng() * 3); k < m; k++) { const r = rng(), w = r < 0.7 ? (rng() < 0.5 ? -1 : 1) * (RW - 0.45 + rng() * 0.75) : r < 0.92 ? (rng() - 0.5) * 0.5 : (rng() - 0.5) * 2 * (RW - 0.5);
      const id = ids[Math.floor(rng() * ids.length)], M = packs.models[id], sc = (r < 0.7 ? 0.035 + rng() * rng() * 0.11 : 0.025 + rng() * 0.04) / Math.max(M.dims[0], M.dims[2]) * 1.6;
      const j = Math.min(N - 2, i), [px, pz] = P[j], [qx, qz] = P[j + 1], ll = Math.hypot(qx - px, qz - pz) || 1, lx = -(qz - pz) / ll, lz = (qx - px) / ll, f = rng();
      const x = px + (qx - px) * f + lx * w, z = pz + (qz - pz) * f + lz * w;
      if (!items.has(id)) items.set(id, []); items.get(id).push({ x, y: surfY(j, w) - M.dims[1] * sc * 0.35, z, s: sc, r: rng() * 6.283, tilt: (rng() - 0.5) * 0.7, tilt2: (rng() - 0.5) * 0.7, c: new THREE.Color().setHSL(0.08 + rng() * 0.04, 0.05, 0.36 + rng() * 0.16) }); } }
  for (const [id, list] of items) withScatterMeta({ prefab: 'rally_stone_' + id, category: 'rock' }, () => new Scatter(list, [{ dist: () => 38, parts: packs.models[id].parts.map(q => ({ ...q, geometry: decimate(q.geometry, 4), castShadow: false, tint: true })) }], 64));
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
    const fx = P[i][0], fz = P[i][1], dx = s.x - P[s.i][0], dz = s.z - P[s.i][1], dl = Math.hypot(dx, dz), x = fx + dx / dl * (10.5 + EX + back) + (rng() - 0.5) * 0.6, z = fz + dz / dl * (10.5 + EX + back) + (rng() - 0.5) * 0.6;
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
  const A = [1.5, 1.7, 1.9, 2.15, 2.45, 2.75, 3.0, 3.2, 3.4].map(a => a + EX), na = A.length, pos = [], col = [], uv = [], idx = [];
  let prev = -1;
  for (let i = 0; i < N; i += 2) {
    const amt = AMT[i]; if (amt <= 0.01) { prev = -1; continue; }
    const side = -DROP[i], [lx, lz] = left(i), [px, pz] = P[i], row = pos.length / 3;
    for (const a of A) { const x = px + lx * side * a, z = pz + lz * side * a, h = bankH(a) * amt, dirty = 1 - smoothstep(1.5 + EX, 2.15 + EX, a), c = lerp(0.95, 0.5, dirty * 0.85);
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

// Tunnels and galleries: where the road runs under rock. A tunnel is a lined tube — upright walls and an arch over the two
// lanes and a kerb each side — swept along the road from portal to portal, its portals concrete headwalls with the
// arch's opening, sodium lamps in a row under its crown; its walls stop the cars. A gallery is a concrete roof on
// pillars over the road, a wall against the rock on the hill's side and the other side open to the view (the sea's).
function buildCovers(P, T, N, left, surfY, tunnels, galleries, cfg) {
  if (!tunnels.length && !galleries.length) return null;
  const group = new THREE.Group(); group.name = 'rally-covers'; scene.add(group);
  const ctex = (k, srgb) => { const t = phTex('concrete_wall_008', k, '1k', srgb, srgb ? undefined : NFLAT).clone(); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; return t; };
  const lining = new THREE.MeshStandardMaterial({ map: ctex('diff', true), normalMap: ctex('nor_gl', false), color: 0xc9c5bb, roughness: 0.93, side: THREE.DoubleSide, vertexColors: true });
  const face = new THREE.MeshStandardMaterial({ map: lining.map, normalMap: lining.normalMap, color: 0xd8d2c4, roughness: 0.9, side: THREE.DoubleSide });
  const hw = RW + 1.25, H = cfg.tunnelH || 7.2, wallH = 4.0;
  // (a closed or open profile [u to the left, v up] swept along stations a..b; uv in metres)
  const sweep = (prof, a, b, mat, { closed = false, base = i => surfY(i, 0), step = 2, shade = null } = {}) => {
    const np = prof.length, pos = [], uv = [], idx = [], per = [0], col = []; for (let j = 1; j < np + (closed ? 1 : 0); j++) per.push(per[j - 1] + Math.hypot(prof[j % np][0] - prof[j - 1][0], prof[j % np][1] - prof[j - 1][1]));
    const cols = np + (closed ? 1 : 0); let rows = 0, along = 0, prev = null;
    for (let i = Math.max(0, a); i <= Math.min(N - 1, b); i += step) { const [px, pz] = P[i], [lx, lz] = left(i), y = base(i); if (prev) along += Math.hypot(px - prev[0], pz - prev[1]); prev = [px, pz];
      for (let j = 0; j < cols; j++) { const [u, v] = prof[j % np]; pos.push(px + lx * u, y + v, pz + lz * u); uv.push(per[j] / 3, along / 3); if (shade) { const k = shade(v, along); col.push(k, k, k); } } rows++; }
    for (let r = 0; r + 1 < rows; r++) for (let j = 0; j + 1 < cols; j++) { const q = r * cols + j; idx.push(q, q + cols, q + 1, q + 1, q + cols, q + cols + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); if (shade) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true; group.add(m); return m; };
  const lampM = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffb45c, emissiveIntensity: 3.2, roughness: 0.5 }), lamps = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  for (const [a0, b0] of tunnels) { const a = a0 - 14, b = b0 + 14;
    // (the lining: the right wall, the arch, the left wall; and the kerbs' raised walkways)
    const arch = [[-hw, -0.4], [-hw, wallH]]; for (let k = 1; k < 18; k++) { const t = Math.PI * (1 - k / 18); arch.push([hw * Math.cos(t), wallH + (H - wallH) * Math.sin(t)]); } arch.push([hw, wallH], [hw, -0.4]);
    // (the lining's wear: road grime up the foot of the walls, a pale painted band at the drivers' eye height, the vault
    // dulled by the exhaust; the panels' joints every 10 m)
    sweep(arch.map(([u, v]) => [-u, v]), a, b, lining, { step: 1, shade: (v, al) => (v < 1.1 ? lerp(0.42, 0.7, smoothstep(-0.4, 1.1, v)) : v < 3.4 ? 1 : lerp(0.82, 0.62, smoothstep(3.4, H, v))) * (al % 10 < 0.35 ? 0.72 : 1) });
    for (const sd of [-1, 1]) sweep([[sd * (RW + 0.15), 0.02], [sd * (RW + 0.15), 0.2], [sd * hw, 0.2], [sd * hw, 0.02]].map(p => sd > 0 ? p : [p[0], p[1]]).reverse(), a, b, face);
    // (the lamps under the crown, the walls against the cars)
    for (let i = a + 6; i < b - 4; i += 9) { const [px, pz] = P[i], [tx, tz] = T[i], y = surfY(i, 0); for (const u of [-1.6, 1.6]) { const [lx, lz] = left(i); m4.compose(new THREE.Vector3(px + lx * u, y + H - 0.55 - Math.abs(u) * 0.05, pz + lz * u), q.setFromAxisAngle(UP, Math.atan2(tx, tz)), one); lamps.push(m4.clone()); } }
    for (let i = a; i < b; i += 4) { const j = Math.min(N - 1, i + 4), [ax, az] = P[i], [bx, bz] = P[j], y = surfY(i, 0), l = Math.hypot(bx - ax, bz - az), yaw = Math.atan2(bx - ax, bz - az);
      for (const sd of [-1, 1]) { const [lx, lz] = left(i), u = sd * (hw + 0.25); addBox((ax + bx) / 2 + lx * u, (az + bz) / 2 + lz * u, 0.3, l / 2 + 0.2, yaw, y - 1, y + H); } }
    // (the portals: a headwall with the arch's opening, at each end, set back into the hill)
    for (const [i, dir] of [[a, -1], [b, 1]]) { const sh = new THREE.Shape(); const W2 = hw + 5, top = H + 5.5; sh.moveTo(-W2, -1.5); sh.lineTo(W2, -1.5); sh.lineTo(W2, top); sh.lineTo(-W2, top); sh.lineTo(-W2, -1.5);
      const hole = new THREE.Path(); hole.moveTo(arch[0][0], arch[0][1]); for (const [u, v] of arch.slice(1)) hole.lineTo(u, v); hole.lineTo(arch[0][0], arch[0][1]); sh.holes.push(hole);
      const g = new THREE.ExtrudeGeometry(sh, { depth: 1.1, bevelEnabled: false, curveSegments: 4 }); g.translate(0, 0, -0.55);
      const m = new THREE.Mesh(g, face); const [px, pz] = P[i], [tx, tz] = T[i]; m.position.set(px, surfY(i, 0), pz); m.rotation.y = Math.atan2(tx, tz); m.castShadow = m.receiveShadow = true; group.add(m); m.updateMatrixWorld(true); void dir; } }
  chunked(group, new THREE.BoxGeometry(0.5, 0.12, 1.3), lampM, lamps, { shadow: false, receive: false, name: 'rally-tunnel-lamps' });
  // the rock galleries: the road cut into the cliff under an overhang of the rock itself, open to the sea through gaps
  // between rough pillars of rock left standing; the ceiling and the back wall hewn, never a smooth slab. At its ends the
  // overhang draws back into the cut face of the cliff
  const rockT = k => { const t = phTex('rock_face_03', k, '2k', k === 'diff', k === 'diff' ? [110, 100, 90] : NFLAT).clone(); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; return t; };
  const rock = galleries.length ? new THREE.MeshStandardMaterial({ map: rockT('diff'), normalMap: rockT('nor_gl'), color: new THREE.Color((cfg.paint && cfg.paint.rockL) || '#bcb2a3').lerp(new THREE.Color(0xffffff), 0.35), roughness: 0.97, side: THREE.DoubleSide }) : null;
  // (a profile swept along stations, its overhang drawn back at the ends, every vertex pushed in or out by the rock's own
  // relief so the hewn surface is uneven)
  const hewn = (prof, a, b, k0, k1) => { const pos = [], uv = [], idx = [], np = prof.length; let rows = 0, along = 0, prev = null;
    for (let i = a - 8; i <= b + 8; i += 1) { const ii = clamp(i, 0, N - 1), [px, pz] = P[ii], [lx, lz] = left(ii), y = surfY(ii, 0), k = smoothstep(a - 8, a + 3, i) * (1 - smoothstep(b - 3, b + 8, i));
      if (prev) along += Math.hypot(px - prev[0], pz - prev[1]); prev = [px, pz]; let per = 0;
      for (let j = 0; j < np; j++) { let [u, v] = prof[j]; u = k0 + (u - k0) * k; v = v * (0.45 + 0.55 * k); if (j) per += Math.hypot(prof[j][0] - prof[j - 1][0], prof[j][1] - prof[j - 1][1]);
        const du = u - k1, dv = v - 3.2, dl = Math.hypot(du, dv) || 1, x0 = px + lx * u, z0 = pz + lz * u, n = fbm(x0 * 0.33 + v * 0.21, z0 * 0.33 - v * 0.17, 3) * 0.55 + fbm(x0 * 1.1, z0 * 1.1 + v, 2) * 0.12;
        const uu = u + du / dl * n, vv = v + dv / dl * n; pos.push(px + lx * uu, y + vv, pz + lz * uu); uv.push(per / 2.6, along / 2.6); } rows++; }
    for (let r = 0; r + 1 < rows; r++) for (let j = 0; j + 1 < np; j++) { const q = r * np + j; idx.push(q, q + np, q + 1, q + 1, q + np, q + np + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, rock); m.castShadow = m.receiveShadow = true; m.name = 'rally-gallery-rock'; group.add(m); return m; };
  // (a pillar of rock: a box broken up by the same relief, one shape shared by all, turned and sized each its own way)
  let pillarG = null; if (galleries.length) { pillarG = new THREE.BoxGeometry(1, 1, 1, 3, 6, 3); const pp = pillarG.attributes.position;
    for (let k = 0; k < pp.count; k++) { const x = pp.getX(k), y = pp.getY(k), z = pp.getZ(k), n = fbm(x * 2.1 + y * 1.3, z * 2.1 - y * 0.9, 3) * 0.32; pp.setXYZ(k, x * (1 + n), y, z * (1 + n * 0.8)); } pillarG.computeVertexNormals(); }
  for (const [a, b, side0] of galleries) { const side = side0 || -1, roofH = 5.9, uo = side * (RW + 1.1), uw = -side * (RW + 1.3), su = Math.sign(uw), so = Math.sign(uo), aw = Math.abs(uw), ao = Math.abs(uo);
    // (the hewn inside — back wall, ceiling, the lintel over the open side — and the rock's top running back into the cliff)
    hewn([[uw, -0.7], [uw + su * 0.35, 1.6], [uw + su * 0.2, 3.5], [su * aw * 0.72, 5.0], [su * aw * 0.3, 5.75], [0, 6.0], [so * ao * 0.5, 5.95], [so * ao * 0.92, 5.55], [uo + so * 0.1, 4.9], [uo + so * 0.75, 4.75],
      [uo + so * 1.25, 5.5], [uo + so * 1.35, 7.1], [uo + so * 0.9, 8.5], [so * ao * 0.2, 9.3], [su * aw * 0.7, 9.6], [uw + su * 3, 9.4], [uw + su * 5.5, 8.6]], a, b, uw, 0);
    const pil = []; for (let i = a + 3; i <= b - 3; i += 7 + ((i * 7919) % 3)) { const [px, pz] = P[i], [lx, lz] = left(i), [tx, tz] = T[i], y = surfY(i, 0), yaw = Math.atan2(tx, tz) + ((i * 4271) % 7 - 3) * 0.08;
      const w = 1.1 + ((i * 1597) % 5) * 0.12;
      m4.compose(new THREE.Vector3(px + lx * (uo + so * 0.35), y + 2.4, pz + lz * (uo + so * 0.35)), q.setFromAxisAngle(UP, yaw), new THREE.Vector3(w, 5.4, w * 1.3)); pil.push(m4.clone()); addBox(px + lx * (uo + so * 0.35), pz + lz * (uo + so * 0.35), w * 0.5, w * 0.62, yaw, y - 1, y + roofH);
    }
    // (the back wall against the cars, unbroken)
    for (let i = a - 4; i < b + 4; i += 4) { const ii = clamp(i, 0, N - 2), j = Math.min(N - 1, ii + 4), [px, pz] = P[ii], [lx, lz] = left(ii), y = surfY(ii, 0), l = Math.hypot(P[j][0] - px, P[j][1] - pz);
      addBox((px + P[j][0]) / 2 + lx * (uw + su * 0.2), (pz + P[j][1]) / 2 + lz * (uw + su * 0.2), 0.32, l / 2 + 0.2, Math.atan2(P[j][0] - px, P[j][1] - pz), y - 1, y + roofH); }
    chunked(group, pillarG, rock, pil, { name: 'rally-gallery-pillars' }); }
  return group;
}

// roadside marker posts, boards, bales, tape and the start arch
function dressStage(P, T, K, N, left, rng, startI, finishI, hf, cfg, corners, sites, DROP, surfY, covered = () => false) {
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
  for (let i = startI + 18; i < N - 14; i += 22) {
    if (covered(i)) continue;
    const [px, pz] = P[i], [lx, lz] = left(i), wobble = (rng() - 0.5) * 0.12;
    for (const side of [-1, 1]) { const d = RW + 0.78 + wobble, x = px + lx * d * side, z = pz + lz * d * side; items.marker.push(at(x, 0, z, Math.atan2(T[i][0], T[i][1]))); }
  }
  const wide = new Float32Array(N); for (const c of corners) if (c.R < 40) for (let i = Math.max(0, c.s - 10); i <= Math.min(N - 1, c.e + 10); i++) wide[i] = 1;
  const fall = new Uint8Array(N), railed = new Uint8Array(N);
  if (mountain || cfg.walls || cfg.rails) { for (let i = startI + 10; i < N - 14; i += 4) { const [px, pz] = P[i], [lx, lz] = left(i), s = DROP[i], y = surfY(i, 0); fall[i] = wide[i] || y - hf.groundAt(px + lx * s * (7 + EX), pz + lz * s * (7 + EX)) > (cfg.walls ? 1.4 : 2.2) ? 1 : 0; }
    for (let i = startI + 10; i < N - 14; i += 4) for (let k = i - 16; k <= i + 16; k += 4) if (fall[k]) { railed[i] = 1; break; } }
  // the guardrail and the walls run unbroken: one section swept along each stretch where the hill falls away (a change of
  // side starts a new run), set back from the edge by an offset that eases out round the switchbacks, its height smoothed
  // along the run. A rail's ends turn down and away into the ground; a wall's are closed off with its own stone.
  const wideS = new Float32Array(N); for (let i = 0; i < N; i++) { let a = 0, c = 0; for (let k = Math.max(0, i - 14); k <= Math.min(N - 1, i + 14); k += 2) { a += wide[k]; c++; } wideS[i] = a / c; }
  const isRailed = i => i >= startI + 10 && i < N - 14 && railed[i - (i - startI - 10) % 4] === 1 && !covered(i);
  const runs = []; if (mountain || cfg.walls || cfg.rails) { let cur = null; for (let i = startI + 10; i < N - 14; i += 2) { if (isRailed(i) && (!cur || DROP[i] === cur.side)) { if (!cur) runs.push(cur = { side: DROP[i], idx: [] }); cur.idx.push(i); } else cur = null; } }
  const line = (run, rd0, base) => { const pts = run.idx.map(i => { const [px, pz] = P[i], [lx, lz] = left(i), s = run.side, rd = rd0 + 0.75 * wideS[i], x = px + lx * s * rd, z = pz + lz * s * rd;
      return { x, z, y: base(px, pz, x, z, i), rx: -lx * s, rz: -lz * s }; });
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
  if (mountain || cfg.rails) {
    const W = [[0, -0.155], [0.025, -0.155], [0.08, -0.105], [0.08, -0.055], [0.035, 0], [0.08, 0.055], [0.08, 0.105], [0.025, 0.155], [0, 0.155], [0, 0.11], [0.05, 0.075], [0.05, 0.035], [0.012, 0], [0.05, -0.035], [0.05, -0.075], [0, -0.11]];
    for (const run of runs) { if (run.idx.length < 3) continue;
      const pts = line(run, RW + 1.1, (px, pz, x, z, i) => surfY(i, 0) + 0.6);
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
      const pts = line(run, RW + 1.39, (px, pz, x, z, i) => Math.min(surfY(i, 0) - 0.05, hf.groundAt(x, z)));
      sweep(pts, Wp.map(([u, v]) => [-u, v]), walls, true);
      for (let k = 0; k + 1 < pts.length; k++) { const p = pts[k], n = pts[k + 1], l = Math.hypot(n.x - p.x, n.z - p.z); addBox((p.x + n.x) / 2, (p.z + n.z) / 2, 0.24, l / 2 + 0.1, Math.atan2(n.x - p.x, n.z - p.z), p.y - 0.3, p.y + 0.62); } }
  }
  for (const c of corners) {
    if (c.R > 60 || covered(c.apex)) continue; // (chevrons only where a bend can catch you out)
    const out = i => { const [lx, lz] = left(i); return [-lx * c.dir, -lz * c.dir]; }; // (the corner's outside)
    // boards along the outside, facing the road, from before the corner to its exit
    const from = Math.max(0, c.apex - (c.R < 30 ? 10 : 6)), to = Math.min(N - 1, c.apex + (c.R < 30 ? 10 : 6)), n = c.R < 30 ? 3 : 1;
    for (let k = 0; k <= n; k++) { const i = Math.round(from + (to - from) * k / n), [ox, oz] = out(i), [px, pz] = P[i], d = 8.8 + EX, x = px + ox * d, z = pz + oz * d, yaw = Math.atan2(-ox, -oz);
      items.board.push([at(x, 1.05, z, yaw), c.dir]); items.back.push(at(x + ox * 0.012, 1.05, z + oz * 0.012, yaw + Math.PI)); items.post.push(at(x + Math.cos(yaw) * 0.45, 0, z - Math.sin(yaw) * 0.45, yaw), at(x - Math.cos(yaw) * 0.45, 0, z + Math.sin(yaw) * 0.45, yaw));
      const gy = hf.groundAt(x, z); addBox(x, z, 0.7, 0.12, yaw, gy, gy + 1.4); }
    if (c.R > 45 || mountain) continue;
    // straw bales on the outside of the tight ones, tape on poles behind
    const nb = c.R < 20 ? 7 : 4;
    for (let k = 0; k < nb; k++) { const i = clamp(c.apex + Math.round((k - (nb - 1) / 2) * 2.6), 0, N - 1), [ox, oz] = out(i), [px, pz] = P[i], d = 7.9 + EX + rng() * 0.3, x = px + ox * d, z = pz + oz * d;
      items.bale.push(at(x, 0.72, z, Math.atan2(T[i][0], T[i][1]) + Math.PI / 2 + (rng() - 0.5) * 0.15)); const gy = hf.groundAt(x, z); addCircle(x, z, 0.75, gy, gy + 1.4); }
    if (c.R > 26) continue; // (tape behind the bales only at the hairpins)
    let prev = null;
    for (let i = Math.max(0, c.s - 20); i <= Math.min(N - 1, c.e + 20); i += 6) { const ii = i, [ox, oz] = out(ii), [px, pz] = P[ii], x = px + ox * (11.5 + EX), z = pz + oz * (11.5 + EX);
      items.pole.push(at(x, 0, z, 0)); if (prev) tape(prev, [x, z]); prev = [x, z]; }
  }
  // the spectators' tape: a line of poles between them and the road
  for (const st of sites) { let prev = null; const dx = st.x - P[st.i][0], dz = st.z - P[st.i][1], dl = Math.hypot(dx, dz);
    for (let i = st.i - 10; i <= st.i + 10; i += 4) { const x = P[i][0] + dx / dl * (7 + EX), z = P[i][1] + dz / dl * (7 + EX); items.pole.push(at(x, 0, z, 0)); if (prev) tape(prev, [x, z]); prev = [x, z]; } }
  function tape(a, b) { const l = Math.hypot(b[0] - a[0], b[1] - a[1]), u = l / 2, ya = hf.groundAt(a[0], a[1]), yb = hf.groundAt(b[0], b[1]); for (const y of [0.85]) { const h = 0.05, v = [[a[0], ya + y - h, a[1]], [b[0], yb + y - h, b[1]], [b[0], yb + y + h, b[1]], [a[0], ya + y + h, a[1]]]; const base = tapePos.length / 3; for (const p of [v[0], v[1], v[2], v[0], v[2], v[3]]) tapePos.push(...p); tapeUv.push(0, 0, u, 0, u, 1, 0, 0, u, 1, 0, 1); } }
  const inst = (geo, mat, list, shadow = true, name = '') => chunked(group, geo, mat, list, { shadow, name });
  inst(boardG, boardR, items.board.filter(b => b[1] < 0).map(b => b[0])); inst(boardG, boardL, items.board.filter(b => b[1] > 0).map(b => b[0]));
  inst(new THREE.PlaneGeometry(1.32, 0.67), backM, items.back, false); inst(postG, postM, items.post); inst(baleG, baleM, items.bale);
  inst(new THREE.CylinderGeometry(0.025, 0.025, 1.0, 6).translate(0, 0.5, 0), poleM, items.pole, false);
  const markerWhite = new THREE.MeshStandardMaterial({ color: 0xe8e8df, roughness: 0.88 }), markerRed = new THREE.MeshStandardMaterial({ color: 0xc9272f, roughness: 0.76 });
  inst(new THREE.BoxGeometry(0.075, 1.05, 0.075).translate(0, 0.525, 0), markerWhite, items.marker, false, 'rally-marker-posts');
  inst(new THREE.BoxGeometry(0.09, 0.22, 0.09).translate(0, 0.72, 0), markerRed, items.marker, false, 'rally-marker-bands');
  if (mountain || cfg.rails) {
    const steel = new THREE.MeshStandardMaterial({ color: 0xaeb6ba, roughness: 0.48, metalness: 0.72, side: THREE.DoubleSide }), darkSteel = new THREE.MeshStandardMaterial({ color: 0x70787c, roughness: 0.62, metalness: 0.5 }), orange = new THREE.MeshStandardMaterial({ color: 0xff8b18, emissive: 0x6b2300, emissiveIntensity: 0.35, roughness: 0.55 });
    if (rails.idx.length) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(rails.pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(rails.uv, 2)); g.setIndex(rails.idx); g.computeVertexNormals();
      const m = new THREE.Mesh(g, steel); m.name = 'rally-mountain-guardrails'; m.castShadow = m.receiveShadow = true; group.add(m); }
    inst(new THREE.BoxGeometry(0.1, 1, 0.15), darkSteel, items.guardPost, true, 'rally-mountain-guardrail-posts');
    inst(new THREE.BoxGeometry(0.16, 0.12, 0.05), orange, items.reflector, false, 'rally-mountain-reflectors');
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
    const bannerM = new THREE.MeshStandardMaterial({ map: banner, roughness: 0.7 }), arch = new THREE.Group(), gy = surfY(i0, 0); arch.position.set(px, gy, pz); arch.rotation.y = yaw; group.add(arch);
    for (const sd of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.35, 5.4, 0.35), archM); post.position.set(sd * (6.2 + EX), 2.7, 0); post.castShadow = true; arch.add(post); const x = px + lx * sd * (6.2 + EX), z = pz + lz * sd * (6.2 + EX), py = hf.groundAt(x, z); addBox(x, z, 0.25, 0.25, yaw, py, py + 5.4); }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(12.8 + 2 * EX, 0.3, 0.3), archM); beam.position.set(0, 5.3, 0); beam.castShadow = true; arch.add(beam);
    for (const sd of [-1, 1]) { const ban = new THREE.Mesh(new THREE.PlaneGeometry(11.6 + 2 * EX, 1.45), bannerM); ban.position.set(0, 4.45, sd * 0.16); ban.rotation.y = sd < 0 ? Math.PI : 0; ban.castShadow = true; arch.add(ban); }
    const line = new THREE.Mesh(new THREE.PlaneGeometry(7.6 + 2 * EX, 0.95).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: chq, roughness: 0.85, transparent: true, opacity: 0.88, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }));
    line.position.set(0, 0.045, 0); line.receiveShadow = true; arch.add(line); arch.updateMatrixWorld(true); };
  archAt(startI, 'START', false); archAt(finishI, 'FINISH', true); if (N - finishI > 120) archAt(N - 24, 'STOP', false);
  let update = null;
  if (mountain && cfg.snowfall) {
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
// (the recording fetched once a session and decoded once per audio context: every stage after the first starts with its
// co-driver ready; the preloader fetches it before the first)
let pilotRaw = null, pilotDecoded = null, pilotCtx = null;
export function pilotFiles() {
  const BASE = 'Modeleaut/sounds/rally-pilot', V = '?v=20261025b';
  if (!pilotRaw) pilotRaw = Promise.all([
    fetch(BASE + '.json' + V).then(r => { if (!r.ok) throw new Error(`pilot manifest ${r.status}`); return r.json(); }),
    fetch(BASE + '.mp3' + V).then(r => { if (!r.ok) throw new Error(`pilot audio ${r.status}`); return r.arrayBuffer(); }),
  ]).catch(e => { pilotRaw = null; throw e; });
  return pilotRaw;
}
function coDriver() {
  const raw = pilotFiles();
  let data = null, buffer = null, decode = null, serial = 0, active = [];
  const norm = s => s.toLocaleLowerCase('pl-PL').replace(/[.!?]+$/g, '').replace(/\s+/g, ' ').trim();
  const fallback = text => { if (!text || !('speechSynthesis' in window)) return; const u = new SpeechSynthesisUtterance(text), vs = speechSynthesis.getVoices(); u.voice = vs.find(v => /^pl\b/i.test(v.lang)) || null; u.lang = 'pl-PL'; u.rate = 1.22; u.pitch = 0.86; u.volume = 0.92; speechSynthesis.speak(u); };
  const ready = async () => { if (!audio.ctx) return null; if (buffer && data) return { data, buffer };
    if (!decode) decode = raw.then(async ([m, bytes]) => { data = m; if (pilotCtx !== audio.ctx || !pilotDecoded) { pilotCtx = audio.ctx; pilotDecoded = audio.ctx.decodeAudioData(bytes.slice(0)); } buffer = await pilotDecoded; return { data, buffer }; }).catch(e => { console.warn('rally pilot:', e); return null; });
    return decode; };
  const stop = () => { serial++; api.until = 0; for (const s of active) try { s.stop(); } catch (e) {} active = []; if ('speechSynthesis' in window) speechSynthesis.cancel(); };
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
    api.last = text; api.keys = keys; api.loaded = true; api.until = at;
  };
  const api = { say, stop, loaded: false, last: '', keys: [], until: 0, speaking: () => (audio.ctx && audio.ctx.currentTime < api.until - 0.05) || ('speechSynthesis' in window && speechSynthesis.speaking) };
  raw.then(() => { api.fetched = true; }).catch(() => {});
  return api;
}

// A real point-to-point special stage: start marshal, mandatory split gates, finish timing and a Polish co-driver.
// Pace-note pictograms, drawn as the co-driver reads the note: a bend is an arrow that turns as far as the bend does (a
// six barely, a one more than a right angle, a hairpin right round), its arc tight or wide by the same measure and
// longer for a long bend, with the bend's number beside it; crests, jumps, compressions and cautions have signs of their
// own. Left yellow, right blue, as the text has them.
const TURN_ICON = [[180, 6.5], [140, 8], [115, 10], [92, 12.5], [72, 15], [52, 19], [32, 26]]; // (by grade, 0 a hairpin: degrees turned, radius)
function paceIcon(part) {
  const col = part.kind === 'feature' ? '#fff075' : part.dir > 0 ? '#ffcf45' : '#60baff';
  const svg = (vb, body) => `<svg width="62" height="62" viewBox="${vb}" style="display:block;overflow:visible">${body}</svg>`;
  if (part.kind === 'feature') {
    const t = part.text.toLowerCase(), s = 'fill="none" stroke-linecap="round" stroke-linejoin="round"', two = d => `<path d="${d}" ${s} stroke="#05080c" stroke-width="11"/><path d="${d}" ${s} stroke="${col}" stroke-width="6"/>`;
    if (/skok/.test(t)) return svg('0 0 64 64', two('M4 52 L24 52 L38 38') + `<path d="M42 33 Q52 20 61 30" ${s} stroke="${col}" stroke-width="4" stroke-dasharray="4 5"/>`);
    if (/szczyt/.test(t)) return svg('0 0 64 64', two('M5 50 Q32 12 59 50') + (/ślepy/.test(t) ? `<path d="M22 22 L42 42 M42 22 L22 42" ${s} stroke="#05080c" stroke-width="9"/><path d="M22 22 L42 42 M42 22 L22 42" ${s} stroke="#ff5a4a" stroke-width="5"/>` : ''));
    if (/kompresja|dół/.test(t)) return svg('0 0 64 64', two('M5 18 Q32 60 59 18'));
    return svg('0 0 64 64', `<path d="M32 6 L60 56 L4 56 Z" fill="${col}" stroke="#05080c" stroke-width="4" stroke-linejoin="round"/><path d="M32 22 L32 40" stroke="#05080c" stroke-width="7" stroke-linecap="round"/><circle cx="32" cy="48" r="3.6" fill="#05080c"/>`);
  }
  let [deg, r] = TURN_ICON[clamp(part.grade, 0, 6)]; if (part.long) deg = Math.min(deg * 1.2 + 14, 205);
  let x = 0, y = 0, h = -Math.PI / 2; const pts = [[0, 0], [0, -11]]; y = -11;
  const n = 28, th = deg * Math.PI / 180, ds = r * th / n, sg = part.dir > 0 ? -1 : 1;
  for (let k = 0; k < n; k++) { h += sg * th / n; x += Math.cos(h) * ds; y += Math.sin(h) * ds; pts.push([x, y]); }
  x += Math.cos(h) * 3; y += Math.sin(h) * 3; pts.push([x, y]);
  const tip = [x + Math.cos(h) * 7, y + Math.sin(h) * 7], px = -Math.sin(h), py = Math.cos(h), head = [tip, [x + px * 6, y + py * 6], [x - px * 6, y - py * 6]];
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const [a, b] of [...pts, ...head]) { x0 = Math.min(x0, a); y0 = Math.min(y0, b); x1 = Math.max(x1, a); y1 = Math.max(y1, b); }
  const S = Math.max(x1 - x0, y1 - y0) + 12, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, vb = `${(cx - S / 2).toFixed(1)} ${(cy - S / 2).toFixed(1)} ${S.toFixed(1)} ${S.toFixed(1)}`;
  const d = 'M' + pts.map(([a, b]) => a.toFixed(2) + ' ' + b.toFixed(2)).join(' L'), hd = head.map(([a, b]) => a.toFixed(2) + ',' + b.toFixed(2)).join(' '), w = S * 0.085;
  return svg(vb, `<path d="${d}" fill="none" stroke="#05080c" stroke-width="${(w * 1.8).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/><polygon points="${hd}" fill="#05080c" stroke="#05080c" stroke-width="${(w * 0.9).toFixed(2)}" stroke-linejoin="round"/>`
    + `<path d="${d}" fill="none" stroke="${col}" stroke-width="${w.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/><polygon points="${hd}" fill="${col}"/>`);
}
// one note's card: its pictograms (two for linked bends, the link between them), the bend numbers, the words under them
function paceCard(n, distance) {
  const parts = n.parts || [n], col = p => p.kind === 'feature' ? '#fff075' : p.dir > 0 ? '#ffcf45' : '#60baff';
  const tile = p => `<div style="display:flex;align-items:center;gap:4px">${paceIcon(p)}${p.kind === 'turn' && p.grade > 0 ? `<span style="font:900 40px/1 'Segoe UI',system-ui;color:${col(p)};text-shadow:0 2px 0 #05080c,0 0 8px #000">${p.grade}</span>` : ''}</div>`;
  const link = n.link ? `<span style="font:800 15px/1 'Segoe UI',system-ui;color:#c9d4df;opacity:.9;text-transform:uppercase;letter-spacing:.06em">${n.link}</span>` : '';
  const dist = distance > 115 ? '100' : distance > 88 ? '80' : '';
  return `<div style="display:flex;align-items:center;justify-content:center;gap:12px">${dist ? `<span style="font:800 15px/1 'Segoe UI',system-ui;color:#9fb3c6">${dist}</span>` : ''}${tile(parts[0])}${parts[1] ? link + tile(parts[1]) : ''}</div><div style="margin-top:5px;font:800 19px/1.1 'Segoe UI',system-ui">${n.text}</div>`;
}

// The stage map in the corner. Before the start and at the finish it shows the whole route north-up (start green,
// splits amber, finish chequered); on the stage it is the road round the car, turned so the car heads up the map, the
// bends ahead drawn as they come, the part already driven red, with the stage's progress and its splits under it.
function stageMap(host, P, startI, finishI, checkpoints) {
  const C = 196, dpr = Math.min(2, window.devicePixelRatio || 1), cv = document.createElement('canvas'); cv.width = cv.height = Math.round(C * dpr);
  cv.style.cssText = `position:absolute;left:16px;top:14px;width:${C}px;height:${C}px;border-radius:9px;background:#090d13c8;border:1px solid #ffffff28;box-shadow:0 8px 24px #0008`;
  host.appendChild(cv); const g = cv.getContext('2d'), N = P.length;
  let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (const [x, z] of P) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
  const fit = (C - 40) / Math.max(x1 - x0, z1 - z0, 1), mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, R = 210; // (R: metres seen round the car)
  const path = (a, b, step, f) => { g.beginPath(); for (let i = a; i <= b; i += step) { const q = P[Math.min(i, b)]; i === a ? g.moveTo(...f(q)) : g.lineTo(...f(q)); } g.lineTo(...f(P[b])); };
  const dot = (q, f, r, fill) => { const [a, b] = f(q); g.beginPath(); g.arc(a, b, r, 0, 6.283); g.fillStyle = fill; g.fill(); g.lineWidth = r * 0.45; g.strokeStyle = '#05080c'; g.stroke(); };
  const flag = (q, f, h) => { const [a, b] = f(q); for (let k = 0; k < 4; k++) { g.fillStyle = k % 2 ? '#111' : '#fff'; g.fillRect(a - h + (k % 2) * h, b - h + (k >> 1) * h, h, h); } g.lineWidth = h * 0.3; g.strokeStyle = '#05080c'; g.strokeRect(a - h, b - h, 2 * h, 2 * h); };
  const marks = (f, k) => { for (const i of checkpoints) dot(P[i], f, 3.4 * k, '#ffc21a'); dot(P[startI], f, 4.6 * k, '#3ce26a'); flag(P[finishI], f, 5 * k); };
  return { el: cv, draw(progress, car, whole) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, C, C); g.lineCap = g.lineJoin = 'round';
    const done = Math.min(progress, finishI);
    if (whole || !car) { const f = ([x, z]) => [C / 2 - (x - mx) * fit, C / 2 - (z - mz) * fit]; // (north up, east right)
      path(0, N - 1, 2, f); g.lineWidth = 7; g.strokeStyle = '#05080c'; g.stroke(); g.lineWidth = 3.4; g.strokeStyle = '#d6dde5'; g.stroke();
      if (done > startI + 2) { path(startI, done, 2, f); g.lineWidth = 3.6; g.strokeStyle = '#e1252d'; g.stroke(); }
      marks(f, 1);
      if (car) { const [a, b] = f([car.st.pos.x, car.st.pos.z]); g.beginPath(); g.arc(a, b, 4.5, 0, 6.283); g.fillStyle = '#fff'; g.fill(); g.lineWidth = 2; g.strokeStyle = '#e1252d'; g.stroke(); }
      return; }
    // (round the car: the map turned so that it heads up, the car a little below the middle to show more of the road ahead)
    const p = car.st.pos, fw = new THREE.Vector3(0, 0, 1).applyQuaternion(car.st.q), hx = -fw.x, hy = -fw.z, ang = -Math.PI / 2 - Math.atan2(hy, hx), cs = Math.cos(ang), sn = Math.sin(ang), k = (C / 2 - 8) / R, ox = C / 2, oy = C * 0.62;
    const f = ([x, z]) => { const u = -(x - p.x), v = -(z - p.z); return [ox + (u * cs - v * sn) * k, oy + (u * sn + v * cs) * k]; };
    let lo = N, hi = -1; for (let i = 0; i < N; i += 3) { const [x, z] = P[i]; if (Math.abs(x - p.x) < R * 1.5 && Math.abs(z - p.z) < R * 1.5) { lo = Math.min(lo, i); hi = Math.max(hi, i); } }
    g.save(); g.beginPath(); g.rect(0, 0, C, C - 16); g.clip();
    if (hi > lo) { const a = Math.max(0, lo - 3), b = Math.min(N - 1, hi + 3); path(a, b, 1, f); g.lineWidth = 9; g.strokeStyle = '#05080c'; g.stroke(); g.lineWidth = 4.6; g.strokeStyle = '#d6dde5'; g.stroke();
      const d0 = Math.max(a, startI), d1 = Math.min(b, done); if (d1 > d0 + 1) { path(d0, d1, 1, f); g.lineWidth = 4.6; g.strokeStyle = '#e1252d'; g.stroke(); } }
    marks(f, 1.15);
    g.beginPath(); g.moveTo(ox, oy - 10); g.lineTo(ox - 7, oy + 7); g.lineTo(ox, oy + 3); g.lineTo(ox + 7, oy + 7); g.closePath(); g.fillStyle = '#fff'; g.fill(); g.lineWidth = 2; g.strokeStyle = '#e1252d'; g.stroke();
    g.restore();
    // (the stage's progress along the bottom, its splits marked)
    const bx = 12, bw = C - 24, by = C - 11, t = clamp((done - startI) / (finishI - startI), 0, 1);
    g.fillStyle = '#ffffff28'; g.fillRect(bx, by, bw, 4); g.fillStyle = '#e1252d'; g.fillRect(bx, by, bw * t, 4);
    g.fillStyle = '#ffc21a'; for (const i of checkpoints) g.fillRect(bx + bw * (i - startI) / (finishI - startI) - 1, by - 2, 2, 8); } };
}

function stageClock(N, nearAt, distAt, corners, features, startI, finishI, spawn, cfg, P) {
  const host = document.createElement('div'); host.id = 'stageClock';
  host.style.cssText = 'position:fixed;inset:0;z-index:9;color:#fff;font:600 15px/1.25 "Segoe UI",system-ui,sans-serif;text-shadow:0 2px 5px #000;pointer-events:none;letter-spacing:.02em';
  host.innerHTML = `<div data-race style="position:absolute;left:50%;top:14px;transform:translateX(-50%);min-width:260px;padding:9px 16px;border-radius:7px;background:#090d13bd;border:1px solid #ffffff28;text-align:center;box-shadow:0 8px 24px #0008"></div><div data-count style="position:absolute;left:50%;top:32%;transform:translate(-50%,-50%);font:900 92px/1 Impact,Haettenschweiler,sans-serif;color:#fff;text-shadow:0 4px 0 #151515,0 0 28px #000;display:none"></div><div data-note style="position:absolute;left:50%;top:116px;transform:translateX(-50%);min-width:260px;padding:8px 18px 10px;border-radius:9px;background:#10151ee8;border-left:6px solid #e1262f;text-align:center;font:800 24px/1.08 'Segoe UI',system-ui;opacity:0;transition:opacity .12s"></div>`;
  document.body.appendChild(host);
  const raceEl = host.querySelector('[data-race]'), countEl = host.querySelector('[data-count]'), noteEl = host.querySelector('[data-note]');
  let best = 0; try { best = +localStorage.getItem(cfg.bestKey) || 0; } catch (e) {}
  const grade = r => r < 15 ? 0 : r < 24 ? 1 : r < 34 ? 2 : r < 48 ? 3 : r < 68 ? 4 : r < 105 ? 5 : 6; // (0: a hairpin)
  const phrase = c => grade(c.R) === 0 ? `${c.dir > 0 ? 'Lewy' : 'Prawy'} nawrót` : `${c.dir > 0 ? 'Lewy' : 'Prawy'} ${grade(c.R)}${c.e - c.s > 42 ? ' długi' : ''}`;
  const raw = corners.filter(c => c.apex > startI + 70 && c.apex < finishI - 35).map(c => ({ at: c.apex, end: c.e, text: phrase(c), dir: c.dir, grade: grade(c.R), long: c.e - c.s > 42, kind: 'turn' }));
  for (const f of features) if (f.at > startI + 70 && f.at < finishI - 35) raw.push(f); raw.sort((a, b) => a.at - b.at);
  const notes = cfg.pilot === false ? [] : raw; // (one call per bend or feature, read one after another: see the queue in update; none in a race)
  const checkpoints = [], sp = cfg.splits || 300; for (let i = startI + sp; i < finishI - 120; i += sp) checkpoints.push(i);
  const map = stageMap(host, P, startI, finishI, checkpoints);
  const st = { phase: 'waiting', t: 0, progress: startI, countdown: 3.8, countSaid: 4, checkpoint: 0, note: 0, noteText: '', noteT: 0, noteAge: 9, result: 0, newBest: false, frame: 0 };
  const fmt = t => { const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2); };
  const pilot = coDriver(), say = text => pilot.say(text), stopVoice = () => pilot.stop();
  const lockAtStart = car => { const cs = car.st; cs.pos.set(spawn.x, car.world.groundAt(spawn.x, spawn.z) + car.spec.cg[1] + 0.01, spawn.z); cs.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), spawn.yaw); cs.vel.set(0, 0, 0); cs.ang.set(0, 0, 0); cs.throttle = 0; cs.brake = 1; cs.hand = cs.handEff = 0; for (const w of car.wheels) w.w = 0; };
  const reset = () => { stopVoice(); queue.length = 0; Object.assign(st, { phase: 'waiting', t: 0, progress: startI, countdown: 3.8, countSaid: 4, checkpoint: 0, note: 0, noteText: '', noteT: 0, result: 0, newBest: false, frame: 0 }); };
  const queue = [], busy = () => (pilot.speaking() && st.noteAge < 3) || st.noteAge < 0.9; // (never held up longer than a call takes, whatever the audio does)
  const showNote = (n, distance) => { st.noteAge = 0; const lead = distance > 115 ? 'Za sto, ' : distance > 88 ? 'Za osiemdziesiąt, ' : ''; st.noteText = n.text; st.noteT = 3.4; noteEl.innerHTML = paceCard(n, distance); say(lead + n.text); };
  const finish = () => { st.phase = 'finished'; st.result = st.t; st.newBest = !best || st.result < best; if (st.newBest) { best = st.result; try { localStorage.setItem(cfg.bestKey, String(best)); } catch (e) {} } stopVoice(); say(st.newBest ? 'Nowy rekord' : 'Meta'); st.noteText = ''; st.noteT = 0; };
  const api = { state: st, notes, checkpoints, pilot, reset, card: paceCard, map, dispose() { stopVoice(); host.remove(); },
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
        // (a call comes due at its distance; while the co-driver is still reading the last one it waits its turn, and one
        // the car has already reached is dropped)
        while (st.note < notes.length && notes[st.note].at - st.progress <= lead) queue.push(notes[st.note++]);
        while (queue.length && st.progress > queue[0].at - 8) queue.shift();
        if (queue.length && !busy()) { const n = queue.shift(); showNote(n, n.at - st.progress); }
        if (onRoad && i >= finishI - 5 && st.checkpoint === checkpoints.length) finish();
      }
      if (st.noteT > 0) st.noteT -= dt; st.noteAge += dt;
      noteEl.style.opacity = st.noteT > 0 && st.phase === 'running' ? '1' : '0';
      const cd = st.phase === 'countdown' ? Math.min(3, Math.max(1, Math.ceil(st.countdown))) : st.phase === 'running' && st.t < 0.7 ? 'START!' : '';
      countEl.style.display = cd ? '' : 'none'; countEl.textContent = cd;
      map.draw(st.progress, car, st.phase === 'waiting' || st.phase === 'finished');
      if (++st.frame % 3) return;
      const km = Math.max(0, finishI - st.progress) / 1000, pct = clamp((st.progress - startI) / (finishI - startI), 0, 1);
      if (st.phase === 'waiting') raceEl.innerHTML = `<div style="font-size:18px">${cfg.name.toUpperCase()} · ${(cfg.target / 1000).toFixed(1)} KM</div><div style="opacity:.75;font-size:12px">Kliknij, aby rozpocząć odliczanie</div>`;
      else if (st.phase === 'finished') raceEl.innerHTML = `<div style="color:#ffd54d;font:800 14px 'Segoe UI'">${st.newBest ? 'NOWY REKORD' : 'META'}</div><div style="font:800 34px/1.05 'Segoe UI'">${fmt(st.result)}</div><div style="opacity:.72;font-size:12px">R — ponowny start · rekord ${fmt(best)}</div>`;
      else raceEl.innerHTML = `<div style="font:800 31px/1.05 'Segoe UI'">${fmt(st.t)}</div><div style="height:3px;background:#ffffff28;margin:6px 0 5px"><i style="display:block;height:100%;width:${(pct * 100).toFixed(1)}%;background:#e1252d"></i></div><div style="opacity:.78;font-size:12px">${km.toFixed(2)} km do mety · PK ${st.checkpoint}/${checkpoints.length}${best ? ' · rekord ' + fmt(best) : ''}</div>`;
    },
  };
  return api;
}
