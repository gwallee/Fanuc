/* Exercises the real service worker and the offline snapshot path. */
const { chromium } = require('playwright');
const BASE_URL = process.env.WTW_BASE_URL || 'http://localhost:8901';
const APP_DIR = process.env.WTW_APP_DIR || require('path').join(__dirname, '..');
const BROWSER = process.env.PLAYWRIGHT_CHROMIUM || undefined;


(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER });
  const ctx = await browser.newContext();   // service workers ENABLED
  const page = await ctx.newPage();
  // Deny every external host by default. Routes registered after this one
  // win, so each suite still stubs what it needs - but anything a suite
  // forgot fails closed instead of quietly reaching the real internet,
  // which is what made these suites pass locally and fail in CI.
  await page.route('https://**', (r) => r.abort());
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

  let failures = 0;
  const check = async (n, fn) => {
    try { const ok = await fn(); console.log((ok?'PASS':'FAIL') + ' - ' + n); if(!ok) failures++; }
    catch (e) { console.log('FAIL - ' + n + ' (' + e.message.split('\n')[0] + ')'); failures++; }
  };

  await page.goto(BASE_URL + '/index.html', { waitUntil: 'networkidle' });

  await check('service worker registers and activates', async () =>
    page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      return !!reg.active;
    }));

  await check('app shell is precached', async () => {
    await page.waitForTimeout(1500);
    return page.evaluate(async () => {
      const keys = await caches.keys();
      const shell = keys.find((k) => k.endsWith('-shell'));
      if (!shell) return false;
      const cache = await caches.open(shell);
      const reqs = await cache.keys();
      const paths = reqs.map((r) => new URL(r.url).pathname);
      return ['/index.html', '/app.js', '/styles.css', '/radar.js', '/map.js', '/hourly.js']
        .every((p) => paths.includes(p));
    });
  });

  // Seed a snapshot so the offline path has something to restore.
  await page.evaluate(() => {
    localStorage.setItem('wtw:snapshot', JSON.stringify({
      location: { name: 'Cached City, TX', lat: 30.2672, lon: -97.7431 },
      source: 'open-meteo',
      weather: { city: 'Cached City, TX', tempF: 64, feelsLikeF: 62, humidity: 51,
        windMph: 7, weatherCode: 3, precipProb: 20, highF: 70, lowF: 55, observedAt: null },
      daily: [{ dateISO: '2026-08-28', code: 3, highF: 70, lowF: 55, precipProb: 20 }],
      hours: [{ time: new Date().toISOString(), tempF: 64, precipProb: 20, code: 3, windMph: 7 }],
      detail: { sunrise: null, sunset: null, uvIndex: null },
      alerts: [], savedAt: Date.now(),
    }));
    localStorage.setItem('wtw:lastLocation', JSON.stringify({ name: 'Cached City, TX', lat: 30.2672, lon: -97.7431 }));
  });

  // Now go offline. The SW must answer with a 503 rather than throwing,
  // and the app must fall back to its snapshot.
  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  await check('app shell still loads offline (served from cache)', async () =>
    (await page.title()).includes('What the Wether'));
  await check('offline banner is shown', () => page.isVisible('#offlineBanner'));
  await check('snapshot forecast is restored', async () =>
    /Cached City/.test(await page.textContent('#wxCity')));
  await check('snapshot temperature is shown', async () =>
    (await page.textContent('#wxTemp')).trim() === '64°');
  await check('updated line says it is offline', async () =>
    /Offline/i.test(await page.textContent('#wxUpdated')));
  await check('service worker returns a 503, not a thrown fetch', async () =>
    page.evaluate(async () => {
      try {
        const r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=1&longitude=1');
        return r.status === 503;
      } catch (e) { return false; }
    }));
  await check('roasting still works with no network', async () => {
    await page.click('#roastBtn');
    await page.waitForTimeout(300);
    const t = await page.textContent('#roastText');
    return t && t.length > 20 && !/blank sky/.test(t);
  });

  await ctx.setOffline(false);
  console.log(errors.length ? '\nJS ERRORS:\n  ' + errors.join('\n  ') : '\nNo JS errors.');
  if (errors.length) failures++;
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll service worker / offline checks passed.');
  await browser.close();
  process.exit(failures ? 1 : 0);
})();
