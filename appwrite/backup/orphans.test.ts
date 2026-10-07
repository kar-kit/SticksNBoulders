import { VIDEO_BUCKET } from "@/lib/video/bucket";
import { schema } from "../schema";
import type { SourceFile } from "./bucket";
import {
  CLIP_REFERENCES,
  DAY_MS,
  DEFAULT_MIN_AGE_DAYS,
  FRESH_BACKUP_HOURS,
  classify,
  clearForDeletion,
  referencesIn,
  stillOrphaned,
  type ClearedOrphan,
  type ClipReference,
  type CoveringDump,
} from "./orphans";
import type { BackupFile } from "./types";

const NOW = new Date("2026-10-07T12:00:00.000Z");
const MIN_AGE = DEFAULT_MIN_AGE_DAYS * DAY_MS;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

/** A finished clip, last touched `age` ago. Old enough to sweep by default. */
const clip = (id: string, age = 30 * DAY_MS, overrides: Partial<SourceFile> = {}): SourceFile => ({
  $id: id,
  bucketId: VIDEO_BUCKET,
  $permissions: [],
  $createdAt: ago(age),
  $updatedAt: ago(age),
  name: `${id}.mov`,
  mimeType: "video/quicktime",
  sizeOriginal: 10_000_000,
  chunksTotal: 2,
  chunksUploaded: 2,
  ...overrides,
});

const set = (id: string, videoFileId: unknown) => ({ $id: id, data: { athlete_id: "joey", video_file_id: videoFileId } });
const refs = (...sets: ReturnType<typeof set>[]) => referencesIn("sets", sets);
const ids = (files: readonly SourceFile[]) => files.map((f) => f.$id);

describe("what counts as a reference", () => {
  it("reads video_file_id off sets", () => {
    expect(refs(set("s1", "clipA"))).toEqual([
      { bucketId: VIDEO_BUCKET, tableId: "sets", rowId: "s1", fileId: "clipA" },
    ]);
  });

  it("ignores a detached set, whatever shape the empty value takes", () => {
    expect(refs(set("s1", null), set("s2", undefined), set("s3", ""), set("s4", "   "), set("s5", 42))).toEqual([]);
  });

  it("finds nothing in a table with no file column", () => {
    expect(referencesIn("sessions", [{ $id: "x", data: { video_file_id: "clipA" } }])).toEqual([]);
  });

  it("knows every column in the schema that holds a file id", () => {
    // The failure this prevents: a second table starts pointing at clips, the
    // sweep never reads it, and deletes clips out from under it.
    const fileColumns = schema.tables.flatMap((t) =>
      t.columns.filter((c) => /file_?id$/i.test(c.key)).map((c) => `${t.id}.${c.key}`),
    );
    expect(fileColumns.sort()).toEqual(CLIP_REFERENCES.map((r) => `${r.tableId}.${r.column}`).sort());
  });

  it("points into the bucket the app uploads to, which the schema declares", () => {
    expect(CLIP_REFERENCES.map((r) => r.bucketId)).toEqual([VIDEO_BUCKET]);
    expect(schema.buckets.map((b) => b.id)).toContain(VIDEO_BUCKET);
  });
});

describe("finding orphans", () => {
  const sweep = (files: SourceFile[], references: ClipReference[], minAge = MIN_AGE) =>
    classify(files, references, NOW, minAge);

  it("keeps a clip a set points at, however old", () => {
    const plan = sweep([clip("a", 400 * DAY_MS)], refs(set("s1", "a")));
    expect(plan.orphans).toEqual([]);
    expect(plan.referenced).toBe(1);
  });

  it("sweeps a clip detached from a set that still exists", () => {
    const plan = sweep([clip("a")], refs(set("s1", null)));
    expect(ids(plan.orphans)).toEqual(["a"]);
  });

  it("sweeps a clip whose set the athlete deleted", () => {
    // The row is gone, so nothing in the table names the file at all.
    const plan = sweep([clip("a")], refs(set("other", "b")));
    expect(ids(plan.orphans)).toEqual(["a"]);
  });

  it("sweeps a clip attached to a set that was deleted before the attach landed", () => {
    // Upload finished, set.attachVideo queued, set deleted first: the attach
    // fails against a missing row, and the file was never referenced by anyone.
    const plan = sweep([clip("a")], []);
    expect(ids(plan.orphans)).toEqual(["a"]);
  });

  it("keeps a clip two sets point at", () => {
    const plan = sweep([clip("a")], refs(set("s1", "a"), set("s2", "a")));
    expect(plan.orphans).toEqual([]);
    expect(plan.referenced).toBe(1);
  });

  it("keeps a clip two sets pointed at when only one of them is deleted", () => {
    const plan = sweep([clip("a")], refs(set("s2", "a")));
    expect(plan.orphans).toEqual([]);
  });

  it("sweeps a clip two sets pointed at once both are gone or detached", () => {
    const plan = sweep([clip("a")], refs(set("s1", null)));
    expect(ids(plan.orphans)).toEqual(["a"]);
  });

  it("sweeps the old clip and keeps the new one when an athlete re-films", () => {
    const plan = sweep([clip("old"), clip("new")], refs(set("s1", "new")));
    expect(ids(plan.orphans)).toEqual(["old"]);
  });

  describe("uploads in flight", () => {
    it("never sweeps a partial upload: the athlete lost signal and may still finish it", () => {
      const partial = clip("p", 400 * DAY_MS, { chunksTotal: 6, chunksUploaded: 2 });
      const plan = sweep([partial], []);
      expect(plan.orphans).toEqual([]);
      expect(ids(plan.uploading)).toEqual(["p"]);
    });

    it("never sweeps a partial upload with nothing uploaded yet", () => {
      const plan = sweep([clip("p", 400 * DAY_MS, { chunksTotal: 1, chunksUploaded: 0 })], []);
      expect(ids(plan.uploading)).toEqual(["p"]);
    });

    it("leaves a finished upload alone while its attach may still be on its way", () => {
      // The last chunk landed, the response did not, and the phone queues the
      // attach on its next start with signal. Until then nothing names it.
      const plan = sweep([clip("a", 2 * DAY_MS)], []);
      expect(plan.orphans).toEqual([]);
      expect(ids(plan.tooYoung)).toEqual(["a"]);
    });

    it("dates a resumed upload from when it finished, not when it started", () => {
      const resumed = clip("a", 0, { $createdAt: ago(40 * DAY_MS), $updatedAt: ago(1 * DAY_MS) });
      const plan = sweep([resumed], []);
      expect(ids(plan.tooYoung)).toEqual(["a"]);
    });

    it("sweeps at exactly the minimum age, and not a millisecond before", () => {
      expect(ids(sweep([clip("a", MIN_AGE)], []).orphans)).toEqual(["a"]);
      expect(ids(sweep([clip("a", MIN_AGE - 1)], []).tooYoung)).toEqual(["a"]);
    });

    it("honours a longer minimum age", () => {
      const plan = sweep([clip("a", 20 * DAY_MS)], [], 21 * DAY_MS);
      expect(ids(plan.tooYoung)).toEqual(["a"]);
    });
  });

  describe("when in doubt, keeps", () => {
    it("keeps a clip it cannot date", () => {
      const plan = sweep([clip("a", 0, { $createdAt: "not a date", $updatedAt: "" })], []);
      expect(ids(plan.tooYoung)).toEqual(["a"]);
    });

    it("keeps a clip with one undatable timestamp", () => {
      const plan = sweep([clip("a", 0, { $createdAt: ago(90 * DAY_MS), $updatedAt: "garbage" })], []);
      expect(ids(plan.tooYoung)).toEqual(["a"]);
    });

    it("keeps a clip stamped in the future, as a skewed clock would", () => {
      const plan = sweep([clip("a", -3 * DAY_MS)], []);
      expect(ids(plan.tooYoung)).toEqual(["a"]);
    });

    it("keeps a clip whose reference differs only in case or whitespace", () => {
      const plan = sweep([clip("AbC123")], refs(set("s1", " abc123 ")));
      expect(plan.orphans).toEqual([]);
    });
  });

  it("does not let a reference into one bucket protect a same-named file in another", () => {
    const elsewhere = clip("a", 30 * DAY_MS, { bucketId: "avatars" });
    expect(ids(sweep([elsewhere], refs(set("s1", "a"))).orphans)).toEqual(["a"]);
  });

  it("reports sets pointing at clips the bucket does not hold, and does nothing about them", () => {
    const plan = sweep([clip("a")], refs(set("s1", "a"), set("s2", "missing")));
    expect(plan.dangling).toEqual([{ bucketId: VIDEO_BUCKET, tableId: "sets", rowId: "s2", fileId: "missing" }]);
    expect(plan.orphans).toEqual([]);
  });

  it("counts reclaimable bytes from orphans alone", () => {
    const plan = sweep(
      [
        clip("orphan1", 30 * DAY_MS, { sizeOriginal: 30_000_000 }),
        clip("orphan2", 30 * DAY_MS, { sizeOriginal: 5_000_000 }),
        clip("young", DAY_MS, { sizeOriginal: 100_000_000 }),
        clip("kept", 30 * DAY_MS, { sizeOriginal: 100_000_000 }),
        clip("partial", 30 * DAY_MS, { sizeOriginal: 100_000_000, chunksUploaded: 1 }),
      ],
      refs(set("s1", "kept")),
    );
    expect(plan.reclaimableBytes).toBe(35_000_000);
  });

  it("finds nothing in an empty bucket", () => {
    expect(sweep([], refs(set("s1", "a"))).orphans).toEqual([]);
  });
});

/**
 * Checked by `npm run typecheck`, not at run time. The delete takes only a
 * ClearedOrphan, so the brand is the whole guarantee that nothing a backup has
 * not cleared can reach it. If the brand stopped excluding a hand-built
 * object, this directive would be unused and the typecheck would fail.
 */
// @ts-expect-error -- lacks the brand only clearForDeletion stamps.
const handBuilt: ClearedOrphan = { bucketId: VIDEO_BUCKET, $id: "a", sizeOriginal: 4, coveredBy: "dump" };
void handBuilt;

describe("clearing orphans for deletion", () => {
  const held = (file: SourceFile, overrides: Partial<BackupFile> = {}): BackupFile => ({
    $id: file.$id,
    bucketId: file.bucketId,
    $permissions: file.$permissions,
    $createdAt: file.$createdAt,
    $updatedAt: file.$updatedAt,
    name: file.name,
    mimeType: file.mimeType,
    sizeOriginal: file.sizeOriginal,
    sha256: "f".repeat(64),
    ...overrides,
  });
  const dumpOf = (files: BackupFile[], overrides: Partial<CoveringDump> = {}): CoveringDump => ({
    name: "2026-10-07T03-15-00-000Z",
    formatVersion: 2,
    takenAt: "2026-10-07T03:15:00.000Z",
    files,
    ...overrides,
  });
  const intact = async () => null;

  it("clears every orphan a fresh dump holds intact", async () => {
    const a = clip("a");
    const b = clip("b");
    const result = await clearForDeletion([a, b], dumpOf([held(a), held(b)]), NOW, intact);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.cleared.map((c) => [c.$id, c.coveredBy])).toEqual([
        ["a", "2026-10-07T03-15-00-000Z"],
        ["b", "2026-10-07T03-15-00-000Z"],
      ]);
    }
  });

  it("refuses without a backup", async () => {
    const result = await clearForDeletion([clip("a")], null, NOW, intact);
    expect(result).toEqual({ ok: false, reasons: [expect.stringMatching(/no backup/)] });
  });

  it("refuses a v1 backup, which holds no clips", async () => {
    const a = clip("a");
    const result = await clearForDeletion([a], dumpOf([held(a)], { formatVersion: 1 }), NOW, intact);
    expect(result).toEqual({ ok: false, reasons: [expect.stringMatching(/predates file backups/)] });
  });

  it(`refuses a backup older than ${FRESH_BACKUP_HOURS} hours, and accepts one just inside it`, async () => {
    const a = clip("a");
    const at = (hours: number) => dumpOf([held(a)], { takenAt: ago(hours * 60 * 60 * 1000) });

    expect((await clearForDeletion([a], at(FRESH_BACKUP_HOURS + 1), NOW, intact)).ok).toBe(false);
    expect((await clearForDeletion([a], at(FRESH_BACKUP_HOURS - 1), NOW, intact)).ok).toBe(true);
  });

  it("refuses a backup it cannot date", async () => {
    const a = clip("a");
    const result = await clearForDeletion([a], dumpOf([held(a)], { takenAt: "yesterday" }), NOW, intact);
    expect(result).toEqual({ ok: false, reasons: [expect.stringMatching(/undated/)] });
  });

  it("refuses all of them when one orphan is missing from the backup", async () => {
    // Uploaded after last night's dump and orphaned since -- possible with a
    // short --min-age-days. All or nothing, so nothing is cleared.
    const a = clip("a");
    const b = clip("b");
    const result = await clearForDeletion([a, b], dumpOf([held(a)]), NOW, intact);
    expect(result).toEqual({ ok: false, reasons: ["set_videos/b is not in 2026-10-07T03-15-00-000Z."] });
  });

  it("refuses when the backup's copy is a different size from the live file", async () => {
    const a = clip("a");
    const result = await clearForDeletion([a], dumpOf([held(a, { sizeOriginal: 9 })]), NOW, intact);
    expect(result.ok).toBe(false);
  });

  it("refuses when the stored bytes fail their check", async () => {
    const a = clip("a");
    const result = await clearForDeletion([a], dumpOf([held(a)]), NOW, async () => "hash mismatch");
    expect(result).toEqual({ ok: false, reasons: ["hash mismatch"] });
  });

  it("matches ids exactly when checking coverage", async () => {
    // Folding case is right for "is it referenced" -- it can only keep more.
    // For "is it backed up" it would be wrong in the dangerous direction.
    const live = clip("abc");
    const result = await clearForDeletion([live], dumpOf([held(clip("ABC"))]), NOW, intact);
    expect(result.ok).toBe(false);
  });

  it("clears nothing, successfully, when there is nothing to clear", async () => {
    expect(await clearForDeletion([], dumpOf([]), NOW, intact)).toEqual({ ok: true, cleared: [] });
  });

  it("spares a clip a set started pointing at while the backup was being checked", async () => {
    const a = clip("a");
    const b = clip("b");
    const result = await clearForDeletion([a, b], dumpOf([held(a), held(b)]), NOW, intact);
    if (!result.ok) throw new Error("expected clearance");

    expect(stillOrphaned(result.cleared, refs(set("s9", "B"))).map((c) => c.$id)).toEqual(["a"]);
  });
});
