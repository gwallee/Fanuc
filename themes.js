/* ============================================================
   Aither Weather V21 — themes.js
   Theme switching via a data-theme attribute on <html>.
   All actual colors live in styles.css as CSS variables, so
   adding a theme = one CSS block + one entry in config.js.
   ============================================================ */

const WTWThemes = (() => {
  function validThemes() {
    return (WTW_CONFIG.themes || []).map((t) => t.id);
  }

  /* ------------------------------------------------------------
     The accent is applied on top of whichever theme is active, as two
     custom properties. Themes set their own defaults, so an accent of
     'neon' means "leave the theme's own" rather than forcing one
     theme's green onto the others.
     ------------------------------------------------------------ */
  function applyAccent(accentId) {
    const list = (window.WTW_CONFIG && WTW_CONFIG.accents) || [];
    const chosen = list.find((a) => a.id === accentId);
    const root = document.documentElement;
    if (!chosen) {
      root.style.removeProperty('--accent');
      root.style.removeProperty('--accent-2');
      root.removeAttribute('data-accent');
      return;
    }
    root.style.setProperty('--accent', chosen.accent);
    root.style.setProperty('--accent-2', chosen.accent2);
    root.setAttribute('data-accent', chosen.id);
  }

  function apply(themeId) {
    const ids = validThemes();
    const theme = ids.includes(themeId) ? themeId : WTW_CONFIG.defaults.theme;
    document.documentElement.setAttribute('data-theme', theme);
    // A theme change repaints the palette from CSS, so the accent has to
    // be re-stamped on top of it or it silently reverts.
    if (typeof applyAccent === 'function') applyAccent(currentAccent());

    // Keep the mobile browser chrome color in sync with the theme.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      const bg = getComputedStyle(document.documentElement)
        .getPropertyValue('--bg')
        .trim();
      if (bg) meta.setAttribute('content', bg);
    }
    return theme;
  }

  function setTheme(themeId) {
    const applied = apply(themeId);
    WTWStorage.saveSettings({ theme: applied });
    return applied;
  }

  function current() {
    return WTWStorage.getSettings().theme;
  }

  // Fill a <select> with the available themes.
  function populateSelect(selectEl) {
    if (!selectEl) return;
    selectEl.innerHTML = '';
    (WTW_CONFIG.themes || []).forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.label;
      selectEl.appendChild(opt);
    });
    selectEl.value = current();
  }

  function currentAccent() {
    const settings = window.WTWStorage ? WTWStorage.getSettings() : null;
    return (settings && settings.accent) || 'neon';
  }

  function init() {
    apply(current());
    applyAccent(currentAccent());
  }

  return { init, apply, applyAccent, currentAccent, setTheme, current, populateSelect };
})();

window.WTWThemes = WTWThemes;
