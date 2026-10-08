// The editor's document: the edit records of every world file (world/<map>/edits/*.json and edits/materials.json),
// which file each object belongs to, dirty tracking, saving, reloading files changed on disk, and the command history.
// Every change goes through a command that stores the records before and after (never a snapshot of the world), so
// each operation — transform, create, delete, material, rename, group, hide, lock, shared material — undoes exactly.
import * as F from '../world/format.js';
import { io, hashText } from './io.js';

const clone = o => o == null ? o : JSON.parse(JSON.stringify(o));
const HISTORY = 500;
const TRANSFORM = ['position', 'rotation', 'scale'], TOL = { position: 5e-4, rotation: 5e-3, scale: 5e-5 };
const close = (a, b, t) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= t);

export class Doc {
  constructor(layer, map) {
    this.layer = layer; this.map = map; this.base = `world/${map}/`;
    this.ov = new Map();        // id -> edit record (as in the file)
    this.fileOf = new Map();    // id -> path relative to world/<map>/ ("edits/danchi.json")
    this.files = new Map();     // path -> { savedText, readOnly, problems, conflict }
    this.mats = new Map();      // shared material edits: name -> props
    this.index = clone(layer.index) || { format: F.FORMAT, kind: 'index', map, edits: [] };
    if (!Array.isArray(this.index.edits)) this.index.edits = [];
    this.dirty = new Set(); this.undoStack = []; this.redoStack = []; this.listeners = new Set();
    this.matFile = this.index.materialEdits || 'edits/materials.json';
    for (const f of layer.files.values()) this.adoptFile(f);
    // edits whose id moved (generator changed): rename them to the object they now apply to
    for (const p of layer.problems) if (p.rebound && this.ov.has(p.id)) {
      const rec = this.ov.get(p.id), path = this.fileOf.get(p.id);
      this.ov.delete(p.id); this.fileOf.delete(p.id);
      this.ov.set(p.rebound, { ...rec, id: p.rebound }); this.fileOf.set(p.rebound, path); this.dirty.add(path);
    }
  }
  adoptFile(f) {
    // a file with errors is never overwritten (its invalid entries would be lost): it stays read-only until it is fixed
    const info = { savedText: f.text, readOnly: !f.doc || f.problems.some(q => q.level === 'error'), problems: f.problems };
    this.files.set(f.path, info);
    if (!f.doc) return;
    if (f.doc.kind === 'materials') { this.matFile = f.path; for (const [n, v] of Object.entries(f.doc.materials || {})) this.mats.set(n, { ...v }); return; }
    for (const r of f.records) { this.ov.set(r.id, clone(r)); this.fileOf.set(r.id, f.path); }
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(ev) { for (const f of this.listeners) f(ev); }
  // ---------------------------------------------------------------- reading
  ent(id) { return this.layer.get(id); }
  isAdded(id) { const e = this.ent(id); return !!e && e.kind === 'added'; }
  // the object's full current record (generated values with its edit on top)
  rec(id) {
    const e = this.ent(id); if (!e) return null;
    const o = this.ov.get(id);
    return e.kind === 'added' ? clone(o) : clone(this.layer.effective(e, o || {}));
  }
  status(id) { const e = this.ent(id); if (!e) return null; if (e.kind === 'added') return 'new'; const o = this.ov.get(id); return !o ? '' : o.deleted ? 'deleted' : 'modified'; }
  // minimal edit record turning generated `gen` into `full` (null when nothing differs)
  diff(gen, full) {
    const out = { id: full.id };
    for (const k of TRANSFORM) if (!close(full[k], gen[k], TOL[k])) out[k] = full[k];
    for (const k of ['name', 'material', 'group', 'hidden', 'locked', 'deleted']) if (full[k] !== undefined && full[k] !== gen[k] && !(full[k] === false && gen[k] === undefined)) out[k] = full[k];
    if (full.group === undefined && gen.group !== undefined) out.group = '';
    if (full.tags && !F.sameValue(full.tags, gen.tags)) out.tags = full.tags;
    if (full.materialOverrides && Object.keys(full.materialOverrides).length) out.materialOverrides = full.materialOverrides;
    if (full.slots && Object.keys(full.slots).length) out.slots = full.slots;
    if (Object.keys(out).length === 1) return null;
    out.origin = gen.position.slice();
    return F.roundRecord(out);
  }
  // ---------------------------------------------------------------- commands
  // changes: [{ id, before, after }] — edit records (null: none / object absent); mats: [{ name, before, after }]
  exec(cmd, push = true) {
    this.applyChanges(cmd.changes || [], 'after', cmd.mats || []);
    if (push) { this.undoStack.push(cmd); if (this.undoStack.length > HISTORY) this.undoStack.shift(); this.redoStack.length = 0; }
    this.emit({ type: 'change', cmd, ids: (cmd.changes || []).map(c => c.id) });
  }
  undo() { const c = this.undoStack.pop(); if (!c) return null; this.applyChanges([...(c.changes || [])].reverse(), 'before', c.mats || []); this.redoStack.push(c); this.emit({ type: 'change', cmd: c, undo: true, ids: (c.changes || []).map(x => x.id) }); return c; }
  redo() { const c = this.redoStack.pop(); if (!c) return null; this.applyChanges(c.changes || [], 'after', c.mats || []); this.undoStack.push(c); this.emit({ type: 'change', cmd: c, redo: true, ids: (c.changes || []).map(x => x.id) }); return c; }
  applyChanges(changes, side, mats) {
    for (const m of mats) { const v = m[side]; if (v) this.mats.set(m.name, clone(v)); else this.mats.delete(m.name); this.layer.setShared(m.name, v || {}); this.dirty.add(this.matFile); this.ensureListed(this.matFile, true); }
    for (const c of changes) {
      const v = c[side], ent = this.ent(c.id);
      const path = this.fileOf.get(c.id) || c.file || this.fileFor(c.id, v);
      if (v) { this.ov.set(c.id, clone(v)); this.fileOf.set(c.id, path); } else { this.ov.delete(c.id); }
      this.dirty.add(path); this.ensureListed(path);
      this.sync(ent, v);
    }
  }
  // bring the scene in line with an object's edit record (v null: no edit / the added object is gone)
  sync(ent, v) {
    const L = this.layer;
    if (ent && ent.kind !== 'added') return L.apply(ent, L.effective(ent, v || {}));
    if (!v) { if (ent) L.removeAdded(ent); return; }
    if (ent && ent.srcKey === (v.source || '') + '|' + (v.prefab || '') + '|' + (v.part || '')) return L.apply(ent, v); // same look: only move / recolour
    if (!L.createAdded(v)) console.warn('could not create', v.id, v);
  }
  fileFor(id, rec) {
    const e = this.ent(id);
    const area = e && e.kind !== 'added' ? e.area : rec && rec.position && this.layer.areaOf ? this.layer.areaOf(rec.position[0], rec.position[2]) : 'world';
    return `edits/${area}.json`;
  }
  ensureListed(path, mat = false) {
    if (mat) { if (this.index.materialEdits !== path) { this.index.materialEdits = path; this.indexDirty = true; } return; }
    if (!this.index.edits.includes(path)) { this.index.edits.push(path); this.index.edits.sort(); this.indexDirty = true; }
  }
  // edit helper: fn(full record) -> new full record; one command for all ids
  edit(ids, fn, label) {
    const changes = [];
    for (const id of ids) {
      const e = this.ent(id); if (!e) continue;
      const full = this.rec(id), next = fn(clone(full), id); if (!next) continue;
      const before = clone(this.ov.get(id)) || null;
      const after = e.kind === 'added' ? F.roundRecord(next) : this.diff(this.layer.generatedRecord(e), next);
      if (F.sameValue(before, after)) continue;
      changes.push({ id, before, after });
    }
    if (changes.length) this.exec({ label, changes });
    return changes.length;
  }
  // new objects (records complete); returns ids
  add(recs, label) {
    const changes = recs.map(r => ({ id: r.id, before: null, after: F.roundRecord(r), file: this.fileFor(r.id, r) }));
    this.exec({ label, changes });
    return changes.map(c => c.id);
  }
  // delete: added objects disappear, generated ones are marked deleted
  remove(ids, label = 'Delete') {
    const changes = [];
    for (const id of ids) {
      const e = this.ent(id); if (!e) continue;
      const before = clone(this.ov.get(id)) || null;
      if (e.kind === 'added') changes.push({ id, before, after: null });
      else { const full = this.rec(id); full.deleted = true; changes.push({ id, before, after: this.diff(this.layer.generatedRecord(e), full) }); }
    }
    if (changes.length) this.exec({ label, changes });
    return changes.length;
  }
  setShared(name, props, label) {
    const before = clone(this.mats.get(name)) || null, after = props && Object.keys(props).length ? clone(props) : null;
    if (F.sameValue(before, after)) return;
    this.exec({ label: label || 'Edit shared material ' + name, mats: [{ name, before, after }] });
  }
  freshId(prefab, taken = null) {
    let n = 1; const used = id => !!this.ent(id) || this.ov.has(id) || (taken && taken.has(id));
    while (used(`${prefab}_new_${String(n).padStart(3, '0')}`)) n++;
    return `${prefab}_new_${String(n).padStart(3, '0')}`;
  }
  // ---------------------------------------------------------------- files
  fileText(path) {
    if (path === this.matFile) { const m = {}; for (const [n, v] of [...this.mats].sort()) m[n] = v; return F.stringifyWorldFile({ format: F.FORMAT, kind: 'materials', map: this.map, note: 'Shared material changes: every object using the material changes.', materials: m }); }
    const objects = []; for (const [id, p] of this.fileOf) if (p === path && this.ov.has(id)) objects.push(this.ov.get(id));
    const area = path.replace(/^edits\//, '').replace(/\.json$/, '');
    return F.stringifyWorldFile({ format: F.FORMAT, kind: 'edits', map: this.map, area, objects });
  }
  get isDirty() { return this.dirty.size > 0 || !!this.indexDirty; }
  // write every changed file; resolves to { saved: [paths], failed: [[path, message]] }
  async save() {
    const saved = [], failed = [];
    for (const path of [...this.dirty]) {
      const info = this.files.get(path) || {};
      if (info.readOnly) { failed.push([path, 'the file on disk is invalid — fix it (or reload it) before saving']); continue; }
      const text = this.fileText(path);
      try { if (info.savedText !== text) await io.write(this.base + path, text); this.files.set(path, { ...info, savedText: text, readOnly: false, conflict: false }); this.dirty.delete(path); saved.push(path); }
      catch (e) { failed.push([path, e.message]); }
    }
    if (this.indexDirty) {
      try { const ix = { ...this.index }; await io.write(this.base + 'world.json', F.stringifyWorldFile(ix)); this.indexDirty = false; saved.push('world.json'); } catch (e) { failed.push(['world.json', e.message]); }
    }
    this.emit({ type: 'saved', saved, failed });
    return { saved, failed };
  }
  // a world file changed on disk (by hand, by an AI, by git): take it in, keeping the camera and everything else
  async external(path) {
    const rel = path.slice(this.base.length);
    if (rel === 'world.json') {
      const t = await io.read(path), p = F.parseJSON(t, path);
      if (p.value) { this.index = p.value; if (!Array.isArray(this.index.edits)) this.index.edits = []; for (const e of this.index.edits) if (!this.files.has(e)) await this.external(this.base + e); }
      return { path: rel, ok: !p.error };
    }
    if (!rel.startsWith('edits/')) return null;
    let text = null; try { text = await io.read(path); } catch (e) { text = null; }
    const info = this.files.get(rel);
    if (info && info.savedText === text) return null;
    if (this.dirty.has(rel)) { this.files.set(rel, { ...(info || {}), conflict: true, diskText: text }); this.emit({ type: 'conflict', path: rel }); return { path: rel, conflict: true }; }
    return this.loadText(rel, text);
  }
  // replace the records of file rel by those in text (null: the file was deleted)
  loadText(rel, text) {
    const L = this.layer;
    for (const q of L.problems.filter(q => q.file === this.base + rel)) L.problems.splice(L.problems.indexOf(q), 1);
    let f = { path: rel, text, doc: { kind: 'edits', objects: [] }, problems: [], records: [] };
    if (text != null) { const seen = new Map(); for (const [id, p] of this.fileOf) if (p !== rel) seen.set(id, this.base + p); f = L.readFile(rel, text, L.validationContext(seen)); }
    const errs = f.problems.filter(q => q.level === 'error');
    if (!f.doc) { this.files.set(rel, { savedText: text, readOnly: true, problems: f.problems }); this.emit({ type: 'problems', path: rel, problems: f.problems }); return { path: rel, invalid: true, problems: f.problems }; }
    if (f.doc.kind === 'materials') {
      const before = new Map(this.mats); this.mats.clear();
      for (const [n, v] of Object.entries(f.doc.materials || {})) this.mats.set(n, { ...v });
      for (const n of new Set([...before.keys(), ...this.mats.keys()])) L.setShared(n, this.mats.get(n) || {});
      this.files.set(rel, { savedText: text, readOnly: errs.length > 0, problems: f.problems });
      this.emit({ type: 'external', path: rel, ids: [], problems: f.problems });
      return { path: rel, problems: f.problems };
    }
    const old = new Set(); for (const [id, p] of this.fileOf) if (p === rel) old.add(id);
    const now = new Map(f.records.map(r => [r.id, r]));
    const ids = [];
    for (const id of new Set([...old, ...now.keys()])) {
      const before = this.ov.get(id) || null, after = now.get(id) || null;
      if (F.sameValue(before, after)) continue;
      ids.push(id);
      if (after) { this.ov.set(id, clone(after)); this.fileOf.set(id, rel); } else { this.ov.delete(id); this.fileOf.delete(id); }
      this.sync(this.ent(id), after);
    }
    // history entries that touch these objects would undo someone else's change: they are dropped
    const touched = new Set(ids), keep = c => !(c.changes || []).some(x => touched.has(x.id));
    this.undoStack = this.undoStack.filter(keep); this.redoStack = this.redoStack.filter(keep);
    this.files.set(rel, { savedText: text, readOnly: errs.length > 0, problems: f.problems });
    this.emit({ type: 'external', path: rel, ids, problems: f.problems });
    return { path: rel, ids, problems: f.problems };
  }
  // resolve a conflict: 'disk' takes the file from disk (local changes to it are lost), 'mine' keeps local and saves
  async resolve(rel, take) {
    const info = this.files.get(rel); if (!info) return;
    if (take === 'disk') { this.dirty.delete(rel); this.files.set(rel, { ...info, conflict: false }); this.loadText(rel, info.diskText); }
    else { this.files.set(rel, { ...info, conflict: false, readOnly: false, savedText: info.diskText }); this.dirty.add(rel); await this.save(); }
  }
}
export { hashText };
