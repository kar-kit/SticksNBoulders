import { describe, expect, it } from "vitest";
import { deleteBlockedBy, sessionTitle, totalsMatch, totalsOf } from "./session-edit";

const STARTED = new Date(2026, 8, 14, 9, 0); // Monday 14 Sep, local time

describe("sessionTitle", () => {
  it("uses the athlete's own name first", () => {
    expect(sessionTitle({ name: " Heavy singles ", programDayId: "d1", startedAt: STARTED }, "Day 1")).toEqual({
      title: "Heavy singles",
      named: true,
    });
  });

  it("falls back to the program day's label for a prescribed session", () => {
    expect(sessionTitle({ name: null, programDayId: "d1", startedAt: STARTED }, "Heavy squat")).toEqual({
      title: "Heavy squat",
      named: true,
    });
  });

  it("falls back to the date for free logging, or a day with no label", () => {
    expect(sessionTitle({ name: null, programDayId: null, startedAt: STARTED }, "Ignored")).toEqual({
      title: "Monday 14 Sep",
      named: false,
    });
    expect(sessionTitle({ name: "  ", programDayId: "d1", startedAt: STARTED }, null).title).toBe("Monday 14 Sep");
  });
});

describe("totalsOf", () => {
  const set = (loadKg: number, reps: number, isWarmup = false) => ({
    exerciseId: "squat",
    loadKg,
    reps,
    rpe: null,
    isWarmup,
    loggedAt: STARTED,
  });

  it("counts working sets and their tonnage, as finish does", () => {
    expect(totalsOf([set(60, 5, true), set(140, 5), set(150, 3)])).toEqual({ setCount: 2, tonnageKg: 1150 });
  });

  it("is zero for a session emptied of sets", () => {
    expect(totalsOf([])).toEqual({ setCount: 0, tonnageKg: 0 });
  });

  it("knows when the stored totals already agree", () => {
    expect(totalsMatch({ setCount: 2, tonnageKg: 1150 }, { setCount: 2, tonnageKg: 1150 })).toBe(true);
    expect(totalsMatch({ setCount: 2, tonnageKg: 1150 }, { setCount: 1, tonnageKg: 450 })).toBe(false);
  });
});

describe("deleteBlockedBy", () => {
  it("blocks a session the coach has commented on", () => {
    expect(deleteBlockedBy([{ authorId: "joey" }, { authorId: "ruairi" }], "joey")).toMatch(/coach has commented/);
  });

  it("does not count the athlete's own replies", () => {
    expect(deleteBlockedBy([{ authorId: "joey" }], "joey")).toBeNull();
    expect(deleteBlockedBy([], "joey")).toBeNull();
  });
});
