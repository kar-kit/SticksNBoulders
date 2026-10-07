import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/appwrite/documents";
import { createMemoryStore } from "./memory-store";
import { enqueue, attachQueue, flush, queuedOps, resetQueueForTests } from "./client";
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
    // One timeline for disk and network. The put is made to take a tick, as
    // IndexedDB does, so an enqueue that started sending before it had
    // persisted would show up here as a send ahead of its put.
    const log: string[] = [];
    const inner = createMemoryStore();
    const store: QueueStore = {
      put: async (op) => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        await inner.put(op);
        log.push(`put:${op.payload.setId}`);
      },
      remove: inner.remove,
      all: inner.all,
    };
    resetQueueForTests(store);
    await attachQueue(ACTOR);

    runOp.mockImplementation(async (_actor, op) => {
      log.push(`send:${op.payload.setId}`);
    });
    await enqueue("set.create", { setId: "st-1", sessionId: "cs-1" });
    await flush();

    expect(log).toEqual(["put:st-1", "send:st-1"]);
  });

  it("does not send a set when its session failed to send", async () => {
    // The network dropped mid-flush. Everything behind a retryable failure
    // would fail the same way, and a set that did get through would reach
    // Appwrite before the session it belongs to.
    const { store } = recordingStore([
      { id: "op-a", kind: "session.create", payload: { sessionId: "cs-1" }, sequence: 0, attempts: 0, nextAttemptAt: 0 },
      { id: "op-b", kind: "set.create", payload: { setId: "st-1", sessionId: "cs-1" }, sequence: 1, attempts: 0, nextAttemptAt: 0 },
    ]);
    resetQueueForTests(store);
    runOp.mockImplementation(async (_actor, op) => {
      if (op.kind === "session.create") throw new TypeError("Failed to fetch");
    });

    // attachQueue forces a flush, the path that ignores backoff.
    await attachQueue(ACTOR);
    await flush();
    await flush(true);

    expect(runOp.mock.calls.map(([, op]) => op.kind)).not.toContain("set.create");
    expect(queuedOps().map((op) => op.kind).sort()).toEqual(["session.create", "set.create"]);
  });
});

describe("replay order after a reload", () => {
  /**
   * IndexedDB's getAll returns records sorted by key, and the key is the op id
   * as a string. The memory store returns insertion order, which is why the
   * tests above never saw a replay out of sequence.
   */
  function idbLikeStore(initial: QueuedOp[] = []) {
    const inner = createMemoryStore(initial);
    const store: QueueStore = {
      put: inner.put,
      remove: inner.remove,
      all: async () => (await inner.all()).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    };
    return store;
  }

  afterEach(() => {
    vi.restoreAllMocks();
    resetQueueForTests();
  });

  it("replays a session's sets in the order they were logged", async () => {
    // Set and rollup ops are queued in the same millisecond. With the sequence
    // unpadded in the id, op-<t>-10 sorts ahead of op-<t>-2 on disk.
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const store = idbLikeStore();
    resetQueueForTests(store);
    await attachQueue(ACTOR);
    runOp.mockRejectedValue(new TypeError("Failed to fetch"));
    await enqueue("session.create", { sessionId: "cs-1" });
    for (let n = 1; n <= 11; n += 1) await enqueue("set.create", { setId: `st-${n}`, sessionId: "cs-1" });
    await flush();

    // On disk in the order they were written, not in string-collation order.
    expect((await store.all()).map((op) => op.sequence)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

    resetQueueForTests(store);
    runOp.mockReset();
    runOp.mockResolvedValue(undefined);
    await attachQueue(ACTOR);
    await flush(true);

    expect(runOp.mock.calls.map(([, op]) => op.payload.setId ?? op.payload.sessionId)).toEqual([
      "cs-1",
      ...Array.from({ length: 11 }, (_, i) => `st-${i + 1}`),
    ]);
  });

  it("replays a queue written before ids were padded in sequence order too", async () => {
    // A phone that went offline on the old build and reloads on the new one.
    // Its ids sort st-9 after st-10 and always will, so the order has to come
    // from the stored sequence rather than from the key.
    const old = Array.from({ length: 12 }, (_, sequence) => ({
      id: `op-1700000000000-${sequence + 1}`,
      kind: (sequence === 0 ? "session.create" : "set.create") as QueuedOp["kind"],
      payload: sequence === 0 ? { sessionId: "cs-1" } : { setId: `st-${sequence}`, sessionId: "cs-1" },
      sequence,
      attempts: 1,
      nextAttemptAt: 0,
    }));
    resetQueueForTests(idbLikeStore(old));
    await attachQueue(ACTOR);
    await flush();

    expect(runOp.mock.calls.map(([, op]) => op.sequence)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
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

describe("withdrawing a set", () => {
  it("does not send an op that was withdrawn after the batch was taken", async () => {
    // A set deleted while an earlier op was on the wire. The drain loop holds
    // a snapshot; without the check it would send the create anyway.
    const { store } = recordingStore();
    resetQueueForTests(store);
    await attachQueue(ACTOR);

    let release: () => void = () => {};
    runOp.mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)));
    await enqueue("session.create", { sessionId: "cs-1" });
    await enqueue("set.create", { setId: "st-1", sessionId: "cs-1" });

    const { withdrawSet } = await import("./client");
    const { landed } = await withdrawSet("st-1");
    release();
    await flush();

    expect(landed).toBe(false);
    expect(runOp.mock.calls.map(([, op]) => op.kind)).toEqual(["session.create"]);
  });

  it("will not withdraw the op whose request is on the wire", async () => {
    const { store } = recordingStore();
    resetQueueForTests(store);
    await attachQueue(ACTOR);

    let release: () => void = () => {};
    runOp.mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)));
    await enqueue("set.create", { setId: "st-1", sessionId: "cs-1" });
    // Let the drain start sending it.
    await new Promise((r) => setTimeout(r, 0));

    const { withdrawSet } = await import("./client");
    const { landed } = await withdrawSet("st-1");
    release();
    await flush();

    expect(landed).toBe(true);
  });

  it("dismisses only failed ops", async () => {
    const { store } = recordingStore([
      { id: "f", kind: "set.delete", payload: { setId: "a" }, sequence: 0, attempts: 1, nextAttemptAt: 0, permanentError: "x" },
      { id: "p", kind: "set.delete", payload: { setId: "b" }, sequence: 1, attempts: 0, nextAttemptAt: Date.now() + 60_000 },
    ]);
    resetQueueForTests(store);
    runOp.mockRejectedValue(new TypeError("Failed to fetch"));
    await attachQueue(ACTOR);

    const { dismissFailed } = await import("./client");
    await dismissFailed(["f", "p"]);
    expect((await store.all()).map((op) => op.id)).toEqual(["p"]);
  });
});
