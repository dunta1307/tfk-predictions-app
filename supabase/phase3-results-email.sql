-- =====================================================================
-- TFK PREDICTIONS LEAGUE — Phase 3, part 2: the results round-up email
-- Run once in the Supabase SQL Editor. Requires phase3-emails.sql.
-- =====================================================================

-- Everyone in the league with an email, for the round-up. Unlike the
-- reminders this goes to all opted-in players, not just the stragglers.
create or replace function league_emails()
returns table (user_id uuid, email text, display_name text, email_optin boolean)
language sql security definer set search_path = public as $$
  select p.id, u.email::text, p.display_name, p.email_optin
    from profiles p
    join auth.users u on u.id = p.id
   where not p.is_admin
     and u.email is not null;
$$;
revoke all on function league_emails() from public;

-- Which published gameweeks still owe people a round-up.
create or replace function gameweeks_awaiting_results_email()
returns table (gameweek int, month_key text, unsent int)
language sql security definer set search_path = public as $$
  select
    g.id,
    g.month_key,
    (select count(*) from profiles p
      where p.email_optin and not p.is_admin
        and not exists (
          select 1 from email_log l
           where l.user_id = p.id and l.gameweek = g.id and l.kind = 'results'))::int
  from gameweeks g
 where g.status = 'published'
 order by g.id;
$$;
revoke all on function gameweeks_awaiting_results_email() from public;

-- ---------------------------------------------------------------------
-- Schedule: every 10 minutes, offset from the results poller so it runs
-- just after scoring rather than racing it.
-- Replace YOUR_DOMAIN and YOUR_CRON_SECRET before running.
-- ---------------------------------------------------------------------
select cron.unschedule('tfk-send-results') where exists (
  select 1 from cron.job where jobname = 'tfk-send-results');

select cron.schedule(
  'tfk-send-results',
  '5-59/10 * * * *',
  $$
  select net.http_get(
    url := 'https://YOUR_DOMAIN/api/cron/send-results?secret=YOUR_CRON_SECRET',
    timeout_milliseconds := 45000
  );
  $$
);

-- Checks:
--   select * from gameweeks_awaiting_results_email();
--   select kind, gameweek, count(*) from email_log group by kind, gameweek order by gameweek;
