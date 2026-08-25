/*
 * track.mjs — POST /api/track
 *
 * The whole of Daily Mate's data collection. One row per player per day:
 *
 *   { anonId, puzzleDay, result, attemptsUsed }
 *
 * Nothing else is read off the request and nothing else is stored. The IP and
 * user agent that necessarily arrive with any HTTP request are used for
 * nothing, logged nowhere, and never reach the database.
 *
 * The client sends this with `navigator.sendBeacon` and ignores the outcome,
 * so the status codes below are for debugging with curl, not for the game.
 */

import { insertPlay, json } from './lib/supabase.mjs';

/** Puzzle #1 — 9 August 2026 — as a day number. Keep in step with js/daily.js. */
const LAUNCH_DAY = 20674;

const MS_PER_DAY = 86400000;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Days are the player's *local* calendar date, so at any instant the plausible
 * values straddle UTC by up to a day either way. Anything outside that window
 * is a wrong device clock or a forged request; either way it is not a play.
 */
function dayIsPlausible(day) {
  const utcToday = Math.floor(Date.now() / MS_PER_DAY);
  return day >= LAUNCH_DAY && day >= utcToday - 2 && day <= utcToday + 1;
}

/** @returns {{row: object} | {error: string}} */
function validate(body) {
  if (!body || typeof body !== 'object') return { error: 'body must be an object' };

  const { anonId, puzzleDay, result, attemptsUsed } = body;

  if (typeof anonId !== 'string' || !UUID_RE.test(anonId)) {
    return { error: 'anonId must be a UUID' };
  }
  if (!Number.isInteger(puzzleDay) || !dayIsPlausible(puzzleDay)) {
    return { error: 'puzzleDay out of range' };
  }
  if (result !== 'solved' && result !== 'failed') {
    return { error: "result must be 'solved' or 'failed'" };
  }
  if (!Number.isInteger(attemptsUsed) || attemptsUsed < 1 || attemptsUsed > 3) {
    return { error: 'attemptsUsed must be 1, 2 or 3' };
  }

  return {
    row: {
      anon_id: anonId.toLowerCase(),
      puzzle_day: puzzleDay,
      result,
      attempts_used: attemptsUsed,
    },
  };
}

export default async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'method not allowed' }, { status: 405 });
  }

  let body;
  try {
    body = JSON.parse(await req.text());
  } catch {
    return json({ error: 'malformed JSON' }, { status: 400 });
  }

  const checked = validate(body);
  if (checked.error) return json({ error: checked.error }, { status: 400 });

  try {
    await insertPlay(checked.row);
  } catch (err) {
    // Never echo the upstream message: it can carry connection details.
    console.error('track: insert failed —', err.message);
    return json({ error: 'upstream error' }, { status: 502 });
  }

  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
};
