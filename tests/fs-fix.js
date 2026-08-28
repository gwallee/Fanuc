/* Regression tests for the fullscreen + stale-cache fixes. */
const { chromium } = require('playwright');
const BASE_URL = process.env.WTW_BASE_URL || 'http://localhost:8901';
const APP_DIR = process.env.WTW_APP_DIR || require('path').join(__dirname, '..');
const BROWSER = process.env.PLAYWRIGHT_CHROMIUM || undefined;

const fs = require('fs');
const PNG = fs.readFileSync(__dirname + '/fixture-radar-frame.png');

function stub(page) {
  page.route('https://opengeo.ncep.noaa.gov/**', r => r.fulfill({contentType:'image/png', body:PNG}));
  page.route('https://basemaps.cartocdn.com/**', r => r.fulfill({contentType:'image/png', body:PNG}));
  page.route('https://air-quality-api.open-meteo.com/**', r => r.fulfill({contentType:'application/json',
    body: JSON.stringify({current:{us_aqi:42,pm2_5:8,pm10:18,ozone:61,nitrogen_dioxide:9}})}));
  page.route('https://api.weather.gov/**', r => r.fulfill({status:404, body:'{}'}));
  page.route('https://geocoding-api.open-meteo.com/**', r => r.fulfill({contentType:'application/json',
    body: JSON.stringify({results:[{name:'Austin',admin1:'Texas',country_code:'US',latitude:30.2672,longitude:-97.7431}]})}));
  page.route('https://api.open-meteo.com/**', r => r.fulfill({contentType:'application/json', body: JSON.stringify({
    current:{temperature_2m:68,apparent_temperature:66,relative_humidity_2m:44,weather_code:0,wind_speed_10m:10,wind_direction_10m:90,is_day:1,pressure_msl:1013,dew_point_2m:50},
    hourly:{time:['2026-08-28T03:00'],temperature_2m:[68],precipitation_probability:[10],weather_code:[0],wind_speed_10m:[10],visibility:[16093]},
    minutely_15:{time:['2026-08-28T03:00'],precipitation:[0],precipitation_probability:[5]},
    daily:{time:['2026-08-28'],weather_code:[0],temperature_2m_max:[86],temperature_2m_min:[50],precipitation_probability_max:[30],sunrise:['2026-08-28T07:00'],sunset:['2026-08-28T19:00'],uv_index_max:[8]}})}));
}

(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER });
  let failures = 0;
  const check = async (n, fn) => {
    try { const ok = await fn(); console.log((ok?'PASS':'FAIL') + ' - ' + n); if(!ok) failures++; }
    catch (e) { console.log('FAIL - ' + n + ' (' + e.message.split('\n')[0] + ')'); failures++; }
  };

  console.log('=== Native fullscreen actually engages ===');
  let ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  let page = await ctx.newPage();
  // Deny every external host by default. Routes registered after this one
  // win, so each suite still stubs what it needs - but anything a suite
  // forgot fails closed instead of quietly reaching the real internet.
  // A predicate, not a glob: 'https://**' matches nothing at all.
  await page.route((u) => u.protocol === 'https:', (r) => r.abort());
  stub(page);
  await page.goto(BASE_URL + '/index.html');
  await page.fill('#searchInput','Austin'); await page.click('#searchBtn');
  await page.waitForSelector('#weatherPanels:not([hidden])');
  await page.waitForTimeout(2200);
  const inlineW = (await page.locator('#radarCanvas').boundingBox()).width;

  await page.locator('#radarCanvas').click();
  await page.waitForTimeout(1000);
  await check('document.fullscreenElement is the radar card', async () =>
    (await page.evaluate(() => document.fullscreenElement && document.fullscreenElement.id)) === 'radarCard');
  await check('card fills the viewport', async () => {
    const b = await page.locator('#radarCard').boundingBox();
    return Math.round(b.width) === 1280 && Math.round(b.height) === 900;
  });
  await check('canvas grew well beyond its inline size', async () =>
    (await page.locator('#radarCanvas').boundingBox()).width > inlineW + 100);
  await check('exiting releases native fullscreen', async () => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(900);
    const el = await page.evaluate(() => document.fullscreenElement);
    const cls = await page.evaluate(() => document.getElementById('radarCard').classList.contains('fullscreen'));
    return !el && !cls;
  });

  console.log('\n=== Overlay still works when the native API is unavailable ===');
  await page.evaluate(() => {
    // Simulate iOS Safari: no Fullscreen API for non-video elements.
    const card = document.getElementById('radarCard');
    card.requestFullscreen = undefined;
    card.webkitRequestFullscreen = undefined;
  });
  await page.locator('#radarCanvas').click();
  await page.waitForTimeout(900);
  await check('overlay class applied without the native API', async () =>
    page.evaluate(() => document.getElementById('radarCard').classList.contains('fullscreen')));
  await check('overlay still fills the viewport', async () => {
    const b = await page.locator('#radarCard').boundingBox();
    return Math.round(b.width) === 1280 && Math.round(b.height) >= 890;
  });
  await check('canvas is large in overlay mode', async () =>
    (await page.locator('#radarCanvas').boundingBox()).width > inlineW + 100);
  await page.locator('#radarCanvas').click();
  await page.waitForTimeout(700);
  await ctx.close();

  console.log('\n=== Stale-shell fix: the document is network-first ===');
  ctx = await browser.newContext();   // real service worker
  page = await ctx.newPage();
  // Deny every external host by default. Routes registered after this one
  // win, so each suite still stubs what it needs - but anything a suite
  // forgot fails closed instead of quietly reaching the real internet.
  // A predicate, not a glob: 'https://**' matches nothing at all.
  await page.route((u) => u.protocol === 'https:', (r) => r.abort());
  await page.goto(BASE_URL + '/index.html');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForTimeout(1800);

  await check('document requests are served fresh, not from cache', async () => {
    // Poison the shell cache with an obviously stale document, then
    // reload: network-first must ignore it.
    await page.evaluate(async (docUrl) => {
      const keys = await caches.keys();
      const shell = keys.find((k) => k.endsWith('-shell'));
      const cache = await caches.open(shell);
      await cache.put(docUrl,
        new Response('<html><body>STALE COPY</body></html>',
          { headers: { 'Content-Type': 'text/html' } }));
    }, BASE_URL + '/index.html');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    const body = await page.textContent('body');
    return !/STALE COPY/.test(body) && /What the Wether/.test(await page.title());
  });

  await check('the poisoned entry still serves the app when offline', async () => {
    // Network-first falls back to cache; the cache was refreshed by the
    // successful load above, so offline must show the real app.
    await ctx.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const ok = /What the Wether/.test(await page.title());
    await ctx.setOffline(false);
    return ok;
  });
  await ctx.close();

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll fullscreen/cache checks passed.');
  await browser.close();
  process.exit(failures ? 1 : 0);
})();
