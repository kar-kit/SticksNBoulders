import {
  findOpenSession,
  createSession,
  findOrCreateOpenSession,
  endSession,
} from "../workout-session";
import { tablesDB } from "../appwrite";
import { getAthleteDataPermissions } from "../permissions";

jest.mock("../appwrite", () => ({
  tablesDB: { listRows: jest.fn(), createRow: jest.fn(), updateRow: jest.fn() },
}));
jest.mock("../permissions", () => ({
  getAthleteDataPermissions: jest.fn(),
}));

const listRows = tablesDB.listRows as jest.Mock;
const createRow = tablesDB.createRow as jest.Mock;
const updateRow = tablesDB.updateRow as jest.Mock;
const getAthleteDataPermissionsMock = getAthleteDataPermissions as jest.Mock;

describe("findOpenSession", () => {
  beforeEach(() => listRows.mockReset());

  it("returns the open session when one exists", async () => {
    const session = { $id: "s1", userId: "u1", startedAt: "t", endedAt: null };
    listRows.mockResolvedValue({ rows: [session], total: 1 });

    expect(await findOpenSession("u1")).toBe(session);
  });

  it("returns null when there is no open session", async () => {
    listRows.mockResolvedValue({ rows: [], total: 0 });
    expect(await findOpenSession("u1")).toBeNull();
  });

  it("queries for endedAt being null, scoped to the user, newest first", async () => {
    listRows.mockResolvedValue({ rows: [], total: 0 });
    await findOpenSession("u1");

    const queries: string[] = listRows.mock.calls[0][2];
    expect(queries.some((q) => q.includes("userId") && q.includes("u1"))).toBe(true);
    expect(queries.some((q) => q.includes("isNull") && q.includes("endedAt"))).toBe(true);
  });
});

describe("createSession", () => {
  beforeEach(() => {
    createRow.mockReset();
    getAthleteDataPermissionsMock.mockReset();
    getAthleteDataPermissionsMock.mockResolvedValue(["read(\"user:u1\")"]);
  });

  it("creates a row with startedAt set and endedAt null", async () => {
    createRow.mockResolvedValue({ $id: "new-session", userId: "u1", endedAt: null });

    await createSession("u1");

    const data = createRow.mock.calls[0][3];
    expect(data.userId).toBe("u1");
    expect(data.endedAt).toBeNull();
    expect(typeof data.startedAt).toBe("string");
    expect(() => new Date(data.startedAt).toISOString()).not.toThrow();
  });

  it("passes the athlete's data permissions to the created row", async () => {
    createRow.mockResolvedValue({ $id: "new-session" });
    await createSession("u1");
    expect(createRow.mock.calls[0][4]).toEqual(["read(\"user:u1\")"]);
  });
});

describe("findOrCreateOpenSession", () => {
  beforeEach(() => {
    listRows.mockReset();
    createRow.mockReset();
    getAthleteDataPermissionsMock.mockReset();
    getAthleteDataPermissionsMock.mockResolvedValue([]);
  });

  it("returns the existing open session without creating a new one", async () => {
    const existing = { $id: "existing", endedAt: null };
    listRows.mockResolvedValue({ rows: [existing], total: 1 });

    const result = await findOrCreateOpenSession("u1");

    expect(result).toBe(existing);
    expect(createRow).not.toHaveBeenCalled();
  });

  it("creates a new session when none is open", async () => {
    listRows.mockResolvedValue({ rows: [], total: 0 });
    createRow.mockResolvedValue({ $id: "brand-new" });

    const result = await findOrCreateOpenSession("u1");

    expect(createRow).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ $id: "brand-new" });
  });
});

describe("endSession", () => {
  beforeEach(() => updateRow.mockReset());

  it("sets endedAt to a fresh ISO timestamp", async () => {
    updateRow.mockResolvedValue({ $id: "s1", endedAt: "whatever" });

    await endSession("s1");

    const data = updateRow.mock.calls[0][3];
    expect(typeof data.endedAt).toBe("string");
    expect(() => new Date(data.endedAt).toISOString()).not.toThrow();
  });

  it("targets the given session id", async () => {
    updateRow.mockResolvedValue({});
    await endSession("session-42");
    expect(updateRow.mock.calls[0][2]).toBe("session-42");
  });
});
