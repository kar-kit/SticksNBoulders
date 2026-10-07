import { browserAppwrite } from "@/appwrite/browser-client";
import { parsePrescriptionRow } from "@/lib/programming/program";
import type { TracedLine } from "./adjust-program";

/**
 * The one read "Adjust program" adds. Nothing here writes.
 *
 * A point read of the line a set was logged against, through the coach's own
 * session, so the permissions stamped on the row decide whether it comes back.
 * Null for a line that has since been deleted, was never readable, or is not
 * a line: all three mean "fall back", not "fail".
 */
export async function fetchTracedLine(prescriptionId: string): Promise<TracedLine | null> {
  const { tables, databaseId } = browserAppwrite();
  const row = await tables.getRow({ databaseId, tableId: "prescriptions", rowId: prescriptionId }).catch(() => null);
  const line = parsePrescriptionRow(row);
  if (!line || !row) return null;
  const athleteId = (row as unknown as { athlete_id?: unknown }).athlete_id;
  return {
    id: line.id,
    athleteId: typeof athleteId === "string" && athleteId ? athleteId : null,
    programId: line.programId,
    weekId: line.weekId,
    dayId: line.dayId,
  };
}
