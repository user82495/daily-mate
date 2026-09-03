#!/usr/bin/env python3
"""Build evals.json — the pool for Blunder or Brilliant.

    python3 scripts/build_evals.py lichess_db_standard_rated_2026-01.pgn.zst
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
THE THIRD BRILLIANT CONDITION NEEDS AN ENGINE
--------------------------------------------------------------------------
"No non-sacrificial move scores within 100cp of it" cannot be answered from PGN
annotations. `%eval` records one number per position — the evaluation after the
move that was actually played. The alternatives were never evaluated, so their
scores simply are not in the file.

So: with `--engine`, all three conditions are applied and a position is only
called brilliant if the sacrifice was genuinely the unique idea. Without one,
the first two conditions are applied and the run prints a warning saying so.
The output is still usable — it will just include sacrifices that a quiet move
matched, which are good moves rather than brilliant ones.
"""

import argparse
import io
import json
import random
import re
import sys
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

PIECE_VALUE = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3,
               chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 0}

SITE_ID = re.compile(r"lichess\.org/(\w{8})")
EVAL_RE = re.compile(r"\[%eval\s+(#?-?\d+(?:\.\d+)?)\]")


def open_pgn(path: Path):
    if path.suffix == ".zst":
        from compression.zstd import ZstdFile
        return io.TextIOWrapper(ZstdFile(path, "rb"), encoding="utf-8", errors="replace")
    return path.open(encoding="utf-8", errors="replace")


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
    p.add_argument("pgn", type=Path, help="PGN dump carrying %eval annotations")
    p.add_argument("--out", type=Path, default=Path("data/evals.json"))
    p.add_argument("--cap", type=int, default=CAP)
    p.add_argument("--seed", type=int, default=SEED)
    p.add_argument("--engine", type=Path, default=None,
                   help="UCI engine (e.g. stockfish); enables the third brilliant test")
    p.add_argument("--engine-depth", type=int, default=14)
    p.add_argument("--max-games", type=int, default=0)
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

        probe = board.copy()
        probe.push(move)
        sacrificial = balance(probe, mover) <= before - SAC_MATERIAL

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
    if not args.pgn.exists():
        print(f"not found: {args.pgn}", file=sys.stderr)
        return 1

    engine = None
    if args.engine:
        try:
            engine = chess.engine.SimpleEngine.popen_uci(str(args.engine))
        except Exception as err:
            print(f"could not start engine: {err}", file=sys.stderr)
            return 1

    rng = random.Random(args.seed)
    blunders: list[dict] = []
    brilliants: list[dict] = []
    read = annotated = positions = 0

    try:
        with open_pgn(args.pgn) as fh:
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
                if read % 10_000 == 0:
                    print(f"  read {read:,} games, "
                          f"{len(blunders)} blunders / {len(brilliants)} brilliants...",
                          file=sys.stderr)

                gid = (SITE_ID.search(game.headers.get("Site", "")) or [None, None])[1] \
                      or f"g{read}"

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
                        blunders.append({**entry, "label": "blunder"})
                        continue

                    # ---- brilliant ----------------------------------------
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

                    if engine and not unique_sacrifice(engine, board, move,
                                                       args.engine_depth):
                        continue

                    brilliants.append({**entry, "label": "brilliant"})
    finally:
        if engine:
            engine.quit()

    # 50/50, so the mode cannot be beaten by always guessing the commoner label.
    half = min(len(blunders), len(brilliants), args.cap // 2)
    rng.shuffle(blunders)
    rng.shuffle(brilliants)
    out = blunders[:half] + brilliants[:half]
    rng.shuffle(out)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")

    size_kb = args.out.stat().st_size / 1024
    print()
    print(f"read           {read:>8,} games ({annotated:,} carried evals)")
    print(f"positions      {positions:>8,} examined")
    print(f"blunders       {len(blunders):>8,} found")
    print(f"brilliants     {len(brilliants):>8,} found")
    print(f"written        {len(out):>8,}  ({half} of each)  -> {args.out}  ({size_kb:,.0f} KB)")

    if half * 2 < args.cap:
        scarcer = "brilliants" if len(brilliants) < len(blunders) else "blunders"
        print(f"\nUnder the {args.cap} cap: the 50/50 split is limited by {scarcer}. "
              f"Feed it a larger dump to fill the set.")
    if not engine:
        print("\nNOTE: no --engine given, so the third brilliant condition "
              "(no non-sacrificial move within 100cp) was NOT applied — PGN evals "
              "only score the move actually played. Some entries labelled brilliant "
              "will be merely good. Pass --engine /path/to/stockfish for the full test.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
