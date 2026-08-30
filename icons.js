/* ============================================================
   Aither Weather V28 — icons.js
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

  /* ------------------------------------------------------------
     Interface icons — search, settings, and the rest. Separate from
     the weather set on purpose: these are single-colour strokes that
     take the button's own colour, so they sit correctly on a primary
     button, a quiet one, and in every theme. Emoji did none of that,
     and a magnifying glass rendered as a whole illustration next to
     the word "Search".
     ------------------------------------------------------------ */
  const UI = {
    search: '<circle cx="11" cy="11" r="6.5"/><line x1="16" y1="16" x2="21" y2="21"/>',
    location: '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/>' +
              '<circle cx="12" cy="10" r="2.6"/>',
    download: '<path d="M12 3v12"/><path d="M7.5 10.5 12 15l4.5-4.5"/>' +
              '<path d="M4.5 19.5h15"/>',
    account: '<circle cx="12" cy="8.5" r="3.8"/>' +
             '<path d="M4.8 20a7.2 7.2 0 0 1 14.4 0"/>',
    settings: '<circle cx="12" cy="12" r="3.2"/>' +
              '<path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0' +
              '-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0' +
              '-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2' +
              ' 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1' +
              'a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5' +
              ' 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6' +
              ' 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v5h-5"/>',
    star: '<path d="m12 3.6 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
    chart: '<path d="M4 19V5"/><path d="M4 19h16"/><path d="m7.5 15 3.5-4 3 2.5 4.5-6"/>',
    close: '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    trash: '<path d="M4.5 6.5h15"/><path d="M9 6.5V4.8h6v1.7"/>' +
           '<path d="M6.5 6.5 7.4 20h9.2l.9-13.5"/>',
    share: '<circle cx="17.5" cy="6" r="2.6"/><circle cx="6.5" cy="12" r="2.6"/>' +
           '<circle cx="17.5" cy="18" r="2.6"/><path d="m9 10.7 6-3.4"/><path d="m9 13.3 6 3.4"/>',
    key: '<circle cx="8" cy="14" r="4"/><path d="m11 11 8-8"/><path d="m16.5 5.5 2 2"/>' +
         '<path d="m14 8 2 2"/>',
    device: '<rect x="7" y="3" width="10" height="18" rx="2.2"/><line x1="11" y1="18" x2="13" y2="18"/>',
    palette: '<path d="M12 3a9 9 0 1 0 0 18 2 2 0 0 0 1.6-3.2 2 2 0 0 1 1.6-3.2H18a3 3 0 0 0 3-3' +
             ' 9 9 0 0 0-9-8.6z"/><circle cx="8" cy="10" r="1.2"/><circle cx="12" cy="7.5" r="1.2"/>' +
             '<circle cx="16" cy="10" r="1.2"/>',
    play: '<path d="M8 5.5 18 12 8 18.5z"/>',
    pause: '<line x1="9.5" y1="5.5" x2="9.5" y2="18.5"/><line x1="14.5" y1="5.5" x2="14.5" y2="18.5"/>',
    stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.6"/>',
    stepBack: '<path d="M16 5.5 8 12l8 6.5z"/><line x1="6" y1="5.5" x2="6" y2="18.5"/>',
    stepFwd: '<path d="M8 5.5 16 12l-8 6.5z"/><line x1="18" y1="5.5" x2="18" y2="18.5"/>',
    plus: '<line x1="12" y1="5.5" x2="12" y2="18.5"/><line x1="5.5" y1="12" x2="18.5" y2="12"/>',
    minus: '<line x1="5.5" y1="12" x2="18.5" y2="12"/>',
    target: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.2"/>' +
            '<line x1="12" y1="2.5" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="21.5"/>' +
            '<line x1="2.5" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="21.5" y2="12"/>',
    expand: '<path d="M9 4H4v5"/><path d="M15 4h5v5"/><path d="M9 20H4v-5"/><path d="M15 20h5v-5"/>',
    flame: '<path d="M12 2.8c.4 2.6 2 3.7 3.2 5.2A6.6 6.6 0 0 1 16.8 12a4.8 4.8 0 0 1-9.6 0c0-1.6.6-2.9 1.5-3.9.2 1.3.9 2 1.6 2 .9 0 1.3-.9 1.1-2.2-.2-1.4-.6-2.7-.4-5.1z"/>',
    chevron: '<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>',
    clock: '<circle cx="12" cy="12" r="8.2"/><path d="M12 7.2V12l3.2 2"/>',
    logout: '<path d="M14.5 4.5H19a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-4.5"/>' +
            '<path d="M10 8.5 13.5 12 10 15.5"/><line x1="13.5" y1="12" x2="4" y2="12"/>',
    thermometer: '<path d="M14 13.6V5.2a2 2 0 1 0-4 0v8.4a4 4 0 1 0 4 0z"/>' +
                 '<line x1="12" y1="9" x2="12" y2="15"/>',
    sun: '<circle cx="12" cy="12" r="4"/><line x1="12" y1="2.5" x2="12" y2="5"/>' +
         '<line x1="12" y1="19" x2="12" y2="21.5"/><line x1="2.5" y1="12" x2="5" y2="12"/>' +
         '<line x1="19" y1="12" x2="21.5" y2="12"/><line x1="5.3" y1="5.3" x2="7" y2="7"/>' +
         '<line x1="17" y1="17" x2="18.7" y2="18.7"/><line x1="18.7" y1="5.3" x2="17" y2="7"/>' +
         '<line x1="7" y1="17" x2="5.3" y2="18.7"/>',
    sunset: '<path d="M4 18.5h16"/><path d="M7.5 14.5a4.5 4.5 0 0 1 9 0"/>' +
            '<line x1="12" y1="3" x2="12" y2="6"/><line x1="4.6" y1="7.6" x2="6.4" y2="9"/>' +
            '<line x1="19.4" y1="7.6" x2="17.6" y2="9"/><path d="m9.5 21 2.5-2.5 2.5 2.5"/>',
    moon: '<path d="M20 14.5A8.2 8.2 0 0 1 9.5 4 8.2 8.2 0 1 0 20 14.5z"/>',
    wind: '<path d="M3.5 8.5h10a2.6 2.6 0 1 0-2.6-2.6"/>' +
          '<path d="M3.5 12.5h13a2.6 2.6 0 1 1-2.6 2.6"/><path d="M3.5 16.5h6"/>',
    droplet: '<path d="M12 3.2c3 3.6 5 6.2 5 8.8a5 5 0 0 1-10 0c0-2.6 2-5.2 5-8.8z"/>',
    humidity: '<path d="M12 3.2c3 3.6 5 6.2 5 8.8a5 5 0 0 1-10 0c0-2.6 2-5.2 5-8.8z"/>' +
              '<path d="m9.6 14.4 4.8-4.8"/><circle cx="9.9" cy="10.1" r="0.9"/>' +
              '<circle cx="14.1" cy="14.3" r="0.9"/>',
    eye: '<path d="M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12z"/>' +
         '<circle cx="12" cy="12" r="3"/>',
    gauge: '<path d="M4.2 17a9 9 0 1 1 15.6 0"/><path d="m12 13 4-4"/><circle cx="12" cy="14" r="1.4"/>',
    aqi: '<path d="M3.5 8.5h11a2.5 2.5 0 1 0-2.5-2.5"/><path d="M3.5 13h14"/>' +
         '<path d="M3.5 17.5h9a2.5 2.5 0 1 1-2.5 2.5"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.4"/>' +
              '<line x1="3.5" y1="9.5" x2="20.5" y2="9.5"/><line x1="8" y1="3" x2="8" y2="6.5"/>' +
              '<line x1="16" y1="3" x2="16" y2="6.5"/>',
    radar: '<path d="M12 12 4.6 7.7A8.5 8.5 0 1 1 12 20.5"/><circle cx="12" cy="12" r="2.2"/>' +
           '<path d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5"/>',
    map: '<path d="M9 4.2 3.5 6.6v13.2L9 17.4l6 2.4 5.5-2.4V4.2L15 6.6z"/>' +
         '<line x1="9" y1="4.2" x2="9" y2="17.4"/><line x1="15" y1="6.6" x2="15" y2="19.8"/>',
    bot: '<rect x="4" y="8" width="16" height="11" rx="3"/><line x1="12" y1="4" x2="12" y2="8"/>' +
         '<circle cx="12" cy="3.2" r="1.3"/><circle cx="9" cy="13" r="1.2"/>' +
         '<circle cx="15" cy="13" r="1.2"/>',
    offline: '<path d="M5 12.5a5 5 0 0 1 6-4.4"/><path d="M8 16a2.6 2.6 0 0 1 2.6-1.6"/>' +
             '<line x1="3.5" y1="3.5" x2="20.5" y2="20.5"/><path d="M13.5 8.2a5.5 5.5 0 0 1 5 5.3"/>',
    hourglass: '<path d="M7 3.5h10"/><path d="M7 20.5h10"/>' +
               '<path d="M7.5 3.5c0 4 4.5 5.4 4.5 8.5s-4.5 4.5-4.5 8.5"/>' +
               '<path d="M16.5 3.5c0 4-4.5 5.4-4.5 8.5s4.5 4.5 4.5 8.5"/>',
  };

  /* Markup for an interface icon. Stroked, not filled, and coloured by
     whatever it sits inside. */
  function ui(name, { size = 18, label = '' } = {}) {
    const body = UI[name];
    if (!body) return '';
    const a11y = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"';
    return `<svg class="ui-icon" data-ui="${name}" viewBox="0 0 24 24" width="${size}"` +
      ` height="${size}" fill="none" stroke="currentColor" stroke-width="1.8"` +
      ` stroke-linecap="round" stroke-linejoin="round" focusable="false" ${a11y}>${body}</svg>`;
  }


  /* Static markup carries the name, not the picture: any element with
     data-ui-icon gets its icon filled in here. That keeps index.html
     readable and means an icon is defined in exactly one place. */
  function paintUI(root) {
    const scope = root || document;
    const hosts = scope.querySelectorAll ? scope.querySelectorAll('[data-ui-icon]') : [];
    hosts.forEach((el) => {
      const name = el.getAttribute('data-ui-icon');
      const size = Number(el.getAttribute('data-ui-size')) || 18;
      const first = el.firstElementChild;
      // Already painted at this size: leave it be, so repainting a
      // panel does not churn the DOM on every render.
      if (first && first.getAttribute('data-ui') === name &&
          first.getAttribute('width') === String(size)) return;
      el.innerHTML = ui(name, { size });
    });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => paintUI(document));
    } else {
      paintUI(document);
    }
  }

  return {
    markup, paint, emojiFor, nameFor, style, names: () => Object.keys(BODY),
    ui, paintUI, uiNames: () => Object.keys(UI),
  };
})();

window.WTWIcons = WTWIcons;
