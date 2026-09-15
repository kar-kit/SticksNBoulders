import type { BucketSpec, ColumnSpec, IndexSpec, TableSpec } from "./types";
import type { CurrentState } from "./plan";

/**
 * The narrow surface the executor needs. Appwrite's SDK is wide and its shapes
 * change between versions; this keeps that blast radius in one file and lets
 * tests drive the executor with an in-memory fake.
 */
export interface SchemaDriver {
  readState(databaseId: string): Promise<CurrentState>;
  createDatabase(databaseId: string, name: string): Promise<void>;
  createTable(databaseId: string, table: TableSpec): Promise<void>;
  updateTable(databaseId: string, table: TableSpec): Promise<void>;
  createColumn(databaseId: string, tableId: string, column: ColumnSpec): Promise<void>;
  createIndex(databaseId: string, tableId: string, index: IndexSpec): Promise<void>;
  deleteIndex(databaseId: string, tableId: string, key: string): Promise<void>;
  /**
   * Appwrite creates columns asynchronously. An index built before its columns
   * are available fails, so the executor waits rather than sleeping and hoping.
   */
  waitForColumns(databaseId: string, tableId: string, keys: readonly string[]): Promise<void>;
  createBucket(bucket: BucketSpec): Promise<void>;
  updateBucket(bucket: BucketSpec): Promise<void>;
}
