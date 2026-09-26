// Ambient life: fireflies over the meadows at dusk and night, pollen / dust motes that catch the sun when backlit,
// flower blossoms in colourful patches, and a flock of birds wheeling over the valley. Everything is GPU-animated
// from a handful of uniforms.
import { THREE, scene, camera, renderer, S, fogU, clamp, smoothstep, mulberry32 } from './core.js';
import { GLSL_HEIGHT } from './terrain.js';
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
  const R = 30;
  const mat = new THREE.ShaderMaterial({
    transparent: false, depthWrite: true, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
    vertexShader: /* glsl */`
      attribute vec4 aRnd; uniform vec3 uCam, uSunCol, uAmb; uniform float uPx, uPR, uWaterLv, uTime, uWind;
      uniform sampler2D tMask, tMask2, tNoise;
      varying vec3 vCol; varying float vAng;
      ${GLSL_HEIGHT}
      ${wrapGLSL}
      #include <common>
      #include <fog_pars_vertex>
      void main(){
        vec2 wp = wrapAround(aRnd.xy, ${R.toFixed(1)});
        float g = hAt(wp);
        vec4 z2 = texture(tNoise, wp * 0.013), z3 = texture(tNoise, wp * 0.06);
        vec4 m = texture(tMask, maskUV(wp)), m2 = texture(tMask2, maskUV(wp));
        float gx = hAt(wp + vec2(uCell, 0.0)) - hAt(wp - vec2(uCell, 0.0)), gz = hAt(wp + vec2(0.0, uCell)) - hAt(wp - vec2(0.0, uCell));
        float flat_ = 2.0 * uCell / length(vec3(gx, 2.0 * uCell, gz));
        float patch_ = smoothstep(0.58, 0.8, z3.g * 0.65 + z2.a * 0.6);
        // strictly off roads, lots, paddies, forest floor and tree shade (the masks are bilinear at metre scale)
        float ok = step(aRnd.w, (patch_ * 0.9 + 0.04) * (1.0 - 0.6 * m2.a)) * step(uWaterLv + 1.0, g) * step(0.86, flat_) * step(m.b, 0.3) * step(m.r, 0.45) * step(m2.r, 0.05) * step(m2.b, 0.05) * step(m2.g, 0.3);
        float d = length(wp - uCam.xz);
        float fade = 1.0 - smoothstep(${(R * 0.7).toFixed(1)}, ${R.toFixed(1)}, d);
        float sway = sin(uTime * (1.5 + aRnd.z) + aRnd.x * 30.0) * 0.04 * uWind;
        vec3 w = vec3(wp.x + sway, g + 0.18 + 0.32 * aRnd.z, wp.y + sway * 0.5);
        float pick = fract(z2.g * 5.3 + z3.b * 0.6 + step(0.92, aRnd.y) * 0.37);
        vec3 fc = pick < 0.26 ? vec3(1.0, 0.95, 0.86) : pick < 0.5 ? vec3(1.0, 0.72, 0.06) : pick < 0.7 ? vec3(1.0, 0.36, 0.55)
                : pick < 0.88 ? vec3(0.42, 0.3, 1.0) : vec3(1.0, 0.3, 0.12);
        vCol = fc * (uAmb * 0.55 + uSunCol * 0.33 + 0.03);
        vAng = aRnd.y * 6.2831;
        vec4 mvPosition = viewMatrix * vec4(w, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = ok * fade > 0.01 ? clamp(pointPx(0.16 + 0.08 * aRnd.x, -mvPosition.z) * fade, 1.0, 40.0 * uPR) : 0.0;
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
  Object.assign(mat.uniforms, world.hf.U, U, { uCam: S.uCam, uSunCol: S.uSunCol, uAmb: S.uAmb, uTime: S.uTime, uWind: S.uWind, tNoise: S.tNoise, uWaterLv: { value: world.waterLevel ?? 0 } });
  return wrappedPoints(9000, 29, mat);
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
  const flock = opt.birds === false ? null : birds(opt.flockCenter || new THREE.Vector3(world.spawn.x, world.waterLevel ?? 0, world.spawn.z));
  const mist = opt.mist ?? 1;
  return {
    update(t, hour) {
      U.uPR.value = renderer.getPixelRatio();
      U.uPx.value = renderer.domElement.height * 0.5 / Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5);
      U.uFire.value = smoothstep(0.25, 0.8, env.night) * (opt.fireflies ?? 1);
      U.uMote.value = env.day;
      f.visible = U.uFire.value > 0.001; mo.visible = U.uMote.value > 0.001;
      if (flock) flock.update(t, env.day);
      fogU.fogMist.value.x = mistAmount(hour) * 0.0032 * mist;
    },
  };
}
