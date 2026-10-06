/**
 * Drives Orders 19 and 22 end to end against the live instance, in a browser.
 *
 *   npx next dev -p 3119        # or npm run build && PORT=3119 npm run start
 *   E2E_BASE_URL=http://localhost:3119 npm run e2e:program
 *
 * What only the instance can prove:
 *
 *   - A linked coach writes a block in the Program Editor: a day, two lines
 *     typed into the grid, a note, Publish. Every row lands through
 *     /api/program with the coach and athlete copied from the program and a
 *     read-only permission stamp -- nobody holds update or delete.
 *   - The athlete sees that day on Today, percentages already in kilos
 *     against their training max, starts it, and logs the first set from the
 *     prefilled row. The set carries the prescription id and a snapshot, and
 *     the session points at the day.
 *   - Constraint 5: the coach then edits the line, and the logged set does
 *     not change.
 *   - An unlinked user can neither read any of it (directly against Appwrite,
 *     and in the editor) nor write it through the route, including by forging
 *     a program for the athlete. No JWT is a 401.
 *
 * Creates throwaway users and only ever deletes rows it created: every
 * program row is keyed on this run's program id, every set and session on
 * this run's athlete.
 */
import { chromium, type Page } from "playwright";
import { Client, ID, Query, TablesDB, Teams, Users } from "node-appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
import { addCoachToCircle, ensureCircle } from "../appwrite/documents/circle-admin";
import { circleTeamId } from "../appwrite/documents/circle";
import { linkPermissions, profilePermissions, referenceMaxPermissions } from "../appwrite/documents/policy";
import { localDay } from "../lib/programming/program";

dedupeSdkWarnings();

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3119";
const PASSWORD = "Probe-pass-123!";
const config = serverAppwriteConfig();
const admin = createServerClient(config);
const db = new TablesDB(admin);
const users = new Users(admin);
const teams = new Teams(admin);
const D = config.databaseId;
const stamp = Date.now();
const today = localDay();
const PROGRAM_TABLES = ["prescriptions", "program_days", "program_weeks", "program_blocks", "programs"] as const;

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
await globalLift("Bench Press");

const mkUser = (tag: string, name: string) =>
  users.create({ userId: ID.unique(), email: `prog-${tag}-${stamp}@example.com`, password: PASSWORD, name });

const athlete = await mkUser("a", "Joey Pang");
const coach = await mkUser("c", "Ruairi Deane");
const stranger = await mkUser("s", "Louis Stranger");
const created = { link: "", programId: "" };

/** A user's own Appwrite client and a short-lived JWT, the way the browser would hold them. */
const asUser = async (userId: string) => {
  // A JWT minted for the user is exactly what the browser's account.createJWT
  // hands the route, and a client holding it reads with the user's own
  // permissions, never the API key's.
  const { jwt } = await users.createJWT({ userId });
  const client = new Client().setEndpoint(config.endpoint).setProject(config.projectId).setJWT(jwt);
  return { tables: new TablesDB(client), jwt };
};

const post = async (jwt: string | null, body: unknown) => {
  const response = await fetch(`${BASE}/api/program`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(jwt ? { authorization: `Bearer ${jwt}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json().catch(() => ({}))) as Record<string, unknown> };
};

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

const rowsOf = async (tableId: string, column: string, value: string) =>
  (
    await db.listRows({ databaseId: D, tableId, queries: [Query.equal(column, value), Query.limit(100)], ttl: 0 })
  ).rows as unknown as Array<Record<string, unknown> & { $id: string; $permissions: string[] }>;

const poll = async <T,>(read: () => Promise<T>, done: (value: T) => boolean, ms = 20000): Promise<T> => {
  const until = Date.now() + ms;
  let value = await read();
  while (!done(value) && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 1000));
    value = await read();
  }
  return value;
};

const browser = await chromium.launch();

try {
  // --- the pair, linked as redemption links them ---------------------------
  await ensureCircle(teams, athlete.$id, "Joey Pang");
  await ensureCircle(teams, coach.$id, "Ruairi Deane");
  await addCoachToCircle(teams, athlete.$id, coach.$id);
  for (const [user, name] of [
    [athlete, "Joey Pang"],
    [coach, "Ruairi Deane"],
    [stranger, "Louis Stranger"],
  ] as const) {
    await db.createRow({
      databaseId: D,
      tableId: "profiles",
      rowId: user.$id,
      data: { user_id: user.$id, display_name: name, sex: "male", units: "kg", created_at: new Date().toISOString() },
      permissions: profilePermissions({ athleteId: user.$id }),
    });
  }
  created.link = ID.unique();
  await db.createRow({
    databaseId: D,
    tableId: "coach_athlete_links",
    rowId: created.link,
    data: { coach_id: coach.$id, athlete_id: athlete.$id, status: "active", linked_at: new Date().toISOString() },
    permissions: linkPermissions({ coachId: coach.$id, athleteId: athlete.$id }),
  });
  // A training max, so 75% has something to be 75% of.
  await db.createRow({
    databaseId: D,
    tableId: "reference_maxes",
    rowId: ID.unique(),
    data: {
      athlete_id: athlete.$id,
      exercise_id: squatId,
      kind: "training",
      value_kg: 200,
      effective_from: new Date("2026-08-01T00:00:00Z").toISOString(),
      recorded_by: coach.$id,
      created_at: new Date().toISOString(),
    },
    permissions: referenceMaxPermissions({ athleteId: athlete.$id }),
  });

  // --- the coach writes a block --------------------------------------------
  console.log("The coach writes a block, at 1440×900");
  const coachCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  const coachPage = await coachCtx.newPage();
  await signIn(coachPage, coach.email);
  await coachPage.goto(`${BASE}/coach/programs`);
  const joey = coachPage.getByRole("region", { name: "Joey Pang" });
  check("Programs lists the linked athlete", await joey.waitFor({ timeout: 30000 }).then(() => true).catch(() => false));
  await joey.getByRole("button", { name: "New block" }).click();
  await coachPage.getByLabel("Name").fill(`E2E block ${stamp}`);
  await coachPage.getByLabel("Starts").fill(today);
  await coachPage.getByRole("button", { name: "Create" }).click();
  await coachPage.waitForURL(/\/coach\/programs\/[^/]+$/, { timeout: 30000 });
  created.programId = coachPage.url().split("/").at(-1)!;
  check("Create opens the editor on week 1", await coachPage.getByRole("tab", { name: "Week 1" }).waitFor({ timeout: 20000 }).then(() => true).catch(() => false));

  await coachPage.getByRole("button", { name: "+ Day" }).click();
  const day = coachPage.getByRole("region", { name: "Day 1" });
  await day.waitFor({ timeout: 20000 });
  check("a new day is dated from the start date", (await day.getByLabel("Day 1 date").inputValue()) === today);

  const addLine = async (name: string) => {
    await day.getByRole("combobox", { name: "Add exercise to Day 1" }).fill(name);
    await coachPage.getByRole("option", { name, exact: true }).click();
  };
  const cell = (label: string) => day.getByRole("textbox", { name: label });
  const typeCell = async (label: string, value: string) => {
    await cell(label).fill(value);
    await cell(label).press("Tab");
  };

  await addLine("Squat");
  await cell("Sets, line 1").waitFor({ timeout: 20000 });
  await typeCell("Sets, line 1", "3");
  await typeCell("Reps, line 1", "5");
  await typeCell("Load, line 1", "75%");
  check("the load cell says what 75% landed as", await visible(coachPage, "Percent · 75% of training max"));
  await addLine("Bench Press");
  await cell("Sets, line 2").waitFor({ timeout: 20000 });
  await typeCell("Sets, line 2", "4");
  await typeCell("Reps, line 2", "6");
  await typeCell("Load, line 2", "@8");
  await day.getByLabel("Day 1 note").fill("Keep the top set honest.");
  await day.getByLabel("Day 1 note").press("Enter");
  await coachPage.waitForTimeout(1500);
  await coachPage.screenshot({ path: ".shots/program-editor-1440.png", fullPage: true });

  await coachPage.getByRole("button", { name: "Publish" }).click();
  check("Publish says so", await coachPage.getByLabel("Status").getByText("Published").waitFor({ timeout: 20000 }).then(() => true).catch(() => false));

  const lines = await poll(
    () => rowsOf("prescriptions", "program_id", created.programId),
    (rows) => rows.length === 2 && rows.every((r) => r.load !== null),
  );
  const squatLine = lines.find((r) => r.exercise_id === squatId);
  check(
    "the grid's typing is stored as typed, kind derived",
    squatLine?.set_count === 3 && squatLine?.reps === 5 && squatLine?.load === "75%" && squatLine?.load_kind === "percent",
    JSON.stringify(lines.map((r) => [r.set_count, r.reps, r.load, r.load_kind])),
  );
  const programRows = await Promise.all(PROGRAM_TABLES.map((t) => rowsOf(t, t === "programs" ? "$id" : "program_id", created.programId)));
  const every = programRows.flat();
  check(
    "every program row names the coach and the athlete, copied from the program",
    every.length >= 6 && every.every((r) => r.coach_id === coach.$id && r.athlete_id === athlete.$id),
    `${every.length} rows`,
  );
  check(
    "and nobody holds update or delete on any of them",
    every.every((r) => r.$permissions.every((p) => /^read\(/.test(p))),
  );
  const [dayRow] = await rowsOf("program_days", "program_id", created.programId);
  check("the day is on today's date, with its note", dayRow?.scheduled_on === today && dayRow?.notes === "Keep the top set honest.");

  // --- an unlinked user ------------------------------------------------------
  console.log("\nA user who was never linked");
  const outsider = await asUser(stranger.$id);
  const theirDays = await outsider.tables
    .listRows({ databaseId: D, tableId: "program_days", queries: [Query.equal("athlete_id", athlete.$id)] })
    .catch(() => ({ rows: [] }));
  check("cannot list the athlete's days", theirDays.rows.length === 0, `${theirDays.rows.length} rows`);
  const direct = await outsider.tables
    .getRow({ databaseId: D, tableId: "programs", rowId: created.programId })
    .then(() => "read")
    .catch(() => "refused");
  check("cannot read the program by id", direct === "refused");
  const writeLine = await post(outsider.jwt, {
    op: "addPrescription",
    dayId: dayRow.$id,
    exerciseId: squatId,
    setCount: 10,
    load: "100%",
  });
  check("cannot add a line through the route", writeLine.status === 403, JSON.stringify(writeLine));
  const forged = await post(outsider.jwt, { op: "createProgram", athleteId: athlete.$id, name: "Forged" });
  check("cannot forge a program onto the athlete's Today", forged.status === 403, JSON.stringify(forged));
  const anonymous = await post(null, { op: "publishProgram", programId: created.programId });
  check("no JWT is a 401", anonymous.status === 401);
  const direct2 = await outsider.tables
    .createRow({
      databaseId: D,
      tableId: "program_days",
      rowId: ID.unique(),
      data: { program_id: created.programId, block_id: "x", week_id: "x", coach_id: stranger.$id, athlete_id: athlete.$id, position: 9, scheduled_on: today },
    })
    .then(() => "created")
    .catch(() => "refused");
  check("cannot write a program table directly either", direct2 === "refused");

  const strangerCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  const strangerPage = await strangerCtx.newPage();
  await signIn(strangerPage, stranger.email);
  await strangerPage.goto(`${BASE}/coach/programs/${created.programId}`);
  check("and the editor shows them nothing", await visible(strangerPage, "No such program"));
  check("not a line of it", (await strangerPage.getByText("Keep the top set honest.").count()) === 0);

  // --- the athlete -----------------------------------------------------------
  console.log("\nThe athlete, at 390×852");
  const athleteCtx = await browser.newContext({ viewport: { width: 390, height: 852 }, colorScheme: "dark", hasTouch: true });
  const athletePage = await athleteCtx.newPage();
  await signIn(athletePage, athlete.email);
  await athletePage.goto(`${BASE}/today`);
  const card = athletePage.getByRole("region", { name: "Today's session" });
  check("Today previews the prescribed day", await card.waitFor({ timeout: 30000 }).then(() => true).catch(() => false));
  check("75% is already kilos against the training max", await card.getByText("3 × 5 · 150 kg (75%)").waitFor({ timeout: 10000 }).then(() => true).catch(() => false));
  check("the RPE line reads as RPE", await card.getByText("4 × 6 · RPE 8").waitFor({ timeout: 5000 }).then(() => true).catch(() => false));
  check("the coach's note sits under it", ((await card.getByLabel("Coach's note").innerText().catch(() => "")) ?? "").includes("Keep the top set honest."));
  await athletePage.screenshot({ path: ".shots/program-today-390.png", fullPage: true });

  await athletePage.getByRole("button", { name: "Start today's session" }).click();
  await athletePage.waitForURL(/\/log$/, { timeout: 20000 });
  const squat = athletePage.getByRole("region", { name: "Squat" });
  check("Log Session opens on the prescribed squat", await squat.waitFor({ timeout: 20000 }).then(() => true).catch(() => false));
  check("with the coach's lines above the rows", await squat.getByRole("list", { name: "Squat prescribed" }).getByText("3 × 5 · 150 kg (75%)").waitFor({ timeout: 10000 }).then(() => true).catch(() => false));
  const first = squat.getByRole("group", { name: "Set 1" });
  check("and set 1 already holds the target", ((await first.innerText().catch(() => "")) ?? "").includes("150"));
  await athletePage.screenshot({ path: ".shots/program-log-390.png", fullPage: true });
  await squat.getByRole("button", { name: "Log Set 1" }).click();

  const sets = await poll(() => rowsOf("sets", "athlete_id", athlete.$id), (rows) => rows.length >= 1, 30000);
  const logged = sets[0];
  check(
    "the set is the athlete's numbers, answering the squat line",
    logged?.load_kg === 150 && logged?.reps === 5 && logged?.prescription_id === squatLine?.$id,
    JSON.stringify(logged && [logged.load_kg, logged.reps, logged.prescription_id]),
  );
  check("with a snapshot of what the target said", logged?.prescribed === "5 reps · 150 kg (75%)", String(logged?.prescribed));
  const [sessionRow] = await rowsOf("sessions", "athlete_id", athlete.$id);
  check("and the session points at the day it was started from", sessionRow?.program_day_id === dayRow.$id);

  // --- constraint 5 ----------------------------------------------------------
  console.log("\nThe coach changes the line afterwards");
  const coachAuth = await asUser(coach.$id);
  const edit = await post(coachAuth.jwt, { op: "updatePrescription", prescriptionId: squatLine!.$id, load: "80%" });
  check("the coach may edit it", edit.status === 200, JSON.stringify(edit));
  const after = (await rowsOf("sets", "athlete_id", athlete.$id))[0];
  check(
    "and the logged set is untouched",
    after?.load_kg === 150 && after?.prescribed === "5 reps · 150 kg (75%)",
    JSON.stringify(after && [after.load_kg, after.prescribed]),
  );
} catch (error) {
  check("ran without throwing", false, String(error));
} finally {
  await browser.close();
  const del = (tableId: string, rowId: string) => db.deleteRow({ databaseId: D, tableId, rowId }).catch(() => {});
  if (created.programId) {
    for (const tableId of PROGRAM_TABLES) {
      const rows =
        tableId === "programs"
          ? [{ $id: created.programId }]
          : await rowsOf(tableId, "program_id", created.programId).catch(() => []);
      for (const row of rows) await del(tableId, row.$id);
    }
  }
  // Everything below is keyed on the throwaway athlete, so it can only be ours.
  for (const tableId of ["sets", "sessions", "stats_rollups", "reference_maxes"]) {
    for (const row of await rowsOf(tableId, "athlete_id", athlete.$id).catch(() => [])) await del(tableId, row.$id);
  }
  if (created.link) await del("coach_athlete_links", created.link);
  for (const u of [athlete, coach, stranger]) {
    await del("profiles", u.$id);
    await teams.delete({ teamId: circleTeamId(u.$id) }).catch(() => {});
  }
  for (const u of [athlete, coach, stranger]) await users.delete({ userId: u.$id }).catch(() => {});
}

const failed = results.filter((ok) => !ok).length;
console.log(failed === 0 ? `\n${results.length}/${results.length} passed. Probe data removed.` : `\n${failed} of ${results.length} FAILED`);
process.exitCode = failed ? 1 : 0;
