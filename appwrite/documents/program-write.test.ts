import type { RowWriter } from "./row-writer";
import { createSession, createSet, type WriteDeps } from "./write";
import { createPrescription, createProgram, updatePrescription, type ProgramScope } from "./program-write";

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
