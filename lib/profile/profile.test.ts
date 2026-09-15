import {
  checkDisplayName,
  DEFAULT_UNITS,
  fallbackName,
  isSex,
  isUnits,
  MAX_NAME_LENGTH,
  nameRejectionMessage,
  needsSex,
  sexLabel,
  SEX_OPTIONS,
  UNIT_OPTIONS,
  unitLabel,
  type Profile,
} from "./profile";

const profile = (over: Partial<Profile> = {}): Profile => ({
  userId: "joey",
  displayName: "Joey Pang",
  sex: "male",
  units: "kg",
  ...over,
});

describe("the two fields a number depends on", () => {
  it("offers exactly the two DOTS coefficient sets", () => {
    // Not an identity question -- it picks between two formulas, and a third
    // option would have to silently reuse one of them.
    expect(SEX_OPTIONS).toEqual(["male", "female"]);
    expect(UNIT_OPTIONS).toEqual(["kg", "lb"]);
  });

  it("defaults units to kilograms, which is what everything is stored in", () => {
    expect(DEFAULT_UNITS).toBe("kg");
  });

  it("labels an unanswered sex as a gap rather than a value", () => {
    expect(sexLabel(null)).toBe("Not set");
    expect(sexLabel("male")).toBe("Male");
    expect(sexLabel("female")).toBe("Female");
    expect(unitLabel("kg")).toBe("Kilograms");
    expect(unitLabel("lb")).toBe("Pounds");
  });

  it("refuses anything that is not one of the known values", () => {
    // A row carrying a third value must not resolve to a coefficient set.
    for (const bad of ["Male", "m", "", null, undefined, 1, {}]) {
      expect(isSex(bad)).toBe(false);
    }
    for (const bad of ["KG", "kgs", "", null, 0]) {
      expect(isUnits(bad)).toBe(false);
    }
    expect(isSex("male")).toBe(true);
    expect(isUnits("lb")).toBe(true);
  });
});

describe("needsSex", () => {
  it("asks when the answer is missing", () => {
    expect(needsSex(profile({ sex: null }))).toBe(true);
  });

  it("stops asking once answered", () => {
    expect(needsSex(profile({ sex: "female" }))).toBe(false);
  });

  it("does not ask somebody who has no profile at all", () => {
    // There is nothing to ask yet -- the row is still being created, and a
    // prompt on a screen with no profile behind it has nowhere to write.
    expect(needsSex(null)).toBe(false);
  });
});

describe("checkDisplayName", () => {
  it("accepts an ordinary name", () => {
    expect(checkDisplayName("Joey Pang")).toEqual({ ok: true, name: "Joey Pang" });
  });

  it("trims and collapses whitespace", () => {
    // A rail showing "Joey    Pang" is a rail that looks broken.
    expect(checkDisplayName("  Joey   Pang \n")).toEqual({ ok: true, name: "Joey Pang" });
  });

  it("refuses an empty name, and whitespace is empty", () => {
    expect(checkDisplayName("")).toEqual({ ok: false, reason: "empty" });
    expect(checkDisplayName("   \t ")).toEqual({ ok: false, reason: "empty" });
  });

  it("accepts a name exactly at the limit", () => {
    expect(checkDisplayName("x".repeat(MAX_NAME_LENGTH)).ok).toBe(true);
  });

  it("refuses one past it, and says how far", () => {
    expect(checkDisplayName("x".repeat(MAX_NAME_LENGTH + 3))).toEqual({
      ok: false,
      reason: "too-long",
      over: 3,
    });
  });

  it("explains the empty case in terms of the coach, not of validation", () => {
    expect(nameRejectionMessage({ ok: false, reason: "empty" })).toContain("coach");
  });
});

describe("fallbackName", () => {
  it("prefers the account name", () => {
    expect(fallbackName("Joey Pang", "joey@example.com")).toBe("Joey Pang");
  });

  it("falls back to the local part of the email, never the whole address", () => {
    // The name goes in front of a coach. An email address is somebody's
    // contact details and does not belong there by accident.
    expect(fallbackName("", "joey@example.com")).toBe("joey");
    expect(fallbackName("   ", "joey@example.com")).not.toContain("@");
  });

  it("falls back to a word rather than a user id", () => {
    expect(fallbackName("", "")).toBe("Athlete");
  });

  it("never exceeds the column", () => {
    expect(fallbackName("x".repeat(200), "").length).toBe(MAX_NAME_LENGTH);
    expect(fallbackName("", `${"y".repeat(200)}@example.com`).length).toBe(MAX_NAME_LENGTH);
  });
});
