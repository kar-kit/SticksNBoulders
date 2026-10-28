import { bodyweightLookup, isBodyweight } from "./bodyweight";
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

describe("isBodyweight", () => {
  it("is true only when the flag is", () => {
    expect(isBodyweight(ex("Pull Up", { isBodyweight: true }))).toBe(true);
    expect(isBodyweight(ex("Squat", { isBodyweight: false }))).toBe(false);
    // Every exercise from before v20.
    expect(isBodyweight(ex("Squat"))).toBe(false);
    expect(isBodyweight(null)).toBe(false);
    expect(isBodyweight(undefined)).toBe(false);
  });
});

describe("bodyweightLookup", () => {
  it("answers by id, and an id the library does not know is not bodyweight", () => {
    const lookup = bodyweightLookup([ex("pull-up", { isBodyweight: true }), ex("squat")]);
    expect(lookup("pull-up")).toBe(true);
    expect(lookup("squat")).toBe(false);
    // Refusing a 0 kg set is the safe answer for a lift the phone cannot name.
    expect(lookup("ex-unknown")).toBe(false);
  });
});

describe("the device's cached library (offline)", () => {
  it("reads a row cached before v20, with no flag at all, as not bodyweight", () => {
    // What a phone that last fetched the library before this release holds:
    // the old shape, written straight to storage.
    localStorage.setItem(
      "snb.library",
      JSON.stringify({
        userId: "joey",
        exercises: [{ id: "dip", name: "Dip", normalisedName: "dip", isGlobal: true, videoDefault: false }],
      }),
    );
    const cached = cachedLibrary("joey")!;
    expect(cached.map((e) => e.name)).toEqual(["Dip"]);
    expect(isBodyweight(cached[0])).toBe(false);
    expect(bodyweightLookup(cached)("dip")).toBe(false);
  });

  it("keeps the flag across a cold start once a v20 library has been cached", () => {
    cacheLibrary("joey", [ex("pull-up", { isBodyweight: true }), ex("squat", { isBodyweight: false })]);
    const lookup = bodyweightLookup(cachedLibrary("joey")!);
    expect(lookup("pull-up")).toBe(true);
    expect(lookup("squat")).toBe(false);
  });
});
