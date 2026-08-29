/* V18: a day in detail.

   Tapping a forecast card used to do one thing — roast that day — and
   now also opens the day. The roast still lands where it always did, so
   the log and the main line are unchanged; this suite is about the new
   surface and about the hours actually belonging to the day tapped. */
const { chromium } = require('playwright');
const BASE_URL = process.env.WTW_BASE_URL || 'http://localhost:8901';
const APP_DIR = process.env.WTW_APP_DIR || require('path').join(__dirname, '..');
const BROWSER = process.env.PLAYWRIGHT_CHROMIUM || undefined;
const fs = require('fs');
const PNG = fs.readFileSync(__dirname + '/fixture-radar-frame.png');
const APP_VERSION = (fs.readFileSync(APP_DIR + '/config.js', 'utf8')
  .match(/version:\s*'([^']+)'/) || [])[1];

function isoDate(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/* Each day gets its own temperature band — day 0 in the 70s, day 1 in
   the 80s, and so on — so hours shown under the wrong day are obvious
   rather than merely suspected. Day 2 is the wet one. */
function omBody({ hourlyDays = 7 } = {}) {
  const time = [], max = [], min = [], code = [], pop = [], sunrise = [], sunset = [], uv = [];
  time.push(isoDate(-1)); max.push(62); min.push(50); code.push(61); pop.push(90);
  sunrise.push(isoDate(-1) + 'T06:00'); sunset.push(isoDate(-1) + 'T18:00'); uv.push(2);
  for (let i = 0; i < 7; i++) {
    time.push(isoDate(i));
    max.push(80 + i); min.push(65 + i);
    code.push(i === 2 ? 63 : 0);
    pop.push(i === 2 ? 80 : 10);
    sunrise.push(isoDate(i) + `T0${5 + i}:15`);
    sunset.push(isoDate(i) + `T1${7 + (i % 3)}:45`);
    uv.push(3 + i);
  }

  const hTime = [], temp = [], hPop = [], hCode = [], wind = [], vis = [];
  for (let d = -1; d < hourlyDays; d++) {
    for (let hour = 0; hour < 24; hour++) {
      hTime.push(`${isoDate(d)}T${String(hour).padStart(2, '0')}:00`);
      temp.push(d < 0 ? 60 : 70 + d * 10);          // day 0 → 70s, day 1 → 80s …
      hPop.push(d === 2 ? 75 : 5);
      hCode.push(0);
      wind.push(6);
      vis.push(16093);
    }
  }

  return JSON.stringify({
    current: { temperature_2m: 78, apparent_temperature: 80, relative_humidity_2m: 44,
               weather_code: 0, wind_speed_10m: 9, wind_direction_10m: 180, is_day: 1,
               pressure_msl: 1015, dew_point_2m: 55 },
    hourly: { time: hTime, temperature_2m: temp, precipitation_probability: hPop,
              weather_code: hCode, wind_speed_10m: wind, visibility: vis },
    daily: { time, weather_code: code, temperature_2m_max: max, temperature_2m_min: min,
             precipitation_probability_max: pop, sunrise, sunset, uv_index_max: uv } });
}

(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER });
  let failures = 0;
  const check = async (n, fn) => {
    try { const ok = await fn(); console.log((ok ? 'PASS' : 'FAIL') + ' - ' + n); if (!ok) failures++; }
    catch (e) { console.log('FAIL - ' + n + ' (' + e.message.split('\n')[0] + ')'); failures++; }
  };

  const mk = async (opts = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 },
                                           serviceWorkers: 'block' });
    const page = await ctx.newPage();
    await page.route((u) => u.protocol === 'https:', (r) => r.abort());
    await page.route('https://api.open-meteo.com/**', (r) => r.fulfill({
      contentType: 'application/json', body: omBody(opts) }));
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
    return { ctx, page, errors };
  };

  console.log('=== Opening a day ===');
  let { ctx, page, errors } = await mk();
  await check(`badge reads ${APP_VERSION}`, async () =>
    (await page.textContent('#appVersion')).trim() === APP_VERSION);
  await check('the day view is closed until a day is tapped', async () =>
    !(await page.isVisible('#dayModal')));
  await check('tapping a card opens it', async () => {
    await page.locator('.forecast-card').nth(2).click();
    await page.waitForTimeout(500);
    return page.isVisible('#dayModal');
  });
  await check('it names the day it was opened from', async () => {
    const title = await page.textContent('#dayModalTitle');
    const summary = await page.textContent('#dayModalSummary');
    const expected = new Date(isoDate(2) + 'T12:00:00')
      .toLocaleDateString([], { weekday: 'short' });
    return title.includes(expected) && /Rain|Shower|Drizzle/i.test(summary);
  });

  console.log('\n=== It shows that day, not another one ===');
  await check("the facts are that day's high and low", async () => {
    const text = await page.textContent('#dayFacts');
    return /82/.test(text) && /67/.test(text);      // day 2 of 80+i / 65+i
  });
  await check("the UV is that day's", async () => {
    // Read the value, not the concatenated text: textContent runs the
    // spans together, so "UV" and "5" become "UV5" and a \b5\b never
    // matches. Facts are High, Low, Rain, UV, Sunrise, Sunset.
    const values = await page.locator('.day-fact-value').allTextContents();
    return values[3].trim() === '5';
  });
  await check("sunrise and sunset are that day's", async () => {
    const text = await page.textContent('#dayFacts');
    return /7:15/.test(text) && /7:45/.test(text);
  });
  await check('rain chance is that day’s', async () =>
    /80%/.test(await page.textContent('#dayFacts')));
  await check('the hours belong to that day and no other', async () => {
    const temps = await page.locator('.day-hour-temp').allTextContents();
    // Day 2's hourly band is the 90s in this fixture.
    return temps.length === 24 && temps.every((t) => /^9\d°$/.test(t));
  });
  await check('a wet hour is marked as wet', async () =>
    (await page.locator('.day-hour-rain.wet').count()) === 24);
  await check('the note says how many hours are shown', async () =>
    /24 hours/.test(await page.textContent('#dayHoursNote')));

  console.log('\n=== The roast still happens, and is shown where you are looking ===');
  await check('the day view carries the roast for that day', async () => {
    const inDay = (await page.textContent('#dayRoast')).trim();
    return inDay.length > 20;
  });
  await check('and the card behind it has the same line, as before', async () => {
    const inDay = (await page.textContent('#dayRoast')).trim();
    const onCard = (await page.textContent('#roastText')).trim();
    return inDay === onCard;
  });
  await check('the roast log still records it', async () => {
    await page.click('#dayModalClose');
    await page.waitForTimeout(300);
    await page.click('#roastLogToggle');
    await page.waitForTimeout(300);
    return (await page.locator('.roast-log-item').count()) >= 1;
  });

  console.log('\n=== Closing ===');
  await check('Escape closes it', async () => {
    await page.locator('.forecast-card').nth(1).click();
    await page.waitForTimeout(400);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    return !(await page.isVisible('#dayModal'));
  });
  await check('the overlay closes it', async () => {
    await page.locator('.forecast-card').nth(1).click();
    await page.waitForTimeout(400);
    // The overlay's centre is behind the dialog, so click a corner of it.
    await page.click('#dayModalOverlay', { position: { x: 6, y: 6 } });
    await page.waitForTimeout(300);
    return !(await page.isVisible('#dayModal'));
  });
  await check('opening another day replaces the first', async () => {
    await page.locator('.forecast-card').nth(4).click();
    await page.waitForTimeout(400);
    const temps = await page.locator('.day-hour-temp').allTextContents();
    return temps.every((t) => /^1\d\d°$/.test(t));   // day 4 → 110s
  });
  await check('no horizontal overflow on mobile with it open', async () => {
    await page.setViewportSize({ width: 375, height: 780 });
    await page.waitForTimeout(600);
    return page.evaluate(() =>
      document.documentElement.scrollWidth <= window.innerWidth + 1);
  });
  await ctx.close();

  console.log('\n=== A day with no hourly data says so ===');
  ({ ctx, page, errors } = await mk({ hourlyDays: 2 }));
  await check('the note explains rather than showing an empty box', async () => {
    await page.locator('.forecast-card').nth(5).click();
    await page.waitForTimeout(500);
    return (await page.locator('.day-hour').count()) === 0 &&
           /not available/i.test(await page.textContent('#dayHoursNote'));
  });
  await check("the day's own facts are still shown", async () =>
    /85/.test(await page.textContent('#dayFacts')));
  await check('no JS errors', () => errors.length === 0);
  if (errors.length) console.log(errors.join('\n'));
  await ctx.close();

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll V18 checks passed.');
  await browser.close();
  process.exit(failures ? 1 : 0);
})();
