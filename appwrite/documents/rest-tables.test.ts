import { Query } from "node-appwrite";
import { restQuery, restTables } from "./rest-tables";

/**
 * The notify Function's routes, pinned: a hand-written route is how
 * validate-row once called one 1.9.6 does not have (docs/appwrite-events.md).
 */

const config = { endpoint: "http://appwrite/v1", project: "p", key: "k", databaseId: "sticksnboulders" };

function withFetch(response: () => Response) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchMock = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return response();
  }) as unknown as typeof fetch;
  return { calls, tables: restTables({ ...config, fetch: fetchMock }) };
}

describe("restQuery", () => {
  it("spells each filter exactly as the SDK's Query does", () => {
    const params = new URLSearchParams(restQuery({ user_id: ["a", "b"], status: "active" }, 25));
    expect(params.get("queries[0]")).toBe(Query.equal("user_id", ["a", "b"]));
    expect(params.get("queries[1]")).toBe(Query.equal("status", "active"));
    expect(params.get("queries[2]")).toBe(Query.limit(25));
  });
});

describe("restTables", () => {
  it("lists on the TablesDB route, with the key", async () => {
    const t = withFetch(() => Response.json({ rows: [{ $id: "r1" }, null] }));
    expect(await t.tables.listRows("push_subscriptions", { user_id: "c" }, 10)).toEqual([{ $id: "r1" }]);
    expect(t.calls[0].url.startsWith("http://appwrite/v1/tablesdb/sticksnboulders/tables/push_subscriptions/rows?")).toBe(true);
    expect(t.calls[0].init.headers).toMatchObject({ "x-appwrite-project": "p", "x-appwrite-key": "k" });
  });

  it("reads a missing row as null, and any other failure as an error", async () => {
    const missing = withFetch(() => Response.json({ type: "row_not_found" }, { status: 404 }));
    expect(await missing.tables.getRow("profiles", "a")).toBeNull();
    const wrongRoute = withFetch(() => Response.json({ type: "general_route_not_found" }, { status: 404 }));
    await expect(wrongRoute.tables.getRow("profiles", "a")).rejects.toThrow(/404/);
  });

  it("deletes on the TablesDB route and takes an already-gone row as done", async () => {
    const t = withFetch(() => Response.json({ type: "row_not_found" }, { status: 404 }));
    await t.tables.writer.deleteRow({ databaseId: "sticksnboulders", tableId: "push_subscriptions", rowId: "push_1" });
    expect(t.calls[0]).toMatchObject({
      url: "http://appwrite/v1/tablesdb/sticksnboulders/tables/push_subscriptions/rows/push_1",
      init: { method: "DELETE" },
    });
  });

  it("updates with data and permissions in the body", async () => {
    const t = withFetch(() => Response.json({ $id: "push_1" }));
    await t.tables.writer.updateRow({
      databaseId: "sticksnboulders",
      tableId: "push_subscriptions",
      rowId: "push_1",
      data: { last_success_at: "2026-11-04T12:00:00.000Z" },
      permissions: ['read("user:c")'],
    });
    expect(t.calls[0].init.method).toBe("PATCH");
    expect(JSON.parse(String(t.calls[0].init.body))).toEqual({
      data: { last_success_at: "2026-11-04T12:00:00.000Z" },
      permissions: ['read("user:c")'],
    });
  });

  it("refuses to create: nothing that uses it should", async () => {
    const t = withFetch(() => Response.json({}));
    await expect(t.tables.writer.createRow({ databaseId: "d", tableId: "t", rowId: "r", data: {} })).rejects.toThrow();
    expect(t.calls).toEqual([]);
  });

  it("reads a clip's creation time off Storage, and null when it cannot", async () => {
    const t = withFetch(() => Response.json({ $createdAt: "2026-11-04T11:59:40.000Z" }));
    expect(await t.tables.fileCreatedAt("set_videos", "file1")).toBe("2026-11-04T11:59:40.000Z");
    expect(t.calls[0].url).toBe("http://appwrite/v1/storage/buckets/set_videos/files/file1");
    const denied = withFetch(() => new Response("", { status: 401 }));
    expect(await denied.tables.fileCreatedAt("set_videos", "file1")).toBeNull();
  });
});
