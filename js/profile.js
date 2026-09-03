/*
 * profile.js — per-mode personal bests, and the streak that spans all of them.
 *
 * ---------------------------------------------------------------------------
 * LOCALSTORAGE SCHEMA
 * ---------------------------------------------------------------------------
 *   key: "dailymate.profile.v1"
 *
 *   {
 *     version: 1,
 *     best: {                 // per-mode personal best, higher-is-better unless
 *       endless: number,      // the mode says otherwise (see LOWER_IS_BETTER)
 *       elo:     number,
 *       judge:   number,
 *       duel:    number       // milliseconds — lower is better
 *     },
 *     days: {
 *       played:  number,      // distinct local days on which *anything* finished
 *       streak:  number,      // consecutive such days
 *       max:     number,
 *       lastDay: number|null  // day number, see daily.js
 *     }
 *   }
 *
 * Kept separate from `dailymate.v1` on purpose. That key is the daily puzzle's
 * own state and is read and written by code this file must not disturb; mixing
 * the two would mean every mode shared a migration path with the daily.
 *
 * ---------------------------------------------------------------------------
 * THE STREAK IS THE POINT
 * ---------------------------------------------------------------------------
 * `days` counts any finished run in any mode, the daily included. A player who
 * misses the daily but plays a round of Endless has still shown up, and the
 * streak should say so — otherwise the four modes are a side dish rather than a
 * reason to come back. This is deliberately a different number from the daily
 * puzzle's own solve streak, which only counts solved dailies and lives server
 * side. Both are shown, labelled differently, and never added together.
 */

import { dayNumber } from './daily.js';

const KEY = 'dailymate.profile.v1';

/** Modes where a smaller number is the better one. */
const LOWER_IS_BETTER = new Set(['duel']);

function blank() {
  return {
    version: 1,
    best: {},
    days: { played: 0, streak: 0, max: 0, lastDay: null },
  };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return blank();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return blank();
    return {
      ...blank(),
      ...parsed,
      best: { ...(parsed.best || {}) },
      days: { ...blank().days, ...(parsed.days || {}) },
    };
  } catch {
    return blank();           // corrupt or unavailable storage is not an error
  }
}

function save(profile) {
  try {
    localStorage.setItem(KEY, JSON.stringify(profile));
  } catch {
    // Private browsing, or a full quota. The run still finishes; nothing is kept.
  }
}

/** This mode's personal best, or null if there isn't one yet. */
export function personalBest(mode) {
  const value = load().best[mode];
  return Number.isFinite(value) ? value : null;
}

/** Every recorded best, for the "Keep going" cards. */
export function allBests() {
  return load().best;
}

export function streak() {
  return load().days;
}

/**
 * Record a finished run.
 *
 * Called once when a mode ends, whatever the result. Returns what changed so
 * the result card can say "new best" without asking a second time.
 *
 * @param {string} mode
 * @param {number} score  the mode's headline number
 * @returns {{isBest: boolean, best: number, days: object}}
 */
export function recordRun(mode, score) {
  const profile = load();
  const today = dayNumber();

  // --- personal best ---------------------------------------------------
  const previous = profile.best[mode];
  const first = !Number.isFinite(previous);
  const better = first
    ? // A first run still sets the best, but scoring nothing is not an
      // achievement and must not be announced as one. Duel is exempt: its
      // score is a time, and there is no "zero" run to guard against.
      (LOWER_IS_BETTER.has(mode) || score > 0)
    : (LOWER_IS_BETTER.has(mode) ? score < previous : score > previous);
  const isBest = Number.isFinite(score) && better;

  // The value is recorded either way, so a first run of 0 still becomes the
  // baseline the next one is measured against.
  if (isBest || first) profile.best[mode] = score;

  // --- the cross-mode day streak ---------------------------------------
  // Only the first finished run of a day moves any of this; the tenth round of
  // Endless is the same day as the first.
  const days = profile.days;
  if (days.lastDay !== today) {
    const gap = days.lastDay === null ? null : today - days.lastDay;
    if (gap === 1) days.streak += 1;
    else if (gap === null || gap > 1) days.streak = 1;
    // A negative gap means the clock or timezone moved backwards; leave it be
    // rather than counting the same stretch twice.
    if (gap === null || gap >= 1) {
      days.played += 1;
      days.lastDay = today;
      days.max = Math.max(days.max, days.streak);
    }
  }

  save(profile);
  return { isBest, best: profile.best[mode], days: { ...days } };
}

export function reset() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}

export { KEY, LOWER_IS_BETTER };
