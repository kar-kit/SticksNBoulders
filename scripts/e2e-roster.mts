/**
 * Drives the Roster (Order 24) against the live instance.
 *
 *   npm run dev            # or build + start; in a worktree: npx next dev --webpack -p 3124
 *   E2E_BASE_URL=http://localhost:3124 npm run e2e:roster
 *
 * Unit tests cover the trigger rules and the screen states with mocked reads.
 * What only the instance proves is that every column is readable through the
 * COACH'S OWN SESSION -- sessions, rollups, clips, reviews, weigh-ins and
 * profiles for two athletes at once, through their circle teams -- and that
 * the screen tells the truth about them:
 *
 *   - a coach with no athletes gets the empty state and their invite code
 *   - two linked athletes, one row each, the week counted from rollups
 *   - "needs you": an unreviewed clip, and an athlete who never weighed in
 *   - sorting, a row opening Athlete View, and no horizontal scroll at 1280
 *   - an athlete unlinking while the coach watches leaves the table live, and
 *     the departure notice says so without a name
 *   - a stranger coach sees none of it
 *
 * Creates throwaway users and deletes exactly the rows it created, by id.
 */
import { chromium, type Page } from "playwright";
import { ID, Query, TablesDB, Teams, Users } from "node-appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
import { addCoachToCircle, ensureCircle } from "../appwrite/documents/circle-admin";
import { circleTeamId } from "../appwrite/documents/circle";
import { adminRollupTables, rebuildRollup } from "../appwrite/documents/rollup-admin";
import { bodyweightRowId } from "../appwrite/documents";
import {
  bodyweightPermissions,
  linkPermissions,
  profilePermissions,
  sessionPermissions,
  setPermissions,
} from "../appwrite/documents/policy";
import { dayKey } from "../lib/bodyweight/bodyweight";

dedupeSdkWarnings();

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3124";
const PASSWORD = "Probe-pass-123!";
const config = serverAppwriteConfig();
const admin = createServerClient(config);
const db = new TablesDB(admin);
const users = new Users(admin);
const teams = new Teams(admin);
const D = config.databaseId;
const stamp = Date.now();
const DAY = 86_400_000;

const results: boolean[] = [];
const check = (label: string, ok: boolean, detail = "") => {
  results.push(ok);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

const until = async (label: string, predicate: () => Promise<boolean>, ms = 20000) => {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await predicate().catch(() => false)) return true;
    if (Date.now() > deadline) {
      console.log(`  (timed out waiting for ${label})`);
      return false;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
};

const squatId = (
  await db.listRows({
    databaseId: D,
    tableId: "exercises",
    queries: [Query.equal("is_global", true), Query.equal("name", "Squat"), Query.limit(1)],
    ttl: 0,
  })
).rows[0]?.$id as string | undefined;
if (!squatId) throw new Error('No global exercise "Squat". Run npm run exercises:seed first.');

const mkUser = (tag: string, name: string) =>
  users.create({ userId: ID.unique(), email: `roster-${tag}-${stamp}@example.com`, password: PASSWORD, name });

const coach = await mkUser("c", "Ruairi Deane");
const joey = await mkUser("a", "Joey Pang");
const sam = await mkUser("b", "Sam Okafor");
const stranger = await mkUser("s", "Louis Stranger");

const created: { table: string; id: string }[] = [];
const rollupKeys: { athleteId: string; at: Date }[] = [];

const signIn = async (page: Page, email: string) => {
  await page.goto(`${BASE}/sign-in`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 30000 }).catch(() => {});
};
const text = async (p: Page) => (await p.locator("main").first().innerText()).replace(/\s+/g, " ");
const tableHrefs = (p: Page) =>
  p.getByRole("table", { name: "Athletes" }).locator("a[role=row]").evaluateAll((rows) =>
    rows.map((r) => r.getAttribute("href") ?? ""),
  );

const link = async (athlete: { $id: string }, name: string) => {
  await ensureCircle(teams, athlete.$id, name);
  await addCoachToCircle(teams, athlete.$id, coach.$id);
  await db.createRow({
    databaseId: D, tableId: "profiles", rowId: athlete.$id,
    data: { user_id: athlete.$id, display_name: name, units: "kg", created_at: new Date().toISOString() },
    permissions: profilePermissions({ athleteId: athlete.$id }),
  });
  created.push({ table: "profiles", id: athlete.$id });
  const linkId = ID.unique();
  await db.createRow({
    databaseId: D, tableId: "coach_athlete_links", rowId: linkId,
    // A month ago, so a never-weighed athlete is past the new-athlete grace period.
    data: { coach_id: coach.$id, athlete_id: athlete.$id, status: "active", linked_at: new Date(stamp - 30 * DAY).toISOString() },
    permissions: linkPermissions({ coachId: coach.$id, athleteId: athlete.$id }),
  });
  created.push({ table: "coach_athlete_links", id: linkId });
};

const browser = await chromium.launch();

try {
  // --- an empty account -------------------------------------------------------
  console.log("A coach with nobody linked yet");
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page, coach.email);
  await page.goto(`${BASE}/coach/roster`);
  check("sees the empty state", await until("empty state", async () => (await text(page)).includes("No athletes yet")));
  check(
    "with the invite code as its action",
    await until("invite action", async () => (await page.getByRole("region", { name: "Invite code" }).count()) === 1),
  );

  // --- two linked athletes ----------------------------------------------------
  console.log("\nTwo linked athletes");
  await link(joey, "Joey Pang");
  await link(sam, "Sam Okafor");

  // Joey trained this week, filmed a set, and weighed in this morning. Sam did
  // nothing and has never weighed in.
  const startedAt = new Date(stamp - 2 * 60 * 60_000);
  const sessionId = `roster-s-${stamp}`;
  await db.createRow({
    databaseId: D, tableId: "sessions", rowId: sessionId,
    data: {
      athlete_id: joey.$id, client_session_id: sessionId, started_at: startedAt.toISOString(),
      finished_at: new Date(startedAt.getTime() + 60 * 60_000).toISOString(), set_count: 2, tonnage_kg: 1080,
    },
    permissions: sessionPermissions({ athleteId: joey.$id }),
  });
  created.push({ table: "sessions", id: sessionId });
  for (const n of [0, 1]) {
    const setId = `roster-t-${stamp}-${n}`;
    const loggedAt = new Date(startedAt.getTime() + (n + 1) * 5 * 60_000);
    await db.createRow({
      databaseId: D, tableId: "sets", rowId: setId,
      data: {
        session_id: sessionId, athlete_id: joey.$id, exercise_id: squatId, set_index: n, load_kg: 180, reps: 3,
        rpe: 8, is_warmup: false, logged_at: loggedAt.toISOString(), client_set_id: setId,
        video_file_id: n === 1 ? `roster-nofile-${stamp}` : undefined,
      },
      permissions: setPermissions({ athleteId: joey.$id }),
    });
    created.push({ table: "sets", id: setId });
  }
  await rebuildRollup(adminRollupTables(admin), D, { athleteId: joey.$id, exerciseId: squatId, loggedAt: startedAt });
  rollupKeys.push({ athleteId: joey.$id, at: startedAt });

  const today = dayKey(new Date());
  const bwId = bodyweightRowId(joey.$id, today);
  await db.createRow({
    databaseId: D, tableId: "bodyweight_entries", rowId: bwId,
    data: { athlete_id: joey.$id, weight_kg: 82.4, measured_on: today, recorded_at: new Date().toISOString() },
    permissions: bodyweightPermissions({ athleteId: joey.$id }),
  });
  created.push({ table: "bodyweight_entries", id: bwId });

  await page.reload();
  check(
    "one row per athlete",
    await until("two rows", async () => (await tableHrefs(page)).length === 2),
  );
  const hrefs = await tableHrefs(page);
  check(
    "alphabetical, each opening Athlete View",
    hrefs[0] === `/coach/athletes/${joey.$id}` && hrefs[1] === `/coach/athletes/${sam.$id}`,
    hrefs.join(", "),
  );
  const joeyRow = page.locator(`a[href="/coach/athletes/${joey.$id}"][role=row]`);
  const joeyText = (await joeyRow.innerText()).replace(/\s+/g, " ");
  check("this week: the session, and the working sets from the rollup", joeyText.includes("1 session · 2 sets"), joeyText);
  check("one video waiting", / 1 /.test(` ${joeyText} `), joeyText);
  check("bodyweight read through the circle", joeyText.includes("82.4"), joeyText);
  check("no block until the Program Editor exists", joeyText.includes("No block"));

  console.log("\nNeeds you");
  const videoItem = page.getByRole("link", { name: /Joey Pang\s*1 video waiting/ });
  check("Joey's unreviewed clip, linked to the queue", (await videoItem.getAttribute("href")) === "/coach/review");
  check(
    "Sam, linked a month and never weighed in",
    (await page.getByRole("link", { name: /Sam Okafor\s*no bodyweight logged yet/ }).count()) === 1,
  );
  check("nothing about Joey's bodyweight", (await page.getByRole("link", { name: /Joey Pang\s*no bodyweight/ }).count()) === 0);

  console.log("\nThe table");
  await page.getByRole("table", { name: "Athletes" }).getByRole("button", { name: "Videos" }).click();
  check("sorts by videos, most first", (await tableHrefs(page))[0] === `/coach/athletes/${joey.$id}`);
  await page.getByRole("table", { name: "Athletes" }).getByRole("button", { name: "Athlete" }).click();
  await page.getByRole("table", { name: "Athletes" }).getByRole("button", { name: /Athlete/ }).click();
  check("and by name, flipped", (await tableHrefs(page))[0] === `/coach/athletes/${sam.$id}`);

  await page.setViewportSize({ width: 1280, height: 900 });
  const overflow = await page.locator("main").evaluate((m) => m.scrollWidth - m.clientWidth);
  check("fits at 1280 with no horizontal scroll", overflow <= 0, `${overflow}px`);
  await page.screenshot({ path: ".shots/roster-1280.png" }).catch(() => {});
  await page.setViewportSize({ width: 1440, height: 900 });

  await joeyRow.click();
  await page.waitForURL(`**/coach/athletes/${joey.$id}`, { timeout: 15000 }).catch(() => {});
  check("a row opens Athlete View", page.url().endsWith(`/coach/athletes/${joey.$id}`));

  // --- an athlete leaves while the coach is looking --------------------------
  console.log("\nSam unlinks while the coach is on the Roster");
  await page.goto(`${BASE}/coach/roster`);
  await until("two rows again", async () => (await tableHrefs(page)).length === 2);
  const { jwt } = await users.createJWT({ userId: sam.$id });
  const revoked = (await (
    await fetch(`${BASE}/api/link/revoke`, { method: "POST", headers: { authorization: `Bearer ${jwt}` } })
  ).json()) as { status?: string };
  check("the unlink lands", revoked.status === "unlinked", JSON.stringify(revoked));
  check(
    "Sam leaves the table live",
    await until("one row", async () => (await tableHrefs(page)).length === 1),
  );
  check("and the needs-you list", (await page.getByRole("link", { name: /Sam Okafor/ }).count()) === 0);
  check(
    "the departure notice says one left",
    await until("notice", async () => (await text(page)).includes("An athlete stopped sharing their training with you on")),
  );
  check("without naming them", !(await page.getByRole("status").innerText()).includes("Sam"));

  check("no uncaught page errors", errors.length === 0, errors.join(" | "));
  await ctx.close();

  // --- a stranger --------------------------------------------------------------
  console.log("\nA coach nobody linked to");
  const otherCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const other = await otherCtx.newPage();
  await signIn(other, stranger.email);
  await other.goto(`${BASE}/coach/roster`);
  check("sees an empty roster", await until("empty", async () => (await text(other)).includes("No athletes yet")));
  check("and nobody's name", !/Joey|Sam/.test(await text(other)));
  await otherCtx.close();
} catch (error) {
  console.error(error);
  results.push(false);
} finally {
  await browser.close();
  for (const { table, id } of created.reverse()) {
    await db.deleteRow({ databaseId: D, tableId: table, rowId: id }).catch(() => {});
  }
  // The rollup row was written by the server helper; find it by its key, not by listing.
  for (const { athleteId } of rollupKeys) {
    const rows = await db
      .listRows({ databaseId: D, tableId: "stats_rollups", queries: [Query.equal("athlete_id", athleteId), Query.limit(10)], ttl: 0 })
      .catch(() => ({ rows: [] as { $id: string }[] }));
    for (const row of rows.rows) await db.deleteRow({ databaseId: D, tableId: "stats_rollups", rowId: row.$id }).catch(() => {});
  }
  for (const u of [joey, sam, coach, stranger]) {
    await teams.delete({ teamId: circleTeamId(u.$id) }).catch(() => {});
    await users.delete({ userId: u.$id }).catch(() => {});
  }
}

const failed = results.filter((ok) => !ok).length;
console.log(
  failed === 0
    ? `\n${results.length}/${results.length} passed. Fixtures removed.`
    : `\n${failed} of ${results.length} FAILED.`,
);
process.exitCode = failed === 0 ? 0 : 1;
