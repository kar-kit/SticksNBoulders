/**
 * Drives Coach Feedback, the athlete half of the review loop, against the live
 * instance.
 *
 *   npm run build && npm run start      (PORT and E2E_BASE_URL together if 3100 is taken)
 *   npm run e2e:feedback
 *
 * The loop, end to end: a coach comments on a filmed set from their own
 * session, the athlete sees the dot on Today, opens the screen, reads the
 * comment beside the numbers and the clip, replies, and the dot clears -- and
 * stays cleared across a reload, and comes back when the coach says something
 * else. The reply is read back through the coach's session, because a reply
 * the coach cannot see is a reply to nobody.
 *
 * Also the two empty states worth a browser: an athlete with no coach gets no
 * way in from Today and a real answer by URL, and one whose coach has not said
 * anything yet is nudged toward filming.
 *
 * Creates throwaway users and removes them and everything they wrote.
 */
import { chromium, type Page } from "playwright";
import { ID, Query, Storage, TablesDB, Teams, Users } from "node-appwrite";
import { Client as WebClient, TablesDB as WebTablesDB } from "appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
import { presetMode } from "./e2e-mode";
import { addCoachToCircle, ensureCircle } from "../appwrite/documents/circle-admin";
import { circleTeamId } from "../appwrite/documents/circle";
import {
  commentPermissions,
  linkPermissions,
  sessionPermissions,
  setPermissions,
  videoPermissions,
} from "../appwrite/documents/policy";

dedupeSdkWarnings();

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const config = serverAppwriteConfig();
const admin = createServerClient(config);
const users = new Users(admin);
const teams = new Teams(admin);
const storage = new Storage(admin);
const adminDb = new TablesDB(admin);
const D = config.databaseId;
const stamp = Date.now();
const PASSWORD = `Pw-${stamp}-fbA1!`;

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

const mkUser = (tag: string, name: string) =>
  users.create({
    userId: `e2efb${tag}${stamp}`,
    email: `e2e-feedback-${tag}-${stamp}@sticksnboulders.test`,
    password: PASSWORD,
    name,
  }).then((user) => presetMode(users, user, "athlete"));

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
  await page.waitForURL("**/today", { timeout: 20000 }).catch(() => {});
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

const athlete = await mkUser("a", "Feedback Athlete");
const coach = await mkUser("c", "Ruairi Feedback");
const solo = await mkUser("s", "Solo Athlete");

const created: { table: string; id: string }[] = [];
const videoFileId = `e2efbclip${stamp}`;
let uploaded = false;
let failure: unknown = null;
const browser = await chromium.launch();

try {
  await ensureCircle(teams, athlete.$id, "Feedback Athlete");
  await ensureCircle(teams, coach.$id, "Ruairi Feedback");
  await ensureCircle(teams, solo.$id, "Solo Athlete");
  await addCoachToCircle(teams, athlete.$id, coach.$id);

  // The link row is server-only in the app; the admin key stands in for the
  // redemption Function here, exactly as e2e:shell does.
  const linkId = ID.unique();
  await adminDb.createRow({
    databaseId: D,
    tableId: "coach_athlete_links",
    rowId: linkId,
    data: { coach_id: coach.$id, athlete_id: athlete.$id, status: "active", linked_at: new Date().toISOString() },
    permissions: linkPermissions({ coachId: coach.$id, athleteId: athlete.$id }),
  });
  created.push({ table: "coach_athlete_links", id: linkId });

  // --- a filmed set ---------------------------------------------------------
  const sessionId = `e2efbsess${stamp}`;
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
      set_count: 1,
      tonnage_kg: 540,
    },
    permissions: sessionPermissions({ athleteId: athlete.$id }),
  });
  created.push({ table: "sessions", id: sessionId });

  const bytes = Buffer.from("fixture clip");
  const form = new FormData();
  form.append("fileId", videoFileId);
  for (const p of videoPermissions({ athleteId: athlete.$id })) form.append("permissions[]", p);
  form.append("file", new File([bytes], "clip.mp4", { type: "video/mp4" }), "clip.mp4");
  const upload = await fetch(`${config.endpoint}/storage/buckets/set_videos/files`, {
    method: "POST",
    headers: {
      "x-appwrite-project": config.projectId,
      "x-appwrite-jwt": (await users.createJWT({ userId: athlete.$id })).jwt,
      "content-range": `bytes 0-${bytes.length - 1}/${bytes.length}`,
      "x-appwrite-id": videoFileId,
    },
    body: form,
  });
  uploaded = upload.ok;

  const setId = `e2efbset${stamp}`;
  await adminDb.createRow({
    databaseId: D,
    tableId: "sets",
    rowId: setId,
    data: {
      session_id: sessionId,
      athlete_id: athlete.$id,
      exercise_id: squatId,
      set_index: 2,
      load_kg: 180,
      reps: 3,
      rpe: 8,
      is_warmup: false,
      e1rm_kg: 200,
      logged_at: new Date(startedAt.getTime() + 20 * 60_000).toISOString(),
      client_set_id: setId,
      video_file_id: videoFileId,
      notes: "felt heavier than last week",
    },
    permissions: setPermissions({ athleteId: athlete.$id }),
  });
  created.push({ table: "sets", id: setId });

  const coachDb = await asUser(coach.$id);
  const coachSays = async (body: string, at: Date) => {
    const id = `e2efbc${created.length}${stamp}`;
    await coachDb.createRow({
      databaseId: D,
      tableId: "set_comments",
      rowId: id,
      data: {
        set_id: setId,
        athlete_id: athlete.$id,
        author_id: coach.$id,
        body,
        parent_id: null,
        created_at: at.toISOString(),
        client_comment_id: id,
      },
      permissions: commentPermissions({ athleteId: athlete.$id, authorId: coach.$id }),
    });
    created.push({ table: "set_comments", id });
    return id;
  };

  const ctx = await browser.newContext({ viewport: { width: 390, height: 852 }, colorScheme: "dark" });
  const page = await ctx.newPage();
  const dot = page.getByTestId("feedback-dot");
  const entry = page.getByRole("link", { name: /Coach feedback/ });

  // --- empty: coach linked, nothing said yet -------------------------------
  console.log("\nBefore the coach has said anything");
  await signIn(page, athlete.email);
  check("the athlete lands on Today", page.url().endsWith("/today"));
  check("Today offers the way in, because they have a coach", await until(async () => (await entry.count()) === 1));
  check("with nothing new on it", (await entry.innerText()).includes("Nothing new"));
  check("and no dot on the tab", (await dot.count()) === 0);
  await entry.click();
  await page.waitForURL("**/today/feedback", { timeout: 10000 }).catch(() => {});
  check(
    "the screen nudges toward filming, naming the coach",
    await until(async () => page.getByText("Film a set and Ruairi Feedback will see it.").isVisible()),
  );

  // --- the coach comments ----------------------------------------------------
  console.log("\nThe coach comments");
  const firstComment = await coachSays("Hips shot up on the second rep. Keep 170 next week.", new Date());
  await page.goto(`${BASE}/today`);
  check("the Today tab gets a dot", await until(async () => (await dot.count()) === 1));
  check("and the entry says what is new", await until(async () => (await entry.innerText()).includes("1 new")));

  await entry.click();
  await page.waitForURL("**/today/feedback", { timeout: 10000 }).catch(() => {});
  const card = page.getByRole("article").first();
  check(
    "the comment is on screen",
    await until(async () => card.getByText("Hips shot up on the second rep.", { exact: false }).isVisible()),
  );
  const cardText = await card.innerText();
  check("beside the set's numbers", cardText.includes("180 kg × 3") && cardText.includes("RPE 8"), cardText.replace(/\s+/g, " ").slice(0, 120));
  check("and which lift it was", cardText.includes("Squat"));
  check("the coach is named, not an id", cardText.includes("Ruairi Feedback"));
  check("marked new on this visit", cardText.includes("New"));
  const video = card.locator("video");
  const clipSrc = await until(async () => ((await video.getAttribute("src")) ?? "").includes("/api/clip/"))
    .then(async (ok) => (ok ? ((await video.getAttribute("src")) ?? "") : ""));
  check("the clip has a playable URL through the app's own origin", clipSrc.includes(`/api/clip/${videoFileId}`));
  if (uploaded && clipSrc) {
    const response = await page.request.get(new URL(clipSrc, BASE).toString());
    check("which serves the athlete their clip", response.ok(), `status ${response.status()}`);
  }
  check(
    "tapping the numbers opens the set in its session",
    (await card.getByRole("link", { name: /in its session/ }).getAttribute("href")) === `/history/${sessionId}`,
  );

  // --- the reply -----------------------------------------------------------
  console.log("\nThe athlete replies");
  await card.getByRole("textbox", { name: /Reply about/ }).fill("Felt it. Dropping to 170.");
  await card.getByRole("button", { name: "Send" }).click();
  check("the reply shows straight away", await until(async () => card.getByText("Felt it. Dropping to 170.").isVisible()));

  const replyQuery = {
    databaseId: D,
    tableId: "set_comments",
    queries: [Query.equal("set_id", setId), Query.equal("author_id", athlete.$id), Query.limit(10)],
  };
  const readReplies = async (tables: TablesDB | WebTablesDB) =>
    (tables instanceof TablesDB
      ? (await tables.listRows(replyQuery)).rows
      : (await tables.listRows(replyQuery)).rows) as unknown as Array<{ $id: string; parent_id?: string; athlete_id?: string; $permissions: string[] }>;

  check("and lands at Appwrite", await until(async () => (await readReplies(adminDb)).length === 1));
  const [reply] = await readReplies(adminDb);
  if (reply) created.push({ table: "set_comments", id: reply.$id });
  check("threaded under the coach's comment", reply?.parent_id === firstComment);
  check(
    "stamped for the athlete's circle, through the write helper",
    commentPermissions({ athleteId: athlete.$id, authorId: athlete.$id }).every((p) =>
      reply?.$permissions.includes(p),
    ),
    reply?.$permissions.join(", "),
  );
  check("and the coach can read it from their own session", (await readReplies(coachDb)).length === 1);

  // --- the dot clears --------------------------------------------------------
  console.log("\nWhat is new since they last looked");
  await page.getByRole("button", { name: "Back" }).click();
  await page.waitForURL("**/today", { timeout: 10000 }).catch(() => {});
  check("back on Today, the dot is gone", await until(async () => (await dot.count()) === 0, 5000));
  check("and the entry says nothing is new", await until(async () => (await entry.innerText()).includes("Nothing new")));
  await page.reload();
  await entry.waitFor({ timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  check("it stays gone after a reload", (await dot.count()) === 0);

  await coachSays("Good. Send me the 170 set on Thursday.", new Date(Date.now() + 1000));
  await page.reload();
  check("a second comment brings the dot back", await until(async () => (await dot.count()) === 1));
  await page.goto(`${BASE}/today/feedback`);
  await page.getByText("Send me the 170 set on Thursday.").waitFor({ timeout: 15000 }).catch(() => {});
  const threadText = await page.getByRole("article").first().innerText();
  check(
    "and the whole conversation reads in order on one card",
    threadText.indexOf("Hips shot up") < threadText.indexOf("Felt it") &&
      threadText.indexOf("Felt it") < threadText.indexOf("Send me the 170"),
  );
  await ctx.close();

  // --- empty: no coach ---------------------------------------------------------
  console.log("\nAn athlete training solo");
  const soloCtx = await browser.newContext({ viewport: { width: 390, height: 852 }, colorScheme: "dark" });
  const soloPage = await soloCtx.newPage();
  await signIn(soloPage, solo.email);
  await soloPage.getByRole("button", { name: /Start a session|Resume session/ }).waitFor({ timeout: 15000 }).catch(() => {});
  await soloPage.waitForTimeout(2000);
  check(
    "Today has no way into Coach Feedback at all",
    (await soloPage.getByRole("link", { name: /Coach feedback/ }).count()) === 0,
  );
  await soloPage.goto(`${BASE}/today/feedback`);
  check(
    "and the screen by URL says there is no coach, rather than a blank",
    await until(async () => soloPage.getByText("No coach linked").isVisible()),
  );
  await soloCtx.close();
} catch (error) {
  failure = error;
  check("ran without throwing", false, String(error));
} finally {
  await browser.close();
  for (const { table, id } of created.reverse()) {
    await adminDb.deleteRow({ databaseId: D, tableId: table, rowId: id }).catch(() => {});
  }
  if (uploaded) await storage.deleteFile({ bucketId: "set_videos", fileId: videoFileId }).catch(() => {});
  for (const id of [athlete.$id, coach.$id, solo.$id]) {
    // Profiles are created by the app on first sign-in.
    await adminDb.deleteRow({ databaseId: D, tableId: "profiles", rowId: id }).catch(() => {});
    await teams.delete({ teamId: circleTeamId(id) }).catch(() => {});
    await users.delete({ userId: id }).catch(() => {});
  }
}

const failed = results.filter((ok) => !ok).length;
console.log(
  failed === 0 && !failure
    ? `\n${results.length}/${results.length} passed. Users, rows and the clip removed.`
    : `\n${failed} of ${results.length} FAILED.`,
);
process.exitCode = failed === 0 && !failure ? 0 : 1;
