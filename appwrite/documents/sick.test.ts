import { SICK_MAX_DAYS, SICK_NOTE_MAX, inclusiveDays, isDayKey, normaliseSickNote, sickRangeProblem } from "./sick";

describe("isDayKey", () => {
  it.each(["2026-11-27", "2026-02-28", "2028-02-29", "2026-12-31"])("accepts the real day %s", (day) => {
    expect(isDayKey(day)).toBe(true);
  });

  it.each([
    "2026-13-45", // the shape is right and `new Date` would roll it into February 2027
    "2026-02-29", // 2026 is not a leap year
    "2026-11-31",
    "2026-1-5",
    "2026-11-27T00:00:00Z",
    "27/11/2026",
    "",
    " 2026-11-27",
  ])("refuses %s", (day) => {
    expect(isDayKey(day)).toBe(false);
  });

  it("refuses what is not a string", () => {
    for (const value of [null, undefined, 20261127, new Date("2026-11-27"), {}]) expect(isDayKey(value)).toBe(false);
  });
});

describe("inclusiveDays", () => {
  it("counts both ends, across a month, a year and a clock change", () => {
    expect(inclusiveDays("2026-11-27", "2026-11-27")).toBe(1);
    expect(inclusiveDays("2026-11-27", "2026-11-29")).toBe(3);
    expect(inclusiveDays("2026-11-28", "2026-12-02")).toBe(5);
    expect(inclusiveDays("2026-12-30", "2027-01-02")).toBe(4);
    // Europe/London springs forward on 29 Mar 2026: a day is a day, not 24 hours.
    expect(inclusiveDays("2026-03-28", "2026-03-30")).toBe(3);
  });
});

describe("sickRangeProblem", () => {
  it("is null for one day, a week and the longest allowed", () => {
    expect(sickRangeProblem("2026-11-27", "2026-11-27")).toBeNull();
    expect(sickRangeProblem("2026-11-27", "2026-12-03")).toBeNull();
    expect(sickRangeProblem("2026-11-01", "2026-12-01")).toBeNull();
    expect(inclusiveDays("2026-11-01", "2026-12-01")).toBe(SICK_MAX_DAYS);
  });

  it("refuses one day more than the cap, which is how a year typo is caught", () => {
    expect(sickRangeProblem("2026-11-01", "2026-12-02")).toMatch(/longer than 31 days/);
    expect(sickRangeProblem("2026-11-27", "2062-11-27")).toMatch(/longer than 31 days/);
  });

  it("refuses a range that ends before it starts", () => {
    expect(sickRangeProblem("2026-11-28", "2026-11-27")).toMatch(/before/);
  });

  it("refuses anything that is not two real days, naming what it was given", () => {
    expect(sickRangeProblem("2026-13-45", "2026-11-27")).toMatch(/YYYY-MM-DD/);
    expect(sickRangeProblem("2026-11-27", undefined)).toMatch(/null/);
    expect(sickRangeProblem(null, null)).toMatch(/YYYY-MM-DD/);
  });
});

describe("normaliseSickNote", () => {
  it("flattens whitespace and trims", () => {
    expect(normaliseSickNote("  Flu,\n back   Thursday  ")).toBe("Flu, back Thursday");
  });

  it("is null for nothing, so an empty box stores no note", () => {
    for (const note of [null, undefined, "", "   \n "]) expect(normaliseSickNote(note)).toBeNull();
  });

  it("is cut to the column rather than refused", () => {
    expect(normaliseSickNote("x".repeat(SICK_NOTE_MAX + 50))).toHaveLength(SICK_NOTE_MAX);
  });
});
