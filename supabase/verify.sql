-- =====================================================================
-- TFK PREDICTIONS — verification queries
-- Run these in the Supabase SQL Editor after each setup step.
-- =====================================================================

-- ---------------------------------------------------------------------
-- CHECK 1 — run straight after schema.sql.
-- Every row should show found = expected.
-- ---------------------------------------------------------------------
select 'tables'               as check, count(*)::text as found, '6' as expected
  from information_schema.tables
 where table_schema = 'public'
   and table_name in ('teams','gameweeks','fixtures','profiles','entries','predictions')
union all
select 'view fixture_board', count(*)::text, '1'
  from information_schema.views
 where table_schema = 'public' and table_name = 'fixture_board'
union all
select 'lock functions', count(*)::text, '3'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('save_prediction','set_captain','handle_new_user')
union all
select 'RLS policies', count(*)::text, '7'
  from pg_policies where schemaname = 'public'
union all
select 'signup trigger', count(*)::text, '1'
  from pg_trigger where tgname = 'on_auth_user_created'
union all
select 'RLS enabled on all 6', count(*)::text, '6'
  from pg_tables
 where schemaname = 'public' and rowsecurity = true
   and tablename in ('teams','gameweeks','fixtures','profiles','entries','predictions');


-- ---------------------------------------------------------------------
-- CHECK 2 — run after the first fixture sync.
-- Expect: 20 clubs, 38 gameweeks, 380 fixtures.
-- GW1 deadline should be 2026-08-21 19:00 UTC (20:00 BST, Arsenal v Coventry).
-- ---------------------------------------------------------------------
select
  (select count(*) from teams)     as clubs,
  (select count(*) from gameweeks) as gameweeks,
  (select count(*) from fixtures)  as fixtures,
  (select deadline from gameweeks where id = 1) as gw1_deadline_utc;


-- ---------------------------------------------------------------------
-- CHECK 3 — the monthly prize map. Expect exactly 10 rows,
-- and the gameweeks column should sum to 38.
-- October should show 4 gameweeks (GW6-9): GW9 opens 31 Oct and
-- finishes 2 Nov, and the whole week counts towards October.
-- ---------------------------------------------------------------------
select month_key,
       count(*)  as gameweeks,
       min(id)   as first_gw,
       max(id)   as last_gw,
       min(deadline) as month_opens_utc
  from gameweeks
 group by month_key
 order by month_key;


-- ---------------------------------------------------------------------
-- CHECK 4 — GW1 fixtures, to eyeball against the real fixture list.
-- ---------------------------------------------------------------------
select f.kickoff, ht.name as home, at.name as away
  from fixtures f
  join teams ht on ht.id = f.home_team
  join teams at on at.id = f.away_team
 where f.gameweek = 1
 order by f.kickoff;


-- ---------------------------------------------------------------------
-- Make yourself an admin. Register through the app FIRST, then run this.
-- ---------------------------------------------------------------------
-- update profiles set is_admin = true
--  where id = (select id from auth.users where email = 'you@yourdomain.com');
