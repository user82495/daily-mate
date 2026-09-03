/*
 * mode-event.mjs — POST /api/mode-event
 *
 * One row per mode event. The same shape as /api/track: the browser holds no
 * database credentials, the request terminates here, and the IP that
 * necessarily arrives with it is used for nothing and stored nowhere.
 *
 * Unlike /api/track there is no once-per-day key to lean on — a player really
 * can finish six runs of Endless in an evening, and all six are events. The
 * guard against a client bug flooding the table is therefore the validator
 * below: a closed set of modes and events, and a payload of at most eight
 * numbers.
 */

import { json } from './lib/supabase.mjs';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MODES = new Set(['endless', 'elo', 'judge', 'duel']);
const EVENTS = new Set([
  'started', 'ended', 'shared', 'abandoned',
  'challenge_created', 'challenge_accepted',
]);

const MAX_KEYS = 8;
const MAX_KEY_LEN = 24;

/** Numbers and booleans only, and few of them. Anything else is dropped. */
function cleanPayload(payload) {
  const out = {};
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return out;
  for (const [key, value] of Object.entries(payload)) {
    if (Object.keys(out).length >= MAX_KEYS) break;
    if (typeof key !== 'string' || key.length > MAX_KEY_LEN) continue;
    if (!/^[a-z][a-zA-Z0-9_]*$/.test(key)) continue;
    if (typeof value === 'boolean') out[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = Math.round(value * 100) / 100;
    }
  }
  return out;
}

/** @returns {{row: object} | {error: string}} */
function validate(body) {
  if (!body || typeof body !== 'object') return { error: 'body must be an object' };

  const { playerId, mode, event, payload } = body;

  if (typeof playerId !== 'string' || !UUID_RE.test(playerId)) {
    return { error: 'playerId must be a UUID' };
  }
  if (typeof mode !== 'string' || !MODES.has(mode)) {
    return { error: 'unknown mode' };
  }
  if (typeof event !== 'string' || !EVENTS.has(event)) {
    return { error: 'unknown event' };
  }

  return {
    row: {
      player_id: playerId.toLowerCase(),
      mode,
      event,
      payload: cleanPayload(payload),
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
    await insert(checked.row);
  } catch (err) {
    // Never echo the upstream message: it can carry connection details.
    console.error('mode-event: insert failed —', err.message);
    return json({ error: 'upstream error' }, { status: 502 });
  }

  // The client sends this with sendBeacon and ignores the answer.
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
};

/**
 * A plain insert through PostgREST.
 *
 * No RPC: there is no arithmetic to protect here, only a row to append, and the
 * table's own CHECK constraints are a better home for the rules than a function
 * wrapping a single statement. lib/supabase.mjs deliberately exposes only an
 * insert shaped for `plays`, so the request is built here.
 */
async function insert(row) {
  const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY.');
  }

  const res = await fetch(`${url}/rest/v1/mode_events`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    throw new Error(`Supabase insert failed: ${res.status} ${await res.text()}`);
  }
}
