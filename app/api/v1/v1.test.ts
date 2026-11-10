// @vitest-environment node
import { circleTeamId } from "@/appwrite/documents/circle";
import {
  exercisePermissions,
  profilePermissions,
  programPermissions,
  referenceMaxPermissions,
  rollupPermissions,
  sessionPermissions,
  setPermissions,
} from "@/appwrite/documents/policy";
import { basisMaxesFor, lineSummaries, planDay, referenceLookup, targetsFor } from "@/lib/programming/session-plan";
import { parsePrescriptionRow } from "@/lib/programming/program";
import { appwrite, jwtFor, resetAppwrite, routeRequest, type Row } from "../route-test-kit";

/**
 * F29's read API, end to end through the real routes, the real token check,
 * the real readers and the real arithmetic; only node-appwrite is replaced.
 * The fake applies row permissions to a JWT client the way Appwrite does,
 * so "reads go through the owner's JWT" is something these tests can see.
 */

vi.mock("node-appwrite", async (actual) =>
  (await import("@/app/api/route-test-kit")).fakeNodeAppwrite(await actual<object>()),
);
vi.mock("@/appwrite/env", async () => (await import("@/app/api/route-test-kit")).fakeEnv);

const { POST: mintRoute } = await import("../tokens/route");
const { DELETE: revokeRoute } = await import("../tokens/[id]/route");
const meRoute = await import("./me/route");
const sessionsRoute = await import("./sessions/route");
const sessionRoute = await import("./sessions/[id]/route");
const programRoute = await import("./program/current/route");
const maxesRoute = await import("./maxes/route");
const { TablesDB } = (await import("node-appwrite")) as unknown as { TablesDB: { prototype: { createRow: (...a: unknown[]) => unknown } } };

const JOEY = "joey";
const COACH = "ruairi";
const OTHER = "sam"; // another athlete Ruairi coaches
const STRANGER = "stranger";
const SQUAT = "ex_squat";
const BENCH = "ex_bench";
const VIDEO = "vid_secret_clip";

type Handler = (request: Request, context?: { params: Promise<{ id: string }> }) => Promise<Response>;
const get = (route: { GET: Handler }, url: string, token?: string, context?: { params: Promise<{ id: string }> }) => {
  const request = routeRequest(url, { method: "GET" });
  if (token) request.headers.set("authorization", `Bearer ${token}`);
  return route.GET(request, context);
};
const session = (id: string) => (token?: string) =>
  get(sessionRoute as unknown as { GET: Handler }, `/api/v1/sessions/${id}`, token, { params: Promise.resolve({ id }) });

async function tokenFor(user: string, label = "Rubble"): Promise<{ id: string; token: string }> {
  const response = await mintRoute(routeRequest("/api/tokens", { jwt: jwtFor(user), body: { label } }));
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string; token: string };
}

const audit = () => appwrite.tables.api_requests ?? [];

/* -------------------------------------------------------------------------
 * A small instance: Joey's training, Sam's, and Ruairi coaching both
 * ---------------------------------------------------------------------- */

const seed = (table: string, rows: Row[]) => (appwrite.tables[table] ??= []).push(...rows);

function seedWorld() {
  appwrite.teams[circleTeamId(JOEY)] = [{ userId: COACH, roles: ["coach"] }];
  appwrite.teams[circleTeamId(OTHER)] = [{ userId: COACH, roles: ["coach"] }];

  seed("profiles", [
    { $id: JOEY, user_id: JOEY, display_name: "Joey", units: "kg", $permissions: profilePermissions({ athleteId: JOEY }) },
  ]);
  seed("exercises", [
    { $id: SQUAT, name: "Squat", is_global: true, $permissions: exercisePermissions({ athleteId: "library", isGlobal: true }) },
    { $id: BENCH, name: "Bench Press", is_global: true, $permissions: exercisePermissions({ athleteId: "library", isGlobal: true }) },
  ]);
  const sessionRow = (id: string, athlete: string, startedAt: string, extra: Record<string, unknown> = {}): Row => ({
    $id: id,
    athlete_id: athlete,
    started_at: startedAt,
    finished_at: startedAt,
    set_count: 2,
    tonnage_kg: 1000,
    client_session_id: id,
    $permissions: sessionPermissions({ athleteId: athlete }),
    ...extra,
  });
  seed("sessions", [
    sessionRow("s1", JOEY, "2026-11-01T09:00:00.000Z"),
    sessionRow("s2", JOEY, "2026-11-05T09:00:00.000Z", { name: "Heavy singles" }),
    sessionRow("s3", JOEY, "2026-11-08T09:00:00.000Z", { notes: "Felt good", set_count: 2, tonnage_kg: 1250 }),
    sessionRow("sam1", OTHER, "2026-11-07T09:00:00.000Z"),
    sessionRow("str1", STRANGER, "2026-11-06T09:00:00.000Z"),
    // Forged into Joey's history by a stranger: readable by everyone, but
    // without Joey's own update stamp nobody trusts it.
    { ...sessionRow("forged", JOEY, "2026-11-09T09:00:00.000Z"), $permissions: ['read("users")'] },
  ]);
  const setRow = (id: string, sessionId: string, exerciseId: string, index: number, load: number, reps: number, extra: Record<string, unknown> = {}): Row => ({
    $id: id,
    session_id: sessionId,
    athlete_id: JOEY,
    exercise_id: exerciseId,
    set_index: index,
    load_kg: load,
    reps,
    rpe: 8,
    is_warmup: false,
    logged_at: `2026-11-08T09:${String(10 + index).padStart(2, "0")}:00.000Z`,
    client_set_id: id,
    $permissions: setPermissions({ athleteId: JOEY }),
    ...extra,
  });
  seed("sets", [
    setRow("set_b1", "s3", BENCH, 1, 100, 5, { logged_at: "2026-11-08T09:40:00.000Z" }),
    setRow("set_w", "s3", SQUAT, 0, 60, 5, { is_warmup: true, rpe: null }),
    setRow("set_1", "s3", SQUAT, 1, 150, 5, { video_file_id: VIDEO, notes: "Depth ok?" }),
    setRow("set_2", "s3", SQUAT, 2, 150, 3, { failed: true }),
  ]);

  // My Program: one published week, one draft week the athlete must never see.
  const owner = { coach_id: COACH, athlete_id: JOEY, program_id: "p1" };
  const stamp = programPermissions({ coachId: COACH, athleteId: JOEY });
  seed("programs", [
    { $id: "p1", coach_id: COACH, athlete_id: JOEY, name: "Block 3", status: "published", start_on: "2026-11-02", created_at: "2026-10-30T00:00:00.000Z", updated_at: "2026-10-31T00:00:00.000Z", $permissions: stamp },
  ]);
  seed("program_blocks", [{ $id: "b1", ...owner, position: 0, name: "Strength", $permissions: stamp }]);
  seed("program_weeks", [
    { $id: "w1", ...owner, block_id: "b1", position: 0, label: "Week 1", status: "published", $permissions: stamp },
    { $id: "w2", ...owner, block_id: "b1", position: 1, label: "Week 2", status: "draft", $permissions: stamp },
  ]);
  seed("program_days", [
    { $id: "d1", ...owner, block_id: "b1", week_id: "w1", position: 0, label: "Squat day", scheduled_on: "2026-11-09", $permissions: stamp },
    { $id: "d2", ...owner, block_id: "b1", week_id: "w2", position: 0, label: "Draft day", scheduled_on: "2026-11-16", $permissions: stamp },
  ]);
  const line = (id: string, week: string, day: string, exerciseId: string, load: string): Row => ({
    $id: id, ...owner, week_id: week, day_id: day, exercise_id: exerciseId, position: 0, set_count: 3, reps: 5,
    load, load_kind: "percent", updated_at: "2026-10-31T00:00:00.000Z", $permissions: stamp,
  });
  seed("prescriptions", [line("rx1", "w1", "d1", SQUAT, "75%"), line("rx_bench", "w1", "d1", BENCH, "80%"), line("rx2", "w2", "d2", SQUAT, "95%")]);
  appwrite.tables.prescriptions[1].position = 1;

  seed("reference_maxes", [
    { $id: "max_1", athlete_id: JOEY, exercise_id: SQUAT, kind: "training", value_kg: 200, effective_from: "2026-01-01T00:00:00.000Z", recorded_by: COACH, $permissions: referenceMaxPermissions({ athleteId: JOEY }) },
    { $id: "max_2", athlete_id: JOEY, exercise_id: SQUAT, kind: "tested", value_kg: 210, effective_from: "2026-06-01T00:00:00.000Z", recorded_by: JOEY, $permissions: referenceMaxPermissions({ athleteId: JOEY }) },
    // Next block's, dated ahead: not in effect, so not the number today.
    { $id: "max_3", athlete_id: JOEY, exercise_id: SQUAT, kind: "training", value_kg: 260, effective_from: "2099-01-01T00:00:00.000Z", recorded_by: COACH, $permissions: referenceMaxPermissions({ athleteId: JOEY }) },
    { $id: "max_sam", athlete_id: OTHER, exercise_id: SQUAT, kind: "training", value_kg: 300, effective_from: "2026-01-01T00:00:00.000Z", recorded_by: COACH, $permissions: referenceMaxPermissions({ athleteId: OTHER }) },
  ]);
  seed("stats_rollups", [
    { $id: "r1", athlete_id: JOEY, exercise_id: SQUAT, week_start: "2026-10-26T00:00:00.000Z", best_e1rm_kg: 190, $permissions: rollupPermissions({ athleteId: JOEY }) },
    { $id: "r2", athlete_id: JOEY, exercise_id: SQUAT, week_start: "2026-11-02T00:00:00.000Z", best_e1rm_kg: 175, $permissions: rollupPermissions({ athleteId: JOEY }) },
    { $id: "r3", athlete_id: JOEY, exercise_id: BENCH, week_start: "2026-11-02T00:00:00.000Z", best_e1rm_kg: 115, $permissions: rollupPermissions({ athleteId: JOEY }) },
  ]);
}

let joey: { id: string; token: string };

beforeEach(async () => {
  resetAppwrite();
  vi.stubEnv("API_TOKEN_USER_IDS", `${JOEY},${COACH}`);
  vi.spyOn(console, "error").mockImplementation(() => {});
  seedWorld();
  joey = await tokenFor(JOEY);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("auth", () => {
  it("answers a good token, reading as its owner on a short JWT and never with the key", async () => {
    const response = await get(meRoute, "/api/v1/me", joey.token);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ id: JOEY, displayName: "Joey", units: "kg", token: { id: joey.id, label: "Rubble" } });
    expect(appwrite.minted).toEqual([expect.objectContaining({ userId: JOEY, duration: 60 })]);
    expect(appwrite.jwtReads.some((r) => r.userId === JOEY && r.tableId === "profiles")).toBe(true);
    // The key reads the token table and nothing else.
    expect(new Set(appwrite.adminReads)).toEqual(new Set(["api_tokens"]));
  });

  it("gives no token, a malformed one, an unknown one and an Appwrite JWT the same 401", async () => {
    const answers = await Promise.all([
      get(meRoute, "/api/v1/me"),
      get(meRoute, "/api/v1/me", "snb_pat_short"),
      get(meRoute, "/api/v1/me", `snb_pat_${"Z".repeat(43)}`),
      get(meRoute, "/api/v1/me", jwtFor(JOEY)),
    ]);
    for (const response of answers) {
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ error: "unauthorized" });
    }
    // Nobody to attribute them to, so nothing in anyone's trail.
    expect(audit()).toEqual([]);
    expect(appwrite.minted).toEqual([]);
  });

  it("refuses a revoked token and an expired one with that same 401, and logs both against their owner", async () => {
    const revoked = await tokenFor(JOEY, "old");
    await revokeRoute(routeRequest(`/api/tokens/${revoked.id}`, { method: "DELETE", jwt: jwtFor(JOEY) }), { params: Promise.resolve({ id: revoked.id }) });
    const expired = await tokenFor(JOEY, "stale");
    appwrite.tables.api_tokens.find((r) => r.$id === expired.id)!.expires_at = new Date(Date.now() - 1).toISOString();

    for (const token of [revoked.token, expired.token]) {
      const response = await get(meRoute, "/api/v1/me", token);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "unauthorized" });
    }
    expect(audit().map((r) => [r.token_id, r.owner_id, r.status])).toEqual([
      [revoked.id, JOEY, 401],
      [expired.id, JOEY, 401],
    ]);
    expect(appwrite.minted).toEqual([]);
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"] as const)("405s %s on every endpoint, token or not", async (method) => {
    const routes = [meRoute, sessionsRoute, programRoute, maxesRoute, sessionRoute] as unknown as Array<Record<string, Handler>>;
    for (const route of routes) {
      const bare = await route[method](routeRequest("/api/v1/me", { method }));
      expect(bare.status).toBe(405);
      expect(bare.headers.get("allow")).toBe("GET");
      const request = routeRequest("/api/v1/me", { method });
      request.headers.set("authorization", `Bearer ${joey.token}`);
      const withToken = await route[method](request);
      expect(withToken.status).toBe(405);
      expect(await withToken.json()).toEqual({ error: "method_not_allowed" });
    }
    // Only the calls made with a real token are in the trail, as 405s. Nothing was read.
    expect(audit().map((r) => [r.method, r.status])).toEqual(Array(5).fill([method, 405]));
    expect(appwrite.minted).toEqual([]);
  });

  it("allows 60 calls a minute per token, then 429 with Retry-After, without touching another token", async () => {
    for (let n = 0; n < 60; n += 1) expect((await get(meRoute, "/api/v1/me", joey.token)).status).toBe(200);
    const limited = await get(meRoute, "/api/v1/me", joey.token);
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "rate_limited" });
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(audit().at(-1)).toMatchObject({ token_id: joey.id, status: 429 });
    expect(appwrite.minted).toHaveLength(60);

    const second = await tokenFor(JOEY, "second");
    expect((await get(meRoute, "/api/v1/me", second.token)).status).toBe(200);
  });
});

describe("the audit trail", () => {
  it("writes one row per call, with the path and only the allowed parameters, and touches last_used_at", async () => {
    await get(sessionsRoute, "/api/v1/sessions?limit=2&secret=hunter2&from=2026-11-01", joey.token);
    expect(audit()).toHaveLength(1);
    expect(audit()[0]).toMatchObject({
      token_id: joey.id,
      owner_id: JOEY,
      method: "GET",
      path: "/api/v1/sessions?from=2026-11-01&limit=2",
      status: 200,
      $permissions: [],
    });
    const token = appwrite.tables.api_tokens.find((r) => r.$id === joey.id)!;
    expect(typeof token.last_used_at).toBe("string");
  });

  it("still answers when the audit write fails, and says so in the log", async () => {
    const original = TablesDB.prototype.createRow;
    vi.spyOn(TablesDB.prototype, "createRow").mockImplementation(function (this: unknown, ...args: unknown[]) {
      const params = args[0] as { tableId: string };
      if (params.tableId === "api_requests") return Promise.reject(Object.assign(new Error("instance down"), { code: 503 }));
      return original.apply(this, args);
    });
    const response = await get(meRoute, "/api/v1/me", joey.token);
    expect(response.status).toBe(200);
    expect(audit()).toEqual([]);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(`audit write failed for token ${joey.id}`), expect.anything());
  });
});

describe("GET /api/v1/sessions", () => {
  it("lists the owner's sessions newest first, with History's totals and names, and nobody else's", async () => {
    const body = (await (await get(sessionsRoute, "/api/v1/sessions", joey.token)).json()) as {
      units: string;
      sessions: Array<Record<string, unknown>>;
      nextCursor: string | null;
    };
    expect(body.units).toBe("kg");
    expect(body.sessions.map((s) => s.id)).toEqual(["s3", "s2", "s1"]);
    expect(body.sessions[0]).toEqual({
      id: "s3",
      startedAt: "2026-11-08T09:00:00.000Z",
      finishedAt: "2026-11-08T09:00:00.000Z",
      name: null,
      setCount: 2,
      tonnageKg: 1250,
    });
    expect(body.sessions[1].name).toBe("Heavy singles");
    expect(body.nextCursor).toBeNull();
  });

  it("pages on a cursor, past rows it drops, so a page can be short but never stalls", async () => {
    // The newest row is the forgery: it fills a slot on the first page and is
    // dropped, so the page holds one session and still points onwards.
    const first = (await (await get(sessionsRoute, "/api/v1/sessions?limit=2", joey.token)).json()) as { sessions: Array<{ id: string }>; nextCursor: string };
    expect(first.sessions.map((s) => s.id)).toEqual(["s3"]);
    expect(first.nextCursor).toBe("s3");
    const second = (await (await get(sessionsRoute, `/api/v1/sessions?limit=2&cursor=${first.nextCursor}`, joey.token)).json()) as { sessions: Array<{ id: string }>; nextCursor: string | null };
    expect(second.sessions.map((s) => s.id)).toEqual(["s2", "s1"]);
    expect(second.nextCursor).toBeNull();
  });

  it("filters by date, to inclusive of its whole day", async () => {
    const body = (await (await get(sessionsRoute, "/api/v1/sessions?from=2026-11-02&to=2026-11-05", joey.token)).json()) as { sessions: Array<{ id: string }> };
    expect(body.sessions.map((s) => s.id)).toEqual(["s2"]);
  });

  it.each([
    ["limit=0", "invalid_limit"],
    ["limit=101", "invalid_limit"],
    ["limit=ten", "invalid_limit"],
    ["from=yesterday", "invalid_from"],
    ["to=2026-02-30", "invalid_to"],
    ["from=2026-11-05&to=2026-11-01", "invalid_range"],
    ["cursor=sam1", "invalid_cursor"],
    ["cursor=nope", "invalid_cursor"],
  ])("400s %s", async (query, error) => {
    const response = await get(sessionsRoute, `/api/v1/sessions?${query}`, joey.token);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error });
  });

  it("gives a coach's token the coach's own sessions only, though Appwrite would show the athletes'", async () => {
    const coach = await tokenFor(COACH);
    const body = (await (await get(sessionsRoute, "/api/v1/sessions", coach.token)).json()) as { sessions: unknown[] };
    expect(body.sessions).toEqual([]);
  });
});

describe("GET /api/v1/sessions/:id", () => {
  it("returns the session with its sets in the order they were worked, named, with no clip ids", async () => {
    const response = await session("s3")(joey.token);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { session: { notes: string; setCount: number; tonnageKg: number; sets: Array<Record<string, unknown>> } };
    expect(body.session.notes).toBe("Felt good");
    expect(body.session.sets.map((s) => [s.order, (s.exercise as { name: string }).name, s.weightKg, s.reps, s.warmup, s.failed])).toEqual([
      [1, "Squat", 60, 5, true, false],
      [2, "Squat", 150, 5, false, false],
      [3, "Squat", 150, 3, false, true],
      [4, "Bench Press", 100, 5, false, false],
    ]);
    expect(body.session.sets[1]).toMatchObject({ rpe: 8, notes: "Depth ok?", durationSeconds: null, level: null });
    // totalsOf, as the session screen computes them: warm-up out, the missed set in.
    expect(body.session.setCount).toBe(3);
    expect(body.session.tonnageKg).toBe(150 * 5 + 150 * 3 + 100 * 5);
    expect(JSON.stringify(body)).not.toContain(VIDEO);
    expect(JSON.stringify(body)).not.toMatch(/video|poster|proxy/i);
  });

  it("404s another athlete's session and one that does not exist, identically", async () => {
    const answers = [await session("str1")(joey.token), await session("sam1")(joey.token), await session("nope")(joey.token), await session("forged")(joey.token)];
    for (const response of answers) {
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found" });
    }
  });

  it("404s a coach's token on an athlete's session it could read in the app", async () => {
    const coach = await tokenFor(COACH);
    const response = await session("s3")(coach.token);
    expect(response.status).toBe(404);
  });
});

describe("GET /api/v1/program/current", () => {
  it("returns the published weeks only, with percentages resolved exactly as My Program does", async () => {
    const response = await get(programRoute, "/api/v1/program/current", joey.token);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      units: string;
      program: { name: string; blocks: Array<{ weeks: Array<{ id: string; days: Array<{ id: string; exercises: Array<{ exercise: { name: string }; lines: Array<{ summary: string; sets: Array<{ loadKg: number | null; unresolved: boolean; display: string }> }> }> }> }> }> };
    };
    expect(body.program.name).toBe("Block 3");
    const weeks = body.program.blocks[0].weeks;
    expect(weeks.map((w) => w.id)).toEqual(["w1"]);
    expect(JSON.stringify(body)).not.toContain("Draft day");

    const [squat, bench] = weeks[0].days[0].exercises;
    // 75% of the 200 kg training max in effect today; the 2099 one is not yet.
    expect(squat.exercise.name).toBe("Squat");
    expect(squat.lines[0].sets.map((s) => s.loadKg)).toEqual([150, 150, 150]);

    // And every line, Bench included (no stored max, only an e1RM), is what
    // the app's own helpers say for the same rows: no arithmetic of the API's.
    const now = new Date();
    const entries = [
      { id: "max_1", exerciseId: SQUAT, kind: "training" as const, valueKg: 200, effectiveFrom: "2026-01-01T00:00:00.000Z", recordedBy: COACH },
      { id: "max_2", exerciseId: SQUAT, kind: "tested" as const, valueKg: 210, effectiveFrom: "2026-06-01T00:00:00.000Z", recordedBy: JOEY },
      { id: "max_3", exerciseId: SQUAT, kind: "training" as const, valueKg: 260, effectiveFrom: "2099-01-01T00:00:00.000Z", recordedBy: COACH },
    ];
    const estimated = new Map([
      [SQUAT, { valueKg: 190, asOf: "2026-10-26T00:00:00.000Z" }],
      [BENCH, { valueKg: 115, asOf: "2026-11-02T00:00:00.000Z" }],
    ]);
    const names = new Map([[SQUAT, "Squat"], [BENCH, "Bench Press"]]);
    const day = appwrite.tables.prescriptions.filter((r) => r.day_id === "d1").map((r) => parsePrescriptionRow(r)!);
    const expected = planDay(day).map((planned) => {
      const targets = targetsFor(planned, basisMaxesFor(planned.exerciseId, entries, estimated, now), [], referenceLookup(entries, estimated, now, (id) => names.get(id)), "kg");
      return { summaries: lineSummaries(planned, targets), loads: targets.map((t) => t.loadKg) };
    });
    expect([squat, bench].map((e) => e.lines[0].summary)).toEqual(expected.map((e) => e.summaries[0]));
    expect([squat, bench].map((e) => e.lines[0].sets.map((s) => s.loadKg))).toEqual(expected.map((e) => e.loads));
  });

  it("floors to pounds plates for an athlete who reads pounds, as My Program does, still answering in kilograms", async () => {
    appwrite.tables.profiles[0].units = "lb";
    const body = (await (await get(programRoute, "/api/v1/program/current", joey.token)).json()) as {
      units: string;
      program: { blocks: Array<{ weeks: Array<{ days: Array<{ exercises: Array<{ lines: Array<{ summary: string; sets: Array<{ loadKg: number }> }> }> }> }> }> };
    };
    expect(body.units).toBe("lb");
    const squat = body.program.blocks[0].weeks[0].days[0].exercises[0].lines[0];
    // 150 kg is 330.7 lb, floored to 330 lb on 5 lb plates: 149.685 kg.
    expect(squat.sets[0].loadKg).toBeCloseTo(149.685, 2);
    expect(squat.summary).toContain("lb");
  });

  it("is null, not an error, with no published program", async () => {
    appwrite.tables.programs[0].status = "draft";
    const body = (await (await get(programRoute, "/api/v1/program/current", joey.token)).json()) as { program: unknown };
    expect(body.program).toBeNull();
  });
});

describe("GET /api/v1/maxes", () => {
  it("returns the maxes in effect today and the best e1RM per lift, the owner's only", async () => {
    const body = (await (await get(maxesRoute, "/api/v1/maxes", joey.token)).json()) as { units: string; lifts: Array<Record<string, unknown>> };
    expect(body.units).toBe("kg");
    expect(body.lifts).toEqual([
      {
        exercise: { id: BENCH, name: "Bench Press" },
        training: null,
        tested: null,
        bestE1rm: { valueKg: 115, asOf: "2026-11-02T00:00:00.000Z" },
        preferred: { kind: "estimated", valueKg: 115 },
      },
      {
        exercise: { id: SQUAT, name: "Squat" },
        training: { valueKg: 200, asOf: "2026-01-01T00:00:00.000Z" },
        tested: { valueKg: 210, asOf: "2026-06-01T00:00:00.000Z" },
        // The best week, not the latest: a deload does not lower it.
        bestE1rm: { valueKg: 190, asOf: "2026-10-26T00:00:00.000Z" },
        preferred: { kind: "training", valueKg: 200 },
      },
    ]);
    expect(JSON.stringify(body)).not.toContain("300");
  });
});
