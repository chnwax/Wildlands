# Wildlands world format

Everything placed in the world — buildings, benches, lamps, fences, rocks, trees, props — is described in plain JSON
files under `world/`. The game loads them at runtime, the world editor loads and saves them, and you (or an AI) can
read and change them with any text editor. This document is all you need to edit the world without reading the code.

```
world/
  schema/world.schema.json      JSON Schema of every file below
  town/                         one folder per map: town (Sakuragawa), nature (Wildlands)
    world.json                  index: which files exist, which edit files the game loads
    prefabs.json                prefab library: every object type you can place          (generated)
    materials.json              material library: every material name, textures          (generated)
    generated/<area>.json       every object the generator places, one file per area     (generated)
    generated/fields.json       dense vegetation (forests, hedgerows) summarised          (generated)
    edits/<area>.json           YOUR CHANGES: moved / recoloured / deleted / added objects
    edits/materials.json        YOUR CHANGES to shared library materials
```

## The two layers

The world is procedural: the generator (the game's code) builds it the same way every time and gives every object a
stable id. The files in `generated/` are a readable copy of what it places. **Never edit them** — they are rewritten on
regeneration.

All manual changes live in `edits/`. An edit file lists objects; each entry either **changes a generated object**
(found by its id) or **adds a new object**. When the world is regenerated, edits are re-applied on top of the new
generator output, so they are never lost.

## Coordinates and units

- Metres. `y` is up. `position` is the point the object stands on (its foot), in world space.
- `rotation` is in **degrees**, Euler angles applied X, then Y, then Z (three.js `XYZ`). Most objects only use Y:
  `[0, 90, 0]` turns the object a quarter turn counter-clockwise seen from above.
- `scale` multiplies the object's size per axis in its own frame: `[2, 1, 1]` stretches it to twice its width.
- Ground height: the editor's "Drop to ground" (End) puts an object's foot on the surface. By hand, copy the `y` of a
  nearby generated object.

## Ids

Generated objects: `<prefab>_<area>_<nnn>`, numbered in generation order within prefab and area, e.g.
`house_newtown_006`, `bench_river_001`, `street_lamp_danchi_005`, `tree_sakura_river_013`. Areas never contain `_`.

- town areas: `danchi` (apartment district), `river`, `shrine`, `school`, `station`, `oldtown`, `midtown`, `newtown`,
  `farmland`, `paddies`, `hills`
- nature areas: `lakeshore`, `valley`, `mountains`

New objects may use any unique id of lowercase letters, digits, `_` and `-` (the editor uses `<prefab>_new_<nnn>`).
An id appears in one file only.

To find an object: search `generated/*.json` for its prefab, name or position — one object per line.

## Object fields

| field | meaning |
|---|---|
| `id` | required, stable id |
| `name` | display name |
| `prefab` | object type, a name from `prefabs.json` (required for new objects unless `source` is given) |
| `source` | new objects: copy the look of this existing object (generated or added) |
| `position` | `[x, y, z]` metres |
| `rotation` | `[x, y, z]` degrees |
| `scale` | `[x, y, z]`, never 0 |
| `material` | library material of the object's **main slot** (see Materials) |
| `materialOverrides` | values for the main slot of **this object only** |
| `slots` | per-slot overrides: `{ "<slot material name>": { ...override } }` |
| `group` | group id; objects with the same group are selected and moved together (`""` takes a generated object out of its group) |
| `tags` | list of strings |
| `hidden` | `true`: not drawn and not solid, in the game too |
| `locked` | `true`: cannot be selected in the editor viewport (editor only) |
| `deleted` | `true`: removes a generated object |
| `origin` | where the generator placed this object; written by the editor so the edit still finds its object if ids shift |

In an edit of a **generated** object list only what changes; every field you leave out keeps its generated value.
A **new** object needs at least `id`, `prefab` (or `source`) and `position`.

## Edit file

```json
{
  "format": "wildlands-world/1",
  "kind": "edits",
  "map": "town",
  "area": "danchi",
  "objects": [
    {
      "id": "street_lamp_danchi_005",
      "position": [491.8, 6, 143.2],
      "materialOverrides": { "color": "#27ae60" },
      "slots": { "lamp": { "color": "#ff5a3c" } },
      "origin": [488.8, 6, 143.2]
    },
    {
      "id": "bench_danchi_002",
      "deleted": true
    },
    {
      "id": "vending_machine_new_001",
      "name": "Vending machine by the car park",
      "prefab": "vending_machine",
      "position": [494, 6, 140],
      "rotation": [0, 30, 0]
    },
    {
      "id": "box_new_001",
      "prefab": "box",
      "position": [496, 6, 138],
      "scale": [1.2, 0.8, 1.2],
      "materialOverrides": { "color": "#d63031" }
    }
  ]
}
```

**Every edit file must be listed in `world.json` → `"edits"`**, or the game does not load it:

```json
"edits": ["edits/danchi.json", "edits/river.json"]
```

The file name is free; the editor uses the area of the object (`edits/<area>.json`).

### Common tasks

- **Move / turn / resize**: add `{ "id": "...", "position": [...] }` (and/or `rotation`, `scale`).
- **Delete**: `{ "id": "...", "deleted": true }`. Restore by removing the entry.
- **Add an object**: new id + `prefab` + `position`. The new object looks like the prefab's `template` object
  (`prefabs.json`) at its natural size. To copy a particular object instead, give `"source": "<its id>"`.
- **Add a basic shape**: prefabs `box`, `cylinder`, `sphere`, `cone`, `plane`, `ramp` — 1 m in size, standing on
  `position`; set the size with `scale` and the look with `material` / `materialOverrides`.
- **Duplicate**: new id, `"source": "<original id>"`, same `prefab`, a new `position`.

## Materials

Objects are built from several materials (**slots**), named by the library material they use — a house has
`siding` walls, `rooftile`, `window`, `concrete`... The **main slot** is the first one (usually the walls) and is the
object's `material` in `generated/`. Every slot name is a material in `materials.json`.

Override values (all optional):

| key | value |
|---|---|
| `color` | `"#rrggbb"` — the slot takes this exact colour, keeping its shading detail |
| `roughness`, `metalness`, `opacity` | 0 … 1 |
| `emissive` | `"#rrggbb"` glow colour; `emissiveIntensity` 0 … 100 |
| `texture` | a path from `materials.json` → `"textures"` (e.g. `"tex/japanese_stone_wall_diff_1k.jpg"`), or `null` |
| `material` | (in `slots`, or the object's `material` for the main slot) use another library material for that slot |

**This object only** — never affects other objects:

```json
{ "id": "house_newtown_006", "materialOverrides": { "color": "#c0392b" } }
{ "id": "house_newtown_007", "material": "plaster", "slots": { "rooftile": { "color": "#2d6a4f" } } }
```

Recolouring a lamp's light: override its `lamp` slot (`color` or `emissive`) — the light it casts at night takes that
colour.

**Elements and pieces** — one part of an object on its own. A `slots` entry may also move, turn, scale or hide
that slot's parts (an **element**: all the roof, all the windows), or one connected **piece** of them, keyed
`"<slot>#<n>"` (the n-th piece, counted from 0: one wall panel, one window frame, one sign plate). The editor picks
pieces with Alt+click. Element keys (all optional): `offset` `[x, y, z]` metres and `rotate` `[x, y, z]` degrees in
the object's own axes, about the element's centre; `scale` `[x, y, z]`; `hidden` true/false. They combine with the
material keys:

```json
{ "id": "house_newtown_008", "slots": { "rooftile": { "offset": [0, 0.5, 0] }, "wood#0": { "hidden": true }, "window#3": { "color": "#3a6ea5" } } }
```

**Shared material** — changes every object using it. Only in `edits/materials.json` (listed in `world.json` as
`"materialEdits": "edits/materials.json"`):

```json
{
  "format": "wildlands-world/1",
  "kind": "materials",
  "map": "town",
  "materials": {
    "rooftile": { "color": "#7a3b2e" }
  }
}
```

## Dense vegetation (fields)

Forests, forest floor, bamboo groves, hedgerows and weeds are hundreds of thousands of plants, so `generated/` does not
list them one by one; `generated/fields.json` gives each field's prefab, count per area and an example id. Every plant
still has an id `<prefab>_<area>_<nnn>` (numbered 1 … count per area) and can be moved, recoloured or deleted in an edit
file like any other object.

## What is not an object

Terrain, roads and their markings, the railway, the river banks, bridges and ground paint are generated from the
layout and cannot be edited here. Moving an object does not move the paved ground or crops under it. Parked cars,
trains, traffic and pedestrians are simulation, not world objects.

## Checking and regenerating

```bash
npm run validate-world          # every file: syntax, fields, names, ids — readable errors, exit code 1 on error
npm run regenerate-world        # rebuild generated/ and the libraries from the generator (edits untouched)
npm run editor                  # the world editor (or double-click Editor.bat); saves into edits/
npm run dev                     # game http://localhost:5180/?map=town, editor /editor.html?map=town
```

Errors name the file, the object id, the field and the problem, and suggest the closest valid name for a typo:

```
ERROR  world/town/edits/danchi.json  ·  box_new_001  ·  prefab
    unknown prefab "bocks" — did you mean "box"?
```

The game and the editor show the same messages on screen and skip only the invalid entries. The editor never
overwrites a file that has errors; fix it by hand and it reloads automatically (the editor watches `world/` and picks
up every change made on disk, keeping the camera where it is).

If the generator changes and an id now names a different object, an edit that has `origin` is re-attached to the
object of the same prefab standing at that origin (the editor then saves it under the new id).
