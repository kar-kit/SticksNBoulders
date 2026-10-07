import type { RowWriter } from "./row-writer";
import { createSession, createSet, type WriteDeps } from "./write";
import {
  copyPrescription,
  createPrescription,
  createProgram,
  lineContent,
  updatePrescription,
  type ProgramScope,
} from "./program-write";

/**
 * The write helper's Order 19 and 22 surface: program rows, and the two
 * optional columns an athlete's session and set gain.
 */

const NOW = new Date("2026-09-27T08:00:00.000Z");

function harness() {
  const calls: Array<{ op: string; tableId: string; data: Record<string, unknown>; permissions?: string[] }> = [];
  const writer: RowWriter = {
    async createRow({ tableId, rowId, data, permissions }) {
      calls.push({ op: "create", tableId, data, permissions });
      return { $id: rowId };
    },
    async updateRow({ tableId, rowId, data, permissions }) {
      calls.push({ op: "update", tableId, data: data ?? {}, permissions });
      return { $id: rowId };
    },
    async deleteRow({ tableId }) {
      calls.push({ op: "delete", tableId, data: {} });
      return {};
    },
  };
  const deps: WriteDeps = { writer, databaseId: "db", newId: () => "row1", now: () => NOW };
  return { calls, deps };
}

const scope: ProgramScope = { programId: "p1", coachId: "ruairi", athleteId: "joey" };

describe("program rows", () => {
  it("takes coach_id from the actor, never from the input", async () => {
    const { calls, deps } = harness();
    await createProgram(deps, { userId: "ruairi" }, { athleteId: "joey", name: " Block 1 " });
    expect(calls[0].data).toMatchObject({ coach_id: "ruairi", athlete_id: "joey", name: "Block 1", status: "draft" });
  });

  it("refuses an unnamed program", async () => {
    const { deps } = harness();
    await expect(createProgram(deps, { userId: "ruairi" }, { athleteId: null, name: " " })).rejects.toThrow(/name/);
  });

  it("derives load_kind from the typed load on create and on update", async () => {
    const { calls, deps } = harness();
    await createPrescription(deps, scope, {
      weekId: "w1",
      dayId: "d1",
      exerciseId: "squat",
      position: 0,
      setCount: 3,
      load: "@8",
    });
    await updatePrescription(deps, scope, "row1", { load: "142.5" });
    await updatePrescription(deps, scope, "row1", { load: null });
    await updatePrescription(deps, scope, "row1", { reps: 3 });
    expect(calls.map((c) => c.data.load_kind)).toEqual(["rpe", "fixed", null, undefined]);
    // An update that does not touch the load leaves both columns alone.
    expect("load" in calls[3].data).toBe(false);
  });

  it("re-stamps the scope and its permissions on every update", async () => {
    const { calls, deps } = harness();
    await updatePrescription(deps, scope, "row1", { position: 2 });
    expect(calls[0].data).toMatchObject({ program_id: "p1", coach_id: "ruairi", athlete_id: "joey", position: 2 });
    expect(calls[0].permissions).toContain('read("user:joey")');
  });
});

describe("a line's reference lift (docs/reference-lift.md §5)", () => {
  const line = { weekId: "w1", dayId: "d1", exerciseId: "tempo", position: 0, setCount: 3, load: "70%" };

  it("writes the column on create only when there is a reference, so a line on its own max is the row it always was", async () => {
    const { calls, deps } = harness();
    await createPrescription(deps, scope, { ...line, referenceExerciseId: "bench" });
    await createPrescription(deps, scope, line);
    await createPrescription(deps, scope, { ...line, referenceExerciseId: null });
    expect(calls[0].data).toMatchObject({ exercise_id: "tempo", reference_exercise_id: "bench" });
    expect("reference_exercise_id" in calls[1].data).toBe(false);
    expect("reference_exercise_id" in calls[2].data).toBe(false);
  });

  it("stores a reference to the line's own exercise as no reference", async () => {
    const { calls, deps } = harness();
    await createPrescription(deps, scope, { ...line, referenceExerciseId: "tempo" });
    await updatePrescription(deps, scope, "row1", { exerciseId: "bench", referenceExerciseId: "bench" });
    expect("reference_exercise_id" in calls[0].data).toBe(false);
    expect(calls[1].data.reference_exercise_id).toBeNull();
  });

  it("writes it on update when sent, clears it with null, and leaves it alone otherwise", async () => {
    const { calls, deps } = harness();
    await updatePrescription(deps, scope, "row1", { referenceExerciseId: "bench" });
    await updatePrescription(deps, scope, "row1", { referenceExerciseId: null });
    await updatePrescription(deps, scope, "row1", { load: "72.5%" });
    expect(calls.map((c) => c.data.reference_exercise_id)).toEqual(["bench", null, undefined]);
    expect("reference_exercise_id" in calls[2].data).toBe(false);
  });

  it("is placement on a copy: taken from the remap, never from the source row", async () => {
    const { calls, deps } = harness();
    const source = { $id: "src", exercise_id: "joey-tempo", reference_exercise_id: "joey-bench", load: "70%", set_count: 3 };
    expect(lineContent(source)).toEqual({ load: "70%", set_count: 3 });
    await copyPrescription(deps, scope, { weekId: "w2", dayId: "d2", exerciseId: "andrea-tempo", referenceExerciseId: "andrea-bench", position: 0 }, source);
    await copyPrescription(deps, scope, { weekId: "w2", dayId: "d2", exerciseId: "andrea-tempo", referenceExerciseId: null, position: 1 }, source);
    expect(calls[0].data).toMatchObject({ exercise_id: "andrea-tempo", reference_exercise_id: "andrea-bench", load_kind: "percent" });
    expect("reference_exercise_id" in calls[1].data).toBe(false);
  });
});

describe("what an athlete's rows gain (Order 22)", () => {
  it("links a session to the prescribed day it was started from", async () => {
    const { calls, deps } = harness();
    await createSession(deps, { userId: "joey" }, { clientSessionId: "cs-1", programDayId: "d1" });
    expect(calls[0].data).toMatchObject({ program_day_id: "d1" });
  });

  it("leaves a free session unlinked", async () => {
    const { calls, deps } = harness();
    await createSession(deps, { userId: "joey" }, { clientSessionId: "cs-1" });
    expect(calls[0].data.program_day_id).toBeUndefined();
  });

  it("stores the athlete's own numbers beside a snapshot of the target", async () => {
    const { calls, deps } = harness();
    await createSet(deps, { userId: "joey" }, {
      sessionId: "cs-1",
      exerciseId: "squat",
      setIndex: 2,
      loadKg: 155,
      reps: 5,
      rpe: 8.5,
      clientSetId: "st-1",
      prescriptionId: "l2",
      prescribed: "5 reps · 152.5 kg (75%)",
    });
    // The athlete put 155 on the bar against a 152.5 target. Both survive.
    expect(calls[0].data).toMatchObject({ load_kg: 155, prescription_id: "l2", prescribed: "5 reps · 152.5 kg (75%)" });
  });

  it("caps a long freeform target to the column rather than failing the set", async () => {
    const { calls, deps } = harness();
    await createSet(deps, { userId: "joey" }, {
      sessionId: "cs-1",
      exerciseId: "squat",
      setIndex: 1,
      loadKg: 100,
      reps: 5,
      clientSetId: "st-1",
      prescriptionId: "l1",
      prescribed: "x".repeat(400),
    });
    expect(String(calls[0].data.prescribed)).toHaveLength(160);
  });
});
