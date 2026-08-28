const { chromium } = require('playwright');
const BASE_URL = process.env.WTW_BASE_URL || 'http://localhost:8901';
const APP_DIR = process.env.WTW_APP_DIR || require('path').join(__dirname, '..');
const BROWSER = process.env.PLAYWRIGHT_CHROMIUM || undefined;

(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  // Deny every external host by default; the stubs below are registered
  // afterwards and so take precedence. Anything unstubbed fails closed
  // rather than reaching the real internet on a CI runner.
  await page.route('https://**', (r) => r.abort());
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_TUNNEL|ERR_FAILED|net::/.test(m.text())) errors.push('CONSOLE: ' + m.text()); });

  await page.route('https://geocoding-api.open-meteo.com/**', (r) => r.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ results: [{ name: 'Austin', admin1: 'Texas', country_code: 'US', latitude: 30.2672, longitude: -97.7431 }] }) }));
  await page.route('https://api.open-meteo.com/**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({
    current: { temperature_2m: 91.4, apparent_temperature: 97.1, relative_humidity_2m: 58, weather_code: 95, wind_speed_10m: 12.3, wind_direction_10m: 160, is_day: 1 },
    daily: { time: ['2026-08-28','2026-08-29','2026-08-30','2026-08-31','2026-09-01','2026-09-02','2026-09-03'],
      weather_code: [95,80,3,0,61,2,1], temperature_2m_max: [95,92,90,93,88,91,94], temperature_2m_min: [75,74,72,73,70,72,74],
      precipitation_probability_max: [90,60,20,5,70,10,0] } }) }));
  await page.route('https://api.weather.gov/**', (r) => r.fulfill({ status: 404, body: '{}' }));

  const check = async (n, fn) => {
    try { const ok = await fn(); console.log((ok?'PASS':'FAIL') + ' - ' + n); if(!ok) process.exitCode = 1; }
    catch (e) { console.log('FAIL - ' + n + ' (' + e.message.split('\n')[0] + ')'); process.exitCode = 1; }
  };

  await page.goto(BASE_URL + '/index.html', { waitUntil: 'networkidle' });
  await page.fill('#searchInput', 'Austin');
  await page.click('#searchBtn');
  await page.waitForSelector('#weatherPanels:not([hidden])', { timeout: 20000 });
  await page.waitForTimeout(2000);

  await check('roast is inside the weather card', () =>
    page.evaluate(() => !!document.getElementById('currentCard').querySelector('#roastText')));
  await check('separate roast card is gone', async () =>
    (await page.locator('.roast-card').count()) === 0);
  await check('roast sits below the weather stats', () => page.evaluate(() => {
    const stats = document.querySelector('.wx-stats').getBoundingClientRect();
    const roast = document.querySelector('.roast-inline').getBoundingClientRect();
    return roast.top >= stats.bottom - 1;
  }));
  await check('roast text rendered (auto-roast)', async () => {
    const t = await page.textContent('#roastText');
    return t && t.length > 20 && !t.startsWith('Load some weather');
  });
  await check('roast button still works', async () => {
    const a = await page.textContent('#roastText');
    await page.click('#roastBtn');
    const b = await page.textContent('#roastText');
    return a !== b && b.length > 10;
  });
  await check('personality badge shows', async () =>
    /mode/i.test(await page.textContent('#roastPersonality')));
  await check('personality change re-roasts in place', async () => {
    await page.click('#settingsBtn');
    await page.selectOption('#personalitySelect', 'brutal');
    await page.waitForTimeout(400);
    await page.click('#settingsCloseBtn');
    await page.waitForTimeout(900);
    return /Brutal/i.test(await page.textContent('#roastPersonality'));
  });
  await check('no horizontal overflow at desktop width', () =>
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.waitForTimeout(3200); // let the toast clear
  await page.screenshot({ path: __dirname + '/roast-desktop.png', fullPage: true });

  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(700);
  await check('no horizontal overflow on mobile', () =>
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await check('roast still inside weather card on mobile', () =>
    page.evaluate(() => !!document.getElementById('currentCard').querySelector('#roastBtn')));
  await page.screenshot({ path: __dirname + '/roast-mobile.png' });

  console.log(errors.length ? '\nJS ERRORS:\n  ' + errors.join('\n  ') : '\nNo JS errors.');
  if (errors.length) process.exitCode = 1;
  await browser.close();
})();
