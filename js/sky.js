// Sky, clouds, stars, moon, sun/moon light and the day-night cycle.
import { THREE, renderer, scene, camera, S, sunDir, fogU, Q, clamp, lerp, smoothstep, mulberry32 } from './core.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { buildClouds } from './clouds.js';

export const time = { hour: 16.4, running: true, speed: 1 / 60 }; // game hours per real second (1 day = 24 min)
const up = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------- sky dome (Preetham) with a proper night
export const sky = new Sky(); sky.scale.setScalar(20000); scene.add(sky);
const skyU = sky.material.uniforms;
skyU.uNight = { value: 0 };
sky.material.fragmentShader = sky.material.fragmentShader
  .replace('uniform float mieDirectionalG;', 'uniform float mieDirectionalG;\nuniform float uNight;')
  .replace('gl_FragColor = vec4( retColor, 1.0 );',
    'retColor = max( mix( retColor, vec3( 0.0035, 0.007, 0.018 ) + retColor * vec3( 0.05, 0.07, 0.12 ), uNight ), vec3( 0.0 ) );\n\t\t\tgl_FragColor = vec4( retColor, 1.0 );');
skyU.turbidity.value = 5.5; skyU.rayleigh.value = 1.5; skyU.mieCoefficient.value = 0.004; skyU.mieDirectionalG.value = 0.82;
const skyScene = new THREE.Scene(); const skyClone = new Sky(); skyClone.material = sky.material; skyClone.scale.setScalar(100); skyScene.add(skyClone);
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

// ---------------------------------------------------------------- stars + moon
const starGeo = new THREE.BufferGeometry();
{
  const rng = mulberry32(42), P = [], C = [];
  for (let i = 0; i < 5000; i++) {
    const u = rng() * 2 - 1, th = rng() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    P.push(r * Math.cos(th) * 12000, Math.abs(u) * 12000 - 300, r * Math.sin(th) * 12000);
    const b = Math.pow(rng(), 3) * 1.6 + 0.15, t = rng();
    C.push(b * (0.85 + t * 0.2), b * 0.92, b * (1.1 - t * 0.2));
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  starGeo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
}
const starMat = new THREE.PointsMaterial({ size: 1.8, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false, fog: false, opacity: 0 });
export const stars = new THREE.Points(starGeo, starMat); stars.frustumCulled = false; scene.add(stars);
function makeMoonTexture() {
  const Sz = 256, cv = document.createElement('canvas'); cv.width = cv.height = Sz;
  const g = cv.getContext('2d'), rng = mulberry32(3);
  const grd = g.createRadialGradient(Sz * 0.45, Sz * 0.45, 10, Sz / 2, Sz / 2, Sz * 0.48);
  grd.addColorStop(0, '#fbf8ee'); grd.addColorStop(1, '#cfcabb');
  g.fillStyle = grd; g.beginPath(); g.arc(Sz / 2, Sz / 2, Sz * 0.47, 0, 7); g.fill();
  g.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(120,115,105,${0.08 + rng() * 0.18})`; g.beginPath(); g.arc(rng() * Sz, rng() * Sz, 4 + rng() * 34, 0, 7); g.fill(); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const moon = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: makeMoonTexture(), transparent: true, depthWrite: false, fog: false, color: new THREE.Color(2.5, 2.5, 2.5) }));
moon.scale.setScalar(260); moon.frustumCulled = false; scene.add(moon);

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
export const env = { night: 0, day: 1, lightDir: new THREE.Vector3(), azimuth: 2.2 };
const tmpC = new THREE.Color(), tmpC2 = new THREE.Color();
let lastEnvHour = -99, envTimer = 0;
const fogCol = new THREE.Color(), horizonCol = new THREE.Color(), zenithCol = new THREE.Color();
export function updateSky(force) {
  const th = (time.hour - 6) / 12 * Math.PI, tilt = 0.62;
  sunDir.set(Math.cos(th), Math.sin(th) * Math.cos(tilt), Math.sin(th) * Math.sin(tilt)).applyAxisAngle(up, env.azimuth).normalize();
  const el = sunDir.y;
  skyU.sunPosition.value.copy(sunDir);
  const night = smoothstep(0.02, -0.16, el), warm = smoothstep(0.0, 0.32, el);
  env.night = night; env.day = smoothstep(-0.05, 0.12, el);
  tmpC.setRGB(1.0, 0.42, 0.16).lerp(tmpC2.setRGB(1.0, 0.95, 0.88), warm);
  if (el > -0.04) { sun.color.copy(tmpC); sun.intensity = 3.4 * smoothstep(-0.04, 0.14, el); env.lightDir.copy(sunDir); }
  else { sun.color.setRGB(0.55, 0.65, 1.0); sun.intensity = 0.32 * smoothstep(-0.04, -0.2, el); env.lightDir.copy(sunDir).negate(); }
  const sc = sun.color.clone().multiplyScalar(sun.intensity);
  S.uSunCol.value.set(sc.r, sc.g, sc.b);
  hemi.intensity = night * 0.9;
  starMat.opacity = smoothstep(0.0, -0.18, el);
  stars.visible = starMat.opacity > 0.01;
  skyU.uNight.value = smoothstep(-0.02, -0.2, el);
  moon.visible = -sunDir.y > -0.05;
  renderer.toneMappingExposure = lerp(0.55, 1.35, night) * lerp(1.15, 1.0, clamp(warm + night, 0, 1));
  envTimer -= 1;
  if (force || Math.abs(time.hour - lastEnvHour) > 0.08 || envTimer <= 0) {
    lastEnvHour = time.hour; envTimer = 240;
    if (envRT) envRT.dispose();
    envRT = pmrem.fromScene(skyScene, 0.04);
    scene.environment = envRT.texture;
    probeSky(new THREE.Vector3(-sunDir.z, 0.06, sunDir.x).normalize(), horizonCol);
    probeSky(new THREE.Vector3(sunDir.x, 0.05, sunDir.z).normalize(), fogCol);
    // base fog colour = sky away from the sun; the sun-facing glow is added per pixel by the fog shader
    probeSky(new THREE.Vector3(-sunDir.x, 0.06, -sunDir.z).normalize(), tmpC2);
    fogCol.lerp(horizonCol, 0.5).lerp(tmpC2, 0.3);
    probeSky(new THREE.Vector3(0.01, 1, 0), zenithCol);
  }
  scene.fog.color.copy(fogCol).lerp(tmpC.setRGB(0.012, 0.016, 0.028), night * 0.7);
  scene.environmentIntensity = lerp(1.0, 0.25, night);
  S.uFogCol.value.set(scene.fog.color.r, scene.fog.color.g, scene.fog.color.b);
  const amb = tmpC2.copy(zenithCol).lerp(horizonCol, 0.5).multiplyScalar(0.55).add(tmpC.setRGB(0.012, 0.016, 0.03).multiplyScalar(night));
  S.uAmb.value.set(amb.r, amb.g, amb.b);
  const fs = fogU.fogSunDir.value; fs.x = sunDir.x; fs.y = sunDir.y; fs.z = sunDir.z;
  const fsc = fogU.fogSunColor.value, glow = (1 - night) * 0.07 * (1.0 + (1 - warm) * 1.2); // stronger haze glow when the sun is low
  fsc.x = sc.r * glow; fsc.y = sc.g * glow; fsc.z = sc.b * glow;
}

const lsInv = new THREE.Matrix4(), lsMat = new THREE.Matrix4(), snapV = new THREE.Vector3(), origin = new THREE.Vector3();
export function followCamera(groundAt, yaw) {
  const c = camera.position;
  clouds.position.copy(c);
  stars.position.copy(c);
  moon.position.copy(c).addScaledVector(sunDir, -9000); moon.lookAt(c);
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
