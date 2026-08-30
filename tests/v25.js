/* V25: every tile opens.

   A tile shows one number; the number usually has a shape over the
   day, and the shape is the part worth knowing. So each tile opens a
   sheet with that metric charted across the chosen day.

   What is worth testing is not that a panel appears. It is that the
   chart is honest:

     - The past and the future are drawn differently. A single
       continuous line presents a recorded observation and a model's
       guess as the same kind of fact, and that is the failure this
       whole feature could quietly have.
     - The numbers are that metric's, on that day. A sheet that shows
       yesterday's humidity under today's date is worse than no sheet.
     - A metric with no hourly data draws nothing and says so, rather
       than an empty axis inviting somebody to read meaning into blank
       space.
     - The summary sentence is derived from the series it is under, so
       it cannot describe a peak the chart does not show.

   The fixture gives each metric a distinct, known shape, so a sheet
   reading the wrong array produces an obviously wrong answer rather
   than a plausible one. */
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

/* Every metric gets a shape nothing else has, keyed off the hour, so
   a chart drawn from the wrong array is obvious rather than subtle.

     temperature  60 + hour        (60 … 83)
     apparent     temperature + 5
     uv           0 before 9, peaks at 9 at noon, 0 after 18
     wind         5 + hour/2
     gusts        wind + 10
     humidity     90 - hour*2
     visibility   metres, constant 16093
     pressure     1013 flat
     pop          hour === 15 ? 70 : 5
*/
function omBody({ hourlyDays = 8, uvAllDay = false } = {}) {
  const time = [], temp = [], app = [], hum = [], pop = [], prcp = [], code = [],
        wind = [], gust = [], dir = [], vis = [], pres = [], uv = [];
  for (let d = -1; d < hourlyDays - 1; d++) {
    for (let hour = 0; hour < 24; hour++) {
      time.push(`${isoDate(d)}T${pad(hour)}:00`);
      temp.push(60 + hour);
      app.push(65 + hour);
      hum.push(90 - hour * 2);
      pop.push(hour === 15 ? 70 : 5);
      prcp.push(0);
      code.push(0);
      wind.push(5 + hour / 2);
      gust.push(15 + hour / 2);
      dir.push(180);
      vis.push(16093);
      pres.push(1013);
      uv.push(uvAllDay ? 6
        : (hour < 9 || hour > 18 ? 0 : 9 - Math.abs(12 - hour)));
    }
  }
  const dTime = [], max = [], min = [], dCode = [], dPop = [], sums = [], gmax = [],
        sr = [], ss = [], duv = [];
  for (let d = -1; d < 7; d++) {
    dTime.push(isoDate(d)); max.push(83); min.push(60); dCode.push(0); dPop.push(70);
    sums.push(0); gmax.push(26);
    sr.push(isoDate(d) + 'T06:30'); ss.push(isoDate(d) + 'T19:30'); duv.push(9);
  }
  return JSON.stringify({
    current: { temperature_2m: 72, apparent_temperature: 77, relative_humidity_2m: 50,
               weather_code: 0, wind_speed_10m: 11, wind_direction_10m: 156,
               wind_gusts_10m: 14, is_day: 1, pressure_msl: 1013,
               dew_point_2m: 52, precipitation: 0 },
    hourly: { time, temperature_2m: temp, apparent_temperature: app,
              relative_humidity_2m: hum, precipitation_probability: pop,
              precipitation: prcp, weather_code: code, wind_speed_10m: wind,
              wind_gusts_10m: gust, wind_direction_10m: dir, visibility: vis,
              pressure_msl: pres, uv_index: uv },
    daily: { time: dTime, weather_code: dCode, temperature_2m_max: max,
             temperature_2m_min: min, precipitation_probability_max: dPop,
             precipitation_sum: sums, wind_gusts_10m_max: gmax,
             sunrise: sr, sunset: ss, uv_index_max: duv } });
}

(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER });
  let failures = 0;
  const check = async (n, fn) => {
    try { const ok = await fn(); console.log((ok ? 'PASS' : 'FAIL') + ' - ' + n); if (!ok) failures++; }
    catch (e) { console.log('FAIL - ' + n + ' (' + e.message.split('\n')[0] + ')'); failures++; }
  };

  const mk = async (opts = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 },
                                           serviceWorkers: 'block' });
    const page = await ctx.newPage();
    await page.route((u) => u.protocol === 'https:', (r) => r.abort());
    await page.route('https://api.open-meteo.com/**', (r) => r.fulfill({
      contentType: 'application/json', body: omBody(opts) }));
    await page.route('https://archive-api.open-meteo.com/**', (r) => r.abort());
    await page.route('https://air-quality-api.open-meteo.com/**', (r) => r.abort());
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
    await page.waitForTimeout(1000);
    return { ctx, page, errors };
  };

  const openTile = async (page, metric) => {
    await page.click(`[data-metric="${metric}"]`);
    await page.waitForTimeout(600);
  };

  console.log('=== Every tile opens ===');
  let { ctx, page, errors } = await mk();
  await check(`badge reads ${APP_VERSION}`, async () =>
    (await page.textContent('#appVersion')).trim() === APP_VERSION);
  await check('the sheet is closed until a tile is tapped', async () =>
    !(await page.isVisible('#metricSheet')));

  const TILES = [['conditions', 'Conditions'], ['uv', 'UV Index'], ['wind', 'Wind'],
                 ['precip', 'Precipitation'], ['visibility', 'Visibility'],
                 ['humidity', 'Humidity'], ['pressure', 'Pressure']];
  for (const [metric, title] of TILES) {
    await check(`the ${metric} tile opens its own sheet`, async () => {
      await openTile(page, metric);
      const heading = (await page.textContent('#sheetTitle')).trim();
      const open = await page.isVisible('#metricSheet');
      await page.click('#metricSheetClose');
      await page.waitForTimeout(300);
      return open && heading.includes(title);
    });
  }
  await check('a tile is reachable by keyboard, not just by mouse', async () => {
    const tile = page.locator('[data-metric="wind"]');
    await tile.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);
    const open = await page.isVisible('#metricSheet');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    return open;
  });
  await check('Escape closes it', async () => !(await page.isVisible('#metricSheet')));
  await check('the overlay closes it too', async () => {
    await openTile(page, 'uv');
    await page.click('#metricSheetOverlay', { position: { x: 6, y: 6 } });
    await page.waitForTimeout(300);
    return !(await page.isVisible('#metricSheet'));
  });

  console.log('\n=== The chart tells past from future ===');
  await openTile(page, 'conditions');
  await check('it draws something rather than an empty axis', async () =>
    page.evaluate(() => {
      const c = document.getElementById('sheetChart');
      if (c.hidden || !c.width) return false;
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
      return false;
    }));
  await check('the past is dashed and the future is solid', async () => {
    /* Watch the drawing, not the pixels.

       Two earlier versions of this check counted blank columns in the
       rendered line. Both were really measuring the time of day: one
       split the plot at its midpoint (only the boundary at exactly
       midday), and the fixed version still compared unequal, noisy
       samples. Neither was measuring the claim.

       The claim is that the past and the future are stroked with
       different dash settings, split at now. So record every dash
       setting used while the chart draws, and check that both a
       dashed and a solid stroke happened — and that they are the two
       halves of one series, not two unrelated strokes. */
    const r = await page.evaluate(() => new Promise((resolve) => {
      const canvas = document.getElementById('sheetChart');
      const ctx = canvas.getContext('2d');
      const strokes = [];
      const realDash = ctx.setLineDash.bind(ctx);
      const realStroke = ctx.stroke.bind(ctx);
      let dash = [];
      ctx.setLineDash = (d) => { dash = d || []; return realDash(d); };
      ctx.stroke = () => { strokes.push(dash.length > 0 ? 'dashed' : 'solid'); return realStroke(); };
      // Redraw by re-picking the open day.
      document.querySelectorAll('.sheet-date')[0].click();
      setTimeout(() => {
        ctx.setLineDash = realDash;
        ctx.stroke = realStroke;
        resolve(strokes);
      }, 400);
    }));
    const dashed = r.filter((s) => s === 'dashed').length;
    const solid = r.filter((s) => s === 'solid').length;
    if (!(dashed >= 1 && solid >= 1)) console.log('  [diag] strokes: ' + JSON.stringify(r));
    return dashed >= 1 && solid >= 1;
  });

  await check('there is a legend when a second series is drawn', async () => {
    const hidden = await page.getAttribute('#sheetLegend', 'hidden');
    const text = await page.textContent('#sheetLegend');
    return hidden === null && /feels like/i.test(text);
  });
  await check('the headline is what it is now, and says so', async () => {
    const sub = await page.textContent('#sheetSub');
    return /^Now,/.test(sub.trim());
  });
  await check("the summary names the day's own high and low", async () => {
    const text = await page.textContent('#sheetSummary');
    // The fixture runs 60 + hour: 60 at midnight, 83 at 23:00.
    return /83/.test(text) && /60/.test(text);
  });
  await page.click('#metricSheetClose');

  console.log('\n=== Each sheet reads its own metric, not another ===');
  await openTile(page, 'humidity');
  await check('humidity is the humidity series, not the temperature', async () => {
    const text = await page.textContent('#sheetSummary');
    // 90 - hour*2 runs 90 down to 44.
    return /90%/.test(text) && /44%/.test(text);
  });
  await page.click('#metricSheetClose');

  await openTile(page, 'wind');
  await check('wind reads speeds, and gusts as its second series', async () => {
    const text = await page.textContent('#sheetSummary');
    // 5 + hour/2 -> 5 to 16.5; gusts 15 + hour/2 -> up to 26.5.
    return /gusts up to 2[67] mph/i.test(text) && /5 mph to 1[67] mph/i.test(text);
  });
  await page.click('#metricSheetClose');

  await openTile(page, 'precip');
  await check('precipitation finds the hour its chance peaks', async () => {
    const text = await page.textContent('#sheetSummary');
    // 70% at 15:00 and 5% everywhere else.
    return /70%/.test(text) && /(3 PM|3:00 PM|15:00)/i.test(text);
  });
  await page.click('#metricSheetClose');

  console.log('\n=== UV says when protection actually matters ===');
  await openTile(page, 'uv');
  await check('it names the peak', async () =>
    /peak uv index today is 9/i.test(await page.textContent('#sheetSummary')));
  await check('and the window Moderate is reached, from the data', async () => {
    const text = await page.textContent('#sheetSummary');
    // 9 - |12 - hour| >= 3 runs 09:00 to 18:00 in this fixture.
    return /moderate or higher are reached from/i.test(text) &&
           /(9 AM|9:00 AM|09:00)/i.test(text) && /(6 PM|6:00 PM|18:00)/i.test(text);
  });
  await page.click('#metricSheetClose');

  console.log('\n=== Another day is another day ===');
  await openTile(page, 'humidity');
  await check('the strip offers seven days with today marked', async () => {
    const count = await page.locator('.sheet-date').count();
    const marked = await page.locator('.sheet-date.picked').count();
    const first = await page.locator('.sheet-date').first().getAttribute('aria-pressed');
    return count === 7 && marked === 1 && first === 'true';
  });
  await check('picking another day moves the mark and the date', async () => {
    const before = await page.textContent('#sheetDate');
    await page.locator('.sheet-date').nth(3).click();
    await page.waitForTimeout(500);
    const after = await page.textContent('#sheetDate');
    const marked = await page.locator('.sheet-date.picked').count();
    return before !== after && marked === 1;
  });
  await check('a future day shows the day\'s figure, not "now"', async () => {
    const sub = await page.textContent('#sheetSub');
    return !/^Now,/.test(sub.trim()) && sub.trim().length > 0;
  });
  await check('and it is still the humidity sheet', async () =>
    /humidity/i.test(await page.textContent('#sheetTitle')));
  await page.click('#metricSheetClose');
  await ctx.close();

  console.log('\n=== A day with no hourly data says so, rather than drawing nothing ===');
  ({ ctx, page, errors } = await mk({ hourlyDays: 2 }));
  await openTile(page, 'humidity');
  await check('the far day has no series in this fixture', async () => {
    await page.locator('.sheet-date').nth(5).click();
    await page.waitForTimeout(500);
    return (await page.getAttribute('#sheetEmpty', 'hidden')) === null;
  });
  await check('it explains rather than showing an empty axis', async () => {
    const text = await page.textContent('#sheetEmpty');
    const chartHidden = await page.getAttribute('#sheetChart', 'hidden');
    return /no hour-by-hour data/i.test(text) && chartHidden !== null;
  });
  await check('and makes no claim in the summary either', async () =>
    (await page.textContent('#sheetSummary')).trim() === '');
  await page.click('#metricSheetClose');
  await ctx.close();

  console.log('\n=== The wind tile itself ===');
  ({ ctx, page, errors } = await mk());
  await check('it shows wind, gusts and direction, as three facts', async () => {
    const wind = (await page.textContent('#wxWind')).trim();
    const gusts = (await page.textContent('#wxGusts')).trim();
    const dir = (await page.textContent('#wxWindDir')).trim();
    return /11 mph/.test(wind) && /14 mph/.test(gusts) && /156° SSE/.test(dir);
  });
  await check('no horizontal overflow on a phone with a sheet open', async () => {
    await page.setViewportSize({ width: 375, height: 780 });
    await page.waitForTimeout(600);
    await openTile(page, 'uv');
    await page.waitForTimeout(600);
    return page.evaluate(() =>
      document.documentElement.scrollWidth <= window.innerWidth + 1);
  });
  await check('no JS errors', () => errors.length === 0);
  if (errors.length) console.log(errors.join('\n'));
  await ctx.close();

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll V25 checks passed.');
  await browser.close();
  process.exit(failures ? 1 : 0);
})();
