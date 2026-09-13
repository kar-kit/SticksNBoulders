import main from "../main.js";

const listMemberships = jest.fn();
const listRows = jest.fn();
const createRow = jest.fn();

// node-appwrite isn't installed at the repo root (each Appwrite Function is deployed
// with its own node_modules), so this must be a virtual mock rather than a real one.
jest.mock(
  "node-appwrite",
  () => ({
    Client: jest.fn().mockImplementation(() => ({
      setEndpoint: jest.fn().mockReturnThis(),
      setProject: jest.fn().mockReturnThis(),
      setKey: jest.fn().mockReturnThis(),
    })),
    Teams: jest.fn().mockImplementation(() => ({ listMemberships })),
    TablesDB: jest.fn().mockImplementation(() => ({ listRows, createRow })),
    ID: { unique: () => "unique-id" },
    Query: {
      equal: (attr, value) => `equal(${attr},${value})`,
    },
  }),
  { virtual: true }
);

function makeReq({ userId, body }) {
  return {
    headers: userId ? { "x-appwrite-user-id": userId } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

function makeRes() {
  return { json: jest.fn((data, status = 200) => ({ data, status })) };
}

beforeEach(() => {
  listMemberships.mockReset();
  listRows.mockReset();
  createRow.mockReset();
});

describe("team-invite-create main", () => {
  it("rejects requests with no authenticated user", async () => {
    const res = makeRes();
    await main({ req: makeReq({ body: { teamId: "team-1" } }), res, error: jest.fn() });
    expect(res.json).toHaveBeenCalledWith({ error: "Unauthorized" }, 401);
  });

  it("rejects requests missing a teamId", async () => {
    const res = makeRes();
    await main({ req: makeReq({ userId: "user-1", body: {} }), res, error: jest.fn() });
    expect(res.json).toHaveBeenCalledWith({ error: "teamId is required" }, 400);
  });

  it("rejects users who aren't members of the team", async () => {
    listMemberships.mockResolvedValue({ total: 0, memberships: [] });
    const res = makeRes();
    await main({
      req: makeReq({ userId: "user-1", body: { teamId: "team-1" } }),
      res,
      error: jest.fn(),
    });
    expect(listMemberships).toHaveBeenCalledWith("team-1", ["equal(userId,user-1)"]);
    expect(res.json).toHaveBeenCalledWith({ error: "Not a member of this team" }, 403);
    expect(createRow).not.toHaveBeenCalled();
  });

  it("returns the existing active code instead of minting a new one", async () => {
    listMemberships.mockResolvedValue({ total: 1, memberships: [{}] });
    listRows.mockResolvedValue({ total: 1, rows: [{ code: "EXISTING1" }] });
    const res = makeRes();
    await main({
      req: makeReq({ userId: "user-1", body: { teamId: "team-1" } }),
      res,
      error: jest.fn(),
    });
    expect(res.json).toHaveBeenCalledWith({ code: "EXISTING1" });
    expect(createRow).not.toHaveBeenCalled();
  });

  it("mints and persists a new code when none is active", async () => {
    listMemberships.mockResolvedValue({ total: 1, memberships: [{}] });
    listRows.mockResolvedValue({ total: 0, rows: [] });
    createRow.mockResolvedValue({});
    const res = makeRes();
    await main({
      req: makeReq({ userId: "user-1", body: { teamId: "team-1" } }),
      res,
      error: jest.fn(),
    });
    expect(createRow).toHaveBeenCalledWith(
      "sticksnboulders",
      "team_invite_codes",
      "unique-id",
      expect.objectContaining({ teamId: "team-1", active: true })
    );
    const [payload] = res.json.mock.calls[0];
    expect(payload.code).toMatch(/^[A-Z0-9]{8}$/);
  });

  it("returns a generic 500 and logs the real error when the datastore call fails", async () => {
    listMemberships.mockResolvedValue({ total: 1, memberships: [{}] });
    listRows.mockRejectedValue(new Error("missing scope: databases.read"));
    const res = makeRes();
    const error = jest.fn();
    await main({
      req: makeReq({ userId: "user-1", body: { teamId: "team-1" } }),
      res,
      error,
    });
    expect(error).toHaveBeenCalledWith("missing scope: databases.read");
    expect(res.json).toHaveBeenCalledWith({ error: "Failed to create invite code" }, 500);
  });
});
