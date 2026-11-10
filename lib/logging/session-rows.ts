import type { SessionRecord } from "./session";

/**
 * A stored session row, as the app reads it.
 *
 * Moved out of session-store.ts (F29) so the read API maps a row exactly as
 * History does, without importing the browser client.
 */

export interface SessionRow {
  $id: string;
  client_session_id?: unknown;
  started_at?: unknown;
  finished_at?: unknown;
  set_count?: unknown;
  tonnage_kg?: unknown;
  notes?: unknown;
  program_day_id?: unknown;
  name?: unknown;
}

export const asDate = (value: unknown): Date | null => {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const asNumber = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

/** Skips a row rather than throwing: one bad row must not hide a live session. */
export function toSession(row: SessionRow): SessionRecord | null {
  const startedAt = asDate(row.started_at);
  if (!startedAt) return null;
  return {
    id: row.$id,
    clientSessionId: typeof row.client_session_id === "string" ? row.client_session_id : "",
    startedAt,
    finishedAt: asDate(row.finished_at),
    setCount: asNumber(row.set_count),
    tonnageKg: asNumber(row.tonnage_kg),
    notes: typeof row.notes === "string" ? row.notes : null,
    programDayId: typeof row.program_day_id === "string" && row.program_day_id ? row.program_day_id : null,
    name: typeof row.name === "string" && row.name.trim() ? row.name : null,
  };
}
