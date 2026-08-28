/* ============================================================
   What the Wether V13 — compare.js
   Side-by-side view of every saved location.

   Uses Open-Meteo for all rows regardless of country: one compact
   request per favorite, run in parallel, so the grid is consistent
   and fast. Individual failures degrade to a single row showing
   "unavailable" rather than emptying the grid.
   ============================================================ */

const WTWCompare = (() => {
  const state = { rows: [], loading: false, loadedAt: 0 };

  async function getJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function fetchOne(fav) {
    const p = new URLSearchParams({
      latitude: String(fav.lat),
      longitude: String(fav.lon),
      current: ['temperature_2m', 'weather_code', 'wind_speed_10m', 'relative_humidity_2m'].join(','),
      daily: ['temperature_2m_max', 'temperature_2m_min', 'precipitation_probability_max'].join(','),
      temperature_unit: 'fahrenheit',
      wind_speed_unit: 'mph',
      timezone: 'auto',
      forecast_days: '1',
    });
    try {
      const data = await getJSON(`${WTW_CONFIG.api.forecast}?${p}`);
      const c = data.current || {};
      const d = data.daily || {};
      return {
        location: fav,
        ok: true,
        tempF: c.temperature_2m ?? null,
        code: c.weather_code ?? 0,
        windMph: c.wind_speed_10m ?? null,
        humidity: c.relative_humidity_2m ?? null,
        highF: Array.isArray(d.temperature_2m_max) ? d.temperature_2m_max[0] : null,
        lowF: Array.isArray(d.temperature_2m_min) ? d.temperature_2m_min[0] : null,
        precipProb: Array.isArray(d.precipitation_probability_max) ? d.precipitation_probability_max[0] : null,
      };
    } catch (err) {
      console.warn('[compare] failed for', fav.name, err.message);
      return { location: fav, ok: false };
    }
  }

  async function load(favorites) {
    const max = (WTW_CONFIG.compare && WTW_CONFIG.compare.maxLocations) || 8;
    const list = (favorites || []).slice(0, max);
    if (!list.length) {
      state.rows = [];
      return state.rows;
    }
    state.loading = true;
    try {
      state.rows = await Promise.all(list.map(fetchOne));
      state.loadedAt = Date.now();
      return state.rows;
    } finally {
      state.loading = false;
    }
  }

  function getRows() { return state.rows; }
  function isLoading() { return state.loading; }

  // Warmest first, so the grid says something at a glance.
  function sorted() {
    return state.rows.slice().sort((a, b) => {
      if (!a.ok) return 1;
      if (!b.ok) return -1;
      return (b.tempF ?? -999) - (a.tempF ?? -999);
    });
  }

  return { load, getRows, sorted, isLoading };
})();

window.WTWCompare = WTWCompare;
