/**
 * Drives History against the live instance.
 *
 *   npm run build && npm run start
 *   npm run e2e:history
 *
 * Two things worth a browser. Reading: does a week of training show up grouped,
 * searchable and with the totals the finish screen showed. And editing, which
 * is the part with teeth -- a correction has to rewrite the set, recompute its
 * e1RM, and put the week's rollup right. Getting any one of those wrong leaves
 * a number that looks correct and is not.
 *
 * Sessions are seeded through the admin key rather than logged through the UI:
 * e2e:session already covers logging, and this needs several sessions across
 * two weeks, which would take minutes to tap out.
 */
import { chromium, type Page } from "playwright";
import { ID, Query, TablesDB, Teams, Users } from "node-appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
import { circleTeamId } from "../appwrite/documents/circle";
import { sessionPermissions, setPermissions } from "../appwrite/documents/policy";
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

const until = async (ok: () => Promise<boolean>, ms = 20000) => {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await ok()) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 500));
  }
};

const rowsOf = async (table: "sets" | "sessions" | "stats_rollups", athleteId: string) =>
  (
    await db.listRows({
      databaseId: D,
      tableId: table,
      queries: [Query.equal("athlete_id", athleteId), Query.limit(50)],
      ttl: 0,
    })
  ).rows as unknown as Array<Record<string, unknown>>;

/** A real library row, so the cards show a name rather than an id. */
const globalExercise = async (name: string) => {
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

const squatId = await globalExercise("Squat");
const benchId = await globalExercise("Bench Press");

const athlete = await users.create({
  userId: ID.unique(),
  email: `history-${stamp}@example.com`,
  password: "Probe-pass-123!",
  name: "Joey Pang",
});

let n = 0;
const seedSession = async (startedAt: Date, minutes: number, sets: Array<{ exerciseId: string; loadKg: number; reps: number; rpe?: number; isWarmup?: boolean; e1rm?: number }>) => {
  const sessionId = `cs-h-${stamp}-${n++}`;
  const working = sets.filter((s) => !s.isWarmup);
  await db.createRow({
    databaseId: D, tableId: "sessions", rowId: sessionId,
    data: {
      athlete_id: athlete.$id, client_session_id: sessionId,
      started_at: startedAt.toISOString(),
      finished_at: new Date(startedAt.getTime() + minutes * 60_000).toISOString(),
      set_count: working.length,
      tonnage_kg: working.reduce((sum, s) => sum + s.loadKg * s.reps, 0),
    },
    permissions: sessionPermissions({ athleteId: athlete.$id }),
  });
  let index = 0;
  for (const set of sets) {
    const setId = `st-h-${stamp}-${n}-${index++}`;
    await db.createRow({
      databaseId: D, tableId: "sets", rowId: setId,
      data: {
        session_id: sessionId, athlete_id: athlete.$id, exercise_id: set.exerciseId,
        set_index: index, load_kg: set.loadKg, reps: set.reps, rpe: set.rpe,
        is_warmup: set.isWarmup ?? false, e1rm_kg: set.e1rm,
        logged_at: new Date(startedAt.getTime() + index * 60_000).toISOString(),
        client_set_id: setId,
      },
      permissions: setPermissions({ athleteId: athlete.$id }),
    });
  }
  return sessionId;
};

// This week: a squat session with a warm-up and two working sets.
const thisWeek = new Date(Date.now() - 2 * 60 * 60_000);
const squatSession = await seedSession(thisWeek, 72, [
  { exerciseId: squatId, loadKg: 60, reps: 5, isWarmup: true },
  { exerciseId: squatId, loadKg: 140, reps: 5, rpe: 8, e1rm: 168 },
  { exerciseId: squatId, loadKg: 140, reps: 5 },
]);
// Last week: bench, so search has something to exclude. Placed on the
// Wednesday of the previous week rather than "eight days ago", which lands in
// the week before last whenever today is early in the week.
const lastWeekWednesday = new Date(weekStart(new Date()).getTime() - 5 * 24 * 60 * 60_000);
await seedSession(lastWeekWednesday, 58, [
  { exerciseId: benchId, loadKg: 100, reps: 5, rpe: 8, e1rm: 120 },
]);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 852 }, colorScheme: "dark" });
const page: Page = await ctx.newPage();

await page.goto(`${BASE}/sign-in`);
await page.getByLabel("Email").fill(athlete.email);
await page.getByLabel("Password", { exact: true }).fill("Probe-pass-123!");
await page.getByRole("button", { name: "Sign in" }).click();
await page.waitForURL("**/today", { timeout: 20000 }).catch(() => {});

console.log("\nThe list");
await page.goto(`${BASE}/history`);
await page.getByRole("region", { name: "This week" }).waitFor({ timeout: 15000 }).catch(() => {});
check("groups sessions by the week they were done", await page.getByRole("region", { name: "This week" }).isVisible());
check("and names the one before it", await page.getByRole("region", { name: "Last week" }).isVisible());

const squatCard = page.getByRole("link", { name: /2 sets/ }).first();
check("a card says what the session was", (await squatCard.innerText()).includes("Squat"));
check("with the totals the finish screen showed", (await squatCard.innerText()).includes("1,400 kg"));
check("and how long it took", /1h 12m/.test(await squatCard.innerText()));

console.log("\nSearch");
await page.getByRole("searchbox", { name: "Search by exercise" }).fill("bench");
// Session cards only. A bare getByRole("link") also counts the four tab-bar
// links, which is how this assertion was wrong the first time.
const cards = page.getByRole("link", { name: /\d+ sets?$/ });
// Filtering is a render away, not a round trip, but asserting on a count the
// instant after typing is still a race.
await until(async () => (await cards.count()) === 1, 5000);
check("finds the sessions with that lift", (await cards.count()) === 1);
check("and hides the rest", (await page.getByText("Squat").count()) === 0);
await page.getByRole("searchbox").fill("curl");
await until(async () => (await page.getByRole("status").count()) > 0, 5000);
check("says nothing matched rather than showing a blank page", await page.getByRole("status").isVisible());
await page.getByRole("searchbox").fill("");

console.log("\nOpening a session");
await page.getByRole("link", { name: /2 sets/ }).first().click();
await page.waitForURL(`**/history/${squatSession}`, { timeout: 15000 }).catch(() => {});
check("opens that session", page.url().endsWith(squatSession));
await page.getByRole("group", { name: "Set 1" }).waitFor({ timeout: 15000 }).catch(() => {});
check("shows the warm-up as W", await page.getByRole("group", { name: "Warm-up set" }).isVisible());
check("and both working sets, numbered", await page.getByRole("group", { name: "Set 2" }).isVisible());

console.log("\nCorrecting a set");
await page.getByRole("button", { name: "Edit set 1 of Squat" }).click();
for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Backspace" }).click();
for (const key of ["1", "4", "5"]) await page.getByRole("button", { name: key, exact: true }).click();
await page.getByRole("button", { name: "Log Set 1" }).click();
check("the correction shows straight away", /145/.test(await page.getByRole("group", { name: "Set 1" }).innerText()));

await until(async () => (await rowsOf("sets", athlete.$id)).some((r) => r.load_kg === 145));
const sets = await rowsOf("sets", athlete.$id);
const corrected = sets.find((r) => r.load_kg === 145);
check("the set is rewritten at Appwrite", corrected != null);
// 145 x 5 @ RPE 8 is seven reps to failure: 145 x 36 / 30. The stale 168 would
// have survived a partial update, which is the gap Order 11 left open.
check("and its e1RM is recomputed, not left stale", corrected?.e1rm_kg === 174);

await until(async () => (await rowsOf("stats_rollups", athlete.$id)).some((r) => r.tonnage_kg === 1425));
const rollup = (await rowsOf("stats_rollups", athlete.$id)).find((r) => r.exercise_id === squatId);
check("the week's tonnage follows the correction", rollup?.tonnage_kg === 1425);
check("and so does its best e1RM", rollup?.best_e1rm_kg === 174);

console.log("\nDeleting a set");
await page.getByRole("button", { name: "Edit set 2 of Squat" }).click();
await page.getByRole("button", { name: "Delete set" }).click();
check("it goes from the screen", (await page.getByRole("group", { name: "Set 2" }).count()) === 0);

await until(async () => (await rowsOf("sets", athlete.$id)).length === 3);
check("and from Appwrite", (await rowsOf("sets", athlete.$id)).length === 3);
await until(async () => {
  const r = (await rowsOf("stats_rollups", athlete.$id)).find((x) => x.exercise_id === squatId);
  return r?.set_count === 1;
});
const after = (await rowsOf("stats_rollups", athlete.$id)).find((r) => r.exercise_id === squatId);
check("the rollup drops the deleted set", after?.set_count === 1 && after?.tonnage_kg === 725);

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
    ? `\n${results.length}/${results.length} passed. Athlete and sessions removed.`
    : `\n${failed} of ${results.length} FAILED.`,
);
process.exitCode = failed === 0 ? 0 : 1;
