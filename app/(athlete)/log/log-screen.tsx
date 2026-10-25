"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ExerciseTypeahead } from "@/components/exercises/exercise-typeahead";
import { ExerciseBlock, type LoggedSet } from "@/components/logging/exercise-block";
import { LogSheet } from "@/components/logging/log-sheet";
import { ModalSheet } from "@/components/logging/modal-sheet";
import { Dialog } from "@/components/ui/dialog";
import { NumberPad } from "@/components/logging/number-pad";
import { EditSetSheet, type EditField } from "@/components/logging/edit-set-sheet";
import { RestBar } from "@/components/logging/rest-bar";
import { RpeSheet } from "@/components/logging/rpe-sheet";
import { VariantSheet } from "@/components/logging/variant-sheet";
import { swapOptions } from "@/lib/exercises/variants";
import { UndoToast } from "@/components/ui/undo-toast";
import { useSession } from "@/lib/auth/session-context";
import { AttachVideo } from "@/components/logging/attach-video";
import { setForNewClip } from "@/lib/video/clip";
import { retireReplacedClip } from "@/lib/video/my-clips-store";
import type { UploadResult } from "@/lib/video/upload";
import { videoAsk } from "@/lib/logging/video-prompt";
import { useExerciseLibrary } from "@/lib/exercises/library-context";
import { resolveOrCreateExercise } from "@/lib/exercises/library";
import type { Exercise } from "@/lib/exercises/match";
import { useTrainingSessions } from "@/lib/logging/session-context";
import { fetchSessionSets, type UnnamedSet } from "@/lib/logging/session-store";
import { editSet, logSet, newClientSetId, removeSet } from "@/lib/logging/set-store";
import {
  deletedIds,
  lostOps,
  mergeById,
  queuedSetEdits,
  queuedSets,
  refusedDeletes,
  unsyncedIds,
  withSetEdits,
  type SetValues,
} from "@/lib/logging/offline-view";
import { dismissFailed, queueLoaded, queuedOps, subscribeToQueue } from "@/lib/offline/client";
import { pendingOps } from "@/lib/offline/queue";
import type { QueuedOp } from "@/lib/offline/queue";
import { fetchCommentsForSets } from "@/lib/review/comment-store";
import { beginEdit, padValue, rpeAfterWarmupChange, type PadState } from "@/lib/logging/number-pad";
import { changesSet, draftOf, editOf, type EditDraft } from "@/lib/logging/logged-edit";
import {
  addRow,
  afterConfirm,
  discardRow,
  focusExercise,
  headOf,
  nextSetIndex,
  plannedIndex,
  refreshBehind,
  rowsOf,
  swapRows,
  type PlannedRow,
} from "@/lib/logging/plan";
import {
  buzzRestOver,
  extendRest,
  isRestOver,
  restJustEnded,
  startRest,
  type RestTimer,
} from "@/lib/logging/rest-timer";
import { forgetRest, recallRest, rememberRest } from "@/lib/logging/rest-store";
import { canComplete, type RpeValue } from "@/lib/logging/set";
import { blockRemovalLabel, planBlockRemoval } from "@/lib/logging/block-removal";
import { WeekSummaryCard } from "@/components/logging/week-summary-card";
import {
  elapsedMs,
  formatElapsed,
  groupByExercise,
  summariseSession,
  type SessionSet,
  type SessionSummary,
} from "@/lib/logging/session";
import { formatNumber } from "@/lib/logging/prefill";
import { usePrescribedSession } from "@/lib/programming/use-prescribed";
import {
  asVariant,
  basisMaxesFor,
  lineSummaries,
  nextTarget,
  planDay,
  prescribeNewRows,
  referenceLookup,
  remainingShape,
  targetLine,
  targetsFor,
  type LoggedForTarget,
  type SetTarget,
} from "@/lib/programming/session-plan";
import { nextSetSuggestion } from "@/lib/logging/suggestion-gate";
import { setTargetFor } from "@/lib/logging/set-targets";
import { useSuggestionMode } from "@/lib/coach/use-suggestion-mode";
import { useUnits } from "@/lib/profile/units-context";
import { loadFromInput, loadIn, loadNumber, type UnitPreference } from "@/lib/units";
import { haptic } from "@/lib/ui/haptics";
import { alignPrevious, fillFromLastSession, type PreviousSet } from "@/lib/logging/previous";
import { useExerciseHistory } from "@/lib/logging/use-exercise-history";
import { detectPrs, sessionPrs, type PrKind, type SessionPr } from "@/lib/strength/pr";

/**
 * Log Session. The screen this product lives or dies on.
 *
 * An athlete touches the set row twenty to forty times a session, one-handed,
 * breathing hard. Everything here bends to that: no keyboard ever appears, the
 * common case of repeating the previous set is Add set then the confirm square
 * with nothing typed, and exactly one row per exercise carries that square.
 * Confirming means done: it never conjures the next row.
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

/**
 * Sets taken off the screen whose delete has not been written yet: one from a
 * swipe or the row's Delete, or every set of an exercise removed whole.
 */
interface PendingDelete {
  sets: UnnamedSet[];
  label: string;
  /** The rest it cleared, so Undo can put it back. */
  restBefore: RestTimer | null;
  /**
   * A whole exercise taken out: which one, and the rows it had not logged
   * yet, so Undo can put the block back exactly as it was.
   */
  block: { exerciseId: string; plans: PlannedRow[] } | null;
}

const NO_IDS: ReadonlySet<string> = new Set();

const COACH_COMMENTED = "Your coach has commented on this set, so it stays. You can still correct its numbers above.";

/**
 * A logged set open in the edit sheet (F9): which set, the values being typed,
 * and the field the keypad or the RPE chips are on. The set itself is not
 * touched until Save -- see lib/logging/logged-edit.ts.
 */
interface LoggedEdit {
  clientSetId: string;
  draft: EditDraft;
  field: EditField;
  /** The keypad for load or reps. Null while the RPE chips or the note are showing. */
  pad: PadState | null;
}

export function LogScreen() {
  const router = useRouter();
  const { state: sessionState } = useSession();
  const { state: library, remember } = useExerciseLibrary();
  const { state: trainingState, active, start, finish } = useTrainingSessions();

  const athleteId = sessionState.status === "signed-in" ? sessionState.user.id : null;
  /**
   * Whether this athlete's coach lets next-set load suggestions through
   * (Order 28). Cached on the device, so it still applies with no signal.
   */
  const { mode: suggestionMode } = useSuggestionMode(athleteId);
  /**
   * The athlete's weight unit. Every load in state is kilos; the pad types in
   * this unit and converts on the way in, the rows convert on the way out.
   */
  const { unit } = useUnits();
  const [phase, setPhase] = useState<Phase>("logging");
  /**
   * The totals as they stood when the athlete tapped Finish.
   *
   * Finishing clears the active session, which empties every list on this
   * page -- they are all keyed to it -- so a summary computed live would read
   * zero the moment it is shown. The finished screen reads this instead.
   */
  const [finished, setFinished] = useState<SessionSummary | null>(null);
  /** The records broken, as they stood at Finish. Same reason as `finished`. */
  const [finishedPrs, setFinishedPrs] = useState<SessionPr[]>([]);
  /**
   * Sets confirmed on this page. Only these pop their PR badge and buzz: a
   * set read back after a reload was celebrated the first time round.
   */
  const [confirmedHere, setConfirmedHere] = useState<ReadonlySet<string>>(() => new Set());
  /** Confirmed sets already measured against the bests, PR or not. Each buzzes at most once. */
  const judged = useRef(new Set<string>());
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
  /** A set the phone could not write down. Said out loud: the athlete believes it is logged. */
  const [unsaved, setUnsaved] = useState(false);
  /** Confirmed, and on their way to the phone's storage. Shown queued until they are in it. */
  const [saving, setSaving] = useState<ReadonlySet<string>>(() => new Set());
  /** The queue as it stands, from the first render: opened from Today, it is already read in. */
  const [ops, setOps] = useState<QueuedOp[]>(queuedOps);
  const [rest, setRest] = useState<RestTimer | null>(null);
  /**
   * The logged set being corrected in the sheet, if any. Tapping a logged
   * row used to open an inline Delete / Keep strip; it opens this instead,
   * and Delete moved into it (F9).
   */
  const [editing, setEditing] = useState<LoggedEdit | null>(null);
  /** An edit the phone could not write down. Said out loud, like a set that was not saved. */
  const [editUnsaved, setEditUnsaved] = useState(false);
  /** Sets corrected on this page: a record an edit uncovers pops its badge in, as a confirm's does. */
  const [editedHere, setEditedHere] = useState<ReadonlySet<string>>(() => new Set());
  /**
   * The RPE a set had when it was made a warm-up on this page, by the set
   * number or the edit sheet. Made working again, it gets that number back
   * rather than the one it was first logged with.
   */
  const heldRpe = useRef(new Map<string, number | null>());
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  /** Warm-up flips and edits made on this page, over whatever the server or queue last said. */
  const [edits, setEdits] = useState<ReadonlyMap<string, SetValues>>(() => new Map());
  /** Deleted on this page, whether or not the delete has reached Appwrite. */
  const [deleted, setDeleted] = useState<ReadonlySet<string>>(() => new Set());
  /** Who has commented on which of this session's sets. */
  const [commentAuthors, setCommentAuthors] = useState<{ setId: string; authorId: string }[]>([]);
  /**
   * Exercises taken out of this session with Remove, keyed to the session so
   * a new one starts with none hidden. Needed for a prescribed exercise, which
   * is otherwise listed from the plan whether or not it has sets.
   */
  const [hiddenBlocks, setHiddenBlocks] = useState<{ sessionId: string | null; ids: ReadonlySet<string> }>({
    sessionId: null,
    ids: NO_IDS,
  });
  /**
   * The Add exercise box opened from the end of the list, while something
   * else -- usually the rest timer -- holds the bottom of the screen.
   */
  const [addingInline, setAddingInline] = useState(false);
  /**
   * Variants swapped to on this page (Swap on a block's header), keyed to the
   * session. `current` is what each block logs into now; `used` is every
   * exercise it has been on, so their sets stay in the block. A reload
   * rebuilds the prescribed half of this from the sets' own
   * `prescription_id` -- see `derivedSwaps`.
   */
  const [swaps, setSwaps] = useState<{
    sessionId: string | null;
    current: ReadonlyMap<string, string>;
    used: ReadonlyMap<string, ReadonlySet<string>>;
  }>({ sessionId: null, current: new Map(), used: new Map() });
  /** The block whose variant picker is open in the sheet. */
  const [swapFor, setSwapFor] = useState<string | null>(null);
  /**
   * The set row last tapped in the list: the one the sheet keeps in view.
   * Taken from the tap itself rather than looked up by id, because a field
   * only ever opens from a tap on its row or from the pad's own Next, which
   * stays on the same row.
   */
  const sheetAnchor = useRef<Element | null>(null);

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
  /**
   * The session whose first read of Appwrite has come back, either way. With
   * the queue loaded, this is when the screen knows what the session already
   * holds -- the condition for laying out a prescribed day by itself.
   */
  const [readSettled, setReadSettled] = useState<string | null>(null);
  /** Whether the queue has read in what the last visit left on disk. */
  const [queueReady, setQueueReady] = useState(queueLoaded);

  // The queue is attached by the provider; this only watches it, so a set that
  // is still on its way keeps its mark and a reload gets its sets back.
  useEffect(
    () =>
      subscribeToQueue((next) => {
        setOps(next);
        setQueueReady(queueLoaded());
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
  /** Sets a clip was attached to on this page; sets read from Appwrite carry their own flag. */
  const [filmed, setFilmed] = useState<ReadonlySet<string>>(new Set());
  /**
   * The file each of those clips went up as, once its attach is queued, so a
   * second replace on this page retires the right file (F17). A set read from
   * Appwrite carries its own `videoFileId`.
   */
  const [clipFiles, setClipFiles] = useState<ReadonlyMap<string, string>>(new Map());
  /** The set a clip is uploading for from the edit sheet; its Delete waits. */
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  /** The edit sheet's "Discard changes?" is up (F16). */
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const targetsOf = useCallback(
    (exerciseId: string, logged: readonly LoggedForTarget[]): SetTarget[] | null => {
      const planned = plan.find((p) => p.exerciseId === exerciseId);
      if (!planned) return null;
      const now = new Date();
      const maxes = basisMaxesFor(exerciseId, prescribed.maxes.entries, prescribed.maxes.estimated, now);
      // A line priced off another lift reads that lift's stored max, never this exercise's sets.
      const references = referenceLookup(prescribed.maxes.entries, prescribed.maxes.estimated, now, nameFor);
      return targetsFor(planned, maxes, logged.map((s) => ({ ...s, rpe: s.rpe ?? null })), references, unit);
    },
    [plan, prescribed.maxes, nameFor, unit],
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
          // Unread, but answered: what the session holds is the queue's now.
          if (readSession.current === sessionId) setReadSettled(sessionId);
          return;
        } finally {
          if (reading.current === sessionId) reading.current = null;
        }
      }
      // Moved to another session while this was in flight: not this list.
      if (readSession.current !== sessionId) return;
      storedRead.current = true;
      setStored(loaded);
      setReadSettled(sessionId);
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

  /**
   * As read or logged, before any edit. Where a flipped-back set finds its RPE.
   *
   * The queue's sets go in directly as well as through `local`, which only
   * catches up an effect and a microtask later: a page reopened with no signal
   * shows its sets in the same frame as the session, not a beat after it.
   */
  const asLogged = useMemo(
    () => mergeById(stored, mergeById(local, queued, (s) => s.clientSetId), (s) => s.clientSetId),
    [stored, local, queued],
  );
  /**
   * Every set this page knows of, deleted or not. What set_index counts from.
   * Edits still in the queue go over it (a reload with no signal), then this
   * page's own, so a flip shows before the queue has announced it.
   */
  const everything = useMemo(
    () => withSetEdits(withSetEdits(asLogged, queuedSetEdits(ops)), edits),
    [asLogged, ops, edits],
  );

  /** Everything logged this session, whether Appwrite has heard of it or not. */
  const all = useMemo(
    () =>
      everything
        .filter((s) => !removed.has(s.clientSetId))
        // A delete the server refused brings its set back: the set is still
        // there, and hiding it would be the screen disagreeing with the coach.
        .filter((s) => !deleted.has(s.clientSetId) || refused.has(s.clientSetId))
        .filter((s) => !pendingDelete?.sets.some((p) => p.clientSetId === s.clientSetId))
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
   * Swaps a reload can still see: a set logged against a prescription line
   * on another exercise than the line's own is the athlete having swapped
   * that line's variant. The latest such set says which variant is in hand.
   */
  const derivedSwaps = useMemo(() => {
    const ownerOfLine = new Map<string, string>();
    for (const exercise of plan) for (const line of exercise.lines) ownerOfLine.set(line.id, exercise.exerciseId);
    const latest = new Map<string, string>();
    const used = new Map<string, Set<string>>();
    for (const set of all) {
      const owner = set.prescriptionId ? ownerOfLine.get(set.prescriptionId) : undefined;
      if (!owner) continue;
      latest.set(owner, set.exerciseId);
      if (set.exerciseId !== owner) used.set(owner, (used.get(owner) ?? new Set()).add(set.exerciseId));
    }
    return { latest, used };
  }, [plan, all]);

  /**
   * Where each block stands: the exercise it logs into now (the variant
   * swapped to, or its own), and which exercises belong to which block.
   *
   * A variant swapped to belongs to the block it was swapped from, so
   * Dumbbell Row sets logged against a Barbell Row line count toward that
   * line, number on from it, and do not open a block of their own. Another
   * prescribed exercise is never absorbed: it has its own line.
   */
  const swapView = useMemo(() => {
    const page = swaps.sessionId === sessionId ? swaps : null;
    const current = new Map(derivedSwaps.latest);
    for (const [blockId, to] of page?.current ?? []) current.set(blockId, to);
    const planned = new Set(plan.map((p) => p.exerciseId));
    const owners = new Map<string, string>();
    for (const blockId of new Set([...planned, ...current.keys()])) {
      const members = [
        current.get(blockId) ?? blockId,
        ...(page?.used.get(blockId) ?? []),
        ...(derivedSwaps.used.get(blockId) ?? []),
      ];
      for (const member of members) {
        if (member !== blockId && !planned.has(member) && !owners.has(member)) owners.set(member, blockId);
      }
    }
    return { inHand: current, owners };
  }, [swaps, sessionId, plan, derivedSwaps]);
  const currentOf = useCallback((blockId: string) => swapView.inHand.get(blockId) ?? blockId, [swapView]);
  const blockOf = useCallback((exerciseId: string) => swapView.owners.get(exerciseId) ?? exerciseId, [swapView]);

  /**
   * Last time and the bests to beat, for every exercise on the screen: each
   * block's own, the variant it is on now, and anything logged or planned.
   * Read in the background, one read per exercise for the session; a block
   * never waits for it, and with no signal it is simply absent.
   */
  const historyIds = useMemo(() => {
    const ids = new Set<string>();
    for (const p of plan) ids.add(p.exerciseId).add(currentOf(p.exerciseId));
    for (const exercise of added) ids.add(exercise.id).add(currentOf(exercise.id));
    for (const set of all) ids.add(set.exerciseId);
    for (const row of plans) ids.add(row.exerciseId);
    return [...ids];
  }, [plan, added, all, plans, currentOf]);
  const histories = useExerciseHistory(athleteId, sessionId, active?.startedAt ?? null, historyIds);

  /**
   * Which logged sets are records, per exact exercise (a variant has its own
   * records), against the bests as they stood when the session started. See
   * lib/strength/pr.ts for why that is not simply the rollups.
   */
  const prs = useMemo(() => {
    const found = new Map<string, PrKind[]>();
    const byExercise = new Map<string, UnnamedSet[]>();
    for (const set of all) byExercise.set(set.exerciseId, [...(byExercise.get(set.exerciseId) ?? []), set]);
    for (const [exerciseId, list] of byExercise) {
      const history = histories.get(exerciseId);
      if (!history) continue;
      const mine = detectPrs(
        list.map((s) => ({ clientSetId: s.clientSetId, loadKg: s.loadKg, reps: s.reps, rpe: s.rpe ?? null, isWarmup: s.isWarmup })),
        history.bests,
      );
      for (const [id, kinds] of mine) found.set(id, kinds);
    }
    return found;
  }, [all, histories]);

  // A record set on this page buzzes once, when it is first measured: at the
  // confirm when the bests are already in hand, or when they arrive. Never
  // again for that set, whatever a later delete or flip does to the badges.
  useEffect(() => {
    const ready = [...confirmedHere].filter((id) => {
      if (judged.current.has(id)) return false;
      const set = all.find((s) => s.clientSetId === id);
      return set !== undefined && histories.has(set.exerciseId);
    });
    if (ready.length === 0) return;
    for (const id of ready) judged.current.add(id);
    if (ready.some((id) => prs.has(id))) haptic("success");
  }, [confirmedHere, all, histories, prs]);

  /** A block's logged sets, across every variant it has been on. */
  const setsOfBlock = useCallback(
    (blockId: string) => all.filter((s) => blockOf(s.exerciseId) === blockId),
    [all, blockOf],
  );

  /**
   * Rows that just appeared, given the coach's target for the set they will
   * be (rule 1 of the prefill order, and rule 2 for a weight priced off
   * today's top set). Rows already on screen keep whatever the athlete typed.
   * Rows only appear from Add set, an exercise being opened or a swap, never
   * in the same tick as a confirm, so the logged sets are always already in
   * state.
   *
   * A row on a swapped variant answers its block's line, at the line's reps
   * and RPE but not its load (`asVariant`). `swapping` names a swap made in
   * this same tick, before state has caught up with it.
   */
  const prescribe = useCallback(
    (
      before: readonly PlannedRow[],
      after: PlannedRow[],
      options: {
        swapping?: { exerciseId: string; blockId: string };
        /** A set confirmed in this same tick, not in state yet. */
        justLogged?: UnnamedSet;
        /** A logged set corrected in this same tick: its new values, over the old in state. */
        edited?: UnnamedSet;
        reprice?: ReadonlySet<string>;
      } = {},
    ) =>
      prescribeNewRows(
        before,
        after,
        (exerciseId) => {
          const { swapping, justLogged, edited } = options;
          const blockId = swapping?.exerciseId === exerciseId ? swapping.blockId : blockOf(exerciseId);
          const logged: LoggedForTarget[] = [
            ...setsOfBlock(blockId).map((set) => (set.clientSetId === edited?.clientSetId ? edited : set)),
            ...(justLogged && blockOf(justLogged.exerciseId) === blockId ? [justLogged] : []),
          ];
          const targets = targetsOf(blockId, logged);
          if (!targets || exerciseId === blockId) return { logged, targets };
          return { logged, targets: asVariant(targets, nameFor(blockId) ?? "the prescribed lift") };
        },
        unit,
        options.reprice,
      ),
    [blockOf, setsOfBlock, targetsOf, nameFor, unit],
  );

  /**
   * The rows a prescribed block lays out when it is opened: every set still
   * to do, with the line's warm-ups ahead (Order 22, v15). Empty for a free
   * block, or once the prescription is done -- one fresh row comes instead.
   */
  const shapeOf = useCallback(
    (blockId: string) => {
      const planned = plan.find((p) => p.exerciseId === blockId);
      if (!planned) return [];
      const logged = setsOfBlock(blockId);
      const targets = targetsOf(blockId, logged);
      return targets ? remainingShape(planned, targets, logged) : [];
    },
    [plan, setsOfBlock, targetsOf],
  );

  /**
   * Last time's set beside each row, logged or not, block by block. Warm-ups
   * line up with warm-ups, working sets with working sets, each exercise of a
   * swapped block with its own last time (lib/logging/previous.ts).
   */
  const previousByRow = useMemo(() => {
    const found = new Map<string, PreviousSet>();
    if (histories.size === 0) return found;
    const blockIds = new Set([...all.map((s) => blockOf(s.exerciseId)), ...plans.map((r) => blockOf(r.exerciseId))]);
    for (const blockId of blockIds) {
      const rows = [...setsOfBlock(blockId), ...rowsOf(plans, currentOf(blockId))];
      alignPrevious(rows, (id) => histories.get(id)?.previous).forEach((previous, at) => {
        if (previous) found.set(rows[at].clientSetId, previous);
      });
    }
    return found;
  }, [histories, all, plans, blockOf, setsOfBlock, currentOf]);

  /**
   * Rule 4 of the prefill order, for exercises nobody prescribed: a row with
   * nothing better to start from takes last session's numbers. Runs when a
   * row appears and again when last time arrives, because the read is in the
   * background and the first row of a free exercise usually beats it.
   */
  useEffect(() => {
    let next = plans;
    for (const exerciseId of new Set(plans.map((row) => row.exerciseId))) {
      const history = histories.get(exerciseId);
      if (!history || plan.some((p) => p.exerciseId === blockOf(exerciseId))) continue;
      const loggedWorking = all.filter((s) => s.exerciseId === exerciseId && !s.isWarmup).length;
      next = fillFromLastSession(next, exerciseId, history.previous, loggedWorking);
    }
    if (next === plans) return;
    void (async () => {
      await Promise.resolve();
      // Only over the rows it was worked out from; a newer list runs this again.
      setPlans((prev) => (prev === plans ? next : prev));
    })();
  }, [plans, histories, all, plan, blockOf]);

  const focused = plans.find((row) => row.clientSetId === focusId) ?? null;

  /** One place that changes the rest timer, so the stored copy cannot drift. */
  const changeRest = useCallback((next: RestTimer | null) => {
    setRest(next);
    if (next) rememberRest(next);
    else forgetRest();
  }, []);

  /**
   * The rest takes itself down at zero, with a short buzz if it ended just now.
   *
   * Driven by the screen's one clock, so this is still a function of the
   * timestamp: a tab that slept through the end resolves to no bar the first
   * tick after it wakes, and does not buzz about something long past (see
   * restJustEnded). A reload past the end never shows a bar at all, because
   * recallRest drops it.
   */
  useEffect(() => {
    if (!rest || !isRestOver(rest, now)) return;
    const buzz = restJustEnded(rest, now);
    void (async () => {
      await Promise.resolve();
      changeRest(null);
      if (buzz) buzzRestOver();
    })();
  }, [rest, now, changeRest]);

  const closeSheets = () => {
    setPad(null);
    setRpeOpen(false);
    setSwapFor(null);
    // An edit not saved is an edit cancelled: the set still shows what was logged.
    setEditing(null);
  };

  /**
   * Moves to a block. A prescribed one lays out every set still to do at
   * once -- warm-ups blank, working sets priced to the coach's lines -- so
   * nobody rebuilds the program from the coach's notes one Add set at a
   * time. Anything else gets one row from rule 3 of the blueprint's prefill
   * order: straight sets are the norm, so repeating the previous set has to
   * cost one tap.
   */
  const activate = useCallback(
    (blockId: string) => {
      const exerciseId = currentOf(blockId);
      const { rows: moved, head } = focusExercise(
        plans,
        exerciseId,
        lastLoggedOf(exerciseId),
        newClientSetId,
        shapeOf(blockId),
      );
      const next = prescribe(plans, moved);
      setPlans(next);
      setFocusId(head.clientSetId);
      setEditing(null);
      setPad(null);
      setRpeOpen(false);
      setSwapFor(null);
      return next;
    },
    [plans, currentOf, lastLoggedOf, shapeOf, prescribe],
  );

  const addExercise = useCallback(
    (exercise: Exercise) => {
      setAdded((prev) => (prev.some((e) => e.id === exercise.id) ? prev : [...prev, exercise]));
      // Adding back an exercise that was removed earlier brings its block back.
      setHiddenBlocks((prev) => {
        if (!prev.ids.has(exercise.id)) return prev;
        const ids = new Set(prev.ids);
        ids.delete(exercise.id);
        return { ...prev, ids };
      });
      setAddingInline(false);
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
   * The next-set load suggestion for an exercise, from its last logged set
   * toward the prescribed set that comes next (Order 28).
   *
   * The coach's switch is applied here, at the one place a suggestion can
   * enter: held means none, whatever the engine would say. Read when the
   * athlete asks for the row with Add set, not when the set before it was
   * confirmed -- confirming no longer builds a row to put it in.
   */
  const suggestionFor = (blockId: string) => {
    // A swapped variant gets none: the engine would be pricing a dumbbell set
    // off a barbell one.
    if (currentOf(blockId) !== blockId) return null;
    const logged = setsOfBlock(blockId);
    const last = logged.at(-1);
    if (!last) return null;
    const targets = targetsOf(blockId, logged);
    const prescribedNext = targets ? nextTarget(targets, logged) : null;
    return nextSetSuggestion(
      suggestionMode,
      { loadKg: last.loadKg, reps: last.reps, rpe: last.rpe ?? null, isWarmup: last.isWarmup },
      setTargetFor(prescribedNext),
      unit,
    );
  };

  /**
   * Writes down another set, and after a confirm, the only way to get one.
   *
   * It does not move the pad: the row being entered stays the row being
   * entered, so an athlete mid-set who plans the back-off loses nothing. The
   * new row's numbers are one tap away if they need changing.
   */
  const addSet = (blockId: string) => {
    setEditing(null);
    const exerciseId = currentOf(blockId);
    const next = prescribe(
      plans,
      addRow(plans, exerciseId, lastLoggedOf(exerciseId), newClientSetId, suggestionFor(blockId), unit),
    );
    setPlans(next);
    // Nothing was being entered anywhere, so the new row's exercise is now
    // the one in hand.
    if (!focused) setFocusId(headOf(next, exerciseId)?.clientSetId ?? null);
  };

  /**
   * Swaps a block to another variant (the same movement on another
   * implement). Its rows not logged yet move to the new exercise and are
   * priced again; a block with none lays out what is left of its
   * prescription on the new one. Logged sets stay exactly what was lifted.
   * The prescription link stays too: the rows answer the block's line, so
   * the coach sees the Dumbbell Row was the Barbell Row they wrote.
   */
  const pickVariant = (blockId: string, to: string) => {
    setSwapFor(null);
    const from = currentOf(blockId);
    if (to === from) return;
    const lastTo = lastLoggedOf(to);
    let moved = swapRows(plans, from, to, lastTo, newClientSetId);
    if (!headOf(moved, to)) moved = focusExercise(moved, to, lastTo, newClientSetId, shapeOf(blockId)).rows;
    const next = prescribe(plans, moved, { swapping: { exerciseId: to, blockId } });
    setPlans(next);
    if (!focused || focused.exerciseId === from) setFocusId(headOf(next, to)?.clientSetId ?? null);
    setPad(null);
    setRpeOpen(false);
    setSwaps((prev) => {
      const base = prev.sessionId === sessionId ? prev : { sessionId, current: new Map(), used: new Map() };
      const current = new Map(base.current).set(blockId, to);
      const used = new Map(base.used).set(blockId, new Set([...(base.used.get(blockId) ?? []), from, to]));
      return { sessionId, current, used };
    });
  };

  const focusField = (rowId: string | null, field: "load" | "reps" | "rpe") => {
    const row = plans.find((each) => each.clientSetId === rowId);
    if (!row) return;
    setFocusId(row.clientSetId);
    setEditing(null);
    setSwapFor(null);
    if (field === "rpe") {
      if (row.isWarmup) return; // Warm-ups never ask.
      setPad(null);
      setRpeOpen(true);
      return;
    }
    setRpeOpen(false);
    setPad(
      field === "load"
        ? beginEdit("load", row.loadKg === null ? null : loadIn(row.loadKg, unit), unit)
        : beginEdit("reps", row.reps),
    );
  };

  const updateFocused = (change: (row: PlannedRow) => PlannedRow) => {
    // Every hand edit goes through here, so it is where a row becomes the athlete's.
    setPlans((prev) => prev.map((row) => (row.clientSetId === focusId ? { ...change(row), touched: true } : row)));
  };

  const applyPad = (next: PadState) => {
    setPad(next);
    const typed = padValue(next);
    // A load is typed in the athlete's unit and stored in kilos, always.
    const value = next.field === "load" && typed !== null ? loadFromInput(typed, next.unit ?? "kg") : typed;
    updateFocused((row) => ({
      ...row,
      [next.field === "load" ? "loadKg" : "reps"]: value,
      // Once the athlete types a load it is theirs, not the suggestion's.
      ...(next.field === "load" ? { note: null, suggested: false } : {}),
    }));
  };

  /**
   * The Previous line's tap on a row not logged yet: last time's load and
   * reps into the row, as if typed. The pad, if it is open on this row,
   * starts again from the new number rather than writing the old one back.
   */
  const copyPrevious = (rowId: string) => {
    const previous = previousByRow.get(rowId);
    if (!previous || !plans.some((row) => row.clientSetId === rowId)) return;
    setPlans((prev) =>
      prev.map((row) =>
        row.clientSetId === rowId
          ? { ...row, loadKg: previous.loadKg, reps: previous.reps, note: null, suggested: false, touched: true }
          : row,
      ),
    );
    if (focusId === rowId && pad) {
      setPad(pad.field === "load" ? beginEdit("load", loadIn(previous.loadKg, unit), unit) : beginEdit("reps", previous.reps));
    }
  };

  const toggleWarmup = (isWarmup: boolean) => {
    updateFocused((row) => ({ ...row, isWarmup, rpe: rpeAfterWarmupChange(isWarmup, row.rpe) }));
    if (isWarmup) setRpeOpen(false);
  };

  /**
   * The set number's tap: warm-up or working, on any row (Set Row, F2).
   *
   * A row not logged yet just changes in place, the same as the pad's switch.
   * A logged set is corrected through `editSet`, History's path: queued, so it
   * is instant with no signal and lands behind the set's own create, and the
   * week's rollup refreshes behind it. Targets and numbering count working
   * sets from these same lists, so both follow the flip.
   */
  const toggleWarmupOf = (rowId: string) => {
    if (plans.some((row) => row.clientSetId === rowId)) {
      setPlans((prev) =>
        prev.map((row) =>
          row.clientSetId === rowId
            ? { ...row, isWarmup: !row.isWarmup, rpe: rpeAfterWarmupChange(!row.isWarmup, row.rpe), touched: true }
            : row,
        ),
      );
      if (focusId === rowId) setRpeOpen(false);
      return;
    }
    const set = all.find((s) => s.clientSetId === rowId);
    // Still on its way to the phone's storage: an edit queued now could
    // outlive a create that fails.
    if (!set || saving.has(rowId)) return;
    // The number flips the set as it stands; a draft open on it would save
    // over the flip with the old flag, so it closes unsaved.
    if (editing?.clientSetId === rowId) setEditing(null);
    const isWarmup = !set.isWarmup;
    // A warm-up carries no RPE. Flipped back on this page, it gets its RPE back.
    if (isWarmup) heldRpe.current.set(rowId, set.rpe ?? null);
    const rpe = isWarmup ? null : rpeToRestore(rowId);
    const edit: SetValues = { loadKg: set.loadKg, reps: set.reps, rpe, isWarmup };
    const before = edits.get(rowId);
    // Over this page's last edit of the set, not instead of it: the flip says
    // nothing about the note, and a note saved here a moment ago stays shown.
    setEdits((prev) => new Map(prev).set(rowId, { ...prev.get(rowId), ...edit }));
    void editSet(rowId, { ...edit, rpe: rpe as RpeValue | null }, set).catch(() => {
      // Not written to the phone, so not flipped: put the row back.
      setEdits((prev) => {
        const next = new Map(prev);
        if (before) next.set(rowId, before);
        else next.delete(rowId);
        return next;
      });
    });
  };

  /** The RPE a warm-up made working again should carry: the one it had on this page, else as logged. */
  const rpeToRestore = (rowId: string): number | null =>
    heldRpe.current.has(rowId)
      ? (heldRpe.current.get(rowId) ?? null)
      : (asLogged.find((s) => s.clientSetId === rowId)?.rpe ?? null);

  /* --- Correcting a logged set (F9) ------------------------------------ */

  /**
   * A tap on a logged row: the sheet opens on it, prefilled with its load,
   * reps and RPE, on the weight -- the number most often mistyped, and the
   * one the keypad's Next walks on from.
   *
   * A second tap on the same row closes it unsaved, the way the old Delete /
   * Keep strip toggled. A set still on its way to the phone's storage is not
   * opened, for the same reason the set number will not flip it: an edit
   * queued now could outlive a create that fails.
   */
  const openEdit = (clientSetId: string) => {
    if (editing?.clientSetId === clientSetId) {
      setEditing(null);
      return;
    }
    const set = all.find((s) => s.clientSetId === clientSetId);
    if (!set || saving.has(clientSetId)) return;
    closeSheets();
    setAddingInline(false);
    setEditUnsaved(false);
    setConfirmDiscard(false);
    setEditing({
      clientSetId,
      draft: draftOf(set, rpeToRestore(clientSetId)),
      field: "load",
      pad: beginEdit("load", loadIn(set.loadKg, unit), unit),
    });
  };

  /** Moves the edit sheet to another field; the keypad starts from the draft's number. */
  const editField = (field: EditField) => {
    setEditing((prev) => {
      if (!prev || (field === "rpe" && prev.draft.isWarmup)) return prev;
      const { loadKg, reps } = prev.draft;
      const pad =
        field === "rpe" || field === "note"
          ? null
          : field === "load"
            ? beginEdit("load", loadKg === null ? null : loadIn(loadKg, unit), unit)
            : beginEdit("reps", reps);
      return { ...prev, field, pad };
    });
  };

  /**
   * A key in the edit sheet. Only a key changes the draft: an untouched load
   * stays the exact kilos logged, rather than coming back through a pounds
   * round trip a gram off and reading as an edit.
   */
  const applyEditPad = (next: PadState) => {
    setEditing((prev) => {
      if (!prev) return prev;
      const typed = padValue(next);
      const value = next.field === "load" && typed !== null ? loadFromInput(typed, next.unit ?? "kg") : typed;
      const draft = { ...prev.draft, [next.field === "load" ? "loadKg" : "reps"]: value };
      return { ...prev, pad: next, draft };
    });
  };

  const editDraft = (change: Partial<EditDraft>) =>
    setEditing((prev) => (prev ? { ...prev, draft: { ...prev.draft, ...change } } : prev));

  /**
   * Save in the edit sheet: the correction goes through `editSet`, exactly
   * as the set number's warm-up flip does. Queued, so it is instant with no
   * signal and lands behind the set's own create; the week's rollup is
   * refreshed behind it, and Appwrite recomputes the stored e1RM from the
   * four values. The clip is not part of the edit and stays where it is.
   * The note (F11) rides in the same update, so a note written with no
   * signal is queued, shown, and read back from the queue after a reload
   * like any other correction.
   *
   * On screen it shows at once, through the same `edits` map: the PR badges,
   * the Previous line, the numbering, the coach's targets and the session
   * totals are all derived from those lists, so all of them follow. When
   * the set corrected is the exercise's latest, untouched rows behind it
   * follow too, as they would have if it had been logged that way.
   *
   * If the phone cannot write the edit down, the set goes back to what it
   * was and the athlete is told -- a correction that silently undid itself
   * would be worse than none.
   */
  const saveEdit = () => {
    if (!editing) return;
    const id = editing.clientSetId;
    const edit = editOf(editing.draft);
    if (!edit) return;
    setEditing(null);
    const set = all.find((s) => s.clientSetId === id);
    if (!set || saving.has(id) || !changesSet(set, edit)) return;
    if (edit.isWarmup && !set.isWarmup) heldRpe.current.set(id, editing.draft.rpe);
    if (!edit.isWarmup) heldRpe.current.delete(id);

    const before = edits.get(id);
    setEdits((prev) => new Map(prev).set(id, edit));
    setEditedHere((prev) => new Set(prev).add(id));
    setEditUnsaved(false);

    if (setsOf(set.exerciseId).at(-1)?.clientSetId === id) {
      const corrected: UnnamedSet = { ...set, ...edit };
      const behind = refreshBehind(plans, corrected);
      if (behind.reprice.size > 0) {
        setPlans(prescribe(plans, behind.rows, { edited: corrected, reprice: behind.reprice }));
      }
    }

    void editSet(id, { ...edit, rpe: edit.rpe as RpeValue | null }, set).catch(() => {
      // Not written to the phone, so not corrected. Only if nothing newer
      // has been laid over it since.
      setEdits((prev) => {
        if (prev.get(id) !== edit) return prev;
        const next = new Map(prev);
        if (before) next.set(id, before);
        else next.delete(id);
        return next;
      });
      setEditUnsaved(true);
    });
  };

  const confirmSet = async (rowId: string) => {
    const row = plans.find((each) => each.clientSetId === rowId);
    // The coach's video ask is a nudge, never a gate (Order 30): the badge
    // asks, the camera under the block takes the clip once the set exists.
    if (!row || !active || !athleteId || !canComplete({ ...row, videoRequired: false })) return;
    // Only the head of an exercise's plan is ever offered a confirm square;
    // this makes the rule hold even if a stale handler fires.
    if (headOf(plans, row.exerciseId)?.clientSetId !== rowId) return;
    setBusy(true);
    setEditing(null);
    // The row leaves the plan at once, so a tap on Add set while the write is
    // still reaching the phone builds on a logged set rather than behind a
    // planned one. It carries the queued mark until the queue holds it, and
    // if the write fails it is taken back, loudly -- see the catch.
    const optimistic: UnnamedSet = {
      exerciseId: row.exerciseId,
      clientSetId: row.clientSetId,
      setIndex: nextSetIndex(everything.filter((s) => s.exerciseId === row.exerciseId)),
      loadKg: row.loadKg as number,
      reps: row.reps as number,
      rpe: row.rpe,
      isWarmup: row.isWarmup,
      loggedAt: new Date(),
      // What a reload reads back from the queue too: it keeps a swapped
      // variant's set in its line's block.
      ...(row.prescriptionId && !row.isWarmup ? { prescriptionId: row.prescriptionId } : {}),
    };
    setSaving((prev) => new Set(prev).add(row.clientSetId));
    setLocal((prev) => [...prev, optimistic]);
    setConfirmedHere((prev) => new Set(prev).add(row.clientSetId));
    // A row the athlete already planned becomes the head; with none, the
    // exercise simply shows what was logged and Add set. No row is invented.
    const { rows, next } = afterConfirm(plans, rowId);
    // Untouched rows behind it follow the set just logged: an RPE line's next
    // set repeats it, a backoff is priced off it (lib/logging/plan.ts).
    const behind = refreshBehind(rows, optimistic);
    setPlans(
      behind.reprice.size > 0 ? prescribe(rows, behind.rows, { justLogged: optimistic, reprice: behind.reprice }) : rows,
    );
    setFocusId(next?.clientSetId ?? null);
    closeSheets();
    // The rest starts on the tap, as it always has: nothing else on screen
    // waits for the disk, and a rest that appeared a beat late read as a
    // missed tap. A failed write takes it back below, with the set.
    // Warm-ups start it too. Anything else is a rule an athlete has to learn,
    // and the feature list is explicit that this is the part Strong keeps
    // simple on purpose.
    const restBefore = rest;
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
      // The device could not write to its own storage, so the set genuinely is
      // not logged. It comes off the logged list and back to the head of its
      // exercise with the athlete's numbers, and they are told -- a row that
      // quietly reappears unticked reads as a glitch, not as a lost set.
      setLocal((prev) => prev.filter((s) => s.clientSetId !== row.clientSetId));
      setPlans((prev) => (prev.some((each) => each.clientSetId === row.clientSetId) ? prev : [row, ...prev]));
      // A rest for a set that does not exist. Whatever was running before it
      // comes back, the same as undoing a delete.
      changeRest(restBefore);
      setUnsaved(true);
      return;
    } finally {
      setSaving((prev) => {
        const rest = new Set(prev);
        rest.delete(row.clientSetId);
        return rest;
      });
      setBusy(false);
    }

    // Saved: the queued mark carries on until Appwrite has it, and any
    // earlier warning is out of date.
    setUnsaved(false);
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
    setDeleted((prev) => {
      const next = new Set(prev);
      for (const set of pending.sets) next.add(set.clientSetId);
      return next;
    });
    setPendingDelete(null);
    // One removeSet per set, the same path a swipe takes: the queue withdraws
    // creates that never sent, and each landed set queues its delete and its
    // rollup refresh, so the week's totals follow a removed exercise too.
    for (const set of pending.sets) {
      const id = set.clientSetId;
      void removeSet(id, { exerciseId: set.exerciseId, loggedAt: set.loggedAt }).catch(() => {
        // The device could not write to its own storage, so the delete does not
        // exist anywhere. The set comes back rather than looking deleted --
        // and so does its exercise, or the set would be back but invisible.
        setDeleted((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        if (pending.block) {
          const exerciseId = pending.block.exerciseId;
          setHiddenBlocks((prev) => {
            const ids = new Set(prev.ids);
            ids.delete(exerciseId);
            return { ...prev, ids };
          });
        }
      });
    }
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

  const deleteLogged = (clientSetId: string) => {
    const set = all.find((s) => s.clientSetId === clientSetId);
    if (!set || commented.has(clientSetId)) return;
    // One toast at a time. The previous delete stops being undoable the
    // moment a second one starts, rather than stacking toasts over the pad.
    commitDelete();

    const mine = setsOfBlock(blockOf(set.exerciseId));
    const at = mine.findIndex((s) => s.clientSetId === clientSetId);
    const number = set.isWarmup ? null : mine.slice(0, at + 1).filter((s) => !s.isWarmup).length;
    const name = nameFor(set.exerciseId) ?? "Set";
    const label = number === null ? `${name} warm-up deleted` : `${name} set ${number} deleted`;

    // The rest belongs to the most recent set. Deleting that one means the
    // rest was for a set that did not happen; deleting an older one leaves it.
    const latest = all.at(-1)?.clientSetId === clientSetId;
    const pending: PendingDelete = { sets: [set], label, restBefore: latest ? rest : null, block: null };
    if (latest && rest) changeRest(null);

    pendingRef.current = pending;
    setPendingDelete(pending);
    setEditing(null);
    undoTimer.current = setTimeout(commitDelete, UNDO_MS);
  };

  /** Sets that cannot be deleted: a coach has commented, or the server said no. */
  const undeletable = useMemo(() => new Set([...commented, ...refused.keys()]), [commented, refused]);

  /**
   * Takes a whole exercise out of the session (Remove on its header).
   *
   * Every logged set goes through the same pending delete as a swipe -- one
   * toast, five seconds of Undo, then removeSet per set -- so offline it
   * behaves exactly as deleting each set by hand would. Planned rows are
   * dropped with it and come back on Undo.
   */
  const membersOf = (blockId: string) =>
    new Set([blockId, ...all.filter((s) => blockOf(s.exerciseId) === blockId).map((s) => s.exerciseId), currentOf(blockId)]);

  const removeExercise = (exerciseId: string, name: string) => {
    const members = membersOf(exerciseId);
    const decision = planBlockRemoval(members, all, undeletable, all.at(-1)?.clientSetId ?? null);
    if (decision.kind === "blocked") return;
    commitDelete();

    const droppedPlans = plans.filter((row) => members.has(row.exerciseId));
    setPlans((prev) => prev.filter((row) => !members.has(row.exerciseId)));
    if (focused && members.has(focused.exerciseId)) {
      setFocusId(null);
      closeSheets();
    }
    setEditing(null);
    setHiddenBlocks((prev) => {
      const ids = new Set(prev.sessionId === sessionId ? prev.ids : NO_IDS);
      ids.add(exerciseId);
      return { sessionId, ids };
    });

    const pending: PendingDelete = {
      sets: decision.sets,
      label: blockRemovalLabel(name, decision.sets),
      restBefore: decision.clearsRest ? rest : null,
      block: { exerciseId, plans: droppedPlans },
    };
    if (decision.clearsRest && rest) changeRest(null);

    pendingRef.current = pending;
    setPendingDelete(pending);
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
    if (pending.block) {
      const { exerciseId, plans: dropped } = pending.block;
      setHiddenBlocks((prev) => {
        const ids = new Set(prev.ids);
        ids.delete(exerciseId);
        return { ...prev, ids };
      });
      setPlans((prev) => [...prev, ...dropped.filter((row) => !prev.some((p) => p.clientSetId === row.clientSetId))]);
    }
  };

  // A prescribed session opens on its first exercise, ready to log, so the
  // athlete's first tap is a set rather than finding the squat in a list.
  //
  // Only a session with nothing logged, and only once the screen knows that:
  // the queue has read in what the last visit left, and either the session's
  // own create is still waiting in it (so Appwrite cannot hold a set of it)
  // or the first read of Appwrite has come back. Laying out sooner would lay
  // out a resumed session from scratch -- warm-ups for a line already under
  // way -- and those rows would sit there wrong once its sets arrived. A
  // resumed session opens nothing by itself; the tap on the block in hand
  // lays out what is left of it.
  const firstPlanned = plan[0]?.exerciseId ?? null;
  const unsent = useMemo(
    () =>
      sessionId !== null &&
      pendingOps(ops).some((op) => op.kind === "session.create" && op.payload.sessionId === sessionId),
    [ops, sessionId],
  );
  const setsKnown = queueReady && (unsent || readSettled === sessionId);
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (!firstPlanned || !sessionId || !setsKnown || opened.current === sessionId) return;
    opened.current = sessionId;
    if (plans.length > 0 || all.length > 0 || queued.length > 0) return;
    void (async () => {
      await Promise.resolve();
      activate(firstPlanned);
    })();
  }, [firstPlanned, sessionId, setsKnown, plans.length, all.length, queued.length, activate]);

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
    const totals = summary;
    const records = sessionPrs(
      all.map((s) => ({ ...s, rpe: s.rpe ?? null })),
      prs,
    );
    try {
      await finish(active.id, { setCount: totals.setCount, tonnageKg: totals.tonnageKg });
      changeRest(null);
      setFinished(totals);
      setFinishedPrs(records);
      setPhase("finished");
    } finally {
      setBusy(false);
    }
  };

  if (phase === "finished") {
    return (
      <FinishedSummary
        summary={finished ?? summary}
        prs={finishedPrs}
        nameFor={nameFor}
        unit={unit}
        onDone={() => router.push("/today")}
      />
    );
  }

  if (!active) {
    return (
      <div className="pt-8 flex flex-1 flex-col gap-5 pb-6">
        <h1 className="m-0 text-display font-semibold">Log</h1>
        <WeekSummaryCard
          athleteId={athleteId}
          sessions={trainingState.sessions}
          sessionsLoading={trainingState.status === "loading"}
          unit={unit}
        />
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

  // Reopened mid-session: the session is remembered on the device and known at
  // once, but what the last visit queued is still being read off the phone
  // (tens of milliseconds). Shown before then, the session is shown empty --
  // "Nothing logged yet", and a Finish that would total nothing -- and the sets
  // pop in a beat later. The session appears whole or not yet.
  if (!queueReady) {
    return (
      <div className="pt-8 flex flex-1 flex-col" aria-busy="true">
        <header className="flex items-baseline justify-between gap-3">
          <h1 className="m-0 text-display font-semibold">Session</h1>
        </header>
      </div>
    );
  }

  // Prescribed exercises lead, in the coach's order, whether or not anything
  // is logged yet. Then exercises with sets, then ones added or planned but
  // not logged into yet. Planned counts: deleting the only set of an exercise
  // must not take the rows the athlete was about to log with it.
  //
  // A block is named for the exercise in hand: a swapped one reads "Dumbbell
  // Row" and says underneath what the coach wrote. Its variants' sets and rows
  // are inside it, never a block of their own.
  const blockName = (id: string, fallback: string) => {
    const current = currentOf(id);
    return (current !== id ? nameFor(current) : null) ?? nameFor(id) ?? fallback;
  };
  const blocks: { id: string; name: string }[] = plan.map((p) => ({
    id: p.exerciseId,
    name: blockName(p.exerciseId, "Prescribed exercise"),
  }));
  const shown = new Set(blocks.map((b) => b.id));
  const list = (exerciseId: string, fallback: string) => {
    const id = blockOf(exerciseId);
    if (shown.has(id)) return;
    blocks.push({ id, name: blockName(id, id === exerciseId ? fallback : id) });
    shown.add(id);
  };
  for (const group of groups) list(group.exerciseId, group.exerciseName);
  for (const exercise of added) list(exercise.id, exercise.name);
  for (const row of plans) list(row.exerciseId, nameFor(row.exerciseId) ?? row.exerciseId);

  const hidden = hiddenBlocks.sessionId === sessionId ? hiddenBlocks.ids : NO_IDS;
  const listed = blocks.filter((block) => !hidden.has(block.id));
  const listedIds = listed.map((block) => block.id);

  const focusedNumber = (() => {
    if (!focused) return 1;
    const mine = rowsOf(plans, focused.exerciseId);
    const working = setsOfBlock(blockOf(focused.exerciseId)).filter((s) => !s.isWarmup).length;
    const index = plannedIndex(working, mine, mine.findIndex((r) => r.clientSetId === focused.clientSetId));
    return index === "W" ? working + 1 : index;
  })();

  /** The coach's lines, then the next set's target, for one exercise block. */
  const targetFor = (exerciseId: string): string[] | null => {
    const logged = setsOfBlock(exerciseId);
    const targets = targetsOf(exerciseId, logged);
    const planned = plan.find((p) => p.exerciseId === exerciseId);
    if (!targets || !planned) return null;
    const next = nextTarget(targets, logged);
    return [...lineSummaries(planned, targets), ...(next ? [`Next: ${targetLine(next)}`] : [])];
  };

  /**
   * What gets the bottom of the screen. Exactly one thing does.
   *
   * "Add" losing to the rest no longer strands the athlete: while anything
   * else holds the bottom, an Add exercise button at the end of the list
   * opens the same box there (see addingInline), so a rest never has to be
   * skipped to move on to the next lift.
   *
   * The order is by how committed the athlete already is. Mid-entry beats
   * everything; the variant picker, opened by a tap a moment ago, comes next.
   * Confirming a finish beats the rest timer, which beats adding an
   * exercise -- and the last two are the collision worth naming, because a set
   * being logged is the same instant the timer starts and the typeahead comes
   * back. Stacking them would push both out of the thumb zone.
   *
   * The undo toast is the one thing allowed to sit above whichever it is: it
   * lasts five seconds, and hiding the rest timer to show it would cost more
   * than it saves.
   */
  const editingSet = editing ? (all.find((s) => s.clientSetId === editing.clientSetId) ?? null) : null;
  const bottom: "edit" | "pad" | "rpe" | "swap" | "confirm" | "rest" | "add" =
    editingSet !== null
      ? "edit"
      : pad !== null
      ? "pad"
      : rpeOpen
        ? "rpe"
        : swapFor !== null
          ? "swap"
          : phase === "confirming"
            ? "confirm"
            : rest
              ? "rest"
              : "add";

  /** What Swap offers on a block: the coach's pick first, then its siblings. */
  const variantsOf = (blockId: string) => {
    const pick = library.exercises.find((e) => e.id === blockId);
    if (!pick) return [];
    // An exercise with a block of its own is not offered: it would end up in two.
    const elsewhere = new Set(listedIds.filter((id) => id !== blockId));
    return swapOptions(pick, library.exercises, elsewhere);
  };
  const swapping = swapFor !== null && listedIds.includes(swapFor) ? variantsOf(swapFor) : [];

  /**
   * The pad, the RPE chips, the variant picker or the rest timer, in the
   * sheet pinned above the tab bar. Not in the footer: on a prescribed day
   * the footer is a long way below the row being typed into, or the set just
   * logged. Each still takes its turn in `bottom`, so only the winner shows
   * and the sheet swaps content rather than stacking.
   */
  const editLabel = (() => {
    if (!editingSet) return "Set";
    if (editingSet.isWarmup) return "Warm-up set";
    const mine = setsOfBlock(blockOf(editingSet.exerciseId));
    const at = mine.findIndex((s) => s.clientSetId === editingSet.clientSetId);
    return `Set ${mine.slice(0, at + 1).filter((s) => !s.isWarmup).length}`;
  })();

  /** The file a set's clip is in now, as far as this page knows. */
  const clipFileOf = (set: { clientSetId: string; videoFileId?: string | null }) =>
    clipFiles.get(set.clientSetId) ?? set.videoFileId ?? null;

  /**
   * A clip on its way to `setId`, from the block's camera or the edit sheet.
   * A replacement retires the file it replaced once its own attach is
   * queued, the way the Clips screen does (docs/video.md, F13): queued any
   * earlier, the cleanup would find the set still naming the old file and
   * keep it for good. A clip still uploading leaves the old file for the
   * sweep. The new file is what the set names from here on, so the coach's
   * Review Queue sees a replaced clip as new (F15).
   */
  const clipAttached = (setId: string, oldFileId: string | null) => (result: UploadResult) => {
    setFilmed((prev) => new Set(prev).add(setId));
    if (!result.ok) return;
    setClipFiles((prev) => new Map(prev).set(setId, result.fileId));
    if (oldFileId && result.fileId !== oldFileId) void retireReplacedClip(setId, oldFileId).catch(() => {});
  };

  /**
   * Whether closing the edit sheet now would lose anything: the inverse of
   * Save's no-op, so a sheet Save would simply close never asks first.
   */
  const editDirty = (() => {
    if (!editing || !editingSet) return false;
    const edit = editOf(editing.draft);
    return edit === null || changesSet(editingSet, edit);
  })();

  /** A tap on the scrim, or Escape (F16): an untouched draft just closes. */
  const dismissEdit = () => {
    if (editDirty) setConfirmDiscard(true);
    else setEditing(null);
  };

  const editSheet =
    bottom === "edit" && editing && editingSet ? (
      <EditSetSheet
        setLabel={editLabel}
        exerciseName={nameFor(editingSet.exerciseId) ?? editingSet.exerciseId}
        draft={editing.draft}
        field={editing.field}
        pad={editing.pad}
        unit={unit}
        canSave={editOf(editing.draft) !== null}
        onField={editField}
        onPadChange={applyEditPad}
        onToggleWarmup={(isWarmup) => {
          editDraft({ isWarmup });
          // A warm-up is never asked for RPE: off the chips, onto the reps.
          if (isWarmup && editing.field === "rpe") editField("reps");
        }}
        onRpe={(rpe) => editDraft({ rpe })}
        onNote={(notes) => editDraft({ notes })}
        onSave={saveEdit}
        onCancel={() => setEditing(null)}
        onDelete={() => deleteLogged(editingSet.clientSetId)}
        deleteBlocked={undeletable.has(editingSet.clientSetId) ? COACH_COMMENTED : null}
        // A finished upload must not re-attach a clip to a set just deleted.
        deleteDisabled={uploadingFor === editingSet.clientSetId}
        video={
          athleteId ? (
            <AttachVideo
              key={editingSet.clientSetId}
              setId={editingSet.clientSetId}
              athleteId={athleteId}
              hasVideo={Boolean(editingSet.hasVideo) || filmed.has(editingSet.clientSetId)}
              onAttached={clipAttached(editingSet.clientSetId, clipFileOf(editingSet))}
              onUploadingChange={(uploading) => {
                const id = editingSet.clientSetId;
                setUploadingFor((was) => (uploading ? id : was === id ? null : was));
              }}
            />
          ) : null
        }
      />
    ) : null;

  const sheet =
    bottom === "swap" && swapFor !== null && swapping.length > 0 ? (
      <VariantSheet
        name={blockName(swapFor, swapFor)}
        options={swapping}
        currentId={currentOf(swapFor)}
        coachId={plan.some((p) => p.exerciseId === swapFor) ? swapFor : null}
        onPick={(to) => pickVariant(swapFor, to)}
        onCancel={() => setSwapFor(null)}
      />
    ) : bottom === "rest" && rest ? (
      // The rest rides in the sheet too, so it is in view after logging a
      // set however far down a long prescribed day the row was.
      <RestBar
        inSheet
        timer={rest}
        now={now}
        onExtend={() => changeRest(extendRest(rest))}
        onSkip={() => changeRest(null)}
      />
    ) : bottom === "pad" && pad !== null && focused ? (
      <NumberPad
        inSheet
        state={pad}
        onChange={applyPad}
        onNext={() => (pad.field === "load" ? focusField(focusId, "reps") : focusField(focusId, "rpe"))}
        nextLabel={pad.field === "load" ? "Reps" : focused.isWarmup ? "Done" : "RPE"}
        isWarmup={focused.isWarmup}
        onToggleWarmup={toggleWarmup}
        onDismiss={() => setPad(null)}
      />
    ) : bottom === "rpe" && focused ? (
      <RpeSheet
        inSheet
        setIndex={focusedNumber}
        value={focused.rpe}
        onSelect={(value) => {
          updateFocused((row) => ({ ...row, rpe: value }));
          setRpeOpen(false);
        }}
      />
    ) : null;
  const sheetField = bottom === "pad" && pad !== null ? pad.field : bottom === "rpe" ? "rpe" : null;
  const revealKey =
    bottom === "edit" && editing ? `edit:${editing.clientSetId}:${editing.field}` : sheetField && `${focusId}:${sheetField}`;

  return (
    // The sheet's containing block: it sticks to the bottom of <main> for as
    // long as this is on screen, which is the whole page. The content's own
    // bottom padding lives on the inner column so the stuck sheet meets the
    // tab bar with no gap under it.
    <div className="pt-8 flex flex-1 flex-col">
      <div
        className="flex flex-1 flex-col gap-5 pb-6"
        onClickCapture={(event) => {
          // Only taps inside a set row move the anchor; a tap on the pad's Next
          // lands outside this column and keeps the row it is typing into.
          const row = (event.target as Element).closest('[role="group"]');
          if (row) sheetAnchor.current = row;
        }}
      >
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

        {listed.length === 0 ? (
          <EmptyState title="Nothing logged yet" body="Add the first exercise and start working." />
        ) : (
          <div className="flex flex-col gap-6">
            {listed.map((block) => {
              const exerciseId = currentOf(block.id);
              const mine = setsOfBlock(block.id);
              const blockTargets = targetsOf(block.id, mine) ?? [];
              const workingIds = mine.filter((s) => !s.isWarmup).map((s) => s.clientSetId);
              // The coach's ask, set by set: the nth working set answers the
              // nth target, the same rule the targets themselves follow.
              const asked = (clientSetId: string) => {
                const at = workingIds.indexOf(clientSetId);
                return at >= 0 && blockTargets[at]?.videoRequired === true;
              };
              const hasClip = (s: { clientSetId: string; hasVideo?: boolean }) =>
                Boolean(s.hasVideo) || filmed.has(s.clientSetId);
              const options = variantsOf(block.id);
              const isPrescribed = plan.some((p) => p.exerciseId === block.id);
              return (
                <ExerciseBlock
                  key={block.id}
                  name={block.name}
                  sets={mine.map<LoggedSet>((s) => ({
                    clientSetId: s.clientSetId,
                    pendingSync: unsynced.has(s.clientSetId) || saving.has(s.clientSetId),
                    loadKg: s.loadKg,
                    reps: s.reps,
                    rpe: (s.rpe as RpeValue | null) ?? null,
                    isWarmup: s.isWarmup,
                    ...(asked(s.clientSetId) ? { videoRequired: true, hasVideo: hasClip(s) } : {}),
                    deleteBlocked:
                      commented.has(s.clientSetId) || refused.has(s.clientSetId) ? COACH_COMMENTED : null,
                    previous: previousByRow.get(s.clientSetId) ?? null,
                    pr: prs.get(s.clientSetId) ?? null,
                    prFresh: confirmedHere.has(s.clientSetId) || editedHere.has(s.clientSetId),
                    notes: s.notes ?? null,
                    // Any set with a clip shows its thumbnail (F12). One
                    // attached on this page has no poster id yet: the
                    // placeholder until the next load.
                    clip: hasClip(s) ? { posterId: s.videoPosterId ?? null } : null,
                  }))}
                  planned={rowsOf(plans, exerciseId).map((row) => ({
                    ...row,
                    previous: previousByRow.get(row.clientSetId) ?? null,
                  }))}
                  onCopyPrevious={copyPrevious}
                  historyHref={`/lift/${encodeURIComponent(exerciseId)}`}
                  focusedId={editingSet ? editingSet.clientSetId : pad !== null || rpeOpen ? focusId : null}
                  target={targetFor(block.id)}
                  unit={unit}
                  onFocus={focusField}
                  onConfirm={(id) => void confirmSet(id)}
                  onDiscard={discardPlanned}
                  onToggleWarmup={toggleWarmupOf}
                  onAddSet={() => addSet(block.id)}
                  onActivate={() => activate(block.id)}
                  onSelect={openEdit}
                  onDelete={deleteLogged}
                  onRemove={() => removeExercise(block.id, block.name)}
                  removeBlocked={(() => {
                    const decision = planBlockRemoval(membersOf(block.id), all, undeletable, null);
                    return decision.kind === "blocked" ? decision.reason : null;
                  })()}
                  onSwap={
                    options.length > 0
                      ? () => {
                          closeSheets();
                          setSwapFor(block.id);
                        }
                      : undefined
                  }
                  prescribedAs={isPrescribed && exerciseId !== block.id ? (nameFor(block.id) ?? null) : null}
                  camera={(() => {
                    // A clip lands on the set the coach asked to see when one
                    // is still unfilmed; otherwise on the most recently logged
                    // set of the block, per the Set Row spec. Absent until
                    // there is one, so the athlete is never offered a camera
                    // with nowhere to put a clip.
                    const unfilmed = mine.filter((s) => asked(s.clientSetId) && !hasClip(s)).at(-1);
                    const target =
                      unfilmed ??
                      setForNewClip(
                        mine.map((set) => ({
                          ...set,
                          exerciseId: block.id,
                          loggedAt: set.loggedAt instanceof Date ? set.loggedAt : new Date(set.loggedAt),
                        })),
                        block.id,
                      );
                    if (!target || !athleteId) return null;
                    // A coach's video request (Order 30): a nudge, never a gate.
                    // Backoff sets (Order 21) take positions too, so each line
                    // carries how many its rule adds right now.
                    const ask = videoAsk({
                      lines: plan
                        .find((p) => p.exerciseId === block.id)
                        ?.lines.map((line) => ({
                          ...line,
                          backoffSets: blockTargets.filter((t) => t.prescriptionId === line.id && t.backoff).length,
                        })),
                      loggedWorking: workingIds.length,
                      hasClip: mine.some(hasClip),
                    });
                    return (
                      <AttachVideo
                        key={target.clientSetId}
                        setId={target.clientSetId}
                        athleteId={athleteId}
                        ask={ask}
                        onAttached={clipAttached(target.clientSetId, clipFileOf(target))}
                      />
                    );
                  })()}
                />
              );
            })}
          </div>
        )}

        {/*
          Add exercise, always in reach. The box itself lives at the bottom of
          the screen when nothing else does; while the rest timer (or the pad, or
          the RPE sheet) holds that spot, this opens the same box here at the end
          of the list instead, so the athlete never has to Skip a rest to move to
          the next lift. Opened, it stays until a pick or Cancel, even if the
          rest ends underneath it -- text half-typed must not jump.
        */}
        {addingInline ? (
          <div className="flex flex-col gap-2">
            <ExerciseTypeahead
              exercises={library.exercises}
              label="Add exercise"
              placeholder="Add an exercise"
              clearOnSelect
              autoFocus
              onSelect={addExercise}
              onCreate={createExercise}
              hint={library.status === "failed" ? "Library unavailable — you can still type a name." : null}
            />
            <Button variant="ghost" size="sm" onClick={() => setAddingInline(false)}>
              Cancel
            </Button>
          </div>
        ) : bottom !== "add" && bottom !== "confirm" ? (
          <Button
            variant="secondary"
            block
            onClick={() => {
              closeSheets();
              setAddingInline(true);
            }}
          >
            + Add exercise
          </Button>
        ) : null}

        {/*
          The finish control nobody has to discover. The clock still works, but
          a tappable timer is a convention an athlete has to be told about.
          Outlined rather than filled, and spaced off the last exercise, so a
          thumb reaching for Add set or a confirm square does not end the
          session. Gone while the confirm panel asks: one finish control at a
          time. It closes the pad and the RPE sheet first, because both outrank
          the panel for the bottom of the screen and it would otherwise wait
          unseen behind them.
        */}
        {bottom !== "confirm" ? (
          <Button
            variant="secondary"
            size="lg"
            block
            className="mt-2"
            onClick={() => {
              closeSheets();
              setAddingInline(false);
              setPhase("confirming");
            }}
            aria-label="End session"
          >
            End session
          </Button>
        ) : null}

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

          {unsaved ? (
            <div
              role="alert"
              className="flex items-center justify-between gap-3 rounded-card border border-danger-line bg-surface p-3"
            >
              <p className="m-0 text-caption text-foreground">
                That set wasn&rsquo;t saved &mdash; this phone couldn&rsquo;t store it. Your numbers are still in
                the row. Free up some space, then tap it again.
              </p>
              <Button variant="ghost" size="sm" onClick={() => setUnsaved(false)}>
                OK
              </Button>
            </div>
          ) : null}

          {editUnsaved ? (
            <div
              role="alert"
              className="flex items-center justify-between gap-3 rounded-card border border-danger-line bg-surface p-3"
            >
              <p className="m-0 text-caption text-foreground">
                That change wasn&rsquo;t saved &mdash; this phone couldn&rsquo;t store it. The set is as it was
                logged. Free up some space, then edit it again.
              </p>
              <Button variant="ghost" size="sm" onClick={() => setEditUnsaved(false)}>
                OK
              </Button>
            </div>
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

          {bottom === "add" && !addingInline ? (
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

      {/* One sheet at a time, pinned where a thumb already is. */}
      <LogSheet anchor={sheetAnchor} revealKey={revealKey}>
        {sheet}
      </LogSheet>

      {/* Editing a logged set is modal, over a dimmed page (F16). */}
      <ModalSheet label={`Edit ${editLabel}`} onDismiss={dismissEdit} anchor={sheetAnchor} revealKey={revealKey}>
        {editSheet}
      </ModalSheet>
      {/* A sibling, not inside the sheet: an Escape here must not reach the
          sheet's own Escape and ask again. */}
      {confirmDiscard && editSheet ? (
        <Dialog labelledBy="discard-edit-q" size="md" onClose={() => setConfirmDiscard(false)}>
          <h2 id="discard-edit-q" className="m-0 text-title font-semibold">
            Discard changes?
          </h2>
          <p className="mt-2 mb-0 text-body text-muted">{editLabel} stays as logged.</p>
          <div className="mt-5 flex gap-3">
            <Button block variant="secondary" onClick={() => setConfirmDiscard(false)}>
              Keep editing
            </Button>
            <Button
              block
              variant="danger"
              onClick={() => {
                setConfirmDiscard(false);
                setEditing(null);
              }}
            >
              Discard
            </Button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}

const PR_KIND_LABEL: Record<PrKind, string> = {
  e1rm: "Estimated 1RM",
  weight: "Heaviest weight",
  reps: "Rep PR",
};

/**
 * What the athlete sees on finishing.
 *
 * The records broken today, per the blueprint, one line per exercise per
 * kind (the best of the day, not every step up to it), except rep records,
 * one per load (sessionPrs in lib/strength/pr.ts). Measured against the
 * bests from before the session, so it agrees with the badges on the rows.
 * Queued videos still belong here too and are not built yet.
 */
function FinishedSummary({
  summary,
  prs,
  nameFor,
  unit,
  onDone,
}: {
  summary: SessionSummary;
  prs: readonly SessionPr[];
  nameFor: (id: string) => string | null;
  unit: UnitPreference;
  onDone: () => void;
}) {
  const kg = (value: number) => (unit === "kg" ? `${formatNumber(value)} kg` : `${loadNumber(value, unit)} ${unit}`);
  return (
    <div className="pt-8 flex flex-1 flex-col gap-5 pb-6">
      <h1 className="m-0 text-display font-semibold">Session done</h1>
      <dl className="m-0 grid grid-cols-2 gap-3">
        <Stat label="Sets" value={String(summary.setCount)} />
        <Stat label="Tonnage" value={kg(summary.tonnageKg)} />
        <Stat label="Exercises" value={String(summary.exerciseCount)} />
        <Stat label="Warm-ups" value={String(summary.warmupCount)} />
      </dl>
      {prs.length > 0 ? (
        <section aria-label="Personal records" className="flex flex-col gap-2">
          <h2 className="m-0 font-mono text-label uppercase text-muted-2">
            {prs.length === 1 ? "Personal record" : `${prs.length} personal records`}
          </h2>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {prs.map((pr) => (
              <li
                key={`${pr.exerciseId}:${pr.kind}:${pr.clientSetId}`}
                className="flex items-baseline justify-between gap-3 rounded-card border border-border bg-surface px-4 py-3"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="text-body font-semibold">{nameFor(pr.exerciseId) ?? pr.exerciseId}</span>
                  <span className="text-caption text-muted">
                    {PR_KIND_LABEL[pr.kind]} &middot; {kg(pr.loadKg)} &times; {pr.reps}
                    {pr.rpe !== null ? ` @ ${formatNumber(pr.rpe)}` : ""}
                  </span>
                </span>
                <span className="flex-none text-title font-semibold tabular-nums">
                  {pr.kind === "e1rm" && pr.e1rmKg !== null
                    ? kg(pr.e1rmKg)
                    : pr.kind === "reps"
                      ? `${pr.reps} reps`
                      : kg(pr.loadKg)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
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
