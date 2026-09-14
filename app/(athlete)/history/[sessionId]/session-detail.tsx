"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SetRow, SetRowHeader } from "@/components/logging/set-row";
import { NumberPad } from "@/components/logging/number-pad";
import { RpeSheet } from "@/components/logging/rpe-sheet";
import { useSession } from "@/lib/auth/session-context";
import { useExerciseLibrary } from "@/lib/exercises/library-context";
import { useTrainingSessions } from "@/lib/logging/session-context";
import { fetchSetsForSessions, setsBySession, type HistorySet } from "@/lib/logging/history-store";
import { editSet, removeSet } from "@/lib/logging/set-store";
import { beginEdit, padValue, rpeAfterWarmupChange, type PadState } from "@/lib/logging/number-pad";
import { canComplete, type RpeValue } from "@/lib/logging/set";
import { formatDuration, formatTonnage } from "@/lib/logging/history";
import { sessionDateLabel, summariseSession, type SessionSet } from "@/lib/logging/session";

/**
 * One past session, every set as it was logged.
 *
 * This is also where editing lives, per the blueprint: fix a mistyped weight,
 * delete a set, mark something as a warm-up after the fact. Logged work being
 * immutable is a constraint on the *coach* -- a coach editing a block never
 * rewrites what an athlete already did -- not on the athlete correcting their
 * own log.
 *
 * The row being corrected uses the same component, in the same active state, as
 * the row being logged on the Log screen. An edit is the same gesture as an
 * entry, so it should not be a different-looking thing.
 *
 * Not here yet, and deliberately absent rather than faked: the prescription the
 * session ran against (Order 22), attached video (Order 29) and the coach's
 * comments threaded on the sets they refer to (phase 3).
 */

interface Draft {
  loadKg: number | null;
  reps: number | null;
  rpe: RpeValue | null;
  isWarmup: boolean;
}

export function SessionDetail({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const { state: sessionState } = useSession();
  const { state: library } = useExerciseLibrary();
  const { state: training } = useTrainingSessions();

  const [sets, setSets] = useState<HistorySet[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pad, setPad] = useState<PadState | null>(null);
  const [rpeOpen, setRpeOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const signedIn = sessionState.status === "signed-in";
  const session = training.sessions.find((s) => s.id === sessionId) ?? null;

  const load = useCallback(async () => {
    const loaded = await fetchSetsForSessions([sessionId]).catch(() => [] as HistorySet[]);
    setSets(loaded);
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const loaded = await fetchSetsForSessions([sessionId]).catch(() => [] as HistorySet[]);
      if (!cancelled) setSets(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const nameOf = useMemo(() => {
    const names = new Map(library.exercises.map((e) => [e.id, e.name]));
    return (id: string) => names.get(id) ?? id;
  }, [library.exercises]);

  const ordered = useMemo(() => setsBySession(sets ?? []).get(sessionId) ?? [], [sets, sessionId]);

  /** Totals from the sets on screen, because this screen is the set list. */
  const summary = useMemo(
    () =>
      summariseSession(
        ordered.map<SessionSet>((set) => ({ ...set, exerciseName: nameOf(set.exerciseId) })),
      ),
    [ordered, nameOf],
  );

  const blocks = useMemo(() => {
    const byExercise: Array<{ exerciseId: string; name: string; sets: HistorySet[] }> = [];
    for (const set of ordered) {
      const existing = byExercise.find((block) => block.exerciseId === set.exerciseId);
      if (existing) existing.sets.push(set);
      else byExercise.push({ exerciseId: set.exerciseId, name: nameOf(set.exerciseId), sets: [set] });
    }
    return byExercise;
  }, [ordered, nameOf]);

  const editingSet = ordered.find((set) => set.clientSetId === editingId) ?? null;

  const startEditing = (set: HistorySet) => {
    setEditingId(set.clientSetId);
    setDraft({
      loadKg: set.loadKg,
      reps: set.reps,
      rpe: (set.rpe as RpeValue | null) ?? null,
      isWarmup: set.isWarmup,
    });
    setPad(beginEdit("load", set.loadKg));
    setRpeOpen(false);
  };

  const stopEditing = () => {
    setEditingId(null);
    setDraft(null);
    setPad(null);
    setRpeOpen(false);
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
    setDraft((prev) => (prev ? { ...prev, [next.field === "load" ? "loadKg" : "reps"]: value } : prev));
  };

  const save = async () => {
    if (!editingSet || !draft || !canComplete(draft)) return;
    setBusy(true);
    const corrected = {
      loadKg: draft.loadKg as number,
      reps: draft.reps as number,
      rpe: draft.rpe,
      isWarmup: draft.isWarmup,
    };
    // Shown corrected straight away. The write is queued, so waiting for it
    // would be waiting for the gym's wifi to agree.
    setSets((prev) =>
      (prev ?? []).map((set) =>
        set.clientSetId === editingSet.clientSetId ? { ...set, ...corrected } : set,
      ),
    );
    stopEditing();
    try {
      await editSet(editingSet.clientSetId, corrected, {
        exerciseId: editingSet.exerciseId,
        loggedAt: editingSet.loggedAt,
      });
    } catch {
      await load();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!editingSet) return;
    setBusy(true);
    setSets((prev) => (prev ?? []).filter((set) => set.clientSetId !== editingSet.clientSetId));
    stopEditing();
    try {
      await removeSet(editingSet.clientSetId, {
        exerciseId: editingSet.exerciseId,
        loggedAt: editingSet.loggedAt,
      });
    } catch {
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (!signedIn) return null;

  return (
    <div className="pt-safe-8 flex flex-1 flex-col gap-5 pb-6">
      <header className="flex flex-col items-start gap-1">
        <Button variant="ghost" size="sm" onClick={() => router.push("/history")} aria-label="Back to History">
          ← History
        </Button>
        <h1 className="m-0 text-display font-semibold">
          {session ? sessionDateLabel(session.startedAt) : "Session"}
        </h1>
        {session ? (
          <p className="m-0 font-mono text-meta text-muted-2">
            {session.finishedAt ? formatDuration(session.finishedAt.getTime() - session.startedAt.getTime()) : "running"}
            {` · ${summary.setCount} set${summary.setCount === 1 ? "" : "s"}`}
            {summary.tonnageKg > 0 ? ` · ${formatTonnage(summary.tonnageKg)} kg` : ""}
          </p>
        ) : null}
      </header>

      {sets === null ? null : blocks.length === 0 ? (
        <EmptyState title="Nothing in this session" body="No sets were logged against it." />
      ) : (
        <div className="flex flex-col gap-6">
          {blocks.map((block) => (
            <section key={block.exerciseId} aria-label={block.name} className="flex flex-col gap-2">
              {/* Lift Detail is reached from here rather than from the tab bar:
                  it answers a question you arrive with about one lift. */}
              <h2 className="m-0 text-body font-semibold">
                <Link
                  href={`/lift/${block.exerciseId}`}
                  className="text-foreground no-underline"
                  aria-label={`${block.name} progression`}
                >
                  {block.name} <span aria-hidden className="text-muted-2">›</span>
                </Link>
              </h2>
              <SetRowHeader />
              <div className="flex flex-col gap-1.5">
                {block.sets.map((set, at) => {
                  const index = set.isWarmup
                    ? ("W" as const)
                    : block.sets.slice(0, at + 1).filter((s) => !s.isWarmup).length;
                  const active = editingId === set.clientSetId;
                  return active && draft ? (
                    <SetRow
                      key={set.clientSetId}
                      index={draft.isWarmup ? "W" : index}
                      set={draft}
                      state="active"
                      onPressLoad={() => focusField("load")}
                      onPressReps={() => focusField("reps")}
                      onPressRpe={() => focusField("rpe")}
                      onConfirm={save}
                    />
                  ) : (
                    <button
                      key={set.clientSetId}
                      type="button"
                      onClick={() => startEditing(set)}
                      aria-label={`Edit ${index === "W" ? "warm-up set" : `set ${index}`} of ${block.name}`}
                      className="w-full text-left"
                    >
                      <SetRow
                        index={index}
                        set={{ ...set, rpe: (set.rpe as RpeValue | null) ?? null }}
                        state="logged"
                      />
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <div className="mt-auto flex flex-col gap-3">
        {editingSet && draft ? (
          <div className="flex gap-3">
            <Button block variant="secondary" onClick={stopEditing} disabled={busy}>
              Cancel
            </Button>
            {/* Deleting is deliberately one tap with no confirmation dialog: it
                is the fix for a set that should not be there, and the queue can
                be watched to see it go. */}
            <Button block variant="danger" onClick={remove} disabled={busy}>
              Delete set
            </Button>
          </div>
        ) : null}

        {pad !== null && draft ? (
          <NumberPad
            state={pad}
            onChange={applyPad}
            onNext={() => (pad.field === "load" ? focusField("reps") : focusField("rpe"))}
            nextLabel={pad.field === "load" ? "Reps" : draft.isWarmup ? "Done" : "RPE"}
            isWarmup={draft.isWarmup}
            onToggleWarmup={(isWarmup) =>
              setDraft((prev) =>
                prev ? { ...prev, isWarmup, rpe: rpeAfterWarmupChange(isWarmup, prev.rpe) } : prev,
              )
            }
            onDismiss={() => setPad(null)}
          />
        ) : null}

        {rpeOpen && draft ? (
          <RpeSheet
            setIndex={1}
            value={draft.rpe}
            onSelect={(value) => {
              setDraft((prev) => (prev ? { ...prev, rpe: value } : prev));
              setRpeOpen(false);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
