import { readLocal, writeLocal } from "@/lib/local-store";

/**
 * Which exercises of a session have already had the coach's video popup
 * (F18). It shows once per exercise per session, whatever the athlete
 * answered: "Later" means later, and the set row's camera badge stays as the
 * reminder. Kept on the phone so a reload mid-session does not ask again.
 *
 * One key, holding only the running session: a new session replaces it, so
 * nothing piles up in storage. Nothing here is worth failing a set over, so a
 * storage that cannot be read reads as "not asked yet" (lib/local-store.ts).
 */

const KEY = "snb:video-nudged";

interface Stored {
  sessionId: string;
  blocks: string[];
}

function read(sessionId: string): string[] {
  const stored = readLocal<Stored>(KEY);
  return stored && stored.sessionId === sessionId && Array.isArray(stored.blocks) ? stored.blocks : [];
}

/** Whether this session's exercise (its block id) has had the popup. */
export function wasNudged(sessionId: string, blockId: string): boolean {
  return read(sessionId).includes(blockId);
}

/** Records that it has. Idempotent. */
export function rememberNudged(sessionId: string, blockId: string): void {
  const blocks = read(sessionId);
  if (blocks.includes(blockId)) return;
  writeLocal(KEY, { sessionId, blocks: [...blocks, blockId] } satisfies Stored);
}
