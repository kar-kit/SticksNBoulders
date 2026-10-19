import { describe, expect, it, vi } from "vitest";
import { setPermissions } from "@/appwrite/documents/policy";
import { FakeTables } from "@/lib/testing/fake-tables";
import { exerciseInUse, fetchExerciseUsage } from "./usage-store";

const db = vi.hoisted(() => ({ tables: null as FakeTables | null }));
vi.mock("@/appwrite/browser-client", () => ({
  browserAppwrite: () => ({ databaseId: "db", tables: db.tables! }),
}));

const set = (id: string, athleteId: string, exerciseId: string, stamp = athleteId) => ({
  $id: id,
  $permissions: setPermissions({ athleteId: stamp }),
  athlete_id: athleteId,
  exercise_id: exerciseId,
});

describe("fetchExerciseUsage", () => {
  it("finds nothing for an unused exercise", async () => {
    db.tables = new FakeTables().seed("sets", [set("st-1", "joey", "squat")]);
    expect(await fetchExerciseUsage("joey", "ex-1")).toEqual({ sets: false, referenceMaxes: false, prescriptions: false });
    expect(await exerciseInUse("joey", "ex-1")).toBe(false);
  });

  it("sees this athlete's sets, and only theirs", async () => {
    db.tables = new FakeTables().seed("sets", [set("st-1", "someone", "ex-1")]);
    expect((await fetchExerciseUsage("joey", "ex-1")).sets).toBe(false);
    db.tables.seed("sets", [set("st-2", "joey", "ex-1")]);
    expect((await fetchExerciseUsage("joey", "ex-1")).sets).toBe(true);
  });

  it("ignores a forged set naming the exercise, so a stranger cannot pin it", async () => {
    db.tables = new FakeTables().seed("sets", [set("st-1", "joey", "ex-1", "stranger")]);
    expect(await exerciseInUse("joey", "ex-1")).toBe(false);
  });

  it("sees a reference max, and a program line using it as the lift or the max", async () => {
    db.tables = new FakeTables().seed("reference_maxes", [{ $id: "rm", athlete_id: "joey", exercise_id: "ex-1" }]);
    expect(await fetchExerciseUsage("joey", "ex-1")).toMatchObject({ referenceMaxes: true, prescriptions: false });

    db.tables = new FakeTables().seed("prescriptions", [
      { $id: "p1", athlete_id: "joey", exercise_id: "squat", reference_exercise_id: "ex-1" },
    ]);
    expect(await fetchExerciseUsage("joey", "ex-1")).toMatchObject({ prescriptions: true });
  });
});
