// Railway: double track (1067 mm gauge), catenary, tunnels, girder bridge, station, level crossings, EMU trains.
import { THREE, scene, S, clamp, lerp, smoothstep, mulberry32, addBox, addCircle, addPlatform } from './core.js';
import { GeoBuilder, materials, canvasTex, signMesh, JP_FONT, night, lampPoints, glowMats, wireMat } from './townkit.js';
import { Emitter, audio } from './audio.js';
import { stationBuilding } from './station.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const RAIL = { z: [-82.1, -77.9], gauge: 1.067, portal: 700, portalW: 700, portalE: 700, stationX: -8, platformLen: 100 };
// tunnel portal headwall set into the hillside: arched opening, cornice, wing walls down the cutting banks, dark bore.
// (x, y, z) = centre of the opening at formation level; sx = +1 facing west (tunnel runs toward +x), -1 the other way
// A tunnel portal that plugs the end of a cutting exactly: the headwall's outline is the cross-section between the cut
// (bottom(dz), height above the formation on the valley side) and the natural hillside behind it (top(dz)), so the
// heightfield's step from cutting to hill is hidden inside the wall and the hill runs straight down onto its coping.
// The face stands at xFace; the wall reaches back to xBack; `capAt` metres behind the face the bore turns to darkness
// (a black arch, so trains vanish into the hill). cutDepth(dz) > 0 where the cutting is dug in (the wall's extent).
// z: track axis; sx: -1 west end, +1 east end.
export function tunnelPortal(MT, { xFace, xBack, y, z, sx, archW = 10, archH = 9.5, capAt = 2, top, bottom, cutDepth, dzMin = -80, dzMax = 80 }) {
  const grp = new THREE.Group(); grp.position.set(xFace, y, z); grp.rotation.y = sx > 0 ? -Math.PI / 2 : Math.PI / 2; scene.add(grp);
  const toDz = lx => lx * (sx > 0 ? 1 : -1);            // local x -> world z offset from the axis
  const T = lx => top(toDz(lx)), Bt = lx => bottom(toDz(lx));
  const reach = dir => { let lx = archW / 2 + 1; const ok = l => { const d = toDz(l * dir); return d > dzMin && d < dzMax; }; while (ok(lx + 0.5) && cutDepth(toDz(lx * dir)) > 0.25) lx += 0.5; return lx + 0.5; };
  const L = reach(-1), R = reach(1), lo = [], up = [];
  for (let lx = -L; lx < R; lx += 1) lo.push([lx, Math.min(Bt(lx), T(lx)) - 1.2]);
  lo.push([R, Math.min(Bt(R), T(R)) - 1.2]);
  for (let lx = R; lx > -L; lx -= 1) up.push([lx, Math.max(T(lx), Bt(lx)) + 0.4]);
  up.push([-L, Math.max(T(-L), Bt(-L)) + 0.4]);
  const shape = new THREE.Shape(); shape.moveTo(lo[0][0], lo[0][1]);
  for (const [a, b] of [...lo.slice(1), ...up]) shape.lineTo(a, b);
  const r = archW / 2, archPath = p => { p.moveTo(-r, -0.5); p.lineTo(r, -0.5); p.lineTo(r, archH - r); p.absarc(0, archH - r, r, 0, Math.PI, false); p.lineTo(-r, -0.5); return p; };
  shape.holes.push(archPath(new THREE.Path()));
  const depth = Math.abs(xBack - xFace) + 0.6;
  // GeoBuilder materials take their tint from vertex colours
  const tint = (g, c) => { const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set(c, i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
  const add = (geo, mat, px = 0, py = 0, pz = 0, c = [0.78, 0.78, 0.75]) => { const m = new THREE.Mesh(tint(geo, c), mat); m.position.set(px, py, pz); m.castShadow = m.receiveShadow = true; grp.add(m); return m; };
  const uvScale = g => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.25, uv.getY(i) * 0.25); return g; };
  add(uvScale(new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 20 })), MT.concrete, 0, 0, -depth + 0.3);
  // coping along the top edge, slightly proud of the face
  const cop = new THREE.Shape(); cop.moveTo(up[0][0], up[0][1]);
  for (const [a, b] of up.slice(1)) cop.lineTo(a, b);
  for (const [a, b] of [...up].reverse()) cop.lineTo(a, b + 0.45);
  add(uvScale(new THREE.ExtrudeGeometry(cop, { depth: depth + 0.35, bevelEnabled: false })), MT.concrete, 0, 0, -depth + 0.3, [0.66, 0.66, 0.64]);
  add(new THREE.TorusGeometry(r + 0.35, 0.35, 6, 28, Math.PI), MT.concrete, 0, archH - r, 0.45, [0.7, 0.7, 0.68]); // arch ring
  for (const s2 of [-1, 1]) add(new THREE.BoxGeometry(0.9, archH - r + 0.5, 0.5), MT.concrete, s2 * (r + 0.35), (archH - r) / 2 - 0.25, 0.45, [0.7, 0.7, 0.68]);
  // name plaque over the arch (tunnel name, and its length in metres)
  const pl = signMesh(3.2, 0.62, (g, W, H) => { g.fillStyle = '#4a4640'; g.fillRect(0, 0, W, H); g.fillStyle = '#e6dfcf'; g.fillRect(5, 5, W - 10, H - 10);
    g.fillStyle = '#2b2722'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `bold ${H * 0.42}px ${JP_FONT}`; g.fillText(archW > 12 ? '桜川トンネル' : '桜峠トンネル', W / 2, H * 0.4);
    g.font = `${H * 0.2}px ${JP_FONT}`; g.fillText(archW > 12 ? 'SAKURAGAWA TUNNEL  L=640m' : 'SAKURA-TOGE TUNNEL  L=820m', W / 2, H * 0.78); }, 0.05, 256);
  pl.position.set(0, archH + 1.05, 0.33); grp.add(pl);
  const cap = new THREE.Mesh(new THREE.ShapeGeometry(archPath(new THREE.Shape()), 20), new THREE.MeshBasicMaterial({ color: 0x030304, fog: false }));
  cap.position.set(0, 0, -capAt); grp.add(cap);
  return grp;
}
// ground level y0: ballast top = y0 + 0.2, rail top = y0 + 0.45
export function railTop(y0) { return y0 + 0.45; }

const stripeTex = canvasTex(256, 32, (g, W, H) => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#111' : '#f2c200'; g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32 + 32, 0); g.lineTo(i * 32 + 16, H); g.lineTo(i * 32 - 16, H); g.fill(); } });
stripeTex.wrapS = THREE.RepeatWrapping;

export function buildRailway(ctx) {
  const { y0, riverX, B } = ctx, MT = materials();
  const rt = railTop(y0), X0 = -RAIL.portalW - 60, X1 = RAIL.portalE + 60;
  const rx = riverX(-80);
  // ballast bed (trapezoid) along the whole line
  for (let x = X0; x < X1; x += 25) {
    B.frame(0, 0, 0, 0);
    const xa = x, xb = Math.min(X1, x + 25), zc = -80, hw = 5.6, tw = 4.6, yb = y0 - 0.25, yt = y0 + 0.2;
    B.quad('ballast', [xa, yt, zc + tw], [xb, yt, zc + tw], [xb, yt, zc - tw], [xa, yt, zc - tw], { uv: 2 });
    B.quad('ballast', [xa, yb, zc + hw], [xb, yb, zc + hw], [xb, yt, zc + tw], [xa, yt, zc + tw], { uv: 2 });
    B.quad('ballast', [xb, yb, zc - hw], [xa, yb, zc - hw], [xa, yt, zc - tw], [xb, yt, zc - tw], { uv: 2 });
  }
  // rails (steel, slightly rusty sides)
  for (const tz of RAIL.z) for (const side of [-1, 1]) {
    const z = tz + side * RAIL.gauge / 2;
    for (let x = X0; x < X1; x += 50) {
      B.frame(0, 0, 0, 0);
      B.box('metal', Math.min(x + 25, X1 - 25), y0 + 0.28, z, 50, 0.13, 0.07, { color: [0.36, 0.26, 0.2] });
      B.box('steel', Math.min(x + 25, X1 - 25), y0 + 0.41, z, 50, 0.04, 0.065, { color: [1, 1, 1] });
    }
  }
  // concrete sleepers (instanced)
  const sl = []; for (const tz of RAIL.z) for (let x = X0; x < X1; x += 0.62) sl.push([x, tz]);
  const sleeper = new THREE.InstancedMesh(new THREE.BoxGeometry(0.24, 0.16, 2.0), new THREE.MeshStandardMaterial({ color: 0x8a8884, roughness: 0.95 }), sl.length);
  const m4 = new THREE.Matrix4();
  sl.forEach(([x, z], i) => sleeper.setMatrixAt(i, m4.makeTranslation(x, y0 + 0.22, z)));
  sleeper.receiveShadow = true; sleeper.castShadow = false; sleeper.frustumCulled = false; scene.add(sleeper);

  // catenary: portal-frame masts every 50 m with contact + messenger wires
  const cw = [];
  for (let x = X0 + 20; x < X1 - 10; x += 50) {
    if (Math.abs(x - rx) < 22) continue;
    B.frame(x, y0, 0, 0);
    for (const z of [-86.6, -73.4]) { B.box('metal', 0, -0.4, z, 0.3, 8.1, 0.25, { color: [0.45, 0.47, 0.46] }); addBox(x, z, 0.18, 0.15, 0); }
    B.box('metal', 0, 7.5, -80, 0.2, 0.35, 13.6, { color: [0.45, 0.47, 0.46] });
    for (const tz of RAIL.z) { B.box('metal', 0, 6.25, tz, 0.06, 1.25, 0.06, { color: [0.4, 0.4, 0.4] }); B.box('plastic', 0, 6.0, tz, 0.12, 0.25, 0.12, { color: [0.6, 0.35, 0.2] }); }
  }
  for (const tz of RAIL.z) for (let x = X0 + 20; x < X1 - 60; x += 50) {
    const zz = (i) => tz + (i % 2 ? 0.2 : -0.2);
    const a = [x, rt + 4.85, zz(x / 50)], b = [x + 50, rt + 4.85, zz(x / 50 + 1)];
    for (let s = 0; s < 4; s++) { const t0 = s / 4, t1 = (s + 1) / 4; cw.push(lerp(a[0], b[0], t0), a[1], lerp(a[2], b[2], t0), lerp(a[0], b[0], t1), a[1], lerp(a[2], b[2], t1)); }  // contact wire (zig-zag stagger)
    for (let s = 0; s < 16; s++) { const t0 = s / 16, t1 = (s + 1) / 16, sag = t => 0.5 * 4 * t * (1 - t); cw.push(lerp(a[0], b[0], t0), rt + 6.0 - sag(t0), tz, lerp(a[0], b[0], t1), rt + 6.0 - sag(t1), tz); } // messenger
    for (let s = 1; s < 8; s++) { const t = s / 8, xh = lerp(a[0], b[0], t); cw.push(xh, rt + 6.0 - 0.5 * 4 * t * (1 - t), tz, xh, a[1], lerp(a[2], b[2], t)); }                          // droppers
  }
  // anti-aliased by pixel coverage like the town's overhead wires (a hard 1-px line would crawl and sparkle)
  const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(cw, 3));
  const cl = new THREE.LineSegments(cg, wireMat); cl.frustumCulled = false; scene.add(cl);

  // tunnel portals: set into the hills by the map (town.js), which knows the terrain they must plug

  // river bridge: concrete deck, steel plate girders, piers
  B.frame(rx, y0, -80, 0);
  B.box('concrete', 0, -1.0, 0, 38, 1.2, 11.5, { color: [0.72, 0.72, 0.7], uv: 3 });
  for (const z of [-4.2, 4.2]) B.box('metal', 0, -2.4, z, 38, 1.4, 0.35, { color: [0.36, 0.42, 0.5] });
  for (const px of [-8, 8]) B.box('concrete', px, -8, 0, 2.2, 6.6, 9, { color: [0.68, 0.68, 0.66], uv: 3 });
  for (const z of [-5.8, 5.8]) { B.box('metal', 0, 0.2, z, 38, 1.0, 0.08, { color: [0.4, 0.45, 0.5] }); }
  addPlatform(rx, -80, 19, 5.75, 0, y0 + 0.2);

  // ---------------------------------------------------------------- station
  const sx0 = RAIL.stationX - RAIL.platformLen / 2, sx1 = RAIL.stationX + RAIL.platformLen / 2, ptop = rt + 1.0 - 0.1;
  const platforms = [{ z0: -76.35, z1: -73.2, side: 1 }, { z0: -86.8, z1: -83.65, side: -1 }];
  for (const P of platforms) {
    B.frame(0, 0, 0, 0);
    const zc = (P.z0 + P.z1) / 2, dz = P.z1 - P.z0, edge = P.side > 0 ? P.z0 : P.z1;
    B.box('concrete', (sx0 + sx1) / 2, y0 - 0.3, zc, sx1 - sx0, ptop - y0 + 0.3, dz, { color: [0.74, 0.74, 0.72], skip: 'py', uv: 3 });
    B.box('pavement', (sx0 + sx1) / 2, ptop - 0.001, zc, sx1 - sx0, 0.001, dz, { color: [0.9, 0.9, 0.88], uv: 1.5, skip: 'ny' });
    B.box('plain', (sx0 + sx1) / 2, ptop, edge + P.side * 0.12, sx1 - sx0, 0.01, 0.2, { color: [0.95, 0.95, 0.93] });
    { const tz = edge + P.side * 0.95, ty = ptop + 0.004, L = sx1 - sx0; // warning blocks along the platform edge
      B.poly('tactileD', [[sx0, ty, tz - 0.15], [sx1, ty, tz - 0.15], [sx1, ty, tz + 0.15], [sx0, ty, tz + 0.15]], [0, 1, 0], { uvs: [[0, 0], [L / 0.3, 0], [L / 0.3, 1], [0, 1]] }); }
    addPlatform((sx0 + sx1) / 2, zc, (sx1 - sx0) / 2, dz / 2, 0, ptop);
    // canopy over the middle
    const c0 = RAIL.stationX - 24, c1 = RAIL.stationX + 24, back = P.side > 0 ? P.z1 - 0.8 : P.z0 + 0.8;
    for (let x0 = c0; x0 <= c1; x0 += 8) { const dx = x0 - (RAIL.stationX + 6), x = P.side > 0 && Math.abs(dx) < 2.6 ? RAIL.stationX + 6 + 2.7 * (Math.sign(dx) || 1) : x0; // clear of the station door
      B.frame(x, ptop, back, 0); B.box('metal', 0, 0, 0, 0.2, 3.3, 0.2, { color: [0.3, 0.33, 0.36] }); addBox(x, back, 0.15, 0.15, 0); }
    B.frame(0, 0, 0, 0);
    const cz0 = P.side > 0 ? P.z0 + 0.3 : P.z0 - 0.4, cz1 = P.side > 0 ? P.z1 + 0.4 : P.z1 - 0.3;
    B.quad('roofMetal', [c0 - 1, ptop + 3.4, cz1], [c1 + 1, ptop + 3.4, cz1], [c1 + 1, ptop + 3.6, cz0], [c0 - 1, ptop + 3.6, cz0], { color: [0.55, 0.57, 0.58], uv: 2 });
    B.quad('plain', [c1 + 1, ptop + 3.4, cz1], [c0 - 1, ptop + 3.4, cz1], [c0 - 1, ptop + 3.6, cz0], [c1 + 1, ptop + 3.6, cz0], { color: [0.8, 0.8, 0.78] });
    for (const [zf, yf] of [[cz1, ptop + 3.4], [cz0, ptop + 3.6]]) B.bbox('metal', (c0 + c1) / 2, yf - 0.2, zf + Math.sign(zf - (cz0 + cz1) / 2) * 0.03, c1 - c0 + 2.06, 0.28, 0.06, 0.01, { color: [0.5, 0.53, 0.55] }); // fascias
    for (const xe of [c0 - 1.03, c1 + 1.03]) B.poly('metal', [[xe, ptop + 3.2, cz1], [xe, ptop + 3.2, cz0], [xe, ptop + 3.66, cz0], [xe, ptop + 3.46, cz1]], [Math.sign(xe - RAIL.stationX), 0, 0], { color: [0.5, 0.53, 0.55] });
    for (let x = c0 + 2; x < c1; x += 6) { B.frame(x, ptop + 3.3, (cz0 + cz1) / 2, 0); B.box('lamp', 0, 0, 0, 1.2, 0.05, 0.12); lampPoints.push({ p: [x, ptop + 3.0, (cz0 + cz1) / 2], s: 0.7 }); }
    // fence along the back edge
    B.frame(0, 0, 0, 0);
    const fz = P.side > 0 ? P.z1 - 0.05 : P.z0 + 0.05;
    const gapX = sx0 + 6, doorX = RAIL.stationX + 6; // openings at the stairs and at the station building's platform door
    const fence = P.side > 0 ? [[sx0, gapX - 1.8], [gapX + 1.8, doorX - 2.3], [doorX + 2.3, sx1]] : [[sx0, sx1]];
    for (const [fa, fb] of fence) {
      for (let x = fa; x <= fb; x += 2) B.box('alu', x, ptop, fz, 0.05, 1.2, 0.05, { color: [0.3, 0.45, 0.35] });
      B.box('alu', (fa + fb) / 2, ptop + 1.15, fz, fb - fa, 0.06, 0.06, { color: [0.3, 0.45, 0.35] });
      B.box('alu', (fa + fb) / 2, ptop + 0.5, fz, fb - fa, 0.04, 0.04, { color: [0.3, 0.45, 0.35] });
      addBox((fa + fb) / 2, fz, (fb - fa) / 2, 0.1, 0, ptop - 2, ptop + 1.2);
    }
    // benches + name boards
    for (const x of [RAIL.stationX - 12, RAIL.stationX + 12]) {
      B.frame(x, ptop, back + (P.side > 0 ? -0.9 : 0.9), 0);
      B.box('plastic', 0, 0.42, 0, 1.8, 0.06, 0.45, { color: [0.2, 0.45, 0.75] }); B.box('metal', -0.7, 0, 0, 0.06, 0.42, 0.4); B.box('metal', 0.7, 0, 0, 0.06, 0.42, 0.4);
    }
    for (const x of [RAIL.stationX - 30, RAIL.stationX + 20]) {
      const sign = stationSign(); sign.position.set(x, ptop + 2.0, back + (P.side > 0 ? -0.3 : 0.3)); sign.rotation.y = P.side > 0 ? Math.PI : 0; scene.add(sign);
      const sign2 = sign.clone(); sign2.rotation.y += Math.PI; sign2.position.z += P.side > 0 ? -0.02 : 0.02; scene.add(sign2);
      B.frame(x, ptop, back + (P.side > 0 ? -0.3 : 0.3), 0); for (const o of [-1.1, 1.1]) B.box('metal', o, 0, 0, 0.08, 2.5, 0.08, { color: [0.3, 0.3, 0.3] });
    }
  }
  // home and starting signals (left-hand running: westbound trains on the south track, eastbound on the north)
  signal(B, sx1 + 45, y0, -75.6, Math.PI / 2, 1); signal(B, sx0 - 12, y0, -75.6, Math.PI / 2, 0);
  signal(B, sx0 - 45, y0, -84.4, -Math.PI / 2, 0); signal(B, sx1 + 12, y0, -84.4, -Math.PI / 2, 2);
  // stairs/ramps: south platform to plaza (west end) and pedestrian crossing between platforms at the west end
  const steps = Math.ceil((ptop - y0) / 0.16), stx = sx0 + 6;
  for (let i = 0; i < steps; i++) {
    const h = (i + 1) * (ptop - y0) / steps, z = -73.2 + 0.3 + (steps - 1 - i) * 0.3;
    B.frame(stx, y0, z + 0.15, 0); B.box('concrete', 0, 0, 0, 3.2, h, 0.3, { color: [0.72, 0.72, 0.7] });
    addPlatform(stx, z + 0.15, 1.6, 0.15, 0, y0 + h);
  }
  B.frame(0, 0, 0, 0);
  for (const s of [-1, 1]) B.box('alu', stx + s * 1.62, y0, -73.2 + steps * 0.15, 0.05, ptop - y0 + 1.0, steps * 0.3, { color: [0.6, 0.62, 0.64], skip: 'ny' });
  // pedestrian crossing (構内踏切) at the west end: from each platform a ramp runs down past the platform end to a
  // landing, and a deck at rail-head level (rubber panels inside the tracks, flangeways open) crosses both tracks between
  // the landings. Handrails along the ramps, warning tiles top and bottom, a stop sign and chain at each landing, and
  // the rest of each platform end is fenced.
  {
    const rt = railTop(y0), W = 2.0, pcx = sx0 - 8, xr = pcx + W / 2, top = rt - 0.003, g = RAIL.gauge, RAIL_C = [0.62, 0.64, 0.66];
    const ramps = platforms.map(P => P.side > 0 ? [P.z1 - 0.25 - W, P.z1 - 0.25] : [P.z0 + 0.25, P.z0 + 0.25 + W]);
    const zA = Math.min(...ramps.map(r => r[0])), zB = Math.max(...ramps.map(r => r[1]));
    B.frame(0, 0, 0, 0);
    // deck: z spans between the flangeways; concrete outside the tracks, black rubber panels in 1 m modules inside
    const holes = [];
    for (const tz of RAIL.z) { holes.push([tz - g / 2 - 0.045, tz - g / 2 + 0.11]); holes.push([tz + g / 2 - 0.11, tz + g / 2 + 0.045]); }
    holes.sort((q, r) => q[0] - r[0]);
    const spans = []; let z0 = zA;
    for (const [h0, h1] of holes) { spans.push([z0, h0]); z0 = h1; }
    spans.push([z0, zB]);
    for (const [za, zb] of spans) {
      const zc = (za + zb) / 2, inTrack = RAIL.z.some(tz => Math.abs(zc - tz) < g / 2 + 0.6);
      if (inTrack) for (let i = 0; i < 2; i++) B.bbox('plain', pcx - W / 4 + i * W / 2, y0 + 0.2, zc, W / 2 - 0.012, top - y0 - 0.2, zb - za, 0.012, { color: [0.2, 0.2, 0.21], skip: 'ny' });
      else B.bbox('concrete', pcx, y0 - 0.1, zc, W, top - y0 + 0.1, zb - za, 0.015, { color: [0.72, 0.72, 0.7], skip: 'ny', uv: 1.2 });
      for (const sd of [-1, 1]) B.quad('paint', [pcx + sd * (W / 2 - 0.12) - 0.05, top + 0.003, za + 0.01], [pcx + sd * (W / 2 - 0.12) + 0.05, top + 0.003, za + 0.01], [pcx + sd * (W / 2 - 0.12) + 0.05, top + 0.003, zb - 0.01], [pcx + sd * (W / 2 - 0.12) - 0.05, top + 0.003, zb - 0.01], { color: [0.95, 0.78, 0.1] });
    }
    for (const [h0, h1] of holes) B.box('dark', pcx, rt - 0.09, (h0 + h1) / 2, W, 0.02, h1 - h0, { color: [0.12, 0.12, 0.12] });
    for (const sd of [-1, 1]) B.bbox('concrete', pcx + sd * (W / 2 + 0.1), y0 - 0.1, (zA + zB) / 2, 0.2, top - y0 + 0.1, zB - zA, 0.02, { color: [0.66, 0.66, 0.64] }); // edge beams
    addPlatform(pcx, (zA + zB) / 2, W / 2, (zB - zA) / 2, 0, top);
    platforms.forEach((P, k) => {
      const [r0, r1] = ramps[k], rc = (r0 + r1) / 2, L = sx0 - xr, hAt = x => lerp(top, ptop, (x - xr) / L);
      // ramp: a sloped slab on a concrete wedge
      B.quad('pavement', [xr, top, r1], [sx0, ptop, r1], [sx0, ptop, r0], [xr, top, r0], { color: [0.78, 0.78, 0.76], uv: 1.5 });
      for (const [zz, sd] of [[r0, -1], [r1, 1]]) B.poly('concrete', [[xr, y0 - 0.1, zz], [sx0, y0 - 0.1, zz], [sx0, ptop, zz], [xr, top, zz]], [0, 0, sd], { color: [0.72, 0.72, 0.7], uv: 3 });
      for (let x = xr; x < sx0 - 0.01; x += 0.3) addPlatform(x + 0.15, rc, 0.15, W / 2, 0, hAt(x + 0.15));
      // warning tiles at the top and the bottom of the ramp, across its width
      for (const [xa, xb, y] of [[sx0 - 0.9, sx0 - 0.3, ptop + 0.004], [xr - 0.001 - 0.6, xr - 0.001, top + 0.004]])
        B.poly('tactileD', [[xa, y, r0 + 0.1], [xa, y, r1 - 0.1], [xb, y, r1 - 0.1], [xb, y, r0 + 0.1]], [0, 1, 0], { uvs: [[0, 0], [(W - 0.2) / 0.3, 0], [(W - 0.2) / 0.3, 2], [0, 2]] });
      // handrails on both sides, posts every 1.5 m; the rail follows the slope and carries on round the landing
      for (const zz of [r0 + 0.04, r1 - 0.04]) {
        const n = Math.ceil(L / 1.5);
        for (let i = 0; i <= n; i++) { const x = xr + L * i / n; B.cyl('steel', x, hAt(x) - 0.02, zz, 0.024, 0.024, 0.9, 8, { color: RAIL_C }); }
        for (const dy of [0.88, 0.45]) B.beam('steel', [xr, top + dy, zz], [sx0, ptop + dy, zz], 0.045, 0.045, { color: RAIL_C });
        addBox(xr + L / 2, zz, L / 2, 0.06, 0, y0 - 1, ptop + 1.2);
      }
      // fence across the rest of the platform end
      for (const [fa, fb] of [[P.z0 + 0.05, r0], [r1, P.z1 - 0.05]]) if (fb - fa > 0.1) {
        for (const zz of [fa, fb]) B.box('alu', sx0 + 0.05, ptop, zz, 0.05, 1.2, 0.05, { color: [0.3, 0.45, 0.35] });
        for (const dy of [1.15, 0.5]) B.box('alu', sx0 + 0.05, ptop + dy, (fa + fb) / 2, 0.05, 0.05, fb - fa, { color: [0.3, 0.45, 0.35] });
        addBox(sx0 + 0.05, (fa + fb) / 2, 0.08, (fb - fa) / 2, 0, ptop - 2, ptop + 1.2);
      }
      // at the landing: a post with a stop board facing the passenger, and a yellow-black chain hooked back (open)
      const px = pcx - W / 2 - 0.3;
      B.frame(px, top, P.side > 0 ? r1 - 0.2 : r0 + 0.2, 0);
      B.cyl('steel', 0, -0.3, 0, 0.035, 0.035, 2.3, 10, { color: [0.85, 0.85, 0.85] });
      B.bbox('plain', 0, 1.35, 0, 0.06, 0.62, 0.62, 0.01, { color: [0.95, 0.95, 0.93] });
      B.frame(0, 0, 0, 0);
      const sg = signMesh(0.56, 0.56, (c, w, h) => { c.fillStyle = '#fff'; c.fillRect(0, 0, w, h); c.fillStyle = '#d42020'; c.beginPath(); c.moveTo(w / 2, h * 0.08); c.lineTo(w * 0.94, h * 0.62); c.lineTo(w * 0.06, h * 0.62); c.closePath(); c.fill();
        c.fillStyle = '#fff'; c.font = `bold ${h * 0.2}px ${JP_FONT}`; c.textAlign = 'center'; c.fillText('止まれ', w / 2, h * 0.52); c.fillStyle = '#222'; c.font = `bold ${h * 0.13}px ${JP_FONT}`; c.fillText('列車に注意', w / 2, h * 0.84); }, 0.3);
      sg.position.set(px + 0.035, top + 1.66, P.side > 0 ? r1 - 0.2 : r0 + 0.2); sg.rotation.y = Math.PI / 2; scene.add(sg);
      const sg2 = sg.clone(); sg2.rotation.y = -Math.PI / 2; sg2.position.x = px - 0.035; scene.add(sg2);
      addCircle(px, P.side > 0 ? r1 - 0.2 : r0 + 0.2, 0.08);
      { const hz = P.side > 0 ? r1 - 0.2 : r0 + 0.2, pts = []; for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push([px + 0.02, top + 0.95 - Math.sin(t * Math.PI) * 0.18, hz - (P.side > 0 ? 1 : -1) * t * 0.9]); }
        for (let i = 0; i < 10; i++) B.beam('plastic', pts[i], pts[i + 1], 0.03, 0.03, { color: i % 2 ? [0.1, 0.1, 0.1] : [0.95, 0.78, 0.1] }); }
    });
  }
  // station building on the plaza side
  stationBuilding(B, RAIL.stationX + 6, y0, -68, mulberry32(77));
  return { ptop, platforms };
}

// colour-light signal on a mast beside the track, head facing local +Z (the approaching train); aspect 0 G, 1 Y, 2 R
function signal(B, x, y0, z, r, aspect) {
  B.frame(x, y0, z, r);
  B.bbox('concrete', 0, -0.15, 0, 0.6, 0.4, 0.6, 0.03, { color: [0.7, 0.7, 0.68] });
  B.cyl('steel', 0, 0.25, 0, 0.085, 0.075, 5.25, 12, { color: [0.56, 0.58, 0.6] });
  B.bbox('dark', 0, 3.72, 0.02, 0.72, 1.72, 0.03, 0.03);                // backboard
  B.bbox('dark', 0, 3.88, 0.15, 0.44, 1.4, 0.24, 0.05);                 // lamp case
  const cols = [[0.2, 1, 0.5], [1, 0.72, 0.1], [1, 0.12, 0.06]];
  for (let i = 0; i < 3; i++) {
    const ly = 4.98 - i * 0.44, on = i === aspect, n = 16, c = on ? cols[i] : cols[i].map(v => v * 0.12);
    for (let k = 0; k < n; k++) { const a0 = k / n * Math.PI * 2, a1 = (k + 1) / n * Math.PI * 2;
      B.poly(on ? 'lamp' : 'plastic', [[0, ly, 0.275], [Math.cos(a0) * 0.1, ly + Math.sin(a0) * 0.1, 0.275], [Math.cos(a1) * 0.1, ly + Math.sin(a1) * 0.1, 0.275]], [0, 0, 1], { color: c }); }
    B.bbox('dark', 0, ly + 0.11, 0.37, 0.28, 0.025, 0.2, 0.008);          // hood
  }
  for (let k = 0; k < 9; k++) B.box('steel', 0, 0.6 + k * 0.33, -0.12, 0.3, 0.025, 0.025, { color: [0.5, 0.52, 0.54] }); // ladder rungs
  for (const e of [-0.15, 0.15]) B.box('steel', e, 0.5, -0.12, 0.025, 2.9, 0.025, { color: [0.5, 0.52, 0.54] });
  const p = B.P([0, 0, 0]); addCircle(p[0], p[2], 0.2);
  B.frame(0, 0, 0, 0);
}

// lineside fences: green chain-link on steel posts along both edges of the railway corridor through the valley floor,
// following the ground, with openings at the road crossings, the river, the station building and the platform stairs.
// gaps: [x0, x1, side?] (side 1 = the town / station side at z = -67.6, -1 the far side; omitted = both)
export function railFences(B, groundAt, Y0, gaps) {
  const G = [0.26, 0.42, 0.34], h = 1.5, step = 2.5;
  for (const [z, side] of [[-67.6, 1], [-92.4, -1]]) {
    const open = x => Math.abs(groundAt(x, z) - Y0) > 0.8 || gaps.some(([a, b, s]) => (s === undefined || s === side) && x > a && x < b);
    let x = -440;
    while (x < 440) {
      if (open(x)) { x += 0.5; continue; }
      let xe = x; while (xe + step < 440 && !open(xe + step) && xe - x < 30) xe += step;
      if (xe - x < step) { x += step; continue; }
      B.frame(0, 0, 0, 0);
      for (let px = x; px < xe - 1e-3; px += step) {
        const qx = px + step, ya = groundAt(px, z), yb = groundAt(qx, z);
        B.quad('chain', [px, ya + 0.05, z], [qx, yb + 0.05, z], [qx, yb + h, z], [px, ya + h, z], { uv: 0.15, color: G });
        B.beam('steel', [px, ya + h, z], [qx, yb + h, z], 0.034, 0.034, { color: G });
      }
      for (let px = x; px <= xe + 1e-3; px += step) { const yy = groundAt(px, z); B.cyl('steel', px, yy - 0.15, z, 0.03, 0.03, h + 0.18, 8, { color: G, cap: true }); }
      addBox((x + xe) / 2, z, (xe - x) / 2, 0.06, 0, Y0 - 3, Y0 + 2);
      x = xe + 0.01;
    }
  }
}

function stationSign() {
  return signMesh(2.2, 0.62, (g, W, H) => {
    g.fillStyle = '#fbfbf8'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#146c43'; g.fillRect(0, H * 0.62, W, H * 0.1);
    g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `bold ${H * 0.36}px ${JP_FONT}`; g.fillText('さくらがわ', W / 2, H * 0.3);
    g.font = `${H * 0.11}px Arial`; g.fillText('Sakuragawa', W / 2, H * 0.53);
    g.font = `bold ${H * 0.12}px ${JP_FONT}`; g.textAlign = 'left'; g.fillText('← はなみ', W * 0.04, H * 0.84);
    g.textAlign = 'right'; g.fillText('もりやま →', W * 0.96, H * 0.84);
    g.fillStyle = '#146c43'; g.font = `bold ${H * 0.1}px ${JP_FONT}`; g.textAlign = 'left'; g.fillText('桜川', W * 0.04, H * 0.12);
  }, 0.9, 256);
}

// ---------------------------------------------------------------- level crossings
export const crossings = [];
const lampOn = new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff1a0a, emissiveIntensity: 9 });
const lampOff = new THREE.MeshStandardMaterial({ color: 0x220505, roughness: 0.3 });
const hoodMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.6, side: THREE.DoubleSide });
const armMat = new THREE.MeshStandardMaterial({ map: stripeTex, roughness: 0.5 });
const crossbuckTex = canvasTex(256, 256, (g, W, H) => {
  g.clearRect(0, 0, W, H); g.translate(W / 2, H / 2);
  for (const a of [Math.PI / 4, -Math.PI / 4]) { g.save(); g.rotate(a); g.fillStyle = '#111'; g.fillRect(-120, -22, 240, 44); for (let i = -120; i < 120; i += 40) { g.fillStyle = '#f2c200'; g.fillRect(i, -18, 20, 36); } g.restore(); }
});
const crossbuckMat = new THREE.MeshStandardMaterial({ map: crossbuckTex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5 });
// Level crossing (踏切). The road runs on across the tracks at rail-head level: precast crossing panels inside and
// beside each track with flangeways left open along every rail, asphalt between the tracks, footways carried over as
// lighter concrete panels with warning tiles at both ends, a concrete edge beam where the crossing meets the ballast,
// and the road's edge lines painted on. The approach roads ramp up to it (town.js). Each approach has its warning
// machine on the driver's left (keep-left): striped mast, crossbuck, twin red lamps with hoods for both directions, a
// bell speaker and a direction indicator; and a barrier machine whose striped boom swings down across the road.
export function buildCrossing(B, x, y0, roadW, { hw = roadW / 2 - 0.2, walk = 0 } = {}) {
  const rt = railTop(y0), zN = -86.9, zS = -73.1, zA = -86.6, zB = -73.4, W = roadW - 0.4, g = RAIL.gauge;
  const top = rt - 0.003, base = y0 + 0.2;
  B.frame(x, 0, -80, 0);
  // z-intervals of the deck with the rails and their flangeways left open
  const holes = [];
  for (const tz of RAIL.z) { holes.push([tz - g / 2 - 0.045, tz - g / 2 + 0.045 + 0.065]); holes.push([tz + g / 2 - 0.045 - 0.065, tz + g / 2 + 0.045]); }
  holes.sort((p, q) => p[0] - q[0]);
  const spans = []; let z0 = zA + 80;
  for (const [h0, h1] of holes) { spans.push([z0, h0 + 80]); z0 = h1 + 80; }
  spans.push([z0, zB + 80]);
  const inTrack = zc => RAIL.z.some(tz => Math.abs(zc - (tz + 80)) < g / 2 + 0.65);
  const xs = walk > 0 ? [[-W / 2, -hw, 'foot'], [-hw, hw, 'road'], [hw, W / 2, 'foot']] : [[-W / 2, W / 2, 'road']];
  for (const [za, zb] of spans) {
    const zc = (za + zb) / 2, dz = zb - za, track = inTrack(zc);
    for (const [xa, xb, kind] of xs) {
      const xc = (xa + xb) / 2, dx = xb - xa;
      if (kind === 'foot') B.bbox('concrete', xc, base, zc, dx, top - base, dz, 0.01, { color: [0.8, 0.79, 0.76], skip: 'ny', uv: 1.2 });
      else if (track) { // precast panels, 1 m modules with joints
        const n = Math.max(1, Math.round(dx));
        for (let i = 0; i < n; i++) B.bbox('concrete', xa + (i + 0.5) * dx / n, base, zc, dx / n - 0.012, top - base, dz, 0.012, { color: [0.5, 0.5, 0.49], skip: 'ny', uv: 1 });
      } else B.box('asphalt', xc, base, zc, dx, top - base, dz, { skip: 'ny', uv: 4 });
    }
    // edge lines painted over each piece (not across the flangeways)
    for (const s2 of [-1, 1]) { const ex = s2 * (hw - 0.25); B.quad('paint', [ex - 0.075, top + 0.003, za + 0.01], [ex + 0.075, top + 0.003, za + 0.01], [ex + 0.075, top + 0.003, zb - 0.01], [ex - 0.075, top + 0.003, zb - 0.01], { color: [0.94, 0.94, 0.92] }); }
    if (walk > 0) for (const s2 of [-1, 1]) B.quad('paint', [s2 * hw - 0.05, top + 0.003, za + 0.01], [s2 * hw + 0.05, top + 0.003, za + 0.01], [s2 * hw + 0.05, top + 0.003, zb - 0.01], [s2 * hw - 0.05, top + 0.003, zb - 0.01], { color: [0.94, 0.94, 0.92] });
  }
  // flangeway floors (dark, below the rail head) so the gaps read as slots, not holes into the ballast
  for (const [h0, h1] of holes) B.box('dark', 0, rt - 0.09, (h0 + h1) / 2 + 80, W, 0.02, h1 - h0, { color: [0.12, 0.12, 0.12] });
  // concrete edge beams where the crossing meets the ballast
  for (const s2 of [-1, 1]) B.bbox('concrete', s2 * (W / 2 + 0.12), y0 - 0.1, 0, 0.24, top - y0 + 0.12, zB - zA, 0.02, { color: [0.66, 0.66, 0.64], uv: 1.5 });
  if (walk > 0) for (const zz of [zA + 80 + 0.45, zB + 80 - 0.45]) for (const s2 of [-1, 1]) // warning tiles where the footway meets the tracks
    B.poly('tactileD', [[s2 * hw + s2 * 0.25, top + 0.004, zz - 0.3], [s2 * hw + s2 * 0.25, top + 0.004, zz + 0.3], [s2 * (W / 2 - 0.25), top + 0.004, zz + 0.3], [s2 * (W / 2 - 0.25), top + 0.004, zz - 0.3]], [0, 1, 0], { uvs: [[0, 0], [0, 2], [(W / 2 - hw - 0.5) / 0.3, 2], [(W / 2 - hw - 0.5) / 0.3, 0]] });
  B.frame(0, 0, 0, 0);
  const c = { x, active: false, t: 0, arms: [], lamps: [], bell: new Emitter('bell'), roadW };
  c.bell.set(x, y0 + 3, -80);
  const STRIPE = i => i % 2 ? [0.08, 0.08, 0.08] : [0.95, 0.75, 0.05];
  for (const [z, side] of [[zN, -1], [zS, 1]]) {
    // keep-left: traffic entering from the south (heading -z) has -x on its left, from the north +x
    const m = -side, mx = x + m * (roadW / 2 + 0.75), mz = z + side * 0.35, gy = y0 + 0.45;
    B.frame(mx, gy, mz, 0);
    B.bbox('concrete', 0, -0.35, 0, 0.7, 0.45, 0.7, 0.02, { color: [0.7, 0.7, 0.68] });                       // footing
    for (let i = 0; i < 13; i++) B.cyl('plain', 0, 0.1 + i * 0.26, 0, 0.075, 0.075, 0.26, 12, { color: STRIPE(i) }); // striped mast
    B.cyl('steel', 0, 3.48, 0, 0.09, 0.05, 0.1, 12, { color: [0.2, 0.2, 0.2], cap: true });
    B.box('dark', 0, 2.45, 0, 1.36, 0.08, 0.08, { color: [0.12, 0.12, 0.12] });                              // lamp bar
    for (const lx of [-0.6, 0.6]) B.bbox('dark', lx, 2.08, 0, 0.36, 0.4, 0.14, 0.03, { color: [0.1, 0.1, 0.1] }); // lamp housings
    B.bbox('plastic', 0, 3.58, 0, 0.3, 0.24, 0.24, 0.03, { color: [0.18, 0.18, 0.2] });                      // bell speaker
    B.bbox('dark', 0, 1.72, 0, 0.62, 0.22, 0.12, 0.02, { color: [0.1, 0.1, 0.1] });                           // direction indicator
    const cb = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), crossbuckMat); cb.position.set(mx, gy + 3.05, mz); cb.castShadow = true; scene.add(cb);
    // barrier machine: striped housing with a pivot hub, boom with a counterweight
    B.frame(mx, gy, mz + side * 0.55, 0);
    B.bbox('dark', 0, 0, 0, 0.46, 1.05, 0.4, 0.04, { color: [0.12, 0.12, 0.12] });
    for (let i = 0; i < 4; i++) B.box('plain', 0, 0.12 + i * 0.24, side * 0.201, 0.46, 0.1, 0.004, { color: [0.95, 0.75, 0.05] });
    B.cyl('steel', 0, 0.86, side * 0.22, 0.09, 0.09, 0.12, 12, { color: [0.55, 0.56, 0.58], cap: true });
    addCircle(mx, mz, 0.3); addBox(mx, mz + side * 0.55, 0.25, 0.22, 0);
    B.frame(0, 0, 0, 0);
    for (const face of [0, Math.PI]) for (const lx of [-0.6, 0.6]) {
      const l = new THREE.Mesh(new THREE.CircleGeometry(0.15, 20), lampOff);
      const hood = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.22, 20, 1, true, -Math.PI / 2, Math.PI), hoodMat);
      const grp = new THREE.Group(); grp.position.set(mx, gy + 2.28, mz); grp.rotation.y = face;
      l.position.set(lx, 0, 0.075); hood.rotation.x = Math.PI / 2; hood.position.set(lx, 0.0, 0.18); grp.add(l, hood); scene.add(grp);
      c.lamps.push({ m: l, phase: lx > 0 ? 0 : 1 });
    }
    const pivot = new THREE.Group(); pivot.position.set(mx, gy + 0.86, mz + side * 0.9);
    const armL = roadW + 0.2;
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, armL, 12).rotateZ(Math.PI / 2), armMat);
    arm.geometry.translate(-m * armL / 2, 0, 0); arm.castShadow = true;
    // stripes run along the boom: texture u follows its length (1.6 m per repeat), v goes round it
    const at = arm.geometry.attributes.uv; for (let i = 0; i < at.count; i++) { const u = at.getX(i), v = at.getY(i); at.setXY(i, v * armL / 1.6, u); }
    const cw = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.22, 0.14), hoodMat); cw.geometry.translate(m * 0.35, 0, 0);
    pivot.add(arm, cw); scene.add(pivot);
    c.arms.push({ pivot, side: m, len: armL, x0: mx, z: mz + side * 0.9 });
  }
  crossings.push(c);
  return c;
}
export function updateCrossings(dt, t) {
  for (const c of crossings) {
    c.t = c.active ? c.t + dt : Math.max(0, c.t - dt * 1.5);
    const down = smoothstep(4.5, 10.5, c.t); // arms start lowering ~5 s after the bells start
    for (const a of c.arms) a.pivot.rotation.z = a.side * (Math.PI / 2) * (1 - down) * -1;
    const flash = Math.floor(t / 0.5) % 2;
    for (const l of c.lamps) l.m.material = c.active && flash === l.phase ? lampOn : lampOff;
    c.bell.on = c.active;
    c.down = down;
  }
}

// ---------------------------------------------------------------- trains
function trainMaterials() {
  const stain = new THREE.MeshStandardMaterial({ color: 0xa9aeb2, metalness: 0.85, roughness: 0.4, envMapIntensity: 1.0 });
  const stripe = new THREE.MeshStandardMaterial({ color: 0x0f8a5f, roughness: 0.4, metalness: 0.2 });
  const stripe2 = new THREE.MeshStandardMaterial({ color: 0xf29a1b, roughness: 0.4, metalness: 0.2 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0e1215, roughness: 0.05, metalness: 0.75, emissive: 0xfff4e0, emissiveIntensity: 0.04 });
  const black = new THREE.MeshStandardMaterial({ color: 0x0c0d0e, roughness: 0.25, metalness: 0.3 });
  const under = new THREE.MeshStandardMaterial({ color: 0x2b2c2d, roughness: 0.8 });
  const head = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff8ee, emissiveIntensity: 12 });
  const tail = new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff1508, emissiveIntensity: 6 });
  const off = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.2 });
  const led = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffa020, emissiveIntensity: 2.5 });
  const destTex = canvasTex(512, 64, (g, W, H) => { g.fillStyle = '#050505'; g.fillRect(0, 0, W, H); g.fillStyle = '#ffae2a'; g.font = `bold 44px ${JP_FONT}`; g.textBaseline = 'middle'; g.fillText('普通　もりやま', 14, H / 2); g.fillStyle = '#3cff6a'; g.fillText('Local', 360, H / 2); });
  led.emissiveMap = destTex; led.map = destTex;
  return { stain, stripe, stripe2, glass, black, under, head, tail, off, led };
}
let TM = null;
function box(g, mat, x, y, z, w, h, d) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); g.add(m); m.castShadow = true; m.receiveShadow = true; return m; }
// one 20 m car. local x along car, y up from rail top, z across. cab: -1 (cab at -x end), +1, or 0
function makeCar(cab, panto) {
  const g = new THREE.Group(), L = 19.5, W = 2.95, T = TM;
  box(g, T.under, 0, 0.85, 0, L - 0.4, 0.5, 2.6);
  for (let i = 0; i < 5; i++) box(g, T.under, -5 + i * 2.5, 0.62, 0, 1.6, 0.45, 2.2);
  for (const bx of [-6.9, 6.9]) {
    box(g, T.under, bx, 0.52, 0, 2.6, 0.35, 2.3);
    for (const wx of [-1.05, 1.05]) for (const wz of [-0.72, 0.72]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.43, 0.43, 0.14, 18), T.under); w.rotation.x = Math.PI / 2; w.position.set(bx + wx, 0.43, wz); g.add(w);
    }
  }
  // body shell
  box(g, T.stain, 0, 2.35, 0, L, 2.4, W);
  box(g, T.stain, 0, 3.62, 0, L, 0.12, W - 0.25);
  box(g, T.stain, 0, 3.58, 0, L, 0.1, W - 0.1);
  for (const s of [-1, 1]) {
    box(g, T.stripe, 0, 2.02, s * (W / 2 + 0.005), L, 0.12, 0.01);
    box(g, T.stripe2, 0, 1.9, s * (W / 2 + 0.005), L, 0.08, 0.01);
    box(g, T.stripe, 0, 3.12, s * (W / 2 + 0.005), L, 0.1, 0.01);
    // windows between doors, door windows
    const doors = [-7.1, -2.4, 2.4, 7.1];
    for (let k = 0; k < doors.length - 1; k++) box(g, T.glass, (doors[k] + doors[k + 1]) / 2, 2.55, s * (W / 2 + 0.006), 3.1, 0.95, 0.01);
    for (const d of doors) {
      box(g, T.black, d, 2.05, s * (W / 2 + 0.004), 1.35, 1.95, 0.012);
      for (const o of [-0.34, 0.34]) box(g, T.glass, d + o, 2.45, s * (W / 2 + 0.012), 0.5, 0.95, 0.01);
    }
    for (const e of [-9.1, 9.1]) if (!(cab && Math.sign(e) === cab)) box(g, T.glass, e, 2.55, s * (W / 2 + 0.006), 0.6, 0.8, 0.01);
  }
  // roof equipment
  box(g, T.under, cab ? -cab * 3 : 3, 3.8, 0, 2.2, 0.35, 1.6);
  if (panto) {
    const pz = 0; box(g, T.under, 5, 3.72, pz, 1.4, 0.12, 1.4);
    const arm1 = box(g, T.under, 4.65, 4.2, pz, 0.08, 0.08, 1.0); arm1.rotation.z = 0.9; arm1.geometry = new THREE.BoxGeometry(1.3, 0.06, 0.06);
    const arm2 = box(g, T.under, 5.0, 4.95, pz, 1.2, 0.05, 0.05); arm2.rotation.z = -0.95;
    box(g, T.under, 5.35, 5.35, pz, 0.12, 0.05, 1.6);
  }
  const ends = cab ? [-cab] : [-1, 1];
  for (const e of ends) box(g, T.black, e * L / 2, 2.3, 0, 0.1, 2.0, 1.3); // gangway
  let lights = null;
  if (cab) {
    const x = cab * L / 2;
    const nose = box(g, T.black, x + cab * 0.35, 2.35, 0, 0.7, 2.4, W - 0.08);
    box(g, T.glass, x + cab * 0.71, 2.75, 0, 0.02, 1.0, 2.5);
    const dest = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.22), T.led); dest.position.set(x + cab * 0.72, 3.4, 0); dest.rotation.y = cab * Math.PI / 2; g.add(dest);
    box(g, T.stripe, x + cab * 0.71, 1.9, 0, 0.02, 0.3, W - 0.1);
    lights = { head: [], tail: [] };
    for (const z of [-1.05, 1.05]) {
      lights.head.push(box(g, T.off, x + cab * 0.72, 1.55, z * 0.95, 0.03, 0.18, 0.35));
      lights.tail.push(box(g, T.off, x + cab * 0.72, 1.55, z * 0.62, 0.03, 0.14, 0.2));
    }
    box(g, T.under, x + cab * 0.5, 0.7, 0, 0.35, 0.6, 2.4); // skirt
  }
  // merge static parts per material (lights + destination sign stay separate so they can switch)
  const keep = new Set(lights ? [...lights.head, ...lights.tail] : []);
  const byMat = new Map();
  for (const c of [...g.children]) {
    if (!c.isMesh || keep.has(c) || c.material === T.led) continue;
    c.updateMatrix();
    const geo = (c.geometry.index ? c.geometry.toNonIndexed() : c.geometry.clone()).applyMatrix4(c.matrix);
    if (!byMat.has(c.material)) byMat.set(c.material, []);
    byMat.get(c.material).push(geo); g.remove(c);
  }
  for (const [mat, geos] of byMat) { const m = new THREE.Mesh(mergeGeometries(geos), mat); m.castShadow = m.receiveShadow = true; g.add(m); }
  return { g, lights, cab };
}

export class Train {
  constructor(y0, cars = 4) {
    if (!TM) TM = trainMaterials();
    this.y = railTop(y0); this.n = cars; this.len = cars * 20;
    this.group = new THREE.Group();
    this.cars = [];
    for (let i = 0; i < cars; i++) {
      const c = makeCar(i === 0 ? -1 : i === cars - 1 ? 1 : 0, i === 1);
      c.g.position.x = (i - (cars - 1) / 2) * 20;
      this.group.add(c.g); this.cars.push(c);
    }
    scene.add(this.group);
    this.sound = new Emitter('train');
    this.state = 'hidden'; this.wait = 0; this.v = 0; this.acc = 0; this.x = 0; this.dir = 1; this.track = 0; this.horn = 0;
    this.vmax = 22; this.dwell = 0; this.stopped = false;
  }
  start(dir, delay) { this.dir = dir; this.track = dir > 0 ? 0 : 1; this.x = -dir * (RAIL.portal + 260); this.v = this.vmax * 0.8; this.state = 'wait'; this.wait = delay; this.served = false; this.group.visible = false; }
  head() { return this.x + this.dir * this.len / 2; }
  update(dt, player) {
    if (this.state === 'wait') { this.wait -= dt; if (this.wait <= 0) { this.state = 'run'; this.group.visible = true; } this.sound.on = false; return; }
    const stopX = RAIL.stationX + this.dir * (RAIL.platformLen / 2 - 4) - this.dir * this.len / 2; // train centre when stopped
    let target = this.vmax;
    if (!this.served) {
      const d = (stopX - this.x) * this.dir;
      if (d <= 0.15 && this.v < 0.8) { this.state = 'dwell'; this.dwell = 22 + Math.random() * 10; this.served = true; this.v = 0; }
      else target = Math.min(target, Math.sqrt(Math.max(0, 2 * 0.85 * d)) + (d > 1 ? 0.4 : 0.1));
    }
    if (this.state === 'dwell') { this.dwell -= dt; target = 0; if (this.dwell <= 0) this.state = 'run'; }
    // obstruction: player on this track ahead → brake and sound the horn
    const tz = RAIL.z[this.track], ahead = (player.x - this.head()) * this.dir;
    if (Math.abs(player.z - tz) < 2.0 && ahead > -2 && ahead < 250 && player.y < this.y + 1.5) {
      target = Math.min(target, Math.sqrt(Math.max(0, 2 * 1.2 * (ahead - 12))));
      if (this.horn <= 0) { this.honk(); this.horn = 3; }
    }
    this.horn -= dt;
    const prev = this.v;
    if (target > this.v) this.v = Math.min(target, this.v + 0.85 * dt);                          // traction
    else this.v = Math.max(target, this.v - Math.min(1.3, (this.v - target) * 2 + 0.3) * dt); // service brake
    this.v = Math.max(0, this.v);
    this.acc = (this.v - prev) / Math.max(dt, 1e-3);
    this.x += this.v * this.dir * dt;
    if (this.x * this.dir > RAIL.portal + 260) { this.start(-this.dir, 25 + Math.random() * 40); return; }
    this.group.position.set(this.x, this.y, tz);
    this.group.rotation.y = this.dir > 0 ? 0 : Math.PI;
    // lights: headlights on the leading cab, tail lights on the trailing one
    for (const c of this.cars) if (c.lights) {
      const lead = c.cab === 1; // car local +x faces travel direction because the group is rotated
      c.lights.head.forEach(m => m.material = lead ? TM.head : TM.off);
      c.lights.tail.forEach(m => m.material = lead ? TM.off : TM.tail);
    }
    TM.glass.emissiveIntensity = 0.04 + night.value * 1.5;
    this.sound.on = true;
    const near = clamp(player.x, this.x - this.len / 2, this.x + this.len / 2);
    this.sound.set(near, this.y + 1.5, tz, { speed: this.v, accel: this.acc, cars: this.n });
  }
  honk() {
    if (!audio.ctx) return;
    const ctx = audio.ctx, t = ctx.currentTime;
    for (const [f, t0, d] of [[660, 0, 0.35], [555, 0.4, 0.6]]) {
      for (const h of [1, 2, 3]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f * h;
        const g = ctx.createGain(); g.gain.setValueAtTime(0, t + t0); g.gain.linearRampToValueAtTime(0.25 / h, t + t0 + 0.03); g.gain.setValueAtTime(0.25 / h, t + t0 + d - 0.05); g.gain.linearRampToValueAtTime(0, t + t0 + d);
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2500;
        o.connect(lp).connect(g).connect(this.sound.out || audio.master); o.start(t + t0); o.stop(t + t0 + d + 0.05);
      }
    }
  }
  // occupied span for crossings / collisions
  span() { return this.state === 'wait' ? null : [this.x - this.len / 2, this.x + this.len / 2]; }
}

export function crossingActive(c, trains) {
  for (const tr of trains) {
    const sp = tr.span(); if (!sp) continue;
    if (c.x > sp[0] - 4 && c.x < sp[1] + 4) return true;
    const ahead = (c.x - tr.head()) * tr.dir;
    if (ahead > 0 && ahead < Math.max(tr.state === 'dwell' ? 0 : 60, tr.v * 24)) return true;
  }
  return false;
}
