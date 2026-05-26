/**
 * مُرابحة — Service Worker
 * Caches core assets for offline support
 */

const CACHE_NAME = 'murabaha-v3';

const STATIC_ASSETS = [
  '/',
  '/hessa.html',
  '/projects.html',
  '/portfolio.html',
  '/profile.html',
  '/auth.html',
  '/help.html',
  '/shared.css',
  '/shared.js',
  '/404.html',
];

// Install — cache core assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — cache-first for HTML/assets, network-first for API
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Never cache API calls
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Network-first for HTML
  if (event.request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then(r => r || caches.match('/404.html')))
    );
    return;
  }

  // Stale-while-revalidate for CSS/JS/images: serve cache instantly, then
  // refresh it in the background so updated assets (e.g. shared.css) land on
  // the next load instead of being pinned to the version cached at install.
  event.respondWith(
    caches.match(event.request).then(cached => {
      const network = fetch(event.request).then(response => {
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
