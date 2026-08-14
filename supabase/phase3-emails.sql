-- =====================================================================
-- TFK PREDICTIONS LEAGUE — Phase 3, part 1: reminder emails
-- Run once in the Supabase SQL Editor. Idempotent.
-- Requires Phase 1 (schema.sql) and Phase 2 (phase2.sql).
-- =====================================================================

-- ------------------------------------------------------------ email_log
-- One row per player, per gameweek, per email type. The primary key is what
-- makes a double-send impossible: a retry after a timeout hits the conflict
-- and does nothing, rather than emailing someone the same reminder twice.
create table if not exists email_log (
  user_id   uuid not null references profiles(id) on delete cascade,
  gameweek  int  not null references gameweeks(id) on delete cascade,
  kind      text not null check (kind in ('reminder_24h','reminder_1h','results')),
  sent_at   timestamptz not null default now(),
  provider_id text,
  primary key (user_id, gameweek, kind)
);
create index if not exists email_log_sent_idx on email_log (sent_at desc);

alter table email_log enable row level security;
drop policy if exists email_log_read_own on email_log;
create policy email_log_read_own on email_log
  for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- Everything the reminder job needs, in one read: who to email, what is
-- outstanding, and where they stand. Called with the service role, so it
-- deliberately bypasses RLS.
-- ---------------------------------------------------------------------
create or replace function reminder_targets(p_gameweek int, p_kind text)
returns table (
  user_id       uuid,
  email         text,
  display_name  text,
  picks_made    int,
  fixtures_total int,
  captain_set   boolean
)
language sql security definer set search_path = public as $$
  select
    p.id,
    u.email::text,
    p.display_name,
    coalesce(pc.n, 0)::int as picks_made,
    (select count(*) from fixtures f where f.gameweek = p_gameweek and not f.postponed)::int,
    coalesce(e.captain_fixture is not null, false)
  from profiles p
  join auth.users u on u.id = p.id
  left join entries e on e.user_id = p.id and e.gameweek = p_gameweek
  left join (
    select pr.user_id, count(*) as n
      from predictions pr
     where pr.gameweek = p_gameweek
     group by pr.user_id
  ) pc on pc.user_id = p.id
  where p.email_optin
    and not p.is_admin
    and u.email is not null
    -- only chase people who have not finished: missing picks, or no captain
    and (
      coalesce(pc.n, 0) < (select count(*) from fixtures f where f.gameweek = p_gameweek and not f.postponed)
      or e.captain_fixture is null
    )
    -- and who have not already had this exact email for this gameweek
    and not exists (
      select 1 from email_log l
       where l.user_id = p.id and l.gameweek = p_gameweek and l.kind = p_kind
    );
$$;

revoke all on function reminder_targets(int, text) from public;

-- ---------------------------------------------------------------------
-- Schedule. Runs every 10 minutes; the route itself decides whether any
-- gameweek is currently inside a send window, so most runs do nothing.
-- Replace YOUR_DOMAIN and YOUR_CRON_SECRET before running.
-- ---------------------------------------------------------------------
select cron.unschedule('tfk-send-reminders') where exists (
  select 1 from cron.job where jobname = 'tfk-send-reminders');

select cron.schedule(
  'tfk-send-reminders',
  '*/10 * * * *',
  $$
  select net.http_get(
    url := 'https://YOUR_DOMAIN/api/cron/send-reminders?secret=YOUR_CRON_SECRET',
    timeout_milliseconds := 30000
  );
  $$
);

-- Checks:
--   select jobname, schedule, active from cron.job;
--   select kind, count(*), max(sent_at) from email_log group by kind;
