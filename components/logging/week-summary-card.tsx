"use client";

import { useEffect, useMemo, useState } from "react";
import type { SessionRecord } from "@/lib/logging/session";
import { isEmptyWeek, summariseWeek, type WeekRollupRow } from "@/lib/logging/week-summary";
import { fetchWeekRollupsFor } from "@/lib/logging/week-summary-store";
import { formatNumber } from "@/lib/logging/prefill";
import { loadNumber, type UnitPreference } from "@/lib/units";

/**
 * "This week" on the Log landing, above Start.
 *
 * Read-only and cheap: one rollup query (idx_athlete_week), plus the session
 * rows the athlete surface already holds for Today. Nothing here is computed
 * from raw sets -- see lib/logging/week-summary.ts.
 *
 * Offline is normal: with no signal the session count still shows, from what
 * is already in memory, and the two rollup figures read "—" with one quiet
 * line rather than an error.
 */

type RollupState =
  | { status: "loading" }
  | { status: "ready"; rows: WeekRollupRow[] }
  | { status: "failed" };

export interface WeekSummaryCardProps {
  athleteId: string | null;
  sessions: readonly SessionRecord[];
  /** The session list has not been read yet, so its count would be a guess. */
  sessionsLoading?: boolean;
  unit: UnitPreference;
  /** Injected by tests; the real read otherwise. */
  load?: (athleteId: string) => Promise<WeekRollupRow[]>;
}

export function WeekSummaryCard({
  athleteId,
  sessions,
  sessionsLoading = false,
  unit,
  load = fetchWeekRollupsFor,
}: WeekSummaryCardProps) {
  const [rollups, setRollups] = useState<RollupState>({ status: "loading" });

  useEffect(() => {
    if (!athleteId) return;
    let cancelled = false;
    void (async () => {
      try {
        const rows = await load(athleteId);
        if (!cancelled) setRollups({ status: "ready", rows });
      } catch {
        if (!cancelled) setRollups({ status: "failed" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [athleteId, load]);

  const summary = useMemo(
    () => summariseWeek(sessions, rollups.status === "ready" ? rollups.rows : []),
    [sessions, rollups],
  );

  const loading = rollups.status === "loading" || sessionsLoading;
  const totals = rollups.status === "ready";
  const tonnage = unit === "kg" ? formatNumber(summary.tonnageKg) : loadNumber(summary.tonnageKg, unit);

  return (
    <section
      aria-label="This week"
      aria-busy={loading}
      className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
    >
      <h2 className="m-0 font-mono text-label uppercase text-muted-2">This week</h2>
      <dl className="m-0 grid grid-cols-3 gap-3">
        <WeekStat label="Sessions" value={sessionsLoading ? "—" : String(summary.sessions)} />
        <WeekStat label="Sets" value={totals ? String(summary.sets) : "—"} />
        <WeekStat label={`Tonnage, ${unit}`} value={totals ? tonnage : "—"} />
      </dl>
      {rollups.status === "failed" ? (
        <p className="m-0 text-caption text-muted">Set totals load when there&rsquo;s signal.</p>
      ) : !loading && isEmptyWeek(summary) ? (
        <p className="m-0 text-caption text-muted">Nothing logged yet this week.</p>
      ) : null}
    </section>
  );
}

function WeekStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="m-0 font-mono text-label-xs uppercase text-muted-2">{label}</dt>
      <dd className="m-0 truncate text-value-sm font-semibold tabular-nums text-foreground">{value}</dd>
    </div>
  );
}
