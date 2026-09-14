/**
 * Drives the real sign-in flow in a browser against the live Appwrite.
 *
 *   npm run dev            # in one terminal
 *   npm run e2e:auth       # in another
 *
 * Unit tests prove the form's states with the session module mocked. This
 * proves the session module itself works, which is the half mocking cannot
 * reach -- and it is how a missing APPWRITE_API_KEY in the Next environment
 * was caught, having looked exactly like "no hint available".
 *
 * Creates throwaway users and removes them. Dev only.
 */
import { chromium, type Page } from "playwright";
import { ID, Users } from "node-appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
dedupeSdkWarnings();

const users = new Users(createServerClient(serverAppwriteConfig()));
const stamp = Date.now();
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3001";
const results: string[] = [];
const check = (label: string, ok: boolean) => { results.push(ok ? "PASS" : "FAIL"); console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`); };
const pwField = (p: Page) =>
  p.getByLabel("Password", { exact: true }).or(p.getByLabel("New password", { exact: true })).first();

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 390, height: 852 }, colorScheme: "dark" })).newPage();

console.log("Creating an account");
const email = `e2e-${stamp}@example.com`;
await page.goto(`${BASE}/sign-in`);
await page.getByRole("button", { name: "Create account" }).click();
await page.getByLabel("Name").fill("E2E Athlete");
await page.getByLabel("Email").fill(email);
await pwField(page).fill("Probe-pass-123!");
await page.getByRole("button", { name: "Create account" }).click();
await page.waitForURL("**/today", { timeout: 20000 }).catch(() => {});
check("creating an account signs you straight in", page.url().endsWith("/today"));
const nameShown = await page
  .getByText("E2E Athlete")
  .waitFor({ timeout: 10000 })
  .then(() => true)
  .catch(() => false);
check("Today shows who is signed in", nameShown);

console.log("\nSession handling");
await page.goto(`${BASE}/sign-in`);
await page.waitForURL("**/today", { timeout: 10000 }).catch(() => {});
check("sign-in is skipped while a session exists", page.url().endsWith("/today"));
await page.getByRole("button", { name: "Sign out" }).click();
await page.waitForURL("**/sign-in", { timeout: 10000 }).catch(() => {});
check("signing out returns to sign-in", page.url().includes("/sign-in"));

console.log("\nWrong password");
await page.getByLabel("Email").fill(email);
await pwField(page).fill("Definitely-wrong-1!");
await page.getByRole("button", { name: "Sign in" }).click();
await page.locator("main").getByRole("alert").waitFor({ timeout: 15000 }).catch(() => {});
const wrong = (await page.locator("main").getByRole("alert").textContent().catch(() => "")) ?? "";
check("says so inline", wrong.includes("don't match"));
check("offers a reset link", wrong.includes("Forgot your password"));
check("reveals nothing about the address existing", !/no account|not found|doesn't exist/i.test(wrong));

console.log("\nRight password");
await pwField(page).fill("Probe-pass-123!");
await page.getByRole("button", { name: "Sign in" }).click();
await page.waitForURL("**/today", { timeout: 20000 }).catch(() => {});
check("signs in", page.url().endsWith("/today"));
await page.getByRole("button", { name: "Sign out" }).click();
await page.waitForURL("**/sign-in", { timeout: 10000 }).catch(() => {});

console.log("\nAccount created through a provider");
const oauthEmail = `e2e-oauth-${stamp}@example.com`;
const oauthUser = await users.create({ userId: ID.unique(), email: oauthEmail, name: "OAuth Athlete" });
await page.getByLabel("Email").fill(oauthEmail);
await pwField(page).fill("Anything-123!");
await page.getByRole("button", { name: "Sign in" }).click();
await page.locator("main").getByRole("alert").waitFor({ timeout: 15000 }).catch(() => {});
const trap = (await page.locator("main").getByRole("alert").textContent().catch(() => "")) ?? "";
check("does not offer a reset for an account with no password", !trap.includes("Forgot your password"));

console.log("\nThe hint endpoint");
const ask = async (body: unknown) => {
  const r = await page.request.post(`${BASE}/api/auth/method-hint`, { data: body });
  return { status: r.status(), json: (await r.json().catch(() => ({}))) as { hint?: string } };
};
check("says nothing for an unknown address", (await ask({ email: `nobody-${stamp}@example.com` })).json.hint === "none");
check("says nothing for an account that has a password", (await ask({ email })).json.hint === "none");
check("answers for a passwordless account", (await ask({ email: oauthEmail })).json.hint !== "none");
check("ignores junk without spending a lookup", (await ask({ email: "@" })).json.hint === "none");

let limited = false;
for (let i = 0; i < 14; i++) {
  if ((await ask({ email: `flood-${i}-${stamp}@example.com` })).status === 429) { limited = true; break; }
}
check("rate-limits a flood of lookups", limited);

console.log("\nPassword reset");
await page.goto(`${BASE}/sign-in`);
await page.getByRole("link", { name: "Forgot?" }).click();
await page.waitForURL("**/sign-in/forgot", { timeout: 10000 }).catch(() => {});
check("the Forgot link reaches the reset screen", page.url().includes("/sign-in/forgot"));
check(
  "it says up front that the link expires",
  await page.getByText(/expires in an hour/).isVisible().catch(() => false),
);

const sendButton = page.getByRole("button", { name: "Send reset link" });
check("the send button is inert until the address looks like one", await sendButton.isDisabled());
await page.getByLabel("Email").fill(email);
check("and active once it does", await sendButton.isEnabled());
await sendButton.click();

// Appwrite currently answers 503 because SMTP is not enabled on the instance.
// The confirmation must look identical regardless -- it never reads the result.
const sent = await page
  .getByText(/has an account, a reset link is on its way/)
  .waitFor({ timeout: 15000 })
  .then(() => true)
  .catch(() => false);
check("the confirmation appears whatever the server answered", sent);
check(
  "it stays conditional about whether the account exists",
  ((await page.locator("main").textContent()) ?? "").includes("If "),
);
check(
  "resending is on a cooldown",
  await page.getByRole("button", { name: "Resend link" }).isDisabled().catch(() => false),
);

console.log("\nReset link states");
await page.goto(`${BASE}/sign-in/reset`);
check(
  "a link with no token says it is incomplete",
  await page.getByText("This link is incomplete").isVisible().catch(() => false),
);

await page.goto(`${BASE}/sign-in/reset?userId=nope&secret=invalid`);
await pwField(page).fill("hunter2222");
await page.getByLabel("Confirm", { exact: true }).fill("hunter2222");
await page.getByRole("button", { name: "Save and sign in" }).click();
const expired = await page
  .getByText("That link has expired")
  .waitFor({ timeout: 15000 })
  .then(() => true)
  .catch(() => false);
check("a token Appwrite rejects is reported as expired, with a way to get another", expired);

await users.delete({ userId: oauthUser.$id });
const made = await users.list({ queries: [`equal("email","${email}")`] }).catch(() => null);
for (const u of made?.users ?? []) await users.delete({ userId: u.$id });
await browser.close();

const failed = results.filter((r) => r === "FAIL").length;
console.log(failed === 0 ? `\n${results.length}/${results.length} passed. Probe users removed.` : `\n${failed} FAILED`);
process.exitCode = failed ? 1 : 0;
