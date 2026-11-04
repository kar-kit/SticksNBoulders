import type { Row } from "@/appwrite/documents/provenance";
import { PUSH_TABLE, prefsOf } from "@/appwrite/documents/push";
import { deliver, targetOf, type DeliverDeps, type DeliverResult } from "./deliver";
import { clipMessage, replyMessage, type PushMessage } from "./message";
import { classifyEvent, isFreshClip, recipientsFor } from "./notify-event";

/**
 * The notify Function's whole job, minus the transport (F27).
 *
 * functions/notify/src/main.ts wires this to fetch and web-push; the tests
 * wire it to fakes. One database event in, at most one message per coach
 * device out.
 */

export interface NotifyReader {
  /** Rows where every column equals the value given (an array is "any of"). */
  listRows(tableId: string, where: Readonly<Record<string, string | readonly string[]>>, limit: number): Promise<Row[]>;
  getRow(tableId: string, rowId: string): Promise<Row | null>;
  /** The file's `$createdAt`, or null when it cannot be read. */
  fileCreatedAt(bucketId: string, fileId: string): Promise<string | null>;
}

export interface DispatchDeps extends DeliverDeps {
  reader: NotifyReader;
  now: () => Date;
}

export type DispatchResult =
  | { action: "skip"; reason: string }
  | ({ action: "sent"; kind: PushMessage["kind"]; tag: string; recipients: number; devices: number } & DeliverResult);

/** One athlete's coaches, at most. A coach with more than a handful of devices is not a case to page for. */
const LINKS_PAGE = 25;
const DEVICES_PAGE = 100;

const str = (row: Row | null, key: string): string | null =>
  row && typeof row[key] === "string" && row[key] ? (row[key] as string) : null;

export async function dispatch(deps: DispatchDeps, event: string, row: Row): Promise<DispatchResult> {
  const classified = classifyEvent(event, row);
  if (classified.kind === "skip") return { action: "skip", reason: classified.reason };

  if (classified.kind === "clip" && classified.needsFreshFile) {
    const createdAt = await deps.reader.fileCreatedAt("set_videos", classified.videoFileId);
    if (!isFreshClip(createdAt, deps.now())) {
      return { action: "skip", reason: "set updated, clip is not new" };
    }
  }

  const links = await deps.reader.listRows(
    "coach_athlete_links",
    { athlete_id: classified.athleteId, status: "active" },
    LINKS_PAGE,
  );
  const coaches = recipientsFor(links, classified.athleteId);
  if (coaches.length === 0) return { action: "skip", reason: "no active coach to tell" };

  const wants = classified.kind === "clip" ? "clips" : "replies";
  const devices = (await deps.reader.listRows(PUSH_TABLE, { user_id: coaches }, DEVICES_PAGE)).filter(
    // Belt and braces over the query, as for the links: only a recipient's
    // device, and only one that wants this kind.
    (device) => coaches.includes(device.user_id as string) && prefsOf(device)[wants],
  );
  const targets = devices.map(targetOf).filter((t) => t !== null);
  if (targets.length === 0) return { action: "skip", reason: `no coach device wants ${wants}` };

  const athleteName = str(await deps.reader.getRow("profiles", classified.athleteId).catch(() => null), "display_name");
  const message =
    classified.kind === "clip"
      ? clipMessage({
          athleteId: classified.athleteId,
          athleteName,
          setId: classified.setId,
          videoFileId: classified.videoFileId,
          exerciseName: classified.exerciseId
            ? str(await deps.reader.getRow("exercises", classified.exerciseId).catch(() => null), "name")
            : null,
        })
      : replyMessage({
          athleteId: classified.athleteId,
          athleteName,
          setId: classified.setId,
          commentId: classified.commentId,
          body: classified.body,
        });

  const result = await deliver(deps, targets, message);
  return {
    action: "sent",
    kind: message.kind,
    tag: message.tag,
    recipients: coaches.length,
    devices: targets.length,
    ...result,
  };
}
