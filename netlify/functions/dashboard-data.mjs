/*
 * dashboard-data.mjs — GET /api/dashboard-data
 *
 * Everything dashboard.html draws, in one object. Protected by a password whose
 * SHA-256 digest is DASHBOARD_PASSWORD_SHA256 below. The password itself is not
 * in this repository and never has been.
 *
 * The page itself (dashboard.html) is a public file — it has to be, it is
 * served off the same static host as the game — but it ships empty. This
 * endpoint is the thing that is actually guarded, and without the password it
 * returns nothing at all. Obscurity of the URL is not part of the protection:
 * /api/dashboard-data is as guessable as it looks.
 *
 * Supabase credentials are NOT hardcoded — SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY stay in the environment, read by lib/supabase.mjs.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

import { rpc, json } from './lib/supabase.mjs';

/* ==========================================================================
 *
 *   DASHBOARD PASSWORD — SHA-256 HASH. CHANGE THIS ONE LINE.
 *
 * ==========================================================================
 *
 * The password itself is not here and never has been. This is its SHA-256
 * digest; the plaintext exists only in your head and wherever you chose to
 * keep it. To change the password:
 *
 *     node make-hash.js            # type the new one, press Ctrl-D
 *
 * and paste the hex it prints over the value below.
 *
 * What this protects against: someone reading the repository. It does not make
 * a weak password safe. SHA-256 is fast by design, and this repository is
 * public, so an attacker has the digest and can grind it offline as quickly as
 * hardware allows. A dictionary word with digits on the end falls in seconds.
 * A long random string never does. The strength lives in the password, not
 * here.
 */
const DASHBOARD_PASSWORD_SHA256 = 'REPLACE_ME_WITH_A_REAL_HASH';

/** A SHA-256 digest as hex: exactly 64 characters, nothing else. */
const HASH_SHAPE = /^[0-9a-f]{64}$/i;

/**
 * Constant-time comparison against the stored digest.
 *
 * The submitted password is hashed and the two digests compared byte by byte,
 * so the plaintext is never held beyond the length of this call, never
 * compared with ===, and never written anywhere.
 */
function matches(supplied) {
  const a = createHash('sha256').update(supplied, 'utf8').digest();
  const b = Buffer.from(DASHBOARD_PASSWORD_SHA256, 'hex');
  // Both are 32 bytes whenever the constant is well-formed, but timingSafeEqual
  // throws on a length mismatch rather than returning false, so check first.
  return a.length === b.length && timingSafeEqual(a, b);
}

function bearer(req) {
  const header = req.headers.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : '';
}

/*
 * Turn an upstream failure into something worth reading.
 *
 * This is deliberately specific, and it is safe to be: the path is only
 * reachable *after* the key has been accepted, so none of it is visible to an
 * unauthenticated caller. The messages thrown by lib/supabase.mjs carry the
 * upstream status and body but never the project URL or the service key.
 *
 * The alternative is a dashboard that says "upstream error" and leaves its one
 * user reading function logs to find out that a migration never ran.
 */
function upstreamDiagnosis(message) {
  const hint =
    /Missing SUPABASE/.test(message)
      ? 'SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY are not visible to this deploy. Set them and redeploy.'
    : /Could not find the function|PGRST202|does not exist/i.test(message)
      ? 'Connected, but dm_dashboard() is missing — supabase/schema.sql has not been run on this project.'
    : /\b401\b|Invalid API key|JWSError|invalid signature/i.test(message)
      ? 'Supabase rejected the credentials. SUPABASE_SERVICE_ROLE_KEY is probably the publishable/anon key rather than the secret service_role one.'
    : /\b403\b|permission denied/i.test(message)
      ? 'Authenticated but not permitted — the grants at the end of schema.sql did not run. Re-run the whole file.'
    : /fetch failed|ENOTFOUND|ECONNREFUSED|getaddrinfo/i.test(message)
      ? 'Could not open a connection at all. SUPABASE_URL is probably wrong — it should look like https://<ref>.supabase.co with no path.'
      : 'Unrecognised upstream failure. The raw message is below.';

  return {
    hint,
    upstream: message,
    supabaseEnvSeen: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']
      .filter((n) => Boolean(process.env[n])),
  };
}
const PRIVATE = {
  'Cache-Control': 'no-store, private',
  'X-Robots-Tag': 'noindex, nofollow',
};

export default async (req) => {
  if (req.method !== 'GET') {
    return json({ error: 'method not allowed' }, { status: 405, headers: PRIVATE });
  }

  // A malformed constant must never mean "let everyone in". If the hash has
  // not been filled in, or was pasted wrong, refuse to serve at all.
  if (!HASH_SHAPE.test(DASHBOARD_PASSWORD_SHA256)) {
    console.error(
      'dashboard-data: DASHBOARD_PASSWORD_SHA256 is not a 64-character hex digest — refusing to serve. Run `node make-hash.js` and paste the result in.'
    );
    return json(
      { error: 'dashboard is not configured' },
      { status: 503, headers: PRIVATE }
    );
  }

  const supplied = bearer(req);
  if (!supplied || !matches(supplied)) {
    // No plaintext, and no length either — a length is a hint about the secret
    // and this log line is not worth one.
    console.warn('dashboard-data: rejected a password.');
    return json(
      { error: 'unauthorized' },
      { status: 401, headers: PRIVATE }
    );
  }

  let data;
  try {
    data = await rpc('dm_dashboard');
  } catch (err) {
    console.error('dashboard-data: rpc failed —', err.message);
    return json(
      { error: 'upstream error', detail: upstreamDiagnosis(err.message) },
      { status: 502, headers: PRIVATE }
    );
  }

  return json(data, { headers: PRIVATE });
};
