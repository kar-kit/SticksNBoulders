import { readLocal, removeLocal, writeLocal } from "@/lib/local-store";
import { CHOSE_COACH_PREF_KEY, MODE_PREF_KEY, readModePrefs, type ModePrefs } from "./mode";
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
 *
 * The landing mode rides along, so a cold start with no signal still opens on
 * the side they last used. Signing out forgets this copy and nothing else: the
 * mode itself lives on the Appwrite account, so signing back in restores it.
 */

const KEY = "snb.last-user";

interface Stored {
  user: SessionUser;
  coach: CoachStatus;
  prefs: ModePrefs;
}

export function rememberUser(user: SessionUser, coach: CoachStatus, prefs: ModePrefs): void {
  writeLocal(KEY, { user, coach, prefs } satisfies Stored);
}

export function forgetUser(): void {
  removeLocal(KEY);
}

export function recallUser(): Stored | null {
  const stored = readLocal<Partial<Stored>>(KEY);
  if (!stored?.user?.id || !stored.coach) return null;
  // Parsed rather than trusted: a record written before modes existed has no
  // prefs at all, and that has to read as "never chosen", not crash the root.
  return { user: stored.user, coach: stored.coach, prefs: readModePrefs(toPrefs(stored.prefs)) };
}

/** Back to the wire shape, so the one parser in mode.ts reads it. */
function toPrefs(prefs: unknown): Record<string, unknown> | null {
  if (typeof prefs !== "object" || prefs === null) return null;
  const { mode, choseCoach } = prefs as Partial<ModePrefs>;
  return { [MODE_PREF_KEY]: mode, [CHOSE_COACH_PREF_KEY]: choseCoach };
}
