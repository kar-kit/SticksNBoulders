import { describe, expect, it } from "vitest";
import {
  addRow,
  afterConfirm,
  discardRow,
  focusExercise,
  headOf,
  nextSetIndex,
  plannedIndex,
  rowAfter,
  rowsOf,
  type PlannedRow,
} from "./plan";

const ids = () => {
  let n = 0;
  return () => `st-${++n}`;
};

const row = (over: Partial<PlannedRow> = {}): PlannedRow => ({
  exerciseId: "squat",
  clientSetId: "st-x",
  loadKg: 140,
  reps: 5,
  rpe: null,
  isWarmup: false,
  planned: false,
  ...over,
});

describe("rowAfter", () => {
  it("repeats the previous set, and never its RPE or warm-up flag", () => {
    const next = rowAfter("squat", { loadKg: 142.5, reps: 3 }, ids());
    expect(next).toMatchObject({ loadKg: 142.5, reps: 3, rpe: null, isWarmup: false, planned: false });
  });

  it("is empty with nothing before it", () => {
    expect(rowAfter("squat", null, ids())).toMatchObject({ loadKg: null, reps: null });
  });
});

describe("addRow", () => {
  it("prefills from the last planned row, not the last logged set", () => {
    const rows = [row({ clientSetId: "head", loadKg: 180, reps: 2 })];
    const next = addRow(rows, "squat", { loadKg: 170, reps: 3 }, ids());
    expect(rowsOf(next, "squat").map((r) => [r.loadKg, r.reps])).toEqual([
      [180, 2],
      [180, 2],
    ]);
  });

  it("prefills from the last logged set when nothing is planned", () => {
    const next = addRow([], "squat", { loadKg: 170, reps: 3 }, ids());
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ loadKg: 170, reps: 3, planned: true });
  });

  it("marks the whole exercise's plan as planned, so it survives a glance elsewhere", () => {
    const next = addRow([row({ clientSetId: "head" })], "squat", null, ids());
    expect(next.every((r) => r.planned)).toBe(true);
  });

  it("leaves other exercises alone", () => {
    const bench = row({ exerciseId: "bench", clientSetId: "b1" });
    const next = addRow([bench], "squat", null, ids());
    expect(next.find((r) => r.clientSetId === "b1")).toEqual(bench);
  });

  it("after the last row was confirmed, the new row is the exercise's head", () => {
    // Nothing planned for squat any more, only bench waiting: Add set has to
    // produce the row the confirm square belongs to.
    const bench = row({ exerciseId: "bench", clientSetId: "b1", planned: true });
    const next = addRow([bench], "squat", { loadKg: 170, reps: 3 }, ids());
    expect(headOf(next, "squat")).toMatchObject({ loadKg: 170, reps: 3, planned: true });
  });
});

describe("afterConfirm", () => {
  it("promotes the next planned row and adds nothing", () => {
    const rows = [
      row({ clientSetId: "a", planned: true }),
      row({ clientSetId: "b", loadKg: 120, planned: true }),
    ];
    const { rows: next, next: head } = afterConfirm(rows, "a");
    expect(next.map((r) => r.clientSetId)).toEqual(["b"]);
    expect(head?.clientSetId).toBe("b");
    expect(head?.loadKg).toBe(120);
  });

  it("adds nothing when the confirmed row was the last one -- confirming means done", () => {
    const { rows: next, next: head } = afterConfirm([row({ clientSetId: "a" })], "a");
    expect(next).toEqual([]);
    expect(head).toBeNull();
    expect(headOf(next, "squat")).toBeNull();
  });

  it("only touches the confirmed exercise", () => {
    const rows = [row({ clientSetId: "a" }), row({ exerciseId: "bench", clientSetId: "b", planned: true })];
    const { rows: next, next: head } = afterConfirm(rows, "a");
    expect(next.map((r) => r.clientSetId)).toEqual(["b"]);
    // Another exercise's waiting row is not this one's next set.
    expect(head).toBeNull();
  });

  it("refuses a row that is not in the plan", () => {
    expect(() => afterConfirm([], "nope")).toThrow();
  });
});

describe("focusExercise", () => {
  it("drops untouched automatic rows elsewhere, keeps planned ones", () => {
    const rows = [
      row({ exerciseId: "bench", clientSetId: "auto" }),
      row({ exerciseId: "deadlift", clientSetId: "kept", planned: true }),
    ];
    const { rows: next, head } = focusExercise(rows, "squat", { loadKg: 100, reps: 5 }, ids());
    expect(next.map((r) => r.clientSetId)).toEqual(["kept", head.clientSetId]);
    expect(head).toMatchObject({ exerciseId: "squat", loadKg: 100 });
  });

  it("returns to an exercise's existing plan rather than adding to it", () => {
    const rows = [row({ clientSetId: "a", planned: true }), row({ clientSetId: "b", planned: true })];
    const { rows: next, head } = focusExercise(rows, "squat", null, ids());
    expect(next).toHaveLength(2);
    expect(head.clientSetId).toBe("a");
  });
});

describe("discardRow and headOf", () => {
  it("removes one row and the next becomes the head", () => {
    const rows = [row({ clientSetId: "a" }), row({ clientSetId: "b" })];
    const next = discardRow(rows, "a");
    expect(headOf(next, "squat")?.clientSetId).toBe("b");
    expect(headOf(next, "bench")).toBeNull();
  });
});

describe("plannedIndex", () => {
  it("continues from the logged working sets and skips warm-ups", () => {
    const mine = [row(), row({ isWarmup: true }), row()];
    expect(plannedIndex(2, mine, 0)).toBe(3);
    expect(plannedIndex(2, mine, 1)).toBe("W");
    expect(plannedIndex(2, mine, 2)).toBe(4);
  });
});

describe("nextSetIndex", () => {
  it("is one past the highest index, so a deleted set's number is never handed out again", () => {
    // Sets 1, 2, 3, 4 with 2 deleted: the count says 4, which already exists.
    expect(nextSetIndex([{ setIndex: 1 }, { setIndex: 3 }, { setIndex: 4 }])).toBe(5);
  });

  it("falls back to position for a set with no stored index", () => {
    expect(nextSetIndex([{}, {}])).toBe(3);
    expect(nextSetIndex([])).toBe(1);
  });
});

describe("a suggestion the coach's switch let through (Order 28)", () => {
  const suggestion = { loadKg: 175, reps: 5, fromRpe: 7, fromLoadKg: 170 };
  let n = 0;
  const id = () => `id-${++n}`;

  // The row the athlete asks for with Add set once the last one is confirmed.
  const added = (s: typeof suggestion | null) => addRow([], "squat", { loadKg: 170, reps: 5 }, id, s)[0];

  it("fills the Add set row after the last confirm, marked as a suggestion", () => {
    expect(added(suggestion)).toMatchObject({ loadKg: 175, reps: 5, note: "suggested from RPE 7 @ 170" });
  });

  it("flags the row as suggested, so the logger can mark it until it is edited", () => {
    expect(added(suggestion).suggested).toBe(true);
  });

  it("does not flag a repeat of the previous set", () => {
    expect(added(null).suggested ?? false).toBe(false);
  });

  it("repeats the set just logged when none was let through, with no note", () => {
    expect(added(null)).toMatchObject({ loadKg: 170, reps: 5 });
    expect(added(null).note ?? null).toBeNull();
  });

  it("never overwrites a row the athlete already planned, or prices the row behind it", () => {
    // The suggestion was priced from the last logged set; the new row follows
    // the athlete's planned 150 x 8, not that set, so it repeats their numbers.
    const planned = { ...rowAfter("squat", null, id, true), loadKg: 150, reps: 8 };
    const next = addRow([planned], "squat", { loadKg: 170, reps: 5 }, id, suggestion);
    expect(next[0]).toEqual(planned);
    expect(next[1]).toMatchObject({ loadKg: 150, reps: 8 });
    expect(next[1].suggested ?? false).toBe(false);
    expect(next[1].note ?? null).toBeNull();
  });

  it("is never applied by a confirm, which builds no row to hold it", () => {
    const rows = [rowAfter("squat", null, id)];
    expect(afterConfirm(rows, rows[0].clientSetId).next).toBeNull();
  });
});
