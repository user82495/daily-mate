/*
 * resultcard.js — the end screen every mode shares.
 *
 *   createResultScreen({
 *     title:      'Run over',
 *     headline:   14,
 *     headlineLabel: 'in a row',
 *     best:       { value: 21, isNew: false },
 *     share:      'Daily Mate — Endless\n14 in a row ♟️\n…',
 *     primary:    { label: 'Play again', onClick },
 *     secondary:  { label: 'Back to daily', href: '#/' },
 *   })
 *
 * One component, so the four modes cannot drift apart visually. It reuses the
 * daily result card's own classes — .result-card, .result-btn, .result-status —
 * rather than defining a parallel set, which is what actually keeps them
 * identical: a change to the card's look lands everywhere at once.
 *
 * The daily puzzle keeps its own bespoke card. It shows things no mode has —
 * the attempt squares, the solve-rate percentile, the explanation line — and
 * rewriting it to fit this shape would have meant changing the daily flow,
 * which is the one thing these additions must not do.
 */

import { share as shareText, copy } from './share.js';
import { track } from './track.js';

const CONFIRM_MS = 1800;

/**
 * @param {object} spec
 * @param {string} spec.mode           for the 'shared' analytics event
 * @param {string} spec.title
 * @param {number|string} spec.headline
 * @param {string} [spec.headlineLabel]
 * @param {{value:number|string,isNew:boolean,label?:string}} [spec.best]
 * @param {string} [spec.share]        omit to hide the share button entirely
 * @param {{label:string,onClick?:Function,href?:string}} [spec.primary]
 * @param {{label:string,onClick?:Function,href?:string}} [spec.secondary]
 * @param {string} [spec.note]         one quiet line under the headline
 * @returns {HTMLElement}
 */
export function createResultScreen(spec) {
  const el = document.createElement('div');
  el.className = 'result-card mode-result';

  const best = spec.best;
  const bestLine = best && best.value !== null && best.value !== undefined
    ? `<p class="result-meta${best.isNew ? ' is-new' : ''}">${
        best.isNew ? 'New personal best' : `${best.label || 'Best'} ${best.value}`
      }</p>`
    : '';

  el.innerHTML = `
    <h2 class="mode-result-title">${spec.title}</h2>
    <p class="mode-headline">
      <span class="mode-headline-value">${spec.headline}</span>
      ${spec.headlineLabel ? `<span class="mode-headline-label">${spec.headlineLabel}</span>` : ''}
    </p>
    ${bestLine}
    ${spec.note ? `<p class="result-percentile">${spec.note}</p>` : ''}
    <div class="result-actions"></div>
    <p class="result-status" role="status" aria-live="polite"></p>
  `;

  const actions = el.querySelector('.result-actions');
  const status = el.querySelector('.result-status');

  let confirmTimer = null;
  function confirmOn(button, label) {
    clearTimeout(confirmTimer);
    const original = button.dataset.label || button.textContent;
    button.dataset.label = original;
    button.textContent = label;
    button.classList.add('is-confirmed');
    confirmTimer = setTimeout(() => {
      button.textContent = button.dataset.label;
      button.classList.remove('is-confirmed');
    }, CONFIRM_MS);
  }

  function say(message) {
    status.textContent = message;
    if (message) setTimeout(() => { status.textContent = ''; }, CONFIRM_MS + 600);
  }

  function addButton(cfg, primary) {
    if (!cfg) return null;
    const tag = cfg.href ? 'a' : 'button';
    const node = document.createElement(tag);
    node.className = `result-btn${primary ? ' is-primary' : ''}`;
    node.textContent = cfg.label;
    if (cfg.href) node.href = cfg.href;
    else {
      node.type = 'button';
      node.addEventListener('click', () => cfg.onClick?.());
    }
    actions.append(node);
    return node;
  }

  // Share sits first and is the primary action when a mode offers one: the
  // whole point of a result screen is the thing you send to someone.
  if (spec.share) {
    const shareBtn = document.createElement('button');
    shareBtn.className = 'result-btn is-primary';
    shareBtn.type = 'button';
    shareBtn.textContent = 'Share';
    // Captured before awaiting: event.currentTarget is null once an async
    // handler resumes, and reading it there throws.
    shareBtn.addEventListener('click', async () => {
      const outcome = await shareText(spec.share);
      if (outcome === 'copied') {
        confirmOn(shareBtn, 'Copied!');
        say('Copied to clipboard');
      } else if (outcome === 'failed') {
        say('Could not share');
      }
      if (outcome !== 'failed' && spec.mode) track(spec.mode, 'shared', {});
    });
    actions.append(shareBtn);

    const copyBtn = document.createElement('button');
    copyBtn.className = 'result-btn';
    copyBtn.type = 'button';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', async () => {
      const ok = await copy(spec.share);
      if (ok) {
        confirmOn(copyBtn, 'Copied!');
        say('Copied to clipboard');
        if (spec.mode) track(spec.mode, 'shared', {});
      } else {
        say('Could not copy');
      }
    });
    actions.append(copyBtn);
  }

  addButton(spec.primary, !spec.share);
  addButton(spec.secondary, false);

  return el;
}

/**
 * The header every mode carries: name on the left, a way back on the right.
 * Matches the daily's own topbar so a mode does not read as a different app.
 */
export function createModeHeader(title, right = '') {
  const el = document.createElement('header');
  el.className = 'topbar';
  el.innerHTML = `
    <h1 class="wordmark"><a href="#/">Daily<span>Mate</span></a></h1>
    <div class="topbar-right">
      <span class="puzzle-no">${title}</span>
      <a class="icon-link" href="#/" aria-label="Back to the daily puzzle"
         title="Back to the daily puzzle">×</a>
    </div>
  `;
  if (right) el.querySelector('.topbar-right').insertAdjacentHTML('afterbegin', right);
  return el;
}
