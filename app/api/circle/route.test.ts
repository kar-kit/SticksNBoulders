// @vitest-environment node
import { circleTeamId } from "@/appwrite/documents/circle";
import { appwrite, jwtFor, resetAppwrite, routeRequest } from "../route-test-kit";

/**
 * Creating an athlete's circle team. The route and circle-admin are real; only
 * node-appwrite is replaced (see route-test-kit.ts). Membership of a circle is
 * read access to everything that athlete logs, so who gets added is the point.
 */

vi.mock("node-appwrite", async (actual) =>
  (await import("@/app/api/route-test-kit")).fakeNodeAppwrite(await actual<object>()),
);
vi.mock("@/appwrite/env", async () => (await import("@/app/api/route-test-kit")).fakeEnv);

const { POST } = await import("./route");

const ATHLETE = "athlete_joey";
const VICTIM = "athlete_bea";

beforeEach(() => {
  resetAppwrite();
  vi.spyOn(console, "error").mockImplementation(() => {});
  appwrite.teams[circleTeamId(VICTIM)] = [{ userId: VICTIM, roles: ["athlete"] }];
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/circle", () => {
  it("401 with no token, creating nothing", async () => {
    expect((await POST(routeRequest("/api/circle"))).status).toBe(401);
    expect(Object.keys(appwrite.teams)).toEqual([circleTeamId(VICTIM)]);
  });

  it("401 with a token Appwrite does not recognise", async () => {
    expect((await POST(routeRequest("/api/circle", { jwt: "jwt-forged" }))).status).toBe(401);
    expect(Object.keys(appwrite.teams)).toEqual([circleTeamId(VICTIM)]);
  });

  it("creates the caller's own circle with the caller in it", async () => {
    const response = await POST(routeRequest("/api/circle", { jwt: jwtFor(ATHLETE) }));
    expect(await response.json()).toEqual({ teamId: circleTeamId(ATHLETE) });
    expect(appwrite.teams[circleTeamId(ATHLETE)]).toEqual([{ userId: ATHLETE, roles: ["athlete"] }]);
  });

  it("acts only on the caller's circle, whatever the body names", async () => {
    const NEWCOMER = "athlete_new";
    await POST(routeRequest("/api/circle", { jwt: jwtFor(ATHLETE), body: { userId: NEWCOMER, teamId: circleTeamId(NEWCOMER) } }));
    // No circle made for someone who did not ask, under a name they did not choose.
    expect(appwrite.teams[circleTeamId(NEWCOMER)]).toBeUndefined();
    expect(appwrite.teams[circleTeamId(ATHLETE)]).toEqual([{ userId: ATHLETE, roles: ["athlete"] }]);
    expect(appwrite.teams[circleTeamId(VICTIM)]).toEqual([{ userId: VICTIM, roles: ["athlete"] }]);
  });
});
