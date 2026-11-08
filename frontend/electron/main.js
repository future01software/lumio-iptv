const { app, BrowserWindow, ipcMain, safeStorage, screen, dialog, net, Notification, Menu } = require('electron');
const serve = require('./serve-static');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

// Keep user data (profiles, settings, HTTP/image cache, playlist cache) in
// %APPDATA%\Lumio IPTV. It used to live under %TEMP%, which Disk Cleanup and
// similar tools wipe, so on first run we carry the old folder over.
const legacyUserData = path.join(app.getPath('temp'), 'iptv-player-data');
const userDataDir = path.join(app.getPath('appData'), 'Lumio IPTV');
if (!fs.existsSync(userDataDir) && fs.existsSync(legacyUserData)) {
  try {
    fs.cpSync(legacyUserData, userDataDir, { recursive: true });
  } catch (err) {
    console.warn('Could not migrate legacy user data:', err);
  }
}
app.setPath('userData', userDataDir);
// Windows only shows toast notifications for an app with an AppUserModelID
// (the installer's shortcut registers this same id). Packaged builds only: a dev
// run (electron.exe) under this id makes Windows cache Electron's icon for it.
if (process.platform === 'win32' && app.isPackaged) app.setAppUserModelId('com.iptvplayer.desktop');

// A second instance would fight over the same cache folder ("Unable to move
// the cache"), so focus the existing window instead.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}
app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

// Dev-only: LUMIO_DEBUG=1 exposes Chrome DevTools Protocol on localhost:9222
// and mirrors renderer warnings/errors to stdout.
// Never in installed builds: an open DevTools port lets any local process drive the app.
const DEBUG = process.env.LUMIO_DEBUG === '1' && !app.isPackaged;
if (DEBUG) app.commandLine.appendSwitch('remote-debugging-port', '9222');

// Many IPTV panels and logo hosts serve broken/self-signed certificates, so the
// window accepts those - but only for content it loads itself (streams, logos),
// never for hosts where a forged certificate would matter. TLS checking used to
// be switched off app-wide (ignore-certificate-errors), which also covered the
// main process's update download. net.fetch in main never reaches this handler,
// so the updater always verifies certificates.
const STRICT_TLS_HOSTS = ['github.com', 'githubusercontent.com', 'themoviedb.org', 'tmdb.org'];
function isStrictTlsHost(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return STRICT_TLS_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return true;
  }
}
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  if (isStrictTlsHost(url)) {
    callback(false);
    return;
  }
  event.preventDefault();
  callback(true);
});

const loadURL = serve({ directory: path.join(__dirname, '../dist') });

let pyProcess = null;

// Per-install key for the backend's Fernet tokens (they wrap provider
// credentials inside stream URLs). Packaged builds ship no .env, so every
// install gets its own random key, kept encrypted with safeStorage. Dev runs
// seed it from backend/.env so already-cached playlist URLs stay valid.
function backendSecret() {
  const storeDir = path.join(userDataDir, 'lumio-store');
  const file = path.join(storeDir, 'backend-key');
  try {
    const buf = fs.readFileSync(file);
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8');
  } catch {}

  let key = null;
  try {
    const env = fs.readFileSync(path.join(__dirname, '../../backend/.env'), 'utf8');
    const m = /^FERNET_KEY=(.+)$/m.exec(env);
    if (m) key = m[1].trim();
  } catch {}
  const fresh = !key;
  if (fresh) {
    // Fernet key = urlsafe base64 (with padding) of 32 random bytes.
    key = require('crypto').randomBytes(32).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
  }
  try {
    fs.mkdirSync(storeDir, { recursive: true });
    fs.writeFileSync(file, safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(key) : Buffer.from(key, 'utf8'));
  } catch (err) {
    console.warn('Could not persist backend key:', err);
  }
  if (fresh) {
    // Cached playlists hold stream URLs tokenized with some other key; drop
    // them so the app re-fetches (the saved source config is kept).
    for (const f of ['iptv_playlist.json', 'iptv_epg.json']) {
      try { fs.unlinkSync(path.join(storeDir, f)); } catch {}
    }
  }
  return key;
}

function startBackend() {
  try {
    const isPackaged = app.isPackaged;
    const backendDir = isPackaged
      ? path.join(process.resourcesPath, 'backend')
      : path.join(__dirname, '../../backend');
    const env = {
      ...process.env,
      FERNET_KEY: backendSecret(),
      // Writable per-user folder (the install dir may be read-only).
      LUMIO_DATA_DIR: path.join(userDataDir, 'backend'),
      LUMIO_BACKEND_PORT: '8000',
      LUMIO_NO_MONGO: '1',
    };

    // Packaged: standalone PyInstaller build, no Python needed on the machine.
    const bundledExe = path.join(backendDir, 'lumio-backend', process.platform === 'win32' ? 'lumio-backend.exe' : 'lumio-backend');
    if (fs.existsSync(bundledExe)) {
      pyProcess = spawn(bundledExe, [], { cwd: path.dirname(bundledExe), env, windowsHide: true });
    } else {
      // Dev: run the sources with the project's venv (or system) Python.
      // macOS: a venv under ~/Library/Application Support/Lumio IPTV/pyenv also works for packaged builds.
      const venvPython = process.platform === 'win32'
        ? path.join(backendDir, 'venv', 'Scripts', 'python.exe')
        : [path.join(userDataDir, 'pyenv', 'bin', 'python'), path.join(backendDir, 'venv', 'bin', 'python')].find((p) => fs.existsSync(p));
      const pythonExe = venvPython && fs.existsSync(venvPython) ? venvPython : (process.platform === 'win32' ? 'python' : 'python3');
      const scriptPath = path.join(backendDir, 'server.py');
      if (!fs.existsSync(scriptPath)) {
        console.warn('Backend not found at:', backendDir);
        return;
      }
      pyProcess = spawn(pythonExe, ['-m', 'uvicorn', 'server:app', '--host', '127.0.0.1', '--port', '8000'], {
        cwd: backendDir,
        env,
        windowsHide: true,
      });
    }

    pyProcess.stdout?.on('data', (data) => console.log(`[Backend]: ${data}`));
    pyProcess.stderr?.on('data', (data) => console.error(`[Backend Err]: ${data}`));
    pyProcess.on('close', (code) => console.log(`[Backend] exited with code ${code}`));
  } catch (err) {
    console.error('Failed to start backend process:', err);
  }
}

function stopBackend() {
  if (pyProcess) {
    try {
      pyProcess.kill();
    } catch {}
    pyProcess = null;
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 800,
    minHeight: 600,
    title: "Lumio IPTV",
    icon: path.join(__dirname, 'icon.png'),
    backgroundColor: '#000000',
    // macOS keeps its native traffic lights over the app's 32px title bar.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hidden', trafficLightPosition: { x: 12, y: 10 } }
      : { frame: false }),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  win.on('maximize', () => win.webContents.send('window-maximize-change', true));
  win.on('unmaximize', () => win.webContents.send('window-maximize-change', false));
  win.on('enter-full-screen', () => win.webContents.send('fullscreen-change', true));
  win.on('leave-full-screen', () => win.webContents.send('fullscreen-change', false));

  win.webContents.userAgent = "IPTVSmarters/1.0";

  if (DEBUG) {
    win.webContents.on('console-message', (event, legacyLevel, legacyMessage) => {
      const level = event?.level ?? legacyLevel;
      const message = event?.message ?? legacyMessage;
      if (level === 'warning' || level === 'error' || level >= 2) console.log(`[Renderer ${level}]`, message);
    });
  }

  // Remove default menu
  win.setMenu(null);

  // Load the React Native / Expo web bundle
  loadURL(win);
}

// Frameless windows on Windows can report isMaximized() === false while filling
// the screen, so "restore down" did nothing. Also judge by the actual bounds,
// and remember the pre-maximize bounds to restore explicitly if needed.
const restoreBounds = new WeakMap();
function isEffectivelyMaximized(win) {
  if (win.isMaximized()) return true;
  const b = win.getBounds();
  const wa = screen.getDisplayMatching(b).workArea;
  return b.width >= wa.width && b.height >= wa.height;
}
function toggleMaximize(win) {
  if (isEffectivelyMaximized(win)) {
    win.unmaximize();
    if (isEffectivelyMaximized(win)) {
      // Maximized by the OS (e.g. double-clicking the title bar) leaves no saved
      // bounds; fall back to the default size, centered on the current display.
      const wa = screen.getDisplayMatching(win.getBounds()).workArea;
      const w = Math.min(1280, wa.width), h = Math.min(720, wa.height);
      win.setBounds(restoreBounds.get(win) || {
        x: Math.round(wa.x + (wa.width - w) / 2),
        y: Math.round(wa.y + (wa.height - h) / 2),
        width: w,
        height: h,
      });
    }
    win.webContents.send('window-maximize-change', false);
  } else {
    restoreBounds.set(win, win.getBounds());
    win.maximize();
    win.webContents.send('window-maximize-change', true);
  }
}

ipcMain.on('window-control', (event, action) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return;

  if (action === 'minimize') {
    window.minimize();
  } else if (action === 'maximize') {
    toggleMaximize(window);
  } else if (action === 'close') {
    window.close();
  }
});

// Large app data (parsed playlist, EPG) that doesn't fit in localStorage.
// Stored as files under userData/lumio-store (not "cache": Windows paths are
// case-insensitive and Chromium owns userData/Cache), encrypted with the OS keychain (DPAPI
// on Windows) since playlists embed provider credentials in stream URLs.
const cacheDir = path.join(userDataDir, 'lumio-store');
const cachePath = (key) => path.join(cacheDir, String(key).replace(/[^a-zA-Z0-9_.-]/g, '_'));

ipcMain.handle('cache-read', async (_event, key) => {
  try {
    const buf = await fs.promises.readFile(cachePath(key));
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8');
  } catch {
    return null;
  }
});

ipcMain.handle('cache-write', async (_event, key, data) => {
  try {
    await fs.promises.mkdir(cacheDir, { recursive: true });
    const buf = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(data) : Buffer.from(data, 'utf8');
    const file = cachePath(key);
    // Write-then-rename so a crash mid-write never leaves a truncated cache.
    await fs.promises.writeFile(file + '.tmp', buf);
    await fs.promises.rename(file + '.tmp', file);
    return true;
  } catch (err) {
    console.warn('cache-write failed:', err);
    return false;
  }
});

ipcMain.handle('cache-delete', async (_event, key) => {
  try { await fs.promises.unlink(cachePath(key)); } catch {}
  return true;
});

// --- Self-update -----------------------------------------------------------
// The manifest and the MSI come from a public binaries-only repo. The renderer
// never passes URLs or paths: main fetches the manifest itself, downloads the
// MSI it names, checks its SHA-256, and only ever installs that file.
const UPDATE_MANIFEST_URL = 'https://github.com/future01software/lumio-releases/releases/latest/download/latest.json';
const UPDATE_URL_PREFIX = 'https://github.com/future01software/lumio-releases/releases/download/';
let updateManifest = null;
let downloadedUpdate = null;

// Dev runs start Electron on electron/main.js, where getVersion() reports Electron's own
// version; read the app's package.json instead.
const APP_VERSION = app.isPackaged ? app.getVersion() : require('../package.json').version;
ipcMain.handle('app-version', () => APP_VERSION);
// Sync variant for the preload: the renderer needs the version synchronously.
ipcMain.on('app-version-sync', (event) => { event.returnValue = APP_VERSION; });

// Updates ship as a Windows MSI and a macOS DMG.
const UPDATE_ASSET_KEY = process.platform === 'darwin' ? 'mac' : 'windows';
const UPDATE_EXT = process.platform === 'darwin' ? 'dmg' : 'msi';

ipcMain.handle('update-check', async () => {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return null;
  const res = await net.fetch(`${UPDATE_MANIFEST_URL}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  updateManifest = await res.json();
  return updateManifest;
});

ipcMain.handle('update-download', async (event) => {
  const asset = updateManifest && updateManifest[UPDATE_ASSET_KEY];
  if (!asset || typeof asset.url !== 'string' || !asset.url.startsWith(UPDATE_URL_PREFIX)) return false;
  const file = path.join(app.getPath('temp'), `Lumio-IPTV-${String(updateManifest.version).replace(/[^0-9.]/g, '')}.${UPDATE_EXT}`);
  const res = await net.fetch(asset.url);
  if (!res.ok || !res.body) return false;
  const total = Number(res.headers.get('content-length')) || asset.size || 0;
  const hash = require('crypto').createHash('sha256');
  const out = fs.createWriteStream(file);
  let received = 0;
  let lastSent = 0;
  try {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      if (!out.write(value)) await new Promise((r) => out.once('drain', r));
      received += value.length;
      const now = Date.now();
      if (total && now - lastSent > 150) {
        lastSent = now;
        event.sender.send('update-progress', received / total);
      }
    }
  } finally {
    await new Promise((r) => out.end(r));
  }
  if (asset.sha256 && hash.digest('hex').toLowerCase() !== String(asset.sha256).toLowerCase()) {
    try { fs.unlinkSync(file); } catch {}
    return false;
  }
  event.sender.send('update-progress', 1);
  downloadedUpdate = file;
  return true;
});

ipcMain.handle('update-install', () => {
  if (!downloadedUpdate || !fs.existsSync(downloadedUpdate)) throw new Error('Update not downloaded');
  if (process.platform === 'darwin') {
    // .../Lumio IPTV.app/Contents/MacOS/Electron -> .../Lumio IPTV.app
    const appBundle = path.resolve(process.execPath, '../../..');
    if (!app.isPackaged || !appBundle.endsWith('.app')) throw new Error('Not a packaged app');
    // Once this process has exited: mount the DMG, swap the bundle in place and relaunch.
    // If the swap fails, the DMG is opened so it can be installed by hand.
    const script = [
      'pid="$1"; dmg="$2"; app="$3"',
      'while kill -0 "$pid" 2>/dev/null; do sleep 0.3; done',
      'mnt="$(mktemp -d)"',
      'if hdiutil attach -nobrowse -noautoopen -mountpoint "$mnt" "$dmg" >/dev/null; then',
      '  src="$(ls -d "$mnt"/*.app | head -1)"',
      '  if [ -n "$src" ] && rm -rf "$app.update" && ditto "$src" "$app.update" && rm -rf "$app" && mv "$app.update" "$app"; then',
      '    hdiutil detach -quiet "$mnt"; rm -f "$dmg"; open "$app"; exit 0',
      '  fi',
      '  hdiutil detach -quiet "$mnt"',
      'fi',
      'open "$dmg"',
    ].join('\n');
    spawn('/bin/bash', ['-c', script, 'lumio-update', String(process.pid), downloadedUpdate, appBundle], {
      detached: true,
      stdio: 'ignore',
    }).unref();
    setTimeout(() => app.quit(), 300);
    return;
  }
  // msiexec replaces the running install (same UpgradeCode, per-user), then we
  // start the new version. cmd waits for msiexec; we quit right away so no
  // files are locked.
  // windowsVerbatimArguments: Node would otherwise escape the inner quotes as
  // \" , which cmd doesn't understand - msiexec then got a mangled path and
  // quit without installing. /s makes cmd strip only the outer quote pair.
  const exe = process.execPath;
  const command = `"msiexec /i "${downloadedUpdate}" /passive /norestart && start "" "${exe}""`;
  spawn('cmd.exe', ['/d', '/s', '/c', command], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    windowsVerbatimArguments: true,
  }).unref();
  setTimeout(() => app.quit(), 300);
});

// --- Notifications (EPG reminders) ------------------------------------------
ipcMain.on('notify', (event, title, body, tag) => {
  if (!Notification.isSupported()) return;
  const win = BrowserWindow.fromWebContents(event.sender);
  const n = new Notification({ title: String(title), body: String(body || ''), icon: path.join(__dirname, 'icon.png') });
  n.on('click', () => {
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      win.webContents.send('notification-click', tag);
    }
  });
  n.show();
});

// --- Backup files -------------------------------------------------------------
ipcMain.handle('backup-save', async (event, data, defaultName) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Yedeği kaydet',
    defaultPath: path.join(app.getPath('documents'), String(defaultName || 'lumio-yedek.json')),
    filters: [{ name: 'Lumio yedeği', extensions: ['json'] }],
  });
  if (canceled || !filePath) return null;
  await fs.promises.writeFile(filePath, String(data), 'utf8');
  return filePath;
});

ipcMain.handle('backup-open', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Yedek dosyasını seç',
    properties: ['openFile'],
    filters: [{ name: 'Lumio yedeği', extensions: ['json'] }],
  });
  if (canceled || !filePaths?.length) return null;
  const stat = await fs.promises.stat(filePaths[0]);
  if (stat.size > 50 * 1024 * 1024) throw new Error('Dosya çok büyük');
  return fs.promises.readFile(filePaths[0], 'utf8');
});

ipcMain.on('toggle-fullscreen', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (window) {
    window.setFullScreen(!window.isFullScreen());
  }
});

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;
  // macOS has a global menu bar; keep the standard one so Cmd+C/V/Q and full screen work.
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      { label: 'Görünüm', submenu: [{ role: 'reload' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
      { role: 'windowMenu' },
    ]));
  }
  startBackend();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('will-quit', () => {
  stopBackend();
});

// The backend stops with the last window, so quit on macOS too rather than
// leaving a dock icon that would reopen a window without a backend.
app.on('window-all-closed', () => {
  stopBackend();
  app.quit();
});
