import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryStore } from "@/lib/offline/memory-store";
import { queuedOps, resetQueueForTests } from "@/lib/offline/client";
import type { QueueStore, QueuedOp } from "@/lib/offline/queue";
import { editSet, logSet, removeSet } from "./set-store";

// Nothing here should reach the network: no actor is attached, so the queue
// writes down and never drains. What is on disk afterwards is the assertion.
const forgetUpload = vi.hoisted(() => vi.fn<(fileId: string) => Promise<void>>(async () => {}));
const pendingUploads = vi.hoisted(() => vi.fn(async () => [] as { fileId: string; setId: string }[]));
vi.mock("@/lib/video/pending-store", () => ({ forgetUpload, pendingUploads }));

let store: QueueStore;
const LOGGED_AT = new Date("2026-09-16T18:00:00.000Z");

const kinds = (ops: readonly QueuedOp[]) =>
  [...ops].sort((a, b) => a.sequence - b.sequence).map((op) => [op.kind, op.payload.setId ?? op.payload.exerciseId]);

const log = (setId: string) =>
  logSet({
    sessionId: "cs-1",
    exerciseId: "squat",
    setIndex: 1,
    loadKg: 140,
    reps: 5,
    rpe: 8,
    isWarmup: false,
    failed: false,
    clientSetId: setId,
  });

beforeEach(() => {
  store = createMemoryStore();
  resetQueueForTests(store);
  forgetUpload.mockClear();
  pendingUploads.mockReset();
  pendingUploads.mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logSet", () => {
  it("fails when the set itself cannot be written to the phone", async () => {
    resetQueueForTests({ ...store, put: () => Promise.reject(new DOMException("Quota exceeded", "QuotaExceededError")) });
    await expect(log("st-1")).rejects.toThrow("Quota exceeded");
  });

  it("reports the set logged once it is on disk, even if the rollup refresh behind it is not", async () => {
    // Throwing here would make the screen take the row back while the set
    // still syncs to the coach -- a set the athlete then logs a second time.
    const full = { ...store, put: async (op: QueuedOp) => {
      if (op.kind === "rollup.refresh") throw new DOMException("Quota exceeded", "QuotaExceededError");
      await store.put(op);
    } };
    resetQueueForTests(full);
    await expect(log("st-1")).resolves.toMatchObject({ clientSetId: "st-1" });
    expect(kinds(await store.all())).toEqual([["set.create", "st-1"]]);
  });
});

describe("removeSet", () => {
  it("takes a set that never left the phone straight out of the queue, with no delete", async () => {
    await log("st-1");
    const result = await removeSet("st-1", { exerciseId: "squat", loggedAt: LOGGED_AT });

    expect(result).toEqual({ queued: false });
    // The create's own rollup refresh is harmless -- it recomputes a week the
    // set never reached -- and there is no set.delete for a row never written.
    expect(kinds(queuedOps())).toEqual([["rollup.refresh", "squat"]]);
  });

  it("queues a delete, then a rollup refresh behind it, for a set that has synced", async () => {
    const result = await removeSet("st-synced", { exerciseId: "squat", loggedAt: LOGGED_AT });

    expect(result).toEqual({ queued: true });
    expect(kinds(await store.all())).toEqual([
      ["set.delete", "st-synced"],
      ["rollup.refresh", "squat"],
    ]);
  });

  it("refreshes the week the set was logged in, not the week it was deleted in", async () => {
    await removeSet("st-synced", { exerciseId: "squat", loggedAt: LOGGED_AT });
    const refresh = (await store.all()).find((op) => op.kind === "rollup.refresh");
    expect(refresh?.payload).toMatchObject({
      exerciseId: "squat",
      loggedAt: LOGGED_AT.toISOString(),
      weekKey: "2026-09-14T00:00:00.000Z",
    });
  });

  it("queues the delete behind a create that has already been tried", async () => {
    // It may have landed with the response lost. Dropping it locally would
    // leave a set on the coach's side the athlete believes is gone.
    await store.put({
      id: "op-create",
      kind: "set.create",
      payload: { setId: "st-2", sessionId: "cs-1" },
      sequence: 0,
      attempts: 1,
      nextAttemptAt: 0,
    });
    resetQueueForTests(store);
    const { attachQueue } = await import("@/lib/offline/client");
    // Attaching loads the disk; the runner is never reached without signal.
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));

    await attachQueue({ userId: "joey" }).catch(() => {});
    const result = await removeSet("st-2", { exerciseId: "squat", loggedAt: LOGGED_AT });

    expect(result.queued).toBe(true);
    const order = kinds(await store.all()).map(([kind]) => kind);
    expect(order.indexOf("set.create")).toBeLessThan(order.indexOf("set.delete"));
    expect(order.indexOf("set.delete")).toBeLessThan(order.lastIndexOf("rollup.refresh"));
  });

  it("forgets a clip still uploading for the deleted set, and only that one", async () => {
    pendingUploads.mockResolvedValue([
      { fileId: "f-mine", setId: "st-3" },
      { fileId: "f-other", setId: "st-4" },
    ]);
    await removeSet("st-3", { exerciseId: "squat", loggedAt: LOGGED_AT });
    await vi.waitFor(() => expect(forgetUpload).toHaveBeenCalledWith("f-mine"));
    expect(forgetUpload).not.toHaveBeenCalledWith("f-other");
  });
});

describe("removeSet with a clip", () => {
  it("queues the clip's delete behind the set's, so the file only goes once the set has", async () => {
    // A set from an earlier visit: nothing for it in this queue, so it may have landed.
    await removeSet("st-1", { exerciseId: "squat", loggedAt: LOGGED_AT, videoFileId: "vid-1" });
    expect(kinds(await store.all())).toEqual([
      ["set.delete", "st-1"],
      ["rollup.refresh", "squat"],
      ["clip.delete", "st-1"],
    ]);
  });

  it("queues no clip delete when the caller does not know of one", async () => {
    await removeSet("st-1", { exerciseId: "squat", loggedAt: LOGGED_AT });
    expect(kinds(await store.all()).map(([kind]) => kind)).not.toContain("clip.delete");
  });
});

describe("editSet and the athlete's note (F11)", () => {
  const SET = { exerciseId: "squat", loggedAt: LOGGED_AT };
  const values = { loadKg: 140, reps: 5, rpe: 8 as const, isWarmup: false, failed: false };
  const updates = async () =>
    (await store.all()).filter((op) => op.kind === "set.update").map((op) => op.payload);

  it("queues a note trimmed, alongside the four values", async () => {
    await editSet("st-1", { ...values, notes: "  belt loose  " }, SET);
    expect(await updates()).toEqual([{ setId: "st-1", ...values, notes: "belt loose" }]);
  });

  it("queues a blank note as null, which clears it", async () => {
    await editSet("st-1", { ...values, notes: "   " }, SET);
    expect((await updates())[0]).toMatchObject({ notes: null });
  });

  it("leaves the note out of an edit that did not mention it, so the server keeps it", async () => {
    await editSet("st-1", values, SET);
    expect(await updates()).toEqual([{ setId: "st-1", ...values }]);
    expect("notes" in (await updates())[0]).toBe(false);
  });

  it("caps a note at the column's 500 characters", async () => {
    await editSet("st-1", { ...values, notes: "x".repeat(700) }, SET);
    expect(((await updates())[0].notes as string).length).toBe(500);
  });
});

describe("failed sets (F19)", () => {
  it("queues the flag with the set, 0 reps and all, and hands it back on the logged set", async () => {
    const logged = await logSet({
      sessionId: "cs-1",
      exerciseId: "squat",
      setIndex: 3,
      loadKg: 200,
      reps: 0,
      rpe: 10,
      isWarmup: false,
      failed: true,
      clientSetId: "st-miss",
    });
    const create = (await store.all()).find((op) => op.kind === "set.create");
    expect(create?.payload).toMatchObject({ setId: "st-miss", loadKg: 200, reps: 0, failed: true });
    expect(logged).toMatchObject({ reps: 0, failed: true });
  });

  it("restates the flag on every correction, so a flip cannot un-fail a set", async () => {
    await editSet(
      "st-1",
      { loadKg: 140, reps: 2, rpe: null, isWarmup: false, failed: true },
      { exerciseId: "squat", loggedAt: LOGGED_AT },
    );
    const update = (await store.all()).find((op) => op.kind === "set.update");
    expect(update?.payload).toEqual({ setId: "st-1", loadKg: 140, reps: 2, rpe: null, isWarmup: false, failed: true });
  });
});

describe("cardio sets (F23)", () => {
  it("queue their duration and level beside the inert strength values", async () => {
    const logged = await logSet({
      sessionId: "cs-1",
      exerciseId: "treadmill",
      setIndex: 1,
      loadKg: 0,
      reps: 0,
      rpe: null,
      isWarmup: false,
      failed: false,
      clientSetId: "st-c",
      durationSeconds: 1200,
      level: 8,
    });
    const create = (await store.all()).find((op) => op.kind === "set.create")!;
    expect(create.payload).toMatchObject({ loadKg: 0, reps: 0, durationSeconds: 1200, level: 8 });
    expect(logged).toMatchObject({ clientSetId: "st-c", durationSeconds: 1200, level: 8 });
  });

  it("queue a strength set with no cardio keys at all", async () => {
    await log("st-1");
    const create = (await store.all()).find((op) => op.kind === "set.create")!;
    expect(create.payload).not.toHaveProperty("durationSeconds");
    expect(create.payload).not.toHaveProperty("level");
  });

  it("queue a cardio correction with its duration and a cleared level as null", async () => {
    await editSet(
      "st-c",
      { loadKg: 0, reps: 0, rpe: null, isWarmup: false, failed: false, durationSeconds: 900, level: null },
      { exerciseId: "treadmill", loggedAt: LOGGED_AT },
    );
    const update = (await store.all()).find((op) => op.kind === "set.update")!;
    expect(update.payload).toMatchObject({ durationSeconds: 900, level: null });
  });
});
