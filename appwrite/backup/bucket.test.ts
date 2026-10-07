import { createHash } from "node:crypto";
import { dumpBuckets, isComplete, listBucket, type BlobStore, type BucketSource, type SourceFile } from "./bucket";
import type { BackupFile } from "./types";

const clip = (id: string, overrides: Partial<SourceFile> = {}): SourceFile => ({
  $id: id,
  bucketId: "set_videos",
  $permissions: [`read("user:joey")`, `read("team:circle_joey")`],
  $createdAt: "2026-10-01T10:00:00.000Z",
  $updatedAt: "2026-10-01T10:01:00.000Z",
  name: `${id}.mov`,
  mimeType: "video/quicktime",
  sizeOriginal: 4,
  chunksTotal: 1,
  chunksUploaded: 1,
  ...overrides,
});

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function* bodyOf(bytes: Uint8Array) {
  yield bytes;
}

/**
 * A bucket that caps pages like Appwrite does, and serves each file's bytes
 * from `content`. `short` makes the next N downloads of a file lose a byte --
 * a connection that drops mid-clip.
 */
function fakeBucket(
  files: SourceFile[],
  options: { cap?: number; content?: Record<string, Uint8Array>; short?: Record<string, number>; gone?: string[] } = {},
): BucketSource & { downloads: string[] } {
  const cap = options.cap ?? 100;
  const downloads: string[] = [];
  const short = { ...options.short };
  return {
    downloads,
    bucketIds: () => ["set_videos"],
    async filePage(_bucketId, cursor) {
      const start = cursor ? files.findIndex((f) => f.$id === cursor) + 1 : 0;
      return { total: files.length, files: files.slice(start, start + cap) };
    },
    async download(_bucketId, fileId) {
      downloads.push(fileId);
      if (options.gone?.includes(fileId)) return null;
      const bytes = options.content?.[fileId] ?? new Uint8Array([1, 2, 3, 4]);
      if ((short[fileId] ?? 0) > 0) {
        short[fileId] -= 1;
        return bodyOf(bytes.slice(0, bytes.length - 1));
      }
      return bodyOf(bytes);
    },
  };
}

/** A store in a Map, with the same keep-only-if-whole rule as the disk one. */
function memoryStore(initial: Record<string, Uint8Array> = {}): BlobStore & { blobs: Map<string, Uint8Array> } {
  const blobs = new Map(Object.entries(initial));
  return {
    blobs,
    async size(bucketId, fileId) {
      return blobs.get(`${bucketId}/${fileId}`)?.length ?? null;
    },
    async put(bucketId, fileId, body, expectedBytes) {
      const parts: number[] = [];
      for await (const chunk of body) parts.push(...chunk);
      const bytes = new Uint8Array(parts);
      if (bytes.length !== expectedBytes) return { ok: false, bytes: bytes.length };
      blobs.set(`${bucketId}/${fileId}`, bytes);
      return { ok: true, sha256: sha(bytes) };
    },
  };
}

const none = new Map<string, BackupFile>();

describe("listing a bucket", () => {
  it("pages past the server's cap", async () => {
    const files = Array.from({ length: 23 }, (_, i) => clip(`c${String(i).padStart(2, "0")}`));
    expect(await listBucket(fakeBucket(files, { cap: 5 }), "set_videos")).toHaveLength(23);
  });

  it("refuses a short listing, because the sweep would read it as orphans", async () => {
    const source = fakeBucket([clip("a")]);
    source.filePage = async () => ({ total: 3, files: [] });
    await expect(listBucket(source, "set_videos")).rejects.toThrow(/collected 0 of 3/);
  });
});

describe("dumping a bucket", () => {
  it("copies every complete clip with its permissions and the hash of what was written", async () => {
    const bytes = new Uint8Array([9, 8, 7, 6]);
    const store = memoryStore();

    const dump = await dumpBuckets(fakeBucket([clip("a")], { content: { a: bytes } }), store, none);

    expect(dump.files).toEqual([
      expect.objectContaining({
        $id: "a",
        bucketId: "set_videos",
        $permissions: [`read("user:joey")`, `read("team:circle_joey")`],
        sizeOriginal: 4,
        sha256: sha(bytes),
      }),
    ]);
    expect(store.blobs.get("set_videos/a")).toEqual(bytes);
    expect(dump.buckets).toEqual([{ id: "set_videos", files: 1, bytes: 4, incomplete: [] }]);
  });

  it("names an upload still in flight and does not copy it", async () => {
    // The athlete lost signal two chunks in. The phone still has the clip and
    // will finish it; a backup of half a video is not a backup of anything.
    const source = fakeBucket([clip("partial", { chunksTotal: 4, chunksUploaded: 2, sizeOriginal: 20_000_000 })]);

    const dump = await dumpBuckets(source, memoryStore(), none);

    expect(dump.files).toEqual([]);
    expect(dump.buckets[0].incomplete).toEqual(["partial"]);
    expect(source.downloads).toEqual([]);
  });

  it("does not fetch a clip an earlier dump already holds", async () => {
    const store = memoryStore({ "set_videos/a": new Uint8Array([1, 2, 3, 4]) });
    const earlier = new Map([["set_videos/a", { ...clip("a"), sha256: "earlier-hash" } as BackupFile]]);
    const source = fakeBucket([clip("a")]);

    const dump = await dumpBuckets(source, store, earlier);

    expect(source.downloads).toEqual([]);
    expect(dump.files[0].sha256).toBe("earlier-hash");
    expect(dump.reused).toBe(1);
  });

  it("fetches again when the stored copy is the wrong size", async () => {
    const store = memoryStore({ "set_videos/a": new Uint8Array([1, 2]) });
    const earlier = new Map([["set_videos/a", { ...clip("a"), sha256: "earlier-hash" } as BackupFile]]);
    const source = fakeBucket([clip("a")]);

    const dump = await dumpBuckets(source, store, earlier);

    expect(source.downloads).toEqual(["a"]);
    expect(dump.files[0].sha256).toBe(sha(new Uint8Array([1, 2, 3, 4])));
  });

  it("fetches again when the copy is there but no earlier dump hashed it", async () => {
    // A crashed dump can leave a blob behind with no manifest to vouch for it.
    const source = fakeBucket([clip("a")]);
    await dumpBuckets(source, memoryStore({ "set_videos/a": new Uint8Array([1, 2, 3, 4]) }), none);
    expect(source.downloads).toEqual(["a"]);
  });

  it("retries a short copy once, and keeps only the whole one", async () => {
    const source = fakeBucket([clip("a")], { short: { a: 1 } });
    const store = memoryStore();

    const dump = await dumpBuckets(source, store, none);

    expect(source.downloads).toEqual(["a", "a"]);
    expect(store.blobs.get("set_videos/a")).toHaveLength(4);
    expect(dump.files).toHaveLength(1);
  });

  it("fails the dump when a clip comes back short twice", async () => {
    const source = fakeBucket([clip("a")], { short: { a: 2 } });
    const store = memoryStore();

    await expect(dumpBuckets(source, store, none)).rejects.toThrow(/3 bytes twice.*says 4/);
    expect(store.blobs.size).toBe(0);
  });

  it("records a clip deleted between listing and fetching, rather than failing", async () => {
    const source = fakeBucket([clip("a"), clip("b")], { gone: ["a"] });

    const dump = await dumpBuckets(source, memoryStore(), none);

    expect(dump.vanished).toEqual(["set_videos/a"]);
    expect(dump.files.map((f) => f.$id)).toEqual(["b"]);
    expect(dump.buckets[0].files).toBe(1);
  });

  it("refuses an id that would escape the store", async () => {
    await expect(dumpBuckets(fakeBucket([clip("../../etc")]), memoryStore(), none)).rejects.toThrow(
      /not an Appwrite id/,
    );
  });
});

describe("an upload is complete", () => {
  it("only when every chunk has landed", () => {
    expect(isComplete({ chunksTotal: 3, chunksUploaded: 3 })).toBe(true);
    expect(isComplete({ chunksTotal: 3, chunksUploaded: 2 })).toBe(false);
    expect(isComplete({ chunksTotal: 1, chunksUploaded: 0 })).toBe(false);
  });
});
