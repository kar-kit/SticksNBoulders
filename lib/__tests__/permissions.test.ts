import { getAthleteDataPermissions, getProgramPermissions } from "../permissions";
import { tablesDB } from "../appwrite";

jest.mock("../appwrite", () => ({
  tablesDB: { listRows: jest.fn() },
}));

const listRows = tablesDB.listRows as jest.Mock;

describe("getAthleteDataPermissions", () => {
  beforeEach(() => {
    listRows.mockReset();
  });

  it("grants only self read/update/delete when there are no active coach links", async () => {
    listRows.mockResolvedValue({ rows: [], total: 0 });

    const permissions = await getAthleteDataPermissions("athlete-1");

    expect(permissions).toEqual([
      'read("user:athlete-1")',
      'update("user:athlete-1")',
      'delete("user:athlete-1")',
    ]);
  });

  it("adds a read permission for each active coach link", async () => {
    listRows.mockResolvedValue({
      rows: [
        { coachUserId: "coach-1" },
        { coachUserId: "coach-2" },
      ],
      total: 2,
    });

    const permissions = await getAthleteDataPermissions("athlete-1");

    expect(permissions).toEqual([
      'read("user:athlete-1")',
      'update("user:athlete-1")',
      'delete("user:athlete-1")',
      'read("user:coach-1")',
      'read("user:coach-2")',
    ]);
  });

  it("never grants a coach update or delete permission, only read", async () => {
    listRows.mockResolvedValue({ rows: [{ coachUserId: "coach-1" }], total: 1 });

    const permissions = await getAthleteDataPermissions("athlete-1");

    expect(permissions).not.toContain('update("user:coach-1")');
    expect(permissions).not.toContain('delete("user:coach-1")');
  });

  it("queries only active links scoped to the given athlete", async () => {
    listRows.mockResolvedValue({ rows: [], total: 0 });

    await getAthleteDataPermissions("athlete-42");

    const queries: string[] = listRows.mock.calls[0][2];
    expect(queries.some((q) => q.includes("athleteUserId") && q.includes("athlete-42"))).toBe(true);
    expect(queries.some((q) => q.includes("status") && q.includes("active"))).toBe(true);
  });
});

describe("getProgramPermissions", () => {
  it("grants the coach full access and the athlete read-only", () => {
    const permissions = getProgramPermissions("coach-1", "athlete-1");
    expect(permissions).toEqual([
      'read("user:coach-1")',
      'update("user:coach-1")',
      'delete("user:coach-1")',
      'read("user:athlete-1")',
    ]);
  });

  it("never grants the athlete update or delete", () => {
    const permissions = getProgramPermissions("coach-1", "athlete-1");
    expect(permissions).not.toContain('update("user:athlete-1")');
    expect(permissions).not.toContain('delete("user:athlete-1")');
  });

  it("is a pure synchronous function requiring no network calls", () => {
    expect(() => getProgramPermissions("a", "b")).not.toThrow();
  });
});
