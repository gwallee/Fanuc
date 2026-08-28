/* V13: search picker, radar loop pausing, accessibility. */
const { chromium } = require('playwright');
const BASE_URL = process.env.WTW_BASE_URL || 'http://localhost:8901';
const APP_DIR = process.env.WTW_APP_DIR || require('path').join(__dirname, '..');
const BROWSER = process.env.PLAYWRIGHT_CHROMIUM || undefined;
const APP_VERSION = (require('fs').readFileSync(APP_DIR + '/config.js', 'utf8')
  .match(/version:\s*'([^']+)'/) || [, '?'])[1];
const fs = require('fs');
const PNG = fs.readFileSync(__dirname + '/fixture-radar-frame.png');

// Three real places that share a name — the exact case V12 got wrong.
const SPRINGFIELDS = { results: [
  { name: 'Springfield', admin1: 'Illinois', country: 'United States', latitude: 39.80, longitude: -89.64 },
  { name: 'Springfield', admin1: 'Missouri', country: 'United States', latitude: 37.21, longitude: -93.29 },
  { name: 'Springfield', admin1: 'Massachusetts', country: 'United States', latitude: 42.10, longitude: -72.59 },
]};

function omBody() {
  const t = [], temps = [];
  for (let i = 0; i < 30; i++) { t.push(new Date(Date.now()+i*3600000).toISOString().slice(0,16)); temps.push(70); }
  return JSON.stringify({
    current:{temperature_2m:70,apparent_temperature:70,relative_humidity_2m:50,weather_code:0,wind_speed_10m:6,wind_direction_10m:180,is_day:1,pressure_msl:1012,dew_point_2m:50},
    hourly:{time:t,temperature_2m:temps,precipitation_probability:t.map(()=>5),weather_code:t.map(()=>0),wind_speed_10m:t.map(()=>6),visibility:t.map(()=>16093)},
    daily:{time:['2026-08-28'],weather_code:[0],temperature_2m_max:[85],temperature_2m_min:[65],precipitation_probability_max:[10],sunrise:['2026-08-28T07:00'],sunset:['2026-08-28T19:00'],uv_index_max:[6]}});
}

(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER });
  let failures = 0;
  const check = async (n, fn) => {
    try { const ok = await fn(); console.log((ok?'PASS':'FAIL') + ' - ' + n); if(!ok) failures++; }
    catch (e) { console.log('FAIL - ' + n + ' (' + e.message.split('\n')[0] + ')'); failures++; }
  };

  const ctx = await browser.newContext({ viewport:{width:1280,height:1000}, serviceWorkers:'block' });
  const page = await ctx.newPage();
  // Deny every external host by default. Routes registered after this one
  // win, so each suite still stubs what it needs - but anything a suite
  // forgot fails closed instead of quietly reaching the real internet,
  // which is what made these suites pass locally and fail in CI.
  await page.route('https://**', (r) => r.abort());
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => {
    if (m.type()==='error' && !/Failed to load resource|ERR_TUNNEL|ERR_FAILED|net::/.test(m.text())) errors.push('CONSOLE: '+m.text());
  });
  const geoCalls = [];
  await page.route('https://geocoding-api.open-meteo.com/**', r => {
    geoCalls.push(r.request().url());
    return r.fulfill({ contentType:'application/json', body: JSON.stringify(SPRINGFIELDS) });
  });
  await page.route('https://api.open-meteo.com/**', r => r.fulfill({contentType:'application/json', body: omBody()}));
  await page.route('https://api.weather.gov/**', r => r.fulfill({status:404, body:'{}'}));
  await page.route('https://api.met.no/**', r => r.abort());
  await page.route('https://air-quality-api.open-meteo.com/**', r => r.abort());
  await page.route('https://api.rainviewer.com/**', r => r.abort());
  await page.route('https://opengeo.ncep.noaa.gov/**', r => r.fulfill({contentType:'image/png', body:PNG}));
  await page.route('https://basemaps.cartocdn.com/**', r => r.fulfill({contentType:'image/png', body:PNG}));
  await page.route('https://api.zippopotam.us/**', r => r.fulfill({contentType:'application/json',
    body: JSON.stringify({places:[{'place name':'Beverly Hills','state abbreviation':'CA',latitude:'34.0901',longitude:'-118.4065'}]})}));

  await page.goto(BASE_URL + '/index.html', { waitUntil:'networkidle' });

  console.log('=== Version ===');
  await check(`badge reads ${APP_VERSION}`, async () =>
    (await page.textContent('#appVersion')).trim() === APP_VERSION);

  console.log('\n=== Search offers the real candidates ===');
  await check('search box is a combobox', async () =>
    (await page.getAttribute('#searchInput', 'role')) === 'combobox' &&
    (await page.getAttribute('#searchInput', 'aria-expanded')) === 'false');
  await check('typing shows every matching place', async () => {
    await page.fill('#searchInput', 'Springfield');
    await page.waitForSelector('.search-result', { timeout: 8000 });
    return (await page.locator('.search-result').count()) === 3;
  });
  await check('candidates are disambiguated by region and country', async () => {
    const texts = await page.locator('.search-result').allInnerTexts();
    return texts.some(t => /Illinois/.test(t)) && texts.some(t => /Missouri/.test(t)) &&
           texts.some(t => /Massachusetts/.test(t)) && texts.every(t => /United States/.test(t));
  });
  await check('aria-expanded flips when the list opens', async () =>
    (await page.getAttribute('#searchInput', 'aria-expanded')) === 'true');
  await check('arrow keys move the active option', async () => {
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    const active = await page.locator('.search-result.active').innerText();
    const described = await page.getAttribute('#searchInput', 'aria-activedescendant');
    return /Missouri/.test(active) && !!described;
  });
  await check('Enter loads the highlighted candidate, not the first', async () => {
    await page.keyboard.press('Enter');
    await page.waitForSelector('#weatherPanels:not([hidden])', { timeout: 15000 });
    await page.waitForTimeout(2000);
    return /Missouri/.test(await page.textContent('#wxCity'));
  });
  await check('the picked place is remembered', async () =>
    page.evaluate(() => (JSON.parse(localStorage.getItem('wtw:recentSearches') || '[]')).length === 1));
  await check('focusing an empty box offers recent places', async () => {
    await page.click('#searchInput');
    await page.waitForTimeout(400);
    const heading = await page.locator('.search-heading').count();
    const items = await page.locator('.search-result').count();
    return heading === 1 && items === 1;
  });
  await check('Escape closes the list', async () => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    return !(await page.isVisible('#searchResults'));
  });
  await check('a ZIP skips the picker and loads directly', async () => {
    await page.fill('#searchInput', '90210');
    await page.click('#searchBtn');
    await page.waitForTimeout(3000);
    return /Beverly Hills/.test(await page.textContent('#wxCity'));
  });
  await check('search is debounced, not one request per keystroke', async () => {
    const before = geoCalls.length;
    await page.fill('#searchInput', '');
    await page.type('#searchInput', 'Springfield', { delay: 30 });
    await page.waitForTimeout(900);
    // 11 characters typed; a debounced box should issue far fewer calls.
    return (geoCalls.length - before) <= 3;
  });
  await page.keyboard.press('Escape');
  await page.fill('#searchInput', '');

  console.log('\n=== Radar stops animating when nothing can see it ===');
  await check('radar animates while visible', async () =>
    page.evaluate(() => WTWRadar.isAnimating()));
  await check('scrolling the scope away parks the loop', async () => {
    await page.evaluate(() => document.querySelector('.favorites-card').scrollIntoView());
    await page.waitForTimeout(1200);
    return page.evaluate(() => !WTWRadar.isAnimating());
  });
  await check('scrolling back resumes it', async () => {
    await page.evaluate(() => document.getElementById('radarCard').scrollIntoView());
    await page.waitForTimeout(1200);
    return page.evaluate(() => WTWRadar.isAnimating());
  });

  console.log('\n=== Accessibility ===');
  // Assert the property itself — first in the focus order — rather than
  // depending on where focus happened to be after earlier steps.
  await check('a skip link is the first focusable element', async () =>
    page.evaluate(() => {
      const sel = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';
      const first = document.querySelector(sel);
      return !!first && first.classList.contains('skip-link');
    }));
  await check('the skip link becomes visible on focus', async () => {
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      document.querySelector('.skip-link').focus();
    });
    // It slides in over 150ms; measuring immediately reads its parked position.
    await page.waitForTimeout(500);
    const top = await page.evaluate(() =>
      document.querySelector('.skip-link').getBoundingClientRect().top);
    const focused = await page.evaluate(() =>
      document.activeElement.classList.contains('skip-link'));
    return focused && top >= 0;
  });
  await check('a polite live region exists', async () =>
    (await page.getAttribute('#srAnnouncer', 'aria-live')) === 'polite' &&
    (await page.getAttribute('#srAnnouncer', 'role')) === 'status');
  await check('loading a place announces the conditions', async () => {
    await page.fill('#searchInput', '90210');
    await page.click('#searchBtn');
    await page.waitForTimeout(3000);
    const said = await page.textContent('#srAnnouncer');
    return /Beverly Hills/.test(said) && /°/.test(said) && /feels like/i.test(said);
  });
  await check('the announcement is not visible on screen', async () =>
    page.evaluate(() => {
      const el = document.getElementById('srAnnouncer');
      const r = el.getBoundingClientRect();
      return r.width <= 2 && r.height <= 2;
    }));

  console.log('\n=== Layout ===');
  await check('no horizontal overflow at desktop width', () =>
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(900);
  await check('search results fit a phone screen', async () => {
    await page.fill('#searchInput', 'Springfield');
    await page.waitForSelector('.search-result', { timeout: 8000 });
    const b = await page.locator('#searchResults').boundingBox();
    return b && b.width <= 375 && b.x >= -1;
  });
  await check('no horizontal overflow on mobile', () =>
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

  console.log(errors.length ? '\nJS ERRORS:\n  ' + errors.join('\n  ') : '\nNo JS errors.');
  if (errors.length) failures++;
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll V13 checks passed.');
  await browser.close();
  process.exit(failures ? 1 : 0);
})();
