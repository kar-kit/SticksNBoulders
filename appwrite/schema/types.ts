/**
 * Declarative schema types.
 *
 * Deliberately free of any SDK import. The schema is data, so it can be
 * asserted against in a test without a network, and so the applier is the only
 * thing that has to know how Appwrite spells things.
 */

export type ColumnSpec =
  | { key: string; type: "string"; size: number; required: boolean; default?: string; array?: boolean }
  | { key: string; type: "enum"; elements: readonly string[]; required: boolean; default?: string }
  | { key: string; type: "boolean"; required: boolean; default?: boolean }
  | { key: string; type: "integer"; required: boolean; min?: number; max?: number; default?: number }
  | { key: string; type: "float"; required: boolean; min?: number; max?: number; default?: number }
  | { key: string; type: "datetime"; required: boolean; default?: string };

export interface IndexSpec {
  key: string;
  type: "key" | "unique" | "fulltext";
  columns: readonly string[];
  orders?: readonly ("asc" | "desc")[];
}

export interface TableSpec {
  id: string;
  name: string;
  /**
   * Why this table exists, in the product's terms. Kept in the schema rather
   * than a wiki because the next person to add a column reads this file.
   */
  purpose: string;
  /**
   * Per-row permissions. True for anything an athlete owns, because the reader
   * differs per row. Note Appwrite grants access on table-level OR row-level
   * permission, so a table with row security must NOT also carry a blanket
   * table-level read, or every row is public to every signed-in user.
   */
  rowSecurity: boolean;
  /** Table-level permissions. Creation rights, almost never reads. */
  permissions: readonly string[];
  columns: readonly ColumnSpec[];
  indexes: readonly IndexSpec[];
}

/**
 * A storage bucket, declared the same way a table is.
 *
 * CLAUDE.md is explicit that infrastructure is never clicked into existence in
 * the console, and a bucket is infrastructure: its size cap and its allowed
 * extensions are as load-bearing as a column type. A video that silently fails
 * to upload because a bucket was configured by hand on one instance and not on
 * the next is the Cloud migration going wrong in January.
 */
export interface BucketSpec {
  id: string;
  name: string;
  /** Why it exists, in the product's terms. Same reason TableSpec has one. */
  purpose: string;
  /**
   * Per-file permissions, for the same reason tables use row security: the
   * reader differs per file. An athlete's clip is theirs and their circle's.
   */
  fileSecurity: boolean;
  /** Bucket-level permissions. Creation rights, never reads. */
  permissions: readonly string[];
  maximumFileSizeBytes: number;
  allowedFileExtensions: readonly string[];
  /** Appwrite compresses on its side; video is already compressed. */
  compression: "none" | "gzip" | "zstd";
  encryption: boolean;
  antivirus: boolean;
}

export interface DatabaseSpec {
  id: string;
  name: string;
  /** Bumped whenever tables or columns change, so drift is attributable. */
  version: number;
  tables: readonly TableSpec[];
  buckets: readonly BucketSpec[];
}

/**
 * Table-level permissions. Creation rights only.
 *
 * There is deliberately no read constant here. Appwrite grants access on
 * table-level OR row-level permission, so a table-level read would make every
 * row readable by every signed-in user -- and a constant for it is an
 * invitation. Row reads are stamped per row by appwrite/documents.
 */
export const perm = {
  createUsers: 'create("users")',
} as const;
