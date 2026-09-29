-- Upgrade: anyone with the link can move any name. Every departure is audited.
-- Run AFTER 202609290001_team_builder.sql. Existing IDs and teams are preserved.
begin;

create table if not exists public.team_departures (
  id bigint generated always as identity primary key,
  event_id uuid not null references public.events(id) on delete cascade,
  participant_id uuid references public.participants(id) on delete set null,
  participant_name text not null,
  from_team_number integer not null,
  to_team_number integer,
  actor_id uuid,
  occurred_at timestamptz not null default clock_timestamp()
);
create index if not exists departures_by_event on public.team_departures(event_id, id desc);
alter table public.team_departures enable row level security;
revoke all on public.team_departures from public, anon, authenticated, service_role;
grant select on public.team_departures to service_role;
revoke all on sequence public.team_departures_id_seq from public, anon, authenticated, service_role;

-- A database trigger records ALL departures, including a move made through SQL
-- or another future admin feature. Public clients cannot write or erase logs.
create or replace function private.record_team_departure()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.team_number is not null and old.team_number is distinct from new.team_number then
    insert into public.team_departures(event_id, participant_id, participant_name,
      from_team_number, to_team_number, actor_id)
    values (old.event_id, old.id, btrim(old.first_name || ' ' || old.last_name),
      old.team_number, new.team_number, auth.uid());
  end if;
  return new;
end;
$$;
revoke all on function private.record_team_departure() from public, anon, authenticated;
drop trigger if exists log_team_departure on public.participants;
create trigger log_team_departure after update of team_number on public.participants
for each row execute function private.record_team_departure();

create or replace function public.move_participant(p_participant_id uuid, p_team_number integer)
returns public.participants language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_event uuid;
  v_open boolean;
  v_person public.participants;
  v_slot integer;
begin
  -- A silent anonymous session identifies the browser for the audit trail.
  -- It does NOT claim a person, and there is no name-selection/login prompt.
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select event_id into v_event from public.participants where id = p_participant_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  select is_open into v_open from public.events where id = v_event for share;
  if not v_open then raise exception 'EVENT_CLOSED'; end if;
  select * into v_person from public.participants where id = p_participant_id for update;
  if p_team_number is not null then
    perform 1 from public.teams where event_id = v_event and team_number = p_team_number for no key update;
    if not found then raise exception 'INVALID_TEAM'; end if;
  end if;
  if v_person.team_number is not distinct from p_team_number then return v_person; end if;
  if p_team_number is not null then
    if (select count(*) from public.participants where event_id = v_event and team_number = p_team_number) >= 3 then
      raise exception 'TEAM_FULL';
    end if;
    select s into v_slot from generate_series(1, 3) s where not exists (
      select 1 from public.participants p where p.event_id = v_event and p.team_number = p_team_number and p.team_slot = s
    ) order by s limit 1;
    if v_slot is null then raise exception 'TEAM_FULL'; end if;
  end if;
  -- The audit trigger runs in this same transaction. A failed log insert also
  -- rolls back the move, so no successful departure can escape the audit log.
  update public.participants set team_number = p_team_number, team_slot = v_slot,
    joined_at = case when p_team_number is null then null else clock_timestamp() end
  where id = p_participant_id returning * into v_person;
  return v_person;
end;
$$;
revoke all on function public.move_participant(uuid, integer) from public, anon;
grant execute on function public.move_participant(uuid, integer) to authenticated;

-- Retain legacy columns/data for a safe upgrade, but disable name claiming.
revoke all on function public.claim_participant(uuid) from public, anon, authenticated;
revoke all on function public.admin_release_claim(uuid) from public, anon, authenticated, service_role;
commit;
