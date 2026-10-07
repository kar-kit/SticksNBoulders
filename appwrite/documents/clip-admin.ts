import type { ClearedOrphan } from "../backup/orphans";

/**
 * Deleting a file nothing points at, server-side: a clip, or since v13 a
 * profile picture whose best-effort delete failed.
 *
 * The one server-side storage delete, and it lives in the write helper for the
 * same reason every row write does: one place to review. (The browser deletes
 * one thing itself: the owner's previous profile picture, with the delete their
 * own stamp grants -- lib/profile/avatar-store.ts.) It takes a
 * `ClearedOrphan` and nothing else, and only `clearForDeletion` in
 * appwrite/backup/orphans.ts makes one -- after checking that a fresh backup
 * holds the file byte for byte. A caller cannot hand this a bare file id.
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
