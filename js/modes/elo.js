/*
 * elo.js — Guess the Elo.  #/elo
 *
 * A real game plays itself out; guess how strong the players were. Five games,
 * 100 points each, scored by how close the guess is to the average of the two
 * ratings — exact is 100, 400 out is nothing.
 *
 * The first of the five is the same game for everyone, chosen by today's date.
 * Without a fixed game a score out of 500 compares nothing: two players would
 * be guessing different positions of different difficulty and comparing the
 * totals anyway. One shared game is enough to make the number mean something
 * while the other four keep a session from being identical to yesterday's.
 *
 * Guessing is allowed at any point, including move one. Watching more is a
 * choice the player makes against the clock of their own patience, which is
 * more interesting than forcing the whole game every time.
 */

import { createBoard } from '../board.js';
import { Chess } from '../../vendor/chess.js';
import { bootstrap } from '../dataloader.js';
import { createResultScreen, createModeHeader } from '../resultcard.js';
import { recordRun } from '../profile.js';
import { track, watchForAbandon } from '../track.js';
import { dayNumber } from '../daily.js';
import { SHARE_URL } from '../share.js';

const GAMES_PER_SESSION = 5;
const MOVE_MS = 1200;
const SLIDER_MIN = 400;
const SLIDER_MAX = 2600;
const SLIDER_STEP = 50;
const ZERO_AT = 400;         // points reach zero this far from the average

export function mount(container) {
  let disposed = false;
  let abandonWatch = null;

  let pool = [];
  let session = [];
  let index = 0;
  let scores = [];
  let board = null;

  // Playback state for the game on screen.
  let fens = [];
  let sans = [];
  let ply = 0;
  let playing = false;
  let playTimer = null;

  /* ------------------------------------------------------------- scaffolding */

  container.append(createModeHeader('Guess the Elo'));

  const stage = document.createElement('div');
  stage.className = 'mode-stage';
  container.append(stage);

  // Skeleton, load, render, retry — and a render error stays a render
  // error rather than being reported as a failure to load.
  bootstrap('elo', stage, 'Loading games…', (data) => {
    pool = data;
    startSession();
  }, () => disposed);

  /* ---------------------------------------------------------------- session */

  /** A small deterministic PRNG so "today's game" is the same everywhere. */
  function seededIndex(seed, length) {
    let x = (seed * 2654435761) >>> 0;
    x ^= x >>> 15;
    x = Math.imul(x, 2246822507);
    x ^= x >>> 13;
    // Math.imul returns a *signed* 32-bit int, so x can be negative here, and
    // a negative modulo would index pool[-1] — undefined, and today's game
    // silently never renders. Coerce back to unsigned before taking it.
    return (x >>> 0) % length;
  }

  function startSession() {
    scores = [];
    index = 0;

    const today = seededIndex(dayNumber(), pool.length);
    const rest = pool.map((_, i) => i).filter((i) => i !== today);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    session = [pool[today], ...rest.slice(0, GAMES_PER_SESSION - 1).map((i) => pool[i])];

    track('elo', 'started', {});
    abandonWatch = watchForAbandon('elo', () => ({
      score: scores.reduce((a, b) => a + b, 0),
      games: scores.length,
    }));

    showGame();
  }

  /* ------------------------------------------------------------ one game */

  function showGame() {
    if (disposed) return;
    const game = session[index];

    // Expand the movetext once, into a position per ply, so stepping back is a
    // lookup rather than a replay.
    const chess = new Chess();
    fens = [chess.fen()];
    sans = [];
    for (const san of game.pgn.split(/\s+/).filter(Boolean)) {
      try {
        const move = chess.move(san);
        if (!move) break;
        sans.push(move.san);
        fens.push(chess.fen());
      } catch {
        break;                 // a movetext we cannot parse simply stops early
      }
    }

    stage.replaceChildren();
    stage.innerHTML = `
      <div class="mode-prompt">
        <span class="mate-in">Game ${index + 1} of ${GAMES_PER_SESSION}</span>
        <span class="to-move">${index === 0 ? "Today's game" : ''}</span>
      </div>
      <div class="board-wrap"><div id="elo-board"></div></div>
      <div class="mode-tray">
        <div class="elo-controls">
          <button class="elo-ctrl" id="elo-back" type="button" aria-label="Step back">‹</button>
          <button class="elo-ctrl is-play" id="elo-play" type="button" aria-label="Pause">❚❚</button>
          <button class="elo-ctrl" id="elo-fwd" type="button" aria-label="Step forward">›</button>
          <span class="elo-ply" id="elo-ply">1 / ${sans.length}</span>
        </div>
        <label class="elo-guess">
          <span class="elo-guess-value" id="elo-value">1500</span>
          <input type="range" id="elo-slider" min="${SLIDER_MIN}" max="${SLIDER_MAX}"
                 step="${SLIDER_STEP}" value="1500" aria-label="Your guess">
          <span class="elo-guess-ends"><i>${SLIDER_MIN}</i><i>${SLIDER_MAX}</i></span>
        </label>
        <button class="result-btn is-primary elo-submit" id="elo-submit" type="button">Guess</button>
      </div>
    `;

    board = createBoard(document.getElementById('elo-board'), {
      legalMoves: () => [],
      onMove: () => {},
    });
    board.setInteractive(false);

    ply = 0;
    renderPly();

    const slider = document.getElementById('elo-slider');
    const value = document.getElementById('elo-value');
    slider.addEventListener('input', () => { value.textContent = slider.value; });

    document.getElementById('elo-play').addEventListener('click', togglePlay);
    document.getElementById('elo-back').addEventListener('click', () => { pause(); step(-1); });
    document.getElementById('elo-fwd').addEventListener('click', () => { pause(); step(1); });
    document.getElementById('elo-submit')
      .addEventListener('click', () => submit(Number(slider.value)));

    play();
  }

  function renderPly() {
    board.setPosition(fens[ply]);
    const label = document.getElementById('elo-ply');
    if (label) label.textContent = `${ply} / ${sans.length}`;
  }

  function step(delta) {
    ply = Math.min(sans.length, Math.max(0, ply + delta));
    renderPly();
  }

  function play() {
    if (playing || disposed) return;
    playing = true;
    const btn = document.getElementById('elo-play');
    if (btn) { btn.textContent = '❚❚'; btn.setAttribute('aria-label', 'Pause'); }
    playTimer = setInterval(() => {
      if (ply >= sans.length) { pause(); return; }
      step(1);
    }, MOVE_MS);
  }

  function pause() {
    playing = false;
    clearInterval(playTimer);
    playTimer = null;
    const btn = document.getElementById('elo-play');
    if (btn) { btn.textContent = '▶'; btn.setAttribute('aria-label', 'Play'); }
  }

  function togglePlay() {
    if (playing) pause();
    else play();
  }

  /* ------------------------------------------------------------- scoring */

  function scoreFor(guess, average) {
    const off = Math.abs(guess - average);
    return Math.max(0, Math.round(100 * (1 - off / ZERO_AT)));
  }

  function submit(guess) {
    if (disposed) return;
    pause();

    const game = session[index];
    const average = Math.round((game.whiteElo + game.blackElo) / 2);
    const points = scoreFor(guess, average);
    scores.push(points);

    const reveal = document.createElement('div');
    reveal.className = 'elo-reveal';
    reveal.innerHTML = `
      <p class="elo-reveal-line">
        <span>White ${game.whiteElo}</span><span>Black ${game.blackElo}</span>
      </p>
      <p class="elo-reveal-avg">Average <strong>${average}</strong> · you said ${guess}</p>
      <p class="elo-reveal-points">${points} <span>/ 100</span></p>
      <button class="result-btn is-primary" id="elo-next" type="button">
        ${index + 1 < GAMES_PER_SESSION ? 'Next game' : 'See total'}
      </button>
    `;
    stage.querySelector('.mode-tray').replaceChildren(reveal);

    document.getElementById('elo-next').addEventListener('click', () => {
      index += 1;
      if (index < GAMES_PER_SESSION) showGame();
      else finish();
    });
  }

  function finish() {
    if (disposed) return;
    const total = scores.reduce((a, b) => a + b, 0);
    abandonWatch?.done();
    abandonWatch = null;
    track('elo', 'ended', { score: total });

    const { isBest, best } = recordRun('elo', total);

    stage.replaceChildren(createResultScreen({
      mode: 'elo',
      title: 'Session over',
      headline: total,
      headlineLabel: `/ ${GAMES_PER_SESSION * 100}`,
      best: { value: best, isNew: isBest },
      note: `Rounds: ${scores.join(' · ')}`,
      share: [
        'Daily Mate — Guess the Elo ♟️',
        `${total}/${GAMES_PER_SESSION * 100}`,
        scores.map((s) => (s >= 80 ? '🟩' : s >= 40 ? '🟨' : '⬜')).join(''),
        '',
        SHARE_URL,
      ].join('\n'),
      primary: { label: 'Play again', onClick: startSession },
      secondary: { label: 'Back to the daily', href: '#/' },
    }));
  }

  return {
    unmount() {
      disposed = true;
      pause();
      abandonWatch?.bail();
      abandonWatch = null;
    },
  };
}
