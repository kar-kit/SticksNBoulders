"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Query } from "appwrite";
import { useRequireAuth } from "@/lib/use-require-auth";
import { tablesDB } from "@/lib/appwrite";
import { DATABASE_ID, TABLES } from "@/lib/constants";
import type { WorkoutSession, WorkoutSet } from "@/lib/types";
import { displayWeight } from "@/lib/units";
import PageSpinner from "@/components/PageSpinner";

interface SessionSummary {
  session: WorkoutSession;
  liftIds: Set<string>;
  setCount: number;
  totalVolumeKg: number;
}

export default function HistoryPage() {
  const { user, profile, loading } = useRequireAuth();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [sessionRows, setRows] = await Promise.all([
        tablesDB.listRows<WorkoutSession>(DATABASE_ID, TABLES.workoutSessions, [
          Query.equal("userId", user.$id),
          Query.isNotNull("endedAt"),
          Query.orderDesc("startedAt"),
          Query.limit(100),
        ]),
        tablesDB.listRows<WorkoutSet>(DATABASE_ID, TABLES.workoutSets, [
          Query.equal("userId", user.$id),
          Query.limit(1000),
        ]),
      ]);

      const setsBySession = new Map<string, WorkoutSet[]>();
      for (const set of setRows.rows) {
        const list = setsBySession.get(set.sessionId) ?? [];
        list.push(set);
        setsBySession.set(set.sessionId, list);
      }

      setSessions(
        sessionRows.rows.map((session) => {
          const sessionSets = setsBySession.get(session.$id) ?? [];
          return {
            session,
            liftIds: new Set(sessionSets.map((s) => s.liftId)),
            setCount: sessionSets.length,
            totalVolumeKg: sessionSets
              .filter((s) => !s.isWarmup)
              .reduce((sum, s) => sum + s.weightKg * s.reps, 0),
          };
        })
      );
      setLoadingData(false);
    })();
  }, [user]);

  if (loading || !profile) return <PageSpinner />;

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 px-5 pt-safe-8 pb-8">
      <h1 className="text-xl font-semibold">History</h1>

      {loadingData ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : sessions.length === 0 ? (
        <p className="text-sm text-muted">No workouts logged yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {sessions.map(({ session, liftIds, setCount, totalVolumeKg }) => (
            <Link
              key={session.$id}
              href={`/history/${session.$id}`}
              className="flex items-center justify-between rounded-xl bg-surface px-4 py-3"
            >
              <div>
                <p className="text-sm font-medium">
                  {new Date(session.startedAt).toLocaleDateString(undefined, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}
                </p>
                <p className="text-xs text-muted">
                  {liftIds.size} lift{liftIds.size === 1 ? "" : "s"} · {setCount} set
                  {setCount === 1 ? "" : "s"}
                </p>
              </div>
              <span className="text-sm text-muted">
                {displayWeight(totalVolumeKg, profile.unitPreference)} {profile.unitPreference}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
