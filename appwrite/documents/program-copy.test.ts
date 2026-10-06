import { runProgramOp, readProgramTree, type ProgramTables } from "./program-admin";
import { lineContent } from "./program-write";
import { parsePrescription, resolvePrescription } from "@/lib/programming/prescription";
import type { ProgramOpInput } from "@/lib/programming/program";

/**
 * Order 20: duplicate a week, copy a program or block to another athlete.
 * The program-admin harness, trimmed to what copying needs.
 */

const DB = "sticksnboulders";
const COACH = "coach_ruairi";
const JOEY = "athlete_joey";
const ANDREA = "athlete_andrea";
const FORMER = "athlete_former";
const STRANGER = "coach_louis";

type Row = Record<string, unknown> & { $id: string; $permissions?: string[] };

function harness() {
  const db = new Map<string, Map<string, Row>>();
  const tableOf = (id: string) => {
    if (!db.has(id)) db.set(id, new Map());
    return db.get(id)!;
  };
  const writes: Array<{ op: string; tableId: string; rowId: string }> = [];
  let id = 0;

  const link = (athlete: string, status: string) =>
    tableOf("coach_athlete_links").set(`link-${athlete}`, {
      $id: `link-${athlete}`,
      coach_id: COACH,
      athlete_id: athlete,
      status,
    });
  link(JOEY, "active");
  link(ANDREA, "active");
  link(FORMER, "revoked");

  const exercise = (rowId: string, name: string, owner: string | null) =>
    tableOf("exercises").set(rowId, {
      $id: rowId,
      name,
      normalised_name: name.toLowerCase(),
      is_global: owner === null,
      owner_id: owner,
    });
  exercise("ex-squat", "Squat", null);
  exercise("ex-joey-paused", "Paused Bench", JOEY);
  exercise("ex-joey-pin", "Pin Squat", JOEY);
  exercise("ex-andrea-pin", "Pin Squat", ANDREA);

  const tables: ProgramTables = {
    async listRows({ tableId, queries }) {
      const wanted = queries
        .map((q) => JSON.parse(q) as { method: string; attribute?: string; values?: unknown[] })
        .filter((q) => q.method === "equal");
      return {
        rows: [...tableOf(tableId).values()].filter((row) => wanted.every((q) => q.values?.includes(row[q.attribute!]))),
      };
    },
    async getRow({ tableId, rowId }) {
      const row = tableOf(tableId).get(rowId);
      if (!row) throw Object.assign(new Error("not found"), { code: 404 });
      return row;
    },
    writer: {
      async createRow({ tableId, rowId, data, permissions }) {
        writes.push({ op: "create", tableId, rowId });
        const row = { $id: rowId, ...data, $permissions: permissions };
        tableOf(tableId).set(rowId, row);
        return row;
      },
      async updateRow({ tableId, rowId, data, permissions }) {
        writes.push({ op: "update", tableId, rowId });
        const row = { ...tableOf(tableId).get(rowId)!, ...data, $permissions: permissions };
        tableOf(tableId).set(rowId, row);
        return row;
      },
      async deleteRow({ tableId, rowId }) {
        writes.push({ op: "delete", tableId, rowId });
        tableOf(tableId).delete(rowId);
        return {};
      },
    },
  };

  const deps = { newId: () => `row${++id}`, now: () => new Date("2026-10-06T08:00:00Z") };
  const run = (caller: string, op: ProgramOpInput) => runProgramOp(tables, DB, caller, op, deps);
  const ok = async (caller: string, op: ProgramOpInput) => {
    const result = await run(caller, op);
    if (result.status !== "ok") throw new Error(`${op.op} failed: ${JSON.stringify(result)}`);
    return result.rowId;
  };
  const tree = (programId: string) => readProgramTree(tables, DB, programId);
  return { tables, writes, run, ok, tree, tableOf };
}

/**
 * Joey's program: two blocks. Block 1 has two weeks; week 1 has two dated days
 * with a squat at 75% @8, a paused bench (Joey's own variation) at 80%, and a
 * fixed-kilo pin squat. Published, so the copies being drafts is meaningful.
 */
async function joeysProgram(h: ReturnType<typeof harness>) {
  const programId = await h.ok(COACH, { op: "createProgram", athleteId: JOEY, name: "Autumn", startOn: "2026-10-05" });
  const blockId = await h.ok(COACH, { op: "addBlock", programId, name: "Volume" });
  const week1 = await h.ok(COACH, { op: "addWeek", blockId, label: "Intro", notes: "Easy" });
  const week2 = await h.ok(COACH, { op: "addWeek", blockId });
  const monday = await h.ok(COACH, { op: "addDay", weekId: week1, scheduledOn: "2026-10-05", label: "Heavy" });
  const thursday = await h.ok(COACH, { op: "addDay", weekId: week1, scheduledOn: "2026-10-08", notes: "Pause it" });
  const squat = await h.ok(COACH, {
    op: "addPrescription",
    dayId: monday,
    exerciseId: "ex-squat",
    setCount: 3,
    reps: 5,
    load: "75% @8",
    restSeconds: 180,
    notes: "Belt",
  });
  await h.ok(COACH, { op: "addPrescription", dayId: monday, exerciseId: "ex-joey-pin", setCount: 2, reps: 3, load: "140" });
  await h.ok(COACH, { op: "addPrescription", dayId: thursday, exerciseId: "ex-joey-paused", setCount: 4, reps: 4, repMax: 6, load: "80%" });
  await h.ok(COACH, { op: "addDay", weekId: week2, scheduledOn: "2026-10-12" });
  const block2 = await h.ok(COACH, { op: "addBlock", programId, name: "Peak" });
  const peakWeek = await h.ok(COACH, { op: "addWeek", blockId: block2 });
  await h.ok(COACH, { op: "addDay", weekId: peakWeek, scheduledOn: "2026-10-19" });
  await h.ok(COACH, { op: "publishProgram", programId });
  // Logged work against the program, which no copy may touch.
  h.tableOf("sessions").set("s1", { $id: "s1", athlete_id: JOEY, program_day_id: monday });
  h.tableOf("sets").set("set1", { $id: "set1", athlete_id: JOEY, prescription_id: squat, load_kg: 150 });
  return { programId, blockId, block2, week1, week2, monday, thursday, squat };
}

describe("duplicateWeek", () => {
  it("appends a draft copy with every day and line, dated a week after the block's last week", async () => {
    const h = harness();
    const p = await joeysProgram(h);
    const newWeek = await h.ok(COACH, { op: "duplicateWeek", weekId: p.week1 });

    const block = (await h.tree(p.programId))!.blocks[0];
    expect(block.weeks.map((w) => w.id)).toEqual([p.week1, p.week2, newWeek]);
    const copy = block.weeks[2];
    expect(copy).toMatchObject({ status: "draft", label: null, notes: "Easy", position: 2 });
    // Week 1 of 2 duplicated: the copy is week 3, so +14 days.
    expect(copy.days.map((d) => [d.scheduledOn, d.label, d.notes])).toEqual([
      ["2026-10-19", "Heavy", null],
      ["2026-10-22", null, "Pause it"],
    ]);
    const source = block.weeks[0].days.flatMap((d) => d.prescriptions);
    const copied = copy.days.flatMap((d) => d.prescriptions);
    const content = (l: (typeof source)[number]) => [l.exerciseId, l.setCount, l.reps, l.repMax, l.load, l.loadKind, l.restSeconds, l.notes];
    expect(copied.map(content)).toEqual(source.map(content));
    expect(copied.every((l) => l.weekId === newWeek && !source.some((s) => s.id === l.id))).toBe(true);
  });

  it("moves the last week's copy by exactly seven days", async () => {
    const h = harness();
    const p = await joeysProgram(h);
    const newWeek = await h.ok(COACH, { op: "duplicateWeek", weekId: p.week2 });
    const copy = (await h.tree(p.programId))!.blocks[0].weeks.find((w) => w.id === newWeek)!;
    expect(copy.days.map((d) => d.scheduledOn)).toEqual(["2026-10-19"]);
  });

  it("never touches logged work, and refuses anyone but the program's linked coach", async () => {
    const h = harness();
    const p = await joeysProgram(h);
    h.writes.length = 0;
    await h.ok(COACH, { op: "duplicateWeek", weekId: p.week1 });
    expect(h.writes.every((w) => w.op === "create" && w.tableId !== "sessions" && w.tableId !== "sets")).toBe(true);
    expect(h.tableOf("sets").get("set1")).toEqual({ $id: "set1", athlete_id: JOEY, prescription_id: p.squat, load_kg: 150 });

    h.writes.length = 0;
    expect(await h.run(STRANGER, { op: "duplicateWeek", weekId: p.week1 })).toEqual({ status: "not-allowed" });
    h.tableOf("coach_athlete_links").get(`link-${JOEY}`)!.status = "revoked";
    expect(await h.run(COACH, { op: "duplicateWeek", weekId: p.week1 })).toEqual({ status: "not-allowed" });
    expect(await h.run(COACH, { op: "duplicateWeek", weekId: "nope" })).toEqual({ status: "not-found" });
    expect(h.writes).toEqual([]);
  });
});

describe("copyProgram", () => {
  it("copies the whole program to another linked athlete as a draft, re-dated from the new start", async () => {
    const h = harness();
    const p = await joeysProgram(h);
    const copyId = await h.ok(COACH, { op: "copyProgram", programId: p.programId, athleteId: ANDREA, startOn: "2026-11-02" });

    const copy = (await h.tree(copyId))!;
    expect(copy).toMatchObject({ coachId: COACH, athleteId: ANDREA, name: "Autumn", status: "draft", startOn: "2026-11-02" });
    expect(copy.blocks.map((b) => b.name)).toEqual(["Volume", "Peak"]);
    const weeks = copy.blocks.flatMap((b) => b.weeks);
    expect(weeks.every((w) => w.status === "draft")).toBe(true);
    expect(weeks[0].label).toBe("Intro");
    expect(weeks.flatMap((w) => w.days.map((d) => d.scheduledOn))).toEqual([
      "2026-11-02",
      "2026-11-05",
      "2026-11-09",
      "2026-11-16",
    ]);
    // Every copied row belongs to Andrea's program and is readable by her, not Joey.
    for (const table of ["program_blocks", "program_weeks", "program_days", "prescriptions"]) {
      const rows = [...h.tableOf(table).values()].filter((r) => r.program_id === copyId);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.athlete_id === ANDREA && r.coach_id === COACH)).toBe(true);
      expect(rows.every((r) => r.$permissions!.some((x) => x.includes(ANDREA)) && !r.$permissions!.some((x) => x.includes(JOEY)))).toBe(true);
    }
    // The source is untouched, still published.
    expect((await h.tree(p.programId))!.status).toBe("published");
  });

  it("keeps percentages as percentages, so they resolve against the TARGET's max", async () => {
    const h = harness();
    const p = await joeysProgram(h);
    const copyId = await h.ok(COACH, { op: "copyProgram", programId: p.programId, athleteId: ANDREA });
    const lines = (await h.tree(copyId))!.blocks[0].weeks[0].days.flatMap((d) => d.prescriptions);
    const squat = lines.find((l) => l.exerciseId === "ex-squat")!;
    expect([squat.load, squat.loadKind]).toEqual(["75% @8", "capped"]);
    // Joey's training max is 200, Andrea's 120: the copy is her 75%, not his kilos.
    const forAndrea = resolvePrescription(parsePrescription(squat.load!)!, { training: 120 });
    expect(forAndrea.loadKg).toBe(90);
    expect(lines.find((l) => l.load === "140")!.loadKind).toBe("fixed");
  });

  it("resolves each exercise in the target's library: global kept, hers found, missing created there", async () => {
    const h = harness();
    const p = await joeysProgram(h);
    const copyId = await h.ok(COACH, { op: "copyProgram", programId: p.programId, athleteId: ANDREA });
    const lines = (await h.tree(copyId))!.blocks[0].weeks[0].days.flatMap((d) => d.prescriptions);
    const ids = lines.map((l) => l.exerciseId);
    expect(ids).toContain("ex-squat");
    expect(ids).toContain("ex-andrea-pin");
    expect(ids).not.toContain("ex-joey-pin");
    expect(ids).not.toContain("ex-joey-paused");
    const paused = h.tableOf("exercises").get(lines.find((l) => l.load === "80%")!.exerciseId)!;
    expect(paused).toMatchObject({ name: "Paused Bench", owner_id: ANDREA, is_global: false });

    // A second copy finds that variation rather than making another.
    const before = h.tableOf("exercises").size;
    await h.ok(COACH, { op: "copyProgram", programId: p.programId, athleteId: ANDREA });
    expect(h.tableOf("exercises").size).toBe(before);
  });

  it("copies one block on its own, anchored on its first day", async () => {
    const h = harness();
    const p = await joeysProgram(h);
    const copyId = await h.ok(COACH, {
      op: "copyProgram",
      programId: p.programId,
      blockId: p.block2,
      athleteId: ANDREA,
      startOn: "2026-11-02",
    });
    const copy = (await h.tree(copyId))!;
    expect(copy.name).toBe("Autumn · Peak");
    expect(copy.blocks.map((b) => [b.name, b.position])).toEqual([["Peak", 0]]);
    expect(copy.blocks[0].weeks[0].days.map((d) => d.scheduledOn)).toEqual(["2026-11-02"]);
    expect(await h.run(COACH, { op: "copyProgram", programId: p.programId, blockId: "other", athleteId: ANDREA })).toEqual({
      status: "not-found",
    });
  });

  it("copies to the coach themselves, with no link needed", async () => {
    const h = harness();
    const p = await joeysProgram(h);
    const copyId = await h.ok(COACH, { op: "copyProgram", programId: p.programId, athleteId: COACH, name: "Mine" });
    const copy = (await h.tree(copyId))!;
    expect([copy.athleteId, copy.name]).toEqual([COACH, "Mine"]);
    const lines = copy.blocks[0].weeks[0].days.flatMap((d) => d.prescriptions);
    expect(lines.every((l) => l.exerciseId === "ex-squat" || h.tableOf("exercises").get(l.exerciseId)!.owner_id === COACH)).toBe(true);
  });

  it("needs an active link on both ends, and writes nothing when refused", async () => {
    const h = harness();
    const p = await joeysProgram(h);
    h.writes.length = 0;
    // To someone they do not coach, or no longer coach.
    expect(await h.run(COACH, { op: "copyProgram", programId: p.programId, athleteId: STRANGER })).toEqual({ status: "not-allowed" });
    expect(await h.run(COACH, { op: "copyProgram", programId: p.programId, athleteId: FORMER })).toEqual({ status: "not-allowed" });
    // Somebody else's program, even to an athlete the stranger could program.
    expect(await h.run(STRANGER, { op: "copyProgram", programId: p.programId, athleteId: STRANGER })).toEqual({ status: "not-allowed" });
    // From an athlete the coach no longer coaches.
    h.tableOf("coach_athlete_links").get(`link-${JOEY}`)!.status = "revoked";
    expect(await h.run(COACH, { op: "copyProgram", programId: p.programId, athleteId: ANDREA })).toEqual({ status: "not-allowed" });
    expect(h.writes).toEqual([]);
  });

  it("refuses before writing when a line's exercise is gone", async () => {
    const h = harness();
    const p = await joeysProgram(h);
    h.tableOf("exercises").delete("ex-joey-paused");
    h.writes.length = 0;
    const result = await h.run(COACH, { op: "copyProgram", programId: p.programId, athleteId: ANDREA });
    expect(result.status).toBe("invalid");
    expect(h.writes).toEqual([]);
  });

  it("never touches logged work", async () => {
    const h = harness();
    const p = await joeysProgram(h);
    h.writes.length = 0;
    await h.ok(COACH, { op: "copyProgram", programId: p.programId, athleteId: ANDREA });
    expect(h.writes.every((w) => w.op === "create" && w.tableId !== "sessions" && w.tableId !== "sets")).toBe(true);
  });
});

describe("a copied line carries every column, including ones added later", () => {
  it("copies an unknown column (say, Order 21's backoff rule) without being told about it", async () => {
    const h = harness();
    const p = await joeysProgram(h);
    h.tableOf("prescriptions").get(p.squat)!.backoff_rule = "-10% x3";
    const copyId = await h.ok(COACH, { op: "copyProgram", programId: p.programId, athleteId: ANDREA });
    const weekId = await h.ok(COACH, { op: "duplicateWeek", weekId: p.week1 });
    const copies = [...h.tableOf("prescriptions").values()].filter(
      (r) => (r.program_id === copyId || r.week_id === weekId) && r.exercise_id === "ex-squat",
    );
    expect(copies.map((r) => r.backoff_rule)).toEqual(["-10% x3", "-10% x3"]);
  });

  it("takes placement and Appwrite's own columns from the destination, never the source", () => {
    const content = lineContent({
      $id: "x",
      $permissions: ["read(\"any\")"],
      program_id: "p",
      coach_id: "c",
      athlete_id: "a",
      week_id: "w",
      day_id: "d",
      exercise_id: "e",
      position: 3,
      load_kind: "fixed",
      updated_at: "t",
      set_count: 3,
      load: "75%",
      video_required: true,
    });
    expect(content).toEqual({ set_count: 3, load: "75%", video_required: true });
  });
});
