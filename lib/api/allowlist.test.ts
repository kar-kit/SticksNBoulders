import { mayUseApiTokens, parseAllowlist } from "./allowlist";

describe("API_TOKEN_USER_IDS (F29)", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("is a comma-separated list of user ids, spaces allowed", () => {
    const parsed = parseAllowlist(" joey , 68f1a2b3c4d5e6f7a8b9 ");
    expect(parsed).toEqual({ ok: true, ids: new Set(["joey", "68f1a2b3c4d5e6f7a8b9"]) });
  });

  it("allows only the ids on it", () => {
    const env = { API_TOKEN_USER_IDS: "joey,ruairi" };
    expect(mayUseApiTokens("joey", env)).toBe(true);
    expect(mayUseApiTokens("ruairi", env)).toBe(true);
    expect(mayUseApiTokens("sam", env)).toBe(false);
    expect(mayUseApiTokens("", env)).toBe(false);
  });

  it("is nobody when unset or empty", () => {
    expect(mayUseApiTokens("joey", {})).toBe(false);
    expect(mayUseApiTokens("joey", { API_TOKEN_USER_IDS: " , " })).toBe(false);
  });

  it("fails closed on an entry that is not a user id, and names the problem, not the value", () => {
    const env = { API_TOKEN_USER_IDS: "joey,jkkpang@gmail.com" };
    expect(parseAllowlist(env.API_TOKEN_USER_IDS)).toEqual({ ok: false, problem: expect.stringContaining("1 entry") });
    expect(mayUseApiTokens("joey", env)).toBe(false);
    for (const call of vi.mocked(console.error).mock.calls) expect(String(call[0])).not.toContain("jkkpang");
  });
});
