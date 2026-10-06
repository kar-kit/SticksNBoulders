import { mayProgramFor, readProgramTree, runProgramOp, type ProgramTables } from "./program-admin";
import { circleTeamId } from "./circle";
import { SAMPLE_EXERCISES, sampleProgram, writeOutline } from "@/lib/programming/sample-program";
import type { ProgramOpInput } from "@/lib/programming/program";

const DB = "sticksnboulders";
/** A fixture exercise id: "Bench Press" -> "ex-Bench-Press". */
const ex = (name: string) => `ex-${name.replace(/\s+/g, "-")}`;
const COACH = "coach_ruairi";
const ATHLETE = "athlete_joey";
const STRANGER = "coach_louis";

type Row = Record<string, unknown> & { $id: string; $permissions?: string[] };

/**
 * Enough of Appwrite to drive the repository end to end: tables of rows, an
 * equality filter, point reads, and a writer that records every call so the
 * tests can assert which tables were touched.
 */
function harness() {
  const db = new Map<string, Map<string, Row>>();
  const tableOf = (id: string) => {
    if (!db.has(id)) db.set(id, new Map());
    return db.get(id)!;
  };
  const writes: Array<{ op: string; tableId: string; rowId: string; permissions?: string[] }> = [];
  let id = 0;

  tableOf("coach_athlete_links").set("link1", {
    $id: "link1",
    coach_id: COACH,
    athlete_id: ATHLETE,
    status: "active",
  });
  for (const name of SAMPLE_EXERCISES) {
    tableOf("exercises").set(ex(name), { $id: ex(name), name, normalised_name: name.toLowerCase(), is_global: true });
  }

  const tables: ProgramTables = {
    async listRows({ tableId, queries }) {
      const wanted = queries
        .map((q) => JSON.parse(q) as { method: string; attribute?: string; values?: unknown[] })
        .filter((q) => q.method === "equal");
      const rows = [...tableOf(tableId).values()].filter((row) =>
        wanted.every((q) => q.values?.includes(row[q.attribute!])),
      );
      return { rows };
    },
    async getRow({ tableId, rowId }) {
      const row = tableOf(tableId).get(rowId);
      if (!row) throw Object.assign(new Error("not found"), { code: 404 });
      return row;
    },
    writer: {
      async createRow({ tableId, rowId, data, permissions }) {
        writes.push({ op: "create", tableId, rowId, permissions });
        const row = { $id: rowId, ...data, $permissions: permissions };
        tableOf(tableId).set(rowId, row);
        return row;
      },
      async updateRow({ tableId, rowId, data, permissions }) {
        writes.push({ op: "update", tableId, rowId, permissions });
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

  const deps = { newId: () => `row${++id}`, now: () => new Date("2026-09-27T08:00:00Z") };
  const run = (caller: string, op: ProgramOpInput | Record<string, unknown>) =>
    runProgramOp(tables, DB, caller, op, deps);
  const ok = async (caller: string, op: ProgramOpInput) => {
    const result = await run(caller, op);
    if (result.status !== "ok") throw new Error(`${op.op} failed: ${JSON.stringify(result)}`);
    return result.rowId;
  };
  return { tables, writes, run, ok, row: (t: string, r: string) => tableOf(t).get(r), tableOf };
}

/** A program with one block, week and day, and one line, for the coach. */
async function skeleton(h: ReturnType<typeof harness>, athleteId: string | null = ATHLETE) {
  const programId = await h.ok(COACH, { op: "createProgram", athleteId, name: "Block 1" });
  const blockId = await h.ok(COACH, { op: "addBlock", programId, name: "Volume" });
  const weekId = await h.ok(COACH, { op: "addWeek", blockId });
  const dayId = await h.ok(COACH, {
    op: "addDay",
    weekId,
    scheduledOn: athleteId ? "2026-09-27" : null,
  });
  const lineId = await h.ok(COACH, {
    op: "addPrescription",
    dayId,
    exerciseId: "ex-Squat",
    setCount: 3,
    reps: 5,
    load: "75% @8",
  });
  return { programId, blockId, weekId, dayId, lineId };
}

describe("who may write programming", () => {
  it("lets a coach with an active link write for the athlete", async () => {
    const h = harness();
    expect(await mayProgramFor(h.tables, DB, COACH, ATHLETE)).toBe(true);
  });

  it("lets anyone write a template of their own, and an athlete program themselves", async () => {
    const h = harness();
    expect(await mayProgramFor(h.tables, DB, STRANGER, null)).toBe(true);
    expect(await mayProgramFor(h.tables, DB, ATHLETE, ATHLETE)).toBe(true);
  });

  it("refuses a stranger, and a coach whose link was revoked", async () => {
    const h = harness();
    expect(await mayProgramFor(h.tables, DB, STRANGER, ATHLETE)).toBe(false);
    h.tableOf("coach_athlete_links").get("link1")!.status = "revoked";
    expect(await mayProgramFor(h.tables, DB, COACH, ATHLETE)).toBe(false);
  });

  it("refuses to create a program for somebody the caller does not coach", async () => {
    const h = harness();
    expect(await h.run(STRANGER, { op: "createProgram", athleteId: ATHLETE, name: "Hijack" })).toEqual({
      status: "not-allowed",
    });
    expect(h.writes).toEqual([]);
  });

  it("refuses any caller but the coach who wrote it, even one who also coaches the athlete", async () => {
    const h = harness();
    const { dayId } = await skeleton(h);
    h.tableOf("coach_athlete_links").set("link2", {
      $id: "link2",
      coach_id: STRANGER,
      athlete_id: ATHLETE,
      status: "active",
    });
    const before = h.writes.length;
    expect(
      await h.run(STRANGER, { op: "addPrescription", dayId, exerciseId: "ex-Squat", setCount: 1 }),
    ).toEqual({ status: "not-allowed" });
    expect(h.writes.length).toBe(before);
  });

  it("stops the coach editing once the athlete unlinks, without losing the program", async () => {
    const h = harness();
    const { lineId } = await skeleton(h);
    h.tableOf("coach_athlete_links").get("link1")!.status = "revoked";
    expect(await h.run(COACH, { op: "updatePrescription", prescriptionId: lineId, load: "80%" })).toEqual({
      status: "not-allowed",
    });
    expect(h.row("prescriptions", lineId)).toBeDefined();
  });

  it("refuses an empty caller outright", async () => {
    const h = harness();
    expect(await h.run("", { op: "createProgram", athleteId: null, name: "x" })).toEqual({ status: "not-allowed" });
  });
});

describe("creating a program top down", () => {
  it("stamps every row with the coach, the athlete and their circle, and nothing writable", async () => {
    const h = harness();
    await skeleton(h);
    const expected = [`read("user:${COACH}")`, `read("user:${ATHLETE}")`, `read("team:${circleTeamId(ATHLETE)}")`];
    for (const write of h.writes) expect(write.permissions, write.tableId).toEqual(expected);
  });

  it("copies program, coach and athlete from the parent onto every child", async () => {
    const h = harness();
    const { programId, lineId, dayId } = await skeleton(h);
    expect(h.row("prescriptions", lineId)).toMatchObject({
      program_id: programId,
      coach_id: COACH,
      athlete_id: ATHLETE,
      day_id: dayId,
    });
  });

  it("ignores ids smuggled into the request -- scope comes from the parent row", async () => {
    const h = harness();
    const { dayId } = await skeleton(h);
    const lineId = await h.ok(COACH, {
      op: "addPrescription",
      dayId,
      exerciseId: "ex-Squat",
      setCount: 1,
      // Not part of the schema; stripped by Zod, never written.
      ...({ athleteId: "victim", coachId: "victim" } as object),
    });
    expect(h.row("prescriptions", lineId)).toMatchObject({ athlete_id: ATHLETE, coach_id: COACH });
  });

  it("starts a program as a draft, so a half-written block never reaches Today", async () => {
    const h = harness();
    const { programId } = await skeleton(h);
    expect(h.row("programs", programId)).toMatchObject({ status: "draft" });
  });

  it("appends each child after its siblings", async () => {
    const h = harness();
    const { dayId } = await skeleton(h);
    const second = await h.ok(COACH, { op: "addPrescription", dayId, exerciseId: ex("Bench Press"), setCount: 4 });
    expect(h.row("prescriptions", second)).toMatchObject({ position: 1 });
  });

  it("derives the load kind from what was typed, never from the caller", async () => {
    const h = harness();
    const { lineId } = await skeleton(h);
    expect(h.row("prescriptions", lineId)).toMatchObject({ load: "75% @8", load_kind: "capped" });
  });

  it("stores a backoff in its canonical spelling, and only when there is one (Order 21)", async () => {
    const h = harness();
    const { dayId, lineId } = await skeleton(h);
    expect(h.row("prescriptions", lineId)).not.toHaveProperty("backoff");
    const withRule = await h.ok(COACH, { op: "addPrescription", dayId, exerciseId: "ex-Squat", setCount: 1, backoff: "-10%x3" });
    expect(h.row("prescriptions", withRule)).toMatchObject({ backoff: "3 x 90%" });
    await h.ok(COACH, { op: "updatePrescription", prescriptionId: withRule, backoff: "same to rpe 9" });
    expect(h.row("prescriptions", withRule)).toMatchObject({ backoff: "repeat until @9" });
    await h.ok(COACH, { op: "updatePrescription", prescriptionId: withRule, backoff: "" });
    expect(h.row("prescriptions", withRule)).toMatchObject({ backoff: null });
  });

  it("refuses a backoff nobody could execute, and writes nothing", async () => {
    const h = harness();
    const { lineId } = await skeleton(h);
    const before = h.writes.length;
    expect(await h.run(COACH, { op: "updatePrescription", prescriptionId: lineId, backoff: "3 x 110%" })).toMatchObject({
      status: "invalid",
    });
    expect(h.writes.length).toBe(before);
  });

  it("refuses a line for an exercise that does not exist", async () => {
    const h = harness();
    const { dayId } = await skeleton(h);
    expect(await h.run(COACH, { op: "addPrescription", dayId, exerciseId: "ex-nope", setCount: 1 })).toMatchObject({
      status: "invalid",
    });
  });

  it("answers not-found for a parent that is not there", async () => {
    const h = harness();
    expect(await h.run(COACH, { op: "addWeek", blockId: "missing" })).toEqual({ status: "not-found" });
  });
});

describe("templates", () => {
  it("are programs with no athlete, readable by their coach alone", async () => {
    const h = harness();
    await skeleton(h, null);
    for (const write of h.writes) expect(write.permissions).toEqual([`read("user:${COACH}")`]);
  });

  it("carry no calendar -- a date arrives when one is assigned", async () => {
    const h = harness();
    const { weekId } = await skeleton(h, null);
    expect(await h.run(COACH, { op: "addDay", weekId, scheduledOn: "2026-10-01" })).toMatchObject({
      status: "invalid",
    });
  });

  it("can be named as the source of an athlete's program only by their own coach", async () => {
    const h = harness();
    const { programId: templateId } = await skeleton(h, null);
    const ok = await h.run(COACH, { op: "createProgram", athleteId: ATHLETE, name: "From template", templateId });
    expect(ok.status).toBe("ok");
    h.tableOf("coach_athlete_links").set("link3", {
      $id: "link3",
      coach_id: STRANGER,
      athlete_id: ATHLETE,
      status: "active",
    });
    expect(
      await h.run(STRANGER, { op: "createProgram", athleteId: ATHLETE, name: "Borrowed", templateId }),
    ).toMatchObject({ status: "invalid" });
  });
});

describe("editing", () => {
  it("publishes a week on its own, which is what week-by-week writing needs", async () => {
    const h = harness();
    const { weekId } = await skeleton(h);
    await h.ok(COACH, { op: "updateWeek", weekId, status: "published" });
    expect(h.row("program_weeks", weekId)).toMatchObject({ status: "published" });
  });

  it("changes only the fields sent", async () => {
    const h = harness();
    const { lineId } = await skeleton(h);
    await h.ok(COACH, { op: "updatePrescription", prescriptionId: lineId, load: "80%" });
    expect(h.row("prescriptions", lineId)).toMatchObject({ load: "80%", load_kind: "percent", reps: 5, set_count: 3 });
  });

  it("checks a rep range against what the row will hold, not just the request", async () => {
    const h = harness();
    const { lineId } = await skeleton(h);
    expect(await h.run(COACH, { op: "updatePrescription", prescriptionId: lineId, repMax: 3 })).toMatchObject({
      status: "invalid",
    });
  });

  it("removes a line", async () => {
    const h = harness();
    const { lineId } = await skeleton(h);
    await h.ok(COACH, { op: "removePrescription", prescriptionId: lineId });
    expect(h.row("prescriptions", lineId)).toBeUndefined();
  });

  it("reorders children, writing only what moved", async () => {
    const h = harness();
    const { dayId, lineId } = await skeleton(h);
    const b = await h.ok(COACH, { op: "addPrescription", dayId, exerciseId: ex("Bench Press"), setCount: 1 });
    const c = await h.ok(COACH, { op: "addPrescription", dayId, exerciseId: "ex-Deadlift", setCount: 1 });
    const before = h.writes.length;
    await h.ok(COACH, { op: "reorder", level: "prescriptions", parentId: dayId, orderedIds: [c, lineId, b] });
    expect(h.writes.slice(before).map((w) => w.rowId)).toEqual([c, lineId, b]);
    expect([c, lineId, b].map((id) => h.row("prescriptions", id)!.position)).toEqual([0, 1, 2]);
  });

  it("refuses to reorder with a row from somebody else's day", async () => {
    const h = harness();
    const { dayId, lineId } = await skeleton(h);
    expect(
      await h.run(COACH, { op: "reorder", level: "prescriptions", parentId: dayId, orderedIds: [lineId, "foreign"] }),
    ).toMatchObject({ status: "invalid" });
  });
});

describe("publishing", () => {
  it("puts the program and every week in it live in one request, program last", async () => {
    const h = harness();
    const { programId, blockId, weekId } = await skeleton(h);
    const second = await h.ok(COACH, { op: "addWeek", blockId });
    h.writes.length = 0;
    await h.ok(COACH, { op: "publishProgram", programId });
    expect(h.row("program_weeks", weekId)!.status).toBe("published");
    expect(h.row("program_weeks", second)!.status).toBe("published");
    expect(h.row("programs", programId)!.status).toBe("published");
    expect(h.writes.at(-1)).toMatchObject({ tableId: "programs", rowId: programId });
  });

  it("refuses a template, and anyone but the program's coach", async () => {
    const h = harness();
    const template = await skeleton(h, null);
    expect(await h.run(COACH, { op: "publishProgram", programId: template.programId })).toMatchObject({
      status: "invalid",
    });
    const { programId } = await skeleton(h);
    expect(await h.run(STRANGER, { op: "publishProgram", programId })).toEqual({ status: "not-allowed" });
  });
});

describe("removing structure", () => {
  it("removes a day with its lines, children first", async () => {
    const h = harness();
    const { dayId, lineId } = await skeleton(h);
    h.writes.length = 0;
    await h.ok(COACH, { op: "removeDay", dayId });
    expect(h.row("program_days", dayId)).toBeUndefined();
    expect(h.row("prescriptions", lineId)).toBeUndefined();
    expect(h.writes.map((w) => w.tableId)).toEqual(["prescriptions", "program_days"]);
  });

  it("removes a week or a block with everything beneath it", async () => {
    const h = harness();
    const { programId, blockId, weekId, dayId, lineId } = await skeleton(h);
    await h.ok(COACH, { op: "removeWeek", weekId });
    expect([h.row("program_weeks", weekId), h.row("program_days", dayId), h.row("prescriptions", lineId)]).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    const again = await h.ok(COACH, { op: "addWeek", blockId });
    await h.ok(COACH, { op: "removeBlock", blockId });
    expect(h.row("program_blocks", blockId)).toBeUndefined();
    expect(h.row("program_weeks", again)).toBeUndefined();
    expect(h.row("programs", programId)).toBeDefined();
  });

  it("refuses a stranger and touches nothing", async () => {
    const h = harness();
    const { dayId } = await skeleton(h);
    h.writes.length = 0;
    expect(await h.run(STRANGER, { op: "removeDay", dayId })).toEqual({ status: "not-allowed" });
    expect(h.writes).toEqual([]);
  });
});

describe("variations typed into the editor", () => {
  it("are created in the athlete's library, so the athlete can read and log them", async () => {
    const h = harness();
    const { programId } = await skeleton(h);
    const id = await h.ok(COACH, { op: "createExercise", programId, name: "3-0-0 Tempo Bench" });
    const row = h.row("exercises", id)!;
    expect(row).toMatchObject({ owner_id: ATHLETE, is_global: false, normalised_name: "3 0 0 tempo bench" });
    expect(row.$permissions).toContain(`read("user:${ATHLETE}")`);
  });

  it("hand back the row already there rather than making a second", async () => {
    const h = harness();
    const { programId } = await skeleton(h);
    expect(await h.ok(COACH, { op: "createExercise", programId, name: "squat" })).toBe("ex-Squat");
    const first = await h.ok(COACH, { op: "createExercise", programId, name: "Pin Squat" });
    expect(await h.ok(COACH, { op: "createExercise", programId, name: "pin  squat" })).toBe(first);
  });

  it("refuses a line naming an exercise the athlete cannot read", async () => {
    const h = harness();
    const { dayId } = await skeleton(h);
    h.tableOf("exercises").set("ex-coach-only", { $id: "ex-coach-only", name: "Secret", is_global: false, owner_id: COACH });
    expect(
      await h.run(COACH, { op: "addPrescription", dayId, exerciseId: "ex-coach-only", setCount: 1 }),
    ).toMatchObject({ status: "invalid", reason: expect.stringContaining("athlete's library") });
  });

  it("refuses a stranger", async () => {
    const h = harness();
    const { programId } = await skeleton(h);
    expect(await h.run(STRANGER, { op: "createExercise", programId, name: "Pin Squat" })).toEqual({
      status: "not-allowed",
    });
  });
});

describe("constraint 5: logged work is immutable, prescriptions are not", () => {
  it("never writes a session or a set, whatever the coach does to the program", async () => {
    const h = harness();
    const { programId, weekId, dayId, lineId } = await skeleton(h);
    h.tableOf("sets").set("set1", { $id: "set1", load_kg: 150, prescription_id: lineId, prescribed: "5 reps · 150 kg (75%)" });
    await h.ok(COACH, { op: "updatePrescription", prescriptionId: lineId, load: "85%", reps: 3 });
    await h.ok(COACH, { op: "updateDay", dayId, scheduledOn: "2026-09-28" });
    await h.ok(COACH, { op: "updateWeek", weekId, status: "published" });
    await h.ok(COACH, { op: "updateProgram", programId, status: "archived" });
    await h.ok(COACH, { op: "removePrescription", prescriptionId: lineId });

    expect(h.writes.filter((w) => w.tableId === "sets" || w.tableId === "sessions")).toEqual([]);
    expect(h.row("sets", "set1")).toMatchObject({ load_kg: 150, prescribed: "5 reps · 150 kg (75%)" });
  });
});

describe("the sample block, written through the same ops", () => {
  it("writes a whole four-week program and reads it back as a tree", async () => {
    const h = harness();
    const exerciseIds = Object.fromEntries(SAMPLE_EXERCISES.map((n) => [n, ex(n)])) as Record<
      (typeof SAMPLE_EXERCISES)[number],
      string
    >;
    const written = await writeOutline((op) => h.ok(COACH, op), ATHLETE, sampleProgram("2026-09-27"), exerciseIds);

    const tree = await readProgramTree(h.tables, DB, written.programId);
    expect(tree?.status).toBe("published");
    expect(tree?.blocks[0].weeks.map((w) => w.status)).toEqual(["published", "published", "draft", "draft"]);
    expect(tree?.blocks[0].weeks[0].days[0]).toMatchObject({ scheduledOn: "2026-09-27" });
    expect(tree?.blocks[0].weeks[0].days[0].prescriptions.map((p) => p.loadKind)).toEqual([
      "rpe",
      "percent",
      "capped",
      "freeform",
    ]);
    expect(written.daysOn.get("2026-09-27")).toBe(tree?.blocks[0].weeks[0].days[0].id);
  });
});
