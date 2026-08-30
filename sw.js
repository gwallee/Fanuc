/* ============================================================
   Aither Weather V25 — sw.js
   Service worker: precaches the app shell so the app opens
   instantly and works offline, and keeps a runtime cache of the
   last successful weather responses to fall back on.

   Bump CACHE_VERSION whenever shell files change — the old cache
   is deleted on activate.
   ============================================================ */

const CACHE_VERSION = 'wtw-v25-1';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const DATA_CACHE = `${CACHE_VERSION}-data`;

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './config.js',
  './icons.js',
  './weatheranim.js',
  './tiles.js',
  './normals.js',
  './gemini.js',
  './metricsheet.js',
  './storage.js',
  './themes.js',
  './nws.js',
  './units.js',
  './search.js',
  './downloads.js',
  './auth.js',
  './air.js',
  './rain.js',
  './precip.js',
  './tempchart.js',
  './compare.js',
  './map.js',
  './radarsource.js',
  './hourly.js',
  './share.js',
  './local-ai.js',
  './radar.js',
  './app.js',
  './logo.svg',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      // addAll fails the whole install if any single file 404s, so add
      // them individually and tolerate misses.
      .then((cache) => Promise.all(SHELL.map((url) =>
        cache.add(url).catch((err) => console.warn('[sw] skipped', url, err))
      )))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isWeatherApi =
    url.hostname === 'api.weather.gov' ||
    url.hostname.endsWith('open-meteo.com') ||
    url.hostname === 'api.zippopotam.us' ||
    url.hostname === 'api.met.no';

  // Weather data: network first, fall back to the last good response.
  if (isWeatherApi) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(DATA_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          // respondWith(undefined) throws a TypeError in the page, which
          // would turn "offline" into an unhandled failure. Answer with a
          // real 503 so the app can fall back to its saved snapshot.
          return offlineResponse();
        })
    );
    return;
  }

  // Radar imagery and basemap tiles: always live, never cached.
  if (url.hostname.includes('ncep.noaa.gov') || url.hostname.includes('cartocdn.com') ||
      url.hostname.includes('rainviewer.com')) return;

  // Sign-in must always reach Google and Microsoft directly; caching any
  // of it would be both broken and a bad idea.
  if (url.hostname.endsWith('google.com') || url.hostname.endsWith('googleapis.com') ||
      url.hostname.endsWith('googleusercontent.com') || url.hostname.endsWith('gstatic.com') ||
      url.hostname.endsWith('microsoftonline.com') || url.hostname.endsWith('msauth.net') ||
      url.hostname.endsWith('msftauth.net') || url.hostname.endsWith('live.com') ||
      url.hostname.endsWith('microsoft.com') ||
      url.hostname.endsWith('apple.com')) return;

  // The page itself is network-first. Cache-first on the document is how
  // a deployed update can go unseen for a whole session: the browser
  // keeps handing back the old HTML, which pulls the old scripts with it.
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => (await caches.match(request)) ||
                          (await caches.match('./index.html')) ||
                          offlineResponse())
    );
    return;
  }

  // App shell: cache first, refreshed in the background.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request).then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }).catch(() => cached || offlineResponse());
        return cached || network;
      })
    );
  }
});

// Never resolve respondWith with undefined.
function offlineResponse() {
  return new Response(
    JSON.stringify({ error: 'offline', message: 'No network and nothing cached for this request.' }),
    { status: 503, statusText: 'Offline', headers: { 'Content-Type': 'application/json' } }
  );
}
