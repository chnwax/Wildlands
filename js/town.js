// "Sakuragawa" — a small Japanese town in a valley: station and level crossings, commuter trains, traffic,
// houses and shops, utility poles, a river with concrete banks, rice paddies and cedar-covered hills.
import { THREE, scene, Q, S, clamp, lerp, smoothstep, mulberry32, tick, fbm, erosion, loadTex, phTex, NFLAT, loadModel, extractParts, normalizeParts,
  Scatter, addBox, addCircle, addPlatform, colliders } from './core.js';
import { Heightfield, terrainMaterial, buildTerrainMeshes, buildGrass, buildWater, buildForest, treeColor, farForestAt } from './terrain.js';
import { buildSakura, buildBushes, buildBroadleafForest, sakuraColor, bushColor, hydraColor, leafColor } from './trees.js';
import { nobori, standBoard, postBox, busStop, garbagePoint, dryingRack, mailbox, crosswalk, playground, school, pedestrians } from './towndeco.js';
import { GeoBuilder as LGeo, lantern, bench, flushLandmarks } from './landmarks.js';
import { GeoBuilder, materials, night, updateNight, updateGlow, house, shopBuilding, konbini, apartment, shrine, utilityPole, wires, curveMirror, roadSign,
  vendingMachine, stopMat, lampPoints, signMesh, JP_FONT, bicycles, clockPole, chochin } from './townkit.js';
import { RAIL, buildRailway, buildCrossing, updateCrossings, crossings, crossingActive, Train, tunnelPortal } from './rail.js';
import { Fleet, Traffic, Route, randomCar, carDims } from './traffic.js';

export const meta = { name: 'Sakuragawa 桜川', startHour: 16.6, sunAzimuth: 2.6 };
const Y0 = 6;
const riverX = z => 215 + 22 * Math.sin(z * 0.0075) + 8 * Math.sin(z * 0.021 + 1);
const PADDIES = [[-650, -330, -430, -110], [-650, -40, -430, 330], [262, 0, 650, 330], [262, -330, 650, -100]];
const inPaddyZone = (x, z) => PADDIES.some(([a, b, c, d]) => x > a && x < c && z > b && z < d);
const SHRINE = { x: -60, z: -300 };

function paddyCell(x, z) { // returns {inside (0..1), levee} for the paddy grid
  const cx = ((x % 30) + 30) % 30, cz = ((z % 20) + 20) % 20;
  const e = Math.min(cx, 30 - cx, cz, 20 - cz);
  return e;
}
// the valley and its ring of hills, before any earthworks; far out, higher mountain ranges rise behind the hills so the
// horizon shows layered ridgelines (snow on the highest peaks)
function hills(x, z) {
  const ex = x / 720, ez = (z + 10) / 440, ve = Math.hypot(ex, ez);
  const hn = fbm(x * 0.004 + 7, z * 0.004 - 2, 5), ridge = erosion(x * 0.0021 + 5, z * 0.0021 - 3) * 0.5 + 0.5;
  const hill = smoothstep(0.8, 1.55, ve + hn * 0.12);
  let h = Y0 + fbm(x * 0.01, z * 0.01, 3) * 0.2 * (1 - hill) + hill * hill * (30 + ridge * ridge * 210 + hn * 30);
  const far = smoothstep(1350, 4600, Math.hypot(x, z * 1.2));
  if (far > 0) { const r = erosion(x * 0.00045 + 2.1, z * 0.00045 - 7.3, 6) * 0.5 + 0.5; h += far * (70 + r * r * 980 + ridge * 90); }
  return h;
}
// the main road climbs gently out of the valley; railway and road reach the hills in open cuttings and then bore into
// them through tunnels sited where the ground first stands 10.5 m above the formation, so no slot is carved through
// the mountains and the ridgelines stay whole (the ground over each bore is kept at least 12 m above the formation)
export const roadGrade = x => Y0 + Math.max(0, Math.abs(x) - 640) * 0.035;
function portalAt(z, sx, level) { for (let x = 450; x < 1000; x++) if (hills(sx * x, z) - level(x) >= 12) return x; return 1000; }
export const PORTALS = { railW: portalAt(-80, -1, () => Y0), railE: portalAt(-80, 1, () => Y0), roadW: portalAt(-25, -1, roadGrade), roadE: portalAt(-25, 1, roadGrade) };
RAIL.portalW = PORTALS.railW; RAIL.portalE = PORTALS.railE; RAIL.portal = Math.max(PORTALS.railW, PORTALS.railE);
// earthworks: a level formation `hw` wide, grassed banks at about 1:1.5 either side, back to the natural ground
const earthwork = (h, level, dz, hw) => { const bank = Math.max(0, dz - hw) * 0.68; return clamp(h, level - bank, level + bank); };
// smooth minimum (k = blend width in metres)
const smin = (a, b, k) => { if (k <= 0) return Math.min(a, b); const t = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - t * t * k * 0.25; };
function baseHeight(x, z) {
  let h = hills(x, z);
  const ax = Math.abs(x), pr = x < 0 ? PORTALS.railW : PORTALS.railE, pd = x < 0 ? PORTALS.roadW : PORTALS.roadE;
  // the cut runs one heightfield cell on into the portal under the arch itself, so the bore's floor is open ground
  const bore = (P, dz, hw) => ax < Math.ceil(P / 2) * 2 + 0.5 && dz < hw;
  if (ax < pr || bore(pr, Math.abs(z + 80), 6.6)) h = earthwork(h, Y0, Math.abs(z + 80), 7.4);
  else if (ax < pr + 170) h = Math.max(h, Y0 + 12 + (ax - pr) * 0.04 - Math.max(0, Math.abs(z + 80) - 10) * 0.6); // cover over the bore
  if (ax < pd || bore(pd, Math.abs(z + 25), 7.6)) h = earthwork(h, roadGrade(x), Math.abs(z + 25), 8.6);
  else if (ax < pd + 190) h = Math.max(h, roadGrade(x) + 12 + (ax - pd) * 0.04 - Math.max(0, Math.abs(z + 25) - 11) * 0.6);
  // shrine terrace
  h = lerp(h, Y0 + 0.4, smoothstep(34, 24, Math.hypot(x - SHRINE.x, z - SHRINE.z + 10)));
  // the river runs down a broad valley: flat floor, then walls of ~24 degrees meeting the hills in a soft crease
  const rd = Math.abs(x - riverX(z)), wall = Y0 + Math.max(0, rd - 30) * 0.45;
  h = smin(h, wall, Math.min(14, (wall - Y0) * 0.6));
  h = lerp(h, Y0, smoothstep(60, 30, rd));
  if (rd < 17) {
    const bed = rd < 5 ? -1.3 : rd < 12.5 ? lerp(-1.3, 0.45, (rd - 5) / 7.5) : 0.45;
    h = rd < 14.5 ? bed : lerp(0.45, h, (rd - 14.5) / 2.5);
  }
  return h;
}
// rice paddies are only laid out where the valley floor is flat: a cell whose natural ground rises more than ~1 m stays
// meadow, so paddies end where the hills begin instead of being cut into them behind a wall
const paddyCache = new Map();
function paddyOK(x, z) {
  const cx = Math.floor(x / 30) * 30, cz = Math.floor(z / 20) * 20, k = cx * 100003 + cz;
  let v = paddyCache.get(k);
  if (v === undefined) {
    v = inPaddyZone(cx + 15, cz + 10) && Math.abs(cx + 15 - riverX(cz + 10)) >= 30;
    for (const [px, pz] of [[0, 0], [30, 0], [0, 20], [30, 20], [15, 10]]) if (!v || !inPaddyZone(cx + Math.min(px, 29.9), cz + Math.min(pz, 19.9)) || baseHeight(cx + px, cz + pz) > Y0 + 0.9) v = false;
    paddyCache.set(k, v);
  }
  return v;
}
function height(x, z) {
  const h = baseHeight(x, z);
  // rice paddies: flat terraces with levees
  if (inPaddyZone(x, z) && paddyOK(x, z)) { const e = paddyCell(x, z); return Y0 - (e > 1.2 ? 0.35 : 0.05); }
  return h;
}

// ---------------------------------------------------------------- road network
// kind: main > road > lane > path ; w = carriageway width
const ROADS = [
  { id: 'A', kind: 'main', w: 7.0, walk: 2.5, center: 'yellow', pts: [[-PORTALS.roadW - 30, -25], [PORTALS.roadE + 30, -25]], mat: 'asphaltMain' },
  { id: 'B', kind: 'road', w: 6.0, center: 'white', pts: [[110, -340], [110, 330]], mat: 'asphaltRoad' },
  { id: 'C', kind: 'lane', w: 5.0, pts: [[-150, -300], [-150, 300]], mat: 'asphaltLane' },
  { id: 'D', kind: 'lane', w: 5.0, pts: [[-400, -312], [-400, 322]], mat: 'asphaltLane' },
  ...[48, 118, 188, 258].map((z, i) => ({ id: 'S' + i, kind: 'lane', w: 4.2, pts: [[-400, z], [110, z]], mat: 'asphaltLane2' })),
  ...[-150, -225].map((z, i) => ({ id: 'N' + i, kind: 'lane', w: 4.2, pts: [[-400, z], [110, z]], mat: 'asphaltLane2' })),
  ...[-275, -30].map((x, i) => ({ id: 'V' + i, kind: 'lane', w: 4.0, pts: [[x, -25], [x, 258]], mat: 'asphaltLane2' })),
  ...[-275, -30].map((x, i) => ({ id: 'W' + i, kind: 'lane', w: 4.0, pts: [[x, -100], [x, -225]], mat: 'asphaltLane2' })),
  { id: 'R', kind: 'lane', w: 4.5, pts: Array.from({ length: 34 }, (_, i) => { const z = -335 + i * 20; return [riverX(z) - 20, z]; }), mat: 'asphaltLane2' },
  { id: 'F', kind: 'lane', w: 4.0, pts: [[110, 200], [640, 200]], mat: 'asphaltLane2' },
  { id: 'P', kind: 'path', w: 3.0, pts: [[SHRINE.x, -225], [SHRINE.x, SHRINE.z + 4]], mat: 'gravelPath' },
];
const RANK = { main: 3, road: 2, lane: 1, path: 0 };

function segInter(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]], den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den, u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  if (t < -0.02 || t > 1.02 || u < -0.02 || u > 1.02) return null;
  return [a[0] + r[0] * t, a[1] + r[1] * t];
}
function roadSegs(R) { const out = []; for (let i = 0; i + 1 < R.pts.length; i++) out.push([R.pts[i], R.pts[i + 1]]); return out; }
function nearestOnRoad(R, x, z) {
  let best = { d: 1e9 };
  for (const [a, b] of roadSegs(R)) {
    const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz, t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / L2, 0, 1);
    const px = a[0] + dx * t, pz = a[1] + dz * t, d = Math.hypot(x - px, z - pz);
    if (d < best.d) best = { d, px, pz, dx: dx / Math.sqrt(L2), dz: dz / Math.sqrt(L2) };
  }
  return best;
}

export async function build(progress) {
  const reflected = new Set(scene.children); // sky, clouds, lights... (terrain + forest are added below)
  const MT = materials();
  MT.paddyWater = new THREE.MeshStandardMaterial({ color: 0x3b3a2a, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.72, depthWrite: false, envMapIntensity: 1.3 });

  const hf = new Heightfield({ world: 2048, grid: 1024, height });
  const { HN, HALF, CELL } = hf;
  const layers = {
    grass: { d: phTex('aerial_grass_rock', 'diff', '2k', true), n: phTex('aerial_grass_rock', 'nor_gl', '2k', false, NFLAT), s: 6, tint: [0.95, 1.1, 0.8] },
    forest: { d: phTex('forest_leaves_03', 'diff', '2k', true), n: phTex('forest_leaves_03', 'nor_gl', '1k', false, NFLAT), s: 3 },
    rock: { d: phTex('rock_face_03', 'diff', '2k', true), n: phTex('rock_face_03', 'nor_gl', '2k', false, NFLAT), s: 9 },
    shore: { d: phTex('brown_mud', 'diff', '1k', true), n: phTex('brown_mud', 'nor_gl', '1k', false, NFLAT), s: 3, tint: [0.85, 0.82, 0.78] },
    urban: { d: phTex('bicolour_gravel', 'diff', '1k', true), n: phTex('bicolour_gravel', 'nor_gl', '1k', false, NFLAT), s: 2.5, tint: [1.1, 1.03, 0.9], norm: 0.44 },
  };
  const modelsP = Promise.all(['shrub_02', 'potted_plant_04', 'planter_box_01', 'plastic_crate_01', 'utility_box_02', 'weed_plant_02', 'water_manhole_cover'].map(loadModel));
  await hf.generate(p => progress('Shaping the valley', p * 0.3));

  // ---------------------------------------------------------------- occupancy grid (1 m) for lots
  const OG = 1600, occ = new Uint8Array(OG * OG), oi = (x, z) => (Math.floor(z) + 800) * OG + (Math.floor(x) + 800);
  const occRect = (cx, cz, hw, hd, r, val, test) => {
    const c = Math.cos(r), s = Math.sin(r), R = Math.hypot(hw, hd);
    for (let z = Math.floor(cz - R); z <= cz + R; z++) for (let x = Math.floor(cx - R); x <= cx + R; x++) {
      const dx = x + 0.5 - cx, dz = z + 0.5 - cz, lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) > hw || Math.abs(lz) > hd) continue;
      if (x < -800 || z < -800 || x >= 800 || z >= 800) { if (test) return true; continue; }
      if (test) { if (occ[oi(x, z)]) return true; } else occ[oi(x, z)] = val;
    }
    return false;
  };
  const roadY = (x, z) => Math.abs(x - riverX(z)) < 17 ? Y0 + 0.35 : Math.abs(z + 25) < 6.5 && Math.abs(x) > 600 ? roadGrade(x) + 0.05 : hf.groundAt(x, z) + 0.05;

  // ---------------------------------------------------------------- roads, markings, intersections
  const B = new GeoBuilder(192);
  const inters = [];
  for (let i = 0; i < ROADS.length; i++) for (let j = i + 1; j < ROADS.length; j++) {
    for (const [a, b] of roadSegs(ROADS[i])) for (const [c, d] of roadSegs(ROADS[j])) {
      const p = segInter(a, b, c, d);
      if (p) inters.push({ p, roads: [ROADS[i], ROADS[j]] });
    }
  }
  const nearInter = (x, z, R, pad = 1.2) => inters.some(I => I.roads.includes(R) && (() => { const o = I.roads[0] === R ? I.roads[1] : I.roads[0]; return Math.hypot(x - I.p[0], z - I.p[1]) < o.w / 2 + (o.walk || 0) + pad; })());
  const onRail = z => Math.abs(z + 80) < 6.6;
  const onBridge = (x, z) => Math.abs(x - riverX(z)) < 17;
  for (const R of ROADS) {
    const hw = R.w / 2;
    for (const [a, b] of roadSegs(R)) {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]), dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L, nx = -dz, nz = dx;
      const n = Math.ceil(L / 2);
      for (let k = 0; k < n; k++) {
        const t0 = k / n * L, t1 = (k + 1) / n * L;
        const x0 = a[0] + dx * t0, z0 = a[1] + dz * t0, x1 = a[0] + dx * t1, z1 = a[1] + dz * t1;
        if (Math.abs(x0) > 900 || Math.abs(z0) > 700) continue;
        if (onRail((z0 + z1) / 2) && R.kind !== 'path') continue; // crossing deck is built by the railway
        B.frame(0, 0, 0, 0);
        const P = (x, z, s) => [x + nx * s, roadY(x + nx * s, z + nz * s), z + nz * s];
        B.quad(R.mat, P(x0, z0, hw), P(x1, z1, hw), P(x1, z1, -hw), P(x0, z0, -hw), { uvs: [[t0 / 4, 0], [t1 / 4, 0], [t1 / 4, R.w / 4], [t0 / 4, R.w / 4]] });
        // markings
        const mid = [(x0 + x1) / 2, (z0 + z1) / 2];
        if (nearInter(mid[0], mid[1], R)) continue;
        const line = (off, wdt, col, dash) => {
          if (dash && Math.floor(t0 / 5) % 2) return;
          const lift = 0.01, q = (x, z, s) => { const p = P(x, z, s); p[1] += lift; return p; };
          B.quad('paint', q(x0, z0, off + wdt / 2), q(x1, z1, off + wdt / 2), q(x1, z1, off - wdt / 2), q(x0, z0, off - wdt / 2), { color: col });
        };
        const white = [0.92, 0.92, 0.9], yellow = [0.95, 0.7, 0.1];
        if (R.kind === 'main') { line(0, 0.15, yellow); line(hw - 0.2, 0.15, white); line(-hw + 0.2, 0.15, white); }
        else if (R.kind === 'road') { line(0, 0.15, white, true); line(hw - 0.25, 0.15, white); line(-hw + 0.25, 0.15, white); }
        else if (R.kind === 'lane') { line(hw - 0.35, 0.15, white); line(-hw + 0.35, 0.15, white); }
        // kerbs + sidewalks
        if (R.walk && !onBridge(mid[0], mid[1])) for (const sd of [-1, 1]) {
          const o0 = sd * hw, o1 = sd * (hw + R.walk), yk = 0.15;
          const q = (x, z, s, lift) => { const p = P(x, z, s); p[1] += lift; return p; };
          if (sd > 0) {
            B.quad('pavement', q(x0, z0, o1, yk), q(x1, z1, o1, yk), q(x1, z1, o0, yk), q(x0, z0, o0, yk), { color: [0.85, 0.85, 0.83], uv: 1.2 });
            B.quad('concrete', q(x0, z0, o0, 0), q(x1, z1, o0, 0), q(x1, z1, o0, yk), q(x0, z0, o0, yk), { color: [0.8, 0.8, 0.78] });
          } else {
            B.quad('pavement', q(x0, z0, o0, yk), q(x1, z1, o0, yk), q(x1, z1, o1, yk), q(x0, z0, o1, yk), { color: [0.85, 0.85, 0.83], uv: 1.2 });
            B.quad('concrete', q(x1, z1, o0, 0), q(x0, z0, o0, 0), q(x0, z0, o0, yk), q(x1, z1, o0, yk), { color: [0.8, 0.8, 0.78] });
          }
        }
      }
      // occupancy + masks
      for (let t = 0; t <= L; t += 1) {
        const x = a[0] + dx * t, z = a[1] + dz * t;
        if (Math.abs(x) > 800 || Math.abs(z) > 800) continue;
        occRect(x, z, hw + (R.walk || 0) + 1, 1, Math.atan2(dx, dz), 1);
      }
      const ext = hw + (R.walk || 0) + 0.6;
      hf.paint2(2, Math.min(a[0], b[0]) - ext, Math.min(a[1], b[1]) - ext, Math.max(a[0], b[0]) + ext, Math.max(a[1], b[1]) + ext, (x, z) => { const q = nearestOnRoad({ pts: [a, b] }, x, z); return q.d < ext ? 1 : 0; });
      hf.paint2(0, Math.min(a[0], b[0]) - ext - 2, Math.min(a[1], b[1]) - ext - 2, Math.max(a[0], b[0]) + ext + 2, Math.max(a[1], b[1]) + ext + 2, (x, z) => { const q = nearestOnRoad({ pts: [a, b] }, x, z); return q.d < ext + 1.5 ? 0.8 : 0; });
    }
  }
  progress('Laying roads', 0.36); await tick();
  // railway and main road leave the valley through tunnels at both ends. Each headwall sits between the last cut
  // heightfield vertex and the first natural one, so it hides the step between them
  for (const sx of [-1, 1]) for (const [zc, P, level, o] of [[-80, sx < 0 ? PORTALS.railW : PORTALS.railE, () => Y0, { archW: 11, archH: 9.5, dzMax: 26 }],
    [-25, sx < 0 ? PORTALS.roadW : PORTALS.roadE, roadGrade, { archW: 13, archH: 8.5, dzMin: -26 }]]) {
    const xNat = sx * Math.ceil(P / hf.CELL) * hf.CELL, xCut = xNat - sx * hf.CELL, xHill = xNat + sx * hf.CELL, y = level(Math.abs(xCut));
    tunnelPortal(MT, { xFace: xCut, xBack: xHill, y, z: zc, sx, ...o, capAt: hf.CELL, top: dz => height(xHill, zc + dz) - y, bottom: dz => height(xCut, zc + dz) - y,
      cutDepth: dz => hills(xCut, zc + dz) - height(xCut, zc + dz) });
    addBox(xCut + sx * 1.0, zc, 1.0, o.archW / 2 + 1, 0); // nobody walks into the tunnel
  }

  // stop lines + 止まれ + stop signs where minor roads meet bigger ones, and before level crossings
  const stopSpots = []; // {x, z, hx, hz} approach heading
  const addStop = (x, z, hx, hz, w, sign) => {
    B.frame(0, 0, 0, 0);
    const nx = -hz, nz = hx, y = roadY(x, z) + 0.012;
    // stop line across the approach half (left lane) — full width on narrow lanes
    const half = w <= 5 ? w / 2 - 0.2 : 0.1;
    const q = (s, f) => [x + nx * s + hx * f, y, z + nz * s + hz * f];
    B.quad('paint', q(-w / 2 + 0.2, -0.22), q(half, -0.22), q(half, 0.22), q(-w / 2 + 0.2, 0.22), { color: [0.92, 0.92, 0.9] });
    const legend = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 3.2), stopMat);
    legend.rotation.x = -Math.PI / 2; legend.rotation.z = Math.atan2(hx, hz) + Math.PI;
    const lp = q(w <= 5 ? 0 : -w / 4, -3.4); legend.position.set(lp[0], lp[1] + 0.003, lp[2]); scene.add(legend);
    if (sign) { const sp = q(-w / 2 - 0.6, 0.3); roadSign(B, sp[0], hf.groundAt(sp[0], sp[2]), sp[2], Math.atan2(-hx, -hz), 'stop'); }
    stopSpots.push({ x, z, hx, hz });
  };
  for (const I of inters) {
    const [r1, r2] = I.roads;
    if (RANK[r1.kind] === RANK[r2.kind] && r1.kind !== 'lane') continue;
    const [major, minor] = RANK[r1.kind] >= RANK[r2.kind] ? [r1, r2] : [r2, r1];
    if (minor.kind === 'path' || onBridge(I.p[0], I.p[1])) continue;
    const mn = nearestOnRoad(minor, I.p[0], I.p[1]);
    for (const dir of [-1, 1]) {
      const hx = mn.dx * dir, hz = mn.dz * dir, back = major.w / 2 + (major.walk || 0) + 1.2;
      const sx = I.p[0] - hx * back, sz = I.p[1] - hz * back;
      // only if the minor road actually continues on this side
      if (nearestOnRoad(minor, sx - hx * 3, sz - hz * 3).d > 0.5) continue;
      addStop(sx, sz, hx, hz, minor.w, true);
    }
  }
  // level crossings on B, C, D
  const crossingRoads = ROADS.filter(R => ['B', 'C', 'D'].includes(R.id));
  const Bx = new GeoBuilder(192);
  const railInfo = buildRailway({ y0: Y0, riverX, B: Bx });
  for (const R of crossingRoads) {
    const x = R.pts[0][0];
    buildCrossing(Bx, x, Y0, R.w + 0.4);
    for (const dir of [-1, 1]) addStop(x, -80 - dir * 8.6, 0, dir, R.w, false);
    const sgn = [[-1, -89.5], [1, -70.5]];
    for (const [sd, z] of sgn) roadSign(B, x + sd * (R.w / 2 + 1.4), Y0, z + sd * 2, sd > 0 ? 0 : Math.PI, 'crossing');
  }
  // occupancy/masks for railway corridor, river corridor, station
  occRect(0, -80, 1000, 13, 0, 1);
  for (let z = -800; z < 800; z += 1) { const rx = riverX(z); occRect(rx, z, 24, 0.6, 0, 1); }
  hf.paint2(2, -PORTALS.railW, -92, PORTALS.railE, -68, (x, z) => Math.abs(z + 80) < 11 ? 1 : 0);
  // station plaza
  B.frame(0, 0, 0, 0);
  B.box('pavement', RAIL.stationX + 6, Y0 - 0.2, -47.5, 64, 0.34, 32, { color: [0.86, 0.85, 0.82], uv: 1.2, skip: 'ny' });
  occRect(RAIL.stationX + 6, -47.5, 34, 17, 0, 1);
  hf.paint2(2, -60, -66, 75, -30, () => 1); hf.paint2(0, -60, -66, 75, -30, () => 1);
  addPlatform(RAIL.stationX + 6, -47.5, 32, 16, 0, Y0 + 0.14);
  { // plaza furniture: bicycle parking under a shelter, clock, bus stop
    const py = Y0 + 0.14, prng0 = mulberry32(55), bikes = [];
    for (let row = 0; row < 2; row++) for (let i = 0; i < 16; i++) if (prng0() < 0.85) bikes.push({ x: 20 + i * 0.62, y: py, z: -58 + row * 2.6, r: Math.PI / 2 + (row ? Math.PI : 0) + (prng0() - 0.5) * 0.1 });
    bicycles(bikes.map(b => ({ ...b, x: b.x + 6 })), prng0);
    B.frame(35.6, py, -56.7, 0);
    for (const sx of [-5.2, 5.2]) for (const sz of [-2.2, 2.2]) B.box('alu', sx, 0, sz, 0.1, 2.3, 0.1, { color: [0.55, 0.58, 0.6] });
    B.box('roofMetal', 0, 2.3, 0, 11, 0.08, 5.2, { color: [0.35, 0.45, 0.5], uv: 2 });
    addBox(35.6, -56.7, 5.4, 2.4, 0, -1e9, py + 1.2);
    clockPole(B, -6, py, -40);
    for (const z of [-58, -55.4]) addBox(30.7, z, 5.2, 0.35, 0, -1e9, py + 1.1);
  }
  // river banks: concrete revetments with railings, plus bridges
  for (let z = -760; z < 760; z += 4) {
    for (const sd of [-1, 1]) {
      const xa = riverX(z) + sd * 14.6, xb = riverX(z + 4) + sd * 14.6;
      B.frame(0, 0, 0, 0);
      if (sd < 0) B.quad('stone', [xa, 0.2, z], [xb, 0.2, z + 4], [xb, Y0 + 0.15, z + 4], [xa, Y0 + 0.15, z], { uv: 2, color: [0.8, 0.8, 0.78] });
      else B.quad('stone', [xb, 0.2, z + 4], [xa, 0.2, z], [xa, Y0 + 0.15, z], [xb, Y0 + 0.15, z + 4], { uv: 2, color: [0.8, 0.8, 0.78] });
      // paved walkway on top of the bank, with a skirt down to the ground on its outer edge
      if (Math.abs(z + 78) > 8) {
        const xo = riverX(z) + sd * 17.6, xo2 = riverX(z + 4) + sd * 17.6, yd = Y0 + 0.12, pc = { uv: 1.5, color: [0.88, 0.86, 0.82] }, sk = { uv: 2, color: [0.72, 0.72, 0.7] };
        if (sd > 0) { B.quad('pavement', [xa, yd, z], [xb, yd, z + 4], [xo2, yd, z + 4], [xo, yd, z], pc); B.quad('concrete', [xo2, Y0 - 1.2, z + 4], [xo, Y0 - 1.2, z], [xo, yd, z], [xo2, yd, z + 4], sk); }
        else { B.quad('pavement', [xo, yd, z], [xo2, yd, z + 4], [xb, yd, z + 4], [xa, yd, z], pc); B.quad('concrete', [xo, Y0 - 1.2, z], [xo2, Y0 - 1.2, z + 4], [xo2, yd, z + 4], [xo, yd, z], sk); }
      }
      if (Math.abs(z + 25) < 12 || Math.abs(z + 80) < 12 || Math.abs(z - 200) < 10) continue;
      // railing: rails follow the bank's curve segment by segment, posts every 2 m
      const ra = xa + sd * 0.4, rb = xb + sd * 0.4, rc = { color: [0.3, 0.52, 0.47] };
      B.beam('alu', [ra, Y0 + 1.07, z], [rb, Y0 + 1.07, z + 4], 0.07, 0.07, rc);
      B.beam('alu', [ra, Y0 + 0.62, z], [rb, Y0 + 0.62, z + 4], 0.035, 0.035, rc);
      for (const k of [0, 0.5]) B.box('alu', lerp(ra, rb, k), Y0 + 0.1, z + 4 * k, 0.06, 0.97, 0.06, rc);
      addBox((ra + rb) / 2, z + 2, 0.1, 2.05, Math.atan2(rb - ra, 4));
    }
  }
  for (const [bz, bw] of [[-25, 7 + 5], [200, 4.0 + 1]]) {
    const rx = riverX(bz);
    B.frame(rx, Y0, bz, 0);
    B.box('concrete', 0, -0.9, 0, 34, 1.2, bw + 1.2, { color: [0.74, 0.74, 0.72], uv: 3 });
    for (const sd of [-1, 1]) { B.box('concrete', 0, 0.3, sd * (bw / 2 + 0.45), 34, 0.8, 0.3, { color: [0.78, 0.78, 0.76], uv: 3 }); addBox(rx, bz + sd * (bw / 2 + 0.45), 17, 0.2, 0); }
    for (const px of [-7, 7]) B.box('concrete', px, -8, 0, 1.6, 6.5, bw, { color: [0.7, 0.7, 0.68], uv: 3 });
    addPlatform(rx, bz, 17, bw / 2 + 0.3, 0, Y0 + 0.35);
  }
  progress('Building the railway', 0.42); await tick();

  // ---------------------------------------------------------------- lots and buildings
  const rng = mulberry32(4242), extras = [], carSpots = [];
  const reserve = (cx, cz, hw, hd, r) => { occRect(cx, cz, hw, hd, r, 1); };
  // konbini on the corner of A and B
  const kb = { x: 134, y: 0, z: -3, r: 0, w: 22, d: 13 };
  kb.z = -3 - 6; kb.y = hf.groundAt(kb.x, kb.z);
  const kLot = { x: 134, z: 0, hw: 20, hd: 16 };
  reserve(kLot.x, kLot.z, kLot.hw, kLot.hd, 0);
  konbini(B, { x: kb.x, y: Y0, z: 7, r: Math.PI, w: 22, d: 13 }, rng, extras);
  B.frame(0, 0, 0, 0); B.box('asphaltLane2', 134, Y0 - 0.1, -9, 38, 0.15, 17, { uv: 4, skip: 'ny' });
  for (let i = 0; i < 7; i++) B.box('paint', 118 + i * 5, Y0 + 0.052, -10, 0.12, 0.01, 5, { color: [0.92, 0.92, 0.9] });
  hf.paint2(2, 114, -20, 156, 16, () => 1);
  // apartment block
  const apt = { x: -95, z: 138, r: Math.PI, w: 34, d: 11 };
  reserve(apt.x, apt.z, apt.w / 2 + 2, apt.d / 2 + 3, apt.r);
  apartment(B, { ...apt, y: hf.groundAt(apt.x, apt.z) }, rng, extras);
  B.frame(0, 0, 0, 0); B.box('asphaltLane2', apt.x, Y0 - 0.1, 126, 34, 0.15, 11, { uv: 4, skip: 'ny' });
  hf.paint2(2, apt.x - 18, 118, apt.x + 18, 146, () => 1);
  for (let i = 0; i < 6; i++) carSpots.push({ p: [apt.x - 14 + i * 5.5, Y0, 127], r: 0 });
  // shrine
  shrine(B, SHRINE.x, hf.groundAt(SHRINE.x, SHRINE.z), SHRINE.z, 0, extras);
  reserve(SHRINE.x, SHRINE.z - 12, 12, 22, 0);
  // an elementary school fills the block between lanes C, V1, S2 and S3; a playground park opens onto lane S0
  const drng = mulberry32(2024), schoolSak = [], parkTrees = [], bikeList = [], gardenTrees = [];
  const SCH = { x: -89.75, z: 223, w: 113, d: 64 }, PK = { x: -212, z: 69.5, w: 42, d: 32 };
  reserve(SCH.x, SCH.z, SCH.w / 2 + 1, SCH.d / 2 + 1, 0);
  school(B, SCH.x, hf.groundAt(SCH.x, SCH.z), SCH.z, Math.PI, SCH.w, SCH.d, drng, schoolSak, bikeList, extras);
  hf.paint2(0, SCH.x - SCH.w / 2, SCH.z - SCH.d / 2, SCH.x + SCH.w / 2, SCH.z + SCH.d / 2, (x, z) => Math.abs(x - SCH.x) < SCH.w / 2 - 4 && Math.abs(z - SCH.z) < SCH.d / 2 - 4 ? 1 : 0);
  hf.paint2(2, SCH.x - SCH.w / 2, SCH.z - SCH.d / 2, SCH.x + SCH.w / 2, SCH.z + SCH.d / 2, (x, z) => Math.abs(x - SCH.x) < SCH.w / 2 - 4.5 && Math.abs(z - SCH.z) < SCH.d / 2 - 4.5 || Math.abs(x - SCH.x) < 4.5 && z < SCH.z ? 1 : 0);
  hf.paint2(0, SCH.x - 6, SCH.z - SCH.d / 2 - 2, SCH.x + 6, SCH.z, (x, z) => Math.abs(x - SCH.x) < 4.2 ? 1 : 0); // paved way in from the gate
  reserve(PK.x, PK.z, PK.w / 2 + 1, PK.d / 2 + 1, 0);
  playground(B, PK.x, hf.groundAt(PK.x, PK.z), PK.z, Math.PI, PK.w, PK.d, drng, parkTrees, extras);
  hf.paint2(0, PK.x - PK.w / 2, PK.z - PK.d / 2, PK.x + PK.w / 2, PK.z + PK.d / 2, (x, z) => Math.abs(x - PK.x) < PK.w / 2 - 4 && Math.abs(z - PK.z) < PK.d / 2 - 4 ? 1 : 0);
  hf.paint2(2, PK.x - PK.w / 2, PK.z - PK.d / 2, PK.x + PK.w / 2, PK.z + PK.d / 2, (x, z) => Math.abs(x - PK.x) < PK.w / 2 - 4.5 && Math.abs(z - PK.z) < PK.d / 2 - 4.5 ? 1 : 0);

  // lots along roads
  const lots = [];
  for (const R of ROADS) {
    if (R.kind === 'path' || R.id === 'R' || R.id === 'F') continue;
    for (const [a, b] of roadSegs(R)) {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]), dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
      for (const side of [-1, 1]) {
        const nx = -dz * side, nz = dx * side;
        let t = 4;
        while (t < L - 4) {
          const w = 10 + rng() * 3.5, d = 13.5 + rng() * 3;
          const cx = a[0] + dx * (t + w / 2) + nx * (R.w / 2 + (R.walk || 0) + 0.7 + d / 2), cz = a[1] + dz * (t + w / 2) + nz * (R.w / 2 + (R.walk || 0) + 0.7 + d / 2);
          const r = Math.atan2(-nx, -nz);
          t += w + 0.3;
          if (Math.abs(cx) > 640 || Math.abs(cz) > 345 || inPaddyZone(cx, cz)) continue;
          if (hf.groundAt(cx, cz) > Y0 + 1.2 || hf.groundAt(cx, cz) < Y0 - 0.6) continue;
          if (occRect(cx, cz, w / 2, d / 2, r, 0, true)) continue;
          if (rng() < 0.04) continue; // empty lot
          occRect(cx, cz, w / 2, d / 2, r, 1);
          const shop = R.id === 'A' && cx > -270 && cx < 200;
          lots.push({ x: cx, z: cz, r, w, d, shop, road: R });
          // flag lot behind (旗竿地) reached by a narrow driveway beside the front lot
          if (!shop) for (let row = 1; row <= 2; row++) {
            const off = (d + 0.6) * row, bw = 10 + rng() * 3, bd = 13 + rng() * 3;
            const bx = cx - nx * off, bz = cz - nz * off;
            if (Math.abs(bx) > 640 || Math.abs(bz) > 345 || inPaddyZone(bx, bz) || hf.groundAt(bx, bz) > Y0 + 1.2) break;
            if (occRect(bx, bz, bw / 2, bd / 2, r, 0, true)) break;
            occRect(bx, bz, bw / 2, bd / 2, r, 1);
            lots.push({ x: bx, z: bz, r, w: bw, d: bd, shop: false, road: R, back: true });
          }
        }
      }
    }
  }
  progress('Building houses', 0.5); await tick();
  const vend = [];
  const srng = mulberry32(3131), sakura = [], hydras = [], bushes = [];
  const lotW = (lot, lx, lz) => { const c = Math.cos(lot.r), s = Math.sin(lot.r); return [lot.x + lx * c + lz * s, lot.z - lx * s + lz * c]; };
  let li = 0;
  for (const lot of lots) {
    const y = hf.groundAt(lot.x, lot.z);
    if (lot.shop) {
      shopBuilding(B, { x: lot.x, y, z: lot.z, r: lot.r, w: lot.w, d: Math.min(lot.d, 12) }, rng, extras);
      hf.paint2(2, lot.x - 9, lot.z - 9, lot.x + 9, lot.z + 9, (x, z) => { const c = Math.cos(lot.r), s = Math.sin(lot.r), dx = x - lot.x, dz = z - lot.z; return Math.abs(dx * c - dz * s) < lot.w / 2 && Math.abs(dx * s + dz * c) < lot.d / 2 ? 1 : 0; });
      if (rng() < 0.18) vend.push({ lot, off: [lot.w / 2 - 0.6, Math.min(lot.d, 12) / 2 + 0.6] });
      if (srng() < 0.45) { // flower planter by the shop door
        const fz = Math.min(lot.d, 12) / 2 + 0.45, lx = -lot.w / 2 + 1.1;
        B.frame(lot.x, y, lot.z, lot.r); B.box('wood', lx, 0, fz, 1.3, 0.42, 0.5, { color: [0.62, 0.44, 0.3] });
        const [px, pz] = lotW(lot, lx, fz); addBox(px, pz, 0.65, 0.25, lot.r, y - 1, y + 0.5);
        for (const o of [-0.35, 0.35]) { const [hx, hz] = lotW(lot, lx + o, fz); hydras.push({ x: hx, y: y + 0.36, z: hz, s: 0.62 + srng() * 0.15, sx: 1, r: srng() * 6.28, c: hydraColor(srng) }); }
      }
      // shopfront clutter: a pair of nobori banners, a chalk signboard, customers' bicycles
      const sfz = Math.min(lot.d, 12) / 2;
      if (drng() < 0.5) { const col = [[0.86, 0.18, 0.14], [0.18, 0.4, 0.78], [0.98, 0.78, 0.2], [0.22, 0.62, 0.42], [0.95, 0.5, 0.65]][Math.floor(drng() * 5)];
        for (const o of [2.3, 2.95]) { const [nx, nz] = lotW(lot, -lot.w / 2 + o, sfz + 0.4); nobori(B, nx, y, nz, lot.r, col); addCircle(nx, nz, 0.18); } }
      if (drng() < 0.35) { const [bx, bz] = lotW(lot, lot.w * 0.08, sfz + 0.7); standBoard(B, bx, y, bz, lot.r + (drng() - 0.5) * 0.4, [[0.92, 0.9, 0.86], [0.55, 0.36, 0.24], [0.2, 0.3, 0.45]][Math.floor(drng() * 3)]); addCircle(bx, bz, 0.3); }
      if (drng() < 0.4) for (let k = 0, n = 1 + Math.floor(drng() * 3); k < n; k++) { const [bx, bz] = lotW(lot, lot.w * 0.22 + k * 0.62, sfz + 1.05); bikeList.push({ x: bx, y, z: bz, r: lot.r + Math.PI / 2 + (drng() - 0.5) * 0.15 }); }
    } else {
      const info = house(B, { x: lot.x, y, z: lot.z, r: lot.r, w: lot.w, d: lot.d }, rng, extras);
      // a blossom tree in some front gardens (the gate + parking side is the right, so the left corner is free), hydrangeas in the others
      if (srng() < 0.2) { const [tx, tz] = lotW(lot, -lot.w / 2 + 1.8, lot.d / 2 - 2); lot.sakura = true; sakura.push({ garden: true, x: tx, y: y - 0.15, z: tz, s: lerp(5.5, 7, srng()), sx: 1, r: srng() * 6.28, c: sakuraColor(srng) }); }
      else if (srng() < 0.65) for (let k = 0; k < 2; k++) { const [hx, hz] = lotW(lot, -lot.w / 2 + 0.9 + k * 1.2, lot.d / 2 - 0.9); hydras.push({ x: hx, y: y - 0.05, z: hz, s: 0.9 + srng() * 0.4, sx: 0.9 + srng() * 0.3, r: srng() * 6.28, c: hydraColor(srng) }); }
      if (info.carSpot) carSpots.push(info.carSpot);
      // yard life: a clipped garden tree, laundry in the side yard, a mailbox by the gate, bicycles beside the car
      if (!lot.sakura && drng() < 0.4) { const [tx, tz] = lotW(lot, -lot.w / 2 + 2.9, lot.d / 2 - 2.3); lot.niwaki = true; gardenTrees.push({ x: tx, y: y - 0.1, z: tz, s: lerp(3.6, 5.0, drng()), sx: 0.9 + drng() * 0.25, r: drng() * 6.28, c: leafColor(drng) }); }
      const gapL = info.hx - info.W / 2 + lot.w / 2, gapR = lot.w / 2 - info.hx - info.W / 2;
      if (drng() < 0.3 && Math.max(gapL, gapR) > 1.5) { const left = gapL >= gapR, g = left ? gapL : gapR, lx = left ? -lot.w / 2 + g / 2 : lot.w / 2 - g / 2, [rx, rz] = lotW(lot, lx, info.hz - 0.5);
        dryingRack(B, rx, y, rz, lot.r + Math.PI / 2, drng, Math.min(2.6, info.D - 2)); }
      if (drng() < 0.45) { const [mx, mz] = lotW(lot, lot.w / 2 - 4.0, lot.d / 2 - 0.4); mailbox(B, mx, y, mz, lot.r, [[0.22, 0.32, 0.52], [0.86, 0.86, 0.84], [0.58, 0.26, 0.2], [0.26, 0.26, 0.28], [0.32, 0.48, 0.36]][Math.floor(drng() * 5)]); }
      if (info.carSpot && drng() < 0.35) for (let k = 0, n = 1 + Math.floor(drng() * 2); k < n; k++) { const [bx, bz] = lotW(lot, lot.w / 2 - 0.55, lot.d / 2 - 4.6 + k * 0.75); bikeList.push({ x: bx, y, z: bz, r: lot.r + Math.PI / 2 + (drng() - 0.5) * 0.1 }); }
      hf.paint2(0, lot.x - 10, lot.z - 10, lot.x + 10, lot.z + 10, (x, z) => { const c = Math.cos(lot.r), s = Math.sin(lot.r), dx = x - lot.x, dz = z - lot.z, lx = dx * c - dz * s, lz = dx * s + dz * c; return Math.abs(lx) < lot.w / 2 && Math.abs(lz) < lot.d / 2 ? (lz > lot.d / 2 - 6 ? 0.9 : 0.25) : 0; });
      hf.paint2(2, lot.x - 10, lot.z - 10, lot.x + 10, lot.z + 10, (x, z) => { const c = Math.cos(lot.r), s = Math.sin(lot.r), dx = x - lot.x, dz = z - lot.z, lx = dx * c - dz * s, lz = dx * s + dz * c; return Math.abs(lx) < lot.w / 2 - 0.3 && Math.abs(lz) < lot.d / 2 - 0.3 && lz > lot.d / 2 - 6.5 ? 1 : 0; });
      if (rng() < 0.07) vend.push({ lot, off: [-lot.w / 2 + 0.8, lot.d / 2 + 0.55] });
    }
    if (++li % 40 === 0) { progress('Building houses', 0.5 + 0.12 * li / lots.length); await tick(); }
  }
  // zebra crossings on the main road and road B beside every junction
  for (const I of inters) {
    const major = I.roads.find(R => R.id === 'A') || I.roads.find(R => R.id === 'B'); if (!major) continue;
    const minor = I.roads[0] === major ? I.roads[1] : I.roads[0]; if (minor.kind === 'path') continue;
    const q = nearestOnRoad(major, I.p[0], I.p[1]);
    for (const dir of [-1, 1]) {
      const d = minor.w / 2 + (minor.walk || 0) + 2.4, x = I.p[0] + q.dx * dir * d, z = I.p[1] + q.dz * dir * d;
      if (Math.abs(x) > 460 || Math.abs(z) > 340 || onRail(z) || onBridge(x, z)) continue;
      crosswalk(B, x, roadY(x, z), z, q.dx, q.dz, major.w, 3.2);
    }
  }
  // street trees in square planters along the main road's sidewalks, outside the shopping street
  const streetTrees = [];
  for (let x = -430; x < 430; x += 13) for (const sd of [-1, 1]) {
    if (x > -268 && x < 205 || Math.abs(x - riverX(-25)) < 32 || nearInter(x, -25, ROADS[0], 5)) continue;
    const z = -25 + sd * 4.3; streetTrees.push({ x, y: Y0 + 0.1, z, s: lerp(7, 8.5, drng()), sx: 0.9, r: drng() * 6.28, c: leafColor(drng) });
    B.frame(x, Y0 + 0.15, z, 0); B.box('concrete', 0, 0, 0, 1.3, 0.12, 1.3, { color: [0.78, 0.78, 0.76] }); B.box('plain', 0, 0.02, 0, 1.1, 0.12, 1.1, { color: [0.36, 0.28, 0.22] });
  }
  // bus stops, post boxes, garbage points
  for (const [x, sd] of [[-205, 1], [58, -1], [300, 1]]) { const z = -25 + sd * 5.55; busStop(B, x, Y0 + 0.15, z, sd > 0 ? Math.PI : 0); }
  for (const z of [-150, 120]) busStop(B, 110 + 3.6, Y0, z, -Math.PI / 2, false);
  for (const [x, sd] of [[-128, 1], [22, 1], [158, -1], [-240, -1]]) postBox(B, x, Y0 + 0.15, -25 + sd * 5.4, sd > 0 ? Math.PI : 0);
  for (const R of ROADS) if (R.kind === 'lane' && R.id !== 'R') for (const [a, b] of roadSegs(R)) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
    for (let t = 40 + drng() * 30; t < L - 20; t += 90 + drng() * 60) {
      const sd = drng() < 0.5 ? 1 : -1, x = a[0] + dx * t - dz * sd * (R.w / 2 + 0.45), z = a[1] + dz * t + dx * sd * (R.w / 2 + 0.45);
      if (Math.abs(x) > 440 || Math.abs(z) > 330 || nearInter(x, z, R, 4) || onRail(z) || Math.abs(x - riverX(z)) < 26 || hf.groundAt(x, z) > Y0 + 1) continue;
      garbagePoint(B, x, hf.groundAt(x, z), z, Math.atan2(dx, dz) + (sd > 0 ? -Math.PI / 2 : Math.PI / 2), drng);
    }
  }
  // festival lantern strings across the shopping street
  for (let x = -252; x < 190; x += 21) {
    if (nearInter(x, -25, ROADS[0], 5) || Math.abs(x - riverX(-25)) < 26) continue;
    B.frame(x, Y0, -25, 0);
    for (const sd of [-1, 1]) { B.box('wood', 0, 0.1, sd * 6.35, 0.15, 5.35, 0.15, { color: [0.52, 0.37, 0.26] }); B.box('wood', 0, 5.4, sd * 6.35, 0.2, 0.08, 0.2, { color: [0.3, 0.22, 0.16] }); addCircle(x, -25 + sd * 6.35, 0.16); }
    const N = 10, pt = i => { const t = i / N; return [0, 5.2 - 0.75 * 4 * t * (1 - t), -6.35 + 12.7 * t]; };
    for (let i = 0; i < N; i++) B.beam('dark', pt(i), pt(i + 1), 0.025, 0.025);
    for (let i = 1; i < N; i++) { const p = pt(i); B.box('dark', 0, p[1] - 0.16, p[2], 0.015, 0.16, 0.015); chochin(B, 0, p[1] - 0.62, p[2], i % 2 ? [1, 0.3, 0.2] : [1, 0.88, 0.7], 0.8); }
    lampPoints.push({ p: [x, 4.4, -25], s: 0.6 });
  }
  // colliders from buildings/walls
  for (const e of extras) {
    if (e.t === 'box') addBox(e.p[0], e.p[2], e.hx, e.hz, e.r, e.p[1] - 1, e.p[1] + (e.h || 20));
    else if (e.t === 'circle') addCircle(e.p[0], e.p[2], e.r);
  }
  // carport roofs (translucent polycarbonate)
  for (const e of extras) if (e.t === 'poly') { const m = new THREE.Mesh(new THREE.PlaneGeometry(e.w, e.d).rotateX(-Math.PI / 2), MT.poly); m.position.set(...e.p); m.rotation.y = e.r; scene.add(m); }
  // vending machines: station plaza, konbini, scattered along lanes
  let vi = 0;
  for (const [x, z, r] of [[RAIL.stationX + 18, -35.5, 0], [RAIL.stationX + 19.1, -35.5, 0], [RAIL.stationX + 20.2, -35.5, 0], [150, 4.5, Math.PI], [151.1, 4.5, Math.PI], [-120, -34, Math.PI]]) vendingMachine(x, Y0 + (z < -30 && z > -64 && x > -30 && x < 75 ? 0.14 : 0), z, r, vi++);
  for (const v of vend) {
    const c = Math.cos(v.lot.r), s = Math.sin(v.lot.r), lx = v.off[0], lz = v.off[1];
    const x = v.lot.x + lx * c + lz * s, z = v.lot.z - lx * s + lz * c;
    for (let k = 0; k < (rng() < 0.5 ? 2 : 1); k++) vendingMachine(x + c * k * 1.1, hf.groundAt(x, z), z - s * k * 1.1, v.lot.r, vi++);
  }
  progress('Stringing power lines', 0.64); await tick();

  // ---------------------------------------------------------------- utility poles and wires
  for (const R of ROADS) {
    if (R.kind === 'path' || R.id === 'A' && false) continue;
    for (const [a, b] of roadSegs(R)) {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]), dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L, side = R.id.charCodeAt(0) % 2 ? 1 : -1;
      const nx = -dz * side, nz = dx * side, off = R.w / 2 + (R.walk ? R.walk - 0.5 : 0.45);
      const poles = [];
      let k = 0;
      for (let t = 6; t < L - 4; t += 28 + rng() * 6) {
        const x = a[0] + dx * t + nx * off, z = a[1] + dz * t + nz * off;
        if (Math.abs(x) > 700 || Math.abs(z) > 360 || nearInter(x, z, R, 3) || Math.abs(z + 80) < 11 || Math.abs(x - riverX(z)) < 20) { if (poles.length) { wires(poles); poles.length = 0; } continue; }
        if (hf.groundAt(x, z) > Y0 + 3) continue;
        const pole = utilityPole(B, x, hf.groundAt(x, z), z, Math.atan2(dx, dz), rng, { transformer: rng() < 0.25, light: k++ % 2 === 0, side });
        if (pole.lamp) lampPoints.push({ p: pole.lamp, s: 1.0 });
        poles.push(pole);
      }
      if (poles.length > 1) wires(poles);
    }
  }
  // curve mirrors at lane junctions
  for (const I of inters) {
    if (!I.roads.every(r => r.kind === 'lane') || rng() < 0.4) continue;
    const x = I.p[0] + 3.4, z = I.p[1] + 3.4;
    if (occRect(x, z, 0.2, 0.2, 0, 0, true) && rng() < 0.5) continue;
    curveMirror(B, x, hf.groundAt(x, z), z, Math.PI * 1.25);
  }
  // speed-limit signs on B
  for (const z of [-200, 60, 250]) roadSign(B, 110 + 4.2, Y0, z, Math.PI / 2 * 0, 'speed30');

  // ---------------------------------------------------------------- rice paddy water surfaces
  for (const [x0, z0, x1, z1] of PADDIES) {
    for (let cx = Math.ceil(x0 / 30) * 30; cx < x1 - 1; cx += 30) for (let cz = Math.ceil(z0 / 20) * 20; cz < z1 - 1; cz += 20) {
      if (!paddyOK(cx + 15, cz + 10)) continue;
      B.frame(0, 0, 0, 0);
      const y = Y0 - 0.3, a = [cx + 1.3, y, cz + 1.3], b = [cx + 28.7, y, cz + 18.7];
      B.quad('paddyWater', [a[0], y, b[2]], [b[0], y, b[2]], [b[0], y, a[2]], [a[0], y, a[2]], { uv: 10 });
    }
    hf.paint2(1, x0, z0, x1, z1, (x, z) => inPaddyZone(x, z) && paddyOK(x, z) && paddyCell(x, z) > 1.4 ? 1 : 0);
  }
  // town lawns are mowed; yards are gravel
  hf.paint2(3, -460, -345, 205, 345, (x, z) => !inPaddyZone(x, z) && hf.groundAt(x, z) < Y0 + 1.5 && Math.abs(x - riverX(z)) > 16 ? 1 : 0);
  for (const lot of lots) hf.paint2(0, lot.x - 10, lot.z - 10, lot.x + 10, lot.z + 10, (x, z) => { const c = Math.cos(lot.r), s = Math.sin(lot.r), dx = x - lot.x, dz = z - lot.z; return Math.abs(dx * c - dz * s) < lot.w / 2 && Math.abs(dx * s + dz * c) < lot.d / 2 ? 0.55 : 0; });
  // shrine approach gravel
  hf.paint2(2, SHRINE.x - 12, SHRINE.z - 40, SHRINE.x + 12, -222, (x, z) => Math.abs(x - SHRINE.x) < 8 || Math.hypot(x - SHRINE.x, z - SHRINE.z + 12) < 16 ? 1 : 0);
  hf.paint2(2, SHRINE.x - 12, SHRINE.z - 40, SHRINE.x + 12, -222, (x, z) => Math.abs(x - SHRINE.x) < 2 ? 1 : 0);

  // ---------------------------------------------------------------- hills: cedar forest
  progress('Planting cedar forests', 0.7); await tick();
  const trees = [], nrm = new THREE.Vector3(), FOREST = new Float32Array(HN * HN);
  for (let j = 0; j < HN; j++) for (let i = 0; i < HN; i++) {
    const x = -HALF + i * CELL, z = -HALF + j * CELL, h = hf.H[j * HN + i];
    const f = smoothstep(Y0 + 4, Y0 + 14, h) * smoothstep(-0.3, 0.1, fbm(x * 0.006 + 3, z * 0.006, 3)) * smoothstep(0.62, 0.8, hf.gridNormalY(i, j));
    const shrineWood = smoothstep(55, 30, Math.hypot(x - SHRINE.x, z - SHRINE.z + 14)) * (Math.hypot(x - SHRINE.x, z - SHRINE.z + 14) > 20 ? 1 : 0) * (z > SHRINE.z + 8 ? smoothstep(10, 15, Math.abs(x - SHRINE.x)) : Math.abs(x - SHRINE.x) > 5 ? 1 : 0); // open lawns along the approach
    let v = Math.max(f, shrineWood);
    const edge = smoothstep(HALF - 240, HALF - 20, Math.max(Math.abs(x), Math.abs(z))); // woods continue past the map edge
    if (edge > 0) v = lerp(v, farForestAt(x, z, h, 1 - hf.gridNormalY(i, j), 0, 900), edge);
    FOREST[j * HN + i] = v; hf.mask[(j * HN + i) * 4] = v * 255;
  }
  await hf.bakeAO();
  for (let gz = -HALF; gz < HALF; gz += 6.5) for (let gx = -HALF; gx < HALF; gx += 6.5) {
    const x = gx + (rng() - 0.5) * 5, z = gz + (rng() - 0.5) * 5, f = FOREST[hf.idx(x, z)];
    if (rng() > f * 0.95) continue;
    const inCut = (zc, pw, pe, w) => Math.abs(z - zc) < w && Math.abs(x) < (x < 0 ? pw : pe) + 4; // trees grow over the tunnels
    if (inCut(-80, PORTALS.railW, PORTALS.railE, 12) || Math.abs(x - riverX(z)) < 20 || inCut(-25, PORTALS.roadW, PORTALS.roadE, 9)) continue;
    const h = hf.heightAt(x, z);
    if (hf.normalAt(x, z, nrm).y < 0.75) continue;
    trees.push({ x, y: h - 0.25, z, s: lerp(16, 30, rng()), sx: 0.7 + rng() * 0.2, r: rng() * 6.28, tilt: (rng() - 0.5) * 0.04, c: treeColor(rng) });
  }
  // sakura: the town's namesake — a blossom promenade along both river banks and an avenue up the shrine approach
  const riverTrees = [], LB = new LGeo(96), bankClear = z => Math.abs(z + 25) > 13 && Math.abs(z - 200) > 9 && Math.abs(z + 80) > 15;
  const flatTown = (x, z) => { const g = hf.groundAt(x, z); return g > Y0 - 0.5 && g < Y0 + 1.6; };
  for (let z = -520, n = 0; z < 520; z += 8 + srng() * 2.5, n++) {
    if (!bankClear(z)) continue;
    const rx = riverX(z), xe = rx + 21.2 + (srng() - 0.5) * 1.2, xw = rx - 26 + (srng() - 0.5) * 0.8;
    if (flatTown(xe, z)) riverTrees.push({ x: xe, y: hf.groundAt(xe, z) - 0.2, z, s: lerp(7.5, 10, srng()), sx: 1, r: srng() * 6.28, c: sakuraColor(srng) });
    if (flatTown(xw, z) && !occRect(xw, z, 1.3, 1.3, 0, 0, true)) riverTrees.push({ x: xw, y: hf.groundAt(xw, z) - 0.2, z, s: lerp(7, 9.5, srng()), sx: 1, r: srng() * 6.28, c: sakuraColor(srng) });
    // benches facing the water between the trees on the east promenade
    if (n % 5 === 2 && Math.abs(z) < 360 && bankClear(z + 4)) { const bx = riverX(z + 4) + 16.4; bench(LB, bx, Y0 + 0.12, z + 4, -Math.PI / 2); }
  }
  // gravel promenade on the east bank
  hf.paint2(0, 150, -760, 280, 760, (x, z) => { const d = Math.abs(x - riverX(z)); return d > 14 && d < 18.6 ? 1 : 0; });
  for (let z = -284; z < -228; z += 9) for (const sd of [-1, 1]) {
    const x = SHRINE.x + sd * (6.2 + srng() * 0.6), zz = z + (srng() - 0.5) * 1.5;
    if (!occRect(x, zz, 1.0, 1.0, 0, 0, true)) riverTrees.push({ x, y: hf.groundAt(x, zz) - 0.2, z: zz, s: lerp(7, 9, srng()), sx: 1, r: srng() * 6.28, c: sakuraColor(srng) });
    if ((z + 284) % 18 === 0 && z + 4 < -230) lantern(LB, SHRINE.x + sd * 2.8, hf.groundAt(SHRINE.x + sd * 2.8, z + 4) - 0.05, z + 4, 0);
  }
  for (let i = trees.length - 1; i >= 0; i--) if (riverTrees.some(t => Math.hypot(t.x - trees[i].x, t.z - trees[i].z) < 6)) trees.splice(i, 1);
  for (const t of riverTrees) sakura.push(t);
  for (const t of schoolSak) { const h = hf.groundAt(t.x, t.z); sakura.push({ x: t.x, y: h - 0.2, z: t.z, s: lerp(7, 9, srng()), sx: 1, r: srng() * 6.28, c: sakuraColor(srng) }); }
  for (const t of riverTrees) for (let k = 0; k < 2; k++) if (srng() < 0.55) { // bushes and hydrangeas at the tree feet
    const a = srng() * 6.28, d = 1.6 + srng() * 1.6, x = t.x + Math.cos(a) * d, z = t.z + Math.sin(a) * d, rd = x - riverX(z);
    if (rd > -23.8 && rd < 20.2 || Math.abs(x - SHRINE.x) < 4.5 || Math.abs(rd) > 24 && (occRect(x, z, 0.5, 0.5, 0, 0, true) || inPaddyZone(x, z)) || !bankClear(z)) continue;
    const hy = srng() < 0.55;
    (hy ? hydras : bushes).push({ x, y: hf.groundAt(x, z) - 0.1, z, s: 0.9 + srng() * 0.6, sx: 0.9 + srng() * 0.3, r: srng() * 6.28, c: hy ? hydraColor(srng) : bushColor(srng) });
  }
  hf.paintCanopy([...trees, ...riverTrees]);
  hf.uploadHeight(); hf.uploadMasks();
  progress('Building terrain', 0.76); await tick();
  const firstNatural = scene.children.length;
  await buildTerrainMeshes(hf, terrainMaterial(hf, layers, { water: 0, snow: 900, conifer: 0.72 }));
  buildForest(trees);
  buildSakura(sakura.filter(t => !t.garden));
  for (let i = firstNatural; i < scene.children.length; i++) reflected.add(scene.children[i]);
  const grass = buildGrass(hf, layers.grass.d, { water: 0, snow: 900 });
  const water = buildWater(hf, { level: 0, normals: loadTex('tex/waternormals.jpg', false, NFLAT), hide: [grass], waves: 6, strength: 0.3, deep: '#1d5a78', mid: '#2e8f9a', shallow: '#5cc4b0',
    active: c => Math.abs(c.x - riverX(c.z)) < 380 });
  reflected.add(water);

  // flush all static geometry
  progress('Merging geometry', 0.82); await tick();
  B.flush(MT, { paint: false, glassLit: false, glass: true, window: false, shopWindow: false, paddyWater: false, lamp: false, chain: false, poly: false });
  Bx.flush(MT, { paint: false });
  const landmarks = flushLandmarks(LB);

  // ---------------------------------------------------------------- scanned props (gardens, shops)
  const [shrub, potted, planter, crate, ubox, weed, manhole] = await modelsP;
  const prng = mulberry32(99);
  const scatterModel = (model, items, byHeight, dist, shadow = true, split = false) => {
    if (!model || !items.length) return;
    const parts = extractParts(model);
    if (!split) { normalizeParts(parts, byHeight); new Scatter(items, [{ dist, parts: parts.map(p => ({ ...p, castShadow: shadow })) }], 64); return; }
    // asset sheets with several plants side by side: every plant becomes its own instanced model
    parts.forEach((p, i) => { normalizeParts([p], byHeight); const mine = items.filter((_, k) => k % parts.length === i); if (mine.length) new Scatter(mine, [{ dist, parts: [{ ...p, castShadow: shadow }] }], 64); });
  };
  const shrubs = [], pots = [], weeds = [], crates = [], boxes = [];
  for (const lot of lots) {
    const c = Math.cos(lot.r), s = Math.sin(lot.r), W = (lx, lz) => [lot.x + lx * c + lz * s, lot.z - lx * s + lz * c];
    if (!lot.shop) {
      for (let k = 0; k < 3; k++) if (prng() < 0.7) { const [x, z] = W((prng() - 0.5) * (lot.w - 2), -lot.d / 2 + 0.8 + prng() * 1.2); (k === 1 ? shrubs : bushes).push({ x, y: hf.groundAt(x, z) - 0.1, z, s: 0.9 + prng() * 0.6, sx: 0.9 + prng() * 0.3, r: prng() * 6.28, c: bushColor(prng) }); }
      if (prng() < 0.6 && !lot.sakura) { const [x, z] = W(lot.w / 2 - 0.8, -lot.d / 2 + 0.9); shrubs.push({ x, y: hf.groundAt(x, z), z, s: 1.2 + prng() * 1.0, r: prng() * 6.28 }); }
      for (let k = 0; k < 3; k++) if (prng() < 0.5 && !lot.sakura && !lot.niwaki) { const [x, z] = W(-lot.w / 2 + 2.6 + prng() * 2.4, lot.d / 2 - 1.1 - prng() * 2); pots.push({ x, y: hf.groundAt(x, z), z, s: 0.35 + prng() * 0.25, r: prng() * 6.28 }); }
    } else if (prng() < 0.4) { const [x, z] = W(lot.w / 2 - 1.2, Math.min(lot.d, 12) / 2 + 0.5); crates.push({ x, y: hf.groundAt(x, z), z, s: 0.45, r: lot.r + (prng() - 0.5) * 0.3 }); if (prng() < 0.5) crates.push({ x, y: hf.groundAt(x, z) + 0.3, z, s: 0.45, r: lot.r + (prng() - 0.5) * 0.3 }); }
    for (let k = 0; k < 4; k++) if (prng() < 0.25) { const [x, z] = W((prng() - 0.5) * lot.w, lot.d / 2 - 0.15); weeds.push({ x, y: hf.groundAt(x, z), z, s: 0.25 + prng() * 0.3, r: prng() * 6.28 }); }
    if (prng() < 0.05) { const [x, z] = W(lot.w / 2 - 0.5, lot.d / 2 + 0.4); boxes.push({ x, y: hf.groundAt(x, z), z, s: 1.3, r: lot.r }); addCircle(x, z, 0.4); }
  }
  scatterModel(shrub, shrubs, true, () => Q.props, true, true);
  buildBushes(bushes, 'bush');
  buildBushes(hydras, 'hydra');
  buildSakura(sakura.filter(t => t.garden));
  // green trees: park shade trees, clipped garden trees, and a row along the main road's sidewalks outside the shops
  const greenTrees = [...gardenTrees];
  for (const t of parkTrees) greenTrees.push({ x: t.x, y: hf.groundAt(t.x, t.z) - 0.2, z: t.z, s: lerp(8, 11, drng()), sx: 1, r: drng() * 6.28, c: leafColor(drng) });
  buildBroadleafForest([...greenTrees, ...streetTrees]);
  bicycles(bikeList, drng);
  scatterModel(potted, pots, true, () => Q.props * 0.35);
  scatterModel(weed, weeds, true, () => Q.props * 0.3, false, true);
  scatterModel(crate, crates, true, () => Q.props * 0.4);
  scatterModel(ubox, boxes, true, () => Q.props * 0.6);
  // manholes in roads
  const holes = [];
  for (const R of ROADS) if (R.kind !== 'path') for (const [a, b] of roadSegs(R)) { const L = Math.hypot(b[0] - a[0], b[1] - a[1]); for (let t = 20; t < L; t += 45 + prng() * 30) { const x = lerp(a[0], b[0], t / L), z = lerp(a[1], b[1], t / L); if (Math.abs(x) < 700 && Math.abs(z) < 350 && !onRail(z) && !onBridge(x, z)) holes.push({ x, y: roadY(x, z) - 0.01, z, s: 0.7, r: prng() * 6.28 }); } }
  scatterModel(manhole, holes, false, () => Q.props * 0.5, false);

  // ---------------------------------------------------------------- vehicles
  progress('Starting traffic', 0.9); await tick();
  const crng = mulberry32(7);
  const parked = carSpots.filter(() => crng() < 0.85).map(sp => ({ sp, spec: randomCar(crng, false) }));
  // taxis waiting at the station
  for (let i = 0; i < 3; i++) parked.push({ sp: { p: [RAIL.stationX + 30 - i * 5.2, Y0 + 0.14, -41], r: -Math.PI / 2 }, spec: { type: 'taxi', color: [0.08, 0.1, 0.2] } });
  // routes (closed loops; driving on the left)
  const loops = [
    { pts: [[-400, -25], [110, -25], [110, -225], [-400, -225]], n: 5, v: 11 },
    { pts: [[-400, -225], [110, -225], [110, -25], [-400, -25]], n: 4, v: 11 },
    { pts: [[-150, -25], [110, -25], [110, 258], [-150, 258]], n: 4, v: 10 },
    { pts: [[-150, 258], [110, 258], [110, -25], [-150, -25]], n: 3, v: 10 },
    { pts: [[-400, 48], [-30, 48], [-30, 188], [-400, 188]], n: 2, v: 8 },
    { pts: [[-1050, -25], [1050, -25]], n: 4, v: 14, open: true },
    { pts: [[1050, -25], [-1050, -25]], n: 4, v: 14, open: true },
  ];
  const routes = loops.map(L => new Route(L.pts, { closed: !L.open, vmax: L.v, lane: L.v > 12 ? 1.75 : L.v > 9 ? 1.5 : 1.05 }));
  // mandatory stops: every stop line we painted that lies on the route with matching heading
  const tmp = {};
  routes.forEach(R => {
    for (let s = 0; s < R.len; s += 1) {
      R.at(s, tmp);
      for (const st of stopSpots) {
        if (Math.hypot(tmp.x - st.x, tmp.z - st.z) < 2.2 && tmp.dx * st.hx + tmp.dz * st.hz > 0.8 && !R.stops.some(q => Math.abs(q.s - s) < 6)) {
          const cr = Math.abs(st.z + 80) < 10 ? crossings.reduce((b, c) => Math.abs(c.x - st.x) < Math.abs(b.x - st.x) ? c : b) : null;
          R.stops.push({ s, crossing: cr });
        }
      }
    }
    R.stops.sort((a, b) => a.s - b.s);
  });
  const moving = [];
  loops.forEach((L, i) => { for (let k = 0; k < L.n; k++) moving.push({ route: routes[i], s: routes[i].len * (k + crng() * 0.5) / L.n, spec: randomCar(crng) }); });
  const fleet = new Fleet([...parked.map(p => p.spec), ...moving.map(m => m.spec)]);
  parked.forEach((p, i) => { const car = fleet.cars[i]; fleet.place(car, p.sp.p[0], hf.groundAt(p.sp.p[0], p.sp.p[2]) + (p.sp.p[1] > Y0 + 0.1 ? 0.14 : 0), p.sp.p[2], p.sp.r + Math.PI / 2, 0, 0, 0); const T = carDims(car.type); addBox(p.sp.p[0], p.sp.p[2], T.L / 2, T.W / 2, p.sp.r + Math.PI / 2, -1e9, Y0 + 1.6); });
  const traffic = new Traffic(fleet, (x, z) => roadY(x, z) - 0.05 + 0.01);
  moving.forEach((m, i) => traffic.add(fleet.cars[parked.length + i], m.route, m.s));
  fleet.commit();
  // trains
  const trains = [new Train(Y0), new Train(Y0)];
  trains[0].start(1, 2); trains[1].start(-1, 40);

  // town geometry, props, vehicles are not reflected by the river (keeps the reflection pass cheap)
  for (const o of scene.children) if (!reflected.has(o)) o.traverse(c => c.layers.set(1));

  // ---------------------------------------------------------------- night lighting: a few real point lights follow the nearest fixtures
  const plights = [];
  for (let i = 0; i < 6; i++) { const l = new THREE.PointLight(0xffd9a8, 0, 22, 2); scene.add(l); plights.push(l); }
  let lightTimer = 0;

  // people on the streets: sidewalks of the main road, lane shoulders, the riverside walkways and the shrine approach
  const walkPaths = [];
  for (const R of ROADS) {
    if (R.id === 'F') continue;
    const pts = R.pts.map(([x, z]) => [clamp(x, -440, 440), clamp(z, -335, 335)]);
    walkPaths.push({ pts, off: R.kind === 'path' ? 1.0 : R.w / 2 + (R.walk ? R.walk / 2 : 0.55), lift: R.walk ? (x, z) => onBridge(x, z) ? 0 : 0.15 : null, w: R.id === 'A' ? 3 : 1 });
  }
  for (const sd of [-1, 1]) for (const [z0, z1] of [[-330, -94], [-66, 330]]) walkPaths.push({ pts: Array.from({ length: 13 }, (_, i) => { const z = lerp(z0, z1, i / 12); return [riverX(z) + sd * 16.1, z]; }), off: 0, lift: null });
  const people = pedestrians(walkPaths.flatMap(P => Array(P.w || 1).fill(P)), (x, z) => world.groundAt(x, z), 260);
  const spawn = { x: 107.9, z: -42, yaw: 0.12, pitch: 0.04 }; // edge of road B, looking at the level crossing
  const _n = new THREE.Vector3();
  const world = {
    hf, grass, water, spawn, trains, traffic, crossings, sakura,
    bounds: { minX: -990, maxX: 990, minZ: -990, maxZ: 990 },
    groundAt(x, z) {
      const g = hf.groundAt(x, z); if (onBridge(x, z) && (Math.abs(z + 25) < 7 || Math.abs(z - 200) < 3.5)) return Math.max(g, Y0 + 0.35);
      const rd = Math.abs(x - riverX(z)); return rd > 14.55 && rd < 17.65 && Math.abs(z + 78) > 8 ? Math.max(g, Y0 + 0.12) : g; // bank-top walkway
    },
    normalAt: (x, z, out) => hf.normalAt(x, z, out),
    waterAt: (x, z) => Math.abs(x - riverX(z)) < 15 ? 0 : -1e9,
    surfaceAt(x, z, y) {
      if (y !== undefined && y > Y0 + 0.9 && Math.abs(z + 80) < 8) return 'asphalt';
      if (Math.abs(z + 80) < 5.6 && y < Y0 + 0.6) return 'gravel';
      const g = hf.groundAt(x, z);
      if (Math.abs(x - riverX(z)) < 14.5) return g < 0.2 ? 'water' : 'gravel';
      if (inPaddyZone(x, z) && paddyOK(x, z) && paddyCell(x, z) > 1.2) return 'water';
      const m2 = hf.mask2[hf.idx(x, z) * 4 + 2], ur = hf.mask2[hf.idx(x, z) * 4];
      if (m2 > 128) return 'asphalt';
      if (ur > 128) return 'gravel';
      return FOREST[hf.idx(x, z)] > 0.4 ? 'forest' : 'grass';
    },
    ambience(x, z) {
      const rd = Math.abs(x - riverX(z));
      return { forest: FOREST[hf.idx(clamp(x, -HALF, HALF), clamp(z, -HALF, HALF))], water: rd < 40 ? (1 - rd / 40) * 0.6 : 0, town: Math.abs(x) < 450 && Math.abs(z) < 330 ? 1 : 0.3, insects: 0.9 };
    },
    collide(p) { traffic.collide(p); people.collide(p); for (const tr of trains) { const sp = tr.span(); if (!sp) continue; const tz = RAIL.z[tr.track]; if (p.x > sp[0] - 0.4 && p.x < sp[1] + 0.4 && Math.abs(p.z - tz) < 1.9 && p.y < tr.y + 3.5) p.z = tz + Math.sign(p.z - tz || 1) * 1.9; } },
    update(dt, t, cam) {
      updateNight(); updateGlow(); landmarks.update(); people.update(dt);
      const pl = { x: cam.position.x, y: cam.position.y - 1.6, z: cam.position.z };
      for (const tr of trains) tr.update(dt, pl);
      for (const c of crossings) c.active = crossingActive(c, trains);
      updateCrossings(dt, t);
      traffic.update(dt, pl, night.value > 0.35);
      fleet.commit();
      lightTimer -= dt;
      if (lightTimer < 0) {
        lightTimer = 0.5;
        const on = night.value > 0.25;
        const near = on ? lampPoints.map(l => ({ l, d: Math.hypot(l.p[0] - cam.position.x, l.p[2] - cam.position.z) })).sort((a, b) => a.d - b.d).slice(0, plights.length) : [];
        plights.forEach((L, i) => { const n = near[i]; if (n && n.d < 90) { L.position.set(n.l.p[0], n.l.p[1] - 0.2, n.l.p[2]); L.userData.target = 18 * n.l.s * night.value; } else L.userData.target = 0; });
      }
      for (const L of plights) L.intensity = lerp(L.intensity, L.userData.target || 0, 1 - Math.exp(-dt * 4));
    },
  };
  people.update(0);
  return world;
}
