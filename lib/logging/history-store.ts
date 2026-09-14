import { Query } from "appwrite";
import { browserAppwrite } from "@/appwrite/browser-client";
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

/** Twenty-five sessions of a dozen sets each, with room to spare. */
const MAX_SETS = 500;

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
}

/** A set with the session it belongs to, and where it sat in its exercise. */
export interface HistorySet extends UnnamedSet {
  sessionId: string;
  setIndex: number;
  e1rmKg: number | null;
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
  const rows = await tables.listRows({
    databaseId,
    tableId: "sets",
    queries: [Query.equal("session_id", [...sessionIds]), Query.limit(MAX_SETS)],
  });

  return rows.rows
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
