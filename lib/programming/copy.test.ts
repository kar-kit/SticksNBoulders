import { copyCalendar, copyWeekPlan, daysBetween, duplicateShift, shiftDay } from "./copy";
import { programOp, type WeekTree } from "./program";

describe("daysBetween and shiftDay", () => {
  it("counts whole calendar days, across a month and a clock change", () => {
    expect(daysBetween("2026-10-05", "2026-10-12")).toBe(7);
    expect(daysBetween("2026-10-20", "2026-11-03")).toBe(14); // BST ends 25 Oct
    expect(daysBetween("2026-10-12", "2026-10-05")).toBe(-7);
  });

  it("moves a dated day and leaves an undated one alone", () => {
    expect(shiftDay("2026-10-29", 7)).toBe("2026-11-05");
    expect(shiftDay(null, 7)).toBeNull();
  });
});

describe("duplicateShift", () => {
  it("is a week when the last week is duplicated", () => {
    expect(duplicateShift(["w1", "w2", "w3"], "w3")).toBe(7);
  });

  it("lands an earlier week's copy after the last week, not on top of the next one", () => {
    expect(duplicateShift(["w1", "w2", "w3", "w4"], "w1")).toBe(28);
  });

  it("refuses a week that is not in the block", () => {
    expect(() => duplicateShift(["w1"], "w9")).toThrow();
  });
});

describe("copyCalendar", () => {
  const days = ["2026-10-06", "2026-10-08", null, "2026-10-13"];

  it("keeps the source's dates when no start is asked for", () => {
    expect(copyCalendar({ wholeProgram: true, sourceStartOn: "2026-10-05", days, startOn: undefined })).toEqual({
      startOn: "2026-10-05",
      shift: 0,
    });
  });

  it("moves a whole program by its start date, keeping a Tuesday-first offset", () => {
    expect(copyCalendar({ wholeProgram: true, sourceStartOn: "2026-10-05", days, startOn: "2026-11-02" })).toEqual({
      startOn: "2026-11-02",
      shift: 28,
    });
  });

  it("anchors a single block on its own first day, not the program's start", () => {
    expect(copyCalendar({ wholeProgram: false, sourceStartOn: "2026-09-01", days, startOn: "2026-11-03" })).toEqual({
      startOn: "2026-11-03",
      shift: 28,
    });
  });

  it("falls back to the first dated day when the program has no start", () => {
    expect(copyCalendar({ wholeProgram: true, sourceStartOn: null, days, startOn: "2026-10-13" }).shift).toBe(7);
  });

  it("dates an undated source by its start only, moving nothing", () => {
    expect(copyCalendar({ wholeProgram: true, sourceStartOn: null, days: [null], startOn: "2026-11-02" })).toEqual({
      startOn: "2026-11-02",
      shift: 0,
    });
  });
});

describe("copying a week into a new block (+ Block)", () => {
  const source: WeekTree = {
    id: "w4",
    programId: "p1",
    blockId: "b1",
    position: 3,
    label: "Heavy",
    status: "published",
    notes: "deload if sore",
    days: [
      {
        id: "d1",
        programId: "p1",
        blockId: "b1",
        weekId: "w4",
        position: 0,
        label: "Squat day",
        scheduledOn: "2026-10-26",
        notes: "belt on",
        prescriptions: [
          {
            id: "l1",
            programId: "p1",
            weekId: "w4",
            dayId: "d1",
            exerciseId: "tempo-squat",
            position: 0,
            setCount: 3,
            reps: 5,
            repMax: 6,
            load: "70%",
            loadKind: "percent",
            restSeconds: 180,
            notes: "3s down",
            backoff: "3 x 90%",
            videoRequired: true,
            referenceExerciseId: "squat",
            updatedAt: "",
          },
          {
            id: "l2",
            programId: "p1",
            weekId: "w4",
            dayId: "d1",
            exerciseId: "bench",
            position: 1,
            setCount: 1,
            reps: null,
            repMax: null,
            load: null,
            loadKind: null,
            restSeconds: null,
            notes: null,
            updatedAt: "",
          },
        ],
      },
      { id: "d2", programId: "p1", blockId: "b1", weekId: "w4", position: 1, label: null, scheduledOn: null, notes: null, prescriptions: [] },
    ],
  };

  it("carries every day and every typed field of every line, in order, moved by the shift", () => {
    expect(copyWeekPlan(source, 7)).toEqual([
      {
        day: { label: "Squat day", scheduledOn: "2026-11-02", notes: "belt on" },
        lines: [
          {
            exerciseId: "tempo-squat",
            setCount: 3,
            reps: 5,
            repMax: 6,
            load: "70%",
            restSeconds: 180,
            notes: "3s down",
            backoff: "3 x 90%",
            videoRequired: true,
            referenceExerciseId: "squat",
          },
          {
            exerciseId: "bench",
            setCount: 1,
            reps: null,
            repMax: null,
            load: null,
            restSeconds: null,
            notes: null,
            backoff: null,
            videoRequired: false,
            referenceExerciseId: null,
          },
        ],
      },
      { day: { label: null, scheduledOn: null, notes: null }, lines: [] },
    ]);
  });

  it("writes ops the server's own schema accepts", () => {
    for (const { day, lines } of copyWeekPlan(source, 7)) {
      expect(programOp.safeParse({ op: "addDay", weekId: "w9", ...day }).success).toBe(true);
      for (const line of lines) {
        expect(programOp.safeParse({ op: "addPrescription", dayId: "d9", ...line }).success).toBe(true);
      }
    }
  });
});
