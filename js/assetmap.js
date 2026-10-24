// A deliberately tiny walkable prototype assembled from the four owned Unity packs.
// The source packages stay untouched; tools/assetmap-import.mjs produces the normalised GLBs used here.
import { THREE, scene, gltfLoader, addBox, addCircle, maxAniso, mulberry32, tick } from './core.js';
import { Heightfield } from './terrain.js';
import { env } from './sky.js';

export const meta = {
  name: 'Asset Garden',
  builder: false,
  startHour: 16.2,
  sunAzimuth: 2.35,
  life: { flowers: false, birds: false, fireflies: 0, mist: 0 },
};

const BASE = 'assets/models/assetmap/';
const MODEL_IDS = [
  'anime-house-01',
  'anime-wall-fence',
  'anime-entrance-fence',
  'anime-airconditioner-01',
  'anime-bicycle',
  'anime-moped',
  'anime-mailbox',
  'anime-trash-can',
  'anime-flowerpot-03',
  'anime-utility-pole-01',
  'anime-lamp-01',
  'anime-bush-01',
  'anime-tree-garden',
  'illustrated-boulder-01',
  'illustrated-flower-01',
  'farm-greenhouse-small',
  'farm-tomato',
  'farm-crate',
];

function groundPiece(geometry, material, x, y, z, rotation = 0) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.rotation.y = rotation;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

function prepareModel(root, id) {
  root.name = id;
  root.userData.assetId = id;
  root.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const mat of mats) {
      if (!mat) continue;
      if (mat.map) mat.map.anisotropy = Math.min(maxAniso, 8);
      if (mat.transparent) { mat.depthWrite = false; mat.alphaTest = Math.max(mat.alphaTest || 0, 0.04); }
      if (id === 'anime-house-01' && /M_walls_building/i.test(mat.name)) mat.color.set(0x626861);
      if (id === 'anime-house-01' && /M_edge_wall|M_roof_base/i.test(mat.name)) mat.color.set(0x4d5350);
    }
  });
  return root;
}

function place(proto, x, z, rotation = 0, scale = 1, parent = scene) {
  const object = proto.clone(true);
  object.position.set(x, 0, z);
  object.rotation.y = rotation;
  object.scale.setScalar(scale);
  parent.add(object);
  return object;
}

function placeAt(proto, x, y, z, rotation = 0, scale = 1, parent = scene) {
  const object = place(proto, x, z, rotation, scale, parent);
  object.position.y = y;
  return object;
}

function addWall(proto, parent, x, z, rotation = 0) {
  place(proto, x, z, rotation, 1, parent);
  addBox(x, z, rotation ? 0.18 : 1.52, rotation ? 1.52 : 0.18, 0, 0, 1.9);
}

function addWire(a, b, sag, material, parent) {
  const mid = new THREE.Vector3((a.x + b.x) / 2, (a.y + b.y) / 2 - sag, (a.z + b.z) / 2);
  const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 20, 0.022, 5, false), material);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

export async function build(progress = () => {}) {
  progress('Preparing the asset garden', 0.08);
  await tick();

  // The ambient-life shaders expect a height field. This tiny flat one also keeps their masks local and predictable.
  const hf = new Heightfield({ world: 112, grid: 28, height: () => 0 });
  hf.H.fill(0);
  for (let i = 0; i < hf.mask.length; i += 4) { hf.mask[i + 1] = 255; hf.mask[i + 3] = 255; }
  hf.uploadHeight();
  hf.uploadMasks();

  const grass = new THREE.MeshStandardMaterial({ color: 0x6f8f50, roughness: 1, metalness: 0 });
  const path = new THREE.MeshStandardMaterial({ color: 0xaaa292, roughness: 0.96, metalness: 0 });
  const soil = new THREE.MeshStandardMaterial({ color: 0x62442d, roughness: 1, metalness: 0 });
  const edging = new THREE.MeshStandardMaterial({ color: 0x77746e, roughness: 0.92, metalness: 0 });
  const asphalt = new THREE.MeshStandardMaterial({ color: 0x3e4448, roughness: 0.95, metalness: 0 });
  const concrete = new THREE.MeshStandardMaterial({ color: 0xaaa9a2, roughness: 0.9, metalness: 0 });
  const gravel = new THREE.MeshStandardMaterial({ color: 0x80786b, roughness: 1, metalness: 0 });
  const drain = new THREE.MeshStandardMaterial({ color: 0x252b2c, roughness: 0.72, metalness: 0.35 });
  const wireMaterial = new THREE.MeshStandardMaterial({ color: 0x171b1e, roughness: 0.7, metalness: 0.15 });
  const glowMaterial = new THREE.MeshStandardMaterial({ color: 0xffd28a, emissive: 0xff9f35, emissiveIntensity: 2.2, roughness: 0.25 });

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(96, 96, 1, 1).rotateX(-Math.PI / 2), grass);
  ground.position.y = -0.06;
  ground.receiveShadow = true;
  ground.name = 'asset-garden-ground';
  scene.add(ground);
  groundPiece(new THREE.PlaneGeometry(94, 8).rotateX(-Math.PI / 2), asphalt, 0, 0.008, 15);
  groundPiece(new THREE.PlaneGeometry(94, 1.8).rotateX(-Math.PI / 2), concrete, 0, 0.025, 10.1);
  groundPiece(new THREE.PlaneGeometry(94, 1.8).rotateX(-Math.PI / 2), concrete, 0, 0.025, 19.9);
  groundPiece(new THREE.BoxGeometry(94, 0.18, 0.22), edging, 0, 0.08, 11.02);
  groundPiece(new THREE.BoxGeometry(94, 0.18, 0.22), edging, 0, 0.08, 18.98);
  for (let x = -42; x <= 42; x += 7) groundPiece(new THREE.BoxGeometry(1.4, 0.035, 0.42), drain, x, 0.045, 11.3);
  groundPiece(new THREE.PlaneGeometry(18.2, 20).rotateX(-Math.PI / 2), gravel, 0, 0.004, -3.4);
  groundPiece(new THREE.PlaneGeometry(4.5, 5.2).rotateX(-Math.PI / 2), concrete, 4.65, 0.03, 8.1);
  groundPiece(new THREE.PlaneGeometry(1.65, 5.2).rotateX(-Math.PI / 2), path, -1.55, 0.032, 8.1);

  progress('Loading owned asset models', 0.18);
  const loaded = await Promise.all(MODEL_IDS.map(async (id, index) => {
    const gltf = await gltfLoader.loadAsync(BASE + id + '.glb?v=3');
    progress('Loading owned asset models', 0.18 + (index + 1) / MODEL_IDS.length * 0.48);
    return [id, prepareModel(gltf.scene, id)];
  }));
  const model = Object.fromEntries(loaded);

  progress('Building the detailed residential lot', 0.7);
  const lot = new THREE.Group();
  lot.name = 'detailed-japanese-residential-lot';
  scene.add(lot);
  place(model['anime-house-01'], 0, -4.2, -Math.PI / 2, 1, lot);
  addBox(0, -4.2, 4.05, 4.48, -Math.PI / 2, 0, 9.4);

  // A real modular wall set encloses the lot. The pedestrian gate and driveway remain open and walkable.
  for (const x of [-7.45, -4.42, 6.28, 8.32]) addWall(model['anime-wall-fence'], lot, x, 5.55);
  for (const z of [3.75, 0.72, -2.31, -5.34, -8.37, -11.4]) {
    addWall(model['anime-wall-fence'], lot, -9.12, z, Math.PI / 2);
    addWall(model['anime-wall-fence'], lot, 9.12, z, Math.PI / 2);
  }
  for (const x of [-7.45, -4.42, -1.39, 1.64, 4.67, 7.7]) addWall(model['anime-wall-fence'], lot, x, -13.18);
  for (const [x, z] of [[-9.12, 5.55], [9.12, 5.55], [-9.12, -13.18], [9.12, -13.18], [-2.55, 5.55], [0.25, 5.55]]) {
    groundPiece(new THREE.BoxGeometry(0.58, 1.86, 0.58), edging, x, 0.93, z);
    addBox(x, z, 0.3, 0.3, 0, 0, 1.9);
  }
  place(model['anime-entrance-fence'], -1.16, 5.49, 0, 1.25, lot);

  // Everyday domestic detail from the same pack, placed at measured real-world heights.
  placeAt(model['anime-airconditioner-01'], 4.72, 1.72, -3.6, -Math.PI / 2, 0.9, lot);
  place(model['anime-airconditioner-01'], 4.85, -7.15, -Math.PI / 2, 0.82, lot);
  place(model['anime-bicycle'], 6.35, 1.85, -Math.PI / 2, 0.86, lot);
  place(model['anime-moped'], 4.2, 3.45, 0.05, 0.9, lot);
  groundPiece(new THREE.BoxGeometry(0.12, 1.05, 0.12), edging, -1.95, 0.52, 5.05);
  placeAt(model['anime-mailbox'], -1.95, 1.02, 5.02, 0, 1.05, lot);
  place(model['anime-trash-can'], 7.42, 3.15, 0.1, 0.86, lot);
  for (const [x, z, r, s] of [[-3.25, 0.7, 0.1, 0.95], [-2.73, 0.62, -0.2, 0.82], [-3.48, -0.05, 0.25, 0.72], [7.3, 1.5, -0.15, 0.86]]) {
    place(model['anime-flowerpot-03'], x, z, r, s, lot);
  }

  place(model['anime-tree-garden'], -6.35, -7.4, 0.45, 1.15, lot);
  addCircle(-6.35, -7.4, 1.25, 0, 5.2);
  for (const [x, z, s] of [[-6.7, 2.6, 0.52], [-4.8, 2.45, 0.46], [7.45, -0.1, 0.48], [7.25, -2.05, 0.42], [-7.25, -10.5, 0.44]]) {
    place(model['anime-bush-01'], x, z, 0.3 + x, s, lot);
    addCircle(x, z, 0.7 * s, 0, 1.5);
  }

  const rng = mulberry32(2048);
  for (let i = 0; i < 24; i++) {
    const x = -7.55 + rng() * 4.4, z = -0.2 + rng() * 4.1;
    place(model['illustrated-flower-01'], x, z, rng() * Math.PI * 2, 0.68 + rng() * 0.34, lot);
  }
  for (const [x, z, r, s] of [[-7.1, 0.1, 0.2, 0.7], [-5.85, 1.15, 1.7, 0.48], [7.4, -10.4, 2.3, 0.62]]) {
    place(model['illustrated-boulder-01'], x, z, r, s, lot);
  }

  // Utility poles, street lamps and sagging overhead lines create the dense Japanese street silhouette in the references.
  const utilities = new THREE.Group();
  utilities.name = 'street-utilities';
  scene.add(utilities);
  for (const [x, r] of [[-14, 0.1], [14, Math.PI]]) {
    place(model['anime-utility-pole-01'], x, 11.8, r, 1.32, utilities);
    addCircle(x, 11.8, 0.38, 0, 6.6);
    placeAt(model['anime-lamp-01'], x + (x < 0 ? 0.45 : -0.45), 4.78, 11.45, x < 0 ? 0 : Math.PI, 1.08, utilities);
  }
  for (const y of [5.45, 5.78, 6.08]) addWire(new THREE.Vector3(-14, y, 11.8), new THREE.Vector3(14, y - 0.08, 11.8), 0.45 + (y - 5.45) * 0.2, wireMaterial, utilities);
  addWire(new THREE.Vector3(-14, 5.55, 11.8), new THREE.Vector3(-2.8, 7.15, -0.7), 1.2, wireMaterial, utilities);

  const nightLights = [];
  for (const [x, y, z, d] of [[-13.55, 4.62, 11.42, 11], [13.55, 4.62, 11.42, 11], [-2.8, 2.35, 0.18, 7]]) {
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.095, 12, 8), glowMaterial);
    bulb.position.set(x, y, z); utilities.add(bulb);
    const light = new THREE.PointLight(0xffb868, 0, d, 2); light.position.set(x, y - 0.08, z); scene.add(light); nightLights.push(light);
  }

  progress('Adding the surrounding pocket farm and woodland', 0.84);
  const farm = new THREE.Group();
  farm.name = 'polygon-farm-pocket-plot';
  scene.add(farm);
  place(model['farm-greenhouse-small'], 28.5, -21.5, Math.PI / 2, 0.9, farm);
  addBox(28.5, -21.5, 3.5, 2.55, Math.PI / 2, 0, 4.6);
  const bedX = [23.5, 26.7, 29.9];
  for (let row = 0; row < bedX.length; row++) {
    groundPiece(new THREE.BoxGeometry(2.15, 0.16, 7.2), soil, bedX[row], 0.03, -11.5);
    for (let k = 0; k < 4; k++) place(model['farm-tomato'], bedX[row], -14.1 + k * 1.75, (row + k) % 2 ? Math.PI : 0, 0.78 + ((row * 3 + k) % 3) * 0.04, farm);
  }
  place(model['farm-crate'], 24.7, -19.0, 0.18, 1, farm);
  place(model['farm-crate'], 25.55, -19.15, -0.12, 0.92, farm);

  const nature = new THREE.Group();
  nature.name = 'nature-from-owned-packs';
  scene.add(nature);
  const trees = [
    [-32, -29, 0.96], [-22, -36, 1.08], [-11, -39, 0.9], [14, -38, 1.06], [38, -31, 0.93],
    [-35, -10, 1.02], [-35, 31, 0.88], [32, 33, 0.98], [39, 2, 1.06],
  ];
  trees.forEach(([x, z, s], i) => { place(model['anime-tree-garden'], x, z, i * 1.19, s * 1.38, nature); addCircle(x, z, 1.2 * s, 0, 6.5 * s); });

  // Low timber boundary makes the edge legible while bounds remain the authoritative player limit.
  for (const [x, z, sx, sz] of [[0, -47, 47, 0.12], [0, 47, 47, 0.12], [-47, 0, 0.12, 47], [47, 0, 0.12, 47]]) {
    groundPiece(new THREE.BoxGeometry(sx * 2, 0.36, sz * 2), edging, x, 0.12, z);
  }

  progress('Finalising the small map', 0.94);
  await tick();
  return {
    hf,
    spawn: { x: 0, z: 23, yaw: 0, pitch: -0.08 },
    bounds: { minX: -46, maxX: 46, minZ: -46, maxZ: 46 },
    waterLevel: -20,
    waterAt: () => -Infinity,
    groundAt: (x, z) => hf.groundAt(x, z),
    normalAt: (x, z, out) => out.set(0, 1, 0),
    surfaceAt: (x, z) => z > 10.9 && z < 19.1 ? 'asphalt' : z > 5.4 && z < 11 ? 'concrete' : Math.abs(x) < 9.2 && z < 5.6 && z > -13.3 ? 'gravel' : 'grass',
    ambience: () => ({ forest: 0.18, town: 0.4, water: 0 }),
    update() { for (const light of nightLights) light.intensity = env.night * 32; glowMaterial.emissiveIntensity = 0.5 + env.night * 3.2; },
    materials: { grass, path, soil, edging, asphalt, concrete, gravel, drain, wireMaterial },
    assetManifest: BASE + 'manifest.json',
  };
}
