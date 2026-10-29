import { describe, expect, it } from "vitest";
import { proxyPermissions } from "../documents/policy";
import { PRUNE_AFTER_DAYS, clearForPrune, isTrustedProxyFile, type StoredProxy } from "./prune";

const NOW = new Date("2026-11-20T12:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
const stamp = (athleteId: string) => proxyPermissions({ athleteId });

const proxyFile = (over: Partial<StoredProxy> = {}): StoredProxy => ({
  $permissions: stamp("joey"),
  $createdAt: daysAgo(8),
  sizeOriginal: 20_000_000,
  chunksTotal: 4,
  chunksUploaded: 4,
  ...over,
});
const row = (over: Record<string, unknown> = {}) => ({
  $id: "s1",
  athlete_id: "joey",
  video_file_id: "clipA",
  video_proxy_id: "clipA_proxy",
  ...over,
});
const clear = (r: ReturnType<typeof row> | null, proxy: StoredProxy | null = proxyFile(), clipFileId = "clipA") =>
  clearForPrune({ row: r, clipFileId, proxy, permissionsFor: (id) => stamp(id), now: NOW });

describe("clearForPrune", () => {
  it("clears the original of a set playing a verified proxy at least seven days old", () => {
    expect(PRUNE_AFTER_DAYS).toBe(7);
    const result = clear(row());
    expect(result).toEqual({ ok: true, original: { bucketId: "set_videos", $id: "clipA", proxyId: "clipA_proxy", setId: "s1" } });
  });

  it("waits out the seven days", () => {
    expect(clear(row(), proxyFile({ $createdAt: daysAgo(6.9) }))).toMatchObject({ ok: false, tooYoung: true, reason: expect.stringMatching(/6 day/) });
    expect(clear(row(), proxyFile({ $createdAt: daysAgo(7) })).ok).toBe(true);
  });

  it("refuses when the set went, or names another clip, or does not play this proxy", () => {
    expect(clear(null)).toMatchObject({ ok: false, reason: "the set is gone" });
    expect(clear(row({ video_file_id: "clipB", video_proxy_id: "clipB_proxy" }))).toMatchObject({ ok: false });
    expect(clear(row({ video_proxy_id: null }))).toMatchObject({ ok: false, reason: expect.stringMatching(/does not play/) });
    // A stale pointer from before a replace is not this clip's proxy.
    expect(clear(row({ video_file_id: "clipA", video_proxy_id: "clipZ_proxy" })).ok).toBe(false);
  });

  it("refuses a proxy file that is missing, unfinished, empty, or stamped for anyone else", () => {
    expect(clear(row(), null).ok).toBe(false);
    expect(clear(row(), proxyFile({ chunksUploaded: 3 })).ok).toBe(false);
    expect(clear(row(), proxyFile({ sizeOriginal: 0 })).ok).toBe(false);
    expect(clear(row(), proxyFile({ $permissions: [...stamp("joey"), 'read("users")'] })).ok).toBe(false);
    expect(clear(row(), proxyFile({ $permissions: stamp("sam") })).ok).toBe(false);
  });

  it("refuses an undatable or future-dated proxy", () => {
    expect(clear(row(), proxyFile({ $createdAt: "not a date" })).ok).toBe(false);
    expect(clear(row(), proxyFile({ $createdAt: daysAgo(-1) })).ok).toBe(false);
  });
});

describe("isTrustedProxyFile", () => {
  it("compares the stamp as a set, not in order", () => {
    expect(isTrustedProxyFile(proxyFile({ $permissions: [...stamp("joey")].reverse() }), stamp("joey"))).toBe(true);
  });
});
