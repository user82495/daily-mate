/*
 * supabase.mjs — the only place that knows the service-role key.
 *
 * Every function talks to Supabase from the server, never from the browser.
 * That is a privacy decision as much as a security one: if the app posted
 * straight to Supabase, Supabase's own edge logs would hold a player's IP for
 * every play. Going through Netlify means the request terminates here, and the
 * only thing that reaches the database is the four fields we meant to store.
 *
 * (It is not in `netlify/functions/` directly on purpose — a top-level file
 * there would be deployed as its own endpoint. Files under `lib/` are bundled
 * as plain dependencies.)
 */

const URL_ENV = 'SUPABASE_URL';
const KEY_ENV = 'SUPABASE_SERVICE_ROLE_KEY';

/** Throws with a readable message when the site is deployed unconfigured. */
function credentials() {
  const url = (process.env[URL_ENV] || '').replace(/\/+$/, '');
  const key = process.env[KEY_ENV] || '';
  if (!url || !key) {
    throw new Error(`Missing ${URL_ENV} and/or ${KEY_ENV} in the environment.`);
  }
  return { url, key };
}

function headers(key, extra) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

/**
 * Insert a row, ignoring a duplicate primary key.
 *
 * The (anon_id, puzzle_day) primary key is what enforces "once per day per
 * player", so a retry, a double tap, or a replayed request all resolve to the
 * same single row rather than an error.
 */
export async function insertPlay(row) {
  const { url, key } = credentials();
  const res = await fetch(`${url}/rest/v1/plays?on_conflict=anon_id,puzzle_day`, {
    method: 'POST',
    headers: headers(key, {
      Prefer: 'resolution=ignore-duplicates,return=minimal',
    }),
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    throw new Error(`Supabase insert failed: ${res.status} ${await res.text()}`);
  }
}

/** Call a Postgres function and return its parsed result. */
export async function rpc(name, args = {}) {
  const { url, key } = credentials();
  const res = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: headers(key),
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    throw new Error(`Supabase rpc ${name} failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

/** JSON response with caching off unless asked for otherwise. */
export function json(body, { status = 200, cache = 'no-store', headers: extra } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cache,
      ...extra,
    },
  });
}
