import { Query } from "appwrite";
import { browserAppwrite } from "@/appwrite/browser-client";
import { authenticRows, avatarOf } from "@/appwrite/documents";
import type { CoachAthlete } from "@/components/shell/coach-shell";
import { rememberAvatars } from "@/lib/profile/avatar-cache";

/**
 * The names for a coach's rail.
 *
 * Profiles are readable by a coach because they are in the athlete's circle. An
 * athlete who has not completed onboarding has no profile row yet, and showing
 * a raw id would be worse than showing nothing -- so they are simply left out
 * rather than rendered as a hex string.
 *
 * The same read carries each athlete's picture id, which goes into the avatar
 * registry on the way past (lib/profile/avatar-cache.ts): the rail, roster and
 * queue all call this already, so faces cost no profile request of their own.
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
      Query.select(["user_id", "display_name", "avatar_file_id"]),
    ],
  });

  // Only profiles their user wrote, so a stranger cannot rename an athlete
  // in the coach's rail (appwrite/documents/provenance.ts).
  const athletes = authenticRows("profiles", rows.rows as unknown as Record<string, unknown>[])
    .filter((row): row is Record<string, unknown> & { user_id: string; display_name: string } =>
      Boolean(typeof row.user_id === "string" && row.user_id && typeof row.display_name === "string" && row.display_name),
    )
    .map((row) => ({ id: row.user_id, name: row.display_name, avatarFileId: avatarOf(row) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  rememberAvatars(athletes.map((a) => [a.id, a.avatarFileId] as const));
  return athletes;
}
