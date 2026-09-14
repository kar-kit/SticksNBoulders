import { AppwriteException, ID, Query } from "appwrite";
import { browserAppwrite } from "@/appwrite/browser-client";
import { browserWriteDeps } from "@/appwrite/documents/browser-writer";
import { createSet, deleteSet, type Actor } from "@/appwrite/documents";
import { ensureMyCircle } from "@/lib/auth/circle";
import type { UnnamedSet } from "./session-store";
import type { RpeValue } from "./set";

/**
 * Writing sets.
 *
 * Separate from session-store because this is the write an athlete makes forty
 * times a session and the one that has to feel instant. It stays deliberately
 * thin: no retry loop, no queue, no persistence. The write-ahead queue is Order
 * 9, and half of one built here would only have to be unpicked.
 */

export interface NewSet {
  sessionId: string;
  exerciseId: string;
  setIndex: number;
  loadKg: number;
  reps: number;
  rpe: RpeValue | null;
  isWarmup: boolean;
  /** Generated when the row appears, reused on every retry of that row. */
  clientSetId: string;
}

/** Appwrite's "already exists". For an idempotency key, that is success. */
const CONFLICT = 409;

/**
 * Logs a set, or recovers the one this row already wrote.
 *
 * The circle is ensured here and not only at session start. A session resumed
 * on a fresh page load never ran the start path, so the memoised promise is
 * cold and the first set of the day would come back 401 -- the same bug Order 7
 * found, in a window narrow enough to be much harder to spot.
 */
export async function logSet(actor: Actor, input: NewSet): Promise<UnnamedSet> {
  await ensureMyCircle();

  const loggedAt = new Date();
  try {
    await createSet(browserWriteDeps(() => ID.unique()), actor, {
      sessionId: input.sessionId,
      exerciseId: input.exerciseId,
      setIndex: input.setIndex,
      loadKg: input.loadKg,
      reps: input.reps,
      rpe: input.rpe,
      isWarmup: input.isWarmup,
      clientSetId: input.clientSetId,
      loggedAt,
      // e1RM is computed and stored at write time from Order 11. Until the
      // formula is verified, leaving it unset is honest; the rebuild script
      // backfills every set once it lands.
    });
  } catch (error) {
    // The first attempt may well have succeeded with the response lost on the
    // way back. client_set_id is unique-indexed precisely so the retry lands
    // here rather than writing the set twice.
    if (!(error instanceof AppwriteException) || error.code !== CONFLICT) throw error;
  }

  return {
    exerciseId: input.exerciseId,
    clientSetId: input.clientSetId,
    loadKg: input.loadKg,
    reps: input.reps,
    rpe: input.rpe,
    isWarmup: input.isWarmup,
    loggedAt,
  };
}

/** Removes a set. Used by Undo, for the tap that logged the wrong thing. */
export async function removeSet(actor: Actor, clientSetId: string): Promise<void> {
  const { tables, databaseId } = browserAppwrite();
  const rows = await tables.listRows({
    databaseId,
    tableId: "sets",
    queries: [Query.equal("client_set_id", clientSetId), Query.limit(1)],
  });
  const row = rows.rows[0];
  // Already gone is the outcome Undo wanted, so it is not an error.
  if (!row) return;
  await deleteSet(browserWriteDeps(() => ID.unique()), actor, row.$id);
}

/** One per active row, so a retry of that row cannot write a second set. */
export const newClientSetId = (): string => `st-${ID.unique()}`;
