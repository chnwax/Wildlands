// Sakuragawa station (桜川駅) and its forecourt (駅前広場).
// The station building is a small-town ticket hall with rendered walls and real openings: a glazed entrance under a
// cantilevered canopy that carries the name board, a ticket office with its window, a glazed waiting room, ticket
// machines under a fare chart, automatic gates, a departures board, and stairs behind the gates that climb to a door
// onto the platform. A tiled hip roof with gutters and downpipes sits over it.
// In front: a paved square, and a one-way bus / taxi loop (ロータリー) around a raised island with bus berths under a
// long canopy, a taxi rank, a planted bed and a monument. Kerbs are swept along rounded outlines, crossings are raised
// tables with zebra bars, and tactile paving leads from the ticket hall across to the bus berths.
import { THREE, scene, clamp, lerp, addBox, addCircle, addPlatform } from './core.js';
import { canvasTex, signMesh, JP_FONT, lampPoints, bicycles, clockPole } from './townkit.js';
import { inFrame, wallFill, reveals, windowUnit, doorUnit, hipRoof, flatRoof, acUnit } from './building.js';

const TAU = Math.PI * 2;
const mul = (c, k) => c.map(v => v * k);
const circle = (r, n = 8) => Array.from({ length: n }, (_, i) => [Math.cos(i / n * TAU) * r, Math.sin(i / n * TAU) * r]);
const arc = (cx, cz, r, a0, a1, n = 8) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (a1 - a0) * i / n; return [cx + Math.cos(a) * r, cz + Math.sin(a) * r]; });

// a wall t thick along local X; face A looks along fr (a turn about Y from +Z) and lies t/2 out from the centre c = [x, z].
// holes in face-A coordinates (X along the face, Y up); bands [mat, colour, uv, y0, y1] per side; fill(h) runs in
// face A's frame for each hole (windows, doors)
function slab(B, c, fr, len, t, holes, bandsA, bandsB, rev, fill) {
  const s = Math.sin(fr), k = Math.cos(fr);
  inFrame(B, [c[0] + s * t / 2, 0, c[1] + k * t / 2], fr, () => {
    for (const [m, col, uv, y0, y1] of bandsA) wallFill(B, m, -len / 2, len / 2, y0, y1, holes, col, uv);
    for (const h of holes) { reveals(B, rev[0], { ...h, d: t }, rev[1], 1.5); if (fill) fill(h); }
  });
  if (bandsB) inFrame(B, [c[0] - s * t / 2, 0, c[1] - k * t / 2], fr + Math.PI, () => {
    const mh = holes.map(h => ({ ...h, x0: -h.x1, x1: -h.x0 }));
    for (const [m, col, uv, y0, y1] of bandsB) wallFill(B, m, -len / 2, len / 2, y0, y1, mh, col, uv);
  });
}
// projecting string course along a face (in the face frame), broken by the openings it would cross
function course(B, x0, x1, y, holes, color) {
  const cut = holes.filter(h => h.y0 < y + 0.1 && h.y1 > y - 0.02).map(h => [h.x0 - 0.03, h.x1 + 0.03]).sort((a, b) => a[0] - b[0]);
  let x = x0;
  for (const [a, b] of [...cut, [x1, x1]]) { if (a > x + 0.05) B.bbox('concrete', (x + a) / 2, y, 0.03, a - x, 0.08, 0.06, 0.012, { color }); x = Math.max(x, b); }
}
function clockMesh(r) {
  const face = canvasTex(256, 256, (g, W, H) => {
    g.fillStyle = '#fbfbf6'; g.beginPath(); g.arc(W / 2, H / 2, 124, 0, 7); g.fill();
    g.fillStyle = '#222'; for (let i = 0; i < 60; i++) { const a = i / 60 * TAU, l = i % 5 ? 8 : 22, w = i % 5 ? 3 : 8; g.save(); g.translate(W / 2, H / 2); g.rotate(a); g.fillRect(-w / 2, -112, w, l); g.restore(); }
    g.lineCap = 'round'; g.strokeStyle = '#222'; g.lineWidth = 11; g.beginPath(); g.moveTo(W / 2, H / 2); g.lineTo(W / 2 + 46, H / 2 + 34); g.stroke();
    g.lineWidth = 7; g.beginPath(); g.moveTo(W / 2, H / 2); g.lineTo(W / 2 - 22, H / 2 - 92); g.stroke();
    g.strokeStyle = '#c0392b'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(W / 2, H / 2 + 20); g.lineTo(W / 2 + 70, H / 2 - 70); g.stroke();
  });
  const grp = new THREE.Group();
  const d = new THREE.Mesh(new THREE.CircleGeometry(r, 48), new THREE.MeshStandardMaterial({ map: face, roughness: 0.25 }));
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r, r * 0.07, 10, 48), new THREE.MeshStandardMaterial({ color: 0x2c3136, roughness: 0.35, metalness: 0.8 }));
  const back = new THREE.Mesh(new THREE.CylinderGeometry(r, r, r * 0.16, 48).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3a4046, roughness: 0.5, metalness: 0.6 }));
  d.position.z = 0.002; back.position.z = -r * 0.08; rim.castShadow = back.castShadow = true;
  grp.add(back, d, rim);
  return grp;
}
const posters = [['さくらまつり', '#f7c6d4', '#b8325a'], ['桜川温泉', '#cfe6f2', '#1f5e86'], ['夏まつり', '#fde2a8', '#c24d1a'], ['ハイキング', '#d8efcf', '#2f6e3b']];
function poster(i, w, h) {
  const [t, bg, fg] = posters[i % posters.length];
  return signMesh(w, h, (g, W, H) => {
    g.fillStyle = bg; g.fillRect(0, 0, W, H); g.fillStyle = fg; g.fillRect(0, H * 0.78, W, H * 0.22);
    g.beginPath(); g.arc(W * 0.5, H * 0.42, W * 0.3, 0, 7); g.globalAlpha = 0.35; g.fill(); g.globalAlpha = 1;
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `bold ${W * 0.16}px ${JP_FONT}`; g.fillText(t, W / 2, H * 0.18);
    g.fillStyle = '#fff'; g.font = `bold ${W * 0.08}px ${JP_FONT}`; g.fillText('桜川町観光協会', W / 2, H * 0.89);
  }, 0.25, 256);
}
function place(mesh, B, p, turn = 0) { const w = B.P(p); mesh.position.set(w[0], w[1], w[2]); mesh.rotation.y = B.F.r + turn; scene.add(mesh); return mesh; }

// ---------------------------------------------------------------- the station building
// (x0, y0, z0): centre of the footprint at ground level; the entrance faces +Z (the forecourt), the platform door -Z
export function stationBuilding(B, x0, y0, z0, rng) {
  const W = 18, D = 8, T = 0.22, FL = 0.22, CEIL = 3.6, H = 4.6, PT = 1.35;
  const TILE = [0.7, 0.54, 0.46], ST = [0.97, 0.95, 0.89], IN = [0.95, 0.94, 0.91], FRM = [0.74, 0.76, 0.78], GREEN = [0.16, 0.38, 0.3];
  const OUT = [['tiles', TILE, 0.9, FL, 1.0], ['stucco', ST, 3, 1.0, H]], INB = [['plaster', IN, 3, FL, CEIL]], REV = ['plain', [0.93, 0.92, 0.89]];
  const col = (lx, lz, hx, hz, a = FL - 1, b = H) => addBox(x0 + lx, z0 + lz, hx, hz, 0, y0 + a, y0 + b);
  const iw = W / 2 - T, id = D / 2 - T;
  B.frame(x0, y0, z0, 0);
  // plinth (its front meets the forecourt paving), floor finish, ceiling
  B.bbox('concrete', 0, -0.3, 0.15, W + 0.4, FL + 0.3, D + 0.7, 0.03, { color: [0.72, 0.72, 0.7] });
  B.quad('pavement', [-iw, FL + 0.004, id], [iw, FL + 0.004, id], [iw, FL + 0.004, -id], [-iw, FL + 0.004, -id], { color: [0.86, 0.84, 0.8], uv: 1.2 });
  B.quad('plain', [-iw, CEIL, -id], [iw, CEIL, -id], [iw, CEIL, id], [-iw, CEIL, id], { color: [0.94, 0.94, 0.92] });
  addPlatform(x0, z0, W / 2, D / 2, 0, y0 + FL);

  // ---- outer walls: tiled dado, stucco above, a string course between; openings with reveals, frames and glass
  const glassLit = [1, 0.9, 0.74];
  const win = h => windowUnit(B, h, { rng, frame: FRM, type: h.fixed ? 'fixed' : 'slide', transom: !h.fixed, glass: glassLit, sillColor: [0.8, 0.8, 0.78], sillMat: 'concrete' });
  const doorway = (h, transom) => { // aluminium frame; the entrance has a transom with the door-operator housing and glass over it
    const w = h.x1 - h.x0, cx = (h.x0 + h.x1) / 2, zc = -0.07;
    for (const x of [h.x0 + 0.03, h.x1 - 0.03]) B.bbox('alu', x, h.y0, zc, 0.06, h.y1 - h.y0, 0.1, 0.006, { color: FRM });
    B.bbox('alu', cx, h.y1 - 0.06, zc, w, 0.06, 0.1, 0.006, { color: FRM });
    B.bbox('steel', cx, h.y0 - 0.012, -T / 2, w, 0.02, T + 0.02, 0.004, { color: [0.62, 0.62, 0.6] }); // threshold plate
    if (transom) { B.bbox('alu', cx, 2.52, zc, w, 0.22, 0.16, 0.01, { color: FRM });
      B.quad('glass', [h.x0 + 0.06, 2.74, zc], [h.x1 - 0.06, 2.74, zc], [h.x1 - 0.06, h.y1 - 0.06, zc], [h.x0 + 0.06, h.y1 - 0.06, zc]); }
  };
  const front = [{ x0: -2.6, x1: 2.6, y0: FL + 0.01, y1: 3.1, d: T, door: 1 }, { x0: -3.75, x1: -2.85, y0: FL + 0.14, y1: 3.1, d: T, fixed: 1 }, { x0: 2.85, x1: 3.75, y0: FL + 0.14, y1: 3.1, d: T, fixed: 1 },
    { x0: -8.2, x1: -5.0, y0: 1.1, y1: 2.7, d: T }, { x0: 5.0, x1: 8.2, y0: 1.1, y1: 2.7, d: T }];
  const back = [{ x0: -2.0, x1: 2.0, y0: PT + 0.01, y1: 3.5, d: T, door: 1 }, { x0: -7.8, x1: -5.4, y0: 1.2, y1: 2.5, d: T }, { x0: 5.4, x1: 7.8, y0: 1.2, y1: 2.5, d: T }];
  const east = [{ x0: -1.3, x1: 1.3, y0: 1.1, y1: 2.7, d: T }, { x0: 2.3, x1: 3.2, y0: FL + 0.01, y1: 2.35, d: T, staff: 1 }];
  const west = [{ x0: -2.9, x1: -0.7, y0: 1.1, y1: 2.7, d: T }, { x0: 0.7, x1: 2.9, y0: 1.1, y1: 2.7, d: T }];
  const fillOut = h => h.door ? doorway(h, h.y0 < 1) : h.staff ? doorUnit(B, h, { color: [0.5, 0.56, 0.6], frame: FRM, mat: 'metal', panel: true }) : win(h);
  for (const [holes, fr, c, len] of [[front, 0, [0, id + T / 2], W], [back, Math.PI, [0, -id - T / 2], W], [east, Math.PI / 2, [iw + T / 2, 0], D], [west, -Math.PI / 2, [-iw - T / 2, 0], D]]) {
    slab(B, c, fr, len, T, holes, OUT, INB, REV, fillOut);
    inFrame(B, [c[0] + Math.sin(fr) * T / 2, 0, c[1] + Math.cos(fr) * T / 2], fr, () => {
      const ext = len === W ? 0.06 : 0;
      course(B, -len / 2 - ext, len / 2 + ext, 1.0, holes, [0.8, 0.79, 0.76]);
      B.bbox('concrete', 0, 4.25, 0.02, len + 2 * ext, 0.12, 0.04, 0.01, { color: [0.85, 0.84, 0.8] }); // frieze band under the eaves
    });
  }
  col(-5.8, id + T / 2, 3.2, T / 2); col(5.8, id + T / 2, 3.2, T / 2);
  col(-5.5, -id - T / 2, 3.5, T / 2); col(5.5, -id - T / 2, 3.5, T / 2);
  col(iw + T / 2, 0, T / 2, D / 2); col(-iw - T / 2, 0, T / 2, D / 2);

  // ---- partitions: ticket office (east) with the ticket window and a staff door, waiting room (west) with glazing
  const PX = 4.0, PW = 0.12, INP = [['plaster', IN, 3, FL, CEIL]];
  const eastP = [{ x0: -0.2, x1: 1.2, y0: FL + 0.95, y1: FL + 1.95, d: PW, tw: 1 }, { x0: -3.4, x1: -2.5, y0: FL + 0.01, y1: FL + 2.1, d: PW, door: 1 }];
  slab(B, [PX, 0], -Math.PI / 2, 2 * id, PW, eastP, INP, INP, ['plain', IN], h => {
    if (h.door) { doorUnit(B, h, { color: [0.6, 0.64, 0.66], frame: FRM, mat: 'metal' }); return; }
    windowUnit(B, h, { rng, frame: FRM, type: 'fixed', glass: [1, 0.94, 0.82], sill: false });
    const cx = (h.x0 + h.x1) / 2;
    B.bbox('wood', cx, h.y0 - 0.05, 0.1, h.x1 - h.x0 + 0.4, 0.05, 0.32, 0.01, { color: [0.62, 0.46, 0.32] }); // counter
    place(signMesh(1.5, 0.3, (g, W2, H2) => { g.fillStyle = '#1f7a4d'; g.fillRect(0, 0, W2, H2); g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `bold ${H2 * 0.6}px ${JP_FONT}`; g.fillText('きっぷうりば', W2 / 2, H2 * 0.54); }, 1.0, 96), B, [cx, h.y1 + 0.3, 0.012]);
  });
  // ticket machines under the fare chart, on the office partition's hall side
  inFrame(B, [PX - PW / 2, 0, 0], -Math.PI / 2, () => {
    for (const lx of [1.85, 2.6, 3.35]) {
      B.bbox('plastic', lx, FL, 0.3, 0.7, 1.72, 0.6, 0.03, { color: [0.88, 0.89, 0.92] });
      B.bbox('plastic', lx, FL + 1.55, 0.3, 0.72, 0.17, 0.62, 0.02, { color: [0.12, 0.5, 0.34] });
      B.poly('glassLit', [[lx - 0.26, FL + 0.98, 0.64], [lx + 0.26, FL + 0.98, 0.64], [lx + 0.26, FL + 1.36, 0.6], [lx - 0.26, FL + 1.36, 0.6]], [0, 0.2, 1], { color: [0.55, 0.75, 1] });
      B.detail(1, () => { B.bbox('dark', lx - 0.18, FL + 0.72, 0.6, 0.12, 0.06, 0.02, 0.005); B.bbox('dark', lx + 0.12, FL + 0.72, 0.6, 0.22, 0.05, 0.02, 0.005); B.bbox('dark', lx, FL + 0.28, 0.6, 0.4, 0.1, 0.03, 0.01); });
      col(PX - PW / 2 - 0.3, lx, 0.3, 0.35, FL, FL + 1.72);
    }
    place(signMesh(2.3, 0.95, (g, W2, H2) => {
      g.fillStyle = '#f7f7f2'; g.fillRect(0, 0, W2, H2); g.strokeStyle = '#1f7a4d'; g.lineWidth = H2 * 0.03; g.beginPath(); g.moveTo(W2 * 0.06, H2 * 0.55); g.lineTo(W2 * 0.94, H2 * 0.55); g.stroke();
      const st = ['はなみ', '北原', '桜川', '東町', 'もりやま']; g.textAlign = 'center'; g.textBaseline = 'middle';
      st.forEach((s, i) => { const x = W2 * (0.1 + i * 0.2); g.fillStyle = i === 2 ? '#c0392b' : '#1f7a4d'; g.beginPath(); g.arc(x, H2 * 0.55, H2 * 0.05, 0, 7); g.fill(); g.fillStyle = '#222'; g.font = `bold ${H2 * 0.11}px ${JP_FONT}`; g.fillText(s, x, H2 * 0.36); g.font = `${H2 * 0.1}px Arial`; if (i !== 2) g.fillText(String(140 + Math.abs(i - 2) * 50), x, H2 * 0.74); });
      g.font = `bold ${H2 * 0.12}px ${JP_FONT}`; g.fillText('運賃表', W2 / 2, H2 * 0.12);
    }, 0.6, 192), B, [2.6, FL + 2.45, 0.015]);
  });
  col(PX, -3.59, PW / 2, 0.19, FL, CEIL); col(PX, 0.64, PW / 2, 3.14, FL, CEIL);
  const westP = [{ x0: -3.55, x1: -2.05, y0: FL + 0.8, y1: FL + 2.4, d: PW, g: 1 }, { x0: -1.85, x1: -0.65, y0: FL + 0.01, y1: FL + 2.1, d: PW, door: 1 }];
  slab(B, [-PX, 0], Math.PI / 2, 2 * id, PW, westP, INP, INP, ['plain', IN], h => {
    if (h.door) { const cx = (h.x0 + h.x1) / 2; for (const x of [h.x0 + 0.025, h.x1 - 0.025]) B.bbox('alu', x, h.y0, -0.06, 0.05, h.y1 - h.y0, 0.1, 0.006, { color: FRM }); B.bbox('alu', cx, h.y1 - 0.05, -0.06, h.x1 - h.x0, 0.05, 0.1, 0.006, { color: FRM });
      place(signMesh(0.9, 0.22, (g, W2, H2) => { g.fillStyle = '#fff'; g.fillRect(0, 0, W2, H2); g.fillStyle = '#333'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `bold ${H2 * 0.62}px ${JP_FONT}`; g.fillText('待合室', W2 / 2, H2 * 0.55); }, 0.5, 64), B, [cx, h.y1 + 0.25, 0.012]); return; }
    windowUnit(B, h, { rng, frame: FRM, type: 'fixed', glass: [0.92, 0.95, 1], sill: false });
  });
  col(-PX, -1.59, PW / 2, 2.19, FL, CEIL); col(-PX, 2.79, PW / 2, 0.99, FL, CEIL);
  // posters and a timetable on the waiting-room partition's hall side
  inFrame(B, [-PX + PW / 2, 0, 0], Math.PI / 2, () => {
    place(poster(0, 0.6, 0.85), B, [1.5, FL + 1.65, 0.012]); place(poster(1, 0.6, 0.85), B, [2.3, FL + 1.65, 0.012]);
    place(signMesh(1.0, 0.8, (g, W2, H2) => {
      g.fillStyle = '#fbfbf6'; g.fillRect(0, 0, W2, H2); g.fillStyle = '#1f7a4d'; g.fillRect(0, 0, W2, H2 * 0.16); g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `bold ${H2 * 0.11}px ${JP_FONT}`; g.fillText('時刻表', W2 / 2, H2 * 0.08);
      g.fillStyle = '#222'; g.font = `${H2 * 0.075}px Arial`; for (let r = 0; r < 9; r++) { g.fillText(String(6 + r * 2).padStart(2, '0'), W2 * 0.1, H2 * (0.24 + r * 0.085)); for (let k = 0; k < 4; k++) g.fillText(String((r * 17 + k * 13) % 60).padStart(2, '0'), W2 * (0.3 + k * 0.17), H2 * (0.24 + r * 0.085)); }
    }, 0.4, 160), B, [0.4, FL + 1.65, 0.012]);
  });

  // ---- automatic ticket gates across the hall, with glass fences to the partitions
  for (let i = 0; i < 5; i++) {
    const gx = -2.24 + i * 1.12;
    B.bbox('plastic', gx, FL, -0.9, 0.2, 1.0, 1.2, 0.03, { color: [0.9, 0.9, 0.92] });
    B.bbox('dark', gx, FL + 1.0, -0.9, 0.2, 0.015, 1.1, 0.005);
    B.detail(1, () => {
      B.bbox('plastic', gx, FL + 1.0, -0.42, 0.16, 0.035, 0.2, 0.01, { color: [0.25, 0.5, 0.9] });   // IC card reader
      B.bbox('glassLit', gx, FL + 0.86, -0.32, 0.12, 0.08, 0.012, 0.004, { color: [0.4, 0.9, 0.6] });
      for (const e of i === 0 ? [1] : i === 4 ? [-1] : [-1, 1]) B.box('plastic', gx + e * 0.24, FL + 0.5, -0.9, 0.28, 0.32, 0.03, { color: [0.95, 0.55, 0.15] }); // flaps
    });
    col(gx, -0.9, 0.1, 0.6, FL, FL + 1.0);
  }
  for (const [a, b] of [[-PX + PW / 2, -2.34], [2.34, PX - PW / 2]]) {
    B.bbox('alu', (a + b) / 2, FL + 0.95, -0.9, b - a, 0.05, 0.05, 0.01, { color: FRM });
    for (const x of [a + 0.03, b - 0.03]) B.bbox('alu', x, FL, -0.9, 0.05, 1.0, 0.05, 0.01, { color: FRM });
    B.quad('poly', [a, FL + 0.12, -0.9], [b, FL + 0.12, -0.9], [b, FL + 0.92, -0.9], [a, FL + 0.92, -0.9]);
    col((a + b) / 2, -0.9, (b - a) / 2, 0.05, FL, FL + 1.0);
  }
  // departures board over the gates
  B.bbox('dark', 0, CEIL - 0.95, -0.3, 2.8, 0.55, 0.14, 0.012);
  for (const e of [-1.1, 1.1]) B.box('steel', e, CEIL - 0.4, -0.3, 0.02, 0.4, 0.02, { color: [0.6, 0.6, 0.6] });
  place(signMesh(2.66, 0.46, (g, W2, H2) => {
    g.fillStyle = '#050505'; g.fillRect(0, 0, W2, H2); g.textBaseline = 'middle'; g.font = `bold ${H2 * 0.3}px ${JP_FONT}`;
    for (const [r, cl, tr, dst, tm, pl] of [[0, '#ff9a1f', '普通', 'はなみ', '10:24', '1番線'], [1, '#4fe07a', '普通', 'もりやま', '10:31', '2番線']]) {
      const y = H2 * (0.28 + r * 0.46); g.fillStyle = cl; g.textAlign = 'left'; g.fillText(tr, W2 * 0.03, y); g.fillText(dst, W2 * 0.22, y); g.textAlign = 'right'; g.fillText(tm, W2 * 0.76, y); g.fillText(pl, W2 * 0.97, y);
    }
  }, 1.6, 128), B, [0, CEIL - 0.675, -0.3 + 0.072]);

  // ---- stairs behind the gates up to the platform door, with handrails; a landing outside on to the platform
  const nSt = 7, run = (id - 2.1) / nSt, stepTop = k => FL + (k + 1) * (PT - FL) / nSt;
  for (let k = 0; k < nSt; k++) {
    const za = -2.1 - k * run, zb = za - run, top = stepTop(k);
    B.box('concrete', 0, FL, (za + zb) / 2, 4.0, top - FL, run, { color: [0.8, 0.79, 0.76], skip: 'ny nz' });
    B.detail(2, () => B.box('plain', 0, top, za - 0.03, 3.96, 0.004, 0.05, { color: [0.9, 0.72, 0.12] }));
    addPlatform(x0, z0 + (za + zb) / 2, 2.0, run / 2, 0, y0 + top);
  }
  for (const e of [-1, 1]) {
    const a = [e * 2.08, FL + 0.9, -1.85], b = [e * 2.08, PT + 0.9, -id + 0.08];
    B.sweep('alu', circle(0.022, 8), [a, b], { closed: true, color: FRM });
    for (const t of [0, 0.5, 1]) { const zz = lerp(a[2], b[2], t), k = Math.min(nSt - 1, Math.max(0, Math.floor((-2.1 - zz) / run))), yb = zz > -2.1 ? FL : stepTop(k);
      B.box('alu', e * 2.08, yb, zz, 0.035, lerp(a[1], b[1], t) - yb, 0.035, { color: FRM }); }
    col(e * 2.08, -2.94, 0.04, 0.84, FL, PT + 1);
  }
  B.bbox('concrete', 0, -0.2, -id - 0.71, 4.4, PT + 0.2, 1.42, 0.02, { color: [0.74, 0.74, 0.72], skip: 'ny' });
  B.quad('pavement', [-2.19, PT + 0.003, -id], [2.19, PT + 0.003, -id], [2.19, PT + 0.003, -id - 1.41], [-2.19, PT + 0.003, -id - 1.41], { color: [0.84, 0.83, 0.8], uv: 1.2 });
  addPlatform(x0, z0 - id - 0.71, 2.2, 0.71, 0, y0 + PT);
  for (const e of [-1, 1]) {
    B.box('alu', e * 2.16, PT + 1.05, -id - 0.62, 0.05, 0.05, 1.24, { color: FRM });
    for (const zz of [-id - 0.2, -id - 1.2]) B.box('alu', e * 2.16, PT, zz, 0.045, 1.05, 0.045, { color: FRM });
    col(e * 2.16, -id - 0.7, 0.04, 0.7, PT - 1, PT + 1.1);
  }

  // ---- rooms: benches in the waiting room, a desk and shelving in the office; ceiling lights
  for (const [bx, bz, bw, bd] of [[-8.5, 0.2, 0.45, 4.2], [-6.3, -3.5, 2.8, 0.45]]) {
    B.bbox('wood', bx, FL + 0.42, bz, bw, 0.05, bd, 0.01, { color: [0.72, 0.52, 0.34] });
    for (const s of [-1, 1]) B.box('steel', bx + (bw > bd ? s * (bw / 2 - 0.15) : 0), FL, bz + (bw > bd ? 0 : s * (bd / 2 - 0.15)), bw > bd ? 0.05 : bw - 0.06, 0.42, bw > bd ? bd - 0.06 : 0.05, { color: [0.35, 0.36, 0.38] });
    col(bx, bz, bw / 2, bd / 2, FL, FL + 0.5);
  }
  B.bbox('plain', 6.4, FL, 0.2, 1.6, 0.74, 0.8, 0.01, { color: [0.72, 0.74, 0.76] });
  B.bbox('plain', 8.5, FL, 1.6, 0.4, 1.9, 1.6, 0.01, { color: [0.6, 0.64, 0.66] });
  col(6.4, 0.2, 0.8, 0.4, FL, FL + 0.8);
  for (const [lx, lz] of [[0, 2.4], [0, 0.6], [0, -2.9], [-6.4, 0.4], [6.4, 0.4], [6.4, -2.4]]) {
    B.box('lamp', lx, CEIL - 0.03, lz, 1.2, 0.03, 0.26);
    lampPoints.push({ p: B.P([lx, CEIL - 0.3, lz]), s: 0.45 });
  }

  // ---- tiled hip roof with gutters and downpipes
  hipRoof(B, { w: W, d: D, y: H, pitch: 0.45, over: 0.8, mat: 'roofTile', color: [0.36, 0.39, 0.46], ground: FL });

  // ---- entrance canopy: a cantilevered slab with tie rods to the wall, downlights, fascia and the name board on top
  const cz0 = D / 2, cz1 = D / 2 + 2.5, cw = 8.2, cy = 3.25;
  B.bbox('concrete', 0, cy, (cz0 + cz1) / 2, cw, 0.22, cz1 - cz0, 0.02, { color: [0.9, 0.9, 0.88] });
  B.bbox('metal', 0, cy - 0.08, cz1 + 0.03, cw + 0.08, 0.38, 0.06, 0.01, { color: GREEN });
  for (const e of [-1, 1]) {
    B.bbox('metal', e * (cw / 2 + 0.01), cy - 0.08, (cz0 + cz1) / 2 + 0.015, 0.06, 0.38, cz1 - cz0 + 0.03, 0.01, { color: GREEN });
    B.sweep('steel', circle(0.022, 8), [[e * 3.4, cy + 0.2, cz1 - 0.25], [e * 3.4, 4.2, cz0 + 0.03]], { closed: true, color: [0.5, 0.52, 0.54] });
  }
  for (const lx of [-2.8, 0, 2.8]) for (const lz of [cz0 + 0.8, cz0 + 1.8]) B.box('lamp', lx, cy - 0.012, lz, 0.22, 0.012, 0.22);
  lampPoints.push({ p: B.P([0, cy - 0.4, cz0 + 1.3]), s: 0.9 });
  B.bbox('metal', 0, cy + 0.22, cz1 - 0.26, 6.5, 1.0, 0.12, 0.02, { color: [0.24, 0.26, 0.28] });
  place(signMesh(6.3, 0.86, (g, W2, H2) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, W2, H2); g.fillStyle = '#1f7a4d'; g.fillRect(0, H2 * 0.82, W2, H2 * 0.18);
    g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `bold ${H2 * 0.54}px ${JP_FONT}`; g.fillText('桜川駅', W2 * 0.36, H2 * 0.42);
    g.font = `bold ${H2 * 0.18}px Arial`; g.fillText('SAKURAGAWA Sta.', W2 * 0.78, H2 * 0.42);
  }, 1.1), B, [0, cy + 0.72, cz1 - 0.195]);
  // wall clock over the waiting-room window, posters beside the entrance
  place(clockMesh(0.34), B, [-6.6, 3.62, D / 2 + 0.05]);
  place(poster(2, 0.62, 0.88), B, [-4.38, 1.85, D / 2 + 0.012]); place(poster(3, 0.62, 0.88), B, [4.38, 1.85, D / 2 + 0.012]);
  // service: AC units on the office end, a notice board
  inFrame(B, [W / 2, 0, 0], Math.PI / 2, () => { acUnit(B, -2.95, FL, rng); acUnit(B, -2.05, FL, rng); });
  B.frame(0, 0, 0, 0);
  return { W, D, FL, PT };
}

// ---------------------------------------------------------------- police box (交番) on the square
// local frame: +Z is the front (door, red lamp, sign under a canopy)
function koban(B, x, y, z, r, rng) {
  const W = 4.2, D = 3.6, H = 3.1, P = 0.28, T = 0.18, FL = 0.12, FR = [0.28, 0.29, 0.32], TL = [0.92, 0.92, 0.9], IN = [0.93, 0.93, 0.9];
  B.frame(x, y, z, r);
  B.bbox('concrete', 0, -0.2, 0.15, W + 0.3, FL + 0.2, D + 0.6, 0.02, { color: [0.7, 0.7, 0.68] });
  B.quad('pavement', [-W / 2 + T, FL + 0.004, D / 2 - T], [W / 2 - T, FL + 0.004, D / 2 - T], [W / 2 - T, FL + 0.004, -D / 2 + T], [-W / 2 + T, FL + 0.004, -D / 2 + T], { color: [0.8, 0.8, 0.78] });
  B.quad('plain', [-W / 2 + T, H - 0.3, -D / 2 + T], [W / 2 - T, H - 0.3, -D / 2 + T], [W / 2 - T, H - 0.3, D / 2 - T], [-W / 2 + T, H - 0.3, D / 2 - T], { color: [0.95, 0.95, 0.93] });
  const OUT = [['tiles', TL, 0.8, FL, 0.9], ['stucco', [0.97, 0.97, 0.95], 3, 0.9, H + P]], INB = [['plaster', IN, 3, FL, H - 0.3]], REV = ['plain', [0.9, 0.9, 0.88]];
  const fill = h => h.door ? doorUnit(B, h, { color: [0.78, 0.8, 0.82], frame: FR, mat: 'alu', slit: true }) : windowUnit(B, h, { rng, frame: FR, type: h.x1 - h.x0 > 1.2 ? 'slide' : 'fixed', glass: [1, 0.94, 0.8] });
  const faces = [[[{ x0: -1.75, x1: -0.25, y0: 0.9, y1: 2.35, d: T }, { x0: 0.3, x1: 1.35, y0: FL + 0.01, y1: 2.3, d: T, door: 1 }], 0, [0, D / 2 - T / 2], W],
    [[], Math.PI, [0, -D / 2 + T / 2], W], [[{ x0: -0.6, x1: 0.6, y0: 1.0, y1: 2.2, d: T }], Math.PI / 2, [W / 2 - T / 2, 0], D], [[{ x0: -0.5, x1: 0.5, y0: 1.2, y1: 2.0, d: T }], -Math.PI / 2, [-W / 2 + T / 2, 0], D]];
  for (const [holes, fr, c, len] of faces) slab(B, c, fr, len, T, holes, OUT, INB, REV, fill);
  flatRoof(B, { w: W, d: D, y: H, para: P, color: [0.97, 0.97, 0.95] });
  // canopy over the front with the sign on its fascia, the red lamp above the door
  B.bbox('concrete', 0, 2.62, D / 2 + 0.6, W + 0.3, 0.16, 1.2, 0.02, { color: [0.9, 0.9, 0.88] });
  B.bbox('metal', 0, 2.56, D / 2 + 1.2, W + 0.34, 0.3, 0.05, 0.01, { color: [0.12, 0.2, 0.42] });
  place(signMesh(2.4, 0.26, (g, W2, H2) => { g.fillStyle = '#1b2f6b'; g.fillRect(0, 0, W2, H2); g.fillStyle = '#f5c518'; g.beginPath(); g.arc(W2 * 0.12, H2 / 2, H2 * 0.32, 0, 7); g.fill(); g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `bold ${H2 * 0.62}px ${JP_FONT}`; g.fillText('桜川駅前交番', W2 * 0.5, H2 * 0.55); g.font = `bold ${H2 * 0.4}px Arial`; g.fillText('KOBAN', W2 * 0.86, H2 * 0.55); }, 1.2, 64), B, [0, 2.71, D / 2 + 1.23]);
  B.cyl('steel', 0.82, 2.78, D / 2 + 0.2, 0.03, 0.03, 0.2, 8, { color: [0.3, 0.3, 0.3] });
  B.cyl('lamp', 0.82, 2.98, D / 2 + 0.2, 0.13, 0.15, 0.24, 16, { color: [1, 0.08, 0.04], cap: true });
  lampPoints.push({ p: B.P([0.82, 3.1, D / 2 + 0.3]), s: 0.25 });
  // inside: a desk and chairs, a notice board; outside: a stand board and a white police bicycle
  B.bbox('plain', -0.9, FL, -0.6, 1.4, 0.72, 0.7, 0.01, { color: [0.62, 0.64, 0.66] });
  place(signMesh(0.8, 0.55, (g, W2, H2) => { g.fillStyle = '#e8eef5'; g.fillRect(0, 0, W2, H2); g.fillStyle = '#1b2f6b'; g.fillRect(0, 0, W2, H2 * 0.22); g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `bold ${H2 * 0.14}px ${JP_FONT}`; g.fillText('本日の事件・事故', W2 / 2, H2 * 0.11); g.fillStyle = '#c0392b'; g.font = `bold ${H2 * 0.3}px ${JP_FONT}`; g.fillText('0 件', W2 / 2, H2 * 0.6); }, 0.3, 128), B, [-1.9, 1.05, D / 2 + 0.35]);
  B.box('metal', -1.9, 0, D / 2 + 0.33, 0.04, 0.8, 0.04, { color: [0.3, 0.3, 0.3] });
  const p = B.P([0, 0, 0]); addBox(p[0], p[2], W / 2, D / 2, r, y - 1, y + H + P);
  B.frame(0, 0, 0, 0);
}

// ---------------------------------------------------------------- a route bus (non-step, 10.5 m) parked at a berth
// local frame: +Z forward, +X the kerb (door) side, y = road surface
function disc(B, mat, cx, cy, cz, r, n, sx, color, half = false) {
  const m = half ? n / 2 : n;
  for (let i = 0; i < m; i++) { const a0 = i / n * TAU, a1 = (i + 1) / n * TAU;
    B.poly(mat, [[cx, cy, cz], [cx, cy + Math.sin(a0) * r, cz + Math.cos(a0) * r], [cx, cy + Math.sin(a1) * r, cz + Math.cos(a1) * r]], [sx, 0, 0], { color }); }
}
export function routeBus(B, x, y, z, r, dest = '桜川循環 学校前') {
  const L = 10.5, W = 2.49, WH = [0.95, 0.95, 0.93], PK = [0.86, 0.32, 0.5], GR = [0.16, 0.5, 0.36], hl = L / 2, hw = W / 2;
  B.frame(x, y, z, r);
  // body: skirt, glazing band with pillars, upper band, roof and its air-conditioning pod
  B.bbox('plastic', 0, 0.3, 0, W, 0.8, L, 0.07, { color: WH });
  B.box('glass', 0, 1.08, 0, W - 0.05, 1.3, L - 0.12);
  B.bbox('plastic', 0, 2.36, 0, W, 0.64, L, 0.1, { color: WH });
  B.bbox('plastic', 0, 2.98, -0.8, 1.9, 0.26, 3.4, 0.08, { color: [0.9, 0.9, 0.88] });
  for (const s of [-1, 1]) {
    for (let zz = -hl + 0.5; zz < hl - 0.4; zz += 1.32) if (!(s > 0 && (zz > hl - 2.1 || Math.abs(zz) < 0.75))) B.box('plastic', s * (hw - 0.02), 1.08, zz, 0.05, 1.3, 0.11, { color: WH });
    B.box('plastic', s * (hw + 0.004), 0.72, 0, 0.012, 0.13, L - 0.3, { color: PK });   // livery stripes
    B.box('plastic', s * (hw + 0.004), 0.58, 0, 0.012, 0.07, L - 0.3, { color: GR });
    B.box('plastic', s * (hw + 0.004), 2.42, 0, 0.012, 0.06, L - 0.3, { color: PK });
    for (const az of [hl - 2.35, -hl + 2.6]) { // wheel arches, tyres and hubs
      disc(B, 'dark', s * (hw + 0.006), 0.48, az, 0.66, 20, s, null, true);
      disc(B, 'dark', s * (hw + 0.01), 0.48, az, 0.47, 20, s, [0.5, 0.5, 0.5]);
      disc(B, 'steel', s * (hw + 0.014), 0.48, az, 0.26, 16, s, [0.8, 0.8, 0.8]);
      B.sweep('dark', circle(0.47, 16), [[s * (hw - 0.3), 0.48, az], [s * (hw - 0.02), 0.48, az]], { closed: true, caps: true });
    }
  }
  // doors on the kerb side (front and centre): glazed leaves in dark frames, down to the low floor
  for (const [za, zb] of [[hl - 2.0, hl - 0.95], [-0.62, 0.62]]) {
    const zc = (za + zb) / 2;
    B.box('dark', hw + 0.002, 0.32, zc, 0.02, 2.05, zb - za + 0.08);
    B.quad('glass', [hw + 0.014, 0.4, zb - 0.04], [hw + 0.014, 0.4, za + 0.04], [hw + 0.014, 2.3, za + 0.04], [hw + 0.014, 2.3, zb - 0.04]);
    B.box('dark', hw + 0.016, 0.4, zc, 0.012, 1.9, 0.03);
  }
  // front: windscreen (the glazing band's face), destination display, lamps, bumper, mirrors on arms; rear lamps
  B.bbox('dark', 0, 2.52, hl + 0.005, 1.7, 0.36, 0.04, 0.01);
  place(signMesh(1.6, 0.28, (g, W2, H2) => { g.fillStyle = '#050505'; g.fillRect(0, 0, W2, H2); g.fillStyle = '#ffa52a'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `bold ${H2 * 0.62}px ${JP_FONT}`; g.fillText(dest, W2 / 2, H2 * 0.55); }, 1.6, 64), B, [0, 2.7, hl + 0.03]);
  for (const s of [-1, 1]) { B.bbox('lamp', s * (hw - 0.3), 0.55, hl + 0.005, 0.34, 0.14, 0.03, 0.01); B.bbox('plastic', s * (hw - 0.22), 0.55, -hl - 0.005, 0.2, 0.3, 0.03, 0.01, { color: [0.8, 0.08, 0.06] });
    B.sweep('dark', circle(0.025, 6), [[s * (hw - 0.1), 2.5, hl - 0.1], [s * (hw + 0.12), 2.62, hl + 0.35], [s * (hw + 0.14), 2.2, hl + 0.55]], { closed: true });
    B.bbox('dark', s * (hw + 0.14), 1.75, hl + 0.55, 0.08, 0.45, 0.22, 0.02); }
  B.bbox('dark', 0, 0.3, hl, W - 0.1, 0.24, 0.12, 0.03);
  B.bbox('plastic', 0, 0.36, hl + 0.065, 0.34, 0.17, 0.01, 0.005, { color: [0.95, 0.95, 0.9] });
  B.bbox('dark', 0, 0.3, -hl, W - 0.1, 0.3, 0.1, 0.03);
  const p = B.P([0, 0, 0]); addBox(p[0], p[2], hw, hl, r, y - 1, y + 3.1);
  B.frame(0, 0, 0, 0);
}

// ---------------------------------------------------------------- forecourt
function kerbProfile(h) { return [[0, -0.08], [0, h - 0.02], [-0.02, h], [-0.2, h]]; }
function fan(B, mat, c, ring, y, color, uv) { // triangles from c to each ring edge, world-aligned UVs
  for (let i = 0; i + 1 < ring.length; i++) {
    const p = [c, ring[i], ring[i + 1]];
    B.poly(mat, p.map(q => [q[0], y, q[1]]), [0, 1, 0], { color, uvs: p.map(q => [q[0] / uv, q[1] / uv]) });
  }
}
function plazaLamp(B, x, y, z, r, h = 6.2) {
  B.frame(x, y, z, r);
  B.bbox('concrete', 0, -0.05, 0, 0.36, 0.12, 0.36, 0.02, { color: [0.7, 0.7, 0.68] });
  B.cyl('steel', 0, 0.05, 0, 0.085, 0.06, h, 16, { color: [0.44, 0.47, 0.5] });
  B.sweep('steel', circle(0.038, 8), [[0, h - 0.25, 0], [0, h - 0.02, 0.18], [0, h + 0.06, 0.6], [0, h + 0.08, 0.9]], { closed: true, color: [0.44, 0.47, 0.5] });
  B.bbox('metal', 0, h - 0.02, 1.05, 0.3, 0.1, 0.6, 0.03, { color: [0.4, 0.43, 0.46] });
  B.box('lamp', 0, h - 0.035, 1.05, 0.22, 0.02, 0.46);
  lampPoints.push({ p: B.P([0, h - 0.4, 1.05]), s: 1 });
  const p = B.P([0, 0, 0]); addCircle(p[0], p[2], 0.12);
  B.frame(0, 0, 0, 0);
}
function plazaBench(B, x, y, z, r) {
  B.frame(x, y, z, r);
  for (const sx of [-0.75, 0.75]) B.bbox('steel', sx, 0, 0, 0.06, 0.42, 0.44, 0.01, { color: [0.3, 0.32, 0.34] });
  for (let k = 0; k < 5; k++) B.bbox('wood', 0, 0.42, -0.2 + k * 0.1, 1.9, 0.045, 0.08, 0.01, { color: [0.74, 0.54, 0.36] });
  const p = B.P([0, 0, 0]); addBox(p[0], p[2], 0.95, 0.25, r, y - 1, y + 0.5);
  B.frame(0, 0, 0, 0);
}
function tactileLine(B, a, b, y) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]), d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], l = [-d[1] * 0.15, d[0] * 0.15];
  B.poly('tactileL', [[a[0] - l[0], y, a[1] - l[1]], [b[0] - l[0], y, b[1] - l[1]], [b[0] + l[0], y, b[1] + l[1]], [a[0] + l[0], y, a[1] + l[1]]], [0, 1, 0], { uvs: [[0, 0], [L / 0.3, 0], [L / 0.3, 1], [0, 1]] });
}
function tactileDots(B, x0, z0, x1, z1, y) {
  B.poly('tactileD', [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], [0, 1, 0], { uvs: [[0, 0], [(x1 - x0) / 0.3, 0], [(x1 - x0) / 0.3, (z1 - z0) / 0.3], [0, (z1 - z0) / 0.3]] });
}
// painted arrow on a flat surface at y: shaft from c backwards, head forwards along d
function arrow(RN, B, c, d, y, color) {
  const l = [-d[1], d[0]], P = (a, b) => [c[0] + d[0] * a + l[0] * b, y + 0.008, c[1] + d[1] * a + l[1] * b];
  RN.decal(B, 'paint', [c[0] - d[0] * 0.7, c[1] - d[1] * 0.7], d, 1.6, 0.075, { color, y: () => y, lift: 0.008, road: false, cell: 0.8 });
  B.poly('paint', [P(0.9, -0.33), P(0.9, 0.33), P(2.0, 0)], [0, 1, 0], { color });
}

// the forecourt between the station (front at z = -64) and the main road's south footway (z = -31):
// a paved square west of x = 4.8, and the loop (asphalt x 5..29) round the island (x 11.5..22.5, z -54..-31)
export function stationForecourt(B, { Y0, RN, sOf, rng, parked }) {
  const py = Y0 + 0.22, ry = Y0 + 0.085, PAVE = [0.86, 0.85, 0.82], KERB = [0.8, 0.8, 0.77], ISL = [0.88, 0.8, 0.72], WHITE = [0.93, 0.93, 0.9], YEL = [0.95, 0.78, 0.15];
  B.frame(0, 0, 0, 0);
  B.bbox('pavement', -14.6, Y0 - 0.2, -47.25, 38.8, 0.42, 32.5, 0.02, { color: PAVE, uv: 1.2, skip: 'ny' });     // square
  B.bbox('pavement', 18.15, Y0 - 0.2, -62.35, 26.7, 0.42, 2.3, 0.02, { color: PAVE, uv: 1.2, skip: 'ny' });      // strip along the station side
  B.bbox('pavement', 30.35, Y0 - 0.2, -46.1, 2.3, 0.42, 30.2, 0.02, { color: PAVE, uv: 1.2, skip: 'ny' });       // east strip
  B.box('asphalt', 17, Y0 - 0.2, -46, 24, ry - Y0 + 0.2, 30, { uv: 4, skip: 'ny pz' });
  // dark granite bands laid through the square's paving in a 6 m grid
  const band = (c, d, hl) => RN.decal(B, 'pavement', c, d, hl, 0.15, { color: [0.58, 0.57, 0.55], y: () => py, lift: 0.003, road: false, cell: 1.5 });
  for (let x = -28; x < 4; x += 6) band([x, -47.25], [0, 1], 16.1);
  for (let z = -57; z < -32; z += 6) band([-14.6, z], [1, 0], 19.25);
  // kerbs: the loop's outer edge and the island, swept along rounded outlines (asphalt to the right of travel)
  const kp = kerbProfile(py - ry), up = pts => pts.map(p => [p[0], ry, p[1]]);
  const outer = [[5, -31], [5, -59.5], ...arc(6.5, -59.5, 1.5, Math.PI, 1.5 * Math.PI).slice(1), [27.5, -61], ...arc(27.5, -59.5, 1.5, 1.5 * Math.PI, TAU).slice(1), [29, -31]];
  const island = [[22.5, -31], [22.5, -51.5], ...arc(20, -51.5, 2.5, 0, -Math.PI / 2, 10).slice(1), [14, -54], ...arc(14, -51.5, 2.5, -Math.PI / 2, -Math.PI, 10).slice(1), [11.5, -31]];
  B.sweep('concrete', kp, up(outer), { color: KERB, uv: 1 });
  B.sweep('concrete', kp, up(island), { color: KERB, uv: 1 });
  fan(B, 'pavement', [4.8, -61.2], arc(6.5, -59.5, 1.7, Math.PI, 1.5 * Math.PI), py, PAVE, 1.2);
  fan(B, 'pavement', [29.2, -61.2], arc(27.5, -59.5, 1.7, 1.5 * Math.PI, TAU), py, PAVE, 1.2);
  const inner = [[22.3, -31], [22.3, -51.5], ...arc(20, -51.5, 2.3, 0, -Math.PI / 2, 10).slice(1), [14, -53.8], ...arc(14, -51.5, 2.3, -Math.PI / 2, -Math.PI, 10).slice(1), [11.7, -31], [22.3, -31]];
  fan(B, 'pavement', [17, -42], inner, py, ISL, 1.2);
  for (const [x0, x1] of [[6.2, 10.3], [23.7, 27.8]]) RN.cuts.push({ id: 'A', side: -1, s0: sOf('A', x0, -25), s1: sOf('A', x1, -25) });
  // walkable surfaces
  addPlatform(17, -46, 12, 15, 0, ry);
  addPlatform(-14.6, -47.25, 19.4, 16.25, 0, py); addPlatform(18.15, -62.35, 13.35, 1.15, 0, py); addPlatform(30.35, -46.1, 1.15, 15.1, 0, py);
  addPlatform(17, -42.4, 5.5, 11.4, 0, py);

  // raised crossings (level with the footways) with zebra bars, from the square to the island and on to the east strip
  for (const [xa, xb] of [[5, 11.5], [22.5, 29]]) {
    const z0 = -50, z1 = -47, zc = (z0 + z1) / 2, xm = (xa + xb) / 2, w = xb - xa;
    B.box('asphalt', xm, ry - 0.01, zc, w, py - ry + 0.01, z1 - z0, { uv: 4, skip: 'ny px nx pz nz' });
    for (const [zz, s] of [[z0, -1], [z1, 1]]) B.poly('asphalt', [[xa, ry, zz + s * 1.1], [xb, ry, zz + s * 1.1], [xb, py, zz], [xa, py, zz]], [0, 1, 0], { uv: 4 });
    for (let x = xa + 0.55; x < xb - 0.3; x += 0.9) RN.decal(B, 'paint', [x, zc], [0, 1], 1.5, 0.225, { color: WHITE, y: () => py, lift: 0.006, road: false, cell: 0.75 });
    for (const zz of [z0 - 0.55, z1 + 0.55]) RN.decal(B, 'paint', [xm, zz], [1, 0], w / 2 - 0.1, 0.12, { color: WHITE, y: (x, z) => lerp(ry, py, Math.max(0, 1 - Math.abs(z - zc - Math.sign(zz - zc) * 1.5) / 1.1)) + 0.002, lift: 0.004, road: false, cell: 0.6 }); // ramp edge lines
  }
  // tactile paving: from the station entrance across the square to the crossing, then along the bus berths
  const ty = py + 0.005;
  tactileLine(B, [-2, -63.3], [-2, -48.65], ty); tactileDots(B, -2.15, -48.65, -1.85, -48.35, ty); tactileLine(B, [-1.85, -48.5], [4.1, -48.5], ty);
  tactileDots(B, 4.1, -50, 4.7, -47, ty); tactileDots(B, 11.8, -50, 12.4, -47, ty);
  tactileLine(B, [12.4, -48.5], [12.95, -48.5], ty); tactileDots(B, 12.95, -48.65, 13.25, -48.35, ty); tactileLine(B, [13.1, -48.35], [13.1, -31.6], ty); tactileDots(B, 12.95, -31.6, 13.25, -31.3, ty);
  tactileDots(B, 21.6, -50, 22.2, -47, ty); tactileDots(B, 29.3, -50, 29.9, -47, ty);
  // markings: direction arrows, stop line at the exit, bus berth boxes, taxi bays
  arrow(RN, B, [25.75, -37], [0, -1], ry, WHITE); arrow(RN, B, [17, -57.5], [-1, 0], ry, WHITE); arrow(RN, B, [8.25, -54], [0, 1], ry, WHITE);
  RN.decal(B, 'paint', [8.25, -32.2], [1, 0], 3.05, 0.225, { color: WHITE, y: () => ry, lift: 0.006, road: false, cell: 0.8 });
  { // bus berths: 1 along the island's west kerb (buses head north), 2 along its south kerb (buses head west)
    const yl = (c, d, hl) => RN.decal(B, 'paint', c, d, hl, 0.075, { color: YEL, y: () => ry, lift: 0.006, road: false, cell: 0.8 });
    for (const x of [8.7, 11.2]) yl([x, -41.3], [0, 1], 5.1); for (const z of [-46.4, -36.2]) yl([9.95, z], [1, 0], 1.25);
    for (const z of [-54.3, -56.8]) yl([17, z], [1, 0], 5.4); for (const x of [11.6, 22.4]) yl([x, -55.55], [0, 1], 1.25);
  }
  routeBus(B, 9.9, ry, -41.3, 0);
  RN.decal(B, 'paint', [25.4, -41.6], [0, 1], 8.6, 0.075, { color: WHITE, y: () => ry, lift: 0.006, road: false, cell: 0.8 });
  for (let z = -50.2; z <= -33; z += 5.6) RN.decal(B, 'paint', [24.05, z], [1, 0], 1.35, 0.075, { color: WHITE, y: () => ry, lift: 0.006, road: false, cell: 0.8 });
  for (let i = 0; i < 3; i++) parked.push({ sp: { p: [24.1, ry, -47.4 + i * 5.6], r: 0, y: ry }, spec: { type: 'taxi', color: [0.08, 0.1, 0.2] } });

  // ---- the island: bus berth canopy with benches and windscreens, berth signs, taxi stand, planted bed, monument
  const cnY = py + 2.9, CN = [0.86, 0.87, 0.89], CNF = [0.24, 0.36, 0.5];
  B.frame(0, 0, 0, 0);
  for (const z of [-45.8, -41.4, -37, -32.6]) { B.cyl('steel', 14.1, py, z, 0.09, 0.09, 2.9, 16, { color: [0.5, 0.53, 0.56] }); B.bbox('concrete', 14.1, py - 0.02, z, 0.36, 0.08, 0.36, 0.02, { color: [0.72, 0.72, 0.7] }); addCircle(14.1, z, 0.12); }
  B.bbox('metal', 14.1, cnY - 0.3, -39.2, 0.2, 0.3, 14.6, 0.02, { color: CNF });                        // spine beam
  B.bbox('metal', 13.15, cnY, -39.2, 3.3, 0.12, 14.8, 0.02, { color: CN });                             // roof panel
  B.bbox('metal', 11.52, cnY - 0.12, -39.2, 0.06, 0.28, 14.84, 0.01, { color: CNF });                   // fascia
  B.bbox('metal', 14.78, cnY - 0.12, -39.2, 0.06, 0.28, 14.84, 0.01, { color: CNF });
  for (let z = -45.5; z < -32; z += 2.2) B.box('lamp', 12.6, cnY - 0.01, z, 0.9, 0.012, 0.16);
  for (const z of [-44, -38.5, -34]) lampPoints.push({ p: [12.8, cnY - 0.4, z], s: 0.55 });
  for (const [bx, bz, n, fr] of [[11.95, -45.8, 1, 0], [19.9, -53.35, 2, -Math.PI / 2]]) {
    B.frame(bx, py, bz, fr);
    B.cyl('alu', 0, 0, 0, 0.04, 0.04, 2.5, 10, { color: [0.85, 0.86, 0.88] }); B.cyl('plain', 0, 2.5, 0, 0.05, 0.02, 0.05, 10, { color: [0.3, 0.3, 0.32], cap: true });
    const sg = signMesh(0.5, 0.72, (g, W2, H2) => { g.fillStyle = '#fff'; g.fillRect(0, 0, W2, H2); g.fillStyle = '#1d5fa8'; g.fillRect(0, 0, W2, H2 * 0.62);
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `bold ${H2 * 0.4}px Arial`; g.fillText(String(n), W2 / 2, H2 * 0.3); g.font = `bold ${H2 * 0.1}px ${JP_FONT}`; g.fillText('のりば', W2 / 2, H2 * 0.54);
      g.fillStyle = '#222'; g.font = `bold ${H2 * 0.085}px ${JP_FONT}`; g.fillText(n === 1 ? '桜川循環・学校前' : 'はなみ温泉・もりやま', W2 / 2, H2 * 0.73); g.font = `${H2 * 0.07}px ${JP_FONT}`; g.fillText('桜川交通', W2 / 2, H2 * 0.88); }, 0.6, 192);
    for (const t of [Math.PI / 2, -Math.PI / 2]) place(sg.clone(), B, [t > 0 ? 0.05 : -0.05, 2.05, 0], t);
    B.bbox('plain', 0, 2.05 - 0.37, 0, 0.06, 0.74, 0.52, 0.01, { color: [0.9, 0.9, 0.9] });
    B.bbox('plain', 0, 0.9, 0.08, 0.04, 0.55, 0.4, 0.01, { color: [0.96, 0.96, 0.94] });  // timetable
    addCircle(bx, bz, 0.1);
  }
  plazaBench(B, 16.6, py, -52.7, Math.PI);
  B.frame(0, 0, 0, 0);
  for (const bz of [-43.2, -36.4]) {
    plazaBench(B, 13.55, py, bz, -Math.PI / 2);
    B.frame(0, 0, 0, 0);
    for (const e of [-1.15, 1.15]) B.bbox('alu', 14.45, py, bz + e, 0.05, 2.0, 0.05, 0.01, { color: [0.7, 0.72, 0.74] });
    B.bbox('alu', 14.45, py + 1.97, bz, 0.05, 0.05, 2.3, 0.01, { color: [0.7, 0.72, 0.74] });
    B.quad('poly', [14.45, py + 0.1, bz - 1.13], [14.45, py + 0.1, bz + 1.13], [14.45, py + 1.95, bz + 1.13], [14.45, py + 1.95, bz - 1.13]);
    addBox(14.45, bz, 0.05, 1.15, 0, py - 1, py + 2);
  }
  { // taxi stand
    B.frame(21.9, py, -51.2, 0);
    B.cyl('alu', 0, 0, 0, 0.045, 0.045, 2.7, 10, { color: [0.85, 0.86, 0.88] });
    const ts = signMesh(0.9, 0.5, (g, W2, H2) => { g.fillStyle = '#1b1f24'; g.fillRect(0, 0, W2, H2); g.fillStyle = '#f5c518'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `bold ${H2 * 0.34}px Arial`; g.fillText('TAXI', W2 / 2, H2 * 0.32); g.fillStyle = '#fff'; g.font = `bold ${H2 * 0.2}px ${JP_FONT}`; g.fillText('タクシーのりば', W2 / 2, H2 * 0.72); }, 1.0, 128);
    for (const t of [Math.PI / 2, -Math.PI / 2]) place(ts.clone(), B, [t > 0 ? 0.05 : -0.05, 2.35, 0], t);
    B.bbox('plain', 0, 2.1, 0, 0.06, 0.5, 0.9, 0.01, { color: [0.2, 0.22, 0.24] });
    addCircle(21.9, -51.2, 0.1);
    B.frame(0, 0, 0, 0);
    for (const z of [-50.4, -47.6]) B.cyl('steel', 20.8, py, z, 0.06, 0.06, 2.55, 12, { color: [0.5, 0.53, 0.56] });
    B.bbox('metal', 21.6, py + 2.55, -49, 2.0, 0.1, 3.4, 0.02, { color: CN }); B.bbox('metal', 22.56, py + 2.47, -49, 0.05, 0.2, 3.44, 0.01, { color: CNF });
    B.box('lamp', 21.7, py + 2.54, -49, 0.8, 0.012, 0.16); lampPoints.push({ p: [21.7, py + 2.2, -49], s: 0.4 });
    plazaBench(B, 21.25, py, -49, Math.PI / 2);
  }
  // planted bed: a granite-kerbed raised bed with a cherry and shrubs (planted by the greenery pass), and a monument
  const bed = { x0: 15.6, x1: 20.2, z0: -51.2, z1: -37.4, top: py + 0.42 };
  B.frame(0, 0, 0, 0);
  for (const [cx, cz, w, d] of [[(bed.x0 + bed.x1) / 2, bed.z0 + 0.14, bed.x1 - bed.x0, 0.28], [(bed.x0 + bed.x1) / 2, bed.z1 - 0.14, bed.x1 - bed.x0, 0.28], [bed.x0 + 0.14, (bed.z0 + bed.z1) / 2, 0.28, bed.z1 - bed.z0 - 0.56], [bed.x1 - 0.14, (bed.z0 + bed.z1) / 2, 0.28, bed.z1 - bed.z0 - 0.56]])
    B.bbox('stone', cx, py - 0.02, cz, w, 0.46, d, 0.03, { color: [0.72, 0.7, 0.66] });
  B.box('plain', (bed.x0 + bed.x1) / 2, py - 0.02, (bed.z0 + bed.z1) / 2, bed.x1 - bed.x0 - 0.56, 0.36, bed.z1 - bed.z0 - 0.56, { color: [0.3, 0.23, 0.17], skip: 'ny' });
  addBox((bed.x0 + bed.x1) / 2, (bed.z0 + bed.z1) / 2, (bed.x1 - bed.x0) / 2, (bed.z1 - bed.z0) / 2, 0, py - 1, py + 0.44);
  B.frame(17.9, py, -34.2, 0);
  B.bbox('stone', 0, 0, 0, 2.2, 0.32, 1.1, 0.04, { color: [0.64, 0.62, 0.58] });
  B.bbox('stone', 0, 0.32, 0, 1.3, 1.55, 0.34, 0.07, { color: [0.4, 0.42, 0.41] });
  place(signMesh(1.0, 1.25, (g, W2, H2) => { g.fillStyle = '#5b5f5d'; g.fillRect(0, 0, W2, H2); g.fillStyle = '#e9e4d6'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `bold ${W2 * 0.3}px ${JP_FONT}`; g.fillText('桜', W2 / 2, H2 * 0.28); g.fillText('川', W2 / 2, H2 * 0.58); g.font = `${W2 * 0.07}px ${JP_FONT}`; g.fillText('町制施行六十周年記念', W2 / 2, H2 * 0.86); }, 0.05, 256), B, [0, 1.1, 0.172]);
  addBox(17.9, -34.2, 1.1, 0.55, 0, py - 1, py + 1.9);
  B.frame(0, 0, 0, 0);

  // ---- the square: bicycle parking under a shelter, benches, a clock, a map board, a phone box, lamps
  const bikes = [];
  for (let row = 0; row < 2; row++) for (let i = 0; i < 16; i++) if (rng() < 0.85) bikes.push({ x: -29.8 + i * 0.62, y: py, z: -60.4 + row * 2.6, r: Math.PI / 2 + (row ? Math.PI : 0) + (rng() - 0.5) * 0.1 });
  bicycles(bikes, rng);
  B.frame(-25.2, py, -59.1, 0);
  for (const sx of [-5.2, 5.2]) for (const sz of [-2.2, 2.2]) B.box('alu', sx, 0, sz, 0.1, 2.3, 0.1, { color: [0.55, 0.58, 0.6] });
  B.bbox('roofMetal', 0, 2.3, 0, 11, 0.08, 5.2, 0.02, { color: [0.35, 0.45, 0.5], uv: 2 });
  for (const sz of [-1.3, 1.3]) B.box('steel', 0, 0.02, sz, 10.2, 0.04, 0.06, { color: [0.5, 0.52, 0.54] });  // wheel rails
  addBox(-25.2, -59.1, 5.4, 2.4, 0, -1e9, py + 1.2);
  B.frame(0, 0, 0, 0);
  clockPole(B, -6, py, -40);
  for (const [x, z, r] of [[-12, -43.5, 0], [-16, -43.5, 0], [-12, -36.8, Math.PI], [-16, -36.8, Math.PI], [0.8, -44, -Math.PI / 2]]) plazaBench(B, x, py, z, r);
  { // area map board
    B.frame(-8.5, py, -57.2, 0);
    for (const e of [-0.85, 0.85]) B.bbox('metal', e, 0, 0, 0.08, 2.1, 0.08, 0.01, { color: [0.26, 0.3, 0.3] });
    B.bbox('metal', 0, 0.75, -0.03, 1.8, 1.25, 0.08, 0.02, { color: [0.26, 0.3, 0.3] });
    place(signMesh(1.66, 1.12, (g, W2, H2) => {
      g.fillStyle = '#eef3e6'; g.fillRect(0, 0, W2, H2); g.fillStyle = '#9fd1e8'; g.fillRect(W2 * 0.64, 0, W2 * 0.08, H2);
      g.fillStyle = '#fff'; g.fillRect(0, H2 * 0.55, W2, H2 * 0.05); g.fillRect(W2 * 0.8, 0, W2 * 0.035, H2); g.fillStyle = '#888'; g.fillRect(0, H2 * 0.78, W2, H2 * 0.02);
      g.fillStyle = '#e6a0b4'; for (let i = 0; i < 9; i++) g.fillRect(W2 * (0.08 + (i % 3) * 0.17), H2 * (0.12 + Math.floor(i / 3) * 0.13), W2 * 0.12, H2 * 0.08);
      g.fillStyle = '#c0392b'; g.beginPath(); g.arc(W2 * 0.45, H2 * 0.66, H2 * 0.025, 0, 7); g.fill();
      g.fillStyle = '#1f5e3a'; g.fillRect(0, 0, W2, H2 * 0.1); g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `bold ${H2 * 0.07}px ${JP_FONT}`; g.fillText('桜川町 周辺案内図', W2 / 2, H2 * 0.05);
      g.fillStyle = '#c0392b'; g.font = `bold ${H2 * 0.045}px ${JP_FONT}`; g.fillText('現在地', W2 * 0.45, H2 * 0.71);
    }, 0.5, 256), B, [0, 1.375, 0.016]);
    addBox(-8.5, -57.2, 0.95, 0.1, 0, py - 1, py + 2.1);
    B.frame(0, 0, 0, 0);
  }
  { // public phone box
    B.frame(-13, py, -61.2, 0);
    const PB = [0.2, 0.52, 0.34];
    for (const sx of [-0.45, 0.45]) for (const sz of [-0.45, 0.45]) B.bbox('alu', sx, 0, sz, 0.06, 2.2, 0.06, 0.01, { color: PB });
    B.bbox('alu', 0, 2.2, 0, 1.0, 0.16, 1.0, 0.03, { color: PB });
    for (const [a, b] of [[[-0.42, 0.45], [0.42, 0.45]], [[0.45, 0.42], [0.45, -0.42]], [[-0.45, -0.42], [-0.45, 0.42]], [[0.42, -0.45], [-0.42, -0.45]]])
      B.quad('poly', [a[0], 0.12, a[1]], [b[0], 0.12, b[1]], [b[0], 2.15, b[1]], [a[0], 2.15, a[1]]);
    B.bbox('plastic', 0, 1.0, -0.3, 0.34, 0.5, 0.24, 0.02, { color: [0.3, 0.62, 0.36] });
    B.bbox('plastic', 0, 1.05, -0.3, 0.3, 0.02, 0.26, 0.01, { color: [0.95, 0.95, 0.9] });
    place(signMesh(0.8, 0.14, (g, W2, H2) => { g.fillStyle = '#2d8a4e'; g.fillRect(0, 0, W2, H2); g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `bold ${H2 * 0.62}px ${JP_FONT}`; g.fillText('公衆電話', W2 / 2, H2 * 0.55); }, 1.0, 48), B, [0, 2.28, 0.505]);
    addBox(-13, -61.2, 0.5, 0.5, 0, py - 1, py + 2.3);
    lampPoints.push({ p: [-13, py + 2.0, -61.2], s: 0.2 });
    B.frame(0, 0, 0, 0);
  }
  koban(B, -31.4, py, -40.8, Math.PI / 2, rng);
  for (const [x, z, r] of [[-14, -52, 0], [-24.5, -46, 0],[3.9, -37, Math.PI / 2], [12.4, -52.7, -Math.PI * 0.75], [21.6, -52.7, Math.PI * 0.75], [30.6, -40, -Math.PI / 2], [17, -62.9, 0], [3.9, -58, Math.PI / 2]]) plazaLamp(B, x, py, z, r);
  // surface height anywhere on the forecourt (null outside it): footways py, the loop ry, crossing tables and ramps between
  const heightAt = (x, z) => {
    if (x < -34 || x > 31.5 || z < -63.5 || z > -31) return null;
    if (x <= 5 || x >= 29 || z <= -61) return py;
    const cxI = clamp(x, 14, 20), czI = Math.min(z, -51.5);
    if (x > 11.5 && x < 22.5 && z > -54 && (z > -51.5 || Math.hypot(x - cxI, z - czI) < 2.5)) return py;
    if ((x < 11.5 || x > 22.5) && z > -51.1 && z < -45.9) { const d = z < -50 ? -50 - z : z > -47 ? z + 47 : 0; return lerp(py, ry, Math.min(1, d / 1.1)); }
    return ry;
  };
  return { py, ry, bed, heightAt };
}
