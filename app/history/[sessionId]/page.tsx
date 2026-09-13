"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { Query } from "appwrite";
import { useRequireAuth } from "@/lib/use-require-auth";
import { tablesDB } from "@/lib/appwrite";
import { DATABASE_ID, TABLES } from "@/lib/constants";
import type { Lift, WorkoutSession, WorkoutSet } from "@/lib/types";
import { displayWeight } from "@/lib/units";
import PageSpinner from "@/components/PageSpinner";

function formatDuration(startedAt: string, endedAt: string | null): string {
  if (!endedAt) return "In progress";
  const minutes = Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function HistorySessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = use(params);
  const { profile, loading } = useRequireAuth();
  const [session, setSession] = useState<WorkoutSession | null>(null);
  const [sets, setSets] = useState<WorkoutSet[]>([]);
  const [lifts, setLifts] = useState<Map<string, Lift>>(new Map());
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    (async () => {
      const [sessionRow, setRows, liftRows] = await Promise.all([
        tablesDB.getRow<WorkoutSession>(DATABASE_ID, TABLES.workoutSessions, sessionId),
        tablesDB.listRows<WorkoutSet>(DATABASE_ID, TABLES.workoutSets, [
          Query.equal("sessionId", sessionId),
          Query.orderAsc("date"),
        ]),
        tablesDB.listRows<Lift>(DATABASE_ID, TABLES.lifts),
      ]);
      setSession(sessionRow);
      setSets(setRows.rows);
      setLifts(new Map(liftRows.rows.map((l) => [l.$id, l])));
      setLoadingData(false);
    })();
  }, [sessionId]);

  if (loading || !profile) return <PageSpinner />;

  const byLift = new Map<string, WorkoutSet[]>();
  for (const set of sets) {
    const list = byLift.get(set.liftId) ?? [];
    list.push(set);
    byLift.set(set.liftId, list);
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 px-5 pt-safe-8 pb-8">
      <Link href="/history" className="text-sm text-accent">
        ← History
      </Link>

      {loadingData || !session ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <>
          <div>
            <h1 className="text-xl font-semibold">
              {new Date(session.startedAt).toLocaleDateString(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
            </h1>
            <p className="text-sm text-muted">{formatDuration(session.startedAt, session.endedAt)}</p>
          </div>

          {[...byLift.entries()].map(([liftId, liftSets]) => (
            <div key={liftId} className="rounded-2xl bg-surface p-4">
              <Link href={`/lifts/${liftId}`} className="text-sm font-medium text-accent">
                {lifts.get(liftId)?.name ?? "Lift"}
              </Link>
              <div className="mt-2 flex flex-col gap-1">
                {liftSets.map((set) => (
                  <div key={set.$id} className="flex items-center justify-between text-sm">
                    <span className={set.isWarmup ? "text-muted" : ""}>
                      {set.isWarmup ? "Warm-up" : "Set"}
                    </span>
                    <span>
                      {displayWeight(set.weightKg, profile.unitPreference)} {profile.unitPreference} ×{" "}
                      {set.reps}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
