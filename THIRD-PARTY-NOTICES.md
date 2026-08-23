# Licensing and third-party notices

**Daily Mate is distributed under the GNU General Public License v3.0 or later.**
The full text is in `LICENSE`.

That is not a free choice — it follows from the piece set. The mpchess artwork is
GPLv3, and it is inlined into `js/pieces.js`, so the app as shipped is a work
based on it and inherits the same licence.

## What GPLv3 requires of you

- **Publish the source.** A PWA ships its actual JavaScript to every visitor,
  which is conveying a copy of the program. Unlike a server-side app, the
  "ASP loophole" does not apply here. Helpfully, Daily Mate ships unminified ES
  modules, so what the browser receives *is* the source — but you should still
  publish the repository and keep `LICENSE` alongside it.
- **Keep the notices.** `LICENSE`, `vendor/mpchess/LICENSE`, and this file.
- **Downstream stays GPL.** Anyone redistributing or modifying it must do so
  under GPLv3 too.
- **Commercial use is allowed.** GPL does not forbid charging money; it forbids
  taking the source private. If you ever want a closed-source Daily Mate, swap
  the piece set for an MIT or CC0 one and relicense.

## Components

| Component | Author | Licence | GPLv3-compatible | Notice |
|---|---|---|---|---|
| mpchess piece set | Maxime Chupin | GPL-3.0-or-later | is the source of it | `vendor/mpchess/LICENSE` |
| chess.js | Jeff Hlywa | BSD-2-Clause | yes — permissive | header of `vendor/chess.js` |
| Lichess puzzle database | Lichess | CC0 1.0 | yes — public domain | credited in-app |

No component conflicts with GPLv3. BSD-2-Clause and CC0 are both one-way
compatible, meaning they can be combined into a GPL work.

### mpchess piece set — GPL-3.0-or-later

Copyright (c) Maxime Chupin. https://github.com/chupinmaxime/mpchess-pieces

Unmodified `.svg` originals are in `vendor/mpchess/`. `js/pieces.js` inlines
them as an SVG sprite with **no rewriting whatsoever** — unlike most sets,
mpchess carries no ids, no `<style>` blocks and no gradients, so all twelve
share one document without renaming anything. The symbol bodies are
byte-identical to the source files, and the generator asserts no id, `<style>`
or `url(#..)` reference has crept in before emitting.

### chess.js — BSD-2-Clause

Vendored at `vendor/chess.js` with its copyright notice and licence conditions
intact at the top of the file.

### Lichess open puzzle database — CC0 1.0

Positions and solutions in `puzzles.js` derive from https://database.lichess.org/,
released under CC0 (public domain dedication). No attribution required; credited
anyway. `build-puzzles.js` regenerates `puzzles.js` from the raw database, which
is not committed — see `.gitignore`.

### Not third-party

Fonts are the operating system's own; none are bundled. The app icon and all
remaining code, layout and copy are original to this project.

## If you ever want out of copyleft

Replace the piece set and relicense. Checked against
https://github.com/lichess-org/lila/blob/master/COPYING.md, the permissive
options there are:

- **MIT** — `fantasy`, `spatial`, `celtic` (Maurizio Monge)
- **CC0** — `rhosgfx`
- **Apache 2.0** — `chessnut`

Avoid: every set by sadsnake1 (`cardinal`, `maestro`, `staunty`, …), plus
`caliente`, `anarcandy`, `cooke`, `monarchy`, `disguised`, `california` — all
CC BY-NC-SA, which bars commercial use. And `cburnett`, `merida`, `mono` are
GPLv2+, `pirouetti`/`letter`/`pixel` AGPLv3+.
