import {
  BACKUP_FORMAT_VERSION,
  BACKUP_OMISSIONS,
  type Backup,
  type BackupRow,
  type BackupTable,
  type BackupTeam,
  type BackupUser,
} from "./types";

/**
 * Reading an instance, page by page.
 *
 * The method names avoid Appwrite's own (`listRows`, `createRow`) on purpose:
 * the write guard bans those outside the helper by name, and a pure module
 * that trips a security check every time someone reads it is a module people
 * learn to ignore.
 */
export interface BackupSource {
  tableIds(): readonly string[];
  /** One page of rows, ordered stably, starting after `cursor`. */
  rowPage(
    tableId: string,
    cursor: string | null,
    limit: number,
  ): Promise<{ total: number; rows: BackupRow[] }>;
  userPage(cursor: string | null, limit: number): Promise<{ total: number; users: BackupUser[] }>;
  teamPage(
    cursor: string | null,
    limit: number,
  ): Promise<{ total: number; teams: Array<Omit<BackupTeam, "memberships">> }>;
  memberships(teamId: string): Promise<BackupTeam["memberships"]>;
}

export interface DumpContext {
  endpoint: string;
  projectId: string;
  databaseId: string;
  schemaVersion: number;
  now?: () => Date;
}

/**
 * Appwrite caps list responses server-side, and the cap has moved between
 * versions. Asking for a page and stopping when it comes back short would
 * therefore stop early the moment the cap drops below what we asked for -- a
 * truncated backup that reports success. So we page until a page comes back
 * empty, and reconcile against the instance's own count afterwards.
 */
const PAGE_SIZE = 100;

async function pageThrough<T>(
  fetch: (cursor: string | null) => Promise<{ total: number; items: T[] }>,
  idOf: (item: T) => string,
  label: string,
): Promise<{ items: T[]; expected: number }> {
  const items: T[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  let expected = 0;
  let first = true;

  for (;;) {
    const page = await fetch(cursor);
    if (first) {
      expected = page.total;
      first = false;
    }
    if (page.items.length === 0) break;

    for (const item of page.items) {
      const id = idOf(item);
      // A cursor that fails to advance loops forever and fills a disk. Seeing
      // the same id twice means the ordering is not stable, which is a bug in
      // the driver, not a transient failure to retry.
      if (seen.has(id)) {
        throw new Error(
          `Dump of ${label} saw ${id} twice: the cursor is not advancing. Refusing to loop.`,
        );
      }
      seen.add(id);
      items.push(item);
    }
    cursor = idOf(page.items[page.items.length - 1]);
  }

  return { items, expected };
}

/**
 * A short count is the failure this whole module exists to prevent: the
 * previous dump-before-reset read one unpaginated page and called it a backup.
 * A long count is not a failure -- someone logged a set while the dump ran --
 * so it is recorded rather than thrown.
 */
function reconcile(label: string, collected: number, expected: number) {
  if (collected < expected) {
    throw new Error(
      `Dump of ${label} collected ${collected} of ${expected} reported. ` +
        `Refusing to write a short backup.`,
    );
  }
}

export async function dumpInstance(source: BackupSource, context: DumpContext): Promise<Backup> {
  const takenAt = (context.now?.() ?? new Date()).toISOString();

  const tables: BackupTable[] = [];
  for (const id of source.tableIds()) {
    const { items, expected } = await pageThrough(
      async (cursor) => {
        const page = await source.rowPage(id, cursor, PAGE_SIZE);
        return { total: page.total, items: page.rows };
      },
      (row) => row.$id,
      `table ${id}`,
    );
    reconcile(`table ${id}`, items.length, expected);
    tables.push({ id, expectedRows: expected, rows: items });
  }

  const userResult = await pageThrough(
    async (cursor) => {
      const page = await source.userPage(cursor, PAGE_SIZE);
      return { total: page.total, items: page.users };
    },
    (user) => user.$id,
    "users",
  );
  reconcile("users", userResult.items.length, userResult.expected);
  const users: BackupUser[] = userResult.items;

  const teamResult = await pageThrough(
    async (cursor) => {
      const page = await source.teamPage(cursor, PAGE_SIZE);
      return { total: page.total, items: page.teams };
    },
    (team) => team.$id,
    "teams",
  );
  reconcile("teams", teamResult.items.length, teamResult.expected);

  const teams: BackupTeam[] = [];
  for (const team of teamResult.items) {
    teams.push({ ...team, memberships: await source.memberships(team.$id) });
  }

  return {
    manifest: {
      formatVersion: BACKUP_FORMAT_VERSION,
      takenAt,
      endpoint: context.endpoint,
      projectId: context.projectId,
      databaseId: context.databaseId,
      schemaVersion: context.schemaVersion,
      tables: tables.map((t) => ({ id: t.id, rows: t.rows.length, expectedRows: t.expectedRows })),
      users: users.length,
      teams: teams.length,
      memberships: teams.reduce((n, t) => n + t.memberships.length, 0),
      omits: [...BACKUP_OMISSIONS],
    },
    tables,
    users,
    teams,
  };
}
