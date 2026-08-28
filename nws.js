/* ============================================================
   What the Wether V8 — nws.js
   National Weather Service (api.weather.gov) client.

   Free, no API key, CORS-enabled. US + territories only, so
   every call here is best-effort: app.js falls back to
   Open-Meteo whenever any of this returns null.

   Docs: https://www.weather.gov/documentation/services-web-api
   ============================================================ */

const NWS = (() => {
  const base = () => WTW_CONFIG.api.nws;

  // api.weather.gov 301-redirects coordinates with more than 4
  // decimal places, so round before building any /points URL.
  function coord(n) {
    return Number(n).toFixed(4);
  }

  async function getJSON(url) {
    const res = await fetch(url, {
      headers: { Accept: 'application/geo+json' },
    });
    if (!res.ok) throw new Error(`NWS HTTP ${res.status} for ${url}`);
    return res.json();
  }

  /* ---- Unit conversion (NWS observations are always SI) ---- */

  function cToF(c) {
    return (c === null || c === undefined) ? null : (c * 9) / 5 + 32;
  }
  function kmhToMph(k) {
    return (k === null || k === undefined) ? null : k * 0.621371;
  }

  /* ------------------------------------------------------------
     /points/{lat},{lon} — the entry point for everything else.
     Returns null when the location is outside NWS coverage.
     ------------------------------------------------------------ */
  async function getPoint(lat, lon) {
    try {
      const data = await getJSON(`${base()}/points/${coord(lat)},${coord(lon)}`);
      const p = data.properties || {};
      if (!p.forecast) return null;
      const rel = (p.relativeLocation && p.relativeLocation.properties) || {};
      return {
        forecastUrl: p.forecast,
        hourlyUrl: p.forecastHourly,
        stationsUrl: p.observationStations,
        radarStation: p.radarStation || null,
        city: rel.city || null,
        state: rel.state || null,
        gridId: p.gridId,
        gridX: p.gridX,
        gridY: p.gridY,
      };
    } catch (err) {
      console.warn('[nws] /points failed (likely outside US coverage)', err.message);
      return null;
    }
  }

  /* ------------------------------------------------------------
     Latest observation from the nearest reporting station.
     Stations are tried in order because the closest one is not
     always reporting a full set of values.
     ------------------------------------------------------------ */
  async function getCurrentObservation(point) {
    if (!point || !point.stationsUrl) return null;
    try {
      const list = await getJSON(point.stationsUrl);
      const stations = (list.features || [])
        .map((f) => f.properties && f.properties.stationIdentifier)
        .filter(Boolean)
        .slice(0, 3);

      for (const id of stations) {
        try {
          const obs = await getJSON(`${base()}/stations/${id}/observations/latest`);
          const p = obs.properties || {};
          const tempC = p.temperature && p.temperature.value;
          if (tempC === null || tempC === undefined) continue; // try next station

          const feelsC =
            (p.heatIndex && p.heatIndex.value) ??
            (p.windChill && p.windChill.value) ??
            tempC;

          return {
            tempF: cToF(tempC),
            feelsLikeF: cToF(feelsC),
            humidity: p.relativeHumidity ? p.relativeHumidity.value : null,
            windMph: kmhToMph(p.windSpeed ? p.windSpeed.value : null) ?? 0,
            windDirDeg: p.windDirection ? p.windDirection.value : null,
            description: p.textDescription || '',
            station: id,
            timestamp: p.timestamp || null,
          };
        } catch (_) {
          // Station unavailable — fall through to the next one.
        }
      }
      return null;
    } catch (err) {
      console.warn('[nws] observations failed', err.message);
      return null;
    }
  }

  /* ------------------------------------------------------------
     NWS forecasts come as 12-hour day/night periods. Collapse
     them into one entry per calendar day so the existing 7-day
     forecast strip keeps working unchanged.
     ------------------------------------------------------------ */
  async function getForecast(point) {
    if (!point || !point.forecastUrl) return null;
    try {
      const data = await getJSON(point.forecastUrl);
      const periods = (data.properties && data.properties.periods) || [];
      if (!periods.length) return null;

      const byDate = new Map();
      for (const per of periods) {
        const date = String(per.startTime).slice(0, 10);
        if (!byDate.has(date)) {
          byDate.set(date, { dateISO: date, highF: null, lowF: null, precipProb: 0, text: '' });
        }
        const day = byDate.get(date);
        const t = per.temperature;

        if (per.isDaytime) {
          day.highF = day.highF === null ? t : Math.max(day.highF, t);
          day.text = per.shortForecast || day.text;
        } else {
          day.lowF = day.lowF === null ? t : Math.min(day.lowF, t);
          if (!day.text) day.text = per.shortForecast || '';
        }

        const pop = per.probabilityOfPrecipitation && per.probabilityOfPrecipitation.value;
        if (typeof pop === 'number') day.precipProb = Math.max(day.precipProb, pop);
      }

      return Array.from(byDate.values())
        .slice(0, WTW_CONFIG.weather.forecastDays)
        .map((d) => ({
          dateISO: d.dateISO,
          code: textToCode(d.text),
          highF: d.highF,
          lowF: d.lowF,
          precipProb: d.precipProb,
        }));
    } catch (err) {
      console.warn('[nws] forecast failed', err.message);
      return null;
    }
  }

  /* ------------------------------------------------------------
     Active watches / warnings / advisories for a point.
     ------------------------------------------------------------ */
  async function getAlerts(lat, lon) {
    try {
      const data = await getJSON(`${base()}/alerts/active?point=${coord(lat)},${coord(lon)}`);
      return (data.features || []).map((f) => {
        const p = f.properties || {};
        return {
          event: p.event || 'Alert',
          headline: p.headline || '',
          severity: p.severity || 'Unknown',
          urgency: p.urgency || '',
          areaDesc: p.areaDesc || '',
          expires: p.expires || null,
        };
      });
    } catch (err) {
      console.warn('[nws] alerts failed', err.message);
      return [];
    }
  }

  /* ------------------------------------------------------------
     NWS reports conditions as free text ("Partly Cloudy",
     "Thunderstorms and Rain"). Map it onto the WMO-style codes
     the icons and the roast AI already understand. Order is
     deliberate: the most severe match wins.
     ------------------------------------------------------------ */
  function textToCode(text) {
    const t = String(text || '').toLowerCase();
    if (!t) return 0;

    if (t.includes('thunder') || t.includes('tstm')) return 95;
    if (t.includes('hail')) return 96;
    if (t.includes('blizzard') || t.includes('heavy snow')) return 75;
    if (t.includes('freezing rain') || t.includes('ice pellets') || t.includes('sleet')) return 66;
    if (t.includes('freezing drizzle')) return 56;
    if (t.includes('snow shower') || t.includes('flurr')) return 85;
    if (t.includes('snow')) return 73;
    if (t.includes('heavy rain')) return 65;
    if (t.includes('rain shower') || t.includes('showers')) return 80;
    if (t.includes('drizzle')) return 53;
    if (t.includes('rain')) return 63;
    if (t.includes('fog') || t.includes('haze') || t.includes('mist')) return 45;
    if (t.includes('overcast') || t.includes('cloudy')) {
      return t.includes('partly') || t.includes('mostly sunny') ? 2 : 3;
    }
    if (t.includes('partly') || t.includes('few clouds') || t.includes('mostly clear')) return 2;
    if (t.includes('clear') || t.includes('sunny') || t.includes('fair')) return 0;
    return 0;
  }

  return { getPoint, getCurrentObservation, getForecast, getAlerts, textToCode };
})();

window.NWS = NWS;
