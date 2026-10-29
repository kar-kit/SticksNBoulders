import type { ClearedOrphan } from "../backup/orphans";
import type { PrunableOriginal } from "../backup/prune";
import { PROXY_BUCKET, proxyIdFor } from "./proxy";

/**
 * Server-side storage deletes, all of them: a file nothing points at (a clip,
 * or since v13 a profile picture whose best-effort delete failed), and since
 * v22 the two the proxy worker makes.
 *
 * They live in the write helper for the same reason every row write does: one
 * place to review. (The browser deletes one thing itself: the owner's previous
 * profile picture, with the delete their own stamp grants --
 * lib/profile/avatar-store.ts.) Each takes a value only a check can make, or
 * refuses before calling storage:
 *
 *   - `deleteOrphanClip` takes a `ClearedOrphan`, which only
 *     `clearForDeletion` (appwrite/backup/orphans.ts) makes, after checking
 *     that a fresh backup holds the file byte for byte.
 *   - `deletePrunedOriginal` takes a `PrunableOriginal`, which only
 *     `clearForPrune` (appwrite/backup/prune.ts) makes, after checking that
 *     the set plays a verified proxy at least seven days old.
 *   - `deleteWorkerProxy` takes a clip id and the proxy id derived from it,
 *     and deletes only in the proxy bucket, where nothing but the worker
 *     writes.
 *
 * A narrow interface rather than the SDK's Storage, like circle-admin.ts, so
 * the barrel stays importable from client code without pulling node-appwrite
 * into the browser bundle.
 */

export interface ClipStore {
  deleteFile(params: { bucketId: string; fileId: string }): Promise<unknown>;
}

export async function deleteOrphanClip(store: ClipStore, orphan: ClearedOrphan): Promise<void> {
  await store.deleteFile({ bucketId: orphan.bucketId, fileId: orphan.$id });
}

/** The original of a clip whose proxy now plays in its place (`clips:proxies -- --prune --yes`). */
export async function deletePrunedOriginal(store: ClipStore, original: PrunableOriginal): Promise<void> {
  await store.deleteFile({ bucketId: original.bucketId, fileId: original.$id });
}

/**
 * A proxy the worker will not stand behind: one that failed verification, or
 * an upload that died part-way. Only ever the proxy of the named clip, only
 * ever in the proxy bucket.
 */
export async function deleteWorkerProxy(store: ClipStore, input: { clipFileId: string; proxyId: string }): Promise<void> {
  if (!input.proxyId || input.proxyId !== proxyIdFor(input.clipFileId)) {
    throw new Error(`deleteWorkerProxy: ${input.proxyId} is not the proxy of clip ${input.clipFileId}`);
  }
  await store.deleteFile({ bucketId: PROXY_BUCKET, fileId: input.proxyId });
}
