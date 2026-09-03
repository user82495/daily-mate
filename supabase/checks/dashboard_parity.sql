-- ===========================================================================
-- dashboard_parity.sql — did adding the modes move any daily number?
-- ===========================================================================
--
-- Run this in the Supabase SQL Editor after 003_mode_events.sql is applied.
-- It reads; it writes nothing, creates nothing permanent, and is safe to run
-- against production as many times as you like.
--
-- WHAT IT CHECKS
--
-- 003 replaced dm_dashboard() to add 'modes' and 'crossover'. The bar for that
-- change was that every pre-existing daily number reads exactly as it did
-- before. This rebuilds the *old* function body verbatim, as a session-local
-- function in pg_temp, runs both against the same live data in the same
-- transaction, and compares them key by key.
--
-- 'generated_at' is excluded: it is now(), and two calls will differ by
-- microseconds whatever else is true.
--
-- The last statement raises an exception if anything differs, so this fails
-- loudly rather than printing a table nobody reads.
--
-- The comparison is jsonb equality on whole keys, not a spot check of a few
-- fields — a changed row count, a reordered array, a renamed column, or a
-- single moved integer anywhere inside 'daily' all fail it.
-- ===========================================================================

-- ------------------------------------------------------------------ the old
-- Byte-for-byte the body from schema.sql, before 003 touched it. pg_temp makes
-- it session-local: it disappears when the connection closes and it cannot
-- shadow or overwrite the real function.

create function pg_temp.dm_dashboard_pre_modes()
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


-- --------------------------------------------------------------- the report
-- One row per pre-existing key. Read this; then the DO block below enforces it.

with
  old_run as (select pg_temp.dm_dashboard_pre_modes() as j),
  new_run as (select public.dm_dashboard() as j),
  k(key) as (
    values ('totals'), ('daily'), ('puzzles'), ('attempts'), ('streaks'), ('retention')
  )
select
  k.key,
  case
    when (o.j -> k.key) is not distinct from (n.j -> k.key) then 'match'
    else '*** DIFFERS ***'
  end                                                            as verdict,
  case jsonb_typeof(o.j -> k.key)
    when 'array' then jsonb_array_length(o.j -> k.key)::text || ' rows'
    else jsonb_typeof(o.j -> k.key)
  end                                                            as old_shape,
  case jsonb_typeof(n.j -> k.key)
    when 'array' then jsonb_array_length(n.j -> k.key)::text || ' rows'
    else jsonb_typeof(n.j -> k.key)
  end                                                            as new_shape
from k, old_run o, new_run n

union all

-- The two keys 003 is supposed to add: absent before, present after. A missing
-- one here means the migration did not actually take.
select
  key,
  case
    when (o.j ? key) then '*** UNEXPECTED IN OLD ***'
    when not (n.j ? key) then '*** MISSING — did 003 run? ***'
    else 'added, as intended'
  end,
  '-',
  case jsonb_typeof(n.j -> key)
    when 'array' then jsonb_array_length(n.j -> key)::text || ' rows'
    else coalesce(jsonb_typeof(n.j -> key), 'absent')
  end
from (values ('modes'), ('crossover')) as t(key),
     (select pg_temp.dm_dashboard_pre_modes() as j) o,
     (select public.dm_dashboard() as j) n

order by 1;


-- ---------------------------------------------------------------- the assert
-- Fails the run if any pre-existing key moved, naming the ones that did.

do $$
declare
  old_j   jsonb := pg_temp.dm_dashboard_pre_modes();
  new_j   jsonb := public.dm_dashboard();
  bad     text[] := '{}';
  missing text[] := '{}';
  key     text;
begin
  foreach key in array array['totals','daily','puzzles','attempts','streaks','retention']
  loop
    if (old_j -> key) is distinct from (new_j -> key) then
      bad := bad || key;
    end if;
  end loop;

  foreach key in array array['modes','crossover']
  loop
    if not (new_j ? key) then
      missing := missing || key;
    end if;
  end loop;

  if array_length(bad, 1) is not null then
    raise exception
      'dashboard parity FAILED — these daily keys changed: %', array_to_string(bad, ', ')
      using hint = 'Adding the modes was not supposed to move any of these. '
                   'Compare dm_dashboard() in 003_mode_events.sql against schema.sql.';
  end if;

  if array_length(missing, 1) is not null then
    raise exception
      'dm_dashboard() is missing the mode keys: % — has 003_mode_events.sql been applied?',
      array_to_string(missing, ', ');
  end if;

  raise notice 'dashboard parity OK — all 6 pre-existing keys identical, both mode keys present.';
end
$$;
