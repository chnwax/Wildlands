// A car you drive: the WRC Hyundai i20 (2017) — an Assetto Corsa export, its wheels (WHEEL_xx), brake calipers
// (SUSP_xx), steering wheel (STEER_HR), shift paddle and hydraulic handbrake their own nodes, rigged here — under a
// small real-time vehicle simulation, stepped at 480 Hz:
//  - a rigid body (mass, inertia) on four ray-cast wheels: springs, bump and rebound damping, bump stops, anti-roll bars;
//    the ground's own roughness (corrugations, potholes) felt through them
//  - tyres: longitudinal slip and slip angle combined on a friction ellipse through a Pacejka-like curve (a peak, then a
//    sliding plateau), grip by surface (gravel, loose edges, grass); each wheel's spin integrated implicitly in the
//    tyre's own stiffness, so a free wheel on a stiff tyre stays stable
//  - an engine with a torque curve, idle, a rev limiter and engine braking; a six-speed sequential gearbox (automatic, or
//    manual as soon as you shift yourself) with an ignition cut while it shifts; an automatic clutch for pulling away
//  - four-wheel drive with limited-slip coupling across each axle and between them; the handbrake locks the rear wheels
//    and opens the rear of the drivetrain, as a rally car's hydraulic handbrake does
//  - brakes with a front bias, rolling resistance, drag and downforce; the body's corners against the ground and its
//    sides against the world's colliders (trees, bales, posts)
// The cockpit camera sits at the driver's eyes and moves as a head does: leaning against the lateral and longitudinal g,
// shaken by the bumps, keeping a little of the horizon, glancing toward the corner as you steer; free look with the
// mouse. The driver's arms (a skinned rig with fingers, posed by IK) hold the rim at any angle: they turn with it, let it
// slide through the grip past a comfortable reach and shuffle along it one hand at a time; a shift is a flick of the
// fingers at the paddle behind the rim (the right hand up, the left down), and the right hand goes to the handbrake
// beside the wheel while it is pulled, the handbrake moving with it. The dash's
// shift lights count up the revs, the brake lights glow. C: cockpit / chase / bonnet view.
// Models: WRC Hyundai i20 2017 by vecarz (CC BY-NC-SA 4.0), First Person Arms by DJMaesen (CC BY 4.0); kept in
// Modeleaut/ next to the game (not in the repository).
import { THREE, scene, gltfLoader, collide, colInsert, colRemove, clamp, lerp } from './core.js';
import { audio } from './audio.js';
import { toastMsg } from './ui.js';

const MODEL = 'Modeleaut/wrc_hyundai_i20_2017texture4k.glb', ARMS = 'Modeleaut/first_person_arms.glb';
const G = 9.81;
// ---------------------------------------------------------------- the car (model space: front +z, left +x, ground y 0)
const SPEC = {
  mass: 1230, cg: [0, 0.47, 0.05], dims: [1.85, 1.25, 4.05], // (dims: the box its inertia is taken from)
  susp: { rest: 0.3, k: 34000, bump: 3000, rebound: 4400, travel: 0.22, arbF: 15000, arbR: 10000 },
  wheelI: 1.1, steerMax: 0.5, steerLock: 4.7, // (rad at the front wheels; the steering wheel turns ±270°)
  engine: { idle: 1000, limiter: 8200, inertia: 0.2, braking: 55, curve: [[0, 120], [1000, 190], [2000, 310], [3000, 430], [4000, 475], [5000, 485], [6000, 470], [7000, 430], [8000, 370], [9000, 260]] },
  gears: [-3.3, 0, 3.25, 2.38, 1.88, 1.53, 1.27, 1.07], final: 4.3, eff: 0.88, shiftTime: 0.1, // (0 reverse, 1 neutral, 2.. first..)
  brake: { front: 1650, rear: 720, hand: 3200 }, lsd: 300, center: 420,
  aero: { cda: 0.78, cla: 1.1, front: 0.45 }, crr: 0.016, rollCentre: 0.12,
};
const SURF = { gravel: { mu: 0.92, kp: 0.14, ap: 0.2, slide: 0.86 }, grass: { mu: 0.68, kp: 0.16, ap: 0.24, slide: 0.84 }, forest: { mu: 0.66, kp: 0.16, ap: 0.24, slide: 0.84 },
  asphalt: { mu: 1.15, kp: 0.09, ap: 0.14, slide: 0.9 }, concrete: { mu: 1.1, kp: 0.09, ap: 0.14, slide: 0.9 } };
const pac = s => Math.sin(1.3 * Math.atan(2.64 * s)); // (1 at s = 1)
const torqueAt = rpm => { const C = SPEC.engine.curve; for (let i = 0; i + 1 < C.length; i++) if (rpm <= C[i + 1][0]) return lerp(C[i][1], C[i + 1][1], (rpm - C[i][0]) / (C[i + 1][0] - C[i][0])); return C[C.length - 1][1]; };
// the tyre: normalised slips (sk = κ/κpeak, sa = tan α/tan αpeak) on one curve, the force split along them
function tyre(S, mu, Fz, sk, sa, out) {
  const sl = Math.hypot(sk, sa); if (sl < 1e-6 || Fz <= 0) { out[0] = out[1] = 0; return 0; }
  const f = mu * Fz * (sl <= 1 ? pac(sl) : lerp(1, S.slide, clamp((sl - 1) / 2, 0, 1)));
  out[0] = f * sk / sl; out[1] = -f * sa / sl; return sl;
}
const UP = new THREE.Vector3(0, 1, 0), XAX = new THREE.Vector3(1, 0, 0);
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _t = new THREE.Vector3(), _n = new THREE.Vector3(), _m = new THREE.Matrix4(), _e = new THREE.Euler();
const F2 = [0, 0], F3 = [0, 0];

export async function createCar(world, spawn) {
  const [g, ag] = await Promise.all([gltfLoader.loadAsync(MODEL), gltfLoader.loadAsync(ARMS).catch(() => null)]);
  const model = g.scene; model.updateMatrixWorld(true);
  const find = name => { let f = null; model.traverse(o => { if (!f && o.name && o.name.startsWith(name)) f = o; }); return f; };
  const boxOf = o => new THREE.Box3().setFromObject(o);
  const vertsOf = (o, every = 1) => { const pts = []; o.updateMatrixWorld(true); o.traverse(m => { if (!m.isMesh) return; const pa = m.geometry.attributes.position; for (let i = 0; i < pa.count; i += every) pts.push(new THREE.Vector3().fromBufferAttribute(pa, i).applyMatrix4(m.matrixWorld)); }); return pts; };
  model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m && m.map) m.map.anisotropy = 8; } });
  // (the paddle and the handbrake: their foot and their grip from their own vertices; the steering wheel's axis is its
  // thinnest direction, a wheel being a flat disc)
  const steerNode = find('STEER_HR'), shiftNode = find('shift_paddle'), handNode = find('handbrake');
  const ends = node => { if (!node) return null; const pts = vertsOf(node), b = boxOf(node), lo = new THREE.Vector3(), hi = new THREE.Vector3(); let nl = 0, nh = 0;
    for (const p of pts) { if (p.y < b.min.y + 0.03) { lo.add(p); nl++; } if (p.y > b.max.y - 0.04) { hi.add(p); nh++; } } return nl && nh ? { base: lo.multiplyScalar(1 / nl), top: hi.multiplyScalar(1 / nh) } : null; };
  const lever = ends(shiftNode), hbL = ends(handNode);
  let steerAxis = new THREE.Vector3(0, -0.33, 0.94).normalize(), steerHub = new THREE.Vector3(0.35, 0.77, 0.17), steerR = 0.17;
  if (steerNode) {
    const pts = vertsOf(steerNode, 5), c = pts.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / pts.length);
    let best = steerAxis, bv = Infinity; const d = new THREE.Vector3();
    for (let i = 0; i < 800; i++) { const t = Math.acos(1 - 2 * (i + 0.5) / 800), p = Math.PI * (1 + Math.sqrt(5)) * i; d.set(Math.sin(t) * Math.cos(p), Math.cos(t), Math.sin(t) * Math.sin(p)); if (d.z < 0) continue;
      let v = 0; for (const q of pts) { const k = _v.subVectors(q, c).dot(d); v += k * k; } if (v < bv) { bv = v; best = d.clone(); } }
    steerAxis = best.normalize(); steerHub = boxOf(steerNode).getCenter(new THREE.Vector3());
    const rr = pts.map(q => _v.subVectors(q, steerHub).projectOnPlane(steerAxis).length()).sort((a, b) => a - b); steerR = rr[Math.floor(rr.length * 0.97)] - 0.012; // (the rim's centre line)
  }
  const wheelBox = {}; for (const id of ['LF', 'RF', 'LR', 'RR']) wheelBox[id] = boxOf(find('WHEEL_' + id)); // (in the model's own space, before it is placed)
  const root = new THREE.Group(); root.name = 'car'; root.userData.dynamic = true; scene.add(root);
  const body = new THREE.Group(); body.position.set(-SPEC.cg[0], -SPEC.cg[1], -SPEC.cg[2]); root.add(body); body.add(model);
  model.updateMatrixWorld(true);
  const pivotAt = (node, at) => { const p = new THREE.Object3D(); p.position.copy(at); model.add(p); p.updateMatrixWorld(true); p.attach(node); return p; };
  const S0 = SPEC.susp.rest - SPEC.mass * G / 4 / SPEC.susp.k; // (the spring's length at the static load: the wheels where the model has them)
  const wheels = ['LF', 'RF', 'LR', 'RR'].map(id => {
    const node = find('WHEEL_' + id), susp = find('SUSP_' + id), bb = wheelBox[id], hub = bb.getCenter(new THREE.Vector3());
    const travel = new THREE.Object3D(); travel.position.copy(hub); model.add(travel); travel.updateMatrixWorld(true);
    const spin = new THREE.Object3D(); travel.add(spin); spin.updateMatrixWorld(true); spin.attach(node); if (susp) travel.attach(susp);
    return { id, front: id[1] === 'F', travel, spin, hubModel: hub.clone(), R: (bb.max.y - bb.min.y) / 2, hub: new THREE.Vector3(hub.x - SPEC.cg[0], hub.y - SPEC.cg[1], hub.z - SPEC.cg[2]),
      w: 0, angle: 0, c: 0, cv: 0, s: S0, Fz: 0, fs: 0, slip: 0, contact: false, surf: 'gravel', cp: new THREE.Vector3(), vx: 0, Td: 0, I: 1, rr: 0 };
  });
  const steerPivot = steerNode ? pivotAt(steerNode, steerHub) : null, shiftPivot = lever ? pivotAt(shiftNode, lever.base) : null, hbPivot = hbL ? pivotAt(handNode, hbL.base) : null;
  // the dash's shift lights and the brake lights (each its own material, so each lights alone)
  const glow = (node, color) => { const ms = []; if (node) node.traverse(o => { if (!o.isMesh) return; o.material = o.material.clone(); o.material.emissive = new THREE.Color(color); o.material.emissiveIntensity = 0; ms.push(o.material); }); return ms; };
  const leds = []; for (let i = 0; i < 21; i++) { const n = find('LED_' + i + '_'); if (n) leds.push(glow(n, i < 7 ? 0x30ff40 : i < 14 ? 0xff2a1a : 0x3a6bff)); }
  const brakeLights = [...glow(find('LIGHT_REAR_BRAKE'), 0xff1a10), ...glow(find('LIGHT_REAR00'), 0xff1a10), ...glow(find('LIGHT_REAR01'), 0xff1a10)];
  // ---- the driver: the first-person arms, their chest set so the shoulders sit below and either side of the eyes
  const driver = new THREE.Group(); driver.name = 'driver'; model.add(driver);
  const eye = new THREE.Vector3(steerHub.x, steerHub.y + 0.33, steerHub.z - 0.53); // (the driver's eyes)
  const rig = ag ? armsRig(ag.scene, driver, eye.clone().add(new THREE.Vector3(0, -0.237, -0.09)), 0.0118) : null;
  // ---- physics state
  const m = SPEC.mass, [W, H, L] = SPEC.dims, Ib = new THREE.Vector3(m / 12 * (H * H + L * L), m / 12 * (W * W + L * L) * 0.9, m / 12 * (W * W + H * H)); // (pitch, yaw, roll)
  const st = { pos: new THREE.Vector3(), q: new THREE.Quaternion(), vel: new THREE.Vector3(), ang: new THREE.Vector3(),
    steer: 0, steerIn: 0, throttle: 0, brake: 0, hand: 0, gear: 2, rpm: SPEC.engine.idle, shiftT: 0, auto: true, revT: 0, locked: false,
    accLocal: new THREE.Vector3(), velLocal: new THREE.Vector3(), lastVel: new THREE.Vector3(), slipMax: 0 };
  const car = { root, st, wheels, rig, cockpit: { steerHub, steerAxis, get steerR() { return steerR; } }, driving: true, view: 0, inputOn: false, world, spec: SPEC,
    look: { yaw: 0, pitch: 0, idle: 9 }, head: { p: new THREE.Vector3(), v: new THREE.Vector3(), r: 0, rv: 0 }, anim: { shift: 0, dir: 0, hb: 0, reach: 0, to: null } };
  // (a box for the walker to bump into while the car stands; out of the car's own way)
  const col = { t: 1, x: 0, z: 0, hx: 0.95, hz: 2.05, c: 1, s: 0, y0: -1e9, y1: 1e9 }; let colIn = false;
  const place = (x, z, yaw) => { st.pos.set(x, world.groundAt(x, z) + SPEC.cg[1] + 0.01, z); st.q.setFromAxisAngle(UP, yaw); st.vel.set(0, 0, 0); st.ang.set(0, 0, 0); for (const w of wheels) { w.w = 0; w.c = SPEC.susp.rest - S0; } st.gear = 2; st.rpm = SPEC.engine.idle; };
  place(spawn.x, spawn.z, spawn.yaw);

  // ---------------------------------------------------------------- controls: keyboard, mouse buttons, a gamepad
  const padPrev = {};
  car.control = (keys, dt) => {
    if (!car.driving) { st.throttle = 0; st.brake = 0; st.hand = 1; st.steerIn *= Math.exp(-dt * 3); st.steer = st.steerIn; return; }
    let steerT = 0, thr = 0, brk = 0, hb = 0, analog = false;
    if (keys) {
      steerT = (keys.KeyA || keys.ArrowLeft ? 1 : 0) - (keys.KeyD || keys.ArrowRight ? 1 : 0); thr = keys.KeyW || keys.ArrowUp ? 1 : 0; brk = keys.KeyS || keys.ArrowDown ? 1 : 0; hb = keys.Space ? 1 : 0;
      const gp = navigator.getGamepads ? [...navigator.getGamepads()].find(p => p && p.connected) : null;
      if (gp) { const ax = gp.axes[0] || 0; if (Math.abs(ax) > 0.06) { steerT = -Math.sign(ax) * ((Math.abs(ax) - 0.06) / 0.94) ** 1.3; analog = true; }
        const rt = gp.buttons[7] ? gp.buttons[7].value : 0, lt = gp.buttons[6] ? gp.buttons[6].value : 0; if (rt > 0.04) { thr = Math.max(thr, rt); analog = true; } if (lt > 0.04) { brk = Math.max(brk, lt); analog = true; }
        if (gp.buttons[0] && gp.buttons[0].pressed) hb = 1;
        for (const [b, f] of [[5, () => car.shift(1)], [4, () => car.shift(-1)], [3, () => car.cycleView()], [8, () => car.reset()], [2, () => car.toggleAuto()]]) { const p = !!(gp.buttons[b] && gp.buttons[b].pressed); if (p && !padPrev[b]) f(); padPrev[b] = p; } }
    }
    const v = st.velLocal.z;
    // (the steering: the input eased in and back to the centre; above a crawl it asks the front tyres for their best slip
    // angle, measured from where the front axle is actually going, so full lock on a key never just ploughs on, the
    // wheels follow a slide by themselves as a car's caster makes them, and the counter-steer is there when it slides)
    if (analog) st.steerIn = lerp(st.steerIn, steerT, 1 - Math.exp(-dt * 16));
    else { const rate = (steerT !== 0 && Math.sign(steerT) === Math.sign(st.steerIn) ? 3.2 : 6) * lerp(1, 0.6, clamp(Math.abs(v) / 40, 0, 1)); st.steerIn += clamp(steerT - st.steerIn, -rate * dt, rate * dt); }
    const angY = st.angLocalY || 0, betaF = Math.atan2(st.velLocal.x + angY * (wheels[0].hub.z), Math.max(Math.abs(v), 1)) * Math.sign(v || 1);
    const k = clamp((Math.abs(v) - 4) / 10, 0, 1) * (analog ? 0.75 : 1);
    st.steer = clamp(lerp(st.steerIn, (betaF + st.steerIn * 0.19) / SPEC.steerMax, k), -1, 1);
    st.assist = !analog; // (keys cannot ease a brake off: the brakes keep the wheels from locking for them)
    // (in reverse, S drives and W brakes; the automatic engages reverse after a moment of S at a standstill)
    if (st.auto) { if (st.gear >= 1 && Math.abs(v) < 1.2 && brk > 0.5 && thr < 0.1) { st.revT += dt; if (st.revT > 0.35) { st.gear = 0; st.revT = 0; } }
      else if (st.gear === 0 && v > -0.5 && thr > 0.5 && brk < 0.1) { st.revT += dt; if (st.revT > 0.2) { st.gear = 2; st.revT = 0; } } else st.revT = 0; }
    let t = thr, b = brk; if (st.gear === 0) { t = brk; b = thr; }
    const ramp = (x, y, up, down) => x + clamp(y - x, -down * dt, up * dt);
    st.throttle = analog ? t : ramp(st.throttle, t, 6, 10); st.brake = analog ? b : ramp(st.brake, b, 6, 10); st.hand = ramp(st.hand, hb, 10, 6);
  };
  car.shift = d => { if (!car.driving) return; if (st.auto && !car._auto) { st.auto = false; toastMsg('Manual gearbox — X: automatic'); }
    const g1 = clamp(st.gear + d, 0, SPEC.gears.length - 1); if (g1 === st.gear || (g1 === 0 && st.velLocal.z > 1.5)) return;
    st.gear = g1; st.shiftT = SPEC.shiftTime; car.anim.shift = 1; car.anim.dir = d; sound.click(d); };
  car.toggleAuto = () => { st.auto = !st.auto; toastMsg(st.auto ? 'Automatic gearbox' : 'Manual gearbox: E / Shift up, Q down (or the mouse buttons)'); };
  car.reset = () => { const f = _v.set(0, 0, 1).applyQuaternion(st.q); place(st.pos.x, st.pos.z, Math.atan2(f.x, f.z)); toastMsg('Car reset'); };
  car.cycleView = () => { car.view = (car.view + 1) % 3; toastMsg(['Cockpit', 'Chase camera', 'Bonnet camera'][car.view]); };
  car.lookMouse = (dx, dy) => { const Lk = car.look; Lk.yaw = clamp(Lk.yaw - dx * 0.0022, -2.3, 2.3); Lk.pitch = clamp(Lk.pitch - dy * 0.0022, -0.9, 0.7); Lk.idle = 0; };
  addEventListener('keydown', e => { if (!car.inputOn || !car.driving || e.repeat) return;
    if (e.code === 'KeyE' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') car.shift(1); else if (e.code === 'KeyQ' || e.code === 'KeyZ') car.shift(-1); });
  addEventListener('mousedown', e => { if (!car.inputOn || !car.driving || !document.pointerLockElement) return; if (e.button === 0) car.shift(1); else if (e.button === 2) car.shift(-1); });
  addEventListener('contextmenu', e => { if (car.inputOn && document.pointerLockElement) e.preventDefault(); });

  // ---------------------------------------------------------------- the simulation
  const F = new THREE.Vector3(), T = new THREE.Vector3(), R3 = new THREE.Matrix3(), Rt = new THREE.Matrix3();
  const addForce = (f, at) => { F.add(f); T.add(_t.subVectors(at, st.pos).cross(f)); };
  const ground = (x, z) => world.groundAt(x, z) + (world.bumpAt ? world.bumpAt(x, z) : 0);
  const up = new THREE.Vector3(), fwd = new THREE.Vector3(), down = new THREE.Vector3(), anchor = new THREE.Vector3(), wf = new THREE.Vector3(), wl = new THREE.Vector3(), r = new THREE.Vector3(), vp = new THREE.Vector3(), fv = new THREE.Vector3(), pr = { x: 0, y: 0, z: 0 };
  function stepPhys(h) {
    const { susp } = SPEC, q = st.q;
    F.set(0, -m * G, 0); T.set(0, 0, 0);
    up.set(0, 1, 0).applyQuaternion(q); fwd.set(0, 0, 1).applyQuaternion(q); down.copy(up).negate();
    // ---- the suspension: each wheel's ray down from the spring's top to the ground
    for (const w of wheels) {
      anchor.copy(w.hub).applyQuaternion(q).add(st.pos).addScaledVector(up, S0);
      const dy = Math.max(0.3, -down.y); let t = (anchor.y - ground(anchor.x, anchor.z)) / dy; t = (anchor.y - ground(anchor.x + down.x * t, anchor.z + down.z * t)) / dy;
      const s = t - w.R, comp = susp.rest - s, c = clamp(comp, 0, susp.travel + 0.08);
      w.cv = (c - w.c) / h; w.c = c; w.contact = comp > 0; w.s = clamp(s, susp.rest - susp.travel, susp.rest);
      w.cp.copy(anchor).addScaledVector(down, t);
      const cv = Math.abs(w.cv) < 0.12 ? w.cv : Math.sign(w.cv) * (0.12 + (Math.abs(w.cv) - 0.12) * 0.35); // (digressive: soft over sharp bumps)
      let fs = w.contact ? susp.k * c + (w.cv > 0 ? susp.bump : susp.rebound) * cv : 0; if (c > susp.travel) fs += (c - susp.travel) * 450000;
      w.fs = fs;
    }
    for (const [a, b, k] of [[0, 1, susp.arbF], [2, 3, susp.arbR]]) { const wa = wheels[a], wb = wheels[b], d = (wa.contact ? wa.c : 0) - (wb.contact ? wb.c : 0); if (wa.contact) wa.fs += k * d; if (wb.contact) wb.fs -= k * d; }
    // ---- the drivetrain: the engine's speed from the driven wheels, the clutch slipping below the launch revs
    const hb = st.hand > 0.3, ratio = hb ? 0 : SPEC.gears[st.gear], Gt = ratio * SPEC.final, inGear = ratio !== 0; // (the handbrake opens the clutch too)
    let wSum = 0, nW = 0; for (const w of wheels) if (!hb || w.front) { wSum += w.w; nW++; }
    const rpmW = Math.max(0, wSum / nW * Gt) * 60 / (2 * Math.PI), thr = st.shiftT > 0 ? 0 : st.throttle;
    let Tw = 0; st.locked = false;
    if (inGear) { const launch = SPEC.engine.idle + 3200 * thr;
      if (rpmW < launch) { st.rpm += (launch - st.rpm) * Math.min(1, h * 9); Tw = torqueAt(st.rpm) * thr * Gt * SPEC.eff; }
      else { st.locked = true; st.rpm = rpmW; const tq = st.rpm > SPEC.engine.limiter ? 0 : thr; Tw = (torqueAt(st.rpm) * tq - SPEC.engine.braking * (1 - tq) * clamp(st.rpm / 6000, 0.2, 1)) * Gt * SPEC.eff; } }
    else st.rpm += (Math.min(SPEC.engine.limiter, SPEC.engine.idle + st.throttle * 7400) - st.rpm) * Math.min(1, h * (st.throttle > 0.05 ? 7 : 3));
    const Ie = st.locked ? SPEC.engine.inertia * Gt * Gt / nW : 0;
    // (the couplings: across each axle, and between the axles unless the handbrake has opened the rear)
    const fa = (wheels[0].w + wheels[1].w) / 2, ra = (wheels[2].w + wheels[3].w) / 2;
    for (const w of wheels) { const other = wheels[w.front ? (w === wheels[0] ? 1 : 0) : (w === wheels[2] ? 3 : 2)], connected = !hb || w.front;
      w.Td = (connected ? Tw / nW : 0) + clamp((other.w - w.w) * SPEC.lsd, -800, 800) + (hb ? 0 : clamp(((w.front ? ra : fa) - (w.front ? fa : ra)) * SPEC.center * 0.5, -800, 800));
      w.I = SPEC.wheelI + (connected ? Ie : 0); }
    // ---- the tyres
    let slipMax = 0;
    for (const w of wheels) {
      const steerA = w.front ? st.steer * SPEC.steerMax : 0, bh = w.front ? 0 : SPEC.brake.hand * st.hand; let bt = (w.front ? SPEC.brake.front : SPEC.brake.rear) * st.brake;
      let fx = 0, dfdw = 0; w.slip = 0; w.Fz = 0; w.rr = 0;
      if (w.contact) {
        world.normalAt(w.cp.x, w.cp.z, _n);
        wf.copy(fwd).applyAxisAngle(up, steerA); wf.addScaledVector(_n, -_n.dot(wf)).normalize(); wl.crossVectors(_n, wf);
        r.subVectors(w.cp, st.pos); vp.crossVectors(st.ang, r).add(st.vel);
        const vx = vp.dot(wf), vy = vp.dot(wl); w.vx = vx;
        w.surf = world.surfaceAt ? world.surfaceAt(w.cp.x, w.cp.z) : 'gravel'; const S = SURF[w.surf] || SURF.gravel, mu = S.mu * (world.gripAt ? world.gripAt(w.cp.x, w.cp.z) : 1);
        const Fz = Math.max(0, w.fs); w.Fz = Fz;
        const den = Math.max(Math.abs(vx), 2), kappa = (w.w * w.R - vx) / den, sa = Math.tan(clamp(Math.atan2(vy, Math.max(Math.abs(vx), 0.6)), -1.4, 1.4)) / Math.tan(S.ap * (w.front ? 1 : 1.12));
        w.slip = tyre(S, mu, Fz, kappa / S.kp, sa, F2); fx = F2[0]; let fy = F2[1];
        if (st.assist && bt > 0 && vx > 2) bt *= clamp(1 - (-kappa / S.kp - 0.9) * 1.6, 0.25, 1);
        tyre(S, mu, Fz, (kappa + 0.002) / S.kp, sa, F3); dfdw = (F3[0] - fx) / 0.002 * w.R / den;
        const spd = Math.hypot(vx, vy); if (spd < 1.2) fy -= vy * Fz * 0.9 * (1 - spd / 1.2); // (at a crawl the tyre holds: no creep sideways)
        slipMax = Math.max(slipMax, w.slip);
        fv.copy(up).multiplyScalar(Fz).addScaledVector(wf, fx).addScaledVector(wl, fy);
        addForce(fv, _a.copy(w.cp).addScaledVector(up, SPEC.rollCentre));
        w.rr = SPEC.crr * Fz * w.R;
      }
      // the wheel's spin (implicit in the tyre's own stiffness), then the brakes and rolling resistance as friction
      w.w += h * (w.Td - fx * w.R) / (w.I + h * w.R * Math.max(0, dfdw));
      const dw = (bt + bh + w.rr) * h / w.I; w.w = Math.abs(w.w) <= dw ? 0 : w.w - Math.sign(w.w) * dw;
    }
    st.slipMax = slipMax;
    // ---- the air
    const vF = st.vel.dot(fwd), sp = st.vel.length();
    if (sp > 0.1) { addForce(_v.copy(st.vel).multiplyScalar(-0.5 * 1.225 * SPEC.aero.cda * sp), st.pos);
      const dfz = 0.5 * 1.225 * SPEC.aero.cla * vF * vF; addForce(_v.copy(down).multiplyScalar(dfz * SPEC.aero.front), _w.copy(fwd).multiplyScalar(1.25).add(st.pos)); addForce(_v.copy(down).multiplyScalar(dfz * (1 - SPEC.aero.front)), _w.copy(fwd).multiplyScalar(-1.25).add(st.pos)); }
    // ---- the body against the ground (its corners, its roof) and against the world (its sides)
    for (const [bx, by, bz] of CORNERS) { const p = _v.set(bx, by, bz).applyQuaternion(q).add(st.pos), d = world.groundAt(p.x, p.z) - p.y; if (d <= 0) continue;
      r.subVectors(p, st.pos); vp.crossVectors(st.ang, r).add(st.vel); const fn = Math.max(0, 250000 * d - 9000 * vp.y), l = Math.hypot(vp.x, vp.z);
      fv.set(l > 1e-3 ? -vp.x / l * 0.6 * fn : 0, fn, l > 1e-3 ? -vp.z / l * 0.6 * fn : 0); addForce(fv, p); }
    if (colIn) col.y1 = -1e9; // (not against its own box)
    for (const [bx, by, bz] of SIDES) { const p = _v.set(bx, by, bz).applyQuaternion(q).add(st.pos); pr.x = p.x; pr.y = p.y - 0.45; pr.z = p.z; collide(pr, 0.22, 1.1);
      const dx = pr.x - p.x, dz = pr.z - p.z, d = Math.hypot(dx, dz); if (d < 1e-4) continue;
      const nx = dx / d, nz = dz / d; r.subVectors(p, st.pos); vp.crossVectors(st.ang, r).add(st.vel); const vn = vp.x * nx + vp.z * nz, fn = Math.max(0, 320000 * d - 24000 * vn);
      const tx = vp.x - vn * nx, tz = vp.z - vn * nz, tl = Math.hypot(tx, tz); fv.set(nx * fn - (tl > 1e-3 ? tx / tl * 0.35 * fn : 0), 0, nz * fn - (tl > 1e-3 ? tz / tl * 0.35 * fn : 0)); addForce(fv, p); }
    if (colIn) col.y1 = 1e9;
    // ---- integrate (the angular part in the body's frame: its inertia is diagonal there)
    st.vel.addScaledVector(F, h / m); st.pos.addScaledVector(st.vel, h);
    R3.setFromMatrix4(_m.makeRotationFromQuaternion(q)); Rt.copy(R3).transpose();
    const wb = _a.copy(st.ang).applyMatrix3(Rt), Lb = _b.set(wb.x * Ib.x, wb.y * Ib.y, wb.z * Ib.z), tb = _c.copy(T).applyMatrix3(Rt).sub(_w.crossVectors(wb, Lb));
    wb.x += tb.x / Ib.x * h; wb.y += tb.y / Ib.y * h; wb.z += tb.z / Ib.z * h; st.ang.copy(wb.applyMatrix3(R3));
    const ax = st.ang.x * h * 0.5, ay = st.ang.y * h * 0.5, az = st.ang.z * h * 0.5, qx = q.x, qy = q.y, qz = q.z, qw = q.w;
    q.set(qx + ax * qw + ay * qz - az * qy, qy - ax * qz + ay * qw + az * qx, qz + ax * qy - ay * qx + az * qw, qw - ax * qx - ay * qy - az * qz).normalize();
    if (st.shiftT > 0) st.shiftT -= h;
    // (at rest with nothing pressed, the last creep taken out)
    if (st.vel.lengthSq() < 0.01 && st.ang.lengthSq() < 0.004 && st.throttle < 0.02 && wheels.every(w => w.contact)) { st.vel.multiplyScalar(0.98); st.ang.multiplyScalar(0.98); }
  }
  // the automatic: up near the limiter, down as the revs fall away
  function autoBox() {
    if (!st.auto || st.gear < 2 || st.shiftT > 0) return;
    car._auto = true;
    if (st.rpm > 7650 && st.gear < SPEC.gears.length - 1 && st.locked && st.throttle > 0.2) car.shift(1);
    else if (st.gear > 2) { const rv = Math.abs(st.velLocal.z) / wheels[0].R * SPEC.gears[st.gear] * SPEC.final * 60 / (2 * Math.PI), lower = rv * SPEC.gears[st.gear - 1] / SPEC.gears[st.gear];
      if (rv < (st.brake > 0.2 ? 4700 : 3400) && lower < SPEC.engine.limiter - 700) car.shift(-1); }
    car._auto = false;
  }
  let acc = 0;
  car.update = dt => {
    acc += Math.min(dt, 0.05); let n = 0; const h = 1 / 480;
    while (acc >= h && n < 30) { stepPhys(h); acc -= h; n++; }
    autoBox();
    const inv = _m.makeRotationFromQuaternion(st.q).invert(); st.velLocal.copy(st.vel).applyMatrix4(inv); st.angLocalY = _w.copy(st.ang).applyMatrix4(inv).y;
    if (dt > 0) { const a = _v.subVectors(st.vel, st.lastVel).multiplyScalar(1 / dt).applyMatrix4(inv); st.accLocal.lerp(a, 1 - Math.exp(-dt * 7)); }
    st.lastVel.copy(st.vel);
    root.position.copy(st.pos); root.quaternion.copy(st.q);
    for (const w of wheels) { w.angle = (w.angle + w.w * dt) % (Math.PI * 2);
      w.travel.position.set(w.hubModel.x, w.hubModel.y + S0 - (w.contact ? w.s : SPEC.susp.rest), w.hubModel.z);
      w.travel.quaternion.setFromAxisAngle(UP, w.front ? st.steer * SPEC.steerMax : 0); w.spin.quaternion.setFromAxisAngle(XAX, w.angle); }
    animate(dt);
    // the walker's box: in the hash while the car stands without its driver
    if (!car.driving) { const f = _v.set(0, 0, 1).applyQuaternion(st.q), yaw = Math.atan2(f.x, f.z);
      if (!colIn || Math.hypot(col.x - st.pos.x, col.z - st.pos.z) > 0.05) { if (colIn) colRemove(col); col.x = st.pos.x; col.z = st.pos.z; col.c = Math.cos(yaw); col.s = Math.sin(yaw); col.y0 = st.pos.y - 0.6; col.y1 = 1e9; colInsert(col); colIn = true; } }
    else if (colIn) { colRemove(col); colIn = false; }
    root.updateMatrixWorld(true);
    sound.update(); hud.update();
  };
  // ---------------------------------------------------------------- the cockpit's moving parts and the driver's arms
  // (in the wheel's plane: up, and to the driver's left; a hand's place on the rim is an angle from the top toward the left)
  const upw = UP.clone().projectOnPlane(steerAxis).normalize(), leftw = new THREE.Vector3().crossVectors(upw, steerAxis).normalize();
  const rimRad = (th, out) => out.copy(upw).multiplyScalar(Math.cos(th)).addScaledVector(leftw, Math.sin(th));
  const TH0 = { L: Math.PI / 2 - 0.22, R: -(Math.PI / 2 - 0.22) }, thumbSign = {}; // (home: a quarter to three, a little high)
  for (const sd of ['L', 'R']) thumbSign[sd] = Math.sign(new THREE.Vector3().crossVectors(steerAxis, rimRad(TH0[sd], new THREE.Vector3())).dot(upw)) || 1;
  // where each hand may hold the rim (beyond it the rim slides through the grip) and past where it goes back for a new hold
  const RANGE = { L: [-0.6, 2.6], R: [-2.6, 0.6] }, REGRIP = { L: [-0.32, 2.3], R: [-2.3, 0.32] }, FLY = 0.17;
  const pose = () => ({ p: new THREE.Vector3(), q: new THREE.Quaternion() });
  const hs = { L: { phi: TH0.L, fly: 0, from: pose() }, R: { phi: TH0.R, fly: 0, from: pose() } };
  const rad = new THREE.Vector3(), gC = new THREE.Vector3(), gA = new THREE.Vector3(), gS = new THREE.Vector3();
  const rimPose = (side, th, out) => { rimRad(th, rad); gC.copy(steerHub).addScaledVector(rad, steerR); gA.crossVectors(steerAxis, rad).multiplyScalar(thumbSign[side]); gS.copy(rad).multiplyScalar(1 - rig.back).addScaledVector(steerAxis, -rig.back).normalize(); return rig.target(side, gC, gA, gS, out, rig.diag); };
  const leverPose = (Lv, ang, s, out) => { const top = Lv.top.clone().sub(Lv.base).applyAxisAngle(XAX, ang).add(Lv.base), A = top.clone().sub(Lv.base).normalize(); return rig.target('R', top.addScaledVector(A, -0.04), A, s, out); };
  const sHand = new THREE.Vector3(0.3, 0.25, -0.92).normalize();
  const poleL = new THREE.Vector3(1, -1, -0.35), poleR = new THREE.Vector3(-1, -1, -0.35), poleHb = new THREE.Vector3(-1, -0.2, -0.6), pole = new THREE.Vector3();
  const P0 = pose(), P1 = pose(), P2 = pose(), lift = new THREE.Vector3();
  // a hand on the rim, holding, sliding, or on its way back to its home hold
  const onRim = (side, rot, out) => {
    const h = hs[side];
    if (h.fly > 0) { const k0 = 1 - h.fly, k = k0 * k0 * (3 - 2 * k0); rimPose(side, TH0[side], out); out.p.lerpVectors(h.from.p, out.p, k); out.q.slerpQuaternions(h.from.q, out.q, k);
      out.p.add(lift.copy(steerAxis).multiplyScalar(-0.07).addScaledVector(UP, 0.02).multiplyScalar(Math.sin(k0 * Math.PI))); return 1 - 0.55 * Math.sin(k0 * Math.PI); }
    return rimPose(side, h.phi + rot, out), 1;
  };
  function animate(dt) {
    const A = car.anim, rot = st.steer * SPEC.steerLock;
    if (steerPivot) steerPivot.quaternion.setFromAxisAngle(steerAxis, -rot);
    // a shift: the fingers of one hand leave the rim for the paddle behind it, pull, and close round the rim again
    if (A.shift > 0) A.shift = Math.max(0, A.shift - dt / 0.28);
    const fl = A.shift > 0 ? Math.sin(clamp((1 - A.shift) / 0.75, 0, 1) * Math.PI) : 0, flR = A.dir > 0 ? fl : 0, flL = A.dir < 0 ? fl : 0;
    if (shiftPivot) shiftPivot.quaternion.setFromAxisAngle(XAX, -0.1 * Math.max(0, Math.sin(clamp((1 - A.shift) / 0.75 - 0.2, 0, 1) * Math.PI)) * (A.dir > 0 ? 1 : 0));
    A.hb = lerp(A.hb, st.hand, 1 - Math.exp(-dt * 18)); const hbA = -0.32 * A.hb; if (hbPivot) hbPivot.quaternion.setFromAxisAngle(XAX, hbA);
    // the shift lights and the brake lights
    const lit = Math.round(clamp((st.rpm - 5600) / (SPEC.engine.limiter - 5600), 0, 1) * leds.length), blink = st.rpm > SPEC.engine.limiter - 250 && (performance.now() % 140 < 70);
    leds.forEach((ms, i) => { const v = blink ? 3 : i < lit ? 2.5 : 0; for (const mm of ms) mm.emissiveIntensity = v; });
    for (const mm of brakeLights) mm.emissiveIntensity = car.driving && st.brake > 0.05 ? 3 : 0;
    driver.visible = !!rig && car.driving && car.view === 0; if (!driver.visible) return;
    // the right hand's errand: to the handbrake while it is pulled
    const want = st.hand > 0.08 && hbL ? 'hb' : null;
    A.reach = lerp(A.reach, want ? 1 : 0, 1 - Math.exp(-dt * (want ? 17 : 11))); if (want) A.to = want;
    if (A.reach < 0.003) A.reach = 0;
    // on the rim: each hand turns with the wheel; past its reach the rim slides through it, and past its comfort it lets
    // go and takes a new hold at home — one hand at a time, never both, and the left one only while the right one holds
    for (const side of ['L', 'R']) {
      const h = hs[side], other = hs[side === 'L' ? 'R' : 'L'];
      if (side === 'R' && A.reach > 0) { // (on an errand: its hold on the rim moves home, so it comes back there)
        if (!h.away && h.fly === 0) { rimPose(side, h.phi + rot, h.from); h.fly = 1; } h.away = true;
        if (h.fly > 0) { h.fly -= dt / FLY; if (h.fly <= 0) h.fly = 0; } h.phi = TH0.R - rot; continue; }
      h.away = false;
      if (h.fly > 0) { h.fly -= dt / FLY; if (h.fly <= 0) { h.fly = 0; h.phi = TH0[side] - rot; } continue; }
      let th = h.phi + rot; const [a, b] = RANGE[side], [ra, rb] = REGRIP[side];
      if (th < a || th > b) { th = clamp(th, a, b); h.phi = th - rot; }
      if ((th < ra || th > rb) && other.fly === 0 && A.reach === 0) { rimPose(side, th, h.from); h.fly = 1; }
    }
    const cL = onRim('L', rot, P0), cR = onRim('R', rot, P1);
    if (flL) P0.p.add(lift.set(-0.012, 0.004, 0.02).multiplyScalar(flL)); if (flR) P1.p.add(lift.set(0.012, 0.004, 0.02).multiplyScalar(flR)); // (the hand leans in to the paddle)
    let curlR = cR;
    if (A.reach > 0) { // (off the rim, out round it, to the handbrake beside the wheel)
      leverPose(hbL, hbA, sHand, P2);
      const k = A.reach * A.reach * (3 - 2 * A.reach); P1.p.lerp(P2.p, k); P1.q.slerp(P2.q, k);
      P1.p.add(lift.set(-0.07, 0.025, -0.03).multiplyScalar(Math.sin(k * Math.PI))); curlR = lerp(cR, 0.95, k) - 0.4 * Math.sin(k * Math.PI);
      pole.copy(poleR).lerp(A.to === 'hb' ? poleHb : poleR, k);
    } else pole.copy(poleR);
    rig.solve('L', P0.p, P0.q, cL, poleL, flL); rig.solve('R', P1.p, P1.q, curlR, pole, flR * (1 - A.reach));
  }

  // ---------------------------------------------------------------- the camera
  const eyeB = new THREE.Vector3(), bonnet = new THREE.Vector3(0, 0.98, 1.05), qLook = new THREE.Quaternion(), qH = new THREE.Quaternion(), level = new THREE.Quaternion(), cgV = new THREE.Vector3(...SPEC.cg);
  car.applyCamera = (cam, dt) => {
    const Lk = car.look; Lk.idle += dt; if (Lk.idle > 1.5) { const f = Math.exp(-dt * 2.5); Lk.yaw *= f; Lk.pitch *= f; }
    if (car.view === 1) { // chase: behind and above, swinging round after the car
      const f = _v.set(0, 0, 1).applyQuaternion(st.q); f.y = 0; f.normalize();
      const yawC = Math.atan2(f.x, f.z) + Lk.yaw; car.chaseYaw = car.chaseYaw === undefined ? yawC : car.chaseYaw + Math.atan2(Math.sin(yawC - car.chaseYaw), Math.cos(yawC - car.chaseYaw)) * (1 - Math.exp(-dt * 4.5));
      const tgt = _a.copy(st.pos).addScaledVector(UP, 0.85), want = _b.copy(tgt).add(_w.set(-Math.sin(car.chaseYaw) * 6.3, 1.45 + Lk.pitch * 2.5, -Math.cos(car.chaseYaw) * 6.3));
      want.y = Math.max(want.y, world.groundAt(want.x, want.z) + 0.6);
      car.chasePos = car.chasePos ? car.chasePos.lerp(want, 1 - Math.exp(-dt * 10)) : want.clone();
      cam.position.copy(car.chasePos); cam.up.set(0, 1, 0); cam.lookAt(tgt); setLens(cam, 0.15, 64); return; }
    // the head on a spring, pushed by the car's acceleration (local: x left, y up, z forward)
    const a = st.accLocal, Hd = car.head;
    const target = _a.set(clamp(-a.x * 0.0042, -0.07, 0.07), clamp(-a.y * 0.0018, -0.03, 0.03), clamp(-a.z * 0.0038, -0.06, 0.06));
    Hd.v.addScaledVector(_b.subVectors(target, Hd.p), 140 * dt); Hd.v.multiplyScalar(Math.exp(-17 * dt)); Hd.p.addScaledVector(Hd.v, dt);
    const rollT = clamp(a.x * 0.0055, -0.06, 0.06); Hd.rv += (rollT - Hd.r) * 100 * dt; Hd.rv *= Math.exp(-15 * dt); Hd.r += Hd.rv * dt;
    eyeB.copy(car.view === 2 ? bonnet : eye); if (car.view === 0) eyeB.add(Hd.p);
    eyeB.sub(cgV).applyQuaternion(st.q).add(st.pos);
    // (a glance toward the corner as you steer and as the car slides)
    const apex = car.view === 0 ? clamp((st.steer * 0.2 + Math.atan2(st.velLocal.x, Math.max(5, Math.abs(st.velLocal.z))) * 0.3) * clamp(Math.abs(st.velLocal.z) / 8, 0, 1), -0.42, 0.42) : 0;
    car.apex = car.apex === undefined ? apex : lerp(car.apex, apex, 1 - Math.exp(-dt * 5));
    qLook.setFromEuler(_e.set(Lk.pitch - 0.07, Math.PI + Lk.yaw + car.apex, car.view === 0 ? Hd.r : 0, 'YXZ'));
    // (the car's pitch and roll followed mostly: a head keeps a little of the horizon)
    level.setFromUnitVectors(_v.set(0, 1, 0).applyQuaternion(st.q), UP); qH.identity().slerp(level, car.view === 0 ? 0.25 : 0.1).multiply(st.q);
    cam.position.copy(eyeB); cam.quaternion.copy(qH).multiply(qLook); setLens(cam, 0.035, car.view === 0 ? 58 : 62);
  };
  const setLens = (cam, near, fov) => { if (cam.near !== near || cam.fov !== fov) { cam.near = near; cam.fov = fov; cam.updateProjectionMatrix(); } };
  car.leave = () => { car.driving = false; const side = _v.set(1.7, 0, -0.1).applyQuaternion(st.q).add(st.pos); return { x: side.x, z: side.z }; };
  car.enter = () => { car.driving = true; car.look.yaw = 0; car.look.pitch = 0; };
  car.near = p => Math.hypot(p.x - st.pos.x, p.z - st.pos.z) < 4;

  const sound = engineSound(car), hud = carHud(car);
  car.update(0);
  return car;
}
// the body's corners (against the ground) and sides (against the world), body frame (the centre of mass at 0)
const CORNERS = [];
for (const x of [-0.88, 0.88]) for (const z of [-1.92, 1.98]) for (const y of [-0.32, 0.88]) CORNERS.push([x, y, z]);
CORNERS.push([0, 1.28, -0.3], [0.62, 1.2, -0.3], [-0.62, 1.2, -0.3], [0.9, 0.55, 0], [-0.9, 0.55, 0]);
const SIDES = [[0.92, 0, 1.9], [-0.92, 0, 1.9], [0.95, 0, 0.65], [-0.95, 0, 0.65], [0.95, 0, -0.65], [-0.95, 0, -0.65], [0.92, 0, -1.85], [-0.92, 0, -1.85], [0, 0, 2.1], [0.5, 0, 2.05], [-0.5, 0, 2.05], [0, 0, -2.0], [0.5, 0, -1.98], [-0.5, 0, -1.98]];

// the first-person arms: a skinned rig (a chest; each side an arm, an elbow, a wrist, a thumb and four fingers of three
// joints) posed in the car model's space. A grip — the bar's centre, the bar's direction toward the thumb, and the side
// the back of the hand faces — set against the hand's own frame in its rest pose (fingers, palm, thumb side) gives the
// wrist's turn and its place; the arm reaches it by two-bone IK with the elbow's hinge kept in its own plane, the forearm
// takes part of the wrist's roll (as a forearm does), and the fingers close round the bar
const GRIP = { f: 0, n: 0 }, CURL = [[0.38, 0.3, 0.35], [0.8, 1.35, 0.9], [0.8, 1.35, 0.9], [0.8, 1.35, 0.9], [0.8, 1.3, 0.85]]; // (the bar's centre from the hook's, m; per finger, per joint, rad)
function armsRig(sceneRoot, parent, chestAt, scale) {
  const V = () => new THREE.Vector3(), bone = n => { let f = null; sceneRoot.traverse(o => { if (!f && o.isBone && o.name.startsWith(n)) f = o; }); return f; };
  let skin = null; sceneRoot.traverse(o => { if (o.isSkinnedMesh) skin = o; });
  if (!skin || !bone('chest') || !bone('L_wrist') || !bone('R_wrist')) return null;
  skin.frustumCulled = false; skin.castShadow = false; skin.receiveShadow = true;
  sceneRoot.updateMatrixWorld(true);
  const c0 = bone('chest').getWorldPosition(V());
  sceneRoot.scale.setScalar(scale); sceneRoot.position.copy(chestAt).addScaledVector(c0, -scale);
  for (const p of ['L', 'R']) bone(p + '_wrist').scale.setScalar(0.9); // (the hands a little smaller than the rig's)
  parent.add(sceneRoot); parent.updateWorldMatrix(true, false); sceneRoot.updateMatrixWorld(true);
  const inv = parent.matrixWorld.clone().invert(), invQ = new THREE.Quaternion(); parent.matrixWorld.decompose(V(), invQ, V()); invQ.invert();
  const P = o => o.getWorldPosition(V()).applyMatrix4(inv), Q = o => invQ.clone().multiply(o.getWorldQuaternion(new THREE.Quaternion()));
  const chestQi = Q(bone('chest')).invert();
  const side = p => {
    const b = k => bone(p + '_' + k), up = b('arm'), el = b('elbow'), wr = b('wrist');
    const S0 = P(up), E0 = P(el), W0 = P(wr);
    const fing = ['thumb', 'point', 'middle', 'ring', 'pink'].map(f => [1, 2, 3, 4].map(i => b(f + i))), kn = k => P(fing[k][0]);
    const F0 = kn(2).sub(W0).normalize(), across = kn(1).sub(kn(4)); // (toward the middle knuckle; from the little finger to the index)
    const m1 = kn(2), m2 = P(fing[2][1]), m3 = P(fing[2][2]), curl = m3.clone().sub(m2).normalize().sub(m2.clone().sub(m1).normalize());
    const N0 = V().crossVectors(across, F0); if (N0.dot(curl) < 0) N0.negate(); N0.addScaledVector(F0, -N0.dot(F0)).normalize(); // (out of the palm: where the fingers bend)
    const T0 = V().crossVectors(F0, N0), sgn = T0.dot(across) < 0 ? -1 : 1; T0.multiplyScalar(sgn);
    const K0 = [1, 2, 3, 4].reduce((a, k) => a.add(kn(k)), V()).multiplyScalar(0.25), G0 = K0.clone().addScaledVector(F0, GRIP.f).addScaledVector(N0, GRIP.n);
    const u0 = E0.clone().sub(S0).normalize(), f0 = W0.clone().sub(E0).normalize(), n0 = V().crossVectors(u0, f0).normalize();
    // the joints' bend axes: the fingers close toward the palm; the thumb swings up along the bar and presses onto it
    const joints = [];
    fing.forEach((ch, fi) => { for (let j = 0; j < 3; j++) { const bo = ch[j], d = P(ch[j + 1]).sub(P(bo)).normalize();
      const ax = (fi ? V().crossVectors(d, N0) : j ? V().crossVectors(N0, d) : V().crossVectors(d, T0)).normalize().applyQuaternion(Q(bo).invert());
      joints.push({ bo, q0: bo.quaternion.clone(), ax, a: CURL[fi][j], thumb: fi === 0, f: fi }); } });
    // where the bar lies: the centre of the hook the closed fingers make (the circle through each finger's joints)
    const cc = (a, b, c) => { const ab = b.clone().sub(a), ac = c.clone().sub(a), n = V().crossVectors(ab, ac), l = n.lengthSq();
      return a.clone().add(V().crossVectors(n, ab).multiplyScalar(ac.lengthSq()).add(V().crossVectors(ac, n).multiplyScalar(ab.lengthSq())).multiplyScalar(0.5 / l)); };
    for (const J of joints) if (!J.thumb) J.bo.quaternion.copy(J.q0).multiply(new THREE.Quaternion().setFromAxisAngle(J.ax, J.a));
    sceneRoot.updateMatrixWorld(true);
    let hook = V(), hookR = 0; for (const k of [1, 2, 3]) { const p = fing[k].map(P), c = cc(p[0], p[1], p[3]); hook.add(c); hookR += c.distanceTo(p[1]) / 3; } hook.multiplyScalar(1 / 3);
    for (const J of joints) J.bo.quaternion.copy(J.q0);
    sceneRoot.updateMatrixWorld(true);
    G0.copy(hook).addScaledVector(F0, GRIP.f).addScaledVector(N0, GRIP.n);
    return { hook: hook.clone(), hookR, K0W: hook.sub(W0), F0, N0, up, el, wr, S0, Lu: E0.distanceTo(S0), Lf: W0.distanceTo(E0), Qu0: Q(up), Qf0: Q(el), Qw0: Q(wr), sgn, G0W: G0.sub(W0),
      B0t: new THREE.Matrix4().makeBasis(T0, F0, N0).transpose(), f0, H0t: new THREE.Matrix4().makeBasis(u0, n0, V().crossVectors(u0, n0)).transpose(),
      rel0i: Q(el).invert().multiply(Q(wr)).invert(), axF: wr.position.clone().normalize(), joints };
  };
  const S = { L: side('L'), R: side('R') };
  const M = new THREE.Matrix4(), qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), qt = new THREE.Quaternion(), Qu = new THREE.Quaternion(), Qf = new THREE.Quaternion(), rel = new THREE.Quaternion();
  const T = V(), Fv = V(), N = V(), d = V(), perp = V(), E = V(), Wr = V(), u = V(), f = V(), n = V(), w = V(), g = V();
  return {
    // the wrist's place and turn for a grip: C the bar's centre, A along the bar toward the thumb, s from the bar toward
    // the back of the hand
    target(side, C, A, s, out, diag = 0) { const sd = S[side];
      N.copy(s).negate().normalize(); T.copy(A).addScaledVector(N, -A.dot(N)).normalize(); N.addScaledVector(T, -N.dot(T)).normalize();
      if (diag) T.applyAxisAngle(N, diag * sd.sgn); // (the bar across the palm on a slant, from between thumb and index to the heel of the hand)
      Fv.crossVectors(N, T).multiplyScalar(sd.sgn);
      M.makeBasis(T, Fv, N).multiply(sd.B0t); qa.setFromRotationMatrix(M);
      out.p.copy(C).sub(g.copy(sd.G0W).applyQuaternion(qa)); out.q.copy(qa).multiply(sd.Qw0); return out; },
    // the arm to a wrist pose (Wt, Qw), its fingers closed by curl (0 open .. 1 round a bar), its elbow toward pole
    solve(side, Wt, Qw, curl, pole, flick = 0) { const sd = S[side];
      d.subVectors(Wt, sd.S0); const dl = Math.min(d.length(), sd.Lu + sd.Lf - 1e-3); d.normalize();
      const ca = clamp((sd.Lu * sd.Lu + dl * dl - sd.Lf * sd.Lf) / (2 * sd.Lu * dl), -1, 1), sa = Math.sqrt(1 - ca * ca);
      perp.copy(pole).addScaledVector(d, -pole.dot(d)).normalize();
      E.copy(sd.S0).addScaledVector(d, sd.Lu * ca).addScaledVector(perp, sd.Lu * sa); Wr.copy(sd.S0).addScaledVector(d, dl);
      u.subVectors(E, sd.S0).normalize(); f.subVectors(Wr, E).normalize(); n.crossVectors(u, f).normalize();
      M.makeBasis(u, n, w.crossVectors(u, n)).multiply(sd.H0t); qa.setFromRotationMatrix(M); Qu.copy(qa).multiply(sd.Qu0); // (the upper arm, its hinge plane kept)
      qb.setFromUnitVectors(w.copy(sd.f0).applyQuaternion(qa), f); Qf.copy(qb).multiply(qa).multiply(sd.Qf0); // (the forearm bent onto the wrist)
      rel.copy(Qf).invert().multiply(Qw).multiply(sd.rel0i); const pr = rel.x * sd.axF.x + rel.y * sd.axF.y + rel.z * sd.axF.z;
      let tw = 2 * Math.atan2(pr, rel.w); if (tw > Math.PI) tw -= 2 * Math.PI; else if (tw < -Math.PI) tw += 2 * Math.PI;
      Qf.multiply(qt.setFromAxisAngle(sd.axF, tw * 0.55)); // (the forearm rolls with the wrist)
      sd.up.quaternion.copy(chestQi).multiply(Qu); sd.el.quaternion.copy(Qu).invert().multiply(Qf); sd.wr.quaternion.copy(Qf).invert().multiply(Qw);
      for (const J of sd.joints) J.bo.quaternion.copy(J.q0).multiply(qt.setFromAxisAngle(J.ax, J.a * curl * (J.thumb ? this.thumb : this.curl) * (J.f === 1 || J.f === 2 ? 1 - 0.85 * flick : 1))); }, // (a flick: index and middle finger open)
    // where the bar lies in the hand: along the fingers and off the palm from the knuckles (m)
    S, setGrip(f, n) { GRIP.f = f; GRIP.n = n; for (const sd of [S.L, S.R]) sd.G0W.copy(sd.K0W).addScaledVector(sd.F0, f).addScaledVector(sd.N0, n); },
    curl: 1, thumb: 1, diag: 0, back: 0.2, // (the back of the hand faces mostly out from the rim, a little toward the driver)
  };
}

function engineSound(car) {
  let ready = false, o1, o2, ws, f1, g1, nz, fN, gN;
  const init = () => { const ctx = audio.ctx; if (!ctx || !audio.master) return false;
    o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o2 = ctx.createOscillator(); o2.type = 'square';
    ws = ctx.createWaveShaper(); const cv = new Float32Array(256); for (let i = 0; i < 256; i++) cv[i] = Math.tanh((i / 128 - 1) * 2.4); ws.curve = cv;
    f1 = ctx.createBiquadFilter(); f1.type = 'lowpass'; f1.Q.value = 2.5; g1 = ctx.createGain(); g1.gain.value = 0;
    const m2 = ctx.createGain(); m2.gain.value = 0.5; o1.connect(ws); o2.connect(m2).connect(ws); ws.connect(f1).connect(g1).connect(audio.master); o1.start(); o2.start();
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    nz = ctx.createBufferSource(); nz.buffer = buf; nz.loop = true; fN = ctx.createBiquadFilter(); fN.type = 'bandpass'; fN.frequency.value = 900; fN.Q.value = 0.6; gN = ctx.createGain(); gN.gain.value = 0; nz.connect(fN).connect(gN).connect(audio.master); nz.start();
    return true; };
  return {
    update() { if (!ready) { ready = init(); if (!ready) return; }
      const st = car.st, t = audio.ctx.currentTime, f = st.rpm / 60 * 2;
      o1.frequency.setTargetAtTime(f, t, 0.015); o2.frequency.setTargetAtTime(f * 0.5, t, 0.015);
      f1.frequency.setTargetAtTime(420 + 2400 * st.throttle + st.rpm * 0.28, t, 0.03);
      g1.gain.setTargetAtTime(car.driving ? (0.03 + 0.085 * st.throttle) * (st.shiftT > 0 ? 0.3 : 1) : 0.012, t, 0.025);
      const sp = st.vel.length(), on = car.wheels.filter(w => w.contact).length / 4;
      gN.gain.setTargetAtTime(Math.min(0.15, sp / 30 * 0.06 + st.slipMax * 0.035) * on, t, 0.05); fN.frequency.setTargetAtTime(500 + sp * 28, t, 0.1); },
    click(d) { const ctx = audio.ctx; if (!ctx || !audio.master) return; const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime; o.type = 'square'; o.frequency.value = d > 0 ? 150 : 120; g.gain.setValueAtTime(0.1, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.06); o.connect(g).connect(audio.master); o.start(t); o.stop(t + 0.07); },
  };
}

function carHud(car) {
  const css = document.createElement('style');
  css.textContent = `#carHud{position:fixed;right:28px;bottom:26px;z-index:9;color:#fff;font:600 13px/1.2 "Segoe UI",system-ui,sans-serif;text-shadow:0 1px 3px #000a;pointer-events:none;text-align:right}
#carHud .spd{font:700 54px/1 "Segoe UI",system-ui;letter-spacing:-1px}#carHud .u{font-size:13px;opacity:.75;margin-left:4px}#carHud .gear{display:inline-block;min-width:46px;padding:4px 8px;margin-left:12px;border-radius:6px;background:#0008;font:700 34px/1 "Segoe UI";text-align:center;vertical-align:bottom}
#carHud .bar{position:relative;width:260px;height:9px;margin:8px 0 6px auto;border-radius:5px;background:#0007;overflow:hidden}#carHud .bar i{position:absolute;left:0;top:0;bottom:0;background:linear-gradient(90deg,#4fd06a,#f5d34a 70%,#f0522f)}
#carHud .mode{opacity:.75;font-size:11px;letter-spacing:.12em}
#carHelp{position:fixed;left:24px;bottom:22px;z-index:9;color:#fffd;font:12px/1.6 "Segoe UI",system-ui;text-shadow:0 1px 3px #000c;pointer-events:none}#carHelp b{display:inline-block;min-width:14px;padding:0 4px;margin-right:2px;border:1px solid #fff8;border-radius:3px;font-size:10px;line-height:15px;text-align:center}
#carCredit{position:fixed;right:10px;top:6px;z-index:9;color:#fff9;font:10px "Segoe UI";text-shadow:0 1px 2px #000;pointer-events:none}`;
  document.head.appendChild(css);
  const el = document.createElement('div'); el.id = 'carHud'; el.innerHTML = '<div><span class="spd">0</span><span class="u">km/h</span><span class="gear">N</span></div><div class="bar"><i></i></div><div class="mode"></div>'; document.body.appendChild(el);
  const help = document.createElement('div'); help.id = 'carHelp';
  help.innerHTML = '<b>W</b><b>S</b> throttle, brake · <b>A</b><b>D</b> steer · <b>Space</b> handbrake<br><b>E</b><b>Q</b> / <b>Shift</b> / mouse buttons: gears · <b>X</b> auto / manual<br><b>C</b> camera · <b>R</b> reset · <b>V</b> get out / in'; document.body.appendChild(help);
  const cr = document.createElement('div'); cr.id = 'carCredit'; cr.textContent = 'WRC Hyundai i20 2017 by vecarz (CC BY-NC-SA 4.0) · First Person Arms by DJMaesen (CC BY 4.0)'; document.body.appendChild(cr);
  const spd = el.querySelector('.spd'), gear = el.querySelector('.gear'), bar = el.querySelector('.bar i'), mode = el.querySelector('.mode');
  let n = 0;
  return { update() { if (++n % 3) return; const st = car.st, show = car.driving; el.style.display = help.style.display = show ? '' : 'none'; if (!show) return;
    spd.textContent = Math.round(Math.abs(st.velLocal.z) * 3.6); gear.textContent = st.gear === 0 ? 'R' : st.gear === 1 ? 'N' : String(st.gear - 1);
    bar.style.width = (clamp(st.rpm / 8500, 0, 1) * 100).toFixed(1) + '%'; mode.textContent = (st.auto ? 'AUTO' : 'MANUAL') + ' · ' + Math.round(st.rpm) + ' RPM'; } };
}
