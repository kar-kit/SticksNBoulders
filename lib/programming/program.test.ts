import {
  addDays,
  assembleProgram,
  byPosition,
  checkReorder,
  isLiveDay,
  localDay,
  nextPosition,
  parseDay,
  parsePrescriptionRow,
  parseProgram,
  parseRows,
  pickTodaysDay,
  readProgramOp,
  type Program,
  type ProgramDay,
  type ProgramWeek,
} from "./program";

const program = (over: Partial<Program> = {}): Program => ({
  id: "p1",
  coachId: "ruairi",
  athleteId: "joey",
  name: "Block 1",
  status: "published",
  startOn: "2026-09-28",
  notes: null,
  templateId: null,
  createdAt: "2026-09-20T00:00:00.000Z",
  updatedAt: "2026-09-20T00:00:00.000Z",
  ...over,
});
const week = (over: Partial<ProgramWeek> = {}): ProgramWeek => ({
  id: "w1",
  programId: "p1",
  blockId: "b1",
  position: 0,
  label: null,
  status: "published",
  notes: null,
  ...over,
});
const day = (over: Partial<ProgramDay> = {}): ProgramDay => ({
  id: "d1",
  programId: "p1",
  blockId: "b1",
  weekId: "w1",
  position: 0,
  label: "Day 1",
  scheduledOn: "2026-09-28",
  notes: null,
  ...over,
});

describe("validating a program write", () => {
  it("accepts a well-formed op and trims what the coach typed", () => {
    const parsed = readProgramOp({ op: "addPrescription", dayId: "d1", exerciseId: "ex1", setCount: 3, reps: 5, load: "  75% @8 " });
    expect(parsed).toMatchObject({ ok: true, op: { load: "75% @8" } });
  });

  it("treats an empty cell as no load rather than an empty string", () => {
    const parsed = readProgramOp({ op: "addPrescription", dayId: "d1", exerciseId: "ex1", setCount: 3, load: "   " });
    expect(parsed).toMatchObject({ ok: true, op: { load: null } });
  });

  it("keeps anything a coach types in the load cell -- freeform is the escape hatch", () => {
    const parsed = readProgramOp({
      op: "addPrescription",
      dayId: "d1",
      exerciseId: "ex1",
      setCount: 1,
      load: "work up to a heavy single, leave one in the tank",
    });
    expect(parsed.ok).toBe(true);
  });

  it.each([
    [{ op: "addPrescription", dayId: "d1", exerciseId: "ex1", setCount: 0 }, "setCount"],
    [{ op: "addPrescription", dayId: "d1", exerciseId: "ex1", setCount: 3, reps: 10, repMax: 8 }, "repMax"],
    [{ op: "addPrescription", dayId: "d1", exerciseId: "ex1", setCount: 3, repMax: 8 }, "repMax"],
    [{ op: "addDay", weekId: "w1", scheduledOn: "28/09/2026" }, "scheduledOn"],
    [{ op: "addDay", weekId: "w1", scheduledOn: "2026-02-30" }, "scheduledOn"],
    [{ op: "createProgram", athleteId: "joey", name: "   " }, "name"],
    [{ op: "addBlock", programId: "has spaces", name: "x" }, "programId"],
    [{ op: "reorder", level: "days", parentId: "w1", orderedIds: ["a", "a"] }, "orderedIds"],
    [{ op: "reorder", level: "sets", parentId: "w1", orderedIds: ["a"] }, "level"],
  ])("refuses %o, naming %s", (input, field) => {
    const parsed = readProgramOp(input);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason.startsWith(`${field}:`)).toBe(true);
  });

  it("refuses an op it does not know", () => {
    expect(readProgramOp({ op: "deleteEverything" }).ok).toBe(false);
    expect(readProgramOp(null).ok).toBe(false);
  });

  it("drops fields a caller tries to slip in, like the athlete on a day", () => {
    const parsed = readProgramOp({ op: "addDay", weekId: "w1", athleteId: "someone-else" });
    expect(parsed.ok && "athleteId" in parsed.op).toBe(false);
  });
});

describe("reading rows", () => {
  it("turns a stored program row into a value", () => {
    const row = {
      $id: "p1",
      coach_id: "ruairi",
      athlete_id: null,
      name: "Template",
      status: "draft",
      created_at: "2026-09-20T00:00:00.000Z",
      updated_at: "2026-09-21T00:00:00.000Z",
    };
    expect(parseProgram(row)).toMatchObject({ id: "p1", athleteId: null, status: "draft", startOn: null });
  });

  it("skips a row that does not parse instead of inventing values", () => {
    const good = { $id: "d1", program_id: "p1", block_id: "b1", week_id: "w1", position: 0 };
    const bad = { $id: "d2", program_id: "p1", position: "first" };
    expect(parseRows([good, bad], parseDay).map((d) => d.id)).toEqual(["d1"]);
  });

  it("refuses a prescription with no set count, and an unknown load kind", () => {
    const base = {
      $id: "l1",
      program_id: "p1",
      week_id: "w1",
      day_id: "d1",
      exercise_id: "ex1",
      position: 0,
      set_count: 3,
      updated_at: "2026-09-20T00:00:00.000Z",
    };
    expect(parsePrescriptionRow(base)).toMatchObject({ setCount: 3, load: null, loadKind: null });
    expect(parsePrescriptionRow(base)).toMatchObject({ videoRequired: false });
    expect(parsePrescriptionRow({ ...base, video_required: null })).toMatchObject({ videoRequired: false });
    expect(parsePrescriptionRow({ ...base, video_required: true })).toMatchObject({ videoRequired: true });
    expect(parsePrescriptionRow({ ...base, set_count: undefined })).toBeNull();
    expect(parsePrescriptionRow({ ...base, load_kind: "vibes" })).toBeNull();
  });
});

describe("ordering", () => {
  it("sorts by position, breaking ties on id so the order is stable", () => {
    const rows = [
      { id: "b", position: 1 },
      { id: "c", position: 0 },
      { id: "a", position: 1 },
    ];
    expect(byPosition(rows).map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  it("appends one past the highest position, even with gaps", () => {
    expect(nextPosition([])).toBe(0);
    expect(nextPosition([{ position: 0 }, { position: 4 }])).toBe(5);
  });

  it("reports only the moves a reorder needs", () => {
    const existing = [
      { id: "a", position: 0 },
      { id: "b", position: 1 },
      { id: "c", position: 2 },
    ];
    expect(checkReorder(existing, ["a", "c", "b"])).toEqual({
      ok: true,
      moves: [
        { id: "c", position: 1 },
        { id: "b", position: 2 },
      ],
    });
    expect(checkReorder(existing, ["a", "b", "c"])).toEqual({ ok: true, moves: [] });
  });

  it("refuses a reorder that is not exactly the existing rows", () => {
    const existing = [
      { id: "a", position: 0 },
      { id: "b", position: 1 },
    ];
    expect(checkReorder(existing, ["a"]).ok).toBe(false);
    expect(checkReorder(existing, ["a", "b", "z"]).ok).toBe(false);
    expect(checkReorder(existing, ["a", "z"]).ok).toBe(false);
  });
});

describe("assembling a program", () => {
  it("nests flat rows in position order", () => {
    const tree = assembleProgram(program(), {
      blocks: [
        { id: "b2", programId: "p1", position: 1, name: "Peak", notes: null },
        { id: "b1", programId: "p1", position: 0, name: "Volume", notes: null },
      ],
      weeks: [week({ id: "w2", position: 1 }), week()],
      days: [day({ id: "d2", position: 1 }), day()],
      prescriptions: [],
    });
    expect(tree.blocks.map((b) => b.name)).toEqual(["Volume", "Peak"]);
    expect(tree.blocks[0].weeks.map((w) => w.id)).toEqual(["w1", "w2"]);
    expect(tree.blocks[0].weeks[0].days.map((d) => d.id)).toEqual(["d1", "d2"]);
    expect(tree.blocks[1].weeks).toEqual([]);
  });

  it("drops an orphan rather than floating it to the top", () => {
    const tree = assembleProgram(program(), {
      blocks: [{ id: "b1", programId: "p1", position: 0, name: "Volume", notes: null }],
      weeks: [week()],
      days: [day({ id: "lost", weekId: "w-deleted" })],
      prescriptions: [],
    });
    expect(tree.blocks[0].weeks[0].days).toEqual([]);
  });
});

describe("today's day", () => {
  it("is live only when its program and its week are both published", () => {
    expect(isLiveDay(day(), program(), week())).toBe(true);
    expect(isLiveDay(day(), program({ status: "draft" }), week())).toBe(false);
    expect(isLiveDay(day(), program({ status: "archived" }), week())).toBe(false);
    expect(isLiveDay(day(), program(), week({ status: "draft" }))).toBe(false);
    expect(isLiveDay(day(), null, week())).toBe(false);
  });

  it("prefers the program the coach touched last when two overlap", () => {
    const old = program({ id: "old", updatedAt: "2026-09-01T00:00:00.000Z" });
    const fresh = program({ id: "new", updatedAt: "2026-09-25T00:00:00.000Z" });
    const picked = pickTodaysDay(
      [day({ id: "d-old", programId: "old", weekId: "w-old" }), day({ id: "d-new", programId: "new", weekId: "w-new" })],
      new Map([
        ["old", old],
        ["new", fresh],
      ]),
      new Map([
        ["w-old", week({ id: "w-old", programId: "old" })],
        ["w-new", week({ id: "w-new", programId: "new" })],
      ]),
    );
    expect(picked?.id).toBe("d-new");
  });

  it("returns nothing when every candidate is a draft", () => {
    const picked = pickTodaysDay([day()], new Map([["p1", program({ status: "draft" })]]), new Map([["w1", week()]]));
    expect(picked).toBeNull();
  });

  it("reads the athlete's own calendar day, not UTC's", () => {
    const lateEvening = new Date(2026, 8, 27, 23, 30);
    expect(localDay(lateEvening)).toBe("2026-09-27");
  });

  it("moves calendar days across month ends", () => {
    expect(addDays("2026-09-28", 4)).toBe("2026-10-02");
    expect(addDays("2026-10-05", -7)).toBe("2026-09-28");
  });
});
