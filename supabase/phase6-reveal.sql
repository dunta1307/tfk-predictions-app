-- =====================================================================
-- TFK PREDICTIONS LEAGUE — Phase 6: the pre-match reveal email
-- Run once in the Supabase SQL Editor. Idempotent. Requires phases 1-5.
-- Replace YOUR_DOMAIN and YOUR_CRON_SECRET before running.
-- =====================================================================

-- New email type.
alter table email_log drop constraint if exists email_log_kind_check;
alter table email_log add constraint email_log_kind_check
  check (kind in ('reminder_24h','reminder_1h','results','reveal'));

-- ---------------------------------------------------------------------
-- BUG FIX: being the league admin does not mean you are not playing.
-- The original filters excluded admins from every email, which meant
-- Donnacha would have received none of them despite being on the
-- leaderboard. The right exclusion is the bot, not the admin.
-- ---------------------------------------------------------------------
create or replace function league_emails()
returns table (user_id uuid, email text, display_name text, email_optin boolean)
language sql security definer set search_path = public as $$
  select p.id, u.email::text, p.display_name, p.email_optin
    from profiles p join auth.users u on u.id = p.id
   where not p.is_bot and p.is_active and u.email is not null;
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
  where p.email_optin and p.is_active and not p.is_bot
    and u.email is not null
    and (coalesce(pc.n, 0) < (select count(*) from fixtures f where f.gameweek = p_gameweek and not f.postponed)
         or e.captain_fixture is null)
    and not exists (select 1 from email_log l
                     where l.user_id = p.id and l.gameweek = p_gameweek and l.kind = p_kind);
$$;

-- ---------------------------------------------------------------------
-- Who gets the reveal.
--
-- ONLY players whose entry is complete — all fixtures predicted and a captain
-- set. Anyone still deciding does not receive it, because at 19:30 captains
-- are not locked yet and seeing the field would be an edge. They are getting
-- the one-hour reminder instead.
-- ---------------------------------------------------------------------
create or replace function reveal_targets(p_gameweek int)
returns table (user_id uuid, email text, display_name text)
language sql security definer set search_path = public as $$
  select p.id, u.email::text, p.display_name
    from profiles p
    join auth.users u on u.id = p.id
    join entries e on e.user_id = p.id and e.gameweek = p_gameweek
   where p.email_optin and p.is_active and not p.is_bot
     and u.email is not null
     and e.captain_fixture is not null
     and (select count(*) from predictions pr
           where pr.user_id = p.id and pr.gameweek = p_gameweek)
         = (select count(*) from fixtures f
             where f.gameweek = p_gameweek and not f.postponed)
     and not exists (select 1 from email_log l
                      where l.user_id = p.id and l.gameweek = p_gameweek and l.kind = 'reveal');
$$;

-- Every submitted prediction for the gameweek, with who made it and whether
-- it was their captain. The bot is included — it is playing too.
create or replace function reveal_data(p_gameweek int)
returns table (
  fixture_id int, kickoff timestamptz,
  home_name text, away_name text, home_code int, away_code int,
  user_id uuid, display_name text, is_bot boolean,
  home_score int, away_score int, is_captain boolean
)
language sql security definer set search_path = public as $$
  select f.id, f.kickoff,
         ht.name, at.name, ht.code, at.code,
         p.user_id, pr.display_name, pr.is_bot,
         p.home_score, p.away_score,
         coalesce(e.captain_fixture = f.id, false)
    from predictions p
    join fixtures f on f.id = p.fixture_id
    join teams ht on ht.id = f.home_team
    join teams at on at.id = f.away_team
    join profiles pr on pr.id = p.user_id
    left join entries e on e.user_id = p.user_id and e.gameweek = p.gameweek
   where p.gameweek = p_gameweek
     and not f.postponed
     and pr.is_active
   order by f.kickoff, p.home_score desc, p.away_score, pr.display_name;
$$;

revoke all on function reveal_targets(int) from public;
revoke all on function reveal_data(int) from public;

-- ---------------------------------------------------------------------
-- Schedule: every 5 minutes. The route only acts inside the final 30
-- minutes before a deadline, so it fires at :30 for an 8pm kickoff.
-- ---------------------------------------------------------------------
select cron.unschedule('tfk-send-reveal') where exists (
  select 1 from cron.job where jobname = 'tfk-send-reveal');

select cron.schedule(
  'tfk-send-reveal',
  '*/5 * * * *',
  $$
  select net.http_get(
    url := 'https://YOUR_DOMAIN/api/cron/send-reveal?secret=YOUR_CRON_SECRET',
    timeout_milliseconds := 45000
  );
  $$
);
