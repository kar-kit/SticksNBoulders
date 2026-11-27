"use client";

import { ID, Query } from "appwrite";
import { browserAppwrite } from "@/appwrite/browser-client";
import { authenticRows } from "@/appwrite/documents";
import { SICK_TABLE } from "@/appwrite/documents/sick";
import { toSpell, type SickSpell } from "./sick";

/**
 * Reading call-ins (F31). Sending them is sick-queue.ts.
 *
 * The coach reads through the circle team like everything else, so the same
 * read serves the athlete's own Today, the Roster and the Athlete View: a coach
 * who is not linked to an athlete is refused their rows by Appwrite, and one
 * who is gets exactly the athletes it asked for.
 */

const PAGE = 100;
/** Far more call-ins than anyone makes in a year. Past it a read stops, never loops. */
const MAX_ROWS = 400;

/** `sk-` and Appwrite's 20 unique characters: 23, a legal row id, as `st-` is for a set. */
export const newClientSickId = (): string => `sk-${ID.unique()}`;

/**
 * Every call-in for these athletes that has not finished before `since` (a
 * YYYY-MM-DD day), earliest end first. Only rows the athlete wrote: a forged
 * one would put them off sick on their coach's Roster
 * (appwrite/documents/provenance.ts), and one that is not a real range is
 * dropped, as validate-row would delete it.
 *
 * One query for every athlete at once (`equal()` takes an array), so a coach
 * with eight athletes pays the same round trip as a coach with one.
 */
export async function fetchSickDays(athleteIds: readonly string[], since: string): Promise<SickSpell[]> {
  if (athleteIds.length === 0) return [];
  const { tables, databaseId } = browserAppwrite();
  const spells: SickSpell[] = [];
  let cursor: string | null = null;
  let fetched = 0;

  while (fetched < MAX_ROWS) {
    const queries = [
      Query.equal("athlete_id", [...athleteIds]),
      Query.greaterThanEqual("ends_on", since),
      Query.orderAsc("ends_on"),
      Query.limit(PAGE),
    ];
    if (cursor) queries.push(Query.cursorAfter(cursor));
    const page = await tables.listRows({ databaseId, tableId: SICK_TABLE, queries });
    fetched += page.rows.length;
    for (const row of authenticRows(SICK_TABLE, page.rows)) {
      const spell = toSpell(row as unknown as Record<string, unknown>);
      if (spell) spells.push(spell);
    }
    if (page.rows.length < PAGE) break;
    cursor = page.rows[page.rows.length - 1].$id;
  }
  return spells;
}
