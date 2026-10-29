// The race preloader: a race map made ready before it is asked for, so the start of a race is a short wait for what is
// left, not a whole map's load.
//  - stage data: the heavy, pure part of a stage (the line, the distance field, the graded ground, the masks: stagedata.js)
//    is computed in a worker (prep.worker.js) while the player is still in Sakuragawa. Two stages at most are kept (the
//    one asked for last and the one before); a third pushes the oldest out
//  - shared assets: the cars' models, the driver's arms, the co-driver's recording, the packs' trees and rocks, the
//    spectators, the stage's photo textures — fetched and decoded once a session into the engine's shared caches
//    (core.js, car.js, packs.js, crowd.js, rally.js), never fetched twice and never released with a map
//  - the GPU: textures that have arrived are uploaded one per frame while the frame has time to spare, so a texture is
//    already in video memory when the race map first draws it
// Jobs run by priority (0 the race about to start, 1 the race picked on the board, 2 the board's other races, 3 what any
// race needs, fetched while the player walks about), a few at a time, so the town keeps its frame rate.
import { renderer, phTex, NFLAT } from './core.js';
import { RACES, raceById, stageModule } from './races.js';

const MAX_STAGES = 2;
const stages = new Map();     // race id -> { p: Promise, data, ms, at }
const queue = [];              // { key, pri, run, res, rej }
const running = new Set();
const uploads = [];            // textures waiting for the GPU
let worker = null, workerFails = 0, seq = 0;
const pending = new Map();     // worker job id -> { res, rej }
const done = new Map();        // asset key -> Promise
const settled = new Set();     // asset keys finished
export const stats = { stagesPrepared: 0, stageMs: [], uploads: 0, assets: 0, failed: 0 };

function getWorker() {
  if (worker || workerFails > 2 || typeof Worker === 'undefined') return worker;
  try {
    worker = new Worker(new URL('./prep.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = e => { const p = pending.get(e.data.id); if (!p) return; pending.delete(e.data.id); e.data.ok ? p.res(e.data) : p.rej(new Error(e.data.error)); };
    worker.onerror = e => { console.warn('prep worker: ' + (e.message || e)); workerFails++; for (const p of pending.values()) p.rej(new Error('worker failed')); pending.clear(); worker.terminate(); worker = null; };
  } catch (e) { console.warn('prep worker unavailable: ' + e.message); workerFails = 9; worker = null; }
  return worker;
}
const inWorker = (path, name) => new Promise((res, rej) => { const w = getWorker(); if (!w) return rej(new Error('no worker')); const id = ++seq; pending.set(id, { res, rej }); w.postMessage({ id, path, name }); });

// ---------------------------------------------------------------- the queue
function pump() {
  queue.sort((a, b) => a.pri - b.pri);
  while (queue.length && (running.size < 3 || queue[0].pri === 0)) {
    const j = queue.shift(); running.add(j);
    Promise.resolve().then(j.run).then(j.res, j.rej).finally(() => { running.delete(j); pump(); });
  }
}
function job(key, pri, run) {
  if (done.has(key)) { const q = queue.find(j => j.key === key); if (q && pri < q.pri) { q.pri = pri; pump(); } return done.get(key); }
  const p = new Promise((res, rej) => queue.push({ key, pri, run, res, rej }));
  done.set(key, p); p.then(() => settled.add(key), () => { done.delete(key); stats.failed++; });
  pump(); return p;
}

// ---------------------------------------------------------------- stage data
// the prepared arrays for a race's stage (null while they are not ready); a stage asked for again moves to the front
export function stageData(race) { const e = stages.get(race.id); if (!e || !e.data) return null; e.at = performance.now(); return e.data; }
export function prepareStage(race, pri = 1) {
  let e = stages.get(race.id);
  if (e) { e.at = performance.now(); if (pri === 0) job('stage:' + race.id, 0, () => e.p); return e.p; }
  const [path, name] = stageModule(race);
  e = { at: performance.now(), data: null, ms: 0 };
  e.p = job('stage:' + race.id, pri, async () => {
    const r = await inWorker(new URL(path, import.meta.url).href, name);
    e.data = r.d; e.ms = r.ms; stats.stagesPrepared++; stats.stageMs.push(Math.round(r.ms)); return r.d; });
  e.p.catch(err => { console.warn('stage ' + race.id + ' not prepared in the background (' + err.message + '): it is built on the main thread'); stages.delete(race.id); });
  stages.set(race.id, e);
  // (kept: the newest two; the stage in use is the newest)
  if (stages.size > MAX_STAGES) { const old = [...stages.entries()].filter(([id]) => id !== race.id).sort((a, b) => a[1].at - b[1].at); while (stages.size > MAX_STAGES && old.length) { const [id] = old.shift(); stages.delete(id); done.delete('stage:' + id); settled.delete('stage:' + id); } }
  return e.p;
}
export const preparedStages = () => [...stages.entries()].map(([id, e]) => ({ id, ready: !!e.data, ms: Math.round(e.ms) }));

// ---------------------------------------------------------------- shared assets
// the photo textures every stage builder draws on (rally.js: the ground's layers, the road, the walls, the timber)
const STAGE_TEX = [['aerial_grass_rock', 'diff', '2k', true, [92, 98, 52]], ['aerial_grass_rock', 'nor_gl', '2k', false, NFLAT], ['forest_leaves_03', 'diff', '2k', true, [70, 58, 40]],
  ['forest_leaves_03', 'nor_gl', '1k', false, NFLAT], ['rock_face_03', 'diff', '2k', true, [110, 100, 90]], ['rock_face_03', 'nor_gl', '2k', false, NFLAT], ['coast_sand_01', 'diff', '2k', true, [140, 125, 100]],
  ['coast_sand_01', 'nor_gl', '1k', false, NFLAT], ['bicolour_gravel', 'diff', '1k', true], ['bicolour_gravel', 'nor_gl', '1k', false, NFLAT], ['brown_mud', 'diff', '1k', true],
  ['asphalt_pit_lane', 'diff', '2k', true], ['asphalt_pit_lane', 'nor_gl', '1k', false, NFLAT], ['asphalt_pit_lane', 'rough', '1k', false, [210, 210, 210]],
  ['japanese_stone_wall', 'diff', '1k', true], ['japanese_stone_wall', 'nor_gl', '1k', false, NFLAT], ['pine_bark', 'diff', '1k', true], ['pine_bark', 'nor_gl', '1k', false, NFLAT]];
const texLoaded = t => new Promise(res => { const ok = () => t.image && (t.image.complete !== false) && (t.image.width || t.image.videoWidth); if (ok()) return res(t); let n = 0; const poll = () => ok() || n++ > 600 ? res(t) : setTimeout(poll, 50); poll(); });
function textures(pri) { return Promise.all(STAGE_TEX.map(a => job('tex:' + a.slice(0, 3).join('_'), pri, () => texLoaded(phTex(...a)).then(t => { uploads.push(t); stats.assets++; return t; })))); }
const car = (id, pri) => job('car:' + id, pri, async () => { await (await import('./car.js')).loadCarModel(id); stats.assets++; });
const arms = pri => job('arms', pri, async () => { await (await import('./car.js')).loadArms(); stats.assets++; });
const pilot = pri => job('pilot', pri, async () => { await (await import('./rally.js')).pilotFiles(); stats.assets++; });
const packs = pri => job('packs', pri, async () => { await (await import('./packs.js')).loadPacks(); stats.assets++; });
const people = pri => job('people', pri, async () => { await (await import('./crowd.js')).loadPeople(); stats.assets++; });
const stageCode = (race, pri) => job('code:' + race.map, pri, async () => { await import('./engine.js').then(m => m.MAPS[race.map]()); });

// what any race needs, at a low priority (the player walking about the town)
export function warmShared(pri = 3) { return Promise.all([car('f40', pri), car('i20', pri), arms(pri), pilot(pri), packs(pri), people(pri), textures(pri)]); }
// everything for one race: its stage, its code, the cars of the player and of the field, the shared assets
export function prepareRace(race, { car: carId, field = [] } = {}, pri = 1) {
  const cars = new Set([carId || race.car, ...field.map(d => d.car)]);
  return Promise.all([prepareStage(race, pri), stageCode(race, pri), ...[...cars].map(id => car(id, pri)), arms(pri), pilot(pri), packs(pri), people(pri), textures(pri)]);
}
// how far a race's preparation has come (0..1) and what is still missing
export function readiness(race, carId) {
  const keys = ['stage:' + race.id, 'code:' + race.map, 'car:' + (carId || race.car), 'arms', 'pilot', 'packs', 'people'];
  let ready = 0; for (const k of keys) if (k.startsWith('stage:') ? stageData(race) : settled.has(k)) ready++;
  return { k: ready / keys.length, stage: !!stageData(race) };
}

// ---------------------------------------------------------------- the GPU: one upload a frame, when there is time
let lastT = 0;
export function frame() {
  const now = performance.now(), dt = now - lastT; lastT = now;
  if (!uploads.length || dt > 22) return;
  const t = uploads.shift();
  try { if (t.image && !renderer.properties.get(t).__webglTexture) { renderer.initTexture(t); stats.uploads++; } } catch (e) {}
}
// the queue's state, for the board's readiness light and the tests
export const state = () => ({ queued: queue.length, running: running.size, stages: preparedStages(), uploadsLeft: uploads.length, ...stats });
export const races = () => RACES;
export { raceById };
