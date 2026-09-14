"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { fetchExerciseLibrary } from "./library";
import type { Exercise } from "./match";

/**
 * The exercise library, fetched once per app load.
 *
 * Same shape as SessionProvider, and deliberately not TanStack Query yet: the
 * cache this list actually needs is a persistent one, and that arrives with
 * IndexedDB at Order 9. An in-memory cache that empties on reload is the wrong
 * property for a PWA an athlete reopens between sets, and wiring one now would
 * be re-wired three tickets later.
 */

export type LibraryState =
  | { status: "loading"; exercises: Exercise[] }
  | { status: "ready"; exercises: Exercise[] }
  | { status: "failed"; exercises: Exercise[] };

interface LibraryValue {
  state: LibraryState;
  /** Adds a just-created exercise locally, so the list never lags the typing. */
  remember: (exercise: Exercise) => void;
  reload: () => Promise<void>;
}

const LibraryContext = createContext<LibraryValue | null>(null);

/**
 * Resolves the library. No React in here, so it is testable on its own -- the
 * same split SessionProvider uses.
 */
async function resolveLibrary(
  userId: string | null,
  load: (userId: string) => Promise<Exercise[]>,
  previous: Exercise[],
): Promise<LibraryState> {
  if (!userId) return { status: "ready", exercises: [] };
  try {
    return { status: "ready", exercises: await load(userId) };
  } catch {
    // A library that fails to load must not block logging. The athlete can
    // still type a name; it simply is not matched against the library.
    return { status: "failed", exercises: previous };
  }
}

export function ExerciseLibraryProvider({
  userId,
  children,
  /** Injected by tests and by the design page, which has no Appwrite session. */
  load = fetchExerciseLibrary,
}: {
  userId: string | null;
  children: React.ReactNode;
  load?: (userId: string) => Promise<Exercise[]>;
}) {
  const [state, setState] = useState<LibraryState>({ status: "loading", exercises: [] });

  const reload = useCallback(async () => {
    setState(await resolveLibrary(userId, load, []));
  }, [userId, load]);

  useEffect(() => {
    let cancelled = false;
    // The await sits inside the effect so the setState is visibly asynchronous,
    // and so a provider unmounted mid-flight does not set state afterwards.
    void (async () => {
      const next = await resolveLibrary(userId, load, []);
      if (!cancelled) setState(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, load]);

  const value = useMemo<LibraryValue>(
    () => ({
      state,
      remember: (exercise) =>
        setState((prev) =>
          prev.exercises.some((e) => e.id === exercise.id)
            ? prev
            : { ...prev, exercises: [...prev.exercises, exercise] },
        ),
      reload,
    }),
    [state, reload],
  );

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useExerciseLibrary() {
  const context = useContext(LibraryContext);
  if (!context) throw new Error("useExerciseLibrary must be used inside an ExerciseLibraryProvider");
  return context;
}
