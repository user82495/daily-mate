/*
 * main.js — wires the board, the puzzle loop, storage, and the stats screen.
 */

import { createBoard } from './board.js';
import { createGame } from './game.js';
import { PUZZLES } from '../puzzles.js';
import { puzzleFor, dayNumber, countdownText, msUntilTomorrow } from './daily.js';
import { load, save, reset, todayRecord, commitResult } from './storage.js';
import { shareText, share } from './share.js';

const $ = (id) => document.getElementById(id);

const params = new URLSearchParams(location.search);
const DEV = params.get('dev') === '1';

/* ------------------------------------------------------------------ state */

const state = load();
const day = dayNumber();

// ?dev=1 may pin a specific puzzle; the real rollover is untouched otherwise.
const devIndex = DEV && params.has('i') ? Number(params.get('i')) : null;
const daily = puzzleFor(day);
const index = devIndex === null
  ? daily.index
  : ((devIndex % PUZZLES.length) + PUZZLES.length) % PUZZLES.length;
const puzzle = PUZZLES[index];
const number = devIndex === null ? daily.number : index + 1;

let today = todayRecord(state, day, puzzle.id);
// A dev jump must never write over the real day's progress.
if (devIndex !== null) today = { day, puzzleId: puzzle.id, results: [], state: 'playing', streakSaved: false };

/* ------------------------------------------------------------------ board */

const board = createBoard($('board'), {
  legalMoves: (square) => game.legalMoves(square),
  onMove: (intent) => game.onPlayerMove(intent),
});

const game = createGame({ board, puzzle, onEvent: handleEvent });

/* --------------------------------------------------------------- chrome */

$('puzzle-no').textContent = `#${number}`;
$('mate-in').textContent = `Mate in ${puzzle.mateIn}`;
$('to-move').textContent = game.playerColour === 'w' ? 'White to play' : 'Black to play';

function renderAttempts(results) {
  const nodes = $('attempts').children;
  for (let i = 0; i < nodes.length; i++) {
    nodes[i].dataset.state = results[i] || 'unused';
  }
}

/** "Move 2 of 3" — where the player is inside the current attempt. */
function renderProgress(playerMoves, total) {
  const el = $('progress');
  if (today.state !== 'playing') { el.textContent = ''; return; }
  const current = Math.min(playerMoves + 1, total);
  el.textContent = `Move ${current} of ${total}`;
  el.classList.toggle('is-last', current === total && total > 1);
}

let messageTimer = null;
function setMessage(text, { sticky = false } = {}) {
  clearTimeout(messageTimer);
  const el = $('message');
  el.textContent = text || '';
  el.classList.toggle('is-visible', Boolean(text));
  if (text && !sticky) {
    messageTimer = setTimeout(() => el.classList.remove('is-visible'), 2600);
  }
}

/* ------------------------------------------------------------- game events */

function handleEvent(event) {
  switch (event.type) {
    case 'attempts-changed':
      renderAttempts(event.results);
      today.results = event.results;
      persist();
      break;

    case 'move-progress':
      renderProgress(event.playerMoves, event.total);
      break;

    case 'attempt-failed':
      setMessage(event.message, { sticky: true });
      $('progress').textContent = '';
      break;

    case 'attempt-reset':
      setMessage(
        event.attemptsLeft === 1
          ? 'Last attempt.'
          : `${event.attemptsLeft} attempts left.`
      );
      break;

    case 'solved':
      finish(true, event.results);
      break;

    case 'failed':
      finish(false, event.results);
      break;

    case 'showing-solution':
      setMessage('The solution:', { sticky: true });
      break;

    case 'solution-shown':
      setMessage('', {});
      openSheet();
      break;
  }
}

function finish(solved, results) {
  today.results = results;
  today.state = solved ? 'solved' : 'failed';

  // Dev jumps are throwaway: never let them touch lifetime stats.
  if (devIndex === null && !today.committed) {
    today.committed = true;
    today.streakSaved = commitResult(state, {
      day,
      solved,
      attemptsUsed: results.length,
    });
  }
  persist();

  $('progress').textContent = '';

  if (solved) {
    setMessage(results.length === 1 ? 'Solved, first try.' : 'Solved.', { sticky: true });
    setTimeout(openSheet, 1100);
  }
  // The failed path opens the sheet after the solution finishes replaying.
}

function persist() {
  if (devIndex !== null) return;
  state.today = today;
  save(state);
}

/* -------------------------------------------------------------- the sheet */

function openSheet() {
  renderSheet();
  $('sheet').hidden = false;
  requestAnimationFrame(() => $('sheet').classList.add('is-open'));
  startCountdown();
}

function closeSheet() {
  $('sheet').classList.remove('is-open');
  stopCountdown();
  setTimeout(() => { $('sheet').hidden = true; }, 220);
}

function renderSheet() {
  const solved = today.state === 'solved';
  $('sheet-title').textContent = solved
    ? (today.results.length === 1
        ? 'Solved on the first attempt'
        : `Solved in ${today.results.length}`)
    : 'Not solved';

  $('streak-saved').hidden = !today.streakSaved;

  // SOLVE RATE — read from the puzzle's own data. Real numbers would be fetched
  // from an aggregation endpoint at build time and baked into puzzles.js; the
  // line stays hidden while solveRate is null so nothing is ever fabricated.
  const rateEl = $('solve-rate');
  if (puzzle.solveRate === null || puzzle.solveRate === undefined) {
    rateEl.hidden = true;
  } else {
    rateEl.hidden = false;
    rateEl.textContent = `${puzzle.solveRate}% of players solved today's puzzle.`;
  }

  $('st-played').textContent = state.played;
  $('st-rate').textContent = state.played
    ? Math.round((state.solved / state.played) * 100)
    : 0;
  $('st-streak').textContent = state.currentStreak;
  $('st-max').textContent = state.maxStreak;

  renderHistogram();
}

function renderHistogram() {
  const keys = ['1', '2', '3', 'X'];
  const counts = keys.map((k) => state.dist[k] || 0);
  const max = Math.max(1, ...counts);
  const todayKey = today.state === 'solved' ? String(today.results.length) : 'X';

  $('hist').innerHTML = keys.map((key, i) => {
    const count = counts[i];
    const pct = (count / max) * 100;
    const isToday = key === todayKey;
    return `
      <div class="hist-row${isToday ? ' is-today' : ''}">
        <span class="hist-key">${key}</span>
        <div class="hist-bar" style="--w:${pct}%"><span class="hist-count">${count}</span></div>
      </div>`;
  }).join('');
}

/* ----------------------------------------------------------- the countdown */

let countdownTimer = null;
function startCountdown() {
  stopCountdown();
  const tick = () => {
    $('countdown').textContent = countdownText();
    // Rolled past local midnight while the sheet was open: bring in the new day.
    if (msUntilTomorrow() <= 1000) setTimeout(() => location.reload(), 1200);
  };
  tick();
  countdownTimer = setInterval(tick, 1000);
}
function stopCountdown() {
  clearInterval(countdownTimer);
  countdownTimer = null;
}

/* ---------------------------------------------------------------- sharing */

$('share').addEventListener('click', async () => {
  const text = shareText({ number, mateIn: puzzle.mateIn, results: today.results });
  const outcome = await share(text);
  $('share-status').textContent =
    outcome === 'copied' ? 'Copied to clipboard'
    : outcome === 'failed' ? 'Could not copy'
    : '';
  setTimeout(() => { $('share-status').textContent = ''; }, 2400);
});

$('sheet-close').addEventListener('click', closeSheet);

// With the day over, the attempt row reopens the results.
$('attempts').addEventListener('click', () => {
  if (today.state !== 'playing') openSheet();
});

/* ------------------------------------------------------------------- start */

if (today.state === 'playing') {
  game.start(today.results);
  renderAttempts(today.results);
} else {
  // Already finished today: the puzzle is done, no replay.
  renderAttempts(today.results);
  board.setPosition(puzzle.fen);
  board.setOrientation(game.playerColour, puzzle.fen);
  board.setInteractive(false);
  $('attempts').classList.add('is-done');
  openSheet();
}

/* --------------------------------------------------------------- dev tools */

if (DEV) {
  const bar = document.createElement('div');
  bar.className = 'devbar';
  bar.innerHTML = `
    <label>Puzzle
      <input type="number" id="dev-i" min="0" max="${PUZZLES.length - 1}" value="${index}">
    </label>
    <button type="button" id="dev-go">Go</button>
    <button type="button" id="dev-reset">Reset stats</button>
    <span class="dev-meta">${puzzle.id} · ${puzzle.rating} · mate in ${puzzle.mateIn}</span>
  `;
  document.body.append(bar);
  $('dev-go').addEventListener('click', () => {
    location.search = `?dev=1&i=${$('dev-i').value}`;
  });
  $('dev-reset').addEventListener('click', () => {
    reset();
    location.search = '?dev=1';
  });
}

/* --------------------------------------------------------- service worker */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      // Offline support is a bonus; never let it break the game.
    });
  });
}
