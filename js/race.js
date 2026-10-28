// A race on a stage of two lanes: the player's car (car.js, the full simulation) against rivals driven along the road.
// Each rival is a driver of its own (the stage's pool, rally4.js): a pace, and a way of driving — how readily it passes
// and how close it follows, how much of the road it takes through a bend (out wide, clipping the inside, out again),
// how hard it keeps a car behind from coming by, how often it gets it wrong (out wide, a lock-up, a spin), how much its
// pace wanders, how sharp its start is; it tucks into the slipstream of a car ahead on a straight, and pushes a little
// harder when it has dropped back and eases off a little when far ahead. The field and the grid are drawn afresh each
// time (rally.js), and the race calls what happens (the feed under the order).
// A rival is not simulated tyre by tyre: it rides the stage's line at a distance s and a lateral offset w (left
// positive), its speed planned from the road — at each station the fastest the bend there allows at the rival's grip,
// and back from every bend the speed it can brake down from (a backward pass) — and limited by what its engine can give
// at that speed. It keeps to a lane, moves to the other to pass a slower car ahead when that lane is clear, and else
// follows. The cars meet as boxes (their footprints, turned with them): overlapping, they are pushed apart by an impulse
// along the axis they overlap least on, at the point between them, with a little bounce and the rub of one along the
// other — the player's car takes it in its own physics (its speed and its spin), a rival as a shove along and across
// its lane and a spin it recovers from. A hard hit is an impact frame: the world holds still for a moment, the picture
// flashes stark, the camera shakes, sparks fly and the panels crunch. (On foot, a rival is a box in the colliders.)
// The race's order is by distance down the stage; the results are taken as each car crosses the line.
import { THREE, scene, gltfLoader, clamp, lerp, colInsert, colRemove, fx } from './core.js';
import { CAR_DEFS, dressMaterials } from './car.js';

const UP = new THREE.Vector3(0, 1, 0);
// what a rival's car can do: grip (m/s² in a bend), engine (W at the wheels, the most it can push), top speed, braking
const PERF = { f40: { grip: 10.5, power: 330000, mass: 1260, acc: 7.6, top: 85, brake: 10.5, cda: 0.66 }, i20: { grip: 10.0, power: 250000, mass: 1310, acc: 6.8, top: 55, brake: 9.8, cda: 0.78 } };

export async function createRace(world, { rivals, grid, startI, finishI, lanes, RW, clock }) {
  const { P, T, N } = world.track, half = RW / 2;
  // ---- the cars: each model loaded once, a copy per rival (its paint recoloured), its wheels on pivots of their own
  const models = {}; for (const r of rivals) if (!models[r.car]) models[r.car] = gltfLoader.loadAsync(CAR_DEFS[r.car].model).then(g => { dressMaterials(g.scene, CAR_DEFS[r.car].mats); return g.scene; }).catch(() => null);
  const cars = [];
  for (const [k, r] of rivals.entries()) {
    const src = await models[r.car]; if (!src) continue;
    const m = src.clone(true); m.updateMatrixWorld(true);
    m.traverse(o => { if (!o.isMesh) return; o.castShadow = true; o.receiveShadow = true;
      if (r.paint && !Array.isArray(o.material) && /^Paint$/.test(o.material.name)) { o.material = o.material.clone(); o.material.color.set(r.paint); }
      if (r.tint && !Array.isArray(o.material) && /body/i.test(o.material.name)) { o.material = o.material.clone(); o.material.color.set(r.tint); } // (a livery tinted)
      if (/Interior|Alcantara|Leather|Cockpit|Dials|Display|COCKPIT/i.test(o.material.name || '') || /COCKPIT|STEER/.test(o.parent && o.parent.name || '')) o.castShadow = false; });
    const root = new THREE.Group(); root.name = 'rival:' + r.name; root.userData.dynamic = true; root.userData.dynamicCaster = true; scene.add(root); root.add(m);
    const find = n => { let f = null; m.traverse(o => { if (!f && o.name && o.name.startsWith(n)) f = o; }); return f; };
    const spins = [];
    for (const id of ['LF', 'RF', 'LR', 'RR']) { const { node, susp } = CAR_DEFS[r.car].wheel(id, find); if (!node) continue;
      const bb = new THREE.Box3().setFromObject(node), hub = bb.getCenter(new THREE.Vector3()), pv = new THREE.Object3D(); pv.position.copy(hub); m.add(pv); pv.updateMatrixWorld(true);
      const spin = new THREE.Object3D(); pv.add(spin); spin.updateMatrixWorld(true); spin.attach(node); if (susp) pv.attach(susp); spins.push({ spin, pv, front: id[1] === 'F', R: (bb.max.y - bb.min.y) / 2 }); }
    const g = grid[k], pf = PERF[r.car] || PERF.i20, [dw, , dl] = CAR_DEFS[r.car].spec.dims;
    cars.push({ aggr: 0.5, line: 0.6, def: 0.5, err: 0.3, cons: 0.3, react: 0.3, ...r, skill0: r.skill, ph: Math.random() * 6.28, pf, root, spins, s: g.s, w: g.w, wT: g.w, v: 0, yawOff: 0, angle: 0, done: 0, hit: 0, vw: 0, spin: 0, spinV: 0, hx: dw / 2, hz: dl / 2, I: pf.mass * (dw * dw + dl * dl) / 12,
      vel: new THREE.Vector3(), col: { t: 1, x: 0, z: 0, hx: dw / 2, hz: dl / 2, c: 1, s: 0, y0: -1e9, y1: 1e9 }, colIn: false, grid: g });
  }
  // ---- the speed each rival may carry at each station: the bend's limit, and the braking back from the next ones
  const R = new Float32Array(N); for (let i = 0; i < N; i++) { const a = P[Math.max(0, i - 8)], b = P[i], c = P[Math.min(N - 1, i + 8)];
    const ab = Math.hypot(b[0] - a[0], b[1] - a[1]), bc = Math.hypot(c[0] - b[0], c[1] - b[1]), ca = Math.hypot(a[0] - c[0], a[1] - c[1]), ar = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
    R[i] = ar < 1e-6 ? 1e5 : ab * bc * ca / (4 * ar); }
  // (the signed curvature, + to the left: where the bends are and which way, for the racing line)
  const Ks = new Float32Array(N); for (let i = 0; i < N; i++) { const a = T[Math.max(0, i - 6)], b = T[Math.min(N - 1, i + 6)]; Ks[i] = ((b[0] - a[0]) * T[i][1] - (b[1] - a[1]) * T[i][0]) / 12; }
  const bend = k => clamp(Math.abs(k) * 140, 0, 1);
  // (each race a driver is a touch quicker or slower than the last, and starts as sharply as that day goes)
  const plan = c => { c.skill = c.skill0 * (0.985 + Math.random() * 0.03); const vb = new Float32Array(N), grip = c.pf.grip * c.skill;
    for (let i = 0; i < N; i++) vb[i] = Math.min(c.pf.top * (0.96 + 0.04 * c.skill), Math.sqrt(grip * R[i]) * (1 + 0.05 * c.line * bend(Ks[i]))); // (the line opens the bend a little)
    for (let i = N - 2; i >= 0; i--) vb[i] = Math.min(vb[i], Math.sqrt(vb[i + 1] * vb[i + 1] + 2 * c.pf.brake * 0.92)); c.vb = vb;
    c.react0 = 0.05 + c.react * (0.6 + 0.8 * Math.random()); c.bad = Math.random() < 0.12 ? 1.4 : 0; c.mk = null; c.mT = 4 + Math.random() * 8; c.blockT = 0; };
  for (const c of cars) plan(c);
  // ---- the feed: what the race calls out, a few lines under the order, each for a few seconds
  const feed = [], say = (t, k = 'info') => { if (feed.length && feed[feed.length - 1].t === t) return; feed.push({ t, k, at: performance.now() }); if (feed.length > 4) feed.shift(); };
  // ---- where things are on the road
  const at = (s, w, out) => { const i = clamp(Math.floor(s), 0, N - 2), f = clamp(s - i, 0, 1), tx = lerp(T[i][0], T[i + 1][0], f), tz = lerp(T[i][1], T[i + 1][1], f), l = Math.hypot(tx, tz) || 1;
    out.x = lerp(P[i][0], P[i + 1][0], f) + tz / l * w; out.z = lerp(P[i][1], P[i + 1][1], f) - tx / l * w; out.tx = tx / l; out.tz = tz / l; return out; };
  const onRoad = (x, z) => { const i = world.track.nearAt(x, z); if (i < 0) return null; const [px, pz] = P[i], [tx, tz] = T[i]; return { s: i + (x - px) * tx + (z - pz) * tz, w: (x - px) * tz - (z - pz) * tx }; };
  const q = new THREE.Quaternion(), qy = new THREE.Quaternion(), n = new THREE.Vector3(), A = {};
  let onFoot = true; // (the player out of the car: the rivals are boxes in the colliders for the walker)
  const place = (c, dt) => { at(c.s, c.w, A); const y = world.groundAt(A.x, A.z), yaw = Math.atan2(A.tx, A.tz) + c.yawOff + c.spin; world.normalAt(A.x, A.z, n);
    q.setFromUnitVectors(UP, n); qy.setFromAxisAngle(UP, yaw); c.root.position.set(A.x, y, A.z); c.root.quaternion.copy(q).multiply(qy); c.root.updateMatrixWorld(true);
    c.angle += c.v * dt; for (const w of c.spins) w.spin.rotation.x = c.angle / w.R;
    c.yaw = yaw; c.tx = A.tx; c.tz = A.tz; // (its heading, and the road's there: for the contacts)
    c.vel.set(A.tx * c.v + A.tz * c.vw, 0, A.tz * c.v - A.tx * c.vw); // (along the lane at its speed, across at its drift)
    const col = c.col; if (c.colIn) { colRemove(col); c.colIn = false; }
    if (onFoot) { col.x = A.x; col.z = A.z; col.c = Math.cos(yaw); col.s = Math.sin(yaw); col.y0 = y - 0.5; col.y1 = y + 1.4; colInsert(col); c.colIn = true; } };
  const reset = () => { // (the same grid, the drivers in their places shuffled)
    const g = cars.map(c => c.grid); for (let i = g.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [g[i], g[j]] = [g[j], g[i]]; }
    cars.forEach((c, k) => { c.grid = g[k]; Object.assign(c, { s: c.grid.s, w: c.grid.w, wT: c.grid.w, v: 0, yawOff: 0, done: 0, hit: 0, vw: 0, spin: 0, spinV: 0 }); c.vel.set(0, 0, 0); plan(c); place(c, 0); });
    results.length = 0; feed.length = 0; order = null; };

  // ---- contact: two boxes on the ground (centre, heading, half width and length): do they overlap, and if so the axis
  // they overlap least on (from the first to the second), how far, and the point between them (each one's corners
  // inside the other, averaged)
  const sat = (a, b) => {
    const dx = b.x - a.x, dz = b.z - a.z, ax = [[a.fx, a.fz], [a.fz, -a.fx], [b.fx, b.fz], [b.fz, -b.fx]]; let best = 1e9, nx = 0, nz = 0;
    for (const [ux, uz] of ax) { const ra = a.hz * Math.abs(ux * a.fx + uz * a.fz) + a.hx * Math.abs(ux * a.fz - uz * a.fx), rb = b.hz * Math.abs(ux * b.fx + uz * b.fz) + b.hx * Math.abs(ux * b.fz - uz * b.fx);
      const d = dx * ux + dz * uz, o = ra + rb - Math.abs(d); if (o <= 0) return null; if (o < best) { best = o; const sg = d < 0 ? -1 : 1; nx = ux * sg; nz = uz * sg; } }
    let px = 0, pz = 0, k = 0; const inside = (o, x, z) => { const ex = x - o.x, ez = z - o.z; return Math.abs(ex * o.fx + ez * o.fz) <= o.hz && Math.abs(ex * o.fz - ez * o.fx) <= o.hx; };
    for (const [o, p] of [[a, b], [b, a]]) for (const sf of [-1, 1]) for (const sl of [-1, 1]) { const x = o.x + o.fx * o.hz * sf + o.fz * o.hx * sl, z = o.z + o.fz * o.hz * sf - o.fx * o.hx * sl; if (inside(p, x, z)) { px += x; pz += z; k++; } }
    if (k) { px /= k; pz /= k; } else { px = (a.x + b.x) / 2; pz = (a.z + b.z) / 2; }
    return { nx, nz, d: best, px, pz }; };
  const boxOf = c => ({ x: c.root.position.x, z: c.root.position.z, fx: Math.sin(c.yaw), fz: Math.cos(c.yaw), hx: c.hx, hz: c.hz });
  // a rival shoved: J (N s) at the point — along its lane (its speed), across it (a sideways drift it steers out of) and
  // a spin; a hard enough shove and it has lost it for a moment
  const shove = (c, Jx, Jz, px, pz) => { const m = c.pf.mass, along = (Jx * c.tx + Jz * c.tz) / m, across = (Jx * c.tz - Jz * c.tx) / m;
    c.v = Math.max(0, c.v + along); c.vw += across; const rx = px - c.root.position.x, rz = pz - c.root.position.z; c.spinV += (rz * Jx - rx * Jz) / c.I;
    const dv = Math.hypot(Jx, Jz) / m; if (dv > 1.5) c.hit = Math.max(c.hit, Math.min(2.5, dv * 0.3)); };
  // sparks: a pool of points thrown from the contact, falling and dimming
  const SP = 240, spPos = new Float32Array(SP * 3), spVel = new Float32Array(SP * 3), spLife = new Float32Array(SP), spCol = new Float32Array(SP * 3); let spNext = 0;
  const spGeo = new THREE.BufferGeometry(); spGeo.setAttribute('position', new THREE.BufferAttribute(spPos, 3)); spGeo.setAttribute('color', new THREE.BufferAttribute(spCol, 3));
  const sparks = new THREE.Points(spGeo, new THREE.PointsMaterial({ size: 0.07, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  sparks.frustumCulled = false; sparks.name = 'race-sparks'; scene.add(sparks); sparks.updateMatrixWorld(true);
  const spark = (x, y, z, nx, nz, vx, vz, count) => { for (let i = 0; i < count; i++) { const k = spNext = (spNext + 1) % SP, sp = 2 + Math.random() * 7, a = (Math.random() - 0.5) * 2.4, c = Math.cos(a), s = Math.sin(a);
      spPos.set([x, y + 0.2 + Math.random() * 0.4, z], k * 3); spVel.set([vx * 0.8 + (nx * c - nz * s) * sp, 1 + Math.random() * 4, vz * 0.8 + (nz * c + nx * s) * sp], k * 3); spLife[k] = 0.25 + Math.random() * 0.5; } };
  const sparksUpdate = dt => { let any = false; for (let k = 0; k < SP; k++) { if (spLife[k] <= 0) { spCol[k * 3] = spCol[k * 3 + 1] = spCol[k * 3 + 2] = 0; continue; } any = true; spLife[k] -= dt;
      spVel[k * 3 + 1] -= 9.8 * dt; for (let j = 0; j < 3; j++) spPos[k * 3 + j] += spVel[k * 3 + j] * dt; const f = Math.max(0, Math.min(1, spLife[k] * 3));
      spCol[k * 3] = 2.6 * f; spCol[k * 3 + 1] = 1.5 * f * f; spCol[k * 3 + 2] = 0.4 * f * f * f; }
    sparks.visible = any; if (any) { spGeo.attributes.position.needsUpdate = true; spGeo.attributes.color.needsUpdate = true; } };
  const contacts = (player, dt) => {
    const st = player && player.driving ? player.st : null, now = performance.now() / 1000;
    let P = null; if (st) { const sp = player.spec, cg = sp.cg, f = new THREE.Vector3(0, 0, 1).applyQuaternion(st.q), o = new THREE.Vector3(-cg[0], 0, -cg[2]).applyQuaternion(st.q).add(st.pos);
      P = { x: o.x, z: o.z, fx: f.x, fz: f.z, hx: sp.dims[0] / 2, hz: sp.dims[2] / 2 }; const l = Math.hypot(P.fx, P.fz) || 1; P.fx /= l; P.fz /= l; }
    for (const c of cars) {
      // the player's car against this one
      if (P && Math.abs(c.root.position.y - st.pos.y) < 1.6) { const R = boxOf(c), hit = sat(R, P);
        if (hit) { const mP = player.spec.mass, mR = c.pf.mass, rx = hit.px - st.pos.x, rz = hit.pz - st.pos.z, wy = st.ang.y;
          const vPx = st.vel.x + wy * rz, vPz = st.vel.z - wy * rx, vrx = vPx - c.vel.x, vrz = vPz - c.vel.z, vn = vrx * hit.nx + vrz * hit.nz; // (the player's point's velocity, relative to the rival's)
          // (out of each other first: the overlap shared by their masses)
          const shareP = mR / (mP + mR); st.pos.x += hit.nx * hit.d * shareP; st.pos.z += hit.nz * hit.d * shareP; c.w += -(hit.nx * c.tz - hit.nz * c.tx) * hit.d * (1 - shareP); c.s += -(hit.nx * c.tx + hit.nz * c.tz) * hit.d * (1 - shareP);
          if (vn < 0) { const rn = rz * hit.nx - rx * hit.nz, j = -(1 + 0.22) * vn / (1 / mP + 1 / mR + rn * rn / player.inertia.y);
            const tx = vrx - vn * hit.nx, tz = vrz - vn * hit.nz, tl = Math.hypot(tx, tz), jt = tl > 1e-3 ? Math.min(0.35 * j, tl / (1 / mP + 1 / mR)) : 0; // (the rub: friction against the slide along each other)
            const Jx = hit.nx * j - (tl > 1e-3 ? tx / tl * jt : 0), Jz = hit.nz * j - (tl > 1e-3 ? tz / tl * jt : 0), dv = Math.hypot(Jx, Jz) / mP;
            const big = dv > 2.2 && now - (c.lastBig || 0) > 0.45, k = clamp(dv / 4, 0, 2);
            player.impact(new THREE.Vector3(Jx, 0, Jz), new THREE.Vector3(hit.px, st.pos.y, hit.pz), dv > 0.7 ? (big ? k : k * 0.4) : 0);
            shove(c, -Jx, -Jz, hit.px, hit.pz);
            spark(hit.px, world.groundAt(hit.px, hit.pz), hit.pz, -hit.nz, hit.nx, (vPx + c.vel.x) / 2, (vPz + c.vel.z) / 2, Math.round(clamp(dv * 9, 4, 70)));
            if (big) { c.lastBig = now; fx.stop = clamp(0.035 + 0.011 * dv, 0.045, 0.12); fx.flash = clamp(0.62 + dv * 0.05, 0.62, 1); } } } }
      // the rivals against each other
      for (const o of cars) { if (o === c || cars.indexOf(o) < cars.indexOf(c)) continue; const hit = sat(boxOf(c), boxOf(o)); if (!hit) continue;
        c.w -= (hit.nx * c.tz - hit.nz * c.tx) * hit.d * 0.5; o.w += (hit.nx * o.tz - hit.nz * o.tx) * hit.d * 0.5;
        const vn = (o.vel.x - c.vel.x) * hit.nx + (o.vel.z - c.vel.z) * hit.nz; if (vn >= 0) continue;
        const j = -(1 + 0.2) * vn / (1 / c.pf.mass + 1 / o.pf.mass); shove(c, -hit.nx * j, -hit.nz * j, hit.px, hit.pz); shove(o, hit.nx * j, hit.nz * j, hit.px, hit.pz);
        if (j / c.pf.mass > 1) spark(hit.px, world.groundAt(hit.px, hit.pz), hit.pz, hit.nz, -hit.nx, c.vel.x, c.vel.z, Math.round(clamp(j / c.pf.mass * 8, 3, 40))); }
    }
  };
  const results = [];
  for (const c of cars) place(c, 0);

  // ---- the HUD: the order, the gaps, and at the end the results
  const box = document.createElement('div'); box.id = 'raceOrder';
  box.style.cssText = 'position:fixed;right:16px;top:44px;z-index:9;min-width:190px;padding:8px 12px;border-radius:9px;background:#090d13c8;border:1px solid #ffffff28;color:#fff;font:600 13px/1.5 "Segoe UI",system-ui,sans-serif;text-shadow:0 1px 3px #000;pointer-events:none';
  document.body.appendChild(box);
  const fmt = t => { const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2); };
  let frame = 0, order = null;
  const feedBox = document.createElement('div'); feedBox.id = 'raceFeed';
  feedBox.style.cssText = 'position:fixed;right:16px;z-index:9;min-width:190px;max-width:260px;color:#fff;font:600 12.5px/1.45 "Segoe UI",system-ui,sans-serif;text-shadow:0 1px 3px #000;pointer-events:none;text-align:right';
  document.body.appendChild(feedBox);
  const drawFeed = show => { const now = performance.now(); while (feed.length && now - feed[0].at > 4500) feed.shift(); feedBox.style.display = show && feed.length ? '' : 'none';
    feedBox.style.top = (box.offsetTop + box.offsetHeight + 6) + 'px';
    feedBox.innerHTML = feed.map(f => `<div style="opacity:${clamp(1 - (now - f.at - 3500) / 1000, 0, 1).toFixed(2)};color:${f.k === 'good' ? '#7dffa0' : f.k === 'bad' ? '#ffb08a' : '#e8eef5'}">${f.t}</div>`).join(''); };
  const api = { cars, results, reset,
    update(dt, player) {
      const phase = clock.state.phase, show = player && player.driving; box.style.display = show ? '' : 'none'; onFoot = !show;
      const me = player ? onRoad(player.st.pos.x, player.st.pos.z) : null, meV = player ? player.st.vel.length() : 0, ms = phase === 'finished' ? finishI + 0.5 : me ? me.s : 0;
      if (phase === 'running') for (const c of cars) {
        if (c.done) { c.v = Math.max(0, c.v - 6 * dt); c.s = Math.min(N - 3, c.s + c.v * dt); place(c, dt); continue; }
        // (the speed: what the road ahead allows, what the engine gives, the brakes when it must)
        const tR = clock.state.t, i = clamp(Math.floor(c.s), 0, N - 2), kNow = Ks[Math.min(N - 1, i + 4)], kFar = Ks[Math.min(N - 1, i + Math.round(clamp(c.v * 1.4, 15, 60)))];
        // (its pace today: the plan, wandering a little with its consistency, a push when dropped back and a lift when far
        // ahead of the player; a slow start, or a bogged one)
        const gapMe = me ? c.s - me.s : 0, rubber = 1 - 0.025 * clamp((gapMe - 120) / 200, 0, 1) + 0.035 * clamp((-gapMe - 120) / 250, 0, 1);
        const form = (1 + 0.022 * c.cons * Math.sin(tR * 0.31 + c.ph) * Math.sin(tR * 0.13 + c.ph * 1.7)) * rubber;
        let vt = Math.min(c.vb[Math.min(N - 1, i + 2)], c.vb[i]) * form;
        const drag = 0.5 * 1.225 * c.pf.cda * c.v * c.v / c.pf.mass; let aMax = Math.min(c.pf.acc, c.pf.power / (c.pf.mass * Math.max(c.v, 1))) * c.skill * rubber - drag;
        if (tR < c.react0) { vt = 0; aMax = 0; } else if (c.bad > 0) { c.bad -= dt; aMax *= 0.6; if (c.bad <= 0) {} }
        if (c.bad > 1.3 && tR > c.react0 && tR < c.react0 + 0.1) say(c.name + ': słaby start');
        // (traffic: the nearest car ahead in its lane — a rival, or the player — and the other lane's room)
        let ahead = null, gap = 1e9, lane = c.wT, blocked = false; const others = cars.filter(o => o !== c).map(o => ({ s: o.s, w: o.w, v: o.v, name: o.name }));
        if (me && Math.abs(me.w) < half * 2 + 1) others.push({ s: me.s, w: me.w, v: meV, me: true });
        for (const o of others) { const ds = o.s - c.s; if (ds > 0 && ds < gap && Math.abs(o.w - c.w) < 1.9) { gap = ds; ahead = o; } }
        let target = vt;
        // (a car ahead in the slipstream on a straight: a little less air to push)
        if (ahead && gap > 5 && gap < 30 && R[i] > 300) { aMax += 0.8; target += 3; }
        if (ahead && gap < 14 + 20 * c.aggr && ahead.v < c.v + 1) { const other = lanes > 1 ? (c.wT > 0 ? -half : half) : c.wT, back = 5 + 5 * (1 - c.aggr), free = others.every(o => Math.abs(o.w - other) > 1.9 || o.s - c.s < -back || o.s - c.s > 18);
          if (free && lanes > 1 && R[i] > 220 - 160 * c.aggr) { if (lane !== other && ahead.v > 15) say(c.name + ' atakuje' + (ahead.me ? ' ciebie' : ' ' + ahead.name)); lane = other; }
          else { target = Math.min(target, ahead.v + (gap - 5 - 4 * (1 - c.aggr)) * 0.5); blocked = true; } }
        c.wT = lane;
        // (defending: the player close behind on the other side — it moves across to cover the way by, now and then)
        c.blockT -= dt;
        if (me && lanes > 1 && c.blockT <= 0 && gapMe > 3 && gapMe < 14 && Math.abs(me.w - c.w) > 1.2 && R[i] > 150 && Math.random() < c.def * dt * 1.2) { c.blockT = 1.6; c.blockW = clamp(me.w, -half, half); say(c.name + ' broni pozycji'); }
        // (the racing line: out wide before a bend, the inside at its apex, out again — on the whole road, unless it is
        // following, passing, defending or has got it wrong)
        const lineW = (RW - 0.9) * (Math.sign(kNow) * bend(kNow) - 0.7 * Math.sign(kFar) * bend(kFar) * (1 - bend(kNow)));
        let wGoal = lerp(lane, lineW, blocked ? 0 : c.line * Math.max(bend(kNow), bend(kFar)));
        if (c.blockT > 0) wGoal = c.blockW;
        // (mistakes: in a bend now and then, by the driver — out wide, a lock-up, rarely a spin)
        c.mT -= dt;
        if (!c.mk && c.mT <= 0 && tR > 3 && Math.random() < c.err * dt * (0.004 + 0.03 * bend(kNow))) { const r = Math.random();
          c.mk = r < 0.15 * bend(kNow) ? 'spin' : r < 0.65 ? 'wide' : 'lock'; c.mkT = c.mk === 'wide' ? 1.6 : c.mk === 'lock' ? 0.9 : 2.4; c.mkSide = -Math.sign(kNow || kFar || 1);
          if (c.mk === 'spin') { c.spinV = -c.mkSide * (2.6 + Math.random() * 1.5); c.hit = 2.3; c.v *= 0.75; say(c.name + ' obraca się!', 'bad'); }
          else say(c.name + (c.mk === 'wide' ? ' wyjeżdża szeroko' : ' blokuje koła'), 'bad'); }
        if (c.mk) { c.mkT -= dt; if (c.mk === 'wide') { target *= 0.88; wGoal = c.mkSide * (RW + 0.5); } else if (c.mk === 'lock') { target *= 0.82; c.v = Math.max(0, c.v - 5 * dt); }
          if (c.mkT <= 0) { c.mk = null; c.mT = 8 + Math.random() * 14; } }
        if (c.v < target) c.v = Math.min(target, c.v + aMax * dt); else c.v = Math.max(target, c.v - c.pf.brake * dt);
        // (shoved: it has lost speed and drifts across, spinning, while it gathers the car up — the harder the hit the longer)
        if (c.hit > 0) { c.hit -= dt; c.v = Math.max(0, c.v - dt * 4 * Math.min(1, c.hit)); if (c.v > target) c.v = Math.max(target, c.v - c.pf.brake * dt); }
        c.w += c.vw * dt; c.vw *= Math.exp(-dt * 2.2); c.w = clamp(c.w, -RW - 1.2, RW + 1.2);
        c.spin += c.spinV * dt; c.spinV *= Math.exp(-dt * 2.5); c.spin *= Math.exp(-dt * (c.hit > 0 ? 0.9 : 2.4));
        const latV = 1.6 + 1.3 * c.line, dw = clamp(wGoal - c.w, -latV * dt, latV * dt) * (c.hit > 0 ? 0.3 : 1); c.w += dw; c.yawOff = lerp(c.yawOff, -dw / Math.max(c.v * dt, 1e-3) * 0.8, 0.2);
        c.s += c.v * dt;
        if (c.s >= finishI) { c.done = 1; results.push({ name: c.name, car: c.car, t: clock.state.t }); }
        place(c, dt);
      } else if (phase !== 'finished') for (const c of cars) place(c, 0);
      if (dt > 0) contacts(player, dt); sparksUpdate(dt);
      if (phase === 'finished' && player && !results.some(r => r.me)) results.push({ name: 'Ty', me: true, t: clock.state.result });
      if (++frame % 4) return;
      // (the order: by distance down the stage; finishers first, by their times)
      const all = [...cars.map(c => ({ name: c.name, car: c.car, s: c.done ? 1e9 - (results.find(r => r.name === c.name) || { t: 0 }).t : c.s, me: false })), { name: 'Ty', car: player ? player.id : '', s: phase === 'finished' ? 1e9 - clock.state.result : ms, me: true }].sort((a, b) => b.s - a.s);
      const pos = all.findIndex(a => a.me) + 1;
      // (who passed whom, from the order's change)
      if (phase === 'running') { const now = all.map(a => a.name); if (order && clock.state.t > 4) for (let k = 1; k < now.length; k++) { const was = order.indexOf(now[k - 1]); if (was > order.indexOf(now[k]) && was === order.indexOf(now[k]) + 1) {
          const a = now[k - 1], b = now[k]; say(a === 'Ty' ? 'Wyprzedzasz: ' + b : b === 'Ty' ? a + ' wyprzedza cię' : a + ' wyprzedza ' + b, a === 'Ty' ? 'good' : b === 'Ty' ? 'bad' : 'info'); } }
        order = now; }
      if (phase === 'finished') box.innerHTML = `<div style="font:800 15px 'Segoe UI';color:#ffd54d;margin-bottom:3px">WYNIKI</div>` + [...results].sort((a, b) => a.t - b.t).map((r, k) => `<div style="${r.me ? 'color:#ffd54d;font-weight:800' : ''}">${k + 1}. ${r.name} <span style="float:right;margin-left:14px">${fmt(r.t)}</span></div>`).join('') + (results.length < all.length ? `<div style="opacity:.6">… na trasie: ${all.length - results.length}</div>` : '');
      else box.innerHTML = `<div style="font:800 26px/1.1 'Segoe UI'">P${pos}<span style="font-size:15px;opacity:.7"> / ${all.length}</span></div>` + all.map((a, k) => `<div style="${a.me ? 'color:#ffd54d;font-weight:800' : 'opacity:.85'}">${k + 1}. ${a.name}<span style="float:right;margin-left:14px;opacity:.7">${a.car === 'f40' ? 'F40' : a.car === 'i20' ? 'i20' : ''}</span></div>`).join('');
      drawFeed(show);
    } };
  return api;
}
