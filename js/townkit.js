// Town construction kit: batched geometry builder, PBR materials, canvas-drawn signage, buildings and street props.
import { capHooks, lampPoints, withScatterMeta, THREE, scene, S, Q, clamp, lerp, mulberry32, phTex, NFLAT, addBox, addCircle, addPlatform, maxAniso, Scatter, addProp } from './core.js';
import { env } from './sky.js';
import { relief, weather, asphaltAge, wornPaint, windowMaterial, paving } from './surface.js';
import { placeable, atXYZR, atObj, atLocal } from './world/capture.js';

// ---------------------------------------------------------------- batched builder
// Geometry is accumulated per (material, 96 m chunk) and flushed into a few hundred meshes.
const V3 = (a, b, c) => [a, b, c];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const WHITE = [1, 1, 1];

// Growable typed buffer with Array-like push/length. The whole town is accumulated before it is flushed, and plain JS
// arrays of doubles (8 bytes a number, plus growth slack) pushed the build past the renderer's 4 GB heap; float32 /
// uint32 storage is 4 bytes a number and converts to a vertex attribute without a copy.
function releaseArray() { this.array = null; }
export const keepArrays = { on: false }; // set by the world editor before the map is built
class GrowBuf {
  constructor(T = Float32Array, cap = 256) { this.T = T; this.a = new T(cap); this.length = 0; }
  grow(n) { if (this.length + n <= this.a.length) return; let c = this.a.length * 2; while (c < this.length + n) c *= 2; const b = new this.T(c); b.set(this.a.subarray(0, this.length)); this.a = b; }
  push(...v) { this.grow(v.length); for (let i = 0; i < v.length; i++) this.a[this.length++] = v[i]; return this.length; }
  zeros(n) { this.grow(n); this.a.fill(0, this.length, this.length + n); this.length += n; }
  view() { return this.a.slice(0, this.length); }
}
export class GeoBuilder {
  // (buckets twice the requested size: half the draw calls, measured to cost nothing in culling)
  constructor(chunk = 96) { this.chunk = chunk * 2; this.parts = new Map(); this.lod = 0; this.frame(0, 0, 0, 0); }
  // emit fn's geometry as detail of level n (1: fine parts, 2: micro details); those meshes are drawn only near the camera
  detail(n, fn) { const o = this.lod; this.lod = Math.max(o, n); try { return fn(); } finally { this.lod = o; } }
  frame(x, y, z, r = 0) { this.F = { x, y, z, c: Math.cos(r), s: Math.sin(r), r }; if (capHooks.frame) capHooks.frame(x, y, z, r); return this; }
  P(l) { const F = this.F; return [F.x + l[0] * F.c + l[2] * F.s, F.y + l[1], F.z - l[0] * F.s + l[2] * F.c]; }
  N(n) { const F = this.F; return [n[0] * F.c + n[2] * F.s, n[1], -n[0] * F.s + n[2] * F.c]; }
  bucket(mat, x, z) {
    const c = this.lod ? this.chunk / 2 : this.chunk, k = mat + '|' + this.lod + '|' + Math.floor(x / c) + ',' + Math.floor(z / c);
    let b = this.parts.get(k); if (!b) { b = { mat, lod: this.lod, pos: new GrowBuf(), nor: new GrowBuf(), uv: new GrowBuf(), col: new GrowBuf(), idx: new GrowBuf(Uint32Array), extra: {}, mesh: null }; this.parts.set(k, b); }
    if (capHooks.bucket) capHooks.bucket(b); // (world objects: which object wrote which vertices, world/capture.js)
    return b;
  }
  // optional extra per-vertex attributes (opt.attr = { name: [v0, v1, v2(, v3)] }, each a 2-vector); other vertices get 0
  _extra(B, n, attr) {
    if (this.defAttr) { attr = Object.assign({}, attr); for (const k in this.defAttr) if (!(k in attr)) attr[k] = Array(n).fill(this.defAttr[k]); }
    const count = B.pos.length / 3 - n;           // vertices already in the bucket before this primitive
    for (const name in B.extra) if (!attr || !(name in attr)) B.extra[name].zeros(n * 2);
    if (attr) for (const name in attr) {
      if (!B.extra[name]) { B.extra[name] = new GrowBuf(); B.extra[name].zeros(count * 2); }
      for (const v of attr[name]) B.extra[name].push(v[0], v[1]);
    }
  }
  // a,b,c,d local corners, counter-clockwise seen from the front; uv in metres / opt.uv
  quad(mat, a, b, c, d, opt = {}) {
    const e1 = sub(b, a), e2 = sub(d, a), n = this.N(norm(cross(e1, e2)));
    const s = opt.uv || 1, [u0, v0] = opt.uvo || [0, 0], lu = len(e1) / s, lv = len(e2) / s;
    const uvs = opt.uvs || [[u0, v0], [u0 + lu, v0], [u0 + lu, v0 + lv], [u0, v0 + lv]];
    const wa = this.P(a), B = this.bucket(mat, wa[0], wa[2]), base = B.pos.length / 3, col = opt.color || WHITE;
    const ns = opt.normals; // optional per-vertex normals (local frame) for smooth shading
    for (const [i, p] of [a, b, c, d].entries()) { const w = this.P(p), nn = ns ? this.N(norm(ns[i])) : n, cc = opt.colors ? opt.colors[i] : col; // (opt.colors: per-vertex colours)
      B.pos.push(w[0], w[1], w[2]); B.nor.push(nn[0], nn[1], nn[2]); B.uv.push(uvs[i][0], uvs[i][1]); B.col.push(cc[0], cc[1], cc[2]); }
    this._extra(B, 4, opt.attr);
    B.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  tri(mat, a, b, c, opt = {}) {
    const n = this.N(norm(cross(sub(b, a), sub(c, a)))), s = opt.uv || 1;
    const wa = this.P(a), B = this.bucket(mat, wa[0], wa[2]), base = B.pos.length / 3, col = opt.color || WHITE;
    const ax = norm(sub(b, a)), ay = norm(cross(cross(ax, sub(c, a)), ax));
    const uvs = opt.uvs;
    const ns = opt.normals; // optional per-vertex normals (local frame) for smooth shading
    for (const [i, p] of [a, b, c].entries()) { const w = this.P(p), d = sub(p, a), nn = ns ? this.N(norm(ns[i])) : n; B.pos.push(w[0], w[1], w[2]); B.nor.push(nn[0], nn[1], nn[2]);
      if (uvs) B.uv.push(uvs[i][0], uvs[i][1]); else B.uv.push((d[0] * ax[0] + d[1] * ax[1] + d[2] * ax[2]) / s, -(d[0] * ay[0] + d[1] * ay[1] + d[2] * ay[2]) / s);
      const cc = opt.colors ? opt.colors[i] : col; B.col.push(cc[0], cc[1], cc[2]); }
    this._extra(B, 3, opt.attr);
    B.idx.push(base, base + 1, base + 2);
  }
  // axis-aligned box in the current frame; (cx, cz) centre, y0 bottom
  box(mat, cx, y0, cz, w, h, d, opt = {}) {
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2, y1 = y0 + h, sk = opt.skip || '';
    const o = { color: opt.color, uv: opt.uv };
    if (!sk.includes('pz')) this.quad(mat, V3(x0, y0, z1), V3(x1, y0, z1), V3(x1, y1, z1), V3(x0, y1, z1), o);
    if (!sk.includes('nz')) this.quad(mat, V3(x1, y0, z0), V3(x0, y0, z0), V3(x0, y1, z0), V3(x1, y1, z0), o);
    if (!sk.includes('px')) this.quad(mat, V3(x1, y0, z1), V3(x1, y0, z0), V3(x1, y1, z0), V3(x1, y1, z1), o);
    if (!sk.includes('nx')) this.quad(mat, V3(x0, y0, z0), V3(x0, y0, z1), V3(x0, y1, z1), V3(x0, y1, z0), o);
    if (!sk.includes('py')) this.quad(mat, V3(x0, y1, z1), V3(x1, y1, z1), V3(x1, y1, z0), V3(x0, y1, z0), o);
    if (!sk.includes('ny')) this.quad(mat, V3(x0, y0, z0), V3(x1, y0, z0), V3(x1, y0, z1), V3(x0, y0, z1), o);
  }
  // triangle or quad with its winding chosen so it faces along `hint` (local frame)
  poly(mat, pts, hint, opt = {}) {
    const n = cross(sub(pts[1], pts[0]), sub(pts[pts.length - 1], pts[0]));
    let p = pts, uvs = opt.uvs, colors = opt.colors, normals = opt.normals, attr = opt.attr;
    // (turned over: every per-vertex list turns with the points — the paving's slab coordinates (attr) did not, and the
    // slabs smeared across every flipped polygon)
    if (n[0] * hint[0] + n[1] * hint[1] + n[2] * hint[2] < 0) { p = [...pts].reverse(); if (uvs) uvs = [...uvs].reverse(); if (colors) colors = [...colors].reverse(); if (normals) normals = [...normals].reverse();
      if (attr) { attr = Object.assign({}, attr); for (const k in attr) if (Array.isArray(attr[k]) && attr[k].length === pts.length) attr[k] = [...attr[k]].reverse(); } }
    const o = uvs || colors || normals || attr ? Object.assign({}, opt, { uvs, colors, normals, attr }) : opt;
    if (p.length === 3) this.tri(mat, p[0], p[1], p[2], o); else this.quad(mat, p[0], p[1], p[2], p[3], o);
  }
  // box with chamfered edges (bevel b): edges and corners catch the light, so things stop reading as raw primitives
  bbox(mat, cx, y0, cz, w, h, d, b = 0.02, opt = {}) {
    // a chamfer narrower than ~6 mm or on a member under 6 cm thick is below a pixel at any sensible distance: a plain
    // box (24 vertices instead of ~100) — window bars, rails and trim made most of the town's vertex budget
    if (b < 0.006 || Math.min(w, h, d) < 0.06) return this.box(mat, cx, y0, cz, w, h, d, opt);
    b = Math.max(1e-4, Math.min(b, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
    const x0 = cx - w / 2, x1 = cx + w / 2, y1 = y0 + h, z0 = cz - d / 2, z1 = cz + d / 2, sk = opt.skip || '', o = { color: opt.color, uv: opt.uv };
    const X = [x0, x0 + b, x1 - b, x1], Y = [y0, y0 + b, y1 - b, y1], Z = [z0, z0 + b, z1 - b, z1];
    const P = this.poly.bind(this, mat);
    if (!sk.includes('pz')) P([[X[1], Y[1], z1], [X[2], Y[1], z1], [X[2], Y[2], z1], [X[1], Y[2], z1]], [0, 0, 1], o);
    if (!sk.includes('nz')) P([[X[1], Y[1], z0], [X[2], Y[1], z0], [X[2], Y[2], z0], [X[1], Y[2], z0]], [0, 0, -1], o);
    if (!sk.includes('px')) P([[x1, Y[1], Z[1]], [x1, Y[1], Z[2]], [x1, Y[2], Z[2]], [x1, Y[2], Z[1]]], [1, 0, 0], o);
    if (!sk.includes('nx')) P([[x0, Y[1], Z[1]], [x0, Y[1], Z[2]], [x0, Y[2], Z[2]], [x0, Y[2], Z[1]]], [-1, 0, 0], o);
    if (!sk.includes('py')) P([[X[1], y1, Z[1]], [X[2], y1, Z[1]], [X[2], y1, Z[2]], [X[1], y1, Z[2]]], [0, 1, 0], o);
    const bottom = !sk.includes('ny');
    if (bottom) P([[X[1], y0, Z[1]], [X[2], y0, Z[1]], [X[2], y0, Z[2]], [X[1], y0, Z[2]]], [0, -1, 0], o);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { // vertical edges
      const xe = sx > 0 ? x1 : x0, xi = sx > 0 ? X[2] : X[1], ze = sz > 0 ? z1 : z0, zi = sz > 0 ? Z[2] : Z[1];
      P([[xi, Y[1], ze], [xe, Y[1], zi], [xe, Y[2], zi], [xi, Y[2], ze]], [sx, 0, sz], o);
    }
    for (const sy of bottom ? [-1, 1] : [1]) {
      const ye = sy > 0 ? y1 : y0, yi = sy > 0 ? Y[2] : Y[1];
      for (const sz of [-1, 1]) { const ze = sz > 0 ? z1 : z0, zi = sz > 0 ? Z[2] : Z[1]; P([[X[1], yi, ze], [X[2], yi, ze], [X[2], ye, zi], [X[1], ye, zi]], [0, sy, sz], o); }
      for (const sx of [-1, 1]) { const xe = sx > 0 ? x1 : x0, xi = sx > 0 ? X[2] : X[1]; P([[xe, yi, Z[1]], [xe, yi, Z[2]], [xi, ye, Z[2]], [xi, ye, Z[1]]], [sx, sy, 0], o); }
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const xe = sx > 0 ? x1 : x0, xi = sx > 0 ? X[2] : X[1], ze = sz > 0 ? z1 : z0, zi = sz > 0 ? Z[2] : Z[1];
        P([[xi, yi, ze], [xe, yi, zi], [xi, ye, zi]], [sx, sy, sz], o);
      }
    }
  }
  // sweep a closed or open 2D profile ([u right, v up]) along a local path; the solid lies left of the profile's
  // direction of travel (counter-clockwise outlines). opt.closed joins the last profile point to the first.
  sweep(mat, profile, path, opt = {}) {
    const n = path.length, frames = [];
    for (let i = 0; i < n; i++) {
      const a = path[Math.max(0, i - 1)], b = path[Math.min(n - 1, i + 1)];
      const t = norm(sub(b, a)), rc = cross(t, [0, 1, 0]), r = len(rc) < 1e-4 ? [1, 0, 0] : norm(rc), u = cross(r, t);
      frames.push({ p: path[i], r, u });
    }
    const at = (f, q) => [f.p[0] + f.r[0] * q[0] + f.u[0] * q[1], f.p[1] + f.r[1] * q[0] + f.u[1] * q[1], f.p[2] + f.r[2] * q[0] + f.u[2] * q[1]];
    const m = opt.closed ? profile.length : profile.length - 1;
    let along = 0;
    for (let i = 0; i + 1 < n; i++) {
      const seg = len(sub(path[i + 1], path[i])), A = frames[i], Bf = frames[i + 1];
      for (let k = 0; k < m; k++) {
        const q0 = profile[k], q1 = profile[(k + 1) % profile.length], du = q1[0] - q0[0], dv = q1[1] - q0[1];
        const hint = [A.r[0] * dv - A.u[0] * du, A.r[1] * dv - A.u[1] * du, A.r[2] * dv - A.u[2] * du];
        const pl = Math.hypot(du, dv), sc = opt.uv || 1;
        this.poly(mat, [at(A, q0), at(Bf, q0), at(Bf, q1), at(A, q1)], hint, { color: opt.color, attr: opt.attr,
          uvs: [[along / sc, 0], [(along + seg) / sc, 0], [(along + seg) / sc, pl / sc], [along / sc, pl / sc]] });
      }
      along += seg;
    }
    if (opt.caps && opt.closed) { // flat end caps (fan from the profile centroid; convex-ish profiles)
      const c = profile.reduce((a, q) => [a[0] + q[0] / profile.length, a[1] + q[1] / profile.length], [0, 0]);
      for (const [f, s] of [[frames[0], -1], [frames[n - 1], 1]]) {
        const t = norm(sub(path[s < 0 ? Math.min(1, n - 1) : n - 1], path[s < 0 ? 0 : Math.max(0, n - 2)])), hint = [t[0] * s, t[1] * s, t[2] * s];
        for (let k = 0; k < profile.length; k++) this.poly(mat, [at(f, c), at(f, profile[k]), at(f, profile[(k + 1) % profile.length])], hint, { color: opt.capColor || opt.color });
      }
    }
  }
  // box between two local points (for beams, rails, wires-as-bars)
  beam(mat, a, b, w, h, opt = {}) {
    const dx = b[0] - a[0], dz = b[2] - a[2], L = Math.hypot(dx, dz), r = Math.atan2(dx, dz);
    if (L < 1e-5) { this.box(mat, a[0], Math.min(a[1], b[1]), a[2], w, Math.abs(b[1] - a[1]), h, opt); return; } // vertical
    const saved = this.F, F = this.F, ca = Math.cos(r), sa = Math.sin(r);
    // compose rotation: world = frame(local); local beam frame rotated by r around its start
    const P0 = this.P(a);
    this.frame(P0[0], P0[1], P0[2], saved.r + r);
    const dy = b[1] - a[1];
    if (Math.abs(dy) < 1e-4) this.box(mat, 0, -h / 2, L / 2, w, h, L, opt);
    else { // sloped: build as quads
      const hw = w / 2, hh = h / 2;
      const p = (x, y, z) => V3(x, y + dy * z / L, z);
      const o = { color: opt.color, uv: opt.uv };
      this.quad(mat, p(-hw, -hh, 0), p(hw, -hh, 0), p(hw, -hh, L), p(-hw, -hh, L), o);
      this.quad(mat, p(-hw, hh, L), p(hw, hh, L), p(hw, hh, 0), p(-hw, hh, 0), o);
      this.quad(mat, p(hw, -hh, 0), p(hw, hh, 0), p(hw, hh, L), p(hw, -hh, L), o);
      this.quad(mat, p(-hw, -hh, L), p(-hw, hh, L), p(-hw, hh, 0), p(-hw, -hh, 0), o);
    }
    this.F = saved;
  }
  cyl(mat, cx, y0, cz, r0, r1, h, seg = 8, opt = {}) {
    const col = opt.color || WHITE, sl = (r0 - r1) / Math.max(h, 1e-4);
    for (let i = 0; i < seg; i++) {
      const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
      const q = (a, r, y) => V3(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r), nr = a => [Math.cos(a), sl, Math.sin(a)];
      this.quad(mat, q(a1, r0, y0), q(a0, r0, y0), q(a0, r1, y0 + h), q(a1, r1, y0 + h), { color: col, uvs: [[(i + 1) / seg, 0], [i / seg, 0], [i / seg, h / (opt.uv || 1)], [(i + 1) / seg, h / (opt.uv || 1)]],
        normals: opt.smooth === false ? null : [nr(a1), nr(a0), nr(a0), nr(a1)] });
      if (opt.cap) this.tri(mat, V3(cx, y0 + h, cz), q(a1, r1, y0 + h), q(a0, r1, y0 + h), { color: col });
    }
  }
  flush(materials, shadow = {}) {
    const meshes = [];
    for (const b of this.parts.values()) {
      if (!b.idx.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(b.pos.view(), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(b.nor.view(), 3));
      g.setAttribute('uv', new THREE.BufferAttribute(b.uv.view(), 2));
      g.setAttribute('color', new THREE.BufferAttribute(b.col.view(), 3));
      for (const name in b.extra) g.setAttribute(name, new THREE.BufferAttribute(b.extra[name].view(), 2));
      const iv = b.idx.view(), nv = b.pos.length / 3;
      b.pos = b.nor = b.uv = b.col = b.idx = null; b.extra = {};              // let the growable buffers go as soon as copied
      g.setIndex(nv > 65535 ? new THREE.BufferAttribute(iv, 1) : new THREE.BufferAttribute(Uint16Array.from(iv), 1));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, materials[b.mat]);
      if (!materials[b.mat]) console.warn('missing material', b.mat);
      b.mesh = m; Object.defineProperty(m.userData, 'bucket', { value: b, enumerable: false }); // (not copied by clone / JSON)
      m.castShadow = shadow[b.mat] !== false; m.receiveShadow = true; m.matrixAutoUpdate = false;
      if (b.lod) { m.userData.lodDist = LOD_DIST[b.lod]; lodMeshes.push(m); m.layers.set(3); }
      // static and already bounded: once uploaded the CPU copy of every attribute is dropped (it would otherwise hold the
      // whole town twice, in the JS heap and on the GPU)
      // (the world editor keeps them: it reads and rewrites the objects inside these buffers)
      if (!keepArrays.on) { for (const k in g.attributes) g.attributes[k].onUpload(releaseArray); if (g.index) g.index.onUpload(releaseArray); }
      scene.add(m); meshes.push(m);
    }
    this.parts.clear();
    return meshes;
  }
}

// detail levels: fine parts (frames, sills, gutters, railings, AC units) and micro details (meters, vents, grates, bolts)
// are batched into their own smaller chunks and drawn only within these distances (scaled by the quality preset)
const LOD_DIST = [Infinity, 220, 90];
export const lodMeshes = [];
const _lc = new THREE.Vector3();
export function updateLod(cam) {
  const k = Q.lodScale || 1;
  for (const m of lodMeshes) { const bs = m.geometry.boundingSphere; m.visible = _lc.copy(bs.center).distanceTo(cam.position) - bs.radius < m.userData.lodDist * k; }
}

// ---------------------------------------------------------------- materials
export const night = { value: 0 }; // 0 day .. 1 night, drives emissive things
export function updateNight() { night.value = clamp(env.night * 1.15 + (1 - env.day) * 0.3, 0, 1); }
const tex = (name, kind, res = '1k', srgb = true) => phTex(name, kind, res, srgb, kind === 'nor_gl' ? NFLAT : [128, 128, 128]);
function std(o) { return new THREE.MeshStandardMaterial(Object.assign({ vertexColors: true, roughness: 0.9, metalness: 0 }, o)); }
function pbr(name, o = {}, res = '1k') { return std(Object.assign({ map: tex(name, 'diff', res), normalMap: tex(name, 'nor_gl', res, false) }, o)); }
// emissive driven by night factor, tinted by vertex colour
function nightGlow(mat, strength, key) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uNight = night;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n#ifdef USE_COLOR\n totalEmissiveRadiance *= vColor.rgb * uNight * ${strength.toFixed(2)};\n#endif`);
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}
let M = null;
// full PBR set: albedo + normal + ARM (AO/roughness) + height map for parallax, plus weathering
function pbrX(name, depth, wx, o = {}) {
  const m = std(Object.assign({ map: tex(name, 'diff', '1k'), normalMap: tex(name, 'nor_gl', '1k', false), roughnessMap: tex(name, 'arm', '1k', false), aoMap: tex(name, 'arm', '1k', false), roughness: 1, aoMapIntensity: 0.5 }, o));
  m.normalScale.set(0.5, 0.5);
  if (depth > 0) relief(m, tex(name, 'disp', '1k', false), depth * 0.6, name);
  // anime streets are freshly painted: only a whisper of the grime, streaks and moss
  if (wx) weather(m, Object.assign({ ground: 6 }, wx, { grime: (wx.grime ?? 0.6) * 0.18, streaks: (wx.streaks ?? 0.5) * 0.12, moss: (wx.moss ?? 0.3) * 0.15, vary: 0.35 }), name);
  return m;
}
// tactile paving (点字ブロック): yellow 30 cm tiles with raised guide bars (dots = warning), as colour + normal maps
function tactileMat(dots) {
  const N = 128, H = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = (x + 0.5) / N, v = (y + 0.5) / N; let h = 0;
    if (dots) { const cu = (u * 5) % 1 - 0.5, cv = (v * 5) % 1 - 0.5, r = Math.hypot(cu, cv); h = clamp((0.3 - r) / 0.08, 0, 1); }
    else { const cv = (v * 4) % 1 - 0.5, ends = Math.min(u, 1 - u); h = clamp((0.2 - Math.abs(cv)) / 0.07, 0, 1) * clamp((ends - 0.05) / 0.04, 0, 1); }
    const e = Math.min(u, 1 - u, v, 1 - v); h -= clamp((0.012 - e) / 0.012, 0, 1) * 0.6;   // joints between tiles
    H[y * N + x] = h;
  }
  const at = (x, y) => H[((y + N) % N) * N + (x + N) % N];
  const col = canvasTex(N, N, (g) => { const im = g.createImageData(N, N); for (let i = 0; i < N * N; i++) { const h = H[i], ao = 0.82 + 0.18 * clamp(h + 0.3, 0, 1), k = h < -0.2 ? 0.55 : ao; im.data[i * 4] = 238 * k; im.data[i * 4 + 1] = 186 * k; im.data[i * 4 + 2] = 40 * k; im.data[i * 4 + 3] = 255; } g.putImageData(im, 0, 0); });
  const nor = canvasTex(N, N, (g) => { const im = g.createImageData(N, N); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const i = y * N + x, dx = (at(x + 1, y) - at(x - 1, y)) * 2.2, dy = (at(x, y + 1) - at(x, y - 1)) * 2.2, l = Math.hypot(dx, dy, 1); im.data[i * 4] = (-dx / l * 0.5 + 0.5) * 255; im.data[i * 4 + 1] = (dy / l * 0.5 + 0.5) * 255; im.data[i * 4 + 2] = (1 / l * 0.5 + 0.5) * 255; im.data[i * 4 + 3] = 255; } g.putImageData(im, 0, 0); }, false);
  for (const t of [col, nor]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = maxAniso; }
  const m = std({ map: col, normalMap: nor, roughness: 0.62 });
  m.userData.toonNorm = 0.7;
  return m;
}
// cast-iron sewer cover set flush in the road (マンホール蓋): rim, radial ribs, the town's sakura crest and 汚水, as
// colour + normal maps on a circular cut-out (laid as a road decal, so it follows the crown instead of standing proud)
function manholeMat() {
  const N = 256, H = new Float32Array(N * N), c = N / 2;
  const hc = document.createElement('canvas'); hc.width = hc.height = N; const g = hc.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, N, N);
  g.fillStyle = '#777'; g.beginPath(); g.arc(c, c, 124, 0, Math.PI * 2); g.fill();          // frame
  g.fillStyle = '#333'; g.beginPath(); g.arc(c, c, 112, 0, Math.PI * 2); g.fill();          // gap
  g.fillStyle = '#666'; g.beginPath(); g.arc(c, c, 109, 0, Math.PI * 2); g.fill();          // lid
  g.strokeStyle = '#aaa'; g.lineWidth = 5;                                                   // anti-slip lattice
  for (let r = 36; r < 106; r += 14) { g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.stroke(); }
  for (let k = 0; k < 24; k++) { const a = k / 24 * Math.PI * 2; g.beginPath(); g.moveTo(c + Math.cos(a) * 36, c + Math.sin(a) * 36); g.lineTo(c + Math.cos(a) * 104, c + Math.sin(a) * 104); g.stroke(); }
  g.fillStyle = '#555'; g.beginPath(); g.arc(c, c, 32, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#bbb'; for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2 - Math.PI / 2; g.beginPath(); g.ellipse(c + Math.cos(a) * 14, c + Math.sin(a) * 14, 9, 12, a + Math.PI / 2, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#ccc'; g.font = `bold 20px ${JP_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('汚水', c, c + 60);
  const d = g.getImageData(0, 0, N, N).data; for (let i = 0; i < N * N; i++) H[i] = d[i * 4] / 255;
  const at = (x, y) => H[Math.min(N - 1, Math.max(0, y)) * N + Math.min(N - 1, Math.max(0, x))];
  const col = canvasTex(N, N, (g2) => { const im = g2.createImageData(N, N); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const i = y * N + x, r = Math.hypot(x + 0.5 - c, y + 0.5 - c), h = H[i], k = 40 + h * 70;
    im.data[i * 4] = k * 1.02; im.data[i * 4 + 1] = k; im.data[i * 4 + 2] = k * 0.96; im.data[i * 4 + 3] = r < 125 ? 255 : 0; } g2.putImageData(im, 0, 0); });
  const nor = canvasTex(N, N, (g2) => { const im = g2.createImageData(N, N); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const i = y * N + x, dx = (at(x + 1, y) - at(x - 1, y)) * 3, dy = (at(x, y + 1) - at(x, y - 1)) * 3, l = Math.hypot(dx, dy, 1);
    im.data[i * 4] = (-dx / l * 0.5 + 0.5) * 255; im.data[i * 4 + 1] = (dy / l * 0.5 + 0.5) * 255; im.data[i * 4 + 2] = (1 / l * 0.5 + 0.5) * 255; im.data[i * 4 + 3] = 255; } g2.putImageData(im, 0, 0); }, false);
  const m = std({ map: col, normalMap: nor, roughness: 0.5, metalness: 0.55, alphaTest: 0.5, alphaToCoverage: true });
  return m;
}
// one asphalt for every road: age, lane layout and wear come per vertex from the road builder (roads.js)
function asphaltMat() {
  const m = std({ map: tex('asphalt_pit_lane', 'diff', '2k'), normalMap: tex('asphalt_pit_lane', 'nor_gl', '1k', false), roughnessMap: tex('asphalt_pit_lane', 'rough', '1k', false) });
  m.normalScale.set(0.8, 0.8);
  return asphaltAge(m, 'road');
}
export function materials() {
  if (M) return M;
  M = {
    siding: pbrX('exterior_wall_cladding', 0.006, { grime: 0.6, streaks: 0.55, moss: 0.3 }),
    stucco: pbrX('white_stucco', 0.004, { grime: 0.7, streaks: 0.8, moss: 0.35 }),
    plaster: pbrX('beige_wall_001', 0.003, { grime: 0.7, streaks: 0.7, moss: 0.3 }),
    tiles: pbrX('rectangular_facade_tiles', 0.004, { grime: 0.5, streaks: 0.45, moss: 0.2 }),
    concrete: pbrX('concrete_wall_008', 0.004, { grime: 0.8, streaks: 0.85, moss: 0.5 }),
    block: pbrX('concrete_block_wall', 0.01, { grime: 0.9, streaks: 0.7, moss: 0.9 }),
    stone: pbrX('japanese_stone_wall', 0.03, { grime: 0.6, streaks: 0.4, moss: 0.9, ground: 0.5 }),
    roofTile: pbrX('grey_roof_tiles', 0.024, { grime: 0, streaks: 0.3, moss: 0.55 }, { metalness: 0.12, roughness: 0.75 }),
    roofMetal: weather(std({ normalMap: tex('box_profile_metal_sheet', 'nor_gl', '1k', false), roughnessMap: tex('box_profile_metal_sheet', 'rough', '1k', false), metalness: 0.55, roughness: 0.6 }), { grime: 0, streaks: 0.4, moss: 0.15 }, 'roofMetal'),
    // painted box-profile cladding for sheds and workshops: the profile without the roof sheet's rust map
    metalWall: weather(std({ normalMap: tex('box_profile_metal_sheet', 'nor_gl', '1k', false), metalness: 0.3, roughness: 0.48 }), { grime: 0.4, streaks: 0.55, moss: 0, vary: 0.4 }, 'metalWall'),
    wood: pbrX('japanese_cedar_planks', 0.006, { grime: 0.6, streaks: 0.5, moss: 0.4 }),
    asphalt: asphaltMat(),
    pavement: paving(pbrX('concrete_pavement', 0.008, { grime: 0.3, streaks: 0, moss: 0.35 }), 'walk'),
    ballast: pbrX('bicolour_gravel', 0.02, null),
    paint: wornPaint(std({ roughness: 0.62 }), 'road'),
    metal: weather(std({ roughness: 0.45, metalness: 0.4 }), { grime: 0.3, streaks: 0.3, moss: 0, vary: 0.5 }, 'metal'),
    alu: std({ roughness: 0.35, metalness: 0.85, color: 0xc8ccd0 }),
    steel: std({ roughness: 0.3, metalness: 1.0, color: 0x9a9ea2 }),
    plain: weather(std({ roughness: 0.8 }), { grime: 0.5, streaks: 0.5, moss: 0.1, vary: 0.6 }, 'plain'),
    plastic: std({ roughness: 0.35 }),
    dark: std({ roughness: 0.9, color: 0x111213 }),
    shutter: weather(std({ normalMap: tex('painted_metal_shutter', 'nor_gl', '1k', false), roughness: 0.55, metalness: 0.35 }), { grime: 0.6, streaks: 0.6, moss: 0 }, 'shutter'),
    glass: std({ color: 0x28323a, roughness: 0.06, metalness: 0.75, envMapIntensity: 1.2 }),
    glassLit: nightGlow(std({ color: 0x2a3036, roughness: 0.08, metalness: 0.6, emissive: 0xffd6a0, emissiveIntensity: 1 }), 1.6, 'glassLit'),
    window: windowMaterial({ night }),
    shopWindow: windowMaterial({ night, shop: true, base: 6.0, roomW: 5.5, roomH: 3.0, depth: 6.5 }),
    schoolWindow: windowMaterial({ night, school: true, base: 6.0, roomW: 7.2, roomH: 3.6, depth: 7.5 }),
    lamp: nightGlow(std({ color: 0xf4f4f0, roughness: 0.4, emissive: 0xfff2dc, emissiveIntensity: 1 }), 6.0, 'lampGlow'),
    soil: (() => { const m = std({ map: tex('brown_mud', 'diff', '1k'), normalMap: tex('brown_mud', 'nor_gl', '1k', false), roughness: 0.96 }); m.normalScale.set(0.9, 0.9); return m; })(),
    poly: new THREE.MeshStandardMaterial({ color: 0xcfe0e6, roughness: 0.2, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }),
  };
  M.asphaltMain = M.asphaltRoad = M.asphaltLane = M.asphaltLane2 = M.asphalt;
  M.gravelPath = pbrX('bicolour_gravel', 0.02, null, { color: 0xf2e6cf });
  M.stopLegend = stopMat; M.cycleLegend = cycleMat;
  M.tactileL = tactileMat(false); M.tactileD = tactileMat(true); M.manhole = manholeMat();
  // painted brightness per surface (toon.js): light pastel walls, pale concrete and gravel, warm wood
  for (const [k, v] of Object.entries({ siding: 0.58, stucco: 0.6, plaster: 0.6, tiles: 0.56, concrete: 0.64, block: 0.6, pavement: 0.66, ballast: 0.5, wood: 0.46, stone: 0.56, roofTile: 0.62, gravelPath: 0.66, soil: 0.52 }))
    M[k].userData.toonNorm = v;
  for (const m of Object.values(M)) for (const t of [m.map, m.normalMap, m.roughnessMap, m.aoMap]) if (t) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return M;
}

// ---------------------------------------------------------------- canvas textures
export const JP_FONT = '"Yu Gothic UI", "Yu Gothic", "Meiryo", "MS Gothic", "Hiragino Sans", sans-serif';
export function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = maxAniso;
  return t;
}
function fitText(g, text, x, y, maxW, size, font = JP_FONT, weight = 'bold') {
  let s = size; g.font = `${weight} ${s}px ${font}`;
  while (g.measureText(text).width > maxW && s > 8) { s -= 2; g.font = `${weight} ${s}px ${font}`; }
  g.fillText(text, x, y);
}
// A lit sign (canvas texture, glowing at night) as the physical thing it is, centred on its own origin, front +z:
//   back 'panel' (default) a board: the design on the front, a plain painted back and edges (opts.backColor)
//        'both'   a double-faced board: the design readable from either side, painted edges
//        'cut'    cut-out lettering (opts.alpha): the letters seen from behind are their mirrored backs, no edges
//        'flat'   a single face for things painted or stuck flush on a surface (road markings, wall lettering)
// One material, one geometry: the back and edges sample a strip of solid paint below the design on the same canvas, so
// a sign stays a single draw and can be instanced (pole ads) like any other prop.
export function signMesh(w, h, draw, glow = 0.8, px = 256, opts = {}) {
  const kind = opts.back || 'panel', d = opts.depth ?? Math.min(0.035, Math.max(0.014, Math.min(w, h) * 0.035));
  const S = kind === 'panel' || kind === 'both' ? Math.max(8, Math.round(px / 16)) : 0, vs = S / (px + S), sv = vs / 2;
  const t = canvasTex(Math.round(px * w / h), px + S, (g, cw) => { draw(g, cw, px); if (S) { g.fillStyle = opts.backColor || '#5f6263'; g.fillRect(0, px, cw, S); } });
  const m = new THREE.MeshStandardMaterial({ map: t, roughness: opts.roughness ?? 0.5, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0 });
  if (opts.alpha) { m.alphaTest = opts.alpha; m.transparent = !!opts.transparent; }
  m.userData.glow = glow; glowMats.push(m);
  const P = [], N = [], U = [], I = [], hw = w / 2, hh = h / 2, hd = kind === 'flat' ? 0 : d / 2;
  const quad = (a, b, c, e, n, uv) => { const o = P.length / 3; P.push(...a, ...b, ...c, ...e); for (let k = 0; k < 4; k++) N.push(...n); U.push(...uv); I.push(o, o + 1, o + 2, o, o + 2, o + 3); };
  const design = (u0, u1) => [u0, vs, u1, vs, u1, 1, u0, 1], paint = [0.5, sv, 0.5, sv, 0.5, sv, 0.5, sv];
  quad([-hw, -hh, hd], [hw, -hh, hd], [hw, hh, hd], [-hw, hh, hd], [0, 0, 1], design(0, 1));                                   // front
  if (kind !== 'flat') quad([hw, -hh, -hd], [-hw, -hh, -hd], [-hw, hh, -hd], [hw, hh, -hd], [0, 0, -1], kind === 'both' ? design(0, 1) : kind === 'cut' ? design(1, 0) : paint);
  if (kind === 'panel' || kind === 'both') {
    quad([hw, -hh, hd], [hw, -hh, -hd], [hw, hh, -hd], [hw, hh, hd], [1, 0, 0], paint);
    quad([-hw, -hh, -hd], [-hw, -hh, hd], [-hw, hh, hd], [-hw, hh, -hd], [-1, 0, 0], paint);
    quad([-hw, hh, hd], [hw, hh, hd], [hw, hh, -hd], [-hw, hh, -hd], [0, 1, 0], paint);
    quad([-hw, -hh, -hd], [hw, -hh, -hd], [hw, -hh, hd], [-hw, -hh, hd], [0, -1, 0], paint);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setIndex(I); g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = false; mesh.receiveShadow = true;
  return mesh;
}
export const glowMats = [];
export function updateGlow() { for (const m of glowMats) m.emissiveIntensity = m.userData.glow * (0.15 + night.value * 1.6); }

export const SHOP_NAMES = [
  ['ラーメン', '桜屋', '#b3261e', '#fff'], ['薬局', 'くすりのヤマダ', '#1f6fb5', '#fff'], ['美容室', 'hair salon Lumi', '#f4efe6', '#333'],
  ['居酒屋', 'とり吉', '#2b2320', '#f2d49b'], ['クリーニング', 'ホワイト急便', '#e9f1f7', '#1f5f9b'], ['不動産', '桜川ホーム', '#f5f5f0', '#1f7a3a'],
  ['和菓子', '福田堂', '#3d2b1f', '#f2e3c6'], ['喫茶', 'ひだまり', '#6b4f36', '#fff3dd'], ['酒', 'たなか酒店', '#1d3557', '#fff'],
  ['理容', 'バーバー森', '#ffffff', '#b3261e'], ['書店', 'さくら書房', '#2e5e4e', '#fff'], ['パン工房', 'こむぎ', '#f6e7c8', '#7a4a1e'],
  ['そば・うどん', '更科', '#1c1c1c', '#fff'], ['歯科医院', '桜川デンタル', '#ffffff', '#1a8a9a'], ['花', 'フラワー花子', '#f3d7e0', '#7a2a4a'],
  ['自転車', 'サイクル中村', '#ffcc00', '#222'], ['寿司', 'すし政', '#f4ecdc', '#1b1b1b'], ['整骨院', 'さくら整骨院', '#0e6b3a', '#fff'],
];
// what each kind of shop looks like inside (surface.js): 0 shelves, 1 café, 2 restaurant counter, 3 salon / clinic,
// 4 office, 5 workshop, 6 bookshop, 7 bakery / sweets counter
export const SHOP_INTERIOR = [2, 0, 3, 2, 0, 4, 7, 1, 0, 3, 6, 7, 2, 3, 0, 5, 2, 3];
export function shopSign(rng, w, pickIdx) {
  const r0 = rng(), [kind, name, bg, fg] = SHOP_NAMES[pickIdx ?? Math.floor(r0 * SHOP_NAMES.length)];
  return signMesh(w, 0.9, (g, W, H) => {
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.fillStyle = fg; g.textBaseline = 'middle'; g.textAlign = 'center';
    fitText(g, kind + '　' + name, W / 2, H * 0.54, W * 0.9, H * 0.62);
    g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 6; g.strokeRect(3, 3, W - 6, H - 6);
  }, 0.9);
}
export function verticalSign(rng, pickIdx) {
  const r0 = rng(), [kind, , bg, fg] = SHOP_NAMES[pickIdx ?? Math.floor(r0 * SHOP_NAMES.length)];
  const chars = [...kind].slice(0, 4);
  return signMesh(0.55, 0.5 + chars.length * 0.5, (g, W, H) => {
    g.fillStyle = bg; g.fillRect(0, 0, W, H); g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    const cs = H / (chars.length + 0.6);
    chars.forEach((c, i) => { g.font = `bold ${Math.min(W * 0.8, cs * 0.85)}px ${JP_FONT}`; g.fillText(c, W / 2, cs * (i + 0.8)); });
  }, 1.0, 512);
}

// vending machine front (drinks)
const vendTex = [];
function vendingTexture(i) {
  if (vendTex[i]) return vendTex[i];
  const palettes = [['#c8102e', '#fff'], ['#0b4ea2', '#e8f1fb'], ['#f3f3ef', '#2f7d32'], ['#1b1b1b', '#e1b12c'], ['#e8e8e8', '#0b4ea2']];
  const [body, accent] = palettes[i % palettes.length], rng = mulberry32(900 + i);
  vendTex[i] = canvasTex(512, 1024, (g, W, H) => {
    g.fillStyle = body; g.fillRect(0, 0, W, H);
    g.fillStyle = '#f7fbff'; g.fillRect(30, 40, W - 60, H * 0.52);
    const cols = 6, rows = 4, cw = (W - 80) / cols, rh = H * 0.52 / rows;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = 40 + c * cw, y = 50 + r * rh, hue = rng() * 360;
      g.fillStyle = `hsl(${hue},${40 + rng() * 50}%,${35 + rng() * 35}%)`;
      const bw = cw * 0.52, bh = rh * 0.62, bx = x + (cw - bw) / 2, by = y + rh * 0.08;
      if (rng() < 0.5) { g.fillRect(bx, by + bh * 0.25, bw, bh * 0.75); g.fillRect(bx + bw * 0.3, by, bw * 0.4, bh * 0.3); }
      else { g.beginPath(); g.roundRect(bx, by + bh * 0.1, bw, bh * 0.9, 8); g.fill(); }
      g.fillStyle = '#222'; g.font = `bold ${rh * 0.13}px ${JP_FONT}`; g.textAlign = 'center';
      g.fillText('¥' + [100, 110, 120, 130, 150, 160][Math.floor(rng() * 6)], x + cw / 2, y + rh * 0.86);
      g.fillStyle = '#2bd14b'; g.fillRect(x + cw * 0.3, y + rh * 0.9, cw * 0.4, rh * 0.06);
    }
    g.fillStyle = accent; g.fillRect(30, H * 0.6, W - 60, 90);
    g.fillStyle = body; g.font = `bold 58px ${JP_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(['つめた〜い', 'あったか〜い', 'おいしい水', 'リフレッシュ', 'ドリンク'][i % 5], W / 2, H * 0.6 + 45);
    g.fillStyle = '#2a2a2a'; g.fillRect(W * 0.62, H * 0.7, 120, 150); g.fillStyle = '#58c2ff'; g.fillRect(W * 0.64, H * 0.72, 90, 50);
    g.fillStyle = '#111'; g.fillRect(50, H * 0.86, W - 100, 100);
  });
  return vendTex[i];
}

// ---------------------------------------------------------------- props
// the cabinet: the box's five painted faces (instanced, one shared material per body colour) and its lit front, which
// carries the machine's own product display (its own texture, so its own mesh)
const vmBox = new THREE.BoxGeometry(1.0, 1.83, 0.75), vmGeo = (() => { const g = vmBox.clone(), I = [];
  for (const gr of vmBox.groups) if (gr.materialIndex !== 4) for (let k = 0; k < gr.count; k++) I.push(vmBox.index.array[gr.start + k]);
  g.setIndex(I); g.clearGroups(); return g; })();
const vmFrontGeo = new THREE.PlaneGeometry(1.0, 1.83).translate(0, 0, 0.375);
const vmSideMats = [0xc8102e, 0x0b4ea2, 0xf3f3ef, 0x1b1b1b, 0xe8e8e8].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.4, metalness: 0.3 }));
const _pm = new THREE.Matrix4(), _pq = new THREE.Quaternion(), _pe = new THREE.Euler(), _pv = new THREE.Vector3(), _ps = new THREE.Vector3(1, 1, 1);
const propMatrix = (x, y, z, ry, out = new THREE.Matrix4()) => out.compose(_pv.set(x, y, z), _pq.setFromEuler(_pe.set(0, ry, 0)), _ps);
function vendingMachine_build(x, y, z, r, i, B = null) {
  const t = vendingTexture(i);
  const front = new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0, roughness: 0.35 });
  front.userData.glow = 0.55; glowMats.push(front);
  const M = propMatrix(x, y + 0.915 + 0.06, z, r);
  const m = new THREE.Mesh(vmFrontGeo, front); m.matrixAutoUpdate = false; m.matrix.copy(M); m.castShadow = true; m.receiveShadow = true; m.userData.keepShadow = true;
  scene.add(m); addBox(x, z, 0.5, 0.38, r);
  m.userData.prop = addProp('vendingMachine', [{ geometry: vmGeo, material: vmSideMats[i % 5], matrix: M, castShadow: true }]);
  if (B) { // plinth, bezel round the display, lit header, coin panel, retrieval bin, and a bottle recycling box beside it
    const F = B.F; B.frame(x, y, z, r);
    const bc = [[0.78, 0.06, 0.18], [0.04, 0.3, 0.64], [0.9, 0.9, 0.88], [0.1, 0.1, 0.1], [0.88, 0.88, 0.88]][i % 5];
    B.bbox('dark', 0, 0, 0, 1.02, 0.07, 0.76, 0.01, { color: [0.12, 0.12, 0.12] });
    B.detail(1, () => {
      for (const sx of [-1, 1]) B.bbox('plastic', sx * 0.48, 0.07, 0.385, 0.05, 1.83, 0.03, 0.006, { color: bc });
      B.bbox('plastic', 0, 1.86, 0.385, 1.0, 0.05, 0.03, 0.006, { color: bc });
      B.bbox('plastic', 0, 0.12, 0.39, 0.86, 0.26, 0.05, 0.01, { color: [0.12, 0.12, 0.13] });           // retrieval bin
      B.bbox('plastic', 0, 0.18, 0.42, 0.7, 0.16, 0.01, 0.004, { color: [0.2, 0.22, 0.24] });            // its flap
      B.bbox('plastic', 0.27, 0.72, 0.4, 0.22, 0.34, 0.04, 0.008, { color: [0.2, 0.2, 0.22] });           // coin / card panel
      B.box('steel', 0.27, 0.95, 0.425, 0.04, 0.05, 0.01, { color: [0.7, 0.7, 0.7] });
    });
    if (i % 3 === 0) { B.bbox('plastic', 0.78, 0, 0.1, 0.42, 0.9, 0.42, 0.04, { color: [0.2, 0.45, 0.8] }); B.detail(1, () => B.cyl('dark', 0.78, 0.9, 0.1, 0.06, 0.06, 0.005, 10, { cap: true, color: [0.05, 0.05, 0.05] })); addBox(...B.P([0.78, 0, 0.1]).filter((_, k) => k !== 1), 0.22, 0.22, r); }
    B.F = F;
  }
  return m;
}

// utility pole with crossarms, insulators, optional transformer and street light; returns wire attach points (world)
const poleAds = {}; // one painted advert (texture, material, plate) per text, shared by every pole that carries it
const POLE_ADS = ['桜川歯科 →', 'やまだ内科', '学習塾 明星', '中村鉄工所', 'さくら整骨院', '桜川不動産'];
const poleAdTex = {};
function utilityPole_build(B, x, y, z, r, rng, { transformer = false, light = false, side = 1 } = {}) {
  B.frame(x, y, z, r);
  B.cyl('concrete', 0, -0.2, 0, 0.19, 0.13, 12.7, 16, { color: [0.78, 0.78, 0.76], uv: 3 });
  B.cyl('concrete', 0, 12.5, 0, 0.13, 0.08, 0.06, 16, { color: [0.72, 0.72, 0.7], cap: true });
  // yellow/black guard sleeve at the base, bolted
  for (let i = 0; i < 6; i++) B.cyl('plastic', 0, 0.3 + i * 0.25, 0, 0.205, 0.203, 0.25, 16, { color: i % 2 ? [0.08, 0.08, 0.08] : [0.95, 0.75, 0.05] });
  B.detail(2, () => { // climbing step bolts, alternating sides, from 2.6 m up
    for (let k = 0; k < 16; k++) { const hh = 2.6 + k * 0.45, a = (k % 2 ? 1 : -1) * Math.PI / 2 + Math.PI / 2; B.beam('steel', [Math.cos(a) * 0.13, hh, Math.sin(a) * 0.13], [Math.cos(a) * 0.36, hh + 0.02, Math.sin(a) * 0.36], 0.022, 0.022, { color: [0.45, 0.45, 0.46] }); }
  });
  const pts = [];
  for (const [h, wdt, n] of [[11.9, 1.8, 3], [10.9, 1.4, 2]]) {
    B.detail(1, () => {
      B.bbox('metal', 0, h - 0.08, 0, wdt, 0.1, 0.09, 0.01, { color: [0.36, 0.37, 0.38] });
      for (const e of [-1, 1]) B.beam('metal', [e * wdt * 0.38, h - 0.05, 0.02], [0, h - 0.75, 0.14], 0.035, 0.035, { color: [0.36, 0.37, 0.38] }); // braces
    });
    for (let k = 0; k < n; k++) {
      const ox = (k / (n - 1) - 0.5) * (wdt - 0.2);
      B.detail(1, () => { for (let j = 0; j < 3; j++) B.cyl('plastic', ox, h + 0.03 + j * 0.055, 0, 0.065 - j * 0.008, 0.05 - j * 0.008, 0.05, 10, { color: [0.93, 0.92, 0.9], cap: j === 2 }); });
      pts.push(B.P([ox, h + 0.18, 0]));
    }
  }
  // telecom cable with a closure, low-voltage service box
  B.detail(1, () => { B.bbox('metal', 0.12 * side, 8.05, 0, 0.36, 0.08, 0.08, 0.01, { color: [0.3, 0.3, 0.3] }); B.bbox('dark', 0.24 * side, 5.85, 0, 0.13, 0.36, 0.13, 0.02); B.cyl('plastic', 0.42 * side, 7.7, 0, 0.1, 0.1, 0.55, 10, { color: [0.16, 0.16, 0.17], cap: true }); });
  pts.push(B.P([0.28 * side, 8.1, 0])); pts.push(B.P([0.02, 6.2, 0]));
  if (transformer) B.detail(1, () => {
    const tx = 0.6 * side;
    B.cyl('metal', tx, 8.5, 0, 0.31, 0.31, 1.05, 16, { color: [0.64, 0.66, 0.66], cap: true });
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; B.box('metal', tx + Math.cos(a) * 0.33, 8.55, Math.sin(a) * 0.33, 0.04, 0.9, 0.04, { color: [0.58, 0.6, 0.6] }); } // cooling fins
    for (const bx of [-0.12, 0.12]) { B.cyl('plastic', tx + bx, 9.55, 0, 0.04, 0.03, 0.2, 8, { color: [0.4, 0.3, 0.25], cap: true }); B.beam('steel', [tx + bx, 9.75, 0], [bx * 2, 10.9, 0], 0.012, 0.012, { color: [0.15, 0.15, 0.15] }); }
    for (const yy of [8.7, 9.3]) B.bbox('metal', tx * 0.55, yy, 0, 0.62, 0.06, 0.08, 0.01, { color: [0.36, 0.37, 0.38] });
    B.box('plain', tx, 9.05, 0.32, 0.18, 0.12, 0.01, { color: [0.95, 0.95, 0.9] });
  });
  if (light) {
    B.detail(1, () => B.sweep('metal', [[-0.03, -0.03], [0.03, -0.03], [0.03, 0.03], [-0.03, 0.03]], [[0, 7.1, 0], [0.7 * side, 7.5, 0], [1.4 * side, 7.62, 0]], { closed: true, caps: true, color: [0.55, 0.57, 0.58] }));
    B.bbox('metal', 1.6 * side, 7.5, 0, 0.52, 0.09, 0.24, 0.02, { color: [0.4, 0.42, 0.44] });
    B.box('lamp', 1.6 * side, 7.47, 0, 0.42, 0.035, 0.18);
  }
  // number plate and, on some poles, a wrap-around advert sleeve
  B.detail(2, () => B.bbox('plain', 0, 2.2, 0.2, 0.17, 0.48, 0.02, 0.004, { color: [0.95, 0.95, 0.92] }));
  if (rng() < 0.35) {
    const txt = POLE_ADS[Math.floor(rng() * POLE_ADS.length)];
    const ad = poleAds[txt] || (poleAds[txt] = signMesh(0.36, 1.25, (g, W, H) => { g.fillStyle = txt.includes('歯科') || txt.includes('内科') ? '#1f6e4a' : txt.includes('塾') ? '#b8322a' : '#23448c'; g.fillRect(0, 0, W, H); g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      const chars = [...txt.replace(' →', '')]; g.font = `bold ${Math.min(W * 0.72, H / (chars.length + 1))}px ${JP_FONT}`; chars.forEach((c, i) => g.fillText(c, W / 2, H * (i + 0.8) / (chars.length + 0.6))); }, 0.1, 128));
    const p = B.P([0, 2.95, 0.2]);
    addProp('poleAd', [{ geometry: ad.geometry, material: ad.material, matrix: propMatrix(p[0], p[1], p[2], r) }]);
  }
  addCircle(x, z, 0.25);
  return { pts, lamp: light ? B.P([1.6 * side, 7.3, 0]) : null };
}
// sagging wires between consecutive poles (lines are the right visual weight for 1-2 cm cables)
// 1 px lines at any distance would read far too heavy and crawl: coverage follows the cable's real ~16 mm diameter in
// pixels (never below a faint 12 %), resolved through alpha-to-coverage, so distant spans thin out instead of flickering
export const wireMat = new THREE.ShaderMaterial({
  alphaToCoverage: true, fog: true, uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uPx: { value: 800 } }]),
  vertexShader: `uniform float uPx; varying float vCov;
    #include <common>
    #include <fog_pars_vertex>
    void main(){ vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition; vCov = clamp(0.016 * uPx / max(-mvPosition.z, 0.1), 0.12, 1.0);
    #include <fog_vertex>
    }`,
  fragmentShader: `varying float vCov;
    #include <common>
    #include <fog_pars_fragment>
    void main(){ gl_FragColor = vec4(vec3(0.1, 0.105, 0.11), vCov);
    #include <fog_fragment>
    }`,
});
wireMat.onBeforeRender = (r, sc, cam) => { wireMat.uniforms.uPx.value = r.getDrawingBufferSize(_wv).y / (2 * Math.tan(cam.fov * Math.PI / 360)); };
const _wv = new THREE.Vector2();
export function wires(poles) {
  const P = [];
  for (let i = 0; i + 1 < poles.length; i++) {
    const a = poles[i].pts, b = poles[i + 1].pts, n = Math.min(a.length, b.length);
    const span = Math.hypot(a[0][0] - b[0][0], a[0][2] - b[0][2]); if (span > 60) continue;
    for (let k = 0; k < n; k++) {
      const sag = 0.25 + span * 0.012 + (k === n - 2 ? 0.25 : 0);
      for (let s = 0; s < 8; s++) {
        const t0 = s / 8, t1 = (s + 1) / 8;
        for (const t of [t0, t1]) P.push(lerp(a[k][0], b[k][0], t), lerp(a[k][1], b[k][1], t) - sag * 4 * t * (1 - t), lerp(a[k][2], b[k][2], t));
      }
    }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  const l = new THREE.LineSegments(g, wireMat); l.frustumCulled = false; scene.add(l);
  return l;
}

// convex traffic mirror (カーブミラー): orange steel pole on a concrete footing, clamp bands, a bracket arm to each
// mirror; the mirror is a convex glass dome in a deep orange housing with a moulded back shell, a rain visor over the
// top and a small ID plate. heads: 1 (single) or 2 (a T-bar carrying two mirrors angled toward both approaches).
// Local frame: +z = the direction the (first) mirror faces.
const mirrorMat = new THREE.MeshStandardMaterial({ color: 0xdfe8ee, metalness: 0.85, roughness: 0.08, envMapIntensity: 1.2 });
const mirrorShellMat = new THREE.MeshStandardMaterial({ color: 0xf07818, roughness: 0.45 });
const mirrorGlass = new THREE.SphereGeometry(1, 28, 8, 0, Math.PI * 2, 0, 0.42).rotateX(Math.PI / 2);        // dome facing +z
const mirrorBack = new THREE.SphereGeometry(1, 28, 8, 0, Math.PI * 2, 0, 0.9).rotateX(-Math.PI / 2);         // shell facing -z
const mirrorRim = new THREE.TorusGeometry(0.425, 0.04, 8, 36).scale(1, 1, 1.8);
const mirrorVisorMat = new THREE.MeshStandardMaterial({ color: 0xf07818, roughness: 0.45, side: THREE.DoubleSide });
// rain visor: an arc over the top of the rim (after rotateX(90) the cylinder's angle PI points up)
const mirrorVisor = new THREE.CylinderGeometry(0.47, 0.47, 0.16, 24, 1, true, Math.PI * 0.6, Math.PI * 0.8);
const mirrorPlate = new THREE.BoxGeometry(0.16, 0.06, 0.008), mirrorTab = new THREE.BoxGeometry(0.05, 0.12, 0.03), mirrorPlateMat = new THREE.MeshStandardMaterial({ color: 0xf4f4ee, roughness: 0.6 });

function curveMirror_build(B, x, y, z, r, heads = 1) {
  B.frame(x, y, z, r);
  const OR = [0.94, 0.47, 0.1], H = 3.3, R = 0.4;
  B.cyl('concrete', 0, -0.06, 0, 0.16, 0.18, 0.1, 12, { color: [0.68, 0.68, 0.66], cap: true });
  B.cyl('plain', 0, 0, 0, 0.038, 0.038, H, 12, { color: OR });
  B.cyl('plain', 0, H, 0, 0.042, 0.02, 0.05, 12, { color: OR, cap: true });
  B.detail(1, () => { for (const yy of [1.9, 2.6]) B.cyl('steel', 0, yy, 0, 0.045, 0.045, 0.05, 12, { color: [0.72, 0.72, 0.74] }); });
  const angles = heads === 2 ? [-0.5, 0.5] : [0];
  if (heads === 2) B.beam('plain', [-0.42, H - 0.3, 0.05], [0.42, H - 0.3, 0.05], 0.05, 0.05, { color: OR });
  for (const a of angles) {
    const ox = heads === 2 ? Math.sign(a) * 0.4 : 0, cy = H - 0.3, holder = new THREE.Group();
    B.beam('plain', [ox, cy, 0], [ox, cy, 0.22], 0.045, 0.045, { color: OR });                                    // arm
    const p = B.P([ox + Math.sin(a) * 0.3, cy, 0.22 + Math.cos(a) * 0.3]); holder.position.set(p[0], p[1], p[2]); holder.rotation.y = r + a;
    // spherical caps: a cap of angle a scaled by s has radius s*sin(a) and depth s*(1 - cos(a))
    const gs = R / Math.sin(0.42), gz = 0.035 / (1 - Math.cos(0.42)), bs = (R + 0.04) / Math.sin(0.9), bz = 0.14 / (1 - Math.cos(0.9));
    const back = new THREE.Mesh(mirrorBack, mirrorShellMat); back.scale.set(bs, bs, bz); back.position.z = bz * Math.cos(0.9) + 0.01;
    const rim = new THREE.Mesh(mirrorRim, mirrorShellMat); rim.position.z = 0.02;
    const glass = new THREE.Mesh(mirrorGlass, mirrorMat); glass.scale.set(gs, gs, gz); glass.position.z = -gz * Math.cos(0.42) + 0.005;
    const visor = new THREE.Mesh(mirrorVisor, mirrorVisorMat); visor.rotation.x = Math.PI / 2; visor.position.z = 0.1;
    const plate = new THREE.Mesh(mirrorPlate, mirrorPlateMat); plate.position.set(0, -R - 0.12, 0.02);
    const tab = new THREE.Mesh(mirrorTab, mirrorShellMat); tab.position.set(0, -R - 0.05, -0.01);
    holder.add(back, rim, glass, visor, tab, plate); holder.updateMatrixWorld(true);
    addProp('curveMirror', holder.children.map(m => ({ geometry: m.geometry, material: m.material, matrix: m.matrixWorld, castShadow: true })));
  }
  addCircle(x, z, 0.12);
}

// road sign on a post: kind 'stop' (inverted red triangle 止まれ), 'speed30', 'crossing'
const signTex = {};
function roadSignTex(kind) {
  if (signTex[kind]) return signTex[kind];
  signTex[kind] = canvasTex(256, 256, (g, W, H) => {
    g.clearRect(0, 0, W, H);
    if (kind === 'stop') {
      g.fillStyle = '#fff'; g.beginPath(); g.moveTo(8, 18); g.lineTo(W - 8, 18); g.lineTo(W / 2, H - 8); g.closePath(); g.fill();
      g.fillStyle = '#c8102e'; g.beginPath(); g.moveTo(20, 26); g.lineTo(W - 20, 26); g.lineTo(W / 2, H - 22); g.closePath(); g.fill();
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.font = `bold 58px ${JP_FONT}`; g.fillText('止まれ', W / 2, 100);
      g.font = 'bold 30px Arial'; g.fillText('STOP', W / 2, 142);
    } else if (kind === 'speed30') {
      g.fillStyle = '#fff'; g.beginPath(); g.arc(W / 2, H / 2, 122, 0, 7); g.fill();
      g.strokeStyle = '#c8102e'; g.lineWidth = 26; g.beginPath(); g.arc(W / 2, H / 2, 108, 0, 7); g.stroke();
      g.fillStyle = '#1f4fa3'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = 'bold 120px Arial'; g.fillText('30', W / 2, H / 2 + 6);
    } else if (kind === 'crossing') {
      g.fillStyle = '#ffcc00'; g.beginPath(); g.moveTo(W / 2, 6); g.lineTo(W - 6, H / 2); g.lineTo(W / 2, H - 6); g.lineTo(6, H / 2); g.closePath(); g.fill();
      g.strokeStyle = '#111'; g.lineWidth = 8; g.stroke();
      g.fillStyle = '#111'; g.fillRect(70, 150, 116, 14); g.fillRect(84, 95, 12, 60); g.fillRect(160, 95, 12, 60); g.fillRect(90, 88, 76, 20);
    }
  });
  return signTex[kind];
}
const signMats = {}, signPlate = new THREE.PlaneGeometry(0.75, 0.75);
function roadSign_build(B, x, y, z, r, kind) {
  B.frame(x, y, z, r);
  const ph = kind === 'stop' ? 2.1 : 2.6, sy = kind === 'stop' ? 1.85 : 2.3;
  B.cyl('alu', 0, -0.15, 0, 0.032, 0.03, ph + 0.15, 12, { color: [0.82, 0.84, 0.86] });
  B.cyl('plastic', 0, ph, 0, 0.036, 0.02, 0.04, 12, { color: [0.3, 0.3, 0.32], cap: true });
  if (!signMats[kind]) signMats[kind] = new THREE.MeshStandardMaterial({ map: roadSignTex(kind), alphaTest: 0.5, roughness: 0.4 });
  const p = B.P([0, sy, 0.045]);
  addProp('roadSign:' + kind, [{ geometry: signPlate, material: signMats[kind], matrix: propMatrix(p[0], p[1], p[2], r) }]); addCircle(x, z, 0.06); // (thin plates cast no shadow)
  // the plate's grey back (in the sign's outline) and two clamp bands round the post
  const outline = kind === 'stop' ? [[-0.36, 0.3], [0.36, 0.3], [0, -0.35]] : kind === 'crossing' ? [[0, 0.36], [0.36, 0], [0, -0.36], [-0.36, 0]]
    : Array.from({ length: 20 }, (_, i) => [Math.cos(i / 20 * Math.PI * 2) * 0.35, Math.sin(i / 20 * Math.PI * 2) * 0.35]);
  const c = outline.reduce((a, q) => [a[0] + q[0] / outline.length, a[1] + q[1] / outline.length], [0, 0]);
  for (let i = 0; i < outline.length; i++) { const a = outline[i], b = outline[(i + 1) % outline.length];
    B.poly('alu', [[c[0], sy + c[1], 0.042], [a[0], sy + a[1], 0.042], [b[0], sy + b[1], 0.042]], [0, 0, -1], { color: [0.62, 0.64, 0.66] }); }
  // clamp bands: a ring round the post and a flat strap to the back of the plate — all behind the face (the old
  // clamp blocks were deeper than the gap and poked through the front of the sign as two dark blocks)
  B.detail(1, () => { for (const dy of [-0.18, 0.18]) { B.cyl('alu', 0, sy + dy - 0.025, 0, 0.04, 0.04, 0.05, 12, { color: [0.66, 0.68, 0.7], cap: true });
    B.box('alu', 0, sy + dy - 0.02, 0.037, 0.12, 0.04, 0.008, { color: [0.66, 0.68, 0.7] }); } });
}

// ---------------------------------------------------------------- traffic signals (信号機)
// Galvanised mast with a cantilever arm; a horizontal LED head (green / yellow / red from the left, hooded) hangs over the
// approach lane, pedestrian heads (red standing figure over green walking figure) face across the crosswalks.
// Local frame: pole at the origin, arm along +x over the road, heads facing +z (toward the traffic they control).
// Returns lamp placements; town.js owns the lamp meshes and their shared per-phase materials.
function pedPictogram(walk) {
  return canvasTex(64, 64, (g, W, H) => {
    g.fillStyle = '#101010'; g.fillRect(0, 0, W, H); g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineCap = 'round';
    g.beginPath(); g.arc(W / 2, 12, 6, 0, Math.PI * 2); g.fill();
    g.lineWidth = 8; g.beginPath(); g.moveTo(W / 2, 22); g.lineTo(W / 2, 40); g.stroke();
    g.lineWidth = 6; g.beginPath();
    if (walk) { g.moveTo(W / 2, 40); g.lineTo(W / 2 - 10, 58); g.moveTo(W / 2, 40); g.lineTo(W / 2 + 11, 56); g.moveTo(W / 2, 26); g.lineTo(W / 2 - 11, 36); g.moveTo(W / 2, 26); g.lineTo(W / 2 + 10, 35); }
    else { g.moveTo(W / 2 - 3, 40); g.lineTo(W / 2 - 4, 58); g.moveTo(W / 2 + 3, 40); g.lineTo(W / 2 + 4, 58); g.moveTo(W / 2, 25); g.lineTo(W / 2 - 8, 40); g.moveTo(W / 2, 25); g.lineTo(W / 2 + 8, 40); }
    g.stroke();
  });
}
let sigTex = null;
export function signalLampMaterial(kind) { // kind: 'g' | 'y' | 'r' | 'walk' | 'stop'
  if (!sigTex) sigTex = { walk: pedPictogram(true), stop: pedPictogram(false) };
  const col = { g: 0x19e0b0, y: 0xffb21a, r: 0xff2a18, walk: 0x1fe6b4, stop: 0xff3020 }[kind];
  const ped = kind === 'walk' || kind === 'stop';
  const m = new THREE.MeshStandardMaterial({ color: 0x1b1d1f, roughness: 0.25, emissive: col, emissiveIntensity: 0, emissiveMap: ped ? sigTex[kind] : null });
  m.userData.on = ped ? 2.2 : 3.2;
  return m;
}
function signalMast_build(B, x, y, z, r, { arm = 4, peds = [] } = {}) {
  B.frame(x, y, z, r);
  const G = [0.74, 0.76, 0.78], HOUSE = [0.8, 0.81, 0.8];
  B.cyl('concrete', 0, -0.08, 0, 0.24, 0.22, 0.16, 16, { color: [0.7, 0.7, 0.68] });            // footing collar
  B.cyl('steel', 0, 0, 0, 0.115, 0.09, 6.3, 16, { color: G });                                  // tapered mast
  B.cyl('steel', 0, 6.3, 0, 0.1, 0.02, 0.12, 12, { color: G, cap: true });                    // cap
  B.beam('steel', [0, 5.82, 0], [arm, 5.82, 0], 0.095, 0.095, { color: G });                   // cantilever arm
  B.beam('steel', [0.05, 5.05, 0], [1.5, 5.78, 0], 0.05, 0.05, { color: G });                  // brace
  B.detail(1, () => { B.box('steel', 0, 5.72, 0, 0.3, 0.2, 0.3, { color: G }); B.box('plastic', 0, 2.9, 0.12, 0.22, 0.45, 0.16, { color: [0.88, 0.88, 0.84] }); }); // arm clamp, control box
  const hx = arm - 0.75, hy = 5.24, out = { veh: [], ped: [] };
  B.box('steel', hx, 5.66, 0, 0.05, 0.16, 0.05, { color: G }); B.box('steel', hx - 0.45, 5.66, 0, 0.05, 0.16, 0.05, { color: G });
  B.bbox('plastic', hx - 0.2, hy, 0, 1.28, 0.42, 0.2, 0.04, { color: HOUSE });                 // flat LED head
  ['g', 'y', 'r'].forEach((k, i) => {
    const lx = hx - 0.2 - 0.4 + i * 0.4;
    B.detail(1, () => { B.box('plastic', lx, hy + 0.37, 0.17, 0.34, 0.02, 0.16, { color: [0.2, 0.21, 0.22] }); }); // visor
    const p = B.P([lx, hy + 0.21, 0.102]); out.veh.push({ p, r, k });
  });
  for (const { a, group } of peds) {
    const c = Math.cos(a), s = Math.sin(a), off = [0.2 * s, 0, 0.2 * c], base = B.P(off), F = B.F;
    B.frame(base[0], base[1], base[2], F.r + a);
    B.box('steel', 0, 2.5, -0.13, 0.08, 0.06, 0.1, { color: G }); B.box('steel', 0, 3.15, -0.13, 0.08, 0.06, 0.1, { color: G });
    B.bbox('plastic', 0, 2.36, 0, 0.36, 0.9, 0.18, 0.03, { color: HOUSE });
    B.detail(1, () => { for (const yy of [2.83, 2.38]) B.box('plastic', 0, yy + 0.38, 0.14, 0.34, 0.02, 0.11, { color: [0.2, 0.21, 0.22] }); });
    out.ped.push({ p: B.P([0, 3.0, 0.092]), r: F.r + a, k: 'stop', group }, { p: B.P([0, 2.57, 0.092]), r: F.r + a, k: 'walk', group });
    B.frame(x, y, z, r);
  }
  addCircle(x, z, 0.2);
  return out;
}

// painted "止まれ" legend + stop line texture for road surfaces
export const stopTex = canvasTex(256, 512, (g, W, H) => {
  g.clearRect(0, 0, W, H); g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.save(); g.scale(1, 1.45); g.font = `bold 112px ${JP_FONT}`; // glyphs stretched lengthwise like real road paint
  ['止', 'ま', 'れ'].forEach((c, i) => g.fillText(c, W / 2, 58 + i * 116)); g.restore();
});
export const stopMat = new THREE.MeshStandardMaterial({ map: stopTex, alphaToCoverage: true, alphaTest: 0.4, roughness: 0.62, color: 0xe8e8e2 });
// 自転車歩行者道: the pictograms painted on a shared footway — a walker on the outer half, a bicycle (front wheel ahead)
// on the kerb-side half (the canvas' right, with the top of the canvas the direction of travel: traffic keeps left)
const cycleTex = canvasTex(256, 256, (g, W, H) => {
  g.clearRect(0, 0, W, H); g.lineCap = g.lineJoin = 'round';
  const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  // kerb side: a white bicycle on a blue panel
  g.fillStyle = '#2d5fa8'; rr(136, 34, 110, 188, 16); g.fill();
  g.strokeStyle = g.fillStyle = '#f4f4f0';
  g.save(); g.translate(191, 128); g.rotate(-Math.PI / 2); g.lineWidth = 7;
  for (const hx of [-36, 36]) { g.beginPath(); g.arc(hx, 16, 23, 0, Math.PI * 2); g.stroke(); }
  g.lineWidth = 8; g.beginPath(); g.moveTo(-36, 16); g.lineTo(0, 16); g.lineTo(-8, -22); g.lineTo(-36, 16); g.moveTo(0, 16); g.lineTo(27, -18); g.lineTo(-8, -22);
  g.moveTo(27, -18); g.lineTo(36, 16); g.moveTo(27, -18); g.lineTo(23, -31); g.lineTo(34, -33); g.moveTo(-18, -27); g.lineTo(0, -27); g.stroke(); g.restore();
  // outer side: a walker in dark grey paint
  g.strokeStyle = g.fillStyle = '#4a4d52'; g.lineWidth = 10; g.beginPath(); g.arc(66, 66, 14, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.moveTo(66, 88); g.lineTo(66, 144); g.moveTo(66, 100); g.lineTo(46, 128); g.moveTo(66, 100); g.lineTo(86, 128);
  g.moveTo(66, 144); g.lineTo(51, 192); g.moveTo(66, 144); g.lineTo(81, 192); g.stroke();
});
export const cycleMat = new THREE.MeshStandardMaterial({ map: cycleTex, alphaToCoverage: true, alphaTest: 0.4, roughness: 0.62 });

// ---------------------------------------------------------------- buildings
// anime palettes: clean pastel walls and saturated roofs (Shinkai / Ghibli town streets)
export const WALL_TINTS = [[1, 0.97, 0.9], [0.98, 0.98, 0.96], [0.9, 0.95, 1], [0.92, 1, 0.93], [1, 0.9, 0.84], [1, 0.97, 0.8], [1, 0.9, 0.9], [0.9, 0.88, 0.86], [0.86, 0.92, 0.98]];

export { lampPoints }; // world positions of light fixtures (citylights.js); kept in core.js so world objects can own them
// red paper lantern (chochin): lamp material, so it glows warm red at night
export function chochin(B, x, y, z, col = [1, 0.3, 0.2], s = 1) {
  B.cyl('dark', x, y + 0.5 * s, z, 0.1 * s, 0.1 * s, 0.05 * s, 8, { cap: true });
  B.cyl('lamp', x, y + 0.36 * s, z, 0.19 * s, 0.11 * s, 0.14 * s, 10, { color: col, cap: true });
  B.cyl('lamp', x, y + 0.12 * s, z, 0.19 * s, 0.19 * s, 0.24 * s, 10, { color: col });
  B.cyl('lamp', x, y, z, 0.11 * s, 0.19 * s, 0.12 * s, 10, { color: col });
  B.cyl('dark', x, y - 0.04 * s, z, 0.1 * s, 0.1 * s, 0.05 * s, 8);
  // the bottom ring's wooden base, seen from below (the lantern is a closed body, not an open shell)
  for (let i = 0; i < 8; i++) { const a0 = i / 8 * Math.PI * 2, a1 = (i + 1) / 8 * Math.PI * 2, r = 0.1 * s;
    B.poly('dark', [[x, y - 0.04 * s, z], [x + Math.cos(a0) * r, y - 0.04 * s, z + Math.sin(a0) * r], [x + Math.cos(a1) * r, y - 0.04 * s, z + Math.sin(a1) * r]], [0, -1, 0]); }
}
// ---------------------------------------------------------------- bicycles (mamachari with front basket), instanced
const bikeGeo = [];
// city bicycle (ママチャリ): 26-inch wheels with spoked rims, tyres and chrome mudguards, a low step-through frame
// (curved down tube, seat tube, twin chain- and seat-stays), fork and head tube, swept-back handlebar with grips and a
// bell, sprung saddle on its post, a full chain case, a black wire basket at the front, a rear carrier, a dynamo lamp,
// a ring lock and the stand. Two meshes: the painted frame (tinted per bike) and everything else (fixed colours).
// lo = 1: the far version — the same parts with about half the segments (spokes and basket wires as three-sided rods)
function bicycleGeometry(lo = 0) {
  if (bikeGeo[lo]) return bikeGeo[lo];
  const sg = (n, m = 3) => lo ? Math.max(m, Math.round(n / 2)) : n;
  const paint = [], rest = [], V = (x, y, z) => new THREE.Vector3(x, y, z);
  const col = (g, c) => { g = g.index ? g.toNonIndexed() : g; const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set(c, i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); g.deleteAttribute('uv'); return g; };
  const tubeC = (pts, r, seg = 12) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => V(...p))), sg(seg), r, sg(6, 4), false);
  const rod = (a, b, r) => { const d = V(b[0] - a[0], b[1] - a[1], b[2] - a[2]), L = d.length(), g = new THREE.CylinderGeometry(r, r, L, sg(6), 1); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize())); g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2); return g; };
  const TYRE = [0.06, 0.06, 0.065], RIM = [0.78, 0.8, 0.82], STEEL = [0.62, 0.64, 0.66], BLACK = [0.08, 0.08, 0.09], SAD = [0.12, 0.1, 0.09];
  const R = 0.33, AX = [[-0.53, 0.33], [0.53, 0.33]];
  for (const [ax, ay] of AX) {
    rest.push(col(new THREE.TorusGeometry(R, 0.021, sg(8), sg(36)).translate(ax, ay, 0), TYRE));
    rest.push(col(new THREE.TorusGeometry(R - 0.025, 0.007, sg(4), sg(36)).translate(ax, ay, 0), RIM));
    rest.push(col(new THREE.CylinderGeometry(0.022, 0.022, 0.1, sg(10)).rotateX(Math.PI / 2).translate(ax, ay, 0), STEEL));
    for (let k = 0; k < 18; k++) { const a = k / 18 * Math.PI * 2, e = k % 2 ? 1 : -1; rest.push(col(rod([ax, ay, e * 0.03], [ax + Math.cos(a) * (R - 0.03), ay + Math.sin(a) * (R - 0.03), e * 0.004], 0.0022), RIM)); }
    // mudguard: an arc over the top of the wheel
    const arc = []; for (let k = 0; k <= 10; k++) { const a = (ax < 0 ? 0.25 : -0.05) * Math.PI + k / 10 * 0.9 * Math.PI; arc.push([ax + Math.cos(a) * (R + 0.04), ay + Math.sin(a) * (R + 0.04), 0]); }
    rest.push(col(tubeC(arc, 0.028, 14).scale(1, 1, 1.4), RIM));
  }
  // frame (painted): low step-through down tube, seat tube, stays, head tube, fork crown
  paint.push(tubeC([[0.36, 0.86, 0], [0.3, 0.64, 0], [0.16, 0.4, 0], [0.0, 0.31, 0], [-0.06, 0.3, 0]], 0.021, 16));
  paint.push(tubeC([[-0.06, 0.3, 0], [-0.13, 0.55, 0], [-0.19, 0.8, 0]], 0.019, 6));
  paint.push(tubeC([[0.36, 0.86, 0], [0.22, 0.72, 0], [-0.1, 0.46, 0]], 0.016, 8));                           // upper tube (mixte)
  for (const e of [-1, 1]) { paint.push(col(rod([-0.06, 0.3, e * 0.035], [-0.53, 0.33, e * 0.055], 0.011), [1, 1, 1])); paint.push(col(rod([-0.17, 0.72, e * 0.02], [-0.53, 0.33, e * 0.055], 0.01), [1, 1, 1])); }
  paint.push(rod([0.35, 0.8, 0], [0.4, 0.97, 0], 0.026));                                                       // head tube
  for (const e of [-1, 1]) paint.push(tubeC([[0.36, 0.8, e * 0.04], [0.44, 0.58, e * 0.05], [0.53, 0.33, e * 0.055]], 0.012, 6)); // fork
  // chain case (full cover) on the drive side, crank and pedals
  rest.push(col(new THREE.CapsuleGeometry(0.075, 0.42, sg(4, 2), sg(10)).rotateZ(Math.PI / 2 + 0.06).scale(1, 1, 0.25).translate(-0.3, 0.32, 0.07), [0.2, 0.2, 0.21]));
  for (const e of [-1, 1]) { const px = -0.06 + e * 0.14, py = 0.3 - e * 0.05; rest.push(col(rod([-0.06, 0.3, e * 0.07], [px, py, e * 0.09], 0.01), STEEL)); rest.push(col(new THREE.BoxGeometry(0.09, 0.02, 0.08).translate(px, py, e * 0.13), BLACK)); }
  // steering: stem, swept-back bar, grips, bell, brake levers
  rest.push(col(rod([0.4, 0.97, 0], [0.38, 1.06, 0], 0.016), STEEL));
  rest.push(col(tubeC([[0.22, 1.02, -0.3], [0.33, 1.06, -0.18], [0.38, 1.06, 0], [0.33, 1.06, 0.18], [0.22, 1.02, 0.3]], 0.011, 12), STEEL));
  for (const e of [-1, 1]) { rest.push(col(rod([0.25, 1.03, e * 0.26], [0.19, 1.01, e * 0.33], 0.017), BLACK)); rest.push(col(rod([0.3, 1.05, e * 0.2], [0.22, 1.0, e * 0.27], 0.006), STEEL)); }
  rest.push(col(new THREE.SphereGeometry(0.026, sg(8), sg(5), 0, Math.PI * 2, 0, Math.PI / 2).translate(0.33, 1.07, -0.14), RIM));
  // saddle on a sprung seat post
  rest.push(col(rod([-0.19, 0.8, 0], [-0.22, 0.9, 0], 0.012), STEEL));
  rest.push(col(new THREE.SphereGeometry(0.1, sg(12), sg(8)).scale(1.35, 0.35, 0.95).translate(-0.24, 0.95, 0), SAD));
  for (const e of [-1, 1]) rest.push(col(new THREE.TorusGeometry(0.018, 0.005, sg(4), sg(8)).rotateY(Math.PI / 2).translate(-0.33, 0.92, e * 0.05), STEEL));
  // front basket (wire, black): frame rings and uprights on a bracket over the front wheel
  { const bx0 = 0.5, bx1 = 0.86, by0 = 0.78, by1 = 1.02, bz = 0.17, B2 = [0.1, 0.1, 0.11];
    for (const y of [by0, by0 + 0.12, by1]) { const ring = [[bx0, y, -bz], [bx1, y, -bz], [bx1, y, bz], [bx0, y, bz], [bx0, y, -bz]]; for (let k = 0; k < 4; k++) rest.push(col(rod(ring[k], ring[k + 1], y === by1 ? 0.006 : 0.004), B2)); }
    for (let k = 0; k <= 5; k++) { const x = lerp(bx0, bx1, k / 5); for (const e of [-1, 1]) rest.push(col(rod([x, by0, e * bz], [x, by1, e * bz], 0.0035), B2)); }
    for (let k = 0; k <= 4; k++) { const z = lerp(-bz, bz, k / 4); for (const x of [bx0, bx1]) rest.push(col(rod([x, by0, z], [x, by1, z], 0.0035), B2)); rest.push(col(rod([bx0, by0, z], [bx1, by0, z], 0.0035), B2)); }
    rest.push(col(rod([0.42, 0.9, 0], [bx0, by0 + 0.06, 0], 0.01), STEEL)); rest.push(col(rod([0.53, 0.33, 0.06], [0.6, by0, 0.1], 0.006), STEEL)); rest.push(col(rod([0.53, 0.33, -0.06], [0.6, by0, -0.1], 0.006), STEEL)); }
  // rear carrier: rails, cross bars, struts down to the axle
  for (const e of [-1, 1]) { rest.push(col(rod([-0.2, 0.74, e * 0.09], [-0.78, 0.74, e * 0.09], 0.008), STEEL)); rest.push(col(rod([-0.7, 0.74, e * 0.09], [-0.53, 0.35, e * 0.06], 0.007), STEEL)); }
  for (const x of [-0.3, -0.45, -0.6, -0.75]) rest.push(col(rod([x, 0.74, -0.09], [x, 0.74, 0.09], 0.006), STEEL));
  // dynamo lamp on the fork, ring lock on the stays, a kickstand
  rest.push(col(new THREE.CylinderGeometry(0.03, 0.035, 0.07, sg(10)).rotateZ(Math.PI / 2).translate(0.5, 0.62, 0.07), [0.85, 0.85, 0.82]));
  rest.push(col(new THREE.TorusGeometry(0.06, 0.012, sg(4), sg(12), Math.PI * 1.3).rotateY(Math.PI / 2).translate(-0.4, 0.45, 0), [0.15, 0.15, 0.16]));
  rest.push(col(rod([-0.45, 0.33, 0.06], [-0.5, 0.02, 0.2], 0.01), STEEL));
  const merge = parts => { const pos = [], nor = [], c = []; for (let g of parts) { g = g.index ? g.toNonIndexed() : g; pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array); if (g.attributes.color) c.push(...g.attributes.color.array); else for (let i = 0; i < g.attributes.position.count; i++) c.push(1, 1, 1); }
    const G = new THREE.BufferGeometry(); G.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); G.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); G.setAttribute('color', new THREE.Float32BufferAttribute(c, 3)); G.computeBoundingSphere(); return G; };
  bikeGeo[lo] = { paint: merge(paint), rest: merge(rest) };
  return bikeGeo[lo];
}
// parked bicycles: cell-culled instanced sets (Scatter) — full detail within ~50 m, the lighter version beyond; each
// bike stays one item (its index in the list) with its own transform and paint colour
export function bicycles(list, rng) { // list: [{x,y,z,r}]
  const cols = [[0.88, 0.88, 0.86], [0.1, 0.1, 0.1], [0.62, 0.12, 0.12], [0.2, 0.32, 0.58], [0.72, 0.72, 0.74], [0.95, 0.9, 0.78], [0.25, 0.42, 0.32], [0.86, 0.62, 0.7], [0.4, 0.62, 0.72]];
  const paintM = new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.35 }), restM = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.55 });
  paintM.name = 'bicycle_paint'; restM.name = 'bicycle_metal';
  const items = list.map(b => ({ x: b.x, y: b.y, z: b.z, s: 1, r: b.r, tilt2: (rng() - 0.5) * 0.08 + 0.06, c: new THREE.Color(...cols[Math.floor(rng() * cols.length)]) }));
  const parts = lo => { const G = bicycleGeometry(lo); return [{ geometry: G.paint, material: paintM, tint: true, castShadow: true }, { geometry: G.rest, material: restM, castShadow: true }]; };
  withScatterMeta({ prefab: 'bicycle', category: 'vehicle' }, () => new Scatter(items, [{ dist: () => 30 * (Q.lodScale || 1), parts: parts(0) }, { dist: () => Infinity, parts: parts(1) }], 128));
  return items;
}
// A clock as a whole object: a round painted-metal case, a bezel round each dial, and one dial (on a wall) or two
// (hanging or on a post, back to back), the dials softly lit at night. Centred on its own origin, dial(s) along +z (and
// -z). The dial: a cream face, minute and hour marks, numerals at the quarters, dark hands at ten past ten.
const clockDial = canvasTex(512, 512, (g, W, H) => {
  const c = W / 2; g.fillStyle = '#fbf8ee'; g.beginPath(); g.arc(c, c, c - 2, 0, 7); g.fill();
  const rg = g.createRadialGradient(c, c, c * 0.55, c, c, c); rg.addColorStop(0, 'rgba(0,0,0,0)'); rg.addColorStop(1, 'rgba(120,110,90,0.18)'); g.fillStyle = rg; g.fill();
  g.fillStyle = '#2a2b2e';
  for (let i = 0; i < 60; i++) { const a = i / 60 * Math.PI * 2, l = i % 5 ? 14 : 38, w = i % 5 ? 4 : 13; g.save(); g.translate(c, c); g.rotate(a); g.fillRect(-w / 2, -c + 22, w, l); g.restore(); }
  g.font = `bold ${W * 0.12}px Arial`; g.textAlign = 'center'; g.textBaseline = 'middle';
  [['12', 0], ['3', 1], ['6', 2], ['9', 3]].forEach(([t, k]) => { const a = k * Math.PI / 2; g.fillText(t, c + Math.sin(a) * c * 0.63, c - Math.cos(a) * c * 0.63 + 4); });
  const hand = (a, len, w) => { g.save(); g.translate(c, c); g.rotate(a); g.beginPath(); g.moveTo(-w / 2, len * 0.18); g.lineTo(-w * 0.35, -len); g.lineTo(w * 0.35, -len); g.lineTo(w / 2, len * 0.18); g.closePath(); g.fill(); g.restore(); };
  hand((10 + 10 / 60) / 12 * Math.PI * 2, c * 0.5, 22); hand(10 / 60 * Math.PI * 2, c * 0.76, 14);
  g.fillStyle = '#c0392b'; g.save(); g.translate(c, c); g.rotate(0.6); g.fillRect(-2.5, -c * 0.8, 5, c * 0.98); g.restore();
  g.fillStyle = '#2a2b2e'; g.beginPath(); g.arc(c, c, 14, 0, 7); g.fill();
});
let clockFaceMat = null;
const clockMats = {};
export function clockHead(r, { faces = 2, depth = r * 0.34, color = 0x2f3a36, rim = 0x8a8f8c } = {}) {
  if (!clockFaceMat) { clockFaceMat = new THREE.MeshStandardMaterial({ map: clockDial, roughness: 0.35, emissive: 0xffffff, emissiveMap: clockDial, emissiveIntensity: 0 }); clockFaceMat.userData.glow = 0.35; glowMats.push(clockFaceMat); }
  const key = color + '|' + rim;
  const M = clockMats[key] || (clockMats[key] = { body: new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.35 }), rim: new THREE.MeshStandardMaterial({ color: rim, roughness: 0.32, metalness: 0.7 }) });
  const grp = new THREE.Group(), hd = depth / 2;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.06, r * 1.06, depth, 48).rotateX(Math.PI / 2), M.body); body.castShadow = true; grp.add(body);
  for (const s of faces === 2 ? [1, -1] : [1]) {
    const bz = new THREE.Mesh(new THREE.TorusGeometry(r * 1.04, r * 0.06, 10, 48), M.rim); bz.position.z = s * hd; grp.add(bz);
    const d = new THREE.Mesh(new THREE.CircleGeometry(r * 0.99, 48), clockFaceMat); d.position.z = s * (hd + 0.003); if (s < 0) d.rotation.y = Math.PI; grp.add(d);
  }
  return grp;
}
// a post clock (時計塔 of a station square or a park): a tapered post on a base, a bracket collar and a double-faced
// round clock on top, a small finial
function clockPole_build(B, x, y, z, r = 0) {
  B.frame(x, y, z, r);
  B.cyl('concrete', 0, -0.1, 0, 0.26, 0.24, 0.32, 16, { color: [0.72, 0.71, 0.68], cap: true });
  B.cyl('metal', 0, 0.2, 0, 0.085, 0.065, 3.35, 12, { color: [0.18, 0.24, 0.22] });
  B.cyl('metal', 0, 0.2, 0, 0.11, 0.1, 0.24, 12, { color: [0.18, 0.24, 0.22], cap: true });
  B.cyl('metal', 0, 3.5, 0, 0.09, 0.12, 0.14, 12, { color: [0.18, 0.24, 0.22], cap: true });
  B.cyl('metal', 0, 4.54, 0, 0.04, 0.01, 0.16, 8, { color: [0.18, 0.24, 0.22], cap: true });
  const h = clockHead(0.42, { faces: 2, color: 0x2b3532 }); h.position.set(...B.P([0, 4.04, 0])); h.rotation.y = r; scene.add(h);
  addCircle(x, z, 0.14);
}

// A storage shed in the current frame, standing on local y = 0 with its doors facing local +z. Returns its collision half
// extents { hx, hz } (local x, z).
//   style 'steel': the Japanese steel 物置 — a concrete pad, painted box-profile walls with pale corner trims, two
//     sliding doors on top and bottom tracks with recessed pulls, a mono-pitch roof falling to the back with fascias, a
//     gutter and downspout, a louvred vent in one side.
//   style 'wood': a timber garden shed — on block piers, board-and-batten walls, a ledged-and-braced plank door with
//     strap hinges in the front gable, a four-pane side window, a gable roof with barge boards and a ridge board.
export function storageShed(B, { w = 2.2, d = 1.4, h = 2.0, style = 'steel', wall = [0.55, 0.62, 0.52], trim = [0.86, 0.85, 0.8], roof = [0.42, 0.44, 0.46], door = null, pad = true, window = true } = {}) {
  const sh = (c, k) => [c[0] * k, c[1] * k, c[2] * k], D = [0.14, 0.14, 0.15];
  if (style === 'steel') {
    const F = pad ? 0.08 : 0.02, hF = h, hB = h - 0.18, dc = door || sh(wall, 1.1);
    if (pad) B.bbox('concrete', 0, -0.25, 0, w + 0.3, 0.33, d + 0.3, 0.02, { color: [0.72, 0.71, 0.68], skip: 'ny' });
    else for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.box('block', sx * (w / 2 - 0.1), -0.1, sz * (d / 2 - 0.1), 0.19, 0.12, 0.39, { color: [0.7, 0.7, 0.68] });
    B.box('metalWall', 0, F, -d / 2 + 0.02, w, hB, 0.04, { color: wall, uv: 1.2 });
    for (const s of [-1, 1]) {
      B.box('metalWall', s * (w / 2 - 0.02), F, 0, 0.04, hB, d, { color: wall, uv: 1.2 });
      B.poly('metalWall', [[s * w / 2, F + hB, d / 2], [s * w / 2, F + hB, -d / 2], [s * w / 2, F + hF, d / 2]], [s, 0, 0], { color: wall, uv: 1.2 });
      B.box('metalWall', s * (w / 2 - 0.07), F, d / 2 - 0.02, 0.14, hF - 0.2, 0.04, { color: wall, uv: 1.2 });             // door jambs
    }
    B.box('metalWall', 0, F + hF - 0.22, d / 2 - 0.02, w, 0.22, 0.04, { color: wall, uv: 1.2 });                          // header
    const ow = w - 0.28, lw = ow / 2 + 0.05, dh = hF - 0.32;
    for (const [s, dz] of [[-1, 0.02], [1, 0.05]]) {                                                                      // two leaves, staggered tracks
      B.box('metalWall', s * (ow / 2 - lw / 2), F + 0.05, d / 2 + dz, lw, dh, 0.022, { color: dc, uv: 1.2 });
      B.box('dark', s * 0.1, F + dh * 0.48, d / 2 + dz + 0.012, 0.035, 0.17, 0.008, { color: D });                        // recessed pull
    }
    B.box('metal', 0, F + hF - 0.27, d / 2 + 0.04, w - 0.08, 0.05, 0.07, { color: trim });                                 // top track
    B.box('metal', 0, F, d / 2 + 0.035, w - 0.08, 0.04, 0.07, { color: trim });                                           // sill
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.box('metal', sx * w / 2, F, sz * d / 2, 0.05, sz > 0 ? hF : hB, 0.05, { color: trim });
    // roof: one sheet with a slight overhang all round, fascias on three sides, the gutter on the low (back) edge
    const o = 0.1, oF = 0.16, oB = 0.14, k = (hF - hB) / d, yF = F + hF + 0.03 + k * oF, yB = F + hB + 0.03 - k * oB;
    const R = [[-w / 2 - o, yF, d / 2 + oF], [w / 2 + o, yF, d / 2 + oF], [w / 2 + o, yB, -d / 2 - oB], [-w / 2 - o, yB, -d / 2 - oB]];
    B.poly('roofMetal', R.map(p => [p[0], p[1] + 0.035, p[2]]), [0, 1, 0], { color: roof, uv: 0.8 });
    B.poly('metal', R, [0, -1, 0], { color: sh(roof, 0.8) });
    B.box('metal', 0, yF - 0.05, d / 2 + oF, w + 2 * o + 0.02, 0.11, 0.025, { color: trim });
    for (const s of [-1, 1]) B.beam('metal', [s * (w / 2 + o), yF + 0.005, d / 2 + oF], [s * (w / 2 + o), yB + 0.005, -d / 2 - oB], 0.025, 0.1, { color: trim });
    B.beam('metal', [-w / 2 - o, yB - 0.03, -d / 2 - oB - 0.04], [w / 2 + o, yB - 0.03, -d / 2 - oB - 0.04], 0.08, 0.07, { color: trim });
    B.cyl('metal', w / 2 + o - 0.07, F, -d / 2 - oB - 0.04, 0.028, 0.028, yB - 0.06 - F, 8, { color: trim });
    B.box('dark', w / 2 + 0.006, F + hB - 0.5, -d * 0.18, 0.01, 0.22, 0.34, { color: D });                                // vent
    for (let i = 0; i < 4; i++) B.box('metal', w / 2 + 0.02, F + hB - 0.48 + i * 0.05, -d * 0.18, 0.025, 0.012, 0.34, { color: wall });
    return { hx: w / 2 + 0.05, hz: d / 2 + 0.06 };
  }
  // ---- timber garden shed
  const F = 0.2, hE = h - 0.5, hR = h, dc = door || sh(wall, 0.85), BT = sh(wall, 0.9);
  for (const sx of [-1, 1]) for (const sz of [-1, 0, 1]) B.box('block', sx * (w / 2 - 0.12), -0.12, sz * (d / 2 - 0.15), 0.18, 0.26, 0.18, { color: [0.7, 0.7, 0.68] });
  B.box('wood', 0, 0.12, 0, w + 0.04, 0.08, d + 0.04, { color: sh(wall, 0.7), uv: 0.6 });                                 // floor frame
  B.box('wood', 0, F, -d / 2 + 0.02, w, hE, 0.04, { color: wall, uv: 0.6 });                                               // back
  for (const s of [-1, 1]) B.box('wood', s * (w / 2 - 0.02), F, 0, 0.04, hE, d - 0.08, { color: wall, uv: 0.6 });
  B.box('wood', -(w / 2 + 0.45) / 2 + 0.01, F, d / 2 - 0.02, w / 2 - 0.43, hE, 0.04, { color: wall, uv: 0.6 });            // front either side of the door
  B.box('wood', (w / 2 + 0.45) / 2 - 0.01, F, d / 2 - 0.02, w / 2 - 0.43, hE, 0.04, { color: wall, uv: 0.6 });
  B.box('wood', 0, F + 1.82, d / 2 - 0.02, 0.9, hE - 1.82, 0.04, { color: wall, uv: 0.6 });
  for (const sz of [-1, 1]) B.poly('wood', [[-w / 2, F + hE, sz * d / 2], [w / 2, F + hE, sz * d / 2], [0, F + hR, sz * d / 2]], [0, 0, sz], { color: wall, uv: 0.6 }); // gables
  // battens over the board joints, 30 cm apart, on the gables and the long sides
  for (let x = -w / 2 + 0.25; x < w / 2 - 0.15; x += 0.3) { if (Math.abs(x) < 0.5) continue; const top = F + hE + (hR - hE) * (1 - Math.abs(x) / (w / 2));
    for (const sz of [-1, 1]) B.box('wood', x, F, sz * (d / 2 + 0.005), 0.05, top - F - 0.04, 0.018, { color: BT, uv: 0.6 }); }
  for (let z = -d / 2 + 0.25; z < d / 2 - 0.15; z += 0.3) for (const s of [-1, 1]) B.box('wood', s * (w / 2 + 0.005), F, z, 0.018, hE - 0.02, 0.05, { color: BT, uv: 0.6 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.box('wood', sx * (w / 2 + 0.01), F - 0.02, sz * (d / 2 + 0.01), 0.07, hE + 0.02, 0.07, { color: trim, uv: 0.6 });
  // door: vertical planks, ledges and a brace, strap hinges, a thumb latch
  B.box('wood', 0, F + 0.02, d / 2 + 0.01, 0.82, 1.78, 0.035, { color: dc, uv: 0.5 });
  for (const yy of [0.22, 1.5]) B.box('wood', 0, F + yy, d / 2 + 0.035, 0.74, 0.1, 0.025, { color: sh(dc, 0.92), uv: 0.5 });
  B.beam('wood', [-0.32, F + 0.33, d / 2 + 0.04], [0.32, F + 1.48, d / 2 + 0.04], 0.09, 0.022, { color: sh(dc, 0.92) });
  for (const yy of [0.27, 1.55]) B.box('dark', 0.15 - 0.4 + 0.2, F + yy, d / 2 + 0.052, 0.4, 0.035, 0.008, { color: D });
  B.box('metal', 0.32, F + 1.0, d / 2 + 0.05, 0.03, 0.12, 0.03, { color: [0.3, 0.3, 0.3] });
  for (const s of [-1, 1]) B.box('wood', s * 0.45, F, d / 2 + 0.01, 0.07, 1.86, 0.05, { color: trim, uv: 0.6 });
  B.box('wood', 0, F + 1.82, d / 2 + 0.01, 0.97, 0.07, 0.05, { color: trim, uv: 0.6 });
  if (window) { // side window: frame, glazing bars, a sill
    const wx = w / 2 + 0.02; B.box('glass', wx, F + 0.95, 0, 0.012, 0.5, 0.6);
    for (const [yy, hh] of [[0.92, 0.04], [1.18, 0.025], [1.45, 0.04]]) B.box('wood', wx + 0.012, F + yy, 0, 0.03, hh, 0.66, { color: trim });
    for (const zz of [-0.32, 0, 0.32]) B.box('wood', wx + 0.012, F + 0.92, zz, 0.03, 0.57, zz ? 0.04 : 0.025, { color: trim });
    B.box('wood', wx + 0.03, F + 0.88, 0, 0.06, 0.04, 0.72, { color: trim });
  }
  // roof: two planes with a 20 cm overhang at the eaves and the gables, a board underneath, barge boards and a ridge
  const o = 0.2, oG = 0.18, k = (hR - hE) / (w / 2), yR = F + hR + 0.03, yE = F + hE + 0.03 - k * o;
  for (const s of [-1, 1]) {
    const P4 = [[0, yR, d / 2 + oG], [0, yR, -d / 2 - oG], [s * (w / 2 + o), yE, -d / 2 - oG], [s * (w / 2 + o), yE, d / 2 + oG]];
    B.poly('roofTile', P4.map(p => [p[0], p[1] + 0.05, p[2]]), [s * k, 1, 0], { color: roof, uv: 0.7 });
    B.poly('wood', P4, [0, -1, 0], { color: sh(wall, 0.75) });
    B.beam('wood', [s * (w / 2 + o), yE - 0.02, d / 2 + oG], [s * (w / 2 + o), yE - 0.02, -d / 2 - oG], 0.03, 0.1, { color: trim }); // fascia
    for (const sz of [-1, 1]) B.beam('wood', [0, yR + 0.03, sz * (d / 2 + oG + 0.01)], [s * (w / 2 + o), yE + 0.03, sz * (d / 2 + oG + 0.01)], 0.03, 0.14, { color: trim }); // barge boards
  }
  B.beam('wood', [0, yR + 0.07, -d / 2 - oG - 0.02], [0, yR + 0.07, d / 2 + oG + 0.02], 0.12, 0.05, { color: sh(roof, 0.85) });
  return { hx: w / 2 + 0.05, hz: d / 2 + 0.06 };
}

// ---------------------------------------------------------------- placed objects (world/capture.js: each call is one editable world object)
export const vendingMachine = placeable('vending_machine', vendingMachine_build, (x, y, z, r) => [x, y, z, r]);
export const utilityPole = placeable('utility_pole', utilityPole_build, atXYZR);
export const curveMirror = placeable('curve_mirror', curveMirror_build, atXYZR);
export const roadSign = placeable((B, x, y, z, r, kind) => 'road_sign_' + kind, roadSign_build, atXYZR);
export const signalMast = placeable('traffic_signal', signalMast_build, atXYZR);
export const clockPole = placeable('clock_pole', clockPole_build, (B, x, y, z, r = 0) => [x, y, z, r]);
