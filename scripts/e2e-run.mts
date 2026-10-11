/**
 * Runs one e2e script with a crash net under it.
 *
 *   tsx scripts/e2e-run.mts scripts/e2e-lift.mts      (what `npm run e2e:*` does)
 *
 * Every e2e script cleans up after itself, but most create their accounts
 * before their own `try`, and ten have no `try` at all, so a throw in setup
 * (a missing seed, a rate limit, a network blip) strands the accounts and
 * every row they wrote. Rewriting all thirty scripts' setup is the
 * @playwright/test migration; this covers them all today.
 *
 * How: before the script loads, `Users.create` on node-appwrite (both its ESM
 * and CommonJS builds, since .ts helpers load as CommonJS) is wrapped to note
 * the id of every account the script creates with a fixture address. When the
 * script finishes -- passing, failing, throwing, or on Ctrl-C -- those
 * accounts go through the same locked purge as `e2e:prune` (scripts/e2e-purge.ts).
 * It is a no-op for accounts the script already removed, and it can only ever
 * reach accounts this process created: never another run's, never a real one.
 *
 * Accounts made by signing up through the browser (e2e:auth) are not seen
 * here; `e2e:prune` still finds them.
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import * as esm from "node-appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { isFixtureEmail } from "./e2e-fixture-scope";
import { formatReport, purgeFixtureUsers } from "./e2e-purge";

const target = process.argv[2];
if (!target) {
  console.error("Usage: tsx scripts/e2e-run.mts scripts/e2e-<name>.mts");
  process.exit(1);
}
// The script reads its own flags from argv as if it had been run directly.
process.argv.splice(2, 1);

const created = new Map<string, string>();
const cjs = createRequire(import.meta.url)("node-appwrite") as typeof esm;
for (const Users of new Set([esm.Users, cjs.Users])) {
  const original = Users.prototype.create;
  Users.prototype.create = async function (this: esm.Users, ...args: Parameters<typeof original>) {
    const user = await original.apply(this, args);
    if (user && isFixtureEmail(user.email)) created.set(user.$id, user.email);
    return user;
  } as typeof original;
}

let purging: Promise<void> | null = null;
const purge = () =>
  (purging ??= (async () => {
    if (created.size === 0) return;
    const config = serverAppwriteConfig();
    const targets = [...created].map(([$id, email]) => ({ $id, email }));
    const reports = await purgeFixtureUsers(createServerClient(config), config.databaseId, targets, { apply: true });
    // Silent when the script's own teardown already did the job.
    const leftovers = reports.filter((r) => Object.keys(r.removed).length || r.skipped.length || r.errors.length);
    if (leftovers.length === 0) return;
    console.log("\nCrash net: removed what the script left behind");
    for (const report of leftovers) for (const line of formatReport(report)) console.log(line);
  })().catch((error) => {
    console.error(`Crash net failed: ${String(error)}. Run npm run e2e:prune -- --yes --min-age-minutes 0.`);
  }));

process.once("SIGINT", () => {
  console.log("\nInterrupted: cleaning up this run's accounts...");
  void purge().finally(() => process.exit(130));
});

try {
  await import(pathToFileURL(resolve(target)).href);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await purge();
}
