/* The sign-in screen: how it opens, what it offers, and that it always
   offers something — including on a build with no client ID at all. */
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

const GOOGLE_PROFILE = {
  sub: '1234567890',
  name: 'Ada Lovelace',
  given_name: 'Ada',
  email: 'ada@example.com',
  picture: 'https://lh3.googleusercontent.com/fake-avatar',
};

// Microsoft returns an account object alongside the claims, and no picture.
const MS_CLAIMS = {
  oid: 'ms-0000-1111',
  name: 'Grace Hopper',
  given_name: 'Grace',
  preferred_username: 'grace@contoso.com',
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

  // ids: {} leaves both providers unconfigured, which is what ships.
  const mk = async (ids = {}) => {
    const ctx = await browser.newContext({ viewport:{width:1280,height:900}, serviceWorkers:'block' });
    const page = await ctx.newPage();
    // Deny every external host by default; the stubs below are
    // registered afterwards and so take precedence.
    await page.route((u) => u.protocol === 'https:', (r) => r.abort());
    if (ids.google || ids.microsoft || ids.apple) {
      // Patch config before any app script reads it.
      await page.addInitScript((cfg) => {
        const apply = () => {
          if (!window.WTW_CONFIG || !window.WTW_CONFIG.auth) return false;
          if (cfg.google) window.WTW_CONFIG.auth.google.clientId = cfg.google;
          if (cfg.microsoft) window.WTW_CONFIG.auth.microsoft.clientId = cfg.microsoft;
          if (cfg.apple) window.WTW_CONFIG.auth.apple.clientId = cfg.apple;
          return true;
        };
        const timer = setInterval(() => { if (apply()) clearInterval(timer); }, 5);
        document.addEventListener('readystatechange', apply, true);
      }, ids);
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
    // Stand in for MSAL. loginPopup resolves with whatever the test set.
    await page.route('https://alcdn.msauth.net/**', (r) => r.fulfill({
      contentType: 'text/javascript',
      body: `
        window.msal = {
          PublicClientApplication: class {
            constructor(config) { window.__msalConfig = config; this.accounts = []; }
            async loginPopup(req) {
              window.__msalLoginRequest = req;
              if (window.__msalReject) throw window.__msalReject;
              this.accounts = [window.__msalAccount];
              return { account: window.__msalAccount, idTokenClaims: window.__msalClaims };
            }
            getAllAccounts() { return this.accounts; }
            removeAccount(a) { this.accounts = this.accounts.filter((x) => x !== a); window.__msalRemoved = true; }
          },
        };
      `,
    }));
    // Stand in for Apple's JS SDK. signIn resolves with an id_token,
    // and (only on a first authorization) a user object carrying a name.
    await page.route('https://appleid.cdn-apple.com/**', (r) => r.fulfill({
      contentType: 'text/javascript',
      body: `
        window.AppleID = { auth: {
          init: (opts) => { window.__appleOpts = opts; },
          signIn: async () => {
            if (window.__appleReject) throw window.__appleReject;
            return { authorization: { id_token: window.__appleToken },
                     user: window.__appleUser };
          },
        } };
      `,
    }));
    await page.route('https://lh3.googleusercontent.com/**', (r) => r.fulfill({ contentType:'image/png', body: PNG }));
    await page.route('https://api.github.com/**', r => r.fulfill({status:404, body:'{}'}));
    await page.route('https://geocoding-api.open-meteo.com/**', r => r.fulfill({contentType:'application/json',
      body: JSON.stringify({results:[{name:'Austin',admin1:'Texas',country:'United States',latitude:30.2672,longitude:-97.7431}]})}));
    await page.route('https://api.open-meteo.com/**', r => r.fulfill({contentType:'application/json', body: omBody()}));
    await page.route('https://api.weather.gov/**', r => r.fulfill({status:404, body:'{}'}));
    await page.route('https://opengeo.ncep.noaa.gov/**', r => r.fulfill({headers:{'cache-control':'no-store'}, contentType:'image/png', body:PNG}));
    await page.route('https://basemaps.cartocdn.com/**', r => r.fulfill({headers:{'cache-control':'no-store'}, contentType:'image/png', body:PNG}));
    await page.goto(BASE_URL + '/index.html', { waitUntil:'networkidle' });
    await page.evaluate((tok) => { window.__fakeToken = tok; }, fakeIdToken(GOOGLE_PROFILE));
    await page.evaluate((c) => {
      window.__msalClaims = c;
      window.__msalAccount = { homeAccountId: c.oid, name: c.name, username: c.preferred_username };
    }, MS_CLAIMS);
    return { ctx, page };
  };

  const GOOGLE_ID = 'test-client-id.apps.googleusercontent.com';
  const MS_ID = '11111111-2222-3333-4444-555555555555';
  const APPLE_ID = 'com.example.whatthewether.web';

  console.log('=== Nothing configured: the app is unaffected ===');
  let { ctx, page } = await mk();
  await check('the app loads and works with no client IDs', async () => {
    await page.fill('#searchInput', 'Austin');
    await page.click('#searchBtn');
    await page.waitForSelector('#weatherPanels:not([hidden])', { timeout: 15000 });
    return /Austin/.test(await page.textContent('#wxCity'));
  });
  await check('the header button opens the sign-in screen', async () => {
    await page.click('#accountBtn');
    await page.waitForTimeout(700);
    return await page.isVisible('#signInModal') &&
           /Sign in to Aither Weather/i.test(await page.textContent('#signInTitle'));
  });
  await check('no dead provider buttons are drawn', async () =>
    !(await page.isVisible('#microsoftBtn')) &&
    !(await page.isVisible('#appleBtn')) &&
    (await page.locator('#fakeGoogleButton').count()) === 0);
  await check('the subtitle is about the name, not about accounts elsewhere', async () =>
    /remember you on this device/i.test(await page.textContent('#signInSub')));
  await check('it still offers a way in, and does not cry off', async () => {
    const noteShown = await page.isVisible('#signInNote');
    // The suite serves from 127.0.0.1, which counts as building the
    // site rather than using it, so the pointer to the README is
    // expected here. What must never appear is a screen that only
    // says sign-in is unavailable.
    const note = noteShown ? await page.textContent('#signInNote') : '';
    return await page.isVisible('#localSignInForm') &&
           await page.isVisible('#localNameInput') &&
           (!noteShown || /README/i.test(note));
  });
  await check('an empty name is refused rather than accepted', async () => {
    await page.click('#localSignInBtn');
    await page.waitForTimeout(400);
    return !(await page.isVisible('#accountSignedIn')) &&
           /type a name/i.test(await page.textContent('#toast'));
  });
  await check('a name signs you in on a build with no client IDs', async () => {
    await page.fill('#localNameInput', 'Rain Boy');
    await page.click('#localSignInBtn');
    await page.waitForTimeout(700);
    return !(await page.isVisible('#signInModal')) &&
           (await page.textContent('.brand-greeting strong')) === 'Rain Boy';
  });
  await check('the header button becomes the account', async () =>
    (await page.textContent('#accountBtnIcon')) === 'R' &&
    /Rain Boy/.test(await page.getAttribute('#accountBtn', 'aria-label')));
  await check('the hint says where that name lives', async () => {
    await page.click('#settingsBtn');
    await page.waitForTimeout(500);
    return /this device/i.test(await page.textContent('#accountHint')) &&
           (await page.textContent('#accountName')) === 'Rain Boy';
  });
  await check('it survives a reload', async () => {
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    return (await page.textContent('.brand-greeting strong')) === 'Rain Boy';
  });
  await check('logging out takes the adopted name away with it', async () => {
    await page.click('#settingsBtn');
    await page.waitForTimeout(500);
    await page.click('#signOutBtn');
    await page.waitForTimeout(600);
    // There is no stock name to hand back any more: an app that has
    // not been told a name shows no greeting at all rather than one
    // addressed to somebody who never gave it one.
    const name = (await page.textContent('.brand-greeting strong')).trim();
    const greeting = await page.locator('[data-greeting]').first();
    return name === '' && !(await greeting.isVisible()) &&
           await page.isVisible('#accountSignedOut');
  });
  await check('signing back in keeps the same device account', async () => {
    // storage.js JSON-encodes everything, so the raw value carries its
    // own quotes; parse before comparing or nothing ever matches.
    const first = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('wtw:localAccountId')));
    await page.click('#settingsCloseBtn');
    await page.click('#accountBtn');
    await page.waitForTimeout(500);
    await page.fill('#localNameInput', 'Rain Boy');
    await page.click('#localSignInBtn');
    await page.waitForTimeout(600);
    const after = await page.evaluate(() => {
      const raw = localStorage.getItem('wtw:profile');
      return { profile: raw && JSON.parse(raw).sub,
               deviceId: JSON.parse(localStorage.getItem('wtw:localAccountId')),
               signedIn: !document.getElementById('accountSignedIn').hidden };
    });
    const ok = !!first && after.profile === first;
    if (!ok) console.log(`  [diag] before=${first} after=${JSON.stringify(after)}`);
    return ok;
  });
  await check('the screen closes and is not a gate', async () => {
    await page.click('#settingsBtn');
    await page.waitForTimeout(400);
    await page.click('#signOutBtn');
    await page.waitForTimeout(400);
    await page.click('#settingsCloseBtn');
    await page.click('#accountBtn');
    await page.waitForTimeout(400);
    await page.click('#signInDismiss');
    await page.waitForTimeout(400);
    return !(await page.isVisible('#signInModal')) &&
           await page.isVisible('#weatherPanels');
  });
  await check('the word "guest" appears nowhere in the app', async () =>
    page.evaluate(() => !/guest/i.test(document.body.innerText)));
  await check('neither provider script is fetched when unconfigured', async () =>
    page.evaluate(() => !document.querySelector('script[src*="accounts.google.com"]') &&
                        !document.querySelector('script[src*="msauth.net"]')));
  await check('no name is invented for somebody who has not set one', async () =>
    (await page.textContent('.brand-greeting strong')).trim() === '' &&
    !(await page.locator('[data-greeting]').first().isVisible()));
  await ctx.close();

  console.log('\n=== Both configured: two ways in ===');
  ({ ctx, page } = await mk({ google: GOOGLE_ID, microsoft: MS_ID }));
  await page.fill('#searchInput', 'Austin');
  await page.click('#searchBtn');
  await page.waitForSelector('#weatherPanels:not([hidden])', { timeout: 15000 });
  await check('both buttons are offered on the screen', async () => {
    await page.click('#accountBtn');
    await page.waitForSelector('#fakeGoogleButton', { timeout: 8000 });
    return await page.isVisible('#fakeGoogleButton') && await page.isVisible('#microsoftBtn');
  });
  await check('Escape closes it', async () => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    return !(await page.isVisible('#signInModal'));
  });
  await check('Settings offers a way in too', async () => {
    await page.click('#settingsBtn');
    await page.waitForTimeout(400);
    await page.click('#settingsSignInBtn');
    await page.waitForTimeout(600);
    return await page.isVisible('#signInModal') &&
           !(await page.evaluate(() => document.body.classList.contains('settings-open')));
  });
  await check('still no talk of guests', async () =>
    page.evaluate(() => !/guest/i.test(document.body.innerText)));
  await check('the Google client ID is passed through', async () =>
    (await page.evaluate(() => window.__gsiOpts && window.__gsiOpts.client_id)) === GOOGLE_ID);
  await check('auto sign-in is not enabled behind the scenes', async () =>
    (await page.evaluate(() => window.__gsiOpts && window.__gsiOpts.auto_select)) === false);
  await ctx.close();

  console.log('\n=== Signing in with Microsoft ===');
  ({ ctx, page } = await mk({ google: GOOGLE_ID, microsoft: MS_ID }));
  await page.fill('#searchInput', 'Austin');
  await page.click('#searchBtn');
  await page.waitForSelector('#weatherPanels:not([hidden])', { timeout: 15000 });
  await page.click('#accountBtn');
  await page.waitForTimeout(800);
  await check('the Microsoft app is configured with the client ID and authority', async () => {
    await page.click('#microsoftBtn');
    await page.waitForTimeout(900);
    const cfg = await page.evaluate(() => window.__msalConfig && window.__msalConfig.auth);
    return cfg.clientId === MS_ID && /login\.microsoftonline\.com\/common/.test(cfg.authority);
  });
  await check('it asks which account to use rather than reusing one', async () =>
    (await page.evaluate(() => window.__msalLoginRequest && window.__msalLoginRequest.prompt)) === 'select_account');
  await check('the name and email are shown', async () =>
    (await page.textContent('#accountName')) === 'Grace Hopper' &&
    (await page.textContent('#accountEmail')) === 'grace@contoso.com');
  await check('an initial stands in for the missing picture', async () =>
    await page.isVisible('#accountInitial') &&
    (await page.textContent('#accountInitial')) === 'G' &&
    !(await page.isVisible('#accountAvatar')));
  await check('the hint names Microsoft', async () =>
    /Microsoft/.test(await page.textContent('#accountHint')));
  await check('the username adopts the first name', async () =>
    (await page.textContent('.brand-greeting strong')) === 'Grace');
  await check('signing in closes the screen by itself', async () =>
    !(await page.isVisible('#signInModal')));
  await check('the header button becomes the account', async () =>
    /Grace/.test(await page.getAttribute('#accountBtn', 'aria-label')) &&
    (await page.textContent('#accountBtnIcon')) === 'G');
  await check('the settings panel shows the account, not a sign-in prompt', async () => {
    await page.click('#settingsBtn');
    await page.waitForTimeout(500);
    return !(await page.isVisible('#accountSignedOut')) && await page.isVisible('#accountSignedIn');
  });
  await check('logging out clears the account and the adopted name', async () => {
    await page.click('#signOutBtn');
    await page.waitForTimeout(700);
    return await page.isVisible('#accountSignedOut') &&
           (await page.textContent('.brand-greeting strong')).trim() === '';
  });
  await check("logging out drops Microsoft's cached account", async () =>
    page.evaluate(() => window.__msalRemoved === true));
  await check('both buttons are offered again straight away', async () => {
    await page.click('#settingsCloseBtn');
    await page.click('#accountBtn');
    await page.waitForSelector('#fakeGoogleButton', { timeout: 8000 });
    return await page.isVisible('#microsoftBtn') && await page.isVisible('#fakeGoogleButton');
  });
  await check('a cancelled popup is not treated as a failure', async () => {
    // Clear the log-out toast first, or its 3s lifetime answers for us.
    await page.evaluate(() => {
      window.__msalReject = { errorCode: 'user_cancelled' };
      document.getElementById('toast').classList.remove('show');
    });
    await page.click('#microsoftBtn');
    await page.waitForTimeout(700);
    const toastVisible = await page.evaluate(() =>
      document.getElementById('toast').classList.contains('show'));
    return !(await page.isVisible('#accountSignedIn')) && !toastVisible;
  });
  await check('the button is usable again after a cancel', async () =>
    page.evaluate(() => !document.getElementById('microsoftBtn').disabled));
  await check('a real failure says so instead of failing silently', async () => {
    await page.evaluate(() => { window.__msalReject = { errorCode: 'something_broke' }; });
    await page.click('#microsoftBtn');
    await page.waitForTimeout(700);
    return /Microsoft/.test(await page.textContent('#toast'));
  });
  await ctx.close();

  console.log('\n=== Signing in with Google ===');
  ({ ctx, page } = await mk({ google: GOOGLE_ID, microsoft: MS_ID }));
  await page.fill('#searchInput', 'Austin');
  await page.click('#searchBtn');
  await page.waitForSelector('#weatherPanels:not([hidden])', { timeout: 15000 });
  await page.click('#accountBtn');
  await page.waitForSelector('#fakeGoogleButton', { timeout: 8000 });
  await check('signing in shows the name and email', async () => {
    await page.click('#fakeGoogleButton');
    await page.waitForTimeout(700);
    await page.click('#settingsBtn');
    await page.waitForTimeout(400);
    return (await page.textContent('#accountName')) === 'Ada Lovelace' &&
           (await page.textContent('#accountEmail')) === 'ada@example.com';
  });
  await check('the picture is used when there is one', async () =>
    await page.isVisible('#accountAvatar') && !(await page.isVisible('#accountInitial')));
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
  await check('the profile survives a reload', async () => {
    await page.reload({ waitUntil: 'networkidle' });
    // The reload takes the page's globals with it, including the token
    // the stubbed Google button hands back. Put it back, or a later
    // sign-in silently does nothing and the failure lands somewhere else.
    await page.evaluate((tok) => { window.__fakeToken = tok; }, fakeIdToken(GOOGLE_PROFILE));
    await page.waitForTimeout(1800);
    await page.click('#settingsBtn');
    await page.waitForTimeout(600);
    return (await page.textContent('#accountName')) === 'Ada Lovelace';
  });
  await check('the header button opens the account, not the sign-in screen', async () => {
    await page.click('#settingsCloseBtn');
    await page.waitForTimeout(300);
    await page.click('#accountBtn');
    await page.waitForTimeout(600);
    return !(await page.isVisible('#signInModal')) &&
           await page.evaluate(() => document.body.classList.contains('settings-open'));
  });
  await check('logging out clears the profile and the avatar', async () => {
    await page.click('#signOutBtn');
    await page.waitForTimeout(700);
    return await page.isVisible('#accountSignedOut') &&
           !(await page.isVisible('#accountSignedIn')) &&
           !(await page.isVisible('#brandAvatar')) &&
           !(await page.isVisible('#accountBtnAvatar'));
  });
  await check("logging out also clears Google's auto-select", async () =>
    page.evaluate(() => window.__autoSelectDisabled === true));
  await check('the profile is gone from storage', async () =>
    page.evaluate(() => localStorage.getItem('wtw:profile') === null &&
                        localStorage.getItem('wtw:googleProfile') === null));
  await check('signing back in works without a reload', async () => {
    await page.click('#settingsCloseBtn');
    await page.click('#accountBtn');
    await page.waitForSelector('#fakeGoogleButton', { timeout: 8000 });
    await page.click('#fakeGoogleButton');
    await page.waitForTimeout(700);
    await page.click('#settingsBtn');
    await page.waitForTimeout(400);
    return (await page.textContent('#accountName')) === 'Ada Lovelace';
  });
  await ctx.close();

  console.log('\n=== One provider configured, not the other ===');
  ({ ctx, page } = await mk({ microsoft: MS_ID }));
  await check('only the configured provider is offered', async () => {
    await page.click('#accountBtn');
    await page.waitForTimeout(800);
    return await page.isVisible('#microsoftBtn') &&
           (await page.locator('#fakeGoogleButton').count()) === 0 &&
           !(await page.isVisible('#googleButtonHost'));
  });
  await check("Google's script is not fetched for a Microsoft-only build", async () =>
    page.evaluate(() => !document.querySelector('script[src*="accounts.google.com"]')));
  await ctx.close();

  console.log('\n=== A chosen username is never overwritten ===');
  ({ ctx, page } = await mk({ google: GOOGLE_ID, microsoft: MS_ID }));
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('wtw:settings') || '{}');
    s.username = 'StormLord';
    localStorage.setItem('wtw:settings', JSON.stringify(s));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.evaluate((tok) => { window.__fakeToken = tok; }, fakeIdToken(GOOGLE_PROFILE));
  await page.waitForTimeout(800);
  await check('a custom username survives signing in', async () => {
    await page.click('#accountBtn');
    await page.waitForSelector('#fakeGoogleButton', { timeout: 8000 });
    await page.click('#fakeGoogleButton');
    await page.waitForTimeout(700);
    return (await page.textContent('.brand-greeting strong')) === 'StormLord';
  });
  await check('and survives logging out again', async () => {
    await page.click('#settingsBtn');
    await page.waitForTimeout(400);
    await page.click('#signOutBtn');
    await page.waitForTimeout(700);
    return (await page.textContent('.brand-greeting strong')) === 'StormLord';
  });
  await ctx.close();

  console.log('\n=== Switching a provider on from Settings ===');
  ({ ctx, page } = await mk());
  await page.fill('#searchInput', 'Austin');
  await page.click('#searchBtn');
  await page.waitForSelector('#weatherPanels:not([hidden])', { timeout: 15000 });
  await check('Settings says nothing is switched on yet', async () => {
    await page.click('#settingsBtn');
    await page.waitForTimeout(500);
    return /none switched on/i.test(await page.textContent('#authSetupStatus'));
  });
  await check('pasting a client ID switches that provider on', async () => {
    await page.fill('#googleIdInput', GOOGLE_ID);
    await page.click('#googleIdSave');
    await page.waitForTimeout(400);
    return /Google/.test(await page.textContent('#authSetupStatus')) &&
           await page.evaluate((id) => WTWAuth.configuredClientId('google') === id, GOOGLE_ID);
  });
  await check('the button appears without a reload', async () => {
    await page.click('#settingsCloseBtn');
    await page.click('#accountBtn');
    await page.waitForSelector('#fakeGoogleButton', { timeout: 8000 });
    return page.isVisible('#fakeGoogleButton');
  });
  await check('and it actually signs in', async () => {
    await page.click('#fakeGoogleButton');
    await page.waitForTimeout(700);
    return (await page.textContent('.brand-greeting strong')) === 'Ada';
  });
  await check('the pasted ID survives a reload', async () => {
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await page.click('#settingsBtn');
    await page.waitForTimeout(500);
    return (await page.inputValue('#googleIdInput')) === GOOGLE_ID;
  });
  await check('clearing the box switches it off again', async () => {
    await page.fill('#googleIdInput', '');
    await page.click('#googleIdSave');
    await page.waitForTimeout(400);
    return /none switched on/i.test(await page.textContent('#authSetupStatus')) &&
           await page.evaluate(() => WTWAuth.configuredClientId('google') === null);
  });
  await check('and the button is gone from the screen', async () => {
    await page.click('#signOutBtn');
    await page.waitForTimeout(500);
    await page.click('#settingsCloseBtn');
    await page.click('#accountBtn');
    await page.waitForTimeout(700);
    return !(await page.isVisible('#googleButtonHost')) &&
           await page.isVisible('#localSignInForm');
  });
  await ctx.close();

  console.log('\n=== Signing in with Apple ===');
  ({ ctx, page } = await mk({ apple: APPLE_ID }));
  await page.evaluate((tok) => {
    window.__appleToken = tok;
    window.__appleUser = { name: { firstName: 'Steve', lastName: 'Wozniak' },
                           email: 'woz@example.com' };
  }, fakeIdToken({ sub: 'apple-999', email: 'woz@example.com' }));
  await page.fill('#searchInput', 'Austin');
  await page.click('#searchBtn');
  await page.waitForSelector('#weatherPanels:not([hidden])', { timeout: 15000 });
  await check('the Apple button is offered when configured', async () => {
    await page.click('#accountBtn');
    await page.waitForTimeout(600);
    return await page.isVisible('#appleBtn') && !(await page.isVisible('#microsoftBtn'));
  });
  await check('Apple is initialised with the Services ID and a popup', async () => {
    await page.click('#appleBtn');
    await page.waitForTimeout(900);
    const opts = await page.evaluate(() => window.__appleOpts);
    return opts.clientId === APPLE_ID && opts.usePopup === true &&
           /name/.test(opts.scope) && /^https?:/.test(opts.redirectURI);
  });
  await check('the name Apple sends once is used', async () => {
    await page.click('#settingsBtn');
    await page.waitForTimeout(500);
    return (await page.textContent('#accountName')) === 'Steve Wozniak' &&
           (await page.textContent('#accountEmail')) === 'woz@example.com';
  });
  await check('an initial stands in, since Apple sends no picture', async () =>
    await page.isVisible('#accountInitial') &&
    (await page.textContent('#accountInitial')) === 'S');
  await check('the hint names Apple', async () =>
    /Apple/.test(await page.textContent('#accountHint')));
  await check('a closed popup is not treated as a failure', async () => {
    await page.click('#signOutBtn');
    await page.waitForTimeout(600);
    await page.click('#settingsCloseBtn');
    await page.click('#accountBtn');
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      window.__appleReject = { error: 'popup_closed_by_user' };
      document.getElementById('toast').classList.remove('show');
    });
    await page.click('#appleBtn');
    await page.waitForTimeout(700);
    return !(await page.isVisible('#accountSignedIn')) &&
           !(await page.evaluate(() =>
             document.getElementById('toast').classList.contains('show')));
  });
  await check('a returning Apple user with no name still gets one', async () => {
    await page.evaluate((tok) => {
      window.__appleReject = null;
      window.__appleToken = tok;
      window.__appleUser = undefined;      // Apple only sends it once
    }, fakeIdToken({ sub: 'apple-999', email: 'woz@example.com' }));
    await page.click('#appleBtn');
    await page.waitForTimeout(800);
    await page.click('#settingsBtn');
    await page.waitForTimeout(400);
    return (await page.textContent('#accountName')) === 'woz';
  });
  await check('a private-relay address is not turned into a name', async () => {
    await page.click('#signOutBtn');
    await page.waitForTimeout(500);
    await page.click('#settingsCloseBtn');
    await page.click('#accountBtn');
    await page.waitForTimeout(400);
    await page.evaluate((tok) => { window.__appleToken = tok; },
      fakeIdToken({ sub: 'apple-777', email: 'a1b2c3d4e5f6g7h8@privaterelay.appleid.com' }));
    await page.click('#appleBtn');
    await page.waitForTimeout(800);
    await page.click('#settingsBtn');
    await page.waitForTimeout(400);
    return (await page.textContent('#accountName')) === 'Signed in';
  });
  await ctx.close();

  console.log('\n=== Malformed credentials are refused ===');
  ({ ctx, page } = await mk({ google: GOOGLE_ID }));
  await check('garbage tokens do not sign anyone in', async () => {
    await page.evaluate(() => { window.__fakeToken = 'not.a.jwt'; });
    await page.click('#accountBtn');
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
    page.isVisible('#signInModal'));
  await ctx.close();

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll sign-in checks passed.');
  await browser.close();
  process.exit(failures ? 1 : 0);
})();
