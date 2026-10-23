import { changesSet, draftOf, editOf } from "./logged-edit";

const set = { loadKg: 140, reps: 5, rpe: 8, isWarmup: false };

describe("draftOf", () => {
  it("opens on the set's own values", () => {
    expect(draftOf(set)).toEqual({ loadKg: 140, reps: 5, rpe: 8, isWarmup: false, notes: "" });
  });

  it("gives a warm-up the RPE it had before it was made one, ready for the switch back", () => {
    expect(draftOf({ ...set, rpe: null, isWarmup: true }, 7.5)).toEqual({
      loadKg: 140,
      reps: 5,
      rpe: 7.5,
      isWarmup: true,
      notes: "",
    });
    // A working set's own RPE wins over anything held.
    expect(draftOf(set, 6).rpe).toBe(8);
  });
});

describe("editOf", () => {
  it("is the four values Save writes", () => {
    expect(editOf({ loadKg: 142.5, reps: 3, rpe: 9, isWarmup: false, notes: "" })).toEqual({
      loadKg: 142.5,
      reps: 3,
      rpe: 9,
      isWarmup: false,
      notes: null,
    });
  });

  it("drops the RPE from a warm-up, so the stored e1RM goes with it", () => {
    expect(editOf({ loadKg: 60, reps: 5, rpe: 8, isWarmup: true, notes: "" })).toEqual({
      loadKg: 60,
      reps: 5,
      rpe: null,
      isWarmup: true,
      notes: null,
    });
  });

  it("is nothing for a draft that is not a set: empty, or zero", () => {
    expect(editOf({ loadKg: null, reps: 5, rpe: null, isWarmup: false, notes: "" })).toBeNull();
    expect(editOf({ loadKg: 140, reps: null, rpe: null, isWarmup: false, notes: "" })).toBeNull();
    expect(editOf({ loadKg: 0, reps: 5, rpe: null, isWarmup: false, notes: "" })).toBeNull();
    expect(editOf({ loadKg: 140, reps: 0, rpe: null, isWarmup: false, notes: "" })).toBeNull();
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

describe("the note (F11)", () => {
  it("opens on the set's note, or blank for none", () => {
    expect(draftOf({ ...set, notes: "Hip pinched" }).notes).toBe("Hip pinched");
    expect(draftOf({ ...set, notes: null }).notes).toBe("");
  });

  it("saves the note trimmed, and a blank note as null so it clears", () => {
    const draft = { loadKg: 140, reps: 5, rpe: 8 as const, isWarmup: false };
    expect(editOf({ ...draft, notes: "  belt loose  " })?.notes).toBe("belt loose");
    expect(editOf({ ...draft, notes: "   " })?.notes).toBeNull();
    expect(editOf({ ...draft, notes: "" })?.notes).toBeNull();
  });

  it("caps a note at the column's 500 characters", () => {
    const draft = { loadKg: 140, reps: 5, rpe: 8 as const, isWarmup: false };
    expect(editOf({ ...draft, notes: "x".repeat(600) })?.notes).toHaveLength(500);
  });

  it("counts a note written, changed or cleared as a change, and blank over none as none", () => {
    expect(changesSet(set, { ...set, notes: "Hip pinched" })).toBe(true);
    expect(changesSet({ ...set, notes: "a" }, { ...set, notes: "b" })).toBe(true);
    expect(changesSet({ ...set, notes: "a" }, { ...set, notes: null })).toBe(true);
    expect(changesSet(set, { ...set, notes: null })).toBe(false);
    expect(changesSet({ ...set, notes: "a" }, { ...set, notes: "a" })).toBe(false);
    // An edit that says nothing about the note (the warm-up flip) is not a note change.
    expect(changesSet({ ...set, notes: "a" }, { ...set })).toBe(false);
  });
});
