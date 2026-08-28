/* V11: units, air quality, compare dashboard, rain nowcast. */
const { chromium } = require('playwright');
const BASE_URL = process.env.WTW_BASE_URL || 'http://localhost:8901';
const APP_DIR = process.env.WTW_APP_DIR || require('path').join(__dirname, '..');
const BROWSER = process.env.PLAYWRIGHT_CHROMIUM || undefined;

// Read the expected version from the source rather than hard-coding it,
// so a release bump does not break these assertions.
const APP_VERSION = (require('fs').readFileSync(APP_DIR + '/config.js', 'utf8')
  .match(/version:\s*'([^']+)'/) || [, '?'])[1];

const fs = require('fs');
const PNG = fs.readFileSync(__dirname + '/fixture-radar-frame.png');
const AUSTIN = { lat: 30.2672, lon: -97.7431 };
const DATES = ['2026-08-28','2026-08-29','2026-08-30','2026-08-31','2026-09-01','2026-09-02','2026-09-03'];

function omBody({ rainSoon = true } = {}) {
  const t = [], temps = [], pops = [], codes = [], winds = [], vis = [];
  const start = Date.now();
  for (let i = 0; i < 50; i++) {
    t.push(new Date(start + i * 3600000).toISOString().slice(0, 16));
    temps.push(68); pops.push(10); codes.push(0); winds.push(10); vis.push(16093);
  }
  // 15-minute series: dry now, wet starting ~45 min out for ~1 hour.
  const mt = [], mp = [], mprob = [];
  for (let i = 0; i < 24; i++) {
    const when = new Date(Math.floor(Date.now() / 900000) * 900000 + i * 900000);
    mt.push(when.toISOString().slice(0, 16));
    const wet = rainSoon && i >= 3 && i < 7;
    mp.push(wet ? 0.8 : 0);
    mprob.push(wet ? 80 : 5);
  }
  return JSON.stringify({
    current: { temperature_2m: 68.0, apparent_temperature: 66, relative_humidity_2m: 44,
      weather_code: 0, wind_speed_10m: 10, wind_direction_10m: 90, is_day: 1,
      pressure_msl: 1013.2, dew_point_2m: 50.0 },
    hourly: { time: t, temperature_2m: temps, precipitation_probability: pops,
      weather_code: codes, wind_speed_10m: winds, visibility: vis },
    minutely_15: { time: mt, precipitation: mp, precipitation_probability: mprob },
    daily: { time: DATES, weather_code: [0,0,0,0,0,0,0],
      temperature_2m_max: [86,86,86,86,86,86,86], temperature_2m_min: [50,50,50,50,50,50,50],
      precipitation_probability_max: [30,30,30,30,30,30,30],
      sunrise: DATES.map(d=>`${d}T07:00`), sunset: DATES.map(d=>`${d}T19:00`),
      uv_index_max: [8,8,8,8,8,8,8] } });
}

const AIR_BODY = JSON.stringify({ current: {
  us_aqi: 42, pm2_5: 8.4, pm10: 17.9, ozone: 61.2, nitrogen_dioxide: 9.1,
  sulphur_dioxide: 2, carbon_monoxide: 130,
  alder_pollen: null, birch_pollen: null, grass_pollen: null,
  mugwort_pollen: null, olive_pollen: null, ragweed_pollen: null } });

(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER });
  let failures = 0;
  const check = async (n, fn) => {
    try { const ok = await fn(); console.log((ok?'PASS':'FAIL') + ' - ' + n); if(!ok) failures++; }
    catch (e) { console.log('FAIL - ' + n + ' (' + e.message.split('\n')[0] + ')'); failures++; }
  };

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  // Deny every external host by default. Routes registered after this one
  // win, so each suite still stubs what it needs - but anything a suite
  // forgot fails closed instead of quietly reaching the real internet.
  // A predicate, not a glob: 'https://**' matches nothing at all.
  await page.route((u) => u.protocol === 'https:', (r) => r.abort());
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_TUNNEL|ERR_FAILED|net::/.test(m.text())) errors.push('CONSOLE: ' + m.text()); });

  const airCalls = [], compareCalls = [];
  await page.route('https://opengeo.ncep.noaa.gov/**', (r) => r.fulfill({ contentType: 'image/png', body: PNG }));
  await page.route('https://basemaps.cartocdn.com/**', (r) => r.fulfill({ contentType: 'image/png', body: PNG }));
  await page.route('https://air-quality-api.open-meteo.com/**', (r) => {
    airCalls.push(r.request().url());
    return r.fulfill({ contentType: 'application/json', body: AIR_BODY });
  });
  await page.route('https://geocoding-api.open-meteo.com/**', (r) => r.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ results: [{ name: 'Austin', admin1: 'Texas', country_code: 'US', latitude: AUSTIN.lat, longitude: AUSTIN.lon }] }) }));
  await page.route('https://api.open-meteo.com/**', (r) => {
    if (r.request().url().includes('forecast_days=1')) compareCalls.push(r.request().url());
    return r.fulfill({ contentType: 'application/json', body: omBody() });
  });
  await page.route('https://api.weather.gov/**', (r) => r.fulfill({ status: 404, body: '{}' }));

  await page.goto(BASE_URL + '/index.html', { waitUntil: 'networkidle' });
  await page.fill('#searchInput', 'Austin');
  await page.click('#searchBtn');
  await page.waitForSelector('#weatherPanels:not([hidden])', { timeout: 20000 });
  await page.waitForTimeout(3000);

  console.log('=== Version ===');
  await check(`badge reads ${APP_VERSION}`, async () => (await page.textContent('#appVersion')).trim() === APP_VERSION);

  console.log('\n=== Units: imperial (default) ===');
  await check('temperature in F', async () => (await page.textContent('#wxTemp')).trim() === '68°');
  await check('wind in mph', async () => (await page.textContent('#wxWind')).trim() === '10 mph');
  await check('pressure in inHg', async () => /in$/.test((await page.textContent('#wxPressure')).trim()));
  await check('visibility in miles', async () => /mi$/.test((await page.textContent('#wxVisibility')).trim()));
  await check('radar range in miles', async () => /mi$/.test((await page.textContent('#radarRange')).trim()));
  const roastImperial = await page.textContent('#roastText');

  console.log('\n=== Units: switch to metric ===');
  await page.click('#settingsBtn');
  await page.selectOption('#unitsSelect', 'metric');
  await page.waitForTimeout(900);
  await page.click('#settingsCloseBtn');
  await page.waitForTimeout(600);
  await check('temperature converts to C (68F = 20C)', async () =>
    (await page.textContent('#wxTemp')).trim() === '20°');
  await check('wind converts to km/h (10mph = 16km/h)', async () =>
    (await page.textContent('#wxWind')).trim() === '16 km/h');
  await check('pressure converts to mb', async () =>
    /^\d{3,4} mb$/.test((await page.textContent('#wxPressure')).trim()));
  await check('visibility converts to km (10mi = 16km)', async () =>
    (await page.textContent('#wxVisibility')).trim() === '16 km');
  await check('dew point converts (50F = 10C)', async () =>
    (await page.textContent('#wxDew')).trim() === '10°');
  await check('high/low convert (86/50F = 30/10C)', async () =>
    (await page.textContent('#wxHiLo')).trim() === '30° / 10°');
  await check('radar range switches to km', async () =>
    /km$/.test((await page.textContent('#radarRange')).trim()));
  await check('forecast cards convert too', async () =>
    /30°/.test(await page.locator('.forecast-card').first().innerText()));
  await check('roasts are re-rendered in metric', async () => {
    await page.click('#roastBtn');
    await page.waitForTimeout(300);
    const t = await page.textContent('#roastText');
    return !/°F/.test(t) && (/°C/.test(t) || !/°/.test(t));
  });
  await check('no stray Fahrenheit in the visible weather panels', async () => {
    // Only visible text: the roast history keeps the units each line was
    // written in, and the settings picker names both systems.
    const visible = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('#weatherPanels *').forEach((el) => {
        if (el.children.length) return;
        if (!el.offsetParent && el.tagName !== 'CANVAS') return;   // skip hidden
        out.push(el.textContent || '');
      });
      return out.join(' | ');
    });
    return !/°F|\bmph\b/.test(visible);
  });

  console.log('\n=== 24-hour clock ===');
  await page.click('#settingsBtn');
  await page.selectOption('#clockSelect', '24');
  await page.waitForTimeout(800);
  await page.click('#settingsCloseBtn');
  await check('sunset uses 24-hour time', async () =>
    (await page.textContent('#wxSunset')).trim() === '19:00');
  await check('no AM/PM left in the detail row', async () =>
    !/AM|PM/.test(await page.textContent('.wx-detail')));

  // Back to imperial/12h for the remaining checks.
  await page.click('#settingsBtn');
  await page.selectOption('#unitsSelect', 'imperial');
  await page.selectOption('#clockSelect', '12');
  await page.waitForTimeout(700);
  await page.click('#settingsCloseBtn');
  await page.waitForTimeout(500);

  console.log('\n=== Air & sky ===');
  await check('air quality was requested', () => airCalls.length > 0);
  await check('air card is visible', () => page.isVisible('#airCard'));
  await check('AQI value shown', async () => (await page.textContent('#aqiBadge')).trim() === '42');
  await check('AQI category is Good with the right class', async () =>
    (await page.textContent('#aqiLabel')).trim() === 'Good' &&
    (await page.getAttribute('#aqiBadge', 'class')).includes('aqi-good'));
  await check('pollutants rendered', async () =>
    /µg/.test(await page.textContent('#aqPm25')) && /µg/.test(await page.textContent('#aqOzone')));
  await check('pollen row hidden where the model has no data', async () =>
    !(await page.isVisible('#pollenRow')));
  await check('daylight length computed (07:00-19:00 = 12h)', async () =>
    (await page.textContent('#skyDaylight')).trim() === '12h 0m');
  await check('solar noon is the midpoint (1:00 PM)', async () =>
    (await page.textContent('#skySolarNoon')).trim() === '1:00 PM');
  await check('moon phase shown with illumination', async () =>
    (await page.textContent('#moonName')).trim().length > 3 &&
    /%\s*lit/.test(await page.textContent('#moonIllum')));

  console.log('\n=== Rain nowcast ===');
  await check('nowcast panel visible', () => page.isVisible('#nowcastPanel'));
  await check('predicts rain starting soon', async () => {
    const t = await page.textContent('#nowcastText');
    return /starting in about/i.test(t);
  });
  await check('states its data resolution honestly', async () =>
    /15-minute/.test(await page.textContent('#nowcastPrecision')));
  await check('nowcast strip painted', async () =>
    page.evaluate(() => {
      const c = document.getElementById('nowcastStrip');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let lit = 0;
      for (let i = 3; i < d.length; i += 4 * 53) if (d[i] > 0) lit++;
      return lit > 20;
    }));

  console.log('\n=== Compare dashboard ===');
  await check('empty state before any favorites', () => page.isVisible('#compareEmpty'));
  await page.click('#saveFavBtn');
  await check('saving a favorite populates the grid', async () => {
    await page.waitForSelector('.compare-tile', { timeout: 10000 });
    return (await page.locator('.compare-tile').count()) === 1;
  });
  await check('compare used a compact request', () => compareCalls.length > 0);
  await check('compare card shows temp and conditions', async () => {
    const t = await page.locator('.compare-tile').first().innerText();
    return /68°/.test(t) && /Clear/i.test(t);
  });
  await check('compare respects the unit setting', async () => {
    await page.click('#settingsBtn');
    await page.selectOption('#unitsSelect', 'metric');
    await page.waitForTimeout(900);
    await page.click('#settingsCloseBtn');
    await page.waitForTimeout(500);
    const t = await page.locator('.compare-tile').first().innerText();
    return /20°/.test(t);
  });
  await page.click('#settingsBtn');
  await page.selectOption('#unitsSelect', 'imperial');
  await page.waitForTimeout(700);
  await page.click('#settingsCloseBtn');
  await check('clicking a compare card loads that location', async () => {
    await page.locator('.compare-tile').first().click();
    await page.waitForTimeout(2500);
    return /Austin/.test(await page.textContent('#wxCity'));
  });
  await check('removing the favorite empties the grid', async () => {
    await page.locator('.fav-remove').first().click();
    await page.waitForSelector('.compare-tile', { state: 'detached', timeout: 10000 });
    return (await page.locator('.compare-tile').count()) === 0 && await page.isVisible('#compareEmpty');
  });

  console.log('\n=== Notifications setting ===');
  await check('alert notification toggle exists and is off by default', async () => {
    await page.click('#settingsBtn');
    return (await page.isVisible('#alertNotifyToggle')) &&
           !(await page.isChecked('#alertNotifyToggle'));
  });
  await check('denied permission leaves the toggle off', async () => {
    await page.evaluate(() => {
      window.Notification = function () {};
      window.Notification.permission = 'denied';
      window.Notification.requestPermission = () => Promise.resolve('denied');
    });
    await page.click('#alertNotifyToggle');
    await page.waitForTimeout(500);
    const checked = await page.isChecked('#alertNotifyToggle');
    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('wtw:settings') || '{}').alertNotifications);
    return !checked && !stored;
  });
  await page.click('#settingsCloseBtn');

  console.log('\n=== Layout ===');
  await check('no horizontal overflow at desktop width', () =>
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.screenshot({ path: __dirname + '/v11-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(1200);
  await check('no horizontal overflow on mobile', async () => {
    const r = await page.evaluate(() => {
      const out = { scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth, who: [] };
      document.querySelectorAll('*').forEach((el) => {
        const b = el.getBoundingClientRect();
        if (b.right > window.innerWidth + 1) {
          const p = el.parentElement, pr = p && p.getBoundingClientRect();
          if (!pr || pr.right <= window.innerWidth + 1) {
            out.who.push(`${el.tagName}#${el.id}.${(el.className||'').toString().slice(0,30)} right=${Math.round(b.right)}`);
          }
        }
      });
      return out;
    });
    if (r.scrollW > r.innerW + 1) console.log('    overflow from:', r.who.join(' , '));
    return r.scrollW <= r.innerW + 1;
  });
  await page.screenshot({ path: __dirname + '/v11-mobile.png', fullPage: true });

  console.log(errors.length ? '\nJS ERRORS:\n  ' + errors.join('\n  ') : '\nNo JS errors.');
  if (errors.length) failures++;
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll V11 checks passed.');
  await browser.close();
  process.exit(failures ? 1 : 0);
})();
