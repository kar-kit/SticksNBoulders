import { dumpInstance, type BackupSource } from "./dump";
import type { BackupRow, BackupTeam, BackupUser } from "./types";

const context = {
  endpoint: "https://appwrite.example/v1",
  projectId: "snb",
  databaseId: "sticksnboulders",
  schemaVersion: 1,
  now: () => new Date("2026-09-14T03:00:00.000Z"),
};

const row = (id: string): BackupRow => ({
  $id: id,
  $permissions: [`read("user:joey")`],
  data: { load_kg: 100 },
});

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

/**
 * A source that caps pages at `serverCap` however many are asked for. Appwrite
 * does exactly this, and it is the behaviour that made the old dump-before-
 * reset silently keep 25 rows and call it a backup.
 */
function fakeSource(options: {
  rows?: Record<string, BackupRow[]>;
  users?: BackupUser[];
  teams?: Array<Omit<BackupTeam, "memberships">>;
  memberships?: Record<string, BackupTeam["memberships"]>;
  serverCap?: number;
  /** Lies about the total, to simulate rows vanishing mid-dump. */
  totalOverride?: number;
}): BackupSource & { pages: number } {
  const cap = options.serverCap ?? 100;
  const rows = options.rows ?? {};
  const state = { pages: 0 };

  const slice = <T extends { $id: string }>(items: T[], cursor: string | null) => {
    state.pages += 1;
    const start = cursor ? items.findIndex((i) => i.$id === cursor) + 1 : 0;
    return items.slice(start, start + cap);
  };

  return {
    get pages() {
      return state.pages;
    },
    tableIds: () => Object.keys(rows),
    async rowPage(tableId, cursor) {
      const all = rows[tableId] ?? [];
      return { total: options.totalOverride ?? all.length, rows: slice(all, cursor) };
    },
    async userPage(cursor) {
      const all = options.users ?? [];
      return { total: all.length, users: slice(all, cursor) };
    },
    async teamPage(cursor) {
      const all = options.teams ?? [];
      return { total: all.length, teams: slice(all, cursor) };
    },
    async memberships(teamId) {
      return options.memberships?.[teamId] ?? [];
    },
  };
}

describe("dumping an instance", () => {
  it("pages past the server's cap instead of keeping the first page", async () => {
    const sets = Array.from({ length: 250 }, (_, i) => row(`set${String(i).padStart(3, "0")}`));
    const source = fakeSource({ rows: { sets }, serverCap: 25 });

    const backup = await dumpInstance(source, context);

    expect(backup.tables[0].rows).toHaveLength(250);
    expect(backup.manifest.tables[0]).toEqual({ id: "sets", rows: 250, expectedRows: 250 });
  });

  it("keeps paging when a page comes back shorter than asked for", async () => {
    // The trap in "stop when the page is short": the cap is below our page
    // size, so every page is short and a naive loop stops after one.
    const sets = Array.from({ length: 30 }, (_, i) => row(`set${i}`));
    const source = fakeSource({ rows: { sets }, serverCap: 10 });

    const backup = await dumpInstance(source, context);

    expect(backup.tables[0].rows).toHaveLength(30);
    expect(source.pages).toBeGreaterThan(3);
  });

  it("refuses to write a short backup", async () => {
    const source = fakeSource({ rows: { sets: [row("a"), row("b")] }, totalOverride: 9 });
    await expect(dumpInstance(source, context)).rejects.toThrow(/collected 2 of 9/);
  });

  it("accepts more rows than reported, because a set can be logged mid-dump", async () => {
    const source = fakeSource({ rows: { sets: [row("a"), row("b"), row("c")] }, totalOverride: 2 });

    const backup = await dumpInstance(source, context);

    expect(backup.tables[0].rows).toHaveLength(3);
    expect(backup.manifest.tables[0].expectedRows).toBe(2);
  });

  it("refuses to loop when the cursor fails to advance", async () => {
    const stuck: BackupSource = {
      tableIds: () => ["sets"],
      async rowPage() {
        return { total: 99, rows: [row("same")] };
      },
      async userPage() {
        return { total: 0, users: [] };
      },
      async teamPage() {
        return { total: 0, teams: [] };
      },
      async memberships() {
        return [];
      },
    };
    await expect(dumpInstance(stuck, context)).rejects.toThrow(/cursor is not advancing/);
  });

  it("carries permissions, not just data", async () => {
    const source = fakeSource({ rows: { sets: [row("a")] } });
    const backup = await dumpInstance(source, context);
    expect(backup.tables[0].rows[0].$permissions).toEqual([`read("user:joey")`]);
  });

  it("collects teams with their memberships", async () => {
    const source = fakeSource({
      users: [user("joey"), user("ruairi")],
      teams: [{ $id: "circle_joey", name: "Joey — circle" }],
      memberships: {
        circle_joey: [
          { userId: "joey", roles: ["athlete"], confirmed: true },
          { userId: "ruairi", roles: ["coach"], confirmed: true },
        ],
      },
    });

    const backup = await dumpInstance(source, context);

    expect(backup.teams[0].memberships).toHaveLength(2);
    expect(backup.manifest.memberships).toBe(2);
    expect(backup.manifest.users).toBe(2);
  });

  it("states what it does not contain, in the file itself", async () => {
    const backup = await dumpInstance(fakeSource({}), context);
    expect(backup.manifest.omits.join(" ")).toMatch(/password hashes/);
    expect(backup.manifest.takenAt).toBe("2026-09-14T03:00:00.000Z");
    expect(backup.manifest.schemaVersion).toBe(1);
  });
});
