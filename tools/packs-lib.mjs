// Shared by tools/packs-import.mjs (the game's model libraries) and tools/packs-extract.mjs (every model of every pack,
// one file each, sorted into categories): reading the Unity packs in UnityAssets/ (never modified) — prefabs, FBX
// files, materials, textures — and writing indexed GLB files.
//
// A prefab is baked the way Unity draws it: its renderers name the FBX and the material of each sub-mesh (Unity .mat →
// albedo texture, colour, cut-out / blend, two-sided). A prefab built from one FBX is baked from that FBX's own node
// transforms (all its meshes the prefab renders, LOD0 only, no collision meshes); a prefab assembled from several FBX
// files (POLYGON Farm's buildings with their doors, the vehicles with their attachments) is baked part by part, each
// mesh placed by its GameObject's transform in the prefab. Output is in metres, Y up, the foot centred on the origin
// unless the source pivot is kept. Textures are converted once (PSD/TGA → PNG, tools/packs_tex.py) and shared.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { readFBX, fbxScene } from './fbx.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const UA = path.join(ROOT, 'UnityAssets');

// ---------------------------------------------------------------- Unity YAML
const REF = /\{fileID: (-?\d+)(?:, guid: ([0-9a-f]{32}), type: \d+)?\}/;
const REFG = new RegExp(REF.source, 'g');
const guidCache = new Map();
export function guidIndex(packDir) {
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
const v3 = (body, key) => { const m = new RegExp(key + ': \\{x: ([-\\d.e]+), y: ([-\\d.e]+), z: ([-\\d.e]+)').exec(body); return m ? [+m[1], +m[2], +m[3]] : null; };
const q4 = (body, key) => { const m = new RegExp(key + ': \\{x: ([-\\d.e]+), y: ([-\\d.e]+), z: ([-\\d.e]+), w: ([-\\d.e]+)').exec(body); return m ? [+m[1], +m[2], +m[3], +m[4]] : null; };
// -> [{ name, mesh: guid, meshID, mats: [guid], T: world matrix (Unity space) } | { name: '*', source, mats }]
export function parsePrefab(file) {
  const text = fs.readFileSync(file, 'utf8'), names = new Map(), filters = new Map(), renderers = [], xforms = new Map(), goXf = new Map();
  for (const { cls, id, body } of docs(text)) {
    const go = new RegExp('m_GameObject: ' + REF.source).exec(body);
    if (cls === 1) names.set(id, (/m_Name: (.*)/.exec(body) || [, id])[1].trim());
    else if (cls === 4 && go) { const f = /m_Father: \{fileID: (-?\d+)/.exec(body); xforms.set(id, { p: v3(body, 'm_LocalPosition') || [0, 0, 0], q: q4(body, 'm_LocalRotation') || [0, 0, 0, 1], s: v3(body, 'm_LocalScale') || [1, 1, 1], father: f ? f[1] : '0' }); goXf.set(go[1], id); }
    else if (cls === 33 && go) { const m = new RegExp('m_Mesh: ' + REF.source).exec(body); if (m && m[2]) filters.set(go[1], { guid: m[2], id: m[1] }); }
    else if ((cls === 23 || cls === 137) && go) {
      if (/m_Enabled: 0/.test(body)) continue;
      const mm = /m_Materials:\s*\n((?:\s*- \{[^}]*\}\s*\n)+)/.exec(body);
      renderers.push({ go: go[1], mats: mm ? [...mm[1].matchAll(REFG)].map(r => r[2]) : [] });
      if (cls === 137) { const m = new RegExp('m_Mesh: ' + REF.source).exec(body); if (m && m[2]) filters.set(go[1], { guid: m[2], id: m[1] }); }
    }
  }
  // a GameObject's transform up to the prefab root, in Unity's (left-handed) space
  const world = goId => { let M = I4(); for (let t = goXf.get(goId), n = 0; t && xforms.has(t) && n < 64; n++) { const x = xforms.get(t); M = mmul(trs(x.p, x.q, x.s), M); t = x.father; if (t === '0') break; } return M; };
  // prefab variants / model prefab instances: the FBX itself with material overrides
  for (const { cls, body } of docs(text)) if (cls === 1001) {
    const sp = new RegExp('m_SourcePrefab: ' + REF.source).exec(body); if (!sp || !sp[2]) continue;
    const mats = []; for (const m of body.matchAll(/propertyPath: m_Materials\.Array\.data\[(\d+)\]\s*\n\s*value:.*\n\s*objectReference: \{fileID: -?\d+, guid: ([0-9a-f]{32})/g)) mats[+m[1]] ??= m[2];
    renderers.push({ name: '*', source: sp[2], mats: mats.filter(Boolean) });
  }
  return renderers.map(r => r.source ? r : { name: names.get(r.go) || r.go, mesh: filters.get(r.go)?.guid, meshID: filters.get(r.go)?.id, mats: r.mats, T: world(r.go) }).filter(r => r.mesh || r.source);
}
// FBX .meta: material name -> .mat guid (externalObjects), mesh fileID -> mesh name (internalIDToNameTable / fileIDToRecycleName)
export function fbxMeta(fbx) {
  const meta = fbx + '.meta', mats = new Map(), meshes = new Map(); if (!fs.existsSync(meta)) return { mats, meshes };
  const t = fs.readFileSync(meta, 'utf8');
  for (const r of t.matchAll(/type: UnityEngine:Material\s*\n\s*assembly: .*\n\s*name: (.*)\n\s*second: \{fileID: \d+, guid: ([0-9a-f]{32})/g)) mats.set(r[1].trim(), r[2]);
  for (const r of t.matchAll(/- first:\s*\n\s*43: (-?\d+)\s*\n\s*second: (.*)/g)) meshes.set(r[1], r[2].trim());
  for (const r of t.matchAll(/^\s*(43\d{5}): (.*)$/gm)) meshes.set(r[1], r[2].trim());
  return { mats, meshes };
}
export function parseMat(file) {
  const t = fs.readFileSync(file, 'utf8'), tex = {}, floats = {}, colors = {};
  for (const m of t.matchAll(/- (\w+):\s*\n\s*m_Texture: \{fileID: -?\d+(?:, guid: ([0-9a-f]{32}), type: \d+)?\}\s*\n\s*m_Scale: \{x: ([-\d.e]+), y: ([-\d.e]+)\}/g)) if (m[2]) tex[m[1]] = { guid: m[2], scale: [+m[3], +m[4]] };
  for (const m of t.matchAll(/^\s*- (\w+): ([-\d.e]+)\s*$/gm)) floats[m[1]] = +m[2];
  for (const m of t.matchAll(/- (\w+): \{r: ([-\d.e]+), g: ([-\d.e]+), b: ([-\d.e]+), a: ([-\d.e]+)\}/g)) colors[m[1]] = [+m[2], +m[3], +m[4], +m[5]];
  return { name: (/m_Name: (.*)/.exec(t) || [, path.basename(file, '.mat')])[1].trim(), tex, floats, colors,
    keywords: (/m_ShaderKeywords: (.*)/.exec(t) || [, ''])[1], queue: +((/m_CustomRenderQueue: (-?\d+)/.exec(t) || [, -1])[1]) };
}
const ALBEDO = ['_BaseMap', '_Base_Map', '_MainTex', '_BaseColorMap', '_Albedo', '_MainTexture', '_Albedo_Map', '_LeafTex', '_Texture'];
const COLOR = ['_Base_Color', '_BaseColor', '_Color', '_Tint', '_Color_Tint']; // (_Base_Color first: the Woodlands shaders tint with it, their _BaseColor stays white)
const FOLIAGE = /leaf|leaves|grass|bush|flower|petal|shrub|reed|card|plant|wheat|foliage|blade|needle/i;
const srgb2lin = c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;

// ---------------------------------------------------------------- matrices (row-major 4x4)
const deg = Math.PI / 180;
const I4 = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const mmul = (a, b) => { const o = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) o[i * 4 + j] += a[i * 4 + k] * b[k * 4 + j]; return o; };
const rot = (r, order = 0) => { // FBX euler degrees, default order XYZ (applied X first)
  const [x, y, z] = r.map(v => +v * deg), cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
  const Rx = [1, 0, 0, 0, 0, cx, -sx, 0, 0, sx, cx, 0, 0, 0, 0, 1], Ry = [cy, 0, sy, 0, 0, 1, 0, 0, -sy, 0, cy, 0, 0, 0, 0, 1], Rz = [cz, -sz, 0, 0, sz, cz, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const seq = [[Rx, Ry, Rz], [Rx, Rz, Ry], [Ry, Rz, Rx], [Ry, Rx, Rz], [Rz, Rx, Ry], [Rz, Ry, Rx]][order] || [Rx, Ry, Rz];
  return mmul(seq[2], mmul(seq[1], seq[0]));
};
const trs = (p, q, s) => { const [x, y, z, w] = q;
  const R = [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 0, 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 0, 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y), 0, 0, 0, 0, 1];
  return mmul([1, 0, 0, p[0], 0, 1, 0, p[1], 0, 0, 1, p[2], 0, 0, 0, 1], mmul(R, [s[0], 0, 0, 0, 0, s[1], 0, 0, 0, 0, s[2], 0, 0, 0, 0, 1])); };
const MX = [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; // the mirror between Unity's left-handed space and glTF's right-handed one
// a node's transform to the model root. preOnly: the 3ds Max exports (Idyllic Anime Japan: geometry Z-up, PreRotation
// -90° X and a compensating +90° Lcl Rotation) stand up in Unity by the PreRotation alone
function worldMatrix(id, models, preOnly = false) {
  let M = I4();
  for (let k = id; k && models.has(k); k = models.get(k).parent) {
    const m = models.get(k), T = [1, 0, 0, +m.T[0], 0, 1, 0, +m.T[1], 0, 0, 1, +m.T[2], 0, 0, 0, 1], S = [+m.S[0], 0, 0, 0, 0, +m.S[1], 0, 0, 0, 0, +m.S[2], 0, 0, 0, 0, 1];
    M = mmul(mmul(T, mmul(rot(m.preR || [0, 0, 0]), preOnly ? S : mmul(rot(m.R, +m.order), S))), M);
  }
  return M;
}
// a mesh node's geometric transform (object offset): translation, rotation, scale applied to its vertices only
const geoMatrix = m => !m || (!m.GT && !m.GR && !m.GS) ? I4() : mmul([1, 0, 0, +(m.GT?.[0] || 0), 0, 1, 0, +(m.GT?.[1] || 0), 0, 0, 1, +(m.GT?.[2] || 0), 0, 0, 0, 1],
  mmul(rot(m.GR || [0, 0, 0]), [+(m.GS?.[0] ?? 1), 0, 0, 0, 0, +(m.GS?.[1] ?? 1), 0, 0, 0, 0, +(m.GS?.[2] ?? 1), 0, 0, 0, 0, 1]));
const xf = (M, p, w = 1) => [M[0] * p[0] + M[1] * p[1] + M[2] * p[2] + M[3] * w, M[4] * p[0] + M[5] * p[1] + M[6] * p[2] + M[7] * w, M[8] * p[0] + M[9] * p[1] + M[10] * p[2] + M[11] * w];
const det3 = M => M[0] * (M[5] * M[10] - M[6] * M[9]) - M[1] * (M[4] * M[10] - M[6] * M[8]) + M[2] * (M[4] * M[9] - M[5] * M[8]);
const NOT_DRAWN = /(?:^|[_\-.\s])LOD\s*[1-9]|collision|collider|_COL\b|^UCX_|shadow ?proxy/i;

// ---------------------------------------------------------------- a pack: its materials and textures, its models baked
// opt: { pack, texDir, texMax, texMaxBig, texBig, materials (overrides by material name), nodeRotation ('pre') }
export class PackBaker {
  constructor(opt) {
    this.opt = opt; this.packDir = path.join(UA, opt.pack); this.guids = guidIndex(this.packDir);
    this.texJobs = new Map(); this.matIndex = new Map(); this.materials = []; this.fbxCache = new Map();
  }
  texOf(guid) {
    const src = this.guids.get(guid); if (!src || !fs.existsSync(src)) return null;
    const o = this.opt, big = o.texBig && new RegExp(o.texBig, 'i').test(path.basename(src));
    if (!this.texJobs.has(src)) this.texJobs.set(src, { src, dst: path.join(o.texDir, path.basename(src).replace(/\.[^.]+$/, '') + '.png'), max: big ? o.texMaxBig || 1024 : o.texMax || 1024, index: this.texJobs.size });
    return this.texJobs.get(src);
  }
  material(guid, fallbackName) {
    const key = guid || 'default:' + fallbackName;
    if (this.matIndex.has(key)) return this.matIndex.get(key);
    const file = guid && this.guids.get(guid);
    const m = file && fs.existsSync(file) && /\.mat$/i.test(file) ? parseMat(file) : { name: fallbackName || 'default', tex: {}, floats: {}, colors: {}, keywords: '', queue: -1 };
    const o = (this.opt.materials || {})[m.name] || {};
    const ak = ALBEDO.find(k => m.tex[k]), ck = COLOR.find(k => m.colors[k]);
    const foliage = o.foliage ?? FOLIAGE.test(m.name);
    const f = m.floats, kw = m.keywords;
    const blend = o.blend ?? (/_ALPHABLEND_ON|_ALPHAPREMULTIPLY_ON|_SURFACE_TYPE_TRANSPARENT/.test(kw) || f._Mode === 2 || f._Mode === 3 || f._Surface === 1);
    const cut = o.cutout ?? (!blend && (/_ALPHATEST_ON/.test(kw) || f._Mode === 1 || f._AlphaClip === 1 || (m.queue >= 2450 && m.queue < 3000) || foliage));
    const col = o.color || (ck ? m.colors[ck] : [1, 1, 1, 1]);
    const mat = { name: m.name, pbrMetallicRoughness: { baseColorFactor: [srgb2lin(col[0]), srgb2lin(col[1]), srgb2lin(col[2]), blend ? (o.opacity ?? col[3]) : 1],
      metallicFactor: o.metalness ?? Math.min(f._Metallic ?? 0, 0.3), roughnessFactor: o.roughness ?? Math.max(0.55, 1 - (f._Glossiness ?? f._Smoothness ?? 0.2)) } };
    const tj = o.texture === false ? null : ak && this.texOf(m.tex[ak].guid);
    if (tj) { mat._tex = tj; const sc = m.tex[ak].scale; if (sc[0] !== 1 || sc[1] !== 1) mat._uvScale = sc; }
    if (blend) mat.alphaMode = 'BLEND'; else if (cut && tj) { mat.alphaMode = 'MASK'; mat.alphaCutoff = o.cutoff ?? f._Cutoff ?? f._AlphaCutoff ?? 0.5; }
    if (o.doubleSided ?? (foliage || blend || f._Cull === 0 || f._CullMode === 0 || f._RenderFace === 2 || f._DoubleSided === 1)) mat.doubleSided = true;
    mat.extras = { wl: { kind: o.kind || (blend ? 'glass' : foliage ? 'foliage' : 'solid'), sway: o.sway ?? (foliage ? 1 : 0) } };
    const i = this.materials.push(mat) - 1; this.matIndex.set(key, i); return i;
  }
  scene(fbx) { if (!this.fbxCache.has(fbx)) { const sc = fbxScene(readFBX(fbx)); this.fbxCache.set(fbx, { sc, meta: fbxMeta(fbx) }); if (this.fbxCache.size > 24) this.fbxCache.delete(this.fbxCache.keys().next().value); } return this.fbxCache.get(fbx); }
  // one triangle list per material: { prims: Map(material -> {pos, nor, uv}), tris }
  // (pre: scale on the raw coordinates before M — the GameObject transforms are in metres; post: after it — the FBX node
  // transforms are in the file's units)
  _emit(prims, g, M, pre, post, upZ, slots, matFor) {
    let tris = 0; const flip = det3(M) < 0;
    for (let t = 0; t < g.pos.length / 9; t++) {
      const si = g.mat[t] ?? 0, mi = matFor(si, slots[si]?.name || 'default');
      let P = prims.get(mi); if (!P) prims.set(mi, P = { pos: [], nor: [], uv: [] });
      for (const v of flip ? [0, 2, 1] : [0, 1, 2]) {
        const i = t * 9 + v * 3; let p = xf(M, [g.pos[i] * pre, g.pos[i + 1] * pre, g.pos[i + 2] * pre]), n = g.nor.length ? xf(M, [g.nor[i], g.nor[i + 1], g.nor[i + 2]], 0) : [0, 1, 0];
        if (upZ) { p = [p[0], p[2], -p[1]]; n = [n[0], n[2], -n[1]]; }
        const nl = Math.hypot(...n) || 1;
        P.pos.push(p[0] * post, p[1] * post, p[2] * post); P.nor.push(n[0] / nl, n[1] / nl, n[2] / nl);
        P.uv.push(g.uv.length ? g.uv[t * 6 + v * 2] : 0, g.uv.length ? 1 - g.uv[t * 6 + v * 2 + 1] : 0);
      }
      tris++;
    }
    return tris;
  }
  // a prefab (path inside the pack) or an FBX on its own -> { prims, tris, dims, src, off } or null.
  // a: { prefab | fbx, scale, skip, pivot ('keep'), meshes (a regexp: only these meshes of the FBX — LOD levels, cards — whatever
  // the prefab draws), offset (the pivot shift of another bake, so LOD levels line up with their LOD0) }
  bake(a) {
    const packDir = this.packDir, guids = this.guids, prims = new Map(); let tris = 0, rends = [], fbx = null, src;
    if (a.prefab) {
      const pf = path.join(packDir, a.prefab); if (!fs.existsSync(pf)) return null;
      rends = parsePrefab(pf); src = pf;
      const srcs = [...new Set(rends.map(r => guids.get(r.mesh || r.source)).filter(p => p && /\.fbx$/i.test(p)))];
      if (!srcs.length) return null;
      if (srcs.length > 1) { // assembled from several FBX files: part by part, each mesh at its GameObject's place
        for (const r of rends) {
          const f = guids.get(r.mesh); if (!f || !/\.fbx$/i.test(f) || !r.T) continue;
          const { sc, meta } = this.scene(f), want = meta.meshes.get(r.meshID) || r.name;
          const g = sc.meshes.find(q => (sc.models.get(q.model)?.name || q.name) === want) || sc.meshes.find(q => q.name === want) || (sc.meshes.length === 1 ? sc.meshes[0] : null);
          if (!g) continue;
          const model = sc.models.get(g.model), unit = Number(sc.settings.UnitScaleFactor?.at(-1) ?? 1) / 100 * (a.scale || 1);
          // Unity mesh = FBX geometry mirrored in X; the GameObject transform is in Unity space; mirror back for glTF
          const S = [unit, 0, 0, 0, 0, unit, 0, 0, 0, 0, unit, 0, 0, 0, 0, 1], M = mmul(mmul(MX, mmul(r.T, MX)), mmul(S, geoMatrix(model))); // (the geometric offset is in the mesh asset)
          tris += this._emit(prims, g, M, 1, 1, false, model?.materials || [], (si, fname) => this.material(r.mats[Math.min(si, r.mats.length - 1)] || meta.mats.get(fname) || null, fname));
        }
        fbx = null;
      } else fbx = srcs[0];
    } else { fbx = path.join(packDir, a.fbx); src = fbx; }
    if (fbx) {
      const { sc, meta } = this.scene(fbx);
      const unit = Number(sc.settings.UnitScaleFactor?.at(-1) ?? 1) / 100 * (a.scale || 1), upZ = Number(sc.settings.UpAxis?.at(-1) ?? 1) === 2;
      for (const g of sc.meshes) {
        const model = sc.models.get(g.model), mname = model?.name || g.name;
        if (a.meshes) { if (!new RegExp(a.meshes, 'i').test(mname) || /collision|collider|^UCX_/i.test(mname)) continue; }
        else if (NOT_DRAWN.test(mname + ' ' + g.name)) continue;
        if (a.skip && new RegExp(a.skip, 'i').test(mname)) continue;
        const r = rends.find(q => q.name === mname) || (a.meshes && rends.find(q => q.name === mname.replace(/LOD\d/i, 'LOD0'))) || (rends.length === 1 ? rends[0] : rends.find(q => q.name === '*'));
        if (rends.length && !r && !a.meshes && rends.some(q => q.name !== '*')) continue; // (a mesh the prefab does not render)
        const M = mmul(worldMatrix(g.model, sc.models, this.opt.nodeRotation === 'pre'), geoMatrix(model));
        tris += this._emit(prims, g, M, 1, unit, upZ, model?.materials || [], (si, fname) => this.material((r && r.mats[Math.min(si, r.mats.length - 1)]) || meta.mats.get(fname) || null, fname));
      }
    }
    if (!tris) return null;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const P of prims.values()) for (let i = 0; i < P.pos.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], P.pos[i + k]); hi[k] = Math.max(hi[k], P.pos[i + k]); }
    const off = a.offset || (a.pivot === 'keep' ? [0, 0, 0] : [-(lo[0] + hi[0]) / 2, -lo[1], -(lo[2] + hi[2]) / 2]);
    for (const P of prims.values()) for (let i = 0; i < P.pos.length; i += 3) for (let k = 0; k < 3; k++) P.pos[i + k] += off[k];
    return { prims, tris, off, dims: hi.map((h, k) => +(h - lo[k]).toFixed(3)), src: path.relative(ROOT, src).replaceAll('\\', '/') };
  }
  // convert every texture used so far (python, skipping the ones already up to date)
  convertTextures(log = false) {
    const jobs = [...this.texJobs.values()]; if (!jobs.length) return jobs;
    const out = execFileSync('python', [path.join(ROOT, 'tools', 'packs_tex.py')], { input: JSON.stringify(jobs.map(({ src, dst, max }) => ({ src, dst, max }))), maxBuffer: 1 << 26 }).toString();
    if (log) for (const l of out.trim().split('\n')) if (/written/.test(l)) console.log('  tex', path.basename(l.split('\t')[0]), l.split('\t')[1]);
    return jobs;
  }
}

// ---------------------------------------------------------------- GLB (indexed meshes, one node per model)
// assets: [{ id, prims, kind, category, dims }], materials: the baker's list, textures: the baker's jobs.
// imageUri(job) -> a relative uri for an external image, or null to embed it. Only the materials and textures the
// assets use are written.
const pad4 = n => (n + 3) & ~3;
export function writeGLB(file, assets, materials, textures, { imageUri = null, generator = 'Wildlands packs' } = {}) {
  const chunks = []; let byteLength = 0;
  const append = data => { const b = Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength), start = byteLength;
    chunks.push(b); byteLength += b.length; const p = pad4(byteLength) - byteLength; if (p) { chunks.push(Buffer.alloc(p)); byteLength += p; } return { byteOffset: start, byteLength: b.length }; };
  const gltf = { asset: { version: '2.0', generator }, scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [{ byteLength: 0 }],
    images: [], textures: [], samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }] };
  const usedM = [...new Set(assets.flatMap(a => [...a.prims.keys()]))].sort((a, b) => a - b), mRemap = new Map(usedM.map((m, i) => [m, i]));
  const usedT = [...new Set(usedM.map(m => materials[m]._tex).filter(Boolean))], tRemap = new Map();
  for (const j of usedT) {
    const uri = imageUri && imageUri(j);
    if (uri) gltf.images.push({ uri, mimeType: 'image/png', name: path.basename(j.dst) });
    else { const v = append(fs.readFileSync(j.dst)), bv = gltf.bufferViews.push({ buffer: 0, ...v }) - 1; gltf.images.push({ bufferView: bv, mimeType: 'image/png', name: path.basename(j.dst) }); }
    tRemap.set(j, gltf.textures.push({ sampler: 0, source: gltf.images.length - 1 }) - 1);
  }
  gltf.materials = usedM.map(i => { const m = materials[i], o = JSON.parse(JSON.stringify({ ...m, _tex: undefined, _uvScale: undefined }));
    if (m._tex) o.pbrMetallicRoughness.baseColorTexture = { index: tRemap.get(m._tex), ...(m._uvScale ? { extensions: { KHR_texture_transform: { scale: m._uvScale } } } : {}) }; return o; });
  if (usedM.some(i => materials[i]._uvScale)) gltf.extensionsUsed = ['KHR_texture_transform'];
  if (!gltf.images.length) { delete gltf.images; delete gltf.textures; delete gltf.samplers; }
  const acc = (arr, type, target, minmax) => { const v = append(arr), bv = gltf.bufferViews.push({ buffer: 0, ...v, ...(target ? { target } : {}) }) - 1;
    const ct = arr instanceof Uint16Array ? 5123 : arr instanceof Uint32Array ? 5125 : 5126, n = { SCALAR: 1, VEC2: 2, VEC3: 3 }[type];
    return gltf.accessors.push({ bufferView: bv, componentType: ct, count: arr.length / n, type, ...(minmax || {}) }) - 1; };
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
        indices: acc(pos.length / 3 > 65535 ? Uint32Array.from(idx) : Uint16Array.from(idx), 'SCALAR', 34963), material: mRemap.get(mi), mode: 4 });
    }
    const mi = gltf.meshes.push(mesh) - 1, ni = gltf.nodes.push({ name: a.id, mesh: mi, extras: { kind: a.kind, category: a.category, dims: a.dims } }) - 1;
    gltf.scenes[0].nodes.push(ni);
  }
  gltf.buffers[0].byteLength = byteLength;
  const bin = Buffer.concat(chunks), json = Buffer.from(JSON.stringify(gltf)), jp = Buffer.alloc(pad4(json.length), 0x20); json.copy(jp);
  const total = 12 + 8 + jp.length + 8 + bin.length, out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jp.length, 12); out.writeUInt32LE(0x4e4f534a, 16); jp.copy(out, 20);
  const bo = 20 + jp.length; out.writeUInt32LE(bin.length, bo); out.writeUInt32LE(0x004e4942, bo + 4); bin.copy(out, bo + 8);
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, out);
  return { hash: crypto.createHash('sha1').update(out).digest('hex').slice(0, 10), bytes: out.length };
}
