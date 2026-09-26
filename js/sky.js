// Sky, clouds, stars, moon, sun/moon light and the day-night cycle.
// The sky is physically based single scattering (Rayleigh + Mie + ozone absorption, with a cheap multiple-scattering
// term) ray-marched into a small sky-view LUT whenever the sun moves. The dome, water reflections, the PMREM
// environment and the fog probes all sample that LUT, and the sun / moon light colours come from the same
// atmosphere's transmittance, so direct light, sky light and haze always agree with each other.
import { THREE, renderer, scene, camera, S, sunDir, fogU, Q, clamp, lerp, smoothstep, mulberry32 } from './core.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { buildClouds, cloudShadow, cloudU, cloudSunCol, cloudLightDir } from './clouds.js';

export const time = { hour: 16.4, running: true, speed: 1 / 60 }; // game hours per real second (1 day = 24 min)
const up = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------- atmosphere
// Radii / scale heights in metres, coefficients per metre. Aerosols are ~5x Hillaire's "very clear" default:
// a little haze makes the sun aureole, golden hour and distant ridges read much more like a photograph.
const ATM = {
  Rp: 6360e3, Ra: 6460e3, alt: 250, HR: 8000, HM: 1200,
  bR: [5.802e-6, 13.558e-6, 33.1e-6], bMs: 2.1e-5, bMe: 2.35e-5, bO: [0.650e-6, 1.881e-6, 0.085e-6], g: 0.78,
};
// Solar irradiance in scene units. Chosen so the clear-sky radiance lands where the old sky sat (zenith ≈ 1) — which
// makes direct sun ~4-6x the sky fill, as on a real clear day (the old rig was ~1:1, hence the flat, grey look).
export const SUN_E = 38;
const MOON_E = SUN_E / 110;                  // artistic: bright enough for a readable, blue, moonlit sky
const MOON_TINT = [0.62, 0.74, 1.0];         // scotopic (blue-shifted) look of moonlight

const GLSL_ATM = /* glsl */`
  const float PI = 3.14159265359;
  const float Rp = ${ATM.Rp.toFixed(1)}, Ra = ${ATM.Ra.toFixed(1)}, ALT = ${ATM.alt.toFixed(1)};
  const float HR = ${ATM.HR.toFixed(1)}, HM = ${ATM.HM.toFixed(1)};
  const vec3 bR = vec3(${ATM.bR.map(v => v.toExponential(4)).join(', ')});
  const float bMs = ${ATM.bMs.toExponential(4)}, bMe = ${ATM.bMe.toExponential(4)}, gM = ${ATM.g.toFixed(3)};
  const vec3 bO = vec3(${ATM.bO.map(v => v.toExponential(4)).join(', ')});
  vec2 rsi(vec3 o, vec3 d, float r){ float b = dot(o, d), c = dot(o, o) - r * r, h = b * b - c; if (h < 0.0) return vec2(1e9, -1e9); h = sqrt(h); return vec2(-b - h, -b + h); }
  vec3 atmDens(float h){ return vec3(exp(-h / HR), exp(-h / HM), max(0.0, 1.0 - abs(h - 25000.0) / 15000.0)); }
  float phaseR(float mu){ return 3.0 / (16.0 * PI) * (1.0 + mu * mu); }
  float phaseM(float mu){ float g2 = gM * gM; return 3.0 / (8.0 * PI) * (1.0 - g2) * (1.0 + mu * mu) / ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * gM * mu, 1e-4), 1.5)); }
  // (R, M, O) optical depth from p toward L; blocked by the planet -> huge
  vec3 lightOD(vec3 p, vec3 L){
    vec2 g = rsi(p, L, Rp); if (g.x > 0.0 && g.y > 0.0) return vec3(1e7);
    float ds = rsi(p, L, Ra).y / 6.0; vec3 od = vec3(0.0);
    for (int j = 0; j < 6; j++) od += atmDens(length(p + L * (float(j) + 0.5) * ds) - Rp);
    return od * ds;
  }
`;

// sky-view LUT: x = azimuth from the sun (0..pi, the sky is symmetric about the sun's vertical plane),
// y = sqrt(elevation / (pi/2)) so the horizon, where the colour changes fastest, gets most of the rows
const LUT_W = 128, LUT_H = 96;
const lutRT = new THREE.WebGLRenderTarget(LUT_W, LUT_H, { type: THREE.HalfFloatType, depthBuffer: false });
lutRT.texture.minFilter = lutRT.texture.magFilter = THREE.LinearFilter;
lutRT.texture.wrapS = lutRT.texture.wrapT = THREE.ClampToEdgeWrapping;
const lutMat = new THREE.ShaderMaterial({
  uniforms: { uSun: { value: new THREE.Vector3() }, uMoon: { value: new THREE.Vector3() }, uSunE: { value: SUN_E }, uMoonE: { value: MOON_E }, uTwi: { value: new THREE.Vector3() } },
  vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: /* glsl */`
    precision highp float;
    uniform vec3 uSun, uMoon, uTwi; uniform float uSunE, uMoonE;
    ${GLSL_ATM}
    void main(){
      float u = (gl_FragCoord.x - 0.5) / ${(LUT_W - 1).toFixed(1)}, v = (gl_FragCoord.y - 0.5) / ${(LUT_H - 1).toFixed(1)};
      float az = u * PI, el = v * v * PI * 0.5;
      vec3 d = vec3(cos(el) * cos(az), sin(el), cos(el) * sin(az));
      vec3 o = vec3(0.0, Rp + ALT, 0.0);
      float tMax = rsi(o, d, Ra).y;
      bool doSun = uSun.y > -0.3, doMoon = uMoon.y > -0.3;
      float muS = dot(d, uSun), muM = dot(d, uMoon);
      float pRS = phaseR(muS), pMS = phaseM(muS), pRM = phaseR(muM), pMM = phaseM(muM);
      vec3 odV = vec3(0.0), Ls = vec3(0.0), Lm = vec3(0.0);
      const int N = 28;
      for (int i = 0; i < N; i++) {
        float a = float(i) / float(N), b = float(i + 1) / float(N);
        float t0 = tMax * a * a, t1 = tMax * b * b, ds = t1 - t0;
        vec3 p = o + d * (0.5 * (t0 + t1));
        vec3 dn = atmDens(length(p) - Rp) * ds;
        odV += dn * 0.5;
        vec3 sR = bR * dn.x, sM = vec3(bMs * dn.y);
        vec3 ms = (sR + sM) * (1.0 / (4.0 * PI)) * 0.55;   // crude isotropic multiple scattering
        if (doSun) {
          vec3 od = odV + lightOD(p, uSun);
          vec3 T = exp(-(bR * od.x + bMe * od.y + bO * od.z));
          Ls += T * (sR * pRS + sM * pMS + ms);
          // air inside the Earth's shadow is still lit by the bright (ozone-blue) twilight sky above it
          Ls += exp(-(bR * odV.x + bMe * odV.y + bO * odV.z)) * (sR + sM) * uTwi;
        }
        if (doMoon) {
          vec3 od = odV + lightOD(p, uMoon);
          vec3 T = exp(-(bR * od.x + bMe * od.y + bO * od.z));
          Lm += T * (sR * pRM + sM * pMM + ms);
        }
        odV += dn * 0.5;
      }
      gl_FragColor = vec4(Ls * uSunE + Lm * uMoonE * vec3(${MOON_TINT.join(', ')}), 1.0);
    }`,
  depthTest: false, depthWrite: false,
});
const lutQuad = new FullScreenQuad(lutMat);
let lastLutEl = 9;
function updateLUT(force) {
  // LUT frame: x toward the sun's azimuth, y up
  const h = Math.hypot(sunDir.x, sunDir.z), el = Math.atan2(sunDir.y, h);
  if (!force && Math.abs(el - lastLutEl) < 2e-4) return;
  lastLutEl = el;
  lutMat.uniforms.uSun.value.set(Math.cos(el), Math.sin(el), 0);
  lutMat.uniforms.uMoon.value.set(-Math.cos(el), -Math.sin(el), 0);
  lutMat.uniforms.uTwi.value.set(0.35, 0.6, 1.0).multiplyScalar(0.005 * smoothstep(-0.22, -0.01, el) * smoothstep(0.12, 0.0, el));
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(lutRT); lutQuad.render(renderer); renderer.setRenderTarget(prev);
}

// transmittance from the viewer (or from altitude `alt`) along a direction (same model, on the CPU) -> out[3]
function transmittance(d, out, alt = ATM.alt) {
  const { Rp, Ra, HR, HM, bR, bMe, bO } = ATM, oy = Rp + alt;
  const b = oy * d.y, c = oy * oy, hg = b * b - (c - Rp * Rp);
  if (hg > 0 && -b - Math.sqrt(hg) > 0) { out[0] = out[1] = out[2] = 0; return out; }
  const tMax = -b + Math.sqrt(b * b - (c - Ra * Ra)), N = 48;
  let odR = 0, odM = 0, odO = 0;
  for (let i = 0; i < N; i++) {
    const a = i / N, e = (i + 1) / N, t0 = tMax * a * a, t1 = tMax * e * e, ds = t1 - t0, t = (t0 + t1) / 2;
    const px = d.x * t, py = oy + d.y * t, pz = d.z * t, hh = Math.hypot(px, py, pz) - Rp;
    odR += Math.exp(-hh / HR) * ds; odM += Math.exp(-hh / HM) * ds; odO += Math.max(0, 1 - Math.abs(hh - 25000) / 15000) * ds;
  }
  for (let k = 0; k < 3; k++) out[k] = Math.exp(-(bR[k] * odR + bMe * odM + bO[k] * odO));
  return out;
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

// ---------------------------------------------------------------- sky dome
const skyU = {
  tLUT: { value: lutRT.texture }, tNoise: S.tNoise, uTime: S.uTime, uSunDir: S.uSunDir,
  uSunDisk: { value: new THREE.Vector3() }, uMoonDir: { value: new THREE.Vector3() }, uMoonGlow: { value: new THREE.Vector3() },
  uNightSky: { value: 0 }, uCel: { value: celestial.inv },
};
const skyMat = new THREE.ShaderMaterial({
  uniforms: skyU, side: THREE.BackSide, depthWrite: false, fog: false,
  vertexShader: /* glsl */`
    varying vec3 vW;
    void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; gl_Position.z = gl_Position.w; }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tLUT, tNoise; uniform float uTime, uNightSky; uniform vec3 uSunDir, uSunDisk, uMoonDir, uMoonGlow; uniform mat3 uCel;
    varying vec3 vW;
    const float PI = 3.14159265359;
    vec3 skyLUT(vec3 d){
      float el = asin(clamp(d.y, 0.0, 1.0));
      vec2 h = d.xz / max(length(d.xz), 1e-5), s = uSunDir.xz / max(length(uSunDir.xz), 1e-5);
      float az = acos(clamp(dot(h, s), -1.0, 1.0));
      vec2 uv = vec2(az / PI, sqrt(el / (PI * 0.5)));
      uv = (uv * vec2(${LUT_W - 1}.0, ${LUT_H - 1}.0) + 0.5) / vec2(${LUT_W}.0, ${LUT_H}.0);
      return texture2D(tLUT, uv).rgb;
    }
    void main(){
      vec3 d = normalize(vW - cameraPosition);
      vec3 col = skyLUT(d);
      float below = smoothstep(0.0, -0.08, d.y);
      col *= 1.0 - below * 0.35;                                  // below the horizon: slightly darker haze
      // sun disc with limb darkening
      float mu = dot(d, uSunDir), R = 0.0085;
      float r = sqrt(max(2.0 * (1.0 - mu), 0.0)) / R;
      if (r < 1.0) col += uSunDisk * (1.0 - 0.55 * (1.0 - sqrt(1.0 - r * r))) * smoothstep(1.0, 0.9, r) * (1.0 - below);
      // night: airglow, Milky Way, moon halo
      if (uNightSky > 0.001) {
        vec3 c = uCel * d;
        vec3 gN = normalize(vec3(0.35, 0.87, 0.34)), gC = normalize(vec3(0.82, -0.2, -0.53));
        float b = dot(c, gN);
        float lon = atan(c.z, c.x);
        vec2 guv = vec2(lon / (2.0 * PI) * 6.0, b * 3.2);
        vec4 n1 = texture2D(tNoise, guv), n2 = texture2D(tNoise, guv * 3.1 + 0.37);
        float core = pow(max(dot(c, gC), 0.0), 4.0);
        float band = exp(-b * b * mix(55.0, 18.0, core)) * (0.35 + 0.65 * n1.r) * (0.6 + 0.8 * core);
        float dust = smoothstep(0.52, 0.72, n2.g * 0.7 + n1.b * 0.5) * exp(-b * b * 300.0);
        band *= 1.0 - 0.75 * dust;
        vec3 mw = band * mix(vec3(0.55, 0.62, 0.95), vec3(1.0, 0.86, 0.66), core) * 0.022;
        mw += exp(-b * b * 900.0) * n2.r * 0.004 * vec3(0.8, 0.85, 1.0);
        float horizonFade = smoothstep(-0.02, 0.35, d.y);
        vec3 airglow = vec3(0.0010, 0.0016, 0.0030) * (1.0 + 2.5 * (1.0 - smoothstep(0.0, 0.5, d.y)));
        col += (mw * horizonFade + airglow) * uNightSky;
        float mm = max(dot(d, uMoonDir), 0.0);
        col += uMoonGlow * (pow(mm, 400.0) * 1.5 + pow(mm, 40.0) * 0.12 + pow(mm, 6.0) * 0.02) * uNightSky;
      }
      gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
    }`,
});
export const sky = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), skyMat);
sky.scale.setScalar(20000); sky.frustumCulled = false;
sky.renderOrder = 1e6; // last opaque: only shades sky pixels that nothing covers
scene.add(sky);
const skyScene = new THREE.Scene(); const skyClone = new THREE.Mesh(sky.geometry, skyMat); skyClone.scale.setScalar(100); skyScene.add(skyClone);
const pmrem = new THREE.PMREMGenerator(renderer);
let envRT = null;
const probeRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.FloatType });
const probeCam = new THREE.PerspectiveCamera(80, 1, 0.1, 1000);
const probeBuf = new Float32Array(64);
function probeSky(dir, out) {
  probeCam.position.set(0, 0, 0); probeCam.lookAt(dir); probeCam.updateMatrixWorld();
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(probeRT); renderer.render(skyScene, probeCam); renderer.setRenderTarget(prev);
  renderer.readRenderTargetPixels(probeRT, 0, 0, 4, 4, probeBuf);
  let r = 0, g = 0, b = 0; for (let i = 0; i < 16; i++) { r += probeBuf[i * 4]; g += probeBuf[i * 4 + 1]; b += probeBuf[i * 4 + 2]; }
  return out.setRGB(r / 16, g / 16, b / 16);
}

// ---------------------------------------------------------------- clouds (volumetric, see clouds.js)
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
    const mag = Math.pow(rng(), 7), t = rng(); // few bright, many faint
    const b = 0.06 + mag * 2.6;
    const hot = t < 0.25 ? [0.72, 0.82, 1.1] : t < 0.8 ? [1, 0.97, 0.92] : t < 0.95 ? [1.1, 0.9, 0.7] : [1.15, 0.75, 0.55];
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
    attribute vec3 color; attribute vec2 aMag; uniform float uVis, uTime, uPR; varying vec3 vCol;
    void main(){
      vec3 wd = normalize(mat3(modelMatrix) * position);
      float hz = smoothstep(-0.01, 0.25, wd.y);
      float tw = 1.0 + (0.18 + 0.5 * (1.0 - hz)) * sin(uTime * (4.0 + aMag.y * 7.0) + aMag.y * 91.0) * sin(uTime * 1.7 + aMag.y * 37.0);
      vCol = color * uVis * tw * mix(0.25, 1.0, hz) * mix(vec3(1.0, 0.75, 0.55), vec3(1.0), hz);
      gl_PointSize = (1.3 + 2.4 * sqrt(aMag.x)) * uPR;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */`
    varying vec3 vCol;
    void main(){ vec2 q = gl_PointCoord - 0.5; float a = exp(-dot(q, q) * 14.0); gl_FragColor = vec4(vCol * a, a); }`,
});
export const stars = new THREE.Points(starGeo, starMat); stars.frustumCulled = false; stars.layers.set(1); scene.add(stars);

// ---------------------------------------------------------------- moon
function makeMoonTexture() {
  const Sz = 256, cv = document.createElement('canvas'); cv.width = cv.height = Sz;
  const g = cv.getContext('2d'), rng = mulberry32(3);
  const grd = g.createRadialGradient(Sz * 0.45, Sz * 0.45, 10, Sz / 2, Sz / 2, Sz * 0.48);
  grd.addColorStop(0, '#fbf8ee'); grd.addColorStop(1, '#cfcabb');
  g.fillStyle = grd; g.beginPath(); g.arc(Sz / 2, Sz / 2, Sz * 0.47, 0, 7); g.fill();
  g.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < 12; i++) { g.fillStyle = `rgba(110,108,100,${0.12 + rng() * 0.2})`; g.beginPath(); g.ellipse(rng() * Sz, rng() * Sz, 18 + rng() * 45, 12 + rng() * 35, rng() * 3, 0, 7); g.fill(); } // maria
  for (let i = 0; i < 70; i++) { const x = rng() * Sz, y = rng() * Sz, r = 1.5 + Math.pow(rng(), 3) * 14; g.fillStyle = `rgba(95,92,85,${0.15 + rng() * 0.2})`; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.fillStyle = 'rgba(255,255,250,0.18)'; g.beginPath(); g.arc(x - r * 0.25, y - r * 0.25, r * 0.7, 0, 7); g.fill(); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const moonMat = new THREE.MeshBasicMaterial({ map: makeMoonTexture(), transparent: true, depthWrite: false, fog: false, color: new THREE.Color(1, 1, 1) });
const moon = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), moonMat);
moon.scale.setScalar(200); moon.frustumCulled = false; scene.add(moon);

// ---------------------------------------------------------------- lights
export const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.castShadow = true;
sun.shadow.camera.layers.enableAll();
sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.06;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(0x4a5a80, 0x151515, 0); scene.add(hemi);
export function applyShadowQuality() {
  sun.shadow.mapSize.set(Q.shadow, Q.shadow);
  const c = sun.shadow.camera; c.left = -Q.box; c.right = Q.box; c.top = Q.box; c.bottom = -Q.box; c.near = 1; c.far = 1600; c.updateProjectionMatrix();
  if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
}
applyShadowQuality();

// ---------------------------------------------------------------- update
// exposure: pre-applied to the scene before bloom / rays (see post.js) so their thresholds stay in display range
export const env = { night: 0, day: 1, lightDir: S.uLightDir.value, azimuth: 2.2, exposure: 0.2, wb: new THREE.Vector3(1, 1, 1), moonDir: new THREE.Vector3() };
const tmpC = new THREE.Color(), tmpC2 = new THREE.Color(), T3 = [0, 0, 0], M3 = [0, 0, 0], C3 = [0, 0, 0], wbTmp = new THREE.Vector3(), tmpV = new THREE.Vector3();
let lastEnvHour = -99, envTimer = 0, expSmooth = -1;
const fogCol = new THREE.Color(), horizonCol = new THREE.Color(), zenithCol = new THREE.Color(), awayCol = new THREE.Color();
const lum = c => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
export function updateSky(force) {
  const th = (time.hour - 6) / 12 * Math.PI;
  sunDir.set(Math.cos(th), Math.sin(th) * Math.cos(TILT), Math.sin(th) * Math.sin(TILT)).applyAxisAngle(up, env.azimuth).normalize();
  env.moonDir.copy(sunDir).negate();
  updateCelestial(th);
  const el = sunDir.y;
  const night = smoothstep(0.02, -0.16, el);
  env.night = night; env.day = smoothstep(-0.05, 0.12, el);
  updateLUT(force);
  // direct light: sun through the atmosphere, or the moon once the sun is well down
  transmittance(sunDir, T3);
  const sunVis = smoothstep(-0.012, 0.01, el); // disc sinking below the horizon
  transmittance(env.moonDir, M3);
  const moonVis = smoothstep(-0.012, 0.01, -el);
  const sunI = [T3[0] * SUN_E * sunVis, T3[1] * SUN_E * sunVis, T3[2] * SUN_E * sunVis];
  const moonI = [M3[0] * MOON_E * MOON_TINT[0] * moonVis * 0.55, M3[1] * MOON_E * MOON_TINT[1] * moonVis * 0.55, M3[2] * MOON_E * MOON_TINT[2] * moonVis * 0.55];
  // clouds (~2 km up) still see the sun for a while after it has set for us, through a long, red path
  transmittance(sunDir, C3, 2100);
  const cVis = smoothstep(-0.03, -0.012, el);
  cloudSunCol.value.set(C3[0], C3[1], C3[2]).multiplyScalar(SUN_E * cVis);
  if (el < -0.012) cloudSunCol.value.addScaledVector(tmpV.set(moonI[0], moonI[1], moonI[2]), 1 - cVis);
  cloudLightDir.value.copy(cVis > 0.3 ? sunDir : env.moonDir);
  const useSun = el > -0.035;
  const L = useSun ? sunI : moonI;
  env.lightDir.copy(useSun ? sunDir : env.moonDir);
  const li = Math.max(L[0], L[1], L[2], 1e-6);
  sun.color.setRGB(L[0] / li, L[1] / li, L[2] / li); sun.intensity = li;
  S.uSunCol.value.set(L[0], L[1], L[2]);
  // sun disc radiance (heavily compressed from the physical ~1e4x so bloom stays pretty rather than blinding)
  skyU.uSunDisk.value.set(sunI[0], sunI[1], sunI[2]).multiplyScalar(90);
  skyU.uMoonDir.value.copy(env.moonDir);
  skyU.uMoonGlow.value.set(moonI[0], moonI[1], moonI[2]).multiplyScalar(0.6);
  hemi.intensity = night * 0.55;
  const starVis = smoothstep(-0.06, -0.2, el);
  starMat.uniforms.uVis.value = starVis; stars.visible = starVis > 0.01;
  starMat.uniforms.uPR.value = renderer.getPixelRatio();
  skyU.uNightSky.value = smoothstep(-0.04, -0.22, el);
  moon.visible = -sunDir.y > -0.05;
  moonMat.color.setScalar(0.35 + 1.4 * night);
  envTimer -= 1;
  if (force || Math.abs(time.hour - lastEnvHour) > 0.08 || envTimer <= 0) {
    lastEnvHour = time.hour; envTimer = 240;
    if (envRT) envRT.dispose();
    envRT = pmrem.fromScene(skyScene, 0.04);
    scene.environment = envRT.texture;
    probeSky(new THREE.Vector3(-sunDir.z, 0.06, sunDir.x).normalize(), horizonCol);
    probeSky(new THREE.Vector3(sunDir.x, 0.05, sunDir.z).normalize(), fogCol);
    // base fog colour = sky around the horizon; the sun-facing glow is added per pixel by the fog shader
    probeSky(new THREE.Vector3(-sunDir.x, 0.06, -sunDir.z).normalize(), awayCol);
    fogCol.lerp(horizonCol, 0.55).lerp(awayCol, 0.35);
    probeSky(new THREE.Vector3(0.01, 1, 0), zenithCol);
  }
  scene.fog.color.copy(fogCol);
  scene.environmentIntensity = 1.0;
  S.uFogCol.value.set(scene.fog.color.r, scene.fog.color.g, scene.fog.color.b);
  const amb = tmpC2.copy(zenithCol).lerp(horizonCol, 0.5).multiplyScalar(0.55);
  S.uAmb.value.set(amb.r, amb.g, amb.b);
  const fs = fogU.fogSunDir.value; fs.x = sunDir.x; fs.y = sunDir.y; fs.z = sunDir.z;
  const fsc = fogU.fogSunColor.value, glow = (1 - night) * 0.02 * (1.0 + smoothstep(0.35, 0.0, el) * 2.0); // stronger haze glow when the sun is low
  fsc.x = sunI[0] * glow; fsc.y = sunI[1] * glow; fsc.z = sunI[2] * glow;
  // exposure from the light actually arriving on a horizontal surface (partial adaptation: dusk and night stay dim)
  const Eh = lum(tmpC.setRGB(L[0], L[1], L[2])) * Math.max(env.lightDir.y, 0) + Math.PI * lum(amb) * 1.6 + 0.02;
  // twilight may open up further than deep night so the blue hour reads as blue rather than black
  const target = clamp(1.05 / Math.pow(Eh, 0.62), 0.12, lerp(3.0, 1.45, smoothstep(-0.07, -0.2, el)));
  const k = force || expSmooth < 0 ? 1 : 0.05;
  expSmooth = k === 1 ? target : lerp(expSmooth, target, k);
  env.exposure = expSmooth;
  // partial white balance toward the current illuminant (eyes and cameras adapt): golden hour stays golden
  // without drowning everything in orange, moonlight stays blue without going cyan
  const up2 = Math.max(env.lightDir.y, 0), sa = Math.PI * 1.6;
  wbTmp.set(L[0] * up2 + amb.r * sa + 1e-4, L[1] * up2 + amb.g * sa + 1e-4, L[2] * up2 + amb.b * sa + 1e-4);
  const wl = 0.2126 * wbTmp.x + 0.7152 * wbTmp.y + 0.0722 * wbTmp.z;
  wbTmp.set(Math.pow(wl / wbTmp.x, 0.32), Math.pow(wl / wbTmp.y, 0.32), Math.pow(wl / wbTmp.z, 0.32));
  wbTmp.multiplyScalar(1 / (0.2126 * wbTmp.x + 0.7152 * wbTmp.y + 0.0722 * wbTmp.z));
  env.wb.lerp(wbTmp, k);
}

const lsInv = new THREE.Matrix4(), lsMat = new THREE.Matrix4(), snapV = new THREE.Vector3(), origin = new THREE.Vector3();
export function followCamera(groundAt, yaw) {
  const c = camera.position;
  clouds.position.copy(c);
  const cs = cloudShadow; cs.p.x = S.uTime.value; cs.p.y = cloudU.uCover.value; cs.p.z = (cloudU.uBottom.value + cloudU.uTop.value) / 2;
  cs.sun.x = env.lightDir.x; cs.sun.y = env.lightDir.y; cs.sun.z = env.lightDir.z;
  stars.position.copy(c); stars.quaternion.copy(celestial.q);
  moon.position.copy(c).addScaledVector(env.moonDir, 9000); moon.lookAt(c);
  // shadow frustum centred ahead of the camera, snapped to shadow texels to avoid shimmering
  const center = snapV.set(c.x - Math.sin(yaw) * Q.box * 0.35, 0, c.z - Math.cos(yaw) * Q.box * 0.35);
  center.y = groundAt(center.x, center.z);
  lsMat.lookAt(origin, env.lightDir.clone().negate(), up);
  lsInv.copy(lsMat).invert();
  center.applyMatrix4(lsInv);
  const texel = (Q.box * 2) / Q.shadow;
  center.x = Math.round(center.x / texel) * texel; center.y = Math.round(center.y / texel) * texel;
  center.applyMatrix4(lsMat);
  sun.target.position.copy(center);
  sun.position.copy(center).addScaledVector(env.lightDir, 700);
  sun.target.updateMatrixWorld();
  fogU.fogParams.value.x = c.y;
}
