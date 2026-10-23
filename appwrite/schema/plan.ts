import type { BucketSpec, ColumnSpec, DatabaseSpec, IndexSpec, TableSpec } from "./types";

/**
 * Diffing the schema is pure. The executor talks to Appwrite; this decides what
 * should happen, which is why idempotency can be proven in a unit test instead
 * of hoped for against a live instance.
 */

export interface CurrentColumn {
  key: string;
  type: string;
  required: boolean;
  size?: number;
  elements?: string[];
  default?: unknown;
  /**
   * Bounds of an integer or float column, as the server reports them.
   * Appwrite reports a bound the column was created without as the type's
   * own extreme (about +/-1.8e308 for a float), so a bound the schema does
   * not declare is never compared -- see `boundsChange`.
   */
  min?: number;
  max?: number;
}

export interface CurrentIndex {
  key: string;
  type: string;
  columns: string[];
  orders?: (string | null)[];
}

export interface CurrentTable {
  id: string;
  permissions: string[];
  rowSecurity: boolean;
  columns: CurrentColumn[];
  indexes: CurrentIndex[];
}

export interface CurrentBucket {
  id: string;
  permissions: string[];
  fileSecurity: boolean;
  maximumFileSizeBytes: number;
  allowedFileExtensions: string[];
  compression: string;
  encryption: boolean;
  antivirus: boolean;
}

export interface CurrentState {
  databaseExists: boolean;
  tables: CurrentTable[];
  buckets: CurrentBucket[];
}

export type Action =
  | { kind: "create-database"; databaseId: string; name: string }
  | { kind: "create-table"; table: TableSpec }
  | { kind: "update-table"; table: TableSpec; reason: string }
  | { kind: "create-column"; tableId: string; column: ColumnSpec }
  | { kind: "create-index"; tableId: string; index: IndexSpec }
  | { kind: "recreate-index"; tableId: string; index: IndexSpec; reason: string }
  /**
   * Never auto-applied. Changing a column's type or width can silently truncate
   * an athlete's logged work, so a mismatch is reported and a human decides.
   */
  | { kind: "manual-column-change"; tableId: string; column: ColumnSpec; reason: string }
  /**
   * A numeric column's bounds, widened in place. Auto-applied, unlike every
   * other column change, because it is the one that cannot touch a stored
   * value: every row already inside the old range is inside the new one, and
   * Appwrite validates bounds on write, never by rewriting rows. Narrowing is
   * the opposite -- rows can sit outside the new range and fail their next
   * update -- so it stays a `manual-column-change`. First used by v16, which
   * lowered sets.rpe's floor from 6 to 3 (F10).
   */
  | { kind: "update-column"; tableId: string; column: NumericColumnSpec; reason: string }
  /** Something exists on the server that the schema does not describe. */
  | { kind: "orphan-table"; tableId: string }
  | { kind: "orphan-column"; tableId: string; key: string }
  | { kind: "orphan-index"; tableId: string; key: string }
  | { kind: "create-bucket"; bucket: BucketSpec }
  | { kind: "update-bucket"; bucket: BucketSpec; reason: string }
  | { kind: "orphan-bucket"; bucketId: string };

export type NumericColumnSpec = Extract<ColumnSpec, { type: "integer" | "float" }>;

const APPWRITE_TYPE: Record<ColumnSpec["type"], string> = {
  string: "string",
  enum: "string",
  boolean: "boolean",
  integer: "integer",
  float: "double",
  datetime: "datetime",
};

function columnMismatch(spec: ColumnSpec, actual: CurrentColumn): string | null {
  if (actual.type !== APPWRITE_TYPE[spec.type]) {
    return `type is ${actual.type}, schema says ${spec.type} (${APPWRITE_TYPE[spec.type]})`;
  }
  if (actual.required !== spec.required) {
    return `required is ${actual.required}, schema says ${spec.required}`;
  }
  if (spec.type === "string" && typeof actual.size === "number" && actual.size !== spec.size) {
    return `size is ${actual.size}, schema says ${spec.size}`;
  }
  if (spec.type === "enum") {
    const a = [...(actual.elements ?? [])].sort().join(",");
    const b = [...spec.elements].sort().join(",");
    if (a !== b) return `elements are [${a}], schema says [${b}]`;
  }
  return null;
}

/**
 * How a numeric column's declared bounds differ from the server's, and
 * whether the change only widens them. Null when they agree.
 *
 * Only bounds the schema declares are compared, and only against a bound the
 * server reports. That is the same rule `indexMismatch` applies to orders, for
 * the same reason: an undeclared bound comes back as the type's extreme, and
 * "fixing" it would rebuild columns on every run. It also means a bound
 * dropped from the schema is not loosened on the server; drop one by hand.
 *
 * Before v16 the planner compared no bounds at all. Every bound in the schema
 * was set when its column was created and none had changed since (git log on
 * index.ts), so turning the comparison on reports nothing new against a
 * server that was built from this file. [Unverified] against the live
 * instance until `npm run appwrite:setup -- --dry-run` is run there; it
 * should list exactly one change, sets.rpe.
 */
function boundsChange(
  spec: NumericColumnSpec,
  actual: CurrentColumn,
): { reason: string; widens: boolean } | null {
  const parts: string[] = [];
  let widens = true;
  if (spec.min !== undefined && typeof actual.min === "number" && actual.min !== spec.min) {
    parts.push(`min is ${actual.min}, schema says ${spec.min}`);
    if (spec.min > actual.min) widens = false;
  }
  if (spec.max !== undefined && typeof actual.max === "number" && actual.max !== spec.max) {
    parts.push(`max is ${actual.max}, schema says ${spec.max}`);
    if (spec.max < actual.max) widens = false;
  }
  return parts.length === 0 ? null : { reason: parts.join("; "), widens };
}

function indexMismatch(spec: IndexSpec, actual: CurrentIndex): string | null {
  if (actual.type !== spec.type) return `type is ${actual.type}, schema says ${spec.type}`;
  if (actual.columns.join(",") !== spec.columns.join(",")) {
    return `columns are [${actual.columns.join(",")}], schema says [${spec.columns.join(",")}]`;
  }
  // Only compare orders the schema actually asked for. Appwrite reports an
  // empty orders array for single-column and unique indexes, so filling in a
  // default of "asc" here and comparing would rebuild half the indexes on
  // every run -- which is precisely the idempotency this script promises.
  if (spec.orders && spec.type !== "fulltext") {
    const specOrders = [...spec.orders];
    const actualOrders = (actual.orders ?? []).map((o) => o ?? "asc");
    if (actualOrders.length > 0 && actualOrders.join(",") !== specOrders.join(",")) {
      return `orders are [${actualOrders.join(",")}], schema says [${specOrders.join(",")}]`;
    }
  }
  return null;
}

function permissionsEqual(a: readonly string[], b: readonly string[]): boolean {
  return [...a].sort().join("|") === [...b].sort().join("|");
}

export function planSchema(current: CurrentState, desired: DatabaseSpec): Action[] {
  const actions: Action[] = [];

  if (!current.databaseExists) {
    actions.push({ kind: "create-database", databaseId: desired.id, name: desired.name });
  }

  const byId = new Map(current.tables.map((t) => [t.id, t]));

  for (const table of desired.tables) {
    const actual = byId.get(table.id);

    if (!actual) {
      // A new table is created whole, then its columns and indexes follow.
      actions.push({ kind: "create-table", table });
      for (const column of table.columns) {
        actions.push({ kind: "create-column", tableId: table.id, column });
      }
      for (const index of table.indexes) {
        actions.push({ kind: "create-index", tableId: table.id, index });
      }
      continue;
    }

    if (!permissionsEqual(actual.permissions, table.permissions)) {
      actions.push({
        kind: "update-table",
        table,
        reason: `permissions are [${actual.permissions.join(", ")}], schema says [${table.permissions.join(", ")}]`,
      });
    } else if (actual.rowSecurity !== table.rowSecurity) {
      actions.push({
        kind: "update-table",
        table,
        reason: `rowSecurity is ${actual.rowSecurity}, schema says ${table.rowSecurity}`,
      });
    }

    const columnsByKey = new Map(actual.columns.map((c) => [c.key, c]));
    for (const column of table.columns) {
      const actualColumn = columnsByKey.get(column.key);
      if (!actualColumn) {
        actions.push({ kind: "create-column", tableId: table.id, column });
        continue;
      }
      const reason = columnMismatch(column, actualColumn);
      if (reason) {
        actions.push({ kind: "manual-column-change", tableId: table.id, column, reason });
        continue;
      }
      if (column.type === "integer" || column.type === "float") {
        const bounds = boundsChange(column, actualColumn);
        if (bounds?.widens) {
          actions.push({ kind: "update-column", tableId: table.id, column, reason: bounds.reason });
        } else if (bounds) {
          actions.push({
            kind: "manual-column-change",
            tableId: table.id,
            column,
            reason: `${bounds.reason} -- narrowing can leave existing rows outside the range`,
          });
        }
      }
    }

    const indexesByKey = new Map(actual.indexes.map((i) => [i.key, i]));
    for (const index of table.indexes) {
      const actualIndex = indexesByKey.get(index.key);
      if (!actualIndex) {
        actions.push({ kind: "create-index", tableId: table.id, index });
        continue;
      }
      const reason = indexMismatch(index, actualIndex);
      // An index carries no data, so unlike a column it is safe to rebuild.
      if (reason) actions.push({ kind: "recreate-index", tableId: table.id, index, reason });
    }

    const desiredColumnKeys = new Set(table.columns.map((c) => c.key));
    for (const column of actual.columns) {
      if (!desiredColumnKeys.has(column.key)) {
        actions.push({ kind: "orphan-column", tableId: table.id, key: column.key });
      }
    }

    const desiredIndexKeys = new Set(table.indexes.map((i) => i.key));
    for (const index of actual.indexes) {
      if (!desiredIndexKeys.has(index.key)) {
        actions.push({ kind: "orphan-index", tableId: table.id, key: index.key });
      }
    }
  }

  const desiredTableIds = new Set(desired.tables.map((t) => t.id));
  for (const table of current.tables) {
    if (!desiredTableIds.has(table.id)) {
      actions.push({ kind: "orphan-table", tableId: table.id });
    }
  }

  for (const bucket of desired.buckets) {
    const actual = current.buckets.find((b) => b.id === bucket.id);
    if (!actual) {
      actions.push({ kind: "create-bucket", bucket });
      continue;
    }
    const reason = bucketMismatch(bucket, actual);
    if (reason) actions.push({ kind: "update-bucket", bucket, reason });
  }

  const desiredBucketIds = new Set(desired.buckets.map((b) => b.id));
  for (const bucket of current.buckets) {
    if (!desiredBucketIds.has(bucket.id)) {
      actions.push({ kind: "orphan-bucket", bucketId: bucket.id });
    }
  }

  return actions;
}

/**
 * Every field, because each one silently changes what the product can do.
 *
 * A size cap raised on one instance and not the next means video uploads that
 * work in development and fail for the athlete; an extension list that drifts
 * means the same. This is the check that makes the Cloud migration in January
 * a script run rather than an afternoon of comparing consoles.
 */
function bucketMismatch(spec: BucketSpec, actual: CurrentBucket): string | null {
  if (actual.fileSecurity !== spec.fileSecurity) {
    return `file security is ${actual.fileSecurity}, schema says ${spec.fileSecurity}`;
  }
  if (!permissionsEqual(actual.permissions, spec.permissions)) {
    return `permissions are [${actual.permissions.join(", ")}], schema says [${spec.permissions.join(", ")}]`;
  }
  if (actual.maximumFileSizeBytes !== spec.maximumFileSizeBytes) {
    return `max file size is ${actual.maximumFileSizeBytes}, schema says ${spec.maximumFileSizeBytes}`;
  }
  if (!sameExtensions(actual.allowedFileExtensions, spec.allowedFileExtensions)) {
    return `extensions are [${actual.allowedFileExtensions.join(", ")}], schema says [${spec.allowedFileExtensions.join(", ")}]`;
  }
  if (actual.compression !== spec.compression) {
    return `compression is ${actual.compression}, schema says ${spec.compression}`;
  }
  if (actual.encryption !== spec.encryption) return `encryption is ${actual.encryption}`;
  if (actual.antivirus !== spec.antivirus) return `antivirus is ${actual.antivirus}`;
  return null;
}

const sameExtensions = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().join(",") === [...b].sort().join(",");

/** Orphans and manual changes are reported, never executed. */
export const REPORT_ONLY: ReadonlySet<Action["kind"]> = new Set([
  "orphan-bucket",
  "orphan-table",
  "orphan-column",
  "orphan-index",
  "manual-column-change",
]);

export function isExecutable(action: Action): boolean {
  return !REPORT_ONLY.has(action.kind);
}
