import { Client, Query, TablesDB } from "node-appwrite";
import { isSuggestionMode, type SuggestionMode } from "@/lib/coach/suggestion-mode";
import { setLinkSuggestionMode, type WriteDeps } from "./write";
import type { RowWriter } from "./row-writer";

/**
 * Order 28: a coach switching an athlete's load suggestions on or off.
 *
 * Server side, with the API key, for the same reason as reference maxes and
 * link redemption. The setting decides what an athlete's logger shows, it is
 * the coach's decision, and Appwrite can police who reads a row but not what a
 * row claims. Stored on `coach_athlete_links`, which no client may write at
 * all, so neither the athlete nor anybody else can forge it -- the only way in
 * is through the check below.
 *
 * Exactly one caller qualifies: the coach on an ACTIVE link with this athlete.
 *
 * - **Not the athlete.** Unlike a reference max, this is not something the
 *   athlete may set for themselves. A switch the person being coached can flip
 *   back is not the coach staying in control.
 * - **Not a revoked coach.** Read from the link record rather than circle
 *   membership, so a membership left behind by a half-failed revoke is never
 *   an authorisation -- the rule `mayWriteFor` follows for maxes.
 * - **Not a stranger,** however they shape the body. The coach is whoever the
 *   JWT says, and the row is found by (coach from the token, athlete from the
 *   body, active); an athlete id alone matches nothing.
 */

export interface SuggestionModeTables {
  listRows(params: {
    databaseId: string;
    tableId: string;
    queries: string[];
  }): Promise<{ rows: Array<Record<string, unknown>> }>;
  writer: RowWriter;
}

export function adminSuggestionModeTables(client: Client): SuggestionModeTables {
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

export interface SetSuggestionModeInput {
  athleteId: string;
  mode: unknown;
}

export type SetSuggestionModeResult =
  | { status: "not-allowed" }
  | { status: "invalid" }
  | { status: "saved"; mode: SuggestionMode };

export async function setSuggestionMode(
  tables: SuggestionModeTables,
  databaseId: string,
  callerId: string,
  input: SetSuggestionModeInput,
  deps: Pick<WriteDeps, "now">,
): Promise<SetSuggestionModeResult> {
  const athleteId = input.athleteId;
  // Authorisation before validation, so a stranger learns nothing -- not even
  // which modes exist -- from how they are refused.
  if (!callerId || !athleteId || callerId === athleteId) return { status: "not-allowed" };

  const links = await tables.listRows({
    databaseId,
    tableId: "coach_athlete_links",
    queries: [
      Query.equal("coach_id", callerId),
      Query.equal("athlete_id", athleteId),
      Query.equal("status", "active"),
      Query.limit(1),
    ],
  });
  const link = links.rows[0];
  // Belt and braces over the query: the row must say what was asked for, so a
  // query that silently dropped a filter cannot hand out somebody else's link.
  if (
    !link ||
    typeof link.$id !== "string" ||
    link.coach_id !== callerId ||
    link.athlete_id !== athleteId ||
    link.status !== "active"
  ) {
    return { status: "not-allowed" };
  }

  if (!isSuggestionMode(input.mode)) return { status: "invalid" };

  await setLinkSuggestionMode(
    { writer: tables.writer, databaseId, newId: () => "", now: deps.now },
    { rowId: link.$id, coachId: callerId, athleteId, mode: input.mode },
  );
  return { status: "saved", mode: input.mode };
}
