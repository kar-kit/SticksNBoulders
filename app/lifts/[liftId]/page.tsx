"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { Query } from "appwrite";
import { useRequireAuth } from "@/lib/use-require-auth";
import { tablesDB } from "@/lib/appwrite";
import { DATABASE_ID, TABLES } from "@/lib/constants";
import type { Lift, WorkoutSet } from "@/lib/types";
import { computeBest1RM, computeRepPRs, epley1RM } from "@/lib/lift-stats";
import { displayWeight } from "@/lib/units";
import OneRepMaxChart from "@/components/OneRepMaxChart";
import PageSpinner from "@/components/PageSpinner";

export default function LiftDetailPage({ params }: { params: Promise<{ liftId: string }> }) {
  const { liftId } = use(params);
  const { user, profile, loading } = useRequireAuth();
  const [lift, setLift] = useState<Lift | null>(null);
  const [sets, setSets] = useState<WorkoutSet[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [liftRow, setRows] = await Promise.all([
        tablesDB.getRow<Lift>(DATABASE_ID, TABLES.lifts, liftId),
        tablesDB.listRows<WorkoutSet>(DATABASE_ID, TABLES.workoutSets, [
          Query.equal("userId", user.$id),
          Query.equal("liftId", liftId),
          Query.orderAsc("date"),
          Query.limit(1000),
        ]),
      ]);
      setLift(liftRow);
      setSets(setRows.rows);
      setLoadingData(false);
    })();
  }, [user, liftId]);

  if (loading || !profile || loadingData) return <PageSpinner />;

  const best1RM = computeBest1RM(sets);
  const repPRs = computeRepPRs(sets);

  const byDay = new Map<string, number>();
  for (const set of sets) {
    if (set.isWarmup) continue;
    const dateKey = set.date.slice(0, 10);
    const estimate = epley1RM(set.weightKg, set.reps);
    const current = byDay.get(dateKey);
    if (current === undefined || estimate > current) byDay.set(dateKey, estimate);
  }
  const chartPoints = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, estimatedKg]) => ({ date, estimatedKg }));

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-5 pt-safe-8 pb-8">
      <Link href="/dashboard" className="text-sm text-accent">
        ← Dashboard
      </Link>
      <h1 className="text-xl font-semibold">{lift?.name}</h1>

      <section className="rounded-2xl bg-surface p-4">
        <p className="text-xs font-medium text-muted">Estimated 1RM</p>
        <p className="mt-1 text-3xl font-semibold text-accent">
          {best1RM ? `${displayWeight(best1RM.estimatedKg, profile.unitPreference)} ${profile.unitPreference}` : "—"}
        </p>
        <div className="mt-3">
          <OneRepMaxChart points={chartPoints} />
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-muted">Rep PRs</h2>
        {repPRs.size === 0 ? (
          <p className="text-sm text-muted">No PRs yet.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {[...repPRs.entries()]
              .sort(([a], [b]) => a - b)
              .map(([reps, weightKg]) => (
                <div key={reps} className="rounded-xl bg-surface p-3 text-center">
                  <p className="text-xs text-muted">{reps} rep{reps === 1 ? "" : "s"}</p>
                  <p className="text-sm font-semibold">
                    {displayWeight(weightKg, profile.unitPreference)} {profile.unitPreference}
                  </p>
                </div>
              ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-muted">Full history</h2>
        {sets.length === 0 ? (
          <p className="text-sm text-muted">No sets logged yet.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {[...sets]
              .reverse()
              .map((set) => (
                <div
                  key={set.$id}
                  className="flex items-center justify-between rounded-xl bg-surface px-4 py-3 text-sm"
                >
                  <span className={set.isWarmup ? "text-muted" : ""}>
                    {new Date(set.date).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                    {set.isWarmup && " · warm-up"}
                  </span>
                  <span className="font-medium">
                    {displayWeight(set.weightKg, profile.unitPreference)} {profile.unitPreference} ×{" "}
                    {set.reps}
                  </span>
                </div>
              ))}
          </div>
        )}
      </section>
    </div>
  );
}
