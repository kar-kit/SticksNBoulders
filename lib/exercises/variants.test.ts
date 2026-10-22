import { describe, expect, it } from "vitest";
import { SEED_EXERCISES } from "./seed";
import { siblingVariants, swapOptions, variantKey } from "./variants";

const ex = (name: string, id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-")) => ({ id, name });
const names = (list: readonly { name: string }[]) => list.map((e) => e.name);
const seed = SEED_EXERCISES.map((name) => ex(name));
const byName = (name: string) => seed.find((e) => e.name === name)!;

describe("variantKey", () => {
  it.each([
    ["Barbell Row", "barbell", "row"],
    ["Dumbbell Row", "dumbbell", "row"],
    ["Cable Front Raise", "cable", "front raise"],
    ["Plate Front Raise", "plate", "front raise"],
    ["Machine Chest Press", "machine", "chest press"],
    ["Smith Machine Squat", "smith", "squat"],
    ["Smith Squat", "smith", "squat"],
    ["Kettlebell Swing", "kettlebell", "swing"],
    ["EZ-Bar Curl", "ez bar", "curl"],
    ["EZ Bar Curl", "ez bar", "curl"],
    ["EZBar Curl", "ez bar", "curl"],
    ["DB Row", "dumbbell", "row"],
    ["KB Swing", "kettlebell", "swing"],
    ["Dumbbells Lunge", "dumbbell", "lunge"],
    ["Banded Pull Apart", "band", "pull apart"],
    ["Landmine Press", "landmine", "press"],
  ])("splits %s into %s + %s", (name, implement, movement) => {
    expect(variantKey(name)).toEqual({ implement, movement });
  });

  it("matches case, punctuation and spacing the way the library does", () => {
    expect(variantKey("  dumbbell-ROW ")).toEqual({ implement: "dumbbell", movement: "row" });
    expect(variantKey("Cable  Front   Raise")).toEqual({ implement: "cable", movement: "front raise" });
  });

  it("leaves a bare name whole", () => {
    expect(variantKey("Lateral Raise")).toEqual({ implement: null, movement: "lateral raise" });
    expect(variantKey("Squat")).toEqual({ implement: null, movement: "squat" });
  });

  it("only strips a leading implement, never one in the middle", () => {
    expect(variantKey("Seated Cable Row")).toEqual({ implement: null, movement: "seated cable row" });
    expect(variantKey("Close Grip Bench Press").implement).toBeNull();
  });

  it("does not strip a word that merely starts like an implement", () => {
    expect(variantKey("Plateau Squat")).toEqual({ implement: null, movement: "plateau squat" });
    expect(variantKey("Cablecross")).toEqual({ implement: null, movement: "cablecross" });
    expect(variantKey("Dbl Leg Press").implement).toBeNull();
  });

  it("leaves a name that is only an implement alone", () => {
    expect(variantKey("Cable")).toEqual({ implement: null, movement: "cable" });
    expect(variantKey("Machine")).toEqual({ implement: null, movement: "machine" });
  });

  it("does not treat specialty bars as implements", () => {
    expect(variantKey("Safety Bar Squat")).toEqual({ implement: null, movement: "safety bar squat" });
    expect(variantKey("Trap Bar Deadlift").implement).toBeNull();
  });
});

describe("siblingVariants", () => {
  it("finds the front raise trio in the seed library", () => {
    expect(names(siblingVariants(byName("Dumbbell Front Raise"), seed))).toEqual([
      "Cable Front Raise",
      "Plate Front Raise",
    ]);
    expect(names(siblingVariants(byName("Plate Front Raise"), seed))).toEqual([
      "Cable Front Raise",
      "Dumbbell Front Raise",
    ]);
  });

  it("pairs Barbell and Dumbbell Row, and leaves Pendlay and Seated Cable Row out", () => {
    expect(names(siblingVariants(byName("Barbell Row"), seed))).toEqual(["Dumbbell Row"]);
    expect(names(siblingVariants(byName("Dumbbell Row"), seed))).toEqual(["Barbell Row"]);
  });

  it("pairs Barbell and Dumbbell Curl, not Hammer Curl", () => {
    expect(names(siblingVariants(byName("Barbell Curl"), seed))).toEqual(["Dumbbell Curl"]);
  });

  it("pairs a bare name with its implemented versions", () => {
    const library = [ex("Lateral Raise"), ex("Cable Lateral Raise"), ex("Machine Lateral Raise")];
    expect(names(siblingVariants(library[0], library))).toEqual(["Cable Lateral Raise", "Machine Lateral Raise"]);
    expect(names(siblingVariants(library[1], library))).toEqual(["Lateral Raise", "Machine Lateral Raise"]);
  });

  it("offers the comp bench's dumbbell version, because the name says so", () => {
    // Recorded rather than hidden: the coach's pick still leads the list.
    expect(names(siblingVariants(byName("Bench Press"), seed))).toEqual(["Dumbbell Bench Press"]);
  });

  it("gives the comp lifts and their bar variations no siblings from a different movement", () => {
    for (const name of ["Squat", "Front Squat", "Pause Squat", "Deadlift", "Sumo Deadlift", "Safety Bar Squat"]) {
      expect(siblingVariants(byName(name), seed)).toEqual([]);
    }
  });

  it("never offers the exercise itself, a duplicate spelling, or another spelling of the same implement", () => {
    const library = [
      ex("Dumbbell Row", "a"),
      ex("dumbbell row", "b"),
      ex("DB Row", "c"),
      ex("Barbell Row", "d"),
      ex("Barbell  Row", "e"),
    ];
    expect(siblingVariants(library[0], library).map((e) => e.id)).toEqual(["d"]);
  });

  it("returns nothing for two bare names, or a lift with no relatives", () => {
    const library = [ex("Plank"), ex("Plank", "plank-2"), ex("Hip Thrust")];
    expect(siblingVariants(library[0], library)).toEqual([]);
    expect(siblingVariants(library[2], library)).toEqual([]);
  });

  it("works on an athlete's own exercises the same as the seed", () => {
    const library = [...seed, ex("Kettlebell Front Raise", "own-1")];
    expect(names(siblingVariants(byName("Cable Front Raise"), library))).toEqual([
      "Dumbbell Front Raise",
      "Kettlebell Front Raise",
      "Plate Front Raise",
    ]);
  });

  it("finds the whole seed's sibling groups and nothing surprising", () => {
    const groups = new Set<string>();
    for (const exercise of seed) {
      const siblings = siblingVariants(exercise, seed);
      if (siblings.length) groups.add([exercise.name, ...names(siblings)].sort().join(" | "));
    }
    expect([...groups].sort()).toEqual([
      "Barbell Curl | Dumbbell Curl",
      "Barbell Row | Dumbbell Row",
      "Bench Press | Dumbbell Bench Press",
      "Cable Front Raise | Dumbbell Front Raise | Plate Front Raise",
    ]);
  });
});

describe("swapOptions", () => {
  it("puts the coach's pick first, then its siblings", () => {
    expect(names(swapOptions(byName("Cable Front Raise"), seed))).toEqual([
      "Cable Front Raise",
      "Dumbbell Front Raise",
      "Plate Front Raise",
    ]);
  });

  it("offers nothing when the pick has no siblings, so there is no dead-end Swap", () => {
    expect(swapOptions(byName("Squat"), seed)).toEqual([]);
  });

  it("leaves out exercises that already have a block of their own", () => {
    const exclude = new Set([byName("Plate Front Raise").id]);
    expect(names(swapOptions(byName("Cable Front Raise"), seed, exclude))).toEqual([
      "Cable Front Raise",
      "Dumbbell Front Raise",
    ]);
  });

  it("offers nothing once every sibling is excluded", () => {
    expect(swapOptions(byName("Barbell Row"), seed, new Set([byName("Dumbbell Row").id]))).toEqual([]);
  });
});
