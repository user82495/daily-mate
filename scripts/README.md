# scripts/

Local data-build tools. None of these run at request time, in CI, or on a
player's device — they read very large source files and write small static JSON
that ships with the app.

```bash
python3 -m pip install chess          # python-chess, used by all four builders
```

Output defaults to `data/` at the repository root, which is what Netlify
publishes (`publish = "."` in `netlify.toml`). Override with `--out`.

---

## Where to get the sources

| Source | Used by | Download |
|---|---|---|
| Puzzle CSV (~1 GB) | `build_mate1.py`, `build_duel.py` | <https://database.lichess.org/lichess_db_puzzle.csv.zst> |
| Monthly standard games (~30 GB compressed) | `build_games.py` | <https://database.lichess.org/#standard_games> |
| Same dump, for `%eval` | `build_evals.py` | as above — evals are present in a minority of games |

Everything is CC0. The raw files are gitignored and must never be committed.

```bash
# puzzles
curl -L -O https://database.lichess.org/lichess_db_puzzle.csv.zst
python3 -c "
from compression.zstd import ZstdFile
import shutil
with ZstdFile('lichess_db_puzzle.csv.zst','rb') as i, open('lichess_db_puzzle.csv','wb') as o:
    shutil.copyfileobj(i, o, 1<<20)"

# a month of games — pick the smallest month you can tolerate; these are huge
curl -L -O https://database.lichess.org/standard/lichess_db_standard_rated_2026-01.pgn.zst
```

### Streaming from stdin

Both PGN builders accept `-` as the input, meaning "read the stream on stdin".
That is the way to use them: nothing is decompressed to disk, and nothing is
held in memory.

```bash
zstdcat lichess_db_standard_rated_2019-03.pgn.zst | python3 scripts/build_games.py -
```

```bash
zstdcat lichess_db_standard_rated_2019-03.pgn.zst \
  | python3 scripts/build_evals.py - --engine /opt/homebrew/bin/stockfish
```

They also read a `.pgn` or `.pgn.zst` path directly, which is more convenient
when the file is already on disk.

**Use an old month.** The caps are small — 800 games, 600 positions — and a
2018 or 2019 dump fills them comfortably while being a fraction of the size.
`lichess_db_standard_rated_2019-03.pgn.zst` is a few GB against ~30 GB for a
recent month, and there is nothing in a 2024 dump that makes a better dataset
for either mode. Start small; only reach for a recent month if a band or a
label comes up short.

**They stop at the cap, not at EOF.** Once every rating band is full (or both
labels have their share), the builders stop reading. On a large dump that means
touching a small fraction of it — and for `build_evals.py`, running the engine
over a small fraction of the positions.

That early exit kills the upstream `zstdcat` with SIGPIPE, which is the
intended mechanism, not a fault:

- `zstd` may print `Write error : Broken pipe` on its way out. Expected.
- Under `set -o pipefail` the *pipeline* reports 141. The builder's own exit
  status is what matters — `${PIPESTATUS[1]}` in bash — and it is 0 on success.

Pass `--full-scan` to `build_games.py` to read the whole file and take a uniform
random sample instead; it is the better sample and costs a complete pass. Both
take `--max-games N` to stop after N games, and `--progress-every N` to change
how often the progress line is printed.

### Progress

Both print progress to **stderr** every 10,000 games, so it stays out of a
redirected stdout:

```
  scanned    120,000   kept   412     38.4s
  scanned     40,000   with %eval   16,203   blunders  287 / brilliants   14    91.2s
```

`build_evals.py` reports how many games carried `%eval` because that, not the
game count, is the limiting factor — only a minority of Lichess games are
analysed.

---

## The four builders

### `build_mate1.py` → `data/mate1.json`

Mate-in-one puzzles rated 600-2000, capped at 3000.

```bash
python3 scripts/build_mate1.py lichess_db_puzzle.csv
```

Roughly a minute over the full CSV. Every puzzle is verified — the move is
played and the result asserted to be checkmate — so a bad entry cannot reach
the mode. Last run: 765,085 matched, 0 dropped.

### `build_duel.py` → `data/duel.json`

Puzzles rated 1000-1800, any theme, at least two *player* moves, capped at 1500.

```bash
python3 scripts/build_duel.py lichess_db_puzzle.csv
```

`solution` is the whole line from the puzzle position onward, opponent replies
included, so the duel mode can play the other side without a second source.
Last run: 2,666,240 matched.

### `build_games.py` → `data/games.json`

Games for Guess the Elo: both players rated and within 100 points of each other,
20-60 plies, decisive. Capped at 800.

```bash
zstdcat lichess_db_standard_rated_2019-03.pgn.zst | python3 scripts/build_games.py -
python3 scripts/build_games.py dump.pgn.zst --max-games 200000   # a quick trial
python3 scripts/build_games.py dump.pgn.zst --full-scan          # uniform sample
```

**Bucketed, not sampled.** Lichess is overwhelmingly 1400-1800, so an unbucketed
set would let a player guess 1600 forever and score well without reading the
board. The output is filled evenly across 800-2400 in 100-point bands. The
summary prints each band and flags any that the source could not fill — a thin
2300 band means feed it a bigger dump, not that the script failed.

`pgn` in the output is movetext only (SAN, space separated). Headers are not
shipped; the mode replays the moves and needs nothing else.

### `build_evals.py` → `data/evals.json`

Positions for Blunder or Brilliant. 50/50 split, capped at 600.

```bash
zstdcat lichess_db_standard_rated_2019-03.pgn.zst \
  | python3 scripts/build_evals.py - --engine /opt/homebrew/bin/stockfish
```

- **blunder** — eval drops 300cp+ from the mover's point of view, and the
  position was not already lost (prior eval within ±400)
- **brilliant** — the move gives up 3+ points of material on that move or the
  next, the eval holds or improves anyway, and no non-sacrificial move scores
  within 100cp of it

Anything fitting neither label is discarded rather than kept as "normal" — a
third bucket would be a different game.

> ⚠️ **`--engine` is required for brilliant labels.** `%eval` records one number
> per position: the evaluation after the move actually played. The alternatives
> were never evaluated, so "no non-sacrificial move within 100cp" is simply not
> answerable from the file.
>
> A brilliant label that skipped that test is not a weaker label, it is a
> different one — "a sacrifice that worked", which is often just a good move.
> So without `--engine` the script emits **blunders only** and stamps the file
> `"brilliantLabelsVerified": false`. **The app refuses to load a file carrying
> that marker**, treating it exactly like a missing file, which is what stops
> unverified labels reaching players by accident. With a UCI engine all three
> conditions are applied and the marker is true. `--engine-depth` defaults to 14.

Only a minority of Lichess games carry evals, so this needs a noticeably larger
dump than `build_games.py` to fill its cap — watch the `with %eval` column in
the progress output.

The output is wrapped rather than a bare array, so the file can carry that
marker:

```json
{"brilliantLabelsVerified":true,"engine":"...","engineDepth":14,
 "counts":{"blunder":300,"brilliant":300},"positions":[ ... ]}
```

The marker is written first on purpose: the app settles a mode's availability by
reading the opening bytes with a Range request rather than downloading the whole
file.

### `review_evals.py` → `evals-review.html`

Look at the labels before trusting them.

```bash
python3 scripts/review_evals.py                                   # 50 at random
python3 scripts/review_evals.py data/evals.json --label brilliant --count 80
open evals-review.html
```

Writes a self-contained page — no server, no network — with one board per
position, the played move drawn as an arrow, the label, and the eval swing that
produced it. Tick anything that looks wrong and press **Dump flagged IDs** to
get the list; ticks persist in the browser, so the pass survives a reload.

Worth doing at least once on a fresh dataset. The labels come from thresholds
over engine numbers, and thresholds are exactly the thing that looks reasonable
in the source and turns out wrong on contact with real games — a "blunder" that
is a lost position getting slightly more lost, a "brilliant" that is a queen
trade the material counter misread. Both are obvious by eye and invisible in a
summary line.

---

## Also here

### `generate_explanations.js`

Unrelated to the modes — writes the one-line "why this works" into `puzzles.js`
for the daily puzzle. Node, not Python. See [../SETUP.md](../SETUP.md).
