"""Download every external asset Wildlands needs into ./assets and ./lib so the game runs offline.

Sources: Poly Haven (CC0) textures/models via its public API, three.js r170 from the npm registry (jsDelivr).
Run:  python tools/fetch_assets.py      (safe to re-run; existing files are skipped)
"""
import json, os, sys, urllib.request, concurrent.futures as cf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, 'assets')
API = 'https://api.polyhaven.com/files/'
UA = {'User-Agent': 'Wildlands-asset-fetch/1.0'}

# texture name -> list of (map kind, resolution)
# town surfaces also get height (parallax) + ARM (AO/roughness/metal) maps
RELIEF = ['grey_roof_tiles', 'concrete_block_wall', 'japanese_stone_wall', 'rectangular_facade_tiles', 'exterior_wall_cladding',
          'bicolour_gravel', 'concrete_pavement', 'white_stucco', 'beige_wall_001', 'concrete_wall_008', 'asphalt_pit_lane', 'japanese_cedar_planks']
TEXTURES = {
    # nature
    'aerial_grass_rock': [('diff', '2k'), ('nor_gl', '2k')],
    'forest_leaves_03': [('diff', '2k'), ('nor_gl', '1k')],
    'rock_face_03': [('diff', '2k'), ('nor_gl', '2k')],
    'coast_sand_01': [('diff', '2k'), ('nor_gl', '1k')],
    'pine_bark': [('diff', '1k'), ('nor_gl', '1k')],
    # town
    'asphalt_pit_lane': [('diff', '2k'), ('nor_gl', '1k'), ('rough', '1k')],
    'bicolour_gravel': [('diff', '1k'), ('nor_gl', '1k')],
    'beige_wall_001': [('diff', '1k'), ('nor_gl', '1k')],
    'white_stucco': [('diff', '1k'), ('nor_gl', '1k')],
    'exterior_wall_cladding': [('diff', '1k'), ('nor_gl', '1k')],
    'rectangular_facade_tiles': [('diff', '1k'), ('nor_gl', '1k')],
    'grey_roof_tiles': [('diff', '1k'), ('nor_gl', '1k')],
    'box_profile_metal_sheet': [('nor_gl', '1k'), ('rough', '1k')],
    'concrete_block_wall': [('diff', '1k'), ('nor_gl', '1k')],
    'japanese_stone_wall': [('diff', '1k'), ('nor_gl', '1k')],
    'painted_metal_shutter': [('nor_gl', '1k')],
    'concrete_pavement': [('diff', '1k'), ('nor_gl', '1k')],
    'concrete_wall_008': [('diff', '1k'), ('nor_gl', '1k')],
    'japanese_cedar_planks': [('diff', '1k'), ('nor_gl', '1k')],
    'brown_mud': [('diff', '1k'), ('nor_gl', '1k')],
    'sakura_bark': [('diff', '1k'), ('nor_gl', '1k')],
    'japanese_zelkova_bark': [('diff', '1k'), ('nor_gl', '1k')],
}
# glTF models (1k textures)
MODELS = ['rock_moss_set_01', 'boulder_01', 'fern_02', 'shrub_02', 'potted_plant_04', 'planter_box_01',
          'plastic_crate_01', 'utility_box_02', 'weed_plant_02', 'covered_car', 'water_manhole_cover',
          'concrete_road_barrier_02', 'tree_stump_01', 'dead_tree_trunk']
# loose model texture maps (asset, map, res) - used to build our own tree geometry
MODEL_MAPS = [('island_tree_02', 'leaves_diff', '1k'), ('island_tree_02', 'leaves_alpha', '1k'), ('island_tree_02', 'leaves_nor_gl', '1k'),
              ('fir_tree_01', 'twig_diff', '2k'), ('fir_tree_01', 'twig_alpha', '2k'), ('fir_tree_01', 'twig_nor_gl', '2k'),
              ('fir_tree_01', 'bark_diff', '1k'), ('fir_tree_01', 'bark_nor_gl', '1k')]
EXTRA = {
    'assets/tex/waternormals.jpg': 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r170/examples/textures/waternormals.jpg',
}
ALIASES = {'diff': ['diff', 'Diffuse'], 'rough': ['rough', 'Rough'], 'nor_gl': ['nor_gl'], 'disp': ['disp', 'Displacement'], 'arm': ['arm', 'ARM']}  # Poly Haven naming varies per asset
THREE_VER = '0.170.0'
THREE_FILES = ['build/three.module.js'] + ['examples/jsm/' + f for f in [
    'objects/Sky.js', 'loaders/GLTFLoader.js', 'utils/BufferGeometryUtils.js',
    'postprocessing/EffectComposer.js', 'postprocessing/RenderPass.js', 'postprocessing/UnrealBloomPass.js',
    'postprocessing/OutputPass.js', 'postprocessing/ShaderPass.js', 'postprocessing/Pass.js', 'postprocessing/MaskPass.js',
    'postprocessing/GTAOPass.js', 'shaders/CopyShader.js', 'shaders/LuminosityHighPassShader.js', 'shaders/OutputShader.js',
    'shaders/GTAOShader.js', 'shaders/PoissonDenoiseShader.js', 'math/SimplexNoise.js']]


def get_json(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return json.load(r)


def download(url, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return 'skip'
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + '.part'
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r, open(tmp, 'wb') as f:
        while True:
            chunk = r.read(1 << 16)
            if not chunk:
                break
            f.write(chunk)
    os.replace(tmp, dest)
    return 'ok'


def main():
    for n in RELIEF:
        TEXTURES.setdefault(n, [])
        TEXTURES[n] += [m for m in [('disp', '1k'), ('arm', '1k')] if m not in TEXTURES[n]]
    jobs = []  # (url, dest)
    for name, maps in TEXTURES.items():
        info = get_json(API + name)
        for kind, res in maps:
            key = next(k for k in ALIASES.get(kind, [kind]) if k in info)
            url = info[key][res]['jpg']['url']
            jobs.append((url, os.path.join(ASSETS, 'tex', f'{name}_{kind}_{res}.jpg')))
    for name in MODELS:
        g = get_json(API + name)['gltf']['1k']['gltf']
        base = os.path.join(ASSETS, 'models', name)
        jobs.append((g['url'], os.path.join(base, f'{name}_1k.gltf')))
        for rel, inc in g['include'].items():
            jobs.append((inc['url'], os.path.join(base, *rel.split('/'))))
    infos = {}
    for name, kind, res in MODEL_MAPS:
        infos.setdefault(name, get_json(API + name))
        url = infos[name][kind][res]['jpg']['url']
        jobs.append((url, os.path.join(ASSETS, 'tex', f'{name}_{kind}_{res}.jpg')))
    for rel, url in EXTRA.items():
        jobs.append((url, os.path.join(ROOT, *rel.split('/'))))
    for f in THREE_FILES:
        jobs.append((f'https://cdn.jsdelivr.net/npm/three@{THREE_VER}/{f}', os.path.join(ROOT, 'lib', 'three', *f.split('/'))))

    done = 0
    with cf.ThreadPoolExecutor(8) as ex:
        futs = {ex.submit(download, u, d): d for u, d in jobs}
        for fut in cf.as_completed(futs):
            done += 1
            d = os.path.relpath(futs[fut], ROOT)
            try:
                print(f'[{done}/{len(jobs)}] {fut.result():4} {d}')
            except Exception as e:
                print(f'[{done}/{len(jobs)}] FAIL {d}: {e}', file=sys.stderr)
    total = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(ASSETS) for f in fs)
    print(f'assets: {total / 1e6:.1f} MB')


if __name__ == '__main__':
    main()
