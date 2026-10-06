import { computeProgramSignals, prescribedRpe, type SignalInputs } from "./program-signals";
import type { Program, ProgramDay, ProgramWeek } from "@/lib/programming/program";

// Wednesday 7 Oct 2026; the week started Monday the 5th.
const TODAY = "2026-10-07";

const program = (over: Partial<Program> = {}): Program => ({
  id: "p1",
  coachId: "ruairi",
  athleteId: "joey",
  name: "Block",
  status: "published",
  startOn: "2026-09-28",
  notes: null,
  templateId: null,
  createdAt: "",
  updatedAt: "2026-09-27T00:00:00Z",
  ...over,
});
const week = (id: string, position: number, over: Partial<ProgramWeek> = {}): ProgramWeek => ({
  id,
  programId: "p1",
  blockId: "b1",
  position,
  label: null,
  status: "published",
  notes: null,
  ...over,
});
const day = (id: string, weekId: string, scheduledOn: string): ProgramDay => ({
  id,
  programId: "p1",
  blockId: "b1",
  weekId,
  position: 0,
  label: null,
  scheduledOn,
  notes: null,
});

const inputs = (over: Partial<SignalInputs> = {}): SignalInputs => ({
  programs: [program()],
  weeks: [week("w1", 0), week("w2", 1), week("w3", 2)],
  days: [
    day("d1", "w1", "2026-09-28"),
    day("d2", "w2", "2026-10-05"),
    day("d3", "w2", "2026-10-06"),
    day("d4", "w2", "2026-10-08"),
    day("d5", "w3", "2026-10-12"),
  ],
  sessions: [{ athleteId: "joey", programDayId: "d2" }],
  maxedSets: [],
  lineLoads: new Map(),
  ...over,
});

const signals = (over: Partial<SignalInputs> = {}, today = TODAY) =>
  computeProgramSignals(["joey"], inputs(over), today).get("joey");

describe("the Block column", () => {
  it("names the week the athlete is in, out of the published weeks", () => {
    expect(signals()?.blockLabel).toBe("Week 2 of 3");
  });

  it("says when a block has not started, and when it is over", () => {
    expect(signals({}, "2026-09-20")?.blockLabel).toBe("Starts 28 Sept");
    expect(signals({}, "2026-10-20")?.blockLabel).toBe("Block finished");
  });

  it("ignores drafts, and athletes with no published program", () => {
    expect(signals({ weeks: [week("w1", 0), week("w2", 1), week("w3", 2, { status: "draft" })] })?.blockLabel).toBe(
      "Week 2 of 2",
    );
    expect(signals({ programs: [program({ status: "draft" })] })).toBeUndefined();
  });

  it("follows the most recently updated program when two are published", () => {
    const newer = program({ id: "p2", updatedAt: "2026-10-01T00:00:00Z" });
    expect(signals({ programs: [program(), newer] })?.blockLabel).toBeNull();
  });
});

describe("missed sessions", () => {
  it("counts this week's past days nobody started, not today's or last week's", () => {
    // d2 was started, d3 (yesterday) was not; d1 is last week; d4 is tomorrow.
    expect(signals()?.missedSessions).toBe(1);
  });
});

describe("an RPE 10 nobody prescribed", () => {
  const set = (prescriptionId: string) => ({ id: `s-${prescriptionId}`, athleteId: "joey", loggedAt: "2026-10-06T10:00:00Z", prescriptionId });

  it("fires for a line that asked for less, by RPE or by cap", () => {
    const lineLoads = new Map([
      ["rpe8", "@8"],
      ["cap", "75% @9"],
      ["ten", "@10"],
      ["fixed", "140"],
    ]);
    const maxes = signals({ maxedSets: ["rpe8", "cap", "ten", "fixed"].map(set), lineLoads })?.unpromptedMaxes;
    expect(maxes?.map((m) => [m.setId, m.prescribedRpe])).toEqual([
      ["s-rpe8", 8],
      ["s-cap", 9],
    ]);
  });

  it("still reports for an athlete whose program has since been archived", () => {
    const result = signals({ programs: [], maxedSets: [set("rpe8")], lineLoads: new Map([["rpe8", "@8"]]) });
    expect(result).toMatchObject({ blockLabel: null, missedSessions: 0 });
    expect(result?.unpromptedMaxes).toHaveLength(1);
  });

  it("reads the RPE from the load cell as typed", () => {
    expect(prescribedRpe("rpe 8.5")).toBe(8.5);
    expect(prescribedRpe("75%")).toBeNull();
    expect(prescribedRpe(null)).toBeNull();
  });
});
