import { ID, Query } from "appwrite";
import { browserAppwrite } from "@/appwrite/browser-client";
import { enqueue } from "@/lib/offline/client";
import type { SessionRecord, SessionSet } from "./session";

/**
 * A set as stored. The exercise name is resolved by the caller.
 *
 * clientSetId travels with it so Undo can find the row again after a reload,
 * without the screen having to hold Appwrite ids it otherwise never needs.
 */
export type UnnamedSet = Omit<SessionSet, "exerciseName"> & { clientSetId: string };

/**
 * Reading and writing training sessions from the browser.
 *
 * Reads go straight to Appwrite; writes go through the offline queue, which
 * runs them through the document helper -- still the only thing allowed to
 * stamp permissions. Nothing here decides product rules -- which session to
 * resume, what a summary contains -- those live in session.ts, where they are
 * testable without a network.
 */

/** Enough history for Today's last-session line without paging. */
const RECENT = 25;

interface SessionRow {
  $id: string;
  client_session_id?: unknown;
  started_at?: unknown;
  finished_at?: unknown;
  set_count?: unknown;
  tonnage_kg?: unknown;
  notes?: unknown;
}

const asDate = (value: unknown): Date | null => {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const asNumber = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

/** Skips a row rather than throwing: one bad row must not hide a live session. */
function toSession(row: SessionRow): SessionRecord | null {
  const startedAt = asDate(row.started_at);
  if (!startedAt) return null;
  return {
    id: row.$id,
    clientSessionId: typeof row.client_session_id === "string" ? row.client_session_id : "",
    startedAt,
    finishedAt: asDate(row.finished_at),
    setCount: asNumber(row.set_count),
    tonnageKg: asNumber(row.tonnage_kg),
    notes: typeof row.notes === "string" ? row.notes : null,
  };
}

export async function fetchRecentSessions(athleteId: string): Promise<SessionRecord[]> {
  const { tables, databaseId } = browserAppwrite();
  const rows = await tables.listRows({
    databaseId,
    tableId: "sessions",
    queries: [
      Query.equal("athlete_id", athleteId),
      Query.orderDesc("started_at"),
      Query.limit(RECENT),
    ],
  });
  return rows.rows
    .map((row) => toSession(row as unknown as SessionRow))
    .filter((session): session is SessionRecord => session !== null);
}

interface SetRow {
  $id: string;
  exercise_id?: unknown;
  client_set_id?: unknown;
  rpe?: unknown;
  load_kg?: unknown;
  reps?: unknown;
  is_warmup?: unknown;
  logged_at?: unknown;
}

/**
 * The sets of one session, without exercise names.
 *
 * Names are left to the caller, which has the library in memory already --
 * Appwrite has no joins, and fetching here would tie every refetch of the sets
 * to the library finishing loading. Returning ids keeps the two independent.
 */
export async function fetchSessionSets(sessionId: string): Promise<UnnamedSet[]> {
  const { tables, databaseId } = browserAppwrite();
  const rows = await tables.listRows({
    databaseId,
    tableId: "sets",
    queries: [Query.equal("session_id", sessionId), Query.limit(200)],
  });

  return rows.rows
    .map((raw) => {
      const row = raw as unknown as SetRow;
      const loggedAt = asDate(row.logged_at);
      const exerciseId = typeof row.exercise_id === "string" ? row.exercise_id : null;
      if (!loggedAt || !exerciseId) return null;
      return {
        exerciseId,
        clientSetId: typeof row.client_set_id === "string" ? row.client_set_id : "",
        loadKg: asNumber(row.load_kg),
        reps: asNumber(row.reps),
        rpe: typeof row.rpe === "number" ? row.rpe : null,
        isWarmup: row.is_warmup === true,
        loggedAt,
      } satisfies UnnamedSet;
    })
    .filter((set): set is UnnamedSet => set !== null);
}

/**
 * Starts a session on the device.
 *
 * It does not touch the network. The id is generated here, written to the
 * queue, and returned -- so a session started in a basement is a real session
 * with a real Appwrite row id, and the sets logged into it reference an id that
 * will still be that row's id when the signal comes back.
 *
 * `client_session_id` is the row id, which means a retry cannot create a second
 * session even if the unique index were dropped tomorrow. The read-back this
 * function used to do on a 409 is gone with it: there is nothing to discover,
 * because we chose the id.
 *
 * No actor is passed: the queue carries one, attached when the athlete surface
 * mounts, because the op may well be run by a flush hours after this returns.
 */
export async function startOrRecoverSession(
  clientSessionId: string,
  startedAt: Date = new Date(),
): Promise<SessionRecord> {
  await enqueue("session.create", {
    sessionId: clientSessionId,
    startedAt: startedAt.toISOString(),
  });

  return {
    id: clientSessionId,
    clientSessionId,
    startedAt,
    finishedAt: null,
    setCount: 0,
    tonnageKg: 0,
    notes: null,
  };
}

export async function finishSessionNow(
  sessionId: string,
  totals: { setCount: number; tonnageKg: number },
  finishedAt: Date = new Date(),
): Promise<void> {
  await enqueue("session.finish", {
    sessionId,
    finishedAt: finishedAt.toISOString(),
    setCount: totals.setCount,
    tonnageKg: totals.tonnageKg,
  });
}

/**
 * One per session, generated on the device -- and used as the Appwrite row id.
 *
 * 23 characters of lowercase, digits and a hyphen, which is a legal row id
 * (Appwrite allows 36, and forbids a leading special character). Having one id
 * rather than two is what lets a set reference its session before either exists
 * on the server.
 */
export const newClientSessionId = (): string => `cs-${ID.unique()}`;
