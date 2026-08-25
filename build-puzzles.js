#!/usr/bin/env node
/*
 * build-puzzles.js — generates puzzles.js from the Lichess open puzzle database.
 *
 * Runs locally only; never shipped to the client. Reads lichess_db_puzzle.csv
 * (~1GB) as a stream, filters for clean short mates, verifies every candidate
 * with chess.js, and writes a fixed-size list of puzzles as pure data.
 *
 *   node build-puzzles.js [--count 30] [--seed 20260101] [--out puzzles.js]
 *
 * Reproducible: same CSV + same seed => byte-identical puzzles.js.
 *
 * Lichess puzzle database is CC0. https://database.lichess.org/
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Chess } = require('chess.js');

/* ----------------------------------------------------------------- config */

const CSV = path.join(__dirname, 'lichess_db_puzzle.csv');

const FILTER = {
  ratingMin: 1000,
  ratingMax: 1600,
  popularityMin: 80,  // exclusive: "above 80"
  playsMin: 1000,     // exclusive: "above 1000"
  maxPieces: 16,      // exclusive: "fewer than 16"
};

// Candidates held per mate length. Bounds memory on a 6.1M-row stream; the
// reservoir keeps the sample uniform over the whole file rather than favouring
// whichever puzzles happen to appear first.
const POOL_PER_BUCKET = 4000;

/**
 * Day-by-day schedule of mate lengths.
 *
 * The brief asks for mostly mateIn2/mateIn3, roughly one mateIn1 per two weeks,
 * roughly one mateIn4 per two weeks, and never two mateIn4 in the same week.
 * Fixed slots satisfy that exactly rather than approximately, and keep the
 * ramp-in gentle: the first mateIn4 does not land on day 1.
 */
function buildSchedule(count) {
  const schedule = new Array(count).fill(null);

  // Every 14th day from an offset, so the spacing is two weeks by construction.
  for (let i = 5; i < count; i += 14) schedule[i] = 4;   // days 6, 20, ...
  for (let i = 11; i < count; i += 14) schedule[i] = 1;  // days 12, 26, ...

  // Remaining days cycle 3 x mateIn2 : 2 x mateIn3 — both common, mate-in-2
  // a little more so, since it is the friendlier daily puzzle.
  const cycle = [2, 3, 2, 3, 2];
  let c = 0;
  for (let i = 0; i < count; i++) {
    if (schedule[i] === null) schedule[i] = cycle[c++ % cycle.length];
  }
  return schedule;
}

/* -------------------------------------------------------------------- rng */

// mulberry32 — small, fast, and identical across Node versions.
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(list, rand) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/* ------------------------------------------------------------------ parse */

const MATE_THEMES = { mateIn1: 1, mateIn2: 2, mateIn3: 3, mateIn4: 4 };

function mateLengthOf(themes) {
  for (const theme of themes.split(' ')) {
    if (theme in MATE_THEMES) return MATE_THEMES[theme];
  }
  return null;
}

function countPieces(fen) {
  let n = 0;
  for (const ch of fen.split(' ')[0]) {
    if (ch !== '/' && (ch < '0' || ch > '9')) n++;
  }
  return n;
}

/* ----------------------------------------------------------------- verify */

/**
 * Confirm a puzzle really is the forced mate it claims to be.
 *
 * Applies the database's first move (the opponent move that sets up the
 * puzzle), then plays the remaining line, converting UCI to SAN as it goes.
 * Asserts the line ends in checkmate and that the player makes exactly
 * `mateIn` moves.
 *
 * @returns {{fen: string, solution: string[]} | null} null if anything fails.
 */
function verify(fenStart, uciMoves, mateIn) {
  const game = new Chess();
  try {
    game.load(fenStart);
  } catch {
    return null;
  }

  const [setup, ...rest] = uciMoves;
  if (!setup || rest.length === 0) return null;

  // The player's turn begins after the setup move is played.
  if (!playUci(game, setup)) return null;
  const fen = game.fen();

  // A mate in N is N player moves with N-1 opponent replies in between.
  if (rest.length !== mateIn * 2 - 1) return null;

  const solution = [];
  for (const uci of rest) {
    const move = playUci(game, uci);
    if (!move) return null;
    solution.push(move.san);
  }

  if (!game.isCheckmate()) return null;

  // The mating move must be the player's, i.e. the side that moved first here.
  const mover = new Chess(fen).turn();
  if (game.turn() === mover) return null;

  return { fen, solution };
}

function playUci(game, uci) {
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promotion = uci.length > 4 ? uci[4] : undefined;
  try {
    return game.move({ from, to, promotion });
  } catch {
    return null; // chess.js 1.x throws on illegal moves
  }
}

/* ------------------------------------------------------------------- main */

async function main() {
  const args = process.argv.slice(2);
  const argOf = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? fallback : args[i + 1];
  };
  const count = Number(argOf('count', 30));
  const seed = Number(argOf('seed', 20260101));
  const outPath = path.join(__dirname, argOf('out', 'puzzles.js'));

  if (!fs.existsSync(CSV)) {
    console.error(`Missing ${path.basename(CSV)}.`);
    console.error('Download: https://database.lichess.org/lichess_db_puzzle.csv.zst');
    process.exit(1);
  }

  const stats = { rows: 0, malformed: 0, matched: 0, byMate: { 1: 0, 2: 0, 3: 0, 4: 0 } };
  const pools = { 1: [], 2: [], 3: [], 4: [] };
  const seen = new Set(); // FENs already pooled, so no position repeats
  const seenCount = { n: 0 };
  const rand = rng(seed);

  const rl = readline.createInterface({
    input: fs.createReadStream(CSV, { highWaterMark: 1 << 20 }),
    crlfDelay: Infinity,
  });

  let cols = null;
  const started = Date.now();

  for await (const line of rl) {
    if (!line) continue;

    // Header drives field lookup by name — the database has gained columns
    // before (DailyDate), and positional parsing would silently misread.
    if (cols === null) {
      cols = {};
      line.split(',').forEach((name, i) => { cols[name.trim()] = i; });
      const required = ['PuzzleId', 'FEN', 'Moves', 'Rating', 'Popularity', 'NbPlays', 'Themes'];
      const missing = required.filter((r) => !(r in cols));
      if (missing.length) {
        console.error(`CSV header missing columns: ${missing.join(', ')}`);
        process.exit(1);
      }
      continue;
    }

    stats.rows++;
    if (stats.rows % 1000000 === 0) {
      process.stderr.write(`  scanned ${(stats.rows / 1e6).toFixed(0)}M rows...\n`);
    }

    // None of the fields we read can contain a comma, so a plain split is safe
    // as long as the row has at least as many fields as the header declared.
    const f = line.split(',');
    if (f.length < Object.keys(cols).length) { stats.malformed++; continue; }

    const themes = f[cols.Themes];
    const mateIn = mateLengthOf(themes);
    if (mateIn === null) continue;

    const rating = Number(f[cols.Rating]);
    if (!(rating >= FILTER.ratingMin && rating <= FILTER.ratingMax)) continue;
    if (!(Number(f[cols.Popularity]) > FILTER.popularityMin)) continue;
    if (!(Number(f[cols.NbPlays]) > FILTER.playsMin)) continue;

    const fen = f[cols.FEN];
    if (!(countPieces(fen) < FILTER.maxPieces)) continue;

    stats.matched++;
    stats.byMate[mateIn]++;

    const record = {
      id: f[cols.PuzzleId],
      fen,
      moves: f[cols.Moves].split(' '),
      rating,
      mateIn,
    };

    // Reservoir sampling: uniform sample of the whole file, bounded memory.
    const pool = pools[mateIn];
    if (pool.length < POOL_PER_BUCKET) {
      pool.push(record);
    } else {
      const j = Math.floor(rand() * stats.byMate[mateIn]);
      if (j < POOL_PER_BUCKET) pool[j] = record;
    }
  }

  const scanSeconds = ((Date.now() - started) / 1000).toFixed(1);

  // ---- select + verify -----------------------------------------------------

  const schedule = buildSchedule(count);
  const need = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const m of schedule) need[m]++;

  const dropped = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const verified = { 1: [], 2: [], 3: [], 4: [] };

  for (const mateIn of [1, 2, 3, 4]) {
    const pool = shuffle(pools[mateIn].slice(), rng(seed + mateIn));
    for (const record of pool) {
      if (verified[mateIn].length >= need[mateIn]) break;
      const result = verify(record.fen, record.moves, mateIn);
      if (!result) { dropped[mateIn]++; continue; }
      if (seen.has(result.fen)) { dropped[mateIn]++; continue; }
      seen.add(result.fen);
      verified[mateIn].push({
        id: record.id,
        fen: result.fen,
        solution: result.solution,
        mateIn,
        rating: record.rating,
      });
    }
  }

  const droppedTotal = Object.values(dropped).reduce((a, b) => a + b, 0);

  // Lay the verified puzzles onto the schedule.
  const cursor = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const selected = [];
  const shortfall = [];
  for (const mateIn of schedule) {
    const next = verified[mateIn][cursor[mateIn]++];
    if (next) selected.push(next);
    else shortfall.push(mateIn);
  }

  // ---- write ---------------------------------------------------------------

  const body = selected.map((p) => (
    '  {\n' +
    `    id: ${JSON.stringify(p.id)},\n` +
    `    fen: ${JSON.stringify(p.fen)},\n` +
    `    solution: ${JSON.stringify(p.solution)},\n` +
    `    mateIn: ${p.mateIn},\n` +
    `    rating: ${p.rating},\n` +
    '  },'
  )).join('\n');

  const out = `/*
 * puzzles.js — GENERATED FILE, DO NOT EDIT BY HAND.
 *
 * Regenerate with:  node build-puzzles.js --count ${count} --seed ${seed}
 *
 * Pure data, no logic. Every puzzle comes from the Lichess open puzzle
 * database (CC0), engine-verified upstream and re-verified here: the FEN is
 * loaded, the solution played, and the final position asserted to be checkmate
 * in exactly \`mateIn\` player moves.
 *
 *   id        Lichess PuzzleId — https://lichess.org/training/<id>
 *   fen       position the player sees, AFTER the database's first move
 *   solution  remaining moves in SAN, player and opponent alternating,
 *             starting and ending with the player
 *   mateIn    number of player moves to mate
 *   rating    Lichess difficulty rating; kept for reference, never shown
 *
 * Generated ${new Date().toISOString().slice(0, 10)} from lichess_db_puzzle.csv
 */

export const PUZZLES = [
${body}
];
`;

  fs.writeFileSync(outPath, out);

  // ---- summary -------------------------------------------------------------

  const pad = (n) => String(n).padStart(7);
  console.log('');
  console.log(`Scanned ${stats.rows.toLocaleString()} rows in ${scanSeconds}s`);
  if (stats.malformed) console.log(`Malformed rows skipped: ${stats.malformed}`);
  console.log('');
  console.log(`Matched filter:${pad(stats.matched)}`);
  console.log(`  rating ${FILTER.ratingMin}-${FILTER.ratingMax}, popularity >${FILTER.popularityMin}, ` +
              `plays >${FILTER.playsMin}, <${FILTER.maxPieces} pieces`);
  for (const m of [1, 2, 3, 4]) {
    console.log(`  mateIn${m}:${pad(stats.byMate[m])}   (pooled ${pools[m].length})`);
  }
  console.log('');
  console.log(`Dropped in verification:${pad(droppedTotal)}`);
  for (const m of [1, 2, 3, 4]) {
    if (dropped[m]) console.log(`  mateIn${m}:${pad(dropped[m])}`);
  }
  console.log('');
  console.log(`Selected:${pad(selected.length)}  -> ${path.basename(outPath)}`);
  const finalBreakdown = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const p of selected) finalBreakdown[p.mateIn]++;
  for (const m of [1, 2, 3, 4]) {
    console.log(`  mateIn${m}:${pad(finalBreakdown[m])}`);
  }

  if (shortfall.length) {
    console.log('');
    console.log(`WARNING: ${shortfall.length} slot(s) unfilled — not enough verified ` +
                `puzzles for mateIn ${[...new Set(shortfall)].join(', ')}.`);
    process.exitCode = 1;
  }
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
