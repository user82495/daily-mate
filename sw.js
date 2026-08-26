/*
 * sw.js — offline support.
 *
 * The whole app is a fixed set of static files, so the service worker simply
 * precaches all of them on install and serves cache-first afterwards. There is
 * Almost no runtime data is fetched: puzzles ship inside puzzles.js and every
 * scrap of player state lives in localStorage, so once installed the game
 * works with no network at all. The two analytics calls under /api/ are the
 * exception, and they are deliberately excluded below — a cached solve rate
 * would be a wrong solve rate, and a cached POST is not a thing we want.
 *
 * Bump CACHE when any shipped file changes — the old cache is then dropped on
 * activate, and clients pick the new one up on their next load.
 */

const CACHE = 'dailymate-v11';

/**
 * Everything the private dashboard is made of. None of it belongs in the app's
 * offline cache: no player ever loads it, and a stale copy is worse than none.
 */
const DASHBOARD_ASSET = /^\/(dashboard\.\w+|js\/dashboard\.js|vendor\/chart\.)/;

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
  'js/analytics.js',
  'privacy.html',
  'prose.css',
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

  // Analytics and the dashboard are live data. Note that the lookup below uses
  // ignoreSearch, so a cached /api/day-stats?day=1 would be served for every
  // other day too — leave the network to handle these entirely.
  //
  // The dashboard is more than dashboard.html: its script lives under /js/ and
  // its chart library under /vendor/, and the runtime caching further down
  // grabs any same-origin GET that succeeds. Matching only the "/dashboard"
  // prefix let js/dashboard.js be cached and then served cache-first for as
  // long as CACHE stayed the same — pinning the page to whichever version a
  // browser happened to see first. Match every dashboard asset, not just the
  // page.
  if (url.pathname.startsWith('/api/') || DASHBOARD_ASSET.test(url.pathname)) return;

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
