import { describe, expect, it, vi } from "vitest";
import { posterPermissions } from "../appwrite/documents/policy";
import { setPosterOnSet } from "../appwrite/documents/poster-admin";
import { setPermissions } from "../appwrite/documents/policy";
import type { RowWriter } from "../appwrite/documents/row-writer";
import { applyPosters, ffmpegArgs, planPosters, type PosterBackfillDeps, type Row } from "./clip-posters";

/**
 * The backfill against an in-memory instance: sets, a poster bucket, and an
 * ffmpeg that either makes a frame or fails. The things worth pinning are the
 * ones that would hurt on the live run: a dry run that writes, a second run
 * that does work again, a squatted file trusted, a replaced clip overwritten.
 */
function instance(sets: Row[], files: Record<string, string[]> = {}) {
  const rows = new Map(sets.map((r) => [r.$id, { ...r }]));
  const bucket = new Map(Object.entries(files));
  const writes: string[] = [];
  const deps: PosterBackfillDeps = {
    setsWithClips: async () => [...rows.values()].filter((r) => typeof r.video_file_id === "string").map((r) => ({ ...r })),
    getSet: async (id) => (rows.has(id) ? { ...rows.get(id)! } : null),
    posterFile: async (id) => (bucket.has(id) ? { $permissions: bucket.get(id)! } : null),
    renderPoster: vi.fn(async (clipId: string) => {
      if (clipId.startsWith("broken")) throw new Error("moov atom not found");
      return new Uint8Array([0xff, 0xd8]);
    }),
    uploadPoster: vi.fn(async (id: string, _bytes: Uint8Array, permissions: string[]) => {
      if (bucket.has(id)) throw Object.assign(new Error("exists"), { code: 409 });
      bucket.set(id, permissions);
      writes.push(`upload ${id}`);
    }),
    pointSet: vi.fn(async ({ rowId, videoPosterId }) => {
      rows.get(rowId)!.video_poster_id = videoPosterId;
      writes.push(`point ${rowId}`);
    }),
    permissionsFor: (athleteId) => posterPermissions({ athleteId }),
    log: () => {},
  };
  return { deps, rows, bucket, writes };
}

const filmed = (id: string, clipId: string, over: Partial<Row> = {}): Row => ({
  $id: id,
  athlete_id: "joey",
  video_file_id: clipId,
  ...over,
});

describe("planPosters", () => {
  it("reads only: the dry run writes nothing", async () => {
    const { deps, writes } = instance([filmed("s1", "c1")]);
    const plan = await planPosters(deps);
    expect(plan.entries.map((e) => [e.rowId, e.kind])).toEqual([["s1", "render"]]);
    expect(writes).toEqual([]);
    expect(deps.renderPoster).not.toHaveBeenCalled();
  });

  it("skips a set whose poster is in place, and re-plans one whose poster is a stale clip's", async () => {
    const { deps } = instance([
      filmed("s1", "c1", { video_poster_id: "c1_poster" }),
      filmed("s2", "c2", { video_poster_id: "c0_poster" }),
    ]);
    const plan = await planPosters(deps);
    expect(plan.done).toBe(1);
    expect(plan.entries.map((e) => e.rowId)).toEqual(["s2"]);
  });

  it("points at a file already there only when it carries this athlete's poster stamp", async () => {
    const { deps } = instance([filmed("s1", "c1"), filmed("s2", "c2")], {
      c1_poster: posterPermissions({ athleteId: "joey" }),
      c2_poster: ['read("users")', 'delete("user:stranger")'],
    });
    const plan = await planPosters(deps);
    expect(plan.entries.map((e) => [e.rowId, e.kind])).toEqual([
      ["s1", "point"],
      ["s2", "squatted"],
    ]);
  });

  it("leaves a clip id too long for a poster id", async () => {
    const { deps } = instance([filmed("s1", "x".repeat(32))]);
    expect((await planPosters(deps)).entries[0].kind).toBe("no-room");
  });
});

describe("applyPosters", () => {
  it("renders, uploads with the clip's audience, points the set -- and a second run finds nothing to do", async () => {
    const { deps, rows, bucket } = instance([filmed("s1", "c1"), filmed("s2", "c2", { athlete_id: "brandon" })]);
    const result = await applyPosters(await planPosters(deps), deps);
    expect(result).toMatchObject({ rendered: 2, pointed: 2, failed: 0 });
    expect(bucket.get("c2_poster")).toEqual(posterPermissions({ athleteId: "brandon" }));
    expect(rows.get("s1")!.video_poster_id).toBe("c1_poster");

    const again = await planPosters(deps);
    expect(again.entries).toEqual([]);
    expect(again.done).toBe(2);
  });

  it("carries on past a clip ffmpeg cannot read", async () => {
    const { deps, rows } = instance([filmed("s1", "broken1"), filmed("s2", "c2")]);
    const result = await applyPosters(await planPosters(deps), deps);
    expect(result).toMatchObject({ rendered: 1, pointed: 1, failed: 1 });
    expect(rows.get("s1")!.video_poster_id).toBeUndefined();
  });

  it("never points a set whose clip changed after the plan", async () => {
    const { deps, rows } = instance([filmed("s1", "c1")]);
    const plan = await planPosters(deps);
    rows.get("s1")!.video_file_id = "c9"; // re-filmed meanwhile
    const result = await applyPosters(plan, deps);
    expect(result.changed).toBe(1);
    expect(deps.pointSet).not.toHaveBeenCalled();
  });

  it("treats a poster that appeared meanwhile as done if it is the right stamp, and leaves it if not", async () => {
    const ok = instance([filmed("s1", "c1")]);
    const plan = await planPosters(ok.deps);
    ok.bucket.set("c1_poster", posterPermissions({ athleteId: "joey" }));
    expect(await applyPosters(plan, ok.deps)).toMatchObject({ pointed: 1, failed: 0 });

    const bad = instance([filmed("s1", "c1")]);
    const plan2 = await planPosters(bad.deps);
    bad.bucket.set("c1_poster", ['read("users")']);
    expect(await applyPosters(plan2, bad.deps)).toMatchObject({ pointed: 0, skipped: 1 });
  });

  it("does nothing with squatted or no-room entries", async () => {
    const { deps, writes } = instance([filmed("s1", "c1"), filmed("s2", "y".repeat(32))], { c1_poster: ['read("any")'] });
    expect(await applyPosters(await planPosters(deps), deps)).toMatchObject({ skipped: 2 });
    expect(writes).toEqual([]);
  });
});

describe("ffmpegArgs", () => {
  it("takes one frame at the seek point, scaled to a 320px longer edge", () => {
    const args = ffmpegArgs("/tmp/in.clip", "/tmp/out.jpg", 0.5);
    expect(args.slice(args.indexOf("-ss"), args.indexOf("-ss") + 2)).toEqual(["-ss", "0.5"]);
    expect(args.indexOf("-ss")).toBeLessThan(args.indexOf("-i"));
    expect(args).toContain("scale=320:320:force_original_aspect_ratio=decrease:force_divisible_by=2");
    expect(args.at(-1)).toBe("/tmp/out.jpg");
  });
});

describe("setPosterOnSet (the backfill's write)", () => {
  const writer = () => {
    const calls: unknown[] = [];
    const w: RowWriter = {
      createRow: async () => ({ $id: "" }),
      deleteRow: async () => ({}),
      updateRow: async (p) => {
        calls.push(p);
        return { $id: p.rowId };
      },
    };
    return { w, calls };
  };

  it("writes only the poster column, stamped like every set write", async () => {
    const { w, calls } = writer();
    await setPosterOnSet(w, "db", { rowId: "s1", athleteId: "joey", videoFileId: "c1", videoPosterId: "c1_poster" });
    expect(calls).toEqual([
      {
        databaseId: "db",
        tableId: "sets",
        rowId: "s1",
        data: { video_poster_id: "c1_poster" },
        permissions: setPermissions({ athleteId: "joey" }),
      },
    ]);
  });

  it("refuses a poster that is not the clip's own", async () => {
    const { w, calls } = writer();
    await expect(
      setPosterOnSet(w, "db", { rowId: "s1", athleteId: "joey", videoFileId: "c1", videoPosterId: "c2_poster" }),
    ).rejects.toThrow(/not the poster/);
    expect(calls).toEqual([]);
  });
});
