// Wildlands development server: serves the game and the world editor, and lets the editor write the world's JSON files.
//   npm run dev       game  http://localhost:5180/?map=town   editor  http://localhost:5180/editor.html?map=town
//   npm run editor    the same server, and opens the editor in the browser
// Also started inside the desktop app (electron/main.cjs: startServer).
// API (used by js/editor/io.js; local only, bound to 127.0.0.1):
//   GET  /api/ping                              -> { ok, root }
//   PUT  /api/file?path=world/...               body: file text. Written atomically; JSON is parsed first and refused
//                                               when invalid (the file on disk is never replaced by broken JSON)
//   GET  /api/events                            server-sent events: { path, hash } when a file under world/ changes on disk
//   POST /api/regenerated                       body: { files: { "world/...": text } } — the generator's output, written
//                                               by the editor (or tools/regenerate-world.mjs); only generated/ and the
//                                               libraries are accepted, never edits/
import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORLD = path.join(ROOT, 'world');
const MAIN = !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url); // (run as a program, not imported)
const args = MAIN ? process.argv.slice(2) : [];
const PORT = +(args.find(a => /^--port=/.test(a)) || '--port=5180').split('=')[1];
const OPEN = args.find(a => /^--open/.test(a));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gltf': 'model/gltf+json', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };
const hash = t => crypto.createHash('sha1').update(t).digest('hex').slice(0, 12);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// a path inside world/ (relative, forward slashes), or null
function worldPath(p) {
  if (typeof p !== 'string' || !p.startsWith('world/') || p.includes('\0')) return null;
  const abs = path.resolve(ROOT, p);
  if (!abs.startsWith(WORLD + path.sep)) return null;
  return abs;
}
function readBody(q, limit = 64 << 20) {
  return new Promise((res, rej) => { const chunks = []; let n = 0;
    q.on('data', c => { n += c.length; if (n > limit) { rej(new Error('body too large')); q.destroy(); } else chunks.push(c); });
    q.on('end', () => res(Buffer.concat(chunks).toString('utf8'))); q.on('error', rej); });
}
// recently written by us: the watcher still reports it, with the hash the editor already knows
const recent = new Map();
function writeAtomic(abs, text) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = abs + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, abs);
  recent.set(abs, hash(text));
}
const send = (r, code, obj) => { r.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); r.end(JSON.stringify(obj)); };

// ---------------------------------------------------------------- file events
const clients = new Set();
let waiters = [];
const pending = new Map();
function emit(abs) {
  let text; try { text = fs.readFileSync(abs, 'utf8'); } catch (e) { text = null; }
  const rel = path.relative(ROOT, abs).split(path.sep).join('/'), h = text === null ? null : hash(text);
  const msg = `data: ${JSON.stringify({ path: rel, hash: h, deleted: text === null })}\n\n`;
  for (const c of clients) c.write(msg);
  log('changed', rel, h || '(deleted)');
}
function watchWorld() {
  if (fs.existsSync(WORLD)) fs.watch(WORLD, { recursive: true }, (ev, name) => {
    if (!name || !/\.json$/.test(name)) return;
    const abs = path.join(WORLD, name);
    clearTimeout(pending.get(abs));
    pending.set(abs, setTimeout(() => { pending.delete(abs); emit(abs); }, 120)); // editors save in several steps
  });
  setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 20000).unref();
}

// ---------------------------------------------------------------- server
const server = http.createServer(async (q, r) => {
  const url = new URL(q.url, 'http://localhost');
  try {
    // (the game, when served by the static launcher on another port, asks whether the World Builder can be opened here)
    if (url.pathname === '/api/ping') { r.setHeader('Access-Control-Allow-Origin', '*'); return send(r, 200, { ok: true, root: ROOT, dev: true }); }
    if (url.pathname === '/api/list') { // file names in an asset folder (the editor's texture library)
      const dir = url.searchParams.get('dir') || '', abs = path.resolve(ROOT, dir);
      if (!/^assets\/[a-z0-9_/-]+$/.test(dir) || !abs.startsWith(ROOT)) return send(r, 400, { ok: false, error: 'bad dir' });
      return send(r, 200, { ok: true, files: fs.existsSync(abs) ? fs.readdirSync(abs).sort() : [] });
    }
    if (url.pathname === '/api/wait-regenerated') { // tools/regenerate-world.mjs waits here for the editor's export
      const map = url.searchParams.get('map'); waiters.push({ map, res: files => send(r, 200, { ok: true, files }) }); return;
    }
    if (url.pathname === '/api/events') {
      r.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      r.write('retry: 1000\n\n'); clients.add(r); q.on('close', () => clients.delete(r)); return;
    }
    if (url.pathname === '/api/file' && q.method === 'PUT') {
      const rel = url.searchParams.get('path'), abs = worldPath(rel);
      if (!abs || !/\.json$/.test(abs)) return send(r, 400, { ok: false, error: 'only .json files under world/ can be written' });
      if (/[\\/]generated[\\/]/.test(rel)) return send(r, 400, { ok: false, error: 'generated files are written by regeneration only' });
      const text = await readBody(q);
      try { JSON.parse(text); } catch (e) { return send(r, 400, { ok: false, error: 'refused: not valid JSON (' + e.message + ')' }); }
      writeAtomic(abs, text);
      log('saved', rel, text.length + ' bytes');
      return send(r, 200, { ok: true, path: rel, hash: hash(text) });
    }
    if (url.pathname === '/api/regenerated' && q.method === 'POST') {
      const body = JSON.parse(await readBody(q)), out = [];
      for (const [rel, text] of Object.entries(body.files || {})) {
        const abs = worldPath(rel);
        if (!abs || !/^world\/[a-z0-9_-]+\/(generated\/[a-z0-9_-]+|prefabs|materials|world)\.json$/.test(rel)) { out.push({ path: rel, error: 'not a generated file' }); continue; }
        JSON.parse(text);
        let old = null; try { old = fs.readFileSync(abs, 'utf8'); } catch (e) {}
        if (old === text) { out.push({ path: rel, unchanged: true }); continue; }
        writeAtomic(abs, text); out.push({ path: rel, written: true });
      }
      // generated files that no longer exist in the output (an area emptied out) are removed
      for (const dir of new Set(Object.keys(body.files || {}).filter(p => p.includes('/generated/')).map(p => p.slice(0, p.lastIndexOf('/'))))) {
        const absDir = worldPath(dir + '/x.json') && path.resolve(ROOT, dir);
        for (const f of fs.existsSync(absDir) ? fs.readdirSync(absDir) : []) { const rel = dir + '/' + f; if (/\.json$/.test(f) && !(rel in body.files)) { fs.rmSync(path.join(absDir, f)); out.push({ path: rel, removed: true }); } }
      }
      log('regenerated', out.filter(o => o.written || o.removed).length + ' file(s) changed');
      if (body.done) { for (const w of waiters.filter(w => w.map === body.map)) w.res(out); waiters = waiters.filter(w => w.map !== body.map); }
      return send(r, 200, { ok: true, files: out });
    }
    // static files
    let p = decodeURIComponent(url.pathname);
    if (p === '/') p = '/index.html';
    const abs = path.resolve(ROOT, '.' + p);
    if (!abs.startsWith(ROOT)) { r.writeHead(403); return r.end(); }
    fs.stat(abs, (e, st) => {
      if (e || !st.isFile()) { r.writeHead(404, { 'Content-Type': 'text/plain' }); return r.end('not found: ' + p); }
      const ext = path.extname(abs).toLowerCase(), live = /\.(js|mjs|html|json|css|md)$/.test(ext);
      // (code and world files: asked for again on every load, but answered "not modified" while unchanged — the browser
      // then keeps its compiled code cache for the scripts instead of parsing and compiling them anew)
      const tag = `"${st.size.toString(36)}-${Math.round(st.mtimeMs * 1000).toString(36)}"`;
      if (live && q.headers['if-none-match'] === tag) { r.writeHead(304, { ETag: tag, 'Cache-Control': 'no-cache' }); return r.end(); }
      r.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': live ? 'no-cache' : 'max-age=86400', ...(live ? { ETag: tag } : {}) });
      fs.createReadStream(abs).pipe(r);
    });
  } catch (e) { log('error', e.message); send(r, 500, { ok: false, error: e.message }); }
});
function openBrowser() {
  const u = `http://localhost:${PORT}/${OPEN.includes('=') ? OPEN.slice(OPEN.indexOf('=') + 1) : 'editor.html?map=town'}`;
  if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', u], { detached: true, stdio: 'ignore' });
  else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [u], { detached: true, stdio: 'ignore' });
}
if (MAIN) {
  // already running (another window): just open the editor there
  server.on('error', e => { if (e.code !== 'EADDRINUSE') throw e; log(`port ${PORT} is busy — the dev server is probably already running`); if (OPEN) openBrowser(); setTimeout(() => process.exit(0), 500); });
  server.listen(PORT, '127.0.0.1', () => {
    watchWorld();
    log(`Wildlands dev server on http://localhost:${PORT}/`);
    log(`  game    http://localhost:${PORT}/?map=town`);
    log(`  editor  http://localhost:${PORT}/editor.html?map=town`);
    if (OPEN) openBrowser();
  });
}
// The desktop app's server (electron/main.cjs): on `port`, or any free one; resolves to the port it serves on. When the
// port is taken by a Wildlands dev server already running (Editor.bat), resolves to that one instead, so the app and the
// editor share it (and the game's settings, kept per address, stay where they were).
export function startServer(port = PORT) {
  return new Promise((resolve, reject) => {
    const tryListen = p => {
      server.once('error', async e => {
        if (e.code !== 'EADDRINUSE') return reject(e);
        try { const r = await fetch(`http://127.0.0.1:${p}/api/ping`); if (r.ok && (await r.json()).dev === true) return resolve(p); } catch (err) { /* (something else holds it) */ }
        tryListen(0);
      });
      server.listen(p, '127.0.0.1', () => { watchWorld(); const a = server.address(); log(`Wildlands server on http://localhost:${a.port}/`); resolve(a.port); });
    };
    tryListen(port);
  });
}
export { server, ROOT };
