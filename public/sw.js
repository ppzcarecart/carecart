// carecart service worker — keeps the shell snappy on mobile and lets the
// PWA install on the home screen. Strategy:
//   - HTML navigations: network-first, fall back to cached "/" on failure
//   - /static/* assets: stale-while-revalidate
// Bump VERSION when /static/app.{css,js} change in a way that needs purge.

const VERSION = 'carecart-v1';
const SHELL = ['/', '/static/app.css', '/static/app.js', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(SHELL)).catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // Don't intercept API or webhook traffic — needs fresh data, and we
  // don't want to mask auth errors.
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/uploads/')) return;

  // HTML navigations: network-first, fall back to the cached home shell.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Update the shell entry so an offline reload still renders.
          const copy = res.clone();
          caches.open(VERSION).then((cache) => cache.put('/', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('/')),
    );
    return;
  }

  // Static assets: stale-while-revalidate.
  if (url.pathname.startsWith('/static/') || url.pathname === '/icon.svg' || url.pathname === '/manifest.webmanifest') {
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            const copy = res.clone();
            caches.open(VERSION).then((cache) => cache.put(req, copy)).catch(() => {});
            return res;
          })
          .catch(() => cached);
        return cached || network;
      }),
    );
  }
});
