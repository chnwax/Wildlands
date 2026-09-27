// Ghibli-style trees, built to be shaded by the toon lighting rather than to look scanned:
//  - conifers: stacked solid cone tiers with scalloped, drooping rims (clean painted silhouettes, no alpha cut-outs)
//  - broadleaf trees: a crown of lumpy solid blobs wrapped in a fringe of leaf cards for a leafy outline
// Normals are smoothed toward each blob / the whole crown, so every tree reads as a soft painted shape with one bright
// sunlit side and one cool shaded side.
import { THREE, S, Q, mulberry32, lerp, phTex, Scatter, addCircle } from './core.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { windPatch } from './terrain.js';
import { CLOUD_SHADE_GLSL } from './clouds.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------- painted leaf-clump texture (white: tinted per tree)
let leafTex = null;
function leafTexture() {
  if (leafTex) return leafTex;
  const N = 256, cv = document.createElement('canvas'); cv.width = cv.height = N;
  const g = cv.getContext('2d'), rng = mulberry32(11);
  g.translate(N / 2, N / 2);
  // a rounded clump of overlapping round leaves: scalloped outline, lighter toward the top
  for (let i = 0; i < 90; i++) {
    const r = Math.sqrt(rng()) * N * 0.36, a = rng() * Math.PI * 2, x = Math.cos(a) * r, y = Math.sin(a) * r;
    const s = Math.round(lerp(175, 255, 0.5 - 0.5 * y / (N * 0.36)) * (0.9 + rng() * 0.1));
    g.fillStyle = `rgb(${s},${s},${s})`;
    g.save(); g.translate(x, y); g.rotate(rng() * Math.PI * 2);
    const L = N * (0.07 + rng() * 0.04), W = L * (0.62 + rng() * 0.2);
    g.beginPath(); g.moveTo(0, -L); g.quadraticCurveTo(W, -L * 0.1, 0, L); g.quadraticCurveTo(-W, -L * 0.1, 0, -L); g.fill();
    g.restore();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.anisotropy = 4;
  return (leafTex = t);
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

// ---------------------------------------------------------------- geometry helpers
function meshBuilder() {
  const P = [], N = [], C = [], UV = [], I = [];
  return {
    v(p, n, ao, uv = [0, 0]) { P.push(p.x, p.y, p.z); N.push(n.x, n.y, n.z); C.push(ao, ao, ao); UV.push(uv[0], uv[1]); return P.length / 3 - 1; },
    tri(a, b, c) { I.push(a, b, c); },
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
function trunkGeo(pts, segs) { // tapered tube along a polyline [{p, r}]
  const parts = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], len = a.p.distanceTo(b.p);
    const c = new THREE.CylinderGeometry(b.r, a.r, len, segs, 1, true);
    c.translate(0, len / 2, 0);
    c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), b.p.clone().sub(a.p).normalize()));
    c.translate(a.p.x, a.p.y, a.p.z);
    const uv = c.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * 2, uv.getY(k) * len * 6);
    parts.push(c);
  }
  return mergeGeometries(parts);
}
// smooth lumpy displacement on the unit sphere (same position -> same offset, so shared corners stay welded)
const lump = (d, s) => 0.11 * Math.sin(3.1 * d.x + s) * Math.sin(2.7 * d.y + 1.3 * s) * Math.sin(3.4 * d.z + 0.7 * s) + 0.05 * Math.sin(7.3 * d.x + 2.1 * d.z + s);

// ---------------------------------------------------------------- conifer: stacked scalloped cone tiers (height 1)
export function coniferGeo(hi, seed = 3) {
  const rng = mulberry32(seed), B = meshBuilder();
  const K = hi ? 7 : 4, SEG = hi ? 18 : 10;
  const axisC = V(0, 0.55, 0);
  const n = V(0, 0, 0), p = V(0, 0, 0);
  for (let k = 0; k < K; k++) {
    const f = K > 1 ? k / (K - 1) : 0;
    const yb = lerp(0.2, 0.74, Math.pow(f, 0.95)), R = lerp(0.29, 0.1, f), H = lerp(0.3, 0.24, f), ya = yb + H;
    const rot = rng() * 6.28, shade = 0.78 + 0.22 * f;
    const apex = B.v(V(0, ya, 0), V(0, 1, 0), shade);
    const mid = [], rim = [], under = [];
    for (let i = 0; i <= SEG; i++) {
      const a = rot + i / SEG * Math.PI * 2, cx = Math.cos(a), cz = Math.sin(a);
      const tip = i % 2 === 0, jag = 1 + (rng() - 0.5) * 0.1;
      // a slightly convex tier: the mid ring bulges out a little
      const rm = R * 0.58 * jag, ym = ya - H * 0.5;
      const rr = R * (tip ? 1.06 : 0.86) * jag, yr = yb - (tip ? R * 0.14 : -R * 0.02);
      const coneN = (r, y) => n.set(cx * H, R * 0.9, cz * H).normalize().add(p.set(cx * r, y, cz * r).sub(axisC).normalize().multiplyScalar(0.35)).normalize().clone();
      mid.push(B.v(V(cx * rm, ym, cz * rm), coneN(rm, ym), shade * 0.95));
      rim.push(B.v(V(cx * rr, yr, cz * rr), coneN(rr, yr), shade * (tip ? 1.05 : 0.92)));
      under.push(B.v(V(cx * rr * 0.98, yr + 0.002, cz * rr * 0.98), V(cx * 0.3, -1, cz * 0.3).normalize(), 0.45 + 0.15 * f));
    }
    const inner = B.v(V(0, yb + H * 0.3, 0), V(0, -1, 0), 0.35);
    for (let i = 0; i < SEG; i++) {
      B.tri(apex, mid[i + 1], mid[i]);
      B.tri(mid[i], mid[i + 1], rim[i]); B.tri(mid[i + 1], rim[i + 1], rim[i]);
      B.tri(inner, under[i], under[i + 1]);
    }
  }
  const trunk = trunkGeo([{ p: V(0, 0, 0), r: 0.03 }, { p: V(0, 0.5, 0), r: 0.014 }], hi ? 7 : 4);
  return { solid: B.geometry(false), trunk };
}

// far conifer: a few plain cone tiers (same silhouette and shading as the near tree, a tenth of the triangles)
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

// ---------------------------------------------------------------- blob crowns: lumpy solid blobs + card fringe (height ~1)
// shape: 'leaf' round broadleaf, 'sakura' wide umbrella crown on spreading dark branches, 'bush' / 'hydra' low shrubs
function crownLayout(shape, hi, rng) {
  const blobs = [];
  if (shape === 'sakura') {
    const nB = hi ? 9 : 5;
    for (let i = 0; i < nB; i++) {
      const a = i / nB * Math.PI * 2 + rng() * 0.5, r = i === 0 ? 0 : 0.2 + rng() * 0.14;
      blobs.push({ c: V(Math.cos(a) * r, i === 0 ? 0.74 : 0.52 + rng() * 0.16, Math.sin(a) * r), R: i === 0 ? 0.22 : 0.15 + rng() * 0.06, s: rng() * 10 });
    }
    return { crown: V(0, 0.6, 0), blobs };
  }
  if (shape === 'bush' || shape === 'hydra') {
    const nB = hi ? 5 : 3;
    for (let i = 0; i < nB; i++) {
      const a = i / nB * Math.PI * 2 + rng() * 0.8, r = i === 0 ? 0 : 0.2 + rng() * 0.1;
      blobs.push({ c: V(Math.cos(a) * r, i === 0 ? 0.42 : 0.26 + rng() * 0.1, Math.sin(a) * r), R: i === 0 ? 0.32 : 0.22 + rng() * 0.08, s: rng() * 10 });
    }
    return { crown: V(0, 0.3, 0), blobs };
  }
  const nB = hi ? 7 : 4;
  for (let i = 0; i < nB; i++) {
    const a = i / nB * Math.PI * 2 + rng() * 0.6, r = i === 0 ? 0 : 0.14 + rng() * 0.08;
    blobs.push({ c: V(Math.cos(a) * r, i === 0 ? 0.84 : 0.6 + rng() * 0.2, Math.sin(a) * r), R: i === 0 ? 0.2 : 0.14 + rng() * 0.06, s: rng() * 10 });
  }
  return { crown: V(0, 0.7, 0), blobs };
}
export function broadleafGeo(hi, seed = 7, shape = 'leaf', far = 0) {
  const rng = mulberry32(seed), { crown, blobs: all } = crownLayout(shape, hi, rng);
  // far: 1 = a few low-poly blobs, 2 = one blob (distant hillsides); no leaf cards or trunk
  const blobs = far ? all.slice(0, far > 1 ? 1 : 3).map((b, i) => far > 1 ? { c: V(0, 0.66, 0), R: 0.3, s: b.s } : i ? b : { ...b, R: b.R * 1.25 }) : all;
  const ico = new THREE.IcosahedronGeometry(1, far ? 0 : hi ? 2 : 1);
  const parts = [], d = V(0, 0, 0), q = V(0, 0, 0), nn = V(0, 0, 0);
  for (const b of blobs) {
    const g = ico.clone(), pos = g.attributes.position, nor = g.attributes.normal, col = [];
    for (let i = 0; i < pos.count; i++) {
      d.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
      q.copy(b.c).addScaledVector(d, b.R * (1 + lump(d, b.s)));
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
  for (const b of blobs) {
    const cards = (hi ? 16 : 6) * (shape === 'sakura' ? 1.4 : shape === 'hydra' ? 1.2 : 1) | 0;
    for (let k = 0; k < cards; k++) {
      d.set(rng() * 2 - 1, rng() * 1.6 - 0.5, rng() * 2 - 1).normalize();
      const c = b.c.clone().addScaledVector(d, b.R * (0.9 + 0.12 * rng())), size = b.R * (0.75 + rng() * 0.3);
      ax.set(0, 1, 0).cross(d); if (ax.lengthSq() < 1e-3) ax.set(1, 0, 0); ax.normalize().applyAxisAngle(d, rng() * 6.28);
      ay.copy(d).cross(ax).normalize();
      nn.copy(d).add(c.clone().sub(crown).normalize().multiplyScalar(0.7)).normalize();
      const ao = 0.6 + 0.4 * Math.min(1, Math.max(0, (c.y - crown.y + 0.25) / 0.5));
      const ids = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => B.v(c.clone().addScaledVector(ax, u * size * 0.5).addScaledVector(ay, v * size * 0.5), nn, ao, [(u + 1) / 2, (v + 1) / 2]));
      B.tri(ids[0], ids[1], ids[2]); B.tri(ids[0], ids[2], ids[3]);
    }
  }
  if (shape === 'bush' || shape === 'hydra') return { solid, cards: B.geometry(true), trunk: null };
  let trunkParts;
  if (shape === 'sakura') { // short stout trunk forking into dark spreading limbs that show under the blossom
    trunkParts = [trunkGeo([{ p: V(0, 0, 0), r: 0.05 }, { p: V(0.02, 0.22, 0), r: 0.04 }, { p: V(0, 0.34, 0.01), r: 0.034 }], hi ? 8 : 5)];
    for (const b of blobs.slice(1, hi ? 7 : 4)) {
      const mid = V(b.c.x * 0.5, 0.44 + rng() * 0.06, b.c.z * 0.5);
      trunkParts.push(trunkGeo([{ p: V(0, 0.32, 0), r: 0.022 }, { p: mid, r: 0.014 }, { p: V(b.c.x * 0.9, b.c.y - 0.04, b.c.z * 0.9), r: 0.007 }], hi ? 6 : 4));
    }
  } else {
    trunkParts = [trunkGeo([{ p: V(0, 0, 0), r: 0.036 }, { p: V(0.01, 0.3, 0.005), r: 0.026 }, { p: V(0, 0.62, 0), r: 0.016 }], hi ? 8 : 5)];
    if (hi) for (const b of blobs.slice(1, 5)) trunkParts.push(trunkGeo([{ p: V(0, 0.42 + rng() * 0.12, 0), r: 0.013 }, { p: b.c.clone().multiplyScalar(0.8), r: 0.006 }], 5));
  }
  return { solid, cards: B.geometry(true), trunk: mergeGeometries(trunkParts) };
}

// ---------------------------------------------------------------- materials
// shared foliage shading: toon lighting comes from toon.js; here a soft sky-tinted rim and sunlight through the leaves
function foliagePatch(m, key, amount, cards) {
  m.defines = { CLOUD_SHADE_VARYING: '' };
  m.onBeforeCompile = sh => {
    sh.uniforms.uSunViewDir = S.uSunViewDir; sh.uniforms.uSunCol = S.uSunCol; sh.uniforms.uAmbC = S.uAmb;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vCloudLit;\n' + CLOUD_SHADE_GLSL)
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
const mats = {};
function materials(kind) {
  if (mats[kind]) return mats[kind];
  const sway = { leaf: 1.6, sakura: 1.3, bush: 0.5, hydra: 0.5 }[kind] || 1;
  const solid = foliagePatch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, color: kind === 'hydra' ? 0x4c9a3e : 0xffffff }), 'toonSolid' + kind, sway, false);
  const solidDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }); windPatch(solidDepth, 'toonSolidDepth' + kind, sway);
  const M = { solid, solidDepth };
  if (kind !== 'fir') {
    const tex = kind === 'sakura' || kind === 'hydra' ? blossomTexture(kind) : leafTexture();
    M.cards = foliagePatch(new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, alphaTest: 0.5, alphaToCoverage: Q.msaa > 0, side: THREE.DoubleSide, roughness: 1, metalness: 0 }), 'toonCards' + kind, sway, true);
    M.cardDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest: 0.5 }); windPatch(M.cardDepth, 'toonCardsDepth' + kind, sway);
  }
  const bark = { leaf: ['sakura_bark', 'diff', 0xa07e66], sakura: ['sakura_bark', 'diff', 0x6a4a48], fir: ['fir_tree_01', 'bark_diff', 0x8e6e58] }[kind];
  if (bark) {
    M.trunk = new THREE.MeshStandardMaterial({ map: phTex(bark[0], bark[1], '1k', true), color: bark[2], roughness: 1 });
    windPatch(M.trunk, 'toonTrunk' + kind, sway);
  }
  return (mats[kind] = M);
}

// ---------------------------------------------------------------- forests
// trees: [{x,y,z,s,sx,r,tilt,tilt2,c}] -> LOD'd, cell-culled instanced forest with trunk colliders
function parts(kind, g, M, near) {
  // hydrangeas: a green leafy mound (untinted) under per-bush coloured flower heads
  const p = [{ geometry: g.solid, material: M.solid, tint: kind !== 'hydra', castShadow: true, depth: M.solidDepth }];
  // blossom cards cast no shadow: card-shaped shadow speckle reads as blotches on the soft pink crowns
  if (g.cards) p.push({ geometry: g.cards, material: M.cards, tint: true, castShadow: near && kind !== 'sakura' && kind !== 'hydra', depth: M.cardDepth });
  if (g.trunk) p.push({ geometry: g.trunk, material: M.trunk, castShadow: near });
  return p;
}
// Past the low LOD, trees switch to a far version instead of disappearing, so forests never thin out with distance.
function forest(trees, kind, geo, hiDist, farDist, trunkR, farGeo) {
  if (!trees.length) return;
  const M = materials(kind), hi = geo(true), lo = geo(false), lods = [{ dist: hiDist, parts: parts(kind, hi, M, true) }, { dist: farDist, parts: parts(kind, lo, M, false) }];
  if (farGeo) lods.push({ dist: () => Infinity, parts: [{ geometry: farGeo.solid, material: M.solid, tint: true, castShadow: false }] });
  new Scatter(trees, lods, 128);
  for (const t of trees) addCircle(t.x, t.z, trunkR * t.s * (t.sx || 1) + 0.05);
}
export function buildConiferForest(trees, { hiDist = () => Q.treeHi, farDist = () => Q.trees } = {}) {
  forest(trees, 'fir', coniferGeo, hiDist, farDist, 0.03, coniferFarGeo());
}
export function buildBroadleafForest(trees, { hiDist = () => Q.treeHi, farDist = () => Q.trees } = {}) {
  forest(trees, 'leaf', broadleafGeo, hiDist, farDist, 0.034, broadleafGeo(false, 7, 'leaf', 1));
}
export function buildSakura(trees, { hiDist = () => Q.treeHi, farDist = () => Q.trees } = {}) {
  forest(trees, 'sakura', (hi) => broadleafGeo(hi, 13, 'sakura'), hiDist, farDist, 0.05, broadleafGeo(false, 13, 'sakura', 1));
}
// ---------------------------------------------------------------- far tree cards (impostors)
// Painted silhouettes on camera-facing cards for the distant forest: unlike real geometry, a mip-mapped card averages
// out when a tree shrinks to a few pixels, so far hillsides read as soft forest instead of shimmering speckle.
// Atlas: two conifers and two broadleaf crowns; R = painted shading (lit crown, darker base and tier undersides), A = coverage.
let farTex = null;
function farCardTexture() {
  if (farTex) return farTex;
  const W = 128, H = 256, cv = document.createElement('canvas'); cv.width = W * 4; cv.height = H;
  const g = cv.getContext('2d'), rng = mulberry32(91);
  const grey = v => { const c = Math.round(Math.min(255, Math.max(0, v))); return `rgb(${c},${c},${c})`; };
  const conifer = (x0, seed) => {
    const r = mulberry32(seed), cx = x0 + W / 2, K = 7;
    g.fillStyle = grey(70); g.fillRect(cx - 3, H * 0.86, 6, H * 0.14);
    for (let k = 0; k < K; k++) {
      const f = k / (K - 1), yb = H * lerp(0.9, 0.3, f), th = H * lerp(0.3, 0.26, f), w = W * lerp(0.47, 0.16, f), ya = yb - th;
      g.fillStyle = grey(lerp(150, 250, f) * (0.92 + 0.08 * r()));
      g.beginPath(); g.moveTo(cx + (r() - 0.5) * 3, ya);
      const n = 6;
      for (let i = 0; i <= n; i++) { const t = i / n, x = cx + w - t * 2 * w, drop = (i % 2 ? -0.04 : 0.05) * H * (1 - f * 0.5); g.lineTo(x, yb + drop + (r() - 0.5) * 3); }
      g.closePath(); g.fill();
      g.globalCompositeOperation = 'source-atop'; // shade under each tier (drawn over by the next), only on painted pixels
      g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(cx - w * 0.8, yb - H * 0.025, w * 1.6, H * 0.03);
      g.globalCompositeOperation = 'source-over';
    }
  };
  const broadleaf = (x0, seed) => {
    const r = mulberry32(seed), cx = x0 + W / 2;
    g.fillStyle = grey(70); g.fillRect(cx - 4, H * 0.7, 8, H * 0.3);
    for (let i = 0; i < 26; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.3, x = cx + Math.cos(a) * d * W * 1.2, y = H * (0.42 + Math.sin(a) * d * 0.55), rad = W * (0.14 + r() * 0.1);
      g.fillStyle = grey(lerp(250, 150, (y - H * 0.2) / (H * 0.5)) * (0.9 + 0.1 * r()));
      g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill();
    }
  };
  conifer(0, 5); conifer(W, 9); broadleaf(W * 2, 13); broadleaf(W * 3, 17);
  rng();
  farTex = new THREE.CanvasTexture(cv);
  farTex.colorSpace = THREE.NoColorSpace; farTex.wrapS = farTex.wrapT = THREE.ClampToEdgeWrapping; farTex.anisotropy = 4;
  return farTex;
}
const farCardMats = {};
function farCardMaterial(kind) {
  if (farCardMats[kind]) return farCardMats[kind];
  const m = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, alphaTest: 0.5, alphaToCoverage: Q.msaa > 0 });
  m.defines = { CLOUD_SHADE_VARYING: '' };
  const col0 = kind === 'fir' ? 0 : 2, wid = kind === 'fir' ? 0.64 : 0.95;
  m.onBeforeCompile = sh => {
    sh.uniforms.tFar = { value: farCardTexture() };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFarUv; varying float vCloudLit;\n' + CLOUD_SHADE_GLSL)
      .replace('#include <beginnormal_vertex>', `
        vec3 fc = instanceMatrix[3].xyz;
        float fsx = length(instanceMatrix[0].xyz), fsy = length(instanceMatrix[1].xyz);
        vec2 fto = normalize(cameraPosition.xz - fc.xz + 1e-4);
        vec3 fright = vec3(fto.y, 0.0, -fto.x);
        vec3 fwp = fc + fright * position.x * fsx * ${wid.toFixed(2)} + vec3(0.0, position.y * fsy, 0.0);
        // a rounded crown: the card's normal bends out to the sides and up, so the sun side of each tree is brighter
        vec3 objectNormal = normalize(fright * position.x * 1.3 + vec3(0.0, 0.35 + position.y * 0.9, 0.0) + vec3(fto.x, 0.0, fto.y) * 0.6);
        float fcol = ${col0.toFixed(1)} + step(0.5, fract(fc.x * 0.1234 + fc.z * 0.3711));
        vFarUv = vec2((fcol + position.x + 0.5) / 4.0, position.y);
        vCloudLit = cloudShade(fwp);`)
      .replace('#include <defaultnormal_vertex>', 'vec3 transformedNormal = normalMatrix * objectNormal;')
      .replace('#include <project_vertex>', 'vec4 mvPosition = viewMatrix * vec4(fwp, 1.0); gl_Position = projectionMatrix * mvPosition;')
      .replace('#include <worldpos_vertex>', 'vec4 worldPosition = vec4(fwp, 1.0);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tFar; varying vec2 vFarUv;')
      .replace('#include <map_fragment>', `
        vec4 ftc = texture2D(tFar, vFarUv);
        vec2 ftdx = dFdx(vFarUv * vec2(512.0, 256.0)), ftdy = dFdy(vFarUv * vec2(512.0, 256.0));
        float flod = 0.5 * log2(max(max(dot(ftdx, ftdx), dot(ftdy, ftdy)), 1e-6));
        diffuseColor.a = ftc.a * (1.0 + max(flod, 0.0) * 0.35);   // mip levels lose coverage: keep far crowns solid
        diffuseColor.rgb *= 0.35 + 0.75 * ftc.r;`);
  };
  m.customProgramCacheKey = () => 'farCard' + kind;
  return (farCardMats[kind] = m);
}
let farCardGeo = null;
const cardGeo = () => farCardGeo || (farCardGeo = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0));

// far forest on the outer terrain: sets[i] = {fir, leaf} per distance ring; ring i is drawn while i < Q.far. The first
// ring switches to even simpler trees past ~700 m; outer rings use the simplest version throughout.
export function buildFarForest(sets, rings) {
  const fir = materials('fir'), leaf = materials('leaf');
  const g = { fir: coniferFarGeo(3, 6), leaf: broadleafGeo(false, 7, 'leaf', 1) };
  const solid = (geo, M) => [{ geometry: geo.solid, material: M.solid, tint: true, castShadow: false }];
  const card = kind => [{ geometry: cardGeo(), material: farCardMaterial(kind), tint: true, castShadow: false, receiveShadow: false }];
  sets.forEach((set, i) => {
    const on = () => i < (Q.far || 1) ? Infinity : -1;
    for (const [list, M, kind] of [[set.fir, fir, 'fir'], [set.leaf, leaf, 'leaf']]) {
      if (!list.length) continue;
      if (i > 0) for (const t of list) { t.r = 0; t.tilt = 0; t.tilt2 = 0; }
      const lods = i === 0 ? [{ dist: () => (i < (Q.far || 1) ? 900 : -1), parts: solid(g[kind], M) }, { dist: on, parts: card(kind) }] : [{ dist: on, parts: card(kind) }];
      new Scatter(list, lods, i === 0 ? 256 : 1024);
    }
  });
}

// shrubs: no trunk collider worth having below ~1 m; only the big ones block
export function buildBushes(bushes, kind = 'bush', { hiDist = () => Q.treeHi * 0.6, farDist = () => Q.trees * 0.35 } = {}) {
  if (!bushes.length) return;
  const M = materials(kind), hi = broadleafGeo(true, kind === 'hydra' ? 21 : 17, kind), lo = broadleafGeo(false, kind === 'hydra' ? 21 : 17, kind);
  new Scatter(bushes, [{ dist: hiDist, parts: parts(kind, hi, M, true) }, { dist: farDist, parts: parts(kind, lo, M, false) }], 96);
  for (const b of bushes) if (b.s > 1.2) addCircle(b.x, b.z, 0.35 * b.s);
}

// painted palettes, picked per tree
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
