// @vitest-environment node
import { circleTeamId } from "@/appwrite/documents/circle";
import { appwrite, jwtFor, resetAppwrite, routeRequest, type Row } from "../route-test-kit";

/**
 * The four link routes end to end: route, link-admin and circle-admin are the
 * real modules, and only node-appwrite is replaced (see route-test-kit.ts).
 *
 * They run with the API key, which reads and writes every athlete's link. What
 * scopes each one to the caller is the JWT, so these are about who is calling:
 * no token, a bad token, and a valid token naming somebody else in the body.
 */

vi.mock("node-appwrite", async (actual) =>
  (await import("@/app/api/route-test-kit")).fakeNodeAppwrite(await actual<object>()),
);
vi.mock("@/appwrite/env", async () => (await import("@/app/api/route-test-kit")).fakeEnv);

const redeem = (await import("./route")).POST;
const resolve = (await import("./resolve/route")).POST;
const revoke = (await import("./revoke/route")).POST;
const coach = (await import("./coach/route")).GET;

const ATHLETE = "athlete_joey";
const VICTIM = "athlete_bea";
const COACH = "coach_ruairi";
const VICTIM_COACH = "coach_louis";
const CODE = "SNB-4F7K2";

const link = (coachId: string, athleteId: string, status = "active"): Row => ({
  $id: `link_${coachId}_${athleteId}`,
  coach_id: coachId,
  athlete_id: athleteId,
  status,
  linked_at: "2026-09-01T00:00:00.000Z",
});

const linksOf = (athleteId: string) =>
  (appwrite.tables.coach_athlete_links ?? []).filter((row) => row.athlete_id === athleteId);

/** A five-character body from the invite alphabet, unique per n. */
const codeNumber = (n: number) => `SNB-2${"23456789ABCDEFGHJKMNPQRSTVWXYZ"[n % 30]}${"23456789ABCDEFGHJKMNPQRSTVWXYZ"[Math.floor(n / 30) % 30]}22`;

let athleteJwt = "";
let victimJwt = "";

/**
 * The limiters live as long as the route module, which is the whole file. A
 * test that counts attempts uses an account no other test has spent from.
 */
let fresh = 0;
const freshAthlete = () => jwtFor(`athlete_fresh_${++fresh}`);

beforeEach(() => {
  resetAppwrite();
  vi.spyOn(console, "error").mockImplementation(() => {});
  athleteJwt = jwtFor({ $id: ATHLETE, name: "Joey Pang" });
  victimJwt = jwtFor({ $id: VICTIM, name: "Bea Kelly" });
  appwrite.users = [
    { $id: COACH, name: "Ruairi Deane", email: "ruairi@example.com" },
    { $id: VICTIM_COACH, name: "Louis Byrne", email: "louis@example.com" },
  ];
  appwrite.tables.invite_codes = [{ $id: CODE, coach_id: COACH }];
  // Bea is linked to Louis, and both circles exist.
  appwrite.tables.coach_athlete_links = [link(VICTIM_COACH, VICTIM)];
  appwrite.teams[circleTeamId(VICTIM)] = [
    { userId: VICTIM, roles: ["athlete"] },
    { userId: VICTIM_COACH, roles: ["coach"] },
  ];
  appwrite.teams[circleTeamId(ATHLETE)] = [{ userId: ATHLETE, roles: ["athlete"] }];
});

afterEach(() => vi.restoreAllMocks());

describe.each([
  ["POST /api/link", () => redeem, { code: CODE }],
  ["POST /api/link/resolve", () => resolve, { code: CODE }],
  ["POST /api/link/revoke", () => revoke, undefined],
  ["GET /api/link/coach", () => coach, undefined],
])("%s refuses a caller it cannot identify", (name, handler, body) => {
  const method = name.split(" ")[0];
  const call = (jwt?: string) => handler()(routeRequest("/api/link", { method, jwt, body }));

  it("401 with no token, having touched nothing", async () => {
    expect((await call()).status).toBe(401);
    expect(appwrite.writes).toEqual([]);
  });

  it("401 with a token Appwrite does not recognise", async () => {
    expect((await call("jwt-forged")).status).toBe(401);
    expect(appwrite.writes).toEqual([]);
  });
});

describe.each([
  ["POST /api/link", () => redeem],
  ["POST /api/link/resolve", () => resolve],
])("%s checks for a token before it reads the code", (_name, handler) => {
  it("401 with no token even for input that is not a code", async () => {
    // Junk is answered before identity is checked, so it is the input that
    // shows whether the token check really comes first.
    const response = await handler()(routeRequest("/api/link", { body: { code: "junk" } }));
    expect(response.status).toBe(401);
  });
});

describe("POST /api/link: redeeming", () => {
  it("links the coach to the athlete the token names", async () => {
    const response = await redeem(routeRequest("/api/link", { jwt: athleteJwt, body: { code: CODE } }));
    expect(await response.json()).toMatchObject({ status: "linked", coachId: COACH });
    expect(linksOf(ATHLETE)).toEqual([expect.objectContaining({ coach_id: COACH, status: "active" })]);
    expect(appwrite.teams[circleTeamId(ATHLETE)].map((m) => m.userId)).toContain(COACH);
  });

  it("ignores an athlete id in the body: a code cannot be redeemed onto someone else", async () => {
    await redeem(routeRequest("/api/link", { jwt: athleteJwt, body: { code: CODE, athleteId: VICTIM } }));
    expect(linksOf(VICTIM)).toEqual([link(VICTIM_COACH, VICTIM)]);
    expect(appwrite.teams[circleTeamId(VICTIM)].map((m) => m.userId)).not.toContain(COACH);
  });

  it("refuses the eleventh code from one athlete in ten minutes, from any address", async () => {
    // Per athlete, not only per address: a gym is one IP, and what is worth
    // limiting is how many codes one account can try.
    const jwt = freshAthlete();
    for (let n = 0; n < 10; n++) {
      const response = await redeem(routeRequest("/api/link", { jwt, body: { code: codeNumber(n) } }));
      expect(response.status).toBe(200);
    }
    const blocked = await redeem(routeRequest("/api/link", { jwt, body: { code: CODE } }));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    // Not even the real code gets through once the budget is spent.
    expect(appwrite.writes).toEqual([]);
  });

  it("refuses the 31st attempt from one address across many accounts", async () => {
    for (let n = 0; n < 30; n++) {
      const response = await redeem(
        routeRequest("/api/link", { jwt: freshAthlete(), body: { code: codeNumber(n) }, ip: "203.0.113.9" }),
      );
      expect(response.status).toBe(200);
    }
    const blocked = await redeem(
      routeRequest("/api/link", { jwt: freshAthlete(), body: { code: CODE }, ip: "203.0.113.9" }),
    );
    expect(blocked.status).toBe(429);
  });

  it("spends no budget on input that is not a code", async () => {
    const jwt = freshAthlete();
    for (let n = 0; n < 15; n++) {
      await redeem(routeRequest("/api/link", { jwt, body: { code: "not a code" } }));
    }
    const response = await redeem(routeRequest("/api/link", { jwt, body: { code: CODE } }));
    expect(await response.json()).toMatchObject({ status: "linked" });
  });
});

describe("POST /api/link/resolve: naming a code's coach", () => {
  it("names the coach without writing anything", async () => {
    const response = await resolve(routeRequest("/api/link/resolve", { jwt: athleteJwt, body: { code: CODE } }));
    expect(await response.json()).toEqual({ status: "found", coachId: COACH, coachName: "Ruairi Deane" });
    expect(appwrite.writes).toEqual([]);
  });

  it("refuses the eleventh lookup from one athlete: it maps codes to real names", async () => {
    const jwt = freshAthlete();
    for (let n = 0; n < 10; n++) {
      const response = await resolve(routeRequest("/api/link/resolve", { jwt, body: { code: codeNumber(n) } }));
      expect(await response.json()).toEqual({ status: "unknown-code" });
    }
    const blocked = await resolve(routeRequest("/api/link/resolve", { jwt, body: { code: CODE } }));
    expect(blocked.status).toBe(429);
  });

  it("refuses the 31st lookup from one address across many accounts", async () => {
    for (let n = 0; n < 30; n++) {
      await resolve(routeRequest("/api/link/resolve", { jwt: freshAthlete(), body: { code: codeNumber(n) }, ip: "203.0.113.10" }));
    }
    const blocked = await resolve(
      routeRequest("/api/link/resolve", { jwt: freshAthlete(), body: { code: CODE }, ip: "203.0.113.10" }),
    );
    expect(blocked.status).toBe(429);
  });
});

describe("POST /api/link/revoke: withdrawing a coach", () => {
  beforeEach(() => {
    appwrite.tables.coach_athlete_links.push(link(COACH, ATHLETE));
    appwrite.teams[circleTeamId(ATHLETE)].push({ userId: COACH, roles: ["coach"] });
  });

  it("withdraws the caller's own coach", async () => {
    const response = await revoke(routeRequest("/api/link/revoke", { jwt: athleteJwt }));
    expect(await response.json()).toEqual({ status: "unlinked", coachId: COACH });
    expect(linksOf(ATHLETE)[0].status).toBe("revoked");
    expect(appwrite.teams[circleTeamId(ATHLETE)].map((m) => m.userId)).toEqual([ATHLETE]);
  });

  it("never touches another athlete's link, whatever the body names", async () => {
    await revoke(routeRequest("/api/link/revoke", { jwt: athleteJwt, body: { athleteId: VICTIM, coachId: VICTIM_COACH } }));
    expect(linksOf(VICTIM)).toEqual([link(VICTIM_COACH, VICTIM)]);
    expect(appwrite.teams[circleTeamId(VICTIM)].map((m) => m.userId)).toContain(VICTIM_COACH);
    expect(appwrite.writes.every((w) => w.rowId === `link_${COACH}_${ATHLETE}`)).toBe(true);
  });

  it("answers a second tap as done rather than limiting it", async () => {
    // Deliberately not rate limited: withdrawing consent must never be refused.
    await revoke(routeRequest("/api/link/revoke", { jwt: athleteJwt }));
    const again = await revoke(routeRequest("/api/link/revoke", { jwt: athleteJwt }));
    expect(await again.json()).toEqual({ status: "not-linked" });
  });
});

describe("GET /api/link/coach: the caller's coach", () => {
  it("names only the caller's own coach", async () => {
    // Bea is linked; Joey is not. Joey asking must not be told about Bea's coach.
    const mine = await coach(routeRequest("/api/link/coach", { method: "GET", jwt: athleteJwt }));
    expect(await mine.json()).toEqual({ status: "none" });

    const hers = await coach(routeRequest("/api/link/coach", { method: "GET", jwt: victimJwt }));
    expect(await hers.json()).toMatchObject({ status: "linked", coachId: VICTIM_COACH, coachName: "Louis Byrne" });
  });

  it("never carries the coach's email", async () => {
    const response = await coach(routeRequest("/api/link/coach", { method: "GET", jwt: victimJwt }));
    expect(JSON.stringify(await response.json())).not.toContain("louis@example.com");
  });
});
