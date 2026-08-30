/* ============================================================
   Aither Weather V27 — app.js
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
    // Counts roasts started, so a slow Gemini reply cannot overwrite a
    // newer line that was asked for while it was in flight.
    roastToken: 0,
    normal: null,
    daily: [],
    hours: [],
    detail: {},
    yesterday: null,
    hourlyRaw: null,
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

  // Markup for the icon that goes with a code. Day or night matters for
  // anything with a sun or a moon in it.
  /* ------------------------------------------------------------
     How the app looks, in one place.

     Each of these is a data attribute on the root element and
     nothing else — styles.css owns every rule that reads them. That
     keeps a new option to a label in config.js and a block in the
     stylesheet, and it means the look survives a re-render because
     nothing has to remember to re-apply it.
     ------------------------------------------------------------ */
  function applyLook(settings) {
    const s = settings || WTWStorage.getSettings();
    const root = document.documentElement;
    root.dataset.cards = s.cardStyle || 'glass';
    root.dataset.corners = s.corners || 'round';
    root.dataset.density = s.density || 'comfortable';
    root.dataset.radar = s.radarStyle === 'scope' ? 'scope' : 'map';
    if (window.WTWScene) WTWScene.setBackground(s.background || 'animated');
  }

  function iconFor(code, size, isDay) {
    const day = isDay === undefined
      ? (state.weather ? state.weather.isDay !== false : true)
      : isDay;
    return WTWIcons.markup(code, { isDay: day, size });
  }

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


  /* ---------------- Chosen lengths ---------------- */

  // Settings win over config; config is the default and the fallback if
  // somebody's stored value is nonsense.
  function chosenForecastDays() {
    const allowed = WTW_CONFIG.forecastLengths || [];
    const want = Number(WTWStorage.getSettings().forecastDays);
    return allowed.includes(want) ? want : WTW_CONFIG.weather.forecastDays;
  }

  // The heading names a number of hours, so it has to follow the
  // setting rather than claim 48 forever.
  function updateHourlyTitle() {
    const el = $('hourlyTitle');
    if (!el) return;
    // Rebuilt rather than patched: the icon is markup and the count is
    // text, so setting textContent alone would eat the icon.
    const icon = window.WTWIcons ? WTWIcons.ui('clock', { size: 20 }) : '';
    el.innerHTML = `${icon}<span>Next ${chosenHourlyHours()} Hours</span>`;
  }

  function chosenHourlyHours() {
    const allowed = WTW_CONFIG.hourlyLengths || [];
    const want = Number(WTWStorage.getSettings().hourlyHours);
    return allowed.includes(want) ? want : WTW_CONFIG.weather.forecastHours;
  }

  /* ---------------- Open-Meteo ---------------- */

  async function fetchOpenMeteo(location) {
    const p = new URLSearchParams({
      latitude: String(location.lat),
      longitude: String(location.lon),
      current: ['temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'weather_code',
                'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'is_day',
                'pressure_msl', 'dew_point_2m', 'precipitation'].join(','),
      // pressure_msl hourly is what makes a real barometric trend
      // possible: one reading cannot be rising or falling.
      // Everything the per-metric day charts draw. All of it hourly,
      // because a tile that opens a chart of one number needs that
      // number for every hour, not a daily maximum.
      hourly: ['temperature_2m', 'apparent_temperature', 'relative_humidity_2m',
               'precipitation_probability', 'precipitation', 'weather_code',
               'wind_speed_10m', 'wind_gusts_10m', 'wind_direction_10m',
               'visibility', 'pressure_msl', 'uv_index'].join(','),
      minutely_15: ['precipitation', 'precipitation_probability'].join(','),
      daily: ['weather_code', 'temperature_2m_max', 'temperature_2m_min',
              'precipitation_probability_max', 'precipitation_sum', 'wind_gusts_10m_max',
              'sunrise', 'sunset', 'uv_index_max'].join(','),
      temperature_unit: WTW_CONFIG.weather.temperatureUnit,
      precipitation_unit: WTW_CONFIG.weather.precipitationUnit,
      wind_speed_unit: WTW_CONFIG.weather.windSpeedUnit,
      timezone: 'auto',
      forecast_days: String(chosenForecastDays()),
      // Yesterday, so today can be put in context. Everything below
      // indexes off todayIdx rather than 0 because of it.
      past_days: '1',
    });
    const data = await getJSON(`${WTW_CONFIG.api.forecast}?${p}`);

    const c = data.current || {};
    const d = data.daily || {};
    const h = data.hourly || {};

    // Where today sits once yesterday is prepended. Derived from the
    // array length rather than by matching a date string: the API
    // reports in the location's timezone, which is not necessarily the
    // one this browser is in, and a date comparison across that gap is
    // wrong for a few hours every day.
    const times = d.time || [];
    const forecastDays = chosenForecastDays();
    const todayIdx = Math.max(0, times.length - forecastDays);
    const at = (arr, i) => (Array.isArray(arr) ? arr[i] : null);

    const weather = {
      city: location.name,
      tempF: c.temperature_2m,
      feelsLikeF: c.apparent_temperature,
      humidity: c.relative_humidity_2m,
      windMph: c.wind_speed_10m,
      windDirDeg: c.wind_direction_10m,
      weatherCode: c.weather_code,
      isDay: c.is_day === 1,
      precipProb: at(d.precipitation_probability_max, todayIdx),
      highF: at(d.temperature_2m_max, todayIdx),
      lowF: at(d.temperature_2m_min, todayIdx),
    };

    // Yesterday, for the comparison line. Absent if the API ignored
    // past_days, which is treated as "no comparison" rather than
    // silently comparing today with itself.
    const yesterday = todayIdx > 0 ? {
      dateISO: at(times, todayIdx - 1),
      highF: at(d.temperature_2m_max, todayIdx - 1),
      lowF: at(d.temperature_2m_min, todayIdx - 1),
      code: at(d.weather_code, todayIdx - 1),
      // The sun sheet compares today's day length with the day
      // before, and today's "day before" is here rather than in the
      // forecast array, which starts at today.
      sunrise: at(d.sunrise, todayIdx - 1),
      sunset: at(d.sunset, todayIdx - 1),
    } : null;

    // The forecast row starts today; yesterday is held separately.
    const daily = times.slice(todayIdx).map((iso, n) => {
      const i = n + todayIdx;
      return {
        dateISO: iso,
        code: at(d.weather_code, i) ?? 0,
        highF: at(d.temperature_2m_max, i),
        lowF: at(d.temperature_2m_min, i),
        precipProb: at(d.precipitation_probability_max, i),
        // Per day rather than today-only: the day view needs them for
        // whichever day was tapped.
        sunrise: at(d.sunrise, i),
        sunset: at(d.sunset, i),
        uvIndex: at(d.uv_index_max, i),
      };
    });

    // Visibility is hourly-only in Open-Meteo. Take the hour nearest to
    // now: with yesterday in the series, index 0 is a day old.
    let visibilityMi = null;
    if (Array.isArray(h.visibility) && Array.isArray(h.time) && h.time.length) {
      const now = Date.now();
      let best = 0;
      let bestGap = Infinity;
      for (let i = 0; i < h.time.length; i++) {
        const gap = Math.abs(new Date(h.time[i]).getTime() - now);
        if (gap < bestGap) { bestGap = gap; best = i; }
      }
      const metres = h.visibility[best];
      if (metres != null) visibilityMi = metres * 0.000621371;
    }

    /* Barometric trend, measured rather than asserted.

       A single reading cannot be rising or falling, so this compares
       now against three hours ago from the hourly series — which is
       there because past_days=1 is already being asked for. The
       0.02 inHg deadband is roughly the resolution people can act on;
       below it the honest answer is "steady", not a direction picked
       from noise. */
    const pressureTrend = (() => {
      const series = h.pressure_msl;
      const times = h.time;
      if (!Array.isArray(series) || !Array.isArray(times)) return null;
      const now = Date.now();
      const near = (target) => {
        let best = -1, gap = Infinity;
        for (let i = 0; i < times.length; i++) {
          const dt = Math.abs(new Date(times[i]).getTime() - target);
          if (dt < gap && series[i] != null) { gap = dt; best = i; }
        }
        // More than 90 minutes off the mark is not the hour asked for.
        return gap <= 90 * 60000 ? series[best] : null;
      };
      const nowMb = near(now);
      const thenMb = near(now - 3 * 3600000);
      if (nowMb == null || thenMb == null) return null;
      const deltaInHg = (nowMb - thenMb) * 0.0295300;
      if (Math.abs(deltaInHg) < 0.02) return 'steady';
      return deltaInHg > 0 ? 'rising' : 'falling';
    })();

    /* The next wet day, and how much. "80% chance" says nothing about
       whether to move the barbecue; "0.15 inches on Thursday" does.
       Only days from tomorrow on: today already has its own figure. */
    const nextPrecip = (() => {
      const sums = d.precipitation_sum;
      if (!Array.isArray(sums)) return null;
      for (let i = todayIdx + 1; i < times.length; i++) {
        const amount = sums[i];
        if (amount != null && amount >= 0.01) {
          return { dateISO: at(times, i), amountIn: amount };
        }
      }
      return null;
    })();

    const detail = {
      sunrise: at(d.sunrise, todayIdx),
      sunset: at(d.sunset, todayIdx),
      uvIndex: at(d.uv_index_max, todayIdx),
      dewPointF: c.dew_point_2m ?? null,
      pressureInHg: c.pressure_msl != null ? c.pressure_msl * 0.0295300 : null,
      pressureTrend,
      visibilityMi,
      precipTodayIn: at(d.precipitation_sum, todayIdx),
      nextPrecip,
      windGustMph: c.wind_gusts_10m ?? null,
      gustMaxTodayMph: at(d.wind_gusts_10m_max, todayIdx),
    };

    const hours = WTWHourly.fromOpenMeteo(data, chosenHourlyHours());
    // The strip shows 48 hours; the day view needs the whole week, so
    // the raw series is kept rather than re-fetched.
    return { weather, daily, hours, detail, yesterday, hourlyRaw: h, raw: data };
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
      const daily = nws.daily.slice(0, chosenForecastDays());
      // NWS publishes neither sun times nor UV. Where Open-Meteo has
      // them for the same date, carry them over so a day tapped in the
      // forecast row can show them whichever source drew the row.
      if (om && Array.isArray(om.daily)) {
        const byDate = new Map(om.daily.map((day) => [day.dateISO, day]));
        daily.forEach((day) => {
          const match = byDate.get(day.dateISO);
          if (!match) return;
          if (day.sunrise == null) day.sunrise = match.sunrise;
          if (day.sunset == null) day.sunset = match.sunset;
          if (day.uvIndex == null) day.uvIndex = match.uvIndex;
        });
      }
      // Late in the day NWS has no daytime period left, so today's
      // high is missing; Open-Meteo reports the full calendar day.
      if (om && om.daily && om.daily[0]) {
        if (daily[0].highF === null) daily[0].highF = om.daily[0].highF;
        if (daily[0].lowF === null) daily[0].lowF = om.daily[0].lowF;
      }
      const today = daily[0] || {};
      const o = nws.obs;

      const hours = nws.hourly
        ? WTWHourly.fromNWS(nws.hourly, chosenHourlyHours(), NWS.textToCode)
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
        // NWS publishes forecasts, not history, so this is Open-Meteo's
        // either way.
        yesterday: om ? om.yesterday : null,
        hourlyRaw: om ? om.hourlyRaw : null,
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
    const [label] = describeCode(w.weatherCode);
    const icon = iconFor(w.weatherCode, 96, w.isDay !== false);

    $('wxCity').textContent = w.city;
    $('wxIcon').innerHTML = icon;
    // The sky underneath follows the same code the icon does, so the
    // two can never disagree about what the weather is.
    if (window.WTWScene) WTWScene.set(w.weatherCode, w.isDay !== false);
    $('wxTemp').textContent = fmtTemp(w.tempF);
    $('wxCondition').textContent = w.conditionText || label;
    $('wxFeels').textContent = fmtTemp(w.feelsLikeF);
    $('wxHumidity').textContent = U().percent(w.humidity);
    $('wxWind').textContent = U().speed(w.windMph);
    $('wxHiLo').textContent = `${fmtTemp(w.highF)} / ${fmtTemp(w.lowF)}`;
    const hiLoLine = $('wxHiLoLine');
    if (hiLoLine) hiLoLine.textContent = `H:${fmtTemp(w.highF)}  L:${fmtTemp(w.lowF)}`;
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
    renderTiles();
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

  /* The tiles are derived, never stored: everything they show comes
     from state that already exists, so they cannot disagree with the
     rest of the card. */
  function renderTiles() {
    if (!window.WTWTiles) return;
    WTWTiles.render({
      weather: state.weather,
      detail: state.detail,
      daily: state.daily,
      hours: state.hours,
      air: state.air,
      normal: state.normal,
      nowcastText: state.nowcastText || '',
    });
  }

  /* ------------------------------------------------------------
     Today against yesterday. Compares like with like — the day's high
     against the day's high — and says nothing at all when yesterday is
     missing, rather than inventing a comparison.
     ------------------------------------------------------------ */
  function renderYesterday() {
    const el = $('wxYesterday');
    if (!el) return;
    const y = state.yesterday;
    const todayHigh = state.weather && state.weather.highF;
    if (!y || y.highF == null || todayHigh == null) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    const diffF = todayHigh - y.highF;
    // Under a degree either way is noise, not news.
    if (Math.abs(diffF) < 1) {
      el.textContent = 'About the same as yesterday';
    } else {
      const word = diffF > 0 ? 'warmer' : 'colder';
      el.textContent = `${U().tempDelta(diffF)} ${word} than yesterday`;
    }
    el.title = `Yesterday's high was ${U().temp(y.highF, { withUnit: true })}`;
    el.hidden = false;
  }

  function renderForecast() {
    const wrap = $('forecastRow');
    if (!wrap) return;
    wrap.innerHTML = '';

    // One scale for the whole week, so the bars can be read against
    // each other rather than each being scaled to itself.
    const lows = state.daily.map((d) => d.lowF).filter((v) => v != null);
    const highs = state.daily.map((d) => d.highF).filter((v) => v != null);
    const weekLow = lows.length ? Math.min(...lows) : 0;
    const weekHigh = highs.length ? Math.max(...highs) : 1;
    const spread = Math.max(1, weekHigh - weekLow);

    state.daily.forEach((day, i) => {
      const [label] = describeCode(day.code);
      const icon = iconFor(day.code, 30, true);
      const date = new Date(day.dateISO + 'T12:00:00');
      const dayName = i === 0 ? 'Today' : date.toLocaleDateString([], { weekday: 'short' });

      const from = day.lowF == null ? 0 : ((day.lowF - weekLow) / spread) * 100;
      const to = day.highF == null ? 100 : ((day.highF - weekLow) / spread) * 100;

      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'forecast-card';
      card.innerHTML = `
        <span class="fc-day">${dayName}</span>
        <span class="fc-icon">${icon}</span>
        <span class="fc-rain">${U().percent(day.precipProb)}</span>
        <span class="fc-lo">${fmtTemp(day.lowF)}</span>
        <span class="fc-range" aria-hidden="true">
          <span class="fc-range-fill" style="left:${from}%;right:${100 - to}%"></span>
        </span>
        <span class="fc-hi">${fmtTemp(day.highF)}</span>
      `;
      card.title = `${label} — tap for the day and a roast`;
      card.addEventListener('click', () => {
        // The roast still lands on the card behind, so the log and the
        // main line behave exactly as they did; the day view shows the
        // same line where you are actually looking.
        const line = roastDay(day, dayName, { scroll: false });
        openDayDetail(day, dayName, true, line);
      });
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
      renderYesterday();
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

  /* No name, no greeting.

     The app used to ship a name, so a first run greeted somebody who
     had never told it anything. A blank name now means the greeting
     is not rendered at all rather than rendered empty or with a
     stand-in — "Yo, ⚡" and "Yo, friend ⚡" are both worse than
     nothing. */
  /* The bot is a whole panel, and off means gone — not an empty box
     with a heading. The roast history goes with it, because a log of
     something that is switched off is clutter. */
  function applyRoastVisibility() {
    const on = WTWStorage.getSettings().showRoast !== false;
    document.querySelectorAll('.roast-inline').forEach((el) => { el.hidden = !on; });
    const autoGroup = $('autoRoastGroup');
    if (autoGroup) autoGroup.hidden = !on;
    const brainGroup = $('botBrainSelect');
    if (brainGroup && brainGroup.closest('.setting-group')) {
      brainGroup.closest('.setting-group').hidden = !on;
    }
    const gem = $('geminiGroup');
    if (gem && !on) gem.hidden = true;
    return on;
  }

  function renderUsernameEverywhere() {
    const name = (WTWStorage.getSettings().username || '').trim();
    document.querySelectorAll('[data-username]').forEach((el) => { el.textContent = name; });
    document.querySelectorAll('[data-greeting]').forEach((el) => { el.hidden = !name; });
    document.querySelectorAll('[data-greeting-welcome]').forEach((el) => {
      el.textContent = name ? `Welcome, ${name}!` : 'Welcome!';
    });
    const input = $('usernameInput');
    if (input && document.activeElement !== input) input.value = name;
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

  /* The climate normal is the slowest thing on the page and the least
     important, so it is fetched on its own and the tile appears when
     it arrives. A location with too little history, or an archive
     that is down, simply leaves the tile hidden — the rest of the app
     never waits on it and never shows a placeholder in its place. */
  async function loadNormals(location) {
    state.normal = null;
    if (!window.WTWNormals) return;
    try {
      state.normal = await WTWNormals.fetchNormal(location, new Date());
    } catch (err) {
      console.warn('[app] climate normal unavailable', err);
      state.normal = null;
    }
    renderTiles();
  }

  /* Where this forecast is actually for. A city name is not a place —
     two towns share one, and a geolocated fix lands on coordinates
     rather than an address — so the coordinates are shown and a map
     link offered for anybody who wants to check. */
  function renderPlace(location) {
    const footer = $('placeFooter');
    if (!footer || !location) return;
    const lat = Number(location.lat), lon = Number(location.lon);
    if (!isFinite(lat) || !isFinite(lon)) { footer.hidden = true; return; }
    footer.hidden = false;
    $('placeName').textContent = location.name || '—';
    $('placeCoords').textContent =
      `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}, ` +
      `${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? 'E' : 'W'}`;
    const link = $('openInMaps');
    if (link) {
      // OpenStreetMap rather than a vendor's map: no key, no account,
      // and it opens in whatever the device already uses for the web.
      link.href = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=11/${lat}/${lon}`;
    }
  }

  function setGeminiStatus(text, kind) {
    const el = $('geminiStatus');
    if (!el) return;
    el.textContent = text || '';
    el.dataset.kind = kind || '';
    el.hidden = !text;
  }

  /* The key field never shows the key. It shows that a key is there,
     masked — enough to recognise which one, not enough to use. Typing
     into it replaces it; leaving it alone keeps what is saved. */
  function initGeminiKey() {
    const input = $('geminiKeyInput');
    const save = $('geminiSaveBtn');
    const test = $('geminiTestBtn');
    const clear = $('geminiClearBtn');
    if (!input || !window.WTWGemini) return;

    const reflect = () => {
      if (WTWGemini.hasKey()) {
        input.value = '';
        input.placeholder = `Saved: ${WTWGemini.maskedKey()}`;
      } else {
        input.value = '';
        input.placeholder = 'Paste your key';
      }
    };
    reflect();

    /* Saving and testing are one action.

       They were two, and the difference between "saved" and "working"
       is the whole question — a key that saves and then fails is
       exactly the case somebody needs to know about, and asking them
       to click a second button to find out is asking them not to. */
    const saveAndTest = async () => {
      const value = input.value.trim();
      if (!value) { setGeminiStatus('Nothing to save — paste a key first.', 'warn'); return; }
      if (value.length < 20) { setGeminiStatus('That looks too short to be a key.', 'warn'); return; }
      WTWGemini.setKey(value);
      reflect();
      setGeminiStatus('Saved. Checking it with Google…', '');
      const result = await WTWGemini.testKey();
      setGeminiStatus(result.ok
        ? `Working — the bot is on Gemini now. It said: "${result.sample}"`
        : `Saved, but it did not work: ${result.reason}`, result.ok ? 'ok' : 'warn');
      if (result.ok) {
        // A key that works is a key somebody wants used.
        WTWStorage.saveSettings({ botBrain: 'gemini' });
        const sel = $('botBrainSelect');
        if (sel) sel.value = 'gemini';
        if (state.weather) doRoast();
      }
    };

    if (save) save.addEventListener('click', saveAndTest);
    // Enter is what people press after pasting a key.
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); saveAndTest(); }
    });

    if (test) test.addEventListener('click', async () => {
      setGeminiStatus('Asking Google…', '');
      test.disabled = true;
      try {
        const result = await WTWGemini.testKey();
        setGeminiStatus(result.ok
          ? `Working. It said: "${result.sample}"`
          : result.reason, result.ok ? 'ok' : 'warn');
      } finally {
        test.disabled = false;
      }
    });

    if (clear) clear.addEventListener('click', () => {
      WTWGemini.setKey('');
      reflect();
      setGeminiStatus('Forgotten. The built-in bot is writing the lines again.', 'ok');
    });
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

    // The AQI headline lives in its own tile now, and the tiles own
    // it: two places writing the same three elements is how they end
    // up disagreeing. This card keeps the breakdown underneath.
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
    // The moon lives in its own tile now, drawn rather than typed.
    renderTiles();

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
    // Three states, three drawn icons: raining now, rain on the way,
    // and nothing coming.
    const nowcastIcon = n.rainingNow ? 'droplet' : (n.startsIn !== null ? 'hourglass' : 'check');
    $('nowcastIcon').innerHTML = window.WTWIcons
      ? WTWIcons.ui(nowcastIcon, { size: 16 }) : '';
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
        const [label] = describeCode(row.code);
        const icon = iconFor(row.code, 34, true);
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

  function showRoast(text, context, { source = 'local' } = {}) {
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
      source, at: Date.now(),
    });
    renderRoastLog();
  }

  /* Which brain writes the line.

     Gemini only when it is switched on AND a key is saved AND the
     browser thinks it is online — all three, checked before a request
     rather than discovered by one failing. Anything else, and any
     failure at all, is the local bot. */
  function brainIsGemini() {
    return WTWStorage.getSettings().botBrain === 'gemini' &&
      window.WTWGemini && WTWGemini.hasKey() && navigator.onLine !== false;
  }

  /* A roast nobody waits for is not a roast, so the local line goes up
     first and Gemini replaces it when it arrives. Nobody watches a
     spinner where a joke should be, and if the request fails the line
     already on screen is the right one. */
  async function doRoast() {
    if (!state.weather) {
      $('roastText').textContent = "Load some weather first — I can't roast a blank sky.";
      return;
    }

    if (WTWStorage.getSettings().showRoast === false) return;

    const local = LocalAI.generate(state.weather);
    if (!brainIsGemini()) {
      showRoast(local, 'Right now');
      return;
    }

    showRoast(local, 'Right now');
    const token = ++state.roastToken;
    setBotBadge('thinking');
    try {
      const settings = WTWStorage.getSettings();
      const line = await WTWGemini.ask(state.weather, {
        personality: settings.personality,
        username: settings.username,
        context: 'the weather right now',
      });
      // A newer roast started while this one was in flight; that one
      // owns the panel.
      if (token !== state.roastToken) return;
      if (line) showRoast(line, 'Right now', { source: 'gemini' });
      setBotBadge('gemini');
    } catch (err) {
      if (token !== state.roastToken) return;
      console.warn('[app] Gemini roast unavailable, keeping the local one', err.message);
      setBotBadge(err.message === 'bad-key' ? 'badkey' : 'local');
    }
  }

  /* The bot says which brain wrote the line, because "the AI said it"
     and "a template said it" are different claims and the user is
     entitled to know which one they are reading. */
  function setBotBadge(kind) {
    const el = $('botBadge');
    if (!el) return;
    const text = {
      thinking: 'Gemini · thinking…',
      gemini: 'Gemini',
      local: 'Local · Gemini unreachable',
      badkey: 'Local · Gemini key rejected',
      nokey: 'Local · add a Gemini key in Settings',
      offline: 'Local',
    }[kind] || '';
    el.textContent = text;
    el.hidden = !text;
    el.dataset.brain = kind;
  }

  /* ------------------------------------------------------------
     A day in detail. Tapping a forecast card still roasts that day —
     that behaviour predates this and people rely on it — and now also
     opens the day itself: its hours, its sun, its UV.
     ------------------------------------------------------------ */
  function hoursForDate(dateISO) {
    const raw = state.hourlyRaw;
    if (!raw || !Array.isArray(raw.time)) return [];
    const out = [];
    raw.time.forEach((iso, i) => {
      if (String(iso).slice(0, 10) !== dateISO) return;
      out.push({
        time: new Date(iso),
        tempF: raw.temperature_2m ? raw.temperature_2m[i] : null,
        precipProb: raw.precipitation_probability ? raw.precipitation_probability[i] : null,
        code: raw.weather_code ? raw.weather_code[i] : 0,
        windMph: raw.wind_speed_10m ? raw.wind_speed_10m[i] : null,
      });
    });
    return out;
  }

  function openDayDetail(day, dayName, open = true, roastLine = '') {
    const modal = $('dayModal');
    const overlay = $('dayModalOverlay');
    if (!modal || !overlay) return;

    if (!open) {
      modal.hidden = true;
      overlay.hidden = true;
      document.body.classList.remove('day-open');
      return;
    }

    const [label] = describeCode(day.code);
    const date = new Date(day.dateISO + 'T12:00:00');
    $('dayModalTitle').innerHTML = `${iconFor(day.code, 34, true)}<span>${dayName}</span>`;
    $('dayModalSummary').textContent =
      `${date.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })} · ${label}`;

    const roast = $('dayRoast');
    if (roast) {
      roast.textContent = roastLine || '';
      roast.hidden = !roastLine;
    }

    const facts = [
      ['High', U().temp(day.highF, { withUnit: true })],
      ['Low', U().temp(day.lowF, { withUnit: true })],
      ['Rain', U().percent(day.precipProb)],
      ['UV', day.uvIndex == null ? '--' : String(Math.round(day.uvIndex))],
      ['Sunrise', day.sunrise ? U().time(new Date(day.sunrise)) : '--'],
      ['Sunset', day.sunset ? U().time(new Date(day.sunset)) : '--'],
    ];
    $('dayFacts').innerHTML = facts.map(([k, v]) =>
      `<div class="day-fact"><span class="day-fact-label">${k}</span>` +
      `<span class="day-fact-value">${v}</span></div>`).join('');

    renderDayHours(day);

    modal.hidden = false;
    overlay.hidden = false;
    document.body.classList.add('day-open');
    modal.focus();
  }

  function renderDayHours(day) {
    const host = $('dayHours');
    const note = $('dayHoursNote');
    if (!host || !note) return;

    const hours = hoursForDate(day.dateISO);
    if (!hours.length) {
      host.innerHTML = '';
      // Hour-by-hour comes from Open-Meteo, and only for as far ahead as
      // it publishes. Saying so beats an empty box.
      note.textContent = 'Hour-by-hour is not available for this day.';
      return;
    }

    const temps = hours.map((h) => h.tempF).filter((t) => t != null);
    const min = Math.min(...temps);
    const max = Math.max(...temps);
    const span = Math.max(1, max - min);

    host.innerHTML = hours.map((h) => {
      // Height carries the temperature, so the shape of the day reads
      // at a glance; the number is there for anyone who wants it.
      const pct = h.tempF == null ? 0 : Math.round(((h.tempF - min) / span) * 100);
      const rain = h.precipProb == null ? 0 : Math.round(h.precipProb);
      return `<div class="day-hour">
        <span class="day-hour-temp">${U().temp(h.tempF)}</span>
        <span class="day-hour-bar" style="height:${8 + pct * 0.5}px"></span>
        <span class="day-hour-rain${rain >= 30 ? ' wet' : ''}">${rain}%</span>
        <span class="day-hour-time">${U().time(h.time)}</span>
      </div>`;
    }).join('');
    note.textContent = `${hours.length} hours · temperature and chance of rain`;
  }

  function roastDay(day, dayName, { scroll = true } = {}) {
    const line = LocalAI.generateForDay(day, {
      city: state.location ? state.location.name : '',
      windMph: state.weather ? state.weather.windMph : 5,
    });
    showRoast(line, dayName === 'Today' ? 'Today' : dayName);
    // Scrolling the card into view is pointless behind a modal, and
    // faintly maddening: the page moves under something you cannot see.
    if (scroll) $('roastText').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return line;
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
      yesterday: state.yesterday,
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
    state.yesterday = snap.yesterday || null;
    state.alerts = snap.alerts || [];
    state.air = snap.air || null;
    state.offline = true;

    renderCurrent();
    renderYesterday();
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

  async function loadLocation(location, { announce: announceToast = true, silent = false } = {}) {
    if (silent) announceToast = false;
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
      state.yesterday = result.yesterday || null;
      state.hourlyRaw = result.hourlyRaw || null;
      state.offline = false;

      renderCurrent();
      renderYesterday();
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
      loadNormals(location);
      renderPlace(location);
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
    /* ---- Look and feel ---- */
    const fillSelect = (el, items, value) => {
      if (!el) return;
      el.innerHTML = '';
      items.forEach((item) => {
        const opt = document.createElement('option');
        opt.value = String(item.id !== undefined ? item.id : item);
        opt.textContent = item.label !== undefined ? item.label : String(item);
        el.appendChild(opt);
      });
      el.value = String(value);
    };

    /* ---- The bot's brain ---- */

    const brainSel = $('botBrainSelect');
    const geminiGroup = $('geminiGroup');
    const showGeminiGroup = () => {
      if (geminiGroup) geminiGroup.hidden = !brainSel || brainSel.value !== 'gemini';
    };
    if (brainSel) {
      fillSelect(brainSel, WTW_CONFIG.botBrains || [], s.botBrain);
      showGeminiGroup();
      brainSel.addEventListener('change', () => {
        WTWStorage.saveSettings({ botBrain: brainSel.value });
        showGeminiGroup();
        if (brainSel.value === 'gemini' && window.WTWGemini && !WTWGemini.hasKey()) {
          setGeminiStatus('Paste your key below and press Enter.', 'warn');
          const box = $('geminiKeyInput');
          if (box) box.focus();
        } else {
          setGeminiStatus('', '');
        }
        setBotBadge(brainSel.value === 'gemini'
          ? (window.WTWGemini && WTWGemini.hasKey() ? 'gemini' : 'nokey') : '');
        toast(brainSel.value === 'gemini' ? 'Bot brain: Gemini' : 'Bot brain: built-in');
      });
    }
    const modelSel = $('geminiModelSelect');
    if (modelSel && window.WTWGemini) {
      fillSelect(modelSel, WTW_CONFIG.geminiModels || [], WTWGemini.chosenModel());
      modelSel.addEventListener('change', () => {
        WTWStorage.saveSettings({ geminiModel: modelSel.value });
        setGeminiStatus(`Model set to ${modelSel.options[modelSel.selectedIndex].text}.`, 'ok');
      });
    }
    initGeminiKey();

    /* ---- Look: background, cards, corners, spacing ---- */

    // Every one of these does the same thing — save, re-apply, say so
    // — so they are wired the same way rather than four times over.
    const look = [
      ['backgroundSelect', 'background', WTW_CONFIG.backgrounds, 'Background'],
      ['cardStyleSelect', 'cardStyle', WTW_CONFIG.cardStyles, 'Cards'],
      ['cornersSelect', 'corners', WTW_CONFIG.cornerStyles, 'Corners'],
      ['densitySelect', 'density', WTW_CONFIG.densities, 'Spacing'],
    ];
    look.forEach(([id, key, items, noun]) => {
      const el = $(id);
      if (!el) return;
      fillSelect(el, items || [], s[key]);
      el.addEventListener('change', () => {
        WTWStorage.saveSettings({ [key]: el.value });
        applyLook();
        // The tiles carry canvas drawings, which have to be redrawn at
        // the new size when the spacing changes under them.
        renderTiles();
        toast(`${noun}: ${el.options[el.selectedIndex].text}`);
      });
    });

    /* ---- The bot, on or off entirely ---- */

    const showRoastT = $('showRoastToggle');
    if (showRoastT) {
      showRoastT.checked = s.showRoast !== false;
      showRoastT.addEventListener('change', () => {
        WTWStorage.saveSettings({ showRoast: showRoastT.checked });
        applyRoastVisibility();
        toast(showRoastT.checked ? 'Wether Bot on' : 'Wether Bot off');
        if (showRoastT.checked && state.weather &&
            WTWStorage.getSettings().autoRoast) doRoast();
      });
    }

    /* ---- Radar: how it looks and how fast it runs ---- */

    const radarStyleSel = $('radarStyleSelect');
    if (radarStyleSel) {
      fillSelect(radarStyleSel, WTW_CONFIG.radarStyles || [], s.radarStyle);
      radarStyleSel.addEventListener('change', () => {
        WTWStorage.saveSettings({ radarStyle: radarStyleSel.value });
        applyLook();
        // The canvas changes shape, so it has to be measured again.
        if (window.WTWRadar && WTWRadar.relayout) WTWRadar.relayout();
        toast(`Radar: ${radarStyleSel.options[radarStyleSel.selectedIndex].text.split(' —')[0]}`);
      });
    }

    const bindRadarSlider = (id, key, outId, format) => {
      const el = $(id);
      const out = $(outId);
      if (!el) return;
      el.value = String(s[key]);
      if (out) out.textContent = format(Number(el.value));
      el.addEventListener('input', () => {
        const value = Number(el.value);
        if (out) out.textContent = format(value);
        WTWStorage.saveSettings({ [key]: value });
        // Repaint at once: a slider you have to wait for is a slider
        // people assume is broken.
        if (window.WTWRadar && WTWRadar.refresh) WTWRadar.redraw();
      });
    };
    bindRadarSlider('radarOpacity', 'radarOpacity', 'radarOpacityOut',
      (v) => `${Math.round(v * 100)}%`);
    bindRadarSlider('radarSpeed', 'radarSpeed', 'radarSpeedOut',
      (v) => `${v}×`);

    const sceneT = $('sceneToggle');
    if (sceneT) {
      sceneT.checked = s.sceneAnimation !== false;
      sceneT.addEventListener('change', () => {
        WTWStorage.saveSettings({ sceneAnimation: sceneT.checked });
        if (window.WTWScene) WTWScene.setEnabled(sceneT.checked);
        if (sceneT.checked && state.weather) {
          WTWScene.set(state.weather.weatherCode, state.weather.isDay !== false);
        }
        toast(sceneT.checked ? 'Animated sky on' : 'Animated sky off');
      });
    }

    const iSel = $('iconStyleSelect');
    fillSelect(iSel, WTW_CONFIG.iconStyles || [], s.iconStyle);
    if (iSel) iSel.addEventListener('change', () => {
      WTWStorage.saveSettings({ iconStyle: iSel.value });
      rerenderAll();
      toast(`Icons: ${iSel.options[iSel.selectedIndex].text}`);
    });

    const aSel = $('accentSelect');
    fillSelect(aSel, WTW_CONFIG.accents || [], s.accent);
    const paintAccentPreview = () => {
      const host = $('accentPreview');
      if (!host) return;
      host.innerHTML = (WTW_CONFIG.accents || []).map((a) =>
        `<span class="accent-dot${a.id === (WTWStorage.getSettings().accent || 'neon') ? ' picked' : ''}"
          style="background:linear-gradient(135deg,${a.accent},${a.accent2})"
          title="${a.label}"></span>`).join('');
    };
    paintAccentPreview();
    if (aSel) aSel.addEventListener('change', () => {
      WTWStorage.saveSettings({ accent: aSel.value });
      WTWThemes.applyAccent(aSel.value);
      paintAccentPreview();
      // The radar and the charts draw their own colours from the theme,
      // so they have to be told rather than left to notice.
      WTWRadar.onThemeChange();
      WTWHourly.redraw();
      WTWTempChart.redraw();
      toast(`Accent: ${aSel.options[aSel.selectedIndex].text}`);
    });

    const dSel = $('forecastDaysSelect');
    fillSelect(dSel, (WTW_CONFIG.forecastLengths || []).map((n) => ({ id: n, label: `${n} days` })),
      s.forecastDays);
    if (dSel) dSel.addEventListener('change', () => {
      WTWStorage.saveSettings({ forecastDays: Number(dSel.value) });
      toast(`Forecast: ${dSel.value} days`);
      // A different number of days is a different request.
      if (state.location) loadLocation(state.location, { silent: true });
    });

    const hSel = $('hourlyHoursSelect');
    fillSelect(hSel, (WTW_CONFIG.hourlyLengths || []).map((n) => ({ id: n, label: `${n} hours` })),
      s.hourlyHours);
    if (hSel) hSel.addEventListener('change', () => {
      WTWStorage.saveSettings({ hourlyHours: Number(hSel.value) });
      WTWHourly.setHours(state.hours.slice(0, Number(hSel.value)));
      updateHourlyTitle();
      toast(`Outlook: ${hSel.value} hours`);
    });

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
      WTWStorage.remove('usernameFromAccount');  // chosen by hand now
      WTWStorage.remove('usernameFromGoogle');   // key used before V14
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

  let signInRendered = false;

  function renderAccount(profile) {
    const signedIn = $('accountSignedIn');
    const signedOut = $('accountSignedOut');
    const brand = $('brandAvatar');
    if (!signedIn || !signedOut) return;

    signedIn.hidden = !profile;
    signedOut.hidden = !!profile;

    if (profile) {
      $('accountName').textContent = profile.name || '';
      $('accountEmail').textContent = profile.email || '';
      renderAccountAvatar(profile);
      if (brand && profile.picture) {
        brand.src = profile.picture;
        brand.hidden = false;
      } else if (brand) {
        brand.hidden = true;
        brand.removeAttribute('src');
      }
    } else if (brand) {
      brand.hidden = true;
      brand.removeAttribute('src');
    }
    renderAccountButton(profile);
    renderAccountHint(profile);
  }

  // The header button is the way in, and the way back to the account
  // once somebody is signed in.
  function renderAccountButton(profile) {
    const btn = $('accountBtn');
    const img = $('accountBtnAvatar');
    const icon = $('accountBtnIcon');
    if (!btn || !img || !icon) return;

    const label = profile ? `Account: ${profile.name}` : 'Sign in';
    btn.title = label;
    btn.setAttribute('aria-label', label);

    if (profile && profile.picture) {
      img.src = profile.picture;
      img.hidden = false;
      icon.hidden = true;
      return;
    }
    img.hidden = true;
    img.removeAttribute('src');
    icon.hidden = false;
    if (profile) {
      icon.removeAttribute('data-ui-icon');
      icon.textContent = profile.avatar ||
        (profile.name || '?').trim().charAt(0).toUpperCase();
    } else {
      // Signed out, the button is a plain interface icon like the
      // ones beside it — not a face emoji at the platform's mercy.
      icon.textContent = '';
      icon.setAttribute('data-ui-icon', 'account');
      if (window.WTWIcons && WTWIcons.paintUI) WTWIcons.paintUI(icon.parentNode);
      else icon.textContent = '\u{1F464}';
    }
  }

  // Google supplies a picture; Microsoft's ID token does not, and
  // fetching one needs Graph. An initial is better than a broken image.
  function renderAccountAvatar(profile) {
    const pic = $('accountAvatar');
    const initial = $('accountInitial');
    if (!pic || !initial) return;
    if (profile.picture) {
      pic.src = profile.picture;
      pic.hidden = false;
      initial.hidden = true;
      return;
    }
    pic.hidden = true;
    pic.removeAttribute('src');
    initial.textContent = profile.avatar ||
      (profile.name || '?').trim().charAt(0).toUpperCase();
    initial.hidden = false;
  }

  /* ------------------------------------------------------------
     The two ways in. Each provider's SDK is fetched only when this
     panel is opened and nobody is signed in, so simply using the app
     contacts neither Google nor Microsoft.
     ------------------------------------------------------------ */
  async function renderSignIn() {
    const note = $('signInNote');
    const msBtn = $('microsoftBtn');
    const appleBtn = $('appleBtn');
    const googleHost = $('googleButtonHost');
    const or = $('signInOr');
    if (!note || !msBtn || !appleBtn || !googleHost) return;

    renderAvatarPicker();
    const available = WTWAuth.providers();

    msBtn.hidden = !available.includes('microsoft');
    appleBtn.hidden = !available.includes('apple');

    // With no provider on offer the screen is about the name below it,
    // so the subtitle should not open by talking about accounts
    // elsewhere.
    const sub = $('signInSub');
    if (sub) {
      sub.textContent = available.length
        ? 'Use an account you already have. It sets your name and picture across ' +
          'the app \u2014 nothing else changes.'
        : 'Choose a name and the app will remember you on this device.';
    }
    // The "or" only earns its place when there is something on each
    // side of it.
    if (or) or.hidden = !available.length;

    // Whether or not a provider is configured, the name below always
    // works — so this screen never tells anyone it is out of order.
    // The note is for whoever is building the site, not using it.
    note.hidden = true;
    if (!available.length) {
      googleHost.hidden = true;
      if (isLocalDev()) {
        note.textContent = WTWAuth.isSupportedHere()
          ? 'No Google, Microsoft or Apple client ID is set — see the README to switch them on.'
          : 'Google, Microsoft and Apple sign-in need a web address, so they are unavailable here.';
        note.hidden = false;
      }
      return;
    }

    if (!available.includes('google')) {
      googleHost.hidden = true;
      return;
    }
    googleHost.hidden = false;
    const result = await WTWAuth.renderGoogleButton(googleHost);
    if (result !== 'rendered') {
      // Never leave an empty slot where a button was promised.
      googleHost.hidden = true;
      note.textContent = "Couldn't reach Google to load its sign-in button.";
      note.hidden = false;
    }
  }

  /* ------------------------------------------------------------
     Sign-in setup. Pasting an ID here switches a provider on for this
     device immediately — no reload, no deploy — so the whole flow can
     be tried before committing anything.
     ------------------------------------------------------------ */
  const PROVIDER_FIELDS = [
    { key: 'google', input: 'googleIdInput', save: 'googleIdSave', label: 'Google' },
    { key: 'microsoft', input: 'microsoftIdInput', save: 'microsoftIdSave', label: 'Microsoft' },
    { key: 'apple', input: 'appleIdInput', save: 'appleIdSave', label: 'Apple' },
  ];

  function initAuthSetup() {
    PROVIDER_FIELDS.forEach(({ key, input, save, label }) => {
      const field = $(input);
      const btn = $(save);
      if (!field || !btn) return;
      field.value = WTWAuth.storedClientId(key);
      const apply = () => {
        const now = WTWAuth.setClientId(key, field.value);
        // The screen is rebuilt from scratch next time it opens, so a
        // provider switched on here appears without a reload.
        signInRendered = false;
        renderAuthSetupStatus();
        toast(now ? `${label} sign-in is on for this device.`
                  : `${label} sign-in is off again.`);
      };
      btn.addEventListener('click', apply);
      field.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); });
    });
    renderAuthSetupStatus();
  }

  function renderAuthSetupStatus() {
    const el = $('authSetupStatus');
    if (!el) return;
    const on = WTWAuth.providers();
    if (!WTWAuth.isSupportedHere()) {
      el.textContent = 'These need a web address, so they cannot be used in the ' +
        'desktop app whatever is pasted here.';
      return;
    }
    el.textContent = on.length
      ? `On right now: ${on.map((p) => p[0].toUpperCase() + p.slice(1)).join(', ')}.`
      : 'None switched on yet — the name on the sign-in screen works regardless.';
  }

  /* ------------------------------------------------------------
     Moving an account to another device. Showing the code is a
     deliberate act rather than something on display, and restoring
     says what it actually did rather than just "done".
     ------------------------------------------------------------ */
  function initTransfer() {
    const show = $('transferShowBtn');
    const copy = $('transferCopyBtn');
    const box = $('transferCode');
    const input = $('transferInput');
    const restore = $('transferRestoreBtn');
    const status = $('transferStatus');
    if (!show || !copy || !box || !input || !restore || !status) return;

    show.addEventListener('click', () => {
      const code = WTWAuth.exportAccount();
      if (!code) {
        status.textContent = "Couldn't build a code on this device.";
        return;
      }
      box.value = code;
      box.hidden = false;
      copy.hidden = false;
      box.select();
      status.textContent = 'Paste this into the same box on the other device.';
    });

    copy.addEventListener('click', async () => {
      box.select();
      try {
        await navigator.clipboard.writeText(box.value);
        toast('Code copied.');
      } catch (err) {
        // Clipboard access is refused often enough that this needs an
        // answer other than silence; the text is already selected.
        toast('Copy it by hand — it is selected for you.', true);
      }
    });

    restore.addEventListener('click', () => {
      const res = WTWAuth.importAccount(input.value);
      if (!res.ok) {
        status.textContent = "That code couldn't be read. Copy the whole thing and try again.";
        toast("That code couldn't be read.", true);
        return;
      }
      input.value = '';
      status.textContent = `Restored${res.name ? ` ${res.name}` : ''}` +
        `${res.favorites ? ` and ${res.favorites} saved place${res.favorites === 1 ? '' : 's'}` : ''}.`;
      // Everything on screen was drawn from the old values.
      initSettingsUI();
      renderUsernameEverywhere();
      renderFavorites();
      renderCompare();
      rerenderAll();
      toast('Account restored.');
    });
  }

  function isLocalDev() {
    return location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  }

  let pickedAvatar = '';

  function renderAvatarPicker() {
    const host = $('avatarPicker');
    if (!host || host.childElementCount) return;      // built once
    WTWAuth.avatars().forEach((emoji, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'avatar-choice';
      btn.textContent = emoji;
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-label', `Picture ${i + 1}`);
      btn.setAttribute('aria-checked', 'false');
      btn.addEventListener('click', () => {
        pickedAvatar = pickedAvatar === emoji ? '' : emoji;
        host.querySelectorAll('.avatar-choice').forEach((el) => {
          const on = el.textContent === pickedAvatar;
          el.classList.toggle('picked', on);
          el.setAttribute('aria-checked', on ? 'true' : 'false');
        });
      });
      host.appendChild(btn);
    });
  }

  function signInLocally() {
    const input = $('localNameInput');
    if (!input) return;
    const res = WTWAuth.signInLocally(input.value, pickedAvatar);
    if (!res.ok) {
      toast('Type a name first.', true);
      input.focus();
      return;
    }
    input.value = '';
  }

  /* ------------------------------------------------------------
     The sign-in screen. Nothing in the app is behind it, so it opens
     on request and closes on Escape, the overlay, the ✕ or "Not now" —
     it is a door, not a gate.
     ------------------------------------------------------------ */
  function openSignIn(open) {
    const modal = $('signInModal');
    const overlay = $('signInOverlay');
    if (!modal || !overlay) return;

    if (open && WTWAuth.isSignedIn()) {
      // Already in. Show the account rather than an empty sign-in screen.
      openSettings(true);
      return;
    }

    modal.hidden = !open;
    overlay.hidden = !open;
    document.body.classList.toggle('signin-open', open);

    if (!open) {
      const btn = $('accountBtn');
      if (btn) btn.focus();
      return;
    }
    // Neither provider's script is fetched until somebody actually asks
    // to sign in, so using the app contacts neither company.
    if (!signInRendered) {
      signInRendered = true;
      renderSignIn();
    }
    modal.focus();
  }

  // Google renders and handles its own button; these two are ours, and
  // both behave the same way: closing the popup is a decision, not an
  // error, and anything else says so out loud.
  async function signInWithProvider(which) {
    const btn = $(which === 'apple' ? 'appleBtn' : 'microsoftBtn');
    const label = which === 'apple' ? 'Apple' : 'Microsoft';
    if (btn) btn.disabled = true;
    try {
      const res = which === 'apple'
        ? await WTWAuth.signInWithApple()
        : await WTWAuth.signInWithMicrosoft();
      if (!res.ok && res.reason !== 'cancelled') {
        toast(`Couldn't sign in with ${label}. Try again?`, true);
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function renderAccountHint(profile) {
    const hint = $('accountHint');
    if (!hint) return;
    if (profile && profile.provider === 'local') {
      hint.textContent = 'This name is kept on this device. It is not an account ' +
        'anywhere else, and nothing is synced.';
      return;
    }
    if (profile) {
      const where = { microsoft: 'Microsoft', apple: 'Apple' }[profile.provider] || 'Google';
      hint.textContent = `Signed in with ${where}. Your name and picture are kept ` +
        'on this device only \u2014 nothing is synced anywhere.';
      return;
    }
    hint.textContent = 'Signing in sets your name and picture. Nothing is synced: ' +
      'your favourites and settings stay on this device.';
  }

  // Adopt the account's first name only while the username is still the
  // stock default — never overwrite one the user chose themselves.
  function applyProfileToUsername(profile) {
    if (!profile || !profile.givenName) return;
    const current = WTWStorage.getSettings().username;
    if (current !== WTW_CONFIG.defaults.username) return;
    WTWStorage.saveSettings({ username: profile.givenName.slice(0, 24) });
    // Remembered so logging out can hand the name back, and so a name
    // typed in later is recognised as the user's own.
    WTWStorage.set('usernameFromAccount', true);
    renderUsernameEverywhere();
  }

  /* Log out ends the session and hands back the name and picture that
     came with it. A username typed in by hand is never touched. */
  function logOut() {
    const adopted = WTWStorage.get('usernameFromAccount', false) === true ||
                    WTWStorage.get('usernameFromGoogle', false) === true;
    WTWAuth.signOut();
    if (adopted) {
      WTWStorage.remove('usernameFromAccount');
      WTWStorage.remove('usernameFromGoogle');
      WTWStorage.saveSettings({ username: WTW_CONFIG.defaults.username });
      renderUsernameEverywhere();
      restateRoast();
    }
    toast('Logged out');
  }

  function onAuthChange(profile) {
    renderAccount(profile);
    if (profile) {
      openSignIn(false);
      applyProfileToUsername(profile);
      toast(`Signed in as ${profile.name}`);
      return;
    }
    // Logging out must leave a way back in: the screen is skipped while
    // signed in, so it is re-drawn the next time it opens.
    signInRendered = false;
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
    const stepBack = $('radarStepBack');
    const stepFwd = $('radarStepFwd');
    if (stepBack) stepBack.addEventListener('click', () => WTWRadar.step(-1));
    if (stepFwd) stepFwd.addEventListener('click', () => WTWRadar.step(1));

    /* Arrow keys step the loop, but only when the scope has focus —
       otherwise they would fight the page's own scrolling and every
       other arrow-key control on it. */
    const scope = $('radarCanvas');
    if (scope) {
      scope.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        WTWRadar.step(e.key === 'ArrowLeft' ? -1 : 1);
      });
    }
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
    $('microsoftBtn').addEventListener('click', () => signInWithProvider('microsoft'));
    $('appleBtn').addEventListener('click', () => signInWithProvider('apple'));
    $('localSignInForm').addEventListener('submit', (e) => {
      e.preventDefault();
      signInLocally();
    });

    $('accountBtn').addEventListener('click', () => openSignIn(true));
    $('settingsSignInBtn').addEventListener('click', () => {
      openSettings(false);
      openSignIn(true);
    });
    $('signInClose').addEventListener('click', () => openSignIn(false));
    $('signInDismiss').addEventListener('click', () => openSignIn(false));
    $('signInOverlay').addEventListener('click', () => openSignIn(false));

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

    $('dayModalClose').addEventListener('click', () => openDayDetail(null, '', false));
    $('dayModalOverlay').addEventListener('click', () => openDayDetail(null, '', false));
    $('tempModalClose').addEventListener('click', () => openTempChart(false));
    $('tempModalOverlay').addEventListener('click', () => openTempChart(false));
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!$('tempModal').hidden) openTempChart(false);
      if (!$('downloadModal').hidden) openDownloads(false);
      if (!$('signInModal').hidden) openSignIn(false);
      if (!$('dayModal').hidden) openDayDetail(null, '', false);
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
    applyLook();
    applyRoastVisibility();
    if (window.WTWIcons && WTWIcons.paintUI) WTWIcons.paintUI(document);
    renderUsernameEverywhere();
    initSettingsUI();
    updateHourlyTitle();
    initAuthSetup();
    initTransfer();
    initEvents();
    renderFavorites();
    renderRoastLog();
    renderCompare();
    WTWSearch.init({ onPick: (location) => loadLocation(location) });
    WTWAuth.init({ onChange: onAuthChange });
    WTWRadar.init('radarCanvas');
    WTWHourly.init('hourlyCanvas');
    WTWTempChart.init('tempChartCanvas');
    if (window.WTWMetricSheet) {
      WTWMetricSheet.init();
      /* One listener on the grid rather than one per tile: the tiles
         are static markup, but a delegated handler keeps working if
         they ever stop being. Keyboard too — a role="button" that
         only answers a mouse is not a button. */
      const grid = $('tileGrid');
      const openFor = (el) => {
        const host = el.closest('[data-metric], [data-sheet]');
        if (!host) return;
        WTWMetricSheet.open(host.dataset.metric || host.dataset.sheet, {
          daily: state.daily,
          hourlyRaw: state.hourlyRaw,
          detail: state.detail,
          weather: state.weather,
          air: state.air,
          normal: state.normal,
          yesterday: state.yesterday,
        });
      };
      if (grid) {
        grid.addEventListener('click', (e) => openFor(e.target));
        grid.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          if (!e.target.closest('[data-metric], [data-sheet]')) return;
          e.preventDefault();
          openFor(e.target);
        });
      }
    }

    if (window.WTWScene) {
      WTWScene.init();
      WTWScene.setEnabled(WTWStorage.getSettings().sceneAnimation !== false);
    }
    applyLook();
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
