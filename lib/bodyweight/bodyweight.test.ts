import {
  AVERAGE_DAYS,
  averageSeries,
  checkWeight,
  dayDate,
  dayKey,
  daysBetween,
  inRange,
  latestEntry,
  MAX_PLAUSIBLE_KG,
  MIN_PLAUSIBLE_KG,
  rollingAverage,
  sortedByDay,
  trend,
  type BodyweightEntry,
} from "./bodyweight";

const on = (measuredOn: string, weightKg: number): BodyweightEntry => ({
  id: `e-${measuredOn}`,
  athleteId: "joey",
  weightKg,
  measuredOn,
  recordedAt: `${measuredOn}T07:00:00.000Z`,
});

describe("checkWeight", () => {
  it("accepts an ordinary bodyweight", () => {
    expect(checkWeight(82.4)).toEqual({ ok: true, weightKg: 82.4 });
  });

  it("rounds to the one decimal a scale actually shows", () => {
    // Storing 82.44999 invents precision nobody measured.
    expect(checkWeight(82.44999)).toEqual({ ok: true, weightKg: 82.4 });
    expect(checkWeight(82.46)).toEqual({ ok: true, weightKg: 82.5 });
  });

  it("catches a misplaced decimal point and a stray keypress", () => {
    // 8.24 for 82.4, and 824 for 82.4. The two typos this guard exists for.
    expect(checkWeight(8.24)).toEqual({ ok: false, reason: "out-of-range" });
    expect(checkWeight(824)).toEqual({ ok: false, reason: "out-of-range" });
  });

  it("accepts both ends of the plausible range", () => {
    expect(checkWeight(MIN_PLAUSIBLE_KG).ok).toBe(true);
    expect(checkWeight(MAX_PLAUSIBLE_KG).ok).toBe(true);
  });

  it("refuses what is not a number at all", () => {
    expect(checkWeight(Number.NaN)).toEqual({ ok: false, reason: "not-a-number" });
    expect(checkWeight(Number.POSITIVE_INFINITY)).toEqual({ ok: false, reason: "not-a-number" });
  });
});

describe("dayKey", () => {
  it("is local, so a morning is not filed under yesterday", () => {
    // Built from local parts on purpose: 7am in Sydney is today there, and
    // toISOString would call it the day before.
    const local = new Date(2026, 8, 15, 7, 30);
    expect(dayKey(local)).toBe("2026-09-15");
  });

  it("pads month and day", () => {
    expect(dayKey(new Date(2026, 0, 3))).toBe("2026-01-03");
  });

  it("round-trips through dayDate", () => {
    expect(dayKey(dayDate("2026-09-15")!)).toBe("2026-09-15");
  });

  it("refuses a key that is not a date", () => {
    for (const bad of ["", "2026-9-15", "15-09-2026", "not a date"]) {
      expect(dayDate(bad)).toBeNull();
    }
  });

  it("refuses an impossible date rather than letting it roll over", () => {
    // `new Date(2026, 12, 45)` is a real day in February 2027. A corrupt
    // measured_on would otherwise plot somewhere plausible and drag an average.
    expect(dayDate("2026-13-45")).toBeNull();
    expect(dayDate("2026-02-30")).toBeNull();
    expect(dayDate("2026-00-10")).toBeNull();
    // A real leap day still parses.
    expect(dayDate("2028-02-29")).not.toBeNull();
  });

  it("counts whole days between keys, including across a month end", () => {
    expect(daysBetween("2026-09-14", "2026-09-15")).toBe(1);
    expect(daysBetween("2026-08-31", "2026-09-01")).toBe(1);
    expect(daysBetween("2026-09-15", "2026-09-14")).toBe(-1);
    expect(daysBetween("bad", "2026-09-15")).toBeNull();
  });
});

describe("sortedByDay", () => {
  it("is newest first and drops anything undateable", () => {
    const sorted = sortedByDay([on("2026-09-10", 82), on("bad", 99), on("2026-09-12", 83)]);
    expect(sorted.map((entry) => entry.measuredOn)).toEqual(["2026-09-12", "2026-09-10"]);
  });

  it("finds the latest, or null on nothing", () => {
    expect(latestEntry([on("2026-09-10", 82), on("2026-09-12", 83)])?.weightKg).toBe(83);
    expect(latestEntry([])).toBeNull();
  });
});

describe("rollingAverage", () => {
  const week = [
    on("2026-09-09", 82.0),
    on("2026-09-10", 82.4),
    on("2026-09-11", 81.8),
    on("2026-09-12", 82.2),
  ];

  it("averages the window and says how many went into it", () => {
    const average = rollingAverage(week, "2026-09-12", 7);
    expect(average).toEqual({ kg: 82.1, count: 4 });
  });

  it("gives a number from a partial window rather than refusing", () => {
    // Four days in, or back after a week away. The blueprint asks for no guilt
    // copy on a gap, and a blank where the trend should be is guilt copy.
    expect(rollingAverage([on("2026-09-12", 82.2)], "2026-09-12", 7)).toEqual({
      kg: 82.2,
      count: 1,
    });
  });

  it("includes the end day and excludes the day the window starts before", () => {
    // A 7-day window ending on the 12th covers the 6th to the 12th.
    expect(rollingAverage([on("2026-09-06", 90)], "2026-09-12", 7)?.count).toBe(1);
    expect(rollingAverage([on("2026-09-05", 90)], "2026-09-12", 7)).toBeNull();
  });

  it("is never pulled by a weight from the future", () => {
    // A weigh-in dated tomorrow must not move today's average.
    const withFuture = [...week, on("2026-09-20", 95)];
    expect(rollingAverage(withFuture, "2026-09-12", 7)).toEqual({ kg: 82.1, count: 4 });
  });

  it("is null when the window is empty or the day is unreadable", () => {
    expect(rollingAverage(week, "2026-10-30", 7)).toBeNull();
    expect(rollingAverage(week, "nonsense", 7)).toBeNull();
    expect(rollingAverage(week, "2026-09-12", 0)).toBeNull();
  });
});

describe("trend", () => {
  const fortnight = [
    on("2026-09-01", 84.0),
    on("2026-09-02", 84.2),
    on("2026-09-03", 83.8),
    on("2026-09-10", 82.0),
    on("2026-09-11", 82.4),
    on("2026-09-12", 81.8),
  ];

  it("compares window to window, not day to day", () => {
    // A single day's difference is mostly water. Telling somebody they gained
    // half a kilo overnight is noise dressed as information.
    const result = trend(fortnight, AVERAGE_DAYS, "2026-09-12");
    expect(result?.latestKg).toBe(81.8);
    expect(result?.average).toEqual({ kg: 82.1, count: 3 });
    expect(result?.changeKg).toBe(-1.9);
  });

  it("gives no change when there is no previous window", () => {
    // Rendered as an absence. A "+0.0" would read as a plateau somebody held.
    const result = trend([on("2026-09-12", 82)], AVERAGE_DAYS, "2026-09-12");
    expect(result?.changeKg).toBeNull();
  });

  it("is null with no entries at all", () => {
    expect(trend([], AVERAGE_DAYS, "2026-09-12")).toBeNull();
  });

  it("gives no average when the last weigh-in is older than the window", () => {
    // Three weeks away from the scales. A "7-day average" here would be a lie
    // with a number attached -- the screen shows the last weight and its date
    // instead, and says nothing about a week with no data in it.
    expect(trend([on("2026-08-20", 85)], AVERAGE_DAYS, "2026-09-12")).toBeNull();
  });

  it("still reports when the last weigh-in is inside the window", () => {
    const result = trend([on("2026-09-08", 85)], AVERAGE_DAYS, "2026-09-12");
    expect(result?.latestKg).toBe(85);
    expect(result?.average.count).toBe(1);
  });
});

describe("inRange", () => {
  const entries = [
    on("2026-09-12", 82),
    // 23 days back: inside 30.
    on("2026-08-20", 83),
    // 55 days back: outside 30, inside 90.
    on("2026-07-19", 85),
    // 103 days back: outside all but "all".
    on("2026-06-01", 86),
  ];

  it("returns oldest first, which is the order a line is drawn in", () => {
    expect(inRange(entries, "all", "2026-09-12").map((e) => e.measuredOn)).toEqual([
      "2026-06-01",
      "2026-07-19",
      "2026-08-20",
      "2026-09-12",
    ]);
  });

  it("keeps only what falls inside the window", () => {
    expect(inRange(entries, 30, "2026-09-12")).toHaveLength(2);
    expect(inRange(entries, 90, "2026-09-12")).toHaveLength(3);
    expect(inRange(entries, "all", "2026-09-12")).toHaveLength(4);
  });

  it("drops a weigh-in dated after today rather than plotting the future", () => {
    expect(inRange([on("2026-09-20", 80)], 30, "2026-09-12")).toHaveLength(0);
  });
});

describe("averageSeries", () => {
  it("smooths over the full history, not just the visible range", () => {
    // Otherwise zooming from 90 days to 30 changes the shape of the average at
    // the left-hand edge, and an average that moves when you zoom is one
    // nobody can trust.
    const all = [
      on("2026-09-06", 90),
      on("2026-09-07", 90),
      on("2026-09-08", 90),
      on("2026-09-09", 84),
      on("2026-09-10", 84),
    ];
    const visible = [{ measuredOn: "2026-09-09" }, { measuredOn: "2026-09-10" }];
    const series = averageSeries(all, visible, 7);
    // 9 Sep averages the four days up to it, not just the two on screen.
    expect(series[0]).toEqual({ measuredOn: "2026-09-09", kg: 88.5 });
    expect(series[1]).toEqual({ measuredOn: "2026-09-10", kg: 87.6 });
  });

  it("leaves out a point with nothing to average", () => {
    expect(averageSeries([], [{ measuredOn: "2026-09-10" }], 7)).toEqual([]);
  });
});
