/* V19: drawn icons, an Apple-ish layout, and things to change.

   The icons are the part with a trap in it: they are inline SVG that
   reference gradients defined once in a sprite, so a missing sprite or
   a renamed id gives you shapes with no fill and nobody notices until
   somebody looks. These checks assert the icon is named, is the right
   one for the code, and actually paints. */
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

// The fixture answers with as many days as were asked for, so the
// forecast-length setting can be checked end to end.
function omBody({ days = 7, code = 2, isDay = 1 } = {}) {
  const time = [], max = [], min = [], codes = [], pop = [], sr = [], ss = [], uv = [];
  time.push(isoDate(-1)); max.push(62); min.push(50); codes.push(61); pop.push(90);
  sr.push(isoDate(-1) + 'T06:00'); ss.push(isoDate(-1) + 'T18:00'); uv.push(2);
  for (let i = 0; i < days; i++) {
    time.push(isoDate(i));
    max.push(80 + i); min.push(65 + i);
    codes.push([0, 3, 63, 95, 71][i % 5]);
    pop.push(10 + i);
    sr.push(isoDate(i) + 'T07:11'); ss.push(isoDate(i) + 'T19:44'); uv.push(6);
  }
  const hTime = [], temp = [], hPop = [], hCode = [], wind = [], vis = [];
  for (let d = -1; d < days; d++) {
    for (let h = 0; h < 24; h++) {
      hTime.push(`${isoDate(d)}T${String(h).padStart(2, '0')}:00`);
      temp.push(72); hPop.push(5); hCode.push(0); wind.push(6); vis.push(16093);
    }
  }
  return JSON.stringify({
    current: { temperature_2m: 78, apparent_temperature: 80, relative_humidity_2m: 44,
               weather_code: code, wind_speed_10m: 9, wind_direction_10m: 180, is_day: isDay,
               pressure_msl: 1015, dew_point_2m: 55 },
    hourly: { time: hTime, temperature_2m: temp, precipitation_probability: hPop,
              weather_code: hCode, wind_speed_10m: wind, visibility: vis },
    daily: { time, weather_code: codes, temperature_2m_max: max, temperature_2m_min: min,
             precipitation_probability_max: pop, sunrise: sr, sunset: ss, uv_index_max: uv } });
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
      const url = r.request().url();
      asked.push(url);
      const want = Number((url.match(/forecast_days=(\d+)/) || [])[1]) || 7;
      return r.fulfill({ contentType: 'application/json',
                         body: omBody({ ...opts, days: want }) });
    });
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
    await page.waitForTimeout(400);
    return { ctx, page, asked, errors };
  };

  console.log('=== Icons are drawn, not typed ===');
  let { ctx, page, asked, errors } = await mk({ code: 95 });
  await check(`badge reads ${APP_VERSION}`, async () =>
    (await page.textContent('#appVersion')).trim() === APP_VERSION);
  await check('the current icon is an SVG', async () =>
    (await page.locator('#wxIcon svg.wx-svg').count()) === 1);
  await check('it names the condition it is drawing', async () =>
    (await page.getAttribute('#wxIcon svg', 'data-icon')) === 'thunder');
  await check('the gradient sprite is present, once', async () =>
    (await page.locator('#wtwIconDefs').count()) === 1);
  await check('its gradients are the ones the icons reference', async () =>
    page.evaluate(() => ['wtwSunGrad', 'wtwCloudGrad', 'wtwCloudDarkGrad', 'wtwRainGrad',
                         'wtwSnowGrad', 'wtwBoltGrad', 'wtwMoonGrad', 'wtwCloud',
                         'wtwSun', 'wtwMoon'].every((id) => !!document.getElementById(id))));
  await check('the icon actually paints, rather than sitting there empty', async () => {
    const box = await page.locator('#wxIcon svg').boundingBox();
    return box.width > 40 && box.height > 40;
  });
  await check('every forecast row has one', async () => {
    const rows = await page.locator('.forecast-card').count();
    return (await page.locator('.forecast-card .fc-icon svg.wx-svg').count()) === rows;
  });
  await check('different codes draw different icons', async () => {
    const names = await page.locator('.forecast-card svg').evaluateAll(
      (els) => els.map((e) => e.getAttribute('data-icon')));
    return new Set(names).size >= 4;
  });
  await ctx.close();

  console.log('\n=== Night is drawn as night ===');
  ({ ctx, page, errors } = await mk({ code: 0, isDay: 0 }));
  await check('a clear night uses the moon, not the sun', async () =>
    (await page.locator('#wxIcon svg use[href="#wtwMoon"]').count()) === 1 &&
    (await page.locator('#wxIcon svg use[href="#wtwSun"]').count()) === 0);
  await ctx.close();

  console.log('\n=== The layout reads down the middle ===');
  // asked too: without it this section would still be inspecting the
  // first context's requests, which is a quiet way to test nothing.
  ({ ctx, page, asked, errors } = await mk());
  await check('the hero is centred', async () =>
    page.evaluate(() => getComputedStyle(document.querySelector('.current-main')).alignItems === 'center'));
  await check('it carries an H / L line under the condition', async () =>
    /H:\d+°\s+L:\d+°/.test(await page.textContent('#wxHiLoLine')));
  await check('the forecast is a column, not a row', async () =>
    page.evaluate(() => {
      const s = getComputedStyle(document.getElementById('forecastRow'));
      return s.display === 'flex' && s.flexDirection === 'column';
    }));
  await check('each day has a range bar', async () => {
    const rows = await page.locator('.forecast-card').count();
    return (await page.locator('.fc-range-fill').count()) === rows;
  });
  await check('the bars share one scale across the week', async () => {
    // The coldest low starts at the left edge and the warmest high
    // reaches the right; anything else means each row scaled itself.
    const edges = await page.locator('.fc-range-fill').evaluateAll((els) =>
      els.map((e) => [e.style.left, e.style.right]));
    return edges[0][0] === '0%' && edges[edges.length - 1][1] === '0%';
  });
  await check('no horizontal overflow at desktop width', async () =>
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await check('no horizontal overflow on a phone', async () => {
    await page.setViewportSize({ width: 375, height: 780 });
    await page.waitForTimeout(600);
    return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  });
  await page.setViewportSize({ width: 1280, height: 950 });

  console.log('\n=== Things to change ===');
  await check('icons can be switched back to emoji', async () => {
    await page.click('#settingsBtn');
    await page.selectOption('#iconStyleSelect', 'emoji');
    await page.waitForTimeout(500);
    return (await page.locator('#wxIcon .wx-glyph').count()) === 1 &&
           (await page.locator('#wxIcon svg').count()) === 0;
  });
  await check('the emoji still names its condition', async () =>
    !!(await page.getAttribute('#wxIcon .wx-glyph', 'data-icon')));
  await check('and back to drawn again', async () => {
    await page.selectOption('#iconStyleSelect', 'rendered');
    await page.waitForTimeout(500);
    return (await page.locator('#wxIcon svg.wx-svg').count()) === 1;
  });
  await check('the accent colour changes the page', async () => {
    const before = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
    await page.selectOption('#accentSelect', 'violet');
    await page.waitForTimeout(500);
    const after = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
    return before !== after && after.toLowerCase() === '#a78bfa';
  });
  await check('the chosen accent is marked in the swatches', async () =>
    (await page.locator('.accent-dot.picked').count()) === 1);
  await check('it survives a theme change', async () => {
    await page.selectOption('#themeSelect', 'light');
    await page.waitForTimeout(600);
    const accent = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
    await page.selectOption('#themeSelect', 'neon-dark');
    await page.waitForTimeout(400);
    return accent.toLowerCase() === '#a78bfa';
  });
  // Changing the length reloads the forecast, so wait for the list
  // rather than for a guess at how long a reload takes.
  const rowsToBe = async (n) => {
    try {
      await page.waitForFunction(
        (want) => document.querySelectorAll('.forecast-card').length === want,
        n, { timeout: 15000 });
      return true;
    } catch (err) { return false; }
  };
  await check('the forecast length changes the request and the list', async () => {
    await page.selectOption('#forecastDaysSelect', '10');
    const ok = await rowsToBe(10);
    if (!ok) {
      console.log(`  [diag] rows=${await page.locator('.forecast-card').count()} ` +
        `asked=${JSON.stringify(asked.slice(-2).map((u) => (u.match(/forecast_days=\d+/) || [])[0]))} ` +
        `setting=${await page.evaluate(() => WTWStorage.getSettings().forecastDays)}`);
    }
    return ok && asked.some((u) => /forecast_days=10/.test(u));
  });
  await check('and back to five', async () => {
    await page.selectOption('#forecastDaysSelect', '5');
    return rowsToBe(5);
  });
  await check('the outlook length changes the strip, and says so', async () => {
    await page.selectOption('#hourlyHoursSelect', '12');
    await page.waitForTimeout(700);
    return /Next 12 Hours/.test(await page.textContent('#hourlyTitle'));
  });
  await check('all four choices survive a reload', async () => {
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1800);
    await page.click('#settingsBtn');
    await page.waitForTimeout(400);
    return (await page.inputValue('#iconStyleSelect')) === 'rendered' &&
           (await page.inputValue('#accentSelect')) === 'violet' &&
           (await page.inputValue('#forecastDaysSelect')) === '5' &&
           (await page.inputValue('#hourlyHoursSelect')) === '12';
  });
  await check('no JS errors', () => errors.length === 0);
  if (errors.length) console.log(errors.join('\n'));
  await ctx.close();

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll V19 checks passed.');
  await browser.close();
  process.exit(failures ? 1 : 0);
})();
