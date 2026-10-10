// npm run regenerate-world [-- town|nature] — runs the procedural generator and rewrites the generated world files
// (world/<map>/generated/*.json, prefabs.json, materials.json and the index). Edit files (world/<map>/edits/) are never
// touched: manual edits survive and are applied on top of the new generator output (objects are matched by id, and
// by their recorded "origin" if the generator moved or renumbered them).
// The generator is the game's own world-building code, which needs WebGL: the editor page is opened in a headless
// Chrome (or Edge) with ?regenerate=1; it builds the map, writes the files through the dev server and reports back.
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { spawn } from 'child_process';

const PORT = +(process.env.PORT || 5180), maps = process.argv[2] ? [process.argv[2]] : ['town', 'nature'];
const BROWSERS = [process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
const browser = BROWSERS.find(p => fs.existsSync(p));
if (!browser) { console.error('No Chrome / Edge found. Set CHROME=<path to chrome> and run again, or open http://localhost:' + PORT + '/editor.html?map=town&regenerate=1 by hand.'); process.exit(2); }
const get = (p, timeout = 0) => new Promise((res, rej) => { const q = http.get({ host: '127.0.0.1', port: PORT, path: p, timeout }, r => { let t = ''; r.on('data', c => t += c); r.on('end', () => { try { res(JSON.parse(t)); } catch (e) { res({ raw: t }); } }); }); q.on('error', rej); q.on('timeout', () => q.destroy(new Error('timeout'))); });

let ownServer = null;
try { await get('/api/ping', 1500); } catch (e) {
  console.log('starting the dev server…');
  ownServer = spawn(process.execPath, [path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), 'devserver.mjs'), '--port=' + PORT], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { await new Promise(r => setTimeout(r, 200)); try { await get('/api/ping', 500); break; } catch (x) {} }
}
let failed = false;
for (const map of maps) {
  const t0 = Date.now(), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-regen-'));
  console.log(`regenerating ${map}…`);
  const wait = get('/api/wait-regenerated?map=' + map);
  const b = spawn(browser, ['--headless=new', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--force_high_performance_gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-timer-throttling', '--user-data-dir=' + profile, `http://localhost:${PORT}/editor.html?map=${map}&regenerate=1`], { stdio: 'ignore' });
  const timer = setTimeout(() => { console.error(`  ${map}: timed out after 6 minutes`); b.kill(); }, 360000);
  try {
    const r = await wait, changed = (r.files || []).filter(f => f.written || f.removed);
    console.log(`  ${map}: ${(r.files || []).length} files, ${changed.length} changed (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    for (const f of changed) console.log(`    ${f.removed ? 'removed' : 'wrote  '} ${f.path}`);
  } catch (e) { console.error(`  ${map}: failed — ${e.message}`); failed = true; }
  clearTimeout(timer); b.kill();
  setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} }, 1500);
}
if (ownServer) ownServer.kill();
console.log(failed ? 'regeneration failed' : 'done — edit files were not touched; run npm run validate-world to check them against the new generator output');
process.exit(failed ? 1 : 0);
