/* ============================================================
   Aither Weather V21 — rain.js
   Picks the most authoritative precipitation source available and
   says which one answered.

   Order:
     1. NWS forecast grid (US) — the local forecast office's own
        quantitative precipitation forecast and probability grid,
        i.e. the numbers the public NWS forecast is built from.
     2. MET Norway locationforecast (worldwide) — an independent
        national met service, not another view of the same model.
     3. Open-Meteo — a model blend, kept as the last resort.

   All three are free and need no API key. The chosen source is
   surfaced in the UI so a figure can always be traced back.
   ============================================================ */

const WTWRain = (() => {

  const cfg = () => (window.WTW_CONFIG && WTW_CONFIG.rain) || { order: ['open-meteo'], labels: {} };

  function label(source) {
    return (cfg().labels && cfg().labels[source]) || source;
  }

  async function getJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  /* ---------------- 1. NWS forecast grid (US) ---------------- */

  async function fromNwsGrid(ctx) {
    if (!ctx.nwsPoint) return null;
    const slots = await NWS.getPrecipitationGrid(ctx.nwsPoint);
    if (!slots || !slots.length) return null;
    return { source: 'nws-grid', slots, stepMinutes: 60, precise: false };
  }

  /* ---------------- 2. MET Norway (worldwide) ---------------- */

  async function fromMetNo(ctx) {
    const { lat, lon } = ctx;
    if (typeof lat !== 'number' || typeof lon !== 'number') return null;
    // MET Norway asks for coordinates truncated to 4 decimals.
    const url = `${WTW_CONFIG.api.metno}?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;
    try {
      const data = await getJSON(url);
      const series = (data.properties && data.properties.timeseries) || [];
      if (!series.length) return null;

      const slots = [];
      for (const entry of series) {
        const next = entry.data && (entry.data.next_1_hours || entry.data.next_6_hours);
        if (!next || !next.details) continue;
        const hours = entry.data.next_1_hours ? 1 : 6;
        const amount = next.details.precipitation_amount;
        const prob = next.details.probability_of_precipitation;
        // A 6-hour block is spread evenly so the units stay mm/hour.
        const perHour = (amount === null || amount === undefined) ? null : amount / hours;
        const start = new Date(entry.time);
        if (isNaN(start)) continue;
        for (let i = 0; i < hours; i++) {
          slots.push({
            time: new Date(start.getTime() + i * 3600000),
            mm: perHour,
            prob: (prob === null || prob === undefined) ? null : prob,
          });
        }
      }
      if (!slots.length) return null;
      return { source: 'met-no', slots, stepMinutes: 60, precise: false };
    } catch (err) {
      console.warn('[rain] MET Norway unavailable', err.message);
      return null;
    }
  }

  /* ---------------- 3. Open-Meteo (fallback) ---------------- */

  function fromOpenMeteo(ctx) {
    const data = ctx.openMeteoRaw;
    if (!data) return null;

    // Prefer the 15-minute series where it is published.
    const m = data.minutely_15 || {};
    if (Array.isArray(m.time) && m.time.length) {
      const slots = m.time.map((t, i) => ({
        time: new Date(t),
        mm: m.precipitation ? m.precipitation[i] : null,
        prob: m.precipitation_probability ? m.precipitation_probability[i] : null,
      }));
      if (slots.some((s) => s.mm !== null || s.prob !== null)) {
        return { source: 'open-meteo', slots, stepMinutes: 15, precise: true };
      }
    }

    const h = data.hourly || {};
    if (Array.isArray(h.time) && h.time.length) {
      const slots = h.time.map((t, i) => ({
        time: new Date(t),
        mm: h.precipitation ? h.precipitation[i] : null,
        prob: h.precipitation_probability ? h.precipitation_probability[i] : null,
      }));
      if (slots.some((s) => s.mm !== null || s.prob !== null)) {
        return { source: 'open-meteo', slots, stepMinutes: 60, precise: false };
      }
    }
    return null;
  }

  const PROVIDERS = {
    'nws-grid': fromNwsGrid,
    'met-no': fromMetNo,
    'open-meteo': (ctx) => Promise.resolve(fromOpenMeteo(ctx)),
  };

  /* ------------------------------------------------------------
     Try each configured source in order and return the first that
     produces a usable series, tagged with its label.
     ctx = { lat, lon, nwsPoint, openMeteoRaw }
     ------------------------------------------------------------ */
  async function getSeries(ctx) {
    for (const name of cfg().order || []) {
      const provider = PROVIDERS[name];
      if (!provider) continue;
      try {
        const result = await provider(ctx);
        if (result && result.slots && result.slots.length) {
          result.label = label(result.source);
          console.info(`[rain] using ${result.label} (${result.slots.length} slots)`);
          return result;
        }
      } catch (err) {
        console.warn(`[rain] ${name} failed`, err && err.message);
      }
    }
    return null;
  }

  return { getSeries, label, fromOpenMeteo, fromMetNo, fromNwsGrid };
})();

window.WTWRain = WTWRain;
