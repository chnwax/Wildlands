// A stage's data that is pure computation — the line of the road fitted to its length, the distance field round it, the
// graded ground, the masks of what grows where — with no engine behind it. The stage builder (rally.js) runs it on the
// main thread when nothing was prepared; the preparation worker (prep.worker.js) runs exactly the same code in the
// background while the player is still in Sakuragawa, so the build that follows only takes the arrays over.
import { CatmullRomCurve3, Vector3 } from '../lib/three/build/three.module.js';
import { clamp, lerp, smoothstep, mulberry32 } from './noise.js';

// the road's widths for a stage: RW the half width of the surface (1.4 m, one car, unless the stage asks for more), EX
// how much wider than that one-car road it is; ROAD the clean middle, SHOULDER the edge's end, CLEAR the trees' distance
export function stageDims(cfg) {
  const RW = cfg.half || 1.4, EX = RW - 1.4, LANES = cfg.lanes || 1, ROAD = RW - 0.1, SHOULDER = RW + 0.2, CLEAR = RW + 2.05;
  const WORLD = cfg.world || 2048, HALF = WORLD / 2, DC = 2, DN = WORLD / DC, FAR = 60, ED = SHOULDER + 0.25, BANK0 = ED + 1.23 * WORLD / 1024;
  return { RW, EX, LANES, ROAD, SHOULDER, CLEAR, WORLD, HALF, DC, DN, FAR, ED, BANK0, GRID: 1024, HN: 1025, CELL: WORLD / 1024 };
}

// A way point the route turns sharply at (a switchback) becomes an arc of radius R tangent to both legs, as a road's
// hairpin is built: a spline through the bare point would turn there on a few metres, tighter than any car can.
export function fillet(way, R0) {
  const out = [way[0]];
  for (let i = 1; i < way.length - 1; i++) {
    const [ax, az] = way[i - 1], [bx, bz] = way[i], [cx, cz] = way[i + 1], lu = Math.hypot(bx - ax, bz - az), lv = Math.hypot(cx - bx, cz - bz);
    const ux = (bx - ax) / lu, uz = (bz - az) / lu, vx = (cx - bx) / lv, vz = (cz - bz) / lv, th = Math.acos(clamp(ux * vx + uz * vz, -1, 1));
    if (th < 1.0) { out.push(way[i]); continue; } // (gentler bends: the spline rounds them well enough)
    let R = R0, t = R * Math.tan(th / 2); const tmax = 0.45 * Math.min(lu, lv); if (t > tmax) { t = tmax; R = t / Math.tan(th / 2); }
    const p0x = bx - ux * t, p0z = bz - uz * t, p1x = bx + vx * t, p1z = bz + vz * t, sd = -uz * vx + ux * vz > 0 ? 1 : -1, ox = p0x - uz * sd * R, oz = p0z + ux * sd * R;
    const a0 = Math.atan2(p0z - oz, p0x - ox); let sw = Math.atan2(p1z - oz, p1x - ox) - a0; sw -= Math.round(sw / (2 * Math.PI)) * 2 * Math.PI;
    const n = Math.max(3, Math.ceil(Math.abs(sw) * R / 3));
    for (let k = 0; k <= n; k++) { const a = a0 + sw * k / n; out.push([ox + Math.cos(a) * R, oz + Math.sin(a) * R]); }
  }
  out.push(way[way.length - 1]);
  return out;
}

export function trackLine(cfg) {
  // Fit each hand-drawn route to its declared competitive distance. Sampling is followed by one final uniform
  // correction, so the polyline used by timing, pace notes and the road itself has the requested length.
  // (keepScale: a route laid out on the stage's own land — along its canyon, its coast — keeps its place and its own length)
  let way = cfg.way.map(p => p.slice()), curve = new CatmullRomCurve3(way.map(([x, z]) => new Vector3(x, 0, z)), false, 'centripetal');
  const fit = cfg.keepScale ? 1 : cfg.target / curve.getLength(); way = fillet(way.map(([x, z]) => [x * fit, z * fit]), cfg.hairpin || 10);
  curve = new CatmullRomCurve3(way.map(([x, z]) => new Vector3(x, 0, z)), false, 'centripetal');
  const target = cfg.keepScale ? Math.round(curve.getLength()) : cfg.target;
  const fit2 = target / curve.getLength(); way = way.map(([x, z]) => [x * fit2, z * fit2]);
  curve = new CatmullRomCurve3(way.map(([x, z]) => new Vector3(x, 0, z)), false, 'centripetal');
  const n = Math.max(2, Math.round(target)), pts = [];
  curve.arcLengthDivisions = n * 8; // (the even 1 m stations need a fine arc-length table: the default 200 steps bunched them up round the hairpins)
  for (let i = 0; i <= n; i++) { const p = curve.getPointAt(i / n); pts.push([p.x, p.z]); }
  const sampled = pts.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0), exact = cfg.keepScale ? 1 : target / sampled;
  for (const p of pts) { p[0] *= exact; p[1] *= exact; }
  const nComp = pts.length; // (the competitive road: the stations up to here; the run-off after the finish follows)
  pts.push(...runoff(pts, cfg.runoff ?? 260, cfg.world || 2048, cfg.land));
  const mountain = cfg.profile === 'mountain';
  const land = cfg.land || (mountain
    ? (x, z) => 68 + z * 0.105 + x * 0.006 + Math.sin(x * 0.007 + 0.4) * 3.2 + Math.sin(z * 0.008 + 1.1) * 2.4 + Math.sin((x - z) * 0.014) * 1.1 + Math.sin(x * 0.013 - z * 0.004 + 2.1) * 5 + Math.sin(x * 0.031 + z * 0.017) * 2.2
    : cfg.roadType === 'asphalt'
    ? (x, z) => 48 + z * 0.075 + Math.sin(x * 0.006) * 7 + Math.sin(z * 0.008 + 0.8) * 5 + Math.sin((x + z) * 0.012) * 2.8 + Math.sin(x * 0.016 + z * 0.005 + 1.3) * 10 + Math.sin(z * 0.021 - x * 0.011 + 0.4) * 4.5
    : (x, z) => 24 + z * 0.025 + Math.sin(x * 0.005) * 4.5 + Math.sin(z * 0.007 + 0.8) * 3.5 + Math.sin((x + z) * 0.01) * 2);
  const jumpSpecs = cfg.jumps || [];
  const jump = (s, c, h) => { const d = s - c; if (d < -18 || d > 7) return 0; return d <= 0 ? h * Math.pow((d + 18) / 18, 1.18) : h * (1 - d / 7); };
  // (a hillside road is graded: it follows the land smoothed along its way, cutting into the rises and built up over the
  // hollows, so the slopes beside it keep their own shape)
  // (two passes of a true moving average, every station in its window: sampling every third one shifted the sample set
  // with each station and left a centimetre of ripple every metre, which the wheels hammered on)
  const graded = mountain || cfg.verge === 'cut' || cfg.grade, L0 = pts.map(([x, z]) => land(x, z)), box = (A, r) => { const S = new Float64Array(A.length + 1); for (let i = 0; i < A.length; i++) S[i + 1] = S[i] + A[i];
      return A.map((_, i) => { const a = Math.max(0, i - r), b = Math.min(A.length - 1, i + r); return (S[b + 1] - S[a]) / (b - a + 1); }); };
  // (through a tunnel the road keeps its own grade: the hill over it is not followed, the line runs straight from portal to portal)
  // (and through a rock cut: the road goes through the rock, not over it)
  for (const [a, b] of [...spans(cfg.tunnels, pts, nComp), ...spans(cfg.cuts, pts, nComp)]) { const i0 = Math.max(0, a - 30), i1 = Math.min(pts.length - 1, b + 30); for (let i = i0 + 1; i < i1; i++) L0[i] = L0[i0] + (L0[i1] - L0[i0]) * (i - i0) / (i1 - i0); }
  const LS = graded ? box(box(L0, Math.round((cfg.grade || 60) * 0.6)), Math.round((cfg.grade || 60) * 0.6)) : L0;
  const Y = pts.map(([x, z], i) => LS[i]
    + (cfg.land ? Math.sin(i / 70) * 0.5 : mountain ? Math.sin(i / 180 + 0.5) * 2.4 + Math.sin(i / 80) * 0.8 : Math.sin(i / (cfg.roadType === 'asphalt' ? 210 : 260) + 0.5) * (cfg.roadType === 'asphalt' ? 3.8 : 2.8) + Math.sin(i / 92) * 1.7)
    + jumpSpecs.reduce((v, j) => v + jump(i, j.f * n, j.h), 0));
  const features = jumpSpecs.map(j => ({ at: Math.round(j.f * n), end: Math.round(j.f * n) + 12, text: j.text, kind: 'feature', dir: 0 }));
  for (const f of cfg.features || []) features.push({ at: Math.round(n * f.f), end: Math.round(n * f.f) + 10, text: f.text, kind: 'feature', dir: 0 });
  return { pts, Y, features, land, length: target, nComp };
}

// The road goes on past the finish: a run-off where the cars slow down and stop at the stop control, as a stage has. It
// leaves the finish straight on and eases into a gentle bend, whichever way keeps it clear of the road already laid and
// inside the map.
export function runoff(pts, len, world, land = null) {
  if (len <= 0) return [];
  const n = pts.length - 1, [ex, ez] = pts[n], [px, pz] = pts[n - 4], h0 = Math.atan2(ex - px, ez - pz), lim = world / 2 - 90;
  const trial = c => { const out = []; let x = ex, z = ez, h = h0;
    for (let i = 1; i <= len; i++) { h += c * smoothstep(0, 50, i); x += Math.sin(h); z += Math.cos(h); if (Math.abs(x) > lim || Math.abs(z) > lim) return null; out.push([x, z]); }
    for (let k = 0; k < out.length; k += 4) for (let j = 0; j < n - 70; j += 3) if (Math.hypot(out[k][0] - pts[j][0], out[k][1] - pts[j][1]) < 42) return null;
    return out; };
  // (of the ways clear of the road, the one over the levellest ground: the cars brake to a stop on it)
  let best = null, bs = 1e18;
  for (const c of [0, 1 / 420, -1 / 420, 1 / 250, -1 / 250, 1 / 160, -1 / 160, 1 / 110, -1 / 110]) { const r = trial(c); if (!r) continue; if (!land) return r;
    const h0 = land(ex, ez); let sc = 0; for (let k = 20; k < r.length; k += 20) sc = Math.max(sc, Math.abs(land(r[k][0], r[k][1]) - h0) / k); sc += Math.abs(c) * 2; if (sc < bs) { bs = sc; best = r; } }
  return best || trial(0) || [];
}

// the corners: runs of signed curvature, by their tightest point and direction (also kept for the pace notes)
export function findCorners(K, N, startI, finishI) {
  const corners = []; let s = -1;
  for (let i = 0; i <= N; i++) { const tight = i < N && Math.abs(K[i]) > 1 / 500; if (tight && s < 0) s = i;
    if (!tight && s >= 0) { let a = s; for (let k = s; k < i; k++) if (Math.abs(K[k]) > Math.abs(K[a])) a = k; if (a > startI + 45 && a < finishI - 40) corners.push({ s, e: i - 1, apex: a, R: 1 / Math.abs(K[a]), dir: Math.sign(K[a]) }); s = -1; } }
  return corners;
}

// where the spectators gather: at the tightest bends (the inside, behind tape) and at the crests and jumps, never on
// another stretch of the road
export function crowdSites(P, T, K, N, left, corners, features, distAt, cfg, rng, EX) {
  const cand = corners.filter(c => c.R < 42).sort((a, b) => a.R - b.R).slice(0, 4).map(c => ({ i: c.apex, side: c.dir }));
  for (const f of features) if (/skok|szczyt|kompresja/i.test(f.text)) cand.push({ i: f.at, side: rng() < 0.5 ? 1 : -1 });
  const sites = [];
  for (const c of cand) { if (sites.some(s => Math.abs(s.i - c.i) < 140) || c.i < 90 || c.i > N - 90) continue;
    for (const side of [c.side, -c.side]) { const [lx, lz] = left(c.i), x = P[c.i][0] + lx * side * (10.5 + EX), z = P[c.i][1] + lz * side * (10.5 + EX);
      if (distAt(x, z) < 9 + EX) continue;
      sites.push({ i: c.i, side, x, z, r: 9, n: 9 + Math.floor(rng() * 9) }); break; }
    if (sites.length >= 5) break; }
  return sites;
}

// timber stacked by the road, as the forestry leaves it beside every forest track: on straight stretches, past the ditch
export function logPiles(P, T, K, N, left, distAt, rng, EX) {
  const piles = [];
  for (let i = 110 + Math.floor(rng() * 60); i < N - 110;) {
    let straight = true; for (let k = i - 10; k <= i + 10; k++) if (Math.abs(K[k]) > 1 / 90) { straight = false; break; }
    const side = rng() < 0.5 ? 1 : -1, [lx, lz] = left(i), d = 5.8 + EX + rng() * 0.8, x = P[i][0] + lx * side * d, z = P[i][1] + lz * side * d;
    if (!straight || distAt(x, z) < d - 0.6) { i += 15; continue; }
    piles.push({ i, x, z, side, len: 4 + rng() * 1.4, rad: 0.13 + rng() * 0.07, rows: 2 + Math.floor(rng() * 2), seed: rng() });
    i += 140 + Math.floor(rng() * 150);
  }
  return piles;
}

// ---------------------------------------------------------------- the stage's geometry
// pre: arrays prepared before (the worker's DIST and NEAR), else computed here; yields every few hundred stations
export function* stageGeometry(cfg, pre = null) {
  const D = stageDims(cfg), { RW, EX, ROAD, SHOULDER, CLEAR, WORLD, HALF, DC, DN, FAR, ED, BANK0 } = D;
  const line = trackLine(cfg), P = line.pts, Y = line.Y, N = P.length, finishAt = line.nComp - 28;
  const T = P.map((_, i) => { const a = P[Math.max(0, i - 2)], b = P[Math.min(N - 1, i + 2)], l = Math.hypot(b[0] - a[0], b[1] - a[1]); return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; });
  // signed curvature (left positive: the car's left is +x when it faces +z) over ±6 m
  const K = P.map((_, i) => { const a = T[Math.max(0, i - 6)], b = T[Math.min(N - 1, i + 6)]; return (a[1] * b[0] - a[0] * b[1]) / 12; });
  const left = i => [T[i][1], -T[i][0]];
  // ---- the distance field: distance to the centre line and the nearest point on it (2 m cells, 60 m round the road)
  let DIST = pre && pre.DIST, NEAR = pre && pre.NEAR;
  if (!DIST) { DIST = new Float32Array(DN * DN).fill(FAR); NEAR = new Int32Array(DN * DN).fill(-1);
    for (let i = 0; i < N; i++) { const [px, pz] = P[i], i0 = Math.max(0, Math.floor((px - FAR + HALF) / DC)), i1 = Math.min(DN - 1, Math.ceil((px + FAR + HALF) / DC)), j0 = Math.max(0, Math.floor((pz - FAR + HALF) / DC)), j1 = Math.min(DN - 1, Math.ceil((pz + FAR + HALF) / DC));
      for (let j = j0; j <= j1; j++) { const z = -HALF + (j + 0.5) * DC, dz = z - pz; for (let ii = i0; ii <= i1; ii++) { const dx = -HALF + (ii + 0.5) * DC - px, d = dx * dx + dz * dz, o = j * DN + ii; if (d < DIST[o] * DIST[o]) { DIST[o] = Math.sqrt(d); NEAR[o] = i; } } }
      if ((i & 511) === 0) yield ['Laying out the stage', 0.05 + 0.1 * i / N]; } }
  const distAt = (x, z) => { const gx = clamp((x + HALF) / DC - 0.5, 0, DN - 1.001), gz = clamp((z + HALF) / DC - 0.5, 0, DN - 1.001), i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j, o = j * DN + i;
    return lerp(lerp(DIST[o], DIST[o + 1], fx), lerp(DIST[o + DN], DIST[o + DN + 1], fx), fz); };
  const nearAt = (x, z) => { const i = clamp(Math.floor((x + HALF) / DC), 0, DN - 1), j = clamp(Math.floor((z + HALF) / DC), 0, DN - 1); return NEAR[j * DN + i]; };
  // ---- woods: where the forest stands thick (a field of crossing waves, the stage's own)
  const rng = mulberry32(cfg.seed), ph = Array.from({ length: 8 }, () => [rng() * 6.28, 0.6 + rng() * 0.8, rng() * 6.28]);
  const woods = (x, z) => { let n = 0; for (let k = 0; k < 8; k++) { const [a, f, p] = ph[k], s = 0.0028 * f * (1 + k * 0.45); n += Math.sin((x * Math.cos(a) + z * Math.sin(a)) * s + p) / (1 + k * 0.6); } return smoothstep(-0.1, 0.9, n * 0.75 + 0.1); };
  const mountain = cfg.profile === 'mountain', asphalt = cfg.roadType === 'asphalt', cut = (cfg.verge || (mountain ? 'cut' : 'ditch')) === 'cut';
  // ---- the road's own surface, exact between the 2 m cells of the ground: a nearly flat cross-section with a slight
  // crown (water runs off to the edges), the bends banked a little toward their inside. Wheels, the ribbon and the ground
  // under it all read it from here, so the road never takes the shape of the coarse terrain grid
  const CROWN = asphalt ? 0.016 : 0.026, BANK = Float32Array.from(K, k => asphalt ? clamp(k * 5, -0.035, 0.035) : clamp(k * 2, -0.018, 0.018)); // (about 1-2 % each way: nearly flat)
  const project = (x, z, o) => { const i = nearAt(x, z); if (i < 0) return null; let best = Infinity;
    for (let k = Math.max(0, i - 3); k <= Math.min(N - 2, i + 2); k++) { const ax = P[k][0], az = P[k][1], dx = P[k + 1][0] - ax, dz = P[k + 1][1] - az, l2 = dx * dx + dz * dz || 1e-9;
      const t = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1), ex = x - ax - dx * t, ez = z - az - dz * t, d2 = ex * ex + ez * ez;
      if (d2 < best) { best = d2; o.k = k; o.t = t; o.w = (ex * dz - ez * dx) / Math.sqrt(l2); } }
    o.d = Math.sqrt(best); return o; };
  const roadY = (o, w = o.w) => lerp(Y[o.k], Y[o.k + 1], o.t) - CROWN * Math.min((w / RW) ** 2, 2) - lerp(BANK[o.k], BANK[o.k + 1], o.t) * w;
  const surfY = (i, w) => Y[i] - CROWN * Math.min((w / RW) ** 2, 2) - BANK[i] * w; // (at a point of the line)
  // ---- tunnels and galleries: where the road runs under rock the ground above keeps its own shape (the tube itself is
  // the builder's); the hill is not cut down to the road there
  const tunnels = spans(cfg.tunnels, P, line.nComp), galleries = spans(cfg.galleries, P, line.nComp);
  // (the hill stands whole over the tube's full length, portal to portal — it ends at the headwalls, not on a slope through
  // the tube's mouth; the stage builder leaves the ground inside the tube's outline undrawn)
  const TUN = new Float32Array(N); for (const [a, b] of tunnels) for (let i = Math.max(0, a - 10); i <= Math.min(N - 1, b + 10); i++) TUN[i] = 1; // (from 4 m inside the portals: the step in the ground's grid falls in the tube, behind the headwall)
  const PT = { k: 0, t: 0, w: 0, d: 0 };
  // beside the road: in the woods a drainage ditch each side, then the forest floor; on a hillside the road is cut into
  // the slope — a steep bank with a gutter at its foot above it, a longer embankment of fill below — and the hill goes on
  const terrainHeight = (x, z) => { const base = line.land(x, z), o = project(x, z, PT); if (!o) return base;
    const tun = TUN[o.k] > 0 ? Math.max(TUN[o.k], TUN[o.k + 1]) : 0;
    // (under the opaque middle of the ribbon the ground is sunk 30 cm: a few centimetres there z-fought the road in bands on
    // a GPU with less depth precision, and caught the road's shadow as stripes; at the fading edge it stays just below)
    const d = o.d;
    let h;
    if (d <= ED) h = roadY(o) - 0.035 - 0.3 * (1 - smoothstep(0.7 * RW / 1.4, 1.25 * RW / 1.4, d));
    else { const edgeY = roadY(o, o.w < 0 ? -ED : ED) - 0.035, roadH = lerp(Y[o.k], Y[o.k + 1], o.t);
      // (ground rising above the road starts only past BANK0: a terrain triangle reaches 2.8 m, and one touching the road's
      // edge must not stand over it)
      if (cut) { const px = lerp(P[o.k][0], P[o.k + 1][0], o.t), pz = lerp(P[o.k][1], P[o.k + 1][1], o.t), natural = base + (roadH - line.land(px, pz)) * (1 - smoothstep(5, 14, d)), dh = natural - edgeY;
        const span = clamp(Math.abs(dh) * (dh > 0 ? 0.75 : 1.5), 1.4, 16), gutter = dh > 0.5 ? 0.28 * smoothstep(ED, ED + 0.7, d) * (1 - smoothstep(ED + 1.2, BANK0, d)) : 0;
        h = lerp(edgeY, natural, smoothstep(dh > 0 ? BANK0 : ED + 0.15, (dh > 0 ? BANK0 : ED) + span, d)) - gutter; }
      else { const far = lerp(base, roadH, 1 - smoothstep(10, FAR - 3, d)), dip = (cfg.ditch ?? 0.32) * smoothstep(ED + 0.25, ED + 1.2, d) * (1 - smoothstep(ED + 1.5, ED + 3.0, d));
        h = lerp(edgeY, far, smoothstep(far > edgeY ? BANK0 : ED + 1, ED + 8, d)) - dip; } }
    // (over a tunnel the rock stays whole: at least the tube's roof and a skin of rock over it, the natural hill where higher)
    if (tun > 0) { const roof = lerp(Y[o.k], Y[o.k + 1], o.t) + (cfg.tunnelH || 7.2) + 2.5; h = lerp(h, Math.max(base, roof, h), tun * (1 - smoothstep(RW + 12, RW + 30, d))); }
    return h; };
  const corners = findCorners(K, N, 14, finishAt), sites = crowdSites(P, T, K, N, left, corners, line.features, distAt, cfg, mulberry32(cfg.seed + 11), EX), piles = cut ? [] : logPiles(P, T, K, N, left, distAt, mulberry32(cfg.seed + 17), EX);
  const keepClear = (x, z, pad) => { for (const c of sites) if (Math.hypot(x - c.x, z - c.z) < c.r + pad) return true; for (const p of piles) if (Math.hypot(x - p.x, z - p.z) < 4 + pad) return true; return false; };
  const clearAt = (x, z) => { const ni = nearAt(x, z); if (mountain) return 9; return ni >= 0 && (ni < 58 || ni > N - 72) ? 7.4 : CLEAR; };
  return { cfg, D, line, P, Y, N, T, K, left, finishAt, DIST, NEAR, distAt, nearAt, woods, rng, mountain, asphalt, cut, CROWN, BANK, TUN, tunnels, galleries, project, roadY, surfY, terrainHeight, corners, sites, piles, keepClear, clearAt };
}
// stretches of the road given as fractions of the competitive distance ({f0, f1}) or by where they are ({at: [x, z],
// len}: centred on the station nearest that point, len metres long, and side for a gallery): [first, last, side] stations
export function spans(list, P, nComp) {
  return (list || []).map(t => { if (t.at) { let bi = 0, bd = 1e18; for (let i = 0; i < nComp; i++) { const d = (P[i][0] - t.at[0]) ** 2 + (P[i][1] - t.at[1]) ** 2; if (d < bd) { bd = d; bi = i; } }
    return [Math.max(0, Math.round(bi - t.len / 2)), Math.min(nComp - 1, Math.round(bi + t.len / 2)), t.side || 0]; }
    return [Math.round(t.f0 * nComp), Math.round(t.f1 * nComp), t.side || 0]; });
}

// ---------------------------------------------------------------- the ground and what grows on it
// the heights of the 1025² ground grid and the masks the terrain and the ecology read: forest, moisture, the shoulders,
// the stony ground, the no-grass band and the mown verge (yields every 32 rows)
export function* stageFields(G) {
  const { cfg, D, distAt, woods, clearAt, keepClear, terrainHeight } = G, { HN, CELL, HALF, SHOULDER } = D, eco = cfg.eco || {}, mountain = G.mountain;
  const H = new Float32Array(HN * HN);
  for (let j = 0; j < HN; j++) { const z = -HALF + j * CELL; for (let i = 0; i < HN; i++) H[j * HN + i] = terrainHeight(-HALF + i * CELL, z); if ((j & 31) === 0) yield ['Grading the ground', 0.18 + 0.06 * j / HN]; }
  const Hg = (i, j) => H[clamp(j, 0, HN - 1) * HN + clamp(i, 0, HN - 1)], gridNormalY = (i, j) => { const hx = Hg(i + 1, j) - Hg(i - 1, j), hz = Hg(i, j + 1) - Hg(i, j - 1); return 2 * CELL / Math.hypot(hx, 2 * CELL, hz); };
  const FOREST = new Float32Array(HN * HN), MOIST = new Float32Array(HN * HN), mask = new Uint8Array(HN * HN * 4), mask2 = new Uint8Array(HN * HN * 4);
  for (let j = 0; j < HN; j++) { for (let i = 0; i < HN; i++) { const x = -HALF + i * CELL, z = -HALF + j * CELL, o = j * HN + i, d = distAt(x, z), clear = clearAt(x, z);
    const forestBase = mountain || eco.woods ? Math.max(0, woods(x, z) - (eco.woods ?? 0.56)) * (eco.woods ? 1.6 : 0.5) : Math.max(cfg.forestMin, woods(x, z)), near = cfg.forestNear ?? clear + 0.35;
    const f = forestBase * smoothstep(near, near + 4.4, d) * (d < 40 && keepClear(x, z, 2) ? 0.25 : 1), moist = clamp(0.48 + 0.22 * Math.sin(x * 0.011 + z * 0.007) + 0.1 * Math.sin(z * 0.021), 0, 1); FOREST[o] = f; MOIST[o] = moist;
    mask[o * 4] = smoothstep(0.35, 0.8, f) * 235; mask[o * 4 + 1] = 255; mask[o * 4 + 3] = moist * 255;
    const rag = Math.sin(x * 0.37 + z * 0.23) * 0.5 + Math.sin(x * 0.11 - z * 0.29) * 0.5; // (a ragged verge, never a ruled line)
    // the shoulder (loose gravel, bare earth) and, on a stony stage, broken stone over the slopes: little soil, little grass
    const slope = 1 - gridNormalY(i, j), patch = 0.5 + 0.35 * Math.sin(x * 0.031 + z * 0.017 + Math.sin(z * 0.05)) + 0.25 * Math.sin(x * 0.083 - z * 0.061);
    const stony = (cfg.stony || 0) * clamp(smoothstep(0.1, 0.3, slope + (patch - 0.5) * 0.16) * 0.8 + smoothstep(0.78, 1.05, patch) * 0.5, 0, 1) * (1 - smoothstep(0.3, 0.7, f)) * (1 - smoothstep(0.32, 0.46, slope)); // (cliffs stay the rock layer's)
    mask2[o * 4] = Math.max(1 - smoothstep(SHOULDER - 0.1, SHOULDER + 0.5 + rag * 0.25, d), stony) * 255;
    mask2[o * 4 + 2] = (1 - smoothstep(SHOULDER + 0.05, SHOULDER + 0.55, d)) * 255;
    mask2[o * 4 + 3] = (1 - smoothstep(SHOULDER + 2.5, SHOULDER + 5.5 + rag, d)) * 255;   // a mown verge: short, sparse grass before the long grass
  } if ((j & 31) === 0) yield ['Grading the ground', 0.24 + 0.04 * j / HN]; }
  return { H, FOREST, MOIST, mask, mask2 };
}
// the whole preparation at once (the worker's: no yielding needed)
export function prepareSync(cfg) {
  const run = g => { for (;;) { const r = g.next(); if (r.done) return r.value; } };
  const G = run(stageGeometry(cfg)), F = run(stageFields(G));
  return { DIST: G.DIST, NEAR: G.NEAR, ...F };
}
