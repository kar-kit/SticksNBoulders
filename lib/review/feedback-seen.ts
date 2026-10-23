import { readLocal, writeLocal } from "@/lib/local-store";

/**
 * When the athlete last looked at their feedback, kept on this device.
 *
 * Local rather than on a row, and the reason is the blueprint rather than
 * convenience: "no read receipts". Anything written to Appwrite for this
 * athlete is stamped for their circle, so a seen-at column would let the coach
 * see exactly when their feedback was read -- a read receipt with extra steps.
 * A row readable only by the athlete would avoid that at the price of a new
 * table and a write on every visit; the cost of staying local is that reading
 * feedback on a laptop does not clear the dot on the phone.
 *
 * Keyed by user, so two people sharing a browser do not clear each other's.
 */

const key = (userId: string) => `snb.feedback.seenAt.${userId}`;
const setsKey = (userId: string) => `snb.feedback.seenSets.${userId}`;

const valid = (value: unknown): value is string =>
  typeof value === "string" && !Number.isNaN(new Date(value).getTime());

export function readSeenAt(userId: string): string | null {
  if (!userId) return null;
  const value = readLocal<string>(key(userId));
  return valid(value) ? value : null;
}

export function writeSeenAt(userId: string, seenAt: string | null): void {
  if (!userId || seenAt === null) return;
  writeLocal(key(userId), seenAt);
  // A per-clip mark at or before the watermark says nothing the watermark
  // does not, so the map only ever holds clips read ahead of the Feedback
  // screen and stays small.
  const marks = readSetSeen(userId);
  const ms = new Date(seenAt).getTime();
  const kept = Object.fromEntries(Object.entries(marks).filter(([, at]) => new Date(at).getTime() > ms));
  if (Object.keys(kept).length !== Object.keys(marks).length) writeLocal(setsKey(userId), kept);
}

/**
 * Per clip: when the athlete last read that clip's thread somewhere other than
 * the Feedback screen -- the Clips gallery (F15). Same device-local store and
 * the same reason as the watermark above: no read receipts.
 *
 * Separate from the watermark because it is narrower. Reading one clip's
 * thread must not mark another clip's newer comments as seen, and moving the
 * one watermark forward would do exactly that.
 */
export type SetSeenMarks = Readonly<Record<string, string>>;

export function readSetSeen(userId: string): SetSeenMarks {
  if (!userId) return {};
  const value = readLocal<Record<string, unknown>>(setsKey(userId));
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const marks: Record<string, string> = {};
  for (const [setId, at] of Object.entries(value)) if (valid(at)) marks[setId] = at;
  return marks;
}

/** Records one clip's thread as read up to `seenAt`. Never moves a mark back. */
export function writeSetSeen(userId: string, setId: string, seenAt: string | null): void {
  if (!userId || !setId || !valid(seenAt)) return;
  const marks = { ...readSetSeen(userId) };
  const before = marks[setId];
  if (before && new Date(before).getTime() >= new Date(seenAt).getTime()) return;
  // Already covered by the watermark: nothing to add.
  const all = readSeenAt(userId);
  if (all && new Date(all).getTime() >= new Date(seenAt).getTime()) return;
  marks[setId] = seenAt;
  writeLocal(setsKey(userId), marks);
}
