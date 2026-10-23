import { Query } from "appwrite";
import { browserAppwrite } from "@/appwrite/browser-client";
import { authenticRows, posterOf } from "@/appwrite/documents";
import type { UnnamedSet } from "./session-store";

/**
 * Reading History.
 *
 * Sessions come from the provider that Today and Log already use, so this only
 * fetches what they do not have: the sets belonging to those sessions, for the
 * exercise names on each card.
 *
 * One query for all of them, not one per card. Appwrite's equal() takes an
 * array, which is an IN -- verified against the live instance rather than
 * assumed -- so a screen of twenty-five sessions costs one round trip instead
 * of twenty-five.
 */

/**
 * Rows per page. Twenty-five sessions of a powerlifting day with warm-ups is
 * 750 sets or more, so one page is not enough and the read pages on a cursor;
 * 500 keeps a normal screen to two round trips.
 */
const PAGE = 500;

interface SetRow {
  $id: string;
  session_id?: unknown;
  exercise_id?: unknown;
  client_set_id?: unknown;
  set_index?: unknown;
  rpe?: unknown;
  load_kg?: unknown;
  reps?: unknown;
  is_warmup?: unknown;
  logged_at?: unknown;
  e1rm_kg?: unknown;
  video_file_id?: unknown;
  notes?: unknown;
}

/** A set with the session it belongs to, and where it sat in its exercise. */
export interface HistorySet extends UnnamedSet {
  sessionId: string;
  setIndex: number;
  e1rmKg: number | null;
  /** The attached clip, so deleting the set from History can take it too. */
  videoFileId?: string | null;
  /** That clip's poster (F12), for the row's thumbnail; null for none. */
  videoPosterId?: string | null;
}

const asNumber = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

function toSet(raw: SetRow): HistorySet | null {
  const loggedAt = new Date(typeof raw.logged_at === "string" ? raw.logged_at : "");
  const exerciseId = typeof raw.exercise_id === "string" ? raw.exercise_id : "";
  const sessionId = typeof raw.session_id === "string" ? raw.session_id : "";
  if (Number.isNaN(loggedAt.getTime()) || !exerciseId || !sessionId) return null;

  return {
    sessionId,
    exerciseId,
    clientSetId: typeof raw.client_set_id === "string" ? raw.client_set_id : raw.$id,
    setIndex: asNumber(raw.set_index),
    loadKg: asNumber(raw.load_kg),
    reps: asNumber(raw.reps),
    rpe: typeof raw.rpe === "number" ? raw.rpe : null,
    isWarmup: raw.is_warmup === true,
    e1rmKg: typeof raw.e1rm_kg === "number" ? raw.e1rm_kg : null,
    loggedAt,
    videoFileId: typeof raw.video_file_id === "string" && raw.video_file_id ? raw.video_file_id : null,
    videoPosterId: posterOf(raw as unknown as Record<string, unknown>),
    // The athlete's note (F11): shown under the set in History and in the
    // coach's session view, which reads through this same function.
    notes: typeof raw.notes === "string" && raw.notes.trim() ? raw.notes : null,
  };
}

/**
 * The sets of several sessions, in one query.
 *
 * Returns an empty list rather than throwing when there is nothing to ask for,
 * so the caller does not have to special-case an athlete with no history.
 */
export async function fetchSetsForSessions(sessionIds: readonly string[]): Promise<HistorySet[]> {
  if (sessionIds.length === 0) return [];

  const { tables, databaseId } = browserAppwrite();
  const rows: Array<Record<string, unknown> & { $id: string }> = [];
  let cursor: string | null = null;
  // Ordered by $id for the cursor: the one order guaranteed unique, so a page
  // boundary cannot fall between two sets. setsBySession orders them for show.
  for (;;) {
    const queries = [Query.equal("session_id", [...sessionIds]), Query.orderAsc("$id"), Query.limit(PAGE)];
    if (cursor) queries.push(Query.cursorAfter(cursor));
    const page: { rows: Array<Record<string, unknown> & { $id: string }> } = await tables.listRows({
      databaseId,
      tableId: "sets",
      queries,
    });
    rows.push(...page.rows);
    if (page.rows.length < PAGE) break;
    cursor = page.rows[page.rows.length - 1].$id;
  }

  return authenticRows("sets", rows)
    .map((row) => toSet(row as unknown as SetRow))
    .filter((set): set is HistorySet => set !== null);
}

/**
 * Groups sets by session, keeping the order they were worked in.
 *
 * Ordered by when each exercise was first touched, then by set_index within it,
 * which is how the logger showed them. logged_at alone is not enough: sets
 * logged offline in the same second share a timestamp.
 */
export function setsBySession(sets: readonly HistorySet[]): Map<string, HistorySet[]> {
  const bySession = new Map<string, HistorySet[]>();
  for (const set of sets) {
    bySession.set(set.sessionId, [...(bySession.get(set.sessionId) ?? []), set]);
  }

  for (const [sessionId, group] of bySession) {
    const firstSeen = new Map<string, number>();
    for (const set of group) {
      const at = set.loggedAt.getTime();
      firstSeen.set(set.exerciseId, Math.min(firstSeen.get(set.exerciseId) ?? at, at));
    }
    bySession.set(
      sessionId,
      [...group].sort(
        (a, b) =>
          (firstSeen.get(a.exerciseId) ?? 0) - (firstSeen.get(b.exerciseId) ?? 0) ||
          a.exerciseId.localeCompare(b.exerciseId) ||
          a.setIndex - b.setIndex ||
          a.loggedAt.getTime() - b.loggedAt.getTime(),
      ),
    );
  }
  return bySession;
}

/** The exercises of a session, in the order they were worked, without repeats. */
export function exerciseIdsOf(sets: readonly HistorySet[]): string[] {
  const seen: string[] = [];
  for (const set of sets) if (!seen.includes(set.exerciseId)) seen.push(set.exerciseId);
  return seen;
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
