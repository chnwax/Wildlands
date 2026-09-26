// First-person walker / swimmer / flyer driven by a world interface:
// world.groundAt(x,z), world.normalAt(x,z,out), world.surfaceAt(x,z), world.waterAt(x,z) (water surface y or -Infinity),
// world.bounds {minX,maxX,minZ,maxZ}, world.collide(p) (optional extra pushers)
import { THREE, camera, clamp, lerp, collide, standHeight } from './core.js';
import { audio } from './audio.js';

export const keys = {};
export const player = { pos: new THREE.Vector3(), vy: 0, yaw: 0, pitch: 0, onGround: true, fly: false, swim: false, crouch: 0,
  stepPhase: 0, land: 0, speed: 0, vel: new THREE.Vector3(), sens: 1 };
const EYE = 1.68;
const _n = new THREE.Vector3(), fwd = new THREE.Vector3(), right = new THREE.Vector3(), tgt = new THREE.Vector3(), dir = new THREE.Vector3();

function floorAt(world, x, z, feetY) { return Math.max(world.groundAt(x, z), standHeight(x, z, feetY)); }

export function updatePlayer(world, dt) {
  fwd.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  right.set(-fwd.z, 0, fwd.x);
  let ix = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0), iz = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
  const il = Math.hypot(ix, iz); if (il > 0) { ix /= il; iz /= il; }
  const sprint = keys.ShiftLeft || keys.ShiftRight;
  const p = player.pos, B = world.bounds;
  if (player.fly) {
    const sp = sprint ? 140 : 32;
    dir.set(0, 0, -1).applyEuler(camera.rotation);
    p.addScaledVector(dir, iz * sp * dt).addScaledVector(right, ix * sp * dt);
    if (keys.Space) p.y += sp * dt; if (keys.KeyC) p.y -= sp * dt;
    const m = 2000; p.x = clamp(p.x, B.minX - m, B.maxX + m); p.z = clamp(p.z, B.minZ - m, B.maxZ + m);
    p.y = Math.max(p.y, Math.max(world.groundAt(p.x, p.z), world.waterAt(p.x, p.z)) + 0.5);
    player.speed = sp * il;
    return;
  }
  const ground = floorAt(world, p.x, p.z, p.y);
  const wl = world.waterAt(p.x, p.z), depth = wl - ground;
  player.swim = depth > 1.4 && p.y < wl - 1.2;
  const crouch = keys.KeyC && !player.swim;
  player.crouch = lerp(player.crouch, crouch ? 1 : 0, 1 - Math.exp(-dt * 10));
  let speed = player.swim ? (sprint ? 3.2 : 2.0) : crouch ? 1.6 : sprint ? 8.2 : 4.1;
  if (!player.swim && depth > 0) speed *= lerp(1, 0.5, clamp(depth / 1.3, 0, 1));
  tgt.set(0, 0, 0).addScaledVector(fwd, iz * speed).addScaledVector(right, ix * speed);
  const accel = player.onGround || player.swim ? 10 : 2;
  player.vel.x = lerp(player.vel.x, tgt.x, 1 - Math.exp(-dt * accel));
  player.vel.z = lerp(player.vel.z, tgt.z, 1 - Math.exp(-dt * accel));
  world.normalAt(p.x, p.z, _n);
  if (_n.y < 0.74 && !player.swim && p.y - world.groundAt(p.x, p.z) < 0.3) { // steep terrain resists climbing
    const into = player.vel.x * _n.x + player.vel.z * _n.z;
    if (into < 0) { player.vel.x -= _n.x * into * 0.9; player.vel.z -= _n.z * into * 0.9; }
  }
  p.x += player.vel.x * dt; p.z += player.vel.z * dt;
  collide(p);
  if (world.collide) world.collide(p);
  p.x = clamp(p.x, B.minX, B.maxX); p.z = clamp(p.z, B.minZ, B.maxZ);
  const g2 = floorAt(world, p.x, p.z, p.y);
  if (player.swim) {
    const floatY = wl - 1.45 + Math.sin(performance.now() * 0.0016) * 0.04;
    player.vy = lerp(player.vy, keys.Space ? 1.2 : 0, 1 - Math.exp(-dt * 3));
    p.y = lerp(p.y, floatY, 1 - Math.exp(-dt * 3)) + player.vy * dt * 0.2;
    p.y = Math.max(p.y, g2);
    player.onGround = false;
  } else {
    player.vy -= 21 * dt;
    p.y += player.vy * dt;
    if (p.y <= g2) {
      if (!player.onGround && player.vy < -4) { player.land = Math.min(0.25, -player.vy * 0.018); audio.step(world.surfaceAt(p.x, p.z, p.y), 1.3); }
      // small steps (kerbs, platform edges) are climbed smoothly
      p.y = g2 - p.y > 0.05 && g2 - p.y < 0.5 && player.onGround ? lerp(p.y, g2, 1 - Math.exp(-dt * 25)) : g2;
      player.vy = 0; player.onGround = true;
    } else if (p.y - g2 > 0.35) player.onGround = false;
    else if (player.vy <= 0) { p.y = g2; player.onGround = true; }
    if (keys.Space && player.onGround) { player.vy = 5.6; player.onGround = false; }
  }
  const hs = Math.hypot(player.vel.x, player.vel.z);
  player.speed = hs;
  if ((player.onGround || player.swim) && hs > 0.3) {
    const prev = player.stepPhase;
    player.stepPhase += dt * hs * (player.swim ? 0.9 : 1.75);
    if (Math.floor(prev / Math.PI) !== Math.floor(player.stepPhase / Math.PI)) audio.step(player.swim ? 'water' : world.surfaceAt(p.x, p.z, p.y), clamp(hs / 5, 0.4, 1.3));
  }
  player.land = lerp(player.land, 0, 1 - Math.exp(-dt * 6));
}

export function updateCamera(world) {
  const p = player.pos;
  camera.rotation.set(player.pitch, player.yaw, 0);
  if (player.fly) { camera.position.copy(p); return; }
  const bobAmt = player.swim ? 0 : clamp(player.speed / 6, 0, 1.3);
  const bobY = Math.abs(Math.sin(player.stepPhase)) * 0.055 * bobAmt, bobX = Math.cos(player.stepPhase) * 0.03 * bobAmt;
  const eye = player.swim ? 1.7 : EYE - player.crouch * 0.6;
  camera.position.set(p.x, p.y + eye + bobY - player.land, p.z);
  camera.position.x += Math.cos(player.yaw) * bobX; camera.position.z -= Math.sin(player.yaw) * bobX;
  camera.rotation.z = Math.cos(player.stepPhase) * 0.004 * bobAmt;
  const g = world.groundAt(camera.position.x, camera.position.z);
  if (camera.position.y < g + 0.3) camera.position.y = g + 0.3;
}
