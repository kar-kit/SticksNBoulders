import type { Row } from "@/appwrite/documents/provenance";
import type { RowWriter } from "@/appwrite/documents/row-writer";
import type { WriteDeps } from "@/appwrite/documents/write";
import type { NotifyReader } from "./dispatch";

/**
 * In-memory tables for the push tests. Not a test file, so vitest never runs
 * it alone. The fake APPLIES its filters, because a fake that ignores them
 * passes whatever the code forgot to ask for.
 */
export function fakeTables(initial: Record<string, Row[]> = {}, files: Record<string, string> = {}) {
  const tables: Record<string, Row[]> = Object.fromEntries(Object.entries(initial).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  const writes: Array<{ op: string; tableId: string; rowId: string; data?: Record<string, unknown>; permissions?: string[] }> = [];
  const lists: Array<{ tableId: string; where: Record<string, unknown> }> = [];

  const writer: RowWriter = {
    async createRow({ tableId, rowId, data, permissions }) {
      writes.push({ op: "create", tableId, rowId, data, permissions });
      const row = { ...data, $id: rowId, $permissions: permissions ?? [] };
      (tables[tableId] ??= []).push(row);
      return row;
    },
    async updateRow({ tableId, rowId, data, permissions }) {
      writes.push({ op: "update", tableId, rowId, data, permissions });
      const row = (tables[tableId] ?? []).find((r) => r.$id === rowId);
      if (!row) throw Object.assign(new Error("row not found"), { code: 404 });
      Object.assign(row, data ?? {});
      if (permissions) row.$permissions = permissions;
      return { ...row, $id: rowId };
    },
    async deleteRow({ tableId, rowId }) {
      writes.push({ op: "delete", tableId, rowId });
      tables[tableId] = (tables[tableId] ?? []).filter((r) => r.$id !== rowId);
      return {};
    },
  };

  const reader: NotifyReader = {
    async listRows(tableId, where, limit) {
      lists.push({ tableId, where });
      return (tables[tableId] ?? [])
        .filter((row) =>
          Object.entries(where).every(([k, v]) => (typeof v === "string" ? row[k] === v : (v as readonly string[]).includes(row[k] as string))),
        )
        .slice(0, limit)
        .map((r) => ({ ...r }));
    },
    async getRow(tableId, rowId) {
      const row = (tables[tableId] ?? []).find((r) => r.$id === rowId);
      return row ? { ...row } : null;
    },
    async fileCreatedAt(_bucketId, fileId) {
      return files[fileId] ?? null;
    },
  };

  const write = (now: Date): WriteDeps => ({ writer, databaseId: "sticksnboulders", newId: () => "id", now: () => now });
  return { tables, writes, lists, writer, reader, write };
}
