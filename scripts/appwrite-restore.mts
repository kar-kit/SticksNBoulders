/**
 * Replays a dump into an instance.
 *
 *   npm run appwrite:restore -- .appwrite-backup/2026-09-14T03-00-00-000Z
 *   npm run appwrite:restore -- <dir> --yes
 *
 * Plans by default and writes nothing, the same contract as appwrite:reset.
 *
 * Run npm run appwrite:setup first: this restores rows, not the schema. The
 * schema is code and belongs to the setup script; a dump that also carried
 * table definitions would give the two a chance to disagree.
 */
import { TablesDB, Teams, Users } from "node-appwrite";
import { createServerClient } from "../appwrite/server-client";
import { serverAppwriteConfig } from "../appwrite/env";
import { dedupeSdkWarnings } from "../appwrite/dedupe-sdk-warning";
import { readBackup } from "../appwrite/backup/files";
import { describeRestore, restoreBackup, validateBackup } from "../appwrite/backup/restore";
import { appwriteTarget } from "./backup-driver";

dedupeSdkWarnings();

const args = process.argv.slice(2);
const confirmed = args.includes("--yes");
const dir = args.find((a) => !a.startsWith("--"));

if (!dir) {
  console.error("Usage: npm run appwrite:restore -- <backup-dir> [--yes]");
  process.exit(1);
}

const config = serverAppwriteConfig();
const backup = await readBackup(dir);

console.log(`${confirmed ? "Restoring" : "Planning restore of"} ${dir}`);
console.log(`  taken ${backup.manifest.takenAt} from ${backup.manifest.endpoint}`);
console.log(`  into  ${config.endpoint}, project ${config.projectId}\n`);

if (backup.manifest.projectId !== config.projectId) {
  // Not fatal: restoring into a fresh project is a legitimate migration, and
  // is how this dump reaches Cloud in January. Worth saying out loud, though.
  console.log(`  note: this dump came from project ${backup.manifest.projectId}\n`);
}

console.log(describeRestore(backup).join("\n"));

const problems = validateBackup(backup);
if (problems.length > 0) {
  console.log("");
  for (const problem of problems) {
    console.log(`  ${problem.severity === "blocking" ? "BLOCKING" : "warning "}  ${problem.message}`);
  }
}
if (problems.some((p) => p.severity === "blocking")) {
  console.error("\nThis backup cannot be restored. Nothing was written.");
  process.exit(1);
}

if (!confirmed) {
  console.log("\nNothing written. Re-run with --yes to apply.");
  console.log("Run npm run appwrite:setup first if the schema is not already there.");
  process.exit(0);
}

console.log("");
const client = createServerClient(config);
const target = appwriteTarget(new TablesDB(client), new Users(client), new Teams(client), {
  databaseId: config.databaseId,
});

const report = await restoreBackup(target, backup, (step) => console.log(`  ${step}`));

console.log("");
const line = (label: string, t: { created: number; existed: number }) =>
  console.log(`  ${label.padEnd(22)} ${t.created} created, ${t.existed} already there`);
line("users", report.users);
line("teams", report.teams);
line("memberships", report.memberships);
for (const [table, counts] of Object.entries(report.rows)) line(table, counts);

console.log("\nDone. Restored accounts have no password: their owners sign in");
console.log("through password reset or their OAuth provider. See docs/backups.md.");
