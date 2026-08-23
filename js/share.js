/*
 * share.js — plain-text result sharing.
 *
 * The text reveals how the day went and nothing else: no FEN, no moves, no
 * hint about where the pieces stand. Mate length is included because it frames
 * the score, and it is already announced to every player before they start.
 */

/** Shown as the last line of every share. Change it here and nowhere else. */
export const SHARE_URL = 'dailymate.netlify.app';

const SLOT = {
  fail: '✗',   // ✗ an attempt that failed to mate
  solve: '✓',  // ✓ the attempt that solved it
  unused: '⬜', // ⬜ an attempt never needed
};

const EMBLEM = '♔'; // ♔

/**
 * Build the share text.
 *
 * @param {object}   result
 * @param {number}   result.number   puzzle number, e.g. 14
 * @param {number}   result.mateIn   mate length announced on the board
 * @param {string[]} result.results  finished attempts, "fail" | "solve"
 */
export function shareText({ number, mateIn, results }) {
  const slots = [];
  for (let i = 0; i < 3; i++) {
    slots.push(SLOT[results[i]] || SLOT.unused);
  }
  return [
    `Daily Mate #${number} — Mate in ${mateIn}`,
    `${EMBLEM} ${slots.join(' ')}`,
    '',
    SHARE_URL,
  ].join('\n');
}

/**
 * Share the text: native sheet where the platform offers one, clipboard
 * everywhere else.
 *
 * @returns {Promise<'shared'|'copied'|'failed'>} what actually happened, so the
 *          button can report it honestly rather than claiming success blindly.
 */
export async function share(text) {
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return 'shared';
    } catch (err) {
      // The user dismissing the sheet is not a failure worth falling back on.
      if (err && err.name === 'AbortError') return 'shared';
    }
  }

  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    // Clipboard API needs a secure context; fall back to the old selection trick.
    if (legacyCopy(text)) return 'copied';
    return 'failed';
  }
}

function legacyCopy(text) {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}
