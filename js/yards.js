// Residential yards (庭): every house plot is furnished as an inhabited parcel, organised the way people use it —
// STREET → BOUNDARY → GATE (+ DRIVE) → FRONT GARDEN → ENTRANCE PATH → DOOR, a side yard kept passable for service
// (bins, gas, meters), and a back garden used for something: drying laundry, a timber deck, vegetable beds, a compost
// bin, firewood, a child's slide. What a plot gets follows an archetype chosen from the plot itself (its width, its
// back garden's depth, the district, a drive or not) and a seed of its own, so neighbours differ but a street keeps one
// character:
//   compact  narrow town plot: a short paved path, a slim bed, laundry poles, pots          (old quarter, narrow lots)
//   family   suburban house with a drive: pavers to the door, a deck with a table, toys, bins
//   garden   the gardener's house: stepping stones, deep flower beds, vegetable beds, a compost bin
//   large    wide or deep plot: all of the above with room between, a bench under the back tree
//   farm     farmhouse yard: firewood under a lean-to, tyres, cans, a big vegetable patch
// Every item is placed against the plot's own map of what is already there — the house and its steps, the drive, the
// shed, air-conditioners, gas bottles and the water heater (their colliders), the boundary walls, garden trees — and
// against everything placed before it; what does not fit is left out. Paths, beds and decks are built into the town's
// merged geometry (fine parts at detail levels), the bought props (tyres, barrels, cans, tools, sacks) are instanced
// models from the Urban Clutter pack; every feature is a world object (World Builder).
import { clamp, lerp, mulberry32, addBox, addCircle, addPlatform, lampPoints } from './core.js';
import { entity } from './world/capture.js';
import { cropSet } from './crops.js';

const pick = (rng, a) => a[Math.floor(rng() * a.length)];
const jit = (rng, c, k = 0.05) => c.map(v => clamp(v * (1 + (rng() - 0.5) * 2 * k), 0, 1));

// ctx: { B (GeoBuilder), lots, lotW, gy(x, z), trees (garden trees, world), extras (colliders the houses registered),
//        out: { hydras, bushes, pots } (instanced plants, appended to), props: Map(name -> items) (clutter instances) }
export function furnishYards(ctx) {
  const { B, lots, lotW, gy, extras, out, props } = ctx;
  const prop = (name, x, y, z, r, o = {}) => { if (!props.has(name)) props.set(name, []); props.get(name).push({ x, y, z, r, s: 1, ...o }); };
  // garden trees by 16 m cell (their trunks keep things off)
  const treeCells = new Map(); for (const t of ctx.trees || []) { const k = Math.floor(t.x / 16) + ',' + Math.floor(t.z / 16); if (!treeCells.has(k)) treeCells.set(k, []); treeCells.get(k).push(t); }
  const stats = { plots: 0, arch: {}, items: 0, skipped: 0 };
  for (const lot of lots) {
    if (lot.shop || !lot.info || lot.kind === 'garden' || lot.kind === 'carpark' || lot.kind === 'yard') continue;
    furnish(lot);
  }
  return stats;

  function furnish(lot) {
    const I = lot.info, LW = lot.w, LD = lot.d;
    const rng = mulberry32(((Math.floor(lot.x * 73.13) * 92821) ^ (Math.floor(lot.z * 191.71) * 68917)) >>> 0 || 7);
    const c = Math.cos(lot.r), s = Math.sin(lot.r);
    const W = (lx, lz) => lotW(lot, lx, lz), Y = (lx, lz) => { const [x, z] = W(lx, lz); return gy(x, z); };
    const toL = (x, z) => { const dx = x - lot.x, dz = z - lot.z; return [dx * c - dz * s, dx * s + dz * c]; };
    const front = LD / 2, hF = I.hz + I.D / 2, hB = I.hz - I.D / 2, h0 = I.hx - I.W / 2, h1 = I.hx + I.W / 2, y0 = lot.y ?? gy(lot.x, lot.z);
    // ---- the plot's map: rectangles [x0, x1, z0, z1] in plot coordinates
    const taken = [];
    const take = (x0, x1, z0, z1) => taken.push([Math.min(x0, x1), Math.max(x0, x1), Math.min(z0, z1), Math.max(z0, z1)]);
    const free = (cx, cz, hw, hd, pad = 0.1) => {
      if (cx - hw < -LW / 2 + 0.3 || cx + hw > LW / 2 - 0.3 || cz - hd < -LD / 2 + 0.3 || cz + hd > LD / 2 - 0.25) return false;
      for (const t of taken) if (cx + hw + pad > t[0] && cx - hw - pad < t[1] && cz + hd + pad > t[2] && cz - hd - pad < t[3]) return false;
      return true;
    };
    take(h0 - 0.3, h1 + 0.3, hB - 0.3, hF + 0.3);                                         // the house and its drip line
    take(I.doorX - 0.95, I.doorX + 0.95, hF, hF + 1.35);                                   // the entrance steps
    for (let e = lot.ex0 ?? 0; e < (lot.ex1 ?? 0); e++) {                                   // everything with a collider
      const b = extras[e]; if (b.t !== 'box') continue;
      const cb = Math.cos(b.r), sb = Math.sin(b.r); let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (const [u, v] of [[-b.hx, -b.hz], [b.hx, -b.hz], [b.hx, b.hz], [-b.hx, b.hz]]) { const [lx, lz] = toL(b.p[0] + u * cb + v * sb, b.p[2] - u * sb + v * cb); x0 = Math.min(x0, lx); x1 = Math.max(x1, lx); z0 = Math.min(z0, lz); z1 = Math.max(z1, lz); }
      if (x1 - x0 > LW * 0.9 && z1 - z0 > LD * 0.5) continue;                               // (the house itself: done)
      take(x0, x1, z0, z1);
    }
    let pad = null;
    if (I.carSpot) { const [px, pz] = toL(I.carSpot.p[0], I.carSpot.p[2]); pad = { x: px, z: pz + 0.4 }; take(px - 1.5, px + 1.5, pz + 0.4 - 2.9, front); } // the drive and its pad
    for (const k of [[0, 0], [-1, 0], [0, -1], [-1, -1], [1, 0], [0, 1], [1, 1], [1, -1], [-1, 1]]) {
      const key = (Math.floor(lot.x / 16) + k[0]) + ',' + (Math.floor(lot.z / 16) + k[1]);
      for (const t of treeCells.get(key) || []) { const [lx, lz] = toL(t.x, t.z); if (Math.abs(lx) < LW / 2 + 1 && Math.abs(lz) < LD / 2 + 1) take(lx - 0.7, lx + 0.7, lz - 0.7, lz + 0.7); }
    }
    for (const q of lot.yardTaken || []) take(...q);                                       // laundry, mailbox, bikes
    // ---- archetype
    const backD = hB - 0.4 - (-LD / 2 + 0.45), farm = lot.district === 'farm', old = lot.district === 'old' || lot.district === 'river' || lot.era === 'old';
    // (Japanese plots keep most of their open ground in front — the drive, the front garden — and along one side; the
    // back garden is often a strip. The archetype follows the open ground there is.)
    const sideL = h0 + LW / 2, sideR = LW / 2 - h1, open = backD * LW + Math.max(sideL, sideR) * I.D;
    const arch = farm ? 'farm' : LW < 9.2 || open < 14 ? 'compact' : LW * LD > 210 || open > 48 ? 'large'
      : (old ? rng() < 0.55 : rng() < 0.35) ? 'garden' : I.carSpot ? 'family' : rng() < 0.5 ? 'garden' : 'family';
    stats.plots++; stats.arch[arch] = (stats.arch[arch] || 0) + 1; lot.yardArch = arch;
    const style = I.style || 'classic', trad = style === 'traditional', modern = style === 'modern' || style === 'cube';
    const Bf = (lx, lz, yaw = 0) => B.frame(...[W(lx, lz)].map(([x, z]) => [x, Y(lx, lz), z])[0], lot.r + yaw);
    const n = { v: 0 }, ok = () => { n.v++; stats.items++; };

    // =========================================================== the entrance path: gate (or the drive) to the steps
    {
      let sx, sz;
      if (pad) { const side = I.doorX < pad.x ? -1 : 1; sx = pad.x + side * 1.95; sz = front - 1.5; if (Math.abs(sx) > LW / 2 - 0.6) { sx = pad.x + side * 1.4; sz = pad.z - 2.95; } }
      else { sx = clamp(I.doorX, I.gate[0] + 0.7, I.gate[1] - 0.7); sz = front - 0.2; }
      const ex = I.doorX, ez = hF + 1.38;
      // a route: in square from the gate, a gentle bend, square up to the steps
      const pts = [[sx, sz]];
      if (Math.abs(sx - ex) > 0.25 && sz - ez > 2.0) { const m1 = sz - Math.min(1.0, (sz - ez) * 0.3), m2 = ez + Math.min(0.9, (sz - ez) * 0.3); for (let k = 0; k <= 6; k++) { const t = k / 6, e = t * t * (3 - 2 * t); pts.push([lerp(sx, ex, e), lerp(m1, m2, t)]); } }
      pts.push([ex, ez]);
      const kind = trad || arch === 'garden' || (old && rng() < 0.5) ? 'stones' : modern ? 'slabs' : 'pavers';
      const pathW = kind === 'stones' ? 0.7 : modern ? 1.1 : 0.95;
      // walk the route at a fixed pitch
      const L = []; let tot = 0; for (let i = 0; i + 1 < pts.length; i++) { const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); L.push(l); tot += l; }
      const at = d => { let i = 0; while (i < L.length - 1 && d > L[i]) { d -= L[i]; i++; } const a = pts[i], b = pts[i + 1], t = L[i] ? clamp(d / L[i], 0, 1) : 0; return { x: lerp(a[0], b[0], t), z: lerp(a[1], b[1], t), yaw: Math.atan2(b[0] - a[0], b[1] - a[1]) }; };
      if (tot > 0.4) entity('garden_path', () => {
        const stoneC = [0.6, 0.58, 0.54], tileC = jit(rng, pick(rng, [[0.72, 0.66, 0.58], [0.66, 0.64, 0.6], [0.78, 0.74, 0.68], [0.58, 0.48, 0.42]])), slabC = [0.74, 0.73, 0.7];
        if (kind === 'stones') for (let d = 0.3; d < tot - 0.15; d += 0.62) { // tobi-ishi: flat irregular stones on a gravel bed
          const p = at(d), sz2 = 0.26 + rng() * 0.08; Bf(p.x + (rng() - 0.5) * 0.12, p.z, p.yaw + rng() * 3);
          const pts6 = []; for (let k = 0; k < 7; k++) { const a = k / 7 * Math.PI * 2, rr = sz2 * (0.8 + rng() * 0.35); pts6.push([Math.cos(a) * rr * 1.15, 0.05, Math.sin(a) * rr]); }
          const cc = jit(rng, stoneC, 0.08); B.poly('stone', pts6, [0, 1, 0], { color: cc, uv: 0.8 });
          for (let k = 0; k < 7; k++) { const a = pts6[k], b = pts6[(k + 1) % 7]; B.poly('stone', [[a[0], -0.03, a[2]], [b[0], -0.03, b[2]], [b[0], 0.05, b[2]], [a[0], 0.05, a[2]]], [a[0] + b[0], 0, a[2] + b[2]], { color: cc.map(v => v * 0.85), uv: 0.8 }); }
          Bf(p.x, p.z, p.yaw); B.box('ballast', 0, -0.005, 0, 0.9, 0.025, 0.66, { color: [0.78, 0.76, 0.72], uv: 1.5 });
        }
        else for (let d = 0, k = 0; d < tot - 0.05; d += kind === 'slabs' ? 0.62 : 0.31, k++) { // pavers in a running bond, or big slabs with grass joints
          const p = at(d + (kind === 'slabs' ? 0.25 : 0.15)); Bf(p.x, p.z, p.yaw);
          // (one box per row: the joints between rows show, each row its own tone; a few triangles per row)
          if (kind === 'slabs') B.box('concrete', 0, -0.03, 0, pathW, 0.07, 0.5, { color: jit(rng, slabC, 0.03), skip: 'ny', uv: 1 });
          else B.box('tiles', 0, -0.03, 0, pathW, 0.06, 0.29, { color: jit(rng, tileC, 0.06), skip: 'ny', uv: 0.6 });
        }
        // garden lights along a modern path
        if ((modern || lot.district === 'new') && rng() < 0.55 && tot > 2.5) for (let d = 1.0; d < tot - 0.8; d += 2.2) { const p = at(d), side = d % 4.4 < 2.2 ? 1 : -1, ox = Math.cos(p.yaw) * side * (pathW / 2 + 0.25), oz = -Math.sin(p.yaw) * side * (pathW / 2 + 0.25);
          Bf(p.x + ox, p.z + oz, 0); B.detail(1, () => { B.cyl('dark', 0, 0, 0, 0.05, 0.05, 0.42, 8, { color: [0.18, 0.18, 0.2] }); B.cyl('lamp', 0, 0.38, 0, 0.065, 0.065, 0.1, 10, { cap: true }); B.cyl('dark', 0, 0.48, 0, 0.08, 0.08, 0.025, 10, { color: [0.18, 0.18, 0.2], cap: true }); });
          lampPoints.push({ p: B.P([0, 0.45, 0]), s: 0.16, c: [1, 0.86, 0.62] }); }
      });
      for (let i = 0; i + 1 < pts.length; i++) { const a = pts[i], b = pts[i + 1]; take(Math.min(a[0], b[0]) - pathW / 2 - 0.15, Math.max(a[0], b[0]) + pathW / 2 + 0.15, Math.min(a[1], b[1]) - 0.15, Math.max(a[1], b[1]) + 0.15); }
      ok();
    }
    // =========================================================== gravel along the foundation (sides and back)
    entity('foundation_gravel', () => {
      const g = [0.72, 0.7, 0.66], w = 0.5; B.frame(...[W(I.hx, I.hz)].map(([x, z]) => [x, y0, z])[0], lot.r);
      B.box('ballast', 0, -0.02, -I.D / 2 - w / 2, I.W + 2 * w, 0.04, w, { color: g, uv: 1.5 });
      for (const sd of [-1, 1]) B.box('ballast', sd * (I.W / 2 + w / 2), -0.02, 0.6 * 0, w, 0.04, I.D, { color: g, uv: 1.5 });
      B.detail(1, () => { for (const sd of [-1, 1]) B.box('concrete', sd * (I.W / 2 + w + 0.03), -0.04, -0.02 - w / 2, 0.06, 0.08, I.D + w, { color: [0.7, 0.7, 0.68] }); B.box('concrete', 0, -0.04, -I.D / 2 - w - 0.03, I.W + 2 * w + 0.12, 0.08, 0.06, { color: [0.7, 0.7, 0.68] }); });
    });
    // =========================================================== the front bed along the house front, on the side away from the door
    if (rng() < { compact: 0.4, family: 0.6, garden: 0.95, large: 0.75, farm: 0.3 }[arch] && style !== 'twoTone') {
      const right = I.doorX < I.hx, xa = right ? I.doorX + 1.15 : h0 + 0.3, xb = right ? h1 - 0.3 : I.doorX - 1.15, dep = arch === 'garden' ? 1.1 : 0.75;
      const len = xb - xa, cx = (xa + xb) / 2, cz = hF + 0.32 + dep / 2;
      // (the house's drip line is taken: the bed may stand in it)
      const hitOther = (() => { const save = taken.shift(); const r = free(cx, cz, len / 2, dep / 2, 0.05); taken.unshift(save); return !r; })();
      if (len > 1.3 && !hitOther) entity('flower_bed', () => {
        Bf(cx, cz, 0);
        const edge = trad ? 'stone' : arch === 'garden' || farm ? 'logs' : modern ? 'concrete' : 'brick';
        const eC = { stone: [0.56, 0.55, 0.52], logs: [0.46, 0.34, 0.24], concrete: [0.74, 0.74, 0.72], brick: [0.62, 0.32, 0.22] }[edge];
        B.box('soil', 0, -0.02, 0, len, 0.1, dep, { color: [0.42, 0.32, 0.25], uv: 1 });
        const kerb = (x, z, w2, d2) => edge === 'logs' ? B.cyl('wood', x, 0, z, 0.05, 0.05, 0.14, 7, { color: jit(rng, eC, 0.08), cap: true }) : B.bbox(edge === 'brick' ? 'block' : edge === 'stone' ? 'stone' : 'concrete', x, -0.02, z, w2, 0.16, d2, 0.012, { color: jit(rng, eC, 0.05), uv: 0.6 });
        if (edge === 'logs') { for (let x = -len / 2 + 0.06; x <= len / 2; x += 0.11) kerb(x, dep / 2, 0, 0); for (const sd of [-1, 1]) for (let z = -dep / 2 + 0.06; z < dep / 2; z += 0.11) kerb(sd * len / 2, z, 0, 0); }
        else { kerb(0, dep / 2, len + 0.1, 0.1); for (const sd of [-1, 1]) kerb(sd * len / 2, 0, 0.1, dep); }
        // planting in layers: a shrub or hydrangea at the ends, bedding flowers between, one colour family per bed
        const flower = rng() < 0.5 ? 'flowerP' : 'flowerY';
        for (let x = -len / 2 + 0.35; x < len / 2 - 0.3; x += 0.42) for (const z of dep > 0.9 ? [-dep * 0.22, dep * 0.22] : [0]) { const p = B.P([x + (rng() - 0.5) * 0.08, 0.08, z + (rng() - 0.5) * 0.08]); cropSet.add(rng() < 0.82 ? flower : 'greens', p[0], p[1], p[2], rng() * 6.3, 0.75 + rng() * 0.35, null, 90); }
        for (const sd of [-1, 1]) if (rng() < 0.7) { const p = B.P([sd * (len / 2 - 0.35), 0, 0]); out.hydras.push({ x: p[0], y: p[1] - 0.04, z: p[2], s: 0.6 + rng() * 0.25, sx: 0.9 + rng() * 0.2, r: rng() * 6.28, c: ctx.hydraColor(rng) }); }
      });
      if (len > 1.3 && !hitOther) { take(xa, xb, hF + 0.3, hF + 0.35 + dep); ok(); }
    }
    // a small stone lantern in a traditional front garden
    if ((trad || (arch === 'garden' && old)) && rng() < 0.45) { const cands = [[h0 - 0.9, hF + 1.2], [h1 + 0.9, hF + 1.2], [h0 + 0.6, front - 1.2], [h1 - 0.6, front - 1.2]];
      const q = cands.find(([x, z]) => free(x, z, 0.3, 0.3, 0.15)); if (q) { entity('stone_lantern_small', () => { Bf(q[0], q[1], rng() * 6.3); const sc = [0.56, 0.55, 0.51];
        B.cyl('stone', 0, 0, 0, 0.16, 0.14, 0.1, 8, { color: sc, cap: true }); B.cyl('stone', 0, 0.1, 0, 0.06, 0.06, 0.38, 6, { color: sc }); B.bbox('stone', 0, 0.48, 0, 0.26, 0.05, 0.26, 0.01, { color: sc });
        B.bbox('stone', 0, 0.53, 0, 0.18, 0.15, 0.18, 0.01, { color: sc }); B.box('dark', 0, 0.57, 0.091, 0.08, 0.07, 0.005, { color: [0.12, 0.1, 0.08] });
        B.cyl('stone', 0, 0.68, 0, 0.25, 0.04, 0.13, 6, { color: sc, cap: true }); B.cyl('stone', 0, 0.8, 0, 0.035, 0.0, 0.06, 6, { color: sc }); }); take(q[0] - 0.3, q[0] + 0.3, q[1] - 0.3, q[1] + 0.3); addCircle(...W(q[0], q[1]), 0.22); ok(); } }

    // =========================================================== the gate: leaves between the pillars, a number plate
    if (I.hasWall) entity('garden_gate', () => {
      const gx0 = I.gate[0] + 0.18, gx1 = I.gate[1] - 0.18, gz = front - 0.1, gH = Math.min(1.1, I.wallH + 0.1), gC = pick(rng, [[0.35, 0.3, 0.26], [0.2, 0.2, 0.22], [0.78, 0.76, 0.72], [0.42, 0.36, 0.3]]);
      const leaf = (x0, yaw, wid, folded) => { B.frame(...[W(x0, gz)].map(([x, z]) => [x, Y(x0, gz), z])[0], lot.r + yaw);
        if (folded) { for (let k = 0; k < 6; k++) B.box('alu', 0.04 + k * 0.045, 0.05, 0, 0.02, gH - 0.05, 0.3, { color: gC }); B.box('alu', 0.15, gH, 0, 0.28, 0.04, 0.32, { color: gC }); return; }
        B.box('alu', wid / 2, 0.06, 0, wid, 0.04, 0.04, { color: gC }); B.box('alu', wid / 2, gH - 0.04, 0, wid, 0.04, 0.04, { color: gC });
        for (const xx of [0.02, wid - 0.02]) B.box('alu', xx, 0.06, 0, 0.04, gH - 0.06, 0.04, { color: gC });
        B.detail(1, () => { for (let xx = 0.14; xx < wid - 0.08; xx += 0.12) B.box('alu', xx, 0.1, 0, 0.022, gH - 0.14, 0.022, { color: gC }); B.box('alu', wid - 0.12, gH * 0.55, 0.03, 0.03, 0.12, 0.03, { color: [0.7, 0.68, 0.6] }); }); };
      if (pad) leaf(gx1 - 0.35, 0, 0, true);                      // a folding (accordion) gate pushed back against the pillar
      else { const wid = (gx1 - gx0) / 2, open = rng() < 0.6 ? 0.9 + rng() * 0.5 : 0; leaf(gx0, open, wid, false); leaf(gx1, Math.PI, wid, false); }
      // the house number on the pillar's street face
      B.frame(...[W(I.gate[1], front - 0.1 + 0.19)].map(([x, z]) => [x, Y(I.gate[1], front), z])[0], lot.r);
      B.detail(2, () => { B.box('plain', 0, I.wallH - 0.25, 0.005, 0.16, 0.11, 0.012, { color: [0.95, 0.93, 0.88] }); B.box('dark', 0, I.wallH - 0.21, 0.012, 0.09, 0.03, 0.004, { color: [0.15, 0.2, 0.35] }); });
    });
    if (I.hasWall && !pad) take(I.gate[0], I.gate[1], front - 1.6, front);

    // =========================================================== bins in the side yard by the street (service side)
    if (rng() < 0.6) { const side = I.doorX > I.hx ? 1 : -1, gap = side > 0 ? LW / 2 - h1 : h0 + LW / 2;
      if (gap > 1.25) { const bx = side > 0 ? h1 + 0.62 : h0 - 0.62, bz = hF - 0.5;
        if (free(bx, bz - 0.35, 0.28, 0.6, 0.02)) { entity('refuse_bins', () => { const cols = pick(rng, [[[0.25, 0.42, 0.62], [0.3, 0.5, 0.36]], [[0.4, 0.4, 0.42], [0.4, 0.4, 0.42]], [[0.22, 0.4, 0.3], [0.62, 0.62, 0.6]]]);
          for (let k = 0; k < 2; k++) { Bf(bx, bz - k * 0.62, rng() * 0.4); const cc = cols[k];
            B.cyl('plastic', 0, 0, 0, 0.23, 0.26, 0.62, 12, { color: cc }); B.cyl('plastic', 0, 0.62, 0, 0.28, 0.27, 0.06, 12, { color: cc.map(v => v * 0.85), cap: true }); B.detail(2, () => B.box('plastic', 0, 0.68, 0, 0.16, 0.03, 0.05, { color: cc.map(v => v * 0.7) })); } });
          take(bx - 0.3, bx + 0.3, bz - 0.95, bz + 0.3); addBox(...W(bx, bz - 0.31), 0.3, 0.6, lot.r, y0 - 1, y0 + 0.7); ok(); } } }

    // =========================================================== the back garden
    const bz0 = -LD / 2 + 0.45, bz1 = hB - 0.35, bx0 = -LW / 2 + 0.45, bx1 = LW / 2 - 0.45;
    const zTop = hF - 0.6; // (the side yards count, up to the house front)
    const tryAt = (w2, d2, cands) => cands.find(([x, z]) => x - w2 >= bx0 - 0.01 && x + w2 <= bx1 + 0.01 && z - d2 >= bz0 - 0.01 && z + d2 <= zTop && free(x, z, w2, d2, 0.15));
    const scan = (w2, d2, pref = 'any') => { const C = []; for (let z = bz0 + d2; z <= zTop - d2; z += 0.4) for (let x = bx0 + w2; x <= bx1 - w2; x += 0.4) C.push([x, z]);
      if (pref === 'house') C.sort((a, b) => (b[1] - a[1]) || Math.abs(a[0] - I.hx) - Math.abs(b[0] - I.hx)); else if (pref === 'far') C.sort((a, b) => a[1] - b[1]); else if (pref === 'side') C.sort((a, b) => Math.abs(b[0]) - Math.abs(a[0])); return tryAt(w2, d2, C); };
    // a timber deck off the back of the house (with a table, or laundry), reached by two steps
    if (backD > 2.0 && rng() < { compact: 0.1, family: 0.7, garden: 0.25, large: 0.65, farm: 0.1 }[arch]) {
      const dw = Math.min(I.W - 1.2, 3.2 + rng() * 1.4), dd = Math.min(backD - 0.75, 1.5 + rng() * 0.6), dx = clamp(I.hx + (rng() - 0.5) * (I.W - dw - 0.6), h0 + dw / 2 + 0.3, h1 - dw / 2 - 0.3), dz = hB - dd / 2;
      const save = taken.shift(), okD = free(dx, dz - 0.05, dw / 2, dd / 2 - 0.05, 0.05); taken.unshift(save);
      if (okD) { const top = 0.38, wc = jit(rng, pick(rng, [[0.62, 0.46, 0.32], [0.5, 0.38, 0.28], [0.72, 0.6, 0.46]]), 0.04);
        entity('wood_deck', () => { B.frame(...[W(dx, dz)].map(([x, z]) => [x, y0, z])[0], lot.r);
          for (const px of [-dw / 2 + 0.1, dw / 2 - 0.1]) for (const pz of [-dd / 2 + 0.1, dd / 2 - 0.15]) B.box('wood', px, -0.2, pz, 0.09, top + 0.15, 0.09, { color: wc.map(v => v * 0.7) });
          B.box('wood', 0, top - 0.12, -dd / 2 + 0.02, dw, 0.1, 0.04, { color: wc.map(v => v * 0.8) });
          for (const sd of [-1, 1]) B.box('wood', sd * (dw / 2 - 0.02), top - 0.12, 0, 0.04, 0.1, dd, { color: wc.map(v => v * 0.8) });
          const nb = Math.floor(dd / 0.14); for (let k = 0; k < nb; k++) B.box('wood', 0, top - 0.035, -dd / 2 + 0.07 + k * dd / nb, dw, 0.035, dd / nb - 0.012, { color: jit(rng, wc, 0.04), uv: 1.2 });
          const sx = (rng() - 0.5) * (dw - 1.2); for (let k = 0; k < 2; k++) B.bbox('wood', sx, top * (1 - (k + 1) / 3) - 0.04, -dd / 2 - 0.2 - k * 0.27, 1.0, 0.07, 0.28, 0.01, { color: wc });
          // on the deck: a table and two chairs, or a laundry stand
          if (rng() < 0.6) B.detail(1, () => { const tc = rng() < 0.5 ? [0.92, 0.92, 0.9] : wc.map(v => v * 0.85), tx = (rng() - 0.5) * (dw - 1.6);
            B.cyl('plastic', tx, top, 0.05, 0.035, 0.035, 0.68, 8, { color: tc }); B.cyl('plastic', tx, top + 0.68, 0.05, 0.4, 0.4, 0.035, 14, { color: tc, cap: true });
            for (const sd of [-1, 1]) { const cx2 = tx + sd * 0.62; B.box('plastic', cx2, top + 0.42, 0.05, 0.4, 0.04, 0.4, { color: tc }); for (const l of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]]) B.box('plastic', cx2 + l[0], top, 0.05 + l[1], 0.03, 0.42, 0.03, { color: tc });
              B.box('plastic', cx2 + sd * 0.18, top + 0.42, 0.05, 0.03, 0.42, 0.38, { color: tc }); } });
          else B.detail(1, () => { const lc = [0.72, 0.74, 0.76]; for (const sx2 of [-dw / 2 + 0.35, dw / 2 - 0.35]) { B.box('alu', sx2, top, 0, 0.04, 1.6, 0.04, { color: lc }); B.box('alu', sx2, top + 1.55, 0, 0.04, 0.04, 0.7, { color: lc }); }
            for (const sz of [-0.3, 0.3]) B.box('alu', 0, top + 1.55, sz, dw - 0.6, 0.03, 0.03, { color: lc });
            if (rng() < 0.7) for (let k = 0; k < 5; k++) B.box('plain', -dw / 2 + 0.7 + k * (dw - 1.4) / 4, top + 0.95, -0.3, 0.42, 0.58, 0.015, { color: jit(rng, pick(rng, [[0.95, 0.95, 0.94], [0.55, 0.66, 0.9], [0.95, 0.66, 0.66], [0.98, 0.86, 0.55], [0.6, 0.8, 0.62]]), 0.1) }); });
        });
        addPlatform(...W(dx, dz), dw / 2, dd / 2, lot.r, y0 + top);
        take(dx - dw / 2, dx + dw / 2, dz - dd / 2 - 0.75, dz + dd / 2); ok();
      }
    }
    // laundry poles on a concrete pad when there is no deck for them (most Japanese back yards dry the washing outside)
    if (backD > 1.4 && !lot.hasLaundry && rng() < { compact: 0.65, family: 0.35, garden: 0.4, large: 0.4, farm: 0.6 }[arch]) {
      const q = scan(1.3, 0.4, 'house'); if (q) { entity('laundry_poles', () => { Bf(q[0], q[1], 0); const lc = [0.7, 0.72, 0.74];
        B.box('concrete', 0, -0.03, 0, 2.6, 0.06, 0.8, { color: [0.7, 0.7, 0.68] });
        for (const sx2 of [-1.15, 1.15]) { B.box('alu', sx2, 0, 0, 0.05, 1.9, 0.05, { color: lc }); B.box('alu', sx2, 1.85, 0, 0.05, 0.05, 0.75, { color: lc }); }
        B.detail(1, () => { for (const sz of [-0.33, 0.33]) B.box('alu', 0, 1.85, sz, 2.6, 0.035, 0.035, { color: [0.55, 0.62, 0.7] });
          if (rng() < 0.75) for (let k = 0; k < 6; k++) B.box('plain', -0.95 + k * 0.38, 1.2, rng() < 0.5 ? -0.33 : 0.33, 0.32, 0.62, 0.012, { color: jit(rng, pick(rng, [[0.96, 0.96, 0.95], [0.5, 0.62, 0.88], [0.96, 0.64, 0.64], [0.98, 0.88, 0.6], [0.62, 0.8, 0.64], [0.4, 0.4, 0.44]]), 0.1) }); }); });
        take(q[0] - 1.3, q[0] + 1.3, q[1] - 0.45, q[1] + 0.45); ok(); }
    }
    // vegetable beds: raised timber frames with two rows each, a stake line of tomatoes in one
    const nBeds = { compact: rng() < 0.15 ? 1 : 0, family: rng() < 0.3 ? 1 : 0, garden: 2 + Math.floor(rng() * 2), large: rng() < 0.6 ? 2 : 0, farm: 2 + Math.floor(rng() * 2) }[arch];
    let bedsMade = 0;
    for (let b = 0; b < nBeds; b++) {
      const long = 1.05 + rng() * 0.3; let bw2 = long, bd2 = 0.55, q = scan(bw2, bd2, 'far'); if (!q) { bw2 = 0.55; bd2 = long; q = scan(bw2, bd2, 'side'); } if (!q) break;
      entity('vegetable_bed', () => { Bf(q[0], q[1], 0); const wc = [0.52, 0.4, 0.3];
        B.box('soil', 0, -0.02, 0, bw2 * 2 - 0.08, 0.22, bd2 * 2 - 0.08, { color: [0.36, 0.27, 0.2], uv: 1 });
        for (const sd of [-1, 1]) { B.bbox('wood', sd * (bw2 - 0.03), -0.02, 0, 0.06, 0.26, bd2 * 2, 0.008, { color: jit(rng, wc, 0.06) }); B.bbox('wood', 0, -0.02, sd * (bd2 - 0.03), bw2 * 2, 0.26, 0.06, 0.008, { color: jit(rng, wc, 0.06) }); }
        const crop = pick(rng, ['tomato', 'eggplant', 'greens', 'cabbage', 'napa', 'leek', 'daikon', 'seedling', 'greens']);
        const alongX = bw2 > bd2, La = alongX ? bw2 : bd2, Lc = alongX ? bd2 : bw2;
        for (const c2 of [-Lc * 0.45, Lc * 0.45]) for (let a = -La + 0.25; a < La - 0.15; a += crop === 'tomato' ? 0.45 : 0.32) { const p = B.P(alongX ? [a, 0.2, c2] : [c2, 0.2, a]); cropSet.add(crop, p[0], p[1], p[2], rng() * 6.3, crop === 'tomato' ? 0.8 : 0.7 + rng() * 0.3, null, 90); }
      });
      take(q[0] - bw2, q[0] + bw2, q[1] - bd2, q[1] + bd2); addBox(...W(q[0], q[1]), bw2, bd2, lot.r, y0 - 1, y0 + 0.24); bedsMade++; ok();
    }
    // a compost bin and a watering can near the beds; a shovel against the shed or a bed
    if (bedsMade && rng() < 0.7) { const q = scan(0.36, 0.36, 'far'); if (q) { entity('compost_bin', () => { Bf(q[0], q[1], rng() * 6.3); const cc = [0.18, 0.32, 0.2];
      B.cyl('plastic', 0, 0, 0, 0.4, 0.3, 0.78, 10, { color: cc }); B.cyl('plastic', 0, 0.78, 0, 0.31, 0.22, 0.08, 10, { color: cc.map(v => v * 0.8), cap: true }); }); take(q[0] - 0.42, q[0] + 0.42, q[1] - 0.42, q[1] + 0.42); addCircle(...W(q[0], q[1]), 0.4); ok(); } }
    if (bedsMade && rng() < 0.35) { const q = scan(0.2, 0.2, 'side'); if (q) { const [x, z] = W(q[0], q[1]); prop('shovel', x, Y(q[0], q[1]), z, lot.r + rng() * 6.3, { tilt: 0.18 }); take(q[0] - 0.25, q[0] + 0.25, q[1] - 0.25, q[1] + 0.25); ok(); } }
    // a rain barrel under a back corner of the house (the downpipe)
    if (rng() < { compact: 0.2, family: 0.35, garden: 0.7, large: 0.5, farm: 0.4 }[arch]) { const q = tryAt(0.3, 0.3, [[h1 - 0.2, hB - 0.8], [h0 + 0.2, hB - 0.8], [h1 + 0.8, hB + 0.3], [h0 - 0.8, hB + 0.3], [h1 + 0.8, hF - 1.2], [h0 - 0.8, hF - 1.2]]);
      if (q) { const [x, z] = W(q[0], q[1]); prop('rain_barrel', x, Y(q[0], q[1]), z, lot.r + rng() * 6.3); take(q[0] - 0.32, q[0] + 0.32, q[1] - 0.32, q[1] + 0.32); addCircle(x, z, 0.3); ok(); } }
    // firewood under a lean-to (old houses, farms, large plots), the axe on the block
    if (rng() < (farm ? 0.75 : old ? 0.3 : arch === 'large' ? 0.25 : 0.05)) { const q = scan(0.85, 0.3, 'far');
      if (q) { entity('firewood_stack', () => { Bf(q[0], q[1], 0); const wc = [0.5, 0.36, 0.24];
        for (const sx2 of [-0.8, 0.8]) B.box('wood', sx2, 0, -0.25, 0.07, 1.35, 0.07, { color: [0.36, 0.28, 0.2] });
        for (const sx2 of [-0.8, 0.8]) B.box('wood', sx2, 0, 0.25, 0.07, 1.15, 0.07, { color: [0.36, 0.28, 0.2] });
        B.poly('roofMetal', [[-0.95, 1.36, -0.4], [0.95, 1.36, -0.4], [0.95, 1.14, 0.42], [-0.95, 1.14, 0.42]], [0, 1, 0.3], { color: [0.42, 0.44, 0.46], uv: 1 });
        B.detail(1, () => { for (let row = 0; row < 7; row++) for (let k = 0; k < 12; k++) { const lx = -0.7 + k * 0.127 + (row % 2) * 0.06; if (lx > 0.72) continue; B.cyl('wood', lx, 0.06 + row * 0.13, 0, 0.06, 0.06, 0.4, 6, { color: jit(rng, wc, 0.12) }); }
          B.cyl('wood', 1.2, 0, 0.2, 0.18, 0.18, 0.38, 9, { color: [0.55, 0.42, 0.3], cap: true }); }); });
        take(q[0] - 1.45, q[0] + 0.95, q[1] - 0.35, q[1] + 0.45); addBox(...W(q[0], q[1]), 0.9, 0.32, lot.r, y0 - 1, y0 + 1.4);
        const [ax, az] = W(q[0] + 1.2, q[1] + 0.2); if (rng() < 0.25) prop('axe', ax, Y(q[0] + 1.2, q[1] + 0.2) + 0.38, az, lot.r + rng() * 6.3, { tilt: 0.12 }); ok(); } }
    // tyres, cans and old timber by the shed, the barn or the drive (farms, families with a car)
    if ((farm || (pad && arch !== 'garden')) && rng() < (farm ? 0.7 : 0.25)) { const q = scan(0.65, 0.45, 'side');
      if (q) { const [x, z] = W(q[0], q[1]); prop(rng() < 0.5 ? 'tires_pile' : 'tire_stack', x, Y(q[0], q[1]), z, lot.r + rng() * 6.3); take(q[0] - 0.7, q[0] + 0.7, q[1] - 0.5, q[1] + 0.5); addCircle(x, z, 0.5); ok(); } }
    if (farm && rng() < 0.6) { const q = scan(0.3, 0.2, 'side'); if (q) { for (let k = 0; k < 1 + Math.floor(rng() * 2); k++) { const [x, z] = W(q[0] + k * 0.36, q[1]); prop('gas_can', x, Y(q[0], q[1]), z, lot.r + (rng() - 0.5) * 0.4); } take(q[0] - 0.3, q[0] + 0.7, q[1] - 0.25, q[1] + 0.25); ok(); } }
    // a child's slide on the lawn (families)
    if (arch === 'family' && rng() < 0.22) { const q = scan(0.45, 0.95, 'far'); if (q) { entity('kiddie_slide', () => { Bf(q[0], q[1], rng() < 0.5 ? 0 : Math.PI); const pc = pick(rng, [[0.95, 0.75, 0.2], [0.35, 0.6, 0.9], [0.9, 0.35, 0.35]]), sc = pick(rng, [[0.98, 0.55, 0.2], [0.3, 0.75, 0.45], [0.95, 0.85, 0.3]]);
      for (const sd of [-0.28, 0.28]) B.box('plastic', sd, 0, -0.75, 0.06, 0.95, 0.06, { color: pc });
      for (let k = 1; k < 4; k++) B.box('plastic', 0, k * 0.22, -0.75, 0.56, 0.035, 0.05, { color: pc });
      B.box('plastic', 0, 0.9, -0.55, 0.62, 0.06, 0.45, { color: pc });
      B.poly('plastic', [[-0.26, 0.9, -0.32], [0.26, 0.9, -0.32], [0.26, 0.06, 0.9], [-0.26, 0.06, 0.9]], [0, 1, 0.6], { color: sc });
      for (const sd of [-0.28, 0.28]) B.poly('plastic', [[sd, 0.9, -0.32], [sd, 1.06, -0.32], [sd, 0.18, 0.9], [sd, 0.06, 0.9]], [Math.sign(sd), 0, 0], { color: sc.map(v => v * 0.85) }); });
      take(q[0] - 0.5, q[0] + 0.5, q[1] - 1.0, q[1] + 1.0); addBox(...W(q[0], q[1]), 0.35, 0.9, lot.r, y0 - 1, y0 + 1.0); ok(); } }
    // a garden bench (large plots and gardens): toward the back, looking at the house
    if ((arch === 'large' || arch === 'garden') && rng() < 0.45) { const q = scan(0.7, 0.3, 'far'); if (q) { entity('garden_bench', () => { Bf(q[0], q[1], Math.PI); const wc = [0.56, 0.42, 0.3];
      for (const sd of [-0.6, 0.6]) B.box('wood', sd, 0, 0, 0.06, 0.42, 0.36, { color: wc.map(v => v * 0.8) });
      B.bbox('wood', 0, 0.42, 0, 1.4, 0.05, 0.38, 0.008, { color: wc }); B.bbox('wood', 0, 0.5, -0.17, 1.4, 0.35, 0.04, 0.008, { color: wc }); });
      take(q[0] - 0.75, q[0] + 0.75, q[1] - 0.35, q[1] + 0.35); addBox(...W(q[0], q[1]), 0.7, 0.2, lot.r, y0 - 1, y0 + 0.5); ok(); } }
    // pots on the back step / along the side
    if (rng() < 0.5) for (let k = 0; k < 2 + Math.floor(rng() * 3); k++) { const q = scan(0.15, 0.15, 'house'); if (!q) break; const [x, z] = W(q[0], q[1]); out.pots.push({ x, y: Y(q[0], q[1]), z, s: 0.3 + rng() * 0.25, r: rng() * 6.28 }); take(q[0] - 0.18, q[0] + 0.18, q[1] - 0.18, q[1] + 0.18); }
  }
}
