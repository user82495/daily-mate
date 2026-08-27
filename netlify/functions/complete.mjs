/*
 * complete.mjs — POST /api/complete
 *
 * A finished puzzle, recorded once. Everything that matters — the streak, the
 * freeze, the totals — is computed by dm_complete_puzzle inside Postgres, in a
 * single statement, so the client sends facts about the game and never numbers
 * about itself. It cannot claim a streak; it can only report that a puzzle
 * ended, and read back what the server made of that.
 *
 * The day boundary is the server's UTC date, taken from the database clock. A
 * client-supplied date would be the one thing worth forging here.
 *
 * Unlike /api/track this one answers with a body: the caller needs the new
 * streak to render the result card.
 */

import { rpc, json } from './lib/supabase.mjs';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Lichess puzzle ids are short alphanumeric slugs (see puzzles.js).
const PUZZLE_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

const MAX_SECONDS = 86400;

/** @returns {{args: object} | {error: string}} */
function validate(body) {
  if (!body || typeof body !== 'object') return { error: 'body must be an object' };

  const { playerId, puzzleId, solved, solveSeconds } = body;

  if (typeof playerId !== 'string' || !UUID_RE.test(playerId)) {
    return { error: 'playerId must be a UUID' };
  }
  if (typeof puzzleId !== 'string' || !PUZZLE_ID_RE.test(puzzleId)) {
    return { error: 'puzzleId malformed' };
  }
  if (typeof solved !== 'boolean') {
    return { error: 'solved must be a boolean' };
  }

  let seconds = null;
  if (solveSeconds !== null && solveSeconds !== undefined) {
    if (!Number.isInteger(solveSeconds) || solveSeconds < 0 || solveSeconds > MAX_SECONDS) {
      return { error: 'solveSeconds out of range' };
    }
    seconds = solveSeconds;
  }
  // A solve without a duration would land in puzzle_results as a row the
  // percentile can never use. Reject rather than store something useless.
  if (solved && seconds === null) {
    return { error: 'a solve must carry solveSeconds' };
  }

  return {
    args: {
      p_player_id: playerId.toLowerCase(),
      p_puzzle_id: puzzleId,
      p_solved: solved,
      p_solve_seconds: seconds,
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

  let result;
  try {
    result = await rpc('dm_complete_puzzle', checked.args);
  } catch (err) {
    // Never echo the upstream message: it can carry connection details.
    console.error('complete: rpc failed —', err.message);
    return json({ error: 'upstream error' }, { status: 502 });
  }

  return json(result ?? {}, { cache: 'no-store' });
};
