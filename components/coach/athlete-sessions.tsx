"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchExerciseLibrary } from "@/lib/exercises/library";
import { fetchRecentSessions } from "@/lib/logging/session-store";
import { exerciseIdsOf, fetchSetsForSessions, setsBySession, type HistorySet } from "@/lib/logging/history-store";
import { cardStatsLine, formatDuration, formatTonnage, groupByWeek, historyCards } from "@/lib/logging/history";
import { cardioSeconds } from "@/lib/logging/cardio";
import { sessionDateLabel, type SessionRecord } from "@/lib/logging/session";
import { blockNotes, blockSetText, exerciseBlocks } from "@/lib/coach/athlete-view";
import type { Exercise } from "@/lib/exercises/match";
import { cn } from "@/lib/cn";
import { FailedMark } from "@/components/ui/failed-mark";

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
 * The athlete's note on a set (F11) shows under its exercise, labelled by set
 * the way their Log numbers it. This is the one place a coach sees notes on
 * sets that were not filmed; the Review Queue and Videos show the note
 * beside the clip.
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
      historyCards(
        data.sessions,
        (id) => exerciseIdsOf(grouped.get(id) ?? []).map((e) => nameOf(e) ?? "Unknown lift"),
        undefined,
        undefined,
        // F23: a session's cardio time, from the sets already read.
        (id) => cardioSeconds(grouped.get(id) ?? []),
      ),
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
                          // Phone: date and totals on one line, the exercises under them.
                          "grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5 rounded-chip py-2.5 text-left",
                          "md:grid-cols-[150px_minmax(0,1fr)_auto] md:gap-3 md:py-2",
                          "transition-control press-wide hover:bg-surface focus-visible:bg-surface",
                          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line",
                        )}
                      >
                        <span className="text-ui font-semibold">{sessionDateLabel(card.startedAt)}</span>
                        <span className="col-span-2 row-start-2 truncate text-ui text-muted md:col-span-1 md:row-start-auto">
                          {/* The athlete's own name for the session, when they gave one. */}
                          {card.named ? <span className="text-foreground">{card.title} · </span> : null}
                          {card.exerciseNames.join(", ")}
                        </span>
                        <span className="col-start-2 row-start-1 text-right font-mono text-meta text-muted tabular-nums md:col-start-auto md:row-start-auto md:text-left">
                          {cardStatsLine(card, card.tonnageKg > 0 ? `${formatTonnage(card.tonnageKg)} kg` : null)}
                          {" · "}
                          {card.finishedAt ? formatDuration(card.durationMs) : "running"}
                        </span>
                      </button>
                      {expanded ? (
                        // Rises out of the row it belongs to. Collapsing is
                        // instant: the coach is done with it, and a closing
                        // panel would hold the rows below it in place.
                        <div id={panelId} className="flex flex-col gap-2 pb-3 motion-safe:animate-rise-in md:pl-[162px]">
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
                                    {/* "20 min · level 8" for cardio (F23), never its 0 × 0. */}
                                    {blockSetText(set)}
                                    {set.isWarmup ? " (warm-up)" : ""}
                                    {set.failed ? <FailedMark className="ml-1.5 align-middle" /> : null}
                                  </span>
                                ))}
                              </span>
                              {blockNotes(block).length > 0 ? (
                                <ul aria-label={`Athlete notes on ${block.exerciseName}`} className="m-0 flex list-none flex-col gap-0.5 p-0">
                                  {blockNotes(block).map((entry, at) => (
                                    <li key={`${entry.label}-${at}`} className="text-ui text-muted">
                                      <span className="font-mono text-meta text-muted-2">{entry.label}</span> “{entry.note}”
                                    </li>
                                  ))}
                                </ul>
                              ) : null}
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
