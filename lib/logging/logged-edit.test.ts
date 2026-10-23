import { changesSet, draftOf, editOf } from "./logged-edit";

const set = { loadKg: 140, reps: 5, rpe: 8, isWarmup: false };

describe("draftOf", () => {
  it("opens on the set's own values", () => {
    expect(draftOf(set)).toEqual({ loadKg: 140, reps: 5, rpe: 8, isWarmup: false });
  });

  it("gives a warm-up the RPE it had before it was made one, ready for the switch back", () => {
    expect(draftOf({ ...set, rpe: null, isWarmup: true }, 7.5)).toEqual({
      loadKg: 140,
      reps: 5,
      rpe: 7.5,
      isWarmup: true,
    });
    // A working set's own RPE wins over anything held.
    expect(draftOf(set, 6).rpe).toBe(8);
  });
});

describe("editOf", () => {
  it("is the four values Save writes", () => {
    expect(editOf({ loadKg: 142.5, reps: 3, rpe: 9, isWarmup: false })).toEqual({
      loadKg: 142.5,
      reps: 3,
      rpe: 9,
      isWarmup: false,
    });
  });

  it("drops the RPE from a warm-up, so the stored e1RM goes with it", () => {
    expect(editOf({ loadKg: 60, reps: 5, rpe: 8, isWarmup: true })).toEqual({
      loadKg: 60,
      reps: 5,
      rpe: null,
      isWarmup: true,
    });
  });

  it("is nothing for a draft that is not a set: empty, or zero", () => {
    expect(editOf({ loadKg: null, reps: 5, rpe: null, isWarmup: false })).toBeNull();
    expect(editOf({ loadKg: 140, reps: null, rpe: null, isWarmup: false })).toBeNull();
    expect(editOf({ loadKg: 0, reps: 5, rpe: null, isWarmup: false })).toBeNull();
    expect(editOf({ loadKg: 140, reps: 0, rpe: null, isWarmup: false })).toBeNull();
  });
});

describe("changesSet", () => {
  it("is false for the set as it was, so an untouched Save writes nothing", () => {
    expect(changesSet(set, { ...set })).toBe(false);
  });

  it("is true for any one of the four values", () => {
    expect(changesSet(set, { ...set, loadKg: 142.5 })).toBe(true);
    expect(changesSet(set, { ...set, reps: 4 })).toBe(true);
    expect(changesSet(set, { ...set, rpe: null })).toBe(true);
    expect(changesSet(set, { ...set, isWarmup: true })).toBe(true);
  });
});
