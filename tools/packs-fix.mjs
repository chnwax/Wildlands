// node tools/packs-fix.mjs [pack ...] — corrected copies of the library models whose materials the extraction put on the
// wrong parts, without touching ModeleZPaczek/ (the user's sorted library stays as it is).
// The slip: Unity numbers a mesh's sub-meshes by the order in which its materials first occur in the polygons (unused
// material slots dropped) and a renderer's m_Materials follow that numbering; ModeleZPaczek/ was baked by the FBX's raw
// material indices, so on some models (shop buildings, the ramen stall...) roofs, shop windows and walls swapped their
// materials. tools/packs-lib.mjs now numbers sub-meshes as Unity does; this bakes every prefab again, compares its parts
// (material and triangles) with the library's file and, where they differ, writes the corrected model to
//   assets/packs-fix/<the library's path>.glb      (textures: the library's _tekstury/, or assets/packs-fix/_tekstury/
//                                                   for an image the library never needed)
//   assets/packs-fix/poprawki.json                 ({ "<pack>/<model>": "<path>" }: js/packs.js loads these instead)
// assets/packs-fix/ is git-ignored like the library (the pack licences cover the game, not the files).
import fs from 'fs';
import path from 'path';
import { ROOT, UA, PackBaker, writeGLB } from './packs-lib.mjs';

const LIB = path.join(ROOT, 'ModeleZPaczek'), OUT = path.join(ROOT, 'assets', 'packs-fix');
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'packs.json'), 'utf8'));
const kat = JSON.parse(fs.readFileSync(path.join(LIB, 'katalog.json'), 'utf8')).modele;
const PACKS = [{ id: 'anime_japan', pack: 'Idyllic Anime Japan' }, { id: 'polygon_farm', pack: 'Polygon Farm' }, { id: 'illustrated_nature', pack: 'The Illustrated Nature' }, { id: 'idyllic_woodlands', pack: 'Idyllic Woodlands' }];
for (const P of PACKS) P.materials = Object.assign({}, ...Object.values(CFG.libraries).filter(l => l.pack === P.pack).map(l => l.materials || {}));
const only = process.argv.slice(2), safe = s => s.replace(/\.(prefab|fbx)$/i, '').replace(/^SM_|^IL3DN_/, '').replace(/[^\w\-]+/g, '_').replace(/_+$/, '').toLowerCase();
const fixes = fs.existsSync(path.join(OUT, 'poprawki.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'poprawki.json'), 'utf8')) : {};

// a GLB's parts: "material:triangles" sorted
function partsOf(file) {
  const b = fs.readFileSync(file), jl = b.readUInt32LE(12), j = JSON.parse(b.slice(20, 20 + jl).toString());
  return j.meshes.flatMap(m => m.primitives.map(p => j.materials[p.material].name + ':' + (p.indices !== undefined ? j.accessors[p.indices].count / 3 : j.accessors[p.attributes.POSITION].count / 3))).sort().join('|');
}
const prefabsOf = d => { const out = []; const walk = q => { for (const e of fs.readdirSync(q, { withFileTypes: true })) { const p = path.join(q, e.name);
  if (e.isDirectory()) { if (!/^(Scenes|Editor|Scripts|Shaders|Audio|CollisionConvex|CollisionCustom)$/i.test(e.name)) walk(p); } else if (/\.prefab$/i.test(e.name)) out.push(p); } }; walk(d); return out; };

for (const P of PACKS) {
  if (only.length && !only.includes(P.id)) continue;
  const packDir = path.join(UA, P.pack); if (!fs.existsSync(packDir)) continue;
  const baker = new PackBaker({ pack: P.pack, nodeRotation: P.nodeRotation, materials: P.materials, texDir: path.join(OUT, '_tekstury', P.id), texMax: 2048 });
  const todo = [];
  for (const pf of prefabsOf(packDir)) {
    const rel = path.relative(packDir, pf), name = safe(path.basename(pf)), k = P.id + '/' + name, e = kat[k];
    if (!e || e.zrodlo === 'lod' || e.zrodlo === 'card') continue;
    let r; try { r = baker.bake({ prefab: rel }); } catch { continue; } if (!r) continue;
    const mine = [...r.prims.entries()].map(([mi, q]) => baker.materials[mi].name + ':' + q.pos.length / 9).sort().join('|');
    if (mine === partsOf(path.join(LIB, e.plik))) { delete fixes[k]; continue; }
    todo.push({ k, e, r, name });
  }
  if (!todo.length) { console.log(P.pack + ': nothing to correct'); continue; }
  // images: the library's when it has them, else converted here
  const jobs = [...baker.texJobs.values()], have = j => fs.existsSync(path.join(LIB, '_tekstury', P.id, path.basename(j.dst)));
  const missing = jobs.filter(j => !have(j));
  if (missing.length) { baker.texJobs = new Map(missing.map(j => [j.src, j])); baker.convertTextures(); }
  for (const { k, e, r, name } of todo) {
    const file = path.join(OUT, e.plik);
    writeGLB(file, [{ id: name, kind: e.kategoria, category: e.kategoria, ...r }], baker.materials, jobs,
      { imageUri: j => path.relative(path.dirname(file), have(j) ? path.join(LIB, '_tekstury', P.id, path.basename(j.dst)) : j.dst).replaceAll('\\', '/'), generator: 'Wildlands packs-fix' });
    fixes[k] = e.plik;
  }
  console.log(`${P.pack}: ${todo.length} models corrected (${missing.length} images converted): ${todo.map(t => t.name).join(', ')}`);
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'poprawki.json'), JSON.stringify(fixes, null, 1) + '\n');
console.log(`-> assets/packs-fix/: ${Object.keys(fixes).length} corrected models`);
