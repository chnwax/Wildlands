// Body camera and a service pistol. K puts the camera on: the view is a chest-worn camera's — a wide lens bent round
// at the edges, its colour, grain, sharpening and rolling shutter, its date and serial burnt into the corner — carried
// by the body, not the head: the torso follows where the eyes aim only when they look past a few degrees (the gun
// moves about the picture inside that), it lags and overshoots on a turn, bounces and rolls with every step, breathes.
// The pistol (assets/models/weapons/glock19.glb — "Rigged Glock" by J-Toastie, poly.pizza, CC BY 3.0; its parts split
// at the model's own bones: frame, slide, barrel, trigger, magazine, slide stop, a cartridge) is held in both hands of
// the first-person arms (car.js armsRig: the strong hand closed round the grip, the support hand round it, the trigger
// finger along the frame until the gun is up, then on the trigger). LMB fires, RMB brings the gun up to the eyes, R
// reloads (a magazine of 15 and one in the chamber), Q holsters.
// A shot: the slide cycles and throws the case out to the right, the muzzle flips and the hands bring it back down
// (not all the way: the aim climbs), the camera on the chest takes the jolt, the flash lights the frame, the camera's
// microphone clips and its automatic gain pulls everything down for a moment. Where the bullet goes is found on the
// GPU (the scene drawn once from the muzzle into a single pixel: distance, normal, which object) and on the ground's
// height field; what it meets decides what flies — dust and chips off walls, sparks off metal, splinters off wood,
// soil, leaves, a splash — and what is left: a hole, a dent, a crack.
import { THREE, scene, camera, renderer, clamp, lerp, standHeight } from './core.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { post } from './post.js';
import { audio } from './audio.js';
import { env, time } from './sky.js';
import { player, keys } from './player.js';
import { toastMsg } from './ui.js';

const V = () => new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
const GUN = 'assets/models/weapons/glock19.glb', SHOTS = 'assets/audio/weapons/revolver_shots.mp3';
const FOV = 100, LENS_K = 0.42, NEAR = 0.04; // (the camera's own lens: what is drawn, and how far the edges are bent in)
const EYE = 1.68, CHEST = 0.237, EYE_FWD = 0.09; // (the arms' chest joint below the eyes and behind them, as the car seats them)
const MOUNT = [0.15, 0.13]; // (the camera: below the chest joint and in front of it, on the sternum)
const MAG = 15;
// the gun's own frame (metres; forward −z, up +y, right +x, the origin in the grip): its grip's centre line and section,
// the bore, the sights, the ejection port, the trigger's face
const GRIP = { p: new THREE.Vector3(-0.001, -0.035, 0.012), a: new THREE.Vector3(0, 0.94, -0.342).normalize(), hw: 0.0145, hd: 0.031, r: 0.012, len: [-0.032, 0.025] };
const BORE = new THREE.Vector3(0, 0.054, -0.142), PORT = new THREE.Vector3(0.012, 0.064, -0.018), TRIG = new THREE.Vector3(0, 0.018, -0.057);

export const bodycam = { on: false, want: null, ready: false, loading: null, drawn: true, onChange: null };
const st = { // the body and the gun
  by: 0, bp: 0, byV: 0, bpV: 0, aim: 0, aimT: 0, sprint: 0, draw: 1, drawT: 1, mag: MAG, chamber: true, sT: 1, lock: false, trig: 0, cool: 0,
  rec: { p: 0, pv: 0, r: 0, rv: 0, y: 0, yv: 0 }, shake: 0, camKick: V(), reload: -1, empty: false, nextMag: null, t: 0, flash: 0, dist: 20,
  roll: 0, lastYaw: 0, yawRate: 0, raise: 0, prevPhase: 0, land: 0, fireHeld: false, fireQ: 0, finger: 0,
};
let gun = null, parts = {}, rigRoot = null, arms = null, rig = null, pass = null, hud = null, fx = null, snd = null, saved = null;
export const dbg = { st, get THUMB_PT() { return THUMB_PT; }, get THUMB_L() { return THUMB_L; }, setF: (s, f, a) => setF(s, f, a), get GS() { return GS; }, get GRIP_SET() { return GRIP_SET; }, get SK() { return SK; }, get caps() { return caps; }, solveGrip: () => solveGrip(), get rig() { return rig; }, get gun() { return gun; }, get rigRoot() { return rigRoot; }, sd: (q, pad = 0) => gripSD(q, pad), gsd: q => gunSD(q), gsdg: p => gunSDg(p), csd: p => caps ? capSD(p) : Infinity, GRIP, TRIG }; // (console and tests)

// ---------------------------------------------------------------- loading
async function load() {
  const g = await new GLTFLoader().loadAsync(GUN);
  gun = new THREE.Group(); gun.name = 'pistol';
  const root = g.scene.getObjectByName('glock19') || g.scene;
  for (const c of [...root.children]) { parts[c.name] = c; gun.add(c); }
  gun.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; o.frustumCulled = false; o.userData.noPick = true; } });
  for (const k in parts) parts[k].userData.p0 = parts[k].position.clone();
  // (the cartridge's case on its own, its middle at its origin: what the slide throws out)
  const round = parts.round; round.visible = false; const caseGeo = [];
  round.traverse(o => { if (o.isMesh && /Casing/.test(o.material.name)) caseGeo.push(o); });
  rigRoot = new THREE.Group(); rigRoot.name = 'bodycam rig'; rigRoot.userData.dynamic = true; scene.add(rigRoot);
  rigRoot.add(gun);
  try { // the arms: the car's driver, posed by its own rig (Modeleaut/, beside the game; without them the gun floats)
    const car = await import('./car.js'), a = await car.parseArms();
    if (a) { car.suitUp(a.scene); arms = a.scene; rig = car.armsRig(arms, rigRoot, new THREE.Vector3(), 0.0118);
      if (rig) { arms.traverse(o => { o.userData.noPick = true; if (o.isMesh) o.castShadow = false; }); solveGrip(); } }
  } catch (e) { console.warn('bodycam arms: ' + (e && e.message || e)); }
  fx = effects(caseGeo);
  snd = sounds();
  pass = new ShaderPass(LensShader); pass.enabled = false;
  const addPass = () => { if (post.composer && !post.composer.passes.includes(pass)) post.composer.addPass(pass); }; addPass(); post.onRebuild.push(addPass);
  hud = document.createElement('div'); hud.id = 'bodycamHud';
  hud.style.cssText = 'position:fixed;top:2.2vh;right:2.4vw;z-index:12;pointer-events:none;font:700 2.1vh/1.25 "Arial Narrow",Arial,sans-serif;color:#f4f4f0;text-align:right;letter-spacing:.04em;text-shadow:0 0 2px #000,1px 1px 1px #000;display:none;white-space:pre';
  document.body.appendChild(hud);
  if (bodycam.world) shoot(camera.position.clone(), new THREE.Vector3(0, -0.2, -1).normalize()); // (the bullet's pass compiled now, not on the first shot)
  const css = document.createElement('style'); css.textContent = '.bodycam #hud .clock, .bodycam #hud #mode { display: none } .bodycam #hud { top: 9vh }'; document.head.appendChild(css);
  bodycam.ready = true;
}

// ---------------------------------------------------------------- on / off
// (the choice is remembered on this computer: the settings' Camera switch and K both set it; onChange keeps the switch in step)
const KEY = 'wl_bodycam';
export const remembered = () => { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } };
// (what was asked for last wins: a second press while the models are still loading is not lost or doubled)
export const toggle = () => setOn(!(bodycam.want ?? bodycam.on));
export async function setOn(v) {
  bodycam.want = !!v;
  if (!bodycam.ready) { if (!bodycam.want) return; if (!bodycam.loading) bodycam.loading = load().catch(e => { console.error(e); toastMsg('Bodycam: ' + e.message); bodycam.loading = null; throw e; }); toastMsg('Bodycam…'); await bodycam.loading; }
  if (bodycam.want === bodycam.on) return;
  bodycam.on = bodycam.want;
  if (bodycam.on) {
    saved = { fov: camera.fov, near: camera.near };
    camera.fov = FOV; camera.near = NEAR; camera.updateProjectionMatrix();
    st.by = player.yaw; st.bp = player.pitch * 0.6; st.byV = st.bpV = 0; st.lastYaw = player.yaw; st.draw = 0; st.drawT = 1; bodycam.drawn = true;
    try { audio.init(); } catch (e) { console.warn('bodycam audio: ' + e.message); } if (audio.micHP && audio.ctx) { const t = audio.ctx.currentTime; audio.micHP.frequency.setTargetAtTime(150, t, 0.05); audio.micLP.frequency.setTargetAtTime(9500, t, 0.05); }
  } else {
    camera.fov = saved ? saved.fov : 72; camera.near = saved ? saved.near : 0.2; camera.updateProjectionMatrix();
    if (audio.micHP && audio.ctx) { const t = audio.ctx.currentTime; audio.micHP.frequency.setTargetAtTime(10, t, 0.05); audio.micLP.frequency.setTargetAtTime(Math.min(22000, audio.ctx.sampleRate * 0.45), t, 0.05); }
  }
  pass.enabled = bodycam.on; hud.style.display = bodycam.on ? '' : 'none'; rigRoot.visible = bodycam.on;
  try { localStorage.setItem(KEY, bodycam.on ? '1' : '0'); } catch (e) {}
  if (bodycam.onChange) bodycam.onChange(bodycam.on);
  if (post.taa) post.taa.reset = true;
  toastMsg(bodycam.on ? 'Bodycam — LMB fire · RMB aim · R reload · Q holster' : 'Bodycam off');
}
export const active = () => bodycam.on && bodycam.ready && !player.fly;

// ---------------------------------------------------------------- input (main.js passes it on while the camera is on)
export function input(e, down) {
  if (!active()) return false;
  if (e.type === 'mousedown' || e.type === 'mouseup') {
    if (e.button === 0) { st.fireHeld = down; if (down) { st.fireQ = st.aim > 0.8 ? 0.12 : 0.45; st.raise = 1.2; } return true; }
    if (e.button === 2) { st.aimT = down ? 1 : 0; return true; }
    return false;
  }
  if (!down) return false;
  if (e.code === 'KeyR') { startReload(); return true; }
  if (e.code === 'KeyQ') { bodycam.drawn = !bodycam.drawn; st.drawT = bodycam.drawn ? 1 : 0; snd.holster(bodycam.drawn); return true; }
  return false;
}
function startReload() {
  if (st.reload >= 0 || !bodycam.drawn || st.mag >= MAG) return;
  st.reload = 0; st.empty = !st.chamber; st.dropped = false; st.inserted = false; st.released = false;
}

// ---------------------------------------------------------------- the frame: body, gun, hands, camera
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion(), rigInv = new THREE.Matrix4(), rigQi = new THREE.Quaternion();
const F = V(), L = V(), U = V(), aimD = V(), eye = V(), chest = V(), gw = V(), gF = V(), gU = V(), gR = V(), lowF = V(), a1 = V(), a2 = V(), a3 = V();
const gunQw = new THREE.Quaternion(), gunPw = V(), gunMl = new THREE.Matrix4(), gunMli = new THREE.Matrix4();
const n1 = (t, s) => { const i = Math.floor(t), f = t - i, h = k => { const x = Math.sin((k + s * 57.3) * 127.1) * 43758.5453; return x - Math.floor(x); }; const u = f * f * (3 - 2 * f); return (h(i) * (1 - u) + h(i + 1) * u) * 2 - 1; };
const spring = (o, k, v, x, target, w, z, dt) => { const a = w * w * (target - o[x]) - 2 * z * w * o[v]; o[v] += a * dt; o[x] += o[v] * dt; };

export function frame(world, dt) {
  if (!active()) return false;
  st.used = true; st.t += dt; st.dt = dt;
  if (camera.fov !== FOV || camera.near !== NEAR) { camera.fov = FOV; camera.near = NEAR; camera.updateProjectionMatrix(); } // (put back after the car's cameras or the walker's)
  const p = player.pos, crouch = player.crouch, sprinting = (keys.ShiftLeft || keys.ShiftRight) && player.speed > 5 && st.aimT < 0.5;
  st.sprint = lerp(st.sprint, sprinting ? 1 : 0, 1 - Math.exp(-dt * 6));
  st.raise -= dt; const up = Math.max(st.aimT, st.raise > 0 ? 1 : 0); // (a shot from the low ready brings the gun up first, and it stays up a moment)
  st.aim = lerp(st.aim, up * (1 - st.sprint) * (st.reload >= 0 ? 0.3 : 1), 1 - Math.exp(-dt * (up ? 11 : 7)));
  st.draw = lerp(st.draw, st.drawT, 1 - Math.exp(-dt * 7));
  // ---- the torso follows the aim: inside a few degrees the eyes (and the gun) move alone, past them the body turns —
  // a spring, so a quick turn overshoots a little and settles
  const dz = lerp(0.035, 0.1, st.aim), dzp = lerp(0.03, 0.07, st.aim);
  let dy = player.yaw - st.by; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  const yawGoal = st.by + (Math.abs(dy) > dz ? dy - Math.sign(dy) * dz : 0) + dy * (st.aim > 0.5 ? 0.02 : 0.25) * 0.5;
  spring(st, 0, 'byV', 'by', yawGoal, 14, 0.62, dt);
  let dp = player.pitch * 0.72 - st.bp; const pGoal = st.bp + (Math.abs(dp) > dzp ? dp - Math.sign(dp) * dzp : 0) + dp * 0.1;
  spring(st, 0, 'bpV', 'bp', pGoal, 11, 0.7, dt);
  st.yawRate = lerp(st.yawRate, st.byV, 1 - Math.exp(-dt * 20));
  // ---- the step: the camera rides the chest — a bounce at every footfall, a sway from foot to foot, a roll, more when
  // running; a landing drops it; breathing and the body's own small unrest under it all
  const hs = player.speed, walk = clamp(hs / 4.1, 0, 1), run = clamp((hs - 4.5) / 3.5, 0, 1), ph = player.stepPhase;
  const bounce = (Math.pow(Math.abs(Math.sin(ph)), 0.75) - 0.6) * (0.03 * walk + 0.045 * run) * (player.onGround ? 1 : 0.2);
  const sway = Math.sin(ph) * (0.018 * walk + 0.02 * run), surge = Math.sin(ph * 2 + 0.6) * 0.012 * (walk + run);
  if (player.land > st.land + 0.02) st.camKick.y -= player.land * 1.2; st.land = player.land;
  const breath = Math.sin(st.t * 1.6) * (1 + 1.5 * run), un = st.t * 0.55;
  // ---- the body frame (the arms' parent): the chest joint, turned with the torso, leaning a little into the aim
  const lean = st.bp * 0.45 - st.sprint * 0.12 + 0.015 * breath * 0.2;
  F.set(-Math.sin(st.by) * Math.cos(lean), Math.sin(lean), -Math.cos(st.by) * Math.cos(lean));
  L.set(-Math.cos(st.by), 0, Math.sin(st.by)); U.crossVectors(F, L);
  const rollStep = Math.cos(ph) * 0.02 * (walk + run) - clamp(st.yawRate, -4, 4) * 0.012;
  st.roll = lerp(st.roll, rollStep, 1 - Math.exp(-dt * 8));
  chest.set(p.x, p.y + EYE - CHEST - crouch * 0.6 + bounce + 0.003 * breath, p.z).addScaledVector(L, sway).addScaledVector(F, surge * 0.5);
  rigRoot.position.copy(chest);
  tmpM.makeBasis(L.clone().applyAxisAngle(F, st.roll), U.clone().applyAxisAngle(F, st.roll), F); rigRoot.quaternion.setFromRotationMatrix(tmpM);
  rigRoot.updateMatrixWorld(true); rigInv.copy(rigRoot.matrixWorld).invert(); rigQi.copy(rigRoot.quaternion).invert();
  // ---- the gun: up at the eyes (the sights on the line of sight), at the chest pointing where the eyes look, or low
  // and in while running; the hands' unrest, the step, the recoil on top
  eye.copy(chest).addScaledVector(U, CHEST).addScaledVector(F, EYE_FWD);
  aimD.set(-Math.sin(player.yaw) * Math.cos(player.pitch), Math.sin(player.pitch), -Math.cos(player.yaw) * Math.cos(player.pitch));
  st.dist = lerp(st.dist, aimDistance(world, eye, aimD), 0.2);
  const tgt = a1.copy(eye).addScaledVector(aimD, st.dist), sw = 1 + 2 * walk + 3 * run;
  const swayY = n1(un, 1) * 0.006 * sw + Math.sin(ph) * 0.004 * (walk + run), swayX = n1(un, 2) * 0.006 * sw + Math.cos(ph) * 0.005 * (walk + run);
  // (aimed: out at arm's length, low enough for the chest camera to see past the arms; ready — the low ready: arms down
  // and forward, nearly straight, the muzzle toward the ground a few metres ahead; low: down and in)
  const P_aim = a2.copy(eye).addScaledVector(aimD, 0.5).addScaledVector(U, -0.14), P_rdy = a3.copy(chest).addScaledVector(F, 0.56).addScaledVector(U, -0.44).addScaledVector(L, -0.02);
  gunPw.copy(P_rdy).lerp(P_aim, st.aim);
  const low = st.sprint + (1 - st.draw);
  gunPw.addScaledVector(U, -0.17 * low).addScaledVector(F, -0.1 * low).addScaledVector(L, 0.04 * low);
  gunPw.addScaledVector(U, swayY + st.rec.p * 0.3).addScaledVector(L, swayX);
  gF.subVectors(tgt, gunPw).normalize(); lowF.set(aimD.x, 0, aimD.z).normalize().applyAxisAngle(a3.crossVectors(lowF, UP).normalize(), -0.75); gF.lerp(lowF, 1 - st.aim).normalize();
  lowF.copy(F).addScaledVector(U, -1.1).normalize(); gF.lerp(lowF, clamp(low, 0, 1)).normalize();
  gF.applyAxisAngle(L, -(swayY * 0.6)).applyAxisAngle(U, swayX * 0.6);
  // (the recoil: the muzzle up about the wrists, the gun back toward the chest, a little to one side)
  gR.crossVectors(gF, UP).normalize(); gF.applyAxisAngle(gR, st.rec.r).applyAxisAngle(U, st.rec.y); gR.crossVectors(gF, UP).normalize(); gU.crossVectors(gR, gF);
  if (st.reload >= 0) { const rk = reloadTilt(); gF.applyAxisAngle(gR, rk.pitch); gU.applyAxisAngle(gF, rk.roll); gR.crossVectors(gF, gU); gunPw.addScaledVector(U, rk.up).addScaledVector(F, -rk.back); }
  else { gU.applyAxisAngle(gF, -0.06 * st.aim); gR.crossVectors(gF, gU); } // (a slight cant, as most people hold one)
  gunPw.addScaledVector(gF, -st.rec.p);
  tmpM.makeBasis(gR, gU, a2.copy(gF).negate()); gunQw.setFromRotationMatrix(tmpM);
  gun.position.copy(gunPw).applyMatrix4(rigInv); gun.quaternion.copy(rigQi).multiply(gunQw); gun.updateMatrix();
  gunMl.copy(gun.matrix); gunMli.copy(gunMl).invert();
  rigRoot.visible = st.draw > 0.03;
  if (rig) keepInReach();
  animateParts(dt);
  if (rig && rigRoot.visible) hands(dt);
  gun.updateMatrixWorld(true);
  // ---- the camera: on the sternum, the chest's turn and lean, the step's roll, the jolt of each shot
  const cp = camera.position.copy(chest).addScaledVector(U, -MOUNT[0]).addScaledVector(F, MOUNT[1]);
  st.camKick.multiplyScalar(Math.exp(-dt * 9));
  cp.addScaledVector(U, st.camKick.y * 0.03).addScaledVector(L, st.camKick.x * 0.02);
  st.shake *= Math.exp(-dt * 11);
  const sk = st.shake, shk = (s) => n1(st.t * 38, s) * sk;
  const yawC = st.by + n1(un * 1.3, 3) * 0.003 + shk(4) * 0.012 + st.camKick.x * 0.01;
  const pitC = st.bp * 0.82 - 0.05 + lean * 0.3 + breath * 0.0018 + n1(un * 1.1, 5) * 0.003 + shk(6) * 0.014 + st.camKick.y * 0.02 - Math.abs(Math.sin(ph)) * 0.008 * (walk + run);
  camera.rotation.set(pitC, yawC, -st.roll * 1.3 + shk(7) * 0.01, 'YXZ');
  const g = world.groundAt(cp.x, cp.z); if (cp.y < g + 0.25) cp.y = g + 0.25;
  // ---- the lens pass and the corner's date
  if (pass) { const u = pass.uniforms; u.uTime.value = st.t; u.uRoll.value = clamp(st.yawRate * 0.0045, -0.03, 0.03) + shk(8) * 0.002;
    u.uNight.value = env.night; u.uFlash.value = st.flash; st.flash *= Math.exp(-dt * 40);
    u.uAspect.value = innerWidth / innerHeight; u.uRes.value.set(innerWidth * renderer.getPixelRatio(), innerHeight * renderer.getPixelRatio()); }
  if (hud && (st.hudT = (st.hudT || 0) - dt) < 0) { st.hudT = 0.25; hud.textContent = stamp(); }
  return true;
}
// the date and time as the camera prints it (the game's clock, today's date) and the unit's serial
function stamp() {
  const d = new Date(), h = time.hour, hh = Math.floor(h), mm = Math.floor((h - hh) * 60), ss = Math.floor(((h - hh) * 60 - mm) * 60), z = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} T${z(hh)}:${z(mm)}:${z(ss)}+09:00\nSAKURAGAWA PD  BWC-3  X61A9F2C7`;
}
// how far along the line of sight the ready gun points: the ground's height field (cheap, every frame), else 25 m
function aimDistance(world, o, d) {
  let t = 1;
  for (let i = 0; i < 40 && t < 25; i++) { const x = o.x + d.x * t, z = o.z + d.z * t, y = o.y + d.y * t; if (y < world.groundAt(x, z)) return Math.max(2, t); t += 0.3 + t * 0.08; }
  return 25;
}

// ---------------------------------------------------------------- the gun's moving parts
function animateParts(dt) {
  // the slide: back fast, home on its spring; held back by the slide stop when the magazine is empty
  st.sT += dt; // (back in 20 ms, home in 55 ms; held back when the last round has gone)
  const sl = st.sT < 0.02 ? st.sT / 0.02 : st.lock ? 1 : st.sT < 0.075 ? 1 - (st.sT - 0.02) / 0.055 : 0;
  if (parts.slide) parts.slide.position.z = parts.slide.userData.p0.z + 0.026 * sl;
  if (parts.barrel) { parts.barrel.position.z = parts.barrel.userData.p0.z + 0.004 * Math.min(1, sl * 4); parts.barrel.rotation.x = -0.05 * clamp((sl - 0.15) * 3, 0, 1); }
  if (parts.slidecatch) parts.slidecatch.rotation.x = st.lock ? 0.16 : 0;
  st.trig = lerp(st.trig, st.trigT || 0, 1 - Math.exp(-dt * 30));
  if (parts.trigger) parts.trigger.rotation.x = 0.28 * st.trig;
  // recoil springs: the muzzle's climb and the gun's push back, underdamped as wrists are
  const R = st.rec; spring(R, 0, 'rv', 'r', 0, 26, 0.55, dt); spring(R, 0, 'pv', 'p', 0, 30, 0.6, dt); spring(R, 0, 'yv', 'y', 0, 24, 0.6, dt);
  // the trigger: pressed while held, a shot when it breaks; the slide must be home, the chamber full
  st.cool -= dt; st.fireQ -= dt;
  const can = bodycam.drawn && st.draw > 0.8 && st.reload < 0 && st.sprint < 0.4 && st.aim > 0.8; // (fired only once the gun is up)
  if (st.fireQ > 0 && can && st.cool <= 0) { st.fireQ = 0;
    if (st.chamber && !st.lock) fire(); else { snd.click(); st.cool = 0.25; st.trigT = 1; setTimeout(() => { st.trigT = 0; }, 90); } }
  if (!st.fireHeld && st.trigT && st.cool < 0.05) st.trigT = 0;
  if (st.reload >= 0) reloadStep(dt);
  if (parts.magazine) { const m = parts.magazine, out = st.reload >= 0 ? magOut() : 0; m.visible = out < 0.99 || st.inserting; m.position.copy(m.userData.p0).addScaledVector(GRIP.a, -out * 0.13); }
}

// ---------------------------------------------------------------- a shot
const _o = V(), _d = V(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
function fire() {
  st.cool = 0.11; st.trigT = 1; st.sT = 0; st.chamber = st.mag > 0; if (st.chamber) st.mag--; else st.lock = true;
  gun.updateMatrixWorld(true);
  const mw = gun.matrixWorld, muzzle = _o.copy(BORE).applyMatrix4(mw);
  _d.set(0, 0, -1).transformDirection(mw);
  // (where it goes: the barrel's way, a little cone — wider from the ready position and on the move)
  const spread = lerp(0.012, 0.0012, st.aim) + clamp(player.speed / 8, 0, 1) * 0.008;
  const r1 = Math.random() * Math.PI * 2, r2 = Math.sqrt(Math.random()) * spread; _q.setFromAxisAngle(a1.set(Math.cos(r1), Math.sin(r1), 0).transformDirection(mw), r2); _d.applyQuaternion(_q);
  // recoil: muzzle flip, the push back, the hands' recovery leaving the aim a little higher, the chest camera's jolt
  const k = lerp(1.25, 1, st.aim);
  st.rec.rv += (4.2 + Math.random() * 1.6) * k; st.rec.pv += 1.5 * k; st.rec.yv += (Math.random() - 0.5) * 2;
  player.pitch = clamp(player.pitch + (0.008 + Math.random() * 0.006) * k, -1.5, 1.5); player.yaw += (Math.random() - 0.45) * 0.006 * k;
  st.shake = Math.min(1.6, st.shake + 0.9); st.camKick.y += 0.25; st.camKick.x += (Math.random() - 0.5) * 0.4; st.flash = 1;
  const hit = st.lastHit = shoot(muzzle, _d);
  if (hit) fx.impact(hit, _d);
  fx.muzzle(muzzle, _d, mw);
  setTimeout(() => { gun.updateMatrixWorld(true); fx.eject(gun.matrixWorld); }, 18);
  snd.shot(muzzle);
}

// ---------------------------------------------------------------- reload
// (seconds: the support hand leaves, the magazine drops, a fresh one comes up from the belt and goes in, the slide is
// released if it was locked back, the hand returns)
const RT = { drop: 0.3, belt: 0.55, mag: 1.05, seat: 1.3, rel: 1.55, end: 1.95 };
function reloadStep(dt) {
  st.reload += dt; const t = st.reload;
  if (t > RT.drop && !st.dropped) { st.dropped = true; snd.mag(false); gun.updateMatrixWorld(true); fx.dropMag(parts.magazine, gun.matrixWorld); }
  st.inserting = t > RT.mag - 0.25 && t < RT.seat;
  if (t > RT.seat && !st.inserted) { st.inserted = true; st.mag = MAG; snd.mag(true); }
  const end = st.empty ? RT.end : RT.rel + 0.2;
  if (st.empty && t > RT.rel && !st.released) { st.released = true; st.lock = false; st.sT = 0.02; st.chamber = true; st.mag--; snd.slide(); }
  if (t > end) { st.reload = -1; st.inserting = false; }
}
function magOut() { const t = st.reload; return t < RT.drop ? 0 : t < RT.mag - 0.25 ? 1 : t < RT.seat ? 1 - (t - (RT.mag - 0.25)) / (RT.seat - RT.mag + 0.25) : 0; }
function reloadTilt() { const t = st.reload, e = Math.min(1, t / 0.25) * Math.min(1, Math.max(0, (st.empty ? RT.end : RT.rel + 0.2) - t) / 0.3);
  return { pitch: 0.28 * e, roll: 0.42 * e, up: 0.05 * e, back: 0.08 * e }; }

// ---------------------------------------------------------------- the hands on the gun
// The gun's shape as a distance (metres, in its own frame): the grip — its true section, a rounded rectangle — and the
// rest as boxes measured off the model's side view (the slide, the frame over the grip, the dust cover ahead of the
// trigger guard, the guard's bottom and front; the trigger's opening left free)
const gq = V(), gq2 = V();
const GB = new THREE.Vector3().crossVectors(GRIP.a, new THREE.Vector3(1, 0, 0)).normalize(); // (the section's front-to-back axis)
const gripSDg = (p, pad = 0) => { gq.copy(p).sub(GRIP.p); const s = gq.dot(GRIP.a), al = Math.max(0, GRIP.len[0] - s, s - GRIP.len[1]);
  gq.addScaledVector(GRIP.a, -s); const ox = Math.abs(gq.x) - (GRIP.hw - GRIP.r), oz = Math.abs(gq.dot(GB)) - (GRIP.hd - GRIP.r);
  const sec = Math.hypot(Math.max(ox, 0), Math.max(oz, 0)) + Math.min(Math.max(ox, oz), 0) - GRIP.r - pad; // (signed, in the section's plane)
  return al > 0 ? Math.hypot(Math.max(sec, 0), al) : sec; };
const BOXES = [[-0.0024, 0.0516, -0.0537, 0.013, 0.0191, 0.0875], [-0.0011, 0.014, 0.0085, 0.01395, 0.02, 0.0335], [-0.002, 0.032, -0.07, 0.0148, 0.008, 0.045],
  [-0.002, -0.0005, -0.054, 0.0105, 0.0045, 0.032], [-0.002, 0.0105, -0.08, 0.0105, 0.0155, 0.007]];
const gunSDg = p => { let d = gripSDg(p);
  for (const b of BOXES) { const ox = Math.abs(p.x - b[0]) - b[3], oy = Math.abs(p.y - b[1]) - b[4], oz = Math.abs(p.z - b[2]) - b[5];
    d = Math.min(d, Math.hypot(Math.max(ox, 0), Math.max(oy, 0), Math.max(oz, 0)) + Math.min(Math.max(ox, oy, oz), 0)); }
  return d; };
const gunSD = q => gunSDg(gq2.copy(q).applyMatrix4(gunMli)), gripSD = (q, pad) => gripSDg(gq2.copy(q).applyMatrix4(gunMli), pad); // (from the body frame)

// The grip, as a police officer holds a pistol — both hands, thumbs forward — worked out once in the gun's own frame
// when the camera is first put on (solveGrip) and then held as it is: nothing in the hands is searched frame by frame,
// so nothing in them can jump; each frame only the arms bend to bring the wrists to where the gun is.
//  - The strong hand: placed by its own landmarks — the wrist and the four knuckles fitted (rigidly, least squares) to
//    where they sit on a held pistol: the index knuckle beside the frame just over the trigger guard, the others down
//    the grip's right side behind the front strap, the wrist behind and below in line with the bore; then moved
//    sideways until the palm's own skin lies on the grip (measured on the skinned mesh; the web of the hand takes the
//    backstrap into it); the middle, ring and little finger wrapped round the front strap, each pad sent to the grip's
//    left side at its knuckle's height with every vertex of its skin kept out of the gun; the index worked out for three places (along
//    the frame above the trigger guard, on the trigger's face, the trigger pressed); the thumb forward along the
//    frame's left side under the slide.
//  - The support hand the same against the gun and the strong hand (its bones as capsules, each as thick as its own
//    skin): its knuckles down the front of the grip's left side on a slant, the wrist behind, below and out to the left,
//    the heel of the palm on the left panel, the fingers over the strong hand's under the trigger guard, the thumb
//    forward under the strong thumb.
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
const GRIP_SET = { // (landmarks in the gun's frame: wrist; index, middle, ring and little finger knuckles; the thumb's knuckle — and the way the palm is pressed on)
  R: { at: [v3(0.022, -0.048, 0.112), v3(0.03, 0.006, -0.004), v3(0.033, -0.013, 0.002), v3(0.034, -0.032, 0.008), v3(0.032, -0.049, 0.014), v3(-0.016, 0.022, 0.052)], seat: v3(-1, 0, -0.3) },
  L: { at: [v3(-0.06, -0.075, 0.07), v3(-0.035, -0.012, -0.032), v3(-0.038, -0.03, -0.022), v3(-0.038, -0.046, -0.01), v3(-0.035, -0.06, 0.002), v3(-0.036, -0.004, 0.028)], seat: v3(1, 0, 0) } };
const FRAME_PT = new THREE.Vector3(0.021, 0.027, -0.068), THUMB_PT = new THREE.Vector3(-0.027, 0.024, 0.012), THUMB_L = new THREE.Vector3(-0.027, 0.004, -0.042);
const PALM_GAP = 0.0004; // (the palm's skin just on the grip)
const GS = { R: null, L: null }, SK = { R: null, L: null }, gunWi = new THREE.Matrix4(); let skin = null, caps = null;
const sv = V(), _qq = new THREE.Quaternion(), _qq2 = new THREE.Quaternion();
const skinG = (i, out) => skin.getVertexPosition(i, out).applyMatrix4(skin.matrixWorld).applyMatrix4(gunWi); // (a vertex where it is now, in the gun's frame)
const minSD = (list, sdf) => { let m = Infinity; for (const i of list) { const d = sdf(skinG(i, sv)); if (d < m) m = d; } return m; };
// (each hand's vertices by the bone that carries them most: the palm and wrist, each finger's three bones)
function indexSkin() {
  arms.traverse(o => { if (o.isSkinnedMesh) skin = o; });
  const si = skin.geometry.attributes.skinIndex, sw = skin.geometry.attributes.skinWeight, bones = skin.skeleton.bones, F = ['thumb', 'point', 'middle', 'ring', 'pink'];
  for (const s of ['R', 'L']) SK[s] = { palm: [], seat: [], seg: F.map(() => [[], [], []]), all: [] };
  for (let i = 0; i < si.count; i++) { let bi = 0, bw = -1; for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; bi = si.getComponent(i, k); } }
    const m = /^(L|R)_(wrist|palm|thumb|point|middle|ring|pink)(\d)?/.exec(bones[bi].name); if (!m) continue; const S = SK[m[1]]; S.all.push(i);
    if (m[2] === 'wrist' || m[2] === 'palm') S.palm.push(i); else S.seg[F.indexOf(m[2])][Math.min(+m[3] - 1, 2)].push(i);
    if (bw > 0.55 && (m[2] === 'wrist' || m[2] === 'palm')) S.seat.push(i); } // (what the palm is seated by: the hand's own skin, not the cuff the forearm also moves)
}
// a finger's bends set (the thumb's: base flexion, swing, outer joints — as the rig keeps them)
const setF = (side, fi, a) => { const D = rig.S[side].fd[fi];
  D.joints.forEach((J, j) => { J.bo.quaternion.copy(J.q0); if (!j && J.abd && a.length > 3) J.bo.quaternion.multiply(_qq2.setFromAxisAngle(J.abd, a[3])); // (a fourth bend: the knuckle's sideways swing)
    J.bo.quaternion.multiply(_qq.setFromAxisAngle(J.ax, fi ? a[j] : (j ? a[2] : a[0]))); if (!fi && !j) J.bo.quaternion.multiply(_qq2.setFromAxisAngle(J.ax2, a[1])); });
  const g = rig.S[side].ang[fi]; g[0] = a[0]; g[1] = a[1]; g[2] = a[2]; };
// the rigid motion (Horn's quaternion method) that best brings points src onto dst: q·src + t ≈ dst
function fitRigid(src, dst) {
  const n = src.length, cs = V(), cd = V(); src.forEach(p => cs.add(p)); dst.forEach(p => cd.add(p)); cs.divideScalar(n); cd.divideScalar(n);
  const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], a = V(), b = V();
  for (let i = 0; i < n; i++) { a.subVectors(src[i], cs); b.subVectors(dst[i], cd); const A = [a.x, a.y, a.z], B = [b.x, b.y, b.z]; for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) S[r][c] += A[r] * B[c]; }
  const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = S;
  const N = [[xx + yy + zz, yz - zy, zx - xz, xy - yx], [yz - zy, xx - yy - zz, xy + yx, zx + xz], [zx - xz, xy + yx, -xx + yy - zz, yz + zy], [xy - yx, zx + xz, yz + zy, -xx - yy + zz]];
  const k = N.flat().reduce((m, x) => m + Math.abs(x), 0) + 1e-9; let e = [1, 0, 0, 0]; // (the largest eigenvector, by power iteration on N + kI)
  for (let it = 0; it < 200; it++) { const f = N.map((row, r) => row.reduce((m, x, c) => m + x * e[c], 0) + k * e[r]); const l = Math.hypot(...f); e = f.map(x => x / l); }
  const q = new THREE.Quaternion(e[1], e[2], e[3], e[0]).normalize(); return { q, t: cd.clone().sub(cs.clone().applyQuaternion(q)) };
}
// the hand placed by its landmarks: the wrist's turn and place (gun frame) that best put its wrist and knuckles on at[]
function placeByLandmarks(side, at) {
  const sd = rig.S[side], gq0 = gun.getWorldQuaternion(new THREE.Quaternion()).invert(), wq = gq0.clone().multiply(sd.wr.getWorldQuaternion(new THREE.Quaternion())), wqi = wq.clone().invert();
  const P = o => o.getWorldPosition(V()).applyMatrix4(gunWi), w0 = P(sd.wr);
  const src = [sd.wr, sd.fing[1][0], sd.fing[2][0], sd.fing[3][0], sd.fing[4][0], sd.fing[0][1]].map(o => P(o).sub(w0).applyQuaternion(wqi)); // (in the wrist's own frame: rigid, the thumb in its working-out pose)
  const { q, t } = fitRigid(src, at);
  return { W: t, H: q.clone().multiply(sd.Qw0.clone().invert()), fit: Math.sqrt(src.reduce((m, p, i) => m + p.clone().applyQuaternion(q).add(t).distanceToSquared(at[i]), 0) / src.length) };
}
// the arm brought to a wrist pose given in the gun's frame
const hw = V(), hq = new THREE.Quaternion();
const poseHand = (side, Wg, Hg, open, dt) => { const sd = rig.S[side]; hw.copy(Wg).applyMatrix4(gunMl); hq.copy(gun.quaternion).multiply(Hg).multiply(sd.Qw0); rig.solve(side, hw, hq, open, side === 'R' ? poleR : poleL, 0, null, dt); };
const capSD = p => { let d = Infinity; for (const c of caps) { gq.subVectors(p, c.a); const t = clamp(gq.dot(c.ab) / c.l2, 0, 1); d = Math.min(d, gq.addScaledVector(c.ab, -t).length() - c.r); } return d; };
const bothSD = p => Math.min(gunSDg(p), capSD(p));
// a finger wrapped round the grip: its pad sent to the grip's far side at the height of its own knuckle (x: that
// side's offset from the middle, dz: ahead of the grip's centre line there), its skin kept out of what it holds
function wrapFinger(side, fi, sdf, x, dz) {
  const P = rig.S[side].fd[fi].joints[0].bo.getWorldPosition(V()).applyMatrix4(gunWi), y = P.y - 0.004, s = (y - GRIP.p.y) / GRIP.a.y;
  const tgt = v3(x, y, GRIP.p.z + GRIP.a.z * s + dz);
  const zc = GRIP.p.z + GRIP.a.z * s;
  return fingerTo(side, fi, tgt, [[0.4, 0.8, 0.5], [0.7, 1.2, 0.6], [0.2, 0.6, 0.3], [0.9, 1.4, 0.9]], sdf, p => Math.max(0, p.z - zc) * 2).a;
}
// a finger or a thumb bent (searched from seeds) so its tip lies on a mark, every joint, every bone's middle and the tip
// kept a finger's thickness off the gun (and off obs, for the support hand)
const _tip = V(), _j = V();
function fingerTo(side, fi, target, seeds, obs = gunSDg, tipCost = null) {
  const D = rig.S[side].fd[fi], thumb = !fi, tip = D.joints[2].bo.children[0] || D.joints[2].bo, a = seeds[0].slice();
  const lim = thumb ? [[-0.6, 1.3], [-0.9, 1.3], [-0.3, 1.2]] : [[-0.45, 1.2], [-0.1, 1.7], [-0.15, 1.3], [-0.35, 0.35]], nd = Math.min(seeds[0].length, lim.length);
  const verts = SK[side].seg[fi].flat().filter((_, k) => k % 2 === 0); // (its own skin, every other vertex)
  const cost = () => { setF(side, fi, a); D.joints[0].bo.updateMatrixWorld(true);
    let c = tip.getWorldPosition(_tip).applyMatrix4(gunWi).distanceToSquared(target); if (tipCost) c += tipCost(_tip) ** 2;
    for (const i of verts) { const pen = 0.0003 - obs(skinG(i, sv)); if (pen > 0) c += pen * pen * 4000; }
    return c + 0.00005 * (a[1] * a[1] + a[2] * a[2]); };
  let best = Infinity, keep = a.slice();
  for (const s0 of seeds) { for (let j = 0; j < nd; j++) a[j] = s0[j];
    let c = cost(); for (const step of [0.12, 0.05, 0.02, 0.008]) for (let it = 0; it < 6; it++) { let moved = false;
      for (let j = 0; j < nd; j++) for (const sg of [1, -1]) { const v0 = a[j]; a[j] = clamp(v0 + sg * step, lim[j][0], lim[j][1]); const c2 = cost(); if (c2 < c) { c = c2; moved = true; } else a[j] = v0; } if (!moved) break; }
    if (c < best) { best = c; keep = a.slice(); } }
  setF(side, fi, keep); D.joints[0].bo.updateMatrixWorld(true);
  return { a: keep, err: tip.getWorldPosition(_tip).applyMatrix4(gunWi).distanceTo(target) };
}
// a hand's wrist moved along N until the palm's skin lies just off what it holds — all but the web of the strong
// hand behind the grip: that soft fold takes the backstrap into it, as a real one does under the tang
function seatPalm(side, Wg, Hg, N, sdf) {
  const web = side === 'R' ? (p => p.z > 0.028) : (() => false);
  const seatSD = () => { let m = Infinity; for (const i of SK[side].seat) { skinG(i, sv); if (web(sv)) continue; const d = sdf(sv); if (d < m) m = d; } return m; };
  const n = N.clone().normalize(), W = V(), at = s => { W.copy(Wg).addScaledVector(n, s); poseHand(side, W, Hg, 0, 1); arms.updateMatrixWorld(true); return seatSD(); };
  let lo = -0.05, hi = 0.05; // (lo: away from it, clear; hi: into it)
  for (let it = 0; it < 18; it++) { const m = (lo + hi) / 2; if (at(m) > PALM_GAP) lo = m; else hi = m; }
  at(lo); return W.clone();
}
function solveGrip() {
  const t0 = performance.now();
  if (!skin) indexSkin();
  // (the gun held out in front of the chest, upright, for the working-out: anywhere both wrists reach will do)
  gun.position.set(0, 0.03, 0.4); gun.quaternion.setFromAxisAngle(UP, Math.PI); gun.updateMatrix(); gunMl.copy(gun.matrix); gunMli.copy(gunMl).invert();
  rigRoot.updateMatrixWorld(true); gun.updateMatrixWorld(true); gunWi.copy(gun.matrixWorld).invert(); rigInv.copy(rigRoot.matrixWorld).invert();
  const OPENF = [0, 0.1, 0.1];
  for (const side of ['R', 'L']) {
    const G = GRIP_SET[side], sdf = side === 'R' ? gunSDg : bothSD;
    for (let fi = 0; fi < 5; fi++) setF(side, fi, fi ? OPENF : [0.3, 0.2, 0.2]);
    arms.updateMatrixWorld(true); const pl = placeByLandmarks(side, G.at), H = pl.H;
    const W = seatPalm(side, pl.W, H, G.seat, sdf);
    const ang = [null, null, null, null, null], out = { W, H, ang, fit: pl.fit, seated: W.distanceTo(pl.W) };
    if (side === 'R') {
      for (const fi of [2, 3, 4]) ang[fi] = wrapFinger('R', fi, gunSDg, -0.0235, -0.006);
      { // (the index knuckle's sideways swing: about the palm's normal, in the knuckle bone's own frame)
        const sd = rig.S.R, J0 = sd.fd[1].joints[0], P = o => o.getWorldPosition(V()); arms.updateMatrixWorld(true);
        const nW = V().crossVectors(P(sd.fing[4][0]).sub(P(sd.fing[1][0])), P(sd.fing[2][0]).sub(P(sd.wr))).normalize();
        J0.abd = nW.applyQuaternion(J0.bo.parent.getWorldQuaternion(new THREE.Quaternion()).multiply(J0.q0).invert()).normalize(); }
      const tr = TRIG.clone().add(V().set(0, -0.003, -0.002)), pull = TRIG.clone().add(V().set(0, -0.003, 0.005));
      const fr = fingerTo('R', 1, FRAME_PT, [[-0.2, 0.05, 0.05, 0], [0, 0.1, 0.1, 0.2], [0, 0.1, 0.1, -0.2]]), tg = fingerTo('R', 1, tr, [[-0.3, 0.9, -0.1, 0], [-0.2, 0.7, 0.2, 0.25], [-0.2, 0.7, 0.2, -0.25], [0.1, 1.0, 0.3, 0.3], [0.1, 1.0, 0.3, -0.3]]), pl = fingerTo('R', 1, pull, [tg.a, [-0.3, 1.0, 0, tg.a[3]]]);
      out.idx = { frame: fr.a, trig: tg.a, pull: pl.a, err: [fr.err, tg.err, pl.err] };
      // (from along the frame to the trigger: if the straight blend of the bends would take the finger through the guard,
      // it goes by a point beside the guard first)
      const via = fingerTo('R', 1, new THREE.Vector3(0.026, 0.015, -0.062), [fr.a, tg.a]); let worst = Infinity;
      for (let k = 1; k < 10; k++) { const b = fr.a.map((x, j) => lerp(x, tg.a[j], k / 10)); setF('R', 1, b); rig.S.R.fd[1].joints[0].bo.updateMatrixWorld(true); worst = Math.min(worst, minSD(SK.R.seg[1][1].concat(SK.R.seg[1][2]), gunSDg)); }
      out.idx.via = worst < -0.002 ? via.a : null; out.idx.blendWorst = worst;
      const th = fingerTo('R', 0, THUMB_PT, [[0.2, 0, 0.1], [0.6, 0.5, 0.3], [0.3, -0.3, 0.2], [0.9, 0.9, 0.1], [0.5, 1.1, 0], [1.1, 0.3, 0]]); ang[0] = th.a; out.thErr = th.err;
      ang[1] = out.idx.frame; for (let fi = 0; fi < 5; fi++) setF('R', fi, ang[fi]); arms.updateMatrixWorld(true);
      // the strong hand as capsules, each as thick as its skin (the support hand closes round them)
      const sd = rig.S.R, P = o => o.getWorldPosition(V()).applyMatrix4(gunWi), wr = P(sd.wr); caps = [];
      sd.fd.forEach((D, fi) => { const js = D.joints.map(J => P(J.bo)); js.push(P(D.joints[2].bo.children[0] || D.joints[2].bo));
        for (let k = 0; k < 3; k++) caps.push({ a: js[k], b: js[k + 1], list: SK.R.seg[fi][k] }); if (fi) caps.push({ a: wr, b: js[0], list: SK.R.palm, palm: true }); });
      for (const c of caps) { c.ab = V().subVectors(c.b, c.a); c.l2 = Math.max(1e-8, c.ab.lengthSq()); }
      const dseg = (p, c) => { gq.subVectors(p, c.a); const t = clamp(gq.dot(c.ab) / c.l2, 0, 1); return gq.addScaledVector(c.ab, -t).length(); };
      for (const c of caps) { const ds = []; for (const i of c.list) { const p = skinG(i, sv); if (c.palm) { let best = Infinity, mine = false; for (const o of caps) if (o.palm) { const d = dseg(p, o); if (d < best) { best = d; mine = o === c; } } if (!mine) continue; } ds.push(dseg(p, c)); }
        ds.sort((x, y) => x - y); c.r = ds.length ? ds[Math.floor(ds.length * 0.85)] : 0.008; }
    } else {
      for (const fi of [1, 2, 3, 4]) ang[fi] = wrapFinger('L', fi, bothSD, 0.024, -0.03);
      const th = fingerTo('L', 0, THUMB_L, [[0.2, 0, 0.1], [0.5, 0.3, 0.3], [0.9, 0.9, 0.1], [0.5, 1.1, 0]], bothSD); ang[0] = th.a; out.thErr = th.err;
    }
    GS[side] = out;
  }
  st.gripMs = Math.round(performance.now() - t0);
}

const pL = { p: V() };
const poleR = new THREE.Vector3(-0.45, -1, -0.1), poleL = new THREE.Vector3(0.45, -1, -0.1); // (the elbows down and a little out, as in a held isosceles)
const beltL = new THREE.Vector3(0.14, -0.42, 0.06), FIST = [[0.3, 0.3, 0.4], [0.5, 0.9, 0.6], [0.5, 0.9, 0.6], [0.5, 0.9, 0.6], [0.5, 0.9, 0.6]];
const IDXN = [0, 0, 0, 0], LF = [0, 0, 0];
// the arms reach only so far: where a wrist would have to be past its reach, the gun comes back toward the shoulder
function keepInReach() {
  for (let it = 0; it < 2; it++) for (const side of ['R', 'L']) { const sd = rig.S[side], g = GS[side];
    hw.copy(g.W).applyMatrix4(gun.matrix); const d = a1.subVectors(hw, sd.S0), l = d.length(), max = (sd.Lu + sd.Lf) * 0.97;
    if (l > max) { gun.position.addScaledVector(d, -(1 - max / l)); gun.updateMatrix(); } }
  gunMl.copy(gun.matrix); gunMli.copy(gunMl).invert();
}
function hands(dt) {
  const R = GS.R, Lg = GS.L;
  st.finger = lerp(st.finger, st.aim > 0.35 || st.fireHeld ? 1 : 0, 1 - Math.exp(-dt * 14));
  poseHand('R', R.W, R.H, 0, dt);
  // the strong hand's fingers as worked out; the index from the frame to the trigger (by the point beside the guard, if
  // it needs one) and the trigger pressed as far as it goes
  const f = st.finger, I = R.idx;
  if (I.via && f < 0.5) for (let j = 0; j < 4; j++) IDXN[j] = lerp(I.frame[j], I.via[j], f * 2);
  else if (I.via) for (let j = 0; j < 4; j++) IDXN[j] = lerp(I.via[j], I.trig[j], f * 2 - 1);
  else for (let j = 0; j < 4; j++) IDXN[j] = lerp(I.frame[j], I.trig[j], f);
  for (let j = 0; j < 4; j++) IDXN[j] = lerp(IDXN[j], I.pull[j], st.trig * f);
  for (let fi = 0; fi < 5; fi++) setF('R', fi, fi === 1 ? IDXN : R.ang[fi]);
  // the support hand: on the grip, or during a reload off it to under the grip, down to the belt, back up with a
  // magazine, pushing it home, and on the grip again (a loose fist round the magazine meanwhile)
  let openL = 0, hold = 0; pL.p.copy(Lg.W);
  if (st.reload >= 0) { const t = st.reload, end = st.empty ? RT.rel + 0.2 : RT.seat + 0.3, sm = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
    const G = a1.copy(Lg.W), Up = a2.copy(GRIP.p).addScaledVector(GRIP.a, -0.1).add(V().set(-0.03, 0, 0.02)), Bot = a3.copy(GRIP.p).addScaledVector(GRIP.a, -0.07).add(V().set(-0.03, 0, 0.02));
    const belt = V().copy(beltL).applyMatrix4(gunMli); // (the belt is the body's, not the gun's)
    if (t < RT.drop) pL.p.lerpVectors(G, Up, sm(t / RT.drop));
    else if (t < RT.belt) pL.p.lerpVectors(Up, belt, sm((t - RT.drop) / (RT.belt - RT.drop)));
    else if (t < RT.mag) pL.p.lerpVectors(belt, Up, sm((t - RT.belt) / (RT.mag - RT.belt)));
    else if (t < RT.seat) pL.p.lerpVectors(Up, Bot, sm((t - RT.mag) / (RT.seat - RT.mag)));
    else pL.p.lerpVectors(Bot, G, sm((t - RT.seat) / (end - RT.seat)));
    hold = sm(Math.min(t / 0.15, (end - t) / 0.2)); openL = 0.25 * hold; }
  poseHand('L', pL.p, Lg.H, openL, dt);
  for (let fi = 0; fi < 5; fi++) { for (let j = 0; j < 3; j++) LF[j] = lerp(Lg.ang[fi][j], FIST[fi][j], hold); setF('L', fi, LF); }
}

// ---------------------------------------------------------------- where the bullet goes
// The ground by its height field (and the water's surface), everything else on the GPU: the scene drawn from the
// muzzle along the bullet's way into one float pixel — its distance, which object, the surface's normal
const pickRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType, depthBuffer: true, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
const pickCam = new THREE.PerspectiveCamera(0.02, 1, 0.03, 400), pickBuf = new Float32Array(4), pickList = [];
const pickMat = new THREE.ShaderMaterial({ side: THREE.DoubleSide, uniforms: { uId: { value: 0 } },
  vertexShader: /* glsl */`#include <common>
    #include <morphtarget_pars_vertex>
    #include <skinning_pars_vertex>
    varying vec3 vN; varying float vD;
    void main() {
      #include <beginnormal_vertex>
      #include <morphnormal_vertex>
      #include <skinbase_vertex>
      #include <skinnormal_vertex>
      #include <defaultnormal_vertex>
      #include <begin_vertex>
      #include <morphtarget_vertex>
      #include <skinning_vertex>
      #include <project_vertex>
      vN = normalize(transformedNormal); vD = -mvPosition.z;
    }`,
  fragmentShader: /* glsl */`uniform float uId; varying vec3 vN; varying float vD;
    void main() { vec3 n = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0); if (n.z < 0.0) n = -n; gl_FragColor = vec4(vD, uId, n.x, n.y); }` });
pickMat.onBeforeRender = (r, s, c, g, o) => { pickList.push(o); pickMat.uniforms.uId.value = pickList.length; pickMat.uniformsNeedUpdate = true; };
const skipPick = o => { if (!o.isMesh || o.userData.noPick || o.isSkinnedMesh) return true; const m = Array.isArray(o.material) ? o.material[0] : o.material;
  return !m || m.isShaderMaterial || m.depthWrite === false || (m.transparent && m.opacity < 0.5) || o.geometry.isInstancedBufferGeometry || m.side === THREE.BackSide; };
const hidden = [], _n = V(), _p = V(), _cc = new THREE.Color();
function shoot(o, d) {
  const world = bodycam.world, maxD = 350; let best = null;
  // the ground and the water: along the way in steps growing with the distance, then halved down to a centimetre
  let t0 = 0, t = 0.05;
  for (let i = 0; i < 400 && t < maxD; i++) { _p.copy(o).addScaledVector(d, t); const gy = world.groundAt(_p.x, _p.z), wy = world.waterAt(_p.x, _p.z);
    if (_p.y < Math.max(gy, wy)) { let lo = t0, hi = t; for (let k = 0; k < 14; k++) { const m = (lo + hi) / 2; _p.copy(o).addScaledVector(d, m); if (_p.y < Math.max(world.groundAt(_p.x, _p.z), world.waterAt(_p.x, _p.z))) hi = m; else lo = m; }
      _p.copy(o).addScaledVector(d, hi); const water = world.waterAt(_p.x, _p.z) > world.groundAt(_p.x, _p.z) + 0.02;
      best = { d: hi, p: _p.clone(), n: water ? new THREE.Vector3(0, 1, 0) : world.normalAt(_p.x, _p.z, V()), obj: null, kind: water ? 'water' : groundKind(world.surfaceAt(_p.x, _p.z, _p.y)) }; break; }
    t0 = t; t += clamp(t * 0.03, 0.08, 1.5); }
  // everything else, drawn
  pickCam.position.copy(o); pickCam.lookAt(a1.copy(o).add(d)); pickCam.far = best ? best.d + 0.5 : maxD; pickCam.updateProjectionMatrix(); pickCam.updateMatrixWorld();
  scene.traverse(x => { if (x.visible && (x.isMesh || x.isSprite || x.isPoints || x.isLine) && skipPick(x)) { x.visible = false; hidden.push(x); } });
  const rgSave = rigRoot.visible; rigRoot.visible = false;
  const cc = renderer.getClearColor(_cc).clone(), ca = renderer.getClearAlpha(), au = renderer.shadowMap.autoUpdate, nu = renderer.shadowMap.needsUpdate, ov = scene.overrideMaterial, bg = scene.background, rt = renderer.getRenderTarget();
  renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = false; scene.overrideMaterial = pickMat; scene.background = null; pickList.length = 0;
  renderer.setRenderTarget(pickRT); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(scene, pickCam);
  renderer.readRenderTargetPixels(pickRT, 0, 0, 1, 1, pickBuf);
  renderer.setRenderTarget(rt); renderer.setClearColor(cc, ca); renderer.shadowMap.autoUpdate = au; renderer.shadowMap.needsUpdate = nu; scene.overrideMaterial = ov; scene.background = bg; rigRoot.visible = rgSave;
  for (const x of hidden) x.visible = true; hidden.length = 0;
  const dist = pickBuf[0], id = Math.round(pickBuf[1]);
  if (dist > 0 && id > 0 && (!best || dist < best.d)) {
    const obj = pickList[id - 1], nx = pickBuf[2], ny = pickBuf[3], nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
    const n = new THREE.Vector3(nx, ny, nz).transformDirection(pickCam.matrixWorld);
    const p = o.clone().addScaledVector(d, dist); // (the pixel's view depth: on the axis, the distance itself)
    best = { d: dist, p, n, obj, kind: objKind(obj, n, p, world) };
  }
  return best;
}
const groundKind = s => s === 'asphalt' || s === 'concrete' ? 'asphalt' : s === 'water' ? 'water' : s === 'wood' ? 'wood' : s === 'rock' ? 'concrete' : s === 'sand' ? 'sand' : 'soil';
function objKind(o, n, p, world) {
  if (world.terrain && isUnder(o, world.terrain)) return groundKind(world.surfaceAt(p.x, p.z, p.y));
  const m = Array.isArray(o.material) ? o.material[0] : o.material, nm = ((m && m.name) || '') + ' ' + (o.name || '') + ' ' + ((o.parent && o.parent.name) || '');
  if (/glass|window|pane/i.test(nm) || (m && m.transparent)) return 'glass';
  if ((m && m.alphaTest > 0.05) || /leaf|leaves|foliage|bush|hedge|bamboo|crown|canopy|conifer|pine|fern|shrub|plant/i.test(nm)) return 'leaves';
  if (/wood|plank|timber|bark|log|trunk|board|fence|shoji|tatami/i.test(nm)) return 'wood';
  if ((m && m.metalness > 0.55) || /metal|steel|iron|chrome|alu|car|vending|pole|rail|sign|pipe/i.test(nm)) return 'metal';
  if (n.y > 0.7 && p.y - world.groundAt(p.x, p.z) < 0.3) return groundKind(world.surfaceAt(p.x, p.z, p.y + 0.1));
  return 'concrete';
}
const isUnder = (o, root) => { for (let x = o; x; x = x.parent) if (x === root) return true; return false; };

// ---------------------------------------------------------------- what flies and what is left
function effects(caseMeshes) {
  // particles: soft puffs (dust, soil, smoke, spray) and hard specks (chips, splinters, leaves), drawn as points the
  // size of what they are; sparks as short bright streaks
  const N = 1600, pos = new Float32Array(N * 3), col = new Float32Array(N * 4), size = new Float32Array(N);
  const P = Array.from({ length: N }, () => ({ life: 0 })); let pi = 0;
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aCol', new THREE.BufferAttribute(col, 4)); geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uScale: { value: 1 }, uPx: { value: 800 } },
    vertexShader: 'attribute vec4 aCol; attribute float aSize; uniform float uPx; varying vec4 vCol; varying float vHard; void main(){ vCol = aCol; vHard = step(aSize, 0.0); vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(abs(aSize) * uPx / max(-mv.z, 0.05), 1.0, 900.0); }',
    fragmentShader: 'uniform float uScale; varying vec4 vCol; varying float vHard; void main(){ vec2 c = gl_PointCoord * 2.0 - 1.0; float r = dot(c, c); if (r > 1.0) discard; float a = vHard > 0.5 ? 1.0 : (1.0 - r) * (1.0 - r) * (0.75 + 0.25 * sin(c.x * 7.0 + c.y * 5.0 + vCol.a * 30.0)); gl_FragColor = vec4(vCol.rgb * uScale, clamp(vCol.a, 0.0, 1.0) * a); }' });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.userData.noPick = true; pts.renderOrder = 5; scene.add(pts);
  const add = (p, v, c, a, s, life, drag, grow, g) => { const q = P[pi]; pi = (pi + 1) % N; Object.assign(q, { p: p.clone(), v: v.clone(), c, a, s, life, l0: life, drag, grow, g }); return q; };
  const SN = 200, spos = new Float32Array(SN * 6), scol = new Float32Array(SN * 6), S = Array.from({ length: SN }, () => ({ life: 0 })); let si = 0;
  const sgeo = new THREE.BufferGeometry(); sgeo.setAttribute('position', new THREE.BufferAttribute(spos, 3)); sgeo.setAttribute('color', new THREE.BufferAttribute(scol, 3));
  const smat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const sparks = new THREE.LineSegments(sgeo, smat); sparks.frustumCulled = false; sparks.userData.noPick = true; scene.add(sparks);
  // the muzzle flash: a few camera-facing stars, one frame
  const flashTex = canvasTex(128, g => { const r = g.createRadialGradient(64, 64, 0, 64, 64, 64); r.addColorStop(0, 'rgba(255,250,235,1)'); r.addColorStop(0.18, 'rgba(255,214,140,0.95)'); r.addColorStop(0.45, 'rgba(255,140,40,0.35)'); r.addColorStop(1, 'rgba(255,90,10,0)');
    g.fillStyle = r; g.fillRect(0, 0, 128, 128); g.globalCompositeOperation = 'lighter'; for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2 + Math.random() * 0.4, l = 30 + Math.random() * 34; g.strokeStyle = 'rgba(255,200,120,0.55)'; g.lineWidth = 3 + Math.random() * 4; g.beginPath(); g.moveTo(64, 64); g.lineTo(64 + Math.cos(a) * l, 64 + Math.sin(a) * l); g.stroke(); } });
  const flashMat = new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false });
  const flashes = [0, 1, 2].map(() => { const s = new THREE.Sprite(flashMat); s.visible = false; s.userData.noPick = true; scene.add(s); return s; }); let flashT = 0;
  // the cases: brass, thrown out, bouncing, left lying
  const caseGeo = (() => { const gs = caseMeshes.map(o => { const g = o.geometry.clone(); o.updateMatrixWorld(true); return g.applyMatrix4(o.matrixWorld); });
    if (!gs.length) return new THREE.CylinderGeometry(0.0049, 0.0049, 0.019, 10).rotateX(Math.PI / 2); const g = mergeGeos(gs); g.computeBoundingBox(); const c = g.boundingBox.getCenter(V()); g.translate(-c.x, -c.y, -c.z); return g; })();
  const brass = new THREE.MeshStandardMaterial({ color: 0xc89a4a, metalness: 1, roughness: 0.3 });
  const CN = 48, cases = new THREE.InstancedMesh(caseGeo, brass, CN); cases.count = 0; cases.frustumCulled = false; cases.castShadow = true; cases.userData.noPick = true; cases.userData.noDistCull = true; scene.add(cases);
  const C = []; let ci = 0;
  const mags = []; // (dropped magazines lying about)
  // holes, dents, cracks: one material each, pooled quads laid on the surface
  const holeTex = { concrete: holeCanvas('concrete'), asphalt: holeCanvas('asphalt'), metal: holeCanvas('metal'), wood: holeCanvas('wood'), soil: holeCanvas('soil'), glass: holeCanvas('glass') };
  const decMat = {}; for (const k in holeTex) decMat[k] = new THREE.MeshStandardMaterial({ map: holeTex[k], transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, roughness: k === 'metal' ? 0.35 : 0.95, metalness: k === 'metal' ? 0.7 : 0 });
  const DN = 120, decGeo = new THREE.PlaneGeometry(1, 1), decals = []; let di = 0;
  const dust = { concrete: [0.62, 0.6, 0.56], asphalt: [0.32, 0.31, 0.3], soil: [0.36, 0.29, 0.21], sand: [0.7, 0.62, 0.47], wood: [0.55, 0.42, 0.28], leaves: [0.22, 0.32, 0.12], metal: [0.45, 0.45, 0.45], glass: [0.8, 0.85, 0.88], water: [0.85, 0.9, 0.92] };
  const R = Math.random, rv = (s) => a2.set(R() - 0.5, R() - 0.5, R() - 0.5).multiplyScalar(s);
  const fx = {
    muzzle(p, d, mw) { flashT = 0.034; flashes.forEach((s, i) => { s.visible = true; s.position.copy(p).addScaledVector(d, 0.02 + i * 0.045); s.material.rotation = R() * 6.28; const k = (i ? 0.06 - i * 0.015 : 0.075) * (0.7 + R() * 0.6); s.scale.set(k, k, 1); });
      for (let i = 0; i < 7; i++) add(p.clone().addScaledVector(d, 0.03 + R() * 0.1), a3.copy(d).multiplyScalar(0.4 + R() * 1.2).add(rv(0.3)), [0.72, 0.72, 0.7], 0.22, 0.03 + R() * 0.04, 0.8 + R() * 0.8, 2.2, 0.35, -0.15); // (the smoke drifts off the muzzle)
      const port = a1.copy(PORT).applyMatrix4(mw); for (let i = 0; i < 3; i++) add(port, rv(0.25).add(a3.set(0, 0.25, 0)), [0.7, 0.7, 0.68], 0.16, 0.02, 0.9, 2, 0.25, -0.1); },
    eject(mw) { // (out of the port to the right, up, a little back, spinning end over end)
      const p = a1.copy(PORT).applyMatrix4(mw), rgt = a2.set(1, 0, 0).transformDirection(mw), up = a3.set(0, 1, 0).transformDirection(mw), back = V().set(0, 0, 1).transformDirection(mw);
      const v = V().addScaledVector(rgt, 2.6 + R() * 1.2).addScaledVector(up, 1.6 + R() * 1.1).addScaledVector(back, 0.4 + R() * 0.6).addScaledVector(player.vel, 1);
      const c = C[ci] || (C[ci] = { p: V(), v: V(), q: new THREE.Quaternion(), w: V(), rest: 0, b: 0 }); ci = (ci + 1) % CN; cases.count = Math.max(cases.count, C.length);
      c.p.copy(p); c.v.copy(v); c.q.setFromRotationMatrix(_m.extractRotation(mw)); c.w.set((R() - 0.5) * 50, (R() - 0.5) * 20, 30 + R() * 30); c.rest = 0; c.b = 0; c.age = 0; },
    dropMag(m, mw) { if (!m) return; const k = m.clone(); k.traverse(o => { o.userData.noPick = true; }); m.updateMatrixWorld(true); k.matrixAutoUpdate = true; m.matrixWorld.decompose(k.position, k.quaternion, k.scale); scene.add(k);
      mags.push({ o: k, v: a1.set(0, -1.2, 0).addScaledVector(player.vel, 1).clone(), w: V().set((R() - 0.5) * 6, 0, (R() - 0.5) * 6), rest: 0, age: 0, b: 0 }); if (mags.length > 4) scene.remove(mags.shift().o); },
    impact(h, d) {
      const n = h.n, p = h.p, kind = h.kind, col = dust[kind] || dust.concrete, refl = a1.copy(d).reflect(n);
      const far = h.d > 60 ? 0.5 : 1;
      if (kind === 'water') { for (let i = 0; i < 26 * far; i++) add(p, a3.copy(n).multiplyScalar(1.5 + R() * 4.5).add(rv(1.6)), col, 0.6, 0.02 + R() * 0.05, 0.6 + R() * 0.6, 1.2, 0.2, 9.8); }
      else if (kind === 'leaves') { for (let i = 0; i < 14; i++) add(p, rv(2.4).addScaledVector(d, 1.5), [col[0] * (0.8 + R() * 0.5), col[1] * (0.8 + R() * 0.5), col[2]], 1, -(0.008 + R() * 0.014), 2 + R() * 2, 3.5, 0, 1.2); }
      else {
        // the puff: thrown back off the surface, a little along the ricochet, spreading and settling
        for (let i = 0; i < 12 * far; i++) add(p.clone().addScaledVector(n, 0.02), a3.copy(n).multiplyScalar(0.6 + R() * 2.2).addScaledVector(refl, R() * 0.8).add(rv(0.9)), col, 0.55 + R() * 0.3, 0.05 + R() * 0.08, 0.9 + R() * 1.4, 2.6, kind === 'soil' || kind === 'sand' ? 0.7 : 0.45, kind === 'soil' || kind === 'sand' ? 1.2 : -0.05);
        // chips, clods, splinters: hard specks on ballistic paths
        const nc = kind === 'metal' ? 2 : kind === 'glass' ? 16 : 9; for (let i = 0; i < nc * far; i++) add(p.clone().addScaledVector(n, 0.01), a3.copy(n).multiplyScalar(1.5 + R() * 4).addScaledVector(refl, R() * 2).add(rv(3)), kind === 'glass' ? [0.85, 0.9, 0.95] : col.map(x => x * 0.7), 1, -(0.005 + R() * 0.01), 0.6 + R() * 0.7, 0.3, 0, 9.8);
        if (kind === 'metal' || (kind === 'concrete' && R() < 0.35) || kind === 'asphalt' && R() < 0.2) for (let i = 0; i < (kind === 'metal' ? 16 : 5); i++) { const s = S[si]; si = (si + 1) % SN; s.p = p.clone().addScaledVector(n, 0.01); s.v = a3.copy(refl).multiplyScalar(3 + R() * 9).add(rv(7)).clone(); s.life = s.l0 = 0.12 + R() * 0.3; }
        // the mark (not on things that move)
        if (decMat[kind] || kind === 'sand') { const dyn = h.obj && (h.obj.userData.dynamic || (h.obj.parent && h.obj.parent.userData && h.obj.parent.userData.dynamic)); if (!dyn) {
          let m = decals[di]; if (!m) { m = decals[di] = new THREE.Mesh(decGeo, decMat.concrete); m.userData.noPick = true; m.renderOrder = 2; scene.add(m); } di = (di + 1) % DN;
          m.material = decMat[kind === 'sand' ? 'soil' : kind]; const s = { metal: 0.035, glass: 0.16, wood: 0.05, soil: 0.11, asphalt: 0.07, concrete: 0.075 }[kind === 'sand' ? 'soil' : kind] * (0.85 + R() * 0.35);
          m.position.copy(p).addScaledVector(n, 0.004); m.quaternion.setFromUnitVectors(a3.set(0, 0, 1), n); m.rotateZ(R() * 6.28); m.scale.set(s, s, 1); m.updateMatrix(); m.updateMatrixWorld(); } }
      }
      snd.impact(kind, p, h.d);
    },
    update(dt, world) {
      // particles
      mat.uniforms.uScale.value = clamp(0.2 + 0.8 * env.day, 0.12, 1) / Math.max(1e-3, post.exposure.value) * 0.9;
      mat.uniforms.uPx.value = renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
      for (let i = 0; i < N; i++) { const q = P[i]; if (q.life <= 0) { if (size[i] !== 0 || col[i * 4 + 3] !== 0) { col[i * 4 + 3] = 0; size[i] = 0; pos[i * 3 + 1] = -1e5; } continue; }
        q.life -= dt; const k = Math.exp(-q.drag * dt); q.v.multiplyScalar(k); q.v.y -= q.g * dt; q.p.addScaledVector(q.v, dt);
        if (q.s < 0 && q.g > 5) { const gy = world.groundAt(q.p.x, q.p.z); if (q.p.y < gy) { q.p.y = gy; q.v.set(0, 0, 0); q.g = 0; } }
        const f = q.life / q.l0, s = q.s < 0 ? q.s : q.s * (1 + q.grow * (1 - f) * 4);
        pos[i * 3] = q.p.x; pos[i * 3 + 1] = q.p.y; pos[i * 3 + 2] = q.p.z; col[i * 4] = q.c[0]; col[i * 4 + 1] = q.c[1]; col[i * 4 + 2] = q.c[2];
        col[i * 4 + 3] = q.s < 0 ? Math.min(1, f * 4) : q.a * Math.min(1, f * 2.2) * Math.min(1, (1 - f) * 12 + 0.2); size[i] = s; }
      geo.attributes.position.needsUpdate = geo.attributes.aCol.needsUpdate = geo.attributes.aSize.needsUpdate = true;
      // sparks
      const sb = 8 / Math.max(1e-3, post.exposure.value);
      for (let i = 0; i < SN; i++) { const s = S[i], o6 = i * 6; if (s.life <= 0) { spos.fill(0, o6, o6 + 6); scol.fill(0, o6, o6 + 6); continue; } s.life -= dt; s.v.y -= 9.8 * dt; s.p.addScaledVector(s.v, dt);
        const f = Math.max(0, s.life / s.l0); spos[o6] = s.p.x; spos[o6 + 1] = s.p.y; spos[o6 + 2] = s.p.z; spos[o6 + 3] = s.p.x - s.v.x * 0.012; spos[o6 + 4] = s.p.y - s.v.y * 0.012; spos[o6 + 5] = s.p.z - s.v.z * 0.012;
        scol[o6] = sb * f; scol[o6 + 1] = sb * 0.62 * f; scol[o6 + 2] = sb * 0.25 * f; scol[o6 + 3] = sb * f * 0.5; scol[o6 + 4] = sb * 0.3 * f; scol[o6 + 5] = sb * 0.1 * f; }
      sgeo.attributes.position.needsUpdate = sgeo.attributes.color.needsUpdate = true;
      // flash: one frame
      flashT -= dt; for (const s of flashes) { s.visible = flashT > 0; } flashMat.color.setScalar(3 / Math.max(1e-3, post.exposure.value));
      // cases and magazines: gravity, the ground (or a step, a platform), bounces that lose most of their speed
      for (let i = 0; i < C.length; i++) { const c = C[i]; c.age += dt; if (c.rest < 1) {
        c.v.y -= 9.8 * dt; c.p.addScaledVector(c.v, dt); c.q.multiply(_q.setFromEuler(new THREE.Euler(c.w.x * dt, c.w.y * dt, c.w.z * dt)));
        const gy = Math.max(world.groundAt(c.p.x, c.p.z), standHeight(c.p.x, c.p.z, c.p.y + 0.3)) + 0.005;
        if (c.p.y < gy) { c.p.y = gy; if (c.v.y < -0.4) { if (c.b < 4) snd.tink(c.p, Math.min(1, -c.v.y / 4), world.surfaceAt(c.p.x, c.p.z, c.p.y)); c.b++; }
          c.v.y = -c.v.y * 0.32; c.v.x *= 0.55; c.v.z *= 0.55; c.w.multiplyScalar(0.5); if (Math.abs(c.v.y) < 0.35 && c.v.length() < 0.5) { c.rest = 1; c.v.set(0, 0, 0); // (lying on its side, as a case comes to rest)
            const yaw = R() * 6.28; c.q.setFromEuler(new THREE.Euler(0, yaw, 0)); } } }
        _m.compose(c.p, c.q, a1.setScalar(1)); cases.setMatrixAt(i, _m); }
      cases.instanceMatrix.needsUpdate = true;
      for (const g of mags) { if (g.rest) continue; g.v.y -= 9.8 * dt; g.o.position.addScaledVector(g.v, dt); g.o.rotation.x += g.w.x * dt; g.o.rotation.z += g.w.z * dt;
        const gy = Math.max(world.groundAt(g.o.position.x, g.o.position.z), standHeight(g.o.position.x, g.o.position.z, g.o.position.y + 0.3)) + 0.012;
        if (g.o.position.y < gy) { g.o.position.y = gy; if (g.b++ < 2) snd.thud(g.o.position, Math.min(1, -g.v.y / 4)); g.v.multiplyScalar(0.25); g.v.y = Math.abs(g.v.y) * 0.3; g.w.multiplyScalar(0.3); if (g.v.length() < 0.3) { g.rest = 1; g.o.rotation.set(Math.PI / 2, g.o.rotation.y, 0); } } }
    },
  };
  return fx;
}
const canvasTex = (S, draw) => { const c = document.createElement('canvas'); c.width = c.height = S; draw(c.getContext('2d')); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
// a bullet's mark, drawn: concrete — a dark hole in a pale crater of broken render with chipped edges; asphalt — a
// pocked crater; metal — a clean hole in a bright dished ring of bare steel; wood — a splintered hole; soil — a dark
// scuffed divot; glass — a star of cracks round a frosted hole
function holeCanvas(kind) {
  return canvasTex(128, g => { const R = Math.random, c = 64;
    const blob = (r, fill, jag) => { g.beginPath(); for (let i = 0; i <= 28; i++) { const a = i / 28 * Math.PI * 2, rr = r * (1 + (R() - 0.5) * jag); i ? g.lineTo(c + Math.cos(a) * rr, c + Math.sin(a) * rr) : g.moveTo(c + Math.cos(a) * rr, c + Math.sin(a) * rr); } g.closePath(); g.fillStyle = fill; g.fill(); };
    if (kind === 'glass') { g.strokeStyle = 'rgba(235,245,255,0.75)'; g.lineWidth = 1.4; for (let i = 0; i < 11; i++) { let a = R() * 6.28, x = c, y = c; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 5; k++) { a += (R() - 0.5) * 0.5; x += Math.cos(a) * 12; y += Math.sin(a) * 12; g.lineTo(x, y); } g.stroke(); }
      for (let r = 14; r < 50; r += 12 + R() * 8) { g.beginPath(); g.arc(c, c, r, 0, 6.28); g.globalAlpha = 0.35; g.stroke(); } g.globalAlpha = 1; blob(9, 'rgba(240,248,255,0.85)', 0.5); blob(4, 'rgba(10,12,14,0.95)', 0.3); return; }
    if (kind === 'soil') { const r = g.createRadialGradient(c, c, 0, c, c, 60); r.addColorStop(0, 'rgba(20,14,8,0.95)'); r.addColorStop(0.3, 'rgba(45,32,20,0.8)'); r.addColorStop(0.75, 'rgba(70,52,34,0.35)'); r.addColorStop(1, 'rgba(70,52,34,0)'); g.fillStyle = r; g.fillRect(0, 0, 128, 128); return; }
    const crater = { concrete: 'rgba(196,190,178,0.95)', asphalt: 'rgba(78,76,72,0.9)', metal: 'rgba(205,208,212,0.95)', wood: 'rgba(196,160,112,0.95)' }[kind];
    const rad = g.createRadialGradient(c, c, 4, c, c, 62); rad.addColorStop(0, 'rgba(0,0,0,0.35)'); rad.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = rad; g.fillRect(0, 0, 128, 128);
    if (kind === 'wood') { g.strokeStyle = crater; g.lineWidth = 2.5; for (let i = 0; i < 9; i++) { const a = (R() < 0.5 ? 0 : Math.PI) + (R() - 0.5) * 0.6, l = 18 + R() * 30; g.beginPath(); g.moveTo(c, c); g.lineTo(c + Math.cos(a) * l, c + Math.sin(a) * l * 0.4); g.stroke(); } }
    blob(kind === 'metal' ? 18 : 34, crater, kind === 'metal' ? 0.1 : 0.45);
    if (kind === 'concrete' || kind === 'asphalt') for (let i = 0; i < 7; i++) { const a = R() * 6.28, d = 20 + R() * 16; g.beginPath(); g.arc(c + Math.cos(a) * d, c + Math.sin(a) * d, 2 + R() * 5, 0, 6.28); g.fillStyle = crater; g.fill(); }
    blob(kind === 'metal' ? 11 : 20, kind === 'metal' ? 'rgba(120,124,130,1)' : 'rgba(70,66,60,0.95)', 0.35);
    blob(kind === 'metal' ? 7 : 9, 'rgba(8,7,6,1)', 0.25); });
}
function mergeGeos(gs) {
  const pos = [], nor = []; for (const g of gs) { const ng = g.index ? g.toNonIndexed() : g; pos.push(...ng.attributes.position.array); nor.push(...(ng.attributes.normal ? ng.attributes.normal.array : new Float32Array(ng.attributes.position.count * 3))); }
  const m = new THREE.BufferGeometry(); m.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); m.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); return m;
}

// ---------------------------------------------------------------- sound
// The shot is the recording (two revolver shots, each found by its onset and cut out with its own tail), driven into
// the microphone's clipping, with the street's slap-back after it; the camera's automatic gain ducks everything for
// a moment after. The mechanics — a dry click, the magazine out and in, the slide going home, a holster — and the
// impacts, cases ringing on the ground, the gear on the belt at every step are made here.
function sounds() {
  let clips = null, loading = false;
  const ensure = () => { const ctx = audio.ctx; if (!ctx || clips || loading) return; loading = true;
    fetch(SHOTS).then(r => r.arrayBuffer()).then(b => ctx.decodeAudioData(b)).then(buf => { clips = slice(buf); }).catch(e => console.warn('bodycam shot: ' + e.message)); };
  const slice = buf => { const a = buf.getChannelData(0), sr = buf.sampleRate, out = []; let quiet = 0;
    for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > 0.5 && quiet > sr * 0.4) { out.push(Math.max(0, i - Math.floor(sr * 0.002))); quiet = 0; } else if (v < 0.05) quiet++; else quiet = 0; }
    return out.map((s, k) => ({ buf, t: s / sr, d: Math.min(2.1, ((out[k + 1] || a.length) - s) / sr - 0.02) })); };
  const shaper = (() => { const n = 2048, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(x * 2.2) / Math.tanh(2.2); } return c; })();
  const env1 = (g, t, a, d, v) => { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + a); g.gain.exponentialRampToValueAtTime(0.0002, t + a + d); };
  const noise = (t, dur, type, f, q, v, out, a = 0.001) => { const ctx = audio.ctx, s = ctx.createBufferSource(); s.buffer = audio.white; const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = ctx.createGain(); env1(g, t, a, dur, v); s.connect(fl).connect(g).connect(out); s.start(t, Math.random() * 3); s.stop(t + a + dur + 0.05); };
  const ring = (t, f, dur, v, out) => { const ctx = audio.ctx, o = ctx.createOscillator(); o.frequency.value = f; const g = ctx.createGain(); env1(g, t, 0.001, dur, v); o.connect(g).connect(out); o.start(t); o.stop(t + dur + 0.05); };
  const at = (p, ref = 2, roll = 1.2) => { const ctx = audio.ctx, pn = ctx.createPanner(); pn.panningModel = 'equalpower'; pn.distanceModel = 'inverse'; pn.refDistance = ref; pn.rolloffFactor = roll; pn.maxDistance = 1000;
    if (pn.positionX) { pn.positionX.value = p.x; pn.positionY.value = p.y; pn.positionZ.value = p.z; } else pn.setPosition(p.x, p.y, p.z); pn.connect(audio.master); return pn; };
  const S = {
    shot() { ensure(); const ctx = audio.ctx; if (!ctx) return; const t = ctx.currentTime + 0.004;
      const pre = ctx.createGain(); pre.gain.value = 2.4; const ws = ctx.createWaveShaper(); ws.curve = shaper; ws.oversample = '2x';
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 110; const pk = ctx.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 2600; pk.gain.value = 4; pk.Q.value = 0.8;
      const out = ctx.createGain(); out.gain.value = 0.62; pre.connect(ws).connect(hp).connect(pk).connect(out).connect(audio.master);
      if (clips && clips.length) { const c = clips[Math.floor(Math.random() * clips.length)], s = ctx.createBufferSource(); s.buffer = c.buf; s.playbackRate.value = 1.04 + Math.random() * 0.08;
        const g = ctx.createGain(); g.gain.setValueAtTime(1, t); g.gain.setValueAtTime(1, t + c.d * 0.7); g.gain.linearRampToValueAtTime(0, t + c.d); s.connect(g).connect(pre); s.start(t, c.t, c.d); }
      else { noise(t, 0.25, 'lowpass', 3000, 0.5, 1.4, pre); noise(t, 0.06, 'bandpass', 1200, 0.7, 1.2, pre); }
      // the street throws it back: two late, dull copies
      for (const [dl, v] of [[0.11 + Math.random() * 0.05, 0.16], [0.32 + Math.random() * 0.12, 0.08]]) { const d = ctx.createDelay(1); d.delayTime.value = dl; const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400; const g = ctx.createGain(); g.gain.value = v; out.connect(d).connect(lp).connect(g).connect(audio.master); }
      // the camera's automatic gain: everything pulled down just after the bang, back over a second
      if (audio.agc) { const G = audio.agc.gain; G.cancelScheduledValues(t); G.setValueAtTime(G.value, t); G.setValueAtTime(1, t + 0.035); G.linearRampToValueAtTime(0.28, t + 0.07); G.setTargetAtTime(1, t + 0.18, 0.45); }
      // mechanical clatter of the slide right after
      noise(t + 0.012, 0.03, 'bandpass', 3800, 2, 0.25, audio.master); },
    click() { const ctx = audio.ctx; if (!ctx) return; const t = ctx.currentTime; noise(t, 0.012, 'bandpass', 4200, 3, 0.35, audio.master); noise(t + 0.004, 0.02, 'bandpass', 1800, 4, 0.18, audio.master); },
    mag(inn) { const ctx = audio.ctx; if (!ctx) return; const t = ctx.currentTime; if (inn) { noise(t, 0.03, 'bandpass', 1500, 3, 0.5, audio.master); noise(t + 0.01, 0.05, 'bandpass', 600, 4, 0.4, audio.master); ring(t + 0.005, 2300, 0.04, 0.05, audio.master); }
      else { noise(t, 0.02, 'bandpass', 3000, 3, 0.3, audio.master); noise(t + 0.03, 0.04, 'bandpass', 900, 2, 0.2, audio.master); } },
    slide() { const ctx = audio.ctx; if (!ctx) return; const t = ctx.currentTime; noise(t, 0.035, 'bandpass', 2600, 2.5, 0.6, audio.master); noise(t + 0.006, 0.06, 'bandpass', 700, 3, 0.45, audio.master); ring(t + 0.003, 3100, 0.05, 0.05, audio.master); },
    holster(out) { const ctx = audio.ctx; if (!ctx) return; const t = ctx.currentTime; noise(t, out ? 0.18 : 0.12, 'bandpass', 1400, 0.8, 0.12, audio.master, 0.04); noise(t + (out ? 0.15 : 0.1), 0.02, 'bandpass', 2400, 3, 0.15, audio.master); },
    tink(p, k, surf) { const ctx = audio.ctx; if (!ctx) return; const o = at(p, 1.2, 1.4), t = ctx.currentTime, soft = surf === 'grass' || surf === 'forest' || surf === 'sand';
      if (soft) { noise(t, 0.03, 'bandpass', 900, 1, 0.12 * k, o); return; }
      const f = 5200 + Math.random() * 1600; ring(t, f, 0.18, 0.05 * k, o); ring(t, f * 1.47, 0.12, 0.03 * k, o); ring(t, f * 2.13, 0.08, 0.02 * k, o); noise(t, 0.01, 'highpass', 6000, 0.7, 0.06 * k, o); },
    thud(p, k) { const ctx = audio.ctx; if (!ctx) return; const o = at(p, 1.5), t = ctx.currentTime; noise(t, 0.05, 'bandpass', 700, 1.5, 0.35 * k, o); ring(t, 1500, 0.05, 0.03 * k, o); },
    impact(kind, p, dist) { const ctx = audio.ctx; if (!ctx) return; const o = at(p, 3, 1.1), t = ctx.currentTime + dist / 343; // (it arrives as late as the sound takes)
      if (kind === 'metal') { const f = 1800 + Math.random() * 1500; ring(t, f, 0.35, 0.12, o); ring(t, f * 1.63, 0.25, 0.07, o); ring(t, f * 2.41, 0.15, 0.05, o); noise(t, 0.02, 'highpass', 3000, 0.7, 0.4, o);
        if (Math.random() < 0.35) S.whine(p, t); }
      else if (kind === 'water') { noise(t, 0.12, 'lowpass', 1200, 0.7, 0.5, o, 0.005); noise(t + 0.03, 0.25, 'bandpass', 2500, 0.8, 0.15, o, 0.02); }
      else if (kind === 'glass') { noise(t, 0.02, 'highpass', 4000, 0.7, 0.4, o); for (let i = 0; i < 9; i++) ring(t + Math.random() * 0.25, 3500 + Math.random() * 5000, 0.1, 0.03, o); }
      else if (kind === 'leaves') noise(t, 0.08, 'bandpass', 3000, 0.6, 0.15, o, 0.005);
      else if (kind === 'wood') { noise(t, 0.04, 'bandpass', 900, 2, 0.6, o); noise(t, 0.012, 'highpass', 2500, 0.7, 0.3, o); }
      else if (kind === 'soil' || kind === 'sand') noise(t, 0.06, 'lowpass', 700, 0.8, 0.7, o, 0.002);
      else { noise(t, 0.015, 'highpass', 2500, 0.7, 0.6, o); noise(t, 0.05, 'bandpass', 1100, 1.2, 0.5, o); if (Math.random() < 0.15) S.whine(p, t); } },
    whine(p, t) { const ctx = audio.ctx, o = at(p, 4, 1), osc = ctx.createOscillator(), g = ctx.createGain(); osc.type = 'sawtooth'; const f = 2800 + Math.random() * 1600;
      osc.frequency.setValueAtTime(f, t); osc.frequency.exponentialRampToValueAtTime(f * 0.55, t + 0.5); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 6;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0003, t + 0.55); osc.connect(bp).connect(g).connect(o); osc.start(t); osc.stop(t + 0.6); },
    gear(k) { const ctx = audio.ctx; if (!ctx) return; const t = ctx.currentTime; // (the belt and the vest at every footfall: a rub on the microphone, keys and cuffs)
      noise(t, 0.09, 'lowpass', 500, 0.7, 0.18 * k, audio.master, 0.01); for (let i = 0; i < 3; i++) ring(t + 0.01 + Math.random() * 0.05, 3800 + Math.random() * 3000, 0.04, 0.006 * k, audio.master); },
  };
  return S;
}

// ---------------------------------------------------------------- every frame (main.js), whether or not the camera is on
export function update(world, dt) {
  bodycam.world = world;
  if (!bodycam.ready) return;
  // (the camera not in use this frame — off, flying, at the wheel: none of it shown, the walker's lens put back)
  const used = !!st.used; st.used = false;
  rigRoot.visible = used && st.draw > 0.03; pass.enabled = used; hud.style.display = used ? '' : 'none'; document.documentElement.classList.toggle('bodycam', used);
  if (!used && saved && camera.fov === FOV) { camera.fov = saved.fov; camera.near = saved.near; camera.updateProjectionMatrix(); }
  fx.update(dt, world);
  if (active() && audio.ctx) { const ph = player.stepPhase; if (player.onGround && player.speed > 0.5 && Math.floor(st.prevPhase / Math.PI) !== Math.floor(ph / Math.PI)) snd.gear(clamp(player.speed / 5, 0.4, 1.3)); st.prevPhase = ph; }
}

// ---------------------------------------------------------------- the lens
// What the camera's chip and processor make of the picture: the rectilinear render (drawn wide) bent into the lens's
// barrel (corners kept in the corners, the middle magnified), its rows read one after another while the body turns
// (rolling shutter), colour fringes toward the edges, softer corners, the processor's hard sharpening, a cheap
// sensor's grain (more in the dark), its narrow range — crushed blacks, highlights that clip, a cool cast — and the
// lens's fall-off at the corners; the muzzle flash lights the frame.
const LensShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uK: { value: LENS_K }, uAspect: { value: 16 / 9 }, uRoll: { value: 0 }, uRes: { value: new THREE.Vector2(1920, 1080) }, uNight: { value: 0 }, uFlash: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime, uK, uAspect, uRoll, uNight, uFlash; uniform vec2 uRes; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    vec2 lens(vec2 uv){ vec2 a = vec2(uAspect, 1.0), p = (uv - 0.5) * a, pn = p / length(a * 0.5); float r2 = dot(pn, pn);
      vec2 q = pn * (1.0 + uK * r2) / (1.0 + uK); return q * length(a * 0.5) / a + 0.5; }
    vec3 tap(vec2 uv){ return texture2D(tDiffuse, clamp(uv, vec2(0.0005), vec2(0.9995))).rgb; }
    void main(){
      vec2 uv = vUv; uv.x += (uv.y - 0.5) * uRoll;
      vec2 c = lens(uv), d = c - 0.5; float r2 = dot(d * vec2(uAspect, 1.0), d * vec2(uAspect, 1.0)) / (0.25 * (uAspect * uAspect + 1.0));
      vec2 ca = d * 0.006 * r2;
      vec3 col = vec3(tap(c - ca).r, tap(c).g, tap(c + ca).b);
      // the processor's sharpening (a wide unsharp mask: halos on edges), weaker into the soft corners
      vec2 px = 1.6 / uRes; vec3 bl = (tap(c + vec2(px.x, 0.0)) + tap(c - vec2(px.x, 0.0)) + tap(c + vec2(0.0, px.y)) + tap(c - vec2(0.0, px.y))) * 0.25;
      vec3 bl2 = (tap(c + px * vec2(2.5, 2.5)) + tap(c + px * vec2(-2.5, 2.5)) + tap(c + px * vec2(2.5, -2.5)) + tap(c + px * vec2(-2.5, -2.5))) * 0.25;
      col = mix(col, bl2, smoothstep(0.35, 1.0, r2) * 0.6);
      col += (col - bl) * 0.9 * (1.0 - 0.7 * r2);
      // the flash
      col += vec3(1.0, 0.78, 0.5) * uFlash * (0.18 + 0.55 * uNight) * (1.0 - 0.5 * r2);
      // the chip's range and colour
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, 0.78);
      col = clamp((col - 0.035) / 0.9, 0.0, 1.0);
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.35);
      col *= vec3(0.96, 1.0, 1.03);
      col += vec3(-0.01, 0.006, 0.012) * (1.0 - l);
      // grain: per frame, luminance and a little chroma, stronger in the dark (gain up at night)
      vec2 g = floor(vUv * uRes / 1.5); float t = floor(uTime * 30.0);
      float n = h(g + t * 17.0) + h(g * 1.7 + t * 5.3) - 1.0, nc = h(g * 0.9 + t * 11.0) - 0.5;
      float amt = (0.03 + 0.07 * (1.0 - l) + 0.06 * uNight) ;
      col += n * amt + vec3(nc, -nc * 0.5, nc * 0.7) * amt * 0.35;
      // the lens's fall-off, and black past the image circle's edge
      col *= 1.0 - 0.45 * r2 * r2;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};
