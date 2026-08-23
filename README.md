# Daily Mate

One forced mate a day. Three attempts.

**[dailymate.netlify.app](https://dailymate.netlify.app)**

A daily chess puzzle in the spirit of Wordle: everyone gets the same puzzle,
the board tells you the mate length up front, and you get three tries. Solve it
or don't — either way that's the day. No accounts, no backend, no archive.

## How it plays

The board announces "Mate in 2", "Mate in 3", and so on. You play the side to
move, and the board is oriented from your side.

An attempt is a **whole line**, not a single move. For a mate in 3 you get three
moves, and the opponent answers each one — including after you've left the
solution. The attempt is judged at the end: checkmate is a solve, anything else
fails. Finding a *faster* mate than the stated length counts too.

When a line comes up short, the position stays on screen with a plain-language
reason — "Black's king escaped to f8." — before the board resets and the attempt
counter ticks down.

Once you leave the stored solution the puzzle data has nothing more to say, so
the opponent's replies are generated at runtime with chess.js: take a mate if
one is offered, else win material outright, else move the king to safety, else
play on — never walking into mate when there's an alternative.

## Stats

Played, solved percentage, current and max streak, and a histogram of attempts
used (1 / 2 / 3 / X). Everything lives in `localStorage` under `dailymate.v1`;
nothing is sent anywhere.

Streaks allow **one missed day per calendar month**. It applies silently, and
the stats screen shows a small "streak saved" note when it rescues a run.

## Running it locally

No build step and no dependencies to install — the browser gets exactly what's
in the repository.

```bash
python3 -m http.server 5173
```

Then open <http://localhost:5173>. A service worker is used, so it must be
served over HTTP rather than opened as a `file://` URL.

### Dev flag

`?dev=1` adds a bar with a puzzle-index jumper and a stats reset. Without the
flag the controls are never built, not merely hidden. Jumping to a puzzle this
way never touches your real stats.

<http://localhost:5173/?dev=1>

## Regenerating the puzzles

`puzzles.js` holds 30 puzzles — a month of content — as pure data with no logic
in it, so it can be regenerated without touching the game.

They come from the [Lichess open puzzle
database](https://database.lichess.org/) (CC0). The raw CSV is about 1 GB and is
**not** committed; download it first:

```bash
curl -L -O https://database.lichess.org/lichess_db_puzzle.csv.zst
```

Decompress it to `lichess_db_puzzle.csv` in the project root, then:

```bash
node build-puzzles.js --count 30 --seed 20260101
```

The script streams the CSV rather than loading it, keeps puzzles rated
1000–1600 with popularity above 80, more than 1000 plays and fewer than 16
pieces, then re-verifies every candidate with chess.js — loading the position,
playing the line, and asserting it ends in checkmate in exactly the stated
number of moves. Anything that fails is dropped and reported.

The current set is 2 × mate-in-1, 16 × mate-in-2, 10 × mate-in-3 and
2 × mate-in-4, arranged so the long ones are spread out. Same CSV and same seed
produce a byte-identical file.

## Daily rollover

Puzzle #1 is 9 August 2026; the puzzle changes at **local** midnight. Which one
you get is derived from your local calendar date, so changing timezone just
gives you that date's puzzle — you can't be served two in one local day.

## Deploying

Static hosting, no build command. Publish the repository root.

The service worker is cache-first, so returning visitors keep the old version
until the cache name changes. **Bump `CACHE` in `sw.js` on every deploy that
changes a shipped file** — it's at `dailymate-v9` now.

## Licence

**GPLv3 or later** — see [LICENSE](LICENSE).

That follows from the artwork rather than from preference: the mpchess piece set
is copyleft and is inlined into `js/pieces.js`, so the app is a work based on it
and inherits the same terms. A PWA ships its JavaScript to every visitor, which
counts as conveying the program, so the source has to be available. It's
unminified, so what the browser receives *is* the source.

Commercial use is allowed — GPL forbids taking the source private, not charging
money. To go closed-source you'd need to swap the piece set for a permissive one
and relicense; [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) lists which
Lichess sets are safe for that and which are not.

### Credits

- Puzzles — [Lichess open puzzle database](https://database.lichess.org/), CC0
- Pieces — [mpchess](https://github.com/chupinmaxime/mpchess-pieces) by Maxime
  Chupin, GPLv3
- Rules engine — [chess.js](https://github.com/jhlywa/chess.js) by Jeff Hlywa,
  BSD-2-Clause

Full details in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
