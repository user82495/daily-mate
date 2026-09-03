#!/usr/bin/env python3
"""Eyeball a sample of evals.json before trusting it.

    python3 scripts/review_evals.py
    python3 scripts/review_evals.py data/evals.json --count 80 --label brilliant
    open evals-review.html

Writes a self-contained HTML page: N random labelled positions, each as a board
diagram with the played move drawn as an arrow, the label it was given, and the
eval swing that produced it. Nothing is fetched and no server is needed — open
the file.

Why this exists
---------------
The labels are produced by thresholds over an engine's numbers, and thresholds
are exactly the kind of thing that looks reasonable in the source and turns out
to be wrong on contact with real games. A "blunder" that is actually a losing
position getting slightly more lost, a "brilliant" that is a queen trade the
material counter misread — those are visible in a second by eye and invisible
in a summary line.

Check the ones that look wrong, hit "Dump flagged IDs", and paste the list into
whatever comes next. Ticks are kept in the browser's localStorage, so closing
the page does not lose the pass.
"""

import argparse
import html
import json
import random
import sys
from pathlib import Path

SQ = 44                      # px per square
GLYPH = {
    "K": "♔", "Q": "♕", "R": "♖",
    "B": "♗", "N": "♘", "P": "♙",
    "k": "♚", "q": "♛", "r": "♜",
    "b": "♝", "n": "♞", "p": "♟",
}
LIGHT, DARK = "#e8ddc8", "#9c8569"


def load_positions(path: Path):
    """Accept both the wrapped file and a bare array."""
    raw = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(raw, list):
        return raw, {}
    if isinstance(raw, dict):
        meta = {k: v for k, v in raw.items() if not isinstance(v, list)}
        for key in ("positions", "items"):
            if isinstance(raw.get(key), list):
                return raw[key], meta
    return [], {}


def board_squares(fen: str):
    """FEN placement -> {'e4': 'Q', ...}."""
    out = {}
    placement = fen.split()[0]
    for r, row in enumerate(placement.split("/")):
        file_i = 0
        for ch in row:
            if ch.isdigit():
                file_i += int(ch)
                continue
            out["abcdefgh"[file_i] + str(8 - r)] = ch
            file_i += 1
    return out


def xy(square: str, flip: bool):
    """Square name -> top-left pixel corner."""
    f = "abcdefgh".index(square[0])
    r = int(square[1]) - 1
    col = 7 - f if flip else f
    row = r if flip else 7 - r
    return col * SQ, row * SQ


def svg_board(fen: str, move: str, flip: bool) -> str:
    pieces = board_squares(fen)
    size = SQ * 8
    parts = [f'<svg class="bd" viewBox="0 0 {size} {size}" width="{size}" height="{size}">']

    for rank in range(8):
        for file_i in range(8):
            name = "abcdefgh"[file_i] + str(rank + 1)
            x, y = xy(name, flip)
            light = (file_i + rank) % 2 == 1
            parts.append(f'<rect x="{x}" y="{y}" width="{SQ}" height="{SQ}" '
                         f'fill="{LIGHT if light else DARK}"/>')

    for name, ch in pieces.items():
        x, y = xy(name, flip)
        white = ch.isupper()
        parts.append(
            f'<text x="{x + SQ / 2}" y="{y + SQ * 0.72}" text-anchor="middle" '
            f'font-size="{int(SQ * 0.82)}" '
            f'fill="{"#fff" if white else "#111"}" '
            f'stroke="{"#111" if white else "#eee"}" stroke-width="1" '
            f'style="paint-order:stroke fill">{GLYPH.get(ch, "")}</text>')

    if move and len(move) >= 4:
        fx, fy = xy(move[0:2], flip)
        tx, ty = xy(move[2:4], flip)
        parts.append(
            f'<line x1="{fx + SQ / 2}" y1="{fy + SQ / 2}" '
            f'x2="{tx + SQ / 2}" y2="{ty + SQ / 2}" '
            f'stroke="#e0533d" stroke-width="6" stroke-linecap="round" '
            f'marker-end="url(#ah)" opacity="0.9"/>')

    parts.append("</svg>")
    return "".join(parts)


def pawns(cp) -> str:
    try:
        n = float(cp) / 100
    except (TypeError, ValueError):
        return "?"
    if abs(n) >= 99:
        return "#" if n > 0 else "-#"
    return f"{n:+.1f}"


def parse_args():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("evals", nargs="?", type=Path, default=Path("data/evals.json"))
    p.add_argument("--count", type=int, default=50, help="positions to show (default 50)")
    p.add_argument("--seed", type=int, default=None, help="fix the sample for a repeatable pass")
    p.add_argument("--label", choices=["blunder", "brilliant"], default=None,
                   help="review only one label")
    p.add_argument("--out", type=Path, default=Path("evals-review.html"))
    return p.parse_args()


def main() -> int:
    args = parse_args()
    if not args.evals.exists():
        print(f"not found: {args.evals}", file=sys.stderr)
        print("Build it first with scripts/build_evals.py.", file=sys.stderr)
        return 1

    rows, meta = load_positions(args.evals)
    if not rows:
        print(f"{args.evals} holds no positions.", file=sys.stderr)
        return 1

    if args.label:
        rows = [r for r in rows if r.get("label") == args.label]
        if not rows:
            print(f"no positions labelled {args.label}.", file=sys.stderr)
            return 1

    rng = random.Random(args.seed)
    sample = rng.sample(rows, min(args.count, len(rows)))

    verified = meta.get("brilliantLabelsVerified")
    if verified is False:
        banner = ('<p class="warn"><strong>brilliantLabelsVerified: false</strong> — '
                  'this file was built without an engine, so it holds blunders only '
                  'and the app will refuse to load it. Useful to review, not to ship.</p>')
    elif verified is True:
        banner = ('<p class="ok">brilliantLabelsVerified: true — built with '
                  f'{html.escape(str(meta.get("engine") or "an engine"))} '
                  f'at depth {html.escape(str(meta.get("engineDepth") or "?"))}.</p>')
    else:
        banner = ('<p class="warn">No verification marker in this file. It predates '
                  'the marker or was not written by build_evals.py.</p>')

    cards = []
    for row in sample:
        rid = str(row.get("id", "?"))
        label = row.get("label", "?")
        flip = row.get("sideToMove") == "b"
        swing = f'{pawns(row.get("evalBefore"))} &rarr; {pawns(row.get("evalAfter"))}'
        cards.append(f"""
        <figure class="card" data-id="{html.escape(rid)}">
          {svg_board(row.get("fen", ""), row.get("move", ""), flip)}
          <figcaption>
            <span class="tag tag-{html.escape(label)}">{html.escape(label)}</span>
            <span class="swing">{swing}</span>
            <span class="mover">{'Black' if flip else 'White'} to move</span>
            <code>{html.escape(rid)}</code>
            <label class="flag"><input type="checkbox"> looks wrong</label>
          </figcaption>
        </figure>""")

    counts = {}
    for r in rows:
        counts[r.get("label", "?")] = counts.get(r.get("label", "?"), 0) + 1
    summary = ", ".join(f"{v:,} {k}" for k, v in sorted(counts.items()))

    page = f"""<!doctype html>
<meta charset="utf-8">
<title>evals review — {html.escape(str(args.evals))}</title>
<style>
  :root {{ color-scheme: light dark; }}
  body {{ font: 14px/1.5 system-ui, sans-serif; margin: 0; padding: 24px;
         background: #14161a; color: #e7e7e7; }}
  h1 {{ font-size: 18px; margin: 0 0 4px; }}
  .meta {{ color: #9aa0a6; margin: 0 0 16px; }}
  .warn {{ background: #3a2a12; border: 1px solid #7a5a20; padding: 10px 12px;
           border-radius: 8px; }}
  .ok {{ background: #16301d; border: 1px solid #2f6b41; padding: 10px 12px;
         border-radius: 8px; }}
  .bar {{ position: sticky; top: 0; z-index: 5; background: #14161a;
          padding: 12px 0; border-bottom: 1px solid #2a2d33; margin-bottom: 16px;
          display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }}
  button {{ font: inherit; padding: 8px 14px; border-radius: 999px; cursor: pointer;
            border: 1px solid #444; background: #22252b; color: #e7e7e7; }}
  button.primary {{ background: #e3c766; color: #1a1a1a; border-color: #e3c766; }}
  .grid {{ display: grid; gap: 18px;
           grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); }}
  .card {{ margin: 0; background: #1b1e24; border: 1px solid #2a2d33;
           border-radius: 10px; padding: 12px; }}
  .card.flagged {{ border-color: #e0533d; box-shadow: 0 0 0 1px #e0533d inset; }}
  .bd {{ display: block; width: 100%; height: auto; border-radius: 6px; }}
  figcaption {{ display: flex; gap: 10px; align-items: center; flex-wrap: wrap;
                margin-top: 10px; }}
  .tag {{ font-weight: 600; padding: 2px 8px; border-radius: 999px; font-size: 12px; }}
  .tag-blunder {{ background: #4a1f1a; color: #ffb4a6; }}
  .tag-brilliant {{ background: #123a2a; color: #8fe3b8; }}
  .swing {{ font-variant-numeric: tabular-nums; color: #cfcfcf; }}
  .mover {{ color: #9aa0a6; font-size: 12px; }}
  code {{ color: #8ab4f8; font-size: 12px; }}
  .flag {{ margin-left: auto; color: #9aa0a6; cursor: pointer; user-select: none; }}
  #dump {{ width: 100%; height: 120px; margin-top: 12px; background: #0f1114;
           color: #e7e7e7; border: 1px solid #2a2d33; border-radius: 8px;
           padding: 10px; font-family: ui-monospace, monospace; }}
</style>
<h1>evals review — {html.escape(str(args.evals))}</h1>
<p class="meta">{len(sample)} of {len(rows):,} positions shown ({html.escape(summary)}).</p>
{banner}
<div class="bar">
  <button class="primary" id="dump-btn">Dump flagged IDs</button>
  <button id="copy-btn">Copy IDs</button>
  <button id="clear-btn">Clear ticks</button>
  <span id="count">0 flagged</span>
</div>
<textarea id="dump" placeholder="Flagged IDs appear here." readonly></textarea>
<div class="grid">{"".join(cards)}</div>
<svg width="0" height="0" style="position:absolute">
  <defs>
    <marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4"
            markerHeight="4" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#e0533d"/>
    </marker>
  </defs>
</svg>
<script>
  const KEY = 'evals-review-flags';
  const load = () => {{
    try {{ return new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); }}
    catch {{ return new Set(); }}
  }};
  const flags = load();
  const cards = [...document.querySelectorAll('.card')];

  function paint() {{
    for (const card of cards) {{
      const on = flags.has(card.dataset.id);
      card.classList.toggle('flagged', on);
      card.querySelector('input').checked = on;
    }}
    document.getElementById('count').textContent = flags.size + ' flagged';
  }}

  for (const card of cards) {{
    card.querySelector('input').addEventListener('change', (e) => {{
      if (e.target.checked) flags.add(card.dataset.id);
      else flags.delete(card.dataset.id);
      try {{ localStorage.setItem(KEY, JSON.stringify([...flags])); }} catch {{}}
      paint();
    }});
  }}

  document.getElementById('dump-btn').addEventListener('click', () => {{
    document.getElementById('dump').value = [...flags].join('\\n');
  }});
  document.getElementById('copy-btn').addEventListener('click', async () => {{
    const text = [...flags].join('\\n');
    document.getElementById('dump').value = text;
    try {{ await navigator.clipboard.writeText(text); }} catch {{}}
  }});
  document.getElementById('clear-btn').addEventListener('click', () => {{
    flags.clear();
    try {{ localStorage.removeItem(KEY); }} catch {{}}
    document.getElementById('dump').value = '';
    paint();
  }});

  paint();
</script>
"""
    args.out.write_text(page, encoding="utf-8")
    print(f"{len(sample)} positions -> {args.out}")
    print(f"open {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
