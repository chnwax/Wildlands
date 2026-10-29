// World sessions: more than one map in one page. Sakuragawa is built once and stays; a race map is built beside it, run,
// and released, as often as the player likes, without reloading the game.
// A map leaves its footprint in the engine's shared registries as it is built — its objects in the scene, its scattered
// sets (Scatter), its colliders, props, lamps, swapped materials, audio emitters, mirror passes — and in a few shared
// uniforms (the ground's palette, the turf stripes, the town's glow, the city lights). A session records that footprint:
//   capture(world)  what the map added since begin() (everything the engine itself owns — sky, lights, clouds — is
//                   tagged persistent and never counted)
//   detach(ctx)     takes the map out of the engine, kept whole in memory (its GPU buffers stay: a return is instant)
//   attach(ctx)     puts it back exactly as it was
//   dispose(ctx)    releases a map for good: its objects, its geometry, materials and textures on the GPU — but never
//                   what is shared (the texture and model caches, the packs, the cars, the trees' libraries: tagged
//                   shared where they are cached) nor anything another kept map still uses
// The engine's per-frame systems (the shadow cascades' caster lists, the distance culling) are rebuilt for the scene in
// play after every switch.
import { THREE, scene, renderer, scatters, colliders, props, swapMaterials, lampPoints, SHARED } from './core.js';
import { post } from './post.js';
import { audio } from './audio.js';
import { paintU, turfU } from './terrain.js';
import { townGlowState, setTownGlow, refreshShadowCasters, resetShadowStands, time, env } from './sky.js';
import { cityLightU } from './citylights.js';
import { resetDistCull } from './distcull.js';

// the engine's own objects, present before any map: never a map's
export function markPersistent() { for (const o of scene.children) o.userData.persistent = true; }
const persistent = o => o.userData.persistent || o.isLight || o.isCamera;

// what a map adds to the shared uniforms, kept with it
const uniformState = () => ({
  paint: Object.fromEntries(Object.entries(paintU).map(([k, u]) => [k, u.value.clone()])),
  turf: Object.fromEntries(Object.entries(turfU).map(([k, u]) => [k, u.value.clone()])),
  glow: { ...townGlowState() },
  city: Object.fromEntries(Object.entries(cityLightU).map(([k, u]) => [k, u.value && u.value.clone && !u.value.isTexture ? u.value.clone() : u.value])),
});
const restoreUniforms = s => {
  for (const k in s.paint) paintU[k].value.copy(s.paint[k]);
  for (const k in s.turf) turfU[k].value.copy(s.turf[k]);
  setTownGlow(s.glow.x, s.glow.z, s.glow.r, s.glow.s);
  for (const k in s.city) { const u = cityLightU[k]; if (u.value && u.value.copy && !u.value.isTexture && s.city[k]) u.value.copy(s.city[k]); else u.value = s.city[k]; }
};
// a map with nothing of the town's: no turf, no glow, no city lights
const BLANK = { turf: null };
function blankUniforms() {
  if (!BLANK.turf) { BLANK.turf = Object.fromEntries(Object.entries(turfU).map(([k, u]) => [k, u.value.clone()])); BLANK.turf.uTurf0.set(0, 0, 0, 0); BLANK.turf.uTurf1 && BLANK.turf.uTurf1.set(0, 0, 0, 0); BLANK.turf.uTurfStripe.set(1, 0, 5.25, 0); }
  for (const k in BLANK.turf) turfU[k].value.copy(BLANK.turf[k]);
  setTownGlow(0, 0, 0, 0);
  if (cityLightU.uCLI) cityLightU.uCLI.value = 0;
}

// ---------------------------------------------------------------- recording a map's footprint
let mark = null;
// before a map is built: where each registry stands
export function begin() {
  mark = { scene: new Set(scene.children), scatters: scatters.length, swaps: swapMaterials.length, lamps: lampPoints.length, before: post.beforeScene.length,
    emitters: new Set(audio.emitters), props: props.items.length, groups: new Set(props.groups.keys()) };
  blankUniforms();
}
// after it is built (and its ambient life and car added): everything new is the map's
export function capture(world, extra = {}) {
  const m = mark || { scene: new Set(), scatters: 0, swaps: 0, lamps: 0, before: 0, emitters: new Set(), props: 0, groups: new Set() }; mark = null;
  const ctx = { world, ...extra, attached: true,
    objects: scene.children.filter(o => !m.scene.has(o) && !persistent(o)),
    scatters: scatters.slice(m.scatters), swaps: swapMaterials.slice(m.swaps), lamps: lampPoints.slice(m.lamps), before: post.beforeScene.slice(m.before),
    emitters: [...audio.emitters].filter(e => !m.emitters.has(e)), colliders: null, props: null, uniforms: null, hour: time.hour, azimuth: env.azimuth };
  return ctx;
}

// ---------------------------------------------------------------- out of the engine and back
export function detach(ctx) {
  if (!ctx.attached) return;
  ctx.hour = time.hour; ctx.azimuth = env.azimuth; ctx.uniforms = uniformState();
  for (const o of ctx.objects) scene.remove(o);
  const drop = (arr, list) => { const s = new Set(list); for (let i = arr.length - 1; i >= 0; i--) if (s.has(arr[i])) arr.splice(i, 1); };
  drop(scatters, ctx.scatters); drop(swapMaterials, ctx.swaps); drop(lampPoints, ctx.lamps); drop(post.beforeScene, ctx.before);
  for (const e of ctx.emitters) { audio.emitters.delete(e); if (e.out && audio.ctx) e.out.gain.setTargetAtTime(0, audio.ctx.currentTime, 0.05); }
  // (the colliders and props are the map's whole: the hash and the prop groups taken over as they are)
  ctx.colliders = new Map(colliders); colliders.clear();
  ctx.props = { groups: new Map(props.groups), items: props.items.slice(), flushed: props.flushed, near: props.near.slice() };
  props.groups.clear(); props.items.length = 0; props.near.length = 0; props.flushed = false;
  blankUniforms();
  ctx.attached = false;
  afterSwitch();
}
export function attach(ctx) {
  if (ctx.attached) return;
  for (const o of ctx.objects) scene.add(o);
  scatters.push(...ctx.scatters); swapMaterials.push(...ctx.swaps); lampPoints.push(...ctx.lamps); post.beforeScene.push(...ctx.before);
  for (const e of ctx.emitters) audio.emitters.add(e);
  colliders.clear(); for (const [k, v] of ctx.colliders) colliders.set(k, v); ctx.colliders = null;
  props.groups.clear(); for (const [k, v] of ctx.props.groups) props.groups.set(k, v); props.items.length = 0; props.items.push(...ctx.props.items); props.near.length = 0; props.near.push(...ctx.props.near); props.flushed = ctx.props.flushed; ctx.props = null;
  if (ctx.uniforms) restoreUniforms(ctx.uniforms);
  time.hour = ctx.hour; env.azimuth = ctx.azimuth;
  ctx.attached = true;
  afterSwitch();
}
// the per-frame systems re-pointed at what is now in the scene
function afterSwitch() { resetDistCull(); resetShadowStands(); scene.updateMatrixWorld(true); refreshShadowCasters(); }

// ---------------------------------------------------------------- releasing a map
// everything a map's objects reference on the GPU: geometry, materials (and the depth materials they cast shadows
// with), textures (those of the materials' own maps and of the uniforms they were compiled with)
function resources(roots, into = { geo: new Set(), mat: new Set(), tex: new Set() }) {
  const texOf = v => { if (!v) return; if (v.isTexture) into.tex.add(v); else if (Array.isArray(v)) v.forEach(texOf); };
  const matOf = m => { if (!m || into.mat.has(m)) return; into.mat.add(m);
    for (const k in m) { const v = m[k]; if (v && v.isTexture) into.tex.add(v); }
    if (m.uniforms) for (const k in m.uniforms) texOf(m.uniforms[k] && m.uniforms[k].value);
    const p = renderer.properties.get(m); if (p && p.uniforms) for (const k in p.uniforms) texOf(p.uniforms[k] && p.uniforms[k].value); };
  for (const r of roots) r.traverse(o => {
    if (o.geometry) into.geo.add(o.geometry);
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) matOf(m);
    matOf(o.customDepthMaterial); matOf(o.customDistanceMaterial);
  });
  return into;
}
const shared = r => SHARED.has(r);
// keep: the contexts that stay (their objects' resources are not touched)
export function dispose(ctx, keep = []) {
  if (ctx.attached) detach(ctx);
  const mine = resources(ctx.objects), kept = resources(scene.children);
  for (const k of keep) if (k !== ctx) resources(k.objects, kept);
  let n = { geo: 0, mat: 0, tex: 0 };
  for (const o of ctx.objects) o.traverse(x => { if (x.isInstancedMesh) x.dispose(); if (x.userData.dispose) try { x.userData.dispose(); } catch (e) { console.warn('dispose: ' + e.message); } });
  for (const g of mine.geo) if (!kept.geo.has(g) && !shared(g)) { g.dispose(); n.geo++; }
  for (const m of mine.mat) if (!kept.mat.has(m) && !shared(m)) { m.dispose(); n.mat++; }
  // (a render target's texture is its owner's to release: the grass bakes free theirs with the map, the trees' impostors
  // are a shared library)
  for (const t of mine.tex) if (!kept.tex.has(t) && !shared(t) && !t.isRenderTargetTexture) { t.dispose(); n.tex++; }
  for (const f of ctx.disposers || []) try { f(); } catch (e) { console.warn('dispose: ' + e.message); }
  for (const e of ctx.emitters) e.dispose && e.dispose();
  ctx.objects.length = 0; ctx.scatters.length = 0; ctx.swaps.length = 0; ctx.lamps.length = 0; ctx.before.length = 0; ctx.emitters.length = 0; ctx.colliders = null; ctx.props = null; ctx.world = null;
  ctx.disposed = true;
  return n;
}
