import { describe, expect, it } from "vitest";
import { isEmptyWeek, summariseWeek } from "./week-summary";

// Wednesday 14 Oct 2026; the week began Monday 12 Oct (London).
const NOW = new Date("2026-10-14T12:00:00Z");
const WEEK = "2026-10-12T00:00:00.000Z";
const LAST_WEEK = "2026-10-05T00:00:00.000Z";

const session = (startedAt: string, finished = true) => ({
  startedAt: new Date(startedAt),
  finishedAt: finished ? new Date(new Date(startedAt).getTime() + 3_600_000) : null,
});

describe("summariseWeek", () => {
  it("adds up this week's rollups across lifts and counts finished sessions", () => {
    const summary = summariseWeek(
      [session("2026-10-12T18:00:00Z"), session("2026-10-14T07:00:00Z")],
      [
        { weekStart: WEEK, setCount: 5, tonnageKg: 3500 },
        { weekStart: WEEK, setCount: 4, tonnageKg: 1600.25 },
      ],
      NOW,
    );
    expect(summary).toEqual({ sessions: 2, sets: 9, tonnageKg: 5100.3 });
  });

  it("leaves out last week, and a session still open", () => {
    const summary = summariseWeek(
      [session("2026-10-10T10:00:00Z"), session("2026-10-14T10:00:00Z", false)],
      [{ weekStart: LAST_WEEK, setCount: 12, tonnageKg: 9000 }],
      NOW,
    );
    expect(summary).toEqual({ sessions: 0, sets: 0, tonnageKg: 0 });
    expect(isEmptyWeek(summary)).toBe(true);
  });

  it("files a Monday 00:30 BST session in the new week, not the old one", () => {
    // 23:30 UTC on Sunday is 00:30 on Monday in London: the rollups' rule.
    const summary = summariseWeek([session("2026-10-11T23:30:00Z")], [], NOW);
    expect(summary.sessions).toBe(1);
  });

  it("ignores a rollup row with no readable week", () => {
    expect(summariseWeek([], [{ weekStart: "", setCount: 3, tonnageKg: 300 }], NOW).sets).toBe(0);
  });

  it("is empty for a brand-new account", () => {
    expect(isEmptyWeek(summariseWeek([], [], NOW))).toBe(true);
  });
});
