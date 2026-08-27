/*
 * api.js — the server calls behind streaks, percentiles and notifications.
 *
 * Everything here goes to a Netlify function under /api/, never to Supabase
 * directly. That is the same decision netlify/functions/lib/supabase.mjs
 * documents for analytics: the browser holds no database credentials, and a
 * player's IP terminates at Netlify instead of landing in Supabase's edge logs.
 *
 * Unlike analytics.js, these calls have results the UI waits on — a streak to
 * show, a percentile to print. So they resolve rather than fire and forget.
 * They still never throw: every one of them answers `null` when the network,
 * the server, or localStorage is unavailable, and every caller treats that as
 * "show nothing" rather than "show an error". The game itself never depends on
 * any of it.
 */

import { playerId, existingPlayerId } from './player.js';

const ENDPOINT_COMPLETE = '/api/complete';
const ENDPOINT_STATS = '/api/player-stats';
const ENDPOINT_PERCENTILE = '/api/percentile';
const ENDPOINT_SUBSCRIBE = '/api/push-subscribe';
const ENDPOINT_VAPID = '/api/vapid-key';

const TIMEOUT_MS = 6000;

/** fetch with a deadline, resolving to null on any failure at all. */
async function ask(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: { Accept: 'application/json', ...(options.headers || {}) },
    });
    if (!res.ok) return null;
    if (res.status === 204) return {};
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function post(url, body) {
  return ask(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Record a finished puzzle and get the authoritative streak back.
 *
 * The streak arithmetic happens in Postgres, not here — see dm_complete_puzzle.
 * This call is what makes the server the source of truth for stats.
 *
 * @returns {Promise<{counted:boolean, freeze_used:boolean, stats:object}|null>}
 */
export function completePuzzle({ puzzleId, solved, solveSeconds }) {
  const id = playerId();
  if (!id) return Promise.resolve(null);
  return post(ENDPOINT_COMPLETE, {
    playerId: id,
    puzzleId,
    solved,
    solveSeconds: Number.isFinite(solveSeconds) ? Math.round(solveSeconds) : null,
  });
}

/**
 * Lifetime stats for this device.
 *
 * Uses the id only if one already exists: opening the stats page as a brand-new
 * visitor should show an empty page, not create an identifier.
 *
 * @returns {Promise<object|null>}
 */
export function fetchPlayerStats() {
  const id = existingPlayerId();
  if (!id) return Promise.resolve(null);
  return ask(`${ENDPOINT_STATS}?player=${encodeURIComponent(id)}`);
}

/**
 * "Faster than N% of solvers today."
 *
 * The server withholds this until enough people have solved the puzzle, so a
 * null covers both "too few solvers yet" and "could not ask" — the line simply
 * stays hidden either way.
 *
 * @returns {Promise<{fasterThan:number|null}|null>}
 */
export function fetchPercentile({ puzzleId, solveSeconds }) {
  if (!Number.isFinite(solveSeconds)) return Promise.resolve(null);
  const q = new URLSearchParams({
    puzzle: puzzleId,
    seconds: String(Math.round(solveSeconds)),
  });
  return ask(`${ENDPOINT_PERCENTILE}?${q}`);
}

/** The VAPID public key, needed before a push subscription can be created. */
export function fetchVapidKey() {
  return ask(ENDPOINT_VAPID);
}

/** Store (or replace) this device's push subscription. */
export function savePushSubscription({ subscription, notifyHour, timezone }) {
  const id = playerId();
  if (!id) return Promise.resolve(null);
  const json = subscription.toJSON ? subscription.toJSON() : subscription;
  return post(ENDPOINT_SUBSCRIBE, {
    playerId: id,
    endpoint: json.endpoint,
    p256dh: json.keys?.p256dh,
    auth: json.keys?.auth,
    notifyHour,
    timezone,
  });
}
