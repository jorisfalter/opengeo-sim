// A cupboard for tiles.
//
// Every visit used to start from nothing: the same Alpine terrain, the same
// orthophotography, downloaded again because the browser's own cache is small
// and evicted by whatever else you have been doing. This keeps the tiles in
// storage that belongs to the site, so the second flight over a valley starts
// with the valley already there.
//
// It deliberately touches nothing of our own origin. A service worker that
// intercepts the application itself can break the site in a way that survives
// a reload, and no amount of speed is worth that. If this file is broken, the
// simulator still loads; only the tiles go back to being fetched every time.
const CACHE = 'opengeo-tiles-v1';
const HOSTS = new Set([
  'terrain.reearth.land',
  'data.geopf.fr',
  'tiles.maps.eox.at',
  'wmts.geo.admin.ch',
  'service.pdok.nl',
  'api.pdok.nl',
  'geo.api.vlaanderen.be',
]);
// Roughly a few hundred megabytes of tiles. The browser will evict the whole
// cache if the origin runs out of quota, which is a fine failure mode.
const MAX_ENTRIES = 4000;
const TRIM_EVERY = 200;
let sinceTrim = 0;

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== CACHE && n.startsWith('opengeo-')).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

/** Oldest first is close enough to least-recently-used for map tiles. */
async function trim(cache) {
  const keys = await cache.keys();
  if (keys.length <= MAX_ENTRIES) return;
  const drop = keys.slice(0, keys.length - MAX_ENTRIES + Math.floor(MAX_ENTRIES * 0.1));
  await Promise.all(drop.map((k) => cache.delete(k)));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (!HOSTS.has(url.hostname)) return;
  if (url.searchParams.has('nocache')) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(request);
      if (hit) return hit;
      const response = await fetch(request);
      // Only keep answers worth keeping. An error page cached for a week is
      // how a transient outage becomes a permanent hole in the landscape.
      if (response.ok || response.type === 'opaque') {
        cache.put(request, response.clone()).then(() => {
          if ((sinceTrim += 1) >= TRIM_EVERY) {
            sinceTrim = 0;
            return trim(cache);
          }
          return undefined;
        }).catch(() => {});
      }
      return response;
    })(),
  );
});
