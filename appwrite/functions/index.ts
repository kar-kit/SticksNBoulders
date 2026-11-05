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
  /**
   * Variables whose VALUES are secrets (F27: the VAPID keys). Named here,
   * never valued: `appwrite:functions` copies each from the deploying shell's
   * environment into a secret Function variable, and refuses to deploy the
   * function if one is missing.
   */
  secrets?: readonly string[];
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

/**
 * Deletes of comments only, never of every table (F25). The one delete the
 * Function acts on is a comment's, to take its reactions with it
 * (provenance.ts, `cascadeFor`), and subscribing to every delete in the
 * database would run an execution per removed set, review and weigh-in to do
 * nothing. Both spellings, for the reason `rowEvents` carries both.
 */
const commentDeleteEvents = [
  `databases.${DATABASE_ID}.collections.set_comments.documents.*.delete`,
  `databases.${DATABASE_ID}.tables.set_comments.rows.*.delete`,
];

/**
 * F27. A set gaining a clip arrives as a create (rare: the offline queue
 * writes the set first) or as an update (attachVideo), and an athlete's reply
 * as a comment create. Sets and comments only, never every table: this one
 * does network I/O per execution, and an execution per weigh-in or rollup to
 * do nothing is waste. Both spellings, for the reason `rowEvents` has both.
 */
const notifyEvents = [
  ...(["create", "update"] as const).flatMap((op) => [
    `databases.${DATABASE_ID}.collections.sets.documents.*.${op}`,
    `databases.${DATABASE_ID}.tables.sets.rows.*.${op}`,
  ]),
  `databases.${DATABASE_ID}.collections.set_comments.documents.*.create`,
  `databases.${DATABASE_ID}.tables.set_comments.rows.*.create`,
];

export const FUNCTIONS: readonly FunctionSpec[] = [
  {
    id: "validate-row",
    name: "validate-row",
    purpose:
      `Deletes a row in ${VALIDATED_TABLES.join(", ")} whose stored permissions do not prove its ` +
      "owner wrote it, or that carries a value no honest write produces (a reaction outside the six). " +
      "Appwrite polices who reads a row, not what the row claims; this is the server half of the fix " +
      "for the 27 Sep 2026 forgery finding (docs/permission-audit.md). Since F25 it also removes a " +
      "deleted comment's reactions, which its author has no right to delete themselves.",
    runtime: "node-22",
    dir: "validate-row",
    events: [...rowEvents("create"), ...rowEvents("update"), ...commentDeleteEvents],
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
  // Created after validate-row and must stay after it: the worker runs the
  // Functions for one event in creation order, and a failure re-throws out of
  // the loop (docs/appwrite-events.md). notify never fails an execution, but
  // the validator is the one that must not depend on that.
  {
    id: "notify",
    name: "notify",
    purpose:
      "Web push to a coach's devices when an athlete puts a clip on a set or replies in a thread (F27). " +
      "Recipients are the coaches on an active link to the athlete, never the athlete themselves; " +
      "collapse per athlete happens in the service worker. Removes a device the push service says is gone " +
      "(docs/push-notifications.md).",
    runtime: "node-22",
    dir: "notify",
    events: notifyEvents,
    // Read the link, the profile, the exercise and the coach's devices; write
    // only a device row (a timestamp, or its removal). files.read is for the
    // clip's $createdAt, which is how an update that attached a clip is told
    // from one that edited reps.
    scopes: ["rows.read", "rows.write", "documents.read", "documents.write", "files.read"],
    timeoutSeconds: 15,
    variables: {
      // "true" classifies and logs, sends and writes nothing.
      NOTIFY_DRY_RUN: "false",
    },
    secrets: ["NEXT_PUBLIC_VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"],
  },
];
