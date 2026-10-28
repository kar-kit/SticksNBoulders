/**
 * Cardio sets (F23, schema v21): what one is, and the one rule every total
 * in the product applies to it -- it is not strength work, and never counts
 * as any.
 *
 * ## Why a cardio set lives in the sets table
 *
 * A set row with two nullable columns, `duration_seconds` and `level`, rather
 * than a table of its own. A second table would have kept the strength maths
 * untouched by construction, but at the price of a second copy of everything
 * a set already has: the permission stamp and its audit, the forgery check in
 * validate-row, the offline queue's create / update / delete and their
 * cascade when a session or an exercise goes, History's read, the session
 * edit, the export, the backup. Every one of those is a path that has been
 * bug-fixed at least once for sets. In the sets table a cardio set inherits
 * all of them, and the strength maths needs exactly one rule, here.
 *
 * ## How a cardio set is stored, and why it is inert
 *
 * `load_kg` and `reps` are required columns, so a cardio set fills them with
 * 0 and 0 -- and that pair was chosen because it is the one a strength reader
 * that has never heard of cardio already treats as nothing:
 *
 *   - 0 kg is no tonnage, no e1RM (lib/strength/e1rm.ts), never the heaviest
 *     set and never a top set or a suggestion's anchor (F20's rules);
 *   - 0 reps on a set that is not failed is no volume and no record of any
 *     kind (`reps < 1` everywhere in lib/strength/pr.ts).
 *
 * It also stores no RPE, no e1RM, no clip, and is never a warm-up or failed.
 *
 * ## The rule: strength maths takes strength sets only
 *
 * That inertness is the backstop, not the rule. The rule is `isStrengthSet`,
 * applied at the door of every strength aggregate -- session totals, the
 * weekly rollups, every PR kind, the backoff's top set, the next-set
 * suggestion -- and it fails closed:
 *
 *   - a set carrying a duration OR a level is cardio, whatever its exercise
 *     says now (the exercise's kind only decides what the Log asks for, see
 *     lib/exercises/kind.ts);
 *   - a set with 0 reps that is not failed is not strength work either. No
 *     strength path can log one (the confirm square refuses it), so the only
 *     way one reaches a total is a cardio set read by code that dropped its
 *     duration on the way -- a `Query.select` missing the column, an old
 *     device cache. Leaving it out costs nothing a strength total had; letting
 *     it in would count a treadmill block as a set.
 *
 * A cardio set missing from a total is a smaller wrong than a cardio set in
 * one, so every unclear case lands on the "not strength" side.
 */

/** The two cardio columns, as every set shape in the app carries them. Absent and null are the same. */
export interface CardioValues {
  /** Whole seconds, at least 1. Null or absent on a strength set. */
  durationSeconds?: number | null;
  /** The machine's level or intensity, 0 to 99.9. Optional on a cardio set, absent on a strength one. */
  level?: number | null;
}

/**
 * A set row's cardio columns (F23), only when it has them. A strength row
 * comes back with neither key, so every screen built before v21 sees the
 * same object it always did. Any number at all is passed on, valid or not:
 * `isCardioSet` keeps such a set out of every strength total, which is the
 * point of reading it.
 */
export function cardioColumns(row: object): CardioValues {
  // `object` so a typed row interface and a bare Record both fit.
  const { duration_seconds: rawDuration, level: rawLevel } = row as { duration_seconds?: unknown; level?: unknown };
  const duration = typeof rawDuration === "number" ? rawDuration : null;
  const level = typeof rawLevel === "number" ? rawLevel : null;
  return duration === null && level === null ? {} : { durationSeconds: duration, level };
}

/** 24 hours, the column's ceiling. Past any session; a guard, not a target. */
export const MAX_DURATION_SECONDS = 86_400;

/**
 * The highest level the pad takes: two digits and a decimal. Stairmasters and
 * bikes stop around 20-25, treadmill speeds around 25; the column allows 100
 * as headroom.
 */
export const MAX_LEVEL = 99.9;

const present = (value: number | null | undefined): boolean => value !== null && value !== undefined;

/**
 * Whether a stored or logged set is cardio: it carries a duration or a level.
 *
 * Either column alone is enough, and any value at all counts -- even one that
 * is not a valid duration -- because this is the question "may this set enter
 * a strength total", and a set with a stray cardio value is not one to trust
 * with a tonnage.
 */
export const isCardioSet = (set: CardioValues): boolean => present(set.durationSeconds) || present(set.level);

/**
 * Whether a logged set is strength work: the door every strength aggregate
 * checks. Not cardio, and not a 0-rep set that is not a miss (see the header:
 * that is a cardio set read without its columns, and nothing else can be).
 */
export const isStrengthSet = (set: CardioValues & { reps: number; failed?: boolean | null }): boolean =>
  !isCardioSet(set) && !(set.reps === 0 && set.failed !== true);

/** A duration the Log may log and the schema will take: whole seconds, 1 to 24 hours. */
export const isLoggableDuration = (seconds: number | null | undefined): seconds is number =>
  typeof seconds === "number" && Number.isInteger(seconds) && seconds >= 1 && seconds <= MAX_DURATION_SECONDS;

/** A level the Log may log: none at all, or 0 to 99.9. */
export const isLoggableLevel = (level: number | null | undefined): boolean =>
  level === null || level === undefined || (Number.isFinite(level) && level >= 0 && level <= MAX_LEVEL);

/**
 * Whether a cardio row's confirm is live: a duration above zero, and a level
 * that is either blank or a real one. Level is optional on purpose -- a walk
 * on a flat treadmill has no number worth typing.
 */
export const canCompleteCardio = (set: CardioValues): boolean =>
  isLoggableDuration(set.durationSeconds) && isLoggableLevel(set.level);

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** One decimal at most, no trailing zero: 8, 2.5. */
const levelText = (level: number): string => String(Math.round(level * 10) / 10);

/**
 * A duration as the athlete reads it: "20 min" for whole minutes, which is
 * how cardio is nearly always done and said, and "20:30" when there are
 * seconds. Never hours: "90 min" is what a long session is called in a gym.
 */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${minutes} min` : `${minutes}:${pad2(rest)}`;
}

/**
 * A duration in a set row's cell, under a MIN header (F23): "20", or
 * "20:30" with seconds. The unit is the column's, as KG is the load's.
 */
export function durationCell(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const rest = total % 60;
  return rest === 0 ? String(Math.floor(total / 60)) : `${Math.floor(total / 60)}:${pad2(rest)}`;
}

/** The same, for a screen reader: "20 minutes", "20 minutes 30 seconds". */
export function spokenDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  const m = `${minutes} minute${minutes === 1 ? "" : "s"}`;
  return rest === 0 ? m : `${m} ${rest} second${rest === 1 ? "" : "s"}`;
}

/** "level 8", "level 2.5". */
export const formatLevel = (level: number): string => `level ${levelText(level)}`;

/**
 * One cardio set on one line: "20 min · level 8", or "20 min" with no level.
 * What History, the finish screen, the coach's session view and Previous show.
 */
export function cardioLine(set: CardioValues): string {
  const duration = present(set.durationSeconds) ? formatDuration(set.durationSeconds as number) : "—";
  return present(set.level) ? `${duration} · ${formatLevel(set.level as number)}` : duration;
}

/** The same line, spoken. */
export function spokenCardioLine(set: CardioValues): string {
  const duration = present(set.durationSeconds) ? spokenDuration(set.durationSeconds as number) : "no duration";
  return present(set.level) ? `${duration}, ${formatLevel(set.level as number)}` : duration;
}

/**
 * Total cardio time across a list of sets, in seconds. Only sets with a
 * duration count; strength sets are not looked at.
 */
export function cardioSeconds(sets: readonly CardioValues[]): number {
  return sets.reduce(
    (total, set) => total + (isCardioSet(set) && isLoggableDuration(set.durationSeconds) ? set.durationSeconds : 0),
    0,
  );
}

/**
 * A total of cardio time for a stat: "20 min", "1 min" for anything under a
 * minute that is not nothing, rounded to the minute otherwise. A stat line is
 * glanced at; "41:30" there reads as a clock.
 */
export function formatCardioTotal(seconds: number): string {
  if (seconds <= 0) return "0 min";
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}
