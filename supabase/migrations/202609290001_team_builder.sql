-- Run this entire file in the Supabase SQL Editor. Safe to rerun; existing
-- assignments and claims are never reset. No passwords or keys belong here.
begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 64),
  title text not null check (length(btrim(title)) between 1 and 100),
  team_count integer not null default 7 check (team_count between 1 and 50),
  is_open boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.teams (
  event_id uuid not null references public.events(id) on delete cascade,
  team_number integer not null check (team_number between 1 and 50),
  primary key (event_id, team_number)
);

create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  first_name text not null check (length(btrim(first_name)) between 1 and 100),
  last_name text not null default '' check (length(last_name) <= 100),
  team_number integer,
  team_slot integer,
  claimed_by uuid references auth.users(id) on delete set null,
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  version integer not null default 1,
  foreign key (event_id, team_number) references public.teams(event_id, team_number),
  constraint valid_team_slot check (
    (team_number is null and team_slot is null and joined_at is null) or
    (team_number is not null and team_slot is not null and team_slot between 1 and 3 and joined_at is not null)
  ),
  -- Three possible slots + uniqueness is a hard database-level capacity cap.
  constraint one_person_per_slot unique (event_id, team_number, team_slot)
);
create unique index if not exists one_claim_per_event
  on public.participants(event_id, claimed_by) where claimed_by is not null;
create unique index if not exists unique_name_per_event
  on public.participants(event_id, lower(btrim(first_name || ' ' || last_name)));

create or replace function private.bump_participant_version()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.version := old.version + 1;
  return new;
end;
$$;
drop trigger if exists participant_version on public.participants;
create trigger participant_version before update on public.participants
for each row execute function private.bump_participant_version();

alter table public.events enable row level security;
alter table public.teams enable row level security;
alter table public.participants enable row level security;
revoke all on public.events, public.teams, public.participants from anon, authenticated;
grant select on public.events, public.teams, public.participants to anon, authenticated;
grant all on public.events, public.teams, public.participants to service_role;
drop policy if exists public_read_events on public.events;
create policy public_read_events on public.events for select to anon, authenticated using (true);
drop policy if exists public_read_teams on public.teams;
create policy public_read_teams on public.teams for select to anon, authenticated using (true);
drop policy if exists public_read_participants on public.participants;
create policy public_read_participants on public.participants for select to anon, authenticated using (true);
-- Deliberately no INSERT/UPDATE/DELETE policies for visitors. All changes use
-- narrowly granted RPCs; user IDs always come from the verified auth.uid().

create or replace function public.claim_participant(p_participant_id uuid)
returns public.participants language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_event uuid;
  v_open boolean;
  v_person public.participants;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select event_id into v_event from public.participants where id = p_participant_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  -- SHARE also makes closing the event serialize with in-flight claims/moves.
  select is_open into v_open from public.events where id = v_event for share;
  if not v_open then raise exception 'EVENT_CLOSED'; end if;
  select * into v_person from public.participants where id = p_participant_id for update;
  if v_person.claimed_by = v_uid then return v_person; end if;
  if v_person.claimed_by is not null then raise exception 'ALREADY_CLAIMED'; end if;
  if exists (select 1 from public.participants where event_id = v_event and claimed_by = v_uid) then
    raise exception 'USER_ALREADY_CLAIMED';
  end if;
  begin
    update public.participants set claimed_by = v_uid where id = p_participant_id returning * into v_person;
  exception when unique_violation then
    -- Handles two tabs of the SAME user claiming different names simultaneously.
    raise exception 'USER_ALREADY_CLAIMED';
  end;
  return v_person;
end;
$$;

create or replace function public.move_participant(p_participant_id uuid, p_team_number integer)
returns public.participants language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_event uuid;
  v_open boolean;
  v_person public.participants;
  v_slot integer;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select event_id into v_event from public.participants where id = p_participant_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  select is_open into v_open from public.events where id = v_event for share;
  if not v_open then raise exception 'EVENT_CLOSED'; end if;
  select * into v_person from public.participants where id = p_participant_id for update;
  if v_person.claimed_by is distinct from v_uid then raise exception 'NOT_OWNER'; end if;
  if p_team_number is not null then
    -- Only the destination is locked. NO KEY UPDATE is compatible with the
    -- FK's KEY SHARE lock, so simultaneous team swaps do not deadlock.
    perform 1 from public.teams where event_id = v_event and team_number = p_team_number for no key update;
    if not found then raise exception 'INVALID_TEAM'; end if;
  end if;
  if v_person.team_number is not distinct from p_team_number then return v_person; end if;
  if p_team_number is not null then
    -- VOLATILE PL/pgSQL gets a fresh READ COMMITTED snapshot after waiting
    -- for the team lock. No JavaScript count can authorize this operation.
    if (select count(*) from public.participants where event_id = v_event and team_number = p_team_number) >= 3 then
      raise exception 'TEAM_FULL';
    end if;
    select s into v_slot from generate_series(1, 3) s where not exists (
      select 1 from public.participants p where p.event_id = v_event and p.team_number = p_team_number and p.team_slot = s
    ) order by s limit 1;
    if v_slot is null then raise exception 'TEAM_FULL'; end if;
  end if;
  update public.participants set
    team_number = p_team_number, team_slot = v_slot,
    joined_at = case when p_team_number is null then null else clock_timestamp() end
  where id = p_participant_id returning * into v_person;
  return v_person;
end;
$$;
revoke all on function public.claim_participant(uuid), public.move_participant(uuid, integer) from public, anon;
grant execute on function public.claim_participant(uuid), public.move_participant(uuid, integer) to authenticated;

-- Admin RPCs are callable ONLY with the server's secret/service_role key.
-- The Next.js endpoints verify the password session before using that key.
create or replace function public.admin_add_participants(p_event_id uuid, p_names text[])
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
  v_first text;
  v_last text;
begin
  perform 1 from public.events where id = p_event_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_names is null or cardinality(p_names) < 1 or cardinality(p_names) > 500 then raise exception 'INVALID_NAMES'; end if;
  if (select count(*) from public.participants where event_id = p_event_id) + cardinality(p_names) > 500 then
    raise exception 'EVENT_LIMIT';
  end if;
  foreach v_name in array p_names loop
    v_name := btrim(regexp_replace(v_name, '\s+', ' ', 'g'));
    if v_name is null or length(v_name) not between 1 and 100 then raise exception 'INVALID_NAMES'; end if;
    v_first := split_part(v_name, ' ', 1);
    v_last := btrim(substr(v_name, length(v_first) + 1));
    begin
      insert into public.participants(event_id, first_name, last_name) values (p_event_id, v_first, v_last);
    exception when unique_violation then raise exception 'DUPLICATE_NAME';
    end;
  end loop;
  return cardinality(p_names);
end;
$$;

create or replace function public.admin_create_event(p_title text, p_slug text, p_team_count integer, p_names text[])
returns public.events language plpgsql security definer set search_path = '' as $$
declare v_event public.events;
begin
  if p_title is null or length(btrim(p_title)) not between 1 and 100
    or p_slug is null or length(p_slug) not between 3 and 64 or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    or p_team_count is null or p_team_count not between 1 and 50 then raise exception 'INVALID_EVENT'; end if;
  begin
    insert into public.events(title, slug, team_count) values (btrim(p_title), p_slug, p_team_count) returning * into v_event;
  exception when unique_violation then raise exception 'SLUG_TAKEN';
  end;
  insert into public.teams(event_id, team_number) select v_event.id, generate_series(1, p_team_count);
  if cardinality(p_names) > 0 then perform public.admin_add_participants(v_event.id, p_names); end if;
  return v_event;
end;
$$;

create or replace function public.admin_release_claim(p_participant_id uuid)
returns public.participants language plpgsql security definer set search_path = '' as $$
declare v_person public.participants;
begin
  update public.participants set claimed_by = null where id = p_participant_id returning * into v_person;
  if not found then raise exception 'NOT_FOUND'; end if;
  return v_person;
end;
$$;

create table if not exists private.admin_login_limits (
  key text primary key,
  window_started timestamptz not null,
  attempts integer not null
);
alter table private.admin_login_limits enable row level security;
revoke all on private.admin_login_limits from public, anon, authenticated;
create or replace function public.check_admin_login_limit(p_key text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_attempts integer;
begin
  if p_key is null or length(p_key) <> 64 then return false; end if;
  delete from private.admin_login_limits where window_started < now() - interval '1 day';
  insert into private.admin_login_limits(key, window_started, attempts) values (p_key, now(), 1)
  on conflict (key) do update set
    attempts = case when private.admin_login_limits.window_started < now() - interval '15 minutes' then 1 else private.admin_login_limits.attempts + 1 end,
    window_started = case when private.admin_login_limits.window_started < now() - interval '15 minutes' then now() else private.admin_login_limits.window_started end
  returning attempts into v_attempts;
  return v_attempts <= 10;
end;
$$;
revoke all on function public.admin_create_event(text, text, integer, text[]),
  public.admin_add_participants(uuid, text[]), public.admin_release_claim(uuid), public.check_admin_login_limit(text)
  from public, anon, authenticated;
grant execute on function public.admin_create_event(text, text, integer, text[]),
  public.admin_add_participants(uuid, text[]), public.admin_release_claim(uuid), public.check_admin_login_limit(text)
  to service_role;

-- Only seeds the FIRST time. Re-running this file preserves all existing data.
do $$
declare v_id uuid;
begin
  insert into public.events(id, slug, title, team_count)
    values ('20260929-0000-4000-8000-000000000001', 'icpc-2026', 'ICPC 2026', 7)
    on conflict do nothing returning id into v_id;
  if v_id is not null then
    insert into public.teams(event_id, team_number) select v_id, generate_series(1, 7);
    perform public.admin_add_participants(v_id, array[
      'Carlos Guzman', 'Faatimah Seecharan', 'Gian Pena', 'Henrique Laranjinha',
      'Jose Sanchez', 'Kevin Wilson', 'Lingtong Meng', 'Luis Canada', 'Marcelo Hernandez',
      'Monica Barbosa', 'Naranjavkhlan Tumenbold', 'Ousman Bah', 'Redan Aguilar',
      'Rohith Boppini', 'Romario Destine', 'Samuel Perez', 'Sebastian Arrieta',
      'Stephen Taylor', 'Victor Fernandez Pavoni', 'Zara Maraj'
    ]);
  end if;
end $$;

-- SELECT policies above allow both signed-in and read-only clients to receive
-- changes. Events are also published so closing/reopening updates live.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'participants') then
    alter publication supabase_realtime add table public.participants;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'events') then
    alter publication supabase_realtime add table public.events;
  end if;
end $$;
commit;
