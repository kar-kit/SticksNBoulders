/**
 * The Appwrite half of backup and restore.
 *
 * Everything that knows how Appwrite spells things lives here; everything that
 * decides what a backup is lives in appwrite/backup. Same split as the schema
 * module, and for the same reason -- the logic is then testable without a
 * network, and this file stays small enough to read in one sitting.
 *
 * It sits in scripts/ rather than appwrite/ deliberately: row mutators are
 * banned outside the write helper, and the exemption for scripts exists
 * because a script runs with an API key and is reviewed as one. A restore is
 * exactly that. It replays permissions recorded in a dump rather than stamping
 * new ones, so it must not go near the policy.
 */
import { AppwriteException, Query, TablesDB, Teams, Users, type Models } from "node-appwrite";
import type { BackupSource } from "../appwrite/backup/dump";
import type { RestoreTarget, Outcome } from "../appwrite/backup/restore";
import type { BackupRow, BackupTeam, BackupUser } from "../appwrite/backup/types";

/** Rows carry Appwrite's own `$` fields; only id and permissions are restorable. */
function rowData(row: Models.DefaultRow): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith("$")));
}

function toBackupRow(row: Models.DefaultRow): BackupRow {
  return {
    $id: row.$id,
    $permissions: row.$permissions,
    $createdAt: row.$createdAt,
    $updatedAt: row.$updatedAt,
    data: rowData(row),
  };
}

/**
 * `ttl: 0` matters more than it looks. Appwrite caches list responses per
 * project, query and caller role, and a backup that reads a cached page is a
 * backup of what was true some minutes ago.
 */
function page(cursor: string | null, limit: number): string[] {
  const queries = [Query.orderAsc("$id"), Query.limit(limit)];
  if (cursor) queries.push(Query.cursorAfter(cursor));
  return queries;
}

export function appwriteSource(
  db: TablesDB,
  users: Users,
  teams: Teams,
  options: { databaseId: string; tableIds: readonly string[] },
): BackupSource {
  return {
    tableIds: () => options.tableIds,

    async rowPage(tableId, cursor, limit) {
      const result = await db.listRows({
        databaseId: options.databaseId,
        tableId,
        queries: page(cursor, limit),
        ttl: 0,
      });
      return { total: result.total, rows: result.rows.map(toBackupRow) };
    },

    async userPage(cursor, limit) {
      const result = await users.list({ queries: page(cursor, limit) });
      // Identities are fetched per user rather than in one list: the global
      // identity list carries provider access and refresh tokens, and the
      // narrowest query that answers "which providers did they link" is the
      // one least likely to put a token somewhere it does not belong.
      const mapped: BackupUser[] = [];
      for (const user of result.users) {
        const identities = await users.listIdentities({
          queries: [Query.equal("userId", user.$id), Query.limit(100)],
        });
        mapped.push({
          $id: user.$id,
          email: user.email || null,
          name: user.name,
          labels: user.labels ?? [],
          prefs: (user.prefs ?? {}) as Record<string, unknown>,
          emailVerification: user.emailVerification,
          status: user.status,
          registration: user.registration,
          providers: [...new Set(identities.identities.map((i) => i.provider))],
        });
      }
      return { total: result.total, users: mapped };
    },

    async teamPage(cursor, limit) {
      const result = await teams.list({ queries: page(cursor, limit) });
      return {
        total: result.total,
        teams: result.teams.map((team) => ({ $id: team.$id, name: team.name })),
      };
    },

    async memberships(teamId) {
      const result = await teams.listMemberships({ teamId, queries: [Query.limit(100)] });
      return result.memberships.map((m) => ({
        userId: m.userId,
        roles: m.roles,
        confirmed: m.confirm,
      }));
    },
  };
}

/** Appwrite's "already exists". A restore re-run must be boring, not fatal. */
const CONFLICT = 409;

async function createOrExisting(
  create: () => Promise<unknown>,
  onExisting?: () => Promise<unknown>,
): Promise<Outcome> {
  try {
    await create();
    return "created";
  } catch (error) {
    if (error instanceof AppwriteException && error.code === CONFLICT) {
      await onExisting?.();
      return "existed";
    }
    throw error;
  }
}

export function appwriteTarget(
  db: TablesDB,
  users: Users,
  teams: Teams,
  options: { databaseId: string },
): RestoreTarget {
  return {
    async ensureUser(user) {
      if (!user.email) {
        throw new Error(
          `User ${user.$id} has no email, so Appwrite cannot recreate the account. ` +
            `Restore the rest and recreate this one by hand.`,
        );
      }
      // Created without a password on purpose. The dump holds no hashes, so
      // the account exists and its owner takes it back through password reset
      // or their OAuth provider. See docs/backups.md.
      const outcome = await createOrExisting(() =>
        users.create({ userId: user.$id, email: user.email as string, name: user.name }),
      );
      if (outcome === "created") {
        if (Object.keys(user.prefs).length > 0) {
          await users.updatePrefs({ userId: user.$id, prefs: user.prefs });
        }
        if (user.labels.length > 0) {
          await users.updateLabels({ userId: user.$id, labels: user.labels });
        }
        if (user.emailVerification) {
          await users.updateEmailVerification({ userId: user.$id, emailVerification: true });
        }
        if (!user.status) await users.updateStatus({ userId: user.$id, status: false });
      }
      return outcome;
    },

    async ensureTeam(team: Omit<BackupTeam, "memberships">) {
      return createOrExisting(() => teams.create({ teamId: team.$id, name: team.name }));
    },

    async ensureMembership(teamId, membership) {
      // No url is passed, so Appwrite adds the member directly instead of
      // emailing an invitation. An invited-but-unconfirmed membership grants
      // no team read, which would restore a coach's access in name only.
      return createOrExisting(() =>
        teams.createMembership({ teamId, userId: membership.userId, roles: membership.roles }),
      );
    },

    async putRow(tableId, row) {
      return createOrExisting(() =>
        db.createRow({
          databaseId: options.databaseId,
          tableId,
          rowId: row.$id,
          data: row.data,
          permissions: row.$permissions,
        }),
      );
    },
  };
}
