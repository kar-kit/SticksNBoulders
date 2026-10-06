import main, { isRowNotFound } from "../../functions/validate-row/src/main";

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

function run(fetchResponse: Response) {
  const fetchMock = vi.fn(async () => fetchResponse);
  vi.stubGlobal("fetch", fetchMock);
  const logs: string[] = [];
  const errors: string[] = [];
  let result: { body: unknown; status?: number } | undefined;
  const ctx = {
    req: { headers: { "x-appwrite-trigger": "event", "x-appwrite-key": "k", "x-appwrite-event": "e" }, body: forged },
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
