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
 *
 * Neither surface renders a mode whose data is not deployed. Both read the
 * same list and the same probe from modecatalog.js, so they cannot disagree
 * about what exists.
 */

import { allBests } from './profile.js';
import { formatDuration } from './share.js';
import { availableModes, probeAvailability, availableNow, MODES } from './modecatalog.js';

/** One card's markup. */
function card(mode, bests) {
  const value = bests[mode.id];
  const best = Number.isFinite(value)
    ? `<span class="mode-card-best">${mode.best(value, formatDuration)}</span>`
    : '';
  return `
    <a class="mode-card" href="#/${mode.id}">
      <span class="mode-card-name">${mode.name}</span>
      <span class="mode-card-blurb">${mode.blurb}</span>
      ${best}
    </a>`;
}

/**
 * The card list for the daily's results screen.
 *
 * Async because it will not show a mode it has not confirmed. In practice the
 * probe was started on idle long before the player finished the puzzle, so
 * this resolves in a microtask and the section is there in the same frame as
 * the rest of the sheet.
 *
 * @returns {Promise<HTMLElement|null>} null when nothing is playable
 */
export async function createKeepGoing() {
  const modes = await availableModes();
  if (!modes.length) return null;

  const bests = allBests();
  const section = document.createElement('section');
  section.className = 'keep-going';
  section.innerHTML = `
    <h3 class="hist-title">Keep going</h3>
    <div class="mode-cards">${modes.map((m) => card(m, bests)).join('')}</div>
  `;
  return section;
}

/**
 * The header control. A details/summary rather than a scripted dropdown: it
 * opens and closes on its own, closes on Escape, and is reachable by keyboard
 * without any of that being written here.
 *
 * Built synchronously so the header does not reflow once the probe lands, then
 * filled in when it does. It starts hidden: a menu button that opens onto an
 * empty list is worse than no button, and on a deploy with no mode data at all
 * that is exactly what it would be.
 */
export function createHeaderNav() {
  const nav = document.createElement('details');
  nav.className = 'mode-nav';
  nav.hidden = true;
  nav.innerHTML = `
    <summary class="icon-link" aria-label="Other modes" title="Other modes">▦</summary>
    <div class="mode-nav-menu"></div>
  `;

  const fill = (ids) => {
    const modes = MODES.filter((m) => ids.has(m.id));
    nav.hidden = modes.length === 0;
    nav.querySelector('.mode-nav-menu').innerHTML =
      modes.map((m) => `<a href="#/${m.id}">${m.name}</a>`).join('');
  };

  const known = availableNow();
  if (known) fill(known);
  else probeAvailability().then(fill);

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
