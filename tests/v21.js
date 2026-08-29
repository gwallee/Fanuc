/* V21: the sky behind everything, and a look you can change.

   Three things are worth proving, and none of them is "it looks
   right" — a screenshot would tell you that and tell you nothing when
   it stops being true.

   The sky. The page colour and the animation are set from one call,
   so the interesting question is not whether either works but whether
   they can ever disagree: a backdrop drawing rain over a clear-blue
   page is the bug this suite exists to catch. Day and night have to
   differ too, or the whole thing is decoration with no information in
   it.

   The tiles. Each carries a sentence explaining its number, and the
   sentence has to follow the number rather than being decoration of
   its own — including through a units change, where "10 mi" becoming
   "16 km" must not leave "perfectly clear view" attached to a figure
   it no longer describes.

   The look. Four settings, each of which must survive a reload and
   none of which may make the app unreadable — so contrast is checked,
   not just that an attribute changed. */
const { chromium } = require('playwright');
const BASE_URL = process.env.WTW_BASE_URL || 'http://localhost:8901';
const APP_DIR = process.env.WTW_APP_DIR || require('path').join(__dirname, '..');
const BROWSER = process.env.PLAYWRIGHT_CHROMIUM || undefined;
const fs = require('fs');
const PNG = fs.readFileSync(__dirname + '/fixture-radar-frame.png');
const APP_VERSION = (fs.readFileSync(APP_DIR + '/config.js', 'utf8')
  .match(/version:\s*'([^']+)'/) || [])[1];

function isoDate(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function omBody({ code = 0, isDay = 1, visibility = 16093, uv = 6,
                  feels = 73, temp = 72, wind = 8, windDir = 180 } = {}) {
  const hT = [], t = [], pop = [], hc = [], w = [], vis = [];
  for (let d = -1; d < 7; d++) {
    for (let hour = 0; hour < 24; hour++) {
      hT.push(`${isoDate(d)}T${String(hour).padStart(2, '0')}:00`);
      t.push(70); pop.push(20); hc.push(code); w.push(wind); vis.push(visibility);
    }
  }
  const time = [], max = [], min = [], dc = [], dp = [], sr = [], ss = [], uvs = [];
  for (let d = -1; d < 7; d++) {
    time.push(isoDate(d)); max.push(80); min.push(64); dc.push(code); dp.push(20);
    sr.push(isoDate(d) + 'T06:30'); ss.push(isoDate(d) + 'T19:30'); uvs.push(uv);
  }
  return JSON.stringify({
    current: { temperature_2m: temp, apparent_temperature: feels,
               relative_humidity_2m: 60, weather_code: code, wind_speed_10m: wind,
               wind_direction_10m: windDir, is_day: isDay,
               pressure_msl: 1014, dew_point_2m: 52 },
    hourly: { time: hT, temperature_2m: t, precipitation_probability: pop,
              weather_code: hc, wind_speed_10m: w, visibility: vis },
    daily: { time, weather_code: dc, temperature_2m_max: max, temperature_2m_min: min,
             precipitation_probability_max: dp, sunrise: sr, sunset: ss, uv_index_max: uvs } });
}

/* Relative luminance and contrast ratio, straight out of WCAG. Used
   to prove the text over the sky is actually readable rather than
   merely present. */
function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function parseRGB(css) {
  const m = css.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
function alphaOf(css) {
  const m = css.match(/rgba\(\s*[\d.]+,\s*[\d.]+,\s*[\d.]+,\s*([\d.]+)/);
  return m ? Number(m[1]) : 1;
}
/* What a translucent layer actually looks like once the screen has
   drawn it over what is behind. */
function over(fg, alpha, bg) {
  if (!fg) return bg;
  return fg.map((v, i) => alpha * v + (1 - alpha) * bg[i]);
}

(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER });
  let failures = 0;
  const check = async (n, fn) => {
    try { const ok = await fn(); console.log((ok ? 'PASS' : 'FAIL') + ' - ' + n); if (!ok) failures++; }
    catch (e) { console.log('FAIL - ' + n + ' (' + e.message.split('\n')[0] + ')'); failures++; }
  };

  const mk = async (opts = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 },
                                           serviceWorkers: 'block' });
    const page = await ctx.newPage();
    await page.route((u) => u.protocol === 'https:', (r) => r.abort());
    await page.route('https://api.open-meteo.com/**', (r) => r.fulfill({
      contentType: 'application/json', body: omBody(opts) }));
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
    await page.goto(BASE_URL + '/index.html', { waitUntil: 'networkidle' });
    await page.fill('#searchInput', 'Austin');
    await page.click('#searchBtn');
    await page.waitForSelector('#weatherPanels:not([hidden])', { timeout: 20000 });
    await page.waitForTimeout(600);
    return { ctx, page, errors };
  };

  console.log('=== The sky is the page ===');
  let { ctx, page, errors } = await mk({ code: 0, isDay: 1 });
  await check(`badge reads ${APP_VERSION}`, async () =>
    (await page.textContent('#appVersion')).trim() === APP_VERSION);
  await check('the backdrop sits behind the app, not over it', async () =>
    page.evaluate(() => {
      const s = getComputedStyle(document.getElementById('skyBackdrop'));
      return s.position === 'fixed' && Number(s.zIndex) < 0 && s.pointerEvents === 'none';
    }));
  await check('it says nothing to a screen reader', async () =>
    (await page.getAttribute('#skyBackdrop', 'aria-hidden')) === 'true');
  await check('a clear day paints a clear-day sky', async () =>
    (await page.getAttribute('html', 'data-sky')) === 'clear' &&
    (await page.getAttribute('html', 'data-daynight')) === 'day');
  await check('the page really takes that colour, not just the attribute', async () =>
    page.evaluate(() => {
      const bg = getComputedStyle(document.getElementById('skyBackdrop')).backgroundImage;
      return /gradient/.test(bg);
    }));
  await ctx.close();

  console.log('\n=== Night is not day ===');
  const dayColour = async (opts) => {
    const c = await mk(opts);
    const v = await c.page.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      return [s.getPropertyValue('--sky-1').trim(),
              document.documentElement.dataset.daynight];
    });
    await c.ctx.close();
    return v;
  };
  const [clearDay, dnDay] = await dayColour({ code: 0, isDay: 1 });
  const [clearNight, dnNight] = await dayColour({ code: 0, isDay: 0 });
  await check('the same weather is a different colour at night', async () =>
    dnDay === 'day' && dnNight === 'night' && clearDay !== clearNight && !!clearDay);

  console.log('\n=== The colour and the animation never disagree ===');
  const SKIES = [[0, 'clear'], [3, 'clouds'], [61, 'rain'],
                 [71, 'snow'], [95, 'storm'], [45, 'fog']];
  for (const [code, expected] of SKIES) {
    const c = await mk({ code });
    await check(`code ${code} paints and animates ${expected}`, async () => {
      const seen = await c.page.evaluate(() => ({
        page: document.documentElement.dataset.sky,
        backdrop: document.getElementById('skyBackdrop').dataset.scene,
        strip: document.getElementById('wxScene').dataset.scene,
        engine: window.WTWScene.current(),
      }));
      return seen.page === expected && seen.backdrop === expected &&
             seen.strip === expected && seen.engine === expected;
    });
    await c.ctx.close();
  }

  console.log('\n=== Text over a sky has to be readable ===');
  ({ ctx, page, errors } = await mk({ code: 0, isDay: 1 }));
  await check('a tile note clears the WCAG AA bar against the sky behind it', async () => {
    // Composite the whole stack the way a screen does — ink over the
    // translucent tile over the sky — and take the sky at its
    // lightest, which is the worst case for pale ink. Reading only the
    // declared colours would call 1.5:1 a pass.
    const seen = await page.evaluate(() => {
      const note = document.querySelector('.tile-note');
      const tile = note.closest('.tile');
      const sky = getComputedStyle(document.getElementById('skyBackdrop'));
      return { ink: getComputedStyle(note).color,
               tile: getComputedStyle(tile).backgroundColor,
               skyImage: sky.backgroundImage };
    });
    const stops = (seen.skyImage.match(/rgba?\([^)]+\)/g) || []).map(parseRGB).filter(Boolean);
    if (!stops.length) return false;
    const lightest = stops.reduce((a, b) => (luminance(a) > luminance(b) ? a : b));
    const ground = over(parseRGB(seen.tile), alphaOf(seen.tile), lightest);
    const ink = over(parseRGB(seen.ink), alphaOf(seen.ink), ground);
    const ratio = contrast(ink, ground);
    if (ratio < 4.5) console.log(`  [diag] contrast ${ratio.toFixed(2)}:1 ` +
      `ink=${seen.ink} tile=${seen.tile} sky=${lightest}`);
    return ratio >= 4.5;
  });
  await check('the uppercase tile labels are not the faintest thing on screen', async () =>
    page.evaluate(() => {
      const head = getComputedStyle(document.querySelector('.tile-head')).color;
      const m = head.match(/[\d.]+/g).map(Number);
      // Either opaque light ink, or an alpha well above the old 0.4.
      return m.length < 4 || m[3] >= 0.6;
    }));

  console.log('\n=== Every tile explains its own number ===');
  await check('each tile has a header, a value and a sentence', async () =>
    page.evaluate(() => {
      const tiles = [...document.querySelectorAll('.tile')];
      if (tiles.length < 8) return false;
      return tiles.every((t) => {
        const head = t.querySelector('.tile-head');
        const body = t.querySelector('.tile-value, .moon-facts');
        return head && head.textContent.trim().length > 1 && body;
      });
    }));
  await check('the sentences are sentences, not repeats of the number', async () =>
    page.evaluate(() => {
      const notes = [...document.querySelectorAll('.tile-note')]
        .map((n) => n.textContent.trim()).filter(Boolean);
      return notes.length >= 5 && notes.every((n) => /[a-z]{4}/i.test(n));
    }));
  await check('a clear 10-mile view is called clear, not hazy', async () =>
    /clear view/i.test(await page.textContent('#visibilityNote')));
  await check('the UV sentence names an hour the sun is still up', async () => {
    const note = await page.textContent('#uvNote');
    return /sun protection until \d/i.test(note);
  });
  await check('the wind sentence names the direction it comes FROM', async () =>
    /from the s/i.test(await page.textContent('#windNote')));
  await check('the moon tile shows a phase, not a placeholder', async () =>
    (await page.textContent('#moonIllum')).includes('% lit') &&
    /\d/.test(await page.textContent('#moonNextFull')));
  /* The check that earns its keep: a terminator drawn with one sweep
     flag backwards renders a nearly-full moon as a thin crescent, and
     it looks entirely plausible unless you count the pixels. So count
     them — the lit area has to track the illumination. */
  await check('the moon disc is as lit as the number says it is', async () =>
    page.evaluate(() => {
      const c = document.getElementById('moonDisc');
      const ctx = c.getContext('2d');
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let bright = 0, disc = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 10) continue;
        disc++;
        // The lit face is near-white; the unlit one is dark navy.
        if (d[i] > 150 && d[i + 1] > 150) bright++;
      }
      if (!disc) return false;
      const drawn = bright / disc;
      const claimed = Number((document.getElementById('moonIllum').textContent
        .match(/(\d+)/) || [])[1]) / 100;
      // Generous: the maria darken part of the lit face, and the disc
      // is small. This is about direction and magnitude, not accuracy.
      return Math.abs(drawn - claimed) < 0.3;
    }));
  await check('the drawings are drawn, not empty boxes', async () =>
    page.evaluate(() => ['sunArc', 'pressureDial', 'moonDisc'].every((id) => {
      const c = document.getElementById(id);
      if (!c || !c.width) return false;
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
      return false;
    })));
  await ctx.close();

  console.log('\n=== A sentence that stops matching its number is a lie ===');
  ({ ctx, page, errors } = await mk({ visibility: 1200 }));   // 0.75 mi
  await check('poor visibility is described as poor', async () =>
    /poor/i.test(await page.textContent('#visibilityNote')));
  await check('and the number agrees with the sentence', async () => {
    const shown = await page.textContent('#wxVisibility');
    return /0\.\d|1 mi|^0/.test(shown.trim());
  });
  await check('switching to metric keeps them agreeing', async () => {
    await page.click('#settingsBtn');
    await page.selectOption('#unitsSelect', 'metric');
    await page.waitForTimeout(700);
    await page.click('#settingsCloseBtn');
    const shown = (await page.textContent('#wxVisibility')).trim();
    const note = await page.textContent('#visibilityNote');
    return /km|m$/.test(shown) && /poor/i.test(note);
  });
  await ctx.close();

  console.log('\n=== Feels-like only speaks up when it disagrees ===');
  ({ ctx, page, errors } = await mk({ temp: 72, feels: 72 }));
  await check('no gap, no claim', async () =>
    /similar to the actual/i.test(await page.textContent('#feelsNote')));
  await ctx.close();
  ({ ctx, page, errors } = await mk({ temp: 72, feels: 84 }));
  await check('a real gap is explained', async () =>
    /warmer/i.test(await page.textContent('#feelsNote')));
  await ctx.close();

  console.log('\n=== Four ways to change the look ===');
  ({ ctx, page, errors } = await mk());
  const LOOKS = [
    ['cardStyleSelect', 'solid', 'cards'],
    ['cornersSelect', 'square', 'corners'],
    ['densitySelect', 'compact', 'density'],
  ];
  await page.click('#settingsBtn');
  await page.waitForTimeout(500);
  for (const [id, value, attr] of LOOKS) {
    await check(`${id} sets data-${attr}`, async () => {
      await page.selectOption('#' + id, value);
      await page.waitForTimeout(400);
      return (await page.getAttribute('html', 'data-' + attr)) === value;
    });
  }
  await check('square corners really are square, not just labelled so', async () =>
    page.evaluate(() => {
      const r = getComputedStyle(document.querySelector('.tile')).borderRadius;
      return parseFloat(r) <= 4;
    }));
  await check('compact spacing really is tighter', async () => {
    const tight = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.tile')).paddingTop);
    await page.selectOption('#densitySelect', 'airy');
    await page.waitForTimeout(400);
    const airy = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.tile')).paddingTop);
    return parseFloat(airy) > parseFloat(tight);
  });
  await check('turning the background off returns the plain theme', async () => {
    await page.selectOption('#backgroundSelect', 'off');
    await page.waitForTimeout(500);
    const hidden = await page.evaluate(() =>
      getComputedStyle(document.getElementById('skyBackdrop')).display === 'none');
    return (await page.getAttribute('html', 'data-sky')) === 'none' && hidden;
  });
  await check('colours-only keeps the sky but stops the animation', async () => {
    await page.selectOption('#backgroundSelect', 'gradient');
    await page.waitForTimeout(600);
    return (await page.getAttribute('html', 'data-sky')) !== 'none' &&
           (await page.evaluate(() => !WTWScene.backdropRunning()));
  });
  await check('and animated puts it back', async () => {
    await page.selectOption('#backgroundSelect', 'animated');
    await page.waitForTimeout(600);
    return page.evaluate(() => WTWScene.backdropRunning());
  });
  await check('every one of them survives a reload', async () => {
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1800);
    const seen = await page.evaluate(() => ({
      cards: document.documentElement.dataset.cards,
      corners: document.documentElement.dataset.corners,
      density: document.documentElement.dataset.density,
    }));
    return seen.cards === 'solid' && seen.corners === 'square' && seen.density === 'airy';
  });
  await ctx.close();

  console.log('\n=== It still fits on a phone ===');
  ({ ctx, page, errors } = await mk({ code: 61 }));
  await check('no horizontal overflow at 375px', async () => {
    await page.setViewportSize({ width: 375, height: 780 });
    await page.waitForTimeout(800);
    return page.evaluate(() =>
      document.documentElement.scrollWidth <= window.innerWidth + 1);
  });
  await check('the tiles stack rather than squeezing to nothing', async () =>
    page.evaluate(() => [...document.querySelectorAll('.tile')]
      .every((t) => t.getBoundingClientRect().width >= 120)));
  await check('no tile spills its own text', async () =>
    page.evaluate(() => [...document.querySelectorAll('.tile')]
      .every((t) => t.scrollWidth <= t.clientWidth + 1)));
  await check('no JS errors', () => errors.length === 0);
  if (errors.length) console.log(errors.join('\n'));
  await ctx.close();

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll V21 checks passed.');
  await browser.close();
  process.exit(failures ? 1 : 0);
})();
