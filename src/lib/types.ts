export type TeamEvent = {
  id: string;
  slug: string;
  title: string;
  team_count: number;
  is_open: boolean;
  created_at: string;
};

export type Participant = {
  id: string;
  event_id: string;
  first_name: string;
  last_name: string;
  team_number: number | null;
  team_slot: number | null;
  claimed_by: string | null;
  joined_at: string | null;
  created_at: string;
  version: number;
};

export type Team = {
  event_id: string;
  team_number: number;
  name: string | null;
  version: number;
};

export const teamLabel = (team: Team | undefined, number: number) => team?.name || `Team ${number}`;

export function mergeTeams(current: Team[], incoming: Team[]) {
  const key = (team: Team) => `${team.event_id}:${team.team_number}`;
  const map = new Map(current.map((team) => [key(team), team]));
  for (const team of incoming) {
    if (!map.has(key(team)) || team.version >= map.get(key(team))!.version) map.set(key(team), team);
  }
  return Array.from(map.values());
}

export type TeamDeparture = {
  id: number;
  event_id: string;
  participant_id: string | null;
  participant_name: string;
  from_team_number: number;
  to_team_number: number | null;
  actor_id: string | null;
  occurred_at: string;
};

type Table<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: { events: Table<TeamEvent>; teams: Table<Team>; participants: Table<Participant>; team_departures: Table<TeamDeparture> };
    Views: Record<string, never>;
    Functions: {
      move_participant: { Args: { p_participant_id: string; p_team_number: number | null }; Returns: Participant };
      rename_team: { Args: { p_event_id: string; p_team_number: number; p_name: string }; Returns: Team };
      admin_create_event: { Args: { p_title: string; p_slug: string; p_team_count: number; p_names: string[] }; Returns: TeamEvent };
      admin_add_participants: { Args: { p_event_id: string; p_names: string[] }; Returns: number };
      check_admin_login_limit: { Args: { p_key: string }; Returns: boolean };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export const fullName = (p: Pick<Participant, "first_name" | "last_name">) =>
  `${p.first_name} ${p.last_name}`.trim();

export function sortParticipants(rows: Participant[], team: number | null) {
  return rows.filter((p) => p.team_number === team).sort((a, b) =>
    team === null
      ? fullName(a).localeCompare(fullName(b), "en")
      : (a.joined_at ?? "").localeCompare(b.joined_at ?? "") || a.id.localeCompare(b.id),
  );
}

// RPC responses, Realtime, and refetches can arrive in different orders.
export function mergeParticipants(current: Participant[], incoming: Participant[]) {
  const map = new Map(current.map((p) => [p.id, p]));
  for (const p of incoming) {
    if (!map.has(p.id) || p.version >= map.get(p.id)!.version) map.set(p.id, p);
  }
  return Array.from(map.values());
}
