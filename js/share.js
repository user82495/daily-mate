/*
 * share.js — plain-text result sharing.
 *
 * The text reveals how the day went and nothing else: no board, no move
 * notation, no hint about where the pieces stand. Mate length is deliberately
 * absent too — it is a real clue about the shape of the position, and the
 * squares already say how many attempts it took.
 *
 * Layout:
 *
 *   Daily Mate #142 ♟️
 *   ⬜⬜🟩 0:47
 *   🔥 12
 *
 *   dailymatechess.netlify.app
 *
 * One square per attempt: ⬜ for an attempt that failed to mate, and a final
 * 🟩 for the solve or 🟥 for a day that ran out of attempts. So a solve on the
 * third try is ⬜⬜🟩 and a failure is ⬜⬜🟥 — three squares either way, one per
 * attempt, with the last one carrying the outcome.
 */

/** Shown as the last line of every share. Change it here and nowhere else. */
export const SHARE_URL = 'dailymatechess.netlify.app';

const SQUARE = {
  fail: '⬜',   // an attempt that did not mate
  solve: '🟩',  // the attempt that solved it
  lost: '🟥',   // the last attempt of a day that was never solved
};

const EMBLEM = '♟️';
const FLAME = '🔥';

/** mm:ss. Hours are folded into the minutes rather than adding a third field. */
export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

/**
 * The squares row for a finished day.
 *
 * @param {string[]} results finished attempts, "fail" | "solve"
 * @param {boolean}  solved
 */
function squares(results, solved) {
  if (!results.length) return solved ? SQUARE.solve : SQUARE.lost;
  return results
    .map((r, i) => {
      const isLast = i === results.length - 1;
      if (r === 'solve') return SQUARE.solve;
      // The final failed attempt of an unsolved day is the red one.
      return isLast && !solved ? SQUARE.lost : SQUARE.fail;
    })
    .join('');
}

/**
 * Build the share text.
 *
 * @param {object}   result
 * @param {number}   result.number        puzzle number, e.g. 142
 * @param {string[]} result.results       finished attempts, "fail" | "solve"
 * @param {boolean}  result.solved
 * @param {number}   [result.seconds]     time from first render to final move
 * @param {number}   [result.streak]      current streak; shown only at 2 or more
 */
export function shareText({ number, results = [], solved, seconds, streak }) {
  const timed = Number.isFinite(seconds);
  const lines = [
    `Daily Mate #${number} ${EMBLEM}`,
    timed
      ? `${squares(results, solved)} ${formatDuration(seconds)}`
      : squares(results, solved),
  ];

  // A streak of one is just "you played today" — not worth a line.
  if (Number.isFinite(streak) && streak >= 2) lines.push(`${FLAME} ${streak}`);

  lines.push('', SHARE_URL);
  return lines.join('\n');
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
  return (await copy(text)) ? 'copied' : 'failed';
}

/**
 * Clipboard only, for the "Copy result" button — which should never open a
 * share sheet, because the player asked for the opposite.
 *
 * @returns {Promise<boolean>}
 */
export async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API needs a secure context; fall back to the old selection trick.
    return legacyCopy(text);
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
