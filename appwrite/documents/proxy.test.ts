import { describe, expect, it } from "vitest";
import { proxyPermissions, setPermissions, videoPermissions } from "./policy";
import { PROXY_BUCKET, proxyIdFor, proxyOf } from "./proxy";
import { setProxyOnSet } from "./proxy-admin";
import { POSTER_BUCKET, posterIdFor } from "./poster";
import type { RowWriter } from "./row-writer";

describe("proxyIdFor", () => {
  it("derives the proxy id from the clip id, so every path that knows a clip knows its proxy", () => {
    expect(proxyIdFor("6710abcdef0123456789")).toBe("6710abcdef0123456789_proxy");
  });

  it("never collides with the poster id or lives in the poster bucket", () => {
    expect(proxyIdFor("clip1")).not.toBe(posterIdFor("clip1"));
    expect(PROXY_BUCKET).not.toBe(POSTER_BUCKET);
  });

  it("returns null for nothing, a blank, or an id with no room left under Appwrite's 36", () => {
    expect(proxyIdFor(null)).toBeNull();
    expect(proxyIdFor("  ")).toBeNull();
    expect(proxyIdFor(42)).toBeNull();
    expect(proxyIdFor("x".repeat(30))).toBe(`${"x".repeat(30)}_proxy`);
    expect(proxyIdFor("x".repeat(31))).toBeNull();
  });
});

describe("proxyOf", () => {
  it("accepts only the proxy of the row's own clip", () => {
    expect(proxyOf({ video_file_id: "c1", video_proxy_id: "c1_proxy" })).toBe("c1_proxy");
  });

  it("reads a proxy left over from a replaced clip as none, so the new take plays", () => {
    expect(proxyOf({ video_file_id: "c2", video_proxy_id: "c1_proxy" })).toBeNull();
  });

  it("reads absent, blank, a detached clip, and a non-string as none", () => {
    expect(proxyOf({ video_file_id: "c1" })).toBeNull();
    expect(proxyOf({ video_file_id: "c1", video_proxy_id: "" })).toBeNull();
    expect(proxyOf({ video_file_id: null, video_proxy_id: "c1_proxy" })).toBeNull();
    expect(proxyOf({ video_file_id: "c1", video_proxy_id: 7 })).toBeNull();
  });
});

describe("proxy permissions mirror the clip's exactly", () => {
  it.each(["athlete_joey", "someone_else"])("for %s", (athleteId) => {
    expect(proxyPermissions({ athleteId })).toEqual(videoPermissions({ athleteId }));
  });

  it("grant no update, no read to every signed-in user, and delete to the athlete only", () => {
    const stamp = proxyPermissions({ athleteId: "athlete_joey" }).join(" ");
    expect(stamp).not.toContain("update(");
    expect(stamp).not.toContain('read("users")');
    expect(stamp).toContain('delete("user:athlete_joey")');
    expect(stamp.match(/delete\(/g)).toHaveLength(1);
  });
});

describe("setProxyOnSet", () => {
  const writer = () => {
    const calls: Parameters<RowWriter["updateRow"]>[0][] = [];
    const w: RowWriter = {
      createRow: () => Promise.reject(new Error("no")),
      deleteRow: () => Promise.reject(new Error("no")),
      updateRow: async (params) => {
        calls.push(params);
        return {} as Awaited<ReturnType<RowWriter["updateRow"]>>;
      },
    };
    return { w, calls };
  };

  it("writes only the proxy column, stamped like every set write", async () => {
    const { w, calls } = writer();
    await setProxyOnSet(w, "db", { rowId: "s1", athleteId: "joey", videoFileId: "c1", videoProxyId: "c1_proxy" });
    expect(calls).toEqual([
      {
        databaseId: "db",
        tableId: "sets",
        rowId: "s1",
        data: { video_proxy_id: "c1_proxy" },
        permissions: setPermissions({ athleteId: "joey" }),
      },
    ]);
  });

  it("refuses a proxy that is not this clip's, and a row without its athlete, before writing", async () => {
    const { w, calls } = writer();
    await expect(
      setProxyOnSet(w, "db", { rowId: "s1", athleteId: "joey", videoFileId: "c2", videoProxyId: "c1_proxy" }),
    ).rejects.toThrow(/not the proxy/);
    await expect(
      setProxyOnSet(w, "db", { rowId: "s1", athleteId: "", videoFileId: "c1", videoProxyId: "c1_proxy" }),
    ).rejects.toThrow(/required/);
    expect(calls).toEqual([]);
  });
});
