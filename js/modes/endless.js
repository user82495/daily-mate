/*
 * endless.js — Mate in One Endless.  #/endless
 *
 * One position, one move, sudden death. Correct and the next puzzle is already
 * on the board; wrong and the run is over.
 *
 * The whole design is about not interrupting. There is no confirm button and no
 * interstitial between puzzles, because the mode lives or dies on how quickly a
 * player can get into a rhythm — anything between "I see it" and "next one" is
 * friction, and 400ms is about the shortest pause that still reads as an event
 * rather than a glitch.
 */

import { createBoard } from '../board.js';
import { Chess } from '../../vendor/chess.js';
import { bootstrap } from '../dataloader.js';
import { createResultScreen, createModeHeader } from '../resultcard.js';
import { personalBest, recordRun } from '../profile.js';
import { track, watchForAbandon } from '../track.js';
import { SHARE_URL } from '../share.js';

const ADVANCE_MS = 400;      // correct -> next position
const REVEAL_MS = 1400;      // wrong -> how long the right move stays up

export function mount(container, params) {
  let disposed = false;
  let abandonWatch = null;

  let pool = [];
  let order = [];
  let cursor = 0;
  let streak = 0;
  let board = null;
  let chess = null;
  let current = null;
  let accepting = false;
  const timers = new Set();

  const wait = (ms) => new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    timers.add(t);
  });

  function clearTimers() {
    for (const t of timers) clearTimeout(t);
    timers.clear();
  }

  /* ------------------------------------------------------------- scaffolding */

  container.append(createModeHeader('Endless'));

  const stage = document.createElement('div');
  stage.className = 'mode-stage';
  container.append(stage);

  // Skeleton, load, render, retry — and a render error stays a render
  // error rather than being reported as a failure to load.
  bootstrap('endless', stage, 'Loading positions…', (data) => {
    pool = data;
    start();
  }, () => disposed);

  /* -------------------------------------------------------------- the run */

  function start() {
    streak = 0;
    cursor = 0;
    // A fresh shuffle each run, so a player who fails on the same position
    // twice is unlucky rather than stuck.
    order = pool.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }

    stage.replaceChildren();
    stage.innerHTML = `
      <div class="mode-prompt">
        <span class="mate-in">Mate in 1</span>
        <span class="to-move" id="endless-turn"></span>
      </div>
      <div class="board-wrap"><div id="endless-board"></div></div>
      <div class="mode-tray">
        <p class="mode-counter"><span id="endless-streak">0</span><span class="mode-counter-label">in a row</span></p>
        <p class="message" id="endless-message" role="status" aria-live="polite"></p>
      </div>
    `;

    chess = new Chess();
    board = createBoard(document.getElementById('endless-board'), {
      legalMoves: (square) => chess.moves({ square, verbose: true })
        .map((m) => ({ to: m.to, promotion: m.promotion, enPassant: m.flags.includes('e') })),
      onMove: onPlayerMove,
    });

    track('endless', 'started', {});
    abandonWatch = watchForAbandon('endless', () => ({ score: streak }));

    next();
  }

  function next() {
    if (disposed) return;
    if (cursor >= order.length) cursor = 0;   // wrapping beats running out
    current = pool[order[cursor++]];

    chess.load(current.fen);
    board.setPosition(current.fen);
    board.setOrientation(chess.turn(), current.fen);
    board.clearMarks();
    markCheck();

    document.getElementById('endless-turn').textContent =
      chess.turn() === 'w' ? 'White to play' : 'Black to play';
    document.getElementById('endless-message').textContent = '';

    accepting = true;
    board.setInteractive(true);
  }

  function markCheck() {
    board.clearMarks('check');
    if (!chess.isCheck()) return;
    for (const sq of chess.findPiece({ type: 'k', color: chess.turn() })) {
      board.mark(sq, 'check');
    }
  }

  async function onPlayerMove({ from, to, promotion }) {
    if (!accepting || disposed) return;
    accepting = false;
    board.setInteractive(false);

    let move;
    try {
      move = chess.move({ from, to, promotion });
    } catch {
      accepting = true;
      board.setInteractive(true);
      return;
    }

    await board.applyMove(move);
    if (disposed) return;

    // Any mate counts, not only the stored move: an alternative mate in one is
    // still a mate in one, and failing a player for finding a different one
    // would be indefensible.
    if (chess.isCheckmate()) {
      streak += 1;
      document.getElementById('endless-streak').textContent = streak;
      board.flash(move.to, 'mate');
      await wait(ADVANCE_MS);
      if (!disposed) next();
      return;
    }

    await lose(move);
  }

  async function lose(playedMove) {
    board.mark(playedMove.to, 'wrong');
    document.getElementById('endless-message').textContent = 'Not mate.';

    // Rewind and show the move that was there, once.
    await wait(REVEAL_MS / 2);
    if (disposed) return;
    chess.load(current.fen);
    board.setPosition(current.fen);
    const answer = chess.move(current.solution);
    if (answer) {
      await board.applyMove(answer);
      board.flash(answer.to, 'mate');
    }
    await wait(REVEAL_MS);
    if (!disposed) finish();
  }

  function finish() {
    abandonWatch?.done();
    abandonWatch = null;
    board.setInteractive(false);
    track('endless', 'ended', { score: streak });

    const { isBest, best } = recordRun('endless', streak);

    stage.replaceChildren(createResultScreen({
      mode: 'endless',
      title: streak === 0 ? 'No streak this time' : 'Run over',
      headline: streak,
      headlineLabel: streak === 1 ? 'in a row' : 'in a row',
      best: { value: best, isNew: isBest },
      share: shareString(streak, best),
      primary: { label: 'Play again', onClick: start },
      secondary: { label: 'Back to the daily', href: '#/' },
    }));
  }

  function shareString(score, best) {
    const lines = [
      'Daily Mate — Endless ♟️',
      `${score} mates in a row`,
    ];
    if (Number.isFinite(best) && best > score) lines.push(`best ${best}`);
    lines.push('', SHARE_URL);
    return lines.join('\n');
  }

  /* -------------------------------------------------------------- teardown */

  return {
    unmount() {
      disposed = true;
      clearTimers();
      abandonWatch?.bail();
      abandonWatch = null;
      board?.setInteractive(false);
    },
  };
}

export { personalBest };
