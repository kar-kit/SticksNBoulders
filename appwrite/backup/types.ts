/**
 * The on-disk shape of a backup.
 *
 * Deliberately free of any SDK import, for the same reason the schema is: the
 * format is data, so a dump can be built, validated and restored in a test
 * without a network, and the drivers are the only things that know how
 * Appwrite spells anything.
 *
 * What a dump contains, and why:
 *
 * - Rows, with `$id` and `$permissions`. Under Appwrite the permissions ARE
 *   the access control -- there is no policy to re-derive them from -- so a
 *   dump that loses them restores data nobody can read.
 * - Users, as identities. Row permissions name `user:<id>`, so restoring rows
 *   without their users produces permissions pointing at nothing.
 * - Teams and memberships. A coach's read comes from `team:circle_<athlete>`,
 *   so the circle graph is load-bearing, not metadata.
 *
 * What it deliberately does not contain: password hashes. See docs/backups.md.
 */

/** Bumped when the layout changes in a way a restore has to know about. */
export const BACKUP_FORMAT_VERSION = 1;

/** A row as dumped. Appwrite's other `$` fields are not restorable, so they go. */
export interface BackupRow {
  $id: string;
  $permissions: string[];
  /** Kept for forensics only. Appwrite assigns its own on restore. */
  $createdAt?: string;
  $updatedAt?: string;
  data: Record<string, unknown>;
}

export interface BackupTable {
  id: string;
  /** What the instance said it held, before paging. */
  expectedRows: number;
  rows: BackupRow[];
}

/**
 * An identity, without credentials.
 *
 * `providers` records which OAuth providers were linked, so a restore can tell
 * someone why "Continue with Google" no longer recognises them. The tokens
 * themselves belong to the provider and are not ours to keep.
 */
export interface BackupUser {
  $id: string;
  email: string | null;
  name: string;
  labels: string[];
  prefs: Record<string, unknown>;
  emailVerification: boolean;
  status: boolean;
  registration: string;
  providers: string[];
}

export interface BackupMembership {
  userId: string;
  roles: string[];
  confirmed: boolean;
}

export interface BackupTeam {
  $id: string;
  name: string;
  memberships: BackupMembership[];
}

export interface BackupManifest {
  formatVersion: number;
  takenAt: string;
  endpoint: string;
  projectId: string;
  databaseId: string;
  /** From the schema module, so a dump is attributable to a schema version. */
  schemaVersion: number;
  tables: Array<{ id: string; rows: number; expectedRows: number }>;
  users: number;
  teams: number;
  memberships: number;
  /** Stated in the file itself, so nobody has to read the docs to find out. */
  omits: string[];
}

export interface Backup {
  manifest: BackupManifest;
  tables: BackupTable[];
  users: BackupUser[];
  teams: BackupTeam[];
}

export const BACKUP_OMISSIONS = [
  "password hashes -- a restored user signs in via password reset or their OAuth provider",
  "OAuth provider tokens -- they belong to the provider",
  "storage file contents -- no bucket exists yet; revisit at Order 31 (video)",
  "Appwrite project settings, API keys, OAuth credentials and SMTP config",
] as const;
