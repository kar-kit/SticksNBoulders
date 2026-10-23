import type { Client } from "node-appwrite";

/**
 * The one Appwrite call v16 added, checked against the SDK's actual contract
 * rather than its types. node-appwrite 28 types `xdefault` as optional on
 * updateFloatColumn and then throws 'Missing required parameter: "xdefault"'
 * when it is undefined, so a driver that type-checks can still fail the first
 * live apply. No network: TablesDB is replaced, and what reaches it is the
 * assertion.
 */
const calls = vi.hoisted(() => ({ float: [] as unknown[], integer: [] as unknown[] }));

vi.mock("node-appwrite", () => ({
  TablesDB: class {
    async updateFloatColumn(params: Record<string, unknown>) {
      if (typeof params.xdefault === "undefined") throw new Error('Missing required parameter: "xdefault"');
      calls.float.push(params);
    }
    async updateIntegerColumn(params: Record<string, unknown>) {
      if (typeof params.xdefault === "undefined") throw new Error('Missing required parameter: "xdefault"');
      calls.integer.push(params);
    }
  },
  Storage: class {},
}));

const { createAppwriteDriver } = await import("./appwrite-driver");

describe("updateColumn", () => {
  beforeEach(() => {
    calls.float.length = 0;
    calls.integer.length = 0;
  });

  it("re-states sets.rpe with the new floor, and null for its absent default", async () => {
    const driver = createAppwriteDriver({} as Client);
    await driver.updateColumn("db", "sets", { key: "rpe", type: "float", required: false, min: 3, max: 10 });
    expect(calls.float).toEqual([
      { databaseId: "db", tableId: "sets", key: "rpe", required: false, xdefault: null, min: 3, max: 10 },
    ]);
  });

  it("keeps a declared default, and routes an integer column to the integer call", async () => {
    const driver = createAppwriteDriver({} as Client);
    await driver.updateColumn("db", "rollups", { key: "set_count", type: "integer", required: false, min: 0, default: 0 });
    expect(calls.integer).toEqual([
      { databaseId: "db", tableId: "rollups", key: "set_count", required: false, xdefault: 0, min: 0, max: undefined },
    ]);
    expect(calls.float).toEqual([]);
  });
});
