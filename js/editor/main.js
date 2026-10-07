// Wildlands world editor: boot and main loop. The world is built and drawn by the same code as the game (engine.js),
// without its simulation: no player, traffic, trains, pedestrians, ambient life or audio. Time of day stands still and
// is set from the toolbar.
import { THREE, renderer, scene, camera, S, Q, QUALITY, loadState, manager, wind, clamp } from '../core.js';
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
// ?from=game&cam=x,y,z&yaw=&pitch=&fov=&hour= (js/main.js openBuilderHere): place the camera there, or null
function arriveFromGame(w) {
  const q = new URLSearchParams(location.search);
  if (q.get('from') !== 'game') return null;
  const num = k => { const v = q.get(k); return v === null || v === '' ? NaN : +v; };
  const cam = (q.get('cam') || '').split(',').map(v => v === '' ? NaN : +v), yaw = num('yaw'), pitch = num('pitch'), fov = num('fov'), hour = num('hour');
  for (const k of ['from', 'cam', 'yaw', 'pitch', 'fov', 'hour', 'feet']) q.delete(k);
  try { history.replaceState(history.state, '', location.pathname + '?' + q + location.hash); } catch (e) {}
  if (cam.length !== 3 || !cam.every(Number.isFinite) || !Number.isFinite(yaw) || !Number.isFinite(pitch)) { toast('The position sent from the game was incomplete: the editor opened at its last view', 'warn', 4000); return null; }
  let [x, y, z] = cam, note = null;
  const ext = 6000; // (both maps lie well inside ±6 km)
  if (Math.abs(x) > ext || Math.abs(z) > ext || Math.abs(y) > 3000) { toast('The position sent from the game is outside the map: the editor opened at its last view', 'warn', 4000); return null; }
  const g = w.groundAt(x, z);
  if (Number.isFinite(g) && y < g + 0.35) { y = g + 0.35; note = `Arrived from the game (lifted above the ground) at ${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}`; }
  if (Number.isFinite(fov)) { camera.fov = clamp(fov, 30, 120); camera.updateProjectionMatrix(); }
  if (Number.isFinite(hour)) time.hour = ((hour % 24) + 24) % 24;
  const A = { x, y, z, yaw, pitch: clamp(pitch, -1.55, 1.55), dist: 8, note };
  ed.cam.place(A.x, A.y, A.z, A.yaw, A.pitch, A.dist);
  return A;
}
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
  // Arrival from the game (its B key / World Builder button): the exact camera position and view direction in the URL.
  // It is applied after the remembered editor view, so it wins; the parameters are then taken out of the address so a
  // later reload returns to wherever the editor camera has been moved since (the remembered view) instead.
  const arrived = arriveFromGame(w);
  updateSky(true);
  await prepareWorld(w, progress);
  ui.init(ed);
  await startWorkspace(ed);
  if (arrived) {
    // (nothing during start-up may move the camera: re-place it exactly, then report where it is)
    ed.cam.place(arrived.x, arrived.y, arrived.z, arrived.yaw, arrived.pitch, arrived.dist);
    toast(arrived.note || `Arrived from the game at ${[arrived.x, arrived.y, arrived.z].map(v => v.toFixed(1)).join(', ')}`, arrived.note ? 'warn' : 'ok', 3500);
  }
  frame();
  $('app').classList.remove('hidden');
  $('loading').classList.add('gone'); setTimeout(() => $('loading').remove(), 600);
  addEventListener('beforeunload', () => { try { sessionStorage.setItem('wl_ed_view_' + mapName, JSON.stringify(ed.cam.state)); } catch (e) {} });
}
main().catch(e => { console.error(e); const t = $('loadText'); if (t) { t.classList.add('err'); t.textContent = 'The editor could not load the world:\n' + (e.stack || e); } });
export { THREE, scene, camera, S, Q, QUALITY, setQuality, toggleOverlay, time, updateSky, el, toast };
