/* metricsheet.js — every tile opens.

   A tile shows one number. That number almost always has a shape over
   the day — the UV index peaks at noon, wind picks up in the
   afternoon, humidity falls as the temperature climbs — and the shape
   is usually the thing worth knowing. So each tile opens a sheet with
   that metric charted across the day, and a sentence saying what the
   shape means.

   Three rules the chart follows, because each of them is a way this
   kind of thing quietly lies:

     - What has happened and what is forecast are drawn differently.
       Past hours are dashed, future hours solid, with a marker at
       now. A single continuous line presents a model's guess and a
       recorded observation as the same kind of fact.
     - The axis is labelled with real values and real hours. A pretty
       curve with no scale is decoration.
     - A metric with no data draws nothing and says so. An empty chart
       area with axes is an invitation to read meaning into blank
       space.

   The sheet is generic: a metric is a definition — where its numbers
   come from, how to format them, what to say about them — and adding
   one is an entry in METRICS, not a new panel. */
const WTWMetricSheet = (() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const U = () => window.WTWUnits;

  let current = null;          // the metric key on screen
  let dayOffset = 0;           // 0 = today, 1 = tomorrow …
  let view = null;             // the app state handed in at open time

  /* ---------------- Metric definitions ---------------- */

  /* Each metric says how to get its hourly series out of the raw
     Open-Meteo arrays, how to write one of its values, and how to
     summarise a day of them. Nothing here reaches into app state
     directly, so a metric is testable on its own. */
  const METRICS = {
    conditions: {
      title: 'Conditions',
      icon: 'thermometer',
      series: 'temperature_2m',
      alt: { key: 'apparent_temperature', label: 'Feels Like', main: 'Actual' },
      format: (v) => (U() ? U().temp(v) : `${Math.round(v)}°`),
      axis: (v) => (U() ? U().temp(v) : `${Math.round(v)}°`),
      band: null,
      summary: (stats) => stats.count
        ? `High of ${stats.maxText} and a low of ${stats.minText}.`
        : '',
    },
    uv: {
      title: 'UV Index',
      icon: 'sun',
      series: 'uv_index',
      floorAtZero: true,

      format: (v) => String(Math.round(v)),
      axis: (v) => String(Math.round(v)),
      // The published WHO bands, so the chart's background says what
      // the number means without a legend.
      band: [
        { upTo: 2, label: 'Low', color: 'rgba(74, 222, 128, 0.30)' },
        { upTo: 5, label: 'Moderate', color: 'rgba(250, 204, 21, 0.30)' },
        { upTo: 7, label: 'High', color: 'rgba(251, 146, 60, 0.30)' },
        { upTo: 10, label: 'Very high', color: 'rgba(239, 68, 68, 0.30)' },
        { upTo: Infinity, label: 'Extreme', color: 'rgba(217, 70, 239, 0.30)' },
      ],
      summary: (stats, ctx) => {
        if (!stats.count) return '';
        if (stats.max < 3) return 'Low risk from unprotected sun exposure all day.';
        const window = ctx.crossing(3);
        const peak = `The peak UV index today is ${Math.round(stats.max)}.`;
        return window
          ? `${peak} Levels of Moderate or higher are reached from ` +
            `${window.from} to ${window.to}.`
          : peak;
      },
    },
    wind: {
      title: 'Wind',
      icon: 'wind',
      series: 'wind_speed_10m',
      floorAtZero: true,
      alt: { key: 'wind_gusts_10m', label: 'Gusts', main: 'Wind' },
      arrows: 'wind_direction_10m',
      format: (v) => (U() ? U().speed(v) : `${Math.round(v)} mph`),
      axis: (v) => String(Math.round(U() && U().isMetric() ? v * 1.60934 : v)),
      band: null,
      summary: (stats, ctx) => {
        if (!stats.count) return '';
        const gusts = ctx.altStats;
        const base = `Wind speeds are ${stats.minText} to ${stats.maxText}`;
        return gusts && gusts.count
          ? `${base}, with gusts up to ${gusts.maxText}.`
          : `${base}.`;
      },
    },
    precip: {
      title: 'Chance of Precipitation',
      icon: 'droplet',
      series: 'precipitation_probability',
      floorAtZero: true,

      format: (v) => `${Math.round(v)}%`,
      axis: (v) => `${Math.round(v)}%`,
      fixedMax: 100,
      band: null,
      summary: (stats) => {
        if (!stats.count) return '';
        if (stats.max < 5) return 'No meaningful chance of rain on this day.';
        return `The chance peaks at ${Math.round(stats.max)}% around ${stats.maxAtText}.`;
      },
    },
    humidity: {
      title: 'Humidity',
      icon: 'humidity',
      series: 'relative_humidity_2m',
      floorAtZero: true,

      format: (v) => `${Math.round(v)}%`,
      axis: (v) => `${Math.round(v)}%`,
      fixedMax: 100,
      band: null,
      summary: (stats) => stats.count
        ? `Humidity runs from ${Math.round(stats.min)}% to ${Math.round(stats.max)}%, ` +
          `highest around ${stats.maxAtText}.`
        : '',
    },
    visibility: {
      title: 'Visibility',
      icon: 'eye',
      series: 'visibility',
      floorAtZero: true,

      // Open-Meteo reports metres; the app's canonical unit is miles.
      transform: (v) => v * 0.000621371,
      format: (v) => (U() ? U().distance(v) : `${Math.round(v)} mi`),
      axis: (v) => String(Math.round(U() && U().isMetric() ? v * 1.60934 : v)),
      band: null,
      summary: (stats) => stats.count
        ? `Visibility ranges from ${stats.minText} to ${stats.maxText}.`
        : '',
    },
    pressure: {
      title: 'Pressure',
      icon: 'gauge',
      series: 'pressure_msl',
      transform: (v) => v * 0.02953,
      format: (v) => (U() ? U().pressure(v) : `${v.toFixed(2)} in`),
      axis: (v) => (U() && U().isMetric() ? String(Math.round(v * 33.8639))
                                          : v.toFixed(2)),
      band: null,
      summary: (stats) => stats.count
        ? `Pressure moves between ${stats.minText} and ${stats.maxText} on this day.`
        : '',
    },
  };


  /* ============================================================
     Sheets with no curve

     Not every tile has an hourly series. The sun's times, the moon's
     phase, the air's pollutants and the climate average are facts
     about a day, not a shape across one — so they open the same sheet
     with a table instead of a chart. Same chrome, same date strip,
     same close; only the middle differs.
     ============================================================ */
  const TABLES = {
    sun: {
      title: 'Sun',
      icon: 'sunset',
      rows(view, dateISO, offset) {
        const day = ((view && view.daily) || [])[offset];
        if (!day || !day.sunrise || !day.sunset) return null;
        const sun = window.WTWAir ? WTWAir.sunSummary(day.sunrise, day.sunset) : null;
        const time = (v) => (U() ? U().time(v) : '');
        const out = [
          ['Sunrise', time(day.sunrise)],
          ['Sunset', time(day.sunset)],
        ];
        if (sun) {
          out.push(['Daylight', U() ? U().duration(sun.daylightMinutes) : '']);
          out.push(['Solar noon', time(sun.solarNoon)]);
        }
        return out;
      },
      headline(view, dateISO, offset) {
        const day = ((view && view.daily) || [])[offset];
        return day && day.sunset
          ? { value: U() ? U().time(day.sunset) : '', sub: 'Sunset' } : null;
      },
      /* Day length against the day before is the fact people actually
         want from a sun panel in spring and autumn, and it is exact
         arithmetic on two figures already published. */
      summary(view, dateISO, offset) {
        const daily = (view && view.daily) || [];
        const day = daily[offset];
        /* The day before today is not daily[-1]: the forecast array
           starts at today, and yesterday is carried separately. So on
           the first day the comparison comes from there, and if that
           is missing there is simply nothing to compare. */
        const prev = offset > 0 ? daily[offset - 1] : (view && view.yesterday);
        if (!day || !prev || !prev.sunrise || !prev.sunset || !window.WTWAir) return '';
        const a = WTWAir.sunSummary(day.sunrise, day.sunset);
        const b = WTWAir.sunSummary(prev.sunrise, prev.sunset);
        if (!a || !b) return '';
        const delta = Math.round(a.daylightMinutes - b.daylightMinutes);
        if (delta === 0) return 'The same length of day as yesterday.';
        const mins = Math.abs(delta);
        return `${mins} minute${mins === 1 ? '' : 's'} ` +
          `${delta > 0 ? 'more' : 'less'} daylight than the day before.`;
      },
    },

    moon: {
      title: 'Moon',
      icon: 'moon',
      rows(view, dateISO) {
        if (!window.WTWAir) return null;
        const moon = WTWAir.moonPhase(new Date(dateISO + 'T12:00:00'));
        return [
          ['Phase', moon.name],
          ['Illumination', `${Math.round(moon.illumination * 100)}%`],
          ['Moon age', `${Math.round(moon.ageDays)} days`],
          ['Next full moon', moon.nextFullDays == null ? '--' : `${moon.nextFullDays} days`],
        ];
      },
      headline(view, dateISO) {
        if (!window.WTWAir) return null;
        const moon = WTWAir.moonPhase(new Date(dateISO + 'T12:00:00'));
        return { value: `${Math.round(moon.illumination * 100)}%`, sub: moon.name };
      },
      summary() {
        /* Moonrise and moonset are not published by any of the free
           sources this app uses, and computing them properly is real
           astronomy. Saying so is better than a figure that looks
           authoritative and is half an hour out. */
        return 'Phase and illumination are computed from the lunar cycle. ' +
          'Moonrise and moonset are not published by this app\'s sources.';
      },
    },

    aqi: {
      title: 'Air Quality',
      icon: 'aqi',
      rows(view) {
        const air = view && view.air;
        if (!air || air.aqi == null) return null;
        const µ = (v) => (v == null ? '--' : `${Math.round(v)} µg/m³`);
        const rows = [
          ['PM2.5', µ(air.pm25)],
          ['PM10', µ(air.pm10)],
          ['Ozone', µ(air.ozone)],
          ['Nitrogen dioxide', µ(air.no2)],
        ];
        const pollen = window.WTWAir ? WTWAir.pollenSummary(air.pollen) : null;
        if (pollen) rows.push(['Pollen', `${pollen.level.label} · ${pollen.name}`]);
        return rows;
      },
      headline(view) {
        const air = view && view.air;
        if (!air || air.aqi == null) return null;
        const cat = window.WTWAir ? WTWAir.aqiCategory(air.aqi) : { label: '' };
        return { value: String(Math.round(air.aqi)), sub: cat.label };
      },
      summary(view) {
        const air = view && view.air;
        if (!air || air.aqi == null) return '';
        const cat = window.WTWAir ? WTWAir.aqiCategory(air.aqi) : { advice: '' };
        return cat.advice;
      },
      // Air quality is a reading now, not a figure per day.
      noDates: true,
    },

    averages: {
      title: 'Averages',
      icon: 'chart',
      rows(view) {
        const normal = view && view.normal;
        const w = view && view.weather;
        if (!normal || normal.highF == null || !w) return null;
        const t = (v) => (U() ? U().temp(v) : `${Math.round(v)}°`);
        const rows = [
          ["Today's high", t(w.highF)],
          ['Average high', t(normal.highF)],
        ];
        if (normal.lowF != null) {
          rows.push(["Today's low", t(w.lowF)]);
          rows.push(['Average low', t(normal.lowF)]);
        }
        rows.push(['Years averaged', `${normal.years} (${normal.firstYear}–${normal.lastYear})`]);
        return rows;
      },
      headline(view) {
        const normal = view && view.normal;
        const w = view && view.weather;
        if (!normal || normal.highF == null || !w || w.highF == null) return null;
        const gap = w.highF - normal.highF;
        const rounded = Math.round(gap);
        const sign = rounded > 0 ? '+' : (rounded < 0 ? '−' : '');
        const size = U() ? U().tempDelta(Math.abs(gap), { withUnit: false }) : `${Math.abs(rounded)}°`;
        return { value: `${sign}${size}`,
                 sub: rounded === 0 ? 'right on the average'
                   : (rounded > 0 ? 'above the average high' : 'below the average high') };
      },
      summary() {
        return 'Averaged from the Open-Meteo historical archive for this calendar ' +
          'date. Not the 30-year WMO normal.';
      },
      noDates: true,
    },
  };

  /* ---------------- Pulling a day out of the series ---------------- */

  /* The raw arrays hold several days back to back. This takes the
     hours belonging to one calendar date, in the location's own
     reporting, and keeps the index so a value can be matched to its
     hour. */
  function seriesForDay(raw, key, dateISO, transform) {
    if (!raw || !Array.isArray(raw.time) || !Array.isArray(raw[key])) return [];
    const out = [];
    raw.time.forEach((iso, i) => {
      if (String(iso).slice(0, 10) !== dateISO) return;
      let value = raw[key][i];
      if (value == null) return;
      if (transform) value = transform(value);
      out.push({ time: new Date(iso), value });
    });
    return out;
  }

  function statsOf(points, format) {
    if (!points.length) return { count: 0 };
    let min = points[0], max = points[0];
    for (const p of points) {
      if (p.value < min.value) min = p;
      if (p.value > max.value) max = p;
    }
    const time = (d) => (U() ? U().time(d) : '');
    return {
      count: points.length,
      min: min.value, max: max.value,
      minText: format(min.value), maxText: format(max.value),
      minAtText: time(min.time), maxAtText: time(max.time),
    };
  }

  /* The first and last hour a metric is at or above a threshold —
     what "Moderate or higher from 10AM to 6PM" is actually saying. */
  function crossing(points, threshold) {
    const above = points.filter((p) => p.value >= threshold);
    if (!above.length) return null;
    const time = (d) => (U() ? U().time(d) : '');
    return { from: time(above[0].time), to: time(above[above.length - 1].time) };
  }

  /* ---------------- Drawing ---------------- */

  function fit(canvas, height) {
    const box = canvas.parentNode.getBoundingClientRect();
    const w = Math.max(200, Math.round(box.width));
    const h = height;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const nextW = Math.round(w * dpr);
    const nextH = Math.round(h * dpr);
    // Same reason as the tiles: assigning either dimension reallocates
    // and clears, so only do it when the size really changed.
    if (canvas.width !== nextW || canvas.height !== nextH) {
      canvas.style.height = h + 'px';
      canvas.width = nextW;
      canvas.height = nextH;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  // Read once per paint, not once per colour: see tiles.js.
  let inkCache = null;
  function ink(name, fallback) {
    if (!inkCache) {
      inkCache = getComputedStyle(document.documentElement);
      Promise.resolve().then(() => { inkCache = null; });
    }
    return inkCache.getPropertyValue(name).trim() || fallback;
  }

  function drawChart(canvas, metric, points, altPoints, arrows) {
    if (!canvas || !canvas.getContext) return false;
    const { ctx, w, h } = fit(canvas, 210);
    if (!points.length) return false;

    // Left padding has to clear half of the "12AM" label, or the
    // first hour reads as "2AM" — which is not a cosmetic problem
    // either, since it is a wrong number on an axis.
    const padL = 20, padR = 52, padT = arrows ? 26 : 14, padB = 26;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    const all = points.concat(altPoints || []);
    let lo = Math.min(...all.map((p) => p.value));
    let hi = metric.fixedMax != null ? metric.fixedMax : Math.max(...all.map((p) => p.value));
    if (metric.fixedMax != null) lo = 0;
    if (hi - lo < 1e-6) { hi = lo + 1; }
    const room = (hi - lo) * 0.12;
    lo -= room; hi += room;
    /* A UV index of −1, or −3% humidity, is not a small cosmetic
       problem: it is an axis asserting a value the metric cannot
       take. Anything measured from zero is clamped there. */
    if (metric.floorAtZero && lo < 0) lo = 0;
    if (metric.fixedMax != null && hi > metric.fixedMax) hi = metric.fixedMax;

    const startMs = new Date(points[0].time).setHours(0, 0, 0, 0);
    const spanMs = 24 * 3600000;
    const xOf = (t) => padL + ((t.getTime() - startMs) / spanMs) * plotW;
    const yOf = (v) => padT + plotH - ((v - lo) / (hi - lo)) * plotH;

    const dim = ink('--text-dim', 'rgba(255,255,255,0.7)');
    const text = ink('--text', '#fff');

    // Bands behind everything, where the metric has published ones.
    if (metric.band) {
      let from = lo;
      for (const band of metric.band) {
        const to = Math.min(band.upTo, hi);
        if (to <= from) { from = band.upTo; continue; }
        ctx.fillStyle = band.color;
        ctx.fillRect(padL, yOf(to), plotW, yOf(from) - yOf(to));
        ctx.fillStyle = dim;
        ctx.font = '10px system-ui, sans-serif';
        ctx.textAlign = 'left';
        if (yOf(from) - yOf(to) > 13) ctx.fillText(band.label, padL + 4, yOf(to) + 11);
        from = band.upTo;
        if (from >= hi) break;
      }
    }

    // Gridlines and the value axis on the right, as Apple's are.
    ctx.strokeStyle = dim;
    ctx.globalAlpha = 0.18;
    ctx.lineWidth = 1;
    ctx.fillStyle = dim;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    for (let i = 0; i <= 4; i++) {
      const v = lo + ((hi - lo) * i) / 4;
      const y = yOf(v);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + plotW, y);
      ctx.stroke();
      ctx.globalAlpha = 0.85;
      ctx.fillText(metric.axis(v), padL + plotW + 6, y + 4);
      ctx.globalAlpha = 0.18;
    }
    ctx.globalAlpha = 1;

    // Hour labels along the bottom.
    ctx.fillStyle = dim;
    ctx.textAlign = 'center';
    ctx.font = '10px system-ui, sans-serif';
    [0, 6, 12, 18].forEach((hour) => {
      const at = new Date(startMs + hour * 3600000);
      const x = xOf(at);
      ctx.fillText(U() ? U().hourLabel(at) : `${hour}:00`, x, h - 8);
    });

    const now = Date.now();

    /* One pass per style. The split is the whole point: a dashed
       past and a solid future say "this happened" and "this is a
       guess", which one continuous line does not. */
    const stroke = (pts, { dashed, colour, width, fill }) => {
      if (pts.length < 2) return;
      ctx.save();
      ctx.setLineDash(dashed ? [4, 4] : []);
      ctx.strokeStyle = colour;
      ctx.lineWidth = width;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      pts.forEach((p, i) => {
        const x = xOf(p.time), y = yOf(p.value);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.stroke();
      if (fill) {
        ctx.lineTo(xOf(pts[pts.length - 1].time), padT + plotH);
        ctx.lineTo(xOf(pts[0].time), padT + plotH);
        ctx.closePath();
        const g = ctx.createLinearGradient(0, padT, 0, padT + plotH);
        g.addColorStop(0, fill.replace('ALPHA', '0.35'));
        g.addColorStop(1, fill.replace('ALPHA', '0.02'));
        ctx.fillStyle = g;
        ctx.fill();
      }
      ctx.restore();
    };

    const past = points.filter((p) => p.time.getTime() <= now);
    const future = points.filter((p) => p.time.getTime() >= now);
    const accent = ink('--accent', '#00e08a');

    if (altPoints && altPoints.length) {
      const aPast = altPoints.filter((p) => p.time.getTime() <= now);
      const aFuture = altPoints.filter((p) => p.time.getTime() >= now);
      const alt = ink('--accent-2', '#00b3ff');
      stroke(aPast, { dashed: true, colour: alt, width: 1.6 });
      stroke(aFuture, { dashed: false, colour: alt, width: 1.6 });
    }

    stroke(past, { dashed: true, colour: accent, width: 2.4 });
    stroke(future, { dashed: false, colour: accent, width: 2.4,
                     fill: 'rgba(255, 170, 60, ALPHA)' });

    // Where now is, when now is inside this day.
    if (now >= startMs && now <= startMs + spanMs) {
      const x = padL + ((now - startMs) / spanMs) * plotW;
      ctx.strokeStyle = text;
      ctx.globalAlpha = 0.35;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + plotH);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      const atNow = points.reduce((best, p) =>
        Math.abs(p.time - now) < Math.abs(best.time - now) ? p : best, points[0]);
      ctx.fillStyle = text;
      ctx.beginPath();
      ctx.arc(x, yOf(atNow.value), 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Wind gets direction arrows along the top, which is the part a
    // speed chart alone cannot tell you.
    if (arrows && arrows.length) {
      ctx.strokeStyle = dim;
      ctx.lineWidth = 1.4;
      ctx.lineCap = 'round';
      arrows.forEach((p, i) => {
        if (i % 2) return;                       // every other hour
        const x = xOf(p.time);
        if (x < padL || x > padL + plotW) return;
        const y = 12;
        // Meteorological: the value is where the wind comes FROM, so
        // the arrow points the opposite way, where it is going.
        const a = ((p.value + 180) % 360) * Math.PI / 180;
        const dx = Math.sin(a) * 5, dy = -Math.cos(a) * 5;
        ctx.beginPath();
        ctx.moveTo(x - dx, y - dy);
        ctx.lineTo(x + dx, y + dy);
        ctx.moveTo(x + dx, y + dy);
        ctx.lineTo(x + dx - dx * 0.6 - dy * 0.4, y + dy - dy * 0.6 + dx * 0.4);
        ctx.moveTo(x + dx, y + dy);
        ctx.lineTo(x + dx - dx * 0.6 + dy * 0.4, y + dy - dy * 0.6 - dx * 0.4);
        ctx.stroke();
      });
    }
    return true;
  }

  /* ---------------- The sheet ---------------- */

  function dateForOffset(offset) {
    const daily = (view && view.daily) || [];
    const day = daily[offset];
    if (day && day.dateISO) return day.dateISO;
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
  }

  /* The strip of dates across the top. Seven days, the open one
     marked, each one a button — the sheet is per-day, so moving
     between days has to be possible without closing it. */
  function renderDateStrip() {
    const host = $('sheetDates');
    if (!host) return;
    const daily = (view && view.daily) || [];
    host.innerHTML = '';
    daily.slice(0, 7).forEach((day, i) => {
      const at = new Date(day.dateISO + 'T12:00:00');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sheet-date' + (i === dayOffset ? ' picked' : '');
      btn.setAttribute('aria-pressed', String(i === dayOffset));
      btn.innerHTML =
        `<span class="sheet-dow">${at.toLocaleDateString([], { weekday: 'narrow' })}</span>` +
        `<span class="sheet-dom">${at.getDate()}</span>`;
      btn.setAttribute('aria-label', at.toLocaleDateString([],
        { weekday: 'long', month: 'long', day: 'numeric' }));
      btn.addEventListener('click', () => { dayOffset = i; paint(); });
      host.appendChild(btn);
    });
  }

  function paintTable() {
    const table = TABLES[current];
    const dateISO = dateForOffset(dayOffset);
    $('sheetTitle').innerHTML =
      (window.WTWIcons ? WTWIcons.ui(table.icon, { size: 18 }) : '') +
      `<span>${table.title}</span>`;
    const at = new Date(dateISO + 'T12:00:00');
    $('sheetDate').textContent = table.noDates ? 'Right now'
      : at.toLocaleDateString([], { weekday: 'long', month: 'long',
                                    day: 'numeric', year: 'numeric' });

    const dates = $('sheetDates');
    if (dates) {
      // A reading that is not per-day gets no date strip: offering to
      // change a day that changes nothing is a lie about the data.
      dates.hidden = !!table.noDates;
      if (!table.noDates) renderDateStrip();
    }

    const head = table.headline(view, dateISO, dayOffset);
    $('sheetValue').textContent = head ? head.value : '--';
    $('sheetSub').textContent = head ? head.sub : '';
    const legend = $('sheetLegend');
    if (legend) legend.hidden = true;

    const rows = table.rows(view, dateISO, dayOffset);
    const chart = $('sheetChart');
    if (chart) chart.hidden = true;
    const list = $('sheetRows');
    if (list) {
      list.innerHTML = '';
      list.hidden = !rows;
      (rows || []).forEach(([label, value]) => {
        const row = document.createElement('div');
        row.innerHTML = `<dt>${label}</dt><dd>${value}</dd>`;
        list.appendChild(row);
      });
    }
    const empty = $('sheetEmpty');
    if (empty) {
      empty.hidden = !!rows;
      empty.textContent = rows ? '' : 'Nothing published for this day.';
    }
    $('sheetSummary').textContent = rows ? table.summary(view, dateISO, dayOffset) : '';
  }

  function paint() {
    if (TABLES[current]) { paintTable(); return; }
    const metric = METRICS[current];
    if (!metric) return;
    const list = $('sheetRows');
    if (list) list.hidden = true;
    const dates = $('sheetDates');
    if (dates) dates.hidden = false;
    const raw = view && view.hourlyRaw;
    const dateISO = dateForOffset(dayOffset);

    $('sheetTitle').innerHTML =
      (window.WTWIcons ? WTWIcons.ui(metric.icon, { size: 18 }) : '') +
      `<span>${metric.title}</span>`;
    const at = new Date(dateISO + 'T12:00:00');
    $('sheetDate').textContent = at.toLocaleDateString([],
      { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    renderDateStrip();

    const points = seriesForDay(raw, metric.series, dateISO, metric.transform);
    const altPoints = metric.alt
      ? seriesForDay(raw, metric.alt.key, dateISO, metric.transform) : [];
    const arrows = metric.arrows
      ? seriesForDay(raw, metric.arrows, dateISO, null) : [];

    const stats = statsOf(points, metric.format);
    const altStats = statsOf(altPoints, metric.format);

    // The headline: what it is now on today, the day's peak otherwise.
    const isToday = dayOffset === 0;
    const now = Date.now();
    const headline = isToday && points.length
      ? points.reduce((best, p) =>
          Math.abs(p.time - now) < Math.abs(best.time - now) ? p : best, points[0])
      : null;
    $('sheetValue').textContent = headline ? metric.format(headline.value)
      : (stats.count ? stats.maxText : '--');
    $('sheetSub').textContent = headline
      ? `Now, ${U() ? U().time(headline.time) : ''}`
      : (stats.count ? `High for the day` : '');

    const legend = $('sheetLegend');
    if (legend) {
      legend.hidden = !metric.alt || !altPoints.length;
      if (!legend.hidden) {
        legend.innerHTML =
          `<span class="sheet-key sheet-key-main">${metric.alt.main}</span>` +
          `<span class="sheet-key sheet-key-alt">${metric.alt.label}</span>`;
      }
    }

    const drew = drawChart($('sheetChart'), metric, points, altPoints, arrows);
    const empty = $('sheetEmpty');
    if (empty) {
      // An axis drawn over no data invites reading meaning into blank
      // space, so nothing is drawn at all and the reason is given.
      empty.hidden = drew;
      empty.textContent = drew ? '' :
        'No hour-by-hour data published for this day.';
    }
    $('sheetChart').hidden = !drew;

    const ctx = { altStats, crossing: (t) => crossing(points, t) };
    $('sheetSummary').textContent = drew ? metric.summary(stats, ctx) : '';
  }

  function open(key, state) {
    if (!METRICS[key] && !TABLES[key]) return;
    current = key;
    dayOffset = 0;
    view = state;
    const modal = $('metricSheet');
    const overlay = $('metricSheetOverlay');
    if (!modal || !overlay) return;
    modal.hidden = false;
    overlay.hidden = false;
    document.body.classList.add('modal-open');
    paint();
    const close = $('metricSheetClose');
    if (close) close.focus();
  }

  function close() {
    const modal = $('metricSheet');
    const overlay = $('metricSheetOverlay');
    if (modal) modal.hidden = true;
    if (overlay) overlay.hidden = true;
    document.body.classList.remove('modal-open');
    current = null;
  }

  const isOpen = () => !!current;

  function init() {
    const close_ = $('metricSheetClose');
    const overlay = $('metricSheetOverlay');
    if (close_) close_.addEventListener('click', close);
    if (overlay) overlay.addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen()) close();
    });
    window.addEventListener('resize', () => { if (isOpen()) paint(); });
  }

  return { init, open, close, isOpen, METRICS, TABLES,
           seriesForDay, statsOf, crossing, current: () => current };
})();

window.WTWMetricSheet = WTWMetricSheet;
