"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ID, Query } from "appwrite";
import { useRequireAuth } from "@/lib/use-require-auth";
import { tablesDB } from "@/lib/appwrite";
import { DATABASE_ID, TABLES } from "@/lib/constants";
import { getAthleteDataPermissions } from "@/lib/permissions";
import { findOrCreateOpenSession, endSession } from "@/lib/workout-session";
import { toKg } from "@/lib/units";
import type { Lift, WorkoutSession, WorkoutSet } from "@/lib/types";
import ElapsedTimer from "@/components/ElapsedTimer";
import ExerciseBlock from "@/components/ExerciseBlock";
import PageSpinner from "@/components/PageSpinner";

export default function LogWorkoutPage() {
  const { user, profile, loading } = useRequireAuth();
  const router = useRouter();

  const [session, setSession] = useState<WorkoutSession | null>(null);
  const [lifts, setLifts] = useState<Lift[]>([]);
  const [sets, setSets] = useState<WorkoutSet[]>([]);
  const [activeLiftIds, setActiveLiftIds] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [ending, setEnding] = useState(false);
  const [ready, setReady] = useState(false);

  // findOrCreateOpenSession reads-then-writes, so it isn't safe to run twice
  // concurrently: React's Strict Mode double-invokes effects in dev, and two
  // concurrent calls would each see "no open session" and create their own.
  const initStarted = useRef(false);

  useEffect(() => {
    if (!user || initStarted.current) return;
    initStarted.current = true;
    (async () => {
      const [liftRows, openSession] = await Promise.all([
        tablesDB.listRows<Lift>(DATABASE_ID, TABLES.lifts),
        findOrCreateOpenSession(user.$id),
      ]);
      setLifts(liftRows.rows);
      setSession(openSession);

      const existingSets = await tablesDB.listRows<WorkoutSet>(DATABASE_ID, TABLES.workoutSets, [
        Query.equal("sessionId", openSession.$id),
        Query.orderAsc("date"),
      ]);
      setSets(existingSets.rows);
      setActiveLiftIds([...new Set(existingSets.rows.map((s) => s.liftId))]);
      setReady(true);
    })();
  }, [user]);

  if (loading || !profile || !ready || !session) return <PageSpinner />;

  async function addSet(liftId: string, weightValue: number, repsValue: number, isWarmup: boolean) {
    const permissions = await getAthleteDataPermissions(user!.$id);
    const row = await tablesDB.createRow<WorkoutSet>(
      DATABASE_ID,
      TABLES.workoutSets,
      ID.unique(),
      {
        userId: user!.$id,
        sessionId: session!.$id,
        liftId,
        date: new Date().toISOString(),
        weightKg: toKg(weightValue, profile!.unitPreference),
        reps: repsValue,
        isWarmup,
      },
      permissions
    );
    setSets((prev) => [...prev, row]);
  }

  function addExercise(liftId: string) {
    setActiveLiftIds((prev) => (prev.includes(liftId) ? prev : [...prev, liftId]));
    setPickerOpen(false);
  }

  async function handleEndSession() {
    setEnding(true);
    try {
      await endSession(session!.$id);
      router.replace("/dashboard");
    } catch {
      setEnding(false);
    }
  }

  const liftById = new Map(lifts.map((l) => [l.$id, l]));
  const availableLifts = lifts.filter((l) => !activeLiftIds.includes(l.$id));

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-5 pt-safe-8 pb-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Workout</h1>
        <ElapsedTimer startedAt={session.startedAt} />
      </div>

      {activeLiftIds.map((liftId) => (
        <ExerciseBlock
          key={liftId}
          liftName={liftById.get(liftId)?.name ?? "Lift"}
          sets={sets.filter((s) => s.liftId === liftId)}
          unitPreference={profile.unitPreference}
          onAddSet={(weight, reps, isWarmup) => addSet(liftId, weight, reps, isWarmup)}
        />
      ))}

      {pickerOpen ? (
        <div className="flex flex-col gap-2 rounded-2xl bg-surface p-4">
          <span className="text-xs font-medium text-muted">Choose an exercise</span>
          {availableLifts.length === 0 ? (
            <p className="text-sm text-muted">All exercises are already in this workout.</p>
          ) : (
            availableLifts.map((lift) => (
              <button
                key={lift.$id}
                onClick={() => addExercise(lift.$id)}
                className="rounded-xl border border-border px-4 py-3 text-left text-sm"
              >
                {lift.name}
              </button>
            ))
          )}
          <button onClick={() => setPickerOpen(false)} className="text-xs text-muted">
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setPickerOpen(true)}
          className="flex h-12 items-center justify-center gap-2 rounded-xl border border-dashed border-border text-sm text-muted"
        >
          + Add Exercise
        </button>
      )}

      <button
        onClick={handleEndSession}
        disabled={ending}
        className="h-12 rounded-xl border border-danger/40 text-sm font-medium text-danger disabled:opacity-60"
      >
        {ending ? "Ending…" : "End Workout"}
      </button>
    </div>
  );
}
