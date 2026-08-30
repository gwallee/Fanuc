/* tiles.js — the detail tiles.

   Each tile is one fact: a header, a number big enough to read at
   arm's length, and a sentence saying what the number means. The
   sentence is the point. "UV index 6" tells you nothing you can act
   on; "use sun protection until 6PM" does.

   Everything here is derived from data the app already has — nothing
   is invented to fill a tile. Where a figure is genuinely unavailable
   the tile says so instead of showing a plausible-looking number.

   The small drawings (wind dial, sun arc, pressure gauge, moon disc)
   are canvas or SVG and carry no text of their own: the same fact is
   always available as words elsewhere in the tile, so nothing depends
   on being able to see them. */
const WTWTiles = (() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const U = () => window.WTWUnits;
  const TAU = Math.PI * 2;

  const setText = (id, value) => { const el = $(id); if (el) el.textContent = value; };

  /* ---------------- The sentences ---------------- */

  /* Apparent temperature is worth a word only when it disagrees with
     the real one. Saying "similar to the actual temperature" is the
     honest answer the rest of the time, and it is what people expect
     to read there. */
  function feelsNote(tempF, feelsF) {
    if (tempF == null || feelsF == null) return '';
    const gap = feelsF - tempF;
    if (Math.abs(gap) < 2) return 'Similar to the actual temperature.';
    const words = U() ? U().tempDelta(Math.abs(gap), { withUnit: true }) : `${Math.abs(Math.round(gap))}°`;
    if (gap > 0) return `Humidity is making it feel ${words} warmer.`;
    return `Wind is making it feel ${words} cooler.`;
  }

  const UV_BANDS = [
    { max: 2,  word: 'Low' },
    { max: 5,  word: 'Moderate' },
    { max: 7,  word: 'High' },
    { max: 10, word: 'Very high' },
    { max: Infinity, word: 'Extreme' },
  ];

  function uvBand(uv) {
    return UV_BANDS.find((b) => uv <= b.max) || UV_BANDS[UV_BANDS.length - 1];
  }

  /* "Until 6PM" is only true if the sun is still up then, so the hour
     comes from the actual sunset rather than a stock sentence. */
  function uvNote(uv, sunsetISO) {
    if (uv == null) return 'Not published for this location.';
    if (uv < 3) return 'Low risk of harm from unprotected sun exposure.';
    const set = sunsetISO ? new Date(sunsetISO) : null;
    if (!set || isNaN(set)) return 'Use sun protection.';
    // The burn risk falls off well before the sun is actually down.
    const until = new Date(set.getTime() - 2 * 3600000);
    return `Use sun protection until ${U() ? U().time(until) : ''}.`;
  }

  const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                   'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

  const compass = (deg) => COMPASS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];

  /* Meteorological convention: the direction is where the wind comes
     FROM. Getting this backwards is the classic weather-app bug, so it
     is spelled out in the sentence rather than left to an arrow. */
  function windNote(mph, deg) {
    if (mph == null) return '';
    if (mph < 1) return 'Still.';
    if (deg == null) return 'Direction unavailable.';
    return `From the ${compass(deg)}.`;
  }

  function visibilityNote(miles) {
    if (miles == null) return 'Not reported by this source.';
    // Compare against what the tile actually shows, not against the
    // raw figure: 16093 m is 9.99998 miles, displays as "10 mi", and a
    // strict >= 10 called a perfectly clear sky hazy.
    if (Math.round(miles) >= 10) return 'Perfectly clear view.';
    if (Math.round(miles) >= 5) return 'Slight haze in the distance.';
    if (miles >= 2) return 'Hazy — distant things are washed out.';
    if (miles >= 0.5) return 'Poor visibility. Take it slowly.';
    return 'Very poor visibility.';
  }

  /* The number above this is a probability, so the sentence must not
     imply an amount. Where the nowcast knows the next wet spell, that
     is far more useful than either. */
  function precipNote(prob, nowcastText) {
    if (nowcastText) return nowcastText;
    if (prob == null) return '';
    if (prob >= 70) return 'Rain is likely — take something waterproof.';
    if (prob >= 40) return 'Rain is a real possibility today.';
    if (prob >= 15) return 'A small chance of rain today.';
    return 'No rain expected today.';
  }

  /* ---------------- The drawings ---------------- */

  // Canvases are sized from their own box each time: a tile that was
  // hidden when the page loaded has no size until it is shown.
  function fit(canvas, heightRatio) {
    if (!canvas || !canvas.getContext) return null;
    const box = canvas.parentNode.getBoundingClientRect();
    const w = Math.max(40, Math.round(box.width));
    const h = Math.max(24, Math.round(w * heightRatio));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.style.height = h + 'px';
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  const ink = (name, fallback) => {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  };

  /* The sun's path across the day, with a dot at where it actually is.
     Below the horizon line the curve is dimmed rather than hidden, so
     the shape of the night is visible at 3am too. */
  function drawSunArc(sunriseISO, sunsetISO) {
    const box = fit($('sunArc'), 0.5);
    if (!box) return;
    const { ctx, w, h } = box;
    const rise = new Date(sunriseISO).getTime();
    const set = new Date(sunsetISO).getTime();
    if (!rise || !set || isNaN(rise) || isNaN(set) || set <= rise) return;

    const horizon = h * 0.68;
    const amp = h * 0.46;
    const at = (t) => {
      const x = t * w;
      // One full period across the panel, peaking at solar noon.
      const y = horizon - Math.sin(t * Math.PI) * amp;
      return [x, y];
    };

    ctx.lineWidth = 2;
    ctx.strokeStyle = ink('--text-dim', 'rgba(255,255,255,0.45)');
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    for (let i = 0; i <= 100; i++) {
      const [x, y] = at(i / 100);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // The horizon itself.
    ctx.beginPath();
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.3;
    ctx.moveTo(0, horizon);
    ctx.lineTo(w, horizon);
    ctx.stroke();
    ctx.globalAlpha = 1;

    const now = Date.now();
    const t = Math.min(1, Math.max(0, (now - rise) / (set - rise)));
    // Only mark the sun while it is actually up.
    if (now < rise || now > set) return;
    const [x, y] = at(t);
    ctx.fillStyle = ink('--accent', '#ffd76a');
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, TAU);
    ctx.fill();
  }

  /* A barometer face. The needle is the reading; the arrow underneath
     is the trend, and it is only drawn when a trend is actually known
     rather than guessed from a single reading. */
  function drawPressureDial(inHg, trend) {
    const box = fit($('pressureDial'), 0.62);
    if (!box || inHg == null) return;
    const { ctx, w, h } = box;
    const cx = w / 2, cy = h * 0.82, r = Math.min(w, h * 1.5) * 0.42;

    // 28.5–31.0 inHg covers everything short of a hurricane eye.
    const LOW = 28.5, HIGH = 31.0;
    const frac = Math.min(1, Math.max(0, (inHg - LOW) / (HIGH - LOW)));
    const start = Math.PI * 0.9, end = Math.PI * 2.1;

    ctx.strokeStyle = ink('--text-dim', 'rgba(255,255,255,0.5)');
    for (let i = 0; i <= 40; i++) {
      const a = start + (end - start) * (i / 40);
      const inner = r * 0.82, outer = r;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      ctx.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    const a = start + (end - start) * frac;
    ctx.strokeStyle = ink('--text', '#fff');
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r * 0.7, cy + Math.sin(a) * r * 0.7);
    ctx.lineTo(cx + Math.cos(a) * r * 1.02, cy + Math.sin(a) * r * 1.02);
    ctx.stroke();

    if (!trend) return;
    ctx.fillStyle = ink('--text', '#fff');
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(trend === 'rising' ? '↑' : (trend === 'falling' ? '↓' : '→'), cx, cy - r * 0.35);
  }

  /* The lit fraction of the disc.

     Drawn a scanline at a time rather than as two arcs with a
     terminator ellipse: the arc version needs four sweep flags to
     agree, and getting one of them backwards renders a 96%-lit moon
     as a thin crescent — which looked plausible enough to ship and
     was exactly wrong.

     Per row, the disc runs from -hw to +hw. The terminator sits at
     (1 - 2f)·hw, so f=1 puts it at -hw (fully lit), f=0.5 at the
     centre (half), f=0 at +hw (dark). Waning mirrors it. That is one
     line of arithmetic, and it is checkable by eye at both ends. */
  function drawMoon(illumination, waxing) {
    const box = fit($('moonDisc'), 1);
    if (!box) return;
    const { ctx, w, h } = box;
    const r = Math.min(w, h) * 0.44;
    const cx = w / 2, cy = h / 2;
    const f = Math.min(1, Math.max(0, illumination));

    // The unlit face, so a new moon is a disc rather than nothing.
    ctx.fillStyle = 'rgba(12, 22, 42, 0.55)';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.clip();

    const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
    g.addColorStop(0, '#f4f7ff');
    g.addColorStop(1, '#c3cfe8');
    ctx.fillStyle = g;

    const step = 0.5;
    for (let y = -r; y <= r; y += step) {
      const hw = Math.sqrt(Math.max(0, r * r - y * y));
      const term = (1 - 2 * f) * hw;
      let x0, x1;
      if (waxing) { x0 = term; x1 = hw; }      // lit on the right
      else { x0 = -hw; x1 = -term; }           // lit on the left
      if (x1 <= x0) continue;
      ctx.fillRect(cx + x0, cy + y, x1 - x0, step + 0.5);
    }

    // A few maria so it reads as the moon rather than a lamp.
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = '#5b6b8c';
    const spots = [[-0.28, -0.22, 0.24], [0.22, -0.05, 0.18],
                   [-0.1, 0.3, 0.2], [0.34, 0.3, 0.13]];
    for (const [dx, dy, sr] of spots) {
      ctx.beginPath();
      ctx.arc(cx + dx * r, cy + dy * r, sr * r, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }


  /* ---------------- The hour row ---------------- */

  /* The next few hours as a row, the way people actually read a
     forecast: what it is now, then each hour, with sunrise and sunset
     dropped in at the hour they happen rather than left to be
     inferred from a chart's shading.

     Built as a list because that is what it is — a screen reader
     hears "6 PM, clear, 94 degrees" and not a run of loose numbers. */
  function renderHours(hours, daily) {
    const host = $('hourStrip');
    if (!host) return;
    host.innerHTML = '';
    if (!Array.isArray(hours) || !hours.length) return;

    const time = (d) => (U() ? U().time(d) : '');
    const temp = (f) => (U() ? U().temp(f) : `${Math.round(f)}°`);

    // Sun events inside the window shown, so they can be slotted in.
    const first = hours[0].time.getTime();
    const last = hours[hours.length - 1].time.getTime();
    const events = [];
    (daily || []).forEach((day) => {
      [['sunrise', day.sunrise], ['sunset', day.sunset]].forEach(([kind, iso]) => {
        if (!iso) return;
        const at = new Date(iso).getTime();
        if (at >= first && at <= last) events.push({ kind, at });
      });
    });
    events.sort((a, b) => a.at - b.at);

    const cell = (label, art, value, extra) => {
      const li = document.createElement('li');
      li.className = 'hour-cell' + (extra ? ' ' + extra : '');
      li.innerHTML = `<span class="hour-label">${label}</span>` +
        `<span class="hour-art">${art}</span>` +
        `<span class="hour-temp">${value}</span>`;
      return li;
    };

    let e = 0;
    hours.forEach((h, i) => {
      // Any sun event before this hour goes in first, in order.
      while (e < events.length && events[e].at < h.time.getTime()) {
        const ev = events[e++];
        host.appendChild(cell(
          time(new Date(ev.at)),
          window.WTWIcons ? WTWIcons.ui(ev.kind === 'sunrise' ? 'sun' : 'sunset', { size: 24 }) : '',
          ev.kind === 'sunrise' ? 'Sunrise' : 'Sunset',
          'hour-event'));
      }
      const art = window.WTWIcons
        ? WTWIcons.markup(h.code, { isDay: isDaylight(h.time, daily), size: 28 })
        : '';
      const li = cell(i === 0 ? 'Now' : time(h.time), art, temp(h.tempF), i === 0 ? 'hour-now' : '');
      // Rain worth knowing about is worth showing; a 5% chance is not.
      if (h.precipProb != null && h.precipProb >= 20) {
        const p = document.createElement('span');
        p.className = 'hour-pop';
        p.textContent = `${Math.round(h.precipProb)}%`;
        li.insertBefore(p, li.querySelector('.hour-temp'));
      }
      li.setAttribute('aria-label',
        `${i === 0 ? 'Now' : time(h.time)}, ${temp(h.tempF)}` +
        (h.precipProb != null ? `, ${Math.round(h.precipProb)}% chance of rain` : ''));
      host.appendChild(li);
    });
  }

  /* Whether a given hour is in daylight, so the row shows a moon at
     2am rather than a sun.

     One rule: the hour is daylight if some day's sunrise..sunset
     bracket contains it. Anything else is night — and if the forecast
     gave no sun times at all, the honest answer is "assume day"
     rather than turning every icon into a moon. */
  function isDaylight(when, daily) {
    const at = when.getTime();
    let known = false;
    for (const day of daily || []) {
      if (!day.sunrise || !day.sunset) continue;
      known = true;
      const rise = new Date(day.sunrise).getTime();
      const set = new Date(day.sunset).getTime();
      if (at >= rise && at <= set) return true;
    }
    return !known;
  }

  /* The AQI headline, on the published 0–300+ scale. The bar is the
     scale, not a decoration: a dot two-thirds along means something
     the number alone does not. */
  function renderAqi(air) {
    const tile = $('aqiTile');
    if (!tile || !window.WTWAir) return;
    const value = air && air.aqi != null ? air.aqi : null;
    if (value == null) { tile.hidden = true; return; }
    tile.hidden = false;
    const cat = WTWAir.aqiCategory(value);
    const badge = $('aqiBadge');
    if (badge) {
      badge.textContent = String(Math.round(value));
      badge.className = `aqi-badge ${cat.className}`;
    }
    setText('aqiLabel', cat.label);
    setText('aqiAdvice', cat.advice);
    const dot = $('aqiDot');
    if (dot) {
      // 0–300 covers Good through Hazardous; beyond that it pins.
      dot.style.left = `${Math.min(100, (value / 300) * 100)}%`;
      dot.hidden = false;
    }
  }

  /* ---------------- Putting it together ---------------- */

  function render(view) {
    const w = (view && view.weather) || {};
    const d = (view && view.detail) || {};

    setText('feelsNote', feelsNote(w.tempF, w.feelsLikeF));

    const uv = d.uvIndex;
    const band = uv == null ? null : uvBand(uv);
    setText('uvWord', band ? band.word : '');
    setText('uvNote', uvNote(uv, d.sunset));
    const dot = $('uvDot');
    if (dot) {
      // The bar runs 0–11+, which is where the published scale tops out.
      dot.style.left = uv == null ? '0%' : `${Math.min(100, (uv / 11) * 100)}%`;
      dot.hidden = uv == null;
    }

    setText('hiLoNote', 'Tap for the 7-day temperature trend.');
    setText('windNote', windNote(w.windMph, w.windDirDeg));
    const arrow = $('windArrow');
    // The arrow points the way the wind is going, which is the
    // opposite of the direction it is named for.
    if (arrow && w.windDirDeg != null) {
      arrow.setAttribute('transform', `rotate(${(w.windDirDeg + 180) % 360} 50 50)`);
    }

    setText('precipNote', precipNote(w.precipProb, view && view.nowcastText));
    setText('visibilityNote', visibilityNote(d.visibilityMi));

    drawSunArc(d.sunrise, d.sunset);
    drawPressureDial(d.pressureInHg, view && view.pressureTrend);

    renderHours(view && view.hours, view && view.daily);
    renderAqi(view && view.air);

    if (window.WTWAir) {
      const moon = WTWAir.moonPhase(new Date());
      const tile = $('moonTile');
      if (tile) tile.hidden = false;
      setText('moonName', moon.name);
      setText('moonIllum', `${Math.round(moon.illumination * 100)}% lit`);
      setText('moonPhaseAge', `${Math.round(moon.ageDays)} days`);
      setText('moonNextFull', moon.nextFullDays == null
        ? '--' : `${moon.nextFullDays} days`);
      drawMoon(moon.illumination, moon.waxing !== false);
    }
  }

  return { render, renderHours, renderAqi, isDaylight,
           feelsNote, uvBand, uvNote, windNote, visibilityNote,
           precipNote, compass, drawSunArc, drawPressureDial, drawMoon };
})();

window.WTWTiles = WTWTiles;
