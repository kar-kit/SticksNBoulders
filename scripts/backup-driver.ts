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
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { AppwriteException, Query, Storage, TablesDB, Teams, Users, type Models } from "node-appwrite";
import { InputFile } from "node-appwrite/file";
import type { BucketSource } from "../appwrite/backup/bucket";
import type { BackupSource } from "../appwrite/backup/dump";
import { blobPath } from "../appwrite/backup/files";
import type { RestoreTarget, Outcome } from "../appwrite/backup/restore";
import type { BackupRow, BackupTeam, BackupUser } from "../appwrite/backup/types";
import type { ClipStore } from "../appwrite/documents/clip-admin";

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

export interface BucketOptions {
  endpoint: string;
  projectId: string;
  apiKey: string;
  bucketIds: readonly string[];
}

/**
 * Files, read with the API key.
 *
 * Listed in Appwrite's default order with a cursor, not ordered by `$id` as
 * rows are: [Unverified] whether a file list accepts an order on `$id`, and
 * the default order is the internal sequence, which is stable. pageThrough
 * refuses to loop if it is not.
 */
export function appwriteBucketSource(storage: Storage, options: BucketOptions): BucketSource {
  return {
    bucketIds: () => options.bucketIds,

    async filePage(bucketId, cursor, limit) {
      const queries = [Query.limit(limit)];
      if (cursor) queries.push(Query.cursorAfter(cursor));
      const result = await storage.listFiles({ bucketId, queries });
      return {
        total: result.total,
        files: result.files.map((f) => ({
          $id: f.$id,
          bucketId: f.bucketId,
          $permissions: f.$permissions,
          $createdAt: f.$createdAt,
          $updatedAt: f.$updatedAt,
          name: f.name,
          mimeType: f.mimeType,
          sizeOriginal: f.sizeOriginal,
          chunksTotal: f.chunksTotal,
          chunksUploaded: f.chunksUploaded,
        })),
      };
    },

    /**
     * Streamed, not `storage.getFileDownload`: the SDK buffers the whole file
     * into an ArrayBuffer, and a 200MB clip in memory per download is the kind
     * of thing that works in testing and falls over on the real bucket.
     *
     * The key goes in a header and nowhere else. Errors name the file and the
     * status, never the request.
     */
    async download(bucketId, fileId) {
      const url =
        `${options.endpoint}/storage/buckets/${encodeURIComponent(bucketId)}` +
        `/files/${encodeURIComponent(fileId)}/download`;
      const response = await fetch(url, {
        headers: {
          "x-appwrite-project": options.projectId,
          "x-appwrite-key": options.apiKey,
          // The bytes as stored, so the size check compares like with like.
          "accept-encoding": "identity",
        },
        cache: "no-store",
      });
      if (response.status === 404) return null;
      if (!response.ok || !response.body) {
        throw new Error(`Download of ${bucketId}/${fileId} failed: HTTP ${response.status}.`);
      }
      return Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>);
    },
  };
}

/** The write helper's view of storage, for the orphan sweep. */
export function appwriteClipStore(storage: Storage): ClipStore {
  return { deleteFile: (params) => storage.deleteFile(params) };
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
  options: {
    databaseId: string;
    /** Both needed to restore files. A rows-only restore can leave them out. */
    storage?: Storage;
    fileStore?: string;
  },
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

    async ensureFile(file) {
      if (!options.storage || !options.fileStore) {
        throw new Error(`Restoring ${file.bucketId}/${file.$id} needs a Storage client and a file store.`);
      }
      const storage = options.storage;
      const path = blobPath(options.fileStore, file.bucketId, file.$id);
      // Replays the permissions the dump recorded, as putRow does for rows.
      // The SDK chunks anything over 5MB itself.
      return createOrExisting(() =>
        storage.createFile({
          bucketId: file.bucketId,
          fileId: file.$id,
          file: InputFile.fromPath(path, file.name),
          permissions: file.$permissions,
        }),
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
