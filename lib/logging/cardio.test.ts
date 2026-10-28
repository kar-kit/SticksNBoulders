import { describe, expect, it } from "vitest";
import {
  canCompleteCardio,
  cardioColumns,
  cardioLine,
  cardioSeconds,
  formatCardioTotal,
  formatDuration,
  isCardioSet,
  isLoggableDuration,
  isLoggableLevel,
  isStrengthSet,
  MAX_DURATION_SECONDS,
  spokenCardioLine,
} from "./cardio";

describe("isCardioSet", () => {
  it("is a set with a duration, a level, or both", () => {
    expect(isCardioSet({ durationSeconds: 1200, level: 8 })).toBe(true);
    expect(isCardioSet({ durationSeconds: 1200, level: null })).toBe(true);
    expect(isCardioSet({ durationSeconds: 1200 })).toBe(true);
    // A stray level alone still keeps a set out of strength totals.
    expect(isCardioSet({ level: 8 })).toBe(true);
  });

  it("is never a strength set, including every set from before v21", () => {
    expect(isCardioSet({})).toBe(false);
    expect(isCardioSet({ durationSeconds: null, level: null })).toBe(false);
    expect(isCardioSet({ durationSeconds: undefined, level: undefined })).toBe(false);
  });

  it("counts any value at all, valid or not: the question is whether to trust it in a tonnage", () => {
    expect(isCardioSet({ durationSeconds: 0 })).toBe(true);
    expect(isCardioSet({ durationSeconds: Number.NaN })).toBe(true);
    expect(isCardioSet({ level: -1 })).toBe(true);
  });
});

describe("isStrengthSet, the door to every strength total", () => {
  it("lets a strength set in, made or missed", () => {
    expect(isStrengthSet({ reps: 5 })).toBe(true);
    expect(isStrengthSet({ reps: 0, failed: true })).toBe(true);
    expect(isStrengthSet({ reps: 12, durationSeconds: null, level: null })).toBe(true);
  });

  it("keeps a cardio set out, whatever its strength columns hold", () => {
    expect(isStrengthSet({ reps: 0, durationSeconds: 1200, level: 8 })).toBe(false);
    expect(isStrengthSet({ reps: 5, durationSeconds: 1200 })).toBe(false);
    expect(isStrengthSet({ reps: 5, level: 3 })).toBe(false);
  });

  it("fails closed on a 0-rep set that is not a miss: a cardio set read without its columns", () => {
    // What an old cache or a select that forgot the columns hands over.
    expect(isStrengthSet({ reps: 0 })).toBe(false);
    expect(isStrengthSet({ reps: 0, failed: false })).toBe(false);
    expect(isStrengthSet({ reps: 0, failed: null })).toBe(false);
  });
});

describe("what a cardio row needs to log", () => {
  it("is a whole-second duration of 1 second to 24 hours", () => {
    expect(isLoggableDuration(1)).toBe(true);
    expect(isLoggableDuration(1200)).toBe(true);
    expect(isLoggableDuration(MAX_DURATION_SECONDS)).toBe(true);
    for (const bad of [0, -60, 1.5, MAX_DURATION_SECONDS + 1, Number.NaN, null, undefined]) {
      expect(isLoggableDuration(bad)).toBe(false);
    }
  });

  it("takes no level, or one from 0 to 99.9", () => {
    for (const ok of [null, undefined, 0, 8, 2.5, 99.9]) expect(isLoggableLevel(ok)).toBe(true);
    for (const bad of [-1, 100, Number.NaN, Number.POSITIVE_INFINITY]) expect(isLoggableLevel(bad)).toBe(false);
  });

  it("needs the duration above zero and the level optional", () => {
    expect(canCompleteCardio({ durationSeconds: 1200, level: 8 })).toBe(true);
    expect(canCompleteCardio({ durationSeconds: 1200, level: null })).toBe(true);
    expect(canCompleteCardio({ durationSeconds: 0, level: 8 })).toBe(false);
    expect(canCompleteCardio({ durationSeconds: null, level: 8 })).toBe(false);
    expect(canCompleteCardio({ durationSeconds: 1200, level: 150 })).toBe(false);
  });
});

describe("reading a cardio set", () => {
  it("says whole minutes as minutes and keeps seconds as a clock", () => {
    expect(formatDuration(1200)).toBe("20 min");
    expect(formatDuration(1230)).toBe("20:30");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(5400)).toBe("90 min");
  });

  it("puts duration and level on one line, the level only when there is one", () => {
    expect(cardioLine({ durationSeconds: 1200, level: 8 })).toBe("20 min · level 8");
    expect(cardioLine({ durationSeconds: 1230, level: 2.5 })).toBe("20:30 · level 2.5");
    expect(cardioLine({ durationSeconds: 900, level: null })).toBe("15 min");
    expect(spokenCardioLine({ durationSeconds: 1230, level: 8 })).toBe("20 minutes 30 seconds, level 8");
  });

  it("totals the time of cardio sets only, and rounds a stat to the minute", () => {
    expect(cardioSeconds([{ durationSeconds: 1200 }, { durationSeconds: 630, level: 8 }, {}])).toBe(1830);
    expect(formatCardioTotal(1830)).toBe("31 min");
    expect(formatCardioTotal(20)).toBe("1 min");
    expect(formatCardioTotal(0)).toBe("0 min");
  });
});

describe("cardioColumns", () => {
  it("reads the two columns off a row only when it has them", () => {
    expect(cardioColumns({ duration_seconds: 1200, level: 8 })).toEqual({ durationSeconds: 1200, level: 8 });
    expect(cardioColumns({ duration_seconds: 1200, level: null })).toEqual({ durationSeconds: 1200, level: null });
    // A strength row, before or after v21: no keys at all.
    expect(cardioColumns({ load_kg: 100 })).toEqual({});
    expect(cardioColumns({ duration_seconds: null, level: null })).toEqual({});
    expect(cardioColumns({ duration_seconds: "20" })).toEqual({});
  });
});
