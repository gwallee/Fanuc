/* FANUC TP Program Studio service worker.
 * Network-first for same-origin GETs (keeps git-pull freshness), with the
 * cached copy as an offline fallback so the app shell still opens when the
 * bridge is down (file viewing works; robot features need the bridge).
 * /api/ is never cached — live robot data must stay live.
 */
'use strict';
const CACHE = 'tp-studio-shell-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request).then((resp) => {
      if (resp.ok) {
        const copy = resp.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return resp;
    }).catch(() => caches.match(e.request))
  );
});
