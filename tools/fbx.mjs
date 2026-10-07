// Minimal binary FBX reader (7.x): the node tree, meshes (positions, polygon indices, per-corner UVs and normals),
// models with their local transforms, and the object connections. Enough to bring low-poly asset packs into the
// game's own formats offline (tools/cars-import.mjs); not a general-purpose loader.
import fs from 'fs';
import zlib from 'zlib';

export function readFBX(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString('latin1', 0, 18) !== 'Kaydara FBX Binary') throw new Error(file + ': not a binary FBX');
  const version = buf.readUInt32LE(23), wide = version >= 7500;
  let o = 27;
  const u32 = () => { const v = buf.readUInt32LE(o); o += 4; return v; };
  const off = () => { if (wide) { const v = Number(buf.readBigUInt64LE(o)); o += 8; return v; } return u32(); };
  const array = (type) => {
    const n = u32(), enc = u32(), len = u32();
    let data = buf.subarray(o, o + len); o += len;
    if (enc === 1) data = zlib.inflateSync(data);
    const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    if (type === 'd') return Array.from(new Float64Array(ab, 0, n));
    if (type === 'f') return Array.from(new Float32Array(ab, 0, n));
    if (type === 'i') return Array.from(new Int32Array(ab, 0, n));
    if (type === 'l') return Array.from(new BigInt64Array(ab, 0, n), Number);
    return Array.from(new Uint8Array(ab, 0, n));
  };
  const prop = () => {
    const t = String.fromCharCode(buf[o++]);
    switch (t) {
      case 'Y': { const v = buf.readInt16LE(o); o += 2; return v; }
      case 'C': return !!buf[o++];
      case 'I': { const v = buf.readInt32LE(o); o += 4; return v; }
      case 'F': { const v = buf.readFloatLE(o); o += 4; return v; }
      case 'D': { const v = buf.readDoubleLE(o); o += 8; return v; }
      case 'L': { const v = Number(buf.readBigInt64LE(o)); o += 8; return v; }
      case 'S': { const n = u32(), v = buf.toString('utf8', o, o + n); o += n; return v.replace('\x00\x01', '::'); }
      case 'R': { const n = u32(); o += n; return null; }
      default: return array(t);
    }
  };
  const node = () => {
    const end = off(), np = off(); off();
    const nl = buf[o++], name = buf.toString('latin1', o, o + nl); o += nl;
    if (end === 0) return null;
    const props = []; for (let i = 0; i < np; i++) props.push(prop());
    const children = [];
    while (o < end) { const c = node(); if (!c) break; children.push(c); }
    o = end;
    return { name, props, children };
  };
  const roots = [];
  while (o < buf.length - 160) { const n = node(); if (!n) break; roots.push(n); }
  return { version, roots };
}

const child = (n, name) => n.children.find(c => c.name === name);
const P70 = n => { const m = {}; const p = n && child(n, 'Properties70'); if (p) for (const c of p.children) m[c.props[0]] = c.props.slice(4); return m; };

// per polygon-corner attribute from a LayerElement (ByPolygonVertex / ByVertice / ByPolygon, Direct / IndexToDirect)
function layer(el, key, idxKey, size, corners, cornerVerts, cornerPoly) {
  if (!el) return null;
  const data = child(el, key).props[0], idx = child(el, idxKey)?.props[0];
  const map = child(el, 'MappingInformationType').props[0], ref = child(el, 'ReferenceInformationType').props[0];
  const out = new Float32Array(corners * size);
  for (let c = 0; c < corners; c++) {
    let i = map === 'ByPolygonVertex' ? c : map === 'ByPolygon' ? cornerPoly[c] : map === 'AllSame' ? 0 : cornerVerts[c];
    if (ref === 'IndexToDirect' && idx) i = idx[i];
    for (let k = 0; k < size; k++) out[c * size + k] = data[i * size + k];
  }
  return out;
}

// meshes: [{ name, model, pos (triangle soup, model space), nor, uv }]; models: id -> { name, parent, T, R, S, preR }
export function fbxScene(fbx) {
  const objects = fbx.roots.find(n => n.name === 'Objects'), conns = fbx.roots.find(n => n.name === 'Connections');
  const geos = new Map(), models = new Map(), parent = new Map(), geoModel = new Map();
  for (const n of objects.children) {
    const [id, nm] = n.props;
    if (n.name === 'Geometry' && n.props[2] === 'Mesh') geos.set(id, n);
    if (n.name === 'Model') { const p = P70(n); models.set(id, { id, name: String(nm).split('::')[0], kind: n.props[2], T: p['Lcl Translation'] || [0, 0, 0], R: p['Lcl Rotation'] || [0, 0, 0], S: p['Lcl Scaling'] || [1, 1, 1], preR: p.PreRotation || [0, 0, 0], order: p.RotationOrder?.[0] || 0 }); }
  }
  for (const c of conns.children) {
    if (c.props[0] !== 'OO') continue;
    const [, a, b] = c.props;
    if (geos.has(a) && models.has(b)) geoModel.set(a, b);
    else if (models.has(a)) parent.set(a, b);
  }
  for (const [id, m] of models) m.parent = models.has(parent.get(id)) ? parent.get(id) : null;
  const meshes = [];
  for (const [id, g] of geos) {
    const V = child(g, 'Vertices').props[0], PI = child(g, 'PolygonVertexIndex').props[0];
    const cornerVerts = [], cornerPoly = []; let poly = 0;
    for (const v of PI) { cornerVerts.push(v < 0 ? ~v : v); cornerPoly.push(poly); if (v < 0) poly++; }
    const N = cornerVerts.length;
    const nor = layer(child(g, 'LayerElementNormal'), 'Normals', 'NormalsIndex', 3, N, cornerVerts, cornerPoly);
    const uv = layer(child(g, 'LayerElementUV'), 'UV', 'UVIndex', 2, N, cornerVerts, cornerPoly);
    const pos = [], nn = [], tt = [];
    let start = 0;
    for (let c = 0; c < N; c++) {
      if (PI[c] >= 0) continue;
      for (let k = start + 1; k + 1 <= c; k++) for (const q of [start, k, k + 1]) {  // fan-triangulate each polygon
        const v = cornerVerts[q]; pos.push(V[v * 3], V[v * 3 + 1], V[v * 3 + 2]);
        if (nor) nn.push(nor[q * 3], nor[q * 3 + 1], nor[q * 3 + 2]);
        if (uv) tt.push(uv[q * 2], uv[q * 2 + 1]);
      }
      start = c + 1;
    }
    meshes.push({ name: String(g.props[1]).split('::')[0], model: geoModel.get(id), pos, nor: nn, uv: tt });
  }
  const settings = P70(fbx.roots.find(n => n.name === 'GlobalSettings'));
  return { meshes, models, settings };
}
