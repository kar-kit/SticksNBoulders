/**
 * Sick days (F31, schema v27): what a stored one may look like.
 *
 * Its own file, with no imports, for the reason reaction.ts and push.ts are:
 * the validate-row Function bundles provenance.ts, provenance.ts needs these
 * rules to judge a row's content, and anything this file pulled in would ride
 * into the Function's deployment with it. The Zod schemas for the write
 * boundary are in write.ts, which the Function does not bundle.
 *
 * A day is a CALENDAR day, `YYYY-MM-DD`, the athlete's own: the same
 * convention as `sessions` (`localDay` in lib/programming/program.ts) and
 * `bodyweight_entries.measured_on`, and the same shape as a program day's
 * `scheduled_on`, which is what makes "does this sick range cover that
 * prescribed day" a string comparison with no timezone in it.
 */

export const SICK_TABLE = "sick_days";

/** Matches the column. "Short" is the ask: a line, not a diary. */
export const SICK_NOTE_MAX = 200;

/**
 * The longest a single call-in may run, in days, both ends included. A month
 * is a different conversation with a coach, and a cap is what stops a typo in
 * the year ("2062") from silencing every missed-session signal for decades.
 * [Inference] -- nobody has asked for a number.
 */
export const SICK_MAX_DAYS = 31;

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/**
 * Whether a string is a real calendar day. The shape alone is not enough:
 * `new Date` rolls "2026-13-45" over into February 2027 rather than refusing
 * it (the bug lib/bodyweight/bodyweight.ts `dayDate` documents), so the
 * parsed date is checked back against the key it came from, in UTC where no
 * zone can move it.
 */
export function isDayKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = DAY.exec(value);
  if (!match) return false;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return (
    date.getUTCFullYear() === Number(year) && date.getUTCMonth() === Number(month) - 1 && date.getUTCDate() === Number(day)
  );
}

/** Days from `from` to `to`, both included. Callers pass real day keys. */
export function inclusiveDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}

/**
 * What is wrong with a range of days, or null. The one check shared by the
 * write helper, the readers and validate-row, so a row one of them refuses
 * is a row all of them refuse.
 */
export function sickRangeProblem(from: unknown, to: unknown): string | null {
  if (!isDayKey(from) || !isDayKey(to)) {
    return `starts_on ${JSON.stringify(from ?? null)} and ends_on ${JSON.stringify(to ?? null)} must both be YYYY-MM-DD days`;
  }
  if (to < from) return `ends_on ${to} is before starts_on ${from}`;
  if (inclusiveDays(from, to) > SICK_MAX_DAYS) return `${from} to ${to} is longer than ${SICK_MAX_DAYS} days`;
  return null;
}

/** A note, trimmed and cut to the column. Empty is no note: null. */
export function normaliseSickNote(note: string | null | undefined): string | null {
  const flat = (note ?? "").replace(/\s+/g, " ").trim();
  return flat === "" ? null : flat.slice(0, SICK_NOTE_MAX);
}
