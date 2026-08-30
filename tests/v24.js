/* V24: a real model behind the bot, without giving away the key.

   Two things are worth testing here and they pull in opposite
   directions.

   The first is that Gemini actually gets used: a saved key, the
   setting switched on, and the line on screen is the model's rather
   than the pools'.

   The second is that it never becomes load-bearing. No key, a rejected
   key, a rate limit, a timeout, a blocked response, no network — every
   one of them has to end with a roast on screen, written by the local
   bot, and no error where a joke should be. That is most of this
   suite, because that is where an integration like this actually
   fails: not when it works, but on the day somebody's quota runs out.

   And one thing that is not about behaviour at all: the key must not
   be in the repository, must not travel in a URL, and must not be
   printed back to the user in full. Those are checked against the
   files and the requests, not against intent. */
const { chromium } = require('playwright');
const BASE_URL = process.env.WTW_BASE_URL || 'http://localhost:8901';
const APP_DIR = process.env.WTW_APP_DIR || require('path').join(__dirname, '..');
const BROWSER = process.env.PLAYWRIGHT_CHROMIUM || undefined;
const fs = require('fs');
const path = require('path');
const PNG = fs.readFileSync(__dirname + '/fixture-radar-frame.png');
const APP_VERSION = (fs.readFileSync(APP_DIR + '/config.js', 'utf8')
  .match(/version:\s*'([^']+)'/) || [])[1];

// A fake key shaped like a real one. Never a real one — a test fixture
// that carries a live credential is a leak with a test suite around it.
const FAKE_KEY = 'AIzaSyTESTKEYTESTKEYTESTKEYTESTKEY1234';
const GEMINI_LINE = 'Seventy-two degrees and clear — the sky is showing off again, friend.';

function isoDate(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function omBody() {
  const t = [];
  for (let i = 0; i < 40; i++) t.push(new Date(Date.now() + i * 3600000).toISOString().slice(0, 16));
  const time = [], max = [], min = [], code = [], pop = [], sr = [], ss = [], uv = [];
  for (let d = -1; d < 7; d++) {
    time.push(isoDate(d)); max.push(80); min.push(64); code.push(0); pop.push(10);
    sr.push(isoDate(d) + 'T06:30'); ss.push(isoDate(d) + 'T19:30'); uv.push(5);
  }
  return JSON.stringify({
    current: { temperature_2m: 72, apparent_temperature: 72, relative_humidity_2m: 50,
               weather_code: 0, wind_speed_10m: 6, wind_direction_10m: 180, is_day: 1,
               pressure_msl: 1013, dew_point_2m: 50, wind_gusts_10m: 9, precipitation: 0 },
    hourly: { time: t, temperature_2m: t.map(() => 72), precipitation_probability: t.map(() => 10),
              precipitation: t.map(() => 0), weather_code: t.map(() => 0),
              wind_speed_10m: t.map(() => 6), wind_gusts_10m: t.map(() => 9),
              visibility: t.map(() => 16093), pressure_msl: t.map(() => 1013) },
    daily: { time, weather_code: code, temperature_2m_max: max, temperature_2m_min: min,
             precipitation_probability_max: pop, precipitation_sum: time.map(() => 0),
             wind_gusts_10m_max: time.map(() => 10),
             sunrise: sr, sunset: ss, uv_index_max: uv } });
}

(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER });
  let failures = 0;
  const check = async (n, fn) => {
    try { const ok = await fn(); console.log((ok ? 'PASS' : 'FAIL') + ' - ' + n); if (!ok) failures++; }
    catch (e) { console.log('FAIL - ' + n + ' (' + e.message.split('\n')[0] + ')'); failures++; }
  };

  /* gemini: 'ok' | 'badkey' | 'ratelimit' | 'empty' | 'blocked' |
             'slow' | 'offline' */
  const mk = async ({ gemini = 'ok', key = null, brain = null } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 },
                                           serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const geminiReqs = [];

    await page.route((u) => u.protocol === 'https:', (r) => r.abort());
    await page.route('https://generativelanguage.googleapis.com/**', async (r) => {
      const req = r.request();
      geminiReqs.push({ url: req.url(), headers: req.headers(), body: req.postData() });
      if (gemini === 'offline') return r.abort();
      if (gemini === 'slow') { /* never fulfilled: the client must time out */ return; }
      if (gemini === 'badkey') return r.fulfill({ status: 400, contentType: 'application/json',
        body: JSON.stringify({ error: { message: 'API key not valid' } }) });
      if (gemini === 'ratelimit') return r.fulfill({ status: 429, contentType: 'application/json',
        body: JSON.stringify({ error: { message: 'Quota exceeded' } }) });
      if (gemini === 'empty') return r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ candidates: [] }) });
      if (gemini === 'blocked') return r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] }) });
      // Both of these came from real calls, not from imagination:
      // gemini-2.0-flash was retired mid-development, and the
      // reasoning models spend the output budget thinking and stop
      // with MAX_TOKENS and no text at all.
      if (gemini === 'retired') return r.fulfill({ status: 404, contentType: 'application/json',
        body: JSON.stringify({ error: { code: 404, status: 'NOT_FOUND',
          message: 'This model models/gemini-2.0-flash is no longer available.' } }) });
      if (gemini === 'truncated') return r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ candidates: [{ finishReason: 'MAX_TOKENS',
          content: { parts: [] } }],
          usageMetadata: { thoughtsTokenCount: 886, candidatesTokenCount: 0 } }) });
      return r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ candidates: [{ content: { parts: [{ text: GEMINI_LINE }] } }] }) });
    });
    await page.route('https://api.open-meteo.com/**', (r) => r.fulfill({
      contentType: 'application/json', body: omBody() }));
    await page.route('https://archive-api.open-meteo.com/**', (r) => r.abort());
    await page.route('https://air-quality-api.open-meteo.com/**', (r) => r.abort());
    await page.route('https://geocoding-api.open-meteo.com/**', (r) => r.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ results: [{ name: 'Austin', admin1: 'Texas', country_code: 'US',
        latitude: 30.2672, longitude: -97.7431 }] }) }));
    await page.route('https://api.weather.gov/**', (r) => r.fulfill({ status: 404, body: '{}' }));
    await page.route('https://opengeo.ncep.noaa.gov/**', (r) => r.fulfill({
      headers: { 'cache-control': 'no-store' }, contentType: 'image/png', body: PNG }));
    await page.route('https://basemaps.cartocdn.com/**', (r) => r.fulfill({
      headers: { 'cache-control': 'no-store' }, contentType: 'image/png', body: PNG }));

    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    // Seed storage before the app boots, so it starts in the state
    // under test rather than being clicked into it.
    await page.addInitScript(([k, b]) => {
      if (k) localStorage.setItem('aither.gemini.key', k);
      if (b) {
        const s = JSON.parse(localStorage.getItem('wtw:settings') || '{}');
        s.botBrain = b;
        localStorage.setItem('wtw:settings', JSON.stringify(s));
      }
    }, [key, brain]);

    await page.goto(BASE_URL + '/index.html', { waitUntil: 'networkidle' });
    await page.fill('#searchInput', 'Austin');
    await page.click('#searchBtn');
    await page.waitForSelector('#weatherPanels:not([hidden])', { timeout: 20000 });
    await page.waitForTimeout(1500);
    return { ctx, page, errors, geminiReqs };
  };

  console.log('=== The key is not in the app ===');
  // Files, not intent. A credential committed by accident is the kind
  // of mistake a test catches and a code review does not.
  const SOURCE = ['config.js', 'gemini.js', 'app.js', 'index.html', 'sw.js',
                  'manifest.json', 'README.md', 'storage.js', 'local-ai.js'];
  await check('no Google API key is committed anywhere in the project', async () => {
    const suspects = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (/^(node_modules|\.git|dist|release)$/.test(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!/\.(js|json|html|css|md|yml|yaml)$/.test(entry.name)) continue;
        const text = fs.readFileSync(full, 'utf8');
        // A real Google key: AIza + 35 more. The fixture above is
        // deliberately of that shape, so this suite excludes itself
        // and would still catch a real one anywhere else.
        const hits = text.match(/AIza[0-9A-Za-z_-]{35}/g) || [];
        for (const hit of hits) {
          if (hit === FAKE_KEY) continue;
          suspects.push(`${path.relative(APP_DIR, full)}: ${hit.slice(0, 8)}…`);
        }
      }
    };
    walk(APP_DIR);
    if (suspects.length) console.log('  [diag] ' + suspects.join(', '));
    return suspects.length === 0;
  });
  await check('config.js names a model but holds no key field', async () => {
    const text = fs.readFileSync(APP_DIR + '/config.js', 'utf8');
    return /gemini:/.test(text) && /model:/.test(text) &&
           !/apiKey|api_key|AIza/.test(text);
  });

  console.log('\n=== With a key, the model writes the line ===');
  let { ctx, page, errors, geminiReqs } = await mk({ key: FAKE_KEY, brain: 'gemini' });
  await check(`badge reads ${APP_VERSION}`, async () =>
    (await page.textContent('#appVersion')).trim() === APP_VERSION);
  await check('the roast on screen is the model\'s', async () => {
    await page.click('#roastBtn');
    await page.waitForTimeout(1500);
    return (await page.textContent('#roastText')).trim() === GEMINI_LINE;
  });
  await check('and it is labelled as the model\'s, not passed off as the app\'s', async () =>
    /gemini/i.test(await page.textContent('#botBadge')));
  await check('the key travels in a header, never in the URL', async () => {
    const req = geminiReqs[geminiReqs.length - 1];
    return req.headers['x-goog-api-key'] === FAKE_KEY && !req.url.includes(FAKE_KEY) &&
           !req.url.includes('key=');
  });
  await check('the prompt carries the real measurements', async () => {
    const body = geminiReqs[geminiReqs.length - 1].body || '';
    return body.includes('72') && /Austin/.test(body);
  });
  await check('and tells the model not to invent weather', async () => {
    const body = geminiReqs[geminiReqs.length - 1].body || '';
    return /never invent weather/i.test(body);
  });
  await check('the log records which brain wrote it', async () => {
    const entries = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('wtw:roastLog') || '[]'));
    return entries.some((e) => e.source === 'gemini');
  });
  await ctx.close();

  console.log('\n=== Off by default, and never called when off ===');
  ({ ctx, page, errors, geminiReqs } = await mk({ key: FAKE_KEY }));
  await check('a saved key alone does not switch the brain over', async () => {
    await page.click('#roastBtn');
    await page.waitForTimeout(1200);
    return geminiReqs.length === 0;
  });
  await check('and the built-in bot wrote a real roast', async () => {
    const text = (await page.textContent('#roastText')).trim();
    return text.length > 20 && text !== GEMINI_LINE;
  });
  await ctx.close();

  ({ ctx, page, errors, geminiReqs } = await mk({ brain: 'gemini' }));
  await check('the setting alone, with no key, calls nothing', async () => {
    await page.click('#roastBtn');
    await page.waitForTimeout(1200);
    return geminiReqs.length === 0;
  });
  await check('and there is still a roast on screen', async () =>
    (await page.textContent('#roastText')).trim().length > 20);
  await ctx.close();

  console.log('\n=== Every way it can fail ends with a roast ===');
  for (const [mode, label] of [['badkey', 'a rejected key'],
                               ['ratelimit', 'a quota that has run out'],
                               ['empty', 'an answer with nothing in it'],
                               ['blocked', 'a response the model blocked'],
                               ['retired', 'a model Google has retired'],
                               ['truncated', 'a model that thought until it ran out'],
                               ['offline', 'no network to Google']]) {
    const c = await mk({ gemini: mode, key: FAKE_KEY, brain: 'gemini' });
    await check(`${label}: the local bot still delivers`, async () => {
      await c.page.click('#roastBtn');
      await c.page.waitForTimeout(2000);
      const text = (await c.page.textContent('#roastText')).trim();
      return text.length > 20 && text !== GEMINI_LINE &&
             !/error|failed|undefined|null/i.test(text);
    });
    if (mode === 'badkey') {
      await check('and a rejected key says so rather than failing silently', async () =>
        /rejected/i.test(await c.page.textContent('#botBadge')));
    }
    await check(`${label}: no unhandled error reaches the page`, () => c.errors.length === 0);
    if (c.errors.length) console.log('  [diag] ' + c.errors.join(' | '));
    await c.ctx.close();
  }

  console.log('\n=== The two failures only a real call revealed ===');
  ({ ctx, page, errors, geminiReqs } = await mk({ key: FAKE_KEY, brain: 'gemini' }));
  await check('the default model is one Google still serves', async () => {
    await page.click('#roastBtn');
    await page.waitForTimeout(1200);
    const url = geminiReqs[geminiReqs.length - 1].url;
    // gemini-2.0-flash was the default here until a live call came
    // back 404. Whatever the default is, it must be in the offered
    // list — that list is the thing that gets reviewed when a model
    // is retired.
    const allowed = await page.evaluate(() =>
      (WTW_CONFIG.geminiModels || []).map((m) => m.id));
    return allowed.some((id) => url.includes(id)) && !url.includes('gemini-2.0-flash');
  });
  await check('the token budget leaves room for a model that thinks first', async () => {
    const body = JSON.parse(geminiReqs[geminiReqs.length - 1].body);
    // A live call spent 886 tokens thinking before writing 31 of
    // answer, so anything near the old 120 cap truncates mid-word.
    return body.generationConfig.maxOutputTokens >= 1000;
  });
  await ctx.close();

  ({ ctx, page, errors, geminiReqs } = await mk({ key: FAKE_KEY, brain: 'gemini' }));
  await check('picking a different model actually asks that model', async () => {
    await page.click('#settingsBtn');
    await page.waitForTimeout(500);
    await page.selectOption('#geminiModelSelect', 'gemini-3.6-flash');
    await page.waitForTimeout(300);
    await page.click('#settingsCloseBtn');
    await page.click('#roastBtn');
    await page.waitForTimeout(1500);
    return geminiReqs[geminiReqs.length - 1].url.includes('gemini-3.6-flash');
  });
  await ctx.close();

  console.log('\n=== A slow model does not hold the panel hostage ===');
  ({ ctx, page, errors, geminiReqs } = await mk({ gemini: 'slow', key: FAKE_KEY, brain: 'gemini' }));
  await check('the local line is up immediately, not after a wait', async () => {
    await page.click('#roastBtn');
    await page.waitForTimeout(400);          // far inside the 8s timeout
    const text = (await page.textContent('#roastText')).trim();
    return text.length > 20 && text !== GEMINI_LINE;
  });
  await ctx.close();

  console.log('\n=== Settings: saving, testing and forgetting a key ===');
  ({ ctx, page, errors, geminiReqs } = await mk());
  await check('the key field is hidden until Gemini is chosen', async () => {
    await page.click('#settingsBtn');
    await page.waitForTimeout(500);
    return (await page.getAttribute('#geminiGroup', 'hidden')) !== null;
  });
  await check('choosing Gemini reveals it', async () => {
    await page.selectOption('#botBrainSelect', 'gemini');
    await page.waitForTimeout(400);
    return (await page.getAttribute('#geminiGroup', 'hidden')) === null;
  });
  await check('the field is a password field, not plain text', async () =>
    (await page.getAttribute('#geminiKeyInput', 'type')) === 'password');
  await check('an obviously-too-short key is refused', async () => {
    await page.fill('#geminiKeyInput', 'nope');
    await page.click('#geminiSaveBtn');
    await page.waitForTimeout(300);
    return /too short/i.test(await page.textContent('#geminiStatus'));
  });
  await check('a real-looking key saves', async () => {
    await page.fill('#geminiKeyInput', FAKE_KEY);
    await page.click('#geminiSaveBtn');
    await page.waitForTimeout(400);
    return /saved/i.test(await page.textContent('#geminiStatus'));
  });
  await check('and is never shown back in full', async () => {
    const value = await page.inputValue('#geminiKeyInput');
    const placeholder = await page.getAttribute('#geminiKeyInput', 'placeholder');
    const status = await page.textContent('#geminiStatus');
    return value === '' && !placeholder.includes(FAKE_KEY) &&
           !status.includes(FAKE_KEY) && /…/.test(placeholder);
  });
  await check('testing it says what happened', async () => {
    await page.click('#geminiTestBtn');
    await page.waitForTimeout(1800);
    return /working/i.test(await page.textContent('#geminiStatus'));
  });
  await check('forgetting it clears the stored key', async () => {
    await page.click('#geminiClearBtn');
    await page.waitForTimeout(400);
    const stored = await page.evaluate(() => localStorage.getItem('aither.gemini.key'));
    return stored === null && /forgotten/i.test(await page.textContent('#geminiStatus'));
  });
  await check('the settings say where the key lives and who can read it', async () => {
    const text = await page.textContent('#geminiGroup');
    return /this\s+browser\s+only/i.test(text) && /developer\s+tools/i.test(text);
  });
  await check('the transfer code still carries no key', async () => {
    await page.evaluate((k) => localStorage.setItem('aither.gemini.key', k), FAKE_KEY);
    await page.click('#transferShowBtn');
    await page.waitForTimeout(400);
    const code = await page.inputValue('#transferCode');
    const decoded = Buffer.from(code, 'base64').toString('utf8');
    return !decoded.includes(FAKE_KEY) && !/AIza/.test(decoded) && !/geminiKey/i.test(decoded);
  });
  await check('no JS errors', () => errors.length === 0);
  if (errors.length) console.log(errors.join('\n'));
  await ctx.close();

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll V24 checks passed.');
  await browser.close();
  process.exit(failures ? 1 : 0);
})();
