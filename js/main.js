// Boot, UI, and main loop. Map is chosen with ?map=nature|town.
import { THREE, renderer, scene, camera, S, Q, QUALITY, pixelRatio, loadState, manager, scatters, clamp, smoothstep, tick } from './core.js';
import { time, updateSky, followCamera, env, applyShadowQuality, sky } from './sky.js';
import { post, buildComposer, updateRays } from './post.js';
import { audio, Emitter } from './audio.js';
import { player, keys, updatePlayer, updateCamera } from './player.js';
import { $, toastMsg } from './ui.js';
import { buildLife } from './life.js';
import { flattenPhotoMaterials } from './toon.js';

const MAPS = { nature: () => import('./nature.js'), town: () => import('./town.js') };
const mapName = MAPS[new URLSearchParams(location.search).get('map')] ? new URLSearchParams(location.search).get('map') : 'nature';
document.body.prepend(renderer.domElement);
document.querySelectorAll('[data-map]').forEach(b => {
  b.classList.toggle('active', b.dataset.map === mapName);
  b.addEventListener('click', () => { if (b.dataset.map !== mapName) location.search = '?map=' + b.dataset.map; });
});

let world = null, life = null, started = false, locked = false, hudOn = true;

// ---------------------------------------------------------------- graphics safety net
// A shader this GPU cannot compile or link silently draws nothing (e.g. one that needs more textures than the GPU
// allows). Failed programs are collected; materials that offer a simpler fallback are swapped in on the next frame,
// and the player is told which GPU struggled so the problem can be reported.
const failedPrograms = new Set();
const gl0 = renderer.getContext(), dbgInfo = gl0.getExtension('WEBGL_debug_renderer_info');
const gpuName = dbgInfo ? gl0.getParameter(dbgInfo.UNMASKED_RENDERER_WEBGL) : gl0.getParameter(gl0.RENDERER);
console.info(`Wildlands · GPU: ${gpuName} · textures per shader: ${gl0.getParameter(gl0.MAX_TEXTURE_IMAGE_UNITS)} · WebGL ${renderer.capabilities.isWebGL2 ? 2 : 1}`);
renderer.debug.onShaderError = (gl, program, vs, fs) => {
  failedPrograms.add(program);
  const log = [gl.getProgramInfoLog(program), gl.getShaderInfoLog(vs), gl.getShaderInfoLog(fs)].map(x => (x || '').trim()).filter(Boolean).join('\n');
  console.error('Wildlands: a shader could not be built on this GPU (' + gpuName + ')\n' + log);
};
function gfxNote(html) {
  let el = document.getElementById('gfxNote');
  if (!el) { el = document.createElement('div'); el.id = 'gfxNote'; el.title = 'click to hide'; el.onclick = () => el.remove(); document.body.appendChild(el); }
  el.innerHTML = html;
}
function repairShaders() {
  const swaps = new Map(); let fixed = 0, broken = 0;
  scene.traverse(o => {
    const m = o.material; if (!m || Array.isArray(m)) return;
    const pr = renderer.properties.get(m).currentProgram;
    if (!pr || !failedPrograms.has(pr.program)) return;
    if (m.userData.fallback) { if (!swaps.has(m)) swaps.set(m, m.userData.fallback()); o.material = swaps.get(m); fixed++; } else broken++;
  });
  failedPrograms.clear();
  if (fixed || broken) gfxNote(`<b>Graphics:</b> ${fixed ? 'your GPU could not run the detailed ground shader, so a simpler painted ground is used.' : ''}
    ${broken ? `${broken} object(s) could not be drawn on this GPU.` : ''}<br><small>${gpuName} · details in the browser console (F12)</small>`);
}
const clock = new THREE.Clock();
let fpsAcc = 0, fpsN = 0, ambTimer = 0, amb = {};

function showProgress() {
  const p = loadState.gen * 0.6 + loadState.assets * 0.4;
  $('loadBar').style.width = (p * 100).toFixed(1) + '%';
  $('loadText').textContent = loadState.label + (loadState.assets < 1 ? ` · loading assets ${Math.round(loadState.assets * 100)}%` : '');
}
const progress = (label, p) => { if (label !== loadState.label) console.debug('stage: ' + label); loadState.label = label; loadState.gen = p; showProgress(); };
manager.onProgress = (url, a, b) => { loadState.assets = a / b; showProgress(); };

function setQuality(name) {
  if (!QUALITY[name]) return;
  Object.assign(Q, QUALITY[name], { name });
  try { localStorage.setItem('wl_quality', name); } catch (e) {}
  renderer.setPixelRatio(pixelRatio());
  applyShadowQuality();
  scene.traverse(o => { if (o.userData.applyQuality) o.userData.applyQuality(); if (o.material && o.material.alphaToCoverage !== undefined && o.material.alphaTest > 0) { const a = Q.msaa > 0; if (o.material.alphaToCoverage !== a) { o.material.alphaToCoverage = a; o.material.needsUpdate = true; } } });
  buildComposer();
  if (world && world.water) world.water.userData.resize();
  $('qSel').value = name;
  toastMsg('Quality: ' + name.toUpperCase());
}

function step(dt, t) {
  if (dbgState.still) t = dbgState.still; else S.uTime.value = t;
  if (time.running && started) time.hour = (time.hour + dt * time.speed) % 24;
  updateSky(false);
  post.exposure.value = env.exposure; post.wb.value.copy(env.wb);
  const wind = 0.55 + 0.3 * Math.sin(t * 0.07) + 0.2 * Math.sin(t * 0.23 + 1.3) * Math.sin(t * 0.11);
  S.uWind.value = dbgState.still ? 0 : wind;
  if (locked && started) updatePlayer(world, dt);
  if (!started && !dbgState.pause) player.yaw += dt * 0.02;
  updateCamera(world);
  camera.updateMatrixWorld();
  S.uCam.value.copy(camera.position);
  S.uPlayer.value.copy(player.pos);
  S.uSunViewDir.value.copy(S.uSunDir.value).transformDirection(camera.matrixWorldInverse);
  for (const s of scatters) s.update(camera.position.x, camera.position.z);
  followCamera((x, z) => world.groundAt(x, z), player.yaw);
  if (world.water) world.water.position.set(Math.round(camera.position.x), world.water.position.y, Math.round(camera.position.z));
  world.update(dbgState.still ? 0 : dt, t, camera);
  life.update(t, time.hour);
  const wl = world.waterAt(camera.position.x, camera.position.z);
  const under = camera.position.y < wl - 0.05 && world.groundAt(camera.position.x, camera.position.z) < wl;
  post.grade.uniforms.uTime.value = t; post.grade.uniforms.uUnder.value = under ? 1 : 0;
  updateRays(S.uSunDir.value, S.uSunCol.value, env.day);
  ambTimer -= dt;
  if (ambTimer < 0) { ambTimer = 0.4; amb = world.ambience(player.pos.x, player.pos.z); }
  audio.listen(camera);
  audio.update(dt, { wind, ...amb, day: env.day, night: env.night, fly: player.fly, under });
  for (const e of audio.emitters) e.update(dt);
  post.composer.render(dt);
  if (failedPrograms.size) repairShaders();
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
  progress('Preparing', 0.02); await tick();
  const mod = await MAPS[mapName]();
  $('mapTitle').textContent = 'free roam · ' + mod.meta.name;
  time.hour = mod.meta.startHour; env.azimuth = mod.meta.sunAzimuth ?? env.azimuth;
  world = await mod.build(progress);
  life = buildLife(world, mod.meta.life || {});
  flattenPhotoMaterials();
  const texDone = new Promise(res => { if (loadState.assets >= 1) res(); const prev = manager.onLoad; manager.onLoad = () => { prev && prev(); res(); }; setTimeout(res, 30000); });
  progress('Finishing', 0.97); await texDone;
  buildComposer();
  player.pos.set(world.spawn.x, world.groundAt(world.spawn.x, world.spawn.z), world.spawn.z);
  player.yaw = world.spawn.yaw; player.pitch = world.spawn.pitch ?? -0.03;
  updateSky(true); post.exposure.value = env.exposure; post.wb.value.copy(env.wb);
  updateCamera(world); camera.updateMatrixWorld();
  for (const s of scatters) s.update(camera.position.x, camera.position.z);
  progress('Compiling shaders', 1); await tick();
  renderer.compile(scene, camera);
  frame();
  const ld = $('loading'); ld.classList.add('hidden'); setTimeout(() => ld.remove(), 900);
  $('menu').classList.remove('hidden');
  let manualT = 0;
  window.__wl = { THREE, scene, camera, player, renderer, world, time, post, setQuality, updateSky, QUALITY,
    step: (n = 1) => { for (let i = 0; i < n; i++) { manualT += 1 / 60; step(1 / 60, manualT); } }, dbg: debugToggles() }; // console debugging hook
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
