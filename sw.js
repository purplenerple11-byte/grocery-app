const CACHE = 'grocery-v65';
const ASSETS = [
  './', './index.html', './manifest.json',
  // A standalone page, so it needs its own entry — the app shell does not
  // pull it in. Precached because Play requires the policy to be reachable
  // and an installed app that is offline is still an installed app.
  // NOTE: .well-known/assetlinks.json is deliberately NOT here. Android
  // fetches it at install time, outside the page and outside this worker.
  './privacy.html',
  './assets/style.css', './assets/version.js', './assets/store.js', './assets/app.js',
  // Self-hosted so the serif survives offline. A missing font here would not
  // fail loudly — it would silently fall back to Georgia on the device only.
  './assets/fraunces-latin.woff2',
  './assets/patch-notes.js', './assets/sync-config.js', './assets/sync.js',
  // Vendored rather than hotlinked: addAll cannot precache a cross-origin
  // script (opaque responses fail the install), and the app must boot offline.
  './assets/vendor/supabase-js-2.111.0.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-180.png',
  './icons/icon-512-maskable.png', './icons/favicon-32.png', './icons/favicon-16.png'
];
/* `cache: 'reload'` bypasses the HTTP cache while precaching, so a bumped CACHE
   can't be filled with the very stale files the bump exists to replace.
   NOTE: addAll rejects atomically — a single 404 fails the whole install and
   leaves the app without a service worker. Never list a file before it ships. */
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
/* Stale-while-revalidate: serve from cache immediately (fast + offline),
   then silently fetch fresh copies in the background. The NEXT load gets
   any updates — no waiting, no spinners, no user-visible delay. */
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;                       // never serve a mutation from cache
  if (new URL(e.request.url).origin !== self.location.origin) return; // API, CDNs
  e.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(e.request).then((cached) => {
        const networkFetch = fetch(e.request).then((response) => {
          cache.put(e.request, response.clone());
          return response;
        }).catch(() => cached);  // offline fallback
        return cached || networkFetch;
      })
    )
  );
});
