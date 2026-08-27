/*
 * send-notifications.mjs — scheduled, hourly.
 *
 * Sends "today's puzzle is live" to every subscriber whose local clock has just
 * reached the hour they asked for, and who has not already played today.
 *
 * Both of those conditions are decided in Postgres (dm_push_due), not here.
 * That keeps the whole "who is due" question in one place, next to the data,
 * and means this function is only a delivery loop.
 *
 * Runs once an hour, which is the resolution the feature is specified at: a
 * player picks an hour, not a minute. An hourly job also means a subscriber is
 * considered exactly once per day, because only one run will match their hour.
 */

import webpush from 'web-push';
import { rpc, json } from './lib/supabase.mjs';

/** Netlify reads this to register the cron. */
export const config = { schedule: '@hourly' };

// Send in modest waves. A push service is happy to be talked to concurrently,
// but an unbounded Promise.all over thousands of subscribers is how a function
// hits its execution limit and delivers nothing at all.
const BATCH = 50;

/** Gone for good, per the Web Push spec. Anything else may be transient. */
const DEAD = new Set([404, 410]);

function configured() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return null;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return true;
}

/**
 * The notification body. A streak is only mentioned once it is worth
 * protecting — below three days it reads as nagging about nothing.
 */
function payloadFor(streak) {
  const body = streak >= 3
    ? `Don't break your ${streak} day streak`
    : 'A new mate is waiting.';
  return JSON.stringify({
    title: "Today's puzzle is live ♟️",
    body,
    url: '/',
  });
}

async function sendOne(row) {
  const subscription = {
    endpoint: row.endpoint,
    keys: { p256dh: row.keys_p256dh, auth: row.keys_auth },
  };
  try {
    await webpush.sendNotification(subscription, payloadFor(Number(row.streak) || 0));
    return { ok: true };
  } catch (err) {
    const status = err?.statusCode;
    return { ok: false, dead: DEAD.has(status), endpoint: row.endpoint, status };
  }
}

/**
 * Only the scheduler may fire this.
 *
 * The site's /api/* redirect makes every function reachable over HTTP, and this
 * one sends a push to every due subscriber. Left open, anyone could call it in
 * a loop and notify the entire userbase repeatedly. Netlify marks a scheduled
 * invocation by POSTing a body containing `next_run`; anything without that is
 * someone knocking on the door.
 */
async function isScheduledInvocation(req) {
  if (process.env.NETLIFY_DEV) return true; // local `netlify functions:invoke`
  if (!req || req.method !== 'POST') return false;
  try {
    const body = JSON.parse(await req.text());
    return Boolean(body && body.next_run);
  } catch {
    return false;
  }
}

export default async (req) => {
  if (!(await isScheduledInvocation(req))) {
    console.warn('send-notifications: refused a non-scheduled invocation');
    return json({ error: 'not found' }, { status: 404 });
  }

  if (!configured()) {
    console.error('send-notifications: VAPID keys not set — nothing sent');
    return json({ sent: 0, skipped: 'unconfigured' });
  }

  let due;
  try {
    due = await rpc('dm_push_due');
  } catch (err) {
    console.error('send-notifications: rpc failed —', err.message);
    return json({ error: 'upstream error' }, { status: 502 });
  }

  const rows = Array.isArray(due) ? due : [];
  let sent = 0;
  let failed = 0;
  const dead = [];

  for (let i = 0; i < rows.length; i += BATCH) {
    const results = await Promise.all(rows.slice(i, i + BATCH).map(sendOne));
    for (const r of results) {
      if (r.ok) sent++;
      else {
        failed++;
        if (r.dead) dead.push(r.endpoint);
      }
    }
  }

  // A 404/410 means the browser threw the subscription away — the row is dead
  // weight and will fail again every hour until it is removed.
  let pruned = 0;
  if (dead.length) {
    try {
      pruned = await rpc('dm_push_prune', { p_endpoints: dead });
    } catch (err) {
      console.error('send-notifications: prune failed —', err.message);
    }
  }

  console.log(`send-notifications: due=${rows.length} sent=${sent} failed=${failed} pruned=${pruned}`);
  return json({ due: rows.length, sent, failed, pruned });
};
