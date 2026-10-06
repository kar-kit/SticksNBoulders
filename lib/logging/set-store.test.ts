import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryStore } from "@/lib/offline/memory-store";
import { queuedOps, resetQueueForTests } from "@/lib/offline/client";
import type { QueueStore, QueuedOp } from "@/lib/offline/queue";
import { logSet, removeSet } from "./set-store";

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
