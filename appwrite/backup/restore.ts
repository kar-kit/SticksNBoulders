import type { Backup, BackupFile, BackupMembership, BackupRow, BackupTeam, BackupUser } from "./types";
import { READABLE_FORMAT_VERSIONS } from "./types";
import { APPWRITE_ID, fileKey } from "./bucket";
import { referencesIn } from "./orphans";

/**
 * Writing a dump back into an instance.
 *
 * Ordering is the whole problem. Appwrite validates a row's permissions when
 * the row is written, and those permissions name `user:<id>` and
 * `team:circle_<athlete>`. Restore rows first and you get, at best, rejected
 * writes -- at worst, rows carrying permissions that point at nothing, which
 * looks like a successful restore right up until a coach opens an empty
 * roster. So: users, then teams, then memberships, then files, then rows.
 * Never otherwise. Files sit where they do for both halves of the same
 * reason: their permissions name the same users and circles, and a set row
 * names its file.
 */
export interface RestoreTarget {
  ensureUser(user: BackupUser): Promise<Outcome>;
  ensureTeam(team: Omit<BackupTeam, "memberships">): Promise<Outcome>;
  ensureMembership(teamId: string, membership: BackupMembership): Promise<Outcome>;
  /** Uploads the stored copy with its original id and permissions. */
  ensureFile(file: BackupFile): Promise<Outcome>;
  /** Writes the row with its original id and permissions, both preserved. */
  putRow(tableId: string, row: BackupRow): Promise<Outcome>;
}

export type Outcome = "created" | "existed";

export interface RestoreReport {
  users: Tally;
  teams: Tally;
  memberships: Tally;
  files: Tally;
  rows: Record<string, Tally>;
}

export interface Tally {
  created: number;
  existed: number;
}

const tally = (): Tally => ({ created: 0, existed: 0 });
const record = (into: Tally, outcome: Outcome) => {
  if (outcome === "created") into.created += 1;
  else into.existed += 1;
};

/**
 * The role named inside a permission string. A read permission for the circle
 * team yields team:circle_x, a read for the athlete yields user:joey.
 *
 * Spelled out rather than quoted because the write guard bans permission
 * literals outside the policy, and it is right to: a permission assembled
 * anywhere else is one nobody reviews again. This module only ever reads them.
 */
function roleOf(permission: string): string | null {
  const match = /^[a-z]+\(\s*"?([^"')]+)"?\s*\)$/.exec(permission.trim());
  return match ? match[1] : null;
}

export interface Problem {
  severity: "blocking" | "warning";
  message: string;
}

/**
 * What is wrong with this dump before anything is written.
 *
 * The check that earns its keep: every `user:` and `team:` a row's permissions
 * name must exist in the dump. A backup that fails this restores rows nobody
 * can read, and nothing downstream would notice -- the rows are all there, the
 * counts all match, and the coach's screen is simply empty.
 */
export function validateBackup(backup: Backup): Problem[] {
  const problems: Problem[] = [];

  const version = backup.manifest.formatVersion;
  if (!READABLE_FORMAT_VERSIONS.includes(version)) {
    problems.push({
      severity: "blocking",
      message:
        `Backup format v${version}, this restore understands ` +
        `v${READABLE_FORMAT_VERSIONS.join(" and v")}.`,
    });
  }

  const userIds = new Set(backup.users.map((u) => u.$id));
  const teamIds = new Set(backup.teams.map((t) => t.$id));
  const missingUsers = new Set<string>();
  const missingTeams = new Set<string>();

  // Rows and files carry permissions in the same shape and need the same
  // check: every role they name must be restored before they are.
  const checkPermissions = (label: string, permissions: string[]) => {
    if (permissions.length === 0) {
      problems.push({
        severity: "warning",
        message: `${label} has no permissions; only an API key will read it.`,
      });
    }
    for (const permission of permissions) {
      const role = roleOf(permission);
      if (!role) {
        problems.push({
          severity: "blocking",
          message: `${label} has an unparseable permission: ${permission}`,
        });
        continue;
      }
      if (role.startsWith("user:") && !userIds.has(role.slice(5))) missingUsers.add(role.slice(5));
      if (role.startsWith("team:")) {
        // `team:id/role` is legal Appwrite; the circle model does not use it,
        // but a dump is not the place to be surprised by one.
        const id = role.slice(5).split("/")[0];
        if (!teamIds.has(id)) missingTeams.add(id);
      }
    }
  };

  for (const table of backup.tables) {
    if (table.rows.length < table.expectedRows) {
      problems.push({
        severity: "blocking",
        message: `Table ${table.id} holds ${table.rows.length} rows but claims ${table.expectedRows}. Truncated dump.`,
      });
    }
    for (const row of table.rows) checkPermissions(`${table.id}/${row.$id}`, row.$permissions);
  }

  for (const file of backup.files) {
    // The id becomes a path into the file store. Anything else is an edited
    // dump, and a restore should not be the thing that discovers what `..`
    // resolves to.
    if (!APPWRITE_ID.test(file.bucketId) || !APPWRITE_ID.test(file.$id)) {
      problems.push({
        severity: "blocking",
        message: `${JSON.stringify(fileKey(file.bucketId, file.$id))} is not an Appwrite id pair.`,
      });
      continue;
    }
    checkPermissions(`file ${fileKey(file.bucketId, file.$id)}`, file.$permissions);
  }

  for (const bucket of backup.manifest.buckets) {
    const held = backup.files.filter((f) => f.bucketId === bucket.id).length;
    if (held < bucket.files) {
      problems.push({
        severity: "blocking",
        message: `Bucket ${bucket.id} lists ${held} files but the manifest claims ${bucket.files}. Truncated dump.`,
      });
    }
  }

  // A set naming a clip the dump does not hold restores as a broken player.
  // A warning, not a refusal: it is also what a clip deleted mid-dump looks
  // like, and the rest of the set is still worth having.
  if (version >= 2) {
    const held = new Set(backup.files.map((f) => fileKey(f.bucketId, f.$id)));
    for (const table of backup.tables) {
      for (const ref of referencesIn(table.id, table.rows)) {
        if (!held.has(fileKey(ref.bucketId, ref.fileId))) {
          problems.push({
            severity: "warning",
            message: `${ref.tableId}/${ref.rowId} points at clip ${ref.fileId}, which this dump does not hold.`,
          });
        }
      }
    }
  } else {
    problems.push({
      severity: "warning",
      message: `A v${version} dump predates file backups. Sets restore with their clip ids, not their clips.`,
    });
  }

  for (const id of missingUsers) {
    problems.push({
      severity: "blocking",
      message: `Rows or files grant read to user:${id}, who is not in this dump. Restoring would strand them.`,
    });
  }
  for (const id of missingTeams) {
    problems.push({
      severity: "blocking",
      message: `Rows or files grant read to team:${id}, which is not in this dump. Coaches would see nothing.`,
    });
  }

  for (const team of backup.teams) {
    for (const membership of team.memberships) {
      if (!userIds.has(membership.userId)) {
        problems.push({
          severity: "blocking",
          message: `Team ${team.$id} has a membership for ${membership.userId}, who is not in this dump.`,
        });
      }
      if (!membership.confirmed) {
        // An unconfirmed membership grants no team read at all, so it would
        // restore as access that silently is not there.
        problems.push({
          severity: "warning",
          message: `Membership of ${membership.userId} in ${team.$id} was unconfirmed when dumped.`,
        });
      }
    }
  }

  return problems;
}

export function describeRestore(backup: Backup): string[] {
  return [
    `  users        ${backup.users.length}`,
    `  teams        ${backup.teams.length}`,
    `  memberships  ${backup.manifest.memberships}`,
    `  files        ${backup.files.length} (${backup.files.reduce((n, f) => n + f.sizeOriginal, 0)} bytes)`,
    ...backup.tables.map((t) => `  table        ${t.id.padEnd(22)} ${t.rows.length} row(s)`),
  ];
}

export async function restoreBackup(
  target: RestoreTarget,
  backup: Backup,
  onStep: (message: string) => void = () => {},
): Promise<RestoreReport> {
  const blocking = validateBackup(backup).filter((p) => p.severity === "blocking");
  if (blocking.length > 0) {
    throw new Error(
      `Refusing to restore an invalid backup:\n${blocking.map((p) => `  - ${p.message}`).join("\n")}`,
    );
  }

  const report: RestoreReport = {
    users: tally(),
    teams: tally(),
    memberships: tally(),
    files: tally(),
    rows: {},
  };

  // 1. Identities. Every permission below names one.
  onStep(`users (${backup.users.length})`);
  for (const user of backup.users) record(report.users, await target.ensureUser(user));

  // 2. Circles, then 3. memberships -- a team with no members grants nothing.
  onStep(`teams (${backup.teams.length})`);
  for (const team of backup.teams) {
    record(report.teams, await target.ensureTeam({ $id: team.$id, name: team.name }));
  }
  onStep(`memberships (${backup.manifest.memberships})`);
  for (const team of backup.teams) {
    for (const membership of team.memberships) {
      record(report.memberships, await target.ensureMembership(team.$id, membership));
    }
  }

  // 4. Files, whose permissions name the same roles rows do, and which the
  // sets about to be written point at.
  onStep(`files (${backup.files.length})`);
  for (const file of backup.files) record(report.files, await target.ensureFile(file));

  // 5. Rows last, so the roles their permissions name already exist.
  for (const table of backup.tables) {
    onStep(`rows ${table.id} (${table.rows.length})`);
    const counts = (report.rows[table.id] ??= tally());
    for (const row of table.rows) record(counts, await target.putRow(table.id, row));
  }

  return report;
}
