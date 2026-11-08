import { runProgramOp, readProgramTree, type ProgramTables } from "./program-admin";
import type { ProgramOpInput } from "@/lib/programming/program";

/**
 * F28: the editor's clipboard. A day pasted into a week, a week pasted into a
 * block, from any program the coach may edit to any program they may edit.
 * The program-copy harness, with Appwrite's 409 on a taken row id and a
 * writer that can be made to fail partway.
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
  /** Creates left before the writer starts failing, like a connection dropping mid-paste. */
  const failing = { after: Infinity };
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
        if (failing.after <= 0) throw new Error("network down");
        failing.after -= 1;
        // The row id is unique per table; Appwrite answers a duplicate with 409.
        if (tableOf(tableId).has(rowId)) throw Object.assign(new Error("row already exists"), { code: 409 });
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
  const count = (tableId: string) => tableOf(tableId).size;
  return { tables, writes, run, ok, tree, tableOf, failing, count };
}

/**
 * Joey's published block, from Monday 5 Oct: week 1 has a Monday (squat at
 * 75% @8, his own pin squat at 140, his paused bench at 80% OF THE SQUAT) and
 * a Thursday; week 2 has one Monday.
 */
async function joeysProgram(h: ReturnType<typeof harness>) {
  const programId = await h.ok(COACH, { op: "createProgram", athleteId: JOEY, name: "Autumn", startOn: "2026-10-05" });
  const blockId = await h.ok(COACH, { op: "addBlock", programId, name: "Volume" });
  const week1 = await h.ok(COACH, { op: "addWeek", blockId, label: "Heavy", notes: "Easy" });
  const week2 = await h.ok(COACH, { op: "addWeek", blockId });
  const monday = await h.ok(COACH, { op: "addDay", weekId: week1, scheduledOn: "2026-10-05", label: "Squat day" });
  const thursday = await h.ok(COACH, { op: "addDay", weekId: week1, scheduledOn: "2026-10-08", notes: "Pause it" });
  const squat = await h.ok(COACH, {
    op: "addPrescription",
    dayId: monday,
    exerciseId: "ex-squat",
    setCount: 3,
    reps: 5,
    load: "75% @8",
    notes: "Belt",
  });
  await h.ok(COACH, { op: "addPrescription", dayId: monday, exerciseId: "ex-joey-pin", setCount: 2, reps: 3, load: "140" });
  await h.ok(COACH, {
    op: "addPrescription",
    dayId: monday,
    exerciseId: "ex-joey-paused",
    setCount: 4,
    reps: 4,
    load: "80%",
    referenceExerciseId: "ex-squat",
    videoRequired: true,
  });
  await h.ok(COACH, { op: "addPrescription", dayId: thursday, exerciseId: "ex-squat", setCount: 1, reps: 1, load: "@9" });
  await h.ok(COACH, { op: "addDay", weekId: week2, scheduledOn: "2026-10-12" });
  await h.ok(COACH, { op: "publishProgram", programId });
  h.tableOf("sessions").set("s1", { $id: "s1", athlete_id: JOEY, program_day_id: monday });
  h.tableOf("sets").set("set1", { $id: "set1", athlete_id: JOEY, prescription_id: squat, load_kg: 150 });
  return { programId, blockId, week1, week2, monday, thursday, squat };
}

/**
 * Andrea's program, starting Wednesday 4 Nov (week 1 is Mon 2 Nov to Sun 8
 * Nov): two weeks in one block, week 1 with a Wednesday day already in it.
 */
async function andreasProgram(h: ReturnType<typeof harness>) {
  const programId = await h.ok(COACH, { op: "createProgram", athleteId: ANDREA, name: "Winter", startOn: "2026-11-04" });
  const blockId = await h.ok(COACH, { op: "addBlock", programId, name: "Base" });
  const week1 = await h.ok(COACH, { op: "addWeek", blockId });
  const week2 = await h.ok(COACH, { op: "addWeek", blockId, label: "Heavy" });
  const wednesday = await h.ok(COACH, { op: "addDay", weekId: week1, scheduledOn: "2026-11-04", label: "Bench day" });
  await h.ok(COACH, { op: "addDay", weekId: week2, scheduledOn: "2026-11-11" });
  return { programId, blockId, week1, week2, wednesday };
}

const lineShape = (l: { exerciseId: string; setCount: number; reps: number | null; load: string | null; notes: string | null; referenceExerciseId?: string | null; videoRequired?: boolean }) =>
  [l.exerciseId, l.setCount, l.reps, l.load, l.notes, l.referenceExerciseId ?? null, l.videoRequired ?? false];

describe("copyDay", () => {
  it("pastes a day into another athlete's week: lines as typed, exercises in HER library, every row stamped for her", async () => {
    const h = harness();
    const p = await joeysProgram(h);
    const a = await andreasProgram(h);
    const dayId = await h.ok(COACH, { op: "copyDay", dayId: p.monday, toWeekId: a.week1 });

    const week = (await h.tree(a.programId))!.blocks[0].weeks[0];
    // Appended after her Wednesday.
    expect(week.days.map((d) => [d.id, d.position])).toEqual([
      [a.wednesday, 0],
      [dayId, 1],
    ]);
    const day = week.days[1];
    expect([day.label, day.notes]).toEqual(["Squat day", null]);
    const andreasPaused = [...h.tableOf("exercises").values()].find((e) => e.owner_id === ANDREA && e.name === "Paused Bench")!;
    expect(day.prescriptions.map(lineShape)).toEqual([
      ["ex-squat", 3, 5, "75% @8", "Belt", null, false],
      // Her own Pin Squat, found by name; the fixed kilos kept as typed.
      ["ex-andrea-pin", 2, 3, "140", null, null, false],
      // Joey's private variation, made in her library; still 80% OF THE SQUAT.
      [andreasPaused.$id, 4, 4, "80%", null, "ex-squat", true],
    ]);
    for (const table of ["program_days", "prescriptions"]) {
      const rows = [...h.tableOf(table).values()].filter((r) => r.program_id === a.programId);
      expect(rows.every((r) => r.athlete_id === ANDREA && r.coach_id === COACH)).toBe(true);
      expect(rows.every((r) => r.$permissions!.some((x) => x.includes(ANDREA)) && !r.$permissions!.some((x) => x.includes(JOEY)))).toBe(
        true,
      );
    }
    // The source is where it was, untouched.
    expect((await h.tree(p.programId))!.blocks[0].weeks[0].days[0].prescriptions).toHaveLength(3);
  });

  it("keeps the source's weekday in the target week, and takes the next free one when it is taken", async () => {
    const h = harness();
    const p = await joeysProgram(h);
    const a = await andreasProgram(h);
    // Joey's Monday lands on her week 1's Monday; his Thursday on her week 2's.
    await h.ok(COACH, { op: "copyDay", dayId: p.monday, toWeekId: a.week1 });
    await h.ok(COACH, { op: "copyDay", dayId: p.thursday, toWeekId: a.week2 });
    let weeks = (await h.tree(a.programId))!.blocks[0].weeks;
    expect(weeks[0].days.map((d) => d.scheduledOn)).toEqual(["2026-11-04", "2026-11-02"]);
    expect(weeks[1].days.map((d) => d.scheduledOn)).toEqual(["2026-11-11", "2026-11-12"]);

    // Her Wednesday pasted into her own week 1, where Wednesday is taken: the
    // first free weekday after the last one used.
    await h.ok(COACH, { op: "copyDay", dayId: a.wednesday, toWeekId: a.week1 });
    weeks = (await h.tree(a.programId))!.blocks[0].weeks;
    expect(weeks[0].days.map((d) => d.scheduledOn)).toEqual(["2026-11-04", "2026-11-02", "2026-11-05"]);
  });

  it("puts the day where it was asked and renumbers the week around it", async () => {
    const h = harness();
    const p = await joeysProgram(h);
    const a = await andreasProgram(h);
    const first = await h.ok(COACH, { op: "copyDay", dayId: p.monday, toWeekId: a.week1, position: 0 });
    const middle = await h.ok(COACH, { op: "copyDay", dayId: p.thursday, toWeekId: a.week1, position: 1 });
    const end = await h.ok(COACH, { op: "copyDay", dayId: p.thursday, toWeekId: a.week1, position: 99 });
    const days = (await h.tree(a.programId))!.blocks[0].weeks[0].days;
    expect(days.map((d) => [d.id, d.position])).toEqual([
      [first, 0],
      [middle, 1],
      [a.wednesday, 2],
      [end, 3],
    ]);
  });

  it("drops the date on a template, and resolves exercises in the coach's own library", async () => {
    const h = harness();
    const p = await joeysProgram(h);
    const templateId = await h.ok(COACH, { op: "createProgram", athleteId: null, name: "Squat template" });
    const blockId = await h.ok(COACH, { op: "addBlock", programId: templateId, name: "Block 1" });
    const weekId = await h.ok(COACH, { op: "addWeek", blockId });
    await h.ok(COACH, { op: "copyDay", dayId: p.monday, toWeekId: weekId });
    const day = (await h.tree(templateId))!.blocks[0].weeks[0].days[0];
    expect(day.scheduledOn).toBeNull();
    const owners = day.prescriptions.map((l) => h.tableOf("exercises").get(l.exerciseId)!);
    expect(owners.every((e) => e.is_global === true || e.owner_id === COACH)).toBe(true);
    const rows = [...h.tableOf("prescriptions").values()].filter((r) => r.program_id === templateId);
    expect(rows.every((r) => r.athlete_id === null && r.$permissions!.every((x) => x.includes(COACH)))).toBe(true);
  });

  it("drops the date on a program with nothing to count from", async () => {
    const h = harness();
    const p = await joeysProgram(h);
    const programId = await h.ok(COACH, { op: "createProgram", athleteId: ANDREA, name: "Undated" });
    const blockId = await h.ok(COACH, { op: "addBlock", programId, name: "Block 1" });
    const weekId = await h.ok(COACH, { op: "addWeek", blockId });
    await h.ok(COACH, { op: "copyDay", dayId: p.monday, toWeekId: weekId });
    expect((await h.tree(programId))!.blocks[0].weeks[0].days[0].scheduledOn).toBeNull();
  });

  it("lands in the target week as it stands: a live week's paste is live, as + Day is", async () => {
    const h = harness();
    const p = await joeysProgram(h);
    const dayId = await h.ok(COACH, { op: "copyDay", dayId: p.monday, toWeekId: p.week2 });
    const tree = (await h.tree(p.programId))!;
    expect(tree.blocks[0].weeks[1]).toMatchObject({ status: "published" });
    expect(tree.blocks[0].weeks[1].days.map((d) => [d.id, d.scheduledOn])).toEqual([
      // Week 2's Monday is taken, so Tuesday.
      [expect.any(String), "2026-10-12"],
      [dayId, "2026-10-13"],
    ]);
  });

  it("needs edit rights on both ends, an active link for the target, and writes nothing when refused", async () => {
    const h = harness();
    const p = await joeysProgram(h);
    const a = await andreasProgram(h);
    h.writes.length = 0;
    // A stranger can neither read the source nor write the target.
    expect(await h.run(STRANGER, { op: "copyDay", dayId: p.monday, toWeekId: a.week1 })).toEqual({ status: "not-allowed" });
    expect(await h.run(COACH, { op: "copyDay", dayId: "nope", toWeekId: a.week1 })).toEqual({ status: "not-found" });
    expect(await h.run(COACH, { op: "copyDay", dayId: p.monday, toWeekId: "nope" })).toEqual({ status: "not-found" });
    // Andrea's link revoked: her program stops taking pastes.
    h.tableOf("coach_athlete_links").get(`link-${ANDREA}`)!.status = "revoked";
    expect(await h.run(COACH, { op: "copyDay", dayId: p.monday, toWeekId: a.week1 })).toEqual({ status: "not-allowed" });
    // And Joey's revoked: his program stops being a source.
    h.tableOf("coach_athlete_links").get(`link-${ANDREA}`)!.status = "active";
    h.tableOf("coach_athlete_links").get(`link-${JOEY}`)!.status = "revoked";
    expect(await h.run(COACH, { op: "copyDay", dayId: p.monday, toWeekId: a.week1 })).toEqual({ status: "not-allowed" });
    expect(h.writes).toEqual([]);
  });

  it("refuses a request id that is not letters and digits", async () => {
    const h = harness();
    const p = await joeysProgram(h);
    const result = await h.run(COACH, { op: "copyDay", dayId: p.monday, toWeekId: p.week2, requestId: "a_b" });
    expect(result).toMatchObject({ status: "invalid", reason: expect.stringContaining("requestId") });
  });
});

describe("copyDay, pressed twice or retried", () => {
  it("answers a second tap with the same day, writing nothing more", async () => {
    const h = harness();
    const p = await joeysProgram(h);
    const a = await andreasProgram(h);
    const op = { op: "copyDay", dayId: p.monday, toWeekId: a.week1, requestId: "paste1" } as const;
    expect(await h.ok(COACH, op)).toBe("paste1");
    const rows = h.count("prescriptions") + h.count("program_days");
    h.writes.length = 0;
    expect(await h.ok(COACH, op)).toBe("paste1");
    expect(h.count("prescriptions") + h.count("program_days")).toBe(rows);
    expect(h.writes).toEqual([]);
    expect((await h.tree(a.programId))!.blocks[0].weeks[0].days).toHaveLength(2);
  });

  it("shows nothing of a paste that died halfway, and the retry finishes it once", async () => {
    const h = harness();
    const p = await joeysProgram(h);
    const a = await andreasProgram(h);
    const op = { op: "copyDay", dayId: p.monday, toWeekId: a.week1, requestId: "paste2" } as const;
    // Andrea's Paused Bench is created, then two lines, then the connection drops.
    h.failing.after = 3;
    await expect(h.run(COACH, op)).rejects.toThrow("network down");
    expect((await h.tree(a.programId))!.blocks[0].weeks[0].days.map((d) => d.id)).toEqual([a.wednesday]);

    h.failing.after = Infinity;
    expect(await h.ok(COACH, op)).toBe("paste2");
    const days = (await h.tree(a.programId))!.blocks[0].weeks[0].days;
    expect(days.map((d) => d.id)).toEqual([a.wednesday, "paste2"]);
    expect(days[1].prescriptions).toHaveLength(3);
    expect([...h.tableOf("prescriptions").values()].filter((r) => r.day_id === "paste2")).toHaveLength(3);
    expect([...h.tableOf("exercises").values()].filter((e) => e.owner_id === ANDREA && e.name === "Paused Bench")).toHaveLength(1);
  });

  it("refuses a request id already used for a paste somewhere else", async () => {
    const h = harness();
    const p = await joeysProgram(h);
    const a = await andreasProgram(h);
    await h.ok(COACH, { op: "copyDay", dayId: p.monday, toWeekId: a.week1, requestId: "paste3" });
    expect(await h.run(COACH, { op: "copyDay", dayId: p.monday, toWeekId: a.week2, requestId: "paste3" })).toEqual({
      status: "invalid",
      reason: "requestId: already used for another paste",
    });
  });
});

describe("copyWeek", () => {
  it("pastes a week into another athlete's block as a draft, every day and line, dated where it lands", async () => {
    const h = harness();
    const p = await joeysProgram(h);
    const a = await andreasProgram(h);
    const weekId = await h.ok(COACH, { op: "copyWeek", weekId: p.week1, toBlockId: a.blockId, position: 1 });

    const weeks = (await h.tree(a.programId))!.blocks[0].weeks;
    expect(weeks.map((w) => [w.id, w.position])).toEqual([
      [a.week1, 0],
      [weekId, 1],
      [a.week2, 2],
    ]);
    // A draft, its notes kept; its label clashes with her week 2's, so dropped.
    expect(weeks[1]).toMatchObject({ status: "draft", label: null, notes: "Easy" });
    // Her week 2 (Mon 9 Nov): Monday and Thursday, as in Joey's week.
    expect(weeks[1].days.map((d) => [d.label, d.scheduledOn, d.position])).toEqual([
      ["Squat day", "2026-11-09", 0],
      [null, "2026-11-12", 1],
    ]);
    const lines = weeks[1].days.flatMap((d) => d.prescriptions);
    expect(lines.map((l) => l.exerciseId)).not.toContain("ex-joey-pin");
    expect(lines.map((l) => l.exerciseId)).not.toContain("ex-joey-paused");
    expect(lines.every((l) => l.weekId === weekId)).toBe(true);
    const rows = ["program_weeks", "program_days", "prescriptions"].flatMap((t) =>
      [...h.tableOf(t).values()].filter((r) => r.program_id === a.programId),
    );
    expect(rows.every((r) => r.athlete_id === ANDREA && !r.$permissions!.some((x) => x.includes(JOEY)))).toBe(true);
  });

  it("keeps the week's label when the block has none like it, and appends when no place is given", async () => {
    const h = harness();
    const p = await joeysProgram(h);
    const a = await andreasProgram(h);
    await h.run(COACH, { op: "updateWeek", weekId: a.week2, label: "Peak" });
    const weekId = await h.ok(COACH, { op: "copyWeek", weekId: p.week1, toBlockId: a.blockId });
    const weeks = (await h.tree(a.programId))!.blocks[0].weeks;
    expect(weeks.map((w) => w.id)).toEqual([a.week1, a.week2, weekId]);
    expect(weeks[2]).toMatchObject({ label: "Heavy", position: 2 });
    expect(weeks[2].days.map((d) => d.scheduledOn)).toEqual(["2026-11-16", "2026-11-19"]);
  });

  it("pastes a week within its own program, a draft even from a published block", async () => {
    const h = harness();
    const p = await joeysProgram(h);
    const weekId = await h.ok(COACH, { op: "copyWeek", weekId: p.week1, toBlockId: p.blockId, position: 0 });
    const weeks = (await h.tree(p.programId))!.blocks[0].weeks;
    expect(weeks.map((w) => [w.id, w.position, w.status])).toEqual([
      [weekId, 0, "draft"],
      [p.week1, 1, "published"],
      [p.week2, 2, "published"],
    ]);
    // Same athlete: every exercise kept as it was.
    expect(weeks[0].days[0].prescriptions.map((l) => l.exerciseId)).toEqual(["ex-squat", "ex-joey-pin", "ex-joey-paused"]);
    expect(weeks[0].days.map((d) => d.scheduledOn)).toEqual(["2026-10-05", "2026-10-08"]);
  });

  it("pastes undated into a template", async () => {
    const h = harness();
    const p = await joeysProgram(h);
    const templateId = await h.ok(COACH, { op: "createProgram", athleteId: null, name: "Template" });
    const blockId = await h.ok(COACH, { op: "addBlock", programId: templateId, name: "Block 1" });
    await h.ok(COACH, { op: "copyWeek", weekId: p.week1, toBlockId: blockId });
    const days = (await h.tree(templateId))!.blocks[0].weeks[0].days;
    expect(days.map((d) => d.scheduledOn)).toEqual([null, null]);
  });

  it("needs an active link for the target and writes nothing when refused", async () => {
    const h = harness();
    const p = await joeysProgram(h);
    const a = await andreasProgram(h);
    h.writes.length = 0;
    h.tableOf("coach_athlete_links").get(`link-${ANDREA}`)!.status = "revoked";
    expect(await h.run(COACH, { op: "copyWeek", weekId: p.week1, toBlockId: a.blockId })).toEqual({ status: "not-allowed" });
    expect(await h.run(STRANGER, { op: "copyWeek", weekId: p.week1, toBlockId: p.blockId })).toEqual({ status: "not-allowed" });
    expect(h.writes).toEqual([]);
  });

  it("never touches sessions or sets", async () => {
    const h = harness();
    const p = await joeysProgram(h);
    const a = await andreasProgram(h);
    h.writes.length = 0;
    await h.ok(COACH, { op: "copyWeek", weekId: p.week1, toBlockId: a.blockId });
    await h.ok(COACH, { op: "copyDay", dayId: p.monday, toWeekId: a.week1 });
    expect(h.writes.every((w) => w.tableId !== "sessions" && w.tableId !== "sets")).toBe(true);
    expect(h.tableOf("sets").get("set1")).toEqual({ $id: "set1", athlete_id: JOEY, prescription_id: p.squat, load_kg: 150 });
  });

  it("shows nothing of a week that died halfway, and the retry finishes it exactly once", async () => {
    const h = harness();
    const p = await joeysProgram(h);
    const a = await andreasProgram(h);
    const op = { op: "copyWeek", weekId: p.week1, toBlockId: a.blockId, position: 0, requestId: "week1" } as const;
    h.failing.after = 4;
    await expect(h.run(COACH, op)).rejects.toThrow("network down");
    expect((await h.tree(a.programId))!.blocks[0].weeks.map((w) => w.id)).toEqual([a.week1, a.week2]);

    h.failing.after = Infinity;
    expect(await h.ok(COACH, op)).toBe("week1");
    expect(await h.ok(COACH, op)).toBe("week1");
    const weeks = (await h.tree(a.programId))!.blocks[0].weeks;
    expect(weeks.map((w) => [w.id, w.position])).toEqual([
      ["week1", 0],
      [a.week1, 1],
      [a.week2, 2],
    ]);
    expect(weeks[0].days.map((d) => d.prescriptions.length)).toEqual([3, 1]);
    expect([...h.tableOf("program_days").values()].filter((r) => r.week_id === "week1")).toHaveLength(2);
    expect([...h.tableOf("prescriptions").values()].filter((r) => r.week_id === "week1")).toHaveLength(4);
  });
});
