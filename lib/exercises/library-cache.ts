import type { Exercise } from "./match";

/**
 * The library, kept on the device between visits.
 *
 * Without this, a cold start with no signal has no exercise list, and "type,
 * never hunt" becomes "type into an empty box". An athlete cannot name the lift
 * they are standing under, and the offline queue has nothing to queue.
 *
 * localStorage rather than IndexedDB, unlike the queue. The distinction is
 * whether losing it loses anything: the library is re-fetchable from Appwrite
 * in one request, so it is a convenience cache. A logged set is not, which is
 * why that one gets a real database and this gets a string.
 */

const KEY = "snb.library";

interface Stored {
  userId: string;
  exercises: readonly Exercise[];
}

function safely<T>(run: () => T, fallback: T): T {
  try {
    return run();
  } catch {
    return fallback;
  }
}

export function cacheLibrary(userId: string, exercises: readonly Exercise[]): void {
  safely(
    () => localStorage.setItem(KEY, JSON.stringify({ userId, exercises } satisfies Stored)),
    undefined,
  );
}

/** Scoped to the athlete, so a shared phone never shows someone else's lifts. */
export function cachedLibrary(userId: string): Exercise[] | null {
  return safely(() => {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Partial<Stored>;
    if (stored.userId !== userId || !Array.isArray(stored.exercises)) return null;
    return stored.exercises.filter(
      (e): e is Exercise => typeof e?.id === "string" && typeof e?.name === "string",
    );
  }, null);
}
