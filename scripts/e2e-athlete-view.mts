/**
 * Drives the coach's Athlete View against the live instance, in a browser.
 *
 *   npx next dev -p 3101        # or npm run build && PORT=3101 npm run start
 *   E2E_BASE_URL=http://localhost:3101 npm run e2e:athlete-view
 *
 * What only the instance can prove:
 *
 *   - A linked coach reads every panel through the circle team: maxes, the
 *     lift tabs off stats_rollups, sessions and their sets, clips.
 *   - The inline max editor writes through /api/reference-max as the coach,
 *     and Undo deletes exactly the row it wrote.
 *   - The gate reads coach_athlete_links: a stranger gets "Not one of your
 *     athletes", and a revoked coach gets "No longer linked" -- which depends
 *     on the coach still being able to read their own revoked link row.
 *   - It fits at 1280 as well as 1440.
 *
 * Creates throwaway users and only ever deletes rows it created. Rollups are
 * built for this athlete only, bucket by bucket -- never `rollups:rebuild`,
 * which walks every athlete on a shared instance.
 */
import { chromium, type Page } from "playwright";
import { ID, Query, TablesDB, Teams, Users } from "node-appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
import { addCoachToCircle, ensureCircle } from "../appwrite/documents/circle-admin";
import { circleTeamId } from "../appwrite/documents/circle";
import { adminRollupTables, rebuildRollup } from "../appwrite/documents/rollup-admin";
import {
  linkPermissions,
  profilePermissions,
  referenceMaxPermissions,
  sessionPermissions,
  setPermissions,
} from "../appwrite/documents/policy";
import { estimateOneRepMax } from "../lib/strength/e1rm";
import { weekStart } from "../lib/strength/rollup";

dedupeSdkWarnings();

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3101";
const PASSWORD = "Probe-pass-123!";
const config = serverAppwriteConfig();
const admin = createServerClient(config);
const db = new TablesDB(admin);
const users = new Users(admin);
const teams = new Teams(admin);
const D = config.databaseId;
const stamp = Date.now();

const results: boolean[] = [];
const check = (label: string, ok: boolean, detail = "") => {
  results.push(ok);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

const globalLift = async (name: string) => {
  const page = await db.listRows({
    databaseId: D,
    tableId: "exercises",
    queries: [Query.equal("is_global", true), Query.equal("name", name), Query.limit(1)],
    ttl: 0,
  });
  const row = page.rows[0];
  if (!row) throw new Error(`No global exercise "${name}". Run npm run exercises:seed first.`);
  return row.$id as string;
};

const squatId = await globalLift("Squat");
const benchId = await globalLift("Bench Press");

const mkUser = (tag: string, name: string) =>
  users.create({ userId: ID.unique(), email: `av-${tag}-${stamp}@example.com`, password: PASSWORD, name });

const athlete = await mkUser("a", "Joey Pang");
const coach = await mkUser("c", "Ruairi Deane");
const stranger = await mkUser("s", "Louis Stranger");

const created = { sessions: [] as string[], sets: [] as string[], link: "" };

const signIn = async (page: Page, email: string) => {
  await page.goto(`${BASE}/sign-in`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 30000 }).catch(() => {});
};

const visible = (page: Page, text: string | RegExp, timeout = 20000) =>
  page
    .getByText(text)
    .first()
    .waitFor({ timeout })
    .then(() => true)
    .catch(() => false);

const browser = await chromium.launch();

try {
  // --- the athlete, linked -------------------------------------------------
  await ensureCircle(teams, athlete.$id, "Joey Pang");
  await addCoachToCircle(teams, athlete.$id, coach.$id);
  await db.createRow({
    databaseId: D,
    tableId: "profiles",
    rowId: athlete.$id,
    data: { user_id: athlete.$id, display_name: "Joey Pang", sex: "male", units: "kg", created_at: new Date().toISOString() },
    permissions: profilePermissions({ athleteId: athlete.$id }),
  });
  created.link = ID.unique();
  await db.createRow({
    databaseId: D,
    tableId: "coach_athlete_links",
    rowId: created.link,
    data: { coach_id: coach.$id, athlete_id: athlete.$id, status: "active", linked_at: new Date().toISOString() },
    permissions: linkPermissions({ coachId: coach.$id, athleteId: athlete.$id }),
  });

  // --- three weeks of squats, one filmed ------------------------------------
  const WEEK = 7 * 24 * 60 * 60_000;
  const monday = weekStart(new Date()).getTime();
  const weeks: Array<{ ago: number; load: number; reps: number; rpe: number; video?: boolean }> = [
    { ago: 2, load: 170, reps: 3, rpe: 8 },
    { ago: 1, load: 175, reps: 3, rpe: 8 },
    { ago: 0, load: 180, reps: 3, rpe: 8, video: true },
  ];
  for (const [n, w] of weeks.entries()) {
    const at = new Date(monday - w.ago * WEEK + 10 * 60 * 60_000);
    const sessionId = `av-s-${stamp}-${n}`;
    await db.createRow({
      databaseId: D,
      tableId: "sessions",
      rowId: sessionId,
      data: {
        athlete_id: athlete.$id,
        client_session_id: sessionId,
        started_at: at.toISOString(),
        finished_at: new Date(at.getTime() + 55 * 60_000).toISOString(),
        set_count: 1,
        tonnage_kg: w.load * w.reps,
        notes: n === 2 ? "Knee felt fine today" : null,
      },
      permissions: sessionPermissions({ athleteId: athlete.$id }),
    });
    created.sessions.push(sessionId);

    const setId = `av-t-${stamp}-${n}`;
    await db.createRow({
      databaseId: D,
      tableId: "sets",
      rowId: setId,
      data: {
        session_id: sessionId,
        athlete_id: athlete.$id,
        exercise_id: squatId,
        set_index: 0,
        load_kg: w.load,
        reps: w.reps,
        rpe: w.rpe,
        is_warmup: false,
        e1rm_kg: estimateOneRepMax({ loadKg: w.load, reps: w.reps, rpe: w.rpe }) ?? undefined,
        logged_at: new Date(at.getTime() + 5 * 60_000).toISOString(),
        client_set_id: setId,
        video_file_id: w.video ? `av-nofile-${stamp}` : undefined,
      },
      permissions: setPermissions({ athleteId: athlete.$id }),
    });
    created.sets.push(setId);
    await rebuildRollup(adminRollupTables(admin), D, { athleteId: athlete.$id, exerciseId: squatId, loggedAt: at });
  }

  // A tested squat max, entered by the athlete.
  await db.createRow({
    databaseId: D,
    tableId: "reference_maxes",
    rowId: ID.unique(),
    data: {
      athlete_id: athlete.$id,
      exercise_id: squatId,
      kind: "tested",
      value_kg: 200,
      effective_from: new Date("2026-08-12T00:00:00Z").toISOString(),
      recorded_by: athlete.$id,
      created_at: new Date().toISOString(),
    },
    permissions: referenceMaxPermissions({ athleteId: athlete.$id }),
  });

  // --- the coach, at 1440 --------------------------------------------------
  console.log("A linked coach, at 1440×900");
  const coachCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  const coachPage = await coachCtx.newPage();
  await signIn(coachPage, coach.email);
  const started = Date.now();
  await coachPage.goto(`${BASE}/coach/athletes/${athlete.$id}`);

  check("the header names the athlete", await visible(coachPage, /^Joey Pang$/));
  check("and says when they linked", await visible(coachPage, /^linked \d+ \w{3}/));

  const squatRow = coachPage.getByRole("row", { name: /^Squat/ });
  check("CURRENT MAXES shows the tested squat, and who set it", await squatRow.getByText("set by them").waitFor({ timeout: 20000 }).then(() => true).catch(() => false));
  check(
    "with the e1RM from the rollups beside it",
    ((await squatRow.innerText().catch(() => "")) ?? "").includes("from logged sets"),
  );
  check("the lift tabs open on Squat", await coachPage.getByRole("tab", { name: "Squat", selected: true }).waitFor({ timeout: 20000 }).then(() => true).catch(() => false));
  check("three weeks draws the e1RM chart", await coachPage.getByRole("img", { name: /Estimated 1RM for Squat/ }).waitFor({ timeout: 10000 }).then(() => true).catch(() => false));
  check("recent working sets are listed", await visible(coachPage, /180 × 3/));
  console.log(`         (screen settled in ${Date.now() - started}ms on a dev server)`);

  const sessions = coachPage.getByRole("region", { name: "Recent sessions" });
  const firstSession = sessions.getByRole("button", { expanded: false }).first();
  await firstSession.click();
  check(
    "a session opens in place to its sets and the athlete's note",
    await sessions.getByText("Knee felt fine today").waitFor({ timeout: 5000 }).then(() => true).catch(() => false),
  );
  check("the filmed set is listed under Videos, waiting", await coachPage.getByRole("region", { name: "Videos" }).getByText("waiting").first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false));
  check("the block is a placeholder, not invented data", await visible(coachPage, "No program yet"));

  // --- setting a max inline ------------------------------------------------
  console.log("\nSetting a max inline");
  await coachPage.getByRole("button", { name: "Set training max for Bench Press" }).click();
  await coachPage.getByLabel("training max for Bench Press, kg").fill("122.5");
  await coachPage.keyboard.press("Enter");
  const saved = await coachPage.getByRole("status").getByText(/Saved 122.5 training max on Bench Press/).waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
  check("the save is confirmed on screen", saved);

  const benchMaxes = async () =>
    (
      await db.listRows({
        databaseId: D,
        tableId: "reference_maxes",
        queries: [Query.equal("athlete_id", athlete.$id), Query.equal("exercise_id", benchId), Query.limit(10)],
        ttl: 0,
      })
    ).rows as unknown as Array<Record<string, unknown>>;
  const written = await benchMaxes();
  check(
    "one row, recorded by the coach, as a training max",
    written.length === 1 && written[0].recorded_by === coach.$id && written[0].kind === "training" && written[0].value_kg === 122.5,
    JSON.stringify(written.map((r) => [r.kind, r.value_kg, r.recorded_by === coach.$id])),
  );
  check(
    "and the grid shows it",
    await coachPage.getByRole("row", { name: /^Bench Press/ }).getByText("set by you").waitFor({ timeout: 10000 }).then(() => true).catch(() => false),
  );
  await coachPage.getByRole("button", { name: "Undo" }).click();
  await coachPage.waitForTimeout(2500);
  check("Undo deletes exactly that row", (await benchMaxes()).length === 0);

  await coachPage.screenshot({ path: ".shots/athlete-view-1440.png", fullPage: true });

  // --- 1280 ----------------------------------------------------------------
  console.log("\nAt 1280×900");
  await coachPage.setViewportSize({ width: 1280, height: 900 });
  await coachPage.waitForTimeout(500);
  const overflow = await coachPage.evaluate(() => {
    const main = document.querySelector("main");
    return {
      page: document.documentElement.scrollWidth - window.innerWidth,
      main: main ? main.scrollWidth - main.clientWidth : 0,
    };
  });
  check("nothing scrolls sideways", overflow.page <= 0 && overflow.main <= 0, JSON.stringify(overflow));
  await coachPage.screenshot({ path: ".shots/athlete-view-1280.png", fullPage: true });

  // --- a stranger ----------------------------------------------------------
  console.log("\nA coach who was never linked");
  const strangerCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  const strangerPage = await strangerCtx.newPage();
  await signIn(strangerPage, stranger.email);
  await strangerPage.goto(`${BASE}/coach/athletes/${athlete.$id}`);
  check("is told this is not their athlete", await visible(strangerPage, "Not one of your athletes"));
  check("and sees none of the training", (await strangerPage.getByText("180 × 3").count()) === 0);
  await strangerPage.screenshot({ path: ".shots/athlete-view-not-linked.png" });

  // --- revoked -------------------------------------------------------------
  console.log("\nOnce the athlete ends the link");
  // The same two steps as revokeCoachAccess, in the same order: access first,
  // then the record.
  const { memberships } = await teams.listMemberships({ teamId: circleTeamId(athlete.$id) });
  const membership = memberships.find((m) => m.userId === coach.$id);
  if (membership) await teams.deleteMembership({ teamId: circleTeamId(athlete.$id), membershipId: membership.$id });
  await db.updateRow({
    databaseId: D,
    tableId: "coach_athlete_links",
    rowId: created.link,
    data: { status: "revoked", revoked_at: new Date().toISOString() },
    permissions: linkPermissions({ coachId: coach.$id, athleteId: athlete.$id }),
  });
  await coachPage.reload();
  check("the coach sees 'No longer linked', not an error", await visible(coachPage, "No longer linked"));
  check("with the date it ended", await visible(coachPage, /ended the link on \d+ \w{3}/));
  check("and none of the training", (await coachPage.getByText("180 × 3").count()) === 0);
  check("and not the athlete's name", (await coachPage.getByText("Joey Pang").count()) === 0);
  await coachPage.screenshot({ path: ".shots/athlete-view-revoked.png" });
} catch (error) {
  check("ran without throwing", false, String(error));
} finally {
  await browser.close();
  const del = (tableId: string, rowId: string) => db.deleteRow({ databaseId: D, tableId, rowId }).catch(() => {});
  for (const id of created.sets) await del("sets", id);
  for (const id of created.sessions) await del("sessions", id);
  // Everything below is keyed on the throwaway athlete, so it can only be ours.
  for (const tableId of ["stats_rollups", "reference_maxes"]) {
    const page = await db
      .listRows({ databaseId: D, tableId, queries: [Query.equal("athlete_id", athlete.$id), Query.limit(100)], ttl: 0 })
      .catch(() => ({ rows: [] as Array<{ $id: string }> }));
    for (const row of page.rows) await del(tableId, row.$id);
  }
  if (created.link) await del("coach_athlete_links", created.link);
  await del("profiles", athlete.$id);
  await teams.delete({ teamId: circleTeamId(athlete.$id) }).catch(() => {});
  for (const u of [athlete, coach, stranger]) await users.delete({ userId: u.$id }).catch(() => {});
}

const failed = results.filter((ok) => !ok).length;
console.log(failed === 0 ? `\n${results.length}/${results.length} passed. Probe data removed.` : `\n${failed} of ${results.length} FAILED`);
process.exitCode = failed ? 1 : 0;
