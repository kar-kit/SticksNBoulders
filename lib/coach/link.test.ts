import {
  decideRedemption,
  decideUnlink,
  linkConsentSentence,
  linkedDateLabel,
  unlinkConsequenceSentence,
  type ExistingLink,
} from "./link";

const ATHLETE = "athlete_joey";
const COACH = "coach_ruairi";
const OTHER = "coach_louis";

const link = (coachId: string, status: "active" | "revoked", rowId = `row_${coachId}`): ExistingLink => ({
  rowId,
  coachId,
  status,
});

describe("deciding what a redeemed code does", () => {
  it("links an athlete with no coach", () => {
    expect(decideRedemption(ATHLETE, COACH, [])).toEqual({ kind: "create", coachId: COACH });
  });

  it("refuses a coach's own code", () => {
    // circle-admin throws on this too. Answering here means the write never
    // starts, rather than failing partway through.
    expect(decideRedemption(ATHLETE, ATHLETE, [])).toEqual({ kind: "self" });
  });

  it("does nothing when the same coach is already linked", () => {
    expect(decideRedemption(ATHLETE, COACH, [link(COACH, "active")])).toEqual({
      kind: "already-linked",
      coachId: COACH,
    });
  });

  it("refuses a second coach, and names the one already linked", () => {
    // The sev-1 direction is granting access nobody expected. Refusing is the
    // only branch that cannot do that.
    expect(decideRedemption(ATHLETE, COACH, [link(OTHER, "active")])).toEqual({
      kind: "other-coach",
      coachId: OTHER,
    });
  });

  it("reuses the revoked row rather than creating a second one", () => {
    // The unique index on (coach_id, athlete_id) would reject a new row, so
    // this is what Appwrite will accept rather than a tidiness choice.
    expect(decideRedemption(ATHLETE, COACH, [link(COACH, "revoked", "row_1")])).toEqual({
      kind: "reactivate",
      rowId: "row_1",
      coachId: COACH,
    });
  });

  it("links a new coach when the only history is a revoked one with somebody else", () => {
    expect(decideRedemption(ATHLETE, COACH, [link(OTHER, "revoked")])).toEqual({
      kind: "create",
      coachId: COACH,
    });
  });

  it("treats an active link as decisive even when a revoked one sits beside it", () => {
    const history = [link(COACH, "revoked", "old"), link(OTHER, "active", "current")];
    expect(decideRedemption(ATHLETE, COACH, history)).toEqual({ kind: "other-coach", coachId: OTHER });
  });

  it("reactivates rather than reporting already-linked when the pair was revoked", () => {
    const history = [link(COACH, "revoked", "old"), link(OTHER, "revoked", "older")];
    expect(decideRedemption(ATHLETE, COACH, history)).toEqual({
      kind: "reactivate",
      rowId: "old",
      coachId: COACH,
    });
  });

  it("refuses to decide without both parties", () => {
    expect(() => decideRedemption("", COACH, [])).toThrow(/athleteId/);
    expect(() => decideRedemption(ATHLETE, "", [])).toThrow(/coachId/);
  });
});

describe("the sentence consent is given to", () => {
  it("names the coach and says what they will see", () => {
    expect(linkConsentSentence("Ruairi")).toBe(
      "Ruairi will be able to see your sessions, your videos and your bodyweight, and set your training program.",
    );
  });

  it("stays a sentence when the coach has no name set", () => {
    // Never "  will be able to see your sessions". An unnamed coach is still a
    // consent moment and the wording has to survive it.
    expect(linkConsentSentence("   ")).toMatch(/^Your coach will be able to see/);
  });
});

describe("when the link happened", () => {
  it("reads as the blueprint's 'linked 2 Sep'", () => {
    expect(linkedDateLabel(new Date("2026-09-02T10:00:00.000Z"))).toBe("linked 2 Sep");
  });

  it("says nothing rather than 'linked NaN undefined'", () => {
    expect(linkedDateLabel(new Date("nonsense"))).toBe("");
  });
});

describe("deciding what withdrawing access does", () => {
  it("revokes the active link", () => {
    expect(decideUnlink(ATHLETE, [link(COACH, "active", "row_1")])).toEqual({
      kind: "revoke",
      rowId: "row_1",
      coachId: COACH,
    });
  });

  it("treats an athlete with no coach as already done, not as an error", () => {
    // Two devices, two taps. The second one finds nothing and that is a
    // success, the same way redeeming an already-redeemed code is.
    expect(decideUnlink(ATHLETE, [])).toEqual({ kind: "not-linked" });
    expect(decideUnlink(ATHLETE, [link(COACH, "revoked")])).toEqual({ kind: "not-linked" });
  });

  it("ignores revoked history and picks the active link", () => {
    const history = [link(OTHER, "revoked", "old"), link(COACH, "active", "current")];
    expect(decideUnlink(ATHLETE, history)).toEqual({ kind: "revoke", rowId: "current", coachId: COACH });
  });

  it("refuses to decide without an athlete", () => {
    expect(() => decideUnlink("", [])).toThrow(/athleteId/);
  });
});

describe("the sentence withdrawal is confirmed against", () => {
  it("names the coach and says what stops", () => {
    const sentence = unlinkConsequenceSentence("Ruairi");
    expect(sentence).toMatch(/^Ruairi will no longer see your sessions/);
    // The reassurance matters: the fear at this moment is losing your own log.
    expect(sentence).toMatch(/Your own training stays exactly as it is\.$/);
  });

  it("stays a sentence when the coach has no name set", () => {
    expect(unlinkConsequenceSentence("")).toMatch(/^Your coach will no longer see/);
  });
});
