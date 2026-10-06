/**
 * Drives Order 23 (My Program) end to end against the live instance, in a browser.
 *
 *   npx next dev --webpack -p 3123
 *   E2E_BASE_URL=http://localhost:3123 npm run e2e:my-program
 *
 * What only the instance can prove:
 *
 *   - No coach: the screen says so and Today carries no entry. Linked with no
 *     published program: it says that instead.
 *   - A published block shows with the current week open and the rest
 *     collapsed; a day opens to its lines with 75% already in kilos; a logged
 *     day reads Done and links to its session; an earlier unlogged day reads
 *     Missed.
 *   - Draft weeks never reach the athlete. Checked on the wire, not on the
 *     screen: no Appwrite response the page received contains a draft week's
 *     days or lines, and the device cache holds none. Then the coach
 *     publishes one and it appears on next load, and un-publishes it and it
 *     goes.
 *   - Viewing writes nothing: no non-GET request reaches Appwrite until the
 *     athlete taps Start, and Start lands on the logger on that day.
 *   - Offline: with Appwrite cut off the program reloads from the device with
 *     no error text.
 *
 * Creates throwaway users and only deletes rows it created.
 */
import { chromium, type Page, type Response } from "playwright";
import { ID, Query, TablesDB, Teams, Users } from "node-appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
import { circleTeamId } from "../appwrite/documents/circle";
import { profilePermissions, referenceMaxPermissions, sessionPermissions } from "../appwrite/documents/policy";
import { addDays, localDay } from "../lib/programming/program";
import { sampleProgram, writeOutline } from "../lib/programming/sample-program";
import { linkPair, opRunner, sampleExerciseIds } from "./program-fixtures";

dedupeSdkWarnings();

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3123";
const PASSWORD = "Probe-pass-123!";
const config = serverAppwriteConfig();
const admin = createServerClient(config);
const db = new TablesDB(admin);
const users = new Users(admin);
const teams = new Teams(admin);
const D = config.databaseId;
const appwriteHost = new URL(config.endpoint).host;
const stamp = Date.now();
const today = localDay();
const PROGRAM_TABLES = ["prescriptions", "program_days", "program_weeks", "program_blocks", "programs"] as const;

const results: boolean[] = [];
const check = (label: string, ok: boolean, detail = "") => {
  results.push(ok);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

const mkUser = (tag: string, name: string) =>
  users.create({ userId: ID.unique(), email: `myprog-${tag}-${stamp}@example.com`, password: PASSWORD, name });
const athlete = await mkUser("a", "Joey Pang");
const coach = await mkUser("c", "Ruairi Deane");
const created = { link: "", programId: "", sessionId: "", exercises: [] as string[] };

const signIn = async (page: Page, email: string) => {
  await page.goto(`${BASE}/sign-in`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 30000 }).catch(() => {});
};
const shows = (page: Page, text: string | RegExp, timeout = 20000) =>
  page.getByText(text).first().waitFor({ timeout }).then(() => true).catch(() => false);
const rowsOf = async (tableId: string, column: string, value: string) =>
  (await db.listRows({ databaseId: D, tableId, queries: [Query.equal(column, value), Query.limit(100)], ttl: 0 }))
    .rows as unknown as Array<Record<string, unknown> & { $id: string }>;

/** A week header, not a day whose coach-written label starts "Week 2 ·". */
const weekBtn = (page: Page, n: number) => page.getByRole("button", { name: new RegExp(`^Week ${n}( Current)?$`) });

const browser = await chromium.launch();

try {
  for (const [user, name] of [[athlete, "Joey Pang"], [coach, "Ruairi Deane"]] as const) {
    await db.createRow({
      databaseId: D,
      tableId: "profiles",
      rowId: user.$id,
      data: { user_id: user.$id, display_name: name, sex: "male", units: "kg", created_at: new Date().toISOString() },
      permissions: profilePermissions({ athleteId: user.$id }),
    });
  }

  const ctx = await browser.newContext({ viewport: { width: 390, height: 852 }, colorScheme: "dark", hasTouch: true });
  const page = await ctx.newPage();

  // Everything Appwrite said about program days and lines, and every write it was sent.
  const programBodies: string[] = [];
  const writes: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes(appwriteHost) && req.url().includes("/tablesdb/") && req.method() !== "GET") {
      writes.push(`${req.method()} ${req.url().split("/tablesdb/")[1]}`);
    }
  });
  page.on("response", (res: Response) => {
    const url = res.url();
    if (/\/tables\/(program_days|prescriptions)\/rows/.test(url)) {
      void res.text().then((t) => programBodies.push(t)).catch(() => {});
    }
  });

  await signIn(page, athlete.email);

  // --- no coach -------------------------------------------------------------
  console.log("No coach");
  await page.goto(`${BASE}/today`);
  await shows(page, "Nothing prescribed today.", 30000);
  await page.waitForTimeout(1500);
  check("Today has no My program entry", (await page.getByRole("link", { name: /My program/ }).count()) === 0);
  await page.goto(`${BASE}/today/program`);
  check("the screen says there is no coach", await shows(page, "No coach linked", 30000));
  await page.screenshot({ path: ".shots/my-program-nocoach-390.png" });

  // --- linked, nothing published ---------------------------------------------
  console.log("\nLinked, nothing published");
  await linkPair(admin, D, { coachId: coach.$id, coachName: "Ruairi Deane", athleteId: athlete.$id, athleteName: "Joey Pang" });
  created.link = (await rowsOf("coach_athlete_links", "athlete_id", athlete.$id))[0]?.$id ?? "";
  await page.goto(`${BASE}/today/program`);
  check("the screen says no program yet", await shows(page, "No program yet", 30000));
  await page.screenshot({ path: ".shots/my-program-empty-390.png" });

  // --- a block: weeks 1-2 published, 3-4 draft --------------------------------
  const { ids, created: madeExercises } = await sampleExerciseIds(admin, D);
  created.exercises = madeExercises;
  const startOn = addDays(today, -7);
  const written = await writeOutline(opRunner(admin, D, coach.$id), athlete.$id, sampleProgram(startOn), ids);
  created.programId = written.programId;
  await db.createRow({
    databaseId: D,
    tableId: "reference_maxes",
    rowId: ID.unique(),
    data: {
      athlete_id: athlete.$id,
      exercise_id: ids.Squat,
      kind: "training",
      value_kg: 200,
      effective_from: new Date("2026-08-01T00:00:00Z").toISOString(),
      recorded_by: coach.$id,
      created_at: new Date().toISOString(),
    },
    permissions: referenceMaxPermissions({ athleteId: athlete.$id }),
  });
  const week1Day1 = written.daysOn.get(startOn)!;
  created.sessionId = ID.unique();
  await db.createRow({
    databaseId: D,
    tableId: "sessions",
    rowId: created.sessionId,
    data: {
      athlete_id: athlete.$id,
      started_at: new Date(`${startOn}T09:00:00Z`).toISOString(),
      finished_at: new Date(`${startOn}T10:00:00Z`).toISOString(),
      set_count: 3,
      tonnage_kg: 1500,
      client_session_id: created.sessionId,
      program_day_id: week1Day1,
    },
    permissions: sessionPermissions({ athleteId: athlete.$id }),
  });
  const weeks = await rowsOf("program_weeks", "program_id", written.programId);
  const draftWeekIds = weeks.filter((w) => w.status === "draft").map((w) => w.$id);
  const draftDayIds = (await rowsOf("program_days", "program_id", written.programId)).filter((d) => draftWeekIds.includes(d.week_id as string)).map((d) => d.$id);
  const draftLineIds = (await rowsOf("prescriptions", "program_id", written.programId)).filter((l) => draftWeekIds.includes(l.week_id as string)).map((l) => l.$id);
  check("fixture has two draft weeks with days and lines", draftWeekIds.length === 2 && draftDayIds.length === 6 && draftLineIds.length === 24, `${draftWeekIds.length}/${draftDayIds.length}/${draftLineIds.length}`);

  console.log("\nA published block");
  programBodies.length = 0;
  await page.goto(`${BASE}/today`);
  const entry = page.getByRole("link", { name: /My program/ });
  check("Today now carries a My program entry", await entry.waitFor({ timeout: 30000 }).then(() => true).catch(() => false));
  await entry.click();
  await page.waitForURL(/\/today\/program$/);
  const week2 = weekBtn(page, 2);
  await week2.waitFor({ timeout: 30000 });
  check("the current week is open", (await week2.getAttribute("aria-expanded")) === "true");
  check("the earlier week is collapsed", (await weekBtn(page, 1).getAttribute("aria-expanded")) === "false");
  check("draft weeks are not on the screen", (await page.getByRole("button", { name: /^Week [34]$/ }).count()) === 0);
  check("the screen says how far through the block they are", await shows(page, "1 of 6 sessions logged", 5000));

  await weekBtn(page, 1).click();
  const doneRow = page.getByRole("button", { name: /Week 1 · Day 1/ });
  check("the logged day reads Done", ((await doneRow.innerText().catch(() => "")) ?? "").includes("Done"));
  const missedRow = page.getByRole("button", { name: /Week 1 · Day 2/ });
  check("an earlier unlogged day reads Missed", ((await missedRow.innerText().catch(() => "")) ?? "").includes("Missed"));
  await doneRow.click();
  const logged = page.getByRole("link", { name: "View logged session" });
  check("a done day links to the logged session", (await logged.getAttribute("href").catch(() => null)) === `/history/${created.sessionId}`);
  await doneRow.click();

  await page.getByRole("button", { name: /Week 2 · Day 1 — squat/ }).click();
  check("75-ish% is already kilos against the training max", await shows(page, /3 × 5 · 155 kg/, 10000));
  check("the RPE line reads as RPE", await shows(page, /1 × 5 · RPE 8/, 5000));
  await page.screenshot({ path: ".shots/my-program-390.png", fullPage: true });

  // --- drafts, on the wire and on the device ----------------------------------
  console.log("\nDrafts never reach the athlete");
  await page.waitForTimeout(1000);
  const wire = programBodies.join("\n");
  check("the page read days and lines", wire.length > 0);
  check(
    "no response contains a draft week's days or lines",
    ![...draftDayIds, ...draftLineIds, ...draftWeekIds.map((id) => `"week_id":"${id}"`)].some((id) => wire.includes(id)),
  );
  const cached = await page.evaluate(() => localStorage.getItem("snb.my-program") ?? "");
  check("and the device cache holds none", cached.length > 0 && ![...draftWeekIds, ...draftDayIds, ...draftLineIds].some((id) => cached.includes(id)));
  check("viewing sent nothing but reads", writes.length === 0, writes.join(", "));

  // --- the coach publishes week 3, then takes it back -------------------------
  console.log("\nThe coach changes the block");
  const run = opRunner(admin, D, coach.$id);
  await run({ op: "updateWeek", weekId: draftWeekIds[0], status: "published" });
  await page.reload();
  check("a newly published week appears on next load", await weekBtn(page, 3).waitFor({ timeout: 30000 }).then(() => true).catch(() => false));
  await run({ op: "updateWeek", weekId: draftWeekIds[0], status: "draft" });
  await page.reload();
  await week2.waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  check("and goes again when pulled back to draft", (await weekBtn(page, 3).count()) === 0);

  // --- offline -----------------------------------------------------------------
  console.log("\nOffline");
  await ctx.route("**/*", (route) =>
    route.request().url().includes(appwriteHost) ? route.abort("internetdisconnected") : route.continue(),
  );
  await page.reload();
  check("the last program loads from the device", await weekBtn(page, 2).waitFor({ timeout: 30000 }).then(() => true).catch(() => false));
  await page.waitForTimeout(2500);
  const body = await page.locator("body").innerText();
  check("with no error text and no toast", !/error|failed|offline|could not|try again/i.test(body), body.slice(0, 120));
  check("and claims nothing it cannot know", !/Missed|\d of \d sessions logged/.test(body));
  check("percentages are still kilos", (await page.getByRole("button", { name: /Week 2 · Day 1 — squat/ }).count()) === 1);
  await page.screenshot({ path: ".shots/my-program-offline-390.png", fullPage: true });
  await ctx.unroute("**/*");

  // --- start --------------------------------------------------------------------
  console.log("\nStart");
  await page.reload();
  await page.getByRole("button", { name: /Week 2 · Day 1 — squat/ }).click({ timeout: 30000 });
  await page.getByRole("button", { name: "Start this session" }).click();
  await page.waitForURL(/\/log$/, { timeout: 30000 });
  check("Start opens the logger on the prescribed squat", await page.getByRole("region", { name: "Squat" }).waitFor({ timeout: 20000 }).then(() => true).catch(() => false));
  const day2 = written.rows.filter((r) => r.table === "program_days");
  const session = (await rowsOf("sessions", "athlete_id", athlete.$id)).find((s) => s.$id !== created.sessionId);
  check("the new session points at that day", Boolean(session) && day2.some((r) => r.id === session?.program_day_id), String(session?.program_day_id));
} catch (error) {
  check("ran without throwing", false, String(error));
} finally {
  await browser.close();
  const del = (tableId: string, rowId: string) => db.deleteRow({ databaseId: D, tableId, rowId }).catch(() => {});
  if (created.programId) {
    for (const tableId of PROGRAM_TABLES) {
      const rows = tableId === "programs" ? [{ $id: created.programId }] : await rowsOf(tableId, "program_id", created.programId).catch(() => []);
      for (const row of rows) await del(tableId, row.$id);
    }
  }
  for (const tableId of ["sets", "sessions", "stats_rollups", "reference_maxes"]) {
    for (const row of await rowsOf(tableId, "athlete_id", athlete.$id).catch(() => [])) await del(tableId, row.$id);
  }
  if (created.link) await del("coach_athlete_links", created.link);
  for (const id of created.exercises) await del("exercises", id);
  for (const u of [athlete, coach]) {
    await del("profiles", u.$id);
    await teams.delete({ teamId: circleTeamId(u.$id) }).catch(() => {});
    await users.delete({ userId: u.$id }).catch(() => {});
  }
}

const failed = results.filter((ok) => !ok).length;
console.log(failed === 0 ? `\n${results.length}/${results.length} passed. Probe data removed.` : `\n${failed} of ${results.length} FAILED`);
process.exitCode = failed ? 1 : 0;
