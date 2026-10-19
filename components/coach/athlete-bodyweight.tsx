"use client";

import { useEffect, useId, useState } from "react";
import { BodyweightChart } from "@/components/bodyweight/bodyweight-chart";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/cn";
import {
  AVERAGE_DAYS,
  averageSeries,
  dayKey,
  inRange,
  latestEntry,
  RANGES,
  trend,
  type BodyweightEntry,
  type Range,
} from "@/lib/bodyweight/bodyweight";
import { fetchBodyweight } from "@/lib/bodyweight/store";

/**
 * The athlete's bodyweight, on the coach's screen.
 *
 * This is the feature. Ruairi asked for bodyweight because he currently has to
 * ask people what they weigh -- the athlete's own screen is how the number
 * gets there, and this is why it was wanted. It is the reason bodyweight
 * survived when the rest of the competition layer was cut.
 *
 * Two parts since Joey's review of the dashboard (16 Oct 2026). The figure
 * sits in the page header, beside the name -- current weight and the 7-day
 * average -- because it is read every visit and was buried under three panels.
 * It is a button: the history behind it, the same chart and rolling average
 * the athlete's own Bodyweight screen draws, opens over the page for checking
 * a cut. Over the page and in the URL (`?view=bodyweight`), so Back closes it
 * and the dashboard underneath is still loaded when it does.
 *
 * Read-only, and through the circle team like everything else the coach sees.
 * There is no branch anywhere for who is asking, and it stops working the
 * moment a link is revoked.
 */

type State =
  | { status: "loading" }
  | { status: "ready"; entries: BodyweightEntry[] }
  | { status: "failed" };

/** How many weigh-ins the history lists under the chart. Two weeks of dailies. */
const HISTORY_ROWS = 14;

const dayLabel = (key: string): string => {
  const [year, month, day] = key.split("-").map(Number);
  if (!year || !month || !day) return key;
  return new Date(year, month - 1, day).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

const signed = (kg: number) => `${kg >= 0 ? "+" : "−"}${Math.abs(kg).toFixed(1)}`;

export interface AthleteBodyweightProps {
  athleteId: string;
  /** The history is showing. Driven by the URL; see use-athlete-panel.ts. */
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}

export function AthleteBodyweight({ athleteId, open, onOpen, onClose }: AthleteBodyweightProps) {
  const [state, setState] = useState<State & { for?: string }>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const entries = await fetchBodyweight(athleteId);
        if (!cancelled) setState({ status: "ready", entries, for: athleteId });
      } catch {
        if (!cancelled) setState({ status: "failed", for: athleteId });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [athleteId]);

  const current: State = state.for === athleteId ? state : { status: "loading" };

  if (current.status === "loading") {
    return (
      <span className="text-caption text-muted" aria-busy>
        Loading bodyweight…
      </span>
    );
  }
  // Quiet on failure: one figure in a header, and an error where a number was
  // expected is worse than an absence.
  if (current.status === "failed") return null;

  const { entries } = current;
  const today = dayKey();
  const summary = trend(entries, AVERAGE_DAYS, today);
  const newest = latestEntry(entries);

  if (!newest) {
    return (
      <span className="text-caption text-muted-2">
        No weigh-ins yet. They log them from their Profile screen.
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={onOpen}
        aria-haspopup="dialog"
        className={cn(
          "inline-flex h-10 items-baseline gap-2 self-center rounded-chip border border-border bg-surface px-3 pt-[11px] text-left",
          "md:h-8 md:pt-[7px]",
          "hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line",
        )}
      >
        <span className="font-mono text-label-xs uppercase text-muted-2">Bodyweight</span>
        <span className="text-ui font-semibold tabular-nums">{newest.weightKg.toFixed(1)} kg</span>
        {summary ? (
          <span className="text-caption text-muted tabular-nums">
            {AVERAGE_DAYS}-day {summary.average.kg.toFixed(1)}
            {summary.changeKg === null ? null : ` ${signed(summary.changeKg)}`}
          </span>
        ) : (
          // Something logged, but not recently enough for an average. Dated,
          // because a coach seeing a bare number would read it as current --
          // and a stale bodyweight is how a weight class gets missed.
          <span className="text-caption text-muted">last weighed {dayLabel(newest.measuredOn)}</span>
        )}
        <span aria-hidden className="text-caption text-muted-2">
          ›
        </span>
      </button>
      {open ? <BodyweightHistory entries={entries} today={today} onClose={onClose} /> : null}
    </>
  );
}

function BodyweightHistory({
  entries,
  today,
  onClose,
}: {
  entries: BodyweightEntry[];
  today: string;
  onClose: () => void;
}) {
  const heading = useId();
  // Ninety days first: long enough to show a cut, short enough to still have
  // shape. The athlete's screen opens on 30 because they log daily and read
  // the week; the coach is checking a trend.
  const [range, setRange] = useState<Range>(90);
  const summary = trend(entries, AVERAGE_DAYS, today);
  const visible = inRange(entries, range, today);
  // Over the full history, so the average does not change shape on zoom.
  const smoothed = averageSeries(entries, visible);
  const newest = latestEntry(entries)!;

  return (
    <Dialog labelledBy={heading} onClose={onClose} size="md">
      <div className="flex flex-col gap-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 id={heading} className="m-0 text-label uppercase tracking-wide text-muted">
              Bodyweight
            </h2>
            <p className="m-0 text-display font-bold tabular-nums">{newest.weightKg.toFixed(1)} kg</p>
            {summary ? (
              <p className="m-0 text-ui text-muted tabular-nums">
                {AVERAGE_DAYS}-day average {summary.average.kg.toFixed(1)}
                {summary.changeKg === null ? null : ` ${signed(summary.changeKg)} on the week before`}
                {/* A "7-day average" from two weigh-ins is a real number and
                    not a precise one; said, as on the athlete's screen. */}
                {summary.average.count < AVERAGE_DAYS ? (
                  <span className="text-muted-2"> · from {summary.average.count}</span>
                ) : null}
              </p>
            ) : (
              <p className="m-0 text-ui text-muted">
                Last weighed {dayLabel(newest.measuredOn)}. Nothing in the last {AVERAGE_DAYS} days.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-10 shrink-0 rounded-chip border border-border px-3 text-ui text-muted hover:text-foreground md:h-9 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line"
          >
            Close
          </button>
        </div>

        <div className="flex flex-col gap-2">
          {visible.length >= 2 ? (
            <BodyweightChart
              points={visible.map((entry) => ({ measuredOn: entry.measuredOn, kg: entry.weightKg }))}
              average={smoothed}
              label={`Their bodyweight over ${range === "all" ? "all of their history" : `the last ${range} days`}`}
            />
          ) : (
            <p className="m-0 text-ui text-muted">
              Not enough weigh-ins in this range to draw a line. One weigh-in is a number, not a trend.
            </p>
          )}
          <div className="flex gap-2" role="group" aria-label="Range">
            {[...RANGES, "all" as const].map((option) => (
              <button
                key={String(option)}
                type="button"
                aria-pressed={range === option}
                onClick={() => setRange(option)}
                className={cn(
                  "h-10 rounded-chip px-3 font-mono text-label uppercase md:h-8",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-line",
                  range === option ? "bg-accent-fill font-bold text-on-accent" : "bg-surface-2 text-muted",
                )}
              >
                {option === "all" ? "all" : `${option}d`}
              </button>
            ))}
          </div>
        </div>

        <section className="flex flex-col gap-2" aria-labelledby={`${heading}-recent`}>
          <h3 id={`${heading}-recent`} className="m-0 font-mono text-label uppercase text-muted-2">
            Recent weigh-ins
          </h3>
          <ul className="m-0 grid list-none grid-cols-2 gap-x-4 p-0 md:gap-x-8">
            {entries.slice(0, HISTORY_ROWS).map((entry) => (
              <li
                key={entry.id}
                className="flex justify-between border-b border-border py-1.5 text-ui tabular-nums"
              >
                <span className="text-muted">{dayLabel(entry.measuredOn)}</span>
                <span>{entry.weightKg.toFixed(1)} kg</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Dialog>
  );
}
