/* ============================================================
   Aither Weather V21 — share.js
   Renders a roast as a shareable image on an offscreen canvas,
   then hands it to the Web Share API or a download. Everything
   is drawn locally; nothing is uploaded anywhere.
   ============================================================ */

const WTWShare = (() => {
  const W = 1000, H = 560;

  function themeVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  // Naive word wrap for the roast body.
  function wrap(ctx, text, maxWidth) {
    const words = String(text).split(/\s+/);
    const lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = w;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  function render({ roast, city, tempF, condition, username, personality }) {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    const bg = themeVar('--bg', '#0a0e17');
    const card = themeVar('--card', '#121a2b');
    const accent = themeVar('--accent', '#00ff9d');
    const text = themeVar('--text', '#e8f6ff');
    const dim = themeVar('--text-dim', '#8ba3b8');

    // Background
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    const glow = ctx.createRadialGradient(W * 0.8, -60, 0, W * 0.8, -60, W * 0.9);
    glow.addColorStop(0, accent.startsWith('#') ? accent + '22' : accent);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // Card
    const m = 36;
    ctx.fillStyle = card;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(m, m, W - m * 2, H - m * 2, 24);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillRect(m, m, W - m * 2, H - m * 2);
      ctx.strokeRect(m, m, W - m * 2, H - m * 2);
    }

    const padX = m + 44;
    let y = m + 74;

    // Header
    ctx.fillStyle = accent;
    ctx.font = 'bold 26px system-ui, "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('⚡ Aither Weather', padX, y);

    ctx.fillStyle = dim;
    ctx.font = '20px system-ui, "Segoe UI", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(String(personality || '').toUpperCase() + ' MODE', W - padX, y);

    // Conditions
    y += 62;
    ctx.textAlign = 'left';
    ctx.fillStyle = text;
    ctx.font = 'bold 62px system-ui, "Segoe UI", sans-serif';
    const tempLabel = window.WTWUnits
      ? WTWUnits.temp(tempF, { withUnit: true })
      : ((tempF === null || tempF === undefined || isNaN(tempF)) ? '--°' : `${Math.round(tempF)}°`);
    ctx.fillText(tempLabel, padX, y);

    const tempWidth = ctx.measureText(tempLabel).width;
    ctx.fillStyle = dim;
    ctx.font = '24px system-ui, "Segoe UI", sans-serif';
    ctx.fillText(`${city || ''}${condition ? ' · ' + condition : ''}`, padX + tempWidth + 20, y - 8);

    // Roast body
    y += 46;
    ctx.fillStyle = text;
    ctx.font = '30px system-ui, "Segoe UI", sans-serif';
    const lines = wrap(ctx, roast || '', W - padX * 2).slice(0, 5);
    for (const line of lines) {
      ctx.fillText(line, padX, y);
      y += 42;
    }

    // Footer
    ctx.fillStyle = dim;
    ctx.font = '18px system-ui, "Segoe UI", sans-serif';
    ctx.fillText(`Roasted by Wether Bot · ${username || ''}`, padX, H - m - 34);
    ctx.textAlign = 'right';
    ctx.fillText('100% local AI — no API key', W - padX, H - m - 34);

    return canvas;
  }

  function toBlob(canvas) {
    return new Promise((resolve) => {
      if (canvas.toBlob) canvas.toBlob((b) => resolve(b), 'image/png');
      else resolve(null);
    });
  }

  /* ------------------------------------------------------------
     Share if the platform supports sharing files (iOS/Android),
     otherwise fall back to downloading the PNG.
     Returns 'shared' | 'downloaded' | 'failed'.
     ------------------------------------------------------------ */
  async function shareRoast(payload) {
    try {
      const canvas = render(payload);
      const blob = await toBlob(canvas);
      if (!blob) return 'failed';

      const file = new File([blob], 'what-the-wether-roast.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
        await navigator.share({ files: [file], text: payload.roast });
        return 'shared';
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'what-the-wether-roast.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return 'downloaded';
    } catch (err) {
      // A user cancelling the share sheet lands here too.
      if (err && err.name === 'AbortError') return 'shared';
      console.warn('[share] failed', err);
      return 'failed';
    }
  }

  return { render, shareRoast };
})();

window.WTWShare = WTWShare;
