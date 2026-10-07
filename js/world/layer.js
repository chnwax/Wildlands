// The world data layer, shared by the game and the world editor.
// After a map is built (with world/capture.js recording what each placed object produced) finalizeWorld():
//   - gives every object a stable, readable id: <prefab>_<area>_<nnn> (generation order within prefab and area);
//     instanced vegetation and props (Scatter items) are numbered the same way, lazily, per prefab;
//   - names the materials (the material library) and the prefabs (the prefab library);
//   - loads world/<map>/world.json and the edit files it lists, validates them (format.js) and applies them: an edited
//     object is taken out of the merged / instanced buffers into a group of its own (detach), moved, recoloured,
//     hidden or deleted; new objects are built from a prefab or copied from another object. Colliders, light fixtures
//     and loose meshes of an object follow it.
// Unedited objects stay merged and instanced: the game draws exactly what it drew before, plus a group per edit.
import { THREE, scene, scatters, props, setPropMatrix, colRemove, colInsert, allColliders, lampPoints, loadTex } from '../core.js';
import { buildCityLights } from '../citylights.js';
import { CAP, owner as meshOwner } from './capture.js';
import * as F from './format.js';

const DEG = Math.PI / 180, RAD = 180 / Math.PI;
const pad3 = n => String(n).padStart(3, '0');
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const near = (a, b, eps) => Math.abs(a - b) <= eps;
const vecEq = (a, b, eps) => !a || !b ? a === b : near(a[0], b[0], eps) && near(a[1], b[1], eps) && near(a[2], b[2], eps);

// what kind of thing each prefab is (outliner filter, palette categories, tags)
export const CATEGORY = {
  house: 'building', shop: 'building', konbini: 'building', apartment_block: 'building', warehouse: 'building', apartment_walkup: 'building', apartment_tower: 'building',
  apartment_mansion: 'building', apartment_corner: 'building', apartment_centre: 'building', apartment_lowrise: 'building', school: 'building', station_building: 'building',
  cottage: 'building', public_toilet: 'building', shrine_compound: 'building', haiden: 'building', honden: 'building', chozuya: 'building', equipment_shed: 'building',
  greenhouse: 'building', construction_site: 'building', bike_shelter: 'structure', pergola: 'structure', bicycle_park: 'structure', bus_stop: 'structure', team_shelter: 'structure',
  dock: 'structure', footbridge: 'structure', park_bridge: 'structure', viewpoint: 'structure', ruin: 'structure', tennis_courts: 'structure', playground: 'structure',
  car_park: 'structure', allotment: 'structure', vegetable_field: 'structure', fountain: 'structure', seat_wall: 'structure', football_goal: 'structure',
  fence: 'fence', bench: 'furniture', litter_bin: 'furniture', bollard: 'furniture', drinking_fountain: 'furniture', planter_round: 'furniture', tree_planter: 'furniture',
  shop_planter: 'furniture', mailbox: 'furniture', post_box: 'furniture', garbage_point: 'furniture', drying_rack: 'furniture', stand_board: 'furniture', nobori_banner: 'furniture',
  vending_machine: 'furniture', sculpture: 'furniture', water_tank: 'furniture', fire_hydrant: 'furniture', offering_box: 'furniture', ema_rack: 'furniture', omikuji_stand: 'furniture',
  komainu: 'furniture', street_shrine: 'furniture', wayside_shrine: 'furniture', shrine_small: 'furniture', hokora: 'furniture',
  lamp_path: 'lighting', street_lamp: 'lighting', park_lamp: 'lighting', plaza_lamp: 'lighting', floodlight: 'lighting', stone_lantern: 'lighting', stone_lantern_toro: 'lighting',
  lantern_string: 'lighting', utility_pole: 'lighting', konbini_pole_sign: 'sign', curve_mirror: 'sign', traffic_signal: 'sign', clock_pole: 'sign',
  play_structure: 'play', swings: 'play', seesaw: 'play', horizontal_bars: 'play', climbing_dome: 'play', play_house: 'play', sandpit: 'play', spring_rider: 'play',
  route_bus: 'vehicle', bicycle: 'vehicle',
};
const categoryOf = (prefab, meta) => CATEGORY[prefab] || (meta && meta.category) || (/^road_sign/.test(prefab) ? 'sign' : /^rock|boulder/.test(prefab) ? 'rock' : /^tree|bush|hedge|ivy|shrub|weed|bamboo|sapling|log|twigs|fern|stump|plant|hydrangea/.test(prefab) ? 'vegetation' : 'prop');
export const labelOf = prefab => prefab.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
export const PRIMITIVES = {
  box: { label: 'Box', geo: () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0) },
  cylinder: { label: 'Cylinder', geo: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 32).translate(0, 0.5, 0) },
  sphere: { label: 'Sphere', geo: () => new THREE.SphereGeometry(0.5, 32, 16).translate(0, 0.5, 0) },
  cone: { label: 'Cone', geo: () => new THREE.ConeGeometry(0.5, 1, 32).translate(0, 0.5, 0) },
  plane: { label: 'Plane', geo: () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0.01, 0) },
  ramp: { label: 'Ramp', geo: () => { const g = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0); const p = g.attributes.position; for (let i = 0; i < p.count; i++) if (p.getY(i) > 0.5 && p.getZ(i) > 0) p.setY(i, 0); g.computeVertexNormals(); return g; } },
};
export const ELEMENT_KEYS = ['hidden', 'offset', 'rotate', 'scale']; // per-slot element edits (in "slots" only)
const SHARED_KEYS = ['color', 'roughness', 'metalness', 'emissive', 'emissiveIntensity', 'texture', 'opacity'];

export async function finalizeWorld(opts) {
  const L = new WorldLayer(opts);
  opts.progress && opts.progress('Reading world data', 0.9);
  L.collect();
  await L.loadFiles();
  L.applyAll();
  return L;
}

export class WorldLayer {
  constructor({ map, editor = false, areaOf, materialSets = {} }) {
    this.map = map; this.editor = editor; this.areaOf = areaOf; this.materialSets = materialSets;
    this.ents = new Map();        // id -> Ent (objects that exist: generated geometry objects, numbered scatter items asked for, added)
    this.geo = [];                // generated geometry objects in id-assignment order
    this.sets = [];               // Scatters that carry world objects
    this.tables = new Map();      // scatter prefab -> Map(area -> [[set, i], ...] in number order)
    this.scatterPrefabs = new Map(); // prefab -> [set]
    this.matName = new Map(); this.matByName = new Map(); this.matInfo = new Map();
    this.variants = new Map();
    this.files = new Map();       // path -> { doc, problems, text }
    this.problems = [];
    this.lamps = lampPoints;      // fixtures (citylights.js); an object's own are flagged .off when it is hidden
    this.dirtyLights = false; this.world = null; this.onChange = null;
    this.detLod = [];             // detached parts that keep their LOD distance (fine building detail)
  }
  // ---------------------------------------------------------------- collection
  collect() {
    // materials: the named sets first (town: plain names, others prefixed)
    for (const [set, M] of Object.entries(this.materialSets)) for (const k of Object.keys(M)) { const m = M[k]; if (m && m.isMaterial && !this.matName.has(m)) this.nameMaterial(m, set === 'town' ? k : set + '_' + k); }
    // generated geometry objects
    const capToEnt = new Map(), counters = new Map();
    for (const e of CAP.ents) {
      if (!e.segs.length && !e.props.length && !e.meshes.length) continue;
      const ent = { kind: 'geo', prefab: e.prefab, cap: e, category: categoryOf(e.prefab), parentCap: e.parent, det: null, state: null };
      if (!e.based) { const b = this.capBoundsWorld(e); if (b) { e.x = (b.min.x + b.max.x) / 2; e.y = b.min.y; e.z = (b.min.z + b.max.z) / 2; } }
      ent.base = { p: [e.x, e.y, e.z], r: [0, e.ry, 0], s: [1, 1, 1] };
      ent.area = this.areaOf ? this.areaOf(e.x, e.z) : 'world';
      const key = ent.prefab + '|' + ent.area, n = (counters.get(key) || 0) + 1; counters.set(key, n);
      ent.n = n; ent.id = `${ent.prefab}_${ent.area}_${pad3(n)}`;
      capToEnt.set(e, ent); this.geo.push(ent); this.ents.set(ent.id, ent);
    }
    for (const ent of this.geo) { let p = ent.parentCap; while (p && !capToEnt.has(p)) p = p.parent; ent.parent = p ? capToEnt.get(p).id : null; delete ent.parentCap; }
    // instanced objects
    scatters.forEach((s, si) => { if (!s.meta || !s.items) return; s.wsi = si; this.sets.push(s); const P = s.meta.prefab; if (!this.scatterPrefabs.has(P)) this.scatterPrefabs.set(P, []); this.scatterPrefabs.get(P).push(s);
      for (const part of s.lods[0].parts) if (!this.matName.has(part.material)) this.nameMaterial(part.material, part.material.name ? part.material.name.toLowerCase().replace(/[^a-z0-9]+/g, '_') : P + '_' + (s.lods[0].parts.indexOf(part) + 1)); });
    // every merged mesh in build order (loose details are addressed by mesh number and triangle)
    this.buckets = []; scene.traverse(o => { if (o.isMesh && o.userData.bucket) this.buckets.push(o); });
    // primitives' default material
    if (!this.matByName.has('primitive')) this.nameMaterial(new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 0.75, metalness: 0 }), 'primitive');
  }
  nameMaterial(m, name) {
    name = name.replace(/[^a-z0-9_]+/gi, '_').toLowerCase() || 'material';
    let n = name, k = 2; while (this.matByName.has(n)) n = name + '_' + k++;
    this.matName.set(m, n); this.matByName.set(n, m);
    return n;
  }
  materialNameOf(m) { return this.matName.get(m) || this.nameMaterial(m, (m.name || m.type.replace('Material', '')).toLowerCase()); }
  // numbering of a scatter prefab's items (deterministic: scatter order, then item order)
  table(prefab) {
    let T = this.tables.get(prefab); if (T) return T;
    T = new Map(); this.tables.set(prefab, T);
    for (const s of this.scatterPrefabs.get(prefab) || []) {
      s.wNum = s.wNum || new Int32Array(s.items.length); s.wArea = s.wArea || new Array(s.items.length);
      s.items.forEach((it, i) => { const a = this.areaOf ? this.areaOf(it.x, it.z) : 'world'; let l = T.get(a); if (!l) T.set(a, l = []); l.push([s, i]); s.wNum[i] = l.length; s.wArea[i] = a; });
    }
    return T;
  }
  scatterEnt(s, i) {
    const id = `${s.meta.prefab}_${s.wArea[i]}_${pad3(s.wNum[i])}`;
    let ent = this.ents.get(id); if (ent) return ent;
    const it = s.items[i];
    ent = { kind: 'scatter', id, prefab: s.meta.prefab, area: s.wArea[i], n: s.wNum[i], set: s, i, item: it, field: it.field || s.meta.field || null, category: categoryOf(s.meta.prefab, s.meta), det: null, state: null, parent: null };
    ent.base = { p: [it.x, it.y, it.z], r: [it.tilt || 0, it.r || 0, it.tilt2 || 0], s: [it.s * (it.sx || 1), it.s * (it.sy || 1), it.s * (it.sz || it.sx || 1)] };
    this.ents.set(id, ent);
    return ent;
  }
  // the object with this id (generated, instanced or added), or null
  get(id) {
    const e = this.ents.get(id); if (e) return e;
    const dm = /^detail_m(\d+)_t(\d+)$/.exec(id); if (dm) return this.detailAt(+dm[1], +dm[2]);
    const g = F.parseGeneratedId(id); if (!g || !this.scatterPrefabs.has(g.prefab)) return null;
    const l = this.table(g.prefab).get(g.area), q = l && l[g.n - 1];
    return q ? this.scatterEnt(q[0], q[1]) : null;
  }
  has(id) { return !!this.get(id); }
  // every generated object id (instanced ones of fields only when asked)
  *allGenerated({ fields = false } = {}) {
    for (const e of this.geo) yield e;
    for (const P of this.scatterPrefabs.keys()) { const T = this.table(P); for (const l of T.values()) for (const [s, i] of l) { const it = s.items[i]; if (!fields && (it.field || s.meta.field)) continue; yield this.scatterEnt(s, i); } }
  }
  // ---------------------------------------------------------------- generated records (what the generator placed)
  slotsOf(ent) {
    if (ent.slots) return ent.slots;
    const w = new Map();
    const add = (m, n) => { if (!m) return; const name = this.materialNameOf(m); w.set(name, (w.get(name) || 0) + n); };
    const src = ent.kind === 'added' ? ent.src : ent;
    if (!src) ent.slots = ent.kind === 'added' && ent.prim ? ['primitive'] : [];
    else if (src.kind === 'geo') {
      // surface area per material (vertex counts would favour fine trim — railings, frames — over walls)
      for (const s of src.cap.segs) { const m = s.b.mesh; if (!m) continue; const P = m.geometry.attributes.position.array, I = m.geometry.index && m.geometry.index.array;
        if (!P || !I) { add(m.material, s.v1 - s.v0); continue; } let a = 0; const J = s.idx0, o = J ? s.i0 : 0, at = k => (J || I)[k - o];
        // walls make the look of a building: upright faces count fully, floors and roofs a little
        for (let k = s.i0; k + 2 < s.i1; k += 3) { const i0 = at(k) * 3, i1 = at(k + 1) * 3, i2 = at(k + 2) * 3, ux = P[i1] - P[i0], uy = P[i1 + 1] - P[i0 + 1], uz = P[i1 + 2] - P[i0 + 2], vx = P[i2] - P[i0], vy = P[i2 + 1] - P[i0 + 1], vz = P[i2 + 2] - P[i0 + 2];
          const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx, A2 = Math.hypot(cx, cy, cz); a += (Math.abs(cy) < 0.5 * A2 ? 1 : 0.15) * A2 / 2; }
        add(m.material, a); }
      for (const pid of src.cap.props) for (const p of props.items[pid].parts) add(p.group.material, 2);
    } else if (src.kind === 'scatter') for (const p of src.set.lods[0].parts) add(p.material, p.geometry.attributes.position.count);
    if (!ent.slots) ent.slots = [...w.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0]);
    return ent.slots;
  }
  generatedRecord(ent) {
    if (ent.kind === 'added') return null;
    if (ent.gen) return ent.gen;
    const b = ent.base, slots = this.slotsOf(ent);
    const r = { id: ent.id, name: `${labelOf(ent.prefab)} ${ent.n} · ${ent.area}`, prefab: ent.prefab, position: b.p.slice(), rotation: b.r.map(v => v * RAD), scale: b.s.slice() };
    if (slots[0]) r.material = slots[0];
    if (ent.parent) r.group = ent.parent;
    r.tags = [ent.category, ent.area].concat(ent.field ? ['field:' + ent.field] : []);
    return (ent.gen = F.roundRecord(r));
  }
  // ---------------------------------------------------------------- geometry access
  capBoundsWorld(cap) {
    const box = new THREE.Box3(); let any = false;
    for (const s of cap.segs) {
      const pa = s.b.mesh ? s.b.mesh.geometry.attributes.position.array : s.b.pos && s.b.pos.a; if (!pa) continue;
      for (let v = s.v0; v < s.v1; v++) { _v.set(pa[v * 3], pa[v * 3 + 1], pa[v * 3 + 2]); box.expandByPoint(_v); any = true; }
    }
    for (const pid of cap.props) for (const p of props.items[pid].parts) { const g = p.group.geometry; if (!g.boundingBox) g.computeBoundingBox(); box.union(_bb.copy(g.boundingBox).applyMatrix4(p.matrix)); any = true; }
    for (const o0 of cap.meshes) { o0.updateMatrixWorld(); o0.traverse(o => { if (!o.geometry) return; if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); box.union(_bb.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld)); any = true; }); }
    return any ? box : null;
  }
  baseMatrix(ent, out = new THREE.Matrix4()) {
    const b = ent.base; _e.set(b.r[0], b.r[1], b.r[2], 'XYZ'); _q.setFromEuler(_e);
    return out.compose(_v.fromArray(b.p), _q, _s.fromArray(b.s));
  }
  // object-space bounds (the frame its parts are built in); scale applies on top
  localBounds(ent) {
    if (ent.lb) return ent.lb;
    const box = new THREE.Box3(), src = ent.kind === 'added' ? ent.src : ent;
    if (ent.prim) box.copy(ent.prim.geo.boundingBox || (ent.prim.geo.computeBoundingBox(), ent.prim.geo.boundingBox));
    else if (src && src.kind === 'geo') {
      const wb = new THREE.Box3(), inv = this.baseMatrix(src).invert();
      for (const s of src.cap.segs) { const pa = s.b.mesh && s.b.mesh.geometry.attributes.position.array; if (!pa) continue;
        for (let v = s.v0; v < s.v1; v++) { _v.set(pa[v * 3], pa[v * 3 + 1], pa[v * 3 + 2]).applyMatrix4(inv); box.expandByPoint(_v); } }
      for (const pid of src.cap.props) for (const p of props.items[pid].parts) { const g = p.group.geometry; if (!g.boundingBox) g.computeBoundingBox(); box.union(wb.copy(g.boundingBox).applyMatrix4(_m.multiplyMatrices(inv, p.matrix))); }
      for (const o0 of src.cap.meshes) { o0.updateMatrixWorld(); o0.traverse(o => { if (!o.geometry) return; if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); box.union(wb.copy(o.geometry.boundingBox).applyMatrix4(_m.multiplyMatrices(inv, o.matrixWorld))); }); }
    } else if (src && src.kind === 'scatter') for (const p of src.set.lods[0].parts) { const g = p.geometry; if (!g.boundingBox) g.computeBoundingBox(); box.union(g.boundingBox); }
    if (box.isEmpty()) box.set(_v.set(-0.5, 0, -0.5), _v2.set(0.5, 1, 0.5));
    return (ent.lb = box);
  }
  // current object matrix (what the record says, or the generated base)
  matrixOf(ent, out = new THREE.Matrix4()) {
    if (ent.det) { ent.det.group.updateMatrix(); return out.copy(ent.det.group.matrix); }
    return this.baseMatrix(ent, out);
  }
  worldBox(ent, out = new THREE.Box3()) { return out.copy(this.localBounds(ent)).applyMatrix4(this.matrixOf(ent, _m2)); }
  // ---------------------------------------------------------------- detaching: an object's own group, built from its parts
  // parts of the source object, copied into object space; collapse: hide the source's own geometry (it becomes the object)
  buildParts(src, collapse) {
    const group = new THREE.Group(), parts = [];
    group.userData.worldObject = true;
    if (src.kind === 'geo') {
      const inv = this.baseMatrix(src).invert(), nrm = new THREE.Matrix3().getNormalMatrix(inv);
      const groups = new Map();
      for (const s of src.cap.segs) {
        const m = s.b.mesh; if (!m) continue;
        const g = m.geometry, key = m.material.id + '|' + s.b.lod + '|' + m.layers.mask + '|' + m.castShadow + '|' + Object.keys(g.attributes).sort().join(',');
        let G = groups.get(key); if (!G) groups.set(key, G = { m, lod: s.b.lod, segs: [] }); G.segs.push(s);
      }
      for (const G of groups.values()) {
        const src0 = G.m.geometry, names = Object.keys(src0.attributes);
        let nv = 0, ni = 0; for (const s of G.segs) { nv += s.v1 - s.v0; ni += s.i1 - s.i0; }
        const geo = new THREE.BufferGeometry(), arrays = {};
        for (const k of names) { const a = src0.attributes[k]; arrays[k] = new Float32Array(nv * a.itemSize); }
        const idx = new (nv > 65535 ? Uint32Array : Uint16Array)(ni);
        let vo = 0, io = 0, bad = 0;
        for (const s of G.segs) {
          const g = s.b.mesh.geometry, I = g.index.array;
          for (const k of names) { const a = g.attributes[k], A = a.array, w = a.itemSize, D = arrays[k];
            if (!A) { bad++; continue; }
            if (k === 'position') for (let v = s.v0, o = vo * 3; v < s.v1; v++, o += 3) { _v.set(A[v * 3], A[v * 3 + 1], A[v * 3 + 2]).applyMatrix4(inv); D[o] = _v.x; D[o + 1] = _v.y; D[o + 2] = _v.z; }
            else if (k === 'normal') for (let v = s.v0, o = vo * 3; v < s.v1; v++, o += 3) { _v.set(A[v * 3], A[v * 3 + 1], A[v * 3 + 2]).applyMatrix3(nrm).normalize(); D[o] = _v.x; D[o + 1] = _v.y; D[o + 2] = _v.z; }
            else D.set(A.subarray(s.v0 * w, s.v1 * w), vo * w); }
          if (!I) { bad++; continue; }
          const I0 = s.idx0 || I, o0 = s.idx0 ? s.i0 : 0; // (the source's own triangles, also after it was collapsed)
          for (let k = s.i0; k < s.i1; k++) { const v = I0[k - o0]; idx[io++] = v >= s.v0 && v < s.v1 ? v - s.v0 + vo : vo; }
          vo += s.v1 - s.v0;
          if (collapse) { if (!s.idx0) s.idx0 = I.slice(s.i0, s.i1); for (let k = s.i0; k < s.i1; k++) I[k] = s.v0; g.index.addUpdateRange(s.i0, s.i1 - s.i0); g.index.needsUpdate = true; }
        }
        if (bad) console.warn('world: geometry of', src.id, 'was already released (not editable here)');
        for (const k of names) geo.setAttribute(k, new THREE.BufferAttribute(arrays[k], src0.attributes[k].itemSize, src0.attributes[k].normalized));
        geo.setIndex(new THREE.BufferAttribute(idx, 1)); geo.computeBoundingSphere(); geo.computeBoundingBox();
        const mesh = new THREE.Mesh(geo, G.m.material);
        mesh.castShadow = G.m.castShadow; mesh.receiveShadow = G.m.receiveShadow; mesh.layers.mask = G.m.layers.mask; mesh.renderOrder = G.m.renderOrder;
        if (G.lod) mesh.userData.lodDist = G.m.userData.lodDist;
        group.add(mesh); parts.push({ mesh, slot: this.materialNameOf(G.m.material), baseMat: G.m.material, lod: G.lod });
      }
      for (const pid of src.cap.props) props.items[pid].parts.forEach((p, k) => {
        const im = new THREE.InstancedMesh(p.group.geometry, p.group.material, 1); im.setMatrixAt(0, _m.identity());
        _m.multiplyMatrices(inv, p.matrix).decompose(im.position, im.quaternion, im.scale);
        im.castShadow = p.group.castShadow; im.receiveShadow = p.group.receiveShadow; if (p.mesh) im.layers.mask = p.mesh.layers.mask;
        group.add(im); parts.push({ mesh: im, slot: this.materialNameOf(p.group.material), baseMat: p.group.material });
        if (collapse) setPropMatrix(pid, k, ZERO);
      });
      for (const o of src.cap.meshes) {
        o.updateMatrixWorld();
        const c = o.clone(); _m.multiplyMatrices(inv, o.matrixWorld).decompose(c.position, c.quaternion, c.scale); c.matrixAutoUpdate = true; c.userData = { ...o.userData, loose: true };
        group.add(c);
        // (a captured group — a clock head, a model — is drawn by its meshes: each is a part with its own material, and
        // hiding the original means every mesh in it, as three.js tests layers per object, not per subtree)
        c.traverse(q => { if (q.isMesh) parts.push({ mesh: q, slot: null, baseMat: q.material, loose: true }); });
        if (collapse) o.traverse(q => { q.userData.layers0 = q.layers.mask; q.layers.mask = 0; });
      }
    } else if (src.kind === 'scatter') {
      const s = src.set, i = src.i;
      for (const part of s.lods[0].parts) {
        const im = new THREE.InstancedMesh(part.geometry, part.material, 1); im.setMatrixAt(0, _m.identity());
        if (part.tint) { const c = s.col.get(part.tint); im.setColorAt(0, new THREE.Color(c[i * 3], c[i * 3 + 1], c[i * 3 + 2])); }
        im.castShadow = !!part.castShadow; im.receiveShadow = part.receiveShadow !== false;
        if (part.depth) im.customDepthMaterial = part.depth;
        im.userData.sways = !!part.sway;
        group.add(im); parts.push({ mesh: im, slot: this.materialNameOf(part.material), baseMat: part.material, tint: part.tint ? im.instanceColor.array.slice(0, 3) : null });
      }
      if (collapse) s.setItemMatrix(i, ZERO); // (a multi-level set uploads the change in its next update)
    }
    for (const p of parts) { p.mesh.frustumCulled = true; p.mesh.userData.worldPart = true; }
    return { group, parts };
  }
  detach(ent) {
    if (ent.det) return ent.det;
    const det = this.buildParts(ent, true);
    this.baseMatrix(ent).decompose(det.group.position, det.group.quaternion, det.group.scale);
    det.group.userData.ent = ent.id;
    scene.add(det.group); det.group.updateMatrixWorld(true); ent.det = det; // (the scene's matrices update once a frame: picks right after need it now)
    this.claim(ent);
    for (const p of det.parts) if (p.lod) this.detLod.push(p.mesh);
    return det;
  }
  // colliders, fixtures and loose meshes that belong to an object (captured with it or found inside it)
  claim(ent) {
    if (ent.cols) return;
    this.associate();
    ent.cols = []; ent.lampsOwn = [];
    const add = c => { ent.cols.push({ c, c0: { t: c.t, walk: c.walk, x: c.x, z: c.z, r: c.r, hx: c.hx, hz: c.hz, c: c.c, s: c.s, y0: c.y0, y1: c.y1 } }); };
    if (ent.kind === 'geo') {
      for (const c of ent.cap.colliders) add(c);
      for (const c of this.owned.get(ent) || []) add(c);
      for (const l of ent.cap.lamps) ent.lampsOwn.push({ l, p0: l.p.slice(), c0: l.c });
      for (const l of this.ownedLamps.get(ent) || []) ent.lampsOwn.push({ l, p0: l.p.slice(), c0: l.c });
    } else if (ent.kind === 'scatter') {
      const it = ent.item, l = this.circleAt.get(Math.round(it.x * 50) + ',' + Math.round(it.z * 50)); if (l) for (const c of l) add(c);
    }
    ent.base0 = this.baseMatrix(ent);
  }
  // one pass over the loose colliders / fixtures: each goes to the smallest object whose bounds contain it
  associate() {
    if (this.owned) return;
    this.owned = new Map(); this.ownedLamps = new Map(); this.circleAt = new Map();
    const capOwned = new Set(); for (const e of this.geo) for (const c of e.cap.colliders) capOwned.add(c);
    const cell = 24, grid = new Map(), boxes = new Map();
    for (const e of this.geo) {
      const b = this.capBoundsWorld(e.cap); if (!b) continue; b.expandByScalar(0.35); boxes.set(e, b);
      const vol = (b.max.x - b.min.x) * (b.max.z - b.min.z);
      if (vol > 40000) continue; // whole compounds (a school, a park) do not take loose colliders of their surroundings
      for (let gx = Math.floor(b.min.x / cell); gx <= Math.floor(b.max.x / cell); gx++) for (let gz = Math.floor(b.min.z / cell); gz <= Math.floor(b.max.z / cell); gz++) { const k = gx + ',' + gz; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(e); }
    }
    const owner = (x, y, z, useY) => { let best = null, bv = 1e18; for (const e of grid.get(Math.floor(x / cell) + ',' + Math.floor(z / cell)) || []) { const b = boxes.get(e); if (x < b.min.x || x > b.max.x || z < b.min.z || z > b.max.z || (useY && (y < b.min.y - 1 || y > b.max.y + 1))) continue; const v = (b.max.x - b.min.x) * (b.max.z - b.min.z) * (b.max.y - b.min.y + 1); if (v < bv) { bv = v; best = e; } } return best; };
    for (const c of allColliders()) {
      if (c.t === 0) { const k = Math.round(c.x * 50) + ',' + Math.round(c.z * 50); if (!this.circleAt.has(k)) this.circleAt.set(k, []); this.circleAt.get(k).push(c); }
      if (capOwned.has(c)) continue;
      const e = owner(c.x, 0, c.z, false); if (!e) continue;
      if (!this.owned.has(e)) this.owned.set(e, []); this.owned.get(e).push(c);
    }
    for (const l of lampPoints) { if (l.__ent) continue; const e = owner(l.p[0], l.p[1], l.p[2], true); if (!e) continue; if (!this.ownedLamps.has(e)) this.ownedLamps.set(e, []); this.ownedLamps.get(e).push(l); }
    // loose meshes added after their object was built (carport roofs, signal heads, name plates): owned the same way
    for (const o of scene.children) {
      if (!o.isMesh || o.isInstancedMesh || meshOwner.has(o) || o.userData.bucket || o.userData.worldObject || !o.geometry) continue;
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere(); if (o.geometry.boundingSphere.radius > 6) continue;
      const e = owner(o.position.x, o.position.y, o.position.z, true); if (e) { e.cap.meshes.push(o); meshOwner.set(o, e.cap); }
    }
  }
  // ---------------------------------------------------------------- applying records
  // rec: the object's effective record (generated values with the edits on top), or null to remove an added object
  apply(ent, rec) {
    if (!rec) { this.removeAdded(ent); return; }
    const gen = this.generatedRecord(ent);
    if (!ent.det && gen && this.pristine(gen, rec)) { ent.state = rec; return; }
    const det = ent.det || this.detach(ent), G = det.group;
    G.position.fromArray(rec.position || gen.position);
    const r = rec.rotation || gen.rotation; G.rotation.set(r[0] * DEG, r[1] * DEG, r[2] * DEG, 'XYZ');
    G.scale.fromArray(rec.scale || (gen ? gen.scale : [1, 1, 1]));
    const off = !!(rec.deleted || rec.hidden);
    G.visible = !off; G.userData.hidden = off;
    G.updateMatrixWorld(true);
    this.materials(ent, rec, gen);
    // colliders and fixtures follow: delta from where the generator put them
    const D = _m.multiplyMatrices(G.matrixWorld, _m2.copy(ent.base0 || this.baseMatrix(ent)).invert());
    const yaw = Math.atan2(D.elements[8], D.elements[10]);
    for (const { c, c0 } of ent.cols || []) {
      colRemove(c);
      _v.set(c0.x, 0, c0.z).applyMatrix4(D); c.x = _v.x; c.z = _v.z;
      const sx = _v2.setFromMatrixColumn(D, 0).length(), sy = _v2.setFromMatrixColumn(D, 1).length(), sz = _v2.setFromMatrixColumn(D, 2).length(), dy = D.elements[13];
      if (c.t === 0) c.r = c0.r * (sx + sz) / 2;
      else { const a0 = Math.atan2(c0.s, c0.c), a = a0 - yaw; c.c = Math.cos(a); c.s = Math.sin(a); c.hx = c0.hx * sx; c.hz = c0.hz * sz; }
      if (c0.y0 > -1e8) c.y0 = c0.y0 * sy + dy; if (c0.y1 < 1e8) c.y1 = c0.y1 * sy + dy;
      if (!off) colInsert(c);
    }
    let lampColor = null;
    for (const s of this.slotsOf(ent)) { const o = this.slotOverride(ent, rec, gen, s); if (o && (/lamp|glow|light/.test(s)) && (o.emissive || o.color)) lampColor = new THREE.Color(o.emissive || o.color); }
    for (const L of ent.lampsOwn || []) {
      _v.fromArray(L.p0).applyMatrix4(D); L.l.p = [_v.x, _v.y, _v.z]; L.l.off = off;
      L.l.c = lampColor ? [lampColor.r, lampColor.g, lampColor.b] : L.c0; this.dirtyLights = true;
    }
    ent.state = rec;
  }
  pristine(gen, rec) {
    if (rec.hidden || rec.deleted) return false;
    if (!vecEq(rec.position, gen.position, 1e-3) || !vecEq(rec.rotation, gen.rotation, 1e-2) || !vecEq(rec.scale, gen.scale, 1e-4)) return false;
    if (rec.material && rec.material !== gen.material) return false;
    if (rec.materialOverrides && Object.keys(rec.materialOverrides).length) return false;
    if (rec.slots && Object.keys(rec.slots).length) return false;
    return true;
  }
  // the override for slot s: the primary slot takes material / materialOverrides, every slot its entry in "slots"
  slotOverride(ent, rec, gen, s) {
    const primary = this.slotsOf(ent)[0] || (gen && gen.material);
    let o = null;
    if (rec.slots && rec.slots[s]) o = { ...rec.slots[s] };
    if (s === primary) { if (rec.material && rec.material !== (gen ? gen.material : null)) o = { ...(o || {}), material: rec.material }; if (rec.materialOverrides) o = { ...(o || {}), ...rec.materialOverrides }; }
    return o && Object.keys(o).length ? o : null;
  }
  materials(ent, rec, gen) {
    if (rec.slots) for (const k of Object.keys(rec.slots)) if (k.includes('#')) this.ensurePiece(ent, k);
    for (const p of ent.det.parts) {
      if (p.loose || !p.slot) continue;
      const o = this.slotOverride(ent, rec, gen, p.slot);
      let base = p.baseMat;
      if (ent.prim) base = this.matByName.get(rec.material) || this.matByName.get('primitive');
      if (o && o.material && this.matByName.has(o.material)) base = this.matByName.get(o.material);
      const ov = o ? { ...o } : {}; delete ov.material;
      for (const k of ELEMENT_KEYS) delete ov[k];
      this.element(ent, p, (rec.slots && rec.slots[p.slot]) || {});
      // instance-tinted parts (trees, rocks, bikes): the colour is the tint
      if (p.tint) { const c = ov.color ? new THREE.Color(ov.color) : null; const a = p.mesh.instanceColor.array; if (c) { a[0] = c.r; a[1] = c.g; a[2] = c.b; } else a.set(p.tint); p.mesh.instanceColor.needsUpdate = true; delete ov.color; }
      // vertex-coloured kit parts: an exact colour, keeping the light and dark of the original shading
      const col = p.mesh.geometry.attributes.color;
      if (col && base.vertexColors && !p.mesh.isInstancedMesh) {
        if (ov.color && !p.colors0) { p.colors0 = col.array.slice(); let sum = 0; const A = col.array, n = A.length / 3; for (let i = 0; i < n; i++) sum += A[i * 3] * 0.3 + A[i * 3 + 1] * 0.59 + A[i * 3 + 2] * 0.11; const avg = sum / Math.max(1, n) || 1;
          for (let i = 0; i < n; i++) { const l = Math.min(1.6, (A[i * 3] * 0.3 + A[i * 3 + 1] * 0.59 + A[i * 3 + 2] * 0.11) / avg); A[i * 3] = A[i * 3 + 1] = A[i * 3 + 2] = l; } col.needsUpdate = true; }
        else if (!ov.color && p.colors0) { col.array.set(p.colors0); p.colors0 = null; col.needsUpdate = true; }
      }
      p.mesh.material = Object.keys(ov).length ? this.variant(base, ov) : base;
    }
  }
  // one element of an object (all its parts of one material slot: the roof, the walls, the windows...): hidden, or
  // moved / turned / scaled about the element's own centre, in the object's frame
  element(ent, p, el) {
    const m = p.mesh;
    if (!p.t0) { m.updateMatrix(); p.t0 = m.matrix.clone(); }
    m.userData.partHidden = !!el.hidden; m.visible = !el.hidden;
    if (!el.offset && !el.rotate && !el.scale) { if (p.moved) { p.t0.decompose(m.position, m.quaternion, m.scale); p.moved = false; } return; }
    const c = this.elementPivot(ent, p.slot), o = el.offset || [0, 0, 0], r = el.rotate || [0, 0, 0], k = el.scale || [1, 1, 1];
    _e.set(r[0] * DEG, r[1] * DEG, r[2] * DEG, 'XYZ'); _q.setFromEuler(_e);
    const M = new THREE.Matrix4().compose(_v.set(c.x + o[0], c.y + o[1], c.z + o[2]), _q, _s.fromArray(k)).multiply(_m2.makeTranslation(-c.x, -c.y, -c.z)).multiply(p.t0);
    M.decompose(m.position, m.quaternion, m.scale); p.moved = true;
  }
  // ---------------------------------------------------------------- pieces: one connected part of an element
  // ("stucco#3": the 4th connected piece of the stucco parts — one wall, one window frame, one sign plate). A piece is
  // split off into a mesh of its own the first time it is selected or edited, and is then edited like an element.
  piecesOf(ent, slot) {
    ent.pieceLists = ent.pieceLists || {};
    if (ent.pieceLists[slot]) return ent.pieceLists[slot];
    const out = [];
    for (const p of ent.det.parts) {
      if (p.slot !== slot || p.mesh.isInstancedMesh || !p.mesh.geometry.index) continue;
      const g = p.mesh.geometry, P = g.attributes.position.array, I = p.idx0 || g.index.array, n = P.length / 3, par = new Int32Array(n), key = new Map();
      for (let v = 0; v < n; v++) { const k = Math.round(P[v * 3] * 500) + ',' + Math.round(P[v * 3 + 1] * 500) + ',' + Math.round(P[v * 3 + 2] * 500); const q = key.get(k); par[v] = q === undefined ? v : q; if (q === undefined) key.set(k, v); }
      const find = v => { while (par[v] !== v) { par[v] = par[par[v]]; v = par[v]; } return v; };
      for (let t = 0; t + 2 < I.length; t += 3) { const a = find(I[t]), b = find(I[t + 1]), c = find(I[t + 2]); if (a !== b) par[b] = a; const a2 = find(a); if (a2 !== find(c)) par[find(c)] = a2; }
      const comp = new Map();
      for (let t = 0; t + 2 < I.length; t += 3) { if (I[t] === I[t + 1] && I[t] === I[t + 2]) continue; const r = find(I[t]); let c = comp.get(r); if (!c) { c = { part: p, tris: [] }; comp.set(r, c); out.push(c); } c.tris.push(t / 3); }
    }
    return (ent.pieceLists[slot] = out);
  }
  // ---------------------------------------------------------------- details: loose geometry that belongs to no object
  // The connected piece of merged mesh number mi containing triangle tri, as an object of its own (prefab "detail",
  // id detail_m<mesh>_t<first triangle>), when it is small (not road, terrain or a long wall) and not part of an object.
  detailAt(mi, tri) {
    const m = this.buckets[mi]; if (!m || !m.geometry.index) return null;
    const g = m.geometry, P = g.attributes.position.array, I = g.index.array; if (!P || !I) return null;
    if (!this.owned3) { // triangle ranges that objects own, per mesh
      this.owned3 = new Map();
      for (const e of this.geo) for (const sg of e.cap.segs) if (sg.b.mesh) { let l = this.owned3.get(sg.b.mesh); if (!l) this.owned3.set(sg.b.mesh, l = []); l.push([sg.i0 / 3, sg.i1 / 3]); }
    }
    const own = this.owned3.get(m) || [], owned = t => own.some(([a, b]) => t >= a && t < b);
    if (owned(tri)) return null;
    let A = m.userData.adj;
    if (!A) { // triangles by vertex position (built once per mesh, on demand)
      A = new Map(); const nt = I.length / 3;
      for (let t = 0; t < nt; t++) { if (owned(t)) continue; for (let j = 0; j < 3; j++) { const v = I[t * 3 + j], k = Math.round(P[v * 3] * 200) + ',' + Math.round(P[v * 3 + 1] * 200) + ',' + Math.round(P[v * 3 + 2] * 200); let l = A.get(k); if (!l) A.set(k, l = []); l.push(t); } }
      Object.defineProperty(m.userData, 'adj', { value: A, enumerable: false, configurable: true });
    }
    const key = v => Math.round(P[v * 3] * 200) + ',' + Math.round(P[v * 3 + 1] * 200) + ',' + Math.round(P[v * 3 + 2] * 200);
    const seen = new Set([tri]), todo = [tri], box = new THREE.Box3();
    while (todo.length) {
      const t = todo.pop();
      for (let j = 0; j < 3; j++) { const v = I[t * 3 + j]; box.expandByPoint(_v.fromArray(P, v * 3)); for (const u of A.get(key(v)) || []) if (!seen.has(u)) { seen.add(u); todo.push(u); } }
      if (seen.size > 20000) return null;
      const sz = box.getSize(_v2); if (Math.max(sz.x, sz.z) > 14 || sz.y > 20) return null; // roads, terrain, long walls: not a detail
    }
    const tris = [...seen].sort((a, b) => a - b), id = `detail_m${mi}_t${tris[0]}`;
    if (this.ents.has(id)) return this.ents.get(id);
    const segs = [];
    for (let k = 0; k < tris.length;) { let e = k; while (e + 1 < tris.length && tris[e + 1] === tris[e] + 1) e++; let v0 = 1e9, v1 = -1; for (let t = tris[k]; t <= tris[e]; t++) for (let j = 0; j < 3; j++) { const v = I[t * 3 + j]; v0 = Math.min(v0, v); v1 = Math.max(v1, v); } segs.push({ b: m.userData.bucket, i0: tris[k] * 3, i1: (tris[e] + 1) * 3, v0, v1: v1 + 1 }); k = e + 1; }
    const c = box.getCenter(new THREE.Vector3());
    const cap = { prefab: 'detail', x: c.x, y: box.min.y, z: c.z, ry: 0, based: true, segs, props: [], meshes: [], colliders: [], lamps: [], parent: null };
    const ent = { kind: 'geo', detail: true, prefab: 'detail', cap, category: 'prop', det: null, state: null, parent: null, id, area: this.areaOf ? this.areaOf(c.x, c.z) : 'world', n: tris[0] };
    ent.base = { p: [c.x, box.min.y, c.z], r: [0, 0, 0], s: [1, 1, 1] };
    this.ents.set(id, ent);
    return ent;
  }
  // which piece of slot the triangle `face` of part mesh m belongs to (its key "slot#k"), or null
  pieceAt(ent, m, face) {
    const own = ent.det.parts.find(p => p.mesh === m); if (!own) return null;
    if (own.slot.includes('#')) return own.slot;
    const list = this.piecesOf(ent, own.slot), k = list.findIndex(c => c.part === own && c.tris.includes(face));
    return k >= 0 ? own.slot + '#' + k : own.slot;
  }
  // finer pieces of piece n: its flat faces (connected triangles on one plane) — one wall face, one roof plane
  subPiecesOf(ent, slot, n) {
    const k0 = slot + '#' + n; ent.subLists = ent.subLists || {};
    if (ent.subLists[k0]) return ent.subLists[k0];
    const c = this.piecesOf(ent, slot)[n]; if (!c) return [];
    const g = c.part.mesh.geometry, P = g.attributes.position.array, I = c.part.idx0 || g.index.array;
    const T = c.tris, nt = T.length, par = new Int32Array(nt).map((_, i) => i), nrm = new Float32Array(nt * 4), byKey = new Map();
    const find = i => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
    for (let q = 0; q < nt; q++) {
      const t = T[q], a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, cc = I[t * 3 + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[cc] - P[a], vy = P[cc + 1] - P[a + 1], vz = P[cc + 2] - P[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      nrm.set([nx, ny, nz, nx * P[a] + ny * P[a + 1] + nz * P[a + 2]], q * 4);
      for (const v of [I[t * 3], I[t * 3 + 1], I[t * 3 + 2]]) { const k = Math.round(P[v * 3] * 500) + ',' + Math.round(P[v * 3 + 1] * 500) + ',' + Math.round(P[v * 3 + 2] * 500); let L2 = byKey.get(k); if (!L2) byKey.set(k, L2 = []); L2.push(q); }
    }
    for (const L2 of byKey.values()) for (let x = 1; x < L2.length; x++) for (let y = 0; y < x; y++) {
      const a = L2[x] * 4, b = L2[y] * 4; if (nrm[a] * nrm[b] + nrm[a + 1] * nrm[b + 1] + nrm[a + 2] * nrm[b + 2] > 0.985 && Math.abs(nrm[a + 3] - nrm[b + 3]) < 0.02) { const ra = find(L2[x]), rb = find(L2[y]); if (ra !== rb) par[ra] = rb; }
    }
    const comp = new Map(), out = [];
    for (let q = 0; q < nt; q++) { const r = find(q); let cc = comp.get(r); if (!cc) { cc = []; comp.set(r, cc); out.push(cc); } cc.push(T[q]); }
    return (ent.subLists[k0] = out.map(tris => ({ part: c.part, tris })));
  }
  // the sub-piece key of a triangle of piece key (slot#n), or null
  subPieceAt(ent, key, mesh, face) {
    const [slot, ns] = key.split('#'), n = parseInt(ns), own = ent.det.parts.find(p => p.mesh === mesh); if (!own) return null;
    const c = this.piecesOf(ent, slot)[n]; if (!c) return null;
    const t = own.slot === key ? c.tris[face] : face; // (a split-off piece's triangle k is the k-th of the piece)
    const k = this.subPiecesOf(ent, slot, n).findIndex(q => q.tris.includes(t));
    return k >= 0 ? `${key}.${k}` : null;
  }
  // split the triangles of a piece ("slot#n" or "slot#n.m") off into a mesh of their own (only those still drawn)
  ensurePiece(ent, key) {
    if (!ent.det || ent.det.parts.some(p => p.slot === key)) return;
    const [slot, rest] = key.split('#'), [ns, ms] = rest.split('.'), n = +ns;
    const c = ms === undefined ? this.piecesOf(ent, slot)[n] : this.subPiecesOf(ent, slot, n)[+ms]; if (!c) return;
    // a sub-piece of a piece that is already split off comes out of that piece's mesh
    let src = c.part, tris = c.tris;
    const parent = ms !== undefined && ent.det.parts.find(p => p.slot === slot + '#' + n);
    if (parent) { const pc = this.piecesOf(ent, slot)[n], set = new Set(c.tris); src = parent; tris = []; pc.tris.forEach((t, k) => { if (set.has(t)) tris.push(k); }); }
    const g = src.mesh.geometry, I = g.index.array; if (!src.idx0) src.idx0 = I.slice();
    const I0 = src.idx0, map = new Map(), idx = [];
    for (const t of tris) {
      if (I[t * 3] === I[t * 3 + 1] && I[t * 3 + 1] === I[t * 3 + 2]) continue; // (already split off into a finer piece)
      for (let j = 0; j < 3; j++) { const v = I0[t * 3 + j]; let w = map.get(v); if (w === undefined) { w = map.size; map.set(v, w); } idx.push(w); }
      I[t * 3] = I[t * 3 + 1] = I[t * 3 + 2] = I0[t * 3];
    }
    if (!idx.length) return;
    g.index.needsUpdate = true;
    const ng = new THREE.BufferGeometry(), vs = [...map.keys()];
    for (const name in g.attributes) { const a = g.attributes[name], w = a.itemSize, A = new a.array.constructor(vs.length * w); vs.forEach((v, i) => { for (let k = 0; k < w; k++) A[i * w + k] = a.array[v * w + k]; }); ng.setAttribute(name, new THREE.BufferAttribute(A, w, a.normalized)); }
    ng.setIndex(idx); ng.computeBoundingSphere(); ng.computeBoundingBox();
    const m = new THREE.Mesh(ng, src.baseMat); m.castShadow = src.mesh.castShadow; m.receiveShadow = src.mesh.receiveShadow; m.layers.mask = src.mesh.layers.mask;
    src.mesh.updateMatrix(); m.matrix.copy(src.t0 || src.mesh.matrix); m.matrix.decompose(m.position, m.quaternion, m.scale); m.userData.worldPart = true;
    ent.det.group.add(m); ent.det.parts.push({ mesh: m, slot: key, baseMat: src.baseMat, piece: true });
  }
  // centre of an element in the object's frame (the pivot its edits turn and scale about)
  elementPivot(ent, slot) {
    ent.pivots = ent.pivots || {};
    if (ent.pivots[slot]) return ent.pivots[slot];
    const box = new THREE.Box3();
    for (const p of ent.det.parts) if (p.slot === slot) { const g = p.mesh.geometry; if (!g.boundingBox) g.computeBoundingBox(); const M = p.t0 || (p.mesh.updateMatrix(), p.mesh.matrix); box.union(_bb.copy(g.boundingBox).applyMatrix4(M)); }
    return (ent.pivots[slot] = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3()));
  }
  variant(base, ov) {
    const key = base.uuid + JSON.stringify(Object.keys(ov).sort().map(k => [k, ov[k]]));
    let v = this.variants.get(key);
    if (!v) { v = { mat: cloneMaterial(base), base, ov }; this.variants.set(key, v); setProps(v.mat, ov); }
    return v.mat;
  }
  // a shared (library) material: changes every object that uses it
  setShared(name, ov) {
    const m = this.matByName.get(name); if (!m) return false;
    if (!this.matInfo.has(name)) this.matInfo.set(name, materialProps(m));
    const orig = this.matInfo.get(name);
    setProps(m, { ...orig, ...ov });
    for (const v of this.variants.values()) if (v.base === m) { setProps(v.mat, { ...orig, ...ov }); setProps(v.mat, v.ov); }
    return true;
  }
  sharedProps(name) { const m = this.matByName.get(name); return m ? materialProps(m) : null; }
  // ---------------------------------------------------------------- added objects
  createAdded(rec) {
    let ent = this.ents.get(rec.id);
    if (ent && ent.kind !== 'added') return null;
    if (ent) this.removeAdded(ent);
    let src = null, prim = null;
    if (rec.source) { src = this.get(rec.source); if (src && src.kind === 'added') { prim = src.prim; src = src.src; } }
    if (!src && !prim && rec.prefab) { if (PRIMITIVES[rec.prefab]) prim = PRIMITIVES[rec.prefab]; else { const t = this.templateOf(rec.prefab); src = t ? this.get(t) : null; } }
    if (!src && !prim) return null;
    ent = { kind: 'added', id: rec.id, srcKey: (rec.source || '') + '|' + (rec.prefab || ''), prefab: rec.prefab || (src ? src.prefab : 'box'), src, prim, category: src ? src.category : 'primitive', area: this.areaOf ? this.areaOf(rec.position[0], rec.position[2]) : 'world', det: null, state: null, parent: null };
    if (prim) {
      if (!prim.g) { prim.g = prim.geo(); prim.g.computeBoundingBox(); prim.g.computeBoundingSphere(); }
      ent.prim = { geo: prim.g, key: rec.prefab };
      const group = new THREE.Group(), mesh = new THREE.Mesh(prim.g, this.matByName.get('primitive'));
      mesh.castShadow = mesh.receiveShadow = true; mesh.layers.enable(1); group.add(mesh); group.userData.worldObject = true;
      ent.det = { group, parts: [{ mesh, slot: 'primitive', baseMat: mesh.material }] };
    } else ent.det = this.buildParts(src, false);
    ent.det.group.userData.ent = ent.id;
    scene.add(ent.det.group);
    for (const p of ent.det.parts) if (p.lod) this.detLod.push(p.mesh);
    // copies of the source's colliders and fixtures, in the source's frame
    ent.cols = []; ent.lampsOwn = [];
    if (src) {
      this.claim(src);
      const M = this.baseMatrix(src);
      for (const { c0 } of src.cols || []) ent.cols.push({ c: { ...c0 }, c0: { ...c0 } });
      for (const L of src.lampsOwn || []) { const l = { p: L.p0.slice(), s: L.l.s, c: L.c0 }; lampPoints.push(l); ent.lampsOwn.push({ l, p0: L.p0.slice(), c0: L.c0 }); }
      ent.base0 = M;
    } else { ent.base0 = new THREE.Matrix4(); if (rec.prefab !== 'plane') { const c0 = { t: 1, x: 0, z: 0, hx: 0.5, hz: 0.5, c: 1, s: 0, y0: 0, y1: 1 }; ent.cols.push({ c: { ...c0 }, c0 }); } }
    this.ents.set(ent.id, ent);
    this.apply(ent, rec);
    return ent;
  }
  removeAdded(ent) {
    if (!ent || ent.kind !== 'added') return;
    if (ent.det) { scene.remove(ent.det.group); for (const p of ent.det.parts) { const i = this.detLod.indexOf(p.mesh); if (i >= 0) this.detLod.splice(i, 1); } }
    for (const { c } of ent.cols || []) colRemove(c);
    for (const L of ent.lampsOwn || []) { const i = lampPoints.indexOf(L.l); if (i >= 0) lampPoints.splice(i, 1); this.dirtyLights = true; }
    this.ents.delete(ent.id);
  }
  templateOf(prefab) {
    if (this.templates && this.templates.has(prefab)) return this.templates.get(prefab);
    this.templates = this.templates || new Map();
    let t = null;
    for (const e of this.geo) if (e.prefab === prefab) { t = e.id; break; }
    if (!t && this.scatterPrefabs.has(prefab)) for (const l of this.table(prefab).values()) { if (l.length) { const [s, i] = l[0]; t = this.scatterEnt(s, i).id; break; } }
    this.templates.set(prefab, t);
    return t;
  }
  // ---------------------------------------------------------------- files
  async loadFiles() {
    const base = `world/${this.map}/`;
    const get = async path => { try { const r = await fetch(base + path + (this.editor ? '?t=' + Date.now() : ''), { cache: this.editor ? 'no-store' : 'default' }); if (!r.ok) return { missing: r.status }; return { text: await r.text() }; } catch (e) { return { missing: e.message }; } };
    const ix = await get('world.json');
    this.index = { format: F.FORMAT, kind: 'index', map: this.map, edits: [], generated: [] };
    if (ix.text != null) {
      const p = F.parseJSON(ix.text, base + 'world.json');
      if (p.error) this.problems.push({ level: 'error', file: base + 'world.json', id: null, field: '', message: p.error.message + (p.error.line ? ` (line ${p.error.line}, column ${p.error.col})` : '') });
      else { this.index = p.value; for (const q of F.validateFile(p.value, base + 'world.json')) this.problems.push(q); }
    }
    const list = [...(Array.isArray(this.index.edits) ? this.index.edits : [])];
    const me = this.index.materialEdits;
    if (me && !list.includes(me)) list.push(me);
    const texts = await Promise.all(list.map(get));
    const ctx = this.validationContext();
    list.forEach((path, i) => {
      const t = texts[i], file = base + path;
      if (t.text == null) { if (path !== me) this.problems.push({ level: 'error', file, id: null, field: '', message: `listed in world.json but could not be read (${t.missing})` }); return; }
      this.readFile(path, t.text, ctx);
    });
  }
  validationContext(seen = new Map()) {
    return { generated: id => { const e = this.get(id); return e && e.kind !== 'added' ? e : null; }, exists: id => this.has(id) || [...this.files.values()].some(f => f.doc && f.doc.objects && f.doc.objects.some(o => o.id === id)),
      prefabs: new Set([...this.geo.map(e => e.prefab), ...this.scatterPrefabs.keys(), ...Object.keys(PRIMITIVES)]), materials: new Set(this.matByName.keys()), seen, strictIds: true };
  }
  // parse + validate one edit file (path relative to world/<map>/); keeps the valid records
  readFile(path, text, ctx = this.validationContext()) {
    const file = `world/${this.map}/${path}`, out = { path, text, doc: null, problems: [], records: [] };
    const p = F.parseJSON(text, file);
    if (p.error) out.problems.push({ level: 'error', file, id: null, field: '', message: p.error.message + (p.error.line ? `  (line ${p.error.line}, column ${p.error.col})` : '') });
    else {
      out.doc = p.value;
      out.problems = F.validateFile(p.value, file, ctx);
      if (p.value && p.value.kind === 'edits' && Array.isArray(p.value.objects)) {
        const badIds = new Set(out.problems.filter(q => q.level === 'error' && q.id).map(q => q.id));
        out.records = p.value.objects.filter(o => o && typeof o.id === 'string' && !badIds.has(o.id));
      }
    }
    for (const q of out.problems) this.problems.push(q);
    this.files.set(path, out);
    return out;
  }
  // every edit applied (load time): shared materials first, then objects
  applyAll() {
    const mats = [...this.files.values()].find(f => f.doc && f.doc.kind === 'materials');
    if (mats && mats.doc.materials && !mats.problems.some(q => q.level === 'error')) for (const [n, ov] of Object.entries(mats.doc.materials)) this.setShared(n, ov);
    let n = 0;
    for (const f of this.files.values()) for (const rec of f.records) {
      try { if (this.applyRecord(rec)) n++; } catch (e) { console.error(e); this.problems.push({ level: 'error', file: `world/${this.map}/${f.path}`, id: rec.id, field: '', message: 'could not be applied: ' + e.message }); }
    }
    this.applied = n;
    if (this.problems.length) for (const q of this.problems) (q.level === 'error' ? console.error : console.warn)('World data: ' + F.formatProblem(q));
  }
  // one record of an edit file: an override of a generated object, or an added object
  applyRecord(rec) {
    let ent = this.get(rec.id);
    // the id names an object that is not where the edit says the generator put it: ids shifted (the generator changed)
    if (ent && ent.kind !== 'added' && rec.origin && Math.hypot(ent.base.p[0] - rec.origin[0], ent.base.p[2] - rec.origin[2]) > 2.5) ent = this.rebind(rec) || ent;
    if (!ent && rec.origin) ent = this.rebind(rec);
    if (ent && ent.kind !== 'added') { this.apply(ent, this.effective(ent, rec)); return true; }
    if (rec.deleted) return false;
    if (!rec.prefab && !rec.source) { this.problems.push({ level: 'warning', file: `world/${this.map}`, id: rec.id, field: 'id', message: 'no object with this id exists (generator changed?) — the entry was skipped' }); return false; }
    return !!this.createAdded(rec);
  }
  effective(ent, rec) {
    const gen = this.generatedRecord(ent);
    if (!gen) return rec;
    const out = { ...gen, ...rec };
    if (rec.materialOverrides === undefined) delete out.materialOverrides;
    return out;
  }
  // an edit whose id no longer exists: the object of the same prefab nearest to where the generator used to place it
  rebind(rec) {
    const dm = /^detail_m(\d+)_t\d+$/.exec(rec.id);
    if (dm) {
      // Detail ids contain merged-mesh/triangle numbers, so geometry inserted earlier in the build can renumber them.
      // Find the small loose component at the saved origin, checking the old mesh first, then the other buckets.
      let best = null, bd = 3;
      const oldMi = +dm[1], order = [oldMi, ...this.buckets.map((_, i) => i).filter(i => i !== oldMi)];
      for (const mi of order) {
        const m = this.buckets[mi], g = m && m.geometry, P = g && g.attributes.position && g.attributes.position.array, I = g && g.index && g.index.array;
        if (!P || !I) continue;
        const near = [];
        for (let t = 0; t < I.length / 3; t++) {
          let d = Infinity;
          for (let j = 0; j < 3; j++) { const v = I[t * 3 + j] * 3; d = Math.min(d, Math.hypot(P[v] - rec.origin[0], P[v + 2] - rec.origin[2])); }
          if (d < 2.5) near.push([d, t]);
        }
        near.sort((a, b) => a[0] - b[0]);
        const tried = new Set();
        for (const [, t] of near.slice(0, 64)) {
          const e = this.detailAt(mi, t); if (!e || tried.has(e.id)) continue; tried.add(e.id);
          const d = Math.hypot(e.base.p[0] - rec.origin[0], e.base.p[2] - rec.origin[2]);
          if (d < bd) { bd = d; best = e; if (d < 0.05) break; }
        }
        if (best && bd < 0.05) break;
      }
      if (best) this.problems.push({ level: 'warning', file: `world/${this.map}`, id: rec.id, field: 'id', message: `the generator now gives this object the id ${best.id} (found at its "origin"); the edit was applied to it. Saving in the editor renames the entry.`, rebound: best.id });
      return best;
    }
    const g = F.parseGeneratedId(rec.id); if (!g) return null;
    let best = null, bd = 3;
    const cand = this.scatterPrefabs.has(g.prefab) ? [...this.table(g.prefab).values()].flat().map(([s2, i]) => this.scatterEnt(s2, i)) : this.geo.filter(e => e.prefab === g.prefab);
    for (const e of cand) { if (this.claimedIds && this.claimedIds.has(e.id)) continue; const d = Math.hypot(e.base.p[0] - rec.origin[0], e.base.p[2] - rec.origin[2]); if (d < bd) { bd = d; best = e; } }
    if (best) this.problems.push({ level: 'warning', file: `world/${this.map}`, id: rec.id, field: 'id', message: `the generator now gives this object the id ${best.id} (found at its "origin"); the edit was applied to it. Saving in the editor renames the entry.`, rebound: best.id });
    return best;
  }
  // ---------------------------------------------------------------- generated world export (world/<map>/generated, libraries)
  // The generator's output as world files: every placed object (one file per area), dense vegetation fields as
  // summaries, the prefab and material libraries and the index. Written by the editor / tools/regenerate-world.mjs
  // through the dev server; edit files are never touched. textures: the diffuse textures in assets/tex.
  exportGenerated({ textures = [], editsIndex = null } = {}) {
    const files = {}, byArea = new Map(), prefabs = new Map(), fieldSum = new Map();
    const note = 'GENERATED by the world generator (npm run regenerate-world, or opening the editor). Do not edit: put changes in ../edits/ (see WORLD_FORMAT.md).';
    const pf = (name, src, cat) => { let p = prefabs.get(name); if (!p) prefabs.set(name, p = { name, label: labelOf(name), category: cat, source: src, count: 0, fieldCount: 0, template: null, size: null }); return p; };
    for (const e of this.geo) {
      const r = this.generatedRecord(e); if (!byArea.has(e.area)) byArea.set(e.area, []); byArea.get(e.area).push(r);
      const p = pf(e.prefab, 'generated', e.category); p.count++; if (!p.template) p.template = e.id;
    }
    for (const P of this.scatterPrefabs.keys()) for (const [area, l] of this.table(P)) for (const [s, i] of l) {
      const it = s.items[i], field = it.field || s.meta.field || null, p = pf(P, 'instanced', categoryOf(P, s.meta));
      if (field) { p.fieldCount++; const k = field + '|' + P; let f = fieldSum.get(k); if (!f) fieldSum.set(k, f = { field, prefab: P, count: 0, areas: new Map(), example: null }); f.count++; f.areas.set(area, (f.areas.get(area) || 0) + 1); if (!f.example) f.example = `${P}_${area}_${pad3(s.wNum[i])}`; continue; }
      const e = this.scatterEnt(s, i), r = this.generatedRecord(e);
      if (!byArea.has(area)) byArea.set(area, []); byArea.get(area).push(r); p.count++; if (!p.template) p.template = e.id;
    }
    for (const [P] of prefabs) { const p = prefabs.get(P); if (!p.template) p.template = this.templateOf(P); if (p.template) { const sz = new THREE.Vector3(); const e = this.get(p.template); this.localBounds(e).getSize(sz); sz.multiply(_v.fromArray(e.base.s)); p.size = sz.toArray().map(v => +v.toFixed(2)); } }
    for (const [k, def] of Object.entries(PRIMITIVES)) prefabs.set(k, { name: k, label: def.label, category: 'primitive', source: 'primitive', count: 0, fieldCount: 0, template: null, size: [1, 1, 1] });
    const areas = [...byArea.keys()].sort(), base = `world/${this.map}/`;
    for (const a of areas) files[base + `generated/${a}.json`] = F.stringifyWorldFile({ format: F.FORMAT, kind: 'generated', map: this.map, area: a, note, objects: byArea.get(a) }, { compact: true });
    const fields = [...fieldSum.values()].sort((a, b) => a.field < b.field ? -1 : a.field > b.field ? 1 : a.prefab < b.prefab ? -1 : 1)
      .map(f => ({ field: f.field, prefab: f.prefab, count: f.count, areas: Object.fromEntries([...f.areas].sort()), example: f.example }));
    files[base + 'generated/fields.json'] = F.stringifyWorldFile({ format: F.FORMAT, kind: 'generated', map: this.map, area: 'fields',
      note: 'Dense procedural vegetation (forest, forest floor, hedgerows, weeds...) is not listed object by object. Every plant still has an id <prefab>_<area>_<nnn> (numbered like the listed objects) and can be edited or deleted by id in ../edits/ like any other object.', fields, objects: [] }, { compact: true });
    const plist = [...prefabs.values()].sort((a, b) => a.category < b.category ? -1 : a.category > b.category ? 1 : a.name < b.name ? -1 : 1)
      .map(p => { const o = { name: p.name, label: p.label, category: p.category, source: p.source }; if (p.template) o.template = p.template; o.count = p.count; if (p.fieldCount) o.fieldCount = p.fieldCount; if (p.size) o.size = p.size; return o; });
    files[base + 'prefabs.json'] = F.stringifyWorldFile({ format: F.FORMAT, kind: 'prefabs', map: this.map, note: 'GENERATED. The prefab library: what "prefab" in an object can name. "template" is the generated object new copies are built from; primitives are built from code.', prefabs: plist });
    const used = new Map(); for (const e of this.geo) for (const sl of this.slotsOf(e)) used.set(sl, (used.get(sl) || 0) + 1);
    const mlist = [...this.matByName.entries()].map(([name, m]) => { const o = { name, ...(this.matInfo.get(name) || materialProps(m)) }; o.vertexColors = !!m.vertexColors; o.usedBy = used.get(name) || 0; return o; })
      .sort((a, b) => a.name < b.name ? -1 : 1);
    files[base + 'materials.json'] = F.stringifyWorldFile({ format: F.FORMAT, kind: 'materialLibrary', map: this.map, note: 'GENERATED. The material library (values as the generator made them). Change a shared material in ../edits/materials.json; vertexColors materials are tinted per vertex (their colour multiplies).', textures: textures.slice().sort(), materials: mlist });
    const idx = { format: F.FORMAT, kind: 'index', map: this.map, name: this.world && this.world.meta ? this.world.meta.name : this.map,
      note: 'Index of the world files of this map. The game loads every file listed in "edits" (and "materialEdits"). Generated files describe what the generator places; they are rewritten on regeneration, edits never are.',
      areas, generated: [...areas.map(a => `generated/${a}.json`), 'generated/fields.json'], edits: editsIndex ? editsIndex.edits : (this.index.edits || []),
      materialEdits: editsIndex ? editsIndex.materialEdits : this.index.materialEdits, libraries: { prefabs: 'prefabs.json', materials: 'materials.json' } };
    if (!idx.materialEdits) delete idx.materialEdits;
    files[base + 'world.json'] = F.stringifyWorldFile(idx);
    return files;
  }
  // ---------------------------------------------------------------- per frame / runtime
  attach(world) { this.world = world; }
  activeLamps() { return lampPoints.filter(l => !l.off); }
  refreshLights() { if (!this.dirtyLights) return; this.dirtyLights = false; if (lampPoints.length) buildCityLights(this.activeLamps()); }
  update(cam) {
    if (this.dirtyLights) this.refreshLights();
    if (this.detLod.length && (this._lt = (this._lt || 0) + 1) % 4 === 0) for (const m of this.detLod) {
      const g = m.geometry; if (!g.boundingSphere) continue; _v.copy(g.boundingSphere.center).applyMatrix4(m.matrixWorld);
      m.visible = !m.userData.partHidden && _v.distanceTo(cam.position) - g.boundingSphere.radius < (m.userData.lodDist || 1e9) * (globalThis.__wlLodScale || 1);
    }
  }
  // a dismissible note listing data problems (the game; the editor has its own panel)
  showProblems() {
    // (an edit re-attached to its object by its saved origin was applied: nothing for a player to act on; the editor
    // lists it and renames the entry on its next save)
    const P = this.problems.filter(p => !p.rebound);
    if (!P.length) return;
    const errs = P.filter(p => p.level === 'error').length, el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:12px;top:12px;max-width:min(640px,90vw);z-index:97;background:rgba(30,18,16,.92);color:#f3d9d2;border:1px solid #c0645a;border-radius:8px;padding:10px 14px;font:12px/1.45 system-ui,sans-serif;cursor:pointer';
    el.title = 'click to close';
    el.innerHTML = `<b>World data: ${P.length} problem${P.length > 1 ? 's' : ''}${errs ? ` (${errs} error${errs > 1 ? 's' : ''})` : ''}</b> — invalid entries were skipped, the rest of the world loaded.<pre style="white-space:pre-wrap;margin:6px 0 0;font:11px/1.4 Consolas,monospace;max-height:40vh;overflow:auto">${P.slice(0, 12).map(F.formatProblem).join('\n').replace(/</g, '&lt;')}${P.length > 12 ? `\n… ${P.length - 12} more in the console (F12)` : ''}</pre>`;
    el.onclick = () => el.remove(); document.body.appendChild(el);
  }
}
const _bb = new THREE.Box3();
// material copy that keeps the shader customisations of the original (painted look, wind, city lights)
export function cloneMaterial(base) {
  const m = base.clone();
  m.onBeforeCompile = base.onBeforeCompile;
  if (Object.prototype.hasOwnProperty.call(base, 'customProgramCacheKey')) m.customProgramCacheKey = base.customProgramCacheKey;
  m.userData = { ...base.userData };
  if (base.defines) m.defines = { ...base.defines };
  return m;
}
const hex = c => '#' + c.getHexString();
// the library path of a texture ("tex/....jpg"), "procedural" for painted canvases, null for none
export const texPath = t => !t ? null : t.userData && t.userData.path ? t.userData.path : t.image && t.image.src ? decodeURI(t.image.src).replace(/^.*?\/assets\//, '') : 'procedural';
export function materialProps(m) {
  const o = {};
  if (m.color) o.color = hex(m.color);
  if (m.roughness !== undefined) o.roughness = +m.roughness.toFixed(3);
  if (m.metalness !== undefined) o.metalness = +m.metalness.toFixed(3);
  if (m.emissive) { o.emissive = hex(m.emissive); o.emissiveIntensity = +(m.emissiveIntensity || 0).toFixed(3); }
  o.texture = texPath(m.map);
  o.opacity = +(m.opacity ?? 1).toFixed(3);
  return o;
}
export function setProps(m, o) {
  if (o.color !== undefined && m.color) m.color.set(o.color);
  if (o.roughness !== undefined && m.roughness !== undefined) m.roughness = o.roughness;
  if (o.metalness !== undefined && m.metalness !== undefined) m.metalness = o.metalness;
  if (o.emissive !== undefined && m.emissive) m.emissive.set(o.emissive);
  if (o.emissiveIntensity !== undefined && m.emissive) m.emissiveIntensity = o.emissiveIntensity;
  if (o.opacity !== undefined) {
    if (m.userData.transparent0 === undefined) m.userData.transparent0 = m.transparent;
    m.opacity = o.opacity; const t = o.opacity < 1 || m.userData.transparent0;
    if (m.transparent !== t) { m.transparent = t; m.depthWrite = !t || m.userData.transparent0 ? m.depthWrite : false; m.needsUpdate = true; }
  }
  if (o.texture !== undefined && o.texture !== 'procedural' && texPath(m.map) !== o.texture) {
    if (m.userData.tex0 === undefined) { m.userData.tex0 = texPath(m.map); m.userData.normalMap0 = m.normalMap; }
    if (o.texture === null) { m.map = null; m.needsUpdate = true; }
    else {
      const t = loadTex(o.texture, true); t.userData.path = o.texture; t.userData.photo = true; m.map = t; m.needsUpdate = true;
      // the surface relief goes with the picture: the matching normal map of the library texture (flat when it has none)
      if (m.userData.normalMap0) m.normalMap = o.texture === m.userData.tex0 ? m.userData.normalMap0 : loadTex(o.texture.replace('_diff_', '_nor_gl_'), false, [128, 128, 255]);
      if (m.defines && 'TOON_FLAT' in m.defines === false && m.map.userData.photo) m.defines = { ...m.defines, TOON_FLAT: '' };
    }
  }
}
