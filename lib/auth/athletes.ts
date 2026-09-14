import { Query } from "appwrite";
import { browserAppwrite } from "@/appwrite/browser-client";
import type { CoachAthlete } from "@/components/shell/coach-shell";

/**
 * The names for a coach's rail.
 *
 * Profiles are readable by a coach because they are in the athlete's circle. An
 * athlete who has not completed onboarding has no profile row yet, and showing
 * a raw id would be worse than showing nothing -- so they are simply left out
 * rather than rendered as a hex string.
 */
export async function fetchAthleteNames(athleteIds: readonly string[]): Promise<CoachAthlete[]> {
  if (athleteIds.length === 0) return [];

  const { tables, databaseId } = browserAppwrite();
  const rows = await tables.listRows({
    databaseId,
    tableId: "profiles",
    queries: [
      Query.equal("user_id", [...athleteIds]),
      Query.limit(athleteIds.length),
      Query.select(["user_id", "display_name"]),
    ],
  });

  return rows.rows
    .map((row) => row as unknown as { user_id?: string; display_name?: string })
    .filter((row): row is { user_id: string; display_name: string } =>
      Boolean(row.user_id && row.display_name),
    )
    .map((row) => ({ id: row.user_id, name: row.display_name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
