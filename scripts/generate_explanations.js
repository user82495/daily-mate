#!/usr/bin/env node
/*
 * generate_explanations.js — write the one-line "why this works" for each puzzle.
 *
 * Runs locally, never in CI and never on a player's device. Explanations are
 * generated once and shipped inside puzzles.js, which is what keeps the app
 * offline-capable and means no player request ever reaches an LLM.
 *
 *   node scripts/generate_explanations.js                 # fill in what is missing
 *   node scripts/generate_explanations.js --limit 10      # just the first ten
 *   node scripts/generate_explanations.js --force         # redo them all
 *   node scripts/generate_explanations.js --dry-run       # print, write nothing
 *
 * Needs ANTHROPIC_API_KEY in the environment.
 *
 * ---------------------------------------------------------------------------
 * RESUMABLE
 * ---------------------------------------------------------------------------
 * puzzles.js is both the input and the output, and it is rewritten after every
 * batch. A puzzle that already has an explanation is skipped, so an interrupted
 * run — Ctrl-C, a dropped connection, an exhausted quota — is resumed simply by
 * running the command again. Nothing is lost but the batch in flight, and no
 * separate progress file has to be kept in step with the data.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUZZLES = path.join(HERE, '..', 'puzzles.js');

const MODEL = 'claude-opus-5';

/** Requests in flight at once, and the pause between batches. */
const CONCURRENCY = 4;
const BATCH_PAUSE_MS = 1000;

/** The brief: one sentence, under fifteen words. */
const MAX_WORDS = 15;

const SYSTEM = `You explain chess tactics to club players in one short sentence.

Rules, all of them hard:
- Name the tactical idea (deflection, smothered mate, back-rank, interference,
  overloading, discovered attack, zugzwang, and so on) and say what it does.
- Under ${MAX_WORDS} words. Aim for ten.
- One sentence. No trailing notes, no move numbers, no algebraic notation.
- Do not restate the moves; the player has just seen them.
- No preamble, no quotation marks. Return the sentence and nothing else.

Good: "Deflection: the queen can't guard both the back rank and the knight."
Good: "The knight smothers the king with his own pieces."
Bad: "Rxf8+ is a deflection because after Kxf8 White plays Qd8#."`;

/* ------------------------------------------------------------------ parsing
 * puzzles.js is a generated ES module of pure data. Rather than parse it, it is
 * imported — it is our own file and the format is known — and rewritten from
 * the parsed objects, preserving the generator's exact layout.
 */

async function readPuzzles() {
  // Cache-bust so a re-import after a write sees the new file.
  const mod = await import(`${path.toNamespacedPath(PUZZLES)}?t=${Date.now()}`);
  return mod.PUZZLES;
}

/** Re-emit puzzles.js in the same shape build-puzzles.js writes. */
function writePuzzles(puzzles) {
  const original = fs.readFileSync(PUZZLES, 'utf8');
  const header = original.slice(0, original.indexOf('export const PUZZLES'));

  const body = puzzles.map((p) => {
    const lines = [
      '  {',
      `    id: ${JSON.stringify(p.id)},`,
      `    fen: ${JSON.stringify(p.fen)},`,
      `    solution: ${JSON.stringify(p.solution)},`,
      `    mateIn: ${p.mateIn},`,
    ];
    if (p.themes) lines.push(`    themes: ${JSON.stringify(p.themes)},`);
    if (p.explanation) lines.push(`    explanation: ${JSON.stringify(p.explanation)},`);
    lines.push(
      `    solveRate: ${p.solveRate === null || p.solveRate === undefined ? 'null' : p.solveRate},`,
      `    rating: ${p.rating},`,
      '  },'
    );
    return lines.join('\n');
  }).join('\n');

  fs.writeFileSync(PUZZLES, `${header}export const PUZZLES = [\n${body}\n];\n`);
}

/* ---------------------------------------------------------------- the model */

const client = new Anthropic();

/** Trim the model's answer down to the one sentence we asked for. */
function tidy(text) {
  let s = (text || '').trim().replace(/^["'`]+|["'`]+$/g, '').trim();
  // Keep the first sentence if more than one arrived.
  const stop = s.search(/(?<=[.!?])\s+[A-Z]/);
  if (stop !== -1) s = s.slice(0, stop).trim();
  if (!s) return null;
  if (!/[.!?]$/.test(s)) s += '.';
  return s;
}

async function explain(puzzle) {
  const themes = (puzzle.themes || []).filter((t) => !/^mateIn\d$/.test(t));

  const parts = [
    `Position (FEN): ${puzzle.fen}`,
    `Solution: ${puzzle.solution.join(' ')}`,
    `This is a mate in ${puzzle.mateIn}.`,
  ];
  // Themes come from Lichess and are the most reliable signal for naming the
  // tactic. When puzzles.js predates the themes field, the model works from
  // the position alone.
  if (themes.length) parts.push(`Lichess tags: ${themes.join(', ')}`);
  parts.push('', 'Explain in one sentence why the first move works.');

  const response = await client.messages.create({
    model: MODEL,
    // Adaptive thinking is on by default for this model. The visible answer is
    // one sentence, but thinking shares the output budget — a tight max_tokens
    // would truncate before the sentence is ever written.
    max_tokens: 2000,
    output_config: { effort: 'low' },
    system: SYSTEM,
    messages: [{ role: 'user', content: parts.join('\n') }],
  });

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join(' ');

  const sentence = tidy(text);
  if (!sentence) return { error: 'empty response' };

  const words = sentence.split(/\s+/).length;
  // Over-long answers are reported rather than silently kept: the constraint is
  // what makes the line fit under the result card.
  if (words > MAX_WORDS) return { sentence, warning: `${words} words` };
  return { sentence };
}

/* ----------------------------------------------------------------- retrying */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The SDK already retries 429s and 5xx twice with backoff. This adds a couple
 * more attempts for a long unattended run over a large backlog, where a short
 * rate-limit window should cost a pause rather than a failed puzzle.
 */
async function withRetry(fn, { attempts = 4 } = {}) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const retryable =
        err instanceof Anthropic.RateLimitError
        || err instanceof Anthropic.APIConnectionError
        || (err instanceof Anthropic.APIError && err.status >= 500);
      if (!retryable || i === attempts - 1) throw err;
      const wait = Math.min(30000, 2000 * 2 ** i) + Math.random() * 500;
      console.warn(`  retrying in ${(wait / 1000).toFixed(1)}s — ${err.message}`);
      await sleep(wait);
    }
  }
  throw lastError;
}

/* --------------------------------------------------------------------- main */

async function main() {
  const args = process.argv.slice(2);
  const has = (flag) => args.includes(flag);
  const valueOf = (flag, fallback) => {
    const i = args.indexOf(flag);
    return i === -1 ? fallback : Number(args[i + 1]);
  };

  const force = has('--force');
  const dryRun = has('--dry-run');
  const limit = valueOf('--limit', Infinity);

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set.');
    console.error('  export ANTHROPIC_API_KEY=sk-ant-...');
    process.exit(1);
  }

  const puzzles = await readPuzzles();
  const todo = puzzles
    .map((p, index) => ({ p, index }))
    .filter(({ p }) => force || !p.explanation)
    .slice(0, limit);

  console.log(`${puzzles.length} puzzles, ${todo.length} to explain` +
              (force ? ' (--force)' : '') + (dryRun ? ' (--dry-run)' : ''));
  if (!todo.length) return;

  let done = 0;
  let failed = 0;
  const warnings = [];

  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    const batch = todo.slice(i, i + CONCURRENCY);

    const results = await Promise.all(batch.map(async ({ p, index }) => {
      try {
        const out = await withRetry(() => explain(p));
        return { index, id: p.id, ...out };
      } catch (err) {
        return { index, id: p.id, error: err.message };
      }
    }));

    for (const r of results) {
      if (r.error) {
        failed++;
        console.error(`  ✗ ${r.id}: ${r.error}`);
        continue;
      }
      done++;
      if (r.warning) warnings.push(`${r.id} (${r.warning})`);
      console.log(`  ✓ ${r.id}: ${r.sentence}${r.warning ? `  [${r.warning}]` : ''}`);
      if (!dryRun) puzzles[r.index].explanation = r.sentence;
    }

    // Write after every batch, which is what makes the run resumable.
    if (!dryRun) writePuzzles(puzzles);

    if (i + CONCURRENCY < todo.length) await sleep(BATCH_PAUSE_MS);
  }

  console.log('');
  console.log(`explained ${done}, failed ${failed}` + (dryRun ? ' (nothing written)' : ''));
  if (warnings.length) {
    console.log(`over ${MAX_WORDS} words, kept anyway — worth a look:`);
    warnings.forEach((w) => console.log(`  ${w}`));
  }
  const remaining = (await readPuzzles()).filter((p) => !p.explanation).length;
  if (remaining) console.log(`${remaining} still without an explanation — run again to continue.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
