/* V23: figures that mean something.

   Every feature here replaces a number people cannot act on with one
   they can — a probability with an amount, a wind speed with the gust
   that actually knocks the parasol over, a bare barometer reading with
   whether it is rising. That only helps if the derivation is right, so
   this suite drives each one from a fixture with a known answer and
   checks the answer, not that a box is populated.

   The barometric trend is the one to be careful with. A single reading
   cannot be rising or falling, and an app that decides from noise will
   happily tell you a storm is coming on a flat day. The fixture serves
   a genuinely rising, a genuinely falling and a flat series, and the
   flat one must come back "steady".

   The climate normal is the other. Averaging the wrong days, or
   averaging too few, gives a confident number that is simply wrong —
   so the archive fixture holds a date whose mean is known by
   construction, and a second case with too little history that must
   produce no tile at all rather than a guess. */
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
const pad = (n) => String(n).padStart(2, '0');

/* The forecast fixture. Every knob has a known consequence:
     pressureShape  rising | falling | flat
     precipToday    inches that fell today
     nextRainIn     inches on the day nextRainDay
     gustMph        current gust
*/
function omBody({ pressureShape = 'flat', precipToday = 0, nextRainIn = 0.15,
                  nextRainDay = 3, gustMph = 22, gustMaxToday = 24,
                  code = 0, changeToCode = null, changeAtHour = 4 } = {}) {
  const hT = [], t = [], pop = [], hc = [], w = [], gusts = [], vis = [], pres = [], prcp = [];
  const now = new Date();
  // The hourly series starts a day back, as past_days=1 gives.
  const start = new Date(now.getTime() - 24 * 3600000);
  for (let i = 0; i < 96; i++) {
    const at = new Date(start.getTime() + i * 3600000);
    hT.push(`${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
            `T${pad(at.getHours())}:00`);
    t.push(72);
    pop.push(20);
    // A change of conditions a known number of hours from now.
    const hoursFromNow = Math.round((at - now) / 3600000);
    hc.push(changeToCode != null && hoursFromNow >= changeAtHour ? changeToCode : code);
    w.push(10); gusts.push(gustMph); vis.push(16093); prcp.push(0);
    // 1013 mb flat; rising/falling move ~1.5 mb over the last 3 hours,
    // which is about 0.044 inHg — comfortably past the deadband.
    if (pressureShape === 'flat') pres.push(1013);
    else {
      const drift = pressureShape === 'rising' ? 0.5 : -0.5;
      pres.push(1013 + drift * hoursFromNow);
    }
  }
  const time = [], max = [], min = [], dc = [], dp = [], sums = [], gmax = [],
        sr = [], ss = [], uv = [];
  for (let d = -1; d < 7; d++) {
    time.push(isoDate(d));
    max.push(95); min.push(70); dc.push(code); dp.push(20);
    sums.push(d === 0 ? precipToday : (d === nextRainDay ? nextRainIn : 0));
    gmax.push(d === 0 ? gustMaxToday : 12);
    sr.push(isoDate(d) + 'T06:30'); ss.push(isoDate(d) + 'T19:30'); uv.push(5);
  }
  return JSON.stringify({
    current: { temperature_2m: 95, apparent_temperature: 95, relative_humidity_2m: 43,
               weather_code: code, wind_speed_10m: 10, wind_direction_10m: 180,
               wind_gusts_10m: gustMph, is_day: 1, pressure_msl: 1013,
               dew_point_2m: 69, precipitation: 0 },
    hourly: { time: hT, temperature_2m: t, precipitation_probability: pop,
              precipitation: prcp, weather_code: hc, wind_speed_10m: w,
              wind_gusts_10m: gusts, visibility: vis, pressure_msl: pres },
    daily: { time, weather_code: dc, temperature_2m_max: max, temperature_2m_min: min,
             precipitation_probability_max: dp, precipitation_sum: sums,
             wind_gusts_10m_max: gmax, sunrise: sr, sunset: ss, uv_index_max: uv } });
}

/* The archive fixture. Today's calendar date gets `normalHigh` in
   every one of `years` past years, and every other date gets a wildly
   different value — so an implementation that averages the wrong days,
   or the whole month, produces an obviously wrong answer rather than a
   subtly wrong one. */
function archiveBody({ normalHigh = 92, years = 10 } = {}) {
  const today = new Date();
  const wanted = `-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const time = [], max = [], min = [];
  const lastYear = today.getFullYear() - 1;
  for (let y = lastYear - 9; y <= lastYear; y++) {
    const have = y > lastYear - years;
    // A short series either side of the target date, per year.
    for (let off = -3; off <= 3; off++) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + off);
      const iso = `${y}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const isTarget = iso.endsWith(wanted);
      if (isTarget && !have) continue;              // missing year
      time.push(iso);
      max.push(isTarget ? normalHigh : 40);          // decoys are obvious
      min.push(isTarget ? 70 : 10);
    }
  }
  return JSON.stringify({ daily: { time, temperature_2m_max: max, temperature_2m_min: min } });
}

(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER });
  let failures = 0;
  const check = async (n, fn) => {
    try { const ok = await fn(); console.log((ok ? 'PASS' : 'FAIL') + ' - ' + n); if (!ok) failures++; }
    catch (e) { console.log('FAIL - ' + n + ' (' + e.message.split('\n')[0] + ')'); failures++; }
  };

  const mk = async (opts = {}, archive = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 },
                                           serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const archiveCalls = [];
    await page.route((u) => u.protocol === 'https:', (r) => r.abort());
    await page.route('https://api.open-meteo.com/**', (r) => r.fulfill({
      contentType: 'application/json', body: omBody(opts) }));
    await page.route('https://archive-api.open-meteo.com/**', (r) => {
      archiveCalls.push(r.request().url());
      if (archive.fails) return r.fulfill({ status: 500, body: '{}' });
      return r.fulfill({ contentType: 'application/json', body: archiveBody(archive) });
    });
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
    await page.waitForTimeout(1400);
    return { ctx, page, errors, archiveCalls };
  };

  console.log('=== Rain as an amount, not a probability ===');
  let { ctx, page, errors } = await mk({ precipToday: 0, nextRainIn: 0.15, nextRainDay: 3 });
  await check(`badge reads ${APP_VERSION}`, async () =>
    (await page.textContent('#appVersion')).trim() === APP_VERSION);
  await check('nothing today is written 0", not 0.00"', async () =>
    (await page.textContent('#precipToday')).trim() === '0"');
  await check('the next wet day is named with its amount', async () => {
    const note = await page.textContent('#precipNote');
    const day = new Date(isoDate(3) + 'T12:00:00')
      .toLocaleDateString([], { weekday: 'long' });
    return /0\.15"/.test(note) && note.includes(day);
  });
  await check('the probability is still there, just not the headline', async () =>
    (await page.textContent('#wxRain')).trim() === '20%');
  await ctx.close();

  ({ ctx, page, errors } = await mk({ precipToday: 0.42, nextRainDay: 1 }));
  await check('rain that fell today is shown to the hundredth', async () =>
    (await page.textContent('#precipToday')).trim() === '0.42"');
  await check('tomorrow is called tomorrow, not by its weekday', async () =>
    /tomorrow/i.test(await page.textContent('#precipNote')));
  await ctx.close();

  ({ ctx, page, errors } = await mk({ nextRainIn: 0, nextRainDay: -5 }));
  await check('a dry week says so rather than naming nothing', async () =>
    /none expected/i.test(await page.textContent('#precipNote')));
  await ctx.close();

  console.log('\n=== Gusts ===');
  /* V23 put the gust in a sentence and suppressed it when it barely
     differed from the steady wind, because a sentence repeating the
     number above it is noise. V25 moved wind to three labelled rows —
     Wind, Gusts, Direction — where a row is a fact rather than a
     remark, so it is always shown. The claim being tested is the same
     one: the gust is available and it is the real figure. */
  ({ ctx, page, errors } = await mk({ gustMph: 26 }));
  await check('the gust is shown as its own labelled figure', async () =>
    /26 mph/.test(await page.textContent('#wxGusts')));
  await check('beside the steady wind, not instead of it', async () =>
    /10 mph/.test(await page.textContent('#wxWind')));
  await ctx.close();
  ({ ctx, page, errors } = await mk({ gustMph: 11 }));
  await check('a gust close to the wind is still reported honestly', async () =>
    /11 mph/.test(await page.textContent('#wxGusts')));
  await ctx.close();

  console.log('\n=== A barometer that has to have moved to claim it moved ===');
  /* Read the claim, not the drawing. The dial is a picture and
     aria-hidden; the sentence beside it is what the app actually
     asserts about the barometer, and it is what a screen reader
     gets. */
  const trendWord = async (shape) => {
    const c = await mk({ pressureShape: shape });
    const text = (await c.page.textContent('#pressureTrend')).trim();
    await c.ctx.close();
    return text;
  };
  await check('a flat glass is steady, not a direction picked from noise', async () =>
    /steady/i.test(await trendWord('flat')));
  await check('a rising glass is rising', async () => /rising/i.test(await trendWord('rising')));
  await check('a falling glass is falling', async () => /falling/i.test(await trendWord('falling')));
  await check('and it says over what span, so it does not read as a forecast', async () =>
    /3 hours/.test(await trendWord('rising')));

  console.log('\n=== The average for this date, from real history ===');
  ({ ctx, page, errors } = await mk({}, { normalHigh: 92, years: 10 }));
  await check('the tile appears once the archive answers', async () =>
    (await page.getAttribute('#averagesTile', 'hidden')) === null);
  await check('it averages this date only, not the days around it', async () =>
    /92/.test(await page.textContent('#avgNormal')));
  await check("today's high is shown beside it", async () =>
    /95/.test(await page.textContent('#avgToday')));
  await check('the difference is the difference', async () =>
    (await page.textContent('#avgDelta')).trim() === '+3°');
  await check('and it is described the right way round', async () =>
    /above average/i.test(await page.textContent('#avgWord')));
  await check('it says how many years it averaged, rather than "normal"', async () => {
    const note = await page.textContent('#avgNote');
    return /10 years/.test(note) && !/\bnormal\b/i.test(note);
  });
  await ctx.close();

  console.log('\n=== And says nothing when it cannot say it honestly ===');
  ({ ctx, page, errors } = await mk({}, { normalHigh: 92, years: 3 }));
  await check('too little history means no tile, not a guess', async () => {
    await page.waitForTimeout(800);
    return (await page.getAttribute('#averagesTile', 'hidden')) !== null;
  });
  await ctx.close();
  ({ ctx, page, errors } = await mk({}, { fails: true }));
  await check('an archive that is down means no tile either', async () => {
    await page.waitForTimeout(800);
    return (await page.getAttribute('#averagesTile', 'hidden')) !== null;
  });
  await check('and the rest of the page loaded anyway', async () =>
    (await page.textContent('#wxTemp')).includes('95'));
  await ctx.close();

  console.log('\n=== It is not fetched twice for the same place and day ===');
  let cached = await mk({}, { normalHigh: 92 });
  await check('one archive request on first load', async () =>
    cached.archiveCalls.length === 1);
  await check('and none on a reload, because it is cached for a day', async () => {
    const before = cached.archiveCalls.length;
    await cached.page.reload({ waitUntil: 'networkidle' });
    await cached.page.waitForTimeout(2000);
    return cached.archiveCalls.length === before;
  });
  await check('the tile is still there from the cache', async () =>
    (await cached.page.getAttribute('#averagesTile', 'hidden')) === null);
  await cached.ctx.close();

  console.log('\n=== A sentence over the hour row ===');
  ({ ctx, page, errors } = await mk({ code: 3, changeToCode: 0, changeAtHour: 4 }));
  await check('it names the change and when it happens', async () => {
    const text = await page.textContent('#hourlySummary');
    return /clear conditions expected around/i.test(text);
  });
  await check('and mentions gusts when they are worth mentioning', async () =>
    /gusts are up to/i.test(await page.textContent('#hourlySummary')));
  await ctx.close();
  ({ ctx, page, errors } = await mk({ code: 0, changeToCode: null, gustMaxToday: 8 }));
  await check('nothing changing is said plainly, not invented', async () => {
    const text = await page.textContent('#hourlySummary');
    return /for the next \d+ hours/i.test(text) && !/expected around/i.test(text);
  });
  await check('and a calm day gets no gust clause', async () =>
    !/gusts/i.test(await page.textContent('#hourlySummary')));
  await ctx.close();

  console.log('\n=== Where the forecast is actually for ===');
  ({ ctx, page, errors } = await mk());
  await check('the place footer names the location', async () =>
    (await page.getAttribute('#placeFooter', 'hidden')) === null &&
    /Austin/.test(await page.textContent('#placeName')));
  await check('with coordinates anybody can check', async () => {
    const text = await page.textContent('#placeCoords');
    return /30\.2672° N/.test(text) && /97\.7431° W/.test(text);
  });
  await check('the map link points at those coordinates', async () => {
    const href = await page.getAttribute('#openInMaps', 'href');
    return href.includes('30.2672') && href.includes('-97.7431') &&
           href.startsWith('https://');
  });
  await check('and opens safely in a new tab', async () =>
    (await page.getAttribute('#openInMaps', 'rel')).includes('noopener') &&
    (await page.getAttribute('#openInMaps', 'target')) === '_blank');
  await check('no JS errors', () => errors.length === 0);
  if (errors.length) console.log(errors.join('\n'));
  await ctx.close();

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll V23 checks passed.');
  await browser.close();
  process.exit(failures ? 1 : 0);
})();
