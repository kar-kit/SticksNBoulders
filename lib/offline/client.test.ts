import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/appwrite/documents";
import { createMemoryStore } from "./memory-store";
import { enqueue, attachQueue, cancelQueued, flush, queuedOps, resetQueueForTests } from "./client";
import type { QueueStore, QueuedOp } from "./queue";

const runOp = vi.hoisted(() => vi.fn<(actor: Actor, op: QueuedOp) => Promise<void>>());
vi.mock("./runner", () => ({ runOp }));

const ACTOR: Actor = { userId: "u1" };

/** A store that records what reached disk, so "written down first" is testable. */
function recordingStore(initial: QueuedOp[] = []) {
  const inner = createMemoryStore(initial);
  const writes: string[] = [];
  const store: QueueStore = {
    put: async (op) => {
      writes.push(op.id);
      await inner.put(op);
    },
    remove: inner.remove,
    all: inner.all,
  };
  return { store, writes, inner };
}

beforeEach(() => {
  runOp.mockReset();
  runOp.mockResolvedValue(undefined);
});

describe("the queue, offline and back", () => {
  it("keeps a set that could not be sent, and sends it when the signal comes back", async () => {
    const { store } = recordingStore();
    resetQueueForTests(store);
    await attachQueue(ACTOR);

    runOp.mockRejectedValue(new TypeError("Failed to fetch"));
    await enqueue("set.create", { setId: "st-1", sessionId: "cs-1" });
    await flush();

    expect(queuedOps()).toHaveLength(1);
    expect(await store.all()).toHaveLength(1);

    runOp.mockResolvedValue(undefined);
    await flush(true);

    expect(queuedOps()).toEqual([]);
    expect(await store.all()).toEqual([]);
  });

  it("replays what a reload left on disk", async () => {
    // The case IndexedDB is there for: the phone died mid-session, and the sets
    // logged in the basement are still owed to the coach.
    const first = recordingStore();
    resetQueueForTests(first.store);
    await attachQueue(ACTOR);
    runOp.mockRejectedValue(new TypeError("Failed to fetch"));
    await enqueue("session.create", { sessionId: "cs-1" });
    await enqueue("set.create", { setId: "st-1", sessionId: "cs-1" });
    await flush();
    expect(await first.store.all()).toHaveLength(2);

    // A fresh tab over the same disk. Nothing in memory carries across.
    resetQueueForTests(first.store);
    runOp.mockResolvedValue(undefined);
    await attachQueue(ACTOR);
    await flush(true);

    // The replay is the same two ops, in the same order, carrying the same ids
    // -- which is what stops a recovered queue writing the session twice.
    expect(runOp.mock.calls.slice(-2).map(([, op]) => [op.kind, op.payload.sessionId])).toEqual([
      ["session.create", "cs-1"],
      ["set.create", "cs-1"],
    ]);
    expect(await first.store.all()).toEqual([]);
  });

  it("sends the session before the sets that belong to it", async () => {
    const { store } = recordingStore();
    resetQueueForTests(store);
    await attachQueue(ACTOR);

    await enqueue("session.create", { sessionId: "cs-1" });
    await enqueue("set.create", { setId: "st-1", sessionId: "cs-1" });
    await enqueue("set.create", { setId: "st-2", sessionId: "cs-1" });
    await enqueue("session.finish", { sessionId: "cs-1" });
    await flush();

    expect(runOp.mock.calls.map(([, op]) => op.payload.setId ?? op.payload.sessionId)).toEqual([
      "cs-1",
      "st-1",
      "st-2",
      "cs-1",
    ]);
  });

  it("treats a conflict on replay as the set already having landed", async () => {
    const { store } = recordingStore();
    resetQueueForTests(store);
    await attachQueue(ACTOR);

    runOp.mockRejectedValue({ code: 409, message: "already exists" });
    await enqueue("set.create", { setId: "st-1", sessionId: "cs-1" });
    await flush();

    expect(queuedOps()).toEqual([]);
    expect(await store.all()).toEqual([]);
  });

  it("does not let one rejected write block the sets behind it", async () => {
    // Without this the queue looks busy and is actually dead: one malformed op
    // retrying forever while every real set waits behind it.
    const { store } = recordingStore();
    resetQueueForTests(store);
    await attachQueue(ACTOR);

    runOp.mockImplementation(async (_actor, op) => {
      if (op.payload.setId === "st-bad") throw { code: 400, message: "reps must be a number" };
    });

    await enqueue("set.create", { setId: "st-bad", sessionId: "cs-1" });
    await enqueue("set.create", { setId: "st-good", sessionId: "cs-1" });
    await flush();

    const left = queuedOps();
    expect(left).toHaveLength(1);
    expect(left[0].payload.setId).toBe("st-bad");
    expect(left[0].permanentError).toBe("reps must be a number");
    // And the good one is gone, because it was sent rather than stuck.
    expect(runOp.mock.calls.map(([, op]) => op.payload.setId)).toContain("st-good");
  });

  it("writes the op down before it tries to send it", async () => {
    const { store, writes } = recordingStore();
    resetQueueForTests(store);
    await attachQueue(ACTOR);

    const order: string[] = [];
    runOp.mockImplementation(async () => {
      order.push("sent");
    });
    await enqueue("set.create", { setId: "st-1", sessionId: "cs-1" });
    await flush();

    expect(writes).toHaveLength(1);
    expect(order).toEqual(["sent"]);
  });

  it("undoes an unsent set by dropping it, and a sent one by deleting it", async () => {
    const { store } = recordingStore();
    resetQueueForTests(store);
    await attachQueue(ACTOR);

    runOp.mockRejectedValue(new TypeError("Failed to fetch"));
    await enqueue("set.create", { setId: "st-1", sessionId: "cs-1" });
    expect(await cancelQueued("set.create", "st-1")).toBe(true);
    expect(queuedOps()).toEqual([]);

    await enqueue("set.create", { setId: "st-2", sessionId: "cs-1" });
    await flush();
    // Attempted once, so it may have landed. The caller must queue a delete.
    expect(await cancelQueued("set.create", "st-2")).toBe(false);
  });
});

describe("rollup refreshes", () => {
  const refresh = (exerciseId: string, weekKey: string) => enqueue("rollup.refresh", { exerciseId, weekKey });

  it("runs the last refresh of a bucket, after the sets it has to count", async () => {
    // A whole session logged with no signal, then sent. The bug this replaces:
    // collapsing at enqueue keeps the FIRST refresh, which sits ahead of the
    // sets that follow it, so it recomputes a week that is missing most of its
    // sets and nothing ever recomputes it again. The week's totals then sit
    // frozen at whatever had landed partway through the session.
    resetQueueForTests(createMemoryStore());
    await attachQueue(ACTOR);

    runOp.mockRejectedValue(new TypeError("Failed to fetch"));
    await enqueue("set.create", { setId: "st-1", sessionId: "cs-1" });
    await refresh("squat", "2026-09-14");
    await enqueue("set.create", { setId: "st-2", sessionId: "cs-1" });
    await refresh("squat", "2026-09-14");
    // Settles the drain the last enqueue kicked off, so swapping the mock
    // underneath it cannot rewrite what this test just set up.
    await flush();
    expect(queuedOps()).toHaveLength(4);

    runOp.mockReset();
    runOp.mockResolvedValue(undefined);
    await flush(true);

    const ran = runOp.mock.calls.map(([, op]) => op.payload.setId ?? `refresh:${op.sequence}`);
    expect(ran).toEqual(["st-1", "st-2", "refresh:3"]);
    expect(queuedOps()).toEqual([]);
    resetQueueForTests();
  });

  it("keeps refreshes for different buckets", async () => {
    resetQueueForTests(createMemoryStore());
    await attachQueue(ACTOR);

    runOp.mockRejectedValue(new TypeError("Failed to fetch"));
    await refresh("squat", "2026-09-14");
    await refresh("bench", "2026-09-14");
    await refresh("squat", "2026-09-21");
    await flush();
    runOp.mockReset();
    runOp.mockResolvedValue(undefined);
    await flush(true);

    expect(runOp).toHaveBeenCalledTimes(3);
    resetQueueForTests();
  });

  it("does not drop a refresh for one that can never run", async () => {
    // A superseding refresh that has been marked permanent is not going to
    // recompute anything, so the earlier one is all there is.
    resetQueueForTests(createMemoryStore());
    await attachQueue(ACTOR);

    runOp.mockRejectedValueOnce({ code: 400, message: "bad" });
    await refresh("squat", "2026-09-14");
    await refresh("squat", "2026-09-14");
    await flush();
    await flush(true);
    // The first was refused permanently; the second still ran.
    expect(queuedOps().filter((op) => op.permanentError)).toHaveLength(1);
    expect(runOp).toHaveBeenCalledTimes(2);
    resetQueueForTests();
  });
});
