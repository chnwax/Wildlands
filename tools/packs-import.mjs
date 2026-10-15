// node tools/packs-import.mjs [library ...] — builds the model libraries the game draws from the owned Unity packs
// (UnityAssets/, never modified, never committed). Which models go into which library is listed in tools/packs.json;
// the baking itself is tools/packs-lib.mjs.
// Output: assets/packs/<library>.glb (one node per model, named by its id, textures embedded once per library) and
// assets/packs/manifest.json (sizes, triangle counts, source files, a content hash the game uses to version the URL).
// assets/packs/ is git-ignored: the pack licences allow the models inside the game, not their redistribution as files
// in a public repository. (Every model of every pack, one file each by category: tools/packs-extract.mjs.)
import fs from 'fs';
import path from 'path';
import { ROOT, UA, PackBaker, writeGLB } from './packs-lib.mjs';

const OUT = path.join(ROOT, 'assets', 'packs'), CACHE = path.join(OUT, '.cache');
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'packs.json'), 'utf8'));
const only = process.argv.slice(2);

function buildLibrary(lib, spec) {
  const baker = new PackBaker({ ...spec, texDir: path.join(CACHE, lib) }), assets = [];
  for (const a of spec.assets) {
    const r = baker.bake(a);
    if (!r) { console.warn(`  ${a.id}: no triangles (missing prefab or nothing drawn)`); continue; }
    assets.push({ id: a.id, kind: a.kind || spec.kind || 'prop', category: a.category || null, ...r });
  }
  const textures = baker.convertTextures(true);
  const res = writeGLB(path.join(OUT, lib + '.glb'), assets, baker.materials, textures, { generator: 'Wildlands packs-import' });
  const manifest = {}; for (const a of assets) manifest[a.id] = { kind: a.kind, category: a.category, dims: a.dims, tris: a.tris, src: a.src };
  return { file: lib + '.glb', ...res, assets: manifest };
}

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
