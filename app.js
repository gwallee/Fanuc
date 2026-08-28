/* ============================================================
   What the Wether V8 — app.js
   Main application: search, weather fetch (Open-Meteo, no key),
   geolocation, favorites, settings, username, roast wiring,
   and state restore. Every button gets a real event handler.
   ============================================================ */

(() => {
  'use strict';

  /* ---------------- App state ---------------- */

  const state = {
    location: null,   // { name, lat, lon }
    weather: null,    // normalized current weather
    daily: [],        // normalized 7-day forecast
    loading: false,
  };

  const $ = (id) => document.getElementById(id);

  /* ---------------- WMO weather code mapping ---------------- */

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

  function describeCode(code) {
    return WMO[code] || ['Weather', '🌡️'];
  }

  /* ---------------- Toasts ---------------- */

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

  /* ---------------- Fetch helpers ---------------- */

  async function getJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  /* ---------------- Geocoding (city / place / ZIP) ---------------- */

  async function geocode(query) {
    const q = query.trim();
    if (!q) return null;

    // US ZIP code → Zippopotam (no key).
    if (/^\d{5}(-\d{4})?$/.test(q)) {
      try {
        const zip = q.slice(0, 5);
        const data = await getJSON(WTW_CONFIG.api.zip + zip);
        const place = data.places && data.places[0];
        if (place) {
          return {
            name: `${place['place name']}, ${place['state abbreviation']}`,
            lat: parseFloat(place.latitude),
            lon: parseFloat(place.longitude),
          };
        }
      } catch (err) {
        console.warn('[geo] ZIP lookup failed, falling back to name search', err);
      }
    }

    // Open-Meteo geocoding (no key).
    const url = `${WTW_CONFIG.api.geocoding}?name=${encodeURIComponent(q)}&count=1&language=en&format=json`;
    const data = await getJSON(url);
    const hit = data.results && data.results[0];
    if (!hit) return null;
    const region = hit.admin1 && hit.admin1 !== hit.name ? `, ${hit.admin1}` : '';
    const country = hit.country_code ? ` (${hit.country_code})` : '';
    return { name: `${hit.name}${region}${country}`, lat: hit.latitude, lon: hit.longitude };
  }

  /* ---------------- Weather fetch (Open-Meteo, no key) ---------------- */

  async function fetchWeather(location) {
    const p = new URLSearchParams({
      latitude: String(location.lat),
      longitude: String(location.lon),
      current: [
        'temperature_2m', 'apparent_temperature', 'relative_humidity_2m',
        'weather_code', 'wind_speed_10m', 'wind_direction_10m', 'is_day',
      ].join(','),
      daily: [
        'weather_code', 'temperature_2m_max', 'temperature_2m_min',
        'precipitation_probability_max',
      ].join(','),
      temperature_unit: WTW_CONFIG.weather.temperatureUnit,
      wind_speed_unit: WTW_CONFIG.weather.windSpeedUnit,
      timezone: 'auto',
      forecast_days: String(WTW_CONFIG.weather.forecastDays),
    });
    const data = await getJSON(`${WTW_CONFIG.api.forecast}?${p}`);

    const c = data.current || {};
    const d = data.daily || {};
    const todayPrecip = Array.isArray(d.precipitation_probability_max)
      ? d.precipitation_probability_max[0] : null;

    const weather = {
      city: location.name,
      tempF: c.temperature_2m,
      feelsLikeF: c.apparent_temperature,
      humidity: c.relative_humidity_2m,
      windMph: c.wind_speed_10m,
      windDirDeg: c.wind_direction_10m,
      weatherCode: c.weather_code,
      isDay: c.is_day === 1,
      precipProb: todayPrecip ?? 0,
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

    return { weather, daily };
  }

  /* ---------------- Rendering ---------------- */

  function fmtTemp(v) {
    return (v === null || v === undefined || Number.isNaN(v)) ? '--' : `${Math.round(v)}°`;
  }

  function renderCurrent() {
    const w = state.weather;
    if (!w) return;
    const [label, icon] = describeCode(w.weatherCode);

    $('wxCity').textContent = w.city;
    $('wxIcon').textContent = icon;
    $('wxTemp').textContent = fmtTemp(w.tempF);
    $('wxCondition').textContent = label;
    $('wxFeels').textContent = fmtTemp(w.feelsLikeF);
    $('wxHumidity').textContent = (w.humidity ?? '--') + '%';
    $('wxWind').textContent = `${Math.round(w.windMph ?? 0)} mph`;
    $('wxHiLo').textContent = `${fmtTemp(w.highF)} / ${fmtTemp(w.lowF)}`;
    $('wxRain').textContent = `${Math.round(w.precipProb ?? 0)}%`;
    $('wxUpdated').textContent = 'Updated ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

    $('currentCard').classList.remove('empty');
    $('welcomePanel').hidden = true;
    $('weatherPanels').hidden = false;
  }

  function renderForecast() {
    const wrap = $('forecastRow');
    if (!wrap) return;
    wrap.innerHTML = '';
    state.daily.forEach((day, i) => {
      const [label, icon] = describeCode(day.code);
      const date = new Date(day.dateISO + 'T12:00:00');
      const dayName = i === 0 ? 'Today' : date.toLocaleDateString([], { weekday: 'short' });

      const card = document.createElement('div');
      card.className = 'forecast-card';
      card.innerHTML = `
        <div class="fc-day">${dayName}</div>
        <div class="fc-icon" title="${label}">${icon}</div>
        <div class="fc-temps"><span class="fc-hi">${fmtTemp(day.highF)}</span><span class="fc-lo">${fmtTemp(day.lowF)}</span></div>
        <div class="fc-rain">💧 ${day.precipProb ?? 0}%</div>
      `;
      wrap.appendChild(card);
    });
  }

  function renderUsernameEverywhere() {
    const { username } = WTWStorage.getSettings();
    document.querySelectorAll('[data-username]').forEach((el) => {
      el.textContent = username;
    });
    const input = $('usernameInput');
    if (input && document.activeElement !== input) input.value = username;
  }

  /* ---------------- Roasts ---------------- */

  function doRoast() {
    if (!state.weather) {
      $('roastText').textContent = 'Load some weather first — I can\'t roast a blank sky.';
      return;
    }
    const line = LocalAI.generate(state.weather);
    const el = $('roastText');
    el.classList.remove('pop');
    // retrigger CSS animation
    void el.offsetWidth;
    el.textContent = line;
    el.classList.add('pop');
    const p = WTWStorage.getSettings().personality;
    $('roastPersonality').textContent = p.charAt(0).toUpperCase() + p.slice(1) + ' mode';
  }

  /* ---------------- Load pipeline ---------------- */

  async function loadLocation(location, { announce = true } = {}) {
    if (state.loading) return;
    state.loading = true;
    setLoading(true);
    try {
      const { weather, daily } = await fetchWeather(location);
      state.location = location;
      state.weather = weather;
      state.daily = daily;

      renderCurrent();
      renderForecast();
      WTWRadar.setLocation(location.name, weather);
      WTWStorage.saveLastLocation(location);
      updateSaveButton();

      if (WTWStorage.getSettings().autoRoast) doRoast();
      if (announce) toast(`Weather loaded for ${location.name}`);
    } catch (err) {
      console.error('[app] weather load failed', err);
      toast('Could not load weather. Check your connection and try again.', true);
    } finally {
      state.loading = false;
      setLoading(false);
    }
  }

  function setLoading(on) {
    document.body.classList.toggle('loading', on);
    const btn = $('searchBtn');
    if (btn) btn.disabled = on;
  }

  async function handleSearch() {
    const input = $('searchInput');
    const q = input.value.trim();
    if (!q) {
      toast('Type a city, place, or US ZIP code first.', true);
      input.focus();
      return;
    }
    setLoading(true);
    try {
      const loc = await geocode(q);
      if (!loc) {
        toast(`No results for "${q}". Try another spelling.`, true);
        return;
      }
      await loadLocation(loc);
      input.value = '';
    } catch (err) {
      console.error('[app] search failed', err);
      toast('Search failed. Check your connection.', true);
    } finally {
      setLoading(false);
    }
  }

  function handleGeolocate() {
    if (!navigator.geolocation) {
      toast('Geolocation is not supported by this browser.', true);
      return;
    }
    toast('Finding your location…');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        // Reverse-friendly label without a reverse-geocoding key:
        let name = 'My Location';
        try {
          const url = `${WTW_CONFIG.api.geocoding}?latitude=${latitude}&longitude=${longitude}&count=1`;
          // Open-Meteo search doesn't reverse geocode; keep the generic label.
          void url;
        } catch (_) { /* label stays generic */ }
        await loadLocation({ name, lat: latitude, lon: longitude });
      },
      (err) => {
        console.warn('[app] geolocation error', err);
        toast('Location permission denied or unavailable.', true);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  }

  /* ---------------- Favorites ---------------- */

  function favKey(loc) {
    return `${loc.lat.toFixed(3)},${loc.lon.toFixed(3)}`;
  }

  function isFavorite(loc) {
    if (!loc) return false;
    return WTWStorage.getFavorites().some((f) => favKey(f) === favKey(loc));
  }

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
      loadBtn.title = `Load ${fav.name}`;
      loadBtn.addEventListener('click', () => loadLocation(fav));

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'fav-remove';
      removeBtn.textContent = '✕';
      removeBtn.title = `Remove ${fav.name}`;
      removeBtn.setAttribute('aria-label', `Remove ${fav.name} from favorites`);
      removeBtn.addEventListener('click', () => {
        const next = WTWStorage.getFavorites().filter((f) => favKey(f) !== favKey(fav));
        WTWStorage.saveFavorites(next);
        renderFavorites();
        updateSaveButton();
        toast(`Removed ${fav.name}`);
      });

      li.appendChild(loadBtn);
      li.appendChild(removeBtn);
      list.appendChild(li);
    });
  }

  function handleSaveFavorite() {
    if (!state.location) {
      toast('Load a location first, then save it.', true);
      return;
    }
    const favs = WTWStorage.getFavorites();
    if (isFavorite(state.location)) {
      const next = favs.filter((f) => favKey(f) !== favKey(state.location));
      WTWStorage.saveFavorites(next);
      toast(`Removed ${state.location.name} from favorites`);
    } else {
      favs.push(state.location);
      WTWStorage.saveFavorites(favs);
      toast(`Saved ${state.location.name} ⭐`);
    }
    renderFavorites();
    updateSaveButton();
  }

  function updateSaveButton() {
    const btn = $('saveFavBtn');
    if (!btn) return;
    const saved = isFavorite(state.location);
    btn.textContent = saved ? '★ Saved' : '☆ Save location';
    btn.classList.toggle('saved', saved);
  }

  /* ---------------- Settings panel ---------------- */

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

    // Personality select
    const pSel = $('personalitySelect');
    pSel.innerHTML = '';
    WTW_CONFIG.personalities.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p.charAt(0).toUpperCase() + p.slice(1);
      pSel.appendChild(opt);
    });
    pSel.value = s.personality;
    pSel.addEventListener('change', () => {
      WTWStorage.saveSettings({ personality: pSel.value });
      toast(`Personality set to ${pSel.value}`);
      if (state.weather && WTWStorage.getSettings().autoRoast) doRoast();
    });

    // Auto-roast toggle
    const autoRoast = $('autoRoastToggle');
    autoRoast.checked = !!s.autoRoast;
    autoRoast.addEventListener('change', () => {
      WTWStorage.saveSettings({ autoRoast: autoRoast.checked });
      toast(autoRoast.checked ? 'Auto-roast ON 🔥' : 'Auto-roast off');
    });

    // Theme select
    const tSel = $('themeSelect');
    WTWThemes.populateSelect(tSel);
    tSel.addEventListener('change', () => {
      WTWThemes.setTheme(tSel.value);
      toast(`Theme: ${tSel.options[tSel.selectedIndex].text}`);
    });

    // Username
    const saveUsername = () => {
      const input = $('usernameInput');
      const name = input.value.trim();
      if (!name) {
        toast('Username can\'t be empty.', true);
        input.value = WTWStorage.getSettings().username;
        return;
      }
      if (name.length > 24) {
        toast('Keep the username under 24 characters.', true);
        return;
      }
      WTWStorage.saveSettings({ username: name });
      renderUsernameEverywhere();
      toast(`Hello, ${name}! 👋`);
    };
    $('usernameSaveBtn').addEventListener('click', saveUsername);
    $('usernameInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveUsername();
    });

    // Open/close
    $('settingsBtn').addEventListener('click', () => openSettings(true));
    $('settingsCloseBtn').addEventListener('click', () => openSettings(false));
    $('settingsOverlay').addEventListener('click', () => openSettings(false));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') openSettings(false);
    });
  }

  /* ---------------- Wire everything up ---------------- */

  function initEvents() {
    $('searchBtn').addEventListener('click', handleSearch);
    $('searchInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleSearch();
    });
    $('geoBtn').addEventListener('click', handleGeolocate);
    $('refreshBtn').addEventListener('click', () => {
      if (state.location) loadLocation(state.location);
      else toast('Nothing to refresh yet — search for a place first.', true);
    });
    $('saveFavBtn').addEventListener('click', handleSaveFavorite);
    $('roastBtn').addEventListener('click', doRoast);

    // Radar controls
    $('radarPlayBtn').addEventListener('click', () => WTWRadar.toggle());
    $('radarStopBtn').addEventListener('click', () => WTWRadar.stop());
    $('radarRefreshBtn').addEventListener('click', () => {
      WTWRadar.refresh(state.weather);
      toast('Radar refreshed');
    });
    $('radarLocateBtn').addEventListener('click', handleGeolocate);

    // Welcome panel quick actions
    $('welcomeGeoBtn').addEventListener('click', handleGeolocate);
    $('welcomeSearchBtn').addEventListener('click', () => $('searchInput').focus());
  }

  function init() {
    WTWThemes.init();
    renderUsernameEverywhere();
    initSettingsUI();
    initEvents();
    renderFavorites();
    WTWRadar.init('radarCanvas');

    $('appVersion').textContent = WTW_CONFIG.app.version;

    // Restore last viewed location, if any.
    const last = WTWStorage.getLastLocation();
    if (last && typeof last.lat === 'number' && typeof last.lon === 'number') {
      loadLocation(last, { announce: false });
    } else {
      $('welcomePanel').hidden = false;
      $('weatherPanels').hidden = true;
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
