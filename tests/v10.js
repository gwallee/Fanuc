/* V10: click-to-fullscreen radar. */
const { chromium } = require('playwright');
const BASE_URL = process.env.WTW_BASE_URL || 'http://localhost:8901';
const APP_DIR = process.env.WTW_APP_DIR || require('path').join(__dirname, '..');
const BROWSER = process.env.PLAYWRIGHT_CHROMIUM || undefined;

// Read the expected version from the source rather than hard-coding it,
// so a release bump does not break these assertions.
const APP_VERSION = (require('fs').readFileSync(APP_DIR + '/config.js', 'utf8')
  .match(/version:\s*'([^']+)'/) || [, '?'])[1];

const fs = require('fs');
const PNG = fs.readFileSync(__dirname + '/fixture-radar-frame.png');
const AUSTIN = { lat: 30.2672, lon: -97.7431 };
const DATES = ['2026-08-28','2026-08-29','2026-08-30','2026-08-31','2026-09-01','2026-09-02','2026-09-03'];

function omBody() {
  const t = [], temps = [], pops = [], codes = [], winds = [], vis = [];
  const start = Date.now();
  for (let i = 0; i < 50; i++) {
    t.push(new Date(start + i * 3600000).toISOString().slice(0, 16));
    temps.push(70 + Math.round(10 * Math.sin(i / 4))); pops.push(10); codes.push(0);
    winds.push(8); vis.push(16093);
  }
  return JSON.stringify({
    current: { temperature_2m: 70, apparent_temperature: 68, relative_humidity_2m: 44,
      weather_code: 0, wind_speed_10m: 5, wind_direction_10m: 90, is_day: 1,
      pressure_msl: 1013.2, dew_point_2m: 55.5 },
    hourly: { time: t, temperature_2m: temps, precipitation_probability: pops,
      weather_code: codes, wind_speed_10m: winds, visibility: vis },
    daily: { time: DATES, weather_code: [0,0,0,0,0,0,0],
      temperature_2m_max: [88,88,88,88,88,88,88], temperature_2m_min: [70,70,70,70,70,70,70],
      precipitation_probability_max: [10,10,10,10,10,10,10],
      sunrise: DATES.map(d=>`${d}T07:02`), sunset: DATES.map(d=>`${d}T20:11`),
      uv_index_max: [8,8,8,8,8,8,8] } });
}

(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER });
  let failures = 0;
  const check = async (n, fn) => {
    try { const ok = await fn(); console.log((ok?'PASS':'FAIL') + ' - ' + n); if(!ok) failures++; }
    catch (e) { console.log('FAIL - ' + n + ' (' + e.message.split('\n')[0] + ')'); failures++; }
  };

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  // Deny every external host by default. Routes registered after this one
  // win, so each suite still stubs what it needs - but anything a suite
  // forgot fails closed instead of quietly reaching the real internet.
  // A predicate, not a glob: 'https://**' matches nothing at all.
  await page.route((u) => u.protocol === 'https:', (r) => r.abort());
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_TUNNEL|ERR_FAILED|net::/.test(m.text())) errors.push('CONSOLE: ' + m.text()); });

  const wmsUrls = [];
  await page.route('https://opengeo.ncep.noaa.gov/**', (r) => { wmsUrls.push(r.request().url()); return r.fulfill({ headers: { 'cache-control': 'no-store' }, contentType: 'image/png', body: PNG }); });
  await page.route('https://basemaps.cartocdn.com/**', (r) => r.fulfill({ headers: { 'cache-control': 'no-store' }, contentType: 'image/png', body: PNG }));
  await page.route('https://geocoding-api.open-meteo.com/**', (r) => r.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ results: [{ name: 'Austin', admin1: 'Texas', country_code: 'US', latitude: AUSTIN.lat, longitude: AUSTIN.lon }] }) }));
  await page.route('https://api.open-meteo.com/**', (r) => r.fulfill({ contentType: 'application/json', body: omBody() }));
  await page.route('https://api.weather.gov/**', (r) => r.fulfill({ status: 404, body: '{}' }));

  await page.goto(BASE_URL + '/index.html', { waitUntil: 'networkidle' });
  await page.fill('#searchInput', 'Austin');
  await page.click('#searchBtn');
  await page.waitForSelector('#weatherPanels:not([hidden])', { timeout: 20000 });
  await page.waitForTimeout(2500);

  const canvasSize = async () => (await page.locator('#radarCanvas').boundingBox()).width;

  console.log('=== Version ===');
  await check(`badge reads ${APP_VERSION}`, async () => (await page.textContent('#appVersion')).trim() === APP_VERSION);
  await check(`footer reads ${APP_VERSION}`, async () => (await page.textContent('#appVersionFooter')).trim() === APP_VERSION);

  console.log('\n=== Click the scope to go fullscreen ===');
  const before = await canvasSize();
  await check('scope is exposed as an activatable control', async () =>
    (await page.getAttribute('#radarCanvas', 'role')) === 'button' &&
    (await page.getAttribute('#radarCanvas', 'tabindex')) === '0');
  await check('clicking the scope enters fullscreen', async () => {
    await page.locator('#radarCanvas').click();
    await page.waitForTimeout(700);
    return page.evaluate(() => document.getElementById('radarCard').classList.contains('fullscreen'));
  });
  await check('page scroll is locked behind it', async () =>
    page.evaluate(() => document.body.classList.contains('radar-fullscreen')));
  await check('scope actually grows', async () => (await canvasSize()) > before + 80);
  await check('scope fits the viewport', async () => {
    const b = await page.locator('#radarCanvas').boundingBox();
    return b.width <= 1280 && b.height <= 900;
  });
  await check('controls remain reachable in fullscreen', async () =>
    (await page.isVisible('#radarPlayBtn')) && (await page.isVisible('#radarTimeline')) &&
    (await page.isVisible('#radarRecenter')));
  await check('button label flips to exit', async () =>
    /Exit/.test(await page.textContent('#radarFullscreenBtn')));
  await check('attribution still displayed', () => page.isVisible('.radar-attribution'));
  await page.screenshot({ path: __dirname + '/v10-fullscreen.png' });

  console.log('\n=== Leaving fullscreen ===');
  await check('clicking the scope again exits', async () => {
    await page.locator('#radarCanvas').click();
    await page.waitForTimeout(700);
    return page.evaluate(() => !document.getElementById('radarCard').classList.contains('fullscreen'));
  });
  await check('scope returns to its inline size', async () => (await canvasSize()) <= before + 2);
  await check('scroll lock released', async () =>
    page.evaluate(() => !document.body.classList.contains('radar-fullscreen')));

  await check('the toolbar button also toggles it', async () => {
    await page.click('#radarFullscreenBtn');
    await page.waitForTimeout(600);
    const on = await page.evaluate(() => document.getElementById('radarCard').classList.contains('fullscreen'));
    await page.click('#radarFullscreenBtn');
    await page.waitForTimeout(600);
    const off = await page.evaluate(() => !document.getElementById('radarCard').classList.contains('fullscreen'));
    return on && off;
  });
  await check('Escape exits fullscreen', async () => {
    await page.locator('#radarCanvas').click();
    await page.waitForTimeout(600);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    return page.evaluate(() => !document.getElementById('radarCard').classList.contains('fullscreen'));
  });
  await check('keyboard activation works (Enter on the scope)', async () => {
    await page.locator('#radarCanvas').focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);
    const on = await page.evaluate(() => document.getElementById('radarCard').classList.contains('fullscreen'));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    return on;
  });

  console.log('\n=== Dragging must NOT trigger fullscreen ===');
  await check('a drag pans instead of opening fullscreen', async () => {
    const b = await page.locator('#radarCanvas').boundingBox();
    const n = wmsUrls.length;
    await page.mouse.move(b.x + b.width/2, b.y + b.height/2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width/2 + 70, b.y + b.height/2 + 30, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(1300);
    const fsOpen = await page.evaluate(() => document.getElementById('radarCard').classList.contains('fullscreen'));
    return !fsOpen && wmsUrls.length > n;   // panned, did not go fullscreen
  });
  await check('a tiny jitter still counts as a tap', async () => {
    const b = await page.locator('#radarCanvas').boundingBox();
    await page.mouse.move(b.x + b.width/2, b.y + b.height/2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width/2 + 2, b.y + b.height/2 + 1, { steps: 2 });
    await page.mouse.up();
    await page.waitForTimeout(700);
    const on = await page.evaluate(() => document.getElementById('radarCard').classList.contains('fullscreen'));
    if (on) { await page.keyboard.press('Escape'); await page.waitForTimeout(500); }
    return on;
  });

  console.log('\n=== Fullscreen on a phone viewport ===');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(900);
  await check('enters fullscreen on mobile', async () => {
    await page.locator('#radarCanvas').click();
    await page.waitForTimeout(800);
    return page.evaluate(() => document.getElementById('radarCard').classList.contains('fullscreen'));
  });
  await check('scope fits a 375px screen', async () => {
    const b = await page.locator('#radarCanvas').boundingBox();
    return b.width <= 375 && b.width > 200;
  });
  await check('no horizontal overflow in fullscreen', async () =>
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await check('controls still reachable on mobile fullscreen', async () =>
    page.isVisible('#radarPlayBtn'));
  await page.screenshot({ path: __dirname + '/v10-fullscreen-mobile.png' });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);

  console.log('\n=== Storage migration ===');
  await check('V9 data is migrated to the neutral namespace', async () => {
    const ctx2 = await browser.newContext({ serviceWorkers: 'block' });
    const p2 = await ctx2.newPage();
    // Deny every external host by default. Routes registered after this one
    // win, so each suite still stubs what it needs - but anything a suite
    // forgot fails closed instead of quietly reaching the real internet.
    // A predicate, not a glob: 'https://**' matches nothing at all.
    await p2.route((u) => u.protocol === 'https:', (r) => r.abort());
    await p2.route('https://api.open-meteo.com/**', (r) => r.fulfill({ contentType: 'application/json', body: omBody() }));
    await p2.route('https://api.weather.gov/**', (r) => r.fulfill({ status: 404, body: '{}' }));
    await p2.route('https://opengeo.ncep.noaa.gov/**', (r) => r.abort());
    await p2.route('https://basemaps.cartocdn.com/**', (r) => r.abort());
    await p2.goto(BASE_URL + '/index.html');
    await p2.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('wtw9:settings', JSON.stringify({ username: 'LegacyUser', personality: 'brutal', theme: 'midnight', autoRoast: true }));
      localStorage.setItem('wtw9:favorites', JSON.stringify([{ name: 'Old Town, TX', lat: 30.1, lon: -97.1 }]));
    });
    await p2.reload({ waitUntil: 'networkidle' });
    await p2.waitForTimeout(2000);
    const name = await p2.textContent('.brand-greeting strong');
    const favs = await p2.locator('.fav-item').count();
    const theme = await p2.getAttribute('html', 'data-theme');
    await ctx2.close();
    return name === 'LegacyUser' && favs === 1 && theme === 'midnight';
  });

  console.log(errors.length ? '\nJS ERRORS:\n  ' + errors.join('\n  ') : '\nNo JS errors.');
  if (errors.length) failures++;
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll V10 checks passed.');
  await browser.close();
  process.exit(failures ? 1 : 0);
})();
