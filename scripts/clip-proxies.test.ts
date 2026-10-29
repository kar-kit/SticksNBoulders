import { describe, expect, it, vi } from "vitest";
import { proxyPermissions } from "../appwrite/documents/policy";
import type { StoredProxy } from "../appwrite/backup/prune";
import {
  applyProxies,
  applyPrune,
  planPrune,
  planProxies,
  type MadeProxy,
  type ProxyWorkerDeps,
  type PruneDeps,
  type Row,
} from "./clip-proxies";

/**
 * The worker against an in-memory instance: sets, a proxy bucket, an original
 * bucket, and an ffmpeg that either makes a good proxy, a bad one, or throws.
 * Pinned: a dry run that writes, a second run that does work again, a
 * squatted file trusted, a failed verification uploaded, a replaced clip
 * overwritten, and an original pruned that something still needs.
 */
const NOW = new Date("2026-11-20T12:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
const stamp = (athleteId: string) => proxyPermissions({ athleteId });
const stored = (athleteId = "joey", over: Partial<StoredProxy> = {}): StoredProxy => ({
  $permissions: stamp(athleteId),
  $createdAt: daysAgo(0),
  sizeOriginal: 1000,
  chunksTotal: 1,
  chunksUploaded: 1,
  ...over,
});

function instance(sets: Row[], proxies: Record<string, StoredProxy> = {}, originals?: string[]) {
  const rows = new Map(sets.map((r) => [r.$id, { ...r }]));
  const bucket = new Map(Object.entries(proxies));
  const clips = new Set(originals ?? sets.map((s) => String(s.video_file_id)));
  const failures = new Map<string, string>();
  const writes: string[] = [];
  const discarded: string[] = [];
  const deps: ProxyWorkerDeps = {
    setsWithClips: async () => [...rows.values()].filter((r) => typeof r.video_file_id === "string").map((r) => ({ ...r })),
    getSet: async (id) => (rows.has(id) ? { ...rows.get(id)! } : null),
    proxyFile: async (id) => bucket.get(id) ?? null,
    makeProxy: vi.fn(async (clipId: string): Promise<MadeProxy | null> => {
      if (!clips.has(clipId)) return null;
      if (clipId.startsWith("hdr")) throw new Error("HDR source (arib-std-b67) needs ffmpeg's zscale (libzimg) filter");
      return { path: `/tmp/${clipId}.mp4`, size: 1000, mode: "encode", problems: clipId.startsWith("bad") ? ["moov is not before mdat (not faststart)"] : [] };
    }),
    verifyStoredProxy: vi.fn(async (clipId: string) => ({
      problems: clipId.startsWith("bad") ? ["codec is hevc, not h264"] : [],
      originalPresent: clips.has(clipId),
    })),
    uploadProxy: vi.fn(async (id: string, _made: MadeProxy, permissions: string[]) => {
      if (bucket.has(id)) throw Object.assign(new Error("exists"), { code: 409 });
      bucket.set(id, stored("joey", { $permissions: permissions }));
      writes.push(`upload ${id}`);
    }),
    deleteProxy: vi.fn(async (_clip: string, id: string) => {
      bucket.delete(id);
      writes.push(`delete ${id}`);
    }),
    discard: vi.fn(async (made: MadeProxy) => {
      discarded.push(made.path);
    }),
    pointSet: vi.fn(async ({ rowId, videoProxyId }) => {
      rows.get(rowId)!.video_proxy_id = videoProxyId;
      writes.push(`point ${rowId}`);
    }),
    permissionsFor: stamp,
    heldBack: (clipId) => failures.has(clipId),
    noteFailure: (clipId, reason) => failures.set(clipId, reason),
    noteSuccess: (clipId) => failures.delete(clipId),
    log: () => {},
  };
  return { deps, rows, bucket, clips, writes, discarded, failures };
}

const filmed = (id: string, clipId: string, over: Partial<Row> = {}): Row => ({
  $id: id,
  athlete_id: "joey",
  video_file_id: clipId,
  ...over,
});

describe("planProxies", () => {
  it("reads only: the dry run writes nothing and runs no ffmpeg", async () => {
    const { deps, writes } = instance([filmed("s1", "c1")]);
    const plan = await planProxies(deps);
    expect(plan.entries.map((e) => [e.rowId, e.kind, e.proxyId])).toEqual([["s1", "make", "c1_proxy"]]);
    expect(writes).toEqual([]);
    expect(deps.makeProxy).not.toHaveBeenCalled();
  });

  it("counts a set playing its proxy as done, and re-plans one whose proxy is a replaced clip's", async () => {
    const { deps } = instance([
      filmed("s1", "c1", { video_proxy_id: "c1_proxy" }),
      filmed("s2", "c2", { video_proxy_id: "c0_proxy" }),
    ]);
    const plan = await planProxies(deps);
    expect(plan.done).toBe(1);
    expect(plan.entries.map((e) => e.rowId)).toEqual(["s2"]);
  });

  it("points at a finished file only when it carries this athlete's exact stamp; redoes an unfinished one", async () => {
    const { deps } = instance([filmed("s1", "c1"), filmed("s2", "c2"), filmed("s3", "c3")], {
      c1_proxy: stored("joey"),
      c2_proxy: stored("joey", { $permissions: ['read("users")', 'delete("user:stranger")'] }),
      c3_proxy: stored("joey", { chunksUploaded: 0, chunksTotal: 5 }),
    });
    const plan = await planProxies(deps);
    expect(plan.entries.map((e) => [e.rowId, e.kind])).toEqual([
      ["s1", "point"],
      ["s2", "squatted"],
      ["s3", "redo"],
    ]);
  });

  it("leaves a clip id too long for a proxy id, and holds back a clip that failed recently", async () => {
    const { deps, failures } = instance([filmed("s1", "x".repeat(31)), filmed("s2", "c2")]);
    failures.set("c2", "HDR");
    const plan = await planProxies(deps);
    expect(plan.entries.map((e) => [e.rowId, e.kind])).toEqual([
      ["s1", "no-room"],
      ["s2", "held-back"],
    ]);
  });
});

describe("applyProxies", () => {
  it("makes, uploads with the athlete's stamp, points, cleans up the local file, and a second run has nothing to do", async () => {
    const { deps, bucket, rows, writes, discarded } = instance([filmed("s1", "c1")]);
    const result = await applyProxies(await planProxies(deps), deps);
    expect(result).toMatchObject({ made: 1, pointed: 1, failed: 0, rejected: 0 });
    expect(writes).toEqual(["upload c1_proxy", "point s1"]);
    expect(bucket.get("c1_proxy")!.$permissions).toEqual(stamp("joey"));
    expect(rows.get("s1")!.video_proxy_id).toBe("c1_proxy");
    expect(discarded).toEqual(["/tmp/c1.mp4"]);

    const again = await planProxies(deps);
    expect(again.entries).toEqual([]);
    expect(again.done).toBe(1);
  });

  it("never uploads a proxy that failed verification, leaves the set on its original, and holds the clip back", async () => {
    const { deps, rows, writes, discarded, failures } = instance([filmed("s1", "bad1")]);
    const result = await applyProxies(await planProxies(deps), deps);
    expect(result).toMatchObject({ rejected: 1, made: 0, pointed: 0 });
    expect(writes).toEqual([]);
    expect(rows.get("s1")!.video_proxy_id).toBeUndefined();
    expect(discarded).toEqual(["/tmp/bad1.mp4"]);
    expect(failures.get("bad1")).toMatch(/faststart/);
  });

  it("verifies a stored proxy before pointing at it, and deletes one that fails while the original remains", async () => {
    const { deps, bucket, rows } = instance([filmed("s1", "c1"), filmed("s2", "bad2")], {
      c1_proxy: stored("joey"),
      bad2_proxy: stored("joey"),
    });
    const result = await applyProxies(await planProxies(deps), deps);
    expect(result).toMatchObject({ pointed: 1, rejected: 1, made: 0 });
    expect(deps.makeProxy).not.toHaveBeenCalled();
    expect(rows.get("s1")!.video_proxy_id).toBe("c1_proxy");
    expect(bucket.has("bad2_proxy")).toBe(false);
    expect(rows.get("s2")!.video_proxy_id).toBeUndefined();
  });

  it("never deletes a failing stored proxy that is the last copy", async () => {
    const { deps, bucket } = instance([filmed("s1", "bad1")], { bad1_proxy: stored("joey") }, []);
    const result = await applyProxies(await planProxies(deps), deps);
    expect(result.rejected).toBe(1);
    expect(bucket.has("bad1_proxy")).toBe(true);
  });

  it("deletes the worker's own unfinished upload and makes it again", async () => {
    const { deps, writes } = instance([filmed("s1", "c1")], { c1_proxy: stored("joey", { chunksUploaded: 2, chunksTotal: 5 }) });
    const result = await applyProxies(await planProxies(deps), deps);
    expect(result).toMatchObject({ made: 1, pointed: 1 });
    expect(writes).toEqual(["delete c1_proxy", "upload c1_proxy", "point s1"]);
  });

  it("does not upload when the clip was replaced while the proxy was being made", async () => {
    const { deps, rows, writes } = instance([filmed("s1", "c1")]);
    const plan = await planProxies(deps);
    deps.makeProxy = vi.fn(async (clipId: string) => {
      rows.get("s1")!.video_file_id = "c2"; // the athlete replaced it mid-encode
      return { path: `/tmp/${clipId}.mp4`, size: 1000, mode: "encode" as const, problems: [] };
    });
    const result = await applyProxies(plan, deps);
    expect(result).toMatchObject({ changed: 1, made: 0, pointed: 0 });
    expect(writes).toEqual([]);
    expect(rows.get("s1")!.video_file_id).toBe("c2");
  });

  it("does not point when the clip changed after the upload; the uploaded file is the sweep's", async () => {
    const { deps, rows, writes } = instance([filmed("s1", "c1")]);
    const plan = await planProxies(deps);
    const upload = deps.uploadProxy;
    deps.uploadProxy = vi.fn(async (...args: Parameters<ProxyWorkerDeps["uploadProxy"]>) => {
      await upload(...args);
      rows.get("s1")!.video_file_id = "c2";
    });
    const result = await applyProxies(plan, deps);
    expect(result).toMatchObject({ made: 1, changed: 1, pointed: 0 });
    expect(writes).toEqual(["upload c1_proxy"]);
    expect(rows.get("s1")!.video_proxy_id).toBeUndefined();
  });

  it("on a 409 from a racing run, points only if the file it finds is trusted", async () => {
    const good = instance([filmed("s1", "c1")]);
    const plan = await planProxies(good.deps);
    good.bucket.set("c1_proxy", stored("joey"));
    expect(await applyProxies(plan, good.deps)).toMatchObject({ pointed: 1, made: 0 });

    const bad = instance([filmed("s1", "c1")]);
    const plan2 = await planProxies(bad.deps);
    bad.bucket.set("c1_proxy", stored("joey", { $permissions: ['read("users")'] }));
    expect(await applyProxies(plan2, bad.deps)).toMatchObject({ pointed: 0, skipped: 1 });
  });

  it("reports an HDR clip this ffmpeg cannot tone-map as a failure, holds it back, and carries on", async () => {
    const { deps, rows, failures } = instance([filmed("s1", "hdr1"), filmed("s2", "c2")]);
    const log: string[] = [];
    deps.log = (line) => log.push(line);
    const result = await applyProxies(await planProxies(deps), deps);
    expect(result).toMatchObject({ failed: 1, pointed: 1 });
    expect(log.join("\n")).toMatch(/hdr1|s1.*zscale/);
    expect(failures.get("hdr1")).toMatch(/zscale/);
    expect(rows.get("s1")!.video_proxy_id).toBeUndefined();
    expect((await planProxies(deps)).entries.map((e) => e.kind)).toEqual(["held-back"]);
  });

  it("counts a set whose original is not in the bucket as missing", async () => {
    const { deps } = instance([filmed("s1", "c1")], {}, []);
    expect(await applyProxies(await planProxies(deps), deps)).toMatchObject({ missing: 1, failed: 0 });
  });
});

describe("prune", () => {
  function pruneInstance(sets: Row[], proxies: Record<string, StoredProxy>, originals: string[]) {
    const rows = new Map(sets.map((r) => [r.$id, { ...r }]));
    const clips = new Set(originals);
    const deleted: string[] = [];
    const deps: PruneDeps = {
      setsWithClips: async () => [...rows.values()].map((r) => ({ ...r })),
      getSet: async (id) => (rows.has(id) ? { ...rows.get(id)! } : null),
      proxyFile: async (id) => proxies[id] ?? null,
      originalExists: async (id) => clips.has(id),
      deleteOriginal: vi.fn(async (original) => {
        clips.delete(original.$id);
        deleted.push(`${original.bucketId}/${original.$id}`);
      }),
      permissionsFor: stamp,
      now: () => NOW,
      log: () => {},
    };
    return { deps, rows, clips, deleted };
  }
  const old = stored("joey", { $createdAt: daysAgo(10) });

  it("plans: only verified proxies a week old are pruned; everything else says why it is kept", async () => {
    const { deps, deleted } = pruneInstance(
      [
        filmed("s1", "c1", { video_proxy_id: "c1_proxy" }),
        filmed("s2", "c2", { video_proxy_id: "c2_proxy" }),
        filmed("s3", "c3", { video_proxy_id: "c3_proxy" }),
        filmed("s4", "c4"),
        filmed("s5", "c5", { video_proxy_id: "c5_proxy" }),
      ],
      { c1_proxy: old, c2_proxy: stored("joey", { $createdAt: daysAgo(3) }), c3_proxy: stored("sam", { $createdAt: daysAgo(10) }), c5_proxy: old },
      ["c1", "c2", "c3", "c4"],
    );
    const plan = await planPrune(deps);
    expect(plan.entries.map((e) => [e.rowId, e.kind])).toEqual([
      ["s1", "prune"],
      ["s2", "too-young"],
      ["s3", "untrusted"],
      ["s5", "gone"],
    ]);
    expect(plan.unproxied).toBe(1);
    expect(deleted).toEqual([]);
  });

  it("keeps an original another set still plays", async () => {
    const { deps } = pruneInstance(
      [filmed("s1", "c1", { video_proxy_id: "c1_proxy" }), filmed("s2", "c1")],
      { c1_proxy: old },
      ["c1"],
    );
    expect((await planPrune(deps)).entries.map((e) => e.kind)).toEqual(["shared"]);
  });

  it("re-checks each set immediately before deleting, and keeps one whose clip changed since the plan", async () => {
    const { deps, rows, deleted } = pruneInstance(
      [filmed("s1", "c1", { video_proxy_id: "c1_proxy" }), filmed("s2", "c2", { video_proxy_id: "c2_proxy" })],
      { c1_proxy: old, c2_proxy: old },
      ["c1", "c2"],
    );
    const plan = await planPrune(deps);
    rows.get("s2")!.video_file_id = "c9"; // replaced between plan and delete
    const result = await applyPrune(plan, deps);
    expect(result).toEqual({ deleted: 1, changed: 1, gone: 0, failed: 0 });
    expect(deleted).toEqual(["set_videos/c1"]);
  });

  it("treats an original already deleted as done", async () => {
    const { deps } = pruneInstance([filmed("s1", "c1", { video_proxy_id: "c1_proxy" })], { c1_proxy: old }, ["c1"]);
    const plan = await planPrune(deps);
    deps.deleteOriginal = vi.fn(async () => {
      throw Object.assign(new Error("gone"), { code: 404 });
    });
    expect(await applyPrune(plan, deps)).toEqual({ deleted: 0, changed: 0, gone: 1, failed: 0 });
  });
});
