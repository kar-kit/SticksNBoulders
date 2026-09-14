import { initialsFor, NOT_A_COACH, railName } from "./role";

describe("initialsFor", () => {
  it.each([
    ["Joey Pang", "JP"],
    ["Ruairi Deane", "RD"],
    ["Joey", "J"],
    ["joey pang", "JP"],
    ["Mary Anne Smith", "MS"],
  ])("turns %j into %j", (name, expected) => {
    expect(initialsFor(name)).toBe(expected);
  });

  it("copes with padding and double spaces", () => {
    expect(initialsFor("  Joey   Pang  ")).toBe("JP");
  });

  it("never renders an empty avatar", () => {
    // A blank square reads as a broken image.
    expect(initialsFor("")).toBe("?");
    expect(initialsFor("   ")).toBe("?");
  });
});

describe("railName", () => {
  it.each([
    ["Joey Pang", "Joey P"],
    ["Sam Tierney", "Sam T"],
    ["Alex Moran", "Alex M"],
  ])("shortens %j to %j, because the rail is 180px", (name, expected) => {
    expect(railName(name)).toBe(expected);
  });

  it("leaves a single name alone", () => {
    expect(railName("Joey")).toBe("Joey");
  });

  it("uses the last name, not the middle one", () => {
    expect(railName("Mary Anne Smith")).toBe("Mary S");
  });

  it("returns nothing for nothing, rather than a stray initial", () => {
    expect(railName("")).toBe("");
  });
});

describe("NOT_A_COACH", () => {
  it("is the safe default when the link lookup fails", () => {
    // Falling back to "is a coach" would show an empty roster and a switcher to
    // nothing. Falling back to "is not" just hides a button.
    expect(NOT_A_COACH).toEqual({ isCoach: false, athleteIds: [] });
  });
});
