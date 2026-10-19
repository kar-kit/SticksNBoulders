import { normaliseSessionName } from "@/appwrite/documents/write";
import { sessionDateLabel, summariseSession, type SessionRecord, type SessionSet } from "./session";

/**
 * Rules for editing and deleting a whole session from History.
 *
 * Pure. The queue writes are in session-edit-store.ts.
 */

/**
 * What a session is called on screen.
 *
 * The athlete's own name first. Then, for a session started from the
 * program, the coach's label for that day -- "Heavy squat" says more than a
 * date, and it is the name the athlete saw on Today when they started it.
 * Then the date, which is what History showed before names existed.
 *
 * `named` says whether the title is something other than the date, so the
 * screen knows to show the date underneath it.
 */
export function sessionTitle(
  session: Pick<SessionRecord, "name" | "programDayId" | "startedAt">,
  dayLabel: string | null = null,
): { title: string; named: boolean } {
  const own = normaliseSessionName(session.name);
  if (own) return { title: own, named: true };
  const label = session.programDayId ? normaliseSessionName(dayLabel) : null;
  if (label) return { title: label, named: true };
  return { title: sessionDateLabel(session.startedAt), named: false };
}

/**
 * The totals to store on the session after its sets changed in History.
 *
 * The same summary the finish screen writes, from the same function, so a
 * session corrected afterwards reads exactly as it would have if it had been
 * logged right the first time. Warm-ups excluded, as there.
 */
export function totalsOf(sets: readonly Omit<SessionSet, "exerciseName">[]): {
  setCount: number;
  tonnageKg: number;
} {
  const { setCount, tonnageKg } = summariseSession(sets.map((set) => ({ ...set, exerciseName: "" })));
  return { setCount, tonnageKg };
}

/** Whether the stored totals already say what the sets say, so no write is owed. */
export const totalsMatch = (
  session: Pick<SessionRecord, "setCount" | "tonnageKg">,
  totals: { setCount: number; tonnageKg: number },
): boolean => session.setCount === totals.setCount && session.tonnageKg === totals.tonnageKg;

/**
 * Why a session cannot be deleted, or null when it can.
 *
 * A coach comment on any of its sets stops it. The athlete cannot delete the
 * coach's comments (the row grants delete to its author alone), and a thread
 * whose set and session have both gone is a correction about nothing -- the
 * same reasoning deleteSet already applies to one set, applied to all of them.
 *
 * The athlete's own replies do not count, and neither does a review mark on
 * its own: "cleared" is the coach's bookkeeping about the clip, carries no
 * words, and a cleared clip whose set has gone simply drops out of the queue
 * maths (sets-with-video minus reviews) without trace.
 */
export function deleteBlockedBy(
  comments: readonly { authorId: string }[],
  athleteId: string,
): string | null {
  if (comments.some((comment) => comment.authorId !== athleteId)) {
    return "Your coach has commented on this session, so it stays. You can still correct any set in it.";
  }
  return null;
}
