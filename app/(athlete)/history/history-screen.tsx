"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardMeta, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { TextField } from "@/components/ui/input";
import { PendingDot } from "@/components/ui/sync-mark";
import { useSession } from "@/lib/auth/session-context";
import { useExerciseLibrary } from "@/lib/exercises/library-context";
import { useTrainingSessions } from "@/lib/logging/session-context";
import { exerciseIdsOf, fetchSetsForSessions, setsBySession, type HistorySet } from "@/lib/logging/history-store";
import {
  filterByExercise,
  formatDuration,
  formatTonnage,
  groupByWeek,
  historyCards,
} from "@/lib/logging/history";
import { sessionDateLabel } from "@/lib/logging/session";
import { useUnits } from "@/lib/profile/units-context";
import { loadIn } from "@/lib/units";
import { refusedRowDeletes, unsyncedIds } from "@/lib/logging/offline-view";
import { useDayLabels } from "@/lib/logging/use-day-labels";
import { Button } from "@/components/ui/button";
import { dismissFailed, subscribeToQueue } from "@/lib/offline/client";
import type { QueuedOp } from "@/lib/offline/queue";

/**
 * History. Find a past session and see what was done.
 *
 * Two questions, per the blueprint, and the layout answers both by being a
 * scannable list: "what did I hit last time", and "where is the set I logged
 * wrong". No calendar grid -- nobody navigates their training by looking at a
 * month view, and a list is faster to read and far cheaper to build.
 *
 * Sessions come from the provider Today and Log already use, so the only thing
 * fetched here is the sets, in one query for the whole page.
 */
export function HistoryScreen() {
  const { state: sessionState } = useSession();
  const { unit } = useUnits();
  const { state: library } = useExerciseLibrary();
  const { state: training } = useTrainingSessions();

  const [sets, setSets] = useState<HistorySet[]>([]);
  const [ops, setOps] = useState<QueuedOp[]>([]);
  const [query, setQuery] = useState("");

  const signedIn = sessionState.status === "signed-in";
  const sessions = training.sessions;
  const sessionIds = useMemo(() => sessions.map((s) => s.id), [sessions]);
  const idKey = sessionIds.join(",");

  useEffect(() => subscribeToQueue(setOps), []);

  // Sessions started from the program are titled with the coach's label for
  // the day until the athlete names them.
  const dayLabels = useDayLabels(sessions.map((s) => s.programDayId));
  const refused = useMemo(() => refusedRowDeletes(ops, "session"), [ops]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // A failed read is normal in a basement and not an error worth showing:
      // the cards simply lose their exercise names until the signal is back.
      const loaded = await fetchSetsForSessions(idKey ? idKey.split(",") : []).catch(
        () => [] as HistorySet[],
      );
      if (!cancelled) setSets(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, [idKey]);

  const nameOf = useMemo(() => {
    const names = new Map(library.exercises.map((e) => [e.id, e.name]));
    return (id: string) => names.get(id) ?? id;
  }, [library.exercises]);

  const weeks = useMemo(() => {
    const grouped = setsBySession(sets);
    const unsynced = unsyncedIds(ops);
    const cards = historyCards(
      sessions,
      (sessionId) => exerciseIdsOf(grouped.get(sessionId) ?? []).map(nameOf),
      (sessionId) => unsynced.has(sessionId),
      (dayId) => dayLabels.get(dayId) ?? null,
    );
    return groupByWeek(cards);
  }, [sessions, sets, ops, nameOf, dayLabels]);

  const shown = useMemo(() => filterByExercise(weeks, query), [weeks, query]);
  const hasAny = weeks.some((week) => week.sessions.length > 0);

  return (
    <div className="pt-8 flex flex-1 flex-col gap-5 pb-6">
      <header className="flex flex-col gap-3">
        <h1 className="m-0 text-display font-semibold">History</h1>
        {hasAny ? (
          <TextField
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search by exercise"
            // The real query is "show me my deadlift sessions", so the field
            // says so rather than a generic "Search".
            placeholder="Search by exercise"
            enterKeyHint="search"
          />
        ) : null}
      </header>

      {/*
        A session delete that reached Appwrite after a coach had commented on
        one of its sets. The commented sets kept the session; nothing was lost.
      */}
      {refused.size > 0 ? (
        <div className="flex items-center justify-between gap-3 rounded-card border border-border bg-surface p-3">
          <p role="status" className="m-0 text-caption text-muted">
            {refused.size === 1 ? "A session you deleted was" : `${refused.size} sessions you deleted were`} kept:
            your coach had commented on it.
          </p>
          <Button variant="ghost" size="sm" onClick={() => void dismissFailed([...refused.values()])}>
            OK
          </Button>
        </div>
      ) : null}

      {!hasAny ? (
        signedIn && training.status !== "loading" ? (
          <EmptyState
            title="No sessions yet"
            body="Your first one will show up here, with every set as you logged it."
          />
        ) : null
      ) : shown.length === 0 ? (
        <p className="m-0 text-body text-muted" role="status">
          Nothing matching &ldquo;{query.trim()}&rdquo;.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {shown.map((week) => (
            <section key={week.weekStart} className="flex flex-col gap-2" aria-label={week.label}>
              <h2 className="m-0 font-mono text-label uppercase text-muted-2">{week.label}</h2>
              {week.sessions.map((card) => (
                <Link
                  key={card.sessionId}
                  href={`/history/${card.sessionId}`}
                  className="no-underline"
                  aria-label={`${card.named ? `${card.title}, ` : ""}${sessionDateLabel(card.startedAt)}, ${card.setCount} sets`}
                >
                  <Card>
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="flex min-w-0 flex-col">
                        <CardTitle>{card.title}</CardTitle>
                        {card.named ? <CardMeta>{sessionDateLabel(card.startedAt)}</CardMeta> : null}
                      </span>
                      <span className="flex items-center gap-1.5">
                        {card.pendingSync ? <PendingDot /> : null}
                        <CardMeta>
                          {card.finishedAt ? formatDuration(card.durationMs) : "running"}
                        </CardMeta>
                      </span>
                    </span>
                    {card.exerciseNames.length > 0 ? (
                      <span className="text-sm text-muted">{card.exerciseNames.join(", ")}</span>
                    ) : null}
                    <CardMeta>
                      {card.setCount} set{card.setCount === 1 ? "" : "s"}
                      {card.tonnageKg > 0 ? ` · ${formatTonnage(loadIn(card.tonnageKg, unit))} ${unit}` : ""}
                    </CardMeta>
                  </Card>
                </Link>
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
