import { looksLikeEmail, normaliseEmail, resolveMethodHint, type UserDirectory } from "./method-hint";

function directory(
  users: Record<string, { id: string; hasPassword: boolean; providers?: string[] }>,
): UserDirectory & { lookups: string[] } {
  const lookups: string[] = [];
  return {
    lookups,
    async findByEmail(email) {
      lookups.push(email);
      const found = users[email];
      return found ? { id: found.id, hasPassword: found.hasPassword } : null;
    },
    async providersFor(userId) {
      return Object.values(users).find((u) => u.id === userId)?.providers ?? [];
    },
  };
}

describe("resolveMethodHint reveals only what it must", () => {
  it("says nothing when no account exists", async () => {
    // Confirming absence is a leak with no upside: there is nobody to help.
    const d = directory({});
    expect(await resolveMethodHint(d, "nobody@example.com")).toEqual({ hint: "none" });
  });

  it("says nothing when the account has a password", async () => {
    // The attempt was simply wrong. Saying more would confirm the address.
    const d = directory({ "joey@example.com": { id: "u1", hasPassword: true } });
    expect(await resolveMethodHint(d, "joey@example.com")).toEqual({ hint: "none" });
  });

  it("names the provider when the account has no password", async () => {
    const d = directory({ "joey@example.com": { id: "u1", hasPassword: false, providers: ["google"] } });
    expect(await resolveMethodHint(d, "joey@example.com")).toEqual({
      hint: "use-provider",
      provider: "google",
    });
  });

  it("names Apple too", async () => {
    const d = directory({ "j@example.com": { id: "u1", hasPassword: false, providers: ["apple"] } });
    expect(await resolveMethodHint(d, "j@example.com")).toEqual({ hint: "use-provider", provider: "apple" });
  });

  it("falls back to a generic hint for a provider it does not recognise", async () => {
    // Better a vague nudge than a button that sends them nowhere.
    const d = directory({ "j@example.com": { id: "u1", hasPassword: false, providers: ["github"] } });
    expect(await resolveMethodHint(d, "j@example.com")).toEqual({ hint: "use-other-method" });
  });

  it("falls back when the account has no password and no readable identity", async () => {
    const d = directory({ "j@example.com": { id: "u1", hasPassword: false, providers: [] } });
    expect(await resolveMethodHint(d, "j@example.com")).toEqual({ hint: "use-other-method" });
  });

  it("picks the first provider it recognises when several are linked", async () => {
    const d = directory({ "j@example.com": { id: "u1", hasPassword: false, providers: ["github", "google"] } });
    expect(await resolveMethodHint(d, "j@example.com")).toEqual({ hint: "use-provider", provider: "google" });
  });
});

describe("resolveMethodHint input handling", () => {
  it.each(["", "   ", "not-an-email", "@", "joey"])(
    "refuses to look up %j at all",
    async (input) => {
      const d = directory({ "joey@example.com": { id: "u1", hasPassword: false, providers: ["google"] } });
      expect(await resolveMethodHint(d, input)).toEqual({ hint: "none" });
      expect(d.lookups).toEqual([]);
    },
  );

  it.each([
    ["  Joey@Example.com  ", "joey@example.com"],
    ["JOEY@EXAMPLE.COM", "joey@example.com"],
  ])("normalises %j before looking it up", async (input, expected) => {
    const d = directory({ [expected]: { id: "u1", hasPassword: false, providers: ["google"] } });
    expect(await resolveMethodHint(d, input)).toMatchObject({ hint: "use-provider" });
    expect(d.lookups).toEqual([expected]);
  });
});

describe("normaliseEmail", () => {
  it("lowercases and trims, because an email is not case-sensitive to a person", () => {
    expect(normaliseEmail("  Joey@Example.COM ")).toBe("joey@example.com");
  });
});

describe("looksLikeEmail", () => {
  it.each(["joey@example.com", "a.b+tag@sub.example.co.uk"])("accepts %j", (value) => {
    expect(looksLikeEmail(value)).toBe(true);
  });

  it.each(["", "@", "a@", "@b.com", "a@b", "a b@c.com", "a@b .com"])("rejects %j", (value) => {
    expect(looksLikeEmail(value)).toBe(false);
  });
});
