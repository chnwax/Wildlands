// Selection highlight drawn over the frame: the silhouette of every selected object (including the parts hidden behind
// other things) is rendered into a mask, and a full-screen pass draws its outline in orange with a faint fill — clearly
// visible on any background, whatever the object is drawn with (merged, instanced or its own mesh). Objects too many
// to outline (big box selections) and hidden objects get their bounding box drawn instead. The gizmo is drawn last.
import { THREE, renderer, camera } from '../core.js';

const white = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, depthTest: false, depthWrite: false, fog: false });
const hover = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0.3, 0.3, 0.3, THREE.LinearSRGBColorSpace), side: THREE.DoubleSide, depthTest: false, depthWrite: false, fog: false });
export class Outline {
  constructor() {
    this.maskScene = new THREE.Scene(); this.overlay = new THREE.Scene(); this.proxies = []; this.hoverProxies = []; this.boxes = [];
    this.rt = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: false });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: { tMask: { value: this.rt.texture }, uTexel: { value: new THREE.Vector2() }, uColor: { value: new THREE.Color(0xff9d2e) }, uHover: { value: new THREE.Color(0x9ec9ff) } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */`
        uniform sampler2D tMask; uniform vec2 uTexel; uniform vec3 uColor, uHover; varying vec2 vUv;
        void main() {
          vec4 c = texture2D(tMask, vUv);
          float sel = c.r > 0.5 ? 1.0 : 0.0, hov = (c.r > 0.1 && c.r < 0.5) ? 1.0 : 0.0;
          float mx = 0.0, mn = 1.0, hx = 0.0;
          for (int i = -2; i <= 2; i++) for (int j = -2; j <= 2; j++) {
            if (abs(float(i)) + abs(float(j)) > 3.0) continue;
            float v = texture2D(tMask, vUv + vec2(float(i), float(j)) * uTexel).r;
            mx = max(mx, v > 0.5 ? 1.0 : 0.0); mn = min(mn, v > 0.5 ? 1.0 : 0.0); hx = max(hx, (v > 0.1 && v < 0.5) ? 1.0 : 0.0);
          }
          float edge = mx - mn;
          if (edge > 0.5) { gl_FragColor = vec4(uColor, 1.0); return; }
          if (sel > 0.5) { gl_FragColor = vec4(uColor, 0.10); return; }
          if (hx > 0.5 && hov < 0.5) { gl_FragColor = vec4(uHover, 0.9); return; }
          discard;
        }`,
      transparent: true, depthTest: false, depthWrite: false }));
    this.quad.frustumCulled = false; this.quadScene = new THREE.Scene(); this.quadScene.add(this.quad); this.quadCam = new THREE.Camera();
  }
  // meshes: the selected objects' meshes; boxes: Box3 list (world) drawn as wire boxes
  set(meshes, boxes = [], hoverMeshes = []) {
    for (const p of [...this.proxies, ...this.hoverProxies]) this.maskScene.remove(p);
    this.proxies = meshes.map(m => this.proxy(m, white)); this.hoverProxies = hoverMeshes.map(m => this.proxy(m, hover));
    for (const b of this.boxes) this.overlay.remove(b);
    this.boxes = boxes.map(b => { const h = new THREE.Box3Helper(b, 0xff9d2e); h.material.depthTest = false; h.material.transparent = true; h.material.opacity = 0.9; h.material.toneMapped = false; this.overlay.add(h); return h; });
  }
  proxy(m, material) {
    let p;
    if (m.isInstancedMesh) { p = new THREE.InstancedMesh(m.geometry, material, m.count); p.instanceMatrix = m.instanceMatrix; }
    else p = new THREE.Mesh(m.geometry, material);
    p.matrixAutoUpdate = false; p.matrixWorldAutoUpdate = false; p.frustumCulled = false; p.userData.src = m;
    this.maskScene.add(p); return p;
  }
  render(gizmoScene) {
    const has = this.proxies.length || this.hoverProxies.length;
    const auto = renderer.autoClear; renderer.autoClear = false;
    if (has) {
      const w = renderer.domElement.width, h = renderer.domElement.height;
      if (this.rt.width !== w || this.rt.height !== h) { this.rt.setSize(w, h); this.quad.material.uniforms.uTexel.value.set(1 / w, 1 / h); }
      for (const p of [...this.proxies, ...this.hoverProxies]) { const s = p.userData.src; p.matrixWorld.copy(s.matrixWorld); p.visible = !!s.parent; }
      renderer.setRenderTarget(this.rt); renderer.setClearColor(0x000000, 0); renderer.clear(true, false, false);
      const tm = renderer.toneMapping; renderer.toneMapping = THREE.NoToneMapping;
      // hover proxies first (dark grey), selection over them (white): the shader tells them apart by brightness
      for (const p of this.proxies) p.visible = false; renderer.render(this.maskScene, camera);
      for (const p of this.proxies) p.visible = true; for (const p of this.hoverProxies) p.visible = false; renderer.render(this.maskScene, camera);
      for (const p of this.hoverProxies) p.visible = true;
      renderer.toneMapping = tm;
      renderer.setRenderTarget(null);
      renderer.render(this.quadScene, this.quadCam);
    }
    if (this.boxes.length) renderer.render(this.overlay, camera);
    if (gizmoScene) { renderer.clearDepth(); renderer.render(gizmoScene, camera); }
    renderer.autoClear = auto;
  }
}
