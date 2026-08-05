const CACHE = 'grocery-v33';
const ASSETS = [
  './', './index.html', './manifest.json',
  './assets/style.css', './assets/store.js', './assets/app.js',
  './assets/sync-config.js', './assets/sync.js',
  // Vendored rather than hotlinked: addAll cannot precache a cross-origin
  // script (opaque responses fail the install), and the app must boot offline.
  './assets/vendor/supabase-js-2.111.0.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-180.png'
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
/* Cache-first, but ONLY for our own GETs. Returning without calling
   respondWith() hands the request back to the browser's default network path.
   Scoping by origin rather than by an API hostname allowlist can't rot when the
   backend URL changes — and it works because any vendored library is served
   same-origin rather than hotlinked from a CDN. */
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;                       // never serve a mutation from cache
  if (new URL(e.request.url).origin !== self.location.origin) return; // API, CDNs
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
