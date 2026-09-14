import { AppwriteException, ID, Query } from "appwrite";
import { browserAppwrite } from "@/appwrite/browser-client";
import { browserWriteDeps } from "@/appwrite/documents/browser-writer";
import { createSession, finishSession, type Actor } from "@/appwrite/documents";
import { ensureMyCircle } from "@/lib/auth/circle";
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
 * Reads go straight to Appwrite; writes go through the document helper, which
 * is the only thing allowed to stamp permissions. Nothing here decides product
 * rules -- which session to resume, what a summary contains -- those live in
 * session.ts, where they are testable without a network.
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

/** Appwrite's "already exists", which for a session start is a success. */
const CONFLICT = 409;

/**
 * Starts a session, or returns the one this device already started.
 *
 * `client_session_id` is unique-indexed precisely so a retry after a timeout
 * cannot create a second session. The first attempt may well have succeeded
 * with the response lost on the way back, so a conflict here is not an error to
 * show anybody -- it is the row we were trying to write, and we go and read it.
 * Order 9's queue will retry far more often than a flaky connection does.
 */
export async function startOrRecoverSession(
  actor: Actor,
  clientSessionId: string,
  startedAt: Date = new Date(),
): Promise<SessionRecord> {
  // Appwrite rejects a team: permission from a user who is not in the team, and
  // every session row carries a read for the athlete's circle. Without this the
  // write comes back 401 and no athlete can start anything.
  await ensureMyCircle();

  try {
    const row = await createSession(browserWriteDeps(() => ID.unique()), actor, {
      clientSessionId,
      startedAt,
    });
    const session = toSession(row as unknown as SessionRow);
    if (session) return session;
  } catch (error) {
    if (!(error instanceof AppwriteException) || error.code !== CONFLICT) throw error;
  }

  const existing = await findByClientId(actor.userId, clientSessionId);
  if (!existing) {
    throw new Error(`Session ${clientSessionId} was rejected as a duplicate but cannot be read back`);
  }
  return existing;
}

async function findByClientId(athleteId: string, clientSessionId: string) {
  const { tables, databaseId } = browserAppwrite();
  const rows = await tables.listRows({
    databaseId,
    tableId: "sessions",
    queries: [
      Query.equal("athlete_id", athleteId),
      Query.equal("client_session_id", clientSessionId),
      Query.limit(1),
    ],
  });
  const row = rows.rows[0];
  return row ? toSession(row as unknown as SessionRow) : null;
}

export async function finishSessionNow(
  actor: Actor,
  sessionId: string,
  totals: { setCount: number; tonnageKg: number },
  finishedAt: Date = new Date(),
): Promise<void> {
  await finishSession(browserWriteDeps(() => ID.unique()), actor, {
    sessionId,
    finishedAt,
    setCount: totals.setCount,
    tonnageKg: totals.tonnageKg,
  });
}

/** One per session, generated on the device so a retry stays idempotent. */
export const newClientSessionId = (): string => `cs-${ID.unique()}`;
