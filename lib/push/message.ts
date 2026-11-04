import { COACH_REVIEW_PATH, PUSH_SETTINGS_PATH, coachClipPath, coachThreadPath } from "./links";

/**
 * What a push carries (F27). The service worker in public/sw.js reads it.
 *
 * Collapse happens in the worker, not here. Every message names a `tag` (one
 * per athlete per kind) and a `key` (the clip or reply it is about). The
 * worker keeps the keys already showing under that tag, so six clips from one
 * session become one notification that reads "Joey uploaded 6 clips" and
 * buzzes once per new clip -- and a second event about the SAME clip (both
 * event spellings firing, the poster landing a moment after the clip)
 * replaces the notification silently instead of buzzing again.
 *
 * Counting on the device rather than on the server is deliberate: the server
 * cannot know what the coach has already dismissed, and "3 new since you last
 * looked" is the number that is useful on a lock screen. [Inference]
 */

export type PushKind = "clip" | "reply" | "test";

export interface PushMessage {
  /** Payload version, so a worker from an older build can tell. */
  v: 1;
  kind: PushKind;
  /** Notifications with the same tag replace one another. */
  tag: string;
  /** What this one is about. The worker counts distinct keys under a tag. */
  key: string;
  /** The athlete's name, for the collapsed title. */
  who: string;
  title: string;
  body: string;
  /** Where a tap goes while this is the only key under its tag. */
  url: string;
  /** Where a tap goes once several have collapsed. */
  groupUrl: string;
}

/** A lock screen shows about this much of a name before it truncates anyway. */
const NAME_MAX = 40;
/** And about this much of a reply. */
const SNIPPET_MAX = 140;

const clip = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
};

export const UNNAMED_ATHLETE = "Your athlete";

const nameOf = (name: string | null | undefined): string => clip(name || "", NAME_MAX) || UNNAMED_ATHLETE;

export function clipTag(athleteId: string): string {
  return `clips:${athleteId}`;
}

export function replyTag(athleteId: string): string {
  return `replies:${athleteId}`;
}

export interface ClipMessageInput {
  athleteId: string;
  athleteName: string | null;
  setId: string;
  videoFileId: string;
  exerciseName: string | null;
}

export function clipMessage(input: ClipMessageInput): PushMessage {
  const who = nameOf(input.athleteName);
  return {
    v: 1,
    kind: "clip",
    tag: clipTag(input.athleteId),
    // The clip, not the set: a replaced clip is a new thing to watch.
    key: `${input.setId}:${input.videoFileId}`,
    who,
    title: `${who} uploaded a clip`,
    body: input.exerciseName ? `${clip(input.exerciseName, 60)} · ready to review` : "Ready to review",
    url: coachClipPath(input.athleteId, input.setId),
    groupUrl: COACH_REVIEW_PATH,
  };
}

export interface ReplyMessageInput {
  athleteId: string;
  athleteName: string | null;
  setId: string;
  commentId: string;
  body: string;
}

export function replyMessage(input: ReplyMessageInput): PushMessage {
  const who = nameOf(input.athleteName);
  const url = coachThreadPath(input.athleteId, input.setId);
  return {
    v: 1,
    kind: "reply",
    tag: replyTag(input.athleteId),
    key: input.commentId,
    who,
    title: `${who} replied`,
    body: clip(input.body, SNIPPET_MAX) || "New reply",
    url,
    // Several replies may be on several sets; the newest one's thread is the
    // best single place to land until F26's inbox exists.
    groupUrl: url,
  };
}

export function testMessage(now: Date): PushMessage {
  return {
    v: 1,
    kind: "test",
    tag: "test",
    // Unique per press, so a second test buzzes too.
    key: `test:${now.getTime()}`,
    who: "Sticks N Boulders",
    title: "Notifications are on",
    body: "This is what a new clip or reply will look like.",
    url: PUSH_SETTINGS_PATH,
    groupUrl: PUSH_SETTINGS_PATH,
  };
}

/**
 * The collapsed title for `count` distinct keys under one tag. The worker has
 * its own copy (public/sw.js has no build step); sw-push.test.ts holds the two
 * to the same answers.
 */
export function collapsedTitle(kind: PushKind, who: string, count: number): string {
  if (count <= 1 || kind === "test") return "";
  return kind === "clip" ? `${who} uploaded ${count} clips` : `${who} replied ${count} times`;
}
