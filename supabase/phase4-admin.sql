-- =====================================================================
-- TFK PREDICTIONS LEAGUE — Phase 4: admin panel
-- Run once in the Supabase SQL Editor. Idempotent.
-- Requires phases 1-3.
-- =====================================================================

-- Deactivated players keep their history and points but cannot sign in and
-- stop receiving email. Deleting someone mid-season would silently rewrite
-- months they might have won, so this is the softer option.
alter table profiles add column if not exists is_active boolean not null default true;

-- ---------------------------------------------------------------------
-- The guard. Every admin function checks this, so the database enforces
-- permissions rather than trusting the UI to hide a button.
-- ---------------------------------------------------------------------
create or replace function is_league_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_admin from profiles p where p.id = auth.uid()), false);
$$;
grant execute on function is_league_admin() to authenticated;

create or replace function assert_admin() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_league_admin() then
    raise exception 'Admins only.' using errcode = '42501';
  end if;
end $$;

-- Admins can edit any profile (deactivate, rename, promote).
drop policy if exists profiles_admin_update on profiles;
create policy profiles_admin_update on profiles for update to authenticated
  using (is_league_admin()) with check (is_league_admin());

-- ---------------------------------------------------------------------
-- Manual result entry — the failsafe for when the feed is wrong or late.
-- Setting a score marks the fixture finished. Passing p_postponed voids it.
-- ---------------------------------------------------------------------
create or replace function admin_set_result(
  p_fixture int,
  p_home int,
  p_away int,
  p_postponed boolean default false
) returns void language plpgsql security definer set search_path = public as $$
begin
  perform assert_admin();

  if p_postponed then
    update fixtures
       set postponed = true, finished = false,
           home_score = null, away_score = null, updated_at = now()
     where id = p_fixture;
    -- A void fixture scores nothing for anyone.
    delete from scores where fixture_id = p_fixture;
    return;
  end if;

  if p_home is null or p_away is null or p_home < 0 or p_home > 20 or p_away < 0 or p_away > 20 then
    raise exception 'Scores must be between 0 and 20.' using errcode = '22003';
  end if;

  update fixtures
     set home_score = p_home, away_score = p_away,
         finished = true, postponed = false, updated_at = now()
   where id = p_fixture;
end $$;

-- ---------------------------------------------------------------------
-- Re-score a gameweek. This is the other half of manual result entry:
-- correcting a scoreline after a gameweek has published does NOT recompute
-- the points on its own, so this must be run afterwards.
-- Returns the number of score rows written.
-- ---------------------------------------------------------------------
create or replace function admin_rescore_gameweek(p_gameweek int)
returns int language plpgsql security definer set search_path = public as $$
declare v_rows int;
begin
  perform assert_admin();
  -- Clear first so a fixture that became void leaves no stale points behind.
  delete from scores where gameweek = p_gameweek;
  v_rows := score_gameweek(p_gameweek);
  return v_rows;
end $$;

create or replace function admin_set_gameweek_status(p_gameweek int, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform assert_admin();
  if p_status not in ('upcoming','open','locked','scored','published') then
    raise exception 'Unknown status.' using errcode = '22023';
  end if;
  update gameweeks set status = p_status, updated_at = now() where id = p_gameweek;
end $$;

-- ---------------------------------------------------------------------
-- Players
-- ---------------------------------------------------------------------
create or replace function admin_set_user_active(p_user uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform assert_admin();
  if p_user = auth.uid() and not p_active then
    raise exception 'You cannot deactivate yourself.' using errcode = '42501';
  end if;
  update profiles set is_active = p_active where id = p_user;
end $$;

create or replace function admin_players()
returns table (
  user_id uuid, email text, display_name text,
  is_admin boolean, is_active boolean, email_optin boolean,
  joined timestamptz,
  gameweeks_entered int, predictions_made int, season_points int
)
language plpgsql security definer set search_path = public as $$
begin
  perform assert_admin();
  return query
    select p.id, u.email::text, p.display_name,
           p.is_admin, p.is_active, p.email_optin, p.created_at,
           (select count(distinct e.gameweek) from entries e where e.user_id = p.id)::int,
           (select count(*) from predictions pr where pr.user_id = p.id)::int,
           coalesce((select sum(s.points) from scores s where s.user_id = p.id), 0)::int
      from profiles p
      join auth.users u on u.id = p.id
     order by p.is_active desc, p.display_name;
end $$;

-- ---------------------------------------------------------------------
-- Who still needs chasing for a given gameweek.
-- ---------------------------------------------------------------------
create or replace function admin_outstanding(p_gameweek int)
returns table (display_name text, email text, picks_made int, captain_set boolean)
language plpgsql security definer set search_path = public as $$
begin
  perform assert_admin();
  return query
    select p.display_name, u.email::text,
           coalesce((select count(*) from predictions pr
                      where pr.user_id = p.id and pr.gameweek = p_gameweek), 0)::int,
           coalesce((select e.captain_fixture is not null from entries e
                      where e.user_id = p.id and e.gameweek = p_gameweek), false)
      from profiles p
      join auth.users u on u.id = p.id
     where p.is_active and not p.is_admin
     order by 3 asc, p.display_name;
end $$;

-- ---------------------------------------------------------------------
-- Operational status, so "did the job run?" is a glance not a query.
-- ---------------------------------------------------------------------
create or replace function admin_job_status()
returns table (jobname text, schedule text, active boolean,
               last_run timestamptz, last_status text)
language plpgsql security definer set search_path = public as $$
begin
  perform assert_admin();
  return query
    select j.jobname::text, j.schedule::text, j.active,
           r.start_time, r.status::text
      from cron.job j
      left join lateral (
        select d.start_time, d.status
          from cron.job_run_details d
         where d.jobid = j.jobid
         order by d.start_time desc
         limit 1
      ) r on true
     order by j.jobid;
end $$;

create or replace function admin_email_summary()
returns table (kind text, gameweek int, sent int, last_sent timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  perform assert_admin();
  return query
    select l.kind, l.gameweek, count(*)::int, max(l.sent_at)
      from email_log l
     group by l.kind, l.gameweek
     order by l.gameweek desc, l.kind;
end $$;

create or replace function admin_recent_emails(p_limit int default 25)
returns table (provider_id text, kind text, gameweek int, display_name text, sent_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  perform assert_admin();
  return query
    select l.provider_id, l.kind, l.gameweek, p.display_name, l.sent_at
      from email_log l
      join profiles p on p.id = l.user_id
     order by l.sent_at desc
     limit greatest(1, least(p_limit, 100));
end $$;

-- Deactivated players stop receiving email.
create or replace function league_emails()
returns table (user_id uuid, email text, display_name text, email_optin boolean)
language sql security definer set search_path = public as $$
  select p.id, u.email::text, p.display_name, p.email_optin
    from profiles p join auth.users u on u.id = p.id
   where not p.is_admin and p.is_active and u.email is not null;
$$;

revoke all on function assert_admin() from public;
grant execute on function admin_set_result(int,int,int,boolean)  to authenticated;
grant execute on function admin_rescore_gameweek(int)            to authenticated;
grant execute on function admin_set_gameweek_status(int,text)    to authenticated;
grant execute on function admin_set_user_active(uuid,boolean)    to authenticated;
grant execute on function admin_players()                        to authenticated;
grant execute on function admin_outstanding(int)                 to authenticated;
grant execute on function admin_job_status()                     to authenticated;
grant execute on function admin_email_summary()                  to authenticated;
grant execute on function admin_recent_emails(int)               to authenticated;

-- Deactivated players are not chased for predictions either.
create or replace function reminder_targets(p_gameweek int, p_kind text)
returns table (
  user_id uuid, email text, display_name text,
  picks_made int, fixtures_total int, captain_set boolean
)
language sql security definer set search_path = public as $$
  select
    p.id, u.email::text, p.display_name,
    coalesce(pc.n, 0)::int,
    (select count(*) from fixtures f where f.gameweek = p_gameweek and not f.postponed)::int,
    coalesce(e.captain_fixture is not null, false)
  from profiles p
  join auth.users u on u.id = p.id
  left join entries e on e.user_id = p.id and e.gameweek = p_gameweek
  left join (
    select pr.user_id, count(*) as n from predictions pr
     where pr.gameweek = p_gameweek group by pr.user_id
  ) pc on pc.user_id = p.id
  where p.email_optin
    and p.is_active
    and not p.is_admin
    and u.email is not null
    and (
      coalesce(pc.n, 0) < (select count(*) from fixtures f where f.gameweek = p_gameweek and not f.postponed)
      or e.captain_fixture is null
    )
    and not exists (
      select 1 from email_log l
       where l.user_id = p.id and l.gameweek = p_gameweek and l.kind = p_kind
    );
$$;

-- Safety net: make sure you are an admin and active.
update profiles set is_admin = true, is_active = true
 where id = (select id from auth.users where email = 'dunta1307@gmail.com');
