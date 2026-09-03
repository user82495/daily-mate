#!/usr/bin/env python3
"""Build evals.json — the pool for Blunder or Brilliant.

    zstdcat lichess_db_standard_rated_2019-03.pgn.zst \\
        | python3 scripts/build_evals.py - --engine /usr/local/bin/stockfish

    python3 scripts/build_evals.py games.pgn.zst --engine /path/to/stockfish

Reads a Lichess PGN dump, using only games that carry %eval annotations, and
labels the positions where something decisive happened.

    blunder    the eval drops 300cp or more from the mover's point of view,
               and the position was not already lost (prior eval within +/-400)

    brilliant  the move gives up 3+ points of material on that move or the next,
               the eval holds or improves anyway, and no non-sacrificial move
               scores within 100cp of it

Everything that fits neither label is discarded. The set is deliberately not
padded with quiet moves: a mode that asks "blunder or brilliant?" is unplayable
if most positions are neither, and a third "normal" bucket would be a different
game.

--------------------------------------------------------------------------
BRILLIANT LABELS REQUIRE --engine
--------------------------------------------------------------------------
The third condition — "no non-sacrificial move scores within 100cp" — cannot be
answered from PGN annotations. `%eval` records one number per position: the
evaluation after the move that was actually played. The alternatives were never
evaluated, so their scores are simply not in the file.

A "brilliant" label that skipped that test is not a weaker label, it is a
different one: it means "a sacrifice that worked", which is often just a good
move and sometimes an outright trade. Shipping those as brilliant would teach
players the wrong thing while looking fine.

So without --engine this script emits **blunders only** and stamps the output
`"brilliantLabelsVerified": false`. The app refuses to load a file carrying that
marker, which is what stops unverified labels reaching players by accident. With
--engine, all three conditions are applied and the marker is true.

Reading, and when it stops
--------------------------
Input is streamed a game at a time and never held in memory, so `-` (stdin)
works and a 30GB dump costs nothing but time. The script stops as soon as the
cap is filled rather than reading to EOF, which on a large dump means reading a
small fraction of it — and with an engine, doing a small fraction of the
analysis.
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

import chess
import chess.engine
import chess.pgn

# Mate scores are clamped to something large but finite so the arithmetic below
# (differences, thresholds) stays meaningful instead of overflowing into noise.
MATE_CP = 10_000

BLUNDER_DROP = 300
NOT_LOST_BAND = 400
SAC_MATERIAL = 3
# "Holds or improves", with a little slack for engine noise between plies.
HOLDS_TOLERANCE = 50
ALTERNATIVE_MARGIN = 100

CAP = 600
SEED = 20260101
PROGRESS_EVERY = 10_000

PIECE_VALUE = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3,
               chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 0}

SITE_ID = re.compile(r"lichess\.org/(\w{8})")
EVAL_RE = re.compile(r"\[%eval\s+(#?-?\d+(?:\.\d+)?)\]")


def open_pgn(source):
    """Stream a .pgn, a .pgn.zst, or stdin. Never loads the input into memory."""
    if str(source) == "-":
        return io.TextIOWrapper(sys.stdin.buffer, encoding="utf-8", errors="replace")
    path = Path(source)
    if path.suffix == ".zst":
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


def eval_cp(node) -> int | None:
    """Centipawns from White's point of view, or None when unannotated."""
    comment = node.comment or ""
    m = EVAL_RE.search(comment)
    if not m:
        return None
    raw = m.group(1)
    if raw.startswith("#"):
        n = int(raw[1:])
        return MATE_CP if n > 0 else -MATE_CP
    return int(round(float(raw) * 100))


def pov(cp: int, white_to_move: bool) -> int:
    """Flip a White-relative score into the moving side's point of view."""
    return cp if white_to_move else -cp


def material(board: chess.Board, colour: chess.Color) -> int:
    return sum(PIECE_VALUE[p.piece_type]
               for p in board.piece_map().values() if p.color == colour)


def balance(board: chess.Board, colour: chess.Color) -> int:
    return material(board, colour) - material(board, not colour)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("pgn", help="PGN dump carrying %%eval annotations, or - for stdin")
    p.add_argument("--out", type=Path, default=Path("data/evals.json"))
    p.add_argument("--cap", type=int, default=CAP)
    p.add_argument("--seed", type=int, default=SEED)
    p.add_argument("--engine", type=Path, default=None,
                   help="UCI engine (e.g. stockfish); REQUIRED for brilliant labels")
    p.add_argument("--engine-depth", type=int, default=14)
    p.add_argument("--max-games", type=int, default=0)
    p.add_argument("--progress-every", type=int, default=PROGRESS_EVERY,
                   help="games between progress lines on stderr")
    return p.parse_args()


def unique_sacrifice(engine, board: chess.Board, played: chess.Move,
                     depth: int) -> bool:
    """Is every non-sacrificial alternative at least ALTERNATIVE_MARGIN worse?"""
    mover = board.turn
    before = balance(board, mover)
    try:
        infos = engine.analyse(board, chess.engine.Limit(depth=depth), multipv=8)
    except Exception:
        return False                      # an engine that will not answer is not a yes

    played_score = None
    quiet_best = None
    for info in infos:
        line = info.get("pv") or []
        if not line:
            continue
        move = line[0]
        score = info["score"].pov(mover).score(mate_score=MATE_CP)
        if score is None:
            continue

        # Whether a move is a sacrifice is only visible after the reply.
        #
        # A move can never reduce the mover's own material on its own — material
        # changes when something is captured, and the mover does the capturing.
        # Measuring the balance immediately after the candidate therefore made
        # `sacrificial` false for every move ever tested, which silently turned
        # the whole condition into "the played move must beat every alternative
        # by 100cp", a different and much stricter test than the intended one.
        #
        # So look one ply further, at the engine's own expected reply, which is
        # the same "that move or the next" window the main loop uses.
        probe = board.copy()
        probe.push(move)
        worst = balance(probe, mover)
        if len(line) > 1:
            replied = probe.copy()
            try:
                replied.push(line[1])
                worst = min(worst, balance(replied, mover))
            except (AssertionError, ValueError):
                pass          # a PV that will not replay tells us nothing extra
        sacrificial = worst <= before - SAC_MATERIAL

        if move == played:
            played_score = score
        elif not sacrificial:
            quiet_best = score if quiet_best is None else max(quiet_best, score)

    if played_score is None:
        return False
    if quiet_best is None:
        return True                       # nothing quiet was even in the top lines
    return played_score - quiet_best > ALTERNATIVE_MARGIN


def main() -> int:
    args = parse_args()
    if args.pgn != "-" and not Path(args.pgn).exists():
        print(f"not found: {args.pgn}", file=sys.stderr)
        return 1

    engine = None
    if args.engine:
        try:
            engine = chess.engine.SimpleEngine.popen_uci(str(args.engine))
        except Exception as err:
            print(f"could not start engine: {err}", file=sys.stderr)
            return 1
    else:
        # Loud, before the run rather than after it, because a run against a
        # 30GB dump is not something to discover was pointless at the end.
        print("=" * 72, file=sys.stderr)
        print("WARNING: no --engine given.", file=sys.stderr)
        print("", file=sys.stderr)
        print("  The third brilliant condition (no non-sacrificial move within",
              file=sys.stderr)
        print("  100cp) cannot be checked from PGN evals, which only score the",
              file=sys.stderr)
        print("  move actually played. Rather than emit labels that would look",
              file=sys.stderr)
        print("  right and teach the wrong thing, this run emits BLUNDERS ONLY",
              file=sys.stderr)
        print('  and marks the output "brilliantLabelsVerified": false.',
              file=sys.stderr)
        print("", file=sys.stderr)
        print("  The app refuses to load a file with that marker, so this output",
              file=sys.stderr)
        print("  is for inspection, not for shipping. Re-run with:", file=sys.stderr)
        print("      --engine /path/to/stockfish", file=sys.stderr)
        print("=" * 72, file=sys.stderr)

    # Without an engine there is no pairing to balance, so the whole cap goes to
    # blunders; with one, the set is half and half.
    want_blunders = args.cap if engine is None else args.cap // 2
    want_brilliants = 0 if engine is None else args.cap // 2

    rng = random.Random(args.seed)
    blunders: list[dict] = []
    brilliants: list[dict] = []
    read = annotated = positions = 0
    started = time.monotonic()
    stopped_early = False

    def full() -> bool:
        return len(blunders) >= want_blunders and len(brilliants) >= want_brilliants

    fh = open_pgn(args.pgn)
    try:
        while True:
            if args.max_games and read >= args.max_games:
                break
            try:
                game = chess.pgn.read_game(fh)
            except Exception:
                continue
            if game is None:
                break
            read += 1
            if read % args.progress_every == 0:
                elapsed = time.monotonic() - started
                print(f"  scanned {read:>9,}   with %eval {annotated:>8,}   "
                      f"blunders {len(blunders):>4} / brilliants {len(brilliants):>4}   "
                      f"{elapsed:6.1f}s", file=sys.stderr, flush=True)

            found_id = SITE_ID.search(game.headers.get("Site", ""))
            gid = found_id.group(1) if found_id else f"g{read}"

            nodes = list(game.mainline())
            if not nodes or eval_cp(nodes[0]) is None:
                continue              # this game carries no evals at all
            annotated += 1

            # node[i] holds the eval *after* its own move. The eval before a
            # move is therefore the previous node's — and for the first move,
            # the start of the game, taken as level.
            for i, node in enumerate(nodes):
                after = eval_cp(node)
                if after is None:
                    continue
                before = 0 if i == 0 else eval_cp(nodes[i - 1])
                if before is None:
                    continue

                board = node.parent.board()
                move = node.move
                mover = board.turn
                positions += 1

                before_pov = pov(before, mover == chess.WHITE)
                after_pov = pov(after, mover == chess.WHITE)
                swing = after_pov - before_pov

                entry = {
                    "id": f"{gid}-{i}",
                    "fen": board.fen(),
                    "move": move.uci(),
                    "evalBefore": before_pov,
                    "evalAfter": after_pov,
                    "sideToMove": "w" if mover == chess.WHITE else "b",
                }

                # ---- blunder ------------------------------------------
                if swing <= -BLUNDER_DROP and abs(before_pov) <= NOT_LOST_BAND:
                    if len(blunders) < want_blunders:
                        blunders.append({**entry, "label": "blunder"})
                    continue

                # ---- brilliant ----------------------------------------
                if engine is None or len(brilliants) >= want_brilliants:
                    continue
                if swing < -HOLDS_TOLERANCE:
                    continue          # the eval did not hold; nothing else matters

                start = balance(board, mover)
                played = board.copy()
                played.push(move)
                drop = start - balance(played, mover)
                if drop < SAC_MATERIAL and i + 1 < len(nodes):
                    # "on that move or the next": look one ply further, after
                    # the opponent has taken what was offered.
                    nxt = played.copy()
                    nxt.push(nodes[i + 1].move)
                    drop = max(drop, start - balance(nxt, mover))
                if drop < SAC_MATERIAL:
                    continue

                if not unique_sacrifice(engine, board, move, args.engine_depth):
                    continue

                brilliants.append({**entry, "label": "brilliant"})

            if full():
                stopped_early = True
                break
    finally:
        release(fh)
        if engine:
            engine.quit()

    # 50/50 where both labels exist, so the mode cannot be beaten by always
    # guessing the commoner one.
    if engine is None:
        out = blunders[:args.cap]
    else:
        half = min(len(blunders), len(brilliants), args.cap // 2)
        out = blunders[:half] + brilliants[:half]
    rng.shuffle(out)

    verified = engine is not None
    # The marker goes first so the app can settle availability from the opening
    # bytes with a Range request instead of pulling the whole file down.
    payload = {
        "brilliantLabelsVerified": verified,
        "engine": str(args.engine) if verified else None,
        "engineDepth": args.engine_depth if verified else None,
        "counts": {"blunder": sum(1 for e in out if e["label"] == "blunder"),
                   "brilliant": sum(1 for e in out if e["label"] == "brilliant")},
        "positions": out,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")

    size_kb = args.out.stat().st_size / 1024
    elapsed = time.monotonic() - started
    print()
    print(f"read           {read:>8,} games in {elapsed:.1f}s"
          + ("  (stopped at the cap)" if stopped_early else "  (to EOF)"))
    print(f"  with %eval   {annotated:>8,}")
    print(f"positions      {positions:>8,} examined")
    print(f"blunders       {len(blunders):>8,} found")
    print(f"brilliants     {len(brilliants):>8,} found")
    print(f"written        {len(out):>8,}  -> {args.out}  ({size_kb:,.0f} KB)")
    print(f"verified       {str(verified):>8}")

    if not annotated and read:
        print("\nNo game in this dump carried %eval annotations. Lichess only "
              "annotates a subset; a standard monthly dump does contain them, but "
              "a filtered or re-exported file may have had them stripped.")
    if verified and len(out) < args.cap:
        scarcer = "brilliants" if len(brilliants) < len(blunders) else "blunders"
        print(f"\nUnder the {args.cap} cap: the 50/50 split is limited by {scarcer}. "
              f"Feed it a larger dump to fill the set.")
    if not verified:
        print("\nThis file is NOT shippable: it holds blunders only and is marked "
              "brilliantLabelsVerified=false, which the app treats exactly like a "
              "missing file. Re-run with --engine to produce a usable set.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except BrokenPipeError:
        os.dup2(os.open(os.devnull, os.O_WRONLY), sys.stdout.fileno())
        sys.exit(141)
    except KeyboardInterrupt:
        sys.exit(130)
