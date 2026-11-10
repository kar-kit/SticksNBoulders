import { Query } from "appwrite";
import { authenticRows, isAuthentic } from "@/appwrite/documents/provenance";
import { fetchExerciseNames } from "@/lib/export/training-log-store";
import { exerciseIdsOf, readSetsForSessions, setsBySession } from "@/lib/logging/history-sets";
import { sessionTitle, totalsOf } from "@/lib/logging/session-edit";
import { toSession, type SessionRow } from "@/lib/logging/session-rows";
import type { SessionRecord } from "@/lib/logging/session";
import { readDayLabels } from "@/lib/programming/program-read";
import { DEFAULT_UNITS } from "@/lib/profile/profile";
import { failure, notFound, ok, ownProfile, rowOrNull, type ApiResult, type ReadContext } from "./context";

/**
 * GET /api/v1/sessions and GET /api/v1/sessions/:id (F29).
 *
 * The list is History's: newest first, each with the set count and tonnage
 * stored on the session, which is what History's cards show. One session is
 * the session detail screen's: its sets in the order they were worked, and
 * its totals recomputed from them with `totalsOf`, as that screen does.
 *
 * No clip ids, no posters, no comments: a set says whether it was filmed by
 * nothing at all here.
 */

export const SESSIONS_DEFAULT_LIMIT = 20;
export const SESSIONS_MAX_LIMIT = 100;
/** The query parameters /sessions accepts. Also what the audit line keeps. */
export const SESSIONS_PARAMS = ["from", "to", "limit", "cursor"] as const;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A bound on `started_at`. A calendar day is that day in UTC: `from` its
 * start, `to` the start of the next, so `to=2026-11-10` includes all of the
 * 10th. A full ISO date-time is taken as the instant it names, `to` exclusive.
 */
function bound(value: string, end: boolean): string | null {
  if (DAY.test(value)) {
    const start = Date.parse(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(start) || new Date(start).toISOString().slice(0, 10) !== value) return null;
    return new Date(end ? start + 24 * 60 * 60 * 1000 : start).toISOString();
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? new Date(at).toISOString() : null;
}

export type ListQuery = { from: string | null; to: string | null; limit: number; cursor: string | null };

export function parseListQuery(params: URLSearchParams): ListQuery | { error: string } {
  const from = params.get("from");
  const to = params.get("to");
  const limitRaw = params.get("limit");
  const cursor = params.get("cursor");
  const fromAt = from ? bound(from, false) : null;
  const toAt = to ? bound(to, true) : null;
  if (from && !fromAt) return { error: "invalid_from" };
  if (to && !toAt) return { error: "invalid_to" };
  if (fromAt && toAt && fromAt >= toAt) return { error: "invalid_range" };
  let limit = SESSIONS_DEFAULT_LIMIT;
  if (limitRaw !== null) {
    if (!/^\d{1,3}$/.test(limitRaw)) return { error: "invalid_limit" };
    limit = Number(limitRaw);
    if (limit < 1 || limit > SESSIONS_MAX_LIMIT) return { error: "invalid_limit" };
  }
  if (cursor !== null && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/.test(cursor)) return { error: "invalid_cursor" };
  return { from: fromAt, to: toAt, limit, cursor };
}

/** The owner's own session, or null. Somebody else's is null too: their coach can read it, this API cannot. */
async function ownSession(ctx: ReadContext, sessionId: string): Promise<SessionRecord | null> {
  const row = await rowOrNull(ctx, "sessions", sessionId);
  if (!row || row.athlete_id !== ctx.ownerId || !isAuthentic("sessions", row)) return null;
  return toSession(row as unknown as SessionRow);
}

/** History's name for a session: the athlete's own, else the program day's. Null when it has neither. */
function nameOf(session: SessionRecord, labels: ReadonlyMap<string, string>): string | null {
  const { title, named } = sessionTitle(session, session.programDayId ? (labels.get(session.programDayId) ?? null) : null);
  // Unnamed, the app shows the date in the phone's own time zone. A server
  // has no phone, so it returns null and leaves the date to `startedAt`.
  return named ? title : null;
}

export async function listSessions(ctx: ReadContext): Promise<ApiResult> {
  const query = parseListQuery(ctx.url.searchParams);
  if ("error" in query) return failure(400, query.error);
  if (query.cursor && !(await ownSession(ctx, query.cursor))) return failure(400, "invalid_cursor");

  const page = await ctx.tables.listRows({
    databaseId: ctx.databaseId,
    tableId: "sessions",
    queries: [
      Query.equal("athlete_id", ctx.ownerId),
      ...(query.from ? [Query.greaterThanEqual("started_at", query.from)] : []),
      ...(query.to ? [Query.lessThan("started_at", query.to)] : []),
      Query.orderDesc("started_at"),
      // One more than asked, to know whether there is a next page without
      // a second round trip.
      Query.limit(query.limit + 1),
      ...(query.cursor ? [Query.cursorAfter(query.cursor)] : []),
    ],
  });
  const raw = page.rows.slice(0, query.limit);
  // The cursor is the last row read, authentic or not, so a forged row the
  // filter below drops can never stall the pages behind it.
  const nextCursor = page.rows.length > query.limit ? (raw.at(-1)?.$id ?? null) : null;

  const sessions = authenticRows("sessions", raw)
    .filter((row) => row.athlete_id === ctx.ownerId)
    .map((row) => toSession(row as unknown as SessionRow))
    .filter((s): s is SessionRecord => s !== null);
  const labels = await readDayLabels(
    { tables: ctx.tables, databaseId: ctx.databaseId },
    sessions.map((s) => s.programDayId).filter((id): id is string => Boolean(id)),
  ).catch(() => new Map<string, string>());
  const profile = await ownProfile(ctx);

  return ok({
    units: profile?.units ?? DEFAULT_UNITS,
    sessions: sessions.map((s) => ({
      id: s.id,
      startedAt: s.startedAt.toISOString(),
      finishedAt: s.finishedAt?.toISOString() ?? null,
      name: nameOf(s, labels),
      setCount: s.setCount,
      tonnageKg: s.tonnageKg,
    })),
    nextCursor,
  });
}

export async function getSession(ctx: ReadContext, sessionId: string): Promise<ApiResult> {
  const session = await ownSession(ctx, sessionId);
  if (!session) return notFound();

  const sets =
    setsBySession(
      await readSetsForSessions(ctx.tables, ctx.databaseId, [session.id], { athleteId: ctx.ownerId }),
    ).get(session.id) ?? [];
  const [names, labels, profile] = await Promise.all([
    fetchExerciseNames(ctx.tables, ctx.databaseId, exerciseIdsOf(sets)),
    session.programDayId
      ? readDayLabels({ tables: ctx.tables, databaseId: ctx.databaseId }, [session.programDayId]).catch(() => new Map<string, string>())
      : Promise.resolve(new Map<string, string>()),
    ownProfile(ctx),
  ]);
  const totals = totalsOf(sets);

  return ok({
    units: profile?.units ?? DEFAULT_UNITS,
    session: {
      id: session.id,
      startedAt: session.startedAt.toISOString(),
      finishedAt: session.finishedAt?.toISOString() ?? null,
      name: nameOf(session, labels),
      notes: session.notes,
      setCount: totals.setCount,
      tonnageKg: totals.tonnageKg,
      sets: sets.map((set, index) => ({
        order: index + 1,
        exercise: { id: set.exerciseId, name: names.get(set.exerciseId) ?? null },
        setIndex: set.setIndex,
        weightKg: set.loadKg,
        reps: set.reps,
        rpe: set.rpe,
        warmup: set.isWarmup,
        failed: set.failed === true,
        notes: set.notes ?? null,
        // Cardio (F23): a time and a level instead of weight and reps. Null on a strength set.
        durationSeconds: set.durationSeconds ?? null,
        level: set.level ?? null,
      })),
    },
  });
}
