/**
 * Drives the Program Editor layout revamp (docs/program-layout.md) end to end
 * against the live instance, in a browser, at the coach's 1440×900, with real
 * mouse and keyboard events.
 *
 *   npx next build --webpack && npx next start -p 3203
 *   E2E_BASE_URL=http://localhost:3203 npm run e2e:program-layout
 *
 * What only the instance can prove:
 *
 *   - Under a percentage, the kilos the athlete's phone will resolve, and the
 *     max and date behind them, read from their real reference_maxes rows.
 *   - "Add one" beside a missing max writes a reference_maxes row through
 *     /api/reference-max as the coach, and the line prices off it at once.
 *   - `5x3 @8` typed into a sets cell stores set_count, reps and load in one
 *     write, and the keyboard is still in the grid afterwards. Down crosses
 *     into the next day card; Enter on a last row reaches "Add exercise".
 *   - The Progression tab is `?view=progression`, survives a reload, edits a
 *     week's load from one number, and adds a missing line from an empty cell.
 *   - The context drawer shows the athlete's last logged week of the squat
 *     and the clip this coach has not cleared, from the real sets.
 *   - No horizontal page scroll at 1440 in the progression view.
 *   - "Duplicate with a bump…" previews the landing and the changed lines,
 *     then writes the copy with the step applied and the source untouched.
 *
 * Creates throwaway users and only ever deletes rows it created: program rows
 * keyed on this run's program id, everything else on this run's users.
 */
import { chromium, type Locator, type Page } from "playwright";
import { ID, Query, TablesDB, Teams, Users } from "node-appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
import { circleTeamId } from "../appwrite/documents/circle";
import { profilePermissions, referenceMaxPermissions, sessionPermissions, setPermissions } from "../appwrite/documents/policy";
import { addDays, localDay } from "../lib/programming/program";
import { mondayOf } from "../lib/programming/calendar";
import { maxDateLabel } from "../lib/strength/reference-max";
import { estimateOneRepMax } from "../lib/strength/e1rm";
import { linkPair, opRunner, sampleExerciseIds } from "./program-fixtures";
import { presetMode } from "./e2e-mode";

dedupeSdkWarnings();

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3203";
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
  users.create({ userId: ID.unique(), email: `layout-${tag}-${stamp}@example.com`, password: PASSWORD, name });
const athlete = await presetMode(users, await mkUser("a", "Joey Pang"), "athlete");
const coach = await presetMode(users, await mkUser("c", "Ruairi Deane"), "coach");
const everyone = [athlete, coach];
const created = { programId: "", exercises: [] as string[] };

const signIn = async (page: Page, email: string) => {
  await page.goto(`${BASE}/sign-in`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 30000 }).catch(() => {});
};
const appears = (target: Locator, timeout = 20000) =>
  target
    .first()
    .waitFor({ timeout })
    .then(() => true)
    .catch(() => false);
type Row = Record<string, unknown> & { $id: string };
const rowsOf = async (tableId: string, column: string, value: string) =>
  (await db.listRows({ databaseId: D, tableId, queries: [Query.equal(column, value), Query.limit(100)], ttl: 0 }))
    .rows as unknown as Row[];
const poll = async <T,>(read: () => Promise<T>, done: (value: T) => boolean, ms = 20000): Promise<T> => {
  const until = Date.now() + ms;
  let value = await read();
  while (!done(value) && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 1000));
    value = await read();
  }
  return value;
};
const focused = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "");
/** Select a cell's text with the keyboard and type over it, as a coach does. */
const typeOver = async (page: Page, cell: Locator, text: string) => {
  await cell.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(text);
};

const browser = await chromium.launch();

try {
  for (const user of everyone) {
    await db.createRow({
      databaseId: D,
      tableId: "profiles",
      rowId: user.$id,
      data: { user_id: user.$id, display_name: user.name, sex: "male", units: "kg", created_at: new Date().toISOString() },
      permissions: profilePermissions({ athleteId: user.$id }),
    });
  }
  await linkPair(admin, D, { coachId: coach.$id, coachName: "Ruairi Deane", athleteId: athlete.$id, athleteName: "Joey Pang" });
  const { ids, created: madeExercises } = await sampleExerciseIds(admin, D);
  created.exercises = madeExercises;

  // Squat training max 190 from 12 Sep; no bench max at all.
  const squatMaxFrom = "2026-09-12T00:00:00.000Z";
  await db.createRow({
    databaseId: D,
    tableId: "reference_maxes",
    rowId: ID.unique(),
    data: {
      athlete_id: athlete.$id,
      exercise_id: ids.Squat,
      kind: "training",
      value_kg: 190,
      effective_from: squatMaxFrom,
      recorded_by: coach.$id,
      created_at: new Date().toISOString(),
    },
    permissions: referenceMaxPermissions({ athleteId: athlete.$id }),
  });

  // Last week's squat session, with one filmed set nobody has reviewed.
  const lastWeek = new Date(`${addDays(mondayOf(localDay()), -6)}T10:00:00`);
  const sessionId = `layout-s-${stamp}`;
  await db.createRow({
    databaseId: D,
    tableId: "sessions",
    rowId: sessionId,
    data: {
      athlete_id: athlete.$id,
      client_session_id: sessionId,
      started_at: lastWeek.toISOString(),
      finished_at: new Date(lastWeek.getTime() + 50 * 60_000).toISOString(),
      set_count: 3,
      tonnage_kg: 180 * 3 + 2 * 150 * 5,
    },
    permissions: sessionPermissions({ athleteId: athlete.$id }),
  });
  for (const [n, set] of [
    { loadKg: 180, reps: 3, rpe: 8, video: true },
    { loadKg: 150, reps: 5, rpe: 7 },
    { loadKg: 150, reps: 5, rpe: 7 },
  ].entries()) {
    const setId = `layout-t-${stamp}-${n}`;
    await db.createRow({
      databaseId: D,
      tableId: "sets",
      rowId: setId,
      data: {
        session_id: sessionId,
        athlete_id: athlete.$id,
        exercise_id: ids.Squat,
        set_index: n,
        load_kg: set.loadKg,
        reps: set.reps,
        rpe: set.rpe,
        is_warmup: false,
        e1rm_kg: estimateOneRepMax(set) ?? undefined,
        logged_at: new Date(lastWeek.getTime() + (n + 1) * 5 * 60_000).toISOString(),
        client_set_id: setId,
        video_file_id: "video" in set ? `layout-nofile-${stamp}` : undefined,
      },
      permissions: setPermissions({ athleteId: athlete.$id }),
    });
  }

  // --- the program: two weeks of Volume -------------------------------------
  const monday = mondayOf(localDay());
  const op = opRunner(admin, D, coach.$id);
  created.programId = await op({ op: "createProgram", athleteId: athlete.$id, name: `E2E layout ${stamp}`, startOn: monday });
  const block = await op({ op: "addBlock", programId: created.programId, name: "Volume" });
  const w1 = await op({ op: "addWeek", blockId: block });
  const heavy = await op({ op: "addDay", weekId: w1, label: "Heavy squat", scheduledOn: monday });
  await op({ op: "addPrescription", dayId: heavy, exerciseId: ids.Squat, setCount: 1, reps: 5, load: "@8" });
  await op({ op: "addPrescription", dayId: heavy, exerciseId: ids.Squat, setCount: 3, reps: 5, load: "75%" });
  const benchLine = await op({ op: "addPrescription", dayId: heavy, exerciseId: ids["Bench Press"], setCount: 4, reps: 6, load: "70%" });
  const benchDay = await op({ op: "addDay", weekId: w1, label: "Bench day", scheduledOn: addDays(monday, 2) });
  await op({ op: "addPrescription", dayId: benchDay, exerciseId: ids["Bench Press"], setCount: 1, reps: 4, load: "@8" });
  const w2 = await op({ op: "duplicateWeek", weekId: w1 });
  // Week 2: the squat backoff steps up, and the bench line is left out.
  const w2Lines = await rowsOf("prescriptions", "week_id", w2);
  const w2Backoff = w2Lines.find((l) => l.load === "75%")!;
  await op({ op: "updatePrescription", prescriptionId: w2Backoff.$id, load: "77.5%" });
  await op({ op: "removePrescription", prescriptionId: w2Lines.find((l) => l.load === "70%")!.$id });

  // --- the coach, at 1440 -----------------------------------------------------
  console.log("The coach's week view, at 1440×900");
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  const page = await ctx.newPage();
  await signIn(page, coach.email);
  await page.goto(`${BASE}/coach/programs/${created.programId}?view=week`);
  const heavyDay = page.getByRole("region", { name: "Heavy squat", exact: true });
  await heavyDay.waitFor({ timeout: 30000 });
  check(
    "a squat percentage shows its kilos and the max and date behind them",
    await appears(heavyDay.getByText(`→ 142.5 kg · Squat training max 190, set ${maxDateLabel(squatMaxFrom)}`, { exact: true })),
  );
  check(
    "a bench percentage with no max says which max, for whom, and what they will see",
    await appears(heavyDay.getByText('No Bench Press training max for Joey Pang · they see "70%"', { exact: true })),
  );
  await page.screenshot({ path: ".shots/layout-week-1440.png", fullPage: true });

  console.log("\nAdd one");
  await heavyDay.getByRole("button", { name: "Add one" }).first().click();
  await page.keyboard.type("100");
  await page.keyboard.press("Enter");
  const benchMax = await poll(
    async () => (await rowsOf("reference_maxes", "athlete_id", athlete.$id)).filter((r) => r.exercise_id === ids["Bench Press"]),
    (rows) => rows.length === 1,
  );
  check(
    "writes a bench training max through the route, recorded by the coach",
    benchMax[0]?.kind === "training" && benchMax[0]?.value_kg === 100 && benchMax[0]?.recorded_by === coach.$id,
    JSON.stringify(benchMax.map((r) => [r.kind, r.value_kg, r.recorded_by === coach.$id])),
  );
  check(
    "and the line prices off it at once",
    await appears(heavyDay.getByText(new RegExp(`^→ 70 kg · Bench Press training max 100, set `))),
  );

  console.log("\nShorthand and the keyboard");
  await typeOver(page, heavyDay.getByRole("textbox", { name: "Sets, line 3", exact: true }), "5x3 @8");
  await page.keyboard.press("Tab");
  const bench = await poll(
    async () => (await rowsOf("prescriptions", "day_id", heavy)).find((r) => r.$id === benchLine),
    (row) => row?.set_count === 5 && row?.reps === 3 && row?.load === "@8",
  );
  check(
    "5x3 @8 in the sets cell stores sets, reps and load",
    bench?.set_count === 5 && bench?.reps === 3 && bench?.load === "@8",
    JSON.stringify([bench?.set_count, bench?.reps, bench?.load]),
  );
  check("and Tab left the keyboard on the reps cell it filled", (await focused(page)) === "Reps, line 3", await focused(page));
  check(
    "which shows the 3",
    (await heavyDay.getByRole("textbox", { name: "Reps, line 3", exact: true }).inputValue()) === "3",
  );
  await page.keyboard.press("ArrowDown");
  const benchDayCard = page.getByRole("region", { name: "Bench day", exact: true });
  check(
    "Down from the last row lands in the next day card, same column",
    (await focused(page)) === "Reps, line 1" &&
      (await benchDayCard.evaluate((el) => el.contains(document.activeElement))),
  );
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  check(
    "Enter on a day's last row goes to its Add exercise field",
    (await focused(page)) === "Add exercise to Heavy squat",
    await focused(page),
  );

  console.log("\nThe context drawer");
  await page.getByRole("button", { name: "Context", exact: true }).click();
  const drawer = page.getByRole("complementary", { name: "Context" });
  check("opens beside the week", await appears(drawer));
  check("with last week's squat sets as logged", await appears(drawer.getByText(/180 × 3 @8, 150 × 5 @7 ×2$/)));
  check("and the clip waiting for this coach", await appears(drawer.getByText("Videos waiting · 1", { exact: true })));
  await page.screenshot({ path: ".shots/layout-context-1440.png", fullPage: true });
  await drawer.getByRole("button", { name: "Close" }).click();

  console.log("\nThe progression view");
  await page.getByRole("tab", { name: "Progression" }).click();
  const grid = page.getByRole("table", { name: "Volume progression" });
  check(
    "the tab writes ?view=progression and shows the block",
    (await appears(grid)) && new URL(page.url()).searchParams.get("view") === "progression",
  );
  await page.reload();
  check("a reload stays on it", await appears(grid, 30000));
  const cell = (name: string) => grid.getByRole("textbox", { name, exact: true });
  check(
    "the squat backoff is one row across the weeks",
    (await cell("Heavy squat · Squat (2nd), Week 1").inputValue()) === "3x5 75%" && (await cell("Heavy squat · Squat (2nd), Week 2").inputValue()) === "3x5 77.5%",
  );
  check("each with its kilos", await appears(grid.getByText("→ 145 kg", { exact: true })));
  await typeOver(page, cell("Heavy squat · Squat (2nd), Week 2"), "80%");
  await page.keyboard.press("Tab");
  const stepped = await poll(
    () => db.getRow({ databaseId: D, tableId: "prescriptions", rowId: w2Backoff.$id }) as Promise<Row>,
    (row) => row.load === "80%",
  );
  check("one number changes a week's load", stepped.load === "80%" && stepped.set_count === 3 && stepped.reps === 5);
  check("shown as the line", (await cell("Heavy squat · Squat (2nd), Week 2").inputValue()) === "3x5 80%");
  await cell("Heavy squat · Squat, Week 1").click();
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowRight");
  check("Right from a cell's end walks to the next week", (await focused(page)) === "Heavy squat · Squat, Week 2", await focused(page));
  const empty = cell("Heavy squat · Bench Press, Week 2");
  check("the week without the bench line offers an empty cell", (await empty.inputValue()) === "");
  await empty.click();
  await page.keyboard.type("4x6 72.5%");
  await page.keyboard.press("Enter");
  const w2Days = await rowsOf("program_days", "week_id", w2);
  const added = await poll(
    async () => (await rowsOf("prescriptions", "week_id", w2)).filter((r) => r.exercise_id === ids["Bench Press"] && r.set_count === 4),
    (rows) => rows.length === 1,
  );
  const heavyW2 = w2Days.find((d) => d.label === "Heavy squat");
  check(
    "typing into it adds the line to that week's day",
    added[0]?.day_id === heavyW2?.$id && added[0]?.reps === 6 && added[0]?.load === "72.5%",
    JSON.stringify(added.map((r) => [r.day_id === heavyW2?.$id, r.reps, r.load])),
  );
  check("and the cell becomes it", await appears(grid.getByRole("textbox", { name: "Heavy squat · Bench Press, Week 2", exact: true })) && (await cell("Heavy squat · Bench Press, Week 2").inputValue()) === "4x6 72.5%");
  const fits = await page.evaluate(() => {
    const el = document.scrollingElement ?? document.documentElement;
    return el.scrollWidth <= el.clientWidth;
  });
  check("no horizontal page scroll at 1440", fits);
  await page.screenshot({ path: ".shots/layout-progression-1440.png", fullPage: true });

  console.log("\nDuplicate with a bump");
  await page.getByRole("button", { name: "Open Week 1 in the week view" }).click();
  await page.getByRole("button", { name: "Week 1 actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Duplicate with a bump…", exact: true }).click();
  const form = page.getByRole("region", { name: "Duplicate with a bump" });
  check("the form previews where the copy lands", await appears(form.getByText(/^Lands as Week 3, .*, at the end of Volume\.$/)));
  await page.keyboard.type("2.5"); // the + % field has the focus
  check("and which lines change", await appears(form.getByRole("listitem").filter({ hasText: "Squat: 75% → 77.5%" })));
  await page.keyboard.press("Enter");
  const weeks = await poll(
    async () => (await rowsOf("program_weeks", "block_id", block)).sort((a, b) => Number(a.position) - Number(b.position)),
    (rows) => rows.length === 3,
  );
  const copyLines = weeks[2]
    ? await poll(
        () => rowsOf("prescriptions", "week_id", weeks[2].$id),
        (rows) => rows.some((r) => r.load === "77.5%"),
      )
    : [];
  check(
    "writes the copy at the end of the block with the backoff stepped and the RPE lines as they were",
    weeks.length === 3 &&
      weeks[2].status === "draft" &&
      copyLines.filter((r) => r.load === "77.5%").length === 1 &&
      copyLines.filter((r) => r.load === "@8").length === 3 &&
      copyLines.length === 4,
    JSON.stringify(copyLines.map((r) => r.load)),
  );
  check("and opens it", await appears(page.getByRole("heading", { level: 2, name: "Volume · Week 3", exact: true })));
  const sourceLines = await rowsOf("prescriptions", "week_id", w1);
  check("the source week is untouched", sourceLines.some((r) => r.load === "75%") && !sourceLines.some((r) => r.load === "77.5%"));
} catch (error) {
  check("ran without throwing", false, String(error));
} finally {
  await browser.close();
  const del = (tableId: string, rowId: string) => db.deleteRow({ databaseId: D, tableId, rowId }).catch(() => {});
  if (created.programId) {
    for (const tableId of PROGRAM_TABLES) {
      const rows =
        tableId === "programs" ? [{ $id: created.programId }] : await rowsOf(tableId, "program_id", created.programId).catch(() => []);
      for (const row of rows) await del(tableId, row.$id);
    }
  }
  // Everything below is keyed on the throwaway users, so it can only be ours.
  for (const u of everyone) {
    for (const tableId of ["sets", "sessions", "stats_rollups", "reference_maxes"]) {
      for (const row of await rowsOf(tableId, "athlete_id", u.$id).catch(() => [])) await del(tableId, row.$id);
    }
    for (const row of await rowsOf("coach_athlete_links", "athlete_id", u.$id).catch(() => [])) await del("coach_athlete_links", row.$id);
  }
  for (const id of created.exercises) await del("exercises", id);
  for (const u of everyone) {
    await del("profiles", u.$id);
    await teams.delete({ teamId: circleTeamId(u.$id) }).catch(() => {});
    await users.delete({ userId: u.$id }).catch(() => {});
  }
}

const failed = results.filter((ok) => !ok).length;
console.log(failed === 0 ? `\n${results.length}/${results.length} passed. Probe data removed.` : `\n${failed} of ${results.length} FAILED`);
process.exitCode = failed ? 1 : 0;
