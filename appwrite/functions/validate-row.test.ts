import main, { isRowNotFound } from "../../functions/validate-row/src/main";
import { POLICIES } from "../documents/policy";

/**
 * The delete call, which no live check caught for a week: validate-row logged
 * "deleted" for every forgery while calling a route 1.9.6 does not have, and
 * took the route-not-found 404 as "already gone".
 */

const A = "athlete_a";
const B = "athlete_b";

/** A set B forged under A's id: readable by everyone, stamped by nobody. */
const forged = {
  $id: "forged-set",
  $databaseId: "sticksnboulders",
  $tableId: "sets",
  athlete_id: A,
  $permissions: ['read("users")', `update("user:${B}")`],
};

/** A's own set, stamped the way the app stamps it. */
const honest = { ...forged, $id: "honest-set", $permissions: POLICIES.sets({ athleteId: A }) };

const EVENT_HEADERS: Record<string, string> = { "x-appwrite-trigger": "event", "x-appwrite-key": "k", "x-appwrite-event": "e" };

function run(fetchResponse: Response, body: unknown = forged, headers: Record<string, string> = EVENT_HEADERS) {
  const fetchMock = vi.fn(async () => fetchResponse);
  vi.stubGlobal("fetch", fetchMock);
  const logs: string[] = [];
  const errors: string[] = [];
  let result: { body: unknown; status?: number } | undefined;
  const ctx = {
    req: { headers, body },
    res: { json: (body: unknown, status?: number) => (result = { body, status }) },
    log: (m: string) => logs.push(m),
    error: (m: string) => errors.push(m),
  };
  return { fetchMock, logs, errors, ctx, result: () => result };
}

describe("validate-row's delete", () => {
  beforeEach(() => {
    vi.stubEnv("APPWRITE_FUNCTION_API_ENDPOINT", "http://appwrite/v1");
    vi.stubEnv("APPWRITE_FUNCTION_PROJECT_ID", "p");
    vi.stubEnv("VALIDATOR_DRY_RUN", "false");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("calls the TablesDB route", async () => {
    const t = run(new Response(null, { status: 204 }));
    await main(t.ctx);
    expect(t.fetchMock).toHaveBeenCalledWith(
      "http://appwrite/v1/tablesdb/sticksnboulders/tables/sets/rows/forged-set",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(t.result()?.body).toMatchObject({ deleted: true });
  });

  it("takes the row's own 404 as already deleted", async () => {
    const t = run(new Response(JSON.stringify({ code: 404, type: "row_not_found" }), { status: 404 }));
    await main(t.ctx);
    expect(t.result()?.body).toMatchObject({ deleted: true });
    expect(t.errors).toEqual([]);
  });

  it("fails loudly on any other 404, such as a route that does not exist", async () => {
    const t = run(new Response("<html>general_route_not_found</html>", { status: 404 }));
    await main(t.ctx);
    expect(t.result()).toMatchObject({ body: { deleted: false }, status: 500 });
    expect(t.logs.some((l) => l.startsWith("deleted"))).toBe(false);
    expect(t.errors[0]).toMatch(/delete failed 404/);
  });
});

/**
 * What keeps the deleter from being a mass delete. Every test above feeds it a
 * forgery, so a validator that deleted every row it saw would pass them all.
 */
describe("validate-row's restraint", () => {
  beforeEach(() => {
    vi.stubEnv("APPWRITE_FUNCTION_API_ENDPOINT", "http://appwrite/v1");
    vi.stubEnv("APPWRITE_FUNCTION_PROJECT_ID", "p");
    vi.stubEnv("VALIDATOR_DRY_RUN", "false");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("keeps a row its owner stamped, without a delete call", async () => {
    const t = run(new Response(null, { status: 204 }), honest);
    await main(t.ctx);
    expect(t.fetchMock).not.toHaveBeenCalled();
    expect(t.result()?.body).toMatchObject({ action: "keep", rowId: "honest-set" });
  });

  it("leaves a server-only table alone even when the row is unstamped", async () => {
    const rollup = { ...forged, $id: "r", $tableId: "stats_rollups" };
    const t = run(new Response(null, { status: 204 }), rollup);
    await main(t.ctx);
    expect(t.fetchMock).not.toHaveBeenCalled();
    expect(t.result()?.body).toMatchObject({ action: "skip" });
  });

  it("only logs under VALIDATOR_DRY_RUN=true", async () => {
    vi.stubEnv("VALIDATOR_DRY_RUN", "true");
    const t = run(new Response(null, { status: 204 }));
    await main(t.ctx);
    expect(t.fetchMock).not.toHaveBeenCalled();
    expect(t.result()?.body).toMatchObject({ action: "delete", dryRun: true });
    expect(t.logs[0]).toMatch(/^DRY RUN, would delete/);
  });

  it.each([
    ["an HTTP call", { ...EVENT_HEADERS, "x-appwrite-trigger": "http" }],
    ["a schedule", { ...EVENT_HEADERS, "x-appwrite-trigger": "schedule" }],
    ["no trigger header", { "x-appwrite-key": "k" }],
  ])("skips %s: only a database event names a row to judge", async (_name, headers) => {
    // A forged body, so a missing trigger check would go on to delete it.
    const t = run(new Response(null, { status: 204 }), forged, headers);
    await main(t.ctx);
    expect(t.fetchMock).not.toHaveBeenCalled();
    expect(t.result()?.body).toMatchObject({ action: "skip" });
  });

  it.each([
    ["the endpoint", () => (vi.stubEnv("APPWRITE_FUNCTION_API_ENDPOINT", ""), vi.stubEnv("APPWRITE_ENDPOINT", ""))],
    ["the project", () => vi.stubEnv("APPWRITE_FUNCTION_PROJECT_ID", "")],
  ])("fails with a 500 naming what is missing when %s is unset", async (_name, unset) => {
    unset();
    const t = run(new Response(null, { status: 204 }));
    await main(t.ctx);
    expect(t.fetchMock).not.toHaveBeenCalled();
    expect(t.result()).toMatchObject({ body: { deleted: false }, status: 500 });
    expect(t.errors[0]).toMatch(/missing endpoint\/project\/key/);
  });

  it("fails with a 500 when the event carries no execution key", async () => {
    const noKey = { ...EVENT_HEADERS, "x-appwrite-key": "" };
    const t = run(new Response(null, { status: 204 }), forged, noKey);
    await main(t.ctx);
    expect(t.fetchMock).not.toHaveBeenCalled();
    expect(t.result()).toMatchObject({ body: { deleted: false }, status: 500 });
  });
});

describe("isRowNotFound", () => {
  it.each([
    ['{"type":"row_not_found"}', true],
    ['{"type":"document_not_found"}', true],
    ['{"type":"general_route_not_found"}', false],
    ["<html>not json</html>", false],
  ])("%s -> %s", (body, expected) => {
    expect(isRowNotFound(body)).toBe(expected);
  });
});
