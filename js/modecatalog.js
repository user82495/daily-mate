/*
 * modecatalog.js — the one list of modes.
 *
 * Everything that needs to know what modes exist reads this file: the router
 * (which route loads which module), the data loader (which file each mode
 * needs), and both menus (name, blurb, how to render a personal best). Before
 * this there were three lists in three files that had to agree with each other,
 * and nothing made them.
 *
 * ---------------------------------------------------------------------------
 * AVAILABILITY
 * ---------------------------------------------------------------------------
 * A mode is only as real as its data. `data/games.json` and `data/evals.json`
 * are built from a Lichess game dump that is not in the repo, so Elo and Judge
 * can be present in the code and absent from the deploy — and a menu card that
 * leads to "Could not load this mode" is worse than no card at all.
 *
 * So availability is probed at runtime rather than declared. Dropping
 * `games.json` into `data/` and redeploying makes the Elo card appear on its
 * own; there is no boolean anywhere to remember to flip, which is the whole
 * point — a flag you have to maintain is a flag that will be wrong.
 *
 * The probe is a HEAD: no body, and it runs on idle after the daily has
 * painted, never before. Judge needs one extra step, because a file that
 * exists is not the same as a file that is trustworthy — see `verify` below.
 */

/** Bytes read from the head of a dataset when checking its marker. */
const MARKER_BYTES = 512;

export const MODES = [
  {
    id: 'endless',
    name: 'Mate in One Endless',
    blurb: 'One move, one chance. How long a streak can you hold?',
    data: 'data/mate1.json',
    load: () => import('./modes/endless.js'),
    best: (v) => `${v} in a row`,
  },
  {
    id: 'elo',
    name: 'Guess the Elo',
    blurb: 'Watch a real game. How strong were they?',
    data: 'data/games.json',
    load: () => import('./modes/elo.js'),
    best: (v) => `${v}/500`,
  },
  {
    id: 'judge',
    name: 'Blunder or Brilliant',
    blurb: 'Sixty seconds. Call as many as you can.',
    data: 'data/evals.json',
    load: () => import('./modes/judge.js'),
    best: (v) => `${v} correct`,
    /*
     * Existing is not sufficient here.
     *
     * "Brilliant" needs three things to be true, and the third — that no
     * non-sacrificial alternative scores within 100cp — cannot be read off
     * Lichess's `%eval` annotations, which record one number per position: the
     * evaluation after the move actually played, and nothing at all about the
     * moves that were not. `build_evals.py` can only check it with an engine,
     * so it stamps the file with whether it did.
     *
     * Without that stamp the file holds blunders only, which is not a game —
     * every answer would be "blunder". Treating an unmarked or unverified file
     * as absent is what stops unverified labels shipping by accident.
     */
    verify: (head) => /"brilliantLabelsVerified"\s*:\s*true/.test(head),
  },
  {
    id: 'duel',
    name: 'Puzzle Duel',
    blurb: 'Five puzzles against the clock. Send it to someone.',
    data: 'data/duel.json',
    load: () => import('./modes/duel.js'),
    // Stored as centiseconds; the formatter is supplied by the caller, which
    // already imports share.js, so this file need not.
    best: (v, formatDuration) => formatDuration(v / 100),
  },
];

export const byId = Object.fromEntries(MODES.map((m) => [m.id, m]));

/** `{ endless: 'data/mate1.json', ... }` — what the data loader fetches. */
export const SOURCES = Object.fromEntries(MODES.map((m) => [m.id, m.data]));

/* -------------------------------------------------------------- probing */

let probe = null;            // Promise<Set<string>>, memoised for the page load
let resolved = null;         // Set<string> once known, for synchronous callers

/**
 * Read enough of a file's opening bytes to find its marker, without pulling
 * the whole thing down.
 *
 * A Range header asks politely; a server that ignores it (Python's
 * `http.server` does) sends the entire file with a 200 instead. Cancelling the
 * stream after the first chunk bounds the transfer either way, so the check
 * costs a few hundred bytes on a real host and one chunk on a bad one.
 */
async function readHead(url) {
  const res = await fetch(url, { headers: { Range: `bytes=0-${MARKER_BYTES - 1}` } });
  if (!res.ok && res.status !== 206) return null;

  const reader = res.body?.getReader?.();
  if (!reader) return (await res.text()).slice(0, 4096);

  try {
    const { value } = await reader.read();
    return new TextDecoder().decode(value || new Uint8Array()).slice(0, 4096);
  } finally {
    reader.cancel().catch(() => {});
  }
}

/** True if this mode's data is present and, where it matters, trustworthy. */
async function check(mode) {
  try {
    const res = await fetch(mode.data, { method: 'HEAD' });
    if (!res.ok) return false;
    if (!mode.verify) return true;

    const head = await readHead(mode.data);
    return head !== null && mode.verify(head);
  } catch {
    // Offline, blocked, or a host that dislikes HEAD. Absent is the safe
    // reading: it hides a card rather than showing one that leads nowhere.
    return false;
  }
}

/**
 * Which modes can actually be played, probed once per page load.
 *
 * Call it early — from an idle callback after the daily has painted — so the
 * answer is already in hand by the time a menu is rendered. Every later call
 * gets the same promise.
 *
 * @returns {Promise<Set<string>>}
 */
export function probeAvailability() {
  if (probe) return probe;
  probe = Promise.all(MODES.map(async (m) => ((await check(m)) ? m.id : null)))
    .then((ids) => {
      resolved = new Set(ids.filter(Boolean));
      return resolved;
    })
    .catch(() => {
      resolved = new Set();
      return resolved;
    });
  return probe;
}

/** The answer if it is already known, else null. Never triggers a probe. */
export function availableNow() {
  return resolved;
}

/** The catalog entries that are playable, in catalog order. */
export async function availableModes() {
  const ids = await probeAvailability();
  return MODES.filter((m) => ids.has(m.id));
}
