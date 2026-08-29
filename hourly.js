/* ============================================================
   Aither Weather V21 — hourly.js
   48-hour outlook: normalizes hourly data from either source and
   draws the temperature curve with a precipitation-chance bar
   underneath. Canvas, no charting library, theme-aware.
   ============================================================ */

const WTWHourly = (() => {
  const state = { hours: [], canvas: null, ctx: null, hoverIndex: null };

  function themeVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  function withAlpha(color, alpha) {
    if (color.startsWith('#')) {
      let hex = color.slice(1);
      if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
      return `rgba(${parseInt(hex.slice(0,2),16)},${parseInt(hex.slice(2,4),16)},${parseInt(hex.slice(4,6),16)},${alpha})`;
    }
    const m = color.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    return m ? `rgba(${m[1]},${m[2]},${m[3]},${alpha})` : color;
  }

  /* ---------------- Normalizers ---------------- */

  // Open-Meteo: parallel arrays under `hourly`.
  function fromOpenMeteo(data, limit) {
    const h = (data && data.hourly) || {};
    const times = h.time || [];
    const now = Date.now();
    const out = [];
    for (let i = 0; i < times.length; i++) {
      const when = new Date(times[i]);
      if (when.getTime() < now - 3600000) continue;   // skip the past
      out.push({
        time: when,
        tempF: h.temperature_2m ? h.temperature_2m[i] : null,
        precipProb: h.precipitation_probability ? h.precipitation_probability[i] : null,
        code: h.weather_code ? h.weather_code[i] : 0,
        windMph: h.wind_speed_10m ? h.wind_speed_10m[i] : null,
      });
      if (out.length >= limit) break;
    }
    return out;
  }

  // NWS: /gridpoints/.../forecast/hourly periods.
  function fromNWS(periods, limit, textToCode) {
    const now = Date.now();
    const out = [];
    for (const p of periods || []) {
      const when = new Date(p.startTime);
      if (when.getTime() < now - 3600000) continue;
      const pop = p.probabilityOfPrecipitation && p.probabilityOfPrecipitation.value;
      out.push({
        time: when,
        tempF: typeof p.temperature === 'number' ? p.temperature : null,
        precipProb: typeof pop === 'number' ? pop : null,
        code: textToCode ? textToCode(p.shortForecast) : 0,
        windMph: parseFloat(String(p.windSpeed || '').replace(/[^\d.]/g, '')) || null,
      });
      if (out.length >= limit) break;
    }
    return out;
  }

  /* ---------------- Drawing ---------------- */

  function resize() {
    const canvas = state.canvas;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const width = Math.max(280, parent.clientWidth - 2);
    const height = 170;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    state.ctx = canvas.getContext('2d');
    state.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function draw() {
    const ctx = state.ctx;
    if (!ctx || !state.canvas) return;
    const W = state.canvas.clientWidth;
    const H = state.canvas.clientHeight;
    ctx.clearRect(0, 0, W, H);

    const hours = state.hours;
    if (!hours.length) {
      ctx.fillStyle = themeVar('--text-dim', '#8ba3b8');
      ctx.font = '13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No hourly data available for this location.', W / 2, H / 2);
      return;
    }

    const accent = themeVar('--accent', '#00ff9d');
    const accent2 = themeVar('--accent-2', '#00c8ff');
    const dim = themeVar('--text-dim', '#8ba3b8');
    const text = themeVar('--text', '#e8f6ff');

    const padL = 34, padR = 12, padT = 18, padB = 46;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    // Plot in the reader's units so the axis matches the cards.
    const conv = (t) => (window.WTWUnits ? WTWUnits.tempValue(t) : t);
    const temps = hours.map((h) => conv(h.tempF)).filter((t) => t !== null && !isNaN(t));
    if (!temps.length) return;
    let min = Math.min(...temps), max = Math.max(...temps);
    if (max - min < 6) { const mid = (max + min) / 2; min = mid - 3; max = mid + 3; }
    const pad = (max - min) * 0.15;
    min -= pad; max += pad;

    const xAt = (i) => padL + (i / Math.max(1, hours.length - 1)) * plotW;
    const yAt = (t) => padT + plotH - ((t - min) / (max - min)) * plotH;

    // Gridlines + temperature axis
    ctx.strokeStyle = withAlpha(dim, 0.18);
    ctx.fillStyle = dim;
    ctx.font = '10px "Courier New", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1;
    for (let g = 0; g <= 2; g++) {
      const t = min + ((max - min) * g) / 2;
      const y = yAt(t);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(W - padR, y);
      ctx.stroke();
      ctx.fillText(`${Math.round(t)}°`, padL - 6, y);
    }

    // Precipitation-chance bars along the bottom
    const barBase = padT + plotH;
    const barMax = 34;
    const barW = Math.max(2, plotW / hours.length - 2);
    hours.forEach((h, i) => {
      const p = h.precipProb;
      if (p === null || p === undefined || p <= 0) return;
      const bh = (Math.min(100, p) / 100) * barMax;
      ctx.fillStyle = withAlpha(accent2, 0.35);
      ctx.fillRect(xAt(i) - barW / 2, barBase - bh, barW, bh);
    });

    // Temperature curve, filled underneath
    ctx.beginPath();
    hours.forEach((h, i) => {
      if (h.tempF === null) return;
      const x = xAt(i), y = yAt(conv(h.tempF));
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    const line = ctx.getLineDash();
    ctx.setLineDash([]);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash(line);

    const fill = ctx.createLinearGradient(0, padT, 0, barBase);
    fill.addColorStop(0, withAlpha(accent, 0.28));
    fill.addColorStop(1, withAlpha(accent, 0));
    ctx.lineTo(xAt(hours.length - 1), barBase);
    ctx.lineTo(xAt(0), barBase);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();

    // Hour labels every 6 hours
    ctx.fillStyle = dim;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = '10px "Courier New", monospace';
    hours.forEach((h, i) => {
      if (i % 6 !== 0) return;
      ctx.fillText(window.WTWUnits ? WTWUnits.hourLabel(h.time)
        : h.time.toLocaleTimeString([], { hour: 'numeric' }).replace(' ', ''),
        xAt(i), barBase + 8);
    });

    // Hover readout
    if (state.hoverIndex !== null && hours[state.hoverIndex]) {
      const h = hours[state.hoverIndex];
      const x = xAt(state.hoverIndex);
      ctx.strokeStyle = withAlpha(accent, 0.5);
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, barBase);
      ctx.stroke();
      if (h.tempF !== null) {
        ctx.beginPath();
        ctx.arc(x, yAt(conv(h.tempF)), 4, 0, Math.PI * 2);
        ctx.fillStyle = accent;
        ctx.fill();
      }
      const label = `${window.WTWUnits ? WTWUnits.time(h.time) : h.time.toLocaleTimeString([], { hour: 'numeric' })}` +
        `  ${window.WTWUnits ? WTWUnits.temp(h.tempF) : Math.round(h.tempF) + '°'}` +
        (h.precipProb ? `  💧${Math.round(h.precipProb)}%` : '');
      ctx.font = '11px system-ui, sans-serif';
      const tw = ctx.measureText(label).width + 12;
      const bx = Math.max(padL, Math.min(W - padR - tw, x - tw / 2));
      ctx.fillStyle = withAlpha(themeVar('--card', '#121a2b'), 0.96);
      ctx.strokeStyle = withAlpha(accent, 0.5);
      ctx.beginPath();
      ctx.rect(bx, 2, tw, 15);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = text;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, bx + 6, 10);
    }
  }

  /* ---------------- Public ---------------- */

  function setHours(hours) {
    state.hours = Array.isArray(hours) ? hours : [];
    draw();
  }

  function init(canvasId) {
    state.canvas = document.getElementById(canvasId);
    if (!state.canvas) return;
    resize();
    window.addEventListener('resize', resize);
    if (window.ResizeObserver && state.canvas.parentElement) {
      new ResizeObserver(resize).observe(state.canvas.parentElement);
    }
    const pick = (e) => {
      if (!state.hours.length) return;
      const rect = state.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const padL = 34, padR = 12;
      const plotW = rect.width - padL - padR;
      const i = Math.round(((x - padL) / plotW) * (state.hours.length - 1));
      state.hoverIndex = Math.max(0, Math.min(state.hours.length - 1, i));
      draw();
    };
    state.canvas.addEventListener('pointermove', pick);
    state.canvas.addEventListener('pointerdown', pick);
    state.canvas.addEventListener('pointerleave', () => { state.hoverIndex = null; draw(); });
  }

  return { init, setHours, fromOpenMeteo, fromNWS, redraw: draw };
})();

window.WTWHourly = WTWHourly;
