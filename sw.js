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

const CACHE = 'dailymate-v22';

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
  'js/api.js',
  'js/player.js',
  'js/results.js',
  'js/push.js',
  'stats.html',
  'js/stats-page.js',

  // The modes. router/modemenu/profile are on the daily's own path — main.js
  // imports them — so they must be here or the daily breaks offline. The rest
  // are lazily imported, and precached anyway because they are small and a mode
  // that only works online is a mode that fails on a train.
  'js/router.js',
  'js/modemenu.js',
  'js/profile.js',
  'js/track.js',
  'js/dataloader.js',
  'js/resultcard.js',
  'js/modecatalog.js',
  'js/modes/endless.js',
  'js/modes/elo.js',
  'js/modes/judge.js',
  'js/modes/duel.js',
  'privacy.html',
  'prose.css',
  'vendor/chess.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-180.png',
];

/*
 * Mode datasets, precached separately and best-effort.
 *
 * Two reasons they are not in ASSETS. First, `addAll` is all-or-nothing: one
 * 404 rejects the whole call and the install fails, taking offline support for
 * the entire app with it — and `games.json` and `evals.json` genuinely are not
 * deployed yet. Listing them here and adding them one at a time means a missing
 * dataset costs nothing, and the day one is dropped into `data/` it starts
 * being cached with no change to this file.
 *
 * Second, the cost is real and worth stating: this is roughly 450KB today, paid
 * at install by every visitor including the majority who only play the daily.
 * The daily itself never waits on it — install happens after first paint, and
 * puzzles ship inside puzzles.js — but it is not free. Moving these back to
 * runtime-only caching is a one-line change if that trade stops being worth it.
 */
const DATA_ASSETS = [
  'data/mate1.json',
  'data/duel.json',
  'data/games.json',
  'data/evals.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // `cache.addAll(ASSETS)` fetches through the HTTP cache, so a freshly
      // bumped CACHE can be filled with the *previous* build's files — the one
      // thing bumping it is supposed to prevent. Requesting each asset with
      // `cache: 'reload'` forces a revalidated fetch, so a new cache name
      // really does mean new files.
      .then((cache) => cache.addAll(
        ASSETS.map((url) => new Request(url, { cache: 'reload' }))
      ).then(() => Promise.all(
        // One at a time, and a failure is not a failure: a dataset that is not
        // deployed simply is not cached, and the install still succeeds.
        DATA_ASSETS.map((url) => cache
          .add(new Request(url, { cache: 'reload' }))
          .catch(() => {}))
      )))
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


/* ===========================================================================
 * Web Push
 *
 * The payload is built by netlify/functions/send-notifications.mjs and is
 * always JSON. It is still parsed defensively: a push with no body, or one
 * from a stale sender, should show something sensible rather than throw inside
 * the service worker where nobody would ever see the error.
 * =========================================================================== */

const FALLBACK = {
  title: "Today's puzzle is live ♟️",
  body: 'A new mate is waiting.',
  url: '/',
};

self.addEventListener('push', (event) => {
  let data = FALLBACK;
  try {
    if (event.data) data = { ...FALLBACK, ...event.data.json() };
  } catch {
    // Not JSON. Fall back rather than dropping the notification entirely —
    // some browsers show a generic "site updated" message if we show nothing.
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      // One puzzle a day: collapse rather than stack, so a missed day cannot
      // leave two notifications sitting in the tray.
      tag: 'dailymate-daily',
      renotify: true,
      data: { url: data.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin);

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      // Prefer focusing a tab that is already open on the app over opening a
      // second one — the player almost never wants two copies of a daily game.
      for (const client of clientList) {
        if (new URL(client.url).origin === target.origin && 'focus' in client) {
          await client.focus();
          if ('navigate' in client && client.url !== target.href) {
            await client.navigate(target.href).catch(() => {});
          }
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(target.href);
    })()
  );
});
