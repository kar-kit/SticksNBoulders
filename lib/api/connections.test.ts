import { datesLine, lastUsedLine, liveCount, orderTokens, shortDate, stateLabel, type TokenSummary } from "./connections";

const token = (over: Partial<TokenSummary>): TokenSummary => ({
  id: "t",
  label: "Rubble",
  scope: "read",
  createdAt: "2026-11-10T09:00:00.000Z",
  expiresAt: "2027-02-08T09:00:00.000Z",
  lastUsedAt: null,
  revokedAt: null,
  state: "live",
  ...over,
});

describe("token rows (F29)", () => {
  it("says what ended a token, or when it will end", () => {
    expect(datesLine(token({}))).toBe("Created 10 Nov 2026 · Expires 8 Feb 2027");
    expect(datesLine(token({ state: "revoked", revokedAt: "2026-12-01T09:00:00.000Z" }))).toBe("Created 10 Nov 2026 · Revoked 1 Dec 2026");
    expect(datesLine(token({ state: "expired" }))).toBe("Created 10 Nov 2026 · Expired 8 Feb 2027");
  });

  it("says never used until it has been", () => {
    expect(lastUsedLine(token({}))).toBe("Never used");
    expect(lastUsedLine(token({ lastUsedAt: "2026-11-11T09:00:00.000Z" }))).toBe("Last used 11 Nov 2026");
  });

  it("puts active tokens first, newest first within each", () => {
    const tokens = [
      token({ id: "old-live", createdAt: "2026-01-01T00:00:00.000Z" }),
      token({ id: "revoked", state: "revoked", createdAt: "2026-12-01T00:00:00.000Z" }),
      token({ id: "new-live", createdAt: "2026-06-01T00:00:00.000Z" }),
    ];
    expect(orderTokens(tokens).map((t) => t.id)).toEqual(["new-live", "old-live", "revoked"]);
    expect(liveCount(tokens)).toBe(2);
  });

  it("labels states and survives a date it cannot read", () => {
    expect([stateLabel("live"), stateLabel("revoked"), stateLabel("expired")]).toEqual(["Active", "Revoked", "Expired"]);
    expect(shortDate(null)).toBe("");
    expect(shortDate("garbage")).toBe("");
  });
});
