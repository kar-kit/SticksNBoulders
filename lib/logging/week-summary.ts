import { weekStart } from "@/lib/strength/rollup";
import type { SessionRecord } from "./session";

/**
 * "This week", on the Log landing when no session is running.
 *
 * Aggregates only what is already aggregated. Sets and tonnage come from
 * `stats_rollups` -- one row per lift per week, the rule every dashboard here
 * follows -- so a set corrected or deleted from History moves this number the
 * same way it moves Lift Detail. Sessions are session rows already in memory
 * for Today, counted rather than summed: a count of rows is not a GROUP BY.
 *
 * Working sets only, like every rollup: warm-ups count toward nothing.
 */

export interface WeekRollupRow {
  weekStart: string;
  setCount: number;
  tonnageKg: number;
}

export interface WeekSummary {
  sessions: number;
  sets: number;
  tonnageKg: number;
}

const inWeek = (at: Date, week: Date): boolean =>
  !Number.isNaN(at.getTime()) && weekStart(at).getTime() === week.getTime();

export function summariseWeek(
  sessions: readonly Pick<SessionRecord, "startedAt" | "finishedAt">[],
  rollups: readonly WeekRollupRow[],
  now: Date = new Date(),
): WeekSummary {
  const week = weekStart(now);
  // Finished only: a session left open is in progress or abandoned, and the
  // Roster counts the same way, so coach and athlete see the same number.
  const done = sessions.filter((s) => s.finishedAt !== null && inWeek(s.startedAt, week)).length;
  // Filtered again even though the query asked for this week: a row from
  // another week must never inflate the total.
  const mine = rollups.filter((r) => inWeek(new Date(r.weekStart), week));
  const sets = mine.reduce((sum, r) => sum + r.setCount, 0);
  const tonnageKg = Math.round(mine.reduce((sum, r) => sum + r.tonnageKg, 0) * 10) / 10;
  return { sessions: done, sets, tonnageKg };
}

export const isEmptyWeek = (summary: WeekSummary): boolean =>
  summary.sessions === 0 && summary.sets === 0 && summary.tonnageKg === 0;
