import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RowWriter } from "@/appwrite/documents";
import { runOp } from "./runner";
import { newOp, type OpKind } from "./queue";

/**
 * The runner against a fake Appwrite.
 *
 * Only the browser's row writer is replaced. The document helpers in write.ts
 * run for real, so these assert what actually reaches a row -- which is the
 * whole job of this file: an op whose payload is mapped wrongly is a set that
 * lands with the wrong numbers, and nothing upstream would notice.
 */

/** One timeline for every side effect, so "before" is something a test can read. */
const events = vi.hoisted(() => [] as string[]);
const rows = vi.hoisted(
  () => [] as { op: "create" | "update" | "delete"; tableId: string; rowId: string; data?: Record<string, unknown> }[],
);
/** What the next row write throws, if anything. */
const failure = vi.hoisted(() => ({ next: null as unknown }));

const ensureMyCircle = vi.hoisted(() => vi.fn<() => Promise<void>>());
const ensureMyProfile = vi.hoisted(() => vi.fn<() => Promise<null>>());
const refreshRollup = vi.hoisted(() => vi.fn<(exerciseId: string, loggedAt: string) => Promise<void>>());
const fetchCommentsForSets = vi.hoisted(() =>
  vi.fn<(ids: readonly string[]) => Promise<{ authorId: string }[]>>(),
);

vi.mock("@/appwrite/documents/browser-writer", () => {
  const take = () => {
    const error = failure.next;
    failure.next = null;
    if (error) throw error;
  };
  const writer: RowWriter = {
    async createRow({ tableId, rowId, data }) {
      events.push(`write:${tableId}`);
      take();
      rows.push({ op: "create", tableId, rowId, data });
      return { $id: rowId };
    },
    async updateRow({ tableId, rowId, data }) {
      events.push(`write:${tableId}`);
      take();
      rows.push({ op: "update", tableId, rowId, data });
      return { $id: rowId };
    },
    async deleteRow({ tableId, rowId }) {
      events.push(`write:${tableId}`);
      take();
      rows.push({ op: "delete", tableId, rowId });
      return {};
    },
  };
  return {
    browserWriteDeps: (newId: () => string) => ({
      writer,
      databaseId: "db",
      newId,
      now: () => new Date("2026-10-07T09:00:00.000Z"),
    }),
  };
});
vi.mock("@/lib/auth/circle", () => ({ ensureMyCircle }));
vi.mock("@/lib/profile/profile-store", () => ({ ensureMyProfile }));
vi.mock("@/lib/strength/rollup-client", () => ({ refreshRollup }));
vi.mock("@/lib/review/comment-store", () => ({ fetchCommentsForSets }));

const ACTOR = { userId: "athlete-1" };
const op = (kind: OpKind, payload: Record<string, unknown>) => newOp(kind, payload, 0, "op-1");

beforeEach(() => {
  events.length = 0;
  rows.length = 0;
  failure.next = null;
  ensureMyCircle.mockReset().mockImplementation(async () => {
    events.push("circle");
  });
  ensureMyProfile.mockReset().mockImplementation(async () => {
    events.push("profile");
    return null;
  });
  refreshRollup.mockReset().mockResolvedValue(undefined);
  fetchCommentsForSets.mockReset().mockResolvedValue([]);
});

const SET = {
  setId: "st-abc",
  sessionId: "cs-1",
  exerciseId: "squat",
  setIndex: 3,
  loadKg: 140,
  reps: 5,
  rpe: 8,
  loggedAt: "2026-10-07T08:30:00.000Z",
};

describe("before any write", () => {
  it("ensures the circle first, because a cold load's first write is otherwise a 401", async () => {
    await runOp(ACTOR, op("set.create", { ...SET, isWarmup: false }));
    expect(events.indexOf("circle")).toBe(0);
    expect(events.indexOf("circle")).toBeLessThan(events.indexOf("write:sets"));
  });

  it("does not write when the circle cannot be prepared, so the queue retries rather than 401ing", async () => {
    ensureMyCircle.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(runOp(ACTOR, op("set.create", { ...SET, isWarmup: false }))).rejects.toThrow("Failed to fetch");
    expect(rows).toEqual([]);
  });

  it("asks for the athlete's profile, so a coach does not see 'Unnamed athlete'", async () => {
    await runOp(ACTOR, op("set.create", { ...SET, isWarmup: false }));
    expect(ensureMyProfile).toHaveBeenCalledTimes(1);
  });

  it("still writes the set when the profile cannot be written", async () => {
    ensureMyProfile.mockRejectedValue({ code: 500, message: "profiles down" });
    await runOp(ACTOR, op("set.create", { ...SET, isWarmup: false }));
    expect(rows.map((row) => row.rowId)).toEqual(["st-abc"]);
  });
});

describe("set.create", () => {
  it("carries a warm-up flag through to the row", async () => {
    // Forced to false, a warm-up lands as a working set: it gets an e1RM, it
    // counts towards the week, and the coach reads it as the real work.
    await runOp(ACTOR, op("set.create", { ...SET, loadKg: 60, isWarmup: true }));
    expect(rows[0].data).toMatchObject({ is_warmup: true, load_kg: 60 });
    expect(rows[0].data?.e1rm_kg).toBeUndefined();
  });

  it("maps a working set's numbers and its prescription onto the row it creates", async () => {
    await runOp(
      ACTOR,
      op("set.create", { ...SET, isWarmup: false, prescriptionId: "rx-9", prescribed: "5 @ RPE 8" }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ op: "create", tableId: "sets", rowId: "st-abc" });
    expect(rows[0].data).toMatchObject({
      session_id: "cs-1",
      athlete_id: "athlete-1",
      exercise_id: "squat",
      set_index: 3,
      load_kg: 140,
      reps: 5,
      rpe: 8,
      is_warmup: false,
      client_set_id: "st-abc",
      logged_at: "2026-10-07T08:30:00.000Z",
      prescription_id: "rx-9",
      prescribed: "5 @ RPE 8",
    });
  });

  it("leaves the prescription unset on a set that answers none", async () => {
    await runOp(ACTOR, op("set.create", { ...SET, rpe: null, isWarmup: false }));
    expect(rows[0].data?.prescription_id).toBeUndefined();
    expect(rows[0].data?.prescribed).toBeUndefined();
    expect(rows[0].data?.rpe).toBeUndefined();
  });
});

describe("the other writes", () => {
  it("creates the session under the id the device gave it", async () => {
    await runOp(
      ACTOR,
      op("session.create", { sessionId: "cs-1", startedAt: "2026-10-07T08:00:00.000Z", programDayId: "day-2" }),
    );
    expect(rows).toEqual([
      expect.objectContaining({
        op: "create",
        tableId: "sessions",
        rowId: "cs-1",
        data: expect.objectContaining({
          client_session_id: "cs-1",
          started_at: "2026-10-07T08:00:00.000Z",
          program_day_id: "day-2",
        }),
      }),
    ]);
  });

  it("finishes the session with the totals it was given", async () => {
    await runOp(
      ACTOR,
      op("session.finish", { sessionId: "cs-1", finishedAt: "2026-10-07T09:15:00.000Z", setCount: 12, tonnageKg: 4200 }),
    );
    expect(rows).toEqual([
      expect.objectContaining({
        op: "update",
        tableId: "sessions",
        rowId: "cs-1",
        data: expect.objectContaining({ finished_at: "2026-10-07T09:15:00.000Z", set_count: 12, tonnage_kg: 4200 }),
      }),
    ]);
  });

  it("updates a set with all four numbers, warm-up flag included", async () => {
    await runOp(ACTOR, op("set.update", { setId: "st-abc", loadKg: 100, reps: 3, rpe: 7, isWarmup: true }));
    expect(rows).toEqual([
      expect.objectContaining({
        op: "update",
        rowId: "st-abc",
        data: expect.objectContaining({ load_kg: 100, reps: 3, rpe: 7, is_warmup: true }),
      }),
    ]);
  });

  it("creates an exercise under its client id", async () => {
    await runOp(ACTOR, op("exercise.create", { exerciseId: "ex-1", name: "Pause Squat" }));
    expect(rows).toEqual([
      expect.objectContaining({ tableId: "exercises", rowId: "ex-1", data: expect.objectContaining({ name: "Pause Squat" }) }),
    ]);
  });

  it("refreshes the rollup for the set's exercise and time", async () => {
    await runOp(ACTOR, op("rollup.refresh", { exerciseId: "squat", loggedAt: "2026-10-07T08:30:00.000Z" }));
    expect(refreshRollup).toHaveBeenCalledWith("squat", "2026-10-07T08:30:00.000Z");
    expect(rows).toEqual([]);
  });

  it("detaches a clip by writing null, not by leaving the old id", async () => {
    await runOp(ACTOR, op("set.attachVideo", { setId: "st-abc", videoFileId: null }));
    expect(rows).toEqual([expect.objectContaining({ op: "update", rowId: "st-abc", data: { video_file_id: null } })]);
  });

  it("treats a clip for a set that has since gone as done", async () => {
    failure.next = { code: 404, message: "Row not found" };
    await expect(runOp(ACTOR, op("set.attachVideo", { setId: "st-abc", videoFileId: "f-1" }))).resolves.toBeUndefined();
  });
});

describe("set.delete", () => {
  it("deletes the row", async () => {
    await runOp(ACTOR, op("set.delete", { setId: "st-abc" }));
    expect(rows).toEqual([{ op: "delete", tableId: "sets", rowId: "st-abc" }]);
  });

  it("counts a set that is already gone as deleted, not as a failure", async () => {
    // Deleted from History on another device, or a first attempt that landed
    // with its response lost. Thrown on, the queue files it as permanent and
    // tells the athlete a delete failed that in fact succeeded.
    failure.next = { code: 404, message: "Row not found" };
    await expect(runOp(ACTOR, op("set.delete", { setId: "st-abc" }))).resolves.toBeUndefined();
  });

  it("passes any other failure up for the queue to classify", async () => {
    failure.next = { code: 503, message: "unavailable" };
    await expect(runOp(ACTOR, op("set.delete", { setId: "st-abc" }))).rejects.toMatchObject({ code: 503 });
  });

  it("refuses to delete a set a coach has commented on", async () => {
    fetchCommentsForSets.mockResolvedValue([{ authorId: "athlete-1" }, { authorId: "coach-1" }]);
    await expect(runOp(ACTOR, op("set.delete", { setId: "st-abc" }))).rejects.toMatchObject({ code: 412 });
    expect(fetchCommentsForSets).toHaveBeenCalledWith(["st-abc"]);
    expect(rows).toEqual([]);
  });

  it("deletes a set whose only comments are the athlete's own", async () => {
    fetchCommentsForSets.mockResolvedValue([{ authorId: "athlete-1" }]);
    await runOp(ACTOR, op("set.delete", { setId: "st-abc" }));
    expect(rows).toEqual([{ op: "delete", tableId: "sets", rowId: "st-abc" }]);
  });
});
