// @vitest-environment node
import { setPermissions } from "@/appwrite/documents/policy";
import { appwrite, jwtFor, resetAppwrite, routeRequest, type Row } from "../route-test-kit";

/**
 * Rebuilding a weekly rollup. The route and rollup-admin are real; only
 * node-appwrite is replaced (see route-test-kit.ts). The rollup is every chart
 * and PR, so whose sets it is rebuilt from must be the token's, never the body's.
 */

vi.mock("node-appwrite", async (actual) =>
  (await import("@/app/api/route-test-kit")).fakeNodeAppwrite(await actual<object>()),
);
vi.mock("@/appwrite/env", async () => (await import("@/app/api/route-test-kit")).fakeEnv);

const { POST } = await import("./route");

const ATHLETE = "athlete_joey";
const VICTIM = "athlete_bea";
const WEDNESDAY = "2026-09-16T18:00:00.000Z";

const set = (id: string, athleteId: string, loadKg: number): Row => ({
  $id: id,
  $permissions: setPermissions({ athleteId }),
  athlete_id: athleteId,
  exercise_id: "squat",
  load_kg: loadKg,
  reps: 5,
  is_warmup: false,
  e1rm_kg: null,
  logged_at: WEDNESDAY,
});

const rollupsOf = (athleteId: string) => (appwrite.tables.stats_rollups ?? []).filter((r) => r.athlete_id === athleteId);
const body = { exerciseId: "squat", loggedAt: WEDNESDAY };

beforeEach(() => {
  resetAppwrite();
  vi.spyOn(console, "error").mockImplementation(() => {});
  appwrite.tables.sets = [set("joey-1", ATHLETE, 140), set("bea-1", VICTIM, 100)];
  appwrite.tables.stats_rollups = [];
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/rollup", () => {
  it("401 with no token, writing nothing", async () => {
    expect((await POST(routeRequest("/api/rollup", { body }))).status).toBe(401);
    expect(appwrite.writes).toEqual([]);
  });

  it("401 with a token Appwrite does not recognise", async () => {
    expect((await POST(routeRequest("/api/rollup", { jwt: "jwt-forged", body }))).status).toBe(401);
    expect(appwrite.writes).toEqual([]);
  });

  it("rebuilds the caller's week from the caller's sets", async () => {
    const response = await POST(routeRequest("/api/rollup", { jwt: jwtFor(ATHLETE), body }));
    expect(await response.json()).toMatchObject({ status: "written" });
    expect(rollupsOf(ATHLETE)).toEqual([expect.objectContaining({ set_count: 1, tonnage_kg: 700 })]);
  });

  it("ignores an athlete id in the body: nobody rewrites somebody else's totals", async () => {
    await POST(routeRequest("/api/rollup", { jwt: jwtFor(ATHLETE), body: { ...body, athleteId: VICTIM } }));
    expect(rollupsOf(VICTIM)).toEqual([]);
  });
});
