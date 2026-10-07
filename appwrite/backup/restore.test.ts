import {
  describeRestore,
  restoreBackup,
  validateBackup,
  type Outcome,
  type RestoreTarget,
} from "./restore";
import {
  BACKUP_FORMAT_VERSION,
  type Backup,
  type BackupFile,
  type BackupRow,
  type BackupUser,
} from "./types";

const user = (id: string): BackupUser => ({
  $id: id,
  email: `${id}@example.com`,
  name: id,
  labels: [],
  prefs: {},
  emailVerification: true,
  status: true,
  registration: "2026-09-01T00:00:00.000Z",
  providers: [],
});

const row = (id: string, permissions: string[]): BackupRow => ({
  $id: id,
  $permissions: permissions,
  data: { athlete_id: "joey", load_kg: 142.5 },
});

/** Joey logging, Ruairi coaching: the shape every real dump will have. */
function backup(overrides: Partial<Backup> = {}): Backup {
  const base: Backup = {
    manifest: {
      formatVersion: BACKUP_FORMAT_VERSION,
      takenAt: "2026-09-14T03:00:00.000Z",
      endpoint: "https://appwrite.example/v1",
      projectId: "snb",
      databaseId: "sticksnboulders",
      schemaVersion: 1,
      tables: [{ id: "sets", rows: 1, expectedRows: 1 }],
      users: 2,
      teams: 1,
      memberships: 2,
      buckets: [],
      omits: [],
    },
    tables: [
      {
        id: "sets",
        expectedRows: 1,
        rows: [row("set1", [`read("user:joey")`, `read("team:circle_joey")`])],
      },
    ],
    users: [user("joey"), user("ruairi")],
    teams: [
      {
        $id: "circle_joey",
        name: "Joey — circle",
        memberships: [
          { userId: "joey", roles: ["athlete"], confirmed: true },
          { userId: "ruairi", roles: ["coach"], confirmed: true },
        ],
      },
    ],
    files: [],
  };
  return { ...base, ...overrides };
}

const clip = (id: string, permissions = [`read("user:joey")`, `read("team:circle_joey")`]): BackupFile => ({
  $id: id,
  bucketId: "set_videos",
  $permissions: permissions,
  $createdAt: "2026-10-01T10:00:00.000Z",
  $updatedAt: "2026-10-01T10:00:00.000Z",
  name: `${id}.mov`,
  mimeType: "video/quicktime",
  sizeOriginal: 12_000_000,
  sha256: "a".repeat(64),
});

/** Joey's set with a clip on it, and the clip in the dump. */
function backupWithClip(): Backup {
  const b = backup();
  b.tables[0].rows[0].data.video_file_id = "clipA";
  b.files = [clip("clipA")];
  b.manifest.buckets = [{ id: "set_videos", files: 1, bytes: 12_000_000, incomplete: [] }];
  return b;
}

function recordingTarget(existing: Set<string> = new Set()) {
  const calls: string[] = [];
  const outcome = (key: string): Outcome => (existing.has(key) ? "existed" : "created");

  const target: RestoreTarget = {
    async ensureUser(u) {
      calls.push(`user:${u.$id}`);
      return outcome(`user:${u.$id}`);
    },
    async ensureTeam(t) {
      calls.push(`team:${t.$id}`);
      return outcome(`team:${t.$id}`);
    },
    async ensureMembership(teamId, m) {
      calls.push(`member:${teamId}:${m.userId}`);
      return outcome(`member:${teamId}:${m.userId}`);
    },
    async ensureFile(f) {
      calls.push(`file:${f.bucketId}/${f.$id}:${f.$permissions.join("|")}`);
      return outcome(`file:${f.$id}`);
    },
    async putRow(tableId, r) {
      calls.push(`row:${tableId}:${r.$id}:${r.$permissions.join("|")}`);
      return outcome(`row:${tableId}:${r.$id}`);
    },
  };
  return { target, calls };
}

describe("restore ordering", () => {
  it("writes users, then teams, then memberships, then rows", async () => {
    const { target, calls } = recordingTarget();
    await restoreBackup(target, backup());

    expect(calls).toEqual([
      "user:joey",
      "user:ruairi",
      "team:circle_joey",
      "member:circle_joey:joey",
      "member:circle_joey:ruairi",
      `row:sets:set1:read("user:joey")|read("team:circle_joey")`,
    ]);
  });

  it("never writes a row before every role its permissions name exists", async () => {
    // The failure this ordering prevents is not a crash. Appwrite would accept
    // rows naming a team that does not exist yet, and the restore would look
    // clean while every coach screen came back empty.
    const { target, calls } = recordingTarget();
    await restoreBackup(target, backup());

    const firstRow = calls.findIndex((c) => c.startsWith("row:"));
    const lastRole = calls.findLastIndex((c) => !c.startsWith("row:"));
    expect(lastRole).toBeLessThan(firstRow);
  });

  it("preserves each row's id and permissions", async () => {
    const { target, calls } = recordingTarget();
    await restoreBackup(target, backup());
    expect(calls).toContain(`row:sets:set1:read("user:joey")|read("team:circle_joey")`);
  });

  it("counts what it created against what was already there", async () => {
    const { target } = recordingTarget(new Set(["user:joey", "row:sets:set1"]));
    const report = await restoreBackup(target, backup());

    expect(report.users).toEqual({ created: 1, existed: 1 });
    expect(report.rows.sets).toEqual({ created: 0, existed: 1 });
    expect(report.memberships).toEqual({ created: 2, existed: 0 });
  });
});

describe("restoring clips", () => {
  it("writes files after memberships and before rows", async () => {
    // After: a clip's permissions name the same circle a row's do. Before: the
    // set row names the clip, and a coach opening it first gets a dead player.
    const { target, calls } = recordingTarget();
    await restoreBackup(target, backupWithClip());

    const file = calls.findIndex((c) => c.startsWith("file:"));
    expect(file).toBeGreaterThan(calls.findLastIndex((c) => c.startsWith("member:")));
    expect(file).toBeLessThan(calls.findIndex((c) => c.startsWith("row:")));
  });

  it("restores a clip with the permissions it was dumped with", async () => {
    const { target, calls } = recordingTarget();
    await restoreBackup(target, backupWithClip());
    expect(calls).toContain(`file:set_videos/clipA:read("user:joey")|read("team:circle_joey")`);
  });

  it("counts clips already there, so a re-run is boring", async () => {
    const { target } = recordingTarget(new Set(["file:clipA"]));
    const report = await restoreBackup(target, backupWithClip());
    expect(report.files).toEqual({ created: 0, existed: 1 });
  });

  it("passes a coherent dump with a clip", () => {
    expect(validateBackup(backupWithClip())).toEqual([]);
  });

  it("blocks a clip granting read to a circle the dump does not hold", () => {
    const b = backupWithClip();
    b.files = [clip("clipA", [`read("team:circle_gone")`])];
    expect(
      validateBackup(b)
        .filter((p) => p.severity === "blocking")
        .map((p) => p.message)
        .join(" "),
    ).toMatch(/team:circle_gone.*not in this dump/);
  });

  it("blocks a clip id that would escape the file store", () => {
    const b = backupWithClip();
    b.files = [{ ...clip("clipA"), $id: "../../etc" }];
    expect(validateBackup(b).some((p) => p.severity === "blocking" && /not an Appwrite id/.test(p.message))).toBe(
      true,
    );
  });

  it("blocks a bucket holding fewer clips than its manifest claims", () => {
    const b = backupWithClip();
    b.manifest.buckets[0].files = 2;
    expect(validateBackup(b).some((p) => p.severity === "blocking" && /Truncated dump/.test(p.message))).toBe(true);
  });

  it("warns, without blocking, on a set naming a clip the dump does not hold", () => {
    // What a clip deleted mid-dump looks like. The set is still worth having.
    const b = backupWithClip();
    b.files = [];
    b.manifest.buckets[0].files = 0;
    const problems = validateBackup(b);
    expect(problems.filter((p) => p.severity === "blocking")).toEqual([]);
    expect(problems.some((p) => /sets\/set1 points at clip clipA/.test(p.message))).toBe(true);
  });

  it("still restores a v1 dump, warning that it holds no clips", async () => {
    const b = backup();
    b.manifest.formatVersion = 1;
    const problems = validateBackup(b);
    expect(problems.filter((p) => p.severity === "blocking")).toEqual([]);
    expect(problems.some((p) => /predates file backups/.test(p.message))).toBe(true);

    const { target, calls } = recordingTarget();
    await restoreBackup(target, b);
    expect(calls.some((c) => c.startsWith("file:"))).toBe(false);
  });

  it("lists clips in the plan", () => {
    expect(describeRestore(backupWithClip()).join("\n")).toMatch(/files\s+1 \(12000000 bytes\)/);
  });
});

describe("validating a backup before writing anything", () => {
  const blocking = (b: Backup) =>
    validateBackup(b)
      .filter((p) => p.severity === "blocking")
      .map((p) => p.message);

  it("passes a coherent dump", () => {
    expect(validateBackup(backup())).toEqual([]);
  });

  it("catches a row granting read to a user the dump does not hold", () => {
    const b = backup();
    b.tables[0].rows = [row("set1", [`read("user:ghost")`])];
    expect(blocking(b).join(" ")).toMatch(/user:ghost.*not in this dump/);
  });

  it("catches a row granting read to a circle the dump does not hold", () => {
    const b = backup();
    b.tables[0].rows = [row("set1", [`read("team:circle_missing")`])];
    expect(blocking(b).join(" ")).toMatch(/team:circle_missing.*not in this dump/);
  });

  it("accepts a team role suffix, which Appwrite allows", () => {
    const b = backup();
    b.tables[0].rows = [row("set1", [`read("team:circle_joey/coach")`])];
    expect(blocking(b)).toEqual([]);
  });

  it("catches a truncated table", () => {
    const b = backup();
    b.tables[0].expectedRows = 500;
    expect(blocking(b).join(" ")).toMatch(/Truncated dump/);
  });

  it("catches a membership for an absent user", () => {
    const b = backup();
    b.teams[0].memberships.push({ userId: "nobody", roles: ["coach"], confirmed: true });
    expect(blocking(b).join(" ")).toMatch(/nobody, who is not in this dump/);
  });

  it("warns, without blocking, on an unconfirmed membership", () => {
    const b = backup();
    b.teams[0].memberships[1].confirmed = false;
    const problems = validateBackup(b);
    expect(blocking(b)).toEqual([]);
    expect(problems.some((p) => p.severity === "warning" && /unconfirmed/.test(p.message))).toBe(true);
  });

  it("warns on a row nobody can read", () => {
    const b = backup();
    b.tables[0].rows = [row("set1", [])];
    const problems = validateBackup(b);
    expect(problems.some((p) => /only an API key will read it/.test(p.message))).toBe(true);
  });

  it("refuses a format version it does not understand", () => {
    const b = backup();
    b.manifest.formatVersion = 99;
    expect(blocking(b).join(" ")).toMatch(/format v99/);
  });

  it("refuses to restore when validation blocks, writing nothing", async () => {
    const b = backup();
    b.tables[0].rows = [row("set1", [`read("user:ghost")`])];
    const { target, calls } = recordingTarget();

    await expect(restoreBackup(target, b)).rejects.toThrow(/Refusing to restore/);
    expect(calls).toEqual([]);
  });
});

describe("describing a restore before it runs", () => {
  it("lists what would be written", () => {
    expect(describeRestore(backup()).join("\n")).toMatch(/users\s+2[\s\S]*sets\s+1 row/);
  });
});
