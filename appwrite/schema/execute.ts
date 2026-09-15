import type { SchemaDriver } from "./driver";
import { isExecutable, planSchema, type Action } from "./plan";
import type { DatabaseSpec } from "./types";

export interface ApplyResult {
  applied: Action[];
  /** Orphans and unsafe column changes. Reported, never executed. */
  reported: Action[];
  /** True when the schema already matched, which the second run must be. */
  noop: boolean;
}

export interface ApplyOptions {
  dryRun?: boolean;
  log?: (message: string) => void;
}

function describe(action: Action): string {
  switch (action.kind) {
    case "create-database":
      return `create database ${action.databaseId}`;
    case "create-table":
      return `create table ${action.table.id}`;
    case "update-table":
      return `update table ${action.table.id} — ${action.reason}`;
    case "create-column":
      return `create column ${action.tableId}.${action.column.key} (${action.column.type})`;
    case "create-index":
      return `create index ${action.tableId}.${action.index.key}`;
    case "recreate-index":
      return `recreate index ${action.tableId}.${action.index.key} — ${action.reason}`;
    case "manual-column-change":
      return `NEEDS A HUMAN: ${action.tableId}.${action.column.key} — ${action.reason}`;
    case "orphan-table":
      return `orphan table ${action.tableId} exists on the server but not in the schema`;
    case "orphan-column":
      return `orphan column ${action.tableId}.${action.key}`;
    case "orphan-index":
      return `orphan index ${action.tableId}.${action.key}`;
    case "create-bucket":
      return `create bucket ${action.bucket.id}`;
    case "update-bucket":
      return `update bucket ${action.bucket.id} — ${action.reason}`;
    case "orphan-bucket":
      return `orphan bucket ${action.bucketId} exists on the server but not in the schema`;
  }
}

export async function applySchema(
  driver: SchemaDriver,
  schema: DatabaseSpec,
  { dryRun = false, log = () => {} }: ApplyOptions = {},
): Promise<ApplyResult> {
  const current = await driver.readState(schema.id);
  const actions = planSchema(current, schema);
  const executable = actions.filter(isExecutable);
  const reported = actions.filter((a) => !isExecutable(a));

  for (const action of reported) log(`  ! ${describe(action)}`);

  if (dryRun) {
    for (const action of executable) log(`  would ${describe(action)}`);
    return { applied: [], reported, noop: executable.length === 0 };
  }

  // Columns for a table must exist before its indexes reference them.
  const pendingColumns = new Map<string, string[]>();

  for (const action of executable) {
    log(`  ${describe(action)}`);
    switch (action.kind) {
      case "create-database":
        await driver.createDatabase(action.databaseId, action.name);
        break;
      case "create-table":
        await driver.createTable(schema.id, action.table);
        break;
      case "update-table":
        await driver.updateTable(schema.id, action.table);
        break;
      case "create-column": {
        await driver.createColumn(schema.id, action.tableId, action.column);
        const keys = pendingColumns.get(action.tableId) ?? [];
        keys.push(action.column.key);
        pendingColumns.set(action.tableId, keys);
        break;
      }
      case "recreate-index":
        await driver.deleteIndex(schema.id, action.tableId, action.index.key);
      // falls through: a recreate is a delete then a create
      case "create-index": {
        const keys = pendingColumns.get(action.tableId);
        if (keys?.length) {
          await driver.waitForColumns(schema.id, action.tableId, keys);
          pendingColumns.delete(action.tableId);
        }
        await driver.createIndex(schema.id, action.tableId, action.index);
        break;
      }
      case "create-bucket":
        await driver.createBucket(action.bucket);
        break;
      case "update-bucket":
        await driver.updateBucket(action.bucket);
        break;
    }
  }

  return { applied: executable, reported, noop: executable.length === 0 };
}
