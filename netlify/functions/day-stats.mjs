/*
 * day-stats.mjs — GET /api/day-stats?day=<n>
 *
 * The one public read: the share of players who solved a given day's puzzle,
 * for the line on the app's stats sheet.
 *
 * The 20-player floor is enforced *here* rather than in the browser. If the
 * threshold were client-side, this endpoint would hand anyone an exact daily
 * player count for every day Daily Mate has existed — the dashboard's headline
 * number, free, to whoever asked. So below the floor the answer is a flat
 * `{ solveRate: null }`, and above it only the rounded percentage comes back.
 * The raw counts never leave the server.
 */

import { rpc, json } from './lib/supabase.mjs';

const MIN_PLAYS = Number(process.env.SOLVE_RATE_MIN_PLAYS || 20);

const HIDDEN = { solveRate: null };

export default async (req) => {
  if (req.method !== 'GET') {
    return json({ error: 'method not allowed' }, { status: 405 });
  }

  const day = Number(new URL(req.url).searchParams.get('day'));
  if (!Number.isInteger(day)) {
    return json({ error: 'day must be an integer' }, { status: 400 });
  }

  let rows;
  try {
    rows = await rpc('dm_day_stats', { p_day: day });
  } catch (err) {
    console.error('day-stats: rpc failed —', err.message);
    // A failure here is not worth an error in the game. Say "nothing to show".
    return json(HIDDEN, { status: 200, cache: 'no-store' });
  }

  const row = Array.isArray(rows) ? rows[0] : rows;
  const plays = Number(row?.plays || 0);
  const solved = Number(row?.solved || 0);

  if (plays < MIN_PLAYS) return json(HIDDEN, { cache: 'public, max-age=60' });

  return json(
    { solveRate: Math.round((solved / plays) * 100) },
    { cache: 'public, max-age=60' }
  );
};
