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
 *   anonId        random UUID, generated in this browser, stored in
 *                 localStorage, meaningless anywhere else
 *   puzzleDay     the local day number the puzzle belongs to
 *   result        "solved" | "failed"
 *   attemptsUsed  1, 2 or 3
 *
 * That is the complete list. No page views, no timings, no move-by-move
 * record, no third-party script, nothing that identifies a person or a device
 * beyond that one random number. See privacy.html.
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

const ID_KEY = 'dailymate.anon.v1';

const ENDPOINT_TRACK = '/api/track';
const ENDPOINT_DAY = '/api/day-stats';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** crypto.randomUUID needs a secure context; this covers plain-HTTP dev. */
function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 1
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The device's anonymous ID, minted on first use.
 *
 * Called only when a puzzle is actually finished, so someone who opens Daily
 * Mate and walks away is never given an identifier at all.
 *
 * @returns {string|null} null when storage is unavailable.
 */
function anonId() {
  try {
    const existing = localStorage.getItem(ID_KEY);
    if (existing && UUID_RE.test(existing)) return existing;
    const fresh = uuid();
    localStorage.setItem(ID_KEY, fresh);
    return fresh;
  } catch {
    return null;
  }
}

/**
 * Record a finished puzzle. Call once, at the moment the day ends.
 *
 * sendBeacon is the right shape for this: the browser takes the request off
 * our hands and delivers it whenever it can, including after the tab is gone,
 * and it reports nothing back — which is precisely the contract we want.
 */
export function reportResult({ day, solved, attemptsUsed }) {
  try {
    const id = anonId();
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
