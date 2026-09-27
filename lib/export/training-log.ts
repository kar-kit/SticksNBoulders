import { WEEK_TIME_ZONE } from "@/lib/strength/rollup";
import type { CsvValue } from "./csv";

/**
 * The training log as a table: one row per set.
 *
 * One row per set rather than one per session or per exercise, because that is
 * the shape a spreadsheet can do anything with. A coach who wants weekly
 * tonnage builds a pivot table; one who wants top sets filters on Warm-up = No
 * and sorts. A pre-aggregated layout would answer the questions we guessed at
 * and none of the ones he actually has -- and "it does whatever he builds into
 * it" is the reason he gave for Excel.
 *
 * Pure. The Appwrite reads are in training-log-store.ts.
 */

export interface ExportSession {
  id: string;
  startedAt: Date;
  notes: string | null;
}

export interface ExportSet {
  id: string;
  sessionId: string;
  exerciseId: string;
  /** 1-based, and counts warm-ups, as the logger numbers them. */
  setIndex: number;
  loadKg: number;
  reps: number;
  rpe: number | null;
  isWarmup: boolean;
  e1rmKg: number | null;
  loggedAt: Date;
  notes: string | null;
}

/**
 * The columns, in order. Units live in the header rather than in every cell so
 * the cells stay numbers a formula can add up.
 *
 * [Inference] `Session notes` is not in the Order 39 row, which lists set
 * notes only. It is here because "full training log" and a dropped session
 * note are not compatible, and one repeated column is cheaper than a second
 * file. [SME to confirm] against Ruairi's own sheet.
 */
export const LOG_COLUMNS = [
  "Date",
  "Session",
  "Exercise",
  "Set",
  "Load (kg)",
  "Reps",
  "RPE",
  "Warm-up",
  "e1RM (kg)",
  "Notes",
  "Prescription",
  "Session notes",
] as const;

/**
 * What the coach prescribed for a set, as he would read it back.
 *
 * Always null today: prescriptions have no table until the Program Editor at
 * Order 19 decides how a block is stored. The column ships now, empty, so the
 * file's layout does not change under anyone's formulas the day it fills in.
 */
export type PrescriptionLookup = (set: ExportSet) => string | null;
const noPrescriptions: PrescriptionLookup = () => null;

/**
 * `2026-09-13`, the calendar day in London.
 *
 * ISO because both Excel and Sheets parse it as a date whatever the machine's
 * locale, where 13/09/2026 is a date in Britain and text in America. London
 * because that is the day the rollups and History file the session under -- a
 * session started at 00:30 BST is Monday's, not Sunday's, everywhere else in
 * the product, so it is here too.
 */
export function isoDay(date: Date, timeZone: string = WEEK_TIME_ZONE): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** One decimal, so a stored 168.00000000000003 reads as 168. */
const oneDecimal = (value: number | null): number | null =>
  value === null || !Number.isFinite(value) ? null : Math.round(value * 10) / 10;

/**
 * Every set, in the order it was trained.
 *
 * Sessions oldest first, numbered from 1 so two sessions on one day stay
 * distinguishable and the number is something a coach can say out loud
 * ("session 41"). Within a session, exercises in the order they were first
 * worked and sets by their number, which is how the logger and History show
 * them; logged_at alone is not enough, because sets queued offline can land
 * with the same second.
 *
 * A set whose session is missing still exports, dated by when it was logged.
 * Dropping it would make the file quietly disagree with the app.
 */
export function buildLogRows(
  sessions: readonly ExportSession[],
  sets: readonly ExportSet[],
  exerciseNames: ReadonlyMap<string, string>,
  prescriptionFor: PrescriptionLookup = noPrescriptions,
): CsvValue[][] {
  const orderedSessions = [...sessions].sort(
    (a, b) => a.startedAt.getTime() - b.startedAt.getTime() || a.id.localeCompare(b.id),
  );
  const sessionNumber = new Map(orderedSessions.map((session, i) => [session.id, i + 1]));
  const sessionById = new Map(sessions.map((session) => [session.id, session]));

  const bySession = new Map<string, ExportSet[]>();
  for (const set of sets) {
    const group = bySession.get(set.sessionId);
    if (group) group.push(set);
    else bySession.set(set.sessionId, [set]);
  }

  // Known sessions in order, then orphans by when their first set was logged.
  const orphanIds = [...bySession.keys()]
    .filter((id) => !sessionById.has(id))
    .sort((a, b) => earliest(bySession.get(a)!) - earliest(bySession.get(b)!) || a.localeCompare(b));
  const sessionOrder = [...orderedSessions.map((s) => s.id), ...orphanIds];

  const rows: CsvValue[][] = [];
  for (const sessionId of sessionOrder) {
    const group = bySession.get(sessionId);
    if (!group) continue;
    const session = sessionById.get(sessionId);

    for (const set of orderWithinSession(group)) {
      rows.push([
        isoDay(session?.startedAt ?? set.loggedAt),
        sessionNumber.get(sessionId) ?? null,
        exerciseNames.get(set.exerciseId) ?? set.exerciseId,
        set.setIndex,
        set.loadKg,
        set.reps,
        set.rpe,
        set.isWarmup,
        oneDecimal(set.e1rmKg),
        set.notes,
        prescriptionFor(set),
        session?.notes ?? null,
      ]);
    }
  }
  return rows;
}

const earliest = (sets: readonly ExportSet[]): number =>
  Math.min(...sets.map((set) => set.loggedAt.getTime()));

function orderWithinSession(sets: readonly ExportSet[]): ExportSet[] {
  const firstSeen = new Map<string, number>();
  for (const set of sets) {
    const at = set.loggedAt.getTime();
    firstSeen.set(set.exerciseId, Math.min(firstSeen.get(set.exerciseId) ?? at, at));
  }
  return [...sets].sort(
    (a, b) =>
      (firstSeen.get(a.exerciseId) ?? 0) - (firstSeen.get(b.exerciseId) ?? 0) ||
      a.exerciseId.localeCompare(b.exerciseId) ||
      a.setIndex - b.setIndex ||
      a.loggedAt.getTime() - b.loggedAt.getTime() ||
      a.id.localeCompare(b.id),
  );
}

/**
 * `sticksnboulders-joey-pang-2026-09-27.csv`.
 *
 * The athlete's name is in it because a coach exports one file per athlete and
 * then has a Downloads folder of them; an id or a bare date tells him nothing.
 * Reduced to ASCII letters and digits so no filesystem or mail client mangles
 * it.
 */
export function exportFileName(name: string | null, today: Date = new Date()): string {
  const slug = (name ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return ["sticksnboulders", slug || "training-log", isoDay(today)].join("-") + ".csv";
}
