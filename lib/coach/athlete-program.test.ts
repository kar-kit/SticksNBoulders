import { glanceDate, programToShow, weekGlance } from "./athlete-program";
import {
  assembleProgram,
  type Prescription,
  type Program,
  type ProgramDay,
  type ProgramWeek,
} from "@/lib/programming/program";
import type { ReferenceMaxEntry } from "@/lib/strength/reference-max";

const program = (over: Partial<Program> = {}): Program => ({
  id: "p1",
  coachId: "ruairi",
  athleteId: "joey",
  name: "Volume block",
  status: "published",
  startOn: "2026-10-05",
  notes: null,
  templateId: null,
  createdAt: "2026-09-20T00:00:00.000Z",
  updatedAt: "2026-09-20T00:00:00.000Z",
  ...over,
});
const week = (id: string, position: number, status: ProgramWeek["status"] = "published", label: string | null = null): ProgramWeek => ({
  id,
  programId: "p1",
  blockId: "b1",
  position,
  label,
  status,
  notes: null,
});
const day = (id: string, weekId: string, scheduledOn: string | null, position = 0, label: string | null = null): ProgramDay => ({
  id,
  programId: "p1",
  blockId: "b1",
  weekId,
  position,
  label,
  scheduledOn,
  notes: null,
});
const line = (id: string, dayId: string, weekId: string, over: Partial<Prescription> = {}): Prescription => ({
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
  ...over,
});

const training = (valueKg: number): ReferenceMaxEntry => ({
  id: "m1",
  exerciseId: "squat",
  kind: "training",
  valueKg,
  effectiveFrom: "2026-08-01T00:00:00.000Z",
  recordedBy: "ruairi",
});

const tree = (over: Partial<Program> = {}, weeks = [week("w1", 0), week("w2", 1), week("w3", 2, "draft")]) =>
  assembleProgram(program(over), {
    blocks: [{ id: "b1", programId: "p1", position: 0, name: "Volume", notes: null }],
    weeks,
    days: [
      day("d1", "w1", "2026-10-05"),
      day("d2", "w2", "2026-10-12", 0, "Heavy squat"),
      day("d3", "w2", "2026-10-14", 1),
      day("d4", "w3", "2026-10-19"),
    ],
    prescriptions: [
      line("l1", "d1", "w1"),
      line("l2", "d2", "w2", { setCount: 1, load: "@8", loadKind: "rpe" }),
      line("l3", "d2", "w2", { position: 1 }),
      line("l4", "d3", "w2", { exerciseId: "bench", load: "100kg", loadKind: "fixed" }),
      line("l5", "d4", "w3"),
    ],
  });

const names = new Map([
  ["squat", "Squat"],
  ["bench", "Bench Press"],
]);
const NOW = new Date("2026-10-14T12:00:00Z");

const glance = (over: Partial<Parameters<typeof weekGlance>[0]> = {}) =>
  weekGlance({
    tree: tree(),
    today: "2026-10-14",
    maxes: { entries: [training(200)], estimated: new Map() },
    nameOf: (id) => names.get(id),
    logged: new Set(["d2"]),
    asOf: NOW,
    ...over,
  });

describe("which program the panel shows", () => {
  it("shows the live one -- the published program updated last", () => {
    const shown = programToShow(
      [
        program({ id: "old", updatedAt: "2026-09-01T00:00:00Z" }),
        program({ id: "new", updatedAt: "2026-10-01T00:00:00Z" }),
        program({ id: "draft", status: "draft", updatedAt: "2026-10-10T00:00:00Z" }),
      ],
      "joey",
    );
    expect(shown).toEqual({ program: expect.objectContaining({ id: "new" }), live: true });
  });

  it("falls back to the draft touched last, marked as not live", () => {
    const shown = programToShow(
      [
        program({ id: "d-old", status: "draft", updatedAt: "2026-09-01T00:00:00Z" }),
        program({ id: "d-new", status: "draft", updatedAt: "2026-10-01T00:00:00Z" }),
        program({ id: "gone", status: "archived", updatedAt: "2026-10-09T00:00:00Z" }),
      ],
      "joey",
    );
    expect(shown).toEqual({ program: expect.objectContaining({ id: "d-new" }), live: false });
  });

  it("never shows an archived program, or somebody else's", () => {
    expect(programToShow([program({ status: "archived" }), program({ id: "sam", athleteId: "sam" })], "joey")).toBeNull();
  });
});

describe("the current week at a glance", () => {
  it("picks the week containing today and counts it across the block", () => {
    const week = glance()!;
    expect(week.weekId).toBe("w2");
    expect([week.number, week.of]).toEqual([2, 3]);
    expect(week.range).toBe("12–18 Oct");
    expect(week.blockName).toBe("Volume");
  });

  it("lists its days with their exercises and loads resolved, as the athlete's My Program prints them", () => {
    const [heavy, second] = glance()!.days;
    expect(heavy.label).toBe("Heavy squat");
    expect(heavy.exercises).toEqual([{ exerciseId: "squat", name: "Squat", lines: ["1 × 5 · RPE 8", "3 × 5 · 150 kg (75%)"] }]);
    expect(second.label).toBe("Session");
    expect(second.exercises[0]).toMatchObject({ name: "Bench Press", lines: ["3 × 5 · 100 kg"] });
  });

  it("leaves a percentage as a percentage when there is no max to price it", () => {
    const [heavy] = glance({ maxes: { entries: [], estimated: new Map() } })!.days;
    expect(heavy.exercises[0].lines[1]).not.toMatch(/kg/);
    expect(heavy.exercises[0].lines[1]).toMatch(/75%/);
  });

  it("marks the days they started a session from, and today", () => {
    const [heavy, second] = glance()!.days;
    expect([heavy.logged, second.logged]).toEqual([true, false]);
    expect([heavy.isToday, second.isToday]).toEqual([false, true]);
  });

  it("claims nothing about logging when that could not be read", () => {
    expect(glance({ logged: null })!.days.map((d) => d.logged)).toEqual([null, null]);
  });

  it("says whether the athlete can see the week: a draft week, or a draft program, they cannot", () => {
    expect(glance()!.visibleToAthlete).toBe(true);
    expect(glance({ today: "2026-10-20" })).toMatchObject({ weekId: "w3", status: "draft", visibleToAthlete: false });
    expect(glance({ tree: tree({ status: "draft" }) })!.visibleToAthlete).toBe(false);
  });

  it("keeps a coach's own week label only when it says more than the number", () => {
    expect(glance()!.label).toBeNull();
    const labelled = tree({}, [week("w1", 0, "published", "Week 1"), week("w2", 1, "published", "Deload"), week("w3", 2)]);
    expect(glance({ tree: labelled })!.label).toBe("Deload");
    const plain = tree({}, [week("w1", 0), week("w2", 1, "published", "Week 2"), week("w3", 2)]);
    expect(glance({ tree: plain })!.label).toBeNull();
  });

  it("names a lift the library missed rather than dropping it", () => {
    expect(glance({ nameOf: () => undefined })!.days[0].exercises[0].name).toBe("Unknown lift");
  });

  it("is null for a program with no weeks", () => {
    const empty = assembleProgram(program(), { blocks: [], weeks: [], days: [], prescriptions: [] });
    expect(glance({ tree: empty })).toBeNull();
  });
});

describe("day labels", () => {
  it("reads a calendar day as that day, short", () => {
    expect(glanceDate("2026-10-16")).toBe("Fri 16 Oct");
    expect(glanceDate(null)).toBe("Not dated");
  });
});
