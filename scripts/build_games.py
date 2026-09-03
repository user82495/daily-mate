#!/usr/bin/env python3
"""Build games.json — the pool for Guess the Elo.

    python3 scripts/build_games.py lichess_db_standard_rated_2026-01.pgn.zst

Reads a Lichess monthly PGN dump (plain or .zst, streamed either way) and keeps
games that are actually guessable: both players rated, within 100 points of each
other, 20-60 plies, decisive.

The rating filter is the point of the mode. A game between 1200 and 2100 has no
single answer, so both Elos must be close before "guess the Elo" means anything.

Even spread, not natural distribution
-------------------------------------
Lichess is overwhelmingly 1400-1800, so an unbucketed sample would be almost
entirely mid-range and a player would learn to guess 1600 and stop looking at
the board. The output is therefore bucketed by average rating across 800-2400
and filled evenly, which makes the mode a test of reading a game rather than of
remembering the mode's own distribution.

Buckets that the source cannot fill are reported rather than silently topped up
from neighbours — a thin 2300 bucket is worth knowing about.
"""

import argparse
import io
import json
import random
import re
import sys
from pathlib import Path

import chess.pgn

ELO_SPREAD = 100          # maximum gap between the two players
PLY_MIN, PLY_MAX = 20, 60
BAND_LO, BAND_HI = 800, 2400
BAND_WIDTH = 100
CAP = 800
SEED = 20260101

SITE_ID = re.compile(r"lichess\.org/(\w{8})")


def open_pgn(path: Path):
    """Stream a .pgn or .pgn.zst without holding it in memory."""
    if path.suffix == ".zst":
        # Python 3.14 ships Zstandard in the standard library (PEP 784).
        from compression.zstd import ZstdFile
        return io.TextIOWrapper(ZstdFile(path, "rb"), encoding="utf-8", errors="replace")
    return path.open(encoding="utf-8", errors="replace")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("pgn", type=Path, help="Lichess monthly PGN dump (.pgn or .pgn.zst)")
    p.add_argument("--out", type=Path, default=Path("data/games.json"))
    p.add_argument("--cap", type=int, default=CAP)
    p.add_argument("--seed", type=int, default=SEED)
    p.add_argument("--max-games", type=int, default=0,
                   help="stop after reading this many games (0 = read the file)")
    return p.parse_args()


def band_of(avg: int) -> int | None:
    if not BAND_LO <= avg < BAND_HI:
        return None
    return (avg - BAND_LO) // BAND_WIDTH


def main() -> int:
    args = parse_args()
    if not args.pgn.exists():
        print(f"not found: {args.pgn}", file=sys.stderr)
        return 1

    n_bands = (BAND_HI - BAND_LO) // BAND_WIDTH
    per_band = max(1, args.cap // n_bands)
    rng = random.Random(args.seed)

    buckets: list[list[dict]] = [[] for _ in range(n_bands)]
    seen_in_band = [0] * n_bands
    read = kept = 0
    rejected = {"unrated": 0, "mismatch": 0, "length": 0, "drawn": 0, "band": 0}

    with open_pgn(args.pgn) as fh:
        while True:
            if args.max_games and read >= args.max_games:
                break
            try:
                game = chess.pgn.read_game(fh)
            except Exception:
                continue          # a malformed game is not a reason to stop
            if game is None:
                break

            read += 1
            if read % 100_000 == 0:
                print(f"  read {read:,} games, kept {kept:,}...", file=sys.stderr)

            h = game.headers
            result = h.get("Result", "*")
            if result not in ("1-0", "0-1"):
                rejected["drawn"] += 1
                continue
            try:
                white, black = int(h["WhiteElo"]), int(h["BlackElo"])
            except (KeyError, ValueError):
                rejected["unrated"] += 1
                continue
            if abs(white - black) > ELO_SPREAD:
                rejected["mismatch"] += 1
                continue

            avg = (white + black) // 2
            band = band_of(avg)
            if band is None:
                rejected["band"] += 1
                continue

            # Walk the mainline once, collecting SAN. This is also the length check.
            board = game.board()
            san: list[str] = []
            for move in game.mainline_moves():
                san.append(board.san(move))
                board.push(move)
                if len(san) > PLY_MAX:
                    break
            if not PLY_MIN <= len(san) <= PLY_MAX:
                rejected["length"] += 1
                continue

            seen_in_band[band] += 1
            entry = {
                "id": (SITE_ID.search(h.get("Site", "")) or [None, h.get("Site", "")])[1]
                      if SITE_ID.search(h.get("Site", "")) else h.get("Site", f"g{read}"),
                # PGN movetext only — the client replays SAN and needs nothing else.
                "pgn": " ".join(san),
                "whiteElo": white,
                "blackElo": black,
                "result": result,
                "timeControl": h.get("TimeControl", "?"),
            }

            slot = buckets[band]
            if len(slot) < per_band:
                slot.append(entry)
                kept += 1
            else:
                j = rng.randrange(seen_in_band[band])
                if j < per_band:
                    slot[j] = entry

    games = [g for slot in buckets for g in slot]
    rng.shuffle(games)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(games, separators=(",", ":")), encoding="utf-8")

    size_kb = args.out.stat().st_size / 1024
    print()
    print(f"read       {read:>9,} games")
    for reason, n in rejected.items():
        print(f"  rejected {reason:<9} {n:>9,}")
    print(f"written    {len(games):>9,}  -> {args.out}  ({size_kb:,.0f} KB)")
    print()
    print("rating spread (target %d per band):" % per_band)
    thin = 0
    for i, slot in enumerate(buckets):
        lo = BAND_LO + i * BAND_WIDTH
        flag = ""
        if len(slot) < per_band:
            flag = f"  <- short by {per_band - len(slot)}"
            thin += 1
        print(f"  {lo}-{lo + BAND_WIDTH - 1}  {len(slot):>4}{flag}")
    if thin:
        print(f"\n{thin} band(s) under target — the source did not hold enough games "
              f"at those ratings. Feed it a larger dump for an even spread.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
