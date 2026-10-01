// Night lighting from every lamp in town at once. The old scheme moved six real point lights onto the six fixtures
// nearest the camera, so every other lamp lit nothing and each pool of light switched on as you walked up to it.
// Here all fixtures (lampPoints) are lit per pixel, with no distance at which a light activates:
//   - the fixtures go into a float texture (position, radius, colour × intensity);
//   - an 8 m grid over the town lists, per cell, the K lamps that matter most there (a lamp is listed in every cell its
//     sphere of influence touches), so a fragment only loops over its own cell's short list; the cell lists are rows of
//     the same texture below the lamps (one sampler: the grass cards already use all sixteen the GPU binds);
//   - lights_fragment_begin runs those lamps through the material's own RE_Direct (toon diffuse + specular), for every
//     standard material (buildings, roads, terrain, grass, trees, cars, people) that enableCityLights() tags.
// Tiers: within ~1.2 km every lamp lights its surroundings (a lamp's own falloff ends at its radius, smoothly); past that
// the contribution fades out over a few hundred metres (a pool is then a pixel or two) and the emissive lamp heads,
// lit windows and bloom carry the town. Nothing depends on the camera's distance to a particular lamp.
import { THREE } from './core.js';

const K = 8, CELL = 8, LW = 512; // lamps per cell, cell size (m), lamps per row of the lamp texture
export const cityLightU = {
  uCLamp: { value: null }, uCLRow: { value: 0 }, uCLGrid: { value: new THREE.Vector2() }, uCLDim: { value: new THREE.Vector2() },
  uCLI: { value: 0 }, uCLFar: { value: new THREE.Vector2(1200, 1600) },
  uCLDen: { value: null }, uCLDenT: { value: new THREE.Vector4() }, uCLAmb: { value: new THREE.Vector3(0.1, 0.075, 0.055) },
};

THREE.ShaderChunk.lights_pars_begin += /* glsl */`
#ifdef CITY_LIGHTS
uniform highp sampler2D uCLamp; uniform sampler2D uCLDen; uniform vec2 uCLGrid, uCLDim, uCLFar; uniform float uCLI; uniform int uCLRow; uniform vec4 uCLDenT; uniform vec3 uCLAmb;
#endif
`;
THREE.ShaderChunk.lights_fragment_begin += /* glsl */`
#if defined( CITY_LIGHTS ) && defined( RE_Direct )
if ( uCLI > 0.0 ) {
	vec3 clWP = ( geometryPosition - viewMatrix[ 3 ].xyz ) * mat3( viewMatrix ); // view -> world
	float clFade = uCLI * smoothstep( uCLFar.y, uCLFar.x, length( vViewPosition ) );
	// light pollution / bounce: a faint warm fill where lamps are dense, mostly from above; zero out in the country
	float clDen = texture( uCLDen, ( clWP.xz - uCLDenT.xy ) * uCLDenT.zw ).r;
	reflectedLight.indirectDiffuse += uCLI * clDen * uCLAmb * ( 0.55 + 0.45 * ( geometryNormal * mat3( viewMatrix ) ).y ) * BRDF_Lambert( material.diffuseColor );
	ivec2 clC = ivec2( floor( ( clWP.xz - uCLGrid ) / ${CELL.toFixed(1)} ) );
	if ( clFade > 0.0 && clC.x >= 0 && clC.y >= 0 && clC.x < int( uCLDim.x ) && clC.y < int( uCLDim.y ) ) {
		vec4 clA = texelFetch( uCLamp, ivec2( clC.x * 2, clC.y + uCLRow ), 0 ), clB = texelFetch( uCLamp, ivec2( clC.x * 2 + 1, clC.y + uCLRow ), 0 );
		float clIdx[ 8 ] = float[ 8 ]( clA.x, clA.y, clA.z, clA.w, clB.x, clB.y, clB.z, clB.w );
		IncidentLight clL; clL.visible = true;
		for ( int i = 0; i < 8; i ++ ) {
			float li = clIdx[ i ];
			if ( li < 0.0 ) break;
			ivec2 lt = ivec2( int( mod( li, ${LW.toFixed(1)} ) ) * 2, int( li / ${LW.toFixed(1)} ) );
			vec4 lp = texelFetch( uCLamp, lt, 0 ), lc = texelFetch( uCLamp, lt + ivec2( 1, 0 ), 0 );
			vec3 lv = lp.xyz - clWP; float d2 = dot( lv, lv ), r2 = lp.w * lp.w;
			float w = saturate( 1.0 - d2 * d2 / ( r2 * r2 ) ); w *= w; // three's punctual window: reaches zero at the radius, smoothly
			if ( w <= 0.0 ) continue;
			// fixtures throw their light down and out (street lamps, canopy and ceiling lights): little goes up past them
			float down = mix( 0.06, 1.0, smoothstep( -0.15, 0.45, lv.y * inversesqrt( d2 + 1e-4 ) ) );
			clL.direction = normalize( mat3( viewMatrix ) * lv );
			clL.color = lc.rgb * ( clFade * w * down / ( d2 + 4.0 ) ); // + 4: a fixture about 2 m across, no hot spot on the surface it hangs from
			RE_Direct( clL, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
		}
	}
}
#endif
`;

const WARM = [1.0, 0.85, 0.66];
// lamps: [{ p: [x, y, z], s: strength, c?: [r, g, b] }]
export function buildCityLights(lamps) {
  const n = lamps.length, rows = Math.max(1, Math.ceil(n / LW));
  const LT = new Float32Array(LW * 2 * rows * 4);
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  const L = lamps.map((l, i) => {
    const s = l.s, R = 10 + 18 * Math.sqrt(s), I = 55 * s, c = l.c || WARM, o = ((i % LW) * 2 + Math.floor(i / LW) * LW * 2) * 4;
    LT.set([l.p[0], l.p[1], l.p[2], R, c[0] * I, c[1] * I, c[2] * I, 0], o);
    x0 = Math.min(x0, l.p[0] - R); z0 = Math.min(z0, l.p[2] - R); x1 = Math.max(x1, l.p[0] + R); z1 = Math.max(z1, l.p[2] + R);
    return { x: l.p[0], y: l.p[1], z: l.p[2], R, I, i };
  });
  if (!n) { x0 = z0 = 0; x1 = z1 = CELL; }
  x0 = Math.floor(x0 / CELL) * CELL; z0 = Math.floor(z0 / CELL) * CELL;
  const GX = Math.ceil((x1 - x0) / CELL), GY = Math.ceil((z1 - z0) / CELL);
  const lists = Array.from({ length: GX * GY }, () => []);
  for (const l of L) {
    const cx0 = Math.floor((l.x - l.R - x0) / CELL), cx1 = Math.floor((l.x + l.R - x0) / CELL), cz0 = Math.floor((l.z - l.R - z0) / CELL), cz1 = Math.floor((l.z + l.R - z0) / CELL);
    for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
      const ax = x0 + cx * CELL, az = z0 + cz * CELL, dx = Math.max(ax - l.x, 0, l.x - ax - CELL), dz = Math.max(az - l.z, 0, l.z - az - CELL);
      const d2 = dx * dx + dz * dz; // horizontal reach decides membership
      if (d2 >= l.R * l.R) continue;
      const w = (1 - (d2 / (l.R * l.R)) ** 2) ** 2, imp = l.I * w / (d2 + 4);
      lists[cz * GX + cx].push([imp, l.i]);
    }
  }
  const CT = new Float32Array(GX * 2 * GY * 4).fill(-1);
  let full = 0;
  lists.forEach((ls, k) => {
    if (ls.length > K) { full++; ls.sort((a, b) => b[0] - a[0]); }
    const cx = k % GX, cz = Math.floor(k / GX);
    for (let j = 0; j < Math.min(K, ls.length); j++) CT[(cz * GX * 2 + cx * 2) * 4 + j] = ls[j][1];
  });
  // lamps in rows [0, rows), cell lists in rows [rows, rows + GY)
  const W = Math.max(LW * 2, GX * 2), D = new Float32Array(W * (rows + GY) * 4);
  for (let r = 0; r < rows; r++) D.set(LT.subarray(r * LW * 2 * 4, (r + 1) * LW * 2 * 4), r * W * 4);
  for (let r = 0; r < GY; r++) D.set(CT.subarray(r * GX * 2 * 4, (r + 1) * GX * 2 * 4), (rows + r) * W * 4);
  const t = new THREE.DataTexture(D, W, rows + GY, THREE.RGBAFormat, THREE.FloatType); t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
  cityLightU.uCLamp.value = t; cityLightU.uCLRow.value = rows;
  cityLightU.uCLGrid.value.set(x0, z0); cityLightU.uCLDim.value.set(GX, GY);
  // lamp density (16 m cells, gaussian splat of 35 m) for the ambient fill; a 160 m margin lets it fade to nothing
  { const DC = 16, M = 160, dx0 = x0 - M, dz0 = z0 - M, DX = Math.ceil((x1 - x0 + 2 * M) / DC), DZ = Math.ceil((z1 - z0 + 2 * M) / DC), D = new Float32Array(DX * DZ), sg = 35;
    for (const l of L) { const ci = (l.x - dx0) / DC, cj = (l.z - dz0) / DC, rr = Math.ceil(3 * sg / DC);
      for (let j = Math.max(0, Math.floor(cj - rr)); j <= Math.min(DZ - 1, Math.ceil(cj + rr)); j++) for (let i = Math.max(0, Math.floor(ci - rr)); i <= Math.min(DX - 1, Math.ceil(ci + rr)); i++) {
        const ex = (i + 0.5 - ci) * DC, ez = (j + 0.5 - cj) * DC; D[j * DX + i] += l.I * Math.exp(-(ex * ex + ez * ez) / (2 * sg * sg)); } }
    const nz = [...D].filter(v => v > 0.5).sort((a, b) => a - b), ref = nz.length ? nz[Math.floor(nz.length * 0.95)] : 1;
    const B8 = new Uint8Array(DX * DZ * 4); for (let k = 0; k < DX * DZ; k++) B8[k * 4] = Math.round(255 * Math.min(1, D[k] / ref));
    const t = new THREE.DataTexture(B8, DX, DZ, THREE.RGBAFormat); t.minFilter = t.magFilter = THREE.LinearFilter; t.needsUpdate = true;
    cityLightU.uCLDen.value = t; cityLightU.uCLDenT.value.set(dx0, dz0, 1 / (DX * DC), 1 / (DZ * DC)); }
  return { lamps: n, cells: GX * GY, saturated: full };
}

// tag every lit standard material under root (its onBeforeCompile and program key are kept, extended)
const tagged = new WeakSet();
export function enableCityLights(root) {
  let count = 0;
  root.traverse(o => {
    for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
      if (tagged.has(m) || !(m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial || m.isMeshToonMaterial)) continue;
      tagged.add(m); count++;
      const ob = m.onBeforeCompile, own = Object.prototype.hasOwnProperty.call(m, 'customProgramCacheKey') ? m.customProgramCacheKey : null, obKey = ob.toString();
      m.onBeforeCompile = function (sh, r) { ob.call(this, sh, r); Object.assign(sh.uniforms, cityLightU); };
      m.customProgramCacheKey = own ? function () { return own.call(this) + '|CL'; } : () => obKey + '|CL';
      m.defines = Object.assign({}, m.defines, { CITY_LIGHTS: '' });
      m.needsUpdate = true;
    }
  });
  return count;
}
