"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ExerciseTypeahead } from "@/components/exercises/exercise-typeahead";
import { ExerciseBlock, type LoggedSet } from "@/components/logging/exercise-block";
import { NumberPad } from "@/components/logging/number-pad";
import { RpeSheet } from "@/components/logging/rpe-sheet";
import { useSession } from "@/lib/auth/session-context";
import { useExerciseLibrary } from "@/lib/exercises/library-context";
import { resolveOrCreateExercise } from "@/lib/exercises/library";
import type { Exercise } from "@/lib/exercises/match";
import { useTrainingSessions } from "@/lib/logging/session-context";
import { fetchSessionSets, type UnnamedSet } from "@/lib/logging/session-store";
import { logSet, newClientSetId, removeSet } from "@/lib/logging/set-store";
import { deletedIds, mergeById, queuedSets, unsyncedIds } from "@/lib/logging/offline-view";
import { subscribeToQueue } from "@/lib/offline/client";
import { failedOps, type QueuedOp } from "@/lib/offline/queue";
import { beginEdit, padValue, rpeAfterWarmupChange, type PadState } from "@/lib/logging/number-pad";
import { resolvePrefill } from "@/lib/logging/prefill";
import { canComplete, type RpeValue } from "@/lib/logging/set";
import {
  elapsedMs,
  formatElapsed,
  groupByExercise,
  summariseSession,
  type SessionSet,
} from "@/lib/logging/session";
import { formatNumber } from "@/lib/logging/prefill";

/**
 * Log Session. The screen this product lives or dies on.
 *
 * An athlete touches the set row twenty to forty times a session, one-handed,
 * breathing hard. Everything here bends to that: no keyboard ever appears, the
 * common case of repeating the previous set is one tap on the confirm square,
 * and the row that is being entered is the only one that can be.
 */
type Phase = "logging" | "confirming" | "finished";

/** The row being entered, plus the id that makes writing it idempotent. */
interface Draft {
  exerciseId: string;
  clientSetId: string;
  loadKg: number | null;
  reps: number | null;
  rpe: RpeValue | null;
  isWarmup: boolean;
}

export function LogScreen() {
  const router = useRouter();
  const { state: sessionState } = useSession();
  const { state: library, remember } = useExerciseLibrary();
  const { active, start, finish } = useTrainingSessions();

  const athleteId = sessionState.status === "signed-in" ? sessionState.user.id : null;
  const [phase, setPhase] = useState<Phase>("logging");
  /** What Appwrite returned for this session. Replaced whenever it is read. */
  const [stored, setStored] = useState<UnnamedSet[]>([]);
  /**
   * What this device logged into this session.
   *
   * Kept separately from the server's copy, and kept after it syncs. An op
   * leaves the queue the moment Appwrite accepts it, so a list derived from the
   * queue would drop each set at the exact moment it succeeded -- taking the
   * session totals with it, which is how a finish screen ends up claiming
   * nothing was logged.
   */
  const [local, setLocal] = useState<UnnamedSet[]>([]);
  const [added, setAdded] = useState<Exercise[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pad, setPad] = useState<PadState | null>(null);
  const [rpeOpen, setRpeOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [busy, setBusy] = useState(false);
  const [ops, setOps] = useState<QueuedOp[]>([]);

  // The queue is attached by the provider; this only watches it, so a set that
  // is still on its way keeps its mark and a reload gets its sets back.
  useEffect(() => subscribeToQueue(setOps), []);

  // Ticks the clock. The value shown is always derived from started_at, so a
  // phone that slept through twenty minutes shows twenty minutes.
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
      // A failed read is the normal case in a basement, not an error worth
      // showing: the queue below holds everything this session has logged.
      const loaded = sessionId
        ? await fetchSessionSets(sessionId).catch(() => [] as UnnamedSet[])
        : [];
      if (!cancelled) setStored(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const queued = useMemo(() => (sessionId ? queuedSets(ops, sessionId) : []), [ops, sessionId]);
  const unsynced = useMemo(() => unsyncedIds(ops), [ops]);
  const removed = useMemo(() => deletedIds(ops), [ops]);
  const failed = useMemo(() => failedOps(ops), [ops]);

  /**
   * Picks up sets the queue is carrying that this page has not seen.
   *
   * After a reload with no signal, that is every set of the session: Appwrite
   * could not be asked, and the queue is the only record.
   */
  useEffect(() => {
    // Behind an await so the update is visibly asynchronous, the same shape the
    // providers use.
    void (async () => {
      await Promise.resolve();
      setLocal((prev) => {
        const merged = mergeById(prev, queued, (s) => s.clientSetId);
        return merged.length === prev.length ? prev : merged;
      });
    })();
  }, [queued]);

  // A different session is a different list. Nothing from the last one carries.
  useEffect(() => {
    void (async () => {
      await Promise.resolve();
      setLocal([]);
    })();
  }, [sessionId]);

  /** Everything logged this session, whether Appwrite has heard of it or not. */
  const all = useMemo(
    () =>
      mergeById(stored, local, (s) => s.clientSetId)
        .filter((s) => !removed.has(s.clientSetId))
        .sort((a, b) => a.loggedAt.getTime() - b.loggedAt.getTime()),
    [stored, local, removed],
  );

  /** An exercise the library does not know is shown by its id, never hidden. */
  const sets = useMemo<SessionSet[]>(
    () => all.map((set) => ({ ...set, exerciseName: nameFor(set.exerciseId) ?? set.exerciseId })),
    [all, nameFor],
  );
  const groups = useMemo(() => groupByExercise(sets), [sets]);
  const summary = useMemo(() => summariseSession(sets), [sets]);

  const setsOf = useCallback(
    (exerciseId: string) => all.filter((s) => s.exerciseId === exerciseId),
    [all],
  );

  /**
   * A new row for an exercise, prefilled from the previous set of it.
   *
   * Rule 3 of the blueprint's prefill order, and the one it calls the most
   * important: straight sets are the norm, so repeating the previous set has to
   * cost one tap. Rules 1, 2 and 4 need a prescription, the RPE engine and a
   * query into the last session -- Orders 22, 27 and 13.
   */
  const draftFor = useCallback(
    (exerciseId: string, after?: { loadKg: number; reps: number }): Draft => {
      // `after` is passed by the confirm path with the set that was just
      // logged. Reading it from state there would read a stale array -- the
      // optimistic append has not landed yet -- and the new row would come up
      // empty, which is exactly the one tap this rule exists to save.
      const previous = after ?? setsOf(exerciseId).at(-1) ?? null;
      const prefill = resolvePrefill({
        previousSetThisSession: previous ? { loadKg: previous.loadKg, reps: previous.reps } : null,
      });
      return {
        exerciseId,
        clientSetId: newClientSetId(),
        loadKg: prefill.loadKg,
        reps: prefill.reps,
        // RPE is about how the next set felt, so it is never carried forward.
        rpe: null,
        // Nor is the warm-up flag. A missed flag counts a warm-up toward
        // tonnage; a stuck one hides real work from PRs and the rollups, and
        // that is the failure nobody notices.
        isWarmup: false,
      };
    },
    [setsOf],
  );

  const activate = useCallback(
    (exerciseId: string) => {
      setDraft(draftFor(exerciseId));
      setPad(null);
      setRpeOpen(false);
    },
    [draftFor],
  );

  const addExercise = useCallback(
    (exercise: Exercise) => {
      setAdded((prev) => (prev.some((e) => e.id === exercise.id) ? prev : [...prev, exercise]));
      activate(exercise.id);
    },
    [activate],
  );

  const createExercise = async (name: string) => {
    if (!athleteId) return;
    const { exercise, created } = await resolveOrCreateExercise(name, library.exercises, {
      userId: athleteId,
    });
    if (created) remember(exercise);
    addExercise(exercise);
  };

  const focusField = (field: "load" | "reps" | "rpe") => {
    if (!draft) return;
    if (field === "rpe") {
      if (draft.isWarmup) return; // Warm-ups never ask.
      setPad(null);
      setRpeOpen(true);
      return;
    }
    setRpeOpen(false);
    setPad(beginEdit(field, field === "load" ? draft.loadKg : draft.reps));
  };

  const applyPad = (next: PadState) => {
    setPad(next);
    const value = padValue(next);
    setDraft((prev) =>
      prev ? { ...prev, [next.field === "load" ? "loadKg" : "reps"]: value } : prev,
    );
  };

  const toggleWarmup = (isWarmup: boolean) => {
    setDraft((prev) => (prev ? { ...prev, isWarmup, rpe: rpeAfterWarmupChange(isWarmup, prev.rpe) } : prev));
    if (isWarmup) setRpeOpen(false);
  };

  const confirmSet = async () => {
    if (!draft || !active || !athleteId || !canComplete(draft)) return;
    const row = draft;
    setBusy(true);
    // The row appears logged immediately because it *is* logged: logSet writes
    // it to the durable queue, and nothing here waits for Appwrite. There is no
    // rollback path any more, and that is the point -- a set the athlete saw
    // land never quietly disappears because a lift happened in a basement.
    const optimistic: UnnamedSet = {
      exerciseId: row.exerciseId,
      clientSetId: row.clientSetId,
      loadKg: row.loadKg as number,
      reps: row.reps as number,
      rpe: row.rpe,
      isWarmup: row.isWarmup,
      loggedAt: new Date(),
    };
    setLocal((prev) => [...prev, optimistic]);
    setDraft(draftFor(row.exerciseId, { loadKg: optimistic.loadKg, reps: optimistic.reps }));
    setPad(null);
    setRpeOpen(false);

    try {
      await logSet({
        sessionId: active.id,
        exerciseId: row.exerciseId,
        setIndex: setsOf(row.exerciseId).length + 1,
        loadKg: row.loadKg as number,
        reps: row.reps as number,
        rpe: row.rpe,
        isWarmup: row.isWarmup,
        clientSetId: row.clientSetId,
      });
    } catch {
      // Only reachable if the device cannot write to its own storage at all.
      // Then the set genuinely is not logged, and saying so beats a lie.
      setLocal((prev) => prev.filter((s) => s.clientSetId !== row.clientSetId));
    } finally {
      setBusy(false);
    }
  };

  const undoLast = async (exerciseId: string) => {
    const last = setsOf(exerciseId).at(-1);
    if (!last || !athleteId) return;
    setLocal((prev) => prev.filter((s) => s.clientSetId !== last.clientSetId));
    setStored((prev) => prev.filter((s) => s.clientSetId !== last.clientSetId));
    setDraft((prev) => (prev?.exerciseId === exerciseId ? draftFor(exerciseId) : prev));
    await removeSet(last.clientSetId).catch(() => {});
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

  const withSets = new Set(groups.map((g) => g.exerciseId));
  const blocks = [
    ...groups.map((g) => ({ id: g.exerciseId, name: g.exerciseName })),
    ...added
      .filter((e) => !withSets.has(e.id))
      .map((e) => ({ id: e.id, name: e.name })),
  ];

  const sheetOpen = pad !== null || rpeOpen;

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

      {blocks.length === 0 ? (
        <EmptyState title="Nothing logged yet" body="Add the first exercise and start working." />
      ) : (
        <div className="flex flex-col gap-6">
          {blocks.map((block) => (
            <ExerciseBlock
              key={block.id}
              name={block.name}
              sets={setsOf(block.id).map<LoggedSet>((s) => ({
                clientSetId: s.clientSetId,
                pendingSync: unsynced.has(s.clientSetId),
                loadKg: s.loadKg,
                reps: s.reps,
                rpe: (s.rpe as RpeValue | null) ?? null,
                isWarmup: s.isWarmup,
              }))}
              draft={draft?.exerciseId === block.id ? draft : null}
              onFocus={focusField}
              onConfirm={confirmSet}
              onActivate={() => activate(block.id)}
              onUndo={() => void undoLast(block.id)}
            />
          ))}
        </div>
      )}

      <div className="mt-auto flex flex-col gap-3">
        {/*
          A queued set that will never send. Offline is normal and gets a quiet
          dot; this is the other thing, and it is the one case where staying
          quiet would be dishonest -- the athlete believes that work is logged.
        */}
        {failed.length > 0 ? (
          <p
            role="status"
            className="m-0 rounded-card border border-border bg-surface p-3 text-caption text-muted"
          >
            {failed.length} {failed.length === 1 ? "entry" : "entries"} could not be saved and
            {failed.length === 1 ? " is" : " are"} not on your coach&rsquo;s side. Everything else synced.
          </p>
        ) : null}

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

        {/* One sheet at a time, and only where a thumb already is. */}
        {pad !== null && draft ? (
          <NumberPad
            state={pad}
            onChange={applyPad}
            onNext={() => (pad.field === "load" ? focusField("reps") : focusField("rpe"))}
            nextLabel={pad.field === "load" ? "Reps" : draft.isWarmup ? "Done" : "RPE"}
            isWarmup={draft.isWarmup}
            onToggleWarmup={toggleWarmup}
            onDismiss={() => setPad(null)}
          />
        ) : null}

        {rpeOpen && draft ? (
          <RpeSheet
            setIndex={setsOf(draft.exerciseId).filter((s) => !s.isWarmup).length + 1}
            value={draft.rpe}
            onSelect={(value) => {
              setDraft((prev) => (prev ? { ...prev, rpe: value } : prev));
              setRpeOpen(false);
            }}
          />
        ) : null}

        {!sheetOpen ? (
          <ExerciseTypeahead
            exercises={library.exercises}
            label="Add exercise"
            placeholder="Add an exercise"
            clearOnSelect
            onSelect={addExercise}
            onCreate={createExercise}
            hint={library.status === "failed" ? "Library unavailable — you can still type a name." : null}
          />
        ) : null}
      </div>
    </div>
  );
}

/**
 * What the athlete sees on finishing.
 *
 * PRs and queued videos belong here too, per the blueprint. They arrive with
 * the rollups at Order 12 and video at Order 3.
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
