-- =====================================================================
-- TFK PREDICTIONS LEAGUE — Phase 1 schema
-- Run this once in the Supabase SQL Editor (Database -> SQL Editor -> New query).
-- Safe to re-run: everything is idempotent.
-- =====================================================================

-- ---------------------------------------------------------------- teams
create table if not exists teams (
  id          int primary key,          -- FPL team id (1-20, reassigned each season)
  code        int not null,             -- Premier League club code — drives the crest URL
  name        text not null,
  short_name  text not null,
  updated_at  timestamptz not null default now()
);

-- ----------------------------------------------------------- gameweeks
create table if not exists gameweeks (
  id            int primary key,          -- 1..38
  deadline      timestamptz not null,     -- FIRST KICKOFF of the gameweek — our deadline
  fpl_deadline  timestamptz,              -- FPL's own deadline (90 min earlier), for reference
  month_key     text not null,            -- '2026-10' — the month this GW's prize counts towards
  status        text not null default 'upcoming'
                check (status in ('upcoming','open','locked','scored','published')),
  updated_at    timestamptz not null default now()
);

-- ------------------------------------------------------------ fixtures
create table if not exists fixtures (
  id          int primary key,            -- FPL fixture id
  gameweek    int not null references gameweeks(id) on delete cascade,
  kickoff     timestamptz not null,
  home_team   int not null references teams(id),
  away_team   int not null references teams(id),
  home_score  int,
  away_score  int,
  finished    boolean not null default false,
  postponed   boolean not null default false,
  updated_at  timestamptz not null default now()
);
create index if not exists fixtures_gw_idx on fixtures (gameweek, kickoff);

-- ------------------------------------------------------------ profiles
create table if not exists profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  email_optin  boolean not null default true,
  is_admin     boolean not null default false,
  created_at   timestamptz not null default now()
);

-- Create a profile row automatically whenever someone signs up.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, email_optin)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''), split_part(new.email,'@',1)),
    coalesce((new.raw_user_meta_data->>'email_optin')::boolean, true)
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ------------------------------------------------------------- entries
-- One row per player per gameweek. Holds the captain pick.
create table if not exists entries (
  user_id         uuid not null references profiles(id) on delete cascade,
  gameweek        int  not null references gameweeks(id) on delete cascade,
  captain_fixture int  references fixtures(id),
  captain_set_at  timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (user_id, gameweek)
);

-- --------------------------------------------------------- predictions
-- created_at is load-bearing: it is what decides whether a pick was made
-- before the gameweek deadline, which drives the late-entry rule below.
create table if not exists predictions (
  user_id     uuid not null references profiles(id) on delete cascade,
  fixture_id  int  not null references fixtures(id) on delete cascade,
  gameweek    int  not null references gameweeks(id) on delete cascade,
  home_score  int  not null check (home_score between 0 and 20),
  away_score  int  not null check (away_score between 0 and 20),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, fixture_id)
);
create index if not exists predictions_gw_idx on predictions (gameweek, user_id);

-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================
alter table teams       enable row level security;
alter table gameweeks   enable row level security;
alter table fixtures    enable row level security;
alter table profiles    enable row level security;
alter table entries     enable row level security;
alter table predictions enable row level security;

-- Reference data: readable by any signed-in user, writable only by the
-- service role (the sync job), which bypasses RLS entirely.
drop policy if exists teams_read on teams;
create policy teams_read on teams for select to authenticated using (true);
drop policy if exists gameweeks_read on gameweeks;
create policy gameweeks_read on gameweeks for select to authenticated using (true);
drop policy if exists fixtures_read on fixtures;
create policy fixtures_read on fixtures for select to authenticated using (true);

-- Profiles: everyone can see display names (the leaderboard needs them).
-- You can only edit your own.
drop policy if exists profiles_read on profiles;
create policy profiles_read on profiles for select to authenticated using (true);
drop policy if exists profiles_update_own on profiles;
create policy profiles_update_own on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Entries: you always see your own. You see other people's only once the
-- gameweek deadline has passed — so nobody can peek at captains early.
drop policy if exists entries_read on entries;
create policy entries_read on entries for select to authenticated using (
  user_id = auth.uid()
  or exists (select 1 from gameweeks g where g.id = entries.gameweek and now() >= g.deadline)
);

-- Predictions: same visibility rule.
drop policy if exists predictions_read on predictions;
create policy predictions_read on predictions for select to authenticated using (
  user_id = auth.uid()
  or exists (select 1 from gameweeks g where g.id = predictions.gameweek and now() >= g.deadline)
);

-- No direct writes to entries or predictions from the client. All writes go
-- through the functions below, which enforce the lock rules. This means a
-- tampered browser cannot save a late prediction.

-- =====================================================================
-- WRITE FUNCTIONS — these are where the deadline rules actually live
-- =====================================================================

-- THE LOCK RULES
--   1. Before the gameweek deadline (= first kickoff): everything is editable.
--   2. After the deadline, a fixture is editable only if BOTH:
--        a. you had NOT already saved a pick for it before the deadline, and
--        b. it has not kicked off yet.
--      So a player who forgot entirely can still fill in the later games,
--      but nobody can revise a pick they had already committed.
--   3. The captain locks hard at the gameweek deadline. Miss it and you play
--      the week without one — this is what stops a late entrant captaining a
--      Sunday game after watching Saturday's results.

create or replace function save_prediction(p_fixture int, p_home int, p_away int)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user      uuid := auth.uid();
  v_gw        int;
  v_kickoff   timestamptz;
  v_deadline  timestamptz;
  v_postponed boolean;
  v_existing  timestamptz;
begin
  if v_user is null then
    raise exception 'You must be signed in.' using errcode = '28000';
  end if;
  if p_home is null or p_away is null or p_home < 0 or p_home > 20 or p_away < 0 or p_away > 20 then
    raise exception 'Scores must be between 0 and 20.' using errcode = '22003';
  end if;

  select f.gameweek, f.kickoff, f.postponed
    into v_gw, v_kickoff, v_postponed
    from fixtures f where f.id = p_fixture;
  if v_gw is null then
    raise exception 'Unknown fixture.' using errcode = '23503';
  end if;
  if v_postponed then
    raise exception 'That fixture has been postponed.' using errcode = '22023';
  end if;

  select g.deadline into v_deadline from gameweeks g where g.id = v_gw;

  select p.created_at into v_existing
    from predictions p where p.user_id = v_user and p.fixture_id = p_fixture;

  if now() >= v_deadline then
    if v_existing is not null and v_existing < v_deadline then
      raise exception 'This prediction locked at the Gameweek deadline.' using errcode = '22023';
    end if;
    if now() >= v_kickoff then
      raise exception 'That fixture has already kicked off.' using errcode = '22023';
    end if;
  end if;

  insert into entries (user_id, gameweek) values (v_user, v_gw)
    on conflict (user_id, gameweek) do update set updated_at = now();

  insert into predictions (user_id, fixture_id, gameweek, home_score, away_score)
  values (v_user, p_fixture, v_gw, p_home, p_away)
  on conflict (user_id, fixture_id) do update
    set home_score = excluded.home_score,
        away_score = excluded.away_score,
        updated_at = now();
end $$;

create or replace function set_captain(p_gameweek int, p_fixture int)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user     uuid := auth.uid();
  v_deadline timestamptz;
  v_fx_gw    int;
begin
  if v_user is null then
    raise exception 'You must be signed in.' using errcode = '28000';
  end if;

  select g.deadline into v_deadline from gameweeks g where g.id = p_gameweek;
  if v_deadline is null then
    raise exception 'Unknown Gameweek.' using errcode = '23503';
  end if;
  if now() >= v_deadline then
    raise exception 'The Captain locked at the Gameweek deadline.' using errcode = '22023';
  end if;

  if p_fixture is not null then
    select f.gameweek into v_fx_gw from fixtures f where f.id = p_fixture;
    if v_fx_gw is distinct from p_gameweek then
      raise exception 'That fixture is not in this Gameweek.' using errcode = '22023';
    end if;
  end if;

  insert into entries (user_id, gameweek, captain_fixture, captain_set_at)
  values (v_user, p_gameweek, p_fixture, now())
  on conflict (user_id, gameweek) do update
    set captain_fixture = excluded.captain_fixture,
        captain_set_at  = now(),
        updated_at      = now();
end $$;

revoke all on function save_prediction(int,int,int) from public;
revoke all on function set_captain(int,int) from public;
grant execute on function save_prediction(int,int,int) to authenticated;
grant execute on function set_captain(int,int) to authenticated;

-- =====================================================================
-- Convenience view: everything the predictions page needs in one read
-- =====================================================================
create or replace view fixture_board
with (security_invoker = true) as
select
  f.id, f.gameweek, f.kickoff, f.postponed, f.finished,
  f.home_score, f.away_score,
  ht.name as home_name, ht.short_name as home_short, ht.code as home_code,
  at.name as away_name, at.short_name as away_short, at.code as away_code,
  g.deadline, g.month_key
from fixtures f
join teams ht on ht.id = f.home_team
join teams at on at.id = f.away_team
join gameweeks g on g.id = f.gameweek;

-- =====================================================================
-- Make yourself an admin AFTER you have registered through the app:
--   update profiles set is_admin = true where id =
--     (select id from auth.users where email = 'you@yourdomain.com');
-- =====================================================================
