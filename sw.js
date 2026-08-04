const CACHE_NAME = 'sokoban-v9';
const CORE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './version.js',
  './config.js',
  './shapeGenerator.js',
  './solver.js',
  './renderer.js',
  './game.js',
  './manifest.json',
  './icons/icon-192-v2.png',
  './icons/icon-512-v2.png',
];

function stripQuery(url) {
  const u = new URL(url);
  u.search = '';
  return u.href;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const cacheKey = request.mode === 'navigate'
    ? './index.html'
    : stripQuery(request.url);

  event.respondWith(
    fetch(request, { cache: 'no-store' }).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(cacheKey, copy));
      }
      return response;
    }).catch(() => caches.match(cacheKey))
  );
});
