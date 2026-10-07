import { MAX_FILES } from "@/lib/video/clip-limits";

/**
 * Playback URLs for a queue longer than one request allows.
 *
 * `POST /api/clip` rejects more than MAX_FILES ids with a 400 for the whole
 * request, so a coach with 61 unreviewed clips used to get no playback at all.
 * About 112 clips a week for five athletes puts a normal Sunday over the line.
 *
 * Batches go out together and are reported as each one lands, in queue order.
 * The first batch is the clips the coach plays first, and it must not wait on
 * the last. One batch failing says which clips it covered and leaves the rest
 * alone.
 */

export type BatchOutcome =
  | { ok: true; ids: readonly string[]; urls: Map<string, string> }
  | { ok: false; ids: readonly string[]; error: unknown };

/** Unique, non-empty ids in first-seen order, in slices of at most `size`. */
export function chunkFileIds(fileIds: readonly string[], size: number = MAX_FILES): string[][] {
  const unique = [...new Set(fileIds.filter(Boolean))];
  const batches: string[][] = [];
  for (let i = 0; i < unique.length; i += size) batches.push(unique.slice(i, i + size));
  return batches;
}

/**
 * Fetches every batch and calls `onBatch` once per batch, as it settles.
 * Resolves when all have. Never rejects: a failure is an outcome, not a throw.
 */
export async function loadClipUrlBatches(
  fileIds: readonly string[],
  fetchBatch: (ids: readonly string[]) => Promise<Map<string, string>>,
  onBatch: (outcome: BatchOutcome) => void,
): Promise<void> {
  await Promise.all(
    chunkFileIds(fileIds).map(async (ids) => {
      let outcome: BatchOutcome;
      try {
        outcome = { ok: true, ids, urls: await fetchBatch(ids) };
      } catch (error) {
        outcome = { ok: false, ids, error };
      }
      onBatch(outcome);
    }),
  );
}
