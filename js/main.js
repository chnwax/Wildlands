// Game boot, UI, player, audio and the main loop. The city is picked on the title screen (menu.js); ?map=town|nature
// skips the title and loads that map at once. World loading and rendering are shared with the world editor (engine.js).
import { THREE, renderer, scene, camera, S, Q, QUALITY, loadState, manager, scatters, clamp, tick, wind, skipStaticWalk, renderScale, fx } from './core.js';
import { time, updateSky, env } from './sky.js';
import { post } from './post.js';
import { audio } from './audio.js';
import { player, keys, updatePlayer, updateCamera } from './player.js';
import { $, toastMsg } from './ui.js';
import { buildLife } from './life.js';
import { perf, toggleOverlay } from './perf.js';
import { colliderView } from './coldebug.js';
import { mapFromURL, loadWorld, prepareWorld, renderWorld, setQuality as engineQuality } from './engine.js';
import { title, cityOfMap } from './menu.js';
import { boostNow } from './items.js';
import * as session from './session.js';
import * as preload from './preload.js';
import { raceById, raceOfMap, fieldFor } from './races.js';
import { selection, transition, results, showPrompt, saveBest } from './raceui.js';
import { buildRaceBoard } from './raceboard.js';

const direct = new URLSearchParams(location.search).has('map') ? mapFromURL() : null; // (index.html marks the same: boot-direct)
let mapName = direct;
document.body.prepend(renderer.domElement);

let world = null, life = null, started = false, locked = false, hudOn = true;
let car = null; // (maps with a car to drive: car.js; while it is driven it takes the keys, the mouse and the camera)
// ---------------------------------------------------------------- Sakuragawa and its races in one session (session.js)
// home: Sakuragawa's context — detached and kept whole while a race runs, put back as it was after it; raceCtx: the race
// map's, released after the race. transit: a switch under way (nothing simulated or drawn behind the transition screen)
let home = null, raceCtx = null, raceInfo = null, board = null, transit = false, resultsShown = false, finishT = 0;
// the board's place: the open lot beside road B, a few metres behind the spawn, facing the road
const BOARD_SPOT = { x: 100.6, z: -36.2, yaw: Math.PI / 2 };
const townPose = { pos: new THREE.Vector3(), yaw: 0, pitch: 0, fly: false };
// ---------------------------------------------------------------- game -> World Builder, at this exact view (B)
// The view travels in the editor's URL — exact metres and radians, taken from the rendered camera whatever mode the
// player is in (walking, flying, third person) — so nothing has to be copied by hand and nothing can overwrite it
// before the editor reads it, and it survives a change of server: the game is usually served by Play-Wildlands.bat
// (static files, port 8765), but saving edits needs the dev server (Editor.bat / npm run dev, port 5180). When that
// server is running the World Builder opens there; otherwise it opens here, read-only.
const DEV_PORT = 5180;
async function builderBase() {
  const dev = async url => { try { const r = await fetch(url, { cache: 'no-store' }); return r.ok && (await r.json()).dev === true; } catch (e) { return false; } };
  if (await dev('/api/ping')) return '';
  const h = location.hostname;
  if ((h === 'localhost' || h === '127.0.0.1') && +location.port !== DEV_PORT && await dev(`http://${h}:${DEV_PORT}/api/ping`)) return `http://${h}:${DEV_PORT}/`;
  return '';
}
// the editor's query for the current view
function builderQuery() {
  camera.updateMatrixWorld(); // (the camera as last rendered: exactly the view on screen)
  const p = camera.getWorldPosition(new THREE.Vector3()), d = camera.getWorldDirection(new THREE.Vector3()), n = (v, k) => String(+v.toFixed(k));
  return new URLSearchParams({ map: mapName, from: 'game',
    cam: [p.x, p.y, p.z].map(v => n(v, 3)).join(','), yaw: n(Math.atan2(-d.x, -d.z), 5), pitch: n(Math.asin(clamp(d.y, -1, 1)), 5),
    fov: n(camera.fov, 1), hour: n(time.hour, 3), feet: [player.pos.x, player.pos.y, player.pos.z].map(v => n(v, 3)).join(',') }).toString();
}
let transferring = false;
async function openBuilderHere() {
  if (!world || transferring) return;
  transferring = true;
  const q = builderQuery(); // (taken now, before the awaits: the view the player saw when pressing the key)
  toastMsg('Opening the World Builder here…');
  if (document.pointerLockElement) document.exitPointerLock();
  const base = await builderBase();
  location.assign(base + 'editor.html?' + q);
  setTimeout(() => { transferring = false; }, 4000); // (navigation refused or cancelled: allow another try)
}

const clock = new THREE.Clock();
let fpsAcc = 0, fpsN = 0, ambTimer = 0, amb = {};

function showProgress() {
  const ld = $('loading');
  if (!ld || ld.classList.contains('ready')) return; // (assets streaming in after the world is up)
  const p = loadState.gen * 0.6 + loadState.assets * 0.4;
  $('loadBar').style.width = (p * 100).toFixed(1) + '%';
  $('loadText').textContent = loadState.label + (loadState.assets < 1 ? ` · loading assets ${Math.round(loadState.assets * 100)}%` : '');
}
const progress = (label, p) => { if (label !== loadState.label) console.debug('stage: ' + label + (performance.memory ? ' heap ' + Math.round(performance.memory.usedJSHeapSize / 1048576) + '/' + Math.round(performance.memory.jsHeapSizeLimit / 1048576) + ' MB' : '')); loadState.label = label; loadState.gen = p; showProgress(); };
manager.onProgress = (url, a, b) => { loadState.assets = a / b; showProgress(); };

function setQuality(name) {
  if (!engineQuality(name, world)) return;
  $('qSel').value = name;
  showScale();
  toastMsg('Quality: ' + name.toUpperCase());
}
// render scale: the preset's own or a fixed one (core.js renderScale); the window-resize path resizes every target
const _rs = new THREE.Vector2();
function showScale() { renderer.getDrawingBufferSize(_rs); $('rSelV').textContent = _rs.x + '×' + _rs.y; }
function setScale(v) {
  renderScale.value = v; try { localStorage.setItem('wl_scale', v ? String(v) : ''); } catch (e) {}
  dispatchEvent(new Event('resize')); $('rSel').value = v ? String(v) : ''; showScale();
  toastMsg('Render scale: ' + (v ? Math.round(v * 100) + '%' : 'preset'));
}

const _dir = new THREE.Vector3();
const P_PLAYER = perf.id('player/collision'), P_LIFE = perf.id('ambient life'), P_AUDIO = perf.id('audio');
const audioState = { wind: 0, day: 0, night: 0, fly: false, under: false };
function step(dt, t) {
  if (transit) return;
  perf.frameStart();
  preload.frame(); // (the preloader's one GPU upload, when the frame has time for it)
  if (dbgState.still) t = dbgState.still;
  if (time.running && started) time.hour = (time.hour + dt * time.speed) % 24;
  wind.update(dt, t, !!dbgState.still);
  perf.begin(P_PLAYER);
  player.boost = boostNow();
  const driving = car && car.driving;
  // (an impact frame: for a moment the world nearly stops — the car, the race, the life — while the camera shakes on)
  const realDt = dt; if (fx.stop > 0) { fx.stop -= dt; dt *= 0.04; }
  if (car) { car.inputOn = locked && started; if (car.autopilot && driving) car.autopilot(dt); else car.control(driving && locked && started ? keys : null, dt); car.update(dt); }
  if (locked && started && !driving) updatePlayer(world, dt);
  if (world.shops && started) world.shops.update(player, camera, dt);
  if (board && home && home.attached) boardStep(dt);
  if (raceCtx && car && world.race) raceStep(dt);
  if (!started && !dbgState.pause && !driving) player.yaw += dt * 0.02;
  if (driving) { // (the walker rides along: the grass, the ambience and the audio follow the car)
    car.applyCamera(camera, realDt); player.pos.set(car.st.pos.x, world.groundAt(car.st.pos.x, car.st.pos.z), car.st.pos.z);
    const d = camera.getWorldDirection(_dir); player.yaw = Math.atan2(-d.x, -d.z);
  } else updateCamera(world);
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
    post.grade.uniforms.uImpact.value = fx.flash; fx.flash = fx.stop > 0.05 ? Math.max(0, fx.flash - realDt * 0.9) : fx.flash > 0.01 ? fx.flash * Math.exp(-realDt / 0.085) : 0; // (held near its peak while the world is stopped: a few stark frames)
    const cockpit = driving && car.view === 0; // (in the cockpit: its dark trim not tinted blue, and the eye opened to the cabin's light — the windows read brighter)
    post.grade.uniforms.uLift.value.set(...(cockpit ? [0.006, 0.0065, 0.008] : [0.012, 0.016, 0.035])); if (cockpit) post.exposure.value *= 1.6;
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
  fpsAcc += realDt; fpsN++;
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
const enterGame = () => {
  audio.init();
  const p = renderer.domElement.requestPointerLock(); // (refusals also raise pointerlockerror, handled below)
  if (p && p.catch) p.catch(() => {});
};
$('play').addEventListener('click', enterGame);
$('toTitle').addEventListener('click', () => location.assign(location.pathname)); // (a fresh page: the title, no map loaded)
$('leaveRace').addEventListener('click', e => { e.stopPropagation(); goHome(); });
renderer.domElement.addEventListener('click', () => { if (started && !locked && !transit && !selection.isOpen() && !results.on) { if (world && world.shops && world.shops.isOpen()) world.shops.close(); enterGame(); } });
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === renderer.domElement;
  $('menu').classList.toggle('hidden', locked || transit || selection.isOpen() || results.on || !!(world && world.shops && world.shops.isOpen())); // (a shop, the bag or a race screen open: no pause menu over it)
  if (locked) { started = true; $('play').textContent = 'Resume'; for (const k in keys) keys[k] = false; }
});
// pointer lock refused (the browser wants another click): the pause menu offers the button again
document.addEventListener('pointerlockerror', () => { if (world && !locked && !transit && !selection.isOpen() && !results.on) $('menu').classList.remove('hidden'); });
document.addEventListener('mousemove', e => {
  if (!locked) return;
  if (car && car.driving) { car.lookMouse(e.movementX * player.sens, e.movementY * player.sens); return; }
  player.yaw -= e.movementX * 0.0022 * player.sens;
  player.pitch = clamp(player.pitch - e.movementY * 0.0022 * player.sens, -1.5, 1.5);
});
addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'F3') { e.preventDefault(); toggleOverlay(); }
  if (e.code === 'F4' && world) { e.preventDefault(); toastMsg(colliderView.toggle(player.pos, (x, z) => world.groundAt(x, z)) ? 'Colliders shown' : 'Colliders hidden'); }
  // the shop counter (E) and the bag (I / Tab): the cursor is freed while they are open; E, I, Tab or Esc closes them
  const shops = world && world.shops, release = () => { for (const k in keys) keys[k] = false; if (document.pointerLockElement) document.exitPointerLock(); };
  if (selection.isOpen() || results.on || transit) return; // (the race screens take their own keys)
  if (board && home && home.attached && locked && e.code === 'KeyE' && !(car && car.driving) && board.near(player.pos)) { e.preventDefault(); openBoard(); return; }
  if (shops && shops.isOpen() && ['Escape', 'KeyE', 'KeyI', 'Tab'].includes(e.code)) { e.preventDefault(); shops.close(); enterGame(); return; }
  if (shops && locked && e.code === 'KeyE' && shops.interact()) { e.preventDefault(); release(); return; }
  if (shops && locked && (e.code === 'KeyI' || e.code === 'Tab')) { e.preventDefault(); if (shops.toggleBag()) release(); return; }
  if (!locked) return;
  // the car: in and out (V), its views (C), back on its wheels (R), the gearbox's mode (X)
  if (car && e.code === 'KeyV') {
    if (car.driving && car.st.vel.length() > 3) { toastMsg('Stop the car to get out'); return; }
    if (car.driving) { const p = car.leave(); player.fly = false; player.vy = 0; player.pos.set(p.x, world.groundAt(p.x, p.z), p.z); player.pitch = -0.1; camera.near = 0.2; camera.fov = +$('fSlider').value || 72; camera.updateProjectionMatrix(); toastMsg('On foot — V by the car to get in'); }
    else if (car.near(player.pos)) { car.enter(); toastMsg('At the wheel'); } else toastMsg('Walk up to the car to get in');
    return;
  }
  if (car && car.driving) { if (e.code === 'KeyC') car.cycleView(); if (e.code === 'KeyR') car.reset(); if (e.code === 'KeyX') car.toggleAuto(); }
  if (car && e.code === 'F6') { e.preventDefault(); car._dbgArms = !car._dbgArms; car.debugArms(car._dbgArms); toastMsg(car._dbgArms ? 'Arms debug: bone axes, joints, grips, elbow' : 'Arms debug off'); }
  if (e.code === 'KeyF' && car && car.driving) return;
  if (e.code === 'KeyF') { player.fly = !player.fly; if (player.fly) player.pos.copy(camera.position); else player.vy = 0; toastMsg(player.fly ? 'Fly mode' : 'Walking'); }
  if (e.code === 'KeyT') { time.running = !time.running; toastMsg(time.running ? 'Time running' : 'Time paused'); }
  if (e.code === 'BracketLeft') { time.hour = (time.hour + 23.5) % 24; updateSky(true); }
  if (e.code === 'BracketRight') { time.hour = (time.hour + 0.5) % 24; updateSky(true); }
  if (e.code === 'KeyH') { hudOn = !hudOn; $('hud').style.display = hudOn ? '' : 'none'; $('credit').style.display = hudOn ? '' : 'none'; }
  if (e.code === 'KeyM') audio.toggleMute();
  if (e.code === 'KeyG' && world && world.home) { const p = world.home.spawnAt; player.fly = false; player.vy = 0; player.pos.set(p[0], world.groundAt(p[0], p[2]), p[2]); player.yaw = world.home.site.r; toastMsg('Home — さくら農園'); }
  if (e.code === 'KeyB') { e.preventDefault(); openBuilderHere(); }
  if (e.code.startsWith('Digit')) setQuality(['low', 'medium', 'high', 'ultra', 'extreme'][+e.code.slice(5) - 1]);
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
});
addEventListener('keyup', e => { keys[e.code] = false; });
$('tSlider').addEventListener('input', e => { time.hour = +e.target.value; updateSky(true); });
document.querySelectorAll('[data-hour]').forEach(b => b.addEventListener('click', () => { time.hour = +b.dataset.hour; updateSky(true); $('tSlider').value = time.hour; toastMsg(b.textContent); }));
// sliders remember their value on this computer (quality is kept by engine.js)
function setting(id, key, def, apply, fmt) {
  const el = $(id), out = $(id + 'V');
  let v = def;
  try { const s = localStorage.getItem(key); if (s !== null && Number.isFinite(+s)) v = clamp(+s, +el.min, +el.max); } catch (e) {}
  const set = val => { apply(val); if (out) out.textContent = fmt(val); };
  el.value = v; set(v);
  el.addEventListener('input', () => { set(+el.value); try { localStorage.setItem(key, el.value); } catch (e) {} });
}
setting('sSlider', 'wl_sens', 1, v => player.sens = v, v => v.toFixed(2));
setting('fSlider', 'wl_fov', 72, v => { camera.fov = v; camera.updateProjectionMatrix(); }, v => v + '°');
const carFov = { v: 62 }; setting('cfSlider', 'wl_carfov2', 62, v => { carFov.v = v; if (car) car.fov = v; }, v => v + '°'); // (the car's cameras: cockpit, bonnet, chase)
setting('vSlider', 'wl_volume', 0.8, v => audio.setVolume(v), v => Math.round(v * 100) + '%');
$('qSel').addEventListener('change', e => setQuality(e.target.value));
{ const cs = $('carSel'); try { cs.value = localStorage.getItem('wl_car') || ''; } catch (e) {} cs.addEventListener('change', () => { try { localStorage.setItem('wl_car', cs.value); } catch (e) {} toastMsg('Car: from the next stage you load'); }); }
$('qSel').value = Q.name;
$('rSel').addEventListener('change', e => setScale(+e.target.value || 0));
$('rSel').value = renderScale.value ? String(renderScale.value) : ''; showScale();
addEventListener('resize', showScale);
$('openBuilder').addEventListener('click', e => { e.stopPropagation(); openBuilderHere(); });

// ---------------------------------------------------------------- boot
// hour: the arrival time picked on the title screen, null for the map's own start hour
async function main(hour = null) {
  session.markPersistent(); session.begin(); // (what the map adds from here on is its own: session.js)
  world = await loadWorld(mapName, { progress });
  $('openBuilder').hidden = world.meta.builder === false;
  const city = cityOfMap(mapName);
  $('menuCity').textContent = city.name.toUpperCase();
  $('mapTitle').innerHTML = (city.kanji ? `<span class="k">${city.kanji}</span> · ` : '') + 'free roam';
  life = buildLife(world, world.meta.life || {});
  if (world.meta.vehicle) { // (the car's models live in Modeleaut/ beside the game; without them the stage is walked)
    progress('Bringing the car', 0.96);
    // (the car: ?car= in the address, else the one picked in the settings, else the stage's own)
    let carId = new URLSearchParams(location.search).get('car') || (world.raceOpt && world.raceOpt.car) || ''; if (!carId) try { carId = localStorage.getItem('wl_car') || ''; } catch (e) {}
    try { car = await (await import('./car.js')).createCar(world, world.carSpawn || world.spawn, carId || world.meta.car || 'i20'); world.vehicle = car; car.fov = carFov.v; }
    catch (e) { console.warn('car: ' + (e && e.message || e)); car = null; setTimeout(() => toastMsg('Car models not found (Modeleaut/) — on foot'), 3000); }
  }
  if (mapName === 'town') board = buildRaceBoard(world, BOARD_SPOT);
  player.pos.set(world.spawn.x, world.groundAt(world.spawn.x, world.spawn.z), world.spawn.z);
  player.yaw = world.spawn.yaw; player.pitch = world.spawn.pitch ?? -0.03;
  if (hour !== null) time.hour = hour;
  updateSky(true); post.exposure.value = env.exposure; post.wb.value.copy(env.wb);
  $('tSlider').value = time.hour;
  updateCamera(world); camera.updateMatrixWorld();
  await prepareWorld(world, progress);
  skipStaticWalk(scene);
  const ctx = session.capture(world, { life, car, map: mapName, disposers: car ? [() => car.dispose(), () => world.dispose && world.dispose()] : [] });
  if (mapName === 'town') { home = ctx; setTimeout(() => preload.warmShared(3), 8000); } // (what any race needs, fetched while the player walks about)
  else { raceCtx = ctx; const r = raceOfMap(mapName); raceInfo = r ? { race: r, car: car && car.id } : null; $('leaveRace').hidden = false; }
  frame();
  document.documentElement.classList.add('ingame');
  if (direct) {
    const ld = $('loading'); ld.classList.add('hidden'); setTimeout(() => ld.remove(), 900);
    $('menu').classList.remove('hidden');
  } else title.ready(enterGame);
  if (world.layer) world.layer.showProblems();
  let manualT = 0;
  window.__wl = { THREE, scene, camera, player, renderer, get world() { return world; }, time, post, setQuality, updateSky, QUALITY, Q, scatters, S,
    get car() { return car; }, game: { enterRace, goHome, openBoard, get board() { return board; }, get home() { return home; }, get raceCtx() { return raceCtx; }, get transit() { return transit; }, preload, session, selection, results, transition, get raceInfo() { return raceInfo; } }, step: (n = 1) => { for (let i = 0; i < n; i++) { manualT += 1 / 60; step(1 / 60, manualT); } }, at: t => { manualT = t; }, wind, colliderView, dbg: debugToggles(), perf, toggleOverlay, keys, builderQuery,
    // automated play-testing: act as if the pointer were locked, so keys (keys.KeyW = true ...) drive the walker
    autoplay(on = true) { started = started || on; locked = on; $('menu').classList.toggle('hidden', on); if (on && $('loading')) $('loading').remove(); } }; // console debugging hook
  if (new URLSearchParams(location.search).has('autoplay')) window.__wl.autoplay();
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
// ---------------------------------------------------------------- the race board, the races, the way home
// near the board: its prompt; walking up to it starts preparing the races in the background (preload.js)
let boardWarm = 0;
function boardStep(dt) {
  board.update(dt);
  const d = board.distance(player.pos);
  showPrompt(locked && d < 4.6 && !(car && car.driving) ? '<b>E</b>Tablica wyścigów — wybierz trasę i samochód' : null);
  if (d < 90 && boardWarm < 1) { boardWarm = 1; preload.warmShared(2); }
  if (d < 35 && boardWarm < 2) { boardWarm = 2; let id = null; try { id = localStorage.getItem('wl_raceSel'); } catch (e) {} preload.prepareStage(raceById(id) || raceById('valley'), 2); }
}
function openBoard() {
  for (const k in keys) keys[k] = false; showPrompt(null);
  if (document.pointerLockElement) document.exitPointerLock();
  selection.open({ onStart: (r, c) => enterRace(r, c), onCancel: () => enterGame(), onPick: (r, c) => preload.prepareRace(r, { car: c }, 1) }, (r, c) => preload.readiness(r, c));
}
// a race map built beside Sakuragawa (kept whole, detached), from what the preloader has made ready
async function enterRace(race, carId = race.car) {
  if (transit || !race) return; transit = true; resultsShown = false; results.hide(); showPrompt(null);
  for (const k in keys) keys[k] = false;
  if (document.pointerLockElement) document.exitPointerLock();
  $('menu').classList.add('hidden');
  const t0 = performance.now();
  try {
    await transition.show(race.name.toUpperCase(), race.kanji + ' · ' + (race.surface === 'gravel' ? 'szuter' : 'asfalt') + ' · ' + (race.length / 1000).toFixed(1) + ' km', race);
    const field = fieldFor(race), prepP = preload.prepareRace(race, { car: carId, field }, 0); // (what is still missing, first in the queue)
    if (raceCtx) releaseRace();
    if (home && home.attached) { townPose.pos.copy(player.pos); townPose.yaw = player.yaw; townPose.pitch = player.pitch; townPose.fly = player.fly; session.detach(home); }
    transition.progress(0.04, 'Kończenie przygotowań trasy');
    await prepP.catch(e => console.warn('race preparation: ' + e.message)); // (anything not ready is computed by the build itself)
    const tPrep = performance.now();
    session.begin();
    mapName = race.map;
    world = await loadWorld(race.map, { progress: (l, p) => { transition.progress(0.12 + p * 0.78, l); progress(l, p); }, race: { field, car: carId, id: race.id }, prepared: preload.stageData(race) });
    life = buildLife(world, world.meta.life || {});
    transition.progress(0.92, 'Samochód');
    car = await (await import('./car.js')).createCar(world, world.carSpawn || world.spawn, carId); world.vehicle = car; car.fov = carFov.v;
    player.fly = false; player.vy = 0; player.pos.set(world.spawn.x, world.groundAt(world.spawn.x, world.spawn.z), world.spawn.z); player.yaw = world.spawn.yaw; player.pitch = world.spawn.pitch ?? -0.03;
    updateSky(true); post.exposure.value = env.exposure; post.wb.value.copy(env.wb);
    car.applyCamera(camera, 0); camera.updateMatrixWorld();
    transition.progress(0.95, 'Kompilacja shaderów');
    await prepareWorld(world, (l, p) => transition.progress(0.95 + 0.05 * p, l));
    skipStaticWalk(scene);
    raceCtx = session.capture(world, { life, car, map: race.map, disposers: [() => car && car.dispose(), () => world && world.dispose && world.dispose()] });
    raceInfo = { race, car: carId, field, loadMs: Math.round(performance.now() - t0), prepMs: Math.round(tPrep - t0) };
    console.info(`race ${race.id}: ready in ${raceInfo.loadMs} ms (${raceInfo.prepMs} ms finishing the preparation)`, preload.state());
    syncMenu();
  } catch (e) { console.error(e); transit = false; transition.hide(); toastMsg('Wyścig nie wystartował: ' + e.message); if (!raceCtx) goHome(); return; }
  transit = false;
  transition.ready(() => { transition.hide(); enterGame(); });
}
// the race's end: the results once the player is home, the others still coming in
function raceStep(dt) {
  const st = world.race.state;
  if (st.phase !== 'finished') { resultsShown = false; finishT = 0; return; }
  finishT += dt;
  if (resultsShown) { if (results.on && world.raceAI && (finishT % 0.5) < dt) results.rows(world.raceAI.classification()); return; } // (the rivals still out there come in)
  if (finishT < 2.2) return;
  resultsShown = true;
  const race = raceInfo && raceInfo.race, rows = world.raceAI ? world.raceAI.classification() : [{ name: 'Ty', me: true, car: car.id, t: st.result }];
  const newBest = race ? saveBest(race, st.result) : false;
  if (document.pointerLockElement) document.exitPointerLock();
  results.show(race || { name: world.meta.name, length: world.track.length, id: mapName }, rows, { newBest, mine: st.result }, {
    onAgain: () => { car.reset(); resultsShown = false; enterGame(); },
    onHome: () => goHome() });
}
function releaseRace() {
  if (!raceCtx) return;
  const n = session.dispose(raceCtx, home ? [home] : []);
  console.info('race map released: ' + n.geo + ' geometries, ' + n.mat + ' materials, ' + n.tex + ' textures');
  raceCtx = null; raceInfo = null; car = null;
}
// back to Sakuragawa: the race released, the town put back as it was left (built now if the game was opened in a race)
async function goHome() {
  if (transit) return; transit = true; results.hide(); resultsShown = false;
  for (const k in keys) keys[k] = false;
  if (document.pointerLockElement) document.exitPointerLock();
  $('menu').classList.add('hidden');
  try {
    await transition.show('SAKURAGAWA', '桜川');
    releaseRace();
    mapName = 'town';
    if (home) { session.attach(home); world = home.world; life = home.life; car = home.car;
      player.pos.copy(townPose.pos); player.yaw = townPose.yaw; player.pitch = townPose.pitch; player.fly = townPose.fly; player.vy = 0; }
    else { session.begin(); world = await loadWorld('town', { progress: (l, p) => { transition.progress(p, l); progress(l, p); } }); life = buildLife(world, world.meta.life || {}); board = buildRaceBoard(world, BOARD_SPOT);
      player.pos.set(world.spawn.x, world.groundAt(world.spawn.x, world.spawn.z), world.spawn.z); player.yaw = world.spawn.yaw; player.pitch = world.spawn.pitch ?? -0.03;
      updateCamera(world); camera.updateMatrixWorld(); await prepareWorld(world, (l, p) => transition.progress(p, l)); skipStaticWalk(scene);
      home = session.capture(world, { life, car: null, map: 'town' }); }
    camera.near = 0.2; camera.fov = +$('fSlider').value || 72; camera.updateProjectionMatrix();
    updateSky(true); post.exposure.value = env.exposure; post.wb.value.copy(env.wb); updateCamera(world); camera.updateMatrixWorld();
    syncMenu();
  } catch (e) { console.error(e); toastMsg('Powrót nie powiódł się: ' + e.message); }
  transit = false;
  transition.ready(() => { transition.hide(); enterGame(); }, 'Kliknij, aby wrócić do miasta');
}
function syncMenu() {
  const city = cityOfMap(mapName);
  $('menuCity').textContent = city.name.toUpperCase();
  $('mapTitle').innerHTML = (city.kanji ? `<span class="k">${city.kanji}</span> · ` : '') + (raceCtx ? 'wyścig' : 'free roam');
  $('openBuilder').hidden = world.meta.builder === false;
  $('leaveRace').hidden = !raceCtx;
}
function boot(map, hour) {
  mapName = map;
  title.loading(cityOfMap(map));
  main(hour).catch(e => { console.error(e); document.body.insertAdjacentHTML('beforeend', `<div id="err">${e.stack || e}</div>`); });
}
title.onBuilder(async () => location.assign(await builderBase() + 'editor.html?map=town'));
if (direct) boot(direct, null);
else title.onPlay((city, hour) => boot(city.map, hour));
