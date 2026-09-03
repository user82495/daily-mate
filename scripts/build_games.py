#!/usr/bin/env python3
"""Build games.json — the pool for Guess the Elo.

    zstdcat lichess_db_standard_rated_2019-03.pgn.zst | python3 scripts/build_games.py -
    python3 scripts/build_games.py lichess_db_standard_rated_2019-03.pgn.zst

Reads a Lichess monthly PGN dump and keeps games that are actually guessable:
both players rated, within 100 points of each other, 20-60 plies, decisive.

The rating filter is the point of the mode. A game between 1200 and 2100 has no
single answer, so both Elos must be close before "guess the Elo" means anything.

Even spread, not natural distribution
-------------------------------------
Lichess is overwhelmingly 1400-1800, so an unbucketed sample would be almost
entirely mid-range and a player would learn to guess 1600 and stop looking at
the board. The output is bucketed by average rating across 800-2400 and filled
evenly, which makes the mode a test of reading a game rather than of
remembering the mode's own distribution.

Reading, and when it stops
--------------------------
Input is streamed a game at a time and never held in memory, so `-` (stdin)
works and a 30GB dump costs nothing but time. By default the script stops the
moment every band is full, which on a large dump means reading a fraction of
it.

That early exit is a real trade for a small one: the sample becomes the first
qualifying games per band rather than a uniform sample of the whole file. Since
a dump is one month in rough chronological order, "first" mostly means "earlier
in the month", which is not a bias that matters for guessing a rating. The
property that does matter — an even spread across bands — is unaffected,
because a band is only ever full at its target.

Pass --full-scan to read the whole file and take a uniform reservoir sample
instead. It is the better sample and it costs a complete pass.

Rare bands may never fill from a small dump; those are reported rather than
silently topped up from their neighbours, since a thin 2300 band is worth
knowing about.
"""

import argparse
import io
import json
import os
import random
import re
import sys
import time
from pathlib import Path

import chess.pgn

ELO_SPREAD = 100          # maximum gap between the two players
PLY_MIN, PLY_MAX = 20, 60
BAND_LO, BAND_HI = 800, 2400
BAND_WIDTH = 100
CAP = 800
SEED = 20260101
PROGRESS_EVERY = 10_000

SITE_ID = re.compile(r"lichess\.org/(\w{8})")


def open_pgn(source):
    """Stream a .pgn, a .pgn.zst, or stdin. Never loads the input into memory."""
    if str(source) == "-":
        # The dump is decompressed by whatever is upstream in the pipe, so the
        # tens of gigabytes never touch the disk.
        return io.TextIOWrapper(sys.stdin.buffer, encoding="utf-8", errors="replace")
    path = Path(source)
    if path.suffix == ".zst":
        # Python 3.14 ships Zstandard in the standard library (PEP 784).
        from compression.zstd import ZstdFile
        return io.TextIOWrapper(ZstdFile(path, "rb"), encoding="utf-8", errors="replace")
    return path.open(encoding="utf-8", errors="replace")


def release(fh) -> None:
    """
    Stop reading and let an upstream `zstdcat` find out promptly.

    Closing our end makes the next write upstream fail with EPIPE, which is how
    the pipeline shuts down when we exit at the cap instead of at EOF. zstd may
    print "Write error : Broken pipe" as it goes; that is the mechanism working,
    not a failure, and the exit status of the pipeline is still ours.
    """
    try:
        fh.close()
    except (BrokenPipeError, OSError):
        pass


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("pgn", help="PGN dump (.pgn or .pgn.zst), or - for stdin")
    p.add_argument("--out", type=Path, default=Path("data/games.json"))
    p.add_argument("--cap", type=int, default=CAP)
    p.add_argument("--seed", type=int, default=SEED)
    p.add_argument("--full-scan", action="store_true",
                   help="read to EOF and take a uniform sample instead of stopping at the cap")
    p.add_argument("--max-games", type=int, default=0,
                   help="stop after reading this many games (0 = no limit)")
    p.add_argument("--progress-every", type=int, default=PROGRESS_EVERY,
                   help="games between progress lines on stderr")
    return p.parse_args()


def band_of(avg: int) -> int | None:
    if not BAND_LO <= avg < BAND_HI:
        return None
    return (avg - BAND_LO) // BAND_WIDTH


def main() -> int:
    args = parse_args()
    if args.pgn != "-" and not Path(args.pgn).exists():
        print(f"not found: {args.pgn}", file=sys.stderr)
        return 1

    n_bands = (BAND_HI - BAND_LO) // BAND_WIDTH
    per_band = max(1, args.cap // n_bands)
    rng = random.Random(args.seed)

    buckets: list[list[dict]] = [[] for _ in range(n_bands)]
    seen_in_band = [0] * n_bands
    read = kept = 0
    rejected = {"unrated": 0, "mismatch": 0, "length": 0, "drawn": 0, "band": 0}
    started = time.monotonic()
    stopped_early = False

    fh = open_pgn(args.pgn)
    try:
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
            if read % args.progress_every == 0:
                elapsed = time.monotonic() - started
                print(f"  scanned {read:>10,}   kept {kept:>5,}   {elapsed:6.1f}s",
                      file=sys.stderr, flush=True)

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

            slot = buckets[band]
            # A full band in the default mode needs nothing further from this
            # game, and walking its mainline is the expensive part.
            if not args.full_scan and len(slot) >= per_band:
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
            site = h.get("Site", "")
            found = SITE_ID.search(site)
            entry = {
                "id": found.group(1) if found else (site or f"g{read}"),
                # PGN movetext only — the client replays SAN and needs nothing else.
                "pgn": " ".join(san),
                "whiteElo": white,
                "blackElo": black,
                "result": result,
                "timeControl": h.get("TimeControl", "?"),
            }

            if len(slot) < per_band:
                slot.append(entry)
                kept += 1
                # Every band at target: there is nothing left to learn from the
                # rest of the dump, which may be another 25GB of it.
                if not args.full_scan and all(len(b) >= per_band for b in buckets):
                    stopped_early = True
                    break
            elif args.full_scan:
                j = rng.randrange(seen_in_band[band])
                if j < per_band:
                    slot[j] = entry
    finally:
        release(fh)

    games = [g for slot in buckets for g in slot]
    rng.shuffle(games)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(games, separators=(",", ":")), encoding="utf-8")

    size_kb = args.out.stat().st_size / 1024
    elapsed = time.monotonic() - started
    print()
    print(f"read       {read:>9,} games in {elapsed:.1f}s"
          + ("  (stopped at the cap)" if stopped_early else "  (to EOF)"))
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
    try:
        sys.exit(main())
    except BrokenPipeError:
        # Our *own* stdout went away (`... | head`). Point the fd at /dev/null so
        # interpreter shutdown does not try to flush into the closed pipe and
        # print a second, more confusing error on the way out.
        os.dup2(os.open(os.devnull, os.O_WRONLY), sys.stdout.fileno())
        sys.exit(141)
    except KeyboardInterrupt:
        sys.exit(130)
