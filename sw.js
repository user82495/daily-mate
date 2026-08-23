/*
 * sw.js — offline support.
 *
 * The whole app is a fixed set of static files, so the service worker simply
 * precaches all of them on install and serves cache-first afterwards. There is
 * no runtime data to fetch: puzzles ship inside puzzles.js and every scrap of
 * player state lives in localStorage, so once installed the game works with no
 * network at all.
 *
 * Bump CACHE when any shipped file changes — the old cache is then dropped on
 * activate, and clients pick the new one up on their next load.
 */

const CACHE = 'dailymate-v9';

const ASSETS = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'puzzles.js',
  'js/main.js',
  'js/board.js',
  'js/pieces.js',
  'js/game.js',
  'js/daily.js',
  'js/storage.js',
  'js/share.js',
  'vendor/chess.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-180.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never touch cross-origin

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(request)
        .then((response) => {
          // Cache same-origin successes so a later offline load still works.
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => {
          // Offline and uncached: navigations still get the app shell.
          if (request.mode === 'navigate') return caches.match('index.html');
          return Response.error();
        });
    })
  );
});
