import type { Row } from "./provenance";
import type { RowWriter } from "./row-writer";

/**
 * TablesDB and Storage over plain fetch, for a Function (F27).
 *
 * A Function runs with a per-execution key and no SDK: bundling node-appwrite
 * to make a handful of calls would be most of the deployment, the reason
 * validate-row has none either. The cost is hand-written routes, which is how
 * validate-row once called one that did not exist (6 Oct 2026), so: every
 * route here is `/tablesdb/...` or `/storage/...`, and rest-tables.test.ts
 * pins the query spelling against the SDK's own `Query`.
 *
 * Writes go through RowWriter, so a Function that uses this still writes
 * only through the helper in write.ts.
 */

export interface RestConfig {
  endpoint: string;
  project: string;
  key: string;
  databaseId: string;
  fetch?: typeof fetch;
}

const enc = encodeURIComponent;

/** `queries[i]=<json>`, as the SDK sends a GET. */
export function restQuery(where: Readonly<Record<string, string | readonly string[]>>, limit: number): string {
  const params = new URLSearchParams();
  let i = 0;
  for (const [attribute, value] of Object.entries(where)) {
    const values = typeof value === "string" ? [value] : [...value];
    params.append(`queries[${i++}]`, JSON.stringify({ method: "equal", attribute, values }));
  }
  params.append(`queries[${i}]`, JSON.stringify({ method: "limit", values: [limit] }));
  return params.toString();
}

/** Appwrite's error type for a missing row or file. */
const isNotFound = async (response: Response): Promise<boolean> => {
  if (response.status !== 404) return false;
  try {
    const type = ((await response.clone().json()) as { type?: unknown }).type;
    return type === "row_not_found" || type === "document_not_found" || type === "storage_file_not_found";
  } catch {
    return false;
  }
};

export function restTables(config: RestConfig) {
  const f = config.fetch ?? fetch;
  const headers = { "x-appwrite-project": config.project, "x-appwrite-key": config.key };
  const rows = (tableId: string) => `${config.endpoint}/tablesdb/${enc(config.databaseId)}/tables/${enc(tableId)}/rows`;

  const fail = async (what: string, response: Response) =>
    new Error(`${what}: ${response.status} ${(await response.text()).slice(0, 200)}`);

  const writer: RowWriter = {
    async createRow() {
      // Nothing a Function does with this creates a row. Refusing beats a
      // half-tested path that does.
      throw new Error("rest-tables: createRow is not supported");
    },
    async updateRow({ tableId, rowId, data, permissions }) {
      const response = await f(`${rows(tableId)}/${enc(rowId)}`, {
        method: "PATCH",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ data: data ?? {}, ...(permissions ? { permissions } : {}) }),
      });
      if (!response.ok) throw await fail(`update ${tableId}/${rowId}`, response);
      return (await response.json()) as { $id: string } & Record<string, unknown>;
    },
    async deleteRow({ tableId, rowId }) {
      const response = await f(`${rows(tableId)}/${enc(rowId)}`, { method: "DELETE", headers });
      // Gone already is gone: two executions for one event both try.
      if (response.ok || (await isNotFound(response))) return {};
      throw await fail(`delete ${tableId}/${rowId}`, response);
    },
  };

  return {
    writer,
    async listRows(tableId: string, where: Readonly<Record<string, string | readonly string[]>>, limit: number) {
      const response = await f(`${rows(tableId)}?${restQuery(where, limit)}`, { method: "GET", headers });
      if (!response.ok) throw await fail(`list ${tableId}`, response);
      const page = (await response.json()) as { rows?: unknown };
      return (Array.isArray(page.rows) ? page.rows : []).filter((r): r is Row => Boolean(r) && typeof r === "object");
    },
    async getRow(tableId: string, rowId: string): Promise<Row | null> {
      const response = await f(`${rows(tableId)}/${enc(rowId)}`, { method: "GET", headers });
      if (response.ok) return (await response.json()) as Row;
      if (await isNotFound(response)) return null;
      throw await fail(`get ${tableId}/${rowId}`, response);
    },
    async fileCreatedAt(bucketId: string, fileId: string): Promise<string | null> {
      const response = await f(`${config.endpoint}/storage/buckets/${enc(bucketId)}/files/${enc(fileId)}`, {
        method: "GET",
        headers,
      });
      if (!response.ok) return null;
      const file = (await response.json()) as { $createdAt?: unknown };
      return typeof file.$createdAt === "string" ? file.$createdAt : null;
    },
  };
}
