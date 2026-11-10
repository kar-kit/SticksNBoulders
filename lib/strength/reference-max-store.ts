import { browserAppwrite } from "@/appwrite/browser-client";
import type { EstimatedInput, ReferenceMaxEntry, StoredKind } from "./reference-max";
import { readEstimatedMaxes, readReferenceMaxes, type MaxReader } from "./reference-max-read";

/**
 * Reading an athlete's reference maxes, from the browser.
 *
 * The reads themselves live in reference-max-read.ts, shared with the read
 * API (F29); this passes them the signed-in session's tables.
 *
 * The coach reads through the circle team, so this works unchanged whether the
 * caller is the athlete or their coach, and stops working the moment a link is
 * revoked. There is no branch on who is asking.
 */

/**
 * The most recent maxes entered for this athlete, across every exercise.
 * Newest first, capped; see reference-max-read.ts.
 */
export async function fetchReferenceMaxes(athleteId: string): Promise<ReferenceMaxEntry[]> {
  const { tables, databaseId } = browserAppwrite();
  return readReferenceMaxes(tables as unknown as MaxReader, databaseId, athleteId);
}

/** The best e1RM on each lift, off the rollups. See reference-max-read.ts. */
export async function fetchEstimatedMaxes(athleteId: string): Promise<Map<string, EstimatedInput>> {
  const { tables, databaseId } = browserAppwrite();
  return readEstimatedMaxes(tables as unknown as MaxReader, databaseId, athleteId);
}

export interface SetMaxRequest {
  athleteId: string;
  exerciseId: string;
  kind: StoredKind;
  valueKg: number;
  /** Omitted means "from now". */
  effectiveFrom?: Date;
}

/**
 * Sets a max, through the server.
 *
 * Not a browser write, and that is the design rather than an inconvenience:
 * Appwrite constrains who may read a row but not what the row claims, so a
 * client able to create one could create it carrying another athlete's id.
 * The route checks the caller is the athlete or actively coaches them.
 *
 * Called from the inline editor in CURRENT MAXES on Athlete View (Order 25).
 */
export async function setReferenceMax(input: SetMaxRequest): Promise<string> {
  const { account } = browserAppwrite();
  const { jwt } = await account.createJWT();

  const response = await fetch("/api/reference-max", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${jwt}` },
    body: JSON.stringify({
      athleteId: input.athleteId,
      exerciseId: input.exerciseId,
      kind: input.kind,
      valueKg: input.valueKg,
      effectiveFrom: input.effectiveFrom?.toISOString(),
    }),
  });

  const body = (await response.json().catch(() => ({}))) as { rowId?: string; reason?: string };
  if (!response.ok) {
    // The server's reason when it has one -- "A max over 600kg is a typo" is
    // worth showing; "failed" is not.
    throw new Error(body.reason ?? `could not set max: ${response.status}`);
  }
  return body.rowId ?? "";
}

/** Removes a max. The undo for a typo, and the table's only edit. */
export async function removeReferenceMax(rowId: string): Promise<void> {
  const { account } = browserAppwrite();
  const { jwt } = await account.createJWT();

  const response = await fetch(`/api/reference-max?id=${encodeURIComponent(rowId)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${jwt}` },
  });
  if (!response.ok) throw new Error(`could not remove max: ${response.status}`);
}
