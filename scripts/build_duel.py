#!/usr/bin/env python3
"""Build duel.json — the pool for Puzzle Duel.

    python3 scripts/build_duel.py lichess_db_puzzle.csv

Reads the Lichess puzzle CSV, keeps puzzles rated 1000-1800 of any theme with
at least two moves for the player to find, and writes the full solution line.

"At least 2 moves in the solution" is counted in the player's terms: the Lichess
`Moves` column opens with the opponent's setup move, so a two-move solve is four
entries — setup, player, opponent, player. One-movers are excluded because a
duel wants puzzles you can lose time on, not reflex tests; that is what Mate in
One Endless is for.

The FEN written out is the position after the setup move, and `solution` is
every move from there on, opponent replies included, so the mode can play the
other side without a second source of truth.
"""

import argparse
import csv
import json
import random
import sys
from pathlib import Path

import chess

RATING_MIN, RATING_MAX = 1000, 1800
MIN_PLAYER_MOVES = 2
CAP = 1500
SEED = 20260101


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("csv", type=Path, help="path to lichess_db_puzzle.csv")
    p.add_argument("--out", type=Path, default=Path("data/duel.json"))
    p.add_argument("--cap", type=int, default=CAP)
    p.add_argument("--seed", type=int, default=SEED)
    return p.parse_args()


def main() -> int:
    args = parse_args()
    if not args.csv.exists():
        print(f"not found: {args.csv}", file=sys.stderr)
        return 1

    rng = random.Random(args.seed)
    scanned = matched = dropped = 0
    pool: list[dict] = []

    with args.csv.open(newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            scanned += 1
            if scanned % 1_000_000 == 0:
                print(f"  scanned {scanned // 1_000_000}M rows...", file=sys.stderr)

            try:
                rating = int(row["Rating"])
            except (TypeError, ValueError):
                continue
            if not RATING_MIN <= rating <= RATING_MAX:
                continue

            moves = (row["Moves"] or "").split()
            line = moves[1:]                      # drop the opponent's setup move
            # Player moves are the odd-indexed plies of the original list, i.e.
            # every other entry of `line` starting at 0.
            player_moves = (len(line) + 1) // 2
            if player_moves < MIN_PLAYER_MOVES:
                continue

            try:
                board = chess.Board(row["FEN"])
                board.push_uci(moves[0])
                probe = board.copy()
                for uci in line:                  # the whole line must be legal
                    probe.push_uci(uci)
            except (ValueError, AssertionError, IndexError):
                dropped += 1
                continue

            matched += 1
            entry = {"id": row["PuzzleId"], "fen": board.fen(), "solution": line}

            if len(pool) < args.cap:
                pool.append(entry)
            else:
                j = rng.randrange(matched)
                if j < args.cap:
                    pool[j] = entry

    rng.shuffle(pool)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(pool, separators=(",", ":")), encoding="utf-8")

    lengths = [ (len(p["solution"]) + 1) // 2 for p in pool ]
    size_kb = args.out.stat().st_size / 1024
    print()
    print(f"scanned    {scanned:>9,} rows")
    print(f"matched    {matched:>9,}  (rating {RATING_MIN}-{RATING_MAX}, {MIN_PLAYER_MOVES}+ player moves)")
    print(f"dropped    {dropped:>9,}  (illegal line)")
    print(f"written    {len(pool):>9,}  -> {args.out}  ({size_kb:,.0f} KB)")
    if lengths:
        spread = {n: lengths.count(n) for n in sorted(set(lengths))}
        print("  player moves per puzzle: "
              + ", ".join(f"{n}: {c}" for n, c in spread.items()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
