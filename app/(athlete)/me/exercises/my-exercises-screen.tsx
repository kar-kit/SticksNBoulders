"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { TextField } from "@/components/ui/input";
import { useSession } from "@/lib/auth/session-context";
import { useExerciseLibrary } from "@/lib/exercises/library-context";
import { checkRename, EXERCISE_NAME_MAX, myExercises } from "@/lib/exercises/my-exercises";
import {
  checkExerciseDeletable,
  deleteMyExercise,
  renameMyExercise,
  setMyExerciseBodyweight,
  setMyExerciseKind,
} from "@/lib/exercises/my-exercises-store";
import { isBodyweight } from "@/lib/exercises/bodyweight";
import { isCardioExercise } from "@/lib/exercises/kind";
import { resolveOrCreateExercise } from "@/lib/exercises/library";
import type { Exercise } from "@/lib/exercises/match";
import { refusedRowDeletes } from "@/lib/logging/offline-view";
import { dismissFailed, subscribeToQueue } from "@/lib/offline/client";
import type { QueuedOp } from "@/lib/offline/queue";

/**
 * My exercises: the lifts this athlete added by typing a name the library did
 * not have. Until now they lived only in the typeahead, so a typo made
 * mid-session ("Romainian DL") was there for good.
 *
 * Rename fixes the name everywhere at once, because sets point at the id.
 * Delete is for a lift nothing points at -- a duplicate created by mistake --
 * and is refused, with the reason, for one that has been logged, programmed or
 * given a max. The shared library is not listed: nobody can edit it from the
 * app (exercisePermissions).
 *
 * Bodyweight (F20) is set here too: a lift typed mid-session ("Ring Dip")
 * starts unflagged, like every new row, so the Log refuses 0 kg on it until
 * the athlete says it is done with the body as the load. One checkbox in the
 * same form as the name, saved by the same Save, because it is the same kind
 * of correction -- the athlete telling the library what this lift is. The
 * library's own bodyweight rows are flagged by the seed script.
 *
 * Cardio (F23) sits beside it, the same way: a checkbox in the same form,
 * saved by the same Save, queued as its own op. A cardio exercise is logged
 * as a time and a level; sets already logged keep what they were, because
 * each set says for itself whether it is cardio. While it is ticked the
 * bodyweight box steps aside -- a cardio row asks for no load at all.
 * New cardio exercise, above the list, makes one from scratch for the
 * machine the library lacks (a ski erg, an assault bike) without a trip
 * through the Log.
 */
export function MyExercisesScreen() {
  const router = useRouter();
  const { state: sessionState } = useSession();
  const { state: library, rename, flagBodyweight, setKind, remember, forget, reload } = useExerciseLibrary();

  const [ops, setOps] = useState<QueuedOp[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [bodyweightDraft, setBodyweightDraft] = useState(false);
  const [cardioDraft, setCardioDraft] = useState(false);
  /** New cardio exercise (F23): the name as typed, and why it was refused. */
  const [newCardio, setNewCardio] = useState("");
  const [newCardioError, setNewCardioError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribeToQueue(setOps), []);

  const userId = sessionState.status === "signed-in" ? sessionState.user.id : null;
  const mine = useMemo(() => (userId ? myExercises(library.exercises, userId) : []), [library.exercises, userId]);
  const refused = useMemo(() => refusedRowDeletes(ops, "exercise"), [ops]);

  if (!userId) return null;

  const open = (exercise: Exercise) => {
    setEditingId(exercise.id);
    setDraft(exercise.name);
    setBodyweightDraft(isBodyweight(exercise));
    setCardioDraft(isCardioExercise(exercise));
    setError(null);
  };
  const close = () => {
    setEditingId(null);
    setError(null);
  };

  const save = async (exercise: Exercise) => {
    const check = checkRename(exercise, draft, library.exercises);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    close();
    const flagChanged = bodyweightDraft !== isBodyweight(exercise);
    const kindChanged = cardioDraft !== isCardioExercise(exercise);
    const kind = cardioDraft ? "cardio" : "strength";
    if (check.unchanged && !flagChanged && !kindChanged) return;
    // Applied locally first, like the rename: the Log takes (or refuses) 0 kg
    // on this lift from the next tap, signal or not.
    if (!check.unchanged) rename(exercise.id, check.name);
    if (flagChanged) flagBodyweight(exercise.id, bodyweightDraft);
    if (kindChanged) setKind(exercise.id, kind);
    // Two queued writes, each put back on its own if the phone cannot store
    // it: a rename that was queued stays renamed.
    let lost = false;
    if (!check.unchanged) {
      try {
        await renameMyExercise(exercise.id, check.name);
      } catch {
        rename(exercise.id, exercise.name);
        lost = true;
      }
    }
    if (flagChanged) {
      try {
        await setMyExerciseBodyweight(exercise.id, bodyweightDraft);
      } catch {
        flagBodyweight(exercise.id, isBodyweight(exercise));
        lost = true;
      }
    }
    if (kindChanged) {
      try {
        await setMyExerciseKind(exercise.id, kind);
      } catch {
        setKind(exercise.id, isCardioExercise(exercise) ? "cardio" : "strength");
        lost = true;
      }
    }
    if (lost) {
      setEditingId(exercise.id);
      setError("That change wasn't saved — this phone couldn't store it. Try again.");
    }
  };

  /**
   * New cardio exercise (F23). The same create the Log's typeahead makes,
   * queued, with the kind in it. A name the library already has is refused
   * with where it is, rather than quietly reused: the athlete asked for a
   * new one, and an existing lift turning up here as cardio would be a
   * surprise.
   */
  const addCardio = async () => {
    const check = checkRename({ id: "", name: "", normalisedName: "", isGlobal: false }, newCardio, library.exercises);
    if (!check.ok) {
      setNewCardioError(check.message);
      return;
    }
    try {
      const { exercise, created } = await resolveOrCreateExercise(check.name, library.exercises, { userId }, "cardio");
      if (!created) {
        setNewCardioError(`${exercise.name} is already there.`);
        return;
      }
      remember(exercise);
      setNewCardio("");
      setNewCardioError(null);
    } catch {
      setNewCardioError("That exercise wasn't added — this phone couldn't store it. Try again.");
    }
  };

  const remove = async (exercise: Exercise) => {
    setBusy(true);
    setError(null);
    const check = await checkExerciseDeletable(userId, exercise, ops);
    if (!check.ok) {
      setBusy(false);
      setError(check.message);
      return;
    }
    try {
      await deleteMyExercise(exercise.id);
      forget(exercise.id);
      close();
    } catch {
      setError("That exercise wasn't deleted — this phone couldn't store the change. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pt-8 flex flex-1 flex-col gap-5 pb-6">
      <header className="flex flex-col items-start gap-1">
        <Button variant="ghost" size="sm" onClick={() => router.push("/me")} aria-label="Back to Me">
          ← Me
        </Button>
        <h1 className="m-0 text-display font-semibold">My exercises</h1>
        <p className="m-0 text-body text-muted">Lifts you added yourself. Renaming one renames every set of it.</p>
      </header>

      {refused.size > 0 ? (
        <div className="flex items-center justify-between gap-3 rounded-card border border-border bg-surface p-3">
          <p role="status" className="m-0 text-caption text-muted">
            {refused.size === 1 ? "An exercise you deleted was" : `${refused.size} exercises you deleted were`} kept:
            something had been logged against it.
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void dismissFailed([...refused.values()]);
              void reload();
            }}
          >
            OK
          </Button>
        </div>
      ) : null}

      <form
        aria-label="New cardio exercise"
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void addCardio();
        }}
      >
        <div className="flex items-start gap-2">
          <TextField
            value={newCardio}
            onChange={(event) => {
              setNewCardio(event.target.value);
              setNewCardioError(null);
            }}
            aria-label="New cardio exercise"
            placeholder="New cardio exercise, e.g. Ski Erg"
            maxLength={EXERCISE_NAME_MAX}
            autoComplete="off"
            enterKeyHint="done"
            invalid={Boolean(newCardioError)}
          />
          <Button type="submit" variant="secondary" disabled={!newCardio.trim()}>
            Add
          </Button>
        </div>
        {newCardioError ? (
          <p role="alert" className="m-0 text-caption text-foreground">
            {newCardioError}
          </p>
        ) : (
          <p className="m-0 text-caption text-muted">Logged as a time and a level, not weight and reps.</p>
        )}
      </form>

      {library.status === "loading" && mine.length === 0 ? null : mine.length === 0 ? (
        <EmptyState
          title="No exercises of your own yet"
          body="Type a lift the library doesn't have while logging, or add a cardio machine above, and it lands here so you can rename or remove it."
        />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0" aria-label="My exercises">
          {mine.map((exercise) =>
            editingId === exercise.id ? (
              <li key={exercise.id}>
                <form
                  className="flex flex-col gap-3 rounded-card border border-border bg-surface p-3"
                  aria-label={`Edit ${exercise.name}`}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void save(exercise);
                  }}
                >
                  <TextField
                    value={draft}
                    onChange={(event) => {
                      setDraft(event.target.value);
                      setError(null);
                    }}
                    aria-label="Exercise name"
                    maxLength={EXERCISE_NAME_MAX}
                    autoComplete="off"
                    enterKeyHint="done"
                    invalid={Boolean(error)}
                    autoFocus
                  />
                  <label className="flex min-h-12 items-start gap-3 text-body">
                    <input
                      type="checkbox"
                      checked={cardioDraft}
                      onChange={(event) => setCardioDraft(event.target.checked)}
                      aria-describedby={`cardio-hint-${exercise.id}`}
                      className="mt-0.5 size-6 flex-none accent-accent-fill focus:outline-2 focus:outline-accent-line"
                    />
                    <span className="flex flex-col gap-0.5">
                      Cardio exercise
                      <span id={`cardio-hint-${exercise.id}`} className="text-caption text-muted">
                        Logs a time and a level instead of weight and reps. Sets already logged stay as they are.
                      </span>
                    </span>
                  </label>
                  {cardioDraft ? null : (
                    <label className="flex min-h-12 items-start gap-3 text-body">
                      <input
                        type="checkbox"
                        checked={bodyweightDraft}
                        onChange={(event) => setBodyweightDraft(event.target.checked)}
                        aria-describedby={`bodyweight-hint-${exercise.id}`}
                        className="mt-0.5 size-6 flex-none accent-accent-fill focus:outline-2 focus:outline-accent-line"
                      />
                      <span className="flex flex-col gap-0.5">
                        Bodyweight exercise
                        <span id={`bodyweight-hint-${exercise.id}`} className="text-caption text-muted">
                          Lets you log it at 0 kg. Added weight still logs as usual.
                        </span>
                      </span>
                    </label>
                  )}
                  {error ? (
                    <p role="alert" className="m-0 text-caption text-foreground">
                      {error}
                    </p>
                  ) : null}
                  <div className="flex gap-2">
                    <Button type="button" variant="danger" onClick={() => void remove(exercise)} disabled={busy}>
                      Delete
                    </Button>
                    <Button type="button" block variant="secondary" onClick={close} disabled={busy}>
                      Cancel
                    </Button>
                    <Button type="submit" block disabled={busy}>
                      Save
                    </Button>
                  </div>
                </form>
              </li>
            ) : (
              <li key={exercise.id}>
                <button
                  type="button"
                  onClick={() => open(exercise)}
                  aria-label={`Edit ${exercise.name}${isCardioExercise(exercise) ? ", cardio" : isBodyweight(exercise) ? ", bodyweight" : ""}`}
                  className="flex min-h-12 w-full items-center justify-between rounded-control border border-border px-3 py-2.5 text-left"
                >
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate text-body">{exercise.name}</span>
                    {isCardioExercise(exercise) ? (
                      <span className="flex-none font-mono text-label text-muted-2">CARDIO</span>
                    ) : isBodyweight(exercise) ? (
                      <span className="flex-none font-mono text-label text-muted-2">BODYWEIGHT</span>
                    ) : null}
                  </span>
                  <span aria-hidden className="text-ui text-muted">
                    Edit ›
                  </span>
                </button>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}
