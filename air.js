/* ============================================================
   What the Wether V15 — air.js
   Air quality and pollen from Open-Meteo's air-quality API (free,
   no key), plus sun and moon figures computed locally.

   Pollen is only published for Europe by the upstream CAMS model,
   so those fields come back null elsewhere — the UI hides the
   section rather than showing zeroes that would read as "no pollen".
   ============================================================ */

const WTWAir = (() => {

  async function getJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  /* ---------------- Air quality ---------------- */

  const POLLENS = ['alder_pollen', 'birch_pollen', 'grass_pollen',
                   'mugwort_pollen', 'olive_pollen', 'ragweed_pollen'];

  async function fetchAirQuality(location) {
    const p = new URLSearchParams({
      latitude: String(location.lat),
      longitude: String(location.lon),
      current: ['us_aqi', 'pm2_5', 'pm10', 'ozone', 'nitrogen_dioxide',
                'sulphur_dioxide', 'carbon_monoxide'].concat(POLLENS).join(','),
      timezone: 'auto',
    });
    try {
      const data = await getJSON(`${WTW_CONFIG.api.airQuality}?${p}`);
      const c = data.current || {};
      const pollen = {};
      let anyPollen = false;
      POLLENS.forEach((key) => {
        const v = c[key];
        pollen[key] = (v === null || v === undefined) ? null : v;
        if (pollen[key] !== null) anyPollen = true;
      });
      return {
        aqi: c.us_aqi ?? null,
        pm25: c.pm2_5 ?? null,
        pm10: c.pm10 ?? null,
        ozone: c.ozone ?? null,
        no2: c.nitrogen_dioxide ?? null,
        so2: c.sulphur_dioxide ?? null,
        co: c.carbon_monoxide ?? null,
        pollen: anyPollen ? pollen : null,
      };
    } catch (err) {
      console.warn('[air] air quality unavailable', err.message);
      return null;
    }
  }

  // US EPA breakpoints.
  function aqiCategory(aqi) {
    if (aqi === null || aqi === undefined) return { label: '--', className: 'aqi-none', advice: '' };
    if (aqi <= 50)  return { label: 'Good', className: 'aqi-good', advice: 'Air quality is fine. Go breathe it.' };
    if (aqi <= 100) return { label: 'Moderate', className: 'aqi-moderate', advice: 'Fine for most people; unusually sensitive folks may notice it.' };
    if (aqi <= 150) return { label: 'Unhealthy for sensitive groups', className: 'aqi-sensitive', advice: 'Sensitive groups should ease up on long outdoor exertion.' };
    if (aqi <= 200) return { label: 'Unhealthy', className: 'aqi-unhealthy', advice: 'Everyone should limit prolonged outdoor exertion.' };
    if (aqi <= 300) return { label: 'Very unhealthy', className: 'aqi-very', advice: 'Avoid outdoor exertion. Seriously.' };
    return { label: 'Hazardous', className: 'aqi-hazardous', advice: 'Stay inside and keep the windows shut.' };
  }

  // Grains/m³ thresholds, roughly the common European scale.
  function pollenLevel(value) {
    if (value === null || value === undefined) return null;
    if (value < 1)  return { label: 'None', rank: 0 };
    if (value < 20) return { label: 'Low', rank: 1 };
    if (value < 50) return { label: 'Moderate', rank: 2 };
    if (value < 150) return { label: 'High', rank: 3 };
    return { label: 'Very high', rank: 4 };
  }

  function pollenSummary(pollen) {
    if (!pollen) return null;
    let worst = null;
    Object.entries(pollen).forEach(([key, value]) => {
      const level = pollenLevel(value);
      if (!level) return;
      if (!worst || level.rank > worst.level.rank) {
        worst = { key, value, level };
      }
    });
    if (!worst) return null;
    return {
      name: worst.key.replace('_pollen', '').replace(/^./, (c) => c.toUpperCase()),
      value: worst.value,
      level: worst.level,
    };
  }

  /* ------------------------------------------------------------
     Moon phase, computed from the mean synodic month. Accurate to
     within a few hours, which is plenty for a phase name and an
     illumination percentage.
     ------------------------------------------------------------ */

  const SYNODIC_MS = 29.530588853 * 86400000;
  const KNOWN_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);

  function moonPhase(when = new Date()) {
    const t = (when instanceof Date ? when : new Date(when)).getTime();
    let age = (t - KNOWN_NEW_MOON) % SYNODIC_MS;
    if (age < 0) age += SYNODIC_MS;
    const phase = age / SYNODIC_MS;                 // 0 = new, 0.5 = full
    const illumination = (1 - Math.cos(2 * Math.PI * phase)) / 2;

    const names = [
      ['New moon', '🌑'], ['Waxing crescent', '🌒'], ['First quarter', '🌓'],
      ['Waxing gibbous', '🌔'], ['Full moon', '🌕'], ['Waning gibbous', '🌖'],
      ['Last quarter', '🌗'], ['Waning crescent', '🌘'],
    ];
    // Each named phase is centred on its eighth of the cycle.
    const index = Math.floor((phase * 8) + 0.5) % 8;
    return {
      phase,
      ageDays: age / 86400000,
      illumination,
      name: names[index][0],
      icon: names[index][1],
    };
  }

  /* ------------------------------------------------------------
     Sun figures derived from the sunrise/sunset the forecast
     already gives us. Solar noon is their midpoint, which is exact;
     nothing here is estimated.
     ------------------------------------------------------------ */
  function sunSummary(sunriseISO, sunsetISO) {
    if (!sunriseISO || !sunsetISO) return null;
    const rise = new Date(sunriseISO);
    const set = new Date(sunsetISO);
    if (isNaN(rise) || isNaN(set)) return null;
    const daylightMinutes = (set - rise) / 60000;
    if (daylightMinutes <= 0) return null;
    return {
      sunrise: rise,
      sunset: set,
      daylightMinutes,
      solarNoon: new Date(rise.getTime() + (set - rise) / 2),
    };
  }

  return { fetchAirQuality, aqiCategory, pollenLevel, pollenSummary, moonPhase, sunSummary };
})();

window.WTWAir = WTWAir;
