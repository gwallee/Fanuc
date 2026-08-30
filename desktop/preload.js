/* preload.js — the only bridge between the page and the desktop.

   The window runs with contextIsolation on and nodeIntegration off,
   so the app itself has no access to Node. This exposes a small,
   named surface and nothing else: the page can ask about updates and
   set desktop preferences, and it cannot reach the file system, spawn
   anything, or require a module.

   Every channel here is one the renderer initiates. Nothing accepts a
   path, a URL or a command from the page. */
const { contextBridge, ipcRenderer } = require('electron');

const ALLOWED_EVENTS = ['update-status'];

contextBridge.exposeInMainWorld('aitherDesktop', {
  // Marks the build as the desktop one. The web app reads this to
  // switch on the things only a desktop can do.
  isDesktop: true,
  platform: process.platform,
  version: () => ipcRenderer.invoke('app:version'),

  updates: {
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    state: () => ipcRenderer.invoke('update:state'),
  },

  prefs: {
    get: () => ipcRenderer.invoke('prefs:get'),
    set: (patch) => ipcRenderer.invoke('prefs:set', patch),
  },

  // A tray label the browser cannot draw: the current temperature
  // beside the system clock.
  setTrayWeather: (info) => ipcRenderer.invoke('tray:weather', info),

  // Native notifications, which do not need the page to be open.
  notify: (title, body) => ipcRenderer.invoke('notify', { title, body }),

  on: (event, handler) => {
    if (!ALLOWED_EVENTS.includes(event) || typeof handler !== 'function') return () => {};
    const wrapped = (_e, payload) => handler(payload);
    ipcRenderer.on(event, wrapped);
    return () => ipcRenderer.removeListener(event, wrapped);
  },
});
