"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { E1rmChart } from "@/components/charts/e1rm-chart";
import { useSession } from "@/lib/auth/session-context";
import { useExerciseLibrary } from "@/lib/exercises/library-context";
import {
  canChart,
  headline,
  personalRecords,
  pointsInRange,
  RANGES,
  type Range,
  type WeekPoint,
} from "@/lib/strength/lift";
import { fetchLiftWeeks, fetchRecentSetsFor, type LiftSet } from "@/lib/strength/lift-store";
import { formatNumber } from "@/lib/logging/prefill";
import { cn } from "@/lib/cn";

/**
 * Lift Detail. One lift, all of it.
 *
 * Reached from Log Session, History or Coach Feedback -- never the tab bar,
 * because it is a screen you arrive at holding a question about one lift rather
 * than one you browse to.
 *
 * Everything that is an aggregate reads stats_rollups. The recent-sets list
 * reads raw sets, which is a page of rows rather than a number.
 *
 * Not here: the personal RPE curve panel. It needs `personal_rpe_curves` and
 * the RPE engine at phase 2b, and its own blueprint carries an open question
 * about the sample threshold -- a curve fitted to six sets is noise presented
 * as insight. Volume and tonnage charts are deliberately absent too; they are
 * cheap to add from rollups later and this screen is not the bottleneck.
 */

const RANGE_LABEL: Record<Range, string> = { "8w": "8w", "12w": "12w", "6m": "6m", all: "all" };

export function LiftScreen({ exerciseId }: { exerciseId: string }) {
  const router = useRouter();
  const { state: sessionState } = useSession();
  const { state: library } = useExerciseLibrary();

  const [weeks, setWeeks] = useState<WeekPoint[] | null>(null);
  const [sets, setSets] = useState<LiftSet[]>([]);
  const [range, setRange] = useState<Range>("12w");

  const athleteId = sessionState.status === "signed-in" ? sessionState.user.id : null;
  const name = library.exercises.find((e) => e.id === exerciseId)?.name ?? exerciseId;

  useEffect(() => {
    if (!athleteId) return;
    let cancelled = false;
    void (async () => {
      const [loadedWeeks, loadedSets] = await Promise.all([
        fetchLiftWeeks(athleteId, exerciseId).catch(() => [] as WeekPoint[]),
        fetchRecentSetsFor(athleteId, exerciseId).catch(() => [] as LiftSet[]),
      ]);
      if (cancelled) return;
      setWeeks(loadedWeeks);
      setSets(loadedSets);
    })();
    return () => {
      cancelled = true;
    };
  }, [athleteId, exerciseId]);

  const inRange = useMemo(() => pointsInRange(weeks ?? [], range), [weeks, range]);
  const summary = useMemo(() => headline(inRange), [inRange]);
  // All-time, not the selected range: a record that changed when you tapped
  // "8w" would not be a record.
  const records = useMemo(() => personalRecords(weeks ?? []), [weeks]);
  const showChart = canChart(inRange);

  return (
    <div className="pt-safe-8 flex flex-1 flex-col gap-6 pb-6">
      <header className="flex flex-col items-start gap-1">
        <Button variant="ghost" size="sm" onClick={() => router.back()} aria-label="Back">
          ← Back
        </Button>
        <h1 className="m-0 text-display font-semibold">{name}</h1>
      </header>

      {weeks === null ? null : weeks.length === 0 ? (
        <EmptyState
          title="Nothing logged for this lift yet"
          body="Log a set against it and the progression shows up here."
        />
      ) : (
        <>
          <section aria-label="Estimated 1RM" className="flex flex-col gap-3">
            <h2 className="m-0 font-mono text-label uppercase text-muted-2">Estimated 1RM</h2>
            <p className="m-0 flex items-baseline gap-3">
              <span className="text-display font-semibold tabular-nums">
                {summary.currentE1rmKg === null ? "—" : `${formatNumber(summary.currentE1rmKg)} kg`}
              </span>
              {summary.changeKg !== null ? (
                <span className="font-mono text-meta text-muted">
                  {summary.changeKg >= 0 ? "+" : "−"}
                  {formatNumber(Math.abs(summary.changeKg))} ({RANGE_LABEL[range]})
                </span>
              ) : null}
            </p>

            {/* Fewer than three points and the chart is hidden, not emptied. A
                two-point line draws a trend out of a coincidence. */}
            {showChart ? (
              <E1rmChart
                points={inRange}
                label={`Estimated 1RM for ${name} over the last ${RANGE_LABEL[range]}`}
              />
            ) : (
              <p className="m-0 text-sm text-muted">
                Not enough sessions to chart yet.
              </p>
            )}

            <div role="group" aria-label="Chart range" className="flex gap-2">
              {RANGES.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setRange(option)}
                  aria-pressed={range === option}
                  className={cn(
                    "h-9 flex-1 rounded-chip font-mono text-label uppercase",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line",
                    range === option
                      ? "bg-accent-fill font-bold text-on-accent"
                      : "bg-surface-2 text-muted",
                  )}
                >
                  {RANGE_LABEL[option]}
                </button>
              ))}
            </div>
          </section>

          <section aria-label="Personal records" className="flex flex-col gap-2">
            <h2 className="m-0 font-mono text-label uppercase text-muted-2">Personal records</h2>
            <dl className="m-0 flex flex-col gap-1.5">
              <Record
                label="Heaviest single"
                value={
                  records.heaviestSingleKg === null
                    ? null
                    : `${formatNumber(records.heaviestSingleKg)} × ${records.heaviestSingleReps ?? 1}`
                }
              />
              <Record
                label="Best estimated"
                value={records.bestE1rmKg === null ? null : `${formatNumber(records.bestE1rmKg)} kg`}
              />
              <Record
                label="Most reps"
                value={
                  records.mostReps === null
                    ? null
                    : `${formatNumber(records.mostRepsLoadKg ?? 0)} × ${records.mostReps}`
                }
              />
            </dl>
          </section>

          <section aria-label="Recent sets" className="flex flex-col gap-2">
            <h2 className="m-0 font-mono text-label uppercase text-muted-2">Recent sets</h2>
            {sets.length === 0 ? (
              <p className="m-0 text-sm text-muted">No working sets logged against this lift yet.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {sets.map((set) => (
                  <li
                    key={set.clientSetId}
                    className="flex items-baseline justify-between gap-3 border-b border-border pb-1.5 last:border-b-0"
                  >
                    <span className="font-mono text-meta text-muted-2">{dayLabel(set.loggedAt)}</span>
                    <span className="flex-1 text-body tabular-nums">
                      {formatNumber(set.loadKg)} × {set.reps}
                    </span>
                    <span className="font-mono text-meta text-muted">
                      {set.rpe === null ? "" : `RPE ${formatNumber(set.rpe)}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Record({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="m-0 text-body text-muted">{label}</dt>
      <dd className="m-0 text-body font-semibold tabular-nums">{value ?? "—"}</dd>
    </div>
  );
}

/** "11 Sep". Hand-rolled for the same reason the session headers are. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayLabel = (date: Date): string =>
  `${String(date.getDate()).padStart(2, "0")} ${MONTHS[date.getMonth()]}`;
