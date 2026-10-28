import { BODYWEIGHT_EXERCISES, SEED_EXERCISES, VIDEO_DEFAULT_EXERCISES } from "./seed";
import { rankExercises, type Exercise } from "./match";
import { normaliseExerciseName } from "@/appwrite/documents";

const library: Exercise[] = SEED_EXERCISES.map((name) => ({
  id: name,
  name,
  normalisedName: normaliseExerciseName(name),
  isGlobal: true,
}));

describe("the shared library", () => {
  it("holds no two names that normalise the same", () => {
    // idx_normalised is a key index, not unique, so nothing in Appwrite would
    // stop this -- it would just give an athlete two identical rows to choose
    // between mid-set, and split one lift's history across both.
    const seen = new Map<string, string>();
    const collisions: string[] = [];
    for (const name of SEED_EXERCISES) {
      const key = normaliseExerciseName(name);
      const first = seen.get(key);
      if (first) collisions.push(`${first} / ${name}`);
      else seen.set(key, name);
    }
    expect(collisions).toEqual([]);
  });

  it("normalises every name to something non-empty", () => {
    expect(SEED_EXERCISES.filter((n) => !normaliseExerciseName(n))).toEqual([]);
  });

  it("holds the three competition lifts under the names people type", () => {
    for (const [query, expected] of [
      ["squat", "Squat"],
      ["bench", "Bench Press"],
      ["deadlift", "Deadlift"],
    ] as const) {
      expect(rankExercises(query, library)[0].exercise.name).toBe(expected);
    }
  });

  it("answers the abbreviations a coach writes in a block", () => {
    for (const [query, expected] of [
      ["rdl", "Romanian Deadlift"],
      ["cgbp", "Close Grip Bench Press"],
      ["bss", "Bulgarian Split Squat"],
    ] as const) {
      expect(rankExercises(query, library)[0].exercise.name).toBe(expected);
    }
  });

  it("finds each front raise variant under the queries people type", () => {
    const top = (query: string) => rankExercises(query, library).map((m) => m.exercise.name);
    const variants = ["Cable Front Raise", "Dumbbell Front Raise", "Plate Front Raise"];
    expect(top("front raise").slice(0, 3).sort()).toEqual(variants);
    expect(top("front raise")).not.toContain("Front Squat");
    expect(top("db front raise")).toContain("Dumbbell Front Raise");
    expect(top("cable raise")).toContain("Cable Front Raise");
    expect(top("cable front")[0]).toBe("Cable Front Raise");
    expect(top("plate")[0]).toBe("Plate Front Raise");
  });

  it("keeps front raise as one row per implement, with no generic parent", () => {
    const names = SEED_EXERCISES.filter((n) => /front raise/i.test(n)).sort();
    expect(names).toEqual(["Cable Front Raise", "Dumbbell Front Raise", "Plate Front Raise"]);
  });

  it("stays a starting list, not a bodybuilding database", () => {
    // If this ever fails, the question is whether the library grew because a
    // coach asked or because someone was being thorough.
    expect(SEED_EXERCISES.length).toBeLessThan(80);
  });
});

describe("the video default", () => {
  it("covers the three competition lifts and nothing else", () => {
    // Variations and accessories are Ruairi's call, not a guess: [SME to confirm].
    expect([...VIDEO_DEFAULT_EXERCISES].sort()).toEqual(["Bench Press", "Deadlift", "Squat"]);
  });

  it("names only exercises the seed actually holds", () => {
    const seeded = new Set(SEED_EXERCISES.map(normaliseExerciseName));
    expect(VIDEO_DEFAULT_EXERCISES.filter((n) => !seeded.has(normaliseExerciseName(n)))).toEqual([]);
  });
});

describe("the bodyweight flag (F20)", () => {
  it("covers the unloaded movements the library holds", () => {
    expect([...BODYWEIGHT_EXERCISES].sort()).toEqual([
      "Ab Wheel Rollout",
      "Back Extension",
      "Chin Up",
      "Dip",
      "Hanging Leg Raise",
      "Plank",
      "Pull Up",
      "Push Up",
    ]);
  });

  it("names only exercises the seed actually holds", () => {
    const seeded = new Set(SEED_EXERCISES.map(normaliseExerciseName));
    expect(BODYWEIGHT_EXERCISES.filter((n) => !seeded.has(normaliseExerciseName(n)))).toEqual([]);
  });

  it("never flags a barbell lift, so a 0 typed on one is still refused", () => {
    // The whole point of a per-exercise flag: a fat-fingered 0 on a squat is
    // a mistake the Log keeps catching.
    const flagged = new Set(BODYWEIGHT_EXERCISES.map(normaliseExerciseName));
    for (const lift of [...VIDEO_DEFAULT_EXERCISES, "Overhead Press", "Barbell Row", "Romanian Deadlift"]) {
      expect(flagged.has(normaliseExerciseName(lift))).toBe(false);
    }
  });
});
