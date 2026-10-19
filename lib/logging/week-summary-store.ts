"use client";

import { Query } from "appwrite";
import { browserAppwrite } from "@/appwrite/browser-client";
import { weekStart } from "@/lib/strength/rollup";
import type { WeekRollupRow } from "./week-summary";

/**
 * This week's rollups for one athlete, every lift. Read-only.
 *
 * One query on `idx_athlete_week` (athlete_id, week_start). A week holds one
 * row per lift trained, so a single page of 100 covers any real week; a
 * second page would mean a hundred different exercises in seven days.
 */
const PAGE = 100;

const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

export async function fetchWeekRollupsFor(athleteId: string, now: Date = new Date()): Promise<WeekRollupRow[]> {
  const { tables, databaseId } = browserAppwrite();
  const page = await tables.listRows({
    databaseId,
    tableId: "stats_rollups",
    queries: [
      Query.equal("athlete_id", athleteId),
      Query.equal("week_start", weekStart(now).toISOString()),
      Query.select(["athlete_id", "week_start", "set_count", "tonnage_kg"]),
      Query.limit(PAGE),
    ],
  });
  return (page.rows as unknown as Record<string, unknown>[])
    // Defensive: the athlete can read only their own rollups, but a row that
    // is somebody else's must not land in this athlete's week.
    .filter((row) => row.athlete_id === athleteId)
    .map((row) => ({
      weekStart: typeof row.week_start === "string" ? row.week_start : "",
      setCount: num(row.set_count),
      tonnageKg: num(row.tonnage_kg),
    }));
}
