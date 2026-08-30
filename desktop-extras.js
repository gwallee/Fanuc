/* desktop-extras.js — what the desktop app can do that a tab cannot.

   The browser build and the desktop build run the same code. This
   file is the difference: it does nothing at all in a browser, and in
   the desktop app it switches on the things a page in a tab is simply
   not allowed to do.

   Four of them, and each is a real capability rather than a badge:

     - Updates. The app pulls its own new versions from the project's
       GitHub releases, tells you what changed, and installs on your
       say-so. A tab reloads; it cannot replace itself.
     - The temperature in the system tray, beside the clock, with the
       window closed.
     - Native notifications for severe alerts, which arrive whether or
       not the app is open. A browser can only notify while a tab is
       alive and permission has been granted.
     - Window behaviour: always on top, launch at login, close to
       tray. None of these exist for a web page.

   Everything here degrades to nothing. `window.aitherDesktop` is
   injected by the preload script; without it, every function below
   returns quietly and the web app is exactly what it was. */
const WTWDesktop = (() => {
  'use strict';

  const bridge = () => (typeof window !== 'undefined' ? window.aitherDesktop : null);
  const available = () => !!bridge();

  let prefs = null;
  let lastTray = '';
  let lastPush = null;

  /* ---------------- Updates ---------------- */

  const WORDS = {
    idle: '',
    dev: 'Updates are only checked in an installed build.',
    checking: 'Checking GitHub for a newer version…',
    current: 'You are on the newest version.',
    available: 'A newer version is available.',
    downloading: 'Downloading…',
    ready: 'Ready to install — restart to finish.',
    error: 'Could not reach GitHub for updates.',
  };

  function renderUpdate(state) {
    const box = document.getElementById('desktopUpdate');
    if (!box) return;
    const status = document.getElementById('desktopUpdateStatus');
    const button = document.getElementById('desktopUpdateBtn');
    const bar = document.getElementById('desktopUpdateBar');
    const s = state || { status: 'idle' };

    let text = WORDS[s.status] || '';
    if (s.status === 'available' && s.version) text = `Version ${s.version} is available.`;
    if (s.status === 'ready' && s.version) text = `Version ${s.version} is ready — restart to finish.`;
    if (s.status === 'downloading') text = `Downloading… ${s.progress || 0}%`;
    if (s.status === 'error' && s.notes) text = `${WORDS.error} ${s.notes}`;
    if (status) { status.textContent = text; status.dataset.kind =
      s.status === 'error' ? 'warn' : (s.status === 'ready' || s.status === 'current' ? 'ok' : ''); }

    if (bar) {
      bar.hidden = s.status !== 'downloading';
      bar.style.setProperty('--pct', `${s.progress || 0}%`);
    }

    if (button) {
      const labels = {
        available: 'Download it',
        ready: 'Restart and install',
        downloading: 'Downloading…',
      };
      button.textContent = labels[s.status] || 'Check for updates';
      button.disabled = s.status === 'checking' || s.status === 'downloading';
    }
  }

  async function checkUpdates() {
    const api = bridge();
    if (!api) return;
    renderUpdate({ status: 'checking' });
    renderUpdate(await api.updates.check());
  }

  async function actOnUpdate() {
    const api = bridge();
    if (!api) return;
    const state = await api.updates.state();
    if (state.status === 'available' || state.status === 'ready') {
      renderUpdate(await api.updates.install());
      return;
    }
    await checkUpdates();
  }

  /* ---------------- The tray ---------------- */

  /* Called on every weather render, so it has to be cheap and it has
     to not talk to the main process when nothing changed. */
  function pushWeather(weather, placeName) {
    const api = bridge();
    if (!api || !weather || !prefs || !prefs.trayWeather) return;
    const U = window.WTWUnits;
    const temp = weather.tempF != null && U ? U.temp(weather.tempF) : '';
    const key = `${temp}|${placeName || ''}|${weather.conditionText || ''}`;
    if (key === lastTray) return;
    lastTray = key;
    lastPush = { weather, placeName };
    api.setTrayWeather({
      temp, place: placeName || '',
      condition: weather.conditionText || '',
    });
  }

  /* ---------------- Native alerts ---------------- */

  /* The browser build asks for Notification permission and can only
     fire while a tab is open. The desktop app has no such limit, so
     severe alerts reach somebody who has the window closed. */
  const notified = new Set();

  function pushAlerts(alerts) {
    const api = bridge();
    if (!api || !Array.isArray(alerts)) return;
    for (const alert of alerts.slice(0, 3)) {
      const props = (alert && alert.properties) || alert || {};
      const id = `${props.event || ''}|${props.expires || props.ends || ''}`;
      if (!props.event || notified.has(id)) continue;
      notified.add(id);
      api.notify(props.event, (props.headline || props.areaDesc || '').slice(0, 300));
    }
  }

  /* ---------------- Preferences ---------------- */

  const TOGGLES = [
    ['deskLaunchAtLogin', 'launchAtLogin'],
    ['deskTrayWeather', 'trayWeather'],
    ['deskAlwaysOnTop', 'alwaysOnTop'],
    ['deskMinimiseToTray', 'minimiseToTray'],
    ['deskAutoUpdate', 'autoCheckUpdates'],
  ];

  function bindPrefs() {
    const api = bridge();
    if (!api) return;
    TOGGLES.forEach(([id, key]) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.checked = !!prefs[key];
      el.addEventListener('change', async () => {
        prefs = await api.prefs.set({ [key]: el.checked });
        el.checked = !!prefs[key];
      });
    });
  }

  /* ---------------- Wiring ---------------- */

  async function init() {
    const api = bridge();
    const panel = document.getElementById('desktopPanel');
    if (!api) {
      // A browser gets no desktop section at all — an empty panel of
      // switches that do nothing is worse than no panel.
      if (panel) panel.remove();
      return;
    }
    if (panel) panel.hidden = false;
    document.documentElement.dataset.desktop = 'true';

    prefs = await api.prefs.get();
    bindPrefs();

    const version = await api.version();
    const label = document.getElementById('desktopVersion');
    if (label) label.textContent = version;

    const button = document.getElementById('desktopUpdateBtn');
    if (button) button.addEventListener('click', actOnUpdate);
    api.on('update-status', renderUpdate);
    renderUpdate(await api.updates.state());
  }

  return { init, available, pushWeather, pushAlerts, checkUpdates, renderUpdate,
           lastPush: () => lastPush };
})();

window.WTWDesktop = WTWDesktop;
