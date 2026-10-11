/**
 * Drives Order 30 (video-required prompt) end to end against the live instance.
 *
 *   npx next dev --webpack -p 3130
 *   E2E_BASE_URL=http://localhost:3130 npm run e2e:video-required
 *
 * What only the instance can prove:
 *
 *   - The coach flags a line "video required" in the Program Editor with the
 *     keyboard (arrow onto the checkbox, Space). The boolean lands on the
 *     prescription row through /api/program, and nowhere else: a stranger is
 *     refused, and a direct client write to the table is refused.
 *   - In Log Session the squat camera is emphasised before the sets are done,
 *     one status line (not an alert) appears once they are logged without a
 *     clip, and the athlete can still finish the session without filming.
 *   - Attaching a clip puts the line away, and the set carries the file id.
 *
 * Creates throwaway users and only deletes rows keyed on this run.
 */
import { chromium, type Page } from "playwright";
import { Client, ID, Query, TablesDB, Teams, Users } from "node-appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
import { addCoachToCircle, ensureCircle } from "../appwrite/documents/circle-admin";
import { circleTeamId } from "../appwrite/documents/circle";
import { linkPermissions, profilePermissions } from "../appwrite/documents/policy";
import { localDay } from "../lib/programming/program";

dedupeSdkWarnings();

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3130";
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

const squatRow = await db.listRows({
  databaseId: D,
  tableId: "exercises",
  queries: [Query.equal("is_global", true), Query.equal("name", "Squat"), Query.limit(1)],
  ttl: 0,
});
const squatId = squatRow.rows[0]?.$id as string;
if (!squatId) throw new Error('No global exercise "Squat". Run npm run exercises:seed first.');

const mkUser = (tag: string, name: string) =>
  users.create({ userId: ID.unique(), email: `vreq-${tag}-${stamp}@example.com`, password: PASSWORD, name });
const athlete = await mkUser("a", "Joey Pang");
const coach = await mkUser("c", "Ruairi Deane");
const stranger = await mkUser("s", "Louis Stranger");
const created = { link: "", programId: "" };

const asUser = async (userId: string) => {
  const { jwt } = await users.createJWT({ userId });
  const client = new Client().setEndpoint(config.endpoint).setProject(config.projectId).setJWT(jwt);
  return { tables: new TablesDB(client), jwt };
};
const post = async (jwt: string, body: unknown) => {
  const response = await fetch(`${BASE}/api/program`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${jwt}` },
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
const rowsOf = async (tableId: string, column: string, value: string) =>
  (await db.listRows({ databaseId: D, tableId, queries: [Query.equal(column, value), Query.limit(100)], ttl: 0 }))
    .rows as unknown as Array<Record<string, unknown> & { $id: string }>;
const poll = async <T,>(read: () => Promise<T>, done: (value: T) => boolean, ms = 20000): Promise<T> => {
  const until = Date.now() + ms;
  let value = await read();
  while (!done(value) && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 1000));
    value = await read();
  }
  return value;
};
const waits = (promise: Promise<unknown>) => promise.then(() => true).catch(() => false);

const browser = await chromium.launch();
try {
  await ensureCircle(teams, athlete.$id, "Joey Pang");
  await ensureCircle(teams, coach.$id, "Ruairi Deane");
  await addCoachToCircle(teams, athlete.$id, coach.$id);
  for (const [user, name] of [[athlete, "Joey Pang"], [coach, "Ruairi Deane"], [stranger, "Louis Stranger"]] as const) {
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

  // --- the coach flags a line ------------------------------------------------
  console.log("The coach flags a line, at 1440×900");
  const coachPage = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" })).newPage();
  await signIn(coachPage, coach.email);
  await coachPage.goto(`${BASE}/coach/programs`);
  const joey = coachPage.getByRole("region", { name: "Joey Pang" });
  await joey.waitFor({ timeout: 30000 });
  await joey.getByRole("button", { name: "New block" }).click();
  await coachPage.getByLabel("Name").fill(`E2E video ${stamp}`);
  await coachPage.getByLabel("Starts").fill(today);
  await coachPage.getByRole("button", { name: "Create" }).click();
  await coachPage.waitForURL(/\/coach\/programs\/[^/]+$/, { timeout: 30000 });
  created.programId = coachPage.url().split("/").at(-1)!;
  await coachPage.getByRole("button", { name: "+ Day" }).click();
  const day = coachPage.getByRole("region", { name: "Day 1" });
  await day.waitFor({ timeout: 20000 });
  await day.getByRole("combobox", { name: "Add exercise to Day 1" }).fill("Squat");
  await coachPage.getByRole("option", { name: "Squat", exact: true }).click();
  const sets = day.getByRole("textbox", { name: "Sets, line 1" });
  await sets.waitFor({ timeout: 20000 });
  await sets.fill("2");
  await sets.press("Tab");

  const toggle = day.getByRole("checkbox", { name: "Video required, line 1" });
  check("the toggle starts off", !(await toggle.isChecked()));
  await day.getByRole("textbox", { name: "Note, line 1" }).focus();
  await coachPage.keyboard.press("ArrowRight");
  check("ArrowRight from the Note cell lands on the toggle", await toggle.evaluate((el) => el === document.activeElement));
  await coachPage.keyboard.press("Space");
  await waits(coachPage.waitForFunction(() => (document.querySelector('[aria-label="Video required, line 1"]') as HTMLInputElement)?.checked === true));
  check("Space turns it on", await toggle.isChecked());
  await coachPage.screenshot({ path: ".shots/video-required-editor-1440.png", fullPage: true });

  const [line] = await poll(() => rowsOf("prescriptions", "program_id", created.programId), (r) => r[0]?.video_required === true);
  check("the boolean is stored on the prescription", line?.video_required === true, String(line?.video_required));

  // Reload: the saved state, not an optimistic one.
  await coachPage.reload();
  check("and survives a reload", await toggle.waitFor({ timeout: 20000 }).then(() => toggle.isChecked()).catch(() => false));

  const outsider = await asUser(stranger.$id);
  const refused = await post(outsider.jwt, { op: "updatePrescription", prescriptionId: line.$id, videoRequired: false });
  check("a stranger cannot flip it through the route", refused.status === 403, JSON.stringify(refused));
  const direct = await outsider.tables
    .updateRow({ databaseId: D, tableId: "prescriptions", rowId: line.$id, data: { video_required: false } })
    .then(() => "written")
    .catch(() => "refused");
  check("nor write the table directly", direct === "refused");
  const coachAuth = await asUser(coach.$id);
  const directCoach = await coachAuth.tables
    .updateRow({ databaseId: D, tableId: "prescriptions", rowId: line.$id, data: { video_required: false } })
    .then(() => "written")
    .catch(() => "refused");
  check("not even the coach, directly: writes are server-only", directCoach === "refused");
  check("still on", (await rowsOf("prescriptions", "program_id", created.programId))[0]?.video_required === true);

  await coachPage.getByRole("button", { name: "Publish week 1", exact: true }).click();
  await coachPage.getByLabel("Status").getByText("Live", { exact: true }).waitFor({ timeout: 20000 });

  // --- the athlete -----------------------------------------------------------
  console.log("\nThe athlete, at 390×852");
  const athleteCtx = await browser.newContext({ viewport: { width: 390, height: 852 }, colorScheme: "dark", hasTouch: true });
  const page = await athleteCtx.newPage();
  await signIn(page, athlete.email);
  await page.goto(`${BASE}/today`);
  await page.getByRole("button", { name: "Start today's session" }).click({ timeout: 30000 });
  await page.waitForURL(/\/log$/, { timeout: 20000 });
  const squat = page.getByRole("region", { name: "Squat" });
  await squat.waitFor({ timeout: 20000 });

  /** Taps a number on the pad, as an athlete does. */
  const pad = async (digits: string) => {
    for (const key of digits) await page.getByRole("button", { name: key, exact: true }).click();
  };
  const logSet = async (n: number, enterFirst: boolean) => {
    if (enterFirst) {
      await page.getByRole("button", { name: /weight in kilograms/ }).click();
      await pad("100");
      await page.getByRole("button", { name: "Reps", exact: true }).click();
      await pad("5");
    }
    await page.getByRole("button", { name: `Log Set ${n}` }).click();
  };

  const camera = squat.getByRole("button", { name: /Add video/ });
  // The camera appears with the first logged set.
  await logSet(1, true);
  await camera.waitFor({ timeout: 20000 });
  check("after set 1 of 2 the camera is emphasised", (await camera.getAttribute("data-video-ask")) === "emphasise");
  check("and says nothing yet", (await squat.getByText("Your coach asked for a clip of this one.").count()) === 0);
  await athletePage_shot(page, "video-required-emphasised-390");

  // Confirming adds no row; Add set brings set 2, prefilled from set 1.
  await squat.getByRole("button", { name: "Add a set to Squat" }).click();
  await page.getByRole("group", { name: "Set 2" }).waitFor({ timeout: 10000 });
  await logSet(2, false);
  const nudge = squat.getByText("Your coach asked for a clip of this one.");
  check("once both sets are logged, one nudge appears", await waits(nudge.waitFor({ timeout: 15000 })));
  check("as a status line, never an alert", (await squat.getByRole("alert").count()) === 0 && (await squat.getByRole("status").filter({ hasText: "Your coach asked" }).count()) === 1);
  await athletePage_shot(page, "video-required-prompt-390");

  const stored = await poll(() => rowsOf("sets", "athlete_id", athlete.$id), (r) => r.length >= 2, 30000);
  check("both sets are logged: nothing waited on the clip", stored.length === 2, `${stored.length} sets`);

  // Attach a clip: the nudge goes away and the set carries the file.
  await squat.locator("input[type=file]").setInputFiles({ name: "clip.mp4", mimeType: "video/mp4", buffer: Buffer.alloc(200_000, 1) });
  const filmed = await poll(() => rowsOf("sets", "athlete_id", athlete.$id), (r) => r.some((s) => s.video_file_id), 45000);
  check("a clip lands on the most recent set", filmed.some((s) => s.video_file_id), JSON.stringify(filmed.map((s) => s.video_file_id)));
  check("and the nudge is gone", await waits(nudge.waitFor({ state: "detached", timeout: 15000 })));

  // --- never blocking ----------------------------------------------------------
  console.log("\nSkipping it is fine");
  check("Finish session is available regardless", await page.getByRole("button", { name: "Finish session" }).isEnabled());
  check("and so is End session", await page.getByRole("button", { name: "End session" }).isEnabled());
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
  for (const tableId of ["sets", "sessions", "stats_rollups"]) {
    for (const row of await rowsOf(tableId, "athlete_id", athlete.$id).catch(() => [])) await del(tableId, row.$id);
  }
  if (created.link) await del("coach_athlete_links", created.link);
  for (const u of [athlete, coach, stranger]) {
    await del("profiles", u.$id);
    await teams.delete({ teamId: circleTeamId(u.$id) }).catch(() => {});
  }
  for (const u of [athlete, coach, stranger]) await users.delete({ userId: u.$id }).catch(() => {});
}

async function athletePage_shot(page: Page, name: string) {
  await page.screenshot({ path: `.shots/${name}.png`, fullPage: true }).catch(() => {});
}

const failed = results.filter((ok) => !ok).length;
console.log(failed === 0 ? `\n${results.length}/${results.length} passed. Probe data removed.` : `\n${failed} of ${results.length} FAILED`);
process.exitCode = failed ? 1 : 0;
