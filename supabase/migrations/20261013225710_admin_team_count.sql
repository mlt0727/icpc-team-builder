-- Only the server's service role can resize an event. Existing students never move.
begin;
create or replace function public.admin_set_team_count(p_event_id uuid, p_team_count integer)
returns public.events language plpgsql security invoker set search_path = '' as $$
declare
  v_event public.events;
begin
  if p_team_count is null or p_team_count not between 1 and 50 then
    raise exception 'INVALID_TEAM_COUNT';
  end if;
  -- Moves and renames hold FOR SHARE on the same event, so they cannot race a resize.
  select * into v_event from public.events where id = p_event_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_team_count = v_event.team_count then return v_event; end if;
  if p_team_count < v_event.team_count then
    if exists (select 1 from public.participants where event_id = p_event_id and team_number > p_team_count) then
      raise exception 'TEAMS_NOT_EMPTY';
    end if;
    delete from public.teams where event_id = p_event_id and team_number > p_team_count;
  else
    insert into public.teams(event_id, team_number)
      select p_event_id, generate_series(v_event.team_count + 1, p_team_count);
  end if;
  update public.events set team_count = p_team_count where id = p_event_id returning * into v_event;
  return v_event;
end;
$$;
revoke all on function public.admin_set_team_count(uuid, integer) from public, anon, authenticated;
grant execute on function public.admin_set_team_count(uuid, integer) to service_role;
notify pgrst, 'reload schema';
commit;
