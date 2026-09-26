// Railway: double track (1067 mm gauge), catenary, tunnels, girder bridge, station, level crossings, EMU trains.
import { THREE, scene, S, clamp, lerp, smoothstep, mulberry32, addBox, addCircle, addPlatform } from './core.js';
import { GeoBuilder, materials, canvasTex, signMesh, JP_FONT, night, lampPoints, glowMats } from './townkit.js';
import { Emitter, audio } from './audio.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const RAIL = { z: [-82.1, -77.9], gauge: 1.067, portal: 700, stationX: -8, platformLen: 100 };
// ground level y0: ballast top = y0 + 0.2, rail top = y0 + 0.45
export function railTop(y0) { return y0 + 0.45; }

const stripeTex = canvasTex(256, 32, (g, W, H) => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#111' : '#f2c200'; g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32 + 32, 0); g.lineTo(i * 32 + 16, H); g.lineTo(i * 32 - 16, H); g.fill(); } });
stripeTex.wrapS = THREE.RepeatWrapping;

export function buildRailway(ctx) {
  const { y0, riverX, B } = ctx, MT = materials();
  const rt = railTop(y0), X0 = -RAIL.portal - 60, X1 = RAIL.portal + 60;
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
    for (let s = 0; s < 6; s++) { const t0 = s / 6, t1 = (s + 1) / 6; cw.push(lerp(a[0], b[0], t0), a[1], lerp(a[2], b[2], t0), lerp(a[0], b[0], t1), a[1], lerp(a[2], b[2], t1)); }
    for (let s = 0; s < 6; s++) { const t0 = s / 6, t1 = (s + 1) / 6, sag = t => 0.5 * 4 * t * (1 - t); cw.push(lerp(a[0], b[0], t0), rt + 6.0 - sag(t0), tz, lerp(a[0], b[0], t1), rt + 6.0 - sag(t1), tz); }
  }
  const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(cw, 3));
  const cl = new THREE.LineSegments(cg, new THREE.LineBasicMaterial({ color: 0x3a3a38 })); cl.frustumCulled = false; scene.add(cl);

  // tunnel portals + dark interiors
  const portalShape = new THREE.Shape(); portalShape.moveTo(-9, -1); portalShape.lineTo(9, -1); portalShape.lineTo(9, 11); portalShape.lineTo(-9, 11); portalShape.lineTo(-9, -1);
  const hole = new THREE.Path(); hole.moveTo(-5, -0.5); hole.lineTo(5, -0.5); hole.lineTo(5, 4.5); hole.absarc(0, 4.5, 5, 0, Math.PI, false); hole.lineTo(-5, -0.5);
  portalShape.holes.push(hole);
  const pg = new THREE.ExtrudeGeometry(portalShape, { depth: 1.2, bevelEnabled: false });
  for (const sx of [-1, 1]) {
    const px = sx * RAIL.portal;
    const p = new THREE.Mesh(pg, MT.concrete); p.rotation.y = Math.PI / 2 * sx; p.position.set(px, y0, -80); p.castShadow = p.receiveShadow = true; scene.add(p);
    const box = new THREE.Mesh(new THREE.BoxGeometry(90, 10, 10), new THREE.MeshBasicMaterial({ color: 0x030303, side: THREE.BackSide, fog: false }));
    box.position.set(px + sx * 45.6, y0 + 4.5, -80); scene.add(box);
    addBox(px + sx * 1.0, -80, 0.8, 9.5, 0); // nobody walks into the tunnel
  }

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
    B.box('plain', (sx0 + sx1) / 2, ptop, edge + P.side * 0.95, sx1 - sx0, 0.012, 0.3, { color: [0.95, 0.78, 0.05] }); // tactile strip
    addPlatform((sx0 + sx1) / 2, zc, (sx1 - sx0) / 2, dz / 2, 0, ptop);
    // canopy over the middle
    const c0 = RAIL.stationX - 24, c1 = RAIL.stationX + 24, back = P.side > 0 ? P.z1 - 0.8 : P.z0 + 0.8;
    for (let x = c0; x <= c1; x += 8) { B.frame(x, ptop, back, 0); B.box('metal', 0, 0, 0, 0.2, 3.3, 0.2, { color: [0.3, 0.33, 0.36] }); addBox(x, back, 0.15, 0.15, 0); }
    B.frame(0, 0, 0, 0);
    const cz0 = P.side > 0 ? P.z0 + 0.3 : P.z0 - 0.4, cz1 = P.side > 0 ? P.z1 + 0.4 : P.z1 - 0.3;
    B.quad('roofMetal', [c0 - 1, ptop + 3.4, cz1], [c1 + 1, ptop + 3.4, cz1], [c1 + 1, ptop + 3.6, cz0], [c0 - 1, ptop + 3.6, cz0], { color: [0.55, 0.57, 0.58], uv: 2 });
    B.quad('plain', [c1 + 1, ptop + 3.4, cz1], [c0 - 1, ptop + 3.4, cz1], [c0 - 1, ptop + 3.6, cz0], [c1 + 1, ptop + 3.6, cz0], { color: [0.8, 0.8, 0.78] });
    for (let x = c0 + 2; x < c1; x += 6) { B.frame(x, ptop + 3.3, (cz0 + cz1) / 2, 0); B.box('lamp', 0, 0, 0, 1.2, 0.05, 0.12); lampPoints.push({ p: [x, ptop + 3.0, (cz0 + cz1) / 2], s: 0.7 }); }
    // fence along the back edge
    B.frame(0, 0, 0, 0);
    const fz = P.side > 0 ? P.z1 - 0.05 : P.z0 + 0.05;
    const gapX = sx0 + 6, fence = P.side > 0 ? [[sx0, gapX - 1.8], [gapX + 1.8, sx1]] : [[sx0, sx1]]; // opening at the stairs
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
  // stairs/ramps: south platform to plaza (west end) and pedestrian crossing between platforms at the west end
  const steps = Math.ceil((ptop - y0) / 0.16), stx = sx0 + 6;
  for (let i = 0; i < steps; i++) {
    const h = (i + 1) * (ptop - y0) / steps, z = -73.2 + 0.3 + (steps - 1 - i) * 0.3;
    B.frame(stx, y0, z + 0.15, 0); B.box('concrete', 0, 0, 0, 3.2, h, 0.3, { color: [0.72, 0.72, 0.7] });
    addPlatform(stx, z + 0.15, 1.6, 0.15, 0, y0 + h);
  }
  B.frame(0, 0, 0, 0);
  for (const s of [-1, 1]) B.box('alu', stx + s * 1.62, y0, -73.2 + steps * 0.15, 0.05, ptop - y0 + 1.0, steps * 0.3, { color: [0.6, 0.62, 0.64], skip: 'ny' });
  // pedestrian crossing (構内踏切) with ramps between platforms at the west end
  const pcx = sx0 - 4;
  B.frame(pcx, 0, -80, 0); B.box('wood', 0, y0 + 0.2, 0, 2.4, 0.26, 12.8, { color: [0.45, 0.4, 0.34] });
  addPlatform(pcx, -80, 1.2, 6.4, 0, y0 + 0.46);
  for (const P of platforms) {
    const zc = (P.z0 + P.z1) / 2, n = 6;
    for (let i = 0; i < n; i++) { const x = sx0 - 0.5 - i * 0.6, h = ptop - (i + 1) * (ptop - y0 - 0.46) / n; B.frame(x, 0, zc, 0); B.box('concrete', 0, y0, 0, 0.6, h - y0, P.z1 - P.z0, { color: [0.72, 0.72, 0.7] }); addPlatform(x, zc, 0.3, (P.z1 - P.z0) / 2, 0, h); }
  }
  // station building on the plaza side
  const bx = RAIL.stationX + 6, bz = -68;
  B.frame(bx, y0, bz, 0);
  B.box('concrete', 0, 0, 0, 16, 0.25, 9, { color: [0.7, 0.7, 0.68] });
  B.box('stucco', 0, 0.25, 0, 15, 3.6, 8, { color: [0.95, 0.94, 0.9], skip: 'ny', uv: 3 });
  B.quad('shopWindow', [-3, 0.35, 4.02], [3, 0.35, 4.02], [3, 2.7, 4.02], [-3, 2.7, 4.02], { color: [1.1, 1.05, 0.95], uvs: [[0, 0], [1, 0], [1, 1], [0, 1]] });
  for (let i = 0; i <= 4; i++) B.box('alu', -3 + i * 1.5, 0.3, 4.03, 0.06, 2.45, 0.06);
  B.box('roofMetal', 0, 3.85, 0.5, 17, 0.25, 10.5, { color: [0.25, 0.3, 0.38], uv: 2 });
  B.box('plain', 0, 2.75, 5.0, 8, 0.1, 2.0, { color: [0.3, 0.3, 0.32] });
  addBox(bx, bz, 7.5, 4, 0);
  const nameBoard = signMesh(6, 0.9, (g, W, H) => { g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.fillStyle = '#146c43'; g.fillRect(0, H * 0.82, W, H * 0.18); g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `bold ${H * 0.52}px ${JP_FONT}`; g.fillText('桜川駅', W * 0.36, H * 0.42); g.font = `bold ${H * 0.2}px Arial`; g.fillText('SAKURAGAWA Sta.', W * 0.78, H * 0.42); }, 1.1);
  nameBoard.position.set(bx, y0 + 3.3, bz + 4.05); scene.add(nameBoard);
  lampPoints.push({ p: [bx, y0 + 2.6, bz + 5.5], s: 1 });
  return { ptop, platforms };
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
const armMat = new THREE.MeshStandardMaterial({ map: stripeTex, roughness: 0.5 });
const crossbuckTex = canvasTex(256, 256, (g, W, H) => {
  g.clearRect(0, 0, W, H); g.translate(W / 2, H / 2);
  for (const a of [Math.PI / 4, -Math.PI / 4]) { g.save(); g.rotate(a); g.fillStyle = '#111'; g.fillRect(-120, -22, 240, 44); for (let i = -120; i < 120; i += 40) { g.fillStyle = '#f2c200'; g.fillRect(i, -18, 20, 36); } g.restore(); }
});
const crossbuckMat = new THREE.MeshStandardMaterial({ map: crossbuckTex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5 });
export function buildCrossing(B, x, y0, roadW) {
  const rt = railTop(y0), zN = -86.9, zS = -73.1, MT = materials();
  // road deck across the tracks (rubber/concrete panels)
  B.frame(x, 0, -80, 0);
  B.box('concrete', 0, y0 + 0.2, 0, roadW, 0.25, 13.6, { color: [0.45, 0.45, 0.44], uv: 1.5 });
  for (const tz of RAIL.z) for (const s of [-1, 1]) B.box('dark', 0, y0 + 0.45, tz - (-80) + s * (RAIL.gauge / 2 + 0.05), roadW, 0.01, 0.05);
  const c = { x, active: false, t: 0, arms: [], lamps: [], bell: new Emitter('bell'), roadW };
  c.bell.set(x, y0 + 3, -80);
  for (const [z, side] of [[zN, -1], [zS, 1]]) {
    // machine on the left of traffic entering the crossing from this side
    const mx = x + side * (roadW / 2 + 0.7), mz = z + side * 0.4;
    B.frame(mx, y0, mz, 0);
    for (let i = 0; i < 12; i++) B.cyl('plain', 0, i * 0.28, 0, 0.07, 0.07, 0.28, 8, { color: i % 2 ? [0.08, 0.08, 0.08] : [0.95, 0.75, 0.05] });
    B.box('dark', 0, 0, 0.4 * side, 0.45, 1.1, 0.45);
    B.box('dark', 0, 2.6, 0, 1.3, 0.08, 0.08);
    addCircle(mx, mz, 0.3);
    const cb = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), crossbuckMat); cb.position.set(mx, y0 + 3.35, mz); scene.add(cb);
    for (const face of [0, Math.PI]) for (const lx of [-0.55, 0.55]) {
      const l = new THREE.Mesh(new THREE.CircleGeometry(0.16, 16), lampOff);
      const hood = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.18, 16, 1, true, 0, Math.PI), new THREE.MeshStandardMaterial({ color: 0x111111, side: THREE.DoubleSide }));
      const grp = new THREE.Group(); grp.position.set(mx, y0 + 2.62, mz); grp.rotation.y = face;
      l.position.set(lx, 0, 0.09); hood.rotation.x = Math.PI / 2; hood.position.set(lx, 0.02, 0.12); grp.add(l, hood); scene.add(grp);
      c.lamps.push({ m: l, phase: lx > 0 ? 0 : 1 });
    }
    // barrier arm across the incoming lane(s): pivots up (vertical) / down (horizontal)
    const pivot = new THREE.Group(); pivot.position.set(mx, y0 + 0.9, mz + side * 0.4);
    const armL = roadW + 0.2;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(armL, 0.09, 0.07), armMat);
    arm.geometry.translate(-side * armL / 2, 0, 0); arm.castShadow = true;
    const at = arm.geometry.attributes.uv; for (let i = 0; i < at.count; i++) at.setX(i, at.getX(i) * armL / 1.6);
    pivot.add(arm); scene.add(pivot);
    c.arms.push({ pivot, side, len: armL, x0: mx, z: mz + side * 0.4 });
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
