/* ============================================================
   What the Wether V19 — icons.js
   Weather icons drawn as SVG rather than typed as emoji.

   Why not emoji: they are somebody else's artwork, they differ on
   every platform (the same forecast looks like three different
   things on Android, Windows and iOS), several weather emoji are
   nearly indistinguishable at 20px, and none of them take the app's
   accent colour. These are original shapes built from a handful of
   gradients, so they look the same everywhere and scale cleanly.

   They are NOT copies of any platform's icon set. The style — soft
   gradients, layered sun behind cloud — is a common one; the paths
   are this project's own.

   Gradients and the cloud body live once in a hidden sprite in
   index.html, referenced by id. Inlining them per icon would mean
   dozens of duplicate gradient ids in one document, and a duplicate
   id makes every reference after the first ambiguous.

   Emoji remain available as a setting, and are used verbatim where
   an icon has to survive being drawn onto a canvas (the share card)
   or copied as text.
   ============================================================ */

const WTWIcons = (() => {

  // WMO code → the icon that describes it. Day and night differ only
  // where the sun or moon is actually part of the picture.
  const BY_CODE = {
    0:  'clear',      1:  'mostly-clear', 2:  'partly-cloudy', 3:  'overcast',
    45: 'fog',        48: 'fog',
    51: 'drizzle',    53: 'drizzle',      55: 'rain',
    56: 'sleet',      57: 'sleet',
    61: 'rain-light', 63: 'rain',         65: 'rain-heavy',
    66: 'sleet',      67: 'sleet',
    71: 'snow-light', 73: 'snow',         75: 'snow-heavy', 77: 'snow',
    80: 'showers',    81: 'rain',         82: 'thunder',
    85: 'snow',       86: 'snow-heavy',
    95: 'thunder',    96: 'thunder',      99: 'thunder',
  };

  const EMOJI = {
    'clear': ['☀️', '🌙'],
    'mostly-clear': ['🌤️', '🌙'],
    'partly-cloudy': ['⛅', '☁️'],
    'overcast': ['☁️', '☁️'],
    'fog': ['🌫️', '🌫️'],
    'drizzle': ['🌦️', '🌧️'],
    'showers': ['🌦️', '🌧️'],
    'rain-light': ['🌧️', '🌧️'],
    'rain': ['🌧️', '🌧️'],
    'rain-heavy': ['🌧️', '🌧️'],
    'sleet': ['🌨️', '🌨️'],
    'snow-light': ['🌨️', '🌨️'],
    'snow': ['🌨️', '🌨️'],
    'snow-heavy': ['❄️', '❄️'],
    'thunder': ['⛈️', '⛈️'],
    'unknown': ['🌡️', '🌡️'],
  };

  const nameFor = (code) => BY_CODE[code] || 'unknown';

  /* ---------------- Pieces ---------------- */

  const cloud = (x, y, scale, fill) =>
    `<use href="#wtwCloud" x="0" y="0" fill="${fill}" ` +
    `transform="translate(${x} ${y}) scale(${scale})" />`;

  const sun = (x, y, scale) =>
    `<use href="#wtwSun" transform="translate(${x} ${y}) scale(${scale})" />`;

  const moon = (x, y, scale) =>
    `<use href="#wtwMoon" transform="translate(${x} ${y}) scale(${scale})" />`;

  // Drops and flakes fall on slightly different beats so a row of them
  // does not read as a comb.
  function drops(count, heavy) {
    const xs = count === 2 ? [24, 40] : [20, 32, 44];
    return xs.map((x, i) => {
      const y = 46 + (i % 2 ? 2 : 0);
      const len = heavy ? 11 : 7;
      return `<path d="M${x} ${y}q2.6 ${len * 0.55} 0 ${len}q-2.6 -${len * 0.45} 0 -${len}z"
        fill="url(#wtwRainGrad)" opacity="${heavy ? 0.95 : 0.85}" />`;
    }).join('');
  }

  function flakes(count) {
    const xs = count === 2 ? [25, 39] : [20, 32, 44];
    return xs.map((x, i) => {
      const y = 50 + (i % 2 ? 3 : 0);
      return `<g stroke="url(#wtwSnowGrad)" stroke-width="2.1" stroke-linecap="round"
        transform="translate(${x} ${y})">
        <line x1="-4" y1="0" x2="4" y2="0" />
        <line x1="0" y1="-4" x2="0" y2="4" />
        <line x1="-2.8" y1="-2.8" x2="2.8" y2="2.8" />
        <line x1="2.8" y1="-2.8" x2="-2.8" y2="2.8" />
      </g>`;
    }).join('');
  }

  const bolt = () =>
    `<path d="M34 42 24 58h7l-3 12 12-17h-7l4-11z" fill="url(#wtwBoltGrad)" />`;

  const fogBars = () => `
    <g stroke="url(#wtwCloudGrad)" stroke-width="4.5" stroke-linecap="round" opacity="0.9">
      <line x1="14" y1="46" x2="50" y2="46" />
      <line x1="18" y1="54" x2="46" y2="54" />
      <line x1="22" y1="62" x2="42" y2="62" />
    </g>`;

  /* ---------------- The icons ---------------- */

  const BODY = {
    'clear':          (day) => (day ? sun(16, 12, 1.05) : moon(16, 12, 1.05)),
    'mostly-clear':   (day) => (day ? sun(6, 4, 0.78) : moon(6, 4, 0.78)) +
                               cloud(6, 20, 0.72, 'url(#wtwCloudGrad)'),
    'partly-cloudy':  (day) => (day ? sun(4, 2, 0.7) : moon(4, 2, 0.7)) +
                               cloud(2, 16, 0.9, 'url(#wtwCloudGrad)'),
    'overcast':       () => cloud(8, 8, 0.66, 'url(#wtwCloudDarkGrad)') +
                            cloud(0, 16, 0.95, 'url(#wtwCloudGrad)'),
    'fog':            () => cloud(2, 4, 0.85, 'url(#wtwCloudGrad)') + fogBars(),
    'drizzle':        () => cloud(2, 2, 0.9, 'url(#wtwCloudGrad)') + drops(2, false),
    'showers':        (day) => (day ? sun(4, 0, 0.62) : moon(4, 0, 0.62)) +
                               cloud(2, 12, 0.82, 'url(#wtwCloudGrad)') + drops(2, false),
    'rain-light':     () => cloud(2, 2, 0.9, 'url(#wtwCloudGrad)') + drops(2, false),
    'rain':           () => cloud(2, 2, 0.9, 'url(#wtwCloudGrad)') + drops(3, false),
    'rain-heavy':     () => cloud(2, 0, 0.95, 'url(#wtwCloudDarkGrad)') + drops(3, true),
    'sleet':          () => cloud(2, 2, 0.9, 'url(#wtwCloudGrad)') + drops(2, false) + flakes(2),
    'snow-light':     () => cloud(2, 2, 0.9, 'url(#wtwCloudGrad)') + flakes(2),
    'snow':           () => cloud(2, 2, 0.9, 'url(#wtwCloudGrad)') + flakes(3),
    'snow-heavy':     () => cloud(2, 0, 0.95, 'url(#wtwCloudDarkGrad)') + flakes(3),
    'thunder':        () => cloud(2, 0, 0.95, 'url(#wtwCloudDarkGrad)') + bolt(),
    'unknown':        () => cloud(2, 6, 0.9, 'url(#wtwCloudGrad)'),
  };

  function style() {
    const settings = window.WTWStorage ? WTWStorage.getSettings() : null;
    return (settings && settings.iconStyle) || 'rendered';
  }

  function emojiFor(code, isDay = true) {
    const set = EMOJI[nameFor(code)] || EMOJI.unknown;
    return isDay ? set[0] : set[1];
  }

  /* ------------------------------------------------------------
     Markup for one icon. Always aria-hidden: every place an icon
     appears, the condition is already written beside it in words, and
     a screen reader announcing "cloud with rain" twice is worse than
     not announcing it at all. data-icon names it for tests, which
     should not have to match on a glyph or a path.
     ------------------------------------------------------------ */
  function markup(code, { isDay = true, size = 48 } = {}) {
    const name = nameFor(code);
    if (style() === 'emoji') {
      return `<span class="wx-glyph" data-icon="${name}" aria-hidden="true"
        style="font-size:${Math.round(size * 0.82)}px">${emojiFor(code, isDay)}</span>`;
    }
    const body = (BODY[name] || BODY.unknown)(isDay);
    return `<svg class="wx-svg" data-icon="${name}" viewBox="0 0 64 76" width="${size}"
      height="${Math.round(size * 76 / 64)}" aria-hidden="true" focusable="false">${body}</svg>`;
  }

  function paint(el, code, opts) {
    if (!el) return;
    el.innerHTML = markup(code, opts);
  }

  return { markup, paint, emojiFor, nameFor, style, names: () => Object.keys(BODY) };
})();

window.WTWIcons = WTWIcons;
