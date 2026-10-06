import {
  bestEstimates,
  decideAthleteAccess,
  exerciseBlocks,
  liftTabs,
  maxGrid,
  maxSource,
  parseKg,
  shortDate,
  UNKNOWN_LIFT,
  videoRows,
  type CoachLinkRow,
  type RollupWeek,
} from "./athlete-view";
import type { Exercise } from "@/lib/exercises/match";
import type { ReferenceMaxEntry } from "@/lib/strength/reference-max";
import type { ClipSet } from "@/lib/review/queue";
import type { Comment } from "@/lib/review/comments";

const COACH = "coach_ruairi";
const ATHLETE = "athlete_joey";

const link = (over: Partial<CoachLinkRow> = {}): CoachLinkRow => ({
  coachId: COACH,
  athleteId: ATHLETE,
  status: "active",
  linkedAt: "2026-09-02T10:00:00.000Z",
  revokedAt: null,
  ...over,
});

describe("who may see an athlete", () => {
  it("shows a linked athlete, with the date they linked", () => {
    const access = decideAthleteAccess(COACH, ATHLETE, [link()]);
    expect(access.kind).toBe("linked");
    expect(access.kind === "linked" && access.linkedAt?.toISOString()).toBe("2026-09-02T10:00:00.000Z");
  });

  it("treats a revoked link as its own state, not as an error", () => {
    const access = decideAthleteAccess(COACH, ATHLETE, [
      link({ status: "revoked", revokedAt: "2026-09-20T08:00:00.000Z" }),
    ]);
    expect(access).toEqual({ kind: "revoked", revokedAt: new Date("2026-09-20T08:00:00.000Z") });
  });

  it("says not linked when there is no row at all", () => {
    expect(decideAthleteAccess(COACH, ATHLETE, [])).toEqual({ kind: "not-linked" });
  });

  it("fails closed on a row belonging to a different coach or athlete", () => {
    // The query should never return these. If it ever does, this is the line
    // that stops somebody else's athlete appearing on the screen.
    expect(decideAthleteAccess(COACH, ATHLETE, [link({ coachId: "coach_louis" })])).toEqual({
      kind: "not-linked",
    });
    expect(decideAthleteAccess(COACH, ATHLETE, [link({ athleteId: "athlete_sam" })])).toEqual({
      kind: "not-linked",
    });
  });

  it("lets an active row win over a revoked one", () => {
    const access = decideAthleteAccess(COACH, ATHLETE, [
      link({ status: "revoked", revokedAt: "2026-09-10T00:00:00.000Z" }),
      link(),
    ]);
    expect(access.kind).toBe("linked");
  });

  it("does not treat a coach as linked to themselves", () => {
    expect(decideAthleteAccess(COACH, COACH, [link({ athleteId: COACH })])).toEqual({ kind: "not-linked" });
  });

  it("refuses when either id is missing", () => {
    expect(decideAthleteAccess("", ATHLETE, [link()]).kind).toBe("not-linked");
    expect(decideAthleteAccess(COACH, "", [link()]).kind).toBe("not-linked");
  });

  it("survives an unreadable date without granting anything extra", () => {
    const access = decideAthleteAccess(COACH, ATHLETE, [link({ linkedAt: "not a date" })]);
    expect(access).toEqual({ kind: "linked", linkedAt: null });
  });
});

const exercise = (id: string, name: string, isGlobal = true): Exercise => ({
  id,
  name,
  normalisedName: name.toLowerCase(),
  isGlobal,
  ownerId: isGlobal ? null : ATHLETE,
});

const SQUAT = exercise("ex-squat", "Squat");
const BENCH = exercise("ex-bench", "Bench Press");
const DEADLIFT = exercise("ex-dead", "Deadlift");
const PAUSE = exercise("ex-pause", "Pause Squat");
const ROW = exercise("ex-row", "Barbell Row");
const MY_SQUAT = exercise("ex-mysquat", "Squat", false);
const LIBRARY = [SQUAT, BENCH, DEADLIFT, PAUSE, ROW, MY_SQUAT];

const week = (exerciseId: string, iso: string, e1rm: number | null = 100): RollupWeek => ({
  exerciseId,
  weekStart: new Date(iso),
  bestE1rmKg: e1rm,
  bestSingleKg: null,
  bestSingleReps: null,
  bestReps: null,
  bestRepsLoadKg: null,
});

describe("lift tabs", () => {
  it("puts the competition lifts first, in competition order", () => {
    const tabs = liftTabs(
      [
        week(DEADLIFT.id, "2026-09-07T00:00:00Z"),
        week(ROW.id, "2026-09-14T00:00:00Z"),
        week(SQUAT.id, "2026-08-31T00:00:00Z"),
        week(BENCH.id, "2026-09-07T00:00:00Z"),
      ],
      LIBRARY,
    );
    expect(tabs.map((t) => t.name)).toEqual(["Squat", "Bench Press", "Deadlift", "Barbell Row"]);
    expect(tabs.slice(0, 3).every((t) => t.isCompetition)).toBe(true);
  });

  it("orders everything else by most recently trained", () => {
    const tabs = liftTabs(
      [week(ROW.id, "2026-08-03T00:00:00Z"), week(PAUSE.id, "2026-09-14T00:00:00Z")],
      LIBRARY,
    );
    expect(tabs.map((t) => t.name)).toEqual(["Pause Squat", "Barbell Row"]);
  });

  it("does not promote a variation or a hand-typed Squat to a competition lift", () => {
    const tabs = liftTabs(
      [week(MY_SQUAT.id, "2026-09-14T00:00:00Z"), week(PAUSE.id, "2026-09-14T00:00:00Z")],
      LIBRARY,
    );
    expect(tabs.every((t) => !t.isCompetition)).toBe(true);
  });

  it("groups a lift's weeks together, oldest first", () => {
    const [tab] = liftTabs(
      [week(SQUAT.id, "2026-09-14T00:00:00Z", 190), week(SQUAT.id, "2026-08-31T00:00:00Z", 180)],
      LIBRARY,
    );
    expect(tab.weeks.map((w) => w.bestE1rmKg)).toEqual([180, 190]);
    expect(tab.lastTrained.toISOString()).toBe("2026-09-14T00:00:00.000Z");
  });

  it("keeps a lift the library does not know, under a placeholder name", () => {
    const [tab] = liftTabs([week("ex-gone", "2026-09-14T00:00:00Z")], LIBRARY);
    expect(tab.name).toBe(UNKNOWN_LIFT);
  });

  it("is empty for an athlete with no rollups", () => {
    expect(liftTabs([], LIBRARY)).toEqual([]);
  });
});

describe("best estimates", () => {
  it("takes the best week, not the latest -- a deload does not lower a max", () => {
    const best = bestEstimates([
      week(SQUAT.id, "2026-08-31T00:00:00Z", 200),
      week(SQUAT.id, "2026-09-07T00:00:00Z", 185),
    ]);
    expect(best.get(SQUAT.id)).toEqual({ valueKg: 200, asOf: "2026-08-31T00:00:00.000Z" });
  });

  it("ignores weeks with no estimate", () => {
    expect(bestEstimates([week(SQUAT.id, "2026-08-31T00:00:00Z", null)]).size).toBe(0);
  });
});

const NOW = new Date("2026-09-27T12:00:00Z");

const entry = (over: Partial<ReferenceMaxEntry> = {}): ReferenceMaxEntry => ({
  id: "m1",
  exerciseId: SQUAT.id,
  kind: "training",
  valueKg: 180,
  effectiveFrom: "2026-09-01T00:00:00.000Z",
  recordedBy: COACH,
  ...over,
});

describe("the current maxes grid", () => {
  it("always has squat, bench and deadlift, so there is somewhere to type the first max", () => {
    const rows = maxGrid([], LIBRARY, new Map(), NOW);
    expect(rows.map((r) => r.exerciseName)).toEqual(["Squat", "Bench Press", "Deadlift"]);
    expect(rows.every((r) => r.usedForPercent === null)).toBe(true);
  });

  it("shows all three kinds side by side", () => {
    const rows = maxGrid(
      [entry({ id: "t", kind: "tested", valueKg: 200 }), entry({ id: "tm", kind: "training", valueKg: 180 })],
      LIBRARY,
      new Map([[SQUAT.id, { valueKg: 196, asOf: "2026-09-14T00:00:00.000Z" }]]),
      NOW,
    );
    const squat = rows[0];
    expect(squat.tested?.valueKg).toBe(200);
    expect(squat.training?.valueKg).toBe(180);
    expect(squat.estimated?.valueKg).toBe(196);
  });

  it("marks the training max as what percentages use, when there is one", () => {
    const rows = maxGrid(
      [entry({ id: "t", kind: "tested", valueKg: 200 }), entry()],
      LIBRARY,
      new Map(),
      NOW,
    );
    expect(rows[0].usedForPercent).toBe("training");
  });

  it("falls back to tested, then the estimate", () => {
    const tested = maxGrid([entry({ kind: "tested" })], LIBRARY, new Map(), NOW);
    expect(tested[0].usedForPercent).toBe("tested");
    const estimated = maxGrid([], LIBRARY, new Map([[SQUAT.id, { valueKg: 190, asOf: "2026-09-14" }]]), NOW);
    expect(estimated[0].usedForPercent).toBe("estimated");
  });

  it("adds any other lift once it has a number, and not before", () => {
    const rows = maxGrid(
      [entry({ exerciseId: PAUSE.id })],
      LIBRARY,
      new Map([[ROW.id, { valueKg: 120, asOf: "2026-09-14" }]]),
      NOW,
    );
    expect(rows.map((r) => r.exerciseName)).toEqual(["Squat", "Bench Press", "Deadlift", "Pause Squat", "Barbell Row"]);
  });

  it("keeps a future-dated max out of the current number but on the panel", () => {
    const rows = maxGrid(
      [entry(), entry({ id: "next", valueKg: 187.5, effectiveFrom: "2026-10-05T00:00:00.000Z" })],
      LIBRARY,
      new Map(),
      NOW,
    );
    expect(rows[0].training?.valueKg).toBe(180);
    expect(rows[0].upcoming.training?.valueKg).toBe(187.5);
    expect(rows[0].upcoming.tested).toBeNull();
  });

  it("does not use a hand-typed Squat as the competition squat", () => {
    const rows = maxGrid([], [MY_SQUAT, BENCH, DEADLIFT], new Map(), NOW);
    expect(rows.map((r) => r.exerciseName)).toEqual(["Bench Press", "Deadlift"]);
  });
});

describe("where a max came from", () => {
  const entries = [entry({ id: "mine" }), entry({ id: "theirs", recordedBy: ATHLETE }), entry({ id: "louis", recordedBy: "coach_louis" })];
  const max = (entryId: string) => ({ kind: "training" as const, valueKg: 180, asOf: "", entryId });

  it("names the coach reading it as 'you'", () => {
    expect(maxSource(max("mine"), entries, COACH, ATHLETE)).toBe("set by you");
  });
  it("names the athlete", () => {
    expect(maxSource(max("theirs"), entries, COACH, ATHLETE)).toBe("set by them");
  });
  it("names somebody else without naming them", () => {
    expect(maxSource(max("louis"), entries, COACH, ATHLETE)).toBe("set by a coach");
  });
  it("labels an estimate by where it comes from", () => {
    expect(maxSource({ kind: "estimated", valueKg: 1, asOf: "" }, entries, COACH, ATHLETE)).toBe("from logged sets");
  });
});

describe("reading a typed max", () => {
  it.each([
    ["182.5", 182.5],
    ["182,5", 182.5],
    ["182.5kg", 182.5],
    ["  200 kg ", 200],
    ["200kgs", 200],
  ])("reads %j as %d", (raw, expected) => {
    expect(parseKg(raw)).toBe(expected);
  });

  it.each(["", "abc", "-5", "0", "1e3", "180.5.5", "75%"])("refuses %j rather than guessing", (raw) => {
    expect(parseKg(raw)).toBeNull();
  });
});

describe("a session's sets, grouped", () => {
  it("groups by exercise in the order worked, and names each one", () => {
    const blocks = exerciseBlocks(
      [
        { exerciseId: SQUAT.id, loadKg: 60, reps: 5, rpe: null, isWarmup: true },
        { exerciseId: SQUAT.id, loadKg: 180, reps: 3, rpe: 8, isWarmup: false },
        { exerciseId: BENCH.id, loadKg: 120, reps: 5, rpe: 7.5, isWarmup: false },
      ],
      (id) => LIBRARY.find((e) => e.id === id)?.name,
    );
    expect(blocks.map((b) => [b.exerciseName, b.sets.length])).toEqual([
      ["Squat", 2],
      ["Bench Press", 1],
    ]);
    expect(blocks[0].sets[0].isWarmup).toBe(true);
  });

  it("keeps a set whose exercise has no name", () => {
    const [block] = exerciseBlocks([{ exerciseId: "x", loadKg: 1, reps: 1, rpe: null, isWarmup: false }], () => undefined);
    expect(block.exerciseName).toBe(UNKNOWN_LIFT);
  });
});

const clip = (id: string, loggedAt: string): ClipSet => ({
  id,
  athleteId: ATHLETE,
  exerciseId: SQUAT.id,
  sessionId: "s1",
  setIndex: 0,
  loadKg: 180,
  reps: 3,
  rpe: 8,
  e1rmKg: 196,
  loggedAt,
  videoFileId: `file-${id}`,
  notes: null,
});

const comment = (setId: string): Comment => ({
  id: `c-${Math.random()}`,
  setId,
  athleteId: ATHLETE,
  authorId: COACH,
  body: "Knees out",
  parentId: null,
  createdAt: "2026-09-20T00:00:00Z",
});

describe("the athlete's videos", () => {
  it("lists newest first, which is the reverse of the queue", () => {
    const rows = videoRows(
      [clip("old", "2026-09-01T00:00:00Z"), clip("new", "2026-09-20T00:00:00Z")],
      new Set(),
      [],
      () => "Squat",
    );
    expect(rows.map((r) => r.id)).toEqual(["new", "old"]);
  });

  it("says which ones this coach has reviewed and how many comments each has", () => {
    const rows = videoRows(
      [clip("a", "2026-09-01T00:00:00Z"), clip("b", "2026-09-02T00:00:00Z")],
      new Set(["a"]),
      [comment("a"), comment("a"), comment("b")],
      () => "Squat",
    );
    const a = rows.find((r) => r.id === "a")!;
    const b = rows.find((r) => r.id === "b")!;
    expect([a.reviewed, a.commentCount]).toEqual([true, 2]);
    expect([b.reviewed, b.commentCount]).toEqual([false, 1]);
  });

  it("names an exercise the library missed rather than dropping the clip", () => {
    const [row] = videoRows([clip("a", "2026-09-01T00:00:00Z")], new Set(), [], () => undefined);
    expect(row.exerciseName).toBe(UNKNOWN_LIFT);
  });
});

describe("short dates", () => {
  it("drops the year inside the current year", () => {
    expect(shortDate(new Date(2026, 8, 12), NOW)).toBe("12 Sep");
  });
  it("keeps it otherwise", () => {
    expect(shortDate(new Date(2025, 11, 1), NOW)).toBe("1 Dec 2025");
  });
  it("is empty for nothing", () => {
    expect(shortDate(null, NOW)).toBe("");
  });
});
