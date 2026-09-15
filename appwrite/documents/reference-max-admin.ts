import { Client, Query, TablesDB } from "node-appwrite";
import { createReferenceMax, deleteReferenceMax, type WriteDeps } from "./write";
import type { RowWriter } from "./row-writer";

/**
 * Writing a reference max, with the API key.
 *
 * It runs server-side for the same reason redemption does. Appwrite can police
 * who reads a row but not what the row claims: `athlete_id` is data, not a
 * permission, so any client able to create one could create it carrying
 * somebody else's id, stamp it with a role everyone holds, and put a number
 * they invented under an athlete's percentages.
 *
 * So the check that matters is here and nowhere else: the caller is the
 * athlete, or actively coaches them. Anything else writes nothing.
 */

export interface ReferenceMaxTables {
  listRows(params: {
    databaseId: string;
    tableId: string;
    queries: string[];
  }): Promise<{ rows: Array<Record<string, unknown>> }>;
  getRow(params: {
    databaseId: string;
    tableId: string;
    rowId: string;
  }): Promise<{ $id: string } & Record<string, unknown>>;
  writer: RowWriter;
}

export function adminReferenceMaxTables(client: Client): ReferenceMaxTables {
  const db = new TablesDB(client);
  return {
    listRows: (params) =>
      db.listRows(params) as unknown as Promise<{ rows: Array<Record<string, unknown>> }>,
    getRow: (params) =>
      db.getRow(params) as unknown as Promise<{ $id: string } & Record<string, unknown>>,
    writer: {
      createRow: (params) => db.createRow(params),
      updateRow: (params) => db.updateRow(params),
      deleteRow: (params) => db.deleteRow(params),
    },
  };
}

/**
 * May this caller set numbers for this athlete?
 *
 * Two ways to qualify and no third. An athlete always may, for their own
 * tested maxes. A coach may while the link is active -- read from
 * `coach_athlete_links`, which is the source of truth for who coaches whom,
 * rather than from circle membership, which is how that fact reaches Appwrite.
 * Checking the record rather than the access is what stops a stale membership
 * from being an authorisation.
 */
export async function mayWriteFor(
  tables: ReferenceMaxTables,
  databaseId: string,
  callerId: string,
  athleteId: string,
): Promise<boolean> {
  if (!callerId || !athleteId) return false;
  if (callerId === athleteId) return true;

  const links = await tables.listRows({
    databaseId,
    tableId: "coach_athlete_links",
    queries: [
      Query.equal("athlete_id", athleteId),
      Query.equal("coach_id", callerId),
      Query.equal("status", "active"),
      Query.limit(1),
    ],
  });
  return links.rows.length > 0;
}

export interface SetMaxInput {
  athleteId: string;
  exerciseId: string;
  kind: "tested" | "training";
  valueKg: number;
  /** Omitted means "from now". */
  effectiveFrom?: string;
}

export type SetMaxResult =
  | { status: "not-allowed" }
  | { status: "invalid"; reason: string }
  | { status: "created"; rowId: string };

/**
 * A plate-loaded bar tops out well below this; a typo does not. The ceiling is
 * a sanity bound, not a rule about what anyone can lift -- the all-time raw
 * squat record is under 500kg.
 */
const MAX_PLAUSIBLE_KG = 600;

export async function setReferenceMax(
  tables: ReferenceMaxTables,
  databaseId: string,
  callerId: string,
  input: SetMaxInput,
  deps: Pick<WriteDeps, "newId" | "now">,
): Promise<SetMaxResult> {
  if (!(await mayWriteFor(tables, databaseId, callerId, input.athleteId))) {
    return { status: "not-allowed" };
  }

  if (!Number.isFinite(input.valueKg) || input.valueKg <= 0) {
    return { status: "invalid", reason: "A max has to be a positive number of kilos." };
  }
  if (input.valueKg > MAX_PLAUSIBLE_KG) {
    return { status: "invalid", reason: `A max over ${MAX_PLAUSIBLE_KG}kg is a typo.` };
  }
  if (!input.exerciseId) {
    return { status: "invalid", reason: "A max belongs to an exercise." };
  }

  let effectiveFrom: Date | undefined;
  if (input.effectiveFrom) {
    effectiveFrom = new Date(input.effectiveFrom);
    if (Number.isNaN(effectiveFrom.getTime())) {
      return { status: "invalid", reason: "That date could not be read." };
    }
  }

  const row = await createReferenceMax(
    { writer: tables.writer, databaseId, newId: deps.newId, now: deps.now },
    // The row records who decided the number, which is the caller -- not the
    // athlete it is about. "Who set this" is the first question asked when a
    // percentage looks wrong.
    { userId: callerId },
    {
      athleteId: input.athleteId,
      exerciseId: input.exerciseId,
      kind: input.kind,
      valueKg: input.valueKg,
      effectiveFrom,
    },
  );

  return { status: "created", rowId: row.$id };
}

export type RemoveMaxResult = { status: "not-allowed" } | { status: "gone" } | { status: "removed" };

/**
 * The undo for a typo, and the only edit the table has.
 *
 * The athlete a row belongs to is read from the row itself rather than taken
 * from the caller: a row id names one row, and trusting a caller's claim about
 * whose it is would let anyone delete anyone's max.
 */
export async function removeReferenceMax(
  tables: ReferenceMaxTables,
  databaseId: string,
  callerId: string,
  rowId: string,
): Promise<RemoveMaxResult> {
  const row = await tables
    .getRow({ databaseId, tableId: "reference_maxes", rowId })
    .catch(() => null);
  if (!row) return { status: "gone" };

  const athleteId = typeof row.athlete_id === "string" ? row.athlete_id : "";
  if (!(await mayWriteFor(tables, databaseId, callerId, athleteId))) {
    return { status: "not-allowed" };
  }

  await deleteReferenceMax({ writer: tables.writer, databaseId, newId: () => "", now: () => new Date() }, rowId);
  return { status: "removed" };
}
