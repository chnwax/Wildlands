// The town dressed with the owned model packs (packs.js), once everything else stands: what each kind of place is
// missing next to what the generators already built there —
//   vending machines   the recycling bin that stands beside every one (自販機横の回収ボックス)
//   shops              by trade: the florist's pots and planters spilling onto the pavement, a café table, stools
//                      outside the noodle bars, the cycle shop's bikes for sale, a liquor store's cartons; boxes by the
//                      side wall of the others
//   konbini            the bins at its door, cartons by the side, cones in its car park
//   station            litter bins and planters on the forecourt
//   apartment estate   residents' potted plants and scooters by the stair entrances
//   playground park    litter bins at its entrances
//   valley road        speed signs where the town begins and ends, roadside honesty stands by the fields
//   farmland           crates, bins and barrows at the tunnel-greenhouse rows; sheds, straw and sacks at the paddy edges
// Every piece is placed on free ground only: off roads (and off footways unless the piece belongs at a shopfront), clear
// of every collider (buildings, walls, fences, vending machines), of every instanced object already standing (trees,
// bushes, bikes, pots, crates), of parked cars' bays and of the river and the railway. Each sector draws from an rng of
// its own seeded by place, so the dressing is the same on every run and moves nothing the generators placed.
import { mulberry32, collide, scatters, props, addBox, addCircle } from './core.js';
import { queuePack, packQueue, packsReady } from './packs.js';
import { SHOP_NAMES } from './townkit.js';

const TAU = Math.PI * 2;

// ctx: { RN, gy(x, z), lots, lotW, carSpots, danchi, kb (konbini), PK (park), riverX, onRail, greenhouses, PADDIES,
//        inPaddyZone, roadA: { x0, x1, z, w, walk } }
export function dressTown(ctx) {
  const P = packsReady(); if (!P) return null;
  const { RN, gy } = ctx, stats = {};
  // ---------------------------------------------------------------- what already stands: a 4 m grid of discs
  const G = new Map(), key = (i, j) => i * 100003 + j;
  const addDisc = (x, z, r) => { const i0 = Math.floor((x - r) / 4), i1 = Math.floor((x + r) / 4), j0 = Math.floor((z - r) / 4), j1 = Math.floor((z + r) / 4);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = key(i, j); if (!G.has(k)) G.set(k, []); G.get(k).push(x, z, r); } };
  for (const sc of scatters) {
    const g = sc.lods && sc.lods[0] && sc.lods[0].parts[0] && sc.lods[0].parts[0].geometry; if (!g) continue;
    if (!g.boundingSphere) g.computeBoundingSphere();
    const bb = g.boundingBox || (g.computeBoundingBox(), g.boundingBox), base = Math.min(3, Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * 0.5);
    for (let i = 0; i < sc.items.length; i++) { const it = sc.items[i]; addDisc(it.x, it.z, Math.max(0.15, base * sc.scale[i] * 0.85)); }
  }
  for (const it of props.items) { const m = it.parts[0] && it.parts[0].matrix; if (m) addDisc(m.elements[12], m.elements[14], 0.7); }
  for (const [id, items] of packQueue) { const d = P.dims(id) || [1, 1, 1], r = Math.max(0.15, Math.max(d[0], d[2]) * 0.5); for (const it of items) addDisc(it.x, it.z, r * (it.s || 1)); }
  for (const sp of ctx.carSpots || []) addDisc(sp.p[0], sp.p[2], 2.7);
  const discFree = (x, z, r) => { const i0 = Math.floor((x - r) / 4), i1 = Math.floor((x + r) / 4), j0 = Math.floor((z - r) / 4), j1 = Math.floor((z + r) / 4);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const a = G.get(key(i, j)); if (!a) continue;
      for (let k = 0; k < a.length; k += 3) if (Math.hypot(a[k] - x, a[k + 1] - z) < a[k + 2] + r) return false; }
    return true; };
  const probe = { x: 0, y: 0, z: 0 };
  // free ground for a piece of radius r at (x, z): walk: it may stand on a footway (a shopfront, a vending machine)
  const clear = (x, z, r, { walk = false, low = false } = {}) => {
    for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) { const px = x + dx, pz = z + dz;
      if (RN.roadAt(px, pz)) return false; if (!walk && RN.walkY(px, pz) !== null) return false; }
    if (ctx.riverX && Math.abs(x - ctx.riverX(z)) < 19) return false;
    if (ctx.onRail && ctx.onRail(z)) return false;
    if (!discFree(x, z, r)) return false;
    probe.x = x; probe.z = z; probe.y = groundY(x, z); collide(probe, r, low ? 0.9 : 1.6);
    return Math.hypot(probe.x - x, probe.z - z) < 1e-3;
  };
  const groundY = (x, z) => { const w = RN.walkY(x, z); return w !== null ? w : gy(x, z); };
  const put = (id, x, z, r, o = {}, rad = null) => {
    const y = (o.y ?? groundY(x, z)) + (o.dy || 0); const q = { ...o }; delete q.y; delete q.dy;
    if (!queuePack(id, x, y, z, r, q)) return false;
    const d = P.dims(id) || [1, 1, 1]; addDisc(x, z, rad ?? Math.max(0.15, Math.max(d[0], d[2]) * 0.5 * (o.s || 1)));
    stats[id] = (stats[id] || 0) + 1; return true;
  };
  // a frame at (x0, z0) turned by r: local (u, v) -> world (local +v is the frame's facing)
  const frame = (x0, z0, r) => { const c = Math.cos(r), s = Math.sin(r); return (u, v) => [x0 + u * c + v * s, z0 - u * s + v * c]; };
  const POTS = ['jp_flowerpot_01', 'jp_flowerpot_02', 'jp_flowerpot_03', 'jp_flowerpot_04', 'jp_flowerpot_05', 'jp_flowerpot_06', 'jp_flowerpot_07', 'jp_flowerpot_08', 'jp_flowerpot_09', 'jp_flowerpot_010'];
  const BOXES = ['farm_box_potato', 'farm_box_onion', 'farm_box_carrot', 'farm_box_cucumber', 'farm_box_eggplant'];
  const seed = (x, z, k) => mulberry32(((Math.floor(x * 13.7) * 92821) ^ (Math.floor(z * 31.3) * 68917) ^ k) >>> 0 || 1);

  // ---------------------------------------------------------------- vending machines: the recycling bin beside each group
  {
    const vm = props.items.filter(it => (it.kind === 'vendingMachine' || /^pack:jp_vendingmachine/.test(it.kind)) && it.parts[0]).map(it => { const e = it.parts[0].matrix.elements; return { x: e[12], z: e[14], yaw: Math.atan2(e[8], e[10]) }; });
    const done = [];
    for (const v of vm) {
      if (done.some(d => Math.hypot(d[0] - v.x, d[1] - v.z) < 2.6)) continue;
      const F = frame(v.x, v.z, v.yaw);
      for (const u of [1.0, -1.0, 2.1, -2.1, 3.2, -3.2]) { const [x, z] = F(u, 0.02); if (!clear(x, z, 0.3, { walk: true })) continue;
        put('jp_trash_recycling', x, z, v.yaw); addCircle(x, z, 0.3); done.push([x, z]); break; }
    }
  }

  // ---------------------------------------------------------------- shops, by trade
  for (const lot of ctx.lots) {
    if (!lot.shop) continue;
    const rng = seed(lot.x, lot.z, 0x5109), sfz = Math.min(lot.d, 12) / 2, trade = Math.floor(mulberry32(Math.floor(lot.x * 131 + lot.z * 71) | 0)() * SHOP_NAMES.length);
    const W = (u, v) => ctx.lotW(lot, u, v), hw = lot.w / 2, face = lot.r;
    // along the shopfront, within ~0.9 m of the glass, never across the middle (the door)
    const front = (u, v, r = 0.3) => { const [x, z] = W(u, sfz + v); return clear(x, z, r, { walk: true }) ? [x, z] : null; };
    const row = (n, v, pick, rad = 0.28) => { let k = 0; for (let u = -hw + 0.6; u < hw - 0.5 && k < n; u += 0.55 + rng() * 0.2) { if (Math.abs(u) < 1.0) continue; const q = front(u, v, rad); if (q) { pick(q, k); k++; } } return k; };
    if (trade === 14) { // florist: pots in two ranks along the window, planters at the ends
      row(10, 0.38, ([x, z]) => put(POTS[Math.floor(rng() * POTS.length)], x, z, rng() * TAU, { s: 0.75 + rng() * 0.35 }));
      row(6, 0.95, ([x, z]) => put(POTS[Math.floor(rng() * POTS.length)], x, z, rng() * TAU, { s: 0.7 + rng() * 0.3 }));
      for (const u of [-hw + 0.7, hw - 0.7]) { const q = front(u, 0.45, 0.45); if (q) put(rng() < 0.5 ? 'jp_plants_box_03' : 'jp_plants_box_01', q[0], q[1], face); }
    } else if (trade === 7 || trade === 11 || trade === 6) { // café, bakery, sweets: a small table with two chairs, a planter
      const u = (rng() < 0.5 ? -1 : 1) * (hw - 1.1), q = front(u, 0.75, 0.65);
      if (q && lot.w > 6) { put('jp_table_01', q[0], q[1], face, { s: 0.75 }); const F = frame(q[0], q[1], face); for (const sd of [-1, 1]) { const [cx, cz] = F(sd * 0.62, 0); put('jp_chair', cx, cz, face + sd * Math.PI / 2, {}, 0.22); } addCircle(q[0], q[1], 0.45); }
      const p = front(-u * 0.9, 0.4, 0.35); if (p) put('jp_plants_box_02', p[0], p[1], face);
    } else if (trade === 0 || trade === 12 || trade === 16 || trade === 3) { // noodle bars, sushi, izakaya: stools for the queue, cartons
      row(2 + Math.floor(rng() * 2), 0.42, ([x, z]) => put(rng() < 0.5 ? 'jp_stool_01' : 'jp_stool_02', x, z, rng() * TAU, {}, 0.22));
    } else if (trade === 15) { // cycle shop: bikes for sale in a row, a stand
      const n = row(4, 0.7, ([x, z]) => put('jp_bicycle', x, z, face + Math.PI / 2 + (rng() - 0.5) * 0.1, {}, 0.3), 0.3);
      if (n) { const q = front(hw - 0.55, 0.5, 0.35); if (q) put('jp_bikestand', q[0], q[1], face + Math.PI / 2); }
    } else if (trade === 8) { // liquor store: crates and cartons of bottles by the door
      row(3, 0.45, ([x, z], k) => { put(k % 2 ? 'jp_carton_03' : 'jp_carton_01', x, z, face + (rng() - 0.5) * 0.3); if (rng() < 0.5) put('jp_carton_03', x, z, face + (rng() - 0.5) * 0.5, { dy: 0.44 }); }, 0.4);
    } else if (rng() < 0.45) { // the others: a pot or two by the door
      row(1 + Math.floor(rng() * 2), 0.35, ([x, z]) => put(POTS[Math.floor(rng() * POTS.length)], x, z, rng() * TAU, { s: 0.8 + rng() * 0.25 }));
    }
    // deliveries waiting by the side or back wall (cartons, a crate)
    if (rng() < 0.4) for (const [u, v] of [[hw - 0.45, -sfz + 0.6], [-hw + 0.45, -sfz + 0.6], [hw + 0.5, 0], [-hw - 0.5, 0]]) {
      const [x, z] = W(u, v); if (!clear(x, z, 0.5)) continue;
      put('jp_carton_02', x, z, face + (rng() - 0.5) * 0.4); if (rng() < 0.6) put('jp_carton_01', x, z, face + (rng() - 0.5) * 0.6, { dy: 0.45 }); addCircle(x, z, 0.5); break;
    }
  }

  // ---------------------------------------------------------------- the konbini: bins at the door, cartons by the side, cones
  if (ctx.kb) {
    const { x: kx, z: kz, r, w, d } = ctx.kb, F = frame(kx, kz, r), rng = seed(kx, kz, 0xb1);
    for (const u of [-3.2, -2.5, 3.2]) { const [x, z] = F(u, d / 2 + 0.55); if (clear(x, z, 0.32, { walk: true })) { put(u < 0 ? 'jp_trash_recycling' : 'jp_trash_can_01', x, z, r); addCircle(x, z, 0.3); } }
    for (const u of [w / 2 + 0.6, -w / 2 - 0.6]) { const [x, z] = F(u, -d / 2 + 1.5); if (!clear(x, z, 0.6)) continue; put('jp_carton_02', x, z, r + (rng() - 0.5) * 0.3); put('jp_carton_01', x, z, r + (rng() - 0.5) * 0.5, { dy: 0.45 }); put('jp_carton_03', ...F(u, -d / 2 + 2.4), r); addCircle(x, z, 0.6); break; }
    for (let k = 0; k < 6; k++) { const [x, z] = F(-w / 2 + 2 + rng() * (w - 4), d / 2 + 4 + rng() * 10); if (!clear(x, z, 0.3)) continue; put('jp_traffic_pylon', x, z, rng() * TAU); if ((stats.jp_traffic_pylon || 0) >= 2) break; }
  }

  // ---------------------------------------------------------------- the station forecourt: litter bins and planters
  if (ctx.station) {
    const S = ctx.station, rng = seed(S.x0, S.z0, 0x57a);
    let bins = 0, boxes = 0;
    for (let k = 0; k < 600 && (bins < 3 || boxes < 4); k++) { // (in a band along the square's edges, off the walking lines)
      const x = S.x0 + rng() * (S.x1 - S.x0), z = S.z0 + rng() * (S.z1 - S.z0);
      if (Math.min(x - S.x0, S.x1 - x, z - S.z0, S.z1 - z) > 2.6 || (S.avoid && S.avoid(x, z)) || !clear(x, z, 0.6, { walk: true })) continue;
      if (bins < 3 && rng() < 0.5) { put('jp_trash_can_01', x, z, rng() * TAU); addCircle(x, z, 0.35); bins++; }
      else if (boxes < 4) { put('jp_plants_box_03', x, z, Math.round(rng() * 4) * Math.PI / 2); addBox(x, z, 0.6, 0.34, 0); boxes++; }
    }
  }

  // ---------------------------------------------------------------- the apartment estate: plants and scooters at the stairs
  if (ctx.danchi && ctx.danchi.buildings) for (const b of ctx.danchi.buildings) for (const e of b.entrances || []) {
    if (!e.out || !e.p || e.kind === 'shop') continue;
    const rng = seed(e.p[0], e.p[2], 0xda), yaw = Math.atan2(e.out[0], e.out[1]), F = frame(e.p[0], e.p[2], yaw);
    if (rng() < 0.45) { const pot = POTS[Math.floor(rng() * POTS.length)]; for (const sd of [-1, 1]) for (let k = 0; k < (rng() < 0.5 ? 2 : 1); k++) {
      const [x, z] = F(sd * (1.25 + k * 0.45), 0.35 + k * 0.1); if (clear(x, z, 0.22, { walk: true })) put(k ? POTS[Math.floor(rng() * POTS.length)] : pot, x, z, rng() * TAU, { s: 0.75 + rng() * 0.3 }); } }
    if (rng() < 0.25) for (const sd of [1, -1]) { const [x, z] = F(sd * 2.6, 1.0); if (!clear(x, z, 0.55, { walk: true })) continue; const a = yaw + Math.PI / 2 * sd + (rng() - 0.5) * 0.2; put('jp_mofa_vehicle', x, z, a, {}, 1.0); addBox(x, z, 1.0, 0.4, a); break; }
    if (rng() < 0.15) { const [x, z] = F(-1.9, 0.6); if (clear(x, z, 0.45, { walk: true })) put(rng() < 0.5 ? 'jp_plants_box_01' : 'jp_plants_box_02', x, z, yaw); }
  }

  // ---------------------------------------------------------------- the playground park: litter bins by its entrances
  if (ctx.PK) {
    const { x: px, z: pz, w, d } = ctx.PK, rng = seed(px, pz, 0x9a);
    let n = 0;
    for (const [u, v] of [[0, d / 2 - 2.2], [2.2, d / 2 - 2.2], [-w / 2 + 2, 0], [w / 2 - 2, 0], [0, -d / 2 + 2]]) { const x = px + u, z = pz - v; if (!clear(x, z, 0.4)) continue; put('jp_trash_can_01', x, z, rng() * TAU); addCircle(x, z, 0.35); if (++n >= 2) break; }
  }

  // ---------------------------------------------------------------- pocket parks: a litter bin by the bench, a planter
  for (const pk of ctx.parks || []) {
    const rng = seed(pk.x, pk.z, 0x9b);
    const a = Math.atan2(pk.bench[1] - pk.z, pk.bench[0] - pk.x);
    for (const da of [0.5, -0.5, 0.9, -0.9]) { const x = pk.x + Math.cos(a + da) * 3.4, z = pk.z + Math.sin(a + da) * 3.4; if (!clear(x, z, 0.4)) continue; put('jp_trash_can_01', x, z, rng() * TAU); addCircle(x, z, 0.35); break; }
    if (rng() < 0.5) for (let k = 0; k < 8; k++) { const b = rng() * TAU, x = pk.x + Math.cos(b) * (pk.R - 2), z = pk.z + Math.sin(b) * (pk.R - 2); if (!clear(x, z, 0.7)) continue; put('jp_plants_box_03', x, z, b + Math.PI / 2); addBox(x, z, 0.6, 0.34, b + Math.PI / 2); break; }
  }

  // ---------------------------------------------------------------- the valley road: speed signs at the town's ends, stands
  if (ctx.roadA) {
    const { z: az, w, walk, ends, stands } = ctx.roadA, off = w / 2 + (walk || 0) + 0.45;
    for (const [x, dir, id] of ends) { // dir: +1 eastbound (the driver's left is -z); id: the sign (005 limit 50, 013 limit 30)
      const z = az - dir * off; if (!clear(x, z, 0.15, { walk: true })) continue;
      if (put(id, x, z, dir > 0 ? -Math.PI / 2 : Math.PI / 2)) addCircle(x, z, 0.06);
    }
    for (const [x, sd] of stands) { // honesty stands on the verge by the fields, their front to the road
      const rng = seed(x, sd, 0x57d), z = az + sd * (off + 2.6), face = sd > 0 ? Math.PI : 0;
      if (!clear(x, z, 1.7)) continue;
      const y = groundY(x, z); put('farm_produce_stand', x, z, face, { s: 0.85 }); addBox(x, z, 1.3, 1.3, face, y - 1, y + 2.8);
      const F = frame(x, z, face);
      ['farm_box_potato', 'farm_box_cucumber', 'farm_box_eggplant'].forEach((id, i) => { const [bx, bz] = F((i - 1) * 0.78, 0.55); put(id, bx, bz, face + (rng() - 0.5) * 0.1, { y: y + 0.74, s: 0.85 }); });
      { const [sx, sz] = F(1.75, 1.1); put('farm_sign_veges', sx, sz, face + 0.2, { dy: 0.0 }); }
      { const [bx, bz] = F(-1.8, 0.8); put(POTS[Math.floor(rng() * POTS.length)], bx, bz, rng() * TAU); }
    }
  }

  // ---------------------------------------------------------------- farmland: the tunnel greenhouses' working ends
  for (const g of ctx.greenhouses || []) {
    const rng = seed(g.x, g.z, 0x6e1); if (rng() > 0.55) continue;
    const F = frame(g.x, g.z, g.r); // local +v toward the lane: the open doors
    const kit = [['farm_plastic_bin', 0.4], ['farm_crate', 0.45], ['farm_wheelbarrow_metal', 1.0], ['farm_plastic_bin', 0.4], ['farm_watering_can', 0.3]];
    let n = 0;
    for (let k = 0; k < 8 && n < 3; k++) { const [id, r] = kit[Math.floor(rng() * kit.length)], [x, z] = F(-g.w / 2 + 0.8 + rng() * (g.w - 1.6), g.d / 2 + 0.55);
      if (!clear(x, z, r)) continue; put(id, x, z, g.r + (rng() - 0.5) * 0.8); addCircle(x, z, Math.min(r, 0.45)); n++; }
  }

  // ---------------------------------------------------------------- paddy edges: a storage shelter, straw, sacks, a barrow
  for (const [x0, z0, x1, z1] of ctx.PADDIES || []) {
    const rng = seed(x0, z0, 0x9add); let sheds = 0;
    for (let k = 0; k < 160 && sheds < 2; k++) {
      const side = Math.floor(rng() * 4), t = 0.1 + rng() * 0.8;
      const x = side === 0 ? x0 - 4 : side === 1 ? x1 + 4 : x0 + (x1 - x0) * t, z = side === 2 ? z0 - 4 : side === 3 ? z1 + 4 : z0 + (z1 - z0) * t;
      const face = side === 0 ? -Math.PI / 2 : side === 1 ? Math.PI / 2 : side === 2 ? Math.PI : 0; // open side away from the paddies
      if (ctx.inPaddyZone(x, z) || !clear(x, z, 3.2) || Math.abs(gy(x - 2, z) - gy(x + 2, z)) > 0.5 || Math.abs(gy(x, z - 2) - gy(x, z + 2)) > 0.5) continue;
      const F = frame(x, z, face);
      put('farm_shelter', x, z, face, {}, 3.0); { const [bx, bz] = F(0, -1.65); addBox(bx, bz, 2.5, 0.2, face); }
      for (const [u, k2] of [[-1.3, 0], [0.1, 1]]) { const [bx, bz] = F(u, -0.5); put('farm_straw_bale', bx, bz, face + Math.PI / 2, { s: 0.62 }); if (k2 === 0) put('farm_straw_bale', bx, bz, face + Math.PI / 2, { s: 0.62, dy: 0.58 }); }
      { const [bx, bz] = F(1.6, 0.2); for (let j = 0; j < 2; j++) put('farm_grain_bag', bx, bz, face + (rng() - 0.5) * 0.3, { dy: j * 0.3 }); }
      if (rng() < 0.6) { const [bx, bz] = F(2.9, 1.2); if (clear(bx, bz, 1.0)) put('farm_wheelbarrow', bx, bz, face + rng() * TAU); }
      sheds++;
    }
  }
  return stats;
}
