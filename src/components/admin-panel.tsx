"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fullName, type Participant, type TeamEvent, type TeamDeparture } from "@/lib/types";

type Result = { authenticated?: boolean; configured?: boolean; setupMessage?: string | null; events?: TeamEvent[]; event?: TeamEvent; participants?: Participant[]; history?: TeamDeparture[]; nextCursor?: number | null; added?: number; error?: string };

export function AdminPanel() {
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [setupMessage, setSetupMessage] = useState("");
  const [events, setEvents] = useState<TeamEvent[]>([]);
  const [selected, setSelected] = useState<TeamEvent | null>(null);
  const [people, setPeople] = useState<Participant[]>([]);
  const [history, setHistory] = useState<TeamDeparture[]>([]);
  const [historyCursor, setHistoryCursor] = useState<number | null>(null);
  const [historySyncError, setHistorySyncError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingPeople, setLoadingPeople] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [link, setLink] = useState("");
  const requestId = useRef(0);
  const inflight = useRef(false);

  const request = useCallback(async (path: string, method = "GET", body?: unknown): Promise<Result> => {
    const response = await fetch(`/api/admin/${path}`, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, cache: "no-store", signal: AbortSignal.timeout(20000) });
    const data: Result = await response.json();
    if (!response.ok) {
      if (response.status === 401) setAuthenticated(false);
      throw new Error(data.error || "Couldn't complete this request. Please try again.");
    }
    return data;
  }, []);

  const loadEvents = useCallback(async () => {
    const data = await request("events");
    setEvents(data.events ?? []);
  }, [request]);

  useEffect(() => {
    let active = true;
    // Session state changes only after the network request has resolved.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void request("session").then(async (data) => {
      if (!active) return;
      setConfigured(!!data.configured); setSetupMessage(data.setupMessage ?? ""); setAuthenticated(!!data.authenticated);
      if (data.authenticated) await loadEvents();
    }).catch(() => { if (active) setError("Couldn't connect. Refresh to try again."); })
      .finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, [request, loadEvents]);

  useEffect(() => {
    if (!authenticated || !selected?.id || loadingPeople) return;
    let active = true;
    let pending = false;
    const eventId = selected.id;
    const refreshHistory = async () => {
      if (pending || document.visibilityState !== "visible") return;
      pending = true;
      try {
        const data = await request(`events/${eventId}/history`);
        if (!active) return;
        setHistory((current) => {
          const entries = new Map(current.map((entry) => [entry.id, entry]));
          for (const entry of data.history ?? []) entries.set(entry.id, entry);
          return [...entries.values()].sort((a, b) => b.id - a.id);
        });
        setHistorySyncError(false);
      } catch { if (active) setHistorySyncError(true); }
      finally { pending = false; }
    };
    const timer = window.setInterval(() => { void refreshHistory(); }, 5000);
    const onVisible = () => { void refreshHistory(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [authenticated, selected?.id, loadingPeople, request]);

  async function action(task: () => Promise<void>) {
    if (inflight.current) return;
    inflight.current = true; setBusy(true); setError(""); setNotice("");
    try { await task(); } catch (e) { setError(e instanceof Error ? e.message : "Couldn't save. Please try again."); }
    finally { inflight.current = false; setBusy(false); }
  }

  async function selectEvent(event: TeamEvent) {
    const ticket = ++requestId.current;
    setSelected(event); setPeople([]); setHistory([]); setHistoryCursor(null); setHistorySyncError(false); setError(""); setNotice(""); setLoadingPeople(true);
    setLink(`${window.location.origin}/e/${event.slug}`);
    try {
      const [data, log] = await Promise.all([request(`events/${event.id}`), request(`events/${event.id}/history`)]);
      if (ticket === requestId.current) { setPeople(data.participants ?? []); setHistory(log.history ?? []); setHistoryCursor(log.nextCursor ?? null); }
    } catch (e) { if (ticket === requestId.current) setError(e instanceof Error ? e.message : "Couldn't load students."); }
    finally { if (ticket === requestId.current) setLoadingPeople(false); }
  }

  if (!ready) return <main className="shell small-shell"><h1>Organizer access</h1><p className="muted mt-3" role="status">Loading…</p></main>;
  if (!authenticated) return <main className="shell login-shell">
    <p className="eyebrow">ICPC TEAM BUILDER</p><h1>Organizer access</h1><p className="muted mt-3">Manage events and student lists.</p>
    {!configured ? <div className="banner mt-6">{setupMessage}<a className="text-button" href="https://vercel.com/lingtong-mengs-projects/icpc-team-builder/settings/environment-variables" target="_blank" rel="noreferrer">Open Vercel settings ↗</a></div> : null}
    <form className="mt-7 space-y-5" onSubmit={(e) => {
      e.preventDefault(); const form = e.currentTarget; const password = new FormData(form).get("password");
      void action(async () => { await request("session", "POST", { password }); form.reset(); setAuthenticated(true); await loadEvents(); });
    }}>
      <label className="field"><span>Admin password</span><input name="password" type="password" autoComplete="current-password" required maxLength={256} disabled={busy} /></label>
      <p className="help-text" lang="zh-CN">密码提示：生日</p>
      {error ? <p className="inline-message" role="alert">{error}</p> : null}
      <button className="button primary w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
    </form>
  </main>;

  return <main className="shell admin-shell">
    <header className="board-header"><div><p className="eyebrow">ICPC TEAM BUILDER</p><h1>Events</h1><p className="muted mt-2">A separate link and student list for every event.</p></div><button className="button" disabled={busy} onClick={() => void action(async () => { await request("session", "DELETE"); setAuthenticated(false); setEvents([]); setSelected(null); setPeople([]); })}>Sign out</button></header>
    {error ? <p className="banner error" role="alert">{error}</p> : null}
    {notice ? <p className="banner" role="status">{notice}</p> : null}
    <div className="admin-columns">
      <section className="admin-card"><h2>Create an event</h2><p className="help-text mt-1">Existing events and their teams stay unchanged.</p>
        <form className="mt-6 space-y-4" onSubmit={(e) => {
          e.preventDefault(); const form = e.currentTarget; const data = new FormData(form);
          void action(async () => {
            const result = await request("events", "POST", { title: data.get("title"), slug: data.get("slug"), teamCount: Number(data.get("teamCount")), names: data.get("names") });
            form.reset(); await loadEvents(); if (result.event) await selectEvent(result.event); setNotice("Event created. Copy its link to share with students.");
          });
        }}>
          <label className="field"><span>Event name</span><input name="title" placeholder="ICPC Spring 2027" required maxLength={100} /></label>
          <label className="field"><span>Event URL</span><div className="slug-input"><span>/e/</span><input name="slug" placeholder="icpc-spring-2027" pattern="[a-z0-9]+(-[a-z0-9]+)*" minLength={3} maxLength={64} required /></div><small>Lowercase letters, numbers, and hyphens. Each URL is unique.</small></label>
          <label className="field"><span>Number of teams</span><input name="teamCount" type="number" min={1} max={50} defaultValue={7} required /><small>Maximum 3 students per team.</small></label>
          <label className="field"><span>Student names</span><textarea name="names" rows={6} placeholder={"One full name per line\nYou can also add students later."} maxLength={51000} /><small>Up to 500 names per event. Give students with the same name a distinguishing label.</small></label>
          <button className="button primary w-full" disabled={busy}>{busy ? "Saving…" : "Create event"}</button>
        </form>
      </section>
      <div className="space-y-5">
        <section className="admin-card"><div className="zone-heading"><h2>Your events</h2><button className="text-button" disabled={busy} onClick={() => void action(loadEvents)}>Refresh</button></div>
          <div className="event-list">{events.map((event) => <button key={event.id} className={`event-option ${selected?.id === event.id ? "selected-event" : ""}`} disabled={busy} onClick={() => void selectEvent(event)}><span><strong>{event.title}</strong><small>/e/{event.slug}</small></span><span className="event-tag">{event.is_open ? "Open" : "Closed"}</span></button>)}</div>
          {events.length === 0 ? <p className="muted mt-4">No events yet. Create your first one.</p> : null}
        </section>
        {selected ? <section className="admin-card" key={selected.id}>
          <div className="zone-heading"><h2>{selected.title}</h2><span className="count">{selected.team_count} teams</span></div>
          <label className="field mt-5"><span>Student link</span><input readOnly value={link} onFocus={(e) => e.target.select()} /></label>
          <div className="flex flex-wrap gap-2 mt-3">
            <button className="button" onClick={() => void action(async () => { try { await navigator.clipboard.writeText(link); setNotice("Link copied."); } catch { setNotice("Select and copy the student link above."); } })}>Copy link</button>
            <a className="button" href={`/e/${selected.slug}`} target="_blank" rel="noreferrer">Open board ↗</a>
            <button className="button" disabled={busy} onClick={() => {
              if (selected.is_open && !window.confirm("Close this event? Students will still see the final teams, but cannot move until you reopen it.")) return;
              void action(async () => { const data = await request(`events/${selected.id}`, "POST", { action: "set-open", isOpen: !selected.is_open }); if (data.event) setSelected(data.event); await loadEvents(); setNotice(selected.is_open ? "Event closed. Teams are preserved." : "Event reopened."); });
            }}>{selected.is_open ? "Close event" : "Reopen event"}</button>
          </div>
          <form className="mt-7 space-y-3" onSubmit={(e) => {
            e.preventDefault(); const form = e.currentTarget; const names = new FormData(form).get("names");
            void action(async () => { const data = await request(`events/${selected.id}`, "POST", { action: "add", names }); form.reset(); await selectEvent(selected); setNotice(`Added ${data.added} students.`); });
          }}><label className="field"><span>Add students</span><textarea name="names" rows={3} placeholder="One full name per line" required maxLength={51000} /></label><button className="button primary" disabled={busy}>Add students</button></form>
          <div className="zone-heading mt-7"><h3>Students{loadingPeople ? "" : ` · ${people.length}`}</h3><button className="text-button" disabled={busy || loadingPeople} onClick={() => void selectEvent(selected)}>Refresh</button></div>
          {loadingPeople ? <p className="muted mt-4" role="status">Loading students…</p> : <ul className="admin-people">{people.map((p) => <li key={p.id}><div><strong>{fullName(p)}</strong><small>{p.team_number ? `Team ${p.team_number}` : "Unassigned"}</small></div></li>)}</ul>}
          <div className="zone-heading mt-7"><h3>Departures &amp; team changes</h3><button className="text-button" disabled={busy || loadingPeople} onClick={() => void selectEvent(selected)}>Refresh</button></div>
          <p className="help-text mt-2">Every move out of a team is recorded automatically. Times are local to your browser. Anonymous browser IDs do not identify a real person.</p>
          <p className="help-text mt-2" role="status">{historySyncError ? "Updates paused. Retrying automatically…" : "Updates automatically every 5 seconds while this page is visible."}</p>
          {!loadingPeople && history.length === 0 ? <p className="muted mt-4">No departures recorded.</p> : null}
          <ol className="history-list">{history.map((entry) => <li key={entry.id}>
            <div className="flex justify-between gap-3"><strong>{entry.participant_name}</strong><time dateTime={entry.occurred_at}>{new Date(entry.occurred_at).toLocaleString()}</time></div>
            <p>Team {entry.from_team_number} → {entry.to_team_number === null ? "Unassigned" : `Team ${entry.to_team_number}`}</p>
            <p className="history-actor" title={entry.actor_id ?? "Database / organizer"}>{entry.actor_id ? `Anonymous browser ${entry.actor_id.slice(0, 8)}` : "Database / organizer"} · Record #{entry.id}</p>
          </li>)}</ol>
          {historyCursor !== null ? <button className="button mt-3" disabled={busy} onClick={() => void action(async () => {
            const data = await request(`events/${selected.id}/history?before=${historyCursor}`);
            setHistory((current) => [...current, ...(data.history ?? [])]); setHistoryCursor(data.nextCursor ?? null);
          })}>Load older records</button> : null}
        </section> : <p className="help-text px-1">Select an event to manage students and copy its link.</p>}
      </div>
    </div>
  </main>;
}
