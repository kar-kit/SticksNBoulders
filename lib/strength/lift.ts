/**
 * One lift, all of it: is this going up, what is my best, what have I been
 * doing.
 *
 * Everything on Lift Detail that is an aggregate comes from `stats_rollups`,
 * never from raw sets. Appwrite cannot aggregate on read, and a second
 * derivation of a personal record next to the stored one is how the two start
 * disagreeing. Raw sets are read for exactly one thing -- the recent-sets list,
 * which is a list of rows rather than a number.
 *
 * Pure. Nothing here fetches.
 */

export interface WeekPoint {
  /** Monday of the week. */
  weekStart: Date;
  bestE1rmKg: number | null;
  bestSingleKg: number | null;
  bestSingleReps: number | null;
  bestReps: number | null;
  bestRepsLoadKg: number | null;
}

export type Range = "8w" | "12w" | "6m" | "all";

/** The blueprint's four. Deliberately not configurable. */
export const RANGES: readonly Range[] = ["8w", "12w", "6m", "all"];

const WEEKS_IN: Record<Exclude<Range, "all">, number> = { "8w": 8, "12w": 12, "6m": 26 };

export const rangeLabel = (range: Range): string =>
  range === "all" ? "all" : range === "6m" ? "6m" : range;

/** Weeks inside the range, oldest first, which is the direction a chart reads. */
export function pointsInRange(
  points: readonly WeekPoint[],
  range: Range,
  now: Date = new Date(),
): WeekPoint[] {
  const ordered = [...points].sort((a, b) => a.weekStart.getTime() - b.weekStart.getTime());
  if (range === "all") return ordered;

  const cutoff = now.getTime() - WEEKS_IN[range] * 7 * 24 * 60 * 60 * 1000;
  return ordered.filter((point) => point.weekStart.getTime() >= cutoff);
}

/** Only weeks that produced an estimate can be plotted. */
export const plottable = (points: readonly WeekPoint[]): Array<WeekPoint & { bestE1rmKg: number }> =>
  points.filter((p): p is WeekPoint & { bestE1rmKg: number } => p.bestE1rmKg !== null);

export interface LiftHeadline {
  /** The most recent week that produced an estimate. */
  currentE1rmKg: number | null;
  /** Change across the range, against the oldest week in it. Null when there is
   *  nothing to compare against -- one point is not a trend. */
  changeKg: number | null;
}

export function headline(points: readonly WeekPoint[]): LiftHeadline {
  const withEstimates = plottable(points);
  if (withEstimates.length === 0) return { currentE1rmKg: null, changeKg: null };

  const first = withEstimates[0].bestE1rmKg;
  const last = withEstimates[withEstimates.length - 1].bestE1rmKg;
  return {
    currentE1rmKg: last,
    // Rounded to a tenth, like every other kilo. A change of exactly zero is
    // still a change worth showing: it says the range was flat, which is not
    // the same as having nothing to say.
    changeKg: withEstimates.length < 2 ? null : Math.round((last - first) * 10) / 10,
  };
}

export interface PersonalRecords {
  heaviestSingleKg: number | null;
  heaviestSingleReps: number | null;
  bestE1rmKg: number | null;
  mostReps: number | null;
  mostRepsLoadKg: number | null;
}

/**
 * All-time, from every week the athlete has logged -- not from the selected
 * range. A personal record that changed when you tapped "8w" would not be a
 * record.
 */
export function personalRecords(points: readonly WeekPoint[]): PersonalRecords {
  const records: PersonalRecords = {
    heaviestSingleKg: null,
    heaviestSingleReps: null,
    bestE1rmKg: null,
    mostReps: null,
    mostRepsLoadKg: null,
  };

  for (const point of points) {
    if (point.bestE1rmKg !== null && point.bestE1rmKg > (records.bestE1rmKg ?? -1)) {
      records.bestE1rmKg = point.bestE1rmKg;
    }
    if (point.bestSingleKg !== null && point.bestSingleKg > (records.heaviestSingleKg ?? -1)) {
      records.heaviestSingleKg = point.bestSingleKg;
      records.heaviestSingleReps = point.bestSingleReps;
    }
    if (
      point.bestReps !== null &&
      (point.bestReps > (records.mostReps ?? -1) ||
        (point.bestReps === records.mostReps && (point.bestRepsLoadKg ?? 0) > (records.mostRepsLoadKg ?? 0)))
    ) {
      records.mostReps = point.bestReps;
      records.mostRepsLoadKg = point.bestRepsLoadKg;
    }
  }

  return records;
}

/**
 * Whether there is enough to draw a line.
 *
 * The blueprint's rule: fewer than three points and the chart is hidden, not
 * emptied. A two-point line is worse than no line -- it draws a trend out of a
 * coincidence, and this screen exists to answer "is this going up".
 */
export const MIN_POINTS = 3;
export const canChart = (points: readonly WeekPoint[]): boolean =>
  plottable(points).length >= MIN_POINTS;

export interface ChartGeometry {
  /** SVG path for the line, in a 0..width by 0..height box. */
  path: string;
  /** Where each point sits, for the dot on the last one. */
  dots: Array<{ x: number; y: number; point: WeekPoint & { bestE1rmKg: number } }>;
  minKg: number;
  maxKg: number;
}

/**
 * Turns weeks into a polyline.
 *
 * Hand-rolled rather than a charting library. The chart is one line with no
 * axes, no legend, no tooltip and no interaction; every library that draws it
 * brings a hundred times more than that, and this repo's dependency count is a
 * deliberate property rather than an accident.
 *
 * Spaced by time, not by index, so a month off training shows as a gap rather
 * than being compressed into the same step as a week.
 */
export function chartGeometry(
  points: readonly WeekPoint[],
  width: number,
  height: number,
  padding = 4,
): ChartGeometry | null {
  const usable = plottable(points);
  if (usable.length < 2) return null;

  const times = usable.map((p) => p.weekStart.getTime());
  const values = usable.map((p) => p.bestE1rmKg);
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const minKg = Math.min(...values);
  const maxKg = Math.max(...values);

  const spanTime = maxTime - minTime || 1;
  // A flat line sits in the middle rather than on the floor of the box, which
  // is what a zero span would otherwise do.
  const spanKg = maxKg - minKg || 1;
  const inner = { w: width - padding * 2, h: height - padding * 2 };

  const dots = usable.map((point) => ({
    x: padding + ((point.weekStart.getTime() - minTime) / spanTime) * inner.w,
    y:
      maxKg === minKg
        ? padding + inner.h / 2
        : padding + inner.h - ((point.bestE1rmKg - minKg) / spanKg) * inner.h,
    point,
  }));

  const path = dots
    .map((dot, at) => `${at === 0 ? "M" : "L"}${dot.x.toFixed(1)},${dot.y.toFixed(1)}`)
    .join(" ");

  return { path, dots, minKg, maxKg };
}
