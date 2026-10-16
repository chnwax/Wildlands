# Wildlands — performance pass, Quality Extreme

Target machine: Ryzen 7 7800X3D, RTX 5070, 1920×1080 at 280 Hz. Browser: Chrome, WebGL 2 through ANGLE on Direct3D 11.
Quality Extreme renders at pixel ratio 1.5 (2880×1620 internally at 1080p), 8× MSAA plus TAA, GTAO ambient occlusion,
four 4096² shadow cascades, planar water reflections, bloom and sun shafts. None of these settings were lowered.

## How it is measured

**In-game overlay (F3).** `js/perf.js` shows the FPS, the average and worst frame time of the last second, the 1% low,
CPU time against GPU time (GPU timer queries), and draw calls, triangles, geometries, textures and shader programs. It
also breaks the frame down per system: CPU and GPU time, draws and triangles for every pass (scene, shadow maps, water
reflection, AO, TAA, sun rays, bloom, output) and CPU time for every world system. It also counts every shader compile
and every upload to the GPU, so a hitch can be traced to its cause.

**Harness.** Chrome is driven by Playwright and the player is placed on fixed test points. The per-frame records from
`perf.js` are collected. It runs in two modes:

* **Headless, uncapped (vsync off).** Gives stable GPU timings for A/B tests, and is the mode the original was measured
  in. Uncapped headless Chrome paces frames unevenly on its own: frame times alternate 6–16 ms even when the GPU is idle.
  Its 1% lows therefore say little about the game.
* **Headed with vsync on the 280 Hz display.** This is what the player sees. Frame times fall on 3.57 ms steps, so
  1% low ≥ 55 FPS means no more than 1% of frames take longer than five refreshes (17.9 ms).

**Test points.**

| Point | Description |
|---|---|
| A | apartment district, player height (440, 60) |
| B | park: lake and pier (482, 40) |
| B2 | fountain (578, 152) |
| C | football pitch (567, 49) |
| D | aerial overview, 95 m up (300, −70) |
| E | walking and sprinting through the district (physics walk, physics sprint, and a fixed-path sprint glide) |
| F | fast 360° turns: 12.5 rad/s, reversing every 1.2 s |
| G | first walk into areas not seen before, from a cold start (70 s) |

## BEFORE — original (commit cf8f256), headless

| Test point | avg FPS | 1% low (FPS) | worst frame (ms) | frames > 33 ms | draw calls | triangles (M) | CPU (ms) | GPU (ms) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| A apartments still | 39.3 | 29.3 | 63.7 | 2 | 4436 | 69.7 | 25.22 | 25.35 |
| B lake park still | 37.9 | 19.2 | 52.5 | 62 | 5547 | 81.44 | 26.19 | 26.3 |
| B2 fountain still | 40.9 | 24 | 42.1 | 68 | 5611 | 75.13 | 24.36 | 24.42 |
| C pitch still | 37.8 | 20.8 | 56.6 | 60 | 5137 | 78.54 | 26.09 | 26.25 |
| D aerial still | 37.1 | 18.6 | 54.2 | 62 | 5896 | 65.16 | 26.79 | 26.89 |
| E walk (physics) | 43.5 | 24.4 | 63.8 | 140 | 4739 | 71.39 | 22.82 | 22.96 |
| E sprint (physics) | 43.8 | 27 | 77.6 | 37 | 6276 | 73.86 | 22.62 | 22.78 |
| E sprint glide | 44.1 | 24.2 | 102.7 | 216 | 4632 | 70.59 | 22.5 | 22.61 |
| F 360 turns | 40.8 | 21.2 | 64.5 | 32 | 5925 | 76.28 | 24.38 | 24.42 |
| F 360 turns park | 37.7 | 20.1 | 61.3 | 46 | 5973 | 79.73 | 26.31 | 26.41 |
| G first-seen glide | 38.7 | 10.9 | 232.8 | 696 | 6204 | 81.48 | 25.62 | 25.8 |

Half-resolution test (CPU- or GPU-bound): halving the resolution raised FPS by only 18–35%. The original was bound by
geometry and draw calls, and by the CPU and GPU-process work for 4,400–6,300 draws per frame, not by fill rate.

| Test point | full res FPS | half res FPS | gain |
|---|---:|---:|---:|
| A apartments still | 39.3 | 53 | 35% |
| B lake park still | 37.9 | 46.7 | 23% |
| B2 fountain still | 40.9 | 48.3 | 18% |
| C pitch still | 37.8 | 47.9 | 27% |
| D aerial still | 37.1 | 47.6 | 28% |

## What was done (by system)

Every change below was verified on images: the same frame was rendered twice in one session with the change off and on
(world paused, fixed time, TAA off) and compared pixel by pixel. Unless stated, the result was identical (max difference
≤ 1/255) or differed only in a handful of pixels.

**Hitches.**
- Every shader variant is compiled during loading. This includes the extra variants ANGLE builds per render target and
  per depth/stencil state, which are forced with a hidden warm-up render.
- Programs no longer re-link on the first night or when the light setup changes.
- The PMREM environment is regenerated in place.
- No allocations in the per-frame paths: traffic, roads, crowd and deco code reuse objects, so there are no GC pauses.
- Texture uploads happen at load time.
- A window resize used to rebuild the whole post chain and recompile 12 shaders (a 60–130 ms freeze). It now only
  resizes the render targets.
- First-seen glide: worst frame 233 ms → 24 ms; frames over 33 ms 696 → 0 (headless).

**Shadows (5 ms → 1.5–1.9 ms GPU).**
- Each cascade keeps its static casters in a cached map. The map is rebuilt only when the cascade has to move, and the
  rebuild is spread over several frames. Each frame copies that map and draws only what moves (cars, people, trains,
  booms, and swaying trees in the two near cascades).
- Per-instance culling for those per-frame casters. three culls a whole instanced set by its bounds, so of ~8.5M shadow
  triangles drawn each frame, ~7M lay outside the near cascades. Those instances are now copied into compact stand-in
  sets.
- Far cars cast through cheap shells.
- The two far cascades never redraw their moving casters in the same frame.
- When turning, a cascade is re-aimed only after the view has turned more than 25° away from it.

**Scene (14–16 ms → 8.6–10.2 ms GPU).**
- Vegetation, rocks and props are instanced through `Scatter` (compact per-cell instance lists with level-of-detail
  hysteresis) and through the props system.
- Static geometry is merged in larger buckets. Car parts, bicycles, signs, vending machines and curve mirrors are
  instanced.
- Instanced geometry built without an index is now indexed by merging only bit-identical vertices. The same triangles in
  the same order, but 4.2× fewer vertex-shader runs on leaf cards, crowns and props.
- **Draw order:** solid surfaces, then alpha-tested foliage, then grass, then terrain (with a strict depth test). The
  layered terrain shader is now rejected wherever something stands on it. Measured 0.7–1 ms where the ground is covered.
  Side effect: the painted stop legends on the road, which lost the depth tie to the asphalt in the original, are now
  visible as intended.
- **Grass:** each blade's static data is baked into textures once per chunk placement. That data is ground height and
  normal, masks, noise, density, species and base colour, previously about 20 texture reads plus most of the shader logic,
  repeated for every vertex of every blade. A vertex now reads four texels. The card rings are 1.0–1.1 ms faster; looking
  down at a meadow the blade rings are 0.65 ms faster. Neighbouring height samples are also shared (12 reads instead of 20).
- Terrain shader: material layers that contribute nothing to a pixel are skipped.
- Transparent double-sided flat meshes (carport roofs, signs) are drawn in one pass instead of two. One pass gives the
  same image for a flat mesh, and it saves ~90 shader-program lookups per frame.

**Post-processing.**
- **AO:** GTAO and its denoiser run at half resolution, with a joint bilateral upsample: 2.8–3.4 ms → 0.8–0.9 ms.
  - The position of each AO texel is rebuilt at the centre of the depth texel actually read. Without that, distant hills
    and walls were 3× too occluded. Distant AO now matches the original within 0.3/255.
  - The AO is accumulated over time (reprojected history, rejected on a depth mismatch). It now shimmers less than the
    original full-resolution AO did (see below).
- **Sun rays:** quarter resolution, 1.4–2.0 ms → 0.35 ms, at most 4/255 different. Skipped when the sun is not visible.

**Water reflection.** The reflection is cropped to the screen area of visible water and gated by occlusion queries. It is
skipped while no water is visible.

**CPU.**
- Opaque sort keys are cached per material.
- No per-frame allocations.
- Moving cars upload only their own range of instance data.
- No program re-resolution churn.

**Bugs found along the way.**
- The grass card shader bound 17 samplers on a 16-unit GPU, so its shadow-map array never bound. The two city-light data
  textures are now packed into one, so every material uses 16 samplers or fewer.
- A multiple-render-target pass on this D3D11 path silently lost writes. The grass bake therefore uses one target per pass.

## Where the GPU time goes (headless, ms per frame)

| Pass (GPU ms) | A before | A after | B before | B after | D before | D after |
|---|---:|---:|---:|---:|---:|---:|
| scene | 13.99 | 8.6 | 15.29 | 10.21 | 16.25 | 10.1 |
| shadow maps | 5.16 | 1.9 | 4.97 | 1.76 | 4.23 | 1.51 |
| water reflection | 0.85 | 0.83 | 2.59 | 1.85 | 2.01 | 1.55 |
| ambient occlusion | 3.37 | 0.91 | 2.82 | 0.82 | 1.84 | 0.55 |
| temporal AA | 0.27 | 0.25 | 0.26 | 0.25 | 0.27 | 0.25 |
| sun rays | 1.37 | 0.34 | 0.06 | - | 1.95 | 0.36 |
| bloom | 0.22 | 0.17 | 0.18 | 0.17 | 0.22 | 0.17 |

## AFTER — same harness, headless (compare with BEFORE)

| Test point | avg FPS | 1% low (FPS) | worst frame (ms) | frames > 33 ms | draw calls | triangles (M) | CPU (ms) | GPU (ms) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| A apartments still | 76.8 | 44.8 | 23.8 | 0 | 1834 | 25.98 | 12.86 | 12.91 |
| B lake park still | 65.5 | 45.7 | 23.4 | 0 | 2551 | 32.75 | 15.1 | 15.18 |
| B2 fountain still | 64.1 | 41.3 | 26.6 | 0 | 2785 | 33.18 | 15.48 | 15.47 |
| C pitch still | 83.3 | 61 | 18.5 | 0 | 1900 | 24.47 | 11.87 | 11.97 |
| D aerial still | 67.6 | 45.5 | 22.4 | 0 | 2563 | 22.73 | 14.62 | 14.61 |
| E walk (physics) | 73.6 | 45 | 27.2 | 0 | 1800 | 24.99 | 13.4 | 13.4 |
| E sprint (physics) | 73.8 | 41 | 86.4 | 3 | 2516 | 27.88 | 13.35 | 14.2 |
| E sprint glide | 79.5 | 46.5 | 33.6 | 1 | 1828 | 24.5 | 12.4 | 12.73 |
| F 360 turns | 64.3 | 24.9 | 119 | 9 | 2814 | 35.3 | 15.28 | 15.42 |
| F 360 turns park | 61.8 | 25.4 | 45.6 | 15 | 3074 | 37.67 | 16.01 | 15.86 |
| G first-seen glide | 80.5 | 47.4 | 23.6 | 0 | 2173 | 25.98 | 12.27 | 12.32 |

## AFTER — headed, vsync on the 280 Hz display (what the player sees)

| Test point | avg FPS | 1% low (FPS) | worst frame (ms) | frames > 33 ms | draw calls | triangles (M) | CPU (ms) | GPU (ms) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| A apartments still | 81.3 | 69.4 | 14.4 | 0 | 1867 | 26.64 | 7.55 | 12.21 |
| B lake park still | 67.3 | 55.9 | 18 | 0 | 2628 | 33.64 | 8.73 | 14.78 |
| B2 fountain still | 65.7 | 54.1 | 103.6 | 2 | 2834 | 33.64 | 9.37 | 15.06 |
| C pitch still | 82.6 | 69.4 | 48.8 | 1 | 1963 | 25.38 | 7.39 | 12.06 |
| D aerial still | 70.6 | 55.9 | 18 | 0 | 2597 | 23.23 | 9.09 | 14.1 |
| E walk (physics) | 80.6 | 69.4 | 14.5 | 0 | 1832 | 25.42 | 7.52 | 12.32 |
| E sprint (physics) | 75.7 | 54.9 | 80.1 | 6 | 2559 | 28.36 | 9.55 | 13.09 |
| E sprint glide | 82.5 | 69.4 | 84.7 | 5 | 1869 | 24.94 | 7.44 | 12.02 |
| F 360 turns | 69.8 | 55.6 | 23.1 | 0 | 3100 | 37.52 | 10.77 | 14.29 |
| F 360 turns park | 58.7 | 17 | 109.1 | 7 | 3352 | 40.02 | 12.91 | 16.75 |
| G first-seen glide | 78.9 | 69 | 77.1 | 4 | 1869 | 24.76 | 7.77 | 12.54 |

Half-resolution test now:

| Test point | full res FPS | half res FPS | gain |
|---|---:|---:|---:|
| A apartments still | 81.3 | 97.5 | 20% |
| B lake park still | 67.3 | 77.3 | 15% |
| B2 fountain still | 65.7 | 78.1 | 19% |
| C pitch still | 82.6 | 98.9 | 20% |
| D aerial still | 70.6 | 83.6 | 18% |

## Quality check

**Fixed-camera screenshots.** Shots: apartments at player height, lake park, fountain, pitch, aerial, evening, night,
night fountain, town spawn, mid trees, street with cars, aerial evening, lake, lake evening, close trees. They were taken
from the original and from the current build at the same pose, hour and wind/cloud time, with TAA converged.

- Every pair matches to the level of two sessions of the same build: cars and people are elsewhere, and the TAA jitter
  phase differs. Mean brightness is identical to within 0.1/255 on every shot.
- The aerial view was the one real regression found this way: distant AO was too dark. It is fixed (see AO above), and
  every region now matches the original within 0.3/255.

**Temporal stability.** Measured with a still camera and running TAA, as per-pixel luminance standard deviation over 24
frames at the park view:

| Build | mean std | pixels > 4 levels |
|---|---:|---:|
| original | 0.298 | 0.42% |
| before the AO accumulation | 0.344 | 0.69% |
| now | 0.262 | 0.38% |

What remains is thin, high-contrast distant detail (fences, poles, conifer tips) that TAA cannot fully hold. It was the
same in the original.

**Cars.** They used to turn in steps, because the heading was constant along each 1 m segment of a route. Heading and
lane offset are now interpolated along the route, corners use finer fillets, and the front wheels steer with the path
curvature. The maximum heading change is 1.3° per frame (previously up to ~13° steps).

## Acceptance status (headed, vsync)

- **60 FPS average:** met at every point except fast turns in the park (58.7).
- **1% low ≥ 55:**
  - Met: apartments, lake park, pitch, aerial, walk, glide, turns, first-seen (55.6–69.4).
  - Borderline: fountain 54.1, physics sprint 54.9.
  - Not met: fast park turns (17).
- **No frame over 33 ms while moving:**
  - In headless runs, met everywhere except the turn tests.
  - In headed runs, 4–6 frames per run in sprint/glide/first-seen. Those frames do normal work (CPU 12–17 ms,
    GPU 12–19 ms); traces show the extra time in DXGI Present / DirectComposition (desktop compositor). The same stalls
    happen with an idle GPU (looking at the sky), and a traced sprint run had none.
- **Not done (deferred on request):** making the shadow-cascade refresh cheaper during very fast turns and sprinting.
  This is what the remaining turn spikes come from.

## Objects stay individually editable

Every object keeps a stable identity, its own transform and its own colours, even when it is drawn instanced, merged
into a cell or culled per instance:

- `Scatter.locate(i)` and `Scatter.setItemMatrix(i, m)` for vegetation, rocks and scanned props.
- `addProp` returns an id; `setPropMatrix(id, part, m)` moves a prop.
- `fleet.cars[id]` holds each car's type, transform and colours.
- Shadow stand-ins and baked grass data are derived from the source sets and rebuilt when those change.
