# Daily Mate

One forced mate a day. Three attempts.

**[dailymatechess.netlify.app](https://dailymatechess.netlify.app)**

A daily chess puzzle in the spirit of Wordle: everyone gets the same puzzle,
the board tells you the mate length up front, and you get three tries. Solve it
or don't — either way that's the day. No accounts, no archive, and nothing that
identifies you.

Server features (streaks, percentile, notifications, explanations) each need a
one-time setup step — see **[SETUP.md](SETUP.md)**. Without them the game still
works; every one of them degrades to "hidden" rather than to an error.

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
used (1 / 2 / 3 / X), under the `localStorage` key `dailymate.v1`.

**Streaks are computed on the server**, by `dm_complete_puzzle` in Postgres, so
they cannot be edited from the page. The device keeps its own copy for the
histogram and for showing something useful offline; `stats.html` prefers the
server's figures and says so when it is falling back to the local ones.

A streak survives **one missed day per calendar month** — a freeze, spent
automatically. The result card says "Streak freeze used ❄️" on the day it saves
a run. Freezes refill on the first completion of a new month, so there is no
cron to run.

## The result card

When the day ends: the squares, the solve time, the streak, how you compare to
other solvers, and one line on why the move works.

```
Daily Mate #142 ♟️
⬜⬜🟩 0:47
🔥 12

dailymatechess.netlify.app
```

One square per attempt — ⬜ for an attempt that did not mate, and a final 🟩 for
the solve or 🟥 for a day that ran out. No board, no notation, nothing that
spoils the position. The streak line only appears at two days or more.

Solve time runs from the first board render to the final move, and deliberately
does not survive a reload — a puzzle left open overnight would otherwise report
a fourteen-hour solve and poison the percentile for everyone.

"Faster than 78% of solvers today" is hidden until twenty people have solved
that puzzle; below that it is noise dressed up as a statistic.

## Explanations

One sentence under the result card — *"Deflection: the queen can't guard both
the back rank and the knight."* Written once by
`scripts/generate_explanations.js` and shipped inside `puzzles.js`, so no player
request ever reaches an LLM and the line works offline. A puzzle with no
explanation simply shows no line. See [SETUP.md](SETUP.md).

## Notifications

Off unless asked for, and only ever offered **after** a first completed puzzle —
never on arrival. A player picks an hour; an hourly Netlify function sends to
whoever's local clock has just reached it and who has not played today.

On iOS the app shows an Add to Home Screen hint instead of a permission prompt,
because Safari only exposes Web Push to an installed PWA and a prompt there
cannot produce a subscription.

The one figure that comes from elsewhere is "63% of players solved today's
puzzle", which is fetched once when the stats sheet opens and stays hidden
until at least twenty people have played that day. See Analytics below.

## Analytics

Anonymous. Once a day, when the puzzle ends, the app sends
`{ anonId, puzzleDay, result, attemptsUsed }` to `/api/track`, and separately
reports the completion and its duration to `/api/complete` so the server can
work out the streak and the percentile. `anonId` is a random UUID the browser
mints for itself in `localStorage` under `dailymate.anon.v1` (mirrored to
`dm_player_id`), the first time a puzzle is *finished* — a visitor who never
plays is never given one and makes no request at all.

Turning on notifications adds two more stored values: the hour chosen, and the
IANA time zone name it is measured in. `privacy.html` lists all of it.

No IP addresses, no user agents, no location, no cookies, no third-party
scripts, no cross-site anything. `privacy.html` says the same thing to players,
and `js/analytics.js` is the whole implementation.

It is fire-and-forget in the strict sense — sent with `navigator.sendBeacon`,
with nothing awaited and no retry. A play that fails to send is simply not
counted; the game never notices, and neither does the player.

The browser never talks to the database. Requests go to Netlify functions in
`netlify/functions/`, which hold the credentials and forward only those four
fields. That is a privacy decision as much as a security one: a direct
browser-to-Supabase write would leave the player's IP in Supabase's own request
logs, where we would neither want it nor control it.

Storage is Postgres on Supabase. `supabase/schema.sql` is the whole setup — one
table with `(anon_id, puzzle_day)` as its primary key, so "once per player per
day" is enforced by the database rather than trusted from the client. Row level
security is on with no policies and every grant revoked from `anon` and
`authenticated`: the publishable key opens nothing. Only the service-role key,
which lives in Netlify's environment, gets in.

## The dashboard

`dashboard.html` — daily active players, new vs returning, day-1 and day-7
retention, solve rate per puzzle sorted hardest first, attempt and streak
distributions, and total plays. Same dark theme and type as the game;
[Chart.js](https://www.chartjs.org) is vendored at `vendor/chart.umd.min.js`
and is never shipped to players.

The page itself is public and ships empty — on static hosting it has to be. The
guard is on `/api/dashboard-data`, which wants a password as a bearer token and
compares it in constant time. The URL is not a secret and is not treated as one.
The password is typed in and kept in `sessionStorage`, so closing the tab locks
it again.

The password is not in the repository. `netlify/functions/dashboard-data.mjs`
holds only its SHA-256 digest in `DASHBOARD_PASSWORD_SHA256`; the submitted
password is hashed on the server and the two digests compared in constant time.
A malformed digest refuses to serve rather than falling open.

To set or change it:

```bash
node make-hash.js          # type the password, press Ctrl-D
```

and paste the hex over the constant. `make-hash.js` is a local tool — never
imported by the site, never deployed, and it writes nothing to disk.

One caveat worth stating plainly: a bare SHA-256 keeps the plaintext out of the
repo, but it is not a slow password hash, and this repository is public. An
attacker has the digest and can grind it offline. A dictionary word with digits
on the end will not survive that; a long random string will. Generate one with
`openssl rand -base64 24`.

Aggregation happens in Postgres (`dm_dashboard()` and friends), so one request
returns everything and no raw rows ever leave the database.

One deliberate difference: the streak distribution counts **unbroken** runs of
solves, with no forgiveness applied, so a player's own displayed streak can read
higher than the bucket they fall into here.

## Running it locally

No build step and no dependencies to install — the browser gets exactly what's
in the repository.

```bash
python3 -m http.server 5173
```

Then open <http://localhost:5173>. A service worker is used, so it must be
served over HTTP rather than opened as a `file://` URL.

That serves static files only, so `/api/` returns 404 and the analytics calls
fail — which is exactly what they are built to do, silently, with the solve-rate
line staying hidden and the game unaffected. To exercise the functions and the
dashboard locally you need the environment variables above and:

```bash
npx netlify dev
```

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

Static hosting, no build command. Publish the repository root. `netlify.toml`
sets that up along with the functions and the `/api/*` route.

Four environment variables, set in Netlify (Site configuration → Environment
variables). None of them is ever sent to a browser:

| Variable | What it is |
|---|---|
| `SUPABASE_URL` | Project URL, e.g. `https://abcd.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | **Service role**, not the publishable/anon key. Secret. |
| `SOLVE_RATE_MIN_PLAYS` | Optional. The floor for showing the solve rate; defaults to 20. |

Then run `supabase/schema.sql` once in the Supabase SQL editor.

Without any of this the game still works: every analytics call fails quietly
and the solve-rate line stays hidden.

The service worker is cache-first, so returning visitors keep the old version
until the cache name changes. **Bump `CACHE` in `sw.js` on every deploy that
changes a shipped file** — it's at `dailymate-v15` now. Anything under `/api/`
is excluded from it deliberately: the cache lookup ignores query strings, so a
cached `day-stats` response would be served for every other day too.

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
