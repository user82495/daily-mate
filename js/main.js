/*
 * main.js — wires the board, the puzzle loop, storage, and the stats screen.
 */

import { createBoard } from './board.js';
import { createGame } from './game.js';
import { PUZZLES } from '../puzzles.js';
import { puzzleFor, dayNumber, countdownText, msUntilTomorrow } from './daily.js';
import { load, save, reset, todayRecord, commitResult } from './storage.js';
import { reportResult, fetchDayStats } from './analytics.js';
import { completePuzzle, fetchPercentile } from './api.js';
import { createResultCard } from './results.js';
import { maybeOfferNotifications } from './push.js';
import { startRouter } from './router.js';
import { createKeepGoing, createHeaderNav } from './modemenu.js';

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

/* ------------------------------------------------------------------- clock
 * Solve time is measured from the first board render to the final move, which
 * is the span the player actually experiences. It deliberately does not
 * survive a reload: a puzzle left open overnight would otherwise report a
 * fourteen-hour solve and poison the percentile for everyone.
 */

let startedAt = null;
const startClock = () => { if (startedAt === null) startedAt = Date.now(); };
const elapsedSeconds = () =>
  startedAt === null ? null : Math.round((Date.now() - startedAt) / 1000);

/* ------------------------------------------------------------------ board */

const board = createBoard($('board'), {
  legalMoves: (square) => game.legalMoves(square),
  onMove: (intent) => game.onPlayerMove(intent),
});

const game = createGame({ board, puzzle, onEvent: handleEvent });

const resultCard = createResultCard({ number });

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

  const seconds = elapsedSeconds();
  if (Number.isFinite(seconds)) today.seconds = seconds;

  // Dev jumps are throwaway: never let them touch lifetime stats.
  if (devIndex === null && !today.committed) {
    today.committed = true;
    today.streakSaved = commitResult(state, {
      day,
      solved,
      attemptsUsed: results.length,
    });
    reportResult({ day, solved, attemptsUsed: results.length });
    // The server owns the streak. This is also what records the row the
    // percentile is drawn from. Guarded by the same flag as the local commit,
    // so it happens once per day whatever else the player does with the tab.
    recordCompletion(solved, seconds);
  }
  persist();

  $('progress').textContent = '';

  // Show what is known now; the streak and percentile fill in when they land.
  resultCard.show({
    results,
    solved,
    seconds: Number.isFinite(seconds) ? seconds : null,
    explanation: puzzle.explanation || null,
  });

  if (solved) {
    setMessage(results.length === 1 ? 'Solved, first try.' : 'Solved.', { sticky: true });
    setTimeout(openSheet, 1100);
  }
  // The failed path opens the sheet after the solution finishes replaying.
}

/**
 * Tell the server the day is over, then fill in the two numbers only it knows.
 *
 * Nothing here is awaited by the game: a player with no network sees the card
 * without a streak line or a percentile, which is exactly the intended
 * degradation.
 */
function recordCompletion(solved, seconds) {
  completePuzzle({
    puzzleId: puzzle.id,
    solved,
    solveSeconds: Number.isFinite(seconds) ? seconds : null,
  }).then((res) => {
    const stats = res?.stats;
    if (stats) {
      resultCard.update({
        streak: Number(stats.current_streak),
        freezeUsed: Boolean(res.freeze_used),
      });
    }
    // Offer notifications only once a puzzle has actually been finished.
    maybeOfferNotifications();
  });

  if (!solved || !Number.isFinite(seconds)) return;

  fetchPercentile({ puzzleId: puzzle.id, solveSeconds: seconds }).then((res) => {
    const pct = res?.fasterThan;
    if (Number.isFinite(pct)) resultCard.update({ fasterThan: pct });
  });
}

function persist() {
  if (devIndex !== null) return;
  state.today = today;
  save(state);
}

/* -------------------------------------------------------------- the sheet */

function openSheet() {
  ensureDayStats();
  renderSheet();
  renderKeepGoing();
  $('sheet').hidden = false;
  requestAnimationFrame(() => $('sheet').classList.add('is-open'));
  startCountdown();
}

function closeSheet() {
  $('sheet').classList.remove('is-open');
  stopCountdown();
  setTimeout(() => { $('sheet').hidden = true; }, 220);
}

/* --------------------------------------------------------------- solve rate
 * "63% of players solved today's puzzle."
 *
 * undefined -> not asked yet; null -> asked, nothing to show. The server keeps
 * the number to itself until at least 20 people have played, so a null covers
 * both "too early" and "could not reach it" and the line simply stays hidden.
 * Nothing here is ever guessed or interpolated.
 */

let dayStats;

function ensureDayStats() {
  // A ?dev=1 jump is showing some other day's puzzle; today's rate would be a
  // lie against it. Never ask, never show.
  if (devIndex !== null || dayStats !== undefined) return;
  dayStats = null;
  fetchDayStats(day).then((stats) => {
    dayStats = stats;
    renderSolveRate();
  });
}

function renderSolveRate() {
  const el = $('solve-rate');
  const rate = dayStats?.solveRate;
  if (rate === null || rate === undefined) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.textContent = `${rate}% of players solved today's puzzle.`;
}

function renderSheet() {
  const solved = today.state === 'solved';
  $('sheet-title').textContent = solved
    ? (today.results.length === 1
        ? 'Solved on the first attempt'
        : `Solved in ${today.results.length}`)
    : 'Not solved';

  $('streak-saved').hidden = !today.streakSaved;

  renderSolveRate();

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

/** The four modes, under the share buttons — the main discovery surface. */
function renderKeepGoing() {
  $('keep-going-slot').replaceChildren(createKeepGoing());
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

$('sheet-close').addEventListener('click', closeSheet);

// With the day over, the attempt row reopens the results.
$('attempts').addEventListener('click', () => {
  if (today.state !== 'playing') openSheet();
});

/* ------------------------------------------------------------------- start */

if (today.state === 'playing') {
  game.start(today.results);
  renderAttempts(today.results);
  startClock();
} else {
  // Already finished today: the puzzle is done, no replay.
  renderAttempts(today.results);
  board.setPosition(puzzle.fen);
  board.setOrientation(game.playerColour, puzzle.fen);
  board.setInteractive(false);
  $('attempts').classList.add('is-done');
  // Returning to a day already finished: rebuild the card from what was stored.
  // The time is whatever was recorded when it was played, not a new measurement.
  resultCard.show({
    results: today.results,
    solved: today.state === 'solved',
    seconds: Number.isFinite(today.seconds) ? today.seconds : null,
    explanation: puzzle.explanation || null,
  });
  openSheet();
}

/* -------------------------------------------------------------- the modes */

// A small way in for someone who already did the daily. Deliberately not a
// splash screen: the daily is what loads.
document.querySelector('#daily-root .topbar-right')
  ?.prepend(createHeaderNav());

// Routing starts last. #/ is the daily and is already on screen, so this is a
// no-op on the common path; a mode's code is only imported when its route is
// actually entered.
startRouter({
  daily: $('daily-root'),
  mode: $('mode-root'),
});

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
