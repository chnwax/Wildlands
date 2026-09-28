// Town construction kit: batched geometry builder, PBR materials, canvas-drawn signage, buildings and street props.
import { THREE, scene, S, Q, clamp, lerp, mulberry32, phTex, NFLAT, addBox, addCircle, addPlatform } from './core.js';
import { env } from './sky.js';
import { relief, weather, asphaltAge, wornPaint, windowMaterial } from './surface.js';

// ---------------------------------------------------------------- batched builder
// Geometry is accumulated per (material, 96 m chunk) and flushed into a few hundred meshes.
const V3 = (a, b, c) => [a, b, c];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const WHITE = [1, 1, 1];

export class GeoBuilder {
  constructor(chunk = 96) { this.chunk = chunk; this.parts = new Map(); this.lod = 0; this.frame(0, 0, 0, 0); }
  // emit fn's geometry as detail of level n (1: fine parts, 2: micro details); those meshes are drawn only near the camera
  detail(n, fn) { const o = this.lod; this.lod = Math.max(o, n); try { return fn(); } finally { this.lod = o; } }
  frame(x, y, z, r = 0) { this.F = { x, y, z, c: Math.cos(r), s: Math.sin(r), r }; return this; }
  P(l) { const F = this.F; return [F.x + l[0] * F.c + l[2] * F.s, F.y + l[1], F.z - l[0] * F.s + l[2] * F.c]; }
  N(n) { const F = this.F; return [n[0] * F.c + n[2] * F.s, n[1], -n[0] * F.s + n[2] * F.c]; }
  bucket(mat, x, z) {
    const c = this.lod ? this.chunk / 2 : this.chunk, k = mat + '|' + this.lod + '|' + Math.floor(x / c) + ',' + Math.floor(z / c);
    let b = this.parts.get(k); if (!b) { b = { mat, lod: this.lod, pos: [], nor: [], uv: [], col: [], idx: [], extra: {} }; this.parts.set(k, b); }
    return b;
  }
  // optional extra per-vertex attributes (opt.attr = { name: [v0, v1, v2(, v3)] }, each a 2-vector); other vertices get 0
  _extra(B, n, attr) {
    const count = B.pos.length / 3 - n;           // vertices already in the bucket before this primitive
    for (const name in B.extra) if (!attr || !(name in attr)) for (let i = 0; i < n; i++) B.extra[name].push(0, 0);
    if (attr) for (const name in attr) {
      if (!B.extra[name]) B.extra[name] = new Array(count * 2).fill(0);
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
    for (const [i, p] of [a, b, c, d].entries()) { const w = this.P(p), nn = ns ? this.N(norm(ns[i])) : n; B.pos.push(w[0], w[1], w[2]); B.nor.push(nn[0], nn[1], nn[2]); B.uv.push(uvs[i][0], uvs[i][1]); B.col.push(col[0], col[1], col[2]); }
    this._extra(B, 4, opt.attr);
    B.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  tri(mat, a, b, c, opt = {}) {
    const n = this.N(norm(cross(sub(b, a), sub(c, a)))), s = opt.uv || 1;
    const wa = this.P(a), B = this.bucket(mat, wa[0], wa[2]), base = B.pos.length / 3, col = opt.color || WHITE;
    const ax = norm(sub(b, a)), ay = norm(cross(cross(ax, sub(c, a)), ax));
    const uvs = opt.uvs;
    for (const [i, p] of [a, b, c].entries()) { const w = this.P(p), d = sub(p, a); B.pos.push(w[0], w[1], w[2]); B.nor.push(n[0], n[1], n[2]);
      if (uvs) B.uv.push(uvs[i][0], uvs[i][1]); else B.uv.push((d[0] * ax[0] + d[1] * ax[1] + d[2] * ax[2]) / s, -(d[0] * ay[0] + d[1] * ay[1] + d[2] * ay[2]) / s);
      B.col.push(col[0], col[1], col[2]); }
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
    let p = pts, uvs = opt.uvs;
    if (n[0] * hint[0] + n[1] * hint[1] + n[2] * hint[2] < 0) { p = [...pts].reverse(); if (uvs) uvs = [...uvs].reverse(); }
    const o = uvs ? Object.assign({}, opt, { uvs }) : opt;
    if (p.length === 3) this.tri(mat, p[0], p[1], p[2], o); else this.quad(mat, p[0], p[1], p[2], p[3], o);
  }
  // box with chamfered edges (bevel b): edges and corners catch the light, so things stop reading as raw primitives
  bbox(mat, cx, y0, cz, w, h, d, b = 0.02, opt = {}) {
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
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
      for (const name in b.extra) g.setAttribute(name, new THREE.Float32BufferAttribute(b.extra[name], 2));
      g.setIndex(b.idx.length > 65535 ? new THREE.Uint32BufferAttribute(b.idx, 1) : new THREE.Uint16BufferAttribute(b.idx, 1));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, materials[b.mat]);
      if (!materials[b.mat]) console.warn('missing material', b.mat);
      m.castShadow = shadow[b.mat] !== false; m.receiveShadow = true; m.matrixAutoUpdate = false;
      if (b.lod) { m.userData.lodDist = LOD_DIST[b.lod]; lodMeshes.push(m); }
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
  for (const t of [col, nor]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; }
  const m = std({ map: col, normalMap: nor, roughness: 0.62 });
  m.userData.toonNorm = 0.7;
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
    pavement: pbrX('concrete_pavement', 0.008, { grime: 0.3, streaks: 0, moss: 0.35 }),
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
    lamp: nightGlow(std({ color: 0xf4f4f0, roughness: 0.4, emissive: 0xfff2dc, emissiveIntensity: 1 }), 6.0, 'lampGlow'),
    poly: new THREE.MeshStandardMaterial({ color: 0xcfe0e6, roughness: 0.2, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }),
  };
  M.asphaltMain = M.asphaltRoad = M.asphaltLane = M.asphaltLane2 = M.asphalt;
  M.gravelPath = pbrX('bicolour_gravel', 0.02, null, { color: 0xf2e6cf });
  M.stopLegend = stopMat;
  M.tactileL = tactileMat(false); M.tactileD = tactileMat(true);
  // painted brightness per surface (toon.js): light pastel walls, pale concrete and gravel, warm wood
  for (const [k, v] of Object.entries({ siding: 0.58, stucco: 0.6, plaster: 0.6, tiles: 0.56, concrete: 0.64, block: 0.6, pavement: 0.66, ballast: 0.5, wood: 0.46, stone: 0.56, roofTile: 0.62, gravelPath: 0.66 }))
    M[k].userData.toonNorm = v;
  for (const m of Object.values(M)) for (const t of [m.map, m.normalMap, m.roughnessMap, m.aoMap]) if (t) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return M;
}

// ---------------------------------------------------------------- canvas textures
export const JP_FONT = '"Yu Gothic UI", "Yu Gothic", "Meiryo", "MS Gothic", "Hiragino Sans", sans-serif';
export function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8;
  return t;
}
function fitText(g, text, x, y, maxW, size, font = JP_FONT, weight = 'bold') {
  let s = size; g.font = `${weight} ${s}px ${font}`;
  while (g.measureText(text).width > maxW && s > 8) { s -= 2; g.font = `${weight} ${s}px ${font}`; }
  g.fillText(text, x, y);
}
// a lit sign mesh (canvas texture), glowing at night
export function signMesh(w, h, draw, glow = 0.8, px = 256) {
  const t = canvasTex(Math.round(px * w / h), px, draw);
  const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.5, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0 });
  m.userData.glow = glow; glowMats.push(m);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
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
const vmGeo = new THREE.BoxGeometry(1.0, 1.83, 0.75);
export function vendingMachine(x, y, z, r, i, B = null) {
  const t = vendingTexture(i);
  const front = new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0, roughness: 0.35 });
  front.userData.glow = 0.55; glowMats.push(front);
  const side = new THREE.MeshStandardMaterial({ color: [0xc8102e, 0x0b4ea2, 0xf3f3ef, 0x1b1b1b, 0xe8e8e8][i % 5], roughness: 0.4, metalness: 0.3 });
  const m = new THREE.Mesh(vmGeo, [side, side, side, side, front, side]);
  m.position.set(x, y + 0.915 + 0.06, z); m.rotation.y = r; m.castShadow = true; m.receiveShadow = true;
  scene.add(m); addBox(x, z, 0.5, 0.38, r);
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
const POLE_ADS = ['桜川歯科 →', 'やまだ内科', '学習塾 明星', '中村鉄工所', 'さくら整骨院', '桜川不動産'];
const poleAdTex = {};
export function utilityPole(B, x, y, z, r, rng, { transformer = false, light = false, side = 1 } = {}) {
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
    const m = signMesh(0.36, 1.25, (g, W, H) => { g.fillStyle = txt.includes('歯科') || txt.includes('内科') ? '#1f6e4a' : txt.includes('塾') ? '#b8322a' : '#23448c'; g.fillRect(0, 0, W, H); g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      const chars = [...txt.replace(' →', '')]; g.font = `bold ${Math.min(W * 0.72, H / (chars.length + 1))}px ${JP_FONT}`; chars.forEach((c, i) => g.fillText(c, W / 2, H * (i + 0.8) / (chars.length + 0.6))); }, 0.1, 128);
    m.position.set(...B.P([0, 2.95, 0.2])); m.rotation.y = r; scene.add(m);
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

// convex traffic mirror (カーブミラー) on an orange pole
const mirrorMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, metalness: 1, roughness: 0.02 });
export function curveMirror(B, x, y, z, r) {
  B.frame(x, y, z, r);
  B.cyl('plain', 0, 0, 0, 0.038, 0.038, 3.0, 8, { color: [0.95, 0.42, 0.08] });
  B.beam('plain', [0, 2.85, 0], [0, 2.85, 0.25], 0.05, 0.05, { color: [0.95, 0.42, 0.08] });
  const disc = new THREE.Mesh(new THREE.SphereGeometry(0.45, 20, 10, 0, Math.PI * 2, 0, 0.5), mirrorMat);
  disc.rotation.x = Math.PI / 2; const p = B.P([0, 2.85, 0.3]); disc.position.set(p[0], p[1], p[2]);
  const holder = new THREE.Group(); holder.position.copy(disc.position); holder.rotation.y = r; disc.position.set(0, 0, 0); holder.add(disc);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.05, 6, 24), new THREE.MeshStandardMaterial({ color: 0xf06a14, roughness: 0.5 }));
  rim.position.z = 0.03; holder.add(rim);
  scene.add(holder);
  addCircle(x, z, 0.1);
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
const signMats = {};
export function roadSign(B, x, y, z, r, kind) {
  B.frame(x, y, z, r);
  const ph = kind === 'stop' ? 2.1 : 2.6, sy = kind === 'stop' ? 1.85 : 2.3;
  B.cyl('alu', 0, -0.15, 0, 0.032, 0.03, ph + 0.15, 12, { color: [0.82, 0.84, 0.86] });
  B.cyl('plastic', 0, ph, 0, 0.036, 0.02, 0.04, 12, { color: [0.3, 0.3, 0.32], cap: true });
  if (!signMats[kind]) signMats[kind] = new THREE.MeshStandardMaterial({ map: roadSignTex(kind), alphaTest: 0.5, roughness: 0.4 });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.75), signMats[kind]);
  const p = B.P([0, sy, 0.045]); m.position.set(p[0], p[1], p[2]); m.rotation.y = r; m.castShadow = true;
  scene.add(m); addCircle(x, z, 0.06);
  // the plate's grey back (in the sign's outline) and two clamp bands round the post
  const outline = kind === 'stop' ? [[-0.36, 0.3], [0.36, 0.3], [0, -0.35]] : kind === 'crossing' ? [[0, 0.36], [0.36, 0], [0, -0.36], [-0.36, 0]]
    : Array.from({ length: 20 }, (_, i) => [Math.cos(i / 20 * Math.PI * 2) * 0.35, Math.sin(i / 20 * Math.PI * 2) * 0.35]);
  const c = outline.reduce((a, q) => [a[0] + q[0] / outline.length, a[1] + q[1] / outline.length], [0, 0]);
  for (let i = 0; i < outline.length; i++) { const a = outline[i], b = outline[(i + 1) % outline.length];
    B.poly('alu', [[c[0], sy + c[1], 0.042], [a[0], sy + a[1], 0.042], [b[0], sy + b[1], 0.042]], [0, 0, -1], { color: [0.62, 0.64, 0.66] }); }
  B.detail(1, () => { for (const dy of [-0.18, 0.18]) B.bbox('steel', 0, sy + dy - 0.03, 0.02, 0.1, 0.06, 0.1, 0.008, { color: [0.6, 0.62, 0.64] }); });
}

// painted "止まれ" legend + stop line texture for road surfaces
export const stopTex = canvasTex(256, 512, (g, W, H) => {
  g.clearRect(0, 0, W, H); g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.save(); g.scale(1, 1.45); g.font = `bold 112px ${JP_FONT}`; // glyphs stretched lengthwise like real road paint
  ['止', 'ま', 'れ'].forEach((c, i) => g.fillText(c, W / 2, 58 + i * 116)); g.restore();
});
export const stopMat = new THREE.MeshStandardMaterial({ map: stopTex, alphaToCoverage: true, roughness: 0.62, color: 0xe8e8e2 });

// ---------------------------------------------------------------- buildings
// anime palettes: clean pastel walls and saturated roofs (Shinkai / Ghibli town streets)
export const WALL_TINTS = [[1, 0.97, 0.9], [0.98, 0.98, 0.96], [0.9, 0.95, 1], [0.92, 1, 0.93], [1, 0.9, 0.84], [1, 0.97, 0.8], [1, 0.9, 0.9], [0.9, 0.88, 0.86], [0.86, 0.92, 0.98]];
const ROOF_METAL = [[0.2, 0.33, 0.6], [0.2, 0.5, 0.52], [0.72, 0.28, 0.2], [0.26, 0.3, 0.42], [0.3, 0.5, 0.32], [0.55, 0.22, 0.2], [0.18, 0.42, 0.7]];
const ROOF_TILE = [[0.42, 0.52, 0.72], [0.36, 0.42, 0.55], [0.5, 0.56, 0.64], [0.7, 0.4, 0.32], [0.35, 0.55, 0.58]];
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const jitter = (rng, c, a = 0.04) => c.map(v => clamp(v + (rng() - 0.5) * a, 0, 1));

export const lampPoints = []; // world positions of light fixtures (for dynamic point lights)
const deco = mulberry32(777); // decorations draw from their own stream so the town layout stays the same
// red paper lantern (chochin): lamp material, so it glows warm red at night
export function chochin(B, x, y, z, col = [1, 0.3, 0.2], s = 1) {
  B.cyl('dark', x, y + 0.5 * s, z, 0.1 * s, 0.1 * s, 0.05 * s, 8, { cap: true });
  B.cyl('lamp', x, y + 0.36 * s, z, 0.19 * s, 0.11 * s, 0.14 * s, 10, { color: col, cap: true });
  B.cyl('lamp', x, y + 0.12 * s, z, 0.19 * s, 0.19 * s, 0.24 * s, 10, { color: col });
  B.cyl('lamp', x, y, z, 0.11 * s, 0.19 * s, 0.12 * s, 10, { color: col });
  B.cyl('dark', x, y - 0.04 * s, z, 0.1 * s, 0.1 * s, 0.05 * s, 8);
}
export const litWindows = [];

// window on a wall plane: wall frame axis is local X along wall, Y up, facing +Z (call with builder frame on wall)
function windowOn(B, cx, y, w, h, rng, opt = {}) {
  const lit = rng() < 0.45, z = opt.z || 0.02;
  B.quad('window', [cx - w / 2, y, z], [cx + w / 2, y, z], [cx + w / 2, y + h, z], [cx - w / 2, y + h, z],
    { color: lit ? jitter(rng, rng() < 0.7 ? [1, 0.85, 0.6] : [0.85, 0.92, 1], 0.1) : [1, 1, 1], uvs: [[0, 0], [1, 0], [1, 1], [0, 1]] });
  const f = 0.05, c = opt.frame || [0.78, 0.8, 0.82], fm = opt.frameMat || 'alu';
  B.box(fm, cx, y - f, z + 0.01, w + f * 2, f, 0.06, { color: c });
  B.box(fm, cx, y + h, z + 0.01, w + f * 2, f, 0.06, { color: c });
  B.box(fm, cx - w / 2 - f / 2, y, z + 0.01, f, h, 0.06, { color: c });
  B.box(fm, cx + w / 2 + f / 2, y, z + 0.01, f, h, 0.06, { color: c });
  if (w > 0.9) B.box(fm, cx, y, z + 0.02, 0.04, h, 0.04, { color: c });
  if (opt.sill !== false) B.box(fm, cx, y - 0.08, z + 0.05, w + 0.12, 0.04, 0.12, { color: c });
  if (opt.lattice) { const n = Math.round(w / 0.1); for (let i = 1; i < n; i++) B.box('plain', cx - w / 2 + i * w / n, y, z + 0.07, 0.025, h, 0.03, { color: [0.36, 0.25, 0.18] }); } // koshi
  if (opt.shutterBox) B.box('alu', cx, y + h + 0.05, z + 0.08, w + 0.14, 0.2, 0.16, { color: opt.shutterColor || [0.75, 0.74, 0.7] });
  if (opt.hood) { // small sloped hood (hisashi) over the window
    const hy = y + h + (opt.shutterBox ? 0.34 : 0.14), hd = 0.45, hw = w / 2 + 0.22;
    B.quad('roofMetal', [cx - hw, hy, z + hd], [cx + hw, hy, z + hd], [cx + hw, hy + 0.16, z], [cx - hw, hy + 0.16, z], { color: opt.hood });
    B.quad('plain', [cx + hw, hy - 0.02, z + hd], [cx - hw, hy - 0.02, z + hd], [cx - hw, hy + 0.14, z], [cx + hw, hy + 0.14, z], { color: [0.9, 0.88, 0.84] });
    B.box('plain', cx, hy - 0.06, z + hd, hw * 2, 0.08, 0.03, { color: opt.hood.map(v => v * 0.75) });
  }
  if (opt.grille) for (let i = 1; i < 6; i++) B.box('alu', cx - w / 2 + i * w / 6, y, z + 0.06, 0.02, h, 0.02, { color: c });
}

function gableRoof(B, mat, w, d, y, pitch, over, color) {
  const rh = Math.tan(pitch) * (d / 2 + over), x0 = -w / 2 - over, x1 = w / 2 + over, z0 = -d / 2 - over, z1 = d / 2 + over;
  const o = { color, uv: 2 };
  B.quad(mat, [x0, y, z1], [x1, y, z1], [x1, y + rh, 0], [x0, y + rh, 0], o);
  B.quad(mat, [x1, y, z0], [x0, y, z0], [x0, y + rh, 0], [x1, y + rh, 0], o);
  // soffits (underside of eaves)
  B.quad('plain', [x1, y, z1], [x0, y, z1], [x0, y + rh, 0], [x1, y + rh, 0], { color: [0.86, 0.82, 0.76] });
  B.quad('plain', [x0, y, z0], [x1, y, z0], [x1, y + rh, 0], [x0, y + rh, 0], { color: [0.86, 0.82, 0.76] });
  // fascia + ridge
  B.box('plain', 0, y - 0.12, z1, x1 - x0, 0.14, 0.05, { color: color.map(v => v * 0.7) });
  B.box('plain', 0, y - 0.12, z0, x1 - x0, 0.14, 0.05, { color: color.map(v => v * 0.7) });
  B.box(mat, 0, y + rh - 0.02, 0, x1 - x0, 0.14, 0.26, { color: color.map(v => v * 0.8), uv: 2 });
  return rh;
}
function hipRoof(B, mat, w, d, y, pitch, over, color) {
  const hw = w / 2 + over, hd = d / 2 + over, rh = Math.tan(pitch) * hd, r = Math.max(0.2, hw - hd);
  const o = { color, uv: 2 };
  B.quad(mat, [-hw, y, hd], [hw, y, hd], [r, y + rh, 0], [-r, y + rh, 0], o);
  B.quad(mat, [hw, y, -hd], [-hw, y, -hd], [-r, y + rh, 0], [r, y + rh, 0], o);
  B.tri(mat, [hw, y, hd], [hw, y, -hd], [r, y + rh, 0], o);
  B.tri(mat, [-hw, y, -hd], [-hw, y, hd], [-r, y + rh, 0], o);
  const so = { color: [0.86, 0.82, 0.76] };
  B.quad('plain', [hw, y, hd], [-hw, y, hd], [-hw, y, -hd], [hw, y, -hd], so);
  B.box(mat, 0, y + rh - 0.02, 0, 2 * r + 0.2, 0.14, 0.26, { color: color.map(v => v * 0.8), uv: 2 });
  return rh;
}

// Detached houses in five styles so streets never look copy-pasted:
//  classic      pastel siding, gable or hip roof, sometimes a smaller second floor over a lean-to
//  twoTone      tiled or timber ground floor under a pastel upper floor, bay window
//  modern       single-pitch (katanagare) roof with solar panels, dark frames, tall windows, timber accent
//  traditional  dark cedar skirting under white plaster, heavy kawara hip roof, skirt roof between floors, lattices
//  cube         flat roof with parapet, ribbon windows, glass balcony
// Lot local frame: origin lot centre, +Z towards the street. Returns info for the caller.
const HOUSE_WALLS = [[1, 0.93, 0.78], [0.98, 0.98, 0.96], [0.78, 0.95, 0.82], [0.78, 0.88, 1], [1, 0.82, 0.7], [1, 0.92, 0.62], [1, 0.82, 0.85],
  [0.87, 0.82, 0.98], [0.78, 0.87, 0.7], [0.95, 0.86, 0.72], [0.74, 0.86, 0.94], [1, 0.97, 0.9]];
const MODERN_WALLS = [[0.97, 0.97, 0.95], [0.97, 0.97, 0.95], [0.36, 0.38, 0.42], [0.32, 0.42, 0.6], [0.62, 0.76, 0.62], [0.92, 0.86, 0.78], [0.84, 0.6, 0.5]];
const LOWER_TONES = [[0.86, 0.6, 0.48], [0.72, 0.72, 0.74], [0.9, 0.8, 0.66], [0.62, 0.5, 0.44], [0.58, 0.66, 0.72]];
const HOUSE_ROOFS = [[0.2, 0.33, 0.6], [0.2, 0.5, 0.52], [0.72, 0.28, 0.2], [0.26, 0.3, 0.42], [0.3, 0.5, 0.32], [0.55, 0.22, 0.2], [0.18, 0.42, 0.7],
  [0.42, 0.28, 0.22], [0.62, 0.36, 0.22], [0.3, 0.32, 0.36]];
const FRAMES = { alu: [0.8, 0.82, 0.84], white: [0.96, 0.96, 0.94], brown: [0.36, 0.25, 0.18], black: [0.16, 0.16, 0.18], wood: [0.5, 0.35, 0.22] };
const FLOWERS = [[1, 0.45, 0.55], [0.98, 0.3, 0.28], [1, 0.86, 0.3], [0.96, 0.96, 0.94], [0.72, 0.52, 0.95], [1, 0.62, 0.8]];

function shedRoof(B, mat, w, d, yEave, pitch, over, color) { // single pitch: low edge at +Z, high edge at -Z
  const x0 = -w / 2 - over, x1 = w / 2 + over, z0 = -d / 2 - over, z1 = d / 2 + over, k = Math.tan(pitch);
  const yAt = zz => yEave + (z1 - zz) * k, o = { color, uv: 2 }, so = { color: [0.9, 0.87, 0.82] };
  B.quad(mat, [x0, yAt(z1), z1], [x1, yAt(z1), z1], [x1, yAt(z0), z0], [x0, yAt(z0), z0], o);
  B.quad('plain', [x1, yAt(z1) - 0.05, z1], [x0, yAt(z1) - 0.05, z1], [x0, yAt(z0) - 0.05, z0], [x1, yAt(z0) - 0.05, z0], so);
  const fc = { color: color.map(v => v * 0.7) };
  B.box('plain', 0, yAt(z1) - 0.16, z1, x1 - x0, 0.18, 0.06, fc);
  B.box('plain', 0, yAt(z0) - 0.16, z0, x1 - x0, 0.18, 0.06, fc);
  for (const sx of [x0, x1]) B.beam('plain', [sx, yAt(z1) - 0.07, z1], [sx, yAt(z0) - 0.07, z0], 0.06, 0.18, fc);
  return yAt;
}
function skirtRoof(B, mat, W, D, yh, out, drop, color) { // hisashi: a narrow sloped roof wrapped around the walls
  const F = B.F, so = { color: [0.88, 0.85, 0.8] }, o = { color, uv: 2 };
  for (const [fr, off, hl] of [[0, D / 2, W / 2], [Math.PI, D / 2, W / 2], [Math.PI / 2, W / 2, D / 2], [-Math.PI / 2, W / 2, D / 2]]) {
    B.frame(...B.P([Math.sin(fr) * 0, 0, 0]), F.r + fr);
    const yo = yh - drop, a = [-hl - out, yo, off + out], b = [hl + out, yo, off + out], c = [hl, yh, off], d = [-hl, yh, off];
    B.quad(mat, a, b, c, d, o);
    B.quad('plain', b, a, d, c, so);
    B.F = F;
  }
}
function solarPanels(B, w, z0, z1, yAt, rows) { // dark glass panels lying on a roof plane between z0 and z1
  const cols = Math.max(2, Math.floor(w / 1.05)), pw = 0.98, gx = -cols * pw / 2;
  for (let rI = 0; rI < rows; rI++) {
    const za = lerp(z0, z1, rI / rows) + 0.05, zb = lerp(z0, z1, (rI + 1) / rows) - 0.05;
    for (let c = 0; c < cols; c++) {
      const xa = gx + c * pw + 0.03, xb = xa + pw - 0.06;
      B.quad('glass', [xa, yAt(za) + 0.09, za], [xb, yAt(za) + 0.09, za], [xb, yAt(zb) + 0.09, zb], [xa, yAt(zb) + 0.09, zb], { color: [0.55, 0.7, 1.1] });
    }
    B.beam('alu', [gx, yAt(za) + 0.06, za], [gx + cols * pw, yAt(za) + 0.06, za], 0.04, 0.05, { color: [0.75, 0.77, 0.8] });
  }
}
function antenna(B, x, y, z) { // TV aerial on the ridge
  B.cyl('alu', x, y, z, 0.025, 0.02, 2.3, 6, { color: [0.7, 0.72, 0.75] });
  B.box('alu', x, y + 1.9, z, 0.03, 0.03, 1.4, { color: [0.7, 0.72, 0.75] });
  for (let i = 0; i < 5; i++) B.box('alu', x, y + 1.9, z - 0.6 + i * 0.3, 0.7 - i * 0.08, 0.02, 0.02, { color: [0.7, 0.72, 0.75] });
}
function flowerBox(B, cx, y, w, z, rng) {
  B.box('wood', cx, y - 0.3, z + 0.14, w, 0.22, 0.24, { color: [0.55, 0.38, 0.26] });
  const c = pick(rng, FLOWERS), n = Math.max(3, Math.floor(w / 0.18));
  for (let i = 0; i < n; i++) B.box('plain', cx - w / 2 + (i + 0.5) * w / n, y - 0.1, z + 0.12 + (i % 2) * 0.06, 0.13, 0.12 + (i % 3) * 0.03, 0.13, { color: i % 3 === 2 ? [0.3, 0.6, 0.3] : c });
}

export function house(B, lot, rng, extras) {
  const { x, y, z, r, w: LW, d: LD } = lot;
  B.frame(x, y, z, r);
  const W = clamp(LW - 2.2 - rng() * 1.2, 6.5, 10), D = clamp(LD - 6 - rng() * 1.5, 7, 10.5);
  const sr = rng(), style = sr < 0.3 ? 'classic' : sr < 0.53 ? 'twoTone' : sr < 0.71 ? 'modern' : sr < 0.87 ? 'traditional' : 'cube';
  const floors = style === 'cube' ? 2 : style === 'traditional' ? (rng() < 0.35 ? 1 : 2) : rng() < 0.12 ? 1 : 2;
  const fh = 2.85, base = style === 'traditional' ? 0.55 : 0.45, H = base + floors * fh;
  const hz = -LD / 2 + 1.2 + D / 2, hx = (rng() - 0.5) * (LW - W - 1.6);
  // materials and colours
  let wallMat = rng() < 0.55 ? 'siding' : rng() < 0.6 ? 'stucco' : 'plaster', wc = jitter(rng, pick(rng, HOUSE_WALLS), 0.05);
  let lowMat = wallMat, lc = wc, frameC = FRAMES.alu, frameMat = 'alu', roofC = pick(rng, HOUSE_ROOFS), roofMat = rng() < 0.5 ? 'roofTile' : 'roofMetal';
  if (style === 'twoTone') { lowMat = rng() < 0.6 ? 'tiles' : 'wood'; lc = jitter(rng, lowMat === 'wood' ? [0.86, 0.62, 0.42] : pick(rng, LOWER_TONES), 0.05); wallMat = 'siding'; frameC = rng() < 0.5 ? FRAMES.white : FRAMES.brown; frameMat = 'plain'; }
  if (style === 'modern') { wallMat = rng() < 0.7 ? 'siding' : 'stucco'; wc = jitter(rng, pick(rng, MODERN_WALLS), 0.03); lowMat = wallMat; lc = wc; frameC = FRAMES.black; frameMat = 'plain'; roofMat = 'roofMetal'; roofC = pick(rng, [[0.24, 0.26, 0.3], [0.2, 0.3, 0.44], [0.46, 0.3, 0.24], [0.3, 0.42, 0.36]]); }
  if (style === 'traditional') { wallMat = 'plaster'; wc = [0.98, 0.96, 0.9]; lowMat = 'wood'; lc = [0.5, 0.36, 0.28]; frameC = FRAMES.wood; frameMat = 'plain'; roofMat = 'roofTile'; roofC = jitter(rng, pick(rng, [[0.36, 0.42, 0.55], [0.3, 0.33, 0.4], [0.42, 0.46, 0.52]]), 0.04); }
  if (style === 'cube') { wallMat = rng() < 0.5 ? 'stucco' : 'plaster'; wc = jitter(rng, pick(rng, [[0.98, 0.98, 0.96], [0.9, 0.9, 0.9], [0.95, 0.9, 0.82], [0.4, 0.42, 0.46]]), 0.03); lowMat = wallMat; lc = wc; frameC = FRAMES.black; frameMat = 'plain'; }
  if (style === 'classic' && rng() < 0.4) { frameC = rng() < 0.6 ? FRAMES.white : FRAMES.brown; frameMat = 'plain'; }
  const uvW = m => m === 'siding' ? 2.2 : m === 'wood' ? 2 : 3;
  const upperOnly = style === 'classic' && floors === 2 && rng() < 0.35;   // second floor over part of the house only
  const W2 = upperOnly ? Math.max(4.6, W * (0.55 + rng() * 0.12)) : W, x2 = upperOnly ? (rng() < 0.5 ? -1 : 1) * (W - W2) / 2 : 0;
  let doorX = 0, roofTop = H, ridgeZ = 0, ridgeAlongX = true, shedSide = 0;
  const Bf = (fn) => { const F = B.F; B.frame(...B.P([hx, 0, hz]), r); fn(); B.F = F; };
  Bf(() => {
    // body: foundation, ground floor, upper floor (possibly narrower), trim bands
    B.box('concrete', 0, 0, 0, W + 0.04, base, D + 0.04, { color: [0.7, 0.7, 0.68], skip: 'ny', uv: 2 });
    const g1 = base + fh;
    if (style === 'traditional') {
      B.box('wood', 0, base, 0, W + 0.03, 1.0, D + 0.03, { color: lc, skip: 'ny py', uv: 2 });
      B.box(wallMat, 0, base + 1.0, 0, W, floors * fh - 1.0, D, { color: wc, skip: 'ny', uv: 3 });
    } else if (floors === 1) B.box(lowMat, 0, base, 0, W, fh, D, { color: lc, skip: 'ny', uv: uvW(lowMat) });
    else {
      B.box(lowMat, 0, base, 0, W, fh, D, { color: lc, skip: 'ny py', uv: uvW(lowMat) });
      B.box(wallMat, x2, g1, 0, W2, fh, D, { color: wc, skip: 'ny', uv: uvW(wallMat) });
    }
    if (floors === 2 && style !== 'traditional' && style !== 'modern') B.box('plain', x2, g1 - 0.1, 0, W2 + 0.06, 0.14, D + 0.06, { color: style === 'twoTone' ? frameC : wc.map(v => v * 0.82) });
    if (style === 'modern') B.box('wood', W / 2 - 1.3, base, D / 2 + 0.01, 1.6, floors * fh, 0.06, { color: [1.0, 0.76, 0.52], uv: 2 }); // timber accent panel
    // roofs
    const F2 = B.F;
    const over = style === 'traditional' ? 0.85 : style === 'modern' ? 0.35 : 0.55;
    if (style === 'cube') {
      B.box(wallMat, 0, H, 0, W, 0.45, D, { color: wc.map(v => v * 0.97), skip: 'ny', uv: 3 });
      B.box('concrete', 0, H + 0.45, 0, W + 0.1, 0.06, D + 0.1, { color: [0.62, 0.63, 0.64] });
      roofTop = H + 0.5;
    } else if (style === 'modern') {
      const flip = rng() < 0.5 ? 0 : Math.PI, pitch = (12 + rng() * 8) * Math.PI / 180;
      B.frame(...B.P([0, 0, 0]), r + flip);
      const yEave = H - Math.tan(pitch) * over, yAt = shedRoof(B, roofMat, W, D, yEave, pitch, over, roofC);
      // walls up to the sloped roof: side trapezoids and the tall back strip
      for (const sx of [-1, 1]) {
        const X = sx * W / 2, q = sx > 0 ? [[X, H, D / 2], [X, H, -D / 2], [X, yAt(-D / 2), -D / 2], [X, yAt(D / 2), D / 2]] : [[X, H, -D / 2], [X, H, D / 2], [X, yAt(D / 2), D / 2], [X, yAt(-D / 2), -D / 2]];
        B.quad(wallMat, ...q, { color: wc, uv: uvW(wallMat) });
      }
      B.quad(wallMat, [W / 2, H, -D / 2], [-W / 2, H, -D / 2], [-W / 2, yAt(-D / 2), -D / 2], [W / 2, yAt(-D / 2), -D / 2], { color: wc, uv: uvW(wallMat) });
      // clerestory windows in the tall wall
      const F3 = B.F; B.frame(...B.P([0, 0, -D / 2]), r + flip + Math.PI);
      const ch = Math.min(1.1, yAt(-D / 2) - H - 0.45);
      if (ch > 0.35) for (let k = 0; k < 3; k++) windowOn(B, -W / 3 + k * W / 3, H + 0.15, 1.1, ch, rng, { sill: false, frame: frameC, frameMat });
      B.F = F3;
      if (rng() < 0.7) solarPanels(B, W * 0.8, D / 2 - 0.2, -D / 2 + 0.4, yAt, 2);
      roofTop = yAt(-D / 2); ridgeZ = flip ? D / 2 - 0.3 : -D / 2 + 0.3;
      B.F = F2;
    } else {
      const gableFront = !upperOnly && style !== 'traditional' && rng() < 0.38;   // gable end facing the street, steep roof
      const hip = !gableFront && (style === 'traditional' ? rng() < 0.75 : rng() < 0.4);
      const pitch = (style === 'traditional' ? 27 : gableFront ? 31 + rng() * 9 : roofMat === 'roofTile' ? 22 + rng() * 6 : 18 + rng() * 12) * Math.PI / 180;
      const along = gableFront ? false : W2 >= D;
      B.frame(...B.P([x2, 0, 0]), r + (along ? 0 : Math.PI / 2));
      const rw = along ? W2 : D, rd = along ? D : W2;
      let rh;
      if (hip) rh = hipRoof(B, roofMat, rw, rd, H, pitch, over, roofC);
      else {
        rh = gableRoof(B, roofMat, rw, rd, H, pitch, over * 0.9, roofC);
        for (const sx of [-1, 1]) B.tri(wallMat, [sx * rw / 2, H, sx * rd / 2], [sx * rw / 2, H, -sx * rd / 2], [sx * rw / 2, H + rh, 0], { color: wc, uv: 2.2 });
        if (along && rng() < 0.3 && style === 'classic') { // solar panels on the street-facing slope
          const z1 = rd / 2 + over * 0.9, k = rh / z1;
          solarPanels(B, rw * 0.7, rd / 2 - 0.1, 0.5, zz => H + (z1 - zz) * k, 2);
        }
      }
      roofTop = H + rh; ridgeAlongX = along;
      B.F = F2;
      if (gableFront && rh > 1.6) { // attic window in the street-facing gable
        const F7 = B.F; B.frame(...B.P([x2, 0, D / 2]), r);
        windowOn(B, 0, H + rh * 0.22, 0.75, Math.min(0.9, rh * 0.35), rng, { frame: frameC, frameMat, sill: false });
        B.F = F7;
      }
      if (upperOnly) { // lean-to over the single-storey part, closed at both ends
        const lw = W - W2, side = -Math.sign(x2);
        B.frame(...B.P([-Math.sign(x2) * W2 / 2, 0, 0]), r + side * Math.PI / 2);
        const yAt = shedRoof(B, roofMat, D, lw, g1 + 0.05, 0.3, 0.45, roofC);
        for (const sx of [-1, 1]) { const X = sx * D / 2, a = [X, g1, -lw / 2], b = [X, g1, lw / 2], c = [X, yAt(lw / 2), lw / 2], d = [X, yAt(-lw / 2), -lw / 2];
          B.quad(lowMat, ...(sx > 0 ? [b, a, d, c] : [a, b, c, d]), { color: lc, uv: uvW(lowMat) }); }
        B.F = F2;
      }
      if (style === 'traditional' && floors === 2) skirtRoof(B, roofMat, W, D, g1 + 0.2, 0.75, 0.4, roofC);
    }
    if (rng() < 0.35 && style !== 'cube') { const off = (rng() - 0.5) * 1.2; antenna(B, x2 + (ridgeAlongX ? off : 0), roofTop - 0.1, ridgeAlongX ? ridgeZ : off); }
    // windows: front (+Z), back, sides
    const faces = [[0, D / 2, W, 0], [Math.PI, D / 2, W, 0], [Math.PI / 2, W / 2, D, 1], [-Math.PI / 2, W / 2, D, 1]];
    doorX = (rng() < 0.5 ? -1 : 1) * (W / 2 - 1.1);
    const bayX = -doorX * 0.45, lattice = style === 'traditional', boxes = (style === 'classic' || style === 'twoTone') && rng() < 0.45;
    const hoods = (style === 'classic' || style === 'twoTone' || style === 'traditional') && rng() < 0.5;
    faces.forEach(([fr, off, fw, isSide], fi) => {
      const F3 = B.F; B.frame(...B.P([Math.sin(fr) * off, 0, Math.cos(fr) * off]), r + fr);
      for (let fl = 0; fl < floors; fl++) {
        // the narrower upper floor of a partial two-storey house: only windows on its own walls
        const upper = fl === 1 && upperOnly;
        const faceW = upper && !isSide ? W2 : fw, faceX = upper && !isSide ? x2 * (fr === 0 ? 1 : -1) : 0;
        if (upper && isSide && Math.sign(Math.sin(fr)) !== Math.sign(x2)) continue;
        let n = isSide ? (rng() < 0.6 ? 1 : 2) : Math.max(1, Math.floor(faceW / (style === 'modern' ? 3.2 : 2.6)));
        if (style === 'cube' && !isSide) n = 1;
        for (let k = 0; k < n; k++) {
          let cx = faceX + (k + 0.5) / n * faceW - faceW / 2 + (rng() - 0.5) * 0.3;
          let big = !isSide && rng() < 0.5, ww = big ? 1.65 : 0.9 + rng() * 0.3, wh = big && fl === 0 ? 1.8 : 1.1, wy = base + fl * fh + (big && fl === 0 ? 0.35 : 0.95);
          if (style === 'cube' && !isSide) { const gd = fl === 0 && fi === 0; ww = faceW * (gd ? 0.4 : 0.62); cx = gd ? -Math.sign(doorX) * faceW * 0.22 : faceX; wh = 1.05; wy = base + fl * fh + 0.95; big = false; }
          else if (style === 'modern' && !isSide && rng() < 0.6) { ww = 0.7; wh = 2.1; wy = base + fl * fh + 0.35; }        // tall slit windows
          const wx = clamp(cx, faceX - faceW / 2 + ww / 2 + 0.3, faceX + faceW / 2 - ww / 2 - 0.3);
          if (fi === 0 && fl === 0 && (Math.abs(wx - doorX) < ww / 2 + 0.75 || style === 'twoTone' && Math.abs(wx - bayX) < ww / 2 + 1.25)) continue;
          windowOn(B, wx, wy, ww, wh, rng, { shutterBox: style !== 'cube' && style !== 'modern' && (big || rng() < 0.4), grille: isSide && rng() < 0.4, lattice: lattice && fl === 0,
            frame: frameC, frameMat, sill: style !== 'cube', hood: hoods && !isSide ? roofC : null });
          if (boxes && fi === 0 && !big && rng() < 0.7) flowerBox(B, wx, wy, ww + 0.1, 0.02, rng);
        }
      }
      // AC outdoor unit
      if (rng() < 0.55) {
        const ax = (rng() - 0.5) * (fw - 1.5);
        B.box('plain', ax, 0.1, 0.35, 0.8, 0.6, 0.28, { color: [0.93, 0.93, 0.9] });
        B.box('dark', ax - 0.1, 0.22, 0.495, 0.42, 0.38, 0.01);
        extras.push({ t: 'box', p: B.P([ax, 0, 0.35]), hx: 0.4, hz: 0.15, r: r + fr });
      }
      B.F = F3;
    });
    // twoTone: a bay window on the ground floor front
    if (style === 'twoTone') {
      const F6 = B.F; B.frame(...B.P([bayX, 0, D / 2]), r);
      B.box(lowMat, 0, base + 0.3, 0.3, 2.3, 1.9, 0.6, { color: lc, skip: 'nz', uv: uvW(lowMat) });
      B.box('roofMetal', 0, base + 2.2, 0.32, 2.5, 0.1, 0.72, { color: roofC });
      windowOn(B, 0, base + 0.75, 1.8, 1.2, rng, { z: 0.61, frame: frameC, frameMat, sill: false });
      if (rng() < 0.6) flowerBox(B, 0, base + 0.75, 1.9, 0.62, rng);
      B.F = F6;
    }
    // entrance (genkan): door + canopy + step
    const F4 = B.F; B.frame(...B.P([doorX, 0, D / 2]), r);
    const doorC = style === 'traditional' ? [0.45, 0.32, 0.22] : pick(rng, [[0.28, 0.42, 0.62], [0.66, 0.3, 0.26], [0.35, 0.52, 0.42], [0.95, 0.95, 0.93], [0.38, 0.29, 0.24], [0.86, 0.68, 0.3], [0.3, 0.3, 0.33]]);
    const woodDoor = style === 'traditional' || rng() < 0.4;
    B.box(woodDoor ? 'wood' : 'plain', 0, base - 0.05, 0.02, 0.95, 2.05, 0.06, { color: woodDoor ? [0.82, 0.6, 0.42] : doorC });
    if (style === 'traditional') for (let i = -3; i <= 3; i++) B.box('plain', i * 0.13, base - 0.05, 0.06, 0.025, 2.05, 0.02, { color: [0.3, 0.22, 0.16] }); // sliding lattice door
    B.box('alu', 0.3, base + 0.95, 0.07, 0.04, 0.35, 0.04);
    B.box('concrete', 0, 0, 0.5, 1.6, base - 0.05, 1.0, { color: [0.74, 0.74, 0.72] });
    B.box(style === 'modern' || style === 'cube' ? 'plain' : 'roofMetal', 0, base + 2.35, 0.45, 1.5, 0.1, 0.95, { color: style === 'modern' || style === 'cube' ? [0.25, 0.25, 0.27] : roofC });
    B.box('lamp', 0.65, base + 1.9, 0.06, 0.12, 0.18, 0.08);
    lampPoints.push({ p: B.P([0.65, base + 1.9, 0.3]), s: 0.5 });
    B.F = F4;
    // balcony on the upper floor (glass for the cube houses)
    if (floors === 2 && style !== 'traditional' && rng() < (style === 'cube' ? 0.8 : 0.6)) {
      const bw = Math.min(W2 - 1, 3.5 + rng() * 2), bx = x2 + (rng() - 0.5) * (W2 - bw);
      B.box('concrete', bx, base + fh - 0.12, D / 2 + 0.5, bw, 0.14, 1.0, { color: [0.76, 0.76, 0.74] });
      const railC = style === 'cube' ? FRAMES.black : [0.82, 0.83, 0.84];
      B.box('alu', bx, base + fh + 0.95, D / 2 + 0.98, bw, 0.05, 0.05, { color: railC });
      if (style === 'cube') B.quad('poly', [bx - bw / 2, base + fh, D / 2 + 0.99], [bx + bw / 2, base + fh, D / 2 + 0.99], [bx + bw / 2, base + fh + 0.95, D / 2 + 0.99], [bx - bw / 2, base + fh + 0.95, D / 2 + 0.99]);
      else for (let i = 0; i <= Math.floor(bw / 0.12); i++) B.box('alu', bx - bw / 2 + i * 0.12, base + fh, D / 2 + 0.98, 0.02, 0.95, 0.02, { color: railC });
      for (const s of [-1, 1]) B.box('alu', bx + s * bw / 2, base + fh, D / 2 + 0.5, 0.04, 0.98, 1.0, { color: railC, skip: 'pz nz' });
      // laundry poles
      B.box('alu', bx, base + fh + 1.75, D / 2 + 0.7, bw - 0.2, 0.03, 0.03, { color: [0.6, 0.62, 0.64] });
      if (rng() < 0.5) for (let i = 0; i < 4; i++) B.box('plain', bx - bw / 2 + 0.5 + i * (bw - 1) / 3, base + fh + 1.1, D / 2 + 0.7, 0.45, 0.62, 0.02, { color: jitter(rng, pick(rng, [[0.95, 0.95, 0.95], [0.5, 0.62, 0.9], [0.95, 0.6, 0.62], [0.98, 0.86, 0.5]]), 0.1) });
    }
    extras.push({ t: 'box', p: B.P([0, 0, 0]), hx: W / 2, hz: D / 2, r });
    // backyard storage shed (the ubiquitous steel monooki) in a rear corner
    if (rng() < 0.45) { const F7 = B.F, side = rng() < 0.5 ? -1 : 1; shedSide = side; B.frame(...B.P([side * (W / 2 - 0.9), 0, -D / 2 - 0.52]), r);
      const sc = pick(rng, [[0.86, 0.82, 0.7], [0.62, 0.72, 0.6], [0.8, 0.8, 0.78], [0.55, 0.62, 0.72]]);
      B.box('plain', 0, 0, 0, 1.5, 1.6, 0.6, { color: sc }); B.box('plain', 0, 1.6, 0, 1.6, 0.07, 0.7, { color: sc.map(v => v * 0.8) });
      for (const dx of [-0.37, 0.37]) B.box('dark', dx, 0.1, 0.31, 0.02, 1.35, 0.01, { color: [0.3, 0.3, 0.3] });
      extras.push({ t: 'box', p: B.P([0, 0, 0]), hx: 0.75, hz: 0.3, r }); B.F = F7; }
    // water heater (EcoCute) on a side
    if (rng() < 0.4) { const F5 = B.F; B.frame(...B.P([W / 2 + 0.45, 0, -D / 4]), r); B.box('plain', 0, 0, 0, 0.65, 1.95, 0.7, { color: [0.95, 0.95, 0.93] }); extras.push({ t: 'box', p: B.P([0, 0, 0]), hx: 0.35, hz: 0.35, r }); B.F = F5; }
  });
  // block wall around the lot with gate + driveway gap
  B.frame(x, y, z, r);
  const wallH = 0.8 + rng() * 0.6, gateW = 3.2, wc2 = jitter(rng, [0.75, 0.74, 0.72], 0.05), hasWall = rng() < 0.8;
  if (hasWall) {
    const seg = (ax, az, bx, bz) => { B.beam('block', [ax, wallH / 2, az], [bx, wallH / 2, bz], 0.15, wallH, { color: wc2, uv: 1.6 }); B.beam('concrete', [ax, wallH + 0.03, az], [bx, wallH + 0.03, bz], 0.19, 0.06, { color: [0.65, 0.65, 0.63] }); };
    seg(-LW / 2, -LD / 2, LW / 2, -LD / 2);
    seg(-LW / 2, -LD / 2, -LW / 2, LD / 2 - 0.1); seg(LW / 2, -LD / 2, LW / 2, LD / 2 - 0.1);
    const gx = doorGap(LW, gateW);
    seg(-LW / 2, LD / 2 - 0.1, gx[0], LD / 2 - 0.1); seg(gx[1], LD / 2 - 0.1, LW / 2, LD / 2 - 0.1);
    for (const [ax, az, bx, bz] of [[-LW / 2, -LD / 2, LW / 2, -LD / 2], [-LW / 2, -LD / 2, -LW / 2, LD / 2], [LW / 2, -LD / 2, LW / 2, LD / 2], [-LW / 2, LD / 2 - 0.1, gx[0], LD / 2 - 0.1], [gx[1], LD / 2 - 0.1, LW / 2, LD / 2 - 0.1]]) {
      const cxl = (ax + bx) / 2, czl = (az + bz) / 2, L = Math.hypot(bx - ax, bz - az), P = B.P([cxl, 0, czl]);
      extras.push({ t: 'box', p: P, hx: Math.abs(bx - ax) > 0.1 ? L / 2 : 0.1, hz: Math.abs(bx - ax) > 0.1 ? 0.1 : L / 2, r, h: wallH });
    }
  }
  // parking spot in front yard
  const carSpot = rng() < 0.75 ? { p: B.P([doorGap(LW, gateW)[0] + gateW / 2 + 0.2, 0, LD / 2 - 3.0]), r: r + (rng() < 0.5 ? 0 : Math.PI) } : null;
  if (carSpot && rng() < 0.35) { // aluminium carport
    B.frame(...carSpot.p, r);
    for (const [sx, sz] of [[-1.35, -2.3], [-1.35, 2.3]]) B.box('alu', sx, 0, sz, 0.1, 2.3, 0.1, { color: [0.6, 0.55, 0.5] });
    B.box('alu', -0.1, 2.3, 0, 2.9, 0.12, 5.2, { color: [0.6, 0.55, 0.5], skip: 'py ny' });
    extras.push({ t: 'poly', p: B.P([-0.1, 2.36, 0]), r, w: 2.8, d: 5.1 });
  }
  return { carSpot, doorX: hx + doorX, planters: rng() < 0.6, hx, hz, W, D, H: roofTop, shedSide, hasWall, wallH, gate: doorGap(LW, gateW) };
}
function doorGap(LW, gw) { return [LW / 2 - 0.5 - gw, LW / 2 - 0.5]; }

// Two/three-storey shop building fronting a street, flat roof with parapet. Frame: +Z faces street.
export function shopBuilding(B, s, rng, extras) {
  const { x, y, z, r, w, d } = s;
  B.frame(x, y, z, r);
  const floors = 2 + (rng() < 0.4 ? 1 : 0), fh = 3.1, H = floors * fh;
  const mat = pick(rng, ['tiles', 'tiles', 'stucco', 'plaster', 'siding']), wc = jitter(rng, pick(rng, WALL_TINTS), 0.06);
  B.box(mat, 0, 0, 0, w - 0.1, H, d, { color: wc, skip: 'ny', uv: mat === 'tiles' ? 2.5 : 3 });
  B.box('concrete', 0, H, 0, w - 0.1, 0.5, d, { skip: 'ny', color: wc.map(v => v * 0.85), uv: 3 }); // parapet
  B.box('concrete', 0, H + 0.02, 0, w - 0.6, 0.4, d - 0.5, { skip: 'ny', color: [0.5, 0.5, 0.5] });
  // ground floor shopfront
  const open = rng() < 0.3, fz = d / 2 + 0.01;
  // the shop's trade is fixed up front (from its position) so the sign and the interior agree
  const tradeIdx = Math.floor(mulberry32(Math.floor(x * 131 + z * 71) | 0)() * SHOP_NAMES.length), interior = (SHOP_INTERIOR[tradeIdx] + 0.5) / 8;
  if (open) { // rolled-down shutter (closed shop)
    B.quad('shutter', [-w / 2 + 0.4, 0, fz], [w / 2 - 0.4, 0, fz], [w / 2 - 0.4, 2.6, fz], [-w / 2 + 0.4, 2.6, fz], { color: jitter(rng, [0.72, 0.74, 0.74], 0.08), uv: 1.2 });
    B.box('alu', 0, 2.6, fz + 0.1, w - 0.6, 0.35, 0.3, { color: [0.7, 0.7, 0.7] });
  } else {
    B.quad('shopWindow', [-w / 2 + 0.4, 0.15, fz], [w / 2 - 0.4, 0.15, fz], [w / 2 - 0.4, 2.7, fz], [-w / 2 + 0.4, 2.7, fz], { color: [1, 0.95, interior], uvs: [[0, 0], [1, 0], [1, 1], [0, 1]] });
    for (let i = 0; i <= 3; i++) B.box('alu', -w / 2 + 0.4 + i * (w - 0.8) / 3, 0, fz + 0.02, 0.06, 2.75, 0.06);
    B.box('alu', 0, 2.7, fz + 0.02, w - 0.8, 0.08, 0.06);
    const nx = (deco() - 0.5) * (w - 3.5);
    if (deco() < 0.6) { // noren: split cloth curtain over the doorway
      const nc = pick(deco, [[0.14, 0.22, 0.48], [0.78, 0.18, 0.15], [0.96, 0.94, 0.88], [0.22, 0.48, 0.36], [0.5, 0.25, 0.42], [0.95, 0.62, 0.2]]);
      B.box('wood', nx, 2.58, fz + 0.12, 1.95, 0.05, 0.05, { color: [0.45, 0.32, 0.22] });
      for (let k = 0; k < 3; k++) { const x0 = nx - 0.9 + k * 0.61, x1 = x0 + 0.57; B.quad('plain', [x0, 1.95, fz + 0.14], [x1, 1.95, fz + 0.14], [x1, 2.58, fz + 0.14], [x0, 2.58, fz + 0.14], { color: nc }); }
    }
    if (deco() < 0.45) for (const sd of [-1, 1]) { const lx = nx + sd * 1.35; B.box('dark', lx, 2.45, fz + 0.3, 0.02, 0.2, 0.02); chochin(B, lx, 1.95, fz + 0.3, deco() < 0.8 ? [1, 0.28, 0.18] : [1, 0.85, 0.6], 0.95); }
  }
  // awning
  if (rng() < 0.55) {
    const ac = pick(rng, [[0.85, 0.2, 0.18], [0.2, 0.55, 0.35], [0.22, 0.38, 0.75], [0.98, 0.7, 0.2], [0.9, 0.45, 0.6], [0.3, 0.65, 0.7]]);
    B.quad('plain', [-w / 2 + 0.3, 2.95, fz], [w / 2 - 0.3, 2.95, fz], [w / 2 - 0.3, 2.65, fz + 1.1], [-w / 2 + 0.3, 2.65, fz + 1.1], { color: ac });
    B.quad('plain', [-w / 2 + 0.3, 2.65, fz + 1.1], [w / 2 - 0.3, 2.65, fz + 1.1], [w / 2 - 0.3, 2.95, fz], [-w / 2 + 0.3, 2.95, fz], { color: ac.map(v => v * 0.6) });
  }
  const sign = shopSign(rng, w - 1.2, tradeIdx); const sp = B.P([0, 3.45, fz + 0.03]); sign.position.set(...sp); sign.rotation.y = r; scene.add(sign);
  if (rng() < 0.5) { const vs = verticalSign(rng, tradeIdx), vp = B.P([w / 2 - 0.5, 5.2, fz + 0.45]); vs.position.set(...vp); vs.rotation.y = r + Math.PI / 2; scene.add(vs); }
  // upper floors
  for (let f = 1; f < floors; f++) {
    const n = Math.max(1, Math.floor(w / 2.4));
    for (let k = 0; k < n; k++) windowOn(B, ((k + 0.5) / n - 0.5) * (w - 1), f * fh + 0.9, 1.4, 1.3, rng, { z: d / 2 + 0.02, shutterBox: rng() < 0.3 });
  }
  if (rng() < 0.5) { B.box('plain', -w / 2 + 1, H + 0.5, -d / 4, 0.8, 0.6, 0.3, { color: [0.93, 0.93, 0.9] }); }
  // back and side walls: living quarters above the shop, service door, AC units, drain pipe
  const F0 = B.F;
  for (const [fr, off, fw] of [[Math.PI, d / 2, w], [Math.PI / 2, w / 2, d], [-Math.PI / 2, w / 2, d]]) {
    B.F = F0; B.frame(...B.P([Math.sin(fr) * off, 0, Math.cos(fr) * off]), r + fr);
    const back = fr === Math.PI;
    for (let f = back ? 0 : 1; f < floors; f++) {
      const n = back ? Math.max(1, Math.floor(fw / 3)) : (rng() < 0.5 ? 1 : 2);
      for (let k = 0; k < n; k++) if (rng() < (back ? 0.85 : 0.6)) windowOn(B, ((k + 0.5) / n - 0.5) * (fw - 1.6), f * fh + (f ? 0.9 : 1.1), 0.9, f ? 1.1 : 0.8, rng, { grille: f === 0 });
    }
    if (back) {
      B.box('metal', fw / 2 - 1.3, 0, 0.03, 0.9, 2.0, 0.06, { color: jitter(rng, [0.55, 0.57, 0.58], 0.1) });
      if (rng() < 0.8) B.box('plain', -fw / 4, 0.1, 0.35, 0.8, 0.6, 0.28, { color: [0.93, 0.93, 0.9] });
      if (floors > 2 && rng() < 0.6) B.box('plain', fw / 4, fh + 0.2, 0.35, 0.8, 0.6, 0.28, { color: [0.93, 0.93, 0.9] });
      B.box('plain', -fw / 2 + 0.35, 0, 0.1, 0.1, H + 0.4, 0.1, { color: [0.62, 0.62, 0.6] });
    }
  }
  B.F = F0;
  if (deco() < 0.4) { // rooftop water tank on a steel stand
    const tc = pick(deco, [[0.92, 0.92, 0.9], [0.4, 0.6, 0.82], [0.85, 0.86, 0.88]]), tx = (deco() - 0.5) * (w - 3), tz = -d / 4;
    for (const [sx, sz] of [[-0.55, -0.55], [0.55, -0.55], [-0.55, 0.55], [0.55, 0.55]]) B.box('alu', tx + sx, H + 0.02, tz + sz, 0.08, 0.7, 0.08, { color: [0.5, 0.5, 0.52] });
    B.cyl('plastic', tx, H + 0.72, tz, 0.72, 0.72, 1.2, 16, { color: tc });
    B.cyl('plastic', tx, H + 1.92, tz, 0.72, 0.28, 0.26, 16, { color: tc, cap: true });
  }
  lampPoints.push({ p: B.P([0, 2.9, fz + 0.8]), s: 0.8 });
  extras.push({ t: 'box', p: B.P([0, 0, 0]), hx: w / 2, hz: d / 2, r });
}

// Convenience store: single storey, glass front, coloured stripes, bright interior at all hours.
export function konbini(B, s, rng, extras) {
  const { x, y, z, r, w, d } = s;
  B.frame(x, y, z, r);
  B.box('stucco', 0, 0, 0, w, 4.2, d, { color: [0.97, 0.97, 0.96], skip: 'ny', uv: 3 });
  const stripes = [[0.05, 0.55, 0.3], [0.95, 0.95, 0.95], [0.1, 0.35, 0.75], [0.95, 0.95, 0.95], [0.95, 0.55, 0.1]];
  stripes.forEach((c, i) => B.box('plain', 0, 3.2 + i * 0.16, 0, w + 0.04, 0.16, d + 0.04, { color: c, skip: 'ny py' }));
  const fz = d / 2 + 0.03;
  B.quad('shopWindow', [-w / 2 + 0.5, 0.1, fz], [w / 2 - 0.5, 0.1, fz], [w / 2 - 0.5, 2.9, fz], [-w / 2 + 0.5, 2.9, fz], { color: [1.4, 1.45, 0.0625], uvs: [[0, 0], [1, 0], [1, 1], [0, 1]] });
  for (let i = 0; i <= 6; i++) B.box('alu', -w / 2 + 0.5 + i * (w - 1) / 6, 0, fz, 0.08, 2.95, 0.08);
  const sign = signMesh(6, 1.0, (g, W, H) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#0a8a4b'; g.fillRect(0, 0, W, H * 0.22); g.fillStyle = '#1a5fb4'; g.fillRect(0, H * 0.78, W, H * 0.22);
    g.fillStyle = '#0a4f8f'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `bold ${H * 0.42}px Arial`; g.fillText('SUNNY MART', W / 2, H * 0.52);
  }, 1.2);
  sign.position.set(...B.P([0, 3.6, fz + 0.02])); sign.rotation.y = r; scene.add(sign);
  lampPoints.push({ p: B.P([0, 2.6, fz + 2]), s: 1.4 }, { p: B.P([-w / 3, 2.6, fz + 2]), s: 1.2 }, { p: B.P([w / 3, 2.6, fz + 2]), s: 1.2 });
  extras.push({ t: 'box', p: B.P([0, 0, 0]), hx: w / 2, hz: d / 2, r });
}

// Five-storey apartment block (mansion) with balconies facing +Z.
export function apartment(B, s, rng, extras) {
  const { x, y, z, r, w, d } = s;
  B.frame(x, y, z, r);
  const floors = 5, fh = 2.95, H = floors * fh + 0.3;
  B.box('tiles', 0, 0, 0, w, H, d, { color: jitter(rng, [0.92, 0.88, 0.8], 0.05), skip: 'ny', uv: 2.5 });
  B.box('concrete', 0, H, 0, w, 0.6, d, { color: [0.8, 0.78, 0.74], skip: 'ny', uv: 3 });
  const units = Math.floor(w / 6.2);
  for (let f = 0; f < floors; f++) for (let u = 0; u < units; u++) {
    const cx = ((u + 0.5) / units - 0.5) * w, fy = 0.3 + f * fh;
    const lit = rng() < 0.45;
    B.quad('window', [cx - 1.6, fy + 0.05, d / 2 + 0.01], [cx + 1.6, fy + 0.05, d / 2 + 0.01], [cx + 1.6, fy + 2.1, d / 2 + 0.01], [cx - 1.6, fy + 2.1, d / 2 + 0.01],
      { color: lit ? jitter(rng, [1, 0.88, 0.7], 0.12) : [1, 1, 1], uvs: [[0, 0], [1, 0], [1, 1], [0, 1]] });
    {
      B.box('concrete', cx, fy - 0.15, d / 2 + 0.7, 6.0, 0.18, 1.4, { color: [0.85, 0.84, 0.82] });
      B.box('plastic', cx, fy + 0.03, d / 2 + 1.38, 5.9, 1.05, 0.05, { color: [0.78, 0.8, 0.8] }); // frosted balcony panel
      B.box('concrete', cx + 3.0, fy, d / 2 + 0.7, 0.12, fh - 0.2, 1.4, { color: [0.85, 0.84, 0.82] });
      if (rng() < 0.3) B.box('plain', cx - 2.2, fy + 0.05, d / 2 + 0.5, 0.8, 0.6, 0.28, { color: [0.93, 0.93, 0.9] });
    }
  }
  // corridor side (back): open walkways
  for (let f = 1; f < floors; f++) B.box('concrete', 0, 0.3 + f * fh - 0.15, -d / 2 - 0.8, w, 0.16, 1.6, { color: [0.8, 0.8, 0.78] });
  for (let f = 1; f < floors; f++) B.box('concrete', 0, 0.3 + f * fh, -d / 2 - 1.55, w, 1.1, 0.12, { color: [0.86, 0.85, 0.82] });
  B.box('metal', w / 2 - 3, H + 0.6, 0, 2.2, 1.8, 2.2, { color: [0.85, 0.85, 0.82] }); // roof water tank
  for (let f = 0; f < floors; f++) lampPoints.push({ p: B.P([0, 0.3 + f * fh + 2.2, -d / 2 - 1.2]), s: 0.4 });
  extras.push({ t: 'box', p: B.P([0, 0, 0]), hx: w / 2, hz: d / 2, r });
}

// Shinto shrine gate + small hall + stone lanterns. Frame +Z faces the approach.
export function shrine(B, x, y, z, r, extras) {
  B.frame(x, y, z, r);
  const red = [0.78, 0.16, 0.08];
  for (const sx of [-1.8, 1.8]) B.cyl('plain', sx, 0, 0, 0.2, 0.18, 4.4, 12, { color: red });
  B.box('plain', 0, 3.55, 0, 4.6, 0.3, 0.3, { color: red });
  B.beam('plain', [-2.9, 4.45, 0], [2.9, 4.45, 0], 0.42, 0.28, { color: red });
  B.beam('dark', [-3.0, 4.7, 0], [3.0, 4.7, 0], 0.46, 0.2);
  B.box('dark', 0, 3.85, 0, 0.45, 0.55, 0.12);
  for (const sx of [-1.8, 1.8]) extras.push({ t: 'circle', p: B.P([sx, 0, 0]), r: 0.25 });
  for (const [lx, lz] of [[-2.5, -6], [2.5, -6], [-2.5, -14], [2.5, -14]]) {
    B.box('stone', lx, 0, lz, 0.7, 0.3, 0.7, { color: [0.7, 0.7, 0.68] });
    B.cyl('stone', lx, 0.3, lz, 0.14, 0.12, 0.9, 8, { color: [0.7, 0.7, 0.68] });
    B.box('stone', lx, 1.2, lz, 0.55, 0.45, 0.55, { color: [0.72, 0.72, 0.7] });
    B.box('lamp', lx, 1.3, lz, 0.3, 0.25, 0.56);
    B.box('stone', lx, 1.65, lz, 0.85, 0.18, 0.85, { color: [0.7, 0.7, 0.68] });
    extras.push({ t: 'circle', p: B.P([lx, 0, lz]), r: 0.45 });
  }
  // hall
  B.frame(...B.P([0, 0, -24]), r);
  B.box('stone', 0, 0, 0, 8, 0.6, 7, { color: [0.7, 0.7, 0.68], skip: 'ny' });
  B.box('wood', 0, 0.6, 0, 6, 3.2, 5, { color: [0.62, 0.45, 0.32], skip: 'ny', uv: 2 });
  for (const sx of [-2.9, 2.9]) for (const sz of [-2.4, 2.4]) B.cyl('plain', sx, 0.6, sz, 0.14, 0.14, 3.2, 8, { color: [0.45, 0.3, 0.2] });
  gableRoof(B, 'roofTile', 6, 5, 3.8, 32 * Math.PI / 180, 1.2, [0.3, 0.36, 0.5]);
  B.box('plain', 0, 3.4, 2.55, 0.8, 0.9, 0.06, { color: [0.95, 0.93, 0.85] });
  extras.push({ t: 'box', p: B.P([0, 0, 0]), hx: 4, hz: 3.5, r });
}

// ---------------------------------------------------------------- bicycles (mamachari with front basket), instanced
let bikeGeo = null;
function bicycleGeometry() {
  if (bikeGeo) return bikeGeo;
  const parts = [], add = (g, x, y, z, rx = 0, ry = 0, rz = 0) => { g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz); g.translate(x, y, z); parts.push(g.index ? g.toNonIndexed() : g); };
  for (const x of [-0.52, 0.52]) { add(new THREE.TorusGeometry(0.33, 0.022, 6, 24), x, 0.35, 0); add(new THREE.CylinderGeometry(0.012, 0.012, 0.62, 4), x, 0.35, 0, Math.PI / 2); }
  const tube = (a, b, r = 0.018) => { const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), L = d.length(); const g = new THREE.CylinderGeometry(r, r, L, 5); const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); g.applyQuaternion(q); g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2); parts.push(g.toNonIndexed()); };
  tube([-0.52, 0.35, 0], [-0.1, 0.42, 0]); tube([-0.1, 0.42, 0], [0.38, 0.8, 0]); tube([-0.1, 0.42, 0], [-0.22, 0.85, 0]); tube([-0.52, 0.35, 0], [-0.22, 0.85, 0]);
  tube([0.52, 0.35, 0], [0.38, 0.95, 0]); tube([0.38, 0.95, -0.25], [0.38, 0.95, 0.25], 0.012);
  add(new THREE.BoxGeometry(0.24, 0.06, 0.12), -0.24, 0.9, 0);
  add(new THREE.BoxGeometry(0.28, 0.22, 0.34), 0.62, 0.78, 0); // basket
  add(new THREE.BoxGeometry(0.5, 0.02, 0.12), -0.62, 0.66, 0);  // rear carrier
  const pos = [], nor = [];
  for (const g of parts) { pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array); }
  bikeGeo = new THREE.BufferGeometry();
  bikeGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); bikeGeo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return bikeGeo;
}
export function bicycles(list, rng) { // list: [{x,y,z,r}]
  const im = new THREE.InstancedMesh(bicycleGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.5 }), list.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), c = new THREE.Color();
  const cols = [[0.85, 0.85, 0.85], [0.1, 0.1, 0.1], [0.55, 0.1, 0.1], [0.2, 0.3, 0.55], [0.7, 0.7, 0.72], [0.95, 0.9, 0.8], [0.25, 0.4, 0.3]];
  list.forEach((b, i) => { e.set(0, b.r, (rng() - 0.5) * 0.08); q.setFromEuler(e); m.compose(new THREE.Vector3(b.x, b.y, b.z), q, new THREE.Vector3(1, 1, 1)); im.setMatrixAt(i, m); im.setColorAt(i, c.setRGB(...cols[Math.floor(rng() * cols.length)])); });
  im.castShadow = true; im.receiveShadow = true; scene.add(im);
  return im;
}
export function clockPole(B, x, y, z) {
  B.frame(x, y, z, 0);
  B.cyl('metal', 0, 0, 0, 0.07, 0.06, 3.6, 8, { color: [0.3, 0.32, 0.33] });
  const face = canvasTex(256, 256, (g, W, H) => {
    g.fillStyle = '#fbfbf6'; g.beginPath(); g.arc(W / 2, H / 2, 120, 0, 7); g.fill(); g.strokeStyle = '#333'; g.lineWidth = 8; g.stroke();
    g.fillStyle = '#222'; for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; g.fillRect(W / 2 + Math.sin(a) * 100 - 4, H / 2 - Math.cos(a) * 100 - 10, 8, 20); }
    g.lineCap = 'round'; g.lineWidth = 9; g.beginPath(); g.moveTo(W / 2, H / 2); g.lineTo(W / 2 + 50, H / 2 + 30); g.stroke();
    g.lineWidth = 6; g.beginPath(); g.moveTo(W / 2, H / 2); g.lineTo(W / 2 - 20, H / 2 - 88); g.stroke();
  });
  const m = new THREE.MeshStandardMaterial({ map: face, transparent: true, alphaTest: 0.5, roughness: 0.3, side: THREE.DoubleSide });
  const d = new THREE.Mesh(new THREE.CircleGeometry(0.42, 32), m); d.position.set(x, y + 3.9, z); scene.add(d);
  const d2 = d.clone(); d2.rotation.y = Math.PI; d2.position.z -= 0.02; scene.add(d2);
  addCircle(x, z, 0.12);
}
