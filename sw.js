function getCacheName() {
  const v = new URL(self.registration.scriptURL).searchParams.get('v') || '0';
  return 'sokoban-v' + v;
}

function cache() {
  return caches.open(getCacheName());
}

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
    cache().then((c) => c.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== getCacheName()).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const cacheKey = stripQuery(request.url);

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'no-store' }).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          cache().then((c) => c.put('./index.html', copy));
        }
        return response;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Cache-first with background refresh: serve instantly, always re-fetch in the
  // background so the cached copy is never stale for long.
  event.respondWith(
    caches.match(cacheKey).then((cached) => {
      const network = fetch(request, { cache: 'no-store' }).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          cache().then((c) => c.put(cacheKey, copy));
        }
        return response;
      });
      return cached || network;
    })
  );
});
