import type { BodyweightEntry } from "@/lib/bodyweight/bodyweight";
import type { ClipSet } from "@/lib/review/queue";
import {
  buildRoster,
  changeLabel,
  DEFAULT_SORT,
  nextSort,
  sortRows,
  UNNAMED_ATHLETE,
  weekLabel,
  type RosterInputs,
  type RosterRow,
} from "./roster";

// Tuesday 6 Oct 2026, so the week began Monday 5 Oct (label 2026-10-05T00:00Z).
const NOW = new Date("2026-10-06T14:00:00.000Z");
const WEEK = "2026-10-05T00:00:00.000Z";

const clip = (id: string, athleteId: string): ClipSet => ({
  id,
  athleteId,
  exerciseId: "squat",
  sessionId: "s",
  setIndex: 0,
  loadKg: 180,
  reps: 3,
  rpe: 8,
  e1rmKg: null,
  loggedAt: "2026-10-05T18:00:00.000Z",
  videoFileId: `f-${id}`,
  notes: null,
});

const bw = (athleteId: string, measuredOn: string, weightKg: number): BodyweightEntry => ({
  id: `${athleteId}-${measuredOn}`,
  athleteId,
  measuredOn,
  weightKg,
  recordedAt: `${measuredOn}T07:00:00.000Z`,
});

const inputs = (over: Partial<RosterInputs> = {}): RosterInputs => ({
  links: [{ athleteId: "joey", linkedAt: new Date("2026-09-20T00:00:00.000Z") }],
  names: new Map([["joey", "Joey Pang"]]),
  visible: new Map([["joey", true]]),
  sessions: [],
  rollups: [],
  clips: [],
  reviewedSetIds: new Set(),
  bodyweight: [],
  program: new Map(),
  ...over,
});

describe("buildRoster", () => {
  it("counts finished sessions this week only", () => {
    const { rows } = buildRoster(
      inputs({
        sessions: [
          { athleteId: "joey", startedAt: "2026-10-05T17:00:00.000Z", finishedAt: "2026-10-05T18:30:00.000Z" },
          { athleteId: "joey", startedAt: "2026-10-06T12:00:00.000Z", finishedAt: null }, // in progress
          { athleteId: "joey", startedAt: "2026-10-04T10:00:00.000Z", finishedAt: "2026-10-04T11:00:00.000Z" }, // last week
          { athleteId: "other", startedAt: "2026-10-05T17:00:00.000Z", finishedAt: "2026-10-05T18:00:00.000Z" },
        ],
      }),
      NOW,
    );
    expect(rows[0].sessionsThisWeek).toBe(1);
  });

  it("puts a 00:30 Monday BST session in the new week, like the rollups do", () => {
    const { rows } = buildRoster(
      inputs({
        sessions: [{ athleteId: "joey", startedAt: "2026-10-04T23:30:00.000Z", finishedAt: "2026-10-05T00:30:00.000Z" }],
      }),
      NOW,
    );
    expect(rows[0].sessionsThisWeek).toBe(1);
  });

  it("sums this week's working sets from rollups across lifts", () => {
    const { rows } = buildRoster(
      inputs({
        rollups: [
          { athleteId: "joey", weekStart: WEEK, setCount: 12 },
          { athleteId: "joey", weekStart: WEEK, setCount: 9 },
          { athleteId: "joey", weekStart: "2026-09-28T00:00:00.000Z", setCount: 40 },
        ],
      }),
      NOW,
    );
    expect(rows[0].setsThisWeek).toBe(21);
  });

  it("counts only clips this coach has not cleared", () => {
    const { rows, signals } = buildRoster(
      inputs({ clips: [clip("a", "joey"), clip("b", "joey"), clip("c", "other")], reviewedSetIds: new Set(["a"]) }),
      NOW,
    );
    expect(rows[0].videosWaiting).toBe(1);
    expect(signals[0].unreviewedClips).toBe(1);
  });

  it("shows the latest weigh-in with the week-on-week change", () => {
    const entries = [
      ...["2026-09-24", "2026-09-26", "2026-09-28"].map((d) => bw("joey", d, 82)),
      ...["2026-10-01", "2026-10-03", "2026-10-05"].map((d) => bw("joey", d, 83)),
    ];
    const { rows, signals } = buildRoster(inputs({ bodyweight: entries }), NOW);
    expect(rows[0].bodyweight).toEqual({ latestKg: 83, measuredOn: "2026-10-05", changeKg: 1, stale: false });
    expect(signals[0].lastBodyweightOn).toBe("2026-10-05");
  });

  it("marks a weigh-in older than the window as stale, without a trend", () => {
    const { rows } = buildRoster(inputs({ bodyweight: [bw("joey", "2026-09-10", 81)] }), NOW);
    expect(rows[0].bodyweight).toMatchObject({ latestKg: 81, stale: true, changeKg: null });
  });

  it("has no bodyweight for an athlete who never logged one", () => {
    const { rows, signals } = buildRoster(inputs(), NOW);
    expect(rows[0].bodyweight).toBeNull();
    expect(signals[0].lastBodyweightOn).toBeNull();
  });

  it("names an athlete with no profile row, rather than hiding them", () => {
    const { rows } = buildRoster(inputs({ names: new Map() }), NOW);
    expect(rows[0].name).toBe(UNNAMED_ATHLETE);
  });

  it("treats an athlete missing from the visibility map as not visible", () => {
    const { rows, signals } = buildRoster(inputs({ visible: new Map() }), NOW);
    expect(rows[0].visible).toBe(false);
    expect(signals[0].visible).toBe(false);
  });

  it("takes the block label and the program signals from the Order 19 seam", () => {
    const program = { blockLabel: "Week 3 of 8", missedSessions: 1, unpromptedMaxes: [] };
    const { rows, signals } = buildRoster(inputs({ program: new Map([["joey", program]]) }), NOW);
    expect(rows[0].block).toBe("Week 3 of 8");
    expect(signals[0].program).toBe(program);
  });

  it("has no block while there is no program", () => {
    expect(buildRoster(inputs(), NOW).rows[0].block).toBeNull();
  });

  it("passes the link date through for the grace period", () => {
    expect(buildRoster(inputs(), NOW).signals[0].linkedAt).toEqual(new Date("2026-09-20T00:00:00.000Z"));
  });
});

const row = (over: Partial<RosterRow>): RosterRow => ({
  athleteId: over.name ?? "x",
  name: "X",
  visible: true,
  sessionsThisWeek: 0,
  setsThisWeek: 0,
  videosWaiting: 0,
  bodyweight: null,
  block: null,
  ...over,
});

describe("sorting", () => {
  const rows = [
    row({ name: "Cy", videosWaiting: 2, sessionsThisWeek: 1, setsThisWeek: 30 }),
    row({ name: "Al", videosWaiting: 0, sessionsThisWeek: 2, setsThisWeek: 10, bodyweight: { latestKg: 90, measuredOn: "2026-10-05", changeKg: null, stale: false } }),
    row({ name: "Bea", videosWaiting: 2, sessionsThisWeek: 2, setsThisWeek: 20, bodyweight: { latestKg: 63, measuredOn: "2026-10-05", changeKg: null, stale: false } }),
  ];
  const names = (sorted: RosterRow[]) => sorted.map((r) => r.name);

  it("defaults to name, A first", () => {
    expect(names(sortRows(rows, DEFAULT_SORT))).toEqual(["Al", "Bea", "Cy"]);
  });

  it("sorts videos most-first, breaking ties by name", () => {
    expect(names(sortRows(rows, { key: "videos", dir: "desc" }))).toEqual(["Bea", "Cy", "Al"]);
  });

  it("sorts this week by sessions, then sets", () => {
    expect(names(sortRows(rows, { key: "week", dir: "desc" }))).toEqual(["Bea", "Al", "Cy"]);
  });

  it("keeps blanks last in either direction", () => {
    expect(names(sortRows(rows, { key: "bodyweight", dir: "desc" }))).toEqual(["Al", "Bea", "Cy"]);
    expect(names(sortRows(rows, { key: "bodyweight", dir: "asc" }))).toEqual(["Bea", "Al", "Cy"]);
  });

  it("flips on a second click and starts numbers biggest-first on the first", () => {
    expect(nextSort(DEFAULT_SORT, "name")).toEqual({ key: "name", dir: "desc" });
    expect(nextSort(DEFAULT_SORT, "videos")).toEqual({ key: "videos", dir: "desc" });
  });
});

describe("labels", () => {
  it("says sessions, and sets when there are any", () => {
    expect(weekLabel(row({ sessionsThisWeek: 0 }))).toBe("0 sessions");
    expect(weekLabel(row({ sessionsThisWeek: 1, setsThisWeek: 14 }))).toBe("1 session · 14 sets");
    expect(weekLabel(row({ sessionsThisWeek: 1, setsThisWeek: 1 }))).toBe("1 session · 1 set");
  });

  it("signs a change with a real minus", () => {
    expect(changeLabel(0.4)).toBe("+0.4");
    expect(changeLabel(-0.6)).toBe("−0.6");
    expect(changeLabel(0)).toBe("±0.0");
  });
});
