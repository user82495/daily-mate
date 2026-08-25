/*
 * dashboard.js — the private analytics page.
 *
 * This file is public, like everything else on a static host, and it is meant
 * to be: it contains no data and no secret. The key is typed in, kept in
 * sessionStorage for the tab's lifetime only, and sent as a bearer token to
 * /api/dashboard-data, which is where the actual guard lives. Nothing is
 * rendered that the server did not agree to hand over.
 *
 * Chart.js is vendored (vendor/chart.umd.min.js, MIT) and loaded as a plain
 * script before this module, so `Chart` is a global here.
 */

import { PUZZLES } from '../puzzles.js';
import { puzzleFor } from './daily.js';

const $ = (id) => document.getElementById(id);

const STORE_KEY = 'dailymate.dash.key';
const ENDPOINT = '/api/dashboard-data';

/* ------------------------------------------------------------------ theme */

const css = getComputedStyle(document.documentElement);
const tok = (name) => css.getPropertyValue(name).trim();

const COLOR = {
  accent: tok('--accent'),
  muted: tok('--sq-dark'),
  fail: tok('--fail'),
  line: tok('--line'),
  text: tok('--text'),
  textDim: tok('--text-dim'),
  textFaint: tok('--text-faint'),
  surface2: tok('--surface-2'),
};

/** #RRGGBB -> rgba(), for the fill under the line. */
function alpha(hex, a) {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

Chart.defaults.color = COLOR.textDim;
Chart.defaults.borderColor = COLOR.line;
Chart.defaults.font.family = tok('--font');
Chart.defaults.font.size = 11;
Chart.defaults.animation.duration = 320;

const TOOLTIP = {
  backgroundColor: COLOR.surface2,
  borderColor: COLOR.line,
  borderWidth: 1,
  titleColor: COLOR.text,
  bodyColor: COLOR.textDim,
  cornerRadius: 8,
  padding: 10,
  displayColors: false,
};

/** Axis defaults: no vertical rules, faint horizontal ones, whole numbers. */
function scales({ x = {}, y = {} } = {}) {
  return {
    x: {
      grid: { display: false },
      border: { color: COLOR.line },
      ticks: { color: COLOR.textFaint, maxRotation: 0, autoSkipPadding: 12 },
      ...x,
    },
    y: {
      beginAtZero: true,
      grid: { color: COLOR.line, drawTicks: false },
      border: { display: false },
      ticks: { color: COLOR.textFaint, precision: 0, padding: 8 },
      ...y,
    },
  };
}

/* ----------------------------------------------------------- formatting */

const nf = new Intl.NumberFormat();

/** "2026-08-09" -> "9 Aug". Parsed as UTC so the label never slips a day. */
function shortDate(iso) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

function pct(part, whole) {
  return whole ? `${Math.round((part / whole) * 100)}%` : '—';
}

/**
 * The puzzle a day number belongs to, for labelling. The dashboard sits beside
 * the game, so it can just ask puzzles.js rather than storing puzzle ids in
 * the database — one less thing collected.
 */
function puzzleLabel(dayNum) {
  const { number, puzzle } = puzzleFor(dayNum);
  return { number, label: `#${number}`, puzzle };
}

/* ---------------------------------------------------------------- charts */

const charts = new Map();

/** Charts own their canvas; rebuild wholesale rather than diffing on refresh. */
function draw(id, config) {
  charts.get(id)?.destroy();
  charts.set(id, new Chart($(id), config));
}

function drawDailyPlayers(daily) {
  draw('c-dau', {
    type: 'line',
    data: {
      labels: daily.map((d) => shortDate(d.day_date)),
      datasets: [{
        data: daily.map((d) => Number(d.players)),
        borderColor: COLOR.accent,
        backgroundColor: alpha(COLOR.accent, 0.1),
        borderWidth: 2,
        fill: true,
        tension: 0.3,
        pointRadius: daily.length > 60 ? 0 : 2.5,
        pointHoverRadius: 5,
        pointBackgroundColor: COLOR.accent,
        pointBorderWidth: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...TOOLTIP,
          callbacks: {
            label: (ctx) => `${nf.format(ctx.parsed.y)} player${ctx.parsed.y === 1 ? '' : 's'}`,
          },
        },
      },
      scales: scales(),
    },
  });
}

function drawNewVsReturning(daily) {
  draw('c-mix', {
    type: 'bar',
    data: {
      labels: daily.map((d) => shortDate(d.day_date)),
      datasets: [
        {
          label: 'Returning',
          data: daily.map((d) => Number(d.returning_players)),
          backgroundColor: COLOR.muted,
          borderRadius: 3,
        },
        {
          label: 'New',
          data: daily.map((d) => Number(d.new_players)),
          backgroundColor: COLOR.accent,
          borderRadius: 3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'top',
          align: 'end',
          labels: {
            boxWidth: 10,
            boxHeight: 10,
            usePointStyle: true,
            pointStyle: 'rectRounded',
            color: COLOR.textFaint,
          },
        },
        tooltip: { ...TOOLTIP, displayColors: true },
      },
      scales: scales({ x: { stacked: true }, y: { stacked: true } }),
    },
  });
}

function drawPuzzleSolveRates(puzzles) {
  // Hardest first: ascending solve rate. Ties break on the older puzzle, so
  // the order is stable between refreshes.
  const rows = [...puzzles].sort(
    (a, b) => Number(a.solve_rate) - Number(b.solve_rate) || a.day_num - b.day_num
  );

  // One row per puzzle, so the box has to grow rather than squeeze.
  $('box-puzzles').style.height = `${Math.max(180, rows.length * 26 + 44)}px`;

  draw('c-puzzles', {
    type: 'bar',
    data: {
      labels: rows.map((r) => puzzleLabel(r.day_num).label),
      datasets: [{
        data: rows.map((r) => Number(r.solve_rate)),
        backgroundColor: COLOR.accent,
        borderRadius: 3,
        barThickness: 14,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          ...TOOLTIP,
          callbacks: {
            title: (items) => {
              const row = rows[items[0].dataIndex];
              const { number, puzzle } = puzzleLabel(row.day_num);
              return `#${number} · mate in ${puzzle.mateIn} · ${puzzle.id}`;
            },
            label: (ctx) => {
              const row = rows[ctx.dataIndex];
              return `${row.solve_rate}% — ${nf.format(row.solved)} of ${nf.format(row.plays)} solved`;
            },
            afterLabel: (ctx) => shortDate(rows[ctx.dataIndex].day_date),
          },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          max: 100,
          grid: { color: COLOR.line, drawTicks: false },
          border: { display: false },
          ticks: { color: COLOR.textFaint, callback: (v) => `${v}%` },
        },
        y: {
          grid: { display: false },
          border: { color: COLOR.line },
          ticks: { color: COLOR.textFaint, font: { family: tok('--font-num') } },
        },
      },
    },
  });
}

function drawBuckets(id, rows, valueKey, { failLast = false, noun = 'player' } = {}) {
  const values = rows.map((r) => Number(r[valueKey]));
  const total = values.reduce((a, b) => a + b, 0);

  draw(id, {
    type: 'bar',
    data: {
      labels: rows.map((r) => r.bucket),
      datasets: [{
        data: values,
        backgroundColor: rows.map((r, i) =>
          failLast && i === rows.length - 1 ? COLOR.fail : COLOR.accent
        ),
        borderRadius: 4,
        maxBarThickness: 56,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          ...TOOLTIP,
          callbacks: {
            label: (ctx) => {
              const n = ctx.parsed.y;
              const share = total ? ` (${Math.round((n / total) * 100)}%)` : '';
              return `${nf.format(n)} ${noun}${n === 1 ? '' : 's'}${share}`;
            },
          },
        },
      },
      scales: scales({
        x: { ticks: { color: COLOR.textDim, font: { family: tok('--font-num'), size: 13 } } },
      }),
    },
  });
}

/* ------------------------------------------------------------- retention */

/**
 * The headline rate, over the cohorts old enough to count. A cohort that has
 * not yet had its day-7 cannot have failed it, so including it would report
 * churn that has not happened.
 */
function headlineRetention(rows, which) {
  const eligible = rows.filter((r) => r[`${which}_eligible`]);
  const size = eligible.reduce((n, r) => n + Number(r.cohort_size), 0);
  const back = eligible.reduce((n, r) => n + Number(r[`${which}_returned`]), 0);
  return size ? Math.round((back / size) * 100) : null;
}

function renderCohorts(rows) {
  const cell = (row, which) => {
    if (!row[`${which}_eligible`]) return '<td class="num none">—</td>';
    const back = Number(row[`${which}_returned`]);
    const size = Number(row.cohort_size);
    return `<td class="num">${nf.format(back)} <span class="pct">${pct(back, size)}</span></td>`;
  };

  $('cohort-rows').innerHTML = [...rows]
    .reverse() // newest cohort at the top: that is the one being watched
    .map((row) => `
      <tr>
        <td>${shortDate(row.cohort_date)} <span class="pct">${puzzleLabel(row.cohort_day).label}</span></td>
        <td class="num">${nf.format(row.cohort_size)}</td>
        ${cell(row, 'd1')}
        ${cell(row, 'd7')}
      </tr>`)
    .join('');
}

/* ----------------------------------------------------------------- render */

function render(data) {
  const totals = data.totals || {};
  const plays = Number(totals.total_plays || 0);

  $('stamp').textContent = data.generated_at
    ? `updated ${new Date(data.generated_at).toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      })}`
    : '';

  $('empty').hidden = plays > 0;
  $('content').hidden = plays === 0;
  if (plays === 0) return;

  const d1 = headlineRetention(data.retention, 'd1');
  const d7 = headlineRetention(data.retention, 'd7');

  $('t-plays').textContent = nf.format(plays);
  $('t-players').textContent = nf.format(Number(totals.total_players || 0));
  $('t-d1').textContent = d1 === null ? '—' : `${d1}%`;
  $('t-d7').textContent = d7 === null ? '—' : `${d7}%`;

  drawDailyPlayers(data.daily);
  drawNewVsReturning(data.daily);
  drawPuzzleSolveRates(data.puzzles);
  drawBuckets('c-attempts', data.attempts, 'plays', { failLast: true, noun: 'play' });
  drawBuckets('c-streaks', data.streaks, 'players', { noun: 'player' });
  renderCohorts(data.retention);
}

/* ------------------------------------------------------------------- auth */

/** Thrown when the key is the problem, as opposed to the server or network. */
class KeyRejected extends Error {}

async function fetchData(key) {
  let res;
  try {
    res = await fetch(ENDPOINT, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      cache: 'no-store',
    });
  } catch {
    throw new Error('Could not reach the server.');
  }

  if (res.status === 401) throw new KeyRejected('That key was not accepted.');
  if (res.status === 503) {
    throw new Error(
      'DASHBOARD_KEY is not set on the site, or is shorter than 24 characters.'
    );
  }
  if (res.status === 502) {
    throw new Error('The server could not reach Supabase. Check the function log.');
  }
  if (!res.ok) throw new Error(`The server answered ${res.status}.`);

  return res.json();
}

function storedKey() {
  try {
    return sessionStorage.getItem(STORE_KEY) || '';
  } catch {
    return '';
  }
}

function storeKey(key) {
  // sessionStorage, not localStorage: the key lives as long as the tab and no
  // longer. Closing it is enough to lock the dashboard again.
  try {
    if (key) sessionStorage.setItem(STORE_KEY, key);
    else sessionStorage.removeItem(STORE_KEY);
  } catch {
    /* the page still works, it just asks again on every load */
  }
}

function showLock(message = '') {
  $('dash').hidden = true;
  $('lock').hidden = false;
  $('lock-msg').textContent = message;
  $('unlock').disabled = false;
  $('key').value = '';
  $('key').focus();
}

function showDash() {
  $('lock').hidden = true;
  $('dash').hidden = false;
}

/** @returns {Promise<boolean>} whether the key worked. */
async function load(key, { onError }) {
  try {
    const data = await fetchData(key);
    showDash();
    $('dash-msg').textContent = '';
    render(data);
    return true;
  } catch (err) {
    if (err instanceof KeyRejected) {
      storeKey('');
      showLock(err.message);
      return false;
    }
    onError(err.message);
    return false;
  }
}

/* ------------------------------------------------------------------ wiring */

$('lock-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const key = $('key').value.trim();
  if (!key) return;

  $('unlock').disabled = true;
  $('lock-msg').textContent = '';

  const ok = await load(key, { onError: (msg) => { $('lock-msg').textContent = msg; } });
  if (ok) storeKey(key);
  $('unlock').disabled = false;
});

$('refresh').addEventListener('click', async () => {
  const button = $('refresh');
  button.disabled = true;
  $('dash-msg').textContent = '';
  await load(storedKey(), { onError: (msg) => { $('dash-msg').textContent = msg; } });
  button.disabled = false;
});

$('lock-btn').addEventListener('click', () => {
  storeKey('');
  for (const chart of charts.values()) chart.destroy();
  charts.clear();
  showLock();
});

/* ------------------------------------------------------------------- start */

const initial = storedKey();
if (initial) {
  load(initial, { onError: (msg) => { showLock(msg); } });
} else {
  showLock();
}

// Referenced so a stripped-down puzzles.js is caught here rather than as a
// silently mislabelled chart.
if (!Array.isArray(PUZZLES) || PUZZLES.length === 0) {
  $('dash-msg').textContent = 'puzzles.js is empty — puzzle labels will be wrong.';
}
