/**
 * Drives Lift Detail against the live instance.
 *
 *   npm run build && npm run start
 *   npm run e2e:lift
 *
 * The screen is almost entirely derived numbers -- a progression line, three
 * personal records, a headline change over a window -- and every one of them is
 * read from stats_rollups rather than computed here. So the thing worth driving
 * in a browser is that the rollups an athlete's training actually produces come
 * back out as the right numbers on the right screen.
 *
 * Sets are seeded through the admin key and the rollups built with the rebuild
 * script, which is also how a real backfill would arrive at them.
 */
import { execFileSync } from "node:child_process";
import { chromium, type Page } from "playwright";
import { ID, Query, TablesDB, Teams, Users } from "node-appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
import { circleTeamId } from "../appwrite/documents/circle";
import { sessionPermissions, setPermissions } from "../appwrite/documents/policy";
import { estimateOneRepMax } from "../lib/strength/e1rm";
import { weekStart } from "../lib/strength/rollup";

dedupeSdkWarnings();

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const config = serverAppwriteConfig();
const db = new TablesDB(createServerClient(config));
const users = new Users(createServerClient(config));
const teams = new Teams(createServerClient(config));
const D = config.databaseId;
const stamp = Date.now();

const results: boolean[] = [];
const check = (label: string, ok: boolean) => {
  results.push(ok);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
};

const rowsOf = async (table: "sets" | "sessions" | "stats_rollups", athleteId: string) =>
  (
    await db.listRows({
      databaseId: D, tableId: table,
      queries: [Query.equal("athlete_id", athleteId), Query.limit(50)], ttl: 0,
    })
  ).rows as unknown as Array<Record<string, unknown>>;

const deadliftId = await (async () => {
  const page = await db.listRows({
    databaseId: D, tableId: "exercises",
    queries: [Query.equal("is_global", true), Query.equal("name", "Deadlift"), Query.limit(1)], ttl: 0,
  });
  const row = page.rows[0];
  if (!row) throw new Error('No global exercise "Deadlift". Run npm run exercises:seed first.');
  return row.$id as string;
})();

const athlete = await users.create({
  userId: ID.unique(),
  email: `lift-${stamp}@example.com`,
  password: "Probe-pass-123!",
  name: "Joey Pang",
});

const WEEK = 7 * 24 * 60 * 60_000;
const thisMonday = weekStart(new Date()).getTime();

let n = 0;
/** One session of deadlifts, `weeksAgo` weeks back, on the Wednesday. */
const seedWeek = async (weeksAgo: number, sets: Array<{ l: number; r: number; rpe?: number; w?: boolean }>) => {
  const at = new Date(thisMonday - weeksAgo * WEEK + 2 * 24 * 60 * 60_000 + 10 * 60 * 60_000);
  const sessionId = `cs-l-${stamp}-${n++}`;
  const working = sets.filter((s) => !s.w);
  await db.createRow({
    databaseId: D, tableId: "sessions", rowId: sessionId,
    data: {
      athlete_id: athlete.$id, client_session_id: sessionId,
      started_at: at.toISOString(), finished_at: new Date(at.getTime() + 60 * 60_000).toISOString(),
      set_count: working.length,
      tonnage_kg: working.reduce((t, s) => t + s.l * s.r, 0),
    },
    permissions: sessionPermissions({ athleteId: athlete.$id }),
  });
  let i = 0;
  for (const s of sets) {
    const id = `st-l-${stamp}-${n}-${i++}`;
    await db.createRow({
      databaseId: D, tableId: "sets", rowId: id,
      data: {
        session_id: sessionId, athlete_id: athlete.$id, exercise_id: deadliftId,
        set_index: i, load_kg: s.l, reps: s.r, rpe: s.rpe, is_warmup: s.w ?? false,
        e1rm_kg: estimateOneRepMax({ loadKg: s.l, reps: s.r, rpe: s.rpe ?? null, isWarmup: s.w }) ?? undefined,
        logged_at: new Date(at.getTime() + i * 60_000).toISOString(),
        client_set_id: id,
      },
      permissions: setPermissions({ athleteId: athlete.$id }),
    });
  }
};

/*
 * Five weeks of deadlifting, arranged so no two records come from the same
 * week and none of them is simply the latest number:
 *
 *   16w  140 x 12 @ 8   rep record. Fourteen reps to failure, past the cutoff,
 *                       so it earns NO estimate -- which is the cutoff working.
 *    8w  200 x 1  @ 10  heaviest single. e1RM exactly 200, by definition.
 *    4w  180 x 3  @ 8   best estimated: 202.5
 *    2w  170 x 3  @ 7   197.4
 *    0w  175 x 3  @ 8   current: 196.9, deliberately below the best, so the
 *                       headline change is negative and "best" cannot be read
 *                       off the newest row.
 */
await seedWeek(16, [{ l: 140, r: 12, rpe: 8 }]);
await seedWeek(8, [{ l: 60, r: 5, w: true }, { l: 200, r: 1, rpe: 10 }]);
await seedWeek(4, [{ l: 180, r: 3, rpe: 8 }]);
await seedWeek(2, [{ l: 170, r: 3, rpe: 7 }]);
await seedWeek(0, [{ l: 175, r: 3, rpe: 8 }]);

console.log("\nBuilding the rollups");
execFileSync("npm", ["run", "rollups:rebuild", "--", "--yes"], { encoding: "utf8" });
const rollups = (await rowsOf("stats_rollups", athlete.$id)).filter((r) => r.exercise_id === deadliftId);
check("one rollup per week trained", rollups.length === 5);
const repWeek = rollups.find((r) => r.best_reps === 12);
check("the rep record is stored on its week", repWeek?.best_reps_load_kg === 140);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 852 }, colorScheme: "dark" });
const page: Page = await ctx.newPage();

await page.goto(`${BASE}/sign-in`);
await page.getByLabel("Email").fill(athlete.email);
await page.getByLabel("Password", { exact: true }).fill("Probe-pass-123!");
await page.getByRole("button", { name: "Sign in" }).click();
await page.waitForURL("**/today", { timeout: 20000 }).catch(() => {});

console.log("\nGetting there from History");
await page.goto(`${BASE}/history`);
await page.getByRole("link", { name: /1 set/ }).first().waitFor({ timeout: 15000 }).catch(() => {});
await page.getByRole("link", { name: /1 set/ }).first().click();
await page.getByRole("link", { name: "Deadlift progression" }).waitFor({ timeout: 15000 }).catch(() => {});
check("a session's lift links to its detail", await page.getByRole("link", { name: "Deadlift progression" }).isVisible());
await page.getByRole("link", { name: "Deadlift progression" }).click();
await page.waitForURL(`**/lift/${deadliftId}`, { timeout: 15000 }).catch(() => {});
check("which opens Lift Detail", page.url().includes(`/lift/${deadliftId}`));

console.log("\nThe headline");
await page.getByRole("heading", { name: "Deadlift" }).waitFor({ timeout: 15000 }).catch(() => {});
// By role, because the chart's own label also starts "Estimated 1RM".
const headline = page.getByRole("region", { name: "Estimated 1RM" });
// 175 x 3 @ RPE 8 is five reps to failure: 175 x 36 / 32 = 196.9.
check("shows the current estimate", (await headline.innerText()).includes("196.9 kg"));
// Down from 200 eight weeks ago. A screen that only ever showed a plus sign
// would pass a test built on a rising line.
check("and how far it has moved, including downward", (await headline.innerText()).includes("−3.1"));

console.log("\nThe chart");
check("draws one line", (await page.getByRole("img").count()) === 1);
check(
  "named for a screen reader, which cannot read a polyline",
  ((await page.getByRole("img").getAttribute("aria-label")) ?? "").includes("Deadlift"),
);
check("offers the four ranges", (await page.getByRole("group", { name: "Chart range" }).getByRole("button").count()) === 4);

await page.getByRole("button", { name: "8w" }).click();
check("switching range re-labels the change", (await headline.innerText()).includes("(8w)"));

console.log("\nPersonal records");
const records = page.getByRole("region", { name: "Personal records" });
const text = (await records.innerText()).replace(/\s+/g, " ");
// Each of these is from a different week, so none of them can be an accident
// of reading one row.
check("heaviest single, all-time", text.includes("200 × 1"));
// 202.5, from four weeks ago -- not the newest week and not the heaviest
// single, so it cannot be read off either.
check("best estimated, all-time", text.includes("202.5 kg"));
check("most reps, with the weight it was done at", text.includes("140 × 12"));
check(
  "records stay all-time after narrowing the range to 8 weeks",
  text.includes("140 × 12"),
);

console.log("\nRecent sets");
const recent = page.getByRole("region", { name: "Recent sets" });
const recentText = (await recent.innerText()).replace(/\s+/g, " ");
check("lists the sets as they were logged", recentText.includes("180 × 3"));
check("with their RPE", recentText.includes("RPE 8"));
// The 8-weeks-ago session warmed up with 60 x 5. It is not in this list,
// because warm-ups count toward nothing anywhere in the product.
check("and leaves warm-ups out, as every other total does", !recentText.includes("60 × 5"));

// --- teardown ---------------------------------------------------------
await browser.close();
for (const table of ["sets", "sessions", "stats_rollups"] as const) {
  for (const row of await rowsOf(table, athlete.$id)) {
    await db.deleteRow({ databaseId: D, tableId: table, rowId: String(row.$id) });
  }
}
await teams.delete({ teamId: circleTeamId(athlete.$id) }).catch(() => {});
await users.delete({ userId: athlete.$id });

const failed = results.filter((ok) => !ok).length;
console.log(
  failed === 0
    ? `\n${results.length}/${results.length} passed. Athlete, sets and rollups removed.`
    : `\n${failed} of ${results.length} FAILED.`,
);
process.exitCode = failed === 0 ? 0 : 1;
