"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Card, CardMeta, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { TextField } from "@/components/ui/input";
import { PendingDot } from "@/components/ui/sync-mark";
import { useSession } from "@/lib/auth/session-context";
import { useExerciseLibrary } from "@/lib/exercises/library-context";
import { useTrainingSessions } from "@/lib/logging/session-context";
import { exerciseIdsOf, fetchSetsForSessions, setsBySession, type HistorySet } from "@/lib/logging/history-store";
import {
  cardStatsLine,
  filterByExercise,
  formatDuration,
  formatTonnage,
  groupByWeek,
  historyCards,
} from "@/lib/logging/history";
import { sessionDateLabel } from "@/lib/logging/session";
import { cardioSeconds } from "@/lib/logging/cardio";
import { useUnits } from "@/lib/profile/units-context";
import { loadIn } from "@/lib/units";
import { refusedRowDeletes, unsyncedIds } from "@/lib/logging/offline-view";
import { useDayLabels } from "@/lib/logging/use-day-labels";
import { Button } from "@/components/ui/button";
import { dismissFailed, subscribeToQueue } from "@/lib/offline/client";
import type { QueuedOp } from "@/lib/offline/queue";
import { readHistoryView, type HistoryView } from "@/lib/video/my-clips";
import { cn } from "@/lib/cn";
import { ClipsView } from "./clips-view";

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
 *
 * Clips (F13) is the other reading of the same log: every set the athlete
 * filmed, as a grid of posters. A "Sessions | Clips" switch at the top rather
 * than a fifth tab -- the tab bar stays at four -- and in the URL
 * (`?view=clips`), so coming Back from a clip lands on the grid, not on
 * Sessions. Swapped with `replaceState`, so flipping between the two does not
 * stack entries Back would have to walk through, and the F7 transition reads
 * a query-only change as no move at all.
 */
export function HistoryScreen() {
  const params = useSearchParams();
  const [view, setView] = useState<HistoryView>(() => readHistoryView(params.get("view")));
  // Back/forward onto a different ?view, or a link to one.
  const fromUrl = readHistoryView(params.get("view"));
  const [lastUrlView, setLastUrlView] = useState(fromUrl);
  if (fromUrl !== lastUrlView) {
    setLastUrlView(fromUrl);
    setView(fromUrl);
  }

  const choose = (next: HistoryView) => {
    if (next === view) return;
    setView(next);
    const url = new URL(window.location.href);
    if (next === "clips") url.searchParams.set("view", "clips");
    else url.searchParams.delete("view");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  };

  return (
    <div className="pt-8 flex flex-1 flex-col gap-5 pb-6">
      <header className="flex flex-col gap-3">
        <h1 className="m-0 text-display font-semibold">History</h1>
        <ViewSwitch value={view} onChange={choose} />
      </header>
      {view === "clips" ? <ClipsView /> : <SessionsView />}
    </div>
  );
}

const VIEWS: ReadonlyArray<{ value: HistoryView; label: string }> = [
  { value: "sessions", label: "Sessions" },
  { value: "clips", label: "Clips" },
];

/**
 * A two-way segmented switch. Buttons with `aria-pressed` in a labelled group,
 * the same pattern as Lift Detail's chart range, rather than the coach's
 * `Tabs` (coach motion, and a tablist promises arrow-key panels this is not).
 */
function ViewSwitch({ value, onChange }: { value: HistoryView; onChange: (next: HistoryView) => void }) {
  return (
    <div role="group" aria-label="Show" className="flex gap-1 rounded-chip bg-surface-2 p-1">
      {VIEWS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "tap h-9 flex-1 rounded-chip text-ui",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line",
            value === option.value ? "bg-background font-semibold text-foreground" : "text-muted",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function SessionsView() {
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
      // F23: cardio time, from the same sets.
      (sessionId) => cardioSeconds(grouped.get(sessionId) ?? []),
    );
    return groupByWeek(cards);
  }, [sessions, sets, ops, nameOf, dayLabels]);

  const shown = useMemo(() => filterByExercise(weeks, query), [weeks, query]);
  const hasAny = weeks.some((week) => week.sessions.length > 0);

  return (
    <>
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
                      {cardStatsLine(
                        card,
                        card.tonnageKg > 0 ? `${formatTonnage(loadIn(card.tonnageKg, unit))} ${unit}` : null,
                      )}
                    </CardMeta>
                  </Card>
                </Link>
              ))}
            </section>
          ))}
        </div>
      )}
    </>
  );
}
