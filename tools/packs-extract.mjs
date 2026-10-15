// node tools/packs-extract.mjs [pack ...] — every model of every owned Unity pack (UnityAssets/, never modified) as a
// GLB file of its own, sorted into categories:
//   ModeleZPaczek/<kategoria>/<paczka>/<model>.glb     (textures shared: ModeleZPaczek/_tekstury/<paczka>/*.png)
//   ModeleZPaczek/katalog.json, KATALOG.md               (every model: category, pack, size in metres, triangles, source)
//   ModeleZPaczek/przegladarka.html                      (a viewer: open it through the dev server, Editor.bat →
//                                                         http://localhost:5180/ModeleZPaczek/przegladarka.html)
// Every prefab is baked (tools/packs-lib.mjs: metres, Y up, foot on the origin, materials and textures from Unity's
// .mat files), and every FBX no prefab uses. ModeleZPaczek/ is git-ignored: the licences cover use in the game, not
// redistribution of the files in a public repository.
import fs from 'fs';
import path from 'path';
import { ROOT, UA, PackBaker, writeGLB } from './packs-lib.mjs';

const OUT = path.join(ROOT, 'ModeleZPaczek');
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'packs.json'), 'utf8'));
const only = process.argv.slice(2);
const PACKS = [
  { id: 'anime_japan', pack: 'Idyllic Anime Japan', nodeRotation: 'pre' },
  { id: 'polygon_farm', pack: 'Polygon Farm' },
  { id: 'illustrated_nature', pack: 'The Illustrated Nature' },
  { id: 'idyllic_woodlands', pack: 'Idyllic Woodlands' },
];
// the material overrides the game's libraries use (leaf colours of the hue-variation foliage shaders)
for (const P of PACKS) P.materials = Object.assign({}, ...Object.values(CFG.libraries).filter(l => l.pack === P.pack).map(l => l.materials || {}));

// ---------------------------------------------------------------- categories (folder names)
export const CATEGORIES = {
  drzewa: 'drzewa, pnie, martwe drzewa',
  roslinnosc: 'krzewy, trawy, kwiaty, trzciny, lilie, liście, gałęzie na ziemi',
  uprawy_i_owoce: 'rośliny uprawne, warzywa, owoce, skrzynki z plonami, grządki',
  domy: 'domy mieszkalne, domy farmerskie, bloki mieszkalne',
  budynki: 'sklepy, konbini, restauracje, stodoły, garaże, szklarnie, silosy, szopy',
  urban_ulica: 'latarnie, słupy, sygnalizacja, lustra, chodniki, krawężniki, studzienki, hydranty, automaty, kosze, klimatyzatory, kable',
  ogrodzenia_i_mury: 'płoty, mury, bramy, furtki, słupki',
  znaki_i_szyldy: 'znaki drogowe, tablice ostrzegawcze, szyldy sklepów, naklejki, markizy, potykacze',
  dekoracje: 'donice, meble, kartony, butelki, lampiony, naczynia, drobne przedmioty',
  farma: 'narzędzia, siano, beczki, ule, kurniki, studnie, taczki, worki, wyposażenie gospodarstwa',
  pojazdy: 'rowery, skutery, samochody, ciągniki, maszyny, pociąg',
  kolej: 'tory, szlabany, przejazdy, sieć trakcyjna, znaki kolejowe',
  skaly_i_teren: 'skały, głazy, góry, kawałki terenu, drogi gruntowe, woda, kamyki',
  postacie_i_zwierzeta: 'postacie, zwierzęta, ptaki, ryby, motyle',
  efekty_i_niebo: 'chmury, efekty cząsteczkowe, niebo, mgła, promienie',
  inne: 'wszystko, co nie pasuje gdzie indziej',
};
function classify(P, rel, name) {
  const n = name.toLowerCase(), d = rel.toLowerCase().replaceAll('\\', '/'), all = n + ' ' + d;
  if (/terrain/.test(n)) return 'skaly_i_teren';
  if (/(^|[_ ])fx_|particle|godray|cloud|skydome|sky_|lakefog|post-processing|canvas|fpscontroller|weather(?!vane)|playrandomsound|changewalkingsound/.test(all)) return 'efekty_i_niebo';
  if (/human_scale/.test(n)) return 'inne';
  if (/\/characters\/|(^|_)chr_|bird|butterfly|fish|cow|sheep|pig|chicken(?!_coop)|horse(?!_jump)|dog|cat_/.test(all)) return 'postacie_i_zwierzeta';
  if (/train assets/.test(d)) return /train_japan/.test(n) ? 'pojazdy' : 'kolej';
  if (/(^|_)veh_|\/vehicles\/|bicycle|mofa|truck|ute_wreck|tractor/.test(all)) return 'pojazdy';
  if (/vege_rows|dirt_rows|\/plants\//.test(all) && !/bush_round_row/.test(n)) return /grass|flower|reeds/.test(n) ? 'roslinnosc' : 'uprawy_i_owoce';
  if (/(^|_)tree|tree0|treedead|pine|birch|beech|stump/.test(n) && !/street/.test(n)) return 'drzewa';
  if (/fence|wall|gate|pillar|entrance|poarch|cornerwall/.test(n)) return 'ogrodzenia_i_mury';
  if (/sign|board|sticker|cloth_storefront|sunscreen|warning_panel|letterbox_numbers/.test(n)) return 'znaki_i_szyldy';
  if (/bush|shrub|grass|flower(?!pot)|reed|lil+y|lilies|lillypad|plant_ground|leaves_ground|dead_leaf|dead_branch|hedge|plant_|ivy|leaves/.test(n)) return 'roslinnosc';
  if (/house_residential|farmhouse|apartment_building/.test(n)) return 'domy';
  if (/\/buildings\/|(^|_)bld_|convenience|ramenshop|restaurant|shop_building|store_rowbuilding/.test(all)) return 'budynki';
  if (/lamp|pole|trafficlight|mirror|sidewalk|curb|street|asphalt|drain|manhole|hydrant|vending|bikestand|trash|pylon|stairs|platform|cable|antenna|aircondition|fusebox|ventilation|mailbox_post|power_|road_|windfarm|windmill/.test(n)) return 'urban_ulica';
  if (/(^|_)rocks?(_|\d|$)|boulder|mountain|ground|pebble|dirt|hill|pond|puddle|(^|_)water(?!ing)|ocean|terrain|patch/.test(n)) return 'skaly_i_teren';
  if (/spinkler|sprinkler/.test(n)) return 'farma';
  if (P.id === 'polygon_farm' && /\/props\/|\/environments\/|\/generic\//.test(d)) return 'farma';
  if (P.id === 'anime_japan' || /\/props\//.test(d)) return 'dekoracje';
  return 'inne';
}

// ---------------------------------------------------------------- every prefab and every unused FBX of a pack
function sources(packDir) {
  const prefabs = [], fbx = [];
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!/^(Scenes|Editor|Scripts|Shaders|Audio|CollisionConvex|CollisionCustom)$/i.test(e.name)) walk(p); }
    else if (/\.prefab$/i.test(e.name)) prefabs.push(p); else if (/\.fbx$/i.test(e.name)) fbx.push(p); } };
  walk(packDir);
  return { prefabs, fbx };
}
const failed = [], attempt = (fn, what) => { try { return fn(); } catch (e) { failed.push(what + ': ' + e.message.split(/\r?\n/)[0]); return null; } };
const safe = s => s.replace(/\.(prefab|fbx)$/i, '').replace(/^SM_|^IL3DN_/, '').replace(/[^\w\-]+/g, '_').replace(/_+$/, '').toLowerCase();

if (!fs.existsSync(UA)) { console.error('UnityAssets/ not found.'); process.exit(1); }
const katalog = fs.existsSync(path.join(OUT, 'katalog.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'katalog.json'), 'utf8')) : { modele: {} };
for (const P of PACKS) {
  if (only.length && !only.includes(P.id)) continue;
  const packDir = path.join(UA, P.pack); if (!fs.existsSync(packDir)) { console.warn(`${P.pack}: missing, skipped`); continue; }
  const t0 = Date.now(), baker = new PackBaker({ pack: P.pack, nodeRotation: P.nodeRotation, materials: P.materials, texDir: path.join(OUT, '_tekstury', P.id), texMax: 2048 });
  const { prefabs, fbx } = sources(packDir), done = new Set(), used = new Set(), results = [];
  for (const k of Object.keys(katalog.modele)) if (katalog.modele[k].paczka === P.id) delete katalog.modele[k];
  // prefabs first (they carry the materials), then every FBX no prefab draws
  for (const pf of prefabs) {
    const rel = path.relative(packDir, pf), name = safe(path.basename(pf));
    if (done.has(name)) continue;
    const t = fs.readFileSync(pf, 'utf8'); for (const m of t.matchAll(/m_Mesh: \{fileID: -?\d+, guid: ([0-9a-f]{32})/g)) { const f = baker.guids.get(m[1]); if (f) used.add(f); }
    const r = attempt(() => baker.bake({ prefab: rel }), rel); if (!r) continue;
    done.add(name); results.push({ name, rel, r, src: 'prefab' });
  }
  for (const f of fbx) {
    const rel = path.relative(packDir, f), name = safe(path.basename(f));
    if (used.has(f) || done.has(name)) continue;
    const r = attempt(() => baker.bake({ fbx: rel }), rel); if (!r) continue;
    done.add(name); results.push({ name, rel, r, src: 'fbx' });
  }
  const textures = baker.convertTextures();
  const counts = {};
  for (const { name, rel, r } of results) {
    const cat = classify(P, rel, name), file = path.join(OUT, cat, P.id, name + '.glb');
    const res = writeGLB(file, [{ id: name, kind: cat, category: cat, ...r }], baker.materials, textures,
      { imageUri: j => path.relative(path.dirname(file), j.dst).replaceAll('\\', '/'), generator: 'Wildlands packs-extract' });
    katalog.modele[P.id + '/' + name] = { kategoria: cat, paczka: P.id, plik: path.relative(OUT, file).replaceAll('\\', '/'), wymiary_m: r.dims, trojkaty: r.tris, kb: Math.round(res.bytes / 1024), zrodlo: r.src };
    counts[cat] = (counts[cat] || 0) + 1;
  }
  console.log(`${P.pack}: ${results.length} models (${prefabs.length} prefabs, ${fbx.length} FBX), ${textures.length} textures, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  console.log('  ' + Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + v).join(', '));
}
// ---------------------------------------------------------------- the catalogue
katalog.wygenerowano = new Date().toISOString(); katalog.kategorie = CATEGORIES;
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'katalog.json'), JSON.stringify(katalog, null, 1) + '\n');
const byCat = {}; for (const [k, m] of Object.entries(katalog.modele)) (byCat[m.kategoria] ||= []).push([k, m]);
let md = `# Modele z paczek (Wildlands)\n\nWszystkie modele z czterech paczek Unity, każdy w osobnym pliku GLB (metry, oś Y w górę, podstawa modelu w punkcie 0).\n` +
  `Tekstury są wspólne, w \`_tekstury/\`. Podgląd: uruchom \`Editor.bat\` i otwórz http://localhost:5180/ModeleZPaczek/przegladarka.html\n\n` +
  `Wygenerowano: ${katalog.wygenerowano} — narzędzie: \`node tools/packs-extract.mjs\`\n\n| kategoria | modeli | co zawiera |\n|---|---|---|\n`;
for (const c of Object.keys(CATEGORIES)) md += `| ${c} | ${(byCat[c] || []).length} | ${CATEGORIES[c]} |\n`;
for (const c of Object.keys(CATEGORIES)) { const L = (byCat[c] || []).sort((a, b) => a[0].localeCompare(b[0])); if (!L.length) continue;
  md += `\n## ${c} (${L.length})\n\n| model | paczka | wymiary (m) | trójkąty |\n|---|---|---|---|\n`;
  for (const [, m] of L) md += `| [${path.basename(m.plik, '.glb')}](${m.plik}) | ${m.paczka} | ${m.wymiary_m.map(v => v.toFixed(2)).join(' × ')} | ${m.trojkaty} |\n`; }
fs.writeFileSync(path.join(OUT, 'KATALOG.md'), md);
fs.copyFileSync(path.join(ROOT, 'tools', 'packs-viewer.html'), path.join(OUT, 'przegladarka.html'));
console.log(`-> ModeleZPaczek/: ${Object.keys(katalog.modele).length} models in ${Object.keys(byCat).length} categories`);
if (failed.length) console.warn(`${failed.length} could not be read: ` + failed.join(' | '));
