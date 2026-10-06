"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchExerciseLibrary } from "@/lib/exercises/library";
import { fetchRecentSessions } from "@/lib/logging/session-store";
import { exerciseIdsOf, fetchSetsForSessions, setsBySession, type HistorySet } from "@/lib/logging/history-store";
import { formatDuration, formatTonnage, groupByWeek, historyCards } from "@/lib/logging/history";
import { sessionDateLabel, type SessionRecord } from "@/lib/logging/session";
import { exerciseBlocks } from "@/lib/coach/athlete-view";
import { formatNumber } from "@/lib/logging/prefill";
import type { Exercise } from "@/lib/exercises/match";
import { cn } from "@/lib/cn";

/**
 * Their training history, as the coach reads it: the last 25 sessions grouped
 * by week, newest first, each one opening in place to every set as logged.
 *
 * The same cards the athlete's History draws, from the same pure module, so a
 * session reads identically on both sides. The totals come from the session
 * row, not from summing sets -- see historyCards for why. The sets are one
 * query for the whole page, already needed for the exercise names, so opening
 * a session costs no round trip.
 *
 * Read-only. Logged work belongs to the athlete; a coach correcting a typo in
 * somebody else's log is a different feature, and not an agreed one.
 */

type Loaded = {
  athleteId: string;
  sessions: SessionRecord[];
  sets: HistorySet[];
  library: Exercise[];
};

type State = { status: "loading" } | { status: "ready"; data: Loaded } | { status: "failed"; athleteId: string };

export function AthleteSessions({ athleteId }: { athleteId: string }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [sessions, library] = await Promise.all([
          fetchRecentSessions(athleteId),
          fetchExerciseLibrary(athleteId),
        ]);
        const sets = await fetchSetsForSessions(sessions.map((s) => s.id));
        if (!cancelled) setState({ status: "ready", data: { athleteId, sessions, sets, library } });
      } catch {
        if (!cancelled) setState({ status: "failed", athleteId });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [athleteId]);

  const data = state.status === "ready" && state.data.athleteId === athleteId ? state.data : null;
  const failed = state.status === "failed" && state.athleteId === athleteId;

  const view = useMemo(() => {
    if (!data) return null;
    const names = new Map(data.library.map((e) => [e.id, e.name]));
    const nameOf = (id: string) => names.get(id);
    const grouped = setsBySession(data.sets);
    const weeks = groupByWeek(
      historyCards(data.sessions, (id) => exerciseIdsOf(grouped.get(id) ?? []).map((e) => nameOf(e) ?? "Unknown lift")),
    );
    const notes = new Map(data.sessions.map((session) => [session.id, session.notes?.trim() || null]));
    return { weeks, grouped, nameOf, notes };
  }, [data]);

  return (
    <section className="flex flex-col gap-3" aria-labelledby="athlete-sessions-heading">
      <h2 id="athlete-sessions-heading" className="m-0 text-label uppercase tracking-wide text-muted">
        Recent sessions
      </h2>

      {!view && !failed ? <p className="m-0 text-ui text-muted">Loading…</p> : null}
      {failed ? <p className="m-0 text-ui text-muted">Couldn’t load their sessions. Refresh to try again.</p> : null}
      {view && view.weeks.length === 0 ? (
        <p className="m-0 text-ui text-muted-2">
          No sessions yet. Each one they log appears here with every set, the day they train.
        </p>
      ) : null}

      {view
        ? view.weeks.map((week) => (
            <div key={week.weekStart} className="flex flex-col gap-1">
              <h3 className="m-0 font-mono text-label uppercase text-muted-2">{week.label}</h3>
              <ul className="m-0 flex list-none flex-col p-0">
                {week.sessions.map((card) => {
                  const expanded = open === card.sessionId;
                  const panelId = `session-${card.sessionId}`;
                  return (
                    <li key={card.sessionId} className="border-b border-border last:border-b-0">
                      <button
                        type="button"
                        aria-expanded={expanded}
                        aria-controls={panelId}
                        onClick={() => setOpen(expanded ? null : card.sessionId)}
                        className={cn(
                          "grid w-full grid-cols-[150px_minmax(0,1fr)_auto] items-baseline gap-3 py-2 text-left",
                          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line",
                        )}
                      >
                        <span className="text-ui font-semibold">{sessionDateLabel(card.startedAt)}</span>
                        <span className="truncate text-ui text-muted">{card.exerciseNames.join(", ")}</span>
                        <span className="font-mono text-meta text-muted tabular-nums">
                          {card.setCount} set{card.setCount === 1 ? "" : "s"}
                          {card.tonnageKg > 0 ? ` · ${formatTonnage(card.tonnageKg)} kg` : ""}
                          {" · "}
                          {card.finishedAt ? formatDuration(card.durationMs) : "running"}
                        </span>
                      </button>
                      {expanded ? (
                        <div id={panelId} className="flex flex-col gap-2 pb-3 pl-[162px]">
                          {view.notes.get(card.sessionId) ? (
                            // The athlete's own words about the session: the
                            // one thing on this card nobody could infer.
                            <p className="m-0 text-ui text-muted">“{view.notes.get(card.sessionId)}”</p>
                          ) : null}
                          {exerciseBlocks(view.grouped.get(card.sessionId) ?? [], view.nameOf).map((block) => (
                            <div key={block.exerciseId} className="flex flex-col gap-0.5">
                              <span className="text-ui font-semibold">{block.exerciseName}</span>
                              <span className="flex flex-wrap gap-x-4 gap-y-0.5 text-ui tabular-nums">
                                {block.sets.map((set, index) => (
                                  <span key={index} className={set.isWarmup ? "text-muted-2" : undefined}>
                                    {formatNumber(set.loadKg)} × {set.reps}
                                    {set.rpe === null ? "" : ` @${formatNumber(set.rpe)}`}
                                    {set.isWarmup ? " (warm-up)" : ""}
                                  </span>
                                ))}
                              </span>
                            </div>
                          ))}
                          {(view.grouped.get(card.sessionId) ?? []).length === 0 ? (
                            <span className="text-ui text-muted">No sets recorded in this session.</span>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        : null}
    </section>
  );
}
