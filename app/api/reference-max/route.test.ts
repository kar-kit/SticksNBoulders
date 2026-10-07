// @vitest-environment node
import { appwrite, jwtFor, resetAppwrite, routeRequest, type Row } from "../route-test-kit";

/**
 * Setting and removing reference maxes. The route and reference-max-admin are
 * real; only node-appwrite is replaced (see route-test-kit.ts). The body names
 * an athlete -- a coach writes for theirs -- so the boundary is the active
 * link between the token's user and that athlete.
 */

vi.mock("node-appwrite", async (actual) =>
  (await import("@/app/api/route-test-kit")).fakeNodeAppwrite(await actual<object>()),
);
vi.mock("@/appwrite/env", async () => (await import("@/app/api/route-test-kit")).fakeEnv);

const { POST, DELETE } = await import("./route");

const ATHLETE = "athlete_joey";
const COACH = "coach_ruairi";
const STRANGER = "user_stranger";

const max = { athleteId: ATHLETE, exerciseId: "squat", kind: "tested", valueKg: 180 };
const maxesOf = (athleteId: string) => (appwrite.tables.reference_maxes ?? []).filter((r) => r.athlete_id === athleteId);
const existing: Row = { $id: "max_1", athlete_id: ATHLETE, exercise_id: "squat", kind: "tested", value_kg: 170 };

beforeEach(() => {
  resetAppwrite();
  vi.spyOn(console, "error").mockImplementation(() => {});
  appwrite.tables.coach_athlete_links = [
    { $id: "link_1", coach_id: COACH, athlete_id: ATHLETE, status: "active" },
    { $id: "link_2", coach_id: STRANGER, athlete_id: ATHLETE, status: "revoked" },
  ];
  appwrite.tables.reference_maxes = [{ ...existing }];
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/reference-max", () => {
  it("401 with no token, writing nothing", async () => {
    expect((await POST(routeRequest("/api/reference-max", { body: max }))).status).toBe(401);
    expect(appwrite.writes).toEqual([]);
  });

  it("401 with a token Appwrite does not recognise", async () => {
    expect((await POST(routeRequest("/api/reference-max", { jwt: "jwt-forged", body: max }))).status).toBe(401);
    expect(appwrite.writes).toEqual([]);
  });

  it("lets the athlete's active coach set it", async () => {
    const response = await POST(routeRequest("/api/reference-max", { jwt: jwtFor(COACH), body: max }));
    expect(await response.json()).toMatchObject({ status: "created" });
    expect(maxesOf(ATHLETE)).toHaveLength(2);
  });

  it("refuses a caller with no active link to the athlete named", async () => {
    // STRANGER's link was revoked; a revoked coach is a stranger.
    const response = await POST(routeRequest("/api/reference-max", { jwt: jwtFor(STRANGER), body: max }));
    expect(response.status).toBe(403);
    expect(appwrite.writes).toEqual([]);
  });
});

describe("DELETE /api/reference-max", () => {
  const remove = (jwt?: string) =>
    DELETE(routeRequest("/api/reference-max?id=max_1", { method: "DELETE", jwt }));

  it("401 with no token, deleting nothing", async () => {
    expect((await remove()).status).toBe(401);
    expect(maxesOf(ATHLETE)).toHaveLength(1);
  });

  it("refuses a stranger: whose row it is comes from the row, not the caller", async () => {
    expect((await remove(jwtFor(STRANGER))).status).toBe(403);
    expect(maxesOf(ATHLETE)).toHaveLength(1);
  });

  it("lets the athlete remove their own", async () => {
    expect(await (await remove(jwtFor(ATHLETE))).json()).toEqual({ status: "removed" });
    expect(maxesOf(ATHLETE)).toEqual([]);
  });
});
