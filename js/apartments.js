// Apartment building families for the district (桜川ニュータウン). All go through GeoBuilder frames: the building frame
// has x along its length, z across (+z = the front, where the balconies are), y up from the platform. Facades are real
// walls with openings (boxWalls), windows and doors sit in reveals; balconies, stair towers, corridors, lobbies, canopies,
// roof plant, signs and the service clutter (AC units, meters, laundry, downpipes) are built on. Each family returns
// { entrances: [{ p: [x, y, z], out: [dx, dz], kind }], footprint: [[x, z]...], lamps: [...] }.
//   walkupSlab  階段室型 walk-up, 4-5 storeys: stair halls on the back serve two flats a floor, balconies across the front
//   pointTower  ポイント型 tower, 9-12 storeys: square plan round a core, wrap-around corner balconies, glazed lobby
//   mansion     modern mid-rise (マンション), 6-9 storeys: open corridors on the back with a lift tower and stair,
//               balconies of glass and tiled panels on the front, lobby and optional pilotis parking
//   centreBlock the neighbourhood centre: an L of shops under a canopy on a podium, with mansion wings above
//   lowRise     2-storey terraced flats (アパート) with an outside stair and an access gallery, hip roof
import { scene, clamp, lerp } from './core.js';
import { lampPoints, signMesh, JP_FONT } from './townkit.js';
import { inFrame, windowUnit, doorUnit, flatRoof, hipRoof, acUnit, meterBox, downpipe, boxWalls, antenna, reveals } from './building.js';

const pick = (rng, a) => a[Math.floor(rng() * a.length)];
const mul = (c, k) => c.map(v => v * k);
const jit = (rng, c, a = 0.03) => c.map(v => clamp(v + (rng() - 0.5) * a, 0, 1));
const W = (B, lx, ly, lz) => B.P([lx, ly, lz]);
const LAUNDRY = [[0.95, 0.95, 0.94], [0.52, 0.64, 0.9], [0.95, 0.62, 0.64], [0.98, 0.86, 0.52], [0.6, 0.8, 0.62], [0.35, 0.38, 0.5]];

// palettes: body wall, balcony / parapet, trim (frames, coping), accent band, base
export const PALETTES = {
  cream:  { wall: [0.88, 0.84, 0.76], parapet: [0.9, 0.88, 0.83], trim: [0.8, 0.8, 0.78], accent: [0.34, 0.52, 0.56], base: [0.6, 0.58, 0.55] },
  salmon: { wall: [0.9, 0.78, 0.7], parapet: [0.93, 0.9, 0.86], trim: [0.82, 0.8, 0.77], accent: [0.62, 0.3, 0.24], base: [0.58, 0.54, 0.5] },
  grey:   { wall: [0.8, 0.81, 0.8], parapet: [0.9, 0.9, 0.88], trim: [0.74, 0.76, 0.78], accent: [0.26, 0.4, 0.58], base: [0.55, 0.56, 0.56] },
  sand:   { wall: [0.84, 0.76, 0.64], parapet: [0.88, 0.85, 0.78], trim: [0.7, 0.66, 0.6], accent: [0.42, 0.5, 0.36], base: [0.52, 0.48, 0.44] },
  white:  { wall: [0.92, 0.92, 0.9], parapet: [0.94, 0.94, 0.92], trim: [0.7, 0.72, 0.74], accent: [0.2, 0.24, 0.28], base: [0.6, 0.42, 0.36] },
  brick:  { wall: [0.72, 0.52, 0.42], parapet: [0.9, 0.88, 0.84], trim: [0.86, 0.84, 0.8], accent: [0.9, 0.88, 0.84], base: [0.46, 0.34, 0.3] },
  mocha:  { wall: [0.7, 0.62, 0.54], parapet: [0.86, 0.84, 0.8], trim: [0.28, 0.28, 0.3], accent: [0.9, 0.86, 0.78], base: [0.4, 0.36, 0.34] },
};

// a sign plate (canvas) on a face: text lines centred
function plate(B, lx, ly, lz, face, w, h, draw, glow = 0.1, px = 256) {
  const m = signMesh(w, h, draw, glow, px); m.position.set(...B.P([lx, ly, lz])); m.rotation.y = B.F.r + face; scene.add(m); return m;
}
// block number painted high on a gable (号棟), facing +z of the current frame
function blockNumber(B, lx, ly, lz, face, n, color = '#5d5750') {
  const m = plate(B, lx, ly, lz, face, 3.0, 3.0, (g, W2, H2) => { g.clearRect(0, 0, W2, H2); g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `bold ${H2 * 0.6}px Arial`; g.fillText(String(n), W2 / 2, H2 * 0.4); g.font = `bold ${H2 * 0.2}px ${JP_FONT}`; g.fillText('号棟', W2 / 2, H2 * 0.84); }, 0.05);
  m.material.transparent = true; m.material.alphaTest = 0.3;
}
// balcony run along the current (wall) frame: x0..x1, floor level fy, depth dp; kind 'solid' | 'rail' | 'glass';
// partitions at `parts`; laundry and AC units on some
function balconyRun(B, rng, x0, x1, fy, dp, { kind = 'solid', color, trim, parts = [], acs = [], laundry = 0.3, fh = 2.8, ground = false }) {
  const len = x1 - x0, cx = (x0 + x1) / 2;
  if (!ground) B.bbox('concrete', cx, fy - 0.17, dp / 2, len, 0.19, dp, 0.015, { color: [0.72, 0.71, 0.69] });           // slab with its edge
  if (ground) { // a garden terrace instead: paving and a low fence with a hedge behind
    B.box('pavement', cx, fy - 0.33, dp / 2 + 0.6, len, 0.05, dp + 1.2, { color: [0.82, 0.8, 0.76] });
    B.detail(1, () => { for (let x = x0; x <= x1 + 1e-3; x += 1.5) B.box('alu', Math.min(x, x1), fy - 0.33, dp + 1.15, 0.04, 0.95, 0.04, { color: trim });
      B.box('alu', cx, fy + 0.55, dp + 1.15, len, 0.04, 0.04, { color: trim }); B.box('alu', cx, fy + 0.1, dp + 1.15, len, 0.03, 0.03, { color: trim }); });
    return;
  }
  const pz = dp - 0.06;
  if (kind === 'solid') {
    B.bbox('tiles', cx, fy + 0.02, pz, len, 1.05, 0.12, 0.012, { color, uv: 2.5 });
    B.bbox('concrete', cx, fy + 1.07, pz, len + 0.02, 0.05, 0.16, 0.01, { color: trim });
    B.box('plain', cx, fy + 0.02, pz + 0.062, len, 0.12, 0.004, { color: mul(color, 0.8) });                            // drip line
  } else if (kind === 'glass') {
    B.quad('plastic', [x0, fy + 0.1, pz + 0.03], [x1, fy + 0.1, pz + 0.03], [x1, fy + 1.02, pz + 0.03], [x0, fy + 1.02, pz + 0.03], { color: [0.62, 0.72, 0.76] });
    B.quad('plastic', [x1, fy + 0.1, pz + 0.025], [x0, fy + 0.1, pz + 0.025], [x0, fy + 1.02, pz + 0.025], [x1, fy + 1.02, pz + 0.025], { color: [0.58, 0.66, 0.7] });
    B.bbox('alu', cx, fy + 1.02, pz + 0.03, len, 0.06, 0.08, 0.008, { color: trim });
    B.bbox('alu', cx, fy + 0.04, pz + 0.03, len, 0.06, 0.06, 0.006, { color: trim });
    B.detail(1, () => { for (let x = x0 + 1.2; x < x1 - 0.3; x += 1.2) B.box('alu', x, fy + 0.04, pz + 0.03, 0.04, 1.0, 0.05, { color: trim }); });
  } else { // steel railing with a frosted lower panel
    B.quad('plastic', [x0, fy + 0.12, pz], [x1, fy + 0.12, pz], [x1, fy + 0.72, pz], [x0, fy + 0.72, pz], { color: [0.84, 0.86, 0.86] });
    B.quad('plastic', [x1, fy + 0.12, pz - 0.005], [x0, fy + 0.12, pz - 0.005], [x0, fy + 0.72, pz - 0.005], [x1, fy + 0.72, pz - 0.005], { color: [0.8, 0.82, 0.82] });
    B.bbox('alu', cx, fy + 1.0, pz, len, 0.06, 0.07, 0.008, { color: trim });
    B.detail(1, () => { for (let x = x0 + 0.12; x < x1; x += 0.12) B.box('alu', x, fy + 0.72, pz, 0.02, 0.28, 0.02, { color: trim }); });
  }
  for (const px of parts) B.bbox('plain', px, fy + 0.02, dp / 2, 0.05, fh - 0.35, dp - 0.1, 0.008, { color: [0.86, 0.85, 0.82] }); // fire-escape partitions
  for (const ax of acs) acUnit(B, ax, fy + 0.02, rng, { pipeTo: fy + fh - 0.5, z: 0.36 });
  if (rng() < laundry) B.detail(2, () => { // laundry poles between the partitions, something hung out
    const a = x0 + 0.4, b = x1 - 0.4;
    for (const zz of [dp - 0.45, dp - 0.75]) B.box('alu', (a + b) / 2, fy + 1.8, zz, b - a, 0.025, 0.025, { color: [0.7, 0.72, 0.74] });
    for (let x = a + 0.3; x < b - 0.3; x += 0.45 + rng() * 0.4) if (rng() < 0.7) B.box('plain', x, fy + 1.18, dp - 0.45, 0.32 + rng() * 0.2, 0.6, 0.02, { color: pick(rng, LAUNDRY) });
  });
}
// ground-floor entrance canopy + steps + light, in the current wall frame (door centred at x, sill at y0)
function entranceCanopy(B, x, y0, w, depth, { h = 2.65, color = [0.86, 0.85, 0.82], cols = false, lampAt = null } = {}) {
  B.bbox('concrete', x, y0 + h, depth / 2, w, 0.16, depth, 0.02, { color });
  B.box('plain', x, y0 + h + 0.16, depth / 2, w - 0.1, 0.02, depth - 0.1, { color: mul(color, 0.92) });
  if (cols) for (const sx of [-1, 1]) B.cyl('steel', x + sx * (w / 2 - 0.2), y0 - 0.05, depth - 0.25, 0.07, 0.07, h + 0.05, 10, { color: [0.62, 0.64, 0.66] });
  B.box('lamp', x, y0 + h - 0.03, depth * 0.5, 0.5, 0.03, 0.5);
  if (lampAt) lampAt.push({ p: B.P([x, y0 + h - 0.2, depth * 0.5]), s: 0.5 });
  // a landing level with the door sill and a step down to the path
  B.bbox('concrete', x, y0 - 0.45, 0.45, w - 0.2, 0.45, 0.9, 0.012, { color: [0.76, 0.75, 0.72] });
  B.bbox('concrete', x, y0 - 0.6, 1.1, w - 0.2, 0.45, 0.4, 0.012, { color: [0.74, 0.73, 0.7] });
}

// ---------------------------------------------------------------- 階段室型 walk-up slab
export function walkupSlab(B, s, rng, ex) {
  const { x, y, z, r, w, d = 9.6, floors = 5, pal = PALETTES.cream, no = 1, bal = 'solid' } = s, fh = 2.8, y0 = 0.35, H = y0 + floors * fh;
  const nU = Math.max(2, Math.round(w / 6.9 / 2) * 2), uw = w / nU, out = { entrances: [], lamps: [] };
  const cores = []; for (let k = 0; k < nU / 2; k++) cores.push(-w / 2 + (2 * k + 1) * uw);
  const wall = jit(rng, pal.wall, 0.03);
  B.frame(x, y, z, r);
  B.bbox('concrete', 0, -0.45, 0, w + 0.12, 0.8, d + 0.12, 0.02, { color: pal.base });                                     // plinth
  const front = [], back = [], gable = [];
  for (let f = 0; f < floors; f++) {
    const fy = y0 + f * fh;
    for (let u = 0; u < nU; u++) {
      const cx = -w / 2 + (u + 0.5) * uw;
      front.push({ x0: cx - uw / 2 + 0.45, x1: cx - 0.25, y0: fy + 0.05, y1: fy + 2.05, d: 0.18, f, u, kind: 'living' }, { x0: cx + 0.25, x1: cx + uw / 2 - 0.7, y0: fy + 0.05, y1: fy + 2.05, d: 0.18, f, u, kind: 'room' });
      const sgn = u % 2 ? 1 : -1, bx0 = cx + sgn * 0.6, bx1 = cx + sgn * 2.2;                                         // away from the stair hall
      back.push({ x0: -Math.max(bx0, bx1) - 0.65, x1: -Math.max(bx0, bx1) + 0.65, y0: fy + 1.0, y1: fy + 2.0, d: 0.14, f, kind: 'kitchen' });
      back.push({ x0: -Math.min(bx0, bx1) - 0.35, x1: -Math.min(bx0, bx1) + 0.35, y0: fy + 1.45, y1: fy + 2.05, d: 0.12, f, kind: 'bath' });
    }
    gable.push({ x0: d / 2 - 2.6, x1: d / 2 - 1.6, y0: fy + 1.0, y1: fy + 2.0, d: 0.14 });
  }
  const mir = hs => hs.map(h => ({ ...h, x0: -h.x1, x1: -h.x0 }));                                                   // (+x gable runs front-to-back reversed)
  boxWalls(B, 0, w, d, y0, H + 0.7, [['tiles', wall, 2.5]], fi => fi === 0 ? front : fi === 1 ? back : fi === 2 ? mir(gable) : gable, mul(wall, 0.95));
  // front: windows, balconies (the ground floor has garden terraces), AC units, laundry
  inFrame(B, [0, 0, d / 2], 0, () => {
    for (const h of front) windowUnit(B, h, { rng, frame: [0.78, 0.8, 0.82], type: 'slide', sill: false, shutterBox: h.kind === 'room' && rng() < 0.35 });
    for (let f = 0; f < floors; f++) {
      const fy = y0 + f * fh, parts = [];
      for (let u = 1; u < nU; u++) parts.push(-w / 2 + u * uw);
      const acs = []; for (let u = 0; u < nU; u++) if (rng() < 0.55) acs.push(-w / 2 + u * uw + 0.7);
      balconyRun(B, rng, -w / 2 - 0.1, w / 2 + 0.1, fy, 1.3, { kind: bal, color: pal.parapet, trim: pal.trim, parts, acs, laundry: 0.45, fh, ground: f === 0 });
      if (bal === 'solid') B.box('plain', 0, fy + 1.12, 1.25, w + 0.12, 0.05, 0.1, { color: pal.accent });           // accent line on the coping
    }
    for (const e of [-1, 1]) downpipe(B, [e * (w / 2 + 0.05), H + 0.3, 1.2], [e * (w / 2 + 0.05), 0, 1.2], 0, [0.72, 0.72, 0.7]);
  });
  // back: service windows, meter boxes, and a stair tower at every core with its entrance
  inFrame(B, [0, 0, -d / 2], Math.PI, () => {
    for (const h of back) windowUnit(B, h, { rng, frame: [0.78, 0.8, 0.82], grille: h.kind === 'kitchen', frosted: h.kind === 'bath' || rng() < 0.4, type: h.kind === 'bath' ? 'fixed' : 'slide' });
    for (const c of cores) {
      const X = -c, tw = 2.7, td = 1.5, top = H + 2.4;
      // tower walls (its back face is open at the half landings)
      const holes = [{ x0: X - 0.85, x1: X + 0.85, y0: 0.08, y1: 2.35, d: 0.12 }];
      for (let f = 0; f < floors; f++) { const hy = y0 + f * fh + fh / 2; holes.push({ x0: X - 0.95, x1: X + 0.95, y0: hy + 0.95, y1: hy + 1.95, d: 0.12, open: true }); }
      inFrame(B, [X, 0, td], 0, () => {
        const hl = holes.map(h => ({ ...h, x0: h.x0 - X, x1: h.x1 - X }));
        B.frame(...B.P([0, 0, 0]), B.F.r);
        // face with openings
        const Fr = B.F;
        const wf = (x0, x1, yb, yt) => B.quad('tiles', [x0, yb, 0], [x1, yb, 0], [x1, yt, 0], [x0, yt, 0], { color: mul(wall, 1.02), uvs: [[x0 / 2.5, yb / 2.5], [x1 / 2.5, yb / 2.5], [x1 / 2.5, yt / 2.5], [x0 / 2.5, yt / 2.5]] });
        let yb = 0;
        for (const h of hl) { if (h.y0 > yb) { wf(-tw / 2, tw / 2, yb, h.y0); } wf(-tw / 2, h.x0, h.y0, h.y1); wf(h.x1, tw / 2, h.y0, h.y1); yb = h.y1; }
        wf(-tw / 2, tw / 2, yb, top);
        // inside: the dark stair well behind each opening, its reveals, and the landing railing
        for (const h of hl) {
          B.quad('dark', [h.x0, h.y0, -0.9], [h.x1, h.y0, -0.9], [h.x1, h.y1, -0.9], [h.x0, h.y1, -0.9], { color: [0.2, 0.2, 0.21] });
          reveals(B, 'tiles', { ...h, d: 0.9 }, mul(wall, 0.88), 1.2);
          if (h.open) { B.box('steel', 0, h.y0 + 0.02, 0.04, h.x1 - h.x0, 0.05, 0.05, { color: [0.6, 0.62, 0.64] }); B.detail(1, () => { for (let xx = h.x0 + 0.12; xx < h.x1; xx += 0.14) B.box('steel', xx, h.y0 - 0.95, 0.03, 0.02, 0.95, 0.02, { color: [0.6, 0.62, 0.64] }); }); }
        }
        // mailboxes on the inner wall of the entrance, lit inside
        B.detail(1, () => { B.bbox('metal', -0.62, 0.95, -0.55, 0.14, 0.9, 0.7, 0.01, { color: [0.62, 0.64, 0.66] });
          for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) B.box('metal', -0.55, 1.05 + i * 0.28, -0.8 + j * 0.24, 0.005, 0.22, 0.2, { color: [0.7, 0.72, 0.74] }); });
        B.box('lamp', 0, 2.3, -0.5, 0.35, 0.03, 0.35);
        B.frame(Fr.x, Fr.y, Fr.z, Fr.r);
        entranceCanopy(B, 0, 0.3, 2.9, 1.3, { color: pal.parapet, lampAt: out.lamps });
        plate(B, 1.05, 2.1, 0.02, 0, 0.36, 0.26, (g, W2, H2) => { g.fillStyle = '#f2f0ea'; g.fillRect(0, 0, W2, H2); g.fillStyle = '#333'; g.font = `bold ${H2 * 0.5}px Arial`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(`${no}-${cores.indexOf(c) + 1}`, W2 / 2, H2 / 2); }, 0.1, 64);
        out.entrances.push({ p: B.P([0, 0, 2.2]), out: [B.N([0, 0, 1])[0], B.N([0, 0, 1])[2]], kind: 'stair' });
      });
      // the tower's side walls and roof (it stands td proud of the back wall)
      for (const sx of [-1, 1]) inFrame(B, [X + sx * tw / 2, 0, td / 2], sx * Math.PI / 2, () => B.quad('tiles', [-td / 2, 0, 0], [td / 2, 0, 0], [td / 2, top, 0], [-td / 2, top, 0], { color: mul(wall, 0.96), uv: 2.5 }));
      B.bbox('concrete', X, top, td / 2 - 0.05, tw + 0.2, 0.14, td + 0.3, 0.015, { color: pal.trim });
      for (let f = 1; f < floors; f++) meterBox(B, X + (rng() < 0.5 ? -1 : 1) * 2.1, y0 + f * fh + 1.2, 'power');
    }
  });
  // gables: small windows, the block number high up on the east end
  inFrame(B, [w / 2, 0, 0], Math.PI / 2, () => { for (const h of mir(gable)) windowUnit(B, h, { rng, frame: [0.78, 0.8, 0.82], type: 'slide' }); blockNumber(B, 0.8, H - 3.6, 0.03, 0, no); });
  inFrame(B, [-w / 2, 0, 0], -Math.PI / 2, () => { for (const h of gable) windowUnit(B, h, { rng, frame: [0.78, 0.8, 0.82], type: 'slide' }); });
  const roofY = flatRoof(B, { w, d, y: H, para: 0.7, color: wall, wallMat: 'tiles', coping: pal.trim });
  B.bbox('metal', cores[0], roofY, -d / 4, 2.4, 1.9, 2.4, 0.03, { color: [0.86, 0.86, 0.83] });                            // water tank
  for (let i = 0; i < Math.min(3, cores.length); i++) antenna(B, cores[i] + 1.5, roofY, 0);
  ex.push({ t: 'box', p: B.P([0, 0, 0.3]), hx: w / 2 + 0.2, hz: d / 2 + 1.2, r, h: H + 1 });
  for (const c of cores) ex.push({ t: 'box', p: B.P([c, 0, -d / 2 - 0.75]), hx: 1.4, hz: 0.8, r, h: H + 2 });
  out.footprint = [[-w / 2 - 0.3, -d / 2 - 1.6], [w / 2 + 0.3, d / 2 + 1.5]]; out.H = H;
  for (const e of out.lamps) lampPoints.push(e);
  B.frame(0, 0, 0, 0);
  return out;
}

// ---------------------------------------------------------------- ポイント型 point tower
export function pointTower(B, s, rng, ex) {
  const { x, y, z, r, w = 18, d = 16, floors = 11, pal = PALETTES.white, no = 1 } = s, fh = 2.9, y0 = 0.4, H = y0 + floors * fh;
  const out = { entrances: [], lamps: [] }, wall = jit(rng, pal.wall, 0.02), WR = 3.2;                                      // WR: corner balconies wrap this far
  B.frame(x, y, z, r);
  B.bbox('concrete', 0, -0.45, 0, w + 0.12, 0.85, d + 0.12, 0.02, { color: pal.base });
  const front = [], back = [], side = [];
  for (let f = 0; f < floors; f++) {
    const fy = y0 + f * fh;
    for (const u of [-1, 1]) { const cx = u * w / 4;
      front.push({ x0: cx - 3.3, x1: cx - 0.6, y0: fy + 0.05, y1: fy + 2.1, d: 0.18 }, { x0: cx + 0.2, x1: cx + 2.6, y0: fy + 0.05, y1: fy + 2.1, d: 0.18 }); }
    side.push({ x0: d / 2 - WR + 0.5, x1: d / 2 - 0.6, y0: fy + 0.05, y1: fy + 2.1, d: 0.18 }, { x0: -d / 2 + 1.2, x1: -d / 2 + 2.9, y0: fy + 0.95, y1: fy + 2.05, d: 0.16 }, { x0: -1.6, x1: 0.2, y0: fy + 0.95, y1: fy + 2.05, d: 0.16 });
    for (const u of [-1, 1]) back.push({ x0: u * 6.6 - 0.8, x1: u * 6.6 + 0.8, y0: fy + 1.0, y1: fy + 2.0, d: 0.14, frosted: true });
  }
  const bands = [['tiles', pal.base, 2.5, y0 + fh], ['tiles', wall, 2.5]];
  const mir = hs => hs.map(h => ({ ...h, x0: -h.x1, x1: -h.x0 }));
  boxWalls(B, 0, w, d, y0, H + 0.9, bands, fi => fi === 0 ? front : fi === 1 ? back : fi === 2 ? mir(side) : side, mul(wall, 0.95));
  // front and side balconies: one continuous slab across the front turning the corners
  const balc = f => {
    const fy = y0 + f * fh, dp = 1.5;
    inFrame(B, [0, 0, d / 2], 0, () => balconyRun(B, rng, -w / 2 - dp, w / 2 + dp, fy, dp, { kind: f % 2 ? 'glass' : 'solid', color: pal.parapet, trim: pal.trim, parts: [0], acs: rng() < 0.6 ? [-w / 4 + 1, w / 4 + 1] : [], fh, laundry: 0.35, ground: f === 0 }));
    for (const sx of [-1, 1]) inFrame(B, [sx * w / 2, 0, d / 2 - WR / 2], sx * Math.PI / 2, () => balconyRun(B, rng, sx > 0 ? -WR / 2 - dp : -WR / 2, sx > 0 ? WR / 2 : WR / 2 + dp, fy, dp, { kind: f % 2 ? 'glass' : 'solid', color: pal.parapet, trim: pal.trim, fh, laundry: 0, ground: f === 0 }));
  };
  for (let f = 0; f < floors; f++) balc(f);
  inFrame(B, [0, 0, d / 2], 0, () => { for (const h of front) windowUnit(B, h, { rng, frame: [0.8, 0.82, 0.84], type: 'slide', sill: false }); });
  for (const sx of [-1, 1]) inFrame(B, [sx * w / 2, 0, 0], sx * Math.PI / 2, () => { for (const h of sx > 0 ? mir(side) : side) windowUnit(B, h, { rng, frame: [0.8, 0.82, 0.84], type: 'slide', sill: (h.y0 - y0) % fh > 0.5, shutterBox: (h.y0 - y0) % fh > 0.5 && rng() < 0.3 }); });
  // the core: a shaft on the back rising over the roof (lift machine room), hall windows up it, glazed lobby below
  const cw = 6.4, cd = 2.6, ctop = H + 3.6;
  inFrame(B, [0, 0, -d / 2], Math.PI, () => {
    for (const h of back) windowUnit(B, h, { rng, frame: [0.8, 0.82, 0.84], frosted: true, type: 'slide' });
    B.bbox('tiles', 0, 0, cd / 2, cw, ctop, cd, 0.03, { color: mul(wall, 0.97), uv: 2.5, skip: 'ny' });
    for (let f = 1; f < floors; f++) { const fy = y0 + f * fh; B.quad('shopWindow', [-0.7, fy + 0.4, cd + 0.005], [0.7, fy + 0.4, cd + 0.005], [0.7, fy + 2.3, cd + 0.005], [-0.7, fy + 2.3, cd + 0.005], { color: [0.9, 1, 3.5 / 8], uvs: [[0, 0], [1, 0], [1, 1], [0, 1]] });
      B.box('alu', 0, fy + 0.35, cd + 0.02, 1.5, 0.06, 0.06, { color: pal.trim }); B.box('alu', 0, fy + 2.3, cd + 0.02, 1.5, 0.06, 0.06, { color: pal.trim }); }
    B.bbox('concrete', 0, ctop, cd / 2, cw + 0.2, 0.18, cd + 0.2, 0.02, { color: pal.trim });
    // lobby: a glass front with a pair of sliding doors in the base of the core, a canopy on two columns
    B.quad('dark', [-2.6, 0.1, cd + 0.01], [2.6, 0.1, cd + 0.01], [2.6, 2.9, cd + 0.01], [-2.6, 2.9, cd + 0.01], { color: [0.1, 0.1, 0.1] });
    B.quad('shopWindow', [-2.5, 0.12, cd + 0.03], [2.5, 0.12, cd + 0.03], [2.5, 2.85, cd + 0.03], [-2.5, 2.85, cd + 0.03], { color: [1.25, 1, 3.5 / 8], uvs: [[0, 0], [1, 0], [1, 1], [0, 1]] });
    for (const xx of [-2.55, -1.3, 0, 1.3, 2.55]) B.box('alu', xx, 0.1, cd + 0.05, 0.08, 2.8, 0.08, { color: [0.3, 0.3, 0.32] });
    B.box('alu', 0, 2.85, cd + 0.05, 5.2, 0.08, 0.08, { color: [0.3, 0.3, 0.32] });
    B.frame(...B.P([0, 0, cd]), B.F.r);
    entranceCanopy(B, 0, 0.35, 5.6, 3.0, { cols: true, color: [0.9, 0.9, 0.88], lampAt: out.lamps, h: 3.0 });
    plate(B, 0, 3.25, 0.02, 0, 3.2, 0.4, (g, W2, H2) => { g.fillStyle = '#2f3438'; g.fillRect(0, 0, W2, H2); g.fillStyle = '#e8e4d8'; g.font = `bold ${H2 * 0.55}px ${JP_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(s.name || `サクラタワー ${no}`, W2 / 2, H2 * 0.55); }, 0.4, 256);
    out.entrances.push({ p: B.P([0, 0, 4.2]), out: [B.N([0, 0, 1])[0], B.N([0, 0, 1])[2]], kind: 'lobby' });
  });
  B.frame(x, y, z, r);
  const roofY = flatRoof(B, { w, d, y: H, para: 0.9, color: wall, wallMat: 'tiles', coping: pal.trim });
  B.bbox('concrete', 0, H + 0.2, d / 2 - 0.2, w + 0.1, 0.5, 0.14, 0.01, { color: pal.accent });                          // crown band
  B.bbox('metal', w / 4, roofY, 0, 2.6, 2.1, 2.6, 0.03, { color: [0.86, 0.86, 0.83] });
  antenna(B, -w / 4, roofY, d / 5);
  ex.push({ t: 'box', p: B.P([0, 0, 0]), hx: w / 2 + 1.6, hz: d / 2 + 1.6, r, h: H + 1 });
  out.footprint = [[-w / 2 - 1.6, -d / 2 - 3], [w / 2 + 1.6, d / 2 + 1.6]]; out.H = H;
  for (const e of out.lamps) lampPoints.push(e);
  B.frame(0, 0, 0, 0);
  return out;
}

// ---------------------------------------------------------------- modern mid-rise (マンション)
export function mansion(B, s, rng, ex) {
  const { x, y, z, r, w, d = 11.5, floors = 8, pal = PALETTES.mocha, no = 1, podium = false, pilotis = 0, name = null } = s, fh = 3.0, y0 = podium ? 0.1 : 0.4, H = y0 + floors * fh;
  const nU = Math.max(3, Math.round(w / 6.6)), uw = w / nU, out = { entrances: [], lamps: [] }, wall = jit(rng, pal.wall, 0.02);
  const lift = Math.round(nU / 2) - 1, liftX = -w / 2 + (lift + 1) * uw;                                                    // lift at a unit boundary near the middle
  B.frame(x, y, z, r);
  if (!podium) B.bbox('concrete', 0, -0.45, 0, w + 0.12, 0.85, d + 0.12, 0.02, { color: pal.base });
  const front = [], back = [];
  for (let f = 0; f < floors; f++) {
    const fy = y0 + f * fh;
    for (let u = 0; u < nU; u++) {
      const cx = -w / 2 + (u + 0.5) * uw, pil = !podium && f === 0 && u >= nU - pilotis;
      if (pil) continue;
      front.push({ x0: cx - uw / 2 + 0.4, x1: cx + 0.6, y0: fy + 0.05, y1: fy + 2.2, d: 0.2 }, { x0: cx + 1.0, x1: cx + uw / 2 - 0.4, y0: fy + 0.05, y1: fy + 2.2, d: 0.2 });
      if (f === 0 && !podium && Math.abs(cx - liftX) < uw) continue;                                                        // the lobby takes the back here
      const X = -cx;                                                                                                        // (back faces run mirrored)
      back.push({ x0: X - 0.5, x1: X + 0.5, y0: fy + 0.02, y1: fy + 2.12, d: 0.14, door: true }, { x0: X + 0.9, x1: X + 2.1, y0: fy + 1.05, y1: fy + 2.0, d: 0.14 });
    }
  }
  const gableH = [];
  boxWalls(B, 0, w, d, y0, H + 0.9, [['tiles', wall, 2.5]], fi => fi === 0 ? front : fi === 1 ? back.filter(h => !h.door || true) : gableH, mul(wall, 0.95));
  // front: balconies whose fronts alternate glass and tiled panels in vertical stripes, AC units, partitions
  inFrame(B, [0, 0, d / 2], 0, () => {
    for (const h of front) windowUnit(B, h, { rng, frame: [0.3, 0.3, 0.32], type: 'slide', sill: false });
    for (let f = 0; f < floors; f++) {
      const fy = y0 + f * fh;
      for (let u = 0; u < nU; u++) {
        const x0 = -w / 2 + u * uw, x1 = x0 + uw, pil = !podium && f === 0 && u >= nU - pilotis;
        if (pil) continue;
        balconyRun(B, rng, x0, x1, fy, 1.8, { kind: (u + (f > floors - 3 ? 1 : 0)) % 3 === 1 ? 'solid' : 'glass', color: u % 3 === 1 ? pal.accent : pal.parapet, trim: pal.trim, parts: u ? [x0] : [], acs: rng() < 0.6 ? [x0 + 0.7] : [], fh, laundry: 0.25, ground: f === 0 && !podium });
      }
    }
    // the balcony slabs' edges read as bands across the face; slim fins between the columns of balconies
    for (let u = 0; u <= nU; u++) B.bbox('concrete', -w / 2 + u * uw, y0 + fh - 0.2, 0.95, 0.25, H - y0 - fh + 0.3, 1.9, 0.01, { color: pal.trim });
  });
  // back: an open access corridor on every upper floor, doors and small windows along it
  inFrame(B, [0, 0, -d / 2], Math.PI, () => {
    for (const h of back) { if (h.door) doorUnit(B, h, { color: jit(rng, [0.38, 0.32, 0.28], 0.06), mat: 'metal', frame: [0.3, 0.3, 0.32] }); else windowUnit(B, h, { rng, grille: true, frosted: true, frame: [0.3, 0.3, 0.32] }); }
    for (let f = 1; f < floors; f++) {
      const fy = y0 + f * fh;
      B.bbox('concrete', 0, fy - 0.18, 0.8, w, 0.18, 1.6, 0.012, { color: [0.8, 0.8, 0.78] });
      B.bbox('tiles', 0, fy, 1.54, w + 0.04, 1.15, 0.12, 0.012, { color: pal.parapet, uv: 2.5 });
      B.box('plain', 0, fy + 1.15, 1.54, w + 0.06, 0.06, 0.16, { color: pal.accent });
      B.box('lamp', 0, fy + fh - 0.22, 0.8, w - 1, 0.02, 0.08);
      lampPoints.push({ p: B.P([0, fy + fh - 0.4, 1.0]), s: 0.4 });
      for (let u = 0; u < nU; u++) meterBox(B, -w / 2 + (u + 0.5) * uw - 1.0, fy + 1.3, 'power');
    }
    // lift tower in the middle of the corridor side, glazed at each landing; lobby at its foot
    // (without a podium the shaft stands on the lobby: a glazed box out past the corridor line at its foot)
    const X = -liftX, lt = H + 3.2, LW = 7.2, LD = 4.2, LH = y0 + fh - 0.2, sb = podium ? 0 : LH + 0.6;
    B.bbox('tiles', X, sb, 2.8, 3.0, lt - sb, 2.4, 0.03, { color: mul(wall, 0.92), uv: 2.5, skip: 'ny' });
    const hall = { color: [0.9, 1, 3.5 / 8], uvs: [[0, 0], [1, 0], [1, 1], [0, 1]] };
    for (let f = 1; f < floors; f++) { const gy0 = y0 + f * fh + 0.2; B.quad('shopWindow', [X - 0.6, gy0, 4.01], [X + 0.6, gy0, 4.01], [X + 0.6, gy0 + 2.2, 4.01], [X - 0.6, gy0 + 2.2, 4.01], hall);
      for (const yy of [gy0 - 0.04, gy0 + 2.2]) B.box('alu', X, yy, 4.03, 1.3, 0.05, 0.05, { color: [0.3, 0.3, 0.32] }); }
    B.bbox('concrete', X, lt, 2.8, 3.2, 0.16, 2.6, 0.02, { color: pal.trim });
    if (!podium) {
      const lob = { color: [1.25, 1, 3.5 / 8], uvs: [[0, 0], [1, 0], [1, 1], [0, 1]] }, mul3 = { color: [0.3, 0.3, 0.32] };
      B.bbox('concrete', X, -0.45, LD / 2, LW + 0.2, y0 + 0.45, LD + 0.1, 0.02, { color: pal.base });
      B.quad('shopWindow', [X - LW / 2, y0 + 0.02, LD], [X + LW / 2, y0 + 0.02, LD], [X + LW / 2, LH, LD], [X - LW / 2, LH, LD], lob);
      for (const e of [-1, 1]) B.poly('shopWindow', [[X + e * LW / 2, y0 + 0.02, 0.05], [X + e * LW / 2, y0 + 0.02, LD], [X + e * LW / 2, LH, LD], [X + e * LW / 2, LH, 0.05]], [e, 0, 0], lob);
      for (const xx of [-3.6, -1.8, 0, 1.8, 3.6]) B.box('alu', X + xx, y0, LD + 0.02, 0.08, LH - y0, 0.08, mul3);
      for (const e of [-1, 1]) for (const zz of [0.1, LD / 2]) B.box('alu', X + e * LW / 2, y0, zz, 0.08, LH - y0, 0.08, mul3);
      B.box('alu', X, LH - 0.8, LD + 0.02, LW, 0.06, 0.06, mul3);
      B.bbox('tiles', X, LH, (1.6 + LD + 0.2) / 2, LW + 0.3, 0.6, LD + 0.2 - 1.6, 0.02, { color: mul(wall, 0.92), uv: 2.5 });
      ex.push({ t: 'box', p: B.P([X, 0, LD / 2]), hx: LW / 2 + 0.1, hz: LD / 2, r, h: LH + 0.6 });
      B.frame(...B.P([X, 0, LD + 0.2]), B.F.r);
      entranceCanopy(B, 0, y0, 3.8, 2.2, { cols: true, color: [0.28, 0.28, 0.3], lampAt: out.lamps, h: 2.55 });
      plate(B, 0, LH + 0.3, 0.02, 0, 4.4, 0.42, (g, W2, H2) => { g.fillStyle = '#26282b'; g.fillRect(0, 0, W2, H2); g.fillStyle = '#e9dcc0'; g.font = `${H2 * 0.5}px ${JP_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(name || `パークハイツ桜川 ${no}`, W2 / 2, H2 * 0.55); }, 0.5, 256);
      out.entrances.push({ p: B.P([0, 0, 2.4]), out: [B.N([0, 0, 1])[0], B.N([0, 0, 1])[2]], kind: 'lobby' });
    }
  });
  B.frame(x, y, z, r);
  // stair: an open stair tower at the far end with solid parapets
  inFrame(B, [-w / 2, 0, -d / 2 + 2.2], -Math.PI / 2, () => {
    const top = H + 1.2;
    for (const cx2 of [-2.1, 2.1]) B.bbox('tiles', cx2, 0, 1.4, 0.3, top, 0.3, 0.02, { color: mul(wall, 0.95) });
    for (let f = 0; f < floors; f++) { const fy = y0 + f * fh; B.bbox('concrete', 0, fy + fh / 2 - 0.15, 1.3, 4.5, 0.15, 2.6, 0.01, { color: [0.8, 0.8, 0.78] });
      B.bbox('tiles', 0, fy + fh / 2, 2.55, 4.5, 1.1, 0.12, 0.01, { color: pal.parapet, uv: 2.5 }); }
    B.bbox('concrete', 0, top, 1.3, 4.7, 0.16, 2.9, 0.02, { color: pal.trim });
  });
  if (pilotis && !podium) { // open ground floor at the far end: columns, a ceiling, parking bays under the building
    for (let u = nU - pilotis; u <= nU; u++) for (const zz of [-d / 2 + 0.3, d / 2 - 0.3]) B.bbox('concrete', -w / 2 + u * uw, 0, zz, 0.6, y0 + fh, 0.6, 0.02, { color: [0.8, 0.8, 0.78] });
    B.box('dark', -w / 2 + (nU - pilotis / 2) * uw, y0 + fh - 0.35, 0, pilotis * uw - 0.2, 0.02, d - 0.8, { color: [0.25, 0.25, 0.26] });
    B.box('lamp', -w / 2 + (nU - pilotis / 2) * uw, y0 + fh - 0.38, 0, 0.8, 0.03, 0.3);
    out.pilotis = { x0: -w / 2 + (nU - pilotis) * uw, x1: w / 2 };
  }
  const roofY = flatRoof(B, { w, d, y: H, para: 0.9, color: wall, wallMat: 'tiles', coping: pal.trim });
  for (let i = 0; i < 3; i++) acUnit(B, -w / 3 + i * 2.2, roofY, rng, { pipeTo: roofY + 0.4 });
  ex.push({ t: 'box', p: B.P([0, 0, 0]), hx: w / 2 + 0.2, hz: d / 2 + 1.8, r, h: H + 1 });
  out.footprint = [[-w / 2 - 3, -d / 2 - 4.6], [w / 2 + 0.3, d / 2 + 2]]; out.H = H;
  for (const e of out.lamps) lampPoints.push(e);
  B.frame(0, 0, 0, 0);
  return out;
}

// ---------------------------------------------------------------- the neighbourhood centre: shops on a podium, flats above
// An L of two legs meeting at the corner (x, z): leg A runs along +local x (length wa), leg B along -local z (length
// wb); the street faces (+z for A, -x for B) carry glazed shopfronts under a continuous canopy with fascia signs; two
// mansion wings stand back on the podium roof, whose open parts are a planted terrace.
const SHOPS = [['スーパーさくら', '#c8342c', '#fff', 0], ['ドラッグ桜川', '#1f5fa8', '#fff', 0], ['桜川クリニック', '#2a8a6a', '#fff', 3], ['ベーカリー こむぎ', '#8a5a30', '#fff3dc', 7],
  ['郵便局', '#d8302a', '#fff', 4], ['書店', '#333', '#f2e6c8', 6], ['カフェ はなみずき', '#5b7f3a', '#fff', 1], ['クリーニング', '#2f6ea6', '#fff', 3]];
export function centreBlock(B, s, rng, ex) {
  const { x, y, z, r, wa = 58, wb = 40, dp = 17, pal = PALETTES.brick } = s, PH = 4.6, out = { entrances: [], lamps: [], shopFronts: [] };
  B.frame(x, y, z, r);
  const legs = [{ cx: wa / 2, cz: -dp / 2, w: wa, d: dp, face: 0 }, { cx: dp / 2, cz: -dp - (wb - dp) / 2, w: wb - dp, d: dp, face: 1 }];
  // podium boxes: leg A (x 0..wa, z -dp..0), leg B (x 0..dp, z -wb..-dp)
  const box = (x0, x1, z0, z1) => { B.bbox('concrete', (x0 + x1) / 2, -0.4, (z0 + z1) / 2, x1 - x0, 0.5, z1 - z0, 0.02, { color: pal.base });
    B.bbox('tiles', (x0 + x1) / 2, 0.1, (z0 + z1) / 2, x1 - x0, PH - 0.1, z1 - z0, 0.02, { color: pal.wall, uv: 2.5 }); };
  box(0, wa, -dp, 0); box(0, dp, -wb, -dp);
  // podium roof: terrace paving with planters (the wings stand on it)
  B.box('pavement', wa / 2, PH, -dp / 2, wa - 0.3, 0.06, dp - 0.3, { color: [0.78, 0.76, 0.72], uv: 1.5 });
  B.box('pavement', dp / 2, PH, -dp - (wb - dp) / 2, dp - 0.3, 0.06, wb - dp - 0.3, { color: [0.78, 0.76, 0.72], uv: 1.5 });
  for (const [x0, x1, zz] of [[0.2, wa - 0.2, -0.1], [0.2, wa - 0.2, -dp + 0.1]]) B.bbox('concrete', (x0 + x1) / 2, PH, zz, x1 - x0, 1.05, 0.14, 0.01, { color: pal.parapet });
  for (const xx of [0.1, dp - 0.1]) B.bbox('concrete', xx, PH, -wb / 2, 0.14, 1.05, wb - 0.2, 0.01, { color: pal.parapet });
  // shopfronts along the two street faces
  const front = (len, place, faceR) => inFrame(B, place, faceR, () => {
    const n = Math.max(2, Math.round(len / 9)), sw = len / n;
    for (let i = 0; i < n; i++) {
      const x0 = -len / 2 + i * sw + 0.25, x1 = x0 + sw - 0.5, sh = SHOPS[((s.shopOffset || 0) + out.shopFronts.length) % SHOPS.length];
      B.quad('dark', [x0, 0.15, 0.02], [x1, 0.15, 0.02], [x1, 3.35, 0.02], [x0, 3.35, 0.02], { color: [0.12, 0.12, 0.12] });
      B.quad('shopWindow', [x0 + 0.05, 0.2, 0.05], [x1 - 0.05, 0.2, 0.05], [x1 - 0.05, 3.3, 0.05], [x0 + 0.05, 3.3, 0.05], { color: [1.1, 1, (sh[3] + 0.5) / 8], uvs: [[0, 0], [1, 0], [1, 1], [0, 1]] });
      for (let k = 0; k <= 4; k++) B.box('alu', x0 + (x1 - x0) * k / 4, 0.15, 0.08, 0.07, 3.2, 0.07, { color: [0.62, 0.64, 0.66] });
      B.box('alu', (x0 + x1) / 2, 2.5, 0.08, x1 - x0, 0.06, 0.07, { color: [0.62, 0.64, 0.66] });
      plate(B, (x0 + x1) / 2, 3.65, 0.62, 0, Math.min(sw - 1.2, 6.5), 0.62, (g, W2, H2) => { g.fillStyle = sh[1]; g.fillRect(0, 0, W2, H2); g.fillStyle = sh[2]; g.font = `bold ${H2 * 0.56}px ${JP_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(sh[0], W2 / 2, H2 * 0.55); }, 0.9, 512);
      out.shopFronts.push({ p: B.P([(x0 + x1) / 2, 0, 2.5]), name: sh[0] });
      out.entrances.push({ p: B.P([(x0 + x1) / 2, 0, 3.5]), out: [B.N([0, 0, 1])[0], B.N([0, 0, 1])[2]], kind: 'shop' });
    }
    // a continuous canopy with its fascia over the shopfronts, on slim columns at the kerb side
    B.bbox('metal', 0, 3.4, 1.4, len + 0.4, 0.2, 2.8, 0.02, { color: [0.3, 0.31, 0.33] });
    B.box('lamp', 0, 3.38, 1.4, len - 1, 0.02, 0.2);
    for (let xx = -len / 2 + 1; xx <= len / 2 - 1 + 1e-3; xx += len / Math.max(2, Math.round(len / 7))) B.cyl('steel', xx, 0.1, 2.65, 0.07, 0.07, 3.3, 10, { color: [0.3, 0.31, 0.33] });
    for (let xx = -len / 2 + 2; xx < len / 2; xx += 6) lampPoints.push({ p: B.P([xx, 3.1, 1.5]), s: 0.7 });
  });
  front(wa, [wa / 2, 0, 0], 0);
  front(wb, [0, 0, -wb / 2], -Math.PI / 2);
  B.frame(x, y, z, r);
  // wings above: set back from the street faces
  const cA = B.P([wa / 2 + 5, 0, -7]);
  const wA = mansion(B, { x: cA[0], y: y + PH, z: cA[2], r, w: wa - 14, d: 11, floors: 6, pal, podium: true, no: s.no, name: 'センタービル桜川' }, rng, ex);
  B.frame(x, y, z, r);
  const cB = B.P([7, 0, -dp - (wb - dp) / 2 - 1.5]);
  const wB = mansion(B, { x: cB[0], y: y + PH, z: cB[2], r: r - Math.PI / 2, w: wb - dp - 5, d: 11, floors: 5, pal, podium: true, no: s.no + 1, name: 'センタービル桜川' }, rng, ex);
  void wA; void wB;
  ex.push({ t: 'box', p: B.P([wa / 2, 0, -dp / 2]), hx: wa / 2, hz: dp / 2, r, h: PH });
  ex.push({ t: 'box', p: B.P([dp / 2, 0, -dp - (wb - dp) / 2]), hx: dp / 2, hz: (wb - dp) / 2, r, h: PH });
  for (const e of out.lamps) lampPoints.push(e);
  B.frame(0, 0, 0, 0);
  return out;
}

// ---------------------------------------------------------------- 2-storey terraced flats (アパート)
const APATO = ['コーポ桜', 'ハイツ川辺', 'メゾン花水木', 'グリーンハイツ', 'コーポ田園', 'ハイム東雲', 'サンライズ桜川', 'レジデンス若葉'];
export function lowRise(B, s, rng, ex) {
  const { x, y, z, r, w, d = 8.2, pal = PALETTES.cream } = s, fh = 2.75, y0 = 0.45, H = y0 + 2 * fh, out = { entrances: [], lamps: [] };
  const nU = Math.max(3, Math.round(w / 6)), uw = w / nU, wall = jit(rng, pal.wall, 0.03), mat = rng() < 0.5 ? 'siding' : 'stucco';
  B.frame(x, y, z, r);
  B.bbox('concrete', 0, -0.4, 0, w + 0.1, 0.85, d + 0.1, 0.02, { color: [0.62, 0.62, 0.6] });
  const front = [], back = [];
  for (let f = 0; f < 2; f++) for (let u = 0; u < nU; u++) {
    const fy = y0 + f * fh, cx = -w / 2 + (u + 0.5) * uw;
    front.push({ x0: cx - 1.5, x1: cx - 0.7, y0: fy + 0.02, y1: fy + 2.05, d: 0.12, door: true }, { x0: cx + 0.2, x1: cx + 1.4, y0: fy + 1.05, y1: fy + 1.95, d: 0.12 });
    back.push({ x0: -cx - 2.0, x1: -cx + 0.6, y0: fy + 0.05, y1: fy + 2.0, d: 0.16 }, { x0: -cx + 1.2, x1: -cx + 2.2, y0: fy + 1.0, y1: fy + 1.9, d: 0.14 });
  }
  boxWalls(B, 0, w, d, y0, H + 0.1, [[mat, wall, mat === 'siding' ? 3 : 2.5]], fi => fi === 0 ? front : fi === 1 ? back : [], mul(wall, 0.94));
  const rc = pick(rng, [[0.3, 0.34, 0.4], [0.42, 0.28, 0.24], [0.28, 0.36, 0.3], [0.36, 0.36, 0.38]]);
  hipRoof(B, { w: w + 0.2, d: d + 0.2, y: H + 0.1, pitch: 0.28, over: 0.55, mat: 'roofMetal', color: rc });
  // front: doors on both floors, the upper floor reached by a gallery and an open steel stair at one end
  inFrame(B, [0, 0, d / 2], 0, () => {
    for (const h of front) { if (h.door) doorUnit(B, h, { color: jit(rng, [0.62, 0.55, 0.46], 0.08), mat: 'metal' }); else windowUnit(B, h, { rng, grille: true, frosted: rng() < 0.5 }); }
    const gy = y0 + fh, gc = pick(rng, [[0.3, 0.32, 0.36], [0.55, 0.3, 0.26], [0.86, 0.85, 0.82]]);
    // the gallery runs on past the end wall to the stair landing
    B.bbox('concrete', 0.6, gy - 0.16, 0.65, w + 1.2, 0.16, 1.3, 0.01, { color: [0.78, 0.78, 0.76] });
    B.bbox('metal', 0.1, gy + 0.98, 1.28, w + 0.2, 0.06, 0.06, 0.008, { color: gc });
    B.detail(1, () => { for (let xx = -w / 2 + 0.1; xx <= w / 2 + 0.2; xx += 0.12) B.box('metal', xx, gy, 1.28, 0.02, 0.98, 0.02, { color: gc }); });
    for (let xx = -w / 2 + 0.1; xx <= w / 2; xx += w / Math.ceil(w / 4)) B.box('metal', xx, 0, 1.25, 0.09, gy, 0.09, { color: gc });
    // stair: one straight flight along the gable end, rising from behind toward the gallery; steel stringers and treads
    const sx = w / 2 + 0.7, n = 14, zs = -3.4;
    for (let i = 0; i < n; i++) B.box('metal', sx, (i + 1) * gy / n - 0.04, zs + (i + 0.5) * 0.26, 1.0, 0.04, 0.26, { color: mul(gc, 1.1) });
    for (const e of [-0.52, 0.52]) { B.beam('metal', [sx + e, 0.02, zs], [sx + e, gy, zs + n * 0.26], 0.04, 0.2, { color: gc }); B.beam('metal', [sx + e, 0.92, zs], [sx + e, gy + 0.92, zs + n * 0.26], 0.03, 0.03, { color: gc }); }
    B.box('metal', sx, gy - 0.12, 0.3 + 0.35, 1.2, 0.12, 1.3, { color: gc });                                        // landing
    B.box('metal', sx + 0.55, 0, 1.25, 0.08, gy, 0.08, { color: gc });
    for (let u = 0; u < nU; u++) { B.box('lamp', -w / 2 + (u + 0.5) * uw - 1.1, gy + 2.35, 0.2, 0.18, 0.12, 0.08); lampPoints.push({ p: B.P([-w / 2 + (u + 0.5) * uw - 1.1, gy + 2.2, 0.4]), s: 0.25 });
      meterBox(B, -w / 2 + (u + 0.5) * uw - 1.9, y0 + 1.4, 'power'); }
    plate(B, -w / 2 + 1.4, 1.6, 0.03, 0, 1.4, 0.36, (g, W2, H2) => { g.fillStyle = '#f5f1e6'; g.fillRect(0, 0, W2, H2); g.fillStyle = '#4a3a2c'; g.font = `bold ${H2 * 0.55}px ${JP_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(s.name || pick(rng, APATO), W2 / 2, H2 * 0.55); }, 0.15, 256);
    out.entrances.push({ p: B.P([0, 0, 2.6]), out: [B.N([0, 0, 1])[0], B.N([0, 0, 1])[2]], kind: 'gallery' });
  });
  // back: small balconies on the upper floor, garden fences on the ground floor
  inFrame(B, [0, 0, -d / 2], Math.PI, () => {
    for (const h of back) windowUnit(B, h, { rng, type: 'slide', sill: false, shutterBox: rng() < 0.4 });
    for (let u = 0; u < nU; u++) { const cx = -(-w / 2 + (u + 0.5) * uw);
      balconyRun(B, rng, cx - 2.3, cx + 0.9, y0 + fh, 0.9, { kind: 'rail', trim: [0.4, 0.42, 0.44], fh, laundry: 0.5 });
      balconyRun(B, rng, cx - uw / 2 + 0.1, cx + uw / 2 - 0.1, y0, 1.0, { ground: true, trim: [0.55, 0.56, 0.56] }); }
  });
  ex.push({ t: 'box', p: B.P([0, 0, 0.3]), hx: w / 2 + 1.2, hz: d / 2 + 1.3, r, h: H + 1 });
  out.footprint = [[-w / 2 - 1.3, -d / 2 - 2.2], [w / 2 + 1.3, d / 2 + 1.4]]; out.H = H;
  B.frame(0, 0, 0, 0);
  return out;
}
