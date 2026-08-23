/*
 * daily.js — which puzzle is today's, and when does tomorrow's arrive.
 *
 * Everything is keyed on the player's LOCAL calendar date, reduced to a single
 * integer "day number". Using the local Y/M/D (rather than a UTC timestamp)
 * means the puzzle turns over at local midnight, and a player who changes
 * timezone simply gets whatever puzzle belongs to their new local date. They
 * can never be served two puzzles for one local date, and progress already
 * recorded for a date is found again because the key is the date itself.
 */

import { PUZZLES } from '../puzzles.js';

/**
 * Puzzle #1 is the launch date. Local date, not UTC.
 * Chosen so that 2026-08-22 is puzzle #14.
 */
export const LAUNCH_DATE = { year: 2026, month: 7, day: 9 }; // month is 0-based: August

const MS_PER_DAY = 86400000;

/** Local calendar date -> stable integer. Same date == same number, anywhere. */
export function dayNumber(date = new Date()) {
  return Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / MS_PER_DAY
  );
}

const LAUNCH_DAY = Math.floor(
  Date.UTC(LAUNCH_DATE.year, LAUNCH_DATE.month, LAUNCH_DATE.day) / MS_PER_DAY
);

/** 1-based puzzle number for a local date. Clamped so pre-launch dates give #1. */
export function puzzleNumberFor(day = dayNumber()) {
  return Math.max(1, day - LAUNCH_DAY + 1);
}

/** Today's puzzle, plus its number. Wraps when the list runs out. */
export function puzzleFor(day = dayNumber()) {
  const number = puzzleNumberFor(day);
  const index = (number - 1) % PUZZLES.length;
  return { number, index, puzzle: PUZZLES[index] };
}

/** Milliseconds until the next local midnight. */
export function msUntilTomorrow(now = new Date()) {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return midnight.getTime() - now.getTime();
}

/** "07:12:44" — time remaining until the next puzzle. */
export function countdownText(now = new Date()) {
  const ms = Math.max(0, msUntilTomorrow(now));
  const total = Math.floor(ms / 1000);
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

/** "2026-08" — calendar month key for a day number, used by streak forgiveness. */
export function monthKeyOf(day) {
  const d = new Date(day * MS_PER_DAY);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
