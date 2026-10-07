// @vitest-environment node
import { appwrite, jwtFor, resetAppwrite, routeRequest } from "../route-test-kit";

/**
 * The program write endpoint. The route and program-admin are real; only
 * node-appwrite is replaced (see route-test-kit.ts). program-admin.test.ts
 * covers every op; this covers the edge: who the caller is.
 */

vi.mock("node-appwrite", async (actual) =>
  (await import("@/app/api/route-test-kit")).fakeNodeAppwrite(await actual<object>()),
);
vi.mock("@/appwrite/env", async () => (await import("@/app/api/route-test-kit")).fakeEnv);

const { POST } = await import("./route");

const ATHLETE = "athlete_joey";
const COACH = "coach_ruairi";
const STRANGER = "user_stranger";

const op = { op: "createProgram", athleteId: ATHLETE, name: "Block 1" };

beforeEach(() => {
  resetAppwrite();
  vi.spyOn(console, "error").mockImplementation(() => {});
  appwrite.tables.coach_athlete_links = [{ $id: "link_1", coach_id: COACH, athlete_id: ATHLETE, status: "active" }];
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/program", () => {
  it("401 with no token, writing nothing", async () => {
    expect((await POST(routeRequest("/api/program", { body: op }))).status).toBe(401);
    expect(appwrite.writes).toEqual([]);
  });

  it("401 with a token Appwrite does not recognise", async () => {
    expect((await POST(routeRequest("/api/program", { jwt: "jwt-forged", body: op }))).status).toBe(401);
    expect(appwrite.writes).toEqual([]);
  });

  it("lets the athlete's active coach create one", async () => {
    const response = await POST(routeRequest("/api/program", { jwt: jwtFor(COACH), body: op }));
    expect(response.status).toBe(200);
    expect(appwrite.tables.programs).toEqual([expect.objectContaining({ coach_id: COACH, athlete_id: ATHLETE })]);
  });

  it("refuses a stranger, even one naming the coach in the body", async () => {
    const response = await POST(routeRequest("/api/program", { jwt: jwtFor(STRANGER), body: { ...op, coachId: COACH } }));
    expect(response.status).toBe(403);
    expect(appwrite.writes).toEqual([]);
  });
});
