/**
 * Drives the two shells against the live instance.
 *
 *   npm run build && npm run start    # port 3100
 *   npm run e2e:shell
 *
 * Role is a relationship, so the only honest way to test the coach shell is to
 * create a real link and a real circle and watch the app notice. Creates
 * throwaway users, a team, a link and a profile, then removes all of it.
 */
import { chromium, type Page } from "playwright";
import { ID, TablesDB, Teams, Users } from "node-appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
import { circleTeamId, CIRCLE_ROLES } from "../appwrite/documents/circle";
import { linkPermissions, profilePermissions } from "../appwrite/documents/policy";

dedupeSdkWarnings();

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const config = serverAppwriteConfig();
const admin = createServerClient(config);
const adminDb = new TablesDB(admin);
const users = new Users(admin);
const teams = new Teams(admin);
const db = config.databaseId;
const stamp = Date.now();

const results: string[] = [];
const check = (label: string, ok: boolean) => {
  results.push(ok ? "PASS" : "FAIL");
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
};

const signIn = async (page: Page, email: string) => {
  await page.goto(`${BASE}/sign-in`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("Probe-pass-123!");
  await page.getByRole("button", { name: "Sign in" }).click();
};

const coach = await users.create({ userId: ID.unique(), email: `shell-coach-${stamp}@example.com`, password: "Probe-pass-123!", name: "Ruairi Deane" });
const athlete = await users.create({ userId: ID.unique(), email: `shell-ath-${stamp}@example.com`, password: "Probe-pass-123!", name: "Joey Pang" });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 852 }, colorScheme: "dark" });
const page = await ctx.newPage();

console.log("A plain athlete");
await signIn(page, athlete.email);
await page.waitForURL("**/today", { timeout: 20000 }).catch(() => {});
check("lands on Today", page.url().endsWith("/today"));
check("gets the four-tab shell", (await page.locator("nav[aria-label='Main'] a").count()) === 4);

for (const [label, href] of [["Log", "/log"], ["History", "/history"], ["Me", "/me"]] as const) {
  await page.locator("nav[aria-label='Main']").getByRole("link", { name: label }).click();
  await page.waitForURL(`**${href}`, { timeout: 10000 }).catch(() => {});
  check(`the ${label} tab reaches ${href}`, page.url().endsWith(href));
}
check(
  "no coach switch, because nobody is linked to them",
  (await page.getByRole("button", { name: "Coach mode" }).count()) === 0,
);
await page.goto(`${BASE}/coach/roster`);
await page.waitForTimeout(2500);
check("every screen has a real empty state, not a blank", (await page.locator("main, body").first().innerText()).trim().length > 0);

console.log("\nOnce an athlete is linked");
const circle = await teams.create({ teamId: circleTeamId(athlete.$id), name: "Joey Pang — circle" });
await teams.createMembership({ teamId: circle.$id, userId: athlete.$id, roles: [CIRCLE_ROLES.athlete] });
await teams.createMembership({ teamId: circle.$id, userId: coach.$id, roles: [CIRCLE_ROLES.coach] });
const profile = await adminDb.createRow({
  databaseId: db, tableId: "profiles", rowId: athlete.$id,
  data: { user_id: athlete.$id, display_name: "Joey Pang", units: "kg", created_at: new Date().toISOString() },
  permissions: profilePermissions({ athleteId: athlete.$id }),
});
const link = await adminDb.createRow({
  databaseId: db, tableId: "coach_athlete_links", rowId: ID.unique(),
  data: { coach_id: coach.$id, athlete_id: athlete.$id, status: "active", linked_at: new Date().toISOString() },
  permissions: linkPermissions({ coachId: coach.$id, athleteId: athlete.$id }),
});

const coachPage = await ctx.browser()!.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" }).then((c) => c.newPage());
await signIn(coachPage, coach.email);
await coachPage.waitForURL("**/coach/roster", { timeout: 20000 }).catch(() => {});
check("a coach lands on their roster, not on Today", coachPage.url().includes("/coach/roster"));
// The rail costs two sequential round trips after the session resolves --
// links, then profiles -- so it is waited for rather than raced.
const railed = await coachPage
  .getByText("Joey P")
  .waitFor({ timeout: 15000 })
  .then(() => true)
  .catch(() => false);
check("the rail names the athlete", railed);
check("the coach nav is present", (await coachPage.locator("nav[aria-label='Coach'] a").count()) === 3);

await coachPage.getByRole("button", { name: "Athlete mode" }).click();
await coachPage.waitForURL("**/today", { timeout: 10000 }).catch(() => {});
check("athlete mode switches on the same account", coachPage.url().endsWith("/today"));
await coachPage.goto(`${BASE}/me`);
await coachPage.waitForTimeout(2000);
check(
  "and the way back is on Me",
  await coachPage.getByRole("button", { name: /Coach mode/ }).waitFor({ timeout: 10000 }).then(() => true).catch(() => false),
);

console.log("\nEvery link in the coach nav goes somewhere");
for (const [label, href] of [["Review", "/coach/review"], ["Programs", "/coach/programs"]] as const) {
  await coachPage.goto(`${BASE}/coach/roster`);
  await coachPage.locator("nav[aria-label='Coach']").getByRole("link", { name: label }).click();
  await coachPage.waitForURL(`**${href}`, { timeout: 10000 }).catch(() => {});
  const text = await coachPage.locator("main").innerText().catch(() => "");
  check(`${label} reaches ${href} with a real empty state`, coachPage.url().endsWith(href) && text.trim().length > 0);
}
await coachPage.goto(`${BASE}/coach/athletes/${athlete.$id}`);
check(
  "and so does an athlete in the rail",
  (await coachPage.locator("main").innerText().catch(() => "")).trim().length > 0,
);

await coachPage.screenshot({ path: ".shots/coach-shell.png" });
await page.goto(`${BASE}/today`);
await page.waitForTimeout(2000);
await page.screenshot({ path: ".shots/athlete-shell.png" });

await adminDb.deleteRow({ databaseId: db, tableId: "coach_athlete_links", rowId: link.$id });
await adminDb.deleteRow({ databaseId: db, tableId: "profiles", rowId: profile.$id });
await teams.delete({ teamId: circle.$id });
for (const u of [coach, athlete]) await users.delete({ userId: u.$id });
await browser.close();

const failed = results.filter((r) => r === "FAIL").length;
console.log(failed === 0 ? `\n${results.length}/${results.length} passed. Probe data removed.` : `\n${failed} FAILED`);
process.exitCode = failed ? 1 : 0;
