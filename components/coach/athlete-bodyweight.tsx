"use client";

import { useEffect, useState } from "react";
import { BodyweightChart } from "@/components/bodyweight/bodyweight-chart";
import {
  AVERAGE_DAYS,
  averageSeries,
  dayKey,
  inRange,
  latestEntry,
  trend,
  type BodyweightEntry,
} from "@/lib/bodyweight/bodyweight";
import { fetchBodyweight } from "@/lib/bodyweight/store";

/**
 * The athlete's bodyweight, on the coach's screen.
 *
 * This panel is the feature. Ruairi asked for bodyweight because he currently
 * has to ask people what they weigh -- the athlete's own screen is how the
 * number gets there, and this is why it was wanted. It is the reason bodyweight
 * survived when the rest of the competition layer was cut.
 *
 * Read-only, and through the circle team like everything else the coach sees.
 * There is no branch anywhere for who is asking, and it stops working the
 * moment a link is revoked.
 */

type State =
  | { status: "loading" }
  | { status: "ready"; entries: BodyweightEntry[] }
  | { status: "failed" };

/** Ninety days: long enough to show a cut, short enough to still have shape. */
const WINDOW = 90;

export function AthleteBodyweight({ athleteId }: { athleteId: string }) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setState({ status: "loading" });
      try {
        const entries = await fetchBodyweight(athleteId);
        if (!cancelled) setState({ status: "ready", entries });
      } catch {
        if (!cancelled) setState({ status: "failed" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [athleteId]);

  if (state.status === "loading") {
    return <p className="m-0 text-ui text-muted" aria-busy>Loading bodyweight…</p>;
  }
  // Quiet on failure: one panel on a screen, and an error box where a chart was
  // expected is worse than an absence.
  if (state.status === "failed") return null;

  const { entries } = state;
  const today = dayKey();
  const summary = trend(entries, AVERAGE_DAYS, today);
  const visible = inRange(entries, WINDOW, today);
  const smoothed = averageSeries(entries, visible);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="m-0 text-ui font-semibold text-muted">Bodyweight</h2>

      {summary ? (
        <p className="m-0 text-title font-semibold tabular-nums">
          {summary.latestKg.toFixed(1)} kg
          <span className="ml-3 text-ui font-medium text-muted">
            {AVERAGE_DAYS}-day {summary.average.kg.toFixed(1)}
            {summary.changeKg === null
              ? null
              : ` ${summary.changeKg >= 0 ? "+" : "−"}${Math.abs(summary.changeKg).toFixed(1)}`}
          </span>
        </p>
      ) : entries.length > 0 ? (
        // Something logged, but not recently enough for an average. Said
        // plainly, because a coach seeing a bare number would read it as
        // current -- and a stale bodyweight is how a weight class gets missed.
        <p className="m-0 text-ui text-muted">
          {latestEntry(entries)!.weightKg.toFixed(1)} kg, last weighed{" "}
          {new Date(latestEntry(entries)!.measuredOn).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
          })}
          . Nothing in the last {AVERAGE_DAYS} days.
        </p>
      ) : (
        <p className="m-0 text-ui text-muted-2">
          Nothing logged yet. They can add it from their Profile screen.
        </p>
      )}

      {visible.length >= 2 ? (
        <BodyweightChart
          points={visible.map((entry) => ({ measuredOn: entry.measuredOn, kg: entry.weightKg }))}
          average={smoothed}
          label="Their bodyweight over the last 90 days"
        />
      ) : null}
    </section>
  );
}
