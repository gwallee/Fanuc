/* ============================================================
   Aither Weather — Electron main process.

   The desktop app is the same static web app, loaded from the
   packaged resources. No API keys, no bundled server, no build
   step for the web side.
   ============================================================ */

const { app, BrowserWindow, Menu, shell, dialog, ipcMain,
        Tray, nativeImage, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

autoUpdater.logger = log;
log.transports.file.level = 'info';

/* Updates come from the project's own GitHub releases.

   electron-builder writes latest.yml (and the mac/linux equivalents)
   beside the installers when a release is published, and the updater
   reads those. Nothing here needs a token: the repository is public,
   so the update feed is a public URL like any other download.

   Auto-download is off. A weather app quietly pulling ninety
   megabytes over somebody's tethered connection is not a courtesy —
   it asks first, and it only asks once per launch. */
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

let updateState = { status: 'idle', version: null, notes: null, progress: 0 };

function setUpdateState(patch) {
  updateState = Object.assign({}, updateState, patch);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', updateState);
  }
}

// In development the app sits one level up; once packaged it is
// copied into the resources directory as "app".
function appRoot() {
  const packaged = path.join(process.resourcesPath || '', 'app');
  if (process.resourcesPath && fs.existsSync(path.join(packaged, 'index.html'))) {
    return packaged;
  }
  return path.join(__dirname, '..');
}

let mainWindow = null;
let tray = null;

/* Desktop-only preferences, kept beside the app's own data rather
   than in the page's localStorage: they describe the window and the
   tray, which the page does not own. */
const PREFS_FILE = () => path.join(app.getPath('userData'), 'desktop-prefs.json');
const DEFAULT_PREFS = {
  launchAtLogin: false,
  trayWeather: true,
  alwaysOnTop: false,
  minimiseToTray: false,
  autoCheckUpdates: true,
};

function readPrefs() {
  try {
    const raw = fs.readFileSync(PREFS_FILE(), 'utf8');
    return Object.assign({}, DEFAULT_PREFS, JSON.parse(raw));
  } catch (err) {
    return Object.assign({}, DEFAULT_PREFS);
  }
}

function writePrefs(patch) {
  const next = Object.assign({}, readPrefs(), patch || {});
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(PREFS_FILE(), JSON.stringify(next, null, 2));
  } catch (err) {
    log.warn('could not save desktop preferences', err && err.message);
  }
  applyPrefs(next);
  return next;
}

function applyPrefs(prefs) {
  try {
    // Only meaningful where the OS has the concept.
    if (process.platform !== 'linux') {
      app.setLoginItemSettings({ openAtLogin: !!prefs.launchAtLogin });
    }
  } catch (err) {
    log.warn('login item not settable', err && err.message);
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setAlwaysOnTop(!!prefs.alwaysOnTop);
  }
  if (!prefs.trayWeather && tray) { tray.destroy(); tray = null; }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 360,
    minHeight: 560,
    backgroundColor: '#0a0e17',
    autoHideMenuBar: true,
    show: false,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Avoid a white flash before the dark UI paints.
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadFile(path.join(appRoot(), 'index.html'));

  // External links open in the real browser, never in the app frame.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  // Closing to the tray is a desktop habit; it is off unless asked for.
  mainWindow.on('close', (event) => {
    const prefs = readPrefs();
    if (prefs.minimiseToTray && !app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  applyPrefs(readPrefs());
}


/* ============================================================
   Updates
   ============================================================ */

function wireUpdater() {
  autoUpdater.on('checking-for-update', () => setUpdateState({ status: 'checking' }));
  autoUpdater.on('update-available', (info) => {
    setUpdateState({ status: 'available', version: info && info.version,
                     notes: typeof (info && info.releaseNotes) === 'string'
                       ? info.releaseNotes.slice(0, 2000) : null });
  });
  autoUpdater.on('update-not-available', () => setUpdateState({ status: 'current' }));
  autoUpdater.on('download-progress', (p) =>
    setUpdateState({ status: 'downloading', progress: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', (info) =>
    setUpdateState({ status: 'ready', version: info && info.version, progress: 100 }));
  autoUpdater.on('error', (err) => {
    // An update that cannot be checked is not a reason to interrupt
    // somebody looking at the weather.
    log.warn('update check failed', err && err.message);
    setUpdateState({ status: 'error', notes: String((err && err.message) || err) });
  });
}

async function checkForUpdates({ silent = true } = {}) {
  if (!app.isPackaged) {
    setUpdateState({ status: 'dev' });
    return updateState;
  }
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    setUpdateState({ status: 'error', notes: String((err && err.message) || err) });
  }
  if (!silent && updateState.status === 'current') {
    dialog.showMessageBox(mainWindow, {
      type: 'info', title: 'Up to date',
      message: `Aither Weather ${app.getVersion()} is the newest version.`,
      buttons: ['OK'],
    });
  }
  return updateState;
}

/* ============================================================
   Tray — the current temperature beside the system clock
   ============================================================ */

function ensureTray() {
  if (tray || !readPrefs().trayWeather) return;
  const iconPath = path.join(__dirname, 'build', 'icon.png');
  let image = nativeImage.createFromPath(iconPath);
  if (!image.isEmpty()) image = image.resize({ width: 18, height: 18 });
  tray = new Tray(image);
  tray.setToolTip('Aither Weather');
  tray.on('click', () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) mainWindow.hide();
    else { mainWindow.show(); mainWindow.focus(); }
  });
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Aither Weather', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
    { label: 'Check for Updates…', click: () => checkForUpdates({ silent: false }) },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
}

/* ============================================================
   The channels the page may use
   ============================================================ */

function wireIpc() {
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('update:state', () => updateState);
  ipcMain.handle('update:check', () => checkForUpdates({ silent: true }));
  ipcMain.handle('update:install', async () => {
    if (updateState.status === 'available') {
      setUpdateState({ status: 'downloading', progress: 0 });
      try { await autoUpdater.downloadUpdate(); }
      catch (err) { setUpdateState({ status: 'error', notes: String(err && err.message) }); }
      return updateState;
    }
    if (updateState.status === 'ready') {
      app.isQuitting = true;
      setImmediate(() => autoUpdater.quitAndInstall());
    }
    return updateState;
  });

  ipcMain.handle('prefs:get', () => readPrefs());
  ipcMain.handle('prefs:set', (_e, patch) => {
    // Only the keys this app knows about, and only of the right type:
    // the renderer is trusted, but a typo should not write junk into
    // the preferences file.
    const clean = {};
    for (const key of Object.keys(DEFAULT_PREFS)) {
      if (patch && typeof patch[key] === 'boolean') clean[key] = patch[key];
    }
    const next = writePrefs(clean);
    if (next.trayWeather) ensureTray();
    return next;
  });

  ipcMain.handle('tray:weather', (_e, info) => {
    if (!readPrefs().trayWeather) return false;
    ensureTray();
    if (!tray || !info) return false;
    const temp = typeof info.temp === 'string' ? info.temp.slice(0, 12) : '';
    const place = typeof info.place === 'string' ? info.place.slice(0, 60) : '';
    const condition = typeof info.condition === 'string' ? info.condition.slice(0, 60) : '';
    // macOS and Windows show a title beside the icon; Linux trays
    // vary, so the tooltip carries the same information either way.
    if (typeof tray.setTitle === 'function') tray.setTitle(temp ? ` ${temp}` : '');
    tray.setToolTip([place, condition, temp].filter(Boolean).join(' · ') || 'Aither Weather');
    return true;
  });

  ipcMain.handle('notify', (_e, payload) => {
    if (!Notification.isSupported() || !payload) return false;
    const title = String(payload.title || 'Aither Weather').slice(0, 120);
    const body = String(payload.body || '').slice(0, 400);
    new Notification({ title, body, silent: false }).show();
    return true;
  });
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Refresh Weather',
          accelerator: 'CmdOrCtrl+R',
          click: () => mainWindow && mainWindow.reload(),
        },
        {
          label: 'Toggle Fullscreen',
          accelerator: isMac ? 'Ctrl+Cmd+F' : 'F11',
          click: () => mainWindow && mainWindow.setFullScreen(!mainWindow.isFullScreen()),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' }, { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Aither Weather',
          click: () => dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'Aither Weather',
            message: `Aither Weather ${app.getVersion()}`,
            detail: 'Neon weather with a real-map radar, a 48-hour outlook, and a\n' +
                    'local AI that roasts the forecast.\n\n' +
                    'No API keys. Weather from the National Weather Service,\n' +
                    'MET Norway and Open-Meteo; radar from RainViewer and NOAA.',
            buttons: ['OK'],
          }),
        },
        {
          label: 'Check for Updates…',
          click: () => checkForUpdates({ silent: false }),
        },
        {
          label: 'Weather Data Sources',
          click: () => shell.openExternal('https://open-meteo.com/'),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// A second launch should focus the existing window, not open another.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    wireUpdater();
    wireIpc();
    buildMenu();
    createWindow();
    if (readPrefs().trayWeather) ensureTray();
    // One check a few seconds after launch, once the window has
    // settled and the weather is already on screen.
    if (readPrefs().autoCheckUpdates) setTimeout(() => checkForUpdates(), 6000);
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('before-quit', () => { app.isQuitting = true; });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
