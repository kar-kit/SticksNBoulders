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

export function readSeenAt(userId: string): string | null {
  if (!userId) return null;
  const value = readLocal<string>(key(userId));
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime()) ? value : null;
}

export function writeSeenAt(userId: string, seenAt: string | null): void {
  if (!userId || seenAt === null) return;
  writeLocal(key(userId), seenAt);
}
