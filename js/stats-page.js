/*
 * stats-page.js — the standalone stats page.
 *
 * The server is the source of truth here, because the server is what computes
 * streaks (see dm_complete_puzzle). But the page must still say something
 * useful on a plane, so when the request fails it falls back to the numbers
 * the device has been keeping locally all along, and says which it is showing.
 *
 * A visitor who has never finished a puzzle gets no identifier just for opening
 * this page — fetchPlayerStats() only uses an id that already exists.
 */

import { fetchPlayerStats } from './api.js';
import { load } from './storage.js';
import { formatDuration } from './share.js';

const $ = (id) => document.getElementById(id);

function set(id, value) {
  $(id).textContent = value;
}

function renderServer(stats) {
  set('ps-played', stats.games_played ?? 0);
  set('ps-rate', `${stats.win_percent ?? 0}%`);
  set('ps-streak', stats.current_streak ?? 0);
  set('ps-max', stats.max_streak ?? 0);
  set('ps-avg', Number.isFinite(Number(stats.avg_solve_seconds))
    ? formatDuration(stats.avg_solve_seconds)
    : '—');
  set('ps-freezes', stats.freezes_available ?? 0);
  $('ps-note').textContent = '';
}

/**
 * What the device knows on its own. Average solve time and freezes are
 * server-side concepts, so they stay blank rather than being invented.
 */
function renderLocal(reason) {
  const state = load();
  set('ps-played', state.played);
  set('ps-rate', state.played ? `${Math.round((state.solved / state.played) * 100)}%` : '0%');
  set('ps-streak', state.currentStreak);
  set('ps-max', state.maxStreak);
  set('ps-avg', '—');
  set('ps-freezes', '—');
  $('ps-note').textContent = reason;
}

(async () => {
  const stats = await fetchPlayerStats();

  if (stats && typeof stats === 'object') {
    renderServer(stats);
    return;
  }

  // Either this device has never finished a puzzle, or the request failed.
  // Both land on the local numbers; only the wording differs.
  const state = load();
  renderLocal(
    state.played
      ? 'Showing this device’s own record — could not reach the server.'
      : 'No games yet. Solve today’s puzzle to start a streak.'
  );
})();
