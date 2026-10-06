/**
 * Applies the schema. One command, idempotent, safe to re-run.
 *
 *   npm run appwrite:setup -- --dry-run
 *   npm run appwrite:setup
 *
 * Never click a collection into existence in the console: the schema only
 * exists in a database we plan to migrate off.
 */
import { Teams } from "node-appwrite";
import { createAppwriteDriver } from "../appwrite/schema/appwrite-driver";
import { ensureLibraryTeam } from "../appwrite/documents";
import { applySchema } from "../appwrite/schema/execute";
import { schema } from "../appwrite/schema";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";

const dryRun = process.argv.includes("--dry-run");

dedupeSdkWarnings();

const config = serverAppwriteConfig();
console.log(`${dryRun ? "Planning" : "Applying"} schema v${schema.version} -> ${config.endpoint}`);
console.log(`  database: ${schema.id}  tables: ${schema.tables.length}\n`);

const client = createServerClient(config);
const driver = createAppwriteDriver(client);
const result = await applySchema(driver, schema, { dryRun, log: (m) => console.log(m) });

// Not a table, but infrastructure the permission model rests on all the same:
// the team whose role is the server's mark on a library exercise. It has to
// exist before anyone else can create one and own it. See library-admin.ts.
if (!dryRun) {
  const teamId = await ensureLibraryTeam(new Teams(client));
  console.log(`  team "${teamId}" exists (the server's mark; must stay empty)`);
}

console.log("");
if (result.noop) {
  console.log("Schema already matches. Nothing to do.");
} else if (dryRun) {
  console.log("Dry run. Re-run without --dry-run to apply.");
} else {
  console.log(`Applied ${result.applied.length} change(s).`);
}

if (result.reported.length > 0) {
  console.log(
    `\n${result.reported.length} item(s) need a human. Orphans and column changes are never applied automatically:` +
      ` a width or type change can truncate an athlete's logged work.`,
  );
  process.exitCode = dryRun ? 0 : 1;
}
