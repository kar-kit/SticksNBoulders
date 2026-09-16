"use client";

import { Query } from "appwrite";
import { browserAppwrite } from "@/appwrite/browser-client";
import { browserWriteDeps } from "@/appwrite/documents/browser-writer";
import { recordBodyweight, reviseBodyweight, type Actor } from "@/appwrite/documents";
import { checkWeight, type BodyweightEntry, type WeightRejection } from "./bodyweight";

/**
 * Reading and writing weigh-ins.
 *
 * The coach reads through the circle team like everything else, so the same two
 * functions serve the athlete's Bodyweight screen and the panel on the coach's
 * Athlete View. That panel is the actual point of the feature -- Ruairi asked
 * for this because he currently has to ask people what they weigh.
 */

const PAGE = 100;
/** Roughly three years of daily weigh-ins. Past that the chart wants thinning. */
const MAX_ENTRIES = 1000;

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const str = (value: unknown): string => (typeof value === "string" ? value : "");

function toEntry(raw: Record<string, unknown> & { $id: string }): BodyweightEntry | null {
  const weightKg = num(raw.weight_kg);
  const measuredOn = str(raw.measured_on);
  // A row with no weight or no day cannot be plotted or averaged. Dropped
  // rather than defaulted: a guessed bodyweight moves a DOTS score.
  if (weightKg === null || !measuredOn) return null;
  return {
    id: raw.$id,
    athleteId: str(raw.athlete_id),
    weightKg,
    measuredOn,
    recordedAt: str(raw.recorded_at),
  };
}

/**
 * Every weigh-in for this athlete, newest first.
 *
 * Ordered on `measured_on` rather than on `$id`. The id encodes the day, so the
 * two usually agree -- but somebody catching up on a missed morning writes an
 * id out of sequence with when they typed it, and the chart cares about the
 * morning.
 */
export async function fetchBodyweight(athleteId: string): Promise<BodyweightEntry[]> {
  if (!athleteId) return [];

  const { tables, databaseId } = browserAppwrite();
  const entries: BodyweightEntry[] = [];
  let cursor: string | null = null;

  while (entries.length < MAX_ENTRIES) {
    const queries = [
      Query.equal("athlete_id", athleteId),
      Query.orderDesc("measured_on"),
      Query.limit(PAGE),
    ];
    if (cursor) queries.push(Query.cursorAfter(cursor));

    const page = await tables.listRows({ databaseId, tableId: "bodyweight_entries", queries });
    if (page.rows.length === 0) break;

    for (const row of page.rows) {
      const entry = toEntry(row as unknown as Record<string, unknown> & { $id: string });
      if (entry) entries.push(entry);
    }

    if (page.rows.length < PAGE) break;
    cursor = page.rows[page.rows.length - 1].$id;
  }

  return entries;
}

export type LogOutcome =
  | { ok: true; entry: BodyweightEntry }
  | WeightRejection
  | { ok: false; reason: "failed" };

/**
 * Logs a weight for a day, replacing that day's if there is one.
 *
 * Create first, update on collision. Appwrite has no upsert, and the derived
 * row id turns what would be a race into a plain "there is already one of
 * these" -- so a second weigh-in on the same morning corrects the first rather
 * than sitting beside it and dragging the average.
 */
export async function logBodyweight(
  athleteId: string,
  weight: number,
  measuredOn: string,
): Promise<LogOutcome> {
  const checked = checkWeight(weight);
  if (!checked.ok) return checked;

  const actor: Actor = { userId: athleteId };
  const recordedAt = new Date();
  const deps = browserWriteDeps(() => "", () => recordedAt);
  const input = { weightKg: checked.weightKg, measuredOn };

  try {
    await recordBodyweight(deps, actor, input);
  } catch {
    try {
      await reviseBodyweight(deps, actor, input);
    } catch {
      return { ok: false, reason: "failed" };
    }
  }

  return {
    ok: true,
    entry: {
      // Not read back: the row that matters is written, and a second query to
      // see what we just sent costs a round trip on a one-tap flow.
      id: `${athleteId}_${measuredOn.replace(/-/g, "")}`,
      athleteId,
      weightKg: checked.weightKg,
      measuredOn,
      recordedAt: recordedAt.toISOString(),
    },
  };
}
