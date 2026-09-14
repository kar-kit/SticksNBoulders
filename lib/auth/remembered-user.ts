import type { CoachStatus } from "./role";
import type { SessionUser } from "./session-context";

/**
 * Who was signed in last time, for the page loads that cannot ask.
 *
 * Appwrite answers "who is this" over the network, so a cold start in a gym
 * basement gets no answer and the app would send the athlete to sign in --
 * where they would also fail, because authentication is the one thing that
 * genuinely cannot work offline. They would be locked out of a session they
 * are standing in the middle of, with a queue full of sets they cannot see.
 *
 * So a failed lookup that looks like no signal falls back to this. A lookup
 * that actually reaches Appwrite and is told no still signs them out, because
 * that is a real answer: this is a fallback for silence, not a way around a
 * refusal. Nothing here grants access to anything -- every read and write still
 * carries the Appwrite session, and without a valid one they all fail.
 */

const KEY = "snb.last-user";

interface Stored {
  user: SessionUser;
  coach: CoachStatus;
}

function safely<T>(run: () => T, fallback: T): T {
  try {
    return run();
  } catch {
    return fallback;
  }
}

export function rememberUser(user: SessionUser, coach: CoachStatus): void {
  safely(() => localStorage.setItem(KEY, JSON.stringify({ user, coach } satisfies Stored)), undefined);
}

export function forgetUser(): void {
  safely(() => localStorage.removeItem(KEY), undefined);
}

export function recallUser(): Stored | null {
  return safely(() => {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Partial<Stored>;
    if (!stored.user?.id || !stored.coach) return null;
    return { user: stored.user, coach: stored.coach };
  }, null);
}
