import {
  elapsedMs,
  formatElapsed,
  groupByExercise,
  isLive,
  lastFinishedSession,
  lastSessionLabel,
  pickActiveSession,
  sessionDateLabel,
  summariseSession,
  type SessionRecord,
  type SessionSet,
} from "./session";

const session = (overrides: Partial<SessionRecord> = {}): SessionRecord => ({
  id: "s1",
  clientSessionId: "c1",
  startedAt: new Date("2026-09-14T09:00:00Z"),
  finishedAt: null,
  setCount: 0,
  tonnageKg: 0,
  ...overrides,
});

const set = (overrides: Partial<SessionSet> = {}): SessionSet => ({
  exerciseId: "squat",
  exerciseName: "Squat",
  loadKg: 142.5,
  reps: 5,
  isWarmup: false,
  loggedAt: new Date("2026-09-14T09:10:00Z"),
  ...overrides,
});

describe("finding the session to resume", () => {
  it("returns nothing when every session is finished", () => {
    expect(pickActiveSession([session({ finishedAt: new Date() })])).toBeNull();
  });

  it("returns the live one", () => {
    const live = session({ id: "live" });
    expect(pickActiveSession([session({ id: "done", finishedAt: new Date() }), live])?.id).toBe("live");
  });

  it("picks the most recently started when more than one is live", () => {
    // A crashed tab, a second device, a finish write that failed after the sets
    // landed. The offline queue at Order 9 makes this more likely, not less.
    const older = session({ id: "older", startedAt: new Date("2026-09-14T07:00:00Z") });
    const newer = session({ id: "newer", startedAt: new Date("2026-09-14T09:00:00Z") });
    expect(pickActiveSession([older, newer])?.id).toBe("newer");
    expect(pickActiveSession([newer, older])?.id).toBe("newer");
  });

  it("leaves the stray sessions alone rather than closing them", () => {
    // Silently finishing somebody's session is worse than a stray row that
    // History can show. Nothing here mutates its input.
    const sessions = [session({ id: "a" }), session({ id: "b", startedAt: new Date("2026-09-14T10:00:00Z") })];
    const snapshot = JSON.stringify(sessions);
    pickActiveSession(sessions);
    expect(JSON.stringify(sessions)).toBe(snapshot);
  });

  it("knows a session is live from finished_at alone", () => {
    expect(isLive(session())).toBe(true);
    expect(isLive(session({ finishedAt: new Date() }))).toBe(false);
  });
});

describe("the last session line on Today", () => {
  it("is the most recent finished one, never a live one", () => {
    const live = session({ id: "live", startedAt: new Date("2026-09-14T09:00:00Z") });
    const done = session({ id: "done", startedAt: new Date("2026-09-12T09:00:00Z"), finishedAt: new Date() });
    expect(lastFinishedSession([live, done])?.id).toBe("done");
  });

  it("names the day and the first exercise", () => {
    const done = session({ startedAt: new Date("2026-09-10T09:00:00Z"), finishedAt: new Date() });
    expect(lastSessionLabel(done, "Deadlift")).toBe("Thu, Deadlift");
  });

  it("says the day alone when the session held no exercises", () => {
    const done = session({ startedAt: new Date("2026-09-10T09:00:00Z"), finishedAt: new Date() });
    expect(lastSessionLabel(done, null)).toBe("Thu");
  });
});

describe("the elapsed clock", () => {
  it("is derived from when the session started, not from a tick count", () => {
    // A backgrounded phone stops an interval and the world keeps going. An
    // athlete who takes a call must not come back to a clock that lost it.
    const startedAt = new Date("2026-09-14T09:00:00Z");
    const muchLater = new Date("2026-09-14T09:47:12Z");
    expect(formatElapsed(elapsedMs(startedAt, muchLater))).toBe("0:47:12");
  });

  it("never runs backwards when a device clock disagrees", () => {
    const startedAt = new Date("2026-09-14T09:00:00Z");
    expect(elapsedMs(startedAt, new Date("2026-09-14T08:00:00Z"))).toBe(0);
  });

  it("formats past an hour", () => {
    expect(formatElapsed(3 * 3600_000 + 5 * 60_000 + 9_000)).toBe("3:05:09");
    expect(formatElapsed(0)).toBe("0:00:00");
  });
});

describe("grouping a session into exercises", () => {
  it("orders exercises by when work first landed on them", () => {
    const sets = [
      set({ exerciseId: "bench", exerciseName: "Bench Press", loggedAt: new Date("2026-09-14T09:40:00Z") }),
      set({ exerciseId: "squat", exerciseName: "Squat", loggedAt: new Date("2026-09-14T09:10:00Z") }),
      set({ exerciseId: "squat", exerciseName: "Squat", loggedAt: new Date("2026-09-14T09:15:00Z") }),
    ];
    const groups = groupByExercise(sets);
    expect(groups.map((g) => g.exerciseName)).toEqual(["Squat", "Bench Press"]);
    expect(groups[0].sets).toHaveLength(2);
  });

  it("keeps sets within an exercise in the order they were logged", () => {
    const sets = [
      set({ loadKg: 150, loggedAt: new Date("2026-09-14T09:20:00Z") }),
      set({ loadKg: 140, loggedAt: new Date("2026-09-14T09:10:00Z") }),
    ];
    expect(groupByExercise(sets)[0].sets.map((s) => s.loadKg)).toEqual([140, 150]);
  });

  it("returns nothing for a session with no sets", () => {
    expect(groupByExercise([])).toEqual([]);
  });
});

describe("what finishing writes", () => {
  it("counts working sets and their tonnage", () => {
    const summary = summariseSession([
      set({ loadKg: 100, reps: 5 }),
      set({ loadKg: 142.5, reps: 5 }),
    ]);
    expect(summary.setCount).toBe(2);
    expect(summary.tonnageKg).toBe(1212.5);
  });

  it("excludes warm-ups, so the session total agrees with the weekly rollup", () => {
    const summary = summariseSession([
      set({ loadKg: 60, reps: 5, isWarmup: true }),
      set({ loadKg: 142.5, reps: 5 }),
    ]);
    expect(summary.setCount).toBe(1);
    expect(summary.tonnageKg).toBe(712.5);
    expect(summary.warmupCount).toBe(1);
  });

  it("counts exercises including ones that were only warmed up", () => {
    const summary = summariseSession([
      set({ exerciseId: "squat" }),
      set({ exerciseId: "bench", isWarmup: true }),
    ]);
    expect(summary.exerciseCount).toBe(2);
  });

  it("reports zeroes for an empty session rather than refusing to finish", () => {
    // An athlete who starts a session and walks out must still be able to end
    // it. This is also every session until Order 8 lands set logging.
    expect(summariseSession([])).toEqual({
      setCount: 0,
      tonnageKg: 0,
      exerciseCount: 0,
      warmupCount: 0,
    });
  });
});

describe("the date header", () => {
  it("reads as the blueprint writes it", () => {
    expect(sessionDateLabel(new Date("2026-09-13T09:00:00Z"))).toBe("Sunday 13 Sep");
  });
});
