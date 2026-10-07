// @vitest-environment node
import { appwrite, jwtFor, resetAppwrite, routeRequest } from "../route-test-kit";

/**
 * Minting a coach's invite code. The route and invite-admin are real; only
 * node-appwrite is replaced (see route-test-kit.ts). The code's coach_id is
 * what hands athletes to a coach, so it must come from the token alone.
 */

vi.mock("node-appwrite", async (actual) =>
  (await import("@/app/api/route-test-kit")).fakeNodeAppwrite(await actual<object>()),
);
vi.mock("@/appwrite/env", async () => (await import("@/app/api/route-test-kit")).fakeEnv);

const { POST } = await import("./route");

const COACH = "coach_ruairi";
const OTHER = "coach_louis";

beforeEach(() => {
  resetAppwrite();
  vi.spyOn(console, "error").mockImplementation(() => {});
  appwrite.tables.invite_codes = [{ $id: "SNB-L0U1S", coach_id: OTHER }];
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/invite", () => {
  it("401 with no token, minting nothing", async () => {
    expect((await POST(routeRequest("/api/invite"))).status).toBe(401);
    expect(appwrite.writes).toEqual([]);
  });

  it("401 with a token Appwrite does not recognise", async () => {
    expect((await POST(routeRequest("/api/invite", { jwt: "jwt-forged" }))).status).toBe(401);
    expect(appwrite.writes).toEqual([]);
  });

  it("mints a code for the coach the token names", async () => {
    const response = await POST(routeRequest("/api/invite", { jwt: jwtFor(COACH) }));
    const { code, created } = (await response.json()) as { code: string; created: boolean };
    expect(created).toBe(true);
    expect(appwrite.tables.invite_codes.find((row) => row.$id === code)?.coach_id).toBe(COACH);
  });

  it("ignores a coach id in the body: a code minted for someone else would hand you their athletes", async () => {
    const response = await POST(routeRequest("/api/invite", { jwt: jwtFor(COACH), body: { coachId: OTHER } }));
    const { code } = (await response.json()) as { code: string };
    expect(code).not.toBe("SNB-L0U1S");
    expect(appwrite.tables.invite_codes.find((row) => row.$id === code)?.coach_id).toBe(COACH);
  });

  it("hands back the same code on a second tap", async () => {
    const jwt = jwtFor(COACH);
    const first = (await (await POST(routeRequest("/api/invite", { jwt }))).json()) as { code: string };
    const second = (await (await POST(routeRequest("/api/invite", { jwt }))).json()) as { code: string; created: boolean };
    expect(second).toEqual({ code: first.code, created: false });
  });
});
