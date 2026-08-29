/* V12 radar accuracy: real timestamped frames, honest staleness. */
const { chromium } = require('playwright');
const BASE_URL = process.env.WTW_BASE_URL || 'http://localhost:8901';
const APP_DIR = process.env.WTW_APP_DIR || require('path').join(__dirname, '..');
const BROWSER = process.env.PLAYWRIGHT_CHROMIUM || undefined;

const fs = require('fs');
const PNG = fs.readFileSync(__dirname + '/fixture-radar-frame.png');
const AUSTIN = { lat: 30.2672, lon: -97.7431 };

// A RainViewer-shaped index: 8 observed frames 10 minutes apart, newest
// 4 min old, plus nowcast frames running on into the future.
function rvIndex({ newestAgeMin = 4, count = 8, ahead = 3 } = {}) {
  const newest = Math.floor((Date.now() - newestAgeMin * 60000) / 1000);
  const past = [];
  for (let i = count - 1; i >= 0; i--) {
    const t = newest - i * 600;
    past.push({ time: t, path: `/v2/radar/${t}` });
  }
  const nowcast = [];
  for (let i = 1; i <= ahead; i++) {
    const t = newest + i * 600;
    nowcast.push({ time: t, path: `/v2/radar/nowcast_${t}` });
  }
  return { version: '2.0', generated: newest, host: 'https://tilecache.rainviewer.com',
    radar: { past, nowcast } };
}

function omBody() {
  const t = [], temps = [], pops = [];
  for (let i = 0; i < 30; i++) { t.push(new Date(Date.now()+i*3600000).toISOString().slice(0,16)); temps.push(75); pops.push(5); }
  return JSON.stringify({
    current:{temperature_2m:80,apparent_temperature:80,relative_humidity_2m:50,weather_code:0,wind_speed_10m:8,wind_direction_10m:180,is_day:1,pressure_msl:1012,dew_point_2m:60},
    hourly:{time:t,temperature_2m:temps,precipitation_probability:pops,weather_code:t.map(()=>0),wind_speed_10m:t.map(()=>8),visibility:t.map(()=>16093)},
    daily:{time:['2026-08-28'],weather_code:[0],temperature_2m_max:[95],temperature_2m_min:[72],precipitation_probability_max:[10],sunrise:['2026-08-28T07:00'],sunset:['2026-08-28T19:00'],uv_index_max:[7]}});
}

(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER });
  let failures = 0;
  const check = async (n, fn) => {
    try { const ok = await fn(); console.log((ok?'PASS':'FAIL') + ' - ' + n); if(!ok) failures++; }
    catch (e) { console.log('FAIL - ' + n + ' (' + e.message.split('\n')[0] + ')'); failures++; }
  };

  const mk = async (rvOpts, { rvFails = false } = {}) => {
    const ctx = await browser.newContext({ viewport:{width:1280,height:1000}, serviceWorkers:'block' });
    const page = await ctx.newPage();
    // Deny every external host by default. Routes registered after this one
    // win, so each suite still stubs what it needs - but anything a suite
    // forgot fails closed instead of quietly reaching the real internet.
    // A predicate, not a glob: 'https://**' matches nothing at all.
    await page.route((u) => u.protocol === 'https:', (r) => r.abort());
    const tiles = [], wms = [];
    const INDEX = JSON.stringify(rvIndex(rvOpts));   // fixed for this run
    await page.route('https://api.rainviewer.com/**', r =>
      rvFails ? r.fulfill({ status: 500, body: '{}' })
              : r.fulfill({ contentType:'application/json', body: INDEX }));
    await page.route('https://tilecache.rainviewer.com/**', r => {
      tiles.push(r.request().url());
      return r.fulfill({ contentType:'image/png', body: PNG });
    });
    await page.route('https://opengeo.ncep.noaa.gov/**', r => { wms.push(r.request().url()); return r.fulfill({headers:{'cache-control':'no-store'}, contentType:'image/png', body:PNG}); });
    await page.route('https://basemaps.cartocdn.com/**', r => r.fulfill({headers:{'cache-control':'no-store'}, contentType:'image/png', body:PNG}));
    await page.route('https://api.met.no/**', r => r.abort());
    await page.route('https://air-quality-api.open-meteo.com/**', r => r.abort());
    await page.route('https://api.weather.gov/**', r => r.fulfill({status:404, body:'{}'}));
    await page.route('https://geocoding-api.open-meteo.com/**', r => r.fulfill({contentType:'application/json',
      body: JSON.stringify({results:[{name:'Austin',admin1:'Texas',country_code:'US',latitude:AUSTIN.lat,longitude:AUSTIN.lon}]})}));
    await page.route('https://api.open-meteo.com/**', r => r.fulfill({contentType:'application/json', body: omBody()}));
    await page.goto(BASE_URL + '/index.html', { waitUntil:'networkidle' });
    await page.fill('#searchInput','Austin'); await page.click('#searchBtn');
    await page.waitForSelector('#weatherPanels:not([hidden])', { timeout:20000 });
    await page.waitForTimeout(3000);
    return { ctx, page, tiles, wms };
  };

  console.log('=== Frames come from a published index, not guessed times ===');
  let { ctx, page, tiles, wms } = await mk();
  await check('radar tiles were requested', () => tiles.length > 0);
  await check('the WMS mosaic was not needed', () => wms.length === 0);
  await check('badge reports LIVE RADAR', async () =>
    (await page.textContent('#radarSource')).trim() === 'LIVE RADAR');
  await check('badge tooltip states the frame age', async () =>
    /min old/.test(await page.getAttribute('#radarSource', 'title')));
  await check('timeline offers every published frame', async () =>
    (await page.getAttribute('#radarTimeline', 'max')) === '10');
  await check('tile URLs carry the frame timestamp and z/x/y', () => {
    const m = tiles[0].match(/\/v2\/radar\/(\d+)\/(\d+)\/(\d+)\/(\d+)\/(\d+)\/(\d+)\/(\d)_(\d)\.png/);
    if (!m) return false;
    const ts = Number(m[1]), z = Number(m[3]), x = Number(m[4]), y = Number(m[5]);
    const n = Math.pow(2, z);
    // A plausible recent unix timestamp, and in-range tile coordinates.
    return ts > 1_600_000_000 && Math.abs(Date.now()/1000 - ts) < 86400 &&
           z >= 2 && z <= 10 && x >= 0 && x < n && y >= 0 && y < n;
  });
  await check('every requested frame timestamp exists in the index', async () => {
    const indexTimes = await page.evaluate(async () => {
      const r = await fetch('https://api.rainviewer.com/public/weather-maps.json');
      const d = await r.json();
      return d.radar.past.concat(d.radar.nowcast).map((f) => f.time);
    });
    // Nowcast frames are published under a different path shape, so
    // accept both and check against observations and predictions alike.
    const used = new Set(tiles
      .map((u) => u.match(/\/v2\/radar\/(?:nowcast_)?(\d+)\//))
      .filter(Boolean).map((m) => Number(m[1])));
    return used.size > 0 && [...used].every((t) => indexTimes.includes(t));
  });
  await check('it opens on the newest observation, not on a prediction', async () => {
    // The loop advances frames on its own, so stop it and reload rather
    // than asserting against whatever second the suite arrived at.
    await page.click('#radarStopBtn');
    await page.click('#radarRefreshBtn');
    await page.waitForTimeout(1500);
    const label = (await page.textContent('#radarTimeLabel')).trim();
    const value = await page.inputValue('#radarTimeline');
    const ok = label === 'NOW' && value === '7';
    if (!ok) console.log(`  [diag] label=${label} slider=${value} ` +
      `playing=${await page.evaluate(() => WTWRadar.isAnimating())}`);
    return ok;
  });
  await check('scrubbing shows the frame\'s real clock time', async () => {
    await page.click('#radarStopBtn');
    await page.locator('#radarTimeline').fill('0');
    const label = (await page.textContent('#radarTimeLabel')).trim();
    return /\d/.test(label) && label !== 'NOW';
  });
  await check('the forecast frames are on the timeline too', async () => {
    const max = Number(await page.getAttribute('#radarTimeline', 'max'));
    return max === 10;      // 8 observed + 3 nowcast, zero-indexed
  });
  await check('scrubbing ahead is labelled as minutes into the future', async () => {
    await page.locator('#radarTimeline').fill('10');
    await page.waitForTimeout(300);
    return /^\+\d+ min$/.test((await page.textContent('#radarTimeLabel')).trim());
  });
  await check('a prediction is never badged as live radar', async () =>
    (await page.textContent('#radarSource')).trim() === 'FORECAST' &&
    !(await page.getAttribute('#radarSource', 'class')).includes('live-source'));
  await check('the badge says a prediction is a prediction', async () =>
    /not an observation/i.test(await page.getAttribute('#radarSource', 'title')));
  await check('the end of the timeline says how far ahead it runs', async () =>
    /^\+\d+ min$/.test((await page.textContent('#radarTimelineEnd')).trim()));
  await check('scrubbing back to the present restores the live badge', async () => {
    await page.locator('#radarTimeline').fill('7');
    await page.waitForTimeout(300);
    return (await page.textContent('#radarSource')).trim() === 'LIVE RADAR';
  });
  await check('frame age is measured from the observation, not the forecast', async () =>
    /4 min old|3 min old|5 min old/.test(await page.getAttribute('#radarSource', 'title')));
  await check('frames are 10 minutes apart as published', async () =>
    page.evaluate(async () => {
      const r = await fetch('https://api.rainviewer.com/public/weather-maps.json');
      const d = await r.json();
      const t = d.radar.past.map((f) => f.time);
      for (let i = 1; i < t.length; i++) if (t[i] - t[i-1] !== 600) return false;
      return true;
    }));
  await ctx.close();

  console.log('\n=== Stale imagery is labelled, not called live ===');
  ({ ctx, page, tiles } = await mk({ newestAgeMin: 95 }));
  await check('badge says STALE when the newest frame is old', async () =>
    (await page.textContent('#radarSource')).trim() === 'RADAR (STALE)');
  await check('stale badge is not styled as live', async () =>
    !(await page.getAttribute('#radarSource', 'class')).includes('live-source'));
  await ctx.close();

  console.log('\n=== Falls back cleanly when the index is unavailable ===');
  ({ ctx, page, tiles, wms } = await mk({}, { rvFails: true }));
  await check('falls back to the NOAA mosaic', async () =>
    wms.length > 0 && /NWS/.test(await page.textContent('#radarSource')));
  await check('no radar tiles were drawn in fallback', () => tiles.length === 0);
  await ctx.close();

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll radar accuracy checks passed.');
  await browser.close();
  process.exit(failures ? 1 : 0);
})();
