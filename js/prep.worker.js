// The stage preparation worker: a race map's heavy, pure data — the road's line, the distance field round it, the graded
// ground's 1025² heights and the masks of what grows where (stagedata.js) — computed off the main thread while the player
// is still in Sakuragawa, and handed over as transferable arrays (preload.js keeps them for the build: rally.js).
import { prepareSync } from './stagedata.js';

onmessage = async e => {
  const { id, path, name } = e.data;
  try {
    const cfg = (await import(path))[name], t0 = performance.now(), d = prepareSync(cfg), ms = performance.now() - t0;
    postMessage({ id, ok: true, d, ms }, [d.DIST.buffer, d.NEAR.buffer, d.H.buffer, d.FOREST.buffer, d.MOIST.buffer, d.mask.buffer, d.mask2.buffer]);
  } catch (err) { postMessage({ id, ok: false, error: String(err && err.stack || err) }); }
};
