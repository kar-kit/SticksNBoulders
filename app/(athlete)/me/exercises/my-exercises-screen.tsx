"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { TextField } from "@/components/ui/input";
import { useSession } from "@/lib/auth/session-context";
import { useExerciseLibrary } from "@/lib/exercises/library-context";
import { checkRename, EXERCISE_NAME_MAX, myExercises } from "@/lib/exercises/my-exercises";
import { checkExerciseDeletable, deleteMyExercise, renameMyExercise } from "@/lib/exercises/my-exercises-store";
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
 */
export function MyExercisesScreen() {
  const router = useRouter();
  const { state: sessionState } = useSession();
  const { state: library, rename, forget, reload } = useExerciseLibrary();

  const [ops, setOps] = useState<QueuedOp[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
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
    if (check.unchanged) return;
    rename(exercise.id, check.name);
    try {
      await renameMyExercise(exercise.id, check.name);
    } catch {
      rename(exercise.id, exercise.name);
      setEditingId(exercise.id);
      setError("That rename wasn't saved — this phone couldn't store it. Try again.");
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

      {library.status === "loading" && mine.length === 0 ? null : mine.length === 0 ? (
        <EmptyState
          title="No exercises of your own yet"
          body="Type a lift the library doesn't have while logging, and it lands here so you can rename or remove it."
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
                  aria-label={`Edit ${exercise.name}`}
                  className="flex min-h-12 w-full items-center justify-between rounded-control border border-border px-3 py-2.5 text-left"
                >
                  <span className="truncate text-body">{exercise.name}</span>
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
