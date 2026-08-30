/* V28: a quieter radar, and a desktop app that is actually ahead.

   Two halves.

   The radar: it was telling people about the machinery — STANDBY,
   SCANNING, SIMULATED, LIVE RADAR — across the top of a weather map,
   and repeating the same moment in time four ways under it. The rule
   now is that it speaks only when it has something worth saying: a
   prediction, stale imagery or a simulation get words, a live radar
   gets a dot. And it shows the weather, not just a temperature.

   The desktop: the web build and the desktop build run the same code,
   so the thing to prove is that the difference is real and that the
   browser is unharmed by it. A browser must not be left with a panel
   of switches that do nothing, and every desktop-only call must be a
   no-op rather than an exception when the bridge is absent. */
const { chromium } = require('playwright');
const BASE_URL = process.env.WTW_BASE_URL || 'http://localhost:8901';
const APP_DIR = process.env.WTW_APP_DIR || require('path').join(__dirname, '..');
const BROWSER = process.env.PLAYWRIGHT_CHROMIUM || undefined;
const fs = require('fs');
const path = require('path');
const PNG = fs.readFileSync(__dirname + '/fixture-radar-frame.png');
const APP_VERSION = (fs.readFileSync(APP_DIR + '/config.js', 'utf8')
  .match(/version:\s*'([^']+)'/) || [])[1];

const pad = (n) => String(n).padStart(2, '0');
function isoDate(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function omBody() {
  const time = [], a = [];
  for (let d = -1; d < 7; d++) for (let h = 0; h < 24; h++) { time.push(`${isoDate(d)}T${pad(h)}:00`); a.push(72); }
  const dT = []; for (let d = -1; d < 7; d++) dT.push(isoDate(d));
  return JSON.stringify({
    current: { temperature_2m: 72, apparent_temperature: 72, relative_humidity_2m: 50,
               weather_code: 61, wind_speed_10m: 6, wind_direction_10m: 180,
               wind_gusts_10m: 9, is_day: 1, pressure_msl: 1013, dew_point_2m: 50,
               precipitation: 0 },
    hourly: { time, temperature_2m: a, apparent_temperature: a, relative_humidity_2m: a,
              precipitation_probability: a.map(() => 10), precipitation: a.map(() => 0),
              weather_code: a.map(() => 61), wind_speed_10m: a.map(() => 6),
              wind_gusts_10m: a.map(() => 9), wind_direction_10m: a.map(() => 180),
              visibility: a.map(() => 16093), pressure_msl: a.map(() => 1013),
              uv_index: a.map(() => 5) },
    daily: { time: dT, weather_code: dT.map(() => 61), temperature_2m_max: dT.map(() => 80),
             temperature_2m_min: dT.map(() => 64),
             precipitation_probability_max: dT.map(() => 60),
             precipitation_sum: dT.map(() => 0), wind_gusts_10m_max: dT.map(() => 10),
             sunrise: dT.map((d) => d + 'T06:30'), sunset: dT.map((d) => d + 'T19:30'),
             uv_index_max: dT.map(() => 5) } });
}

(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER });
  let failures = 0;
  const check = async (n, fn) => {
    try { const ok = await fn(); console.log((ok ? 'PASS' : 'FAIL') + ' - ' + n); if (!ok) failures++; }
    catch (e) { console.log('FAIL - ' + n + ' (' + e.message.split('\n')[0] + ')'); failures++; }
  };

  /* desktop: null for a browser, or an object standing in for the
     preload bridge — the same shape, so the page cannot tell. */
  const mk = async ({ desktop = null } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 },
                                           serviceWorkers: 'block' });
    const page = await ctx.newPage();
    if (desktop) {
      await page.addInitScript((prefs) => {
        window.__desk = { notified: [], tray: [], prefs, installed: 0, checked: 0,
                          state: { status: 'idle' } };
        window.aitherDesktop = {
          isDesktop: true,
          platform: 'linux',
          version: () => Promise.resolve('28.0.0'),
          updates: {
            check: () => { window.__desk.checked++;
              window.__desk.state = { status: 'available', version: '29.0.0' };
              return Promise.resolve(window.__desk.state); },
            install: () => { window.__desk.installed++;
              window.__desk.state = { status: 'ready', version: '29.0.0', progress: 100 };
              return Promise.resolve(window.__desk.state); },
            state: () => Promise.resolve(window.__desk.state),
          },
          prefs: {
            get: () => Promise.resolve(window.__desk.prefs),
            set: (patch) => { Object.assign(window.__desk.prefs, patch);
              return Promise.resolve(window.__desk.prefs); },
          },
          setTrayWeather: (info) => { window.__desk.tray.push(info); return Promise.resolve(true); },
          notify: (title, body) => { window.__desk.notified.push({ title, body });
            return Promise.resolve(true); },
          on: () => () => {},
        };
      }, { launchAtLogin: false, trayWeather: true, alwaysOnTop: false,
           minimiseToTray: false, autoCheckUpdates: true });
    }
    await page.route((u) => u.protocol === 'https:', (r) => r.abort());
    await page.route('https://api.open-meteo.com/**', (r) => r.fulfill({
      contentType: 'application/json', body: omBody() }));
    await page.route('https://archive-api.open-meteo.com/**', (r) => r.abort());
    await page.route('https://air-quality-api.open-meteo.com/**', (r) => r.abort());
    await page.route('https://api.rainviewer.com/**', (r) => r.abort());
    await page.route('https://geocoding-api.open-meteo.com/**', (r) => r.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ results: [{ name: 'Austin', admin1: 'Texas', country_code: 'US',
        latitude: 30.2672, longitude: -97.7431 }] }) }));
    await page.route('https://api.weather.gov/**', (r) => r.fulfill({ status: 404, body: '{}' }));
    await page.route('https://opengeo.ncep.noaa.gov/**', (r) => r.fulfill({
      headers: { 'cache-control': 'no-store' }, contentType: 'image/png', body: PNG }));
    await page.route('https://basemaps.cartocdn.com/**', (r) => r.fulfill({
      headers: { 'cache-control': 'no-store' }, contentType: 'image/png', body: PNG }));
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(BASE_URL + '/index.html', { waitUntil: 'networkidle' });
    await page.fill('#searchInput', 'Austin');
    await page.click('#searchBtn');
    await page.waitForSelector('#weatherPanels:not([hidden])', { timeout: 20000 });
    await page.waitForTimeout(1400);
    return { ctx, page, errors };
  };

  console.log('=== The desktop build is genuinely ahead ===');
  let { ctx, page, errors } = await mk({ desktop: true });
  await check(`badge reads ${APP_VERSION}`, async () =>
    (await page.textContent('#appVersion')).trim() === APP_VERSION);
  await check('the desktop section appears, and names its version', async () => {
    await page.click('#settingsBtn');
    await page.waitForTimeout(600);
    return (await page.getAttribute('#desktopPanel', 'hidden')) === null &&
           (await page.textContent('#desktopVersion')).trim() === '28.0.0';
  });
  await check('it offers what a tab cannot: tray, login, on-top, tray-close', async () =>
    page.evaluate(() => ['deskTrayWeather', 'deskLaunchAtLogin', 'deskAlwaysOnTop',
                         'deskMinimiseToTray']
      .every((id) => !!document.getElementById(id))));
  await check('a preference round-trips to the app rather than the page', async () => {
    await page.check('#deskAlwaysOnTop');
    await page.waitForTimeout(400);
    return page.evaluate(() => window.__desk.prefs.alwaysOnTop === true);
  });
  await check('the temperature is pushed to the tray', async () =>
    page.evaluate(() => window.__desk.tray.length > 0 &&
      /\d/.test(window.__desk.tray[0].temp) &&
      window.__desk.tray[0].place === 'Austin, Texas'));
  await check('and not pushed again when nothing changed', async () => {
    // Replay the reading the app itself pushed. Inventing an
    // equivalent-looking object tests the fixture, not the guard:
    // a different conditionText is a genuinely different tray label.
    const before = await page.evaluate(() => window.__desk.tray.length);
    await page.evaluate(() => {
      const last = window.WTWDesktop.lastPush();
      window.WTWDesktop.pushWeather(last.weather, last.placeName);
    });
    const after = await page.evaluate(() => window.__desk.tray.length);
    return after === before;
  });

  console.log('\n=== Updates come from GitHub, and ask first ===');
  await check('the panel says where updates come from', async () =>
    /github/i.test(await page.textContent('#desktopPanel')));
  await check('checking reports what it found', async () => {
    await page.click('#desktopUpdateBtn');
    await page.waitForTimeout(500);
    const status = await page.textContent('#desktopUpdateStatus');
    return /29\.0\.0/.test(status) && /available/i.test(status);
  });
  await check('nothing downloads until it is asked to', async () =>
    page.evaluate(() => window.__desk.installed === 0));
  await check('the button then offers the download', async () =>
    /download/i.test(await page.textContent('#desktopUpdateBtn')));
  await check('and asking installs it', async () => {
    await page.click('#desktopUpdateBtn');
    await page.waitForTimeout(500);
    return (await page.evaluate(() => window.__desk.installed)) === 1 &&
           /restart/i.test(await page.textContent('#desktopUpdateStatus'));
  });
  await check('no JS errors on the desktop build', () => errors.length === 0);
  if (errors.length) console.log(errors.join('\n'));
  await ctx.close();

  console.log('\n=== And the browser is exactly what it was ===');
  ({ ctx, page, errors } = await mk());
  await check('the desktop section is removed, not left dead', async () => {
    await page.click('#settingsBtn');
    await page.waitForTimeout(600);
    return (await page.locator('#desktopPanel').count()) === 0;
  });
  await check('the desktop helpers are safe to call with no bridge', async () =>
    page.evaluate(() => {
      // Every one of these runs on a normal weather load.
      WTWDesktop.pushWeather({ tempF: 70 }, 'Nowhere');
      WTWDesktop.pushAlerts([{ properties: { event: 'Test' } }]);
      WTWDesktop.renderUpdate({ status: 'available' });
      return WTWDesktop.available() === false;
    }));
  await check('nothing marks the page as a desktop build', async () =>
    (await page.getAttribute('html', 'data-desktop')) === null);
  await check('no JS errors in the browser build', () => errors.length === 0);
  if (errors.length) console.log(errors.join('\n'));
  await ctx.close();

  console.log('\n=== The build is configured to update itself ===');
  const pkg = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'desktop/package.json'), 'utf8'));
  await check('electron-updater is a runtime dependency, not a dev one', () =>
    !!(pkg.dependencies && pkg.dependencies['electron-updater']));
  await check('the update feed points at this project on GitHub', () => {
    const publish = (pkg.build && pkg.build.publish) || [];
    const gh = publish.find((p) => p.provider === 'github');
    return !!gh && gh.owner === 'gwallee';
  });
  await check('the preload script is packaged with the app', () =>
    (pkg.build.files || []).includes('preload.js'));
  await check('the release workflow uploads the update feed', () => {
    const wf = fs.readFileSync(path.join(APP_DIR, '.github/workflows/desktop-release.yml'), 'utf8');
    // Without latest*.yml attached to the release, an installed copy
    // has nothing to read and never sees a new version.
    return /latest\.yml/.test(wf) && /latest-mac\.yml/.test(wf) &&
           /latest-linux\.yml/.test(wf);
  });
  await check('the main process asks before downloading', () => {
    const main = fs.readFileSync(path.join(APP_DIR, 'desktop/main.js'), 'utf8');
    return /autoUpdater\.autoDownload\s*=\s*false/.test(main);
  });
  await check('the window keeps context isolation and no node access', () => {
    const main = fs.readFileSync(path.join(APP_DIR, 'desktop/main.js'), 'utf8');
    return /contextIsolation:\s*true/.test(main) &&
           /nodeIntegration:\s*false/.test(main) &&
           /sandbox:\s*true/.test(main);
  });
  await check('the bridge exposes a named surface, not ipcRenderer itself', () => {
    const pre = fs.readFileSync(path.join(APP_DIR, 'desktop/preload.js'), 'utf8');
    return /exposeInMainWorld/.test(pre) &&
           !/exposeInMainWorld\([^,]+,\s*ipcRenderer\s*\)/.test(pre);
  });

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll V28 checks passed.');
  await browser.close();
  process.exit(failures ? 1 : 0);
})();
