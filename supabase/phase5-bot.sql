-- =====================================================================
-- TFK PREDICTIONS LEAGUE — Phase 5: the prediction bot
-- Run once in the Supabase SQL Editor. Idempotent. Requires phases 1-4.
-- =====================================================================

-- The bot is a real player with a real account. It plays under the same
-- deadline as everyone else, and its predictions are written before the
-- first kickoff — never after.
alter table profiles add column if not exists is_bot boolean not null default false;

-- FPL publishes a 1-5 difficulty rating per side per fixture. Storing it gives
-- the model something to work with in August, before there are any results.
alter table fixtures add column if not exists home_difficulty int;
alter table fixtures add column if not exists away_difficulty int;

-- ---------------------------------------------------------------------
-- Leaderboards: carry the flag so the UI can mark it, and so the cash
-- prize can skip it without a second query.
-- ---------------------------------------------------------------------
create or replace view v_leaderboard_overall with (security_invoker = true) as
select t.user_id, pr.display_name, pr.is_bot,
       sum(t.points)::int as points,
       sum(t.exact_count)::int as exact_count,
       sum(t.outcome_count)::int as outcome_count,
       count(*)::int as gameweeks_played,
       rank() over (order by sum(t.points) desc, sum(t.exact_count) desc, sum(t.outcome_count) desc)::int as rank
from v_gameweek_totals t
join gameweeks g on g.id = t.gameweek and g.status = 'published'
join profiles  pr on pr.id = t.user_id
group by t.user_id, pr.display_name, pr.is_bot;

create or replace view v_leaderboard_monthly with (security_invoker = true) as
select g.month_key, t.user_id, pr.display_name, pr.is_bot,
       sum(t.points)::int as points,
       sum(t.exact_count)::int as exact_count,
       sum(t.outcome_count)::int as outcome_count,
       rank() over (partition by g.month_key
         order by sum(t.points) desc, sum(t.exact_count) desc, sum(t.outcome_count) desc)::int as rank
from v_gameweek_totals t
join gameweeks g on g.id = t.gameweek and g.status = 'published'
join profiles  pr on pr.id = t.user_id
group by g.month_key, t.user_id, pr.display_name, pr.is_bot;

create or replace view v_leaderboard_gameweek with (security_invoker = true) as
select t.gameweek, t.user_id, pr.display_name, pr.is_bot,
       t.points, t.exact_count, t.outcome_count,
       rank() over (partition by t.gameweek
         order by t.points desc, t.exact_count desc, t.outcome_count desc)::int as rank
from v_gameweek_totals t
join profiles pr on pr.id = t.user_id;

-- The bot is never emailed and never chased.
create or replace function league_emails()
returns table (user_id uuid, email text, display_name text, email_optin boolean)
language sql security definer set search_path = public as $$
  select p.id, u.email::text, p.display_name, p.email_optin
    from profiles p join auth.users u on u.id = p.id
   where not p.is_admin and not p.is_bot and p.is_active and u.email is not null;
$$;

create or replace function reminder_targets(p_gameweek int, p_kind text)
returns table (user_id uuid, email text, display_name text,
               picks_made int, fixtures_total int, captain_set boolean)
language sql security definer set search_path = public as $$
  select p.id, u.email::text, p.display_name,
    coalesce(pc.n, 0)::int,
    (select count(*) from fixtures f where f.gameweek = p_gameweek and not f.postponed)::int,
    coalesce(e.captain_fixture is not null, false)
  from profiles p
  join auth.users u on u.id = p.id
  left join entries e on e.user_id = p.id and e.gameweek = p_gameweek
  left join (select pr.user_id, count(*) as n from predictions pr
              where pr.gameweek = p_gameweek group by pr.user_id) pc on pc.user_id = p.id
  where p.email_optin and p.is_active and not p.is_admin and not p.is_bot
    and u.email is not null
    and (coalesce(pc.n, 0) < (select count(*) from fixtures f where f.gameweek = p_gameweek and not f.postponed)
         or e.captain_fixture is null)
    and not exists (select 1 from email_log l
                     where l.user_id = p.id and l.gameweek = p_gameweek and l.kind = p_kind);
$$;

-- Everything the model needs: fixtures to predict, plus every result so far.
create or replace function bot_model_input(p_gameweek int)
returns table (
  fixture_id int, kickoff timestamptz,
  home_team int, away_team int,
  home_name text, away_name text,
  home_difficulty int, away_difficulty int
)
language sql security definer set search_path = public as $$
  select f.id, f.kickoff, f.home_team, f.away_team,
         ht.name, at.name, f.home_difficulty, f.away_difficulty
    from fixtures f
    join teams ht on ht.id = f.home_team
    join teams at on at.id = f.away_team
   where f.gameweek = p_gameweek and not f.postponed
   order by f.kickoff;
$$;

create or replace function bot_form()
returns table (team_id int, played int, scored int, conceded int,
               home_played int, home_scored int, home_conceded int)
language sql security definer set search_path = public as $$
  with games as (
    select home_team as team, home_score as gf, away_score as ga, true as at_home
      from fixtures where finished and not postponed and home_score is not null
    union all
    select away_team, away_score, home_score, false
      from fixtures where finished and not postponed and home_score is not null
  )
  select team, count(*)::int, sum(gf)::int, sum(ga)::int,
         count(*) filter (where at_home)::int,
         coalesce(sum(gf) filter (where at_home), 0)::int,
         coalesce(sum(ga) filter (where at_home), 0)::int
    from games group by team;
$$;

revoke all on function bot_model_input(int) from public;
revoke all on function bot_form() from public;

-- ---------------------------------------------------------------------
-- Schedule: every 10 minutes, offset again so the jobs do not all fire at
-- once. It only acts when a deadline is about six hours away.
-- Replace YOUR_DOMAIN and YOUR_CRON_SECRET before running.
-- ---------------------------------------------------------------------
select cron.unschedule('tfk-bot-predictions') where exists (
  select 1 from cron.job where jobname = 'tfk-bot-predictions');

select cron.schedule(
  'tfk-bot-predictions',
  '2-59/10 * * * *',
  $$
  select net.http_get(
    url := 'https://tfkpredictions.com/api/cron/bot-predictions?secret=278aa98d3d3791990e684724c5388b95c98bf1ec4493572b',
    timeout_milliseconds := 30000
  );
  $$
);
