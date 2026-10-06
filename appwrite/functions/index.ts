import { VALIDATED_TABLES } from "../documents/provenance";
import { DATABASE_ID } from "../schema";

/**
 * Appwrite Functions, as code.
 *
 * The same rule as the schema: never click one into existence in the console.
 * `npm run appwrite:functions` creates or updates each function below, bundles
 * its source, uploads a deployment and waits for the build -- one command,
 * idempotent, safe to re-run.
 */

export interface FunctionSpec {
  /** The function id on the instance. Fixed, so re-deploying finds it. */
  id: string;
  name: string;
  /** Why it exists, in the product's terms. */
  purpose: string;
  runtime: "node-22";
  /** Directory under functions/, holding src/main.ts. */
  dir: string;
  /** Events that trigger it. Both spellings: see docs/appwrite-events.md. */
  events: readonly string[];
  /** Scopes of the per-execution API key. The least that does the job. */
  scopes: readonly string[];
  timeoutSeconds: number;
  /** Environment variables the function reads. Never a secret; it has a dynamic key. */
  variables: Readonly<Record<string, string>>;
}

/**
 * Create AND update on every table a session can write. Both event spellings
 * because 1.9.6 fired the `collections.*.documents` form for a TablesDB write
 * (docs/appwrite-events.md); a later version may fire the other. The Function
 * filters by table itself, so a new writable table is covered the day it is
 * added to USER_WRITABLE_TABLES.
 */
const rowEvents = (op: "create" | "update") => [
  `databases.${DATABASE_ID}.collections.*.documents.*.${op}`,
  `databases.${DATABASE_ID}.tables.*.rows.*.${op}`,
];

export const FUNCTIONS: readonly FunctionSpec[] = [
  {
    id: "validate-row",
    name: "validate-row",
    purpose:
      `Deletes a row in ${VALIDATED_TABLES.join(", ")} whose stored permissions do not prove its ` +
      "owner wrote it. Appwrite polices who reads a row, not what the row claims; this is the server " +
      "half of the fix for the 27 Sep 2026 forgery finding (docs/permission-audit.md).",
    runtime: "node-22",
    dir: "validate-row",
    events: [...rowEvents("create"), ...rowEvents("update")],
    // Rows only. It must be able to delete a row and nothing else -- not read a
    // user, not touch a team, not write a table.
    scopes: ["rows.read", "rows.write", "documents.read", "documents.write"],
    timeoutSeconds: 15,
    variables: {
      // "true" logs the verdict and deletes nothing. The kill switch for a bad
      // policy change: flip it in the console or re-run appwrite:functions.
      VALIDATOR_DRY_RUN: "false",
    },
  },
];
