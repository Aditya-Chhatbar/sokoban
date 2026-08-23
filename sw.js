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
    // Never let a broken/rejected Cache API fail the install - a worker that
    // fails to install can never replace an older, buggier one.
    cache()
      .then((c) => c.addAll(CORE_ASSETS))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== getCacheName()).map((k) => caches.delete(k)))
      )
      .catch(() => {})
      .then(() => self.clients.claim())
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
      fetch(request, { cache: 'no-store' })
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            cache().then((c) => c.put('./index.html', copy));
          }
          return response;
        })
        .catch(() =>
          cache()
            .then((c) => c.match('./index.html'))
            .then((cached) => cached || fetch(request))
            .catch(() => fetch(request))
        )
    );
    return;
  }

  // Cache-first with background refresh: serve instantly, always re-fetch in the
  // background so the cached copy is never stale for long. Only match inside the
  // current version's cache so a stale old-version entry is never served. Any
  // cache failure falls back to the network so the app can never go dark.
  event.respondWith(
    (async () => {
      try {
        const c = await cache();
        const cached = await c.match(cacheKey);
        if (cached) {
          fetch(request, { cache: 'no-store' })
            .then((response) => { if (response.ok) c.put(cacheKey, response.clone()); })
            .catch(() => {});
          return cached;
        }
      } catch (e) { /* cache unavailable - go to network */ }
      return fetch(request);
    })()
  );
});
