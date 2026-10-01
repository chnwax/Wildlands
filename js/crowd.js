// Walking people from rigged, animated characters (Quaternius "Man" and "Animated Woman", CC0, via poly.pizza).
// Skinning hundreds of characters on the CPU would cost far too much, so each model's walk and idle clips are baked
// once at load into vertex-animation textures (skinned position and normal of every vertex at every frame); the
// people are then two instanced meshes whose vertex shader reads their pose from the texture, blending between
// frames, each walker with its own phase, cadence, walk/stand blend, scale and (for the man) shirt, trousers and hair
// colours. Shadows use the same animated positions (custom depth material).
import { THREE, scene, S, gltfLoader } from './core.js';

const FRAMES = { walk: 24, idle: 12 };
const H = 1.66; // standing height the models are normalised to (walkers carry their own scale on top)

function loadGLB(url) { return new Promise((res, rej) => gltfLoader.load(url, res, undefined, rej)); }

// bake one model: merged geometry (bind pose, with part ids and colours) + position/normal textures
function bake(gltf, clipNames, partOf) {
  const root = gltf.scene, meshes = [];
  root.updateMatrixWorld(true);
  root.traverse(o => { if (o.isSkinnedMesh) meshes.push(o); });
  const mixer = new THREE.AnimationMixer(root);
  const clips = clipNames.map(n => gltf.animations.find(a => a.name.toLowerCase().includes(n)) || gltf.animations[0]);
  // merged vertex layout
  let nv = 0; const ranges = meshes.map(m => { const r = [nv, m.geometry.attributes.position.count]; nv += r[1]; return r; });
  const idx = [], col = new Float32Array(nv * 3), part = new Float32Array(nv), uv = new Float32Array(nv * 2), vid = new Float32Array(nv);
  meshes.forEach((m, k) => { const [o, n] = ranges[k], g = m.geometry, c = m.material.color || new THREE.Color(1, 1, 1), p = partOf(m.material.name);
    for (let i = 0; i < n; i++) { col.set([c.r, c.g, c.b], (o + i) * 3); part[o + i] = p; vid[o + i] = o + i; if (g.attributes.uv) { uv[(o + i) * 2] = g.attributes.uv.getX(i); uv[(o + i) * 2 + 1] = g.attributes.uv.getY(i); } }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + o); else for (let i = 0; i < n; i++) idx.push(o + i); });
  const nF = FRAMES.walk + FRAMES.idle, pos = new Float32Array(nv * nF * 4), nor = new Float32Array(nv * nF * 4);
  const tmp = new THREE.BufferGeometry(), tp = new Float32Array(nv * 3); tmp.setAttribute('position', new THREE.BufferAttribute(tp, 3)); tmp.setIndex(idx);
  const v = new THREE.Vector3();
  let row = 0;
  clips.forEach((clip, ci) => {
    const nf = ci === 0 ? FRAMES.walk : FRAMES.idle; mixer.stopAllAction(); const act = mixer.clipAction(clip); act.reset().play();
    for (let f = 0; f < nf; f++, row++) {
      mixer.setTime(clip.duration * f / nf); root.updateMatrixWorld(true);
      meshes.forEach((m, k) => { m.skeleton.update(); const [o, n] = ranges[k], P = m.geometry.attributes.position;
        for (let i = 0; i < n; i++) { v.fromBufferAttribute(P, i); m.applyBoneTransform(i, v); v.applyMatrix4(m.matrixWorld); tp.set([v.x, v.y, v.z], (o + i) * 3); } });
      tmp.attributes.position.needsUpdate = true; tmp.computeVertexNormals();
      const N = tmp.attributes.normal.array;
      for (let i = 0; i < nv; i++) { pos.set([tp[i * 3], tp[i * 3 + 1], tp[i * 3 + 2], 1], (row * nv + i) * 4); nor.set([N[i * 3], N[i * 3 + 1], N[i * 3 + 2], 0], (row * nv + i) * 4); }
    }
  });
  // normalise: feet on y = 0, centred, standing height H (measured on the first idle frame)
  let y0 = Infinity, y1 = -Infinity, cx = 0, cz = 0; const r0 = FRAMES.walk;
  for (let i = 0; i < nv; i++) { const o = (r0 * nv + i) * 4; y0 = Math.min(y0, pos[o + 1]); y1 = Math.max(y1, pos[o + 1]); cx += pos[o] / nv; cz += pos[o + 2] / nv; }
  const s = H / (y1 - y0);
  for (let k = 0; k < nv * nF; k++) { pos[k * 4] = (pos[k * 4] - cx) * s; pos[k * 4 + 1] = (pos[k * 4 + 1] - y0) * s; pos[k * 4 + 2] = (pos[k * 4 + 2] - cz) * s; }
  // textures: one row per frame is too wide for big meshes, so vertices wrap into rows of W texels
  const W = 1024, rowsPerFrame = Math.ceil(nv / W), tex = arr => { const d = new Float32Array(W * rowsPerFrame * nF * 4);
    for (let f = 0; f < nF; f++) d.set(arr.subarray(f * nv * 4, (f + 1) * nv * 4), f * W * rowsPerFrame * 4);
    const t = new THREE.DataTexture(d, W, rowsPerFrame * nF, THREE.RGBAFormat, THREE.FloatType); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t; };
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos.filter((_, k) => k % 4 !== 3).slice(r0 * nv * 3, (r0 + 1) * nv * 3), 3)); // bind: first idle frame (bounds)
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('aPart', new THREE.BufferAttribute(part, 1)); geo.setAttribute('aVid', new THREE.BufferAttribute(vid, 1));
  geo.setIndex(idx);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, H / 2, 0), 1.2);
  const walkLen = clips[0].duration;
  return { geo, tPos: tex(pos), tNor: tex(nor), rowsPerFrame, W, walkLen, map: meshes[0].material.map || null };
}

// vertex shader: pose from the baked textures (walk or idle, blended by iAnim.z), per-part colours
function patch(sh, B) {
  Object.assign(sh.uniforms, { tVatP: { value: B.tPos }, tVatN: { value: B.tNor }, uVat: { value: new THREE.Vector4(B.W, B.rowsPerFrame, FRAMES.walk, FRAMES.idle) }, uTime: S.uTime });
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', `#include <common>
      attribute float aPart, aVid; attribute vec4 iAnim; attribute vec3 iShirt, iPants, iHair;
      uniform highp sampler2D tVatP, tVatN; uniform vec4 uVat; uniform float uTime;
      vec4 vatAt(highp sampler2D t, float frame) { float i = aVid + frame * uVat.y * uVat.x; return texelFetch(t, ivec2(int(mod(i, uVat.x)), int(floor(i / uVat.x))), 0); }
      vec3 vatPose(highp sampler2D t) {
        float w = fract(iAnim.x + uTime * iAnim.y) * uVat.z, wi = floor(w), wf = w - wi;
        vec3 walk = mix(vatAt(t, wi).xyz, vatAt(t, mod(wi + 1.0, uVat.z)).xyz, wf);
        float d = fract(iAnim.x * 3.7 + uTime * 0.12) * uVat.w, di = floor(d), df = d - di;
        vec3 idle = mix(vatAt(t, uVat.z + di).xyz, vatAt(t, uVat.z + mod(di + 1.0, uVat.w)).xyz, df);
        return mix(walk, idle, iAnim.z); }`)
    .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
      objectNormal = normalize(vatPose(tVatN));`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      transformed = vatPose(tVatP);`);
  if (sh.vertexShader.includes('#include <color_vertex>')) sh.vertexShader = sh.vertexShader.replace('#include <color_vertex>', `#include <color_vertex>
      #ifdef USE_COLOR
        vColor = aPart > 0.5 && aPart < 1.5 ? iShirt : aPart > 1.5 && aPart < 2.5 ? iPants : aPart > 2.5 && aPart < 3.5 ? iHair : vColor;
      #endif`);
}

export async function loadCrowd() {
  const [man, woman] = await Promise.all(['assets/models/people/quaternius_man.glb', 'assets/models/people/quaternius_woman.glb'].map(loadGLB));
  const parts = { Shirt: 1, Pants: 2, Hair: 3 };
  return [bake(man, ['walk', 'idle'], n => parts[n] || 0), bake(woman, ['walking', 'idle'], () => 0)];
}

// build the two instanced meshes for `walkers` (each: {model, scale}); returns { meshes, set(i, matrix, phase, rate, stand) }
export function crowdMeshes(bakes, walkers, colours) {
  const out = bakes.map((B, mi) => {
    const list = walkers.map((w, i) => w.model === mi ? i : -1).filter(i => i >= 0), n = Math.max(1, list.length);
    const geo = B.geo.clone();
    const anim = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4), sh = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3), pa = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3), ha = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    list.forEach((wi, k) => { const c = colours[wi]; sh.setXYZ(k, ...c.shirt); pa.setXYZ(k, ...c.pants); ha.setXYZ(k, ...c.hair); });
    geo.setAttribute('iAnim', anim); geo.setAttribute('iShirt', sh); geo.setAttribute('iPants', pa); geo.setAttribute('iHair', ha);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: !B.map, map: B.map, roughness: 0.75, metalness: 0 });
    mat.onBeforeCompile = s => patch(s, B); mat.customProgramCacheKey = () => 'crowd' + mi;
    const dmat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    dmat.onBeforeCompile = s => patch(s, B); dmat.customProgramCacheKey = () => 'crowdDepth' + mi;
    const im = new THREE.InstancedMesh(geo, mat, n); im.customDepthMaterial = dmat; im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; im.userData.dynamicCaster = true;
    if (!list.length) im.count = 0;
    scene.add(im);
    return { im, anim, slot: new Map(list.map((wi, k) => [wi, k])), walkLen: B.walkLen };
  });
  return {
    meshes: out.map(o => o.im),
    walkLen: i => out[walkers[i].model].walkLen,
    set(i, m4, phase, rate, stand) { const o = out[walkers[i].model], k = o.slot.get(i); o.im.setMatrixAt(k, m4); o.anim.setXYZW(k, phase, rate, stand, 0); },
    commit() { for (const o of out) { o.im.instanceMatrix.needsUpdate = true; o.anim.needsUpdate = true; } },
  };
}
