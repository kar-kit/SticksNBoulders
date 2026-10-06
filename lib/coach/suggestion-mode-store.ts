"use client";

import { Query } from "appwrite";
import { browserAppwrite } from "@/appwrite/browser-client";
import { readLocal, writeLocal } from "@/lib/local-store";
import {
  UNKNOWN_SUGGESTION_MODE,
  isSuggestionMode,
  modeForAthlete,
  type SuggestionMode,
} from "./suggestion-mode";

/**
 * Order 28's reads and its one write.
 *
 * Reads go straight to Appwrite: the link row is stamped readable by the
 * athlete and the coach and by nobody else, so neither needs a server hop to
 * see the switch. The write goes through /api/link/suggestions, because the
 * table is server-only and the route is what checks the caller is the coach.
 */

const KEY = "snb.suggestion-mode";

interface Stored {
  athleteId: string;
  mode: SuggestionMode;
  /** When it was read. Kept so a stale copy can be explained, not trusted more. */
  readAt: string;
}

/** The athlete's own mode, read live from their active link rows. */
export async function fetchMySuggestionMode(athleteId: string): Promise<SuggestionMode> {
  const { tables, databaseId } = browserAppwrite();
  const page = await tables.listRows({
    databaseId,
    tableId: "coach_athlete_links",
    queries: [
      Query.equal("athlete_id", athleteId),
      Query.equal("status", "active"),
      Query.select(["suggestions_mode"]),
      Query.limit(5),
    ],
    ttl: 0,
  });
  return modeForAthlete(
    page.rows.map((row) => ({ suggestionsMode: (row as unknown as Record<string, unknown>).suggestions_mode })),
  );
}

export function rememberSuggestionMode(athleteId: string, mode: SuggestionMode, now: Date = new Date()): void {
  writeLocal(KEY, { athleteId, mode, readAt: now.toISOString() } satisfies Stored);
}

/** The last mode this device read, if it was this athlete's. */
export function recallSuggestionMode(athleteId: string): SuggestionMode | null {
  const stored = readLocal<Partial<Stored>>(KEY);
  if (!stored || stored.athleteId !== athleteId) return null;
  return isSuggestionMode(stored.mode) ? stored.mode : null;
}

export type ModeSource = "live" | "cached" | "unknown";

/**
 * The mode the logger should run under right now.
 *
 * Live when Appwrite answers, and the answer is remembered. With no signal,
 * the last answer this device saw -- a coach's switch does not stop applying
 * because the gym is in a basement. With neither, `UNKNOWN_SUGGESTION_MODE`
 * (held): see suggestion-mode.ts for why the unknown case leans that way.
 */
export async function loadSuggestionMode(
  athleteId: string,
): Promise<{ mode: SuggestionMode; source: ModeSource }> {
  try {
    const mode = await fetchMySuggestionMode(athleteId);
    rememberSuggestionMode(athleteId, mode);
    return { mode, source: "live" };
  } catch {
    const cached = recallSuggestionMode(athleteId);
    return cached ? { mode: cached, source: "cached" } : { mode: UNKNOWN_SUGGESTION_MODE, source: "unknown" };
  }
}

/** The coach's write. Throws on anything but success, so the UI can roll back. */
export async function saveSuggestionMode(athleteId: string, mode: SuggestionMode): Promise<SuggestionMode> {
  const { account } = browserAppwrite();
  const { jwt } = await account.createJWT();
  const response = await fetch("/api/link/suggestions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ athleteId, mode }),
  });
  if (!response.ok) {
    const error = new Error(`suggestion mode not saved: ${response.status}`) as Error & { code: number };
    error.code = response.status;
    throw error;
  }
  const body = (await response.json()) as { mode?: unknown };
  return isSuggestionMode(body.mode) ? body.mode : mode;
}
