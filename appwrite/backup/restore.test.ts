import {
  describeRestore,
  restoreBackup,
  validateBackup,
  type Outcome,
  type RestoreTarget,
} from "./restore";
import { BACKUP_FORMAT_VERSION, type Backup, type BackupRow, type BackupUser } from "./types";

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
  };
  return { ...base, ...overrides };
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
