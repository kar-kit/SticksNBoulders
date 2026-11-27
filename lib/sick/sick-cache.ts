import { readLocal, writeLocal } from "@/lib/local-store";
import type { SickSpell } from "./sick";

/**
 * The athlete's own call-ins as of the last read or write, kept for the next
 * time there is no signal (F31).
 *
 * Offline is normal (docs/offline.md): Today must say "off sick until Sat"
 * from the phone, and My Program must not call a sick day missed because the
 * read that would have said otherwise never arrived. Like the program cache it
 * is localStorage and re-fetchable, so losing it costs a round trip, never
 * work -- the durable copy of a call-in is the queue, then the row.
 *
 * Scoped to the athlete, so a shared phone never shows someone else's.
 */

const KEY = "snb.my-sick";

interface Stored {
  userId: string;
  spells: readonly SickSpell[];
}

export function cacheSick(userId: string, spells: readonly SickSpell[]): void {
  writeLocal(KEY, { userId, spells } satisfies Stored);
}

/** The cached call-ins, or null when there is no cache for this athlete (unknown, not "none"). */
export function cachedSick(userId: string): SickSpell[] | null {
  const stored = readLocal<Partial<Stored>>(KEY);
  if (stored?.userId !== userId || !Array.isArray(stored.spells)) return null;
  return stored.spells.filter(
    (s): s is SickSpell =>
      Boolean(s) && typeof s.id === "string" && typeof s.startsOn === "string" && typeof s.endsOn === "string",
  );
}
