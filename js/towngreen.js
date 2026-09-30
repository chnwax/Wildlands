// Sakuragawa's greenery: the town belongs to its valley. Gardens get clipped pines, maples, blossom trees and slim
// cypresses in front and a big old tree leaning over the roof at the back; hedges line the lots without walls; ivy
// climbs some block walls; potted plants crowd the gates; weeds grow at the wall feet. Leftover land inside the blocks
// carries groves, pocket parks, persimmon orchards and bamboo; the station plaza has zelkovas in planters; the shrine
// has its sacred camphor. Out on the valley floor, tree lines follow the paddy edges and the main road, farm groves
// stand in the fields, and the satoyama woods at the foot of the hills lead up into the cedar forest.
import { THREE, clamp, lerp, smoothstep, mulberry32, fbm, addBox } from './core.js';
import { makeTree, TreeHash, bambooGrove, bambooCulm } from './ecology.js';
import { broadColor, bushColor, hydraColor } from './trees.js';

const pickW = (w, r) => { let tot = 0; for (const k in w) tot += w[k]; let a = r * tot; for (const k in w) { a -= w[k]; if (a <= 0) return k; } return Object.keys(w)[0]; };

// ctx: { hf, free(x, z, r) -> no lot / road / river / rail within r, lots, lotW, riverX, inPaddyZone, SHRINE, Y0, PADDIES,
//        isShop(x, z) -> commercial frontage, B (GeoBuilder for planters), LB + bench (pocket-park benches), stationX }
export function plantTown(ctx) {
  const { hf, free, lots, lotW, riverX, inPaddyZone, SHRINE, Y0, PADDIES, isShop } = ctx;
  const rng = mulberry32(8123), hash = ctx.hash || new TreeHash(10);
  const out = { trees: [], bushes: [], hydras: [], hedges: [], ivy: [], pots: [], weeds: [], groves: [] };
  const gy = (x, z) => hf.groundAt(x, z);
  const flat = (x, z) => { const g = gy(x, z); return g > Y0 - 0.6 && g < Y0 + 1.4; };
  // leafier and plainer neighbourhoods (km-scale noise), commercial frontage stays sparse
  const leafy = (x, z) => smoothstep(-0.35, 0.35, fbm(x * 0.006 + 2.3, z * 0.006 - 5.1, 2)) * (isShop(x, z) ? 0.2 : 1);
  const add = (t, k = 0.5) => { if (!hash.fits(t.x, t.z, t.cr, k, 0.9)) return false; hash.add(t); out.trees.push(t); return true; };
  const tree = (kind, x, z, o = {}) => makeTree(kind, x, gy(x, z) - 0.15, z, rng, o);
  // bamboo is always planted as a group: a garden clump (a few culms in a tight patch) or a grove (bambooGrove). Culms
  // keep clear of other trees' trunks and of anything built; the grove is recorded for its leaf-litter floor
  const nv = new THREE.Vector3(), gentle = (x, z) => hf.normalAt(x, z, nv).y > 0.86 && gy(x, z) > Y0 - 0.6;
  const culmOK = (x, z, pad = 1.0, slope = false) => free(x, z, Math.ceil(pad)) && (slope ? gentle(x, z) : flat(x, z)) && hash.fits(x, z, 0.5, 0.45, 0.6);
  const grove = (x, z, R, o = {}) => {
    const list = bambooGrove({ x, z, R, rng, groundAt: gy, ok: (px, pz) => culmOK(px, pz, o.pad ?? 1.2, o.slope) && (!o.ok || o.ok(px, pz)), sp: o.sp ?? 1.55, H: o.H ?? [10, 14], edgeH: o.edgeH ?? [4, 7] });
    // a stand that came out patchy (built land, slopes and other trees took too much of it) is not planted at all: bamboo
    // is either a proper grove or nothing, never a scatter of culms
    const expect = Math.PI * R * R * 0.62 / ((o.sp ?? 1.55) ** 2);
    if (list.length < (o.min ?? 12) || list.length < expect * 0.42) return 0;
    for (const t of list) { t.town = true; hash.add(t); out.trees.push(t); }
    out.groves.push({ x, z, R: R * 1.25, n: list.length });
    return list.length;
  };
  const clump = (x, z, R, n, H) => { // a garden clump: n culms in a patch R across, the middle ones tallest
    const tone = broadColor(rng, 'bamboo', rng(), rng()); let k = 0;
    for (let i = 0; i < n * 3 && k < n; i++) { const a = rng() * 6.28, d = Math.sqrt(rng()) * R, px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      if (!hash.fits(px, pz, 0.3, 0.4, 0.3)) continue;                                        // (inside its own garden)
      const t = bambooCulm(px, gy(px, pz), pz, rng, lerp(H[1], H[0], d / R) * (0.85 + rng() * 0.25), tone, d / R); t.town = true; t.cr = 0.4; hash.add(t); out.trees.push(t); k++; }
    return k;
  };
  const hedgeLine = (ax, az, bx, bz, h = 1, dark = 0.66) => {
    const col = bushColor(rng).multiplyScalar(dark); // one clipped hedge, one colour
    const L = Math.hypot(bx - ax, bz - az); if (L < 0.8) return;
    const n = Math.max(1, Math.round(L / 1.0)), yaw = Math.atan2(-(bz - az), bx - ax), step = L / n;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n, x = lerp(ax, bx, t), z = lerp(az, bz, t), s = h * (0.94 + rng() * 0.12);
      out.hedges.push({ x, y: gy(x, z) - 0.05, z, s, sx: step / 1.04 * 1.3 / s, sz: 1, r: yaw, c: col.clone().multiplyScalar(0.97 + rng() * 0.06) });
    }
    const cx = (ax + bx) / 2, cz = (az + bz) / 2, g = gy(cx, cz);
    addBox(cx, cz, L / 2, 0.3, yaw, g - 1, g + h * 0.9);
  };

  // designed bamboo stands the map asks for, planted first so they stand whole (behind the shrine, along the river beyond the town, at the town's edges)
  for (const g of ctx.bambooSites || []) grove(g.x, g.z, g.R, { H: g.H || [11, 15], edgeH: g.edgeH || [4.5, 7.5], sp: g.sp || 1.6, min: 10, pad: 0.6, slope: true });

  // ---------------------------------------------------------------- gardens
  for (const lot of lots) {
    if (lot.shop || !lot.info) continue;
    const I = lot.info, LW = lot.w, LD = lot.d, L = leafy(lot.x, lot.z), W = (lx, lz) => lotW(lot, lx, lz);
    const fz0 = I.hz + I.D / 2 + 0.7, fz1 = LD / 2 - 0.75, gx0 = -LW / 2 + 0.9, gx1 = I.gate[0] - 0.6;
    // the front garden: a clipped pine, a maple (some red-leaved), a blossom tree, a dark evergreen or a slim cypress
    if (gx1 - gx0 > 1.0 && fz1 - fz0 > 0.6 && rng() < 0.5 + 0.45 * L) {
      const kind = pickW({ jpine: 0.24, maple: 0.24, sakura: 0.14, leaf: 0.2, tall: 0.12 }, rng());
      const lx = lerp(gx0 + 0.3, Math.min(gx1, gx0 + 2.6), rng()), lz = lerp(fz0 + 0.3, fz1, rng()), [x, z] = W(lx, lz);
      const t = tree(kind, x, z, { scale: { jpine: 1, maple: 0.72, sakura: 0.72, leaf: 0.42, tall: 0.28 }[kind], red: 0.3 });
      if (kind === 'tall') { t.sx *= 0.7; t.cr *= 0.7; }
      if (kind === 'leaf') t.c = broadColor(rng, 'camphor', 0.5, 0.35);
      if (add(t, 0.4)) lot.frontTree = true; else if (rng() < 0.7) for (let k = 0; k < 2; k++) { const [hx, hz] = W(-LW / 2 + 0.9 + k * 1.2, LD / 2 - 0.9); out.hydras.push({ x: hx, y: gy(hx, hz) - 0.05, z: hz, s: 0.9 + rng() * 0.4, sx: 0.9 + rng() * 0.3, r: rng() * 6.28, c: hydraColor(rng) }); }
    } else if (rng() < 0.65) for (let k = 0; k < 2; k++) { const [hx, hz] = W(-LW / 2 + 0.9 + k * 1.2, LD / 2 - 0.9); out.hydras.push({ x: hx, y: gy(hx, hz) - 0.05, z: hz, s: 0.9 + rng() * 0.4, sx: 0.9 + rng() * 0.3, r: rng() * 6.28, c: hydraColor(rng) }); }
    // the back garden: an old tree taller than the house, crown over the roof (away from the storage shed)
    if (rng() < 0.15 + 0.42 * L) {
      const side = I.shedSide ? -I.shedSide : rng() < 0.5 ? -1 : 1, [x, z] = W(side * (LW / 2 - 0.85), -LD / 2 + 0.55);
      const kind = pickW({ oak: 0.3, zelkova: 0.18, leaf: 0.26, tall: 0.16, bamboo: 0.1 }, rng());
      if (kind === 'bamboo') { // a clump of garden bamboo in the back corner, taller than the eaves
        const [bx, bz] = W(side * (LW / 2 - 1.5), -LD / 2 + 1.3);
        if (clump(bx, bz, 1.3, 7 + Math.floor(rng() * 6), [4.5, 8]) > 3) lot.backSide = side;
      } else {
        const t = tree(kind, x, z, { scale: { oak: 0.72, zelkova: 0.75, leaf: 0.85, tall: 0.42 }[kind], a: 0.4 + rng() * 0.6 });
        if (kind === 'oak') t.c = broadColor(rng, 'camphor', 0.5, 0.45);
        if (add(t, 0.35)) lot.backSide = side;
      }
    }
    // a second small tree or a shrub group beside the house in the leafiest streets
    if (L > 0.55 && rng() < 0.35) {
      const gap = LW / 2 - (I.hx + I.W / 2); if (gap > 1.6) { const [x, z] = W(LW / 2 - gap / 2, I.hz - I.D * 0.2); add(tree(rng() < 0.5 ? 'maple' : 'leaf', x, z, { scale: 0.45, red: 0.3 }), 0.3); }
    }
    // hedges: lots without a wall are hedged along the front (and often the sides); some walled lots have a hedge
    // behind the wall
    const hedgeFront = !I.hasWall || rng() < 0.22 * L;
    // (behind a wall the hedge stands clear of it by its own half depth, so no leaves poke through to the street)
    if (hedgeFront) { const h = I.hasWall ? I.wallH + 0.35 : 1.0 + rng() * 0.3, lz = I.hasWall ? LD / 2 - 0.25 - 0.36 * h : LD / 2 - 0.45;
      const [ax, az] = W(-LW / 2 + 0.2 + 0.36 * h, lz), [bx, bz] = W(I.gate[0] - 0.25, lz); hedgeLine(ax, az, bx, bz, h); }
    if (!I.hasWall && rng() < 0.6) for (const sd of [-1, 1]) {
      const zEnd = sd > 0 ? LD / 2 - 5.8 : LD / 2 - 0.8, [ax, az] = W(sd * (LW / 2 - 0.5), -LD / 2 + 0.5), [bx, bz] = W(sd * (LW / 2 - 0.5), zEnd);
      hedgeLine(ax, az, bx, bz, 1.0 + rng() * 0.4);
    }
    // ivy on the street face of the wall
    if (I.hasWall && rng() < 0.13 + 0.12 * L) {
      const lx = lerp(-LW / 2 + 1.2, I.gate[0] - 1.2, rng()), [x, z] = W(lx, LD / 2 + 0.04);
      out.ivy.push({ x, y: gy(x, z) - 0.05, z, s: I.wallH * (1.02 + rng() * 0.1), sx: (1.6 + rng() * 1.4) / I.wallH, sz: 0.8, r: lot.r, c: bushColor(rng).multiplyScalar(0.5 + rng() * 0.12) });
    }
    // a row of potted plants by the gate
    if (rng() < 0.38) { const n = 2 + Math.floor(rng() * 4);
      for (let k = 0; k < n; k++) { const [x, z] = W(I.gate[0] - 0.45 - k * 0.5, LD / 2 - 0.42); out.pots.push({ x, y: gy(x, z), z, s: 0.32 + rng() * 0.25, r: rng() * 6.28 }); } }
    // weeds at the foot of the wall, by the gutter
    if (rng() < 0.45) for (let k = 0, n = 1 + Math.floor(rng() * 3); k < n; k++) { const [x, z] = W(lerp(-LW / 2 + 0.3, LW / 2 - 0.3, rng()), LD / 2 + 0.16); out.weeds.push({ x, y: gy(x, z), z, s: 0.18 + rng() * 0.25, r: rng() * 6.28 }); }
  }
  // shopfronts: planters and pots by the doors
  for (const lot of lots) if (lot.shop && rng() < 0.4) { const fz = Math.min(lot.d, 12) / 2 + 0.35;
    for (let k = 0, n = 2 + Math.floor(rng() * 3); k < n; k++) { const [x, z] = lotW(lot, lot.w / 2 - 0.5 - k * 0.55, fz); out.pots.push({ x, y: gy(x, z), z, s: 0.38 + rng() * 0.3, r: rng() * 6.28 }); } }

  // ---------------------------------------------------------------- the land between the lots
  // Free ground inside the town blocks becomes groves around old houses (yashikirin), pocket parks, persimmon orchards
  // and bamboo patches; never on the commercial street.
  const cand = [];
  for (let z = -338; z < 338; z += 5) for (let x = -455; x < 205; x += 5) {
    const px = x + (rng() - 0.5) * 3, pz = z + (rng() - 0.5) * 3;
    if (inPaddyZone(px, pz) || Math.abs(px - riverX(pz)) < 30 || Math.abs(pz + 80) < 15 || !flat(px, pz) || isShop(px, pz) || !free(px, pz, 3.2)) continue;
    cand.push([px, pz]);
  }
  for (let i = cand.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)), t = cand[i]; cand[i] = cand[j]; cand[j] = t; }
  const groves = [];
  for (const [cx, cz] of cand) {
    const L = leafy(cx, cz); if (rng() > 0.25 + 0.6 * L || groves.some(g => Math.hypot(g.x - cx, g.z - cz) < 40)) continue;
    const type = pickW({ grove: 0.45, park: 0.2, orchard: 0.2, bamboo: 0.15 }, rng()), R = type === 'park' ? 12 : 7 + rng() * 7;
    groves.push({ x: cx, z: cz, type });
    const near = cand.filter(([x, z]) => Math.hypot(x - cx, z - cz) < R);
    if (type === 'bamboo') { grove(cx, cz, 7 + rng() * 6, { H: [9, 13], edgeH: [3.5, 6.5], min: 16 }); continue; }  // a bamboo grove, nothing else in it
    if (type === 'orchard') { // persimmons in loose rows
      const a = rng() * Math.PI;
      for (let i = -2; i <= 2; i++) for (let j = -1; j <= 1; j++) {
        const x = cx + Math.cos(a) * i * 5 - Math.sin(a) * j * 5, z = cz + Math.sin(a) * i * 5 + Math.cos(a) * j * 5;
        if (!free(x, z, 2) || !flat(x, z)) continue;
        const t = tree('leaf', x, z, { scale: 0.42, a: rng() }); t.c = broadColor(rng, 'oak', 0.7, 0.55); add(t, 0.35);
      }
      continue;
    }
    for (const [x, z] of near) {
      if (rng() > (type === 'park' ? 0.45 : 0.7)) continue;
      const kind = type === 'park' ? pickW({ zelkova: 0.4, sakura: 0.25, leaf: 0.2, maple: 0.15 }, rng())
        : pickW({ oak: 0.28, zelkova: 0.14, leaf: 0.24, tall: 0.24, maple: 0.1 }, rng());
      const t = tree(kind, x, z, { scale: { tall: 0.55, oak: 0.85 }[kind] || 1, red: 0.25 });
      if (kind === 'oak' && rng() < 0.5) t.c = broadColor(rng, 'camphor', 0.5, 0.45);
      add(t, 0.6);
    }
    // an understorey of shrubs and hydrangeas round the edge
    for (let k = 0; k < 6; k++) {
      const a = rng() * 6.28, d = R * (0.6 + rng() * 0.5), x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      if (!free(x, z, 1) || !flat(x, z)) continue;
      (rng() < 0.3 ? out.hydras : out.bushes).push({ x, y: gy(x, z) - 0.1, z, s: 0.9 + rng() * 0.8, sx: 0.9 + rng() * 0.3, r: rng() * 6.28, c: rng() < 0.3 ? hydraColor(rng) : bushColor(rng) });
    }
    if (type === 'park' && ctx.bench) { const a = rng() * 6.28, x = cx + Math.cos(a) * 3, z = cz + Math.sin(a) * 3; if (free(x, z, 1.2)) ctx.bench(ctx.LB, x, gy(x, z), z, a + Math.PI / 2); }
  }

  // ---------------------------------------------------------------- station plaza, shrine, parking edges
  if (ctx.B) {
    const sx = ctx.stationX ?? -8;
    // flower troughs on the station square
    for (const [x, z] of [[-11.5, -32.4], [-15.5, -32.4], [-26.5, -52], [-21.5, -52]]) {
      ctx.B.frame(x, Y0 + 0.22, z, 0); ctx.B.bbox('concrete', 0, 0, 0, 2.6, 0.5, 0.9, 0.03, { color: [0.8, 0.8, 0.78] }); ctx.B.box('plain', 0, 0.42, 0, 2.4, 0.06, 0.7, { color: [0.3, 0.23, 0.17] });
      addBox(x, z, 1.3, 0.45, 0, Y0 - 1, Y0 + 0.75);
      for (let k = 0; k < 4; k++) out.hydras.push({ x: x - 0.9 + k * 0.6, y: Y0 + 0.64, z: z + (rng() - 0.5) * 0.2, s: 0.42 + rng() * 0.14, sx: 1, r: rng() * 6.28, c: rng() < 0.5 ? hydraColor(rng) : bushColor(rng) });
    }
    ctx.B.frame(0, 0, 0, 0);
    // cherries and shrubs in the raised bed on the loop's island (its soil sits 0.56 above the town datum)
    for (const [x, z] of [[17.9, -47.6], [17.9, -41.2]]) {
      const t = tree('sakura', x, z, { scale: 0.62, a: 0.5 }); t.y = Y0 + 0.5; add(t, 0.2);
      for (let k = 0; k < 4; k++) out.bushes.push({ x: x + (rng() - 0.5) * 3.2, y: Y0 + 0.52, z: z + (rng() - 0.5) * 4.4, s: 0.5 + rng() * 0.3, sx: 1, r: rng() * 6.28, c: rng() < 0.4 ? hydraColor(rng) : bushColor(rng) });
    }
    for (const [x, z] of [[sx - 23, -34.6], [sx - 12, -34.6], [sx - 23, -47], [sx + 1, -34.6]]) {
      const t = tree('zelkova', x, z, { scale: 0.7, a: 0.6 }); t.y = Y0 + 0.14; add(t, 0.2);
      ctx.B.frame(x, Y0 + 0.14, z, 0); ctx.B.box('concrete', 0, 0, 0, 1.9, 0.42, 1.9, { color: [0.78, 0.78, 0.76] }); ctx.B.box('plain', 0, 0.3, 0, 1.6, 0.14, 1.6, { color: [0.34, 0.26, 0.2] });
      addBox(x, z, 0.95, 0.95, 0, Y0 - 1, Y0 + 0.56);
      for (let k = 0; k < 3; k++) out.bushes.push({ x: x + (rng() - 0.5) * 1.1, y: Y0 + 0.5, z: z + (rng() - 0.5) * 1.1, s: 0.55 + rng() * 0.25, sx: 1, r: rng() * 6.28, c: bushColor(rng) });
    }
  }
  if (SHRINE) {
    const t1 = tree('oak', SHRINE.x + 10.5, SHRINE.z - 21, { scale: 1.45, a: 1 }); t1.c = broadColor(rng, 'camphor', 0.45, 0.4); add(t1, 0.1); // the sacred camphor
    const t2 = makeTree('old', SHRINE.x - 12, gy(SHRINE.x - 12, SHRINE.z - 28) - 0.2, SHRINE.z - 28, rng, { scale: 1.05, a: 1 }); add(t2, 0.1);
    for (const [dx, dz] of [[-9, -8], [9.5, -9], [-10, -17]]) { const t = tree('maple', SHRINE.x + dx, SHRINE.z + dz, { scale: 0.85, red: 0.7 }); add(t, 0.3); }
    for (const [dx, dz] of [[-5.5, 2.5], [5.5, 2.5]]) add(tree('jpine', SHRINE.x + dx, SHRINE.z + dz, { scale: 1.1 }), 0.2);
  }
  // the konbini car park: shrubs along its sides and a tree at each back corner
  hedgeLine(115.5, -17, 115.5, -1.5, 0.9, 0.7); hedgeLine(152.5, -17, 152.5, -1.5, 0.9, 0.7);
  for (const x of [117, 151]) add(tree('zelkova', x, 1.5, { scale: 0.65 }), 0.2);

  // ---------------------------------------------------------------- the valley floor: city -> suburb -> fields -> hills
  // tree lines along the paddy edges (with gaps), street trees continuing along the main road out of town, and farm
  // groves standing in the fields
  for (const [x0, z0, x1, z1] of PADDIES) {
    const edges = [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]];
    for (const [ax, az, bx, bz] of edges) {
      const L = Math.hypot(bx - ax, bz - az), nx = -(bz - az) / L, nz = (bx - ax) / L;
      for (let d = 6; d < L - 6; d += 9 + rng() * 14) {
        if (fbm((ax + bx) * 0.01 + d * 0.03, (az + bz) * 0.01, 2) < -0.1) { d += 20; continue; } // gaps
        const off = 2.5 + rng() * 2.5, x = lerp(ax, bx, d / L) - nx * off, z = lerp(az, bz, d / L) - nz * off; // just outside the fields
        if (inPaddyZone(x, z) || !free(x, z, 1.8) || Math.abs(x - riverX(z)) < 28) continue;
        if (rng() < 0.05) { const o = 5 + rng() * 3; if (grove(x - nx * o, z - nz * o, 6 + rng() * 4, { H: [9, 13], ok: (px, pz) => !inPaddyZone(px, pz), min: 14 })) { d += 18; continue; } }
        const kind = pickW({ leaf: 0.38, oak: 0.22, zelkova: 0.17, sakura: 0.11, tall: 0.12 }, rng());
        add(tree(kind, x, z, { scale: kind === 'tall' ? 0.6 : 0.9 }), 0.55);
      }
    }
  }
  for (let x = -640; x <= 640; x += 22 + rng() * 10) {
    if (Math.abs(x) < 440 || Math.abs(x - riverX(-25)) < 32 || rng() < 0.25) continue;
    const sd = rng() < 0.5 ? -1 : 1, z = -25 + sd * (7.5 + rng() * 2);
    if (!free(x, z, 1.0)) continue;
    add(tree(rng() < 0.35 ? 'sakura' : 'zelkova', x, z, { scale: 0.85 }), 0.5);
  }
  for (let k = 0, placed = 0; k < 4000 && placed < 11; k++) { // farm groves (yashikirin) out in the fields
    const cx = (rng() * 2 - 1) * 900, cz = (rng() * 2 - 1) * 520;
    if (Math.abs(cx) < 470 && Math.abs(cz) < 350 || inPaddyZone(cx, cz) || !flat(cx, cz) || !free(cx, cz, 8) || Math.abs(cx - riverX(cz)) < 40) continue;
    placed++;
    // a farm grove: cedars and broadleaves round the old homestead, and on its sheltered side a bamboo stand
    if (rng() < 0.7) { const a = rng() * 6.28, d = 14 + rng() * 6; grove(cx + Math.cos(a) * d, cz + Math.sin(a) * d, 8 + rng() * 6, { H: [10.5, 14.5], ok: (px, pz) => !inPaddyZone(px, pz), min: 20 }); }
    for (let m = 0; m < 12; m++) {
      const a = rng() * 6.28, d = Math.sqrt(rng()) * 13, x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      if (!free(x, z, 1.5) || inPaddyZone(x, z)) continue;
      const kind = pickW({ tall: 0.42, oak: 0.3, leaf: 0.2, sakura: 0.08 }, rng());
      add(tree(kind, x, z, { scale: kind === 'tall' ? 0.7 : 1 }), 0.55);
    }
  }
  return out;
}
