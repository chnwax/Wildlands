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


export function buildRailway(ctx) {
  const { y0, riverX, B } = ctx, MT = materials();
  const rt = railTop(y0), X0 = -RAIL.portalW - 60, X1 = RAIL.portalE + 60;
  const rx = riverX(-80);
  // ballast bed (trapezoid) along the whole line, laid in lengths of different age: renewed stone is paler, older beds
  // greyer and dirtier, and the four-foot of each track is stained rust-brown by brake dust. On the river bridge the bed
  // sits in the deck's ballast trough between the parapets (the deck top stays below the stone, never level with it)
  const brg = [rx - 14.4, rx + 14.4], vr = mulberry32(3131);
  const cuts = [X0]; for (let x = X0 + 25; x < X1; x += 25) cuts.push(x); cuts.push(brg[0], brg[1], X1); cuts.sort((a, b) => a - b);
  B.frame(0, 0, 0, 0);
  for (let i = 0; i + 1 < cuts.length; i++) {
    const xa = cuts[i], xb = cuts[i + 1]; if (xb - xa < 0.05) continue;
    const onB = xa >= brg[0] - 1e-3 && xb <= brg[1] + 1e-3, zc = -80, hw = onB ? 5.3 : 5.6, tw = 4.6, yb = onB ? y0 - 0.05 : y0 - 0.25, yt = y0 + 0.2;
    const age = vr(), base = age < 0.18 ? [1.06, 1.05, 1.02] : [0.97 - age * 0.12, 0.95 - age * 0.12, 0.9 - age * 0.1], rust = [base[0] * 0.86, base[1] * 0.7, base[2] * 0.56];
    const zs = [-tw, RAIL.z[0] + 80 - 0.72, RAIL.z[0] + 80 + 0.72, RAIL.z[1] + 80 - 0.72, RAIL.z[1] + 80 + 0.72, tw];
    // ends at the bridge follow the bank lines (the channel crosses the line askew): x of an end at a given z
    const bank = x => Math.abs(x - brg[0]) < 1e-3 ? z => riverX(z) - 14.4 : Math.abs(x - brg[1]) < 1e-3 ? z => riverX(z) + 14.4 : () => x;
    const XA = bank(xa), XB = bank(xb);
    for (let k = 0; k + 1 < zs.length; k++) { const za = zc + zs[k], zb = zc + zs[k + 1], col = k % 2 ? rust : base;
      B.quad('ballast', [XA(zb), yt, zb], [XB(zb), yt, zb], [XB(za), yt, za], [XA(za), yt, za], { uvs: [[XA(zb) / 2, zb / 2], [XB(zb) / 2, zb / 2], [XB(za) / 2, za / 2], [XA(za) / 2, za / 2]], color: col }); }
    const sh = base.map(v => v * 0.93);
    B.quad('ballast', [XA(zc + hw), yb, zc + hw], [XB(zc + hw), yb, zc + hw], [XB(zc + tw), yt, zc + tw], [XA(zc + tw), yt, zc + tw], { uv: 2, color: sh });
    B.quad('ballast', [XB(zc - hw), yb, zc - hw], [XA(zc - hw), yb, zc - hw], [XA(zc - tw), yt, zc - tw], [XB(zc - tw), yt, zc - tw], { uv: 2, color: sh });
  }
  // rails: a real flat-bottom section (foot, web, head with rounded gauge corners) swept along the line in rust-brown
  // steel, with the bright polished running band that the wheels keep clean along the top of the head
  MT.railSide = MT.railSide || new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.35, envMapIntensity: 0.4 });
  MT.railTop = MT.railTop || new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.65, envMapIntensity: 0.35 });
  const RP = [[-0.064, 0], [0.064, 0], [0.064, 0.011], [0.02, 0.024], [0.0085, 0.034], [0.0085, 0.095], [0.02, 0.103], [0.033, 0.108], [0.034, 0.132], [0.03, 0.14], [0.018, 0.1445],
    [-0.018, 0.1445], [-0.03, 0.14], [-0.034, 0.132], [-0.033, 0.108], [-0.02, 0.103], [-0.0085, 0.095], [-0.0085, 0.034], [-0.02, 0.024], [-0.064, 0.011]];
  const ryb = y0 + 0.31;
  B.frame(0, 0, 0, 0);
  for (const tz of RAIL.z) for (const side of [-1, 1]) {
    const z = tz + side * RAIL.gauge / 2;
    for (let x = X0; x < X1; x += 50) { const xe = Math.min(X1, x + 50);
      B.sweep('railSide', RP, [[x, ryb, z], [xe, ryb, z]], { closed: true, color: [0.5, 0.36, 0.27], uv: 1 });
      B.quad('railTop', [x, ryb + 0.1449, z + 0.019], [xe, ryb + 0.1449, z + 0.019], [xe, ryb + 0.1449, z - 0.019], [x, ryb + 0.1449, z - 0.019], { color: [0.8, 0.79, 0.76] }); }
  }
  // prestressed concrete sleepers (PC枕木): deeper under the rail seats than in the middle, a rubber pad and a pair of
  // spring clips at each seat; instanced, each a slightly different shade
  const slGeo = (() => { const tint = (g, c) => { const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set(c, i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
    const C = [0.54, 0.53, 0.5], P = [0.1, 0.1, 0.11], K = [0.22, 0.23, 0.24], parts = [tint(new THREE.BoxGeometry(0.2, 0.12, 0.86).translate(0, -0.02, 0), C)];
    for (const s of [-1, 1]) { const rz = s * RAIL.gauge / 2;
      parts.push(tint(new THREE.BoxGeometry(0.25, 0.16, 0.58).translate(0, 0, s * 0.71), C));
      parts.push(tint(new THREE.BoxGeometry(0.19, 0.01, 0.17).translate(0, 0.085, rz), P));
      for (const e of [-1, 1]) { parts.push(tint(new THREE.BoxGeometry(0.08, 0.03, 0.045).translate(0, 0.1, rz + e * 0.088), K)); parts.push(tint(new THREE.BoxGeometry(0.03, 0.05, 0.03).translate(0, 0.095, rz + e * 0.11), K)); } }
    return mergeGeometries(parts); })();
  const sl = []; for (const tz of RAIL.z) for (let x = X0; x < X1; x += 0.62) sl.push([x, tz]);
  const sleeper = new THREE.InstancedMesh(slGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }), sl.length);
  const m4 = new THREE.Matrix4(), sc = new THREE.Color(), srng = mulberry32(606);
  sl.forEach(([x, z], i) => { sleeper.setMatrixAt(i, m4.makeTranslation(x, y0 + 0.22, z)); const v = 0.86 + srng() * 0.2; sleeper.setColorAt(i, sc.setRGB(v, v * (0.98 + srng() * 0.03), v * 0.97)); });
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

  // river bridge: it spans the channel only, from abutment to abutment at the tops of the two revetments (which run
  // askew to the line here, so the deck, girders and parapets end on the bank lines); piers in the channel
  B.frame(0, 0, 0, 0);
  const BE = 14.4, xL = z => riverX(z) - BE, xR = z => riverX(z) + BE;
  const prism = (mat, z0, z1, ya, yb, col, dx0 = 0, dx1 = 0) => { // a slab from bank line to bank line between z0 and z1
    const P = (z, x, y) => [x, y, z], a0 = xL(z0) + dx0, a1 = xL(z1) + dx0, b0 = xR(z0) - dx1, b1 = xR(z1) - dx1, o = { color: col, uv: 3 };
    B.poly(mat, [P(z0, a0, yb), P(z0, b0, yb), P(z1, b1, yb), P(z1, a1, yb)], [0, 1, 0], o);
    B.poly(mat, [P(z0, a0, ya), P(z0, b0, ya), P(z1, b1, ya), P(z1, a1, ya)], [0, -1, 0], o);
    B.poly(mat, [P(z0, a0, ya), P(z0, b0, ya), P(z0, b0, yb), P(z0, a0, yb)], [0, 0, -1], o);
    B.poly(mat, [P(z1, a1, ya), P(z1, b1, ya), P(z1, b1, yb), P(z1, a1, yb)], [0, 0, 1], o);
    B.poly(mat, [P(z0, a0, ya), P(z1, a1, ya), P(z1, a1, yb), P(z0, a0, yb)], [-1, 0, 0], o);
    B.poly(mat, [P(z0, b0, ya), P(z1, b1, ya), P(z1, b1, yb), P(z0, b0, yb)], [1, 0, 0], o); };
  prism('concrete', -85.75, -74.25, y0 - 1.25, y0 - 0.05, [0.72, 0.72, 0.7]);                                      // deck: ballast trough
  for (const z of [-4.2, 4.2]) prism('metal', -80 + z - 0.175, -80 + z + 0.175, y0 - 2.65, y0 - 1.25, [0.36, 0.42, 0.5], 0.15, 0.15); // plate girders
  for (const z of [-5.8, 5.8]) prism('metal', -80 + z - 0.04, -80 + z + 0.04, y0 - 0.05, y0 + 1.2, [0.4, 0.45, 0.5]);                // parapets
  B.frame(rx, y0, -80, 0);
  for (const px of [-8, 8]) B.box('concrete', px, -8, 0, 2.2, 6.6, 9, { color: [0.68, 0.68, 0.66], uv: 3 });
  B.frame(0, 0, 0, 0);
  for (const s of [-1, 1]) { // abutments on the bank lines: a wall under each deck end, its face toward the channel
    const inner = z => riverX(z) + s * (BE - 0.05), outer = z => riverX(z) + s * (BE + 1.4), z0 = -86.4, z1 = -73.6, ya = y0 - 3.2, yb = y0 - 0.05, o = { color: [0.7, 0.7, 0.68], uv: 3 };
    B.poly('concrete', [[inner(z0), ya, z0], [inner(z1), ya, z1], [inner(z1), yb, z1], [inner(z0), yb, z0]], [-s, 0, 0], o);
    B.poly('concrete', [[inner(z0), yb, z0], [inner(z1), yb, z1], [outer(z1), yb, z1], [outer(z0), yb, z0]], [0, 1, 0], o);
    for (const zz of [z0, z1]) B.poly('concrete', [[inner(zz), ya, zz], [outer(zz), ya, zz], [outer(zz), yb, zz], [inner(zz), yb, zz]], [0, 0, zz < -80 ? -1 : 1], o);
    B.poly('concrete', [[inner(z0) - s * 0.02, yb, z0 - 0.05], [inner(z1) - s * 0.02, yb, z1 + 0.05], [inner(z1) - s * 0.02, yb + 0.12, z1 + 0.05], [inner(z0) - s * 0.02, yb + 0.12, z0 - 0.05]], [-s, 0, 0], { color: [0.62, 0.62, 0.6] }); // bearing shelf lip
  }
  addPlatform(rx, -80, BE, 5.75, 0, y0 + 0.2);

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
// Line-side fences, by district: grey welded-mesh panels round the station, green chain link through the town, and
// concrete posts with strands of barbed wire out past the houses. Maintenance gates (with a no-entry board) break the
// runs every ~170 m where the ground allows.
export function railFences(B, groundAt, Y0, gaps, stationX = 0) {
  const zone = x => Math.abs(x - stationX) < 115 ? 'panel' : Math.abs(x) > 320 ? 'wire' : 'chain';
  const STY = { panel: { h: 1.8, step: 2.0, c: [0.62, 0.64, 0.66] }, chain: { h: 1.5, step: 2.5, c: [0.26, 0.42, 0.34] }, wire: { h: 1.2, step: 3.0, c: [0.7, 0.69, 0.66] } };
  const gates = []; for (let gx = -410; gx < 430; gx += 150 + ((gx * 7919) % 41 + 41) % 41) gates.push(gx);
  const gateAt = (x, side) => gates.find(g => Math.abs(x - (g + side * 20)) < 1.6);
  for (const [z, side] of [[-67.6, 1], [-92.4, -1]]) {
    const open = x => Math.abs(groundAt(x, z) - Y0) > 0.8 || gaps.some(([a, b, s]) => (s === undefined || s === side) && x > a && x < b);
    let x = -440;
    while (x < 440) {
      if (open(x) || gateAt(x, side) !== undefined) { x += 0.5; continue; }
      const zn = zone(x), S = STY[zn], step = S.step, h = S.h, G = S.c;
      let xe = x; while (xe + step < 440 && !open(xe + step) && gateAt(xe + step, side) === undefined && zone(xe + step) === zn && xe - x < 30) xe += step;
      if (xe - x < step) { x += step; continue; }
      B.frame(0, 0, 0, 0);
      for (let px = x; px < xe - 1e-3; px += step) {
        const qx = px + step, ya = groundAt(px, z), yb = groundAt(qx, z);
        if (zn === 'wire') { for (const hy of [0.35, 0.72, 1.1]) B.beam('steel', [px, ya + hy, z], [qx, yb + hy, z], 0.008, 0.008, { color: [0.45, 0.44, 0.42] }); continue; }
        B.quad('chain', [px, ya + 0.05, z], [qx, yb + 0.05, z], [qx, yb + h, z], [px, ya + h, z], { uv: zn === 'panel' ? 0.1 : 0.15, color: G });
        B.beam('steel', [px, ya + h, z], [qx, yb + h, z], 0.034, 0.034, { color: G });
        if (zn === 'panel') { B.beam('steel', [px, ya + 0.08, z], [qx, yb + 0.08, z], 0.03, 0.03, { color: G }); B.beam('steel', [px, ya + h * 0.5, z], [qx, yb + h * 0.5, z], 0.02, 0.02, { color: G }); }
      }
      for (let px = x; px <= xe + 1e-3; px += step) { const yy = groundAt(px, z);
        if (zn === 'wire') B.bbox('concrete', px, yy - 0.2, z, 0.1, h + 0.2, 0.1, 0.01, { color: [0.74, 0.73, 0.7] });
        else if (zn === 'panel') B.box('steel', px, yy - 0.15, z, 0.06, h + 0.2, 0.06, { color: G });
        else B.cyl('steel', px, yy - 0.15, z, 0.03, 0.03, h + 0.18, 8, { color: G, cap: true }); }
      addBox((x + xe) / 2, z, (xe - x) / 2, 0.06, 0, Y0 - 3, Y0 + 2);
      x = xe + 0.01;
    }
    // maintenance gates: two posts, a mesh leaf shut with a chain, a no-entry board
    for (const g of gates) { const gx = g + side * 20; if (open(gx - 1.6) || open(gx + 1.6) || open(gx)) continue;
      const yy = groundAt(gx, z), C = [0.55, 0.58, 0.56];
      B.frame(0, 0, 0, 0);
      for (const px of [gx - 1.5, gx + 1.5]) B.box('steel', px, yy - 0.2, z, 0.1, 1.95, 0.1, { color: C });
      for (const hy of [0.12, 1.6]) B.beam('steel', [gx - 1.45, yy + hy, z], [gx + 1.45, yy + hy, z], 0.04, 0.04, { color: C });
      B.beam('steel', [gx - 1.45, yy + 0.12, z], [gx + 1.45, yy + 1.6, z], 0.03, 0.03, { color: C });
      B.quad('chain', [gx - 1.45, yy + 0.12, z], [gx + 1.45, yy + 0.12, z], [gx + 1.45, yy + 1.6, z], [gx - 1.45, yy + 1.6, z], { uv: 0.15, color: C });
      addBox(gx, z, 1.55, 0.06, 0, Y0 - 3, Y0 + 2);
      const sgn = signMesh(0.6, 0.42, (c, w, hh) => { c.fillStyle = '#fff'; c.fillRect(0, 0, w, hh); c.fillStyle = '#c81e1e'; c.font = `bold ${hh * 0.26}px ${JP_FONT}`; c.textAlign = 'center'; c.fillText('立入禁止', w / 2, hh * 0.36);
        c.fillStyle = '#222'; c.font = `${hh * 0.13}px ${JP_FONT}`; c.fillText('関係者以外の立入りを', w / 2, hh * 0.62); c.fillText('禁止します  鉄道会社', w / 2, hh * 0.82); }, 0.2);
      sgn.position.set(gx, yy + 1.1, z + side * 0.05); sgn.rotation.y = side > 0 ? 0 : Math.PI; scene.add(sgn); }
  }
}

// Trackside: the things that make the line read as a maintained railway rather than one repeated strip: signal /
// relay cabinets on plinths, a signal equipment hut by the station, kilometre posts every 100 m, speed boards, ATS
// beacons between the rails ahead of the signals, and at each level crossing its control cabinet. gaps: x ranges
// kept clear (crossings, platforms, bridge).
export function trackside(B, groundAt, y0, { gaps = [], crossX = [], x0 = -600, x1 = 600, stationX = 0, platformLen = 100 }) {
  const free = (x, pad = 0) => !gaps.some(([a, b]) => x > a - pad && x < b + pad) && Math.abs(groundAt(x, -80) - y0) < 0.7;
  const rng = mulberry32(2718);
  B.frame(0, 0, 0, 0);
  const cabinet = (x, z, face, big) => { // grey steel cabinet on a concrete plinth, doors, louvres, conduit into the ground
    const g = groundAt(x, z), W = big ? 1.2 : 0.8, H = big ? 1.7 : 1.3, D = 0.55, C = [0.72, 0.74, 0.74];
    B.frame(x, g, z, face);
    B.bbox('concrete', 0, -0.2, 0, W + 0.2, 0.35, D + 0.2, 0.02, { color: [0.7, 0.7, 0.68] });
    B.bbox('metal', 0, 0.15, 0, W, H, D, 0.02, { color: C }); B.bbox('metal', 0, 0.15 + H, 0, W + 0.1, 0.05, D + 0.12, 0.01, { color: [0.62, 0.64, 0.64] });
    B.detail(1, () => { B.box('dark', 0, 0.2, D / 2 + 0.002, 0.012, H - 0.1, 0.01, { color: [0.3, 0.3, 0.3] });
      for (let k = 0; k < 4; k++) B.box('dark', W / 4, H - 0.2 - k * 0.06, D / 2 + 0.003, W / 3, 0.02, 0.01, { color: [0.35, 0.36, 0.36] });
      B.box('steel', -0.08, 0.15 + H * 0.5, D / 2 + 0.02, 0.03, 0.12, 0.03, { color: [0.3, 0.3, 0.3] });
      B.cyl('dark', -W / 2 + 0.15, -0.1, -D / 2 - 0.08, 0.05, 0.05, 0.35, 8, { color: [0.2, 0.2, 0.2] }); });
    addBox(x, z, W / 2 + 0.1, D / 2 + 0.1, face);
    B.frame(0, 0, 0, 0);
  };
  // relay cabinets every 120–200 m, alternating sides, and one beside each crossing
  for (let x = x0 + 60; x < x1 - 60; x += 120 + rng() * 80) { const sd = rng() < 0.5 ? 1 : -1; if (free(x, 6)) cabinet(x, -80 + sd * 8.1, sd > 0 ? Math.PI : 0, rng() < 0.4); }
  for (const cx of crossX) cabinet(cx + (cx > 150 ? -9.5 : 9.5), -80 - 8.1, 0, true); // (landward of the riverside crossing)
  // signal equipment hut (信号機器室) by the east end of the station
  { const hx = stationX + platformLen / 2 + 24, hz = -90.0, g = groundAt(hx, hz);
    if (free(hx, 4)) { B.frame(hx, g, hz, 0);
      B.bbox('concrete', 0, -0.3, 0, 3.4, 0.4, 2.6, 0.02, { color: [0.68, 0.68, 0.66] });
      B.bbox('concrete', 0, 0.1, 0, 3.2, 2.5, 2.4, 0.03, { color: [0.84, 0.84, 0.8], uv: 2 });
      B.bbox('concrete', 0, 2.6, 0, 3.5, 0.12, 2.7, 0.02, { color: [0.62, 0.64, 0.64] });
      B.box('metal', 0.6, 0.12, 1.21, 0.9, 2.0, 0.04, { color: [0.5, 0.58, 0.62] });
      for (let k = 0; k < 5; k++) B.box('dark', -0.9, 1.4 + k * 0.1, 1.21, 0.7, 0.04, 0.03, { color: [0.3, 0.32, 0.32] });
      B.box('metal', -1.3, 2.2, 1.25, 0.4, 0.25, 0.1, { color: [0.7, 0.7, 0.66] });
      addBox(hx, hz, 1.7, 1.3, 0); B.frame(0, 0, 0, 0); } }
  // kilometre posts every 100 m (white post, black figures), facing the track
  for (let x = Math.ceil(x0 / 100) * 100; x < x1; x += 100) {
    const z = -80 + 7.7; if (!free(x, 2)) continue;
    const g = groundAt(x, z), km = (42.0 + (x + 600) / 1000).toFixed(1);
    B.frame(0, 0, 0, 0); B.bbox('concrete', x, g - 0.3, z, 0.16, 1.15, 0.16, 0.02, { color: [0.95, 0.95, 0.92] });
    const pl = signMesh(0.14, 0.3, (c, w, hh) => { c.fillStyle = '#fafaf6'; c.fillRect(0, 0, w, hh); c.fillStyle = '#111'; c.textAlign = 'center'; c.font = `bold ${w * 0.62}px Arial`;
      const [a, b] = km.split('.'); c.fillText(a, w / 2, hh * 0.44); c.fillText(b, w / 2, hh * 0.86); }, 0.1, 128);
    pl.position.set(x, g + 0.55, z - 0.085); pl.rotation.y = Math.PI; scene.add(pl);
  }
  // speed boards before the station, facing each direction of travel
  for (const [x, face, z] of [[stationX - platformLen / 2 - 55, -Math.PI / 2, -80 + 7.8], [stationX + platformLen / 2 + 55, Math.PI / 2, -80 - 7.8]]) {
    if (!free(x, 2)) continue;
    const g = groundAt(x, z);
    B.frame(0, 0, 0, 0); B.cyl('steel', x, g - 0.2, z, 0.04, 0.04, 2.4, 8, { color: [0.8, 0.8, 0.78] });
    const sb = signMesh(0.5, 0.36, (c, w, hh) => { c.fillStyle = '#f7d21a'; c.fillRect(0, 0, w, hh); c.fillStyle = '#111'; c.font = `bold ${hh * 0.7}px Arial`; c.textAlign = 'center'; c.fillText('45', w / 2, hh * 0.78); }, 0.2);
    sb.position.set(x, g + 2.0, z); sb.rotation.y = face; scene.add(sb);
    const sb2 = sb.clone(); sb2.rotation.y = face + Math.PI; sb2.position.x += face > 0 ? -0.01 : 0.01; scene.add(sb2);
  }
  // ATS beacons (地上子): yellow boxes on the sleepers between the rails, ahead of the station signals
  for (const [x, tz] of [[stationX - platformLen / 2 - 30, RAIL.z[1]], [stationX - platformLen / 2 - 90, RAIL.z[1]], [stationX + platformLen / 2 + 30, RAIL.z[0]], [stationX + platformLen / 2 + 90, RAIL.z[0]]]) {
    if (!free(x, 1)) continue;
    B.frame(x, y0 + 0.3, tz, 0); B.bbox('plastic', 0, 0, 0, 0.5, 0.1, 0.36, 0.02, { color: [0.95, 0.78, 0.1] }); B.box('dark', 0, 0.1, 0, 0.3, 0.005, 0.2, { color: [0.15, 0.15, 0.15] });
    B.frame(0, 0, 0, 0);
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
const lampOff = new THREE.MeshStandardMaterial({ color: 0x2a0606, roughness: 0.25 });
// barrier boom: a tapered aluminium tube in retro-reflective red and white bands (0.5 m each), the red leaning to pink
const boomTex = canvasTex(256, 16, (g, W, H) => { g.fillStyle = '#f3f2ee'; g.fillRect(0, 0, W, H); g.fillStyle = '#d93b52'; g.fillRect(0, 0, W / 2, H);
  g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(W / 2 - 1, 0, 2, H); g.fillRect(W - 1, 0, 1, H); g.fillRect(0, 0, 1, H); });
boomTex.wrapS = THREE.RepeatWrapping;
const boomMat = new THREE.MeshStandardMaterial({ map: boomTex, roughness: 0.38 });
const galvMat = new THREE.MeshStandardMaterial({ color: 0xa4a8ac, roughness: 0.42, metalness: 0.55 });   // galvanised steel (boom holder, hub)
const castMat = new THREE.MeshStandardMaterial({ color: 0x33363a, roughness: 0.6, metalness: 0.35 });   // cast counterweights, lamp heads
// crossbuck (踏切警標): two white boards with a red border crossed at right angles
const crossbuckTex = canvasTex(256, 256, (g, W, H) => {
  g.clearRect(0, 0, W, H); g.translate(W / 2, H / 2);
  for (const a of [Math.PI / 4, -Math.PI / 4]) { g.save(); g.rotate(a); g.fillStyle = '#d42f3c'; g.fillRect(-124, -22, 248, 44); g.restore(); }
  for (const a of [Math.PI / 4, -Math.PI / 4]) { g.save(); g.rotate(a); g.fillStyle = '#f6f5f0'; g.fillRect(-116, -14, 232, 28); g.restore(); }
});
const crossbuckMat = new THREE.MeshStandardMaterial({ map: crossbuckTex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5 });
const GALV = [0.66, 0.68, 0.7], GRAPHITE = [0.22, 0.235, 0.25], BLACK = [0.06, 0.06, 0.065], CONC = [0.7, 0.7, 0.68];
const circ = (r, n = 12, a0 = 0, a1 = Math.PI * 2) => Array.from({ length: n }, (_, i) => [Math.cos(a0 + (a1 - a0) * i / (a1 - a0 < 6.28 ? n - 1 : n)) * r, Math.sin(a0 + (a1 - a0) * i / (a1 - a0 < 6.28 ? n - 1 : n)) * r]);
// base plate with four anchor bolts and nuts, on a footing top at local y 0
function basePlate(B, w, d) {
  B.box('steel', 0, 0, 0, w, 0.022, d, { color: GALV });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const bx = sx * (w / 2 - 0.05), bz = sz * (d / 2 - 0.05);
    B.cyl('steel', bx, 0.022, bz, 0.03, 0.03, 0.022, 6, { color: [0.5, 0.52, 0.54], cap: true, smooth: false }); B.cyl('steel', bx, 0.044, bz, 0.013, 0.011, 0.035, 6, { color: [0.55, 0.56, 0.58], cap: true }); }
}
// Warning post (警報機) at (x, y, z), lamps facing each of `faces` (yaw; 0 = toward +z): a concrete footing and bolted
// base plate, a galvanised mast with a terminal box and its conduit, a steel cross-arm carrying back-to-back lamp
// targets (black boards with a white rim) with twin hooded red lamps each way, a direction indicator, the red-and-white
// crossbuck and a bell speaker on top. Lamps go to c.lamps (alternate flashing).
function warningPost(B, c, x, y, z, { H = 3.45, lampY = 2.3, span = 0.6, faces = [0, Math.PI], k = 1, crossbuck = true } = {}) {
  B.frame(x, y, z, 0);
  B.bbox('concrete', 0, -0.4, 0, 0.62 * k, 0.45, 0.62 * k, 0.03, { color: CONC });
  inFrameY(B, 0.05, () => basePlate(B, 0.4 * k, 0.4 * k));
  B.cyl('steel', 0, 0.1, 0, 0.078 * k, 0.07 * k, H - 0.1, 14, { color: GALV });
  B.cyl('steel', 0, H, 0, 0.09 * k, 0.05 * k, 0.05, 14, { color: GALV, cap: true });
  B.bbox('metal', 0.13 * k, 1.05, 0, 0.18 * k, 0.28, 0.14 * k, 0.015, { color: [0.72, 0.73, 0.72] });                          // terminal box
  B.cyl('dark', 0.13 * k, 0.12, 0.05 * k, 0.018, 0.018, 0.93, 8, { color: BLACK });                                         // its conduit
  B.box('steel', 0, lampY - 0.04, 0, 2 * span + 0.5, 0.08, 0.08, { color: GALV });                                           // cross-arm
  for (const face of faces) {
    const fz = Math.cos(face), fx = Math.sin(face);
    B.frame(x, y, z, face);
    // target board: white rim behind a black board with rounded corners
    B.bbox('plain', 0, lampY - 0.27, 0.07, 2 * span + 0.56, 0.54, 0.02, 0.06, { color: [0.93, 0.93, 0.9] });
    B.bbox('dark', 0, lampY - 0.245, 0.085, 2 * span + 0.48, 0.49, 0.025, 0.06, { color: BLACK });
    for (const lx of [-span, span]) {
      // lamp drum, and a deep visor over the top half of the lens
      B.sweep('dark', circ(0.13 * k, 14), [[lx, lampY, 0.1], [lx, lampY, 0.2]], { closed: true, caps: false, color: [0.08, 0.08, 0.09] });
      const hood = circ(0.16 * k, 9, 0.05, Math.PI - 0.05); // (both windings: it is seen from inside and out)
      for (const pr of [hood, [...hood].reverse()]) B.sweep('dark', pr, [[lx, lampY, 0.19], [lx, lampY, 0.42]], { color: [0.05, 0.05, 0.05] });
      const l = new THREE.Mesh(new THREE.CircleGeometry(0.115 * k, 20), lampOff);
      l.position.set(x + fx * 0.205 + Math.cos(face) * lx, y + lampY, z + fz * 0.205 - Math.sin(face) * lx); l.rotation.y = face; scene.add(l);
      c.lamps.push({ m: l, phase: lx > 0 ? 0 : 1 });
    }
    // direction indicator under the target: a black box with arrow lamps
    B.bbox('dark', 0, lampY - 0.66, 0.08, 0.56, 0.2, 0.1, 0.02, { color: BLACK });
    for (const sx of [-1, 1]) B.poly('plain', [[sx * 0.2, lampY - 0.56, 0.131], [sx * 0.2, lampY - 0.64, 0.131], [sx * 0.08, lampY - 0.6, 0.131]], [0, 0, 1], { color: [0.55, 0.52, 0.5] });
  }
  B.frame(x, y, z, 0);
  // bell speaker: a flared horn under a cap
  B.cyl('plastic', 0, H + 0.05, 0, 0.05, 0.16 * k, 0.2, 16, { color: [0.3, 0.31, 0.33] }); B.cyl('plastic', 0, H + 0.25, 0, 0.17 * k, 0.1 * k, 0.07, 16, { color: [0.36, 0.37, 0.39], cap: true });
  B.frame(0, 0, 0, 0);
  if (crossbuck) for (const face of faces.length > 1 ? [faces[0]] : faces) {
    const cb = new THREE.Mesh(new THREE.PlaneGeometry(1.05 * k, 1.05 * k), crossbuckMat); cb.position.set(x, y + H - 0.42 * k, z); cb.rotation.y = face; cb.castShadow = true; scene.add(cb);
  }
  addCircle(x, z, 0.2);
}
function inFrameY(B, dy, fn) { const F = B.F; B.frame(F.x, F.y + dy, F.z, F.r); fn(); B.F = F; }
// Barrier machine (電動遮断機) at (x, y, z). The drive shaft points along +side (z) toward the approaching traffic, the
// boom swings in the plane `reach` metres in front of the machine and lies toward -m (across the road). Static: concrete
// foundation, bolted base plate, a graphite-grey steel housing with a hipped lid, a hinged service door with its lock
// and louvres on the back, a maker's plate, the gearbox drum and shaft, a cable conduit into a pit at its foot. Moving
// (returned pivot, rotated about z): the flanged hub, a galvanised channel holder clamping the boom root with U-bolts,
// the counterweight arm with stacked cast weights, and the boom itself — tapered, banded red and white, with two small
// red lamps along its top and a steady red lamp at the tip. A boom rest (fork on a post) stands on the far side.
function barrierMachine(B, c, x, y, z, { side, m, armL, pivotY = 0.98, reach = 0.36, k = 1, restX = null, restY = null }) {
  B.frame(x, y, z, 0);
  B.bbox('concrete', 0, -0.36, 0, 0.78 * k, 0.44, 0.66 * k, 0.03, { color: CONC });
  inFrameY(B, 0.08, () => basePlate(B, 0.56 * k, 0.46 * k));
  const hw = 0.23 * k, hd = 0.19 * k, h0 = 0.1, h1 = pivotY + 0.14;
  B.bbox('metal', 0, h0, 0, 2 * hw, h1 - h0, 2 * hd, 0.025, { color: GRAPHITE });
  // hipped lid with a drip edge
  B.bbox('metal', 0, h1, 0, 2 * hw + 0.05, 0.035, 2 * hd + 0.05, 0.01, { color: [0.19, 0.2, 0.21] });
  const lt = h1 + 0.035, lh = 0.09;
  B.poly('metal', [[-hw - 0.02, lt, -hd - 0.02], [hw + 0.02, lt, -hd - 0.02], [hw * 0.4, lt + lh, -hd * 0.3], [-hw * 0.4, lt + lh, -hd * 0.3]], [0, 0.6, -1], { color: [0.21, 0.22, 0.23] });
  B.poly('metal', [[-hw - 0.02, lt, hd + 0.02], [hw + 0.02, lt, hd + 0.02], [hw * 0.4, lt + lh, hd * 0.3], [-hw * 0.4, lt + lh, hd * 0.3]], [0, 0.6, 1], { color: [0.23, 0.24, 0.25] });
  for (const sx of [-1, 1]) B.poly('metal', [[sx * (hw + 0.02), lt, -hd - 0.02], [sx * (hw + 0.02), lt, hd + 0.02], [sx * hw * 0.4, lt + lh, hd * 0.3], [sx * hw * 0.4, lt + lh, -hd * 0.3]], [sx, 0.6, 0], { color: [0.2, 0.21, 0.22] });
  B.poly('metal', [[-hw * 0.4, lt + lh, -hd * 0.3], [hw * 0.4, lt + lh, -hd * 0.3], [hw * 0.4, lt + lh, hd * 0.3], [-hw * 0.4, lt + lh, hd * 0.3]], [0, 1, 0], { color: [0.22, 0.23, 0.24] });
  // service door on the back (away from the road), hinges, lock; louvres low on both sides; maker's plate
  const bz = -side * (hd + 0.004);
  B.frame(x, y, z + bz, side > 0 ? Math.PI : 0);
  B.box('metal', 0, h0 + 0.08, 0.004, 2 * hw - 0.08, h1 - h0 - 0.2, 0.008, { color: [0.2, 0.215, 0.23] });
  for (const hy of [h0 + 0.2, h1 - 0.22]) B.cyl('steel', -hw + 0.03, hy, 0.012, 0.012, 0.012, 0.08, 8, { color: [0.4, 0.42, 0.44] });
  B.box('steel', hw - 0.07, (h0 + h1) / 2, 0.012, 0.03, 0.09, 0.012, { color: [0.62, 0.63, 0.64] });
  B.box('plain', 0, h1 - 0.26, 0.012, 0.16, 0.07, 0.004, { color: [0.78, 0.78, 0.74] });
  B.frame(x, y, z, 0);
  for (const sx of [-1, 1]) for (let i = 0; i < 5; i++) B.box('dark', sx * (hw + 0.003), h0 + 0.12 + i * 0.045, 0, 0.006, 0.018, 2 * hd - 0.12, { color: [0.08, 0.08, 0.09] });
  // gearbox drum on the road-facing side of the housing, and the shaft out to the hub
  B.sweep('metal', circ(0.14 * k, 16), [[0, pivotY, side * hd], [0, pivotY, side * (hd + 0.09)]], { closed: true, caps: true, color: [0.24, 0.25, 0.27] });
  B.sweep('steel', circ(0.045 * k, 10), [[0, pivotY, side * (hd + 0.09)], [0, pivotY, side * (reach - 0.03)]], { closed: true, caps: true, color: [0.6, 0.62, 0.64] });
  // cable: a flexible conduit out of the housing's side, bending down into the foundation beside the base plate
  B.sweep('dark', circ(0.026, 8), [[m * (hw - 0.01), 0.3, -side * 0.06], [m * (hw + 0.05), 0.285, -side * 0.06], [m * (hw + 0.095), 0.23, -side * 0.06], [m * (hw + 0.11), 0.15, -side * 0.06], [m * (hw + 0.11), 0.05, -side * 0.06]], { closed: true, color: BLACK });
  B.cyl('steel', m * (hw + 0.11), 0.075, -side * 0.06, 0.04, 0.036, 0.03, 10, { color: GALV, cap: true });  // gland
  B.frame(0, 0, 0, 0);
  addBox(x, z, hw + 0.05, hd + 0.05, 0);
  // ---- the moving part
  const pv = new THREE.Group(); pv.position.set(x, y + pivotY, z + side * reach);
  const G = [], W = [], D = [], BM = [];
  const add = (list, g, px = 0, py = 0, pz = 0) => { g.translate(px, py, pz); list.push(g); };
  add(G, new THREE.CylinderGeometry(0.15 * k, 0.15 * k, 0.05, 20).rotateX(Math.PI / 2), 0, 0, 0);                       // hub flange
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; add(G, new THREE.CylinderGeometry(0.016, 0.016, 0.03, 6).rotateX(Math.PI / 2), Math.cos(a) * 0.11 * k, Math.sin(a) * 0.11 * k, side * 0.035); }
  add(G, new THREE.BoxGeometry(0.72 * k, 0.12 * k, 0.07), -m * 0.3 * k, 0, side * 0.03);                                // channel holder
  for (const u of [0.42, 0.62]) add(G, new THREE.TorusGeometry(0.068 * k, 0.012, 6, 14).rotateY(Math.PI / 2), -m * u * k, 0, side * 0.03); // U-bolt clamps
  add(G, new THREE.BoxGeometry(0.62 * k, 0.07, 0.05), m * 0.3 * k, 0, side * 0.03);                                     // counterweight arm
  for (let i = 0; i < 3; i++) add(W, new THREE.BoxGeometry(0.1 * k, 0.32 * k, 0.16), m * (0.44 + i * 0.105) * k, -0.03, side * 0.03);
  const L = armL - 0.3 * k, r0 = 0.055 * k, r1 = 0.033 * k;
  const boom = new THREE.CylinderGeometry(m > 0 ? r1 : r0, m > 0 ? r0 : r1, L, 16).rotateZ(Math.PI / 2);
  { const at = boom.attributes.uv; for (let i = 0; i < at.count; i++) { const u = at.getX(i), v = at.getY(i); at.setXY(i, v * L / 1.0, u); } }
  add(BM, boom, -m * (0.3 * k + L / 2), 0, side * 0.03);
  const tipX = -m * (0.3 * k + L);
  add(D, new THREE.CylinderGeometry(r1 + 0.004, r1 + 0.004, 0.08, 12).rotateZ(Math.PI / 2), tipX + m * 0.04, 0, side * 0.03); // end cap
  // boom lamps: small black heads on top of the boom, lens both ways
  const lampAt = [0.36, 0.7, 0.985].map(f => -m * (0.3 * k + L * f));
  for (const lx of lampAt) add(D, new THREE.BoxGeometry(0.075, 0.1, 0.09), lx, r0 + 0.05, side * 0.03);
  const mk = (list, mat) => { if (!list.length) return; const g = mergeGeometries(list.map(q => q.index ? q.toNonIndexed() : q)); const me = new THREE.Mesh(g, mat); me.castShadow = true; pv.add(me); };
  mk(G, galvMat); mk(W, castMat); mk(BM, boomMat); mk(D, castMat);
  lampAt.forEach((lx, i) => { for (const f of [-1, 1]) { const l = new THREE.Mesh(new THREE.CircleGeometry(0.032, 12), lampOff); l.position.set(lx, r0 + 0.05, side * 0.03 + f * 0.047); l.rotation.y = f > 0 ? 0 : Math.PI; pv.add(l); c.lamps.push({ m: l, phase: i % 2, steady: i === 2, boom: true }); } });
  scene.add(pv);
  c.arms.push({ pivot: pv, side: m, len: armL, x0: x, z: z + side * reach });
  // the boom rest on the far side: a galvanised post with a rubber-lined fork at boom height
  if (restX !== null) {
    const ry = restY ?? y;
    B.frame(restX, ry, z + side * reach, 0);
    B.bbox('concrete', 0, -0.3, 0, 0.36, 0.36, 0.36, 0.02, { color: CONC });
    B.cyl('steel', 0, 0.06, 0, 0.045, 0.04, pivotY + (y - ry) - 0.2, 10, { color: GALV });
    const fy = pivotY + (y - ry) - 0.14;
    B.box('steel', 0, fy - 0.02, 0.03 * side, 0.1, 0.04, 0.2, { color: GALV });
    for (const e of [-1, 1]) B.box('dark', 0, fy, 0.03 * side + e * 0.085, 0.08, 0.12, 0.02, { color: BLACK });
    B.frame(0, 0, 0, 0); addCircle(restX, z + side * reach, 0.08);
  }
  return pv;
}
// Level crossing (踏切). The road runs on across the tracks at rail-head level: precast crossing panels inside and
// beside each track with flangeways left open along every rail, asphalt between the tracks, footways carried over as
// lighter concrete panels with warning tiles at both ends, a concrete edge beam where the crossing meets the ballast,
// and the road's edge lines painted on. The approach roads ramp up to it (town.js). Each approach has its warning
// machine on the driver's left (keep-left): striped mast, crossbuck, twin red lamps with hoods for both directions, a
// bell speaker and a direction indicator; and a barrier machine whose striped boom swings down across the road.
export function buildCrossing(B, x, y0, roadW, { hw = roadW / 2 - 0.2, walk = 0, side = null, lines = null, uSign = 1, sAt = null, hwAge = null, machineSide = 0, ped = false, age = 0.5, groundAt = null } = {}) {
  const rt = railTop(y0), zN = -86.9, zS = -73.1, zA = -86.6, zB = -73.4, g = RAIL.gauge;
  const top = rt - 0.003, base = y0 + 0.2;
  // the deck carries the approach's own cross-section: carriageway, and beside it the footways (walk) or the concrete
  // shoulders that continue the L-gutters (gutter). The outermost 20 cm of each side is the edge beam holding back the
  // ballast, inside the road's width, so the deck edge lines up with the back of the footway / gutter on the approach
  const sw = side ? side.w : walk > 0 ? walk : roadW / 2 - 0.2 - hw, sk = side ? side.kind : walk > 0 ? 'walk' : 'gutter', BEAM = 0.2;
  const W = ped ? roadW - 0.4 : 2 * (hw + sw);
  B.frame(x, 0, -80, 0);
  // z-intervals of the deck with the rails and their flangeways left open
  const holes = [];
  for (const tz of RAIL.z) { holes.push([tz - g / 2 - 0.045, tz - g / 2 + 0.045 + 0.065]); holes.push([tz + g / 2 - 0.045 - 0.065, tz + g / 2 + 0.045]); }
  holes.sort((p, q) => p[0] - q[0]);
  const spans = []; let z0 = zA + 80;
  for (const [h0, h1] of holes) { spans.push([z0, h0 + 80]); z0 = h1 + 80; }
  spans.push([z0, zB + 80]);
  const inTrack = zc => RAIL.z.some(tz => Math.abs(zc - (tz + 80)) < g / 2 + 0.65);
  const band = sk === 'walk' ? 'foot' : 'shoulder';
  const xs = ped ? [[-W / 2, W / 2, 'foot']] : sw > BEAM + 0.05
    ? [[-W / 2, -W / 2 + BEAM, 'beam'], [-W / 2 + BEAM, -hw, band], [-hw, hw, 'road'], [hw, W / 2 - BEAM, band], [W / 2 - BEAM, W / 2, 'beam']]
    : [[-W / 2, -hw, 'beam'], [-hw, hw, 'road'], [hw, W / 2, 'beam']];
  const ha = hwAge ?? Math.floor(hw * 10 + 1e-3) + Math.min(age, 0.99);
  const aR = (xx, zz) => [uSign * xx, ha], aS = zz => [sAt ? sAt(zz - 80) : 0, 0];
  for (const [za, zb] of spans) {
    const zc = (za + zb) / 2, dz = zb - za, track = inTrack(zc);
    for (const [xa, xb, kind] of xs) {
      const xc = (xa + xb) / 2, dx = xb - xa;
      if (kind === 'foot') B.bbox('concrete', xc, base, zc, dx, top - base, dz, 0.01, { color: [0.8, 0.79, 0.76], skip: 'ny', uv: 1.2 });
      else if (kind === 'shoulder') B.box('concrete', xc, base, zc, dx, top - base, dz, { color: [0.78, 0.78, 0.75], skip: 'ny', uv: 1.5 });
      else if (kind === 'beam') B.box('concrete', xc, y0 - 0.1, zc, dx, top - y0 + 0.1, dz, { color: [0.7, 0.7, 0.68], skip: 'ny', uv: 1.5 });
      else if (track) { // precast panels, 1 m modules with joints
        const n = Math.max(1, Math.round(dx));
        for (let i = 0; i < n; i++) B.bbox('concrete', xa + (i + 0.5) * dx / n, base, zc, dx / n - 0.012, top - base, dz, 0.012, { color: [0.5, 0.5, 0.49], skip: 'ny', uv: 1 });
      } else { // asphalt between and beside the tracks, laid in 1 m strips so it carries the approach's lane coordinates
        B.box('asphalt', xc, base, zc, dx, top - base, dz, { skip: 'ny py', uv: 4, attr: undefined });
        const nx = Math.max(1, Math.ceil(dx / 1.1));
        for (let i = 0; i < nx; i++) { const x0 = xa + dx * i / nx, x1 = xa + dx * (i + 1) / nx;
          B.quad('asphalt', [x0, top, zb], [x1, top, zb], [x1, top, za], [x0, top, za], { uvs: [[(x + x0) / 4, (zb - 80) / 4], [(x + x1) / 4, (zb - 80) / 4], [(x + x1) / 4, (za - 80) / 4], [(x + x0) / 4, (za - 80) / 4]],
            attr: { aRoad: [aR(x0, zb), aR(x1, zb), aR(x1, za), aR(x0, za)], aRoadS: [aS(zb), aS(zb), aS(za), aS(za)] } }); }
      }
    }
    // edge lines painted over each piece where the approach has them (not across the flangeways)
    if (!ped) for (const [ex, lw] of lines || [-1, 1].map(s2 => [s2 * (hw - 0.25), 0.15])) B.quad('paint', [ex - lw / 2, top + 0.003, za + 0.01], [ex + lw / 2, top + 0.003, za + 0.01], [ex + lw / 2, top + 0.003, zb - 0.01], [ex - lw / 2, top + 0.003, zb - 0.01], { color: [0.94, 0.94, 0.92] });
    if (sk === 'walk' && !ped) for (const s2 of [-1, 1]) B.quad('paint', [s2 * hw - 0.05, top + 0.003, za + 0.01], [s2 * hw + 0.05, top + 0.003, za + 0.01], [s2 * hw + 0.05, top + 0.003, zb - 0.01], [s2 * hw - 0.05, top + 0.003, zb - 0.01], { color: [0.94, 0.94, 0.92] });
  }
  // flangeway floors (dark, below the rail head) so the gaps read as slots, not holes into the ballast
  for (const [h0, h1] of holes) B.box('dark', 0, rt - 0.09, (h0 + h1) / 2 + 80, W, 0.02, h1 - h0, { color: [0.12, 0.12, 0.12] });
  if (sk === 'walk' && !ped) for (const zz of [zA + 80 + 0.45, zB + 80 - 0.45]) for (const s2 of [-1, 1]) // warning tiles where the footway meets the tracks
    B.poly('tactileD', [[s2 * hw + s2 * 0.25, top + 0.004, zz - 0.3], [s2 * hw + s2 * 0.25, top + 0.004, zz + 0.3], [s2 * (W / 2 - BEAM - 0.15), top + 0.004, zz + 0.3], [s2 * (W / 2 - BEAM - 0.15), top + 0.004, zz - 0.3]], [0, 1, 0], { uvs: [[0, 0], [0, 2], [(W / 2 - BEAM - hw - 0.4) / 0.3, 2], [(W / 2 - BEAM - hw - 0.4) / 0.3, 0]] });
  B.frame(0, 0, 0, 0);
  const c = { x, active: false, t: 0, arms: [], lamps: [], bell: new Emitter('bell'), roadW };
  c.bell.set(x, y0 + 3, -80);
  // each approach: on the driver's left (keep-left) the warning post, and just before it, facing the traffic, the
  // barrier machine whose boom closes the whole road; its rest stands beyond the far kerb
  for (const [z, side] of [[zN, -1], [zS, 1]]) {
    const m = machineSide || -side, mx = x + m * (roadW / 2 + 0.75), mz = z + side * 0.35, gy = (groundAt ? groundAt(mx, mz) : y0 + 0.4) + 0.02;
    warningPost(B, c, mx, gy, mz, {});
    const bz = mz + side * 0.62, rx = x - m * (roadW / 2 + 0.42);
    barrierMachine(B, c, mx, (groundAt ? groundAt(mx, bz) : gy) + 0.02, bz, { side, m, armL: roadW + 0.2 - 0.02, restX: rx, restY: (groundAt ? groundAt(rx, bz + side * 0.36) : gy) + 0.02 });
    // cable trough (concrete, lidded) from the post's pit back toward the relay cabinet by the track
    B.frame(mx, gy, mz - side * 0.9, 0); B.bbox('concrete', 0, -0.12, 0, 0.32, 0.16, 1.2, 0.015, { color: [0.66, 0.66, 0.64] });
    for (let i = 0; i < 3; i++) B.box('concrete', 0, 0.04, -0.4 + i * 0.4, 0.3, 0.012, 0.38, { color: [0.72, 0.72, 0.7] }); B.frame(0, 0, 0, 0);
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
    for (const l of c.lamps) l.m.material = c.active && (l.steady ? down > 0.05 : l.boom ? down > 0.05 && flash === l.phase : flash === l.phase) ? lampOn : lampOff;
    c.bell.on = c.active;
    c.down = down;
  }
}

// ---------------------------------------------------------------- pedestrian level crossing (歩行者踏切)
// A footpath crossing both tracks on the embankment, following the path's own line (cx(z) = path centre x, the path
// runs along z, the tracks along x). Built the way such crossings are: precast concrete panels on the shoulders and
// between the tracks, black rubber gauge panels inside each track, every rail in its own flangeway with steel guard
// angles, concrete edge beams holding back the ballast on both sides, yellow edge lines and warning tactile blocks at
// both ends. Each approach ramps up from the path at 1 in 12 with a grated drain across its foot, a railing on the
// open (river) side, a pipe guard fence on the other and a pair of staggered bollard hoops; at the top of each ramp a
// pedestrian barrier machine with a short striped boom, a warning post with twin lamps, crossbuck, bell, a name
// plate, an emergency button and a stop sign. Returns the crossing (animated with the road crossings).
export function pedCrossing(B, { cx, sd, y0, hw = 1.5, name = '桜川河畔踏切', zA = -86.6, zB = -73.4, ramp = 4.0, pathY = y0 + 0.12 }) {
  const rt = railTop(y0), top = rt - 0.003, g = RAIL.gauge, DEP = 0.16;
  const E = (z, u, y) => [cx(z) + u, y, z];                                       // u: world-x offset from the path centre
  B.frame(0, 0, 0, 0);
  // flangeways / rail heads to leave open
  const holes = [];
  for (const tz of RAIL.z) { holes.push([tz - g / 2 - 0.045, tz - g / 2 + 0.11]); holes.push([tz + g / 2 - 0.11, tz + g / 2 + 0.045]); }
  holes.sort((p, q) => p[0] - q[0]);
  const spans = []; { let z0 = zA; for (const [h0, h1] of holes) { spans.push([z0, h0]); z0 = h1; } spans.push([z0, zB]); }
  const gauge = ([a, b]) => RAIL.z.some(tz => a > tz - g / 2 - 0.01 && b < tz + g / 2 + 0.01);
  // one precast panel: a slab with a small chamfer round its top (so the joints read), skewed with the path
  const panel = (z0, z1, u0, u1, mat, col) => {
    const c = 0.014, yb = top - DEP, yt = top;
    const bot = [E(z0, u0, yb), E(z0, u1, yb), E(z1, u1, yb), E(z1, u0, yb)];
    const mid = [E(z0, u0, yt - c), E(z0, u1, yt - c), E(z1, u1, yt - c), E(z1, u0, yt - c)];
    const tp = [E(z0 + c, u0 + c, yt), E(z0 + c, u1 - c, yt), E(z1 - c, u1 - c, yt), E(z1 - c, u0 + c, yt)];
    B.poly(mat, [tp[0], tp[3], tp[2], tp[1]], [0, 1, 0], { color: col, uv: 1 });
    const outs = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // side normals: -z, +x, +z, -x (per edge 0-1, 1-2, 2-3, 3-0)
    const nrm = [[0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0]];
    for (let e = 0; e < 4; e++) { const a = e, b = (e + 1) % 4;
      B.poly(mat, [mid[a], mid[b], tp[b], tp[a]], [nrm[e][0], 0.7, nrm[e][2]], { color: col.map(v => v * 0.9) });
      B.poly(mat, [bot[a], bot[b], mid[b], mid[a]], nrm[e], { color: col.map(v => v * 0.85) }); void outs; }
  };
  const CON = [0.72, 0.71, 0.68], RUB = [0.15, 0.15, 0.16], half = [[-hw, 0], [0, hw]], thirds = [[-hw, -hw / 3], [-hw / 3, hw / 3], [hw / 3, hw]];
  for (const sp of spans) {
    const [z0, z1] = sp, L = z1 - z0, rub = gauge(sp);
    if (rub) { for (const [u0, u1] of thirds) { panel(z0 + 0.004, z1 - 0.004, u0 + 0.004, u1 - 0.004, 'plain', RUB);
        // anti-slip ribs moulded into the rubber
        for (let k = 1; k < 6; k++) { const zz = z0 + L * k / 6; B.poly('plain', [E(zz - 0.012, u0 + 0.06, top + 0.004), E(zz + 0.012, u0 + 0.06, top + 0.004), E(zz + 0.012, u1 - 0.06, top + 0.004), E(zz - 0.012, u1 - 0.06, top + 0.004)], [0, 1, 0], { color: [0.1, 0.1, 0.11] }); } } }
    else { const n = Math.max(1, Math.round(L / 1.2));
      for (let k = 0; k < n; k++) for (const [u0, u1] of half) panel(z0 + L * k / n + 0.004, z0 + L * (k + 1) / n - 0.004, u0 + 0.004, u1 - 0.004, 'concrete', CON.map(v => v * (0.96 + ((k * 7 + (u0 < 0 ? 3 : 0)) % 5) * 0.015))); }
    // yellow edge lines on the concrete, keeping walkers off the ballast
    if (!rub) for (const s of [-1, 1]) { const u = s * (hw - 0.14); B.poly('paint', [E(z0 + 0.03, u - 0.05, top + 0.003), E(z0 + 0.03, u + 0.05, top + 0.003), E(z1 - 0.03, u + 0.05, top + 0.003), E(z1 - 0.03, u - 0.05, top + 0.003)], [0, 1, 0], { color: [0.95, 0.78, 0.12] }); }
    // concrete edge beams against the ballast, broken at every rail
    for (const s of [-1, 1]) { const ua = s * hw, ub = s * (hw + 0.2), yb = y0 + 0.05, ye = top - 0.003;
      B.poly('concrete', [E(z0, ub, ye), E(z1, ub, ye), E(z1, ua, ye), E(z0, ua, ye)], [0, 1, 0], { color: [0.64, 0.64, 0.62] });
      B.poly('concrete', [E(z0, ub, yb), E(z1, ub, yb), E(z1, ub, ye), E(z0, ub, ye)], [s, 0, 0], { color: [0.6, 0.6, 0.58] }); }
  }
  // flangeways: dark floors and steel guard angles along both lips
  for (const [h0, h1] of holes) {
    B.poly('dark', [E(h0, -hw - 0.2, rt - 0.1), E(h1, -hw - 0.2, rt - 0.1), E(h1, hw + 0.2, rt - 0.1), E(h0, hw + 0.2, rt - 0.1)], [0, 1, 0], { color: [0.08, 0.08, 0.08] });
    for (const zz of [h0, h1]) { const s = zz === h0 ? 1 : -1;
      B.poly('steel', [E(zz, -hw, top + 0.002), E(zz - s * 0.025, -hw, top + 0.002), E(zz - s * 0.025, hw, top + 0.002), E(zz, hw, top + 0.002)], [0, 1, 0], { color: [0.55, 0.56, 0.58] });
      B.poly('steel', [E(zz, -hw, top - 0.09), E(zz, hw, top - 0.09), E(zz, hw, top + 0.002), E(zz, -hw, top + 0.002)], [0, 0, -s], { color: [0.4, 0.41, 0.43] }); }
  }
  // warning tactile blocks across the path, 30 cm in from both ends of the crossing
  for (const [za, zb] of [[zA + 0.3, zA + 0.9], [zB - 0.9, zB - 0.3]])
    B.poly('tactileD', [E(za, -hw + 0.25, top + 0.005), E(zb, -hw + 0.25, top + 0.005), E(zb, hw - 0.25, top + 0.005), E(za, hw - 0.25, top + 0.005)], [0, 1, 0], { uvs: [[0, 0], [2, 0], [2, (2 * hw - 0.5) / 0.3], [0, (2 * hw - 0.5) / 0.3]] });
  // ---- approaches
  const RC = { color: [0.3, 0.52, 0.47] }, GF = { color: [0.9, 0.9, 0.88] };
  const posts = [];
  for (const [zc, e] of [[zA, -1], [zB, 1]]) {
    const zf = zc + e * ramp, yAt = z => lerp(top, pathY, Math.abs(z - zc) / ramp), N = 6;
    for (let k = 0; k < N; k++) { const za = zc + e * ramp * k / N, zb = zc + e * ramp * (k + 1) / N;
      const q = [E(za, -hw, yAt(za)), E(za, hw, yAt(za)), E(zb, hw, yAt(zb)), E(zb, -hw, yAt(zb))];
      B.poly('pavement', q, [0, 1, 0], { uv: 1.5, color: [0.86, 0.84, 0.8] });
      for (const s of [-1, 1]) { const u = s * hw; B.poly('concrete', [E(za, u, pathY - 1.1), E(zb, u, pathY - 1.1), E(zb, u, yAt(zb)), E(za, u, yAt(za))], [s, 0, 0], { color: [0.72, 0.72, 0.7] }); }
      B.poly('concrete', [E(za, hw, yAt(za) + 0.001), E(za, hw + 0.12, yAt(za) + 0.001), E(zb, hw + 0.12, yAt(zb) + 0.001), E(zb, hw, yAt(zb) + 0.001)], [0, 1, 0], { color: [0.7, 0.7, 0.68] }); }
    // a flat landing between the ramp and the crossing panels is the crossing's own shoulder; the ramp's end face
    B.poly('concrete', [E(zc, -hw - 0.2, y0 - 0.3), E(zc, hw + 0.2, y0 - 0.3), E(zc, hw + 0.2, top), E(zc, -hw - 0.2, top)], [0, 0, e], { color: [0.66, 0.66, 0.64] });
    // grated drain across the foot of the ramp
    { const z0 = zf + e * 0.05, z1 = zf + e * 0.45, yd = pathY + 0.001;
      B.poly('concrete', [E(z0, -hw, yd), E(z0, hw, yd), E(z1, hw, yd), E(z1, -hw, yd)], [0, 1, 0], { color: [0.62, 0.62, 0.6] });
      B.poly('dark', [E(z0 + e * 0.07, -hw + 0.05, yd + 0.002), E(z0 + e * 0.07, hw - 0.05, yd + 0.002), E(z1 - e * 0.07, hw - 0.05, yd + 0.002), E(z1 - e * 0.07, -hw + 0.05, yd + 0.002)], [0, 1, 0], { color: [0.1, 0.1, 0.1] });
      for (let k = 0; k <= 24; k++) { const u = -hw + 0.07 + k * (2 * hw - 0.14) / 24; B.poly('steel', [E(z0 + e * 0.07, u - 0.012, yd + 0.006), E(z0 + e * 0.07, u + 0.012, yd + 0.006), E(z1 - e * 0.07, u + 0.012, yd + 0.006), E(z1 - e * 0.07, u - 0.012, yd + 0.006)], [0, 1, 0], { color: [0.32, 0.33, 0.34] }); } }
    // railing on the river side (continuing the walkway's), a white pipe guard fence on the land side
    for (const [s, C, h, r] of [[-sd, RC, 1.02, 0.035], [sd, GF, 0.9, 0.024]]) {
      const u = s < 0 === sd > 0 ? -sd * (hw - 0.4) : s * (hw - 0.1), zs = [zf, zf - e * ramp * 0.5, zc - e * 0.25]; // (river side in line with the walkway railing)
      for (const zz of zs) { const p = E(zz, u, yAt(zz)); B.cyl('steel', p[0], p[1] - 0.05, p[2], 0.028, 0.028, h + 0.05, 8, { color: C.color, cap: true }); posts.push([p[0], p[2]]); }
      for (const f of [1, 0.5]) { const a = E(zs[0], u, yAt(zs[0]) + h * f), b = E(zs[2], u, yAt(zs[2]) + h * f); B.beam('steel', a, b, f === 1 ? r * 2 : r, f === 1 ? r * 2 : r, C); }
      const a = E(zs[0], u, 0), b = E(zs[2], u, 0); addBox((a[0] + b[0]) / 2, (a[2] + b[2]) / 2, 0.06, Math.abs(b[2] - a[2]) / 2, Math.atan2(b[0] - a[0], b[2] - a[2]), -1e9, pathY + h + 0.3);
    }
    // staggered bollard hoops (車止め) at the foot: one from each side, a bicycle slows through, a car can't enter
    for (const [s, dz] of [[-1, 0.9], [1, 1.9]]) { const zz = zf + e * dz, uc = s * hw * 0.35, W2 = hw * 0.9, H2 = 0.85, BY = pathY, uL = uc - W2 / 2, uR = uc + W2 / 2;
      const hoop = [E(zz, uL, BY - 0.05), E(zz, uL, BY + H2 - 0.1), E(zz, uL + 0.1, BY + H2), E(zz, uR - 0.1, BY + H2), E(zz, uR, BY + H2 - 0.1), E(zz, uR, BY - 0.05)];
      const YB = [0.95, 0.78, 0.1], BK = [0.1, 0.1, 0.1];
      for (let k = 0; k + 1 < hoop.length; k++) B.beam('steel', hoop[k], hoop[k + 1], 0.055, 0.055, { color: k === 2 ? BK : YB });
      for (const u of [uL, uR]) for (const f of [0.3, 0.6]) { const p = E(zz, u, BY + H2 * f); B.cyl('steel', p[0], p[1], p[2], 0.032, 0.032, 0.09, 10, { color: BK }); }
      const p = E(zz, uc, 0); addBox(p[0], p[2], W2 / 2, 0.06, 0, -1e9, BY + 0.9); }
  }
  // ---- warning equipment at the top of each ramp, on the land side of the path
  const c = { x: cx((zA + zB) / 2), active: false, t: 0, arms: [], lamps: [], bell: new Emitter('bell'), roadW: 2 * hw + 0.4, ped: true };
  c.bell.set(c.x, y0 + 2.6, (zA + zB) / 2);
  for (const [zc, e] of [[zA, -1], [zB, 1]]) {
    const mz = zc + e * 0.55, mx = cx(mz) + sd * (hw + 0.55), gy = pathY + (top - pathY) * (1 - 0.55 / ramp) - 0.05, face = e;
    // warning post (the road crossings' post at a smaller scale, lamps toward the walker only) and an emergency button
    warningPost(B, c, mx, gy, mz, { H: 2.75, lampY: 1.85, span: 0.34, faces: [face > 0 ? 0 : Math.PI], k: 0.8 });
    B.frame(mx, gy, mz, 0);
    B.bbox('plastic', sd * 0.1, 0.95, e * 0.1, 0.2, 0.26, 0.12, 0.02, { color: [0.85, 0.12, 0.1] });                        // emergency button box
    B.box('plastic', sd * 0.1, 1.04, e * 0.165, 0.08, 0.08, 0.01, { color: [0.95, 0.9, 0.3] });
    B.frame(0, 0, 0, 0);
    // plates: name, and a stop / look-out sign facing the walker
    { const np = signMesh(0.5, 0.16, (gg, W2, H2) => { gg.fillStyle = '#f4f4ee'; gg.fillRect(0, 0, W2, H2); gg.fillStyle = '#222'; gg.font = `bold ${H2 * 0.62}px ${JP_FONT}`; gg.textAlign = 'center'; gg.textBaseline = 'middle'; gg.fillText(name, W2 / 2, H2 * 0.54); }, 0.2, 64);
      np.position.set(mx, gy + 1.28, mz + e * 0.065); np.rotation.y = face > 0 ? 0 : Math.PI; scene.add(np);
      const st = signMesh(0.5, 0.62, (gg, W2, H2) => { gg.fillStyle = '#fff'; gg.fillRect(0, 0, W2, H2); gg.fillStyle = '#d42020'; gg.beginPath(); gg.moveTo(W2 / 2, H2 * 0.05); gg.lineTo(W2 * 0.95, H2 * 0.55); gg.lineTo(W2 * 0.05, H2 * 0.55); gg.closePath(); gg.fill();
        gg.fillStyle = '#fff'; gg.font = `bold ${H2 * 0.15}px ${JP_FONT}`; gg.textAlign = 'center'; gg.fillText('止まれ', W2 / 2, H2 * 0.46); gg.fillStyle = '#111'; gg.font = `bold ${H2 * 0.12}px ${JP_FONT}`; gg.fillText('踏切注意', W2 / 2, H2 * 0.72); gg.fillText('左右確認', W2 / 2, H2 * 0.9); }, 0.25, 128);
      st.position.set(mx, gy + 0.62, mz + e * 0.065); st.rotation.y = face > 0 ? 0 : Math.PI; scene.add(st); }
    // pedestrian barrier machine beside the post, a short boom across the path
    const bz = mz - e * 0.45, bx = cx(bz) + sd * (hw + 0.45), by = pathY + (top - pathY) * (1 - Math.abs(bz - zc) / ramp) - 0.03;
    barrierMachine(B, c, bx, by, bz, { side: e, m: sd, armL: 2 * hw + 0.25, pivotY: 0.78, reach: 0.27, k: 0.74 });
  }
  crossings.push(c);
  return c;
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
