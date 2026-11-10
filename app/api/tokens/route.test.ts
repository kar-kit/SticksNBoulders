// @vitest-environment node
import { createHash } from "node:crypto";
import { appwrite, jwtFor, resetAppwrite, routeRequest, type Row } from "../route-test-kit";

/**
 * F29's token routes. The routes, api-token-admin and the write helper are
 * real; only node-appwrite is replaced. The owner of every token comes from
 * the JWT, and the plaintext exists in one response and nowhere else.
 */

vi.mock("node-appwrite", async (actual) =>
  (await import("@/app/api/route-test-kit")).fakeNodeAppwrite(await actual<object>()),
);
vi.mock("@/appwrite/env", async () => (await import("@/app/api/route-test-kit")).fakeEnv);

const { GET, POST } = await import("./route");
const { DELETE } = await import("./[id]/route");

const JOEY = "joey";
const LOUIS = "louis";
const STRANGER = "stranger";
const DAY = 24 * 60 * 60 * 1000;

const rows = (): Row[] => appwrite.tables.api_tokens ?? [];
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

const mint = (user: string, body: unknown = { label: "Rubble" }) =>
  POST(routeRequest("/api/tokens", { jwt: jwtFor(user), body }));
const list = (user: string) => GET(routeRequest("/api/tokens", { method: "GET", jwt: jwtFor(user) }));
const revoke = (user: string, id: string) =>
  DELETE(routeRequest(`/api/tokens/${id}`, { method: "DELETE", jwt: jwtFor(user) }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  resetAppwrite();
  appwrite.tables.api_tokens = [];
  vi.stubEnv("API_TOKEN_USER_IDS", `${JOEY}, ${LOUIS}`);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("who may use /api/tokens", () => {
  it("401 with no session, writing nothing", async () => {
    expect((await POST(routeRequest("/api/tokens", { body: { label: "x" } }))).status).toBe(401);
    expect((await GET(routeRequest("/api/tokens", { method: "GET" }))).status).toBe(401);
    expect(appwrite.writes).toEqual([]);
  });

  it("403 for a signed-in user who is not on the allowlist, on every route", async () => {
    const minted = await mint(STRANGER);
    expect(minted.status).toBe(403);
    expect(await minted.json()).toEqual({ error: "not_allowed" });
    expect((await list(STRANGER)).status).toBe(403);
    expect((await revoke(STRANGER, "anything")).status).toBe(403);
    expect(appwrite.writes).toEqual([]);
  });

  it("is nobody when the allowlist is unset or malformed", async () => {
    vi.stubEnv("API_TOKEN_USER_IDS", "");
    expect((await mint(JOEY)).status).toBe(403);
    vi.stubEnv("API_TOKEN_USER_IDS", `${JOEY},not an id!`);
    expect((await mint(JOEY)).status).toBe(403);
    expect(appwrite.writes).toEqual([]);
  });
});

describe("POST /api/tokens", () => {
  it("returns the token once, and stores only its hash, for the caller, readable by nobody", async () => {
    const before = Date.now();
    const response = await mint(JOEY, { label: "  Rubble  " });
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as { id: string; token: string; expiresAt: string; label: string };
    expect(body.token).toMatch(/^snb_pat_[A-Za-z0-9_-]{43}$/);
    expect(body.label).toBe("Rubble");

    const [row] = rows();
    expect(row).toMatchObject({ $id: body.id, owner_id: JOEY, token_hash: sha(body.token), label: "Rubble", scope: "read", revoked_at: null });
    expect(row.$permissions).toEqual([]);
    // Nowhere in what was written, in any column.
    expect(JSON.stringify(appwrite.writes)).not.toContain(body.token);
    expect(JSON.stringify(appwrite.writes)).not.toContain(body.token.slice("snb_pat_".length));

    const expires = Date.parse(body.expiresAt);
    expect(expires - before).toBeGreaterThanOrEqual(90 * DAY - 1000);
    expect(expires - Date.now()).toBeLessThanOrEqual(90 * DAY);
  });

  it("mints a different token every time", async () => {
    const a = (await (await mint(JOEY)).json()) as { token: string };
    const b = (await (await mint(JOEY)).json()) as { token: string };
    expect(a.token).not.toBe(b.token);
  });

  it("takes an expiry from 1 to 365 days and refuses anything else", async () => {
    const year = (await (await mint(JOEY, { label: "a", expiresInDays: 365 })).json()) as { expiresAt: string };
    expect(Date.parse(year.expiresAt) - Date.now()).toBeGreaterThan(364 * DAY);
    for (const expiresInDays of [0, 366, 1.5, "30", -1]) {
      const response = await mint(JOEY, { label: "a", expiresInDays });
      expect(response.status, String(expiresInDays)).toBe(400);
    }
    expect(rows()).toHaveLength(1);
  });

  it("refuses a missing or blank label, and a body that is not JSON", async () => {
    expect((await mint(JOEY, {})).status).toBe(400);
    expect((await mint(JOEY, { label: "   " })).status).toBe(400);
    expect((await POST(routeRequest("/api/tokens", { jwt: jwtFor(JOEY), body: "{not json" }))).status).toBe(400);
    expect(rows()).toEqual([]);
  });

  it("holds a user to 5 live tokens; revoked and expired ones do not count", async () => {
    const ids: string[] = [];
    for (let n = 0; n < 5; n += 1) ids.push(((await (await mint(JOEY, { label: `t${n}` })).json()) as { id: string }).id);
    const sixth = await mint(JOEY, { label: "t5" });
    expect(sixth.status).toBe(409);
    expect(await sixth.json()).toEqual({ error: "token_limit", maxLive: 5 });

    // Another user's tokens are theirs: Louis is not capped by Joey's five.
    expect((await mint(LOUIS)).status).toBe(201);

    await revoke(JOEY, ids[0]);
    expect((await mint(JOEY, { label: "after revoke" })).status).toBe(201);
    expect((await mint(JOEY, { label: "over again" })).status).toBe(409);

    const row = rows().find((r) => r.$id === ids[1])!;
    row.expires_at = new Date(Date.now() - 1000).toISOString();
    expect((await mint(JOEY, { label: "after expiry" })).status).toBe(201);
  });
});

describe("GET /api/tokens", () => {
  it("lists the caller's tokens with their state and never a hash", async () => {
    const mine = (await (await mint(JOEY)).json()) as { id: string; token: string };
    await mint(LOUIS, { label: "Louis's" });
    const response = await list(JOEY);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as { tokens: Array<Record<string, unknown>>; maxLive: number };
    expect(body.maxLive).toBe(5);
    expect(body.tokens).toHaveLength(1);
    expect(body.tokens[0]).toMatchObject({ id: mine.id, label: "Rubble", scope: "read", state: "live", lastUsedAt: null, revokedAt: null });
    const text = JSON.stringify(body);
    expect(text).not.toContain("token_hash");
    expect(text).not.toContain(sha(mine.token));
    expect(text).not.toContain(mine.token);
  });

  it("shows revoked and expired tokens as such", async () => {
    const a = ((await (await mint(JOEY, { label: "a" })).json()) as { id: string }).id;
    const b = ((await (await mint(JOEY, { label: "b" })).json()) as { id: string }).id;
    await revoke(JOEY, a);
    rows().find((r) => r.$id === b)!.expires_at = new Date(Date.now() - 1000).toISOString();
    const body = (await (await list(JOEY)).json()) as { tokens: Array<{ id: string; state: string }> };
    expect(Object.fromEntries(body.tokens.map((t) => [t.id, t.state]))).toEqual({ [a]: "revoked", [b]: "expired" });
  });
});

describe("DELETE /api/tokens/:id", () => {
  it("revokes the caller's own token, once", async () => {
    const { id } = (await (await mint(JOEY)).json()) as { id: string };
    const response = await revoke(JOEY, id);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "revoked" });
    const first = rows()[0].revoked_at;
    expect(typeof first).toBe("string");
    await revoke(JOEY, id);
    expect(rows()[0].revoked_at).toBe(first);
  });

  it("404s someone else's token and an unknown one alike, changing nothing", async () => {
    const { id } = (await (await mint(LOUIS)).json()) as { id: string };
    const theirs = await revoke(JOEY, id);
    const unknown = await revoke(JOEY, "no_such_token");
    expect(theirs.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(await theirs.json()).toEqual(await unknown.json());
    expect(rows()[0].revoked_at).toBeNull();
  });
});
