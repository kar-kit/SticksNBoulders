import { Query, TablesDB, type Client } from "node-appwrite";
import { generateInviteCode } from "@/lib/coach/invite-code";
import { createInviteCode } from "./write";
import type { RowWriter } from "./row-writer";

/**
 * Minting a coach's invite code, server-side.
 *
 * Here rather than in the route handler for the reason circle-admin.ts and
 * rollup-admin.ts exist: `invite_codes` is a server-only table, the write
 * helper is the only thing allowed to stamp permissions, and a route that
 * reached for TablesDB itself would be a write path outside the helper.
 *
 * Deliberately NOT re-exported from ./index. It constructs node-appwrite, and
 * the barrel is imported by client code -- the offline queue's runner reaches
 * createSet through it -- so re-exporting this pulls the server SDK into the
 * browser bundle and breaks every athlete screen. The route imports it by path.
 */

/**
 * Collisions are rare enough that this is about the pathological case, not the
 * expected one: with a five-character body, the chance of five consecutive
 * collisions is negligible until the instance holds millions of codes. Failing
 * loudly then is correct -- it means the keyspace, not the luck, has run out.
 */
const MINT_ATTEMPTS = 5;

export interface InviteTables {
  listRows(params: {
    databaseId: string;
    tableId: string;
    queries: string[];
    ttl?: number;
  }): Promise<{ rows: Array<Record<string, unknown>> }>;
  writer: RowWriter;
}

/** The admin view of the one table this needs. Constructed here, not by callers. */
export function adminInviteTables(client: Client): InviteTables {
  const db = new TablesDB(client);
  return {
    listRows: (params) =>
      db.listRows(params) as unknown as Promise<{ rows: Array<Record<string, unknown>> }>,
    writer: {
      createRow: (params) => db.createRow(params),
      updateRow: (params) => db.updateRow(params),
      deleteRow: (params) => db.deleteRow(params),
    },
  };
}

export interface EnsureInviteCodeResult {
  code: string;
  /** False when the coach already had one. The route is safe to call twice. */
  created: boolean;
}

/**
 * The coach's code, creating one only if they have none.
 *
 * Idempotent on purpose. A coach who taps "Invite an athlete" twice, or whose
 * first request timed out on gym wifi, must end up with the same code -- not a
 * second one that makes the first one they already texted somebody look wrong.
 * The unique index on `coach_id` is the backstop if two requests race.
 */
export async function ensureInviteCode(
  tables: InviteTables,
  databaseId: string,
  coachId: string,
  newCode: () => string = generateInviteCode,
  now: () => Date = () => new Date(),
): Promise<EnsureInviteCodeResult> {
  if (!coachId) throw new Error("ensureInviteCode: coachId is required");

  const existing = await findCode(tables, databaseId, coachId);
  if (existing) return { code: existing, created: false };

  // newId goes unused: createInviteCode takes the code as the row id, which is
  // the whole point. It is here because WriteDeps is one shape for every write.
  const deps = { writer: tables.writer, databaseId, newId: newCode, now };

  for (let attempt = 0; attempt < MINT_ATTEMPTS; attempt += 1) {
    const code = newCode();
    try {
      await createInviteCode(deps, { code, coachId });
      return { code, created: true };
    } catch (error) {
      // A 409 here does NOT mean success, which is the opposite of what it
      // means everywhere else in this codebase. The code is the row id, so a
      // conflict is either this code already belonging to someone else -- try
      // another -- or the unique index refusing a second code for this coach,
      // which means a racing request won and its code is the real one.
      // Assumed, not proven: Appwrite reports a unique-index violation the same
      // way it reports a duplicate row id. If it ever answers differently the
      // route 500s, the coach is told to try again, and the retry finds the
      // winner's code -- which is this branch's behaviour by a longer road.
      if ((error as { code?: number })?.code !== 409) throw error;
      const won = await findCode(tables, databaseId, coachId);
      if (won) return { code: won, created: false };
    }
  }

  throw new Error(`ensureInviteCode: no free code after ${MINT_ATTEMPTS} attempts`);
}

async function findCode(
  tables: InviteTables,
  databaseId: string,
  coachId: string,
): Promise<string | null> {
  const page = await tables.listRows({
    databaseId,
    tableId: "invite_codes",
    queries: [Query.equal("coach_id", coachId), Query.limit(1)],
    // Never a cached read. A stale empty page here mints a second code for a
    // coach who already has one, and the one they gave out stops being theirs.
    ttl: 0,
  });
  const id = page.rows[0]?.$id;
  return typeof id === "string" ? id : null;
}
