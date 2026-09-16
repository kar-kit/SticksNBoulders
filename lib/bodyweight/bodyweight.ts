/**
 * Bodyweight: the day key, the plausible range, and the trend.
 *
 * Pure. Daily bodyweight is noisy and the trend is the only part that means
 * anything, so most of this file is about turning a scatter of numbers into one
 * a coach can act on -- and about the edges of that, which is where a rolling
 * average quietly lies.
 */

export interface BodyweightEntry {
  id: string;
  athleteId: string;
  weightKg: number;
  /** The day it refers to, YYYY-MM-DD. */
  measuredOn: string;
  /** When it was typed, which is not always the same day. */
  recordedAt: string;
}

/**
 * The range a scale could plausibly read for a person.
 *
 * Wide on purpose. This is a typo guard, not a judgement -- it exists to catch
 * a misplaced decimal point (8.24 for 82.4) and a stray keypress (824), and it
 * has no business having an opinion about anything between those.
 */
export const MIN_PLAUSIBLE_KG = 20;
export const MAX_PLAUSIBLE_KG = 400;

/** The blueprint's window. Long enough to smooth a bad night, short enough to move. */
export const AVERAGE_DAYS = 7;

export type WeightRejection =
  | { ok: false; reason: "not-a-number" }
  | { ok: false; reason: "out-of-range" };

export function checkWeight(value: number): { ok: true; weightKg: number } | WeightRejection {
  if (!Number.isFinite(value)) return { ok: false, reason: "not-a-number" };
  if (value < MIN_PLAUSIBLE_KG || value > MAX_PLAUSIBLE_KG) {
    return { ok: false, reason: "out-of-range" };
  }
  // One decimal place, which is what a bathroom scale shows. Storing more
  // invents precision nobody measured.
  return { ok: true, weightKg: Math.round(value * 10) / 10 };
}

export const weightRejectionMessage = (rejection: WeightRejection): string =>
  rejection.reason === "not-a-number"
    ? "That isn't a number."
    : `A weight should be between ${MIN_PLAUSIBLE_KG} and ${MAX_PLAUSIBLE_KG} kg — check the decimal point.`;

/**
 * The day a weigh-in belongs to, in the athlete's own timezone.
 *
 * Local rather than UTC, deliberately. Someone stepping on the scale at 7am in
 * London is logging today; UTC would agree, and someone doing the same in
 * Sydney would find their morning filed under yesterday. The date is a label
 * for a morning, not an instant.
 */
export function dayKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Parses a day key back to local midnight. Invalid keys give null.
 *
 * The shape check is not enough on its own, which a test caught: `new Date`
 * rolls an impossible date over rather than refusing it, so "2026-13-45" comes
 * back as a perfectly valid day in February 2027. A corrupt `measured_on`
 * would then plot somewhere plausible and quietly drag an average. So the
 * parsed date is checked back against the key it came from.
 */
export function dayDate(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (Number.isNaN(date.getTime())) return null;
  return date.getFullYear() === Number(year) &&
    date.getMonth() === Number(month) - 1 &&
    date.getDate() === Number(day)
    ? date
    : null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days between two keys, or null if either is unreadable. */
export function daysBetween(from: string, to: string): number | null {
  const a = dayDate(from);
  const b = dayDate(to);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

/** Newest first, which is how every screen wants them. */
export function sortedByDay(entries: readonly BodyweightEntry[]): BodyweightEntry[] {
  return [...entries]
    .filter((entry) => dayDate(entry.measuredOn) !== null)
    .sort((a, b) => b.measuredOn.localeCompare(a.measuredOn));
}

export const latestEntry = (entries: readonly BodyweightEntry[]): BodyweightEntry | null =>
  sortedByDay(entries)[0] ?? null;

export interface Average {
  kg: number;
  /**
   * How many entries went into it. Exposed rather than hidden: a "7-day
   * average" computed from two weigh-ins is a real number and not a precise
   * one, and the screen should be able to stay quiet about it rather than
   * implying a week of data that does not exist.
   */
  count: number;
}

/**
 * The rolling average ending on a given day.
 *
 * Averages whatever falls inside the window rather than refusing a partial one.
 * The blueprint asks for no guilt copy on a gap and says daily weighing is the
 * norm -- so somebody four days into using the app, or back after a week away,
 * gets a number rather than a blank where the trend should be.
 */
export function rollingAverage(
  entries: readonly BodyweightEntry[],
  endingOn: string,
  days: number = AVERAGE_DAYS,
): Average | null {
  const end = dayDate(endingOn);
  if (!end || days < 1) return null;

  const window = entries.filter((entry) => {
    const gap = daysBetween(entry.measuredOn, endingOn);
    // Inclusive of the end day, exclusive of anything after it: an average
    // must never be pulled by a weight from the future.
    return gap !== null && gap >= 0 && gap < days;
  });
  if (window.length === 0) return null;

  const total = window.reduce((sum, entry) => sum + entry.weightKg, 0);
  return { kg: Math.round((total / window.length) * 10) / 10, count: window.length };
}

export interface Trend {
  latestKg: number;
  average: Average;
  /**
   * The change on the previous window, or null when there is no previous
   * window to compare against. Null renders as an absence rather than as a
   * "+0.0", which would read as a plateau somebody had actually held.
   */
  changeKg: number | null;
}

/**
 * The line under the big number: latest, average, and which way it is going.
 *
 * Compared window-to-window rather than day-to-day, because a single day's
 * difference is mostly water and telling somebody they gained half a kilo
 * overnight is noise dressed as information.
 *
 * Null when the last weigh-in is older than the window, and that is the point
 * rather than a gap. A "7-day average" for somebody who has not stood on a
 * scale for three weeks is a lie with a number attached; the screen shows their
 * last weight and the day it was taken instead, and says nothing about a week
 * that has no data in it.
 */
export function trend(
  entries: readonly BodyweightEntry[],
  days: number = AVERAGE_DAYS,
  today: string = dayKey(),
): Trend | null {
  const newest = latestEntry(entries);
  if (!newest) return null;

  const endingOn = newest.measuredOn > today ? newest.measuredOn : today;
  const average = rollingAverage(entries, endingOn, days);
  if (!average) return null;

  const previousEnd = dayDate(endingOn);
  let changeKg: number | null = null;
  if (previousEnd) {
    previousEnd.setDate(previousEnd.getDate() - days);
    const before = rollingAverage(entries, dayKey(previousEnd), days);
    if (before) changeKg = Math.round((average.kg - before.kg) * 10) / 10;
  }

  return { latestKg: newest.weightKg, average, changeKg };
}

export const RANGES = [30, 90] as const;
export type Range = (typeof RANGES)[number] | "all";

/** The entries a range toggle should plot, oldest first for drawing. */
export function inRange(
  entries: readonly BodyweightEntry[],
  range: Range,
  today: string = dayKey(),
): BodyweightEntry[] {
  const chronological = sortedByDay(entries).reverse();
  if (range === "all") return chronological;
  return chronological.filter((entry) => {
    const gap = daysBetween(entry.measuredOn, today);
    return gap !== null && gap >= 0 && gap < range;
  });
}

/**
 * The rolling average at every plotted point, for the second line.
 *
 * Computed per point over the FULL history rather than over the visible range,
 * so switching from 90 days to 30 does not change the shape of the average at
 * the left-hand edge. An average that moves when you zoom is an average nobody
 * can trust.
 */
export function averageSeries(
  all: readonly BodyweightEntry[],
  /** Only the days matter here, so anything carrying one will do. */
  visible: readonly { measuredOn: string }[],
  days: number = AVERAGE_DAYS,
): { measuredOn: string; kg: number }[] {
  return visible
    .map((entry) => {
      const average = rollingAverage(all, entry.measuredOn, days);
      return average ? { measuredOn: entry.measuredOn, kg: average.kg } : null;
    })
    .filter((point): point is { measuredOn: string; kg: number } => point !== null);
}
