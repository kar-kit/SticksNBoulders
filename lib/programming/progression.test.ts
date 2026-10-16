import { progressionGrid, slotId } from "./progression";
import type { BlockTree, DayTree, Prescription, WeekTree } from "./program";

const line = (id: string, exerciseId: string, position: number, load: string): Prescription => ({
  id,
  programId: "p1",
  weekId: "w",
  dayId: "d",
  exerciseId,
  position,
  setCount: 3,
  reps: 5,
  repMax: null,
  load,
  loadKind: null,
  restSeconds: null,
  notes: null,
  updatedAt: "",
});
const day = (id: string, position: number, prescriptions: Prescription[], label: string | null = null): DayTree => ({
  id,
  programId: "p1",
  blockId: "b1",
  weekId: "w",
  position,
  label,
  scheduledOn: null,
  notes: null,
  prescriptions,
});
const week = (id: string, position: number, days: DayTree[]): WeekTree => ({
  id,
  programId: "p1",
  blockId: "b1",
  position,
  label: null,
  status: "draft",
  notes: null,
  days,
});
const block = (weeks: WeekTree[]): Pick<BlockTree, "weeks"> => ({ weeks });

/** A squat top set and its backoff, then bench: the shape every week of a block repeats. */
const squatDay = (w: number, backoff: string, extra: Prescription[] = []) =>
  day(`d${w}`, 0, [line(`top${w}`, "squat", 0, "@8"), line(`bo${w}`, "squat", 1, backoff), line(`bp${w}`, "bench", 2, "70%"), ...extra], w === 1 ? "Heavy squat" : null);

describe("the progression grid", () => {
  it("lines the same slot up across the block: the squat backoff is one row, week by week", () => {
    const grid = progressionGrid(block([week("w1", 0, [squatDay(1, "75%")]), week("w2", 1, [squatDay(2, "77.5%")]), week("w3", 2, [squatDay(3, "80%")])]));
    expect(grid.weeks.map((w) => w.id)).toEqual(["w1", "w2", "w3"]);
    expect(grid.days).toHaveLength(1);
    expect(grid.days[0].title).toBe("Heavy squat");
    const [top, backoff, bench] = grid.days[0].rows;
    expect([top.exerciseId, top.occurrence, backoff.exerciseId, backoff.occurrence, bench.exerciseId]).toEqual(["squat", 0, "squat", 1, "bench"]);
    expect(backoff.cells.map((c) => (c.kind === "line" ? c.line.load : c.kind))).toEqual(["75%", "77.5%", "80%"]);
  });

  it("keeps rows in place when a later week inserts a line above them", () => {
    const w3 = day("d3", 0, [
      line("pause", "pause-squat", 0, "@7"),
      line("top3", "squat", 1, "@8"),
      line("bo3", "squat", 2, "80%"),
      line("bp3", "bench", 3, "72.5%"),
    ]);
    const grid = progressionGrid(block([week("w1", 0, [squatDay(1, "75%")]), week("w3", 1, [w3])]));
    const rows = grid.days[0].rows;
    expect(rows.map((r) => r.id)).toEqual([
      slotId({ dayIndex: 0, exerciseId: "squat", occurrence: 0 }),
      slotId({ dayIndex: 0, exerciseId: "squat", occurrence: 1 }),
      slotId({ dayIndex: 0, exerciseId: "bench", occurrence: 0 }),
      // New in week 3, so under the rows week 1 had.
      slotId({ dayIndex: 0, exerciseId: "pause-squat", occurrence: 0 }),
    ]);
    expect(rows[1].cells.map((c) => (c.kind === "line" ? c.line.id : c.kind))).toEqual(["bo1", "bo3"]);
    expect(rows[3].cells.map((c) => c.kind)).toEqual(["empty", "line"]);
  });

  it("offers an empty cell only where an added line would land in that slot", () => {
    // Week 2 has the day but only the top set: a squat added to its end is
    // the second squat line, the backoff slot. Bench is missing too, but an
    // added bench is bench #0, so that is offered as well.
    const w2 = day("d2", 0, [line("top2", "squat", 0, "@8")]);
    const grid = progressionGrid(block([week("w1", 0, [squatDay(1, "75%")]), week("w2", 1, [w2])]));
    const [top, backoff, bench] = grid.days[0].rows;
    expect(top.cells[1].kind).toBe("line");
    expect(backoff.cells[1].kind).toBe("empty");
    expect(bench.cells[1].kind).toBe("empty");
    // Week 2 with no squat at all: an added squat would be the top-set slot,
    // so the backoff slot is a dash, not an input that writes the wrong row.
    const bare = progressionGrid(block([week("w1", 0, [squatDay(1, "75%")]), week("w2", 1, [day("d2", 0, [])])]));
    expect(bare.days[0].rows.map((r) => r.cells[1].kind)).toEqual(["empty", "none", "empty"]);
  });

  it("shows a dash for a week without the day, and groups days by their place in the week", () => {
    const grid = progressionGrid(
      block([
        week("w1", 0, [squatDay(1, "75%"), day("e1", 1, [line("dl1", "deadlift", 0, "@8")], "Pull")]),
        week("w2", 1, [squatDay(2, "77.5%")]),
      ]),
    );
    expect(grid.days.map((d) => d.title)).toEqual(["Heavy squat", "Pull"]);
    expect(grid.days[1].rows[0].cells.map((c) => c.kind)).toEqual(["line", "none"]);
  });

  it("names an unlabelled day by its place, and has no rows for a block with no lines", () => {
    expect(progressionGrid(block([week("w1", 0, [day("d1", 0, [line("a", "squat", 0, "@8")])])])).days[0].title).toBe("Day 1");
    expect(progressionGrid(block([week("w1", 0, [])])).days).toEqual([]);
  });
});
