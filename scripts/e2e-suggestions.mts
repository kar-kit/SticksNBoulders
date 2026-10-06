/**
 * Drives Order 28's coach switch for next-set suggestions against the live
 * instance.
 *
 *   npm run build && PORT=3128 npm run start
 *   E2E_BASE_URL=http://localhost:3128 npm run e2e:suggestions
 *
 * What only the instance can prove:
 *
 *   - The column exists and a link row without a stored choice reads as
 *     direct (the schema default).
 *   - POST /api/link/suggestions lets the coach on an active link write it,
 *     and refuses everybody else: no token, the athlete, a stranger, a coach
 *     whose link was revoked.
 *   - Nobody can write it from a client session, the coach included: the link
 *     table has no create permission and rows carry no update permission, so
 *     the route is the only way in. That is the audit rule this storage
 *     depends on.
 *   - The athlete and the coach can read it; a stranger cannot.
 *   - In a browser: the coach flips it on the Athlete View, the athlete's
 *     Profile says their coach holds suggestions, the logger caches the mode
 *     on the device, and with no signal the cached mode survives a failed
 *     re-read rather than being lost.
 *
 * Creates throwaway users and only ever deletes rows it created.
 */
import { chromium, type Page } from "playwright";
import { AppwriteException, Client, ID, TablesDB, Teams, Users } from "node-appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
import { addCoachToCircle, ensureCircle } from "../appwrite/documents/circle-admin";
import { circleTeamId } from "../appwrite/documents/circle";
import { invitePermissions, linkPermissions, profilePermissions } from "../appwrite/documents/policy";

dedupeSdkWarnings();

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3128";
const PASSWORD = "Probe-pass-123!";
const config = serverAppwriteConfig();
const admin = createServerClient(config);
const db = new TablesDB(admin);
const users = new Users(admin);
const teams = new Teams(admin);
const D = config.databaseId;
const T = "coach_athlete_links";
const stamp = Date.now();

const results: boolean[] = [];
const check = (label: string, ok: boolean, detail = "") => {
  results.push(ok);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

const mkUser = (tag: string, name: string) =>
  users.create({ userId: ID.unique(), email: `sugg-${tag}-${stamp}@example.com`, password: PASSWORD, name });

const athlete = await mkUser("a", "Joey Pang");
const coach = await mkUser("c", "Ruairi Deane");
const former = await mkUser("f", "Louis Former");
const stranger = await mkUser("s", "Sam Stranger");

const created = { links: [] as string[] };

const jwtFor = async (userId: string) => (await users.createJWT({ userId })).jwt;

/** A TablesDB acting as this user -- what their browser could do. */
const asUser = async (userId: string) =>
  new TablesDB(new Client().setEndpoint(config.endpoint).setProject(config.projectId).setJWT(await jwtFor(userId)));

const post = async (body: unknown, jwt?: string) =>
  fetch(`${BASE}/api/link/suggestions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(jwt ? { authorization: `Bearer ${jwt}` } : {}) },
    body: JSON.stringify(body),
  });

const modeOf = async (rowId: string) =>
  (await db.getRow({ databaseId: D, tableId: T, rowId })).suggestions_mode as unknown;

// Typed loosely on purpose: a return type in context makes the SDK's generic
// row type infer from it instead of from the data being written.
const refused = async (attempt: () => Promise<void>) => {
  try {
    await attempt();
    return false;
  } catch (error) {
    return error instanceof AppwriteException && [401, 403, 404].includes(error.code);
  }
};

const signIn = async (page: Page, email: string) => {
  await page.goto(`${BASE}/sign-in`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 30000 }).catch(() => {});
};

const visible = (page: Page, text: string | RegExp, timeout = 20000) =>
  page
    .getByText(text)
    .first()
    .waitFor({ timeout })
    .then(() => true)
    .catch(() => false);

const cachedMode = (page: Page) =>
  page.evaluate(() => {
    const raw = localStorage.getItem("snb.suggestion-mode");
    return raw ? (JSON.parse(raw) as { athleteId?: string; mode?: string }) : null;
  });

const browser = await chromium.launch();

try {
  // --- a linked pair, and a coach who used to be linked ----------------------
  await ensureCircle(teams, athlete.$id, "Joey Pang");
  await addCoachToCircle(teams, athlete.$id, coach.$id);
  await db.createRow({
    databaseId: D,
    tableId: "profiles",
    rowId: athlete.$id,
    data: { user_id: athlete.$id, display_name: "Joey Pang", sex: "male", units: "kg", created_at: new Date().toISOString() },
    permissions: profilePermissions({ athleteId: athlete.$id }),
  });
  const linkId = ID.unique();
  // Written the way redemption writes it, with no suggestions_mode: a link
  // from before Order 28.
  await db.createRow({
    databaseId: D,
    tableId: T,
    rowId: linkId,
    data: { coach_id: coach.$id, athlete_id: athlete.$id, status: "active", linked_at: new Date().toISOString() },
    permissions: linkPermissions({ coachId: coach.$id, athleteId: athlete.$id }),
  });
  created.links.push(linkId);
  const formerId = ID.unique();
  await db.createRow({
    databaseId: D,
    tableId: T,
    rowId: formerId,
    data: {
      coach_id: former.$id,
      athlete_id: athlete.$id,
      status: "revoked",
      linked_at: new Date(Date.now() - 30 * 86_400_000).toISOString(),
      revoked_at: new Date(Date.now() - 7 * 86_400_000).toISOString(),
    },
    permissions: linkPermissions({ coachId: former.$id, athleteId: athlete.$id }),
  });
  created.links.push(formerId);

  console.log("The column, on the live instance");
  check("a link written without a choice reads as direct", (await modeOf(linkId)) === "direct", String(await modeOf(linkId)));

  // --- the route -------------------------------------------------------------
  console.log("\nWho the route lets set it");
  check("no token: 401", (await post({ athleteId: athlete.$id, mode: "held" })).status === 401);
  check("the athlete, for their own link: 403", (await post({ athleteId: athlete.$id, mode: "held" }, await jwtFor(athlete.$id))).status === 403);
  check("a stranger: 403", (await post({ athleteId: athlete.$id, mode: "held" }, await jwtFor(stranger.$id))).status === 403);
  check("a coach whose link was revoked: 403", (await post({ athleteId: athlete.$id, mode: "held" }, await jwtFor(former.$id))).status === 403);
  check("and none of them moved it", (await modeOf(linkId)) === "direct");
  check(
    "the coach, with a mode that does not exist: 400",
    (await post({ athleteId: athlete.$id, mode: "approve-each" }, await jwtFor(coach.$id))).status === 400,
  );
  const ok = await post({ athleteId: athlete.$id, mode: "held" }, await jwtFor(coach.$id));
  check("the coach on the active link: 200", ok.status === 200, String(ok.status));
  check("and the row now says held", (await modeOf(linkId)) === "held");
  const after = await db.getRow({ databaseId: D, tableId: T, rowId: linkId });
  check("without touching its status", after.status === "active");
  check(
    "and still readable by exactly the two of them, writable by nobody",
    JSON.stringify([...after.$permissions].sort()) ===
      JSON.stringify(linkPermissions({ coachId: coach.$id, athleteId: athlete.$id }).sort()),
    JSON.stringify(after.$permissions),
  );
  check("the revoked coach's row was not touched", (await modeOf(formerId)) === "direct");

  // --- client sessions -------------------------------------------------------
  console.log("\nNobody writes it from a client session");
  const athleteDb = await asUser(athlete.$id);
  const coachDb = await asUser(coach.$id);
  const strangerDb = await asUser(stranger.$id);
  check(
    "the athlete cannot flip it back on their own row",
    await refused(async () => {
      await athleteDb.updateRow({ databaseId: D, tableId: T, rowId: linkId, data: { suggestions_mode: "direct" } });
    }),
  );
  check(
    "the coach cannot write it from the browser either: the route is the only way in",
    await refused(async () => {
      await coachDb.updateRow({ databaseId: D, tableId: T, rowId: linkId, data: { suggestions_mode: "direct" } });
    }),
  );
  check(
    "a stranger cannot forge a link row carrying a mode",
    await refused(async () => {
      await strangerDb.createRow({
        databaseId: D,
        tableId: T,
        rowId: ID.unique(),
        data: { coach_id: stranger.$id, athlete_id: athlete.$id, status: "active", linked_at: new Date().toISOString(), suggestions_mode: "direct" },
        // Only a role the stranger holds -- read for themselves, built by the
        // policy -- so a refusal is the table saying no, not Appwrite refusing
        // to let them stamp somebody else's role.
        permissions: invitePermissions({ coachId: stranger.$id }),
      });
    }),
  );
  check("and the row still says held", (await modeOf(linkId)) === "held");

  console.log("\nWho can read it");
  const readBy = async (tables: TablesDB) =>
    tables.getRow({ databaseId: D, tableId: T, rowId: linkId }).then((r) => r.suggestions_mode as unknown).catch(() => null);
  check("the athlete reads it", (await readBy(athleteDb)) === "held");
  check("the coach reads it", (await readBy(coachDb)) === "held");
  check("a stranger does not", (await readBy(strangerDb)) === null);

  // --- the coach, in a browser ----------------------------------------------
  console.log("\nThe coach, on the Athlete View");
  const coachCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  const coachPage = await coachCtx.newPage();
  await signIn(coachPage, coach.email);
  await coachPage.goto(`${BASE}/coach/athletes/${athlete.$id}`);
  const holdRadio = coachPage.getByRole("radio", { name: /Hold them back/ });
  const directRadio = coachPage.getByRole("radio", { name: /Athlete sees them directly/ });
  await holdRadio.waitFor({ timeout: 20000 }).catch(() => {});
  check("shows the switch, on held", await holdRadio.isChecked().catch(() => false));
  await directRadio.check();
  await coachPage.waitForTimeout(500);
  await coachPage.getByText("Saving…").waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  check("flipping it writes direct to the row", (await modeOf(linkId)) === "direct");
  await holdRadio.check();
  await coachPage.getByText("Saving…").waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  await coachPage.waitForTimeout(500);
  check("and back to held", (await modeOf(linkId)) === "held");
  await coachPage.reload();
  await holdRadio.waitFor({ timeout: 20000 }).catch(() => {});
  check("still held after a reload, read from Appwrite", await holdRadio.isChecked().catch(() => false));

  // --- the athlete, in a browser --------------------------------------------
  console.log("\nThe athlete");
  const athleteCtx = await browser.newContext({ viewport: { width: 390, height: 852 }, colorScheme: "dark" });
  const athletePage = await athleteCtx.newPage();
  await signIn(athletePage, athlete.email);
  await athletePage.goto(`${BASE}/me`);
  check("Profile says their coach holds suggestions", await visible(athletePage, /Your coach has load suggestions held/));
  check("and offers no switch of their own", (await athletePage.getByRole("radio").count()) === 0);

  await athletePage.goto(`${BASE}/log`);
  await athletePage.waitForFunction(() => localStorage.getItem("snb.suggestion-mode") !== null, null, { timeout: 20000 }).catch(() => {});
  const cached = await cachedMode(athletePage);
  check("the logger caches the mode on the device", cached?.mode === "held" && cached?.athleteId === athlete.$id, JSON.stringify(cached));

  console.log("\nWith no signal");
  await athleteCtx.setOffline(true);
  // A return to the foreground re-reads the mode. Offline, that read fails;
  // the cached mode must still be what applies.
  await athletePage.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await athletePage.waitForTimeout(1500);
  const offline = await cachedMode(athletePage);
  check("a failed re-read leaves the cached mode in place", offline?.mode === "held", JSON.stringify(offline));
  await athleteCtx.setOffline(false);

  console.log("\nThe coach changes it while the athlete is away");
  check("coach sets direct through the route", (await post({ athleteId: athlete.$id, mode: "direct" }, await jwtFor(coach.$id))).status === 200);
  await athletePage.evaluate(() => window.dispatchEvent(new Event("online")));
  await athletePage
    .waitForFunction(() => (localStorage.getItem("snb.suggestion-mode") ?? "").includes('"direct"'), null, { timeout: 15000 })
    .catch(() => {});
  check("the athlete's device picks it up when the signal returns", (await cachedMode(athletePage))?.mode === "direct");
} catch (error) {
  check("ran without throwing", false, String(error));
} finally {
  await browser.close();
  for (const rowId of created.links) await db.deleteRow({ databaseId: D, tableId: T, rowId }).catch(() => {});
  await db.deleteRow({ databaseId: D, tableId: "profiles", rowId: athlete.$id }).catch(() => {});
  await teams.delete({ teamId: circleTeamId(athlete.$id) }).catch(() => {});
  for (const u of [athlete, coach, former, stranger]) await users.delete({ userId: u.$id }).catch(() => {});
}

const failed = results.filter((ok) => !ok).length;
console.log(failed === 0 ? `\n${results.length}/${results.length} passed. Probe data removed.` : `\n${failed} of ${results.length} FAILED`);
process.exitCode = failed ? 1 : 0;
