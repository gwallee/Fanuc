/* V26: five things asked for, and what each of them has to mean.

   A blank name is the one with teeth. "No name" is easy to implement
   as an empty string dropped into the same markup, which produces
   "Yo,  ⚡" and a bot saying "Grab the umbrella,  — the clouds…".
   Neither is better than the stand-in it replaced. So the greeting has
   to be absent rather than empty, and the roast lines have to read as
   though they never had a name in them — which means the punctuation
   that was only there to attach the name goes too.

   The rest: the bot is a panel that can be switched off entirely and
   must then generate nothing; every tile opens, including the four
   that have no hourly series and open tables instead; the radar's
   opacity, speed and frame stepping actually change what it draws; and
   the Gemini key saves and tests in one action rather than two. */
const { chromium } = require('playwright');
const BASE_URL = process.env.WTW_BASE_URL || 'http://localhost:8901';
const APP_DIR = process.env.WTW_APP_DIR || require('path').join(__dirname, '..');
const BROWSER = process.env.PLAYWRIGHT_CHROMIUM || undefined;
const fs = require('fs');
const PNG = fs.readFileSync(__dirname + '/fixture-radar-frame.png');
const APP_VERSION = (fs.readFileSync(APP_DIR + '/config.js', 'utf8')
  .match(/version:\s*'([^']+)'/) || [])[1];

const pad = (n) => String(n).padStart(2, '0');
function isoDate(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/* A RainViewer index with frames ten minutes apart, so the radar has
   something real to step through. */
function rvIndex() {
  const now = Math.floor(Date.now() / 1000);
  const base = now - 4 * 60;
  const past = [];
  for (let i = 8; i >= 0; i--) { const t = base - i * 600; past.push({ time: t, path: `/v2/radar/${t}` }); }
  const nowcast = [];
  for (let i = 1; i <= 2; i++) { const t = base + i * 600; nowcast.push({ time: t, path: `/v2/radar/nowcast_${t}` }); }
  return JSON.stringify({ version: '2.0', host: 'https://tilecache.rainviewer.com',
                          radar: { past, nowcast } });
}

function omBody() {
  const time = [], temp = [], app = [], hum = [], pop = [], prcp = [], code = [],
        wind = [], gust = [], dir = [], vis = [], pres = [], uv = [];
  for (let d = -1; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      time.push(`${isoDate(d)}T${pad(h)}:00`);
      temp.push(72); app.push(72); hum.push(50); pop.push(10); prcp.push(0);
      code.push(61); wind.push(6); gust.push(9); dir.push(180);
      vis.push(16093); pres.push(1013); uv.push(5);
    }
  }
  const dT = [], max = [], min = [], dc = [], dp = [], sums = [], gmax = [],
        sr = [], ss = [], duv = [];
  for (let d = -1; d < 7; d++) {
    dT.push(isoDate(d)); max.push(80); min.push(64); dc.push(61); dp.push(60);
    sums.push(0); gmax.push(10);
    // Day length grows by a minute a day, so the sun sheet has
    // something true to compare.
    sr.push(isoDate(d) + `T06:${pad(40 - (d + 1))}`);
    ss.push(isoDate(d) + 'T19:30'); duv.push(5);
  }
  return JSON.stringify({
    current: { temperature_2m: 72, apparent_temperature: 72, relative_humidity_2m: 50,
               weather_code: 61, wind_speed_10m: 6, wind_direction_10m: 180,
               wind_gusts_10m: 9, is_day: 1, pressure_msl: 1013,
               dew_point_2m: 50, precipitation: 0 },
    hourly: { time, temperature_2m: temp, apparent_temperature: app,
              relative_humidity_2m: hum, precipitation_probability: pop,
              precipitation: prcp, weather_code: code, wind_speed_10m: wind,
              wind_gusts_10m: gust, wind_direction_10m: dir, visibility: vis,
              pressure_msl: pres, uv_index: uv },
    daily: { time: dT, weather_code: dc, temperature_2m_max: max, temperature_2m_min: min,
             precipitation_probability_max: dp, precipitation_sum: sums,
             wind_gusts_10m_max: gmax, sunrise: sr, sunset: ss, uv_index_max: duv } });
}

(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER });
  let failures = 0;
  const check = async (n, fn) => {
    try { const ok = await fn(); console.log((ok ? 'PASS' : 'FAIL') + ' - ' + n); if (!ok) failures++; }
    catch (e) { console.log('FAIL - ' + n + ' (' + e.message.split('\n')[0] + ')'); failures++; }
  };

  const mk = async ({ aqi = null, seed = null } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 },
                                           serviceWorkers: 'block' });
    const page = await ctx.newPage();
    await page.route((u) => u.protocol === 'https:', (r) => r.abort());
    await page.route('https://api.open-meteo.com/**', (r) => r.fulfill({
      contentType: 'application/json', body: omBody() }));
    await page.route('https://archive-api.open-meteo.com/**', (r) => r.abort());
    await page.route('https://air-quality-api.open-meteo.com/**', (r) => (aqi == null
      ? r.abort()
      : r.fulfill({ contentType: 'application/json',
          body: JSON.stringify({ current: { us_aqi: aqi, pm2_5: 8, pm10: 14,
            ozone: 60, nitrogen_dioxide: 12 } }) })));
    await page.route('https://api.rainviewer.com/**', (r) => r.fulfill({
      contentType: 'application/json', body: rvIndex() }));
    await page.route('https://tilecache.rainviewer.com/**', (r) => r.fulfill({
      headers: { 'cache-control': 'no-store' }, contentType: 'image/png', body: PNG }));
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
    if (seed) await page.addInitScript((s) => {
      localStorage.setItem('wtw:settings', JSON.stringify(s));
    }, seed);
    await page.goto(BASE_URL + '/index.html', { waitUntil: 'networkidle' });
    await page.fill('#searchInput', 'Austin');
    await page.click('#searchBtn');
    await page.waitForSelector('#weatherPanels:not([hidden])', { timeout: 20000 });
    await page.waitForTimeout(1400);
    return { ctx, page, errors };
  };

  console.log('=== A name it has not been told ===');
  let { ctx, page, errors } = await mk();
  await check(`badge reads ${APP_VERSION}`, async () =>
    (await page.textContent('#appVersion')).trim() === APP_VERSION);
  await check('there is no stock name', async () =>
    (await page.textContent('.brand-greeting strong')).trim() === '');
  await check('the greeting is absent, not empty', async () =>
    // "Yo,  ⚡" is not better than "Yo, DJTheBest ⚡".
    !(await page.locator('[data-greeting]').first().isVisible()));
  await check('the settings field is empty with a plain placeholder', async () => {
    await page.click('#settingsBtn');
    await page.waitForTimeout(500);
    const value = await page.inputValue('#usernameInput');
    const ph = await page.getAttribute('#usernameInput', 'placeholder');
    return value === '' && !/DJ/i.test(ph);
  });
  await check('the bot writes lines that never had a name in them', async () => {
    // Ask for several, since only some templates carry {name}.
    await page.click('#settingsCloseBtn');
    await page.waitForTimeout(300);
    const seen = [];
    for (let i = 0; i < 12; i++) {
      await page.click('#roastBtn');
      await page.waitForTimeout(160);
      seen.push((await page.textContent('#roastText')).trim());
    }
    const bad = seen.filter((t) =>
      /\bfriend\b/i.test(t) || /,\s*[—–-]/.test(t) || /\s{2,}/.test(t) ||
      /,\s*[.!?]/.test(t) || /\{name\}/.test(t) || /^[a-z]/.test(t));
    if (bad.length) console.log('  [diag] ' + JSON.stringify(bad.slice(0, 3)));
    return seen.length === 12 && bad.length === 0;
  });
  await check('setting a name brings the greeting back', async () => {
    await page.click('#settingsBtn');
    await page.waitForTimeout(400);
    await page.fill('#usernameInput', 'Bri');
    await page.click('#usernameSaveBtn');
    await page.waitForTimeout(500);
    return (await page.textContent('.brand-greeting strong')).trim() === 'Bri' &&
           await page.locator('[data-greeting]').first().isVisible();
  });
  await ctx.close();

  console.log('\n=== The bot is optional ===');
  ({ ctx, page, errors } = await mk());
  await check('it is on out of the box', async () => {
    await page.click('#settingsBtn');
    await page.waitForTimeout(500);
    return page.isChecked('#showRoastToggle');
  });
  await check('switching it off removes the panel entirely', async () => {
    await page.uncheck('#showRoastToggle');
    await page.waitForTimeout(400);
    return !(await page.locator('.roast-inline').first().isVisible());
  });
  await check('and hides the settings that only matter to it', async () =>
    (await page.getAttribute('#autoRoastGroup', 'hidden')) !== null);
  await check('nothing is generated while it is off', async () => {
    const before = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('wtw:roastLog') || '[]').length);
    await page.click('#settingsCloseBtn');
    await page.waitForTimeout(300);
    // Reload the weather, which is what would normally auto-roast.
    await page.click('#refreshBtn');
    await page.waitForTimeout(2500);
    const after = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('wtw:roastLog') || '[]').length);
    return after === before;
  });
  await check('it stays off after a reload', async () => {
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    return !(await page.locator('.roast-inline').first().isVisible());
  });
  await check('and switching it back on brings it back', async () => {
    await page.click('#settingsBtn');
    await page.waitForTimeout(400);
    await page.check('#showRoastToggle');
    await page.waitForTimeout(600);
    return await page.locator('.roast-inline').first().isVisible();
  });
  await ctx.close();

  console.log('\n=== Every tile opens, including the ones with no curve ===');
  ({ ctx, page, errors } = await mk({ aqi: 42 }));
  await check('every visible tile is a button', async () =>
    page.evaluate(() => {
      const tiles = [...document.querySelectorAll('.tile:not([hidden])')];
      const openers = tiles.filter((t) => t.dataset.metric || t.dataset.sheet ||
        t.id === 'wxHiLoStat');
      return tiles.length > 0 && openers.length === tiles.length;
    }));
  for (const [sheet, title] of [['sun', 'Sun'], ['moon', 'Moon'],
                                ['aqi', 'Air Quality']]) {
    await check(`the ${sheet} tile opens a sheet of facts`, async () => {
      await page.click(`[data-sheet="${sheet}"]`);
      await page.waitForTimeout(600);
      const heading = (await page.textContent('#sheetTitle')).trim();
      const rows = await page.locator('#sheetRows > div').count();
      const chartHidden = await page.getAttribute('#sheetChart', 'hidden');
      await page.click('#metricSheetClose');
      await page.waitForTimeout(300);
      return heading.includes(title) && rows >= 2 && chartHidden !== null;
    });
  }
  await check('the sun sheet compares the day with the one before', async () => {
    await page.click('[data-sheet="sun"]');
    await page.waitForTimeout(600);
    const text = await page.textContent('#sheetSummary');
    await page.click('#metricSheetClose');
    return /daylight than the day before/i.test(text);
  });
  await check('the moon sheet says what it cannot tell you', async () => {
    await page.click('[data-sheet="moon"]');
    await page.waitForTimeout(600);
    const text = await page.textContent('#sheetSummary');
    await page.click('#metricSheetClose');
    // Moonrise is not published by any source this app uses, and a
    // figure that looks authoritative and is half an hour out is worse
    // than saying so.
    return /moonrise/i.test(text) && /not published/i.test(text);
  });
  await check('a reading that is not per-day offers no date strip', async () => {
    await page.click('[data-sheet="aqi"]');
    await page.waitForTimeout(600);
    const hidden = await page.getAttribute('#sheetDates', 'hidden');
    await page.click('#metricSheetClose');
    return hidden !== null;
  });
  await ctx.close();

  console.log('\n=== The radar ===');
  ({ ctx, page, errors } = await mk());
  await check('the frame being shown has a wall-clock time on it', async () => {
    await page.locator('#radarCard').scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);
    const hidden = await page.getAttribute('#radarFrameClock', 'hidden');
    const text = (await page.textContent('#radarFrameClock')).trim();
    return hidden === null && /\d/.test(text);
  });
  await check('stepping forward moves exactly one frame and pauses', async () => {
    await page.click('#radarStopBtn');
    await page.waitForTimeout(400);
    const before = await page.evaluate(() => WTWRadar.getView().frameIndex);
    await page.click('#radarStepFwd');
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => WTWRadar.getView().frameIndex);
    // "Paused" means the loop stopped advancing frames, which is what
    // the status says. isAnimating() reports the rAF loop, and that
    // also drives the sweep and the basemap — it is correct for that
    // to keep running, so it is the wrong signal to assert on.
    const status = (await page.textContent('#radarStatusText')).trim();
    // One frame forward on a loop wraps. Asserting before + 1 outright
    // fails whenever the loop happens to be sitting on the last frame,
    // which is the correct behaviour and a flaky test.
    const n = await page.evaluate(() => WTWRadar.getView().frameCount);
    const ok = after === (before + 1) % n && status === 'PAUSED';
    if (!ok) console.log(`  [diag] before=${before} after=${after} n=${n} status=${status}`);
    return ok;
  });
  await check('stepping back moves the other way', async () => {
    const before = await page.evaluate(() => WTWRadar.getView().frameIndex);
    await page.click('#radarStepBack');
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => WTWRadar.getView().frameIndex);
    const n = await page.evaluate(() => WTWRadar.getView().frameCount);
    const want = ((before - 1) % n + n) % n;
    if (after !== want) console.log(`  [diag] back before=${before} after=${after} n=${n}`);
    return after === want;
  });
  await check('and the clock follows the frame', async () => {
    const a = (await page.textContent('#radarFrameClock')).trim();
    await page.click('#radarStepFwd');
    await page.waitForTimeout(400);
    const b = (await page.textContent('#radarFrameClock')).trim();
    return a !== b;
  });
  await check('arrow keys step it when the scope has focus', async () => {
    await page.locator('#radarCanvas').focus();
    await page.waitForTimeout(200);
    const before = await page.evaluate(() => WTWRadar.getView().frameIndex);
    const n = await page.evaluate(() => WTWRadar.getView().frameCount);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(400);
    return (await page.evaluate(() => WTWRadar.getView().frameIndex)) === (before + 1) % n;
  });
  await check('the opacity slider actually changes how it is drawn', async () => {
    const before = await page.evaluate(() => WTWRadar.getView().opacity);
    await page.locator('#radarOpacity').fill('0.4');
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => WTWRadar.getView().opacity);
    const shown = (await page.textContent('#radarOpacityOut')).trim();
    return Math.abs(before - 0.85) < 0.01 && Math.abs(after - 0.4) < 0.01 && shown === '40%';
  });
  await check('the speed slider changes the loop speed', async () => {
    await page.locator('#radarSpeed').fill('2');
    await page.waitForTimeout(400);
    return (await page.evaluate(() => WTWRadar.getView().speed)) === 2 &&
           (await page.textContent('#radarSpeedOut')).trim() === '2×';
  });
  await check('both survive a reload', async () => {
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2200);
    const v = await page.evaluate(() => WTWRadar.getView());
    return Math.abs(v.opacity - 0.4) < 0.01 && v.speed === 2;
  });
  await check('no JS errors', () => errors.length === 0);
  if (errors.length) console.log(errors.join('\n'));
  await ctx.close();

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll V26 checks passed.');
  await browser.close();
  process.exit(failures ? 1 : 0);
})();
