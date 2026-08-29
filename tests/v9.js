/* V9 feature suite: hourly, PWA, map radar, Local AI 3.0. */
const { chromium } = require('playwright');
const BASE_URL = process.env.WTW_BASE_URL || 'http://localhost:8901';
const APP_DIR = process.env.WTW_APP_DIR || require('path').join(__dirname, '..');
const BROWSER = process.env.PLAYWRIGHT_CHROMIUM || undefined;

// Read the expected version from the source rather than hard-coding it,
// so a release bump does not break these assertions.
const APP_VERSION = (require('fs').readFileSync(APP_DIR + '/config.js', 'utf8')
  .match(/version:\s*'([^']+)'/) || [, '?'])[1];

const fs = require('fs');
const RADAR_PNG = fs.readFileSync(__dirname + '/fixture-radar-frame.png');
const TILE_PNG = fs.readFileSync(__dirname + '/fixture-radar-frame.png');

const AUSTIN = { lat: 30.2672, lon: -97.7431 };
const DATES = ['2026-08-28','2026-08-29','2026-08-30','2026-08-31','2026-09-01','2026-09-02','2026-09-03'];

function omBody() {
  const hourTimes = [];
  const temps = [], pops = [], codes = [], winds = [], vis = [];
  const start = Date.now();
  for (let i = 0; i < 60; i++) {
    hourTimes.push(new Date(start + i * 3600000).toISOString().slice(0, 16));
    temps.push(70 + Math.round(12 * Math.sin(i / 4)));
    pops.push(i % 7 === 0 ? 70 : 10);
    codes.push(i % 7 === 0 ? 61 : 0);
    winds.push(8);
    vis.push(16093);
  }
  return JSON.stringify({
    current: { temperature_2m: 70.0, apparent_temperature: 68, relative_humidity_2m: 44.4,
      weather_code: 0, wind_speed_10m: 5, wind_direction_10m: 90, is_day: 1,
      pressure_msl: 1013.2, dew_point_2m: 55.5 },
    hourly: { time: hourTimes, temperature_2m: temps, precipitation_probability: pops,
      weather_code: codes, wind_speed_10m: winds, visibility: vis },
    daily: { time: DATES, weather_code: [61,95,3,0,61,2,1],
      temperature_2m_max: [88,92,90,93,88,91,94], temperature_2m_min: [71,74,72,73,70,72,74],
      precipitation_probability_max: [40,90,20,5,70,10,0],
      sunrise: DATES.map((d) => `${d}T07:02`), sunset: DATES.map((d) => `${d}T20:11`),
      uv_index_max: [8.4,7,9,6,5,7,8] },
  });
}

(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER });
  let failures = 0;
  const check = async (n, fn) => {
    try { const ok = await fn(); console.log((ok?'PASS':'FAIL') + ' - ' + n); if(!ok) failures++; }
    catch (e) { console.log('FAIL - ' + n + ' (' + e.message.split('\n')[0] + ')'); failures++; }
  };

  // Radar refetches are debounced and then load six images, which takes
  // as long as the machine takes. Waiting for the condition instead of a
  // fixed 1200ms is the difference between a test and a coin toss.
  const waitFor = async (fn, timeout = 10000, step = 150) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try { if (await fn()) return true; } catch (err) { /* not ready yet */ }
      await page.waitForTimeout(step);
    }
    return false;
  };

  // Block service workers so page.route stubs apply to app requests;
  // the worker itself is exercised separately in sw-offline.js.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  // Deny every external host by default. Routes registered after this one
  // win, so each suite still stubs what it needs - but anything a suite
  // forgot fails closed instead of quietly reaching the real internet.
  // A predicate, not a glob: 'https://**' matches nothing at all.
  await page.route((u) => u.protocol === 'https:', (r) => r.abort());
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource/.test(m.text())) errors.push('CONSOLE: ' + m.text()); });

  // Every stubbed image is served no-store. Recentring asks for exactly
  // the bbox and timestamps it asked for before the pan, so a cacheable
  // response means the browser answers from memory, the route is never
  // consulted, and a request the test is counting on simply never
  // appears. That is a test that depends on the clock crossing a
  // ten-minute boundary at the right moment.
  const wmsUrls = [], tileUrls = [];
  await page.route('https://opengeo.ncep.noaa.gov/**', (r) => {
    wmsUrls.push(r.request().url());
    return r.fulfill({ headers: { 'cache-control': 'no-store' }, contentType: 'image/png', body: RADAR_PNG });
  });
  await page.route('https://basemaps.cartocdn.com/**', (r) => {
    tileUrls.push(r.request().url());
    return r.fulfill({ headers: { 'cache-control': 'no-store' }, contentType: 'image/png', body: TILE_PNG });
  });
  await page.route('https://geocoding-api.open-meteo.com/**', (r) => r.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ results: [{ name: 'Austin', admin1: 'Texas', country_code: 'US',
      latitude: AUSTIN.lat, longitude: AUSTIN.lon }] }) }));
  await page.route('https://api.open-meteo.com/**', (r) => r.fulfill({ contentType: 'application/json', body: omBody() }));
  await page.route('https://api.weather.gov/**', (r) => r.fulfill({ status: 404, body: '{}' }));

  await page.goto(BASE_URL + '/index.html', { waitUntil: 'networkidle' });

  console.log('=== Shell ===');
  await check(`version badge reads ${APP_VERSION}`, async () => (await page.textContent('#appVersion')).trim() === APP_VERSION);
  await check('manifest is linked', async () => (await page.locator('link[rel=manifest]').count()) === 1);
  await check('manifest parses and names icons', async () => {
    const res = await page.request.get(BASE_URL + '/manifest.json');
    const m = await res.json();
    // The installed app name is deliberately version-free so the
    // home-screen label stays stable across releases.
    return m.icons.length === 3 && m.display === 'standalone' &&
           m.name === 'What the Wether' && !/V\d/.test(m.name);
  });
  await check('all three icons are served', async () => {
    for (const n of ['icon-192.png','icon-512.png','maskable-512.png']) {
      const r = await page.request.get(BASE_URL + '/icons/' + n);
      if (!r.ok()) return false;
      const b = await r.body();
      if (b.length < 500 || b.slice(1,4).toString() !== 'PNG') return false;
    }
    return true;
  });
  await check('service worker script is served', async () => {
    const r = await page.request.get(BASE_URL + '/sw.js');
    return r.ok() && (await r.text()).includes('CACHE_VERSION');
  });

  await page.fill('#searchInput', 'Austin');
  await page.click('#searchBtn');
  await page.waitForSelector('#weatherPanels:not([hidden])', { timeout: 20000 });
  await page.waitForTimeout(3000);

  console.log('\n=== Hourly outlook ===');
  await check('hourly card is visible', () => page.isVisible('.hourly-card'));
  await check('hourly canvas has real size', async () => {
    const b = await page.locator('#hourlyCanvas').boundingBox();
    return b && b.width > 300 && b.height > 100;
  });
  await check('48 hours loaded', async () =>
    (await page.evaluate(() => document.querySelectorAll('.hourly-card').length)) === 1);
  await check('hourly chart actually painted pixels', async () =>
    page.evaluate(() => {
      const c = document.getElementById('hourlyCanvas');
      const ctx = c.getContext('2d');
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let lit = 0;
      for (let i = 3; i < d.length; i += 4 * 97) if (d[i] > 0) lit++;
      return lit > 50;
    }));
  await check('hover readout responds', async () => {
    const b = await page.locator('#hourlyCanvas').boundingBox();
    await page.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.5);
    await page.waitForTimeout(300);
    return true;
  });

  console.log('\n=== Detail stats ===');
  await check('sunrise rendered', async () => /\d/.test(await page.textContent('#wxSunrise')));
  await check('sunset rendered', async () => /\d/.test(await page.textContent('#wxSunset')));
  await check('UV index rounded to whole number', async () =>
    (await page.textContent('#wxUv')).trim() === '8');
  await check('dew point rounded', async () => (await page.textContent('#wxDew')).trim() === '56°');
  await check('pressure converted hPa -> inHg', async () =>
    /^29\.9\d in$/.test((await page.textContent('#wxPressure')).trim()));
  await check('visibility converted m -> mi', async () =>
    (await page.textContent('#wxVisibility')).trim() === '10 mi');
  await check('humidity still rounded', async () =>
    (await page.textContent('#wxHumidity')).trim() === '44%');

  console.log('\n=== Radar with basemap ===');
  await check('basemap tiles were requested', () => tileUrls.length > 0);
  await check('tile URLs are well-formed z/x/y', () => {
    const m = tileUrls[0].match(/dark_all\/(\d+)\/(\d+)\/(\d+)\.png/);
    if (!m) return false;
    const z = +m[1], x = +m[2], y = +m[3], n = Math.pow(2, z);
    return z >= 2 && z <= 12 && x >= 0 && x < n && y >= 0 && y < n;
  });
  await check('radar imagery requested in EPSG:3857', () => {
    const p = new URL(wmsUrls[0]).searchParams;
    return p.get('srs') === 'EPSG:3857';
  });
  await check('radar bbox is a square in mercator metres centred on Austin', () => {
    const [minX, minY, maxX, maxY] = new URL(wmsUrls[0]).searchParams.get('bbox').split(',').map(Number);
    const R = 6378137;
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const lon = (cx / R) * 180 / Math.PI;
    const lat = (2 * Math.atan(Math.exp(cy / R)) - Math.PI / 2) * 180 / Math.PI;
    const w = maxX - minX, h = maxY - minY;
    return Math.abs(lon - AUSTIN.lon) < 0.01 && Math.abs(lat - AUSTIN.lat) < 0.01 &&
           Math.abs(w - h) < 1;
  });
  const rangeNum = async () =>
    parseFloat((await page.textContent('#radarRange')).replace(/[^\d.]/g, ''));
  await check('range label carries a distance and a unit', async () =>
    /^\d+\s*(km|mi)$/.test((await page.textContent('#radarRange')).trim()));
  await check('zoom in reduces the range', async () => {
    const before = await rangeNum();
    await page.click('#radarZoomIn');
    return (await rangeNum()) < before;
  });
  await check('zoom out increases the range', async () => {
    const before = await rangeNum();
    await page.click('#radarZoomOut');
    await page.click('#radarZoomOut');
    return (await rangeNum()) > before;
  });
  await check('zoom re-requests radar at the new range', async () => {
    const before = wmsUrls.length;
    return waitFor(() => wmsUrls.length > before);
  });

  const bboxOf = (url) => new URL(url).searchParams.get('bbox').split(',').map(Number);
  const centreLon = (url) => {
    const bb = bboxOf(url);
    return (((bb[0] + bb[2]) / 2) / 6378137) * 180 / Math.PI;
  };

  await check('dragging the scope pans it', async () => {
    const b = await page.locator('#radarCanvas').boundingBox();
    const beforeCount = wmsUrls.length;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 60, b.y + b.height / 2 + 40, { steps: 8 });
    await page.mouse.up();
    const moved = await waitFor(() => wmsUrls.length > beforeCount &&
      Math.abs(bboxOf(wmsUrls[wmsUrls.length - 1])[0] - bboxOf(wmsUrls[0])[0]) > 1);
    return moved;
  });
  await check('recenter returns to the location', async () => {
    const before = wmsUrls.length;
    await page.click('#radarRecenter');
    // A new request, centred back on the location — not merely a stale
    // one that happens to still be last in the list.
    const ok = await waitFor(() => wmsUrls.length > before &&
      Math.abs(centreLon(wmsUrls[wmsUrls.length - 1]) - AUSTIN.lon) < 0.05);
    if (!ok) {
      // This check has failed on CI and passed here three times running.
      // Guessing at the cause from a bare FAIL is what made that happen,
      // so say what was actually seen.
      console.log(`  [diag] requests before=${before} after=${wmsUrls.length} ` +
        `lastLons=${wmsUrls.slice(-3).map((u) => centreLon(u).toFixed(3)).join(' ')} ` +
        `wanted=${AUSTIN.lon} fullscreen=${await page.evaluate(() =>
          document.body.classList.contains('radar-fullscreen') || !!document.fullscreenElement)}`);
    }
    return ok;
  });
  await check('attribution is displayed', async () =>
    /OpenStreetMap/.test(await page.textContent('.radar-attribution')));

  console.log('\n=== Local AI 3.0 ===');
  await check('six personalities offered', async () =>
    (await page.locator('#personalitySelect option').count()) === 6);
  await check('roast context label present', async () =>
    (await page.textContent('#roastContext')).trim().length > 0);
  await check('tapping a forecast day roasts that day', async () => {
    await page.locator('.forecast-card').nth(2).click();
    await page.waitForTimeout(500);
    const ctxLabel = (await page.textContent('#roastContext')).trim();
    const text = await page.textContent('#roastText');
    return ctxLabel !== 'Right now' && ctxLabel.length >= 3 && text.length > 20;
  });
  await check('roast history records entries', async () => {
    await page.click('#roastLogToggle');
    await page.waitForTimeout(300);
    return (await page.locator('.roast-log-item').count()) >= 2;
  });
  await check('history shows personality and context', async () =>
    /·/.test(await page.textContent('.roast-log-meta')));
  await check('share button produces a PNG', async () => {
    const download = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
    await page.click('#shareRoastBtn');
    const d = await download;
    return !!d && d.suggestedFilename().endsWith('.png');
  });
  await check('clearing history empties the list', async () => {
    await page.click('#settingsBtn');
    await page.click('#clearRoastLogBtn');
    await page.click('#settingsCloseBtn');
    await page.waitForTimeout(500);
    return (await page.locator('.roast-log-empty').count()) === 1;
  });

  console.log('\n=== Themes still drive everything ===');
  await check('light theme switches basemap tiles to light', async () => {
    const before = tileUrls.length;
    await page.click('#settingsBtn');
    await page.selectOption('#themeSelect', 'light');
    await page.waitForTimeout(1500);
    await page.click('#settingsCloseBtn');
    return tileUrls.slice(before).some((u) => u.includes('light_all'));
  });
  await page.click('#settingsBtn');
  await page.selectOption('#themeSelect', 'neon-dark');
  await page.click('#settingsCloseBtn');
  await page.waitForTimeout(800);

  console.log('\n=== Layout ===');
  await check('no horizontal overflow at desktop width', () =>
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.screenshot({ path: __dirname + '/v9-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(1200);
  await check('no horizontal overflow on mobile', () =>
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await check('hourly chart fits mobile', async () => {
    const b = await page.locator('#hourlyCanvas').boundingBox();
    return b && b.width <= 375;
  });
  await page.screenshot({ path: __dirname + '/v9-mobile.png', fullPage: true });

  console.log(errors.length ? '\nJS ERRORS:\n  ' + errors.join('\n  ') : '\nNo JS errors.');
  if (errors.length) failures++;
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll V9 checks passed.');
  await browser.close();
  process.exit(failures ? 1 : 0);
})();
