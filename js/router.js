/*
 * router.js — hash routing between the daily puzzle and the four modes.
 *
 *   #/          the daily puzzle          (also: no hash at all)
 *   #/endless   Mate in One Endless
 *   #/elo       Guess the Elo
 *   #/judge     Blunder or Brilliant
 *   #/duel      Puzzle Duel  (#/duel?c=<payload> for a challenge)
 *
 * The daily is the app. It is already in the DOM when this file runs, it is
 * never unmounted, and nothing here is on its critical path — a mode's code is
 * imported the first time its route is entered and not before. Landing on
 * dailymatechess.netlify.app loads exactly what it loaded yesterday.
 *
 * Modes are hidden rather than destroyed when left, but their mount handle's
 * unmount() runs, so timers stop and 'abandoned' is reported. Coming back is a
 * fresh mount.
 */

const MODES = {
  endless: () => import('./modes/endless.js'),
  elo: () => import('./modes/elo.js'),
  judge: () => import('./modes/judge.js'),
  duel: () => import('./modes/duel.js'),
};

let dailyEl = null;
let modeEl = null;
let current = null;          // { name, handle }
let started = false;

/**
 * Split "#/duel?c=abc" into its parts.
 *
 * Query strings live inside the hash rather than on the URL because a real
 * query string would be sent to the server and, more to the point, would be
 * lost on a static host that serves index.html for everything.
 */
export function parseHash(hash = location.hash) {
  const raw = String(hash || '').replace(/^#/, '');
  if (!raw || raw === '/') return { route: '', params: new URLSearchParams() };
  const [path, query = ''] = raw.split('?');
  return {
    route: path.replace(/^\//, '').replace(/\/$/, ''),
    params: new URLSearchParams(query),
  };
}

/** Navigate. Pushes a history entry, so Back works without special handling. */
export function go(route, params) {
  const query = params && [...params.keys()].length ? `?${params}` : '';
  const next = route ? `#/${route}${query}` : '#/';
  if (location.hash === next) render();
  else location.hash = next;
}

function showDaily() {
  dailyEl.hidden = false;
  modeEl.hidden = true;
  modeEl.replaceChildren();
  document.body.classList.remove('in-mode');
}

function showMode() {
  dailyEl.hidden = true;
  modeEl.hidden = false;
  document.body.classList.add('in-mode');
}

async function render() {
  const { route, params } = parseHash();

  // Leaving whatever was mounted, including on a route that turns out to be
  // unknown — the old mode's timers must stop either way.
  if (current) {
    try { current.handle?.unmount?.(); } catch { /* never block a route change */ }
    current = null;
  }

  if (!route || !MODES[route]) {
    showDaily();
    // An unknown hash is not an error worth showing; it is a stale link. Put
    // the address bar back in step rather than leaving #/nonsense sitting there.
    if (route && location.hash !== '#/') history.replaceState(null, '', '#/');
    return;
  }

  showMode();
  modeEl.replaceChildren();

  let module;
  try {
    module = await MODES[route]();
  } catch {
    // A failed import is almost always offline-with-a-cold-cache. Say so
    // plainly and leave the daily one tap away.
    modeEl.innerHTML = `
      <div class="mode-skeleton">
        <p class="skeleton-note">This mode isn't available offline yet.</p>
        <a class="result-btn" href="#/">Back to the daily</a>
      </div>`;
    return;
  }

  // The hash may have changed again while the import was in flight.
  if (parseHash().route !== route) return;

  current = { name: route, handle: module.mount(modeEl, params) || null };
}

/**
 * Start routing.
 *
 * @param {HTMLElement} daily  the daily puzzle's root, hidden while in a mode
 * @param {HTMLElement} mode   the container modes mount into
 */
export function startRouter({ daily, mode }) {
  if (started) return;
  started = true;
  dailyEl = daily;
  modeEl = mode;
  window.addEventListener('hashchange', render);
  render();
}

export { MODES };
