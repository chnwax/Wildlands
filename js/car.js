// A car you drive: the WRC Hyundai i20 (2017) — an Assetto Corsa export, its wheels (WHEEL_xx), brake calipers
// (SUSP_xx), steering wheel (STEER_HR) and hydraulic handbrake their own nodes, rigged here (its sequential paddle
// swapped for an H-gate gear lever on the tunnel) — under a
// small real-time vehicle simulation, stepped at 480 Hz:
//  - a rigid body (mass, inertia) on four ray-cast wheels: springs, bump and rebound damping, bump stops, anti-roll bars;
//    the ground's own roughness (corrugations, potholes) felt through them
//  - tyres: longitudinal slip and slip angle combined on a friction ellipse through a Pacejka-like curve (a peak, then a
//    sliding plateau), grip by surface (gravel, loose edges, grass); each wheel's spin integrated implicitly in the
//    tyre's own stiffness, so a free wheel on a stiff tyre stays stable
//  - an engine with a torque curve, idle, a rev limiter and engine braking; a six-speed H-gate gearbox (automatic, or
//    manual as soon as you shift yourself), the drive let go while the lever crosses the gate; an automatic clutch
//  - four-wheel drive with limited-slip coupling across each axle and between them; the handbrake locks the rear wheels
//    and opens the rear of the drivetrain, as a rally car's hydraulic handbrake does
//  - brakes with a front bias, rolling resistance, drag and downforce; the body's corners against the ground and its
//    sides against the world's colliders (trees, bales, posts)
// The cockpit camera sits at the driver's eyes and moves as a head does: leaning against the lateral and longitudinal g,
// shaken by the bumps, keeping a little of the horizon, glancing toward the corner as you steer; free look with the
// mouse. The driver's arms (a skinned rig with fingers, posed by IK) hold the rim at any angle: the wheel turns only as
// they turn it, and they shuffle along it one hand at a time; for a shift the right hand takes the gear lever and moves
// it through the gate (the gear goes in as the knob reaches its slot), and it goes to the handbrake beside the wheel
// while that is pulled, the handbrake moving with it. The cabin is lit by what its windows let in (see cabinLight). The
// dash's shift lights count up the revs, the brake lights glow. C: cockpit / chase / bonnet view.
// Models: WRC Hyundai i20 2017 by vecarz (CC BY-NC-SA 4.0), First Person Arms by DJMaesen (CC BY 4.0); kept in
// Modeleaut/ next to the game (not in the repository).
import { THREE, scene, renderer, gltfLoader, collide, colInsert, colRemove, clamp, lerp, smoothstep } from './core.js';
import { audio } from './audio.js';
import { toastMsg } from './ui.js';

const MODEL = 'Modeleaut/wrc_hyundai_i20_2017texture4k.glb', ARMS = 'Modeleaut/first_person_arms.glb';
const G = 9.81;
// ---------------------------------------------------------------- the car (model space: front +z, left +x, ground y 0)
const SPEC = {
  mass: 1230, cg: [0, 0.47, 0.05], dims: [1.85, 1.25, 4.05], // (dims: the box its inertia is taken from)
  susp: { rest: 0.3, k: 34000, bump: 3000, rebound: 4400, travel: 0.22, arbF: 15000, arbR: 10000 },
  wheelI: 1.1, steerMax: 0.56, steerLock: 4.7, // (rad at the front wheels; the steering wheel turns ±270°)
  engine: { idle: 1000, limiter: 8200, inertia: 0.2, braking: 55, curve: [[0, 120], [1000, 190], [2000, 310], [3000, 430], [4000, 475], [5000, 485], [6000, 470], [7000, 430], [8000, 370], [9000, 260]] },
  gears: [-3.3, 0, 3.25, 2.38, 1.88, 1.53, 1.27, 1.07], final: 4.3, eff: 0.88, shiftTime: 0.1, // (0 reverse, 1 neutral, 2.. first..)
  brake: { front: 1650, rear: 720, hand: 980 }, lsd: 300, center: 420,
  aero: { cda: 0.78, cla: 1.1, front: 0.45 }, crr: 0.016, rollCentre: 0.12,
};
// (tuned to drive well rather than to the letter: grippy, quick to answer the wheel, and holding on in a slide)
const SURF = { gravel: { mu: 1.4, kp: 0.11, ap: 0.115, slide: 0.98 }, grass: { mu: 1.08, kp: 0.13, ap: 0.14, slide: 0.96 }, forest: { mu: 1.05, kp: 0.13, ap: 0.14, slide: 0.96 },
  asphalt: { mu: 1.52, kp: 0.085, ap: 0.1, slide: 0.98 }, concrete: { mu: 1.48, kp: 0.085, ap: 0.1, slide: 0.98 } };
const ASSIST = { yaw: 3.8, beta: 0.14, k: 12.5, side: 3.2 }; // (arcade stability: responsive turn-in, a catch before a slide becomes a spin, and gentle lateral recovery)
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
  // (the handbrake: its foot and its grip from its own vertices. The steering wheel: its rim found
  // from its own vertices — the outer ring, in 24 sectors, each sector's centroid a point on the rim's centre line — and
  // the circle through those points gives the hub, the axis the wheel turns about, the rim's radius and its thickness)
  const steerNode = find('STEER_HR'), shiftNode = find('shift_paddle'), handNode = find('handbrake');
  const ends = node => { if (!node) return null; const pts = vertsOf(node), b = boxOf(node), lo = new THREE.Vector3(), hi = new THREE.Vector3(); let nl = 0, nh = 0;
    for (const p of pts) { if (p.y < b.min.y + 0.03) { lo.add(p); nl++; } if (p.y > b.max.y - 0.04) { hi.add(p); nh++; } } return nl && nh ? { base: lo.multiplyScalar(1 / nl), top: hi.multiplyScalar(1 / nh) } : null; };
  const hbL = ends(handNode);
  let steerAxis = new THREE.Vector3(0, -0.33, 0.94).normalize(), steerHub = new THREE.Vector3(0.35, 0.77, 0.17), steerR = 0.17, rimTube = 0.017;
  const flattest = (pts, c) => { let best = null, bv = Infinity; const d = new THREE.Vector3(); // (the direction the points spread least along)
    for (let i = 0; i < 2000; i++) { const t = Math.acos(1 - 2 * (i + 0.5) / 2000), p = Math.PI * (1 + Math.sqrt(5)) * i; d.set(Math.sin(t) * Math.cos(p), Math.cos(t), Math.sin(t) * Math.sin(p)); if (d.z < 0) continue;
      let v = 0; for (const q of pts) { const k = _v.subVectors(q, c).dot(d); v += k * k; } if (v < bv) { bv = v; best = d.clone(); } }
    const cost = n => { let v = 0; for (const q of pts) { const k = _v.subVectors(q, c).dot(n); v += k * k; } return v; }, e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), tr = new THREE.Vector3();
    for (const step of [0.04, 0.015, 0.006, 0.002, 0.0007, 0.00025]) for (let k = 0; k < 12; k++) { e1.set(1, 0, 0).projectOnPlane(best).normalize(); e2.crossVectors(best, e1); let moved = false; // (refined: the coarse search is ~4° apart)
      for (const [e, sg] of [[e1, 1], [e1, -1], [e2, 1], [e2, -1]]) { tr.copy(best).addScaledVector(e, sg * step).normalize(); const v = cost(tr); if (v < bv) { bv = v; best.copy(tr); moved = true; } } if (!moved) break; }
    return best.normalize(); };
  if (steerNode) {
    const pts = vertsOf(steerNode, 1); let hub = boxOf(steerNode).getCenter(new THREE.Vector3()), axis = flattest(pts.filter((_, i) => i % 5 === 0), hub);
    for (let round = 0; round < 3; round++) {
      const upq = UP.clone().projectOnPlane(axis).normalize(), lq = new THREE.Vector3().crossVectors(upq, axis), rr = pts.map(q => _v.subVectors(q, hub).projectOnPlane(axis).length()), rmax = Math.max(...rr);
      const sec = Array.from({ length: 24 }, () => ({ s: new THREE.Vector3(), n: 0 }));
      pts.forEach((q, i) => { if (rr[i] < rmax - 0.04) return; const v = _v.subVectors(q, hub), a = Math.atan2(v.dot(lq), v.dot(upq)), k = ((Math.round(a / (Math.PI / 12)) % 24) + 24) % 24; sec[k].s.add(q); sec[k].n++; });
      const cen = sec.filter(t => t.n).map(t => t.s.multiplyScalar(1 / t.n)), c = cen.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / cen.length);
      axis = flattest(cen, c); hub = c; steerR = cen.reduce((a, p) => a + _v.subVectors(p, c).projectOnPlane(axis).length(), 0) / cen.length;
    }
    steerAxis = axis; steerHub = hub;
    // the rim's cross-section, sector by sector away from the spokes: its middle sets the centre line's radius, its half-width the tube
    const upq = UP.clone().projectOnPlane(axis).normalize(), lq = new THREE.Vector3().crossVectors(upq, axis), ext = Array.from({ length: 24 }, () => [9, -9, 9, -9]);
    for (const q of pts) { const v = _v.subVectors(q, hub), a = v.dot(axis), r = v.projectOnPlane(axis).length() - steerR; if (Math.abs(r) > 0.035 || Math.abs(a) > 0.035) continue;
      const k = ((Math.round(Math.atan2(v.dot(lq), v.dot(upq)) / (Math.PI / 12)) % 24) + 24) % 24, e = ext[k]; e[0] = Math.min(e[0], r); e[1] = Math.max(e[1], r); e[2] = Math.min(e[2], a); e[3] = Math.max(e[3], a); }
    const clean = ext.filter(e => e[0] > -0.03 && e[1] > e[0]), med = f => { const v = clean.map(f).sort((x, y) => x - y); return v[v.length >> 1]; };
    if (clean.length > 4) { steerR += med(e => (e[0] + e[1]) / 2); rimTube = med(e => Math.max(e[1] - e[0], e[3] - e[2]) / 2); }
  }
  const wheelBox = {}; for (const id of ['LF', 'RF', 'LR', 'RR']) wheelBox[id] = boxOf(find('WHEEL_' + id)); // (in the model's own space, before it is placed)
  const root = new THREE.Group(); root.name = 'car'; root.userData.dynamic = true; root.userData.dynamicCaster = true; scene.add(root); // (dynamicCaster: its shadow drawn afresh every frame, not cached with the scenery's)
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
  const steerPivot = steerNode ? pivotAt(steerNode, steerHub) : null, hbPivot = hbL ? pivotAt(handNode, hbL.base) : null;
  // ---- the gear lever: an H-gate six-speed on the tunnel by the driver's right knee, in place of the sequential paddle
  // behind the wheel. Each gear a place of the knob: across the gate (toward the driver: R, 1-2, 3-4, 5-6) and along it
  // (forward: R, 1, 3, 5; back: 2, 4, 6); neutral in the middle of the 3-4 lane
  if (shiftNode) shiftNode.visible = false;
  const GL = (() => { const at = (x, z) => { const cock = find('COCKPIT_HR'), o = model.localToWorld(new THREE.Vector3(x, 0.6, z)), rc = new THREE.Raycaster(o, model.localToWorld(new THREE.Vector3(x, 0, z)).sub(o).normalize(), 0, 1.2);
      const h = cock ? rc.intersectObject(cock, true)[0] : null; return h ? model.worldToLocal(h.point.clone()).y : 0.39; };
    const base = new THREE.Vector3(0.03, at(0.03, 0.08), 0.08), len = 0.31, d0 = new THREE.Vector3(0.05, 0.3, 0.03).normalize(), R = 0.019;
    const g = new THREE.Group(); g.name = 'gearLever'; g.position.copy(base); model.add(g);
    const metal = new THREE.MeshStandardMaterial({ color: 0xc4c8ce, metalness: 0.9, roughness: 0.28 }), leather = new THREE.MeshStandardMaterial({ color: 0x18181a, metalness: 0, roughness: 0.62 });
    const red = new THREE.MeshStandardMaterial({ color: 0xc8241c, metalness: 0.2, roughness: 0.45 }), boot = new THREE.MeshStandardMaterial({ color: 0x111112, metalness: 0, roughness: 0.92 });
    const stick = new THREE.Group(); g.add(stick); stick.quaternion.setFromUnitVectors(UP, d0); // (the lever: up its own y)
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.0095, len - 0.04, 14), metal); rod.position.y = (len - 0.04) / 2; stick.add(rod);
    const knob = new THREE.Mesh(new THREE.CapsuleGeometry(R, 0.042, 6, 20), leather); knob.position.y = len - 0.03; stick.add(knob);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R + 0.0005, 0.0022, 8, 28), red); ring.rotation.x = Math.PI / 2; ring.position.y = len - 0.008; stick.add(ring);
    const gaiter = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.05, 0.07, 18, 1, true), boot); gaiter.position.y = 0.03; g.add(gaiter);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.008, 0.16), metal); plate.position.y = 0.002; g.add(plate);
    for (const o of [rod, knob, ring, gaiter, plate]) { o.castShadow = true; o.receiveShadow = true; }
    return { g, stick, base, len, d0, R, top0: base.clone().addScaledVector(d0, len) };
  })();
  const slotOf = (gr, out) => { out[0] = gr === 0 ? 0.09 : gr === 1 ? 0 : gr < 4 ? 0.045 : gr < 6 ? 0 : -0.045; out[1] = gr === 1 ? 0 : gr % 2 === 0 ? 0.055 : -0.055; return out; };
  // the dash's shift lights and the brake lights (each its own material, so each lights alone)
  const glow = (node, color) => { const ms = []; if (node) node.traverse(o => { if (!o.isMesh) return; o.material = o.material.clone(); o.material.emissive = new THREE.Color(color); o.material.emissiveIntensity = 0; ms.push(o.material); }); return ms; };
  const leds = []; for (let i = 0; i < 21; i++) { const n = find('LED_' + i + '_'); if (n) leds.push(glow(n, i < 7 ? 0x30ff40 : i < 14 ? 0xff2a1a : 0x3a6bff)); }
  const brakeLights = [...glow(find('LIGHT_REAR_BRAKE'), 0xff1a10), ...glow(find('LIGHT_REAR00'), 0xff1a10), ...glow(find('LIGHT_REAR01'), 0xff1a10)];
  // ---- the driver: the first-person arms, their chest set so the shoulders sit below and either side of the eyes
  const driver = new THREE.Group(); driver.name = 'driver'; model.add(driver);
  const eye = new THREE.Vector3(steerHub.x, steerHub.y + 0.33, steerHub.z - 0.53); // (the driver's eyes)
  const rig = ag ? armsRig(ag.scene, driver, eye.clone().add(new THREE.Vector3(0, -0.237, -0.09)), 0.0118) : null;
  cabinLight(model, driver, ag && ag.scene);
  // ---- physics state
  const m = SPEC.mass, [W, H, L] = SPEC.dims, Ib = new THREE.Vector3(m / 12 * (H * H + L * L), m / 12 * (W * W + L * L) * 0.9, m / 12 * (W * W + H * H)); // (pitch, yaw, roll)
  const st = { pos: new THREE.Vector3(), q: new THREE.Quaternion(), vel: new THREE.Vector3(), ang: new THREE.Vector3(),
    steer: 0, steerIn: 0, throttle: 0, brake: 0, hand: 0, handEff: 0, gear: 2, rpm: SPEC.engine.idle, shiftT: 0, auto: true, revT: 0, locked: false,
    accLocal: new THREE.Vector3(), velLocal: new THREE.Vector3(), lastVel: new THREE.Vector3(), slipMax: 0 };
  const car = { root, st, wheels, rig, cockpit: { steerHub, steerAxis, steerR, rimTube }, driving: true, view: 0, inputOn: false, world, spec: SPEC,
    look: { yaw: 0, pitch: 0, idle: 9 }, head: { p: new THREE.Vector3(), v: new THREE.Vector3(), r: 0, rv: 0, t: 0, bump: 0, kick: new THREE.Vector3() }, fov: 75, anim: { hb: 0, hbGrip: 0, reach: 0, at: null, want: null, snap: false, gq: null, slot: 2, gMove: 0, gFrom: 2, gTo: 2, gLen: 0, linger: 0, knob: [0, 0] } };
  car.gearLever = GL;
  // (a box for the walker to bump into while the car stands; out of the car's own way)
  const col = { t: 1, x: 0, z: 0, hx: 0.95, hz: 2.05, c: 1, s: 0, y0: -1e9, y1: 1e9 }; let colIn = false;
  const place = (x, z, yaw) => { st.pos.set(x, world.groundAt(x, z) + SPEC.cg[1] + 0.01, z); st.q.setFromAxisAngle(UP, yaw); st.vel.set(0, 0, 0); st.ang.set(0, 0, 0); for (const w of wheels) { w.w = 0; w.c = SPEC.susp.rest - S0; } st.gear = 2; st.rpm = SPEC.engine.idle; Object.assign(car.anim, { gq: null, slot: 2, gMove: 0 }); };
  place(spawn.x, spawn.z, spawn.yaw);

  // ---------------------------------------------------------------- controls: keyboard, mouse buttons, a gamepad
  const padPrev = {};
  car.control = (keys, dt) => {
    if (!car.driving) { st.throttle = 0; st.brake = 0; st.hand = 1; st.steerIn *= Math.exp(-dt * 3); st.steer = car.handsSteer(st.steerIn, dt); return; }
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
    else { const rate = (steerT !== 0 && Math.sign(steerT) === Math.sign(st.steerIn) ? 3.6 : 6.8) * lerp(1, 0.8, clamp(Math.abs(v) / 40, 0, 1)); st.steerIn += clamp(steerT - st.steerIn, -rate * dt, rate * dt); }
    const angY = st.angLocalY || 0, betaF = Math.atan2(st.velLocal.x + angY * (wheels[0].hub.z), Math.max(Math.abs(v), 1)) * Math.sign(v || 1);
    const fast = clamp((Math.abs(v) - 5) / 28, 0, 1), gain = lerp(1, analog ? 0.6 : 0.52, fast), caster = betaF / SPEC.steerMax * (Math.abs(steerT) > 0.05 ? 0.18 : 0.68);
    st.steer = car.handsSteer(clamp(st.steerIn * gain + caster, -1, 1), dt); // (speed calms the steering without taking it away; released, the wheel follows the road and straightens itself)
    st.assist = !analog; // (keys cannot ease a brake off: the brakes keep the wheels from locking for them)
    // (in reverse, S drives and W brakes; the automatic engages reverse after a moment of S at a standstill)
    if (st.auto) { if (st.gear >= 1 && Math.abs(v) < 1.2 && brk > 0.5 && thr < 0.1) { st.revT += dt; if (st.revT > 0.35) { car.selectGear(0); st.revT = 0; } }
      else if (st.gear === 0 && v > -0.5 && thr > 0.5 && brk < 0.1) { st.revT += dt; if (st.revT > 0.2) { car.selectGear(2); st.revT = 0; } } else st.revT = 0; }
    let t = thr, b = brk; if (st.gear === 0) { t = brk; b = thr; }
    const ramp = (x, y, up, down) => x + clamp(y - x, -down * dt, up * dt);
    st.throttle = analog ? t : ramp(st.throttle, t, 6, 10); st.brake = analog ? b : ramp(st.brake, b, 6, 10); st.hand = ramp(st.hand, hb, 10, 6);
  };
  // a gear chosen: the right hand takes the lever there (handsSteer), and the gear is in when the knob is in its slot
  const chosen = () => { const A = car.anim; return A.gq !== null ? A.gq : A.gMove ? A.gTo : A.slot; };
  car.selectGear = g1 => { if (g1 === chosen() || (g1 === 0 && st.velLocal.z > 1.5)) return false; car.anim.gq = g1; return true; };
  car.shift = d => { if (!car.driving) return; if (st.auto && !car._auto) { st.auto = false; toastMsg('Manual gearbox — X: automatic'); }
    car.selectGear(clamp(chosen() + d, 0, SPEC.gears.length - 1)); };
  car.toggleAuto = () => { st.auto = !st.auto; toastMsg(st.auto ? 'Automatic gearbox' : 'Manual gearbox: E / Shift up, Q down (or the mouse buttons)'); };
  car.reset = () => {
    if (world.restartStage) { place(spawn.x, spawn.z, spawn.yaw); Object.assign(st, { steer: 0, steerIn: 0, throttle: 0, brake: 0, hand: 0, handEff: 0, shiftT: 0 }); world.restartStage(car); toastMsg('Stage restarted'); return; }
    const f = _v.set(0, 0, 1).applyQuaternion(st.q); place(st.pos.x, st.pos.z, Math.atan2(f.x, f.z)); toastMsg('Car reset');
  };
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
  let hbT = 0;
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
    const hand = st.handEff, hb = hand > 0.3, ratio = SPEC.gears[st.gear], Gt = ratio * SPEC.final, inGear = ratio !== 0; // (the handbrake releases the rear drive, while the front wheels keep pulling the car through an arcade slide)
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
      const steerA = w.front ? st.steer * SPEC.steerMax : 0, bh = w.front ? 0 : SPEC.brake.hand * hand; let bt = (w.front ? SPEC.brake.front : SPEC.brake.rear) * st.brake;
      let fx = 0, dfdw = 0; w.slip = 0; w.Fz = 0; w.rr = 0;
      if (w.contact) {
        world.normalAt(w.cp.x, w.cp.z, _n);
        wf.copy(fwd).applyAxisAngle(up, steerA); wf.addScaledVector(_n, -_n.dot(wf)).normalize(); wl.crossVectors(_n, wf);
        r.subVectors(w.cp, st.pos); vp.crossVectors(st.ang, r).add(st.vel);
        const vx = vp.dot(wf), vy = vp.dot(wl); w.vx = vx;
        w.surf = world.surfaceAt ? world.surfaceAt(w.cp.x, w.cp.z) : 'gravel'; const S = SURF[w.surf] || SURF.gravel, mu = S.mu * (world.gripAt ? world.gripAt(w.cp.x, w.cp.z) : 1) * (w.front ? 1 : 1 - 0.18 * clamp(hand, 0, 1)); // the locked rear tyres keep a believable amount of lateral grip
        const Fz = Math.max(0, w.fs); w.Fz = Fz;
        const den = Math.max(Math.abs(vx), 2), kappa = (w.w * w.R - vx) / den, sa = Math.tan(clamp(Math.atan2(vy, Math.max(Math.abs(vx), 0.6)), -1.4, 1.4)) / Math.tan(S.ap * (w.front ? 1 : 0.95));
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
    // ---- the stability help (an arcade car's): the yaw drawn toward the one the steering asks for (the wheels' own
    // geometry, as fast as the grip allows), and a slide pulled back past a body slip — eased off for the handbrake, so
    // it still swings the tail round
    { const vL = st.vel.dot(fwd), sideV = _v.crossVectors(up, fwd), vLat = st.vel.dot(sideV), spd = Math.abs(vL), on = clamp((spd - 3) / 6, 0, 1) * (wheels.filter(w => w.contact).length >= 3 ? 1 : 0);
      if (on > 0) { hbT = hand > 0.12 ? Math.min(1, hbT + h * 5) : Math.max(0, hbT - h * 4); const hbMix = smoothstep(0.08, 0.85, hand) * smoothstep(3, 9, spd), free = 1 - 0.12 * hbT;
        const wb = wheels[0].hub.z - wheels[2].hub.z, yawNow = st.ang.dot(up), d = st.steer * SPEC.steerMax;
        const lim = 11 / Math.max(spd, 1), roadWant = clamp(vL * Math.tan(d) / wb, -lim, lim), hbWant = st.steer * lerp(0.5, 0.88, clamp(spd / 28, 0, 1)), want = lerp(roadWant, hbWant, hbMix * 0.8), beta = Math.atan2(vLat, spd), betaLim = lerp(ASSIST.beta, 0.24, hbMix);
        let ty = -(yawNow - want) * ASSIST.yaw * free; if (Math.abs(beta) > betaLim) ty += Math.sign(beta) * (Math.abs(beta) - betaLim) * ASSIST.k * free;
        T.addScaledVector(up, ty * Ib.y * on);
        const sideFree = spd * lerp(0.085, 0.16, hbMix), excess = Math.max(0, Math.abs(vLat) - sideFree); // permit a useful rally slide while held; catch it quickly as soon as the lever is released
        if (excess > 0) F.addScaledVector(sideV, -Math.sign(vLat) * excess * m * ASSIST.side * on * free);
        if (hb && st.throttle > 0.05) F.addScaledVector(fwd, m * G * 0.18 * hand * st.throttle); // the front axle can still pull the car through the slide
      } }
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
  // the automatic: up as the car's own speed takes the revs near the limiter (not the revs of wheels spinning at a
  // launch — that only had it hunting between first and second), down as they fall away; never twice within a moment
  let autoT = 0;
  function autoBox(dt) {
    autoT += dt;
    if (!st.auto || st.gear < 2 || st.shiftT > 0 || car.anim.gq !== null || car.anim.gMove || autoT < 0.9) return;
    const rvAt = g => Math.abs(st.velLocal.z) / wheels[0].R * SPEC.gears[g] * SPEC.final * 60 / (2 * Math.PI), rv = rvAt(st.gear);
    car._auto = true; const g0 = st.gear;
    if (rv > 7350 && st.gear < SPEC.gears.length - 1 && st.throttle > 0.2) car.shift(1);
    else if (st.gear > 2 && rv < (st.brake > 0.2 ? 4700 : 3400) && rvAt(st.gear - 1) < SPEC.engine.limiter - 700) car.shift(-1);
    if (car.anim.gq !== null && car.anim.gq !== g0) autoT = 0;
    car._auto = false;
  }
  let acc = 0;
  car.update = dt => {
    acc += Math.min(dt, 0.05); let n = 0; const h = 1 / 480;
    while (acc >= h && n < 30) { stepPhys(h); acc -= h; n++; }
    autoBox(dt);
    const inv = _m.makeRotationFromQuaternion(st.q).invert(); st.velLocal.copy(st.vel).applyMatrix4(inv); st.angLocalY = _w.copy(st.ang).applyMatrix4(inv).y;
    if (dt > 0) { const a = _v.subVectors(st.vel, st.lastVel).multiplyScalar(1 / dt).applyMatrix4(inv); st.accLocal.lerp(a, 1 - Math.exp(-dt * 7)); }
    st.lastVel.copy(st.vel);
    root.position.copy(st.pos); root.quaternion.copy(st.q);
    for (const w of wheels) { w.angle = (w.angle + w.w * dt) % (Math.PI * 2);
      w.travel.position.set(w.hubModel.x, w.hubModel.y + S0 - (w.contact ? w.s : SPEC.susp.rest), w.hubModel.z);
      w.travel.quaternion.setFromAxisAngle(UP, w.front ? st.steer * SPEC.steerMax : 0); w.spin.quaternion.setFromAxisAngle(XAX, w.angle); }
    animate(dt);
    if (dbg) { root.updateMatrixWorld(true); dbgDraw(); }
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
  const TH0 = { L: Math.PI / 2 - 0.15, R: -(Math.PI / 2 - 0.15) }, thumbSign = {}; // (home: a quarter to three, a touch above the middle)
  for (const sd of ['L', 'R']) thumbSign[sd] = Math.sign(new THREE.Vector3().crossVectors(steerAxis, rimRad(TH0[sd], new THREE.Vector3())).dot(upw)) || 1;
  // where each hand can hold the rim (its reach: the wheel turns no further than the hands holding it can take it) and
  // past where it lets go for a new hold (toward the top the arm runs out of length: past ~1 o'clock for the right hand,
  // ~11 for the left); a new hold is taken back toward home, further back the faster the wheel is being turned
  const RANGE = { L: [0.6, 2.5], R: [-2.5, -0.6] }, REGRIP = { L: [0.75, 2.3], R: [-2.3, -0.75] }, FLY = 0.18, WHEEL_W = 14, WHEEL_BACK = 18, AHEAD = 0.5; // (rad/s: turned by the hands; unwinding by itself)
  const pose = () => ({ p: new THREE.Vector3(), q: new THREE.Quaternion() });
  const hs = { L: { phi: TH0.L, fly: 0, to: TH0.L, from: pose(), slide: 0 }, R: { phi: TH0.R, fly: 0, to: TH0.R, from: pose(), slide: 0 }, still: 0, w: 0 }; car.handState = hs; car.handLimits = { RANGE, REGRIP };
  const rad = new THREE.Vector3(), gC = new THREE.Vector3(), gA = new THREE.Vector3(), gS = new THREE.Vector3();
  const rimPose = (side, th, out) => { rimRad(th, rad); gC.copy(steerHub).addScaledVector(rad, steerR); gA.crossVectors(steerAxis, rad).multiplyScalar(thumbSign[side]); return rig.target(side, gC, gA, rimTube, out, side === 'L' ? poleL : poleR); };
  // the gear knob: the lever's top, a short bar the hand closes round, thumb up
  const kTop = new THREE.Vector3(), kBot = new THREE.Vector3(), kDir = new THREE.Vector3(), kC = new THREE.Vector3(), poleGear = new THREE.Vector3(-1, -0.6, -0.5);
  const knobPose = out => { kC.copy(kTop).addScaledVector(kDir, -0.026); return rig.target('R', kC, kDir, GL.R, out, poleGear); };
  const leverPose = (Lv, ang, out) => { const top = Lv.top.clone().sub(Lv.base).applyAxisAngle(XAX, ang).add(Lv.base), A = top.clone().sub(Lv.base).normalize(); hbTop.copy(top); hbBase.copy(Lv.base); return rig.target('R', top.addScaledVector(A, -0.04), A, HB_R, out, poleHb); };
  const poleL = new THREE.Vector3(1, -1, -0.35), poleR = new THREE.Vector3(-1, -1, -0.35), poleHb = new THREE.Vector3(-1, -0.2, -0.6), pole = new THREE.Vector3();
  const P0 = pose(), P1 = pose(), P2 = pose(), lift = new THREE.Vector3();
  // what the fingers close round: the rim (a torus) and the handbrake's rod (a segment)
  const HB_R = 0.015; if (rig) rig.prepare([rimTube, HB_R, GL.R]); // (the grips worked out for the rim, the handbrake's rod and the gear knob)
  car.cockpit.hbRod = () => ({ top: hbL.top.clone().sub(hbL.base).applyAxisAngle(XAX, car.anim.hbVis || 0).add(hbL.base), base: hbL.base.clone(), r: HB_R }); // (the lever as drawn)
  const hbTop = new THREE.Vector3(), hbBase = new THREE.Vector3(), bv = new THREE.Vector3(), bw = new THREE.Vector3();
  const bc = new THREE.Vector3(), bt = new THREE.Vector3(), b1 = new THREE.Vector3(), b2 = new THREE.Vector3();
  const rimBar = { tube: rimTube, dist: p => { bv.subVectors(p, steerHub); const a = bv.dot(steerAxis); bv.addScaledVector(steerAxis, -a); return Math.hypot(bv.length() - steerR, a); },
    near: (p, oc, od) => { bv.subVectors(p, steerHub).projectOnPlane(steerAxis).normalize(); oc.copy(steerHub).addScaledVector(bv, steerR); od.crossVectors(steerAxis, bv); } };
  if (rig) { rig.rimBar = rimBar; rimBar.thumb = rig.thumbRim; }
  const knobBar = { tube: GL.R, dist: p => { bw.subVectors(kTop, kBot); const t = clamp(bv.subVectors(p, kBot).dot(bw) / bw.lengthSq(), 0, 1); return bv.copy(kBot).addScaledVector(bw, t).distanceTo(p); },
    near: (p, oc, od) => { od.subVectors(kTop, kBot); const t = clamp(bv.subVectors(p, kBot).dot(od) / od.lengthSq(), 0, 1); oc.copy(kBot).addScaledVector(od, t); od.normalize(); } };
  const hbBar = { tube: HB_R, dist: p => { bw.subVectors(hbTop, hbBase); const t = clamp(bv.subVectors(p, hbBase).dot(bw) / bw.lengthSq(), 0, 1); return bv.copy(hbBase).addScaledVector(bw, t).distanceTo(p); },
    near: (p, oc, od) => { od.subVectors(hbTop, hbBase); const t = clamp(bv.subVectors(p, hbBase).dot(od) / od.lengthSq(), 0, 1); oc.copy(hbBase).addScaledVector(od, t); od.normalize(); } };
  // a hand's way from one hold to another: it opens and lifts off first, travels clear of the bar, and closes again on
  // arrival, so the fingers are never dragged through the bar. Returns how open the hand is (0 holding .. 1 open)
  const sm = t => t * t * (3 - 2 * t), bump = (x, a, b) => sm(clamp(x / a, 0, 1)) * (1 - sm(clamp((x - b) / (1 - b), 0, 1)));
  const tv = new THREE.Vector3(), tw = new THREE.Vector3();
  const ta = new THREE.Vector3();
  const travel = (from, to, k0, away, out, round = false, awayTo = away, mid = null) => { const m = sm(clamp((k0 - 0.2) / 0.58, 0, 1)); // (away: the way off the first hold; awayTo: the way in to the second)
    out.p.lerpVectors(from.p, to.p, m);
    if (round) { const ra = tv.subVectors(from.p, steerHub).projectOnPlane(steerAxis).length(), rb = tw.subVectors(to.p, steerHub).projectOnPlane(steerAxis).length(); // (along the rim's curve, not across its chord)
      tv.subVectors(out.p, steerHub).projectOnPlane(steerAxis); const r = tv.length(), want = lerp(ra, rb, m); if (r > 1e-4 && r < want) out.p.addScaledVector(tv, (want - r) / r); }
    out.p.addScaledVector(ta.copy(away).lerp(awayTo, m), bump(k0, 0.2, 0.78)); if (mid) out.p.addScaledVector(mid, Math.sin(Math.PI * m)); // (mid: a way round something between)
    out.q.slerpQuaternions(from.q, to.q, m); return bump(k0, 0.16, 0.84); };
  const awayRim = (p, out) => out.subVectors(p, steerHub).projectOnPlane(steerAxis).normalize().addScaledVector(steerAxis, -0.9).normalize().multiplyScalar(0.06); // (out from the rim and toward the driver)
  const PH = pose(), aw = new THREE.Vector3();
  // a hand taking a new hold on the rim, moved as a hand is: the fingers let go first and the hand lifts off, then it goes
  // with a speed that swells and dies away (a minimum-jerk profile — no constant speed, no sudden start or stop) on a
  // low arc, turned to the new hold before it gets there, the fingers half open on the way and closing round the rim
  // as it arrives. Its time and its arc are its own (longer for a longer way, a little different each time)
  const mj = t => t * t * t * (10 - 15 * t + 6 * t * t);
  const regrip = (h, to, k, away, out) => { const u = mj(clamp((k - 0.07) / 0.86, 0, 1));
    out.p.lerpVectors(h.from.p, to.p, u);
    const ra = tv.subVectors(h.from.p, steerHub).projectOnPlane(steerAxis).length(), rb = tw.subVectors(to.p, steerHub).projectOnPlane(steerAxis).length(); // (along the rim's curve, not across its chord)
    tv.subVectors(out.p, steerHub).projectOnPlane(steerAxis); const r = tv.length(), want = lerp(ra, rb, u); if (r > 1e-4 && r < want) out.p.addScaledVector(tv, (want - r) / r);
    out.p.addScaledVector(away, h.arc / 0.06 * Math.sin(Math.PI * mj(clamp((k - 0.03) / 0.9, 0, 1)))); // (the lift: as smooth as the way, a touch ahead of it)
    out.q.slerpQuaternions(h.from.q, to.q, mj(clamp((k - 0.05) / 0.8, 0, 1)));
    return k < 0.12 ? 0.75 * sm(k / 0.12) : k < 0.62 ? 0.75 - 0.15 * sm((k - 0.12) / 0.5) : 0.6 * (1 - sm(clamp((k - 0.62) / 0.33, 0, 1))); };
  // a hand on the rim, holding, sliding, or on its way to a new hold
  const onRim = (side, rot, out) => {
    const h = hs[side];
    if (h.fly > 0) { rimPose(side, h.to, PH); awayRim(aw.addVectors(h.from.p, PH.p).multiplyScalar(0.5), aw); return regrip(h, PH, 1 - h.fly, aw, out); }
    return rimPose(side, h.phi + rot, out), h.slide * 0.3; // (a hold the rim slides through: the fingers a little loose)
  };
  // the steering wheel and the hands: turned, it goes as fast as hands can turn it (WHEEL_W), and the hands holding it go
  // with the rim; let go of, it unwinds by itself, faster (the castor turns the wheels back to the straight), sliding
  // through hands that hold it loosely. A hand at the end of its reach lets the rim slide through it rather than stop it,
  // and one at a time they let go and take a new hold. Asked for a steer, gives the steer the wheel makes. The right
  // hand's errands are timed here too.
  const gp = [[0, 0], [0, 0], [0, 0], [0, 0]], gsA = [0, 0], gsB = [0, 0];
  const gateAt = (u, out) => { let L = u * car.anim.gLen; for (let i = 0; i < 3; i++) { const a = gp[i], b = gp[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L <= l || i === 2) { const t = l > 1e-6 ? clamp(L / l, 0, 1) : 1; out[0] = lerp(a[0], b[0], t); out[1] = lerp(a[1], b[1], t); return out; } L -= l; } return out; };
  car.handsSteer = (want, dt) => { const A = car.anim, lock = SPEC.steerLock; let rot = st.steer * lock;
    if (!car.driving) { st.handEff = st.hand; A.reach = 0; A.at = A.want = null; A.gMove = 0; A.gq = null; A.slot = st.gear; slotOf(A.slot, A.knob); for (const side of ['L', 'R']) { const h = hs[side]; h.fly = 0; h.phi = TH0[side] - want * lock; } return want; }
    // the right hand's errands: to the gear lever while a gear is to be put in (a gear on its way in is seen through
    // first), to the handbrake while it is pulled. A.at: the errand it is on, or coming back from; A.reach: 0 on the rim
    // .. 1 there. Turned to another errand on the way, it goes on from where it is
    const job = A.gMove ? 'gear' : st.hand > 0.08 && hbL ? 'hb' : A.gq !== null || A.linger > 0 ? 'gear' : null; A.want = job;
    if (job && job !== A.at) { if (A.reach > 0) A.snap = true; A.reach = 0; A.at = job; }
    A.reach = clamp(A.reach + (job ? 1 : -1) * dt / (A.at === 'hb' ? 0.3 : job ? 0.15 : 0.17), 0, 1); if (A.reach === 0 && !job) A.at = null;
    const hbTouch = A.at === 'hb' && A.want === 'hb' && A.reach >= 0.985; // first reach the lever at rest; only then close the grip and pull it
    A.hbGrip = lerp(A.hbGrip, hbTouch ? st.hand : 0, 1 - Math.exp(-dt * (hbTouch ? 22 : 30)));
    if (!hbTouch && A.hbGrip < 0.001) A.hbGrip = 0;
    st.handEff = hbL ? A.hbGrip : st.hand;
    // the lever: through the gate from the gear it is in to the one chosen, by neutral (the engine's drive let go while it
    // moves); the gear is in as the knob comes into its slot
    if (A.at === 'gear' && A.reach >= 1) {
      if (!A.gMove && A.gq !== null) { if (A.gq !== A.slot) { slotOf(A.slot, gsA); slotOf(A.gq, gsB); gp[0] = [gsA[0], gsA[1]]; gp[1] = [gsA[0], 0]; gp[2] = [gsB[0], 0]; gp[3] = [gsB[0], gsB[1]];
          A.gLen = Math.abs(gsA[1]) + Math.abs(gsA[0] - gsB[0]) + Math.abs(gsB[1]); A.gFrom = A.slot; A.gTo = A.gq; A.gMove = 1e-4; st.gear = 1; sound.event('lever'); } A.gq = null; }
      if (A.gMove) { const dur = 0.05 + A.gLen / 1.1; A.gMove = Math.min(1, A.gMove + dt / dur); st.shiftT = Math.max(st.shiftT, (1 - A.gMove) * dur + 0.03); gateAt(sm(A.gMove), A.knob);
        if (A.gMove >= 1) { A.gMove = 0; A.slot = A.gTo; st.gear = A.gTo; slotOf(A.slot, A.knob); A.linger = 0.2; sound.click(A.gTo > A.gFrom ? 1 : -1); } }
      else if (A.linger > 0) A.linger = Math.max(0, A.linger - dt); }
    else if (!A.gMove) slotOf(A.slot, A.knob);
    for (const side of ['L', 'R']) { const h = hs[side];
      if (side === 'R' && (A.reach > 0 || A.at)) { h.fly = 0; h.phi = TH0.R - rot; continue; } // (on its errand: it comes back to its home hold)
      if (h.fly > 0) { h.fly -= dt / (h.dur || FLY); if (h.fly <= 0) { h.fly = 0; h.phi = h.to - rot; h.jit = (Math.random() - 0.5) * 0.24; } } }
    const grips = side => hs[side].fly === 0 && !(side === 'R' && (A.reach > 0 || A.at));
    const tgt = want * lock, back = Math.abs(tgt) < Math.abs(rot) && tgt * rot >= 0, wmax = (back ? Math.min(WHEEL_BACK, 6 + st.vel.length() * 0.6) : WHEEL_W) * dt; // (unwinding: the faster the car goes, the harder the castor pulls the wheel back)
    const nrot = clamp(tgt, rot - wmax, rot + wmax), dir = Math.abs(tgt - nrot) > 0.02 ? Math.sign(tgt - nrot) : Math.sign(nrot - rot); rot = nrot;
    for (const side of ['L', 'R']) { const h = hs[side]; h.slide *= Math.exp(-dt * 8); if (!grips(side)) continue; const [a, b] = RANGE[side]; // (past its reach the hand stays, the rim slides through it)
      const d0 = rot - st.steer * lock, th0 = h.phi + rot - d0; // (the hand's place before this step)
      if (back && Math.abs(d0) > 1e-4) { // (unwinding by itself: the hands, holding loosely, make their way back home and the rim slides through them)
        const follow = th0 + d0, home = th0 + clamp(TH0[side] - th0, -WHEEL_W * dt, WHEEL_W * dt), toward = (TH0[side] - th0) * d0 > 0 && Math.abs(d0) <= Math.abs(TH0[side] - th0);
        const th = toward && Math.abs(d0) <= WHEEL_W * dt ? follow : home; h.phi = th - rot; if (th !== follow) h.slide = 1; }
      else if (Math.abs(d0) > WHEEL_W * dt) { h.phi -= d0 - clamp(d0, -WHEEL_W * dt, WHEEL_W * dt); h.slide = 1; } // (turned faster than a hand: it slides through)
      const th2 = h.phi + rot; if (th2 < a || th2 > b) { h.phi = clamp(th2, a, b) - rot; h.slide = 1; } }
    hs.still = Math.abs(tgt - rot) < 0.02 && Math.abs(nrot - st.steer * lock) < 0.002 ? hs.still + dt : 0;
    if (dt > 0) hs.w += (Math.abs(nrot - st.steer * lock) / dt - hs.w) * Math.min(1, dt * 20); // (how fast it is being turned)
    hs.calm = hs.w < 1.5 && Math.abs(rot) < 1.2 ? (hs.calm || 0) + dt : 0;
    const left = side => { const th = hs[side].phi + rot, [a, b] = RANGE[side]; return dir > 0 ? b - th : dir < 0 ? th - a : Infinity; }; // (how much further a hand can take it)
    // a new hold: one hand at a time, while the other holds — or, the other away, when this one has run out of reach
    for (const side of ['L', 'R']) { const h = hs[side], o = side === 'L' ? 'R' : 'L'; if (!grips(side)) continue;
      const th = h.phi + rot, [ra, rb] = REGRIP[side], [a, b] = RANGE[side], jt = h.jit || 0, out = th > rb + jt ? 1 : th < ra + jt ? -1 : 0; // (where a hand lets go: a little different each time)
      const other = grips(o), stuck = (dir > 0 && th > b - 0.01) || (dir < 0 && th < a + 0.01);
      // (turned fast, the one nearer the end of its reach goes early, while the other can still take the wheel on through
      // its flight — so the wheel need not wait for it)
      const early = other && dir !== 0 && hs.w > 2 && left(side) < hs.w * FLY * 1.3 && left(side) <= left(o) && left(o) >= hs.w * FLY && Math.abs(th - TH0[side] + dir * AHEAD) > 0.4;
      const go = (out !== 0 && dir !== -out && (other || (hs[o].fly === 0 && stuck))) || early, home = !go && other && (hs.still > 0.5 || hs.calm > 0.7) && Math.abs(th - TH0[side]) > 0.3; // (back home once the wheel is held still or only nudged)
      if (!go && !home) continue;
      h.to = (go && dir ? clamp(TH0[side] - dir * AHEAD, ra + 0.05, rb - 0.05) : TH0[side]) + (Math.random() - 0.5) * 0.12; // (and where it takes the rim again)
      let dist = 0.12; if (rig) { rimPose(side, th, h.from); rimPose(side, h.to, PH); dist = h.from.p.distanceTo(PH.p); }
      h.dur = clamp(0.16 + 0.55 * dist, 0.2, 0.46) * (0.9 + Math.random() * 0.2) * (go ? 1 : 1.25); // (a longer way takes longer; a hand going home at ease, longer still)
      h.arc = clamp(0.3 * dist, 0.022, 0.07) * (0.8 + Math.random() * 0.4); h.fly = 1; hs.still = 0; break; }
    return rot / lock; };
  const awayHb = new THREE.Vector3(), awayR = new THREE.Vector3(), awayKnob = new THREE.Vector3(), RF = pose(), hbMid = steerAxis.clone().multiplyScalar(-0.13).addScaledVector(UP, 0.03);
  function animate(dt) {
    const A = car.anim, rot = st.steer * SPEC.steerLock;
    if (steerPivot) steerPivot.quaternion.setFromAxisAngle(steerAxis, -rot);
    // the gear lever where the knob is in the gate (it turns about its foot)
    kTop.copy(GL.top0); kTop.x += A.knob[0]; kTop.z += A.knob[1]; kDir.subVectors(kTop, GL.base).normalize(); kTop.copy(GL.base).addScaledVector(kDir, GL.len); kBot.copy(kTop).addScaledVector(kDir, -0.06);
    GL.stick.quaternion.setFromUnitVectors(UP, kDir);
    // the handbrake: worked by the driver's hand in the cockpit — it is pulled as the hand closes on it (its rest place
    // is beyond a seated arm's reach) and let go of as the hand opens; otherwise it follows the brake itself
    A.hb = st.handEff;
    const HB_PULL = -0.32, hbA = HB_PULL * A.hb;
    if (hbPivot) hbPivot.quaternion.setFromAxisAngle(XAX, hbA); A.hbVis = hbA;
    // the shift lights and the brake lights
    const lit = Math.round(clamp((st.rpm - 5600) / (SPEC.engine.limiter - 5600), 0, 1) * leds.length), blink = st.rpm > SPEC.engine.limiter - 250 && (performance.now() % 140 < 70);
    leds.forEach((ms, i) => { const v = blink ? 3 : i < lit ? 2.5 : 0; for (const mm of ms) mm.emissiveIntensity = v; });
    for (const mm of brakeLights) mm.emissiveIntensity = car.driving && st.brake > 0.05 ? 3 : 0;
    driver.visible = !!rig && car.driving && car.view === 0; if (!driver.visible) return;
    // the right hand's errands (timed with the steering, in handsSteer): it leaves from where it held — or, turned to
    // another errand on its way, from where it is — and comes back to its home hold
    const hR = hs.R;
    if (A.reach > 0) { if (!hR.away || A.snap) { if (P1.p.lengthSq() > 0) { RF.p.copy(P1.p); RF.q.copy(P1.q); } else onRim('R', rot, RF); } A.snap = false; hR.away = true; // (from where it was last: on the rim, or on its way to a new hold)
      if (!A.want) { rimPose('R', TH0.R, PH); const e = 1 - Math.exp(-dt * 30); RF.p.lerp(PH.p, e); RF.q.slerp(PH.q, e); } }
    else hR.away = false;
    const cL = onRim('L', rot, P0), cR = A.reach > 0 ? 0 : onRim('R', rot, P1);
    let openR = cR, barR = rimBar;
    if (A.reach > 0 && A.at === 'hb') { // (off the rim, out round it, to the handbrake beside the wheel)
      leverPose(hbL, hbA, P2); // the hand first reaches the resting lever, then follows it through the pull
      awayHb.copy(rig.S.R.dbg.N).multiplyScalar(-0.07).addScaledVector(steerAxis, -0.03); awayRim(RF.p, awayR); // (in to the handbrake from the palm's side ...)
      const k = A.reach; openR = travel(RF, P2, k, awayR, P1, false, awayHb, hbMid); barR = k < 0.5 ? rimBar : hbBar; // (... round behind its rod)
      pole.copy(poleR).lerp(poleHb, sm(clamp((k - 0.2) / 0.58, 0, 1)));
    } else if (A.reach > 0) { // (off the rim, down to the knob from above, the knob moved through the gate in the hand)
      knobPose(P2); awayRim(RF.p, awayR); awayKnob.copy(kDir).multiplyScalar(0.05);
      const k = A.reach; openR = travel(RF, P2, k, awayR, P1, false, awayKnob); barR = k < 0.5 ? rimBar : knobBar;
      pole.copy(poleR).lerp(poleGear, sm(clamp((k - 0.2) / 0.58, 0, 1)));
    } else pole.copy(poleR);
    rig.frame++;
    rig.solve('L', P0.p, P0.q, cL, poleL, 0, rimBar, dt);
    rig.solve('R', P1.p, P1.q, openR, pole, 0, barR, dt);
  }

  // the arms' debug overlay (car.debugArms(true)): each arm bone's own axes (x red, y green, z blue), the joints, the
  // chains, the grip point on the bar (cyan) and the bar's way (yellow), the hand's frame T/F/N (pink/lime/sky), the IK's
  // wrist target (magenta), the elbow's offset from the shoulder-wrist line (orange), the rim's centre line (white)
  let dbg = null;
  car.debugArms = on => { if (!on) { if (dbg) { model.remove(dbg.group); dbg = null; } return; } if (dbg || !rig) return;
    const mk = (n, size, col) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      const m = size ? new THREE.PointsMaterial({ size, sizeAttenuation: false, vertexColors: true, depthTest: false }) : new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false });
      const o = size ? new THREE.Points(g, m) : new THREE.LineSegments(g, m); o.renderOrder = 999; o.frustumCulled = false; return o; };
    const group = new THREE.Group(); group.name = 'armsDebug'; const lines = mk(4000), pts = mk(200, 6); group.add(lines, pts); model.add(group); dbg = { group, lines, pts }; };
  const dbgDraw = () => {
    const L = dbg.lines.geometry.attributes, Pp = dbg.pts.geometry.attributes; let nl = 0, np = 0; const col = new THREE.Color();
    const seg = (a, b, c) => { col.set(c); L.position.setXYZ(nl, a.x, a.y, a.z); L.color.setXYZ(nl++, col.r, col.g, col.b); L.position.setXYZ(nl, b.x, b.y, b.z); L.color.setXYZ(nl++, col.r, col.g, col.b); };
    const pt = (a, c) => { col.set(c); Pp.position.setXYZ(np, a.x, a.y, a.z); Pp.color.setXYZ(np++, col.r, col.g, col.b); };
    const inv = new THREE.Matrix4().copy(model.matrixWorld).invert(), m = new THREE.Matrix4(), loc = o => new THREE.Vector3().setFromMatrixPosition(m.copy(inv).multiply(o.matrixWorld));
    const tip = (a, d, l) => a.clone().addScaledVector(d, l);
    for (let i = 0; i <= 48; i++) { const a0 = i / 48 * Math.PI * 2, a1 = (i + 1) / 48 * Math.PI * 2; seg(steerHub.clone().addScaledVector(upw, Math.cos(a0) * steerR).addScaledVector(leftw, Math.sin(a0) * steerR), steerHub.clone().addScaledVector(upw, Math.cos(a1) * steerR).addScaledVector(leftw, Math.sin(a1) * steerR), 0xffffff); }
    for (const sd of [rig.S.L, rig.S.R]) {
      const S = loc(sd.up), E = loc(sd.el), W = loc(sd.wr);
      seg(S, E, 0xdddddd); seg(E, W, 0xdddddd); pt(S, 0xffffff); pt(E, 0xffffff); pt(W, 0xffffff);
      for (const b of [sd.up, sd.el, sd.wr]) { m.copy(inv).multiply(b.matrixWorld); const o = loc(b), ex = new THREE.Vector3(), ey = new THREE.Vector3(), ez = new THREE.Vector3(); m.extractBasis(ex, ey, ez);
        seg(o, tip(o, ex.normalize(), 0.05), 0xff3030); seg(o, tip(o, ey.normalize(), 0.05), 0x30ff30); seg(o, tip(o, ez.normalize(), 0.05), 0x3070ff); }
      for (const ch of sd.fing) { let prev = W; for (const b of ch) { const p = loc(b); seg(prev, p, ch === sd.fing[0] ? 0xffb000 : 0xbbbbbb); pt(p, ch === sd.fing[0] ? 0xffb000 : 0xeeeeee); prev = p; } }
      const D = sd.dbg; pt(D.C, 0x00ffff); seg(D.C, tip(D.C, D.bar, 0.06), 0xffff00); pt(D.Wt, 0xff00ff);
      seg(W, tip(W, D.T, 0.06), 0xff60c0); seg(W, tip(W, D.F, 0.06), 0x9cff40); seg(W, tip(W, D.N, 0.06), 0x50c8ff);
      const line = W.clone().sub(S).normalize(), foot = S.clone().addScaledVector(line, E.clone().sub(S).dot(line)); seg(foot, E, 0xff8000);
    }
    for (let i = nl; i < L.position.count; i++) L.position.setXYZ(i, 0, 0, 0); for (let i = np; i < Pp.position.count; i++) Pp.position.setXYZ(i, 0, -9, 0);
    L.position.needsUpdate = L.color.needsUpdate = Pp.position.needsUpdate = Pp.color.needsUpdate = true; dbg.lines.geometry.setDrawRange(0, nl); dbg.pts.geometry.setDrawRange(0, np);
  };
  car.debugDraw = () => { if (dbg) { root.updateMatrixWorld(true); dbgDraw(); } };

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
    // the head on a spring, pushed by the car's acceleration (local: x left, y up, z forward), a little loose so it
    // sways and settles; jolted by the suspension hitting bumps and landings; shaken finely by the gravel at speed and
    // by the engine
    const a = st.accLocal, Hd = car.head, sp = Math.hypot(st.velLocal.x, st.velLocal.z); Hd.t += dt;
    const target = _a.set(clamp(-a.x * 0.0068, -0.11, 0.11), clamp(-a.y * 0.003, -0.05, 0.05), clamp(-a.z * 0.006, -0.09, 0.09));
    Hd.v.addScaledVector(_b.subVectors(target, Hd.p), 115 * dt); Hd.v.multiplyScalar(Math.exp(-11 * dt));
    let jolt = 0; for (const w of wheels) jolt += w.contact ? Math.max(0, w.cv - 0.35) : 0; // (the suspension compressing faster than a road's give: a bump)
    if (jolt > 0) { Hd.v.y -= Math.min(jolt, 6) * 0.05; Hd.v.x += (Math.random() - 0.5) * Math.min(jolt, 6) * 0.04; Hd.bump = Math.min(1, Hd.bump + jolt * 0.15); }
    Hd.bump *= Math.exp(-dt * 6); Hd.p.addScaledVector(Hd.v, dt);
    const rollT = clamp(a.x * 0.0085, -0.1, 0.1); Hd.rv += (rollT - Hd.r) * 85 * dt; Hd.rv *= Math.exp(-11 * dt); Hd.r += Hd.rv * dt;
    const t = Hd.t, rough = (st.slipMax > 0.3 ? 1.4 : 1) * clamp(sp / 30, 0, 1.3) * (wheels.some(w => w.contact && w.surf !== 'asphalt' && w.surf !== 'concrete') ? 1 : 0.35);
    const n3 = (f, o) => Math.sin(t * f + o) * 0.5 + Math.sin(t * f * 2.31 + o * 1.7) * 0.3 + Math.sin(t * f * 4.73 + o * 0.6) * 0.2;
    const eng = clamp((st.rpm - 800) / 7400, 0, 1), buzz = 0.00025 * (0.6 + eng) * (car.driving ? 1 : 0);
    Hd.kick.set(n3(31, 0.3) * (0.0011 * rough + buzz), n3(27, 1.9) * (0.0016 * rough + buzz) - Hd.bump * 0.004 * n3(17, 4.1), n3(23, 3.3) * 0.0006 * rough);
    eyeB.copy(car.view === 2 ? bonnet : eye); if (car.view === 0) eyeB.add(Hd.p).add(Hd.kick);
    eyeB.sub(cgV).applyQuaternion(st.q).add(st.pos);
    // (a glance toward the corner as you steer and as the car slides)
    const apex = car.view === 0 ? clamp((st.steer * 0.28 + Math.atan2(st.velLocal.x, Math.max(5, Math.abs(st.velLocal.z))) * 0.38) * clamp(Math.abs(st.velLocal.z) / 8, 0, 1), -0.5, 0.5) : 0;
    car.apex = car.apex === undefined ? apex : lerp(car.apex, apex, 1 - Math.exp(-dt * 5));
    const cab = car.view === 0, sh = cab ? 3.5 : 1.5; // (the eyes shaken a touch in their turn, not only moved)
    qLook.setFromEuler(_e.set(Lk.pitch - 0.07 + Hd.kick.y * sh, Math.PI + Lk.yaw + car.apex + Hd.kick.x * sh, cab ? Hd.r + Hd.kick.z * sh * 2 : 0, 'YXZ'));
    // (the car's pitch and roll followed mostly: a head keeps only a little of the horizon)
    level.setFromUnitVectors(_v.set(0, 1, 0).applyQuaternion(st.q), UP); qH.identity().slerp(level, cab ? 0.12 : 0.1).multiply(st.q);
    // (the lens: the field of view set by the player, a little wider with the speed)
    car.fovK = lerp(car.fovK || 0, clamp((sp - 8) / 40, 0, 1), 1 - Math.exp(-dt * 2));
    cam.position.copy(eyeB); cam.quaternion.copy(qH).multiply(qLook); setLens(cam, 0.035, Math.round((car.fov + (cab ? 0 : 4) + car.fovK * 8) * 4) / 4);
  };
  const setLens = (cam, near, fov) => { if (cam.near !== near || cam.fov !== fov) { cam.near = near; cam.fov = fov; cam.updateProjectionMatrix(); } };
  car.leave = () => { car.driving = false; const side = _v.set(1.7, 0, -0.1).applyQuaternion(st.q).add(st.pos); return { x: side.x, z: side.z }; };
  car.enter = () => { car.driving = true; car.look.yaw = 0; car.look.pitch = 0; };
  car.near = p => Math.hypot(p.x - st.pos.x, p.z - st.pos.z) < 4;

  const sound = car.sound = engineSound(car), hud = carHud(car);
  car.update(0);
  return car;
}
// the body's corners (against the ground) and sides (against the world), body frame (the centre of mass at 0)
const CORNERS = [];
for (const x of [-0.88, 0.88]) for (const z of [-1.92, 1.98]) for (const y of [-0.32, 0.88]) CORNERS.push([x, y, z]);
CORNERS.push([0, 1.28, -0.3], [0.62, 1.2, -0.3], [-0.62, 1.2, -0.3], [0.9, 0.55, 0], [-0.9, 0.55, 0]);
const SIDES = [[0.92, 0, 1.9], [-0.92, 0, 1.9], [0.95, 0, 0.65], [-0.95, 0, 0.65], [0.95, 0, -0.65], [-0.95, 0, -0.65], [0.92, 0, -1.85], [-0.92, 0, -1.85], [0, 0, 2.1], [0.5, 0, 2.05], [-0.5, 0, 2.05], [0, 0, -2.0], [0.5, 0, -1.98], [-0.5, 0, -1.98]];

// ---------------------------------------------------------------- the cabin's light
// A closed cabin is lit by what comes in through its windows: without that, the sky's light reaches every surface inside
// as if it stood in the open, and the dark trim all reads as one flat, sky-tinted shade. So the car's own occlusion is
// baked once, per vertex: the model's depth seen from 48 directions (its nearest surface kept by a max blend into a
// half-float target), each vertex lit by the share of directions over its hemisphere it can see out along. The sky's
// light (diffuse and reflected) is scaled by it, and what it leaves out comes back as the light bounced about the cabin:
// a part of the sky's, grey (light inside bounces off the trim, it does not keep the sky's blue). The cockpit's one material is told metal from trim by its own colour: bright, grey
// texels (the cage, the bolts, the metal fittings) metal and smoother, the dark ones rough non-metal, and none of it
// under the clear coat the model gives it all (it mirrored the sky off seats and floor alike). The arms, inside,
// take the cabin's share of the sky.
const CABIN = { floor: 0.25, bounce: 1.1, lift: 0.07, tow: 0.0042 }; // (the least share of the sky a vertex keeps; the bounced light, of the sky's; black trim lifted to; the carbon's tow, m)
// the carbon fibre of the cockpit's black trim: a 2/2 twill of rounded tows, laid on in the car's own space from the three
// axes (the trim's texture has no room for it), fading to its average where a pixel would cover a tow
const CARBON_GLSL = `varying vec3 vCabP, vCabN;
float cabTwill(vec2 p) { vec2 c = floor(p), f = fract(p); float warp = step(mod(c.x + c.y, 4.0), 1.5); return mix(0.5, 1.0, warp) * (0.68 + 0.32 * sin(3.14159 * (warp > 0.5 ? f.y : f.x))); }
float cabCarbonAt(vec3 P, vec3 N, float tow) { vec3 w = pow(abs(N), vec3(4.0)); w /= w.x + w.y + w.z + 1e-5; vec3 q = P / tow; float v = cabTwill(q.yz) * w.x + cabTwill(q.xz) * w.y + cabTwill(q.xy) * w.z; return mix(0.66, v, 1.0 - smoothstep(0.25, 0.6, length(fwidth(q)))); }`;
function cabinLight(model, driver, arms) {
  const t0 = performance.now(), V = () => new THREE.Vector3();
  const under = (o, f) => { for (let q = o; q && q !== model; q = q.parent) if (f(q)) return true; return false; };
  const glass = m => m.transparent || /window|glass/i.test(m.name);
  const occ = [], rec = []; model.updateMatrixWorld(true); const inv = model.matrixWorld.clone().invert();
  model.traverse(o => { if (!o.isMesh || o.isSkinnedMesh || under(o, q => q === driver)) return; const ms = Array.isArray(o.material) ? o.material : [o.material];
    if (ms.every(glass)) return; const M = new THREE.Matrix4().copy(inv).multiply(o.matrixWorld); occ.push({ o, M }); if (!under(o, q => /^(WHEEL_|SUSP_)/.test(q.name))) rec.push({ o, M }); }); // (the wheels move: they shade, but are not shaded)
  // (the bounds)
  const box = new THREE.Box3(), bb = new THREE.Box3(); for (const { o, M } of occ) { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); box.union(bb.copy(o.geometry.boundingBox).applyMatrix4(M)); }
  const C = box.getCenter(V()), Rr = box.getSize(V()).length() / 2 + 0.05, range = 2 * Rr + 0.2, res = 256, ND = 48;
  const bs = new THREE.Scene(), U = { uO: { value: V() }, uD: { value: V() }, uRange: { value: range } };
  const dm = new THREE.ShaderMaterial({ uniforms: U, side: THREE.DoubleSide, depthTest: false, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    vertexShader: 'varying vec3 vP; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: 'uniform vec3 uO, uD; uniform float uRange; varying vec3 vP; void main() { gl_FragColor = vec4(1.0 - dot(uO - vP, uD) / uRange, 0.0, 0.0, 1.0); }' });
  for (const { o, M } of occ) { const m = new THREE.Mesh(o.geometry, dm); m.matrixAutoUpdate = false; m.matrix.copy(M); m.matrixWorld.copy(M); m.frustumCulled = false; bs.add(m); }
  bs.matrixWorldAutoUpdate = false;
  const rt = new THREE.WebGLRenderTarget(res, res, { type: THREE.HalfFloatType, depthBuffer: false }), cam = new THREE.OrthographicCamera(-Rr, Rr, Rr, -Rr, 0.01, range + 0.2);
  const buf = new Uint16Array(res * res * 4), maps = [], half = THREE.DataUtils.fromHalfFloat;
  const prevRT = renderer.getRenderTarget(), prevCol = renderer.getClearColor(new THREE.Color()), prevA = renderer.getClearAlpha();
  renderer.setClearColor(0x000000, 0);
  for (let i = 0; i < ND; i++) { const t = Math.acos(1 - 2 * (i + 0.5) / ND), ph = Math.PI * (1 + Math.sqrt(5)) * i, d = V().set(Math.sin(t) * Math.cos(ph), Math.cos(t), Math.sin(t) * Math.sin(ph));
    const O = C.clone().addScaledVector(d, Rr + 0.1); cam.position.copy(O); cam.up.set(Math.abs(d.y) > 0.95 ? 1 : 0, Math.abs(d.y) > 0.95 ? 0 : 1, 0); cam.lookAt(C); cam.updateMatrixWorld(true);
    U.uO.value.copy(O); U.uD.value.copy(d); renderer.setRenderTarget(rt); renderer.clear(true, false, false); renderer.render(bs, cam);
    renderer.readRenderTargetPixels(rt, 0, 0, res, res, buf); const near = new Float32Array(res * res); for (let k = 0; k < res * res; k++) near[k] = (1 - half(buf[k * 4])) * range;
    const right = V().setFromMatrixColumn(cam.matrixWorld, 0), upv = V().setFromMatrixColumn(cam.matrixWorld, 1); maps.push({ d, O, right, upv, near }); }
  renderer.setRenderTarget(prevRT); renderer.setClearColor(prevCol, prevA); rt.dispose(); dm.dispose();
  // (each vertex: the directions over its hemisphere it sees out along, by the cosine)
  const p = V(), n = V(), q = V(), NM = new THREE.Matrix3(), done = new Map();
  for (const { o, M } of rec) { const g = o.geometry; if (done.has(g)) continue; const pa = g.attributes.position, na = g.attributes.normal; if (!na) continue;
    NM.getNormalMatrix(M); const ao = new Float32Array(pa.count);
    for (let i = 0; i < pa.count; i++) { p.fromBufferAttribute(pa, i).applyMatrix4(M); n.fromBufferAttribute(na, i).applyMatrix3(NM).normalize(); let sum = 0, wt = 0;
      for (const mp of maps) { const w = n.dot(mp.d); if (w <= 0.05) continue; q.copy(p).addScaledVector(n, 0.012); const rx = q.x - C.x, ry = q.y - C.y, rz = q.z - C.z;
        const u = Math.floor(((rx * mp.right.x + ry * mp.right.y + rz * mp.right.z) / Rr * 0.5 + 0.5) * res), v = Math.floor(((rx * mp.upv.x + ry * mp.upv.y + rz * mp.upv.z) / Rr * 0.5 + 0.5) * res);
        wt += w; if (u < 0 || v < 0 || u >= res || v >= res) { sum += w; continue; }
        const dv = (mp.O.x - q.x) * mp.d.x + (mp.O.y - q.y) * mp.d.y + (mp.O.z - q.z) * mp.d.z; if (dv <= mp.near[v * res + u] + 0.025) sum += w; }
      ao[i] = wt > 0 ? CABIN.floor + (1 - CABIN.floor) * sum / wt : 1; }
    g.setAttribute('ao', new THREE.BufferAttribute(ao, 1)); done.set(g, true); }
  // (the materials: the sky's light scaled by the occlusion and greyed where little comes in)
  const patched = new Set();
  const patch = (m, constAo) => { if (!m || patched.has(m)) return; patched.add(m); const ob = m.onBeforeCompile;
    m.onBeforeCompile = (sh, r) => { if (ob) ob(sh, r);
      if (m.userData.carbon) { sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vCabP, vCabN;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvCabP = position; vCabN = normal;'); sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + CARBON_GLSL);
        sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.28 + 0.22 * (1.0 - cabV), cabK);'); }
      if (constAo === undefined) { sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float ao; varying float vCabAo;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvCabAo = ao;'); sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vCabAo;'); }
      else sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nconst float vCabAo = ' + constAo.toFixed(3) + ';');
      if (m.userData.lift) sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb = diffuseColor.rgb * ' + (1 - m.userData.lift).toFixed(3) + ' + ' + m.userData.lift.toFixed(3) + ';' + (m.userData.carbon ? ' vec3 cabT = texture2D(map, vMapUv).rgb; float cabK = (1.0 - smoothstep(0.035, 0.075, dot(cabT, vec3(0.2126, 0.7152, 0.0722)))) * (1.0 - smoothstep(0.012, 0.03, max(cabT.r, max(cabT.g, cabT.b)) - min(cabT.r, min(cabT.g, cabT.b)))), cabV = cabCarbonAt(vCabP, normalize(vCabN), ' + CABIN.tow.toFixed(4) + '); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.051, 0.055) * (0.4 + 1.2 * cabV), cabK);' : ''));
      sh.fragmentShader = sh.fragmentShader.replace('#include <aomap_fragment>', '#include <aomap_fragment>\n{ float o = vCabAo; vec3 dI = reflectedLight.indirectDiffuse; reflectedLight.indirectDiffuse = mix(vec3(dot(dI, vec3(0.2126, 0.7152, 0.0722))), dI, 0.3 + 0.7 * o) * o + vec3(1.0, 0.97, 0.92) * dot(dI, vec3(0.2126, 0.7152, 0.0722)) * ' + CABIN.bounce.toFixed(3) + ' * (1.0 - o); vec3 sI = reflectedLight.indirectSpecular; reflectedLight.indirectSpecular = mix(vec3(dot(sI, vec3(0.2126, 0.7152, 0.0722))), sI, o) * (0.04 + 0.96 * o * o * o);' + (m.clearcoat > 0 ? ' clearcoatSpecularIndirect *= 0.04 + 0.96 * o * o * o;' : '') + ' }'); };
    m.customProgramCacheKey = () => 'cabin' + (constAo === undefined ? '' : constAo) + (m.name || ''); m.needsUpdate = true; };
  for (const { o } of rec) for (const m of Array.isArray(o.material) ? o.material : [o.material]) { if (/^(cockpit|steer)$/.test(m.name)) m.userData.lift = m.name === 'steer' ? CABIN.lift * 0.35 : CABIN.lift; // (the wheel's rim: black suede, kept dark)
    if (m.name === 'cockpit') m.userData.carbon = true; patch(m); }
  model.traverse(o => { if (!o.isMesh || o.isSkinnedMesh) return; const ms = Array.isArray(o.material) ? o.material : [o.material]; if (ms.some(m => patched.has(m)) && !o.geometry.attributes.ao) o.geometry.setAttribute('ao', new THREE.BufferAttribute(new Float32Array(o.geometry.attributes.position.count).fill(1), 1)); });
  if (arms) arms.traverse(o => { if (o.isSkinnedMesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) patch(m, 0.45); });
  // (the cockpit's metal and its trim, from its own colour)
  model.traverse(o => { if (!o.isMesh) return; const m = o.material; if (Array.isArray(m) || m.name !== 'cockpit' || !m.map || !m.map.image || m.userData.trim) return; m.userData.trim = true;
    const S = 1024, cv = document.createElement('canvas'); cv.width = cv.height = S; const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(m.map.image, 0, 0, S, S);
    const id = g.getImageData(0, 0, S, S), a = id.data;
    for (let k = 0; k < a.length; k += 4) { const r = a[k] / 255, gg = a[k + 1] / 255, b = a[k + 2] / 255, mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), L = (r + gg + b) / 3;
      const metal = smoothstep(0.22, 0.45, L) * (1 - smoothstep(0.06, 0.18, mx - mn)), rough = metal > 0 ? 0.62 - 0.3 * metal : L < 0.05 ? 0.78 : 0.62;
      a[k] = 255; a[k + 1] = Math.round(rough * 255); a[k + 2] = Math.round(metal * 255); a[k + 3] = 255; }
    g.putImageData(id, 0, 0); const tx = new THREE.CanvasTexture(cv); tx.flipY = m.map.flipY; tx.channel = m.map.channel; tx.colorSpace = THREE.NoColorSpace; tx.anisotropy = 4;
    m.metalnessMap = m.roughnessMap = tx; m.metalness = 1; m.roughness = 1; m.color.setScalar(1.15);
    m.clearcoat = 0; m.needsUpdate = true; }); // (the model lacquers the whole cabin — seats, floor, trim — with a mirror clear coat)
  // (the side glass: the model's is a dark green, as good as a privacy tint — a rally car's is clear)
  model.traverse(o => { if (o.isMesh && !Array.isArray(o.material) && o.material.name === 'window') { const m = o.material; m.color.setRGB(0.62, 0.7, 0.68); m.opacity = Math.min(m.opacity, 0.22); } });
  console.log('cabin light baked', (performance.now() - t0).toFixed(0), 'ms');
}

// the first-person arms: a skinned rig (a chest; each side an arm, an elbow, a wrist, a thumb and four fingers of three
// joints) posed in the car model's space.
//  - The hand's own frame is read from its rest pose: F from the wrist to the middle knuckle, T across the knuckles
//    toward the index (the thumb's side), N out of the palm (where the fingers bend); a left and a right hand differ in
//    handedness (sgn), so the same rule poses both.
//  - The fingers close round a bar by construction, not by search: in each finger's own bending plane, joint by joint
//    from the knuckle, each bone is laid tangent to the bar's surface (the bar's radius plus the finger's own thickness)
//    on the bar's far side — so it lies on the bar and never enters it — within the joint's range. The thumb, which
//    does not bend in one plane, is searched: its base flexion, its swing across the palm and the bend of its two outer
//    joints, so it lies along the bar's surface without entering it.
//  - Where in the hand a bar lies is worked out once per bar thickness and slant across the palm (prepare): the place,
//    among those the palm's own skin stays clear of, where the fingers go furthest round it.
//  - The hand's turn is taken from the forearm, not from the bar alone: the palm square to the bar and to the forearm,
//    the wrist straight (a little extended), the bar across the palm on the power grip's diagonal — its thumb end toward
//    the fingertips — between SLANT_MIN and SLANT_MAX (a bar square to the forearm is held with the wrist cocked a
//    little toward the thumb, as a hammer is). The forearm's direction depends on where the wrist ends up, so the grip
//    and the arm's IK are solved together, a few rounds.
//  - The arm: two-bone IK from the shoulder, the elbow's hinge kept in its own plane (it only ever bends one way) and
//    toward a pole; the forearm takes the wrist's roll (pronation and supination happen in the forearm, not the wrist).
//  - Contact is kept honest: the skin of the palm and knuckles is checked against the bar every other frame and pushes
//    the hand back where it would enter it; a hand letting go opens before it moves and travels clear of the bar; a
//    finger that would still meet the bar on the way opens only as far as it stays off it.
const CURL = [[0.3, 0.25, 0.4], [0.8, 1.35, 0.9], [0.8, 1.35, 0.9], [0.8, 1.35, 0.9], [0.8, 1.3, 0.85]]; // (the closed rest curl, per finger, per joint, rad; the thumb's: base flexion, swing, outer joints)
const FRT = [0.02, 0.019, 0.017]; // (the thumb's three bones: from the bone to its skin, m)
const BEND = [[[-0.5, 1.0], [-0.2, 1.2], [-0.2, 1.2]], [[-0.3, 1.25], [-0.1, 1.75], [-0.1, 1.3]]]; // (each joint's range beyond the rest pose's own bend: thumb, fingers)
const OPEN = [[0.1, 0.1, 0.1], [0, 0.15, 0.1], [0, 0.15, 0.1], [0, 0.15, 0.1], [0, 0.2, 0.1]]; // (an open, relaxed hand's bends)
const SLANTS = [0.2, 0.3, 0.4, 0.5, 0.6], SLANT_MIN = 0.22, SLANT_MAX = 0.55; // (the bar's angle across the palm: the grips worked out for, and the range held)
const PALM = [0.0005, 0.0015]; // (how near the bar the palm's skin comes, m: its nearest point, between)
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
  // the palm's skin in the rest pose (the vertices the wrist and the palm bones carry), for keeping a bar off it
  const handSkin = { L: [], R: [] }; // (vertex indices: the palm and the knuckles — checked against the bar each few frames; the thumb keeps itself off it)
  const palmSkin = { L: [], R: [] }, fingSkin = { L: [[], [], [], [], []], R: [[], [], [], [], []] }; { const si = skin.geometry.attributes.skinIndex, sw = skin.geometry.attributes.skinWeight, sk = skin.skeleton.bones, pa = skin.geometry.attributes.position, tmp = V(), mw = new THREE.Matrix4().copy(inv).multiply(skin.matrixWorld);
    for (let i = 0; i < pa.count; i++) { let bi = 0, bw = -1; for (let k = 0; k < 4; k++) { const wv = sw.getComponent(i, k); if (wv > bw) { bw = wv; bi = si.getComponent(i, k); } }
      const h = /^(L|R)_(wrist|palm|point1|middle1|ring1|pink1)/.exec(sk[bi].name); if (h) handSkin[h[1]].push(i);
      const m = /^(L|R)_(wrist|palm)/.exec(sk[bi].name); if (m) { skin.getVertexPosition(i, tmp); palmSkin[m[1]].push(tmp.clone().applyMatrix4(mw)); }
      const fg = /^(L|R)_(point|middle|ring|pink)([1-4])/.exec(sk[bi].name); if (fg) { skin.getVertexPosition(i, tmp); fingSkin[fg[1]][['', 'point', 'middle', 'ring', 'pink'].indexOf(fg[2])].push({ X: tmp.clone().applyMatrix4(mw), k: Math.min(+fg[3] - 1, 2) }); } } }
  const side = p => {
    const b = k => bone(p + '_' + k), up = b('arm'), el = b('elbow'), wr = b('wrist');
    const S0 = P(up), E0 = P(el), W0 = P(wr);
    const fing = ['thumb', 'point', 'middle', 'ring', 'pink'].map(f => [1, 2, 3, 4].map(i => b(f + i))), kn = k => P(fing[k][0]);
    const F0 = kn(2).sub(W0).normalize(), across = kn(1).sub(kn(4)); // (toward the middle knuckle; from the little finger to the index)
    const m1 = kn(2), m2 = P(fing[2][1]), m3 = P(fing[2][2]), bend = m3.clone().sub(m2).normalize().sub(m2.clone().sub(m1).normalize()); // (the rest pose's fingers bend a little: toward the palm)
    const N0 = V().crossVectors(across, F0); if (N0.dot(bend) < 0) N0.negate(); N0.addScaledVector(F0, -N0.dot(F0)).normalize();
    const T0 = V().crossVectors(F0, N0), sgn = T0.dot(across) < 0 ? -1 : 1; T0.multiplyScalar(sgn); // (T0 = sgn·F0×N0, N0 = sgn·T0×F0)
    const u0 = E0.clone().sub(S0).normalize(), f0 = W0.clone().sub(E0).normalize(), n0 = V().crossVectors(u0, f0).normalize();
    // each finger: its bones' lengths and rest directions, its bending plane (x along the first bone, y the way it bends,
    // the joints' axis z), and the rest pose's own bend at each joint in that plane
    const fd = fing.map((ch, fi) => { const J = ch.map(P), d = [0, 1, 2].map(k => J[k + 1].clone().sub(J[k])), L = d.map(v => v.length()); d.forEach(v => v.normalize());
      const z = V().crossVectors(d[0], fi ? N0 : N0.clone().addScaledVector(F0, 0.0)).normalize(), x = d[0].clone(), y = V().crossVectors(z, x);
      const ang2 = v => Math.atan2(v.dot(y), v.dot(x)), rb = [0, ang2(d[1]) - ang2(d[0]), ang2(d[2]) - ang2(d[1])];
      const joints = ch.slice(0, 3).map((bo, j) => ({ bo, q0: bo.quaternion.clone(), ax: z.clone().applyQuaternion(Q(bo).invert()), ax2: d[j].clone().cross(F0).normalize().applyQuaternion(Q(bo).invert()) }));
      // (a finger's skin, bone by bone: each vertex as its distance and angle from the joint in the bone's own frame in the
      // finger's plane, and its height off that plane — it turns with the bone about the joint)
      const sk = [[], [], []], skE = [[], [], []]; let dr = 0; // (skE: its bending side, every other vertex — for working out the grips)
      for (let k = 0; k < 3 && fi; k++) { dr += rb[k]; const ub = x.clone().multiplyScalar(Math.cos(dr)).addScaledVector(y, Math.sin(dr)), vb = y.clone().multiplyScalar(Math.cos(dr)).addScaledVector(x, -Math.sin(dr)), zk = J[k].clone().sub(J[0]).dot(z);
        for (const o of fingSkin[p][fi]) { if (o.k !== k) continue; const r = o.X.clone().sub(J[k]), lx = r.dot(ub), ly = r.dot(vb), v3 = [Math.hypot(lx, ly), Math.atan2(ly, lx), r.dot(z) + zk]; sk[k].push(...v3); if (ly > -0.004 && sk[k].length % 6 === 3) skE[k].push(...v3); } }
      return { L, x, y, z, rb, joints, P0: J[0].clone().sub(W0), sk: sk.map(a => new Float32Array(a)), skE: skE.map(a => new Float32Array(a)) }; });
    const pre = fing.map(ch => { const l = []; for (let o = ch[0].parent; o && o !== wr; o = o.parent) l.unshift(o); return l; });
    const palm = palmSkin[p].filter((_, i) => i % 2 === 0).map(v => v.sub(W0)); // (relative to the wrist, rest frame)
    const wrS = V(); new THREE.Matrix4().copy(inv).multiply(wr.matrixWorld).decompose(V(), new THREE.Quaternion(), wrS); // (the wrist's scale in the model's space)
    return { p, up, el, wr, fing, fd, pre, palm, wrS, Qw: new THREE.Quaternion(), tf: 0, S0, W0, Lu: E0.distanceTo(S0), Lf: W0.distanceTo(E0), Qu0: Q(up), Qf0: Q(el), Qw0: Q(wr), sgn, F0, N0, T0, f0,
      B0t: new THREE.Matrix4().makeBasis(T0, F0, N0).transpose(), H0t: new THREE.Matrix4().makeBasis(u0, n0, V().crossVectors(u0, n0)).transpose(),
      rel0i: Q(el).invert().multiply(Q(wr)).invert(), axF: wr.position.clone().normalize(),
      ang: fing.map((_, fi) => CURL[fi].slice()), // (each finger's three bends as last set; the thumb's: base flexion, swing, outer joints)
      skinIdx: handSkin[p], push: 0, pc: 0, tg: CURL[0].slice(), cal: {}, G: V(), Rh: new THREE.Quaternion(), Wm: V(), dbg: { C: V(), bar: V(), T: V(), F: V(), N: V(), E: V(), W: V(), Wt: V() } };
  };
  const S = { L: side('L'), R: side('R') };
  const M = new THREE.Matrix4(), qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), qt = new THREE.Quaternion(), qt2 = new THREE.Quaternion();
  const Qu = new THREE.Quaternion(), Qf = new THREE.Quaternion(), rel = new THREE.Quaternion(), qr = new THREE.Quaternion(), qw2 = new THREE.Quaternion();
  const T = V(), Fv = V(), N = V(), d = V(), perp = V(), E = V(), Wr = V(), u = V(), f = V(), n = V(), w = V(), g = V(), fa = V();
  const fx = V(), fy = V(), fz = V(), p0 = V(), bc = V(), bd = V(), lv = V();
  // two-bone IK on positions: the elbow E and the reachable wrist Wr for a wrist target, the elbow toward pole
  const reach = (sd, Wt, pole) => { d.subVectors(Wt, sd.S0); const dl = Math.min(d.length(), sd.Lu + sd.Lf - 1e-3); d.normalize();
    const ca = clamp((sd.Lu * sd.Lu + dl * dl - sd.Lf * sd.Lf) / (2 * sd.Lu * dl), -1, 1), sa = Math.sqrt(1 - ca * ca);
    perp.copy(pole).addScaledVector(d, -pole.dot(d)).normalize();
    E.copy(sd.S0).addScaledVector(d, sd.Lu * ca).addScaledVector(perp, sd.Lu * sa); Wr.copy(sd.S0).addScaledVector(d, dl); };
  // a finger laid round a bar: the hand at wrist W turned Rh from rest; bar.near(p, outC, outDir) gives the bar's centre
  // line point nearest p and its direction there. Writes the three bends into a and returns how far round the bar the
  // finger goes (rad) and how near its skin comes to the bar (m, < 0: inside).
  // The bar's section in the finger's plane is an ellipse (it crosses the plane on a slant: its long axis along the bar's
  // way, R/|kz| by R), its centre shifting with the height off the plane; each of a bone's skin vertices sweeps a circle
  // round the bone's joint as the joint bends, and meets that section along an arc of bends — the bone is bent until the
  // first of its vertices comes to the bar, gap off its surface.
  const TWO_PI = Math.PI * 2; let eKz = 1, eMj = 0, eSx = 0, eSy = 0;
  const ell = (dx, dy, R) => { const ps = Math.atan2(dy, dx) - eMj, a = R / eKz, c = Math.cos(ps), s = Math.sin(ps); return a * R / Math.sqrt(R * R * c * c + a * a * s * s); };
  // (the bar's crossing of the finger's plane near p: its centre (kx, ky) in the plane's x, y and the section's shape)
  const cross = (p, bar, out) => { bar.near(p, bc, bd); lv.subVectors(bc, p0); const kz = bd.dot(fz), ok = Math.abs(kz) > 0.3;
    eSx = ok ? bd.dot(fx) / kz : 0; eSy = ok ? bd.dot(fy) / kz : 0; out[0] = lv.dot(fx) - lv.dot(fz) * eSx; out[1] = lv.dot(fy) - lv.dot(fz) * eSy;
    eKz = Math.max(0.6, Math.abs(kz)); eMj = Math.atan2(bd.dot(fy), bd.dot(fx)); };
  // the most a bone may bend from base before its skin comes within gap of the bar (bending on from lo), or null if it
  // is there already at lo
  const boneMax = (vs, vx, vy, R, gap, base, lo, passes = 2) => { let best = Infinity;
    for (let i = 0; i < vs.length; i += 3) { const rho = vs[i], al = vs[i + 1], ze = vs[i + 2], cx = vx + ze * eSx, cy = vy + ze * eSy, rc = Math.hypot(cx, cy), b0 = Math.atan2(cy, cx);
      let r = R / eKz + gap, e = 0, ac = 0, hit = true;
      for (let pass = 0; pass < passes; pass++) { const kp = (rho * rho + rc * rc - r * r) / (2 * rho * rc); if (kp >= 1) { hit = false; break; } if (kp <= -1) return null;
        ac = Math.acos(kp); e = b0 - al - ac - base; e = lo + (((e - lo) % TWO_PI) + TWO_PI) % TWO_PI;
        if (!pass && passes > 1) { const an = base + e + al; r = ell(rho * Math.cos(an) - cx, rho * Math.sin(an) - cy, R) + gap; } } // (the section's radius where they meet)
      if (!hit) continue;
      if (e + 2 * ac >= lo + TWO_PI) return null;
      if (e < best) best = e; }
    return best; };
  // how near a bone's skin comes to the bar (m, < 0: inside), the bone's joint at (px, py) in the finger's plane and the
  // bone along d: each vertex put in its place and measured against the bar itself (a rim's own curve, at any slant)
  const vp = V();
  const boneGap = (vs, px, py, d, bar) => { let g = Infinity;
    for (let i = 0; i < vs.length; i += 3) { const an = d + vs[i + 1]; vp.copy(p0).addScaledVector(fx, px + vs[i] * Math.cos(an)).addScaledVector(fy, py + vs[i] * Math.sin(an)).addScaledVector(fz, vs[i + 2]); g = Math.min(g, bar.dist(vp) - bar.tube); }
    return g; };
  // (the same by the section's estimate, for working out the grips)
  const boneGap0 = (vs, vx, vy, R, d) => { let g = Infinity;
    for (let i = 0; i < vs.length; i += 3) { const an = d + vs[i + 1], dx = vs[i] * Math.cos(an) - vx - vs[i + 2] * eSx, dy = vs[i] * Math.sin(an) - vy - vs[i + 2] * eSy; g = Math.min(g, Math.hypot(dx, dy) - ell(dx, dy, R)); }
    return g; };
  // the bend from lo up to hi at which a bone's skin is gap off the bar, by halving (the section's estimate was off)
  const boneFit = (vs, px, py, base, lo, hi, bar, gap) => { if (boneGap(vs, px, py, base + lo, bar) < gap) return null;
    for (let it = 0; it < 10; it++) { const m = (lo + hi) / 2; if (boneGap(vs, px, py, base + m, bar) < gap) hi = m; else lo = m; }
    return lo; };
  const kc = [0, 0], jp = V();
  const lay = (sd, fi, W, Rh, bar, a, exact = true) => { const D = sd.fd[fi], lim = BEND[1]; // (exact: the estimate checked against the bar itself)
    fx.copy(D.x).applyQuaternion(Rh); fy.copy(D.y).applyQuaternion(Rh); fz.copy(D.z).applyQuaternion(Rh); p0.copy(D.P0).applyQuaternion(Rh).add(W);
    cross(p0, bar, kc); const cx = kc[0], cy = kc[1];
    // bone by bone from the knuckle: each bent until its skin lies on the bar, within its joint's range. A bone its joint
    // cannot straighten enough for (it would enter the bar) makes the joint before it open up, and the finger is laid again
    const cap = [lim[0][1], lim[1][1], lim[2][1]];
    let wrap = 0, worst = Infinity;
    for (let tries = 0; tries < 8; tries++) {
      let px = 0, py = 0, dir = 0, ang = Math.atan2(-cy, -cx), bad = -1; wrap = 0; worst = Infinity;
      for (let k = 0; k < 3; k++) {
        cross(jp.copy(p0).addScaledVector(fx, px).addScaledVector(fy, py), bar, kc); // (a rim curves: the bar taken afresh nearest this joint)
        const vx = kc[0] - px, vy = kc[1] - py, base = dir + D.rb[k], vs = exact ? D.sk[k] : D.skE[k];
        const gk = rig.gapK[k]; // (each bone's own press into the bar: the fingertips' pads give most, so the tips curl round it)
        let mx = boneMax(vs, vx, vy, bar.tube, gk, base, lim[k][0], exact ? 2 : 1); if (mx !== null) mx = Math.min(mx, cap[k]);
        // (the section's ellipse is an estimate, true where the bar crosses the finger's plane squarely: checked against
        // the bar itself, and fitted afresh where it was off)
        if (exact && (mx === null || boneGap(vs, px, py, base + mx, bar) < gk - 0.0007)) mx = boneFit(vs, px, py, base, lim[k][0], mx === null ? cap[k] : mx, bar, gk + 0.0002);
        const bb = mx === null ? lim[k][0] : mx;
        a[k] = bb; dir = base + bb;
        const gap = exact ? boneGap(vs, px, py, dir, bar) : boneGap0(vs, vx, vy, bar.tube, dir); worst = Math.min(worst, gap - gk); // (worst: past each bone's own press)
        if (mx === null && gap < -0.001 && k > 0 && bad < 0) bad = k;
        px += Math.cos(dir) * D.L[k]; py += Math.sin(dir) * D.L[k]; const an = Math.atan2(py - cy, px - cx); if (gap < 0.004) wrap += Math.atan2(Math.sin(an - ang), Math.cos(an - ang)); ang = an; } // (round the bar, the bending way, signed — counted only for a bone lying on it)
      if (bad < 0) break;
      cap[bad - 1] = Math.max(lim[bad - 1][0], a[bad - 1] - 0.12);
    }
    return { wrap, worst }; };
  // a finger lay could not fit round the bar (the hand passing at a slant, a rim curving away): of a grid of bends, of
  // those that keep clear of the bar the one lying closest to it (and nearest the laid one), else the one keeping furthest
  const unstick = (sd, fi, W, bar, a) => { const lim = BEND[1], b = [0, 0, 0], best = [0, 0, 0]; let bc2 = -Infinity, bd2 = Infinity, ok = false;
    for (let i = 0; i < 13; i++) for (let j = 0; j < 13; j++) { b[0] = lim[0][0] + (lim[0][1] - lim[0][0]) * i / 12; b[1] = lim[1][0] + (lim[1][1] - lim[1][0]) * j / 12; b[2] = clamp(b[1] * CURL[fi][2] / CURL[fi][1], lim[2][0], lim[2][1]);
      const cl = clearance(sd, fi, W, sd.Rh, bar, b), dd = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
      const sc = cl >= 0 ? cl * 400 + dd : 0; if (cl >= 0 ? (!ok || sc < bd2) : (!ok && cl > bc2)) { ok = ok || cl >= 0; bc2 = cl; bd2 = sc; best[0] = b[0]; best[1] = b[1]; best[2] = b[2]; } }
    a[0] = best[0]; a[1] = best[1]; a[2] = best[2]; };
  // how near a finger with bends a comes to entering the bar (m, < 0: inside), by the same model as lay
  const clearance = (sd, fi, W, Rh, bar, a) => { const D = sd.fd[fi];
    fx.copy(D.x).applyQuaternion(Rh); fy.copy(D.y).applyQuaternion(Rh); fz.copy(D.z).applyQuaternion(Rh); p0.copy(D.P0).applyQuaternion(Rh).add(W);
    let px = 0, py = 0, dir = 0, worst = Infinity;
    for (let k = 0; k < 3; k++) { dir += D.rb[k] + a[k]; worst = Math.min(worst, boneGap(D.sk[k], px, py, dir, bar)); px += Math.cos(dir) * D.L[k]; py += Math.sin(dir) * D.L[k]; }
    return worst; };
  // the thumb: its joints for a = [base flexion, swing, outer joints' bend], from the wrist as posed (sd.Wm, sd.Qw)
  const M1 = new THREE.Matrix4(), M2 = new THREE.Matrix4(), qf = new THREE.Quaternion(), tp = Array.from({ length: 4 }, V), ts = Array.from({ length: 6 }, V); const TIP = 0.006; // (the thumb's pad past its last joint, m)
  const thumbFK = (sd, a) => { M1.compose(sd.Wm, sd.Qw, sd.wrS); for (const o of sd.pre[0]) M1.multiply(M2.compose(o.position, o.quaternion, o.scale));
    const ch = sd.fing[0], Js = sd.fd[0].joints;
    for (let j = 0; j < 3; j++) { qf.copy(Js[j].q0).multiply(qt.setFromAxisAngle(Js[j].ax, j ? a[2] : a[0])); if (!j) qf.multiply(qt2.setFromAxisAngle(Js[0].ax2, a[1]));
      M1.multiply(M2.compose(ch[j].position, qf, ch[j].scale)); tp[j].setFromMatrixPosition(M1); }
    M1.multiply(M2.compose(ch[3].position, ch[3].quaternion, ch[3].scale)); tp[3].setFromMatrixPosition(M1);
    ts[0].lerpVectors(tp[0], tp[1], 0.5); ts[1].copy(tp[1]); ts[2].lerpVectors(tp[1], tp[2], 0.5); ts[3].copy(tp[2]); ts[4].lerpVectors(tp[2], tp[3], 0.5); ts[5].copy(tp[3]).addScaledVector(ts[0].subVectors(tp[3], tp[2]).normalize(), TIP); ts[0].lerpVectors(tp[0], tp[1], 0.5); return ts; };
  const T_RELAX = [0.3, 0.5, 0.6]; const T_R = [FRT[0], FRT[1] + 0.003, FRT[1] + 0.002, FRT[2], FRT[2], FRT[2]], T_W = [0, 12, 40, 40, 40, 40], T_LIM = [[-0.6, 1.35], [-0.6, 1.1], [-0.3, 1.3]], tc = [0, 0, 0];
  // how badly the thumb lies along the bar: entering it costs much, standing off it a little; a pull toward the rest pose
  // (and where a driver keeps it: on the bar's back, the side toward the wrist, never round the fingers' side, its tip
  // over the bar's inner half and laid along the bar toward the thumb's end — up the rim — not hooked across it)
  const tN = V(), tF = V(), tT = V(), tq = V();
  const thumbCost = (sd, a, bar) => { const q = thumbFK(sd, a); let c = 0;
    tN.copy(sd.N0).applyQuaternion(sd.Rh); tF.copy(sd.F0).applyQuaternion(sd.Rh); tT.copy(sd.T0).applyQuaternion(sd.Rh);
    const tp = bar.thumb || rig.thumbBar; // (per bar: on the rim hooked round its inner side, on a lever wrapped round it)
    bar.near(q[5], bc, bd); const past = tq.subVectors(q[5], bc).dot(tN); if (past < tp.past) c += 3000 * (tp.past - past) * (tp.past - past);
    if (tp.K) { if (bd.dot(tT) < 0) bd.negate(); const along = tq.subVectors(q[5], q[1]).dot(bd); if (along < tp.along) c += tp.K * (tp.along - along) * (tp.along - along); }
    if (a[2] < tp.bend) c += 5 * (tp.bend - a[2]) * (tp.bend - a[2]); // (a thumb round a bar is bent at its joints, never held out straight)
    bar.near(q[3], bc, bd); const front = tq.subVectors(q[3], bc).dot(tF); if (front > 0) c += 3000 * front * front;
    for (let i = 0; i < 6; i++) { const dd = bar.dist(q[i]) - bar.tube - T_R[i]; c += dd < 0 ? 200000 * dd * dd : rig.thC * T_W[i] * dd * dd; }
    for (let j = 0; j < 3; j++) c += tp.w * (a[j] - tp.pref[j]) * (a[j] - tp.pref[j]); return c; }; // (one way of holding it, preferred: the search does not wander between ways)
  const SEEDS = [[0.3, 0.25, 0.4], [0.6, 0.6, 0.8], [0.1, 0.7, 0.9], [0.8, 0.2, 0.6], [-0.2, 0.5, 1.0]];
  const thumbFresh = (sd, a, bar) => { let best = Infinity; const b = [0, 0, 0], keep = [0, 0, 0];
    const lm = (bar.thumb || rig.thumbBar).lim || T_LIM; for (const s0 of SEEDS) { for (let j = 0; j < 3; j++) b[j] = clamp(s0[j], lm[j][0], lm[j][1]); const c = thumbSearch(sd, b, bar, [0.25, 0.1, 0.04, 0.015]); if (c < best) { best = c; keep[0] = b[0]; keep[1] = b[1]; keep[2] = b[2]; } }
    a[0] = keep[0]; a[1] = keep[1]; a[2] = keep[2]; return best; };
  const thumbSearch = (sd, a, bar, steps) => { let best = thumbCost(sd, a, bar);
    for (const step of steps) for (let it = 0; it < 4; it++) { let moved = false;
      for (let j = 0; j < 3; j++) for (const sg of [1, -1]) { tc[0] = a[0]; tc[1] = a[1]; tc[2] = a[2]; const lm = (bar.thumb || rig.thumbBar).lim || T_LIM; tc[j] = clamp(a[j] + sg * step, lm[j][0], lm[j][1]);
        const c = thumbCost(sd, tc, bar); if (c < best) { best = c; a[0] = tc[0]; a[1] = tc[1]; a[2] = tc[2]; moved = true; } }
      if (!moved) break; }
    return best; };
  const lineBar = (tube, B, dir) => ({ tube, near: (q, oc, od) => { oc.copy(B).addScaledVector(dir, lv.subVectors(q, B).dot(dir)); od.copy(dir); },
    dist: q => { lv.subVectors(q, B); return lv.addScaledVector(dir, -lv.dot(dir)).length(); } });
  // where a bar of radius tube crossing the palm at slant phi lies in the hand (rest frame, against the wrist): among
  // the places the palm's skin stays clear of, the one the fingers go furthest round
  const calibrate = (sd, tube, phi) => {
    const dir = sd.T0.clone().multiplyScalar(Math.cos(phi)).addScaledVector(sd.F0, Math.sin(phi)), Rh = new THREE.Quaternion(), a = [0, 0, 0];
    // (the palm's skin just touching the bar — its nearest point between PALM[0] and PALM[1] off the bar's surface — and,
    // of those places, the one the fingers go furthest round; a coarse search, then a fine one round the best)
    const at = (df, dn) => { const G = sd.F0.clone().multiplyScalar(df).addScaledVector(sd.N0, dn), B = G.clone().add(sd.W0), bar = lineBar(tube, B, dir);
      let gmin = Infinity; for (const v of sd.palm) gmin = Math.min(gmin, bar.dist(lv.copy(v).add(sd.W0)) - tube);
      let score = -3000 * Math.max(0, PALM[0] - gmin) - 1500 * Math.max(0, gmin - PALM[1]);
      for (let fi = 1; fi < 5; fi++) { const r = lay(sd, fi, sd.W0, Rh, bar, a, false); score += Math.min(r.wrap, 3.6) - (r.worst < 0 ? 600 * -r.worst : 0); }
      return { score, G, gmin, df, dn }; };
    let best = null; // (a coarse grid, then finer ones round the best)
    for (let df = 0.05; df <= 0.171; df += 0.02) for (let dn = 0.015; dn <= 0.096; dn += 0.01) { const r = at(df, dn); if (!best || r.score > best.score) best = r; }
    for (const [sf, nf, sn, nn] of [[0.005, 3, 0.002, 4], [0.001, 4, 0.0005, 4]]) { const f0 = best.df, n0 = best.dn;
      for (let i = -nf; i <= nf; i++) for (let j = -nn; j <= nn; j++) { const r = at(f0 + i * sf, n0 + j * sn); if (r.score > best.score) best = r; } }
    return best; };
  const gripAt = (sd, tube, phi, outG) => { const C = sd.cal[tube.toFixed(4)]; if (!C) return outG.copy(sd.F0).multiplyScalar(0.13).addScaledVector(sd.N0, 0.05);
    const x = clamp((phi - SLANTS[0]) / (SLANTS[1] - SLANTS[0]), 0, SLANTS.length - 1.001), i = Math.floor(x), t = x - i;
    return outG.copy(C[i].G).lerp(C[i + 1].G, t); };
  const rig = {
    S, ext: 0.12, twist: 0.85, frame: 0, gap: -0.0004, gapK: [-0.0003, -0.0006, -0.0012], // (the finger pads pressed a little into the bar: a grip, not a touch — the fingertips most)
    thumbFK: (...x) => thumbFK(...x), thumbCost: (...x) => thumbCost(...x), clearance: (...x) => clearance(...x), rimBar: null, thumbBar: { past: 0.008, along: 0, K: 0, bend: 0.7, pref: [1.0, 0.6, 0.8], w: 0.08 },
    thumbRim: { past: 0.006, along: 0.03, K: 5000, bend: 0.35, pref: [0.2, 0.5, 0.5], w: 0.2, lim: [[-0.15, 0.6], [0.25, 0.8], [0.3, 0.95]] }, thC: 300, lay: (...x) => lay(...x),
    // (above: each bar's one way of holding the thumb — on the rim hooked over its inner side toward the hub, on a lever wrapped round it — and the range it may move in about it, so it never flips to another)
    // work out the grips for the bars this car has (their radii)
    prepare(tubes) { for (const tube of tubes) { const key = tube.toFixed(4); S.L.cal[key] = SLANTS.map(phi => calibrate(S.L, tube, phi));
      S.R.cal[key] = S.L.cal[key].map(c => ({ ...c, G: S.R.F0.clone().multiplyScalar(c.df).addScaledVector(S.R.N0, c.dn) })); } }, // (the hands are each other's mirror image: worked out once)
    // the wrist's place and turn for a grip on a bar: C a point on the bar's centre line, A along the bar toward the
    // thumb, tube the bar's radius; the elbow toward pole
    target(side, C, A, tube, out, pole) { const sd = S[side];
      fa.subVectors(C, sd.S0).normalize(); // (the first guess at the forearm: from the shoulder)
      for (let it = 0; it < 4; it++) {
        // the palm square to the bar and to the forearm; the bar across it on the power grip's diagonal — its thumb end
        // toward the fingertips — as a straight wrist gives it, kept between SLANT_MIN and SLANT_MAX (a bar square to the
        // forearm is held with the wrist cocked a little toward the thumb, as a hammer is)
        N.crossVectors(A, fa).multiplyScalar(sd.sgn).normalize(); w.crossVectors(N, A).normalize(); if (w.dot(fa) < 0) w.negate();
        const phi = clamp(Math.asin(clamp(A.dot(fa), -1, 1)), SLANT_MIN, SLANT_MAX);
        T.copy(A).multiplyScalar(Math.cos(phi)).addScaledVector(w, -Math.sin(phi)); Fv.copy(A).multiplyScalar(Math.sin(phi)).addScaledVector(w, Math.cos(phi));
        if (rig.ext) Fv.applyAxisAngle(T, -rig.ext * sd.sgn);                   // (the wrist a little extended, as a grip holds it)
        N.crossVectors(T, Fv).multiplyScalar(sd.sgn);
        M.makeBasis(T, Fv, N).multiply(sd.B0t); qa.setFromRotationMatrix(M);
        gripAt(sd, tube, Math.atan2(A.dot(Fv), A.dot(T)), sd.G);              // (where in the hand a bar at this slant lies)
        out.p.copy(C).sub(g.copy(sd.G).applyQuaternion(qa)).addScaledVector(N, -sd.push); // (pushed back where the skin itself met the bar)
        reach(sd, out.p, pole); fa.subVectors(Wr, E).normalize();             // (where that puts the forearm, for the next round)
      }
      out.q.copy(qa).multiply(sd.Qw0);
      sd.dbg.C.copy(C); sd.dbg.bar.copy(A); sd.dbg.T.copy(T); sd.dbg.F.copy(Fv); sd.dbg.N.copy(N); sd.dbg.Wt.copy(out.p);
      return out; },
    // the arm to a wrist pose (Wt, Qw); bar {near(p, oc, od), dist(p), tube} the bar the fingers close round (null: their
    // rest curl); open 0 holding .. 1 open (letting go of the bar or closing on it: the fingers only ever more open than
    // laid round it, so they never enter it); flick opens the index and middle finger (unused: the paddle is gone); the elbow toward pole
    solve(side, Wt, Qw, open, pole, flick = 0, bar = null, dt = 1 / 60) { const sd = S[side]; sd.open = open;
      // the skin itself against the bar (last frame's pose, every other frame): any of it inside pushes the hand back off
      // the bar a little; with none inside the push eases away, so the hand settles where the skin just meets the bar
      if (bar && ++sd.pc % 2 === 0) { parent.updateWorldMatrix(true, false); M.copy(parent.matrixWorld).invert(); let deep = 0;
        for (const i of sd.skinIdx) { skin.getVertexPosition(i, g); g.applyMatrix4(skin.matrixWorld).applyMatrix4(M); deep = Math.max(deep, bar.tube - bar.dist(g)); }
        sd.push = clamp(deep > 0.0004 ? sd.push + deep * 1.2 : sd.push * 0.93, 0, 0.02); }
      else if (!bar) sd.push *= 0.9;
      reach(sd, Wt, pole);
      u.subVectors(E, sd.S0).normalize(); f.subVectors(Wr, E).normalize(); n.crossVectors(u, f).normalize();
      M.makeBasis(u, n, w.crossVectors(u, n)).multiply(sd.H0t); qa.setFromRotationMatrix(M); Qu.copy(qa).multiply(sd.Qu0); // (the upper arm, its hinge plane kept)
      qb.setFromUnitVectors(w.copy(sd.f0).applyQuaternion(qa), f); Qf.copy(qb).multiply(qa).multiply(sd.Qf0);          // (the forearm bent onto the wrist)
      rel.copy(Qf).invert().multiply(Qw).multiply(sd.rel0i); const pr = rel.x * sd.axF.x + rel.y * sd.axF.y + rel.z * sd.axF.z;
      let tw = 2 * Math.atan2(pr, rel.w); if (tw > Math.PI) tw -= 2 * Math.PI; else if (tw < -Math.PI) tw += 2 * Math.PI;
      Qf.multiply(qt.setFromAxisAngle(sd.axF, tw * rig.twist)); // (the forearm rolls with the wrist)
      // (a hand in the air, between holds, relaxes toward the wrist's rest pose against the forearm)
      if (open > 0) { qr.copy(sd.rel0i).invert(); Qw = qw2.copy(Qf).multiply(qr).slerp(Qw, 1 - 0.6 * open); }
      sd.up.quaternion.copy(chestQi).multiply(Qu); sd.el.quaternion.copy(Qu).invert().multiply(Qf); sd.wr.quaternion.copy(Qf).invert().multiply(Qw);
      sd.Wm.copy(Wr); sd.Qw.copy(Qw); sd.Rh.copy(Qw).multiply(qt.copy(sd.Qw0).invert()); sd.dbg.E.copy(E); sd.dbg.W.copy(Wr);
      // the fingers: laid round the bar, or easing to their rest curl
      const k = 1 - Math.exp(-dt * 22), tmp = [0, 0, 0];
      for (let fi = 0; fi < 5; fi++) { const a = sd.ang[fi];
        if (bar) { if (fi) { if (lay(sd, fi, Wr, sd.Rh, bar, tmp).worst < -0.0011) unstick(sd, fi, Wr, bar, tmp); } else { tmp[0] = sd.tg[0]; tmp[1] = sd.tg[1]; tmp[2] = sd.tg[2]; const tc0 = thumbSearch(sd, tmp, bar, ++sd.tf % 8 === 1 ? [0.3, 0.12, 0.05, 0.02, 0.008] : open > 0 ? [0.12, 0.04, 0.015, 0.006] : [0.04, 0.015, 0.006]); sd.tcAvg = sd.tcAvg === undefined ? tc0 : sd.tcAvg + (tc0 - sd.tcAvg) * 0.05; if (tc0 > 2.5 * sd.tcAvg + 0.3) { /* (a fresh search only when this way of holding it has gone bad) */ const b2 = [0, 0, 0]; if (thumbFresh(sd, b2, bar) < tc0 * 0.8) { tmp[0] = b2[0]; tmp[1] = b2[1]; tmp[2] = b2[2]; } } sd.tg[0] = tmp[0]; sd.tg[1] = tmp[1]; sd.tg[2] = tmp[2]; }
          if (!fi) { const kr = smoothstep(0.5, 0.9, open), cT = thumbCost(sd, tmp, bar), tr = [0, 0, 0]; for (let j = 0; j < 3; j++) tr[j] = tmp[j] + (T_RELAX[j] - tmp[j]) * kr; const tgt = kr > 0 && thumbCost(sd, tr, bar) > cT + 0.3 ? tmp : tr, mv = bar.thumb && open < 0.05 ? dt * (thumbCost(sd, a, bar) > cT + 0.3 ? 30 : 5) : 9; /* (paced only while it holds the rim) */ for (let j = 0; j < 3; j++) a[j] += clamp(tgt[j] - a[j], -mv, mv); } // (and it moves at a thumb's pace, never in a jump — quicker only to get out of the bar's way) // (the thumb keeps itself off the bar as the hand moves: searched each frame; a hand off the bar holds it relaxed and bent)
          else { // (a finger: from laid round the bar toward open by "open", but only as far as it stays clear of the bar — a hand
            // coming in or letting go never drags a finger through it)
            const c2 = [0, 0, 0], of = fi === 1 || fi === 2 ? Math.max(open, 0.85 * flick) : open; let sOk = 0; // (a flick: the index and middle finger lift off for the paddle)
            for (let sTry = of; sTry > 0.001; sTry -= 0.1) { for (let j = 0; j < 3; j++) c2[j] = tmp[j] + (Math.min(OPEN[fi][j], tmp[j]) - tmp[j]) * sTry; if (clearance(sd, fi, Wr, sd.Rh, bar, c2) >= 0.0003) { sOk = sTry; break; } }
            for (let j = 0; j < 3; j++) tmp[j] += (Math.min(OPEN[fi][j], tmp[j]) - tmp[j]) * sOk;
            for (let j = 0; j < 3; j++) a[j] = tmp[j]; } }
        else { const c0 = CURL[fi]; for (let j = 0; j < 3; j++) a[j] += (c0[j] * (1 - 0.7 * open) - a[j]) * k; }
        const op = !bar && (fi === 1 || fi === 2) ? 1 - 0.85 * flick : 1;
        sd.fd[fi].joints.forEach((J, j) => { J.bo.quaternion.copy(J.q0).multiply(qt.setFromAxisAngle(J.ax, (fi ? a[j] : j ? a[2] : a[0]) * op)); if (!fi && !j) J.bo.quaternion.multiply(qt2.setFromAxisAngle(J.ax2, a[1])); }); } },
  };
  return rig;
}

// the car's sound: synthesised in an audio worklet (js/carAudio.worklet.js — the engine, anti-lag, the turbo, the
// gearbox's whine, the road, the wind, the knocks); here it is told the car's state each frame, and its events
// The gear lever, the handbrake and the gravel under the tyres are recordings when they are there (Modeleaut/sounds/,
// beside the game like the car: gears.mp3 — a lever worked through its gears, its knocks cut out below; handbrake.mp3 —
// its last pull; gravel.mp3 — tyres on gravel, looped), else the worklet's own.
const CLIPS = {
  in: [[1.09, 0.32], [3.71, 0.3], [5.25, 0.3], [7.57, 0.32], [11.99, 0.36], [16.47, 0.3], [20.81, 0.32], [25.85, 0.3], [28.77, 0.32], [32.03, 0.34], [41.43, 0.3], [43.49, 0.36], [47.47, 0.3], [50.63, 0.3]], // (a gear going in)
  out: [[8.71, 0.22], [9.33, 0.18], [17.49, 0.18], [18.75, 0.2], [25.13, 0.24], [36.21, 0.22]], // (the lever leaving its slot: the quiet ones)
  hb: [[5.16, 0.9]], // (the handbrake: the pull at the end of the recording)
};
function engineSound(car) {
  let node = null, loading = false, rough = 0, hbOn = false, rec = null;
  let grv = null; // (the gravel loop: { src, gain, lp })
  const startGravel = (ctx, buf) => { // (the steady part of the recording, its end crossfaded into its start so the loop has no seam)
    const sr = buf.sampleRate, a = Math.floor(1.2 * sr), b = Math.floor(9.4 * sr), X = Math.floor(0.35 * sr), n = b - a - X, out = ctx.createBuffer(buf.numberOfChannels, n, sr);
    for (let ch = 0; ch < buf.numberOfChannels; ch++) { const src = buf.getChannelData(ch), dst = out.getChannelData(ch); let rms = 0;
      for (let i = 0; i < n; i++) { let v = src[a + i]; if (i < X) { const t = i / X; v = v * Math.sqrt(t) + src[a + n + i] * Math.sqrt(1 - t); } dst[i] = v; rms += v * v; }
      rms = Math.sqrt(rms / n); for (let i = 0; i < n; i++) dst[i] *= 0.1 / Math.max(rms, 1e-4); } // (to a set loudness)
    const src = ctx.createBufferSource(), gain = ctx.createGain(), lp = ctx.createBiquadFilter(); src.buffer = out; src.loop = true; gain.gain.value = 0; lp.type = 'lowpass'; lp.frequency.value = 8000;
    src.connect(lp).connect(gain).connect(audio.master); src.start(); grv = { src, gain, lp }; };
  const loadClips = ctx => Promise.all(['gears', 'handbrake', 'gravel'].map(f => fetch('Modeleaut/sounds/' + f + '.mp3').then(r => r.ok ? r.arrayBuffer() : Promise.reject(r.status)).then(b => ctx.decodeAudioData(b)).catch(() => null)))
    .then(([gears, hb, gravel]) => { if (gravel) startGravel(ctx, gravel); if (!gears || !hb) return; // (each knock's loudness evened out: its peak brought to one level)
      const peakOf = (buf, [t, d]) => { let p = 1e-4; const a = buf.getChannelData(0), i0 = Math.floor(t * buf.sampleRate), i1 = Math.min(a.length, i0 + Math.floor(d * buf.sampleRate)); for (let i = i0; i < i1; i++) p = Math.max(p, Math.abs(a[i])); return p; };
      rec = { gears, hb, in: CLIPS.in.map(c => [...c, 1 / peakOf(gears, c)]), out: CLIPS.out.map(c => [...c, 1 / peakOf(gears, c)]), hbc: CLIPS.hb.map(c => [...c, 1 / peakOf(hb, c)]) }; })
    .catch(() => { rec = null; });
  const play = (buf, [t, d, norm], level, rate = 1) => { const ctx = audio.ctx, src = ctx.createBufferSource(), g = ctx.createGain(), now = ctx.currentTime, L = d / rate;
    src.buffer = buf; src.playbackRate.value = rate; g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(level * norm, now + 0.004); g.gain.setValueAtTime(level * norm, now + L - 0.04); g.gain.linearRampToValueAtTime(0, now + L);
    src.connect(g).connect(audio.master); src.start(now, t, d); src.stop(now + L + 0.02); };
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const knock = (ev, on) => { if (!audio.ctx || !rec) return false; const r = 0.96 + Math.random() * 0.08, out = car.driving && car.view === 0 ? 1 : 0.6;
    if (ev === 'gear') play(rec.gears, pick(rec.in), 0.42 * out, r); else if (ev === 'lever') play(rec.gears, pick(rec.out), 0.16 * out, r); else if (ev === 'hb') { if (!on) return true; play(rec.hb, rec.hbc[0], 0.45 * out, r); } else return false;
    return true; };
  const init = () => { const ctx = audio.ctx; if (!ctx || !audio.master || loading || !ctx.audioWorklet) return; loading = true; loadClips(ctx);
    fetch('js/carAudio.worklet.js').then(r => r.text()).then(src => ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })))).then(() => { node = new AudioWorkletNode(ctx, 'rally-car', { numberOfInputs: 0, outputChannelCount: [2] }); node.connect(audio.master); })
      .catch(e => console.warn('car audio: ' + (e && e.message || e))); };
  const send = o => { if (node) node.port.postMessage(o); };
  return {
    update() { if (!node) { init(); return; }
      const st = car.st, A = car.anim, sp = st.vel.length(); let gr = 0, tm = 0, nC = 0, wsum = 0, jolt = 0;
      for (const w of car.wheels) { wsum += Math.abs(w.w); if (!w.contact) continue; nC++; if (w.surf === 'asphalt' || w.surf === 'concrete') tm++; else if (w.surf === 'gravel') gr++; jolt += Math.max(0, w.cv - 0.3); } // (stones only off the gravel road itself, not off grass)
      rough = rough * 0.9 + Math.min(1, jolt * 0.4) * 0.1;
      if (jolt > 0.9 && sp > 2) send({ ev: 'bump', k: Math.min(1.5, jolt * 0.35) });
      const hb = st.handEff > 0.5 && car.driving; if (hb !== hbOn) { hbOn = hb; if (!knock('hb', hb)) send({ ev: 'hb', on: hb }); }
      // (heard from where the camera is: in the cockpit, or outside — fading with the distance when you walk away)
      const cam = audio.lp, d = Math.hypot(cam.x - st.pos.x, cam.y - st.pos.y, cam.z - st.pos.z), cockpit = car.driving && car.view === 0;
      const slipK = clamp((st.slipMax - 0.9) / 1.5, 0, 1);
      if (grv) { const t = audio.ctx.currentTime, on = nC ? (gr / nC) : 0, v = clamp(sp / 36, 0, 1); // individual stones merge into a brighter, denser roar as wheel speed rises
        grv.gain.gain.setTargetAtTime(on * Math.pow(v, 0.72) * (0.68 + 0.72 * slipK) * (cockpit ? 0.58 : 0.84) * (car.driving ? 1 : clamp(1.4 / Math.max(1, d * 0.35), 0, 1)), t, 0.055);
        grv.src.playbackRate.setTargetAtTime(0.66 + 0.88 * v + 0.08 * slipK, t, 0.085); grv.lp.frequency.setTargetAtTime(cockpit ? 2200 + 2600 * v : 4800 + 6500 * v, t, 0.09); }
      send({ gravelRec: grv ? 1 : 0, rpm: st.rpm, thr: car.driving ? st.throttle : 0, load: car.driving ? st.throttle : 0, speed: sp, wheel: wsum / 4, slip: clamp((st.slipMax - 0.9) / 1.5, 0, 1),
        gravel: nC ? gr / nC : 0, tarmac: nC ? tm / nC : 0, rough, cut: st.shiftT > 0 || A.gMove ? 1 : 0, limiter: SPEC.engine.limiter, cockpit: cockpit ? 1 : 0, on: 1, gear: st.gear,
        vol: car.driving ? 1 : clamp(1.4 / Math.max(1, d * 0.35), 0, 1) }); },
    event(ev, k) { if (!knock(ev)) send({ ev, k }); },
    click() { if (!knock('gear')) send({ ev: 'gear' }); },
    get node() { return node; }, get clips() { return !!rec; }, get gravel() { return !!grv; },
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
