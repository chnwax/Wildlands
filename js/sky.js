// Sky, clouds, stars, moon, sun/moon light and the day-night cycle — hand-painted, anime style.
// Everything is driven by an art-directed palette keyed on the time of day (vivid noon blue, peach sunrise, orange and
// pink sunset, violet dusk, deep blue night): the sky gradient, sunlight, coloured shadow fill, haze, clouds and exposure
// are all interpolated from the same keyframes, so every hour looks like one painting.
import { THREE, renderer, scene, camera, S, sunDir, fogU, Q, clamp, lerp, smoothstep, mulberry32, withStandardDepth, geometryView } from './core.js';
import { buildClouds, cloudShadow, cloudU, cloudPal } from './clouds.js';

export const time = { hour: 16.4, running: true, speed: 1 / 60 }; // game hours per real second (1 day = 24 min)
const up = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------- palette
// zen/hor: sky gradient, glow: sun-side horizon glow, gnd: ground bounce / below-horizon, fog: distance haze,
// sun: sunlight colour & intensity, cLit/cShade: cloud colours, glowAmt: strength of the sun glow, exp: exposure,
// fogD / haze: base fog and distance haze (aerial perspective) multipliers — hazy dawn and golden hour, crisp midday
const KEYS = [
  [0.0, { zen: '#060b26', hor: '#1f2f63', glow: '#33488a', gnd: '#05070f', fog: '#0b1231', sun: '#ffe8c0', sunI: 0, cLit: '#56689e', cShade: '#161f44', glowAmt: 0.2, exp: 1.12, fogD: 1.0, haze: 0.8 }],
  [4.7, { zen: '#0f1c4a', hor: '#5a5596', glow: '#c4739e', gnd: '#171a36', fog: '#3d3f78', sun: '#ff9f66', sunI: 0, cLit: '#9a86c0', cShade: '#2e3066', glowAmt: 0.6, exp: 1.2, fogD: 1.25, haze: 1.1 }],
  [5.9, { zen: '#3056a0', hor: '#ffb690', glow: '#ff7f62', gnd: '#4a3a55', fog: '#e0a3a0', sun: '#ff9f66', sunI: 1.5, cLit: '#ffc9a8', cShade: '#8272b0', glowAmt: 1.0, exp: 1.05, fogD: 1.55, haze: 1.35 }],
  [7.2, { zen: '#3a8ae6', hor: '#d2ecff', glow: '#fff0c8', gnd: '#5d6b4a', fog: '#bfdcf6', sun: '#ffe6bd', sunI: 2.6, cLit: '#ffffff', cShade: '#a4b6de', glowAmt: 0.45, exp: 1.0, fogD: 1.3, haze: 1.15 }],
  [9.4, { zen: '#2f7fe8', hor: '#c4e6ff', glow: '#fff6dc', gnd: '#60784a', fog: '#b8dcf8', sun: '#fff1da', sunI: 2.85, cLit: '#ffffff', cShade: '#a8badf', glowAmt: 0.35, exp: 1.0, fogD: 0.95, haze: 0.9 }],
  [12.5, { zen: '#1e70e6', hor: '#aee0ff', glow: '#fffbe8', gnd: '#62804a', fog: '#aad6fb', sun: '#fff7e6', sunI: 3.0, cLit: '#ffffff', cShade: '#aebfe6', glowAmt: 0.3, exp: 1.0, fogD: 0.75, haze: 0.72 }],
  [15.8, { zen: '#2874dc', hor: '#c2e4ff', glow: '#fff3d4', gnd: '#647a48', fog: '#b6dafa', sun: '#fff1d6', sunI: 2.9, cLit: '#ffffff', cShade: '#b0bee2', glowAmt: 0.4, exp: 1.0, fogD: 0.95, haze: 1.0 }],
  [17.2, { zen: '#3b72cc', hor: '#ffe0a8', glow: '#ffb462', gnd: '#6e5c42', fog: '#f3cfa4', sun: '#ffc47a', sunI: 2.6, cLit: '#fff1d8', cShade: '#b4a4cc', glowAmt: 0.9, exp: 1.0, fogD: 1.15, haze: 1.2 }],
  [17.95, { zen: '#354a9e', hor: '#ffa070', glow: '#ff6258', gnd: '#4e3a4c', fog: '#e6918a', sun: '#ff7e48', sunI: 1.8, cLit: '#ffb894', cShade: '#8f6eac', glowAmt: 1.2, exp: 1.05, fogD: 1.25, haze: 1.3 }],
  [18.55, { zen: '#1b2663', hor: '#8e5d9e', glow: '#dc6a86', gnd: '#1d1b36', fog: '#4f3f78', sun: '#ff7e48', sunI: 0, cLit: '#c982a6', cShade: '#3c326e', glowAmt: 0.8, exp: 1.15, fogD: 1.05, haze: 1.05 }],
  [19.4, { zen: '#060b26', hor: '#1f2f63', glow: '#33488a', gnd: '#05070f', fog: '#0b1231', sun: '#ffe8c0', sunI: 0, cLit: '#56689e', cShade: '#161f44', glowAmt: 0.2, exp: 1.12, fogD: 0.9, haze: 0.8 }],
];
const COLS = ['zen', 'hor', 'glow', 'gnd', 'fog', 'sun', 'cLit', 'cShade'], NUMS = ['sunI', 'glowAmt', 'exp', 'fogD', 'haze'];
const PAL = KEYS.map(([h, k]) => { const o = { h }; for (const c of COLS) o[c] = new THREE.Color(k[c]); for (const n of NUMS) o[n] = k[n]; return o; });
export const pal = {}; for (const c of COLS) pal[c] = new THREE.Color(); for (const n of NUMS) pal[n] = 0;
function samplePalette(hour) {
  let i = PAL.length - 1;
  for (let k = 0; k < PAL.length; k++) if (PAL[k].h > hour) { i = k - 1; break; }
  const a = PAL[Math.max(i, 0)], b = PAL[Math.min(i + 1, PAL.length - 1)] ?? a;
  let t = b.h > a.h ? (hour - a.h) / (b.h - a.h) : 0;
  t = t * t * (3 - 2 * t);
  if (hour >= PAL[PAL.length - 1].h) { const n = PAL[PAL.length - 1]; for (const c of COLS) pal[c].copy(n[c]); for (const x of NUMS) pal[x] = n[x]; return pal; }
  for (const c of COLS) pal[c].copy(a[c]).lerp(b[c], t);
  for (const x of NUMS) pal[x] = lerp(a[x], b[x], t);
  return pal;
}

// ---------------------------------------------------------------- celestial sphere (stars + Milky Way rotate about the pole)
const TILT = 0.62; // the sun path's tilt from vertical, i.e. latitude ~35.5°N
// the sun turns about axis = e1 x e2 of its path plane; the stars turn with it by the same angle
export const celestial = { q: new THREE.Quaternion(), inv: new THREE.Matrix3(), axis: new THREE.Vector3() };
const celM4 = new THREE.Matrix4();
function updateCelestial(th) {
  celestial.axis.set(0, -Math.sin(TILT), Math.cos(TILT)).applyAxisAngle(up, env.azimuth);
  celestial.q.setFromAxisAngle(celestial.axis, th);
  celestial.inv.setFromMatrix4(celM4.makeRotationFromQuaternion(celestial.q)).transpose(); // world -> celestial frame
}

// ---------------------------------------------------------------- sky dome: painted gradient, glowing sun, night sky
const skyU = {
  tNoise: S.tNoise, tMoon: { value: makeMoonTexture() }, uTime: S.uTime, uSunDir: S.uSunDir,
  uZen: { value: pal.zen }, uHor: { value: pal.hor }, uGlow: { value: pal.glow }, uGnd: { value: pal.gnd }, uGlowAmt: { value: 0 },
  uSunDisk: { value: new THREE.Vector3() }, uMoonDir: { value: new THREE.Vector3() }, uMoonGlow: { value: new THREE.Vector3() }, uMoonDisk: { value: new THREE.Vector3() }, uMoonVis: { value: 0 }, uMoonU: { value: new THREE.Vector3(1, 0, 0) }, uMoonV: { value: new THREE.Vector3(0, 1, 0) },
  uNightSky: { value: 0 }, uCel: { value: celestial.inv },
  uTown: { value: new THREE.Vector4() }, uTownCol: { value: new THREE.Vector3(1.0, 0.6, 0.34) },
};
// light pollution over the town: centre (x, z), radius and strength, set by the map; followCamera makes it camera-relative
const townGlow = { x: 0, z: 0, r: 0, s: 0 };
export function setTownGlow(x, z, r, s) { Object.assign(townGlow, { x, z, r, s }); }
const skyMat = new THREE.ShaderMaterial({
  uniforms: skyU, side: THREE.BackSide, depthWrite: false, fog: false,
  vertexShader: /* glsl */`
    varying vec3 vW;
    void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w;
      #ifdef USE_REVERSEDEPTHBUF
        gl_Position.z = 0.0;           // on the far plane (reversed depth: far = 0)
      #else
        gl_Position.z = gl_Position.w;
      #endif
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tNoise, tMoon; uniform float uTime, uNightSky, uGlowAmt, uMoonVis; uniform vec3 uSunDir, uSunDisk, uMoonDir, uMoonGlow, uMoonDisk, uMoonU, uMoonV, uZen, uHor, uGlow, uGnd, uTownCol; uniform mat3 uCel; uniform vec4 uTown;
    varying vec3 vW;
    const float PI = 3.14159265359;
    void main(){
      vec3 d = normalize(vW - cameraPosition);
      float t = 1.0 - max(d.y, 0.0);
      // broad zenith colour easing into a luminous horizon band
      vec3 col = mix(uZen, uHor, pow(t, 3.2));
      col = mix(col, uHor * 1.06 + uGlow * 0.04, pow(t, 18.0));
      // the sun side of the sky glows warm
      float mu = dot(d, uSunDir);
      float side = pow(mu * 0.5 + 0.5, 5.0);
      col += uGlow * uGlowAmt * (pow(max(mu, 0.0), 7.0) * 0.55 + side * 0.3) * mix(0.3, 1.0, pow(t, 2.5));
      // below the horizon: melt into the haze, then the ground bounce colour
      col = mix(col, mix(uHor, uGnd, 0.55), smoothstep(0.0, -0.3, d.y));
      // stylised sun: a crisp disc with a soft halo
      float ang = acos(clamp(mu, -1.0, 1.0));
      float above = smoothstep(-0.03, 0.01, d.y);
      col += uSunDisk * ((1.0 - smoothstep(0.021, 0.025, ang)) * 5.0 + exp(-ang * 26.0) * 0.55 + exp(-ang * 7.0) * 0.12) * above;
      // night: Milky Way and moon halo
      if (uNightSky > 0.001) {
        vec3 c = uCel * d;
        vec3 gN = normalize(vec3(0.35, 0.87, 0.34)), gC = normalize(vec3(0.82, -0.2, -0.53));
        float b = dot(c, gN);
        float lon = atan(c.z, c.x);
        vec2 guv = vec2(lon / (2.0 * PI) * 6.0, b * 3.2);
        vec4 n1 = texture2D(tNoise, guv), n2 = texture2D(tNoise, guv * 3.1 + 0.37);
        float core = pow(max(dot(c, gC), 0.0), 4.0);
        float band = exp(-b * b * mix(50.0, 16.0, core)) * (0.3 + 0.7 * n1.r) * (0.6 + 0.9 * core);
        float dust = smoothstep(0.52, 0.72, n2.g * 0.7 + n1.b * 0.5) * exp(-b * b * 300.0);
        band *= 1.0 - 0.7 * dust;
        // painterly: violet and teal nebula tints along the band
        vec3 mw = band * mix(mix(vec3(0.35, 0.45, 1.0), vec3(0.75, 0.4, 1.0), n2.b), vec3(1.0, 0.8, 0.6), core) * 0.07;
        col += mw * smoothstep(-0.02, 0.35, d.y) * uNightSky;
        float mm = max(dot(d, uMoonDir), 0.0);
        col += uMoonGlow * (pow(mm, 300.0) * 1.2 + pow(mm, 30.0) * 0.25 + pow(mm, 5.0) * 0.06) * uNightSky;
        // The moon is painted by the sky itself, at infinity: no geometry, so nothing to depth-fight, sort against the
        // clouds or lag a frame behind the camera (the former moon was a transparent 260 m card 9 km away, re-aimed
        // after the camera moved and sorted against the cloud layers — it flickered and swapped layers while turning).
        // Its texture axes (uMoonU/V) come from the moon's orbit (updateSky), so the disc never flips orientation as it
        // passes overhead. A 3° disc: the large, painted moon of an anime night sky.
        float md = dot(d, uMoonDir);
        vec2 muv = vec2(dot(d, uMoonU), dot(d, uMoonV)) / max(md, 0.001) / 0.0524 + 0.5;
        float inMoon = step(0.0, min(min(muv.x, muv.y), min(1.0 - muv.x, 1.0 - muv.y))) * step(0.0, md);
        vec4 moonTex = texture2D(tMoon, clamp(muv, 0.0, 1.0));
        col = mix(col, moonTex.rgb * uMoonDisk, moonTex.a * inMoon * uMoonVis);
      }
      // light pollution: a faint warm dome low over the lit town — in its direction from outside, all round from within,
      // weaker the farther away the town is
      if (uTown.w > 0.0) {
        float dist = length(uTown.xy), inside = 1.0 - smoothstep(uTown.z * 0.5, uTown.z * 1.1, dist);
        vec2 hd = normalize(d.xz + vec2(1e-5));
        float ca = dot(hd, uTown.xy / max(dist, 1e-3)), wid = min(atan(uTown.z, max(dist, 1.0)) * 1.3 + 0.15, 3.0);
        float az = mix(smoothstep(cos(wid), 1.0, ca), 1.0, inside);
        float alt = exp(-max(d.y, 0.0) * mix(10.0, 5.0, inside)) * smoothstep(-0.12, 0.0, d.y);
        float fall = uTown.z * uTown.z / (uTown.z * uTown.z + dist * dist * 0.6);
        col += uTownCol * uTown.w * az * alt * fall;
      }
      gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
    }`,
});
export const sky = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), skyMat);
sky.scale.setScalar(20000); sky.frustumCulled = false;
sky.renderOrder = 1e6; // last opaque: only shades sky pixels that nothing covers
sky.userData.dynamic = true; scene.add(sky);
// the environment capture renders the sky with standard depth (PMREM): its own material (same uniforms and shaders), so
// neither pass ever switches the other's program — a shared material would relink both every time the ambient updates
const skyEnvMat = new THREE.ShaderMaterial({ uniforms: skyU, vertexShader: skyMat.vertexShader, fragmentShader: skyMat.fragmentShader, side: THREE.BackSide, depthWrite: false, fog: false });
const skyScene = new THREE.Scene(); const skyClone = new THREE.Mesh(sky.geometry, skyEnvMat); skyClone.scale.setScalar(100); skyScene.add(skyClone);
const pmrem = new THREE.PMREMGenerator(renderer);
let envRT = null;
// PMREM of the sky into one persistent target: fromScene allocates a new target (a new texture) every call, which makes
// every lit material look its program up again and churns GPU memory; re-filtering in place keeps the texture
// PMREM also draws a solid-colour backdrop box with a MeshBasicMaterial it creates and disposes on every call; disposing
// it releases the last user of that program, so three deleted it and compiled it again each update (~28 ms). A permanent
// twin of that material, drawn once the same way, keeps the program alive.
const pmremKeep = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ side: THREE.BackSide, depthWrite: false, depthTest: false }));
const pmremCam = new THREE.PerspectiveCamera(90, 1, 0.1, 100), keepRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
function regenEnv() {
  if (!envRT) {
    const rt0 = renderer.getRenderTarget(); renderer.setRenderTarget(keepRT); renderer.render(pmremKeep, pmremCam); renderer.setRenderTarget(rt0);
    envRT = pmrem.fromScene(skyScene, 0.04); return;
  }
  const rt0 = renderer.getRenderTarget();
  pmrem._setSize(256);
  pmrem._sceneToCubeUV(skyScene, 0.1, 100, envRT);
  pmrem._blur(envRT, 0, 0, 0.04);
  pmrem._applyPMREM(envRT);
  pmrem._cleanup(envRT);
  renderer.setRenderTarget(rt0);
}

// ---------------------------------------------------------------- clouds (volumetric, anime-shaded, see clouds.js)
export const clouds = buildClouds();

// ---------------------------------------------------------------- stars: magnitude-distributed, clustered on the galactic
// plane, twinkling more near the horizon; rotate with the celestial sphere. Layer 1: not drawn in water reflections
// (magnified low-res star points smear into flakes there).
const starGeo = new THREE.BufferGeometry();
{
  const rng = mulberry32(42), P = [], C = [], M = [];
  const gN = new THREE.Vector3(0.35, 0.87, 0.34).normalize(), v = new THREE.Vector3();
  for (let i = 0; i < 9000; i++) {
    const u = rng() * 2 - 1, th = rng() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    v.set(r * Math.cos(th), u, r * Math.sin(th));
    if (i > 5200) { v.addScaledVector(gN, -v.dot(gN) * (0.8 + 0.2 * rng())).normalize(); } // extra stars in the galactic band
    P.push(v.x * 12000, v.y * 12000, v.z * 12000);
    const mag = Math.pow(rng(), 6), t = rng(); // few bright, many faint
    const b = 0.12 + mag * 3.0;
    const hot = t < 0.3 ? [0.7, 0.85, 1.2] : t < 0.75 ? [1, 0.97, 0.92] : t < 0.92 ? [1.15, 0.92, 0.7] : [1.1, 0.7, 1.05];
    C.push(b * hot[0], b * hot[1], b * hot[2]); M.push(mag, rng());
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  starGeo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  starGeo.setAttribute('aMag', new THREE.Float32BufferAttribute(M, 2));
}
const starMat = new THREE.ShaderMaterial({
  uniforms: { uVis: { value: 0 }, uTime: S.uTime, uPR: { value: 1 } },
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  vertexShader: /* glsl */`
    attribute vec3 color; attribute vec2 aMag; uniform float uVis, uTime, uPR; varying vec3 vCol; varying float vBig;
    void main(){
      vec3 wd = normalize(mat3(modelMatrix) * position);
      float hz = smoothstep(-0.01, 0.25, wd.y);
      float tw = 1.0 + (0.25 + 0.45 * (1.0 - hz)) * sin(uTime * (3.0 + aMag.y * 6.0) + aMag.y * 91.0) * sin(uTime * 1.3 + aMag.y * 37.0);
      vCol = color * uVis * tw * mix(0.3, 1.0, hz);
      vBig = smoothstep(0.35, 0.9, aMag.x);
      gl_PointSize = (1.6 + 2.6 * sqrt(aMag.x) + vBig * 6.0) * uPR;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
    }`,
  // bright stars get a little four-point sparkle, like in an anime night sky
  fragmentShader: /* glsl */`
    varying vec3 vCol; varying float vBig;
    void main(){
      vec2 q = gl_PointCoord - 0.5;
      float core = exp(-dot(q, q) * mix(14.0, 90.0, vBig));
      float spark = vBig * (exp(-abs(q.x) * 60.0) + exp(-abs(q.y) * 60.0)) * exp(-dot(q, q) * 10.0) * 0.8;
      gl_FragColor = vec4(vCol * (core + spark), 1.0);
    }`,
});
export const stars = new THREE.Points(starGeo, starMat); stars.frustumCulled = false; stars.layers.set(1); stars.userData.dynamic = true; scene.add(stars);

// ---------------------------------------------------------------- moon
// painted like the moon of an anime night: a cream disc, its limb a touch darker and cooler, soft lavender-grey maria
// with blurred edges, a few small craters with lit rims, a warm sheen toward the upper left
function makeMoonTexture() {
  const Sz = 512, R = Sz * 0.47, c = Sz / 2, cv = document.createElement('canvas'); cv.width = cv.height = Sz;
  const g = cv.getContext('2d'), rng = mulberry32(3);
  const grd = g.createRadialGradient(c - R * 0.28, c - R * 0.3, R * 0.05, c, c, R);
  grd.addColorStop(0, '#fffbea'); grd.addColorStop(0.7, '#f6f1e6'); grd.addColorStop(0.93, '#e4e0ee'); grd.addColorStop(1, '#d5d3e8');
  g.fillStyle = grd; g.beginPath(); g.arc(c, c, R, 0, 7); g.fill();
  g.globalCompositeOperation = 'source-atop';
  g.filter = 'blur(9px)'; // maria: overlapping soft patches
  for (const [x, y, rx, ry, a, o] of [[0.38, 0.36, 0.16, 0.12, 0.4, 0.3], [0.55, 0.3, 0.12, 0.09, -0.3, 0.26], [0.62, 0.47, 0.1, 0.13, 0.2, 0.22], [0.44, 0.55, 0.13, 0.08, 0.6, 0.26],
    [0.33, 0.62, 0.09, 0.07, 0.1, 0.2], [0.66, 0.66, 0.07, 0.06, 0.0, 0.18], [0.5, 0.42, 0.06, 0.05, 0.0, 0.14]]) {
    g.fillStyle = `rgba(150,148,186,${o})`; g.beginPath(); g.ellipse(x * Sz, y * Sz, rx * Sz, ry * Sz, a, 0, 7); g.fill(); }
  g.filter = 'blur(1.5px)'; // small craters: a shaded bowl and a light rim on the sunward side
  for (let i = 0; i < 14; i++) { const a = rng() * 7, r = Math.sqrt(rng()) * R * 0.8, x = c + Math.cos(a) * r, y = c + Math.sin(a) * r, cr = 4 + rng() * 11;
    g.fillStyle = 'rgba(160,156,190,0.28)'; g.beginPath(); g.arc(x, y, cr, 0, 7); g.fill();
    g.strokeStyle = 'rgba(255,253,244,0.45)'; g.lineWidth = 1.6; g.beginPath(); g.arc(x, y, cr, Math.PI * 0.75, Math.PI * 1.6); g.stroke(); }
  g.filter = 'none';
  const lim = g.createRadialGradient(c, c, R * 0.72, c, c, R); // limb darkening
  lim.addColorStop(0, 'rgba(120,120,170,0)'); lim.addColorStop(1, 'rgba(120,120,170,0.22)'); g.fillStyle = lim; g.fillRect(0, 0, Sz, Sz);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
// ---------------------------------------------------------------- lights
// ---------------------------------------------------------------- sun + cascaded shadow maps
// The sun is cascade 0; the other cascades are directional lights of zero intensity that only render shadow maps.
// lights_fragment_begin is rewritten so the sun takes, per fragment, the finest cascade whose box holds it and blends
// into the next one across that box's outer rim; past the last cascade the shadow fades out instead of ending in a line.
// Near cascades are centimetre-sharp, far ones broad and soft; every box is texel-snapped so edges never shimmer.
{
  const src = THREE.ShaderChunk.lights_fragment_begin;
  const a = src.indexOf('#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )'), b = src.indexOf('#if ( NUM_RECT_AREA_LIGHTS > 0 )');
  if (a < 0 || b < 0) throw new Error('sky: three light chunk changed');
  const cloud = src.slice(a, b).includes('cloudLit') ? '\n\tdirectLight.color *= cloudLit;' : '';
  THREE.ShaderChunk.lights_fragment_begin = src.slice(0, a) + `#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
	DirectionalLight directionalLight = directionalLights[ 0 ];
	getDirectionalLightInfo( directionalLight, directLight );${cloud}
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	{
		DirectionalLightShadow directionalLightShadow;
		float csmS = 1.0, csmW = 1.0;
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
			{
				vec4 csmC = vDirectionalShadowCoord[ i ];
				vec2 csmE = abs( csmC.xy / csmC.w * 2.0 - 1.0 );
				float csmIn = ( 1.0 - smoothstep( 0.84, 0.97, max( csmE.x, csmE.y ) ) ) * csmW;
				if ( csmIn > 0.0 ) {
					directionalLightShadow = directionalLightShadows[ i ];
					float csmV = getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, csmC );
					csmS -= csmIn * ( 1.0 - csmV ); csmW -= csmIn;
				}
			}
		}
		#pragma unroll_loop_end
		directLight.color *= ( directLight.visible && receiveShadow ) ? csmS : 1.0;
	}
	#endif
	RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
` + src.slice(b);
}
export const sun = new THREE.DirectionalLight(0xffffff, 3);
export const cascades = [sun];
const CSM_D = 2600; // how far up-sun casters are gathered: a low sun behind the hills still shades the valley's near cascades
function cascadeLight(l) { l.castShadow = true; l.shadow.camera.layers.enableAll(); l.shadow.autoUpdate = false; scene.add(l, l.target); return l; }
cascadeLight(sun);
export function applyShadowQuality() {
  const spec = Q.csm;
  while (cascades.length < spec.length) cascades.push(cascadeLight(new THREE.DirectionalLight(0x000000, 0)));
  while (cascades.length > spec.length) { const l = cascades.pop(); scene.remove(l, l.target); if (l.shadow.map) l.shadow.map.dispose(); l.dispose(); }
  cascades.forEach((l, i) => {
    const [half, size] = spec[i], texel = half * 2 / size, c = l.shadow.camera;
    l.shadow.mapSize.set(size, size);
    if (i >= 2) l.shadow.camera.layers.disable(3); else l.shadow.camera.layers.enable(3); // far cascades skip fine detail
    c.left = -half; c.right = half; c.top = half; c.bottom = -half; c.near = 1; c.far = CSM_D + half + 160; c.updateProjectionMatrix();
    l.shadow.bias = -1.0 * texel / (c.far - c.near); l.shadow.normalBias = 2.0 * texel;
    l.shadow.needsUpdate = true;
    if (l.shadow.map) { l.shadow.map.dispose(); l.shadow.map = null; }
  });
  resetShadowCache();
}

// ---------------------------------------------------------------- cached cascades
// Every cascade keeps its static casters — terrain, buildings, props, rocks — in a map of its own. That map is rebuilt
// only when the cascade has to move (the camera travelled 8 % of the cascade's half width, the sun or moon turned a
// fifth of a degree) and then over several frames: the static casters are split into SLICES lists, a share of them is
// drawn per frame into a back map, which is swapped in when complete (no frame redraws a whole cascade). Each update of a
// cascade copies its static map into the shadow map and draws only what moves on top: cars, people, trains, crossing
// booms (userData.dynamicCaster) and, in the two near cascades, the trees and shrubs that sway in the wind (their
// shadows keep moving with them). In the far cascades the sway is below a shadow texel, so trees count as static there.
const NEAR_CASCADES = 2, SLICES = 6, SLICE_FRAMES = [2, 3, 6, 6]; // frames a refresh takes, per cascade
// How far up-sun the moving casters are redrawn every frame. A low sun lays the light rays almost along the ground, so a
// near cascade's rays pass over hundreds of metres of town and forest toward the sun before they reach it: every tree
// along them used to be redrawn each frame (at golden hour 4-5x the casters of noon — the evening's extra frame cost).
// Wind sway only shows in a shadow close to its tree, so beyond SWAY_NEAR the swaying vegetation joins the cached static
// map (as it already does in the far cascades); it still shades, only it holds still. Cars, walkers and trains, a few
// metres tall, cast nothing that reaches beyond DYN_REACH.
const SWAY_NEAR = 40, SWAY_FAR = 420, DYN_REACH = 35;
const shadowCache = [];
let cacheReady = false;
function resetShadowCache() {
  for (const C of shadowCache) if (C) { C.front && C.front.dispose(); C.back && C.back.dispose(); }
  shadowCache.length = 0;
}
// The casts walk short flat lists instead of the whole scene graph: a stand-in root per list whose children are just
// its casters (three's shadow pass only reads visible, layers and children while it descends; the casters keep their
// real parents and world matrices). A caster under a group is listed with that group's visibility.
const list = () => ({ visible: true, layers: { test: () => true }, children: [] });
const casts = { dyn: list(), sway: list(), statics: [], sways: [] };
export function prepareShadowCache(root) {
  casts.dyn = list(); casts.sway = list(); casts.statics = Array.from({ length: SLICES }, list); casts.sways = Array.from({ length: SLICES }, list);
  let k = 0, j = 0;
  root.traverse(o => { if (o.userData.shadowOnly) o.layers.set(7); }); // casters drawn only into shadow maps (no camera renders layer 7)
  root.traverse(o => {
    if (!(o.isMesh || o.isPoints || o.isLine) || !o.castShadow) return;
    let dyn = false; for (let p = o; p && !dyn; p = p.parent) dyn = !!p.userData.dynamicCaster;
    const hide = []; for (let p = o.parent; p && p !== root; p = p.parent) hide.push(p);
    const entry = hide.length ? { get visible() { if (!o.visible) return false; for (const p of hide) if (!p.visible) return false; return true; }, layers: o.layers, children: [o] } : o;
    if (dyn) casts.dyn.children.push(entry);
    else if (o.userData.sways) { casts.sway.children.push(entry); casts.sways[j++ % SLICES].children.push(entry); }
    else casts.statics[k++ % SLICES].children.push(entry);
  });
  cacheReady = true;
}
// after objects were added, removed or moved (the world editor): rebuild the caster lists and redraw every cascade
export function refreshShadowCasters() { if (!cacheReady) return; prepareShadowCache(scene); for (const C of shadowCache) if (C) { C.front && C.front.dispose(); C.back && C.back.dispose(); } shadowCache.length = 0; }
// (three r170 filters shadow casters by the layers of the camera handed to the shadow render: a stand-in that accepts
// every layer, since the lists already select the casters)
const smRender = renderer.shadowMap.render, noClear = () => {}, castCam = { layers: new THREE.Layers() };
castCam.layers.enableAll();
function cast(l, root, clear) {
  const clr = renderer.clear;
  if (!clear) renderer.clear = noClear;
  l.shadow.needsUpdate = true;
  smRender.call(renderer.shadowMap, [l], root, castCam);
  renderer.clear = clr;
}
// Per-instance culling. three culls a caster by the bounds of its whole set, and an instanced set (every far car, the
// crowd, a forest cell) mostly overlaps the long light-space box of a near cascade while only a few of its instances fall
// inside it: of the ~8 M triangles drawn into the two near cascades every frame, under 1 M were inside them. Before such
// a set is drawn into a cascade, the instances inside the box are copied into a stand-in set of its own (same geometry
// buffers, material and depth material, so the same shader), rebuilt only when the set or the cascade placement changes.
const CULL_PAD = 1.0; // metres: wind sway and vertex animation reach past the geometry's rest bounds
const cullRoot = list(), stands = new Map(), _cw = new THREE.Matrix4();
let keep = new Int32Array(4096);
function makeStand(o, cap) {
  const g = geometryView(o.geometry), inst = [];
  for (const k in o.geometry.attributes) {
    const a = o.geometry.attributes[k];
    if (a.isInstancedBufferAttribute) { const c = new THREE.InstancedBufferAttribute(new a.array.constructor(cap * a.itemSize), a.itemSize, a.normalized); c.setUsage(THREE.DynamicDrawUsage); g.attributes[k] = c; inst.push(k); }
  }
  const m = new THREE.InstancedMesh(g, o.material, cap);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  if (o.instanceColor) { m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3); m.instanceColor.setUsage(THREE.DynamicDrawUsage); }
  m.castShadow = true; m.receiveShadow = o.receiveShadow; m.customDepthMaterial = o.customDepthMaterial; m.customDistanceMaterial = o.customDistanceMaterial;
  m.frustumCulled = false; m.matrixAutoUpdate = false; m.matrixWorldAutoUpdate = false; m.layers.mask = o.layers.mask; m.renderOrder = o.renderOrder;
  return { m, inst, cap, key: -1, n: -1, place: null, k: 0, used: 0, mw: new Float32Array(16) };
}
function freeStand(st) { // its own buffers only: the geometry view shares the source's
  st.m.dispose();
  const g = st.m.geometry, own = {}; for (const k of st.inst) own[k] = g.attributes[k];
  g.index = null; g.attributes = own; g.morphAttributes = {}; g.dispose();
}
const instKey = o => { let v = o.instanceMatrix.version + (o.instanceColor ? o.instanceColor.version * 7 : 0); const A = o.geometry.attributes; for (const k in A) if (A[k].isInstancedBufferAttribute) v += A[k].version * 13; return v; };
// the set to draw into cascade i at placement P: o itself (all inside), a stand-in, or null (none inside)
function cullSet(o, i, P, sc, reach = Infinity, from = -Infinity, slot = i) {
  const hx = sc.right, hy = sc.top, g = o.geometry;
  if (!g.boundingSphere) g.computeBoundingSphere();
  const W = _cw.multiplyMatrices(sc.matrixWorldInverse, o.matrixWorld).elements;
  // Dynamic and wind-swaying casters do not need the full 2.6 km up-sun depth reserved for mountains and other cached
  // static scenery. At a low sun that long slab admitted most of the forest into both near cascades every frame—the
  // Golden Hour-only draw spike. `reach` keeps enough up-sun distance for the longest useful tree shadow while static
  // hills/buildings retain the original full-depth shadow volume.
  // `from` (with `reach`) selects a band up-sun of the cascade: only what lies between from and reach metres toward the sun
  const zNear = Number.isFinite(reach) ? -(CSM_D - reach) : -sc.near, zFar = Number.isFinite(from) ? -(CSM_D - from) : -sc.far;
  const ws = Math.sqrt(Math.max(W[0] * W[0] + W[1] * W[1] + W[2] * W[2], W[4] * W[4] + W[5] * W[5] + W[6] * W[6], W[8] * W[8] + W[9] * W[9] + W[10] * W[10]));
  if (o.frustumCulled && o.boundingSphere) { // the whole set's bounds first
    const c = o.boundingSphere.center, R = o.boundingSphere.radius * ws + CULL_PAD;
    const X = W[0] * c.x + W[4] * c.y + W[8] * c.z + W[12], Y = W[1] * c.x + W[5] * c.y + W[9] * c.z + W[13], Z = W[2] * c.x + W[6] * c.y + W[10] * c.z + W[14];
    if (Math.abs(X) - R > hx || Math.abs(Y) - R > hy || Z - R > zNear || Z + R < zFar) return null;
    if (Math.abs(X) + R <= hx && Math.abs(Y) + R <= hy && Z + R <= zNear && Z - R >= zFar) return o;
  }
  let a = stands.get(o); if (!a) stands.set(o, a = []);
  let st = a[slot];
  const key = instKey(o), mw = o.matrixWorld.elements;
  if (st && st.key === key && st.n === o.count && st.place === P) {
    let same = true; for (let q = 0; q < 16 && same; q++) same = st.mw[q] === mw[q];
    if (same) { st.used = csmFrame; return st.k === o.count ? o : st.k ? st.m : null; }
  }
  const A = o.instanceMatrix.array, n = o.count, bs = g.boundingSphere, cx = bs.center.x, cy = bs.center.y, cz = bs.center.z, br = bs.radius * ws;
  if (keep.length < n) keep = new Int32Array(n * 2);
  let k = 0;
  for (let j = 0; j < n; j++) {
    const b = j * 16, a0 = A[b], a1 = A[b + 1], a2 = A[b + 2], a4 = A[b + 4], a5 = A[b + 5], a6 = A[b + 6], a8 = A[b + 8], a9 = A[b + 9], a10 = A[b + 10];
    const s2 = Math.max(a0 * a0 + a1 * a1 + a2 * a2, a4 * a4 + a5 * a5 + a6 * a6, a8 * a8 + a9 * a9 + a10 * a10);
    if (s2 === 0) continue; // a zero-scaled (hidden) instance
    const x = a0 * cx + a4 * cy + a8 * cz + A[b + 12], y = a1 * cx + a5 * cy + a9 * cz + A[b + 13], z = a2 * cx + a6 * cy + a10 * cz + A[b + 14];
    const R = br * Math.sqrt(s2) + CULL_PAD, X = W[0] * x + W[4] * y + W[8] * z + W[12], Y = W[1] * x + W[5] * y + W[9] * z + W[13], Z = W[2] * x + W[6] * y + W[10] * z + W[14];
    if (X - R > hx || -X - R > hx || Y - R > hy || -Y - R > hy || Z - R > zNear || Z + R < zFar) continue;
    keep[k++] = j;
  }
  if (k && k < n) {
    if (!st || !st.m || st.cap < k) { if (st && st.m) freeStand(st); st = a[slot] = makeStand(o, Math.max(32, Math.ceil(k * 1.5))); }
    const m = st.m, B = m.instanceMatrix.array;
    for (let q = 0; q < k; q++) { const s0 = keep[q] * 16, d0 = q * 16; for (let e = 0; e < 16; e++) B[d0 + e] = A[s0 + e]; }
    m.instanceMatrix.clearUpdateRanges(); m.instanceMatrix.addUpdateRange(0, k * 16); m.instanceMatrix.needsUpdate = true;
    const cols = [];
    if (o.instanceColor) cols.push([o.instanceColor, m.instanceColor]);
    for (const name of st.inst) cols.push([g.attributes[name], m.geometry.attributes[name]]);
    for (const [src, dst] of cols) {
      const S0 = src.array, D0 = dst.array, w = src.itemSize;
      for (let q = 0; q < k; q++) { const s0 = keep[q] * w, d0 = q * w; for (let e = 0; e < w; e++) D0[d0 + e] = S0[s0 + e]; }
      dst.clearUpdateRanges(); dst.addUpdateRange(0, k * w); dst.needsUpdate = true;
    }
    m.count = k; m.matrixWorld.copy(o.matrixWorld);
  } else if (!st) st = a[slot] = { m: null, inst: [], cap: 0, key: -1, n: -1, place: null, k: 0, used: 0, mw: new Float32Array(16) };
  st.key = key; st.n = n; st.place = P; st.k = k; st.used = csmFrame; st.mw.set(mw);
  return k === n ? o : k ? st.m : null;
}
// stand-ins unused for a while (their set left the cascades, or was never seen again) are freed
function evictStands() {
  for (const [o, a] of stands) {
    let live = false;
    for (let i = 0; i < a.length; i++) { const st = a[i]; if (!st) continue; if (csmFrame - st.used > 900) { if (st.m) freeStand(st); a[i] = null; } else live = true; }
    if (!live) stands.delete(o);
  }
}
const cullable = o => o.isInstancedMesh && !o.geometry.isInstancedBufferGeometry && o.count > 4 && !Object.values(o.geometry.attributes).some(a => a.isInterleavedBufferAttribute);
// statics: a fixed caster can only shade the cascade from as far up-sun as its own height above the ground there lets
// its shadow reach (height / tan elevation) — buildings 300 m away at a low sun, a few tens of metres at noon; hills and
// the forest on them, being high, still reach from kilometres
function staticReach(o, sc, P, se) {
  const g = o.geometry; if (!g || !g.boundingSphere) return true;
  const W = _cw.multiplyMatrices(sc.matrixWorldInverse, o.matrixWorld).elements, c = g.boundingSphere.center;
  const ws = Math.sqrt(Math.max(W[0] * W[0] + W[1] * W[1] + W[2] * W[2], W[4] * W[4] + W[5] * W[5] + W[6] * W[6], W[8] * W[8] + W[9] * W[9] + W[10] * W[10]));
  const R = g.boundingSphere.radius * ws, Z = W[2] * c.x + W[6] * c.y + W[10] * c.z + W[14];
  const M = o.matrixWorld.elements, top = M[1] * c.x + M[5] * c.y + M[9] * c.z + M[13] + R;
  const up = Z + CSM_D - R; if (up <= 0) return true;
  return up * se / Math.sqrt(Math.max(1e-4, 1 - se * se)) <= top - P.center.y + 2;
}
// a single (not instanced) moving or swaying caster: inside the up-sun band [from, reach] of the cascade
function inBand(o, sc, reach, from) {
  if (!Number.isFinite(reach) && !Number.isFinite(from)) return true;
  const g = o.geometry; if (!g || !g.boundingSphere) return true;
  const W = _cw.multiplyMatrices(sc.matrixWorldInverse, o.matrixWorld).elements, c = g.boundingSphere.center;
  const R = g.boundingSphere.radius * Math.sqrt(Math.max(W[0] * W[0] + W[1] * W[1] + W[2] * W[2], W[4] * W[4] + W[5] * W[5] + W[6] * W[6], W[8] * W[8] + W[9] * W[9] + W[10] * W[10]));
  const up = W[2] * c.x + W[6] * c.y + W[10] * c.z + W[14] + CSM_D;
  return up - R <= reach && up + R >= from;
}
function castCulled(l, i, root, P, clear, reach = Infinity, from = -Infinity, slot = i, fixed = false) {
  l.shadow.updateMatrices(l);
  const sc = l.shadow.camera, out = cullRoot.children, se = Math.max(0.02, Math.abs(P.dir.y)); out.length = 0;
  for (const e of root.children) {
    if (!e.visible) continue;
    const o = e.isObject3D ? e : e.children[0];
    if (!cullable(o)) { if (fixed ? staticReach(o, sc, P, se) : inBand(o, sc, reach, from)) out.push(e); continue; }
    const r = cullSet(o, i, P, sc, reach, from, slot);
    if (r === o) out.push(e); else if (r) out.push(r);
  }
  cast(l, cullRoot, clear);
  out.length = 0;
}
function placeLight(l, P) {
  if (P.hy) setHalfY(l, P.hy);
  l.target.position.copy(P.center); l.position.copy(P.center).addScaledVector(P.dir, CSM_D);
  l.target.updateMatrixWorld(); l.updateMatrixWorld();
}
function blitMap(src, dst) { // colour (packed depth) and depth buffer, same size and formats
  const gl = renderer.getContext(), st = renderer.state, P = renderer.properties, w = dst.width, h = dst.height;
  st.bindFramebuffer(gl.READ_FRAMEBUFFER, P.get(src).__webglFramebuffer); st.bindFramebuffer(gl.DRAW_FRAMEBUFFER, P.get(dst).__webglFramebuffer);
  gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT, gl.NEAREST);
  st.bindFramebuffer(gl.READ_FRAMEBUFFER, null); st.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
}
function cacheRT(l) { return new THREE.WebGLRenderTarget(l.shadow.mapSize.x, l.shadow.mapSize.y, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter }); }
// draw static lists [s0, s1) at placement C.next into the map `into` (the first list clears it)
function renderStatic(i, l, C, s0, s1, into) {
  placeLight(l, C.next);
  const map = l.shadow.map; l.shadow.map = into;
  for (let s = s0; s < s1; s++) {
    if (i < NEAR_CASCADES) { castCulled(l, i, casts.statics[s], C.next, s === 0, Infinity, -Infinity, i, true); castCulled(l, i, casts.sways[s], C.next, false, SWAY_FAR, SWAY_NEAR, i + 8); }
    else { castCulled(l, i, casts.statics[s], C.next, s === 0, Infinity, -Infinity, i, true); castCulled(l, i, casts.sways[s], C.next, false, Infinity, -Infinity, i + 8, true); }
  }
  l.shadow.map = map;
}
function updateCachedCascade(i) {
  const l = cascades[i], C = shadowCache[i]; if (!C) return;
  if (!C.front) { if (!C.next) return; C.front = cacheRT(l); C.back = cacheRT(l); renderStatic(i, l, C, 0, SLICES, C.front); C.cur = C.next; C.next = null; C.slice = -1; C.show = true; }
  else if (C.slice >= 0) {
    const per = Math.ceil(SLICES / (SLICE_FRAMES[i] || SLICES)), s0 = C.slice * per, s1 = Math.min(SLICES, s0 + per);
    renderStatic(i, l, C, s0, s1, C.back);
    if (s1 >= SLICES) { const t = C.front; C.front = C.back; C.back = t; C.cur = C.next; C.next = null; C.slice = -1; C.show = true; }
    else { C.slice++; if (!C.show) { placeLight(l, C.cur); l.shadow.updateMatrices(l); } } // the shadow matrix must keep matching the shown map
  }
  if (!C.show) return;
  placeLight(l, C.cur);
  if (!l.shadow.map) cast(l, casts.dyn, true); // (three allocates the shadow map on its first render)
  blitMap(C.front, l.shadow.map);
  castCulled(l, i, casts.dyn, C.cur, false, DYN_REACH);
  if (i < NEAR_CASCADES) castCulled(l, i, casts.sway, C.cur, false, SWAY_NEAR);
  C.show = false;
}
// wrapped: once a frame, with the scene render that updates shadows (not the mirror pass or the environment capture)
let cacheFrame = -1;
renderer.shadowMap.render = function (lights, scn, cam) {
  if (!cacheReady) return smRender.call(this, lights, scn, cam);
  if (!this.enabled || scn !== scene || !(this.autoUpdate || this.needsUpdate) || cacheFrame === csmFrame) return;
  cacheFrame = csmFrame;
  for (let i = 0; i < cascades.length; i++) updateCachedCascade(i);
  if (csmFrame % 300 === 0) evictStands();
};
applyShadowQuality();

// ---------------------------------------------------------------- update
export const env = { haze: 1, night: 0, day: 1, lightDir: S.uLightDir.value, azimuth: 2.2, exposure: 1, wb: new THREE.Vector3(1, 1, 1), moonDir: new THREE.Vector3() };
const MOON = new THREE.Color('#a9bdff'), tmpC = new THREE.Color();
let lastEnvHour = -99, envTimer = 0;
export function updateSky(force) {
  const th = (time.hour - 6) / 12 * Math.PI;
  sunDir.set(Math.cos(th), Math.sin(th) * Math.cos(TILT), Math.sin(th) * Math.sin(TILT)).applyAxisAngle(up, env.azimuth).normalize();
  env.moonDir.copy(sunDir).negate();
  updateCelestial(th);
  const el = sunDir.y;
  const night = smoothstep(0.02, -0.16, el);
  env.night = night; env.day = smoothstep(-0.05, 0.12, el);
  const p = samplePalette(time.hour);
  // sunlight by day; at night a faint cool moon — the landscape falls into darkness and the lamps light the town
  const useSun = el > -0.02;
  env.lightDir.copy(useSun ? sunDir : env.moonDir);
  if (useSun) { sun.color.copy(p.sun); sun.intensity = p.sunI * smoothstep(-0.02, 0.05, el); }
  else { sun.color.copy(MOON); sun.intensity = 0.06 * smoothstep(-0.02, -0.12, el); }
  S.uSunCol.value.set(sun.color.r, sun.color.g, sun.color.b).multiplyScalar(sun.intensity);
  skyU.uGlowAmt.value = p.glowAmt;
  skyU.uSunDisk.value.set(p.sun.r + 1, p.sun.g + 1, p.sun.b + 1).multiplyScalar(0.5 * smoothstep(-0.04, 0.02, el) * 3.0); // halfway to white
  skyU.uMoonDir.value.copy(env.moonDir);
  skyU.uMoonU.value.crossVectors(celestial.axis, env.moonDir).normalize(); skyU.uMoonV.value.crossVectors(env.moonDir, skyU.uMoonU.value);
  skyU.uMoonGlow.value.set(MOON.r, MOON.g, MOON.b).multiplyScalar(smoothstep(0.0, -0.1, el));
  const starVis = smoothstep(-0.04, -0.18, el);
  starMat.uniforms.uVis.value = starVis; stars.visible = starVis > 0.01;
  starMat.uniforms.uPR.value = renderer.getPixelRatio();
  skyU.uNightSky.value = smoothstep(-0.03, -0.2, el);
  skyU.uMoonVis.value = smoothstep(-0.05, 0.02, env.moonDir.y) * smoothstep(0.12, 0.75, night);
  skyU.uMoonDisk.value.setScalar(0.5 + 0.38 * night); // just under the tone map's shoulder: bright, its painted maria still readable
  cloudPal.lit.copy(p.cLit); cloudPal.shade.copy(p.cShade); cloudPal.dir.copy(env.lightDir);
  // the environment map (sky gradient + ground bounce) is the coloured ambient / shadow fill
  envTimer -= 1;
  if (force || Math.abs(time.hour - lastEnvHour) > 0.05 || envTimer <= 0) {
    lastEnvHour = time.hour; envTimer = 180;
    const tw = skyU.uTown.value.w; skyU.uTown.value.w = 0; // the glow is local: keep it out of the global ambient
    withStandardDepth(regenEnv);
    skyU.uTown.value.w = tw;
    scene.environment = envRT.texture;
  }
  scene.environmentIntensity = lerp(1.0, 0.12, night); // the night sky's fill: dim blue, so unlit ground reads dark
  scene.fog.color.copy(p.fog);
  scene.fog.density = 0.00022 * p.fogD; env.haze = p.haze;
  S.uFogCol.value.set(p.fog.r, p.fog.g, p.fog.b);
  tmpC.copy(p.zen).lerp(p.hor, 0.55);
  S.uAmb.value.set(tmpC.r, tmpC.g, tmpC.b);
  const fs = fogU.fogSunDir.value; fs.x = sunDir.x; fs.y = sunDir.y; fs.z = sunDir.z;
  const fsc = fogU.fogSunColor.value, glow = p.glowAmt * 0.35 * (1 - night);
  fsc.x = p.glow.r * glow; fsc.y = p.glow.g * glow; fsc.z = p.glow.b * glow;
  env.exposure = p.exp;
}

const lsInv = new THREE.Matrix4(), lsMat = new THREE.Matrix4(), snapV = new THREE.Vector3(), origin = new THREE.Vector3(), _negL = new THREE.Vector3();
// Golden hour: a cascade box is square in light space, and seen along a low sun its vertical axis stretches over the
// ground by 1 / sin(elevation) — at 8 degrees a 40 m box shaded a 290 m strip toward the sun, and every car, walker and
// swaying tree along that strip was drawn into it each frame (the evening's extra shadow cost). The box only has to hold
// the receivers of its slice of the view: its ground disc (half * sin el along the light's vertical axis) plus the
// height of what stands on it (facades, slopes: RECV[i] * cos el). Casters need no room of their own — whatever shades a
// receiver lies on the same light ray, inside the same box. So each box's light-space half-height follows the sun,
// quantised (a change re-places the cascade like a move). By day it stays square; at a low sun it is shorter, cheaper and
// sharper (the same texels over a shorter span).
const RECV = [14, 30, 120, 320];
const fitHalfY = (i, half) => { const se = Math.min(1, Math.abs(env.lightDir.y)), ce = Math.sqrt(1 - se * se);
  return half * Math.min(1, Math.max(0.25, Math.ceil(Math.min(1, (half * se + (RECV[i] ?? 320) * ce) / half) * 16) / 16)); };
function setHalfY(l, hy) { const c = l.shadow.camera; if (c.top !== hy) { c.top = hy; c.bottom = -hy; c.updateProjectionMatrix(); } }
let csmFrame = 0;
const aim = [0, 1, 2, 3, 4, 5].map(() => ({ x: 0, z: -1, set: false }));
export function followCamera(groundAt, yaw) {
  const c = camera.position;
  skyU.uTown.value.set(townGlow.x - c.x, townGlow.z - c.z, townGlow.r, townGlow.s * env.night);
  clouds.position.copy(c);
  const cs = cloudShadow; cs.p.x = S.uTime.value; cs.p.y = cloudU.uCover.value; cs.p.z = (cloudU.uBottom.value + cloudU.uTop.value) / 2;
  cs.sun.x = env.lightDir.x; cs.sun.y = env.lightDir.y; cs.sun.z = env.lightDir.z;
  stars.position.copy(c); stars.quaternion.copy(celestial.q);
  // every cascade box sits a little ahead of the camera, snapped to its shadow texels so edges never crawl; far
  // cascades re-render every few frames (staggered), which the eye cannot tell at their distance
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  lsMat.lookAt(origin, _negL.copy(env.lightDir).negate(), up);
  lsInv.copy(lsMat).invert();
  csmFrame++;
  for (let i = 0; i < cascades.length; i++) {
    const l = cascades[i], half = Q.csm[i][0], size = Q.csm[i][1], rate = Q.csmRate[i] || 1, cached = cacheReady;
    if (!cached && csmFrame % rate !== i % rate && l.shadow.map) continue;
    // cached cascades keep the direction they were aimed in until the view turns 25 degrees away from it: aimed anew on
    // every turn, all four boxes moved with each frame of a fast turn and were redrawn continuously; the forward reach
    // given up is under 5 % of a box
    let ax = fx, az = fz;
    if (cached) { const A = aim[i]; if (!A.set || A.x * fx + A.z * fz < 0.906) { A.x = fx; A.z = fz; A.set = true; } ax = A.x; az = A.z; }
    const center = snapV.set(c.x + ax * half * 0.5, 0, c.z + az * half * 0.5);
    center.y = groundAt(center.x, center.z);
    center.applyMatrix4(lsInv);
    const hy = fitHalfY(i, half), texel = (half * 2) / size, texelY = (hy * 2) / size;
    center.x = Math.round(center.x / texel) * texel; center.y = Math.round(center.y / texelY) * texelY;
    center.applyMatrix4(lsMat);
    if (cached) { // keep the cached placement until the cascade has to move; the moving casters update at the cascade's rate
      const C = shadowCache[i] || (shadowCache[i] = { cur: null, next: null, slice: -1, show: false, front: null, back: null });
      const ref = C.next || C.cur;
      if (!ref || (C.slice < 0 && !C.next && (ref.center.distanceTo(center) > half * 0.08 || ref.dir.dot(env.lightDir) < 0.999994 || ref.hy !== hy))) {
        C.next = { center: center.clone(), dir: env.lightDir.clone(), hy }; if (C.front) C.slice = 0;
      }
      if (csmFrame % rate === i % rate || C.late) { C.late = false;
        // two far cascades never redraw their moving casters in the same frame (every 2nd and every 3rd frame met every
        // 6th): the later one waits a frame
        if (i >= NEAR_CASCADES && i > 0 && shadowCache[i - 1] && shadowCache[i - 1].show && i - 1 >= NEAR_CASCADES) C.late = true; else C.show = true; }
      continue;
    }
    setHalfY(l, hy);
    l.target.position.copy(center);
    l.position.copy(center).addScaledVector(env.lightDir, CSM_D);
    l.target.updateMatrixWorld(); l.updateMatrixWorld();
    l.shadow.needsUpdate = true;
  }
  for (let i = 1; i < cascades.length; i++) cascades[i].color.setRGB(0, 0, 0);
  fogU.fogParams.value.x = c.y;
  // aerial perspective: terrain and forests now reach the horizon, so the haze no longer hides a draw distance; it only
  // layers the far ridges into the sky (about half-hazed at 3 km, three quarters at 10 km, gone by ~20 km)
  fogU.fogHaze.value.x = 600; fogU.fogHaze.value.y = 0.00015 * (env.haze || 1);
}
