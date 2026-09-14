"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ExerciseTypeahead } from "@/components/exercises/exercise-typeahead";
import { useSession } from "@/lib/auth/session-context";
import { useExerciseLibrary } from "@/lib/exercises/library-context";
import { resolveOrCreateExercise } from "@/lib/exercises/library";
import type { Exercise } from "@/lib/exercises/match";
import { useTrainingSessions } from "@/lib/logging/session-context";
import { fetchSessionSets, type UnnamedSet } from "@/lib/logging/session-store";
import {
  elapsedMs,
  formatElapsed,
  groupByExercise,
  summariseSession,
  type SessionSet,
} from "@/lib/logging/session";
import { formatNumber } from "@/lib/logging/prefill";

/**
 * Log Session: starting, running and finishing a session.
 *
 * The set row itself is Order 8, so the rows below each exercise are not here
 * yet. What is here is the frame they land in -- which session is live, how
 * long it has been running, which exercises are in it, and how it ends.
 *
 * An exercise added but not yet logged into lives only in this screen's state.
 * There is no session_exercises table, deliberately: an exercise belongs to a
 * session because work was logged against it, so the durable record is the sets
 * themselves. The cost is that an exercise added and then abandoned does not
 * survive a reload, which is the right thing to lose.
 */
type Phase = "logging" | "confirming" | "finished";

export function LogScreen() {
  const router = useRouter();
  const { state: sessionState } = useSession();
  const { state: library, remember } = useExerciseLibrary();
  const { active, start, finish } = useTrainingSessions();

  const athleteId = sessionState.status === "signed-in" ? sessionState.user.id : null;
  const [phase, setPhase] = useState<Phase>("logging");
  const [stored, setStored] = useState<UnnamedSet[]>([]);
  const [added, setAdded] = useState<Exercise[]>([]);
  const [now, setNow] = useState(() => new Date());
  const [busy, setBusy] = useState(false);

  // Ticks the clock. The value shown is always derived from started_at, so a
  // phone that slept through twenty minutes shows twenty minutes, not a frozen
  // counter -- the interval only decides how often we look.
  useEffect(() => {
    if (!active || phase === "finished") return;
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [active, phase]);

  const nameFor = useMemo(() => {
    const names = new Map(library.exercises.map((e) => [e.id, e.name]));
    return (id: string) => names.get(id) ?? null;
  }, [library.exercises]);

  const sessionId = active?.id ?? null;
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // A session resumed on another device, or after a reload, gets its
      // exercises back from the work logged against them.
      const loaded = sessionId
        ? await fetchSessionSets(sessionId).catch(() => [] as UnnamedSet[])
        : [];
      if (!cancelled) setStored(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  /**
   * An exercise the library does not know is shown by its id rather than
   * dropped: a set with a load and reps is real work, and hiding it because a
   * name is missing would be the worse failure.
   */
  const sets = useMemo<SessionSet[]>(
    () => stored.map((set) => ({ ...set, exerciseName: nameFor(set.exerciseId) ?? set.exerciseId })),
    [stored, nameFor],
  );

  const groups = useMemo(() => groupByExercise(sets), [sets]);
  const summary = useMemo(() => summariseSession(sets), [sets]);

  /** Exercises with sets, then ones added this session that have none yet. */
  const shown = useMemo(() => {
    const withSets = new Set(groups.map((g) => g.exerciseId));
    return [
      ...groups.map((g) => ({ id: g.exerciseId, name: g.exerciseName, setCount: g.sets.length })),
      ...added.filter((e) => !withSets.has(e.id)).map((e) => ({ id: e.id, name: e.name, setCount: 0 })),
    ];
  }, [groups, added]);

  const addExercise = (exercise: Exercise) =>
    setAdded((prev) => (prev.some((e) => e.id === exercise.id) ? prev : [...prev, exercise]));

  const createExercise = async (name: string) => {
    if (!athleteId) return;
    const { exercise, created } = await resolveOrCreateExercise(name, library.exercises, {
      userId: athleteId,
    });
    // Into the library as well as into the session, or the next screen that
    // reads the library would not know about a lift the athlete just made.
    if (created) remember(exercise);
    addExercise(exercise);
  };

  const startHere = async () => {
    setBusy(true);
    try {
      await start();
      setPhase("logging");
    } finally {
      setBusy(false);
    }
  };

  const finishHere = async () => {
    if (!active) return;
    setBusy(true);
    try {
      await finish(active.id, { setCount: summary.setCount, tonnageKg: summary.tonnageKg });
      setPhase("finished");
    } finally {
      setBusy(false);
    }
  };

  if (phase === "finished") {
    return <FinishedSummary summary={summary} onDone={() => router.push("/today")} />;
  }

  if (!active) {
    return (
      <div className="pt-safe-8 flex flex-1 flex-col gap-5 pb-6">
        <h1 className="m-0 text-display font-semibold">Log</h1>
        <EmptyState
          title="No session running"
          body="Start one and it appears here. Everything you log is yours whether a coach is watching or not."
          action={
            <Button onClick={startHere} disabled={busy}>
              Start a session
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="pt-safe-8 flex flex-1 flex-col gap-5 pb-6">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="m-0 text-display font-semibold">Session</h1>
        {/* The clock is the finish control, per the blueprint: tap it, confirm. */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setPhase("confirming")}
          aria-label="Finish session"
        >
          <span className="font-mono text-title tabular-nums text-foreground">
            {formatElapsed(elapsedMs(active.startedAt, now))}
          </span>
        </Button>
      </header>

      {shown.length === 0 ? (
        <EmptyState title="Nothing logged yet" body="Add the first exercise and start working." />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {shown.map((exercise) => (
            <li key={exercise.id}>
              <Card>
                <CardBody>
                  <CardTitle>{exercise.name}</CardTitle>
                  <p className="m-0 text-ui text-muted">
                    {exercise.setCount === 0
                      ? "No sets yet"
                      : `${exercise.setCount} set${exercise.setCount === 1 ? "" : "s"}`}
                  </p>
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {/* In the thumb zone, and it empties after each choice: the next thing
          an athlete does here is add another exercise, not edit this one. */}
      <div className="mt-auto">
        <ExerciseTypeahead
          exercises={library.exercises}
          label="Add exercise"
          placeholder="Add an exercise"
          clearOnSelect
          onSelect={addExercise}
          onCreate={createExercise}
          hint={library.status === "failed" ? "Library unavailable — you can still type a name." : null}
        />
      </div>

      {phase === "confirming" ? (
        <div className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4">
          <p className="m-0 text-body">
            Finish this session? {summary.setCount} set{summary.setCount === 1 ? "" : "s"} logged.
          </p>
          <div className="flex gap-3">
            <Button block onClick={finishHere} disabled={busy}>
              Finish
            </Button>
            <Button block variant="secondary" onClick={() => setPhase("logging")} disabled={busy}>
              Keep going
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * What the athlete sees on finishing.
 *
 * PRs and queued videos belong here too, per the blueprint. They arrive with
 * the rollups at Order 12 and video at Order 3; the numbers below are read from
 * the session's own sets, so they are real rather than placeholder -- they are
 * simply zero until Order 8 lands set logging.
 */
function FinishedSummary({
  summary,
  onDone,
}: {
  summary: ReturnType<typeof summariseSession>;
  onDone: () => void;
}) {
  return (
    <div className="pt-safe-8 flex flex-1 flex-col gap-5 pb-6">
      <h1 className="m-0 text-display font-semibold">Session done</h1>
      <dl className="m-0 grid grid-cols-2 gap-3">
        <Stat label="Sets" value={String(summary.setCount)} />
        <Stat label="Tonnage" value={`${formatNumber(summary.tonnageKg)} kg`} />
        <Stat label="Exercises" value={String(summary.exerciseCount)} />
        <Stat label="Warm-ups" value={String(summary.warmupCount)} />
      </dl>
      <div className="mt-auto">
        <Button size="xl" block onClick={onDone}>
          Back to Today
        </Button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-card border border-border bg-surface p-4">
      <dt className="m-0 font-mono text-label uppercase text-muted-2">{label}</dt>
      <dd className="m-0 text-display font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
