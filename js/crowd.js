// People drawn from the baked crowd models (assets/models/people: people.json + people.bin, tools/people-bake.mjs):
// four men and two women from poly.pizza, each with its clips (walk, idle, sit down, sit, run, reach, wave) evaluated
// offline into frames of vertex positions. Every person of a model is an instance of one mesh whose vertex shader reads
// its pose from those frames (a vertex-animation texture: one row a frame, one texel a vertex) — two clips at their own
// times, blended, so a walker eases into a stop or a sit. The models are flat-shaded low poly: the faces' normals come
// from the screen-space derivatives. Per person: a matrix, the two clips and their times, the blend, and its own shirt,
// trousers and hair colours.
import { THREE, scene } from './core.js';

export const CLIP = { walk: 0, idle: 1, sitdown: 2, sit: 3, run: 4, act: 5, talk: 6 };
const NC = 7, NAMES = Object.keys(CLIP);

export async function loadPeople(base = 'assets/models/people/') {
  const meta = await (await fetch(base + 'people.json', { cache: 'no-cache' })).json();
  const bin = await (await fetch(base + 'people.bin?v=' + meta.hash)).arrayBuffer();
  return meta.models.map(M => {
    const idx = M.idx32 ? new Uint32Array(bin, M.idx, M.ni) : new Uint16Array(bin, M.idx, M.ni);
    const col = new Float32Array(bin, M.col, M.nv * 3), part = new Uint8Array(bin, M.part, M.nv), pos = new Uint16Array(bin, M.pos, M.nv * M.frames * 4);
    const tex = new THREE.DataTexture(pos, M.nv, M.frames, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
    // the mesh: positions of the first idle frame (its bounds; the shader replaces them), colours, part and vertex ids
    const f0 = M.clips.idle.f0, bind = new Float32Array(M.nv * 3), vid = new Float32Array(M.nv), prt = new Float32Array(M.nv);
    for (let i = 0; i < M.nv; i++) { for (let k = 0; k < 3; k++) bind[i * 3 + k] = THREE.DataUtils.fromHalfFloat(pos[(f0 * M.nv + i) * 4 + k]); vid[i] = i; prt[i] = part[i]; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(bind, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(M.nv * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col.slice(), 3)); geo.setAttribute('aVid', new THREE.BufferAttribute(vid, 1)); geo.setAttribute('aPart', new THREE.BufferAttribute(prt, 1));
    geo.setIndex(new THREE.BufferAttribute(idx.slice(), 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, M.H / 2, 0), 1.3);
    // clip table: first frame, frame count, loops; a clip the model lacks plays its idle. (stride: metres a cycle of the
    // walk or the run covers, measured from the feet when baked)
    const table = NAMES.map(n => { const c = M.clips[n] || M.clips.idle; return new THREE.Vector4(c.f0, c.n, c.loop ? 1 : 0, c.dur); });
    return { id: M.id, H: M.H, seat: M.seat, clips: M.clips, has: n => !!M.clips[n], dur: n => (M.clips[n] || M.clips.idle).dur, stride: n => (M.clips[n] || M.clips.walk).stride || 1.6, geo, tex, table };
  });
}

// pose from the texture: clip A at its time blended toward clip B at its own (iAnim = clipA, tA, clipB, tB; iMix.x the
// blend); times are fractions of a clip (a looping clip wraps, the others hold their ends); iCol: shirt, trousers and
// hair colours packed as 0xRRGGBB (negative: the model's own)
function patch(sh, P) {
  Object.assign(sh.uniforms, { tVat: { value: P.tex }, uClips: { value: P.table } });
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', `#include <common>
      attribute float aVid, aPart; attribute vec4 iAnim, iMix, iCol;
      uniform highp sampler2D tVat; uniform vec4 uClips[${NC}];
      vec3 vatAt(float f) { return texelFetch(tVat, ivec2(int(aVid), int(f)), 0).xyz; }
      vec3 clipPose(float id, float t) {
        vec4 c = uClips[int(id + 0.5)];
        float f = c.z > 0.5 ? fract(t) * c.y : clamp(t, 0.0, 1.0) * (c.y - 1.0), fi = floor(f), fr = f - fi;
        float f1 = c.z > 0.5 ? mod(fi + 1.0, c.y) : min(fi + 1.0, c.y - 1.0);
        return mix(vatAt(c.x + fi), vatAt(c.x + f1), fr); }
      vec3 unpackCol(float v) { return vec3(floor(v / 65536.0), mod(floor(v / 256.0), 256.0), mod(v, 256.0)) / 255.0; }`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      transformed = iMix.x <= 0.001 ? clipPose(iAnim.x, iAnim.y) : iMix.x >= 0.999 ? clipPose(iAnim.z, iAnim.w) : mix(clipPose(iAnim.x, iAnim.y), clipPose(iAnim.z, iAnim.w), iMix.x);`);
  if (sh.vertexShader.includes('#include <color_vertex>')) sh.vertexShader = sh.vertexShader.replace('#include <color_vertex>', `#include <color_vertex>
      #ifdef USE_COLOR
        float pc = aPart < 0.5 ? -1.0 : aPart < 1.5 ? iCol.x : aPart < 2.5 ? iCol.y : iCol.z;
        if (pc >= 0.0) vColor = unpackCol(pc);
      #endif`);
}

const packCol = c => Math.round(Math.min(1, Math.max(0, c[0])) * 255) * 65536 + Math.round(Math.min(1, Math.max(0, c[1])) * 255) * 256 + Math.round(Math.min(1, Math.max(0, c[2])) * 255);
// one instanced mesh per model with room for `capacity[m]` people; each frame the people to draw are written from slot 0
// (begin, put for each, end): who is out of view or indoors is simply not written
export function crowdMeshes(people, capacity) {
  const sets = people.map((P, mi) => {
    const n = Math.max(1, capacity[mi] || 0), geo = P.geo.clone();
    const anim = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4), mix = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4), col = new THREE.InstancedBufferAttribute(new Float32Array(n * 4).fill(-1), 4);
    for (const a of [anim, mix, col]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iAnim', anim); geo.setAttribute('iMix', mix); geo.setAttribute('iCol', col);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.78, metalness: 0 });
    mat.onBeforeCompile = s => patch(s, P); mat.customProgramCacheKey = () => 'people';
    const dmat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    dmat.onBeforeCompile = s => patch(s, P); dmat.customProgramCacheKey = () => 'peopleDepth';
    const im = new THREE.InstancedMesh(geo, mat, n);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.customDepthMaterial = dmat; im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; im.userData.dynamicCaster = true; im.count = 0;
    im.name = 'people:' + P.id; scene.add(im);
    return { im, anim, mix, col, k: 0 };
  });
  return {
    meshes: sets.map(s => s.im),
    begin() { for (const s of sets) s.k = 0; },
    // person in model m: world matrix, clips (CLIP ids) and times, blend, colours [[r,g,b] x3] or null
    put(m, m4, cA, tA, cB, tB, w, cols) {
      const s = sets[m], k = s.k++; if (k >= s.im.instanceMatrix.count) { s.k--; return; }
      m4.toArray(s.im.instanceMatrix.array, k * 16);
      s.anim.array[k * 4] = cA; s.anim.array[k * 4 + 1] = tA; s.anim.array[k * 4 + 2] = cB; s.anim.array[k * 4 + 3] = tB; s.mix.array[k * 4] = w;
      if (cols) { s.col.array[k * 4] = cols[0]; s.col.array[k * 4 + 1] = cols[1]; s.col.array[k * 4 + 2] = cols[2]; } else s.col.array[k * 4] = s.col.array[k * 4 + 1] = s.col.array[k * 4 + 2] = -1;
    },
    end() { for (const s of sets) { s.im.count = s.k; if (!s.k) continue; for (const a of [s.im.instanceMatrix, s.anim, s.mix, s.col]) { a.clearUpdateRanges(); a.addUpdateRange(0, s.k * a.itemSize); a.needsUpdate = true; } } },
    pack: packCol,
  };
}
