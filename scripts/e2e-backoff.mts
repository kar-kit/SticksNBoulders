/**
 * Drives Order 21 (backoff rules) end to end against the live instance.
 *
 *   npx next dev --webpack -p 3121
 *   E2E_BASE_URL=http://localhost:3121 npm run e2e:backoff
 *
 * What only the instance can prove:
 *
 *   - The coach types a backoff into the Program Editor's Backoff cell; it is
 *     stored in its canonical spelling through /api/program, with the same
 *     read-only permission stamp as every program row. A rule nobody could
 *     execute is refused on the cell and by the route.
 *   - The athlete's Today shows the rule before any top set exists -- no
 *     kilos, no guess.
 *   - With the phone OFFLINE, the athlete logs a top set heavier than any
 *     stored max would suggest, and the next row is prefilled from that
 *     actual set (90% of 185 = 166.5, rounded down to 165) -- computed on the
 *     phone. Back online, the queued backoff set lands with the rule's
 *     snapshot and the line's id.
 *
 * Creates throwaway users and only deletes rows it created.
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

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3121";
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

const mkUser = (tag: string, name: string) =>
  users.create({ userId: ID.unique(), email: `backoff-${tag}-${stamp}@example.com`, password: PASSWORD, name });

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
  // A training max of 160, so a backoff priced off a stored max would read
  // 142.5 -- visibly not what the athlete actually lifted today.
  await db.createRow({
    databaseId: D,
    tableId: "reference_maxes",
    rowId: ID.unique(),
    data: {
      athlete_id: athlete.$id,
      exercise_id: squatId,
      kind: "training",
      value_kg: 160,
      effective_from: new Date("2026-08-01T00:00:00Z").toISOString(),
      recorded_by: coach.$id,
      created_at: new Date().toISOString(),
    },
    permissions: referenceMaxPermissions({ athleteId: athlete.$id }),
  });

  // --- the coach writes a top set with a backoff ---------------------------
  console.log("The coach attaches a backoff, at 1440×900");
  const coachCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  const coachPage = await coachCtx.newPage();
  await signIn(coachPage, coach.email);
  await coachPage.goto(`${BASE}/coach/programs`);
  const joey = coachPage.getByRole("region", { name: "Joey Pang" });
  await joey.waitFor({ timeout: 30000 });
  await joey.getByRole("button", { name: "New block" }).click();
  await coachPage.getByLabel("Name").fill(`E2E backoff ${stamp}`);
  await coachPage.getByLabel("Starts").fill(today);
  await coachPage.getByRole("button", { name: "Create" }).click();
  await coachPage.waitForURL(/\/coach\/programs\/[^/]+$/, { timeout: 30000 });
  created.programId = coachPage.url().split("/").at(-1)!;
  await coachPage.getByRole("button", { name: "+ Day" }).click();
  const day = coachPage.getByRole("region", { name: "Day 1" });
  await day.waitFor({ timeout: 20000 });
  await day.getByRole("combobox", { name: "Add exercise to Day 1" }).fill("Squat");
  await coachPage.getByRole("option", { name: "Squat", exact: true }).click();
  const cell = (label: string) => day.getByRole("textbox", { name: label });
  const typeCell = async (label: string, value: string) => {
    await cell(label).fill(value);
    await cell(label).press("Tab");
  };
  await cell("Sets, line 1").waitFor({ timeout: 20000 });
  await typeCell("Reps, line 1", "3");
  await typeCell("Load, line 1", "@8");

  await typeCell("Backoff, line 1", "3 x 110%");
  check("a backoff above the top set is refused on the cell", await visible(coachPage, /at most 100%/));
  await typeCell("Backoff, line 1", "-10%x3");
  check("a valid one says what it will do", await visible(coachPage, "3 sets at 90% of today's top set"));
  await coachPage.waitForTimeout(1500);
  await coachPage.screenshot({ path: ".shots/backoff-editor-1440.png", fullPage: true });
  await coachPage.getByRole("button", { name: "Publish" }).click();
  await coachPage.getByLabel("Status").getByText("Published").waitFor({ timeout: 20000 }).catch(() => {});

  const [line] = await poll(
    () => rowsOf("prescriptions", "program_id", created.programId),
    (rows) => rows.length === 1 && rows[0].backoff === "3 x 90%",
  );
  check("stored canonical, typed as -10%x3", line?.backoff === "3 x 90%", String(line?.backoff));
  check(
    "with the program stamp: coach and athlete read, nobody writes",
    line?.coach_id === coach.$id &&
      line?.athlete_id === athlete.$id &&
      line.$permissions.every((p) => /^read\(/.test(p)),
  );

  console.log("\nThe route");
  const coachAuth = await asUser(coach.$id);
  const bad = await post(coachAuth.jwt, { op: "updatePrescription", prescriptionId: line.$id, backoff: "-60% until @9" });
  check("refuses a rule nobody could execute", bad.status === 400, JSON.stringify(bad));
  const outsider = await asUser(stranger.$id);
  const forged = await post(outsider.jwt, { op: "updatePrescription", prescriptionId: line.$id, backoff: "1 x 50%" });
  check("refuses an unlinked user's backoff", forged.status === 403, JSON.stringify(forged));
  const unchanged = (await rowsOf("prescriptions", "program_id", created.programId))[0];
  check("and the line still holds the coach's rule", unchanged?.backoff === "3 x 90%");

  // --- the athlete -----------------------------------------------------------
  console.log("\nThe athlete, at 390×852");
  const athleteCtx = await browser.newContext({ viewport: { width: 390, height: 852 }, colorScheme: "dark", hasTouch: true });
  const page = await athleteCtx.newPage();
  await signIn(page, athlete.email);
  await page.goto(`${BASE}/today`);
  const card = page.getByRole("region", { name: "Today's session" });
  await card.waitFor({ timeout: 30000 }).catch(() => {});
  check(
    "Today shows the rule, not a guessed weight, before any top set",
    await card.getByText("1 × 3 · RPE 8, then 3 × 3 · 90% of top set").waitFor({ timeout: 10000 }).then(() => true).catch(() => false),
  );
  await page.getByRole("button", { name: "Start today's session" }).click();
  await page.waitForURL(/\/log$/, { timeout: 20000 });
  const squat = page.getByRole("region", { name: "Squat" });
  await squat.getByRole("group", { name: "Set 1" }).waitFor({ timeout: 20000 });
  // Wait for the session row to exist before cutting the signal.
  await poll(() => rowsOf("sessions", "athlete_id", athlete.$id), (rows) => rows.length === 1);

  await athleteCtx.setOffline(true);
  const pad = async (digits: string) => {
    for (const key of digits) {
      await page.getByRole("button", { name: key === "." ? "Decimal point" : key, exact: true }).click();
    }
  };
  await page.getByRole("button", { name: "Set 1 weight in kilograms" }).click();
  await pad("185");
  await page.getByRole("button", { name: "Set 1 RPE" }).click();
  await page.getByRole("button", { name: "8", exact: true }).click();
  await page.getByRole("button", { name: "Log Set 1" }).click();
  const set2 = squat.getByRole("group", { name: "Set 2" });
  await set2.waitFor({ timeout: 10000 }).catch(() => {});
  const set2Text = (await set2.innerText().catch(() => "")) ?? "";
  check("offline, the next row holds 90% of the ACTUAL top set: 165", set2Text.includes("165"), set2Text.replace(/\s+/g, " "));
  check(
    "and says where it came from",
    await squat.getByText("backoff from top set 185 × 3").first().waitFor({ timeout: 5000 }).then(() => true).catch(() => false),
  );
  check(
    "the coach's line reprices off it",
    await squat.getByText("1 × 3 · RPE 8, then 3 × 3 · 165 kg (90% of top set)").first().waitFor({ timeout: 5000 }).then(() => true).catch(() => false),
  );
  await page.screenshot({ path: ".shots/backoff-log-390.png", fullPage: true });
  await page.getByRole("button", { name: "Log Set 2" }).click();
  await page.waitForTimeout(1000);
  await athleteCtx.setOffline(false);

  const sets = await poll(() => rowsOf("sets", "athlete_id", athlete.$id), (rows) => rows.length >= 2, 45000);
  const byIndex = [...sets].sort((a, b) => Number(a.set_index) - Number(b.set_index));
  const [top, backoff] = byIndex;
  check("the queued top set lands as lifted", top?.load_kg === 185 && top?.rpe === 8, JSON.stringify(top && [top.load_kg, top.rpe]));
  check(
    "and the backoff set answers the same line, with the rule's snapshot",
    backoff?.load_kg === 165 && backoff?.reps === 3 && backoff?.prescription_id === line.$id && backoff?.prescribed === "3 reps · 165 kg (90% of top set)",
    JSON.stringify(backoff && [backoff.load_kg, backoff.reps, backoff.prescription_id === line.$id, backoff.prescribed]),
  );

  console.log("\nConstraint 5");
  const edit = await post(coachAuth.jwt, { op: "updatePrescription", prescriptionId: line.$id, backoff: "repeat until @9" });
  check("the coach may change the rule", edit.status === 200, JSON.stringify(edit));
  const after = (await rowsOf("sets", "athlete_id", athlete.$id)).find((s) => s.$id === backoff?.$id);
  check("and the logged backoff set is untouched", after?.load_kg === 165 && after?.prescribed === "3 reps · 165 kg (90% of top set)");
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
