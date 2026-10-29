// Math and noise with no engine behind them: shared by the engine (core.js re-exports them), the stage configs and the
// stage preparation worker (prep.worker.js), so a stage's ground is the same function wherever it is computed.
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

let SEED = 20260926;
export function setSeed(s) { SEED = s | 0; }
export function hash2(ix, iy) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + SEED) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const _n = [0, 0, 0];
// value noise in [-1,1] with analytic derivatives
export function noised(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const dux = 30 * fx * fx * (fx * (fx - 2) + 1), duy = 30 * fy * fy * (fy * (fy - 2) + 1);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  const k1 = b - a, k2 = c - a, k4 = a - b - c + d;
  _n[0] = 2 * (a + k1 * ux + k2 * uy + k4 * ux * uy) - 1;
  _n[1] = 2 * dux * (k1 + k4 * uy);
  _n[2] = 2 * duy * (k2 + k4 * ux);
  return _n;
}
export function fbm(x, y, oct) {
  let a = 0, b = 0.5, n = 0;
  for (let i = 0; i < oct; i++) {
    a += b * noised(x, y)[0]; n += b; b *= 0.5;
    const nx = 1.6 * x - 1.2 * y, ny = 1.2 * x + 1.6 * y; x = nx + 1.7; y = ny - 3.1;
  }
  return a / n;
}
// derivative-damped fbm: eroded-looking ridges and valleys
export function erosion(x, y, oct = 8) {
  let a = 0, b = 1, dx = 0, dy = 0, n = 0;
  for (let i = 0; i < oct; i++) {
    const r = noised(x, y);
    dx += r[1]; dy += r[2];
    a += b * r[0] / (1 + dx * dx + dy * dy);
    n += b; b *= 0.5;
    const nx = 1.6 * x - 1.2 * y, ny = 1.2 * x + 1.6 * y; x = nx; y = ny;
  }
  return a / n;
}
