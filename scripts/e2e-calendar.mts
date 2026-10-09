/**
 * Drives the Program Editor's Calendar view end to end against the live
 * instance, in a browser, at the coach's 1440×900.
 *
 *   npx next dev --webpack -p 3124
 *   E2E_BASE_URL=http://localhost:3124 npm run e2e:calendar
 *
 * What only the instance can prove:
 *
 *   - `?view=calendar` opens the calendar and survives a reload; the Week |
 *     Calendar toggle writes and clears it without leaving the page.
 *   - The grid is Monday first, one row per program week across both blocks,
 *     each row named with its block, week and state, each day summarised with
 *     its first three exercises and "+N more".
 *   - Clicking a day lands on Week view, on that week, scrolled to the day.
 *   - "+ Day" on an empty cell stores the cell's date (start Monday + whole
 *     weeks + weekday) on the right week, through /api/program, and the cell
 *     turns into the new day.
 *   - At 1440 the calendar fits without a horizontal scroll.
 *
 * The program is written through the same validated ops the editor sends
 * (program-fixtures.ts). Creates throwaway users and only deletes rows it
 * created.
 */
import { chromium, type Page } from "playwright";
import { ID, Query, TablesDB, Teams, Users } from "node-appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
import { circleTeamId } from "../appwrite/documents/circle";
import { profilePermissions } from "../appwrite/documents/policy";
import { addDays, localDay } from "../lib/programming/program";
import { mondayOf } from "../lib/programming/calendar";
import { dayDateLabel } from "../lib/programming/editor";
import { linkPair, opRunner, sampleExerciseIds } from "./program-fixtures";

dedupeSdkWarnings();

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3124";
const PASSWORD = "Probe-pass-123!";
const config = serverAppwriteConfig();
const admin = createServerClient(config);
const db = new TablesDB(admin);
const users = new Users(admin);
const teams = new Teams(admin);
const D = config.databaseId;
const stamp = Date.now();
const PROGRAM_TABLES = ["prescriptions", "program_days", "program_weeks", "program_blocks", "programs"] as const;

const results: boolean[] = [];
const check = (label: string, ok: boolean, detail = "") => {
  results.push(ok);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

const mkUser = (tag: string, name: string) =>
  users.create({ userId: ID.unique(), email: `cal-${tag}-${stamp}@example.com`, password: PASSWORD, name });
const athlete = await mkUser("a", "Joey Pang");
const coach = await mkUser("c", "Ruairi Deane");
const created = { link: "", programId: "", exercises: [] as string[] };

const signIn = async (page: Page, email: string) => {
  await page.goto(`${BASE}/sign-in`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 30000 }).catch(() => {});
};
const appears = (locator: ReturnType<Page["getByRole"]>, timeout = 20000) =>
  locator
    .first()
    .waitFor({ timeout })
    .then(() => true)
    .catch(() => false);
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
const viewParam = (page: Page) => new URL(page.url()).searchParams.get("view");

const browser = await chromium.launch();

try {
  for (const [user, name] of [
    [athlete, "Joey Pang"],
    [coach, "Ruairi Deane"],
  ] as const) {
    await db.createRow({
      databaseId: D,
      tableId: "profiles",
      rowId: user.$id,
      data: { user_id: user.$id, display_name: name, sex: "male", units: "kg", created_at: new Date().toISOString() },
      permissions: profilePermissions({ athleteId: user.$id }),
    });
  }
  await linkPair(admin, D, {
    coachId: coach.$id,
    coachName: "Ruairi Deane",
    athleteId: athlete.$id,
    athleteName: "Joey Pang",
  });
  created.link = (await rowsOf("coach_athlete_links", "athlete_id", athlete.$id))[0]?.$id ?? "";
  const { ids, created: madeExercises } = await sampleExerciseIds(admin, D);
  created.exercises = madeExercises;

  // --- the program: Accumulation (2 weeks), Intensity (1 week) ---------------
  // Starts on a Wednesday so week 1 still runs Monday to Sunday.
  const monday = mondayOf(localDay());
  const op = opRunner(admin, D, coach.$id);
  created.programId = await op({
    op: "createProgram",
    athleteId: athlete.$id,
    name: `E2E calendar ${stamp}`,
    startOn: addDays(monday, 2),
  });
  const acc = await op({ op: "addBlock", programId: created.programId, name: "Accumulation" });
  const w1 = await op({ op: "addWeek", blockId: acc });
  const w2 = await op({ op: "addWeek", blockId: acc });
  const int = await op({ op: "addBlock", programId: created.programId, name: "Intensity" });
  await op({ op: "addWeek", blockId: int });
  const squatDay = await op({ op: "addDay", weekId: w1, label: "Squat day", scheduledOn: monday });
  for (const exercise of ["Squat", "Squat", "Bench Press", "Deadlift", "Front Squat"] as const) {
    await op({ op: "addPrescription", dayId: squatDay, exerciseId: ids[exercise], setCount: 3, reps: 5, load: "@8" });
  }
  await op({ op: "addDay", weekId: w2, scheduledOn: addDays(monday, 8) });

  // --- the calendar --------------------------------------------------------
  console.log("The coach's calendar, at 1440×900");
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  const page = await ctx.newPage();
  await signIn(page, coach.email);
  await page.goto(`${BASE}/coach/programs/${created.programId}?view=calendar`);
  const grid = page.getByRole("grid", { name: "Program calendar" });
  check("?view=calendar opens the calendar", await appears(grid, 30000));
  check(
    "with Calendar selected in the toggle",
    (await page.getByRole("tab", { name: "Calendar" }).getAttribute("aria-selected")) === "true",
  );
  const headers = await grid.getByRole("columnheader").allInnerTexts();
  check(
    "Monday first",
    headers.map((h) => h.trim().toLowerCase()).join(",") === "week,mon,tue,wed,thu,fri,sat,sun",
    headers.join(","),
  );
  for (const name of ["Accumulation · Week 1, draft", "Accumulation · Week 2, draft", "Intensity · Week 3, draft"]) {
    check(`a row for ${name}`, await appears(grid.getByRole("rowheader", { name, exact: true })));
  }
  const squat = grid.getByRole("button", {
    name: `${dayDateLabel(monday)}, Squat day: Squat, Bench Press, Deadlift, +1`,
    exact: true,
  });
  check("the day is summarised: three exercises and +1", await appears(squat));
  check("and says +1 more on screen", await appears(squat.getByText("+1 more")));
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  check("no horizontal scroll at 1440", fits);
  await page.screenshot({ path: ".shots/program-calendar-1440.png", fullPage: true });

  await page.reload();
  check("a reload stays on the calendar", await appears(grid, 30000));

  // --- the toggle --------------------------------------------------------------
  await page.getByRole("tab", { name: "Week" }).click();
  check(
    "Week drops ?view from the URL",
    await page
      .waitForURL((u) => !u.searchParams.has("view"))
      .then(() => true)
      .catch(() => false),
  );
  check("and shows the week", await appears(page.getByRole("region", { name: "Squat day" })));
  await page.getByRole("tab", { name: "Calendar" }).click();
  check(
    "Calendar puts it back",
    await page
      .waitForURL((u) => u.searchParams.get("view") === "calendar")
      .then(() => true)
      .catch(() => false),
  );

  // --- click-through -------------------------------------------------------------
  await squat.click();
  const day = page.getByRole("region", { name: "Squat day" });
  check("a day opens in Week view", (await appears(day)) && viewParam(page) === null);
  check("on its week", await appears(page.getByRole("heading", { name: "Accumulation · Week 1" })));
  check("scrolled to it", (await day.isVisible()) && (await day.boundingBox())!.y < 900);
  check("with the keyboard inside it", await day.evaluate((el) => el.contains(document.activeElement)));
  await page.screenshot({ path: ".shots/program-calendar-clickthrough-1440.png" });

  // --- + Day from the calendar ---------------------------------------------------
  await page.getByRole("tab", { name: "Calendar" }).click();
  await grid.waitFor({ timeout: 20000 });
  const wednesday = addDays(monday, 9);
  const add = grid.getByRole("button", { name: `+ Day on ${dayDateLabel(wednesday)}`, exact: true });
  await add.focus();
  check("an empty cell offers + Day on focus", await add.isVisible());
  await add.press("Enter");
  const days = await poll(
    () => rowsOf("program_days", "week_id", w2),
    (rows) => rows.length === 2,
  );
  check(
    "+ Day stores the cell's date on the cell's week",
    days.some((r) => r.scheduled_on === wednesday),
    JSON.stringify(days.map((r) => r.scheduled_on)),
  );
  check(
    "and the cell becomes the new day",
    await appears(grid.getByRole("button", { name: `${dayDateLabel(wednesday)}, Day 2: no exercises`, exact: true })),
  );
  check("still on the calendar", viewParam(page) === "calendar");
  await page.screenshot({ path: ".shots/program-calendar-added-1440.png", fullPage: true });
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
  if (created.link) await del("coach_athlete_links", created.link);
  for (const id of created.exercises) await del("exercises", id);
  for (const u of [athlete, coach]) {
    await del("profiles", u.$id);
    await teams.delete({ teamId: circleTeamId(u.$id) }).catch(() => {});
    await users.delete({ userId: u.$id }).catch(() => {});
  }
}

const failed = results.filter((ok) => !ok).length;
console.log(
  failed === 0
    ? `\n${results.length}/${results.length} passed. Probe data removed.`
    : `\n${failed} of ${results.length} FAILED`,
);
process.exitCode = failed ? 1 : 0;
