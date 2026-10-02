// Game boot, UI, player, audio and the main loop. Map is chosen with ?map=nature|town. World loading and rendering are
// shared with the world editor (engine.js).
import { THREE, renderer, scene, camera, S, Q, QUALITY, loadState, manager, scatters, clamp, tick, wind } from './core.js';
import { time, updateSky, env } from './sky.js';
import { post } from './post.js';
import { audio } from './audio.js';
import { player, keys, updatePlayer, updateCamera } from './player.js';
import { $, toastMsg } from './ui.js';
import { buildLife } from './life.js';
import { perf, toggleOverlay } from './perf.js';
import { colliderView } from './coldebug.js';
import { mapFromURL, loadWorld, prepareWorld, renderWorld, setQuality as engineQuality } from './engine.js';

const mapName = mapFromURL();
document.body.prepend(renderer.domElement);
document.querySelectorAll('[data-map]').forEach(b => {
  b.classList.toggle('active', b.dataset.map === mapName);
  b.addEventListener('click', () => { if (b.dataset.map !== mapName) location.search = '?map=' + b.dataset.map; });
});

let world = null, life = null, started = false, locked = false, hudOn = true;

const clock = new THREE.Clock();
let fpsAcc = 0, fpsN = 0, ambTimer = 0, amb = {};

function showProgress() {
  const p = loadState.gen * 0.6 + loadState.assets * 0.4;
  $('loadBar').style.width = (p * 100).toFixed(1) + '%';
  $('loadText').textContent = loadState.label + (loadState.assets < 1 ? ` · loading assets ${Math.round(loadState.assets * 100)}%` : '');
}
const progress = (label, p) => { if (label !== loadState.label) console.debug('stage: ' + label + (performance.memory ? ' heap ' + Math.round(performance.memory.usedJSHeapSize / 1048576) + '/' + Math.round(performance.memory.jsHeapSizeLimit / 1048576) + ' MB' : '')); loadState.label = label; loadState.gen = p; showProgress(); };
manager.onProgress = (url, a, b) => { loadState.assets = a / b; showProgress(); };

function setQuality(name) {
  if (!engineQuality(name, world)) return;
  $('qSel').value = name;
  toastMsg('Quality: ' + name.toUpperCase());
}

const P_PLAYER = perf.id('player/collision'), P_LIFE = perf.id('ambient life'), P_AUDIO = perf.id('audio');
const audioState = { wind: 0, day: 0, night: 0, fly: false, under: false };
function step(dt, t) {
  perf.frameStart();
  if (dbgState.still) t = dbgState.still;
  if (time.running && started) time.hour = (time.hour + dt * time.speed) % 24;
  wind.update(dt, t, !!dbgState.still);
  perf.begin(P_PLAYER);
  if (locked && started) updatePlayer(world, dt);
  if (!started && !dbgState.pause) player.yaw += dt * 0.02;
  updateCamera(world);
  if (colliderView.on) colliderView.update(player.pos, (x, z) => world.groundAt(x, z));
  perf.end(P_PLAYER);
  S.uPlayer.value.copy(player.pos);
  let under = false;
  renderWorld(world, dt, t, { yaw: player.yaw, still: !!dbgState.still, afterWorld() {
    perf.begin(P_LIFE);
    life.update(t, time.hour);
    perf.end(P_LIFE);
    const wl = world.waterAt(camera.position.x, camera.position.z);
    under = camera.position.y < wl - 0.05 && world.groundAt(camera.position.x, camera.position.z) < wl;
    post.grade.uniforms.uTime.value = t; post.grade.uniforms.uUnder.value = under ? 1 : 0;
    perf.begin(P_AUDIO);
    ambTimer -= dt;
    if (ambTimer < 0) { ambTimer = 0.4; amb = world.ambience(player.pos.x, player.pos.z); }
    audio.listen(camera);
    Object.assign(audioState, amb); audioState.wind = wind.strength; audioState.day = env.day; audioState.night = env.night; audioState.fly = player.fly; audioState.under = under;
    audio.update(dt, audioState);
    for (const e of audio.emitters) e.update(dt);
    perf.end(P_AUDIO);
  } });
  perf.frameEnd();
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) {
    $('fps').textContent = Math.round(fpsN / fpsAcc) + ' fps · ' + Q.name;
    fpsAcc = 0; fpsN = 0;
    const hh = Math.floor(time.hour), mm = Math.floor((time.hour - hh) * 60);
    $('clock').textContent = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + (time.running ? '' : ' ‖');
    $('mode').textContent = player.fly ? 'fly' : player.swim ? 'swimming' : '';
    if (!locked) $('tSlider').value = time.hour;
  }
}
const dbgState = { pause: false, still: 0 };
function frame() { requestAnimationFrame(frame); const dt = Math.min(clock.getDelta(), 0.05); if (!dbgState.pause) step(dt, clock.elapsedTime); }

// ---------------------------------------------------------------- input
$('play').addEventListener('click', () => { audio.init(); renderer.domElement.requestPointerLock(); });
renderer.domElement.addEventListener('click', () => { if (started && !locked) { audio.init(); renderer.domElement.requestPointerLock(); } });
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === renderer.domElement;
  $('menu').classList.toggle('hidden', locked);
  if (locked) { started = true; for (const k in keys) keys[k] = false; }
});
document.addEventListener('mousemove', e => {
  if (!locked) return;
  player.yaw -= e.movementX * 0.0022 * player.sens;
  player.pitch = clamp(player.pitch - e.movementY * 0.0022 * player.sens, -1.5, 1.5);
});
addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'F3') { e.preventDefault(); toggleOverlay(); }
  if (e.code === 'F4') { e.preventDefault(); toastMsg(colliderView.toggle(player.pos, (x, z) => world.groundAt(x, z)) ? 'Colliders shown' : 'Colliders hidden'); }
  if (!locked) return;
  if (e.code === 'KeyF') { player.fly = !player.fly; if (player.fly) player.pos.copy(camera.position); else player.vy = 0; toastMsg(player.fly ? 'Fly mode' : 'Walking'); }
  if (e.code === 'KeyT') { time.running = !time.running; toastMsg(time.running ? 'Time running' : 'Time paused'); }
  if (e.code === 'BracketLeft') { time.hour = (time.hour + 23.5) % 24; updateSky(true); }
  if (e.code === 'BracketRight') { time.hour = (time.hour + 0.5) % 24; updateSky(true); }
  if (e.code === 'KeyH') { hudOn = !hudOn; $('hud').style.display = hudOn ? '' : 'none'; $('credit').style.display = hudOn ? '' : 'none'; }
  if (e.code === 'KeyM') audio.toggleMute();
  if (e.code.startsWith('Digit')) setQuality(['low', 'medium', 'high', 'ultra', 'extreme'][+e.code.slice(5) - 1]);
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
});
addEventListener('keyup', e => { keys[e.code] = false; });
$('tSlider').addEventListener('input', e => { time.hour = +e.target.value; updateSky(true); });
document.querySelectorAll('[data-hour]').forEach(b => b.addEventListener('click', () => { time.hour = +b.dataset.hour; updateSky(true); $('tSlider').value = time.hour; toastMsg(b.textContent); }));
$('sSlider').addEventListener('input', e => player.sens = +e.target.value);
$('fSlider').addEventListener('input', e => { camera.fov = +e.target.value; camera.updateProjectionMatrix(); });
$('vSlider').addEventListener('input', e => audio.setVolume(+e.target.value));
$('qSel').addEventListener('change', e => setQuality(e.target.value));
$('qSel').value = Q.name;

// ---------------------------------------------------------------- boot
async function main() {
  world = await loadWorld(mapName, { progress });
  $('mapTitle').textContent = 'free roam · ' + world.meta.name;
  life = buildLife(world, world.meta.life || {});
  player.pos.set(world.spawn.x, world.groundAt(world.spawn.x, world.spawn.z), world.spawn.z);
  player.yaw = world.spawn.yaw; player.pitch = world.spawn.pitch ?? -0.03;
  updateSky(true); post.exposure.value = env.exposure; post.wb.value.copy(env.wb);
  updateCamera(world); camera.updateMatrixWorld();
  await prepareWorld(world, progress);
  frame();
  const ld = $('loading'); ld.classList.add('hidden'); setTimeout(() => ld.remove(), 900);
  $('menu').classList.remove('hidden');
  if (world.layer) world.layer.showProblems();
  let manualT = 0;
  window.__wl = { THREE, scene, camera, player, renderer, world, time, post, setQuality, updateSky, QUALITY, Q, scatters, S,
    step: (n = 1) => { for (let i = 0; i < n; i++) { manualT += 1 / 60; step(1 / 60, manualT); } }, at: t => { manualT = t; }, wind, colliderView, dbg: debugToggles(), perf, toggleOverlay, keys,
    // automated play-testing: act as if the pointer were locked, so keys (keys.KeyW = true ...) drive the walker
    autoplay(on = true) { started = started || on; locked = on; $('menu').classList.toggle('hidden', on); } }; // console debugging hook
}
// A/B switches for render diagnosis (flicker isolation): __wl.dbg.set({ taa: false, ao: false, shadows: false, ... })
function debugToggles() {
  const M = world.materials || {}, cur = { taa: true, ao: true, shadows: true, bloom: true, roadNormal: true, roadDetail: true, marks: true, terrain: 'on', wind: true };
  const saved = { nm: M.asphalt && M.asphalt.normalMap };
  let tint = null;
  const apply = () => {
    if (post.taa) { if (post.taa.enabled !== cur.taa) post.taa.reset = true; post.taa.enabled = cur.taa; } if (!cur.taa) camera.clearViewOffset();
    if (post.ao) post.ao.enabled = cur.ao;
    if (post.bloom) post.bloom.enabled = cur.bloom && Q.bloom;
    scene.traverse(o => { if (o.isMesh || o.isInstancedMesh) { if (o.userData.rs0 === undefined) o.userData.rs0 = o.receiveShadow; o.receiveShadow = cur.shadows && o.userData.rs0; } });
    if (M.asphalt) {
      const nm = cur.roadNormal ? saved.nm : null;
      if (M.asphalt.normalMap !== nm) { M.asphalt.normalMap = nm; M.asphalt.needsUpdate = true; }
      const plain = !cur.roadDetail, has = !!(M.asphalt.defines && 'ASP_PLAIN' in M.asphalt.defines);
      if (plain !== has) { M.asphalt.defines = Object.assign({}, M.asphalt.defines); if (plain) M.asphalt.defines.ASP_PLAIN = ''; else delete M.asphalt.defines.ASP_PLAIN; M.asphalt.needsUpdate = true; }
    }
    for (const k of ['paint', 'stopLegend', 'tactileL', 'tactileD']) if (M[k]) M[k].visible = cur.marks;
    if (world.terrain) {
      world.terrain.visible = cur.terrain !== 'off';
      if (!tint) tint = new THREE.MeshBasicMaterial({ color: 0xff00ff, fog: false });
      world.terrain.traverse(o => { if (!o.isMesh) return; if (!o.userData.mat0) o.userData.mat0 = o.material; o.material = cur.terrain === 'tint' ? tint : o.userData.mat0; });
    }
    dbgState.still = cur.wind ? 0 : (S.uTime.value || 1);
  };
  return { set(o) { Object.assign(cur, o); if ('pause' in o) dbgState.pause = o.pause; apply(); return { ...cur, pause: dbgState.pause }; }, state: () => ({ ...cur, pause: dbgState.pause }) };
}
main().catch(e => { console.error(e); document.body.insertAdjacentHTML('beforeend', `<div id="err">${e.stack || e}</div>`); });
