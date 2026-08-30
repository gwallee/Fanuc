/* normals.js — what "normal" actually is here.

   Apple's Weather has an Averages tile: today's high against the
   average high for this date. An average needs history, and this app
   had none — so rather than show a plausible-looking number derived
   from nothing, there was no tile.

   Open-Meteo publishes a free, key-less archive going back decades.
   This fetches the same calendar date across the last N years and
   averages the daily maximum, which is a real climate normal for that
   date rather than an average of the week or of the month.

   Three things it will not do:

     - Guess. Fewer than a handful of usable years and it returns
       nothing, and the tile stays hidden.
     - Compare across a leap day. 29 February has a quarter of the
       samples of every other date; it borrows 28 February instead.
     - Cost a request per view. A location's normals for a date do not
       change, so they are cached for a day.

   The published WMO normal is a 30-year window. Ten years is what is
   fetched here: it is one request rather than three, the arithmetic
   is identical, and the wording says "recent years" rather than
   claiming a WMO normal it is not. */
const WTWNormals = (() => {
  'use strict';

  const YEARS = 10;
  const MIN_YEARS = 5;              // below this, say nothing
  const CACHE_KEY = 'wtw:normals';
  const CACHE_MS = 24 * 3600 * 1000;

  function cacheRead(key) {
    try {
      const all = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      const hit = all[key];
      if (!hit || Date.now() - hit.at > CACHE_MS) return null;
      return hit.value;
    } catch (err) { return null; }
  }

  function cacheWrite(key, value) {
    try {
      const all = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      // Keep it small: a handful of places is all anyone looks at.
      const keys = Object.keys(all);
      if (keys.length > 12) keys.slice(0, keys.length - 12).forEach((k) => delete all[k]);
      all[key] = { at: Date.now(), value };
      localStorage.setItem(CACHE_KEY, JSON.stringify(all));
    } catch (err) { /* storage full or blocked: the figure is optional */ }
  }

  const pad = (n) => String(n).padStart(2, '0');

  /* The date to average, and the years to average it over. February
     29th borrows the 28th: three years in four it does not exist, so
     its sample is a quarter the size of every other date's and the
     average is correspondingly noisier. */
  function targetDate(when) {
    const month = when.getMonth() + 1;
    const day = (month === 2 && when.getDate() === 29) ? 28 : when.getDate();
    return { month, day };
  }

  async function fetchJSON(url) {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error('archive ' + res.status);
    return res.json();
  }

  /* One request covering every year at once: the archive accepts a
     single span, and the days that are not the target date are simply
     ignored. Ten separate one-day requests would be ten round trips
     for the same answer. */
  async function fetchNormal(location, when = new Date()) {
    const { month, day } = targetDate(when);
    const key = `${location.lat.toFixed(2)},${location.lon.toFixed(2)}:${month}-${day}`;
    const cached = cacheRead(key);
    if (cached !== null) return cached;

    // The archive lags real time by about five days, so this year's
    // date is never available and the window ends last year.
    const lastYear = when.getFullYear() - 1;
    const firstYear = lastYear - (YEARS - 1);
    const params = new URLSearchParams({
      latitude: String(location.lat),
      longitude: String(location.lon),
      start_date: `${firstYear}-01-01`,
      end_date: `${lastYear}-12-31`,
      daily: 'temperature_2m_max,temperature_2m_min',
      temperature_unit: 'fahrenheit',
      timezone: 'auto',
    });

    let data;
    try {
      data = await fetchJSON(`${WTW_CONFIG.api.archive}?${params}`);
    } catch (err) {
      return null;
    }

    const times = (data.daily && data.daily.time) || [];
    const maxes = (data.daily && data.daily.temperature_2m_max) || [];
    const mins = (data.daily && data.daily.temperature_2m_min) || [];
    const wanted = `-${pad(month)}-${pad(day)}`;

    const highs = [], lows = [];
    for (let i = 0; i < times.length; i++) {
      if (!String(times[i]).endsWith(wanted)) continue;
      if (typeof maxes[i] === 'number') highs.push(maxes[i]);
      if (typeof mins[i] === 'number') lows.push(mins[i]);
    }

    // Too little history to average is not an average.
    if (highs.length < MIN_YEARS) {
      cacheWrite(key, null);
      return null;
    }

    const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const value = {
      highF: mean(highs),
      lowF: lows.length >= MIN_YEARS ? mean(lows) : null,
      years: highs.length,
      firstYear,
      lastYear,
    };
    cacheWrite(key, value);
    return value;
  }

  return { fetchNormal, targetDate, YEARS, MIN_YEARS };
})();

window.WTWNormals = WTWNormals;
