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
 * - Storage files, as metadata here and bytes in a shared store beside the
 *   dumps. A clip is stamped per file, so its permissions are kept for the
 *   same reason a row's are; and a set row restored without its clip is a
 *   broken player in the coach's review queue.
 *
 * What it deliberately does not contain: password hashes. See docs/backups.md.
 */

/**
 * Bumped when the layout changes in a way a restore has to know about.
 *
 * v2 added storage files. A v1 dump is still readable -- it simply holds no
 * clips -- because the dump taken the night before this shipped is the one
 * someone will reach for first.
 */
export const BACKUP_FORMAT_VERSION = 2;
export const READABLE_FORMAT_VERSIONS: readonly number[] = [1, 2];

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

/**
 * A storage file as dumped. The bytes are not in here: they live once in the
 * shared store (`<backup root>/files/<bucket>/<id>`), because files are
 * immutable in Appwrite and fourteen nightly copies of the same clip would
 * be fourteen times the disk for nothing.
 */
export interface BackupFile {
  $id: string;
  bucketId: string;
  $permissions: string[];
  /** Kept for forensics and for the orphan sweep's age check. */
  $createdAt: string;
  $updatedAt: string;
  name: string;
  mimeType: string;
  sizeOriginal: number;
  /** Of the bytes in the store, computed as they were written. */
  sha256: string;
}

/** One bucket's line in the manifest. */
export interface BackupBucket {
  id: string;
  /** Complete files copied into the store. */
  files: number;
  bytes: number;
  /**
   * Uploads still in flight when the dump ran, by id. A partial upload is not
   * a playable clip and no set points at one yet, so it is named rather than
   * copied -- the athlete's phone still holds the original.
   */
  incomplete: string[];
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
  /** Empty in a v1 dump, which predates file backups. */
  buckets: BackupBucket[];
  /** Stated in the file itself, so nobody has to read the docs to find out. */
  omits: string[];
}

export interface Backup {
  manifest: BackupManifest;
  tables: BackupTable[];
  users: BackupUser[];
  teams: BackupTeam[];
  /** Empty in a v1 dump. */
  files: BackupFile[];
}

export const BACKUP_OMISSIONS = [
  "password hashes -- a restored user signs in via password reset or their OAuth provider",
  "OAuth provider tokens -- they belong to the provider",
  "uploads still in flight when the dump ran -- listed by id under buckets[].incomplete, not copied",
  "Appwrite project settings, API keys, OAuth credentials and SMTP config",
] as const;
