/* ============================================================
   What the Wether V14 — nws.js
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

  function quality() {
    return (window.WTW_CONFIG && WTW_CONFIG.nwsQuality) ||
           { maxStationKm: 40, maxObsAgeMinutes: 90 };
  }

  // Great-circle distance, used to reject stations too far away to
  // represent the searched point.
  function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

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
        gridDataUrl: p.forecastGridData,
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
     Latest observation from the nearest usable reporting station.

     Accuracy rules, in order:
       1. Sort candidate stations by true distance from the searched
          point and discard any beyond `maxStationKm` — a reading
          from 80 km away is not this location's weather.
       2. Skip stations with no temperature (some report only wind
          or pressure).
       3. Skip readings older than `maxObsAgeMinutes`. NWS keeps
          serving the last observation indefinitely, so an offline
          station will happily hand back this morning's temperature.
     Returning null when nothing qualifies is deliberate: app.js
     then falls back to Open-Meteo rather than showing a stale or
     unrepresentative number.
     ------------------------------------------------------------ */
  async function getCurrentObservation(point, lat, lon) {
    if (!point || !point.stationsUrl) return null;
    const q = quality();
    try {
      const list = await getJSON(point.stationsUrl);
      const haveOrigin = typeof lat === 'number' && typeof lon === 'number';

      let stations = (list.features || []).map((f) => {
        const props = f.properties || {};
        const coords = (f.geometry && f.geometry.coordinates) || [];
        const distanceKm = (haveOrigin && coords.length === 2)
          ? haversineKm(lat, lon, coords[1], coords[0])
          : null;
        return { id: props.stationIdentifier, name: props.name || '', distanceKm };
      }).filter((st) => st.id);

      // Nearest first, then drop anything unrepresentative.
      stations.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
      stations = stations
        .filter((st) => st.distanceKm === null || st.distanceKm <= q.maxStationKm)
        .slice(0, 4);

      for (const st of stations) {
        try {
          const obs = await getJSON(`${base()}/stations/${st.id}/observations/latest`);
          const p = obs.properties || {};
          const tempC = p.temperature && p.temperature.value;
          if (tempC === null || tempC === undefined) continue;

          const observedAt = p.timestamp ? new Date(p.timestamp) : null;
          const ageMinutes = observedAt && !isNaN(observedAt)
            ? (Date.now() - observedAt.getTime()) / 60000
            : null;
          if (ageMinutes !== null && ageMinutes > q.maxObsAgeMinutes) {
            console.info(`[nws] skipping ${st.id}: observation is ${Math.round(ageMinutes)} min old`);
            continue;
          }

          const feelsC =
            (p.heatIndex && p.heatIndex.value) ??
            (p.windChill && p.windChill.value) ??
            tempC;

          return {
            tempF: cToF(tempC),
            feelsLikeF: cToF(feelsC),
            humidity: p.relativeHumidity ? p.relativeHumidity.value : null,
            // Left null when absent — the UI shows "--" rather than
            // implying dead calm.
            windMph: kmhToMph(p.windSpeed ? p.windSpeed.value : null),
            windDirDeg: p.windDirection ? p.windDirection.value : null,
            dewPointF: cToF(p.dewpoint ? p.dewpoint.value : null),
            // NWS reports pressure in Pa and visibility in metres.
            pressureInHg: p.barometricPressure && p.barometricPressure.value != null
              ? p.barometricPressure.value * 0.0002953 : null,
            visibilityMi: p.visibility && p.visibility.value != null
              ? p.visibility.value * 0.000621371 : null,
            description: p.textDescription || '',
            station: st.id,
            stationName: st.name,
            distanceKm: st.distanceKm,
            observedAt,
            ageMinutes,
          };
        } catch (_) {
          // Station unavailable — fall through to the next one.
        }
      }
      console.info('[nws] no nearby station with a fresh reading');
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
     Hourly forecast periods, for the 48-hour outlook.
     ------------------------------------------------------------ */
  async function getHourly(point) {
    if (!point || !point.hourlyUrl) return null;
    try {
      const data = await getJSON(point.hourlyUrl);
      const periods = (data.properties && data.properties.periods) || [];
      return periods.length ? periods : null;
    } catch (err) {
      console.warn('[nws] hourly forecast failed', err.message);
      return null;
    }
  }

  /* ------------------------------------------------------------
     Raw forecast grid: the office's own quantitative precipitation
     forecast and probability of precipitation. This is the source the
     public NWS forecast is built from, so it is the most authoritative
     precipitation figure available for a US point.

     Values arrive as ISO-8601 intervals ("<start>/<duration>"), each
     covering 1 to 12 hours, so they are expanded to hourly slots with
     the amount divided evenly across the interval.
     ------------------------------------------------------------ */

  // Parses the subset of ISO-8601 durations NWS emits (PT6H, P1DT2H…).
  function durationHours(text) {
    const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(String(text || ''));
    if (!m) return 1;
    const days = Number(m[1] || 0);
    const hours = Number(m[2] || 0);
    const minutes = Number(m[3] || 0);
    const total = days * 24 + hours + minutes / 60;
    return total > 0 ? total : 1;
  }

  // [{ validTime, value }] -> Map of hour-start ms -> value
  function expandToHours(values, { divide = false } = {}) {
    const out = new Map();
    (values || []).forEach((entry) => {
      if (!entry || entry.value === null || entry.value === undefined) return;
      const [startText, durText] = String(entry.validTime).split('/');
      const start = new Date(startText);
      if (isNaN(start)) return;
      const hours = Math.max(1, Math.round(durationHours(durText)));
      // An amount covers the whole interval, so spread it; a probability
      // applies to every hour in it, so repeat it.
      const perHour = divide ? entry.value / hours : entry.value;
      for (let i = 0; i < hours; i++) {
        out.set(start.getTime() + i * 3600000, perHour);
      }
    });
    return out;
  }

  async function getPrecipitationGrid(point) {
    if (!point || !point.gridDataUrl) return null;
    try {
      const data = await getJSON(point.gridDataUrl);
      const p = data.properties || {};
      const pop = expandToHours(p.probabilityOfPrecipitation && p.probabilityOfPrecipitation.values);
      const qpf = expandToHours(
        p.quantitativePrecipitation && p.quantitativePrecipitation.values, { divide: true });
      if (!pop.size && !qpf.size) return null;

      const stamps = Array.from(new Set([...pop.keys(), ...qpf.keys()])).sort((a, b) => a - b);
      return stamps.map((ms) => ({
        time: new Date(ms),
        mm: qpf.has(ms) ? qpf.get(ms) : null,
        prob: pop.has(ms) ? pop.get(ms) : null,
      }));
    } catch (err) {
      console.warn('[nws] precipitation grid failed', err.message);
      return null;
    }
  }

  /* ------------------------------------------------------------
     Active watches / warnings / advisories for a point.
     Geometry is kept so the radar can outline the warned area;
     zone-based alerts sometimes carry none, which is fine.
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
          geometry: f.geometry || null,
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

  return { getPoint, getCurrentObservation, getForecast, getHourly, getAlerts,
           getPrecipitationGrid, textToCode, durationHours };
})();

window.NWS = NWS;
