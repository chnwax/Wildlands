// A working farmstead (農家) behind a run of field plots, dressed with the owned model packs (packs.js; nothing is
// added when the libraries are not built):
//   作業場  the working yard: a gravel pad at the end of the plots' earth path, an open machinery shelter with straw
//           bales and a sorting table, firewood, harvest boxes stacked on pallets, sacks, a wheelbarrow, tools leaning
//           on the shelter, a barrel and a watering can
//   果樹園  an orchard beside it: blocks of peach, nashi pear and ume plum in rows on the grass, a few young trees
//           filling gaps, a wire fence against boar and deer with a gate toward the yard, beehives in a corner and a
//           row of sunflowers along the path
//   無人販売所  an unmanned honesty stand by the farm lane with the day's boxes on its shelf
// The plots themselves get the pack crops through field({ packs: true }) (building.js). Every piece is placed on free,
// level ground only (the town's occupancy grid, roads and footways), and claims its ground so later planting keeps off.
import { mulberry32, addBox, addCircle } from './core.js';
import { queuePack, packsReady } from './packs.js';

const TAU = Math.PI * 2;

// ctx: { hf, occRect, gy, RN, footpath, blocked(x, z): ground kept for later planting (bamboo stands) }   o: { plots: [{ x, z, w, d, gapX }], dir (+1: the plots run toward +z),
// seed, trees: orchard species (model ids, in blocks of three columns), stand: [[x, z, face], ...] candidate spots for
// the honesty stand }
export function farmstead(ctx, o) {
  const P = packsReady(); if (!P || !o.plots.length) return null;
  const { hf, occRect, gy, RN } = ctx, rng = mulberry32(o.seed || 7), rr = (a, b) => a + rng() * (b - a);
  const out = { pieces: 0 };
  const put = (id, x, z, r = 0, opt = {}) => { const y = (opt.y ?? gy(x, z)) + (opt.dy || 0); delete opt.y; delete opt.dy; if (queuePack(id, x, y, z, r, opt)) out.pieces++; return y; };
  const clear = (x0, z0, x1, z1) => { for (let z = z0; z <= z1; z += 1) for (let x = x0; x <= x1; x += 1) {
    if (RN.roadAt(x, z) || RN.walkY(x, z) !== null || (ctx.blocked && ctx.blocked(x, z))) return false; } return !occRect((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (z1 - z0) / 2, 0, 0, true); };
  const level = (x0, z0, x1, z1, tol) => { const hs = []; for (let z = z0; z <= z1 + 1e-6; z += (z1 - z0) / 3) for (let x = x0; x <= x1 + 1e-6; x += (x1 - x0) / 3) hs.push(gy(x, z)); return Math.max(...hs) - Math.min(...hs) < tol; };
  const sg = o.dir; // the side away from the lane
  const zBack = Math.max(...o.plots.map(p => sg > 0 ? p.z + p.d / 2 : -(p.z - p.d / 2))) * sg;
  const zz = (a, b) => [Math.min(zBack + sg * a, zBack + sg * b), Math.max(zBack + sg * a, zBack + sg * b)]; // a band behind the plots

  // ---------------------------------------------------------------- planning: the orchard takes the longest free stretch
  // of the band behind the plots, as deep as the land allows (18 m, else 14 or 11 m before the woods or the bamboo), up
  // to 40 m long — unless the yard then finds no room beside it: the orchard gives way (26, then 16 m), the yard first
  const xs = o.plots.map(p => p.x - p.w / 2), xe = o.plots.map(p => p.x + p.w / 2), lim0 = Math.min(...xs), lim1 = Math.max(...xe);
  const planOrchard = Lmax => {
    for (const depth of [18, 14, 11]) {
      const [a0, a1] = zz(2.2, 2.2 + depth), segs = []; let s0 = null;
      for (let x = lim0; x <= lim1 + 1; x += 1) {
        const ok = x <= lim1 && clear(x - 0.5, a0, x + 0.5, a1) && level(x - 0.5, a0, x + 0.5, a1, 0.8);
        if (ok && s0 === null) s0 = x; if (!ok && s0 !== null) { segs.push([s0, x - 1]); s0 = null; }
      }
      segs.sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]));
      const seg = segs[0]; if (!seg || seg[1] - seg[0] < (depth > 12 ? 16 : 20)) continue;
      // at the end of the stretch toward the middle of the plots (the yard then fits on its other side)
      const mid0 = (lim0 + lim1) / 2, L = Math.min(Lmax, seg[1] - seg[0]), x0 = Math.abs(seg[0] - mid0) < Math.abs(seg[1] - mid0) ? seg[0] : seg[1] - L;
      return { x0, x1: x0 + L, L, OD: depth, oz0: a0, oz1: a1 };
    }
    return null;
  };
  const YW = 11, YD = 8.5, [yz0, yz1] = zz(2.2, 2.2 + YD);
  const findYard = orch => {
    const mid = orch ? (orch.x0 + orch.x1) / 2 : o.plots.reduce((s2, p) => s2 + p.x, 0) / o.plots.length;
    const gaps = o.plots.map(p => p.gapX).filter(Boolean).sort((p, q) => Math.abs(p - mid) - Math.abs(q - mid));
    const offOrch = cx => !orch || cx + YW / 2 < orch.x0 - 2.5 || cx - YW / 2 > orch.x1 + 2.5;
    for (const gx of gaps) for (const off of [0, -3, 3, -5, 5]) {
      const cx = gx + off; if (offOrch(cx) && clear(cx - YW / 2 - 0.5, yz0 - 0.5, cx + YW / 2 + 0.5, yz1 + 0.5) && level(cx - YW / 2, yz0, cx + YW / 2, yz1, 0.6)) return { cx, gx };
    }
    return null;
  };
  let orch = null, yard = null;
  for (const Lmax of [40, 26, 16, 0]) { orch = Lmax ? planOrchard(Lmax) : null; yard = findYard(orch); if (yard) break; }
  if (!yard) orch = planOrchard(40);

  // ---------------------------------------------------------------- the working yard, at the end of a plot path
  if (yard) {
    const { cx } = yard, cz = (yz0 + yz1) / 2, back = sg > 0 ? yz1 : yz0, front = sg > 0 ? yz0 : yz1, face = sg > 0 ? Math.PI : 0; // shelter opens toward the plots
    occRect(cx, cz, YW / 2 + 0.3, YD / 2 + 0.3, 0, 1);
    hf.paint2(0, cx - YW / 2 - 1, yz0 - 1, cx + YW / 2 + 1, yz1 + 1, (x, z) => Math.abs(x - cx) < YW / 2 && Math.abs(z - cz) < YD / 2 ? 0.85 : 0);
    hf.paint2(2, cx - YW / 2 - 1, yz0 - 1, cx + YW / 2 + 1, yz1 + 1, (x, z) => Math.abs(x - cx) < YW / 2 - 0.4 && Math.abs(z - cz) < YD / 2 - 0.4 ? 1 : 0);
    if (ctx.footpath) ctx.footpath(yard.gx, zBack + sg * 0.2, yard.gx, front);
    // yard frame: u along x from its centre, v from its front edge (toward the plots) to the back
    const W = (u, v) => [cx + u, front + sg * v];
    // open machinery shelter along the back, two small straw bales under its roof
    const [sx, sz] = W(-2.5, YD - 1.9);
    put('farm_shelter', sx, sz, face);
    { const [bx, bz] = W(-2.5, YD - 0.15); addBox(bx, bz, 2.5, 0.15, 0); for (const pu of [-4.85, -0.15]) { const [px, pz] = W(pu, YD - 3.55); addCircle(px, pz, 0.12); } }
    for (const [k, pu] of [[0, -3.7], [1, -1.3]]) { const [bx, bz] = W(pu, YD - 1.0), y = put('farm_straw_bale', bx, bz, rr(-0.06, 0.06) + Math.PI / 2, { s: 0.62 });
      if (k === 0 && rng() < 0.75) put('farm_straw_bale', bx, bz, rr(-0.1, 0.1) + Math.PI / 2, { s: 0.62, y: y + 0.58 }); addBox(bx, bz, 0.45, 0.62, 0, y - 1, y + 1.2); }
    // tools leaning on the shelter's open corner post
    { const [tx, tz] = W(-0.45, YD - 3.35); ['farm_hoe', 'farm_rake', 'farm_spade'].forEach((id, i) => put(id, tx - i * 0.17, tz + sg * 0.04 * i, face + rr(-0.15, 0.15), { tilt: -sg * 0.24, tilt2: rr(-0.05, 0.05) })); }
    // sacks of fertiliser beside the shelter, firewood in the back corner, the sorting table with two boxes on it
    for (let k = 0; k < 3; k++) { const [gx, gz] = W(-5.05 + (k === 2 ? 0.1 : 0), YD - 1.4 - k * 0.75); put(k < 2 ? 'farm_grain_bag' : 'farm_grain_bag_open', gx, gz, Math.PI / 2 + rr(-0.25, 0.25)); }
    { const [wx, wz] = W(4.3, YD - 0.9); put('farm_wood_stack', wx, wz, rr(-0.04, 0.04)); addBox(wx, wz, 1.0, 0.6, 0); }
    { const [tbx, tbz] = W(1.3, YD - 2.3); const y = put('farm_table', tbx, tbz, Math.PI / 2 + rr(-0.04, 0.04)); addBox(tbx, tbz, 1.25, 0.62, 0, y - 1, y + 1);
      ['farm_box_potato', 'farm_box_onion'].forEach((id, i) => put(id, tbx - 0.55 + i * 1.1, tbz, rr(-0.1, 0.1), { y: y + 0.86, s: 0.9 })); }
    // the day's harvest on pallets by the entrance, two high; a wooden crate
    const boxes = ['farm_box_potato', 'farm_box_onion', 'farm_box_carrot', 'farm_box_cucumber', 'farm_box_eggplant'];
    for (let k = 0; k < 4; k++) { const [bx, bz] = W(3.2 + (k % 2) * 0.82, 1.2 + Math.floor(k / 2) * 0.52), y = gy(bx, bz);
      put(boxes[(k + Math.floor(rng() * 5)) % 5], bx, bz, rr(-0.06, 0.06), { y }); if (rng() < 0.6) put(boxes[Math.floor(rng() * 5)], bx, bz, rr(-0.08, 0.08), { y: y + 0.42 }); }
    { const [bx, bz] = W(3.6, 1.45); addBox(bx, bz, 0.85, 0.55, 0, gy(bx, bz) - 1, gy(bx, bz) + 0.95); }
    { const [kx, kz] = W(4.7, 3.0); put('farm_crate', kx, kz, rr(-0.2, 0.2)); addBox(kx, kz, 0.42, 0.42, 0); }
    // wheelbarrow left in the middle; a barrel with a bucket, a watering can and a bin by the west edge
    { const [wx, wz] = W(rr(-0.8, 0.4), rr(2.8, 3.8)), wr = rr(0, TAU); put(rng() < 0.5 ? 'farm_wheelbarrow_metal' : 'farm_wheelbarrow', wx, wz, wr); addBox(wx, wz, 0.35, 0.95, wr); }
    { const [bx, bz] = W(-4.6, 1.2); put('farm_barrel', bx, bz, rr(0, TAU), { s: 0.8 }); addCircle(bx, bz, 0.38);
      const [ux, uz] = W(-3.9, 1.0), [vx, vz] = W(-4.0, 1.75), [qx, qz] = W(-3.2, 1.3);
      put('farm_bucket', ux, uz, rr(0, TAU)); put('farm_watering_can', vx, vz, rr(0, TAU)); put('farm_plastic_bin', qx, qz, rr(-0.3, 0.3)); }
    // a broom against the shelter's back wall, a planter of herbs by the entrance
    { const [bx, bz] = W(-4.7, YD - 0.45); put('jp_broom_stick', bx, bz, face + 0.3, { tilt: sg * 0.2 }); }
    { const [px, pz] = W(-2.0, 0.55); put(rng() < 0.5 ? 'jp_plants_box_1' : 'jp_plants_box_2', px, pz, rr(-0.1, 0.1) + face); }
    out.yard = { x: cx, z: cz };
  }

  // ---------------------------------------------------------------- the orchard beside the yard
  if (orch) {
    const { OD, oz0, oz1 } = orch;
    {
      const { x0, x1, L } = orch, cx = (x0 + x1) / 2, cz = (oz0 + oz1) / 2;
      occRect(cx, cz, L / 2 + 0.3, OD / 2 + 0.3, 0, 1);
      // fence: 5 m wire panels on wooden posts round the block; the gate gap faces the yard
      const gateX = yard ? (yard.cx < cx ? x0 : x1) : x0, gateZ = cz;
      const run = (ax, az, bx, bz) => { const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / 5)), r = Math.atan2(-(bz - az), bx - ax);
        const gk = ax === gateX && bx === gateX ? Math.min(n - 1, Math.max(0, Math.floor((gateZ - az) / (bz - az) * n))) : -1; // (the gate: one panel left out)
        for (let k = 0; k < n; k++) { const t0 = k / n, t1 = (k + 1) / n, mx = ax + (bx - ax) * (t0 + t1) / 2, mz = az + (bz - az) * (t0 + t1) / 2;
          if (k === gk) continue;
          put('farm_fence_wire', mx, mz, r, { sx: len / n / 5 }); addBox(mx, mz, len / n / 2, 0.06, r); }
        for (let k = 0; k <= n; k++) { const px = ax + (bx - ax) * k / n, pz = az + (bz - az) * k / n; put('farm_fence_wire_pole', px, pz, rr(0, TAU), { s: 0.75, dy: -0.1 }); } };
      run(x0, oz0, x1, oz0); run(x0, oz1, x1, oz1); run(x0, oz0, x0, oz1); run(x1, oz0, x1, oz1);
      // trees in rows along x, species in blocks of three columns, young trees here and there in the gaps
      const sp = 5.2, sz = 5.6, nx = Math.max(1, Math.floor((L - 4) / sp)), nz = Math.max(1, Math.floor((OD - 4) / sz));
      const kinds = o.trees || ['farm_peach', 'farm_pear', 'farm_plum', 'farm_peach', 'farm_apple'], k0 = Math.floor(rng() * kinds.length);
      for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) {
        const x = x0 + (L - nx * sp) / 2 + i * sp + rr(-0.25, 0.25), z = oz0 + (OD - nz * sz) / 2 + j * sz + rr(-0.25, 0.25);
        if (Math.abs(x - gateX) < 3 && Math.abs(z - gateZ) < 3.5) continue;
        if (rng() < 0.05) continue; // a tree lost and not yet replaced
        const kind = kinds[(k0 + Math.floor(i / 3)) % kinds.length], young = rng() < 0.1;
        const id = young && (kind === 'farm_peach' || kind === 'farm_pear') ? kind + '_young' : kind, t = 0.9 + rng() * 0.18;
        put(id, x, z, rr(0, TAU), { s: young ? rr(0.55, 0.7) : rr(0.85, 1.1), c: { r: t * rr(0.94, 1.04), g: t, b: t * rr(0.9, 1.0) } });
        addCircle(x, z, young ? 0.12 : 0.22);
      }
      // beehives in the far corner (pollination), a row of sunflowers along the path side of the fence
      const hxs = gateX === x0 ? x1 - 1.6 : x0 + 1.6;
      for (let k = 0; k < 2; k++) { const hx = hxs + (gateX === x0 ? -1 : 1) * k * 1.3, hz = (sg > 0 ? oz1 : oz0) - sg * 1.3; put('farm_beehive', hx, hz, (sg > 0 ? Math.PI : 0) + rr(-0.15, 0.15)); addBox(hx, hz, 0.4, 0.4, 0); }
      const fz = (sg > 0 ? oz0 : oz1) - sg * 0.9;
      for (let x = x0 + 0.6; x < x1 - 0.4; x += 0.42 + rng() * 0.12) {
        if (RN.roadAt(x, fz) || RN.walkY(x, fz) !== null || occRect(x, fz, 0.2, 0.2, 0, 0, true)) continue;
        put(rng() < 0.6 ? 'farm_sunflower_1' : 'farm_sunflower_2', x + rr(-0.08, 0.08), fz + rr(-0.15, 0.15), rr(-0.6, 0.6) + (sg > 0 ? Math.PI : 0), { s: rr(1.05, 1.35) });
      }
      out.orchard = { x0, x1, z0: oz0, z1: oz1 };
    }
  }

  // ---------------------------------------------------------------- the honesty stand by the lane
  for (const [x, z, face] of o.stand || []) {
    if (!clear(x - 1.45, z - 1.45, x + 1.45, z + 1.45) || !level(x - 1.3, z - 1.3, x + 1.3, z + 1.3, 0.35)) continue;
    occRect(x, z, 1.4, 1.4, face, 1);
    const y = put('farm_produce_stand', x, z, face, { s: 0.85 });
    addBox(x, z, 1.3, 1.3, face, y - 1, y + 2.8);
    const c = Math.cos(face), s = Math.sin(face);
    ['farm_box_potato', 'farm_box_cucumber', 'farm_box_eggplant'].forEach((id, i) => { const lx = (i - 1) * 0.78, lz = 0.55;
      put(id, x + lx * c + lz * s, z - lx * s + lz * c, face + rr(-0.05, 0.05), { y: y + 0.74, s: 0.85 }); });
    hf.paint2(2, x - 3, z - 3, x + 3, z + 3, (px, pz) => Math.hypot(px - x, pz - z) < 1.9 ? 0.6 : 0);
    // a pair of potted flowers by the stand and a cone keeping cars off its front
    for (const [lx, lz, id] of [[-1.55, 0.9, 'jp_flowerpot_2'], [1.55, 0.95, 'jp_flowerpot_6'], [1.9, 1.9, 'jp_traffic_pylon']]) put(id, x + lx * c + lz * s, z - lx * s + lz * c, rr(0, TAU), { s: id === 'jp_traffic_pylon' ? 1 : 0.8 });
    out.stand = { x, z };
    break;
  }
  return out;
}
