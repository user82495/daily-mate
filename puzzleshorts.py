#!/usr/bin/env python3
"""Render one vertical short per Daily Mate daily puzzle.

Reads puzzles.js — the same generated file the app imports — so video N is
always the puzzle players get on day N. Nothing is pulled from the Lichess CSV
here; puzzles.js is the single source of truth for the running order.

Each video is a 12 second, silent, 1080x1920 still of the position, with text
appearing and clearing on a fixed timeline:

    0:00  Mate in N. Can you find it?
    0:03  White to play / Black to play
    0:05  nothing — just the position
    0:10  Answer in the comments  +  the app URL along the bottom

The frame is drawn by headless Chrome from a self-contained page that reuses
the app's own colours, mpchess piece artwork and font stack, so a still lifted
from a video is indistinguishable from the app's board. All four text states are
laid out as one tall strip and captured in a single screenshot; ffmpeg crops the
four panels back out and crossfades between them. One browser launch and one
encode per puzzle.

The board is static throughout. The solution is never shown.

Usage:
    python3 puzzleshorts.py [-o videos] [--days 30] [--start 1]

ffmpeg comes from the imageio-ffmpeg package when none is on PATH, so no system
install is strictly needed:  pip install imageio-ffmpeg
"""

from __future__ import annotations

import argparse
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import time
from pathlib import Path

# --- frame geometry ---------------------------------------------------------

VIDEO_W, VIDEO_H = 1080, 1920
BOARD_PX = 960                                # 89% of the frame width
BOARD_X = (VIDEO_W - BOARD_PX) // 2           # 60
BOARD_Y = (VIDEO_H - BOARD_PX) // 2           # 480 — a clear third above and below

# --- timeline ---------------------------------------------------------------

DURATION = 12.0
FADE = 0.25                                   # crossfade between text states
FPS = 30
# Start of each text state. Panel 0 is the base layer; the rest fade in over it.
PHASE_STARTS = (0.0, 3.0, 5.0, 10.0)          # hook / to play / clear / outro

# --- app design tokens (styles.css) -----------------------------------------

BG = "#0E0F13"
TEXT = "#E9EAEF"
TEXT_DIM = "#8A8F9C"
ACCENT = "#F4C95D"
SQ_LIGHT = "#DCE1E9"
SQ_DARK = "#6A7386"
FONT = ("-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, system-ui, "
        "'Helvetica Neue', Arial, sans-serif")

APP_URL = "dailymate.netlify.app"

# --- captions ---------------------------------------------------------------

HASHTAGS = ("#chess #chesspuzzle #chesstok #chessgame #tactics #chessplayer "
            "#puzzle #brainteaser")

# Cycled by day so the feed never reads as copy-paste. Every line still states
# the mate length and the side to move, because that is the hook.
CAPTION_TEMPLATES = [
    "Mate in {n}. {Side} to play. Answer in the comments 👀",
    "{Side} to play — can you find mate in {n}? Drop your line below 👀",
    "Forced mate in {n}. {Side} moves first. Answer in the comments 👀",
    "Day {day}: {side} to play, mate in {n}. Post your solution 👀",
    "{Side} to move. It's mate in {n} — first move in the comments 👀",
    "Only {moves} to mate. {Side} to play. Answer in the comments 👀",
    "Can you spot the mate in {n}? {Side} to play. Comments are open 👀",
    "{Side} to play and force mate in {n}. Solve it before the clip ends 👀",
    "Mate in {n} for {side}. Think you've got it? Answer in the comments 👀",
    "{Side} to move, mate in {n}. Drop your answer in the comments 👀",
]

CHROME_TIMEOUT = 90          # a wedged browser skips its puzzle, not the run

CHROME_CANDIDATES = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
]


# =============================================================================
# Tools
# =============================================================================

def find_ffmpeg() -> str:
    """Prefer a system ffmpeg, fall back to the pip-bundled binary."""
    system = shutil.which("ffmpeg")
    if system:
        return system
    try:
        import imageio_ffmpeg
    except ImportError:
        sys.exit("No ffmpeg found. Install one with: pip install imageio-ffmpeg")
    return imageio_ffmpeg.get_ffmpeg_exe()


def find_chrome() -> str:
    """Any Chromium build will do — it only ever renders a local static page."""
    for name in ("google-chrome", "chromium", "chromium-browser"):
        if found := shutil.which(name):
            return found
    for path in CHROME_CANDIDATES:
        if Path(path).exists():
            return path
    sys.exit("No Chrome/Chromium found. Install Google Chrome, or add your "
             "browser's path to CHROME_CANDIDATES.")


# =============================================================================
# Puzzle data
# =============================================================================

def load_puzzles(path: Path) -> list[dict]:
    """Read the app's generated puzzles.js.

    Pure data, one flat object per puzzle and no nested braces, so a regex is
    enough — and keeps this script free of a node dependency. Anything that
    changes the shape of that file will trip the assertions below rather than
    silently renumber the videos.
    """
    source = path.read_text(encoding="utf-8")

    start = source.find("export const PUZZLES")
    if start < 0:
        sys.exit(f"{path.name} has no `export const PUZZLES` — is it the app's "
                 "generated puzzle file?")

    puzzles = []
    for body in re.findall(r"\{[^{}]*\}", source[start:], re.S):
        fields = {
            key: re.search(pattern, body)
            for key, pattern in (
                ("id", r'id:\s*"([^"]+)"'),
                ("fen", r'fen:\s*"([^"]+)"'),
                ("mateIn", r"mateIn:\s*(\d+)"),
            )
        }
        if not all(fields.values()):
            continue
        puzzles.append({
            "id": fields["id"].group(1),
            "fen": fields["fen"].group(1),
            "mateIn": int(fields["mateIn"].group(1)),
        })

    if not puzzles:
        sys.exit(f"No puzzles parsed out of {path}")
    return puzzles


def board_rows(fen: str) -> tuple[list[list[str | None]], str]:
    """FEN -> 8 screen rows of piece codes (wK, bP, ...) or None, plus the mover.

    Rows come back in the order they are drawn. The app orients the board to the
    side to move (game.js: `board.setOrientation(playerColour, ...)`), so a
    black-to-play puzzle is flipped here the same way.
    """
    parts = fen.split()
    if len(parts) < 2 or parts[1] not in ("w", "b"):
        raise ValueError(f"not a FEN: {fen!r}")
    placement, side = parts[0], parts[1]

    rows: list[list[str | None]] = []
    for rank in placement.split("/"):
        row: list[str | None] = []
        for ch in rank:
            if ch.isdigit():
                row.extend([None] * int(ch))
            else:
                row.append(("w" if ch.isupper() else "b") + ch.upper())
        if len(row) != 8:
            raise ValueError(f"rank {rank!r} is not 8 squares wide")
        rows.append(row)
    if len(rows) != 8:
        raise ValueError(f"{len(rows)} ranks, expected 8")

    if side == "b":
        rows = [list(reversed(row)) for row in reversed(rows)]
    return rows, side


def mover(fen: str) -> str:
    """"White" or "Black", from the FEN's side-to-move field."""
    return "White" if fen.split()[1] == "w" else "Black"


# =============================================================================
# The frame
# =============================================================================

def load_sprite(vendor: Path) -> str:
    """The app's piece set, as one hidden <symbol> sheet.

    vendor/mpchess/*.svg are the unmodified originals that js/pieces.js inlines,
    so the video and the app draw byte-identical artwork.
    """
    symbols = []
    for name in ("wK", "wQ", "wR", "wB", "wN", "wP",
                 "bK", "bQ", "bR", "bB", "bN", "bP"):
        file = vendor / f"{name}.svg"
        if not file.exists():
            sys.exit(f"Missing piece artwork: {file}")
        body = file.read_text(encoding="utf-8").strip()
        body = re.sub(r"^<svg[^>]*>", "", body)
        body = re.sub(r"</svg>\s*$", "", body)
        symbols.append(f'<symbol id="pc-{name}" viewBox="0 0 10 10">{body}</symbol>')
    return ('<svg width="0" height="0" style="position:absolute" aria-hidden="true">'
            + "".join(symbols) + "</svg>")


CSS = """
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: @BG@; }
body {
  width: @W@px;
  font-family: @FONT@;
  color: @TEXT@;
  -webkit-font-smoothing: antialiased;
}

/* One 1080x1920 panel per text state, stacked into a single tall screenshot. */
.frame {
  position: relative;
  width: @W@px;
  height: @H@px;
  overflow: hidden;
  background: @BG@;
}

.board {
  position: absolute;
  left: @BX@px;
  top: @BY@px;
  width: @BOARD@px;
  height: @BOARD@px;
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  grid-template-rows: repeat(8, 1fr);
}
.sq { position: relative; }
.sq-light { background: @SQL@; }
.sq-dark  { background: @SQD@; }

.coord { position: absolute; font-size: 17px; font-weight: 600; line-height: 1; opacity: 0.5; }
.coord-file { right: 6px; bottom: 6px; }
.coord-rank { left: 6px; top: 6px; }
.sq-light .coord { color: @SQD@; }
.sq-dark  .coord { color: @SQL@; }

/* The artwork carries its own fills and strokes — nothing here sets colour. */
.piece-svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; z-index: 2; }

/* Text lives in the clear thirds, never over the board. */
.band {
  position: absolute;
  left: 0;
  width: @W@px;
  height: @BY@px;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.band-top    { top: 0; justify-content: flex-end; padding-bottom: 58px; }
.band-bottom { top: @BY2@px; justify-content: flex-start; padding-top: 66px; }

.hook {
  margin: 0;
  max-width: 900px;
  text-align: center;
  font-size: 64px;
  font-weight: 650;
  letter-spacing: -0.01em;
  line-height: 1.18;
}
.to-move { margin: 0; font-size: 44px; font-weight: 400; color: @DIM@; }
.outro {
  margin: 0;
  font-size: 56px;
  font-weight: 650;
  letter-spacing: -0.01em;
  color: @ACCENT@;
}
.url {
  position: absolute;
  left: 0;
  bottom: 104px;
  width: @W@px;
  margin: 0;
  text-align: center;
  font-size: 30px;
  color: @DIM@;
  letter-spacing: 0.02em;
}
"""


def stylesheet() -> str:
    tokens = {
        "@W@": VIDEO_W, "@H@": VIDEO_H,
        "@BOARD@": BOARD_PX, "@BX@": BOARD_X, "@BY@": BOARD_Y,
        "@BY2@": BOARD_Y + BOARD_PX,
        "@BG@": BG, "@TEXT@": TEXT, "@DIM@": TEXT_DIM, "@ACCENT@": ACCENT,
        "@SQL@": SQ_LIGHT, "@SQD@": SQ_DARK, "@FONT@": FONT,
    }
    css = CSS
    for token, value in tokens.items():
        css = css.replace(token, str(value))
    return css


def board_html(rows: list[list[str | None]], side: str) -> str:
    """The board, drawn the way board.js draws it — coordinates included."""
    files = "abcdefgh" if side == "w" else "hgfedcba"
    ranks = "87654321" if side == "w" else "12345678"

    cells = []
    for row in range(8):
        for col in range(8):
            # Flipping both axes preserves parity, so one rule covers both
            # orientations: a8 (and h1) are light.
            dark = (row + col) % 2 == 1
            inner = ""
            if row == 7:
                inner += f'<span class="coord coord-file">{files[col]}</span>'
            if col == 0:
                inner += f'<span class="coord coord-rank">{ranks[row]}</span>'
            if piece := rows[row][col]:
                inner += ('<svg class="piece-svg" viewBox="0 0 10 10">'
                          f'<use href="#pc-{piece}"/></svg>')
            cells.append(f'<div class="sq {"sq-dark" if dark else "sq-light"}">'
                         f"{inner}</div>")
    return '<div class="board">' + "".join(cells) + "</div>"


def strip_html(puzzle: dict, sprite: str, url: str) -> str:
    """The four text states as one tall page, board redrawn identically in each."""
    rows, side = board_rows(puzzle["fen"])
    board = board_html(rows, side)

    bands = [
        f'<div class="band band-top"><p class="hook">Mate in {puzzle["mateIn"]}. '
        "Can you find it?</p></div>",
        f'<div class="band band-top"><p class="to-move">{mover(puzzle["fen"])} to play</p></div>',
        "",  # just the position
        '<div class="band band-bottom"><p class="outro">Answer in the comments</p>'
        f'<p class="url">{url}</p></div>',
    ]
    frames = "".join(f'<div class="frame">{board}{band}</div>' for band in bands)

    return ("<!doctype html><html><head><meta charset='utf-8'>"
            f"<style>{stylesheet()}</style></head><body>{sprite}{frames}</body></html>")


def png_size(path: Path) -> tuple[int, int]:
    """Width and height straight out of the PNG header — no image library needed."""
    header = path.read_bytes()[:24]
    if header[:8] != b"\x89PNG\r\n\x1a\n":
        raise RuntimeError(f"{path.name} is not a PNG")
    return struct.unpack(">II", header[16:24])


def shoot(chrome: str, html: Path, png: Path) -> None:
    """Screenshot the whole strip in one headless launch.

    Headless already runs against a throwaway profile of its own, so this is
    safe while the user's Chrome is open. Do NOT add --user-data-dir: Chrome
    then writes the screenshot and never exits.
    """
    height = VIDEO_H * len(PHASE_STARTS)
    cmd = [
        chrome,
        "--headless",
        "--disable-gpu",
        "--hide-scrollbars",
        "--force-device-scale-factor=1",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        f"--window-size={VIDEO_W},{height}",
        f"--screenshot={png}",
        html.as_uri(),
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True,
                                timeout=CHROME_TIMEOUT)
        stderr = result.stderr
    except subprocess.TimeoutExpired:
        # Better to lose one puzzle than to wedge the whole run.
        raise RuntimeError(f"Chrome did not exit within {CHROME_TIMEOUT}s")

    if not png.exists() or png.stat().st_size == 0:
        raise RuntimeError(f"Chrome wrote no screenshot:\n{stderr.strip()}")

    got = png_size(png)
    if got != (VIDEO_W, height):
        raise RuntimeError(f"Chrome captured {got[0]}x{got[1]}, "
                           f"expected {VIDEO_W}x{height}")


def filtergraph() -> str:
    """Crop the panels back out of the strip and crossfade between them.

    Every panel is a full, opaque frame, so a panel only ever has to fade *in*:
    once it reaches full alpha, whatever is beneath it stops mattering. That
    avoids the gap a paired fade-out would open between two states.
    """
    count = len(PHASE_STARTS)
    labels = "".join(f"[s{i}]" for i in range(count))
    parts = [f"[0:v]split={count}{labels}"]

    for i, start in enumerate(PHASE_STARTS):
        crop = f"crop={VIDEO_W}:{VIDEO_H}:0:{i * VIDEO_H}"
        if i == 0:
            parts.append(f"[s0]{crop}[p0]")
        else:
            parts.append(f"[s{i}]{crop},format=yuva420p,"
                         f"fade=t=in:st={start}:d={FADE}:alpha=1[p{i}]")

    chain = "p0"
    for i, start in enumerate(PHASE_STARTS[1:], start=1):
        out = "out" if i == count - 1 else f"o{i}"
        tail = ",format=yuv420p" if out == "out" else ""
        parts.append(f"[{chain}][p{i}]overlay=0:0:enable='gte(t,{start})'{tail}[{out}]")
        chain = out

    return ";".join(parts)


def render(ffmpeg: str, strip: Path, dest: Path) -> None:
    cmd = [
        ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
        "-loop", "1", "-framerate", str(FPS), "-t", str(DURATION), "-i", str(strip),
        "-filter_complex", filtergraph(), "-map", "[out]",
        "-c:v", "libx264", "-preset", "medium", "-crf", "20",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        "-r", str(FPS),
        "-an",                                  # silent; sound goes on in TikTok
        str(dest),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg failed:\n{result.stderr.strip()}")


def caption_for(day: int, puzzle: dict) -> str:
    side = mover(puzzle["fen"])
    n = puzzle["mateIn"]
    line = CAPTION_TEMPLATES[(day - 1) % len(CAPTION_TEMPLATES)].format(
        n=n, Side=side, side=side.lower(), day=day,
        moves=f"{n} move" + ("s" if n != 1 else ""),
    )
    return f"--- day-{day:03d} ---\n{line}\n{HASHTAGS}\n"


# =============================================================================

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("-o", "--output-dir", default="videos",
                        help="where to write the MP4s (default: videos/)")
    parser.add_argument("-p", "--puzzles", default="puzzles.js",
                        help="the app's generated puzzle file (default: puzzles.js)")
    parser.add_argument("--start", type=int, default=1, metavar="N",
                        help="first day number to render (default: 1)")
    parser.add_argument("--days", type=int, default=None, metavar="N",
                        help="how many days to render (default: every puzzle)")
    parser.add_argument("--url", default=APP_URL,
                        help=f"URL shown in the outro (default: {APP_URL})")
    parser.add_argument("--keep-frames", action="store_true",
                        help="also write each day's strip PNG next to its MP4")
    args = parser.parse_args()

    root = Path(__file__).resolve().parent
    puzzles_path = Path(args.puzzles).expanduser()
    if not puzzles_path.is_absolute():
        puzzles_path = root / puzzles_path
    if not puzzles_path.exists():
        sys.exit(f"Puzzle file not found: {puzzles_path}")

    out_dir = Path(args.output_dir).expanduser()
    if not out_dir.is_absolute():
        out_dir = root / out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    ffmpeg = find_ffmpeg()
    chrome = find_chrome()
    puzzles = load_puzzles(puzzles_path)
    sprite = load_sprite(root / "vendor" / "mpchess")

    days = args.days if args.days is not None else len(puzzles)
    if args.start < 1 or days < 1:
        sys.exit("--start and --days must both be at least 1")

    print(f"Puzzles : {len(puzzles)} in {puzzles_path.name}")
    print(f"Output  : {out_dir}")
    print(f"Video   : {VIDEO_W}x{VIDEO_H}, {DURATION:g}s, silent, "
          f"board {BOARD_PX}px\n")

    captions: list[str] = []
    failures: list[tuple[int, str]] = []
    started = time.time()

    with tempfile.TemporaryDirectory() as tmp:
        for i in range(days):
            day = args.start + i
            # Same wrap the app uses (daily.js: `(number - 1) % PUZZLES.length`),
            # so day N here is the puzzle players actually see on day N.
            puzzle = puzzles[(day - 1) % len(puzzles)]
            dest = out_dir / f"day-{day:03d}.mp4"

            try:
                print(f"[{i + 1:2d}/{days}] {dest.name}  mate in {puzzle['mateIn']}, "
                      f"{mover(puzzle['fen']).lower()} to play  ({puzzle['id']}) ... ",
                      end="", flush=True)

                html = Path(tmp) / f"day-{day:03d}.html"
                strip = (out_dir if args.keep_frames else Path(tmp)) / f"day-{day:03d}.png"
                html.write_text(strip_html(puzzle, sprite, args.url), encoding="utf-8")

                shoot(chrome, html, strip)
                render(ffmpeg, strip, dest)

                captions.append(caption_for(day, puzzle))
                print(f"{dest.stat().st_size / 1e6:.1f} MB", flush=True)

            except Exception as err:
                failures.append((day, str(err).splitlines()[0] if str(err) else
                                 err.__class__.__name__))
                print("SKIPPED", flush=True)

    captions_path = out_dir / "captions.txt"
    captions_path.write_text("\n".join(captions), encoding="utf-8")

    elapsed = time.time() - started
    rendered = days - len(failures)
    total = sum(f.stat().st_size for f in out_dir.glob("day-*.mp4"))
    print(f"\nDone. {rendered}/{days} videos in {out_dir} "
          f"({total / 1e6:.1f} MB) in {elapsed / 60:.1f} min "
          f"({elapsed / max(1, days):.1f}s each)")
    print(f"Captions: {captions_path} ({len(captions)} entries)")

    if failures:
        print(f"\n{len(failures)} skipped:")
        for day, reason in failures:
            print(f"  day-{day:03d}: {reason}")


if __name__ == "__main__":
    main()
