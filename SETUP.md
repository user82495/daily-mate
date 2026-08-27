# Setup

Every manual step for the streaks, percentile, notifications and explanation
features. Work top to bottom; each section says what breaks if you skip it.

Nothing here is required for the game itself to work. Every server feature
degrades to "hidden" when it is unconfigured — the puzzle, the board and the
local stats keep working with no backend at all.

---

## 1. Run the SQL migration

Supabase dashboard → **SQL Editor** → **New query** → paste the whole of
`supabase/migrations/002_streaks_results_push.sql` → **Run**.

It is idempotent, so running it twice is harmless. It creates:

| Object | What it is |
|---|---|
| `player_stats` | one row per player: games, streak, freezes, total solve time |
| `puzzle_results` | one row per player per puzzle, feeding the percentile |
| `push_subscriptions` | Web Push endpoints, notify hour and time zone |
| `dm_complete_puzzle` | records a finished puzzle **and** computes the streak |
| `dm_player_stats` | reads one player's totals |
| `dm_get_percentile` | percent of solvers who were slower |
| `dm_push_due`, `dm_push_subscribe`, `dm_push_prune` | notification plumbing |

If you have not already run `supabase/schema.sql` (the original analytics
table), run that first — this migration does not replace it.

### Nothing to configure in the Supabase dashboard

No RLS policies to add, no anon-key settings to change. Row level security is
on for all three tables with **no policies**, and `anon`/`authenticated` hold no
grants — the tables and functions are reachable only with the service-role key,
which lives in Netlify. This matches how `plays` was already locked down.

> **Why not the "anonymous insert/select their own rows" policy you might expect?**
> Daily Mate has no accounts, so `auth.uid()` is always null and a policy has
> nothing trustworthy to compare against. A policy like *"player_id = the id in
> the request"* only reads the id the caller sent, so any client could send
> someone else's id and be waved through — isolation in appearance, not in fact.
> Routing through Netlify instead also keeps players' IP addresses out of
> Supabase's edge logs. The RPCs are `security definer`, which is what lets them
> be the one entry point while the tables stay sealed.

---

## 2. Environment variables

Netlify dashboard → **Site configuration → Environment variables**.

Already set (from analytics):

| Variable | Notes |
|---|---|
| `SUPABASE_URL` | your project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | service role, **not** the anon/publishable key |

New, for notifications:

| Variable | Notes |
|---|---|
| `VAPID_PUBLIC_KEY` | generated below; also served to browsers, public by design |
| `VAPID_PRIVATE_KEY` | generated below; **secret** |
| `VAPID_SUBJECT` | `mailto:you@example.com` — a contact the push service can use |

Optional thresholds, both with sane defaults:

| Variable | Default | Effect |
|---|---|---|
| `PERCENTILE_MIN_SOLVERS` | `20` | below this many solvers the percentile line is hidden |
| `SOLVE_RATE_MIN_PLAYS` | `20` | existing: floor for the "% solved today" line |

Set them for **all deploy contexts** unless you want notifications only in
production.

---

## 3. Generate the VAPID keypair

Run locally, once. The keys identify your server to the push services; rotating
them invalidates every existing subscription, so keep them.

```bash
npm install
npx web-push generate-vapid-keys
```

That prints a public and a private key. Set all three variables:

```bash
npx netlify env:set VAPID_PUBLIC_KEY "paste-the-public-key"
npx netlify env:set VAPID_PRIVATE_KEY "paste-the-private-key"
npx netlify env:set VAPID_SUBJECT "mailto:you@example.com"
```

Or paste them into the Netlify UI. Then redeploy — functions read the
environment at cold start, so existing instances will not see new values.

Check it took:

```bash
curl https://dailymate.netlify.app/api/vapid-key
```

`{"key":"..."}` means push is live. `{"key":null}` means the variable is not
set, and the app quietly never offers notifications.

---

## 4. The hourly notification job

Nothing to configure. `netlify/functions/send-notifications.mjs` declares its
own schedule:

```js
export const config = { schedule: '@hourly' };
```

Netlify registers the cron on deploy. Confirm under **Site configuration →
Functions → Scheduled functions** after the first deploy; you should see
`send-notifications` listed as hourly.

To test it without waiting for the hour:

```bash
npx netlify functions:invoke send-notifications
```

It answers with `{ due, sent, failed, pruned }`. `due: 0` is the normal result
unless someone's chosen hour is the current one in their own time zone.

**How it decides who to send to:** `dm_push_due()` returns subscribers whose
local clock is currently at their chosen hour and who have not completed today's
puzzle. Because the job runs hourly and each subscriber matches exactly one
hour, nobody can be notified twice in a day. Subscriptions that answer 404 or
410 are deleted automatically.

---

## 5. Explanations

`scripts/generate_explanations.js` fills in the one-line "why this works" that
appears under the result card. Explanations are generated **once, locally** and
shipped inside `puzzles.js` — no player request ever reaches an LLM, and the
line works offline.

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...
npm run explanations
```

Flags:

| Flag | Effect |
|---|---|
| `--limit N` | only the first N missing explanations |
| `--dry-run` | print what it would write, change nothing |
| `--force` | regenerate every explanation, including existing ones |

**It is resumable.** `puzzles.js` is both input and output and is rewritten after
every batch, so anything already explained is skipped. If the run dies — Ctrl-C,
dropped connection, exhausted quota — just run it again; you lose only the batch
in flight. There is no separate progress file to get out of step.

It runs four requests at a time with a pause between batches and backs off on
rate limits. Answers longer than fifteen words are kept but listed at the end so
you can look at them.

A puzzle with no explanation simply shows no line, so this can be run over the
backlog whenever, and half-done is a perfectly good state to deploy.

> **Themes.** The script feeds Lichess's tactic tags to the model, which is what
> lets it name the tactic rather than guess. `build-puzzles.js` now carries a
> `themes` field, but puzzles generated before this change do not have it — those
> still get an explanation, worked out from the position alone. To backfill the
> tags, re-run `npm run puzzles` with the same seed (same CSV + same seed gives
> the same puzzles, plus the new field).

---

## 6. Deploy

```bash
git push
```

Bump `CACHE` in `sw.js` whenever a shipped file changes, or returning visitors
keep the old version. It is at `dailymate-v12`.

---

## Checking it worked

| Feature | How to tell |
|---|---|
| Streaks | finish a puzzle; the result card shows "N day streak" |
| Percentile | needs 20 solvers on one puzzle before the line appears at all |
| Stats page | the clock icon in the header, or `/stats.html` |
| Notifications | offered only **after** your first completed puzzle |
| Explanations | a sentence under the result card, once the script has run |

If a server feature shows nothing, that is the designed failure mode rather than
a bug — check the function logs in Netlify. The game never surfaces an error for
any of it.

### iOS

Safari only exposes Web Push to a PWA installed on the home screen. On iOS
outside standalone mode the app shows an Add to Home Screen hint instead of a
permission prompt, because a prompt there cannot produce a subscription. Test
notifications on iOS by adding to the home screen first and opening it from
there.
