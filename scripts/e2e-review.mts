/**
 * Drives the Review Queue's data path against the live instance.
 *
 *   npm run e2e:review
 *
 * The question this exists to answer is the one that has bitten twice already:
 * can a COACH, from their own session, write a row stamped with the athlete's
 * circle team? Appwrite refuses any permission naming a role the caller does
 * not hold, which is what made reference maxes server-only at Order 17 and
 * what made an athlete outside their own circle unable to upload at Order 31.
 * A review row is the first thing in this product a coach writes themselves,
 * so it is the first time that rule applies to them.
 *
 * It also proves the queue query -- `isNotNull` on video_file_id composed with
 * an athlete IN filter -- returns the right clips through a coach's session
 * rather than through the API key, which is the only way it will ever run.
 *
 * Creates throwaway users and removes them and their work. Point it at dev.
 */
import { ID, Query, Storage, TablesDB, Teams, Users } from "node-appwrite";
import { Client as WebClient, TablesDB as WebTablesDB } from "appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
import { ensureCircle, addCoachToCircle } from "../appwrite/documents/circle-admin";
import { circleTeamId } from "../appwrite/documents/circle";
import {
  commentPermissions,
  reviewPermissions,
  setPermissions,
  videoPermissions,
} from "../appwrite/documents/policy";
import { buildQueue } from "../lib/review/queue";
import { threadComments, type Comment } from "../lib/review/comments";

dedupeSdkWarnings();

const config = serverAppwriteConfig();
const admin = createServerClient(config);
const users = new Users(admin);
const teams = new Teams(admin);
const storage = new Storage(admin);
const adminDb = new TablesDB(admin);
const db = config.databaseId;
const stamp = Date.now();

const results: boolean[] = [];
const check = (label: string, ok: boolean, detail = "") => {
  results.push(ok);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

/** A browser-shaped client carrying one person's session, like the app's. */
const asUser = (secret: string) => {
  const client = new WebClient().setEndpoint(config.endpoint).setProject(config.projectId);
  client.setSession(secret);
  return new WebTablesDB(client);
};

const mkUser = async (tag: string, name: string) =>
  users.create({
    userId: `e2erev${tag}${stamp}`,
    email: `e2e-review-${tag}-${stamp}@sticksnboulders.test`,
    password: `Pw-${stamp}-${tag}A1!`,
    name,
  });

const athlete = await mkUser("a", "Review Athlete");
const coach = await mkUser("c", "Review Coach");
const stranger = await mkUser("s", "Review Stranger");

const created: { table: string; id: string }[] = [];
let videoFileId = "";
let failure: unknown = null;

try {
  await ensureCircle(teams, athlete.$id, "Review Athlete");
  await ensureCircle(teams, coach.$id, "Review Coach");
  await addCoachToCircle(teams, athlete.$id, coach.$id);

  const athleteDb = asUser((await users.createSession({ userId: athlete.$id })).secret);
  const coachDb = asUser((await users.createSession({ userId: coach.$id })).secret);
  const strangerDb = asUser((await users.createSession({ userId: stranger.$id })).secret);

  // --- the athlete's session, one filmed set and one that was not ---------
  const sessionId = ID.unique();
  await athleteDb.createRow({
    databaseId: db,
    tableId: "sessions",
    rowId: sessionId,
    data: {
      athlete_id: athlete.$id,
      started_at: new Date().toISOString(),
      client_session_id: sessionId,
      set_count: 2,
      tonnage_kg: 1000,
    },
    permissions: setPermissions({ athleteId: athlete.$id }),
  });
  created.push({ table: "sessions", id: sessionId });

  videoFileId = `e2erevclip${stamp}`;
  const bytes = Buffer.from("fixture clip");
  const form = new FormData();
  form.append("fileId", videoFileId);
  for (const p of videoPermissions({ athleteId: athlete.$id })) form.append("permissions[]", p);
  form.append("file", new File([bytes], "clip.mp4", { type: "video/mp4" }), "clip.mp4");
  await fetch(`${config.endpoint}/storage/buckets/set_videos/files`, {
    method: "POST",
    headers: {
      "x-appwrite-project": config.projectId,
      "x-appwrite-jwt": (await users.createJWT({ userId: athlete.$id })).jwt,
      "content-range": `bytes 0-${bytes.length - 1}/${bytes.length}`,
      "x-appwrite-id": videoFileId,
    },
    body: form,
  });

  const makeSet = async (index: number, withVideo: boolean) => {
    const setId = ID.unique();
    await athleteDb.createRow({
      databaseId: db,
      tableId: "sets",
      rowId: setId,
      data: {
        session_id: sessionId,
        athlete_id: athlete.$id,
        exercise_id: `e2erevex${stamp}`,
        set_index: index,
        load_kg: 180 + index * 2.5,
        reps: 3,
        rpe: 8,
        is_warmup: false,
        e1rm_kg: 200 + index,
        logged_at: new Date(stamp - (5 - index) * 86_400_000).toISOString(),
        client_set_id: setId,
        video_file_id: withVideo ? videoFileId : null,
        notes: withVideo ? "felt heavier than last week" : null,
      },
      permissions: setPermissions({ athleteId: athlete.$id }),
    });
    created.push({ table: "sets", id: setId });
    return setId;
  };

  const filmed = await makeSet(0, true);
  const unfilmed = await makeSet(1, false);

  // --- the queue query, run as the coach ----------------------------------
  const queueQuery = async (tables: WebTablesDB) =>
    (
      await tables.listRows({
        databaseId: db,
        tableId: "sets",
        queries: [
          Query.equal("athlete_id", [athlete.$id]),
          Query.isNotNull("video_file_id"),
          Query.orderDesc("$id"),
          Query.limit(25),
        ],
      })
    ).rows;

  const coachSees = await queueQuery(coachDb);
  check("the coach's own session finds the filmed set", coachSees.some((r) => r.$id === filmed));
  check("and does not find the set with no clip", !coachSees.some((r) => r.$id === unfilmed));

  const strangerSees = await queueQuery(strangerDb);
  check("a stranger's identical query returns nothing", strangerSees.length === 0, `${strangerSees.length} rows`);

  // --- the write this whole ticket rests on -------------------------------
  // A coach stamping the athlete's circle team from their own session. This is
  // the exact shape Appwrite refused at Order 17 when it named the athlete.
  const reviewId = `${coach.$id}_${filmed}`;
  let wrote = true;
  let writeError = "";
  try {
    await coachDb.createRow({
      databaseId: db,
      tableId: "set_reviews",
      rowId: reviewId,
      data: {
        coach_id: coach.$id,
        athlete_id: athlete.$id,
        set_id: filmed,
        reviewed_at: new Date().toISOString(),
        client_review_id: reviewId,
      },
      permissions: reviewPermissions({ athleteId: athlete.$id, coachId: coach.$id }),
    });
    created.push({ table: "set_reviews", id: reviewId });
  } catch (error) {
    wrote = false;
    writeError = (error as Error).message;
  }
  check("a coach can stamp a review with the athlete's circle team", wrote, writeError);

  if (wrote) {
    const mine = await coachDb.listRows({
      databaseId: db,
      tableId: "set_reviews",
      queries: [Query.equal("coach_id", coach.$id), Query.limit(25)],
    });
    check("the coach reads their own reviews back", mine.rows.some((r) => r.$id === reviewId));

    const theirs = await athleteDb.listRows({
      databaseId: db,
      tableId: "set_reviews",
      queries: [Query.limit(25)],
    });
    check("the athlete can see that their clip was watched", theirs.rows.some((r) => r.$id === reviewId));

    const notTheirs = await strangerDb.listRows({
      databaseId: db,
      tableId: "set_reviews",
      queries: [Query.limit(25)],
    });
    check("a stranger sees no reviews at all", notTheirs.rows.length === 0);

    // Idempotency: the same clip cleared twice is one row, not two.
    let duplicated = false;
    try {
      await coachDb.createRow({
        databaseId: db,
        tableId: "set_reviews",
        rowId: reviewId,
        data: {
          coach_id: coach.$id,
          athlete_id: athlete.$id,
          set_id: filmed,
          reviewed_at: new Date().toISOString(),
          client_review_id: reviewId,
        },
        permissions: reviewPermissions({ athleteId: athlete.$id, coachId: coach.$id }),
      });
      duplicated = true;
    } catch {
      duplicated = false;
    }
    check("clearing the same clip twice does not write a second row", !duplicated);

    // The athlete must not be able to clear their coach's queue.
    let athleteCleared = true;
    try {
      await athleteDb.deleteRow({ databaseId: db, tableId: "set_reviews", rowId: reviewId });
    } catch {
      athleteCleared = false;
    }
    check("the athlete cannot delete the coach's review", !athleteCleared);

    // --- and the queue this produces ---------------------------------------
    const reviewed = new Set(mine.rows.map((r) => String((r as unknown as { set_id: string }).set_id)));
    const queue = buildQueue(
      coachSees.map((row) => {
        const raw = row as unknown as Record<string, unknown>;
        return {
          id: row.$id,
          athleteId: String(raw.athlete_id),
          exerciseId: String(raw.exercise_id),
          sessionId: String(raw.session_id),
          setIndex: Number(raw.set_index),
          loadKg: Number(raw.load_kg),
          reps: Number(raw.reps),
          rpe: typeof raw.rpe === "number" ? raw.rpe : null,
          e1rmKg: typeof raw.e1rm_kg === "number" ? raw.e1rm_kg : null,
          loggedAt: String(raw.logged_at),
          videoFileId: String(raw.video_file_id),
          notes: typeof raw.notes === "string" ? raw.notes : null,
        };
      }),
      reviewed,
      { athletes: new Map([[athlete.$id, "Review Athlete"]]), exercises: new Map() },
    );
    check("a cleared clip leaves the queue", queue.length === 0, `${queue.length} left`);
  }

  // --- comments -----------------------------------------------------------
  // The coach opens, the athlete replies. Both stamp the same circle team, and
  // the athlete direction is the one Order 34's reply box will lean on -- a
  // different caller against the same rule that refused the coach at Order 17.
  const coachComment = `${coach.$id}_c_${stamp}`;
  let coachSaid = true;
  let coachSaidError = "";
  try {
    await coachDb.createRow({
      databaseId: db,
      tableId: "set_comments",
      rowId: coachComment,
      data: {
        set_id: filmed,
        athlete_id: athlete.$id,
        author_id: coach.$id,
        body: "Hips shot up on the second rep. Keep 170 next week.",
        parent_id: null,
        created_at: new Date(stamp).toISOString(),
        client_comment_id: coachComment,
      },
      permissions: commentPermissions({ athleteId: athlete.$id, authorId: coach.$id }),
    });
    created.push({ table: "set_comments", id: coachComment });
  } catch (error) {
    coachSaid = false;
    coachSaidError = (error as Error).message;
  }
  check("a coach can comment on an athlete's set", coachSaid, coachSaidError);

  const athleteReply = `${athlete.$id}_r_${stamp}`;
  let athleteReplied = true;
  let athleteReplyError = "";
  try {
    await athleteDb.createRow({
      databaseId: db,
      tableId: "set_comments",
      rowId: athleteReply,
      data: {
        set_id: filmed,
        athlete_id: athlete.$id,
        author_id: athlete.$id,
        body: "Felt it. I'll drop to 170.",
        parent_id: coachComment,
        created_at: new Date(stamp + 60_000).toISOString(),
        client_comment_id: athleteReply,
      },
      permissions: commentPermissions({ athleteId: athlete.$id, authorId: athlete.$id }),
    });
    created.push({ table: "set_comments", id: athleteReply });
  } catch (error) {
    athleteReplied = false;
    athleteReplyError = (error as Error).message;
  }
  check("and the athlete can reply to it", athleteReplied, athleteReplyError);

  if (coachSaid && athleteReplied) {
    const read = async (tables: WebTablesDB) =>
      (
        await tables.listRows({
          databaseId: db,
          tableId: "set_comments",
          queries: [Query.equal("set_id", filmed), Query.orderAsc("created_at"), Query.limit(25)],
        })
      ).rows;

    check("the coach sees both sides of the thread", (await read(coachDb)).length === 2);
    check("so does the athlete", (await read(athleteDb)).length === 2);
    check("a stranger sees none of it", (await read(strangerDb)).length === 0);

    const threads = threadComments(
      (await read(coachDb)).map((row) => {
        const raw = row as unknown as Record<string, unknown>;
        return {
          id: row.$id,
          setId: String(raw.set_id),
          athleteId: String(raw.athlete_id),
          authorId: String(raw.author_id),
          body: String(raw.body),
          parentId: typeof raw.parent_id === "string" && raw.parent_id ? raw.parent_id : null,
          createdAt: String(raw.created_at),
        } satisfies Comment;
      }),
    );
    check(
      "the reply threads under the comment it answers",
      threads.length === 1 && threads[0].replies.length === 1,
      `${threads.length} threads`,
    );

    // A record one side can edit is not a record.
    let coachDeletedReply = true;
    try {
      await coachDb.deleteRow({ databaseId: db, tableId: "set_comments", rowId: athleteReply });
    } catch {
      coachDeletedReply = false;
    }
    check("a coach cannot delete the athlete's reply", !coachDeletedReply);

    let athleteDeletedComment = true;
    try {
      await athleteDb.deleteRow({ databaseId: db, tableId: "set_comments", rowId: coachComment });
    } catch {
      athleteDeletedComment = false;
    }
    check("an athlete cannot delete the coach's correction", !athleteDeletedComment);

    let authorDeleted = true;
    try {
      await athleteDb.deleteRow({ databaseId: db, tableId: "set_comments", rowId: athleteReply });
    } catch {
      authorDeleted = false;
    }
    check("but each of them can withdraw their own words", authorDeleted);
  }

  // --- revocation ---------------------------------------------------------
  // Order 16.6 item 3 asks that a coach who loses a link sees a real state
  // rather than a 401. Leaving the circle is what produces it, and it is worth
  // knowing the read genuinely stops rather than lingering on a cached grant.
  const { memberships } = await teams.listMemberships({ teamId: circleTeamId(athlete.$id) });
  const coachMembership = memberships.find((m) => m.userId === coach.$id);
  if (coachMembership) {
    await teams.deleteMembership({ teamId: circleTeamId(athlete.$id), membershipId: coachMembership.$id });
  }
  const afterRevoke = await queueQuery(coachDb);
  check("an unlinked coach's queue goes empty rather than stale", afterRevoke.length === 0, `${afterRevoke.length} rows`);

  const threadAfterRevoke = await coachDb.listRows({
    databaseId: db,
    tableId: "set_comments",
    queries: [Query.equal("set_id", filmed), Query.limit(25)],
  });
  check(
    "and the thread goes with it",
    threadAfterRevoke.rows.length === 0,
    `${threadAfterRevoke.rows.length} rows`,
  );
} catch (error) {
  failure = error;
  check("ran without throwing", false, String(error));
} finally {
  for (const { table, id } of created.reverse()) {
    await adminDb.deleteRow({ databaseId: db, tableId: table, rowId: id }).catch(() => {});
  }
  if (videoFileId) await storage.deleteFile({ bucketId: "set_videos", fileId: videoFileId }).catch(() => {});
  for (const id of [athlete.$id, coach.$id]) {
    await teams.delete({ teamId: circleTeamId(id) }).catch(() => {});
  }
  for (const id of [athlete.$id, coach.$id, stranger.$id]) {
    await users.delete({ userId: id }).catch(() => {});
  }
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed > 0 || failure) process.exit(1);
