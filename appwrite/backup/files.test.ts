import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backupDirName, listBackups, readBackup, writeBackup } from "./files";
import { BACKUP_FORMAT_VERSION, type Backup } from "./types";

const backup: Backup = {
  manifest: {
    formatVersion: BACKUP_FORMAT_VERSION,
    takenAt: "2026-09-14T03:00:00.000Z",
    endpoint: "https://appwrite.example/v1",
    projectId: "snb",
    databaseId: "sticksnboulders",
    schemaVersion: 1,
    tables: [{ id: "sets", rows: 1, expectedRows: 1 }],
    users: 1,
    teams: 1,
    memberships: 1,
    omits: ["password hashes"],
  },
  tables: [
    {
      id: "sets",
      expectedRows: 1,
      rows: [{ $id: "set1", $permissions: [`read("user:joey")`], data: { load_kg: 142.5 } }],
    },
  ],
  users: [
    {
      $id: "joey",
      email: "joey@example.com",
      name: "Joey",
      labels: [],
      prefs: {},
      emailVerification: true,
      status: true,
      registration: "2026-09-01T00:00:00.000Z",
      providers: ["google"],
    },
  ],
  teams: [
    {
      $id: "circle_joey",
      name: "Joey — circle",
      memberships: [{ userId: "joey", roles: ["athlete"], confirmed: true }],
    },
  ],
};

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "snb-backup-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("a backup on disk", () => {
  it("round-trips without losing ids or permissions", async () => {
    await writeBackup(dir, backup);
    expect(await readBackup(dir)).toEqual(backup);
  });

  it("writes the manifest last, so a crashed dump cannot pass as a good one", async () => {
    await writeBackup(dir, backup);
    await rm(join(dir, "manifest.json"));
    await expect(readBackup(dir)).rejects.toThrow(/Cannot read/);
  });

  it("refuses a directory that is not a backup", async () => {
    await writeFile(join(dir, "manifest.json"), JSON.stringify({ hello: "world" }));
    await expect(readBackup(dir)).rejects.toThrow(/not a backup/);
  });

  it("names a directory after the moment it was taken, legibly on every filesystem", () => {
    expect(backupDirName("2026-09-14T03:00:00.000Z")).toBe("2026-09-14T03-00-00-000Z");
  });

  it("lists dumps oldest first, and says nothing rather than throwing when there are none", async () => {
    expect(await listBackups(join(dir, "nope"))).toEqual([]);
    await writeBackup(join(dir, "2026-09-13T00-00-00-000Z"), backup);
    await writeBackup(join(dir, "2026-09-14T00-00-00-000Z"), backup);
    expect(await listBackups(dir)).toEqual([
      "2026-09-13T00-00-00-000Z",
      "2026-09-14T00-00-00-000Z",
    ]);
  });

  it("ignores a directory with no manifest, so a crashed dump cannot displace a good one", async () => {
    // Retention deletes what this returns. A half-written dump counting toward
    // the window would evict a real backup to make room for a corpse.
    await writeBackup(join(dir, "2026-09-14T00-00-00-000Z"), backup);
    await mkdir(join(dir, "2026-09-15T00-00-00-000Z", "tables"), { recursive: true });
    await mkdir(join(dir, "not-a-backup-at-all"), { recursive: true });

    expect(await listBackups(dir)).toEqual(["2026-09-14T00-00-00-000Z"]);
  });

  it("stores one file per table, readable on its own", async () => {
    await writeBackup(dir, backup);
    const table = JSON.parse(await readFile(join(dir, "tables", "sets.json"), "utf8"));
    expect(table.rows[0].$permissions).toEqual([`read("user:joey")`]);
  });
});
