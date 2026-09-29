"use client";

import { useState, type ReactNode } from "react";
import { DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, rectIntersection, type DragEndEvent } from "@dnd-kit/core";
import { useTeamBoard } from "@/hooks/use-team-board";
import { fullName, sortParticipants, type Participant } from "@/lib/types";

function Grip() {
  return <svg width="16" height="20" viewBox="0 0 16 20" fill="currentColor" aria-hidden="true">{[5, 10, 15].flatMap((y) => [5, 11].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.3" />))}</svg>;
}

function PersonCard({ person, selected, enabled, onSelect }: { person: Participant; selected: boolean; enabled: boolean; onSelect: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: person.id, disabled: !enabled });
  return <button ref={setNodeRef} type="button" {...attributes} {...listeners} onFocus={onSelect} disabled={!enabled} className={`person-card draggable-card ${selected ? "selected-card" : ""} ${isDragging ? "drag-source" : ""}`} data-participant={person.id} aria-label={`Drag ${fullName(person)}`}>
    <span className="card-grip"><Grip /></span>
    <span className="person-name">{fullName(person)}</span>
  </button>;
}

function DropZone({ team, count, children, disabled }: { team: number | null; count: number; children: ReactNode; disabled: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: team === null ? "unassigned" : `team-${team}`, disabled });
  const full = team !== null && count >= 3;
  return <section ref={setNodeRef} className={`drop-zone ${team === null ? "unassigned-zone" : "team-zone"} ${isOver ? (full ? "over-full" : "over-zone") : ""}`} aria-label={team === null ? "Unassigned" : `Team ${team}`}>
    <div className="zone-heading">
      <h2>{team === null ? "UNASSIGNED" : `Team ${team}`}</h2>
      <span className={`count ${full ? "full-count" : ""}`}>{team === null ? count : `${count} / 3`}</span>
    </div>
    <div className={team === null ? "unassigned-grid" : "team-people"}>{children}</div>
    {count === 0 ? <div className="empty-zone">{team === null ? "Everyone has a team." : "Drop a name here"}</div> : null}
  </section>;
}

export function TeamBoard({ slug }: { slug: string }) {
  const board = useTeamBoard(slug);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 7 } }), useSensor(KeyboardSensor));
  const enabled = !!board.event?.is_open && !board.busy && board.status !== "offline" && !board.error;
  const dragging = board.participants.find((p) => p.id === draggingId);

  function onDragEnd({ active, over }: DragEndEvent) {
    setDraggingId(null);
    if (!over || !enabled) return;
    const id = String(over.id);
    if (id === "unassigned") void board.move(String(active.id), null);
    else if (/^team-\d+$/.test(id)) void board.move(String(active.id), Number(id.slice(5)));
  }

  if (!board.configured) return <main className="shell small-shell"><p className="eyebrow">ICPC TEAM BUILDER</p><h1>Setup needed</h1><p className="muted mt-3">The organizer needs to connect this site to Supabase before team selection can begin.</p><p className="help-text mt-5">Set the project URL and publishable key, then redeploy. The included README has the setup steps.</p></main>;
  if (board.notFound) return <main className="shell small-shell"><p className="eyebrow">ICPC TEAM BUILDER</p><h1>Event not found</h1><p className="muted mt-3">Check the link with your organizer.</p></main>;
  if (board.loading || !board.event) return <main className="shell small-shell"><h1>ICPC Team Builder</h1><p className="muted mt-3" role="status">{board.error || "Loading teams…"}</p>{board.error ? <button className="button mt-5" onClick={() => void board.refresh()}>Try again</button> : null}</main>;

  const unassigned = sortParticipants(board.participants, null);
  return <main className="shell">
    <header className="board-header">
      <div><p className="eyebrow">{board.event.title}</p><h1>ICPC Team Builder</h1><p className="muted mt-2">Drag any name into a team.</p></div>
      <div className="board-meta">
        <div className="header-actions"><span className={`live-status ${board.status === "live" && !board.error ? "is-live" : ""}`} role="status"><i />{board.error ? "Sync paused" : board.status === "live" ? "Live" : board.status === "offline" ? "Offline" : "Connecting…"}</span><a href="/admin" className="organizer-entry" aria-label="Organizer access" title="Organizer access"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /><path d="M12 14v3" /></svg></a></div>
        <div className="meta-counts"><span>{board.participants.length} Participants</span><span>{board.event.team_count} Teams</span></div>
      </div>
    </header>

    {!board.event.is_open ? <p className="banner">This event is closed. Final teams are shown below.</p> : null}
    {board.error ? <div className="banner error" role="alert">{board.error}<button className="text-button" onClick={() => void board.refresh()}>Retry</button></div> : null}
    <p className="board-notice muted">Anyone can move names. Leaving a team is recorded.</p>

    <DndContext id="team-builder" sensors={sensors} collisionDetection={rectIntersection} onDragStart={({ active }) => { setDraggingId(String(active.id)); setSelectedId(String(active.id)); }} onDragCancel={() => setDraggingId(null)} onDragEnd={onDragEnd} accessibility={{ screenReaderInstructions: { draggable: "Press Space to pick up a name. Use arrow keys to move, Space to drop, and Escape to cancel." } }}>
      <DropZone team={null} count={unassigned.length} disabled={!enabled}>{unassigned.map((p) => <PersonCard key={p.id} person={p} selected={p.id === selectedId} enabled={enabled} onSelect={() => setSelectedId(p.id)} />)}</DropZone>
      <div className="teams-grid">{Array.from({ length: board.event.team_count }, (_, i) => {
        const members = sortParticipants(board.participants, i + 1);
        return <DropZone key={i + 1} team={i + 1} count={members.length} disabled={!enabled}>{members.map((p) => <PersonCard key={p.id} person={p} selected={p.id === selectedId} enabled={enabled} onSelect={() => setSelectedId(p.id)} />)}</DropZone>;
      })}</div>
      <DragOverlay dropAnimation={null}>{dragging ? <div className="person-card selected-card drag-overlay"><Grip /><span className="person-name">{fullName(dragging)}</span></div> : null}</DragOverlay>
    </DndContext>
    <p className="board-hint">Up to 3 people per team. <span>Drag anywhere on a name card. On mobile, hold a card to drag.</span></p>
    {board.notice ? <div className="toast" role="status">{board.notice}</div> : null}
  </main>;
}
