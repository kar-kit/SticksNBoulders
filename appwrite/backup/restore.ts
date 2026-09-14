import type { Backup, BackupMembership, BackupRow, BackupTeam, BackupUser } from "./types";
import { BACKUP_FORMAT_VERSION } from "./types";

/**
 * Writing a dump back into an instance.
 *
 * Ordering is the whole problem. Appwrite validates a row's permissions when
 * the row is written, and those permissions name `user:<id>` and
 * `team:circle_<athlete>`. Restore rows first and you get, at best, rejected
 * writes -- at worst, rows carrying permissions that point at nothing, which
 * looks like a successful restore right up until a coach opens an empty
 * roster. So: users, then teams, then memberships, then rows. Never otherwise.
 */
export interface RestoreTarget {
  ensureUser(user: BackupUser): Promise<Outcome>;
  ensureTeam(team: Omit<BackupTeam, "memberships">): Promise<Outcome>;
  ensureMembership(teamId: string, membership: BackupMembership): Promise<Outcome>;
  /** Writes the row with its original id and permissions, both preserved. */
  putRow(tableId: string, row: BackupRow): Promise<Outcome>;
}

export type Outcome = "created" | "existed";

export interface RestoreReport {
  users: Tally;
  teams: Tally;
  memberships: Tally;
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

  if (backup.manifest.formatVersion !== BACKUP_FORMAT_VERSION) {
    problems.push({
      severity: "blocking",
      message:
        `Backup format v${backup.manifest.formatVersion}, this restore understands ` +
        `v${BACKUP_FORMAT_VERSION}.`,
    });
  }

  const userIds = new Set(backup.users.map((u) => u.$id));
  const teamIds = new Set(backup.teams.map((t) => t.$id));
  const missingUsers = new Set<string>();
  const missingTeams = new Set<string>();

  for (const table of backup.tables) {
    if (table.rows.length < table.expectedRows) {
      problems.push({
        severity: "blocking",
        message: `Table ${table.id} holds ${table.rows.length} rows but claims ${table.expectedRows}. Truncated dump.`,
      });
    }
    for (const row of table.rows) {
      if (row.$permissions.length === 0) {
        problems.push({
          severity: "warning",
          message: `${table.id}/${row.$id} has no permissions; only an API key will read it.`,
        });
      }
      for (const permission of row.$permissions) {
        const role = roleOf(permission);
        if (!role) {
          problems.push({
            severity: "blocking",
            message: `${table.id}/${row.$id} has an unparseable permission: ${permission}`,
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
    }
  }

  for (const id of missingUsers) {
    problems.push({
      severity: "blocking",
      message: `Rows grant read to user:${id}, who is not in this dump. Restoring would strand them.`,
    });
  }
  for (const id of missingTeams) {
    problems.push({
      severity: "blocking",
      message: `Rows grant read to team:${id}, which is not in this dump. Coaches would see nothing.`,
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

  const report: RestoreReport = { users: tally(), teams: tally(), memberships: tally(), rows: {} };

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

  // 4. Rows last, so the roles their permissions name already exist.
  for (const table of backup.tables) {
    onStep(`rows ${table.id} (${table.rows.length})`);
    const counts = (report.rows[table.id] ??= tally());
    for (const row of table.rows) record(counts, await target.putRow(table.id, row));
  }

  return report;
}
