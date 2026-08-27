/*
 * percentile.mjs — GET /api/percentile?puzzle=<id>&seconds=<n>
 *
 * "Faster than 78% of solvers today."
 *
 * The minimum-solvers floor is enforced here rather than in the browser, for
 * the same reason day-stats.mjs keeps its threshold server-side: a client-side
 * floor would still hand out the exact solver count for every puzzle to anyone
 * who asked. Below the floor the answer is a flat null and the raw counts never
 * leave the server.
 *
 * A percentile from three solvers is also just noise — "faster than 66% of
 * solvers" reads as a real statistic and is nothing of the sort.
 */

import { rpc, json } from './lib/supabase.mjs';

const MIN_SOLVERS = Number(process.env.PERCENTILE_MIN_SOLVERS || 20);
const PUZZLE_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
const MAX_SECONDS = 86400;

const HIDDEN = { fasterThan: null };

export default async (req) => {
  if (req.method !== 'GET') {
    return json({ error: 'method not allowed' }, { status: 405 });
  }

  const params = new URL(req.url).searchParams;
  const puzzle = params.get('puzzle') || '';
  const seconds = Number(params.get('seconds'));

  if (!PUZZLE_ID_RE.test(puzzle)) {
    return json({ error: 'puzzle malformed' }, { status: 400 });
  }
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > MAX_SECONDS) {
    return json({ error: 'seconds out of range' }, { status: 400 });
  }

  let row;
  try {
    row = await rpc('dm_get_percentile', {
      p_puzzle_id: puzzle,
      p_solve_seconds: seconds,
    });
  } catch (err) {
    console.error('percentile: rpc failed —', err.message);
    // Not worth an error in the game. Say "nothing to show".
    return json(HIDDEN, { status: 200, cache: 'no-store' });
  }

  const solvers = Number(row?.solvers || 0);
  const fasterThan = row?.faster_than;

  if (solvers < MIN_SOLVERS || fasterThan === null || fasterThan === undefined) {
    return json(HIDDEN, { cache: 'public, max-age=60' });
  }

  return json({ fasterThan: Number(fasterThan) }, { cache: 'public, max-age=60' });
};
