/**
 * Drives the Program Editor's outline redesign end to end against the live
 * instance, in a browser.
 *
 *   npx next dev -p 3100        # or npm run build && PORT=3100 npm run start
 *   E2E_BASE_URL=http://localhost:3100 npm run e2e:editor
 *
 * What only the instance can prove, every step through the coach's real UI at
 * 1440×900 and every write checked against the rows it left:
 *
 *   - The outline lists the block and its weeks with their state and dates.
 *     A week is picked by click, or by Up/Down then Enter.
 *   - A block is renamed inline, and named from its ⋯ phase presets.
 *   - "+ Week" repeats the block's last week; "+ Block" starts a new block
 *     whose first week repeats the last week before it, a week on.
 *   - Weekday chips date the day from the start date; moving the start date
 *     moves the unlogged days with it.
 *   - "Publish week 1" takes the week and the draft program live, and the
 *     athlete sees the day on Today. Unpublish puts the week back to draft.
 *   - The week ⋯ duplicates and removes (with a confirm), the day ⋯ removes,
 *     the program ⋯ opens Copy to… and publishes every remaining draft.
 *   - With the coach-side zoom (coach-scale, when it is in globals.css), no
 *     horizontal page scrollbar at 1440.
 *
 * Creates throwaway users and only ever deletes rows it created: every
 * program row is keyed on this run's program id, everything else on this
 * run's users.
 */
import { readFileSync } from "node:fs";
import { chromium, type Locator, type Page } from "playwright";
import { ID, Query, TablesDB, Teams, Users } from "node-appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
import { addCoachToCircle, ensureCircle } from "../appwrite/documents/circle-admin";
import { circleTeamId } from "../appwrite/documents/circle";
import { linkPermissions, profilePermissions } from "../appwrite/documents/policy";
import { addDays, localDay } from "../lib/programming/program";
import { mondayOf, rangeLabel, scheduledOnFor, WEEKDAYS, weekdayOf, weekRange } from "../lib/programming/calendar";
import { presetMode } from "./e2e-mode";

dedupeSdkWarnings();

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const PASSWORD = "Probe-pass-123!";
const config = serverAppwriteConfig();
const admin = createServerClient(config);
const db = new TablesDB(admin);
const users = new Users(admin);
const teams = new Teams(admin);
const D = config.databaseId;
const stamp = Date.now();
const today = localDay();
const anchor = mondayOf(today);
const PROGRAM_TABLES = ["prescriptions", "program_days", "program_weeks", "program_blocks", "programs"] as const;
/** The zoom ships on another branch; its check runs only once it is here. */
const coachScale = (() => {
  try {
    return readFileSync(new URL("../app/globals.css", import.meta.url), "utf8").includes("coach-scale");
  } catch {
    return false;
  }
})();

const results: boolean[] = [];
const check = (label: string, ok: boolean, detail = "") => {
  results.push(ok);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

const squat = await db.listRows({
  databaseId: D,
  tableId: "exercises",
  queries: [Query.equal("is_global", true), Query.equal("name", "Squat"), Query.limit(1)],
  ttl: 0,
});
const squatId = squat.rows[0]?.$id as string | undefined;
if (!squatId) throw new Error('No global exercise "Squat". Run npm run exercises:seed first.');

const mkUser = (tag: string, name: string) =>
  users.create({ userId: ID.unique(), email: `editor-${tag}-${stamp}@example.com`, password: PASSWORD, name });

const athlete = await presetMode(users, await mkUser("a", "Joey Pang"), "athlete");
const coach = await presetMode(users, await mkUser("c", "Ruairi Deane"), "coach");
const everyone = [athlete, coach];
const created = { link: "", programId: "" };

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
const goes = (target: Locator, timeout = 20000) =>
  target
    .first()
    .waitFor({ state: "detached", timeout })
    .then(() => true)
    .catch(() => false);

type Row = Record<string, unknown> & { $id: string };
const rowsOf = async (tableId: string, column: string, value: string) =>
  (await db.listRows({ databaseId: D, tableId, queries: [Query.equal(column, value), Query.limit(100)], ttl: 0 }))
    .rows as unknown as Row[];
/** Blocks, weeks and days in their stored order. */
const ordered = async (tableId: string, column: string, value: string) =>
  (await rowsOf(tableId, column, value)).sort((a, b) => Number(a.position) - Number(b.position));
const programRow = () => db.getRow({ databaseId: D, tableId: "programs", rowId: created.programId });

const poll = async <T,>(read: () => Promise<T>, done: (value: T) => boolean, ms = 20000): Promise<T> => {
  const until = Date.now() + ms;
  let value = await read();
  while (!done(value) && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 1000));
    value = await read();
  }
  return value;
};

/** Every week of the program, in outline order: block by block, week by week. */
const weeksInOrder = async () => {
  const blocks = await ordered("program_blocks", "program_id", created.programId);
  const out: Row[] = [];
  for (const block of blocks) out.push(...(await ordered("program_weeks", "block_id", block.$id)));
  return out;
};
const daysOf = (weekId: string) => ordered("program_days", "week_id", weekId);

/** The editor's day date, as dayDateLabel writes it ("Thu 9 Oct"). */
const dayLabel = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

const browser = await chromium.launch();

try {
  // --- the pair, linked as redemption links them ---------------------------
  await ensureCircle(teams, athlete.$id, "Joey Pang");
  await ensureCircle(teams, coach.$id, "Ruairi Deane");
  await addCoachToCircle(teams, athlete.$id, coach.$id);
  for (const user of everyone) {
    await db.createRow({
      databaseId: D,
      tableId: "profiles",
      rowId: user.$id,
      data: { user_id: user.$id, display_name: user.name, sex: "male", units: "kg", created_at: new Date().toISOString() },
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

  // --- a new block, and the outline it opens on ----------------------------
  console.log("The coach opens a new block, at 1440×900");
  const coachCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  const page = await coachCtx.newPage();
  await signIn(page, coach.email);
  await page.goto(`${BASE}/coach/programs`);
  const joey = page.getByRole("region", { name: "Joey Pang" });
  await joey.waitFor({ timeout: 30000 });
  await joey.getByRole("button", { name: "New block" }).click();
  await page.getByLabel("Name").fill(`E2E editor ${stamp}`);
  await page.getByLabel("Starts").fill(today);
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForURL(/\/coach\/programs\/[^/]+$/, { timeout: 30000 });
  created.programId = page.url().split("/").at(-1)!;

  const outline = page.getByRole("navigation", { name: "Program outline" });
  const weekButton = (n: number, state: "draft" | "live" | "logged") =>
    outline.getByRole("button", { name: `Week ${n}, ${state}`, exact: true });
  const heading = (name: string) => page.getByRole("heading", { level: 2, name, exact: true });
  const isCurrent = async (target: Locator) => (await target.getAttribute("aria-current").catch(() => null)) === "true";
  const pick = async (n: number, state: "draft" | "live" = "draft") => {
    await weekButton(n, state).click();
    await heading(`${await currentBlockName(n)} · Week ${n}`).waitFor({ timeout: 20000 }).catch(() => {});
  };
  // Which block a week sits in, read from the outline itself.
  const currentBlockName = async (n: number) =>
    (await outline
      .locator("section")
      .filter({ has: outline.getByRole("button", { name: new RegExp(`^Week ${n}, `) }) })
      .first()
      .getAttribute("aria-label")
      .catch(() => null)) ?? "";
  const menu = async (trigger: string, item: string) => {
    await page.getByRole("button", { name: trigger, exact: true }).click({ timeout: 20000 });
    await page.getByRole("menuitem", { name: item, exact: true }).click();
  };

  const block1 = outline.getByRole("region", { name: "Block 1", exact: true });
  check("the outline shows the block", await appears(block1));
  check(
    "with week 1 in it, a draft, selected",
    (await appears(block1.getByRole("button", { name: "Week 1, draft", exact: true }))) && (await isCurrent(weekButton(1, "draft"))),
  );
  const week1Range = rangeLabel(weekRange(anchor, 0));
  check("and week 1's dates, counted from the start date's Monday", await appears(outline.getByText(week1Range, { exact: true })), week1Range);
  check("the week's heading names block and week", await appears(heading("Block 1 · Week 1")));

  // --- a day, a line, and the weekday chips --------------------------------
  console.log("\nA day, dated by weekday");
  await page.getByRole("button", { name: "+ Day", exact: true }).click();
  const day1 = page.getByRole("region", { name: "Day 1", exact: true });
  await day1.waitFor({ timeout: 20000 });
  await day1.getByRole("combobox", { name: "Add exercise to Day 1" }).fill("Squat");
  await page.getByRole("option", { name: "Squat", exact: true }).click();
  const cell = (label: string) => day1.getByRole("textbox", { name: label, exact: true });
  const typeCell = async (label: string, value: string) => {
    await cell(label).fill(value);
    await cell(label).press("Tab");
  };
  await cell("Sets, line 1").waitFor({ timeout: 20000 });
  await typeCell("Sets, line 1", "3");
  await typeCell("Reps, line 1", "5");
  await typeCell("Load, line 1", "@8");
  const typed = await poll(
    () => rowsOf("prescriptions", "program_id", created.programId),
    (rows) => rows.length === 1 && rows[0].load === "@8",
  );
  check("the line is stored as typed", typed[0]?.set_count === 3 && typed[0]?.reps === 5 && typed[0]?.load === "@8");

  const chips = day1.getByRole("group", { name: "Day 1 weekday", exact: true });
  const chip = (weekday: number, pressed?: boolean) =>
    chips.getByRole("button", { name: WEEKDAYS[weekday], exact: true, ...(pressed === undefined ? {} : { pressed }) });
  const startWeekday = weekdayOf(today);
  check(
    "a new day lands on the start date's weekday",
    (await appears(chip(startWeekday, true))) && (await appears(day1.getByText(dayLabel(today), { exact: true }))),
    WEEKDAYS[startWeekday],
  );
  const other = (startWeekday + 1) % 7;
  const otherDate = scheduledOnFor(anchor, 0, other);
  await chip(other).click();
  const week1Id = (await weeksInOrder())[0]?.$id ?? "";
  const moved = await poll(() => daysOf(week1Id), (rows) => rows[0]?.scheduled_on === otherDate);
  check(
    `the ${WEEKDAYS[other]} chip dates the day in week 1`,
    moved[0]?.scheduled_on === otherDate &&
      (await appears(chip(other, true))) &&
      (await appears(day1.getByText(dayLabel(otherDate), { exact: true }))),
    String(moved[0]?.scheduled_on),
  );
  await chip(startWeekday).click();
  const back = await poll(() => daysOf(week1Id), (rows) => rows[0]?.scheduled_on === today);
  check("and the start weekday's chip puts it back on the start date", back[0]?.scheduled_on === today);

  // --- + Week ----------------------------------------------------------------
  console.log("\n+ Week repeats the last week");
  await outline.getByRole("button", { name: "+ Week in Block 1", exact: true }).click();
  check(
    "the new week opens as Week 2, a draft",
    (await appears(weekButton(2, "draft"))) && (await appears(heading("Block 1 · Week 2"))) && (await isCurrent(weekButton(2, "draft"))),
  );
  check(
    "with week 1's line already in it",
    await appears(page.getByRole("region", { name: "Day 1", exact: true }).getByRole("row", { name: "Day 1 line 1: Squat" })),
  );
  const afterWeek = await poll(weeksInOrder, (rows) => rows.length === 2);
  const week2Id = afterWeek[1]?.$id ?? "";
  const week2Days = week2Id ? await daysOf(week2Id) : [];
  const week2Lines = week2Id ? await poll(() => rowsOf("prescriptions", "week_id", week2Id), (r) => r.length === 1) : [];
  check(
    "stored as a copy: a day a week on, the same line",
    week2Days.length === 1 &&
      week2Days[0].scheduled_on === addDays(today, 7) &&
      week2Lines.length === 1 &&
      week2Lines[0].exercise_id === squatId &&
      week2Lines[0].set_count === 3 &&
      week2Lines[0].reps === 5 &&
      week2Lines[0].load === "@8",
    JSON.stringify(week2Days.map((d) => d.scheduled_on)),
  );

  // --- walking the outline ---------------------------------------------------
  console.log("\nThe outline, by mouse and by keyboard");
  await weekButton(1, "draft").click();
  check("a click on Week 1 shows it", await appears(heading("Block 1 · Week 1")));
  await page.keyboard.press("ArrowDown");
  const focused = () => page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "");
  check("Down moves to Week 2", (await focused()) === "Week 2, draft", await focused());
  await page.keyboard.press("Enter");
  check("Enter shows it", await appears(heading("Block 1 · Week 2")));
  await page.keyboard.press("ArrowUp");
  check("Up moves back to Week 1", (await focused()) === "Week 1, draft", await focused());
  await page.keyboard.press("Enter");
  check("and Enter shows that", await appears(heading("Block 1 · Week 1")));

  // --- naming the block --------------------------------------------------------
  console.log("\nNaming the block");
  const blockName = outline.getByRole("textbox", { name: "Block 1 name", exact: true });
  await blockName.fill("Base");
  await blockName.press("Enter");
  const renamed = await poll(
    () => ordered("program_blocks", "program_id", created.programId),
    (rows) => rows[0]?.name === "Base",
  );
  check(
    "renamed inline",
    renamed[0]?.name === "Base" && (await appears(outline.getByRole("region", { name: "Base", exact: true }))) && (await appears(heading("Base · Week 1"))),
  );
  await menu("Base actions", "Call it Intensity");
  const phased = await poll(
    () => ordered("program_blocks", "program_id", created.programId),
    (rows) => rows[0]?.name === "Intensity",
  );
  check(
    "and named from the block ⋯ phase presets",
    phased[0]?.name === "Intensity" && (await appears(outline.getByRole("region", { name: "Intensity", exact: true }))),
  );

  // --- + Block -----------------------------------------------------------------
  console.log("\n+ Block starts from the last week");
  await outline.getByRole("button", { name: "+ Block", exact: true }).click();
  const block2 = outline.getByRole("region", { name: "Block 2", exact: true });
  check(
    "a second block opens on its first week, Week 3",
    (await appears(block2.getByRole("button", { name: "Week 3, draft", exact: true }))) && (await appears(heading("Block 2 · Week 3"))),
  );
  check(
    "with the last week's line in it",
    await appears(page.getByRole("region", { name: "Day 1", exact: true }).getByRole("row", { name: "Day 1 line 1: Squat" })),
  );
  const afterBlock = await poll(weeksInOrder, (rows) => rows.length === 3);
  const week3Id = afterBlock[2]?.$id ?? "";
  const week3Days = week3Id ? await poll(() => daysOf(week3Id), (r) => r.length === 1) : [];
  const week3Lines = week3Id ? await poll(() => rowsOf("prescriptions", "week_id", week3Id), (r) => r.length === 1) : [];
  check(
    "stored as a copy of week 2, a week on",
    week3Days[0]?.scheduled_on === addDays(today, 14) &&
      week3Lines[0]?.exercise_id === squatId &&
      week3Lines[0]?.load === "@8" &&
      week3Lines[0]?.set_count === 3,
    JSON.stringify(week3Days.map((d) => d.scheduled_on)),
  );

  // --- moving the start date ---------------------------------------------------
  console.log("\nMoving the start date");
  const startDate = page.getByLabel("Start date", { exact: true });
  const dayDates = async () => {
    const weeks = await weeksInOrder();
    return (await Promise.all(weeks.map((w) => daysOf(w.$id)))).map((days) => days[0]?.scheduled_on ?? null);
  };
  await startDate.fill(addDays(today, 7));
  await startDate.press("Tab");
  const shifted = await poll(dayDates, (dates) => dates[0] === addDays(today, 7));
  check(
    "a week later moves every unlogged day a week later",
    shifted.join() === [7, 14, 21].map((n) => addDays(today, n)).join(),
    JSON.stringify(shifted),
  );
  check("the program stores the new start", (await programRow()).start_on === addDays(today, 7));
  await startDate.fill(today);
  await startDate.press("Tab");
  const restored = await poll(dayDates, (dates) => dates[0] === today);
  check("and moving it back moves them back", restored.join() === [0, 7, 14].map((n) => addDays(today, n)).join(), JSON.stringify(restored));

  // --- Publish week 1 ----------------------------------------------------------
  console.log("\nPublish week 1");
  await pick(1);
  await page.getByRole("button", { name: "Publish week 1", exact: true }).click();
  check("the outline marks week 1 live", await appears(weekButton(1, "live")));
  check("the program's status reads Live", await appears(page.getByLabel("Status").getByText("Live", { exact: true })));
  check("and counts the weeks still in draft", await appears(page.getByText(/2 draft weeks not on their Today yet/)));
  const live = await poll(weeksInOrder, (rows) => rows[0]?.status === "published");
  const program = await poll(programRow, (row) => row.status === "published");
  check(
    "stored: week 1 published, the others drafts, the program published",
    live.map((w) => w.status).join() === "published,draft,draft" && program.status === "published",
    JSON.stringify([live.map((w) => w.status), program.status]),
  );
  await page.screenshot({ path: ".shots/editor-outline-1440.png", fullPage: true });

  console.log("\nThe athlete, at 390×852");
  const athleteCtx = await browser.newContext({ viewport: { width: 390, height: 852 }, colorScheme: "dark", hasTouch: true });
  const athletePage = await athleteCtx.newPage();
  await signIn(athletePage, athlete.email);
  await athletePage.goto(`${BASE}/today`);
  const card = athletePage.getByRole("region", { name: "Today's session" });
  check("sees week 1's day on Today", await appears(card.getByText("3 × 5 · RPE 8"), 30000));
  await athleteCtx.close();

  console.log("\nUnpublish");
  await page.getByRole("button", { name: "Unpublish week 1", exact: true }).click();
  check("puts week 1 back to draft in the outline", await appears(weekButton(1, "draft")));
  const unpublished = await poll(weeksInOrder, (rows) => rows[0]?.status === "draft");
  check("and in the rows", unpublished[0]?.status === "draft");
  check("with Publish week 1 offered again", await appears(page.getByRole("button", { name: "Publish week 1", exact: true })));

  // --- the week ⋯ ----------------------------------------------------------------
  console.log("\nThe week ⋯");
  await menu("Week 1 actions", "Duplicate week 1");
  check(
    "Duplicate appends the copy to its block, as Week 3, and opens it",
    (await appears(heading("Intensity · Week 3"))) && (await isCurrent(weekButton(3, "draft"))),
  );
  check("the next block's week is now Week 4", await appears(block2.getByRole("button", { name: "Week 4, draft", exact: true })));
  const duplicated = await poll(weeksInOrder, (rows) => rows.length === 4);
  check("four weeks stored", duplicated.length === 4);
  await menu("Week 3 actions", "Remove week 3");
  const confirm = page.getByRole("group", { name: "Remove week 3?", exact: true });
  check("Remove asks first", await appears(confirm));
  check("and has removed nothing yet", (await weeksInOrder()).length === 4);
  await confirm.getByRole("button", { name: "Confirm remove week 3", exact: true }).click();
  const removed = await poll(weeksInOrder, (rows) => rows.length === 3);
  check(
    "Confirm removes it",
    removed.length === 3 && !removed.some((w) => w.$id === duplicated[2]?.$id) && (await goes(outline.getByRole("button", { name: /^Week 4, / }))),
  );

  // --- the day ⋯ -----------------------------------------------------------------
  console.log("\nThe day ⋯");
  await pick(1);
  await page.getByRole("button", { name: "+ Day", exact: true }).click();
  const day2 = page.getByRole("region", { name: "Day 2", exact: true });
  check("a second day", await appears(day2));
  await poll(() => daysOf(week1Id), (rows) => rows.length === 2);
  await menu("Day 2 actions", "Remove Day 2");
  await page.getByRole("group", { name: "Remove Day 2?", exact: true }).getByRole("button", { name: "Confirm remove day 2", exact: true }).click();
  const daysLeft = await poll(() => daysOf(week1Id), (rows) => rows.length === 1);
  check("Remove Day 2 takes it off the week", daysLeft.length === 1 && (await goes(day2)));
  check("and leaves Day 1 alone", daysLeft[0]?.scheduled_on === today && (await appears(page.getByRole("region", { name: "Day 1", exact: true }))));

  // --- the program ⋯ -------------------------------------------------------------
  console.log("\nThe program ⋯");
  await menu("Program actions", "Copy to…");
  const copyForm = page.getByRole("form", { name: "Copy program" });
  check("Copy to… opens the copy form", await appears(copyForm));
  await copyForm.getByRole("button", { name: "Close", exact: true }).click();
  check("which closes again", await goes(copyForm));
  await menu("Program actions", "Publish all draft weeks");
  const allLive = await poll(weeksInOrder, (rows) => rows.length > 0 && rows.every((w) => w.status === "published"));
  check("Publish all draft weeks publishes every one", allLive.length === 3 && allLive.every((w) => w.status === "published"));
  check(
    "and the outline has no draft left",
    (await appears(weekButton(3, "live"))) && (await outline.getByRole("button", { name: /, draft$/ }).count()) === 0,
  );

  // --- the coach-side zoom ---------------------------------------------------------
  if (coachScale) {
    const width = await page.evaluate(() => {
      const el = document.scrollingElement ?? document.documentElement;
      return { scroll: el.scrollWidth, client: el.clientWidth };
    });
    check("the coach zoom leaves no horizontal scrollbar at 1440", width.scroll <= width.client, JSON.stringify(width));
  } else {
    console.log("  SKIP  coach zoom: no coach-scale in app/globals.css on this branch");
  }
  await page.screenshot({ path: ".shots/editor-published-1440.png", fullPage: true });
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
  // Everything below is keyed on the throwaway users, so it can only be ours.
  for (const u of everyone) {
    for (const tableId of ["sets", "sessions", "stats_rollups", "reference_maxes"]) {
      for (const row of await rowsOf(tableId, "athlete_id", u.$id).catch(() => [])) await del(tableId, row.$id);
    }
    for (const row of await rowsOf("exercises", "owner_id", u.$id).catch(() => [])) await del("exercises", row.$id);
  }
  if (created.link) await del("coach_athlete_links", created.link);
  for (const u of everyone) {
    await del("profiles", u.$id);
    await teams.delete({ teamId: circleTeamId(u.$id) }).catch(() => {});
    await users.delete({ userId: u.$id }).catch(() => {});
  }
}

const failed = results.filter((ok) => !ok).length;
console.log(failed === 0 ? `\n${results.length}/${results.length} passed. Probe data removed.` : `\n${failed} of ${results.length} FAILED`);
process.exitCode = failed ? 1 : 0;
