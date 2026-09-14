/**
 * Drives invite code generation against the live instance.
 *
 *   npm run build && npx next start -p 3120
 *   E2E_BASE_URL=http://localhost:3120 npm run e2e:invite
 *
 * The unit tests prove the code's shape and the probe proves Appwrite honours
 * the permissions. What is left, and what only a browser can show, is the
 * round trip: a coach with an empty account taps a button, a server-only table
 * gains a row it minted, and the same code is still there on the next load.
 *
 * Worth driving in particular because the write is the one thing the browser
 * is not allowed to do itself -- so a broken route looks, from the client,
 * exactly like a coach who has no code.
 */
import { chromium, type Page } from "playwright";
import { ID, Query, TablesDB, Teams, Users } from "node-appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
import { circleTeamId } from "../appwrite/documents/circle";
import { normaliseInviteCode } from "../lib/coach/invite-code";

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

const codesFor = async (coachId: string) =>
  (
    await db.listRows({
      databaseId: D, tableId: "invite_codes",
      queries: [Query.equal("coach_id", coachId), Query.limit(10)], ttl: 0,
    })
  ).rows as unknown as Array<Record<string, unknown>>;

const mkUser = (tag: string, name: string) =>
  users.create({
    userId: ID.unique(),
    email: `invite-${tag}-${stamp}@example.com`,
    password: "Probe-pass-123!",
    name,
  });

const coach = await mkUser("coach", "Ruairi Deane");
const other = await mkUser("other", "Sam Tierney");

const signIn = async (page: Page, email: string) => {
  await page.goto(`${BASE}/sign-in`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("Probe-pass-123!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/today", { timeout: 20000 }).catch(() => {});
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 852 }, colorScheme: "dark" });
// Granted up front: headless Chromium denies the clipboard by default, and the
// component treats a refusal as a lost convenience rather than an error, which
// would make a genuine failure here invisible.
await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
const page: Page = await ctx.newPage();

await signIn(page, coach.email);

console.log("\nA coach with an empty account");
await page.goto(`${BASE}/me`);
const invite = page.getByRole("button", { name: "Invite an athlete" });
await invite.waitFor({ timeout: 15000 }).catch(() => {});
// Ruairi's very first session. No athletes, so isCoach is false -- and if this
// were gated on it, he could never get his first one.
check("is offered a code before anybody is linked to them", await invite.isVisible());
check("and has none yet", (await codesFor(coach.$id)).length === 0);

console.log("\nGetting one");
await invite.click();
await page.getByRole("button", { name: "Copy" }).waitFor({ timeout: 15000 }).catch(() => {});
const codeText = page.getByText(/^SNB-[A-Z0-9]{5}$/);
const shown = (await codeText.first().innerText()).trim();
check("shows a code", /^SNB-[A-Z0-9]{5}$/.test(shown));
check("in the shape an athlete can be told to type", normaliseInviteCode(shown) === shown);

const stored = await codesFor(coach.$id);
check("stored exactly one", stored.length === 1);
check("as the row id, so redeeming it is a point read", String(stored[0]?.$id) === shown);
check("against the coach who asked", String(stored[0]?.coach_id) === coach.$id);

console.log("\nCopying it");
await page.getByRole("button", { name: "Copy" }).click();
await page.getByRole("button", { name: "Copied" }).waitFor({ timeout: 5000 }).catch(() => {});
check("says it copied", await page.getByRole("button", { name: "Copied" }).isVisible());
const clipboard = await page.evaluate(() => navigator.clipboard.readText());
check("and actually put the code on the clipboard", clipboard.trim() === shown);

console.log("\nComing back to it");
await page.reload();
await page.getByRole("button", { name: "Copy" }).waitFor({ timeout: 15000 }).catch(() => {});
check(
  "the same code is still there, read straight from Appwrite",
  (await codeText.first().innerText()).trim() === shown,
);

await page.goto(`${BASE}/coach/roster`);
await page.getByRole("button", { name: "Copy" }).waitFor({ timeout: 15000 }).catch(() => {});
check(
  "and on the Roster, where the empty state asks for it",
  (await codeText.first().innerText()).trim() === shown,
);

console.log("\nAsking twice");
// A coach who taps again, or whose first request died on gym wifi, must not
// end up with a second code that makes the one they already texted somebody
// look wrong. Driven through the route itself rather than the button, because
// the button stops offering once a code is on screen. The JWT is minted with
// the admin key rather than scraped out of the browser, which keeps this a
// test of the route rather than of Appwrite's cookie policy.
const { jwt } = await users.createJWT({ userId: coach.$id });
const second = (await (
  await fetch(`${BASE}/api/invite`, { method: "POST", headers: { authorization: `Bearer ${jwt}` } })
).json()) as { code?: string; created?: boolean };
check("a second request returns the same code", second.code === shown);
check("and says it created nothing", second.created === false);
check("so still exactly one code exists", (await codesFor(coach.$id)).length === 1);

console.log("\nSomebody else's code");
// Its own context. Sharing one would share the Appwrite session cookie, and
// the second sign-in would quietly land back on the first account's screens.
const otherCtx = await browser.newContext({ viewport: { width: 390, height: 852 } });
const otherPage = await otherCtx.newPage();
await signIn(otherPage, other.email);
await otherPage.goto(`${BASE}/me`);
await otherPage.getByRole("button", { name: "Invite an athlete" }).waitFor({ timeout: 15000 }).catch(() => {});
check(
  "a second account sees no code of its own",
  await otherPage.getByRole("button", { name: "Invite an athlete" }).isVisible(),
);
check("and cannot see the coach's", !(await otherPage.getByText(shown).isVisible()));

await otherPage.getByRole("button", { name: "Invite an athlete" }).click();
await otherPage.getByRole("button", { name: "Copy" }).waitFor({ timeout: 15000 }).catch(() => {});
const otherCode = (await otherPage.getByText(/^SNB-[A-Z0-9]{5}$/).first().innerText()).trim();
check("gets a different code", otherCode !== shown);

// --- teardown ---------------------------------------------------------
await browser.close();
for (const user of [coach, other]) {
  for (const row of await codesFor(user.$id)) {
    await db.deleteRow({ databaseId: D, tableId: "invite_codes", rowId: String(row.$id) });
  }
  await teams.delete({ teamId: circleTeamId(user.$id) }).catch(() => {});
  await users.delete({ userId: user.$id });
}

const failed = results.filter((ok) => !ok).length;
console.log(
  failed === 0
    ? `\n${results.length}/${results.length} passed. Coaches and codes removed.`
    : `\n${failed} of ${results.length} FAILED.`,
);
process.exitCode = failed === 0 ? 0 : 1;
