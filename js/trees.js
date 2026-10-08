// Ghibli-style trees, built to be shaded by the toon lighting rather than to look scanned:
//  - conifers: stacked solid cone tiers with scalloped, drooping, irregular rims (clean painted silhouettes, no alpha
//    cut-outs). Several growth forms — young firs branched to the ground, mature spruces, tall spires, old giants with
//    high ragged crowns and thick trunks, umbrella pines, clipped garden pines — each in a few seeded variants.
//  - dead trees: standing snags and snapped trunks with stub branches; fallen logs; twigs on the forest floor
//  - broadleaf trees: a crown of lumpy solid blobs wrapped in a fringe of leaf cards for a leafy outline (round
//    broadleaf, spreading oak / camphor, airy birch, vase-shaped zelkova, layered maple, weeping willow, sakura, bamboo)
// Normals are smoothed toward each blob / the whole crown, so every tree reads as a soft painted shape with one bright
// sunlit side and one cool shaded side.
import { withScatterMeta, THREE, S, Q, mulberry32, lerp, clamp, phTex, Scatter, addCircle } from './core.js';
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
  const g = cv.getContext('2d'), rng = mulberry32({ round: 11, lance: 12, maple: 13, bamboo: 14, needle: 15 }[kind] || 11);
  g.translate(N / 2, N / 2);
  const shadeAt = y => lerp(175, 255, 0.5 - 0.5 * y / (N * 0.36)) * (0.9 + rng() * 0.1);
  if (kind === 'bamboo') {
    // bamboo foliage: fans of long, narrow, pointed leaves hanging from thin twigs. The card hangs from its top
    // centre, so each spray starts near the top and its leaves fan out downward like fingers (the upper leaves lit,
    // the lower ones in their own shade), each with a darker midrib
    g.setTransform(1, 0, 0, 1, 0, 0);
    const leaf = (x, y, a, L, W, sh) => {
      g.save(); g.translate(x, y); g.rotate(a);
      g.fillStyle = `rgb(${sh},${sh},${sh})`;
      g.beginPath(); g.moveTo(0, 0); g.bezierCurveTo(W * 0.9, L * 0.18, W * 0.75, L * 0.62, W * 0.12, L); g.lineTo(0, L * 1.04);
      g.lineTo(-W * 0.1, L); g.bezierCurveTo(-W * 0.7, L * 0.62, -W * 0.85, L * 0.18, 0, 0); g.fill();
      g.strokeStyle = `rgba(0,0,0,0.16)`; g.lineWidth = 1.1; g.beginPath(); g.moveTo(0, L * 0.04); g.quadraticCurveTo(W * 0.1, L * 0.5, 0, L * 0.95); g.stroke();
      g.restore();
    };
    const sprays = [[0.5, 0.05, 0], [0.28, 0.2, -0.35], [0.73, 0.18, 0.35], [0.42, 0.42, -0.15], [0.62, 0.44, 0.2]];
    for (const [sx, sy, lean] of sprays) {
      // the twig, then a fan of 5-8 leaves from its end
      const tx = sx * N + Math.sin(lean) * N * 0.12, ty = sy * N + N * 0.1;
      g.strokeStyle = 'rgb(150,150,150)'; g.lineWidth = 2; g.beginPath(); g.moveTo(N / 2, 2); g.quadraticCurveTo(sx * N, sy * N * 0.6, tx, ty); g.stroke();
      const nl = 5 + Math.floor(rng() * 4);
      for (let i = 0; i < nl; i++) {
        const f = nl > 1 ? i / (nl - 1) : 0.5, a = lean + lerp(-1.25, 1.25, f) * (0.8 + rng() * 0.3) + (rng() - 0.5) * 0.2;
        const L = N * (0.24 + rng() * 0.12) * (1 - 0.25 * Math.abs(f - 0.5)), W = L * (0.12 + rng() * 0.03);
        const sh = Math.round(lerp(255, 185, clamp(ty / N + Math.cos(a) * 0.25, 0, 1)) * (0.92 + rng() * 0.08));
        leaf(tx, ty, a, L, W, sh);
      }
    }
  } else if (kind === 'needle') {
    // pine needles: tufts of fine needles radiating from short shoots, packed, the upper tufts lit and the lower in shade
    g.lineCap = 'round';
    for (let i = 0; i < 46; i++) {
      const r = Math.sqrt(rng()) * N * 0.3, a = rng() * TAU, cx = Math.cos(a) * r, cy = Math.sin(a) * r * 0.85;
      const n = 14 + Math.floor(rng() * 8), L = N * (0.07 + rng() * 0.04);
      for (let k = 0; k < n; k++) { const b = k / n * TAU + rng() * 0.3, l = L * (0.7 + rng() * 0.4);
        const s = Math.round(shadeAt(cy + Math.sin(b) * l * 0.5) * (0.82 + rng() * 0.18)); g.strokeStyle = `rgb(${s},${s},${s})`; g.lineWidth = 1.6 + rng() * 0.8;
        g.beginPath(); g.moveTo(cx, cy); g.quadraticCurveTo(cx + Math.cos(b) * l * 0.5, cy + Math.sin(b) * l * 0.5 - l * 0.08, cx + Math.cos(b) * l, cy + Math.sin(b) * l); g.stroke(); }
    }
  } else if (kind === 'lance') {
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
  g.setTransform(1, 0, 0, 1, 0, 0); if (kind !== 'bamboo') { g.fillStyle = '#fff'; g.fillRect(0, 0, 12, 12); } // (bamboo has no solid crown)
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
    for (let i = 0; i < 9; i++) { g.fillStyle = `rgba(255,255,255,${0.05 + rng() * 0.08})`; g.fillRect(rng() * 64, 0, 1 + rng() * 2, 128); } // fibre streaks
    const bl = g.createLinearGradient(0, 96, 0, 118); bl.addColorStop(0, 'rgba(255,255,255,0)'); bl.addColorStop(1, 'rgba(255,255,255,0.35)');
    g.fillStyle = bl; g.fillRect(0, 96, 64, 22);                                                // waxy bloom below the node
    g.fillStyle = 'rgba(70,70,60,0.9)'; g.fillRect(0, 120, 64, 4);    // node ring
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillRect(0, 117, 64, 3);
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
// a tapered tube swept along a polyline [{p, r}] as one closed surface: a ring of vertices at every point, on frames
// carried along the line without twisting, so each bend is a single ring shared by the pieces either side of it (cut on
// the bend's mitre, widened across it to keep the tube's thickness) and no seam or gap can open there; the ends are
// closed by low domes (the base: buried in the ground or inside the limb it grows from; the tip: rounded off, or flat
// where a stem is snapped). Normals follow the taper; the bark's v runs on along the whole tube (vScale per unit length).
// cap: { base, tip } — the cap's height as a fraction of the end's radius (0: flat; false: left open, for a root buried
// in the stem it grows from)
function trunkGeo(pts, segs, vScale = 6, cap = {}) {
  // a trunk standing on the ground goes on below it (so on a slope no gap opens under its downhill side), uncapped
  if (cap.base === undefined && pts[0].p.y === 0) { pts = [{ p: V(pts[0].p.x, -0.05, pts[0].p.z), r: pts[0].r }, ...pts.slice(1)]; cap = { ...cap, base: false }; }
  const n = pts.length, P = [], N = [], UV = [], I = [], s = [0], T = [];
  for (let i = 1; i < n; i++) s.push(s[i - 1] + pts[i].p.distanceTo(pts[i - 1].p));
  for (let i = 0; i < n; i++) T.push(pts[Math.min(n - 1, i + 1)].p.clone().sub(pts[Math.max(0, i - 1)].p).normalize());
  let nr = Math.abs(T[0].y) < 0.9 ? V(0, 1, 0).cross(T[0]).normalize() : V(1, 0, 0).cross(T[0]).normalize();
  const q = new THREE.Quaternion(), dir = V(0, 0, 0), m = V(0, 0, 0), nn = V(0, 0, 0), pp = V(0, 0, 0);
  const ring = [];
  for (let i = 0; i < n; i++) {
    if (i) { q.setFromUnitVectors(T[i - 1], T[i]); nr.applyQuaternion(q).addScaledVector(T[i], -nr.dot(T[i])).normalize(); }
    const bi = T[i].clone().cross(nr).normalize(), { p, r } = pts[i];
    // mitre: across a bend the ring is the tube's oblique section, longer along the bend by 1 / cos(half the angle)
    let mc = 1; m.set(0, 0, 0);
    if (i > 0 && i < n - 1) { const d0 = p.clone().sub(pts[i - 1].p).normalize(); mc = Math.max(0.5, d0.dot(T[i])); m.copy(pts[i + 1].p).sub(p).normalize().sub(d0); m.addScaledVector(T[i], -m.dot(T[i])); if (m.lengthSq() > 1e-10) m.normalize(); }
    const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1), drds = (pts[i1].r - pts[i0].r) / Math.max(1e-6, s[i1] - s[i0]);
    const row = [];
    for (let k = 0; k <= segs; k++) {
      const a = k / segs * TAU; dir.copy(nr).multiplyScalar(Math.cos(a)).addScaledVector(bi, Math.sin(a));
      pp.copy(dir); if (mc < 1) pp.addScaledVector(m, pp.dot(m) * (1 / mc - 1));
      nn.copy(dir).addScaledVector(T[i], -drds).normalize();
      P.push(p.x + pp.x * r, p.y + pp.y * r, p.z + pp.z * r); N.push(nn.x, nn.y, nn.z); UV.push(k / segs * 2, s[i] * vScale);
      row.push(P.length / 3 - 1);
    }
    ring.push(row);
  }
  for (let i = 0; i + 1 < n; i++) for (let k = 0; k < segs; k++) { const a = ring[i][k], b = ring[i][k + 1], c = ring[i + 1][k + 1], d = ring[i + 1][k]; I.push(a, b, d, b, c, d); }
  // end caps: a low cone from the end ring to a pole on the axis
  const dome = (i, sg, h) => { const { p, r } = pts[i]; if (r < 1e-4 || h === false) return; const t = T[i].clone().multiplyScalar(sg), row0 = ring[i];
    P.push(p.x + t.x * r * h, p.y + t.y * r * h, p.z + t.z * r * h); N.push(t.x, t.y, t.z); UV.push(1, s[i] * vScale + sg * 0.05); const pole = P.length / 3 - 1;
    for (let k = 0; k < segs; k++) { if (sg > 0) I.push(row0[k], row0[k + 1], pole); else I.push(row0[k + 1], row0[k], pole); } };
  dome(n - 1, 1, cap.tip ?? 0.8); dome(0, -1, cap.base ?? 0.5);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setIndex(I); g.computeBoundingSphere();
  return g;
}
const ROOTED = { base: false };   // (a limb: its root is buried in the stem)
const merge = list => { const l = list.filter(Boolean); return l.length ? (l.length > 1 ? mergeGeometries(l) : l[0]) : null; };
// the axis of a polyline [{p, r}] at height y (and its radius there): where a limb grows from, so its root is buried in
// the stem whatever way the stem bends
const axisAt = (pts, y) => { for (let i = 0; i + 1 < pts.length; i++) { const a = pts[i], b = pts[i + 1]; if (y <= b.p.y || i + 2 === pts.length) { const f = clamp((y - a.p.y) / Math.max(1e-6, b.p.y - a.p.y), 0, 1); return { p: a.p.clone().lerp(b.p, f), r: lerp(a.r, b.r, f) }; } } return { p: pts[0].p.clone(), r: pts[0].r }; };
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
  const n = garden ? 7 : 8, la = rng() * TAU;
  let a = rng() * TAU;
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1), top = i === n - 1;
    const y = garden ? lerp(0.25, 0.87, Math.pow(f, 0.92)) : lerp(0.5, 0.9, Math.pow(f, 0.8));
    // garden pine: pads on long limbs that spiral round the trunk (golden angle), shorter toward the top
    a = garden ? a + 2.4 + (rng() - 0.5) * 0.5 : rng() * TAU;
    const r = top ? 0.025 : garden ? lerp(0.3, 0.12, f) * (0.86 + rng() * 0.28) : 0.05 + rng() * 0.13 * (1 - f * 0.5);
    const R = garden ? lerp(0.125, 0.075, f) * (0.9 + rng() * 0.2) : lerp(0.23, 0.1, f) * (0.8 + rng() * 0.45);
    const lean = (garden ? 0.18 : 0.05) * f;
    const ox = Math.cos(a) * r + Math.cos(la) * lean, oz = Math.sin(a) * r + Math.sin(la) * lean;
    const base = { f, R, H: R * (garden ? 0.72 : 0.62), yb: y, droop: garden ? 0.015 : 0.1, ox, oz, rot: rng() * TAU, p1: rng() * TAU, p2: rng() * TAU, p3: rng() * TAU, amp: garden ? 0.13 : 0.28 };
    if (garden) base.dome = true;
    tiers.push(base);
    // Cloud pruning (玉散らし): several compact rounded cushions around each branch end.  Keeping the cushions
    // separate removes the old metre-wide polygon slabs while retaining a strong, readable tiered silhouette.
    if (garden) for (let k = 0, m = top ? 4 : 5 + (i % 2); k < m; k++) { const b = base.rot + k / m * TAU + rng() * 0.35, d = R * (0.82 + rng() * 0.42), rr = R * (0.48 + rng() * 0.18);
      tiers.push({ ...base, dome: true, R: rr, H: rr * (0.72 + rng() * 0.18), ox: ox + Math.cos(b) * d, oz: oz + Math.sin(b) * d, yb: y - rr * (0.08 + rng() * 0.08), rot: rng() * TAU, p1: rng() * TAU, p2: rng() * TAU, p3: rng() * TAU, amp: 0.12 }); }
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
    const rm = R * (t.dome ? 0.78 : 0.58) * w * jag, ym = ya - H * (t.dome ? 0.32 : 0.5);
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
    const bend = garden ? 0.14 : 0.03, bx = Math.cos(la), bz = Math.sin(la), tx = -bz, tz = bx;
    const top = garden ? 0.84 : 0.9;
    const pts = garden
      ? [{ p: V(0, 0, 0), r: 0.058 }, { p: V(-bx * bend * 0.4 + tx * 0.03, top * 0.22, -bz * bend * 0.4 + tz * 0.03), r: 0.045 }, { p: V(bx * bend * 0.3 - tx * 0.04, top * 0.45, bz * bend * 0.3 - tz * 0.04), r: 0.037 },
        { p: V(bx * bend, top * 0.68, bz * bend), r: 0.028 }, { p: V(bx * bend * 1.5 + tx * 0.03, top * 0.86, bz * bend * 1.5 + tz * 0.03), r: 0.018 }, { p: V(bx * bend * 1.7, top, bz * bend * 1.7), r: 0.008 }]
      : [{ p: V(0, 0, 0), r: 0.036 }, { p: V(-bx * bend * 0.5, top * 0.35, -bz * bend * 0.5), r: 0.029 },
        { p: V(bx * bend, top * 0.7, bz * bend), r: 0.02 }, { p: V(bx * bend * 1.6, top, bz * bend * 1.6), r: 0.01 }];
    const parts = [trunkGeo(pts, segs)];
    if (garden && lod === 0) for (let k = 0; k < 5; k++) { const a = la + k / 5 * TAU + 0.25, L = 0.075 + (k % 2) * 0.02;
      parts.push(trunkGeo([{ p: V(0, 0.035, 0), r: 0.026 }, { p: V(Math.cos(a) * L * 0.6, 0.012, Math.sin(a) * L * 0.6), r: 0.012 }, { p: V(Math.cos(a) * L, -0.006, Math.sin(a) * L), r: 0.002 }], 4, 5, ROOTED)); }
    if (lod < 2) for (const L of limbs) { const A = axisAt(pts, Math.min(L.y - 0.06, top * 0.95));
      if (garden) { const radial = V(L.x - A.p.x, 0, L.z - A.p.z), side = V(-radial.z, 0, radial.x).normalize();
        const mid = A.p.clone().lerp(L, 0.55).addScaledVector(side, ((L.y * 37 | 0) % 2 ? 1 : -1) * 0.018).add(V(0, 0.018, 0));
        parts.push(trunkGeo([{ p: A.p, r: Math.min(0.016, A.r * 0.7) }, { p: mid, r: 0.01 }, { p: L, r: 0.0035 }], lod ? 4 : 6, 6, ROOTED));
      } else parts.push(trunkGeo([{ p: A.p, r: Math.min(0.011, A.r * 0.7) }, { p: L, r: 0.005 }], lod ? 3 : 4, 6, ROOTED)); }
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
  const parts = [trunkGeo(pts, segs, 6, { tip: broken ? 0.12 : 0.8 })];   // (a snapped top is near flat)
  if (broken) { // splinters standing up from the break
    const tp = at(top);
    for (let k = 0; k < (lod ? 2 : 4); k++) { const a = rng() * TAU, h = 0.03 + rng() * 0.06;
      parts.push(trunkGeo([{ p: V(tp.x + Math.cos(a) * rT * 0.5, tp.y - 0.01, tp.z + Math.sin(a) * rT * 0.5), r: rT * 0.45 }, { p: V(tp.x + Math.cos(a) * rT * 0.8, tp.y + h, tp.z + Math.sin(a) * rT * 0.8), r: 0.001 }], 3, 6, ROOTED)); }
  }
  if (lod < 2) { // stub branches, shorter toward the top, drooping or kinked up
    const n = lod ? 5 : 11;
    for (let k = 0; k < n; k++) {
      const y = lerp(0.3, 0.94, k / n + rng() * 0.05) * (broken ? top / 0.96 : 1); if (y > top - 0.02) continue;
      const a = rng() * TAU, L = (0.05 + rng() * 0.1) * (1.1 - y * 0.8), dy = (rng() - 0.6) * L * 0.8, p0 = axisAt(pts, y).p;
      parts.push(trunkGeo([{ p: p0, r: 0.006 }, { p: V(p0.x + Math.cos(a) * L, p0.y + dy, p0.z + Math.sin(a) * L), r: 0.0015 }], 3, 6, ROOTED));
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
      parts.push(trunkGeo([{ p: q, r: 0.012 }, { p: V(q.x + Math.cos(b) * l2, q.y + rng() * 0.06, q.z + Math.sin(b) * l2), r: 0.003 }], 3, 2, ROOTED)); }
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
  if (lod === 0) for (let k = 0; k < 3; k++) { const x = -0.3 + rng() * 0.6, a = rng() * TAU, stub = trunkGeo([{ p: V(x, Math.cos(a) * 0.8, Math.sin(a) * 0.8), r: 0.18 }, { p: V(x + 0.05, Math.cos(a) * 1.9, Math.sin(a) * 1.9), r: 0.04 }], 4, 1, ROOTED);
    const c = []; for (let i = 0; i < stub.attributes.position.count; i++) c.push(1, 1, 1); stub.setAttribute('color', new THREE.Float32BufferAttribute(c, 3)); parts.push(stub); }
  return { trunk: mergeGeometries(parts.map(p => p.index ? p : p)) };
}

// ---------------------------------------------------------------- blob crowns: lumpy solid blobs + card fringe (height ~1)
// shape: 'leaf' round broadleaf, 'oak' broad spreading crown (also camphor), 'birch' narrow airy crown, 'zelkova'
// vase-shaped street tree, 'willow' weeping, 'bush' / 'hydra' low shrubs, 'hedge' a clipped hedge block, 'ivy' a flat
// mat of leaves on a wall (the maple and the sakura are grown on a branch skeleton: mapleGeo, sakuraGeo)
function crownLayout(shape, hi, rng) {
  const blobs = [], B = (x, y, z, R, sc) => blobs.push({ c: V(x, y, z), R, s: rng() * 10, sc: sc || null });
  const ring = (n, rMin, rMax, yMin, yMax, RMin, RMax, sc) => { for (let i = 0; i < n; i++) { const a = i / n * TAU + rng() * 0.6, r = rMin + rng() * (rMax - rMin); B(Math.cos(a) * r, yMin + rng() * (yMax - yMin), Math.sin(a) * r, RMin + rng() * (RMax - RMin), sc); } };
  if (shape === 'bush' || shape === 'hydra') { B(0, 0.42, 0, 0.32); ring(hi ? 4 : 2, 0.2, 0.3, 0.26, 0.36, 0.22, 0.3); return { crown: V(0, 0.3, 0), blobs }; }
  if (shape === 'hedge') { for (let i = 0; i < 5; i++) B(lerp(-0.4, 0.4, i / 4), 0.46, (rng() - 0.5) * 0.05, 0.3, V(1, 1.65, 1.15)); return { crown: V(0, 0.45, 0), blobs }; }
  if (shape === 'ivy') { for (let i = 0; i < 6; i++) B(lerp(-0.4, 0.4, (i % 3) / 2) + (rng() - 0.5) * 0.12, i < 3 ? 0.3 : 0.7, 0, 0.24 + rng() * 0.06, V(1, 1.1, 0.1)); return { crown: V(0, 0.5, -0.6), blobs }; }
  if (shape === 'oak') { B(0, 0.78, 0, 0.21); ring(hi ? 8 : 4, 0.2, 0.33, 0.5, 0.74, 0.14, 0.2); return { crown: V(0, 0.64, 0), blobs }; }
  if (shape === 'birch') { const n = hi ? 7 : 4; for (let i = 0; i < n; i++) { const t = i / (n - 1), a = rng() * TAU, r = 0.04 + rng() * 0.07; B(Math.cos(a) * r, lerp(0.44, 0.9, t), Math.sin(a) * r, (0.1 + rng() * 0.04) * (1 - 0.3 * t)); } return { crown: V(0, 0.68, 0), blobs }; }
  if (shape === 'zelkova') {
    // Mature zelkova: a tall vase made from many modest foliage masses at the ends of real branch fans.  The former
    // five huge balls hid the entire scaffold and produced the swollen crown shown in the bug reference.
    const a = rng() * TAU;
    B(Math.cos(a) * 0.025, 0.86, Math.sin(a) * 0.025, 0.125, V(0.9, 1.08, 0.9));
    ring(hi ? 14 : 6, 0.16, 0.36, 0.58, 0.84, 0.095, 0.145, V(0.92, 1.12, 0.92));
    if (hi) {
      ring(7, 0.08, 0.25, 0.77, 0.94, 0.075, 0.115, V(0.86, 1.14, 0.86));
      B(Math.cos(a + 1.4) * 0.3, 0.66, Math.sin(a + 1.4) * 0.3, 0.11, V(1, 1.04, 1));
    }
    return { crown: V(0, 0.75, 0), blobs };
  }
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
  const mult = { hydra: 1.2, birch: 1.3, hedge: 0.9, ivy: 1.6 }[shape] || 1;
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
  let stem; const trunkOf = pts => { stem = pts; return trunkGeo(pts, tseg); };
  const limbs = (y, r0, list, reach = 0.85, lift = -0.04) => { const A = axisAt(stem, y), from = A.p, r = Math.min(r0, A.r * 0.75);
    list.forEach(b => trunkParts.push(trunkGeo([{ p: from.clone(), r }, { p: V(b.c.x * 0.5, lerp(from.y, b.c.y, 0.55), b.c.z * 0.5), r: r * 0.6 }, { p: V(b.c.x * reach, b.c.y + lift, b.c.z * reach), r: r * 0.3 }], lseg, 6, ROOTED))); };
  const roots = (r, spread = 0.105) => { if (!hi) return; for (let k = 0; k < 5; k++) { const a = k / 5 * TAU + rng() * 0.35, L = spread * (0.72 + rng() * 0.45);
    trunkParts.push(trunkGeo([{ p: V(0, 0.045, 0), r: r * 0.55 }, { p: V(Math.cos(a) * L * 0.55, 0.015, Math.sin(a) * L * 0.55), r: r * 0.28 }, { p: V(Math.cos(a) * L, -0.008, Math.sin(a) * L), r: 0.002 }], 4, 6, ROOTED)); } };
  const scaffold = (y, r0, list, reach, lift, secondary = true) => {
    list.forEach((b, i) => {
      const A = axisAt(stem, y + (i % 3 - 1) * 0.018), from = A.p, r = Math.min(r0 * (0.86 + (i % 2) * 0.12), A.r * 0.72);
      const radial = V(b.c.x, 0, b.c.z).normalize(), side = V(-radial.z, 0, radial.x), mid = V(b.c.x * 0.46, lerp(from.y, b.c.y, 0.48), b.c.z * 0.46);
      mid.addScaledVector(side, (i % 2 ? 1 : -1) * 0.018);
      const tip = V(b.c.x * reach, b.c.y + lift, b.c.z * reach);
      trunkParts.push(trunkGeo([{ p: from.clone(), r }, { p: mid, r: r * 0.62 }, { p: tip, r: r * 0.24 }], lseg, 6, ROOTED));
      if (hi && secondary) for (const e of [-1, 1]) {
        const q = tip.clone().addScaledVector(side, e * b.R * (0.42 + rng() * 0.18)).add(V(0, b.R * (0.05 + rng() * 0.18), 0)).lerp(b.c, 0.28);
        trunkParts.push(trunkGeo([{ p: mid.clone().lerp(tip, 0.48), r: r * 0.28 }, { p: q, r: 0.0025 }], 4, 6, ROOTED));
      }
    });
  };
  if (shape === 'oak') {
    trunkParts = [trunkOf([{ p: V(0, 0, 0), r: 0.058 }, { p: V(0, 0.03, 0), r: 0.045 }, { p: V(0.015, 0.26, 0), r: 0.036 }, { p: V(0, 0.42, 0.01), r: 0.03 }])];
    limbs(0.38, 0.022, ring.slice(0, hi ? 6 : 3), 0.8);
  } else if (shape === 'birch') {
    const lx = (rng() - 0.5) * 0.04;
    trunkParts = [trunkOf([{ p: V(0, 0, 0), r: 0.022 }, { p: V(lx, 0.45, 0), r: 0.016 }, { p: V(lx * 0.3, 0.9, 0), r: 0.005 }])];
    if (hi) limbs(0.5, 0.008, ring.slice(0, 4), 0.8);
  } else if (shape === 'zelkova') { // the trunk forks low into many ascending limbs
    const a = rng() * TAU;
    trunkParts = [trunkOf([{ p: V(0, 0, 0), r: 0.058 }, { p: V(Math.cos(a) * 0.01, 0.05, Math.sin(a) * 0.01), r: 0.046 }, { p: V(Math.cos(a) * 0.018, 0.3, Math.sin(a) * 0.018), r: 0.035 }, { p: V(-Math.sin(a) * 0.012, 0.48, Math.cos(a) * 0.012), r: 0.024 }])];
    roots(0.058, 0.105);
    // Five principal, curved leaders make the characteristic vase; thin secondary forks disappear naturally into
    // the smaller crown lobes instead of ending as the old bundle of sawn-off poles.
    scaffold(0.38, 0.024, ring.slice(0, hi ? 5 : 4), 0.92, -0.015);
    if (hi) scaffold(0.5, 0.012, ring.slice(5, 12), 0.9, -0.01, false);
  } else if (shape === 'willow') {
    trunkParts = [trunkOf([{ p: V(0, 0, 0), r: 0.055 }, { p: V(0.03, 0.25, 0), r: 0.042 }, { p: V(0.02, 0.5, 0.01), r: 0.032 }])];
    limbs(0.48, 0.018, ring.slice(0, hi ? 6 : 3), 0.8);
  } else {
    trunkParts = [trunkOf([{ p: V(0, 0, 0), r: 0.036 }, { p: V(0.01, 0.3, 0.005), r: 0.026 }, { p: V(0, 0.62, 0), r: 0.016 }])];
    if (hi) for (const b of ring.slice(0, 4)) { const A = axisAt(stem, 0.42 + rng() * 0.12); trunkParts.push(trunkGeo([{ p: A.p, r: Math.min(0.013, A.r * 0.75) }, { p: b.c.clone().multiplyScalar(0.8), r: 0.006 }], 5, 6, ROOTED)); }
  }
  return { solid, cards: B.geometry(true), trunk: mergeGeometries(trunkParts) };
}

// ---------------------------------------------------------------- built trees: a real branch skeleton, foliage at its ends
// The zelkova and the garden pine are grown, not assembled: trunk -> scaffold limbs -> secondary branches -> twigs, and
// every foliage mass sits on the end of a branch (nothing floats, nothing hides an empty crown). A foliage mass is a
// clump: a lumpy, slightly flattened ball with a flatter, darker underside and a lit top, covered in leaf cards facing
// out — the way a painted tree is shaded in masses. Vertex colour carries the self-shadowing into the crown's core.
const bez = (a, b, c, r0, r1, n) => { const out = []; for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t;
  out.push({ p: V(u * u * a.x + 2 * u * t * b.x + t * t * c.x, u * u * a.y + 2 * u * t * b.y + t * t * c.y, u * u * a.z + 2 * u * t * b.z + t * t * c.z), r: lerp(r0, r1, Math.pow(t, 0.85)) }); } return out; };
const along = (pts, t) => { const s = [0]; for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + pts[i].p.distanceTo(pts[i - 1].p));
  const L = s[s.length - 1] * clamp(t, 0, 1); for (let i = 1; i < pts.length; i++) if (s[i] >= L) { const f = (L - s[i - 1]) / Math.max(1e-6, s[i] - s[i - 1]); return { p: pts[i - 1].p.clone().lerp(pts[i].p, f), r: lerp(pts[i - 1].r, pts[i].r, f), d: pts[i].p.clone().sub(pts[i - 1].p).normalize() }; }
  const n = pts.length; return { p: pts[n - 1].p.clone(), r: pts[n - 1].r, d: pts[n - 1].p.clone().sub(pts[n - 2].p).normalize() }; };
function clumpSolid(k, crownC, crownR, detail) {
  const g = new THREE.IcosahedronGeometry(1, detail), pos = g.attributes.position, nor = g.attributes.normal, col = [], d = V(0, 0, 0), q = V(0, 0, 0), nn = V(0, 0, 0);
  const sc = k.sc || V(1, 0.8, 1), flat = k.flat ?? 0.68, dark = k.dark ?? 0.42;
  for (let i = 0; i < pos.count; i++) {
    d.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
    q.copy(d).multiplyScalar(k.R * (1 + lump(d, k.s) * (k.rough ?? 1))).multiply(sc);
    if (q.y < 0) q.y *= flat;                                                    // a flatter underside
    q.add(k.c);
    pos.setXYZ(i, q.x, q.y, q.z);
    nn.set(d.x / sc.x, d.y / sc.y, d.z / sc.z).normalize().add(q.clone().sub(crownC).normalize().multiplyScalar(0.55)).normalize();
    nor.setXYZ(i, nn.x, nn.y, nn.z);
    const outer = clamp(q.distanceTo(crownC) / crownR, 0, 1), up = clamp(0.5 + d.y * 0.6, 0, 1);
    const ao = dark + (1 - dark) * (0.55 * outer + 0.45 * up);
    col.push(ao, ao, ao);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.deleteAttribute('uv');
  return g;
}
function clumpCards(B, rng, k, crownC, crownR, n, size = 0.85, upBias = 0.55) {
  const d = V(0, 0, 0), ax = V(0, 0, 0), ay = V(0, 0, 0), nn = V(0, 0, 0), sc = k.sc || V(1, 0.8, 1), flat = k.flat ?? 0.68, dark = k.dark ?? 0.42;
  for (let i = 0; i < n; i++) {
    d.set(rng() * 2 - 1, rng() * (1 + upBias) - 0.5, rng() * 2 - 1).normalize();
    const off = d.clone().multiplyScalar(k.R * (0.86 + 0.16 * rng())).multiply(sc); if (off.y < 0) off.y *= flat;
    const p = k.c.clone().add(off), s = k.R * (size + rng() * 0.3);
    ax.set(0, 1, 0).cross(d); if (ax.lengthSq() < 1e-3) ax.set(1, 0, 0); ax.normalize().applyAxisAngle(d, rng() * TAU); ay.copy(d).cross(ax).normalize();
    nn.copy(d).add(p.clone().sub(crownC).normalize().multiplyScalar(0.55)).normalize();
    const ao = dark + 0.12 + (0.88 - dark) * (0.55 * clamp(p.distanceTo(crownC) / crownR, 0, 1) + 0.45 * clamp(0.5 + d.y * 0.6, 0, 1));
    const ids = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => B.v(p.clone().addScaledVector(ax, u * s * 0.5).addScaledVector(ay, v * s * 0.5), nn, ao, [(u + 1) / 2, (v + 1) / 2]));
    B.tri(ids[0], ids[1], ids[2]); B.tri(ids[0], ids[2], ids[3]);
  }
}
// keep a point inside an ellipsoid envelope (c, radii) — the crown's designed silhouette
const intoEnvelope = (p, c, rx, ry, rz) => { const x = (p.x - c.x) / rx, y = (p.y - c.y) / ry, z = (p.z - c.z) / rz, e = Math.hypot(x, y, z); if (e > 1) p.set(c.x + x / e * rx, c.y + y / e * ry, c.z + z / e * rz); return p; };

// zelkova (欅), height 1: a short, slightly leaning trunk with root flare forks at about a quarter of the height into
// six or seven ascending scaffold limbs that sweep up and out (the species' vase), each with two or three secondary
// branches and twigs; the crown is a broad, round-topped fan of many modest leaf masses at those ends, irregular in
// outline and open enough that the limbs show between them. lod 1: the same skeleton with fewer, plainer masses;
// lod 2: eight masses on the limb ends and a plain trunk (same silhouette, a tenth of the triangles).
export function zelkovaGeo(lod = 0, seed = 29) {
  const rng = mulberry32(seed), hi = lod === 0, far = lod >= 2;
  const crownC = V(0, 0.6, 0), crownR = 0.46, ENV = [0.47, 0.4, 0.47];
  const la = rng() * TAU, lean = 0.012 + rng() * 0.018, fork = 0.23 + rng() * 0.06, lx = Math.cos(la) * lean, lz = Math.sin(la) * lean;
  // the trunk runs on up into the fork, thinning, and the limbs grow out of it from well below the fork, as wide as the
  // trunk there: the bark flows from trunk into limbs without a ledge (a stem ending in a cap with thinner limbs set on
  // top of it showed as a step all round the fork)
  const stem = [{ p: V(0, 0, 0), r: 0.056 }, { p: V(lx * 0.25, 0.05, lz * 0.25), r: 0.047 }, { p: V(lx * 0.7, fork * 0.6, lz * 0.7), r: 0.042 }, { p: V(lx, fork - 0.01, lz), r: 0.034 }];
  const wood = [trunkGeo(stem, [10, 6, 4][lod], 6, { tip: 0.5 })]; // (its end hidden among the limbs' roots)
  const clumps = [], nP = 6 + (rng() < 0.45 ? 1 : 0);
  let az = rng() * TAU;
  for (let i = 0; i < nP; i++) {
    az += TAU / nP * (0.78 + rng() * 0.44);
    const tilt = 0.38 + rng() * 0.3, L = 0.5 + rng() * 0.16, dx = Math.cos(az), dz = Math.sin(az);
    const base = V(lx + dx * 0.004, fork - 0.1 + rng() * 0.02, lz + dz * 0.004), up = base.clone().add(V(dx * 0.012, 0.085, dz * 0.012)); // (its open root end stays inside the trunk)
    const tip = intoEnvelope(base.clone().add(V(dx * Math.sin(tilt) * L * 1.15, Math.cos(tilt) * L, dz * Math.sin(tilt) * L * 1.15)), crownC, ENV[0] * 0.92, ENV[1] * 1.15, ENV[2] * 0.92);
    const ctrl = base.clone().add(V(dx * Math.sin(tilt) * L * 0.3, Math.cos(tilt) * L * 0.72, dz * Math.sin(tilt) * L * 0.3)).add(V((rng() - 0.5) * 0.04, 0, (rng() - 0.5) * 0.04));
    const r0 = 0.027 + rng() * 0.004, pts = [{ p: base, r: r0 }, ...bez(up, ctrl, tip, r0 * 0.92, 0.005, far ? 3 : hi ? 7 : 4)]; // (rising out of the trunk first)
    wood.push(trunkGeo(pts, [7, 4, 3][lod], 6, ROOTED));
    clumps.push({ c: tip.clone().add(V(dx * 0.02, 0.035, dz * 0.02)), R: (far ? 0.17 : 0.125) + rng() * 0.035, s: rng() * 10, sc: V(1.04, 0.9, 1.04) });
    if (!far) { const F = along(pts, 0.72); clumps.push({ c: F.p.clone().add(V(dx * 0.05, 0.05, dz * 0.05)), R: 0.1 + rng() * 0.03, s: rng() * 10, sc: V(1, 0.9, 1), dark: 0.36 }); } // filling the fan between the limb ends
    if (far) continue;
    const nS = hi ? 3 : 2;
    for (let j = 0; j < nS; j++) {
      const P = along(pts, 0.36 + j * (0.5 / nS) + rng() * 0.08), side = (j % 2 ? 1 : -1) * (0.45 + rng() * 0.45), saz = az + side;
      const st = tilt + 0.3 + rng() * 0.3, sl = 0.15 + rng() * 0.1, sd = V(Math.cos(saz) * Math.sin(st), Math.cos(st), Math.sin(saz) * Math.sin(st));
      const send = intoEnvelope(P.p.clone().addScaledVector(sd, sl), crownC, ENV[0], ENV[1], ENV[2]), smid = P.p.clone().lerp(send, 0.5).add(V(0, sl * 0.1, 0));
      const spts = bez(P.p, smid, send, Math.min(P.r * 0.72, 0.012), 0.0025, hi ? 4 : 3);
      wood.push(trunkGeo(spts, hi ? 5 : 3, 6, ROOTED));
      clumps.push({ c: send.clone().add(V(0, 0.03, 0)), R: 0.098 + rng() * 0.035, s: rng() * 10, sc: V(1, 0.9, 1) });
      if (hi) for (const e of [-1, 1]) { // twigs fanning off the branch end, one of them with a small mass
        const tq = along(spts, 0.55 + rng() * 0.2), td = V(Math.cos(saz + e * 0.9) * 0.7, 0.55 + rng() * 0.3, Math.sin(saz + e * 0.9) * 0.7).normalize(), tl = 0.06 + rng() * 0.04;
        const tend = intoEnvelope(tq.p.clone().addScaledVector(td, tl), crownC, ENV[0], ENV[1], ENV[2]);
        wood.push(trunkGeo([{ p: tq.p, r: Math.min(tq.r * 0.7, 0.005) }, { p: tend, r: 0.0015 }], 3, 6, ROOTED));
        if (e === (j % 2 ? 1 : -1)) clumps.push({ c: tend.clone().add(V(0, 0.02, 0)), R: 0.07 + rng() * 0.03, s: rng() * 10, sc: V(1, 0.92, 1) });
      }
    }
  }
  // the crown's top: a few masses over the leaders where the fan closes
  // (a rounded dome, not a flat lid: the masses up there are as tall as they are wide and stand higher in the middle)
  if (!far) for (let k = 0; k < (hi ? 6 : 3); k++) { const a = k / (hi ? 6 : 3) * TAU + rng() * 0.6, r = k ? 0.1 + rng() * 0.12 : rng() * 0.04;
    clumps.push({ c: V(Math.cos(a) * r, crownC.y + ENV[1] * (0.86 - r * 1.6 + rng() * 0.08), Math.sin(a) * r), R: 0.11 + rng() * 0.035, s: rng() * 10, sc: V(1, 1, 1) }); }
  const solid = mergeGeometries(clumps.map(k => clumpSolid(k, crownC, crownR, hi && k.R > 0.105 ? 2 : 1)));
  if (far) return { solid, trunk: mergeGeometries(wood) };
  const B = meshBuilder();
  for (const k of clumps) clumpCards(B, rng, k, crownC, crownR, hi ? Math.round(8 + k.R * 50) : 5);
  return { solid, cards: B.geometry(true), trunk: mergeGeometries(wood) };
}
// surface roots spreading from a trunk's foot (near LOD only)
const rootFlare = (wood, rng, a0, r, L0, n = 5) => { for (let k = 0; k < n; k++) { const a = a0 + k / n * TAU + rng() * 0.4, L = L0 * (0.75 + rng() * 0.5);
  wood.push(trunkGeo([{ p: V(0, 0.045, 0), r: r * 0.55 }, { p: V(Math.cos(a) * L * 0.55, 0.014, Math.sin(a) * L * 0.55), r: r * 0.27 }, { p: V(Math.cos(a) * L, -0.008, Math.sin(a) * L), r: 0.002 }], 5, 5, ROOTED)); } };
// close a crown's outline: masses just inside its envelope (c, radii E, centres at `inset` of it) wherever the
// branch-borne ones leave a gap, above yMin (in envelope radii from the centre) — the canopy then reads as one
// continuous, scalloped mass over the branch work instead of separate balls with sky between them
const fillCrown = (clumps, rng, c, E, n, R0, R1, mk, yMin = 0, inset = 0.82) => {
  const ga = Math.PI * (3 - Math.sqrt(5)), off = rng() * TAU;
  for (let i = 0; i < n; i++) {
    const y = 1 - (i + 0.5) / n * 2; if (y < yMin) break;
    const rr = Math.sqrt(1 - y * y), a = off + i * ga, R = R0 + rng() * (R1 - R0);
    const p = V(c.x + Math.cos(a) * rr * E[0] * inset, c.y + y * E[1] * inset, c.z + Math.sin(a) * rr * E[2] * inset);
    if (clumps.some(k => !k.core && k.c.distanceTo(p) < (k.R + R) * 0.6)) continue;
    clumps.push({ ...mk, c: p, R, s: rng() * 10, sc: mk.sc.clone() });
  }
};
// the crown's core: one big, lumpy, flat-bottomed mass filling the inside of the canopy (centre c, radii r), so no sky
// shows through between the masses on its surface (they bulge out of it, the gaps between them read as shade)
const crownCore = (c, r, dark = 0.3) => ({ core: true, c, R: 1, s: 3.7, sc: V(r[0], r[1], r[2]), flat: 0.62, dark, rough: 0.55 });
// a foliage mass of radius R at p held to the crown: inside the envelope (c, E) and near enough to the core to be grown
// into it, drawn in toward the core's centre as far as it must be — no mass hangs loose with sky all round it
const holdTo = (p, R, core, c, E) => {
  const d = p.clone().sub(c), e = Math.hypot(d.x / E[0], d.y / E[1], d.z / E[2]); if (e > 1) p.copy(c).addScaledVector(d, 1 / e);
  const q = p.clone().sub(core.c), m = R * 0.6, ry = q.y < 0 ? core.sc.y * core.flat : core.sc.y;
  const f = Math.hypot(q.x / (core.sc.x + m), q.y / (ry + m), q.z / (core.sc.z + m)); if (f > 1) p.copy(core.c).addScaledVector(q, 1 / f);
  return p;
};

// sakura (染井吉野), height 1: a short, stout, leaning trunk with a root flare forks low (about a quarter of the height)
// into four or five heavy limbs that arch up and far out — the tree is wider than it is tall — each dividing into side
// branches, the inner ones climbing into the crown, the outer ones spreading level. The blossom is one dense, broad, low
// umbrella: a core mass inside, many rounded masses bulging from it on the ends of the branches and all over the dome,
// darker beneath, where the dark limbs come out of it. lod 1: the same skeleton with fewer, plainer masses; lod 2: the
// core, a mass on each limb end and over the top, a plain trunk.
export function sakuraGeo(lod = 0, seed = 13) {
  const rng = mulberry32(seed), hi = lod === 0, far = lod >= 2;
  const la = rng() * TAU, lean = 0.03 + rng() * 0.03, fork = 0.23 + rng() * 0.05, lx = Math.cos(la) * lean, lz = Math.sin(la) * lean;
  const crownC = V(lx * 1.4, 0.62, lz * 1.4), crownR = 0.56, ENV = [0.54, 0.36, 0.54];
  const env = (p, f = 1, fy = 1) => intoEnvelope(p, crownC, ENV[0] * f, ENV[1] * fy, ENV[2] * f);
  const core = crownCore(V(crownC.x, crownC.y + ENV[1] * 0.1, crownC.z), [ENV[0] * 0.76, ENV[1] * 0.66, ENV[2] * 0.76]);
  const hold = (p, R) => holdTo(p, R, core, crownC, ENV);
  const stem = [{ p: V(0, 0, 0), r: 0.062 }, { p: V(lx * 0.2, 0.05, lz * 0.2), r: 0.051 }, { p: V(lx * 0.62, fork * 0.6, lz * 0.62), r: 0.046 }, { p: V(lx, fork, lz), r: 0.04 }];
  const wood = [trunkGeo(stem, [10, 6, 4][lod], 5, { tip: 0.5 })];
  if (hi) rootFlare(wood, rng, la, 0.062, 0.11);
  const clumps = [core], bl = { flat: 0.72, dark: 0.4, rough: 1.05 }, mass = (c, R, sc = 0.86, dark) => clumps.push({ ...bl, c, R, s: rng() * 10, sc: V(1.08, sc, 1.08), ...(dark ? { dark } : {}) });
  const nP = 4 + (rng() < 0.5 ? 1 : 0);
  let az = la + rng() * TAU;
  for (let i = 0; i < nP; i++) {
    az += TAU / nP * (0.75 + rng() * 0.5);
    const dx = Math.cos(az), dz = Math.sin(az), H = 0.36 + rng() * 0.1, Y = 0.24 + rng() * 0.1, R = (far ? 0.2 : 0.14) + rng() * 0.03;
    const base = V(lx + dx * 0.006, fork - 0.085 + rng() * 0.03, lz + dz * 0.006), up = base.clone().add(V(dx * 0.016, 0.07, dz * 0.016)); // (its open root end stays inside the trunk)
    const ctrl = base.clone().add(V(dx * H * 0.3, Y * 1.2, dz * H * 0.3)).add(V((rng() - 0.5) * 0.05, 0, (rng() - 0.5) * 0.05));
    const tip = hold(env(base.clone().add(V(dx * H, Y, dz * H)), 0.92, 1.3), R);              // arching: it rises, then runs out level
    const r0 = 0.03 + rng() * 0.005, pts = [{ p: base, r: r0 }, ...bez(up, ctrl, tip, r0 * 0.92, 0.006, far ? 3 : hi ? 7 : 5)];
    wood.push(trunkGeo(pts, [7, 5, 3][lod], 5, ROOTED));
    mass(tip.clone().add(V(dx * 0.03, 0.05, dz * 0.03)), R, 0.84);
    if (far) continue;
    { const F = along(pts, 0.62); mass(F.p.clone().add(V(0, 0.07, 0)), 0.11 + rng() * 0.025, 0.86, 0.34); }
    const nS = hi ? 4 : 3;
    for (let j = 0; j < nS; j++) {
      const t = 0.3 + j * (0.58 / nS) + rng() * 0.07, P = along(pts, t), inner = t < 0.5, sR = 0.11 + rng() * 0.03;
      const saz = az + (j % 2 ? 1 : -1) * (0.55 + rng() * 0.6), el = inner ? 0.75 + rng() * 0.35 : 0.2 + rng() * 0.3, sl = (inner ? 0.24 : 0.17) + rng() * 0.08;
      const sd = V(Math.cos(saz) * Math.cos(el), Math.sin(el), Math.sin(saz) * Math.cos(el));
      const send = env(P.p.clone().addScaledVector(sd, sl)); if (!inner) send.y -= 0.02;            // (the outer ends dip)
      hold(send, sR);
      const smid = P.p.clone().lerp(send, 0.5).add(V(0, sl * (inner ? 0.02 : 0.12), 0));
      const spts = bez(P.p, smid, send, Math.min(P.r * 0.72, 0.014), 0.003, hi ? 4 : 3);
      wood.push(trunkGeo(spts, hi ? 5 : 3, 5, ROOTED));
      mass(send.clone().add(V(0, 0.04, 0)), sR);
      if (hi) for (const e of [-1, 1]) { // twigs off the branch, one with a small mass of its own
        const tq = along(spts, 0.5 + rng() * 0.2), ta = saz + e * (0.7 + rng() * 0.4), te = Math.max(0.1, el - 0.2 + rng() * 0.4), tl = 0.07 + rng() * 0.04, tR = 0.08 + rng() * 0.025;
        const tend = hold(env(tq.p.clone().add(V(Math.cos(ta) * Math.cos(te) * tl, Math.sin(te) * tl, Math.sin(ta) * Math.cos(te) * tl))), tR);
        wood.push(trunkGeo([{ p: tq.p, r: Math.min(tq.r * 0.7, 0.005) }, { p: tend, r: 0.0015 }], 3, 5, ROOTED));
        if (e === (j % 2 ? 1 : -1)) mass(tend.clone().add(V(0, 0.025, 0)), tR, 0.88);
      }
    }
  }
  // the umbrella closed all over, down to a little under its widest (open beneath, where the limbs show)
  fillCrown(clumps, rng, crownC, ENV, far ? 20 : hi ? 76 : 44, far ? 0.16 : hi ? 0.11 : 0.13, far ? 0.2 : hi ? 0.14 : 0.16, { ...bl, sc: V(1.08, 0.86, 1.08) }, -0.25, 0.84);
  for (const k of clumps) if (!k.core) hold(k.c, k.R);
  const solid = mergeGeometries(clumps.map(k => clumpSolid(k, crownC, crownR, k.core ? (hi ? 3 : far ? 1 : 2) : hi && k.R > 0.12 ? 2 : 1)));
  if (far) return { solid, trunk: mergeGeometries(wood) };
  const B = meshBuilder();
  for (const k of clumps) if (!k.core) clumpCards(B, rng, k, crownC, crownR, hi ? Math.round(12 + k.R * 70) : 8, 0.85, 0.8);
  return { solid, cards: B.geometry(true), trunk: mergeGeometries(wood) };
}

// Japanese maple (いろは紅葉), height 1: a short trunk divides low into two to four slender, sinuous leaders leaning out
// and up; from each, slim branches reach out almost level in tiers, and the foliage lies on them in spreading layers
// round a dense core — a broad, close dome a little wider than tall, scalloped in layers, the dark branch work showing
// beneath it. lod 1: the same skeleton with fewer masses; lod 2: the core, a mass per tier and a plain trunk.
export function mapleGeo(lod = 0, seed = 31) {
  const rng = mulberry32(seed), hi = lod === 0, far = lod >= 2;
  const la = rng() * TAU, lean = 0.015 + rng() * 0.02, fork = 0.13 + rng() * 0.05, lx = Math.cos(la) * lean, lz = Math.sin(la) * lean;
  const crownC = V(lx, 0.57, lz), crownR = 0.52, ENV = [0.56, 0.41, 0.56];
  const env = (p, f = 1, fy = 1) => intoEnvelope(p, crownC, ENV[0] * f, ENV[1] * fy, ENV[2] * f);
  const core = crownCore(V(crownC.x, crownC.y + ENV[1] * 0.12, crownC.z), [ENV[0] * 0.76, ENV[1] * 0.66, ENV[2] * 0.76], 0.28);
  const hold = (p, R) => holdTo(p, R, core, crownC, ENV);
  const stem = [{ p: V(0, 0, 0), r: 0.048 }, { p: V(lx * 0.3, 0.04, lz * 0.3), r: 0.039 }, { p: V(lx, fork, lz), r: 0.033 }];
  const wood = [trunkGeo(stem, [9, 6, 4][lod], 6, { tip: 0.5 })];
  if (hi) rootFlare(wood, rng, la, 0.048, 0.085, 4);
  const clumps = [core], pl = { flat: 0.6, dark: 0.36, rough: 0.95 };
  const plate = (c, R, sq = 0.8) => clumps.push({ ...pl, c, R, s: rng() * 10, sc: V(1.2, sq, 1.2) });
  const nL = 3 + (rng() < 0.35 ? 1 : 0) - (rng() < 0.25 ? 1 : 0), tiers = far ? [0.42, 0.74] : hi ? [0.3, 0.47, 0.63, 0.79] : [0.34, 0.56, 0.78];
  let az = rng() * TAU;
  for (let i = 0; i < nL; i++) {
    az += TAU / nL * (0.8 + rng() * 0.4);
    const dx = Math.cos(az), dz = Math.sin(az), sd = V(-dz, 0, dx), tilt = 0.42 + rng() * 0.32, L = 0.72 + rng() * 0.12, wig = (rng() < 0.5 ? 1 : -1) * (0.018 + rng() * 0.014);
    const base = V(lx + dx * 0.004, fork - 0.06, lz + dz * 0.004), tR = (far ? 0.16 : 0.12) + rng() * 0.025;
    const tip = hold(env(base.clone().add(V(dx * Math.sin(tilt) * L, Math.cos(tilt) * L, dz * Math.sin(tilt) * L)), 0.72, 0.96), tR);
    const n = far ? 3 : hi ? 8 : 5, r0 = 0.024 + rng() * 0.004, pts = [{ p: base, r: r0 }];
    for (let k = 1; k <= n; k++) { const t = k / n, p = base.clone().lerp(tip, t);           // sinuous, bowed a little outward
      p.add(V(dx * Math.sin(Math.PI * t) * 0.035, 0, dz * Math.sin(Math.PI * t) * 0.035)).addScaledVector(sd, Math.sin(TAU * t) * wig);
      if (k === 1) p.set(base.x + dx * 0.012, base.y + 0.07, base.z + dz * 0.012);              // (rising out of the trunk first)
      pts.push({ p, r: lerp(r0 * 0.92, 0.005, Math.pow(t, 0.9)) }); }
    wood.push(trunkGeo(pts, [6, 4, 3][lod], 6, ROOTED));
    plate(tip.clone().add(V(0, 0.035, 0)), tR, 0.9);                                             // the leader's own top
    tiers.forEach((t0, j) => {
      const t = t0 + (rng() - 0.5) * 0.06, P = along(pts, t), baz = az + (j % 2 ? 1 : -1) * (0.5 + rng() * 0.9), blen = lerp(0.34, 0.16, t) * (0.85 + rng() * 0.3);
      const bd = V(Math.cos(baz), 0, Math.sin(baz)), bs = V(-bd.z, 0, bd.x), R = lerp(0.14, 0.11, t) * (0.9 + rng() * 0.2) * (far ? 1.35 : 1);
      const end = hold(env(P.p.clone().addScaledVector(bd, blen).add(V(0, blen * 0.14, 0))), R), mid = P.p.clone().lerp(end, 0.5).add(V(0, -0.012, 0));
      const bpts = bez(P.p, mid, end, Math.min(P.r * 0.72, 0.011), 0.0025, far ? 2 : hi ? 4 : 3);
      wood.push(trunkGeo(bpts, far ? 3 : 4, 6, ROOTED));
      plate(end.clone().add(V(0, 0.028, 0)), R);
      if (far) return;
      const M = along(bpts, 0.45); plate(M.p.clone().addScaledVector(bs, (rng() - 0.5) * 0.06).add(V(0, 0.045, 0)), R * 0.8); // filling along the branch
      if (hi) for (const e of [-1, 1]) { // twigs fanning off the end, each under a small mass
        const q = along(bpts, 0.62 + rng() * 0.12), wR = R * (0.7 + rng() * 0.12), te = hold(env(end.clone().addScaledVector(bs, e * R * (0.8 + rng() * 0.3)).addScaledVector(bd, -R * 0.35).add(V(0, 0.01, 0))), wR);
        wood.push(trunkGeo([{ p: q.p, r: Math.min(q.r * 0.7, 0.0045) }, { p: te, r: 0.0015 }], 3, 6, ROOTED));
        plate(te.clone().add(V(0, 0.022, 0)), wR);
      }
    });
  }
  // the dome closed all over, its crown first, down to a little under its widest (open beneath, where the leaders show)
  clumps.push({ ...pl, c: V(crownC.x + (rng() - 0.5) * 0.06, crownC.y + ENV[1] * 0.8, crownC.z + (rng() - 0.5) * 0.06), R: (far ? 0.17 : 0.13) + rng() * 0.02, s: rng() * 10, sc: V(1.2, 0.8, 1.2) });
  fillCrown(clumps, rng, crownC, ENV, far ? 18 : hi ? 72 : 42, far ? 0.15 : hi ? 0.105 : 0.12, far ? 0.19 : hi ? 0.13 : 0.15, { ...pl, sc: V(1.2, 0.82, 1.2) }, -0.3, 0.82);
  for (const k of clumps) if (!k.core) hold(k.c, k.R);
  const solid = mergeGeometries(clumps.map(k => clumpSolid(k, crownC, crownR, k.core ? (hi ? 3 : far ? 1 : 2) : hi && k.R > 0.1 ? 2 : 1)));
  if (far) return { solid, trunk: mergeGeometries(wood) };
  const B = meshBuilder();
  for (const k of clumps) if (!k.core) clumpCards(B, rng, k, crownC, crownR, hi ? Math.round(8 + k.R * 66) : 6, 0.95, 1.0);
  return { solid, cards: B.geometry(true), trunk: mergeGeometries(wood) };
}

// garden pine (庭木の松, cloud-pruned), height 1: a characterful trunk that leans and twists in an S, five tiers of long,
// near-horizontal limbs spiralling round it (each dips, kinks and lifts again toward its end) and on every limb end a
// cloud pad — a cushion of needle tufts, domed and lumpy on top, flatter beneath where the branch structure shows — plus
// a crowning pad on the leader. Needle-tuft cards (dark, radiating) make the pads read as foliage at any angle. lod 1:
// the same tree with fewer, plainer tufts.
export function gardenPineGeo(lod = 0, seed = 21) {
  const rng = mulberry32(seed), hi = lod === 0;
  const la = rng() * TAU, bx = Math.cos(la), bz = Math.sin(la), tx = -bz, tz = bx, sw = 0.12 + rng() * 0.08, tw = (rng() < 0.5 ? 1 : -1) * (0.02 + rng() * 0.02);
  const stem = [[0, 0, 0, 0.062], [-0.25, 0.17, 1, 0.052], [0.35, 0.36, -1.6, 0.043], [0.82, 0.55, 1, 0.032], [1.05, 0.71, -0.7, 0.022], [1.0, 0.86, 0, 0.011]]
    .map(([o, y, t, r]) => ({ p: V(bx * sw * o + tx * tw * t, y, bz * sw * o + tz * tw * t), r }));
  const wood = [trunkGeo(stem, hi ? 10 : 6)];
  if (hi) for (let k = 0; k < 5; k++) { const a = la + k / 5 * TAU + 0.3, L = 0.07 + (k % 2) * 0.025; // surface roots
    wood.push(trunkGeo([{ p: V(0, 0.04, 0), r: 0.03 }, { p: V(Math.cos(a) * L * 0.55, 0.012, Math.sin(a) * L * 0.55), r: 0.014 }, { p: V(Math.cos(a) * L, -0.008, Math.sin(a) * L), r: 0.002 }], 5, 5, ROOTED)); }
  const crownC = V(bx * sw * 0.6, 0.58, bz * sw * 0.6), crownR = 0.42, clumps = [], dk = { flat: 0.58, dark: 0.3 };
  const pad = (c, R, dir, top = false) => { // a cushion of tufts round c, stretched along the limb (dir)
    const ax = V(dir.x, 0, dir.z).normalize(), sx = V(-ax.z, 0, ax.x);
    clumps.push({ ...dk, c: c.clone(), R: R * 0.84, s: rng() * 10, sc: V(1, 0.5, 1), rough: 0.7 });                       // the pad's body
    const n = top ? 4 : hi ? 6 + Math.floor(rng() * 3) : 3;
    for (let k = 0; k < n; k++) { const b = k / n * TAU + rng() * 0.5, d = R * (0.45 + rng() * 0.32);
      const off = ax.clone().multiplyScalar(Math.cos(b) * d * 1.18).addScaledVector(sx, Math.sin(b) * d * 0.82);
      clumps.push({ ...dk, c: c.clone().add(off).add(V(0, R * (0.1 + rng() * 0.1), 0)), R: R * (0.46 + rng() * 0.14), s: rng() * 10, sc: V(1, 0.82, 1), rough: 1.3 }); }
    clumps.push({ ...dk, c: c.clone().add(V(0, R * 0.3, 0)), R: R * (0.5 + rng() * 0.1), s: rng() * 10, sc: V(1, 0.85, 1), rough: 1.3 });  // the crown of the pad
  };
  const tiers = 5, ys = [0.3, 0.42, 0.53, 0.63, 0.72];
  let az = la + Math.PI + (rng() - 0.5) * 0.6;                                             // the first limb balances the lean
  for (let i = 0; i < tiers; i++) {
    const f = i / (tiers - 1), y = ys[i] + (rng() - 0.5) * 0.03;
    const A = axisAt(stem, y), L = lerp(0.38, 0.17, f) * (0.85 + rng() * 0.3), d = V(Math.cos(az), 0, Math.sin(az)), sd = V(-d.z, 0, d.x), zig = (rng() < 0.5 ? 1 : -1) * 0.025;
    const p1 = A.p.clone().addScaledVector(d, L * 0.32).add(V(0, -0.018, 0)).addScaledVector(sd, zig);
    const p2 = A.p.clone().addScaledVector(d, L * 0.66).add(V(0, -0.004, 0)).addScaledVector(sd, -zig * 0.8);
    const p3 = A.p.clone().addScaledVector(d, L).add(V(0, 0.03, 0));
    const r0 = Math.min(A.r * 0.68, lerp(0.022, 0.012, f));
    const limb = [{ p: A.p.clone(), r: r0 }, { p: p1, r: r0 * 0.8 }, { p: p2, r: r0 * 0.58 }, { p: p3, r: r0 * 0.36 }];
    wood.push(trunkGeo(limb, hi ? 6 : 4, 6, ROOTED));
    const R = lerp(0.17, 0.105, f) * (0.88 + rng() * 0.24);
    pad(p3.clone().addScaledVector(d, R * 0.25).add(V(0, R * 0.22, 0)), R, d);
    if (hi) for (const e of [-1, 1]) { // twigs from the limb up into the pad's underside
      const q = along(limb, 0.62 + rng() * 0.1), te = p3.clone().addScaledVector(sd, e * R * 0.55).addScaledVector(d, -R * 0.1).add(V(0, R * 0.05, 0));
      wood.push(trunkGeo([{ p: q.p, r: Math.min(q.r * 0.7, 0.006) }, { p: te, r: 0.002 }], 3, 6, ROOTED)); }
    az += 2.39996 + (rng() - 0.5) * 0.45;                                                    // golden angle: the tiers spiral
  }
  const top = stem[stem.length - 1].p; pad(top.clone().add(V(0, 0.035, 0)), 0.1 + rng() * 0.02, V(bx, 0, bz), true);
  const solid = mergeGeometries(clumps.map(k => clumpSolid(k, crownC, crownR, hi && k.R > 0.07 ? 2 : 1)));
  const B = meshBuilder();
  for (const k of clumps) if (k.sc.y > 0.4) clumpCards(B, rng, k, crownC, crownR, hi ? 9 : 4, 1.0, 1.1); // needle tufts on the pads' tops and rims
  return { solid, cards: B.geometry(true), trunk: mergeGeometries(wood) };
}

// bamboo (height 1): one clump of 1-3 culms (the variant decides how many) — groves are built from many of them. A
// culm is a straight, slowly tapering tube with node rings every ~30 cm (painted bark), bare over its lower half. From
// the nodes of its upper half short, thin branches alternate left and right; each carries hanging fans of narrow
// leaves (cards), longer low in the crown and shorter toward the top, and the tip arches over and hangs a last spray.
// No solid foliage mass: the crown is only leaves, so it stays light and feathery at every distance (the far LODs keep
// fewer, larger sprays instead of switching to a blob).
export function bambooGeo(lod = 0, seed = 9, edge = false) {
  const rng = mulberry32(seed), B = meshBuilder(), culms = [], nC = 1 + (seed % 3);
  const tmp = V(0, 0, 0), ax = V(0, 0, 0), dn = V(0, 0, 0), nn = V(0, 0, 0);
  // one hanging spray: top edge centred on p, hanging along `out` and down, turned at random about its hanging axis
  const spray = (p, out, size, ao, axis) => {
    dn.set(out.x * 0.5 + (rng() - 0.5) * 0.35, -1, out.z * 0.5 + (rng() - 0.5) * 0.35).normalize();
    const a = rng() * TAU; tmp.set(Math.cos(a), 0, Math.sin(a)); ax.copy(tmp).cross(dn).normalize(); if (ax.lengthSq() < 1e-4) ax.set(1, 0, 0);
    nn.set(p.x - axis.x, 0, p.z - axis.z); if (nn.lengthSq() < 1e-8) nn.copy(out); nn.normalize().multiplyScalar(0.85).add(V(0, 0.45, 0)).normalize();
    const w = size * (0.8 + rng() * 0.3), h = size * (0.95 + rng() * 0.3);
    const P0 = p.clone().addScaledVector(ax, -w / 2), P1 = p.clone().addScaledVector(ax, w / 2), P2 = P1.clone().addScaledVector(dn, h), P3 = P0.clone().addScaledVector(dn, h);
    const i0 = B.v(P0, nn, ao, [0, 1]), i1 = B.v(P1, nn, ao, [1, 1]), i2 = B.v(P2, nn, ao * 0.9, [1, 0]), i3 = B.v(P3, nn, ao * 0.9, [0, 0]);
    B.tri(i0, i1, i2); B.tri(i0, i2, i3);
  };
  for (let c = 0; c < nC; c++) {
    const a0 = rng() * TAU, rr = c ? 0.014 + rng() * 0.022 : 0, bx = Math.cos(a0) * rr, bz = Math.sin(a0) * rr;
    const h = c ? 0.74 + rng() * 0.2 : 0.95 + rng() * 0.05;
    const la = c ? a0 + (rng() - 0.5) * 0.9 : rng() * TAU, lean = 0.01 + rng() * 0.028, arch = 0.07 + rng() * 0.06, ox = Math.cos(la), oz = Math.sin(la);
    const at = t => { const k = Math.max(0, t - 0.66) / 0.34, off = h * (lean * t + arch * k * k); return V(bx + ox * off, h * t - h * arch * 0.3 * k * k * k, bz + oz * off); };
    const r0 = (0.0038 + rng() * 0.0014) * (c ? 0.85 : 1), rad = t => r0 * (1 - 0.66 * Math.pow(t, 1.5));
    const ts = lod === 0 ? [0, 0.18, 0.36, 0.52, 0.64, 0.74, 0.82, 0.89, 0.95, 1] : lod === 1 ? [0, 0.4, 0.66, 0.84, 1] : [0, 0.62, 1];
    const cp = ts.map(t => ({ p: at(t), r: rad(t) }));
    culms.push(trunkGeo(cp, lod === 0 ? 6 : lod === 1 ? 4 : 3, 36));
    // (branches grow from the culm as built — its polyline — not from the curve it samples)
    const onCulm = t => { let j = 0; while (j + 2 < ts.length && ts[j + 1] < t) j++; return cp[j].p.clone().lerp(cp[j + 1].p, clamp((t - ts[j]) / (ts[j + 1] - ts[j]), 0, 1)); };
    // culms on a grove's sunlit rim (edge) carry leafy branches much lower down, closing the stand's side
    const axis = at(0.8), t0 = edge ? 0.16 + rng() * 0.1 : 0.42 + rng() * 0.1, nodes = Math.round((lod === 0 ? 20 : lod === 1 ? 12 : 7) * (edge ? 1.4 : 1)), big = lod === 0 ? 1 : lod === 1 ? 1.5 : 2.1;
    let side = la + Math.PI / 2;
    for (let k = 0; k < nodes; k++) {
      const t = t0 + (0.96 - t0) * (k + 0.3 + rng() * 0.4) / nodes, p = onCulm(t), f = (t - t0) / (0.96 - t0);
      side += Math.PI + (rng() - 0.5) * 1.2;                                                  // branches alternate
      const bl = h * (0.048 + rng() * 0.035) * (0.8 + 0.55 * Math.sin(Math.PI * Math.min(1, f * 1.2))) * (edge && t < 0.45 ? 0.75 : 1); // crown widest a little above its middle
      const out = V(Math.cos(side), 0, Math.sin(side)), dir = V(out.x, 0.5 + rng() * 0.35, out.z).normalize();
      const tip = p.clone().addScaledVector(dir, bl); tip.y -= bl * 0.25 * f;
      if (lod === 0) culms.push(trunkGeo([{ p, r: r0 * 0.2 }, { p: p.clone().lerp(tip, 0.5).add(V(0, bl * 0.06, 0)), r: r0 * 0.14 }, { p: tip, r: r0 * 0.06 }], 3, 36, ROOTED));
      const ns = lod === 0 ? 4 : 2, ao = 0.56 + 0.44 * f;
      for (let q = 0; q < ns; q++) spray(p.clone().lerp(tip, (q + 0.7) / ns), out, h * (0.06 + rng() * 0.025) * big, ao * (0.92 + rng() * 0.08), axis);
      if (lod < 2 && rng() < 0.55) spray(p.clone().lerp(tip, 0.3), out.clone().negate(), h * 0.05 * big, ao * 0.85, axis); // a small spray on the node
    }
    const top = at(1), dirT = V(ox, -0.2, oz);
    for (let q = 0; q < (lod === 2 ? 1 : 2); q++) spray(top, dirT, h * 0.06 * big, 1.0, axis);
  }
  return { solid: null, cards: B.geometry(true), trunk: mergeGeometries(culms) };
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
  jpine: { tex: 'needle', bark: ['pine_bark', 'diff', 0xb4a090], sway: 0.55 },
  maple: { tex: 'maple', bark: ['sakura_bark', 'diff', 0xbcaea4], sway: 1.5 },
  willow: { tex: 'lance', bark: ['pine_bark', 'diff', 0xb8a898], sway: 2.2 },
  bamboo: { tex: 'bamboo', bark: ['bamboo', null, 0xc2d67a], sway: 2.2 },
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
  if (M.solid) M.solid.name = kind + '_foliage'; if (M.cards) M.cards.name = kind + '_leaves'; if (M.trunk) M.trunk.name = kind + '_bark'; // (material library names, world/layer.js)
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
  jpine:   { mat: 'jpine', n: 3, geo: (l, v) => gardenPineGeo(Math.min(l, 1), 21 + v * 19), trunk: 0.05, small: true },
  sapling: { mat: 'fir', n: 1, geo: (l, v) => coniferGeo(Math.max(l, 1), 41 + v * 7, v ? 'spruce' : 'young'), trunk: 0, small: true, tiny: true },
  snag:    { mat: 'dead', n: 1, geo: (l, v) => deadGeo(l, 3 + v * 7, false), trunk: 0.034, trunkTint: true },
  broken:  { mat: 'dead', n: 1, geo: (l, v) => deadGeo(l, 5 + v * 11, true), trunk: 0.046, trunkTint: true },
  twigs:   { mat: 'dead', n: 1, geo: (l, v) => twigGeo(l, 5 + v * 3), trunk: 0, trunkTint: true, small: true, tiny: true, short: true },
  leaf:    { mat: 'leaf', n: 2, geo: (l, v) => broadleafGeo(l, 7 + v * 6, 'leaf'), trunk: 0.034 },
  oak:     { mat: 'oak', n: 1, geo: (l, v) => broadleafGeo(l, 19 + v * 5, 'oak'), trunk: 0.045 },
  birch:   { mat: 'birch', n: 1, geo: (l, v) => broadleafGeo(l, 23 + v * 9, 'birch'), trunk: 0.022 },
  zelkova: { mat: 'zelkova', n: 3, geo: (l, v) => zelkovaGeo(l, 29 + v * 17), trunk: 0.05, hiScale: 0.55 }, // (its mid LOD keeps the skeleton and masses: the detailed set need only be near)
  maple:   { mat: 'maple', n: 2, geo: (l, v) => mapleGeo(l, 31 + v * 23), trunk: 0.035, hiScale: 0.6 },
  willow:  { mat: 'willow', n: 1, geo: (l, v) => broadleafGeo(l, 37, 'willow'), trunk: 0.05 },
  sakura:  { mat: 'sakura', n: 2, geo: (l, v) => sakuraGeo(l, 13 + v * 19), trunk: 0.05, cardShadow: false, hiScale: 0.6 },
  bamboo:  { mat: 'bamboo', n: 9, geo: (l, v) => bambooGeo(l, 9 + v * 4, v >= 6), trunk: 0.0065, farCards: true, hiScale: 0.6 }, // v 6-8: grove-rim culms
};
// painted bark colour of trunks merged into the foliage mesh (mid / far LODs)
const BARK = { fir: '#524438', jpine: '#4b3c32', leaf: '#56483e', oak: '#544a42', birch: '#c9c6bf', zelkova: '#6a6158', maple: '#4c4541', willow: '#4a3f36', bamboo: '#869a4c', sakura: '#3e2e2e' };
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
  let solid = g.solid, trunk = g.trunk, cards = g.cards && M.cards && (!far || sp.farCards) ? g.cards : null;
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
// one species' parts at a level of detail ({geometry, material}) — for previews and the tree lab
export function treeParts(kind, lod = 0, v = 0) { const sp = SPECIES[kind]; return sp ? speciesParts(sp, materials(sp.mat), sp.geo(lod, v), lod) : []; }
// prefab names of the species in world files (world/<map>/prefabs.json)
const TREE_PREFAB = { young: 'tree_young_fir', spruce: 'tree_spruce', tall: 'tree_cedar', old: 'tree_old_fir', pine: 'tree_pine', jpine: 'tree_japanese_pine', sapling: 'sapling', snag: 'dead_tree', broken: 'broken_tree',
  twigs: 'twigs', leaf: 'tree_broadleaf', oak: 'tree_oak', birch: 'tree_birch', zelkova: 'tree_zelkova', maple: 'tree_maple', willow: 'tree_willow', sakura: 'tree_sakura', bamboo: 'bamboo' };
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
    const hiD = sp.short ? () => Q.ferns * 0.5 : sp.tiny ? () => Q.ferns * 1.1 : sp.small ? () => Q.treeHi * 0.55 : sp.mat === 'fir' ? () => Math.min(hiDist(), Q.treeHi * 0.6) : sp.hiScale ? () => hiDist() * sp.hiScale : hiDist;
    const loD = sp.short ? () => Q.ferns * 1.1 : sp.tiny ? () => Q.treeHi * 0.7 : sp.small ? () => Q.trees * 0.3 : farDist;
    const lods = [{ dist: hiD, parts: speciesParts(sp, M, sp.geo(0, v), 0) }, { dist: loD, parts: speciesParts(sp, M, sp.geo(1, v), 1) }];
    if (!sp.small) lods.push({ dist: () => Infinity, parts: speciesParts(sp, M, sp.geo(2, v), 2) });
    if ((MATS[sp.mat] || MATS.leaf).sway > 0) for (const lod of lods) for (const part of lod.parts) part.sway = true; // wind-swayed: shadows redrawn near (sky.js)
    withScatterMeta({ prefab: TREE_PREFAB[kind] || 'tree_' + kind, category: 'vegetation', field: sp.tiny || kind === 'twigs' ? 'forest_floor' : null }, () => new Scatter(list, lods, sp.tiny ? 128 : cell));
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
  withScatterMeta({ prefab: 'log', category: 'vegetation', field: 'forest_floor' }, () => new Scatter(items, lods, 96));
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
      } else new Scatter(asCards(list, kind), [{ dist: on, parts: card(kind) }], 4096); // (2-triangle cards that cast no shadow: wide cells, few draws)
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
  const lods = [{ dist: hiDist, parts: speciesParts(sp, M, hi, 0) }, { dist: farDist, parts: speciesParts(sp, M, lo, 1) }];
  if ((MATS[kind] || MATS.leaf).sway > 0) for (const lod of lods) for (const part of lod.parts) part.sway = true;
  withScatterMeta({ prefab: { hydra: 'hydrangea' }[kind] || kind, category: 'vegetation', field: kind === 'hedge' || kind === 'ivy' ? 'hedgerow' : null }, () => new Scatter(bushes, lods, 192));
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
const BROAD_BASE = { leaf: '#5aa646', oak: '#4c943e', camphor: '#3f8a3a', birch: '#93c85a', zelkova: '#61a848', maple: '#72b84a', mapleRed: '#b4503c', willow: '#9ccd5c', bamboo: '#a2cf58' };
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
