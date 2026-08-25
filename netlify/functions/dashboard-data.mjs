/*
 * dashboard-data.mjs — GET /api/dashboard-data
 *
 * Everything dashboard.html draws, in one object. Protected by a shared secret
 * held in the DASHBOARD_KEY environment variable.
 *
 * The page itself (dashboard.html) is a public file — it has to be, it is
 * served off the same static host as the game — but it ships empty. This
 * endpoint is the thing that is actually guarded, and without the key it
 * returns nothing at all. Obscurity of the URL is not part of the protection:
 * /api/dashboard-data is as guessable as it looks.
 *
 * If DASHBOARD_KEY is missing or too short the endpoint refuses to serve
 * anything, rather than quietly falling open on a half-configured deploy.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

import { rpc, json } from './lib/supabase.mjs';

/** Short keys are guessable at internet speed; there is no rate limiting here. */
const MIN_KEY_LENGTH = 24;

/**
 * Constant-time comparison. Hashing first means both sides are always 32
 * bytes, so the comparison cannot leak the secret's length either.
 */
function matches(supplied, expected) {
  const a = createHash('sha256').update(supplied).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

function bearer(req) {
  const header = req.headers.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : '';
}

const PRIVATE = {
  'Cache-Control': 'no-store, private',
  'X-Robots-Tag': 'noindex, nofollow',
};

export default async (req) => {
  if (req.method !== 'GET') {
    return json({ error: 'method not allowed' }, { status: 405, headers: PRIVATE });
  }

  const expected = process.env.DASHBOARD_KEY || '';
  if (expected.length < MIN_KEY_LENGTH) {
    console.error(
      `dashboard-data: DASHBOARD_KEY is unset or shorter than ${MIN_KEY_LENGTH} characters — refusing to serve.`
    );
    return json(
      { error: 'dashboard is not configured' },
      { status: 503, headers: PRIVATE }
    );
  }

  const supplied = bearer(req);
  if (!supplied || !matches(supplied, expected)) {
    return json({ error: 'unauthorized' }, { status: 401, headers: PRIVATE });
  }

  let data;
  try {
    data = await rpc('dm_dashboard');
  } catch (err) {
    console.error('dashboard-data: rpc failed —', err.message);
    return json({ error: 'upstream error' }, { status: 502, headers: PRIVATE });
  }

  return json(data, { headers: PRIVATE });
};
