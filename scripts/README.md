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

The PGN builders read `.zst` directly and stream it, so there is no need to
decompress a 200 GB file to disk. Both accept `--max-games N` to stop early,
which is the sane way to try them before committing to a full pass.

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
python3 scripts/build_games.py lichess_db_standard_rated_2026-01.pgn.zst
python3 scripts/build_games.py dump.pgn.zst --max-games 200000   # a quick trial
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
python3 scripts/build_evals.py dump.pgn.zst
python3 scripts/build_evals.py dump.pgn.zst --engine /opt/homebrew/bin/stockfish
```

- **blunder** — eval drops 300cp+ from the mover's point of view, and the
  position was not already lost (prior eval within ±400)
- **brilliant** — the move gives up 3+ points of material on that move or the
  next, the eval holds or improves anyway, and no non-sacrificial move scores
  within 100cp of it

Anything fitting neither label is discarded rather than kept as "normal" — a
third bucket would be a different game.

> ⚠️ **The third brilliant condition needs an engine.** `%eval` records one
> number per position: the evaluation after the move actually played. The
> alternatives were never evaluated, so "no non-sacrificial move within 100cp"
> is not answerable from the file. Without `--engine` the script applies the
> first two conditions and prints a warning; the output is still usable, it will
> just include sacrifices that a quiet move matched. With a UCI engine
> (stockfish) all three are applied. `--engine-depth` defaults to 14.

Note that only a minority of Lichess games carry evals, so this needs a
noticeably larger dump than `build_games.py` to fill its cap.

---

## Also here

### `generate_explanations.js`

Unrelated to the modes — writes the one-line "why this works" into `puzzles.js`
for the daily puzzle. Node, not Python. See [../SETUP.md](../SETUP.md).
