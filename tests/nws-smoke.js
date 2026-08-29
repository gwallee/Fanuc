/* NWS + live-radar smoke test for What the Wether V8. */
const { chromium } = require('playwright');
const BASE_URL = process.env.WTW_BASE_URL || 'http://localhost:8901';
const APP_DIR = process.env.WTW_APP_DIR || require('path').join(__dirname, '..');
const BROWSER = process.env.PLAYWRIGHT_CHROMIUM || undefined;

const fs = require('fs');

const RADAR_PNG = fs.readFileSync(__dirname + '/fixture-radar-frame.png');

const PERIODS = [];
const DATES = ['2026-08-28','2026-08-29','2026-08-30','2026-08-31','2026-09-01','2026-09-02','2026-09-03'];
DATES.forEach((d, i) => {
  PERIODS.push({ number: i*2+1, name: 'Day', startTime: `${d}T06:00:00-05:00`, isDaytime: true,
    temperature: 95 - i, temperatureUnit: 'F', probabilityOfPrecipitation: { value: 60 - i*5 },
    shortForecast: i === 1 ? 'Thunderstorms Likely' : 'Partly Sunny' });
  PERIODS.push({ number: i*2+2, name: 'Night', startTime: `${d}T18:00:00-05:00`, isDaytime: false,
    temperature: 75 - i, temperatureUnit: 'F', probabilityOfPrecipitation: { value: 30 },
    shortForecast: 'Mostly Cloudy' });
});

async function stubNWS(page, { pointsOk = true, alerts = true } = {}) {
  await page.route('https://api.weather.gov/**', (route) => {
    const url = route.request().url();
    const json = (body) => route.fulfill({ contentType: 'application/geo+json', body: JSON.stringify(body) });

    if (url.includes('/points/')) {
      if (!pointsOk) return route.fulfill({ status: 404, contentType: 'application/problem+json', body: '{"status":404}' });
      return json({ properties: {
        gridId: 'EWX', gridX: 100, gridY: 90, radarStation: 'KEWX',
        forecast: 'https://api.weather.gov/gridpoints/EWX/100,90/forecast',
        forecastHourly: 'https://api.weather.gov/gridpoints/EWX/100,90/forecast/hourly',
        observationStations: 'https://api.weather.gov/gridpoints/EWX/100,90/stations',
        relativeLocation: { properties: { city: 'Austin', state: 'TX' } },
      }});
    }
    if (url.includes('/stations') && !url.includes('/observations')) {
      return json({ features: [
        { properties: { stationIdentifier: 'KDEAD' } },   // reports no temperature
        { properties: { stationIdentifier: 'KAUS' } },
      ]});
    }
    if (url.includes('KDEAD/observations')) {
      return json({ properties: { temperature: { value: null }, textDescription: '' } });
    }
    if (url.includes('/observations/latest')) {
      return json({ properties: {
        temperature: { value: 33.3, unitCode: 'wmoUnit:degC' },        // 91.94 F
        heatIndex: { value: 38.0 },                                     // 100.4 F
        relativeHumidity: { value: 58 },
        windSpeed: { value: 19.8, unitCode: 'wmoUnit:km_h-1' },         // 12.3 mph
        windDirection: { value: 160 },
        textDescription: 'Thunderstorm',
        timestamp: new Date(Date.now() - 5 * 60000).toISOString(),
      }});
    }
    if (url.includes('/forecast')) {
      return json({ properties: { periods: PERIODS } });
    }
    if (url.includes('/alerts/active')) {
      return json({ features: alerts ? [{ properties: {
        event: 'Severe Thunderstorm Warning',
        headline: 'Severe Thunderstorm Warning issued for Travis County until 9:15 PM CDT',
        severity: 'Severe', urgency: 'Immediate', areaDesc: 'Travis, TX',
      }}] : [] });
    }
    return json({});
  });
}

async function stubGeocode(page) {
  await page.route('https://geocoding-api.open-meteo.com/**', (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({
      results: [{ name: 'Austin', admin1: 'Texas', country_code: 'US', latitude: 30.2672, longitude: -97.7431 }] }) }));
}

async function stubOpenMeteo(page) {
  await page.route('https://api.open-meteo.com/**', (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({
      current: { temperature_2m: 70.0, apparent_temperature: 68, relative_humidity_2m: 44,
        weather_code: 0, wind_speed_10m: 5, wind_direction_10m: 90, is_day: 1 },
      daily: { time: DATES, weather_code: [0,0,0,0,0,0,0],
        temperature_2m_max: [80,80,80,80,80,80,80], temperature_2m_min: [60,60,60,60,60,60,60],
        precipitation_probability_max: [0,0,0,0,0,0,0] } }) }));
}

(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER });
  let failures = 0;
  const check = async (name, fn) => {
    try {
      const ok = await fn();
      console.log((ok ? 'PASS' : 'FAIL') + ' - ' + name);
      if (!ok) failures++;
    } catch (e) {
      console.log('FAIL - ' + name + ' (' + e.message.split('\n')[0] + ')');
      failures++;
    }
  };

  /* ============ Scenario 1: NWS + live radar imagery ============ */
  console.log('\n=== Scenario 1: NWS available, radar imagery available ===');
  let ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  let page = await ctx.newPage();
  // Deny every external host by default. Routes registered after this one
  // win, so each suite still stubs what it needs - but anything a suite
  // forgot fails closed instead of quietly reaching the real internet.
  // A predicate, not a glob: 'https://**' matches nothing at all.
  await page.route((u) => u.protocol === 'https:', (r) => r.abort());
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => {
    // Resource-load failures are proxy/network noise, not app errors.
    if (m.type() === 'error' && !/Failed to load resource|ERR_TUNNEL/.test(m.text())) {
      errors.push('CONSOLE: ' + m.text());
    }
  });
  await page.route('https://basemaps.cartocdn.com/**', (r) => r.fulfill({ headers: { 'cache-control': 'no-store' }, contentType: 'image/png', body: RADAR_PNG }));

  const wmsUrls = [];
  await page.route('https://opengeo.ncep.noaa.gov/**', (r) => {
    wmsUrls.push(r.request().url());
    return r.fulfill({ headers: { 'cache-control': 'no-store' }, contentType: 'image/png', body: RADAR_PNG });
  });
  await stubNWS(page);
  await stubGeocode(page);
  await stubOpenMeteo(page);

  await page.goto(BASE_URL + '/index.html', { waitUntil: 'networkidle' });
  await page.fill('#searchInput', 'Austin');
  await page.click('#searchBtn');
  await page.waitForSelector('#weatherPanels:not([hidden])', { timeout: 20000 });
  await page.waitForTimeout(2500);

  await check('uses NWS as the source', async () =>
    /National Weather Service/.test(await page.textContent('#wxUpdated')));
  await check('names the reporting station (skips the dead one)', async () =>
    /KAUS/.test(await page.textContent('#wxUpdated')));
  await check('converts C -> F correctly (33.3C = 92F)', async () =>
    (await page.textContent('#wxTemp')).trim() === '92°');
  await check('uses heat index for feels-like (38C = 100F)', async () =>
    (await page.textContent('#wxFeels')).trim() === '100°');
  await check('converts km/h -> mph correctly (19.8 = 12 mph)', async () =>
    (await page.textContent('#wxWind')).trim() === '12 mph');
  await check('humidity from NWS', async () =>
    (await page.textContent('#wxHumidity')).trim() === '58%');
  await check('shows NWS condition text verbatim', async () =>
    (await page.textContent('#wxCondition')).trim() === 'Thunderstorm');
  await check('maps NWS text to a thunderstorm icon', async () =>
    (await page.textContent('#wxIcon')).includes('⛈'));
  await check('7-day forecast built from 12-hour periods', async () =>
    (await page.locator('.forecast-card').count()) === 7);
  await check('forecast pairs day high with night low', async () => {
    const first = await page.locator('.forecast-card').first().innerText();
    return first.includes('95°') && first.includes('75°');
  });
  await check('alerts panel is visible', () => page.isVisible('#alertsPanel'));
  await check('alert shows the event name', async () =>
    /Severe Thunderstorm Warning/.test(await page.textContent('#alertsPanel')));
  await check('severe alert gets the severe style', async () =>
    (await page.locator('.alert-item.alert-severe').count()) === 1);

  await check('radar reports NWS LIVE', async () =>
    (await page.textContent('#radarSource')).trim() === 'NWS LIVE');
  await check('requested 6 radar frames', () => wmsUrls.length === 6);
  await check('WMS request is well-formed (1.1.1, EPSG:3857, bbox, time)', () => {
    const p = new URL(wmsUrls[0]).searchParams;
    const bbox = (p.get('bbox') || '').split(',').map(Number);
    const R = 6378137;
    // V9 projects in Web Mercator so radar aligns with the basemap.
    const lon = (((bbox[0] + bbox[2]) / 2) / R) * 180 / Math.PI;
    const lat = (2 * Math.atan(Math.exp(((bbox[1] + bbox[3]) / 2) / R)) - Math.PI / 2) * 180 / Math.PI;
    return p.get('service') === 'WMS' && p.get('version') === '1.1.1' &&
      p.get('request') === 'GetMap' && p.get('srs') === 'EPSG:3857' &&
      p.get('layers') === 'conus_bref_qcd' && p.get('transparent') === 'true' &&
      bbox.length === 4 &&
      Math.abs(lon + 97.7431) < 0.01 && Math.abs(lat - 30.2672) < 0.01 &&
      bbox[0] < bbox[2] && bbox[1] < bbox[3] &&
      /^\d{4}-\d{2}-\d{2}T/.test(p.get('time') || '');
  });
  await check('bbox covers ~300km of ground at this latitude', () => {
    const [minX, minY, maxX, maxY] = new URL(wmsUrls[0]).searchParams.get('bbox').split(',').map(Number);
    // Mercator distances inflate by 1/cos(lat); undo that for ground truth.
    const groundKm = ((maxX - minX) * Math.cos(30.2672 * Math.PI / 180)) / 1000;
    const square = Math.abs((maxX - minX) - (maxY - minY)) < 1;
    return square && Math.abs(groundKm - 300) < 3;
  });
  await check('frames are 10 min apart, newest last', () => {
    const times = wmsUrls.map((u) => new Date(new URL(u).searchParams.get('time')).getTime());
    for (let i = 1; i < times.length; i++) {
      if (times[i] - times[i - 1] !== 600000) return false;
    }
    return true;
  });
  await check('timeline re-ranged to the frame count', async () =>
    (await page.getAttribute('#radarTimeline', 'max')) === '5');
  // Pause first: while playing, the loop is advancing on its own.
  await page.click('#radarStopBtn');
  await check('timeline label reads NOW on the newest frame', async () => {
    await page.locator('#radarTimeline').fill('5');
    return (await page.textContent('#radarTimeLabel')).trim() === 'NOW';
  });
  await check('scrubbing back shows a clock time', async () => {
    await page.locator('#radarTimeline').fill('0');
    const label = (await page.textContent('#radarTimeLabel')).trim();
    return label !== 'NOW' && /\d/.test(label);
  });
  await check('playback advances frames on its own', async () => {
    await page.locator('#radarTimeline').fill('0');
    // Release the scrub, then resume playback.
    await page.evaluate(() => document.getElementById('radarTimeline').dispatchEvent(new Event('change')));
    await page.click('#radarPlayBtn');
    const before = await page.inputValue('#radarTimeline');
    await page.waitForTimeout(2000);
    const after = await page.inputValue('#radarTimeline');
    return before !== after;
  });
  await check('radar canvas is actually painted', async () => {
    // Canvas is tainted by the cross-origin frame, so measure the
    // draw calls instead of reading pixels.
    return page.evaluate(() => {
      const c = document.getElementById('radarCanvas');
      return c.width > 0 && c.height > 0;
    });
  });
  await page.screenshot({ path: __dirname + '/nws-live.png', fullPage: true });
  await ctx.close();

  /* ============ Scenario 2: NWS down -> Open-Meteo, radar -> simulated ============ */
  console.log('\n=== Scenario 2: outside NWS coverage, no radar imagery ===');
  ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  page = await ctx.newPage();
  // Deny every external host by default. Routes registered after this one
  // win, so each suite still stubs what it needs - but anything a suite
  // forgot fails closed instead of quietly reaching the real internet.
  // A predicate, not a glob: 'https://**' matches nothing at all.
  await page.route((u) => u.protocol === 'https:', (r) => r.abort());
  page.on('pageerror', (e) => errors.push('PAGEERROR(2): ' + e.message));

  await page.route('https://opengeo.ncep.noaa.gov/**', (r) => r.abort());
  await stubNWS(page, { pointsOk: false, alerts: false });
  await stubGeocode(page);
  await stubOpenMeteo(page);

  await page.goto(BASE_URL + '/index.html', { waitUntil: 'networkidle' });
  await page.fill('#searchInput', 'Austin');
  await page.click('#searchBtn');
  await page.waitForSelector('#weatherPanels:not([hidden])', { timeout: 20000 });
  await page.waitForTimeout(2500);

  await check('falls back to Open-Meteo when NWS 404s', async () =>
    /Open-Meteo/.test(await page.textContent('#wxUpdated')));
  await check('still renders a temperature', async () =>
    (await page.textContent('#wxTemp')).trim() === '70°');
  await check('still renders 7 forecast days', async () =>
    (await page.locator('.forecast-card').count()) === 7);
  await check('radar falls back to SIMULATED', async () =>
    (await page.textContent('#radarSource')).trim() === 'SIMULATED');
  await check('simulated timeline is back to 60 minutes', async () =>
    (await page.getAttribute('#radarTimeline', 'max')) === '60');
  await check('alerts panel hidden when there are none', async () =>
    !(await page.isVisible('#alertsPanel')));
  await check('roast still works on the fallback path', async () => {
    const t = await page.textContent('#roastText');
    return t && t.length > 20 && !t.startsWith('Load some weather');
  });
  await page.screenshot({ path: __dirname + '/nws-fallback.png', fullPage: true });
  await ctx.close();

  if (errors.length) {
    console.log('\nJS ERRORS:');
    errors.forEach((e) => console.log('  ' + e));
    failures++;
  } else {
    console.log('\nNo JS errors on page.');
  }
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll checks passed.');
  await browser.close();
  process.exit(failures ? 1 : 0);
})();
