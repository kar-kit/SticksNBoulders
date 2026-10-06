import { readLocal, removeLocal, writeLocal } from "@/lib/local-store";
import type { EstimatedInput, ReferenceMaxEntry } from "@/lib/strength/reference-max";
import type { ProgramTree } from "./program";

/**
 * The last program the athlete loaded, kept for the next time there is no signal.
 *
 * Offline is normal in a gym (docs/offline.md): a program screen that shows a
 * spinner or an error toast in a basement is the app being less useful than the
 * spreadsheet it replaced. Like the exercise library this is localStorage, not
 * the queue -- it is re-fetchable, so losing it costs a round trip, never work.
 *
 * Only what `fetchMyProgram` returned is ever written, and that is already
 * filtered to published weeks. A draft cannot be in here.
 */

const KEY = "snb.my-program";

export interface CachedMaxes {
  entries: ReferenceMaxEntry[];
  estimated: Array<[string, EstimatedInput]>;
}

interface Stored {
  userId: string;
  program: ProgramTree;
  maxes: CachedMaxes;
}

export function cacheProgram(userId: string, program: ProgramTree, maxes: CachedMaxes): void {
  writeLocal(KEY, { userId, program, maxes } satisfies Stored);
}

export function forgetProgram(): void {
  removeLocal(KEY);
}

/** Scoped to the athlete, so a shared phone never shows someone else's block. */
export function cachedProgram(userId: string): { program: ProgramTree; maxes: CachedMaxes } | null {
  const stored = readLocal<Partial<Stored>>(KEY);
  if (stored?.userId !== userId || !stored.program || !Array.isArray(stored.program.blocks)) return null;
  const maxes = stored.maxes;
  return {
    program: stored.program,
    maxes: {
      entries: Array.isArray(maxes?.entries) ? maxes.entries : [],
      estimated: Array.isArray(maxes?.estimated) ? maxes.estimated : [],
    },
  };
}
