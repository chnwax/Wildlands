// Post-processing: MSAA scene pass (with depth for GTAO), ambient occlusion, god rays, bloom, tone mapping, anime grade.
import { THREE, renderer, scene, camera, Q, onResize } from './core.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { CopyShader } from 'three/addons/shaders/CopyShader.js';
import { GTAOShader, GTAODepthShader } from 'three/addons/shaders/GTAOShader.js';
import { PoissonDenoiseShader } from 'three/addons/shaders/PoissonDenoiseShader.js';

// GTAO and its denoiser rebuild view positions from depth. With reversed-Z the stored value is d = n (f - z) / (z (f - n))
// (far = 0); converting it to standard depth as 1 - d would throw the float precision away (1 - 2e-4 keeps ~4 digits), so
// the distance is decoded straight from d and the view ray comes from the (jittered) inverse projection. Sky = 0, not 1.
{
  const patchDepth = (sh, sky) => {
    const rep = (a, b) => { if (!sh.fragmentShader.includes(a)) { console.warn('post: shader changed', a); return; } sh.fragmentShader = sh.fragmentShader.split(a).join(b); };
    sh.uniforms.uRevNF = { value: new THREE.Vector2(camera.near, camera.far) };
    rep('vec3 getViewPosition(const in vec2 screenPosition, const in float depth) {', `uniform vec2 uRevNF;
		vec3 getViewPosition(const in vec2 screenPosition, const in float depth) {
		#ifdef USE_REVERSEDEPTHBUF
			vec4 nearP = cameraProjectionMatrixInverse * vec4(screenPosition * 2.0 - 1.0, -1.0, 1.0);
			float dist = uRevNF.x * uRevNF.y / (max(depth, 1e-12) * (uRevNF.y - uRevNF.x) + uRevNF.x);
			return nearP.xyz / nearP.w * (dist / uRevNF.x);
		#endif`);
    for (const [a, b] of sky) rep(a, `#ifdef USE_REVERSEDEPTHBUF
 ${b}
#else
 ${a}
#endif`);
  };
  patchDepth(GTAOShader, [['if (depth >= 1.0) {', 'if (depth <= 0.0) {']]);
  patchDepth(PoissonDenoiseShader, [['if (depth == 1. || dot(viewNormal, viewNormal) == 0.) {', 'if (depth == 0. || dot(viewNormal, viewNormal) == 0.) {']]);
  void GTAODepthShader;
}

export const post = { composer: null, bloom: null, grade: null, ao: null, scenePass: null, rays: null, taa: null, onRebuild: [], exposure: { value: 0.2 }, wb: { value: new THREE.Vector3(1, 1, 1) } };

// Renders the scene into its own (optionally multisampled) target with a depth texture, then resolves into the
// composer chain, pre-multiplied by the exposure (so bloom / ray thresholds work in display-referred units).
// NaN/Inf texels are scrubbed so a single bad pixel can never smear through bloom.
class ScenePass extends Pass {
  constructor(samples) {
    super();
    this.needsSwap = false;
    const depth = new THREE.DepthTexture(1, 1); depth.type = THREE.FloatType; // 32F depth: GTAO needs precision with a 26 km far plane
    this.rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples, depthTexture: depth });
    this.quad = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: Object.assign(THREE.UniformsUtils.clone(CopyShader.uniforms), { uExposure: post.exposure, uWB: post.wb }), vertexShader: CopyShader.vertexShader, depthTest: false, depthWrite: false,
      fragmentShader: `uniform sampler2D tDiffuse; uniform float uExposure; uniform vec3 uWB; varying vec2 vUv;
        void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb; if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0); gl_FragColor = vec4(clamp(c, vec3(0.0), vec3(3e4)) * uExposure * uWB, 1.0); }`,
    }));
  }
  setSize(w, h) { this.rt.setSize(w, h); }
  render(r, writeBuffer, readBuffer) {
    if (post.taa && post.taa.enabled) post.taa.begin();
    r.setRenderTarget(this.rt); r.clear(); r.render(scene, camera);
    this.quad.material.uniforms.tDiffuse.value = this.rt.texture;
    r.setRenderTarget(readBuffer); this.quad.render(r);
  }
  dispose() { this.rt.dispose(); this.quad.dispose(); }
}

// Temporal anti-aliasing. Every frame the camera is shifted by a sub-pixel Halton offset; the resolve reprojects last
// frame's result through this frame's depth (camera motion), clips it to the current 3x3 neighbourhood in YCoCg
// (variance clipping, so cars, trains and swaying grass never leave ghosts) and blends in ~1/9 of the new frame.
// History is read with a Catmull-Rom filter and the blend is luminance-weighted, so the result stays sharp and bright
// highlights don't smear. Shader aliasing (specular sparkle, thin wires, worn paint, grass tips) settles into a stable
// image; the grade pass adds a light contrast-adaptive sharpen on top.
const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };
const TAAShader = {
  uniforms: { tCur: { value: null }, tHist: { value: null }, tDepth: { value: null }, uInvVP: { value: new THREE.Matrix4() }, uPrevVP: { value: new THREE.Matrix4() },
    uJit: { value: new THREE.Vector2() }, uRes: { value: new THREE.Vector2(1, 1) }, uReset: { value: 1 }, uSince: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tCur, tHist, tDepth; uniform mat4 uInvVP, uPrevVP; uniform vec2 uJit, uRes; uniform float uReset, uSince; varying vec2 vUv;
    vec3 toY(vec3 c){ return vec3(dot(c, vec3(0.25, 0.5, 0.25)), dot(c, vec3(0.5, 0.0, -0.5)), dot(c, vec3(-0.25, 0.5, -0.25))); }
    vec3 fromY(vec3 c){ return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z); }
    float ndcZ(float d){
      #ifdef USE_REVERSEDEPTHBUF
        return (1.0 - d) * 2.0 - 1.0;
      #else
        return d * 2.0 - 1.0;
      #endif
    }
    // 5-tap Catmull-Rom history fetch (bilinear taps at the kernel's weighted centres)
    vec3 histCR(vec2 uv){
      vec2 p = uv * uRes, t1 = floor(p - 0.5) + 0.5, f = p - t1;
      vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f)), w1 = 1.0 + f * f * (-2.5 + 1.5 * f), w2 = f * (0.5 + f * (2.0 - 1.5 * f)), w3 = f * f * (-0.5 + 0.5 * f);
      vec2 w12 = w1 + w2, tc0 = (t1 - 1.0) / uRes, tc3 = (t1 + 2.0) / uRes, tc12 = (t1 + w2 / w12) / uRes;
      vec3 c = texture2D(tHist, vec2(tc12.x, tc0.y)).rgb * (w12.x * w0.y) + texture2D(tHist, vec2(tc0.x, tc12.y)).rgb * (w0.x * w12.y)
             + texture2D(tHist, tc12).rgb * (w12.x * w12.y) + texture2D(tHist, vec2(tc3.x, tc12.y)).rgb * (w3.x * w12.y) + texture2D(tHist, vec2(tc12.x, tc3.y)).rgb * (w12.x * w3.y);
      float ws = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
      return max(c / ws, vec3(0.0));
    }
    void main(){
      vec2 px = 1.0 / uRes;
      vec3 cur = texture2D(tCur, vUv).rgb;
      if (uReset > 0.5) { gl_FragColor = vec4(cur, 1.0); return; }
      // neighbourhood moments (YCoCg) and the nearest depth in the 3x3 (edges reproject with their foreground)
      // the current colour is reconstructed from the 3x3 samples with a Blackman-Harris-like kernel centred on the
      // unjittered pixel centre (each sample sits at its offset + the jitter), so the input no longer jumps with the jitter
      vec3 m1 = vec3(0.0), m2 = vec3(0.0), cf = vec3(0.0); float wf = 0.0; float dN = texture2D(tDepth, vUv).r; vec2 dUv = vUv;
      vec2 jp = uJit * uRes;
      for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
        vec2 o = vec2(float(i), float(j)) * px;
        vec3 c = toY(texture2D(tCur, vUv + o).rgb); m1 += c; m2 += c * c;
        vec2 dp = vec2(float(i), float(j)) + jp; float wk = exp(-2.29 * dot(dp, dp)); cf += c * wk / (1.0 + c.x); wf += wk / (1.0 + c.x);
        float d = texture2D(tDepth, vUv + o).r;
        #ifdef USE_REVERSEDEPTHBUF
          if (d > dN) { dN = d; dUv = vUv + o; }
        #else
          if (d < dN) { dN = d; dUv = vUv + o; }
        #endif
      }
      m1 /= 9.0; vec3 sig = sqrt(max(m2 / 9.0 - m1 * m1, 0.0));
      vec4 wp = uInvVP * vec4((dUv + uJit) * 2.0 - 1.0, ndcZ(dN), 1.0); wp /= wp.w;
      // this pixel's sample sits at the unjittered position vUv + uJit; the history is kept on the unjittered grid, so the
      // reprojected position is taken back by the same jitter (a static camera then reads history at exactly vUv)
      vec4 pp = uPrevVP * wp; vec2 prevUv = pp.xy / pp.w * 0.5 + 0.5 - uJit + (vUv - dUv);
      if (any(lessThan(prevUv, vec2(0.0))) || any(greaterThan(prevUv, vec2(1.0))) || pp.w <= 0.0) { gl_FragColor = vec4(cur, 1.0); return; }
      vec3 hist = toY(histCR(prevUv));
      // clip the history toward the neighbourhood mean, into mean +- 1.1 sigma
      vec3 lo = m1 - sig * 1.1, hi = m1 + sig * 1.1, ctr = 0.5 * (hi + lo), ext = 0.5 * (hi - lo) + 1e-4;
      vec3 v = hist - ctr, a = abs(v / ext); float ma = max(a.x, max(a.y, a.z));
      if (ma > 1.0) hist = ctr + v / ma;
      vec3 c = cf / wf;
      // faster response while the view moves quickly (less smear), luminance-weighted blend (no fireflies)
      float vel = length((prevUv - vUv) * uRes), alpha = mix(0.085, 0.3, clamp(vel / 24.0, 0.0, 1.0));
      alpha = max(alpha, 1.0 / (uSince + 1.0)); // right after a reset (teleport, resize) average the frames evenly: converges in a jitter cycle
      float wc = alpha / (1.0 + c.x), wh = (1.0 - alpha) / (1.0 + hist.x);
      gl_FragColor = vec4(max(fromY((c * wc + hist * wh) / (wc + wh)), vec3(0.0)), 1.0);
    }`,
};
class TAAPass extends Pass {
  constructor(depthTexture) {
    super();
    const opt = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.hist = [new THREE.WebGLRenderTarget(1, 1, opt), new THREE.WebGLRenderTarget(1, 1, opt)]; this.idx = 0;
    this.mat = new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.clone(TAAShader.uniforms), vertexShader: TAAShader.vertexShader, fragmentShader: TAAShader.fragmentShader, depthTest: false, depthWrite: false });
    this.mat.uniforms.tDepth.value = depthTexture;
    this.quad = new FullScreenQuad(this.mat);
    this.copy = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.clone(CopyShader.uniforms), vertexShader: CopyShader.vertexShader, fragmentShader: CopyShader.fragmentShader, depthTest: false, depthWrite: false }));
    this.frame = 0; this.reset = true; this.w = 1; this.h = 1;
    this.vp = new THREE.Matrix4(); this.prevVP = new THREE.Matrix4(); this.lastPos = new THREE.Vector3(1e9, 0, 0);
  }
  setSize(w, h) { this.hist.forEach(r => r.setSize(w, h)); this.w = w; this.h = h; this.reset = true; this.mat.uniforms.uRes.value.set(w, h); }
  // before the scene renders: note the unjittered view-projection, then shift the camera by this frame's sub-pixel offset
  begin() {
    camera.clearViewOffset(); camera.updateMatrixWorld();
    this.vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.mat.uniforms.uInvVP.value.copy(this.vp).invert();
    if (camera.position.distanceTo(this.lastPos) > 25) this.reset = true;   // teleports and map changes
    this.lastPos.copy(camera.position);
    const k = (this.frame++ % 16) + 1, jx = halton(k, 2) - 0.5, jy = halton(k, 3) - 0.5;
    this.mat.uniforms.uJit.value.set(jx / this.w, -jy / this.h);
    camera.setViewOffset(this.w, this.h, jx, jy, this.w, this.h);
  }
  render(r, writeBuffer, readBuffer) {
    camera.clearViewOffset();
    const u = this.mat.uniforms, out = this.hist[1 - this.idx];
    u.tCur.value = readBuffer.texture; u.tHist.value = this.hist[this.idx].texture; u.uPrevVP.value.copy(this.prevVP); u.uReset.value = this.reset ? 1 : 0; this.since = this.reset ? 0 : (this.since || 0) + 1; u.uSince.value = this.since;
    r.setRenderTarget(out); this.quad.render(r);
    this.copy.material.uniforms.tDiffuse.value = out.texture;
    r.setRenderTarget(this.renderToScreen ? null : writeBuffer); this.copy.render(r);
    this.idx = 1 - this.idx; this.prevVP.copy(this.vp); this.reset = false;
  }
  dispose() { this.hist.forEach(r => r.dispose()); this.quad.dispose(); this.copy.dispose(); this.mat.dispose(); }
}

// three r170's GTAOPass dereferences a normal target that doesn't exist when an external depth texture is supplied
class DepthGTAOPass extends GTAOPass {
  setGBuffer(depthTexture, normalTexture) {
    if (depthTexture !== undefined && !this.normalRenderTarget) this.normalRenderTarget = { depthTexture, setSize() {}, dispose() {} };
    super.setGBuffer(depthTexture, normalTexture);
  }
}

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uUnder: { value: 0 }, uTexel: { value: new THREE.Vector2(1e-3, 1e-3) }, uSharp: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime, uUnder, uSharp; uniform vec2 uTexel; varying vec2 vUv;
    void main(){
      vec2 uv = vUv;
      if (uUnder > 0.5) uv += vec2(sin(uv.y * 24.0 + uTime * 2.0), cos(uv.x * 20.0 + uTime * 1.7)) * 0.003;
      vec4 c = texture2D(tDiffuse, uv);
      if (uSharp > 0.0 && uUnder < 0.5) { // contrast-adaptive sharpening (restores the crispness temporal AA takes off)
        vec3 n = texture2D(tDiffuse, uv + vec2(0.0, uTexel.y)).rgb, s = texture2D(tDiffuse, uv - vec2(0.0, uTexel.y)).rgb;
        vec3 e = texture2D(tDiffuse, uv + vec2(uTexel.x, 0.0)).rgb, w = texture2D(tDiffuse, uv - vec2(uTexel.x, 0.0)).rgb;
        vec3 mn = min(c.rgb, min(min(n, s), min(e, w))), mx = max(c.rgb, max(max(n, s), max(e, w)));
        vec3 amp = sqrt(clamp(min(mn, 1.0 - mx) / max(mx, 1e-4), 0.0, 1.0)), wt = -amp * uSharp;
        c.rgb = clamp((c.rgb + (n + s + e + w) * wt) / (1.0 + 4.0 * wt), 0.0, 1.0);
      }
      // anime grade: vivid but soft — saturation up, a gentle S-curve, lifted cool shadows, warm highlights
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, 1.16);
      c.rgb = mix(c.rgb, c.rgb * c.rgb * (3.0 - 2.0 * c.rgb), 0.12);
      c.rgb += vec3(0.012, 0.016, 0.035) * (1.0 - l);
      c.rgb *= mix(vec3(1.0), vec3(1.03, 1.01, 0.97), smoothstep(0.5, 1.0, l));
      if (uUnder > 0.5) c.rgb = mix(c.rgb, vec3(0.05, 0.35, 0.42), 0.5) * vec3(0.7, 1.0, 1.05);
      vec2 d = vUv - 0.5; c.rgb *= 1.0 - dot(d, d) * 0.32;
      gl_FragColor = vec4(clamp(c.rgb, 0.0, 1.0), c.a);
    }`,
};

// Crepuscular rays: radial blur toward the sun of a sky mask built from the depth buffer and sky brightness.
const RaysShader = {
  uniforms: { tDiffuse: { value: null }, tDepth: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.5) }, uVis: { value: 0 }, uCol: { value: new THREE.Vector3(1, 1, 1) }, uAspect: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse, tDepth; uniform vec2 uSun; uniform float uVis, uAspect; uniform vec3 uCol; varying vec2 vUv;
    float skyMask(vec2 uv){
      if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
      #ifdef USE_REVERSEDEPTHBUF
        float sky = step(texture2D(tDepth, uv).r, 5e-7);
      #else
        float sky = step(0.9999995, texture2D(tDepth, uv).r);
      #endif
      vec3 c = texture2D(tDiffuse, uv).rgb;
      return sky * smoothstep(0.22, 1.15, dot(c, vec3(0.3, 0.5, 0.2)));
    }
    void main(){
      vec4 base = texture2D(tDiffuse, vUv);
      if (uVis <= 0.001) { gl_FragColor = base; return; }
      vec2 d = (uSun - vUv) / 48.0;
      vec2 uv = vUv; float acc = 0.0, w = 1.0;
      float jit = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
      uv += d * jit;
      for (int i = 0; i < 48; i++) { acc += skyMask(uv) * w; w *= 0.965; uv += d; }
      acc /= 24.0;
      vec2 q = (vUv - uSun) * vec2(uAspect, 1.0);
      float fall = exp(-dot(q, q) * 1.6);
      gl_FragColor = vec4(base.rgb + uCol * acc * fall * uVis, base.a);
    }`,
};

const _sp = new THREE.Vector3();
// call every frame: project the sun into screen space and fade shafts when it is behind the camera / below the horizon
export function updateRays(sunDir, sunCol, dayFactor) {
  if (!post.rays) return;
  _sp.copy(camera.position).addScaledVector(sunDir, 5000).project(camera);
  const facing = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).dot(sunDir);
  const u = post.rays.uniforms;
  u.uSun.value.set(_sp.x * 0.5 + 0.5, _sp.y * 0.5 + 0.5);
  u.uVis.value = Math.max(0, facing) ** 2 * dayFactor * (_sp.z < 1 ? 1 : 0) * 0.55;
  u.uCol.value.set(sunCol.x, sunCol.y, sunCol.z).multiplyScalar(0.3 * post.exposure.value);
  u.uAspect.value = innerWidth / innerHeight;
}
export function buildComposer() {
  const P = post;
  if (P.composer) { P.composer.renderTarget1.dispose(); P.composer.renderTarget2.dispose(); P.scenePass.dispose(); if (P.ao) P.ao.dispose(); if (P.taa) { P.taa.dispose(); camera.clearViewOffset(); } }
  const pr = renderer.getPixelRatio(), w = Math.max(1, innerWidth), h = Math.max(1, innerHeight);
  P.composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(w * pr, h * pr, { type: THREE.HalfFloatType }));
  P.composer.setPixelRatio(pr);
  P.scenePass = new ScenePass(Q.msaa);
  P.composer.addPass(P.scenePass);
  P.ao = null;
  if (Q.ao) {
    P.ao = new DepthGTAOPass(scene, camera, w * pr, h * pr, { depthTexture: P.scenePass.rt.depthTexture });
    // contact shading only: a tight radius keeps it to creases, feet of walls and grass roots rather than dark halos
    const ex = Q.name === 'extreme';
    P.ao.updateGtaoMaterial({ radius: 0.8, distanceExponent: 1.6, thickness: 1.0, scale: 1.0, samples: ex ? 20 : 12, distanceFallOff: 1.0 });
    P.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: ex ? 8 : 6, rings: 2, samples: ex ? 16 : 12 });
    P.ao.blendIntensity = 0.78;
    P.composer.addPass(P.ao);
  }
  P.taa = null;
  if (Q.taa) { P.taa = new TAAPass(P.scenePass.rt.depthTexture); P.composer.addPass(P.taa); }
  P.rays = new ShaderPass(RaysShader);
  P.rays.uniforms.tDepth.value = P.scenePass.rt.depthTexture;
  P.composer.addPass(P.rays);
  P.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.42, 0.75, 0.97); // only light sources and sunlit highlights bloom, not whole sunny walls
  P.bloom.enabled = Q.bloom;
  P.composer.addPass(P.bloom);
  P.composer.addPass(new OutputPass());
  P.grade = new ShaderPass(GradeShader);
  P.grade.uniforms.uTexel.value.set(1 / (w * pr), 1 / (h * pr)); P.grade.uniforms.uSharp.value = Q.taa ? 0.16 : 0;
  P.composer.addPass(P.grade);
  P.composer.setSize(w, h);
  P.onRebuild.forEach(f => f());
}
onResize(buildComposer);
