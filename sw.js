/**
 * Murbha service worker.
 *
 * Strategy:
 *  - Pre-cache the app shell (manifest + favicon + core CSS/JS).
 *  - Network-first for HTML and /app/* API calls (so users always see
 *    fresh data when online, and the cached shell only on fail).
 *  - Cache-first for fonts, images, .css/.js (stable assets).
 *
 * Versioning: bump CACHE_VERSION on every release to evict stale assets.
 */
'use strict';

const CACHE_VERSION = 'mrb-v1';

// ─── Push notifications ────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'منصة مُرابحة';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    data: { url: data.url || '/' },
    dir: 'rtl',
    lang: 'ar',
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification?.data?.url || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window' });
    for (const c of all) {
      if (new URL(c.url).origin === self.location.origin) {
        c.focus();
        c.navigate(url);
        return;
      }
    }
    self.clients.openWindow(url);
  })());
});

const APP_SHELL = [
  '/',
  '/hessa.html',
  '/login.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/assets/site.css',
  '/app.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    // Pre-cache best-effort; don't fail install if some asset is missing.
    await Promise.allSettled(APP_SHELL.map(p => cache.add(p)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)));
    self.clients.claim();
  })());
});

const isStaticAsset = (url) =>
  /\.(?:css|js|woff2?|ttf|svg|png|jpg|jpeg|webp|ico)(?:\?|$)/i.test(url.pathname);

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // never cache mutating calls
  const url = new URL(req.url);

  // Skip cross-origin entirely. Don't intercept Google Fonts, Resend, etc —
  // they handle their own caching, CSP, and CORS correctly without our help.
  if (url.origin !== self.location.origin) return;

  // Always-network for the API; the app handles offline gracefully.
  if (url.pathname.startsWith('/app/') || url.pathname.startsWith('/api/v1/') || url.pathname.startsWith('/stg/')) return;

  // Cache-first for static assets (long-lived).
  if (isStaticAsset(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const fresh = await fetch(req);
        if (fresh.ok && fresh.type !== 'opaque') cache.put(req, fresh.clone());
        return fresh;
      } catch (e) {
        return cached || Response.error();
      }
    })());
    return;
  }

  // Network-first for HTML. Falls back to cached shell when offline.
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_VERSION);
        if (fresh.ok) cache.put(req, fresh.clone());
        return fresh;
      } catch (e) {
        const cache = await caches.open(CACHE_VERSION);
        const cached = await cache.match(req) || await cache.match('/hessa.html');
        return cached || Response.error();
      }
    })());
  }
});
