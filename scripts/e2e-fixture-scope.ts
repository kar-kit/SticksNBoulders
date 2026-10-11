/**
 * What counts as an e2e fixture, decided as pure logic.
 *
 * Shared by `e2e:prune` and the e2e runner's crash net (scripts/e2e-run.mts),
 * so the two can never disagree about what they are allowed to delete. Both
 * run with the server key against the one live instance Joey trains on, so
 * every rule here errs towards leaving a row behind: a stranded fixture is a
 * nuisance, a deleted set of real training is not recoverable without a
 * restore.
 *
 * Three independent locks, all of which must open before anything is deleted:
 *
 *   1. The account. Its email is `<lowercase-tag>-<13-digit ms stamp>` at a
 *      domain RFC 2606 / RFC 6761 reserve for testing (`example.com`, and the
 *      `.test` TLD as `sticksnboulders.test`). No real person can receive mail
 *      there, and the stamp shape is what every e2e script writes. Not the
 *      name, not the age, not a label: those are things a real account can
 *      have too.
 *   2. The row. Every person-naming column on it (`PERSON_COLUMNS`) is empty
 *      or a fixture id. A row naming a fixture coach AND a real athlete is
 *      reported and left alone, never deleted.
 *   3. The permissions. Every specific principal the row or file grants
 *      (`user:`, `team:`, `member:`, `label:`) is a fixture or a fixture's
 *      circle. A row a real account can read or write is left alone, even if
 *      its columns say fixture.
 *
 * Pure. No client, no network, no clock of its own.
 */
import { circleTeamId } from "../appwrite/documents/circle";

/** The reserved domains e2e accounts live under. Nothing else is ever a fixture. */
export const FIXTURE_DOMAINS = ["example.com", "sticksnboulders.test"] as const;

/**
 * `<tag>-<stamp>@<reserved domain>`, where tag is lowercase words joined by
 * hyphens and stamp is `Date.now()` (13 digits until the year 2286).
 */
const FIXTURE_EMAIL = /^[a-z0-9]+(?:-[a-z0-9]+)*-(\d{13})@(example\.com|sticksnboulders\.test)$/;

export function isFixtureEmail(email: unknown): email is string {
  return typeof email === "string" && FIXTURE_EMAIL.test(email);
}

/** The ms stamp an e2e script wrote into the address, or null for a non-fixture. */
export function fixtureStamp(email: unknown): number | null {
  if (typeof email !== "string") return null;
  const match = FIXTURE_EMAIL.exec(email);
  return match ? Number(match[1]) : null;
}

/**
 * Whether an account is a fixture: the address, and an account created when
 * the address says it was. The second half is belt and braces against a real
 * person who signed up as `me-1234567890123@example.com` years apart from the
 * stamp; every script creates the account within seconds of `Date.now()`.
 */
export function isFixtureUser(user: { email?: unknown; $createdAt?: unknown }, slackMs = 24 * 60 * 60_000): boolean {
  const stamp = fixtureStamp(user.email);
  if (stamp === null) return false;
  if (typeof user.$createdAt !== "string") return false;
  const created = Date.parse(user.$createdAt);
  return Number.isFinite(created) && Math.abs(created - stamp) <= slackMs;
}

/**
 * Columns that name a person, across every table in appwrite/schema.
 *
 * A table with none of these cannot be attributed to an account, so prune
 * cannot reach it. scripts/e2e-fixture-scope.test.ts fails if a table is ever
 * added without one, so this list cannot silently fall behind the schema.
 */
export const PERSON_COLUMNS = ["user_id", "athlete_id", "coach_id", "owner_id", "author_id", "recorded_by"] as const;

/** Columns of `table` that name a person. */
export function personColumnsOf(table: { columns: readonly { key: string }[] }): string[] {
  const keys = new Set(table.columns.map((c) => c.key));
  return PERSON_COLUMNS.filter((key) => keys.has(key));
}

export type RowVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Lock 2: every person column empty or a fixture. Global exercises carry no
 * owner and are matched by nobody, so they are never reached in the first
 * place; `is_global` is refused here as well in case one ever does.
 */
export function rowOwnedByFixtures(
  row: Record<string, unknown>,
  personColumns: readonly string[],
  fixtureIds: ReadonlySet<string>,
): RowVerdict {
  if (row.is_global === true) return { ok: false, reason: "global row" };
  let named = 0;
  for (const column of personColumns) {
    const value = row[column];
    if (value === null || value === undefined || value === "") continue;
    if (typeof value !== "string" || !fixtureIds.has(value)) {
      return { ok: false, reason: `${column} names a non-fixture (${String(value)})` };
    }
    named += 1;
  }
  return named > 0 ? { ok: true } : { ok: false, reason: "names nobody" };
}

/**
 * The principal inside an Appwrite permission string:
 * read of "team:circle_abc/coach" -> `team:circle_abc/coach`. This only ever parses
 * permissions read back from Appwrite; it never builds one.
 */
export function principalOf(permission: string): string | null {
  const match = /^\w+\("(.*)"\)$/.exec(permission);
  return match ? match[1] : null;
}

/**
 * Lock 3: every specific principal a row or file grants is a fixture or a
 * fixture's circle. The generic roles (`any`, `users`, `guests`) name nobody
 * and are allowed: the permission audit forges rows stamped readable by "users"
 * under fixture ids, and those must be removable. Anything unparseable fails.
 */
export function permissionsOwnedByFixtures(permissions: unknown, fixtureIds: ReadonlySet<string>): RowVerdict {
  if (!Array.isArray(permissions)) return { ok: true };
  const circles = new Set([...fixtureIds].map((id) => circleTeamId(id)));
  for (const permission of permissions) {
    const principal = typeof permission === "string" ? principalOf(permission) : null;
    if (principal === null) return { ok: false, reason: `unparseable permission ${String(permission)}` };
    // `users/verified`, `guests`, `any`: roles, not people.
    const [kind, rest = ""] = principal.split(":", 2);
    if (!rest && ["any", "users", "guests"].includes(kind.split("/")[0])) continue;
    const id = rest.split("/")[0];
    if (kind === "user" && fixtureIds.has(id)) continue;
    if (kind === "team" && circles.has(id)) continue;
    return { ok: false, reason: `grants ${principal}` };
  }
  return { ok: true };
}

/** Lock 2 and lock 3 together, for a row about to be deleted. */
export function mayDeleteRow(
  row: Record<string, unknown>,
  personColumns: readonly string[],
  fixtureIds: ReadonlySet<string>,
): RowVerdict {
  const owned = rowOwnedByFixtures(row, personColumns, fixtureIds);
  if (!owned.ok) return owned;
  return permissionsOwnedByFixtures(row.$permissions, fixtureIds);
}
