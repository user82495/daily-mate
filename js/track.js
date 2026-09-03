/*
 * track.js — the one analytics call the modes make.
 *
 *     track('endless', 'ended', { score: 14 })
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT THE `plays` TABLE
 * ---------------------------------------------------------------------------
 * The existing analytics table cannot hold these events, and it is worth being
 * explicit about why rather than looking like a second system built by habit.
 * `plays` is (anon_id, puzzle_day, result, attempts_used) with a primary key of
 * (anon_id, puzzle_day) — one row per player per day, by construction — and
 * CHECK constraints pinning `result` to 'solved'/'failed' and attempts to 1-3.
 * There is no mode column, no event column, and the key forbids a second row on
 * the same day. A player finishing four runs of Endless is four events; the
 * table can hold at most one, and cannot say what mode it was.
 *
 * So mode events go to their own table, through the same shape as everything
 * else: one wrapper here, one Netlify function, one anonymous id. The browser
 * still never touches Supabase, and no second identifier is minted.
 *
 * ---------------------------------------------------------------------------
 * WHAT LEAVES THE DEVICE
 * ---------------------------------------------------------------------------
 *   { playerId, mode, event, payload }
 *
 * `payload` is a small flat object of numbers the dashboard aggregates — a
 * score, a duration. Never a position, never a move, never free text.
 *
 * Fire-and-forget, exactly like analytics.js: nothing here can fail loudly,
 * block a render, or change what the player sees.
 */

import { playerId } from './player.js';

const ENDPOINT = '/api/mode-event';

const MODES = new Set(['endless', 'elo', 'judge', 'duel']);
const EVENTS = new Set([
  'started',
  'ended',
  'shared',
  'abandoned',
  'challenge_created',
  'challenge_accepted',
]);

/** Payloads are numbers only, and few of them. */
function clean(payload) {
  const out = {};
  if (!payload || typeof payload !== 'object') return out;
  for (const [key, value] of Object.entries(payload)) {
    if (Object.keys(out).length >= 8) break;
    if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = Math.round(value * 100) / 100;
    } else if (typeof value === 'boolean') {
      out[key] = value;
    }
    // Anything else — strings, nested objects — is dropped rather than sent.
  }
  return out;
}

/**
 * Record a mode event.
 *
 * @param {string} mode    endless | elo | judge | duel
 * @param {string} event   started | ended | shared | abandoned |
 *                         challenge_created | challenge_accepted
 * @param {object} [payload]
 */
export function track(mode, event, payload) {
  try {
    if (!MODES.has(mode) || !EVENTS.has(event)) return;

    const id = playerId();
    if (!id) return;                    // storage unavailable: nothing to send

    const body = JSON.stringify({
      playerId: id,
      mode,
      event,
      payload: clean(payload),
    });

    // sendBeacon survives the tab closing, which is exactly the case 'abandoned'
    // exists to catch.
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      if (navigator.sendBeacon(ENDPOINT, blob)) return;
    }

    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Nothing about any mode depends on this having worked.
  }
}

/**
 * Fire 'abandoned' if a run is still open when it goes away.
 *
 * Two ways a run ends without finishing, and both must be caught:
 *
 *   - the page goes away    — tab closed, app backgrounded, phone locked
 *   - the route goes away   — back button, the daily's "Keep going" cards, the
 *                             × in the mode header
 *
 * The second is by far the common one. This is a hash-routed app, so walking
 * out of a mode is a route change, not a navigation: `pagehide` never fires and
 * nothing unloads. Watching only the page events would have logged `started`
 * for those runs and then nothing at all, quietly turning the most ordinary way
 * to leave a mode into missing data.
 *
 * So the caller says which happened. `done()` is the clean finish — `ended` has
 * already been logged and there is nothing to abandon. `bail()` is the teardown
 * mid-run, and logs it. Either way it only ever fires once.
 */
export function watchForAbandon(mode, snapshot) {
  let live = true;

  const bail = () => {
    if (!live) return;
    live = false;
    detach();
    track(mode, 'abandoned', snapshot());
  };

  const onHide = () => { if (document.visibilityState === 'hidden') bail(); };

  const detach = () => {
    window.removeEventListener('pagehide', bail);
    document.removeEventListener('visibilitychange', onHide);
  };

  window.addEventListener('pagehide', bail);
  document.addEventListener('visibilitychange', onHide);

  return {
    /** The run finished on its own terms. Nothing to report. */
    done() { live = false; detach(); },
    /** The run was torn down still in progress. */
    bail,
  };
}
