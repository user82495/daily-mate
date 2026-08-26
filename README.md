# Daily Mate

One forced mate a day. Three attempts.

**[dailymate.netlify.app](https://dailymate.netlify.app)**

A daily chess puzzle in the spirit of Wordle: everyone gets the same puzzle,
the board tells you the mate length up front, and you get three tries. Solve it
or don't — either way that's the day. No accounts, no archive, and nothing that
identifies you.

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
used (1 / 2 / 3 / X). Everything the player sees lives in `localStorage` under
`dailymate.v1` and is computed on the device — none of it is uploaded.

Streaks allow **one missed day per calendar month**. It applies silently, and
the stats screen shows a small "streak saved" note when it rescues a run.

The one figure that comes from elsewhere is "63% of players solved today's
puzzle", which is fetched once when the stats sheet opens and stays hidden
until at least twenty people have played that day. See Analytics below.

## Analytics

Anonymous, and small enough to describe in a sentence: once a day, when the
puzzle ends, the app sends `{ anonId, puzzleDay, result, attemptsUsed }` and
nothing else. `anonId` is a random UUID the browser mints for itself in
`localStorage` under `dailymate.anon.v1`, the first time a puzzle is *finished*
— a visitor who never plays is never given one and makes no request at all.

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
changes a shipped file** — it's at `dailymate-v10` now. Anything under `/api/`
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
