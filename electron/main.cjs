// Wildlands as a desktop app (Electron): the game in a window of its own instead of a browser tab.
//   npm start            (or Wildlands-App.bat)
// The window loads the game from the same small server the World Builder uses (tools/devserver.mjs, started here on
// port 5180, or any free one; when Editor.bat already runs it, that one is shared), so the title screen, the game and
// the editor work exactly as in the browser, saving included.
// Why a window of its own: the town is built and its shaders compiled in one long stretch at load, and in a browser
// that work shares the GPU process with every other tab (the browser itself stalled while the shaders compiled); here
// it has its own, with a larger script heap (the build peaks near the browser's 4 GB limit), no background throttling
// and the high-performance GPU. The compiled shaders are kept in the app's own cache, so later starts are quicker.
// Keys: F11 full screen, F5 reload, F12 developer tools.
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=8192');

if (!app.requestSingleInstanceLock()) app.quit();
let win = null, base = '';

async function open() {
  const { startServer } = await import(pathToFileURL(path.join(__dirname, '..', 'tools', 'devserver.mjs')).href);
  const port = await startServer(5180);
  base = `http://localhost:${port}/`;
  Menu.setApplicationMenu(null); // (no menu bar: the game and the editor use Alt and the Ctrl shortcuts themselves)
  win = new BrowserWindow({ width: 1600, height: 900, minWidth: 960, minHeight: 540, show: false, backgroundColor: '#0d1117', title: 'Wildlands',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, spellcheck: false, v8CacheOptions: 'bypassHeatCheck' } });
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  const wc = win.webContents;
  wc.on('before-input-event', (e, k) => {
    if (k.type !== 'keyDown') return;
    if (k.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    else if (k.key === 'F5') { wc.reloadIgnoringCache(); e.preventDefault(); }
    else if (k.key === 'F12') { wc.toggleDevTools(); e.preventDefault(); }
  });
  // the game's own pages stay in the window; anything else opens in the browser
  const own = url => url.startsWith(base);
  wc.setWindowOpenHandler(({ url }) => { if (own(url)) return { action: 'allow' }; if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  wc.on('will-navigate', (e, url) => { if (!own(url)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  wc.on('render-process-gone', (e, d) => { if (d.reason !== 'clean-exit' && !win.isDestroyed()) wc.loadURL(base); });
  win.on('page-title-updated', (e, t) => { if (!t) e.preventDefault(); });
  await win.loadURL(base);
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(open).catch(e => { console.error(e); app.quit(); });
app.on('window-all-closed', () => app.quit());
