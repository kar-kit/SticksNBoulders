import { setTargetFor } from "./set-targets";
import type { SetTarget } from "@/lib/programming/session-plan";

const target = (over: Partial<SetTarget>): SetTarget => ({
  prescriptionId: "l1",
  exerciseId: "squat",
  setNumber: 2,
  totalSets: 3,
  loadKg: null,
  reps: 5,
  repMax: null,
  rpe: 8,
  kind: "rpe",
  display: "RPE 8",
  synced: false,
  unresolved: false,
  anchor: null,
  snapshot: "5 reps · RPE 8",
  ...over,
});

describe("the target a next-set suggestion works toward", () => {
  it("is the prescribed reps and RPE", () => {
    expect(setTargetFor(target({}))).toEqual({ reps: 5, rpe: 8 });
    expect(setTargetFor(target({ kind: "capped", loadKg: 150, rpe: 8.5, reps: 3 }))).toEqual({ reps: 3, rpe: 8.5 });
  });

  it("is nothing without a prescription, an RPE, or a rep count", () => {
    expect(setTargetFor(null)).toBeNull();
    expect(setTargetFor(target({ kind: "fixed", rpe: null, loadKg: 140 }))).toBeNull();
    expect(setTargetFor(target({ reps: null }))).toBeNull();
  });
});

describe("a backoff set (Order 21)", () => {
  it("never feeds the suggestion engine, even when its rule names an RPE", () => {
    const backoff = {
      rule: { kind: "drop" as const, dropPercent: 5, untilRpe: 9 as const, maxSets: null },
      topSet: { loadKg: 180, reps: 3, rpe: 8 },
    };
    expect(setTargetFor(target({ kind: null, rpe: 9, loadKg: 170, backoff }))).toBeNull();
  });
});
