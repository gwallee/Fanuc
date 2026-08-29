/* weatheranim.js — the moving weather under the temperature.

   A single canvas strip beneath the hero, drawn to match whatever is
   actually happening outside: rain falls, snow drifts, cloud slides,
   the sun breathes, lightning cracks, fog rolls. It is decoration, so
   it is aria-hidden and it never blocks anything.

   Three rules keep it honest:

     - It stops when nobody can see it. A hidden tab, a scrolled-away
       card, and a switched-off setting all park the loop rather than
       throttle it, so a phone in a pocket is not painting frames.
     - It obeys prefers-reduced-motion. Somebody who has asked the
       system for stillness gets one static frame, not a slower storm.
     - It owns no state the app needs. Losing it costs a picture.

   The particle counts are deliberately small — this sits under a card
   people read, not a screensaver. */
const WTWScene = (() => {
  'use strict';

  const TAU = Math.PI * 2;
  const REDUCE = typeof matchMedia === 'function'
    ? matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false, addEventListener: () => {} };

  let canvas = null, ctx = null, host = null;
  let raf = 0, running = false, enabled = true, visible = true;
  let w = 0, h = 0, dpr = 1;
  let scene = 'clear', isDay = true;
  let last = 0, bolt = 0, boltAt = 0;
  const drops = [], flakes = [], clouds = [], sparks = [];

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

  /* ---------------- Populating a scene ---------------- */

  const rand = (a, b) => a + Math.random() * (b - a);

  function seed() {
    drops.length = flakes.length = clouds.length = sparks.length = 0;
    const area = Math.max(1, w * h) / (360 * 90);      // scale with the strip

    if (scene === 'rain' || scene === 'storm' || scene === 'sleet') {
      const n = Math.round((scene === 'storm' ? 46 : 34) * area);
      for (let i = 0; i < n; i++) {
        drops.push({ x: rand(0, w), y: rand(0, h), len: rand(7, 16),
                     vy: rand(150, 260), vx: rand(-26, -8) });
      }
    }
    if (scene === 'snow' || scene === 'sleet') {
      const n = Math.round((scene === 'sleet' ? 12 : 30) * area);
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
    const cloudCount = scene === 'fog' ? 4
      : (scene === 'clear' ? 1 : 3);
    for (let i = 0; i < cloudCount; i++) {
      clouds.push({ x: rand(-w * 0.2, w), y: rand(h * 0.12, h * 0.6),
                    scale: rand(0.7, 1.35), vx: rand(4, 14) * (scene === 'storm' ? 2 : 1),
                    alpha: rand(0.16, 0.4) });
    }
  }

  /* ---------------- Drawing ---------------- */

  function bg() {
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
    const s = c.scale * (h / 90);
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
    const cx = w * 0.5, cy = h * 0.5;
    const pulse = 1 + Math.sin(last / 900) * 0.05;
    const r = Math.min(h * 0.42, 34) * pulse;
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
    ctx.globalAlpha = Math.min(1, bolt) * 0.55;
    ctx.fillStyle = '#e8ecff';
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = Math.min(1, bolt);
    ctx.strokeStyle = '#f4f6ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    let x = boltAt, y = 0;
    ctx.moveTo(x, y);
    while (y < h) {
      y += h / 5;
      x += rand(-14, 14);
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
        ctx.globalAlpha = 0.25 + Math.abs(Math.sin(s.phase)) * 0.5;
        ctx.fillStyle = isDay ? '#fff3d0' : '#dfe6ff';
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    for (const c of clouds) {
      c.x += c.vx * dt;
      if (c.x - 60 > w) c.x = -60;
      puff(c);
    }

    if (drops.length) {
      ctx.strokeStyle = scene === 'sleet' ? 'rgba(200, 224, 255, 0.75)'
                                          : 'rgba(150, 200, 255, 0.75)';
      ctx.lineWidth = 1.3;
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
      const slide = (last / 40) % w;
      band.addColorStop(0, 'rgba(220, 226, 238, 0.05)');
      band.addColorStop(0.5, `rgba(220, 226, 238, ${0.16 + Math.sin(slide / 60) * 0.05})`);
      band.addColorStop(1, 'rgba(220, 226, 238, 0.05)');
      ctx.fillStyle = band;
      ctx.fillRect(0, h * 0.35, w, h * 0.5);
    }

    if (scene === 'storm') {
      bolt -= dt * 2.6;
      if (bolt <= -rand(0.5, 2.4)) { bolt = 1; boltAt = rand(w * 0.2, w * 0.8); }
      lightning();
    }
  }

  /* ---------------- The loop ---------------- */

  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    draw(dt);
    raf = requestAnimationFrame(frame);
  }

  function shouldRun() {
    return enabled && visible && !!ctx && !REDUCE.matches &&
      (typeof document === 'undefined' || !document.hidden);
  }

  function start() {
    if (!ctx) return;
    if (!shouldRun()) {
      // Still worth one frame: a still picture of the weather beats an
      // empty rectangle where a picture ought to be.
      if (ctx && enabled && visible) { last = performance.now(); draw(0); }
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
    const rect = host.getBoundingClientRect();
    const cssW = Math.max(120, Math.round(rect.width));
    const cssH = Math.max(56, Math.round(cssW * 0.22));
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.style.height = cssH + 'px';
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    w = cssW; h = cssH;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed();
  }

  /* ---------------- Public surface ---------------- */

  function init() {
    host = document.getElementById('wxScene');
    canvas = document.getElementById('wxSceneCanvas');
    if (!host || !canvas || !canvas.getContext) return;
    ctx = canvas.getContext('2d');
    resize();

    window.addEventListener('resize', () => { resize(); if (!running) start(); });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stop(); else start();
    });
    if (REDUCE.addEventListener) {
      REDUCE.addEventListener('change', () => { stop(); start(); });
    }
    // A card scrolled off screen is not worth animating.
    if (typeof IntersectionObserver === 'function') {
      new IntersectionObserver((entries) => {
        visible = entries.some((e) => e.isIntersecting);
        if (visible) start(); else stop();
      }, { threshold: 0.01 }).observe(host);
    }
  }

  /* Point it at a weather code. Re-seeding only when the scene really
     changes keeps a refresh from restarting the rain mid-fall. */
  function set(code, day) {
    const next = sceneFor(code);
    const changed = next !== scene || day !== isDay;
    scene = next;
    isDay = day !== false;
    if (host) {
      host.dataset.scene = scene;
      host.hidden = !enabled;
    }
    if (!ctx) return;
    if (changed) seed();
    start();
  }

  function setEnabled(on) {
    enabled = !!on;
    if (host) host.hidden = !enabled;
    if (enabled) { resize(); start(); } else { stop(); }
  }

  return { init, set, setEnabled, start, stop,
           current: () => scene, isRunning: () => running,
           sceneFor, scenes: () => Object.assign({}, SCENE_FOR) };
})();

window.WTWScene = WTWScene;
