"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SetRow, SetRowHeader } from "@/components/logging/set-row";
import { NumberPad } from "@/components/logging/number-pad";
import { RpeSheet } from "@/components/logging/rpe-sheet";
import { SetNoteField } from "@/components/logging/set-note-field";
import { useSession } from "@/lib/auth/session-context";
import { useExerciseLibrary } from "@/lib/exercises/library-context";
import { useTrainingSessions } from "@/lib/logging/session-context";
import { fetchSetsForSessions, setsBySession, type HistorySet } from "@/lib/logging/history-store";
import { editSet, removeSet } from "@/lib/logging/set-store";
import { beginEdit, padValue, rpeAfterWarmupChange, type PadState } from "@/lib/logging/number-pad";
import { canComplete, type RpeValue } from "@/lib/logging/set";
import { formatDuration, formatTonnage } from "@/lib/logging/history";
import { sessionDateLabel, summariseSession, type SessionSet } from "@/lib/logging/session";
import { sessionTitle, totalsMatch, totalsOf } from "@/lib/logging/session-edit";
import {
  checkSessionDeletable,
  deleteSessionAndSets,
  reviseSession,
  reviseSessionTotals,
} from "@/lib/logging/session-edit-store";
import { mergeById, queuedSetEdits, queuedSets, withSetEdits } from "@/lib/logging/offline-view";
import { noteOf } from "@/lib/logging/set-note";
import { useDayLabels } from "@/lib/logging/use-day-labels";
import { subscribeToQueue } from "@/lib/offline/client";
import type { QueuedOp } from "@/lib/offline/queue";
import { useUnits } from "@/lib/profile/units-context";
import { loadFromInput, loadIn } from "@/lib/units";
import { DeleteSessionConfirm, SessionFieldsForm } from "./session-fields";

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
 * The session itself is edited here too: its name and notes, and deleting it
 * whole. Every change to a set restates the session's stored totals behind
 * it, because the History card reads those and nothing else rewrites them.
 *
 * The athlete's note on each set (F11) shows in full under its row, and is
 * edited with the rest of the set: the same textarea as the Log's edit
 * sheet, saved through the same `editSet`. Edits still in the queue are laid
 * over what Appwrite returned, so a note written with no signal is on screen
 * after a reload rather than reappearing when the queue drains.
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
  /** F19: the athlete missed it; reps are the ones completed, 0 allowed. */
  failed: boolean;
  /** The note as typed. Blank is none; `noteOf` decides what is stored. */
  notes: string;
}

export function SessionDetail({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const { state: sessionState } = useSession();
  const { state: library } = useExerciseLibrary();
  const { state: training, patch, drop } = useTrainingSessions();
  /** Corrections are typed in the athlete's unit and stored in kilos. */
  const { unit } = useUnits();

  const [sets, setSets] = useState<HistorySet[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pad, setPad] = useState<PadState | null>(null);
  const [rpeOpen, setRpeOpen] = useState(false);
  /**
   * The note's textarea is showing. Opened by "Add a note", or straight away
   * on a set that already has one: the pad stays the first thing a
   * correction meets, and the keyboard only comes up when asked for.
   */
  const [noteOpen, setNoteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ops, setOps] = useState<QueuedOp[]>([]);
  const [editingFields, setEditingFields] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /** The set read failed, so the screen cannot know what a delete would leave behind. */
  const [loadFailed, setLoadFailed] = useState(false);

  const signedIn = sessionState.status === "signed-in";
  const athleteId = sessionState.status === "signed-in" ? sessionState.user.id : null;
  const session = training.sessions.find((s) => s.id === sessionId) ?? null;
  const dayLabels = useDayLabels([session?.programDayId]);
  const heading = session
    ? sessionTitle(session, session.programDayId ? (dayLabels.get(session.programDayId) ?? null) : null)
    : null;

  useEffect(() => subscribeToQueue(setOps), []);

  const load = useCallback(async () => {
    const loaded = await fetchSetsForSessions([sessionId]).catch(() => null);
    setLoadFailed(loaded === null);
    setSets(loaded ?? []);
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const loaded = await fetchSetsForSessions([sessionId]).catch(() => null);
      if (cancelled) return;
      setLoadFailed(loaded === null);
      setSets(loaded ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const nameOf = useMemo(() => {
    const names = new Map(library.exercises.map((e) => [e.id, e.name]));
    return (id: string) => names.get(id) ?? id;
  }, [library.exercises]);

  const ordered = useMemo(
    () => withSetEdits(setsBySession(sets ?? []).get(sessionId) ?? [], queuedSetEdits(ops)),
    [sets, sessionId, ops],
  );

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

  /**
   * Sets of this session still on the phone. Not drawn -- History shows what
   * Appwrite has -- but counted, so restating the totals from the server's
   * sets alone cannot undercount a session whose last sets have not synced.
   */
  const unsynced = useMemo(() => queuedSets(ops, sessionId), [ops, sessionId]);

  /**
   * Restates the stored totals from the sets as they now are.
   *
   * The fix for History cards that kept their finish-time totals after a set
   * was corrected or deleted: `finishSession` was the only writer of
   * `set_count` and `tonnage_kg`. Patched on screen at once, queued behind the
   * set write it follows.
   */
  const restateTotals = async (next: readonly HistorySet[]) => {
    if (!session) return;
    const counted = mergeById(
      next.map(({ clientSetId, exerciseId, loadKg, reps, rpe, isWarmup, loggedAt }) => ({
        clientSetId, exerciseId, loadKg, reps, rpe, isWarmup, loggedAt,
      })),
      unsynced.map(({ clientSetId, exerciseId, loadKg, reps, rpe, isWarmup, loggedAt }) => ({
        clientSetId, exerciseId, loadKg, reps, rpe, isWarmup, loggedAt,
      })),
      (set) => set.clientSetId,
    );
    const totals = totalsOf(counted);
    if (totalsMatch(session, totals)) return;
    patch(sessionId, totals);
    await reviseSessionTotals(sessionId, totals).catch(() => {});
  };

  const saveFields = async (change: { name: string | null; notes: string | null }) => {
    if (!session) return;
    setEditingFields(false);
    const before = { name: session.name ?? null, notes: session.notes ?? null };
    patch(sessionId, change);
    try {
      await reviseSession(sessionId, change);
    } catch {
      // Not written to the phone, so not saved: put it back rather than show a
      // name that will be gone after a reload.
      patch(sessionId, before);
      setNotice("That change wasn't saved — this phone couldn't store it. Try again.");
    }
  };

  const deleteWhole = async () => {
    if (!athleteId) return;
    if (loadFailed) {
      // An empty list here means "could not read", not "no sets": deleting on
      // it would skip every set's coach-comment check and orphan the sets.
      setConfirmingDelete(false);
      setNotice("Deleting a session needs signal, to load its sets first. Try again in a moment.");
      return;
    }
    setBusy(true);
    setNotice(null);
    const landed = sets ?? [];
    const check = await checkSessionDeletable(athleteId, landed.map((set) => set.clientSetId));
    if (!check.ok) {
      setConfirmingDelete(false);
      setBusy(false);
      setNotice(check.message);
      return;
    }
    try {
      await deleteSessionAndSets(sessionId, [
        ...landed,
        ...unsynced.filter((queued) => !landed.some((set) => set.clientSetId === queued.clientSetId)),
      ]);
    } catch {
      setBusy(false);
      setConfirmingDelete(false);
      setNotice("That session wasn't deleted — this phone couldn't store the change. Try again.");
      return;
    }
    drop(sessionId);
    router.push("/history");
  };

  const startEditing = (set: HistorySet) => {
    setEditingId(set.clientSetId);
    setDraft({
      loadKg: set.loadKg,
      reps: set.reps,
      rpe: (set.rpe as RpeValue | null) ?? null,
      isWarmup: set.isWarmup,
      failed: set.failed === true,
      notes: set.notes ?? "",
    });
    setPad(beginEdit("load", loadIn(set.loadKg, unit), unit));
    setRpeOpen(false);
    setNoteOpen(Boolean(set.notes?.trim()));
  };

  const stopEditing = () => {
    setEditingId(null);
    setDraft(null);
    setPad(null);
    setRpeOpen(false);
    setNoteOpen(false);
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
    setPad(
      field === "load"
        ? beginEdit("load", draft.loadKg === null ? null : loadIn(draft.loadKg, unit), unit)
        : beginEdit("reps", draft.reps),
    );
  };

  const applyPad = (next: PadState) => {
    setPad(next);
    const typed = padValue(next);
    const value = next.field === "load" && typed !== null ? loadFromInput(typed, next.unit ?? "kg") : typed;
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
      failed: draft.failed,
      notes: noteOf(draft.notes),
    };
    // Shown corrected straight away. The write is queued, so waiting for it
    // would be waiting for the gym's wifi to agree.
    const next = (sets ?? []).map((set) =>
      set.clientSetId === editingSet.clientSetId ? { ...set, ...corrected } : set,
    );
    setSets(next);
    stopEditing();
    try {
      await editSet(editingSet.clientSetId, corrected, {
        exerciseId: editingSet.exerciseId,
        loggedAt: editingSet.loggedAt,
      });
      await restateTotals(next);
    } catch {
      await load();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!editingSet) return;
    setBusy(true);
    const next = (sets ?? []).filter((set) => set.clientSetId !== editingSet.clientSetId);
    setSets(next);
    stopEditing();
    try {
      await removeSet(editingSet.clientSetId, {
        exerciseId: editingSet.exerciseId,
        loggedAt: editingSet.loggedAt,
        // History knows the clip, so it goes with the set rather than waiting
        // for the sweep.
        videoFileId: editingSet.videoFileId ?? null,
      });
      await restateTotals(next);
    } catch {
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (!signedIn) return null;

  return (
    <div className="pt-8 flex flex-1 flex-col gap-5 pb-6">
      <header className="flex flex-col items-start gap-1">
        <Button variant="ghost" size="sm" onClick={() => router.push("/history")} aria-label="Back to History">
          ← History
        </Button>
        <div className="flex w-full items-start justify-between gap-3">
          <h1 className="m-0 min-w-0 break-words text-display font-semibold">{heading ? heading.title : "Session"}</h1>
          {session && !editingFields ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                stopEditing();
                setConfirmingDelete(false);
                setEditingFields(true);
              }}
              aria-label="Edit name and notes"
            >
              Edit
            </Button>
          ) : null}
        </div>
        {session ? (
          <p className="m-0 font-mono text-meta text-muted-2">
            {heading?.named ? `${sessionDateLabel(session.startedAt)} · ` : ""}
            {session.finishedAt ? formatDuration(session.finishedAt.getTime() - session.startedAt.getTime()) : "running"}
            {` · ${summary.setCount} set${summary.setCount === 1 ? "" : "s"}`}
            {summary.tonnageKg > 0 ? ` · ${formatTonnage(loadIn(summary.tonnageKg, unit))} ${unit}` : ""}
          </p>
        ) : null}
        {session?.notes && !editingFields ? <p className="m-0 text-body text-muted">{session.notes}</p> : null}
      </header>

      {notice ? (
        <div role="status" className="flex items-center justify-between gap-3 rounded-card border border-border bg-surface p-3">
          <p className="m-0 text-caption text-foreground">{notice}</p>
          <Button variant="ghost" size="sm" onClick={() => setNotice(null)}>
            OK
          </Button>
        </div>
      ) : null}

      {session && editingFields ? (
        <SessionFieldsForm
          name={session.name ?? null}
          notes={session.notes ?? null}
          fallbackTitle={sessionTitle({ ...session, name: null }, session.programDayId ? (dayLabels.get(session.programDayId) ?? null) : null).title}
          onSave={(change) => void saveFields(change)}
          onCancel={() => setEditingFields(false)}
        />
      ) : null}

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
              <SetRowHeader unit={unit} />
              <div className="flex flex-col gap-1.5">
                {block.sets.map((set, at) => {
                  const index = set.isWarmup
                    ? ("W" as const)
                    : block.sets.slice(0, at + 1).filter((s) => !s.isWarmup).length;
                  const active = editingId === set.clientSetId;
                  return active && draft ? (
                    <div key={set.clientSetId} className="flex flex-col gap-2">
                      <SetRow
                        index={draft.isWarmup ? "W" : index}
                        set={draft}
                        state="active"
                        onPressLoad={() => focusField("load")}
                        onPressReps={() => focusField("reps")}
                        onPressRpe={() => focusField("rpe")}
                        onConfirm={save}
                        unit={unit}
                      />
                      {/* Typing a note puts the keyboard up, so the pad and the
                          chips step aside rather than stacking under it. */}
                      {noteOpen ? (
                        <div
                          onFocusCapture={() => {
                            setPad(null);
                            setRpeOpen(false);
                          }}
                        >
                          <SetNoteField
                            value={draft.notes}
                            onChange={(notes) => setDraft((prev) => (prev ? { ...prev, notes } : prev))}
                            setLabel={index === "W" || draft.isWarmup ? "Warm-up set" : `Set ${index}`}
                            autoFocus={!draft.notes}
                          />
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="self-start"
                          onClick={() => setNoteOpen(true)}
                          aria-label={`Add a note to ${index === "W" || draft.isWarmup ? "warm-up set" : `set ${index}`}`}
                        >
                          + Add a note
                        </Button>
                      )}
                    </div>
                  ) : (
                    <button
                      key={set.clientSetId}
                      type="button"
                      onClick={() => {
                        setConfirmingDelete(false);
                        setEditingFields(false);
                        startEditing(set);
                      }}
                      // A button's content is not read inside its name, so the
                      // Failed mark (F19) is said here as well.
                      aria-label={`Edit ${index === "W" ? "warm-up set" : `set ${index}`} of ${block.name}${set.failed ? ", failed" : ""}`}
                      className="w-full text-left"
                    >
                      <SetRow
                        index={index}
                        set={{ ...set, rpe: (set.rpe as RpeValue | null) ?? null }}
                        state="logged"
                        unit={unit}
                        athleteNote={set.notes ?? null}
                        athleteNoteFull
                        clip={set.videoFileId ? { posterId: set.videoPosterId ?? null } : null}
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
        {session && !editingSet && !editingFields ? (
          confirmingDelete ? (
            <DeleteSessionConfirm
              setCount={ordered.length}
              busy={busy}
              onConfirm={() => void deleteWhole()}
              onCancel={() => setConfirmingDelete(false)}
            />
          ) : (
            // Not until the sets have loaded: a delete that did not know them
            // would skip their coach-comment check and orphan them.
            <Button
              block
              variant="secondary"
              onClick={() => setConfirmingDelete(true)}
              disabled={busy || sets === null}
            >
              Delete session
            </Button>
          )
        ) : null}

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
            failed={draft.failed}
            onToggleFailed={(failed) => setDraft((prev) => (prev ? { ...prev, failed } : prev))}
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
            failed={draft.failed}
            onToggleFailed={(failed) => setDraft((prev) => (prev ? { ...prev, failed } : prev))}
          />
        ) : null}
      </div>
    </div>
  );
}
