// node tools/packs-kits.mjs — the shop buildings of Idyllic Anime Japan dressed as the pack's own demo scene dresses them.
// Reads UnityAssets/Idyllic Anime Japan/DEMO JAPAN.unity (never modified): every shop, restaurant, row building and
// konbini placed in it, and every prop the scene stands in or on it (counters, stools, bowls, shelves, signs, awnings,
// lanterns, boards, vending machines, AC units...), with its transform relative to the building. For each building model
// the instance with the most dressing is kept. Written to assets/packs-fix/kits.json (git-ignored with the libraries):
//   { "<pack>/<building>": { "dims": [w, h, d], "props": [{ "src": "<pack>/<model>", "m": [16 numbers, column-major] }] } }
// in the game's frame (right-handed, the building's GLB frame: front +z), loaded by js/packs.js (packKit).
import fs from 'fs';
import path from 'path';
import { ROOT, UA } from './packs-lib.mjs';

const PACK = path.join(UA, 'Idyllic Anime Japan'), SCENE = path.join(PACK, 'DEMO JAPAN.unity');
const LIB = path.join(ROOT, 'ModeleZPaczek'), OUT = path.join(ROOT, 'assets', 'packs-fix');
const kat = JSON.parse(fs.readFileSync(path.join(LIB, 'katalog.json'), 'utf8')).modele;
const safe = s => s.replace(/\.(prefab|fbx)$/i, '').replace(/^SM_|^IL3DN_/, '').replace(/[^\w\-]+/g, '_').replace(/_+$/, '').toLowerCase();
const guid = new Map(); const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.prefab.meta')) { const m = /guid: ([0-9a-f]+)/.exec(fs.readFileSync(p, 'utf8')); if (m) guid.set(m[1], path.basename(p, '.prefab.meta')); } } }; walk(PACK);

// ---- 4x4 matrices (column-major, as three.js)
const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
const trs = (p, q, s) => { const [x, y, z, w] = q, x2 = x + x, y2 = y + y, z2 = z + z, xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
  return [(1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0, (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0, (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0, p[0], p[1], p[2], 1]; };
const inv = m => { // general 4x4 inverse
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06, d = 1 / det;
  return [(a11 * b11 - a12 * b10 + a13 * b09) * d, (a02 * b10 - a01 * b11 - a03 * b09) * d, (a31 * b05 - a32 * b04 + a33 * b03) * d, (a22 * b04 - a21 * b05 - a23 * b03) * d,
    (a12 * b08 - a10 * b11 - a13 * b07) * d, (a00 * b11 - a02 * b08 + a03 * b07) * d, (a32 * b02 - a30 * b05 - a33 * b01) * d, (a20 * b05 - a22 * b02 + a23 * b01) * d,
    (a10 * b10 - a11 * b08 + a13 * b06) * d, (a01 * b08 - a00 * b10 - a03 * b06) * d, (a30 * b04 - a31 * b02 + a33 * b00) * d, (a21 * b02 - a20 * b04 - a23 * b00) * d,
    (a11 * b07 - a10 * b09 - a12 * b06) * d, (a00 * b09 - a01 * b07 + a02 * b06) * d, (a31 * b01 - a30 * b03 - a32 * b00) * d, (a20 * b03 - a21 * b01 + a22 * b00) * d]; };
const MX = [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; // (Unity's left-handed frame -> ours: x mirrored)

// ---- the scene: transforms and prefab instances
const text = fs.readFileSync(SCENE, 'utf8'), docs = text.split(/^--- !u!/m).slice(1);
const tf = new Map(), inst = new Map();
const num = (s, k, d = 0) => { const m = new RegExp(k + ':\\s*([-\\d.e]+)').exec(s); return m ? +m[1] : d; };
for (const d of docs) {
  const h = /^(\d+) &(-?\d+)( stripped)?/.exec(d); if (!h) continue; const type = h[1], id = h[2];
  if (type === '4') {
    if (h[3]) { const pi = /m_PrefabInstance: \{fileID: (-?\d+)/.exec(d); tf.set(id, { inst: pi && pi[1] }); continue; }
    const P = /m_LocalPosition: \{x: ([-\d.e]+), y: ([-\d.e]+), z: ([-\d.e]+)\}/.exec(d), R = /m_LocalRotation: \{x: ([-\d.e]+), y: ([-\d.e]+), z: ([-\d.e]+), w: ([-\d.e]+)\}/.exec(d), S = /m_LocalScale: \{x: ([-\d.e]+), y: ([-\d.e]+), z: ([-\d.e]+)\}/.exec(d), F = /m_Father: \{fileID: (-?\d+)/.exec(d);
    tf.set(id, { m: trs(P ? P.slice(1).map(Number) : [0, 0, 0], R ? R.slice(1).map(Number) : [0, 0, 0, 1], S ? S.slice(1).map(Number) : [1, 1, 1]), father: F ? F[1] : '0' });
  } else if (type === '1001') {
    const src = /m_SourcePrefab: \{fileID: \d+, guid: ([0-9a-f]+)/.exec(d), parent = /m_TransformParent: \{fileID: (-?\d+)/.exec(d);
    const mods = {}; for (const m of d.matchAll(/propertyPath: (m_Local(?:Position|Rotation|Scale)\.[xyzw])\s*\n\s*value: ([-\d.e]+)/g)) if (!(m[1] in mods)) mods[m[1]] = +m[2];
    const p = ['x', 'y', 'z'].map(a => mods['m_LocalPosition.' + a] ?? 0), q = ['x', 'y', 'z', 'w'].map(a => mods['m_LocalRotation.' + a] ?? (a === 'w' ? 1 : 0)), s = ['x', 'y', 'z'].map(a => mods['m_LocalScale.' + a] ?? 1);
    inst.set(id, { name: src ? guid.get(src[1]) : null, parent: parent ? parent[1] : '0', m: trs(p, q, s) });
  }
}
const worldTf = id => { const t = tf.get(id); if (!t) return null; if (t.inst) return worldInst(t.inst); const f = t.father !== '0' ? worldTf(t.father) : null; return f ? mul(f, t.m) : t.m; };
const worldInst = id => { const I = inst.get(id); if (!I) return null; if (I.w) return I.w; const f = I.parent !== '0' ? worldTf(I.parent) : null; return (I.w = f ? mul(f, I.m) : I.m); };

// ---- buildings and what stands in them
const BUILDING = /^SM_(shop_building_0\d|store_rowbuilding_0\d|ramenshop|restaurant_traditional_building|convenience_store)$/;
const SKIP = /sidewalk|street|curb|asphalt|road|wall|fence|tree|grass|bush|leaves|cable|powerline|sign_traffic|trafficlight|utility_pole|lamp_street|pole_street|plane_|platform|stairs|rail|train|gate|blockade|mirror|decal|manhole|drain|house_|apartment|shop_building|store_row|ramenshop|restaurant_trad|convenience_store|entrance|cornerwall|island|mountain|rock|terrain|firehydrant|mailbox_resident/i;
const glbBox = src => { const b = fs.readFileSync(path.join(LIB, kat[src].plik)), jl = b.readUInt32LE(12), j = JSON.parse(b.slice(20, 20 + jl).toString()), lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const me of j.meshes) for (const p of me.primitives) { const a = j.accessors[p.attributes.POSITION]; for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], a.min[k]); hi[k] = Math.max(hi[k], a.max[k]); } } return { lo, hi }; };
const kits = {};
const props = [...inst.entries()].filter(([, I]) => I.name && !BUILDING.test(I.name) && !SKIP.test(I.name) && kat['anime_japan/' + safe(I.name)]);
for (const [bid, I] of inst) {
  if (!I.name || !BUILDING.test(I.name)) continue;
  const bsrc = 'anime_japan/' + safe(I.name); if (!kat[bsrc]) continue;
  const W = worldInst(bid); if (!W) continue;
  const Bw = mul(mul(MX, W), MX), Binv = inv(Bw), box = glbBox(bsrc), got = [];
  for (const [pid, P] of props) {
    const Pw0 = worldInst(pid); if (!Pw0) continue;
    const rel = mul(Binv, mul(mul(MX, Pw0), MX)), x = rel[12], y = rel[13], z = rel[14];
    if (x < box.lo[0] - 0.3 || x > box.hi[0] + 0.3 || z < box.lo[2] - 0.3 || z > box.hi[2] + 2.2 || y < -0.4 || y > box.hi[1]) continue;
    got.push({ src: 'anime_japan/' + safe(P.name), m: rel.map(v => +v.toFixed(5)) });
  }
  if (!kits[bsrc] || got.length > kits[bsrc].props.length) kits[bsrc] = { dims: kat[bsrc].wymiary_m, from: bid, props: got };
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'kits.json'), JSON.stringify(kits) + '\n');
for (const [k, v] of Object.entries(kits)) console.log(k.padEnd(48), v.props.length, 'props:', [...new Set(v.props.map(p => p.src.split('/')[1]))].slice(0, 18).join(' '));
