-- ===========================================================================
-- Daily Mate — migration 003: mode events
--
-- Run this once, whole, in the Supabase SQL editor. Idempotent.
--
-- ---------------------------------------------------------------------------
-- WHY THIS IS NOT `plays`
-- ---------------------------------------------------------------------------
-- The brief asked for mode analytics to match the existing event schema. It
-- cannot, and the reason is structural rather than stylistic.
--
-- `plays` is (anon_id, puzzle_day, result, attempts_used) with a primary key of
-- (anon_id, puzzle_day) — one row per player per day, deliberately, because
-- that key *is* the "once per day" rule for the daily puzzle. It also carries
-- CHECK constraints pinning `result` to 'solved'/'failed' and attempts to 1-3.
--
-- A mode session is none of those things: a player may finish six runs of
-- Endless in an evening, each one an event, none of them a 'solved'/'failed'
-- pair, and the table has nowhere to say which mode it was. Widening `plays`
-- would mean dropping the primary key that protects the daily's numbers.
--
-- So mode events get their own table. What is *not* duplicated is the path to
-- it: one wrapper in js/track.js, one function at /api/mode-event, the same
-- anonymous id as everything else, and the same lockdown — RLS on, no policies,
-- service_role only.
-- ===========================================================================


create table if not exists public.mode_events (
  id         bigint generated always as identity primary key,
  player_id  uuid        not null,
  mode       text        not null,
  event      text        not null,
  payload    jsonb       not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  constraint mode_events_mode_valid  check (mode in ('endless', 'elo', 'judge', 'duel')),
  constraint mode_events_event_valid check (event in (
    'started', 'ended', 'shared', 'abandoned',
    'challenge_created', 'challenge_accepted'
  )),
  -- A payload is a handful of numbers. This is a guard against a client bug
  -- turning the table into a log sink, not a business rule.
  constraint mode_events_payload_small check (pg_column_size(payload) < 512)
);

comment on table public.mode_events is
  'One row per mode event. Append-only; no per-player uniqueness, because a
   player genuinely can play the same mode many times a day.';
comment on column public.mode_events.player_id is
  'The same anonymous UUID as plays.anon_id — see js/player.js.';
comment on column public.mode_events.payload is
  'Numbers only (score, seconds, mistakes). Never a position, move, or free text.';

-- Every dashboard query is "this mode, this event, over time".
create index if not exists mode_events_mode_event_idx
  on public.mode_events (mode, event, created_at desc);
-- The cross-over number below needs per-player lookups.
create index if not exists mode_events_player_idx
  on public.mode_events (player_id);


-- ================================================================= lockdown

alter table public.mode_events enable row level security;
revoke all on public.mode_events from anon, authenticated;
grant select, insert on public.mode_events to service_role;


-- =============================================================== aggregates

-- Starts, completions, completion rate and the median headline number, per mode.
--
-- The headline number lives under a different key per mode — Endless and Judge
-- call it `score`, Duel measures `seconds` — so it is coalesced here rather
-- than in the dashboard, keeping the shape of the answer the same for all four.
create or replace function public.dm_mode_summary()
returns table (
  mode            text,
  starts          bigint,
  completions     bigint,
  completion_rate numeric,
  median_headline numeric,
  headline_unit   text
)
language sql
stable
security definer
set search_path = public
as $$
  with per_mode as (
    select
      m.mode,
      count(*) filter (where e.event = 'started') as starts,
      count(*) filter (where e.event = 'ended')   as completions,
      percentile_cont(0.5) within group (
        order by coalesce(
          (e.payload ->> 'score')::numeric,
          (e.payload ->> 'seconds')::numeric
        )
      ) filter (
        where e.event = 'ended'
          and (e.payload ? 'score' or e.payload ? 'seconds')
      ) as median_headline
    from (values ('endless'), ('elo'), ('judge'), ('duel')) as m(mode)
    left join public.mode_events e on e.mode = m.mode
    group by m.mode
  )
  select
    mode,
    starts,
    completions,
    case when starts > 0
         then round(100.0 * completions / starts, 1)
         else 0 end,
    round(median_headline, 1),
    case mode when 'duel' then 'seconds' else 'points' end
  from per_mode
  order by starts desc, mode;
$$;


-- What share of people who finish a daily puzzle open any other mode.
--
-- The single number the whole "Keep going" section exists to move. Counted over
-- players rather than sessions, and over all time rather than same-day: the
-- question is whether the daily leads anywhere, not whether it does so within
-- the hour.
create or replace function public.dm_mode_crossover()
returns table (
  daily_finishers  bigint,
  also_played_mode bigint,
  crossover_rate   numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with finishers as (
    select distinct anon_id from public.plays
  ),
  crossed as (
    select distinct f.anon_id
    from finishers f
    join public.mode_events e on e.player_id = f.anon_id and e.event = 'started'
  )
  select
    (select count(*) from finishers),
    (select count(*) from crossed),
    case when (select count(*) from finishers) > 0
         then round(100.0 * (select count(*) from crossed)
                          / (select count(*) from finishers), 1)
         else 0 end;
$$;


-- ======================================================== function lockdown

revoke execute on function
  public.dm_mode_summary(),
  public.dm_mode_crossover()
from public, anon, authenticated;

grant execute on function
  public.dm_mode_summary(),
  public.dm_mode_crossover()
to service_role;


-- ================================================== fold into the dashboard
--
-- dm_dashboard() is replaced rather than supplemented so the dashboard stays a
-- single round trip. Everything it returned before is returned unchanged; three
-- keys are added — 'modes', 'crossover', and 'modes_available'.
--
-- The two mode lookups are best-effort, inside their own exception blocks and
-- reached through EXECUTE. The daily numbers are computed first and separately,
-- so a missing mode_events table, a half-applied migration or a missing grant
-- costs the mode section and nothing else. Before this, any of those took the
-- whole payload down and the dashboard lost plays, players and retention along
-- with it — see 004_dashboard_failsoft.sql, which carries the same definition
-- so the two files converge and may be run in either order.

create or replace function public.dm_dashboard()
returns jsonb
language plpgsql
stable
as $$
declare
  result      jsonb;
  modes_j     jsonb   := '[]'::jsonb;
  crossover_j jsonb   := 'null'::jsonb;
  modes_ok    boolean := true;
begin
  -- ---------------------------------------------------------------- daily
  -- Unchanged from schema.sql, and computed before anything to do with modes
  -- is touched. If this raises, the dashboard is genuinely broken and should
  -- say so; nothing below can affect it.
  select jsonb_build_object(
    'generated_at', now(),
    'totals',    (select to_jsonb(x) from public.dm_totals() x),
    'daily',     (select coalesce(jsonb_agg(to_jsonb(x) order by x.day_num),    '[]'::jsonb) from public.dm_daily_players() x),
    'puzzles',   (select coalesce(jsonb_agg(to_jsonb(x) order by x.day_num),    '[]'::jsonb) from public.dm_puzzle_stats() x),
    'attempts',  (select coalesce(jsonb_agg(to_jsonb(x) order by x.sort_key),   '[]'::jsonb) from public.dm_attempt_distribution() x),
    'streaks',   (select coalesce(jsonb_agg(to_jsonb(x) order by x.sort_key),   '[]'::jsonb) from public.dm_streak_distribution() x),
    'retention', (select coalesce(jsonb_agg(to_jsonb(x) order by x.cohort_day), '[]'::jsonb) from public.dm_retention() x)
  )
  into result;

  -- ---------------------------------------------------------------- modes
  -- EXECUTE rather than a direct call: a plain reference would be resolved when
  -- this function is created, so 004 could not be applied before 003. Dynamic
  -- SQL defers that to call time, where the exception block is waiting.
  begin
    execute
      'select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.dm_mode_summary() x'
      into modes_j;
  exception when others then
    modes_ok := false;
    modes_j  := '[]'::jsonb;
    raise warning 'dm_dashboard: dm_mode_summary() unavailable (%) — mode section will render empty', sqlerrm;
  end;

  if modes_ok then
    begin
      execute 'select to_jsonb(x) from public.dm_mode_crossover() x'
        into crossover_j;
    exception when others then
      modes_ok    := false;
      crossover_j := 'null'::jsonb;
      raise warning 'dm_dashboard: dm_mode_crossover() unavailable (%) — crossover will render as a dash', sqlerrm;
    end;
  end if;

  return result || jsonb_build_object(
    'modes',           modes_j,
    'crossover',       crossover_j,
    'modes_available', modes_ok
  );
end
$$;

comment on function public.dm_dashboard() is
  'Everything the dashboard draws, in one round trip. The mode keys are
   best-effort: if the mode analytics are missing the daily numbers are still
   returned and modes_available is false.';

-- Replacing a function preserves its grants, but they are re-issued so this
-- file describes its own access story.
revoke execute on function public.dm_dashboard() from public, anon, authenticated;
grant execute on function public.dm_dashboard() to service_role;
