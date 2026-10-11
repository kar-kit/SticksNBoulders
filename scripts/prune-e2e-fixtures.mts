/**
 * Removes abandoned e2e fixture accounts and everything they wrote.
 *
 *   npm run e2e:prune                               # report only
 *   npm run e2e:prune -- --yes                      # actually delete
 *   npm run e2e:prune -- --yes --min-age-minutes 0  # include fixtures from a run still going
 *
 * Every e2e script creates a throwaway user at `<tag>-<stamp>@example.com` (or
 * `@sticksnboulders.test`), writes rows as them, and removes both on the way
 * out. A run that dies in the middle -- a Playwright timeout, a killed
 * terminal -- skips the teardown and strands the account.
 *
 * That is worse than untidy. The rows keep a circle-team read permission, the
 * circle team itself may already be gone, and `appwrite:backup` then refuses
 * its own dump: rows granting a team the dump does not contain would restore
 * invisible to the coach. So one interrupted test run leaves the instance with
 * no valid backup, which is the opposite of the day-one commitment in
 * CLAUDE.md. It happened twice on 14 Sep 2026.
 *
 * Safety, in full in scripts/e2e-fixture-scope.ts. In short: an account is a
 * fixture only if its address is `<tag>-<13-digit stamp>` at a reserved test
 * domain AND it was created within a day of that stamp. A row or file is
 * deleted only if every person it names and every principal it grants is a
 * fixture. Anything else is reported as SKIPPED and left exactly as it is.
 *
 * Fixtures younger than --min-age-minutes (default 120) are left alone, so a
 * prune never pulls the rug from under a suite running in another worktree.
 */
import { Query, Users } from "node-appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
import { isFixtureUser } from "./e2e-fixture-scope";
import { formatReport, purgeFixtureUsers } from "./e2e-purge";

dedupeSdkWarnings();

const args = process.argv.slice(2);
const KNOWN = new Set(["--yes", "--min-age-minutes"]);
for (const [i, arg] of args.entries()) {
  // A mistyped --yes must not quietly become a report that looks like a run.
  if (arg.startsWith("--") && !KNOWN.has(arg)) {
    console.error(`Unknown option ${arg}.`);
    process.exit(1);
  }
  if (!arg.startsWith("--") && args[i - 1] !== "--min-age-minutes") {
    console.error(`Unexpected argument ${arg}.`);
    process.exit(1);
  }
}
const apply = args.includes("--yes");
const ageAt = args.indexOf("--min-age-minutes");
const minAgeMinutes = ageAt === -1 ? 120 : Number(args[ageAt + 1]);
if (!Number.isFinite(minAgeMinutes) || minAgeMinutes < 0) {
  console.error("--min-age-minutes needs a number of minutes, 0 or more.");
  process.exit(1);
}

const config = serverAppwriteConfig();
const client = createServerClient(config);
const users = new Users(client);

const allUsers = async () => {
  const found: Array<{ $id: string; email: string; name: string; $createdAt: string }> = [];
  // Offset paging is safe here: the list is read in full before anything is
  // deleted, so nothing shifts underneath it.
  for (let offset = 0; ; offset += 100) {
    const page = await users.list({ queries: [Query.limit(100), Query.offset(offset)] });
    found.push(...page.users.map((u) => ({ $id: u.$id, email: u.email, name: u.name, $createdAt: u.$createdAt })));
    if (page.users.length < 100) break;
  }
  return found;
};

const everyone = await allUsers();
const fixtures = everyone.filter((u) => isFixtureUser(u));
const cutoff = Date.now() - minAgeMinutes * 60_000;
const settled = fixtures.filter((u) => Date.parse(u.$createdAt) <= cutoff);
const young = fixtures.length - settled.length;

console.log(`${config.endpoint}, database ${config.databaseId}`);
console.log(`${everyone.length} account(s); ${everyone.length - fixtures.length} are not fixtures and are never touched.`);
if (young) console.log(`${young} fixture(s) younger than ${minAgeMinutes} min left alone: a run may still be using them.`);

if (settled.length === 0) {
  console.log("No abandoned e2e fixture accounts. Nothing to prune.");
  process.exit(0);
}

console.log(`\n${apply ? "Pruning" : "Would prune"} ${settled.length} fixture account(s):\n`);
const reports = await purgeFixtureUsers(client, config.databaseId, settled, { apply });
for (const report of reports) for (const line of formatReport(report)) console.log(line);

const total = reports.reduce((n, r) => n + Object.values(r.removed).reduce((a, b) => a + b, 0), 0);
const held = reports.filter((r) => r.skipped.length || r.errors.length).length;
console.log(
  apply
    ? `\nRemoved ${reports.filter((r) => r.accountRemoved).length} account(s) and ${total} row(s)/file(s).` +
        (held ? ` ${held} account(s) kept: see SKIPPED/ERROR above.` : "") +
        " Run npm run appwrite:backup to confirm the dump validates."
    : `\n${total} row(s)/file(s) across ${settled.length} account(s). Re-run with --yes to delete.`,
);
if (apply && held) process.exitCode = 1;
