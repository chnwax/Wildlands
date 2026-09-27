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

// GTAO and its denoiser rebuild view positions from standard depth: read reversed depth as 1 - d
{
  const flip = (sh, pairs) => { for (const [a, b] of pairs) { if (!sh.fragmentShader.includes(a)) { console.warn('post: shader changed', a); continue; } sh.fragmentShader = sh.fragmentShader.split(a).join(b); } };
  const rev = e => `(1.0 - ${e})`;
  flip(GTAOShader, [['return textureLod(tDepth, uv.xy, 0.0).DEPTH_SWIZZLING;', '#ifdef USE_REVERSEDEPTHBUF\n return ' + rev('textureLod(tDepth, uv.xy, 0.0).DEPTH_SWIZZLING') + ';\n#else\n return textureLod(tDepth, uv.xy, 0.0).DEPTH_SWIZZLING;\n#endif'],
    ['return texelFetch(tDepth, uv.xy, 0).DEPTH_SWIZZLING;', '#ifdef USE_REVERSEDEPTHBUF\n return ' + rev('texelFetch(tDepth, uv.xy, 0).DEPTH_SWIZZLING') + ';\n#else\n return texelFetch(tDepth, uv.xy, 0).DEPTH_SWIZZLING;\n#endif']]);
  flip(PoissonDenoiseShader, [['return textureLod(tDepth, uv.xy, 0.0).r;', '#ifdef USE_REVERSEDEPTHBUF\n return ' + rev('textureLod(tDepth, uv.xy, 0.0).r') + ';\n#else\n return textureLod(tDepth, uv.xy, 0.0).r;\n#endif'],
    ['return texelFetch(tDepth, uv.xy, 0).r;', '#ifdef USE_REVERSEDEPTHBUF\n return ' + rev('texelFetch(tDepth, uv.xy, 0).r') + ';\n#else\n return texelFetch(tDepth, uv.xy, 0).r;\n#endif']]);
  void GTAODepthShader;
}

export const post = { composer: null, bloom: null, grade: null, ao: null, scenePass: null, rays: null, onRebuild: [], exposure: { value: 0.2 }, wb: { value: new THREE.Vector3(1, 1, 1) } };

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
    r.setRenderTarget(this.rt); r.clear(); r.render(scene, camera);
    this.quad.material.uniforms.tDiffuse.value = this.rt.texture;
    r.setRenderTarget(readBuffer); this.quad.render(r);
  }
  dispose() { this.rt.dispose(); this.quad.dispose(); }
}

// three r170's GTAOPass dereferences a normal target that doesn't exist when an external depth texture is supplied
class DepthGTAOPass extends GTAOPass {
  setGBuffer(depthTexture, normalTexture) {
    if (depthTexture !== undefined && !this.normalRenderTarget) this.normalRenderTarget = { depthTexture, setSize() {}, dispose() {} };
    super.setGBuffer(depthTexture, normalTexture);
  }
}

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uUnder: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime, uUnder; varying vec2 vUv;
    void main(){
      vec2 uv = vUv;
      if (uUnder > 0.5) uv += vec2(sin(uv.y * 24.0 + uTime * 2.0), cos(uv.x * 20.0 + uTime * 1.7)) * 0.003;
      vec4 c = texture2D(tDiffuse, uv);
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
  if (P.composer) { P.composer.renderTarget1.dispose(); P.composer.renderTarget2.dispose(); P.scenePass.dispose(); if (P.ao) P.ao.dispose(); }
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
  P.rays = new ShaderPass(RaysShader);
  P.rays.uniforms.tDepth.value = P.scenePass.rt.depthTexture;
  P.composer.addPass(P.rays);
  P.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.42, 0.75, 0.97); // only light sources and sunlit highlights bloom, not whole sunny walls
  P.bloom.enabled = Q.bloom;
  P.composer.addPass(P.bloom);
  P.composer.addPass(new OutputPass());
  P.grade = new ShaderPass(GradeShader);
  P.composer.addPass(P.grade);
  P.composer.setSize(w, h);
  P.onRebuild.forEach(f => f());
}
onResize(buildComposer);
