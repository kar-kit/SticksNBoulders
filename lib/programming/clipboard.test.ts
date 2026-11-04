import { act, renderHook } from "@testing-library/react";
import { clearClip, clipSummary, holdClip, newPasteId, readClip, useClip, type ClipItem } from "./clipboard";
import { readProgramOp } from "./program";

const day: ClipItem = {
  kind: "day",
  sourceId: "d1",
  programId: "p1",
  programName: "Autumn",
  athleteId: "joey",
  athleteName: "Joey",
  label: "Squat day",
  days: 1,
  lines: 4,
};

beforeEach(() => {
  window.sessionStorage.clear();
  clearClip();
});

describe("the program clipboard (F28)", () => {
  it("holds one item in sessionStorage, replaced by the next copy and gone once cleared", () => {
    expect(readClip()).toBeNull();
    holdClip(day);
    expect(readClip()).toEqual(day);
    expect(JSON.parse(window.sessionStorage.getItem("snb:program-clipboard")!)).toEqual(day);
    const week = { ...day, kind: "week" as const, sourceId: "w1", label: "Week 1", days: 3, lines: 12 };
    holdClip(week);
    expect(readClip()).toEqual(week);
    clearClip();
    expect(readClip()).toBeNull();
    expect(window.sessionStorage.getItem("snb:program-clipboard")).toBeNull();
  });

  it("treats anything stored that does not parse as nothing", () => {
    window.sessionStorage.setItem("snb:program-clipboard", "{not json");
    expect(readClip()).toBeNull();
    window.sessionStorage.setItem("snb:program-clipboard", JSON.stringify({ ...day, kind: "block" }));
    expect(readClip()).toBeNull();
  });

  it("tells every hook on the page the moment something is copied", () => {
    const { result } = renderHook(() => useClip());
    expect(result.current).toBeNull();
    act(() => holdClip(day));
    expect(result.current).toEqual(day);
    act(() => clearClip());
    expect(result.current).toBeNull();
  });

  it("names what it holds with its size", () => {
    expect(clipSummary(day)).toBe("Squat day (4 lines)");
    expect(clipSummary({ ...day, lines: 1 })).toBe("Squat day (1 line)");
    expect(clipSummary({ ...day, kind: "week", label: "Week 2", days: 1 })).toBe("Week 2 (1 day)");
  });

  it("mints paste ids the server takes, different every time", () => {
    const a = newPasteId();
    const b = newPasteId();
    expect(a).toMatch(/^[0-9a-f]{20}$/);
    expect(a).not.toBe(b);
    expect(readProgramOp({ op: "copyDay", dayId: "d1", toWeekId: "w1", requestId: a })).toMatchObject({ ok: true });
    expect(readProgramOp({ op: "copyWeek", weekId: "w1", toBlockId: "b1", position: 0, requestId: b })).toMatchObject({ ok: true });
  });
});
