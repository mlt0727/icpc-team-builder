-- Add editable team names without changing any existing assignments or logs.
begin;
alter table public.teams add column if not exists name text
  check (name is null or (length(btrim(name)) between 1 and 40));
alter table public.teams add column if not exists version integer not null default 1;

create or replace function public.rename_team(p_event_id uuid, p_team_number integer, p_name text)
returns public.teams language plpgsql security definer set search_path = '' as $$
declare
  v_open boolean;
  v_team public.teams;
  v_name text := nullif(btrim(regexp_replace(p_name, '[[:space:]]+', ' ', 'g')), '');
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_name is not null and length(v_name) > 40 then raise exception 'INVALID_TEAM_NAME'; end if;
  select is_open into v_open from public.events where id = p_event_id for share;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not v_open then raise exception 'EVENT_CLOSED'; end if;
  select * into v_team from public.teams
    where event_id = p_event_id and team_number = p_team_number for no key update;
  if not found then raise exception 'INVALID_TEAM'; end if;
  if v_team.name is not distinct from v_name then return v_team; end if;
  update public.teams set name = v_name, version = version + 1
    where event_id = p_event_id and team_number = p_team_number returning * into v_team;
  return v_team;
end;
$$;
revoke all on function public.rename_team(uuid, integer, text) from public, anon;
grant execute on function public.rename_team(uuid, integer, text) to authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
    and schemaname = 'public' and tablename = 'teams') then
    alter publication supabase_realtime add table public.teams;
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
