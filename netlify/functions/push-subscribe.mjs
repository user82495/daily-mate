/*
 * push-subscribe.mjs — POST /api/push-subscribe
 *
 * Stores (or replaces) one device's Web Push subscription, along with the hour
 * it wants to be nudged and the IANA zone that hour is measured in.
 *
 * The timezone is the one piece of information here that is not simply a
 * random handle, and it is stored because there is no other way to send at 9am
 * *local* from an hourly job. It is the zone name only — "Europe/London", not
 * a location — and it arrives because the browser volunteered it, after the
 * player asked for notifications.
 */

import { rpc, json } from './lib/supabase.mjs';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Endpoints are https URLs at the browser vendor's push service.
const MAX_ENDPOINT = 1024;
// p256dh and auth are base64url; sizes are fixed by the Web Push spec.
const KEY_RE = /^[A-Za-z0-9_-]{1,256}$/;

/** @returns {{args: object} | {error: string}} */
function validate(body) {
  if (!body || typeof body !== 'object') return { error: 'body must be an object' };

  const { playerId, endpoint, p256dh, auth, notifyHour, timezone } = body;

  if (typeof playerId !== 'string' || !UUID_RE.test(playerId)) {
    return { error: 'playerId must be a UUID' };
  }
  if (typeof endpoint !== 'string' || endpoint.length > MAX_ENDPOINT) {
    return { error: 'endpoint malformed' };
  }
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return { error: 'endpoint is not a URL' };
  }
  // Only ever talk to a real push service over TLS. This is also what stops the
  // table being used as a list of arbitrary URLs for the sender to call.
  if (url.protocol !== 'https:') return { error: 'endpoint must be https' };

  if (typeof p256dh !== 'string' || !KEY_RE.test(p256dh)) {
    return { error: 'p256dh malformed' };
  }
  if (typeof auth !== 'string' || !KEY_RE.test(auth)) {
    return { error: 'auth malformed' };
  }
  if (!Number.isInteger(notifyHour) || notifyHour < 0 || notifyHour > 23) {
    return { error: 'notifyHour must be 0-23' };
  }
  if (typeof timezone !== 'string' || timezone.length > 64) {
    return { error: 'timezone malformed' };
  }

  return {
    args: {
      p_player_id: playerId.toLowerCase(),
      p_endpoint: endpoint,
      p_p256dh: p256dh,
      p_auth: auth,
      p_notify_hour: notifyHour,
      // Postgres validates the zone against pg_timezone_names when sending;
      // an unrecognised one simply never matches and is skipped.
      p_timezone: timezone,
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
    await rpc('dm_push_subscribe', checked.args);
  } catch (err) {
    console.error('push-subscribe: rpc failed —', err.message);
    return json({ error: 'upstream error' }, { status: 502 });
  }

  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
};
