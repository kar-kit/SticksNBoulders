import {
  blockRange,
  mondayOf,
  newDayDate,
  placeDay,
  programAnchor,
  rangeLabel,
  redatePlan,
  scheduledOnFor,
  weekdayOf,
  weekIndexOf,
} from "./calendar";
import type { ProgramTree } from "./program";

/** Two blocks; `weeks` is the dates of each week's days, block by block. */
const tree = (over: Partial<ProgramTree> = {}, weeks: Array<string | null>[][] = [[[], []], [[]]]): ProgramTree => ({
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
  blocks: weeks.map((block, b) => ({
    id: `b${b + 1}`,
    programId: "p1",
    position: b,
    name: `Block ${b + 1}`,
    notes: null,
    weeks: block.map((dates, w) => ({
      id: `w${b + 1}${w + 1}`,
      programId: "p1",
      blockId: `b${b + 1}`,
      position: w,
      label: null,
      status: "draft" as const,
      notes: null,
      days: dates.map((scheduledOn, d) => ({
        id: `d${b + 1}${w + 1}${d + 1}`,
        programId: "p1",
        blockId: `b${b + 1}`,
        weekId: `w${b + 1}${w + 1}`,
        position: d,
        label: null,
        scheduledOn,
        notes: null,
        prescriptions: [],
      })),
    })),
  })),
  ...over,
});

describe("weekdays", () => {
  it("counts Monday as 0 and Sunday as 6, on the calendar day and not the instant", () => {
    expect(weekdayOf("2026-10-05")).toBe(0);
    expect(weekdayOf("2026-10-07")).toBe(2);
    expect(weekdayOf("2026-10-11")).toBe(6);
  });

  it("finds the Monday of a day's week, across a month", () => {
    expect(mondayOf("2026-10-05")).toBe("2026-10-05");
    expect(mondayOf("2026-10-11")).toBe("2026-10-05");
    expect(mondayOf("2026-10-01")).toBe("2026-09-28");
  });
});

describe("the anchor every date counts from", () => {
  it("is the start date's Monday", () => {
    expect(programAnchor(tree({ startOn: "2026-10-07" }))).toBe("2026-10-05");
  });

  it("with no start date, counts back from the first dated day to week 1, across blocks", () => {
    expect(programAnchor(tree({}, [[[], []], [["2026-10-21"]]]))).toBe("2026-10-05");
  });

  it("is null for a template and for a program with nothing to count from", () => {
    expect(programAnchor(tree({ athleteId: null, startOn: "2026-10-05" }))).toBeNull();
    expect(programAnchor(tree())).toBeNull();
  });

  it("numbers weeks across blocks", () => {
    expect(weekIndexOf(tree(), "w21")).toBe(2);
    expect(weekIndexOf(tree(), "nope")).toBe(-1);
  });
});

describe("a weekday chip's date", () => {
  it("is the anchor, plus whole weeks, plus the weekday", () => {
    expect(scheduledOnFor("2026-10-05", 0, 0)).toBe("2026-10-05");
    expect(scheduledOnFor("2026-10-05", 2, 3)).toBe("2026-10-22");
    expect(scheduledOnFor("2026-10-05", 3, 6)).toBe("2026-11-01");
  });

  it("places a stored date in its week, outside it, or nowhere", () => {
    expect(placeDay("2026-10-05", 1, "2026-10-14")).toEqual({ kind: "on", weekday: 2 });
    expect(placeDay("2026-10-05", 1, "2026-10-12")).toEqual({ kind: "on", weekday: 0 });
    expect(placeDay("2026-10-05", 1, "2026-10-18")).toEqual({ kind: "on", weekday: 6 });
    expect(placeDay("2026-10-05", 1, "2026-10-19")).toEqual({ kind: "off", weekday: 0 });
    expect(placeDay("2026-10-05", 1, "2026-10-11")).toEqual({ kind: "off", weekday: 6 });
    expect(placeDay("2026-10-05", 1, null)).toEqual({ kind: "undated" });
  });
});

describe("dating a new day", () => {
  it("takes the next free weekday after the week's last one", () => {
    expect(newDayDate(tree({}, [[["2026-10-05", "2026-10-07"], []]]), "w11")).toBe("2026-10-08");
  });

  it("wraps to the first free weekday when the last one used is Sunday", () => {
    expect(newDayDate(tree({}, [[["2026-10-06", "2026-10-11"]]]), "w11")).toBe("2026-10-05");
  });

  it("starts an empty week on the start date's weekday, a week per week", () => {
    expect(newDayDate(tree({ startOn: "2026-10-05" }), "w11")).toBe("2026-10-05");
    expect(newDayDate(tree({ startOn: "2026-10-07" }), "w12")).toBe("2026-10-14");
    expect(newDayDate(tree({ startOn: "2026-10-05" }), "w21")).toBe("2026-10-19");
  });

  it("with no start date, counts from the dated week above and starts on Monday", () => {
    expect(newDayDate(tree({}, [[["2026-10-06", "2026-10-08"], []]]), "w12")).toBe("2026-10-12");
  });

  it("ignores a day dated outside its week when picking the next weekday", () => {
    expect(newDayDate(tree({ startOn: "2026-10-05" }, [[["2026-10-30"]]]), "w11")).toBe("2026-10-05");
  });

  it("gives a template, a program with nothing to count from, or a full week no date", () => {
    expect(newDayDate(tree({ athleteId: null, startOn: "2026-10-05" }), "w11")).toBeNull();
    expect(newDayDate(tree(), "w11")).toBeNull();
    expect(newDayDate(tree({ startOn: "2026-10-05" }), "nope")).toBeNull();
    const full = ["05", "06", "07", "08", "09", "10", "11"].map((d) => `2026-10-${d}`);
    expect(newDayDate(tree({ startOn: "2026-10-05" }, [[full]]), "w11")).toBeNull();
  });
});

describe("a block's dates", () => {
  it("runs from its first week's Monday to its last week's Sunday", () => {
    const t = tree({ startOn: "2026-10-05" });
    expect(blockRange(t, "b1")).toEqual({ from: "2026-10-05", to: "2026-10-18" });
    expect(blockRange(t, "b2")).toEqual({ from: "2026-10-19", to: "2026-10-25" });
  });

  it("has none without an anchor or without weeks", () => {
    expect(blockRange(tree(), "b1")).toBeNull();
    expect(blockRange(tree({ startOn: "2026-10-05" }, [[[]], []]), "b2")).toBeNull();
  });

  it("reads as a short range, naming the month once when it does not change", () => {
    expect(rangeLabel({ from: "2026-10-05", to: "2026-10-11" })).toBe("5–11 Oct");
    expect(rangeLabel({ from: "2026-09-28", to: "2026-10-04" })).toBe("28 Sept – 4 Oct");
  });
});

describe("moving the start date", () => {
  const dated = () => tree({ startOn: "2026-10-05" }, [[["2026-10-05", "2026-10-07"], ["2026-10-30"]], [["2026-10-21"]]]);

  it("moves every day in its week by the same whole weeks, keeping its weekday", () => {
    expect(redatePlan(dated(), "2026-10-12", new Set())).toEqual([
      { dayId: "d111", scheduledOn: "2026-10-12" },
      { dayId: "d112", scheduledOn: "2026-10-14" },
      { dayId: "d211", scheduledOn: "2026-10-28" },
    ]);
  });

  it("never moves a day an athlete has logged from, nor one dated outside its week", () => {
    const plan = redatePlan(dated(), "2026-10-12", new Set(["d111"]));
    expect(plan.map((p) => p.dayId)).toEqual(["d112", "d211"]);
    expect(plan.some((p) => p.dayId === "d121")).toBe(false);
  });

  it("moves backwards as well as forwards, by the Monday and not the exact day", () => {
    expect(redatePlan(dated(), "2026-10-01", new Set())[0]).toEqual({ dayId: "d111", scheduledOn: "2026-09-28" });
  });

  it("moves nothing when the week does not change, the date is cleared, or it is a template", () => {
    expect(redatePlan(dated(), "2026-10-09", new Set())).toEqual([]);
    expect(redatePlan(dated(), null, new Set())).toEqual([]);
    expect(redatePlan({ ...dated(), athleteId: null }, "2026-10-12", new Set())).toEqual([]);
  });

  it("with no start date before, counts from the anchor the dated days imply", () => {
    const t = tree({}, [[["2026-10-06"]]]);
    expect(redatePlan(t, "2026-10-19", new Set())).toEqual([{ dayId: "d111", scheduledOn: "2026-10-20" }]);
  });
});
