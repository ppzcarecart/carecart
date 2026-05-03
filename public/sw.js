// carecart service worker — keeps the shell snappy on mobile and lets the
// PWA install on the home screen. Strategy:
//   - HTML navigations: network-first, fall back to cached "/" on failure
//   - /static/* assets: network-first too (cache only as offline fallback)
// We avoid stale-while-revalidate for static so a new app.js / app.css
// goes live immediately after deploy, no double-reload needed.
// Bump VERSION whenever the activate-time cache wipe should fire.

const VERSION = 'carecart-v42';
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

  // Static assets: network-first so fresh JS/CSS lands without a
  // double-reload after deploy; cache is only the offline fallback.
  if (
    url.pathname.startsWith('/static/') ||
    url.pathname === '/icon.svg' ||
    url.pathname === '/manifest.webmanifest'
  ) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches
            .open(VERSION)
            .then((cache) => cache.put(req, copy))
            .catch(() => {});
          return res;
        })
        .catch(() => caches.match(req)),
    );
  }
});
