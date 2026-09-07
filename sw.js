/* DoTo service worker — offline-first app shell for installability */
'use strict';

const CACHE = 'doto-v3';
const CORE = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'manual.html',
  'MANUAL.md',
  'assets/manifest.webmanifest',
  'assets/fonts.css',
  'assets/fonts/KFO7CnqEu92Fr1ME7kSn66aGLdTylUAMa3-UBGEe.woff2',
  'assets/fonts/KFO7CnqEu92Fr1ME7kSn66aGLdTylUAMa3CUBGEe.woff2',
  'assets/fonts/KFO7CnqEu92Fr1ME7kSn66aGLdTylUAMa3GUBGEe.woff2',
  'assets/fonts/KFO7CnqEu92Fr1ME7kSn66aGLdTylUAMa3iUBGEe.woff2',
  'assets/fonts/KFO7CnqEu92Fr1ME7kSn66aGLdTylUAMa3KUBGEe.woff2',
  'assets/fonts/KFO7CnqEu92Fr1ME7kSn66aGLdTylUAMa3OUBGEe.woff2',
  'assets/fonts/KFO7CnqEu92Fr1ME7kSn66aGLdTylUAMa3yUBA.woff2',
  'assets/fonts/KFO7CnqEu92Fr1ME7kSn66aGLdTylUAMawCUBGEe.woff2',
  'assets/fonts/KFO7CnqEu92Fr1ME7kSn66aGLdTylUAMaxKUBGEe.woff2',
  'assets/fonts/gok-H7zzDkdnRel8-DQ6KAXJ69wP1tGnf4ZGhUce.woff2',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'assets/icon-maskable-512.png',
  'assets/icon-180.png',
  'assets/icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cache-first for same-origin GET; navigations fall back to cached shell offline.
self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // fonts, weather APIs: network only
  if (url.pathname.endsWith('version.json')) return; // update detector: always network
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('index.html', copy));
          return res;
        })
        .catch(() => caches.match('index.html').then((r) => r || caches.match('./')))
    );
    return;
  }
  e.respondWith(
    caches.match(request, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(request).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        })
    )
  );
});
