// A race on a stage of two lanes: the player's car (car.js, the full simulation) against rivals driven along the road.
// A rival is not simulated tyre by tyre: it rides the stage's line at a distance s and a lateral offset w (left
// positive), its speed planned from the road — at each station the fastest the bend there allows at the rival's grip,
// and back from every bend the speed it can brake down from (a backward pass) — and limited by what its engine can give
// at that speed. It keeps to a lane, moves to the other to pass a slower car ahead when that lane is clear, and else
// follows. Each rival is a box in the world's colliders, so the player's car bumps into it; a rival bumped slows a little
// and edges away. The race's order is by distance down the stage; the results are taken as each car crosses the line.
import { THREE, scene, gltfLoader, clamp, lerp, colInsert, colRemove } from './core.js';
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
      if (/Interior|Alcantara|Leather|Cockpit|Dials|Display|COCKPIT/i.test(o.material.name || '') || /COCKPIT|STEER/.test(o.parent && o.parent.name || '')) o.castShadow = false; });
    const root = new THREE.Group(); root.name = 'rival:' + r.name; root.userData.dynamic = true; root.userData.dynamicCaster = true; scene.add(root); root.add(m);
    const find = n => { let f = null; m.traverse(o => { if (!f && o.name && o.name.startsWith(n)) f = o; }); return f; };
    const spins = [];
    for (const id of ['LF', 'RF', 'LR', 'RR']) { const { node, susp } = CAR_DEFS[r.car].wheel(id, find); if (!node) continue;
      const bb = new THREE.Box3().setFromObject(node), hub = bb.getCenter(new THREE.Vector3()), pv = new THREE.Object3D(); pv.position.copy(hub); m.add(pv); pv.updateMatrixWorld(true);
      const spin = new THREE.Object3D(); pv.add(spin); spin.updateMatrixWorld(true); spin.attach(node); if (susp) pv.attach(susp); spins.push({ spin, pv, front: id[1] === 'F', R: (bb.max.y - bb.min.y) / 2 }); }
    const g = grid[k], pf = PERF[r.car] || PERF.i20;
    cars.push({ ...r, pf, root, spins, s: g.s, w: g.w, wT: g.w, v: 0, yawOff: 0, angle: 0, done: 0, hit: 0, col: { t: 1, x: 0, z: 0, hx: 0.98, hz: 2.2, c: 1, s: 0, y0: -1e9, y1: 1e9 }, colIn: false, grid: g });
  }
  // ---- the speed each rival may carry at each station: the bend's limit, and the braking back from the next ones
  const R = new Float32Array(N); for (let i = 0; i < N; i++) { const a = P[Math.max(0, i - 8)], b = P[i], c = P[Math.min(N - 1, i + 8)];
    const ab = Math.hypot(b[0] - a[0], b[1] - a[1]), bc = Math.hypot(c[0] - b[0], c[1] - b[1]), ca = Math.hypot(a[0] - c[0], a[1] - c[1]), ar = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
    R[i] = ar < 1e-6 ? 1e5 : ab * bc * ca / (4 * ar); }
  for (const c of cars) { const vb = new Float32Array(N), grip = c.pf.grip * c.skill; for (let i = 0; i < N; i++) vb[i] = Math.min(c.pf.top * (0.96 + 0.04 * c.skill), Math.sqrt(grip * R[i]));
    for (let i = N - 2; i >= 0; i--) vb[i] = Math.min(vb[i], Math.sqrt(vb[i + 1] * vb[i + 1] + 2 * c.pf.brake * 0.92)); c.vb = vb; }
  // ---- where things are on the road
  const at = (s, w, out) => { const i = clamp(Math.floor(s), 0, N - 2), f = clamp(s - i, 0, 1), tx = lerp(T[i][0], T[i + 1][0], f), tz = lerp(T[i][1], T[i + 1][1], f), l = Math.hypot(tx, tz) || 1;
    out.x = lerp(P[i][0], P[i + 1][0], f) + tz / l * w; out.z = lerp(P[i][1], P[i + 1][1], f) - tx / l * w; out.tx = tx / l; out.tz = tz / l; return out; };
  const onRoad = (x, z) => { const i = world.track.nearAt(x, z); if (i < 0) return null; const [px, pz] = P[i], [tx, tz] = T[i]; return { s: i + (x - px) * tx + (z - pz) * tz, w: (x - px) * tz - (z - pz) * tx }; };
  const q = new THREE.Quaternion(), qy = new THREE.Quaternion(), n = new THREE.Vector3(), A = {};
  const place = (c, dt) => { at(c.s, c.w, A); const y = world.groundAt(A.x, A.z), yaw = Math.atan2(A.tx, A.tz) + c.yawOff; world.normalAt(A.x, A.z, n);
    q.setFromUnitVectors(UP, n); qy.setFromAxisAngle(UP, yaw); c.root.position.set(A.x, y, A.z); c.root.quaternion.copy(q).multiply(qy); c.root.updateMatrixWorld(true);
    c.angle += c.v * dt; for (const w of c.spins) w.spin.rotation.x = c.angle / w.R;
    // (its box among the colliders, where the player's car meets it)
    const col = c.col; if (c.colIn) colRemove(col); col.x = A.x; col.z = A.z; col.c = Math.cos(yaw); col.s = Math.sin(yaw); col.y0 = y - 0.5; col.y1 = y + 1.4; colInsert(col); c.colIn = true; };
  const reset = () => { for (const c of cars) { Object.assign(c, { s: c.grid.s, w: c.grid.w, wT: c.grid.w, v: 0, yawOff: 0, done: 0, hit: 0 }); place(c, 0); } results.length = 0; };
  const results = [];
  for (const c of cars) place(c, 0);

  // ---- the HUD: the order, the gaps, and at the end the results
  const box = document.createElement('div'); box.id = 'raceOrder';
  box.style.cssText = 'position:fixed;right:16px;top:44px;z-index:9;min-width:190px;padding:8px 12px;border-radius:9px;background:#090d13c8;border:1px solid #ffffff28;color:#fff;font:600 13px/1.5 "Segoe UI",system-ui,sans-serif;text-shadow:0 1px 3px #000;pointer-events:none';
  document.body.appendChild(box);
  const fmt = t => { const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2); };
  let frame = 0;
  const api = { cars, results, reset,
    update(dt, player) {
      const phase = clock.state.phase, show = player && player.driving; box.style.display = show ? '' : 'none';
      const me = player ? onRoad(player.st.pos.x, player.st.pos.z) : null, meV = player ? player.st.vel.length() : 0, ms = phase === 'finished' ? finishI + 0.5 : me ? me.s : 0;
      if (phase === 'running') for (const c of cars) {
        if (c.done) { c.v = Math.max(0, c.v - 6 * dt); c.s = Math.min(N - 3, c.s + c.v * dt); place(c, dt); continue; }
        // (the speed: what the road ahead allows, what the engine gives, the brakes when it must)
        const i = clamp(Math.floor(c.s), 0, N - 2), vt = Math.min(c.vb[Math.min(N - 1, i + 2)], c.vb[i]);
        const drag = 0.5 * 1.225 * c.pf.cda * c.v * c.v / c.pf.mass, aMax = Math.min(c.pf.acc, c.pf.power / (c.pf.mass * Math.max(c.v, 1))) * c.skill - drag;
        // (traffic: the nearest car ahead in its lane — a rival, or the player — and the other lane's room)
        let ahead = null, gap = 1e9, lane = c.wT; const others = cars.filter(o => o !== c).map(o => ({ s: o.s, w: o.w, v: o.v }));
        if (me && Math.abs(me.w) < half * 2 + 1) others.push({ s: me.s, w: me.w, v: meV });
        for (const o of others) { const ds = o.s - c.s; if (ds > 0 && ds < gap && Math.abs(o.w - c.w) < 1.9) { gap = ds; ahead = o; } }
        let target = vt;
        if (ahead && gap < 26 && ahead.v < c.v + 1) { const other = lanes > 1 ? (c.wT > 0 ? -half : half) : c.wT, free = others.every(o => Math.abs(o.w - other) > 1.9 || o.s - c.s < -9 || o.s - c.s > 18);
          if (free && lanes > 1 && R[i] > 120) lane = other; else target = Math.min(target, ahead.v + (gap - 7) * 0.5); }
        c.wT = lane;
        if (c.v < target) c.v = Math.min(target, c.v + aMax * dt); else c.v = Math.max(target, c.v - c.pf.brake * dt);
        if (c.hit > 0) { c.hit -= dt; c.v *= 1 - dt * 0.8; }
        const dw = clamp(c.wT - c.w, -1.6 * dt, 1.6 * dt); c.w += dw; c.yawOff = lerp(c.yawOff, -dw / Math.max(c.v * dt, 1e-3) * 0.8, 0.2);
        c.s += c.v * dt;
        // (bumped by the player: it slows and edges away)
        if (player) { const dx = player.st.pos.x - c.root.position.x, dz = player.st.pos.z - c.root.position.z; if (Math.hypot(dx, dz) < 3.4) { c.hit = 0.6; const side = me && me.w > c.w ? -1 : 1; c.w = clamp(c.w + side * dt * 1.2, -RW + 0.9, RW - 0.9); } }
        if (c.s >= finishI) { c.done = 1; results.push({ name: c.name, car: c.car, t: clock.state.t }); }
        place(c, dt);
      } else if (phase !== 'finished') for (const c of cars) place(c, 0);
      if (phase === 'finished' && player && !results.some(r => r.me)) results.push({ name: 'Ty', me: true, t: clock.state.result });
      if (++frame % 4) return;
      // (the order: by distance down the stage; finishers first, by their times)
      const all = [...cars.map(c => ({ name: c.name, car: c.car, s: c.done ? 1e9 - (results.find(r => r.name === c.name) || { t: 0 }).t : c.s, me: false })), { name: 'Ty', car: player ? player.id : '', s: phase === 'finished' ? 1e9 - clock.state.result : ms, me: true }].sort((a, b) => b.s - a.s);
      const pos = all.findIndex(a => a.me) + 1;
      if (phase === 'finished') box.innerHTML = `<div style="font:800 15px 'Segoe UI';color:#ffd54d;margin-bottom:3px">WYNIKI</div>` + [...results].sort((a, b) => a.t - b.t).map((r, k) => `<div style="${r.me ? 'color:#ffd54d;font-weight:800' : ''}">${k + 1}. ${r.name} <span style="float:right;margin-left:14px">${fmt(r.t)}</span></div>`).join('') + (results.length < all.length ? `<div style="opacity:.6">… na trasie: ${all.length - results.length}</div>` : '');
      else box.innerHTML = `<div style="font:800 26px/1.1 'Segoe UI'">P${pos}<span style="font-size:15px;opacity:.7"> / ${all.length}</span></div>` + all.map((a, k) => `<div style="${a.me ? 'color:#ffd54d;font-weight:800' : 'opacity:.85'}">${k + 1}. ${a.name}<span style="float:right;margin-left:14px;opacity:.7">${a.car === 'f40' ? 'F40' : a.car === 'i20' ? 'i20' : ''}</span></div>`).join('');
    } };
  return api;
}
