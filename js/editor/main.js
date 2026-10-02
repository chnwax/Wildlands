// Wildlands world editor: boot and main loop. The world is built and drawn by the same code as the game (engine.js),
// without its simulation: no player, traffic, trains, pedestrians, ambient life or audio. Time of day stands still and
// is set from the toolbar.
import { THREE, renderer, scene, camera, S, Q, QUALITY, loadState, manager, wind } from '../core.js';
import { time, updateSky } from '../sky.js';
import { perf, toggleOverlay } from '../perf.js';
import { mapFromURL, loadWorld, prepareWorld, renderWorld, setQuality } from '../engine.js';
import { EditorCamera } from './camera.js';
import { ui, el, toast } from './ui.js';
import { startWorkspace, regenerate } from './workspace.js';
import { io } from './io.js';
import { keepArrays } from '../townkit.js';

const mapName = mapFromURL();
const $ = id => document.getElementById(id);
renderer.domElement.tabIndex = 0;
document.body.prepend(renderer.domElement);
time.running = false;

// ---------------------------------------------------------------- loading screen
function showProgress() {
  const p = loadState.gen * 0.6 + loadState.assets * 0.4;
  $('loadBar').style.width = (p * 100).toFixed(1) + '%';
  $('loadText').textContent = loadState.label + (loadState.assets < 1 ? ` · assets ${Math.round(loadState.assets * 100)}%` : '');
}
const progress = (label, p) => { loadState.label = label; loadState.gen = p; showProgress(); };
manager.onProgress = (url, a, b) => { loadState.assets = a / b; showProgress(); };

// ---------------------------------------------------------------- state shared by the editor modules
export const ed = { world: null, map: mapName, cam: null, frameMs: 16, fps: 0 };
window.__ed = ed; // console / automation hook

const clock = new THREE.Clock();
let fpsAcc = 0, fpsN = 0, lastStatus = 0;
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.1), t = clock.elapsedTime;
  perf.frameStart();
  ed.cam.update(dt);
  wind.update(dt, t, false); // (scenery sways as in the game; nothing simulates)
  for (const f of ui.beforeFrame) f(dt);
  renderWorld(ed.world, dt, t, { yaw: ed.cam.yaw, afterRender: () => { for (const f of ui.afterRender) f(dt); } });
  perf.frameEnd();
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { ed.fps = Math.round(fpsN / fpsAcc); ed.frameMs = fpsAcc / fpsN * 1000; fpsAcc = 0; fpsN = 0; ui.refreshStatus(); }
}

const REGEN = new URLSearchParams(location.search).has('regenerate');
async function main() {
  keepArrays.on = true; // the editor reads and rewrites objects inside the merged buffers
  ed.world = await loadWorld(mapName, { progress, editor: true });
  if (REGEN) { // tools/regenerate-world.mjs: write the generator's output and report back
    progress('Writing generated world files', 1); await io.init();
    const r = await regenerate(ed, null, true);
    document.getElementById('loadText').textContent = `Regenerated: ${(r.files || []).filter(f => f.written).length} file(s) written`;
    return;
  }
  const w = ed.world;
  ed.cam = new EditorCamera(renderer.domElement, { groundAt: (x, z) => w.groundAt(x, z), pickPoint: (x, y) => ui.pickPoint ? ui.pickPoint(x, y) : null });
  // start above the game's spawn, looking down onto it
  const s = w.spawn, gy = w.groundAt(s.x, s.z);
  ed.cam.place(s.x + Math.sin(s.yaw) * 40, gy + 32, s.z + Math.cos(s.yaw) * 40, s.yaw, -0.55, 60);
  try { const v = JSON.parse(sessionStorage.getItem('wl_ed_view_' + mapName) || 'null'); if (v && v.p) ed.cam.state = v; } catch (e) {}
  updateSky(true);
  await prepareWorld(w, progress);
  ui.init(ed);
  await startWorkspace(ed);
  frame();
  $('app').classList.remove('hidden');
  $('loading').classList.add('gone'); setTimeout(() => $('loading').remove(), 600);
  addEventListener('beforeunload', () => { try { sessionStorage.setItem('wl_ed_view_' + mapName, JSON.stringify(ed.cam.state)); } catch (e) {} });
}
main().catch(e => { console.error(e); const t = $('loadText'); if (t) { t.classList.add('err'); t.textContent = 'The editor could not load the world:\n' + (e.stack || e); } });
export { THREE, scene, camera, S, Q, QUALITY, setQuality, toggleOverlay, time, updateSky, el, toast };
