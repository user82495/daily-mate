/*
 * judge.js — Blunder or Brilliant.  #/judge
 *
 * A position with the move that was played drawn on it as an arrow, and sixty
 * seconds to call as many as possible. Two buttons, or a swipe: left for
 * blunder, right for brilliant, matching where the buttons sit.
 *
 * The timer never pauses, including on a wrong answer. The cost of being wrong
 * is the second it takes to read the eval swing — that is the whole penalty,
 * and it is why the reveal is brief rather than a modal.
 */

import { createBoard } from '../board.js';
import { Chess } from '../../vendor/chess.js';
import { bootstrap } from '../dataloader.js';
import { createResultScreen, createModeHeader } from '../resultcard.js';
import { recordRun } from '../profile.js';
import { track, watchForAbandon } from '../track.js';
import { SHARE_URL } from '../share.js';

const ROUND_MS = 60_000;
const WRONG_REVEAL_MS = 1100;
const SWIPE_MIN_PX = 48;     // comfortably past the 44px target floor

export function mount(container) {
  let disposed = false;
  let abandonWatch = null;

  let pool = [];
  let order = [];
  let cursor = 0;
  let correct = 0;
  let answered = 0;
  let board = null;
  let current = null;
  let accepting = false;
  let endsAt = 0;
  let tickTimer = null;
  const timers = new Set();

  const wait = (ms) => new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    timers.add(t);
  });

  function clearTimers() {
    for (const t of timers) clearTimeout(t);
    timers.clear();
    clearInterval(tickTimer);
    tickTimer = null;
  }

  /* ------------------------------------------------------------- scaffolding */

  container.append(createModeHeader('Judge'));

  const stage = document.createElement('div');
  stage.className = 'mode-stage';
  container.append(stage);

  // Skeleton, load, render, retry — and a render error stays a render
  // error rather than being reported as a failure to load.
  bootstrap('judge', stage, 'Loading positions…', (data) => {
    pool = data;
    start();
  }, () => disposed);

  /* ------------------------------------------------------------------ round */

  function start() {
    correct = 0;
    answered = 0;
    cursor = 0;
    order = pool.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }

    stage.replaceChildren();
    stage.innerHTML = `
      <div class="mode-prompt">
        <span class="mate-in">Blunder or brilliant?</span>
        <span class="to-move judge-clock" id="judge-clock">1:00</span>
      </div>
      <div class="board-wrap"><div id="judge-board"></div></div>
      <div class="mode-tray">
        <p class="message judge-verdict" id="judge-verdict" role="status" aria-live="polite"></p>
        <div class="judge-buttons">
          <button class="judge-btn is-blunder" id="judge-blunder" type="button">Blunder</button>
          <button class="judge-btn is-brilliant" id="judge-brilliant" type="button">Brilliant</button>
        </div>
        <p class="mode-counter"><span id="judge-score">0</span><span class="mode-counter-label">correct</span></p>
      </div>
    `;

    board = createBoard(document.getElementById('judge-board'), {
      legalMoves: () => [],          // nothing here is interactive
      onMove: () => {},
    });
    board.setInteractive(false);

    document.getElementById('judge-blunder')
      .addEventListener('click', () => answer('blunder'));
    document.getElementById('judge-brilliant')
      .addEventListener('click', () => answer('brilliant'));
    installSwipe(document.getElementById('judge-board'));

    track('judge', 'started', {});
    abandonWatch = watchForAbandon('judge', () => ({ score: correct }));

    endsAt = Date.now() + ROUND_MS;
    tickTimer = setInterval(tick, 200);
    tick();
    next();
  }

  function tick() {
    if (disposed) return;
    const left = Math.max(0, endsAt - Date.now());
    const secs = Math.ceil(left / 1000);
    const el = document.getElementById('judge-clock');
    if (el) {
      el.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      el.classList.toggle('is-low', secs <= 10);
    }
    if (left <= 0) finish();
  }

  function next() {
    if (disposed) return;
    if (cursor >= order.length) cursor = 0;
    current = pool[order[cursor++]];

    const chess = new Chess(current.fen);
    board.setPosition(current.fen);
    board.setOrientation(chess.turn(), current.fen);
    board.clearArrows();

    // The move under judgement, drawn rather than played: the player is being
    // asked about a decision, not invited to make one.
    const from = current.move.slice(0, 2);
    const to = current.move.slice(2, 4);
    board.arrow(from, to, 'played');

    document.getElementById('judge-verdict').textContent = '';
    document.getElementById('judge-verdict').className = 'message judge-verdict';
    accepting = true;
  }

  /** Centipawns, from the mover's point of view, as players write them. */
  function pawns(cp) {
    const n = Number(cp) / 100;
    if (Math.abs(n) >= 99) return n > 0 ? '#' : '-#';
    return (n >= 0 ? '+' : '') + n.toFixed(1);
  }

  async function answer(choice) {
    if (!accepting || disposed) return;
    accepting = false;
    answered += 1;

    const right = choice === current.label;
    if (right) {
      correct += 1;
      document.getElementById('judge-score').textContent = correct;
      // No interstitial at all — the next position is the feedback.
      next();
      return;
    }

    const verdict = document.getElementById('judge-verdict');
    verdict.className = 'message judge-verdict is-visible is-wrong';
    verdict.textContent =
      `${current.label === 'blunder' ? 'Blunder' : 'Brilliant'} · ` +
      `${pawns(current.evalBefore)} → ${pawns(current.evalAfter)}`;

    await wait(WRONG_REVEAL_MS);
    if (!disposed) next();
  }

  /* ------------------------------------------------------------------ swipe */

  function installSwipe(el) {
    let startX = 0;
    let startY = 0;
    let tracking = false;

    el.addEventListener('pointerdown', (e) => {
      tracking = true;
      startX = e.clientX;
      startY = e.clientY;
    });
    el.addEventListener('pointerup', (e) => {
      if (!tracking) return;
      tracking = false;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      // Horizontal intent only: a vertical drag is the page scrolling.
      if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy)) return;
      answer(dx < 0 ? 'blunder' : 'brilliant');
    });
    el.addEventListener('pointercancel', () => { tracking = false; });
  }

  /* ----------------------------------------------------------------- ending */

  function finish() {
    if (disposed) return;
    clearTimers();
    accepting = false;
    abandonWatch?.done();
    abandonWatch = null;
    track('judge', 'ended', { score: correct, answered });

    const { isBest, best } = recordRun('judge', correct);
    const accuracy = answered ? Math.round((correct / answered) * 100) : 0;

    stage.replaceChildren(createResultScreen({
      mode: 'judge',
      title: 'Time',
      headline: correct,
      headlineLabel: correct === 1 ? 'correct' : 'correct',
      best: { value: best, isNew: isBest },
      note: answered ? `${correct} of ${answered} calls right — ${accuracy}%.` : null,
      share: [
        'Daily Mate — Blunder or Brilliant ♟️',
        `${correct} correct in 60s`,
        '',
        SHARE_URL,
      ].join('\n'),
      primary: { label: 'Play again', onClick: start },
      secondary: { label: 'Back to the daily', href: '#/' },
    }));
  }

  return {
    unmount() {
      disposed = true;
      clearTimers();
      abandonWatch?.bail();
      abandonWatch = null;
    },
  };
}
