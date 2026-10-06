"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ExerciseTypeahead } from "@/components/exercises/exercise-typeahead";
import { ExerciseBlock, type LoggedSet } from "@/components/logging/exercise-block";
import { NumberPad } from "@/components/logging/number-pad";
import { RestBar } from "@/components/logging/rest-bar";
import { RpeSheet } from "@/components/logging/rpe-sheet";
import { UndoToast } from "@/components/ui/undo-toast";
import { useSession } from "@/lib/auth/session-context";
import { AttachVideo } from "@/components/logging/attach-video";
import { setForNewClip } from "@/lib/video/clip";
import { videoAsk } from "@/lib/logging/video-prompt";
import { useExerciseLibrary } from "@/lib/exercises/library-context";
import { resolveOrCreateExercise } from "@/lib/exercises/library";
import type { Exercise } from "@/lib/exercises/match";
import { useTrainingSessions } from "@/lib/logging/session-context";
import { fetchSessionSets, type UnnamedSet } from "@/lib/logging/session-store";
import { logSet, newClientSetId, removeSet } from "@/lib/logging/set-store";
import {
  deletedIds,
  lostOps,
  mergeById,
  queuedSets,
  refusedDeletes,
  unsyncedIds,
} from "@/lib/logging/offline-view";
import { dismissFailed, subscribeToQueue } from "@/lib/offline/client";
import type { QueuedOp } from "@/lib/offline/queue";
import { fetchCommentsForSets } from "@/lib/review/comment-store";
import { beginEdit, padValue, rpeAfterWarmupChange, type PadState } from "@/lib/logging/number-pad";
import {
  addRow,
  afterConfirm,
  discardRow,
  focusExercise,
  headOf,
  nextSetIndex,
  plannedIndex,
  rowsOf,
  type PlannedRow,
} from "@/lib/logging/plan";
import { extendRest, startRest, type RestTimer } from "@/lib/logging/rest-timer";
import { forgetRest, recallRest, rememberRest } from "@/lib/logging/rest-store";
import { canComplete, type RpeValue } from "@/lib/logging/set";
import {
  elapsedMs,
  formatElapsed,
  groupByExercise,
  summariseSession,
  type SessionSet,
} from "@/lib/logging/session";
import { formatNumber } from "@/lib/logging/prefill";
import { usePrescribedSession } from "@/lib/programming/use-prescribed";
import {
  basisMaxesFor,
  lineSummaries,
  nextTarget,
  planDay,
  prescribeNewRows,
  targetLine,
  targetsFor,
  type LoggedForTarget,
  type SetTarget,
} from "@/lib/programming/session-plan";
import { nextSetSuggestion } from "@/lib/logging/suggestion-gate";
import { setTargetFor } from "@/lib/logging/set-targets";
import { useSuggestionMode } from "@/lib/coach/use-suggestion-mode";

/**
 * Log Session. The screen this product lives or dies on.
 *
 * An athlete touches the set row twenty to forty times a session, one-handed,
 * breathing hard. Everything here bends to that: no keyboard ever appears, the
 * common case of repeating the previous set is one tap on the confirm square,
 * and exactly one row on the screen carries that square.
 */
type Phase = "logging" | "confirming" | "finished";

/**
 * How long a deleted set can be brought back.
 *
 * Five seconds: long enough to notice the wrong row went, short enough that
 * the toast is gone before the next set. The delete itself waits for it, so
 * Undo never has to reverse a write.
 */
export const UNDO_MS = 5_000;

/** A set taken off the screen whose delete has not been written yet. */
interface PendingDelete {
  set: UnnamedSet;
  label: string;
  /** The rest it cleared, so Undo can put it back. */
  restBefore: RestTimer | null;
}

const COACH_COMMENTED =
  "Your coach has commented on this set, so it stays. Correct it from History if the numbers are wrong.";

export function LogScreen() {
  const router = useRouter();
  const { state: sessionState } = useSession();
  const { state: library, remember } = useExerciseLibrary();
  const { active, start, finish } = useTrainingSessions();

  const athleteId = sessionState.status === "signed-in" ? sessionState.user.id : null;
  /**
   * Whether this athlete's coach lets next-set load suggestions through
   * (Order 28). Cached on the device, so it still applies with no signal.
   */
  const { mode: suggestionMode } = useSuggestionMode(athleteId);
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
  /** Rows not logged yet, across every exercise. See lib/logging/plan.ts. */
  const [plans, setPlans] = useState<PlannedRow[]>([]);
  /** The planned row the pad and the RPE sheet write into. */
  const [focusId, setFocusId] = useState<string | null>(null);
  const [pad, setPad] = useState<PadState | null>(null);
  const [rpeOpen, setRpeOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [busy, setBusy] = useState(false);
  const [ops, setOps] = useState<QueuedOp[]>([]);
  const [rest, setRest] = useState<RestTimer | null>(null);
  /** The logged set whose Delete is showing. */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  /** Deleted on this page, whether or not the delete has reached Appwrite. */
  const [deleted, setDeleted] = useState<ReadonlySet<string>>(() => new Set());
  /** Who has commented on which of this session's sets. */
  const [commentAuthors, setCommentAuthors] = useState<{ setId: string; authorId: string }[]>([]);

  /**
   * Whether the server's copy of this session has been read since the page
   * opened. Until it has, every announcement from the queue is a cue to try
   * again -- the queue moving is the best signal there is that Appwrite can
   * be reached.
   *
   * Without the retry, a page reloaded with no signal never read the sets that
   * had already synced: they were missing from the screen, and -- worse -- from
   * the totals the finish wrote, long after the signal came back.
   */
  const storedRead = useRef(false);
  const [readAttempt, setReadAttempt] = useState(0);

  // The queue is attached by the provider; this only watches it, so a set that
  // is still on its way keeps its mark and a reload gets its sets back.
  useEffect(
    () =>
      subscribeToQueue((next) => {
        setOps(next);
        if (!storedRead.current) setReadAttempt((n) => n + 1);
      }),
    [],
  );

  // A rest that was running when the page went away. It is stored as a
  // timestamp, so what comes back is the real remaining time.
  useEffect(() => {
    void (async () => {
      await Promise.resolve();
      setRest(recallRest());
    })();
  }, []);

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

  /**
   * The prescribed day this session was started from, if any (Order 22).
   *
   * Read-only input to the rows: targets and prefill. Nothing the athlete logs
   * is derived from it after the fact, so a coach editing the program mid-
   * session changes the next target on the next load and never a logged set.
   */
  const prescribed = usePrescribedSession(active?.programDayId, athleteId);
  const plan = useMemo(() => (prescribed.status === "ready" ? planDay(prescribed.day.prescriptions) : []), [prescribed]);
  /** Exercises a clip was attached to on this page; sets read from Appwrite carry their own flag. */
  const [filmed, setFilmed] = useState<ReadonlySet<string>>(new Set());
  const targetsOf = useCallback(
    (exerciseId: string, logged: readonly LoggedForTarget[]): SetTarget[] | null => {
      const planned = plan.find((p) => p.exerciseId === exerciseId);
      if (!planned) return null;
      const maxes = basisMaxesFor(exerciseId, prescribed.maxes.entries, prescribed.maxes.estimated, new Date());
      return targetsFor(planned, maxes, logged.map((s) => ({ ...s, rpe: s.rpe ?? null })));
    },
    [plan, prescribed.maxes],
  );

  const readSession = useRef<string | null>(null);
  /** A read on the wire. Retries wait for it rather than racing it. */
  const reading = useRef<string | null>(null);
  useEffect(() => {
    void (async () => {
      // A failed read is the normal case in a basement, not an error worth
      // showing: the queue below holds everything this session has logged.
      if (readSession.current !== sessionId) {
        readSession.current = sessionId;
        storedRead.current = false;
      }
      if (storedRead.current || (sessionId && reading.current === sessionId)) return;
      let loaded: UnnamedSet[] = [];
      if (sessionId) {
        reading.current = sessionId;
        try {
          loaded = await fetchSessionSets(sessionId);
        } catch {
          return;
        } finally {
          if (reading.current === sessionId) reading.current = null;
        }
      }
      // Moved to another session while this was in flight: not this list.
      if (readSession.current !== sessionId) return;
      storedRead.current = true;
      setStored(loaded);
      // Which of those a coach has already spoken about, so Delete can say no
      // before it is tapped rather than after. Best effort: with no signal
      // the answer comes from the queue instead, when the delete is refused.
      const comments = await fetchCommentsForSets(loaded.map((set) => set.clientSetId)).catch(() => []);
      if (readSession.current === sessionId) setCommentAuthors(comments);
    })();
  }, [sessionId, readAttempt]);

  /** Sets somebody other than the athlete has commented on. */
  const commented = useMemo(
    () => new Set(commentAuthors.filter((c) => c.authorId !== athleteId).map((c) => c.setId)),
    [commentAuthors, athleteId],
  );

  const queued = useMemo(() => (sessionId ? queuedSets(ops, sessionId) : []), [ops, sessionId]);
  const unsynced = useMemo(() => unsyncedIds(ops), [ops]);
  const removed = useMemo(() => deletedIds(ops), [ops]);
  const refused = useMemo(() => refusedDeletes(ops), [ops]);
  const failed = useMemo(() => lostOps(ops), [ops]);

  /**
   * Picks up sets the queue is carrying that this page has not seen.
   *
   * After a reload with no signal, that is every set of the session: Appwrite
   * could not be asked, and the queue is the only record.
   *
   * The reset and the merge are one effect deliberately. As two they raced --
   * both deferred through a microtask, so on the first session the reset ran
   * after the merge and wiped it, and the list only came back because the queue
   * happened to announce again.
   */
  const shownSession = useRef<string | null>(null);
  useEffect(() => {
    // Behind an await so the update is visibly asynchronous, the same shape the
    // providers use.
    void (async () => {
      await Promise.resolve();
      // A different session is a different list. Nothing from the last one
      // carries over, not even a set still waiting to send.
      const fresh = shownSession.current !== sessionId;
      shownSession.current = sessionId;
      setLocal((prev) => {
        const merged = mergeById(fresh ? [] : prev, queued, (s) => s.clientSetId);
        return !fresh && merged.length === prev.length ? prev : merged;
      });
    })();
  }, [sessionId, queued]);

  /** Every set this page knows of, deleted or not. What set_index counts from. */
  const everything = useMemo(() => mergeById(stored, local, (s) => s.clientSetId), [stored, local]);

  /** Everything logged this session, whether Appwrite has heard of it or not. */
  const all = useMemo(
    () =>
      everything
        .filter((s) => !removed.has(s.clientSetId))
        // A delete the server refused brings its set back: the set is still
        // there, and hiding it would be the screen disagreeing with the coach.
        .filter((s) => !deleted.has(s.clientSetId) || refused.has(s.clientSetId))
        .filter((s) => s.clientSetId !== pendingDelete?.set.clientSetId)
        .sort((a, b) => a.loggedAt.getTime() - b.loggedAt.getTime()),
    [everything, removed, deleted, refused, pendingDelete],
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

  const lastLoggedOf = useCallback(
    (exerciseId: string) => {
      const last = setsOf(exerciseId).at(-1);
      return last ? { loadKg: last.loadKg, reps: last.reps } : null;
    },
    [setsOf],
  );

  /**
   * Rows that just appeared, given the coach's target for the set they will
   * be (rule 1 of the prefill order, and rule 2 for a weight priced off
   * today's top set). Rows already on screen keep whatever the athlete typed.
   * `justLogged` is the set the confirm path has not seen land in state yet.
   */
  const prescribe = useCallback(
    (before: readonly PlannedRow[], after: PlannedRow[], justLogged?: LoggedForTarget & { exerciseId: string }) =>
      prescribeNewRows(before, after, (exerciseId) => {
        const logged: LoggedForTarget[] = setsOf(exerciseId);
        if (justLogged?.exerciseId === exerciseId) logged.push(justLogged);
        return { logged, targets: targetsOf(exerciseId, logged) };
      }),
    [setsOf, targetsOf],
  );

  const focused = plans.find((row) => row.clientSetId === focusId) ?? null;

  /** One place that changes the rest timer, so the stored copy cannot drift. */
  const changeRest = useCallback((next: RestTimer | null) => {
    setRest(next);
    if (next) rememberRest(next);
    else forgetRest();
  }, []);

  const closeSheets = () => {
    setPad(null);
    setRpeOpen(false);
  };

  /**
   * Moves to an exercise. Rule 3 of the blueprint's prefill order supplies the
   * row if it has none: straight sets are the norm, so repeating the previous
   * set has to cost one tap. Rules 1, 2 and 4 need a prescription, the RPE
   * engine and a query into the last session -- Orders 22, 27 and 13.
   */
  const activate = useCallback(
    (exerciseId: string) => {
      const { rows: moved, head } = focusExercise(plans, exerciseId, lastLoggedOf(exerciseId), newClientSetId);
      setPlans(prescribe(plans, moved));
      setFocusId(head.clientSetId);
      setSelectedId(null);
      setPad(null);
      setRpeOpen(false);
    },
    [plans, lastLoggedOf, prescribe],
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

  /**
   * Writes down another set for later.
   *
   * It does not move the pad: the row being entered stays the row being
   * entered, so an athlete mid-set who plans the back-off loses nothing. The
   * new row's numbers are one tap away if they need changing.
   */
  const addSet = (exerciseId: string) => {
    setSelectedId(null);
    const next = prescribe(plans, addRow(plans, exerciseId, lastLoggedOf(exerciseId), newClientSetId));
    setPlans(next);
    // Nothing was being entered anywhere, so the new row's exercise is now
    // the one in hand.
    if (!focused) setFocusId(headOf(next, exerciseId)?.clientSetId ?? null);
  };

  const focusField = (rowId: string | null, field: "load" | "reps" | "rpe") => {
    const row = plans.find((each) => each.clientSetId === rowId);
    if (!row) return;
    setFocusId(row.clientSetId);
    setSelectedId(null);
    if (field === "rpe") {
      if (row.isWarmup) return; // Warm-ups never ask.
      setPad(null);
      setRpeOpen(true);
      return;
    }
    setRpeOpen(false);
    setPad(beginEdit(field, field === "load" ? row.loadKg : row.reps));
  };

  const updateFocused = (change: (row: PlannedRow) => PlannedRow) => {
    setPlans((prev) => prev.map((row) => (row.clientSetId === focusId ? change(row) : row)));
  };

  const applyPad = (next: PadState) => {
    setPad(next);
    const value = padValue(next);
    updateFocused((row) => ({
      ...row,
      [next.field === "load" ? "loadKg" : "reps"]: value,
      // Once the athlete types a load it is theirs, not the suggestion's.
      ...(next.field === "load" ? { note: null } : {}),
    }));
  };

  const toggleWarmup = (isWarmup: boolean) => {
    updateFocused((row) => ({ ...row, isWarmup, rpe: rpeAfterWarmupChange(isWarmup, row.rpe) }));
    if (isWarmup) setRpeOpen(false);
  };

  const confirmSet = async (rowId: string) => {
    const row = plans.find((each) => each.clientSetId === rowId);
    if (!row || !active || !athleteId || !canComplete(row)) return;
    // Only the head of an exercise's plan is ever offered a confirm square;
    // this makes the rule hold even if a stale handler fires.
    if (headOf(plans, row.exerciseId)?.clientSetId !== rowId) return;
    setBusy(true);
    setSelectedId(null);
    // The row appears logged immediately because it *is* logged: logSet writes
    // it to the durable queue, and nothing here waits for Appwrite. There is no
    // rollback path any more, and that is the point -- a set the athlete saw
    // land never quietly disappears because a lift happened in a basement.
    const optimistic: UnnamedSet = {
      exerciseId: row.exerciseId,
      clientSetId: row.clientSetId,
      setIndex: nextSetIndex(everything.filter((s) => s.exerciseId === row.exerciseId)),
      loadKg: row.loadKg as number,
      reps: row.reps as number,
      rpe: row.rpe,
      isWarmup: row.isWarmup,
      loggedAt: new Date(),
    };
    setLocal((prev) => [...prev, optimistic]);
    // The next row is either the one the athlete already planned, or -- with
    // nothing planned -- a repeat of this one. Built from the set just logged
    // rather than from state: the optimistic append has not landed yet, and
    // reading it back would give an empty row where the one-tap repeat goes.
    // The coach's switch is applied here, at the one place a suggestion can
    // enter: held means none, whatever the engine would say.
    // The target is the prescribed set the next row will be (Order 22),
    // counted with the set just logged.
    const loggedNow: LoggedForTarget[] = [...setsOf(row.exerciseId), optimistic];
    const prescribedNext = (() => {
      const targets = targetsOf(row.exerciseId, loggedNow);
      return targets ? nextTarget(targets, loggedNow) : null;
    })();
    const suggestion = nextSetSuggestion(
      suggestionMode,
      { loadKg: optimistic.loadKg, reps: optimistic.reps, rpe: row.rpe, isWarmup: row.isWarmup },
      setTargetFor(prescribedNext),
    );
    const { rows, next } = afterConfirm(
      plans,
      rowId,
      { loadKg: optimistic.loadKg, reps: optimistic.reps },
      newClientSetId,
      suggestion,
    );
    setPlans(prescribe(plans, rows, optimistic));
    setFocusId(next.clientSetId);
    closeSheets();
    // Warm-ups start it too. Anything else is a rule an athlete has to learn,
    // and the feature list is explicit that this is the part Strong keeps
    // simple on purpose.
    changeRest(startRest());

    try {
      await logSet({
        sessionId: active.id,
        exerciseId: row.exerciseId,
        setIndex: optimistic.setIndex as number,
        loadKg: optimistic.loadKg,
        reps: optimistic.reps,
        rpe: row.rpe,
        isWarmup: row.isWarmup,
        clientSetId: row.clientSetId,
        // Warm-ups answer no prescription: targets count working sets only.
        ...(row.prescriptionId && !row.isWarmup
          ? { prescriptionId: row.prescriptionId, prescribed: row.prescribed }
          : {}),
      });
    } catch {
      // Only reachable if the device cannot write to its own storage at all.
      // Then the set genuinely is not logged, and saying so beats a lie.
      setLocal((prev) => prev.filter((s) => s.clientSetId !== row.clientSetId));
    } finally {
      setBusy(false);
    }
  };

  const discardPlanned = (rowId: string) => {
    const row = plans.find((each) => each.clientSetId === rowId);
    const rest = discardRow(plans, rowId);
    setPlans(rest);
    if (row && focusId === rowId) {
      setFocusId(headOf(rest, row.exerciseId)?.clientSetId ?? null);
      closeSheets();
    }
  };

  /* --- Deleting a logged set ------------------------------------------- */

  const pendingRef = useRef<PendingDelete | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Writes the delete that the toast was holding.
   *
   * Runs when the toast times out, when another set is deleted, when the page
   * is hidden or left, and before a finish. A phone locked inside the five
   * seconds therefore still deletes; a tab killed outright inside them keeps
   * the set, which is the right way round for a log whose worst failure is a
   * lost set.
   */
  const commitDelete = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = null;
    const id = pending.set.clientSetId;
    setDeleted((prev) => new Set(prev).add(id));
    setPendingDelete(null);
    void removeSet(id, { exerciseId: pending.set.exerciseId, loggedAt: pending.set.loggedAt }).catch(() => {
      // The device could not write to its own storage, so the delete does not
      // exist anywhere. The set comes back rather than looking deleted.
      setDeleted((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    });
  }, []);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") commitDelete();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", commitDelete);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", commitDelete);
      // Leaving the screen for Today or History is not an undo.
      commitDelete();
    };
  }, [commitDelete]);

  const selectSet = (clientSetId: string) => {
    closeSheets();
    setSelectedId((prev) => (prev === clientSetId ? null : clientSetId));
  };

  const deleteLogged = (clientSetId: string) => {
    const set = all.find((s) => s.clientSetId === clientSetId);
    if (!set || commented.has(clientSetId)) return;
    // One toast at a time. The previous delete stops being undoable the
    // moment a second one starts, rather than stacking toasts over the pad.
    commitDelete();

    const mine = setsOf(set.exerciseId);
    const at = mine.findIndex((s) => s.clientSetId === clientSetId);
    const number = set.isWarmup ? null : mine.slice(0, at + 1).filter((s) => !s.isWarmup).length;
    const name = nameFor(set.exerciseId) ?? "Set";
    const label = number === null ? `${name} warm-up deleted` : `${name} set ${number} deleted`;

    // The rest belongs to the most recent set. Deleting that one means the
    // rest was for a set that did not happen; deleting an older one leaves it.
    const latest = all.at(-1)?.clientSetId === clientSetId;
    const pending: PendingDelete = { set, label, restBefore: latest ? rest : null };
    if (latest && rest) changeRest(null);

    pendingRef.current = pending;
    setPendingDelete(pending);
    setSelectedId(null);
    undoTimer.current = setTimeout(commitDelete, UNDO_MS);
  };

  const undoDelete = () => {
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = null;
    setPendingDelete(null);
    if (pending.restBefore) changeRest(pending.restBefore);
  };

  // A prescribed session opens on its first exercise, ready to log, so the
  // athlete's first tap is a set rather than finding the squat in a list.
  const firstPlanned = plan[0]?.exerciseId ?? null;
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (!firstPlanned || !sessionId || opened.current === sessionId) return;
    opened.current = sessionId;
    if (plans.length > 0 || all.length > 0) return;
    void (async () => {
      await Promise.resolve();
      activate(firstPlanned);
    })();
  }, [firstPlanned, sessionId, plans.length, all.length, activate]);

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
    // A set in the toast is already out of the totals; its delete has to be
    // queued before the finish that reports those totals.
    commitDelete();
    setBusy(true);
    try {
      await finish(active.id, { setCount: summary.setCount, tonnageKg: summary.tonnageKg });
      changeRest(null);
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

  // Prescribed exercises lead, in the coach's order, whether or not anything
  // is logged yet. Then exercises with sets, then ones added or planned but
  // not logged into yet. Planned counts: deleting the only set of an exercise
  // must not take the rows the athlete was about to log with it.
  const blocks: { id: string; name: string }[] = plan.map((p) => ({
    id: p.exerciseId,
    name: nameFor(p.exerciseId) ?? "Prescribed exercise",
  }));
  const shown = new Set(blocks.map((b) => b.id));
  for (const group of groups) {
    if (!shown.has(group.exerciseId)) {
      blocks.push({ id: group.exerciseId, name: group.exerciseName });
      shown.add(group.exerciseId);
    }
  }
  for (const exercise of added) {
    if (!shown.has(exercise.id)) {
      blocks.push({ id: exercise.id, name: exercise.name });
      shown.add(exercise.id);
    }
  }
  for (const row of plans) {
    if (!shown.has(row.exerciseId)) {
      blocks.push({ id: row.exerciseId, name: nameFor(row.exerciseId) ?? row.exerciseId });
      shown.add(row.exerciseId);
    }
  }

  const focusedNumber = (() => {
    if (!focused) return 1;
    const mine = rowsOf(plans, focused.exerciseId);
    const working = setsOf(focused.exerciseId).filter((s) => !s.isWarmup).length;
    const index = plannedIndex(working, mine, mine.findIndex((r) => r.clientSetId === focused.clientSetId));
    return index === "W" ? working + 1 : index;
  })();

  /** The coach's lines, then the next set's target, for one exercise block. */
  const targetFor = (exerciseId: string): string[] | null => {
    const logged = setsOf(exerciseId);
    const targets = targetsOf(exerciseId, logged);
    const planned = plan.find((p) => p.exerciseId === exerciseId);
    if (!targets || !planned) return null;
    const next = nextTarget(targets, logged);
    return [...lineSummaries(planned, targets), ...(next ? [`Next: ${targetLine(next)}`] : [])];
  };

  /**
   * What gets the bottom of the screen. Exactly one thing does.
   *
   * The order is by how committed the athlete already is. Mid-entry beats
   * everything. Confirming a finish beats the rest timer, which beats adding an
   * exercise -- and the last two are the collision worth naming, because a set
   * being logged is the same instant the timer starts and the typeahead comes
   * back. Stacking them would push both out of the thumb zone.
   *
   * The undo toast is the one thing allowed to sit above whichever it is: it
   * lasts five seconds, and hiding the rest timer to show it would cost more
   * than it saves.
   */
  const bottom: "pad" | "rpe" | "confirm" | "rest" | "add" =
    pad !== null ? "pad" : rpeOpen ? "rpe" : phase === "confirming" ? "confirm" : rest ? "rest" : "add";

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
                deleteBlocked:
                  commented.has(s.clientSetId) || refused.has(s.clientSetId) ? COACH_COMMENTED : null,
              }))}
              planned={rowsOf(plans, block.id)}
              focusedId={pad !== null || rpeOpen ? focusId : null}
              target={targetFor(block.id)}
              onFocus={focusField}
              onConfirm={(id) => void confirmSet(id)}
              onDiscard={discardPlanned}
              onAddSet={() => addSet(block.id)}
              onActivate={() => activate(block.id)}
              selectedId={selectedId}
              onSelect={selectSet}
              onDelete={deleteLogged}
              camera={(() => {
                // Attaches to the most recently logged set of this exercise,
                // per the Set Row spec. Absent until there is one, so the
                // athlete is never offered a camera with nowhere to put a clip.
                const target = setForNewClip(
                  setsOf(block.id).map((set) => ({
                    ...set,
                    loggedAt: set.loggedAt instanceof Date ? set.loggedAt : new Date(set.loggedAt),
                  })),
                  block.id,
                );
                if (!target || !athleteId) return null;
                const mine = setsOf(block.id);
                // A coach's video request (Order 30): a nudge, never a gate.
                const ask = videoAsk({
                  lines: plan.find((p) => p.exerciseId === block.id)?.lines,
                  loggedWorking: mine.filter((s) => !s.isWarmup).length,
                  hasClip: filmed.has(block.id) || mine.some((s) => s.hasVideo),
                });
                return (
                  <AttachVideo
                    key={target.clientSetId}
                    setId={target.clientSetId}
                    athleteId={athleteId}
                    ask={ask}
                    onAttached={() => setFilmed((prev) => new Set(prev).add(block.id))}
                  />
                );
              })()}
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

        {/*
          A delete that reached Appwrite after the coach had commented. Nothing
          was lost -- the set is back where it was -- so this can be dismissed,
          unlike the notice above.
        */}
        {refused.size > 0 ? (
          <div className="flex items-center justify-between gap-3 rounded-card border border-border bg-surface p-3">
            <p role="status" className="m-0 text-caption text-muted">
              {refused.size === 1 ? "A set you deleted was" : `${refused.size} sets you deleted were`} kept:
              your coach had already commented.
            </p>
            <Button variant="ghost" size="sm" onClick={() => void dismissFailed([...refused.values()])}>
              OK
            </Button>
          </div>
        ) : null}

        {pendingDelete ? <UndoToast message={pendingDelete.label} onUndo={undoDelete} /> : null}

        {bottom === "confirm" ? (
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
        {bottom === "pad" && pad !== null && focused ? (
          <NumberPad
            state={pad}
            onChange={applyPad}
            onNext={() => (pad.field === "load" ? focusField(focusId, "reps") : focusField(focusId, "rpe"))}
            nextLabel={pad.field === "load" ? "Reps" : focused.isWarmup ? "Done" : "RPE"}
            isWarmup={focused.isWarmup}
            onToggleWarmup={toggleWarmup}
            onDismiss={() => setPad(null)}
          />
        ) : null}

        {bottom === "rpe" && focused ? (
          <RpeSheet
            setIndex={focusedNumber}
            value={focused.rpe}
            onSelect={(value) => {
              updateFocused((row) => ({ ...row, rpe: value }));
              setRpeOpen(false);
            }}
          />
        ) : null}

        {bottom === "rest" && rest ? (
          <RestBar
            timer={rest}
            now={now}
            onExtend={() => changeRest(extendRest(rest))}
            onSkip={() => changeRest(null)}
          />
        ) : null}

        {bottom === "add" ? (
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
