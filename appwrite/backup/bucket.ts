import { PAGE_SIZE, pageThrough, reconcile } from "./dump";
import type { BackupBucket, BackupFile } from "./types";

/**
 * Copying a bucket's files out of the instance.
 *
 * Read through the storage API, not off the NFS mount, though the mount is
 * right there. Three reasons, in order of weight:
 *
 * - A file's `$permissions` live in Appwrite's database, not on the NAS. A
 *   clip is stamped per file, so a copy of the bytes alone restores video
 *   nobody can read -- the exact failure the row dump exists to prevent.
 * - The on-disk layout under `/storage/uploads` is Appwrite's private
 *   business and has no compatibility promise. The API is the same on the
 *   homelab and on Cloud, and Cloud has no mount at all.
 * - The API says which uploads are still in flight (`chunksUploaded`). The
 *   filesystem holds their partial chunks too, with nothing to say they are
 *   partial.
 *
 * The cost is that every byte crosses Appwrite once. Files are immutable, so
 * each one crosses exactly once: a clip already in the store from an earlier
 * dump is not fetched again.
 */

/** A file as the instance lists it, before anything is copied. */
export interface SourceFile {
  $id: string;
  bucketId: string;
  $permissions: string[];
  $createdAt: string;
  $updatedAt: string;
  name: string;
  mimeType: string;
  sizeOriginal: number;
  chunksTotal: number;
  chunksUploaded: number;
}

export interface BucketSource {
  bucketIds(): readonly string[];
  /** One page of files, starting after `cursor`. */
  filePage(
    bucketId: string,
    cursor: string | null,
    limit: number,
  ): Promise<{ total: number; files: SourceFile[] }>;
  /** The file's bytes, or null if it was deleted after it was listed. */
  download(bucketId: string, fileId: string): Promise<AsyncIterable<Uint8Array> | null>;
}

/** Where the bytes go. On disk in production, a Map in the tests. */
export interface BlobStore {
  /** Size of the stored copy, or null if there is none. */
  size(bucketId: string, fileId: string): Promise<number | null>;
  /**
   * Writes the body, and keeps it only if it came to `expectedBytes`. A short
   * copy never takes the place of a file, so a blob in the store is always a
   * whole one.
   */
  put(
    bucketId: string,
    fileId: string,
    body: AsyncIterable<Uint8Array>,
    expectedBytes: number,
  ): Promise<{ ok: true; sha256: string } | { ok: false; bytes: number }>;
}

/**
 * Appwrite's own id rule: a-z, A-Z, 0-9, period, hyphen and underscore, not
 * starting with a special character, at most 36 long. Checked rather than
 * trusted, because an id becomes a path on disk and `..` is not an id.
 */
export const APPWRITE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/;

/** An upload is in flight until every chunk has landed. */
export function isComplete(file: Pick<SourceFile, "chunksTotal" | "chunksUploaded">): boolean {
  return file.chunksUploaded >= file.chunksTotal;
}

export const fileKey = (bucketId: string, fileId: string) => `${bucketId}/${fileId}`;

/** Every file in a bucket, complete or not, paged and reconciled like rows. */
export async function listBucket(source: BucketSource, bucketId: string): Promise<SourceFile[]> {
  const { items, expected } = await pageThrough(
    async (cursor) => {
      const page = await source.filePage(bucketId, cursor, PAGE_SIZE);
      return { total: page.total, items: page.files };
    },
    (file) => file.$id,
    `bucket ${bucketId}`,
  );
  reconcile(`bucket ${bucketId}`, items.length, expected);
  return items;
}

export interface BucketDump {
  buckets: BackupBucket[];
  files: BackupFile[];
  /** Listed, then gone before it could be fetched. Someone deleted a clip mid-dump. */
  vanished: string[];
  downloaded: number;
  reused: number;
}

/**
 * Copies every complete file into the store and describes it.
 *
 * `previous` is the newest earlier dump's file list. A file whose copy is
 * already in the store at the right size, and whose hash an earlier dump
 * recorded, is not fetched again. Anything else is: a missing copy, a copy of
 * the wrong size, a file no earlier dump hashed.
 */
export async function dumpBuckets(
  source: BucketSource,
  store: BlobStore,
  previous: ReadonlyMap<string, BackupFile>,
  onFile: (message: string) => void = () => {},
): Promise<BucketDump> {
  const result: BucketDump = { buckets: [], files: [], vanished: [], downloaded: 0, reused: 0 };

  for (const bucketId of source.bucketIds()) {
    if (!APPWRITE_ID.test(bucketId)) throw new Error(`Bucket id ${JSON.stringify(bucketId)} is not an Appwrite id.`);
    const summary: BackupBucket = { id: bucketId, files: 0, bytes: 0, incomplete: [] };

    for (const file of await listBucket(source, bucketId)) {
      if (!APPWRITE_ID.test(file.$id)) {
        throw new Error(`File id ${JSON.stringify(file.$id)} in ${bucketId} is not an Appwrite id. Refusing to make it a path.`);
      }
      if (!isComplete(file)) {
        summary.incomplete.push(file.$id);
        continue;
      }

      const sha256 = await copyOf(source, store, previous, file, result, onFile);
      if (sha256 === null) {
        result.vanished.push(fileKey(bucketId, file.$id));
        continue;
      }

      result.files.push({
        $id: file.$id,
        bucketId,
        $permissions: file.$permissions,
        $createdAt: file.$createdAt,
        $updatedAt: file.$updatedAt,
        name: file.name,
        mimeType: file.mimeType,
        sizeOriginal: file.sizeOriginal,
        sha256,
      });
      summary.files += 1;
      summary.bytes += file.sizeOriginal;
    }
    result.buckets.push(summary);
  }

  return result;
}

/** The stored copy's hash, fetching it first if need be. Null if it vanished. */
async function copyOf(
  source: BucketSource,
  store: BlobStore,
  previous: ReadonlyMap<string, BackupFile>,
  file: SourceFile,
  tally: { downloaded: number; reused: number },
  onFile: (message: string) => void,
): Promise<string | null> {
  const known = previous.get(fileKey(file.bucketId, file.$id));
  if (known && known.sizeOriginal === file.sizeOriginal) {
    if ((await store.size(file.bucketId, file.$id)) === file.sizeOriginal) {
      tally.reused += 1;
      return known.sha256;
    }
  }

  // Once more on a short copy, because a connection that drops mid-clip is
  // the ordinary case on a homelab. Twice short is not ordinary, and a backup
  // that quietly skips a clip is worse than one that fails loudly at 3am.
  for (let attempt = 1; ; attempt += 1) {
    const body = await source.download(file.bucketId, file.$id);
    if (body === null) return null;
    const written = await store.put(file.bucketId, file.$id, body, file.sizeOriginal);
    if (written.ok) {
      tally.downloaded += 1;
      onFile(`copied   ${fileKey(file.bucketId, file.$id)} (${file.sizeOriginal} bytes)`);
      return written.sha256;
    }
    if (attempt === 2) {
      throw new Error(
        `${fileKey(file.bucketId, file.$id)} came back as ${written.bytes} bytes twice; ` +
          `the instance says ${file.sizeOriginal}. Refusing to write a dump missing a clip.`,
      );
    }
  }
}
