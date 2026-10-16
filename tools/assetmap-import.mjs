// Builds the deliberately small asset-map prototype set from the owned Unity packages.
// Source FBX/textures are read only. Output GLBs are normalised to metres, Y-up,
// centred on X/Z and grounded at Y=0 so the runtime map can place them predictably.
// No external packages are required: the project FBX reader and a tiny GLB writer are used.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFBX, fbxScene } from './fbx.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'assets', 'models', 'assetmap');
const U = path.join(ROOT, 'UnityAssets');
const animeTex = name => path.join(U, 'Idyllic Anime Japan', 'Materials', 'Textures', name);
const farmTex = name => path.join(U, 'Polygon Farm', 'Textures', name);
const woodlandTex = name => path.join(U, 'Idyllic Woodlands', 'Textures', 'Leaves', name);

const anime = {
  M_walls_building: 'M_wall_linepattern2_diff.png',
  M_roof_panels_japan: 'M_roof_panels_japan_BaseMap_black.png',
  M_roof_base: 'M_basetexture_stylized_02.png',
  M_windows: 'M_windows_BaseMap_wooden.png',
  M_window_alt: 'M_windows_BaseMap_wooden.png',
  M_edge_wall: 'M_basetexture_stylized_02.png',
  M_ventilations: 'M_ventilations_BaseMap.png',
  M_shopscreens_01: 'M_shopscreens_01_BaseMap.png',
  M_shopscreens_02: 'M_shopscreens_02_BaseMap.png',
  M_frames_window: 'M_frames_window_BaseMap_wooden.png',
  M_frames_window_alt: 'M_frames_window_BaseMap_wooden.png',
  M_windowfence: 'M_windowfence_BaseMap_wooden.png',
  M_cables: 'M_cables_BaseMap.png',
  M_pipes_thin: 'M_basetexture_stylized_02.png',
  M_pipes: 'M_basetexture_stylized_02.png',
  M_door_details: 'M_door_details_BaseMap.png',
  M_door_base: 'M_door_base_BaseMap.png',
  M_fuseboxes: 'M_fuseboxes_BaseMap.png',
  M_edge_roof: 'M_basetexture_stylized_02.png',
  M_walls_japan_poarch: 'M_walls_japan_poarch_BaseMap.png',
  M_entrance_fence: 'M_entrance_fence_BaseMap.png',
  M_bike_japan: 'M_bike_japan_BaseMap.png',
  M_moped: 'M_moped_BaseMap_red.png',
  M_mailboxes: 'M_mailboxes_BaseMap.png',
  M_trashcans: 'M_trashcans_BaseMap.png',
  M_flowerpots: 'M_flowerpots_BaseMap.png',
  M_wooden_assets: 'M_wooden_assets_BaseMap.png',
  M_extras_pole: 'M_extras_pole_BaseMap.png',
  M_lamps_japan: 'M_lamps_japan_BaseMap.png',
  M_tree_base: 'M_tree_base_BaseMap.png',
};

function animeMaterial(name) {
  if (/glass/i.test(name)) return { color: [0.3, 0.52, 0.6, 0.28], alpha: 'BLEND', doubleSided: true, roughness: 0.16 };
  if (/^M_leaves(?:\.001)?$/i.test(name)) return { texture: animeTex('M_leaves_standard.png'), color: [0.72, 0.92, 0.64, 1], alpha: 'MASK', cutoff: 0.18, doubleSided: true, roughness: 1 };
  if (name === 'M_light_emissive') return { color: [1, 0.78, 0.38, 1], emissive: [1, 0.54, 0.16], roughness: 0.3 };
  if (/cables_black/i.test(name)) return { color: [0.035, 0.045, 0.055, 1], roughness: 0.8 };
  const tex = anime[name];
  return tex ? { texture: animeTex(tex), roughness: /bike|moped|mailbox|lamp|extras/i.test(name) ? 0.62 : 0.86 } : null;
}

const animeSpec = (id, folder, file) => ({
  id, pack: 'Idyllic Anime Japan 1.1.1',
  src: path.join(U, 'Idyllic Anime Japan', 'FBX Files', folder, file),
  material: animeMaterial,
});

const specs = [
  {
    id: 'anime-house-03', pack: 'Idyllic Anime Japan 1.1.1',
    src: path.join(U, 'Idyllic Anime Japan', 'FBX Files', 'buildings', 'SM_house_residential_building_03.fbx'),
    material: animeMaterial,
  },
  animeSpec('anime-house-01', 'buildings', 'SM_house_residential_building_01.fbx'),
  animeSpec('anime-house-02', 'buildings', 'SM_house_residential_building_02.fbx'),
  animeSpec('anime-wall-fence', 'Modular', 'SM_wall_fence.fbx'),
  animeSpec('anime-entrance-fence', 'Modular', 'SM_entrance_fence.fbx'),
  animeSpec('anime-wall-pillar', 'Modular', 'SM_wall_pillar.fbx'),
  animeSpec('anime-airconditioner-01', 'Props', 'SM_airconditioner_01.fbx'),
  animeSpec('anime-bicycle', 'Props', 'SM_bicycle.fbx'),
  animeSpec('anime-moped', 'Props', 'SM_mofa_vehicle.fbx'),
  animeSpec('anime-mailbox', 'Props', 'SM_mailbox_resident_01.fbx'),
  animeSpec('anime-trash-can', 'Props', 'SM_trash_can_01.fbx'),
  animeSpec('anime-flowerpot-03', 'Props', 'SM_flowerpot_03.fbx'),
  animeSpec('anime-utility-pole-01', 'Street Assets', 'SM_utility_pole_01.fbx'),
  animeSpec('anime-lamp-01', 'Street Assets', 'SM_lamp_01.fbx'),
  animeSpec('anime-bush-01', 'Nature', 'SM_bush_01.fbx'),
  animeSpec('anime-tree-garden', 'Nature', 'SM_tree_garden.fbx'),
  {
    id: 'woodlands-tree-01', pack: 'Idyllic Woodlands 1.2',
    src: path.join(U, 'Idyllic Woodlands', 'Models', 'Environment', 'Tree01.fbx'),
    material(name) {
      if (name === 'Leaves') return { texture: woodlandTex('Leaves_BaseColor.png'), color: [0.82, 1, 0.77, 1], alpha: 'MASK', cutoff: 0.18, doubleSided: true, roughness: 0.9 };
      if (name === 'Wood') return { color: [0.31, 0.18, 0.09, 1], roughness: 1 };
      return null;
    },
  },
  {
    id: 'illustrated-boulder-01', pack: 'The Illustrated Nature 1.9',
    src: path.join(U, 'The Illustrated Nature', 'Graphics', 'Meshes', 'IL3DN_Rock_Boulder_01.fbx'),
    material: () => ({ color: [0.58, 0.52, 0.45, 1], roughness: 1 }),
  },
  {
    id: 'illustrated-flower-01', pack: 'The Illustrated Nature 1.9',
    src: path.join(U, 'The Illustrated Nature', 'Graphics', 'Meshes', 'IL3DN_Plant_Flower_01.fbx'),
    material(name) {
      return /White/i.test(name) ? { color: [1, 0.78, 0.2, 1], roughness: 0.9, doubleSided: true }
        : { color: [0.25, 0.52, 0.16, 1], roughness: 1, doubleSided: true };
    },
  },
  {
    id: 'farm-greenhouse-small', pack: 'POLYGON Farm 1.6.4',
    src: path.join(U, 'Polygon Farm', 'Models', 'SM_Bld_Greenhouse_01.fbx'),
    material(name, model) {
      if (/Glass/i.test(model)) return { color: [0.72, 0.9, 0.87, 0.24], alpha: 'BLEND', doubleSided: true, roughness: 0.1 };
      return { texture: farmTex('PolygonFarm_Texture_01_A.png'), roughness: 0.82 };
    },
  },
  {
    id: 'farm-tomato', pack: 'POLYGON Farm 1.6.4',
    src: path.join(U, 'Polygon Farm', 'Models', 'SM_Prop_Plant_Bush_02_Tomato.fbx'),
    material(name) {
      return /Leaves/i.test(name) ? { color: [0.24, 0.53, 0.18, 1], roughness: 1, doubleSided: true }
        : { texture: farmTex('PolygonFarm_Texture_01_A.png'), roughness: 0.9 };
    },
  },
  {
    id: 'farm-wire-fence', pack: 'POLYGON Farm 1.6.4',
    src: path.join(U, 'Polygon Farm', 'Models', 'SM_Prop_Fence_Wire_01.fbx'),
    material: () => ({ texture: farmTex('PolygonFarm_Texture_01_A.png'), roughness: 0.8, doubleSided: true }),
  },
  {
    id: 'farm-crate', pack: 'POLYGON Farm 1.6.4',
    src: path.join(U, 'Polygon Farm', 'Models', 'SM_Prop_Crate_01.fbx'),
    material: () => ({ texture: farmTex('PolygonFarm_Texture_01_A.png'), roughness: 0.9 }),
  },
];

const deg = Math.PI / 180;
function xform(id, models) {
  const chain = [];
  for (let k = id; k && models.has(k); k = models.get(k).parent) chain.push(models.get(k));
  return p => {
    let [x, y, z] = p;
    for (const m of chain) {
      x *= m.S[0]; y *= m.S[1]; z *= m.S[2];
      for (const [axis, angle] of [[0, m.R[0]], [1, m.R[1]], [2, m.R[2]]]) {
        if (!angle) continue;
        const c = Math.cos(angle * deg), s = Math.sin(angle * deg);
        if (axis === 0) [y, z] = [y * c - z * s, y * s + z * c];
        else if (axis === 1) [x, z] = [x * c + z * s, -x * s + z * c];
        else [x, y] = [x * c - y * s, x * s + y * c];
      }
      x += m.T[0]; y += m.T[1]; z += m.T[2];
    }
    return [x, y, z];
  };
}
function normalXform(id, models) {
  const f = xform(id, models), o = f([0, 0, 0]);
  return n => {
    const p = f(n), x = p[0] - o[0], y = p[1] - o[1], z = p[2] - o[2], l = Math.hypot(x, y, z) || 1;
    return [x / l, y / l, z / l];
  };
}
const pad4 = n => (n + 3) & ~3;

function writeGLB(spec) {
  const sc = fbxScene(readFBX(spec.src));
  const unit = Number(sc.settings.UnitScaleFactor?.at(-1) ?? 1) / 100;
  const groups = new Map();
  let sourceTriangles = 0;
  for (const g of sc.meshes) {
    const model = sc.models.get(g.model), modelName = model?.name || g.name;
    const lm = /(?:^|[_\-.])LOD\s*([0-9]+)/i.exec(modelName + ' ' + g.name);
    if (lm && lm[1] !== '0') continue;
    const P = xform(g.model, sc.models), N = normalXform(g.model, sc.models), mats = model?.materials || [];
    for (let t = 0; t < g.pos.length / 9; t++) {
      const mi = g.mat[t] ?? 0, mn = mats[mi]?.name || `material-${mi}`, key = modelName + '|' + mn;
      let q = groups.get(key);
      if (!q) { q = { modelName, materialName: mn, color: mats[mi]?.color || [0.8, 0.8, 0.8], pos: [], nor: [], uv: [] }; groups.set(key, q); }
      for (let v = 0; v < 3; v++) {
        const i = t * 9 + v * 3, p = P([g.pos[i], g.pos[i + 1], g.pos[i + 2]]), n = g.nor.length ? N([g.nor[i], g.nor[i + 1], g.nor[i + 2]]) : [0, 1, 0];
        q.pos.push(p[0] * unit, p[1] * unit, p[2] * unit); q.nor.push(...n);
        q.uv.push(g.uv.length ? g.uv[t * 6 + v * 2] : 0, g.uv.length ? 1 - g.uv[t * 6 + v * 2 + 1] : 0);
      }
      sourceTriangles++;
    }
  }
  if (!sourceTriangles) throw new Error(`${spec.id}: no triangles`);

  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const q of groups.values()) for (let i = 0; i < q.pos.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], q.pos[i + k]); hi[k] = Math.max(hi[k], q.pos[i + k]); }
  const off = [-(lo[0] + hi[0]) / 2, -lo[1], -(lo[2] + hi[2]) / 2];
  for (const q of groups.values()) for (let i = 0; i < q.pos.length; i += 3) { q.pos[i] += off[0]; q.pos[i + 1] += off[1]; q.pos[i + 2] += off[2]; }
  const dims = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];

  const chunks = [];
  let byteLength = 0;
  const append = data => {
    const b = Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength), start = byteLength;
    chunks.push(b); byteLength += b.length;
    const p = pad4(byteLength) - byteLength; if (p) { chunks.push(Buffer.alloc(p)); byteLength += p; }
    return { byteOffset: start, byteLength: b.length };
  };
  const gltf = { asset: { version: '2.0', generator: 'Wildlands assetmap-import' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: spec.id, mesh: 0 }], meshes: [{ name: spec.id, primitives: [] }], materials: [], accessors: [], bufferViews: [], buffers: [{ byteLength: 0 }], images: [], textures: [], samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }] };
  const imageIndex = new Map();
  const texture = file => {
    if (imageIndex.has(file)) return imageIndex.get(file);
    const ext = path.extname(file).toLowerCase(), mime = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : null;
    if (!mime) throw new Error(`${spec.id}: GLB image must be PNG/JPEG: ${file}`);
    const v = append(fs.readFileSync(file)), bv = gltf.bufferViews.push({ buffer: 0, ...v }) - 1, im = gltf.images.push({ bufferView: bv, mimeType: mime, name: path.basename(file) }) - 1;
    const tx = gltf.textures.push({ sampler: 0, source: im }) - 1; imageIndex.set(file, tx); return tx;
  };
  const accessor = (arr, type, target, min, max) => {
    const v = append(arr), bv = gltf.bufferViews.push({ buffer: 0, ...v, target }) - 1;
    return gltf.accessors.push({ bufferView: bv, componentType: 5126, count: arr.length / (type === 'VEC3' ? 3 : 2), type, ...(min ? { min, max } : {}) }) - 1;
  };
  for (const q of groups.values()) {
    const p = Float32Array.from(q.pos), n = Float32Array.from(q.nor), uv = Float32Array.from(q.uv);
    const pmin = [Infinity, Infinity, Infinity], pmax = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) { pmin[k] = Math.min(pmin[k], p[i + k]); pmax[k] = Math.max(pmax[k], p[i + k]); }
    const mi = gltf.materials.length, cfg = spec.material(q.materialName, q.modelName) || {};
    const color = cfg.color || (cfg.texture ? [1, 1, 1, 1] : [...q.color, 1]);
    const mat = { name: `${q.modelName}:${q.materialName}`, pbrMetallicRoughness: { baseColorFactor: color, metallicFactor: cfg.metalness || 0, roughnessFactor: cfg.roughness ?? 0.9 } };
    if (cfg.texture) mat.pbrMetallicRoughness.baseColorTexture = { index: texture(cfg.texture) };
    if (cfg.alpha) mat.alphaMode = cfg.alpha;
    if (cfg.cutoff !== undefined) mat.alphaCutoff = cfg.cutoff;
    if (cfg.doubleSided) mat.doubleSided = true;
    if (cfg.emissive) mat.emissiveFactor = cfg.emissive;
    gltf.materials.push(mat);
    gltf.meshes[0].primitives.push({ attributes: { POSITION: accessor(p, 'VEC3', 34962, pmin, pmax), NORMAL: accessor(n, 'VEC3', 34962), TEXCOORD_0: accessor(uv, 'VEC2', 34962) }, material: mi, mode: 4 });
  }
  gltf.buffers[0].byteLength = byteLength;
  const bin = Buffer.concat(chunks), json = Buffer.from(JSON.stringify(gltf)), jsonPadded = Buffer.alloc(pad4(json.length), 0x20); json.copy(jsonPadded);
  const total = 12 + 8 + jsonPadded.length + 8 + bin.length, out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonPadded.length, 12); out.writeUInt32LE(0x4e4f534a, 16); jsonPadded.copy(out, 20);
  const bo = 20 + jsonPadded.length; out.writeUInt32LE(bin.length, bo); out.writeUInt32LE(0x004e4942, bo + 4); bin.copy(out, bo + 8);
  fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, spec.id + '.glb'), out);
  return { id: spec.id, pack: spec.pack, source: path.relative(ROOT, spec.src).replaceAll('\\', '/'), file: `assets/models/assetmap/${spec.id}.glb`, dimensions: dims.map(v => +v.toFixed(4)), triangles: sourceTriangles, materials: gltf.materials.length, bytes: out.length };
}

const manifest = { generated: new Date().toISOString(), units: 'metres', up: 'Y', assets: [] };
for (const spec of specs) { const m = writeGLB(spec); manifest.assets.push(m); console.log(m.id, m.dimensions.join(' x '), m.triangles + ' tri', m.materials + ' mats', Math.round(m.bytes / 1024) + ' KiB'); }
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
