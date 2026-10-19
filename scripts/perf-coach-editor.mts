/**
 * Frame timing in the Program Editor while a coach works in it, at 1440×900,
 * against the live instance. Written for the motion ticket (docs/coach-motion.md):
 * run it on a build without the motion and on one with it, and compare.
 *
 *   npx next build --webpack && npx next start -p 3205
 *   E2E_BASE_URL=http://localhost:3205 npm run perf:coach-editor -- --label after
 *
 * The week is heavier than the sample block: five days of six lines, every
 * load cell with its preview line under it -- about the most a coach puts in
 * one week. Three things are timed, each at 1× and at 4× CPU throttling (a
 * slow laptop, roughly):
 *
 *   - typing: Tab along three rows of day 1, changing sets, reps, load and
 *     rest, at a fast typist's pace. Every change commits, so the optimistic
 *     re-render and the saved/failed confirmation are in the numbers.
 *   - views: Week -> Calendar -> Progression -> Week, three times.
 *   - typeahead: focus "Add exercise", arrow through the list, type, arrow,
 *     Escape, on three days.
 *
 * Measured in the page: every requestAnimationFrame interval while the
 * scenario runs, and the Long Animation Frames and long tasks the browser
 * reports (PerformanceObserver). A frame over 33.4 ms is at least one frame
 * dropped at 60 Hz. Headless Chromium's frame clock is not a real display's,
 * so the numbers are for comparing two builds on one machine, not absolute.
 *
 * Creates two throwaway users and one program; deletes only what it created.
 */
import { chromium, type Page } from "playwright";
import { ID, Query, TablesDB, Teams, Users } from "node-appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
import { circleTeamId } from "../appwrite/documents/circle";
import { profilePermissions } from "../appwrite/documents/policy";
import { localDay } from "../lib/programming/program";
import { mondayOf } from "../lib/programming/calendar";
import { sampleProgram, writeOutline, type OutlineLine } from "../lib/programming/sample-program";
import { linkPair, opRunner, sampleExerciseIds } from "./program-fixtures";
import { presetMode } from "./e2e-mode";

dedupeSdkWarnings();

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3205";
const LABEL = process.argv.includes("--label") ? process.argv[process.argv.indexOf("--label") + 1] : "run";
const PASSWORD = "Probe-pass-123!";
const config = serverAppwriteConfig();
const admin = createServerClient(config);
const db = new TablesDB(admin);
const users = new Users(admin);
const teams = new Teams(admin);
const D = config.databaseId;
const stamp = Date.now();
const PROGRAM_TABLES = ["prescriptions", "program_days", "program_weeks", "program_blocks", "programs"] as const;

const mkUser = (tag: string, name: string) =>
  users.create({ userId: ID.unique(), email: `perf-${tag}-${stamp}@example.com`, password: PASSWORD, name });
const athlete = await presetMode(users, await mkUser("a", "Joey Pang"), "athlete");
const coach = await presetMode(users, await mkUser("c", "Ruairi Deane"), "coach");
const created = { link: "", programId: "", exercises: [] as string[] };

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

/**
 * Installed once per page: a frame recorder and the browser's own long-frame
 * reports. A string, not a function: tsx wraps named functions in a helper
 * that does not exist in the page.
 */
const PROBE = `(() => {
  const p = (window.__probe = { frames: [], long: [], tasks: [], running: false, last: 0 });
  const tick = (t) => {
    if (p.running) {
      if (p.last) p.frames.push(t - p.last);
      p.last = t;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  try {
    new PerformanceObserver((list) => {
      if (!p.running) return;
      for (const e of list.getEntries()) p.long.push({ start: e.startTime, duration: e.duration, blocking: e.blockingDuration || 0 });
    }).observe({ type: "long-animation-frame", buffered: false });
  } catch {}
  try {
    new PerformanceObserver((list) => {
      if (!p.running) return;
      for (const e of list.getEntries()) p.tasks.push({ start: e.startTime, duration: e.duration });
    }).observe({ type: "longtask", buffered: false });
  } catch {}
})()`;

const START = `(() => { const p = window.__probe; p.frames = []; p.long = []; p.tasks = []; p.last = 0; p.running = true; })()`;
const STOP = `(() => { const p = window.__probe; p.running = false; return { frames: p.frames, long: p.long, tasks: p.tasks }; })()`;

type Stats = {
  frames: number;
  p50: number;
  p95: number;
  max: number;
  over33: number;
  over50: number;
  loaf: number;
  loafBlockingMs: number;
  longTasks: number;
  longTaskMs: number;
  /** Main-thread time spent, from Chrome's own counters (CDP Performance.getMetrics). */
  taskMs: number;
  scriptMs: number;
  styleMs: number;
  layoutMs: number;
};

type Cdp = Awaited<ReturnType<ReturnType<Page["context"]>["newCDPSession"]>>;
const COUNTERS = ["TaskDuration", "ScriptDuration", "RecalcStyleDuration", "LayoutDuration"] as const;
const counters = async (cdp: Cdp) => {
  const { metrics } = (await cdp.send("Performance.getMetrics")) as { metrics: { name: string; value: number }[] };
  return Object.fromEntries(COUNTERS.map((name) => [name, metrics.find((m) => m.name === name)?.value ?? 0])) as Record<
    (typeof COUNTERS)[number],
    number
  >;
};

const measure = async (page: Page, cdp: Cdp, work: () => Promise<void>): Promise<Stats> => {
  const before = await counters(cdp);
  await page.evaluate(START);
  await work();
  // Let the last transition and any confirmation finish inside the window.
  await page.waitForTimeout(1200);
  const raw = (await page.evaluate(STOP)) as {
    frames: number[];
    long: { blocking: number }[];
    tasks: { duration: number }[];
  };
  const after = await counters(cdp);
  const spent = (name: (typeof COUNTERS)[number]) => Math.round((after[name] - before[name]) * 1000);
  const sorted = [...raw.frames].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    frames: sorted.length,
    p50: round(at(0.5)),
    p95: round(at(0.95)),
    max: round(sorted.at(-1) ?? 0),
    over33: sorted.filter((f) => f > 33.4).length,
    over50: sorted.filter((f) => f > 50).length,
    loaf: raw.long.length,
    loafBlockingMs: round(raw.long.reduce((sum, e) => sum + e.blocking, 0)),
    longTasks: raw.tasks.length,
    longTaskMs: round(raw.tasks.reduce((sum, e) => sum + e.duration, 0)),
    taskMs: spent("TaskDuration"),
    scriptMs: spent("ScriptDuration"),
    styleMs: spent("RecalcStyleDuration"),
    layoutMs: spent("LayoutDuration"),
  };
};

const browser = await chromium.launch();
const report: Record<string, Stats> = {};

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
  await linkPair(admin, D, { coachId: coach.$id, coachName: "Ruairi Deane", athleteId: athlete.$id, athleteName: "Joey Pang" });
  created.link = (await rowsOf("coach_athlete_links", "athlete_id", athlete.$id))[0]?.$id ?? "";
  const { ids, created: madeExercises } = await sampleExerciseIds(admin, D);
  created.exercises = madeExercises;

  // The sample block, with week 1 filled out to five days of six lines.
  const outline = sampleProgram(mondayOf(localDay()));
  outline.name = `Perf editor ${stamp}`;
  const week1 = outline.blocks[0].weeks[0];
  const extra: OutlineLine[] = [
    { exercise: "Leg Press", setCount: 3, reps: 10, load: "@7", restSeconds: 120 },
    { exercise: "Close Grip Bench Press", setCount: 3, reps: 8, load: "70%", restSeconds: 120 },
  ];
  for (const day of week1.days) day.lines.push(...extra);
  for (const n of [4, 5]) {
    week1.days.push({
      label: `Week 1 · Day ${n} — volume`,
      scheduledOn: week1.days[0].scheduledOn,
      lines: [...week1.days[n - 4].lines],
    });
  }
  const written = await writeOutline(opRunner(admin, D, coach.$id), athlete.$id, outline, ids);
  created.programId = written.programId;

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  const page = await ctx.newPage();
  await signIn(page, coach.email);
  await page.goto(`${BASE}/coach/programs/${created.programId}?view=week`);
  const day1 = page.getByRole("region", { name: week1.days[0].label });
  await day1.waitFor({ timeout: 30000 });
  // Let the maxes and logged-day reads land so they are not in the first scenario.
  await page.waitForTimeout(3000);
  await page.evaluate(PROBE);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Performance.enable");

  for (const rate of [1, 4]) {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate });
    const pass = rate === 1 ? 0 : 1;

    report[`typing ${rate}x`] = await measure(page, cdp, async () => {
      for (let row = 0; row < 3; row++) {
        await day1.getByLabel(`Sets, line ${row + 1}`, { exact: true }).click();
        for (const value of [`${3 + pass}`, `${5 + pass}`, `${70 + pass * 2.5}%`, `${150 + pass * 30}`]) {
          await page.keyboard.press("ControlOrMeta+a");
          await page.keyboard.type(value, { delay: 40 });
          await page.keyboard.press("Tab");
        }
      }
      await page.keyboard.press("Escape");
    });

    report[`views ${rate}x`] = await measure(page, cdp, async () => {
      for (let i = 0; i < 3; i++) {
        await page.getByRole("tab", { name: "Calendar" }).click();
        await page.getByRole("grid", { name: "Program calendar" }).waitFor({ timeout: 20000 });
        await page.getByRole("tab", { name: "Progression" }).click();
        await page.getByRole("table", { name: /progression$/ }).waitFor({ timeout: 20000 });
        await page.getByRole("tab", { name: "Week" }).click();
        await day1.waitFor({ timeout: 20000 });
      }
    });

    report[`typeahead ${rate}x`] = await measure(page, cdp, async () => {
      for (const day of week1.days.slice(0, 3)) {
        const field = page.getByRole("combobox", { name: `Add exercise to ${day.label}` });
        await field.scrollIntoViewIfNeeded();
        await field.click();
        for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowDown", { delay: 60 });
        await page.keyboard.type("sq", { delay: 60 });
        for (let i = 0; i < 2; i++) await page.keyboard.press("ArrowDown", { delay: 60 });
        await page.keyboard.press("Escape");
        await page.keyboard.press("ControlOrMeta+a");
        await page.keyboard.press("Backspace");
      }
      await page.keyboard.press("Tab");
    });
  }
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
} catch (error) {
  console.error("perf run threw:", error);
  process.exitCode = 1;
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
  if (created.link) await del("coach_athlete_links", created.link);
  for (const id of created.exercises) await del("exercises", id);
  for (const u of [athlete, coach]) {
    await del("profiles", u.$id);
    await teams.delete({ teamId: circleTeamId(u.$id) }).catch(() => {});
    await users.delete({ userId: u.$id }).catch(() => {});
  }
}

console.log(`\nProgram Editor frame timing (${LABEL}), 1440×900, ms`);
console.table(report);
console.log(JSON.stringify({ label: LABEL, report }));
