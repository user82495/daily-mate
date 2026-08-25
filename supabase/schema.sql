-- ===========================================================================
-- Daily Mate — analytics schema
--
-- Run this once, whole, in the Supabase SQL editor (Dashboard -> SQL Editor ->
-- New query -> paste -> Run). It is idempotent: running it again is harmless.
--
-- WHAT IS STORED
--   One row per player per day, and nothing else. No IP addresses, no user
--   agents, no location, no accounts, no session identifiers. `anon_id` is a
--   random UUID the browser generates for itself the first time a puzzle is
--   finished; it is meaningless outside this table.
--
-- WHO CAN REACH IT
--   Row level security is on and there are no policies, and the anon and
--   authenticated roles have every grant revoked. Nothing here is reachable
--   with the publishable/anon key. The only way in is the service-role key,
--   which lives in Netlify's environment and never leaves the server.
-- ===========================================================================


-- --------------------------------------------------------------------- table

create table if not exists public.plays (
  anon_id       uuid        not null,
  puzzle_day    integer     not null,
  result        text        not null,
  attempts_used smallint    not null,
  created_at    timestamptz not null default now(),

  -- One row per player per day. The primary key *is* the "once per day" rule,
  -- so a duplicated or replayed request can never inflate the numbers.
  primary key (anon_id, puzzle_day),

  constraint plays_result_valid   check (result in ('solved', 'failed')),
  constraint plays_attempts_valid check (attempts_used between 1 and 3),
  -- Days are counted from the Unix epoch (see js/daily.js). This range is
  -- roughly 2024-2079 — a guard against nonsense, not a business rule.
  constraint plays_day_sane       check (puzzle_day between 19700 and 40000)
);

comment on table  public.plays is
  'One anonymous row per player per puzzle day. No PII, ever.';
comment on column public.plays.anon_id is
  'Random UUID minted in the browser on first completed puzzle. Not derived from anything.';
comment on column public.plays.puzzle_day is
  'Player-local calendar date as days since 1970-01-01 (js/daily.js dayNumber()).';

-- The primary key already indexes (anon_id, puzzle_day). Day-first lookups
-- (every dashboard aggregate) need their own index.
create index if not exists plays_puzzle_day_idx on public.plays (puzzle_day);


-- ------------------------------------------------------------------ lockdown

alter table public.plays enable row level security;
-- Deliberately no policies: with RLS on and nothing granted, anon and
-- authenticated see an empty table even if a grant is restored by accident.

revoke all on public.plays from anon, authenticated;

-- The service role reads and writes; it deliberately cannot update or delete.
-- Granting explicitly rather than leaning on Supabase's default privileges
-- means this file describes the whole access story on its own.
grant select, insert on public.plays to service_role;


-- --------------------------------------------------------------- aggregates
-- All of these are read by the dashboard through the service role. None of
-- them is reachable from a browser.

-- Daily active players, split into first-timers and everyone else.
create or replace function public.dm_daily_players()
returns table (
  day_num           integer,
  day_date          date,
  players           bigint,
  new_players       bigint,
  returning_players bigint
)
language sql
stable
as $$
  with firsts as (
    select anon_id, min(puzzle_day) as first_day
    from public.plays
    group by anon_id
  )
  select
    p.puzzle_day,
    date '1970-01-01' + p.puzzle_day,
    count(*),
    count(*) filter (where f.first_day = p.puzzle_day),
    count(*) filter (where f.first_day < p.puzzle_day)
  from public.plays p
  join firsts f using (anon_id)
  group by p.puzzle_day
  order by p.puzzle_day;
$$;

-- Solve rate for every puzzle that has been played.
create or replace function public.dm_puzzle_stats()
returns table (
  day_num    integer,
  day_date   date,
  plays      bigint,
  solved     bigint,
  solve_rate numeric
)
language sql
stable
as $$
  select
    puzzle_day,
    date '1970-01-01' + puzzle_day,
    count(*),
    count(*) filter (where result = 'solved'),
    round(100.0 * count(*) filter (where result = 'solved') / count(*), 1)
  from public.plays
  group by puzzle_day
  order by puzzle_day;
$$;

-- How many attempts it took, across every play ever recorded.
-- 'X' is "failed all three".
create or replace function public.dm_attempt_distribution()
returns table (bucket text, sort_key integer, plays bigint)
language sql
stable
as $$
  with counted as (
    select
      case when result = 'failed' then 'X' else attempts_used::text end as bucket,
      count(*) as n
    from public.plays
    group by 1
  )
  select b.bucket, b.sort_key, coalesce(c.n, 0)
  from (values ('1', 1), ('2', 2), ('3', 3), ('X', 4)) as b(bucket, sort_key)
  left join counted c on c.bucket = b.bucket
  order by b.sort_key;
$$;

-- Live streaks: consecutive *solved* days, counted back from a player's most
-- recent solve, and only for players whose run reaches today or yesterday.
--
-- "Today" is the newest day present in the table rather than a clock reading,
-- so the answer does not depend on when the dashboard happens to be opened.
--
-- This is the strict rule: a gap always ends the run. The app itself forgives
-- one missed day per calendar month, so a player's own displayed streak can be
-- longer than the one counted here. Deliberate — this measures unbroken play.
create or replace function public.dm_streak_distribution()
returns table (bucket text, sort_key integer, players bigint)
language sql
stable
as $$
  with anchor as (
    select max(puzzle_day) as today from public.plays
  ),
  islands as (
    -- Consecutive days share a value of (day - row_number): the classic
    -- gaps-and-islands trick.
    select
      anon_id,
      puzzle_day,
      puzzle_day - row_number() over (partition by anon_id order by puzzle_day) as island
    from public.plays
    where result = 'solved'
  ),
  runs as (
    select anon_id, count(*) as run_len, max(puzzle_day) as end_day
    from islands
    group by anon_id, island
  ),
  live as (
    select distinct on (r.anon_id) r.anon_id, r.run_len
    from runs r
    cross join anchor a
    where a.today is not null
      and r.end_day >= a.today - 1
    order by r.anon_id, r.end_day desc
  ),
  counted as (
    select
      case when run_len >= 3 then '3+' else run_len::text end as bucket,
      count(*) as n
    from live
    group by 1
  )
  select b.bucket, b.sort_key, coalesce(c.n, 0)
  from (values ('1', 1), ('2', 2), ('3+', 3)) as b(bucket, sort_key)
  left join counted c on c.bucket = b.bucket
  order by b.sort_key;
$$;

-- Day-1 and day-7 retention, by the cohort a player first appeared in.
-- `*_eligible` is false while a cohort is too young to have had the chance —
-- the dashboard leaves those out of the headline rate rather than counting
-- them as churn.
create or replace function public.dm_retention()
returns table (
  cohort_day   integer,
  cohort_date  date,
  cohort_size  bigint,
  d1_eligible  boolean,
  d1_returned  bigint,
  d7_eligible  boolean,
  d7_returned  bigint
)
language sql
stable
as $$
  with firsts as (
    select anon_id, min(puzzle_day) as first_day
    from public.plays
    group by anon_id
  ),
  bounds as (
    select max(puzzle_day) as last_day from public.plays
  )
  select
    f.first_day,
    date '1970-01-01' + f.first_day,
    count(*),
    (f.first_day + 1) <= b.last_day,
    count(*) filter (
      where exists (
        select 1 from public.plays p
        where p.anon_id = f.anon_id and p.puzzle_day = f.first_day + 1
      )
    ),
    (f.first_day + 7) <= b.last_day,
    count(*) filter (
      where exists (
        select 1 from public.plays p
        where p.anon_id = f.anon_id and p.puzzle_day = f.first_day + 7
      )
    )
  from firsts f
  cross join bounds b
  group by f.first_day, b.last_day
  order by f.first_day;
$$;

create or replace function public.dm_totals()
returns table (
  total_plays   bigint,
  total_players bigint,
  first_day     integer,
  last_day      integer
)
language sql
stable
as $$
  select count(*), count(distinct anon_id), min(puzzle_day), max(puzzle_day)
  from public.plays;
$$;

-- Everything the dashboard needs, in one round trip.
create or replace function public.dm_dashboard()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'generated_at', now(),
    'totals',    (select to_jsonb(x) from public.dm_totals() x),
    'daily',     (select coalesce(jsonb_agg(to_jsonb(x) order by x.day_num),    '[]'::jsonb) from public.dm_daily_players() x),
    'puzzles',   (select coalesce(jsonb_agg(to_jsonb(x) order by x.day_num),    '[]'::jsonb) from public.dm_puzzle_stats() x),
    'attempts',  (select coalesce(jsonb_agg(to_jsonb(x) order by x.sort_key),   '[]'::jsonb) from public.dm_attempt_distribution() x),
    'streaks',   (select coalesce(jsonb_agg(to_jsonb(x) order by x.sort_key),   '[]'::jsonb) from public.dm_streak_distribution() x),
    'retention', (select coalesce(jsonb_agg(to_jsonb(x) order by x.cohort_day), '[]'::jsonb) from public.dm_retention() x)
  );
$$;

-- The one number the app itself asks for: how today went, so far.
-- The 20-player floor is enforced in the Netlify function, not here, so this
-- stays a plain count and the threshold can move without a migration.
create or replace function public.dm_day_stats(p_day integer)
returns table (plays bigint, solved bigint)
language sql
stable
as $$
  select
    count(*),
    count(*) filter (where result = 'solved')
  from public.plays
  where puzzle_day = p_day;
$$;


-- ------------------------------------------------------- function lockdown
-- Supabase grants EXECUTE on new functions to anon and authenticated by
-- default. Take it back: the service role is the only caller.

revoke execute on function
  public.dm_daily_players(),
  public.dm_puzzle_stats(),
  public.dm_attempt_distribution(),
  public.dm_streak_distribution(),
  public.dm_retention(),
  public.dm_totals(),
  public.dm_dashboard(),
  public.dm_day_stats(integer)
from public, anon, authenticated;

grant execute on function
  public.dm_daily_players(),
  public.dm_puzzle_stats(),
  public.dm_attempt_distribution(),
  public.dm_streak_distribution(),
  public.dm_retention(),
  public.dm_totals(),
  public.dm_dashboard(),
  public.dm_day_stats(integer)
to service_role;
