import { Query } from "appwrite";
import { browserAppwrite } from "@/appwrite/browser-client";
import { authenticRows } from "@/appwrite/documents";
import { readSetsForSessions, type HistorySet, type SetReader } from "./history-sets";

export { exerciseIdsOf, setsBySession, type HistorySet } from "./history-sets";

/**
 * Reading History.
 *
 * Sessions come from the provider that Today and Log already use, so this only
 * fetches what they do not have: the sets belonging to those sessions, for the
 * exercise names on each card. The read and the ordering are in
 * history-sets.ts, shared with the read API (F29).
 */

/**
 * The sets of several sessions, in one query. See history-sets.ts.
 *
 * Returns an empty list rather than throwing when there is nothing to ask for,
 * so the caller does not have to special-case an athlete with no history.
 */
export async function fetchSetsForSessions(sessionIds: readonly string[]): Promise<HistorySet[]> {
  if (sessionIds.length === 0) return [];
  const { tables, databaseId } = browserAppwrite();
  return readSetsForSessions(tables as unknown as SetReader, databaseId, sessionIds);
}

/**
 * Whether a set row still names this session. The session delete's guard.
 *
 * Only rows the athlete wrote count: a forged set naming somebody's session
 * must not be able to pin it in place.
 */
export async function sessionHasSets(sessionId: string): Promise<boolean> {
  const { tables, databaseId } = browserAppwrite();
  const page = await tables.listRows({
    databaseId,
    tableId: "sets",
    queries: [Query.equal("session_id", sessionId), Query.limit(25)],
  });
  return authenticRows("sets", page.rows).length > 0;
}
