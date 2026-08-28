/* ============================================================
   What the Wether V8 — themes.js
   Theme switching via a data-theme attribute on <html>.
   All actual colors live in styles.css as CSS variables, so
   adding a theme = one CSS block + one entry in config.js.
   ============================================================ */

const WTWThemes = (() => {
  function validThemes() {
    return (WTW_CONFIG.themes || []).map((t) => t.id);
  }

  function apply(themeId) {
    const ids = validThemes();
    const theme = ids.includes(themeId) ? themeId : WTW_CONFIG.defaults.theme;
    document.documentElement.setAttribute('data-theme', theme);

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

  function init() {
    apply(current());
  }

  return { init, apply, setTheme, current, populateSelect };
})();

window.WTWThemes = WTWThemes;
