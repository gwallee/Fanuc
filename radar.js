/* ============================================================
   Aither Weather V26 — radar.js
   Canvas radar scope with a real basemap underneath.

   Layers, bottom to top, all projected in EPSG:3857 so they align:
     1. Basemap tiles (map.js)
     2. NOAA base-reflectivity imagery, or the stylized simulation
        when live imagery is unavailable
     3. Active NWS alert polygons
     4. Range rings, bearing ticks, sweep beam, location marker

   Controls: play/pause, stop, refresh, my location, zoom in/out,
   drag to pan, recenter, and a timeline that scrubs real frames by
   clock time (or simulated minutes in fallback mode).

   Tap or click the scope to expand it to fullscreen; tap again, press
   Escape, or use the close button to come back.
   ============================================================ */

const WTWRadar = (() => {
  const cfg = () => (window.WTW_CONFIG ? WTW_CONFIG.radar : {});
  const mapCfg = () => (window.WTW_CONFIG && WTW_CONFIG.map) || {};
  const imgCfg = () => (window.WTW_CONFIG && WTW_CONFIG.radarImagery) || { enabled: false };

  /* How strongly the imagery is painted, and how fast the loop runs.
     Both were fixed numbers; both are the sort of thing people
     genuinely want to change — heavy rain over a dark basemap is
     unreadable at one opacity and washed out at another. */
  function radarOpacity() {
    const v = Number((window.WTWStorage && WTWStorage.getSettings().radarOpacity));
    return isFinite(v) && v >= 0.2 && v <= 1 ? v : 0.85;
  }

  function radarSpeed() {
    const v = Number((window.WTWStorage && WTWStorage.getSettings().radarSpeed));
    return isFinite(v) && v >= 0.25 && v <= 4 ? v : 1;
  }

  const state = {
    canvas: null, ctx: null, dpr: 1, width: 0, height: 0,
    // How far between the previous frame and the current one the
    // cross-fade has travelled, 0..1.
    fade: 1, prevIndex: 0,
    playing: false, rafId: null, sweepAngle: 0, lastFrameTime: 0,
    timelineMinute: 60, scrubbing: false,
    cells: [], locationLabel: 'No location', weatherSeed: null,

    source: 'sim',          // 'sim' | 'tiles' | 'nws'
    frames: [], frameIndex: 0, frameAccum: 0,
    tileHost: '',           // RainViewer host for the current frame set
    frameAge: null,         // minutes since the newest frame
    loadToken: 0,

    coords: null,           // searched location (marker)
    center: null,           // current scope centre (pans away from coords)
    rangeKm: 150,
    alerts: [],             // GeoJSON features with geometry
    dragging: false, dragLast: null, dragStart: null, moved: false,
    refetchTimer: null,
    lastRefreshAt: 0,
    preloadedPath: null,       // when imagery was last (re)loaded
    fullscreen: false,
    visible: true,          // scope is on screen
    pageVisible: true,      // tab is in the foreground
  };

  /* ================= Real imagery (NOAA WMS, EPSG:3857) ================= */

  function wmsUrl(view, when) {
    const c = imgCfg();
    const params = new URLSearchParams({
      service: 'WMS', version: '1.1.1', request: 'GetMap',
      layers: c.layer, styles: '', format: 'image/png', transparent: 'true',
      srs: 'EPSG:3857',
      bbox: WTWMap.bbox3857(view),
      width: String(c.imageSize), height: String(c.imageSize),
    });
    if (when) params.set('time', when.toISOString().replace('.000Z', 'Z'));
    return `${c.wmsBase}?${params.toString()}`;
  }

  function loadImage(url, timeoutMs = 9000) {
    return new Promise((resolve) => {
      const img = new Image();
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(ok ? img : null);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      img.onload = () => finish(img.width > 0);
      img.onerror = () => finish(false);
      img.src = url;
    });
  }

  // Timestamped worldwide frames. Preferred: every frame is a real
  // observation at a known time, so the loop and its labels are true.
  async function loadTileFrames(token) {
    const index = await WTWRadarSource.getFrames();
    if (!index || token !== state.loadToken) return false;
    state.source = 'tiles';
    state.tileHost = index.host;
    state.frames = index.frames.map((f) => ({
      time: f.time, path: f.path, forecast: !!f.forecast,
    }));
    // Open on the latest real observation. The forecast frames are
    // ahead of it on the timeline, to be played into, not landed on.
    const observed = WTWRadarSource.latestObservedIndex(state.frames);
    state.frameIndex = observed >= 0 ? observed : state.frames.length - 1;
    state.frameAccum = 0;
    state.frameAge = WTWRadarSource.ageMinutes(state.frames);
    return true;
  }

  async function loadRealFrames() {
    const c = imgCfg();
    if (!state.center) return false;

    const token = ++state.loadToken;
    setStatus('FETCHING', false);

    // 1. Real frame index (worldwide).
    try {
      if (await loadTileFrames(token)) return true;
    } catch (err) {
      console.warn('[radar] tile frames failed', err && err.message);
    }
    if (token !== state.loadToken) return false;
    if (!c.enabled) return false;

    const view = currentView();
    const stepMs = (c.frameStepMin || 10) * 60000;
    const latest = Math.floor(Date.now() / stepMs) * stepMs;
    const times = [];
    for (let i = (c.frameCount || 6) - 1; i >= 0; i--) times.push(new Date(latest - i * stepMs));

    const images = await Promise.all(times.map((t) => loadImage(wmsUrl(view, t))));
    if (token !== state.loadToken) return false;   // superseded by a newer load

    const frames = [];
    times.forEach((t, i) => { if (images[i]) frames.push({ time: t, img: images[i] }); });

    if (!frames.length) {
      state.source = 'sim';
      state.frames = [];
      return false;
    }
    state.source = 'nws';
    state.frames = frames;
    state.frameIndex = frames.length - 1;
    state.frameAccum = 0;
    state.frameAge = (Date.now() - frames[frames.length - 1].time.getTime()) / 60000;
    return true;
  }

  function currentView() {
    const c = state.center || state.coords || { lat: 39.5, lon: -98.35 };
    return WTWMap.viewBox(c.lat, c.lon, state.rangeKm);
  }

  /* ================= Simulated cells (fallback) ================= */

  function rand(min, max) { return min + Math.random() * (max - min); }

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

    const cells = [];
    const count = Math.min(baseCount, cfg().maxStormCells || 7);
    const windRad = ((windDirDeg + 180) % 360) * Math.PI / 180;
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
        blobs.push({ dx: rand(-0.07, 0.07), dy: rand(-0.07, 0.07),
          r: rand(0.04, 0.11) * (0.7 + intensity * 0.6), jitter: rand(0.5, 1.5) });
      }
      cells.push({ x: Math.cos(angle) * dist, y: Math.sin(angle) * dist,
        driftX, driftY, intensity, blobs, pulsePhase: rand(0, Math.PI * 2), glow: 0 });
    }

    const clutterCount = count === 0 ? 3 : 2;
    for (let i = 0; i < clutterCount; i++) {
      const angle = rand(0, Math.PI * 2);
      const dist = rand(0.2, 0.9);
      cells.push({ x: Math.cos(angle) * dist, y: Math.sin(angle) * dist,
        driftX: driftX * 0.5, driftY: driftY * 0.5, intensity: rand(0.05, 0.14),
        blobs: [{ dx: 0, dy: 0, r: rand(0.02, 0.045), jitter: 1 }],
        pulsePhase: rand(0, Math.PI * 2), glow: 0 });
    }

    state.cells = cells;
    state.weatherSeed = w;
  }

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

  function withAlpha(color, alpha) {
    if (color.startsWith('#')) {
      let hex = color.slice(1);
      if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return `rgba(${r},${g},${b},${alpha})`;
    }
    const m = color.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    return m ? `rgba(${m[1]},${m[2]},${m[3]},${alpha})` : color;
  }

  function themeVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  /* ================= Drawing ================= */

  function draw() {
    const { ctx, width, height } = state;
    if (!ctx || width === 0) return;

    const cx = width / 2, cy = height / 2;
    const radius = Math.min(width, height) / 2 - 10;
    const size = radius * 2;
    const originX = cx - radius, originY = cy - radius;

    const accent = themeVar('--radar-accent', '#00ff9d');
    const ringColor = themeVar('--radar-ring', 'rgba(0,255,157,0.28)');
    const t = performance.now() / 1000;
    const view = currentView();

    ctx.clearRect(0, 0, width, height);

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();

    // 1. Basemap
    const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    bg.addColorStop(0, themeVar('--radar-bg-2', '#04241a'));
    bg.addColorStop(1, themeVar('--radar-bg-1', '#02100a'));
    ctx.fillStyle = bg;
    ctx.fillRect(originX, originY, size, size);

    const painted = WTWMap.drawBasemap(ctx, view, size, originX, originY, () => draw());
    if (painted) {
      // Knock the basemap back so weather reads on top of it.
      ctx.fillStyle = withAlpha(themeVar('--radar-bg-1', '#02100a'), 0.35);
      ctx.fillRect(originX, originY, size, size);
    }

    // 2. Precipitation
    if (state.source === 'tiles' && state.frames.length) {
      const i = Math.min(state.frameIndex, state.frames.length - 1);
      const frame = state.frames[i];
      if (frame) {
        const base = radarOpacity();
        /* Cross-fade rather than cut.

           Ten-minute frames switched instantly make rain appear to
           teleport; fading the outgoing frame out under the incoming
           one reads as movement, which is what the rain is actually
           doing. The fade is only over the frame's own opacity, so
           nothing is ever drawn brighter than a single frame would
           be. */
        const prev = state.frames[Math.min(state.prevIndex, state.frames.length - 1)];
        if (prev && prev !== frame && state.fade < 1) {
          ctx.globalAlpha = (prev.forecast ? base * 0.73 : base) * (1 - state.fade);
          WTWMap.drawTiles(ctx, view, size, originX, originY,
            (z, x, y) => WTWRadarSource.tileUrl(state.tileHost, prev.path, z, x, y),
            () => draw(), { maxZoom: 10 });
        }
        // A prediction is drawn a shade lighter than an observation, so
        // the difference is visible on the map and not only in the label.
        ctx.globalAlpha = (frame.forecast ? base * 0.73 : base) *
          (prev && prev !== frame ? state.fade : 1);
        WTWMap.drawTiles(ctx, view, size, originX, originY,
          (z, x, y) => WTWRadarSource.tileUrl(state.tileHost, frame.path, z, x, y),
          () => draw(), { maxZoom: 10 });
        ctx.globalAlpha = 1;
        preloadNextFrame(view, size, i);
      }
    } else if (state.source === 'nws' && state.frames.length) {
      const frame = state.frames[Math.min(state.frameIndex, state.frames.length - 1)];
      if (frame && frame.img) {
        ctx.globalAlpha = radarOpacity();
        ctx.drawImage(frame.img, originX, originY, size, size);
        ctx.globalAlpha = 1;
      }
    } else {
      drawSimulatedCells(ctx, cx, cy, radius, t);
    }

    // 3. Alert polygons
    drawAlerts(ctx, view, size, originX, originY);

    // 4. Instrument overlay
    drawRings(ctx, cx, cy, radius, ringColor, accent, t);
    drawSweep(ctx, cx, cy, radius, accent);
    ctx.restore();

    drawRangeLabels(ctx, cx, cy, radius, accent);
    drawMarker(ctx, view, size, originX, originY, accent, t);
    drawBezel(ctx, cx, cy, radius, accent);
  }

  // Fetch the frame after this one while this one is on screen, so a
  // loop that has run once never stalls mid-playback waiting on tiles.
  function preloadNextFrame(view, size, currentIndex) {
    if (!WTWMap.preloadTiles || state.frames.length < 2) return;
    const next = state.frames[(currentIndex + 1) % state.frames.length];
    if (!next || next.path === state.preloadedPath) return;
    state.preloadedPath = next.path;
    WTWMap.preloadTiles(view, size,
      (z, x, y) => WTWRadarSource.tileUrl(state.tileHost, next.path, z, x, y),
      { maxZoom: 10 });
  }

  function drawSimulatedCells(ctx, cx, cy, radius, t) {
    const minutesBack = (cfg().frameMinutes || 60) - state.timelineMinute;
    for (const cell of state.cells) {
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
      cell.glow *= 0.985;
    }
  }

  function drawAlerts(ctx, view, size, originX, originY) {
    if (!state.alerts.length) return;
    const danger = themeVar('--danger', '#ff5470');
    ctx.lineWidth = 2;
    for (const feature of state.alerts) {
      const geom = feature && feature.geometry;
      if (!geom) continue;
      const polys = geom.type === 'MultiPolygon' ? geom.coordinates
                  : geom.type === 'Polygon' ? [geom.coordinates] : [];
      for (const poly of polys) {
        for (const ring of poly) {
          if (!ring || ring.length < 3) continue;
          ctx.beginPath();
          ring.forEach(([lon, lat], i) => {
            const p = WTWMap.project(lat, lon, view, size, originX, originY);
            if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
          });
          ctx.closePath();
          ctx.fillStyle = withAlpha(danger, 0.16);
          ctx.fill();
          ctx.strokeStyle = withAlpha(danger, 0.9);
          ctx.stroke();
        }
      }
    }
    ctx.lineWidth = 1;
  }

  function drawRings(ctx, cx, cy, radius, ringColor, accent, t) {
    ctx.lineWidth = 1;
    for (let i = 1; i <= 4; i++) {
      const breathe = 1 + Math.sin(t * 1.2 + i) * 0.004;
      ctx.beginPath();
      ctx.arc(cx, cy, (radius * i / 4) * breathe, 0, Math.PI * 2);
      ctx.strokeStyle = ringColor;
      ctx.stroke();
    }
    const ping = (t % 3) / 3;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * ping, 0, Math.PI * 2);
    ctx.strokeStyle = withAlpha(accent, (1 - ping) * 0.25);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.lineWidth = 1;

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
  }

  // Distance labels so the rings mean something.
  function drawRangeLabels(ctx, cx, cy, radius, accent) {
    ctx.save();
    ctx.font = '10px "Courier New", monospace';
    ctx.fillStyle = withAlpha(accent, 0.75);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 2; i <= 4; i += 2) {
      const km = (state.rangeKm * i) / 4;
      const label = window.WTWUnits ? WTWUnits.range(km) : `${Math.round(km)} km`;
      const y = cy - (radius * i) / 4;
      ctx.fillText(label, cx, y + 8);
    }
    ctx.restore();
  }

  function drawSweep(ctx, cx, cy, radius, accent) {
    const sweep = state.sweepAngle;
    const beamWidth = Math.PI / 5;
    if (ctx.createConicGradient) {
      const beam = ctx.createConicGradient(sweep - beamWidth, cx, cy);
      beam.addColorStop(0, 'rgba(0,0,0,0)');
      beam.addColorStop(0.9 * (beamWidth / (Math.PI * 2)), withAlpha(accent, 0.05));
      beam.addColorStop(beamWidth / (Math.PI * 2), withAlpha(accent, 0.3));
      beam.addColorStop(Math.min(1, beamWidth / (Math.PI * 2) + 0.001), 'rgba(0,0,0,0)');
      beam.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, sweep - beamWidth, sweep);
      ctx.closePath();
      ctx.fillStyle = beam;
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, sweep - beamWidth, sweep);
      ctx.closePath();
      ctx.fillStyle = withAlpha(accent, 0.15);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(sweep) * radius, cy + Math.sin(sweep) * radius);
    ctx.strokeStyle = withAlpha(accent, 0.9);
    ctx.lineWidth = 2;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 12;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1;
  }

  // The marker sits on the searched location, which is not the scope
  // centre once the user has panned.
  function drawMarker(ctx, view, size, originX, originY, accent, t) {
    if (!state.coords) return;
    const p = WTWMap.project(state.coords.lat, state.coords.lon, view, size, originX, originY);
    const cx = state.width / 2, cy = state.height / 2;
    const radius = Math.min(state.width, state.height) / 2 - 10;
    if (Math.hypot(p.x - cx, p.y - cy) > radius - 4) return;  // off-scope

    const pulse = 4 + Math.sin(t * 3) * 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, pulse + 5, 0, Math.PI * 2);
    ctx.strokeStyle = withAlpha(accent, 0.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  function drawBezel(ctx, cx, cy, radius, accent) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = withAlpha(accent, 0.6);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  /* ================= Animation ================= */

  function angleBetween(from, to, target) {
    if (from <= to) return target >= from && target <= to;
    return target >= from || target <= to;
  }

  function shouldAnimate() {
    return state.playing && state.visible && state.pageVisible;
  }

  function frame(now) {
    if (!state.lastFrameTime) state.lastFrameTime = now;
    const dt = Math.min(0.1, (now - state.lastFrameTime) / 1000);
    state.lastFrameTime = now;

    if (shouldAnimate()) {
      const secsPerRev = cfg().sweepSecondsPerRev || 4;
      const prev = state.sweepAngle;
      state.sweepAngle = (state.sweepAngle + (Math.PI * 2 / secsPerRev) * dt) % (Math.PI * 2);

      if (hasTimestampedFrames() && state.frames.length > 1) {
        if (!state.scrubbing) {
          const stepMs = (cfg().framePlaybackMs || 750) / radarSpeed();
          state.frameAccum += dt * 1000;
          // The fade runs over the first third of each frame's time,
          // so a slow playback speed does not leave two frames blended
          // together for a second and a half.
          const fadeMs = Math.min(260, stepMs * 0.34);
          state.fade = fadeMs > 0 ? Math.min(1, state.frameAccum / fadeMs) : 1;
          if (state.frameAccum >= stepMs) {
            state.frameAccum = 0;
            state.fade = 0;
            state.prevIndex = state.frameIndex;
            state.frameIndex = (state.frameIndex + 1) % state.frames.length;
            updateSourceBadge();
            syncTimelineUI();
          }
        }
      } else {
        const minutesBack = (cfg().frameMinutes || 60) - state.timelineMinute;
        for (const cell of state.cells) {
          const px = cell.x - cell.driftX * minutesBack;
          const py = cell.y - cell.driftY * minutesBack;
          let a = Math.atan2(py, px);
          if (a < 0) a += Math.PI * 2;
          if (angleBetween(prev, state.sweepAngle, a)) cell.glow = 1;
        }
        if (!state.scrubbing && state.timelineMinute < (cfg().frameMinutes || 60)) {
          state.timelineMinute = Math.min(cfg().frameMinutes || 60, state.timelineMinute + dt * 6);
          syncTimelineUI();
        }
      }
    }

    // Repainting an off-screen or backgrounded scope burns battery for
    // nothing, so the loop parks itself and is restarted by the
    // observers below.
    if (!state.visible || !state.pageVisible) {
      state.rafId = null;
      return;
    }

    draw();
    state.rafId = requestAnimationFrame(frame);
  }

  function startLoop() {
    if (state.rafId !== null) return;
    state.lastFrameTime = 0;
    state.rafId = requestAnimationFrame(frame);
  }

  /* ------------------------------------------------------------
     Pause the loop when the scope scrolls out of view or the tab
     goes to the background; resume as soon as it is visible again.
     ------------------------------------------------------------ */
  function initVisibility() {
    document.addEventListener('visibilitychange', () => {
      state.pageVisible = !document.hidden;
      if (state.pageVisible) startLoop();
    });

    if (window.IntersectionObserver && state.canvas) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          state.visible = entry.isIntersecting;
          if (state.visible) startLoop();
        });
      }, { threshold: 0.05 });
      io.observe(state.canvas);
    }
  }

  /* ================= Sizing ================= */

  function resize() {
    const canvas = state.canvas;
    if (!canvas) return;
    const rect = canvas.parentElement.getBoundingClientRect();
    let size;
    if (state.fullscreen) {
      // Fill the screen, leaving room for the controls beneath.
      const chrome = window.innerWidth < 640 ? 300 : 250;
      size = Math.max(220, Math.min(window.innerWidth - 24, window.innerHeight - chrome));
    } else {
      const viewportCap = Math.max(200, (window.innerWidth || 520) - 56);
      size = Math.max(200, Math.min(rect.width || 300, 520, viewportCap));
    }
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

  /* ================= Status + timeline ================= */

  function setStatus(text, live) {
    const el = document.getElementById('radarStatusText');
    const dot = document.getElementById('radarStatusDot');
    if (el) el.textContent = text;
    if (dot) dot.classList.toggle('live', !!live);
    updateSourceBadge();
  }

  function updateSourceBadge() {
    const badge = document.getElementById('radarSource');
    if (!badge) return;
    const hasFrames = state.frames.length > 0;
    const maxAge = (window.WTW_CONFIG && WTW_CONFIG.radarTiles &&
                    WTW_CONFIG.radarTiles.maxAgeMinutes) || 30;
    const stale = state.frameAge !== null && state.frameAge > maxAge;

    let text = 'SIMULATED';
    let title = 'No live radar for this location — showing a simulation based on current conditions';
    let live = false;

    if (hasFrames && state.source === 'tiles' && showingForecast()) {
      // Never call a prediction live, whatever the imagery's age.
      live = false;
      text = 'FORECAST';
      const mins = Math.max(0, Math.round(
        (state.frames[state.frameIndex].time.getTime() - Date.now()) / 60000));
      title = `RainViewer nowcast, ${mins} min ahead — a prediction, not an observation`;
    } else if (hasFrames && state.source === 'tiles') {
      live = !stale;
      text = stale ? 'RADAR (STALE)' : 'LIVE RADAR';
      title = `RainViewer composite, newest frame ${Math.round(state.frameAge)} min old`;
    } else if (hasFrames && state.source === 'nws') {
      live = !stale;
      text = stale ? 'NWS (STALE)' : 'NWS LIVE';
      title = 'NOAA/NWS base reflectivity mosaic';
    }

    badge.textContent = text;
    badge.classList.toggle('live-source', live);
    badge.title = title;
  }

  function showingForecast() {
    const f = state.frames[Math.min(state.frameIndex, state.frames.length - 1)];
    return !!(f && f.forecast);
  }

  function hasTimestampedFrames() {
    return (state.source === 'tiles' || state.source === 'nws') && state.frames.length > 0;
  }

  function clockText(date) {
    return window.WTWUnits ? WTWUnits.time(date)
      : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function timelineLabelText() {
    if (hasTimestampedFrames()) {
      const i = Math.min(state.frameIndex, state.frames.length - 1);
      const frame = state.frames[i];
      if (frame.forecast) {
        const mins = Math.max(1, Math.round((frame.time.getTime() - Date.now()) / 60000));
        return `+${mins} min`;
      }
      const observed = WTWRadarSource.latestObservedIndex
        ? WTWRadarSource.latestObservedIndex(state.frames) : state.frames.length - 1;
      if (i === observed) return 'NOW';
      return clockText(frame.time);
    }
    const back = (cfg().frameMinutes || 60) - Math.round(state.timelineMinute);
    return back <= 0 ? 'NOW' : `-${back} min`;
  }

  /* The wall-clock time of the frame being shown, always visible.

     The timeline label says "NOW" or "+20 min", which is a relation
     rather than a time. On a loop that runs while you watch it, the
     question "what am I actually looking at" needs an answer in
     hours and minutes. */
  function syncFrameClock() {
    const el = document.getElementById('radarFrameClock');
    if (!el) return;
    if (!hasTimestampedFrames()) { el.hidden = true; el.textContent = ''; return; }
    const frame = state.frames[Math.min(state.frameIndex, state.frames.length - 1)];
    if (!frame || !frame.time) { el.hidden = true; return; }
    el.hidden = false;
    el.textContent = clockText(frame.time);
    el.dataset.kind = frame.forecast ? 'forecast' : 'observed';
  }

  /* Stepping one frame at a time. A loop you can only watch is worse
     than one you can walk through — the interesting moment is usually
     between two frames. */
  function step(delta) {
    if (!state.frames.length) return;
    stop();
    state.prevIndex = state.frameIndex;
    state.fade = 1;
    const n = state.frames.length;
    state.frameIndex = ((state.frameIndex + delta) % n + n) % n;
    state.frameAccum = 0;
    updateSourceBadge();
    syncTimelineUI();
    draw();
  }

  function configureTimeline() {
    const slider = document.getElementById('radarTimeline');
    const caption = document.querySelector('.timeline-caption');
    if (!slider) return;
    if (hasTimestampedFrames()) {
      slider.min = '0';
      slider.max = String(state.frames.length - 1);
      slider.step = '1';
      slider.value = String(state.frameIndex);
      if (caption) caption.textContent = clockText(state.frames[0].time);
      setEndCaption();
    } else {
      slider.min = '0';
      slider.max = String(cfg().frameMinutes || 60);
      slider.step = '1';
      slider.value = String(Math.round(state.timelineMinute));
      if (caption) caption.textContent = `-${cfg().frameMinutes || 60} min`;
      setEndCaption();
    }
    syncTimelineUI();
  }

  // What the right-hand end of the timeline is: the present, or the far
  // edge of the forecast when there is one.
  function setEndCaption() {
    const el = document.getElementById('radarTimelineEnd');
    if (!el) return;
    const last = state.frames[state.frames.length - 1];
    if (hasTimestampedFrames() && last && last.forecast) {
      const mins = Math.max(1, Math.round((last.time.getTime() - Date.now()) / 60000));
      el.textContent = `+${mins} min`;
      el.hidden = false;
      el.classList.add('is-forecast');
      el.title = 'Forecast frames from the RainViewer nowcast';
      return;
    }
    // Without forecast frames the right-hand end is simply the present,
    // which the label beside it already says. Two NOWs in a row is
    // noise, so this only appears when it has something to add.
    el.hidden = true;
    el.classList.remove('is-forecast');
    el.removeAttribute('title');
  }

  function syncTimelineUI() {
    syncFrameClock();
    const slider = document.getElementById('radarTimeline');
    const label = document.getElementById('radarTimeLabel');
    if (slider && !state.scrubbing) {
      // Any timestamped source drives the thumb from the frame index.
      // Tiles used to fall through to the simulated minute counter,
      // which pinned the thumb to the right-hand end no matter which
      // frame was on screen — invisible while the newest frame was also
      // the last one, and plainly wrong once forecasts sit after it.
      slider.value = hasTimestampedFrames()
        ? String(state.frameIndex) : String(Math.round(state.timelineMinute));
    }
    if (label) label.textContent = timelineLabelText();
  }

  function updateRangeLabel() {
    const el = document.getElementById('radarRange');
    if (!el) return;
    el.textContent = window.WTWUnits ? WTWUnits.range(state.rangeKm) : `${state.rangeKm} km`;
  }

  // Units changed in settings: relabel the rings and the range readout.
  function onUnitsChange() {
    updateRangeLabel();
    syncTimelineUI();
    configureTimeline();
    draw();
  }

  /* ================= Pan / zoom ================= */

  function scheduleRefetch() {
    clearTimeout(state.refetchTimer);
    state.refetchTimer = setTimeout(() => { refresh(state.weatherSeed); }, 700);
  }

  function zoom(direction) {
    const steps = mapCfg().zoomSteps || [40, 75, 150, 250, 400];
    let i = steps.indexOf(state.rangeKm);
    if (i === -1) {
      // Snap to the nearest configured step first.
      i = steps.reduce((best, v, idx) =>
        Math.abs(v - state.rangeKm) < Math.abs(steps[best] - state.rangeKm) ? idx : best, 0);
    }
    // Zooming in means a smaller range.
    const next = Math.max(0, Math.min(steps.length - 1, i + (direction === 'in' ? -1 : 1)));
    if (steps[next] === state.rangeKm) return;
    state.rangeKm = steps[next];
    updateRangeLabel();
    draw();
    scheduleRefetch();
  }

  function recenter() {
    if (!state.coords) return;
    state.center = { lat: state.coords.lat, lon: state.coords.lon };
    draw();
    scheduleRefetch();
  }

  // A press that barely moves is a tap (fullscreen); anything past
  // this many pixels is a pan.
  const TAP_SLOP_PX = 6;
  const TAP_MAX_MS = 600;

  function initPointer(canvas) {
    canvas.addEventListener('pointerdown', (e) => {
      state.dragging = true;
      state.moved = false;
      state.dragStart = { x: e.clientX, y: e.clientY, t: Date.now() };
      state.dragLast = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!state.dragging || !state.dragLast || !state.center) return;
      const dx = e.clientX - state.dragLast.x;
      const dy = e.clientY - state.dragLast.y;
      if (Math.abs(dx) + Math.abs(dy) < 1) return;
      if (state.dragStart &&
          Math.hypot(e.clientX - state.dragStart.x, e.clientY - state.dragStart.y) > TAP_SLOP_PX) {
        state.moved = true;
      }
      state.dragLast = { x: e.clientX, y: e.clientY };
      const radius = Math.min(state.width, state.height) / 2 - 10;
      state.center = WTWMap.panCenter(state.center.lat, state.center.lon,
        currentView(), radius * 2, dx, dy);
      draw();
    });
    const end = (e) => {
      if (!state.dragging) return;
      state.dragging = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) { /* already released */ }

      if (state.moved) {
        scheduleRefetch();
        return;
      }
      // Didn't move: treat it as a tap on the scope.
      const quick = state.dragStart && (Date.now() - state.dragStart.t) < TAP_MAX_MS;
      if (quick && cfg().fullscreenOnTap !== false) toggleFullscreen();
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    // The scope is exposed as a button, so it must respond to keys too.
    canvas.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        toggleFullscreen();
      }
    });
  }

  /* ================= Fullscreen ================= */

  function card() { return document.getElementById('radarCard'); }

  function updateFullscreenUI() {
    const el = card();
    if (el) el.classList.toggle('fullscreen', state.fullscreen);
    document.body.classList.toggle('radar-fullscreen', state.fullscreen);
    const btn = document.getElementById('radarFullscreenBtn');
    if (btn) {
      btn.textContent = state.fullscreen ? '✕ Exit fullscreen' : '⛶ Fullscreen';
      btn.setAttribute('aria-pressed', state.fullscreen ? 'true' : 'false');
    }
    const canvas = state.canvas;
    if (canvas) {
      canvas.setAttribute('title', state.fullscreen
        ? 'Tap the scope to exit fullscreen'
        : 'Tap the scope for fullscreen');
    }
  }

  async function enterFullscreen() {
    if (state.fullscreen) return;
    state.fullscreen = true;
    updateFullscreenUI();
    // The CSS class alone gives a full-viewport scope, which is all
    // iOS Safari supports for non-video elements. Where the real
    // Fullscreen API exists, use it too so browser chrome hides.
    const el = card();
    const request = el && (el.requestFullscreen || el.webkitRequestFullscreen);
    if (request) {
      try { await request.call(el); }
      catch (err) { console.info('[radar] native fullscreen unavailable, using overlay', err && err.message); }
    }
    resize();
  }

  async function exitFullscreen() {
    if (!state.fullscreen) return;
    state.fullscreen = false;
    updateFullscreenUI();
    const active = document.fullscreenElement || document.webkitFullscreenElement;
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (active && exit) {
      try { await exit.call(document); } catch (_) { /* already exited */ }
    }
    resize();
  }

  function toggleFullscreen() {
    state.fullscreen ? exitFullscreen() : enterFullscreen();
  }

  function initFullscreen() {
    // Esc, or the browser's own exit, must keep our state in sync.
    const onChange = () => {
      const active = document.fullscreenElement || document.webkitFullscreenElement;
      if (!active && state.fullscreen) exitFullscreen();
    };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.fullscreen) exitFullscreen();
    });
  }

  /* ================= Public API ================= */

  function play() {
    if (state.playing) return;
    state.playing = true;
    state.lastFrameTime = 0;
    setStatus('SCANNING', true);
    updatePlayButton();
    startLoop();
  }

  function stop() {
    state.playing = false;
    setStatus('PAUSED', false);
    updatePlayButton();
  }

  function toggle() { state.playing ? stop() : play(); }

  function updatePlayButton() {
    const btn = document.getElementById('radarPlayBtn');
    if (!btn) return;
    btn.textContent = state.playing ? '⏸ Pause' : '▶ Play';
    btn.setAttribute('aria-pressed', state.playing ? 'true' : 'false');
  }

  async function refresh(weather) {
    state.lastRefreshAt = Date.now();
    generateCells(weather || state.weatherSeed || {});
    state.timelineMinute = cfg().frameMinutes || 60;

    let live = false;
    if (state.center) {
      try { live = await loadRealFrames(); }
      catch (err) { console.warn('[radar] live imagery failed, using simulation', err); }
    }
    if (!live) { state.source = 'sim'; state.frames = []; }

    configureTimeline();
    setStatus(state.playing ? 'SCANNING' : 'REFRESHED', state.playing);
    draw();
    return live;
  }

  function setLocation(label, weather, coords) {
    state.locationLabel = label || 'Unknown';
    const el = document.getElementById('radarLocationLabel');
    if (el) el.textContent = state.locationLabel;
    if (coords && typeof coords.lat === 'number' && typeof coords.lon === 'number') {
      state.coords = { lat: coords.lat, lon: coords.lon };
      state.center = { lat: coords.lat, lon: coords.lon };
    }
    return refresh(weather);
  }

  function setAlerts(features) {
    state.alerts = Array.isArray(features) ? features.filter((f) => f && f.geometry) : [];
    draw();
  }

  function init(canvasId) {
    state.canvas = document.getElementById(canvasId);
    if (!state.canvas) { console.warn('[radar] canvas not found:', canvasId); return; }

    state.rangeKm = (imgCfg().rangeKm) || 150;
    resize();
    window.addEventListener('resize', resize);
    if (window.ResizeObserver) new ResizeObserver(resize).observe(state.canvas.parentElement);
    initPointer(state.canvas);
    initFullscreen();
    updateFullscreenUI();

    const slider = document.getElementById('radarTimeline');
    if (slider) {
      slider.addEventListener('input', () => {
        state.scrubbing = true;
        if (hasTimestampedFrames()) {
          state.frameIndex = Math.max(0, Math.min(state.frames.length - 1, Number(slider.value)));
        } else {
          state.timelineMinute = Number(slider.value);
        }
        const label = document.getElementById('radarTimeLabel');
        if (label) label.textContent = timelineLabelText();
        // The badge describes the frame on screen, so it has to follow
        // the scrub: dragging into the nowcast must stop it claiming
        // live radar, and dragging back must restore it.
        updateSourceBadge();
        draw();
      });
      const endScrub = () => { state.scrubbing = false; };
      slider.addEventListener('change', endScrub);
      slider.addEventListener('pointerup', endScrub);
      slider.addEventListener('touchend', endScrub);
    }

    generateCells({});
    configureTimeline();
    updateRangeLabel();
    setStatus('STANDBY', false);
    updatePlayButton();
    initVisibility();
    startLoop();
    play();
  }

  // Re-draw with the theme's tile set when the theme changes.
  function onThemeChange() {
    WTWMap.clearCache();
    draw();
  }

  return {
    init, play, stop, toggle, refresh, setLocation, setAlerts, zoom, recenter, step,
    // Repaint without refetching: the opacity slider changes how the
    // frames are drawn, not which frames they are.
    redraw: () => draw(),
    onThemeChange, onUnitsChange, enterFullscreen, exitFullscreen, toggleFullscreen,
    isFullscreen: () => state.fullscreen,
    isAnimating: () => state.rafId !== null,
    // What the scope is currently looking at. Read-only, and a copy, so
    // callers cannot steer the radar through it. Tests assert on this
    // rather than on which network requests happened to go out, which
    // is an implementation detail and a poor proxy for the behaviour.
    getView: () => ({
      center: state.center ? { ...state.center } : null,
      coords: state.coords ? { ...state.coords } : null,
      rangeKm: state.rangeKm,
      source: state.source,
      frameCount: state.frames.length,
      frameIndex: state.frameIndex,
      opacity: radarOpacity(),
      speed: radarSpeed(),
      lastRefreshAt: state.lastRefreshAt,
    }),
  };
})();

window.WTWRadar = WTWRadar;
