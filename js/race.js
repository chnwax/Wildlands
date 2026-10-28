// A race on a stage: the player's car against rivals that drive the very same simulation (car.js makeVehicle) — tyres,
// suspension, engine, gearbox, brakes, the body's contacts with the ground and the world — through a driver of their own
// that works the wheel, the pedals and the gearbox. Nothing is moved along the road by hand: a rival is where its physics
// has taken it.
// The driver (one per rival, its character from the stage's pool: rally4.js / races.js):
//  - the racing line: a minimum-curvature line over the road's width (out wide, the apex, out again), kept off the edges
//    by the car's width; and a speed plan along it — the fastest each bend allows at the car's grip on that surface
//    (with its downforce), what the engine can give, uphill and downhill, and the braking back from every bend (a
//    backward pass) within the friction circle
//  - steering by pure pursuit of a point ahead on the path it wants (the line, or a lane to pass or to cover), the point
//    further ahead the faster it goes; the pedals from the gap between its speed and the plan's, the throttle eased off
//    when the tyres slip
//  - traffic: it follows a car it cannot pass, a car-length or more behind; it passes where there is room — the side the
//    next bend makes the inside when it is bold enough to outbrake, else on the straight — holds its line alongside,
//    and comes back across only when it is clear; it covers the inside once against a car closing from behind; it reads
//    a car about to be where it is going and backs out of it; it takes a tow in the slipstream
//  - character: skill (how near the grip it plans), aggression (how soon it tries and how close it follows), braking
//    precision, corner speed, risk, consistency, the start; small mistakes now and then — braking late, running wide,
//    pushing too hard — that it gathers up, never random lurches
//  - recovery: back onto the road from the verge, out backwards when stuck against something, turned round when facing
//    the wrong way; only a car that has truly come to grief out of sight (off a drop, on its roof) is set back on the road
//    by the marshals
//  - effort by importance: the tactics are thought over ten times a second, the wheels and brake lights drawn only for
//    cars near enough to see, the engine heard only within earshot
// The cars meet as boxes (their footprints, turned with them): overlapping, they are pushed apart by an impulse along the
// axis they overlap least on, at the point between them, each body taking it in its own physics. A hard hit is an
// impact frame: the world holds still for a moment, the picture flashes stark, the camera shakes, sparks fly.
// The order is by distance down the stage; results are taken as each car crosses the line.
import { THREE, scene, camera, clamp, lerp, fx } from './core.js';
import { CAR_DEFS, createRivalCar } from './car.js';
import { Emitter } from './audio.js';

const G = 9.81, UP = new THREE.Vector3(0, 1, 0);
const DRIVER0 = { aggr: 0.5, line: 0.7, def: 0.5, err: 0.3, cons: 0.3, react: 0.3, brk: 0.5, corner: 0.5, risk: 0.5, skill: 0.95 };
// the tyres' grip by surface and car, as the simulation has it (car.js SURF and each car's feel), and how much of it a
// driver plans to use: the simulation's stability help and load transfer leave a little short of the peak
const SURF_MU = { asphalt: 1.52, concrete: 1.48, gravel: 1.12, snow: 0.72 };
const PLAN_USE = 0.8, BRAKE_USE = 0.78;
// the most sideways pull a car is planned for, whatever its tyres: the simulation's stability help holds the yaw to what
// the wheels' own geometry asks within about 1.1 g (car.js: lim = 11 / speed), so a plan past it would run wide
const A_LAT = 9.8;
// (on loose ground the tyres let go more gently and the stability help lets the car slide more: a driver leaves more margin)
const LOOSE_USE = 0.84;
const muOf = (spec, surface) => { const loose = surface === 'gravel' || surface === 'snow', t = spec.feel && spec.feel.tyre || {}; return (SURF_MU[surface] || 1.3) * (loose ? t.loose ?? 1 : t.tarmac ?? 1); };
const peakPower = spec => { let p = 0; for (const [rpm, tq] of spec.engine.curve) if (rpm <= spec.engine.limiter) p = Math.max(p, tq * rpm * 2 * Math.PI / 60); return p * spec.eff; };

// ---------------------------------------------------------------- the racing line
// lateral offsets w (left positive) over the road, relaxed toward the straightest path between neighbours a stride
// apart (long strides first, then shorter: the shape of each bend, then its detail), each kept within lim of the centre
export function racingLine(P, T, N, lim) {
  const w = new Float32Array(N), L = i => [T[i][1], -T[i][0]];
  if (lim <= 0.05) return w;
  const LX = new Float32Array(N), LZ = new Float32Array(N); for (let i = 0; i < N; i++) { const [lx, lz] = L(i); LX[i] = lx; LZ[i] = lz; }
  for (const [k, n] of [[60, 50], [36, 50], [22, 50], [12, 60], [6, 60], [3, 40]]) for (let it = 0; it < n; it++) for (let i = k; i < N - k; i++) {
    const a = i - k, b = i + k, mx = (P[a][0] + LX[a] * w[a] + P[b][0] + LX[b] * w[b]) / 2, mz = (P[a][1] + LZ[a] * w[a] + P[b][1] + LZ[b] * w[b]) / 2;
    const wt = (mx - P[i][0]) * LX[i] + (mz - P[i][1]) * LZ[i]; w[i] = clamp(w[i] + 0.6 * (wt - w[i]), -lim, lim); }
  // (eased in from the centre at the start and back to it at the end of the road)
  for (let i = 0; i < Math.min(40, N); i++) { const e = i / 40; w[i] *= e * e; w[N - 1 - i] *= e * e; }
  return w;
}
// signed curvature (left positive) of a path given by points, over ±h stations
function curvature(X, Z, N, h) {
  const K = new Float32Array(N);
  for (let i = 0; i < N; i++) { const a = Math.max(0, i - h), b = Math.min(N - 1, i + h); if (b - a < 2) continue;
    const ax = X[a], az = Z[a], bx = X[i], bz = Z[i], cx = X[b], cz = Z[b], ab = Math.hypot(bx - ax, bz - az), bc = Math.hypot(cx - bx, cz - bz), ca = Math.hypot(ax - cx, az - cz);
    const cr = (bx - ax) * (cz - az) - (bz - az) * (cx - ax); K[i] = ab * bc * ca < 1e-9 ? 0 : -2 * cr / (ab * bc * ca); }
  return K;
}
// the speed plan along a path: v[i] (m/s) for a car (spec) on a surface, at a share of its grip
function speedPlan({ K, KV, slope, ds, N, spec, mu, use, brakeUse, top, alat }) {
  const m = spec.mass, kdf = 0.5 * 1.225 * spec.aero.cla / m, kd = 0.5 * 1.225 * spec.aero.cda / m, P = peakPower(spec), rwd = spec.drive === 'rwd';
  const muU = mu * use, v = new Float32Array(N);
  for (let i = 0; i < N; i++) { const k = Math.abs(K[i]); v[i] = Math.min(top, Math.sqrt(muU * G / Math.max(k - muU * kdf, 1e-5)), Math.sqrt(alat / Math.max(k, 1e-5)));
    // (over a crest: no faster than lets the tyres keep the road, give or take a little float — a car in the air neither
    // brakes nor steers)
    if (KV && KV[i] > 1e-4) v[i] = Math.min(v[i], Math.sqrt(1.3 * G / KV[i])); }
  // (forward: what the engine and the driven tyres can give, less the air and the climb, within the grip left by the bend)
  for (let i = 1; i < N; i++) { const u = v[i - 1], lat = u * u * Math.abs(K[i - 1]), grip = (muU * (G + kdf * u * u)) ** 2 - lat * lat, tr = Math.sqrt(Math.max(0, grip)) * (rwd ? 0.62 : 0.92);
    const a = Math.min(tr, P / (m * Math.max(u, 4))) - kd * u * u - G * slope[i - 1]; v[i] = Math.min(v[i], Math.sqrt(Math.max(0, u * u + 2 * Math.max(a, 0.05) * ds[i - 1]))); }
  // (backward: the braking each bend needs, started in time, the downhill braking weaker)
  const muB = mu * brakeUse;
  for (let i = N - 2; i >= 0; i--) { const u = v[i + 1], lat = u * u * Math.abs(K[i + 1]), grip = (muB * (G + kdf * u * u)) ** 2 - lat * lat;
    const a = Math.sqrt(Math.max(0, grip)) + kd * u * u + G * slope[i]; v[i] = Math.min(v[i], Math.sqrt(u * u + 2 * Math.max(a, 1.5) * ds[i])); }
  return v;
}

export async function createRace(world, { rivals, grid, startI, finishI, lanes, RW, clock }) {
  const { P, T, N } = world.track, Y = world.track.Y, surface = world.stage.roadType || 'asphalt';
  const LX = Float32Array.from(T, t => t[1]), LZ = Float32Array.from(T, t => -t[0]);
  // ---- the cars, each on its simulation; a driver for each
  const made = await Promise.all(rivals.map(r => createRivalCar(world, r.car, { paint: r.paint, tint: r.tint, name: r.name }).catch(e => { console.warn('rival ' + r.name + ': ' + e.message); return null; })));
  // (the path data shared by the cars of a type: the line kept off the edges by the widest of them)
  const halfW = Math.max(...made.filter(Boolean).map(c => c.spec.dims[0] / 2), 1);
  const lim = Math.max(0, RW - halfW - 0.35), lineW = racingLine(P, T, N, lim), looseK = surface === 'gravel' || surface === 'snow' ? LOOSE_USE : 1;
  const LXp = new Float32Array(N), LZp = new Float32Array(N); for (let i = 0; i < N; i++) { LXp[i] = P[i][0] + LX[i] * lineW[i]; LZp[i] = P[i][1] + LZ[i] * lineW[i]; }
  const KL = curvature(LXp, LZp, N, 7), KC = curvature(Float32Array.from(P, p => p[0]), Float32Array.from(P, p => p[1]), N, 7);
  const ds = new Float32Array(N), slope = new Float32Array(N);
  for (let i = 0; i < N - 1; i++) { ds[i] = Math.max(0.3, Math.hypot(LXp[i + 1] - LXp[i], LZp[i + 1] - LZp[i])); slope[i] = Y ? clamp((Y[Math.min(N - 1, i + 3)] - Y[Math.max(0, i - 3)]) / 6, -0.3, 0.3) : 0; }
  ds[N - 1] = 1;
  // (the road's vertical curvature, + over a crest: from the heights, smoothed over a car's length and more)
  const KV = new Float32Array(N); if (Y) for (let i = 6; i < N - 6; i++) KV[i] = -(Y[i + 6] - 2 * Y[i] + Y[i - 6]) / 36;
  for (let pass = 0; pass < 2; pass++) for (let i = 1; i < N - 1; i++) KV[i] = Math.max(KV[i], (KV[i - 1] + KV[i + 1]) / 2 * 0.9);
  const plans = new Map(); // (by car type and grip share: one plan serves every driver alike)
  const planFor = (spec, use, brk) => { const key = spec.mass + ':' + use.toFixed(3) + ':' + brk.toFixed(3); if (!plans.has(key)) plans.set(key, speedPlan({ K: KL, KV, slope, ds, N, spec, mu: muOf(spec, surface), use, brakeUse: brk, top: 90, alat: Math.min(A_LAT * use / PLAN_USE, muOf(spec, surface) * use * G * 1.05) })); return plans.get(key); };
  const cars = [];
  for (const [k, r] of rivals.entries()) { const car = made[k]; if (!car) continue;
    const d = { ...DRIVER0, ...r };
    const voice = new Emitter('racecar'); voice.on = true;
    cars.push({ ...d, car, veh: car.veh, st: car.st, voice, grid: grid[k], len: car.spec.dims[2], wid: car.spec.dims[0], s: grid[k].s, w: grid[k].w, v: 0, done: 0,
      ph: Math.random() * 6.28, mode: 'line', offT: 0, mix: 0, side: 0, followT: 0, defT: 0, defCool: 0, mk: null, mkT: 0, mkCool: 6 + Math.random() * 8, stuckT: 0, revT: 0, revSteer: 0, lost: 0, resets: 0,
      think: Math.random() * 0.1, steer: 0, cap: 1e9, avoid: 0, lastS: grid[k].s, offT0: 0 }); }
  const prep = c => { // (each race a driver is a touch quicker or slower than the last, and starts as sharply as that day goes)
    c.skill = c.skill0 ?? (c.skill0 = c.skill ?? 0.95); c.today = c.skill0 * (0.99 + Math.random() * 0.02);
    const use = PLAN_USE * clamp(0.9 + 0.1 * c.today + 0.03 * (c.corner - 0.5) + 0.02 * (c.risk - 0.5), 0.86, 1.03), brk = BRAKE_USE * clamp(0.93 + 0.08 * c.brk + 0.03 * (c.risk - 0.5), 0.85, 1.02);
    c.plan = planFor(c.car.spec, use * looseK, brk * looseK); c.alat = Math.min(A_LAT * use / PLAN_USE, muOf(c.car.spec, surface) * use * G * 1.05) * looseK; c.react0 = 0.12 + c.react * (0.45 + 0.6 * Math.random()); c.bogged = Math.random() < 0.08; };
  for (const c of cars) prep(c);

  // ---- where things are on the road
  const proj = (x, z, hint, out) => { let i = world.track.nearAt(x, z); if (i < 0) { if (hint === undefined || hint === null) return null; i = clamp(Math.round(hint), 0, N - 1); }
    // (refined along the line: the distance field's nearest station is the nearest centre point within its 2 m cell)
    let best = 1e18, bi = i; for (let k = Math.max(0, i - 4); k <= Math.min(N - 1, i + 4); k++) { const dx = x - P[k][0], dz = z - P[k][1], d = dx * dx + dz * dz; if (d < best) { best = d; bi = k; } }
    const dx = x - P[bi][0], dz = z - P[bi][1]; out.s = clamp(bi + dx * T[bi][0] + dz * T[bi][1], 0, N - 1); out.w = dx * LX[bi] + dz * LZ[bi]; out.off = Math.sqrt(best); return out; };
  const at = (arr, s) => { const i = clamp(Math.floor(s), 0, N - 2), f = clamp(s - i, 0, 1); return arr[i] + (arr[i + 1] - arr[i]) * f; };
  const pointAt = (s, w, out) => { const i = clamp(Math.floor(s), 0, N - 2), f = clamp(s - i, 0, 1);
    out.x = lerp(P[i][0], P[i + 1][0], f) + lerp(LX[i], LX[i + 1], f) * w; out.z = lerp(P[i][1], P[i + 1][1], f) + lerp(LZ[i], LZ[i + 1], f) * w; return out; };
  const minAhead = (arr, s, d) => { let m = 1e9; const a = Math.max(0, Math.floor(s)), b = Math.min(N - 1, Math.ceil(s + d)); for (let i = a; i <= b; i++) m = Math.min(m, arr[i]); return m; };
  const straightAhead = (s, d) => { let m = 0; for (let i = Math.max(0, Math.floor(s)), e = Math.min(N - 1, Math.floor(s + d)); i <= e; i += 3) m = Math.max(m, Math.abs(KC[i])); return m < 1 / 400; };

  // ---- the feed: what the race calls out, a few lines under the order, each for a few seconds
  const feed = [], say = (t, k = 'info') => { if (feed.length && feed[feed.length - 1].t === t) return; feed.push({ t, k, at: performance.now() }); if (feed.length > 4) feed.shift(); };

  // ---- the grid: every car held on its slot until the start
  const gridPose = (g, out) => { pointAt(g.s, g.w, out); const i = clamp(Math.round(g.s), 0, N - 1); out.yaw = Math.atan2(T[i][0], T[i][1]); return out; };
  const GP = {};
  const holdOnGrid = c => { gridPose(c.grid, GP); c.car.place(GP.x, GP.z, GP.yaw); c.st.throttle = 0; c.st.brake = 1; c.st.steer = 0; c.st.gear = 2; c.s = c.grid.s; c.w = c.grid.w; c.lastS = c.s; };
  let onFoot = true, raceT = 0;
  const results = [];
  const reset = () => { // (the same grid, the drivers in their places shuffled)
    const g = cars.map(c => c.grid); for (let i = g.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [g[i], g[j]] = [g[j], g[i]]; }
    cars.forEach((c, k) => { c.grid = g[k]; Object.assign(c, { done: 0, mode: 'line', offT: 0, mix: 0, side: 0, followT: 0, defT: 0, defCool: 0, mk: null, mkT: 0, mkCool: 6 + Math.random() * 8, stuckT: 0, revT: 0, lost: 0, cap: 1e9, avoid: 0 }); prep(c); holdOnGrid(c); c.car.sync(0, true); });
    results.length = 0; feed.length = 0; order = null; };

  // ---- the driver: tactics ten times a second
  const meP = { s: 0, w: 0, off: 0 }, meRef = { s: 0, w: 0, v: 0, wv: 0, len: 4.4, wid: 2, name: 'Ty', me: true };
  const others = [];
  const tactics = (c, me, meV, tR) => {
    others.length = 0;
    for (const o of cars) if (o !== c) others.push(o);
    if (me && c !== auto) others.push(meRef);
    const lineHere = at(lineW, c.s), myW = lerp(lineHere, c.offT, c.mix), need = (wo, wid) => (c.wid + wid) / 2 + 0.7;
    // (the nearest car ahead in its way, and how close behind the nearest is)
    let ahead = null, gap = 1e9, behind = null, gapB = 1e9;
    for (const o of others) { const d = o.s - c.s; if (d > 0 && d < 60 && Math.abs(o.w - myW) < need(o.w, o.wid) && d < gap) { gap = d; ahead = o; }
      if (d < 0 && d > -18 && -d < gapB) { gapB = -d; behind = o; } }
    c.cap = 1e9; c.ahead = ahead; c.gap = gap;
    const edge = RW - c.wid / 2 - 0.2, myPlan = at(c.plan, c.s + 30);
    if (c.mode === 'pass') { // (alongside or moving out: hold the side until clear ahead of the car being passed)
      const o = c.target, d = o ? o.s - c.s : -99;
      if (!o || d < -(c.len + 3.5) || d > 40) { c.mode = 'merge'; c.target = null; }
      else if (d > c.len * 0.5 && Math.sign(at(KC, c.s + 35)) === -c.side && Math.abs(at(KC, c.s + 35)) > 1 / 200) { c.mode = 'merge'; c.target = null; c.cap = o.v - 0.5; } // (a bend coming the wrong way before it is alongside: it tucks back in)
      else if (d > -c.len * 0.3 && Math.sign(at(KC, c.s + 20)) === -c.side && Math.abs(at(KC, c.s + 20)) > 1 / 160) { c.cap = o.v - 1.2; c.offT = clamp(o.w + c.side * need(o.w, o.wid), -edge, edge); c.mix = 1; } // (alongside round the outside: it lifts and tucks in behind)
      else { const wantW = clamp(o.w + c.side * need(o.w, o.wid), -edge, edge); c.offT = wantW; c.mix = 1;
        // (no room left on that side — squeezed, or the road narrows: back out of it and follow)
        if (Math.abs(wantW - (o.w + c.side * need(o.w, o.wid))) > 0.35 && d > 0) { c.mode = 'line'; c.cap = o.v - 0.5; } } }
    if (c.mode === 'merge') { // (back to the line once nothing is beside it on the way across)
      const clear = others.every(o => Math.abs(o.s - c.s) > c.len + 2.5 || Math.abs(o.w - lineHere) > need(o.w, o.wid) + 0.2 || o.s > c.s + c.len + 2.5);
      if (clear) { c.mix = Math.max(0, c.mix - 0.12); if (c.mix <= 0.01) { c.mode = 'line'; c.mix = 0; } } }
    if (c.mode === 'line' && ahead) {
      const closing = c.v - ahead.v, slower = ahead.v < myPlan - 1.5 || closing > 0.8;
      if (slower && gap < 26 + 14 * c.aggr) c.followT += 0.1; else c.followT = Math.max(0, c.followT - 0.05);
      // (where to pass: the inside of the bend ahead for a bold driver on the brakes, the side with room otherwise)
      const kAhead = at(KC, c.s + clamp(gap + 25, 20, 70)), inside = Math.sign(kAhead) || 0;
      const roomL = edge - (ahead.w + need(ahead.w, ahead.wid)), roomR = (ahead.w - need(ahead.w, ahead.wid)) + edge;
      let side = 0; const bendy = Math.abs(kAhead) > 1 / 300;
      if (bendy) { if ((inside > 0 ? roomL : roomR) > -0.05 && (c.aggr > 0.55 || straightAhead(c.s, 50))) side = inside; } // (never round the outside of a bend)
      else if (roomL > -0.05 || roomR > -0.05) side = roomL > roomR ? 1 : -1;
      const ready = c.followT > 2.6 * (1.1 - c.aggr) && gap < 18 + 10 * c.aggr && (straightAhead(c.s, 70) || c.aggr > 0.7 || Math.abs(kAhead) > 1 / 120);
      if (side && ready && slower) { const wantW = ahead.w + side * need(ahead.w, ahead.wid);
        const blocked = others.some(o => o !== ahead && o.s - c.s > -c.len - 4 && o.s - c.s < gap + 8 && Math.abs(o.w - wantW) < need(o.w, o.wid));
        if (!blocked) { c.mode = 'pass'; c.side = side; c.target = ahead; c.followT = 0; if (ahead.v > 15) say(c.name + ' atakuje ' + (ahead.me ? 'ciebie' : ahead.name)); } }
      // (following: a gap that grows with its speed and shrinks with its boldness; closing up at a crawl when the car
      // ahead stands — on the grid, or stopped on the road — never into it)
      if (c.mode === 'line') { const want = 4 + c.len + 7 * (1 - c.aggr) + c.v * (0.22 - 0.1 * c.aggr); c.cap = Math.max(ahead.v + (gap - want) * 0.55, Math.min(ahead.v + 4, (gap - (c.len + ahead.len) / 2 - 1.6) * 0.9)); }
    }
    // (defending: a car closing from behind on one side before a braking zone — it covers that side, once)
    c.defCool -= 0.1; c.defT -= 0.1;
    if (behind && c.mode === 'line' && c.defCool <= 0 && gapB < 12 && behind.v > c.v + 0.8 && Math.abs(behind.w - myW) > 1.0 && Math.random() < 0.35 * c.def && !straightAhead(c.s, 120)) {
      c.defT = 2.2; c.defCool = 9; c.defW = clamp(myW + Math.sign(behind.w - myW) * 1.1, -edge, edge); say(c.name + ' broni pozycji'); }
    if (c.defT > 0 && c.mode === 'line') { c.offT = c.defW; c.mix = Math.min(1, c.mix + 0.25); }
    else if (c.mode === 'line' && c.defT <= 0) c.mix = Math.max(0, c.mix - 0.1);
    // (a car about to be where it is going: predicted half a second and a second on, it backs out of it)
    c.avoid = 0;
    const myGoal = lerp(lineHere, c.offT, c.mix);
    for (const o of others) { const d0 = o.s - c.s; if (Math.abs(d0) > 25) continue;
      for (const t of [0.4, 0.9]) { const dS = d0 + (o.v - c.v) * t, dW = (o.w + (o.wv || 0) * t) - lerp(c.w, myGoal, t / 0.9), lens = (c.len + o.len) / 2;
        if (dS > 0 && dS < lens + 1.2 && Math.abs(dW) < (c.wid + o.wid) / 2 + 0.25 && c.v > o.v - 0.3) { c.cap = Math.min(c.cap, Math.max(o.v - 1.5, d0 > lens + 0.5 ? 1.5 : 0)); c.avoid = Math.max(c.avoid, (1 - t / 1.4) * clamp((c.v - o.v) / 4, 0, 1)); break; }
        if (Math.abs(dS) < (c.len + o.len) / 2 && Math.abs(dW) < (c.wid + o.wid) / 2 + 0.6 && Math.abs(dW) > 0.2) { c.offT = clamp(c.w - Math.sign(dW) * 0.8, -edge, edge); c.mix = Math.max(c.mix, 0.7); } } }
    // (mistakes: in a bend now and then, a driver's own — braking late, running wide, pushing too hard)
    c.mkCool -= 0.1;
    if (!c.mk && c.mkCool <= 0 && tR > 6) { const kSoon = Math.abs(at(KC, c.s + 40));
      if (kSoon > 1 / 90 && Math.random() < c.err * 0.05 * (0.6 + c.risk)) { const r = Math.random(); c.mk = r < 0.4 ? 'late' : r < 0.75 ? 'wide' : 'push'; c.mkT = c.mk === 'wide' ? 2.5 : 2.0; c.mkSide = -Math.sign(at(KC, c.s + 40)) || 1;
        if (c.mk === 'wide' && c.v > 12) say(c.name + ' wyjeżdża szeroko', 'bad'); else if (c.mk === 'late' && c.v > 15) say(c.name + ' hamuje za późno', 'bad'); } }
    if (c.mk) { c.mkT -= 0.1; if (c.mkT <= 0) { c.mk = null; c.mkCool = 10 + Math.random() * 18 * (1.2 - c.err); } }
  };

  // ---- the driver: the wheel and the pedals every frame
  const PT = {}, Q = new THREE.Quaternion(), V = new THREE.Vector3(), FW = new THREE.Vector3();
  const drive = (c, dt, tR) => {
    const st = c.st, spec = c.car.spec, v = Math.max(0, st.velLocal.z), wb = c.car.wheels[0].hub.z - c.car.wheels[2].hub.z;
    FW.set(0, 0, 1).applyQuaternion(st.q); const headDot = FW.x * T[clamp(Math.round(c.s), 0, N - 1)][0] + FW.z * T[clamp(Math.round(c.s), 0, N - 1)][1];
    // (lost: off the road, the wrong way round, or stuck against something)
    const offRoad = Math.abs(c.w) > RW + 0.6, wrongWay = headDot < -0.2 && v < 8;
    // (stuck: no headway down the road for a while — creeping round a car counts as headway, pinned against a wall does not)
    if (tR > c.react0 + 3 && !c.done && st.velLocal.length() < 2.5) { c.stuckT += dt; if (c.s > (c.stuckS ?? -1e9) + 1.2 || st.velLocal.length() > 1.6 && Math.abs(st.steer) < 0.6) { c.stuckS = c.s; c.stuckT = Math.max(0, c.stuckT - 0.6); } }
    else { c.stuckT = Math.max(0, c.stuckT - dt * 2); c.stuckS = c.s; }
    if (c.revT <= 0 && (c.stuckT > 2.2 || wrongWay && c.stuckT > 0.8)) { c.revT = 1.4 + Math.random() * 0.6; c.stuckT = 0; c.lost++;
      // (backing out turns the nose toward the road: the wheel the other way to where the road is)
      const toRoad = Math.sign(c.w) || 1; c.revSteer = -toRoad * Math.sign(headDot || 1); }
    if (c.revT > 0) { c.revT -= dt; if (st.gear !== 0) { st.gear = 0; st.shiftT = 0.15; if (c.veh === null) c.car.selectGear(0); }
      st.steer = lerp(st.steer, c.revSteer, 1 - Math.exp(-dt * 6)); st.throttle = 0.55; st.brake = 0; st.hand = 0;
      if (c.revT <= 0) { st.gear = 2; st.shiftT = 0.15; if (c.veh === null) c.car.selectGear(2); } return; }
    if (st.gear === 0) { st.gear = 2; st.shiftT = 0.15; if (c.veh === null) c.car.selectGear(2); }
    // (the path it wants: the line, or the lane it has chosen, eased between; off the road, the nearest way back on)
    const edge = RW - c.wid / 2 - 0.2;
    let look = clamp(4.5 + v * 0.42, 6, 34); if (Math.abs(at(KC, c.s + look * 0.5)) > 1 / 30) look *= 0.75;
    const sT = Math.min(N - 2, c.s + look);
    // (the lane it wants, crossed at a driver's pace: never a jump of the point it steers for)
    const latV = 1.6 + 1.2 * c.aggr; c.offS = c.offS === undefined ? c.offT : c.offS + clamp(c.offT - c.offS, -latV * dt, latV * dt); c.mixS = c.mixS === undefined ? c.mix : c.mixS + clamp(c.mix - c.mixS, -0.9 * dt, 0.9 * dt);
    let wT = lerp(at(lineW, sT), c.offS, c.mixS);
    if (c.mk === 'wide') wT = lerp(wT, c.mkSide * edge, 0.7);
    if (offRoad) wT = clamp(c.w * 0.3, -edge * 0.7, edge * 0.7);
    if (c.done) wT = (c.grid.w > 0 ? 1 : -1) * edge * 0.8;
    pointAt(sT, wT, PT);
    // (pure pursuit: the arc from where the car is through that point; its steering angle from the wheelbase)
    Q.copy(st.q).invert(); V.set(PT.x - st.pos.x, 0, PT.z - st.pos.z).applyQuaternion(Q);
    const x = V.x, z = Math.max(0.5, V.z), kap = 2 * x / (x * x + z * z), delta = Math.atan(kap * wb);
    // (a slide caught: the body's slip angle steered into)
    const beta = Math.atan2(st.velLocal.x, Math.max(v, 3));
    let steer = clamp((delta + beta * 0.55) / spec.steerMax, -1, 1);
    const rate = 4.2 + 2 * c.line; c.steer += clamp(steer - c.steer, -rate * dt, rate * dt); st.steer = c.steer * (1 + (Math.random() - 0.5) * 0.02 * c.cons);
    if (c.veh === null) st.steer = c.car.handsSteer(c.steer, dt); // (the player's car: its hands turn the wheel and work the lever)
    // (the speed: the plan a little ahead — braking in time for what is coming — its pace today, the traffic's limit)
    const lead = Math.max(2, v * (c.mk === 'late' ? -0.25 : 0.32)) * (1.15 - 0.3 * c.brk);
    let vT = Math.min(at(c.plan, c.s + lead), minAhead(c.plan, c.s, Math.max(4, v * 0.18)));
    const form = 1 + 0.018 * c.cons * Math.sin(tR * 0.27 + c.ph) * Math.sin(tR * 0.11 + c.ph * 1.7);
    vT *= c.today / c.skill0 * form * (c.mk === 'push' ? 1.05 : 1);
    vT = Math.min(vT, c.cap);
    // (off the line — passing, covering, out wide — the bend there is tighter or wider than the line's: its own limit)
    if (c.mixS > 0.05 || offRoad) { const k = at(KC, c.s + look * 0.4), kp = k / Math.max(0.3, 1 - k * wT); vT = Math.min(vT, Math.sqrt(c.alat / Math.max(Math.abs(kp), 1e-5)) * 0.97); }
    if (offRoad) vT = Math.min(vT, Math.max(14 + 4 * c.risk, v - 6));
    if (c.done) vT = Math.max(0, Math.min(vT, 30 - (c.s - finishI) * 0.16));
    if (tR < c.react0) vT = 0;
    // (the pedals: throttle to close a gap below the plan, brakes past it; eased off when the tyres slip)
    const e = vT - v;
    let thr = 0, brk = 0;
    if (e > 0.4) thr = clamp(0.35 + e * 0.35, 0, 1); else if (e > -0.9) thr = clamp(0.18 + e * 0.25, 0, 0.5); else brk = clamp(0.2 - e * 0.22, 0, 1);
    if (c.avoid > 0) { thr *= 1 - c.avoid; brk = Math.max(brk, c.avoid * 0.6); }
    if (offRoad || Math.abs(c.w) > RW) brk = Math.min(brk, 0.35); // (on the verge: lifted and eased back on, never a locked slide across the grass)
    // (wheelspin: the driven wheels turning well past the road's speed — the throttle eased off; the steered fronts'
    // slip angles at a crawl are no reason to lift)
    if (thr > 0.2 && v > 4) { let spin = 0; const rwd = spec.drive === 'rwd'; for (const w of c.car.wheels) if (w.contact && (!rwd || !w.front)) spin = Math.max(spin, (w.w * w.R - w.vx) / Math.max(Math.abs(w.vx), 3)); if (spin > 0.18) thr *= clamp(1 - (spin - 0.18) * 3, 0.35, 1); }
    if (c.bogged && tR < c.react0 + 1.2) thr *= 0.55;
    if (tR < c.react0) { thr = 0; brk = 1; }
    st.throttle = lerp(st.throttle, thr, 1 - Math.exp(-dt * 14)); st.brake = lerp(st.brake, brk, 1 - Math.exp(-dt * 18)); st.hand = 0;
    if (c.veh) c.veh.gearbox(dt);
  };

  // ---- a car that has come to grief out of sight: set back on the road by the marshals, behind where it left it
  const frustum = new THREE.Frustum(), pv = new THREE.Matrix4(), sph = new THREE.Sphere();
  const seen = c => { sph.center.copy(c.st.pos); sph.radius = 3; return frustum.intersectsSphere(sph) && camera.position.distanceTo(c.st.pos) < 150; };
  const rescue = (c, dt) => {
    const up = V.set(0, 1, 0).applyQuaternion(c.st.q).y, far = Math.abs(c.w) > RW + 12 || c.off > RW + 12;
    c.grief = (up < 0.35 || far || c.lost > 2 || (Math.abs(c.w) > RW + 1.5 && c.stuckT > 1)) && !c.done ? (c.grief || 0) + dt : 0;
    if (c.grief > 3.5 && !seen(c)) { const s = clamp(c.lastGood ?? c.s - 20, startI, finishI - 5); pointAt(s, at(lineW, s), PT);
      const i = clamp(Math.round(s), 0, N - 1); c.car.place(PT.x, PT.z, Math.atan2(T[i][0], T[i][1])); c.grief = 0; c.lost = 0; c.resets++; c.revT = 0; c.stuckT = 0; c.s = s; c.w = at(lineW, s); } };

  // ---- contact: two boxes on the ground (centre, heading, half width and length): do they overlap, and if so the axis
  // they overlap least on (from the first to the second), how far, and the point between them
  const sat = (a, b) => {
    const dx = b.x - a.x, dz = b.z - a.z, ax = [[a.fx, a.fz], [a.fz, -a.fx], [b.fx, b.fz], [b.fz, -b.fx]]; let best = 1e9, nx = 0, nz = 0;
    for (const [ux, uz] of ax) { const ra = a.hz * Math.abs(ux * a.fx + uz * a.fz) + a.hx * Math.abs(ux * a.fz - uz * a.fx), rb = b.hz * Math.abs(ux * b.fx + uz * b.fz) + b.hx * Math.abs(ux * b.fz - uz * b.fx);
      const d = dx * ux + dz * uz, o = ra + rb - Math.abs(d); if (o <= 0) return null; if (o < best) { best = o; const sg = d < 0 ? -1 : 1; nx = ux * sg; nz = uz * sg; } }
    let px = 0, pz = 0, k = 0; const inside = (o, x, z) => { const ex = x - o.x, ez = z - o.z; return Math.abs(ex * o.fx + ez * o.fz) <= o.hz && Math.abs(ex * o.fz - ez * o.fx) <= o.hx; };
    for (const [o, p] of [[a, b], [b, a]]) for (const sf of [-1, 1]) for (const sl of [-1, 1]) { const x = o.x + o.fx * o.hz * sf + o.fz * o.hx * sl, z = o.z + o.fz * o.hz * sf - o.fx * o.hx * sl; if (inside(p, x, z)) { px += x; pz += z; k++; } }
    if (k) { px /= k; pz /= k; } else { px = (a.x + b.x) / 2; pz = (a.z + b.z) / 2; }
    return { nx, nz, d: best, px, pz }; };
  // a body for the contacts: the player's car or a rival's, each with its simulation's state and its way of taking a blow
  const bodyOf = (st, spec, I, hit) => { const f = new THREE.Vector3(0, 0, 1).applyQuaternion(st.q), cg = spec.cg, o = new THREE.Vector3(-cg[0], 0, -cg[2]).applyQuaternion(st.q).add(st.pos), l = Math.hypot(f.x, f.z) || 1;
    return { st, m: spec.mass, I, hit, x: o.x, z: o.z, fx: f.x / l, fz: f.z / l, hx: spec.dims[0] / 2, hz: spec.dims[2] / 2 }; };
  // sparks: a pool of points thrown from the contact, falling and dimming
  const SP = 240, spPos = new Float32Array(SP * 3), spVel = new Float32Array(SP * 3), spLife = new Float32Array(SP), spCol = new Float32Array(SP * 3); let spNext = 0;
  const spGeo = new THREE.BufferGeometry(); spGeo.setAttribute('position', new THREE.BufferAttribute(spPos, 3)); spGeo.setAttribute('color', new THREE.BufferAttribute(spCol, 3));
  const sparks = new THREE.Points(spGeo, new THREE.PointsMaterial({ size: 0.07, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  sparks.frustumCulled = false; sparks.name = 'race-sparks'; sparks.userData.dynamic = true; scene.add(sparks); sparks.updateMatrixWorld(true);
  const spark = (x, y, z, nx, nz, vx, vz, count) => { for (let i = 0; i < count; i++) { const k = spNext = (spNext + 1) % SP, sp = 2 + Math.random() * 7, a = (Math.random() - 0.5) * 2.4, c = Math.cos(a), s = Math.sin(a);
      spPos.set([x, y + 0.2 + Math.random() * 0.4, z], k * 3); spVel.set([vx * 0.8 + (nx * c - nz * s) * sp, 1 + Math.random() * 4, vz * 0.8 + (nz * c + nx * s) * sp], k * 3); spLife[k] = 0.25 + Math.random() * 0.5; } };
  const sparksUpdate = dt => { let any = false; for (let k = 0; k < SP; k++) { if (spLife[k] <= 0) { spCol[k * 3] = spCol[k * 3 + 1] = spCol[k * 3 + 2] = 0; continue; } any = true; spLife[k] -= dt;
      spVel[k * 3 + 1] -= 9.8 * dt; for (let j = 0; j < 3; j++) spPos[k * 3 + j] += spVel[k * 3 + j] * dt; const f = Math.max(0, Math.min(1, spLife[k] * 3));
      spCol[k * 3] = 2.6 * f; spCol[k * 3 + 1] = 1.5 * f * f; spCol[k * 3 + 2] = 0.4 * f * f * f; }
    sparks.visible = any; if (any) { spGeo.attributes.position.needsUpdate = true; spGeo.attributes.color.needsUpdate = true; } };
  const _J = new THREE.Vector3(), _at = new THREE.Vector3();
  const contacts = player => {
    const bodies = cars.map(c => bodyOf(c.st, c.car.spec, c.veh.Ib.y, (J, p) => c.veh.impulse(J, p)));
    if (player && player.driving) bodies.push(bodyOf(player.st, player.spec, player.inertia.y, (J, p, k) => player.impact(J, p, k)));
    const now = performance.now() / 1000;
    for (let a = 0; a < bodies.length; a++) for (let b = a + 1; b < bodies.length; b++) { const A = bodies[a], B = bodies[b];
      if (Math.abs(A.x - B.x) > 6 || Math.abs(A.z - B.z) > 6 || Math.abs(A.st.pos.y - B.st.pos.y) > 1.6) continue;
      const hit = sat(A, B); if (!hit) continue;
      // (out of each other first: the overlap shared by their masses)
      const shA = B.m / (A.m + B.m); A.st.pos.x -= hit.nx * hit.d * shA; A.st.pos.z -= hit.nz * hit.d * shA; B.st.pos.x += hit.nx * hit.d * (1 - shA); B.st.pos.z += hit.nz * hit.d * (1 - shA);
      const rax = hit.px - A.st.pos.x, raz = hit.pz - A.st.pos.z, rbx = hit.px - B.st.pos.x, rbz = hit.pz - B.st.pos.z;
      const vax = A.st.vel.x + A.st.ang.y * raz, vaz = A.st.vel.z - A.st.ang.y * rax, vbx = B.st.vel.x + B.st.ang.y * rbz, vbz = B.st.vel.z - B.st.ang.y * rbx;
      const vrx = vbx - vax, vrz = vbz - vaz, vn = vrx * hit.nx + vrz * hit.nz; if (vn >= 0) continue;
      const rna = raz * hit.nx - rax * hit.nz, rnb = rbz * hit.nx - rbx * hit.nz, j = -(1 + 0.22) * vn / (1 / A.m + 1 / B.m + rna * rna / A.I + rnb * rnb / B.I);
      const tx = vrx - vn * hit.nx, tz = vrz - vn * hit.nz, tl = Math.hypot(tx, tz), jt = tl > 1e-3 ? Math.min(0.35 * j, tl / (1 / A.m + 1 / B.m)) : 0; // (the rub: friction against the slide along each other)
      const Jx = hit.nx * j + (tl > 1e-3 ? tx / tl * jt : 0), Jz = hit.nz * j + (tl > 1e-3 ? tz / tl * jt : 0), dv = Math.hypot(Jx, Jz) / Math.min(A.m, B.m);
      const mine = A.hit.length === 3 || B.hit.length === 3, big = mine && dv > 2.2 && now - (A.st.lastBig || 0) > 0.45, k = clamp(dv / 4, 0, 2);
      _at.set(hit.px, (A.st.pos.y + B.st.pos.y) / 2, hit.pz);
      A.hit(_J.set(-Jx, 0, -Jz), _at, dv > 0.7 ? (big ? k : k * 0.4) : 0); B.hit(_J.set(Jx, 0, Jz), _at, dv > 0.7 ? (big ? k : k * 0.4) : 0);
      spark(hit.px, world.groundAt(hit.px, hit.pz), hit.pz, -hit.nz, hit.nx, (vax + vbx) / 2, (vaz + vbz) / 2, Math.round(clamp(dv * 9, 3, 70)));
      if (big) { A.st.lastBig = now; fx.stop = clamp(0.035 + 0.011 * dv, 0.045, 0.12); fx.flash = clamp(0.62 + dv * 0.05, 0.62, 1); } }
  };
  // the slipstream: a car close behind another on the same line pushes less air
  const draft = (st, s, w, list) => { let d = 0; for (const o of list) { const gap = o.s - s; if (gap > 3 && gap < 32 && Math.abs(o.w - w) < 1.3) d = Math.max(d, 0.32 * (1 - (gap - 3) / 29)); } st.draft = d; };

  // ---- the HUD: the order, the gaps, the feed
  const box = document.createElement('div'); box.id = 'raceOrder';
  document.body.appendChild(box);
  const fmt = t => { const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2); };
  let frame = 0, order = null;
  const feedBox = document.createElement('div'); feedBox.id = 'raceFeed';
  document.body.appendChild(feedBox);
  const drawFeed = show => { const now = performance.now(); while (feed.length && now - feed[0].at > 4500) feed.shift(); feedBox.style.display = show && feed.length ? '' : 'none';
    feedBox.style.top = (box.offsetTop + box.offsetHeight + 6) + 'px';
    feedBox.innerHTML = feed.map(f => `<div style="opacity:${clamp(1 - (now - f.at - 3500) / 1000, 0, 1).toFixed(2)}" class="${f.k}">${f.t}</div>`).join(''); };
  for (const c of cars) { holdOnGrid(c); c.car.sync(0, true); }

  const short = id => id === 'f40' ? 'F40' : id === 'i20' ? 'i20' : '';
  const standings = (player, phase, ms) => [...cars.map(c => ({ name: c.name, car: c.car.id, s: c.done ? 1e9 - c.doneT : c.s, me: false, ref: c })),
    { name: 'Ty', car: player ? player.id : '', s: phase === 'finished' ? 1e9 - clock.state.result : ms, me: true }].sort((a, b) => b.s - a.s);
  // the player's car driven by a driver of the same kind (automated tests of a whole race; never in normal play)
  let auto = null;
  const autopilot = (player, on = true) => { if (!on) { auto = null; player.autopilot = null; return; }
    auto = { ...DRIVER0, name: 'Ty', car: player, st: player.st, veh: null, len: player.spec.dims[2], wid: player.spec.dims[0], grid: { s: 0, w: 0 }, s: 0, w: 0, v: 0, done: 0, ph: 0,
      mode: 'line', offT: 0, mix: 0, side: 0, followT: 0, defT: 0, defCool: 0, mk: null, mkT: 0, mkCool: 1e9, stuckT: 0, revT: 0, revSteer: 0, lost: 0, resets: 0, think: 0, steer: 0, cap: 1e9, avoid: 0, err: 0 };
    prep(auto); player.st.assist = true; player.st.auto = true;
    player.autopilot = dt => { const tR = raceT; if (clock.state.phase !== 'running') return; proj(player.st.pos.x, player.st.pos.z, auto.s, auto); auto.v = player.st.velLocal.z;
      auto.think -= dt; if (auto.think <= 0) { auto.think += 0.1; tactics(auto, null, 0, tR); } drive(auto, dt, tR); }; };
  const api = { cars, results, reset, lineW, plans, standings: () => last, autopilot,
    // the finish's classification for the results screen: everyone's place, and the time of those home
    classification() { return [...results].sort((a, b) => a.t - b.t).concat(last.filter(a => !results.some(r => r.name === a.name)).map(a => ({ name: a.name, car: a.car, t: null, me: a.me }))); },
    update(dt, player) {
      const phase = clock.state.phase, show = player && player.driving; box.style.display = show ? '' : 'none'; onFoot = !show;
      const me = player ? proj(player.st.pos.x, player.st.pos.z, meP.s, meP) : null, meV = player ? player.st.velLocal.z : 0;
      if (me) { meRef.wv = lerp(meRef.wv, (me.w - meRef.w) / Math.max(dt, 1e-3), 0.2); Object.assign(meRef, { s: me.s, w: me.w, v: meV, len: player.spec.dims[2], wid: player.spec.dims[0] }); }
      // (the race's own clock: it runs on after the player has crossed the line, for those still out there)
      if (phase === 'running' || phase === 'finished' && raceT > 0) raceT += dt; else raceT = 0;
      const ms = phase === 'finished' ? finishI + 0.5 : me ? me.s : 0, tR = raceT;
      pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(pv);
      if (phase === 'running') {
        for (const c of cars) { // (where each car is on the road, and how fast it moves across it)
          proj(c.st.pos.x, c.st.pos.z, c.s, c); c.wv = lerp(c.wv || 0, (c.w - (c.wPrev ?? c.w)) / Math.max(dt, 1e-3), 0.2); c.wPrev = c.w; c.v = c.st.velLocal.z;
          if (Math.abs(c.w) < RW && c.s > (c.lastGood ?? 0)) c.lastGood = c.s - 15;
          c.think -= dt; if (c.think <= 0) { c.think += 0.1; tactics(c, me, meV, tR); }
          drive(c, dt, tR); rescue(c, dt);
          if (!c.done && c.s >= finishI) { c.done = 1; c.doneT = tR; results.push({ name: c.name, car: c.car.id, t: tR }); } }
        const list = cars.map(c => ({ s: c.s, w: c.w })); if (me) list.push({ s: me.s, w: me.w });
        for (const c of cars) draft(c.st, c.s, c.w, list); if (me && player) draft(player.st, me.s, me.w, list);
      } else if (phase !== 'finished') for (const c of cars) holdOnGrid(c);
      else for (const c of cars) { proj(c.st.pos.x, c.st.pos.z, c.s, c); c.v = c.st.velLocal.z; drive(c, dt, tR); if (!c.done && c.s >= finishI) { c.done = 1; c.doneT = tR; results.push({ name: c.name, car: c.car.id, t: tR }); } }
      // (the simulation of each, then the contacts between all of them; drawn and heard by how near they are)
      for (const c of cars) { c.veh.update(dt); const d = camera.position.distanceTo(c.st.pos); c.car.sync(dt, d < 260); c.car.walkerBox(onFoot);
        c.voice.set(c.st.pos.x, c.st.pos.y, c.st.pos.z, { rpm: c.st.rpm, thr: c.st.throttle, speed: c.st.vel.length(), slip: clamp((c.st.slipMax - 1) / 1.5, 0, 1), fires: c.car.spec.fires || 2, gain: 0.9 });
        if (d < 420) c.voice.update(dt); else if (c.voice.out) c.voice.out.gain.value = 0; }
      if (dt > 0) contacts(player); sparksUpdate(dt);
      if (phase === 'finished' && player && !results.some(r => r.me)) results.push({ name: 'Ty', me: true, car: player.id, t: clock.state.result });
      if (++frame % 4) return;
      last = standings(player, phase, ms);
      const pos = last.findIndex(a => a.me) + 1;
      // (who passed whom, from the order's change)
      if (phase === 'running') { const now = last.map(a => a.name); if (order && clock.state.t > 4) for (let k = 1; k < now.length; k++) { const was = order.indexOf(now[k - 1]); if (was > order.indexOf(now[k]) && was === order.indexOf(now[k]) + 1) {
          const a = now[k - 1], b = now[k]; say(a === 'Ty' ? 'Wyprzedzasz: ' + b : b === 'Ty' ? a + ' wyprzedza cię' : a + ' wyprzedza ' + b, a === 'Ty' ? 'good' : b === 'Ty' ? 'bad' : 'info'); } }
        order = now; }
      const gapTo = a => { if (!me || a.me) return ''; const d = (a.ref ? a.ref.s : 0) - me.s, v = Math.max(15, Math.abs(meV)); return (d > 0 ? '+' : '−') + (Math.abs(d) / v).toFixed(1) + 's'; };
      if (phase === 'finished') box.innerHTML = `<div class="hd">WYNIKI</div>` + [...results].sort((a, b) => a.t - b.t).map((r, k) => `<div class="${r.me ? 'me' : ''}">${k + 1}. ${r.name} <span>${fmt(r.t)}</span></div>`).join('') + (results.length < last.length ? `<div class="dim">… na trasie: ${last.length - results.length}</div>` : '');
      else box.innerHTML = `<div class="pos">P${pos}<small> / ${last.length}</small></div>` + last.map((a, k) => `<div class="${a.me ? 'me' : ''}">${k + 1}. ${a.name}<span>${phase === 'running' ? gapTo(a) : short(a.car)}</span></div>`).join('');
      drawFeed(show);
    },
    dispose() { box.remove(); feedBox.remove(); scene.remove(sparks); spGeo.dispose(); sparks.material.dispose(); for (const c of cars) { c.car.dispose(); c.voice.dispose(); } cars.length = 0; },
  };
  let last = standings(null, 'waiting', 0);
  return api;
}
