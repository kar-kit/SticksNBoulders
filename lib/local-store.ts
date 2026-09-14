/**
 * Reading and writing localStorage without letting it break anything.
 *
 * Every accessor can throw -- a private window, storage blocked by policy, a
 * quota already full -- and none of those are worth failing a workout over. So
 * a read that cannot happen returns null and a write that cannot happen is
 * simply not stored.
 *
 * Nothing durable lives here. What is kept is what makes a cold start with no
 * signal usable: who was signed in, the exercise library, the running session,
 * the rest timer. All of it is re-derivable from Appwrite. Anything that is not
 * -- a logged set -- goes to the offline queue and its real database.
 */

export function readLocal<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

export function writeLocal(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Nothing to do and nothing to say. The feature this backs degrades to
    // "works until you reload", which is the correct outcome, not an error.
  }
}

export function removeLocal(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // As above.
  }
}
