import { describe, expect, it } from "vitest";
import {
  canChart,
  chartGeometry,
  headline,
  personalRecords,
  plottable,
  pointsInRange,
  type WeekPoint,
} from "./lift";

const week = (iso: string, over: Partial<WeekPoint> = {}): WeekPoint => ({
  weekStart: new Date(iso),
  bestE1rmKg: 200,
  bestSingleKg: 180,
  bestSingleReps: 3,
  bestReps: 8,
  bestRepsLoadKg: 140,
  ...over,
});

const NOW = new Date("2026-09-14T12:00:00Z");

describe("pointsInRange", () => {
  const points = [
    week("2026-09-07T00:00:00Z"),
    week("2026-01-05T00:00:00Z"),
    week("2026-07-06T00:00:00Z"),
  ];

  it("reads oldest first, the direction a chart is drawn in", () => {
    expect(pointsInRange(points, "all", NOW).map((p) => p.weekStart.getFullYear())).toHaveLength(3);
    const ordered = pointsInRange(points, "all", NOW);
    expect(ordered[0].weekStart.toISOString()).toBe("2026-01-05T00:00:00.000Z");
    expect(ordered[2].weekStart.toISOString()).toBe("2026-09-07T00:00:00.000Z");
  });

  it("cuts to the window asked for", () => {
    expect(pointsInRange(points, "8w", NOW)).toHaveLength(1);
    expect(pointsInRange(points, "12w", NOW)).toHaveLength(2);
    expect(pointsInRange(points, "6m", NOW)).toHaveLength(2);
  });
});

describe("headline", () => {
  it("takes the most recent week that produced an estimate", () => {
    const points = [
      week("2026-08-03T00:00:00Z", { bestE1rmKg: 205 }),
      week("2026-08-10T00:00:00Z", { bestE1rmKg: null }),
      week("2026-08-17T00:00:00Z", { bestE1rmKg: 212.5 }),
    ];
    expect(headline(points).currentE1rmKg).toBe(212.5);
  });

  it("measures the change across the range", () => {
    const points = [
      week("2026-08-03T00:00:00Z", { bestE1rmKg: 205 }),
      week("2026-08-17T00:00:00Z", { bestE1rmKg: 212.5 }),
    ];
    expect(headline(points).changeKg).toBe(7.5);
  });

  it("reports a flat range as flat, which is not the same as saying nothing", () => {
    const points = [
      week("2026-08-03T00:00:00Z", { bestE1rmKg: 200 }),
      week("2026-08-17T00:00:00Z", { bestE1rmKg: 200 }),
    ];
    expect(headline(points).changeKg).toBe(0);
  });

  it("says nothing about a trend it cannot see", () => {
    // One point is not a trend, and neither is none.
    expect(headline([week("2026-08-03T00:00:00Z")]).changeKg).toBeNull();
    expect(headline([])).toEqual({ currentE1rmKg: null, changeKg: null });
  });

  it("does not accumulate float noise into the change", () => {
    const points = [
      week("2026-08-03T00:00:00Z", { bestE1rmKg: 176.5 }),
      week("2026-08-17T00:00:00Z", { bestE1rmKg: 184.2 }),
    ];
    expect(headline(points).changeKg).toBe(7.7);
  });
});

describe("personalRecords", () => {
  const points = [
    week("2026-08-03T00:00:00Z", { bestE1rmKg: 205, bestSingleKg: 190, bestSingleReps: 2, bestReps: 10, bestRepsLoadKg: 130 }),
    week("2026-08-10T00:00:00Z", { bestE1rmKg: 212.5, bestSingleKg: 200, bestSingleReps: 1, bestReps: 8, bestRepsLoadKg: 150 }),
    week("2026-08-17T00:00:00Z", { bestE1rmKg: 208, bestSingleKg: 195, bestSingleReps: 2, bestReps: 12, bestRepsLoadKg: 140 }),
  ];

  it("takes the best of each, all-time", () => {
    expect(personalRecords(points)).toEqual({
      heaviestSingleKg: 200,
      heaviestSingleReps: 1,
      bestE1rmKg: 212.5,
      mostReps: 12,
      mostRepsLoadKg: 140,
    });
  });

  it("prefers the heavier set when the reps tie", () => {
    const tied = [
      week("2026-08-03T00:00:00Z", { bestReps: 12, bestRepsLoadKg: 100 }),
      week("2026-08-10T00:00:00Z", { bestReps: 12, bestRepsLoadKg: 140 }),
    ];
    expect(personalRecords(tied).mostRepsLoadKg).toBe(140);
  });

  it("ignores weeks that set no record of that kind", () => {
    const sparse = [
      week("2026-08-03T00:00:00Z", { bestE1rmKg: null, bestReps: null, bestRepsLoadKg: null }),
      week("2026-08-10T00:00:00Z", { bestE1rmKg: 180 }),
    ];
    expect(personalRecords(sparse).bestE1rmKg).toBe(180);
  });

  it("has nothing to report for an athlete with nothing logged", () => {
    expect(personalRecords([])).toEqual({
      heaviestSingleKg: null,
      heaviestSingleReps: null,
      bestE1rmKg: null,
      mostReps: null,
      mostRepsLoadKg: null,
    });
  });
});

describe("canChart", () => {
  it("refuses to draw a trend out of two points", () => {
    // A two-point line is worse than no line: it turns a coincidence into a
    // direction, on the screen that exists to answer "is this going up".
    const two = [week("2026-08-03T00:00:00Z"), week("2026-08-10T00:00:00Z")];
    expect(canChart(two)).toBe(false);
    expect(canChart([...two, week("2026-08-17T00:00:00Z")])).toBe(true);
  });

  it("does not count weeks with no estimate toward the three", () => {
    const points = [
      week("2026-08-03T00:00:00Z"),
      week("2026-08-10T00:00:00Z", { bestE1rmKg: null }),
      week("2026-08-17T00:00:00Z"),
    ];
    expect(plottable(points)).toHaveLength(2);
    expect(canChart(points)).toBe(false);
  });
});

describe("chartGeometry", () => {
  const points = [
    week("2026-08-03T00:00:00Z", { bestE1rmKg: 200 }),
    week("2026-08-10T00:00:00Z", { bestE1rmKg: 210 }),
    week("2026-08-17T00:00:00Z", { bestE1rmKg: 220 }),
  ];

  it("puts the oldest on the left and the newest on the right", () => {
    const geometry = chartGeometry(points, 300, 100, 4)!;
    expect(geometry.dots[0].x).toBe(4);
    expect(geometry.dots[2].x).toBeCloseTo(296);
  });

  it("puts the best at the top, because SVG y grows downward", () => {
    const geometry = chartGeometry(points, 300, 100, 4)!;
    expect(geometry.dots[2].y).toBe(4);
    expect(geometry.dots[0].y).toBe(96);
  });

  it("spaces by time, so a month off shows as a gap", () => {
    // Spaced by index, three weeks of training and a three-month layoff would
    // look like the same steady progress.
    const gapped = [
      week("2026-06-01T00:00:00Z", { bestE1rmKg: 200 }),
      week("2026-08-24T00:00:00Z", { bestE1rmKg: 210 }),
      week("2026-08-31T00:00:00Z", { bestE1rmKg: 220 }),
    ];
    const geometry = chartGeometry(gapped, 300, 100, 0)!;
    expect(geometry.dots[1].x).toBeGreaterThan(250);
  });

  it("draws a flat line through the middle rather than along the floor", () => {
    const flat = [
      week("2026-08-03T00:00:00Z", { bestE1rmKg: 200 }),
      week("2026-08-10T00:00:00Z", { bestE1rmKg: 200 }),
      week("2026-08-17T00:00:00Z", { bestE1rmKg: 200 }),
    ];
    const geometry = chartGeometry(flat, 300, 100, 0)!;
    expect(geometry.dots.every((dot) => dot.y === 50)).toBe(true);
  });

  it("has no geometry for a line that cannot be drawn", () => {
    expect(chartGeometry([week("2026-08-03T00:00:00Z")], 300, 100)).toBeNull();
    expect(chartGeometry([], 300, 100)).toBeNull();
  });

  it("starts the path with a move and continues with lines", () => {
    expect(chartGeometry(points, 300, 100, 4)!.path).toMatch(/^M[\d.]+,[\d.]+ L[\d.]+,[\d.]+ L/);
  });
});
