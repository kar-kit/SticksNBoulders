import { describe, expect, it } from "vitest";
import {
  addRow,
  afterConfirm,
  discardRow,
  focusExercise,
  headOf,
  materialiseRows,
  nextSetIndex,
  plannedIndex,
  rowAfter,
  refreshBehind,
  rowsOf,
  swapRows,
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

describe("laying out a prescribed exercise at once (F5)", () => {
  const W = { isWarmup: true };
  const S = { isWarmup: false };

  it("makes blank warm-ups and working rows that repeat the last set, in the shape given", () => {
    const rows = materialiseRows("squat", [W, W, S, S], { loadKg: 140, reps: 5 }, ids());
    expect(rows.map((r) => r.clientSetId)).toEqual(["st-1", "st-2", "st-3", "st-4"]);
    expect(rows[0]).toMatchObject({ isWarmup: true, loadKg: null, reps: null, rpe: null, planned: true });
    expect(rows[2]).toMatchObject({ isWarmup: false, loadKg: 140, reps: 5, rpe: null, planned: true });
  });

  it("starts working rows empty when nothing has been logged", () => {
    const [row] = materialiseRows("squat", [S], null, ids());
    expect(row).toMatchObject({ loadKg: null, reps: null, planned: true });
  });

  it("lays the whole shape out when the exercise is opened with no rows, the first being the head", () => {
    const other = row({ exerciseId: "bench", clientSetId: "b1", planned: true });
    const { rows, head } = focusExercise([other], "squat", null, ids(), [W, S, S]);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toBe(other);
    expect(head.clientSetId).toBe("st-1");
    expect(rowsOf(rows, "squat").map((r) => r.isWarmup)).toEqual([true, false, false]);
  });

  it("keeps rows already there rather than laying out a second copy", () => {
    const mine = row({ clientSetId: "keep", planned: true });
    const { rows, head } = focusExercise([mine], "squat", null, ids(), [W, S, S]);
    expect(rows).toEqual([mine]);
    expect(head).toBe(mine);
  });

  it("falls back to one fresh row once the shape is empty (prescription done)", () => {
    const { rows } = focusExercise([], "squat", { loadKg: 150, reps: 3 }, ids(), []);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ loadKg: 150, reps: 3, planned: false });
  });

  it("survives moving to another exercise, because every laid-out row is planned", () => {
    const laid = focusExercise([], "squat", null, ids(), [W, S]).rows;
    const moved = focusExercise(laid, "bench", null, ids()).rows;
    expect(rowsOf(moved, "squat")).toHaveLength(2);
  });

  it("numbers the laid-out rows W, W, 1, 2 after nothing logged", () => {
    const laid = focusExercise([], "squat", null, ids(), [W, W, S, S]).rows;
    expect(laid.map((_, at) => plannedIndex(0, laid, at))).toEqual(["W", "W", 1, 2]);
  });
});

describe("swapRows (F5 variant swap)", () => {
  it("moves the block's rows to the new exercise as fresh rows of the same shape", () => {
    const rows = [
      row({ clientSetId: "w", isWarmup: true, loadKg: 60, planned: true }),
      row({ clientSetId: "a", loadKg: 100, prescriptionId: "l1", prescribed: "5 reps", videoRequired: true, planned: true }),
      row({ exerciseId: "bench", clientSetId: "b", planned: true }),
    ];
    const out = swapRows(rows, "squat", "front", { loadKg: 80, reps: 5 }, ids());
    expect(out[0]).toMatchObject({ exerciseId: "front", clientSetId: "st-1", isWarmup: true, loadKg: null });
    // The old implement's numbers and the old prescription stamp do not carry:
    // the prescription prices the new row again.
    expect(out[1]).toMatchObject({ exerciseId: "front", clientSetId: "st-2", loadKg: 80, reps: 5, planned: true });
    expect(out[1]).not.toHaveProperty("prescriptionId");
    expect(out[1]).not.toHaveProperty("videoRequired");
    expect(out[2]).toBe(rows[2]);
  });

  it("is a no-op swapping to the exercise already in hand", () => {
    const rows = [row({ clientSetId: "a" })];
    expect(swapRows(rows, "squat", "squat", null, ids())).toEqual(rows);
  });

  it("keeps an automatic row automatic", () => {
    const [out] = swapRows([row({ clientSetId: "a", planned: false })], "squat", "front", null, ids());
    expect(out.planned).toBe(false);
  });
});

describe("refreshBehind (F5)", () => {
  const logged = { exerciseId: "squat", loadKg: 170, reps: 5, isWarmup: false };

  it("resets untouched working rows of the exercise to the set just logged, and names them to price", () => {
    const rows = [
      row({ clientSetId: "a", loadKg: null, reps: 5, note: "x", suggested: true }),
      row({ clientSetId: "w", isWarmup: true, loadKg: null, reps: null }),
      row({ clientSetId: "t", loadKg: 160, touched: true }),
      row({ exerciseId: "bench", clientSetId: "b", loadKg: null }),
    ];
    const out = refreshBehind(rows, logged);
    expect([...out.reprice]).toEqual(["a"]);
    expect(out.rows[0]).toMatchObject({ loadKg: 170, reps: 5, note: null, suggested: false, clientSetId: "a" });
    expect(out.rows[1]).toBe(rows[1]);
    expect(out.rows[2]).toBe(rows[2]);
    expect(out.rows[3]).toBe(rows[3]);
  });

  it("changes nothing after a warm-up", () => {
    const rows = [row({ clientSetId: "a", loadKg: null })];
    const out = refreshBehind(rows, { ...logged, isWarmup: true });
    expect(out.reprice.size).toBe(0);
    expect(out.rows).toEqual(rows);
  });
});

describe("refreshBehind after a failed set (F19)", () => {
  it("leaves the rows behind alone, as after a warm-up: a miss is not the set to repeat", () => {
    const rows = [row({ clientSetId: "a", loadKg: null, reps: 5 })];
    const out = refreshBehind(rows, { exerciseId: "squat", loadKg: 200, reps: 0, isWarmup: false, failed: true });
    expect(out.reprice.size).toBe(0);
    expect(out.rows[0]).toBe(rows[0]);
  });
});
