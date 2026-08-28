/* ============================================================
   What the Wether V8 — storage.js
   Safe localStorage wrapper. Everything is namespaced and
   JSON-encoded, and every call is guarded so the app never
   crashes in private-browsing / blocked-storage situations.
   ============================================================ */

const WTWStorage = (() => {
  const PREFIX = (window.WTW_CONFIG && WTW_CONFIG.storagePrefix) || 'wtw8:';

  function key(name) {
    return PREFIX + name;
  }

  function get(name, fallback = null) {
    try {
      const raw = localStorage.getItem(key(name));
      if (raw === null || raw === undefined) return fallback;
      return JSON.parse(raw);
    } catch (err) {
      console.warn('[storage] read failed for', name, err);
      return fallback;
    }
  }

  function set(name, value) {
    try {
      localStorage.setItem(key(name), JSON.stringify(value));
      return true;
    } catch (err) {
      console.warn('[storage] write failed for', name, err);
      return false;
    }
  }

  function remove(name) {
    try {
      localStorage.removeItem(key(name));
      return true;
    } catch (err) {
      console.warn('[storage] remove failed for', name, err);
      return false;
    }
  }

  /* ---- Settings (username, personality, theme, autoRoast) ---- */

  function getSettings() {
    const defaults = (window.WTW_CONFIG && WTW_CONFIG.defaults) || {};
    const saved = get('settings', {});
    return Object.assign({}, defaults, saved);
  }

  function saveSettings(patch) {
    const merged = Object.assign({}, getSettings(), patch);
    set('settings', merged);
    return merged;
  }

  /* ---- Favorites ---- */

  function getFavorites() {
    const favs = get('favorites', []);
    return Array.isArray(favs) ? favs : [];
  }

  function saveFavorites(list) {
    set('favorites', Array.isArray(list) ? list : []);
  }

  /* ---- Last viewed location (state restore) ---- */

  function getLastLocation() {
    return get('lastLocation', null);
  }

  function saveLastLocation(loc) {
    set('lastLocation', loc);
  }

  /* ---- Recent roast history (anti-repeat for local AI) ---- */

  function getRoastHistory() {
    const h = get('roastHistory', []);
    return Array.isArray(h) ? h : [];
  }

  function saveRoastHistory(list) {
    set('roastHistory', Array.isArray(list) ? list.slice(-40) : []);
  }

  return {
    get, set, remove,
    getSettings, saveSettings,
    getFavorites, saveFavorites,
    getLastLocation, saveLastLocation,
    getRoastHistory, saveRoastHistory,
  };
})();

window.WTWStorage = WTWStorage;
