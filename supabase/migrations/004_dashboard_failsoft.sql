-- ===========================================================================
-- Daily Mate — migration 004: the mode section must never take the page down
--
-- Run this once, whole, in the Supabase SQL editor. Idempotent, and safe to run
-- whether or not 003_mode_events.sql has been applied — it does not require
-- mode_events, dm_mode_summary() or dm_mode_crossover() to exist.
--
-- ---------------------------------------------------------------------------
-- THE PROBLEM
-- ---------------------------------------------------------------------------
-- 003 folded the mode analytics into dm_dashboard() as two more sub-selects:
--
--     'modes',     (select ... from public.dm_mode_summary() x),
--     'crossover', (select ... from public.dm_mode_crossover() x)
--
-- which means the daily numbers and the mode numbers now share a fate. If
-- mode_events is dropped, or 003 is half-applied, or a grant is missing, those
-- sub-selects raise — and because they raise inside dm_dashboard(), the entire
-- call fails. /api/dashboard-data turns that into a 502 and the dashboard shows
-- an error page. Plays, players, retention, solve rates, the attempt histogram:
-- all of it gone, because a table that only feeds one section is missing.
--
-- That is the wrong failure. The mode section is the newest and least important
-- part of the page, and it was holding the oldest and most important part
-- hostage.
--
-- ---------------------------------------------------------------------------
-- THE FIX
-- ---------------------------------------------------------------------------
-- The daily payload is built first and on its own. The two mode lookups then
-- run inside their own exception blocks, through EXECUTE so that the function
-- can be created even when the mode functions do not exist yet. Anything that
-- goes wrong in there costs the mode section and nothing else.
--
-- A third key, 'modes_available', says which happened, so the dashboard can
-- draw "not installed" differently from "installed, nobody has played yet".
-- Without it an un-run migration is indistinguishable from a quiet week, and
-- the page would confidently report 0% crossover for a feature that is not
-- deployed.
--
-- Failures are also raised as warnings, so the reason is in the Postgres logs
-- rather than only inferable from a table of dashes.
--
-- NOTE ON ORDER: 003 carries this same definition, so 003 and 004 converge on
-- the same dm_dashboard() and may be run in either order, or re-run, without
-- reintroducing the fragile version.
-- ===========================================================================

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
