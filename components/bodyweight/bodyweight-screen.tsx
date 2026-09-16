"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { TextField } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { useSession } from "@/lib/auth/session-context";
import {
  AVERAGE_DAYS,
  averageSeries,
  dayKey,
  inRange,
  latestEntry,
  RANGES,
  trend,
  weightRejectionMessage,
  type BodyweightEntry,
  type Range,
} from "@/lib/bodyweight/bodyweight";
import { fetchBodyweight, logBodyweight } from "@/lib/bodyweight/store";
import { BodyweightChart } from "./bodyweight-chart";

/**
 * The Bodyweight screen.
 *
 * It exists for a reason Ruairi gave directly: he currently has to ask athletes
 * what they weigh. So the job is not to build a weight tracker, it is to make
 * the number appear on his Athlete View without him asking -- which means the
 * logging flow has to be short enough that people keep doing it.
 *
 * One field, prefilled with the last value, and confirm. A plain numeric input
 * rather than the logging screen's `NumberPad`: that component carries a
 * warm-up toggle and a next-field flow that mean nothing here, and bending it
 * to fit would put logging-screen concepts on a screen that has none.
 * `inputMode="decimal"` gets the phone's own pad, which is the same keys.
 *
 * DOTS is Order 37 and is deliberately absent rather than stubbed.
 */

type State =
  | { status: "loading" }
  | { status: "ready"; entries: BodyweightEntry[] }
  | { status: "failed" };

const RECENT = 7;

const dayLabel = (key: string): string => {
  const [year, month, day] = key.split("-").map(Number);
  if (!year || !month || !day) return key;
  return new Date(year, month - 1, day).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
};

export function BodyweightScreen() {
  const { state: session } = useSession();
  const athleteId = session.status === "signed-in" ? session.user.id : null;

  const [state, setState] = useState<State>({ status: "loading" });
  const [range, setRange] = useState<Range>(30);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!athleteId) return;
    const entries = await fetchBodyweight(athleteId);
    setState({ status: "ready", entries });
  }, [athleteId]);

  useEffect(() => {
    if (!athleteId) return;
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
    return <p className="pt-safe-8 m-0 p-5 text-body text-muted" aria-busy>Loading…</p>;
  }

  if (state.status === "failed") {
    return (
      <div className="pt-safe-8 flex flex-col gap-4 p-5">
        <Header />
        <EmptyState
          title="Couldn't load your weigh-ins"
          body="They're safe — this is a connection problem, not a lost record. Try again in a moment."
        />
      </div>
    );
  }

  const { entries } = state;
  const today = dayKey();
  const newest = latestEntry(entries);
  const summary = trend(entries, AVERAGE_DAYS, today);
  const visible = inRange(entries, range, today);
  const smoothed = averageSeries(entries, visible);

  const submit = async () => {
    if (!athleteId) return;
    const parsed = Number(draft.trim());
    setSaving(true);
    try {
      const outcome = await logBodyweight(athleteId, parsed, today);
      if (!outcome.ok) {
        setError(
          outcome.reason === "failed"
            ? "That didn't save. Your number is still here — try again."
            : weightRejectionMessage(outcome),
        );
        return;
      }
      setError(null);
      setDraft("");
      await load();
    } finally {
      setSaving(false);
    }
  };

  const loggedToday = entries.some((entry) => entry.measuredOn === today);

  return (
    <div className="pt-safe-8 flex flex-col gap-6 p-5 pb-8">
      <Header />

      {newest ? (
        <div className="flex flex-col gap-1">
          <p className="m-0 text-display font-bold tabular-nums">
            {newest.weightKg.toFixed(1)} <span className="text-title font-semibold text-muted">kg</span>
          </p>
          {summary ? null : (
            // `trend` gives nothing once the last weigh-in falls outside the
            // window, which is right -- a "7-day average" after three weeks
            // away is a lie with a number attached. But then the big number
            // above needs its date, or it reads as this morning's.
            <p className="m-0 text-ui text-muted">
              Last weighed {dayLabel(newest.measuredOn)}
            </p>
          )}
          {summary ? (
            <p className="m-0 text-ui text-muted tabular-nums">
              {AVERAGE_DAYS}-day average {summary.average.kg.toFixed(1)}
              {summary.changeKg === null ? null : (
                <span className={summary.changeKg >= 0 ? "" : "text-muted"}>
                  {" "}
                  {summary.changeKg >= 0 ? "+" : "−"}
                  {Math.abs(summary.changeKg).toFixed(1)}
                </span>
              )}
              {/* Said plainly rather than implied. A "7-day average" from two
                  weigh-ins is a real number and not a precise one. */}
              {summary.average.count < AVERAGE_DAYS ? (
                <span className="text-muted-2"> · from {summary.average.count}</span>
              ) : null}
            </p>
          ) : null}
        </div>
      ) : null}

      {visible.length >= 2 ? (
        <div className="flex flex-col gap-2">
          <BodyweightChart
            points={visible.map((entry) => ({ measuredOn: entry.measuredOn, kg: entry.weightKg }))}
            average={smoothed}
            label={`Bodyweight over the last ${range === "all" ? "of your history" : `${range} days`}`}
          />
          <div className="flex gap-2" role="group" aria-label="Range">
            {[...RANGES, "all" as const].map((option) => (
              <button
                key={String(option)}
                type="button"
                aria-pressed={range === option}
                onClick={() => setRange(option)}
                className={cn(
                  "h-9 rounded-chip px-3 text-ui font-medium",
                  range === option
                    ? "bg-accent-fill text-on-accent"
                    : "border border-border text-muted",
                )}
              >
                {option === "all" ? "all" : `${option}d`}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <label htmlFor="weight" className="text-ui text-muted">
          {loggedToday ? "Change today's weight" : "Log today's weight"}
        </label>
        <div className="flex gap-2">
          <TextField
            id="weight"
            value={draft}
            inputMode="decimal"
            // Prefilled with the last value, per the blueprint: most mornings
            // the number barely moves, and typing it from scratch every day is
            // how a daily habit stops being daily.
            placeholder={newest ? newest.weightKg.toFixed(1) : "82.4"}
            invalid={Boolean(error)}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit();
            }}
          />
          <Button onClick={() => void submit()} disabled={saving || draft.trim() === ""}>
            Save
          </Button>
        </div>
        {error ? <p className="m-0 text-ui text-foreground">{error}</p> : null}
      </div>

      {entries.length === 0 ? (
        <EmptyState
          title="No weigh-ins yet"
          body="Your coach can see this. It saves them asking, and it's what a bodyweight-relative score is calculated from."
        />
      ) : (
        <section className="flex flex-col gap-2">
          <h2 className="m-0 text-ui font-semibold text-muted">Recent</h2>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {entries.slice(0, RECENT).map((entry) => (
              <li key={entry.id} className="flex justify-between text-body tabular-nums">
                <span className="text-muted">{dayLabel(entry.measuredOn)}</span>
                <span>{entry.weightKg.toFixed(1)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Header() {
  return (
    <div className="flex items-baseline gap-3">
      <Link href="/me" className="text-ui text-muted">
        ‹ Me
      </Link>
      <h1 className="m-0 text-display font-semibold">Bodyweight</h1>
    </div>
  );
}
