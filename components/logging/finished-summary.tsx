"use client";

import { Button } from "@/components/ui/button";
import { PrCelebration } from "@/components/logging/pr-celebration";
import { formatCardioTotal } from "@/lib/logging/cardio";
import { formatNumber } from "@/lib/logging/prefill";
import type { SessionSummary } from "@/lib/logging/session";
import type { SessionPr } from "@/lib/strength/pr";
import { loadNumber, type UnitPreference } from "@/lib/units";

/**
 * What the athlete sees on finishing.
 *
 * The records broken today, per the blueprint, one line per exercise per
 * kind (the best of the day, not every step up to it), except rep records,
 * one per load (sessionPrs in lib/strength/pr.ts). Measured against the
 * bests from before the session, so it agrees with the badges on the rows.
 * Queued videos still belong here too and are not built yet.
 *
 * F22: with a record, the records lead (`PrCelebration`) and the totals step
 * back to a smaller figure under them. Without one this is the screen as it
 * was, class for class. Moved out of log-screen.tsx so /design can render
 * the real thing in each state.
 */
export function FinishedSummary({
  summary,
  prs,
  nameFor,
  unit,
  onDone,
}: {
  summary: SessionSummary;
  prs: readonly SessionPr[];
  nameFor: (id: string) => string | null;
  unit: UnitPreference;
  onDone: () => void;
}) {
  const kg = (value: number) => (unit === "kg" ? `${formatNumber(value)} kg` : `${loadNumber(value, unit)} ${unit}`);
  const quiet = prs.length > 0;
  return (
    <div className="pt-8 flex flex-1 flex-col gap-5 pb-6">
      <h1 className="m-0 text-display font-semibold">Session done</h1>
      <PrCelebration prs={prs} nameFor={nameFor} load={kg} />
      <dl className="m-0 grid grid-cols-2 gap-3">
        <Stat label="Sets" value={String(summary.setCount)} quiet={quiet} />
        <Stat label="Tonnage" value={kg(summary.tonnageKg)} quiet={quiet} />
        <Stat label="Exercises" value={String(summary.exerciseCount)} quiet={quiet} />
        <Stat label="Warm-ups" value={String(summary.warmupCount)} quiet={quiet} />
      </dl>
      {summary.cardioSeconds ? (
        // F23: cardio is not in the sets or the tonnage above, so it gets a
        // line of its own -- small, because the session's work is the lifting.
        <p data-cardio-total="" className="m-0 -mt-2 font-mono text-label uppercase text-muted">
          Cardio &middot; {formatCardioTotal(summary.cardioSeconds)}
        </p>
      ) : null}
      <div className="mt-auto">
        <Button size="xl" block onClick={onDone}>
          Back to Today
        </Button>
      </div>
    </div>
  );
}

/**
 * One total. `quiet` when records lead the screen: the figure drops from
 * display (26px) to value-sm (19px) and the tile tightens, so the totals read
 * as the footnote to the records rather than competing with them.
 */
function Stat({ label, value, quiet = false }: { label: string; value: string; quiet?: boolean }) {
  return (
    <div className={`flex flex-col gap-1 rounded-card border border-border bg-surface ${quiet ? "px-4 py-3" : "p-4"}`}>
      <dt className="m-0 font-mono text-label uppercase text-muted-2">{label}</dt>
      <dd className={`m-0 ${quiet ? "text-value-sm" : "text-display"} font-semibold tabular-nums`}>{value}</dd>
    </div>
  );
}
