/*
 * duel.js — Puzzle Duel.  #/duel   #/duel?c=<payload>
 *
 * Five puzzles against the clock. A wrong move costs ten seconds and shows you
 * what you missed. At the end you get a link that carries the five puzzle ids
 * and your time, so whoever opens it plays exactly your set and sees how they
 * did against you.
 *
 * ---------------------------------------------------------------------------
 * THE CHALLENGE LIVES ENTIRELY IN THE URL
 * ---------------------------------------------------------------------------
 * There is no server, no room, no database row, and nothing to expire. The
 * payload is base64url of `id.id.id.id.id.centiseconds` — five puzzle ids and
 * the challenger's time. Anyone holding the link has everything needed to
 * reconstruct the duel, which is what lets this ship with no backend at all.
 *
 * It also means the time is self-reported and trivially editable: a determined
 * player can hand-craft a link claiming any time they like. That is a real
 * limitation and the right trade — the alternative is accounts and a server for
 * a game you send to one friend. Nothing is ranked on it, nothing is stored,
 * and the worst outcome is someone lying to a friend about a chess puzzle.
 *
 * A payload that does not parse, or names puzzles this build does not have, is
 * discarded silently: the visitor gets an ordinary random duel with no
 * challenge framing rather than an error about a link they did not create.
 */

import { createBoard } from '../board.js';
import { Chess } from '../../vendor/chess.js';
import { bootstrap } from '../dataloader.js';
import { createResultScreen, createModeHeader } from '../resultcard.js';
import { recordRun } from '../profile.js';
import { track, watchForAbandon } from '../track.js';
import { SHARE_URL } from '../share.js';

const PUZZLES_PER_DUEL = 5;
const PENALTY_MS = 10_000;
const REVEAL_MS = 1200;

const ID_RE = /^[A-Za-z0-9_-]{1,12}$/;

/* ------------------------------------------------------------- the payload */

function toBase64Url(text) {
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  return atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
}

export function encodeChallenge(ids, centiseconds) {
  return toBase64Url(`${ids.join('.')}.${Math.round(centiseconds)}`);
}

/**
 * @returns {{ids: string[], centis: number} | null} null for anything malformed
 */
export function decodeChallenge(payload) {
  try {
    if (!payload || payload.length > 200) return null;
    const parts = fromBase64Url(payload).split('.');
    if (parts.length !== PUZZLES_PER_DUEL + 1) return null;

    const ids = parts.slice(0, PUZZLES_PER_DUEL);
    if (!ids.every((id) => ID_RE.test(id))) return null;
    if (new Set(ids).size !== ids.length) return null;   // no repeats

    const centis = Number(parts[PUZZLES_PER_DUEL]);
    if (!Number.isInteger(centis) || centis <= 0 || centis > 60 * 60 * 100) return null;

    return { ids, centis };
  } catch {
    return null;
  }
}

function clock(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/* -------------------------------------------------------------------- mode */

export function mount(container, params) {
  let disposed = false;
  let abandonWatch = null;

  let pool = [];
  let set = [];
  let index = 0;
  let challenge = null;        // {ids, centis} when one was accepted
  let board = null;
  let chess = null;
  let current = null;
  let solutionIndex = 0;
  let accepting = false;
  let startedAt = 0;
  let penaltyMs = 0;
  let mistakes = 0;
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

  const elapsed = () => (Date.now() - startedAt) + penaltyMs;

  /* ------------------------------------------------------------- scaffolding */

  container.append(createModeHeader('Duel'));

  const stage = document.createElement('div');
  stage.className = 'mode-stage';
  container.append(stage);

  // Skeleton, load, render, retry — and a render error stays a render
  // error rather than being reported as a failure to load.
  bootstrap('duel', stage, 'Loading puzzles…', (data) => {
    pool = data;
    begin();
  }, () => disposed);

  /* ------------------------------------------------------------ set-up */

  function randomSet() {
    const picked = [];
    const taken = new Set();
    while (picked.length < PUZZLES_PER_DUEL && taken.size < pool.length) {
      const i = Math.floor(Math.random() * pool.length);
      if (taken.has(i)) continue;
      taken.add(i);
      picked.push(pool[i]);
    }
    return picked;
  }

  function begin() {
    const raw = params?.get?.('c');
    const decoded = raw ? decodeChallenge(raw) : null;

    if (decoded) {
      const byId = new Map(pool.map((p) => [p.id, p]));
      const matched = decoded.ids.map((id) => byId.get(id)).filter(Boolean);
      if (matched.length === PUZZLES_PER_DUEL) {
        challenge = decoded;
        set = matched;
        track('duel', 'challenge_accepted', { target: decoded.centis / 100 });
      }
    }
    // Either there was no challenge, or it named puzzles this build does not
    // ship. Both land on an ordinary duel with no framing.
    if (!set.length) {
      challenge = null;
      set = randomSet();
    }

    if (challenge) showChallengeIntro();
    else startRun();
  }

  function showChallengeIntro() {
    stage.replaceChildren();
    stage.innerHTML = `
      <div class="duel-intro">
        <p class="duel-intro-kicker">Someone challenged you</p>
        <p class="duel-intro-target">Beat <strong>${clock(challenge.centis * 10)}</strong></p>
        <p class="duel-intro-note">
          Five puzzles, the same five they solved, in the same order.
          A wrong move costs ten seconds.
        </p>
        <button class="result-btn is-primary" id="duel-go" type="button">Start</button>
        <a class="result-btn" href="#/">Back to the daily</a>
      </div>
    `;
    document.getElementById('duel-go').addEventListener('click', startRun);
  }

  /* -------------------------------------------------------------- the run */

  function startRun() {
    index = 0;
    penaltyMs = 0;
    mistakes = 0;

    stage.replaceChildren();
    stage.innerHTML = `
      <div class="mode-prompt">
        <span class="mate-in" id="duel-progress">Puzzle 1 of ${PUZZLES_PER_DUEL}</span>
        <span class="to-move duel-clock" id="duel-clock">0:00</span>
      </div>
      <div class="board-wrap"><div id="duel-board"></div></div>
      <div class="mode-tray">
        <p class="duel-pips" id="duel-pips"></p>
        <p class="message" id="duel-message" role="status" aria-live="polite"></p>
      </div>
    `;

    chess = new Chess();
    board = createBoard(document.getElementById('duel-board'), {
      legalMoves: (square) => chess.moves({ square, verbose: true })
        .map((m) => ({ to: m.to, promotion: m.promotion, enPassant: m.flags.includes('e') })),
      onMove: onPlayerMove,
    });

    track('duel', 'started', { challenged: challenge ? 1 : 0 });
    abandonWatch = watchForAbandon('duel', () => ({
      solved: index,
      seconds: Math.round(elapsed() / 1000),
    }));

    startedAt = Date.now();
    tickTimer = setInterval(tick, 200);
    renderPips();
    showPuzzle();
  }

  function tick() {
    const el = document.getElementById('duel-clock');
    if (el) el.textContent = clock(elapsed());
  }

  function renderPips() {
    const el = document.getElementById('duel-pips');
    if (!el) return;
    el.innerHTML = Array.from({ length: PUZZLES_PER_DUEL }, (_, i) =>
      `<span class="duel-pip${i < index ? ' is-done' : i === index ? ' is-live' : ''}"></span>`
    ).join('');
  }

  function showPuzzle() {
    if (disposed) return;
    current = set[index];
    solutionIndex = 0;

    chess.load(current.fen);
    board.setPosition(current.fen);
    board.setOrientation(chess.turn(), current.fen);
    markCheck();

    document.getElementById('duel-progress').textContent =
      `Puzzle ${index + 1} of ${PUZZLES_PER_DUEL}`;
    document.getElementById('duel-message').textContent = '';
    renderPips();

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

    const expected = current.solution[solutionIndex];
    const uci = from + to + (promotion || '');

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
    markCheck();

    // A different move that still mates is accepted — same reasoning as the
    // daily puzzle, where finding another mate is finding the mate.
    const right = uci === expected || chess.isCheckmate();
    if (!right) {
      await penalise(expected);
      return;
    }

    solutionIndex += 1;
    if (solutionIndex >= current.solution.length || chess.isCheckmate()) {
      await advance();
      return;
    }

    // The opponent's scripted reply.
    await wait(260);
    if (disposed) return;
    const reply = chess.move(current.solution[solutionIndex]);
    solutionIndex += 1;
    if (reply) { await board.applyMove(reply); markCheck(); }
    if (disposed) return;

    if (solutionIndex >= current.solution.length) { await advance(); return; }
    accepting = true;
    board.setInteractive(true);
  }

  async function penalise(expected) {
    mistakes += 1;
    penaltyMs += PENALTY_MS;

    const message = document.getElementById('duel-message');
    message.className = 'message is-visible is-wrong';
    message.textContent = '+10s';

    // Rewind to the position and play the move that was wanted, once.
    await wait(REVEAL_MS / 2);
    if (disposed) return;

    const before = chess.fen();
    chess.undo();
    board.setPosition(chess.fen());
    const answer = chess.move(expected);
    if (answer) {
      await board.applyMove(answer);
      board.flash(answer.to, 'mate');
      solutionIndex += 1;
    } else {
      chess.load(before);
    }
    if (disposed) return;
    markCheck();

    await wait(REVEAL_MS);
    if (disposed) return;

    // Continue from after the shown move: the opponent replies, or the puzzle
    // is over. Making them re-solve a puzzle they have just been shown would
    // only pad the clock.
    if (solutionIndex >= current.solution.length) { await advance(); return; }
    const reply = chess.move(current.solution[solutionIndex]);
    solutionIndex += 1;
    if (reply) { await board.applyMove(reply); markCheck(); }
    if (disposed) return;

    if (solutionIndex >= current.solution.length) { await advance(); return; }
    message.className = 'message';
    accepting = true;
    board.setInteractive(true);
  }

  async function advance() {
    index += 1;
    renderPips();
    if (index >= PUZZLES_PER_DUEL) { finish(); return; }
    await wait(420);
    if (!disposed) showPuzzle();
  }

  /* ----------------------------------------------------------------- ending */

  function finish() {
    if (disposed) return;
    const totalMs = elapsed();
    clearTimers();
    abandonWatch?.done();
    abandonWatch = null;
    track('duel', 'ended', {
      seconds: Math.round(totalMs / 1000),
      mistakes,
      challenged: challenge ? 1 : 0,
    });

    const { isBest, best } = recordRun('duel', Math.round(totalMs / 10));
    const ids = set.map((p) => p.id);
    const payload = encodeChallenge(ids, Math.round(totalMs / 10));
    const link = `https://${SHARE_URL}/#/duel?c=${payload}`;
    track('duel', 'challenge_created', {});

    let title = 'Duel complete';
    let note = mistakes
      ? `${mistakes} wrong ${mistakes === 1 ? 'move' : 'moves'} · +${mistakes * 10}s`
      : 'Clean run — no penalties.';

    if (challenge) {
      const theirs = challenge.centis * 10;
      const won = totalMs < theirs;
      title = won ? 'You win' : 'They win';
      note = `You ${clock(totalMs)} · them ${clock(theirs)}` +
             (mistakes ? ` · ${mistakes} wrong` : '');
    }

    const share = challenge
      ? [
          'Daily Mate — Duel ♟️',
          `${clock(totalMs)} vs ${clock(challenge.centis * 10)}`,
          '',
          link,
        ].join('\n')
      : [
          'Daily Mate — Duel ♟️',
          `5 puzzles in ${clock(totalMs)}${mistakes ? ` (+${mistakes * 10}s)` : ''}`,
          'Can you beat it?',
          '',
          link,
        ].join('\n');

    stage.replaceChildren(createResultScreen({
      mode: 'duel',
      title,
      headline: clock(totalMs),
      headlineLabel: challenge ? '' : 'your time',
      best: { value: best ? clock(best * 10) : null, isNew: isBest, label: 'Best' },
      note,
      share,
      primary: {
        label: challenge ? 'Challenge back' : 'New duel',
        onClick: () => {
          // A fresh set either way — re-running the same five would be practice,
          // not a duel.
          challenge = null;
          history.replaceState(null, '', '#/duel');
          set = randomSet();
          startRun();
        },
      },
      secondary: { label: 'Back to the daily', href: '#/' },
    }));
  }

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
