/* V22: reading order, the hour row, and the hero off its card.

   The layout claims are the ones worth pinning, because they are the
   ones a stylesheet edit silently undoes. "Hero, then the next few
   hours, then the week" is a decision about what people came for; it
   lives in two grid-template-areas blocks and nothing else enforces
   it, so it is asserted here against real positions on screen rather
   than against DOM order — which, as this version found the hard way,
   is not the same thing at all.

   The hour row has the interesting failure modes. Sunrise and sunset
   have to land at the hour they happen rather than at the ends; the
   icons have to know night from day, or 2am gets a sun; and the first
   cell has to be Now. Each of those is wrong in a way that looks
   perfectly reasonable in a screenshot. */
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

/* Hours run from now, so the row always has a "Now" and always
   crosses a sunset — the two things it has to get right. */
function omBody({ aqi = null } = {}) {
  const hT = [], t = [], pop = [], hc = [], w = [], vis = [];
  const start = Date.now();
  for (let i = 0; i < 60; i++) {
    const at = new Date(start + i * 3600000);
    hT.push(at.toISOString().slice(0, 16));
    t.push(70 + (i % 5));
    pop.push(i % 4 === 0 ? 60 : 5);
    hc.push(0); w.push(8); vis.push(16093);
  }
  const time = [], max = [], min = [], dc = [], dp = [], sr = [], ss = [], uv = [];
  for (let d = -1; d < 7; d++) {
    time.push(isoDate(d)); max.push(80); min.push(64); dc.push(0); dp.push(20);
    sr.push(isoDate(d) + 'T06:30'); ss.push(isoDate(d) + 'T19:30'); uv.push(5);
  }
  return JSON.stringify({
    current: { temperature_2m: 72, apparent_temperature: 73, relative_humidity_2m: 60,
               weather_code: 0, wind_speed_10m: 8, wind_direction_10m: 180, is_day: 1,
               pressure_msl: 1014, dew_point_2m: 52 },
    hourly: { time: hT, temperature_2m: t, precipitation_probability: pop,
              weather_code: hc, wind_speed_10m: w, visibility: vis },
    daily: { time, weather_code: dc, temperature_2m_max: max, temperature_2m_min: min,
             precipitation_probability_max: dp, sunrise: sr, sunset: ss, uv_index_max: uv } });
}

(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER });
  let failures = 0;
  const check = async (n, fn) => {
    try { const ok = await fn(); console.log((ok ? 'PASS' : 'FAIL') + ' - ' + n); if (!ok) failures++; }
    catch (e) { console.log('FAIL - ' + n + ' (' + e.message.split('\n')[0] + ')'); failures++; }
  };

  const mk = async ({ width = 1280, height = 950, aqi = null } = {}) => {
    const ctx = await browser.newContext({ viewport: { width, height },
                                           serviceWorkers: 'block' });
    const page = await ctx.newPage();
    await page.route((u) => u.protocol === 'https:', (r) => r.abort());
    await page.route('https://api.open-meteo.com/**', (r) => r.fulfill({
      contentType: 'application/json', body: omBody() }));
    await page.route('https://air-quality-api.open-meteo.com/**', (r) => (aqi == null
      ? r.abort()
      : r.fulfill({ contentType: 'application/json',
          body: JSON.stringify({ current: { us_aqi: aqi, pm2_5: 8, pm10: 14,
            ozone: 60, nitrogen_dioxide: 12 } }) })));
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
    await page.waitForTimeout(900);
    return { ctx, page, errors };
  };

  /* Where things actually are, not where they are declared. A grid
     places by area name, so DOM order proves nothing — which is
     exactly how the reorder shipped broken the first time. */
  const tops = (page) => page.evaluate(() => {
    const out = {};
    document.querySelectorAll('main > section').forEach((s) => {
      if (s.hidden) return;
      const key = s.id || s.className.split(' ').find((c) => c.endsWith('-card') ||
        c.endsWith('-panel')) || s.className;
      out[key] = Math.round(s.getBoundingClientRect().top + window.scrollY);
    });
    return out;
  });

  console.log('=== What people came for comes first ===');
  let { ctx, page, errors } = await mk();
  await check(`badge reads ${APP_VERSION}`, async () =>
    (await page.textContent('#appVersion')).trim() === APP_VERSION);
  await check('on a wide screen: hero, then the hours, then the week', async () => {
    const t = await tops(page);
    const ok = t.hero < t.hourlyCard &&
               t.hourlyCard < t['forecast-card-panel'] &&
               t['forecast-card-panel'] < t.currentCard;
    if (!ok) console.log('  [diag] ' + JSON.stringify(t));
    return ok;
  });
  await check('the hero is not a card', async () =>
    page.evaluate(() => {
      const hero = document.getElementById('hero');
      return !hero.classList.contains('card') &&
             getComputedStyle(hero).borderTopWidth === '0px';
    }));
  await check('the city and temperature are inside it', async () =>
    page.evaluate(() => {
      const hero = document.getElementById('hero');
      return !!hero.querySelector('#wxCity') && !!hero.querySelector('#wxTemp');
    }));
  await check('and the detail card still owns the tiles and the roast', async () =>
    page.evaluate(() => {
      const card = document.getElementById('currentCard');
      return !!card.querySelector('.tile-grid') && !!card.querySelector('#roastText');
    }));
  await ctx.close();

  console.log('\n=== The same order on a phone ===');
  ({ ctx, page, errors } = await mk({ width: 390, height: 840 }));
  await check('hero, hours, week, detail', async () => {
    const t = await tops(page);
    const ok = t.hero < t.hourlyCard &&
               t.hourlyCard < t['forecast-card-panel'] &&
               t['forecast-card-panel'] < t.currentCard;
    if (!ok) console.log('  [diag] ' + JSON.stringify(t));
    return ok;
  });
  await check('a forecast row is the height of its contents, not a fixed box', async () =>
    page.evaluate(() => {
      const row = document.querySelector('.forecast-card');
      const tallest = Math.max(...[...row.children]
        .map((k) => k.getBoundingClientRect().height));
      const pad = parseFloat(getComputedStyle(row).paddingTop) * 2;
      return row.getBoundingClientRect().height <= tallest + pad + 4;
    }));
  await check('no horizontal overflow', async () =>
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await ctx.close();

  console.log('\n=== The hour row ===');
  ({ ctx, page, errors } = await mk());
  await check('it is a list, so a screen reader hears rows not numbers', async () =>
    page.evaluate(() => {
      const strip = document.getElementById('hourStrip');
      return strip.tagName === 'OL' && strip.children.length > 6 &&
             [...strip.children].every((li) => li.tagName === 'LI');
    }));
  await check('the first cell is Now', async () =>
    (await page.locator('.hour-cell').first().textContent()).includes('Now'));
  await check('every hour carries a time, a picture and a temperature', async () =>
    page.evaluate(() => [...document.querySelectorAll('.hour-cell:not(.hour-event)')]
      .every((c) => c.querySelector('.hour-label') &&
                    c.querySelector('.hour-art').children.length &&
                    /\d/.test(c.querySelector('.hour-temp').textContent))));
  await check('sunset is slotted in among the hours, not parked at an end', async () => {
    const cells = await page.locator('.hour-cell').allTextContents();
    const at = cells.findIndex((c) => /Sunset/i.test(c));
    if (at < 0) console.log('  [diag] cells: ' + JSON.stringify(cells));
    return at > 0 && at < cells.length - 1;
  });
  await check('it is labelled Sunset rather than given a temperature', async () =>
    page.evaluate(() => {
      const ev = document.querySelector('.hour-event');
      return ev && !/\d+°/.test(ev.querySelector('.hour-temp').textContent);
    }));
  await check('a rain chance worth knowing is shown, a 5% one is not', async () =>
    page.evaluate(() => {
      const pops = [...document.querySelectorAll('.hour-cell .hour-pop')]
        .map((p) => Number(p.textContent.replace('%', '')));
      return pops.length > 0 && pops.every((p) => p >= 20);
    }));
  await check('the row scrolls rather than squashing its cells', async () =>
    page.evaluate(() => {
      const wrap = document.querySelector('.hour-strip-wrap');
      const cell = document.querySelector('.hour-cell');
      return getComputedStyle(wrap).overflowX === 'auto' &&
             cell.getBoundingClientRect().width >= 50;
    }));
  await check('a night hour gets a moon, not a sun', async () =>
    page.evaluate(() => {
      // The fixture runs 60 hours from now with sunset at 19:30, so
      // there is always a night hour in the row somewhere.
      const cells = [...document.querySelectorAll('.hour-cell:not(.hour-event)')];
      const names = cells.map((c) => {
        const svg = c.querySelector('.hour-art svg[data-icon]');
        return svg ? svg.getAttribute('data-icon') : null;
      }).filter(Boolean);
      if (!names.length) return false;
      // Clear night renders the clear icon; the moon is inside it.
      const anyMoon = cells.some((c) => /wtwMoon/.test(c.querySelector('.hour-art').innerHTML));
      const anySun = cells.some((c) => /wtwSun/.test(c.querySelector('.hour-art').innerHTML));
      return anyMoon && anySun;
    }));
  await ctx.close();

  console.log('\n=== Air quality earns a tile when there is air data ===');
  ({ ctx, page, errors } = await mk({ aqi: 42 }));
  await check('the tile appears and reads the published number', async () => {
    await page.waitForTimeout(1200);
    const shown = (await page.getAttribute('#aqiTile', 'hidden')) === null;
    const value = (await page.textContent('#aqiBadge')).trim();
    return shown && value === '42';
  });
  await check('it says what 42 means', async () =>
    /good/i.test(await page.textContent('#aqiLabel')));
  await check('the dot sits low on the scale for good air', async () =>
    page.evaluate(() => {
      const dot = document.getElementById('aqiDot');
      return !dot.hidden && parseFloat(dot.style.left) < 25;
    }));
  await check('only one place writes the AQI', async () =>
    page.evaluate(() => document.querySelectorAll('#aqiBadge').length === 1));
  await ctx.close();

  console.log('\n=== And is hidden, not blank, when there is none ===');
  ({ ctx, page, errors } = await mk());
  await check('no air data, no tile', async () => {
    await page.waitForTimeout(1200);
    return (await page.getAttribute('#aqiTile', 'hidden')) !== null;
  });
  await check('no JS errors', () => errors.length === 0);
  if (errors.length) console.log(errors.join('\n'));
  await ctx.close();

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll V22 checks passed.');
  await browser.close();
  process.exit(failures ? 1 : 0);
})();
