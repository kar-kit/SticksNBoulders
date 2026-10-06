import {
  athleteLinkState,
  departureNotice,
  droppedClipsNotice,
  notLinkedCopy,
  reconcileDropped,
  recentDepartures,
  sameAthletes,
  withAccess,
  type CoachLinkRecord,
} from "./link-status";

const NOW = new Date("2026-09-27T12:00:00.000Z");
const active = (athleteId: string): CoachLinkRecord => ({ athleteId, status: "active", revokedAt: null });
const revoked = (athleteId: string, revokedAt: string | null): CoachLinkRecord => ({
  athleteId,
  status: "revoked",
  revokedAt,
});

describe("athleteLinkState", () => {
  it("is linked while the row is active", () => {
    expect(athleteLinkState("joey", [active("joey")])).toEqual({ kind: "linked" });
  });

  it("is left, with the date, once the athlete revoked", () => {
    const state = athleteLinkState("joey", [revoked("joey", "2026-09-26T09:00:00.000Z")]);
    expect(state).toEqual({ kind: "left", revokedAt: new Date("2026-09-26T09:00:00.000Z") });
  });

  it("is left without a date when the row carries a malformed one", () => {
    expect(athleteLinkState("joey", [revoked("joey", "not a date")])).toEqual({ kind: "left", revokedAt: null });
  });

  it("prefers active over revoked, so a stale row never hides a linked athlete", () => {
    expect(athleteLinkState("joey", [revoked("joey", "2026-09-01T00:00:00.000Z"), active("joey")])).toEqual({
      kind: "linked",
    });
  });

  it("is never for an id with no row -- a stranger and a typo look the same", () => {
    expect(athleteLinkState("stranger", [active("joey")])).toEqual({ kind: "never" });
    expect(athleteLinkState("joey", [])).toEqual({ kind: "never" });
  });
});

describe("recentDepartures", () => {
  it("lists revoked athletes inside the window, newest first", () => {
    const out = recentDepartures(
      [
        revoked("a", "2026-09-20T00:00:00.000Z"),
        revoked("b", "2026-09-26T00:00:00.000Z"),
        active("c"),
      ],
      NOW,
    );
    expect(out.map((d) => d.athleteId)).toEqual(["b", "a"]);
  });

  it("forgets a departure after the window", () => {
    expect(recentDepartures([revoked("a", "2026-09-01T00:00:00.000Z")], NOW)).toEqual([]);
  });

  it("drops an athlete who has since re-linked", () => {
    expect(recentDepartures([revoked("a", "2026-09-26T00:00:00.000Z"), active("a")], NOW)).toEqual([]);
  });

  it("skips a revoked row with no date rather than showing it forever", () => {
    expect(recentDepartures([revoked("a", null)], NOW)).toEqual([]);
  });

  it("counts an athlete once even if two rows name them", () => {
    const out = recentDepartures(
      [revoked("a", "2026-09-26T00:00:00.000Z"), revoked("a", "2026-09-25T00:00:00.000Z")],
      NOW,
    );
    expect(out).toHaveLength(1);
  });

  it("keeps a departure dated slightly in the future (clock skew)", () => {
    expect(recentDepartures([revoked("a", "2026-09-27T12:05:00.000Z")], NOW)).toHaveLength(1);
  });
});

describe("departureNotice", () => {
  it("says nothing when nobody left", () => {
    expect(departureNotice([])).toBeNull();
  });

  it("dates a single departure and never names anyone", () => {
    const text = departureNotice([{ athleteId: "joey", revokedAt: new Date("2026-09-26T09:00:00.000Z") }]);
    expect(text).toBe("An athlete stopped sharing their training with you on 26 Sep.");
    expect(text).not.toContain("joey");
  });

  it("counts several, naming the most recent date", () => {
    const text = departureNotice([
      { athleteId: "a", revokedAt: new Date("2026-09-26T00:00:00.000Z") },
      { athleteId: "b", revokedAt: new Date("2026-09-20T00:00:00.000Z") },
    ]);
    expect(text).toContain("2 athletes");
    expect(text).toContain("26 Sep");
  });
});

describe("notLinkedCopy", () => {
  it("says the athlete left, when, and that nothing was deleted", () => {
    const copy = notLinkedCopy({ kind: "left", revokedAt: new Date("2026-09-26T09:00:00.000Z") });
    expect(copy.title).toBe("No longer linked");
    expect(copy.body).toContain("on 26 Sep");
    expect(copy.body).toContain("kept, not deleted");
    expect(copy.body).toContain("link with your code again");
  });

  it("leaves the date out rather than printing a broken one", () => {
    expect(notLinkedCopy({ kind: "left", revokedAt: null }).body).toMatch(/^This athlete stopped sharing their training with you\. /);
  });

  it("does not confirm a stranger exists", () => {
    const copy = notLinkedCopy({ kind: "never" });
    expect(copy.title).toBe("Not one of your athletes");
    expect(copy.body).not.toMatch(/stopped|left/);
  });
});

describe("reconcileDropped", () => {
  const clip = (id: string, athleteId: string) => ({ id, athleteId });

  it("collects on-screen clips whose athlete is no longer active", () => {
    const out = reconcileDropped(new Map(), [clip("s1", "joey"), clip("s2", "sam")], new Set(["sam"]));
    expect([...out.keys()]).toEqual(["s1"]);
  });

  it("counts a clip once across racing refreshes", () => {
    const first = reconcileDropped(new Map(), [clip("s1", "joey")], new Set());
    const second = reconcileDropped(first, [clip("s1", "joey")], new Set());
    expect(second.size).toBe(1);
  });

  it("forgets clips whose athlete linked again", () => {
    const first = reconcileDropped(new Map(), [clip("s1", "joey")], new Set());
    expect(reconcileDropped(first, [], new Set(["joey"])).size).toBe(0);
  });
});

describe("droppedClipsNotice", () => {
  it("is silent at zero and pluralises honestly", () => {
    expect(droppedClipsNotice(0)).toBeNull();
    expect(droppedClipsNotice(1)).toMatch(/^A clip left the queue/);
    expect(droppedClipsNotice(3)).toMatch(/^3 clips left the queue/);
  });
});

describe("sameAthletes", () => {
  it("ignores order and notices a difference", () => {
    expect(sameAthletes(["a", "b"], ["b", "a"])).toBe(true);
    expect(sameAthletes(["a", "b"], ["a"])).toBe(false);
    expect(sameAthletes(["a"], ["b"])).toBe(false);
  });
});

describe("withAccess", () => {
  it("is linked only when the row and the membership agree", () => {
    expect(withAccess({ kind: "linked" }, true)).toEqual({ kind: "linked" });
    expect(withAccess({ kind: "linked" }, false)).toEqual({ kind: "not-visible" });
  });

  it("never upgrades a departed or unknown athlete, whatever the circle says", () => {
    expect(withAccess({ kind: "never" }, true)).toEqual({ kind: "never" });
    expect(withAccess({ kind: "left", revokedAt: null }, true)).toEqual({ kind: "left", revokedAt: null });
  });

  it("has copy for the in-between state that asks for a re-redeem, not a support ticket", () => {
    expect(notLinkedCopy({ kind: "not-visible" }).body).toContain("enter your code again");
  });
});
