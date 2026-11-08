/**
 * Drives the coach's Replies inbox (F26) against the live instance.
 *
 *   npm run build && npm run start      (PORT and E2E_BASE_URL together if 3100 is taken)
 *   npm run e2e:replies
 *
 * Needs schema v24 applied (`npm run appwrite:setup`) and validate-row
 * redeployed (`npm run appwrite:functions`) first: thread_reads has to exist,
 * and the Function bundles the provenance rule that vouches for its rows.
 *
 * The loop, end to end: the coach comments on a filmed set, the athlete
 * replies, and the coach's Replies badge lights on a screen he already has
 * open -- realtime, no reload. The row names the athlete, the lift and the
 * numbers, and quotes the reply. Tapping it opens the clip dialog over
 * Athlete View and marks the thread read at Appwrite, in a row only the
 * coach can read. A second browser signed in as the same coach -- his phone
 * -- shows no badge, because the mark is server-side. A reaction lights
 * nothing (F25). A reply on a clip he has already cleared lights Replies and
 * leaves Review alone. The stable thread link, /coach/replies/<setId>, opens
 * the same dialog, where the coach answers in words on the cleared clip: an
 * ordinary comment, threaded, readable by the athlete, and the clip stays
 * cleared. For an athlete who has unlinked the link says so instead.
 *
 * Creates throwaway users and removes them and everything they wrote.
 */
import { chromium, type Page } from "playwright";
import { ID, Query, TablesDB, Teams, Users } from "node-appwrite";
import { Client as WebClient, TablesDB as WebTablesDB } from "appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
import { presetMode } from "./e2e-mode";
import { addCoachToCircle, ensureCircle, removeCoachFromCircle } from "../appwrite/documents/circle-admin";
import { circleTeamId } from "../appwrite/documents/circle";
import {
  commentPermissions,
  linkPermissions,
  profilePermissions,
  reactionPermissions,
  reviewPermissions,
  sessionPermissions,
  setPermissions,
  threadReadPermissions,
} from "../appwrite/documents/policy";
import { threadHref } from "../lib/review/replies";

dedupeSdkWarnings();

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const config = serverAppwriteConfig();
const admin = createServerClient(config);
const users = new Users(admin);
const teams = new Teams(admin);
const adminDb = new TablesDB(admin);
const D = config.databaseId;
const stamp = Date.now();
const PASSWORD = `Pw-${stamp}-rpA1!`;

const results: boolean[] = [];
const check = (label: string, ok: boolean, detail = "") => {
  results.push(ok);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

const until = async (ok: () => Promise<boolean>, ms = 20000) => {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await ok().catch(() => false)) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 400));
  }
};

const mkUser = (tag: string, name: string, mode: "athlete" | "coach") =>
  users
    .create({
      userId: `e2erp${tag}${stamp}`,
      email: `e2e-replies-${tag}-${stamp}@sticksnboulders.test`,
      password: PASSWORD,
      name,
    })
    .then((user) => presetMode(users, user, mode));

/** A browser-shaped client carrying one person's session, like the app's. */
const asUser = async (userId: string) => {
  const { secret } = await users.createSession({ userId });
  const client = new WebClient().setEndpoint(config.endpoint).setProject(config.projectId);
  client.setSession(secret);
  return new WebTablesDB(client);
};

const signIn = async (page: Page, email: string) => {
  await page.goto(`${BASE}/sign-in`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/coach/**", { timeout: 20000 }).catch(() => {});
};

/** The number beside a nav item, or 0 when the badge is not drawn. */
const navCount = async (page: Page, label: "Replies" | "Review") => {
  const link = page.getByRole("navigation", { name: "Coach" }).getByRole("link", { name: new RegExp(`^${label}`) });
  const text = (await link.innerText()).replace(label, "").trim();
  return text === "" ? 0 : Number(text);
};

const squatId = await (async () => {
  const page = await adminDb.listRows({
    databaseId: D,
    tableId: "exercises",
    queries: [Query.equal("is_global", true), Query.equal("name", "Squat"), Query.limit(1)],
  });
  if (!page.rows[0]) throw new Error('No global exercise "Squat". Run npm run exercises:seed first.');
  return page.rows[0].$id;
})();

const athlete = await mkUser("a", "Replies Athlete", "athlete");
const coach = await mkUser("c", "Ruairi Replies", "coach");

const created: { table: string; id: string }[] = [];
let failure: unknown = null;
const browser = await chromium.launch();

try {
  await ensureCircle(teams, athlete.$id, "Replies Athlete");
  await ensureCircle(teams, coach.$id, "Ruairi Replies");
  await addCoachToCircle(teams, athlete.$id, coach.$id);

  // The inbox names a thread from the athlete's profile, as e2e:athlete-view
  // seeds it; without one the row honestly reads "Unnamed athlete".
  await adminDb.createRow({
    databaseId: D,
    tableId: "profiles",
    rowId: athlete.$id,
    data: { user_id: athlete.$id, display_name: "Replies Athlete", units: "kg", created_at: new Date().toISOString() },
    permissions: profilePermissions({ athleteId: athlete.$id }),
  });
  created.push({ table: "profiles", id: athlete.$id });

  // The link row is server-only in the app; the admin key stands in for the
  // redemption Function here, exactly as e2e:feedback does.
  const linkId = ID.unique();
  await adminDb.createRow({
    databaseId: D,
    tableId: "coach_athlete_links",
    rowId: linkId,
    data: { coach_id: coach.$id, athlete_id: athlete.$id, status: "active", linked_at: new Date().toISOString() },
    permissions: linkPermissions({ coachId: coach.$id, athleteId: athlete.$id }),
  });
  created.push({ table: "coach_athlete_links", id: linkId });

  // --- two filmed sets: one stays in Review, one the coach clears -----------
  const sessionId = `e2erpsess${stamp}`;
  const startedAt = new Date(stamp - 2 * 3600_000);
  await adminDb.createRow({
    databaseId: D,
    tableId: "sessions",
    rowId: sessionId,
    data: {
      athlete_id: athlete.$id,
      client_session_id: sessionId,
      started_at: startedAt.toISOString(),
      finished_at: new Date(startedAt.getTime() + 3600_000).toISOString(),
      set_count: 2,
      tonnage_kg: 1020,
    },
    permissions: sessionPermissions({ athleteId: athlete.$id }),
  });
  created.push({ table: "sessions", id: sessionId });

  const mkSet = async (tag: string, index: number, loadKg: number) => {
    const setId = `e2erp${tag}${stamp}`;
    await adminDb.createRow({
      databaseId: D,
      tableId: "sets",
      rowId: setId,
      data: {
        session_id: sessionId,
        athlete_id: athlete.$id,
        exercise_id: squatId,
        set_index: index,
        load_kg: loadKg,
        reps: 3,
        rpe: 8,
        is_warmup: false,
        logged_at: new Date(startedAt.getTime() + (20 + index) * 60_000).toISOString(),
        client_set_id: setId,
        // No upload: the dialog says the video would not load, which is
        // e2e:clip's business. What matters here is the thread beside it.
        video_file_id: `e2erpclip${tag}${stamp}`,
      },
      permissions: setPermissions({ athleteId: athlete.$id }),
    });
    created.push({ table: "sets", id: setId });
    return setId;
  };
  const openSet = await mkSet("open", 1, 180);
  const clearedSet = await mkSet("clr", 2, 170);

  const coachDb = await asUser(coach.$id);
  const athleteDb = await asUser(athlete.$id);
  const say = async (db: WebTablesDB, authorId: string, setId: string, body: string, parentId: string | null = null) => {
    const id = `e2erpc${created.length}${stamp}`;
    await db.createRow({
      databaseId: D,
      tableId: "set_comments",
      rowId: id,
      data: {
        set_id: setId,
        athlete_id: athlete.$id,
        author_id: authorId,
        body,
        parent_id: parentId,
        created_at: new Date().toISOString(),
        client_comment_id: id,
      },
      permissions: commentPermissions({ athleteId: athlete.$id, authorId }),
    });
    created.push({ table: "set_comments", id });
    return id;
  };

  const coachComment = await say(coachDb, coach.$id, openSet, "Hips shot up on rep two. Keep 170 next week.");

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  const page = await ctx.newPage();

  // --- the coach's own comment lights nothing --------------------------------
  console.log("\nBefore the athlete has answered");
  await signIn(page, coach.email);
  await page.goto(`${BASE}/coach/roster`);
  await page.getByRole("navigation", { name: "Coach" }).waitFor({ timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);
  check("the coach's own comment never counts as unread", (await navCount(page, "Replies")) === 0);

  // --- the reply arrives while he is on the Roster ---------------------------
  console.log("\nThe athlete replies, live");
  await say(athleteDb, athlete.$id, openSet, "Felt it. Dropping to 170.", coachComment);
  check("the Replies badge lights without a reload", await until(async () => (await navCount(page, "Replies")) === 1));

  // --- a reaction stays quiet ----------------------------------------------
  const reactionId = `e2erpreact${stamp}`;
  await athleteDb.createRow({
    databaseId: D,
    tableId: "comment_reactions",
    rowId: reactionId,
    data: {
      comment_id: coachComment,
      set_id: openSet,
      athlete_id: athlete.$id,
      author_id: athlete.$id,
      emoji: "👍",
      created_at: new Date().toISOString(),
      client_reaction_id: reactionId,
    },
    permissions: reactionPermissions({ athleteId: athlete.$id, authorId: athlete.$id }),
  });
  created.push({ table: "comment_reactions", id: reactionId });
  await page.waitForTimeout(2500);
  check("a reaction on the coach's comment does not move the badge (F25)", (await navCount(page, "Replies")) === 1);

  // --- the inbox --------------------------------------------------------------
  console.log("\nThe Replies screen");
  await page.getByRole("navigation", { name: "Coach" }).getByRole("link", { name: /^Replies/ }).click();
  await page.waitForURL("**/coach/replies", { timeout: 10000 }).catch(() => {});
  const row = page.getByRole("main").getByRole("link", { name: /Replies Athlete/ });
  check("one row for the thread", await until(async () => (await row.count()) === 1));
  const rowText = (await row.innerText()).replace(/\s+/g, " ");
  check("naming the athlete", rowText.includes("Replies Athlete"), rowText.slice(0, 160));
  check("the lift and the numbers", await until(async () => (await row.innerText()).includes("Squat 180 × 3 @8")));
  check("quoting the reply", rowText.includes("Felt it. Dropping to 170."));
  check("marked new", rowText.includes("New"));
  check("and the header counts it", await page.getByText("1 unread", { exact: true }).isVisible());

  await row.click();
  await page.waitForURL(`**/coach/athletes/${athlete.$id}?clip=${openSet}`, { timeout: 15000 }).catch(() => {});
  check("tapping it opens the clip dialog over Athlete View", page.url().includes(`clip=${openSet}`), page.url());
  check(
    "with the reply in the thread",
    await until(async () => page.getByRole("dialog").getByText("Felt it. Dropping to 170.").isVisible()),
  );
  check("and the badge clears", await until(async () => (await navCount(page, "Replies")) === 0));

  const markId = `${coach.$id}_${openSet}`;
  const mark = await until(async () => Boolean(await adminDb.getRow({ databaseId: D, tableId: "thread_reads", rowId: markId })));
  check("the read mark lands at Appwrite, one row at the derived id", mark);
  if (mark) {
    created.push({ table: "thread_reads", id: markId });
    const stored = (await adminDb.getRow({ databaseId: D, tableId: "thread_reads", rowId: markId })) as unknown as {
      $permissions: string[];
      coach_id: string;
      set_id: string;
    };
    check(
      "stamped for the coach alone, through the write helper",
      [...stored.$permissions].sort().join() === [...threadReadPermissions({ coachId: coach.$id })].sort().join(),
      stored.$permissions.join(", "),
    );
    check("the coach reads it back from his own session", (await coachDb.getRow({ databaseId: D, tableId: "thread_reads", rowId: markId }).then(() => true, () => false)));
    check("and the athlete cannot -- no read receipts", await athleteDb.getRow({ databaseId: D, tableId: "thread_reads", rowId: markId }).then(() => false, () => true));
  }

  // --- his phone agrees --------------------------------------------------------
  console.log("\nA second device");
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 852 }, colorScheme: "dark" });
  const phone = await phoneCtx.newPage();
  await signIn(phone, coach.email);
  await phone.goto(`${BASE}/coach/replies`);
  await phone.getByRole("main").getByRole("link", { name: /Replies Athlete/ }).waitFor({ timeout: 15000 }).catch(() => {});
  check("his phone shows the thread read, with no badge", (await navCount(phone, "Replies")) === 0);
  check("and says all read", await until(async () => phone.getByText("All read", { exact: true }).isVisible()));

  // --- a reply on a clip he already cleared ---------------------------------
  console.log("\nA reply on a reviewed clip");
  const reviewId = `${coach.$id}_${clearedSet}`;
  await coachDb.createRow({
    databaseId: D,
    tableId: "set_reviews",
    rowId: reviewId,
    data: {
      coach_id: coach.$id,
      athlete_id: athlete.$id,
      set_id: clearedSet,
      reviewed_at: new Date().toISOString(),
      client_review_id: reviewId,
      video_file_id: `e2erpclipclr${stamp}`,
    },
    permissions: reviewPermissions({ athleteId: athlete.$id, coachId: coach.$id }),
  });
  created.push({ table: "set_reviews", id: reviewId });
  await page.goto(`${BASE}/coach/roster`);
  await page.getByRole("navigation", { name: "Coach" }).waitFor({ timeout: 15000 }).catch(() => {});
  const reviewBefore = await until(async () => (await navCount(page, "Review")) === 1).then(() => navCount(page, "Review"));
  const cleared = await say(coachDb, coach.$id, clearedSet, "Good depth.");
  await say(athleteDb, athlete.$id, clearedSet, "Should I add a pause next week?", cleared);
  check("Replies lights for it", await until(async () => (await navCount(page, "Replies")) === 1));
  await page.waitForTimeout(1500);
  check("and Review does not: the clip stays cleared, one signal for one event", (await navCount(page, "Review")) === reviewBefore, `review badge ${reviewBefore}`);
  check("on the phone too, live", await until(async () => (await navCount(phone, "Replies")) === 1));

  // --- the stable thread link ------------------------------------------------
  console.log("\nThe thread link F27 will send");
  await page.goto(`${BASE}${threadHref(clearedSet)}`);
  await page.waitForURL(`**/coach/athletes/${athlete.$id}?clip=${clearedSet}`, { timeout: 15000 }).catch(() => {});
  check(`${threadHref("<setId>")} hands over to the clip dialog`, page.url().includes(`clip=${clearedSet}`), page.url());
  check("and reads the thread there", await until(async () => (await navCount(page, "Replies")) === 0));
  check("the phone's badge clears with it", await until(async () => (await navCount(phone, "Replies")) === 0));
  created.push({ table: "thread_reads", id: `${coach.$id}_${clearedSet}` });

  // --- answering from the dialog, on the cleared clip ---------------------------
  console.log("\nAnswering in words without un-clearing the clip");
  const dialog = page.getByRole("dialog");
  const box = dialog.getByRole("textbox", { name: "Your comment" });
  check("a reviewed clip's dialog has a reply box", await until(async () => box.isVisible()));
  await box.fill("Yes, two-second pause on the first set.");
  await dialog.getByRole("button", { name: "Reply", exact: true }).click();
  check("the answer shows in the thread", await until(async () => dialog.getByText("Yes, two-second pause on the first set.").isVisible()));
  type CommentRow = { $id: string; author_id?: string; parent_id?: string | null; body?: string };
  const answers = async () =>
    (
      await adminDb.listRows({
        databaseId: D,
        tableId: "set_comments",
        queries: [Query.equal("set_id", clearedSet), Query.equal("author_id", coach.$id), Query.limit(10)],
      })
    ).rows as unknown as CommentRow[];
  check("and lands at Appwrite as an ordinary coach comment", await until(async () => (await answers()).length === 2));
  const answer = (await answers()).find((r) => r.body === "Yes, two-second pause on the first set.");
  if (answer) created.push({ table: "set_comments", id: answer.$id });
  check("threaded under the thread the athlete wrote in", answer?.parent_id === cleared, String(answer?.parent_id));
  check(
    "the review row is still there: the clip stays cleared",
    await adminDb.getRow({ databaseId: D, tableId: "set_reviews", rowId: reviewId }).then(() => true, () => false),
  );
  await page.waitForTimeout(1500);
  check("Review's badge has not moved", (await navCount(page, "Review")) === reviewBefore);
  check("and Replies stays clear", (await navCount(page, "Replies")) === 0);
  check(
    "the athlete reads the answer from their own session, as the Feedback screen does",
    (
      await athleteDb.listRows({
        databaseId: D,
        tableId: "set_comments",
        queries: [Query.equal("athlete_id", athlete.$id), Query.equal("author_id", coach.$id), Query.limit(10)],
      })
    ).rows.some((r) => r.$id === answer?.$id),
  );

  // --- an unlinked athlete -----------------------------------------------------
  console.log("\nAfter the athlete unlinks");
  await adminDb.updateRow({ databaseId: D, tableId: "coach_athlete_links", rowId: linkId, data: { status: "revoked", revoked_at: new Date().toISOString() } });
  await removeCoachFromCircle(teams, athlete.$id, coach.$id);
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  const after = await ctx2.newPage();
  await signIn(after, coach.email);
  await after.goto(`${BASE}${threadHref(openSet)}`);
  check(
    "the thread link says it is not available, rather than opening an empty Athlete View",
    await until(async () => after.getByText("This thread isn’t available").isVisible()),
  );
  await after.goto(`${BASE}/coach/replies`);
  check("and the inbox has nothing of theirs", await until(async () => after.getByText("No replies yet").isVisible()));
  await ctx2.close();
  await phoneCtx.close();
  await ctx.close();
} catch (error) {
  failure = error;
  check("ran without throwing", false, String(error));
} finally {
  await browser.close();
  for (const { table, id } of created.reverse()) {
    await adminDb.deleteRow({ databaseId: D, tableId: table, rowId: id }).catch(() => {});
  }
  for (const id of [athlete.$id, coach.$id]) {
    await teams.delete({ teamId: circleTeamId(id) }).catch(() => {});
  }
  for (const id of [athlete.$id, coach.$id]) {
    await users.delete({ userId: id }).catch(() => {});
  }
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
// exitCode, not exit(): scripts/e2e-run.mts still has to run its crash net.
if (failed > 0 || failure) process.exitCode = 1;
