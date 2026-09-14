import { SEED_EXERCISES } from "./seed";
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

  it("stays a starting list, not a bodybuilding database", () => {
    // If this ever fails, the question is whether the library grew because a
    // coach asked or because someone was being thorough.
    expect(SEED_EXERCISES.length).toBeLessThan(80);
  });
});
