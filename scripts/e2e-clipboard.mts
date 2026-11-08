/**
 * Drives F28, the Program Editor's clipboard, end to end against an instance,
 * in a browser. NOT for the live instance: point it at a dev or staging one.
 *
 *   npx next dev --webpack -p 3120
 *   E2E_BASE_URL=http://localhost:3120 npm run e2e:clipboard
 *
 * What only the instance can prove:
 *
 *   - Copy from a day's ⋯ in Joey's program, open Andrea's, and "Paste … here"
 *     puts the day in her week: every row stamped for her and not for Joey,
 *     his private variation a row in HER library, the day dated on its own
 *     weekday in her week, and the editor saying her maxes price it.
 *   - Copy a week, paste it from the outline into her block: a DRAFT week.
 *   - Move a day down its week from its ⋯: the positions swap on the rows.
 *   - The route answers a retried paste (same requestId) with the same row and
 *     no second copy, and refuses a paste into someone the coach does not
 *     coach, and a paste from a program by someone else.
 *   - A set Joey already logged is unchanged by all of it.
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
import { linkPermissions, profilePermissions, setPermissions } from "../appwrite/documents/policy";
import { mondayOf } from "../lib/programming/calendar";
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
const monday = mondayOf(localDay());
const PROGRAM_TABLES = ["prescriptions", "program_days", "program_weeks", "program_blocks", "programs"] as const;
const VARIATION = `E2E Clip Bench ${stamp}`;

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
  users.create({ userId: ID.unique(), email: `clip-${tag}-${stamp}@example.com`, password: PASSWORD, name });
const joey = await mkUser("j", "Joey Pang");
const andrea = await mkUser("a", "Andrea Clip");
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

  // --- Joey's block: a Thursday with a squat and his private variation ------
  const op = opRunner(admin, D, coach.$id);
  const joeysId = await op({ op: "createProgram", athleteId: joey.$id, name: `E2E clip Joey ${stamp}`, startOn: monday });
  created.programs.push(joeysId);
  const joeyBlock = await op({ op: "addBlock", programId: joeysId, name: "Volume" });
  const joeyWeek = await op({ op: "addWeek", blockId: joeyBlock, label: "Idea" });
  const thursday = await op({ op: "addDay", weekId: joeyWeek, scheduledOn: addDays(monday, 3), label: "Clip day" });
  const second = await op({ op: "addDay", weekId: joeyWeek, scheduledOn: addDays(monday, 5), label: "Second day" });
  const pausedId = await op({ op: "createExercise", programId: joeysId, name: VARIATION });
  const squatLine = await op({ op: "addPrescription", dayId: thursday, exerciseId: squatId, setCount: 3, reps: 5, load: "75%" });
  await op({ op: "addPrescription", dayId: thursday, exerciseId: pausedId, setCount: 4, reps: 4, load: "80%", referenceExerciseId: squatId });
  await op({ op: "publishProgram", programId: joeysId });

  const setId = `clip-set-${stamp}`;
  await db.createRow({
    databaseId: D,
    tableId: "sets",
    rowId: setId,
    data: {
      session_id: `clip-session-${stamp}`,
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

  // --- Andrea's program: one empty week from this Monday ---------------------
  const andreasId = await op({ op: "createProgram", athleteId: andrea.$id, name: `E2E clip Andrea ${stamp}`, startOn: monday });
  created.programs.push(andreasId);
  const andreaBlock = await op({ op: "addBlock", programId: andreasId, name: "Base" });
  const andreaWeek = await op({ op: "addWeek", blockId: andreaBlock });

  // --- Copy in Joey's, paste in Andrea's, on a phone --------------------------
  console.log("The coach copies Joey's day and pastes it into Andrea's week, at 390×852");
  const ctx = await browser.newContext({ viewport: { width: 390, height: 852 }, colorScheme: "dark", hasTouch: true });
  const page = await ctx.newPage();
  await signIn(page, coach.email);
  await page.goto(`${BASE}/coach/programs/${joeysId}?view=week`);
  await page.getByRole("button", { name: "Clip day actions", exact: true }).click({ timeout: 30000 });
  await page.getByRole("menuitem", { name: "Copy Clip day", exact: true }).click();
  const bar = page.getByRole("group", { name: "Clipboard", exact: true });
  check("the clipboard shows what it holds", await appears(bar.getByText("Clip day (2 lines)").waitFor({ timeout: 10000 })));

  await page.goto(`${BASE}/coach/programs/${andreasId}?view=week`);
  check(
    "it is still held in Andrea's program, with the maxes warning",
    await appears(bar.getByText(/percentages resolve against Andrea Clip's own maxes/).waitFor({ timeout: 30000 })),
  );
  await page.getByRole("button", { name: "Paste Clip day here", exact: true }).click();
  check(
    "the pasted day opens in her week",
    await appears(page.getByRole("region", { name: "Clip day", exact: true }).waitFor({ timeout: 30000 })),
  );
  check(
    "and the editor flags the lines she has no max for",
    await appears(page.getByRole("status").getByText(/no max to price off yet/).waitFor({ timeout: 10000 })),
  );
  await page.screenshot({ path: ".shots/clipboard-paste-390.png", fullPage: true });

  const herDays = await poll(() => rowsOf("program_days", "week_id", andreaWeek), (rows) => rows.length === 1);
  check(
    "one day in her week, on its Thursday",
    herDays.length === 1 && herDays[0].scheduled_on === addDays(monday, 3) && herDays[0].label === "Clip day",
    JSON.stringify(herDays.map((d) => [d.scheduled_on, d.label])),
  );
  const herLines = herDays[0] ? await poll(() => rowsOf("prescriptions", "day_id", herDays[0].$id), (r) => r.length === 2) : [];
  const herRows = [...herDays, ...herLines];
  check(
    "every pasted row is Andrea's, readable by her and not by Joey",
    herRows.length === 3 &&
      herRows.every(
        (r) =>
          r.athlete_id === andrea.$id &&
          r.$permissions.some((p) => p.includes(andrea.$id)) &&
          !r.$permissions.some((p) => p.includes(joey.$id)),
      ),
  );
  const herVariationLine = herLines.find((r) => r.exercise_id !== squatId);
  const herVariation = herVariationLine
    ? await db.getRow({ databaseId: D, tableId: "exercises", rowId: String(herVariationLine.exercise_id) }).catch(() => null)
    : null;
  check(
    "Joey's variation became one in her library, still 80% of the squat",
    herVariation?.owner_id === andrea.$id && herVariation?.name === VARIATION && herVariationLine?.reference_exercise_id === squatId,
  );

  // --- a week, from the outline ----------------------------------------------
  console.log("\nThe coach copies Joey's week and pastes it into Andrea's block");
  await page.goto(`${BASE}/coach/programs/${joeysId}?view=week`);
  await page.getByRole("button", { name: "Idea actions", exact: true }).click({ timeout: 30000 });
  await page.getByRole("menuitem", { name: "Copy Idea", exact: true }).click();
  await page.goto(`${BASE}/coach/programs/${andreasId}?view=week`);
  await page.getByRole("button", { name: "Paste Idea into Base", exact: true }).click({ timeout: 30000 });
  const herWeeks = await poll(() => rowsOf("program_weeks", "block_id", andreaBlock), (rows) => rows.length === 2);
  const pastedWeek = herWeeks.find((w) => w.$id !== andreaWeek);
  check(
    "a second week, a draft, labelled as Joey's was",
    pastedWeek?.status === "draft" && pastedWeek?.position === 1 && pastedWeek?.label === "Idea",
    JSON.stringify(pastedWeek && [pastedWeek.status, pastedWeek.position, pastedWeek.label]),
  );
  const weekDays = pastedWeek ? await rowsOf("program_days", "week_id", pastedWeek.$id) : [];
  check(
    "its days on their weekdays a week on",
    weekDays.map((d) => String(d.scheduled_on)).sort().join() === [addDays(monday, 10), addDays(monday, 12)].join(),
    JSON.stringify(weekDays.map((d) => d.scheduled_on)),
  );

  // --- move a day ------------------------------------------------------------
  console.log("\nThe coach moves Joey's first day down");
  await page.goto(`${BASE}/coach/programs/${joeysId}?view=week`);
  await page.getByRole("button", { name: "Clip day actions", exact: true }).click({ timeout: 30000 });
  await page.getByRole("menuitem", { name: "Move Clip day down", exact: true }).click();
  const moved = await poll(
    () => rowsOf("program_days", "week_id", joeyWeek),
    (rows) => rows.find((r) => r.$id === thursday)?.position === 1,
  );
  check(
    "the two days swapped places",
    moved.find((r) => r.$id === thursday)?.position === 1 && moved.find((r) => r.$id === second)?.position === 0,
  );

  // --- the route ---------------------------------------------------------------
  console.log("\nRetries and refusals");
  const coachJwt = await jwtOf(coach.$id);
  const requestId = `e2e${stamp}`.slice(0, 20);
  const first = await post(coachJwt, { op: "copyDay", dayId: thursday, toWeekId: andreaWeek, requestId });
  const again = await post(coachJwt, { op: "copyDay", dayId: thursday, toWeekId: andreaWeek, requestId });
  const afterRetry = await rowsOf("program_days", "week_id", andreaWeek);
  check(
    "a retried paste is the same day, written once",
    first.status === 200 && again.status === 200 && first.body.rowId === requestId && again.body.rowId === requestId &&
      afterRetry.filter((d) => d.$id === requestId).length === 1 && afterRetry.length === 2,
    JSON.stringify([first, again, afterRetry.length]),
  );
  const strangerJwt = await jwtOf(stranger.$id);
  const theirs = await post(strangerJwt, { op: "copyDay", dayId: thursday, toWeekId: andreaWeek });
  check("not from someone else's program", theirs.status === 403, JSON.stringify(theirs));
  const strangerOwn = await opRunner(admin, D, stranger.$id)({ op: "createProgram", athleteId: stranger.$id, name: `E2E clip stranger ${stamp}` });
  created.programs.push(strangerOwn);
  const strangerBlock = await opRunner(admin, D, stranger.$id)({ op: "addBlock", programId: strangerOwn, name: "B" });
  const intoStranger = await post(coachJwt, { op: "copyWeek", weekId: joeyWeek, toBlockId: strangerBlock });
  check("not into someone the coach does not coach", intoStranger.status === 403, JSON.stringify(intoStranger));
  check("no JWT is a 401", (await post(null, { op: "copyDay", dayId: thursday, toWeekId: andreaWeek })).status === 401);

  const set = await db.getRow({ databaseId: D, tableId: "sets", rowId: setId });
  check("Joey's logged set is untouched", set.load_kg === 150 && set.prescription_id === squatLine);
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
