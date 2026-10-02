// The Wildlands world file format: parsing with error locations, validation with readable messages, and the
// deterministic writer (stable key order, 2-space indentation, one object per block) used by the editor, the
// generator export and tools/validate-world.mjs. Plain JavaScript without dependencies: runs in the browser and in Node.
// The format is described for people (and AIs) in WORLD_FORMAT.md and formally in world/schema/world.schema.json.

export const FORMAT = 'wildlands-world/1';
export const ID_RE = /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/;
export const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
// generated ids: <prefab>_<area>_<number>; areas never contain "_"
export const GEN_ID_RE = /^([a-z0-9_]+?)_([a-z0-9]+)_(\d{3,})$/;
export const parseGeneratedId = id => { const m = GEN_ID_RE.exec(id); return m ? { prefab: m[1], area: m[2], n: +m[3] } : null; };

// key order of an object record (also the list of allowed keys)
export const OBJECT_KEYS = ['id', 'name', 'prefab', 'source', 'position', 'rotation', 'scale', 'material', 'materialOverrides', 'slots', 'group', 'tags', 'hidden', 'locked', 'deleted', 'origin'];
export const ELEMENT_KEYS = ['hidden', 'offset', 'rotate', 'scale']; // per-slot element edits
export const OVERRIDE_KEYS = ['material', 'color', 'roughness', 'metalness', 'emissive', 'emissiveIntensity', 'texture', 'opacity'];
const FILE_KEYS = ['format', 'kind', 'map', 'area', 'name', 'note', 'areas', 'generated', 'edits', 'libraries', 'materialEdits', 'fields', 'prefabs', 'materials', 'textures', 'objects'];

// ---------------------------------------------------------------- parsing
// -> { value } or { error: { file, line, col, message } }
export function parseJSON(text, file = '') {
  try { return { value: JSON.parse(text) }; } catch (e) {
    let pos = -1;
    const m = /position (\d+)/.exec(e.message); if (m) pos = +m[1];
    const lc = /line (\d+) column (\d+)/.exec(e.message);
    let line = 0, col = 0;
    if (lc) { line = +lc[1]; col = +lc[2]; }
    else if (pos >= 0) { const before = text.slice(0, pos); line = before.split('\n').length; col = pos - before.lastIndexOf('\n'); }
    const src = line ? (text.split('\n')[line - 1] || '') : '';
    const msg = e.message.replace(/^JSON\.parse: /, '').replace(/ in JSON at position \d+.*$/, '').replace(/ \(line \d+ column \d+\)$/, '');
    const prev = line > 1 ? (text.split('\n')[line - 2] || '') : '';
    const hint = /Expected ','|after property value|after array element/.test(msg) && prev.trim() ? `\n    ${line - 1} | ${prev.trim().slice(0, 140)}   <- probably a missing comma at the end of this line` : '';
    return { error: { file, line, col, message: `invalid JSON: ${msg}` + hint + (src ? `\n    ${line} | ${src.trim().slice(0, 140)}` : '') } };
  }
}

// ---------------------------------------------------------------- validation
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isVec3 = v => Array.isArray(v) && v.length === 3 && v.every(isNum);
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
export function closest(word, list, max = 3) {
  let best = null, bd = 1e9;
  for (const w of list) { const d = lev(String(word).toLowerCase(), w.toLowerCase()); if (d < bd) { bd = d; best = w; } }
  return bd <= Math.max(max, Math.floor(String(word).length / 3)) ? best : null;
}
const didYouMean = (w, list) => { const c = closest(w, list); return c ? ` — did you mean "${c}"?` : ''; };

// problems: [{ level: 'error' | 'warning', file, id, field, message }]
function checkOverride(o, where, P, ctx, allowMaterial) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) { P.error(where, 'must be an object like { "color": "#aabbcc", "roughness": 0.6 }'); return; }
  for (const k of Object.keys(o)) {
    if (allowMaterial && ELEMENT_KEYS.includes(k)) {
      const v = o[k], f = where + '.' + k;
      if (k === 'hidden') { if (typeof v !== 'boolean') P.error(f, 'must be true or false'); }
      else if (!isVec3(v)) P.error(f, `must be three numbers [x, y, z]${k === 'rotate' ? ' in degrees' : k === 'offset' ? ' in metres' : ''}`);
      else if (k === 'scale' && v.some(x => x === 0)) P.error(f, 'scale must not be 0');
      continue;
    }
    if (!OVERRIDE_KEYS.includes(k) || (k === 'material' && !allowMaterial)) { P.error(where + '.' + k, `unknown key "${k}"` + didYouMean(k, OVERRIDE_KEYS.filter(x => allowMaterial || x !== 'material'))); continue; }
    const v = o[k], f = where + '.' + k;
    if (k === 'color' || k === 'emissive') { if (typeof v !== 'string' || !COLOR_RE.test(v)) P.error(f, `must be a hex colour like "#c8b89a", not ${JSON.stringify(v)}`); }
    else if (k === 'roughness' || k === 'metalness' || k === 'opacity') { if (!isNum(v) || v < 0 || v > 1) P.error(f, `must be a number from 0 to 1, not ${JSON.stringify(v)}`); }
    else if (k === 'emissiveIntensity') { if (!isNum(v) || v < 0 || v > 100) P.error(f, `must be a number from 0 to 100, not ${JSON.stringify(v)}`); }
    else if (k === 'texture') { if (v !== null && (typeof v !== 'string' || !v)) P.error(f, 'must be a texture path from the material library (e.g. "tex/brick_wall_02_diff_1k.jpg") or null for none'); else if (v && ctx.textures && !ctx.textures.has(v)) P.warn(f, `texture "${v}" is not in the library` + didYouMean(v, [...ctx.textures])); }
    else if (k === 'material') { if (typeof v !== 'string') P.error(f, 'must be a material name'); else if (ctx.materials && !ctx.materials.has(v)) P.error(f, `unknown material "${v}"` + didYouMean(v, [...ctx.materials])); }
  }
}
function problems(file) {
  const list = [];
  let curId = null;
  return { list, set id(v) { curId = v; },
    error: (field, message) => list.push({ level: 'error', file, id: curId, field, message }),
    warn: (field, message) => list.push({ level: 'warning', file, id: curId, field, message }) };
}
// one object record of an edits file. ctx: { generated: id -> record | undefined, prefabs: Set, materials: Set, textures: Set }
export function validateObject(o, P, ctx = {}) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) { P.error('', 'every entry of "objects" must be an object with at least an "id"'); return false; }
  P.id = typeof o.id === 'string' ? o.id : null;
  const before = P.list.length;
  if (typeof o.id !== 'string' || !ID_RE.test(o.id)) P.error('id', `missing or invalid id ${JSON.stringify(o.id)}: ids are lowercase letters, digits, "_" and "-" (e.g. "bench_danchi_007")`);
  for (const k of Object.keys(o)) if (!OBJECT_KEYS.includes(k)) P.error(k, `unknown key "${k}"` + didYouMean(k, OBJECT_KEYS));
  for (const k of ['position', 'rotation', 'scale', 'origin']) if (k in o && !isVec3(o[k])) P.error(k, `must be three numbers [x, y, z]${k === 'rotation' ? ' in degrees' : k === 'scale' ? '' : ' in metres'}, not ${JSON.stringify(o[k])}`);
  if (isVec3(o.scale) && o.scale.some(v => v === 0 || Math.abs(v) > 1000)) P.error('scale', 'scale must not be 0 (and at most 1000)');
  if (isVec3(o.position) && o.position.some(v => Math.abs(v) > 100000)) P.error('position', 'position is more than 100 km from the origin');
  for (const k of ['name', 'prefab', 'source', 'material', 'group']) if (k in o && (typeof o[k] !== 'string' || (!o[k] && k !== 'group'))) P.error(k, k === 'group' ? 'must be a group name ("" takes a generated object out of its group)' : 'must be a non-empty string');
  if ('name' in o && typeof o.name === 'string' && o.name.length > 160) P.error('name', 'is longer than 160 characters');
  for (const k of ['hidden', 'locked', 'deleted']) if (k in o && typeof o[k] !== 'boolean') P.error(k, 'must be true or false');
  if ('tags' in o && (!Array.isArray(o.tags) || o.tags.some(t => typeof t !== 'string'))) P.error('tags', 'must be a list of strings');
  if ('group' in o && typeof o.group === 'string' && o.group && !ID_RE.test(o.group)) P.error('group', 'group names follow the id rules (lowercase, digits, "_", "-")');
  if ('source' in o && typeof o.source === 'string' && !ID_RE.test(o.source)) P.error('source', 'must be the id of an object');
  if (typeof o.material === 'string' && ctx.materials && !ctx.materials.has(o.material)) P.error('material', `unknown material "${o.material}"` + didYouMean(o.material, [...ctx.materials]));
  if (typeof o.prefab === 'string' && ctx.prefabs && !ctx.prefabs.has(o.prefab)) P.error('prefab', `unknown prefab "${o.prefab}"` + didYouMean(o.prefab, [...ctx.prefabs]));
  if ('materialOverrides' in o) checkOverride(o.materialOverrides, 'materialOverrides', P, ctx, false);
  if ('slots' in o) {
    if (!o.slots || typeof o.slots !== 'object' || Array.isArray(o.slots)) P.error('slots', 'must be an object: { "<slot material>": { "color": "#..." } }');
    else for (const [k, v] of Object.entries(o.slots)) checkOverride(v, 'slots.' + k, P, ctx, true);
  }
  if (typeof o.id === 'string' && ctx.generated) {
    const gen = ctx.generated(o.id);
    if (!gen) {
      if (o.deleted) P.warn('deleted', 'marks an object deleted that the generator does not create (nothing to delete) — remove the entry instead');
      else {
        if (!('prefab' in o) && !('source' in o)) P.error('prefab', 'a new object (its id is not one the generator creates) needs a "prefab" (or a "source" object to copy)');
        if (!('position' in o)) P.error('position', 'a new object needs a "position"');
        // (a missing generated id with an "origin" is matched again by position when the map loads: world/layer.js)
      }
    }
  }
  if (typeof o.source === 'string' && ctx.exists && !ctx.exists(o.source)) P.error('source', `no object "${o.source}" to copy`);
  return P.list.length === before;
}
// a whole file (any kind). Returns problems; ctx as for validateObject plus seen: Map id -> file (duplicates across files)
export function validateFile(doc, file, ctx = {}) {
  const P = problems(file);
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) { P.error('', 'the file must contain one JSON object'); return P.list; }
  if (doc.format !== FORMAT) P.error('format', `must be "${FORMAT}"` + (doc.format ? `, not "${doc.format}"` : ''));
  for (const k of Object.keys(doc)) if (!FILE_KEYS.includes(k)) P.warn(k, `unknown top-level key "${k}"` + didYouMean(k, FILE_KEYS));
  const kind = doc.kind;
  if (!['edits', 'generated', 'index', 'prefabs', 'materialLibrary', 'materials'].includes(kind)) { P.error('kind', `unknown kind ${JSON.stringify(kind)} (edits, generated, index, prefabs, materialLibrary, materials)`); return P.list; }
  if (kind === 'edits' || kind === 'generated') {
    if (!Array.isArray(doc.objects)) { P.error('objects', 'must be a list of objects'); return P.list; }
    doc.objects.forEach((o, i) => {
      if (kind === 'edits') validateObject(o, P, ctx);
      else if (!o || typeof o.id !== 'string' || !isVec3(o.position)) { P.id = o && o.id; P.error(`objects[${i}]`, 'generated objects need id and position'); }
      if (o && typeof o.id === 'string' && ctx.seen) {
        const prev = ctx.seen.get(o.id); P.id = o.id;
        if (prev && prev !== file) P.error('id', `the same id is also in ${prev}: every object may appear in one file only`);
        else if (prev === file) P.error('id', 'appears twice in this file');
        ctx.seen.set(o.id, file);
      }
    });
  }
  if (kind === 'materials') {
    if (!doc.materials || typeof doc.materials !== 'object' || Array.isArray(doc.materials)) P.error('materials', 'must be an object: { "<material name>": { "color": "#..." } }');
    else for (const [name, v] of Object.entries(doc.materials)) {
      P.id = name;
      if (ctx.materials && !ctx.materials.has(name)) P.error('', `unknown material "${name}"` + didYouMean(name, [...ctx.materials]));
      checkOverride(v, 'materials.' + name, P, ctx, false);
    }
  }
  if (kind === 'index') {
    if (!Array.isArray(doc.edits) || doc.edits.some(e => typeof e !== 'string')) P.error('edits', 'must list the edit files, e.g. ["edits/danchi.json"]');
    if (doc.generated && (!Array.isArray(doc.generated) || doc.generated.some(e => typeof e !== 'string'))) P.error('generated', 'must list the generated files');
  }
  return P.list;
}
export const formatProblem = p => `${p.level === 'error' ? 'ERROR' : 'warning'}  ${p.file}${p.id ? '  ·  ' + p.id : ''}${p.field ? '  ·  ' + p.field : ''}\n    ${p.message}`;

// ---------------------------------------------------------------- writing
const round = (v, d) => { const k = 10 ** d, r = Math.round(v * k) / k; return Object.is(r, -0) ? 0 : r; };
const num = (v, d) => JSON.stringify(round(v, d));
const DEC = { position: 3, rotation: 2, scale: 4, origin: 3 };
function val(v, key, ind, inline) {
  if (Array.isArray(v)) {
    if (v.every(x => typeof x === 'number')) return '[' + v.map(x => num(x, DEC[key] ?? 4)).join(', ') + ']';
    if (v.every(x => typeof x !== 'object' || x === null)) return '[' + v.map(x => JSON.stringify(x)).join(', ') + ']';
    return '[\n' + v.map(x => ind + '  ' + val(x, '', ind + '  ', inline)).join(',\n') + '\n' + ind + ']';
  }
  if (v && typeof v === 'object') return obj(v, ind, inline || key === 'materialOverrides' || OVERRIDE_PARENT.has(key) || (Object.keys(v).length > 0 && Object.keys(v).every(k => OVERRIDE_KEYS.includes(k) || ELEMENT_KEYS.includes(k))));
  if (typeof v === 'number') return num(v, 4);
  return JSON.stringify(v);
}
const OVERRIDE_PARENT = new Set(['libraries']);
const orderOf = keys => keys.includes('id') ? OBJECT_KEYS : keys.some(k => OVERRIDE_KEYS.includes(k) || ELEMENT_KEYS.includes(k)) ? [...OVERRIDE_KEYS, ...ELEMENT_KEYS] : null;
function sortKeys(o) {
  const keys = Object.keys(o).filter(k => o[k] !== undefined), order = orderOf(keys);
  if (!order) return keys;
  return keys.sort((a, b) => { const ia = order.indexOf(a), ib = order.indexOf(b); return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || (a < b ? -1 : 1); });
}
function obj(o, ind, inline) {
  const keys = sortKeys(o);
  if (!keys.length) return '{}';
  if (inline) return '{ ' + keys.map(k => JSON.stringify(k) + ': ' + val(o[k], k, ind, true)).join(', ') + ' }';
  return '{\n' + keys.map(k => ind + '  ' + JSON.stringify(k) + ': ' + val(o[k], k, ind + '  ', false)).join(',\n') + '\n' + ind + '}';
}
const idCmp = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
// whole file. opts.compact: one object per line (generated files); otherwise one object per indented block
export function stringifyWorldFile(doc, { compact = false } = {}) {
  const top = FILE_KEYS.filter(k => k in doc && doc[k] !== undefined).concat(Object.keys(doc).filter(k => !FILE_KEYS.includes(k)));
  const lines = top.map(k => {
    const v = doc[k];
    if (k === 'objects' || k === 'prefabs' || (k === 'materials' && Array.isArray(v)) || k === 'fields') {
      const list = k === 'objects' ? [...v].sort(idCmp) : v;
      if (!list.length) return `  ${JSON.stringify(k)}: []`;
      return `  ${JSON.stringify(k)}: [\n` + list.map(o => '    ' + (compact || k !== 'objects' ? obj(o, '    ', true) : obj(o, '    ', false))).join(',\n') + '\n  ]';
    }
    if (k === 'materials' && v && typeof v === 'object') {
      const names = Object.keys(v).sort();
      if (!names.length) return '  "materials": {}';
      return '  "materials": {\n' + names.map(n => `    ${JSON.stringify(n)}: ${obj(v[n], '    ', true)}`).join(',\n') + '\n  }';
    }
    return `  ${JSON.stringify(k)}: ${val(v, k, '  ', false)}`;
  });
  return '{\n' + lines.join(',\n') + '\n}\n';
}
// numbers as written (so a record compares equal to its saved form)
export function roundRecord(o) {
  const r = {};
  for (const k of Object.keys(o)) { const v = o[k]; r[k] = Array.isArray(v) && v.every(x => typeof x === 'number') ? v.map(x => round(x, DEC[k] ?? 4)) : v; }
  return r;
}
export const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);
