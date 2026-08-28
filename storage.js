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

  /* ------------------------------------------------------------
     One-time migration from the V8 namespace.
     V9 uses its own prefix, but upgrading must not cost anyone their
     username, favorites or settings — so on first run we copy any
     V8 keys across. The V8 data is left untouched so downgrading
     still works.
     ------------------------------------------------------------ */
  function migrateFromV8() {
    const OLD = 'wtw8:';
    if (PREFIX === OLD) return;
    try {
      if (localStorage.getItem(key('migrated')) === 'true') return;
      const names = ['settings', 'favorites', 'lastLocation', 'roastHistory'];
      let moved = 0;
      names.forEach((name) => {
        const existing = localStorage.getItem(key(name));
        const old = localStorage.getItem(OLD + name);
        if (existing === null && old !== null) {
          localStorage.setItem(key(name), old);
          moved++;
        }
      });
      localStorage.setItem(key('migrated'), 'true');
      if (moved) console.info(`[storage] migrated ${moved} item(s) from V8`);
    } catch (err) {
      console.warn('[storage] V8 migration skipped', err);
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

  /* ---- Roast log (Local AI 3.0) ---- */

  function getRoastLog() {
    const log = get('roastLog', []);
    return Array.isArray(log) ? log : [];
  }

  function addRoastLog(entry) {
    const max = (window.WTW_CONFIG && WTW_CONFIG.roastLog && WTW_CONFIG.roastLog.maxEntries) || 50;
    const log = getRoastLog();
    log.unshift(entry);
    set('roastLog', log.slice(0, max));
    return log;
  }

  function clearRoastLog() {
    set('roastLog', []);
  }

  /* ---- Offline snapshot of the last successful load ---- */

  function saveSnapshot(snapshot) {
    set('snapshot', snapshot);
  }

  function getSnapshot() {
    return get('snapshot', null);
  }

  migrateFromV8();

  return {
    get, set, remove,
    getRoastLog, addRoastLog, clearRoastLog,
    saveSnapshot, getSnapshot,
    getSettings, saveSettings,
    getFavorites, saveFavorites,
    getLastLocation, saveLastLocation,
    getRoastHistory, saveRoastHistory,
  };
})();

window.WTWStorage = WTWStorage;
