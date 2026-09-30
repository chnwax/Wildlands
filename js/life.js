// Ambient life: fireflies over the meadows at dusk and night, pollen / dust motes that catch the sun when backlit,
// flower blossoms in colourful patches, butterflies, sakura petals, and a flock of birds wheeling over the valley.
// Everything is GPU-animated from a handful of uniforms.
import { THREE, scene, camera, renderer, S, fogU, clamp, smoothstep, mulberry32 } from './core.js';
import { GLSL_HEIGHT, GLSL_PAVE, FLOWER_GLSL, turfU } from './terrain.js';
import { env } from './sky.js';

const U = { uPx: { value: 1 }, uPR: { value: 1 }, uFire: { value: 0 }, uMote: { value: 0 } };

// (three's AdditiveBlending weights the source by its alpha, so these shaders premultiply and write alpha 1)
// particles that live in a box wrapped around the camera (like the grass), so a few hundred cover the whole world
function wrappedPoints(count, seed, material) {
  const rng = mulberry32(seed), r = new Float32Array(count * 4);
  for (let i = 0; i < r.length; i++) r[i] = rng();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  g.setAttribute('aRnd', new THREE.BufferAttribute(r, 4));
  const p = new THREE.Points(g, material); p.frustumCulled = false; p.layers.set(1); // not in water reflections
  scene.add(p);
  return p;
}
const wrapGLSL = /* glsl */`
  vec2 wrapAround(vec2 base, float R){ return uCam.xz + mod(base * 2.0 * R - uCam.xz + R, 2.0 * R) - R; }
  float pointPx(float worldSize, float z){ return worldSize * uPx / max(z, 0.1); }`;

// ---------------------------------------------------------------- fireflies
function fireflies(world) {
  const R = 38;
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    uniforms: Object.assign({ uCam: S.uCam, uTime: S.uTime, uWaterLv: { value: world.waterLevel ?? 0 } }, world.hf.U, U),
    vertexShader: /* glsl */`
      attribute vec4 aRnd; uniform vec3 uCam; uniform float uTime, uFire, uWaterLv, uPx, uPR;
      uniform sampler2D tMask, tMask2;
      varying float vA;
      ${GLSL_HEIGHT}
      ${wrapGLSL}
      void main(){
        vec2 wp = wrapAround(aRnd.xy, ${R.toFixed(1)});
        float t = uTime * (0.12 + 0.1 * aRnd.z) + aRnd.w * 60.0;
        wp += vec2(sin(t * 1.3 + aRnd.z * 10.0) + 0.5 * sin(t * 2.9 + aRnd.x * 5.0), cos(t * 0.9 + aRnd.w * 7.0) + 0.5 * cos(t * 2.3)) * 1.2;
        float g = hAt(wp);
        vec4 m2 = texture(tMask2, maskUV(wp)), m = texture(tMask, maskUV(wp));
        float y = g + 0.35 + 1.9 * aRnd.z * aRnd.z + sin(t * 2.1) * 0.25;
        // slow, irregular flashes: a quick rise and a longer glow, a few seconds apart
        float ph = fract(uTime * (0.18 + 0.22 * aRnd.w) + aRnd.x * 7.0);
        float blink = smoothstep(0.0, 0.05, ph) * smoothstep(0.32, 0.08, ph);
        float d = length(wp - uCam.xz);
        float where = step(uWaterLv + 0.4, g) * (1.0 - m2.r) * (1.0 - m2.b) * mix(0.55, 1.0, m.r);
        vA = uFire * blink * where * (1.0 - smoothstep(${(R * 0.65).toFixed(1)}, ${R.toFixed(1)}, d));
        vec4 mv = viewMatrix * vec4(wp.x, y, wp.y, 1.0);
        gl_Position = projectionMatrix * mv;
        // never smaller than a few pixels (a 2 px sprite is a square that blooms into a square); far ones dim instead
        float px = pointPx(0.2, -mv.z), minPx = 5.0 * uPR;
        vA *= min(1.0, (px * px) / (minPx * minPx));
        gl_PointSize = vA > 0.002 ? clamp(px, minPx, 16.0 * uPR) : 0.0;
        if (gl_PointSize <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // a 0-sized point still rasterises as one pixel
      }`,
    fragmentShader: /* glsl */`
      varying float vA;
      void main(){ vec2 q = gl_PointCoord - 0.5; float r = dot(q, q); float a = (exp(-r * 28.0) + exp(-r * 9.0) * 0.2) * smoothstep(0.25, 0.12, r);
        gl_FragColor = vec4(vec3(0.75, 1.0, 0.32) * 2.2 * vA * a, 1.0); }`,
  });
  return wrappedPoints(800, 71, mat);
}

// ---------------------------------------------------------------- pollen / dust motes (forward scattering toward the sun)
function motes(world) {
  const R = 13;
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    uniforms: Object.assign({ uCam: S.uCam, uTime: S.uTime, uSunDir: S.uSunDir, uSunCol: S.uSunCol, uWind: S.uWind }, world.hf.U, U),
    vertexShader: /* glsl */`
      attribute vec4 aRnd; uniform vec3 uCam, uSunDir, uSunCol; uniform float uTime, uMote, uPx, uPR, uWind;
      varying vec3 vC;
      ${GLSL_HEIGHT}
      ${wrapGLSL}
      void main(){
        float t = uTime + aRnd.w * 100.0;
        vec2 drift = vec2(1.0, 0.35) * uTime * 0.35 * uWind + vec2(sin(t * 0.37 + aRnd.z * 9.0), cos(t * 0.29 + aRnd.x * 7.0)) * 0.8;
        vec2 wp = wrapAround(fract(aRnd.xy + drift / ${(2 * R).toFixed(1)}), ${R.toFixed(1)});
        float y = hAt(wp) + 0.2 + 5.5 * aRnd.z + sin(t * 0.5) * 0.4;
        vec3 w = vec3(wp.x, y, wp.y);
        vec3 v = normalize(w - uCam);
        float mu = dot(v, uSunDir), g = 0.82;
        float phase = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * mu, 1.5) * 0.08 + 0.015;
        float d = length(w - uCam);
        float fade = smoothstep(0.6, 1.6, d) * (1.0 - smoothstep(${(R * 0.6).toFixed(1)}, ${R.toFixed(1)}, d));
        float tw = 0.6 + 0.4 * sin(t * 3.0 + aRnd.y * 20.0);
        vC = min(uSunCol * phase * fade * tw * uMote * 0.12, vec3(0.45));   // subtle glints: never bright enough to bloom
        vec4 mv = viewMatrix * vec4(w, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uMote > 0.001 ? clamp(pointPx(0.02, -mv.z), 1.0, 2.0 * uPR) : 0.0;
        if (gl_PointSize <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // a 0-sized point still rasterises as one pixel
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vC;
      void main(){ vec2 q = gl_PointCoord - 0.5; float r = dot(q, q); gl_FragColor = vec4(vC * exp(-r * 16.0) * smoothstep(0.25, 0.1, r), 1.0); }`,
  });
  return wrappedPoints(700, 13, mat);
}

// ---------------------------------------------------------------- flowers: little five-petal sprites in colour patches
// (the same patch noise as the grass shader, so far-off blade flowers and these close-up blossoms agree)
function flowers(world) {
  const R = 30, COUNT = 14000;
  const mat = new THREE.ShaderMaterial({
    transparent: false, depthWrite: true, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
    vertexShader: /* glsl */`
      attribute vec4 aRnd; uniform vec3 uCam, uSunCol, uAmb; uniform float uPx, uPR, uWaterLv, uTime, uWind;
      uniform sampler2D tMask, tMask2, tNoise; uniform vec4 uTurf0;
      varying vec3 vCol; varying float vAng;
      ${GLSL_HEIGHT}
      ${GLSL_PAVE}
      ${wrapGLSL}
      ${FLOWER_GLSL}
      #include <common>
      #include <fog_pars_vertex>
      void main(){
        vec2 wp = wrapAround(aRnd.xy, ${R.toFixed(1)});
        float g = hAt(wp);
        vec4 z1 = textureLod(tNoise, wp * 0.0021, 0.0), z2 = textureLod(tNoise, wp * 0.013, 0.0), z3 = textureLod(tNoise, wp * 0.06, 0.0);
        vec4 m = texture(tMask, maskUV(wp)), m2 = texture(tMask2, maskUV(wp));
        float gx = hAt(wp + vec2(uCell, 0.0)) - hAt(wp - vec2(uCell, 0.0)), gz = hAt(wp + vec2(0.0, uCell)) - hAt(wp - vec2(0.0, uCell));
        float flat_ = 2.0 * uCell / length(vec3(gx, 2.0 * uCell, gz));
        // the same flowers-per-square-metre budget as the grass blades beyond this radius: this set holds
        // ${(COUNT / (4 * R * R)).toFixed(2)} sprites per m², each kept with probability density / that; the sward's own thinning
        // (patchy density, forest, tree shade) applies as it does to the blades
        float alpine = smoothstep(85.0, 150.0, g - uWaterLv);
        // (the same factors as the blades' density: patchy sward, forest and tree shade, town ground, mown lawns)
        float sward = smoothstep(0.1, 0.45, z2.g + z3.g * 0.35) * (1.0 - smoothstep(0.2, 0.75, m.r + (z3.r - 0.5) * 0.35) * 0.88) * (1.0 - m.b * 0.92)
          * (1.0 - m2.b) * (1.0 - smoothstep(0.2, 0.7, m2.r) * 0.85) * (1.0 - 0.45 * m2.a);
        float flD = flowerDensity(flowerPatch(z1, z2, z3, m.r), alpine) * sward * step(0.35, sward) * (1.0 - 0.6 * m2.a);
        // strictly off roads, lots, paddies and water (the masks are bilinear at metre scale)
        float ok = step(aRnd.w * ${(COUNT / (4 * R * R)).toFixed(3)}, flD) * step(uWaterLv + 1.0, g) * step(0.86, flat_) * step(m2.r, 0.05) * step(m2.b, 0.05) * step(m2.g, 0.3) * step(paveAt(wp), 0.03);
        ok *= 1.0 - step(uTurf0.x, wp.x) * step(wp.x, uTurf0.z) * step(uTurf0.y, wp.y) * step(wp.y, uTurf0.w);                                  // none on sports turf
        float d = length(wp - uCam.xz);
        float fade = 1.0 - smoothstep(${(R * 0.7).toFixed(1)}, ${R.toFixed(1)}, d);
        float sway = sin(uTime * (1.5 + aRnd.z) + aRnd.x * 30.0) * 0.04 * uWind;
        vec3 w = vec3(wp.x + sway, g + 0.18 + 0.32 * aRnd.z, wp.y + sway * 0.5);
        float pick = fract(z2.g * 5.3 + z3.b * 0.6 + step(0.92, aRnd.y) * 0.37);
        vec3 fc = pick < 0.26 ? vec3(1.0, 0.95, 0.86) : pick < 0.5 ? vec3(1.0, 0.72, 0.06) : pick < 0.7 ? vec3(1.0, 0.36, 0.55)
                : pick < 0.88 ? vec3(0.42, 0.3, 1.0) : vec3(1.0, 0.3, 0.12);
        vCol = fc * (uAmb * 0.55 + uSunCol * 0.33 + 0.03 * min(1.0, dot(uSunCol, vec3(0.3, 0.59, 0.11)))); // no glow floor at night
        vAng = aRnd.y * 6.2831;
        vec4 mvPosition = viewMatrix * vec4(w, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        // sub-pixel blossoms are thinned out by coverage instead of all drawing as full pixels (no sparkle at distance)
        float fsz = pointPx(0.16 + 0.08 * aRnd.x, -mvPosition.z) * fade;
        gl_PointSize = ok * fade > 0.01 && (fsz >= 1.0 || fract(aRnd.y * 91.7 + aRnd.z * 7.3) < fsz * fsz) ? clamp(fsz, 1.0, 40.0 * uPR) : 0.0;
        if (gl_PointSize <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // a 0-sized point still rasterises as one pixel
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vCol; varying float vAng;
      #include <common>
      #include <fog_pars_fragment>
      void main(){
        vec2 q = (gl_PointCoord - 0.5) * 2.0;
        float r = length(q), a = atan(q.y, q.x) + vAng;
        float petal = 0.62 + 0.38 * cos(a * 5.0);
        if (r > petal) discard;
        vec3 c = r < 0.28 ? vec3(1.0, 0.8, 0.2) * length(vCol) * 0.75 : vCol * mix(1.0, 0.72, smoothstep(0.3, 1.0, r / petal));
        gl_FragColor = vec4(c, 1.0);
        #include <fog_fragment>
      }`,
  });
  Object.assign(mat.uniforms, world.hf.U, U, turfU, { uCam: S.uCam, uSunCol: S.uSunCol, uAmb: S.uAmb, uTime: S.uTime, uWind: S.uWind, tNoise: S.tNoise, uWaterLv: { value: world.waterLevel ?? 0 } });
  return wrappedPoints(COUNT, 29, mat);
}

// ---------------------------------------------------------------- sakura petals drifting down from every blossom tree
function petals(trees) {
  const PER = 34, n = trees.length * PER, rng = mulberry32(61);
  const tA = new Float32Array(n * 4), rA = new Float32Array(n * 4);
  trees.forEach((t, i) => { for (let k = 0; k < PER; k++) {
    const j = (i * PER + k) * 4; tA[j] = t.x; tA[j + 1] = t.y; tA[j + 2] = t.z; tA[j + 3] = t.s;
    rA[j] = rng(); rA[j + 1] = rng(); rA[j + 2] = rng(); rA[j + 3] = rng();
  } });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('aTree', new THREE.BufferAttribute(tA, 4));
  g.setAttribute('aRnd', new THREE.BufferAttribute(rA, 4));
  const mat = new THREE.ShaderMaterial({
    fog: true, uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
    vertexShader: /* glsl */`
      attribute vec4 aTree, aRnd; uniform vec3 uCam, uSunCol, uAmb; uniform float uTime, uWind, uPx, uPR;
      varying vec3 vCol; varying float vAng;
      #include <common>
      #include <fog_pars_vertex>
      void main(){
        float life = 8.0 + aRnd.x * 6.0, ph = fract(uTime / life + aRnd.y);
        float S = aTree.w, crown = S * 0.62, R = S * 0.36 * sqrt(aRnd.z);
        float a0 = aRnd.w * 6.2831;
        vec3 p = vec3(aTree.x + cos(a0) * R, aTree.y + crown * (0.75 + 0.2 * aRnd.x), aTree.z + sin(a0) * R);
        float fallH = p.y - aTree.y + 0.2;
        p.y -= ph * fallH;
        // blown downwind, fluttering in little loops
        vec2 wind = normalize(vec2(1.0, 0.35)) * (1.0 + 2.5 * uWind);
        float sw = uTime * (1.6 + aRnd.z) + aRnd.x * 40.0;
        p.xz += wind * ph * life * 0.45 + vec2(sin(sw), cos(sw * 0.8)) * 0.45 * ph;
        p.y += sin(sw * 1.3) * 0.12;
        float fade = smoothstep(0.0, 0.06, ph) * (1.0 - smoothstep(0.9, 1.0, ph));
        float d = length(p - uCam);
        vCol = vec3(1.0, 0.76, 0.84) * (uAmb * 0.6 + uSunCol * 0.34 + 0.05 * min(1.0, dot(uSunCol, vec3(0.3, 0.59, 0.11))));
        vAng = uTime * (1.5 + aRnd.w * 2.0) + aRnd.z * 6.2831;
        vec4 mvPosition = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        float psz = 0.075 * uPx / max(-mvPosition.z, 0.1) * fade;
        gl_PointSize = d < 70.0 && fade > 0.01 && (psz >= 1.0 || fract(aRnd.y * 53.1 + aRnd.x * 3.7) < psz * psz) ? clamp(psz, 1.0, 26.0 * uPR) : 0.0;
        if (gl_PointSize <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // a 0-sized point still rasterises as one pixel
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vCol; varying float vAng;
      #include <common>
      #include <fog_pars_fragment>
      void main(){
        vec2 q = (gl_PointCoord - 0.5) * 2.0;
        float c = cos(vAng), s = sin(vAng); q = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
        float e = dot(q / vec2(0.95, 0.55), q / vec2(0.95, 0.55));
        if (e > 1.0 || (q.x > 0.6 && abs(q.y) < 0.12)) discard;   // oval petal with a notch at the tip
        gl_FragColor = vec4(vCol * mix(1.08, 0.86, e), 1.0);
        #include <fog_fragment>
      }`,
  });
  Object.assign(mat.uniforms, U, { uCam: S.uCam, uSunCol: S.uSunCol, uAmb: S.uAmb, uTime: S.uTime, uWind: S.uWind });
  const pts = new THREE.Points(g, mat); pts.frustumCulled = false; pts.layers.set(1); scene.add(pts);
  return pts;
}

// ---------------------------------------------------------------- butterflies fluttering over the meadows by day
function butterflies(world) {
  const N = 110, R = 24, rng = mulberry32(83);
  // two wings, each a quad hinged on the body axis (x: out along the wing, y: along the body)
  const P = [], W = [];
  for (const side of [-1, 1]) { P.push(0, -1, 0, side, -1, 0, side, 1, 0, 0, 1, 0); W.push(side, side, side, side); }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(W, 1));
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6]);
  const r = new Float32Array(N * 4); for (let i = 0; i < r.length; i++) r[i] = rng();
  g.setAttribute('aRnd', new THREE.InstancedBufferAttribute(r, 4));
  g.instanceCount = N;
  const mat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide, fog: true, uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
    vertexShader: /* glsl */`
      attribute vec4 aRnd; uniform vec3 uCam, uSunCol, uAmb; uniform float uTime, uVis, uWaterLv, uPx;
      uniform sampler2D tMask2;
      varying vec2 vUv; varying vec3 vLight; varying float vKind;
      ${GLSL_HEIGHT}
      ${wrapGLSL}
      #include <common>
      #include <fog_pars_vertex>
      void main(){
        float t = uTime * (0.35 + 0.2 * aRnd.z) + aRnd.w * 50.0;
        vec2 base = wrapAround(aRnd.xy, ${R.toFixed(1)});
        vec2 wp = base + vec2(sin(t) + 0.5 * sin(t * 2.3 + 1.0), cos(t * 0.8) + 0.5 * sin(t * 1.7)) * 2.5;
        vec2 vel = vec2(cos(t) + 1.15 * cos(t * 2.3 + 1.0), -0.8 * sin(t * 0.8) + 0.85 * cos(t * 1.7));
        float g = hAt(wp);
        vec4 m2 = texture(tMask2, maskUV(wp));
        float ok = step(uWaterLv + 0.5, g) * step(m2.r, 0.2) * step(m2.b, 0.2) * uVis;
        float y = g + 0.45 + 1.1 * aRnd.z + sin(uTime * 2.1 + aRnd.x * 9.0) * 0.18;
        float flap = sin(uTime * (13.0 + aRnd.w * 6.0) + aRnd.y * 20.0) * 1.05 + 0.25;
        vec2 f = normalize(vel + 1e-4), rt = vec2(f.y, -f.x);
        float span = (0.09 + 0.05 * aRnd.x) * ok;   // a little larger than life, so they read on screen
        vec3 lp = vec3(position.x * cos(flap) * span, abs(position.x) * sin(flap) * span, position.y * span * 0.85);
        vec3 w = vec3(wp.x, y, wp.y) + vec3(rt.x, 0.0, rt.y) * lp.x + vec3(f.x, 0.0, f.y) * lp.z + vec3(0.0, lp.y, 0.0);
        vUv = vec2(abs(position.x), position.y);
        vKind = floor(aRnd.x * 5.0);
        vLight = uAmb * 0.6 + uSunCol * 0.36 + 0.06 * min(1.0, dot(uSunCol, vec3(0.3, 0.59, 0.11)));
        vec4 mvPosition = viewMatrix * vec4(w, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      varying vec2 vUv; varying vec3 vLight; varying float vKind;
      #include <common>
      #include <fog_pars_fragment>
      void main(){
        // fore- and hindwing lobes
        float fore = length((vUv - vec2(0.52, 0.3)) / vec2(0.5, 0.62));
        float hind = length((vUv - vec2(0.4, -0.45)) / vec2(0.38, 0.5));
        float lobe = min(fore, hind);
        if (lobe > 1.0 || vUv.x < 0.04) discard;
        vec3 c = vKind < 1.0 ? vec3(1.0, 0.98, 0.9) : vKind < 2.0 ? vec3(1.0, 0.86, 0.2) : vKind < 3.0 ? vec3(1.0, 0.5, 0.12)
               : vKind < 4.0 ? vec3(0.45, 0.72, 1.0) : vec3(1.0, 0.62, 0.8);
        c = mix(c, vec3(0.08, 0.07, 0.1), smoothstep(0.78, 0.9, lobe) * (vKind > 1.5 && vKind < 3.5 ? 1.0 : 0.6)); // dark wing edge
        c = mix(c, vec3(1.0), step(length(vUv - vec2(0.7, 0.45)), 0.07) * step(1.5, vKind));   // white spot
        gl_FragColor = vec4(min(c * vLight, vec3(0.86)), 1.0); // capped: small bright wings would bloom into white blobs
        #include <fog_fragment>
      }`,
  });
  Object.assign(mat.uniforms, world.hf.U, U, { uCam: S.uCam, uSunCol: S.uSunCol, uAmb: S.uAmb, uTime: S.uTime, uVis: { value: 1 }, uWaterLv: { value: world.waterLevel ?? 0 } });
  const m = new THREE.Mesh(g, mat); m.frustumCulled = false; m.layers.set(1); scene.add(m);
  return m;
}

// ---------------------------------------------------------------- birds
function birds(center) {
  const N = 22, rng = mulberry32(5);
  // one bird: a body and two two-segment wings (x = span, z = forward), about 0.9 m across
  const P = [
    0, 0, 0.26, 0.05, 0, -0.02, -0.05, 0, -0.02,            // head / body front
    0.05, 0, -0.02, 0, 0, -0.24, -0.05, 0, -0.02,           // tail
    0.05, 0, 0.06, 0.05, 0, -0.08, 0.24, 0, 0.0,            // right inner wing
    0.24, 0, 0.0, 0.05, 0, -0.08, 0.46, 0, -0.1,            // right outer wing
    -0.05, 0, 0.06, -0.24, 0, 0.0, -0.05, 0, -0.08,         // left inner wing
    -0.24, 0, 0.0, -0.46, 0, -0.1, -0.05, 0, -0.08,         // left outer wing
  ];
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  const off = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) { off[i * 4] = (rng() - 0.5) * 26; off[i * 4 + 1] = (rng() - 0.5) * 8; off[i * 4 + 2] = (rng() - 0.5) * 22; off[i * 4 + 3] = rng(); }
  g.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 4));
  g.instanceCount = N;
  const fu = { uFlock: { value: new THREE.Vector3() }, uHead: { value: new THREE.Vector2(1, 0) }, uVis: { value: 1 } };
  const mat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uAmb: { value: null }, uSunCol: { value: null } }]),
    vertexShader: /* glsl */`
      attribute vec4 aOff; uniform float uTime, uVis; uniform vec3 uFlock; uniform vec2 uHead;
      #include <common>
      #include <fog_pars_vertex>
      void main(){
        float ph = aOff.w * 6.2831;
        // alternate bursts of flapping with glides
        float glide = smoothstep(0.2, 0.7, sin(uTime * 0.45 + ph * 3.0));
        float flap = sin(uTime * (9.0 + aOff.w * 3.0) + ph) * mix(0.75, 0.08, glide);
        vec3 p = position;
        float ax = abs(p.x), w = smoothstep(0.04, 0.46, ax);
        p.y += ax * sin(flap) * 1.2 + w * w * sin(flap - 0.6) * 0.18;
        p.x *= mix(1.0, cos(flap) * 0.9 + 0.1, w);
        p *= 2.4 * uVis;
        // each bird wanders around its slot in the flock
        vec3 o = aOff.xyz + vec3(sin(uTime * 0.31 + ph) * 4.0, sin(uTime * 0.53 + ph * 2.0) * 1.5, cos(uTime * 0.27 + ph) * 4.0);
        vec2 f = uHead, r = vec2(f.y, -f.x);
        float bank = sin(uTime * 0.2 + ph) * 0.3;
        p.y += p.x * bank;
        vec3 wp = uFlock + vec3(r * o.x + f * o.z, 0.0).xzy + vec3(0.0, o.y, 0.0);
        wp += vec3(r.x * p.x + f.x * p.z, p.y, r.y * p.x + f.y * p.z);
        vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uAmb, uSunCol;
      #include <common>
      #include <fog_pars_fragment>
      void main(){
        gl_FragColor = vec4(uAmb * 0.3 + uSunCol * 0.03, 1.0);
        #include <fog_fragment>
      }`,
  });
  mat.uniforms.uTime = S.uTime; mat.uniforms.uAmb = S.uAmb; mat.uniforms.uSunCol = S.uSunCol;
  Object.assign(mat.uniforms, fu);
  const m = new THREE.Mesh(g, mat); m.frustumCulled = false;
  scene.add(m);
  const prev = new THREE.Vector3(), cur = new THREE.Vector3();
  const path = (t, out) => out.set(center.x + Math.cos(t * 0.03) * 150 + Math.sin(t * 0.047) * 40, center.y + 38 + Math.sin(t * 0.06) * 12,
    center.z + Math.sin(t * 0.03) * 115 + Math.cos(t * 0.033) * 35);
  return {
    update(t, day) {
      path(t, cur); path(t - 0.5, prev);
      fu.uFlock.value.copy(cur);
      fu.uHead.value.set(cur.x - prev.x, cur.z - prev.z).normalize();
      fu.uVis.value = day;
      m.visible = day > 0.02;
    },
  };
}

// ---------------------------------------------------------------- dawn mist: a thin, low second fog layer (see core.js)
function mistAmount(h) {
  const dawn = smoothstep(3.6, 5.6, h) * (1 - smoothstep(7.4, 9.6, h));
  const night = 0.3 * Math.max(smoothstep(19.5, 22, h), 1 - smoothstep(2, 4.5, h));
  return Math.max(dawn, night);
}

export function buildLife(world, opt = {}) {
  const f = fireflies(world), mo = motes(world), fl = opt.flowers === false ? null : flowers(world);
  const pe = world.sakura && world.sakura.length ? petals(world.sakura) : null, bf = butterflies(world);
  const flock = opt.birds === false ? null : birds(opt.flockCenter || new THREE.Vector3(world.spawn.x, world.waterLevel ?? 0, world.spawn.z));
  const mist = opt.mist ?? 1;
  return {
    update(t, hour) {
      U.uPR.value = renderer.getPixelRatio();
      U.uPx.value = renderer.domElement.height * 0.5 / Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5);
      U.uFire.value = smoothstep(0.25, 0.8, env.night) * (opt.fireflies ?? 1);
      U.uMote.value = env.day;
      f.visible = U.uFire.value > 0.001; mo.visible = U.uMote.value > 0.001;
      bf.material.uniforms.uVis.value = smoothstep(0.2, 0.6, env.day); bf.visible = env.day > 0.2;
      if (flock) flock.update(t, env.day);
      fogU.fogMist.value.x = mistAmount(hour) * 0.0032 * mist;
    },
  };
}
