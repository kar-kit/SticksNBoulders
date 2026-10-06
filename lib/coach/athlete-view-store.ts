import { Query } from "appwrite";
import { browserAppwrite } from "@/appwrite/browser-client";
import type { CoachLinkRow, RollupWeek } from "./athlete-view";
import { parseSuggestionMode } from "./suggestion-mode";

/**
 * The reads Athlete View adds. Nothing here writes.
 *
 * The coach reads everything about the athlete through the circle team, the
 * same as every other coach screen, so there is no branch on who is asking.
 * The one read that is different in kind is the link itself: the coach is
 * stamped readable on their own link row, revoked or not (see
 * `linkPermissions`), which is what lets the screen say "no longer linked"
 * instead of showing a page of empty panels.
 */

const PAGE = 100;

const str = (value: unknown): string | null => (typeof value === "string" && value ? value : null);
const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** This coach's link rows with this athlete: at most one, by the unique index. */
export async function fetchLinkRows(coachId: string, athleteId: string): Promise<CoachLinkRow[]> {
  const { tables, databaseId } = browserAppwrite();
  const page = await tables.listRows({
    databaseId,
    tableId: "coach_athlete_links",
    queries: [Query.equal("coach_id", coachId), Query.equal("athlete_id", athleteId), Query.limit(5)],
  });

  return page.rows.map((raw) => {
    const row = raw as unknown as Record<string, unknown>;
    return {
      coachId: str(row.coach_id) ?? "",
      athleteId: str(row.athlete_id) ?? "",
      // Anything that is not literally "active" is treated as revoked. Fails
      // closed: an unreadable status must not show a training history.
      status: row.status === "active" ? "active" : "revoked",
      linkedAt: str(row.linked_at),
      revokedAt: str(row.revoked_at),
      suggestionsMode: parseSuggestionMode(row.suggestions_mode),
    } satisfies CoachLinkRow;
  });
}

/**
 * Every weekly rollup for this athlete, across every lift, in one paged read.
 *
 * One query for the whole screen rather than one per lift tab: switching tabs
 * should be instant, and the build plan holds coach screens to 2.5s.
 */
export async function fetchAthleteRollups(athleteId: string): Promise<RollupWeek[]> {
  const { tables, databaseId } = browserAppwrite();
  const weeks: RollupWeek[] = [];
  let cursor: string | null = null;

  for (;;) {
    const queries = [Query.equal("athlete_id", athleteId), Query.orderAsc("$id"), Query.limit(PAGE)];
    if (cursor) queries.push(Query.cursorAfter(cursor));

    const page = await tables.listRows({ databaseId, tableId: "stats_rollups", queries });
    if (page.rows.length === 0) break;

    for (const raw of page.rows) {
      const row = raw as unknown as Record<string, unknown>;
      const weekStart = new Date(String(row.week_start));
      const exerciseId = str(row.exercise_id);
      // A row with no lift or no readable week cannot be placed. Skipped, not
      // guessed: one bad row must not move a whole line.
      if (!exerciseId || Number.isNaN(weekStart.getTime())) continue;
      weeks.push({
        exerciseId,
        weekStart,
        bestE1rmKg: num(row.best_e1rm_kg),
        bestSingleKg: num(row.best_single_kg),
        bestSingleReps: num(row.best_single_reps),
        bestReps: num(row.best_reps),
        bestRepsLoadKg: num(row.best_reps_load_kg),
      });
    }

    if (page.rows.length < PAGE) break;
    cursor = page.rows[page.rows.length - 1].$id;
  }

  return weeks;
}
