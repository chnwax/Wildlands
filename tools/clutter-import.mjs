// Imports the props of the "Urban Clutter" pack (AssetsToUse/Urban Clutter, FBX from poly.pizza) that the town uses —
// garden tools, a rain barrel, tyres, planks, cardboard boxes, refuse sacks, brick edging, a skip, site pipes and
// barriers — into one compact file the game loads: assets/models/clutter/clutter.{json,bin}.
//   node tools/clutter-import.mjs
// Each prop becomes one mesh with its materials baked into vertex colours (the pack is flat-coloured; the few props
// drawn from a missing texture atlas get one plausible colour), turned Y-up, standing on y = 0, centred, and scaled to
// its real size (the pack's own scales vary between files).
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { readFBX, fbxScene } from './fbx.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..');
const SRC = path.join(ROOT, 'AssetsToUse/Urban Clutter');
const OUT = path.join(ROOT, 'assets/models/clutter');
// name: [file, size (m) of the largest dimension or { h: height }, colour for atlas-textured files, tone]
const PROPS = {
  tires_pile: ['Tires/Debris_Tires.fbx', 1.25],
  tire_stack: ['Wheels Stack/Wheels_Stack.fbx', { h: 0.78 }, [0.05, 0.05, 0.055]],
  wood_planks: ['Wood Planks/WoodPlanks.fbx', 1.75],
  shovel: ['Shovel/Shovel.fbx', 1.1],
  axe: ['Axe/Axe.fbx', 0.75],
  gas_can: ['Gas Can/GasCan.fbx', 0.46],
  rain_barrel: ['Barrel/Barrel.fbx', { h: 0.92 }, [0.16, 0.28, 0.36]],
  cardboard_boxes: ['Cardboard Boxes/CardboardBoxes_1.fbx', 0.95],
  cardboard_stack: ['Cardboard Boxes/CardboardBoxes_4.fbx', 1.5],
  refuse_sack: ['Trash Bag/TrashBag_1.fbx', { h: 0.55 }, [0.74, 0.8, 0.82]],
  refuse_sacks: ['Trash Bags/TrashBag_2.fbx', 0.95, [0.72, 0.78, 0.8]],
  brick_edging: ['Brick Wall/BrickWall_1.fbx', 2.2],
  brick_paving: ['Bricks/Floor_BricksSeparate2.fbx', 1.3],
  skip_bin: ['Dumpster/TrashContainer.fbx', 1.9],
  site_pipes: ['Pipes/Pipes.fbx', 3.2],
  site_barrier: ['Barrier Single/Barrier_Single.fbx', 1.6],
  debris_pile: ['Debris Pile/Debris_Pile.fbx', 2.4],
};
const deg = Math.PI / 180;
const xform = (m, models) => { const chain = []; for (let k = m; k; k = models.get(k).parent) chain.push(models.get(k));
  return p => { let [x, y, z] = p; for (const M of chain) { x *= M.S[0]; y *= M.S[1]; z *= M.S[2];
    for (const [ax, a] of [[0, M.R[0]], [1, M.R[1]], [2, M.R[2]]]) { if (!a) continue; const c = Math.cos(a * deg), s = Math.sin(a * deg);
      if (ax === 0) [y, z] = [y * c - z * s, y * s + z * c]; else if (ax === 1) [x, z] = [x * c + z * s, -x * s + z * c]; else [x, y] = [x * c - y * s, x * s + y * c]; }
    x += M.T[0]; y += M.T[1]; z += M.T[2]; } return [x, y, z]; }; };
const rotOnly = (m, models) => { const f = xform(m, models), o = f([0, 0, 0]); return n => { const p = f(n), l = Math.hypot(p[0] - o[0], p[1] - o[1], p[2] - o[2]) || 1; return [(p[0] - o[0]) / l, (p[1] - o[1]) / l, (p[2] - o[2]) / l]; }; };

function convert(name, [file, size, atlas]) {
  const sc = fbxScene(readFBX(path.join(SRC, file)));
  const tris = [];
  for (const g of sc.meshes) {
    const M = sc.models.get(g.model), P = xform(g.model, sc.models), N = rotOnly(g.model, sc.models), mats = (M && M.materials) || [];
    for (let t = 0; t < g.pos.length / 9; t++) {
      const m = mats[g.mat[t]] || mats[0], col = atlas || (m ? m.color : [0.6, 0.6, 0.6]);
      tris.push({ col, vs: [0, 1, 2].map(k => { const i = t * 9 + k * 3; return { p: P([g.pos[i], g.pos[i + 1], g.pos[i + 2]]), n: N([g.nor[i], g.nor[i + 1], g.nor[i + 2]]) }; }) });
    }
  }
  // bounds -> stand on y = 0, centred, real size
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const t of tris) for (const v of t.vs) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], v.p[k]); hi[k] = Math.max(hi[k], v.p[k]); }
  const dim = hi.map((v, k) => v - lo[k]), k = typeof size === 'object' ? size.h / dim[1] : size / Math.max(...dim);
  const c = [(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2];
  const V = new Map(), pos = [], nor = [], col = [], idx = [];
  for (const t of tris) for (const v of t.vs) {
    const p = v.p.map((q, i) => Math.round((q - c[i]) * k * 4000)), n = v.n.map(q => Math.round(q * 127)), cc = t.col.map(q => Math.round(Math.min(1, Math.max(0, q)) * 255));
    const key = p.join(',') + '/' + n.join(',') + '/' + cc.join(','); let i = V.get(key);
    if (i === undefined) { i = pos.length / 3; V.set(key, i); pos.push(...p); nor.push(...n, 0); col.push(...cc, 255); }
    idx.push(i);
  }
  return { size: dim.map(v => +(v * k).toFixed(3)), pos, nor, col, idx };
}

const chunks = [], meta = { source: 'Urban Clutter (poly.pizza)', scale: 4000, props: {} }; let off = 0;
const push = arr => { const b = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength); const pad = (4 - (off + b.length) % 4) % 4; const at = off; chunks.push(b, Buffer.alloc(pad)); off += b.length + pad; return at; };
for (const [name, def] of Object.entries(PROPS)) {
  const c = convert(name, def);
  meta.props[name] = { size: c.size, n: c.pos.length / 3, i: c.idx.length, pos: push(Int16Array.from(c.pos)), nor: push(Int8Array.from(c.nor)), col: push(Uint8Array.from(c.col)), idx: push(Uint16Array.from(c.idx)) };
  console.log(name.padEnd(16), 'size', c.size.join(' x '), 'tris', c.idx.length / 3);
}
fs.mkdirSync(OUT, { recursive: true });
const bin = Buffer.concat(chunks);
meta.hash = crypto.createHash('sha1').update(bin).digest('hex').slice(0, 12);
fs.writeFileSync(path.join(OUT, 'clutter.bin'), bin);
fs.writeFileSync(path.join(OUT, 'clutter.json'), JSON.stringify(meta));
console.log('wrote', off, 'bytes');
