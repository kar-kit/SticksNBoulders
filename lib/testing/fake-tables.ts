/**
 * An in-memory Appwrite `tables` that APPLIES the queries it is sent.
 *
 * Store tests used to hand back a fixed list whatever was asked, so a store
 * could drop its athlete filter, flip its sort or lose a selected column and
 * stay green. This one filters, orders, pages and projects the way the server
 * does for the handful of query methods the stores use, and throws on any
 * other method rather than silently ignoring it -- a query the fake does not
 * understand is a query the test is not checking.
 *
 * Test-only. Nothing in the app imports it.
 */

export type FakeRow = { $id: string } & Record<string, unknown>;

interface ParsedQuery {
  method: string;
  attribute?: string;
  values?: unknown[];
}

export interface FakeCall {
  tableId: string;
  queries: ParsedQuery[];
}

/** Appwrite's default page size when no limit is sent. */
const DEFAULT_LIMIT = 25;

const compare = (a: unknown, b: unknown): number => {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  return (a as number | string) < (b as number | string) ? -1 : 1;
};

function matches(row: FakeRow, q: ParsedQuery): boolean {
  const value = row[q.attribute!];
  const operand = q.values?.[0];
  switch (q.method) {
    case "equal":
      return q.values!.includes(value);
    case "isNotNull":
      return value !== null && value !== undefined;
    case "isNull":
      return value === null || value === undefined;
    case "greaterThanEqual":
      return value !== null && value !== undefined && compare(value, operand) >= 0;
    case "lessThan":
      return value !== null && value !== undefined && compare(value, operand) < 0;
    default:
      throw new Error(`fake-tables: unsupported filter ${q.method}`);
  }
}

const FILTERS = new Set(["equal", "isNotNull", "isNull", "greaterThanEqual", "lessThan"]);
const CONTROL = new Set(["orderAsc", "orderDesc", "limit", "cursorAfter", "select"]);

export class FakeTables {
  readonly rows: Record<string, FakeRow[]> = {};
  readonly calls: FakeCall[] = [];

  seed(tableId: string, rows: FakeRow[]): this {
    (this.rows[tableId] ??= []).push(...rows);
    return this;
  }

  /** The queries one table was asked, newest call last. */
  callsTo(tableId: string): FakeCall[] {
    return this.calls.filter((c) => c.tableId === tableId);
  }

  listRows = async ({ tableId, queries = [] }: { tableId: string; queries?: string[] }) => {
    const parsed = queries.map((q) => JSON.parse(q) as ParsedQuery);
    this.calls.push({ tableId, queries: parsed });

    let rows = [...(this.rows[tableId] ?? [])];
    for (const q of parsed) {
      if (FILTERS.has(q.method)) rows = rows.filter((row) => matches(row, q));
      else if (!CONTROL.has(q.method)) throw new Error(`fake-tables: unsupported query ${q.method}`);
    }

    // Earlier orders win; $id breaks ties, as Appwrite's internal sequence does.
    const orders = parsed.filter((q) => q.method === "orderAsc" || q.method === "orderDesc");
    rows.sort((a, b) => {
      for (const o of orders) {
        const c = compare(a[o.attribute!], b[o.attribute!]);
        if (c !== 0) return o.method === "orderAsc" ? c : -c;
      }
      return compare(a.$id, b.$id);
    });

    const cursor = parsed.find((q) => q.method === "cursorAfter")?.values?.[0];
    if (cursor !== undefined) {
      const at = rows.findIndex((r) => r.$id === cursor);
      if (at < 0) throw new Error(`fake-tables: cursor ${String(cursor)} is not in the result`);
      rows = rows.slice(at + 1);
    }

    const limit = Number(parsed.find((q) => q.method === "limit")?.values?.[0] ?? DEFAULT_LIMIT);
    rows = rows.slice(0, limit);

    // System attributes ($id, $permissions) always come back; data columns
    // only if selected. A store that forgets to select a column it reads
    // gets undefined, as it would from the server.
    const select = parsed.find((q) => q.method === "select")?.values as string[] | undefined;
    const projected = select
      ? rows.map(
          (row) =>
            Object.fromEntries(
              Object.entries(row).filter(([key]) => key.startsWith("$") || select.includes(key)),
            ) as FakeRow,
        )
      : rows.map((row) => ({ ...row }));

    return { rows: projected, total: projected.length };
  };
}
