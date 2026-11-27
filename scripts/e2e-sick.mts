/**
 * Drives calling in sick against the live instance (F31).
 *
 *   npm run e2e:sick
 *
 * Needs schema v27 applied (`npm run appwrite:setup`): it writes `sick_days`.
 * Throwaway users only, removed at the end by the script and by
 * scripts/e2e-run.mts's crash net. Point it at dev.
 *
 * What is worth proving here, against real permissions rather than the unit
 * suite's fakes:
 *
 *   - the athlete calls in through the write helper, and their linked coach
 *     reads it with its dates and note -- the Roster's marker is this read;
 *   - an unlinked coach, and a stranger, read nothing;
 *   - the coach can neither rewrite nor clear it;
 *   - "I'm better" shortens it, and "never mind" deletes it, as the athlete,
 *     and the coach's next read says so;
 *   - a call-in written in the athlete's name by somebody else carries no
 *     proof of authorship, so the reader drops it -- the guard that keeps a
 *     stranger from putting an athlete off sick on the Roster;
 *   - a coach removed from the circle stops reading it.
 *
 * It does not prove the push (that needs a real device and VAPID keys) or the
 * missed-session maths (pure, unit tested).
 */
import { Query, TablesDB, Teams, Users } from "node-appwrite";
import { Client as WebClient, TablesDB as WebTablesDB } from "appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
import { ensureCircle, addCoachToCircle, removeCoachFromCircle } from "../appwrite/documents/circle-admin";
import { circleTeamId } from "../appwrite/documents/circle";
import { authenticRows, callInSick, endSick, type RowWriter } from "../appwrite/documents";
import { readableByAnySession } from "../appwrite/documents/policy";
import { addDays, localDay } from "../lib/programming/program";
import { planEnd, sickNow, toSpell } from "../lib/sick/sick";

dedupeSdkWarnings();

const config = serverAppwriteConfig();
const admin = createServerClient(config);
const users = new Users(admin);
const teams = new Teams(admin);
const adminDb = new TablesDB(admin);
const db = config.databaseId;
const stamp = Date.now();

const results: boolean[] = [];
const check = (label: string, ok: boolean, detail = "") => {
  results.push(ok);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

const asUser = (secret: string) => {
  const client = new WebClient().setEndpoint(config.endpoint).setProject(config.projectId);
  client.setSession(secret);
  return new WebTablesDB(client);
};

/** The browser's writer, on a signed-in session: what the offline queue's runner uses. */
const writerFor = (tables: WebTablesDB): RowWriter => ({
  createRow: (params) => tables.createRow(params),
  updateRow: (params) => tables.updateRow(params),
  deleteRow: (params) => tables.deleteRow(params),
});

const mkUser = async (tag: string, name: string) =>
  users.create({
    userId: `e2esk${tag}${stamp}`,
    email: `e2e-sick-${tag}-${stamp}@sticksnboulders.test`,
    password: `Pw-${stamp}-${tag}A1!`,
    name,
  });

const athlete = await mkUser("a", "Sick Athlete");
const coach = await mkUser("c", "Sick Coach");
const unlinked = await mkUser("u", "Sick Unlinked Coach");
const stranger = await mkUser("s", "Sick Stranger");

const today = localDay();
const written: string[] = [];
let failure: unknown = null;

try {
  await ensureCircle(teams, athlete.$id, "Sick Athlete");
  await addCoachToCircle(teams, athlete.$id, coach.$id);

  const athleteDb = asUser((await users.createSession({ userId: athlete.$id })).secret);
  const coachDb = asUser((await users.createSession({ userId: coach.$id })).secret);
  const unlinkedDb = asUser((await users.createSession({ userId: unlinked.$id })).secret);
  const strangerDb = asUser((await users.createSession({ userId: stranger.$id })).secret);

  const deps = { writer: writerFor(athleteDb), databaseId: db, newId: () => "", now: () => new Date() };
  const actor = { userId: athlete.$id };

  /** What the Roster and Athlete View read, as the app reads it, then filters. */
  const read = async (tables: WebTablesDB) => {
    const page = await tables.listRows({
      databaseId: db,
      tableId: "sick_days",
      queries: [Query.equal("athlete_id", athlete.$id), Query.greaterThanEqual("ends_on", today), Query.orderAsc("ends_on"), Query.limit(100)],
    });
    return authenticRows("sick_days", page.rows).flatMap((row) => toSpell(row as unknown as Record<string, unknown>) ?? []);
  };

  // --- the athlete calls in ---------------------------------------------
  const sickId = `sk-e2e-${stamp}`;
  let called = true;
  let callError = "";
  try {
    await callInSick(deps, actor, { sickId, startsOn: today, endsOn: addDays(today, 2), note: "Flu, back Friday" });
    written.push(sickId);
  } catch (error) {
    called = false;
    callError = (error as Error).message;
  }
  check("an athlete calls in sick, through the write helper", called, callError);

  let again = true;
  try {
    await callInSick(deps, actor, { sickId, startsOn: today, endsOn: addDays(today, 2), note: "Flu, back Friday" });
  } catch {
    again = false;
  }
  check("a retry of the same call-in is refused as a duplicate, which the queue reads as done", !again);

  // --- the read that is the feature -------------------------------------
  const seen = await read(coachDb);
  check("their linked coach reads it", seen.length === 1, `${seen.length} rows`);
  check(
    "with its dates and its note",
    seen[0]?.startsOn === today && seen[0]?.endsOn === addDays(today, 2) && seen[0]?.note === "Flu, back Friday",
    JSON.stringify(seen[0] ?? null),
  );
  check("and the Roster would mark them sick today", sickNow(seen, today)?.endsOn === addDays(today, 2));

  check("an unlinked coach reads nothing", (await read(unlinkedDb)).length === 0);
  check("a stranger reads nothing", (await read(strangerDb)).length === 0);

  // --- the coach cannot touch it ----------------------------------------
  let coachEdited = true;
  try {
    await coachDb.updateRow({ databaseId: db, tableId: "sick_days", rowId: sickId, data: { note: "Hijacked" } });
  } catch {
    coachEdited = false;
  }
  check("the coach cannot rewrite what the athlete said", !coachEdited);
  let coachDeleted = true;
  try {
    await coachDb.deleteRow({ databaseId: db, tableId: "sick_days", rowId: sickId });
  } catch {
    coachDeleted = false;
  }
  check("or clear it", !coachDeleted);

  // --- a call-in in the athlete's name by somebody else -----------------
  const forgedId = `sk-forged-${stamp}`;
  let forgedWrote = true;
  try {
    await strangerDb.createRow({
      databaseId: db,
      tableId: "sick_days",
      rowId: forgedId,
      data: { athlete_id: athlete.$id, starts_on: today, ends_on: addDays(today, 5), note: "Forged", created_at: new Date().toISOString(), client_sick_id: forgedId },
      permissions: [readableByAnySession()],
    });
    written.push(forgedId);
  } catch {
    forgedWrote = false;
  }
  // Appwrite may take or refuse it (the table allows any session to create).
  // Either way the coach must not read it as the athlete's.
  const afterForgery = await read(coachDb);
  check(
    `a call-in forged in the athlete's name (${forgedWrote ? "accepted by Appwrite" : "refused"}) is never read as theirs`,
    afterForgery.every((s) => s.id !== forgedId) && afterForgery.length === 1,
    `${afterForgery.length} rows`,
  );

  // --- "I'm better" and "never mind" ------------------------------------
  const [shorten] = planEnd(seen, addDays(today, 1));
  check("ending it tomorrow plans to shorten it to today", shorten?.endsOn === today, JSON.stringify(shorten));
  await endSick(deps, actor, { sickId, endsOn: shorten.endsOn });
  const shortened = await read(coachDb);
  check("the athlete shortens it, and the coach reads the new last day", shortened[0]?.endsOn === today, shortened[0]?.endsOn ?? "none");

  const [cancel] = planEnd(shortened, today);
  check("ending it today deletes it, there being nothing left to keep", cancel?.endsOn === null);
  await endSick(deps, actor, { sickId, endsOn: null });
  check("the athlete cancels it, and the coach reads nothing", (await read(coachDb)).length === 0);

  // --- revocation --------------------------------------------------------
  await callInSick(deps, actor, { sickId: `sk-b-${stamp}`, startsOn: today, endsOn: today, note: null });
  written.push(`sk-b-${stamp}`);
  check("a second call-in is read by the coach", (await read(coachDb)).length === 1);
  await removeCoachFromCircle(teams, athlete.$id, coach.$id);
  check("a coach removed from the circle stops reading it", (await read(coachDb)).length === 0);
} catch (error) {
  failure = error;
  check("ran without throwing", false, String(error));
} finally {
  for (const rowId of written) {
    await adminDb.deleteRow({ databaseId: db, tableId: "sick_days", rowId }).catch(() => {});
  }
  await teams.delete({ teamId: circleTeamId(athlete.$id) }).catch(() => {});
  for (const id of [athlete.$id, coach.$id, unlinked.$id, stranger.$id]) {
    await users.delete({ userId: id }).catch(() => {});
  }
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
// exitCode, not exit(): scripts/e2e-run.mts still has to run its crash net.
if (failed > 0 || failure) process.exitCode = 1;
