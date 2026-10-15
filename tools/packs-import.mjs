// node tools/packs-import.mjs [pack ...] — builds the model libraries the game draws from the owned Unity packs
// (UnityAssets/, never modified, never committed). Which models go into which library is listed in tools/packs.json.
//
// For every listed prefab: the prefab's renderers give the FBX and the material of each sub-mesh (Unity .mat → albedo
// texture, colour, cut-out / blend, two-sided), the FBX is read with tools/fbx.mjs and baked in metres, Y up, its
// foot centred on the origin (pivot "base") unless the entry keeps the source pivot. Textures are converted once per
// library (PSD/TGA → PNG, at most 1024 px, tools/packs_tex.py) and shared by every model that uses them.
// Output: assets/packs/<library>.glb (one node per model, named by its id) and assets/packs/manifest.json (sizes,
// triangle counts, source files, a content hash the game uses to version the URL). assets/packs/ is git-ignored: the
// pack licences allow the models inside the game, not their redistribution as files in a public repository.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { readFBX, fbxScene } from './fbx.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UA = path.join(ROOT, 'UnityAssets'), OUT = path.join(ROOT, 'assets', 'packs'), CACHE = path.join(OUT, '.cache');
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'packs.json'), 'utf8'));
const only = process.argv.slice(2);

// ---------------------------------------------------------------- Unity YAML
const REF = /\{fileID: (-?\d+)(?:, guid: ([0-9a-f]{32}), type: \d+)?\}/;
const REFG = new RegExp(REF.source, 'g');
const guidCache = new Map();
function guidIndex(packDir) {
  if (guidCache.has(packDir)) return guidCache.get(packDir);
  const idx = new Map();
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.meta')) { const m = /^guid: ([0-9a-f]{32})/m.exec(fs.readFileSync(p, 'utf8').slice(0, 400)); if (m) idx.set(m[1], p.slice(0, -5)); }
  } };
  walk(packDir); guidCache.set(packDir, idx); return idx;
}
const docs = text => { const out = [], re = /^--- !u!(\d+) &(-?\d+).*$/gm, ms = [...text.matchAll(re)];
  ms.forEach((m, i) => out.push({ cls: +m[1], id: m[2], body: text.slice(m.index + m[0].length, i + 1 < ms.length ? ms[i + 1].index : text.length) })); return out; };
// -> { renderers: [{ name, mesh: guid, mats: [guid] }] }
function parsePrefab(file) {
  const text = fs.readFileSync(file, 'utf8'), names = new Map(), filters = new Map(), renderers = [];
  for (const { cls, id, body } of docs(text)) {
    const go = new RegExp('m_GameObject: ' + REF.source).exec(body);
    if (cls === 1) names.set(id, (/m_Name: (.*)/.exec(body) || [, id])[1].trim());
    else if (cls === 33 && go) { const m = new RegExp('m_Mesh: ' + REF.source).exec(body); if (m && m[2]) filters.set(go[1], m[2]); }
    else if ((cls === 23 || cls === 137) && go) {
      if (/m_Enabled: 0/.test(body)) continue;
      const mm = /m_Materials:\s*\n((?:\s*- \{[^}]*\}\s*\n)+)/.exec(body);
      renderers.push({ go: go[1], mats: mm ? [...mm[1].matchAll(REFG)].map(r => r[2]) : [] });
      if (cls === 137) { const m = new RegExp('m_Mesh: ' + REF.source).exec(body); if (m && m[2]) filters.set(go[1], m[2]); }
    }
  }
  // prefab variants / model prefab instances: the FBX itself with material overrides
  for (const { cls, body } of docs(text)) if (cls === 1001) {
    const sp = new RegExp('m_SourcePrefab: ' + REF.source).exec(body); if (!sp || !sp[2]) continue;
    const mats = []; for (const m of body.matchAll(/propertyPath: m_Materials\.Array\.data\[(\d+)\]\s*\n\s*value:.*\n\s*objectReference: \{fileID: -?\d+, guid: ([0-9a-f]{32})/g)) mats[+m[1]] ??= m[2];
    renderers.push({ name: '*', source: sp[2], mats: mats.filter(Boolean) });
  }
  return renderers.map(r => r.source ? r : { name: names.get(r.go) || r.go, mesh: filters.get(r.go), mats: r.mats }).filter(r => r.mesh || r.source);
}
// FBX .meta externalObjects: FBX material name -> .mat guid
function fbxMatMap(fbx) {
  const meta = fbx + '.meta'; if (!fs.existsSync(meta)) return new Map();
  const t = fs.readFileSync(meta, 'utf8'), m = new Map();
  for (const r of t.matchAll(/type: UnityEngine:Material\s*\n\s*assembly: .*\n\s*name: (.*)\n\s*second: \{fileID: \d+, guid: ([0-9a-f]{32})/g)) m.set(r[1].trim(), r[2]);
  return m;
}
function parseMat(file) {
  const t = fs.readFileSync(file, 'utf8'), tex = {}, floats = {}, colors = {};
  for (const m of t.matchAll(/- (\w+):\s*\n\s*m_Texture: \{fileID: -?\d+(?:, guid: ([0-9a-f]{32}), type: \d+)?\}\s*\n\s*m_Scale: \{x: ([-\d.e]+), y: ([-\d.e]+)\}/g)) if (m[2]) tex[m[1]] = { guid: m[2], scale: [+m[3], +m[4]] };
  for (const m of t.matchAll(/^\s*- (\w+): ([-\d.e]+)\s*$/gm)) floats[m[1]] = +m[2];
  for (const m of t.matchAll(/- (\w+): \{r: ([-\d.e]+), g: ([-\d.e]+), b: ([-\d.e]+), a: ([-\d.e]+)\}/g)) colors[m[1]] = [+m[2], +m[3], +m[4], +m[5]];
  return { name: (/m_Name: (.*)/.exec(t) || [, path.basename(file, '.mat')])[1].trim(), tex, floats, colors,
    keywords: (/m_ShaderKeywords: (.*)/.exec(t) || [, ''])[1], queue: +((/m_CustomRenderQueue: (-?\d+)/.exec(t) || [, -1])[1]) };
}
const ALBEDO = ['_BaseMap', '_Base_Map', '_MainTex', '_BaseColorMap', '_Albedo', '_MainTexture', '_Albedo_Map', '_LeafTex', '_Texture'];
const COLOR = ['_BaseColor', '_Base_Color', '_Color', '_Tint', '_Color_Tint'];
const FOLIAGE = /leaf|leaves|grass|bush|flower|petal|shrub|reed|card|plant|wheat|foliage|blade|needle/i;
const srgb2lin = c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;

// ---------------------------------------------------------------- geometry
const deg = Math.PI / 180;
const mmul = (a, b) => { const o = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) o[i * 4 + j] += a[i * 4 + k] * b[k * 4 + j]; return o; };
const rot = (r, order = 0) => { // FBX euler degrees, default order XYZ (applied X first)
  const [x, y, z] = r.map(v => +v * deg), cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
  const Rx = [1, 0, 0, 0, 0, cx, -sx, 0, 0, sx, cx, 0, 0, 0, 0, 1], Ry = [cy, 0, sy, 0, 0, 1, 0, 0, -sy, 0, cy, 0, 0, 0, 0, 1], Rz = [cz, -sz, 0, 0, sz, cz, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const seq = [[Rx, Ry, Rz], [Rx, Rz, Ry], [Ry, Rz, Rx], [Ry, Rx, Rz], [Rz, Rx, Ry], [Rz, Ry, Rx]][order] || [Rx, Ry, Rz];
  return mmul(seq[2], mmul(seq[1], seq[0]));
};
// a node's transform to the model root. preOnly: the 3ds Max exports (Idyllic Anime Japan: geometry Z-up, PreRotation
// -90° X and a compensating +90° Lcl Rotation) stand up in Unity by the PreRotation alone
function worldMatrix(id, models, preOnly = false) {
  let M = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (let k = id; k && models.has(k); k = models.get(k).parent) {
    const m = models.get(k), T = [1, 0, 0, +m.T[0], 0, 1, 0, +m.T[1], 0, 0, 1, +m.T[2], 0, 0, 0, 1], S = [+m.S[0], 0, 0, 0, 0, +m.S[1], 0, 0, 0, 0, +m.S[2], 0, 0, 0, 0, 1];
    M = mmul(mmul(T, mmul(rot(m.preR || [0, 0, 0]), preOnly ? S : mmul(rot(m.R, +m.order), S))), M);
  }
  return M;
}
const xf = (M, p, w = 1) => [M[0] * p[0] + M[1] * p[1] + M[2] * p[2] + M[3] * w, M[4] * p[0] + M[5] * p[1] + M[6] * p[2] + M[7] * w, M[8] * p[0] + M[9] * p[1] + M[10] * p[2] + M[11] * w];

// ---------------------------------------------------------------- one library
function buildLibrary(lib, spec) {
  const packDir = path.join(UA, spec.pack), guids = guidIndex(packDir);
  const texJobs = new Map(), matIndex = new Map(), materials = [], assets = [];
  const texOf = guid => {
    const src = guids.get(guid); if (!src || !fs.existsSync(src)) return null;
    if (!texJobs.has(src)) texJobs.set(src, { src, dst: path.join(CACHE, lib, path.basename(src).replace(/\.[^.]+$/, '') + '.png'), max: spec.texMax || 1024, index: texJobs.size });
    return texJobs.get(src);
  };
  const material = (guid, fallbackName, hint) => {
    const key = guid || 'default:' + fallbackName;
    if (matIndex.has(key)) return matIndex.get(key);
    const file = guid && guids.get(guid);
    const m = file && fs.existsSync(file) ? parseMat(file) : { name: fallbackName || 'default', tex: {}, floats: {}, colors: {}, keywords: '', queue: -1 };
    const o = (spec.materials || {})[m.name] || {};
    const ak = ALBEDO.find(k => m.tex[k]), ck = COLOR.find(k => m.colors[k]);
    const foliage = o.foliage ?? FOLIAGE.test(m.name); void hint;
    const f = m.floats, kw = m.keywords;
    const blend = o.blend ?? (/_ALPHABLEND_ON|_ALPHAPREMULTIPLY_ON|_SURFACE_TYPE_TRANSPARENT/.test(kw) || f._Mode === 2 || f._Mode === 3 || f._Surface === 1);
    const cut = o.cutout ?? (!blend && (/_ALPHATEST_ON/.test(kw) || f._Mode === 1 || f._AlphaClip === 1 || (m.queue >= 2450 && m.queue < 3000) || foliage));
    const col = o.color || (ck ? m.colors[ck] : [1, 1, 1, 1]);
    const mat = { name: m.name, pbrMetallicRoughness: { baseColorFactor: [srgb2lin(col[0]), srgb2lin(col[1]), srgb2lin(col[2]), blend ? (o.opacity ?? col[3]) : 1],
      metallicFactor: o.metalness ?? Math.min(f._Metallic ?? 0, 0.3), roughnessFactor: o.roughness ?? Math.max(0.55, 1 - (f._Glossiness ?? f._Smoothness ?? 0.2)) } };
    const tj = o.texture === false ? null : ak && texOf(m.tex[ak].guid);
    if (tj) { mat._tex = tj; const sc = m.tex[ak].scale; if (sc[0] !== 1 || sc[1] !== 1) mat._uvScale = sc; }
    if (blend) mat.alphaMode = 'BLEND'; else if (cut && tj) { mat.alphaMode = 'MASK'; mat.alphaCutoff = o.cutoff ?? f._Cutoff ?? f._AlphaCutoff ?? 0.5; }
    if (o.doubleSided ?? (foliage || blend || f._Cull === 0 || f._CullMode === 0 || f._RenderFace === 2 || f._DoubleSided === 1)) mat.doubleSided = true;
    mat.extras = { wl: { kind: o.kind || (blend ? 'glass' : foliage ? 'foliage' : 'solid'), sway: o.sway ?? (foliage ? 1 : 0) } };
    const i = materials.push(mat) - 1; matIndex.set(key, i); return i;
  };
  for (const a of spec.assets) {
    const id = a.id;
    let fbx, rends = [];
    if (a.prefab) {
      const pf = path.join(packDir, a.prefab); if (!fs.existsSync(pf)) { console.warn(`  ${id}: missing prefab ${a.prefab}`); continue; }
      rends = parsePrefab(pf);
      const srcs = [...new Set(rends.map(r => guids.get(r.mesh || r.source)).filter(p => p && /\.fbx$/i.test(p)))];
      if (!srcs.length) { console.warn(`  ${id}: prefab has no FBX mesh`); continue; }
      fbx = srcs[0];
    } else fbx = path.join(packDir, a.fbx);
    const sc = fbxScene(readFBX(fbx)), nameMats = fbxMatMap(fbx);
    const unit = Number(sc.settings.UnitScaleFactor?.at(-1) ?? 1) / 100 * (a.scale || 1);
    const upZ = Number(sc.settings.UpAxis?.at(-1) ?? 1) === 2;
    const prims = new Map(); let tris = 0;
    for (const g of sc.meshes) {
      const model = sc.models.get(g.model), mname = model?.name || g.name;
      if (/(?:^|[_\-.\s])LOD\s*[1-9]|collision|collider|_COL\b|^UCX_|shadow ?proxy/i.test(mname + ' ' + g.name)) continue;
      if (a.skip && new RegExp(a.skip, 'i').test(mname)) continue;
      let r = rends.find(q => q.name === mname) || (rends.length === 1 ? rends[0] : rends.find(q => q.name === '*'));
      if (rends.length && !r && rends.some(q => q.name !== '*')) continue; // (a mesh the prefab does not render)
      const M = worldMatrix(g.model, sc.models, spec.nodeRotation === 'pre'), slots = model?.materials || [];
      for (let t = 0; t < g.pos.length / 9; t++) {
        const si = g.mat[t] ?? 0, slot = slots[si], fname = slot?.name || 'default';
        const mg = (r && r.mats[Math.min(si, r.mats.length - 1)]) || nameMats.get(fname) || null;
        const mi = material(mg, fname, mname);
        let P = prims.get(mi); if (!P) prims.set(mi, P = { pos: [], nor: [], uv: [] });
        for (let v = 0; v < 3; v++) {
          const i = t * 9 + v * 3; let p = xf(M, [g.pos[i], g.pos[i + 1], g.pos[i + 2]]), n = g.nor.length ? xf(M, [g.nor[i], g.nor[i + 1], g.nor[i + 2]], 0) : [0, 1, 0];
          if (upZ) { p = [p[0], p[2], -p[1]]; n = [n[0], n[2], -n[1]]; }
          const nl = Math.hypot(...n) || 1;
          P.pos.push(p[0] * unit, p[1] * unit, p[2] * unit); P.nor.push(n[0] / nl, n[1] / nl, n[2] / nl);
          P.uv.push(g.uv.length ? g.uv[t * 6 + v * 2] : 0, g.uv.length ? 1 - g.uv[t * 6 + v * 2 + 1] : 0);
        }
        tris++;
      }
    }
    if (!tris) { console.warn(`  ${id}: no triangles`); continue; }
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const P of prims.values()) for (let i = 0; i < P.pos.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], P.pos[i + k]); hi[k] = Math.max(hi[k], P.pos[i + k]); }
    const off = a.pivot === 'keep' ? [0, 0, 0] : [-(lo[0] + hi[0]) / 2, -lo[1], -(lo[2] + hi[2]) / 2];
    for (const P of prims.values()) for (let i = 0; i < P.pos.length; i += 3) for (let k = 0; k < 3; k++) P.pos[i + k] += off[k];
    assets.push({ id, prims, tris, kind: a.kind || spec.kind || 'prop', dims: hi.map((h, k) => +(h - lo[k]).toFixed(3)), src: path.relative(ROOT, a.prefab ? path.join(packDir, a.prefab) : fbx).replaceAll('\\', '/') });
  }
  // textures (python, once per library)
  const jobs = [...texJobs.values()];
  if (jobs.length) { const out = execFileSync('python', [path.join(ROOT, 'tools', 'packs_tex.py')], { input: JSON.stringify(jobs.map(({ src, dst, max }) => ({ src, dst, max }))) }).toString();
    for (const l of out.trim().split('\n')) if (/written/.test(l)) console.log('  tex', path.basename(l.split('\t')[0]), l.split('\t')[1]); }
  return writeGLB(lib, assets, materials, jobs);
}

// ---------------------------------------------------------------- GLB (indexed, one node per model, shared textures)
const pad4 = n => (n + 3) & ~3;
function writeGLB(lib, assets, materials, texJobs) {
  const chunks = []; let byteLength = 0;
  const append = data => { const b = Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength), start = byteLength;
    chunks.push(b); byteLength += b.length; const p = pad4(byteLength) - byteLength; if (p) { chunks.push(Buffer.alloc(p)); byteLength += p; } return { byteOffset: start, byteLength: b.length }; };
  const gltf = { asset: { version: '2.0', generator: 'Wildlands packs-import' }, scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [{ byteLength: 0 }],
    images: [], textures: [], samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }] };
  for (const j of texJobs) { const v = append(fs.readFileSync(j.dst)), bv = gltf.bufferViews.push({ buffer: 0, ...v }) - 1;
    gltf.images.push({ bufferView: bv, mimeType: 'image/png', name: path.basename(j.dst) }); gltf.textures.push({ sampler: 0, source: gltf.images.length - 1 }); }
  gltf.materials = materials.map(m => { const o = JSON.parse(JSON.stringify({ ...m, _tex: undefined, _uvScale: undefined }));
    if (m._tex) o.pbrMetallicRoughness.baseColorTexture = { index: m._tex.index, ...(m._uvScale ? { extensions: { KHR_texture_transform: { scale: m._uvScale } } } : {}) }; return o; });
  if (materials.some(m => m._uvScale)) gltf.extensionsUsed = ['KHR_texture_transform'];
  const acc = (arr, type, target, minmax) => { const v = append(arr), bv = gltf.bufferViews.push({ buffer: 0, ...v, ...(target ? { target } : {}) }) - 1;
    const ct = arr instanceof Uint16Array ? 5123 : arr instanceof Uint32Array ? 5125 : 5126, n = { SCALAR: 1, VEC2: 2, VEC3: 3 }[type];
    return gltf.accessors.push({ bufferView: bv, componentType: ct, count: arr.length / n, type, ...(minmax || {}) }) - 1; };
  const manifest = {};
  for (const a of assets) {
    const mesh = { name: a.id, primitives: [] };
    for (const [mi, P] of a.prims) {
      // weld identical corners (position, normal, uv) into an indexed mesh
      const map = new Map(), pos = [], nor = [], uv = [], idx = [];
      for (let i = 0; i < P.pos.length / 3; i++) {
        const k = [P.pos[i * 3], P.pos[i * 3 + 1], P.pos[i * 3 + 2], P.nor[i * 3], P.nor[i * 3 + 1], P.nor[i * 3 + 2], P.uv[i * 2], P.uv[i * 2 + 1]].map(v => Math.round(v * 1e4)).join(',');
        let j = map.get(k); if (j === undefined) { j = pos.length / 3; map.set(k, j); pos.push(P.pos[i * 3], P.pos[i * 3 + 1], P.pos[i * 3 + 2]); nor.push(P.nor[i * 3], P.nor[i * 3 + 1], P.nor[i * 3 + 2]); uv.push(P.uv[i * 2], P.uv[i * 2 + 1]); }
        idx.push(j);
      }
      const p = Float32Array.from(pos), mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[i + k]); mx[k] = Math.max(mx[k], p[i + k]); }
      mesh.primitives.push({ attributes: { POSITION: acc(p, 'VEC3', 34962, { min: mn, max: mx }), NORMAL: acc(Float32Array.from(nor), 'VEC3', 34962), TEXCOORD_0: acc(Float32Array.from(uv), 'VEC2', 34962) },
        indices: acc(pos.length / 3 > 65535 ? Uint32Array.from(idx) : Uint16Array.from(idx), 'SCALAR', 34963), material: mi, mode: 4 });
    }
    const mi = gltf.meshes.push(mesh) - 1, ni = gltf.nodes.push({ name: a.id, mesh: mi, extras: { kind: a.kind, dims: a.dims } }) - 1;
    gltf.scenes[0].nodes.push(ni);
    manifest[a.id] = { kind: a.kind, dims: a.dims, tris: a.tris, src: a.src };
  }
  gltf.buffers[0].byteLength = byteLength;
  const bin = Buffer.concat(chunks), json = Buffer.from(JSON.stringify(gltf)), jp = Buffer.alloc(pad4(json.length), 0x20); json.copy(jp);
  const total = 12 + 8 + jp.length + 8 + bin.length, out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jp.length, 12); out.writeUInt32LE(0x4e4f534a, 16); jp.copy(out, 20);
  const bo = 20 + jp.length; out.writeUInt32LE(bin.length, bo); out.writeUInt32LE(0x004e4942, bo + 4); bin.copy(out, bo + 8);
  fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, lib + '.glb'), out);
  return { file: lib + '.glb', hash: crypto.createHash('sha1').update(out).digest('hex').slice(0, 10), bytes: out.length, assets: manifest };
}

// ---------------------------------------------------------------- main
if (!fs.existsSync(UA)) { console.error('UnityAssets/ not found — the packs are needed to build the model libraries.'); process.exit(1); }
const mf = path.join(OUT, 'manifest.json'), manifest = fs.existsSync(mf) ? JSON.parse(fs.readFileSync(mf, 'utf8')) : { libraries: {} };
for (const [lib, spec] of Object.entries(CFG.libraries)) {
  if (only.length && !only.includes(lib)) continue;
  if (!fs.existsSync(path.join(UA, spec.pack))) { console.warn(`${lib}: pack folder UnityAssets/${spec.pack} missing, skipped`); continue; }
  const t0 = Date.now(); console.log(`${lib} (${spec.pack}): ${spec.assets.length} models`);
  const r = buildLibrary(lib, spec);
  manifest.libraries[lib] = { pack: spec.pack, licence: spec.licence, runtime: spec.runtime !== false, ...r };
  console.log(`  -> assets/packs/${r.file} ${(r.bytes / 1048576).toFixed(1)} MB, ${Object.keys(r.assets).length} models, ${Object.values(r.assets).reduce((s, a) => s + a.tris, 0)} triangles, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
manifest.generated = new Date().toISOString();
fs.writeFileSync(mf, JSON.stringify(manifest, null, 1) + '\n');
