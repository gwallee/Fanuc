/* weatheranim.js — the sky, drawn to match the weather.

   Two surfaces share one engine:

     - the backdrop, filling the window behind the whole app
     - the strip under the hero temperature

   Both are told the same weather code at the same moment, so they can
   never show different weather. The colour of the sky is not painted
   here: it is a set of CSS custom properties keyed off data-sky and
   data-daynight on the root element, which means the page is the right
   colour even with the animation switched off, and every card that
   reads --card-bg follows along.

   Three rules keep the animation honest:

     - It stops when nobody can see it. A hidden tab, a scrolled-away
       strip, and a switched-off setting all park the loop rather than
       throttle it, so a phone in a pocket is not painting frames.
     - It obeys prefers-reduced-motion. Somebody who has asked the
       system for stillness gets one static frame, not a slower storm.
     - It owns no state the app needs. Losing it costs a picture. */
const WTWScene = (() => {
  'use strict';

  const TAU = Math.PI * 2;
  const REDUCE = typeof matchMedia === 'function'
    ? matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false, addEventListener: () => {} };

  const rand = (a, b) => a + Math.random() * (b - a);

  /* ---------------- Which scene goes with which sky ---------------- */

  /* Named for what the sky is doing, not for a WMO number: the icon
     set already turns codes into names, and two things naming the
     same weather differently is how they drift apart. */
  const SCENE_FOR = {
    'clear': 'clear', 'mostly-clear': 'clear', 'partly-cloudy': 'clouds',
    'overcast': 'clouds', 'fog': 'fog',
    'drizzle': 'rain', 'showers': 'rain',
    'rain-light': 'rain', 'rain': 'rain', 'rain-heavy': 'rain',
    'sleet': 'sleet',
    'snow-light': 'snow', 'snow': 'snow', 'snow-heavy': 'snow',
    'thunder': 'storm',
    'unknown': 'clouds',
  };

  function sceneFor(code) {
    const name = (window.WTWIcons && WTWIcons.nameFor)
      ? WTWIcons.nameFor(code) : 'unknown';
    return SCENE_FOR[name] || 'clouds';
  }

  /* ============================================================
     One animated surface. The engine is written once and used for
     both the backdrop and the strip; only the density of the
     weather and how the canvas is sized differ.
     ============================================================ */
  function makeLayer({ hostId, canvasId, fullscreen }) {
    let canvas = null, ctx = null, host = null;
    let raf = 0, running = false, enabled = true, visible = true;
    let w = 0, h = 0;
    let scene = 'clear', isDay = true;
    let last = 0, bolt = 0, boltAt = 0;
    const drops = [], flakes = [], clouds = [], sparks = [];

    /* ---------------- Populating a scene ---------------- */

    function seed() {
      drops.length = flakes.length = clouds.length = sparks.length = 0;
      // Density scales with area so a phone is not drawing a desktop's
      // worth of rain, and a wide window is not half empty.
      const area = Math.max(1, w * h) / (fullscreen ? (900 * 700) : (360 * 90));
      const heavy = fullscreen ? 1.6 : 1;

      if (scene === 'rain' || scene === 'storm' || scene === 'sleet') {
        const n = Math.round((scene === 'storm' ? 46 : 34) * area * heavy);
        for (let i = 0; i < n; i++) {
          drops.push({ x: rand(0, w), y: rand(0, h), len: rand(7, 16) * (fullscreen ? 1.4 : 1),
                       vy: rand(150, 260) * (fullscreen ? 1.5 : 1), vx: rand(-26, -8) });
        }
      }
      if (scene === 'snow' || scene === 'sleet') {
        const n = Math.round((scene === 'sleet' ? 12 : 30) * area * heavy);
        for (let i = 0; i < n; i++) {
          flakes.push({ x: rand(0, w), y: rand(0, h), r: rand(1.1, 2.6),
                        vy: rand(14, 34), drift: rand(6, 18), phase: rand(0, TAU) });
        }
      }
      if (scene === 'clear') {
        const n = Math.round(10 * area);
        for (let i = 0; i < n; i++) {
          sparks.push({ x: rand(0, w), y: rand(0, h), r: rand(0.7, 1.8),
                        phase: rand(0, TAU), speed: rand(0.6, 1.6) });
        }
      }
      const cloudCount = Math.max(1, Math.round(
        (scene === 'fog' ? 4 : (scene === 'clear' ? 1 : 3)) * (fullscreen ? 1.8 : 1)));
      for (let i = 0; i < cloudCount; i++) {
        clouds.push({ x: rand(-w * 0.2, w), y: rand(h * 0.08, h * (fullscreen ? 0.55 : 0.6)),
                      scale: rand(0.7, 1.35) * (fullscreen ? 2.2 : 1),
                      vx: rand(4, 14) * (scene === 'storm' ? 2 : 1),
                      alpha: rand(0.1, 0.3) });
      }
    }

    /* ---------------- Drawing ---------------- */

    /* On the backdrop the page's own gradient is already the sky, so
       the canvas only adds the weather. On the strip there is no page
       gradient behind it, so it paints its own. */
    function bg() {
      if (fullscreen) return;
      // With a sky behind the whole page, the strip painting its own
      // gradient reads as a pale band stuck across the card. Let the
      // particles drift over the card instead.
      const sky = document.documentElement.dataset.sky;
      if (sky && sky !== 'none') return;
      const g = ctx.createLinearGradient(0, 0, 0, h);
      if (scene === 'storm') {
        g.addColorStop(0, 'rgba(60, 68, 110, 0.55)');
        g.addColorStop(1, 'rgba(18, 20, 38, 0.15)');
      } else if (scene === 'fog') {
        g.addColorStop(0, 'rgba(150, 158, 176, 0.34)');
        g.addColorStop(1, 'rgba(120, 128, 148, 0.08)');
      } else if (scene === 'snow' || scene === 'sleet') {
        g.addColorStop(0, 'rgba(120, 156, 200, 0.36)');
        g.addColorStop(1, 'rgba(90, 120, 165, 0.08)');
      } else if (scene === 'rain') {
        g.addColorStop(0, 'rgba(70, 110, 165, 0.42)');
        g.addColorStop(1, 'rgba(40, 66, 110, 0.08)');
      } else if (isDay) {
        g.addColorStop(0, 'rgba(255, 196, 96, 0.30)');
        g.addColorStop(1, 'rgba(120, 180, 255, 0.08)');
      } else {
        g.addColorStop(0, 'rgba(80, 96, 170, 0.34)');
        g.addColorStop(1, 'rgba(20, 24, 54, 0.08)');
      }
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }

    function puff(c) {
      const s = c.scale * (fullscreen ? 1 : (h / 90));
      ctx.globalAlpha = c.alpha;
      ctx.fillStyle = scene === 'storm' ? '#5a628a'
        : (scene === 'fog' ? '#c6ccd8' : '#9fb0cc');
      ctx.beginPath();
      ctx.arc(c.x, c.y, 16 * s, 0, TAU);
      ctx.arc(c.x + 18 * s, c.y + 4 * s, 12 * s, 0, TAU);
      ctx.arc(c.x - 18 * s, c.y + 5 * s, 11 * s, 0, TAU);
      ctx.arc(c.x + 4 * s, c.y - 9 * s, 12 * s, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    function sunOrMoon() {
      const cx = fullscreen ? w * 0.74 : w * 0.5;
      const cy = fullscreen ? h * 0.16 : h * 0.5;
      const pulse = 1 + Math.sin(last / 900) * 0.05;
      const r = (fullscreen ? Math.min(w, h) * 0.09 : Math.min(h * 0.42, 34)) * pulse;
      const g = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * 2.4);
      if (isDay) {
        g.addColorStop(0, 'rgba(255, 214, 120, 0.75)');
        g.addColorStop(1, 'rgba(255, 190, 80, 0)');
      } else {
        g.addColorStop(0, 'rgba(200, 214, 255, 0.6)');
        g.addColorStop(1, 'rgba(150, 170, 255, 0)');
      }
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 2.4, 0, TAU);
      ctx.fill();
    }

    function lightning() {
      if (bolt <= 0) return;
      ctx.globalAlpha = Math.min(1, bolt) * (fullscreen ? 0.3 : 0.55);
      ctx.fillStyle = '#e8ecff';
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = Math.min(1, bolt);
      ctx.strokeStyle = '#f4f6ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      let x = boltAt, y = 0;
      ctx.moveTo(x, y);
      const steps = fullscreen ? 9 : 5;
      while (y < h) {
        y += h / steps;
        x += rand(-14, 14) * (fullscreen ? 2 : 1);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    function draw(dt) {
      ctx.clearRect(0, 0, w, h);
      bg();

      if (scene === 'clear') {
        sunOrMoon();
        for (const s of sparks) {
          s.phase += dt * s.speed;
          ctx.globalAlpha = (0.25 + Math.abs(Math.sin(s.phase)) * 0.5) * (fullscreen ? 0.7 : 1);
          ctx.fillStyle = isDay ? '#fff3d0' : '#dfe6ff';
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r, 0, TAU);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      for (const c of clouds) {
        c.x += c.vx * dt;
        if (c.x - 60 * c.scale > w) c.x = -60 * c.scale;
        puff(c);
      }

      if (drops.length) {
        ctx.strokeStyle = scene === 'sleet' ? 'rgba(215, 235, 255, 0.8)'
                                            : 'rgba(200, 226, 255, 0.72)';
        ctx.lineWidth = fullscreen ? 1.6 : 1.3;
        ctx.beginPath();
        for (const d of drops) {
          d.y += d.vy * dt;
          d.x += d.vx * dt;
          if (d.y > h) { d.y = -d.len; d.x = rand(0, w + 40); }
          ctx.moveTo(d.x, d.y);
          ctx.lineTo(d.x + d.vx * 0.05, d.y + d.len);
        }
        ctx.stroke();
      }

      if (flakes.length) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        for (const f of flakes) {
          f.phase += dt;
          f.y += f.vy * dt;
          f.x += Math.sin(f.phase) * f.drift * dt;
          if (f.y - f.r > h) { f.y = -f.r; f.x = rand(0, w); }
          ctx.beginPath();
          ctx.arc(f.x, f.y, f.r, 0, TAU);
          ctx.fill();
        }
      }

      if (scene === 'fog') {
        const band = ctx.createLinearGradient(0, h * 0.45, w, h * 0.75);
        const slide = (last / 40) % Math.max(1, w);
        band.addColorStop(0, 'rgba(220, 226, 238, 0.04)');
        band.addColorStop(0.5, `rgba(220, 226, 238, ${0.14 + Math.sin(slide / 60) * 0.05})`);
        band.addColorStop(1, 'rgba(220, 226, 238, 0.04)');
        ctx.fillStyle = band;
        ctx.fillRect(0, h * 0.3, w, h * 0.55);
      }

      if (scene === 'storm') {
        bolt -= dt * 2.6;
        if (bolt <= -rand(0.5, 2.4)) { bolt = 1; boltAt = rand(w * 0.2, w * 0.8); }
        lightning();
      }
    }

    /* ---------------- The loop ---------------- */

    /* The backdrop is a full window of canvas at up to 2x pixel
       density, and it is scenery — nobody is going to notice 30fps
       drifting cloud, and a phone in a pocket will notice 60. The
       strip is small enough to run free.

       Skipping a frame is not the same as slowing the weather down:
       dt is real elapsed time either way, so the rain falls at the
       same speed and simply updates half as often. */
    const MIN_MS = fullscreen ? 1000 / 30 : 0;

    function frame(now) {
      if (!running) return;
      raf = requestAnimationFrame(frame);
      const elapsed = now - last;
      if (elapsed < MIN_MS) return;
      const dt = Math.min(0.05, elapsed / 1000 || 0.016);
      last = now;
      draw(dt);
    }

    function shouldRun() {
      return enabled && visible && !!ctx && !REDUCE.matches &&
        (typeof document === 'undefined' || !document.hidden);
    }

    function start() {
      if (!ctx) return;
      if (!shouldRun()) {
        // Still worth one frame: a still picture of the weather beats
        // an empty rectangle where a picture ought to be.
        if (enabled && visible) { last = performance.now(); draw(0); }
        return;
      }
      if (running) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }

    function stop() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    }

    /* ---------------- Size ---------------- */

    function resize() {
      if (!canvas || !host) return;
      let cssW, cssH;
      if (fullscreen) {
        cssW = Math.max(120, window.innerWidth);
        cssH = Math.max(120, window.innerHeight);
      } else {
        const rect = host.getBoundingClientRect();
        cssW = Math.max(120, Math.round(rect.width));
        cssH = Math.max(56, Math.round(cssW * 0.22));
        canvas.style.height = cssH + 'px';
      }
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      w = cssW; h = cssH;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    }

    /* ---------------- Wiring ---------------- */

    function init() {
      host = document.getElementById(hostId);
      canvas = document.getElementById(canvasId);
      if (!host || !canvas || !canvas.getContext) return false;
      ctx = canvas.getContext('2d');
      resize();
      // The backdrop is always in view by definition; only the strip
      // is worth watching for.
      if (!fullscreen && typeof IntersectionObserver === 'function') {
        new IntersectionObserver((entries) => {
          visible = entries.some((e) => e.isIntersecting);
          if (visible) start(); else stop();
        }, { threshold: 0.01 }).observe(host);
      }
      return true;
    }

    function set(next, day) {
      const changed = next !== scene || day !== isDay;
      scene = next;
      isDay = day !== false;
      if (host) {
        host.dataset.scene = scene;
        host.hidden = !enabled;
      }
      if (!ctx) return;
      if (changed) { resize(); }
      start();
    }

    function setEnabled(on) {
      enabled = !!on;
      if (host) host.hidden = !enabled;
      if (enabled) { resize(); start(); } else { stop(); }
    }

    return { init, set, setEnabled, start, stop, resize,
             isRunning: () => running, current: () => scene,
             isEnabled: () => enabled };
  }

  /* ============================================================
     The two surfaces, driven together.
     ============================================================ */

  const strip = makeLayer({ hostId: 'wxScene', canvasId: 'wxSceneCanvas', fullscreen: false });
  const backdrop = makeLayer({ hostId: 'skyBackdrop', canvasId: 'skyCanvas', fullscreen: true });
  const layers = [strip, backdrop];

  let scene = 'clear', isDay = true;
  let background = 'animated';       // animated | gradient | off

  /* The page's colours come from data attributes rather than from
     anything painted here, so the sky is the right colour with the
     animation off, at first paint, and behind every card. */
  function paintPage() {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.dataset.sky = background === 'off' ? 'none' : scene;
    root.dataset.daynight = isDay ? 'day' : 'night';
  }

  function init() {
    layers.forEach((l) => l.init());
    backdrop.setEnabled(background === 'animated');
    paintPage();

    window.addEventListener('resize', () => {
      layers.forEach((l) => { l.resize(); l.start(); });
    });
    document.addEventListener('visibilitychange', () => {
      layers.forEach((l) => (document.hidden ? l.stop() : l.start()));
    });
    if (REDUCE.addEventListener) {
      REDUCE.addEventListener('change', () => {
        layers.forEach((l) => { l.stop(); l.start(); });
      });
    }
  }

  /* Point it at a weather code. Both surfaces and the page colour
     change in the same call, so they cannot drift apart. */
  function set(code, day) {
    scene = sceneFor(code);
    isDay = day !== false;
    paintPage();
    layers.forEach((l) => l.set(scene, isDay));
  }

  // The strip's own switch, kept as it was.
  function setEnabled(on) {
    strip.setEnabled(on);
  }

  /* How much of the sky the page itself shows: the full animation, the
     colours only, or nothing but the plain theme. */
  function setBackground(mode) {
    background = ['animated', 'gradient', 'off'].includes(mode) ? mode : 'animated';
    backdrop.setEnabled(background === 'animated');
    paintPage();
  }

  return {
    init, set, setEnabled, setBackground,
    start: () => layers.forEach((l) => l.start()),
    stop: () => layers.forEach((l) => l.stop()),
    current: () => scene,
    isRunning: () => strip.isRunning(),
    backdropRunning: () => backdrop.isRunning(),
    background: () => background,
    sceneFor, scenes: () => Object.assign({}, SCENE_FOR),
  };
})();

window.WTWScene = WTWScene;
