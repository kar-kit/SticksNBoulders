import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  backupDirName,
  blobPath,
  diskBlobStore,
  fileStoreFor,
  listBackups,
  pruneBlobs,
  readBackup,
  verifyBlobs,
  writeBackup,
} from "./files";
import { BACKUP_FORMAT_VERSION, type Backup, type BackupFile } from "./types";

const backup: Backup = {
  manifest: {
    formatVersion: BACKUP_FORMAT_VERSION,
    takenAt: "2026-09-14T03:00:00.000Z",
    endpoint: "https://appwrite.example/v1",
    projectId: "snb",
    databaseId: "sticksnboulders",
    schemaVersion: 1,
    tables: [{ id: "sets", rows: 1, expectedRows: 1 }],
    users: 1,
    teams: 1,
    memberships: 1,
    buckets: [],
    omits: ["password hashes"],
  },
  tables: [
    {
      id: "sets",
      expectedRows: 1,
      rows: [{ $id: "set1", $permissions: [`read("user:joey")`], data: { load_kg: 142.5 } }],
    },
  ],
  users: [
    {
      $id: "joey",
      email: "joey@example.com",
      name: "Joey",
      labels: [],
      prefs: {},
      emailVerification: true,
      status: true,
      registration: "2026-09-01T00:00:00.000Z",
      providers: ["google"],
    },
  ],
  teams: [
    {
      $id: "circle_joey",
      name: "Joey — circle",
      memberships: [{ userId: "joey", roles: ["athlete"], confirmed: true }],
    },
  ],
  files: [],
};

const BYTES = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const clipEntry = (id: string, overrides: Partial<BackupFile> = {}): BackupFile => ({
  $id: id,
  bucketId: "set_videos",
  $permissions: [`read("user:joey")`],
  $createdAt: "2026-10-01T10:00:00.000Z",
  $updatedAt: "2026-10-01T10:00:00.000Z",
  name: `${id}.mov`,
  mimeType: "video/quicktime",
  sizeOriginal: BYTES.length,
  sha256: sha(BYTES),
  ...overrides,
});

async function* bodyOf(bytes: Uint8Array) {
  yield bytes.slice(0, 3);
  yield bytes.slice(3);
}

/** A v2 dump covering `ids`, under `root`, with no blobs written. */
async function dumpCovering(root: string, name: string, ids: string[]) {
  await writeBackup(join(root, name), {
    ...backup,
    manifest: { ...backup.manifest, buckets: [{ id: "set_videos", files: ids.length, bytes: 0, incomplete: [] }] },
    files: ids.map((id) => clipEntry(id)),
  });
}

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "snb-backup-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("a backup on disk", () => {
  it("round-trips without losing ids or permissions", async () => {
    await writeBackup(dir, backup);
    expect(await readBackup(dir)).toEqual(backup);
  });

  it("writes the manifest last, so a crashed dump cannot pass as a good one", async () => {
    await writeBackup(dir, backup);
    await rm(join(dir, "manifest.json"));
    await expect(readBackup(dir)).rejects.toThrow(/Cannot read/);
  });

  it("refuses a directory that is not a backup", async () => {
    await writeFile(join(dir, "manifest.json"), JSON.stringify({ hello: "world" }));
    await expect(readBackup(dir)).rejects.toThrow(/not a backup/);
  });

  it("names a directory after the moment it was taken, legibly on every filesystem", () => {
    expect(backupDirName("2026-09-14T03:00:00.000Z")).toBe("2026-09-14T03-00-00-000Z");
  });

  it("lists dumps oldest first, and says nothing rather than throwing when there are none", async () => {
    expect(await listBackups(join(dir, "nope"))).toEqual([]);
    await writeBackup(join(dir, "2026-09-13T00-00-00-000Z"), backup);
    await writeBackup(join(dir, "2026-09-14T00-00-00-000Z"), backup);
    expect(await listBackups(dir)).toEqual([
      "2026-09-13T00-00-00-000Z",
      "2026-09-14T00-00-00-000Z",
    ]);
  });

  it("ignores a directory with no manifest, so a crashed dump cannot displace a good one", async () => {
    // Retention deletes what this returns. A half-written dump counting toward
    // the window would evict a real backup to make room for a corpse.
    await writeBackup(join(dir, "2026-09-14T00-00-00-000Z"), backup);
    await mkdir(join(dir, "2026-09-15T00-00-00-000Z", "tables"), { recursive: true });
    await mkdir(join(dir, "not-a-backup-at-all"), { recursive: true });

    expect(await listBackups(dir)).toEqual(["2026-09-14T00-00-00-000Z"]);
  });

  it("stores one file per table, readable on its own", async () => {
    await writeBackup(dir, backup);
    const table = JSON.parse(await readFile(join(dir, "tables", "sets.json"), "utf8"));
    expect(table.rows[0].$permissions).toEqual([`read("user:joey")`]);
  });
});

describe("clips in a backup", () => {
  it("round-trips a dump's file list", async () => {
    const withClip: Backup = {
      ...backup,
      manifest: { ...backup.manifest, buckets: [{ id: "set_videos", files: 1, bytes: 8, incomplete: ["p"] }] },
      files: [clipEntry("clipA")],
    };
    await writeBackup(dir, withClip);
    expect(await readBackup(dir)).toEqual(withClip);
  });

  it("reads a v1 dump, which predates file backups, as holding no clips", async () => {
    await writeBackup(dir, backup);
    const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
    delete manifest.buckets;
    manifest.formatVersion = 1;
    await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest));
    await rm(join(dir, "files.json"));

    const read = await readBackup(dir);
    expect(read.files).toEqual([]);
    expect(read.manifest.buckets).toEqual([]);
  });

  it("keeps the shared file store beside the dump directories", () => {
    expect(fileStoreFor("/b/.appwrite-backup/2026-10-07T03-15-00-000Z")).toBe("/b/.appwrite-backup/files");
    expect(fileStoreFor("/b/.appwrite-backup/2026-10-07T03-15-00-000Z/")).toBe("/b/.appwrite-backup/files");
  });

  it("refuses to turn something that is not an id into a path", () => {
    expect(() => blobPath(dir, "set_videos", "../../etc/passwd")).toThrow(/not an Appwrite id/);
    expect(() => blobPath(dir, "..", "clipA")).toThrow(/not an Appwrite id/);
  });
});

describe("the blob store on disk", () => {
  it("writes a whole copy and hashes what it wrote", async () => {
    const store = diskBlobStore(join(dir, "files"));
    const result = await store.put("set_videos", "clipA", bodyOf(BYTES), BYTES.length);

    expect(result).toEqual({ ok: true, sha256: sha(BYTES) });
    expect(new Uint8Array(await readFile(join(dir, "files", "set_videos", "clipA")))).toEqual(BYTES);
    expect(await store.size("set_videos", "clipA")).toBe(BYTES.length);
  });

  it("keeps nothing from a short copy, not even the partial file", async () => {
    const store = diskBlobStore(join(dir, "files"));
    const result = await store.put("set_videos", "clipA", bodyOf(BYTES), BYTES.length + 1);

    expect(result).toEqual({ ok: false, bytes: BYTES.length });
    expect(await store.size("set_videos", "clipA")).toBeNull();
    await expect(readFile(join(dir, "files", "set_videos", "clipA.partial"))).rejects.toThrow();
  });

  it("never replaces a good copy with a short one", async () => {
    const store = diskBlobStore(join(dir, "files"));
    await store.put("set_videos", "clipA", bodyOf(BYTES), BYTES.length);
    await store.put("set_videos", "clipA", bodyOf(BYTES.slice(0, 2)), BYTES.length);
    expect(await store.size("set_videos", "clipA")).toBe(BYTES.length);
  });
});

describe("verifying stored clips", () => {
  const store = () => join(dir, "files");
  const putClip = (id: string, bytes = BYTES) =>
    diskBlobStore(store()).put("set_videos", id, bodyOf(bytes), bytes.length);

  it("passes a copy that is present, the right size and the right hash", async () => {
    await putClip("clipA");
    expect(await verifyBlobs(store(), [clipEntry("clipA")])).toEqual([]);
  });

  it("names a clip missing from the store", async () => {
    expect(await verifyBlobs(store(), [clipEntry("clipA")])).toEqual(["set_videos/clipA is not in the file store."]);
  });

  it("names a copy of the wrong size", async () => {
    await putClip("clipA", BYTES.slice(0, 5));
    expect((await verifyBlobs(store(), [clipEntry("clipA")]))[0]).toMatch(/5 bytes in the store; the dump says 8/);
  });

  it("names a copy whose bytes changed on disk", async () => {
    const flipped = BYTES.slice();
    flipped[0] = 255;
    await putClip("clipA", flipped);
    expect((await verifyBlobs(store(), [clipEntry("clipA")]))[0]).toMatch(/does not match the hash/);
  });
});

describe("pruning clips no kept dump covers", () => {
  const putClip = (id: string) =>
    diskBlobStore(join(dir, "files")).put("set_videos", id, bodyOf(BYTES), BYTES.length);

  it("removes clips only pruned dumps covered, and leftovers from a crashed copy", async () => {
    await dumpCovering(dir, "2026-10-07T00-00-00-000Z", ["kept"]);
    await putClip("kept");
    await putClip("old");
    await writeFile(join(dir, "files", "set_videos", "half.partial"), "x");

    const result = await pruneBlobs(dir, ["2026-10-07T00-00-00-000Z"]);

    // Sorted here because readdir order is the filesystem's, not ours.
    expect("removed" in result && [...result.removed].sort()).toEqual(["set_videos/half.partial", "set_videos/old"]);
    expect(await diskBlobStore(join(dir, "files")).size("set_videos", "kept")).toBe(BYTES.length);
  });

  it("keeps a clip any kept dump covers, not just the newest", async () => {
    await dumpCovering(dir, "2026-10-06T00-00-00-000Z", ["deleted-yesterday"]);
    await dumpCovering(dir, "2026-10-07T00-00-00-000Z", []);
    await putClip("deleted-yesterday");

    const result = await pruneBlobs(dir, ["2026-10-06T00-00-00-000Z", "2026-10-07T00-00-00-000Z"]);
    expect(result).toEqual({ removed: [] });
  });

  it("deletes nothing when a kept dump's file list cannot be read", async () => {
    await dumpCovering(dir, "2026-10-07T00-00-00-000Z", ["kept"]);
    await putClip("unknown");
    await rm(join(dir, "2026-10-07T00-00-00-000Z", "files.json"));

    const result = await pruneBlobs(dir, ["2026-10-07T00-00-00-000Z"]);

    expect(result).toEqual({ refused: expect.stringMatching(/no blobs were pruned/) });
    expect(await diskBlobStore(join(dir, "files")).size("set_videos", "unknown")).toBe(BYTES.length);
  });

  it("ignores the file store when listing dumps, so retention never counts it", async () => {
    await dumpCovering(dir, "2026-10-07T00-00-00-000Z", ["kept"]);
    await putClip("kept");
    expect(await listBackups(dir)).toEqual(["2026-10-07T00-00-00-000Z"]);
  });
});
