/*
 * storage.js — all persistent state. localStorage only; no accounts, no sync.
 *
 * ---------------------------------------------------------------------------
 * LOCALSTORAGE SCHEMA
 * ---------------------------------------------------------------------------
 * One key holds one JSON object:
 *
 *   key: "dailymate.v1"
 *
 *   {
 *     version: 1,             // bump + migrate in load() when the shape changes
 *
 *     played:   number,       // puzzles finished (solved or failed)
 *     solved:   number,       // puzzles solved
 *     dist: {                 // distribution of attempts used, for the histogram
 *       "1": number,          //   solved on the 1st attempt
 *       "2": number,          //   solved on the 2nd
 *       "3": number,          //   solved on the 3rd
 *       "X": number           //   failed all three
 *     },
 *
 *     currentStreak: number,  // consecutive solved days (a fail resets to 0)
 *     maxStreak:     number,
 *     lastSolvedDay: number|null,  // day number of the most recent solve
 *
 *     forgiveness: {          // one missed day per calendar month is forgiven
 *       month: string|null,   //   "YYYY-MM" of the missed day that was forgiven
 *     },
 *
 *     today: {                // progress on the puzzle in play; null before start
 *       day:      number,     //   local day number (see daily.js)
 *       puzzleId: string,     //   guards against a regenerated puzzles.js
 *       results:  string[],   //   one entry per finished attempt: "fail"|"solve"
 *       state:    string,     //   "playing" | "solved" | "failed"
 *       streakSaved: boolean  //   forgiveness rescued the streak on this day
 *     } | null
 *   }
 *
 * Anything not listed here is derived at runtime, not stored. Stats are only
 * committed once per day, when the puzzle finishes.
 * ---------------------------------------------------------------------------
 */

import { dayNumber, monthKeyOf } from './daily.js';

const KEY = 'dailymate.v1';

function blank() {
  return {
    version: 1,
    played: 0,
    solved: 0,
    dist: { 1: 0, 2: 0, 3: 0, X: 0 },
    currentStreak: 0,
    maxStreak: 0,
    lastSolvedDay: null,
    forgiveness: { month: null },
    today: null,
  };
}

/** Read state, tolerating absent, corrupt, or partial data. */
export function load() {
  let raw;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return blank(); // private browsing / storage disabled
  }
  if (!raw) return blank();
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return blank();
    // Merge over a blank so a missing field can never throw downstream.
    return {
      ...blank(),
      ...parsed,
      dist: { ...blank().dist, ...(parsed.dist || {}) },
      forgiveness: { ...blank().forgiveness, ...(parsed.forgiveness || {}) },
    };
  } catch {
    return blank();
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Storage full or blocked. The game stays playable for this session.
  }
}

export function reset() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}

/**
 * Today's progress record, creating a fresh one when the day has rolled over
 * or when puzzles.js has been regenerated under an in-progress day.
 */
export function todayRecord(state, day, puzzleId) {
  const t = state.today;
  if (t && t.day === day && t.puzzleId === puzzleId) return t;
  return { day, puzzleId, results: [], state: 'playing', streakSaved: false };
}

/**
 * Fold a finished puzzle into the lifetime stats. Called exactly once per day,
 * at the moment the puzzle ends.
 *
 * Streaks count consecutive days *solved*. A failed puzzle resets the streak.
 * A missed day normally resets it too, except that one missed day per calendar
 * month is forgiven — silently, automatically, and without banking: the
 * allowance belongs to the month the missed day falls in.
 *
 * @returns {boolean} true if forgiveness rescued the streak just now.
 */
export function commitResult(state, { day, solved, attemptsUsed }) {
  state.played += 1;

  if (solved) {
    state.solved += 1;
    state.dist[String(attemptsUsed)] = (state.dist[String(attemptsUsed)] || 0) + 1;
  } else {
    state.dist.X = (state.dist.X || 0) + 1;
  }

  let streakSaved = false;

  if (!solved) {
    // Failing is not missing — no forgiveness applies.
    state.currentStreak = 0;
  } else {
    const last = state.lastSolvedDay;
    const gap = last === null ? null : day - last;

    if (gap !== null && gap <= 0) {
      // The local date moved backwards — the player crossed the date line, or
      // the device clock was wound back. A later day is already counted, so
      // leave the streak (and lastSolvedDay) alone rather than double-counting.
      state.maxStreak = Math.max(state.maxStreak, state.currentStreak);
      return false;
    }

    if (gap === null || gap > 2) {
      state.currentStreak = 1;               // first ever, or too long a lapse
    } else if (gap === 1) {
      state.currentStreak += 1;              // consecutive
    } else {
      // gap === 2: exactly one missed day, at day `last + 1`.
      const missedMonth = monthKeyOf(last + 1);
      if (state.forgiveness.month !== missedMonth) {
        state.forgiveness.month = missedMonth;
        state.currentStreak += 1;
        streakSaved = true;
      } else {
        state.currentStreak = 1;             // allowance already spent this month
      }
    }
    state.lastSolvedDay = day;
    state.maxStreak = Math.max(state.maxStreak, state.currentStreak);
  }

  return streakSaved;
}

export { KEY };
