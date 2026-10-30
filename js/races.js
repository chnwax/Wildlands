// The race registry: every race the board in Sakuragawa offers, the cars a player may take to it and the drivers its
// field is drawn from. A race is its stage (the map that builds it, engine.js MAPS) and a few words for the board; the
// stage itself — the route, the land, the surface, the roadside — is its config in the stage's own module, built by the
// shared stage builder (rally.js) on the same systems as every other map. Adding a race is adding its stage config
// (js/stages/) and an entry here.
export const CARS = {
  f40: { name: 'Ferrari F40 LB-Works', short: 'F40', power: '480 KM', mass: '1180 kg', drive: 'RWD · 5 biegów', top: '320 km/h', grip: { asphalt: 1, gravel: 0.45 },
    note: 'Lekka, niska, turbo V8 za plecami. Na asfalcie najszybsza, na szutrze bardzo nerwowa.' },
  i20: { name: 'Hyundai i20 WRC', short: 'i20', power: '380 KM', mass: '1230 kg', drive: '4×4 · 6 biegów', top: '200 km/h', grip: { asphalt: 0.92, gravel: 1 },
    note: 'Rajdówka z napędem na cztery koła: pewna na szutrze, zwinna w ciasnych nawrotach.' },
};

// The drivers: a pace (skill) and a way of driving — aggr: how soon they try a pass and how close they follow; line: how
// much of the road they use; def: how hard they keep a car behind from coming by; err: how often they get something
// wrong; cons: how much their pace wanders; react: their start; brk: how precisely they brake; corner: how fast they dare
// to take a bend; risk: how near the limit they drive
export const DRIVERS = [
  { name: 'Rossi', paint: '#c8102e', skill: 0.97, aggr: 0.9, line: 0.8, def: 0.6, err: 0.5, cons: 0.6, react: 0.25, brk: 0.6, corner: 0.75, risk: 0.85 },
  { name: 'Tänak', skill: 0.98, aggr: 0.6, line: 0.9, def: 0.4, err: 0.2, cons: 0.2, react: 0.2, brk: 0.85, corner: 0.6, risk: 0.5 },
  { name: 'Kowalski', paint: '#f2c200', skill: 0.92, aggr: 0.4, line: 0.5, def: 0.3, err: 0.6, cons: 0.7, react: 0.45, brk: 0.4, corner: 0.45, risk: 0.4 },
  { name: 'Neuville', tint: '#c9d8ff', skill: 0.95, aggr: 0.8, line: 0.7, def: 0.8, err: 0.4, cons: 0.4, react: 0.3, brk: 0.7, corner: 0.7, risk: 0.7 },
  { name: 'Lauda', paint: '#f2f2f2', skill: 0.95, aggr: 0.3, line: 1, def: 0.5, err: 0.1, cons: 0.1, react: 0.35, brk: 0.95, corner: 0.5, risk: 0.3 },
  { name: 'Mikkola', paint: '#0b5d3b', skill: 0.91, aggr: 0.7, line: 0.6, def: 0.9, err: 0.5, cons: 0.5, react: 0.4, brk: 0.5, corner: 0.55, risk: 0.6 },
  { name: 'Kankkunen', tint: '#ffe0b0', skill: 0.94, aggr: 0.5, line: 0.8, def: 0.6, err: 0.3, cons: 0.3, react: 0.3, brk: 0.75, corner: 0.6, risk: 0.5 },
  { name: 'Vatanen', paint: '#1f4fd1', skill: 0.96, aggr: 1, line: 0.7, def: 0.3, err: 0.8, cons: 0.8, react: 0.2, brk: 0.45, corner: 0.85, risk: 0.95 },
  { name: 'Ogier', tint: '#d8e8ff', skill: 0.97, aggr: 0.65, line: 0.85, def: 0.7, err: 0.25, cons: 0.25, react: 0.22, brk: 0.8, corner: 0.65, risk: 0.55 },
  { name: 'Sato', paint: '#ff6a00', skill: 0.93, aggr: 0.75, line: 0.65, def: 0.55, err: 0.45, cons: 0.5, react: 0.28, brk: 0.55, corner: 0.7, risk: 0.75 },
];
// the cars of a field: on gravel all of them on the rally car, on tarmac a mix (the F40 for the bold ones)
export function fieldFor(race, count = race.field) {
  const pool = [...DRIVERS]; for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool.slice(0, Math.min(count, pool.length)).map((d, k) => ({ ...d, car: race.surface === 'gravel' ? 'i20' : (k % 3 === 1 || d.risk < 0.35 ? 'i20' : 'f40') }));
}

export const RACES = [
  { id: 'valley', map: 'rally4', name: 'Valley Run', kanji: '01', surface: 'asphalt', length: 4300, field: 5, car: 'f40', hour: 15.9,
    stage: ['./stages/valley.js', 'VALLEY_STAGE'],
    blurb: 'Szybka dwupasmowa droga przez szeroką dolinę: długie proste, szybkie łuki, bariery na nasypach.', tags: ['asfalt', 'szybka', '2 pasy'] },
  { id: 'hillcrest', map: 'rally3', name: 'Hill Crest', kanji: '02', surface: 'asphalt', length: 1800, field: 4, car: 'f40', hour: 9.1,
    stage: ['./stages/hillcrest.js', 'HILL_STAGE'],
    blurb: 'Asfalt wysoko na stromym zboczu: drabina nawrotów, skalne ściany i przepaść pod barierą.', tags: ['asfalt', 'nawroty', 'przepaść'] },
  { id: 'alpine', map: 'rally2', name: 'Alpine Pass', kanji: '03', surface: 'asphalt', length: 1600, field: 4, car: 'f40', hour: 16.4,
    stage: ['./stages/alpine.js', 'ALPINE_STAGE'],
    blurb: 'Przełęcz wśród monumentalnych wapiennych skał, kamienne murki nad urwiskami.', tags: ['asfalt', 'przełęcz', 'skały'] },
  { id: 'pine', map: 'rally', name: 'Pine Forest', kanji: '04', surface: 'gravel', length: 1500, field: 4, car: 'i20', hour: 15.4,
    stage: ['./stages/pine.js', 'PINE_STAGE'],
    blurb: 'Szutrowa leśna droga przez ciemny północny bór: hopy, kompresje, kamienie i korzenie.', tags: ['szuter', 'las', 'hopy'] },
  { id: 'canyon', map: 'canyon', name: 'Canyon Ridge', kanji: '05', surface: 'asphalt', length: 4300, field: 5, car: 'f40', hour: 17.1,
    stage: ['./stages/canyon.js', 'CANYON_STAGE'], sun: 2.9, life: { flowers: false, birds: true, fireflies: 0, mist: 0.05 },
    blurb: 'Długi asfalt przez czerwone kaniony: szybkie odcinki na krawędzi, serpentyny w dół doliny, tunel w skalnej płycie.', tags: ['asfalt', 'kanion', 'tunel'] },
  { id: 'coastal', map: 'coastal', name: 'Coastal Highway', kanji: '06', surface: 'asphalt', length: 4830, field: 5, car: 'f40', hour: 11.2,
    stage: ['./stages/coastal.js', 'COASTAL_STAGE'], sun: 1.4, life: { flowers: false, birds: true, fireflies: 0, mist: 0.12 },
    blurb: 'Droga wykuta wysoko w klifach nad morzem: długie łuki, ciasne zakręty, skalne galerie i otwarte widoki.', tags: ['asfalt', 'klify', 'morze'] },
];
export const raceById = id => RACES.find(r => r.id === id) || null;
export const raceOfMap = map => RACES.find(r => r.map === map) || null;
// the stage's config (route, surface, length) for the board's preview and the preloader, without building it: the pure
// stage module (js/stages/, race.stage), the same one the preparation worker reads
export const stageModule = race => race.stage;
export async function stageConfig(race) { const [path, name] = race.stage; return (await import(path))[name]; }
// the map of a race that has no module of its own (engine.js MAPS): its meta from the entry here, built straight from its
// stage config by the shared stage builder — a new race needs its stage config and its entry, nothing more
export function raceMapModule(race) {
  return async () => { const [{ buildStage }, cfg] = await Promise.all([import('./rally.js'), stageConfig(race)]);
    const meta = { name: race.name, builder: false, startHour: race.hour, sunAzimuth: race.sun ?? 2.2, life: race.life || { flowers: false, birds: true, fireflies: 0, mist: 0.05 }, vehicle: true, car: race.car };
    return { meta, build: (progress, opts) => buildStage(progress, cfg, opts) }; };
}
