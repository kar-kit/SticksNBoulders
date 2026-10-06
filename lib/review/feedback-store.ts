"use client";

import { Query } from "appwrite";
import { browserAppwrite } from "@/appwrite/browser-client";
import { authenticRows } from "@/appwrite/documents";
import { fetchCommentsForAthlete, fetchCommentsForSets } from "./comment-store";
import type { Comment } from "./comments";
import { setIdsToFetch, type FeedbackSet } from "./feedback";

/**
 * Reading the athlete's feedback.
 *
 * Everything here reads through the athlete's own session and the circle-team
 * grant the coach's comments already carry, so there is no new permission
 * path. Writes -- the reply -- go through `submitComment`, the same helper the
 * coach posts with.
 *
 * The screen costs a fixed number of round trips however many comments there
 * are: the recent comments, the full threads on those sets, and the sets
 * themselves, each one query with an IN filter. No per-comment fetch anywhere.
 */

/** How far back the screen reads. A season of feedback, not an archive. */
const RECENT_COMMENTS = 100;
const PAGE = 100;

interface SetRow {
  $id: string;
  session_id?: unknown;
  exercise_id?: unknown;
  set_index?: unknown;
  load_kg?: unknown;
  reps?: unknown;
  rpe?: unknown;
  is_warmup?: unknown;
  logged_at?: unknown;
  video_file_id?: unknown;
  notes?: unknown;
}

const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const str = (value: unknown): string => (typeof value === "string" ? value : "");

function toFeedbackSet(raw: SetRow): FeedbackSet {
  return {
    id: raw.$id,
    sessionId: str(raw.session_id),
    exerciseId: str(raw.exercise_id),
    setIndex: num(raw.set_index),
    loadKg: num(raw.load_kg),
    reps: num(raw.reps),
    rpe: typeof raw.rpe === "number" && Number.isFinite(raw.rpe) ? raw.rpe : null,
    isWarmup: raw.is_warmup === true,
    loggedAt: str(raw.logged_at),
    videoFileId: str(raw.video_file_id) || null,
    notes: str(raw.notes) || null,
  };
}

/** Sets by id, one query per hundred. */
export async function fetchSetsByIds(setIds: readonly string[]): Promise<Map<string, FeedbackSet>> {
  const sets = new Map<string, FeedbackSet>();
  const unique = [...new Set(setIds.filter(Boolean))];
  if (unique.length === 0) return sets;

  const { tables, databaseId } = browserAppwrite();
  for (let i = 0; i < unique.length; i += PAGE) {
    const page = await tables.listRows({
      databaseId,
      tableId: "sets",
      queries: [
        Query.equal("$id", unique.slice(i, i + PAGE)),
        Query.limit(PAGE),
        Query.select([
          // Selected so the row can prove its athlete wrote it.
          "athlete_id",
          "session_id",
          "exercise_id",
          "set_index",
          "load_kg",
          "reps",
          "rpe",
          "is_warmup",
          "logged_at",
          "video_file_id",
          "notes",
        ]),
      ],
    });
    for (const row of authenticRows("sets", page.rows)) {
      const set = toFeedbackSet(row as unknown as SetRow);
      sets.set(set.id, set);
    }
  }
  return sets;
}

export interface FeedbackData {
  comments: Comment[];
  sets: Map<string, FeedbackSet>;
}

/**
 * Everything the feedback screen shows, in three queries.
 *
 * The recent comments first, because they name the sets. Then two reads in
 * parallel: every comment on those sets, and the sets themselves.
 *
 * The second comment read is what keeps a thread whole. The newest hundred
 * comments can cut a conversation in half, leaving the athlete's reply without
 * the coach's question above it; reading each of those sets in full puts the
 * question back.
 *
 * `uploadingSetIds` rides along on the set read, so a clip still uploading
 * from this device costs no extra round trip to show.
 */
export async function fetchFeedback(
  athleteId: string,
  uploadingSetIds: readonly string[] = [],
): Promise<FeedbackData> {
  const recent = await fetchCommentsForAthlete(athleteId, RECENT_COMMENTS);
  const spokenAbout = [...new Set(recent.map((comment) => comment.setId))];
  const [comments, sets] = await Promise.all([
    fetchCommentsForSets(spokenAbout),
    fetchSetsByIds(setIdsToFetch(recent, uploadingSetIds)),
  ]);
  return { comments, sets };
}

/**
 * How many comments from somebody else arrived after `seenAt`.
 *
 * Capped rather than counted exactly: the badge says "something new", and
 * Appwrite would charge a full count for a number nobody reads past nine.
 */
export async function fetchUnreadCount(athleteId: string, seenAt: string | null): Promise<number> {
  if (!athleteId) return 0;
  const { tables, databaseId } = browserAppwrite();
  const queries = [
    Query.equal("athlete_id", athleteId),
    Query.notEqual("author_id", athleteId),
    Query.limit(10),
    // author_id is selected so a forged comment cannot light the badge.
    Query.select(["created_at", "author_id"]),
  ];
  if (seenAt) queries.push(Query.greaterThan("created_at", seenAt));
  const page = await tables.listRows({ databaseId, tableId: "set_comments", queries });
  return authenticRows("set_comments", page.rows).length;
}

/**
 * Whether this athlete has a coach right now.
 *
 * Read straight off the link row, which the athlete is stamped to read, rather
 * than through `/api/link/coach`: Today only needs yes or no, and the route
 * costs a JWT and a server hop to fetch a name Today does not show.
 */
export async function fetchHasCoach(athleteId: string): Promise<boolean> {
  if (!athleteId) return false;
  const { tables, databaseId } = browserAppwrite();
  const page = await tables.listRows({
    databaseId,
    tableId: "coach_athlete_links",
    queries: [
      Query.equal("athlete_id", athleteId),
      Query.equal("status", "active"),
      Query.limit(1),
      Query.select(["status"]),
    ],
  });
  return page.rows.length > 0;
}

/**
 * New comments without a refresh.
 *
 * Realtime only delivers rows the subscriber can read, so the circle grant
 * does the filtering. Failing is silent: this improves a badge that already
 * refreshes on focus, it is not what makes it work.
 */
export function subscribeToComments(onChange: () => void): () => void {
  try {
    const { client, databaseId } = browserAppwrite();
    return client.subscribe(`databases.${databaseId}.tables.set_comments.rows`, (message) => {
      const events = message.events ?? [];
      if (events.some((event) => event.endsWith(".create") || event.endsWith(".delete"))) onChange();
    });
  } catch {
    return () => {};
  }
}
