import type { SchemaDriver } from "./driver";
import { applySchema } from "./execute";
import type { CurrentState } from "./plan";
import { schema } from "./index";
import type { ColumnSpec, DatabaseSpec, IndexSpec, TableSpec } from "./types";

/**
 * An in-memory Appwrite. It records what it was asked to do and reports state
 * back the way the real server does -- float becomes "double", a single-column
 * index reports empty orders -- so "apply twice, second run is a no-op" means
 * something rather than restating the planner's own output.
 */
function fakeDriver() {
  const calls: string[] = [];
  const state: CurrentState = { databaseExists: false, tables: [] };

  const APPWRITE_TYPE: Record<ColumnSpec["type"], string> = {
    string: "string",
    enum: "string",
    boolean: "boolean",
    integer: "integer",
    float: "double",
    datetime: "datetime",
  };

  const find = (tableId: string) => {
    const t = state.tables.find((x) => x.id === tableId);
    if (!t) throw new Error(`fake: no table ${tableId}`);
    return t;
  };

  const driver: SchemaDriver = {
    async readState() {
      return structuredClone(state);
    },
    async createDatabase(databaseId) {
      calls.push(`createDatabase:${databaseId}`);
      state.databaseExists = true;
    },
    async createTable(_db, table: TableSpec) {
      calls.push(`createTable:${table.id}`);
      state.tables.push({
        id: table.id,
        permissions: [...table.permissions],
        rowSecurity: table.rowSecurity,
        columns: [],
        indexes: [],
      });
    },
    async updateTable(_db, table: TableSpec) {
      calls.push(`updateTable:${table.id}`);
      const t = find(table.id);
      t.permissions = [...table.permissions];
      t.rowSecurity = table.rowSecurity;
    },
    async createColumn(_db, tableId, column: ColumnSpec) {
      calls.push(`createColumn:${tableId}.${column.key}`);
      find(tableId).columns.push({
        key: column.key,
        type: APPWRITE_TYPE[column.type],
        required: column.required,
        size: column.type === "string" ? column.size : undefined,
        elements: column.type === "enum" ? [...column.elements] : undefined,
      });
    },
    async createIndex(_db, tableId, index: IndexSpec) {
      calls.push(`createIndex:${tableId}.${index.key}`);
      find(tableId).indexes.push({
        key: index.key,
        type: index.type,
        columns: [...index.columns],
        // The real server reports [] unless orders were given explicitly.
        orders: index.orders ? [...index.orders] : [],
      });
    },
    async deleteIndex(_db, tableId, key) {
      calls.push(`deleteIndex:${tableId}.${key}`);
      const t = find(tableId);
      t.indexes = t.indexes.filter((i) => i.key !== key);
    },
    async waitForColumns(_db, tableId, keys) {
      calls.push(`waitForColumns:${tableId}:${keys.length}`);
    },
  };

  return { driver, calls, state };
}

describe("applySchema idempotency", () => {
  it("builds the whole schema on a clean instance, then changes nothing on a second run", async () => {
    // This is the property the setup script promises: safe to re-run.
    const { driver, calls } = fakeDriver();

    const first = await applySchema(driver, schema);
    expect(first.noop).toBe(false);
    expect(first.applied.length).toBeGreaterThan(0);

    const countAfterFirst = calls.length;
    const second = await applySchema(driver, schema);

    expect(second.noop).toBe(true);
    expect(second.applied).toEqual([]);
    expect(calls.length, "second run wrote to the server").toBe(countAfterFirst);
  });

  it("is still a no-op on a third run", async () => {
    const { driver } = fakeDriver();
    await applySchema(driver, schema);
    await applySchema(driver, schema);
    expect((await applySchema(driver, schema)).noop).toBe(true);
  });

  it("creates every table, column and index the schema declares", async () => {
    const { driver, calls } = fakeDriver();
    await applySchema(driver, schema);

    for (const table of schema.tables) {
      expect(calls, table.id).toContain(`createTable:${table.id}`);
      for (const column of table.columns) {
        expect(calls).toContain(`createColumn:${table.id}.${column.key}`);
      }
      for (const index of table.indexes) {
        expect(calls).toContain(`createIndex:${table.id}.${index.key}`);
      }
    }
  });

  it("waits for a table's columns before building its indexes", async () => {
    // Appwrite builds columns asynchronously; an index created too early fails.
    const { driver, calls } = fakeDriver();
    await applySchema(driver, schema);

    const firstIndex = calls.findIndex((c) => c.startsWith("createIndex:sets."));
    const wait = calls.findIndex((c) => c.startsWith("waitForColumns:sets"));
    expect(wait).toBeGreaterThanOrEqual(0);
    expect(wait).toBeLessThan(firstIndex);
  });

  it("resumes cleanly after a half-finished run", async () => {
    // The first live apply died partway on a rejected column. Re-running has
    // to finish the job rather than trip over what already exists.
    const { driver, calls } = fakeDriver();
    const partial: DatabaseSpec = { ...schema, tables: schema.tables.slice(0, 2) };
    await applySchema(driver, partial);
    calls.length = 0;

    const rest = await applySchema(driver, schema);
    expect(rest.noop).toBe(false);
    expect(calls.filter((c) => c.startsWith("createTable:"))).toHaveLength(schema.tables.length - 2);
    expect(calls).not.toContain(`createTable:${schema.tables[0].id}`);
    expect((await applySchema(driver, schema)).noop).toBe(true);
  });
});

describe("applySchema dry run", () => {
  it("writes nothing to the server", async () => {
    const { driver, calls } = fakeDriver();
    const result = await applySchema(driver, schema, { dryRun: true });
    expect(result.applied).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("reports the schema as already-matching only when it is", async () => {
    const { driver } = fakeDriver();
    expect((await applySchema(driver, schema, { dryRun: true })).noop).toBe(false);
    await applySchema(driver, schema);
    expect((await applySchema(driver, schema, { dryRun: true })).noop).toBe(true);
  });
});

describe("applySchema repairs drift", () => {
  it("restores row security that was switched off in the console", async () => {
    const { driver, calls, state } = fakeDriver();
    await applySchema(driver, schema);
    state.tables[0].rowSecurity = false;
    calls.length = 0;

    await applySchema(driver, schema);
    expect(calls).toContain(`updateTable:${schema.tables[0].id}`);
    expect((await applySchema(driver, schema)).noop).toBe(true);
  });

  it("rebuilds an index by deleting it first", async () => {
    const { driver, calls, state } = fakeDriver();
    await applySchema(driver, schema);
    const target = state.tables.find((t) => t.id === "sets")!;
    target.indexes[0].columns = ["session_id"];
    calls.length = 0;

    await applySchema(driver, schema);
    const key = schema.tables.find((t) => t.id === "sets")!.indexes[0].key;
    expect(calls.indexOf(`deleteIndex:sets.${key}`)).toBeLessThan(calls.indexOf(`createIndex:sets.${key}`));
  });

  it("reports an orphan without deleting it, and stays a no-op afterwards", async () => {
    const { driver, state } = fakeDriver();
    await applySchema(driver, schema);
    state.tables.push({ id: "leaderboards", permissions: [], rowSecurity: false, columns: [], indexes: [] });

    const result = await applySchema(driver, schema);
    expect(result.reported).toContainEqual({ kind: "orphan-table", tableId: "leaderboards" });
    expect(result.noop).toBe(true);
    expect(state.tables.some((t) => t.id === "leaderboards")).toBe(true);
  });
});
