// Sky, clouds, stars, moon, sun/moon light and the day-night cycle — hand-painted, anime style.
// Everything is driven by an art-directed palette keyed on the time of day (vivid noon blue, peach sunrise, orange and
// pink sunset, violet dusk, deep blue night): the sky gradient, sunlight, coloured shadow fill, haze, clouds and exposure
// are all interpolated from the same keyframes, so every hour looks like one painting.
import { THREE, renderer, scene, camera, S, sunDir, fogU, Q, clamp, lerp, smoothstep, mulberry32, withStandardDepth } from './core.js';
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
  tNoise: S.tNoise, uTime: S.uTime, uSunDir: S.uSunDir,
  uZen: { value: pal.zen }, uHor: { value: pal.hor }, uGlow: { value: pal.glow }, uGnd: { value: pal.gnd }, uGlowAmt: { value: 0 },
  uSunDisk: { value: new THREE.Vector3() }, uMoonDir: { value: new THREE.Vector3() }, uMoonGlow: { value: new THREE.Vector3() },
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
    uniform sampler2D tNoise; uniform float uTime, uNightSky, uGlowAmt; uniform vec3 uSunDir, uSunDisk, uMoonDir, uMoonGlow, uZen, uHor, uGlow, uGnd, uTownCol; uniform mat3 uCel; uniform vec4 uTown;
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
scene.add(sky);
const skyScene = new THREE.Scene(); const skyClone = new THREE.Mesh(sky.geometry, skyMat); skyClone.scale.setScalar(100); skyScene.add(skyClone);
const pmrem = new THREE.PMREMGenerator(renderer);
let envRT = null;

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
export const stars = new THREE.Points(starGeo, starMat); stars.frustumCulled = false; stars.layers.set(1); scene.add(stars);

// ---------------------------------------------------------------- moon
function makeMoonTexture() {
  const Sz = 256, cv = document.createElement('canvas'); cv.width = cv.height = Sz;
  const g = cv.getContext('2d'), rng = mulberry32(3);
  const grd = g.createRadialGradient(Sz * 0.42, Sz * 0.42, 10, Sz / 2, Sz / 2, Sz * 0.48);
  grd.addColorStop(0, '#fffdf2'); grd.addColorStop(1, '#e6e0f5');
  g.fillStyle = grd; g.beginPath(); g.arc(Sz / 2, Sz / 2, Sz * 0.47, 0, 7); g.fill();
  g.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < 9; i++) { g.fillStyle = `rgba(170,165,200,${0.14 + rng() * 0.16})`; g.beginPath(); g.ellipse(rng() * Sz, rng() * Sz, 18 + rng() * 40, 12 + rng() * 30, rng() * 3, 0, 7); g.fill(); } // soft maria
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const moonMat = new THREE.MeshBasicMaterial({ map: makeMoonTexture(), transparent: true, depthWrite: false, fog: false, color: new THREE.Color(1, 1, 1) });
const moon = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), moonMat);
moon.scale.setScalar(260); moon.frustumCulled = false; scene.add(moon);

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
}
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
  skyU.uMoonGlow.value.set(MOON.r, MOON.g, MOON.b).multiplyScalar(smoothstep(0.0, -0.1, el));
  const starVis = smoothstep(-0.04, -0.18, el);
  starMat.uniforms.uVis.value = starVis; stars.visible = starVis > 0.01;
  starMat.uniforms.uPR.value = renderer.getPixelRatio();
  skyU.uNightSky.value = smoothstep(-0.03, -0.2, el);
  moon.visible = -sunDir.y > -0.05;
  moonMat.color.setScalar(0.6 + 1.6 * night);
  cloudPal.lit.copy(p.cLit); cloudPal.shade.copy(p.cShade); cloudPal.dir.copy(env.lightDir);
  // the environment map (sky gradient + ground bounce) is the coloured ambient / shadow fill
  envTimer -= 1;
  if (force || Math.abs(time.hour - lastEnvHour) > 0.05 || envTimer <= 0) {
    lastEnvHour = time.hour; envTimer = 180;
    if (envRT) envRT.dispose();
    const tw = skyU.uTown.value.w; skyU.uTown.value.w = 0; // the glow is local: keep it out of the global ambient
    envRT = withStandardDepth(() => pmrem.fromScene(skyScene, 0.04));
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

const lsInv = new THREE.Matrix4(), lsMat = new THREE.Matrix4(), snapV = new THREE.Vector3(), origin = new THREE.Vector3();
let csmFrame = 0;
export function followCamera(groundAt, yaw) {
  const c = camera.position;
  skyU.uTown.value.set(townGlow.x - c.x, townGlow.z - c.z, townGlow.r, townGlow.s * env.night);
  clouds.position.copy(c);
  const cs = cloudShadow; cs.p.x = S.uTime.value; cs.p.y = cloudU.uCover.value; cs.p.z = (cloudU.uBottom.value + cloudU.uTop.value) / 2;
  cs.sun.x = env.lightDir.x; cs.sun.y = env.lightDir.y; cs.sun.z = env.lightDir.z;
  stars.position.copy(c); stars.quaternion.copy(celestial.q);
  moon.position.copy(c).addScaledVector(env.moonDir, 9000); moon.lookAt(c);
  // every cascade box sits a little ahead of the camera, snapped to its shadow texels so edges never crawl; far
  // cascades re-render every few frames (staggered), which the eye cannot tell at their distance
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  lsMat.lookAt(origin, env.lightDir.clone().negate(), up);
  lsInv.copy(lsMat).invert();
  csmFrame++;
  cascades.forEach((l, i) => {
    const [half, size] = Q.csm[i], rate = Q.csmRate[i] || 1;
    if (csmFrame % rate !== i % rate && l.shadow.map) return;
    const center = snapV.set(c.x + fx * half * 0.5, 0, c.z + fz * half * 0.5);
    center.y = groundAt(center.x, center.z);
    center.applyMatrix4(lsInv);
    const texel = (half * 2) / size;
    center.x = Math.round(center.x / texel) * texel; center.y = Math.round(center.y / texel) * texel;
    center.applyMatrix4(lsMat);
    l.target.position.copy(center);
    l.position.copy(center).addScaledVector(env.lightDir, CSM_D);
    l.target.updateMatrixWorld(); l.updateMatrixWorld();
    l.shadow.needsUpdate = true;
  });
  for (let i = 1; i < cascades.length; i++) cascades[i].color.setRGB(0, 0, 0);
  fogU.fogParams.value.x = c.y;
  // aerial perspective: terrain and forests now reach the horizon, so the haze no longer hides a draw distance; it only
  // layers the far ridges into the sky (about half-hazed at 3 km, three quarters at 10 km, gone by ~20 km)
  fogU.fogHaze.value.x = 600; fogU.fogHaze.value.y = 0.00015 * (env.haze || 1);
}
