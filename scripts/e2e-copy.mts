/**
 * Drives Order 20 end to end against the live instance, in a browser.
 *
 *   npx next dev --webpack -p 3120
 *   E2E_BASE_URL=http://localhost:3120 npm run e2e:copy
 *
 * What only the instance can prove:
 *
 *   - Duplicate week, from the week's ⋯ menu, appends a DRAFT week whose
 *     day sits seven days on and whose lines say exactly what the source's do.
 *   - Copy to…, from the program's ⋯ menu, puts the program on a second
 *     linked athlete as a new DRAFT, every row stamped for her and not for
 *     the source athlete. Her copy of the source athlete's private
 *     variation is a row in HER library; the global squat stays the global
 *     squat.
 *   - Once published, her 75% is 75% of HER training max on her Today --
 *     not the source athlete's kilos.
 *   - A line priced off another lift (the paused bench at 80% of the squat,
 *     docs/reference-lift.md) keeps that reference through both copies, and
 *     prices off HER squat; the route refuses pointing it at a lift she
 *     cannot read.
 *   - The route refuses a copy to someone the coach does not coach, a copy of
 *     a program by someone who did not write it, and no JWT at all.
 *   - A set the source athlete already logged is unchanged by all of it.
 *
 * Creates throwaway users and only ever deletes rows it created.
 */
import { chromium, type Page } from "playwright";
import { ID, Query, TablesDB, Teams, Users } from "node-appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
import { addCoachToCircle, ensureCircle } from "../appwrite/documents/circle-admin";
import { circleTeamId } from "../appwrite/documents/circle";
import { linkPermissions, profilePermissions, referenceMaxPermissions, setPermissions } from "../appwrite/documents/policy";
import { addDays, localDay } from "../lib/programming/program";
import { opRunner } from "./program-fixtures";

dedupeSdkWarnings();

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3120";
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
const VARIATION = `E2E Paused Bench ${stamp}`;

const results: boolean[] = [];
const check = (label: string, ok: boolean, detail = "") => {
  results.push(ok);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

type Row = Record<string, unknown> & { $id: string; $permissions: string[] };
const rowsOf = async (tableId: string, column: string, value: string) =>
  (await db.listRows({ databaseId: D, tableId, queries: [Query.equal(column, value), Query.limit(100)], ttl: 0 }))
    .rows as unknown as Row[];

const squatId = (
  await db.listRows({
    databaseId: D,
    tableId: "exercises",
    queries: [Query.equal("is_global", true), Query.equal("name", "Squat"), Query.limit(1)],
    ttl: 0,
  })
).rows[0]?.$id as string | undefined;
if (!squatId) throw new Error('No global exercise "Squat". Run npm run exercises:seed first.');

const mkUser = (tag: string, name: string) =>
  users.create({ userId: ID.unique(), email: `copy-${tag}-${stamp}@example.com`, password: PASSWORD, name });
const joey = await mkUser("j", "Joey Pang");
const andrea = await mkUser("a", "Andrea Copy");
const coach = await mkUser("c", "Ruairi Deane");
const stranger = await mkUser("s", "Louis Stranger");
const everyone = [joey, andrea, coach, stranger];
const created = { links: [] as string[], programs: [] as string[] };

const jwtOf = async (userId: string) => (await users.createJWT({ userId })).jwt;
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
const appears = (wait: Promise<unknown>) => wait.then(() => true).catch(() => false);

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
  // --- the coach, linked to two athletes ------------------------------------
  for (const u of everyone) {
    await ensureCircle(teams, u.$id, u.name);
    await db.createRow({
      databaseId: D,
      tableId: "profiles",
      rowId: u.$id,
      data: { user_id: u.$id, display_name: u.name, sex: "female", units: "kg", created_at: new Date().toISOString() },
      permissions: profilePermissions({ athleteId: u.$id }),
    });
  }
  for (const athlete of [joey, andrea]) {
    await addCoachToCircle(teams, athlete.$id, coach.$id);
    const linkId = ID.unique();
    await db.createRow({
      databaseId: D,
      tableId: "coach_athlete_links",
      rowId: linkId,
      data: { coach_id: coach.$id, athlete_id: athlete.$id, status: "active", linked_at: new Date().toISOString() },
      permissions: linkPermissions({ coachId: coach.$id, athleteId: athlete.$id }),
    });
    created.links.push(linkId);
  }
  // Joey squats 200, Andrea 120: the copy must price off hers.
  for (const [athlete, kg] of [
    [joey, 200],
    [andrea, 120],
  ] as const) {
    await db.createRow({
      databaseId: D,
      tableId: "reference_maxes",
      rowId: ID.unique(),
      data: {
        athlete_id: athlete.$id,
        exercise_id: squatId,
        kind: "training",
        value_kg: kg,
        effective_from: new Date("2026-08-01T00:00:00Z").toISOString(),
        recorded_by: coach.$id,
        created_at: new Date().toISOString(),
      },
      permissions: referenceMaxPermissions({ athleteId: athlete.$id }),
    });
  }

  // --- Joey's published block, written through the same server path ---------
  const op = opRunner(admin, D, coach.$id);
  const programId = await op({ op: "createProgram", athleteId: joey.$id, name: `E2E copy ${stamp}`, startOn: today });
  created.programs.push(programId);
  const blockId = await op({ op: "addBlock", programId, name: "Volume" });
  const weekId = await op({ op: "addWeek", blockId });
  const dayId = await op({ op: "addDay", weekId, scheduledOn: today, label: "Heavy" });
  const pausedId = await op({ op: "createExercise", programId, name: VARIATION });
  const squatLine = await op({ op: "addPrescription", dayId, exerciseId: squatId, setCount: 3, reps: 5, load: "75%" });
  // Priced off the squat, not the variation's own max: a reference line.
  await op({ op: "addPrescription", dayId, exerciseId: pausedId, setCount: 4, reps: 4, load: "80% @8", notes: "2s pause", videoRequired: true, referenceExerciseId: squatId });
  await op({ op: "publishProgram", programId });
  const pausedRow = await db.getRow({ databaseId: D, tableId: "exercises", rowId: pausedId });
  check("the variation sits in Joey's library", pausedRow.owner_id === joey.$id && pausedRow.is_global === false);

  // A set Joey already logged against it.
  const setId = `copy-set-${stamp}`;
  await db.createRow({
    databaseId: D,
    tableId: "sets",
    rowId: setId,
    data: {
      session_id: `copy-session-${stamp}`,
      athlete_id: joey.$id,
      exercise_id: squatId,
      set_index: 1,
      load_kg: 150,
      reps: 5,
      rpe: 8,
      is_warmup: false,
      logged_at: new Date().toISOString(),
      client_set_id: setId,
      prescription_id: squatLine,
      prescribed: "5 reps · 150 kg (75%)",
    },
    permissions: setPermissions({ athleteId: joey.$id }),
  });

  // --- Duplicate week, in the editor -----------------------------------------
  console.log("The coach duplicates week 1, at 1440×900");
  const coachCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  const coachPage = await coachCtx.newPage();
  await signIn(coachPage, coach.email);
  await coachPage.goto(`${BASE}/coach/programs/${programId}`);
  // Duplicate sits in the week's ⋯ menu now, beside "Publish week 1".
  await coachPage.getByRole("button", { name: "Week 1 actions", exact: true }).click({ timeout: 30000 });
  await coachPage.getByRole("menuitem", { name: "Duplicate week 1", exact: true }).click();
  const week2 = coachPage.getByRole("navigation", { name: "Program outline" }).getByRole("button", { name: "Week 2, draft", exact: true });
  check(
    "the copy opens as Week 2, marked draft on a published block",
    (await appears(week2.waitFor({ timeout: 20000 }))) &&
      (await week2.getAttribute("aria-current")) === "true" &&
      (await appears(coachPage.getByRole("heading", { name: "Volume · Week 2", exact: true }).waitFor({ timeout: 10000 }))),
  );
  const weeks = await poll(
    () => rowsOf("program_weeks", "program_id", programId),
    (rows) => rows.length === 2,
  );
  const copyWeek = weeks.find((w) => w.$id !== weekId);
  check("the new week is a draft at position 1", copyWeek?.status === "draft" && copyWeek?.position === 1);
  const copyDays = copyWeek ? await rowsOf("program_days", "week_id", copyWeek.$id) : [];
  check(
    "its day is seven days on, label kept",
    copyDays.length === 1 && copyDays[0].scheduled_on === addDays(today, 7) && copyDays[0].label === "Heavy",
    JSON.stringify(copyDays.map((d) => [d.scheduled_on, d.label])),
  );
  const copiedLines = copyWeek ? await poll(() => rowsOf("prescriptions", "week_id", copyWeek.$id), (r) => r.length === 2) : [];
  const shape = (r: Row) =>
    [r.exercise_id, r.set_count, r.reps, r.load, r.load_kind, r.notes, r.video_required, r.reference_exercise_id ?? null].join("|");
  const sourceLines = await rowsOf("prescriptions", "week_id", weekId);
  check(
    "and its lines say exactly what week 1's do",
    copiedLines.map(shape).sort().join() === sourceLines.map(shape).sort().join(),
    copiedLines.map(shape).join(" ; "),
  );
  await coachPage.screenshot({ path: ".shots/copy-duplicate-1440.png", fullPage: true });

  // --- Copy to Andrea, in the editor -----------------------------------------
  console.log("\nThe coach copies the program to Andrea");
  // Copy to… is an item in the program's ⋯ menu.
  await coachPage.getByRole("button", { name: "Program actions", exact: true }).click();
  await coachPage.getByRole("menuitem", { name: "Copy to…", exact: true }).click();
  await coachPage.getByRole("form", { name: "Copy program" }).getByLabel("Copy to", { exact: true }).fill("andr");
  await coachPage.getByRole("button", { name: "Andrea Copy" }).click({ timeout: 20000 });
  await coachPage.screenshot({ path: ".shots/copy-form-1440.png", fullPage: true });
  await coachPage.getByRole("button", { name: "Copy", exact: true }).click();
  const openCopy = coachPage.getByRole("link", { name: "Open the copy" });
  check("the editor says it copied, as a draft", await appears(openCopy.waitFor({ timeout: 60000 })));
  const copyId = ((await openCopy.getAttribute("href").catch(() => null)) ?? "").split("/").at(-1) ?? "";
  if (copyId) created.programs.push(copyId);

  const copy = copyId ? await db.getRow({ databaseId: D, tableId: "programs", rowId: copyId }).catch(() => null) : null;
  check(
    "a new draft program for Andrea, on the source's dates",
    copy?.athlete_id === andrea.$id && copy?.coach_id === coach.$id && copy?.status === "draft" && copy?.start_on === today,
    JSON.stringify(copy && [copy.athlete_id === andrea.$id, copy.status, copy.start_on]),
  );
  const copyRows = (await Promise.all(PROGRAM_TABLES.map((t) => rowsOf(t, t === "programs" ? "$id" : "program_id", copyId)))).flat();
  check(
    "every copied row is Andrea's, readable by her and not by Joey",
    copyRows.length >= 8 &&
      copyRows.every(
        (r) =>
          r.athlete_id === andrea.$id &&
          r.$permissions.some((p) => p.includes(andrea.$id)) &&
          !r.$permissions.some((p) => p.includes(joey.$id)) &&
          r.$permissions.every((p) => /^read\(/.test(p)),
      ),
    `${copyRows.length} rows`,
  );
  const herWeeks = copyRows.filter((r) => "block_id" in r && "status" in r && !("week_id" in r));
  check("both weeks copied, both drafts", herWeeks.length === 2 && herWeeks.every((w) => w.status === "draft"));
  const herLines = copyRows.filter((r) => "set_count" in r);
  const herSquat = herLines.filter((r) => r.exercise_id === squatId);
  check("the squat stays the global squat, load as typed", herSquat.length === 2 && herSquat.every((r) => r.load === "75%"));
  const herPaused = herLines.filter((r) => r.exercise_id !== squatId);
  const herVariation = herPaused[0]
    ? await db.getRow({ databaseId: D, tableId: "exercises", rowId: String(herPaused[0].exercise_id) }).catch(() => null)
    : null;
  check(
    "Joey's private variation became one in Andrea's library",
    herPaused.length === 2 &&
      new Set(herPaused.map((r) => r.exercise_id)).size === 1 &&
      herVariation?.owner_id === andrea.$id &&
      herVariation?.name === VARIATION &&
      herPaused.every((r) => r.load === "80% @8" && r.notes === "2s pause" && r.video_required === true && r.reference_exercise_id === squatId) &&
      herSquat.every((r) => r.video_required === false),
    JSON.stringify(herVariation && [herVariation.owner_id === andrea.$id, herVariation.name]),
  );

  // --- the route's refusals --------------------------------------------------
  console.log("\nWho may copy");
  const coachJwt = await jwtOf(coach.$id);
  const toStranger = await post(coachJwt, { op: "copyProgram", programId, athleteId: stranger.$id });
  check("not to someone the coach does not coach", toStranger.status === 403, JSON.stringify(toStranger));
  const strangerJwt = await jwtOf(stranger.$id);
  const theirs = await post(strangerJwt, { op: "copyProgram", programId, athleteId: stranger.$id });
  check("not someone else's program, even to themselves", theirs.status === 403, JSON.stringify(theirs));
  const dup = await post(strangerJwt, { op: "duplicateWeek", weekId });
  check("nor duplicate a week of it", dup.status === 403, JSON.stringify(dup));
  const anonymous = await post(null, { op: "copyProgram", programId, athleteId: andrea.$id });
  check("no JWT is a 401", anonymous.status === 401);
  const foreignReference = herPaused[0]
    ? await post(coachJwt, { op: "updatePrescription", prescriptionId: herPaused[0].$id, referenceExerciseId: pausedId })
    : { status: 0, body: {} };
  check(
    "not a reference to a lift she cannot read (Joey's variation, on her copy)",
    foreignReference.status === 400 && JSON.stringify(foreignReference.body).includes("referenceExerciseId"),
    JSON.stringify(foreignReference),
  );
  const toSelf = await post(coachJwt, { op: "copyProgram", programId, athleteId: coach.$id, name: "Mine" });
  if (toSelf.status === 200) created.programs.push(String(toSelf.body.rowId));
  check("but the coach may copy it to themselves", toSelf.status === 200, JSON.stringify(toSelf));

  // --- Andrea's Today, once the coach publishes the copy ---------------------
  console.log("\nAndrea, at 390×852, after the coach publishes her copy");
  const published = await post(coachJwt, { op: "publishProgram", programId: copyId });
  check("the coach publishes the copy", published.status === 200, JSON.stringify(published));
  const andreaCtx = await browser.newContext({ viewport: { width: 390, height: 852 }, colorScheme: "dark", hasTouch: true });
  const andreaPage = await andreaCtx.newPage();
  await signIn(andreaPage, andrea.email);
  await andreaPage.goto(`${BASE}/today`);
  const card = andreaPage.getByRole("region", { name: "Today's session" });
  check(
    "her 75% is 90 kg -- of her 120, not Joey's 200",
    await appears(card.getByText("3 × 5 · 90 kg (75%)").waitFor({ timeout: 30000 })),
  );
  check("and nowhere does she see Joey's 150", (await card.getByText("150 kg").count()) === 0);
  check(
    "her paused bench at 80% of the squat is 95 kg -- of her squat, named",
    await appears(card.getByText(/4 × 4 · 95 kg \(80% of Squat\), stop at RPE 8/).waitFor({ timeout: 10000 })),
  );
  await andreaPage.screenshot({ path: ".shots/copy-today-390.png", fullPage: true });

  // --- constraint 5 ----------------------------------------------------------
  const set = await db.getRow({ databaseId: D, tableId: "sets", rowId: setId });
  check(
    "Joey's logged set is untouched by all of it",
    set.load_kg === 150 && set.prescription_id === squatLine && set.prescribed === "5 reps · 150 kg (75%)",
  );
} catch (error) {
  check("ran without throwing", false, String(error));
} finally {
  await browser.close();
  const del = (tableId: string, rowId: string) => db.deleteRow({ databaseId: D, tableId, rowId }).catch(() => {});
  for (const programId of created.programs) {
    for (const tableId of PROGRAM_TABLES) {
      const rows = tableId === "programs" ? [{ $id: programId }] : await rowsOf(tableId, "program_id", programId).catch(() => []);
      for (const row of rows) await del(tableId, row.$id);
    }
  }
  for (const u of everyone) {
    for (const tableId of ["sets", "sessions", "stats_rollups", "reference_maxes"]) {
      for (const row of await rowsOf(tableId, "athlete_id", u.$id).catch(() => [])) await del(tableId, row.$id);
    }
    for (const row of await rowsOf("exercises", "owner_id", u.$id).catch(() => [])) await del("exercises", row.$id);
  }
  for (const id of created.links) await del("coach_athlete_links", id);
  for (const u of everyone) {
    await del("profiles", u.$id);
    await teams.delete({ teamId: circleTeamId(u.$id) }).catch(() => {});
    await users.delete({ userId: u.$id }).catch(() => {});
  }
}

const failed = results.filter((ok) => !ok).length;
console.log(failed === 0 ? `\n${results.length}/${results.length} passed. Probe data removed.` : `\n${failed} of ${results.length} FAILED`);
process.exitCode = failed ? 1 : 0;
