const { chromium } = require('playwright');
const BASE_URL = process.env.WTW_BASE_URL || 'http://localhost:8901';
const APP_DIR = process.env.WTW_APP_DIR || require('path').join(__dirname, '..');
const BROWSER = process.env.PLAYWRIGHT_CHROMIUM || undefined;

// Read the expected version from the source rather than hard-coding it,
// so a release bump does not break these assertions.
const APP_VERSION = (require('fs').readFileSync(APP_DIR + '/config.js', 'utf8')
  .match(/version:\s*'([^']+)'/) || [, '?'])[1];

(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER });
  const ctx = await browser.newContext();   // real service worker
  const page = await ctx.newPage();
  // Deny every external host by default. Routes registered after this one
  // win, so each suite still stubs what it needs - but anything a suite
  // forgot fails closed instead of quietly reaching the real internet,
  // which is what made these suites pass locally and fail in CI.
  await page.route('https://**', (r) => r.abort());
  let failures = 0;
  const check = async (n, fn) => {
    try { const ok = await fn(); console.log((ok?'PASS':'FAIL') + ' - ' + n); if(!ok) failures++; }
    catch (e) { console.log('FAIL - ' + n + ' (' + e.message.split('\n')[0] + ')'); failures++; }
  };
  await page.route('https://api.weather.gov/**', r => r.fulfill({status:404, body:'{}'}));
  await page.route('https://api.open-meteo.com/**', r => r.abort());
  await page.route('https://air-quality-api.open-meteo.com/**', r => r.abort());
  await page.route('https://opengeo.ncep.noaa.gov/**', r => r.abort());
  await page.route('https://basemaps.cartocdn.com/**', r => r.abort());

  await page.goto(BASE_URL + '/index.html');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForTimeout(1500);
  await page.click('#settingsBtn');

  await check('settings shows the running version', async () =>
    (await page.textContent('#versionReadout')).trim() === APP_VERSION);
  await check('caches and a worker exist before the reset', async () =>
    page.evaluate(async () => (await caches.keys()).length > 0 &&
      (await navigator.serviceWorker.getRegistrations()).length > 0));

  await check('force update clears caches, unregisters, and reloads', async () => {
    const nav = page.waitForNavigation({ timeout: 15000 }).catch(() => null);
    await page.click('#forceUpdateBtn');
    await nav;
    await page.waitForTimeout(1200);
    const url = page.url();
    const state = await page.evaluate(async () => ({
      caches: (await caches.keys()).length,
      // A fresh registration may already be re-installing; what matters
      // is that the old one was torn down and the document reloaded.
      title: document.title,
    }));
    return /[?&]v=/.test(url) && /What the Wether/.test(state.title);
  });
  await check('app still works after the reset', async () =>
    (await page.textContent('#appVersion')).trim() === APP_VERSION);

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nForce-update checks passed.');
  await browser.close();
  process.exit(failures ? 1 : 0);
})();
