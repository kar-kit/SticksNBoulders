import {
  applyLineOp,
  cellText,
  commitCell,
  describeLoad,
  draftWeeks,
  moveCell,
  parseRepsCell,
  parseRestCell,
  parseSetsCell,
  suggestDayDate,
} from "./editor";
import type { Prescription, ProgramTree } from "./program";

const line = (over: Partial<Prescription> = {}): Prescription => ({
  id: "l1",
  programId: "p1",
  weekId: "w1",
  dayId: "d1",
  exerciseId: "squat",
  position: 0,
  setCount: 3,
  reps: 5,
  repMax: null,
  load: "75%",
  loadKind: "percent",
  restSeconds: 180,
  notes: null,
  updatedAt: "2026-10-01T00:00:00Z",
  ...over,
});

describe("the load cell's indicator", () => {
  it.each([
    ["142.5", "fixed", "Fixed · 142.5 kg"],
    ["75%", "percent", "Percent · 75% of training max"],
    ["80% of tested", "percent", "Percent · 80% of tested max"],
    ["@8", "rpe", "RPE 8 · athlete picks the weight"],
    ["75% @8", "capped", "Capped · 75% of training max, stop at RPE 8"],
    ["work up to a heavy single", "freeform", "Freeform · shown as written"],
  ])("says %s landed as %s", (text, kind, label) => {
    expect(describeLoad(text)).toEqual({ kind, label });
  });

  it("names the two typos that look fine: a bare 8 is 8 kg, and 75%% is freeform", () => {
    expect(describeLoad("8").label).toBe("Fixed · 8 kg");
    expect(describeLoad("75%%").kind).toBe("freeform");
  });

  it("says when there is no load at all", () => {
    expect(describeLoad("")).toEqual({ kind: null, label: "No load" });
    expect(describeLoad(null)).toEqual({ kind: null, label: "No load" });
  });
});

describe("reading typed cells", () => {
  it("takes sets as a whole number from 1 to 50", () => {
    expect(parseSetsCell(" 4 ")).toEqual({ ok: true, value: 4 });
    for (const bad of ["0", "51", "3.5", "x", ""]) expect(parseSetsCell(bad).ok).toBe(false);
  });

  it("takes reps as a count, a range either dash, or nothing", () => {
    expect(parseRepsCell("5")).toEqual({ ok: true, value: { reps: 5, repMax: null } });
    expect(parseRepsCell("8-10")).toEqual({ ok: true, value: { reps: 8, repMax: 10 } });
    expect(parseRepsCell("8 – 10")).toEqual({ ok: true, value: { reps: 8, repMax: 10 } });
    expect(parseRepsCell("5-5")).toEqual({ ok: true, value: { reps: 5, repMax: null } });
    expect(parseRepsCell("")).toEqual({ ok: true, value: { reps: null, repMax: null } });
  });

  it("refuses a range that runs downwards, rather than guessing which number was meant", () => {
    expect(parseRepsCell("10-8").ok).toBe(false);
    expect(parseRepsCell("0").ok).toBe(false);
  });

  it("takes rest as seconds, minutes or a clock", () => {
    expect(parseRestCell("90")).toEqual({ ok: true, value: 90 });
    expect(parseRestCell("90s")).toEqual({ ok: true, value: 90 });
    expect(parseRestCell("3m")).toEqual({ ok: true, value: 180 });
    expect(parseRestCell("2:30")).toEqual({ ok: true, value: 150 });
    expect(parseRestCell("")).toEqual({ ok: true, value: null });
    expect(parseRestCell("2 hours").ok).toBe(false);
    expect(parseRestCell("61m").ok).toBe(false);
  });
});

describe("committing a cell", () => {
  it("sends only the field that changed", () => {
    expect(commitCell(line(), "load", "75% @8")).toEqual({
      op: { op: "updatePrescription", prescriptionId: "l1", load: "75% @8" },
    });
    expect(commitCell(line(), "reps", "8-10")).toEqual({
      op: { op: "updatePrescription", prescriptionId: "l1", reps: 8, repMax: 10 },
    });
    expect(commitCell(line(), "rest", "2:00")).toEqual({
      op: { op: "updatePrescription", prescriptionId: "l1", restSeconds: 120 },
    });
  });

  it("writes nothing when the text did not change, so tabbing through a row is free", () => {
    for (const column of ["sets", "reps", "load", "rest", "notes"] as const) {
      expect(commitCell(line(), column, cellText(line(), column))).toEqual({ unchanged: true });
    }
  });

  it("answers a bad cell with the reason, not a write", () => {
    expect(commitCell(line(), "sets", "0")).toEqual({ error: "Sets is a whole number, 1 to 50" });
  });

  it("clears the load to nothing when emptied", () => {
    const result = commitCell(line(), "load", "");
    expect(result).toEqual({ op: { op: "updatePrescription", prescriptionId: "l1", load: "" } });
    if ("op" in result) expect(applyLineOp(line(), result.op)).toMatchObject({ load: null, loadKind: null });
  });

  it("toggles video required with a one-field write, and shows it before the server answers", () => {
    expect(cellText(line(), "video")).toBe("No");
    expect(cellText(line({ videoRequired: true }), "video")).toBe("Yes");
    const on = commitCell(line(), "video", "Yes");
    expect(on).toEqual({ op: { op: "updatePrescription", prescriptionId: "l1", videoRequired: true } });
    if ("op" in on) expect(applyLineOp(line(), on.op)).toMatchObject({ videoRequired: true, load: "75%" });
    const off = commitCell(line({ videoRequired: true }), "video", "No");
    expect(off).toEqual({ op: { op: "updatePrescription", prescriptionId: "l1", videoRequired: false } });
    expect(commitCell(line(), "video", "No")).toEqual({ unchanged: true });
  });

  it("shows the saved line before the server answers, with its kind re-derived", () => {
    const after = applyLineOp(line(), { op: "updatePrescription", prescriptionId: "l1", load: "@8", setCount: 1 });
    expect(after).toMatchObject({ load: "@8", loadKind: "rpe", setCount: 1, reps: 5, restSeconds: 180 });
    expect(applyLineOp(line(), { op: "updatePrescription", prescriptionId: "other", setCount: 9 })).toEqual(line());
  });
});

describe("moving around the grid", () => {
  const size = { rows: 3, cols: 6 };

  it("moves rows with up, down and Enter, stopping at the edges", () => {
    expect(moveCell({ row: 1, col: 2 }, "ArrowUp", size)).toEqual({ row: 0, col: 2 });
    expect(moveCell({ row: 1, col: 2 }, "ArrowDown", size)).toEqual({ row: 2, col: 2 });
    expect(moveCell({ row: 1, col: 2 }, "Enter", size)).toEqual({ row: 2, col: 2 });
    expect(moveCell({ row: 0, col: 2 }, "ArrowUp", size)).toBeNull();
    expect(moveCell({ row: 2, col: 2 }, "Enter", size)).toBeNull();
  });

  it("leaves a cell sideways only from its edge, so the caret still works inside 75% @8", () => {
    expect(moveCell({ row: 0, col: 3 }, "ArrowLeft", size, { atStart: false, atEnd: false })).toBeNull();
    expect(moveCell({ row: 0, col: 3 }, "ArrowLeft", size, { atStart: true, atEnd: false })).toEqual({ row: 0, col: 2 });
    expect(moveCell({ row: 0, col: 3 }, "ArrowRight", size, { atStart: false, atEnd: true })).toEqual({ row: 0, col: 4 });
    expect(moveCell({ row: 0, col: 5 }, "ArrowRight", size)).toBeNull();
  });

  it("leaves Tab and typing to the browser", () => {
    expect(moveCell({ row: 0, col: 0 }, "Tab", size)).toBeNull();
    expect(moveCell({ row: 0, col: 0 }, "a", size)).toBeNull();
  });
});

describe("dating a new day", () => {
  const tree = (over: Partial<ProgramTree> = {}, days: Array<string | null>[] = [[], []]): ProgramTree => ({
    id: "p1",
    coachId: "c",
    athleteId: "a",
    name: "Block",
    status: "draft",
    startOn: null,
    notes: null,
    templateId: null,
    createdAt: "",
    updatedAt: "",
    blocks: [
      {
        id: "b1",
        programId: "p1",
        position: 0,
        name: "Volume",
        notes: null,
        weeks: days.map((dates, w) => ({
          id: `w${w + 1}`,
          programId: "p1",
          blockId: "b1",
          position: w,
          label: null,
          status: "draft" as const,
          notes: null,
          days: dates.map((scheduledOn, d) => ({
            id: `d${w}${d}`,
            programId: "p1",
            blockId: "b1",
            weekId: `w${w + 1}`,
            position: d,
            label: null,
            scheduledOn,
            notes: null,
            prescriptions: [],
          })),
        })),
      },
    ],
    ...over,
  });

  it("follows the week's last dated day", () => {
    expect(suggestDayDate(tree({}, [["2026-10-05", "2026-10-07"], []]), "w1")).toBe("2026-10-08");
  });

  it("starts an empty week from the program's start date, a week per week", () => {
    expect(suggestDayDate(tree({ startOn: "2026-10-05" }), "w1")).toBe("2026-10-05");
    expect(suggestDayDate(tree({ startOn: "2026-10-05" }), "w2")).toBe("2026-10-12");
  });

  it("with no start date, counts a week on from the week above", () => {
    expect(suggestDayDate(tree({}, [["2026-10-06", "2026-10-08"], []]), "w2")).toBe("2026-10-13");
  });

  it("gives a template no date, and says nothing when there is nothing to count from", () => {
    expect(suggestDayDate(tree({ athleteId: null, startOn: "2026-10-05" }), "w1")).toBeNull();
    expect(suggestDayDate(tree(), "w1")).toBeNull();
    expect(suggestDayDate(tree(), "nope")).toBeNull();
  });

  it("counts the draft weeks the Publish button is about", () => {
    expect(draftWeeks(tree())).toBe(2);
  });
});
