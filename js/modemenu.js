/*
 * modemenu.js — how players find the modes.
 *
 * Two surfaces, deliberately unequal.
 *
 * The "Keep going" cards sit on the daily's results screen, immediately under
 * the share buttons. That is the moment the mode list exists for: the player
 * has just finished the one puzzle there is, and the honest answer to "what
 * now?" used to be "come back tomorrow". Personal bests are shown on the cards
 * because a number you already own is a better invitation than a description.
 *
 * The header control is for the returning player who did the daily hours ago
 * and wants Endless. It is small on purpose. There is no mode-select splash:
 * the daily puzzle is the app, and anything that makes you choose before
 * playing makes the app worse.
 */

import { allBests } from './profile.js';
import { formatDuration } from './share.js';

const MODES = [
  {
    id: 'endless',
    name: 'Mate in One Endless',
    blurb: 'One move, one chance. How long a streak can you hold?',
    best: (v) => `${v} in a row`,
  },
  {
    id: 'elo',
    name: 'Guess the Elo',
    blurb: 'Watch a real game. How strong were they?',
    best: (v) => `${v}/500`,
  },
  {
    id: 'judge',
    name: 'Blunder or Brilliant',
    blurb: 'Sixty seconds. Call as many as you can.',
    best: (v) => `${v} correct`,
  },
  {
    id: 'duel',
    name: 'Puzzle Duel',
    blurb: 'Five puzzles against the clock. Send it to someone.',
    best: (v) => formatDuration(v / 100),   // stored as centiseconds
  },
];

/**
 * The card list for the daily's results screen.
 * @returns {HTMLElement}
 */
export function createKeepGoing() {
  const bests = allBests();

  const section = document.createElement('section');
  section.className = 'keep-going';
  section.innerHTML = `
    <h3 class="hist-title">Keep going</h3>
    <div class="mode-cards">
      ${MODES.map((mode) => {
        const value = bests[mode.id];
        const best = Number.isFinite(value)
          ? `<span class="mode-card-best">${mode.best(value)}</span>`
          : '';
        return `
          <a class="mode-card" href="#/${mode.id}">
            <span class="mode-card-name">${mode.name}</span>
            <span class="mode-card-blurb">${mode.blurb}</span>
            ${best}
          </a>`;
      }).join('')}
    </div>
  `;
  return section;
}

/**
 * The header control. A details/summary rather than a scripted dropdown: it
 * opens and closes on its own, closes on Escape, and is reachable by keyboard
 * without any of that being written here.
 */
export function createHeaderNav() {
  const nav = document.createElement('details');
  nav.className = 'mode-nav';
  nav.innerHTML = `
    <summary class="icon-link" aria-label="Other modes" title="Other modes">▦</summary>
    <div class="mode-nav-menu">
      ${MODES.map((m) => `<a href="#/${m.id}">${m.name}</a>`).join('')}
    </div>
  `;
  // Close once a choice is made, so returning to the daily does not find it
  // still hanging open.
  nav.addEventListener('click', (event) => {
    if (event.target.closest('a')) nav.open = false;
  });
  document.addEventListener('click', (event) => {
    if (nav.open && !nav.contains(event.target)) nav.open = false;
  });
  return nav;
}

export { MODES };
