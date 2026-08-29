/* ============================================================
   Aither Weather V20 — map.js
   Web Mercator projection helpers plus a basemap tile layer for
   the radar scope.

   Everything the radar draws — basemap tiles, NOAA reflectivity,
   alert polygons — is projected in EPSG:3857 so the layers line
   up exactly. (V8 requested radar in EPSG:4326, which cannot be
   aligned with Mercator tiles.)

   Tiles come from Carto's free basemaps: no API key, attribution
   to OpenStreetMap and CARTO required and rendered on the card.
   ============================================================ */

const WTWMap = (() => {
  const R = 6378137;                       // Web Mercator sphere radius
  const WORLD = Math.PI * R;               // 20037508.34 m — half the world

  /* ---------------- Projection ---------------- */

  function lonToX(lon) {
    return (lon * Math.PI) / 180 * R;
  }
  function latToY(lat) {
    const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
    const rad = (clamped * Math.PI) / 180;
    return R * Math.log(Math.tan(Math.PI / 4 + rad / 2));
  }
  function xToLon(x) {
    return (x / R) * 180 / Math.PI;
  }
  function yToLat(y) {
    return (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI;
  }

  /* ------------------------------------------------------------
     Mercator distorts distance by 1/cos(latitude), so a scope that
     should cover `rangeKm` of real ground at its centre needs a
     larger span in projected metres.
     ------------------------------------------------------------ */
  function halfExtentMeters(lat, rangeKm) {
    return (rangeKm * 1000) / Math.cos((lat * Math.PI) / 180);
  }

  // The projected square the scope covers.
  function viewBox(lat, lon, rangeKm) {
    const cx = lonToX(lon);
    const cy = latToY(lat);
    const half = halfExtentMeters(lat, rangeKm);
    return { cx, cy, half, minX: cx - half, minY: cy - half, maxX: cx + half, maxY: cy + half };
  }

  // BBOX string for a WMS GetMap request in EPSG:3857.
  function bbox3857(view) {
    return [view.minX, view.minY, view.maxX, view.maxY].join(',');
  }

  /* ---------------- Tiles ---------------- */

  function tileSpan(z) {
    return (2 * WORLD) / Math.pow(2, z);
  }

  // Zoom whose native resolution best matches the canvas resolution.
  function zoomFor(view, canvasPx) {
    const metersPerPx = (view.half * 2) / canvasPx;
    const z = Math.log2((2 * WORLD) / (256 * metersPerPx));
    return Math.max(2, Math.min(12, Math.round(z)));
  }

  const tileCache = new Map();   // url -> HTMLImageElement | 'failed'
  const MAX_CACHE = 220;

  function tileUrl(z, x, y) {
    const cfg = (window.WTW_CONFIG && WTW_CONFIG.map) || {};
    const theme = document.documentElement.getAttribute('data-theme') || 'neon-dark';
    const template = theme === 'light' ? cfg.tileLight : cfg.tileDark;
    if (!template) return null;
    return template.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  }

  function loadTile(url, onReady) {
    if (!url) return null;
    const cached = tileCache.get(url);
    if (cached) return cached === 'failed' ? null : cached;

    const img = new Image();
    // Not setting crossOrigin: the tiles are only ever drawn, never
    // read back, so no CORS headers are needed.
    img.onload = () => { if (typeof onReady === 'function') onReady(); };
    img.onerror = () => { tileCache.set(url, 'failed'); };
    img.src = url;
    tileCache.set(url, img);

    // Keep the cache from growing without bound.
    if (tileCache.size > MAX_CACHE) {
      const oldest = tileCache.keys().next().value;
      tileCache.delete(oldest);
    }
    return img;
  }

  /* ------------------------------------------------------------
     Draw any XYZ tile layer covering `view` into a square canvas
     region of `size` px whose top-left is (originX, originY).
     `buildUrl(z, x, y)` returns a URL or null to skip.
     Returns the number of tiles actually painted.
     ------------------------------------------------------------ */
  function drawTiles(ctx, view, size, originX, originY, buildUrl, onTileReady, opts = {}) {
    const z = Math.max(2, Math.min(opts.maxZoom || 12, zoomFor(view, size)));
    const span = tileSpan(z);
    const metersPerPx = (view.half * 2) / size;
    const n = Math.pow(2, z);

    const minTx = Math.floor((view.minX + WORLD) / span);
    const maxTx = Math.floor((view.maxX + WORLD) / span);
    const minTy = Math.floor((WORLD - view.maxY) / span);
    const maxTy = Math.floor((WORLD - view.minY) / span);

    let painted = 0;
    for (let tx = minTx; tx <= maxTx; tx++) {
      for (let ty = minTy; ty <= maxTy; ty++) {
        if (ty < 0 || ty >= n) continue;
        const wrappedX = ((tx % n) + n) % n;
        const url = buildUrl(z, wrappedX, ty);
        const img = loadTile(url, onTileReady);
        if (!img || !img.complete || img.naturalWidth === 0) continue;

        const tileMinX = -WORLD + tx * span;
        const tileMaxY = WORLD - ty * span;
        const px = originX + (tileMinX - view.minX) / metersPerPx;
        const py = originY + (view.maxY - tileMaxY) / metersPerPx;
        const pw = span / metersPerPx;
        ctx.drawImage(img, px, py, pw + 1, pw + 1);
        painted++;
      }
    }
    return painted;
  }

  /* ------------------------------------------------------------
     Warm the cache for a layer without drawing it. The radar uses this
     on the frame after the one on screen, so a loop that has run once
     never stalls waiting for an image mid-playback.
     ------------------------------------------------------------ */
  function preloadTiles(view, size, buildUrl, opts = {}) {
    const z = Math.max(2, Math.min(opts.maxZoom || 12, zoomFor(view, size)));
    const span = tileSpan(z);
    const n = Math.pow(2, z);
    const minTx = Math.floor((view.minX + WORLD) / span);
    const maxTx = Math.floor((view.maxX + WORLD) / span);
    const minTy = Math.floor((WORLD - view.maxY) / span);
    const maxTy = Math.floor((WORLD - view.minY) / span);

    let requested = 0;
    for (let tx = minTx; tx <= maxTx; tx++) {
      for (let ty = minTy; ty <= maxTy; ty++) {
        if (ty < 0 || ty >= n) continue;
        const url = buildUrl(z, ((tx % n) + n) % n, ty);
        if (url) { loadTile(url); requested++; }
      }
    }
    return requested;
  }

  function drawBasemap(ctx, view, size, originX, originY, onTileReady) {
    const cfg = (window.WTW_CONFIG && WTW_CONFIG.map) || {};
    if (!cfg.enabled) return 0;
    return drawTiles(ctx, view, size, originX, originY,
      (z, x, y) => tileUrl(z, x, y), onTileReady);
  }

  /* ---------------- Geo <-> screen ---------------- */

  function project(lat, lon, view, size, originX, originY) {
    const metersPerPx = (view.half * 2) / size;
    return {
      x: originX + (lonToX(lon) - view.minX) / metersPerPx,
      y: originY + (view.maxY - latToY(lat)) / metersPerPx,
    };
  }

  // Convert a pixel offset (e.g. a drag) into a new centre.
  function panCenter(lat, lon, view, size, dxPx, dyPx) {
    const metersPerPx = (view.half * 2) / size;
    return {
      lat: yToLat(latToY(lat) + dyPx * metersPerPx),
      lon: xToLon(lonToX(lon) - dxPx * metersPerPx),
    };
  }

  function clearCache() {
    tileCache.clear();
  }

  return {
    lonToX, latToY, xToLon, yToLat,
    viewBox, bbox3857, zoomFor, drawBasemap, drawTiles, preloadTiles, project, panCenter, clearCache,
    WORLD,
  };
})();

window.WTWMap = WTWMap;
