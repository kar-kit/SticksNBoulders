"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { fetchExerciseLibrary } from "./library";
import { cacheLibrary, cachedLibrary } from "./library-cache";
import type { Exercise } from "./match";

/**
 * The exercise library, fetched once per app load.
 *
 * Same shape as SessionProvider, and deliberately not TanStack Query yet.
 *
 * The list is cached on the device, because the alternative is an athlete
 * reopening the app in a basement and finding an empty typeahead. A stale
 * exercise name is harmless -- names are the only thing on these rows -- so the
 * cache is shown while a fresh copy is fetched, and replaced when it arrives.
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
    const exercises = await load(userId);
    cacheLibrary(userId, exercises);
    return { status: "ready", exercises };
  } catch {
    // A library that fails to load must not block logging. Whatever the last
    // visit saw is shown instead -- to the athlete that is simply the library,
    // which is the point. Only with nothing cached does the typeahead fall back
    // to accepting a typed name it cannot match.
    const cached = cachedLibrary(userId);
    if (cached && cached.length > 0) return { status: "ready", exercises: cached };
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
    // The awaits sit inside the effect so the setStates are visibly
    // asynchronous, and so a provider unmounted mid-flight does not set state
    // afterwards. The cache is read behind one too: reading it during render
    // would disagree with the server's empty first paint and break hydration.
    void (async () => {
      const cached = await Promise.resolve(userId ? cachedLibrary(userId) : null);
      // Shown before the fetch resolves, so the list is there on the frame
      // after a cold start rather than a second later. On a phone with no
      // signal, that second never ends.
      if (cached && cached.length > 0 && !cancelled) {
        setState({ status: "ready", exercises: cached });
      }
      const next = await resolveLibrary(userId, load, cached ?? []);
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
        setState((prev) => {
          if (prev.exercises.some((e) => e.id === exercise.id)) return prev;
          const exercises = [...prev.exercises, exercise];
          // Cached as well as held, so a lift typed with no signal is still in
          // the typeahead after a reload -- and its queued sets still show a
          // name rather than an id.
          if (userId) cacheLibrary(userId, exercises);
          return { ...prev, exercises };
        }),
      reload,
    }),
    [state, reload, userId],
  );

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useExerciseLibrary() {
  const context = useContext(LibraryContext);
  if (!context) throw new Error("useExerciseLibrary must be used inside an ExerciseLibraryProvider");
  return context;
}
