import { isAuthentic, type Row } from "@/appwrite/documents/provenance";

/**
 * Which database events are worth a coach's attention (F27). Pure.
 *
 * Two things notify, both from the coach's ask: an athlete putting a clip on
 * a set, and an athlete answering in a thread. Nothing else does -- not a
 * coach's own comment or review, not a reaction, not a set edit that leaves
 * the clip alone.
 */

export type NotifyEvent =
  | {
      kind: "clip";
      athleteId: string;
      setId: string;
      videoFileId: string;
      exerciseId: string;
      /**
       * An update event, which carries the row as it is now and nothing about
       * how it was. The caller must check the clip is new (`isFreshClip`)
       * before treating this as an upload rather than an edit of a set that
       * already had one.
       */
      needsFreshFile: boolean;
    }
  | { kind: "reply"; athleteId: string; setId: string; commentId: string; body: string }
  | { kind: "skip"; reason: string };

const str = (row: Row, key: string): string => (typeof row[key] === "string" ? (row[key] as string) : "");

/** `create`, `update` or `delete`: the last segment of either event spelling. */
export function eventOp(event: string): string {
  return event.split(".").pop() ?? "";
}

export function classifyEvent(event: string, row: Row): NotifyEvent {
  const tableId = str(row, "$tableId") || str(row, "$collectionId");
  const op = eventOp(event);

  if (tableId === "sets") {
    if (op !== "create" && op !== "update") return { kind: "skip", reason: `sets ${op || "?"}` };
    const videoFileId = str(row, "video_file_id");
    if (!videoFileId) return { kind: "skip", reason: "set has no clip" };
    // A forged set (somebody else's athlete_id) is deleted by validate-row
    // within seconds; it must not reach a coach's lock screen first.
    if (!isAuthentic("sets", row)) return { kind: "skip", reason: "set fails the authorship check" };
    return {
      kind: "clip",
      athleteId: str(row, "athlete_id"),
      setId: str(row, "$id"),
      videoFileId,
      exerciseId: str(row, "exercise_id"),
      needsFreshFile: op === "update",
    };
  }

  if (tableId === "set_comments") {
    if (op !== "create") return { kind: "skip", reason: `set_comments ${op || "?"}` };
    const athleteId = str(row, "athlete_id");
    const authorId = str(row, "author_id");
    // The coach's own words never notify the coach. Only the athlete whose
    // set it is answering counts as an athlete reply.
    if (!athleteId || authorId !== athleteId) return { kind: "skip", reason: "comment is not the athlete's" };
    if (!isAuthentic("set_comments", row)) return { kind: "skip", reason: "comment fails the authorship check" };
    return {
      kind: "reply",
      athleteId,
      setId: str(row, "set_id"),
      commentId: str(row, "$id"),
      body: str(row, "body"),
    };
  }

  // comment_reactions, set_reviews and everything else: never.
  return { kind: "skip", reason: `${tableId || "unknown table"} does not notify` };
}

/**
 * How recently a clip's file must have been created for a set UPDATE to count
 * as an upload. The client attaches the clip the moment the upload finishes
 * (attachVideo in write.ts), so a real attach lands seconds after the file.
 * Ten minutes covers a slow finalise; an edit to reps an hour later does not
 * pass. [Inference] -- see docs/push-notifications.md for what slips through.
 */
export const CLIP_FRESH_MS = 10 * 60 * 1000;
/** Clock skew between the instance and the function container. */
const SKEW_MS = 60 * 1000;

export function isFreshClip(fileCreatedAt: string | null, now: Date): boolean {
  if (!fileCreatedAt) return false;
  const created = new Date(fileCreatedAt).getTime();
  if (Number.isNaN(created)) return false;
  const age = now.getTime() - created;
  return age >= -SKEW_MS && age <= CLIP_FRESH_MS;
}

/**
 * Who hears about something athlete `athleteId` did: every coach on an ACTIVE
 * link to them, except the athlete themselves (a self-coached athlete is
 * linked to their own account and must not notify themselves).
 *
 * Belt and braces over the query that fetched `links`: each row must say
 * what was asked for, so a query that dropped a filter cannot widen it.
 */
export function recipientsFor(links: readonly Row[], athleteId: string): string[] {
  const coaches = new Set<string>();
  for (const link of links) {
    if (link.status !== "active" || link.athlete_id !== athleteId) continue;
    const coachId = str(link, "coach_id");
    if (coachId && coachId !== athleteId) coaches.add(coachId);
  }
  return [...coaches];
}
