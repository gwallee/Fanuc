/* Smoke test for Aither Weather V8 using Playwright. */
const { chromium } = require('playwright');
const BASE_URL = process.env.WTW_BASE_URL || 'http://localhost:8901';
const APP_DIR = process.env.WTW_APP_DIR || require('path').join(__dirname, '..');
const BROWSER = process.env.PLAYWRIGHT_CHROMIUM || undefined;


(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER });
  const errors = [];
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    permissions: [],
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  // Deny every external host by default. Routes registered after this one
  // win, so each suite still stubs what it needs - but anything a suite
  // forgot fails closed instead of quietly reaching the real internet.
  // A predicate, not a glob: 'https://**' matches nothing at all.
  await page.route((u) => u.protocol === 'https:', (r) => r.abort());
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => {
    // Resource-load failures are stub/network noise, not app errors.
    if (m.type() === 'error' && !/Failed to load resource|ERR_TUNNEL|ERR_FAILED|net::/.test(m.text())) errors.push('CONSOLE: ' + m.text());
  });


  // ---- Stub the key-less APIs (sandbox proxy blocks them; real world doesn't) ----
  const forecastBody = JSON.stringify({
    current: { temperature_2m: 91.4, apparent_temperature: 97.1, relative_humidity_2m: 58,
      weather_code: 80, wind_speed_10m: 12.3, wind_direction_10m: 160, is_day: 1 },
    daily: {
      time: ['2026-08-28','2026-08-29','2026-08-30','2026-08-31','2026-09-01','2026-09-02','2026-09-03'],
      weather_code: [80, 95, 3, 0, 61, 2, 1],
      temperature_2m_max: [95, 92, 90, 93, 88, 91, 94],
      temperature_2m_min: [75, 74, 72, 73, 70, 72, 74],
      precipitation_probability_max: [60, 90, 20, 5, 70, 10, 0]
    }
  });
  await page.route('https://api.open-meteo.com/**', (r) =>
    r.fulfill({ contentType: 'application/json', body: forecastBody }));
  await page.route('https://geocoding-api.open-meteo.com/**', (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({
      results: [{ name: 'Austin', admin1: 'Texas', country_code: 'US', latitude: 30.2672, longitude: -97.7431 }]
    }) }));
  await page.route('https://api.zippopotam.us/**', (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({
      places: [{ 'place name': 'Beverly Hills', 'state abbreviation': 'CA', latitude: '34.0901', longitude: '-118.4065' }]
    }) }));
  await page.goto(BASE_URL + '/index.html', { waitUntil: 'networkidle' });

  const check = async (name, fn) => {
    try {
      const ok = await fn();
      console.log((ok ? 'PASS' : 'FAIL') + ' - ' + name);
      if (!ok) process.exitCode = 1;
    } catch (e) {
      console.log('FAIL - ' + name + ' (' + e.message.split('\n')[0] + ')');
      process.exitCode = 1;
    }
  };

  await check('welcome panel visible on first run', () => page.isVisible('#welcomePanel'));
  await check('username default rendered', async () =>
    (await page.textContent('.brand-greeting strong')) === 'DJTheBest');
  await check('radar status SCANNING (autoplay)', async () =>
    (await page.textContent('#radarStatusText')) === 'SCANNING');

  // Search for a real city (network via proxy)
  await page.fill('#searchInput', 'Austin');
  await page.click('#searchBtn');
  await page.waitForSelector('#weatherPanels:not([hidden])', { timeout: 20000 }).catch(() => {});
  await check('weather panels shown after search', () => page.isVisible('#currentCard'));
  // The dashboard is hidden until a location loads, so the radar is
  // measured here rather than on the welcome screen.
  await check('radar canvas has size', async () => {
    const box = await page.locator('#radarCanvas').boundingBox();
    return box && box.width > 100;
  });
  await check('temperature rendered', async () => {
    const t = await page.textContent('#wxTemp');
    return /-?\d+°/.test(t);
  });
  await check('7-day forecast rendered', async () =>
    (await page.locator('.forecast-card').count()) === 7);
  await check('roast generated (auto-roast)', async () => {
    const t = await page.textContent('#roastText');
    return t && t.length > 20 && !t.startsWith('Load some weather');
  });

  // Roast again → different text (anti-repeat)
  const roast1 = await page.textContent('#roastText');
  await page.click('#roastBtn');
  const roast2 = await page.textContent('#roastText');
  await check('roast button produces a new roast', async () => roast1 !== roast2 && roast2.length > 10);

  // Favorites
  await page.click('#saveFavBtn');
  await check('favorite saved', async () => (await page.locator('.fav-item').count()) === 1);
  await check('save button shows saved state', async () =>
    (await page.textContent('#saveFavBtn')).includes('Saved'));

  // Settings: username change
  await page.click('#settingsBtn');
  await check('settings panel opens', async () =>
    page.locator('#settingsPanel.open').isVisible());
  await page.fill('#usernameInput', 'StormLord');
  await page.click('#usernameSaveBtn');
  await check('username updates everywhere', async () =>
    (await page.textContent('.brand-greeting strong')) === 'StormLord');

  // Theme switching
  await page.selectOption("#themeSelect", "light");
  await page.waitForTimeout(600);
  await check('light theme applied', async () =>
    (await page.getAttribute('html', 'data-theme')) === 'light');
  const bgLight = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.selectOption("#themeSelect", "midnight");
  await page.waitForTimeout(600);
  await check('midnight theme applied', async () =>
    (await page.getAttribute('html', 'data-theme')) === 'midnight');
  const bgMid = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await check('themes actually change colors', async () => bgLight !== bgMid);
  await page.selectOption('#themeSelect', 'neon-dark');
  await page.click('#settingsCloseBtn');

  // Radar controls
  await page.click('#radarPlayBtn'); // pause
  await check('radar pause works', async () =>
    (await page.textContent('#radarStatusText')) === 'PAUSED');
  await page.click('#radarPlayBtn'); // play
  await check('radar play works', async () =>
    (await page.textContent('#radarStatusText')) === 'SCANNING');
  await page.click('#radarStopBtn');
  await check('radar stop works', async () =>
    (await page.textContent('#radarStatusText')) === 'PAUSED');
  await page.locator('#radarTimeline').fill('30');
  await check('timeline label updates on scrub', async () =>
    (await page.textContent('#radarTimeLabel')) === '-30 min');

  // Refresh button
  await page.click('#refreshBtn');
  await page.waitForTimeout(2500);
  await check('refresh keeps weather visible', () => page.isVisible('#wxTemp'));

  // State restore on reload
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await check('state restored after reload (last location)', async () =>
    page.isVisible('#weatherPanels') &&
    /Austin/.test(await page.textContent('#wxCity')));
  await check('username persisted after reload', async () =>
    (await page.textContent('.brand-greeting strong')) === 'StormLord');
  await check('favorite persisted after reload', async () =>
    (await page.locator('.fav-item').count()) === 1);

  // Remove favorite
  await page.click('.fav-remove');
  await check('favorite removed', async () =>
    (await page.locator('.fav-item').count()) === 0);

  // ZIP search
  await page.fill('#searchInput', '90210');
  await page.click('#searchBtn');
  await page.waitForTimeout(4000);
  await check('ZIP search loads Beverly Hills', async () =>
    /Beverly Hills/.test(await page.textContent('#wxCity')));

  // Mobile viewport: no horizontal overflow
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(800);
  await check('no horizontal overflow on iPhone-size screen', async () =>
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await check('radar fits mobile screen', async () => {
    const box = await page.locator('#radarCanvas').boundingBox();
    return box && box.width <= 375 && box.width > 150;
  });

  await page.screenshot({ path: '/tmp/claude-0/-home-user-Fanuc/1812e88f-5b28-5086-b5b5-8c7cc81a4b08/scratchpad/mobile.png' });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/claude-0/-home-user-Fanuc/1812e88f-5b28-5086-b5b5-8c7cc81a4b08/scratchpad/desktop.png', fullPage: true });

  if (errors.length) {
    console.log('\nJS ERRORS:');
    errors.forEach((e) => console.log('  ' + e));
    process.exitCode = 1;
  } else {
    console.log('\nNo JS errors on page.');
  }
  await browser.close();
})();
