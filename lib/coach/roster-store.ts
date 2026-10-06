"use client";

import { Query } from "appwrite";
import { browserAppwrite } from "@/appwrite/browser-client";
import { dayKey, type BodyweightEntry } from "@/lib/bodyweight/bodyweight";
import { fetchAthleteNames } from "@/lib/auth/athletes";
import { fetchClips, fetchReviewedSetIds } from "@/lib/review/queue-store";
import { weekStart } from "@/lib/strength/rollup";
import { canSeeCircle } from "./coach-links-store";
import type { RosterInputs, WeekRollup, WeekSession } from "./roster";
import type { ProgramSignals } from "./roster-triggers";
import { computeProgramSignals } from "./program-signals";
import { localDay, parseDay, parseProgram, parseRows, parseWeek } from "@/lib/programming/program";

/**
 * The Roster's reads. Nothing here writes, and nothing uses the server key:
 * every row comes back through the coach's own session and the athletes'
 * circle teams, so an athlete who unlinked simply stops contributing.
 *
 * One query per table for every athlete at once (`equal()` takes an array),
 * so a coach with eight athletes pays the same round trips as a coach with one.
 * The only per-athlete calls are the circle check and the rare "last weigh-in
 * ever" for someone with nothing recent.
 */

const PAGE = 100;
/** Enough history for this week's average and the one before it. */
const BODYWEIGHT_DAYS = 21;
const MAX_ROWS = 2000;

const str = (value: unknown): string => (typeof value === "string" ? value : "");
const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

async function listAll(tableId: string, queries: string[]): Promise<Record<string, unknown>[]> {
  const { tables, databaseId } = browserAppwrite();
  const rows: Record<string, unknown>[] = [];
  let cursor: string | null = null;
  while (rows.length < MAX_ROWS) {
    const page: { rows: { $id: string }[] } = await tables.listRows({
      databaseId,
      tableId,
      queries: [...queries, Query.orderAsc("$id"), Query.limit(PAGE), ...(cursor ? [Query.cursorAfter(cursor)] : [])],
    });
    rows.push(...(page.rows as unknown as Record<string, unknown>[]));
    if (page.rows.length < PAGE) break;
    cursor = page.rows[page.rows.length - 1].$id;
  }
  return rows;
}

/**
 * Sessions that started this week or just before it. The lower bound is a day
 * early because `weekStart` is a label (UTC midnight of the London Monday), and
 * under BST the real Monday midnight is an hour earlier; the exact week test
 * happens in `buildRoster`.
 */
export async function fetchWeekSessions(athleteIds: readonly string[], now: Date): Promise<WeekSession[]> {
  if (athleteIds.length === 0) return [];
  const from = new Date(weekStart(now).getTime() - 86_400_000).toISOString();
  const rows = await listAll("sessions", [
    Query.equal("athlete_id", [...athleteIds]),
    Query.greaterThanEqual("started_at", from),
    Query.select(["athlete_id", "started_at", "finished_at"]),
  ]);
  return rows.map((row) => ({
    athleteId: str(row.athlete_id),
    startedAt: str(row.started_at),
    finishedAt: str(row.finished_at) || null,
  }));
}

/** This week's rollups, every lift, every athlete. The week's working sets come from here. */
export async function fetchWeekRollups(athleteIds: readonly string[], now: Date): Promise<WeekRollup[]> {
  if (athleteIds.length === 0) return [];
  const rows = await listAll("stats_rollups", [
    Query.equal("athlete_id", [...athleteIds]),
    Query.equal("week_start", weekStart(now).toISOString()),
    Query.select(["athlete_id", "week_start", "set_count"]),
  ]);
  return rows.map((row) => ({
    athleteId: str(row.athlete_id),
    weekStart: str(row.week_start),
    setCount: num(row.set_count) ?? 0,
  }));
}

const toEntry = (row: Record<string, unknown>): BodyweightEntry | null => {
  const weightKg = num(row.weight_kg);
  const measuredOn = str(row.measured_on);
  if (weightKg === null || !measuredOn) return null;
  return { id: str(row.$id), athleteId: str(row.athlete_id), weightKg, measuredOn, recordedAt: str(row.recorded_at) };
};

/**
 * Recent weigh-ins for everyone, plus the single newest one for anybody with
 * nothing recent -- so "no bodyweight in 23 days" can tell a lapsed athlete
 * from one who has never logged.
 */
export async function fetchRosterBodyweight(athleteIds: readonly string[], now: Date): Promise<BodyweightEntry[]> {
  if (athleteIds.length === 0) return [];
  const since = new Date(now.getTime() - BODYWEIGHT_DAYS * 86_400_000);
  const recent = (
    await listAll("bodyweight_entries", [
      Query.equal("athlete_id", [...athleteIds]),
      Query.greaterThanEqual("measured_on", dayKey(since)),
    ])
  ).flatMap((row) => toEntry(row) ?? []);

  const have = new Set(recent.map((e) => e.athleteId));
  const { tables, databaseId } = browserAppwrite();
  const older = await Promise.all(
    athleteIds
      .filter((id) => !have.has(id))
      .map(async (id) => {
        const page = await tables.listRows({
          databaseId,
          tableId: "bodyweight_entries",
          queries: [Query.equal("athlete_id", id), Query.orderDesc("measured_on"), Query.limit(1)],
        });
        return (page.rows as unknown as Record<string, unknown>[]).flatMap((row) => toEntry(row) ?? []);
      }),
  );
  return [...recent, ...older.flat()];
}

/**
 * Order 19's half of the Roster: the Block column, missed sessions, and RPE 10
 * nobody prescribed. Read through the coach's session like everything else
 * here -- program rows grant read to the athlete's circle -- and decided in
 * lib/coach/program-signals.ts. Five queries for every athlete at once.
 */
export async function fetchProgramSignals(
  athleteIds: readonly string[],
  now: Date = new Date(),
): Promise<Map<string, ProgramSignals>> {
  if (athleteIds.length === 0) return new Map();
  const ids = [...athleteIds];
  const today = localDay(now);
  // Two weeks of sets: the trigger's window is a week, with room for its rule to move.
  const since = new Date(now.getTime() - 14 * 86_400_000).toISOString();
  const [programRows, maxedRows, sessionRows] = await Promise.all([
    listAll("programs", [Query.equal("athlete_id", ids), Query.equal("status", "published")]),
    listAll("sets", [
      Query.equal("athlete_id", ids),
      Query.equal("rpe", 10),
      Query.equal("is_warmup", false),
      Query.greaterThanEqual("logged_at", since),
      Query.isNotNull("prescription_id"),
      Query.select(["$id", "athlete_id", "logged_at", "prescription_id"]),
    ]),
    listAll("sessions", [
      Query.equal("athlete_id", ids),
      Query.greaterThanEqual("started_at", new Date(now.getTime() - 8 * 86_400_000).toISOString()),
      Query.isNotNull("program_day_id"),
      Query.select(["athlete_id", "program_day_id"]),
    ]),
  ]);
  const programs = parseRows(programRows, parseProgram);
  const programIds = programs.map((p) => p.id);
  const lineIds = [...new Set(maxedRows.map((row) => str(row.prescription_id)).filter(Boolean))];
  const [weekRows, dayRows, lineRows] = await Promise.all([
    programIds.length ? listAll("program_weeks", [Query.equal("program_id", programIds)]) : [],
    programIds.length ? listAll("program_days", [Query.equal("program_id", programIds)]) : [],
    lineIds.length ? listAll("prescriptions", [Query.equal("$id", lineIds), Query.select(["$id", "load"])]) : [],
  ]);
  return computeProgramSignals(
    ids,
    {
      programs,
      weeks: parseRows(weekRows, parseWeek),
      days: parseRows(dayRows, parseDay),
      sessions: sessionRows.map((row) => ({ athleteId: str(row.athlete_id), programDayId: str(row.program_day_id) || null })),
      maxedSets: maxedRows.map((row) => ({
        id: str(row.$id),
        athleteId: str(row.athlete_id),
        loggedAt: str(row.logged_at),
        prescriptionId: str(row.prescription_id),
      })),
      lineLoads: new Map(lineRows.map((row) => [str(row.$id), str(row.load) || null])),
    },
    today,
  );
}

/** Everything the Roster renders except the links themselves, in parallel. */
export async function fetchRoster(
  coachId: string,
  athleteIds: readonly string[],
  now: Date,
): Promise<Omit<RosterInputs, "links">> {
  const ids = [...athleteIds];
  const [names, visibility, sessions, rollups, clips, reviewedSetIds, bodyweight, program] = await Promise.all([
    fetchAthleteNames(ids),
    Promise.all(ids.map(async (id) => [id, await canSeeCircle(id)] as const)),
    fetchWeekSessions(ids, now),
    fetchWeekRollups(ids, now),
    fetchClips(ids),
    fetchReviewedSetIds(coachId),
    fetchRosterBodyweight(ids, now),
    fetchProgramSignals(ids, now),
  ]);
  return {
    names: new Map(names.map((a) => [a.id, a.name])),
    visible: new Map(visibility),
    sessions,
    rollups,
    clips,
    reviewedSetIds,
    bodyweight,
    program,
  };
}
