/*
 * player-stats.mjs — GET /api/player-stats?player=<uuid>
 *
 * Lifetime numbers for one device, for the stats page.
 *
 * The id in the query string is the whole of the "authentication" here, and it
 * is worth being honest about what that means: anyone who guesses a UUID could
 * read that player's totals. Guessing one is not realistic, and there is
 * nothing behind it but counts — no history, no positions, nothing that
 * identifies a person. It is not a secret, it is an opaque handle. The reason
 * it goes no further is that the id is all Daily Mate ever has: there are no
 * accounts to authenticate against.
 */

import { rpc, json } from './lib/supabase.mjs';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async (req) => {
  if (req.method !== 'GET') {
    return json({ error: 'method not allowed' }, { status: 405 });
  }

  const player = new URL(req.url).searchParams.get('player') || '';
  if (!UUID_RE.test(player)) {
    return json({ error: 'player must be a UUID' }, { status: 400 });
  }

  let stats;
  try {
    stats = await rpc('dm_player_stats', { p_player_id: player.toLowerCase() });
  } catch (err) {
    console.error('player-stats: rpc failed —', err.message);
    return json({ error: 'upstream error' }, { status: 502 });
  }

  // A player who has never finished a puzzle has no row. That is not an error;
  // it is an empty page.
  return json(stats ?? null, { cache: 'no-store' });
};
