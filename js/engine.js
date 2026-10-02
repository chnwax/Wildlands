// World loading and rendering shared by the game (main.js) and the world editor (editor/main.js): both build the map
// with the same code, apply the same world data (world/<map>/edits) and draw it through the same pipeline. Only the
// game adds the player, ambient life, audio and the simulation (traffic, trains, pedestrians).
import { THREE, renderer, scene, camera, S, Q, QUALITY, pixelRatio, loadState, manager, scatters, tick, shareShadowDepth, swapMaterials, ownInstanceGeometry, freezeStatic, singlePassFlat, indexInstanced } from './core.js';
import { time, updateSky, followCamera, env, applyShadowQuality, prepareShadowCache } from './sky.js';
import { post, buildComposer, updateRays } from './post.js';
import { flattenPhotoMaterials } from './toon.js';
import { perf } from './perf.js';

export const MAPS = { nature: () => import('./nature.js'), town: () => import('./town.js') };
export const mapFromURL = () => { const m = new URLSearchParams(location.search).get('map'); return MAPS[m] ? m : 'nature'; };

// ---------------------------------------------------------------- graphics safety net
// A shader this GPU cannot compile or link silently draws nothing (e.g. one that needs more textures than the GPU
// allows). Failed programs are collected; materials that offer a simpler fallback are swapped in on the next frame,
// and the player is told which GPU struggled so the problem can be reported.
const failedPrograms = new Set();
const gl0 = renderer.getContext(), dbgInfo = gl0.getExtension('WEBGL_debug_renderer_info');
export const gpuName = dbgInfo ? gl0.getParameter(dbgInfo.UNMASKED_RENDERER_WEBGL) : gl0.getParameter(gl0.RENDERER);
console.info(`Wildlands · GPU: ${gpuName} · textures per shader: ${gl0.getParameter(gl0.MAX_TEXTURE_IMAGE_UNITS)} · WebGL ${renderer.capabilities.isWebGL2 ? 2 : 1}`);
renderer.debug.onShaderError = (gl, program, vs, fs) => {
  failedPrograms.add(program);
  const log = [gl.getProgramInfoLog(program), gl.getShaderInfoLog(vs), gl.getShaderInfoLog(fs)].map(x => (x || '').trim()).filter(Boolean).join('\n');
  console.error('Wildlands: a shader could not be built on this GPU (' + gpuName + ')\n' + log);
};
export function gfxNote(html) {
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

// ---------------------------------------------------------------- quality
export function setQuality(name, world) {
  if (!QUALITY[name]) return false;
  Object.assign(Q, QUALITY[name], { name });
  try { localStorage.setItem('wl_quality', name); } catch (e) {}
  renderer.setPixelRatio(pixelRatio());
  applyShadowQuality();
  scene.traverse(o => { if (o.userData.applyQuality) o.userData.applyQuality(); if (o.material && o.material.alphaToCoverage !== undefined && o.material.alphaTest > 0) { const a = Q.msaa > 0; if (o.material.alphaToCoverage !== a) { o.material.alphaToCoverage = a; o.material.needsUpdate = true; } } });
  buildComposer();
  if (world && world.water) world.water.userData.resize();
  return true;
}

// ---------------------------------------------------------------- loading
// progress(label, fraction) is called while the map builds; opts.editor builds the map for the editor (no simulation)
export async function loadWorld(mapName, { progress = () => {}, editor = false } = {}) {
  progress('Preparing', 0.02); await tick();
  const mod = await MAPS[mapName]();
  time.hour = mod.meta.startHour; env.azimuth = mod.meta.sunAzimuth ?? env.azimuth;
  const world = await mod.build(progress, { editor, map: mapName });
  world.meta = mod.meta; world.mapName = mapName;
  return world;
}
// after the map (and the game's ambient life) is built: textures, composer, scene preparation, shader compilation and
// the warm-up draw. view: {x, z, yaw} the camera starts from (scatter LOD and shadow cascades are placed for it)
export async function prepareWorld(world, progress = () => {}) {
  flattenPhotoMaterials();
  const texDone = new Promise(res => { if (loadState.assets >= 1) res(); const prev = manager.onLoad; manager.onLoad = () => { prev && prev(); res(); }; setTimeout(res, 30000); });
  progress('Finishing', 0.97); await texDone;
  buildComposer();
  camera.updateMatrixWorld();
  for (const s of scatters) s.update(camera.position.x, camera.position.z);
  indexInstanced(scene); shareShadowDepth(scene); singlePassFlat(scene); ownInstanceGeometry(scene); freezeStatic(scene); prepareShadowCache(scene);
  progress('Compiling shaders', 1); await tick();
  // KHR_parallel_shader_compile: the GPU process compiles every program side by side instead of one blocking call each
  await renderer.compileAsync(scene, camera);
  await warmup(world);
}

// ---------------------------------------------------------------- warm-up
// Everything is drawn once, in every pass it can appear in, before the first real frame. compileAsync only prepares
// what is visible from the spawn with the scene pass's settings; the rest (far LOD levels, detail that appears on
// approach, night-only objects, the shadow and mirror passes, the render-target formats ANGLE builds its D3D shader
// variants for) would otherwise compile, link and upload its textures in the frame it is first seen — the 100–250 ms
// hitches when walking into a new area. The pass runs at a tiny internal resolution: shader variants depend on the
// target formats and sample counts, not on the size.
async function warmup(world) {
  const shown = [], unculled = [];
  scene.traverse(o => {
    if (!o.visible && !o.userData.editorHidden) { shown.push(o); o.visible = true; }
    if ((o.isMesh || o.isPoints || o.isLine) && o.frustumCulled) { unculled.push(o); o.frustumCulled = false; }
  });
  // stand-ins for the materials objects switch to later (same geometry, so the same vertex layout)
  const standIns = [], swapSeen = new Set();
  for (const [mesh, mats] of swapMaterials) for (const m of mats) {
    if (swapSeen.has(m) || m === mesh.material) continue; swapSeen.add(m);
    const p = new THREE.Mesh(mesh.geometry, m); p.frustumCulled = false; p.castShadow = mesh.castShadow; p.receiveShadow = mesh.receiveShadow; p.layers.mask = mesh.layers.mask;
    scene.add(p); standIns.push(p);
  }
  const pr = renderer.getPixelRatio();
  renderer.setPixelRatio(Math.max(0.1, 192 / innerWidth)); buildComposer();
  for (const l of scene.children) if (l.isDirectionalLight && l.castShadow) l.shadow.needsUpdate = true;
  post.composer.render(0); await tick(); // scene pass, shadow maps, post chain
  if (world.water && world.water.userData.renderReflection) { world.water.userData.renderReflection(renderer, scene, camera, true); await tick(); }
  for (const o of shown) o.visible = false;
  for (const o of unculled) o.frustumCulled = true;
  for (const p of standIns) scene.remove(p);
  renderer.setPixelRatio(pr); buildComposer();
  followCamera((x, z) => world.groundAt(x, z), camera.rotation.y); // places the cascades: the cached far ones get their static maps now
  post.composer.render(0); await tick(); // the full-size targets once
}

// ---------------------------------------------------------------- one frame
// The camera must already be placed for this frame. The sky and the lighting follow time.hour; afterWorld runs after
// world.update, before the frame is drawn (the game's ambient life and audio), afterRender after the composer (the
// editor's overlays).
export const P_IDS = { sky: perf.id('sky + shadow fit'), scat: perf.id('vegetation LOD'), world: perf.id('world (total)'), render: perf.id('post (misc)', 1) };
export function renderWorld(world, dt, t, { yaw = camera.rotation.y, still = false, afterWorld = null, afterRender = null } = {}) {
  if (!still) S.uTime.value = t;
  perf.begin(P_IDS.sky);
  updateSky(false);
  post.exposure.value = env.exposure; post.wb.value.copy(env.wb);
  perf.end(P_IDS.sky);
  camera.updateMatrixWorld();
  S.uCam.value.copy(camera.position);
  S.uSunViewDir.value.copy(S.uSunDir.value).transformDirection(camera.matrixWorldInverse);
  perf.begin(P_IDS.scat);
  for (const s of scatters) s.update(camera.position.x, camera.position.z);
  perf.end(P_IDS.scat);
  perf.begin(P_IDS.sky);
  followCamera((x, z) => world.groundAt(x, z), yaw);
  perf.end(P_IDS.sky);
  if (world.water) world.water.position.set(Math.round(camera.position.x), world.water.position.y, Math.round(camera.position.z));
  perf.begin(P_IDS.world);
  world.update(still ? 0 : dt, t, camera);
  if (world.layer) world.layer.update(camera);
  perf.end(P_IDS.world);
  if (afterWorld) afterWorld();
  updateRays(S.uSunDir.value, S.uSunCol.value, env.day);
  scene.updateMatrixWorld(); // once per frame for every pass (scene.matrixWorldAutoUpdate is off, core.js freezeStatic)
  perf.push(P_IDS.render);
  post.composer.render(dt);
  perf.pop();
  if (afterRender) afterRender();
  if (failedPrograms.size) repairShaders();
}
