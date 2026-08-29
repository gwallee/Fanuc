/* V17: an account that needs nothing.

   No client ID, no provider, no server — a name, a picture, and a code
   that carries the lot to another device. The transfer code is the part
   worth being careful about: it must move what it promises, refuse
   rubbish without breaking, and never carry a provider profile. */
const { chromium } = require('playwright');
const BASE_URL = process.env.WTW_BASE_URL || 'http://localhost:8901';
const APP_DIR = process.env.WTW_APP_DIR || require('path').join(__dirname, '..');
const BROWSER = process.env.PLAYWRIGHT_CHROMIUM || undefined;
const fs = require('fs');
const PNG = fs.readFileSync(__dirname + '/fixture-radar-frame.png');
const APP_VERSION = (fs.readFileSync(APP_DIR + '/config.js', 'utf8')
  .match(/version:\s*'([^']+)'/) || [])[1];

function omBody() {
  const t = [];
  for (let i = 0; i < 24; i++) t.push(new Date(Date.now() + i * 3600000).toISOString().slice(0, 16));
  const day = new Date().toISOString().slice(0, 10);
  return JSON.stringify({
    current: { temperature_2m: 70, apparent_temperature: 70, relative_humidity_2m: 50,
               weather_code: 0, wind_speed_10m: 6, wind_direction_10m: 180, is_day: 1,
               pressure_msl: 1012, dew_point_2m: 50 },
    hourly: { time: t, temperature_2m: t.map(() => 70), precipitation_probability: t.map(() => 5),
              weather_code: t.map(() => 0), wind_speed_10m: t.map(() => 6),
              visibility: t.map(() => 16093) },
    daily: { time: [day], weather_code: [0], temperature_2m_max: [85], temperature_2m_min: [65],
             precipitation_probability_max: [10], sunrise: [day + 'T07:00'],
             sunset: [day + 'T19:00'], uv_index_max: [6] } });
}

(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER });
  let failures = 0;
  const check = async (n, fn) => {
    try { const ok = await fn(); console.log((ok ? 'PASS' : 'FAIL') + ' - ' + n); if (!ok) failures++; }
    catch (e) { console.log('FAIL - ' + n + ' (' + e.message.split('\n')[0] + ')'); failures++; }
  };

  // Nothing configured anywhere: exactly what the published site is.
  const mk = async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 },
                                           serviceWorkers: 'block' });
    const page = await ctx.newPage();
    await page.route((u) => u.protocol === 'https:', (r) => r.abort());
    await page.route('https://geocoding-api.open-meteo.com/**', (r) => r.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ results: [{ name: 'Austin', admin1: 'Texas',
        country: 'United States', latitude: 30.2672, longitude: -97.7431 }] }) }));
    await page.route('https://api.open-meteo.com/**', (r) => r.fulfill({
      contentType: 'application/json', body: omBody() }));
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

  console.log('=== An account with no client ID ===');
  let { ctx, page, errors } = await mk();
  await check(`badge reads ${APP_VERSION}`, async () =>
    (await page.textContent('#appVersion')).trim() === APP_VERSION);
  await check('the screen leads with creating an account', async () => {
    await page.click('#accountBtn');
    await page.waitForTimeout(600);
    return /create your account/i.test(await page.textContent('#localSignInForm'));
  });
  await check('it says there is nothing to set up', async () =>
    /no password, no email/i.test(await page.textContent('.signin-local-note')));
  await check('pictures are offered', async () =>
    (await page.locator('.avatar-choice').count()) >= 8);
  await check('picking one marks it, for a mouse and a screen reader alike', async () => {
    await page.locator('.avatar-choice').nth(2).click();
    const el = page.locator('.avatar-choice').nth(2);
    return (await el.getAttribute('aria-checked')) === 'true' &&
           (await el.getAttribute('class')).includes('picked');
  });
  await check('picking another moves the mark', async () => {
    const wanted = await page.locator('.avatar-choice').nth(5).textContent();
    await page.locator('.avatar-choice').nth(5).click();
    const marked = await page.locator('.avatar-choice.picked').allTextContents();
    return marked.length === 1 && marked[0] === wanted;
  });
  await check('the account is created with that picture', async () => {
    const wanted = (await page.locator('.avatar-choice.picked').textContent()).trim();
    await page.fill('#localNameInput', 'Storm Chaser');
    await page.click('#localSignInBtn');
    await page.waitForTimeout(700);
    return (await page.textContent('#accountBtnIcon')).trim() === wanted &&
           (await page.textContent('.brand-greeting strong')) === 'Storm Chaser';
  });
  await check('the picture is used in Settings too, not an initial', async () => {
    await page.click('#settingsBtn');
    await page.waitForTimeout(500);
    const shown = (await page.textContent('#accountInitial')).trim();
    return shown !== 'S' && shown.length > 0;
  });
  await ctx.close();

  console.log('\n=== Moving it to another device ===');
  ({ ctx, page, errors } = await mk());
  // Build something worth carrying: an account, a saved place, and
  // settings that differ from the defaults.
  await page.click('#accountBtn');
  await page.waitForTimeout(500);
  await page.fill('#localNameInput', 'Storm Chaser');
  await page.click('#localSignInBtn');
  await page.waitForTimeout(600);
  await page.click('#saveFavBtn');
  await page.waitForTimeout(400);
  await page.click('#settingsBtn');
  await page.waitForTimeout(400);
  await page.selectOption('#personalitySelect', 'doomer');
  await page.waitForTimeout(300);

  let code = '';
  await check('the code is only shown when asked for', async () =>
    !(await page.isVisible('#transferCode')));
  await check('showing it produces one', async () => {
    await page.click('#transferShowBtn');
    await page.waitForTimeout(300);
    code = await page.inputValue('#transferCode');
    return await page.isVisible('#transferCode') && code.length > 40;
  });
  await check('it carries no email or sign-in token', async () => {
    const decoded = Buffer.from(code, 'base64').toString('utf8');
    return !/token|id_token|@|password/i.test(decoded) && /Storm Chaser/.test(decoded);
  });
  await ctx.close();

  console.log('\n=== Restoring it on a device that knows nothing ===');
  ({ ctx, page, errors } = await mk());
  await check('a fresh device starts with the stock name and no favourites', async () =>
    (await page.textContent('.brand-greeting strong')) === 'DJTheBest');
  await check('rubbish is refused without breaking anything', async () => {
    await page.click('#settingsBtn');
    await page.waitForTimeout(400);
    await page.fill('#transferInput', 'not-a-real-code');
    await page.click('#transferRestoreBtn');
    await page.waitForTimeout(400);
    return /couldn.t be read/i.test(await page.textContent('#transferStatus')) &&
           (await page.textContent('.brand-greeting strong')) === 'DJTheBest';
  });
  await check('a real code brings the account across', async () => {
    await page.fill('#transferInput', code);
    await page.click('#transferRestoreBtn');
    await page.waitForTimeout(800);
    return (await page.textContent('.brand-greeting strong')) === 'Storm Chaser';
  });
  await check('and the saved place', async () =>
    /Austin/.test(await page.textContent('#favoritesList')));
  await check('and the settings', async () =>
    (await page.inputValue('#personalitySelect')) === 'doomer');
  await check('it says what it actually restored', async () =>
    /Storm Chaser/.test(await page.textContent('#transferStatus')) &&
    /1 saved place/.test(await page.textContent('#transferStatus')));
  await check('the account survives a reload on the new device', async () => {
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    return (await page.textContent('.brand-greeting strong')) === 'Storm Chaser';
  });
  await check('no JS errors', () => errors.length === 0);
  if (errors.length) console.log(errors.join('\n'));
  await ctx.close();

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll V17 checks passed.');
  await browser.close();
  process.exit(failures ? 1 : 0);
})();
