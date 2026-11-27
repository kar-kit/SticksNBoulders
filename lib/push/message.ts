import { COACH_REVIEW_PATH, COACH_ROSTER_PATH, PUSH_SETTINGS_PATH, coachAthletePath, coachClipPath, coachThreadPath } from "./links";

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

export type PushKind = "clip" | "reply" | "sick" | "test";

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

export function sickTag(athleteId: string): string {
  return `sick:${athleteId}`;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "Fri 28 Nov" for a YYYY-MM-DD calendar day. By hand, in UTC, rather than
 * through Intl: the Function has no locale to ask, the day is already the
 * athlete's own, and a zone must never move it.
 */
function dayLabel(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  return `${DAY_NAMES[date.getUTCDay()]} ${date.getUTCDate()} ${MONTH_NAMES[date.getUTCMonth()]}`;
}

export interface SickMessageInput {
  athleteId: string;
  athleteName: string | null;
  sickId: string;
  startsOn: string;
  endsOn: string;
}

/**
 * The athlete called in sick (F31). The dates and nothing about why: the note
 * is health information and stays in the app, behind the coach's sign-in, not
 * on a lock screen. [SME to confirm] -- whether Ruairi wants the name there at
 * all follows the same question docs/push-notifications.md already asks of
 * reply text.
 */
export function sickMessage(input: SickMessageInput): PushMessage {
  const who = nameOf(input.athleteName);
  const url = coachAthletePath(input.athleteId);
  return {
    v: 1,
    kind: "sick",
    tag: sickTag(input.athleteId),
    key: input.sickId,
    who,
    title: `${who} called in sick`,
    body:
      input.startsOn === input.endsOn
        ? dayLabel(input.startsOn)
        : `${dayLabel(input.startsOn)} to ${dayLabel(input.endsOn)}`,
    url,
    // Several call-ins from one athlete collapse into one, and the Roster
    // is where everyone who is off sick is marked.
    groupUrl: COACH_ROSTER_PATH,
  };
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
    // best single place to land: opening it through F26's route marks it read.
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
  if (kind === "sick") return `${who} called in sick ${count} times`;
  return kind === "clip" ? `${who} uploaded ${count} clips` : `${who} replied ${count} times`;
}
