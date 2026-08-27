/*
 * results.js — the card shown when the day is over.
 *
 * Squares, time, streak, percentile, and the one-line explanation, plus the
 * two buttons. It renders what it is given and asks for nothing itself: the
 * percentile and the server streak arrive later, so every line here can be
 * filled in twice — once immediately from what is known locally, and again
 * when the network answers. Anything that never answers stays hidden.
 */

import { shareText, formatDuration, share, copy } from './share.js';

const $ = (id) => document.getElementById(id);

/** How long "Copied!" stays on the button before it turns back into itself. */
const CONFIRM_MS = 1800;

export function createResultCard({ number }) {
  let data = {
    results: [],
    solved: false,
    seconds: null,
    streak: null,
    freezeUsed: false,
    fasterThan: null,
    explanation: null,
  };

  const card = $('result-card');
  const squaresEl = $('result-squares');
  const metaEl = $('result-meta');
  const percentileEl = $('result-percentile');
  const explanationEl = $('result-explanation');
  const statusEl = $('result-status');

  function text() {
    return shareText({
      number,
      results: data.results,
      solved: data.solved,
      seconds: Number.isFinite(data.seconds) ? data.seconds : undefined,
      streak: Number.isFinite(data.streak) ? data.streak : undefined,
    });
  }

  let confirmTimer = null;
  function confirm(button, label) {
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
    statusEl.textContent = message;
    if (message) setTimeout(() => { statusEl.textContent = ''; }, CONFIRM_MS + 600);
  }

  // The button is captured before awaiting: `event.currentTarget` is only valid
  // while the event is dispatching, and is null by the time an async handler
  // resumes. Reading it afterwards throws, and the confirmation never appears.
  $('copy-result').addEventListener('click', async () => {
    const button = $('copy-result');
    const ok = await copy(text());
    if (ok) {
      confirm(button, 'Copied!');
      say('Result copied to clipboard');
    } else {
      say('Could not copy');
    }
  });

  $('share-result').addEventListener('click', async () => {
    const button = $('share-result');
    const outcome = await share(text());
    if (outcome === 'copied') {
      confirm(button, 'Copied!');
      say('Result copied to clipboard');
    } else if (outcome === 'failed') {
      say('Could not share');
    }
    // 'shared' means the platform sheet handled it — saying anything would be
    // narrating something the player just watched happen.
  });

  function render() {
    card.hidden = false;

    // The squares row, mirroring the share text exactly. Built from the same
    // helper so the card and the clipboard can never drift apart.
    const [, squaresLine] = text().split('\n');
    squaresEl.textContent = squaresLine;

    // Streak, and the note when a freeze was what kept it alive.
    const bits = [];
    if (Number.isFinite(data.streak) && data.streak >= 1) {
      bits.push(`${data.streak} day streak`);
    }
    if (data.freezeUsed) bits.push('Streak freeze used ❄️');
    metaEl.textContent = bits.join(' · ');
    metaEl.hidden = bits.length === 0;

    // Suppressed entirely below the server's solver floor — a percentile drawn
    // from a handful of people reads as fact and is noise.
    const pct = data.fasterThan;
    percentileEl.hidden = !(Number.isFinite(pct) && data.solved);
    if (!percentileEl.hidden) {
      percentileEl.textContent = `Faster than ${pct}% of solvers today.`;
    }

    explanationEl.hidden = !data.explanation;
    if (data.explanation) explanationEl.textContent = data.explanation;
  }

  return {
    /** Fill in what is known and show the card. */
    show(next) {
      data = { ...data, ...next };
      render();
    },
    /** Fill in something that arrived late (percentile, server streak). */
    update(next) {
      data = { ...data, ...next };
      if (!card.hidden) render();
    },
    get shareText() { return text(); },
    get elapsed() { return formatDuration(data.seconds || 0); },
  };
}
