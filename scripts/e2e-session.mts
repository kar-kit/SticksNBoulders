/**
 * Drives the session lifecycle against the live instance.
 *
 *   npm run build && npm run start    # port 3100
 *   npm run e2e:session
 *
 * Start, resume across a reload, finish. The reload is the part worth driving
 * in a browser: "resume exactly where they left off" is a claim about state
 * that survives the page being thrown away, and no unit test can make it.
 *
 * Creates a throwaway athlete and removes them, along with anything they
 * logged. Point it at dev.
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

const results: boolean[] = [];
const check = (label: string, ok: boolean) => {
  results.push(ok);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
};

const sessionsOf = async (athleteId: string) =>
  (
    await adminDb.listRows({
      databaseId: db,
      tableId: "sessions",
      queries: [Query.equal("athlete_id", athleteId), Query.limit(25)],
      ttl: 0,
    })
  ).rows;

const signIn = async (page: Page, email: string) => {
  await page.goto(`${BASE}/sign-in`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("Probe-pass-123!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/today", { timeout: 20000 }).catch(() => {});
};

const athlete = await users.create({
  userId: ID.unique(),
  email: `session-${stamp}@example.com`,
  password: "Probe-pass-123!",
  name: "Joey Pang",
});

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 852 }, colorScheme: "dark" });
const page = await ctx.newPage();

console.log("\nAn empty account");
await signIn(page, athlete.email);
check("lands on Today", page.url().endsWith("/today"));
await page.getByText("No sessions logged yet.").waitFor({ timeout: 15000 }).catch(() => {});
check("says no sessions have been logged", await page.getByText("No sessions logged yet.").isVisible());
check("offers to start one", await page.getByRole("button", { name: "Start a session" }).isVisible());

console.log("\nStarting a session");
await page.getByRole("button", { name: "Start a session" }).click();
await page.waitForURL("**/log", { timeout: 20000 }).catch(() => {});
check("goes to the logger", page.url().endsWith("/log"));
await page.getByRole("button", { name: "Finish session" }).waitFor({ timeout: 15000 }).catch(() => {});
check("a clock is running", /\d:\d\d:\d\d/.test(await page.getByRole("button", { name: "Finish session" }).innerText()));

const afterStart = await sessionsOf(athlete.$id);
check("exactly one session row exists", afterStart.length === 1);
check("and it is live, with no finished_at", afterStart[0]?.finished_at == null);

console.log("\nAdding an exercise by typing");
await page.getByRole("combobox").fill("squat");
await page.getByRole("option", { name: "Squat", exact: true }).first().click();
check("the exercise appears in the session", await page.getByText("No sets yet").isVisible());

console.log("\nAfter throwing the page away");
await page.reload();
await page.getByRole("button", { name: "Finish session" }).waitFor({ timeout: 15000 }).catch(() => {});
check("the session is still running", await page.getByRole("button", { name: "Finish session" }).isVisible());
check("no second session was created", (await sessionsOf(athlete.$id)).length === 1);

await page.goto(`${BASE}/today`);
await page.getByRole("button", { name: "Resume session" }).waitFor({ timeout: 15000 }).catch(() => {});
check("Today offers Resume rather than Start", await page.getByRole("button", { name: "Resume session" }).isVisible());
await page.getByRole("button", { name: "Resume session" }).click();
await page.waitForURL("**/log", { timeout: 20000 }).catch(() => {});
check("Resume reopens the logger", page.url().endsWith("/log"));

console.log("\nFinishing");
await page.getByRole("button", { name: "Finish session" }).click();
await page.getByRole("button", { name: "Finish", exact: true }).click();
await page.getByText("Session done").waitFor({ timeout: 15000 }).catch(() => {});
check("shows a summary", await page.getByText("Session done").isVisible());

const afterFinish = await sessionsOf(athlete.$id);
check("finished_at is written", afterFinish[0]?.finished_at != null);
check("still exactly one session", afterFinish.length === 1);

await page.getByRole("button", { name: "Back to Today" }).click();
await page.waitForURL("**/today", { timeout: 20000 }).catch(() => {});
await page.getByRole("button", { name: "Start a session" }).waitFor({ timeout: 15000 }).catch(() => {});
check("Today offers Start again", await page.getByRole("button", { name: "Start a session" }).isVisible());
check("and names the session just finished", await page.getByText(/Last session:/).isVisible());

// --- teardown ---------------------------------------------------------
await browser.close();
for (const row of await sessionsOf(athlete.$id)) {
  await adminDb.deleteRow({ databaseId: db, tableId: "sessions", rowId: row.$id });
}
// The app created this on the athlete's first write, so the run has to take it
// away again -- otherwise every e2e leaves a team behind on the instance.
await teams.delete({ teamId: circleTeamId(athlete.$id) }).catch(() => {});
await users.delete({ userId: athlete.$id });

const failed = results.filter((ok) => !ok).length;
console.log(
  failed === 0
    ? `\n${results.length}/${results.length} passed. Athlete and sessions removed.`
    : `\n${failed} of ${results.length} FAILED.`,
);
process.exitCode = failed === 0 ? 0 : 1;
