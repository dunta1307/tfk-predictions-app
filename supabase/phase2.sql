-- =====================================================================
-- TFK PREDICTIONS LEAGUE — Phase 2
-- Results, scoring engine, and the three leaderboards.
-- Run once in the Supabase SQL Editor. Idempotent, safe to re-run.
-- Requires Phase 1 (schema.sql) to have been run first.
-- =====================================================================

-- -------------------------------------------------------------- scores
-- One row per player per fixture. Keeping the per-fixture detail rather
-- than just a running total means that when someone queries their points
-- in the group chat, you can show them the exact match and the exact reason.
create table if not exists scores (
  user_id      uuid    not null references profiles(id) on delete cascade,
  fixture_id   int     not null references fixtures(id) on delete cascade,
  gameweek     int     not null references gameweeks(id) on delete cascade,
  points       int     not null default 0,
  exact        boolean not null default false,
  outcome_only boolean not null default false,
  was_captain  boolean not null default false,
  scored_at    timestamptz not null default now(),
  primary key (user_id, fixture_id)
);
create index if not exists scores_gw_idx   on scores (gameweek);
create index if not exists scores_user_idx on scores (user_id);

alter table scores enable row level security;
drop policy if exists scores_read on scores;
-- Scores only exist once a match is final, so there is nothing to leak.
create policy scores_read on scores for select to authenticated using (true);

-- =====================================================================
-- THE SCORING ENGINE
--
--   Correct outcome ............ 2
--   Exact score ................ 4   (replaces the outcome points, no stacking)
--   Captain .................... doubles whatever that fixture pays
--
-- Maximum for one fixture is 8. Maximum for a 10-fixture gameweek is 44.
-- A postponed fixture is void and scores zero for everyone, and voids the
-- captain if that is where it was placed.
-- =====================================================================
create or replace function score_gameweek(p_gameweek int)
returns int language plpgsql security definer set search_path = public as $$
declare v_rows int;
begin
  insert into scores (user_id, fixture_id, gameweek, points, exact, outcome_only, was_captain, scored_at)
  select
    p.user_id,
    p.fixture_id,
    p.gameweek,
    case
      when p.home_score = f.home_score and p.away_score = f.away_score
        then 4 * (case when coalesce(e.captain_fixture = f.id, false) then 2 else 1 end)
      when sign(p.home_score - p.away_score) = sign(f.home_score - f.away_score)
        then 2 * (case when coalesce(e.captain_fixture = f.id, false) then 2 else 1 end)
      else 0
    end,
    (p.home_score = f.home_score and p.away_score = f.away_score),
    (sign(p.home_score - p.away_score) = sign(f.home_score - f.away_score)
       and not (p.home_score = f.home_score and p.away_score = f.away_score)),
    coalesce(e.captain_fixture = f.id, false),
    now()
  from predictions p
  join fixtures f on f.id = p.fixture_id
  left join entries e on e.user_id = p.user_id and e.gameweek = p.gameweek
  where p.gameweek = p_gameweek
    and f.finished
    and not f.postponed
    and f.home_score is not null
    and f.away_score is not null
  on conflict (user_id, fixture_id) do update
    set points       = excluded.points,
        exact        = excluded.exact,
        outcome_only = excluded.outcome_only,
        was_captain  = excluded.was_captain,
        scored_at    = now();

  get diagnostics v_rows = row_count;
  return v_rows;
end $$;

-- ---------------------------------------------------------------------
-- Score and publish a gameweek, but only once every match is settled.
-- Returns true if it published, false if the gameweek is still running.
-- ---------------------------------------------------------------------
create or replace function finalise_gameweek(p_gameweek int)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_outstanding int;
begin
  select count(*) into v_outstanding
    from fixtures f
   where f.gameweek = p_gameweek
     and not f.finished
     and not f.postponed;

  if v_outstanding > 0 then
    update gameweeks set status = 'locked', updated_at = now()
     where id = p_gameweek and status = 'upcoming' and now() >= deadline;
    return false;
  end if;

  perform score_gameweek(p_gameweek);
  update gameweeks set status = 'published', updated_at = now() where id = p_gameweek;
  return true;
end $$;

revoke all on function score_gameweek(int)    from public;
revoke all on function finalise_gameweek(int) from public;

-- =====================================================================
-- LEADERBOARD VIEWS
-- Ties break on points, then most exact scores, then most correct outcomes.
-- =====================================================================

-- Per player, per gameweek.
create or replace view v_gameweek_totals with (security_invoker = true) as
select
  s.gameweek,
  s.user_id,
  sum(s.points)::int                              as points,
  count(*) filter (where s.exact)::int            as exact_count,
  count(*) filter (where s.outcome_only)::int     as outcome_count
from scores s
group by s.gameweek, s.user_id;

-- Season standings, published gameweeks only.
create or replace view v_leaderboard_overall with (security_invoker = true) as
select
  t.user_id,
  pr.display_name,
  sum(t.points)::int        as points,
  sum(t.exact_count)::int   as exact_count,
  sum(t.outcome_count)::int as outcome_count,
  count(*)::int             as gameweeks_played,
  rank() over (
    order by sum(t.points) desc, sum(t.exact_count) desc, sum(t.outcome_count) desc
  )::int as rank
from v_gameweek_totals t
join gameweeks g on g.id = t.gameweek and g.status = 'published'
join profiles  pr on pr.id = t.user_id
group by t.user_id, pr.display_name;

-- Monthly prize tables. A gameweek belongs entirely to the month its first
-- match is played in, which is already baked into gameweeks.month_key.
create or replace view v_leaderboard_monthly with (security_invoker = true) as
select
  g.month_key,
  t.user_id,
  pr.display_name,
  sum(t.points)::int        as points,
  sum(t.exact_count)::int   as exact_count,
  sum(t.outcome_count)::int as outcome_count,
  rank() over (
    partition by g.month_key
    order by sum(t.points) desc, sum(t.exact_count) desc, sum(t.outcome_count) desc
  )::int as rank
from v_gameweek_totals t
join gameweeks g on g.id = t.gameweek and g.status = 'published'
join profiles  pr on pr.id = t.user_id
group by g.month_key, t.user_id, pr.display_name;

-- Single gameweek tables.
create or replace view v_leaderboard_gameweek with (security_invoker = true) as
select
  t.gameweek,
  t.user_id,
  pr.display_name,
  t.points,
  t.exact_count,
  t.outcome_count,
  rank() over (
    partition by t.gameweek
    order by t.points desc, t.exact_count desc, t.outcome_count desc
  )::int as rank
from v_gameweek_totals t
join profiles pr on pr.id = t.user_id;

-- Month summary: which months are complete, and who won each.
create or replace view v_month_summary with (security_invoker = true) as
select
  g.month_key,
  count(*)::int                                              as gameweeks_total,
  count(*) filter (where g.status = 'published')::int        as gameweeks_published,
  min(g.id)::int                                             as first_gw,
  max(g.id)::int                                             as last_gw,
  min(g.deadline)                                            as opens
from gameweeks g
group by g.month_key;
