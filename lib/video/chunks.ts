/**
 * Chunk arithmetic for a resumable upload.
 *
 * Pure, and separate from the transport because every interesting failure here
 * is an off-by-one at a boundary: the last chunk of a file that divides exactly,
 * a resume point past the end, a zero-byte file. Those are cheap to test and
 * expensive to debug over gym wifi on somebody else's phone.
 */

/**
 * Appwrite's chunk size, and not ours to choose -- the server validates the
 * `content-range` against it. Matches `Client.CHUNK_SIZE` in the SDK.
 */
export const CHUNK_BYTES = 5 * 1024 * 1024;

export interface ChunkRange {
  index: number;
  /** Inclusive first byte. */
  start: number;
  /** Inclusive last byte, as the content-range header wants it. */
  end: number;
}

/**
 * Every chunk of a file, in order.
 *
 * Order matters and is the whole reason this is sequential. Appwrite reports
 * progress as `chunksUploaded`, a COUNT rather than a map of which ranges
 * landed -- verified against the instance. Uploading in order makes that count
 * mean "chunks 0 to n-1 are in", which is a resume point. Uploading in
 * parallel, as the SDK does at concurrency 8, makes the same number mean
 * "some four of these landed", which is not.
 *
 * The server does accept out-of-order ranges, so parallel upload would work --
 * it just would not be resumable, and on gym wifi resumable is worth more than
 * fast.
 */
export function chunkRanges(sizeBytes: number, chunkBytes: number = CHUNK_BYTES): ChunkRange[] {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return [];
  const ranges: ChunkRange[] = [];
  for (let start = 0, index = 0; start < sizeBytes; start += chunkBytes, index += 1) {
    ranges.push({ index, start, end: Math.min(start + chunkBytes, sizeBytes) - 1 });
  }
  return ranges;
}

/** What `content-range` this chunk needs. Appwrite rejects a wrong one. */
export const contentRange = (range: ChunkRange, sizeBytes: number): string =>
  `bytes ${range.start}-${range.end}/${sizeBytes}`;

/**
 * The chunks still to send, given what the server says it already has.
 *
 * `uploadedCount` comes from `getFile(fileId).chunksUploaded`, or zero when the
 * upload has not started. Re-sending a chunk the server already holds is
 * harmless -- verified idempotent, the count does not double-count -- so when
 * in doubt this errs toward sending again. A lost response on the last chunk
 * would otherwise strand an upload one chunk from done.
 */
export function remainingChunks(
  ranges: readonly ChunkRange[],
  uploadedCount: number,
): ChunkRange[] {
  if (!Number.isFinite(uploadedCount) || uploadedCount <= 0) return [...ranges];
  return ranges.slice(Math.min(uploadedCount, ranges.length));
}

/** 0-100, for the progress line. Counts a chunk only once it has landed. */
export function percentDone(uploadedCount: number, totalChunks: number): number {
  if (totalChunks <= 0) return 0;
  const clamped = Math.max(0, Math.min(uploadedCount, totalChunks));
  return Math.round((clamped / totalChunks) * 100);
}

/** True when the server holds every chunk. */
export const isComplete = (uploadedCount: number, totalChunks: number): boolean =>
  totalChunks > 0 && uploadedCount >= totalChunks;
