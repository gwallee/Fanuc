/* V20: drawn interface icons, and a sky that moves.

   Two things worth proving here, because both are easy to get subtly
   wrong and neither shouts when it does.

   The icons: emoji rendered at the platform's whim and sat on the
   baseline. The replacements have to actually be SVG, take the
   button's own colour rather than a hard-coded one, and — the part a
   screenshot would not catch — leave the buttons still labelled for a
   screen reader. An icon that is announced as "search magnifying
   glass search" is worse than the emoji was.

   The sky: it must match the weather rather than merely move, it must
   stop when nobody is looking at it, and it must obey a system that
   has asked for stillness. A decoration that keeps a phone's GPU busy
   in a pocket is a bug, not a flourish. */
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

/* One knob: the weather code. Everything else is the same boring day,
   so a difference on screen can only have come from the code. */
function omBody(code) {
  const hTime = [], temp = [], pop = [], hCode = [], wind = [], vis = [];
  for (let d = -1; d < 7; d++) {
    for (let hour = 0; hour < 24; hour++) {
      hTime.push(`${isoDate(d)}T${String(hour).padStart(2, '0')}:00`);
      temp.push(70); pop.push(20); hCode.push(code); wind.push(6); vis.push(16093);
    }
  }
  const time = [], max = [], min = [], dCode = [], dPop = [],
        sunrise = [], sunset = [], uv = [];
  for (let d = -1; d < 7; d++) {
    time.push(isoDate(d)); max.push(80); min.push(64); dCode.push(code); dPop.push(20);
    sunrise.push(isoDate(d) + 'T06:30'); sunset.push(isoDate(d) + 'T19:30'); uv.push(5);
  }
  return JSON.stringify({
    current: { temperature_2m: 72, apparent_temperature: 73, relative_humidity_2m: 50,
               weather_code: code, wind_speed_10m: 8, wind_direction_10m: 180, is_day: 1,
               pressure_msl: 1014, dew_point_2m: 52 },
    hourly: { time: hTime, temperature_2m: temp, precipitation_probability: pop,
              weather_code: hCode, wind_speed_10m: wind, visibility: vis },
    daily: { time, weather_code: dCode, temperature_2m_max: max, temperature_2m_min: min,
             precipitation_probability_max: dPop, sunrise, sunset, uv_index_max: uv } });
}

(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER });
  let failures = 0;
  const check = async (n, fn) => {
    try { const ok = await fn(); console.log((ok ? 'PASS' : 'FAIL') + ' - ' + n); if (!ok) failures++; }
    catch (e) { console.log('FAIL - ' + n + ' (' + e.message.split('\n')[0] + ')'); failures++; }
  };

  const mk = async ({ code = 0, reduceMotion } = {}) => {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 950 },
      serviceWorkers: 'block',
      reducedMotion: reduceMotion ? 'reduce' : 'no-preference',
    });
    const page = await ctx.newPage();
    await page.route((u) => u.protocol === 'https:', (r) => r.abort());
    await page.route('https://api.open-meteo.com/**', (r) => r.fulfill({
      contentType: 'application/json', body: omBody(code) }));
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

  console.log('=== The buttons carry drawn icons, not emoji ===');
  let { ctx, page, errors } = await mk();
  await check(`badge reads ${APP_VERSION}`, async () =>
    (await page.textContent('#appVersion')).trim() === APP_VERSION);

  const HEADER = [['searchBtn', 'search'], ['geoBtn', 'location'],
                  ['downloadBtn', 'download'], ['settingsBtn', 'settings']];
  for (const [id, name] of HEADER) {
    await check(`#${id} shows the ${name} icon`, async () =>
      (await page.locator(`#${id} svg.ui-icon[data-ui="${name}"]`).count()) === 1);
  }
  await check('the account button shows one too when signed out', async () =>
    (await page.locator('#accountBtnIcon svg.ui-icon[data-ui="account"]').count()) === 1);

  await check('no emoji is left in any header button', async () => {
    const text = await page.locator('.tool-row').textContent();
    return !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u.test(text);
  });

  await check('the icons are inline SVG, not images that could fail to load', async () =>
    page.evaluate(() => [...document.querySelectorAll('.ui-icon')]
      .every((el) => el instanceof SVGElement)));

  await check('they take the button’s own colour rather than a fixed one', async () =>
    page.evaluate(() => {
      const svg = document.querySelector('#searchBtn .ui-icon');
      const btn = document.getElementById('searchBtn');
      return getComputedStyle(svg).stroke === getComputedStyle(btn).color;
    }));

  await check('a labelled button is still announced by its label, once', async () => {
    const label = await page.getAttribute('#geoBtn', 'aria-label');
    const hidden = await page.getAttribute('#geoBtn svg.ui-icon', 'aria-hidden');
    return label === 'Use my location' && hidden === 'true';
  });

  await check('the buttons are still big enough to hit', async () =>
    page.evaluate(() => [...document.querySelectorAll('.tool-row .btn')]
      .every((b) => b.getBoundingClientRect().height >= 32)));

  console.log('\n=== And in settings ===');
  await check('settings opens', async () => {
    await page.click('#settingsBtn');
    await page.waitForTimeout(500);
    return page.isVisible('#settingsPanel');
  });
  const IN_SETTINGS = [['settingsCloseBtn', 'close'], ['clearRoastLogBtn', 'trash'],
                       ['settingsDownloadBtn', 'download'], ['forceUpdateBtn', 'refresh']];
  for (const [id, name] of IN_SETTINGS) {
    await check(`#${id} shows the ${name} icon`, async () =>
      (await page.locator(`#${id} svg.ui-icon[data-ui="${name}"]`).count()) === 1);
  }
  await check('the Settings heading is drawn too', async () =>
    (await page.locator('.settings-head h2 svg.ui-icon[data-ui="settings"]').count()) === 1);
  await check('no emoji is left on any settings button', async () => {
    const texts = await page.locator('#settingsPanel .btn').allTextContents();
    return texts.every((t) => !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u.test(t));
  });
  await ctx.close();

  console.log('\n=== The sky underneath matches the weather ===');
  ({ ctx, page, errors } = await mk({ code: 0 }));            // clear
  await check('a clear sky gets the clear scene', async () =>
    (await page.getAttribute('#wxScene', 'data-scene')) === 'clear');
  await check('it sits under the temperature, inside the hero', async () =>
    page.evaluate(() => {
      const scene = document.getElementById('wxScene');
      const temp = document.getElementById('wxTemp');
      return scene.closest('.current-main') !== null &&
             scene.getBoundingClientRect().top > temp.getBoundingClientRect().bottom;
    }));
  await check('it is hidden from screen readers — it says nothing', async () =>
    (await page.getAttribute('#wxScene', 'aria-hidden')) === 'true');
  await check('and it does not swallow taps meant for the card', async () =>
    page.evaluate(() =>
      getComputedStyle(document.getElementById('wxScene')).pointerEvents === 'none'));
  await check('it is actually painting frames', async () => {
    await page.waitForTimeout(400);
    return page.evaluate(() => window.WTWScene && WTWScene.isRunning());
  });
  await check('the canvas has real pixels in it, not an empty box', async () =>
    page.evaluate(() => {
      const c = document.getElementById('wxSceneCanvas');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
      return false;
    }));
  await check('and it stops when the tab goes away', async () => {
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(200);
    return page.evaluate(() => !WTWScene.isRunning());
  });
  await ctx.close();

  console.log('\n=== A different sky for different weather ===');
  const SKIES = [[61, 'rain'], [71, 'snow'], [95, 'storm'], [45, 'fog'], [3, 'clouds']];
  for (const [code, expected] of SKIES) {
    const c = await mk({ code });
    await check(`code ${code} draws the ${expected} scene`, async () =>
      (await c.page.getAttribute('#wxScene', 'data-scene')) === expected);
    await c.ctx.close();
  }

  /* The icon set names the weather; the scene map has to answer for
     every one of those names. A name with no scene falls back to
     cloud, which is the sort of thing that goes unnoticed for months
     — so ask directly rather than eyeballing five codes. */
  const gap = await mk();
  await check('every weather the icons know has a sky of its own', async () =>
    gap.page.evaluate(() => {
      const scenes = WTWScene.scenes();
      const missing = [];
      for (let code = 0; code <= 99; code++) {
        const name = WTWIcons.nameFor(code);
        if (name !== 'unknown' && !(name in scenes)) missing.push(name);
      }
      return missing.length === 0;
    }));
  await gap.ctx.close();

  console.log('\n=== Stillness when the system asks for it ===');
  ({ ctx, page, errors } = await mk({ code: 61, reduceMotion: true }));
  await check('reduced motion means no animation loop', async () => {
    await page.waitForTimeout(500);
    return page.evaluate(() => !WTWScene.isRunning());
  });
  await check('but the picture is still drawn, not left blank', async () =>
    page.evaluate(() => {
      const c = document.getElementById('wxSceneCanvas');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
      return false;
    }));
  await ctx.close();

  console.log('\n=== Turning it off, and having that stick ===');
  ({ ctx, page, errors } = await mk({ code: 61 }));
  await check('the setting is on out of the box', async () => {
    await page.click('#settingsBtn');
    await page.waitForTimeout(400);
    return page.isChecked('#sceneToggle');
  });
  await check('switching it off hides it and parks the loop', async () => {
    await page.uncheck('#sceneToggle');
    await page.waitForTimeout(400);
    return (await page.getAttribute('#wxScene', 'hidden')) !== null &&
           (await page.evaluate(() => !WTWScene.isRunning()));
  });
  await check('and it is still off after a reload', async () => {
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1800);
    return (await page.getAttribute('#wxScene', 'hidden')) !== null;
  });
  await check('switching it back on brings it back', async () => {
    await page.click('#settingsBtn');
    await page.waitForTimeout(400);
    await page.check('#sceneToggle');
    await page.waitForTimeout(500);
    return (await page.getAttribute('#wxScene', 'hidden')) === null &&
           (await page.evaluate(() => WTWScene.isRunning()));
  });
  await ctx.close();

  console.log('\n=== The name on the tin ===');
  ({ ctx, page, errors } = await mk());
  await check('the page is called Aither Weather', async () =>
    /Aither Weather/.test(await page.title()) && !/Wether Weather|What the Wether/i.test(await page.title()));
  await check('so is the footer', async () =>
    /Aither Weather/.test(await page.textContent('footer')));
  await check('nothing anywhere still says What the Wether', async () =>
    !/What the Wether/i.test(await page.textContent('body')));
  await check('no horizontal overflow on a phone', async () => {
    await page.setViewportSize({ width: 375, height: 780 });
    await page.waitForTimeout(700);
    return page.evaluate(() =>
      document.documentElement.scrollWidth <= window.innerWidth + 1);
  });
  await check('no JS errors', () => errors.length === 0);
  if (errors.length) console.log(errors.join('\n'));
  await ctx.close();

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll V20 checks passed.');
  await browser.close();
  process.exit(failures ? 1 : 0);
})();
