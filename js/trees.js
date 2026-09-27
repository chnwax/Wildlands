// Ghibli-style trees, built to be shaded by the toon lighting rather than to look scanned:
//  - conifers: stacked solid cone tiers with scalloped, drooping, irregular rims (clean painted silhouettes, no alpha
//    cut-outs). Several growth forms — young firs branched to the ground, mature spruces, tall spires, old giants with
//    high ragged crowns and thick trunks, umbrella pines, clipped garden pines — each in a few seeded variants.
//  - dead trees: standing snags and snapped trunks with stub branches; fallen logs; twigs on the forest floor
//  - broadleaf trees: a crown of lumpy solid blobs wrapped in a fringe of leaf cards for a leafy outline (round
//    broadleaf, spreading oak / camphor, airy birch, vase-shaped zelkova, layered maple, weeping willow, sakura, bamboo)
// Normals are smoothed toward each blob / the whole crown, so every tree reads as a soft painted shape with one bright
// sunlit side and one cool shaded side.
import { THREE, S, Q, mulberry32, lerp, clamp, phTex, Scatter, addCircle } from './core.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { windPatch } from './terrain.js';
import { CLOUD_SHADE_GLSL } from './clouds.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const TAU = Math.PI * 2;

// ---------------------------------------------------------------- painted leaf textures (white: tinted per tree)
// round: a clump of overlapping round leaves; lance: sprays of long narrow drooping leaves (bamboo, willow);
// maple: palmate five-lobed leaves
const leafTexs = {};
function leafTexture(kind = 'round') {
  if (leafTexs[kind]) return leafTexs[kind];
  const N = 256, cv = document.createElement('canvas'); cv.width = cv.height = N;
  const g = cv.getContext('2d'), rng = mulberry32({ round: 11, lance: 12, maple: 13 }[kind] || 11);
  g.translate(N / 2, N / 2);
  const shadeAt = y => lerp(175, 255, 0.5 - 0.5 * y / (N * 0.36)) * (0.9 + rng() * 0.1);
  if (kind === 'lance') {
    for (let i = 0; i < 95; i++) {
      const r = Math.sqrt(rng()) * N * 0.34, a = rng() * TAU, x = Math.cos(a) * r, y = Math.sin(a) * r * 0.9 - N * 0.04;
      const s = Math.round(shadeAt(y)); g.fillStyle = `rgb(${s},${s},${s})`;
      g.save(); g.translate(x, y); g.rotate((rng() - 0.5) * 1.5); // mostly hanging down
      const L = N * (0.13 + rng() * 0.08), W = L * (0.12 + rng() * 0.05);
      g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(W, L * 0.4, 0, L); g.quadraticCurveTo(-W, L * 0.4, 0, 0); g.fill();
      g.restore();
    }
  } else if (kind === 'maple') {
    for (let i = 0; i < 70; i++) {
      const r = Math.sqrt(rng()) * N * 0.35, a = rng() * TAU, x = Math.cos(a) * r, y = Math.sin(a) * r;
      const s = Math.round(shadeAt(y)); g.fillStyle = `rgb(${s},${s},${s})`;
      g.save(); g.translate(x, y); g.rotate(rng() * TAU);
      const L = N * (0.05 + rng() * 0.025);
      g.beginPath();
      for (let k = 0; k <= 10; k++) { const aa = k / 10 * TAU, rr = k % 2 ? L * 0.42 : L * (k === 0 || k === 10 ? 1.05 : 0.9); g.lineTo(Math.sin(aa) * rr, -Math.cos(aa) * rr); }
      g.closePath(); g.fill(); g.restore();
    }
  } else {
    for (let i = 0; i < 90; i++) {
      const r = Math.sqrt(rng()) * N * 0.36, a = rng() * TAU, x = Math.cos(a) * r, y = Math.sin(a) * r;
      const s = Math.round(shadeAt(y)); g.fillStyle = `rgb(${s},${s},${s})`;
      g.save(); g.translate(x, y); g.rotate(rng() * TAU);
      const L = N * (0.07 + rng() * 0.04), W = L * (0.62 + rng() * 0.2);
      g.beginPath(); g.moveTo(0, -L); g.quadraticCurveTo(W, -L * 0.1, 0, L); g.quadraticCurveTo(-W, -L * 0.1, 0, -L); g.fill();
      g.restore();
    }
  }
  // an opaque white patch in the corner: the crown's solid blobs are drawn with the card material, sampling this one
  // texel (their UVs are constant, so no mip blending), which puts a whole broadleaf crown in a single draw
  g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#fff'; g.fillRect(0, 0, 12, 12);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.anisotropy = 4;
  return (leafTexs[kind] = t);
}

// a clump of little five-petal blossoms (sakura / hydrangea): white, tinted per tree; darker centres
const blossomTex = {};
function blossomTexture(kind) {
  if (blossomTex[kind]) return blossomTex[kind];
  const N = 256, cv = document.createElement('canvas'); cv.width = cv.height = N;
  const g = cv.getContext('2d'), rng = mulberry32(kind === 'hydra' ? 41 : 31);
  g.translate(N / 2, N / 2);
  const count = kind === 'hydra' ? 70 : 110, big = kind === 'hydra' ? 1.35 : 1;
  for (let i = 0; i < count; i++) {
    const r = Math.sqrt(rng()) * N * 0.37, a = rng() * Math.PI * 2, x = Math.cos(a) * r, y = Math.sin(a) * r;
    const s = Math.round(lerp(218, 255, 0.5 - 0.5 * y / (N * 0.37)) * (0.95 + rng() * 0.05));
    const R = N * (0.035 + rng() * 0.02) * big, rot = rng() * 6.28, petals = kind === 'hydra' ? 4 : 5;
    g.fillStyle = `rgb(${s},${s},${s})`;
    for (let p = 0; p < petals; p++) {
      const pa = rot + p / petals * Math.PI * 2;
      g.beginPath(); g.ellipse(x + Math.cos(pa) * R * 0.55, y + Math.sin(pa) * R * 0.55, R * 0.55, R * 0.38, pa, 0, 7); g.fill();
    }
    g.fillStyle = `rgb(${Math.round(s * 0.93)},${Math.round(s * 0.8)},${Math.round(s * 0.86)})`;
    g.beginPath(); g.arc(x, y, R * 0.16, 0, 7); g.fill();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.anisotropy = 4;
  return (blossomTex[kind] = t);
}

// painted bark for trunks without a photo scan: white birch with dark lenticels, green bamboo culms with nodes
const barkTexs = {};
function barkTexture(kind) {
  if (barkTexs[kind]) return barkTexs[kind];
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 128;
  const g = cv.getContext('2d'), rng = mulberry32(kind === 'bamboo' ? 5 : 3);
  if (kind === 'bamboo') {
    const gr = g.createLinearGradient(0, 0, 64, 0);
    gr.addColorStop(0, '#9a9a9a'); gr.addColorStop(0.45, '#f2f2f2'); gr.addColorStop(1, '#a6a6a6');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 128);
    g.fillStyle = 'rgba(70,70,70,0.9)'; g.fillRect(0, 120, 64, 5);    // node ring
    g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillRect(0, 117, 64, 3);
  } else {
    g.fillStyle = '#ecebe6'; g.fillRect(0, 0, 64, 128);
    for (let i = 0; i < 26; i++) { const y = rng() * 128, x = rng() * 64, w = 6 + rng() * 22, h = 1.5 + rng() * 2.5;
      g.fillStyle = `rgba(40,36,34,${0.55 + rng() * 0.4})`; g.fillRect(x, y, w, h); g.fillRect(x - 64, y, w, h); }
    for (let i = 0; i < 5; i++) { const y = rng() * 128; g.fillStyle = 'rgba(30,26,24,0.8)'; g.beginPath(); g.ellipse(rng() * 64, y, 5 + rng() * 5, 3, 0, 0, 7); g.fill(); }
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return (barkTexs[kind] = t);
}

// ---------------------------------------------------------------- geometry helpers
function meshBuilder() {
  const P = [], N = [], C = [], UV = [], I = [];
  return {
    v(p, n, ao, uv = [0, 0]) { P.push(p.x, p.y, p.z); N.push(n.x, n.y, n.z); if (Array.isArray(ao)) C.push(ao[0], ao[1], ao[2]); else C.push(ao, ao, ao); UV.push(uv[0], uv[1]); return P.length / 3 - 1; },
    tri(a, b, c) { I.push(a, b, c); },
    empty() { return I.length === 0; },
    geometry(withUV) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
      if (withUV) g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
      g.setIndex(I); g.computeBoundingSphere();
      return g;
    },
  };
}
function trunkGeo(pts, segs, vScale = 6) { // tapered tube along a polyline [{p, r}]
  const parts = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], len = a.p.distanceTo(b.p);
    const c = new THREE.CylinderGeometry(b.r, a.r, len, segs, 1, true);
    c.translate(0, len / 2, 0);
    c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), b.p.clone().sub(a.p).normalize()));
    c.translate(a.p.x, a.p.y, a.p.z);
    const uv = c.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * 2, uv.getY(k) * len * vScale);
    parts.push(c);
  }
  return mergeGeometries(parts);
}
const merge = list => { const l = list.filter(Boolean); return l.length ? (l.length > 1 ? mergeGeometries(l) : l[0]) : null; };
// smooth lumpy displacement on the unit sphere (same position -> same offset, so shared corners stay welded)
const lump = (d, s) => 0.11 * Math.sin(3.1 * d.x + s) * Math.sin(2.7 * d.y + 1.3 * s) * Math.sin(3.4 * d.z + 0.7 * s) + 0.05 * Math.sin(7.3 * d.x + 2.1 * d.z + s);

// ---------------------------------------------------------------- conifers: stacked scalloped cone tiers (height 1)
// base: where the lowest branches start (young trees are branched to the ground, old ones have long bare trunks);
// R0/R1: tier radius at the bottom / top; H0/top: tier height; irr: how ragged each tier's rim is; gaps: chance of a
// sparse tier; off: sideways wander of the tiers (asymmetric old crowns); lean: whole crown bent one way;
// tr: trunk [base radius, top radius, top height]
const CONIFER = {
  young:  { base: 0.03, K: 6, R0: 0.36, R1: 0.11, H0: 0.32, top: 0.25, irr: 0.08, off: 0.004, droop: 0.15, tr: [0.03, 0.012, 0.45] },
  spruce: { base: 0.2, K: 7, R0: 0.28, R1: 0.09, H0: 0.3, top: 0.24, irr: 0.17, off: 0.012, droop: 0.15, tr: [0.03, 0.014, 0.58] },
  tall:   { base: 0.3, K: 8, R0: 0.19, R1: 0.07, H0: 0.26, top: 0.2, irr: 0.15, off: 0.01, droop: 0.12, tr: [0.027, 0.012, 0.62] },
  old:    { base: 0.42, K: 7, R0: 0.25, R1: 0.09, H0: 0.24, top: 0.21, irr: 0.38, off: 0.035, gaps: 0.35, droop: 0.16, lean: 0.03, tr: [0.046, 0.02, 0.8], flare: 1.45, bend: 0.018 },
};
function coniferTiers(form, seed) {
  const P = CONIFER[form], rng = mulberry32(seed), tiers = [], la = rng() * TAU, K = P.K;
  for (let k = 0; k < K; k++) {
    const f = K > 1 ? k / (K - 1) : 0;
    let R = lerp(P.R0, P.R1, f) * (1 + (rng() - 0.5) * P.irr * 0.8);
    if (P.gaps && k > 0 && k < K - 1 && rng() < P.gaps) R *= 0.62;
    const oa = rng() * TAU, om = P.off * rng() * (0.4 + f), lean = (P.lean || 0) * f;
    tiers.push({ f, R, H: lerp(P.H0, P.top, f), yb: lerp(P.base, 1 - P.top, Math.pow(f, 0.95)), droop: P.droop,
      ox: Math.cos(oa) * om + Math.cos(la) * lean, oz: Math.sin(oa) * om + Math.sin(la) * lean,
      rot: rng() * TAU, p1: rng() * TAU, p2: rng() * TAU, p3: rng() * TAU, amp: P.irr * (0.5 + rng()) });
  }
  return { tiers, la };
}
// pines: a tall trunk carrying a few flattened, ragged pads near the top (umbrella crown); jpine: a clipped garden pine
// with cloud-pruned pads on a leaning, twisting trunk
function pineTiers(form, seed) {
  const rng = mulberry32(seed), tiers = [], limbs = [], garden = form === 'jpine';
  const n = garden ? 6 : 8, la = rng() * TAU;
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1), top = i === n - 1;
    const y = garden ? lerp(0.32, 0.86, f) : lerp(0.5, 0.9, Math.pow(f, 0.8));
    const a = rng() * TAU, r = top ? 0.02 : garden ? 0.12 + rng() * 0.16 : 0.05 + rng() * 0.13 * (1 - f * 0.5);
    const R = garden ? lerp(0.15, 0.09, f) * (0.8 + rng() * 0.4) : lerp(0.23, 0.1, f) * (0.8 + rng() * 0.45);
    const lean = (garden ? 0.16 : 0.05) * f;
    const ox = Math.cos(a) * r + Math.cos(la) * lean, oz = Math.sin(a) * r + Math.sin(la) * lean;
    tiers.push({ f, R, H: R * (garden ? 0.55 : 0.62), yb: y, droop: garden ? 0.05 : 0.1, ox, oz, rot: rng() * TAU, p1: rng() * TAU, p2: rng() * TAU, p3: rng() * TAU, amp: garden ? 0.12 : 0.28 });
    limbs.push(V(ox * 0.85, y + 0.02, oz * 0.85));
  }
  return { tiers, limbs, la, garden };
}
function tierMesh(B, t, SEG, under, crownC) {
  const { R, H, yb, ox, oz } = t, ya = yb + H, shade = 0.78 + 0.22 * t.f;
  const n = V(0, 0, 0), p = V(0, 0, 0);
  const apex = B.v(V(ox, ya, oz), V(0, 1, 0), shade);
  const mid = [], rim = [], und = [];
  for (let i = 0; i <= SEG; i++) {
    const a = t.rot + i / SEG * TAU, cx = Math.cos(a), cz = Math.sin(a);
    const tip = i % 2 === 0, w = 1 + t.amp * (0.55 * Math.sin(2 * a + t.p1) + 0.35 * Math.sin(3 * a + t.p2) + 0.2 * Math.sin(5 * a + t.p3));
    const jag = 1 + 0.05 * Math.sin(7 * a + t.p3 * 3);
    const rm = R * 0.58 * w * jag, ym = ya - H * 0.5;
    const rr = R * (tip ? 1.06 : 0.86) * w * jag, yr = yb - (tip ? R * t.droop : -R * 0.02);
    const coneN = (r, y) => n.set(cx * H, R * 0.9, cz * H).normalize().add(p.set(cx * r + ox - crownC.x, y - crownC.y, cz * r + oz - crownC.z).normalize().multiplyScalar(0.35)).normalize().clone();
    mid.push(B.v(V(ox + cx * rm, ym, oz + cz * rm), coneN(rm, ym), shade * 0.95));
    rim.push(B.v(V(ox + cx * rr, yr, oz + cz * rr), coneN(rr, yr), shade * (tip ? 1.05 : 0.92)));
    if (under) und.push(B.v(V(ox + cx * rr * 0.98, yr + 0.002, oz + cz * rr * 0.98), V(cx * 0.3, -1, cz * 0.3).normalize(), 0.45 + 0.15 * t.f));
  }
  const inner = under ? B.v(V(ox, yb + H * 0.3, oz), V(0, -1, 0), 0.35) : -1;
  for (let i = 0; i < SEG; i++) {
    B.tri(apex, mid[i + 1], mid[i]);
    B.tri(mid[i], mid[i + 1], rim[i]); B.tri(mid[i + 1], rim[i + 1], rim[i]);
    if (under) B.tri(inner, und[i], und[i + 1]);
  }
}
// lod: 0 near, 1 mid, 2 far (a few plain tiers, a tenth of the triangles; same silhouette)
export function coniferGeo(lod = 0, seed = 3, form = 'spruce') {
  const pine = form === 'pine' || form === 'jpine';
  const { tiers: all, la, limbs, garden } = pine ? pineTiers(form, seed) : coniferTiers(form, seed);
  const P = pine ? null : CONIFER[form];
  let tiers = all;
  if (lod > 0 && !pine) { // fewer, taller tiers that cover the same span
    const k = lod === 1 ? Math.ceil(all.length * 0.6) : 3;
    tiers = []; for (let i = 0; i < k; i++) { const t = all[Math.round(i * (all.length - 1) / (k - 1))]; tiers.push({ ...t, H: t.H * (lod === 1 ? 1.25 : 1.4), amp: t.amp * (lod === 2 ? 0.6 : 1) }); }
  } else if (lod === 2) tiers = all.filter((t, i) => i % 2 === 0 || i === all.length - 1);
  const B = meshBuilder(), SEG = [16, 9, 6][lod];
  const lowY = Math.min(...tiers.map(t => t.yb)), crownC = V(0, (lowY + 1) / 2, 0);
  for (const t of tiers) tierMesh(B, t, SEG, lod < 2, crownC);
  const solid = B.geometry(false);
  // trunk: runs up into the crown; old trees flare at the root and bend a little
  const segs = [9, 5, 3][lod];
  let trunk;
  if (pine) {
    const bend = garden ? 0.1 : 0.03, bx = Math.cos(la), bz = Math.sin(la);
    const top = garden ? 0.8 : 0.9;
    const pts = [{ p: V(0, 0, 0), r: garden ? 0.05 : 0.036 }, { p: V(-bx * bend * 0.5, top * 0.35, -bz * bend * 0.5), r: garden ? 0.04 : 0.029 },
      { p: V(bx * bend, top * 0.7, bz * bend), r: garden ? 0.03 : 0.02 }, { p: V(bx * bend * 1.6, top, bz * bend * 1.6), r: 0.01 }];
    const parts = [trunkGeo(pts, segs)];
    if (lod < 2) for (const L of limbs) { const y0 = Math.min(L.y - 0.06, top * 0.95), f = y0 / top, sx = bx * bend * f * 1.2, sz = bz * bend * f * 1.2;
      parts.push(trunkGeo([{ p: V(sx, y0, sz), r: garden ? 0.016 : 0.011 }, { p: L, r: 0.005 }], lod ? 3 : 4)); }
    trunk = merge(parts);
  } else {
    const [r0, r1, top] = P.tr, b = P.bend || 0, bx = Math.cos(la) * b, bz = Math.sin(la) * b;
    const pts = [];
    if (P.flare) pts.push({ p: V(0, 0, 0), r: r0 * P.flare });
    pts.push({ p: V(0, P.flare ? 0.03 : 0, 0), r: r0 }, { p: V(bx, top * 0.5, bz), r: lerp(r0, r1, 0.55) }, { p: V(bx * 0.4, top, bz * 0.4), r: r1 });
    trunk = trunkGeo(pts, segs);
  }
  return { solid, trunk };
}
// far conifer for the outer rings: a few plain cone tiers (kept for the far forest outside the map)
export function coniferFarGeo(K = 3, SEG = 6) {
  const B = meshBuilder(), n = V(0, 0, 0);
  for (let k = 0; k < K; k++) {
    const f = K > 1 ? k / (K - 1) : 0;
    const yb = lerp(0.18, 0.72, f), R = lerp(0.3, 0.11, f), H = lerp(0.38, 0.28, f), ya = yb + H, shade = 0.78 + 0.22 * f, rot = k * 0.7;
    const apex = B.v(V(0, ya, 0), V(0, 1, 0), shade), rim = [];
    for (let i = 0; i <= SEG; i++) {
      const a = rot + i / SEG * Math.PI * 2, cx = Math.cos(a), cz = Math.sin(a);
      rim.push(B.v(V(cx * R, yb - R * 0.06, cz * R), n.set(cx * H, R * 0.9, cz * H).normalize().clone(), shade * 0.95));
    }
    for (let i = 0; i < SEG; i++) B.tri(apex, rim[i + 1], rim[i]);
  }
  return { solid: B.geometry(false) };
}

// ---------------------------------------------------------------- dead wood (bark only, tinted grey per tree)
// standing snag: a bare tapering trunk with stubs of broken branches; broken: the same trunk snapped off low with a
// splintered top
export function deadGeo(lod = 0, seed = 3, broken = false) {
  const rng = mulberry32(seed), la = rng() * TAU, bx = Math.cos(la), bz = Math.sin(la);
  const top = broken ? 0.42 + rng() * 0.18 : 0.96, segs = [7, 4, 3][lod];
  const lean = 0.015 + rng() * 0.03;
  const at = y => V(bx * lean * y * y, y, bz * lean * y * y);
  const r0 = broken ? 0.046 : 0.034, rT = broken ? 0.03 : 0.004;
  const pts = [{ p: V(0, 0, 0), r: r0 * 1.35 }, { p: V(0, 0.03, 0), r: r0 }, { p: at(top * 0.45), r: lerp(r0, rT, 0.4) }, { p: at(top), r: rT }];
  const parts = [trunkGeo(pts, segs)];
  if (broken) { // splinters standing up from the break
    const tp = at(top);
    for (let k = 0; k < (lod ? 2 : 4); k++) { const a = rng() * TAU, h = 0.03 + rng() * 0.06;
      parts.push(trunkGeo([{ p: V(tp.x + Math.cos(a) * rT * 0.5, tp.y - 0.01, tp.z + Math.sin(a) * rT * 0.5), r: rT * 0.45 }, { p: V(tp.x + Math.cos(a) * rT * 0.8, tp.y + h, tp.z + Math.sin(a) * rT * 0.8), r: 0.001 }], 3)); }
  }
  if (lod < 2) { // stub branches, shorter toward the top, drooping or kinked up
    const n = lod ? 5 : 11;
    for (let k = 0; k < n; k++) {
      const y = lerp(0.3, 0.94, k / n + rng() * 0.05) * (broken ? top / 0.96 : 1); if (y > top - 0.02) continue;
      const a = rng() * TAU, L = (0.05 + rng() * 0.1) * (1.1 - y * 0.8), dy = (rng() - 0.6) * L * 0.8, p0 = at(y);
      parts.push(trunkGeo([{ p: p0, r: 0.006 }, { p: V(p0.x + Math.cos(a) * L, p0.y + dy, p0.z + Math.sin(a) * L), r: 0.0015 }], 3));
    }
  }
  return { trunk: merge(parts) };
}
// a spray of fallen dead branches lying on the ground (unit: ~2 m across at scale 1)
export function twigGeo(lod = 0, seed = 5) {
  const rng = mulberry32(seed), parts = [];
  for (let k = 0; k < 3; k++) {
    const a = rng() * TAU, L = 0.7 + rng() * 1.1, x0 = (rng() - 0.5) * 0.6, z0 = (rng() - 0.5) * 0.6;
    const p0 = V(x0, 0.03, z0), p1 = V(x0 + Math.cos(a) * L, 0.03 + rng() * 0.04, z0 + Math.sin(a) * L);
    parts.push(trunkGeo([{ p: p0, r: 0.03 }, { p: p1, r: 0.008 }], 4, 2));
    for (let j = 0; j < 3; j++) { const t = 0.25 + rng() * 0.6, b = a + (rng() < 0.5 ? 1 : -1) * (0.4 + rng() * 0.6), l2 = L * (0.2 + rng() * 0.25), q = p0.clone().lerp(p1, t);
      parts.push(trunkGeo([{ p: q, r: 0.012 }, { p: V(q.x + Math.cos(b) * l2, q.y + rng() * 0.06, q.z + Math.sin(b) * l2), r: 0.003 }], 3, 2)); }
  }
  return { trunk: merge(parts) };
}
// fallen log: unit length along X, unit radius; bark with a mossy top (vertex colour), splintered stubs of branches
export function logGeo(lod = 0, seed = 7) {
  const rng = mulberry32(seed), segs = lod ? 6 : 10, n = lod ? 3 : 6;
  const g = new THREE.CylinderGeometry(1, 1, 1, segs, n, false);
  g.rotateZ(Math.PI / 2); // along X
  const pos = g.attributes.position, uv = g.attributes.uv, col = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), r = Math.hypot(y, z);
    const taper = 1 - (x + 0.5) * 0.35, sag = Math.sin((x + 0.5) * Math.PI) * 0.06;
    if (r > 0.01) { pos.setY(i, y * taper * (1 + 0.06 * Math.sin(x * 9 + z * 3)) + sag); pos.setZ(i, z * taper); }
    const up = r > 0.01 ? y / r : 0, moss = Math.max(0, up - 0.25) * 1.3;
    col.push(lerp(1, 0.55, moss), lerp(1, 0.95, moss), lerp(1, 0.5, moss));
    uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * 3);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const parts = [g];
  if (lod === 0) for (let k = 0; k < 3; k++) { const x = -0.3 + rng() * 0.6, a = rng() * TAU, stub = trunkGeo([{ p: V(x, Math.cos(a) * 0.8, Math.sin(a) * 0.8), r: 0.18 }, { p: V(x + 0.05, Math.cos(a) * 1.9, Math.sin(a) * 1.9), r: 0.04 }], 4, 1);
    const c = []; for (let i = 0; i < stub.attributes.position.count; i++) c.push(1, 1, 1); stub.setAttribute('color', new THREE.Float32BufferAttribute(c, 3)); parts.push(stub); }
  return { trunk: mergeGeometries(parts.map(p => p.index ? p : p)) };
}

// ---------------------------------------------------------------- blob crowns: lumpy solid blobs + card fringe (height ~1)
// shape: 'leaf' round broadleaf, 'oak' broad spreading crown (also camphor), 'birch' narrow airy crown, 'zelkova'
// vase-shaped street tree, 'maple' low layered dome, 'willow' weeping, 'sakura' wide umbrella crown on spreading dark
// branches, 'bush' / 'hydra' low shrubs, 'hedge' a clipped hedge block, 'ivy' a flat mat of leaves on a wall
function crownLayout(shape, hi, rng) {
  const blobs = [], B = (x, y, z, R, sc) => blobs.push({ c: V(x, y, z), R, s: rng() * 10, sc: sc || null });
  const ring = (n, rMin, rMax, yMin, yMax, RMin, RMax, sc) => { for (let i = 0; i < n; i++) { const a = i / n * TAU + rng() * 0.6, r = rMin + rng() * (rMax - rMin); B(Math.cos(a) * r, yMin + rng() * (yMax - yMin), Math.sin(a) * r, RMin + rng() * (RMax - RMin), sc); } };
  if (shape === 'sakura') { B(0, 0.74, 0, 0.22); ring(hi ? 8 : 4, 0.2, 0.34, 0.52, 0.68, 0.15, 0.21); return { crown: V(0, 0.6, 0), blobs }; }
  if (shape === 'bush' || shape === 'hydra') { B(0, 0.42, 0, 0.32); ring(hi ? 4 : 2, 0.2, 0.3, 0.26, 0.36, 0.22, 0.3); return { crown: V(0, 0.3, 0), blobs }; }
  if (shape === 'hedge') { for (let i = 0; i < 5; i++) B(lerp(-0.4, 0.4, i / 4), 0.46, (rng() - 0.5) * 0.05, 0.3, V(1, 1.65, 1.15)); return { crown: V(0, 0.45, 0), blobs }; }
  if (shape === 'ivy') { for (let i = 0; i < 6; i++) B(lerp(-0.4, 0.4, (i % 3) / 2) + (rng() - 0.5) * 0.12, i < 3 ? 0.3 : 0.7, 0, 0.24 + rng() * 0.06, V(1, 1.1, 0.1)); return { crown: V(0, 0.5, -0.6), blobs }; }
  if (shape === 'oak') { B(0, 0.78, 0, 0.21); ring(hi ? 8 : 4, 0.2, 0.33, 0.5, 0.74, 0.14, 0.2); return { crown: V(0, 0.64, 0), blobs }; }
  if (shape === 'birch') { const n = hi ? 7 : 4; for (let i = 0; i < n; i++) { const t = i / (n - 1), a = rng() * TAU, r = 0.04 + rng() * 0.07; B(Math.cos(a) * r, lerp(0.44, 0.9, t), Math.sin(a) * r, (0.1 + rng() * 0.04) * (1 - 0.3 * t)); } return { crown: V(0, 0.68, 0), blobs }; }
  if (shape === 'zelkova') { B(0, 0.85, 0, 0.19); ring(hi ? 8 : 4, 0.22, 0.35, 0.6, 0.8, 0.14, 0.19); return { crown: V(0, 0.72, 0), blobs }; }
  if (shape === 'maple') { B(0, 0.7, 0, 0.16); ring(hi ? 10 : 5, 0.14, 0.34, 0.42, 0.66, 0.11, 0.15); return { crown: V(0, 0.56, 0), blobs }; }
  if (shape === 'willow') { B(0, 0.8, 0, 0.19, V(1, 1.3, 1)); ring(hi ? 6 : 3, 0.12, 0.24, 0.6, 0.78, 0.14, 0.17, V(1, 1.5, 1)); return { crown: V(0, 0.66, 0), blobs }; }
  B(0, 0.84, 0, 0.2); ring(hi ? 6 : 3, 0.14, 0.22, 0.6, 0.8, 0.14, 0.2);
  return { crown: V(0, 0.7, 0), blobs };
}
// lod 0 near, 1 mid, 2 far (a few low-poly blobs, no cards or trunk), 3 one blob (distant hillsides)
export function broadleafGeo(lod = 0, seed = 7, shape = 'leaf') {
  if (lod === true) lod = 0; else if (lod === false) lod = 1;
  const hi = lod === 0, far = lod >= 2 ? lod - 1 : 0;
  const rng = mulberry32(seed), { crown, blobs: all } = crownLayout(shape, lod === 0, rng);
  const blobs = far ? all.slice(0, far > 1 ? 1 : 3).map((b, i) => far > 1 ? { c: V(0, crown.y + 0.06, 0), R: 0.3, s: b.s, sc: b.sc } : i ? b : { ...b, R: b.R * 1.25 }) : all;
  const ico = new THREE.IcosahedronGeometry(1, hi ? 2 : 1);
  const parts = [], d = V(0, 0, 0), q = V(0, 0, 0), nn = V(0, 0, 0);
  const clip = shape === 'hedge' ? [0.52, 0.9, 0.3] : null;
  for (const b of blobs) {
    const g = ico.clone(), pos = g.attributes.position, nor = g.attributes.normal, col = [];
    for (let i = 0; i < pos.count; i++) {
      d.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
      q.copy(d).multiplyScalar(b.R * (1 + lump(d, b.s)));
      if (b.sc) q.multiply(b.sc);
      q.add(b.c);
      if (clip) { q.x = clamp(q.x, -clip[0], clip[0]); q.y = Math.min(q.y, clip[1]); q.z = clamp(q.z, -clip[2], clip[2]); }
      pos.setXYZ(i, q.x, q.y, q.z);
      nn.copy(d).add(q.clone().sub(crown).normalize().multiplyScalar(0.7)).normalize();
      nor.setXYZ(i, nn.x, nn.y, nn.z);
      const ao = 0.5 + 0.5 * Math.min(1, Math.max(0, (q.y - crown.y + 0.25) / 0.5)) * (0.6 + 0.4 * Math.min(1, q.distanceTo(crown) / 0.3));
      col.push(ao, ao, ao);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.deleteAttribute('uv');
    parts.push(g);
  }
  const solid = mergeGeometries(parts);
  if (far) return { solid };
  // leaf cards stuck on the blob surfaces, facing out, sharing the blob's smooth normal
  const B = meshBuilder(), ax = V(0, 0, 0), ay = V(0, 0, 0);
  const mult = { sakura: 1.4, hydra: 1.2, birch: 1.3, hedge: 0.9, ivy: 1.6, maple: 1.1 }[shape] || 1;
  for (const b of blobs) {
    const cards = (hi ? 16 : 6) * mult | 0;
    for (let k = 0; k < cards; k++) {
      if (shape === 'ivy') d.set((rng() - 0.5) * 1.4, (rng() - 0.5) * 1.4, 0.6 + rng() * 0.4).normalize(); // leaves face out of the wall
      else d.set(rng() * 2 - 1, rng() * 1.6 - 0.5, rng() * 2 - 1).normalize();
      const off = d.clone().multiplyScalar(b.R * (0.9 + 0.12 * rng())); if (b.sc) off.multiply(b.sc);
      const c = b.c.clone().add(off), size = b.R * (0.75 + rng() * 0.3) * (shape === 'hedge' ? 0.8 : 1);
      if (clip) { c.x = clamp(c.x, -clip[0] - 0.03, clip[0] + 0.03); c.y = Math.min(c.y, clip[1] + 0.02); c.z = clamp(c.z, -clip[2] - 0.03, clip[2] + 0.03); }
      ax.set(0, 1, 0).cross(d); if (ax.lengthSq() < 1e-3) ax.set(1, 0, 0); ax.normalize().applyAxisAngle(d, rng() * 6.28);
      ay.copy(d).cross(ax).normalize();
      nn.copy(d).add(c.clone().sub(crown).normalize().multiplyScalar(0.7)).normalize();
      const ao = 0.6 + 0.4 * Math.min(1, Math.max(0, (c.y - crown.y + 0.25) / 0.5));
      const ids = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => B.v(c.clone().addScaledVector(ax, u * size * 0.5).addScaledVector(ay, v * size * 0.5), nn, ao, [(u + 1) / 2, (v + 1) / 2]));
      B.tri(ids[0], ids[1], ids[2]); B.tri(ids[0], ids[2], ids[3]);
    }
  }
  if (shape === 'ivy') { // trailing strands hanging from the top of the mat
    for (let k = 0; k < (hi ? 16 : 6); k++) {
      const x0 = (rng() - 0.5) * 1.0, y0 = 0.85 + rng() * 0.12, L = 0.2 + rng() * 0.4, w = 0.1 + rng() * 0.06;
      nn.set(0, 0.3, 1).normalize();
      const ids = [[-1, 0], [1, 0], [1, 1], [-1, 1]].map(([u, v]) => B.v(V(x0 + u * w * 0.5, y0 - L * (1 - v), 0.035), nn, 0.7 + 0.3 * v, [(u + 1) / 2, v]));
      B.tri(ids[0], ids[1], ids[2]); B.tri(ids[0], ids[2], ids[3]);
    }
  }
  if (shape === 'willow') { // hanging curtains of long leaves around the crown
    const n = hi ? 70 : 24;
    for (let k = 0; k < n; k++) {
      const a = rng() * TAU, r = 0.16 + rng() * 0.16, y0 = 0.58 + rng() * 0.22, L = 0.22 + rng() * 0.3, w = 0.07 + rng() * 0.05;
      const ox = Math.cos(a), oz = Math.sin(a), sx = -oz, sz = ox, x0 = ox * r, z0 = oz * r, out = 0.05 * L;
      nn.set(ox, 0.35, oz).normalize();
      const ao = 0.75;
      const ids = [[-1, 0], [1, 0], [1, 1], [-1, 1]].map(([u, v]) => B.v(V(x0 + sx * u * w * 0.5 + ox * out * (1 - v), y0 - L * (1 - v), z0 + sz * u * w * 0.5 + oz * out * (1 - v)), nn, ao * (0.8 + 0.2 * v), [(u + 1) / 2, v]));
      B.tri(ids[0], ids[1], ids[2]); B.tri(ids[0], ids[2], ids[3]);
    }
  }
  if (shape === 'bush' || shape === 'hydra' || shape === 'hedge' || shape === 'ivy') return { solid, cards: B.geometry(true), trunk: null };
  const tseg = hi ? 8 : 5, lseg = hi ? 5 : 3, ring = blobs.slice(1);
  let trunkParts;
  const limbs = (from, r0, list, reach = 0.85, lift = -0.04) => list.forEach(b => trunkParts.push(trunkGeo([{ p: from.clone(), r: r0 }, { p: V(b.c.x * 0.5, lerp(from.y, b.c.y, 0.55), b.c.z * 0.5), r: r0 * 0.6 }, { p: V(b.c.x * reach, b.c.y + lift, b.c.z * reach), r: r0 * 0.3 }], lseg)));
  if (shape === 'sakura') { // short stout trunk forking into dark spreading limbs that show under the blossom
    trunkParts = [trunkGeo([{ p: V(0, 0, 0), r: 0.05 }, { p: V(0.02, 0.22, 0), r: 0.04 }, { p: V(0, 0.34, 0.01), r: 0.034 }], tseg)];
    limbs(V(0, 0.32, 0), 0.022, ring.slice(0, hi ? 6 : 3), 0.9);
  } else if (shape === 'oak') {
    trunkParts = [trunkGeo([{ p: V(0, 0, 0), r: 0.058 }, { p: V(0, 0.03, 0), r: 0.045 }, { p: V(0.015, 0.26, 0), r: 0.036 }, { p: V(0, 0.42, 0.01), r: 0.03 }], tseg)];
    limbs(V(0, 0.38, 0), 0.022, ring.slice(0, hi ? 6 : 3), 0.8);
  } else if (shape === 'birch') {
    const lx = (rng() - 0.5) * 0.04;
    trunkParts = [trunkGeo([{ p: V(0, 0, 0), r: 0.022 }, { p: V(lx, 0.45, 0), r: 0.016 }, { p: V(lx * 0.3, 0.9, 0), r: 0.005 }], tseg)];
    if (hi) limbs(V(lx, 0.5, 0), 0.008, ring.slice(0, 4), 0.8);
  } else if (shape === 'zelkova') { // the trunk forks low into many ascending limbs
    trunkParts = [trunkGeo([{ p: V(0, 0, 0), r: 0.05 }, { p: V(0, 0.03, 0), r: 0.04 }, { p: V(0, 0.28, 0), r: 0.033 }], tseg)];
    limbs(V(0, 0.26, 0), 0.02, ring.slice(0, hi ? 8 : 4), 0.75, -0.08);
  } else if (shape === 'maple') {
    trunkParts = [trunkGeo([{ p: V(0, 0, 0), r: 0.04 }, { p: V(0.01, 0.22, 0), r: 0.03 }], tseg)];
    limbs(V(0.01, 0.2, 0), 0.018, ring.slice(0, hi ? 7 : 4), 0.85);
  } else if (shape === 'willow') {
    trunkParts = [trunkGeo([{ p: V(0, 0, 0), r: 0.055 }, { p: V(0.03, 0.25, 0), r: 0.042 }, { p: V(0.02, 0.5, 0.01), r: 0.032 }], tseg)];
    limbs(V(0.02, 0.48, 0.01), 0.018, ring.slice(0, hi ? 6 : 3), 0.8);
  } else {
    trunkParts = [trunkGeo([{ p: V(0, 0, 0), r: 0.036 }, { p: V(0.01, 0.3, 0.005), r: 0.026 }, { p: V(0, 0.62, 0), r: 0.016 }], tseg)];
    if (hi) for (const b of ring.slice(0, 4)) trunkParts.push(trunkGeo([{ p: V(0, 0.42 + rng() * 0.12, 0), r: 0.013 }, { p: b.c.clone().multiplyScalar(0.8), r: 0.006 }], 5));
  }
  return { solid, cards: B.geometry(true), trunk: mergeGeometries(trunkParts) };
}

// bamboo: a clump of tall thin culms arching out at the top, feathery sprays of narrow leaves along their upper half
export function bambooGeo(lod = 0, seed = 9) {
  const rng = mulberry32(seed), n = [16, 9, 5][lod], culms = [], B = meshBuilder(), crown = V(0, 0.72, 0);
  const d = V(0, 0, 0), nn = V(0, 0, 0), ax = V(0, 0, 0), ay = V(0, 0, 0), tops = [];
  for (let i = 0; i < n; i++) {
    const a = rng() * TAU, r = Math.sqrt(rng()) * 0.075, h = 0.72 + rng() * 0.28, lean = 0.03 + rng() * 0.09;
    const bx = Math.cos(a) * r, bz = Math.sin(a) * r, ox = Math.cos(a), oz = Math.sin(a);
    const at = t => V(bx + ox * lean * t * t * h * 1.3, t * h * (1 - 0.06 * t * t), bz + oz * lean * t * t * h * 1.3);
    if (lod < 2) culms.push(trunkGeo([{ p: at(0), r: 0.0055 }, { p: at(0.4), r: 0.0048 }, { p: at(0.75), r: 0.0036 }, { p: at(1), r: 0.0018 }], lod ? 3 : 5, 9));
    tops.push(at(0.8));
    if (lod === 2) continue;
    const nk = lod ? 5 : 12;
    for (let k = 0; k < nk; k++) {
      const t = 0.42 + 0.58 * (k + rng() * 0.6) / nk, c = at(t), side = rng() * TAU;
      d.set(Math.cos(side) * 0.8 + ox * 0.6, -0.25 - rng() * 0.3, Math.sin(side) * 0.8 + oz * 0.6).normalize();
      c.addScaledVector(d, 0.03);
      const size = 0.08 + rng() * 0.05;
      ax.set(0, 1, 0).cross(d); if (ax.lengthSq() < 1e-3) ax.set(1, 0, 0); ax.normalize();
      ay.copy(d).cross(ax).normalize();
      nn.copy(c).sub(crown).normalize().add(V(0, 0.3, 0)).normalize();
      const ao = 0.62 + 0.38 * t;
      const ids = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => B.v(c.clone().addScaledVector(ax, u * size * 0.5).addScaledVector(ay, v * size * 0.5), nn, ao, [(u + 1) / 2, (v + 1) / 2]));
      B.tri(ids[0], ids[1], ids[2]); B.tri(ids[0], ids[2], ids[3]);
    }
  }
  // a few soft foliage masses give the grove body (and are all that is left far away)
  const ico = new THREE.IcosahedronGeometry(1, lod ? 0 : 1), parts = [], q = V(0, 0, 0);
  const nb = lod === 2 ? 2 : 4;
  for (let k = 0; k < nb; k++) {
    const tp = tops[Math.floor(rng() * tops.length)], c = V(tp.x * 0.8, tp.y - 0.05 - rng() * 0.12, tp.z * 0.8), R = lod === 2 ? 0.16 : 0.1, s = rng() * 10;
    const g = ico.clone(), pos = g.attributes.position, nor = g.attributes.normal, col = [];
    for (let i = 0; i < pos.count; i++) {
      d.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
      q.copy(d).multiplyScalar(R * (1 + lump(d, s))); q.y *= 1.7; q.add(c);
      pos.setXYZ(i, q.x, q.y, q.z);
      nn.copy(d).add(q.clone().sub(crown).normalize().multiplyScalar(0.7)).normalize(); nor.setXYZ(i, nn.x, nn.y, nn.z);
      const ao = 0.55 + 0.4 * clamp((q.y - 0.45) / 0.5, 0, 1); col.push(ao, ao, ao);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.deleteAttribute('uv'); parts.push(g);
  }
  return { solid: mergeGeometries(parts), cards: lod < 2 ? B.geometry(true) : null, trunk: culms.length ? mergeGeometries(culms) : null };
}

// ---------------------------------------------------------------- materials
// shared foliage shading: toon lighting comes from toon.js; here a soft sky-tinted rim and sunlight through the leaves
function foliagePatch(m, key, amount, cards) {
  m.defines = { CLOUD_SHADE_VARYING: '' };
  m.onBeforeCompile = sh => {
    sh.uniforms.uSunViewDir = S.uSunViewDir; sh.uniforms.uSunCol = S.uSunCol; sh.uniforms.uAmbC = S.uAmb;
    let vs = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vCloudLit;\n' + CLOUD_SHADE_GLSL);
    // mid / far LODs carry the trunk inside the foliage mesh (one draw instead of two): its vertices (aBark = 1) keep
    // their painted bark colour instead of the per-tree foliage tint
    vs = vs.replace('#include <common>', '#include <common>\nattribute float aBark;')
      .replace('#include <color_vertex>', '#include <color_vertex>\n#ifdef USE_COLOR\n vColor.xyz = mix(vColor.xyz, color.xyz, aBark);\n#endif');
    sh.vertexShader = vs
      .replace('#include <project_vertex>', `#include <project_vertex>
        { vec4 cwp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            cwp = instanceMatrix * cwp;
          #endif
          vCloudLit = cloudShade((modelMatrix * cwp).xyz); }`);
    let fs = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSunViewDir; uniform vec3 uSunCol; uniform vec3 uAmbC;')
      .replace('#include <emissivemap_fragment>', `
        vec3 vdir = normalize(-vViewPosition);
        float trl = pow(max(dot(vdir, uSunViewDir), 0.0), 4.0);
        float rim = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
        totalEmissiveRadiance += diffuseColor.rgb * (uSunCol * trl * 0.3 * vCloudLit + uAmbC * rim * 0.3);`);
    if (cards) fs = fs
      // cards keep the crown's smooth normal on both faces
      .replace('#include <normal_fragment_begin>', 'float faceDirection = 1.0; vec3 normal = normalize(vNormal); vec3 nonPerturbedNormal = normal;')
      .replace('#include <alphatest_fragment>', `
        #ifdef ALPHA_TO_COVERAGE
          diffuseColor.a = clamp((diffuseColor.a - alphaTest) / max(fwidth(diffuseColor.a), 1e-3) + 0.5, 0.0, 1.0);
          if (diffuseColor.a <= 0.0) discard;
        #else
          if (diffuseColor.a < alphaTest) discard;
        #endif`);
    sh.fragmentShader = fs;
  };
  windPatch(m, key, amount);
  return m;
}
// material sets: tex = leaf-card texture ('round' | 'lance' | 'maple' | 'sakura' | 'hydra'), bark = [photo scan, map,
// colour] or [painted bark kind, null, colour], sway = wind bend, noSolid = bark only (dead wood), vc = bark takes
// vertex colours (mossy logs)
const MATS = {
  fir: { bark: ['fir_tree_01', 'bark_diff', 0xd2b296], sway: 1 },
  dead: { bark: ['fir_tree_01', 'bark_diff', 0xffffff], sway: 0.25, noSolid: true, toonNorm: 0.36 },
  log: { bark: ['fir_tree_01', 'bark_diff', 0xffffff], sway: 0, noSolid: true, vc: true },
  leaf: { tex: 'round', bark: ['sakura_bark', 'diff', 0xd0b098], sway: 1.6 },
  oak: { tex: 'round', bark: ['pine_bark', 'diff', 0xd0c0b0], sway: 1.25 },
  birch: { tex: 'round', bark: ['birch', null, 0xffffff], sway: 1.9 },
  zelkova: { tex: 'round', bark: ['japanese_zelkova_bark', 'diff', 0xdcd0c0], sway: 1.3 },
  maple: { tex: 'maple', bark: ['sakura_bark', 'diff', 0xbcaea4], sway: 1.5 },
  willow: { tex: 'lance', bark: ['pine_bark', 'diff', 0xb8a898], sway: 2.2 },
  bamboo: { tex: 'lance', bark: ['bamboo', null, 0xa6bd62], sway: 2.6 },
  sakura: { tex: 'sakura', bark: ['sakura_bark', 'diff', 0x8a6662], sway: 1.3 },
  bush: { tex: 'round', sway: 0.5 },
  hydra: { tex: 'hydra', sway: 0.5, solidColor: 0x4c9a3e },
  hedge: { tex: 'round', sway: 0.15 },
  ivy: { tex: 'round', sway: 0.2 },
};
const mats = {};
function materials(kind) {
  if (mats[kind]) return mats[kind];
  const D = MATS[kind] || MATS.leaf, sway = D.sway, M = {};
  if (!D.noSolid) {
    M.solid = foliagePatch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, color: D.solidColor || 0xffffff }), 'toonSolid' + kind, sway, false);
    M.solidDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }); windPatch(M.solidDepth, 'toonSolidDepth' + kind, sway);
  }
  if (D.tex) {
    const tex = D.tex === 'sakura' || D.tex === 'hydra' ? blossomTexture(D.tex) : leafTexture(D.tex);
    M.cards = foliagePatch(new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, alphaTest: 0.5, alphaToCoverage: Q.msaa > 0, side: THREE.DoubleSide, roughness: 1, metalness: 0 }), 'toonCards' + kind, sway, true);
    M.cardDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest: 0.5 }); windPatch(M.cardDepth, 'toonCardsDepth' + kind, sway);
  }
  if (D.bark) {
    const [name, map, color] = D.bark;
    M.trunk = new THREE.MeshStandardMaterial({ map: map ? phTex(name, map, '1k', true) : barkTexture(name), color, roughness: 1, vertexColors: !!D.vc });
    if (D.toonNorm) M.trunk.userData.toonNorm = D.toonNorm; // painted brightness (toon.js): the tint alone decides the tone
    if (sway) windPatch(M.trunk, 'toonTrunk' + kind, sway);
    if (D.noSolid) { M.trunkDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }); if (sway) windPatch(M.trunkDepth, 'toonTrunkDepth' + kind, sway); }
  }
  return (mats[kind] = M);
}

// ---------------------------------------------------------------- species
// geo(lod, variant) -> {solid, cards, trunk}; n = seeded variants (each its own instanced set, so neighbouring trees of
// one species rarely share a silhouette); trunk = collider radius per metre of height; small = short draw distances
const SPECIES = {
  young:   { mat: 'fir', n: 2, geo: (l, v) => coniferGeo(l, 11 + v * 31, 'young'), trunk: 0.03 },
  spruce:  { mat: 'fir', n: 2, geo: (l, v) => coniferGeo(l, 5 + v * 29, 'spruce'), trunk: 0.03 },
  tall:    { mat: 'fir', n: 1, geo: (l, v) => coniferGeo(l, 7 + v * 23, 'tall'), trunk: 0.027 },
  old:     { mat: 'fir', n: 2, geo: (l, v) => coniferGeo(l, 13 + v * 37, 'old'), trunk: 0.05 },
  pine:    { mat: 'fir', n: 1, geo: (l, v) => coniferGeo(l, 17 + v * 19, 'pine'), trunk: 0.03 },
  jpine:   { mat: 'fir', n: 1, geo: (l, v) => coniferGeo(l, 21 + v * 13, 'jpine'), trunk: 0.045, small: true },
  sapling: { mat: 'fir', n: 1, geo: (l, v) => coniferGeo(Math.max(l, 1), 41 + v * 7, v ? 'spruce' : 'young'), trunk: 0, small: true, tiny: true },
  snag:    { mat: 'dead', n: 1, geo: (l, v) => deadGeo(l, 3 + v * 7, false), trunk: 0.034, trunkTint: true },
  broken:  { mat: 'dead', n: 1, geo: (l, v) => deadGeo(l, 5 + v * 11, true), trunk: 0.046, trunkTint: true },
  twigs:   { mat: 'dead', n: 1, geo: (l, v) => twigGeo(l, 5 + v * 3), trunk: 0, trunkTint: true, small: true, tiny: true, short: true },
  leaf:    { mat: 'leaf', n: 2, geo: (l, v) => broadleafGeo(l, 7 + v * 6, 'leaf'), trunk: 0.034 },
  oak:     { mat: 'oak', n: 1, geo: (l, v) => broadleafGeo(l, 19 + v * 5, 'oak'), trunk: 0.045 },
  birch:   { mat: 'birch', n: 1, geo: (l, v) => broadleafGeo(l, 23 + v * 9, 'birch'), trunk: 0.022 },
  zelkova: { mat: 'zelkova', n: 1, geo: (l, v) => broadleafGeo(l, 29 + v * 4, 'zelkova'), trunk: 0.04 },
  maple:   { mat: 'maple', n: 1, geo: (l, v) => broadleafGeo(l, 31 + v * 8, 'maple'), trunk: 0.035 },
  willow:  { mat: 'willow', n: 1, geo: (l, v) => broadleafGeo(l, 37, 'willow'), trunk: 0.05 },
  sakura:  { mat: 'sakura', n: 2, geo: (l, v) => broadleafGeo(l, 13 + v * 8, 'sakura'), trunk: 0.05, cardShadow: false },
  bamboo:  { mat: 'bamboo', n: 2, geo: (l, v) => bambooGeo(l, 9 + v * 4), trunk: 0.06 },
};
// painted bark colour of trunks merged into the foliage mesh (mid / far LODs)
const BARK = { fir: '#524438', leaf: '#56483e', oak: '#544a42', birch: '#c9c6bf', zelkova: '#6a6158', maple: '#4c4541', willow: '#4a3f36', bamboo: '#869a4c', sakura: '#3e2e2e' };
function barkAttr(g, v) { if (!g.getAttribute('aBark')) g.setAttribute('aBark', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(v), 1)); return g; }
function mergeBark(solid, trunk, color) {
  let t = trunk.clone(); if (t.getAttribute('uv')) t.deleteAttribute('uv');
  const n = t.attributes.position.count, c = new Float32Array(n * 3), col = new THREE.Color(color);
  for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
  t.setAttribute('color', new THREE.Float32BufferAttribute(c, 3)); barkAttr(t, 1);
  let so = barkAttr(solid.clone(), 0);
  if (!so.index && t.index) t = t.toNonIndexed(); else if (so.index && !t.index) so = so.toNonIndexed();
  for (const k of Object.keys(so.attributes)) if (!t.attributes[k]) so.deleteAttribute(k);
  for (const k of Object.keys(t.attributes)) if (!so.attributes[k]) t.deleteAttribute(k);
  return mergeGeometries([so, t]);
}
// solid blobs (+ merged bark) and leaf cards in one geometry: solid vertices sample the opaque corner texel
const PATCH_UV = [6 / 256, 1 - 6 / 256];
function mergeCrown(solid, cards) {
  let so = solid.clone(), ca = barkAttr(cards.clone(), 0);
  const n = so.attributes.position.count, uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { uv[i * 2] = PATCH_UV[0]; uv[i * 2 + 1] = PATCH_UV[1]; }
  so.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); barkAttr(so, 0);
  if (!so.index && ca.index) ca = ca.toNonIndexed(); else if (so.index && !ca.index) so = so.toNonIndexed();
  for (const k of Object.keys(so.attributes)) if (!ca.attributes[k]) so.deleteAttribute(k);
  for (const k of Object.keys(ca.attributes)) if (!so.attributes[k]) ca.deleteAttribute(k);
  return mergeGeometries([so, ca]);
}
const SEPARATE_CARDS = { sakura: true, hydra: true }; // blossom cards cast no shadow / are tinted apart from their green mound
function speciesParts(sp, M, g, lod) {
  const p = [], near = lod === 0, far = lod === 2;
  let solid = g.solid, trunk = g.trunk, cards = g.cards && M.cards && !far ? g.cards : null;
  if (solid && M.solid) {
    if (trunk && !near && BARK[sp.mat]) { solid = mergeBark(solid, trunk, BARK[sp.mat]); trunk = null; }
    else barkAttr(solid, 0);
    if (cards && !SEPARATE_CARDS[sp.mat]) { p.push({ geometry: mergeCrown(solid, cards), material: M.cards, tint: true, castShadow: !far, depth: M.cardDepth }); cards = null; }
    else p.push({ geometry: solid, material: M.solid, tint: sp.mat !== 'hydra', castShadow: !far, depth: M.solidDepth });
  }
  if (cards) p.push({ geometry: barkAttr(cards, 0), material: M.cards, tint: true, castShadow: near && sp.cardShadow !== false, depth: M.cardDepth });
  if (trunk && M.trunk) p.push({ geometry: trunk, material: M.trunk, tint: sp.trunkTint ? true : 'bc', castShadow: near || (!far && !!M.trunkDepth), depth: M.trunkDepth });
  return p;
}
// trees: [{kind, v?, x, y, z, s (height, m), sx?, r?, tilt?, tilt2?, c (foliage / dead-wood tint), bc? (bark tint)}]
// -> LOD'd, cell-culled instanced sets (one per species variant) with trunk colliders. Past the mid LOD, trees switch
// to a far version instead of disappearing, so forests never thin out with distance.
export function buildTrees(trees, { hiDist = () => Q.treeHi, farDist = () => Q.trees, cell = 256, colliders = true } = {}) {
  const groups = new Map();
  for (const t of trees) {
    const sp = SPECIES[t.kind]; if (!sp) continue;
    const k = t.kind + '|' + ((t.v || 0) % sp.n);
    if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t);
  }
  for (const [k, list] of groups) {
    const [kind, vs] = k.split('|'), v = +vs, sp = SPECIES[kind], M = materials(sp.mat);
    // conifer tiers past ~300 m read the same with 9 segments as with 16: the detailed set stays close
    const hiD = sp.short ? () => Q.ferns * 0.5 : sp.tiny ? () => Q.ferns * 1.1 : sp.small ? () => Q.treeHi * 0.55 : sp.mat === 'fir' ? () => Math.min(hiDist(), Q.treeHi * 0.6) : hiDist;
    const loD = sp.short ? () => Q.ferns * 1.1 : sp.tiny ? () => Q.treeHi * 0.7 : sp.small ? () => Q.trees * 0.3 : farDist;
    const lods = [{ dist: hiD, parts: speciesParts(sp, M, sp.geo(0, v), 0) }, { dist: loD, parts: speciesParts(sp, M, sp.geo(1, v), 1) }];
    if (!sp.small) lods.push({ dist: () => Infinity, parts: speciesParts(sp, M, sp.geo(2, v), 2) });
    new Scatter(list, lods, sp.tiny ? 128 : cell);
    if (colliders && sp.trunk) for (const t of list) { const r = sp.trunk * t.s * (t.sx || 1); if (r > 0.07) addCircle(t.x, t.z, r + 0.05); }
  }
}
// legacy entry points (maps still call these with plain lists)
export function buildConiferForest(trees, opt) { buildTrees(trees.map(t => t.kind ? t : { ...t, kind: 'spruce', v: t.v ?? Math.floor(Math.abs(t.x * 7.3 + t.z * 3.1)) % 3 }), opt); }
export function buildBroadleafForest(trees, opt) { buildTrees(trees.map(t => t.kind ? t : { ...t, kind: 'leaf', v: Math.floor(Math.abs(t.x * 5.1 + t.z * 2.3)) % 2 }), opt); }
export function buildSakura(trees, opt) { buildTrees(trees.map(t => ({ ...t, kind: 'sakura', v: Math.floor(Math.abs(t.x * 3.7 + t.z * 1.9)) % 2 })), opt); }
// fallen logs: [{x, y, z, len, rad, r, tilt, tilt2, c}] (lying along their yaw r)
export function buildLogs(logs, dist = () => Q.rocks * 0.6) {
  if (!logs.length) return;
  const M = materials('log');
  const items = logs.map(l => ({ x: l.x, y: l.y, z: l.z, s: 1, sx: l.len, sy: l.rad, sz: l.rad, r: l.r, tilt: l.tilt || 0, tilt2: l.tilt2 || 0, c: l.c }));
  const lods = [0, 1].map(l => ({ dist: l ? dist : () => dist() * 0.4, parts: [{ geometry: logGeo(l, 7).trunk, material: M.trunk, tint: true, castShadow: true, depth: M.trunkDepth }] }));
  new Scatter(items, lods, 96);
  for (const l of logs) { const n = Math.max(1, Math.round(l.len / 1.2)), c = Math.cos(l.r), s = Math.sin(l.r);
    for (let k = 0; k < n; k++) { const t = (k + 0.5) / n - 0.5; addCircle(l.x + c * t * l.len * 0.9, l.z - s * t * l.len * 0.9, l.rad * 0.85, l.y - 1, l.y + l.rad * 1.6); } }
}

// ---------------------------------------------------------------- far tree cards (impostors)
// Painted silhouettes on camera-facing cards for the distant forest: unlike real geometry, a mip-mapped card averages
// out when a tree shrinks to a few pixels, so far hillsides read as soft forest instead of shimmering speckle.
// Atlas (8 columns): conifers — spruce, young fir, old fir with a high ragged crown, tall spire, umbrella pine; broadleaf
// — round, broad oak, narrow birch. R = painted shading (lit crown, darker base and tier undersides), A = coverage.
// The column comes from the instance's yaw (cards face the camera, so the yaw is free to carry it).
export const FAR_CARDS = { fir: 5, leaf: 3, step: 0.5 };
let farTex = null;
function farCardTexture() {
  if (farTex) return farTex;
  const W = 128, H = 256, cv = document.createElement('canvas'); cv.width = W * 8; cv.height = H;
  const g = cv.getContext('2d');
  const grey = v => { const c = Math.round(Math.min(255, Math.max(0, v))); return `rgb(${c},${c},${c})`; };
  const conifer = (x0, seed, { K = 7, base = 0.9, top = 0.3, w0 = 0.47, w1 = 0.16, th = 0.3, trunk = 0.14, rag = 0, wob = 0 }) => {
    const r = mulberry32(seed), cx = x0 + W / 2;
    g.fillStyle = grey(70); g.fillRect(cx - 3, H * (1 - trunk), 6, H * trunk);
    for (let k = 0; k < K; k++) {
      const f = k / (K - 1), yb = H * lerp(base, top, f), tH = H * lerp(th, th * 0.85, f), w = W * lerp(w0, w1, f) * (1 + (r() - 0.5) * rag), ya = yb - tH, ox = (r() - 0.5) * wob * W;
      g.fillStyle = grey(lerp(150, 250, f) * (0.92 + 0.08 * r()));
      g.beginPath(); g.moveTo(cx + ox + (r() - 0.5) * 3, ya);
      const n = 6;
      for (let i = 0; i <= n; i++) { const t = i / n, x = cx + ox + w - t * 2 * w, drop = (i % 2 ? -0.04 : 0.05) * H * (1 - f * 0.5); g.lineTo(x + (r() - 0.5) * rag * 10, yb + drop + (r() - 0.5) * 3); }
      g.closePath(); g.fill();
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(cx + ox - w * 0.8, yb - H * 0.025, w * 1.6, H * 0.03);
      g.globalCompositeOperation = 'source-over';
    }
  };
  const pine = (x0, seed) => {
    const r = mulberry32(seed), cx = x0 + W / 2;
    g.fillStyle = grey(70); g.fillRect(cx - 3, H * 0.3, 6, H * 0.7);
    for (let i = 0; i < 6; i++) { const y = H * (0.18 + r() * 0.2), x = cx + (r() - 0.5) * W * 0.5, w = W * (0.16 + r() * 0.14);
      g.fillStyle = grey(lerp(170, 245, 1 - (y / H - 0.18) / 0.25)); g.beginPath(); g.ellipse(x, y, w, w * 0.42, 0, 0, 7); g.fill(); }
  };
  const broadleaf = (x0, seed, { n = 26, cy = 0.42, wx = 1.2, wy = 0.55, rad = 0.14, trunk = 0.3 }) => {
    const r = mulberry32(seed), cx = x0 + W / 2;
    g.fillStyle = grey(70); g.fillRect(cx - 4, H * (1 - trunk), 8, H * trunk);
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.3, x = cx + Math.cos(a) * d * W * wx, y = H * (cy + Math.sin(a) * d * wy), rr = W * (rad + r() * 0.1);
      g.fillStyle = grey(lerp(250, 150, (y - H * 0.2) / (H * 0.5)) * (0.9 + 0.1 * r()));
      g.beginPath(); g.arc(x, y, rr, 0, 7); g.fill();
    }
  };
  conifer(0, 5, {});
  conifer(W, 9, { K: 6, base: 0.97, w0: 0.5, w1: 0.18, th: 0.34, trunk: 0.04 });
  conifer(W * 2, 21, { K: 6, base: 0.62, top: 0.14, w0: 0.44, w1: 0.2, th: 0.24, trunk: 0.42, rag: 0.5, wob: 0.12 });
  conifer(W * 3, 33, { K: 8, base: 0.8, top: 0.12, w0: 0.3, w1: 0.1, th: 0.24, trunk: 0.22 });
  pine(W * 4, 44);
  broadleaf(W * 5, 13, {});
  broadleaf(W * 6, 17, { n: 30, cy: 0.4, wx: 1.5, wy: 0.45, rad: 0.15, trunk: 0.34 });
  broadleaf(W * 7, 23, { n: 18, cy: 0.38, wx: 0.7, wy: 0.9, rad: 0.12, trunk: 0.4 });
  farTex = new THREE.CanvasTexture(cv);
  farTex.colorSpace = THREE.NoColorSpace; farTex.wrapS = farTex.wrapT = THREE.ClampToEdgeWrapping; farTex.anisotropy = 4;
  return farTex;
}
const farCardMats = {};
function farCardMaterial(kind) {
  if (farCardMats[kind]) return farCardMats[kind];
  const m = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, alphaTest: 0.5, alphaToCoverage: Q.msaa > 0 });
  m.defines = { CLOUD_SHADE_VARYING: '' };
  const col0 = kind === 'fir' ? 0 : FAR_CARDS.fir;
  m.onBeforeCompile = sh => {
    sh.uniforms.tFar = { value: farCardTexture() };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFarUv; varying float vCloudLit;\n' + CLOUD_SHADE_GLSL)
      .replace('#include <beginnormal_vertex>', `
        const float FW[8] = float[8](0.64, 0.74, 0.7, 0.46, 0.78, 0.95, 1.12, 0.62);   // card width per atlas column
        vec3 fc = instanceMatrix[3].xyz;
        float fsx = length(instanceMatrix[0].xyz), fsy = length(instanceMatrix[1].xyz);
        float fcol = ${col0.toFixed(1)} + floor(atan(-instanceMatrix[0].z, instanceMatrix[0].x) / ${FAR_CARDS.step.toFixed(3)} + 0.5);
        fcol = clamp(fcol, 0.0, 7.0);
        vec2 fto = normalize(cameraPosition.xz - fc.xz + 1e-4);
        vec3 fright = vec3(fto.y, 0.0, -fto.x);
        vec3 fwp = fc + fright * position.x * fsx * FW[int(fcol)] + vec3(0.0, position.y * fsy, 0.0);
        // a rounded crown: the card's normal bends out to the sides and up, so the sun side of each tree is brighter
        vec3 objectNormal = normalize(fright * position.x * 1.3 + vec3(0.0, 0.35 + position.y * 0.9, 0.0) + vec3(fto.x, 0.0, fto.y) * 0.6);
        // mirrored on half the trees
        float fflip = step(0.5, fract(fc.x * 0.1234 + fc.z * 0.3711)) * 2.0 - 1.0;
        vFarUv = vec2((fcol + position.x * fflip + 0.5) / 8.0, position.y);
        vCloudLit = cloudShade(fwp);`)
      .replace('#include <defaultnormal_vertex>', 'vec3 transformedNormal = normalMatrix * objectNormal;')
      .replace('#include <project_vertex>', 'vec4 mvPosition = viewMatrix * vec4(fwp, 1.0); gl_Position = projectionMatrix * mvPosition;')
      .replace('#include <worldpos_vertex>', 'vec4 worldPosition = vec4(fwp, 1.0);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tFar; varying vec2 vFarUv;')
      .replace('#include <map_fragment>', `
        vec4 ftc = texture2D(tFar, vFarUv);
        vec2 ftdx = dFdx(vFarUv * vec2(1024.0, 256.0)), ftdy = dFdy(vFarUv * vec2(1024.0, 256.0));
        float flod = 0.5 * log2(max(max(dot(ftdx, ftdx), dot(ftdy, ftdy)), 1e-6));
        diffuseColor.a = ftc.a * (1.0 + max(flod, 0.0) * 0.35);   // mip levels lose coverage: keep far crowns solid
        // painted shading up close; as a card shrinks to a few pixels it flattens to its mid tone (no speckle)
        diffuseColor.rgb *= mix(0.35 + 0.75 * ftc.r, 0.86, smoothstep(1.0, 4.0, flod));`);
  };
  m.customProgramCacheKey = () => 'farCard8' + kind;
  return (farCardMats[kind] = m);
}
let farCardGeo = null;
const cardGeo = () => farCardGeo || (farCardGeo = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0));

// far forest on the outer terrain: sets[i] = {fir, leaf} per distance ring (items carry v: atlas variant); ring i is
// drawn while i < Q.far. The first ring shows simple real trees up to ~900 m, then cards; outer rings are cards only.
export function buildFarForest(sets) {
  const fir = materials('fir'), leaf = materials('leaf');
  const firGeo = [coniferGeo(2, 5, 'spruce'), coniferGeo(2, 13, 'old')], leafGeo = broadleafGeo(3, 7, 'leaf');
  const solid = (geo, M) => [{ geometry: geo.trunk ? mergeBark(geo.solid, geo.trunk, BARK.fir) : barkAttr(geo.solid, 0), material: M.solid, tint: true, castShadow: false }];
  const card = kind => [{ geometry: cardGeo(), material: farCardMaterial(kind), tint: true, castShadow: false, receiveShadow: false }];
  // cards carry their atlas column in the yaw and stand upright
  const asCards = (list, kind) => list.map(t => ({ ...t, r: (t.v || 0) % FAR_CARDS[kind] * FAR_CARDS.step, tilt: 0, tilt2: 0 }));
  sets.forEach((set, i) => {
    const on = () => i < (Q.far || 1) ? Infinity : -1, near = () => (i < (Q.far || 1) ? 900 : -1);
    for (const [list, M, kind] of [[set.fir, fir, 'fir'], [set.leaf, leaf, 'leaf']]) {
      if (!list.length) continue;
      if (i === 0) {
        if (kind === 'fir') for (let g = 0; g < 2; g++) { const sub = list.filter(t => (t.v === 2 || t.v === 4 ? 1 : 0) === g); if (sub.length) new Scatter(sub, [{ dist: near, parts: solid(firGeo[g], M) }], 256); }
        else new Scatter(list, [{ dist: near, parts: solid(leafGeo, M) }], 256);
        new Scatter(asCards(list, kind), [{ dist: near, parts: [] }, { dist: on, parts: card(kind) }], 256);
      } else new Scatter(asCards(list, kind), [{ dist: on, parts: card(kind) }], 1024);
    }
  });
}

// shrubs and low greenery (bush, hydra, hedge, ivy): no trunk collider worth having below ~1 m; only the big ones block
// (full blob detail only within ~a hundred metres; hedges and ivy are low and many, so they start at the mid LOD)
export function buildBushes(bushes, kind = 'bush', { hiDist = () => Q.treeHi * (kind === 'hedge' || kind === 'ivy' ? 0.12 : 0.22), farDist = () => Q.trees * 0.35, collide = true } = {}) {
  if (!bushes.length) return;
  const seed = { hydra: 21, hedge: 25, ivy: 27 }[kind] || 17;
  const M = materials(kind), hi = broadleafGeo(kind === 'hedge' ? 1 : 0, seed, kind), lo = broadleafGeo(1, seed, kind);
  const sp = { mat: kind, cardShadow: kind !== 'hydra' };
  new Scatter(bushes, [{ dist: hiDist, parts: speciesParts(sp, M, hi, 0) }, { dist: farDist, parts: speciesParts(sp, M, lo, 1) }], 192);
  if (collide) for (const b of bushes) if (b.s > 1.2 && kind !== 'ivy') addCircle(b.x, b.z, 0.35 * b.s * (kind === 'hedge' ? 0.6 : 1));
}

// ---------------------------------------------------------------- painted palettes
// Colours come from a base per species/age, shifted per stand (cl: 0..1 cluster noise moves the hue between blue-green
// and yellow-green; br: 0..1 stand brightness) and jittered a little per tree. Kept restrained: no rainbow forests.
const hsl = { h: 0, s: 0, l: 0 };
function vary(base, rng, cl = 0.5, br = 0.5, hueAmt = 0.045, satMul = 1) {
  const c = new THREE.Color(base); c.getHSL(hsl);
  hsl.h += (cl - 0.5) * hueAmt + (rng() - 0.5) * 0.012;
  hsl.s = clamp(hsl.s * satMul * (0.86 + rng() * 0.14), 0, 1);
  hsl.l = clamp(hsl.l * (0.82 + 0.34 * br) * (0.92 + rng() * 0.16), 0, 1);
  return c.setHSL(hsl.h, hsl.s, hsl.l);
}
const CONIFER_BASE = { young: '#4f9c61', spruce: '#317e5a', tall: '#347656', old: '#2a6650', pine: '#4e8a52', jpine: '#3c7a4b', sapling: '#5ca668' };
export const coniferColor = (rng, form = 'spruce', cl = 0.5, br = 0.5) => vary(CONIFER_BASE[form] || CONIFER_BASE.spruce, rng, cl, br, 0.07, 0.88);
const BROAD_BASE = { leaf: '#5aa646', oak: '#4c943e', camphor: '#3f8a3a', birch: '#93c85a', zelkova: '#61a848', maple: '#72b84a', mapleRed: '#b4503c', willow: '#9ccd5c', bamboo: '#8fc052' };
export const broadColor = (rng, kind = 'leaf', cl = 0.5, br = 0.5) => vary(BROAD_BASE[kind] || BROAD_BASE.leaf, rng, cl, br, kind === 'mapleRed' ? 0.03 : 0.06, kind === 'mapleRed' ? 0.72 : 0.84);
// weathered dead wood is pale and silvery (over the dark bark texture the tint needs to be light, or snags read black)
export const deadColor = (rng, broken) => vary(broken ? '#e6d8c8' : '#f2ece6', rng, 0.5, 0.5, 0.02, 0.8);
export const barkColor = (rng, warm = 0.5) => new THREE.Color(1, 1, 1).multiplyScalar(0.82 + rng() * 0.3).lerp(new THREE.Color(1.05, 0.95, 0.85), warm * 0.4);
// legacy palettes, picked per tree
const FIR = ['#2f8a5a', '#3b9a62', '#287453', '#4aa266', '#34855e'].map(c => new THREE.Color(c));
const LEAF = ['#62bb45', '#50a641', '#80c74e', '#48994a', '#94d052', '#6cbf4c'].map(c => new THREE.Color(c));
const pick = (list, rng) => list[Math.floor(rng() * list.length)].clone().multiplyScalar(0.92 + rng() * 0.16);
export const firColor = rng => pick(FIR, rng);
export const leafColor = rng => pick(LEAF, rng);
const SAKURA = ['#ffc2d6', '#ffb4cb', '#f9a7c2', '#ffcadb', '#f6b1cd', '#ffbcd2'].map(c => new THREE.Color(c));
const BUSH = ['#4f9f3f', '#5cae44', '#3f8f45', '#6bb84a'].map(c => new THREE.Color(c));
const HYDRA = ['#7f9cff', '#9a86ff', '#c38cf0', '#ff9ccf', '#8fb6ff', '#b4a2ff'].map(c => new THREE.Color(c));
export const sakuraColor = rng => pick(SAKURA, rng);
export const bushColor = rng => pick(BUSH, rng);
export const hydraColor = rng => pick(HYDRA, rng);
