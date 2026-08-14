-- =====================================================================
-- TFK PREDICTIONS — scheduling
--
-- Vercel's Hobby plan only allows cron jobs that run ONCE PER DAY. Anything
-- more frequent fails at deploy time. Results need checking every few minutes
-- during a match window, so the schedule lives in Postgres instead, using
-- pg_cron and pg_net — both free on every Supabase plan.
--
-- BEFORE RUNNING: replace YOUR_DOMAIN and YOUR_CRON_SECRET below.
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Clear any previous versions so this file is safe to re-run.
select cron.unschedule('tfk-sync-results') where exists (
  select 1 from cron.job where jobname = 'tfk-sync-results');
select cron.unschedule('tfk-sync-fixtures') where exists (
  select 1 from cron.job where jobname = 'tfk-sync-fixtures');

-- ---------------------------------------------------------------------
-- Results: every 10 minutes. Cheap when nothing is happening — it reads the
-- feed, finds nothing new, and stops. Scoring is idempotent, so a repeat run
-- produces identical rows.
-- ---------------------------------------------------------------------
select cron.schedule(
  'tfk-sync-results',
  '*/10 * * * *',
  $$
  select net.http_get(
    url := 'https://YOUR_DOMAIN/api/cron/sync-results?secret=YOUR_CRON_SECRET',
    timeout_milliseconds := 30000
  );
  $$
);

-- ---------------------------------------------------------------------
-- Fixtures: nightly at 04:10 UTC. Must be nightly rather than one-off,
-- because TV picks move kickoff times — and since the deadline IS the first
-- kickoff, a moved fixture moves the deadline with it.
-- ---------------------------------------------------------------------
select cron.schedule(
  'tfk-sync-fixtures',
  '10 4 * * *',
  $$
  select net.http_get(
    url := 'https://YOUR_DOMAIN/api/cron/sync-fixtures?secret=YOUR_CRON_SECRET',
    timeout_milliseconds := 30000
  );
  $$
);

-- ---------------------------------------------------------------------
-- Checks
-- ---------------------------------------------------------------------
-- What is scheduled:
--   select jobid, jobname, schedule, active from cron.job;
--
-- Did the last few runs succeed:
--   select j.jobname, r.status, r.start_time, r.return_message
--     from cron.job_run_details r join cron.job j on j.jobid = r.jobid
--    order by r.start_time desc limit 20;
--
-- Did the HTTP calls come back 200:
--   select id, status_code, created from net._http_response order by created desc limit 20;
