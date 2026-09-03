/*
 * dataloader.js — fetch a mode's JSON once, keep it in memory.
 *
 * The daily puzzle ships its positions inside puzzles.js and must not wait on
 * any of this. Nothing here is imported by the daily's path: a mode's data is
 * requested when its route is first entered, and never before.
 *
 * A second entry into the same mode reuses the array. A request already in
 * flight is shared rather than duplicated, so double-tapping a mode card makes
 * one request, not two.
 */

import { SOURCES, byId } from './modecatalog.js';

const cache = new Map();     // mode -> array
const inflight = new Map();  // mode -> promise

export class DataError extends Error {}

/*
 * A dataset is either a bare array of rows, or an object wrapping one.
 *
 * The wrapper exists so a file can carry a fact about itself — `evals.json`
 * has to say whether its brilliant labels were engine-verified, and an array
 * has nowhere to put that. The older files are plain arrays and stay that way;
 * there is nothing to migrate and no version field to reason about.
 */
function unwrap(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    for (const key of ['positions', 'games', 'puzzles', 'items']) {
      if (Array.isArray(raw[key])) return raw[key];
    }
  }
  return null;
}

/** Everything in the file that is not the rows — the wrapper's own fields. */
function meta(raw) {
  if (!raw || Array.isArray(raw) || typeof raw !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) if (!Array.isArray(v)) out[k] = v;
  return out;
}

/**
 * The dataset for a mode.
 *
 * @param {string} mode
 * @returns {Promise<Array>} rejects with DataError if it cannot be had
 */
export function loadData(mode) {
  if (cache.has(mode)) return Promise.resolve(cache.get(mode));
  if (inflight.has(mode)) return inflight.get(mode);

  const url = SOURCES[mode];
  if (!url) return Promise.reject(new DataError(`unknown mode: ${mode}`));

  /**
   * One retry, after a short pause.
   *
   * A mode's data is requested at the same moment the service worker is
   * precaching the shell, so the first attempt lands in the middle of a burst
   * of other requests — and on a phone changing cells, or any server that
   * sheds load, a single dropped response would otherwise show the player
   * "could not load this mode" for a file that is perfectly fine. One retry
   * costs 400ms in the rare case and nothing in the common one.
   */
  const attempt = (n) =>
    fetch(url, { headers: { Accept: 'application/json' } })
      .then((res) => {
        if (!res.ok) throw new DataError(`${url} → ${res.status}`);
        return res.json();
      })
      .catch((err) => {
        if (n <= 0) throw err;
        return new Promise((r) => setTimeout(r, 400)).then(() => attempt(n - 1));
      });

  const promise = attempt(1)
    .then((raw) => {
      const data = unwrap(raw);
      if (!Array.isArray(data) || data.length === 0) {
        throw new DataError(`${url} is empty`);
      }
      // A dataset can exist and still not be fit to use. Judge's is the case
      // that matters: an evals.json built without an engine holds blunders
      // only, and a mode where every answer is "blunder" is not a mode. The
      // catalog says how to tell; failing here means the route shows the same
      // "could not load" state a missing file would, which is the point.
      const check = byId[mode]?.verify;
      if (check && !check(JSON.stringify(meta(raw)))) {
        throw new DataError(`${url} is present but not verified`);
      }
      cache.set(mode, data);
      inflight.delete(mode);
      return data;
    })
    .catch((err) => {
      // Clear the in-flight entry so a retry is possible; a failed fetch should
      // not poison the mode for the rest of the session.
      inflight.delete(mode);
      throw err instanceof DataError ? err : new DataError(String(err.message || err));
    });

  inflight.set(mode, promise);
  return promise;
}

/** True when the data is already in memory — used to skip the skeleton. */
export function isLoaded(mode) {
  return cache.has(mode);
}

/* --------------------------------------------------------------- skeleton */

/**
 * The placeholder shown while a mode's data is on the way.
 *
 * Deliberately plain: a board-shaped block and a line of text, in the app's own
 * surface colour. It is on screen for a few hundred milliseconds on a first
 * visit and never again, so anything more elaborate would mostly be seen by
 * people on bad connections, who are the last people who need an animation.
 */
export function skeleton(message = 'Loading…') {
  const el = document.createElement('div');
  el.className = 'mode-skeleton';
  el.innerHTML = `
    <div class="skeleton-board" aria-hidden="true"></div>
    <p class="skeleton-note">${message}</p>
  `;
  return el;
}

/** The failure state, with a retry that re-runs whatever the caller passes. */
export function loadError(onRetry) {
  const el = document.createElement('div');
  el.className = 'mode-skeleton';
  el.innerHTML = `
    <p class="skeleton-note">Could not load this mode.</p>
    <button class="result-btn" type="button">Try again</button>
  `;
  el.querySelector('button').addEventListener('click', onRetry);
  return el;
}

/**
 * Load a mode's data into a stage: skeleton, then render, with a retry.
 *
 * The four modes all wanted the same fifteen lines, and the obvious shape for
 * them — `loadData(m).then(render).catch(showError)` — is quietly wrong: a
 * `.catch` after a `.then` also swallows anything the render threw, so a bug in
 * a mode reports itself as "could not load this mode" and the real message is
 * never seen. Here the two are separated, and a render failure is re-thrown so
 * it reaches the console instead of being disguised.
 *
 * @param {string} mode
 * @param {HTMLElement} stage      replaced with the skeleton, then by `render`
 * @param {string} message         shown while loading
 * @param {(data: Array) => void} render
 * @param {() => boolean} isDisposed
 */
export function bootstrap(mode, stage, message, render, isDisposed = () => false) {
  const attempt = () => {
    if (!isLoaded(mode)) stage.replaceChildren(skeleton(message));

    loadData(mode).then(
      (data) => {
        if (isDisposed()) return;
        // Outside the promise chain's catch on purpose: a throw in here is a
        // bug in the mode, not a failure to load, and must not be relabelled.
        queueMicrotask(() => { if (!isDisposed()) render(data); });
      },
      (err) => {
        if (isDisposed()) return;
        console.error(`${mode}: ${err.message}`);
        stage.replaceChildren(loadError(attempt));
      }
    );
  };
  attempt();
}

