/* V16: today in context.

   The Open-Meteo request now asks for past_days=1, which prepends
   yesterday to every daily array. Every index into those arrays moved
   as a result, so most of this suite is about proving today is still
   today — a fixture where yesterday's numbers are unmistakably
   different from today's would make an off-by-one obvious rather than
   plausible. */
const { chromium } = require('playwright');
const BASE_URL = process.env.WTW_BASE_URL || 'http://localhost:8901';
const APP_DIR = process.env.WTW_APP_DIR || require('path').join(__dirname, '..');
const BROWSER = process.env.PLAYWRIGHT_CHROMIUM || undefined;
const fs = require('fs');
const PNG = fs.readFileSync(__dirname + '/fixture-radar-frame.png');
const APP_VERSION = (fs.readFileSync(APP_DIR + '/config.js', 'utf8')
  .match(/version:\s*'([^']+)'/) || [])[1];

const AUSTIN = { lat: 30.2672, lon: -97.7431 };

function isoDate(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/* Yesterday is deliberately far colder than today: 62 against 80, so a
   comparison reading 18° warmer can only have come from the right two
   numbers. The forecast days after today climb by one each, so a
   forecast row starting on the wrong day is visible too. */
function omBody({ pastDays = 1, yesterdayHigh = 62 } = {}) {
  const time = [], max = [], min = [], code = [], pop = [], sunrise = [], sunset = [], uv = [];
  if (pastDays) {
    time.push(isoDate(-1)); max.push(yesterdayHigh); min.push(50); code.push(61);
    pop.push(90); sunrise.push(isoDate(-1) + 'T06:00'); sunset.push(isoDate(-1) + 'T18:00');
    uv.push(2);
  }
  for (let i = 0; i < 7; i++) {
    time.push(isoDate(i));
    max.push(80 + i);           // today 80, tomorrow 81, …
    min.push(65 + i);
    code.push(0);
    pop.push(10 + i);
    sunrise.push(isoDate(i) + 'T07:11');
    sunset.push(isoDate(i) + 'T19:44');
    uv.push(7);
  }

  // Hourly covers yesterday and today. Yesterday's visibility is a very
  // different number from now's, so taking the wrong hour shows up.
  const hTime = [], temp = [], hPop = [], hCode = [], wind = [], vis = [];
  const start = new Date();
  start.setHours(start.getHours() - 24, 0, 0, 0);
  for (let i = 0; i < 72; i++) {
    const when = new Date(start.getTime() + i * 3600000);
    hTime.push(when.toISOString().slice(0, 16));
    temp.push(70);
    hPop.push(5);
    hCode.push(0);
    wind.push(6);
    vis.push(when.getTime() < Date.now() - 3600000 ? 1609 : 16093);   // 1 mi vs 10 mi
  }

  return JSON.stringify({
    current: { temperature_2m: 78, apparent_temperature: 80, relative_humidity_2m: 44,
               weather_code: 0, wind_speed_10m: 9, wind_direction_10m: 180, is_day: 1,
               pressure_msl: 1015, dew_point_2m: 55 },
    hourly: { time: hTime, temperature_2m: temp, precipitation_probability: hPop,
              weather_code: hCode, wind_speed_10m: wind, visibility: vis },
    daily: { time, weather_code: code, temperature_2m_max: max, temperature_2m_min: min,
             precipitation_probability_max: pop, sunrise, sunset, uv_index_max: uv },
  });
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
    const asked = [];
    await page.route('https://api.open-meteo.com/**', (r) => {
      asked.push(r.request().url());
      return r.fulfill({ contentType: 'application/json', body: omBody(opts) });
    });
    await page.route('https://geocoding-api.open-meteo.com/**', (r) => r.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ results: [{ name: 'Austin', admin1: 'Texas', country_code: 'US',
        latitude: AUSTIN.lat, longitude: AUSTIN.lon }] }) }));
    // NWS out of the way: this is about the Open-Meteo path.
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
    return { ctx, page, asked, errors };
  };

  console.log(`=== Version ===`);
  let { ctx, page, asked, errors } = await mk();
  await check(`badge reads ${APP_VERSION}`, async () =>
    (await page.textContent('#appVersion')).trim() === APP_VERSION);

  console.log('\n=== Yesterday is asked for, and used ===');
  await check('the forecast request asks for a past day', () =>
    asked.some((u) => /past_days=1/.test(u)));
  await check('the comparison is shown', async () =>
    await page.isVisible('#wxYesterday'));
  await check('it compares the two highs, not two arbitrary numbers', async () =>
    (await page.textContent('#wxYesterday')).trim() === '18°F warmer than yesterday');
  await check("the tooltip gives yesterday's high", async () =>
    /62°F/.test(await page.getAttribute('#wxYesterday', 'title')));

  console.log('\n=== Today is still today ===');
  await check("today's high and low are today's", async () =>
    /80/.test(await page.textContent('#wxHiLo')) &&
    /65/.test(await page.textContent('#wxHiLo')));
  await check('the forecast row starts today, not yesterday', async () => {
    const first = await page.textContent('.forecast-card:first-child');
    return /Today/.test(first) && /80/.test(first) && !/62/.test(first);
  });
  await check('the row still holds seven days', async () =>
    (await page.locator('.forecast-card').count()) === 7);
  await check('the last card is six days out, not five', async () => {
    const last = await page.textContent('.forecast-card:last-child');
    return /86/.test(last);
  });
  await check("sunrise and sunset are today's", async () =>
    /7:11/.test(await page.textContent('#wxSunrise')) &&
    /7:44/.test(await page.textContent('#wxSunset')));
  await check("the UV index is today's, not yesterday's", async () =>
    (await page.textContent('#wxUv')).trim() === '7');
  await check('visibility comes from the hour nearest now', async () =>
    /10/.test(await page.textContent('#wxVisibility')));

  console.log('\n=== A difference is not a temperature ===');
  await check('the delta converts as a delta in metric', async () => {
    await page.click('#settingsBtn');
    await page.selectOption('#unitsSelect', 'metric');
    await page.waitForTimeout(600);
    await page.click('#settingsCloseBtn');
    // 18°F of difference is 10°C of difference — not the -8°C that
    // running the delta through a temperature conversion would give.
    return (await page.textContent('#wxYesterday')).trim() === '10°C warmer than yesterday';
  });
  await check('and back again in imperial', async () => {
    await page.click('#settingsBtn');
    await page.selectOption('#unitsSelect', 'imperial');
    await page.waitForTimeout(600);
    await page.click('#settingsCloseBtn');
    return (await page.textContent('#wxYesterday')).trim() === '18°F warmer than yesterday';
  });
  await ctx.close();

  console.log('\n=== Nothing to compare with says nothing ===');
  ({ ctx, page, errors } = await mk({ pastDays: 0 }));
  await check('no comparison line when the past day is missing', async () =>
    !(await page.isVisible('#wxYesterday')));
  await check("today's numbers are unaffected", async () =>
    /80/.test(await page.textContent('#wxHiLo')));
  await ctx.close();

  console.log('\n=== A day within a degree is not news ===');
  ({ ctx, page, errors } = await mk({ yesterdayHigh: 80.4 }));
  await check('a sub-degree difference reads as about the same', async () =>
    /about the same/i.test(await page.textContent('#wxYesterday')));
  await ctx.close();

  console.log('\n=== Radar legend ===');
  ({ ctx, page, errors } = await mk());
  await check('the legend is shown with both ends labelled', async () => {
    const text = await page.textContent('#radarLegend');
    return await page.isVisible('#radarLegend') &&
           /Light/.test(text) && /Heavy/.test(text);
  });
  await check('it says what it is describing', async () =>
    /radar colours/i.test(await page.getAttribute('#radarLegend', 'title')));
  await check('the timeline does not say NOW twice over', async () =>
    !(await page.isVisible('#radarTimelineEnd')));
  await check('no horizontal overflow at desktop width', async () =>
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await check('no horizontal overflow on mobile', async () => {
    await page.setViewportSize({ width: 375, height: 780 });
    await page.waitForTimeout(700);
    return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  });
  await check('no JS errors', () => errors.length === 0);
  if (errors.length) console.log(errors.join('\n'));
  await ctx.close();

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll V16 checks passed.');
  await browser.close();
  process.exit(failures ? 1 : 0);
})();
