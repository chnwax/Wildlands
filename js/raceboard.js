// The race board in Sakuragawa: an event board on the open lot beside road B, where the town's races are posted — a
// steel frame under a small canopy, the poster lit from behind at night and by two floodlights, a gravel pad with tyre
// stacks and cones, a flag on a pole, and the event's car on display. Walk (or drive) up to it: within reach a prompt
// asks for E, and the race selection opens (main.js, raceui.js).
import { THREE, scene, addBox, addCircle, mulberry32, lampPoints, clamp } from './core.js';
import { RACES } from './races.js';
import { stageLine } from './raceui.js';
import { env } from './sky.js';

const REACH = 4.6;
export function buildRaceBoard(world, { x, z, yaw }) {
  const g = new THREE.Group(); g.name = 'race-board'; g.position.set(x, world.groundAt(x, z), z); g.rotation.y = yaw; scene.add(g);
  const at = (lx, lz) => { const c = Math.cos(yaw), s = Math.sin(yaw); return [x + lx * c + lz * s, z - lx * s + lz * c]; };
  const gy = (lx, lz) => { const [wx, wz] = at(lx, lz); return world.groundAt(wx, wz) - g.position.y; };
  const steel = new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.45, metalness: 0.75 }), dark = new THREE.MeshStandardMaterial({ color: 0x16191e, roughness: 0.6, metalness: 0.4 });
  const box = (w, h, d, m, px, py, pz) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(px, py, pz); o.castShadow = true; o.receiveShadow = true; g.add(o); return o; };
  // ---- the pad: compacted gravel, a kerb round it
  const pad = new THREE.Mesh(new THREE.CircleGeometry(6.2, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x8b8378, roughness: 0.96 }));
  pad.position.set(0, Math.max(gy(0, 0), gy(3, 2), gy(-3, 2), gy(3, -2), gy(-3, -2)) + 0.03, 1.2); pad.receiveShadow = true; g.add(pad);
  const py = pad.position.y;
  // ---- the frame: two posts, the panel's box, the canopy over it
  const W = 4.4, Hp = 2.5, base = py + 0.9;
  for (const sx of [-1, 1]) { box(0.16, base + Hp + 0.6 - py, 0.16, steel, sx * (W / 2 + 0.12), (base + Hp + 0.6 + py) / 2, 0); box(0.5, 0.1, 0.5, dark, sx * (W / 2 + 0.12), py + 0.05, 0); }
  box(W + 0.36, Hp + 0.24, 0.22, dark, 0, base + Hp / 2, -0.06);
  const roof = box(W + 1.1, 0.08, 1.3, steel, 0, base + Hp + 0.62, 0.35); roof.rotation.x = -0.08;
  const led = new THREE.Mesh(new THREE.BoxGeometry(W + 0.9, 0.035, 0.05), new THREE.MeshStandardMaterial({ color: 0xffe2a8, emissive: 0xffd58a, emissiveIntensity: 0.6 })); led.position.set(0, base + Hp + 0.55, 0.95); g.add(led);
  // ---- the poster: the six races, each its route drawn, its name, surface and length (redrawn as the routes come in)
  const cv = document.createElement('canvas'); cv.width = 2048; cv.height = 1164;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const poster = new THREE.Mesh(new THREE.PlaneGeometry(W, Hp), new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.12, roughness: 0.55 }));
  poster.position.set(0, base + Hp / 2, 0.06); poster.receiveShadow = true; g.add(poster);
  const routes = new Map();
  const draw = () => { const c = cv.getContext('2d'), Wc = cv.width, Hc = cv.height;
    const bg = c.createLinearGradient(0, 0, 0, Hc); bg.addColorStop(0, '#0e1420'); bg.addColorStop(1, '#1a1622'); c.fillStyle = bg; c.fillRect(0, 0, Wc, Hc);
    c.fillStyle = '#d9b56a'; c.fillRect(0, 0, Wc, 10); c.fillRect(0, Hc - 10, Wc, 10);
    for (let i = 0; i < 40; i++) { c.fillStyle = i % 2 ? '#f2efe6' : '#111'; c.fillRect(Wc - 360 + (i % 20) * 18, 36 + Math.floor(i / 20) * 18, 18, 18); }
    c.fillStyle = '#f2efe6'; c.font = '300 92px "Segoe UI", system-ui, sans-serif'; c.textBaseline = 'alphabetic'; c.fillText('W Y Ś C I G I', 60, 120);
    c.fillStyle = '#d9b56a'; c.font = '600 44px "Yu Mincho", "Noto Serif JP", serif'; c.fillText('桜川 モータースポーツ', 64, 178);
    c.fillStyle = 'rgba(242,239,230,.6)'; c.font = '400 30px "Segoe UI", sans-serif'; c.fillText('Wybierz trasę i samochód · E', 860, 116);
    const cw = (Wc - 60 * 2 - 40 * 2) / 3, ch = (Hc - 240 - 60 - 40) / 2;
    RACES.forEach((r, k) => { const cx = 60 + (k % 3) * (cw + 40), cy = 230 + Math.floor(k / 3) * (ch + 40);
      c.fillStyle = 'rgba(255,255,255,.05)'; c.fillRect(cx, cy, cw, ch); c.strokeStyle = 'rgba(242,239,230,.22)'; c.lineWidth = 3; c.strokeRect(cx, cy, cw, ch);
      c.fillStyle = 'rgba(255,255,255,.22)'; c.font = '600 70px "Yu Mincho", serif'; c.fillText(r.kanji, cx + 20, cy + 76);
      c.fillStyle = '#f2efe6'; c.font = '600 46px "Segoe UI", sans-serif'; c.fillText(r.name.toUpperCase(), cx + 20, cy + ch - 72);
      c.fillStyle = r.surface === 'gravel' ? '#e0b77a' : '#9fc3e0'; c.font = '400 32px "Segoe UI", sans-serif'; c.fillText((r.surface === 'gravel' ? 'szuter' : 'asfalt') + ' · ' + (r.length / 1000).toFixed(1) + ' km · ' + (r.field + 1) + ' aut', cx + 20, cy + ch - 26);
      const L = routes.get(r.id); if (!L) return;
      let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (const [px, pz] of L.P) { x0 = Math.min(x0, px); z0 = Math.min(z0, pz); x1 = Math.max(x1, px); z1 = Math.max(z1, pz); }
      const bx = cx + cw * 0.38, by = cy + 22, bw = cw * 0.58, bh = ch - 150, s = Math.min(bw / (x1 - x0), bh / (z1 - z0)), mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      c.beginPath(); for (let i = 0; i < L.n; i += 4) { const u = bx + bw / 2 - (L.P[i][0] - mx) * s, v = by + bh / 2 - (L.P[i][1] - mz) * s; i ? c.lineTo(u, v) : c.moveTo(u, v); }
      c.lineCap = c.lineJoin = 'round'; c.strokeStyle = 'rgba(217,181,106,.35)'; c.lineWidth = 16; c.stroke(); c.strokeStyle = '#f2efe6'; c.lineWidth = 6; c.stroke(); });
    tex.needsUpdate = true; };
  draw();
  (async () => { for (const r of RACES) { try { routes.set(r.id, await stageLine(r)); draw(); } catch (e) {} await new Promise(q => setTimeout(q, 120)); } })();
  // ---- floodlights on the canopy's front edge, aimed at the poster; lamps for the town's night lighting (citylights.js)
  const lampM = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xfff1d6, emissiveIntensity: 0 });
  for (const sx of [-1.2, 1.2]) { const f = box(0.34, 0.16, 0.24, dark, sx, base + Hp + 0.48, 1.05); f.rotation.x = 0.6; const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.12), lampM); lens.position.set(sx, base + Hp + 0.42, 1.12); lens.rotation.x = Math.PI + 0.9; g.add(lens);
    const [wx, wz] = at(sx, 1.3); lampPoints.push({ p: [wx, g.position.y + base + Hp * 0.6, wz], s: 0.5, c: [1, 0.95, 0.85] }); }
  if (world.layer && world.layer.refreshLights) { world.layer.dirtyLights = true; world.layer.refreshLights(); }
  // ---- the pad's dressing: tyre stacks, cones, a flag
  const rng = mulberry32(4242), tyreG = new THREE.TorusGeometry(0.29, 0.11, 8, 18).rotateX(Math.PI / 2), tyreM = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
  const coneG = new THREE.ConeGeometry(0.17, 0.5, 14).translate(0, 0.25, 0), coneM = new THREE.MeshStandardMaterial({ color: 0xff6a12, roughness: 0.6 });
  for (const [lx, lz, n] of [[-3.6, 2.6, 4], [3.7, 2.2, 3], [-4.2, -0.4, 5]]) { for (let k = 0; k < n; k++) { const t = new THREE.Mesh(tyreG, tyreM); t.position.set(lx + (rng() - 0.5) * 0.05, py + 0.11 + k * 0.2, lz); t.castShadow = t.receiveShadow = true; g.add(t); }
    const [wx, wz] = at(lx, lz); addCircle(wx, wz, 0.45, g.position.y + py - 0.2, g.position.y + py + n * 0.2); }
  for (const [lx, lz] of [[-2.2, 4.4], [-0.8, 5.1], [0.8, 5.1], [2.2, 4.4]]) { const o = new THREE.Mesh(coneG, coneM); o.position.set(lx, py, lz); o.castShadow = true; g.add(o); }
  const pole = box(0.06, 5.2, 0.06, steel, 4.6, py + 2.6, -0.8);
  const flagCv = document.createElement('canvas'); flagCv.width = 256; flagCv.height = 160; { const f = flagCv.getContext('2d'); for (let i = 0; i < 8; i++) for (let j = 0; j < 5; j++) { f.fillStyle = (i + j) % 2 ? '#f2f2ee' : '#151515'; f.fillRect(i * 32, j * 32, 32, 32); } }
  const flagT = new THREE.CanvasTexture(flagCv); flagT.colorSpace = THREE.SRGBColorSpace;
  const flagG = new THREE.PlaneGeometry(1.3, 0.8, 12, 4); flagG.translate(0.65, 0, 0);
  const flag = new THREE.Mesh(flagG, new THREE.MeshStandardMaterial({ map: flagT, side: THREE.DoubleSide, roughness: 0.8 })); flag.position.set(4.63, py + 4.7, -0.8); flag.castShadow = true; flag.userData.dynamic = true; g.add(flag);
  const flag0 = flagG.attributes.position.array.slice();
  // (the walker bumps into the frame, not through it)
  { const [wx, wz] = at(0, -0.06); addBox(wx, wz, W / 2 + 0.25, 0.2, yaw, g.position.y + py - 0.5, g.position.y + base + Hp + 0.7); const [px, pz] = at(4.6, -0.8); addCircle(px, pz, 0.1); }
  g.updateMatrixWorld(true);
  // ---- the car on display (the event's car: added once its model is cached; a static copy, no physics)
  let shown = null;
  const display = async id => {
    const { loadCarModel, CAR_DEFS } = await import('./car.js'); const m = await loadCarModel(id).catch(() => null); if (!m || shown) return;
    const car = m.scene.clone(true), def = CAR_DEFS[id], H = new THREE.Group(); H.name = 'race-board-car'; H.add(car);
    const lx = -0.6, lz = 3.4, [wx, wz] = at(lx, lz); H.position.set(lx, py, lz); H.rotation.y = 2.2; g.add(H);
    g.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(car); car.position.y += g.position.y + py - b.min.y + 0.01; g.updateMatrixWorld(true); // (its tyres on the pad)
    addBox(wx, wz, def.spec.dims[0] / 2, def.spec.dims[2] / 2, yaw + 2.2, g.position.y + py - 0.2, g.position.y + py + 1.4);
    shown = H; };
  let t = 0;
  const [px0, pz0] = at(0, 1.8), pos = new THREE.Vector3(px0, 0, pz0); // (where the player stands to read it)
  return { group: g, pos, display,
    near: p => Math.hypot(p.x - pos.x, p.z - pos.z) < REACH,
    distance: p => Math.hypot(p.x - pos.x, p.z - pos.z),
    update(dt) { t += dt; const night = clamp(env.night || 0, 0, 1);
      poster.material.emissiveIntensity = 0.12 + 0.9 * night; lampM.emissiveIntensity = 0.2 + 2.6 * night; led.material.emissiveIntensity = 0.5 + 1.5 * night;
      const a = flagG.attributes.position.array; for (let i = 0; i < a.length; i += 3) { const u = flag0[i] / 1.3; a[i + 2] = Math.sin(t * 5 + u * 6) * 0.08 * u; a[i + 1] = flag0[i + 1] - u * u * 0.04; } flagG.attributes.position.needsUpdate = true; flag.updateMatrixWorld(true); },
  };
}
