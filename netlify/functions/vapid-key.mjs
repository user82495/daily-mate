/*
 * vapid-key.mjs — GET /api/vapid-key
 *
 * The VAPID *public* key, which the browser needs to create a push
 * subscription. Public is the whole point of it — it is shipped to every
 * subscriber by design. The private key never leaves the environment.
 *
 * Served from a function rather than hardcoded in the client so that rotating
 * the keypair is an environment-variable change and a redeploy, not an edit to
 * a source file that then has to be kept in step with Netlify.
 */

import { json } from './lib/supabase.mjs';

export default async (req) => {
  if (req.method !== 'GET') {
    return json({ error: 'method not allowed' }, { status: 405 });
  }

  const key = process.env.VAPID_PUBLIC_KEY || '';
  if (!key) {
    // Push simply is not configured on this deploy. The UI hides the prompt.
    return json({ key: null }, { cache: 'no-store' });
  }

  return json({ key }, { cache: 'public, max-age=3600' });
};
