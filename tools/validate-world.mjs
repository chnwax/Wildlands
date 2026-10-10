// npm run validate-world [-- town] — checks the world files of every map (or the one named) and prints readable
// problems: file, object id, field, what is wrong (and the closest valid name when something is misspelled).
// Exit code 1 when there is an error, 0 when the world is valid (warnings are printed but do not fail).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { FORMAT, parseJSON, validateFile, formatProblem, parseGeneratedId } from '../js/world/format.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORLD = path.join(ROOT, 'world');
const only = process.argv[2];
const rel = p => path.relative(ROOT, p).split(path.sep).join('/');
const C = process.stdout.isTTY ? { r: '\x1b[31m', y: '\x1b[33m', g: '\x1b[32m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' } : { r: '', y: '', g: '', d: '', b: '', x: '' };
let errors = 0, warnings = 0, files = 0, objects = 0;
const report = p => { if (p.level === 'error') errors++; else warnings++; console.log((p.level === 'error' ? C.r : C.y) + formatProblem(p) + C.x); };
function read(abs) {
  files++;
  const text = fs.readFileSync(abs, 'utf8'), r = parseJSON(text, rel(abs));
  if (r.error) { report({ level: 'error', file: rel(abs), id: null, field: '', message: r.error.message + (r.error.line ? `  (line ${r.error.line}, column ${r.error.col})` : '') }); return null; }
  return r.value;
}
if (!fs.existsSync(WORLD)) { console.log('no world/ folder: open the editor once (npm run editor) or run npm run regenerate-world'); process.exit(0); }
const maps = fs.readdirSync(WORLD).filter(d => fs.statSync(path.join(WORLD, d)).isDirectory() && d !== 'schema' && (!only || d === only));
for (const map of maps) {
  const dir = path.join(WORLD, map), ixPath = path.join(dir, 'world.json');
  console.log(`${C.b}${map}${C.x}`);
  if (!fs.existsSync(ixPath)) { report({ level: 'error', file: rel(ixPath), id: null, field: '', message: 'missing: run npm run regenerate-world' }); continue; }
  const ix = read(ixPath); if (!ix) continue;
  for (const p of validateFile(ix, rel(ixPath))) report(p);
  // libraries
  const prefabsDoc = fs.existsSync(path.join(dir, 'prefabs.json')) ? read(path.join(dir, 'prefabs.json')) : null;
  const matsDoc = fs.existsSync(path.join(dir, 'materials.json')) ? read(path.join(dir, 'materials.json')) : null;
  const prefabs = prefabsDoc ? new Set(prefabsDoc.prefabs.map(p => p.name)) : null;
  const materials = matsDoc ? new Set(matsDoc.materials.map(m => m.name)) : null;
  const textures = matsDoc && matsDoc.textures ? new Set(matsDoc.textures) : null;
  // generated ids: listed objects, plus field plants (numbered per prefab and area up to their count)
  const gen = new Map(), fieldCount = new Map();
  for (const g of ix.generated || []) {
    const abs = path.join(dir, g); if (!fs.existsSync(abs)) { report({ level: 'warning', file: rel(abs), id: null, field: '', message: 'listed in world.json but missing (regenerate)' }); continue; }
    const d = read(abs); if (!d) continue;
    for (const o of d.objects || []) gen.set(o.id, o);
    for (const f of d.fields || []) for (const [a, n] of Object.entries(f.areas || {})) fieldCount.set(f.prefab + '|' + a, n);
  }
  const generated = id => { if (gen.has(id)) return gen.get(id); if (/^detail_m\d+_t\d+$/.test(id)) return { id }; const g = parseGeneratedId(id); return g && g.n <= (fieldCount.get(g.prefab + '|' + g.area) || 0) ? { id } : null; };
  const seen = new Map(), all = [];
  const editsDir = path.join(dir, 'edits'), listed = new Set(ix.edits || []);
  if (ix.materialEdits) listed.add(ix.materialEdits);
  // first pass: collect ids (sources may point into other files)
  const docs = [];
  for (const e of listed) { const abs = path.join(dir, e); if (!fs.existsSync(abs)) { report({ level: 'error', file: rel(abs), id: null, field: '', message: 'listed in world.json but the file does not exist' }); continue; } const d = read(abs); if (d) { docs.push([abs, d]); for (const o of d.objects || []) if (o && o.id) all.push(o.id); } }
  if (fs.existsSync(editsDir)) for (const f of fs.readdirSync(editsDir)) if (f.endsWith('.json') && !listed.has('edits/' + f)) report({ level: 'warning', file: rel(path.join(editsDir, f)), id: null, field: '', message: 'not listed in world.json "edits": the game does not load it' });
  const ids = new Set(all);
  for (const [abs, d] of docs) {
    for (const p of validateFile(d, rel(abs), { generated, prefabs, materials, textures, seen, exists: id => gen.has(id) || ids.has(id) || !!generated(id) })) report(p);
    objects += (d.objects || []).length;
  }
  console.log(`${C.d}  ${gen.size} generated objects, ${docs.length} edit file(s)${C.x}`);
}
console.log(errors ? `${C.r}${C.b}${errors} error(s)${C.x}, ${warnings} warning(s) in ${files} file(s)` : `${C.g}${C.b}world valid${C.x} — ${files} file(s), ${objects} edited object(s)${warnings ? `, ${warnings} warning(s)` : ''}`);
process.exit(errors ? 1 : 0);
