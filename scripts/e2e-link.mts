/**
 * Drives coach-link redemption against the live instance.
 *
 *   npm run build && npx next start -p 3120
 *   E2E_BASE_URL=http://localhost:3120 npm run e2e:link
 *
 * The unit tests prove the decision logic and the component. What only a real
 * instance can show is the thing that actually matters: that after redeeming,
 * the coach can read sets the athlete logged BEFORE the link existed, and that
 * nobody else can read anything.
 *
 * That retroactive read is the whole reason circles exist (see
 * appwrite/documents/circle.ts). A link row written without the membership
 * would pass every unit test and leave a coach staring at an empty roster.
 */
import { chromium, type Page } from "playwright";
import { ID, Query, TablesDB, Teams, Users } from "node-appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
import { circleTeamId, CIRCLE_ROLES } from "../appwrite/documents/circle";
import { setPermissions } from "../appwrite/documents/policy";

dedupeSdkWarnings();

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const config = serverAppwriteConfig();
const admin = createServerClient(config);
const db = new TablesDB(admin);
const users = new Users(admin);
const teams = new Teams(admin);
const D = config.databaseId;
const stamp = Date.now();

const results: boolean[] = [];
const check = (label: string, ok: boolean) => {
  results.push(ok);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
};

/** Polls until a condition holds. Writes are not synchronous with the UI. */
const until = async (label: string, predicate: () => Promise<boolean>, ms = 20000) => {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() > deadline) {
      console.log(`  (timed out waiting for ${label})`);
      return false;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
};

const linkRows = async (athleteId: string) =>
  (
    await db.listRows({
      databaseId: D, tableId: "coach_athlete_links",
      queries: [Query.equal("athlete_id", athleteId), Query.limit(5)], ttl: 0,
    })
  ).rows as unknown as Array<Record<string, unknown>>;

const mkUser = (tag: string, name: string) =>
  users.create({
    userId: ID.unique(),
    email: `link-${tag}-${stamp}@example.com`,
    password: "Probe-pass-123!",
    name,
  });

const asUser = async (userId: string) => {
  const session = await users.createSession({ userId });
  return new TablesDB(
    new (await import("node-appwrite")).Client()
      .setEndpoint(config.endpoint)
      .setProject(config.projectId)
      .setSession(session.secret),
  );
};

const canRead = async (client: TablesDB, tableId: string, rowId: string) => {
  try {
    await client.getRow({ databaseId: D, tableId, rowId });
    return true;
  } catch {
    return false;
  }
};

const athlete = await mkUser("athlete", "Joey Pang");
const coach = await mkUser("coach", "Ruairi Deane");
const stranger = await mkUser("stranger", "Sam Tierney");

const signIn = async (page: Page, email: string) => {
  await page.goto(`${BASE}/sign-in`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("Probe-pass-123!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/today", { timeout: 20000 }).catch(() => {});
};

const browser = await chromium.launch();

// --- the coach gets a code ----------------------------------------------
console.log("\nThe coach's code");
const coachCtx = await browser.newContext({ viewport: { width: 390, height: 852 } });
const coachPage = await coachCtx.newPage();
await signIn(coachPage, coach.email);
await coachPage.goto(`${BASE}/me`);
await coachPage.getByRole("button", { name: "Invite an athlete" }).click();
await coachPage.getByRole("button", { name: "Copy" }).waitFor({ timeout: 15000 }).catch(() => {});
const code = (await coachPage.getByText(/^SNB-[A-Z0-9]{5}$/).first().innerText()).trim();
check("a coach with no athletes can still get one", /^SNB-[A-Z0-9]{5}$/.test(code));

// --- the athlete logs something BEFORE linking ---------------------------
console.log("\nTraining logged before any coach exists");
const athleteCtx = await browser.newContext({ viewport: { width: 390, height: 852 } });
const page = await athleteCtx.newPage();
await signIn(page, athlete.email);
// Signing in creates the circle; the set is written with the admin key so the
// test does not depend on the logger UI.
const setId = `st-link-${stamp}`;
await db.createRow({
  databaseId: D, tableId: "sets", rowId: setId,
  data: {
    session_id: `cs-link-${stamp}`, athlete_id: athlete.$id, exercise_id: ID.unique(),
    set_index: 1, load_kg: 142.5, reps: 5,
    logged_at: new Date().toISOString(), client_set_id: setId,
  },
  permissions: setPermissions({ athleteId: athlete.$id }),
});
const coachDb = await asUser(coach.$id);
const strangerDb = await asUser(stranger.$id);
check("the coach cannot read it yet", !(await canRead(coachDb, "sets", setId)));

// --- redeeming -----------------------------------------------------------
console.log("\nRedeeming, with consent");
await page.goto(`${BASE}/me`);
await page.getByLabel("Enter a coach code").waitFor({ timeout: 15000 });
// Typed without the prefix and in lower case, the way somebody reads one off a
// phone screen.
await page.getByLabel("Enter a coach code").fill(code.slice(4).toLowerCase());
await page.getByRole("button", { name: "Link my coach" }).click();

await page.getByRole("button", { name: "Link", exact: true }).waitFor({ timeout: 15000 });
const consent = (await page.locator("section[aria-label='Coach']").innerText()).replace(/\s+/g, " ");
check("names the coach before anything is written", consent.includes("Link with Ruairi Deane?"));
check(
  "states exactly what linking shares",
  consent.includes("see your sessions, your videos and your bodyweight"),
);
check("and has written nothing at the point of asking", (await linkRows(athlete.$id)).length === 0);

await page.getByRole("button", { name: "Link", exact: true }).click();
// The code field going away is what distinguishes linked from confirming --
// the coach's name appears in both, so waiting on it proves nothing.
// Waiting on the date, not on the name or the absent field: the name appears
// on the confirm screen too, and the field is gone during "Linking…" as well.
// Only the linked state carries "linked 14 Sep".
const settled = await until("the link to land", async () =>
  /linked \d+ [A-Z][a-z]{2}/.test(await page.locator("section[aria-label='Coach']").innerText()),
);
check("leaves the confirm step once linked", settled);
const linkedText = (await page.locator("section[aria-label='Coach']").innerText()).replace(/\s+/g, " ");
check("shows the coach", linkedText.includes("Ruairi Deane"));
check("and when it happened", /linked \d+ [A-Z][a-z]{2}/.test(linkedText));

// --- what the link actually granted --------------------------------------
console.log("\nWhat the link granted");
await until("the link row", async () => (await linkRows(athlete.$id)).length === 1);
const links = await linkRows(athlete.$id);
check("exactly one link row", links.length === 1);
check(
  "recorded active, naming both parties",
  links[0]?.status === "active" && links[0]?.coach_id === coach.$id,
);

const memberships = await teams.listMemberships({ teamId: circleTeamId(athlete.$id) });
check(
  "the coach is in the athlete's circle",
  memberships.memberships.some((m) => m.userId === coach.$id && m.roles.includes(CIRCLE_ROLES.coach)),
);
// The point of the whole design. A link that only worked going forward would
// need a backfill over every row the athlete ever wrote.
check("and can now read the set logged BEFORE linking", await canRead(coachDb, "sets", setId));
check("while a stranger still cannot", !(await canRead(strangerDb, "sets", setId)));

// --- redeeming again ------------------------------------------------------
console.log("\nRedeeming the same code again");
const jwt = (await users.createJWT({ userId: athlete.$id })).jwt;
const again = await (await fetch(`${BASE}/api/link`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${jwt}` },
  body: JSON.stringify({ code }),
})).json();
check("is a no-op, not a second row", again.status === "already-linked");
check("still exactly one link row", (await linkRows(athlete.$id)).length === 1);

console.log("\nWhat the endpoints refuse");
const post = async (path: string, token: string | null, body: unknown) =>
  fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

check("resolve refuses an unauthenticated caller", (await post("/api/link/resolve", null, { code })).status === 401);
check("redeem refuses an unauthenticated caller", (await post("/api/link", null, { code })).status === 401);

const coachJwt = (await users.createJWT({ userId: coach.$id })).jwt;
const own = await (await post("/api/link", coachJwt, { code })).json();
check("a coach cannot redeem their own code", own.status === "self");

const strangerJwt = (await users.createJWT({ userId: stranger.$id })).jwt;
const unknown = await (await post("/api/link", strangerJwt, { code: "SNB-ZZZZZ" })).json();
check("an unknown code links nobody", unknown.status === "unknown-code");

// A second coach for the athlete, refused.
const coach2 = await mkUser("coach2", "Louis Byrne");
const coach2Jwt = (await users.createJWT({ userId: coach2.$id })).jwt;
const code2 = (await (await fetch(`${BASE}/api/invite`, {
  method: "POST", headers: { authorization: `Bearer ${coach2Jwt}` },
})).json()).code as string;
const second = await (await post("/api/link", jwt, { code: code2 })).json();
check("a second coach is refused, naming the first", second.status === "other-coach" && second.coachId === coach.$id);
check("and nothing was written", (await linkRows(athlete.$id)).length === 1);

// --- teardown ------------------------------------------------------------
await browser.close();
await db.deleteRow({ databaseId: D, tableId: "sets", rowId: setId }).catch(() => {});
for (const t of ["coach_athlete_links", "invite_codes"] as const) {
  const owned = await db.listRows({ databaseId: D, tableId: t, queries: [Query.limit(100)], ttl: 0 });
  for (const row of owned.rows) {
    const r = row as unknown as Record<string, unknown>;
    if ([athlete.$id, coach.$id, coach2.$id, stranger.$id].includes(String(r.athlete_id ?? r.coach_id))) {
      await db.deleteRow({ databaseId: D, tableId: t, rowId: String(r.$id) });
    }
  }
}
for (const u of [athlete, coach, coach2, stranger]) {
  await teams.delete({ teamId: circleTeamId(u.$id) }).catch(() => {});
  await users.delete({ userId: u.$id });
}

const failed = results.filter((ok) => !ok).length;
console.log(
  failed === 0
    ? `\n${results.length}/${results.length} passed. Cast, links and codes removed.`
    : `\n${failed} of ${results.length} FAILED.`,
);
process.exitCode = failed === 0 ? 0 : 1;
