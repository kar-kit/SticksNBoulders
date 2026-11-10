import {
  API_TOKENS_TABLE,
  API_REQUESTS_TABLE,
  bearerToken,
  expiryFrom,
  isTokenShape,
  normaliseTokenLabel,
  tokenState,
} from "./api-token";
import { apiRequestPermissions, apiTokenPermissions, POLICIES } from "./policy";
import { expectedStamp, ownerProof, verdictFor } from "./provenance";
import { createApiToken, recordApiRequest, revokeApiToken, touchApiToken, type WriteDeps } from "./write";

const TOKEN = `snb_pat_${"A".repeat(42)}w`; // 43 characters after the prefix
const HASH = "a".repeat(64);
const NOW = new Date("2026-11-10T12:00:00.000Z");

describe("token shape (F29)", () => {
  it("accepts exactly the prefix and 43 base64url characters", () => {
    expect(isTokenShape(TOKEN)).toBe(true);
    expect(isTokenShape(`snb_pat_${"a-_".repeat(14)}Z`)).toBe(true);
  });

  it.each([
    ["no prefix", "A".repeat(43)],
    ["a different prefix", `snb_key_${"A".repeat(43)}`],
    ["one short", `snb_pat_${"A".repeat(42)}`],
    ["one long", `snb_pat_${"A".repeat(44)}`],
    ["standard base64", `snb_pat_${"A".repeat(42)}+`],
    ["padding", `snb_pat_${"A".repeat(42)}=`],
    ["an Appwrite JWT", "eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ4In0.sig"],
  ])("refuses %s", (_, value) => {
    expect(isTokenShape(value)).toBe(false);
  });
});

describe("bearerToken", () => {
  it("reads a token from a Bearer header, any case, with stray spaces", () => {
    expect(bearerToken(`Bearer ${TOKEN}`)).toBe(TOKEN);
    expect(bearerToken(`bearer   ${TOKEN}  `)).toBe(TOKEN);
  });

  it("is null for anything that is not one of ours, so every miss is the same 401", () => {
    expect(bearerToken(null)).toBeNull();
    expect(bearerToken("")).toBeNull();
    expect(bearerToken(TOKEN)).toBeNull();
    expect(bearerToken(`Basic ${TOKEN}`)).toBeNull();
    expect(bearerToken("Bearer eyJhbGciOiJIUzI1NiJ9.e30.sig")).toBeNull();
    expect(bearerToken(`Bearer ${TOKEN} extra`)).toBeNull();
  });
});

describe("tokenState", () => {
  const later = new Date(NOW.getTime() + 60_000).toISOString();
  const earlier = new Date(NOW.getTime() - 60_000).toISOString();

  it("is live until its expiry", () => {
    expect(tokenState({ expires_at: later, revoked_at: null }, NOW)).toBe("live");
  });

  it("is expired at and after its expiry", () => {
    expect(tokenState({ expires_at: earlier }, NOW)).toBe("expired");
    expect(tokenState({ expires_at: NOW.toISOString() }, NOW)).toBe("expired");
  });

  it("reads an unreadable expiry as expired, never as forever", () => {
    expect(tokenState({}, NOW)).toBe("expired");
    expect(tokenState({ expires_at: "soon" }, NOW)).toBe("expired");
  });

  it("is revoked once revoked, whatever the expiry says", () => {
    expect(tokenState({ expires_at: later, revoked_at: earlier }, NOW)).toBe("revoked");
    expect(tokenState({ expires_at: earlier, revoked_at: earlier }, NOW)).toBe("revoked");
  });
});

describe("expiry and labels", () => {
  it("counts expiry in whole days from now", () => {
    expect(expiryFrom(NOW, 90).toISOString()).toBe("2027-02-08T12:00:00.000Z");
  });

  it("trims, collapses and caps a label, and refuses an empty one", () => {
    expect(normaliseTokenLabel("  Rubble \n laptop ")).toBe("Rubble laptop");
    expect(normaliseTokenLabel("x".repeat(80))).toHaveLength(64);
    expect(normaliseTokenLabel("   ")).toBeNull();
    expect(normaliseTokenLabel(42)).toBeNull();
  });
});

describe("token and audit policies", () => {
  it("grant nobody anything, the owner included", () => {
    expect(apiTokenPermissions({ ownerId: "joey" })).toEqual([]);
    expect(apiRequestPermissions({ ownerId: "joey" })).toEqual([]);
    expect(POLICIES.api_tokens({ ownerId: "joey" })).toEqual([]);
  });

  it("still refuse a row with no owner", () => {
    expect(() => apiTokenPermissions({ ownerId: "" })).toThrow(/ownerId/);
    expect(() => apiRequestPermissions({ ownerId: "" })).toThrow(/ownerId/);
  });

  it("are what the audit's stamp scan expects", () => {
    expect(expectedStamp("api_tokens", { owner_id: "joey" })).toEqual([]);
    expect(expectedStamp("api_requests", { owner_id: "joey" })).toEqual([]);
    expect(expectedStamp("api_tokens", {})).toBeNull();
  });

  it("need no authorship proof and are never judged by validate-row, being server-only", () => {
    expect(ownerProof("api_tokens", { owner_id: "joey" })).toEqual([]);
    expect(verdictFor("api_requests", { $id: "r", owner_id: "joey", $permissions: ['read("users")'] }).action).toBe("skip");
  });
});

describe("token and audit writes", () => {
  const calls: Array<{ op: string; params: Record<string, unknown> }> = [];
  const deps: WriteDeps = {
    writer: {
      createRow: async (params) => (calls.push({ op: "create", params }), { $id: params.rowId }),
      updateRow: async (params) => (calls.push({ op: "update", params }), { $id: params.rowId }),
      deleteRow: async (params) => (calls.push({ op: "delete", params }), {}),
    } as WriteDeps["writer"],
    databaseId: "db",
    newId: () => "req_1",
    now: () => NOW,
  };
  beforeEach(() => {
    calls.length = 0;
  });

  it("stores the hash, the owner from the actor, scope read, and no permissions", async () => {
    await createApiToken(deps, { userId: "joey" }, { rowId: "tok_1", tokenHash: HASH, label: " Rubble ", expiresAt: expiryFrom(NOW, 90) });
    expect(calls[0]).toEqual({
      op: "create",
      params: {
        databaseId: "db",
        tableId: API_TOKENS_TABLE,
        rowId: "tok_1",
        data: {
          owner_id: "joey",
          token_hash: HASH,
          label: "Rubble",
          scope: "read",
          created_at: NOW.toISOString(),
          expires_at: "2027-02-08T12:00:00.000Z",
          last_used_at: null,
          revoked_at: null,
        },
        permissions: [],
      },
    });
  });

  it("refuses a plaintext token in the hash column, an empty label, or an expiry in the past", async () => {
    await expect(createApiToken(deps, { userId: "joey" }, { rowId: "t", tokenHash: TOKEN, label: "x", expiresAt: expiryFrom(NOW, 1) })).rejects.toThrow(/sha256/);
    await expect(createApiToken(deps, { userId: "joey" }, { rowId: "t", tokenHash: HASH, label: " ", expiresAt: expiryFrom(NOW, 1) })).rejects.toThrow(/label/);
    await expect(createApiToken(deps, { userId: "joey" }, { rowId: "t", tokenHash: HASH, label: "x", expiresAt: NOW })).rejects.toThrow(/future/);
    expect(calls).toEqual([]);
  });

  it("revokes and touches with the time only, re-stamping nothing but []", async () => {
    await revokeApiToken(deps, { userId: "joey" }, { rowId: "tok_1" });
    await touchApiToken(deps, { rowId: "tok_1", ownerId: "joey" });
    expect(calls.map((c) => [c.op, c.params.data, c.params.permissions])).toEqual([
      ["update", { revoked_at: NOW.toISOString() }, []],
      ["update", { last_used_at: NOW.toISOString() }, []],
    ]);
  });

  it("writes one audit line per call, with a fresh id and nothing but the call", async () => {
    await recordApiRequest(deps, { tokenId: "tok_1", ownerId: "joey", method: "get", path: "/api/v1/me", status: 200 });
    expect(calls[0].params).toEqual({
      databaseId: "db",
      tableId: API_REQUESTS_TABLE,
      rowId: "req_1",
      data: { token_id: "tok_1", owner_id: "joey", method: "GET", path: "/api/v1/me", status: 200, at: NOW.toISOString() },
      permissions: [],
    });
    await expect(recordApiRequest(deps, { tokenId: "t", ownerId: "joey", method: "GET", path: "/", status: 42 })).rejects.toThrow(/status/);
  });
});
