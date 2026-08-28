/* Optional Google sign-in. */
const { chromium } = require('playwright');
const BASE_URL = process.env.WTW_BASE_URL || 'http://localhost:8901';
const APP_DIR = process.env.WTW_APP_DIR || require('path').join(__dirname, '..');
const BROWSER = process.env.PLAYWRIGHT_CHROMIUM || undefined;
const fs = require('fs');
const PNG = fs.readFileSync(__dirname + '/fixture-radar-frame.png');

// A Google ID token is three base64url segments; only the payload is read.
function fakeIdToken(payload) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(payload)}.notarealsignature`;
}

const PROFILE = {
  sub: '1234567890',
  name: 'Ada Lovelace',
  given_name: 'Ada',
  email: 'ada@example.com',
  picture: 'https://lh3.googleusercontent.com/fake-avatar',
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

  // clientId: null leaves it unconfigured (the shipped default).
  const mk = async (clientId) => {
    const ctx = await browser.newContext({ viewport:{width:1280,height:900}, serviceWorkers:'block' });
    const page = await ctx.newPage();
    if (clientId) {
      // Patch config before any app script runs.
      await page.addInitScript((id) => {
        const apply = () => {
          if (window.WTW_CONFIG && window.WTW_CONFIG.auth) {
            window.WTW_CONFIG.auth.googleClientId = id;
            return true;
          }
          return false;
        };
        Object.defineProperty(window, '__wtwPatch', { value: apply, writable: true });
        document.addEventListener('readystatechange', apply, true);
        const timer = setInterval(() => { if (apply()) clearInterval(timer); }, 5);
      }, clientId);
    }
    // Stand in for Google Identity Services.
    await page.route('https://accounts.google.com/gsi/client', (r) => r.fulfill({
      contentType: 'text/javascript',
      body: `
        window.google = { accounts: { id: {
          initialize: (opts) => { window.__gsiOpts = opts; },
          renderButton: (host) => {
            const b = document.createElement('button');
            b.id = 'fakeGoogleButton';
            b.textContent = 'Sign in with Google';
            b.addEventListener('click', () => window.__gsiOpts.callback({ credential: window.__fakeToken }));
            host.appendChild(b);
          },
          disableAutoSelect: () => { window.__autoSelectDisabled = true; },
        } } };
      `,
    }));
    await page.route('https://lh3.googleusercontent.com/**', (r) => r.fulfill({ contentType:'image/png', body: PNG }));
    await page.route('https://api.github.com/**', r => r.fulfill({status:404, body:'{}'}));
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
    await page.evaluate((tok) => { window.__fakeToken = tok; }, fakeIdToken(PROFILE));
    return { ctx, page };
  };

  console.log('=== Unconfigured: the app is unaffected ===');
  let { ctx, page } = await mk(null);
  await check('the app loads and works with no client ID', async () => {
    await page.fill('#searchInput', 'Austin');
    await page.click('#searchBtn');
    await page.waitForSelector('#weatherPanels:not([hidden])', { timeout: 15000 });
    return /Austin/.test(await page.textContent('#wxCity'));
  });
  await check('settings explains sign-in is off, with no dead button', async () => {
    await page.click('#settingsBtn');
    await page.waitForTimeout(700);
    const note = await page.textContent('#accountSignedOut');
    return /no Google client ID is set/i.test(note) &&
           (await page.locator('#fakeGoogleButton').count()) === 0;
  });
  await check("Google's script is not even fetched when unconfigured", async () =>
    page.evaluate(() => !document.querySelector('script[src*="accounts.google.com"]')));
  await check('the default username is untouched', async () =>
    (await page.textContent('.brand-greeting strong')) === 'DJTheBest');
  await ctx.close();

  console.log('\n=== Configured: signing in ===');
  ({ ctx, page } = await mk('test-client-id.apps.googleusercontent.com'));
  await page.fill('#searchInput', 'Austin');
  await page.click('#searchBtn');
  await page.waitForSelector('#weatherPanels:not([hidden])', { timeout: 15000 });
  await page.waitForTimeout(1500);
  await check('the sign-in button renders', async () => {
    await page.click('#settingsBtn');
    await page.waitForSelector('#fakeGoogleButton', { timeout: 8000 });
    return page.isVisible('#fakeGoogleButton');
  });
  await check('the client ID is passed to Google', async () =>
    (await page.evaluate(() => window.__gsiOpts && window.__gsiOpts.client_id)) ===
      'test-client-id.apps.googleusercontent.com');
  await check('auto sign-in is not enabled behind the scenes', async () =>
    (await page.evaluate(() => window.__gsiOpts && window.__gsiOpts.auto_select)) === false);
  await check('signing in shows the name and email', async () => {
    await page.click('#fakeGoogleButton');
    await page.waitForTimeout(700);
    return (await page.textContent('#accountName')) === 'Ada Lovelace' &&
           (await page.textContent('#accountEmail')) === 'ada@example.com';
  });
  await check('the signed-out block is replaced, not stacked', async () =>
    !(await page.isVisible('#accountSignedOut')) && await page.isVisible('#accountSignedIn'));
  await check('the avatar appears beside the greeting', async () =>
    page.isVisible('#brandAvatar'));
  await check('the username adopts the Google first name', async () =>
    (await page.textContent('.brand-greeting strong')) === 'Ada');
  await check('the roast uses the new name', async () => {
    await page.click('#settingsCloseBtn');
    await page.click('#roastBtn');
    await page.waitForTimeout(400);
    return /Ada/.test(await page.textContent('#roastText'));
  });
  await check('signing out clears the profile and the avatar', async () => {
    await page.click('#settingsBtn');
    await page.waitForTimeout(500);
    await page.click('#signOutBtn');
    await page.waitForTimeout(700);
    return await page.isVisible('#accountSignedOut') &&
           !(await page.isVisible('#accountSignedIn')) &&
           !(await page.isVisible('#brandAvatar'));
  });
  await check("signing out also clears Google's auto-select", async () =>
    page.evaluate(() => window.__autoSelectDisabled === true));
  await check('the profile is gone from storage', async () =>
    page.evaluate(() => localStorage.getItem('wtw:googleProfile') === null));
  await check('a sign-in button is offered again straight away', async () =>
    page.isVisible('#fakeGoogleButton'));
  await check('signing back in works without a reload', async () => {
    await page.click('#fakeGoogleButton');
    await page.waitForTimeout(700);
    return (await page.textContent('#accountName')) === 'Ada Lovelace';
  });
  await check('the profile survives a reload', async () => {
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1800);
    await page.click('#settingsBtn');
    await page.waitForTimeout(600);
    return (await page.textContent('#accountName')) === 'Ada Lovelace';
  });
  await ctx.close();

  console.log('\n=== A chosen username is never overwritten ===');
  ({ ctx, page } = await mk('test-client-id.apps.googleusercontent.com'));
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('wtw:settings') || '{}');
    s.username = 'StormLord';
    localStorage.setItem('wtw:settings', JSON.stringify(s));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.evaluate((tok) => { window.__fakeToken = tok; },
    fakeIdToken(PROFILE));
  await page.waitForTimeout(800);
  await check('a custom username survives signing in', async () => {
    await page.click('#settingsBtn');
    await page.waitForSelector('#fakeGoogleButton', { timeout: 8000 });
    await page.click('#fakeGoogleButton');
    await page.waitForTimeout(700);
    return (await page.textContent('.brand-greeting strong')) === 'StormLord';
  });
  await ctx.close();

  console.log('\n=== Malformed credentials are refused ===');
  ({ ctx, page } = await mk('test-client-id.apps.googleusercontent.com'));
  await check('garbage tokens do not sign anyone in', async () => {
    await page.evaluate(() => { window.__fakeToken = 'not.a.jwt'; });
    await page.click('#settingsBtn');
    await page.waitForSelector('#fakeGoogleButton', { timeout: 8000 });
    await page.click('#fakeGoogleButton');
    await page.waitForTimeout(600);
    return !(await page.isVisible('#accountSignedIn'));
  });
  await check('a token with no subject is refused', async () => {
    await page.evaluate((tok) => { window.__fakeToken = tok; },
      fakeIdToken({ name: 'No Subject' }));
    await page.click('#fakeGoogleButton');
    await page.waitForTimeout(600);
    return !(await page.isVisible('#accountSignedIn'));
  });
  await check('the page is still alive after both', async () =>
    page.isVisible('#settingsPanel'));
  await ctx.close();

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll sign-in checks passed.');
  await browser.close();
  process.exit(failures ? 1 : 0);
})();
