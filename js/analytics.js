/*
 * analytics.js — the whole of what Daily Mate sends anywhere.
 *
 * ---------------------------------------------------------------------------
 * WHAT LEAVES THE DEVICE
 * ---------------------------------------------------------------------------
 * Once per day, when the puzzle ends, one object:
 *
 *   { anonId, puzzleDay, result, attemptsUsed }
 *
 *   anonId        the device's random UUID (see js/player.js) — generated in
 *                 this browser, stored in localStorage, meaningless elsewhere
 *   puzzleDay     the local day number the puzzle belongs to
 *   result        "solved" | "failed"
 *   attemptsUsed  1, 2 or 3
 *
 * That is the complete list *for this endpoint*. The stats, percentile and
 * push features added later send more, from js/api.js, and only when the
 * player uses them. privacy.html describes the whole picture.
 *
 * ---------------------------------------------------------------------------
 * HOW IT BEHAVES
 * ---------------------------------------------------------------------------
 * Fire-and-forget, in the strict sense: nothing here can fail loudly, retry,
 * block a render, or leave the game in a different state. If the request never
 * arrives, that play is simply not counted, and the player never learns that
 * anything was attempted. A missing localStorage (private browsing) is not an
 * error either — it just means no ID, and therefore nothing is sent.
 */

import { playerId, ID_KEY } from './player.js';

const ENDPOINT_TRACK = '/api/track';
const ENDPOINT_DAY = '/api/day-stats';

/**
 * Record a finished puzzle. Call once, at the moment the day ends.
 *
 * sendBeacon is the right shape for this: the browser takes the request off
 * our hands and delivers it whenever it can, including after the tab is gone,
 * and it reports nothing back — which is precisely the contract we want.
 */
export function reportResult({ day, solved, attemptsUsed }) {
  try {
    const id = playerId();
    if (!id) return;

    const body = JSON.stringify({
      anonId: id,
      puzzleDay: day,
      result: solved ? 'solved' : 'failed',
      attemptsUsed,
    });

    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      if (navigator.sendBeacon(ENDPOINT_TRACK, blob)) return;
    }

    fetch(ENDPOINT_TRACK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Nothing about the game depends on this having worked.
  }
}

/**
 * Today's solve rate, or null when there is nothing to show.
 *
 * The server withholds the number until enough people have played, so a null
 * here means either "too few plays yet" or "could not ask" — the app treats
 * both the same way and shows no line at all. No identifier is sent.
 *
 * @returns {Promise<{solveRate: number|null}>}
 */
export async function fetchDayStats(day) {
  try {
    const res = await fetch(`${ENDPOINT_DAY}?day=${encodeURIComponent(day)}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return { solveRate: null };
    const data = await res.json();
    const rate = data?.solveRate;
    return { solveRate: Number.isFinite(rate) ? rate : null };
  } catch {
    return { solveRate: null };
  }
}

export { ID_KEY };
