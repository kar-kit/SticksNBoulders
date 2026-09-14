import {
  defaultExercises,
  findByName,
  isNewExercise,
  rankExercises,
  tierFor,
  type Exercise,
} from "./match";
import { normaliseExerciseName } from "@/appwrite/documents";

const make = (name: string, options: Partial<Exercise> = {}): Exercise => ({
  id: name.toLowerCase().replace(/\W+/g, "-"),
  name,
  normalisedName: normaliseExerciseName(name),
  isGlobal: true,
  ...options,
});

/** A slice of the real seed, plus one an athlete typed in mid-session. */
const LIBRARY: Exercise[] = [
  make("Squat"),
  make("Front Squat"),
  make("Bulgarian Split Squat"),
  make("Bench Press"),
  make("Close Grip Bench Press"),
  make("Deadlift"),
  make("Romanian Deadlift"),
  make("Overhead Press"),
  make("Barbell Row"),
  make("Joey's Weird Machine Thing", { isGlobal: false, ownerId: "joey" }),
];

const names = (query: string, limit?: number) =>
  rankExercises(query, LIBRARY, limit).map((m) => m.exercise.name);

describe("ranking what someone typed", () => {
  it("puts an exact name first, even when longer names also match", () => {
    expect(names("squat")[0]).toBe("Squat");
  });

  it("prefers the shorter name when both are prefixes", () => {
    // "Squat" and "Squat, Paused" would both be prefix matches; shorter is the
    // right guess almost every time.
    const library = [make("Squat, Paused"), make("Squat")];
    expect(rankExercises("squ", library)[0].exercise.name).toBe("Squat");
  });

  it("matches an acronym, which is how people type Romanian Deadlift", () => {
    expect(names("rdl")[0]).toBe("Romanian Deadlift");
    expect(tierFor("rdl", make("Romanian Deadlift"))).toBe("acronym");
  });

  it("matches cgbp and bss, the other two everyone abbreviates", () => {
    expect(names("cgbp")[0]).toBe("Close Grip Bench Press");
    expect(names("bss")[0]).toBe("Bulgarian Split Squat");
  });

  it("matches a word from the middle of a name", () => {
    expect(names("split")).toContain("Bulgarian Split Squat");
    expect(tierFor("split", make("Bulgarian Split Squat"))).toBe("word-prefix");
  });

  it("forgives a typo, because this is typed one-handed mid-set", () => {
    expect(names("bech press")).toContain("Bench Press");
    expect(names("deadlft")).toContain("Deadlift");
  });

  it("is case and punctuation blind", () => {
    expect(names("BENCH PRESS")[0]).toBe("Bench Press");
    expect(names("bench-press")[0]).toBe("Bench Press");
    expect(names("  bench   press  ")[0]).toBe("Bench Press");
  });

  it("does not treat one letter as an abbreviation for everything", () => {
    // The 400-item dropdown this feature exists to avoid, rebuilt by accident.
    expect(names("s").length).toBeLessThan(LIBRARY.length);
    expect(names("s")).not.toContain("Bench Press");
  });

  it("does not read a multi-word query as an acronym", () => {
    expect(tierFor("back s", make("Bulgarian Split Squat"))).not.toBe("acronym");
  });

  it("returns nothing for a query that matches nothing", () => {
    expect(names("kettlebell juggling")).toEqual([]);
  });

  it("returns nothing for an empty or punctuation-only query", () => {
    expect(names("")).toEqual([]);
    expect(names("   ")).toEqual([]);
    expect(names("!!!")).toEqual([]);
  });

  it("caps the list, because a phone shows eight without scrolling", () => {
    expect(names("s", 3).length).toBeLessThanOrEqual(3);
    const many = Array.from({ length: 50 }, (_, i) => make(`Squat Variation ${i}`));
    expect(rankExercises("squat", many)).toHaveLength(8);
  });

  it("ranks deterministically, so the first result never moves under a thumb", () => {
    const once = names("press");
    const again = rankExercises("press", [...LIBRARY].reverse()).map((m) => m.exercise.name);
    expect(again).toEqual(once);
  });
});

describe("the list before anything is typed", () => {
  it("is never empty, because an empty field is where the athlete starts", () => {
    expect(defaultExercises(LIBRARY).length).toBeGreaterThan(0);
  });

  it("offers what the athlete typed in themselves first", () => {
    // They created it mid-session precisely because the library lacked it.
    expect(defaultExercises(LIBRARY)[0].name).toBe("Joey's Weird Machine Thing");
  });
});

describe("recognising a name the library already holds", () => {
  it("finds a match regardless of case or spacing", () => {
    expect(findByName("  BENCH   press ", LIBRARY)?.name).toBe("Bench Press");
  });

  it("prefers the shared library entry over a personal duplicate", () => {
    // idx_normalised is a key index, not unique, so both can exist. Sending an
    // athlete to their own copy would split one lift's history in two.
    const library = [make("Barbell Row", { isGlobal: false, ownerId: "joey" }), make("Barbell Row")];
    expect(findByName("barbell row", library)?.isGlobal).toBe(true);
  });

  it("says when a typed name would be something genuinely new", () => {
    expect(isNewExercise("Zercher Squat", LIBRARY)).toBe(true);
    expect(isNewExercise("bench press", LIBRARY)).toBe(false);
    expect(isNewExercise("   ", LIBRARY)).toBe(false);
  });
});
