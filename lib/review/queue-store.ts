"use client";

import { Query } from "appwrite";
import { browserAppwrite } from "@/appwrite/browser-client";
import { browserWriteDeps } from "@/appwrite/documents/browser-writer";
import { markSetReviewed, unmarkSetReviewed, type Actor } from "@/appwrite/documents";
import type { ClipSet } from "./queue";

/**
 * Reading the Review Queue, and clearing it.
 *
 * Two queries and a subtraction, because Appwrite has no joins: every set with
 * a clip on it, and every review this coach has already written. `isNotNull` on
 * `video_file_id` is real and composes with an `equal()` IN filter -- verified
 * against the live instance, because if it had not been the queue would have
 * needed a denormalised `has_video` column and a backfill.
 *
 * The coach reads the sets through the circle team, exactly as they read
 * everything else, so there is no branch anywhere for who is asking and the
 * whole screen stops working the moment a link is revoked. That is the
 * intended behaviour rather than a gap -- see the clip route for what a
 * revoked coach sees mid-scrub.
 */

/** A season of filmed sets. Past this the queue needs a watermark, not a cap. */
const MAX_CLIPS = 300;
const MAX_REVIEWS = 1000;
const PAGE = 100;

interface SetRow {
  $id: string;
  athlete_id?: unknown;
  exercise_id?: unknown;
  session_id?: unknown;
  set_index?: unknown;
  load_kg?: unknown;
  reps?: unknown;
  rpe?: unknown;
  e1rm_kg?: unknown;
  logged_at?: unknown;
  video_file_id?: unknown;
  notes?: unknown;
}

const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const maybeNum = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const str = (value: unknown): string => (typeof value === "string" ? value : "");

function toClip(raw: SetRow): ClipSet | null {
  const videoFileId = str(raw.video_file_id);
  const athleteId = str(raw.athlete_id);
  const loggedAt = str(raw.logged_at);
  // A clip with no owner, no file or no time cannot be placed on the screen.
  // Dropped rather than rendered half-blank, which would look like a bug in
  // the player rather than a bad row.
  if (!videoFileId || !athleteId || !loggedAt) return null;

  return {
    id: raw.$id,
    athleteId,
    exerciseId: str(raw.exercise_id),
    sessionId: str(raw.session_id),
    setIndex: num(raw.set_index),
    loadKg: num(raw.load_kg),
    reps: num(raw.reps),
    rpe: maybeNum(raw.rpe),
    e1rmKg: maybeNum(raw.e1rm_kg),
    loggedAt,
    videoFileId,
    notes: str(raw.notes) || null,
  };
}

/**
 * Every clip belonging to this coach's athletes.
 *
 * One query for all of them rather than one per athlete: `equal()` takes an
 * array, and a coach with eight athletes should not pay eight round trips on
 * the screen whose whole metric is how fast it clears.
 */
export async function fetchClips(athleteIds: readonly string[]): Promise<ClipSet[]> {
  if (athleteIds.length === 0) return [];

  const { tables, databaseId } = browserAppwrite();
  const clips: ClipSet[] = [];
  let cursor: string | null = null;

  while (clips.length < MAX_CLIPS) {
    const queries = [
      Query.equal("athlete_id", [...athleteIds]),
      Query.isNotNull("video_file_id"),
      // Newest first, then reversed into queue order by buildQueue. A cap on
      // an ascending read would keep the OLDEST clips and silently drop
      // everything filmed this month -- the same trap reference maxes hit.
      Query.orderDesc("$id"),
      Query.limit(PAGE),
    ];
    if (cursor) queries.push(Query.cursorAfter(cursor));

    const page = await tables.listRows({ databaseId, tableId: "sets", queries });
    if (page.rows.length === 0) break;

    for (const row of page.rows) {
      const clip = toClip(row as unknown as SetRow);
      if (clip) clips.push(clip);
    }

    if (page.rows.length < PAGE) break;
    cursor = page.rows[page.rows.length - 1].$id;
  }

  return clips;
}

/**
 * The set ids this coach has already cleared.
 *
 * Their own rows only. Louis clearing a clip must not clear it for Ruairi --
 * they coach at the same gym and may share an athlete, and a queue that
 * empties itself because somebody else watched the video is a queue that has
 * quietly stopped being a record of your own work.
 */
export async function fetchReviewedSetIds(coachId: string): Promise<Set<string>> {
  const { tables, databaseId } = browserAppwrite();
  const reviewed = new Set<string>();
  let cursor: string | null = null;

  while (reviewed.size < MAX_REVIEWS) {
    const queries = [
      Query.equal("coach_id", coachId),
      Query.orderDesc("$id"),
      Query.limit(PAGE),
      Query.select(["set_id"]),
    ];
    if (cursor) queries.push(Query.cursorAfter(cursor));

    const page = await tables.listRows({ databaseId, tableId: "set_reviews", queries });
    if (page.rows.length === 0) break;

    for (const row of page.rows) {
      const setId = str((row as unknown as { set_id?: unknown }).set_id);
      if (setId) reviewed.add(setId);
    }

    if (page.rows.length < PAGE) break;
    cursor = page.rows[page.rows.length - 1].$id;
  }

  return reviewed;
}

/** The sets of one session, for the "set 3 of 4" line. */
export async function fetchSessionSets(
  sessionId: string,
): Promise<{ exerciseId: string; setIndex: number }[]> {
  if (!sessionId) return [];
  const { tables, databaseId } = browserAppwrite();
  const page = await tables.listRows({
    databaseId,
    tableId: "sets",
    queries: [Query.equal("session_id", sessionId), Query.limit(PAGE), Query.select(["exercise_id", "set_index"])],
  });
  return page.rows.map((row) => {
    const raw = row as unknown as { exercise_id?: unknown; set_index?: unknown };
    return { exerciseId: str(raw.exercise_id), setIndex: num(raw.set_index) };
  });
}

export interface RecentSet {
  loggedAt: string;
  loadKg: number;
  reps: number;
  rpe: number | null;
  e1rmKg: number | null;
}

/**
 * The last few sets of this lift, for the LAST 4 SETS panel.
 *
 * Read straight off `sets` rather than off a rollup, and this is the one place
 * that is right: a rollup is a weekly aggregate, and what a coach wants here is
 * the individual sets that came before this one -- "175 x 3 RPE 8.5" is not a
 * number any aggregate holds.
 */
export async function fetchRecentSets(
  athleteId: string,
  exerciseId: string,
  before: string,
  limit = 4,
): Promise<RecentSet[]> {
  if (!athleteId || !exerciseId) return [];
  const { tables, databaseId } = browserAppwrite();
  const page = await tables.listRows({
    databaseId,
    tableId: "sets",
    queries: [
      Query.equal("athlete_id", athleteId),
      Query.equal("exercise_id", exerciseId),
      Query.lessThan("logged_at", before),
      Query.equal("is_warmup", false),
      Query.orderDesc("logged_at"),
      Query.limit(limit),
    ],
  });
  return page.rows.map((row) => {
    const raw = row as unknown as SetRow;
    return {
      loggedAt: str(raw.logged_at),
      loadKg: num(raw.load_kg),
      reps: num(raw.reps),
      rpe: maybeNum(raw.rpe),
      e1rmKg: maybeNum(raw.e1rm_kg),
    };
  });
}

/** Names for the exercises the queue actually mentions. */
export async function fetchExerciseNames(
  exerciseIds: readonly string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const unique = [...new Set(exerciseIds.filter(Boolean))];
  if (unique.length === 0) return names;

  const { tables, databaseId } = browserAppwrite();
  for (let i = 0; i < unique.length; i += PAGE) {
    const page = await tables.listRows({
      databaseId,
      tableId: "exercises",
      queries: [Query.equal("$id", unique.slice(i, i + PAGE)), Query.limit(PAGE), Query.select(["name"])],
    });
    for (const row of page.rows) {
      const name = str((row as unknown as { name?: unknown }).name);
      if (name) names.set(row.$id, name);
    }
  }
  return names;
}

/** Marks a clip cleared. The coach is the actor, not the athlete. */
export async function clearClip(coachId: string, athleteId: string, setId: string): Promise<void> {
  const actor: Actor = { userId: coachId };
  await markSetReviewed(browserWriteDeps(() => ""), actor, { athleteId, setId });
}

/** Puts one back, for a mis-tapped skip. */
export async function restoreClip(coachId: string, setId: string): Promise<void> {
  await unmarkSetReviewed(browserWriteDeps(() => ""), { userId: coachId }, setId);
}

/**
 * Playback URLs for a batch of clips.
 *
 * One request for the visible queue rather than one per clip. See
 * lib/video/ticket.ts for why a plain Appwrite file URL will not do.
 */
export async function fetchClipUrls(fileIds: readonly string[]): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  const unique = [...new Set(fileIds.filter(Boolean))];
  if (unique.length === 0) return urls;

  const { account } = browserAppwrite();
  const { jwt } = await account.createJWT();
  const response = await fetch("/api/clip", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ fileIds: unique }),
  });
  if (!response.ok) throw new Error(`clip urls failed: ${response.status}`);

  const body = (await response.json()) as { urls?: Record<string, string> };
  for (const [fileId, url] of Object.entries(body.urls ?? {})) urls.set(fileId, url);
  return urls;
}

/**
 * Live clips, without a refresh.
 *
 * The blueprint is specific: if Ruairi sits on this screen on a Sunday, clips
 * from athletes training that afternoon should arrive. Appwrite Realtime only
 * delivers rows the subscriber can read, so the circle team does the filtering
 * and there is nothing to check here.
 *
 * Both create AND update, and the update is the one that matters. Our own
 * upload flow sends the file first and records it on the set afterwards, so a
 * clip almost always reaches the queue as an update to a set that already
 * existed. A subscription listening only for creates would look right in a
 * test and never fire in a gym.
 */
export function subscribeToClips(databaseId: string, onChange: () => void): () => void {
  const { client } = browserAppwrite();
  return client.subscribe(`databases.${databaseId}.tables.sets.rows`, (message) => {
    const events = message.events ?? [];
    const touched = events.some((event) => event.endsWith(".create") || event.endsWith(".update"));
    if (touched) onChange();
  });
}
