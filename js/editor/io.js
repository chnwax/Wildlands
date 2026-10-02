// Editor <-> dev server: reading and writing world files, the generator export, and live notifications when a world
// file changes on disk (edited by hand or by an AI). The dev server (tools/devserver.mjs) is the only writer.
export const io = {
  dev: false, textures: [], onFileChanged: null, lastSaved: new Map(), // path -> hash of what this editor last wrote
  async init() {
    try { const r = await fetch('/api/ping', { cache: 'no-store' }); this.dev = r.ok && (await r.json()).dev === true; } catch (e) { this.dev = false; }
    if (!this.dev) return false;
    try { const r = await fetch('/api/list?dir=assets/tex'); const j = await r.json(); this.textures = (j.files || []).filter(f => /_diff_\d+k\.jpg$/.test(f)).map(f => 'tex/' + f); } catch (e) {}
    this.listen();
    return true;
  },
  listen() {
    const es = new EventSource('/api/events');
    es.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (x) { return; } if (this.lastSaved.get(m.path) === m.hash) return; this.onFileChanged && this.onFileChanged(m); };
    es.onerror = () => { this.onConnection && this.onConnection(false); };
    es.onopen = () => { this.onConnection && this.onConnection(true); };
    this.es = es;
  },
  async read(path) { const r = await fetch(path + '?t=' + Date.now(), { cache: 'no-store' }); if (!r.ok) throw new Error(path + ': ' + r.status); return r.text(); },
  // write one world file; resolves to { ok, hash } or throws with the server's reason
  async write(path, text) {
    const r = await fetch('/api/file?path=' + encodeURIComponent(path), { method: 'PUT', body: text });
    const j = await r.json().catch(() => ({ ok: false, error: 'bad response ' + r.status }));
    if (!j.ok) throw new Error(j.error || 'save failed');
    this.lastSaved.set(path, j.hash);
    return j;
  },
  async writeGenerated(files) {
    for (const [p, t] of Object.entries(files)) this.lastSaved.set(p, await hashText(t));
    const r = await fetch('/api/regenerated', { method: 'POST', body: JSON.stringify({ files }) });
    return r.json();
  },
};
// same short hash as the dev server (sha1, 12 hex) — computed in the browser for change detection
export async function hashText(t) {
  const b = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('').slice(0, 12);
}
