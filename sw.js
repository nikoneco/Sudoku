const CACHE_PREFIX = 'sudoku-shell-';
const CACHE_NAME = `${CACHE_PREFIX}v1.0.4`;
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/config.js',
  './js/game/engine.js',
  './js/data/storage.js',
  './js/data/puzzle-repository.js',
  './js/data/api.js',
  './js/ui/icons.js',
  './js/ui/render.js',
  './data/puzzles.json',
  './icons/app-icon.svg',
  './icons/app-icon-180.png',
  './icons/app-icon-192.png',
  './icons/app-icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(SHELL_ASSETS.map((asset) => new Request(new URL(asset, self.registration.scope), { cache: 'reload' })));
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const shell = new URL('./index.html', self.registration.scope).toString();
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(shell);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response.ok) {
          await cache.put(shell, response.clone());
        }
        return response;
      } catch {
        return Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok && url.origin === self.location.origin) {
        await cache.put(request, response.clone());
      }
      return response;
    } catch {
      return Response.error();
    }
  })());
});
