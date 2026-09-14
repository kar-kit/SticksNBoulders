/**
 * Removes abandoned e2e fixture accounts and everything they wrote.
 *
 *   npm run e2e:prune            # report only
 *   npm run e2e:prune -- --yes   # actually delete
 *
 * Every e2e script creates a throwaway user at `<tag>-<stamp>@example.com`,
 * writes rows as them, and removes both on the way out. A run that dies in the
 * middle -- a Playwright timeout, a killed terminal -- skips the teardown and
 * strands the account.
 *
 * That is worse than untidy. The rows keep a circle-team read permission, the
 * circle team itself may already be gone, and `appwrite:backup` then refuses
 * its own dump: rows granting a team the dump does not contain would restore
 * invisible to the coach. So one interrupted test run leaves the instance with
 * no valid backup, which is the opposite of the day-one commitment in
 * CLAUDE.md. It happened twice on 14 Sep 2026.
 *
 * Safety: an account is a fixture only if its email is under `example.com`,
 * which RFC 2606 reserves for exactly this and which no real athlete can hold.
 * Nothing else is a signal -- not the name, not the age of the row.
 */
import { Query, TablesDB, Teams, Users } from "node-appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
import { circleTeamId } from "../appwrite/documents/circle";
import { schema } from "../appwrite/schema";

dedupeSdkWarnings();

const apply = process.argv.includes("--yes");
const config = serverAppwriteConfig();
const client = createServerClient(config);
const db = new TablesDB(client);
const users = new Users(client);
const teams = new Teams(client);
const D = config.databaseId;

/** The column naming the owner, per table. Tables without one are untouched. */
const OWNER_COLUMN: Record<string, string | undefined> = {
  profiles: "user_id",
  sessions: "athlete_id",
  sets: "athlete_id",
  stats_rollups: "athlete_id",
  invite_codes: "coach_id",
  exercises: "owner_id",
  coach_athlete_links: "athlete_id",
};

const FIXTURE = /@example\.com$/i;

const allUsers = async () => {
  const found: Array<{ $id: string; email: string; name: string }> = [];
  for (let offset = 0; ; offset += 100) {
    const page = await users.list({ queries: [Query.limit(100), Query.offset(offset)] });
    found.push(...page.users.map((u) => ({ $id: u.$id, email: u.email, name: u.name })));
    if (page.users.length < 100) break;
  }
  return found;
};

const fixtures = (await allUsers()).filter((u) => FIXTURE.test(u.email));

if (fixtures.length === 0) {
  console.log("No e2e fixture accounts on the instance. Nothing to prune.");
  process.exit(0);
}

console.log(`${apply ? "Pruning" : "Would prune"} ${fixtures.length} fixture account(s):\n`);

let rowTotal = 0;
for (const user of fixtures) {
  const lines: string[] = [];
  for (const table of schema.tables) {
    const column = OWNER_COLUMN[table.id];
    if (!column) continue;
    const page = await db.listRows({
      databaseId: D,
      tableId: table.id,
      queries: [Query.equal(column, user.$id), Query.limit(100)],
      ttl: 0,
    });
    if (page.rows.length === 0) continue;
    rowTotal += page.rows.length;
    lines.push(`    ${page.rows.length} in ${table.id}`);
    if (!apply) continue;
    for (const row of page.rows) {
      await db.deleteRow({ databaseId: D, tableId: table.id, rowId: String(row.$id) });
    }
  }

  console.log(`  ${user.email}  "${user.name}"  ${user.$id}`);
  for (const line of lines) console.log(line);
  if (lines.length === 0) console.log("    no rows");

  if (apply) {
    // The circle first: a team outliving its athlete is what makes the rows
    // that referenced it unrestorable.
    await teams.delete({ teamId: circleTeamId(user.$id) }).catch(() => {});
    await users.delete({ userId: user.$id });
  }
}

console.log(
  apply
    ? `\nRemoved ${fixtures.length} account(s) and ${rowTotal} row(s). Run npm run appwrite:backup to confirm the dump validates.`
    : `\n${rowTotal} row(s) across ${fixtures.length} account(s). Re-run with --yes to delete.`,
);
