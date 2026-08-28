/* V12: independent rain source + temperature trend chart. */
const { chromium } = require('playwright');
const BASE_URL = process.env.WTW_BASE_URL || 'http://localhost:8901';
const APP_DIR = process.env.WTW_APP_DIR || require('path').join(__dirname, '..');
const BROWSER = process.env.PLAYWRIGHT_CHROMIUM || undefined;
// Read the expected version from the source rather than hard-coding it.
const APP_VERSION = (require('fs').readFileSync(APP_DIR + '/config.js', 'utf8')
  .match(/version:\s*'([^']+)'/) || [, '?'])[1];

const fs = require('fs');
const PNG = fs.readFileSync(__dirname + '/fixture-radar-frame.png');
const AUSTIN = { lat: 30.2672, lon: -97.7431 };
const DATES = ['2026-08-28','2026-08-29','2026-08-30','2026-08-31','2026-09-01','2026-09-02','2026-09-03'];
const HIGHS = [95, 88, 79, 84, 91, 76, 99];
const LOWS  = [72, 68, 61, 64, 70, 58, 75];

function omBody() {
  const t = [], temps = [], pops = [], codes = [], winds = [], vis = [];
  const start = Date.now();
  for (let i = 0; i < 50; i++) {
    t.push(new Date(start + i * 3600000).toISOString().slice(0, 16));
    temps.push(75); pops.push(5); codes.push(0); winds.push(8); vis.push(16093);
  }
  return JSON.stringify({
    current: { temperature_2m: 80, apparent_temperature: 82, relative_humidity_2m: 50,
      weather_code: 0, wind_speed_10m: 8, wind_direction_10m: 180, is_day: 1,
      pressure_msl: 1012, dew_point_2m: 60 },
    hourly: { time: t, temperature_2m: temps, precipitation_probability: pops,
      weather_code: codes, wind_speed_10m: winds, visibility: vis },
    // Deliberately says "dry" so we can prove the chosen source wins.
    minutely_15: { time: [new Date().toISOString().slice(0,16)], precipitation: [0], precipitation_probability: [0] },
    daily: { time: DATES, weather_code: [0,0,0,0,0,0,0],
      temperature_2m_max: HIGHS, temperature_2m_min: LOWS,
      precipitation_probability_max: [10,10,10,10,10,10,10],
      sunrise: DATES.map(d=>`${d}T07:00`), sunset: DATES.map(d=>`${d}T19:00`),
      uv_index_max: [7,7,7,7,7,7,7] } });
}

// NWS grid: wet in ~2 hours, expressed as ISO intervals like the real API.
function nwsGridBody() {
  const base = Math.floor(Date.now() / 3600000) * 3600000;
  const iso = (ms) => new Date(ms).toISOString().replace('.000Z', '+00:00');
  return { properties: {
    probabilityOfPrecipitation: { values: [
      { validTime: `${iso(base)}/PT2H`, value: 5 },
      { validTime: `${iso(base + 2*3600000)}/PT3H`, value: 85 },
      { validTime: `${iso(base + 5*3600000)}/PT6H`, value: 10 },
    ]},
    quantitativePrecipitation: { values: [
      { validTime: `${iso(base)}/PT2H`, value: 0 },
      { validTime: `${iso(base + 2*3600000)}/PT3H`, value: 6 },   // 2mm/hour
      { validTime: `${iso(base + 5*3600000)}/PT6H`, value: 0 },
    ]},
  }};
}

function metnoBody() {
  const base = Math.floor(Date.now() / 3600000) * 3600000;
  const series = [];
  for (let i = 0; i < 12; i++) {
    series.push({ time: new Date(base + i * 3600000).toISOString(),
      data: { next_1_hours: { details: {
        precipitation_amount: i === 1 ? 1.4 : 0,
        probability_of_precipitation: i === 1 ? 90 : 5 } } } });
  }
  return { properties: { timeseries: series } };
}

const NWS_POINT = { properties: {
  gridId:'EWX', gridX:100, gridY:90, radarStation:'KEWX',
  forecast:'https://api.weather.gov/gridpoints/EWX/100,90/forecast',
  forecastHourly:'https://api.weather.gov/gridpoints/EWX/100,90/forecast/hourly',
  forecastGridData:'https://api.weather.gov/gridpoints/EWX/100,90',
  observationStations:'https://api.weather.gov/gridpoints/EWX/100,90/stations' } };

function periods() {
  const out = [];
  DATES.forEach((d,i)=>{
    out.push({ startTime:`${d}T06:00:00-05:00`, isDaytime:true, temperature:HIGHS[i],
      probabilityOfPrecipitation:{value:20}, shortForecast:'Sunny' });
    out.push({ startTime:`${d}T18:00:00-05:00`, isDaytime:false, temperature:LOWS[i],
      probabilityOfPrecipitation:{value:10}, shortForecast:'Clear' });
  });
  return out;
}

function stubNws(page, { grid = true } = {}) {
  return page.route('https://api.weather.gov/**', (r) => {
    const u = r.request().url();
    const j = (b) => r.fulfill({ contentType:'application/geo+json', body: JSON.stringify(b) });
    if (u.includes('/points/')) return j(NWS_POINT);
    if (/gridpoints\/EWX\/100,90$/.test(u.split('?')[0])) {
      return grid ? j(nwsGridBody()) : r.fulfill({ status: 500, body: '{}' });
    }
    if (u.includes('/stations') && !u.includes('/observations')) return j({ features: [
      { properties:{ stationIdentifier:'KAUS' }, geometry:{ type:'Point', coordinates:[-97.70,30.30] } } ]});
    if (u.includes('/observations/latest')) return j({ properties: {
      temperature:{value:26.7}, relativeHumidity:{value:50}, windSpeed:{value:12.9},
      windDirection:{value:180}, textDescription:'Sunny',
      timestamp: new Date(Date.now() - 4*60000).toISOString() } });
    if (u.includes('/forecast')) return j({ properties: { periods: periods() } });
    if (u.includes('/alerts')) return j({ features: [] });
    return j({});
  });
}

(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER });
  let failures = 0;
  const check = async (n, fn) => {
    try { const ok = await fn(); console.log((ok?'PASS':'FAIL') + ' - ' + n); if(!ok) failures++; }
    catch (e) { console.log('FAIL - ' + n + ' (' + e.message.split('\n')[0] + ')'); failures++; }
  };

  const mk = async () => {
    const ctx = await browser.newContext({ viewport:{width:1280,height:1000}, serviceWorkers:'block' });
    const page = await ctx.newPage();
    // Deny every external host by default. Routes registered after this one
    // win, so each suite still stubs what it needs - but anything a suite
    // forgot fails closed instead of quietly reaching the real internet.
    // A predicate, not a glob: 'https://**' matches nothing at all.
    await page.route((u) => u.protocol === 'https:', (r) => r.abort());
    await page.route('https://opengeo.ncep.noaa.gov/**', r => r.fulfill({contentType:'image/png', body:PNG}));
    await page.route('https://basemaps.cartocdn.com/**', r => r.fulfill({contentType:'image/png', body:PNG}));
    await page.route('https://air-quality-api.open-meteo.com/**', r => r.fulfill({contentType:'application/json',
      body: JSON.stringify({current:{us_aqi:30,pm2_5:5,pm10:9,ozone:40,nitrogen_dioxide:4}})}));
    await page.route('https://geocoding-api.open-meteo.com/**', r => r.fulfill({contentType:'application/json',
      body: JSON.stringify({results:[{name:'Austin',admin1:'Texas',country_code:'US',latitude:AUSTIN.lat,longitude:AUSTIN.lon}]})}));
    await page.route('https://api.open-meteo.com/**', r => r.fulfill({contentType:'application/json', body: omBody()}));
    return { ctx, page };
  };

  const load = async (page) => {
    await page.goto(BASE_URL + '/index.html', { waitUntil:'networkidle' });
    await page.fill('#searchInput','Austin');
    await page.click('#searchBtn');
    await page.waitForSelector('#weatherPanels:not([hidden])', { timeout: 20000 });
    await page.waitForTimeout(3000);
  };

  console.log('=== Version ===');
  let { ctx, page } = await mk();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type()==='error' && !/Failed to load resource/.test(m.text())) errors.push('CONSOLE: '+m.text()); });
  const metnoCalls = [];
  await page.route('https://api.met.no/**', r => { metnoCalls.push(r.request().url()); return r.fulfill({contentType:'application/json', body: JSON.stringify(metnoBody())}); });
  await stubNws(page);
  await load(page);
  await check(`badge reads ${APP_VERSION}`, async () => (await page.textContent('#appVersion')).trim() === APP_VERSION);

  console.log('\n=== Rain comes from the NWS forecast grid in the US ===');
  await check('nowcast names the NWS forecast grid', async () =>
    /NWS forecast grid/.test(await page.textContent('#nowcastPrecision')));
  await check('MET Norway was not needed for a US point', () => metnoCalls.length === 0);
  await check('predicts rain from the grid, not the dry Open-Meteo series', async () => {
    const t = await page.textContent('#nowcastText');
    return /starting/i.test(t) && !/Nothing falling/i.test(t);
  });
  await check('grid intervals expanded to hourly slots', async () =>
    page.evaluate(async () => {
      const s = await WTWRain.getSeries({ lat: 30.2672, lon: -97.7431,
        nwsPoint: { gridDataUrl: 'https://api.weather.gov/gridpoints/EWX/100,90' } });
      if (!s || s.source !== 'nws-grid') return false;
      // A PT3H interval carrying 6 mm must become 3 slots of 2 mm.
      const wet = s.slots.filter((x) => x.mm > 0);
      return wet.length === 3 && Math.abs(wet[0].mm - 2) < 0.001;
    }));
  await check('probability is repeated, not divided, across an interval', async () =>
    page.evaluate(async () => {
      const s = await WTWRain.getSeries({ lat: 30.2672, lon: -97.7431,
        nwsPoint: { gridDataUrl: 'https://api.weather.gov/gridpoints/EWX/100,90' } });
      const high = s.slots.filter((x) => x.prob === 85);
      return high.length === 3;
    }));
  await ctx.close();

  console.log('\n=== Falls back to MET Norway, not Open-Meteo ===');
  ({ ctx, page } = await mk());
  const metnoCalls2 = [];
  await page.route('https://api.met.no/**', r => { metnoCalls2.push(r.request().url()); return r.fulfill({contentType:'application/json', body: JSON.stringify(metnoBody())}); });
  await stubNws(page, { grid: false });      // grid unavailable
  await load(page);
  await check('MET Norway was queried', () => metnoCalls2.length > 0);
  await check('MET Norway request carries 4-decimal coordinates', () => {
    const u = new URL(metnoCalls2[0]);
    return /^-?\d+\.\d{4}$/.test(u.searchParams.get('lat')) &&
           /^-?\d+\.\d{4}$/.test(u.searchParams.get('lon'));
  });
  await check('nowcast credits MET Norway', async () =>
    /MET Norway/.test(await page.textContent('#nowcastPrecision')));
  await check('uses MET Norway values over the dry Open-Meteo series', async () =>
    /starting/i.test(await page.textContent('#nowcastText')));
  await ctx.close();

  console.log('\n=== Last resort is Open-Meteo, and it says so ===');
  ({ ctx, page } = await mk());
  await page.route('https://api.met.no/**', r => r.abort());
  await stubNws(page, { grid: false });
  await load(page);
  await check('falls through to Open-Meteo', async () =>
    /Open-Meteo/.test(await page.textContent('#nowcastPrecision')));
  await ctx.close();

  console.log('\n=== Temperature trend chart ===');
  ({ ctx, page } = await mk());
  await page.route('https://api.met.no/**', r => r.fulfill({contentType:'application/json', body: JSON.stringify(metnoBody())}));
  await stubNws(page);
  await load(page);

  await check('High / Low is an activatable control', async () =>
    (await page.getAttribute('#wxHiLoStat', 'role')) === 'button' &&
    (await page.getAttribute('#wxHiLoStat', 'tabindex')) === '0');
  await check('modal is closed initially', async () => !(await page.isVisible('#tempModal')));
  await check('clicking High / Low opens the chart', async () => {
    await page.click('#wxHiLoStat');
    await page.waitForTimeout(600);
    return page.isVisible('#tempModal');
  });
  await check('chart canvas is drawn', async () =>
    page.evaluate(() => {
      const c = document.getElementById('tempChartCanvas');
      if (!c.width) return false;
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let lit = 0;
      for (let i = 3; i < d.length; i += 4 * 91) if (d[i] > 0) lit++;
      return lit > 60;
    }));
  await check("summary names the place and today's range", async () => {
    const t = await page.textContent('#tempModalSummary');
    return /Austin/.test(t) && /95°/.test(t) && /72°/.test(t);
  });
  await check('scroll is locked behind the modal', async () =>
    page.evaluate(() => document.body.classList.contains('modal-open')));
  await check('Escape closes it', async () => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    return !(await page.isVisible('#tempModal')) &&
           !(await page.evaluate(() => document.body.classList.contains('modal-open')));
  });
  await check('keyboard activation opens it', async () => {
    await page.locator('#wxHiLoStat').focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    const open = await page.isVisible('#tempModal');
    return open;
  });
  await check('overlay click closes it', async () => {
    await page.locator('#tempModalOverlay').click({ position: { x: 5, y: 5 } });
    await page.waitForTimeout(500);
    return !(await page.isVisible('#tempModal'));
  });
  await check('chart follows the unit setting', async () => {
    await page.click('#settingsBtn');
    await page.selectOption('#unitsSelect', 'metric');
    await page.waitForTimeout(800);
    await page.click('#settingsCloseBtn');
    await page.waitForTimeout(400);
    await page.click('#wxHiLoStat');
    await page.waitForTimeout(600);
    // 95F = 35C, 72F = 22C
    const t = await page.textContent('#tempModalSummary');
    return /35°/.test(t) && /22°/.test(t);
  });
  await page.screenshot({ path: __dirname + '/v12-chart.png' });
  await page.keyboard.press('Escape');
  await page.click('#settingsBtn');
  await page.selectOption('#unitsSelect', 'imperial');
  await page.waitForTimeout(600);
  await page.click('#settingsCloseBtn');

  console.log('\n=== Layout ===');
  await check('no horizontal overflow at desktop width', () =>
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(900);
  await page.click('#wxHiLoStat');
  await page.waitForTimeout(700);
  await check('modal fits a phone screen', async () => {
    const b = await page.locator('#tempModal').boundingBox();
    return b.width <= 375 && b.x >= -1;
  });
  await check('no horizontal overflow on mobile with the modal open', () =>
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.screenshot({ path: __dirname + '/v12-chart-mobile.png' });

  console.log(errors.length ? '\nJS ERRORS:\n  ' + errors.join('\n  ') : '\nNo JS errors.');
  if (errors.length) failures++;
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll V12 checks passed.');
  await browser.close();
  process.exit(failures ? 1 : 0);
})();
