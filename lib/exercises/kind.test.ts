import { beforeEach, describe, expect, it } from "vitest";
import { cardioLookup, isCardioExercise, kindOf, parseKind } from "./kind";
import { cacheLibrary, cachedLibrary } from "./library-cache";
import type { Exercise } from "./match";

const ex = (id: string, over: Partial<Exercise> = {}): Exercise => ({
  id,
  name: id,
  normalisedName: id.toLowerCase(),
  isGlobal: true,
  ...over,
});

beforeEach(() => localStorage.clear());

describe("kindOf", () => {
  it("is cardio only when the exercise says so, and strength for everything else", () => {
    expect(kindOf(ex("Treadmill", { kind: "cardio" }))).toBe("cardio");
    expect(kindOf(ex("Squat", { kind: "strength" }))).toBe("strength");
    // Every exercise from before v21.
    expect(kindOf(ex("Squat"))).toBe("strength");
    expect(kindOf(null)).toBe("strength");
    expect(kindOf(undefined)).toBe("strength");
    expect(isCardioExercise(ex("Bike", { kind: "cardio" }))).toBe(true);
    expect(isCardioExercise(ex("Squat"))).toBe(false);
  });

  it("parses only the exact word cardio as cardio", () => {
    expect(parseKind("cardio")).toBe("cardio");
    for (const value of ["strength", "Cardio", null, undefined, 1, "mobility"]) expect(parseKind(value)).toBe("strength");
  });
});

describe("cardioLookup", () => {
  it("answers by id, and an id the library does not know is strength", () => {
    const lookup = cardioLookup([ex("bike", { kind: "cardio" }), ex("squat")]);
    expect(lookup("bike")).toBe(true);
    expect(lookup("squat")).toBe(false);
    expect(lookup("ex-unknown")).toBe(false);
  });
});

describe("the device's cached library (offline)", () => {
  it("reads a row cached before v21, with no kind at all, as strength", () => {
    // What a phone that last fetched the library before this release holds.
    localStorage.setItem(
      "snb.library",
      JSON.stringify({
        userId: "joey",
        exercises: [{ id: "tm", name: "Treadmill", normalisedName: "treadmill", isGlobal: true, isBodyweight: false }],
      }),
    );
    const cached = cachedLibrary("joey")!;
    expect(cached.map((e) => e.name)).toEqual(["Treadmill"]);
    expect(kindOf(cached[0])).toBe("strength");
    expect(cardioLookup(cached)("tm")).toBe(false);
  });

  it("keeps the kind across a cold start once a v21 library has been cached", () => {
    cacheLibrary("joey", [ex("tm", { kind: "cardio" }), ex("squat", { kind: "strength" })]);
    const lookup = cardioLookup(cachedLibrary("joey")!);
    expect(lookup("tm")).toBe(true);
    expect(lookup("squat")).toBe(false);
  });
});
