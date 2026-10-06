import { copyCalendar, daysBetween, duplicateShift, shiftDay } from "./copy";

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
