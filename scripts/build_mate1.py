#!/usr/bin/env python3
"""Build mate1.json — the pool for Mate in One Endless.

    python3 scripts/build_mate1.py lichess_db_puzzle.csv

Reads the Lichess puzzle CSV, keeps mate-in-one puzzles rated 600-2000, and
writes a flat list of positions with their single mating move.

A note on the Lichess format, because it catches everyone once: the `Moves`
column starts with the *opponent's* move, which creates the puzzle position.
The player's turn begins after it. So a mate-in-one has two moves in the
column, and the one we want is the second. The FEN written out is the position
after the first move has been applied — what the player actually sees.

Every puzzle is verified before it is kept: the move is played and the result
asserted to be checkmate. Lichess data is engine-generated and reliable, but a
position that is not mate would be unplayable here, and the check is cheap.
"""

import argparse
import csv
import json
import random
import sys
from pathlib import Path

import chess

RATING_MIN, RATING_MAX = 600, 2000
CAP = 3000
SEED = 20260101


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("csv", type=Path, help="path to lichess_db_puzzle.csv")
    p.add_argument("--out", type=Path, default=Path("data/mate1.json"))
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
    # Reservoir sample rather than the first N: the CSV is ordered by puzzle id,
    # so taking the head would quietly bias the set toward one slice of the
    # alphabet. Seeded, so the same CSV gives the same file every time.
    pool: list[dict] = []

    with args.csv.open(newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            scanned += 1
            if scanned % 1_000_000 == 0:
                print(f"  scanned {scanned // 1_000_000}M rows...", file=sys.stderr)

            if "mateIn1" not in (row["Themes"] or "").split():
                continue
            try:
                rating = int(row["Rating"])
            except (TypeError, ValueError):
                continue
            if not RATING_MIN <= rating <= RATING_MAX:
                continue

            moves = (row["Moves"] or "").split()
            if len(moves) != 2:
                continue  # a mate-in-one is exactly setup + mate

            try:
                board = chess.Board(row["FEN"])
                board.push_uci(moves[0])          # the opponent's setup move
                mate = chess.Move.from_uci(moves[1])
                if mate not in board.legal_moves:
                    dropped += 1
                    continue
                after = board.copy()
                after.push(mate)
                if not after.is_checkmate():
                    dropped += 1
                    continue
            except (ValueError, AssertionError):
                dropped += 1
                continue

            matched += 1
            entry = {"id": row["PuzzleId"], "fen": board.fen(), "solution": moves[1]}

            if len(pool) < args.cap:
                pool.append(entry)
            else:
                j = rng.randrange(matched)
                if j < args.cap:
                    pool[j] = entry

    # Shuffle once so the shipped order is not the order they were sampled in.
    rng.shuffle(pool)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(pool, separators=(",", ":")), encoding="utf-8")

    size_kb = args.out.stat().st_size / 1024
    print()
    print(f"scanned    {scanned:>9,} rows")
    print(f"matched    {matched:>9,}  (mateIn1, rating {RATING_MIN}-{RATING_MAX})")
    print(f"dropped    {dropped:>9,}  (failed verification)")
    print(f"written    {len(pool):>9,}  -> {args.out}  ({size_kb:,.0f} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
