"use client";

import { useEffect, useMemo, useState } from "react";
import { E1rmChart } from "@/components/charts/e1rm-chart";
import { Tabs } from "@/components/ui/tabs";
import { TextField } from "@/components/ui/input";
import { fetchExerciseLibrary } from "@/lib/exercises/library";
import { liftTabs, shortDate, type LiftTab } from "@/lib/coach/athlete-view";
import { fetchAthleteRollups } from "@/lib/coach/athlete-view-store";
import {
  canChart,
  headline,
  personalRecords,
  pointsInRange,
  RANGES,
  type Range,
} from "@/lib/strength/lift";
import { fetchRecentSetsFor, type LiftSet } from "@/lib/strength/lift-store";
import { formatNumber } from "@/lib/logging/prefill";
import { cn } from "@/lib/cn";

/**
 * Per-lift tabs, mirroring the athlete's own Lift Detail on a wider screen --
 * the blueprint's words. Same rules as that screen, from the same pure module:
 * the chart and records come from `stats_rollups`, never raw sets; fewer than
 * three weeks hides the chart rather than drawing a trend out of a
 * coincidence; records are all-time, not the selected range.
 *
 * Every rollup for every lift is one paged read, so switching tabs costs
 * nothing but the recent-sets list for the lift chosen.
 *
 * Not here: the personal RPE curve. `personal_rpe_curves` is not built, and
 * the blueprint's own threshold for showing one is still [SME to confirm].
 */

type State =
  | { status: "loading" }
  | { status: "ready"; tabs: LiftTab[] }
  | { status: "failed" };

/** Past this many lifts the tab row gets a filter. Type, never hunt. */
const FILTER_AFTER = 8;

export function AthleteLifts({ athleteId }: { athleteId: string }) {
  const [state, setState] = useState<State & { for?: string }>({ status: "loading" });
  const [selected, setSelected] = useState<string | null>(null);
  const [range, setRange] = useState<Range>("12w");
  const [filter, setFilter] = useState("");
  const [sets, setSets] = useState<{ key: string; sets: LiftSet[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [weeks, library] = await Promise.all([
          fetchAthleteRollups(athleteId),
          fetchExerciseLibrary(athleteId),
        ]);
        if (!cancelled) setState({ status: "ready", tabs: liftTabs(weeks, library), for: athleteId });
      } catch {
        if (!cancelled) setState({ status: "failed", for: athleteId });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [athleteId]);

  const current: State = state.for === athleteId ? state : { status: "loading" };
  const tabs = useMemo(
    () => (state.for === athleteId && state.status === "ready" ? state.tabs : []),
    [state, athleteId],
  );
  const shownTabs = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return needle ? tabs.filter((tab) => tab.name.toLowerCase().includes(needle)) : tabs;
  }, [tabs, filter]);
  const active = tabs.find((tab) => tab.exerciseId === selected) ?? shownTabs[0] ?? null;
  const activeId = active?.exerciseId ?? null;
  const setsKey = activeId ? `${athleteId}/${activeId}` : null;

  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    void fetchRecentSetsFor(athleteId, activeId)
      .catch(() => [] as LiftSet[])
      .then((loaded) => {
        if (!cancelled) setSets({ key: `${athleteId}/${activeId}`, sets: loaded });
      });
    return () => {
      cancelled = true;
    };
  }, [athleteId, activeId]);

  return (
    <section className="flex flex-col gap-3" aria-labelledby="athlete-lifts-heading">
      <h2 id="athlete-lifts-heading" className="m-0 text-label uppercase tracking-wide text-muted">
        Lifts
      </h2>

      {current.status === "loading" ? <p className="m-0 text-ui text-muted">Loading…</p> : null}
      {current.status === "failed" ? (
        <p className="m-0 text-ui text-muted">Couldn’t load their lifts. Refresh to try again.</p>
      ) : null}
      {current.status === "ready" && tabs.length === 0 ? (
        <p className="m-0 text-ui text-muted-2">
          Nothing logged yet. Each lift gets a tab here, with its e1RM trend and records, once they train it.
        </p>
      ) : null}

      {active ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            {tabs.length > FILTER_AFTER ? (
              <TextField
                type="search"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                aria-label="Filter lifts"
                placeholder="Filter lifts"
                className="h-[34px] w-[160px] text-ui"
              />
            ) : null}
            <div className="min-w-0 overflow-x-auto">
              <Tabs
                label="Lifts"
                tabs={shownTabs.map((tab) => ({ value: tab.exerciseId, label: tab.name }))}
                value={active.exerciseId}
                onChange={setSelected}
              />
            </div>
          </div>
          <LiftPanel
            tab={active}
            range={range}
            onRange={setRange}
            sets={sets?.key === setsKey ? sets.sets : null}
          />
        </>
      ) : null}
    </section>
  );
}

function LiftPanel({
  tab,
  range,
  onRange,
  sets,
}: {
  tab: LiftTab;
  range: Range;
  onRange: (range: Range) => void;
  sets: LiftSet[] | null;
}) {
  const inRange = pointsInRange(tab.weeks, range);
  const summary = headline(inRange);
  const records = personalRecords(tab.weeks);

  return (
    <div role="tabpanel" aria-label={tab.name} className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-6">
      <div className="flex flex-col gap-3">
        <p className="m-0 flex items-baseline gap-3">
          <span className="text-display font-semibold tabular-nums">
            {summary.currentE1rmKg === null ? "—" : `${formatNumber(summary.currentE1rmKg)} kg`}
          </span>
          <span className="text-ui text-muted">e1RM</span>
          {summary.changeKg !== null ? (
            <span className="font-mono text-meta text-muted">
              {summary.changeKg >= 0 ? "+" : "−"}
              {formatNumber(Math.abs(summary.changeKg))} ({range})
            </span>
          ) : null}
        </p>

        {canChart(inRange) ? (
          <E1rmChart points={inRange} label={`Estimated 1RM for ${tab.name} over the last ${range}`} />
        ) : (
          <p className="m-0 text-ui text-muted">
            Not enough weeks in this range to chart yet. Three is the minimum; two points draw a trend out of a
            coincidence.
          </p>
        )}

        <div role="group" aria-label="Chart range" className="flex gap-1.5">
          {RANGES.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onRange(option)}
              aria-pressed={range === option}
              className={cn(
                "h-8 rounded-chip px-3 font-mono text-label uppercase",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line",
                range === option ? "bg-accent-fill font-bold text-on-accent" : "bg-surface-2 text-muted",
              )}
            >
              {option}
            </button>
          ))}
        </div>

        <dl className="m-0 grid grid-cols-3 gap-3 pt-1">
          <Record
            label="Heaviest single"
            value={
              records.heaviestSingleKg === null
                ? null
                : `${formatNumber(records.heaviestSingleKg)} × ${records.heaviestSingleReps ?? 1}`
            }
          />
          <Record
            label="Best e1RM"
            value={records.bestE1rmKg === null ? null : `${formatNumber(records.bestE1rmKg)} kg`}
          />
          <Record
            label="Most reps"
            value={
              records.mostReps === null ? null : `${formatNumber(records.mostRepsLoadKg ?? 0)} × ${records.mostReps}`
            }
          />
        </dl>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="m-0 font-mono text-label uppercase text-muted-2">Recent working sets</h3>
        {sets === null ? (
          <p className="m-0 text-ui text-muted">Loading…</p>
        ) : sets.length === 0 ? (
          <p className="m-0 text-ui text-muted">No working sets on this lift yet.</p>
        ) : (
          <ul className="m-0 flex max-h-[260px] list-none flex-col overflow-y-auto p-0">
            {sets.slice(0, 20).map((set) => (
              <li
                key={set.clientSetId}
                className="grid grid-cols-[64px_1fr_auto] items-baseline gap-3 border-b border-border py-1.5 last:border-b-0"
              >
                <span className="font-mono text-meta text-muted-2">{shortDate(set.loggedAt)}</span>
                <span className="text-ui tabular-nums">
                  {formatNumber(set.loadKg)} × {set.reps}
                </span>
                <span className="font-mono text-meta text-muted">
                  {set.rpe === null ? "" : `RPE ${formatNumber(set.rpe)}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Record({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="m-0 font-mono text-label-xs uppercase text-muted-2">{label}</dt>
      <dd className="m-0 text-body font-semibold tabular-nums">{value ?? "—"}</dd>
    </div>
  );
}
