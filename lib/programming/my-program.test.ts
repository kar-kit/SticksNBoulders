import {
  blockProgress,
  currentWeekId,
  dayStates,
  isVisibleWeek,
  livePrograms,
  sessionsCoverFrom,
  visibleProgram,
} from "./my-program";
import { localDay, type Prescription, type Program, type ProgramDay, type ProgramWeek } from "./program";
import type { SessionRecord } from "@/lib/logging/session";

const program = (over: Partial<Program> = {}): Program => ({
  id: "p1",
  coachId: "ruairi",
  athleteId: "joey",
  name: "Block 1",
  status: "published",
  startOn: null,
  notes: null,
  templateId: null,
  createdAt: "2026-09-20T00:00:00.000Z",
  updatedAt: "2026-09-20T00:00:00.000Z",
  ...over,
});
const block = { id: "b1", programId: "p1", position: 0, name: "Volume", notes: null };
const week = (id: string, position: number, status: ProgramWeek["status"] = "published"): ProgramWeek => ({
  id,
  programId: "p1",
  blockId: "b1",
  position,
  label: null,
  status,
  notes: null,
});
const day = (id: string, weekId: string, scheduledOn: string | null, position = 0): ProgramDay => ({
  id,
  programId: "p1",
  blockId: "b1",
  weekId,
  position,
  label: null,
  scheduledOn,
  notes: null,
});
const line = (id: string, dayId: string, weekId: string): Prescription => ({
  id,
  programId: "p1",
  weekId,
  dayId,
  exerciseId: "squat",
  position: 0,
  setCount: 3,
  reps: 5,
  repMax: null,
  load: "75%",
  loadKind: "percent",
  restSeconds: null,
  notes: null,
  updatedAt: "",
});
const session = (over: Partial<SessionRecord>): SessionRecord => ({
  id: "s1",
  clientSessionId: "c1",
  startedAt: new Date("2026-10-01T09:00:00Z"),
  finishedAt: new Date("2026-10-01T10:00:00Z"),
  setCount: 3,
  tonnageKg: 1000,
  ...over,
});

const rows = {
  blocks: [block],
  weeks: [week("w1", 0), week("w2", 1, "draft")],
  days: [day("d1", "w1", "2026-10-01"), day("d2", "w2", "2026-10-08")],
  prescriptions: [line("l1", "d1", "w1"), line("l2", "d2", "w2")],
};

describe("draft visibility", () => {
  it("drops a draft week with its days and lines, whatever rows it is handed", () => {
    const tree = visibleProgram(program(), rows)!;
    const weeks = tree.blocks.flatMap((b) => b.weeks);
    expect(weeks.map((w) => w.id)).toEqual(["w1"]);
    expect(JSON.stringify(tree)).not.toContain("d2");
    expect(JSON.stringify(tree)).not.toContain("l2");
  });

  it("shows nothing for a draft or archived program", () => {
    expect(visibleProgram(program({ status: "draft" }), rows)).toBeNull();
    expect(visibleProgram(program({ status: "archived" }), rows)).toBeNull();
    expect(livePrograms([program({ status: "draft" }), program({ id: "p2", status: "archived" })], "joey")).toEqual([]);
  });

  it("is null, not an empty block, when every week is a draft", () => {
    expect(visibleProgram(program(), { ...rows, weeks: [week("w1", 0, "draft")] })).toBeNull();
  });

  it("never shows a template or another athlete's program", () => {
    const list = [program({ athleteId: null }), program({ id: "p2", athleteId: "someone" }), program({ id: "p3" })];
    expect(livePrograms(list, "joey").map((p) => p.id)).toEqual(["p3"]);
  });

  it("prefers the most recently updated published program", () => {
    const list = [program({ id: "old" }), program({ id: "new", updatedAt: "2026-10-01T00:00:00.000Z" })];
    expect(livePrograms(list, "joey")[0].id).toBe("new");
  });

  it("rejects a week belonging to another program", () => {
    expect(isVisibleWeek(program(), { ...week("w9", 0), programId: "other" })).toBe(false);
  });
});

describe("day state", () => {
  const tree = visibleProgram(program(), {
    ...rows,
    weeks: [week("w1", 0)],
    days: [
      day("past", "w1", "2026-09-28", 0),
      day("logged", "w1", "2026-09-29", 1),
      day("now", "w1", "2026-10-02", 2),
      day("later", "w1", "2026-10-05", 3),
      day("undated", "w1", null, 4),
    ],
    prescriptions: [],
  })!;
  const today = "2026-10-02";

  it("marks done, today, upcoming and missed", () => {
    const states = dayStates(tree, [session({ id: "sx", programDayId: "logged" })], today, null);
    expect(states.get("logged")).toEqual({ kind: "done", sessionId: "sx" });
    expect(states.get("past")).toEqual({ kind: "missed" });
    expect(states.get("now")).toEqual({ kind: "today" });
    expect(states.get("later")).toEqual({ kind: "upcoming" });
    expect(states.get("undated")).toEqual({ kind: "upcoming" });
  });

  it("treats a running session as in progress, not done", () => {
    const states = dayStates(tree, [session({ programDayId: "now", finishedAt: null })], today, null);
    expect(states.get("now")).toEqual({ kind: "active" });
  });

  it("does not call a day missed when the loaded sessions do not reach back to it", () => {
    const states = dayStates(tree, [], today, "2026-09-30");
    expect(states.get("past")).toEqual({ kind: "earlier" });
    expect(states.get("logged")).toEqual({ kind: "earlier" });
  });

  it("links the latest finished session when a day was logged twice", () => {
    const states = dayStates(
      tree,
      [
        session({ id: "first", programDayId: "logged" }),
        session({ id: "second", programDayId: "logged", startedAt: new Date("2026-10-02T09:00:00Z") }),
      ],
      today,
      null,
    );
    expect(states.get("logged")).toEqual({ kind: "done", sessionId: "second" });
  });

  it("only knows the cap was hit when it was", () => {
    const sessions = [session({}), session({ startedAt: new Date("2026-09-20T09:00:00Z") })];
    expect(sessionsCoverFrom(sessions, 3, localDay)).toBeNull();
    expect(sessionsCoverFrom(sessions, 2, localDay)).toBe("2026-09-20");
  });
});

describe("current week and block progress", () => {
  const tree = visibleProgram(program(), {
    blocks: [block],
    weeks: [week("w1", 0), week("w2", 1), week("w3", 2)],
    days: [day("a", "w1", "2026-09-28"), day("b", "w2", "2026-10-05"), day("c", "w3", "2026-10-12")],
    prescriptions: [],
  })!;

  it("opens the week containing today, else the next one, else the last", () => {
    expect(currentWeekId(tree, "2026-10-05")).toBe("w2");
    expect(currentWeekId(tree, "2026-10-02")).toBe("w2");
    expect(currentWeekId(tree, "2026-12-01")).toBe("w3");
    expect(currentWeekId(tree, "2026-01-01")).toBe("w1");
  });

  it("finishes only when every day is dated and past", () => {
    const states = dayStates(tree, [session({ programDayId: "a" })], "2026-11-01", null);
    expect(blockProgress(tree, states, "2026-11-01")).toEqual({ total: 3, done: 1, finished: true });
    expect(blockProgress(tree, states, "2026-10-05").finished).toBe(false);
  });
});
