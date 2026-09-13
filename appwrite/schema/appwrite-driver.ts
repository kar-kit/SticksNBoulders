import { TablesDB, type Client } from "node-appwrite";
import type { SchemaDriver } from "./driver";
import type { CurrentState } from "./plan";
import type { ColumnSpec, IndexSpec, TableSpec } from "./types";

const INDEX_TYPE = { key: "key", unique: "unique", fulltext: "fulltext" } as const;

/** Appwrite builds columns in the background; this is how long we wait. */
const COLUMN_READY_TIMEOUT_MS = 30_000;
const COLUMN_POLL_MS = 400;

export function createAppwriteDriver(client: Client): SchemaDriver {
  const db = new TablesDB(client);

  return {
    async readState(databaseId) {
      const databases = await db.list();
      const databaseExists = databases.databases.some((d) => d.$id === databaseId);
      if (!databaseExists) return { databaseExists: false, tables: [] };

      const tables = await db.listTables({ databaseId });
      return {
        databaseExists: true,
        tables: tables.tables.map((t) => ({
          id: t.$id,
          permissions: t.$permissions ?? [],
          rowSecurity: Boolean(t.rowSecurity),
          columns: (t.columns ?? []).map((c: Record<string, unknown>) => ({
            key: String(c.key),
            type: String(c.type),
            required: Boolean(c.required),
            size: typeof c.size === "number" ? c.size : undefined,
            elements: Array.isArray(c.elements) ? (c.elements as string[]) : undefined,
            default: c.default,
          })),
          indexes: (t.indexes ?? []).map((i: Record<string, unknown>) => ({
            key: String(i.key),
            type: String(i.type),
            columns: (i.columns ?? i.attributes ?? []) as string[],
            orders: (i.orders ?? undefined) as (string | null)[] | undefined,
          })),
        })),
      } satisfies CurrentState;
    },

    async createDatabase(databaseId, name) {
      await db.create({ databaseId, name });
    },

    async createTable(databaseId, table: TableSpec) {
      await db.createTable({
        databaseId,
        tableId: table.id,
        name: table.name,
        permissions: [...table.permissions],
        rowSecurity: table.rowSecurity,
        enabled: true,
      });
    },

    async updateTable(databaseId, table: TableSpec) {
      await db.updateTable({
        databaseId,
        tableId: table.id,
        name: table.name,
        permissions: [...table.permissions],
        rowSecurity: table.rowSecurity,
        enabled: true,
      });
    },

    async createColumn(databaseId, tableId, column: ColumnSpec) {
      const base = { databaseId, tableId, key: column.key, required: column.required };
      switch (column.type) {
        case "string":
          await db.createStringColumn({ ...base, size: column.size, xdefault: column.default });
          return;
        case "enum":
          await db.createEnumColumn({
            ...base,
            elements: [...column.elements],
            xdefault: column.default,
          });
          return;
        case "boolean":
          await db.createBooleanColumn({ ...base, xdefault: column.default });
          return;
        case "integer":
          await db.createIntegerColumn({
            ...base,
            min: column.min,
            max: column.max,
            xdefault: column.default,
          });
          return;
        case "float":
          await db.createFloatColumn({
            ...base,
            min: column.min,
            max: column.max,
            xdefault: column.default,
          });
          return;
        case "datetime":
          await db.createDatetimeColumn({ ...base, xdefault: column.default });
          return;
      }
    },

    async createIndex(databaseId, tableId, index: IndexSpec) {
      await db.createIndex({
        databaseId,
        tableId,
        key: index.key,
        // The SDK types this as its own enum; the wire format is these strings.
        type: INDEX_TYPE[index.type] as never,
        columns: [...index.columns],
        orders: index.orders ? ([...index.orders] as never) : undefined,
      });
    },

    async deleteIndex(databaseId, tableId, key) {
      await db.deleteIndex({ databaseId, tableId, key });
    },

    async waitForColumns(databaseId, tableId, keys) {
      const deadline = Date.now() + COLUMN_READY_TIMEOUT_MS;
      const pending = new Set(keys);
      while (pending.size > 0) {
        const columns = await db.listColumns({ databaseId, tableId });
        for (const column of columns.columns as Array<Record<string, unknown>>) {
          if (!pending.has(String(column.key))) continue;
          const status = String(column.status);
          if (status === "available") pending.delete(String(column.key));
          if (status === "failed") {
            throw new Error(`Column ${tableId}.${String(column.key)} failed to build: ${String(column.error)}`);
          }
        }
        if (pending.size === 0) return;
        if (Date.now() > deadline) {
          throw new Error(
            `Columns still building after ${COLUMN_READY_TIMEOUT_MS}ms: ${[...pending].join(", ")}`,
          );
        }
        await new Promise((r) => setTimeout(r, COLUMN_POLL_MS));
      }
    },
  };
}
