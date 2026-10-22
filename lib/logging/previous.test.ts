import { alignPrevious, fillFromLastSession, previousSessionSets, type HistorySet } from "./previous";
import type { PlannedRow } from "./plan";

const at = (iso: string) => new Date(iso);

const history = (over: Partial<HistorySet> & { sessionId: string; loggedAt: Date }): HistorySet => ({
  clientSetId: `${over.sessionId}-${over.loggedAt.toISOString()}`,
  setIndex: null,
  loadKg: 100,
  reps: 5,
  rpe: null,
  isWarmup: false,
  e1rmKg: null,
  ...over,
});

describe("previousSessionSets", () => {
  it("takes the session of the newest set, in the order its sets were done", () => {
    const sets = [
      history({ sessionId: "tue", loggedAt: at("2026-10-20T18:10:00Z"), loadKg: 145, reps: 3 }),
      history({ sessionId: "tue", loggedAt: at("2026-10-20T18:00:00Z"), loadKg: 60, isWarmup: true }),
      history({ sessionId: "tue", loggedAt: at("2026-10-20T18:05:00Z"), loadKg: 140 }),
      history({ sessionId: "fri", loggedAt: at("2026-10-17T18:00:00Z"), loadKg: 130 }),
    ];
    expect(previousSessionSets(sets)).toEqual([
      { loadKg: 60, reps: 5, isWarmup: true },
      { loadKg: 140, reps: 5, isWarmup: false },
      { loadKg: 145, reps: 3, isWarmup: false },
    ]);
  });

  it("never treats the session being logged as last time", () => {
    const sets = [
      history({ sessionId: "now", loggedAt: at("2026-10-22T18:00:00Z"), loadKg: 150 }),
      history({ sessionId: "fri", loggedAt: at("2026-10-17T18:00:00Z"), loadKg: 130 }),
    ];
    expect(previousSessionSets(sets, "now")).toEqual([{ loadKg: 130, reps: 5, isWarmup: false }]);
  });

  it("breaks a timestamp tie on set_index", () => {
    const same = at("2026-10-20T18:00:00Z");
    const sets = [
      history({ sessionId: "a", loggedAt: same, setIndex: 2, loadKg: 145 }),
      history({ sessionId: "a", loggedAt: same, setIndex: 1, loadKg: 140 }),
    ];
    expect(previousSessionSets(sets).map((s) => s.loadKg)).toEqual([140, 145]);
  });

  it("is empty with no history", () => {
    expect(previousSessionSets([])).toEqual([]);
    expect(previousSessionSets([history({ sessionId: "now", loggedAt: at("2026-10-22T18:00:00Z") })], "now")).toEqual([]);
  });
});

describe("alignPrevious", () => {
  const last = [
    { loadKg: 60, reps: 5, isWarmup: true },
    { loadKg: 100, reps: 3, isWarmup: true },
    { loadKg: 140, reps: 5, isWarmup: false },
    { loadKg: 145, reps: 3, isWarmup: false },
  ];

  it("lines warm-ups up with warm-ups and working sets with working sets", () => {
    const rows = [
      { exerciseId: "squat", isWarmup: true },
      { exerciseId: "squat", isWarmup: false },
      { exerciseId: "squat", isWarmup: false },
    ];
    expect(alignPrevious(rows, () => last)).toEqual([last[0], last[2], last[3]]);
  });

  it("counts working sets the same however many warm-ups either day did", () => {
    const rows = [
      { exerciseId: "squat", isWarmup: true },
      { exerciseId: "squat", isWarmup: true },
      { exerciseId: "squat", isWarmup: true },
      { exerciseId: "squat", isWarmup: false },
    ];
    expect(alignPrevious(rows, () => last)).toEqual([last[0], last[1], null, last[2]]);
  });

  it("gives null past the end of last time, and for an exercise with none", () => {
    const rows = [
      { exerciseId: "squat", isWarmup: false },
      { exerciseId: "squat", isWarmup: false },
      { exerciseId: "squat", isWarmup: false },
      { exerciseId: "bench", isWarmup: false },
    ];
    expect(alignPrevious(rows, (id) => (id === "squat" ? last : null))).toEqual([last[2], last[3], null, null]);
  });

  it("numbers each exercise of a swapped block from its own first set", () => {
    const barbell = [{ loadKg: 70, reps: 8, isWarmup: false }];
    const dumbbell = [
      { loadKg: 30, reps: 10, isWarmup: false },
      { loadKg: 32.5, reps: 8, isWarmup: false },
    ];
    const rows = [
      { exerciseId: "bb-row", isWarmup: false },
      { exerciseId: "db-row", isWarmup: false },
      { exerciseId: "db-row", isWarmup: false },
    ];
    expect(alignPrevious(rows, (id) => (id === "bb-row" ? barbell : dumbbell))).toEqual([
      barbell[0],
      dumbbell[0],
      dumbbell[1],
    ]);
  });
});

describe("fillFromLastSession (prefill rule 4)", () => {
  const row = (over: Partial<PlannedRow> = {}): PlannedRow => ({
    exerciseId: "squat",
    clientSetId: `r${Math.random()}`,
    loadKg: null,
    reps: null,
    rpe: null,
    isWarmup: false,
    planned: false,
    ...over,
  });
  const last = [
    { loadKg: 60, reps: 5, isWarmup: true },
    { loadKg: 140, reps: 5, isWarmup: false },
    { loadKg: 145, reps: 3, isWarmup: false },
  ];

  it("fills a blank row from the working set it lines up with", () => {
    const [first, second] = fillFromLastSession([row(), row()], "squat", last, 0);
    expect(first).toMatchObject({ loadKg: 140, reps: 5 });
    expect(second).toMatchObject({ loadKg: 145, reps: 3 });
    // As if the app supplied it, not the athlete: it is still theirs to change.
    expect(first.touched).toBeUndefined();
  });

  it("counts the working sets already logged today", () => {
    const [only] = fillFromLastSession([row()], "squat", last, 1);
    expect(only).toMatchObject({ loadKg: 145, reps: 3 });
  });

  it("repeats last time's final working set when today goes further", () => {
    const [only] = fillFromLastSession([row()], "squat", last, 5);
    expect(only).toMatchObject({ loadKg: 145, reps: 3 });
  });

  it("never touches a typed, prescribed, warm-up or already-filled row", () => {
    const rows = [
      row({ touched: true }),
      row({ prescriptionId: "line" }),
      row({ isWarmup: true }),
      row({ loadKg: 100, reps: null }),
      row({ loadKg: null, reps: 8 }),
    ];
    expect(fillFromLastSession(rows, "squat", last, 0)).toBe(rows);
  });

  it("leaves other exercises alone, and returns the same list when there is nothing to do", () => {
    const rows = [row({ exerciseId: "bench" })];
    expect(fillFromLastSession(rows, "squat", last, 0)).toBe(rows);
    expect(fillFromLastSession([row()], "squat", [{ loadKg: 60, reps: 5, isWarmup: true }], 0)[0].loadKg).toBeNull();
  });

  it("skips warm-up rows when counting working positions", () => {
    const [warm, work] = fillFromLastSession([row({ isWarmup: true }), row()], "squat", last, 0);
    expect(warm.loadKg).toBeNull();
    expect(work).toMatchObject({ loadKg: 140, reps: 5 });
  });
});
