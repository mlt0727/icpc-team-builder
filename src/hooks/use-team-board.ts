"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/messages";
import { mergeParticipants, type Participant, type TeamEvent } from "@/lib/types";

export function useTeamBoard(slug: string) {
  const [client] = useState(getSupabase);
  const [event, setEvent] = useState<TeamEvent | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"connecting" | "live" | "reconnecting" | "offline">("connecting");
  const mutation = useRef(false);
  const generation = useRef(0);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    if (!client) return false;
    const ticket = ++generation.current;
    try {
      const { data: nextEvent, error: eventError } = await client.from("events").select("*").eq("slug", slug).abortSignal(AbortSignal.timeout(15000)).maybeSingle();
      if (eventError) throw eventError;
      if (!alive.current || ticket !== generation.current) return false;
      if (!nextEvent) { setNotFound(true); setLoading(false); return false; }
      const { data, error: listError } = await client.from("participants").select("*").eq("event_id", nextEvent.id).abortSignal(AbortSignal.timeout(15000));
      if (listError) throw listError;
      if (!alive.current || ticket !== generation.current) return false;
      setEvent(nextEvent);
      setParticipants((current) => mergeParticipants(current, data ?? []));
      setNotFound(false);
      setError("");
      setLoading(false);
      return true;
    } catch {
      if (alive.current && ticket === generation.current) {
        setError("Couldn't load the latest teams. Check your connection and try again.");
        setLoading(false);
      }
      return false;
    }
  }, [client, slug]);

  useEffect(() => {
    alive.current = true;
    if (!client) return;
    // The state changes in refresh occur only after the asynchronous response.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    return () => { alive.current = false; };
  }, [client, refresh]);

  useEffect(() => {
    if (!client || !event?.id) return;
    let active = true;
    let subscribed = false;
    const resync = async () => {
      await refresh();
      // Connection status comes from the socket. Snapshot errors have their own
      // banner; a superseded request must not label a healthy socket disconnected.
      if (active && subscribed) setStatus(navigator.onLine ? "live" : "offline");
    };
    const channel = client.channel(`event-${event.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "participants", filter: `event_id=eq.${event.id}` }, (payload) => {
        if (payload.eventType !== "DELETE") {
          setParticipants((current) => mergeParticipants(current, [payload.new as Participant]));
        } else { void resync(); }
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "events", filter: `id=eq.${event.id}` }, () => { void resync(); })
      .subscribe((state) => {
        subscribed = state === "SUBSCRIBED";
        if (!active) return;
        if (subscribed) { void resync(); }
        else setStatus(navigator.onLine ? "reconnecting" : "offline");
      });
    // Event-driven catch-up covers missed updates during reconnect/backgrounding.
    // There is no interval or database polling.
    const onOnline = () => { void resync(); };
    const onOffline = () => setStatus("offline");
    const onVisible = () => { if (document.visibilityState === "visible") void resync(); };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
      void client.removeChannel(channel);
    };
  }, [client, event?.id, refresh]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 6500);
    return () => clearTimeout(timer);
  }, [notice]);

  const move = async (participantId: string, team: number | null) => {
    const person = participants.find((p) => p.id === participantId);
    if (!client || !person || mutation.current || person.team_number === team) return;
    if (team !== null && participants.filter((p) => p.team_number === team).length >= 3) {
      setNotice("Team is full."); return;
    }
    mutation.current = true; setBusy(true); setNotice("");
    try {
      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      if (sessionError) throw sessionError;
      if (!sessionData.session) {
        const { error: signInError } = await client.auth.signInAnonymously();
        if (signInError) throw signInError;
      }
      const { data, error: moveError } = await client.rpc("move_participant", { p_participant_id: participantId, p_team_number: team }).abortSignal(AbortSignal.timeout(15000));
      if (moveError) throw moveError;
      setParticipants((current) => mergeParticipants(current, [data]));
      setNotice(team === null ? "Moved to Unassigned." : `Moved to Team ${team}.`);
    } catch (e) {
      setNotice(friendlyError(e, "Couldn't confirm the move. Checking the latest teams…"));
      await refresh();
    } finally { mutation.current = false; setBusy(false); }
  };

  return { configured: !!client, event, participants, loading, notFound, error, notice, busy, status, refresh, move };
}
