/* ============================================================
   Aither Weather V20 — tempchart.js
   The temperature trend chart behind the High / Low readout.

   Draws the 7-day forecast as a high/low band with both curves and
   labelled points, in whatever units are selected. Canvas, no
   charting library, theme-aware, redrawn on resize.
   ============================================================ */

const WTWTempChart = (() => {
  const state = { canvas: null, ctx: null, days: [], hover: null };

  function css(name, fallback) {
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

  const conv = (f) => (window.WTWUnits ? WTWUnits.tempValue(f) : f);
  const fmt = (f) => (window.WTWUnits ? WTWUnits.temp(f) : `${Math.round(f)}°`);

  function resize() {
    const canvas = state.canvas;
    if (!canvas || !canvas.parentElement) return;
    const width = Math.max(260, canvas.parentElement.clientWidth);
    const height = Math.max(220, Math.min(340, Math.round(width * 0.5)));
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.height = height + 'px';
    state.ctx = canvas.getContext('2d');
    state.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function draw() {
    const ctx = state.ctx;
    const canvas = state.canvas;
    if (!ctx || !canvas) return;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    ctx.clearRect(0, 0, W, H);

    const days = state.days;
    const text = css('--text', '#e8f6ff');
    const dim = css('--text-dim', '#8ba3b8');
    if (!days.length) {
      ctx.fillStyle = dim;
      ctx.font = '13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No forecast loaded.', W / 2, H / 2);
      return;
    }

    const hot = css('--danger', '#ff5470');
    const cold = css('--accent-2', '#00c8ff');

    const padL = 40, padR = 16, padT = 26, padB = 40;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const highs = days.map((d) => conv(d.highF)).filter((v) => v !== null && !isNaN(v));
    const lows = days.map((d) => conv(d.lowF)).filter((v) => v !== null && !isNaN(v));
    const all = highs.concat(lows);
    if (!all.length) return;
    let min = Math.min(...all), max = Math.max(...all);
    if (max - min < 5) { const mid = (max + min) / 2; min = mid - 2.5; max = mid + 2.5; }
    const pad = (max - min) * 0.2;
    min -= pad; max += pad;

    const xAt = (i) => padL + (days.length === 1 ? plotW / 2
      : (i / (days.length - 1)) * plotW);
    const yAt = (v) => padT + plotH - ((v - min) / (max - min)) * plotH;

    // Gridlines
    ctx.strokeStyle = withAlpha(dim, 0.18);
    ctx.fillStyle = dim;
    ctx.font = '10px "Courier New", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let g = 0; g <= 3; g++) {
      const v = min + ((max - min) * g) / 3;
      const y = yAt(v);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(W - padR, y);
      ctx.stroke();
      ctx.fillText(`${Math.round(v)}°`, padL - 6, y);
    }

    // Band between the high and low curves
    ctx.beginPath();
    days.forEach((d, i) => {
      const v = conv(d.highF);
      if (v === null || isNaN(v)) return;
      const x = xAt(i), y = yAt(v);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    for (let i = days.length - 1; i >= 0; i--) {
      const v = conv(days[i].lowF);
      if (v === null || isNaN(v)) continue;
      ctx.lineTo(xAt(i), yAt(v));
    }
    ctx.closePath();
    const band = ctx.createLinearGradient(0, padT, 0, padT + plotH);
    band.addColorStop(0, withAlpha(hot, 0.26));
    band.addColorStop(1, withAlpha(cold, 0.26));
    ctx.fillStyle = band;
    ctx.fill();

    // Curves + points
    const line = (key, color) => {
      ctx.beginPath();
      days.forEach((d, i) => {
        const v = conv(d[key]);
        if (v === null || isNaN(v)) return;
        const x = xAt(i), y = yAt(v);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.stroke();

      ctx.fillStyle = color;
      days.forEach((d, i) => {
        const v = conv(d[key]);
        if (v === null || isNaN(v)) return;
        ctx.beginPath();
        ctx.arc(xAt(i), yAt(v), 3.5, 0, Math.PI * 2);
        ctx.fill();
      });
    };
    line('highF', hot);
    line('lowF', cold);

    // Value labels
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    days.forEach((d, i) => {
      const hi = conv(d.highF), lo = conv(d.lowF);
      if (hi !== null && !isNaN(hi)) {
        ctx.fillStyle = hot;
        ctx.textBaseline = 'bottom';
        ctx.fillText(fmt(d.highF), xAt(i), yAt(hi) - 7);
      }
      if (lo !== null && !isNaN(lo)) {
        ctx.fillStyle = cold;
        ctx.textBaseline = 'top';
        ctx.fillText(fmt(d.lowF), xAt(i), yAt(lo) + 7);
      }
    });

    // Day labels
    ctx.fillStyle = dim;
    ctx.font = '10px "Courier New", monospace';
    ctx.textBaseline = 'top';
    days.forEach((d, i) => {
      const date = new Date(d.dateISO + 'T12:00:00');
      const name = i === 0 ? 'TODAY'
        : date.toLocaleDateString([], { weekday: 'short' }).toUpperCase();
      ctx.fillText(name, xAt(i), padT + plotH + 12);
    });

    // Legend
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = hot;
    ctx.fillText('● High', padL, 12);
    ctx.fillStyle = cold;
    ctx.fillText('● Low', padL + 58, 12);
    ctx.fillStyle = text;
  }

  function setDays(days) {
    state.days = Array.isArray(days) ? days : [];
    draw();
  }

  function init(canvasId) {
    state.canvas = document.getElementById(canvasId);
    if (!state.canvas) return;
    window.addEventListener('resize', resize);
    if (window.ResizeObserver && state.canvas.parentElement) {
      new ResizeObserver(resize).observe(state.canvas.parentElement);
    }
  }

  return { init, setDays, resize, redraw: draw };
})();

window.WTWTempChart = WTWTempChart;
