-- ===========================================================================
-- Daily Mate — migration 002: streaks, per-puzzle results, push subscriptions
--
-- Run this once, whole, in the Supabase SQL editor (Dashboard -> SQL Editor ->
-- New query -> paste -> Run). Idempotent: running it again is harmless.
--
-- ---------------------------------------------------------------------------
-- WHO CAN REACH ANY OF THIS
-- ---------------------------------------------------------------------------
-- Nothing here is reachable from a browser, exactly as in schema.sql. Row
-- level security is on, no policies exist, and anon/authenticated hold no
-- grants. The only way in is the service-role key, which lives in Netlify's
-- environment and never leaves the server.
--
-- This is deliberate and it is worth being explicit about, because the obvious
-- alternative looks safer than it is. Daily Mate has no accounts, so `auth.uid()`
-- is always null and an RLS policy has nothing trustworthy to compare against.
-- A policy like "player_id = the id in the request" only reads the id the
-- caller sent, so any client could send any other player's id and the policy
-- would wave it through: isolation in appearance, not in fact. Worse, a browser
-- talking to Supabase directly puts every player's IP in Supabase's own edge
-- logs, which is precisely what routing through Netlify avoids.
--
-- So the server is the only caller, and the RPCs below are the whole API. They
-- are `security definer` as requested, which is what lets them be the single
-- entry point while the tables underneath stay sealed.
-- ===========================================================================


-- ============================================================ player_stats

create table if not exists public.player_stats (
  player_id           uuid    primary key,
  games_played        integer not null default 0,
  games_solved        integer not null default 0,
  current_streak      integer not null default 0,
  max_streak          integer not null default 0,
  last_played_date    date,
  freezes_available   integer not null default 1,
  freeze_refill_month text,
  total_solve_seconds integer not null default 0,

  constraint player_stats_counts_sane check (
    games_played >= 0
    and games_solved >= 0
    and games_solved <= games_played
    and current_streak >= 0
    and max_streak >= current_streak
    and freezes_available >= 0
    and total_solve_seconds >= 0
  )
);

comment on table public.player_stats is
  'One row per anonymous player. Authoritative streak state; the client only displays it.';
comment on column public.player_stats.player_id is
  'The same random UUID as plays.anon_id — minted in the browser, meaningless elsewhere.';
comment on column public.player_stats.freeze_refill_month is
  'YYYY-MM of the last refill. When the current UTC month differs, freezes go back to 1.';


-- =========================================================== puzzle_results

create table if not exists public.puzzle_results (
  id            bigint generated always as identity primary key,
  player_id     uuid        not null,
  puzzle_id     text        not null,
  solved        boolean     not null,
  solve_seconds integer,
  created_at    timestamptz not null default now(),

  -- One result per player per puzzle. This is what makes a replay a no-op
  -- rather than a second row, enforced by the database instead of trusted
  -- from the client.
  constraint puzzle_results_once unique (player_id, puzzle_id),

  -- A solve always has a duration; a fail may not. Nothing takes a week.
  constraint puzzle_results_seconds_sane check (
    solve_seconds is null or (solve_seconds >= 0 and solve_seconds <= 86400)
  ),
  constraint puzzle_results_solved_timed check (
    not solved or solve_seconds is not null
  )
);

comment on table public.puzzle_results is
  'One row per player per puzzle. Feeds the solve-time percentile.';

-- The percentile query is "how many solvers of this puzzle were slower", which
-- is exactly this index: filter by puzzle and solved, then range over seconds.
create index if not exists puzzle_results_percentile_idx
  on public.puzzle_results (puzzle_id, solved, solve_seconds);


-- ======================================================= push_subscriptions

create table if not exists public.push_subscriptions (
  player_id    uuid        not null,
  endpoint     text        primary key,
  keys_p256dh  text        not null,
  keys_auth    text        not null,
  notify_hour  smallint    not null default 9,
  timezone     text        not null default 'UTC',
  created_at   timestamptz not null default now(),

  constraint push_hour_valid check (notify_hour between 0 and 23)
);

comment on table public.push_subscriptions is
  'Web Push endpoints. The endpoint is the primary key because that is what the
   push service considers the identity of a subscription — one device may
   re-subscribe and should replace its old row, not accumulate.';

create index if not exists push_subscriptions_player_idx
  on public.push_subscriptions (player_id);
-- The hourly sender scans by hour; keep that cheap as subscribers grow.
create index if not exists push_subscriptions_hour_idx
  on public.push_subscriptions (notify_hour);


-- ================================================================= lockdown

alter table public.player_stats       enable row level security;
alter table public.puzzle_results     enable row level security;
alter table public.push_subscriptions enable row level security;

-- Deliberately no policies. With RLS on and nothing granted, anon and
-- authenticated see empty tables even if a grant is restored by accident.
revoke all on public.player_stats       from anon, authenticated;
revoke all on public.puzzle_results     from anon, authenticated;
revoke all on public.push_subscriptions from anon, authenticated;

grant select, insert, update, delete on public.player_stats       to service_role;
grant select, insert, update          on public.puzzle_results     to service_role;
grant select, insert, update, delete on public.push_subscriptions to service_role;


-- ===================================================== completion + streaks
--
-- Everything about a finished puzzle happens here, in one statement, so the
-- client cannot tamper with the arithmetic and a retry cannot double-count.
--
-- The date is taken from the server clock, never from the caller. The brief
-- asks for UTC day boundaries and that is what this uses: `current_date at
-- time zone 'utc'`. Note this is a different day number from the one the game
-- uses to *choose* the puzzle, which is the player's local date (js/daily.js).
-- They can disagree by a few hours either side of midnight for players far from
-- UTC. Server-side UTC is the tamper-resistant choice — a client-supplied local
-- date could be set to whatever kept a streak alive.
--
-- Returns the new stats plus two flags the UI needs: whether a freeze was spent
-- and whether this call actually changed anything.

create or replace function public.dm_complete_puzzle(
  p_player_id     uuid,
  p_puzzle_id     text,
  p_solved        boolean,
  p_solve_seconds integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today      date := (now() at time zone 'utc')::date;
  v_month      text := to_char((now() at time zone 'utc')::date, 'YYYY-MM');
  v_stats      public.player_stats%rowtype;
  v_gap        integer;
  v_freeze     boolean := false;
  v_first_time boolean;
  v_seconds    integer := greatest(0, least(coalesce(p_solve_seconds, 0), 86400));
begin
  if p_player_id is null or p_puzzle_id is null or p_puzzle_id = '' then
    raise exception 'player_id and puzzle_id are required';
  end if;

  -- --- the per-puzzle row -------------------------------------------------
  -- Upsert, so a replay of the same puzzle updates rather than duplicating.
  -- `v_first_time` tells us whether this player had already finished THIS
  -- puzzle, which is what "same-day replay must not double-count" turns on.
  insert into public.puzzle_results (player_id, puzzle_id, solved, solve_seconds)
  values (
    p_player_id,
    p_puzzle_id,
    p_solved,
    case when p_solved then v_seconds else nullif(v_seconds, 0) end
  )
  on conflict (player_id, puzzle_id) do nothing;

  v_first_time := found;

  -- --- stats row ----------------------------------------------------------
  insert into public.player_stats (player_id, freeze_refill_month)
  values (p_player_id, v_month)
  on conflict (player_id) do nothing;

  select * into v_stats from public.player_stats
  where player_id = p_player_id
  for update;

  -- Monthly freeze refill, checked on every completion so it needs no cron.
  if v_stats.freeze_refill_month is distinct from v_month then
    v_stats.freezes_available := 1;
    v_stats.freeze_refill_month := v_month;
  end if;

  -- Already counted this puzzle: refresh the freeze bookkeeping and leave.
  -- Nothing about games_played, streaks or totals moves a second time.
  if not v_first_time then
    update public.player_stats set
      freezes_available   = v_stats.freezes_available,
      freeze_refill_month = v_stats.freeze_refill_month
    where player_id = p_player_id;

    return jsonb_build_object(
      'counted', false,
      'freeze_used', false,
      'stats', public.dm_player_stats(p_player_id)
    );
  end if;

  -- --- the streak ---------------------------------------------------------
  v_gap := case
             when v_stats.last_played_date is null then null
             else v_today - v_stats.last_played_date
           end;

  if not p_solved then
    -- A failure ends the run but is still a game played.
    v_stats.current_streak := 0;
  elsif v_gap is null or v_gap > 2 then
    -- First ever, or too long a lapse for a single freeze to bridge.
    v_stats.current_streak := 1;
  elsif v_gap <= 0 then
    -- Same UTC day as the last completion, but a different puzzle. Counts as a
    -- game, does not extend a daily streak a second time.
    null;
  elsif v_gap = 1 then
    v_stats.current_streak := v_stats.current_streak + 1;
  else
    -- v_gap = 2: exactly one missed day. A freeze bridges it, once.
    if v_stats.freezes_available > 0 then
      v_stats.freezes_available := v_stats.freezes_available - 1;
      v_stats.current_streak := v_stats.current_streak + 1;
      v_freeze := true;
    else
      v_stats.current_streak := 1;
    end if;
  end if;

  update public.player_stats set
    games_played        = player_stats.games_played + 1,
    games_solved        = player_stats.games_solved + (case when p_solved then 1 else 0 end),
    current_streak      = v_stats.current_streak,
    max_streak          = greatest(player_stats.max_streak, v_stats.current_streak),
    last_played_date    = v_today,
    freezes_available   = v_stats.freezes_available,
    freeze_refill_month = v_stats.freeze_refill_month,
    total_solve_seconds = player_stats.total_solve_seconds
                          + (case when p_solved then v_seconds else 0 end)
  where player_id = p_player_id;

  return jsonb_build_object(
    'counted', true,
    'freeze_used', v_freeze,
    'stats', public.dm_player_stats(p_player_id)
  );
end;
$$;


-- ============================================================ reading stats

create or replace function public.dm_player_stats(p_player_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'games_played',      s.games_played,
    'games_solved',      s.games_solved,
    'win_percent',       case when s.games_played > 0
                              then round(100.0 * s.games_solved / s.games_played)
                              else 0 end,
    'current_streak',    s.current_streak,
    'max_streak',        s.max_streak,
    'freezes_available', s.freezes_available,
    'avg_solve_seconds', case when s.games_solved > 0
                              then round(s.total_solve_seconds::numeric / s.games_solved)
                              else null end,
    'last_played_date',  s.last_played_date
  )
  from public.player_stats s
  where s.player_id = p_player_id;
$$;


-- =============================================================== percentile
--
-- "Faster than N% of solvers." Only solved rows count — including failures
-- would make a slow solve look good against people who never finished at all.
--
-- Returns the solver count alongside the percentage so the caller can apply the
-- minimum-solvers floor. The floor lives in the Netlify function, matching how
-- day-stats.mjs already handles the solve-rate threshold, so it can move
-- without a migration.

create or replace function public.dm_get_percentile(
  p_puzzle_id     text,
  p_solve_seconds integer
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with solvers as (
    select solve_seconds
    from public.puzzle_results
    where puzzle_id = p_puzzle_id
      and solved
      and solve_seconds is not null
  )
  select jsonb_build_object(
    'solvers', (select count(*) from solvers),
    -- Percent of solvers strictly slower than this time.
    'faster_than', case
      when (select count(*) from solvers) = 0 then null
      else round(
        100.0 * (select count(*) from solvers where solve_seconds > p_solve_seconds)
        / (select count(*) from solvers)
      )
    end
  );
$$;


-- ==================================================== push: who to send to
--
-- Subscribers whose local hour matches their chosen hour right now, and who
-- have not completed today's puzzle. The hourly sender calls this once.
--
-- Local time is derived in Postgres from the stored IANA zone, so a bad or
-- unknown zone cannot break the whole run — it is skipped.

create or replace function public.dm_push_due()
returns table (
  endpoint    text,
  keys_p256dh text,
  keys_auth   text,
  player_id   uuid,
  streak      integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.endpoint,
    p.keys_p256dh,
    p.keys_auth,
    p.player_id,
    coalesce(s.current_streak, 0)
  from public.push_subscriptions p
  left join public.player_stats s on s.player_id = p.player_id
  where
    -- Valid zone, and its current hour is the one they asked for.
    p.timezone in (select name from pg_timezone_names)
    and extract(hour from (now() at time zone p.timezone))::int = p.notify_hour
    -- Not already played today, in their own local terms.
    and (
      s.last_played_date is null
      or s.last_played_date < (now() at time zone p.timezone)::date
    );
$$;


-- ============================================================ push: upsert

create or replace function public.dm_push_subscribe(
  p_player_id   uuid,
  p_endpoint    text,
  p_p256dh      text,
  p_auth        text,
  p_notify_hour integer,
  p_timezone    text
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.push_subscriptions
    (player_id, endpoint, keys_p256dh, keys_auth, notify_hour, timezone)
  values (
    p_player_id, p_endpoint, p_p256dh, p_auth,
    greatest(0, least(coalesce(p_notify_hour, 9), 23)),
    coalesce(nullif(p_timezone, ''), 'UTC')
  )
  on conflict (endpoint) do update set
    player_id   = excluded.player_id,
    keys_p256dh = excluded.keys_p256dh,
    keys_auth   = excluded.keys_auth,
    notify_hour = excluded.notify_hour,
    timezone    = excluded.timezone;
$$;


-- A push service answering 404 or 410 means the subscription is gone for good.
create or replace function public.dm_push_prune(p_endpoints text[])
returns integer
language sql
security definer
set search_path = public
as $$
  with gone as (
    delete from public.push_subscriptions
    where endpoint = any(p_endpoints)
    returning 1
  )
  select count(*)::int from gone;
$$;


-- ======================================================= function lockdown
-- Supabase grants EXECUTE on new functions to anon and authenticated by
-- default. Take it back: the service role is the only caller. This matters
-- more than usual here because these are `security definer` — they run as
-- their owner, so an accidental grant would be an open door, not a locked one.

revoke execute on function
  public.dm_complete_puzzle(uuid, text, boolean, integer),
  public.dm_player_stats(uuid),
  public.dm_get_percentile(text, integer),
  public.dm_push_due(),
  public.dm_push_subscribe(uuid, text, text, text, integer, text),
  public.dm_push_prune(text[])
from public, anon, authenticated;

grant execute on function
  public.dm_complete_puzzle(uuid, text, boolean, integer),
  public.dm_player_stats(uuid),
  public.dm_get_percentile(text, integer),
  public.dm_push_due(),
  public.dm_push_subscribe(uuid, text, text, text, integer, text),
  public.dm_push_prune(text[])
to service_role;
