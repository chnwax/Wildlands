// Performance instrumentation and the F3 overlay.
// Every frame records: the frame interval, the CPU time of the frame split by system, the GPU time split by render pass
// (EXT_disjoint_timer_query_webgl2, read back a few frames later), draw calls and triangles per pass, and the work that
// causes first-view hitches — shader programs compiled and linked, bytes uploaded to textures and buffers, JS heap growth.
// Frames over 33 ms are logged with the section that took the time.
//   perf.begin(id) / perf.end(id)   CPU-only timing of a game system (inclusive)
//   perf.push(id)  / perf.pop()     a render pass: CPU, GPU, draws and triangles, exclusive of nested passes
// Section ids come from perf.id('name'). All storage is preallocated: recording allocates nothing per frame.
import { THREE, renderer } from './core.js';

// ?perftag=1: every object added to the scene graph remembers the code that added it (userData.src), so draw calls
// and triangles can be attributed to the system that made them (diagnostics only; slows the load)
if (/[?&]perftag=1/.test(location.search)) {
  const add0 = THREE.Object3D.prototype.add;
  THREE.Object3D.prototype.add = function (...objs) {
    const st = new Error().stack.split('\n').slice(2).map(l => (l.match(/\/js\/([\w.]+):(\d+)/) || [])).filter(m => m[1] && m[1] !== 'core.js' && m[1] !== 'perf.js').slice(0, 2).map(m => m[1].replace('.js', '') + ':' + m[2]).join('<');
    for (const o of objs) if (o && !o.userData.src) o.userData.src = st;
    return add0.apply(this, objs);
  };
}

const gl = renderer.getContext(), info = renderer.info;
info.autoReset = false; // counted per frame (the composer renders several times), reset in frameStart
const tq = gl.getExtension('EXT_disjoint_timer_query_webgl2');
const now = () => performance.now();

const MAXS = 48, N = 4096;                     // sections, frames kept
const names = [], kinds = [];                  // kind: 0 system (CPU), 1 pass (CPU + GPU)
const fT = new Float64Array(N), fDt = new Float32Array(N), fCpu = new Float32Array(N), fGpu = new Float32Array(N).fill(-1);
const fCalls = new Int32Array(N), fTris = new Float64Array(N), fProg = new Int16Array(N), fLink = new Float32Array(N), fUp = new Float32Array(N), fHeap = new Float32Array(N);
const sCpu = new Float32Array(N * MAXS), sGpu = new Float32Array(N * MAXS), sCalls = new Int32Array(N * MAXS), sTris = new Float64Array(N * MAXS);
const gOut = new Int16Array(N);                // GPU queries of that frame still outstanding
let frame = -1, slot = 0, tFrame = 0, tPrev = 0, gpuOn = false;

export const perf = {
  get frame() { return frame; }, N, MAXS, names, kinds, gpuTimer: !!tq,
  id(name, kind = 0) { let i = names.indexOf(name); if (i < 0) { i = names.length; names.push(name); kinds.push(kind); } return i; },
  begin, end, push, pop, frameStart, frameEnd, stats, records, setGpu(on) { gpuOn = on && !!tq; }, get lateProgs() { return lateProgs; },
};

// ---------------------------------------------------------------- GL hooks: compiles, links, uploads (bytes), and the
// time the main thread blocks in them (a program's first use waits for its compile to finish)
let progN = 0, linkMs = 0, upBytes = 0;
{
  const wrapT = (name, fn) => { const f = gl[name].bind(gl); gl[name] = function () { const t = now(); const r = f.apply(null, arguments); linkMs += now() - t; fn && fn(arguments); return r; }; };
  wrapT('linkProgram', () => progN++); wrapT('compileShader'); wrapT('getProgramParameter'); wrapT('getShaderParameter'); wrapT('getProgramInfoLog'); wrapT('getShaderInfoLog');
  const bytesOf = a => { for (const v of a) if (v && v.byteLength !== undefined) return v.byteLength; for (const v of a) if (v && v.width) return v.width * v.height * 4; return 0; };
  for (const name of ['texImage2D', 'texSubImage2D', 'texImage3D', 'texSubImage3D', 'compressedTexImage2D', 'texStorage2D', 'bufferData', 'bufferSubData']) {
    const f = gl[name].bind(gl);
    gl[name] = function () {
      const a = arguments;
      upBytes += name === 'texStorage2D' ? 0 : name === 'bufferData' && typeof a[1] === 'number' ? 0
        : name === 'bufferSubData' && a[4] ? a[4] * a[2].BYTES_PER_ELEMENT : bytesOf(a); // (a ranged update sends only its range)
      return f.apply(null, a);
    };
  }
}

// ---------------------------------------------------------------- GPU timer queries (a pool; results arrive frames later)
const pool = [], pq = [], pf = new Int32Array(1024), ps = new Int16Array(1024); let ph = 0, pt = 0; // pending ring
function gBegin(sec) { const q = pool.pop() || gl.createQuery(); gl.beginQuery(tq.TIME_ELAPSED_EXT, q); pq[pt] = q; pf[pt] = slot; ps[pt] = sec; gOut[slot]++; }
function gEnd() { gl.endQuery(tq.TIME_ELAPSED_EXT); pt = (pt + 1) & 1023; }
function gPoll() {
  if (ph === pt) return;
  const disjoint = gl.getParameter(tq.GPU_DISJOINT_EXT);
  while (ph !== pt) {
    const q = pq[ph];
    if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
    const s = pf[ph], ms = disjoint ? 0 : gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
    sGpu[s * MAXS + ps[ph]] += ms;
    if (fGpu[s] < 0) fGpu[s] = 0;
    fGpu[s] += ms;
    if (--gOut[s] === 0 && disjoint) fGpu[s] = -2;
    pool.push(q); pq[ph] = null; ph = (ph + 1) & 1023;
  }
}

// ---------------------------------------------------------------- sections
const bT = new Float64Array(MAXS);
function begin(id) { bT[id] = now(); }
function end(id) { sCpu[slot * MAXS + id] += now() - bT[id]; }
const stack = new Int16Array(32); let sp = 0, pT = 0, pCalls = 0, pTris = 0, gActive = false;
function flushTop(t) { const s = stack[sp - 1], k = slot * MAXS + s; sCpu[k] += t - pT; sCalls[k] += info.render.calls - pCalls; sTris[k] += info.render.triangles - pTris; if (gActive) { gEnd(); gActive = false; } }
function openTop(t) { pT = t; pCalls = info.render.calls; pTris = info.render.triangles; if (gpuOn && frame >= 0) { gBegin(stack[sp - 1]); gActive = true; } }
function push(id) { const t = now(); if (sp > 0) flushTop(t); stack[sp++] = id; openTop(t); }
function pop() { const t = now(); flushTop(t); sp--; if (sp > 0) openTop(t); }

// ---------------------------------------------------------------- frames
let heapPrev = 0;
function frameStart() {
  const t = now();
  if (tq) gPoll();
  frame++; slot = frame % N;
  fT[slot] = t; fDt[slot] = frame > 0 ? t - tPrev : 0; tPrev = t; tFrame = t;
  fGpu[slot] = -1; gOut[slot] = 0;
  sCpu.fill(0, slot * MAXS, slot * MAXS + MAXS); sGpu.fill(0, slot * MAXS, slot * MAXS + MAXS); sCalls.fill(0, slot * MAXS, slot * MAXS + MAXS); sTris.fill(0, slot * MAXS, slot * MAXS + MAXS);
  info.reset(); progN = 0; linkMs = 0; upBytes = 0;
}
// programs linked mid-game are logged by name (they should all have been built by the load-time warm-up)
const knownProgs = new Set(); export const lateProgs = [];
function frameEnd() {
  fCpu[slot] = now() - tFrame;
  if ((progN || frame < 2) && info.programs) for (const p of info.programs) if (!knownProgs.has(p)) { knownProgs.add(p); if (frame >= 2) lateProgs.push({ frame, name: p.name, key: String(p.cacheKey).slice(0, 240) }); }
  fCalls[slot] = info.render.calls; fTris[slot] = info.render.triangles; fProg[slot] = progN; fLink[slot] = linkMs; fUp[slot] = upBytes;
  const hp = performance.memory ? performance.memory.usedJSHeapSize : 0; fHeap[slot] = hp - heapPrev; heapPrev = hp;
  if (overlay && fDt[slot] > 33.4 && frame > 2) logHitch(slot);
}

// ---------------------------------------------------------------- statistics over a time window (ms)
function framesIn(win) { const out = []; const t1 = fT[frame % N]; for (let f = frame; f > Math.max(0, frame - N + 1); f--) { const s = f % N; if (t1 - fT[s] > win) break; out.push(s); } return out; }
function pct(arr, p) { const a = Float32Array.from(arr).sort(); return a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : 0; }
function stats(win = 1000) {
  const S = framesIn(win); if (!S.length) return null;
  let sum = 0, worst = 0, cpu = 0, gpu = 0, gn = 0, calls = 0, tris = 0, up = 0, heap = 0; const dts = [];
  const done = s => fGpu[s] >= 0 && gOut[s] === 0; // GPU time only from frames whose queries have all resolved
  for (const s of S) { const d = fDt[s]; sum += d; worst = Math.max(worst, d); dts.push(d); cpu += fCpu[s]; if (done(s)) { gpu += fGpu[s]; gn++; } calls += fCalls[s]; tris += fTris[s]; up += fUp[s]; heap += Math.max(0, fHeap[s]); }
  const n = S.length, sec = names.map((nm, i) => { let c = 0, g = 0, k = 0, t = 0; for (const s of S) { c += sCpu[s * MAXS + i]; if (done(s)) g += sGpu[s * MAXS + i]; k += sCalls[s * MAXS + i]; t += sTris[s * MAXS + i]; } return { name: nm, kind: kinds[i], cpu: c / n, gpu: gn ? g / gn : 0, calls: k / n, tris: t / n }; });
  return { frames: n, avg: sum / n, fps: 1000 * n / Math.max(sum, 1e-3), worst, p99: pct(dts, 0.99), cpu: cpu / n, gpu: gn ? gpu / gn : -1, calls: calls / n, tris: tris / n,
    upMB: up / n / 1048576, heapMBs: heap / (sum / 1000) / 1048576, sec };
}
// raw per-frame records from frame f0 on (for the test harness)
function records(f0 = 0) {
  const out = [];
  for (let f = Math.max(f0, frame - N + 1); f <= frame; f++) {
    const s = f % N, sec = {};
    for (let i = 0; i < names.length; i++) { const c = sCpu[s * MAXS + i], g = sGpu[s * MAXS + i]; if (c > 0.005 || g > 0.005 || sCalls[s * MAXS + i]) sec[names[i]] = [+c.toFixed(3), +g.toFixed(3), sCalls[s * MAXS + i], Math.round(sTris[s * MAXS + i])]; }
    out.push({ f, t: +fT[s].toFixed(2), dt: +fDt[s].toFixed(2), cpu: +fCpu[s].toFixed(2), gpu: gOut[s] === 0 ? +fGpu[s].toFixed(2) : -1, calls: fCalls[s], tris: Math.round(fTris[s]), prog: fProg[s], link: +fLink[s].toFixed(2), up: Math.round(fUp[s]), heap: Math.round(fHeap[s]), sec });
  }
  return out;
}

// ---------------------------------------------------------------- overlay (F3)
let overlay = null, lastDraw = 0;
const hitches = [];
function logHitch(s) {
  let top = '', topMs = 0;
  for (let i = 0; i < names.length; i++) { const c = sCpu[s * MAXS + i]; if (c > topMs) { topMs = c; top = names[i]; } }
  const cause = fProg[s] ? `${fProg[s]} shader program(s), ${fLink[s].toFixed(0)} ms blocked` : fUp[s] > 4e6 ? `${(fUp[s] / 1048576).toFixed(1)} MB uploaded` : `${top} ${topMs.toFixed(1)} ms`;
  hitches.unshift(`${(fT[s] / 1000).toFixed(1).padStart(7)} s ${fDt[s].toFixed(0).padStart(4)} ms  cpu ${fCpu[s].toFixed(0)}  ${cause}`);
  hitches.length = Math.min(hitches.length, 8);
}
function draw() {
  const a = stats(1000), b = stats(10000); if (!a) return;
  const f = (v, d = 1, w = 6) => v.toFixed(d).padStart(w);
  // the CPU figure includes time the main thread waits on the GPU (command-buffer back-pressure), so the verdict
  // compares each side with the frame time: a GPU busy for most of the frame is the limit, whatever the CPU shows
  const res = renderer.getDrawingBufferSize(_v2), bound = a.gpu < 0 ? '' : a.gpu > 0.85 * a.avg ? 'GPU-bound' : a.cpu > 0.85 * a.avg ? 'CPU-bound' : 'mixed';
  const L = [
    `FPS ${f(a.fps, 0, 4)}   frame avg ${f(a.avg, 2)} ms  worst ${f(a.worst, 1)} ms`,
    `1% low ${f(1000 / Math.max(b.p99, 1e-3), 0, 4)} fps (10 s)   worst 10 s ${f(b.worst, 1)} ms`,
    `CPU ${f(a.cpu, 2)} ms   GPU ${a.gpu < 0 ? (tq ? '  ...' : '  n/a') : f(a.gpu, 2)} ms   ${bound}`,
    `draws ${f(a.calls, 0, 5)}  tris ${f(a.tris / 1e6, 2, 5)} M   ${res.x}x${res.y}`,
    `geometries ${info.memory.geometries}  textures ${info.memory.textures}  programs ${info.programs ? info.programs.length : 0}`,
    `uploads ${f(a.upMB, 2, 5)} MB/frame   heap +${f(a.heapMBs, 1, 4)} MB/s`,
    '',
    'section              CPU ms   GPU ms   draws    tris',
  ];
  const rows = a.sec.filter(s => s.cpu > 0.01 || s.gpu > 0.01 || s.calls > 0).sort((x, y) => y.kind - x.kind || Math.max(y.cpu, y.gpu) - Math.max(x.cpu, x.gpu));
  for (const s of rows) L.push(`${s.name.padEnd(19)} ${f(s.cpu, 2, 7)}  ${s.kind ? f(s.gpu, 2, 7) : '      -'}  ${s.kind ? f(s.calls, 0, 6) : '     -'}  ${s.kind ? (s.tris / 1e6).toFixed(2).padStart(5) + 'M' : ''}`);
  if (hitches.length) { L.push('', 'hitches > 33 ms'); L.push(...hitches); }
  overlay.textContent = L.join('\n');
}
const _v2 = new THREE.Vector2();
function loop() { if (!overlay) return; requestAnimationFrame(loop); const t = now(); if (t - lastDraw > 250) { lastDraw = t; draw(); } }
export function toggleOverlay(on = !overlay) {
  if (on && !overlay) {
    overlay = document.createElement('pre');
    overlay.style.cssText = 'position:fixed;left:10px;top:10px;margin:0;padding:8px 10px;background:rgba(6,8,10,.78);color:#e8f0e0;font:11.5px/1.35 Consolas,monospace;z-index:50;pointer-events:none;white-space:pre;border-radius:4px';
    document.body.appendChild(overlay); perf.setGpu(true); loop();
  } else if (!on && overlay) { overlay.remove(); overlay = null; perf.setGpu(false); }
  return !!overlay;
}
