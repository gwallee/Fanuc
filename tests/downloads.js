/* Downloads panel + the reorganised header. */
const { chromium } = require('playwright');
const BASE_URL = process.env.WTW_BASE_URL || 'http://localhost:8901';
const APP_DIR = process.env.WTW_APP_DIR || require('path').join(__dirname, '..');
const BROWSER = process.env.PLAYWRIGHT_CHROMIUM || undefined;
const fs = require('fs');
const PNG = fs.readFileSync(__dirname + '/fixture-radar-frame.png');

const RELEASE = {
  tag_name: 'v13.0.0',
  name: 'What the Wether v13.0.0',
  published_at: '2026-08-28T12:00:00Z',
  html_url: 'https://github.com/gwallee/What-The-Weather/releases/tag/v13.0.0',
  assets: [
    { name: 'WhatTheWether-Setup-13.0.0.exe', size: 82_100_000, browser_download_url: 'https://example.test/setup.exe' },
    { name: 'WhatTheWether-Portable-13.0.0.exe', size: 81_000_000, browser_download_url: 'https://example.test/portable.exe' },
    { name: 'WhatTheWether-13.0.0-arm64.dmg', size: 95_000_000, browser_download_url: 'https://example.test/arm.dmg' },
    { name: 'WhatTheWether-13.0.0-x64.dmg', size: 99_000_000, browser_download_url: 'https://example.test/x64.dmg' },
    { name: 'WhatTheWether-13.0.0.AppImage', size: 108_000_000, browser_download_url: 'https://example.test/app.AppImage' },
    { name: 'what-the-wether_13.0.0_amd64.deb', size: 74_000_000, browser_download_url: 'https://example.test/app.deb' },
    { name: 'what-the-wether-13.0.0.rpm', size: 75_000_000, browser_download_url: 'https://example.test/app.rpm' },
    // Noise electron-builder also uploads; must not be offered as downloads.
    { name: 'latest.yml', size: 400, browser_download_url: 'https://example.test/latest.yml' },
    { name: 'WhatTheWether-Setup-13.0.0.exe.blockmap', size: 90_000, browser_download_url: 'https://example.test/bm' },
  ],
};

function omBody() {
  const t = [];
  for (let i = 0; i < 24; i++) t.push(new Date(Date.now()+i*3600000).toISOString().slice(0,16));
  return JSON.stringify({
    current:{temperature_2m:70,apparent_temperature:70,relative_humidity_2m:50,weather_code:0,wind_speed_10m:6,wind_direction_10m:180,is_day:1,pressure_msl:1012,dew_point_2m:50},
    hourly:{time:t,temperature_2m:t.map(()=>70),precipitation_probability:t.map(()=>5),weather_code:t.map(()=>0),wind_speed_10m:t.map(()=>6),visibility:t.map(()=>16093)},
    daily:{time:['2026-08-28'],weather_code:[0],temperature_2m_max:[85],temperature_2m_min:[65],precipitation_probability_max:[10],sunrise:['2026-08-28T07:00'],sunset:['2026-08-28T19:00'],uv_index_max:[6]}});
}

(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER });
  let failures = 0;
  const check = async (n, fn) => {
    try { const ok = await fn(); console.log((ok?'PASS':'FAIL') + ' - ' + n); if(!ok) failures++; }
    catch (e) { console.log('FAIL - ' + n + ' (' + e.message.split('\n')[0] + ')'); failures++; }
  };

  const mk = async (releaseResponse) => {
    const ctx = await browser.newContext({ viewport:{width:1280,height:1000}, serviceWorkers:'block' });
    const page = await ctx.newPage();
    await page.route('https://api.github.com/**', (r) => releaseResponse(r));
    await page.route('https://geocoding-api.open-meteo.com/**', r => r.fulfill({contentType:'application/json',
      body: JSON.stringify({results:[{name:'Austin',admin1:'Texas',country:'United States',latitude:30.2672,longitude:-97.7431}]})}));
    await page.route('https://api.open-meteo.com/**', r => r.fulfill({contentType:'application/json', body: omBody()}));
    await page.route('https://api.weather.gov/**', r => r.fulfill({status:404, body:'{}'}));
    await page.route('https://api.met.no/**', r => r.abort());
    await page.route('https://air-quality-api.open-meteo.com/**', r => r.abort());
    await page.route('https://api.rainviewer.com/**', r => r.abort());
    await page.route('https://opengeo.ncep.noaa.gov/**', r => r.fulfill({contentType:'image/png', body:PNG}));
    await page.route('https://basemaps.cartocdn.com/**', r => r.fulfill({contentType:'image/png', body:PNG}));
    await page.goto(BASE_URL + '/index.html', { waitUntil:'networkidle' });
    return { ctx, page };
  };

  console.log('=== Header layout ===');
  let { ctx, page } = await mk((r) => r.fulfill({ contentType:'application/json', body: JSON.stringify(RELEASE) }));

  await check('search sits below the action buttons', async () => {
    const btn = await page.locator('#searchBtn').boundingBox();
    const input = await page.locator('#searchInput').boundingBox();
    return input.y > btn.y + btn.height - 2;
  });
  await check('action buttons share one row', async () => {
    const ys = await Promise.all(['#searchBtn','#geoBtn','#downloadBtn','#settingsBtn']
      .map(async (sel) => (await page.locator(sel).boundingBox()).y));
    return Math.max(...ys) - Math.min(...ys) < 3;
  });
  await check('header buttons are smaller than body buttons', async () => {
    const head = await page.locator('#searchBtn').boundingBox();
    const body = await page.locator('#welcomeGeoBtn').boundingBox();
    return head.height < body.height;
  });
  await check('header buttons stay comfortably tappable (>=32px)', async () => {
    const boxes = await Promise.all(['#searchBtn','#geoBtn','#downloadBtn','#settingsBtn']
      .map(async (sel) => (await page.locator(sel).boundingBox()).height));
    return boxes.every((h) => h >= 32);
  });
  await check('search field spans the tools column', async () => {
    const input = await page.locator('#searchInput').boundingBox();
    const row = await page.locator('.tool-row').boundingBox();
    return input.width >= row.width - 2;
  });

  console.log('\n=== Downloads from the site ===');
  await check('a download button is in the header', () => page.isVisible('#downloadBtn'));
  await check('the modal opens from the header', async () => {
    await page.click('#downloadBtn');
    await page.waitForTimeout(700);
    return page.isVisible('#downloadModal');
  });
  await check('real release assets are listed', async () => {
    await page.waitForSelector('.dl-asset', { timeout: 8000 });
    return (await page.locator('.dl-asset').count()) === 7;
  });
  await check('build noise (latest.yml, blockmap) is not offered', async () => {
    const text = await page.textContent('#downloadBody');
    return !/latest\.yml|blockmap/i.test(text);
  });
  await check('all three platforms are grouped', async () => {
    const heads = await page.locator('.dl-platform').allInnerTexts();
    return heads.includes('Windows') && heads.includes('macOS') && heads.includes('Linux');
  });
  await check('installer vs portable is spelled out', async () => {
    const text = await page.textContent('#downloadBody');
    return /Installer/.test(text) && /Portable/.test(text);
  });
  await check('sizes are shown', async () =>
    /\d+\.\d MB/.test(await page.textContent('#downloadBody')));
  await check('links point at the real asset URLs', async () =>
    (await page.locator('.dl-asset').first().getAttribute('href')).startsWith('https://example.test/'));
  await check("the visitor's own platform is highlighted", async () =>
    (await page.locator('.dl-group.dl-mine').count()) === 1);
  await check('linux is detected as this runner\'s platform', async () => {
    const mine = await page.locator('.dl-group.dl-mine .dl-platform').innerText();
    return mine === 'Linux';
  });
  await check('the unsigned-build caveat is stated', async () =>
    /unsigned/i.test(await page.textContent('#downloadBody')));
  await check('Escape closes it', async () => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    return !(await page.isVisible('#downloadModal'));
  });

  console.log('\n=== Downloads from settings and footer ===');
  await check('settings has a download entry that opens the modal', async () => {
    await page.click('#settingsBtn');
    await page.waitForTimeout(400);
    const visible = await page.isVisible('#settingsDownloadBtn');
    await page.click('#settingsDownloadBtn');
    await page.waitForTimeout(700);
    return visible && await page.isVisible('#downloadModal');
  });
  await check('opening from settings closes the settings panel', async () =>
    !(await page.evaluate(() => document.getElementById('settingsPanel').classList.contains('open'))));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await check('the footer link opens it too', async () => {
    await page.click('#footerDownloadLink');
    await page.waitForTimeout(700);
    return page.isVisible('#downloadModal');
  });
  await page.keyboard.press('Escape');
  await ctx.close();

  console.log('\n=== No release published yet ===');
  ({ ctx, page } = await mk((r) => r.fulfill({ status: 404, contentType:'application/json', body: '{"message":"Not Found"}' })));
  await page.click('#downloadBtn');
  await page.waitForTimeout(1200);
  await check('says plainly that nothing is published yet', async () => {
    const text = await page.textContent('#downloadBody');
    return /No desktop build has been published/i.test(text);
  });
  await check('offers no dead download links', async () =>
    (await page.locator('.dl-asset').count()) === 0);
  await check('still links to the releases page', async () =>
    (await page.locator('#downloadBody a').first().getAttribute('href')).includes('/releases'));
  await ctx.close();

  console.log('\n=== GitHub unreachable ===');
  ({ ctx, page } = await mk((r) => r.abort()));
  await page.click('#downloadBtn');
  await page.waitForTimeout(1500);
  await check('degrades to a plain message, not an error', async () =>
    /Couldn't reach GitHub/i.test(await page.textContent('#downloadBody')));
  await ctx.close();

  console.log('\n=== Mobile ===');
  ({ ctx, page } = await mk((r) => r.fulfill({ contentType:'application/json', body: JSON.stringify(RELEASE) })));
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(700);
  await check('no horizontal overflow with the new header', () =>
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await check('search still sits under the buttons on mobile', async () => {
    const btn = await page.locator('#searchBtn').boundingBox();
    const input = await page.locator('#searchInput').boundingBox();
    return input.y > btn.y;
  });
  await page.click('#downloadBtn');
  await page.waitForTimeout(1000);
  await check('the downloads modal fits a phone screen', async () => {
    const b = await page.locator('#downloadModal').boundingBox();
    return b.width <= 375 && b.x >= -1;
  });
  await check('no overflow with the modal open', () =>
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.screenshot({ path: '/tmp/claude-0/-home-user-Fanuc/1812e88f-5b28-5086-b5b5-8c7cc81a4b08/scratchpad/downloads-mobile.png' });
  await ctx.close();

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll download/header checks passed.');
  await browser.close();
  process.exit(failures ? 1 : 0);
})();
