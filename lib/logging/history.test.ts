import { describe, expect, it } from "vitest";
import {
  filterByExercise,
  formatDuration,
  formatTonnage,
  groupByWeek,
  historyCards,
  weekLabel,
  type HistoryCard,
} from "./history";
import type { SessionRecord } from "./session";

const card = (over: Partial<HistoryCard> = {}): HistoryCard => ({
  sessionId: "s1",
  startedAt: new Date("2026-09-14T09:00:00Z"),
  finishedAt: new Date("2026-09-14T10:12:00Z"),
  durationMs: 72 * 60_000,
  exerciseNames: ["Squat", "Bench Press"],
  setCount: 8,
  tonnageKg: 4200,
  pendingSync: false,
  ...over,
});

const NOW = new Date("2026-09-17T12:00:00Z");

describe("formatDuration", () => {
  it("reads as a session length", () => {
    expect(formatDuration(72 * 60_000)).toBe("1h 12m");
    expect(formatDuration(58 * 60_000)).toBe("58m");
    expect(formatDuration(60 * 60_000)).toBe("1h 00m");
  });

  it("says nothing for a session that has not finished", () => {
    expect(formatDuration(null)).toBe("");
  });
});

describe("formatTonnage", () => {
  it("groups thousands, because tonnage is the one number that gets long", () => {
    expect(formatTonnage(4200)).toBe("4,200");
    expect(formatTonnage(61000)).toBe("61,000");
    expect(formatTonnage(940)).toBe("940");
  });

  it("rounds to the kilo: a session total does not need a decimal", () => {
    expect(formatTonnage(1150.5)).toBe("1,151");
  });
});

describe("weekLabel", () => {
  it("names the recent weeks the way someone would", () => {
    expect(weekLabel(new Date("2026-09-14T00:00:00Z"), NOW)).toBe("This week");
    expect(weekLabel(new Date("2026-09-07T00:00:00Z"), NOW)).toBe("Last week");
  });

  it("dates the older ones", () => {
    expect(weekLabel(new Date("2026-08-31T00:00:00Z"), NOW)).toBe("Week of Monday 31 Aug");
  });
});

describe("groupByWeek", () => {
  it("groups by week and puts the newest first", () => {
    const weeks = groupByWeek(
      [
        card({ sessionId: "old", startedAt: new Date("2026-09-08T09:00:00Z") }),
        card({ sessionId: "new", startedAt: new Date("2026-09-16T09:00:00Z") }),
        card({ sessionId: "mid", startedAt: new Date("2026-09-14T09:00:00Z") }),
      ],
      NOW,
    );

    expect(weeks.map((w) => w.label)).toEqual(["This week", "Last week"]);
    expect(weeks[0].sessions.map((s) => s.sessionId)).toEqual(["new", "mid"]);
    expect(weeks[1].sessions.map((s) => s.sessionId)).toEqual(["old"]);
  });

  it("keeps a Sunday session in the week it belongs to", () => {
    // Same Monday-to-Sunday London week the rollups use. Two ideas of a week
    // in one product is how a chart bar and a History heading end up
    // disagreeing about which session goes where.
    const weeks = groupByWeek([card({ startedAt: new Date("2026-09-20T18:00:00Z") })], NOW);
    expect(weeks[0].label).toBe("This week");
  });
});

describe("filterByExercise", () => {
  const weeks = groupByWeek(
    [
      card({ sessionId: "a", exerciseNames: ["Squat", "Bench Press"] }),
      card({ sessionId: "b", startedAt: new Date("2026-09-15T09:00:00Z"), exerciseNames: ["Deadlift"] }),
    ],
    NOW,
  );

  it("answers the query people actually have", () => {
    // "Show me my deadlift sessions" -- the blueprint's words.
    const found = filterByExercise(weeks, "deadlift");
    expect(found.flatMap((w) => w.sessions.map((s) => s.sessionId))).toEqual(["b"]);
  });

  it("matches part of a name, and ignores case", () => {
    expect(filterByExercise(weeks, "BENCH")[0].sessions[0].sessionId).toBe("a");
  });

  it("drops a week left with nothing in it", () => {
    expect(filterByExercise(weeks, "curl")).toEqual([]);
  });

  it("returns everything for an empty query", () => {
    expect(filterByExercise(weeks, "   ")).toHaveLength(weeks.length);
  });
});

describe("historyCards", () => {
  const session = (over: Partial<SessionRecord> = {}): SessionRecord => ({
    id: "s1",
    clientSessionId: "s1",
    startedAt: new Date("2026-09-14T09:00:00Z"),
    finishedAt: new Date("2026-09-14T10:12:00Z"),
    setCount: 8,
    tonnageKg: 4200,
    notes: null,
    ...over,
  });

  it("takes its totals from the session row, not from the sets", () => {
    // The finish screen showed the athlete these exact numbers. Recomputing
    // here would mean a session whose finish is still queued shows one total on
    // the summary and a different one on History.
    const [built] = historyCards([session()], () => ["Squat"]);
    expect(built.setCount).toBe(8);
    expect(built.tonnageKg).toBe(4200);
    expect(built.durationMs).toBe(72 * 60_000);
  });

  it("leaves a running session without a duration", () => {
    const [built] = historyCards([session({ finishedAt: null })], () => []);
    expect(built.durationMs).toBeNull();
    expect(formatDuration(built.durationMs)).toBe("");
  });

  it("marks a session the server has not heard of", () => {
    const [built] = historyCards([session()], () => [], (id) => id === "s1");
    expect(built.pendingSync).toBe(true);
  });
});
