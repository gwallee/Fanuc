/* ============================================================
   What the Wether V8 — radar.js
   Canvas-based animated radar. No tiles, no keys, no network:
   a stylized "doppler" display seeded from the real current
   weather (precipitation probability, weather code and wind),
   with:
     • range rings + bearing ticks + grid
     • rotating sweep beam with fading trail
     • multi-blob storm cells with intensity colors
     • cells lighting up as the sweep passes over them
     • wind-driven cell drift + a scrubbable 60-min timeline
     • play / stop / refresh controls, center location marker
     • crisp on retina screens, resizes with its container
   ============================================================ */

const WTWRadar = (() => {
  const cfg = () => (window.WTW_CONFIG ? WTW_CONFIG.radar : {});

  const state = {
    canvas: null,
    ctx: null,
    dpr: 1,
    width: 0,
    height: 0,
    playing: false,
    rafId: null,
    sweepAngle: 0,
    lastFrameTime: 0,
    timelineMinute: 60,       // 0 = 60 min ago, 60 = now
    scrubbing: false,
    cells: [],
    locationLabel: 'No location',
    weatherSeed: null,        // last weather used to seed the cells
    onStatusChange: null,
  };

  /* ---------------- Storm cell generation ---------------- */

  // Deterministic-ish RNG so refreshing with identical weather
  // still gives a fresh-but-plausible picture.
  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  // Build storm cells from real weather. More precip probability
  // and nastier weather codes = more cells + higher intensity.
  function generateCells(weather) {
    const w = weather || {};
    const code = w.weatherCode ?? 0;
    const precip = Math.max(0, Math.min(100, w.precipProb ?? 0));
    const windMph = w.windMph ?? 5;
    const windDirDeg = w.windDirDeg ?? rand(0, 360);

    let baseCount = Math.round((precip / 100) * (cfg().maxStormCells || 7));
    let baseIntensity = precip / 100;

    if (code >= 95) { baseCount = Math.max(baseCount, 5); baseIntensity = Math.max(baseIntensity, 0.9); }
    else if (code >= 80) { baseCount = Math.max(baseCount, 4); baseIntensity = Math.max(baseIntensity, 0.7); }
    else if (code >= 61 || (code >= 71 && code <= 77)) { baseCount = Math.max(baseCount, 3); baseIntensity = Math.max(baseIntensity, 0.5); }
    else if (code >= 51) { baseCount = Math.max(baseCount, 2); baseIntensity = Math.max(baseIntensity, 0.3); }

    // Clear weather: nothing on the scope except faint clutter.
    const cells = [];
    const count = Math.min(baseCount, cfg().maxStormCells || 7);

    // Wind vector in "radar units per minute" (radius = 1.0).
    const windRad = ((windDirDeg + 180) % 360) * Math.PI / 180; // direction it's blowing TOWARD
    const speed = Math.min(windMph, 40) / 40 * 0.008;
    const driftX = Math.cos(windRad) * speed;
    const driftY = Math.sin(windRad) * speed;

    for (let i = 0; i < count; i++) {
      const angle = rand(0, Math.PI * 2);
      const dist = rand(0.15, 0.85);
      const intensity = Math.max(0.15, Math.min(1, baseIntensity * rand(0.6, 1.15)));
      const blobs = [];
      const blobCount = 3 + Math.floor(rand(2, 5));
      for (let b = 0; b < blobCount; b++) {
        blobs.push({
          dx: rand(-0.07, 0.07),
          dy: rand(-0.07, 0.07),
          r: rand(0.04, 0.11) * (0.7 + intensity * 0.6),
          jitter: rand(0.5, 1.5),
        });
      }
      cells.push({
        // Position at "now"; timeline scrubs back along the drift vector.
        x: Math.cos(angle) * dist,
        y: Math.sin(angle) * dist,
        driftX, driftY,
        intensity,
        blobs,
        pulsePhase: rand(0, Math.PI * 2),
        glow: 0, // lit up by the sweep, decays over time
      });
    }

    // A little light clutter so the scope never looks dead.
    const clutterCount = count === 0 ? 3 : 2;
    for (let i = 0; i < clutterCount; i++) {
      const angle = rand(0, Math.PI * 2);
      const dist = rand(0.2, 0.9);
      cells.push({
        x: Math.cos(angle) * dist,
        y: Math.sin(angle) * dist,
        driftX: driftX * 0.5, driftY: driftY * 0.5,
        intensity: rand(0.05, 0.14),
        blobs: [{ dx: 0, dy: 0, r: rand(0.02, 0.045), jitter: 1 }],
        pulsePhase: rand(0, Math.PI * 2),
        glow: 0,
      });
    }

    state.cells = cells;
    state.weatherSeed = w;
  }

  /* ---------------- Intensity color scale ---------------- */

  // Classic radar scale: green → yellow → orange → red → magenta.
  function intensityColor(intensity, alpha) {
    let r, g, b;
    if (intensity < 0.25)      { r = 40;  g = 200; b = 90;  }
    else if (intensity < 0.45) { r = 150; g = 210; b = 50;  }
    else if (intensity < 0.6)  { r = 240; g = 200; b = 40;  }
    else if (intensity < 0.75) { r = 245; g = 130; b = 30;  }
    else if (intensity < 0.9)  { r = 235; g = 60;  b = 45;  }
    else                       { r = 220; g = 50;  b = 200; }
    return `rgba(${r},${g},${b},${alpha})`;
  }

  /* ---------------- Drawing ---------------- */

  function themeVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  function draw() {
    const { ctx, width, height } = state;
    if (!ctx || width === 0) return;

    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) / 2 - 10;

    const accent = themeVar('--radar-accent', '#00ff9d');
    const ringColor = themeVar('--radar-ring', 'rgba(0,255,157,0.28)');
    const scopeBg1 = themeVar('--radar-bg-1', '#02100a');
    const scopeBg2 = themeVar('--radar-bg-2', '#04241a');

    ctx.clearRect(0, 0, width, height);

    // Scope background
    const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    bg.addColorStop(0, scopeBg2);
    bg.addColorStop(1, scopeBg1);
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = bg;
    ctx.fill();

    // Range rings (4) — animated: they breathe outward subtly.
    const t = performance.now() / 1000;
    ctx.lineWidth = 1;
    for (let i = 1; i <= 4; i++) {
      const breathe = 1 + Math.sin(t * 1.2 + i) * 0.004;
      ctx.beginPath();
      ctx.arc(cx, cy, (radius * i / 4) * breathe, 0, Math.PI * 2);
      ctx.strokeStyle = ringColor;
      ctx.stroke();
    }

    // Expanding ping ring (one every ~3 s)
    const ping = (t % 3) / 3;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * ping, 0, Math.PI * 2);
    ctx.strokeStyle = intensityColorless(accent, (1 - ping) * 0.25);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.lineWidth = 1;

    // Crosshairs + bearing ticks
    ctx.strokeStyle = ringColor;
    ctx.beginPath();
    ctx.moveTo(cx - radius, cy); ctx.lineTo(cx + radius, cy);
    ctx.moveTo(cx, cy - radius); ctx.lineTo(cx, cy + radius);
    ctx.stroke();
    for (let deg = 0; deg < 360; deg += 15) {
      const a = deg * Math.PI / 180;
      const inner = deg % 45 === 0 ? radius - 12 : radius - 6;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      ctx.lineTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
      ctx.stroke();
    }

    // Storm cells (clipped to the scope circle)
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();

    const minutesBack = (cfg().frameMinutes || 60) - state.timelineMinute;
    for (const cell of state.cells) {
      // Scrub position back along the wind drift vector.
      const px = cell.x - cell.driftX * minutesBack;
      const py = cell.y - cell.driftY * minutesBack;
      const pulse = 1 + Math.sin(t * 1.6 + cell.pulsePhase) * 0.06;
      const lit = Math.min(1, 0.55 + cell.glow * 0.7);

      for (const blob of cell.blobs) {
        const bx = cx + (px + blob.dx) * radius;
        const by = cy + (py + blob.dy) * radius;
        const br = blob.r * radius * pulse * blob.jitter;
        if (br <= 0.5) continue;
        const grad = ctx.createRadialGradient(bx, by, 0, bx, by, br);
        grad.addColorStop(0, intensityColor(cell.intensity, 0.85 * lit));
        grad.addColorStop(0.6, intensityColor(cell.intensity * 0.8, 0.4 * lit));
        grad.addColorStop(1, intensityColor(cell.intensity * 0.6, 0));
        ctx.beginPath();
        ctx.arc(bx, by, br, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
      }
      // Sweep glow decays each frame.
      cell.glow *= 0.985;
    }

    // Sweep beam (only spins while playing; frozen when paused)
    const sweep = state.sweepAngle;
    const beamWidth = Math.PI / 5;
    const beam = ctx.createConicGradient
      ? ctx.createConicGradient(sweep - beamWidth, cx, cy)
      : null;
    if (beam) {
      beam.addColorStop(0, 'rgba(0,0,0,0)');
      beam.addColorStop(0.9 * (beamWidth / (Math.PI * 2)), intensityColorless(accent, 0.05));
      beam.addColorStop(beamWidth / (Math.PI * 2), intensityColorless(accent, 0.35));
      beam.addColorStop(Math.min(1, beamWidth / (Math.PI * 2) + 0.001), 'rgba(0,0,0,0)');
      beam.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, sweep - beamWidth, sweep);
      ctx.closePath();
      ctx.fillStyle = beam;
      ctx.fill();
    } else {
      // Fallback for browsers without conic gradients.
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, sweep - beamWidth, sweep);
      ctx.closePath();
      ctx.fillStyle = intensityColorless(accent, 0.15);
      ctx.fill();
    }

    // Bright leading edge of the sweep
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(sweep) * radius, cy + Math.sin(sweep) * radius);
    ctx.strokeStyle = intensityColorless(accent, 0.9);
    ctx.lineWidth = 2;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 12;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1;

    ctx.restore();

    // Center location marker (pulsing)
    const markerPulse = 4 + Math.sin(t * 3) * 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, markerPulse + 5, 0, Math.PI * 2);
    ctx.strokeStyle = intensityColorless(accent, 0.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Outer bezel
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = intensityColorless(accent, 0.6);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  // Apply an alpha to a hex or rgb() color string.
  function intensityColorless(color, alpha) {
    if (color.startsWith('#')) {
      let hex = color.slice(1);
      if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return `rgba(${r},${g},${b},${alpha})`;
    }
    const m = color.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (m) return `rgba(${m[1]},${m[2]},${m[3]},${alpha})`;
    return color;
  }

  /* ---------------- Animation loop ---------------- */

  function frame(now) {
    if (!state.lastFrameTime) state.lastFrameTime = now;
    const dt = Math.min(0.1, (now - state.lastFrameTime) / 1000);
    state.lastFrameTime = now;

    if (state.playing) {
      const secsPerRev = cfg().sweepSecondsPerRev || 4;
      const prev = state.sweepAngle;
      state.sweepAngle = (state.sweepAngle + (Math.PI * 2 / secsPerRev) * dt) % (Math.PI * 2);

      // Light up cells the sweep just passed over.
      const minutesBack = (cfg().frameMinutes || 60) - state.timelineMinute;
      for (const cell of state.cells) {
        const px = cell.x - cell.driftX * minutesBack;
        const py = cell.y - cell.driftY * minutesBack;
        let cellAngle = Math.atan2(py, px);
        if (cellAngle < 0) cellAngle += Math.PI * 2;
        if (angleBetween(prev, state.sweepAngle, cellAngle)) {
          cell.glow = 1;
        }
      }

      // Auto-advance the timeline back to "now" while playing.
      if (!state.scrubbing && state.timelineMinute < (cfg().frameMinutes || 60)) {
        state.timelineMinute = Math.min(cfg().frameMinutes || 60, state.timelineMinute + dt * 6);
        syncTimelineUI();
      }
    }

    draw();
    state.rafId = requestAnimationFrame(frame);
  }

  function angleBetween(from, to, target) {
    // Did the sweep cross `target` while moving from `from` to `to`?
    if (from <= to) return target >= from && target <= to;
    return target >= from || target <= to; // wrapped past 2π
  }

  /* ---------------- Sizing ---------------- */

  function resize() {
    const canvas = state.canvas;
    if (!canvas) return;
    const rect = canvas.parentElement.getBoundingClientRect();
    // Never exceed the container OR the viewport (minus padding),
    // so the radar always fits on small screens.
    const viewportCap = Math.max(200, (window.innerWidth || 520) - 56);
    const size = Math.max(200, Math.min(rect.width || 300, 520, viewportCap));
    state.dpr = window.devicePixelRatio || 1;
    state.width = size;
    state.height = size;
    canvas.width = Math.round(size * state.dpr);
    canvas.height = Math.round(size * state.dpr);
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    state.ctx = canvas.getContext('2d');
    state.ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    draw();
  }

  /* ---------------- Status + timeline UI ---------------- */

  function setStatus(text, live) {
    const el = document.getElementById('radarStatusText');
    const dot = document.getElementById('radarStatusDot');
    if (el) el.textContent = text;
    if (dot) dot.classList.toggle('live', !!live);
    if (typeof state.onStatusChange === 'function') state.onStatusChange(text);
  }

  function syncTimelineUI() {
    const slider = document.getElementById('radarTimeline');
    const label = document.getElementById('radarTimeLabel');
    if (slider && !state.scrubbing) slider.value = String(Math.round(state.timelineMinute));
    if (label) {
      const back = (cfg().frameMinutes || 60) - Math.round(state.timelineMinute);
      label.textContent = back <= 0 ? 'NOW' : `-${back} min`;
    }
  }

  /* ---------------- Public controls ---------------- */

  function play() {
    if (state.playing) return;
    state.playing = true;
    state.lastFrameTime = 0;
    setStatus('SCANNING', true);
    updatePlayButton();
  }

  function stop() {
    state.playing = false;
    setStatus('PAUSED', false);
    updatePlayButton();
  }

  function toggle() {
    state.playing ? stop() : play();
  }

  function refresh(weather) {
    generateCells(weather || state.weatherSeed || {});
    state.timelineMinute = cfg().frameMinutes || 60;
    syncTimelineUI();
    setStatus(state.playing ? 'SCANNING' : 'REFRESHED', state.playing);
    draw();
  }

  function setLocation(label, weather) {
    state.locationLabel = label || 'Unknown';
    const el = document.getElementById('radarLocationLabel');
    if (el) el.textContent = state.locationLabel;
    refresh(weather);
  }

  function updatePlayButton() {
    const btn = document.getElementById('radarPlayBtn');
    if (!btn) return;
    btn.textContent = state.playing ? '⏸ Pause' : '▶ Play';
    btn.setAttribute('aria-pressed', state.playing ? 'true' : 'false');
  }

  /* ---------------- Init ---------------- */

  function init(canvasId) {
    state.canvas = document.getElementById(canvasId);
    if (!state.canvas) {
      console.warn('[radar] canvas not found:', canvasId);
      return;
    }
    resize();
    window.addEventListener('resize', resize);
    if (window.ResizeObserver) {
      new ResizeObserver(resize).observe(state.canvas.parentElement);
    }

    // Timeline slider
    const slider = document.getElementById('radarTimeline');
    if (slider) {
      slider.min = '0';
      slider.max = String(cfg().frameMinutes || 60);
      slider.value = String(cfg().frameMinutes || 60);
      slider.addEventListener('input', () => {
        state.scrubbing = true;
        state.timelineMinute = Number(slider.value);
        const label = document.getElementById('radarTimeLabel');
        if (label) {
          const back = (cfg().frameMinutes || 60) - Math.round(state.timelineMinute);
          label.textContent = back <= 0 ? 'NOW' : `-${back} min`;
        }
        draw();
      });
      const endScrub = () => { state.scrubbing = false; };
      slider.addEventListener('change', endScrub);
      slider.addEventListener('pointerup', endScrub);
      slider.addEventListener('touchend', endScrub);
    }

    generateCells({});
    syncTimelineUI();
    setStatus('STANDBY', false);
    updatePlayButton();
    state.rafId = requestAnimationFrame(frame);
    play();
  }

  return { init, play, stop, toggle, refresh, setLocation };
})();

window.WTWRadar = WTWRadar;
