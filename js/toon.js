// Anime / cel look for every lit material: banded diffuse with a soft terminator (and a little wrap, so round forms keep
// a generous lit side), gentle specular, softer less-saturated ambient in the shadows, and scanned photo textures
// flattened toward their average colour so surfaces read as painted rather than photographed.
import { THREE, scene } from './core.js';

const pl = THREE.ShaderChunk.lights_physical_pars_fragment;
const rep = [
  ['vec3 irradiance = dotNL * directLight.color;',
    'float toonNL = smoothstep( -0.05, 0.12, dot( geometryNormal, directLight.direction ) ) * 0.84 + dotNL * 0.16;\n\tvec3 irradiance = toonNL * directLight.color;'],
  ['reflectedLight.directSpecular += irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );',
    // specular keeps the plain N.L falloff: GGX's visibility term divides by N.V, and the toon wrap would otherwise
    // light it where N.L = 0 and blow silhouettes up into white-hot pixels
    'reflectedLight.directSpecular += dotNL * directLight.color * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material ) * 0.3;'],
  // painted surfaces don't mirror the sky: damp image-based specular unless the material is genuinely glossy (glass, water)
  ['reflectedLight.indirectSpecular += radiance * singleScattering;',
    'reflectedLight.indirectSpecular += radiance * singleScattering * mix( 1.0, 0.2, smoothstep( 0.15, 0.5, material.roughness ) );'],
  ['vec3 cosineWeightedIrradiance = irradiance * RECIPROCAL_PI;',
    'vec3 cosineWeightedIrradiance = mix( vec3( dot( irradiance, vec3( 0.3, 0.59, 0.11 ) ) ), irradiance, 0.42 ) * RECIPROCAL_PI * 1.55;'],
];
let src = pl;
for (const [a, b] of rep) { if (!src.includes(a)) throw new Error('toon: three chunk changed: ' + a); src = src.replace(a, b); }
THREE.ShaderChunk.lights_physical_pars_fragment = src;

THREE.ShaderChunk.color_fragment = /* glsl */`
#if defined( USE_MAP ) && defined( TOON_FLAT )
	{ vec3 toonAvg = diffuse * textureLod( map, vMapUv, 5.5 ).rgb; diffuseColor.rgb = mix( toonAvg, diffuseColor.rgb, 0.28 );
	  diffuseColor.rgb = diffuseColor.rgb * 0.82 + 0.05; } // painted albedos: no near-black surfaces
#endif
` + THREE.ShaderChunk.color_fragment;

// photo textures (Poly Haven maps, scanned glTF models) are tagged by the loaders in core.js; canvas textures (signs,
// text) are not, so they stay crisp
export function flattenPhotoMaterials(root = scene) {
  root.traverse(o => {
    for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
      if (!m.map || !m.map.userData.photo || (m.defines && 'TOON_FLAT' in m.defines)) continue;
      m.defines = Object.assign({}, m.defines, { TOON_FLAT: '' });
      m.needsUpdate = true;
    }
  });
}
