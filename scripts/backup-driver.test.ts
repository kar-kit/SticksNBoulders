// @vitest-environment node
import { AppwriteException, type Storage, type TablesDB, type Teams, type Users } from "node-appwrite";
import type { BackupUser } from "../appwrite/backup/types";
import { appwriteSource, appwriteTarget } from "./backup-driver";

/**
 * The Appwrite half of backup and restore, against hand-rolled SDK fakes.
 *
 * The backup core is tested on its own; these prove the driver hands it what
 * Appwrite actually holds and writes back what the dump recorded: permissions
 * on every row, blocked accounts kept blocked, and a real failure reported as
 * one rather than as "already existed".
 */

type Q = { method: string; attribute?: string; values?: unknown[] };
const parsed = (queries: string[]) => queries.map((q) => JSON.parse(q) as Q);

function fakes() {
  const db = {
    listRows: vi.fn(),
    createRow: vi.fn(async () => ({})),
  };
  const users = {
    list: vi.fn(),
    listIdentities: vi.fn(async () => ({ total: 0, identities: [] as Array<{ provider: string }> })),
    create: vi.fn(async () => ({})),
    updatePrefs: vi.fn(async () => ({})),
    updateLabels: vi.fn(async () => ({})),
    updateEmailVerification: vi.fn(async () => ({})),
    updateStatus: vi.fn(async () => ({})),
  };
  const teams = {
    list: vi.fn(),
    listMemberships: vi.fn(),
    create: vi.fn(async () => ({})),
    createMembership: vi.fn(async () => ({})),
  };
  return {
    db,
    users,
    teams,
    source: appwriteSource(db as unknown as TablesDB, users as unknown as Users, teams as unknown as Teams, {
      databaseId: "main",
      tableIds: ["sets"],
    }),
    target: appwriteTarget(db as unknown as TablesDB, users as unknown as Users, teams as unknown as Teams, {
      databaseId: "main",
      storage: {} as Storage,
    }),
  };
}

const conflict = () => new AppwriteException("Row with the requested ID already exists.", 409, "row_already_exists");
const serverError = () => new AppwriteException("Server error", 500, "general_unknown");

const user = (over: Partial<BackupUser> = {}): BackupUser => ({
  $id: "joey",
  email: "joey@example.com",
  name: "Joey",
  labels: [],
  prefs: {},
  emailVerification: false,
  status: true,
  registration: "2026-01-01T00:00:00.000Z",
  providers: [],
  ...over,
});

describe("appwriteSource (dump)", () => {
  it("keeps each row's permissions and moves only non-$ fields into data", async () => {
    const { db, source } = fakes();
    db.listRows.mockResolvedValue({
      total: 1,
      rows: [
        {
          $id: "r1",
          $permissions: ['read("user:joey")', 'read("team:circle_joey")'],
          $createdAt: "2026-10-01T00:00:00.000Z",
          $updatedAt: "2026-10-02T00:00:00.000Z",
          $tableId: "sets",
          $databaseId: "main",
          $sequence: 7,
          load_kg: 180,
          reps: 3,
        },
      ],
    });

    const page = await source.rowPage("sets", null, 100);

    expect(page).toEqual({
      total: 1,
      rows: [
        {
          $id: "r1",
          $permissions: ['read("user:joey")', 'read("team:circle_joey")'],
          $createdAt: "2026-10-01T00:00:00.000Z",
          $updatedAt: "2026-10-02T00:00:00.000Z",
          data: { load_kg: 180, reps: 3 },
        },
      ],
    });
  });

  it("orders by $id, sends cursorAfter on every page after the first, and never reads a cached page", async () => {
    const { db, users, teams, source } = fakes();
    db.listRows.mockResolvedValue({ total: 0, rows: [] });
    users.list.mockResolvedValue({ total: 0, users: [] });
    teams.list.mockResolvedValue({ total: 0, teams: [] });

    await source.rowPage("sets", null, 100);
    await source.rowPage("sets", "r100", 100);
    await source.userPage("u100", 50);
    await source.teamPage("t100", 50);

    const [first, second] = db.listRows.mock.calls.map((c) => c[0]);
    expect(first.ttl).toBe(0);
    expect(second.ttl).toBe(0);
    expect(parsed(first.queries)).toEqual([
      { method: "orderAsc", attribute: "$id" },
      { method: "limit", values: [100] },
    ]);
    expect(parsed(second.queries)).toContainEqual({ method: "cursorAfter", values: ["r100"] });
    expect(parsed(users.list.mock.calls[0][0].queries)).toContainEqual({ method: "cursorAfter", values: ["u100"] });
    expect(parsed(teams.list.mock.calls[0][0].queries)).toContainEqual({ method: "cursorAfter", values: ["t100"] });
  });

  it("dumps a blocked user as blocked, with providers and no credentials", async () => {
    const { users, source } = fakes();
    users.list.mockResolvedValue({
      total: 1,
      users: [
        {
          $id: "brandon",
          email: "b@example.com",
          name: "Brandon",
          labels: ["beta"],
          prefs: { units: "kg" },
          emailVerification: true,
          status: false,
          registration: "2026-02-01T00:00:00.000Z",
          password: "$argon2id$secret-hash",
        },
      ],
    });
    users.listIdentities.mockResolvedValue({
      total: 2,
      identities: [{ provider: "google" }, { provider: "google" }],
    });

    const page = await source.userPage(null, 100);

    expect(page.users).toEqual([
      {
        $id: "brandon",
        email: "b@example.com",
        name: "Brandon",
        labels: ["beta"],
        prefs: { units: "kg" },
        emailVerification: true,
        status: false,
        registration: "2026-02-01T00:00:00.000Z",
        providers: ["google"],
      },
    ]);
  });
});

describe("appwriteTarget (restore)", () => {
  it("putRow creates the row with its id, data and stored permissions", async () => {
    const { db, target } = fakes();
    const permissions = ['read("user:joey")', 'update("user:joey")', 'read("team:circle_joey")'];

    await expect(
      target.putRow("sets", { $id: "r1", $permissions: permissions, data: { load_kg: 180 } }),
    ).resolves.toBe("created");

    expect(db.createRow).toHaveBeenCalledWith({
      databaseId: "main",
      tableId: "sets",
      rowId: "r1",
      data: { load_kg: 180 },
      permissions,
    });
  });

  it("counts a 409 as existed, and rethrows anything else rather than calling it existed", async () => {
    const { db, target } = fakes();
    const row = { $id: "r1", $permissions: [], data: {} };

    db.createRow.mockRejectedValueOnce(conflict());
    await expect(target.putRow("sets", row)).resolves.toBe("existed");

    db.createRow.mockRejectedValueOnce(serverError());
    await expect(target.putRow("sets", row)).rejects.toThrow("Server error");

    db.createRow.mockRejectedValueOnce(new AppwriteException("Unauthorized", 401));
    await expect(target.putRow("sets", row)).rejects.toThrow("Unauthorized");

    db.createRow.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(target.putRow("sets", row)).rejects.toThrow("fetch failed");
  });

  it("ensureUser re-blocks a user dumped as blocked, and leaves an active one alone", async () => {
    const { users, target } = fakes();

    await expect(target.ensureUser(user({ $id: "blocked", status: false }))).resolves.toBe("created");
    await expect(target.ensureUser(user({ $id: "active", status: true }))).resolves.toBe("created");

    expect(users.updateStatus).toHaveBeenCalledTimes(1);
    expect(users.updateStatus).toHaveBeenCalledWith({ userId: "blocked", status: false });
  });

  it("re-blocks a blocked user who already exists, so a retried restore cannot leave them active", async () => {
    // A restore aborts on the first error. If it died between creating a
    // blocked user and blocking them, the re-run meets a 409 for that user.
    const { users, target } = fakes();
    users.create.mockRejectedValue(new AppwriteException("User already exists", 409, "user_already_exists"));

    await expect(target.ensureUser(user({ $id: "blocked", status: false }))).resolves.toBe("existed");
    await expect(target.ensureUser(user({ $id: "active", status: true }))).resolves.toBe("existed");

    expect(users.updateStatus).toHaveBeenCalledTimes(1);
    expect(users.updateStatus).toHaveBeenCalledWith({ userId: "blocked", status: false });
    // Prefs, labels and verification are only set on a fresh account: an
    // existing one may have moved on since the dump.
    expect(users.updatePrefs).not.toHaveBeenCalled();
  });

  it("ensureUser restores prefs, labels and verification on a new account", async () => {
    const { users, target } = fakes();

    await target.ensureUser(
      user({ prefs: { units: "lb" }, labels: ["coach"], emailVerification: true }),
    );

    expect(users.create).toHaveBeenCalledWith({ userId: "joey", email: "joey@example.com", name: "Joey" });
    expect(users.updatePrefs).toHaveBeenCalledWith({ userId: "joey", prefs: { units: "lb" } });
    expect(users.updateLabels).toHaveBeenCalledWith({ userId: "joey", labels: ["coach"] });
    expect(users.updateEmailVerification).toHaveBeenCalledWith({ userId: "joey", emailVerification: true });
  });

  it("ensureUser fails a user with no email instead of reporting it existed", async () => {
    const { users, target } = fakes();
    await expect(target.ensureUser(user({ email: null }))).rejects.toThrow("has no email");
    expect(users.create).not.toHaveBeenCalled();
  });

  it("ensureUser rethrows a non-409 failure", async () => {
    const { users, target } = fakes();
    users.create.mockRejectedValue(serverError());
    await expect(target.ensureUser(user())).rejects.toThrow("Server error");
    expect(users.updateStatus).not.toHaveBeenCalled();
  });

  it("ensureMembership adds the member directly with their roles, and rethrows a non-409", async () => {
    const { teams, target } = fakes();

    await expect(
      target.ensureMembership("circle_joey", { userId: "ruairi", roles: ["coach"], confirmed: true }),
    ).resolves.toBe("created");
    expect(teams.createMembership).toHaveBeenCalledWith({
      teamId: "circle_joey",
      userId: "ruairi",
      roles: ["coach"],
    });

    teams.createMembership.mockRejectedValueOnce(serverError());
    await expect(
      target.ensureMembership("circle_joey", { userId: "louis", roles: ["coach"], confirmed: true }),
    ).rejects.toThrow("Server error");
  });
});
