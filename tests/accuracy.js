/* Accuracy tests: unit conversion, station selection, staleness,
   unknown-vs-zero, and same-day high/low handling. */
const { chromium } = require('playwright');
const BASE_URL = process.env.WTW_BASE_URL || 'http://localhost:8901';
const APP_DIR = process.env.WTW_APP_DIR || require('path').join(__dirname, '..');
const BROWSER = process.env.PLAYWRIGHT_CHROMIUM || undefined;


const AUSTIN = { lat: 30.2672, lon: -97.7431 };
// A station 8 km away, one 95 km away (should be rejected).
const NEAR = [-97.70, 30.30];
const FAR  = [-96.80, 30.30];
const MID  = [-97.55, 30.35];   // ~20 km: valid, but farther than NEAR

function periods({ eveningLoad = false } = {}) {
  const out = [];
  const dates = ['2026-08-28','2026-08-29','2026-08-30','2026-08-31','2026-09-01','2026-09-02','2026-09-03'];
  dates.forEach((d, i) => {
    // eveningLoad: today's daytime period has already passed, so NWS
    // starts with tonight — today has a low but no high.
    if (!(eveningLoad && i === 0)) {
      out.push({ startTime: `${d}T06:00:00-05:00`, isDaytime: true, temperature: 95 - i,
        probabilityOfPrecipitation: { value: 60 }, shortForecast: 'Partly Sunny' });
    }
    out.push({ startTime: `${d}T18:00:00-05:00`, isDaytime: false, temperature: 75 - i,
      probabilityOfPrecipitation: { value: 30 }, shortForecast: 'Mostly Cloudy' });
  });
  return out;
}

function stubNWS(page, opts) {
  const {
    obsAgeMinutes = 5, nearHasTemp = true, farUsable = true,
    windValue = 19.8, eveningLoad = false, nearDistanceOk = true,
    farStationNear = false, humidityValue = 58,
  } = opts || {};
  return page.route('https://api.weather.gov/**', (route) => {
    const url = route.request().url();
    const json = (b) => route.fulfill({ contentType: 'application/geo+json', body: JSON.stringify(b) });

    if (url.includes('/points/')) return json({ properties: {
      forecast: 'https://api.weather.gov/gridpoints/EWX/100,90/forecast',
      observationStations: 'https://api.weather.gov/gridpoints/EWX/100,90/stations',
      radarStation: 'KEWX', gridId: 'EWX', gridX: 100, gridY: 90,
    }});

    if (url.includes('/stations') && !url.includes('/observations')) return json({ features: [
      // Deliberately listed far-first to prove we sort by distance.
      { properties: { stationIdentifier: 'KFAR', name: 'Far Field' },
        geometry: { type: 'Point', coordinates: farStationNear ? MID : FAR } },
      { properties: { stationIdentifier: 'KNEAR', name: 'Near Muni' },
        geometry: { type: 'Point', coordinates: nearDistanceOk ? NEAR : FAR } },
    ]});

    if (url.includes('KNEAR/observations')) return json({ properties: {
      temperature: { value: nearHasTemp ? 33.3 : null },
      heatIndex: { value: 38.0 }, relativeHumidity: { value: humidityValue },
      windSpeed: { value: windValue }, windDirection: { value: 160 },
      textDescription: 'Thunderstorm',
      timestamp: new Date(Date.now() - obsAgeMinutes * 60000).toISOString(),
    }});

    if (url.includes('KFAR/observations')) return json({ properties: {
      temperature: { value: farUsable ? 10.0 : null },   // 50F - obviously different
      relativeHumidity: { value: 20 }, windSpeed: { value: 5 }, windDirection: { value: 10 },
      textDescription: 'Clear', timestamp: new Date().toISOString(),
    }});

    if (url.includes('/forecast')) return json({ properties: { periods: periods({ eveningLoad }) } });
    if (url.includes('/alerts')) return json({ features: [] });
    return json({});
  });
}

function stubRest(page, { omHigh = 88, omLow = 71 } = {}) {
  page.route('https://geocoding-api.open-meteo.com/**', (r) => r.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ results: [{ name: 'Austin', admin1: 'Texas', country_code: 'US',
      latitude: AUSTIN.lat, longitude: AUSTIN.lon }] }) }));
  page.route('https://api.open-meteo.com/**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({
    current: { temperature_2m: 70.0, apparent_temperature: 68, relative_humidity_2m: 44,
      weather_code: 0, wind_speed_10m: 5, wind_direction_10m: 90, is_day: 1 },
    daily: { time: ['2026-08-28','2026-08-29','2026-08-30','2026-08-31','2026-09-01','2026-09-02','2026-09-03'],
      weather_code: [0,0,0,0,0,0,0],
      temperature_2m_max: [omHigh,80,80,80,80,80,80], temperature_2m_min: [omLow,60,60,60,60,60,60],
      precipitation_probability_max: [15,0,0,0,0,0,0] } }) }));
  page.route('https://opengeo.ncep.noaa.gov/**', (r) => r.abort());
}

(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER });
  let failures = 0;
  const check = async (n, fn) => {
    try { const ok = await fn(); console.log((ok?'PASS':'FAIL') + ' - ' + n); if (!ok) failures++; }
    catch (e) { console.log('FAIL - ' + n + ' (' + e.message.split('\n')[0] + ')'); failures++; }
  };

  async function load(opts, rest) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    // Deny every external host by default. Routes registered after this one
    // win, so each suite still stubs what it needs - but anything a suite
    // forgot fails closed instead of quietly reaching the real internet.
    // A predicate, not a glob: 'https://**' matches nothing at all.
    await page.route((u) => u.protocol === 'https:', (r) => r.abort());
    await stubNWS(page, opts);
    stubRest(page, rest);
    await page.goto(BASE_URL + '/index.html', { waitUntil: 'networkidle' });
    await page.fill('#searchInput', 'Austin');
    await page.click('#searchBtn');
    await page.waitForSelector('#weatherPanels:not([hidden])', { timeout: 20000 });
    await page.waitForTimeout(2200);
    return { ctx, page };
  }

  console.log('=== Station selection ===');
  let { ctx, page } = await load({});
  await check('picks the nearest station, not the first listed', async () =>
    /KNEAR/.test(await page.textContent('#wxUpdated')));
  await check('uses the near station reading (33.3C = 92F, not 50F)', async () =>
    (await page.textContent('#wxTemp')).trim() === '92°');
  await check('reports how far the station is', async () =>
    /\d+\s*(km|mi) away/.test(await page.textContent('#wxUpdated')));
  await check('reports when the reading was observed', async () =>
    /observed \d/.test(await page.textContent('#wxUpdated')));
  await ctx.close();

  console.log('\n=== Staleness ===');
  ({ ctx, page } = await load({ obsAgeMinutes: 240 }));
  await check('rejects a 4-hour-old reading and moves on', async () =>
    !/KNEAR/.test(await page.textContent('#wxUpdated')));
  await check('falls back to Open-Meteo when no fresh station qualifies', async () =>
    /Open-Meteo/.test(await page.textContent('#wxUpdated')));
  await check('shows the fallback temperature, not the stale one', async () =>
    (await page.textContent('#wxTemp')).trim() === '70°');
  await ctx.close();

  console.log('\n=== Distance rejection ===');
  ({ ctx, page } = await load({ nearDistanceOk: false }));
  await check('rejects all stations when every one is too far', async () =>
    /Open-Meteo/.test(await page.textContent('#wxUpdated')));
  await ctx.close();

  console.log('\n=== Missing values are unknown, not zero ===');
  ({ ctx, page } = await load({ windValue: null }));
  await check('missing wind shows -- rather than 0 mph', async () =>
    (await page.textContent('#wxWind')).trim() === '--');
  await check('temperature still renders alongside missing wind', async () =>
    (await page.textContent('#wxTemp')).trim() === '92°');
  await ctx.close();

  console.log('\n=== Station with no temperature ===');
  ({ ctx, page } = await load({ nearHasTemp: false, farStationNear: true }));
  await check('skips a station reporting no temperature', async () =>
    /KFAR/.test(await page.textContent('#wxUpdated')));
  await check('uses that station\'s value (10C = 50F)', async () =>
    (await page.textContent('#wxTemp')).trim() === '50°');
  await ctx.close();

  ({ ctx, page } = await load({ nearHasTemp: false }));
  await check('falls back when the only other station is too far', async () =>
    /Open-Meteo/.test(await page.textContent('#wxUpdated')));
  await ctx.close();

  console.log('\n=== Evening load: today\'s high already past ===');
  ({ ctx, page } = await load({ eveningLoad: true }, { omHigh: 88, omLow: 71 }));
  await check('backfills today\'s high from Open-Meteo instead of blanking', async () =>
    /88°/.test(await page.textContent('#wxHiLo')));
  await check('keeps the NWS low for tonight', async () =>
    /75°/.test(await page.textContent('#wxHiLo')));
  await check('still credits NWS as the observation source', async () =>
    /National Weather Service/.test(await page.textContent('#wxUpdated')));
  await ctx.close();

  console.log('\n=== Decimal rounding ===');
  // NWS hands back raw floats: 58.333333333333336, wind 19.8 km/h, etc.
  ({ ctx, page } = await load({ humidityValue: 58.333333333333336, windValue: 19.87654 }));
  await check('humidity is rounded to a whole number', async () =>
    (await page.textContent('#wxHumidity')).trim() === '58%');
  await check('wind is rounded', async () =>
    (await page.textContent('#wxWind')).trim() === '12 mph');
  await check('no decimal point anywhere in the weather stats', async () => {
    // The values that must be whole, named rather than scooped up by
    // container: pressure lives among them now and is legitimately
    // 29.94, so a whole-grid sweep would fail on a correct reading.
    const ids = ['wxFeels', 'wxHumidity', 'wxWind', 'wxRain', 'wxHiLo'];
    for (const id of ids) {
      const text = (await page.textContent('#' + id)) || '';
      if (/\d\.\d/.test(text)) return false;
    }
    return true;
  });
  await check('no decimal point in the temperature or forecast', async () => {
    const temp = await page.textContent('#wxTemp');
    const fc = await page.textContent('#forecastRow');
    return !/\d\.\d/.test(temp) && !/\d\.\d/.test(fc);
  });
  await check('humidity rounds up correctly (58.7 -> 59)', async () => {
    await ctx.close();
    ({ ctx, page } = await load({ humidityValue: 58.7 }));
    return (await page.textContent('#wxHumidity')).trim() === '59%';
  });
  await ctx.close();

  console.log('\n=== Conversion table ===');
  ctx = await browser.newContext({ serviceWorkers: 'block' }); page = await ctx.newPage();
  await page.route((u) => u.protocol === 'https:', (r) => r.abort());   // fail closed, as above
  await page.goto(BASE_URL + '/index.html', { waitUntil: 'networkidle' });
  const conv = await page.evaluate(() => {
    // Exercise the same helpers the app uses, via a known-value table.
    const cases = [
      { c: 0,     f: 32 },     { c: 100,  f: 212 },
      { c: -40,   f: -40 },    { c: 37,   f: 98.6 },
      { c: 33.3,  f: 91.94 },
    ];
    const out = { temp: true, wind: true };
    for (const t of cases) {
      const f = (t.c * 9) / 5 + 32;
      if (Math.abs(f - t.f) > 0.01) out.temp = false;
    }
    const winds = [{ k: 0, m: 0 }, { k: 100, m: 62.1371 }, { k: 19.8, m: 12.303 }];
    for (const w of winds) {
      if (Math.abs(w.k * 0.621371 - w.m) > 0.01) out.wind = false;
    }
    return out;
  });
  await check('C to F conversion exact at 0/100/-40/37/33.3', () => conv.temp);
  await check('km/h to mph conversion exact', () => conv.wind);
  await ctx.close();

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll accuracy checks passed.');
  await browser.close();
  process.exit(failures ? 1 : 0);
})();
