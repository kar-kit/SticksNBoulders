/**
 * Drives Order 16.6 against the live instance: what the COACH sees when an
 * athlete unlinks, and that re-linking restores it with nothing duplicated.
 *
 *   npm run build && PORT=3103 npm run start
 *   E2E_BASE_URL=http://localhost:3103 npm run e2e:unlink
 *
 * e2e:link proves the access side -- after unlinking, the coach cannot read the
 * set. This proves the screen side, which no unit test can: that the Review
 * Queue drops the athlete's clips live and says why, that the ex-athlete's
 * Athlete View URL is a "no longer linked" screen rather than a wall of
 * permission failures, that the Roster mentions it quietly and without a name,
 * and that one re-link brings back the queue, the panels and the coach's own
 * comment -- one link row, one review, one comment throughout.
 *
 * Creates throwaway users and deletes exactly the rows it created, by id. It
 * never lists and deletes: other runs share this instance.
 */
import { chromium, type Page } from "playwright";
import { ID, Query, TablesDB, Teams, Users } from "node-appwrite";
import { Client as WebClient, TablesDB as WebTablesDB } from "appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
import { circleTeamId } from "../appwrite/documents/circle";
import { ensureCircle } from "../appwrite/documents/circle-admin";
import {
  commentPermissions,
  profilePermissions,
  reviewPermissions,
  sessionPermissions,
  setPermissions,
} from "../appwrite/documents/policy";

dedupeSdkWarnings();

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3103";
const config = serverAppwriteConfig();
const admin = createServerClient(config);
const db = new TablesDB(admin);
const users = new Users(admin);
const teams = new Teams(admin);
const D = config.databaseId;
const stamp = Date.now();
const PASSWORD = "Probe-pass-123!";

const results: boolean[] = [];
const check = (label: string, ok: boolean, detail = "") => {
  results.push(ok);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

const until = async (label: string, predicate: () => Promise<boolean>, ms = 20000) => {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await predicate().catch(() => false)) return true;
    if (Date.now() > deadline) {
      console.log(`  (timed out waiting for ${label})`);
      return false;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
};

const asUser = async (userId: string) => {
  const client = new WebClient().setEndpoint(config.endpoint).setProject(config.projectId);
  client.setSession((await users.createSession({ userId })).secret);
  return new WebTablesDB(client);
};

const jwtFor = async (userId: string) => (await users.createJWT({ userId })).jwt;
const post = async (path: string, userId: string, body: unknown = {}) =>
  (
    await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${await jwtFor(userId)}` },
      body: JSON.stringify(body),
    })
  ).json();

const linkRows = async (athleteId: string) =>
  (
    await db.listRows({
      databaseId: D,
      tableId: "coach_athlete_links",
      queries: [Query.equal("athlete_id", athleteId), Query.limit(5)],
      ttl: 0,
    })
  ).rows as unknown as Array<Record<string, unknown>>;

const countWhere = async (tableId: string, queries: string[]) =>
  (await db.listRows({ databaseId: D, tableId, queries: [...queries, Query.limit(50)], ttl: 0 })).rows.length;

const mkUser = (tag: string, name: string) =>
  users.create({ userId: ID.unique(), email: `unlink-${tag}-${stamp}@example.com`, password: PASSWORD, name });

const athlete = await mkUser("athlete", "Joey Pang");
const coach = await mkUser("coach", "Ruairi Deane");

const created: { table: string; id: string }[] = [];
let code = "";
const browser = await chromium.launch();

try {
  // --- a linked pair, through the real endpoints ---------------------------
  console.log("\nA coach and an athlete, linked");
  await ensureCircle(teams, athlete.$id, "Joey Pang");
  const profileId = ID.unique();
  await db.createRow({
    databaseId: D, tableId: "profiles", rowId: profileId,
    data: { user_id: athlete.$id, display_name: "Joey Pang", created_at: new Date().toISOString() },
    permissions: profilePermissions({ athleteId: athlete.$id }),
  });
  created.push({ table: "profiles", id: profileId });

  code = String((await post("/api/invite", coach.$id)).code ?? "");
  const linked = await post("/api/link", athlete.$id, { code });
  check("the athlete links with the coach's code", linked.status === "linked", JSON.stringify(linked));

  // Two filmed sets. The coach clears one and comments on the other, so the
  // queue shows exactly one clip and there is something of the coach's own to
  // lose -- and get back.
  const athleteDb = await asUser(athlete.$id);
  const sessionId = ID.unique();
  await athleteDb.createRow({
    databaseId: D, tableId: "sessions", rowId: sessionId,
    data: {
      athlete_id: athlete.$id, started_at: new Date().toISOString(),
      client_session_id: sessionId, set_count: 2, tonnage_kg: 1000,
    },
    permissions: sessionPermissions({ athleteId: athlete.$id }),
  });
  created.push({ table: "sessions", id: sessionId });

  const makeSet = async (index: number) => {
    const setId = ID.unique();
    await athleteDb.createRow({
      databaseId: D, tableId: "sets", rowId: setId,
      data: {
        session_id: sessionId, athlete_id: athlete.$id, exercise_id: `unlinkex${stamp}`,
        set_index: index, load_kg: 180, reps: 3, rpe: 8, is_warmup: false, e1rm_kg: 200,
        logged_at: new Date(stamp - (3 - index) * 86_400_000).toISOString(),
        client_set_id: setId,
        // The queue lists sets with a clip on them; playback is e2e:clip's job.
        video_file_id: `unlinkclip${stamp}${index}`,
      },
      permissions: setPermissions({ athleteId: athlete.$id }),
    });
    created.push({ table: "sets", id: setId });
    return setId;
  };
  const cleared = await makeSet(0);
  await makeSet(1);

  const coachDb = await asUser(coach.$id);
  const reviewId = `${coach.$id}_${cleared}`;
  await coachDb.createRow({
    databaseId: D, tableId: "set_reviews", rowId: reviewId,
    data: {
      coach_id: coach.$id, athlete_id: athlete.$id, set_id: cleared,
      reviewed_at: new Date().toISOString(), client_review_id: reviewId,
    },
    permissions: reviewPermissions({ athleteId: athlete.$id, coachId: coach.$id }),
  });
  created.push({ table: "set_reviews", id: reviewId });

  const commentId = ID.unique();
  const COMMENT = `Hips shot up on rep two ${stamp}`;
  await coachDb.createRow({
    databaseId: D, tableId: "set_comments", rowId: commentId,
    data: {
      set_id: cleared, athlete_id: athlete.$id, author_id: coach.$id, body: COMMENT,
      parent_id: null, created_at: new Date().toISOString(), client_comment_id: commentId,
    },
    permissions: commentPermissions({ athleteId: athlete.$id, authorId: coach.$id }),
  });
  created.push({ table: "set_comments", id: commentId });

  // --- the coach's screens while linked ------------------------------------
  console.log("\nThe coach's screens while linked");
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(`${BASE}/sign-in`);
  await page.getByLabel("Email").fill(coach.email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 20000 }).catch(() => {});

  const athleteView = `${BASE}/coach/athletes/${athlete.$id}`;
  const text = async (p: Page) => (await p.locator("main, body").first().innerText()).replace(/\s+/g, " ");

  await page.goto(athleteView);
  check(
    "Athlete View shows the panels",
    await until("the panels", async () => /current maxes/i.test(await text(page))),
  );
  check(
    "including the coach's own comment",
    await until("the comment", async () => (await text(page)).includes(COMMENT)),
  );

  await page.goto(`${BASE}/coach/review`);
  check(
    "the queue holds the one uncleared clip",
    await until("1 waiting", async () => (await text(page)).includes("1 waiting")),
  );

  // --- the athlete unlinks while the coach is on the queue -----------------
  console.log("\nThe athlete unlinks while the coach is looking");
  const unlinked = await post("/api/link/revoke", athlete.$id);
  check("the unlink lands", unlinked.status === "unlinked", JSON.stringify(unlinked));

  check(
    "the clip leaves the queue live, with a reason",
    await until(
      "the queue notice",
      async () => (await text(page)).includes("A clip left the queue because the athlete who filmed it is no longer linked with you."),
    ),
  );
  const queueText = await text(page);
  check("and the queue is empty rather than erroring", queueText.includes("Nothing to review") && !queueText.includes("would not load"));
  check(
    "the rail no longer lists the athlete",
    await until("the rail", async () => (await page.getByRole("link", { name: /Joey P/ }).count()) === 0),
  );

  console.log("\nThe ex-athlete's Athlete View URL");
  await page.goto(athleteView);
  check(
    "is a no-longer-linked screen",
    await until("the state", async () => (await text(page)).includes("No longer linked")),
  );
  const viewText = await text(page);
  check("dated", /stopped sharing their training with you on \d+ [A-Z][a-z]{2}/.test(viewText));
  check("not a panel failing, not a false empty state", !/Couldn’t load|No maxes yet|Nothing said yet/.test(viewText));
  check("and not the coach's comment", !viewText.includes(COMMENT));

  console.log("\nThe Roster");
  await page.goto(`${BASE}/coach/roster`);
  check(
    "says quietly that an athlete left",
    await until("the notice", async () => (await text(page)).includes("An athlete stopped sharing their training with you on")),
  );
  check("without naming them", !(await page.getByRole("status").innerText()).includes("Joey"));

  console.log("\nWhat the coach's session can read now");
  check(
    "the comment is kept, not deleted",
    (await countWhere("set_comments", [Query.equal("$id", commentId)])) === 1,
  );
  const coachDbAfter = await asUser(coach.$id);
  const coachReadsComment = await coachDbAfter
    .getRow({ databaseId: D, tableId: "set_comments", rowId: commentId })
    .then(() => true)
    .catch(() => false);
  check("but unreadable by the ex-coach, like everything in the circle", !coachReadsComment);
  const ownLinks = await coachDbAfter.listRows({
    databaseId: D, tableId: "coach_athlete_links", queries: [Query.equal("coach_id", coach.$id)],
  });
  check(
    "while the coach can still read that the link ended, and when",
    ownLinks.rows.length === 1 &&
      (ownLinks.rows[0] as unknown as Record<string, unknown>).status === "revoked" &&
      typeof (ownLinks.rows[0] as unknown as Record<string, unknown>).revoked_at === "string",
  );

  // --- re-linking -----------------------------------------------------------
  console.log("\nRe-linking with the same code");
  await page.goto(athleteView);
  await until("the state", async () => (await text(page)).includes("No longer linked"));
  const relinked = await post("/api/link", athlete.$id, { code });
  check("reactivates the same row", relinked.status === "linked" && relinked.reactivated === true, JSON.stringify(relinked));
  check(
    "the Athlete View comes back live, panels and all",
    await until("the panels again", async () => /current maxes/i.test(await text(page))),
  );
  check(
    "including the coach's comment",
    await until("the comment again", async () => (await text(page)).includes(COMMENT)),
  );

  await page.goto(`${BASE}/coach/review`);
  check(
    "the queue is exactly as it was: one clip, the cleared one still cleared",
    await until("1 waiting again", async () => (await text(page)).includes("1 waiting")),
  );
  check("with no leftover notice", (await page.getByRole("status").count()) === 0);

  await page.goto(`${BASE}/coach/roster`);
  await page.getByText("No athletes yet").waitFor({ timeout: 15000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));
  check("the Roster notice is gone", !(await text(page)).includes("stopped sharing"));

  console.log("\nNo duplicates");
  check("one link row", (await linkRows(athlete.$id)).length === 1);
  check("one review", (await countWhere("set_reviews", [Query.equal("coach_id", coach.$id)])) === 1);
  check("one comment", (await countWhere("set_comments", [Query.equal("athlete_id", athlete.$id)])) === 1);

  check("no uncaught page errors throughout", errors.length === 0, errors.join(" | "));
  await ctx.close();
} catch (error) {
  console.error(error);
  results.push(false);
} finally {
  // --- teardown: only what this run created, by id --------------------------
  await browser.close();
  for (const { table, id } of created.reverse()) {
    await db.deleteRow({ databaseId: D, tableId: table, rowId: id }).catch(() => {});
  }
  for (const row of await linkRows(athlete.$id).catch(() => [])) {
    if (row.coach_id === coach.$id) {
      await db.deleteRow({ databaseId: D, tableId: "coach_athlete_links", rowId: String(row.$id) }).catch(() => {});
    }
  }
  if (code) await db.deleteRow({ databaseId: D, tableId: "invite_codes", rowId: code }).catch(() => {});
  for (const u of [athlete, coach]) {
    await teams.delete({ teamId: circleTeamId(u.$id) }).catch(() => {});
    await users.delete({ userId: u.$id }).catch(() => {});
  }
}

const failed = results.filter((ok) => !ok).length;
console.log(
  failed === 0
    ? `\n${results.length}/${results.length} passed. Fixtures removed.`
    : `\n${failed} of ${results.length} FAILED.`,
);
process.exitCode = failed === 0 ? 0 : 1;
