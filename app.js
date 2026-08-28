/* ============================================================
   What the Wether V13 — app.js
   Search, weather (NWS primary + Open-Meteo companion), hourly
   outlook, alerts, radar wiring, favorites, settings, roasts,
   offline snapshot, and PWA registration.
   Every control has a real event handler.
   ============================================================ */

(() => {
  'use strict';

  const state = {
    location: null,
    weather: null,
    daily: [],
    hours: [],
    detail: {},
    source: null,
    alerts: [],
    air: null,
    nowcast: null,
    rainSeries: null,
    notifiedAlerts: [],
    offline: false,
    lastRoast: null,
    loading: false,
  };

  const $ = (id) => document.getElementById(id);

  /* ---------------- WMO weather codes ---------------- */

  const WMO = {
    0:  ['Clear sky', '☀️'],       1:  ['Mainly clear', '🌤️'],
    2:  ['Partly cloudy', '⛅'],   3:  ['Overcast', '☁️'],
    45: ['Fog', '🌫️'],            48: ['Icy fog', '🌫️'],
    51: ['Light drizzle', '🌦️'],  53: ['Drizzle', '🌦️'],
    55: ['Heavy drizzle', '🌧️'],  56: ['Freezing drizzle', '🌧️'],
    57: ['Freezing drizzle', '🌧️'],
    61: ['Light rain', '🌧️'],     63: ['Rain', '🌧️'],
    65: ['Heavy rain', '🌧️'],     66: ['Freezing rain', '🌧️'],
    67: ['Freezing rain', '🌧️'],
    71: ['Light snow', '🌨️'],     73: ['Snow', '🌨️'],
    75: ['Heavy snow', '❄️'],     77: ['Snow grains', '❄️'],
    80: ['Rain showers', '🌦️'],   81: ['Rain showers', '🌧️'],
    82: ['Violent showers', '⛈️'],
    85: ['Snow showers', '🌨️'],   86: ['Snow showers', '❄️'],
    95: ['Thunderstorm', '⛈️'],   96: ['Storm + hail', '⛈️'],
    99: ['Storm + hail', '⛈️'],
  };
  const describeCode = (code) => WMO[code] || ['Weather', '🌡️'];

  /* ---------------- Toasts ---------------- */

  // Screen readers get nothing from a silent canvas repaint, so the
  // headline conditions are announced when a location finishes loading.
  function announceLoad(message) {
    const el = $('srAnnouncer');
    if (!el) return;
    el.textContent = '';
    // Re-setting the text is what triggers the announcement.
    setTimeout(() => { el.textContent = message; }, 60);
  }

  let toastTimer = null;
  function toast(message, isError = false) {
    const el = $('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('error', isError);
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  async function getJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }


  /* ---------------- Open-Meteo ---------------- */

  async function fetchOpenMeteo(location) {
    const p = new URLSearchParams({
      latitude: String(location.lat),
      longitude: String(location.lon),
      current: ['temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'weather_code',
                'wind_speed_10m', 'wind_direction_10m', 'is_day', 'pressure_msl',
                'dew_point_2m'].join(','),
      hourly: ['temperature_2m', 'precipitation_probability', 'weather_code',
               'wind_speed_10m', 'visibility'].join(','),
      minutely_15: ['precipitation', 'precipitation_probability'].join(','),
      daily: ['weather_code', 'temperature_2m_max', 'temperature_2m_min',
              'precipitation_probability_max', 'sunrise', 'sunset', 'uv_index_max'].join(','),
      temperature_unit: WTW_CONFIG.weather.temperatureUnit,
      wind_speed_unit: WTW_CONFIG.weather.windSpeedUnit,
      timezone: 'auto',
      forecast_days: String(WTW_CONFIG.weather.forecastDays),
    });
    const data = await getJSON(`${WTW_CONFIG.api.forecast}?${p}`);

    const c = data.current || {};
    const d = data.daily || {};
    const h = data.hourly || {};

    const weather = {
      city: location.name,
      tempF: c.temperature_2m,
      feelsLikeF: c.apparent_temperature,
      humidity: c.relative_humidity_2m,
      windMph: c.wind_speed_10m,
      windDirDeg: c.wind_direction_10m,
      weatherCode: c.weather_code,
      isDay: c.is_day === 1,
      precipProb: Array.isArray(d.precipitation_probability_max) ? d.precipitation_probability_max[0] : null,
      highF: Array.isArray(d.temperature_2m_max) ? d.temperature_2m_max[0] : null,
      lowF: Array.isArray(d.temperature_2m_min) ? d.temperature_2m_min[0] : null,
    };

    const daily = (d.time || []).map((iso, i) => ({
      dateISO: iso,
      code: d.weather_code ? d.weather_code[i] : 0,
      highF: d.temperature_2m_max ? d.temperature_2m_max[i] : null,
      lowF: d.temperature_2m_min ? d.temperature_2m_min[i] : null,
      precipProb: d.precipitation_probability_max ? d.precipitation_probability_max[i] : null,
    }));

    // Visibility is hourly-only in Open-Meteo; take the nearest hour.
    let visibilityMi = null;
    if (Array.isArray(h.visibility) && h.visibility.length) {
      const metres = h.visibility[0];
      if (metres != null) visibilityMi = metres * 0.000621371;
    }

    const detail = {
      sunrise: Array.isArray(d.sunrise) ? d.sunrise[0] : null,
      sunset: Array.isArray(d.sunset) ? d.sunset[0] : null,
      uvIndex: Array.isArray(d.uv_index_max) ? d.uv_index_max[0] : null,
      dewPointF: c.dew_point_2m ?? null,
      pressureInHg: c.pressure_msl != null ? c.pressure_msl * 0.0295300 : null,
      visibilityMi,
    };

    const hours = WTWHourly.fromOpenMeteo(data, WTW_CONFIG.weather.forecastHours);
    return { weather, daily, hours, detail, raw: data };
  }

  /* ------------------------------------------------------------
     Source strategy.
     Both services are free and key-less, so the app asks them in
     parallel: NWS is authoritative for US observations, forecasts
     and alerts, while Open-Meteo covers the rest of the world and
     fills the fields NWS does not publish (UV index, sunrise and
     sunset) or cannot supply late in the day (today's high).
     If NWS returns nothing usable, Open-Meteo carries the whole app.
     ------------------------------------------------------------ */

  async function fetchNWSBundle(location) {
    const point = await NWS.getPoint(location.lat, location.lon);
    if (!point) return null;
    const [obs, daily, hourly] = await Promise.all([
      NWS.getCurrentObservation(point, location.lat, location.lon),
      NWS.getForecast(point),
      NWS.getHourly(point),
    ]);
    if (!obs || !daily || !daily.length) return null;
    return { point, obs, daily, hourly };
  }

  async function fetchWeatherBest(location) {
    // Kick both off together; neither blocks the other.
    const omPromise = fetchOpenMeteo(location).catch((err) => {
      console.warn('[app] Open-Meteo unavailable', err);
      return null;
    });
    const nwsPromise = fetchNWSBundle(location).catch((err) => {
      console.warn('[app] NWS unavailable', err);
      return null;
    });
    const [nws, om] = await Promise.all([nwsPromise, omPromise]);

    if (nws) {
      const daily = nws.daily;
      // Late in the day NWS has no daytime period left, so today's
      // high is missing; Open-Meteo reports the full calendar day.
      if (om && om.daily && om.daily[0]) {
        if (daily[0].highF === null) daily[0].highF = om.daily[0].highF;
        if (daily[0].lowF === null) daily[0].lowF = om.daily[0].lowF;
      }
      const today = daily[0] || {};
      const o = nws.obs;

      const hours = nws.hourly
        ? WTWHourly.fromNWS(nws.hourly, WTW_CONFIG.weather.forecastHours, NWS.textToCode)
        : (om ? om.hours : []);

      return {
        source: 'nws',
        weather: {
          city: location.name,
          tempF: o.tempF,
          feelsLikeF: o.feelsLikeF,
          humidity: o.humidity,
          windMph: o.windMph,
          windDirDeg: o.windDirDeg,
          weatherCode: NWS.textToCode(o.description),
          conditionText: o.description,
          station: o.station,
          stationKm: o.distanceKm,
          observedAt: o.observedAt,
          precipProb: today.precipProb,
          highF: today.highF,
          lowF: today.lowF,
        },
        daily,
        hours,
        raw: om ? om.raw : null,
        nwsPoint: nws.point,
        detail: {
          // Sun times and UV come from Open-Meteo — NWS publishes neither.
          sunrise: om && om.detail ? om.detail.sunrise : null,
          sunset: om && om.detail ? om.detail.sunset : null,
          uvIndex: om && om.detail ? om.detail.uvIndex : null,
          dewPointF: o.dewPointF ?? (om && om.detail ? om.detail.dewPointF : null),
          pressureInHg: o.pressureInHg ?? (om && om.detail ? om.detail.pressureInHg : null),
          visibilityMi: o.visibilityMi ?? (om && om.detail ? om.detail.visibilityMi : null),
        },
      };
    }

    if (om) return { source: 'open-meteo', nwsPoint: null, ...om };
    throw new Error('No weather source available');
  }

  /* ---------------- Rendering ---------------- */

  // All display formatting goes through units.js.
  const U = () => window.WTWUnits;
  const fmtTemp = (v) => U().temp(v);
  const clock = (d) => U().time(d);

  function renderCurrent() {
    const w = state.weather;
    if (!w) return;
    const [label, icon] = describeCode(w.weatherCode);

    $('wxCity').textContent = w.city;
    $('wxIcon').textContent = icon;
    $('wxTemp').textContent = fmtTemp(w.tempF);
    $('wxCondition').textContent = w.conditionText || label;
    $('wxFeels').textContent = fmtTemp(w.feelsLikeF);
    $('wxHumidity').textContent = U().percent(w.humidity);
    $('wxWind').textContent = U().speed(w.windMph);
    $('wxHiLo').textContent = `${fmtTemp(w.highF)} / ${fmtTemp(w.lowF)}`;
    $('wxRain').textContent = U().percent(w.precipProb);

    let line = state.offline ? 'Offline · showing last saved forecast · ' : `Updated ${clock(new Date())} · `;
    if (state.source === 'nws') {
      line += `National Weather Service${w.station ? ' · ' + w.station : ''}`;
      if (w.stationKm != null) line += ` (${U().distanceFromKm(w.stationKm)} away)`;
      if (w.observedAt) line += ` · observed ${clock(w.observedAt)}`;
    } else {
      line += 'Open-Meteo';
    }
    $('wxUpdated').textContent = line;

    renderDetail();
    $('currentCard').classList.remove('empty');
    $('welcomePanel').hidden = true;
    $('weatherPanels').hidden = false;
    $('offlineBanner').hidden = !state.offline;
  }

  function renderDetail() {
    const d = state.detail || {};
    const set = (id, value) => { const el = $(id); if (el) el.textContent = value; };
    set('wxSunrise', d.sunrise ? clock(d.sunrise) : '--');
    set('wxSunset', d.sunset ? clock(d.sunset) : '--');
    set('wxUv', d.uvIndex == null ? '--' : String(Math.round(d.uvIndex)));
    set('wxDew', U().temp(d.dewPointF));
    set('wxPressure', U().pressure(d.pressureInHg));
    set('wxVisibility', U().distance(d.visibilityMi));
  }

  function renderForecast() {
    const wrap = $('forecastRow');
    if (!wrap) return;
    wrap.innerHTML = '';
    state.daily.forEach((day, i) => {
      const [label, icon] = describeCode(day.code);
      const date = new Date(day.dateISO + 'T12:00:00');
      const dayName = i === 0 ? 'Today' : date.toLocaleDateString([], { weekday: 'short' });

      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'forecast-card';
      card.title = `${label} — tap for a roast`;
      card.innerHTML = `
        <div class="fc-day">${dayName}</div>
        <div class="fc-icon">${icon}</div>
        <div class="fc-temps"><span class="fc-hi">${fmtTemp(day.highF)}</span><span class="fc-lo">${fmtTemp(day.lowF)}</span></div>
        <div class="fc-rain">💧 ${U().percent(day.precipProb)}</div>
      `;
      card.addEventListener('click', () => roastDay(day, dayName));
      wrap.appendChild(card);
    });
  }

  // Restate the visible roast in the new units. The history keeps its
  // original wording — it is a log of what was said at the time — so
  // this deliberately does not add a new entry.
  function restateRoast() {
    if (!state.weather || !state.lastRoast) return;
    const line = LocalAI.generate(state.weather);
    const el = $('roastText');
    if (el) el.textContent = line;
    state.lastRoast = Object.assign({}, state.lastRoast, { text: line });
  }

  // A unit or clock change must repaint every surface at once.
  function rerenderAll() {
    if (state.weather) {
      renderCurrent();
      renderForecast();
      renderAir();
      renderNowcast();
      restateRoast();
    }
    WTWHourly.redraw();
    WTWTempChart.redraw();
    WTWRadar.onUnitsChange();
    renderCompare();
    renderRoastLog();
  }

  function renderUsernameEverywhere() {
    const { username } = WTWStorage.getSettings();
    document.querySelectorAll('[data-username]').forEach((el) => { el.textContent = username; });
    const input = $('usernameInput');
    if (input && document.activeElement !== input) input.value = username;
  }

  /* ---------------- Alerts ---------------- */

  function severityClass(sev) {
    const s = String(sev).toLowerCase();
    if (s === 'extreme' || s === 'severe') return 'alert-severe';
    if (s === 'moderate') return 'alert-moderate';
    return 'alert-minor';
  }

  function renderAlerts() {
    const wrap = $('alertsPanel');
    if (!wrap) return;
    wrap.innerHTML = '';
    if (!state.alerts.length) { wrap.hidden = true; return; }
    wrap.hidden = false;
    state.alerts.slice(0, 4).forEach((a) => {
      const div = document.createElement('div');
      div.className = `alert-item ${severityClass(a.severity)}`;
      const title = document.createElement('div');
      title.className = 'alert-title';
      title.textContent = `⚠️ ${a.event}`;
      const body = document.createElement('div');
      body.className = 'alert-body';
      body.textContent = a.headline || a.areaDesc || '';
      div.appendChild(title);
      div.appendChild(body);
      wrap.appendChild(div);
    });
  }

  async function loadAlerts(location) {
    try {
      state.alerts = await NWS.getAlerts(location.lat, location.lon);
    } catch (_) {
      state.alerts = [];
    }
    renderAlerts();
    WTWRadar.setAlerts(state.alerts);
    notifyNewAlerts();
  }

  /* ------------------------------------------------------------
     Precipitation comes from the best source available for this
     point, not necessarily the same service as the rest of the
     forecast — see rain.js. It is fetched separately so a slow or
     missing rain source never delays the main render.
     ------------------------------------------------------------ */
  async function loadRain(location, result) {
    try {
      const series = await WTWRain.getSeries({
        lat: location.lat,
        lon: location.lon,
        nwsPoint: result.nwsPoint || null,
        openMeteoRaw: result.raw || null,
      });
      state.rainSeries = series;
      state.nowcast = WTWPrecip.nowcast(series);
    } catch (err) {
      console.warn('[app] rain source failed', err);
      state.nowcast = null;
    }
    renderNowcast();
    saveSnapshot();
  }

  async function loadAir(location) {
    try {
      state.air = await WTWAir.fetchAirQuality(location);
    } catch (err) {
      console.warn('[app] air quality failed', err);
      state.air = null;
    }
    renderAir();
  }

  /* ------------------------------------------------------------
     Browser notifications for severe alerts.
     Opt-in, deduplicated by event + expiry so a refresh doesn't
     re-notify, and only fires while the page is running — there is
     no push server and the app needs no account.
     ------------------------------------------------------------ */

  function alertKey(a) {
    return `${a.event}|${a.expires || ''}|${a.areaDesc || ''}`;
  }

  function notifyNewAlerts() {
    if (!WTWStorage.getSettings().alertNotifications) return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

    const severe = state.alerts.filter((a) =>
      ['extreme', 'severe'].includes(String(a.severity).toLowerCase()));
    const seen = new Set(state.notifiedAlerts);

    severe.forEach((a) => {
      const key = alertKey(a);
      if (seen.has(key)) return;
      seen.add(key);
      try {
        new Notification(`⚠️ ${a.event}`, {
          body: a.headline || a.areaDesc || 'Severe weather alert in your area.',
          icon: 'icons/icon-192.png',
          tag: key,
        });
      } catch (err) {
        console.warn('[app] notification failed', err);
      }
    });
    state.notifiedAlerts = Array.from(seen).slice(-40);
  }

  async function requestNotificationPermission() {
    if (typeof Notification === 'undefined') {
      toast('This browser does not support notifications.', true);
      return false;
    }
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') {
      toast('Notifications are blocked in your browser settings.', true);
      return false;
    }
    try {
      const result = await Notification.requestPermission();
      if (result !== 'granted') {
        toast('Notification permission was not granted.', true);
        return false;
      }
      return true;
    } catch (err) {
      console.warn('[app] notification permission failed', err);
      return false;
    }
  }

  /* ---------------- Air & sky ---------------- */

  function renderAir() {
    const card = $('airCard');
    if (!card) return;
    const air = state.air;
    const d = state.detail || {};

    // AQI
    const badge = $('aqiBadge');
    const cat = WTWAir.aqiCategory(air ? air.aqi : null);
    badge.textContent = air && air.aqi != null ? Math.round(air.aqi) : '--';
    badge.className = `aqi-badge ${cat.className}`;
    $('aqiLabel').textContent = cat.label;
    $('aqiAdvice').textContent = air && air.aqi != null ? cat.advice : 'Air quality unavailable for this location.';

    const setVal = (id, value, unit) => {
      const el = $(id);
      if (el) el.textContent = (value === null || value === undefined)
        ? '--' : `${Math.round(value)}${unit || ''}`;
    };
    setVal('aqPm25', air ? air.pm25 : null, ' µg/m³');
    setVal('aqPm10', air ? air.pm10 : null, ' µg/m³');
    setVal('aqOzone', air ? air.ozone : null, ' µg/m³');
    setVal('aqNo2', air ? air.no2 : null, ' µg/m³');

    // Pollen — only shown where the upstream model publishes it.
    const pollenRow = $('pollenRow');
    const summary = air ? WTWAir.pollenSummary(air.pollen) : null;
    if (summary) {
      pollenRow.hidden = false;
      $('pollenValue').textContent = `${summary.level.label} · ${summary.name}`;
    } else {
      pollenRow.hidden = true;
    }

    // Sun
    const sun = WTWAir.sunSummary(d.sunrise, d.sunset);
    $('skyDaylight').textContent = sun ? U().duration(sun.daylightMinutes) : '--';
    $('skySolarNoon').textContent = sun ? U().time(sun.solarNoon) : '--';

    // Moon
    const moon = WTWAir.moonPhase(new Date());
    $('moonIcon').textContent = moon.icon;
    $('moonName').textContent = moon.name;
    $('moonIllum').textContent = `${Math.round(moon.illumination * 100)}% lit`;

    card.hidden = false;
  }

  /* ---------------- Temperature trend ---------------- */

  function openTempChart(open) {
    const modal = $('tempModal');
    const overlay = $('tempModalOverlay');
    if (!modal) return;
    modal.hidden = !open;
    if (overlay) overlay.hidden = !open;
    document.body.classList.toggle('modal-open', open);
    if (open) {
      WTWTempChart.setDays(state.daily);
      WTWTempChart.resize();
      const w = state.weather || {};
      $('tempModalSummary').textContent =
        `${w.city || ''} · today ${U().temp(w.highF)} / ${U().temp(w.lowF)}`;
      $('tempModalClose').focus();
    }
  }

  /* ---------------- Rain nowcast ---------------- */

  function renderNowcast() {
    const wrap = $('nowcastPanel');
    if (!wrap) return;
    const n = state.nowcast;
    if (!n || !n.text) { wrap.hidden = true; return; }
    wrap.hidden = false;
    $('nowcastText').textContent = n.text;
    $('nowcastIcon').textContent = n.rainingNow ? '🌧️' : (n.startsIn !== null ? '⏳' : '✅');
    const resolution = n.precise ? '15-minute data' : 'hourly data';
    $('nowcastPrecision').textContent = n.sourceLabel
      ? `${n.sourceLabel} · ${resolution}`
      : resolution;
    drawNowcastStrip(n);
  }

  // A compact bar strip of the next two hours. Width comes from CSS
  // (100% of the card) so it tracks the viewport; only the backing
  // store is set here, and a resize redraws it.
  function drawNowcastStrip(n) {
    const canvas = $('nowcastStrip');
    if (!canvas || !n || !n.slots.length) return;
    const width = canvas.clientWidth || canvas.parentElement.clientWidth;
    if (!width) return;
    const height = 34;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.height = height + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const css = (name, fallback) =>
      getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
    const accent2 = css('--accent-2', '#00c8ff');
    const dim = css('--text-dim', '#8ba3b8');

    const slots = n.slots;
    const barW = Math.max(2, width / slots.length - 1.5);
    slots.forEach((slot, i) => {
      const x = (i / slots.length) * width;
      const wet = WTWPrecip.isWet(slot);
      const intensity = slot.mm !== null
        ? Math.min(1, slot.mm / 2.5)
        : Math.min(1, (slot.prob || 0) / 100);
      const h = Math.max(2, intensity * (height - 12));
      ctx.fillStyle = wet ? accent2 : dim;
      ctx.globalAlpha = wet ? 0.85 : 0.22;
      ctx.fillRect(x, height - 10 - h, barW, h);
    });
    ctx.globalAlpha = 1;

    // "now" and end-of-window ticks
    ctx.fillStyle = dim;
    ctx.font = '9px "Courier New", monospace';
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left';
    ctx.fillText('now', 0, height);
    ctx.textAlign = 'right';
    ctx.fillText(U().duration(n.lookahead), width, height);
  }

  /* ---------------- Compare locations ---------------- */

  async function renderCompare({ refresh = false } = {}) {
    const panel = $('comparePanel');
    const grid = $('compareGrid');
    const empty = $('compareEmpty');
    if (!panel || !grid) return;

    const favs = WTWStorage.getFavorites();
    if (!favs.length) {
      grid.innerHTML = '';
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    if (refresh || !WTWCompare.getRows().length) {
      grid.innerHTML = '<p class="compare-loading">Loading your locations…</p>';
      try {
        await WTWCompare.load(favs);
      } catch (err) {
        console.warn('[app] compare load failed', err);
      }
    }

    const rows = WTWCompare.sorted();
    grid.innerHTML = '';
    rows.forEach((row) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'compare-tile' + (row.ok ? '' : ' compare-failed');
      if (row.ok) {
        const [label, icon] = describeCode(row.code);
        btn.innerHTML = `
          <div class="compare-name">${row.location.name}</div>
          <div class="compare-main"><span class="compare-icon">${icon}</span>
            <span class="compare-temp">${U().temp(row.tempF)}</span></div>
          <div class="compare-cond">${label}</div>
          <div class="compare-stats">
            <span>${U().temp(row.highF)} / ${U().temp(row.lowF)}</span>
            <span>💧 ${U().percent(row.precipProb)}</span>
          </div>`;
        btn.title = `Load ${row.location.name}`;
      } else {
        btn.innerHTML = `
          <div class="compare-name">${row.location.name}</div>
          <div class="compare-cond">Unavailable</div>`;
      }
      btn.addEventListener('click', () => loadLocation(row.location));
      grid.appendChild(btn);
    });
  }

  /* ---------------- Roasts (Local AI 3.0) ---------------- */

  function showRoast(text, context) {
    const el = $('roastText');
    el.classList.remove('pop');
    void el.offsetWidth;
    el.textContent = text;
    el.classList.add('pop');

    const p = WTWStorage.getSettings().personality;
    $('roastPersonality').textContent = LocalAI.label(p) + ' mode';
    $('roastContext').textContent = context || 'Right now';

    state.lastRoast = { text, context, at: Date.now() };
    WTWStorage.addRoastLog({
      text, context: context || 'Right now',
      personality: p, city: state.location ? state.location.name : '',
      at: Date.now(),
    });
    renderRoastLog();
  }

  function doRoast() {
    if (!state.weather) {
      $('roastText').textContent = "Load some weather first — I can't roast a blank sky.";
      return;
    }
    showRoast(LocalAI.generate(state.weather), 'Right now');
  }

  function roastDay(day, dayName) {
    const line = LocalAI.generateForDay(day, {
      city: state.location ? state.location.name : '',
      windMph: state.weather ? state.weather.windMph : 5,
    });
    showRoast(line, dayName === 'Today' ? 'Today' : dayName);
    $('roastText').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function renderRoastLog() {
    const list = $('roastLogList');
    if (!list) return;
    const log = WTWStorage.getRoastLog();
    list.innerHTML = '';
    if (!log.length) {
      const li = document.createElement('li');
      li.className = 'roast-log-empty';
      li.textContent = 'No roasts yet.';
      list.appendChild(li);
      return;
    }
    log.slice(0, 20).forEach((entry) => {
      const li = document.createElement('li');
      li.className = 'roast-log-item';
      const meta = document.createElement('div');
      meta.className = 'roast-log-meta';
      meta.textContent = `${LocalAI.label(entry.personality)} · ${entry.context} · ` +
        new Date(entry.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      const body = document.createElement('div');
      body.textContent = entry.text;
      li.appendChild(meta);
      li.appendChild(body);
      list.appendChild(li);
    });
  }

  async function shareRoast() {
    if (!state.lastRoast) { toast('Get a roast first, then share it.', true); return; }
    const w = state.weather || {};
    const [label] = describeCode(w.weatherCode);
    const result = await WTWShare.shareRoast({
      roast: state.lastRoast.text,
      city: w.city || '',
      tempF: w.tempF,
      condition: w.conditionText || label,
      username: WTWStorage.getSettings().username,
      personality: WTWStorage.getSettings().personality,
    });
    if (result === 'shared') toast('Shared 🔥');
    else if (result === 'downloaded') toast('Roast card saved as a PNG 📸');
    else toast('Could not create the roast card.', true);
  }

  /* ---------------- Offline snapshot ---------------- */

  function saveSnapshot() {
    if (!state.location || !state.weather) return;
    WTWStorage.saveSnapshot({
      location: state.location,
      source: state.source,
      weather: Object.assign({}, state.weather, {
        observedAt: state.weather.observedAt ? state.weather.observedAt.toISOString() : null,
      }),
      daily: state.daily,
      hours: state.hours.map((h) => Object.assign({}, h, { time: h.time.toISOString() })),
      detail: state.detail,
      alerts: state.alerts,
      air: state.air,
      nowcast: state.nowcast ? {
        text: state.nowcast.text,
        sourceLabel: state.nowcast.sourceLabel,
        precise: state.nowcast.precise,
      } : null,
      savedAt: Date.now(),
    });
  }

  function restoreSnapshot() {
    const snap = WTWStorage.getSnapshot();
    if (!snap || !snap.weather) return false;
    state.location = snap.location;
    state.source = snap.source;
    state.weather = Object.assign({}, snap.weather, {
      observedAt: snap.weather.observedAt ? new Date(snap.weather.observedAt) : null,
    });
    state.daily = snap.daily || [];
    state.hours = (snap.hours || []).map((h) => Object.assign({}, h, { time: new Date(h.time) }));
    state.detail = snap.detail || {};
    state.alerts = snap.alerts || [];
    state.air = snap.air || null;
    state.offline = true;

    renderCurrent();
    renderForecast();
    renderAlerts();
    renderAir();
    WTWHourly.setHours(state.hours);
    if (state.location) {
      WTWRadar.setLocation(state.location.name, state.weather, {
        lat: state.location.lat, lon: state.location.lon,
      });
    }
    updateSaveButton();
    return true;
  }

  /* ---------------- Load pipeline ---------------- */

  function setLoading(on) {
    document.body.classList.toggle('loading', on);
    const btn = $('searchBtn');
    if (btn) btn.disabled = on;
  }

  async function loadLocation(location, { announce: announceToast = true } = {}) {
    if (state.loading) return;
    state.loading = true;
    setLoading(true);
    try {
      const result = await fetchWeatherBest(location);
      state.location = location;
      state.source = result.source;
      state.weather = result.weather;
      state.daily = result.daily;
      state.hours = result.hours || [];
      state.detail = result.detail || {};
      state.offline = false;

      renderCurrent();
      renderForecast();
      WTWHourly.setHours(state.hours);
      WTWRadar.setLocation(location.name, result.weather, {
        lat: location.lat, lon: location.lon,
      });
      loadRain(location, result);

      WTWStorage.saveLastLocation(location);
      updateSaveButton();
      loadAlerts(location).then(saveSnapshot);
      loadAir(location);
      renderCompare({ refresh: true });
      saveSnapshot();

      if (WTWStorage.getSettings().autoRoast) doRoast();

      const w = result.weather;
      const [conditionLabel] = describeCode(w.weatherCode);
      announceLoad(`${location.name}. ${w.conditionText || conditionLabel}. ` +
        `${U().temp(w.tempF, { withUnit: true })}, feels like ${U().temp(w.feelsLikeF, { withUnit: true })}. ` +
        `High ${U().temp(w.highF)}, low ${U().temp(w.lowF)}.`);
      if (announceToast) toast(`Weather loaded for ${location.name}`);
    } catch (err) {
      console.error('[app] weather load failed', err);
      if (restoreSnapshot()) {
        toast('Offline — showing the last saved forecast.', true);
      } else {
        toast('Could not load weather. Check your connection and try again.', true);
      }
    } finally {
      state.loading = false;
      setLoading(false);
    }
  }

  /* ------------------------------------------------------------
     Search shows the candidates rather than silently taking the
     first hit — there are a lot of Springfields. A single exact
     match (a ZIP) loads straight away.
     ------------------------------------------------------------ */
  async function handleSearch() {
    const input = $('searchInput');
    const q = input.value.trim();
    if (!q) { toast('Type a city, place, or US ZIP code first.', true); input.focus(); return; }
    setLoading(true);
    try {
      const results = await WTWSearch.lookup(q);
      if (!results.length) {
        toast(`No results for "${q}". Try another spelling.`, true);
        WTWSearch.close();
        return;
      }
      if (results.length === 1) {
        WTWSearch.pickDirect(results[0]);
        return;
      }
      WTWSearch.render(results);
    } catch (err) {
      console.error('[app] search failed', err);
      toast('Search failed. Check your connection.', true);
    } finally {
      setLoading(false);
    }
  }

  function handleGeolocate() {
    if (!navigator.geolocation) { toast('Geolocation is not supported by this browser.', true); return; }
    toast('Finding your location…');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        await loadLocation({ name: 'My Location', lat: pos.coords.latitude, lon: pos.coords.longitude });
      },
      (err) => {
        console.warn('[app] geolocation error', err);
        toast('Location permission denied or unavailable.', true);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  }

  /* ---------------- Favorites ---------------- */

  const favKey = (loc) => `${loc.lat.toFixed(3)},${loc.lon.toFixed(3)}`;
  const isFavorite = (loc) => !!loc && WTWStorage.getFavorites().some((f) => favKey(f) === favKey(loc));

  function renderFavorites() {
    const list = $('favoritesList');
    const empty = $('favoritesEmpty');
    if (!list) return;
    const favs = WTWStorage.getFavorites();
    list.innerHTML = '';
    if (empty) empty.hidden = favs.length > 0;

    favs.forEach((fav) => {
      const li = document.createElement('li');
      li.className = 'fav-item';
      const loadBtn = document.createElement('button');
      loadBtn.type = 'button';
      loadBtn.className = 'fav-load';
      loadBtn.textContent = fav.name;
      loadBtn.addEventListener('click', () => loadLocation(fav));

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'fav-remove';
      removeBtn.textContent = '✕';
      removeBtn.setAttribute('aria-label', `Remove ${fav.name} from favorites`);
      removeBtn.addEventListener('click', () => {
        WTWStorage.saveFavorites(WTWStorage.getFavorites().filter((f) => favKey(f) !== favKey(fav)));
        renderFavorites();
        updateSaveButton();
        renderCompare({ refresh: true });
        toast(`Removed ${fav.name}`);
      });

      li.appendChild(loadBtn);
      li.appendChild(removeBtn);
      list.appendChild(li);
    });
  }

  function handleSaveFavorite() {
    if (!state.location) { toast('Load a location first, then save it.', true); return; }
    const favs = WTWStorage.getFavorites();
    if (isFavorite(state.location)) {
      WTWStorage.saveFavorites(favs.filter((f) => favKey(f) !== favKey(state.location)));
      toast(`Removed ${state.location.name} from favorites`);
    } else {
      favs.push(state.location);
      WTWStorage.saveFavorites(favs);
      toast(`Saved ${state.location.name} ⭐`);
    }
    renderFavorites();
    updateSaveButton();
    renderCompare({ refresh: true });
  }

  function updateSaveButton() {
    const btn = $('saveFavBtn');
    if (!btn) return;
    const saved = isFavorite(state.location);
    btn.textContent = saved ? '★ Saved' : '☆ Save location';
    btn.classList.toggle('saved', saved);
  }

  /* ---------------- Settings ---------------- */

  function openSettings(open) {
    const panel = $('settingsPanel');
    const overlay = $('settingsOverlay');
    if (!panel) return;
    panel.classList.toggle('open', open);
    if (overlay) overlay.hidden = !open;
    document.body.classList.toggle('settings-open', open);
  }

  function initSettingsUI() {
    const s = WTWStorage.getSettings();

    const pSel = $('personalitySelect');
    pSel.innerHTML = '';
    WTW_CONFIG.personalities.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = LocalAI.label(p);
      pSel.appendChild(opt);
    });
    pSel.value = s.personality;
    pSel.addEventListener('change', () => {
      WTWStorage.saveSettings({ personality: pSel.value });
      toast(`Personality set to ${pSel.value}`);
      if (state.weather && WTWStorage.getSettings().autoRoast) doRoast();
    });

    const autoRoast = $('autoRoastToggle');
    autoRoast.checked = !!s.autoRoast;
    autoRoast.addEventListener('change', () => {
      WTWStorage.saveSettings({ autoRoast: autoRoast.checked });
      toast(autoRoast.checked ? 'Auto-roast ON 🔥' : 'Auto-roast off');
    });

    // Units
    const uSel = $('unitsSelect');
    uSel.innerHTML = '';
    (WTW_CONFIG.unitSystems || []).forEach((u) => {
      const opt = document.createElement('option');
      opt.value = u.id;
      opt.textContent = u.label;
      uSel.appendChild(opt);
    });
    uSel.value = s.units;
    uSel.addEventListener('change', () => {
      WTWStorage.saveSettings({ units: uSel.value });
      rerenderAll();
      toast(`Units: ${uSel.options[uSel.selectedIndex].text}`);
    });

    // Clock
    const cSel = $('clockSelect');
    cSel.value = String(s.clock);
    cSel.addEventListener('change', () => {
      WTWStorage.saveSettings({ clock: cSel.value });
      rerenderAll();
      toast(cSel.value === '24' ? '24-hour clock' : '12-hour clock');
    });

    // Severe-alert notifications
    const notify = $('alertNotifyToggle');
    notify.checked = !!s.alertNotifications;
    notify.addEventListener('change', async () => {
      if (notify.checked) {
        const granted = await requestNotificationPermission();
        if (!granted) { notify.checked = false; return; }
        WTWStorage.saveSettings({ alertNotifications: true });
        toast('Severe alert notifications on 🔔');
        notifyNewAlerts();
      } else {
        WTWStorage.saveSettings({ alertNotifications: false });
        toast('Alert notifications off');
      }
    });

    const tSel = $('themeSelect');
    WTWThemes.populateSelect(tSel);
    tSel.addEventListener('change', () => {
      WTWThemes.setTheme(tSel.value);
      WTWRadar.onThemeChange();
      WTWHourly.redraw();
      toast(`Theme: ${tSel.options[tSel.selectedIndex].text}`);
    });

    const saveUsername = () => {
      const input = $('usernameInput');
      const name = input.value.trim();
      if (!name) {
        toast("Username can't be empty.", true);
        input.value = WTWStorage.getSettings().username;
        return;
      }
      if (name.length > 24) { toast('Keep the username under 24 characters.', true); return; }
      WTWStorage.saveSettings({ username: name });
      WTWStorage.remove('usernameFromGoogle');   // chosen by hand now
      renderUsernameEverywhere();
      toast(`Hello, ${name}! 👋`);
    };
    $('usernameSaveBtn').addEventListener('click', saveUsername);
    $('usernameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveUsername(); });

    // Shows what is actually running, and offers a way out of a stale
    // cached copy without needing devtools or a hard-refresh shortcut.
    const readout = $('versionReadout');
    if (readout) readout.textContent = WTW_CONFIG.app.version;

    $('forceUpdateBtn').addEventListener('click', async () => {
      toast('Clearing cache and reloading…');
      try {
        if (window.caches && caches.keys) {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
        if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map((r) => r.unregister()));
        }
      } catch (err) {
        console.warn('[pwa] force update cleanup failed', err);
      }
      // Cache-busting query so even an HTTP-cached document is bypassed.
      const url = new URL(window.location.href);
      url.searchParams.set('v', Date.now().toString(36));
      window.location.replace(url.toString());
    });

    $('clearRoastLogBtn').addEventListener('click', () => {
      WTWStorage.clearRoastLog();
      renderRoastLog();
      toast('Roast history cleared');
    });

    $('settingsBtn').addEventListener('click', () => openSettings(true));
    $('settingsCloseBtn').addEventListener('click', () => openSettings(false));
    $('settingsOverlay').addEventListener('click', () => openSettings(false));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') openSettings(false); });
  }

  /* ---------------- Account ---------------- */

  let googleButtonRendered = false;

  function renderAccount(profile) {
    const signedIn = $('accountSignedIn');
    const signedOut = $('accountSignedOut');
    const avatar = $('brandAvatar');
    if (!signedIn || !signedOut) return;

    signedIn.hidden = !profile;
    signedOut.hidden = !!profile;

    if (profile) {
      $('accountName').textContent = profile.name || '';
      $('accountEmail').textContent = profile.email || '';
      const pic = $('accountAvatar');
      if (pic) {
        if (profile.picture) { pic.src = profile.picture; pic.hidden = false; }
        else { pic.hidden = true; }
      }
      if (avatar && profile.picture) {
        avatar.src = profile.picture;
        avatar.hidden = false;
      }
    } else {
      if (avatar) {
        avatar.hidden = true;
        avatar.removeAttribute('src');
      }
      renderGuestChoice();
    }
    renderAccountHint(profile);
  }

  /* ------------------------------------------------------------
     Guest is automatic: not signed in simply is a guest, from the
     first load, with nothing to click and nothing stored. The panel
     states that rather than asking for a decision.
     ------------------------------------------------------------ */
  function renderGuestChoice() {
    const note = $('guestNote');
    if (note) {
      note.textContent = WTWAuth.canSignIn()
        ? 'No account needed \u2014 everything works. Sign in only if you want your name and picture.'
        : 'No account needed \u2014 everything works.';
    }
    showSignIn(false);
  }

  /* ------------------------------------------------------------
     Log out. One button, present whether or not anyone is signed in,
     and it always does something real: it clears the Google session
     and the name and picture that came with it. A username typed in
     by hand is left alone — it was never part of any account.
     ------------------------------------------------------------ */
  function logOut() {
    const wasSignedIn = WTWAuth.isSignedIn();
    const adopted = WTWStorage.get('usernameFromGoogle', false) === true;

    if (wasSignedIn) WTWAuth.signOut();

    if (adopted) {
      WTWStorage.remove('usernameFromGoogle');
      WTWStorage.saveSettings({ username: WTW_CONFIG.defaults.username });
      renderUsernameEverywhere();
      restateRoast();
    }

    if (wasSignedIn) toast('Logged out. You\u2019re a guest again.');
    else toast('You\u2019re already a guest \u2014 nothing to log out of.');
  }

  // Google's script is only fetched when somebody actually asks to sign
  // in, so a guest never touches Google at all.
  function showSignIn(open) {
    const host = $('googleButtonHost');
    const openBtn = $('showSignInBtn');
    const cancelBtn = $('cancelSignInBtn');
    if (!host || !openBtn || !cancelBtn) return;

    const offered = WTWAuth.canSignIn();
    const row = $('accountSignin');
    if (row) row.hidden = !offered;
    openBtn.hidden = !offered || open;
    cancelBtn.hidden = !offered || !open;
    host.hidden = !offered || !open;

    if (offered && open && !googleButtonRendered) {
      googleButtonRendered = true;
      WTWAuth.renderButton(host);
    }
  }

  function renderAccountHint(profile) {
    const hint = $('accountHint');
    if (!hint) return;
    if (profile) {
      hint.textContent = 'Signed in with Google. Your name and picture are kept ' +
        'on this device only \u2014 nothing is synced anywhere.';
      return;
    }
    const reason = WTWAuth.unavailableReason();
    if (reason === 'unconfigured') {
      hint.textContent = 'Sign-in is not set up on this build, so everyone is a ' +
        'guest \u2014 which is the entire app, nothing held back.';
    } else if (reason === 'unsupported') {
      hint.textContent = 'Google sign-in needs a web address, so the desktop app ' +
        'is guest only. Nothing is missing.';
    } else {
      hint.textContent = 'Guest is always enough. Signing in only sets your name ' +
        'and picture on this device \u2014 nothing is synced, and nothing is sent ' +
        "anywhere but Google's own sign-in.";
    }
  }

  // Adopt the Google first name only while the username is still the
  // stock default — never overwrite one the user chose themselves.
  function applyProfileToUsername(profile) {
    if (!profile || !profile.givenName) return;
    const current = WTWStorage.getSettings().username;
    if (current !== WTW_CONFIG.defaults.username) return;
    WTWStorage.saveSettings({ username: profile.givenName.slice(0, 24) });
    // Remembered so logging out can hand the name back, and so a name
    // typed in later is recognised as the user's own.
    WTWStorage.set('usernameFromGoogle', true);
    renderUsernameEverywhere();
  }

  function onAuthChange(profile) {
    // Signing out lands back on the guest panel, which always offers a
    // way in again, so there is no dead end either way.
    renderAccount(profile);
    if (profile) {
      applyProfileToUsername(profile);
      toast(`Signed in as ${profile.name}`);
    }
  }

  /* ---------------- Desktop downloads ---------------- */

  // Running inside the packaged desktop app already — no point offering
  // to download it.
  function isDesktopApp() {
    return / Electron\//.test(navigator.userAgent || '');
  }

  function hideDownloadEntryPointsInDesktop() {
    if (!isDesktopApp()) return;
    ['downloadBtn', 'settingsDownloadBtn', 'footerDownloadLink'].forEach((id) => {
      const el = $(id);
      if (el) el.hidden = true;
    });
    const group = $('settingsDownloadBtn');
    if (group && group.parentElement) group.parentElement.hidden = true;
  }

  function openDownloads(open) {
    const modal = $('downloadModal');
    const overlay = $('downloadOverlay');
    if (!modal) return;
    modal.hidden = !open;
    if (overlay) overlay.hidden = !open;
    document.body.classList.toggle('modal-open', open);
    if (open) {
      WTWDownloads.loadAndRender($('downloadBody'));
      $('downloadClose').focus();
    }
  }

  /* ---------------- PWA ---------------- */

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    // Service workers need http(s); opening index.html from disk is fine
    // but unregistered.
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' &&
        location.hostname !== '127.0.0.1') return;
    // When a new worker takes over, reload once so the running page is
    // never left on the previous version's scripts.
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      console.info('[pwa] new version activated, reloading');
      window.location.reload();
    });

    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js')
        .then((reg) => {
          console.info('[pwa] service worker registered', reg && reg.scope);
          // Check for a newer deploy on every launch.
          if (reg && reg.update) reg.update().catch(() => { /* offline */ });
        })
        .catch((err) => console.warn('[pwa] registration failed', err));
    });
  }

  // Canvas-backed strips need an explicit redraw when the layout changes.
  function watchResize() {
    let pending = null;
    const redraw = () => {
      clearTimeout(pending);
      pending = setTimeout(() => { if (state.nowcast) drawNowcastStrip(state.nowcast); }, 120);
    };
    window.addEventListener('resize', redraw);
    const panel = $('nowcastPanel');
    if (window.ResizeObserver && panel) new ResizeObserver(redraw).observe(panel);
  }

  function watchConnectivity() {
    window.addEventListener('online', () => {
      $('offlineBanner').hidden = true;
      if (state.location) loadLocation(state.location, { announce: false });
    });
    window.addEventListener('offline', () => {
      state.offline = true;
      $('offlineBanner').hidden = false;
    });
  }

  /* ---------------- Events ---------------- */

  function initEvents() {
    $('searchBtn').addEventListener('click', handleSearch);
    $('searchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleSearch(); });
    $('geoBtn').addEventListener('click', handleGeolocate);
    $('refreshBtn').addEventListener('click', () => {
      if (state.location) loadLocation(state.location);
      else toast('Nothing to refresh yet — search for a place first.', true);
    });
    $('saveFavBtn').addEventListener('click', handleSaveFavorite);
    $('roastBtn').addEventListener('click', doRoast);
    $('shareRoastBtn').addEventListener('click', shareRoast);

    $('roastLogToggle').addEventListener('click', () => {
      const panel = $('roastLogPanel');
      const open = panel.hidden;
      panel.hidden = !open;
      $('roastLogToggle').setAttribute('aria-expanded', open ? 'true' : 'false');
      $('roastLogToggle').textContent = open ? '▾ Hide history' : '▸ Roast history';
      if (open) renderRoastLog();
    });

    $('radarPlayBtn').addEventListener('click', () => WTWRadar.toggle());
    $('radarStopBtn').addEventListener('click', () => WTWRadar.stop());
    $('radarRefreshBtn').addEventListener('click', () => {
      WTWRadar.refresh(state.weather);
      toast('Radar refreshed');
    });
    $('radarLocateBtn').addEventListener('click', handleGeolocate);
    $('radarZoomIn').addEventListener('click', () => WTWRadar.zoom('in'));
    $('radarZoomOut').addEventListener('click', () => WTWRadar.zoom('out'));
    $('radarRecenter').addEventListener('click', () => WTWRadar.recenter());
    $('radarFullscreenBtn').addEventListener('click', () => WTWRadar.toggleFullscreen());

    // The High / Low readout opens the temperature trend.
    const hiLo = $('wxHiLoStat');
    if (hiLo) {
      hiLo.addEventListener('click', () => openTempChart(true));
      hiLo.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          openTempChart(true);
        }
      });
    }
    $('signOutBtn').addEventListener('click', logOut);
    $('guestLogoutBtn').addEventListener('click', logOut);
    $('showSignInBtn').addEventListener('click', () => showSignIn(true));
    $('cancelSignInBtn').addEventListener('click', () => showSignIn(false));

    $('downloadBtn').addEventListener('click', () => openDownloads(true));
    $('settingsDownloadBtn').addEventListener('click', () => {
      openSettings(false);
      openDownloads(true);
    });
    $('footerDownloadLink').addEventListener('click', (e) => {
      e.preventDefault();
      openDownloads(true);
    });
    $('downloadClose').addEventListener('click', () => openDownloads(false));
    $('downloadOverlay').addEventListener('click', () => openDownloads(false));

    $('tempModalClose').addEventListener('click', () => openTempChart(false));
    $('tempModalOverlay').addEventListener('click', () => openTempChart(false));
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!$('tempModal').hidden) openTempChart(false);
      if (!$('downloadModal').hidden) openDownloads(false);
    });

    $('compareRefreshBtn').addEventListener('click', () => {
      renderCompare({ refresh: true });
      toast('Refreshing your locations…');
    });

    $('welcomeGeoBtn').addEventListener('click', handleGeolocate);
    $('welcomeSearchBtn').addEventListener('click', () => $('searchInput').focus());
  }

  function init() {
    WTWThemes.init();
    renderUsernameEverywhere();
    initSettingsUI();
    initEvents();
    renderFavorites();
    renderRoastLog();
    renderCompare();
    WTWSearch.init({ onPick: (location) => loadLocation(location) });
    WTWAuth.init({ onChange: onAuthChange });
    WTWRadar.init('radarCanvas');
    WTWHourly.init('hourlyCanvas');
    WTWTempChart.init('tempChartCanvas');
    registerServiceWorker();
    watchConnectivity();
    watchResize();
    hideDownloadEntryPointsInDesktop();

    $('appVersion').textContent = WTW_CONFIG.app.version;
    const footerVersion = $('appVersionFooter');
    if (footerVersion) footerVersion.textContent = WTW_CONFIG.app.version;

    const last = WTWStorage.getLastLocation();
    if (last && typeof last.lat === 'number' && typeof last.lon === 'number') {
      loadLocation(last, { announce: false });
    } else if (!restoreSnapshot()) {
      $('welcomePanel').hidden = false;
      $('weatherPanels').hidden = true;
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
