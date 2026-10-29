const CACHE_NAME = 'dab-cache-v1';
const TILES_CACHE = 'dab-tiles';
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './vendor/leaflet/leaflet.js',
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/images/layers.png',
  './vendor/leaflet/images/layers-2x.png'
];

// Chemins absolus (ex. /dab/app.js) des fichiers de l'app, pour la stratégie network-first
const APP_PATHS = PRECACHE_ASSETS.map((a) => new URL(a, self.registration.scope).pathname);

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME && key !== TILES_CACHE)
            .map((key) => caches.delete(key))
        )
      )
    ])
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Requêtes Overpass (POST de toute façon) et autres API : jamais interceptées
  if (url.hostname.includes('overpass')) return;

  // Tuiles de cartes : cache-first avec mise en cache à la volée
  if (url.hostname.endsWith('tile.openstreetmap.org') || url.hostname === 'data.geopf.fr') {
    event.respondWith(
      caches.open(TILES_CACHE).then((cache) =>
        cache.match(request).then((cached) => {
          if (cached) return cached;
          return fetch(request).then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          });
        })
      )
    );
    return;
  }

  // Fichiers de l'app : network-first, repli sur le cache hors-ligne
  if (url.origin === self.location.origin &&
      (request.mode === 'navigate' || APP_PATHS.includes(url.pathname))) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  // Reste : cache-first
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});
