/**
 * Drives logging with no signal, against the live instance.
 *
 *   npm run build && npm run start    # port 3100
 *   npm run e2e:offline
 *
 * The claim this script exists to test is the one the feature list calls
 * unforgivable to get wrong: a set logged in a basement reaches the coach.
 * Nothing short of a browser can test it, because the evidence is what survives
 * the page being thrown away while the network is gone.
 *
 * Appwrite is cut off rather than the whole context, because that is the real
 * failure: the app shell is already on the phone, and it is the gym's wifi --
 * associated, routing nowhere -- that is not working. Killing every request
 * would only test that a page which cannot load does not log sets.
 *
 * Creates a throwaway athlete and removes them and their work. Point it at dev.
 */
import { chromium, type Page } from "playwright";
import { ID, Query, TablesDB, Teams, Users } from "node-appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
import { circleTeamId } from "../appwrite/documents/circle";

dedupeSdkWarnings();

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const config = serverAppwriteConfig();
const admin = createServerClient(config);
const adminDb = new TablesDB(admin);
const users = new Users(admin);
const teams = new Teams(admin);
const db = config.databaseId;
const stamp = Date.now();
const appwriteHost = new URL(config.endpoint).host;

const results: boolean[] = [];
const check = (label: string, ok: boolean) => {
  results.push(ok);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
};

const rowsOf = async (table: "sets" | "sessions", athleteId: string) =>
  (
    await adminDb.listRows({
      databaseId: db,
      tableId: table,
      queries: [Query.equal("athlete_id", athleteId), Query.limit(50)],
      // Never a cached read: this script's whole job is to know exactly what
      // has and has not reached the server at a given moment.
      ttl: 0,
    })
  ).rows;

/**
 * Cuts the phone off from Appwrite, leaving the app itself working.
 *
 * `/api/circle` goes too. It is same-origin, but it reaches Appwrite on the
 * server, so a phone with no signal cannot use it either.
 */
const goOffline = (page: Page) =>
  page.route("**/*", (route) => {
    const url = route.request().url();
    const offline = url.includes(appwriteHost) || url.includes("/api/circle");
    return offline ? route.abort("internetdisconnected") : route.continue();
  });

const goOnline = (page: Page) => page.unroute("**/*");

const signIn = async (page: Page, email: string) => {
  await page.goto(`${BASE}/sign-in`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("Probe-pass-123!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/today", { timeout: 20000 }).catch(() => {});
};

const pad = async (page: Page, digits: string) => {
  for (const key of digits) {
    await page.getByRole("button", { name: key === "." ? "Decimal point" : key, exact: true }).click();
  }
};
const enter = async (page: Page, kg: string, reps: string) => {
  await page.getByRole("button", { name: /weight in kilograms/ }).click();
  await pad(page, kg);
  await page.getByRole("button", { name: "Reps", exact: true }).click();
  await pad(page, reps);
};

const athlete = await users.create({
  userId: ID.unique(),
  email: `offline-${stamp}@example.com`,
  password: "Probe-pass-123!",
  name: "Joey Pang",
});

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 852 }, colorScheme: "dark" });
const page = await ctx.newPage();

console.log("\nSigning in with signal, then losing it");
await signIn(page, athlete.email);
check("signed in", page.url().endsWith("/today"));
// The library is fetched here, with signal, exactly as it would be at the gym
// door. Typeahead against an empty library is a different ticket's problem.
await page.waitForTimeout(1500);
await goOffline(page);

console.log("\nStarting a session in a basement");
await page.goto(`${BASE}/log`);
await page.getByRole("button", { name: "Start a session" }).click();
await page.getByRole("button", { name: "Finish session" }).waitFor({ timeout: 15000 }).catch(() => {});
check("the session starts anyway", await page.getByRole("button", { name: "Finish session" }).isVisible());
check("and nothing reached Appwrite", (await rowsOf("sessions", athlete.$id)).length === 0);

console.log("\nLogging into it");
await page.getByRole("combobox").fill("squat");
await page.getByRole("option", { name: "Squat", exact: true }).first().click();
await page.getByRole("group", { name: "Set 1" }).waitFor({ timeout: 10000 }).catch(() => {});

await enter(page, "60", "5");
await page.getByRole("switch", { name: "Warm-up" }).click();
await page.getByRole("button", { name: "Log Warm-up set" }).click();
await page.getByRole("group", { name: "Warm-up set" }).waitFor({ timeout: 10000 }).catch(() => {});

await enter(page, "140", "5");
await page.getByRole("button", { name: "Set 1 RPE" }).click();
await page.getByRole("button", { name: "8", exact: true }).click();
await page.getByRole("button", { name: "Log Set 1" }).click();
await page.getByRole("group", { name: "Set 2" }).waitFor({ timeout: 10000 }).catch(() => {});
await page.getByRole("button", { name: "Log Set 2" }).click();
await page.waitForTimeout(1000);

check("all three sets show as logged", (await page.getByRole("group", { name: /Set|Warm-up set/ }).count()) >= 3);
check("each carries a queued mark", (await page.getByLabel("Queued, will sync").count()) >= 3);
check("nothing reads as an error", (await page.getByText(/could not be saved/).count()) === 0);
check("and still nothing reached Appwrite", (await rowsOf("sets", athlete.$id)).length === 0);

console.log("\nThrowing the page away, still with no signal");
// The claim IndexedDB is here to make. Everything in memory is gone; if the
// sets come back, they came back off the disk.
await page.reload();
await page.getByRole("button", { name: "Finish session" }).waitFor({ timeout: 15000 }).catch(() => {});
check("the session is still running", await page.getByRole("button", { name: "Finish session" }).isVisible());
check("the warm-up survived the reload", await page.getByRole("group", { name: "Warm-up set" }).isVisible());
check("and both working sets", await page.getByRole("group", { name: "Set 2" }).isVisible());
check("still queued, still nothing sent", (await rowsOf("sets", athlete.$id)).length === 0);

console.log("\nWalking back out into the signal");
await goOnline(page);
// Nothing is tapped. The queue notices on its own, which is the point: an
// athlete should never have to know there was anything to notice.
await page.waitForTimeout(8000);

const sessions = await rowsOf("sessions", athlete.$id);
const sets = await rowsOf("sets", athlete.$id);
check("exactly one session landed", sessions.length === 1);
check("exactly three sets landed, not six", sets.length === 3);
check("the warm-up kept its flag", sets.filter((r) => r.is_warmup === true).length === 1);
check("the RPE came with it", sets.some((r) => r.rpe === 8));
check("the loads are the ones that were typed", sets.filter((r) => r.load_kg === 140).length === 2);
check(
  "every set points at the session that was started offline",
  sets.every((r) => r.session_id === sessions[0]?.$id),
);
check(
  "the row id is the client id, so a replay cannot write a twin",
  sets.every((r) => r.$id === r.client_set_id),
);
check("no duplicate client ids", new Set(sets.map((r) => r.client_set_id)).size === 3);

await page.waitForTimeout(1500);
check("the queued marks are gone once it syncs", (await page.getByLabel("Queued, will sync").count()) === 0);
// The bug this line exists to catch: a list derived from the queue empties the
// screen at the exact moment the sets succeed.
check("and the sets are still on the screen", await page.getByRole("group", { name: "Set 2" }).isVisible());

console.log("\nFinishing, back on signal");
await page.getByRole("button", { name: "Finish session" }).click();
await page.getByRole("button", { name: "Finish", exact: true }).click();
await page.getByText("Session done").waitFor({ timeout: 15000 }).catch(() => {});
await page.waitForTimeout(2000);
const finished = await rowsOf("sessions", athlete.$id);
check("the session closes", finished[0]?.finished_at != null);
check("set_count counts working sets only", finished[0]?.set_count === 2);
check("tonnage excludes the warm-up", finished[0]?.tonnage_kg === 1400);

// --- teardown ---------------------------------------------------------
await browser.close();
for (const row of await rowsOf("sets", athlete.$id)) {
  await adminDb.deleteRow({ databaseId: db, tableId: "sets", rowId: row.$id });
}
for (const row of await rowsOf("sessions", athlete.$id)) {
  await adminDb.deleteRow({ databaseId: db, tableId: "sessions", rowId: row.$id });
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
