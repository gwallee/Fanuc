/* ============================================================
   Aither Weather — Electron main process.

   The desktop app is the same static web app, loaded from the
   packaged resources. No API keys, no bundled server, no build
   step for the web side.
   ============================================================ */

const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

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
    buildMenu();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
