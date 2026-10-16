/**
 * Deletes e2e fixture accounts and everything they wrote, under the three
 * locks in scripts/e2e-fixture-scope.ts.
 *
 * Used by `e2e:prune` (every stranded fixture on the instance) and by the
 * e2e runner's crash net (only the accounts that run created). Reaches all 16
 * tables in appwrite/schema through their person columns, and both buckets:
 * a clip is reached through a deletable set's `video_file_id`, a picture
 * through the owner's avatar namespace (appwrite/documents/avatar.ts).
 *
 * What it will not do, by design:
 *   - delete a row or file that also names, or grants access to, anyone who
 *     is not a fixture -- it is reported as skipped instead;
 *   - delete a global exercise, even one a fixture run created: it carries no
 *     owner, so nothing proves whose it is;
 *   - delete an account while anything of theirs is left behind or a read
 *     failed. The account is the only thing that ties a stranded row back to
 *     a fixture, so it stays until a later prune can finish the job.
 */
import { AppwriteException, Query, Storage, TablesDB, Teams, Users, type Client } from "node-appwrite";
import { schema } from "../appwrite/schema";
import { circleTeamId } from "../appwrite/documents/circle";
import { AVATAR_BUCKET, isOwnAvatarFileId } from "../appwrite/documents/avatar";
import { isFixtureEmail, mayDeleteRow, permissionsOwnedByFixtures, personColumnsOf } from "./e2e-fixture-scope";

const CLIP_BUCKET = "set_videos";
const PAGE = 100;

type Row = Record<string, unknown> & { $id: string };

export interface PurgeReport {
  userId: string;
  email: string;
  /** table or bucket -> how many were (or would be) deleted */
  removed: Record<string, number>;
  /** what was left alone, and why */
  skipped: string[];
  errors: string[];
  /** true once the account is gone; false in report mode or when held back */
  accountRemoved: boolean;
}

const notFound = (error: unknown) => error instanceof AppwriteException && error.code === 404;

export async function purgeFixtureUsers(
  client: Client,
  databaseId: string,
  targets: ReadonlyArray<{ $id: string; email: string }>,
  options: { apply: boolean },
): Promise<PurgeReport[]> {
  // Lock 1, again, at the last moment: whatever the caller passed, nothing
  // without a fixture address is ever in scope.
  const inScope = targets.filter((t) => isFixtureEmail(t.email));
  const fixtureIds = new Set(inScope.map((t) => t.$id));
  const db = new TablesDB(client);
  const storage = new Storage(client);
  const teams = new Teams(client);
  const users = new Users(client);

  const listAll = async (tableId: string, column: string, value: string): Promise<Row[]> => {
    const rows: Row[] = [];
    let cursor: string | null = null;
    for (;;) {
      const queries = [Query.equal(column, value), Query.orderAsc("$id"), Query.limit(PAGE)];
      if (cursor) queries.push(Query.cursorAfter(cursor));
      const page = await db.listRows({ databaseId, tableId, queries, ttl: 0 });
      if (page.rows.length === 0) break;
      rows.push(...(page.rows as unknown as Row[]));
      cursor = page.rows[page.rows.length - 1].$id;
    }
    return rows;
  };

  // The avatars bucket is small (one picture per person), so one listing
  // serves every account.
  let avatarFiles: Array<{ $id: string; $permissions: unknown }> | null = null;
  const avatars = async () => {
    if (avatarFiles) return avatarFiles;
    const found: Array<{ $id: string; $permissions: unknown }> = [];
    let cursor: string | null = null;
    for (;;) {
      // The same paging as the backup's bucket reader (scripts/backup-driver.ts).
      const queries = [Query.limit(PAGE)];
      if (cursor) queries.push(Query.cursorAfter(cursor));
      const page = await storage.listFiles({ bucketId: AVATAR_BUCKET, queries });
      if (page.files.length === 0) break;
      found.push(...page.files.map((f) => ({ $id: f.$id, $permissions: f.$permissions })));
      cursor = page.files[page.files.length - 1].$id;
    }
    avatarFiles = found;
    return found;
  };

  const reports: PurgeReport[] = [];
  for (const user of inScope) {
    const report: PurgeReport = { userId: user.$id, email: user.email, removed: {}, skipped: [], errors: [], accountRemoved: false };
    const count = (key: string) => (report.removed[key] = (report.removed[key] ?? 0) + 1);

    // --- rows -----------------------------------------------------------
    const doomed = new Map<string, Map<string, Row>>();
    for (const table of schema.tables) {
      const columns = personColumnsOf(table);
      for (const column of columns) {
        let rows: Row[];
        try {
          rows = await listAll(table.id, column, user.$id);
        } catch (error) {
          report.errors.push(`list ${table.id}.${column}: ${String(error)}`);
          continue;
        }
        for (const row of rows) {
          const verdict = mayDeleteRow(row, columns, fixtureIds);
          if (!verdict.ok) {
            report.skipped.push(`${table.id}/${row.$id}: ${verdict.reason}`);
            continue;
          }
          const mine = doomed.get(table.id) ?? new Map<string, Row>();
          mine.set(row.$id, row);
          doomed.set(table.id, mine);
        }
      }
    }

    // --- files, found before the rows that point at them go ------------
    const clipIds = new Set<string>();
    for (const set of doomed.get("sets")?.values() ?? []) {
      if (typeof set.video_file_id === "string" && set.video_file_id) clipIds.add(set.video_file_id);
    }
    const files: Array<{ bucketId: string; fileId: string }> = [];
    for (const fileId of clipIds) {
      try {
        const file = await storage.getFile({ bucketId: CLIP_BUCKET, fileId });
        const verdict = permissionsOwnedByFixtures(file.$permissions, fixtureIds);
        if (verdict.ok) files.push({ bucketId: CLIP_BUCKET, fileId });
        else report.skipped.push(`${CLIP_BUCKET}/${fileId}: ${verdict.reason}`);
      } catch (error) {
        // Fixture sets often name a file that was never uploaded.
        if (!notFound(error)) report.errors.push(`get ${CLIP_BUCKET}/${fileId}: ${String(error)}`);
      }
    }
    try {
      for (const file of await avatars()) {
        if (!isOwnAvatarFileId(user.$id, file.$id)) continue;
        const verdict = permissionsOwnedByFixtures(file.$permissions, fixtureIds);
        if (verdict.ok) files.push({ bucketId: AVATAR_BUCKET, fileId: file.$id });
        else report.skipped.push(`${AVATAR_BUCKET}/${file.$id}: ${verdict.reason}`);
      }
    } catch (error) {
      report.errors.push(`list ${AVATAR_BUCKET}: ${String(error)}`);
    }

    // --- delete ----------------------------------------------------------
    for (const file of files) {
      if (!options.apply) {
        count(file.bucketId);
        continue;
      }
      try {
        await storage.deleteFile(file);
        count(file.bucketId);
      } catch (error) {
        if (!notFound(error)) report.errors.push(`delete ${file.bucketId}/${file.fileId}: ${String(error)}`);
      }
    }
    for (const [tableId, rows] of doomed) {
      for (const rowId of rows.keys()) {
        if (!options.apply) {
          count(tableId);
          continue;
        }
        try {
          await db.deleteRow({ databaseId, tableId, rowId });
          count(tableId);
        } catch (error) {
          if (!notFound(error)) report.errors.push(`delete ${tableId}/${rowId}: ${String(error)}`);
        }
      }
    }

    // --- the circle, then the account -----------------------------------
    if (options.apply) {
      // The circle first: a team outliving its athlete is what makes rows
      // that referenced it unrestorable (prune-e2e-fixtures.mts header).
      await teams.delete({ teamId: circleTeamId(user.$id) }).catch((error) => {
        if (!notFound(error)) report.errors.push(`delete team ${circleTeamId(user.$id)}: ${String(error)}`);
      });
      const ownSkips = report.skipped.length > 0;
      if (report.errors.length === 0 && !ownSkips) {
        try {
          // Re-read rather than trust the caller's copy: the address is the
          // last lock, and it is checked against the server's answer.
          const fresh = await users.get({ userId: user.$id });
          if (isFixtureEmail(fresh.email)) {
            await users.delete({ userId: user.$id });
            report.accountRemoved = true;
          } else {
            report.errors.push(`account ${user.$id} no longer has a fixture address (${fresh.email}); kept`);
          }
        } catch (error) {
          if (notFound(error)) report.accountRemoved = true;
          else report.errors.push(`delete account: ${String(error)}`);
        }
      }
    }
    reports.push(report);
  }
  return reports;
}

/** One line per account, then the details worth reading. */
export function formatReport(report: PurgeReport): string[] {
  const lines = [`  ${report.email}  ${report.userId}${report.accountRemoved ? "  (removed)" : ""}`];
  const removed = Object.entries(report.removed);
  if (removed.length === 0) lines.push("    no rows or files");
  for (const [where, n] of removed) lines.push(`    ${n} in ${where}`);
  for (const skip of report.skipped) lines.push(`    SKIPPED ${skip}`);
  for (const error of report.errors) lines.push(`    ERROR ${error}`);
  if (!report.accountRemoved && (report.skipped.length || report.errors.length)) {
    lines.push("    account kept so a later prune can still find what is left");
  }
  return lines;
}
